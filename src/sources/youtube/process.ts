import type { SourceContext } from "../types.js";
import { buildVideoUrl, fetchTranscript, fetchVideoDetails } from "./fetch.js";
import type { YouTubeState } from "./state.js";
import type { FlatPlaylistEntry, VideoRunResult, YtDlpVideo } from "./types.js";

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

		const ingested = await ingestVideoToGreptor({
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
	}
}

async function ingestVideoToGreptor(args: {
	context: SourceContext;
	publisherId: string;
	videoId: string;
	videoUrl: string;
	transcript: string;
	details: YtDlpVideo;
	publishedAt: Date;
}): Promise<boolean> {
	const {
		context,
		publisherId,
		videoId,
		videoUrl,
		transcript,
		details,
		publishedAt,
	} = args;

	const result = await context.greptor.eat({
		id: videoId,
		format: "text",
		label: details.title ?? videoId,
		source: "youtube",
		publisher: publisherId,
		creationDate: publishedAt,
		overwrite: true,
		content: transcript,
		tags: {
			channelName: details.channel ?? publisherId,
			channelSubscribersCount: details.channel_follower_count ?? 0,
			videoViewsCount: details.view_count ?? 0,
			videoLikesCount: details.like_count ?? 0,
			videoCommentsCount: details.comment_count ?? 0,
			videoUrl,
		},
	});

	return result.success;
}
