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
			const state = new YouTubeState(context.workspacePath);
			await state.load();

			log.info(`Fetching @${publisherId} videos`);

			const videos = await listVideos(publisherId);
			const newVideos = videos.filter(
				(v) => v.id && !state.contains(publisherId, v.id) && !state.isSkipped(publisherId, v.id),
			);

			let processedCount = 0;
			let errorCount = 0;

			for (let i = 0; i < newVideos.length; i++) {
				const entry = newVideos[i];
				if (!entry?.id) continue;

				const title = entry.title ?? entry.id;
				const result = await processVideo({
					context,
					publisherId,
					entry,
					state,
				});

				if (result.status === "indexed") {
					processedCount++;
				} else if (result.status === "error") {
					errorCount++;
					log.error(`Failed to index video "${title}" for @${publisherId}: ${result.reason}`);
				} else if (result.status === "skipped" && result.reason === "before-start-date") {
					log.info(`Reached start date (${processedCount} processed) for @${publisherId}`);
					break;
				}
			}

			log.info(`Completed @${publisherId} (${processedCount} items${errorCount > 0 ? `, ${errorCount} errors` : ""})`);
		},
	};
}
