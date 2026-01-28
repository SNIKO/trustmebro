import { statusBar } from "../../ui/status-bar.js";
import type { SourceContext } from "../types.js";
import { buildVideoUrl, fetchTranscript, fetchVideoDetails } from "./fetch.js";
import { ingestVideo } from "./ingest.js";
import type { YouTubeState } from "./state.js";
import type { FlatPlaylistEntry, VideoRunResult } from "./types.js";

export async function processVideo(args: {
	context: SourceContext;
	publisherId: string;
	entry: FlatPlaylistEntry;
	state: YouTubeState;
}): Promise<VideoRunResult> {
	const { context, publisherId, entry, state } = args;
	const videoId = entry.id;

	if (!videoId) {
		return { videoId: "<unknown>", status: "skipped", reason: "missing-id" };
	}

	const fetchKey = `youtube:${publisherId}:${videoId}`;
	statusBar.addFetchingItem(fetchKey, {
		sourceId: "youtube",
		publisherId: publisherId,
		title: entry.title ?? videoId,
	});

	try {
		const videoUrl = buildVideoUrl(entry);
		const detailsResult = await fetchVideoDetails(videoUrl);
		if (!detailsResult.ok) {
			if (detailsResult.reason === "members only") {
				await state.markSkipped(publisherId, videoId, "members only");
				return {
					videoId,
					status: "skipped",
					reason: "members only",
				};
			}
			return {
				videoId,
				status: "error",
				reason: "missing-details",
			};
		}

		const details = detailsResult.details;
		if (!details.timestamp) {
			return {
				videoId,
				status: "error",
				reason: "missing-details",
			};
		}

		statusBar.removeFetchingItem(fetchKey);
		statusBar.addFetchingItem(fetchKey, {
			sourceId: "youtube",
			publisherId: publisherId,
			title: details.title ?? videoId,
		});

		const publishedAt = new Date(details.timestamp * 1000);
		if (publishedAt < context.config.startDate) {
			return {
				videoId,
				status: "skipped",
				reason: "before-start-date",
				title: details.title,
			};
		}

		const transcript = await fetchTranscript(videoUrl, details);
		if (!transcript) {
			return {
				videoId,
				status: "skipped",
				reason: "no-transcript",
				title: details.title,
			};
		}

		// Switch from fetching -> indexing.
		statusBar.removeFetchingItem(fetchKey);

		const ingested = await ingestVideo({
			context,
			publisherId,
			videoId,
			videoUrl,
			transcript,
			details,
			publishedAt,
		});

		if (!ingested) {
			return {
				videoId,
				status: "error",
				reason: "ingest-failed",
				title: details.title,
			};
		}

		await state.markIndexed(publisherId, videoId);
		return {
			videoId,
			status: "indexed",
			title: details.title,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { videoId, status: "error", reason: message };
	} finally {
		statusBar.removeFetchingItem(fetchKey);
	}
}
