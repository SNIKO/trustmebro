import { createLogger } from "../../utils/logger.js";
import type { Source, SourceContext } from "../types.js";
import { hasYtDlp, listVideos } from "./fetch.js";
import { processVideo } from "./process.js";
import { YouTubeState } from "./state.js";

const log = createLogger("youtube");

export function createYoutubeSource(): Source | null {
	if (!hasYtDlp()) {
		return null;
	}

	return {
		sourceId: "youtube",

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			await runYoutubeIndex(context, publisherId);
		},
	};
}

async function runYoutubeIndex(context: SourceContext, publisherId: string): Promise<void> {
	const state = new YouTubeState(context.workspacePath);
	await state.load();

	log.info(`Fetching @${publisherId} videos`);

	const videos = await listVideos(publisherId);
	const newVideos = videos.filter(
		(video) => video.id && !state.contains(publisherId, video.id) && !state.isSkipped(publisherId, video.id),
	);
	const counts = await processNewVideos(context, publisherId, state, newVideos);

	log.info(
		`Completed @${publisherId} (${counts.processed} items${counts.errors > 0 ? `, ${counts.errors} errors` : ""})`,
	);
}

async function processNewVideos(
	context: SourceContext,
	publisherId: string,
	state: YouTubeState,
	newVideos: Awaited<ReturnType<typeof listVideos>>,
): Promise<{ processed: number; errors: number }> {
	let processed = 0;
	let errors = 0;

	for (const entry of newVideos) {
		if (!entry.id) continue;

		const result = await processVideo({ context, publisherId, entry, state });
		if (result.status === "indexed") processed++;
		if (result.status === "error")
			errors += logVideoError(publisherId, entry.title ?? entry.id, result.reason ?? "unknown error");
		if (result.status === "skipped" && result.reason === "before-start-date") {
			log.info(`Reached start date (${processed} processed) for @${publisherId}`);
			break;
		}
	}

	return { processed, errors };
}

function logVideoError(publisherId: string, title: string, reason: string): number {
	log.error(`Failed to index video "${title}" for @${publisherId}: ${reason}`);
	return 1;
}
