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

			log.info(`Fetching ${publisherId} videos`);

			const fetchStart = Date.now();
			const videos = await listVideos(publisherId);
			const newVideos = videos.filter(
				(v) =>
					v.id &&
					!state.contains(publisherId, v.id) &&
					!state.isSkipped(publisherId, v.id),
			);

			const fetchElapsed = ((Date.now() - fetchStart) / 1000).toFixed(0);
			log.info(
				`Fetched ${newVideos.length} videos for ${publisherId} (${fetchElapsed}s)`,
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
					if (processedCount % 10 === 0 || i === newVideos.length - 1) {
						log.info(
							`Processed ${processedCount}/${newVideos.length} videos for ${publisherId}`,
						);
					}
				} else if (result.status === "error") {
					errorCount++;
					log.error(`Failed to index video "${title}": ${result.reason}`);
				} else if (
					result.status === "skipped" &&
					result.reason === "before-start-date"
				) {
					log.info(`Reached start date (${processedCount} processed)`);
					break;
				}
			}

			log.info(
				`Completed ${publisherId} (${processedCount} items${errorCount > 0 ? `, ${errorCount} errors` : ""})`,
			);
		},
	};
}
