import {
	logFetchingItemsCompleted,
	logFetchingItemsStarted,
	logger,
	logItemFetched,
	type SourceLogContext,
} from "../../ui/logger.js";
import type { Source, SourceContext } from "../types.js";
import { hasYtDlp, listVideos } from "./fetch.js";
import { processVideo } from "./process.js";
import { YouTubeState } from "./state.js";

export function createYoutubeSource(): Source | null {
	if (!hasYtDlp()) {
		logger.error(
			"[youtube] yt-dlp is required for youtube source. Install it from https://github.com/yt-dlp/yt-dlp#installation",
		);
		return null;
	}

	return {
		sourceId: "youtube",

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const logContext = {
				sourceId: "youtube",
				publisherId,
			} as SourceLogContext;
			const state = new YouTubeState(context.workspacePath);
			await state.load();

			logFetchingItemsStarted("youtube", publisherId);
			const videos = await listVideos(publisherId);
			logFetchingItemsCompleted("youtube", publisherId);
			const newVideos = videos.filter(
				(v) => v.id && !state.contains(publisherId, v.id),
			);

			for (const entry of newVideos) {
				if (!entry.id) continue;

				const title = entry.title ?? entry.id;

				const result = await processVideo({
					context,
					publisherId,
					entry,
					state,
				});

				switch (result.status) {
					case "indexed":
						logItemFetched({
							context: logContext,
							status: "fetched",
							title: result.title ?? title,
						});
						break;
					case "skipped":
						logItemFetched({
							context: logContext,
							status: "skipped",
							title: result.title ?? title,
							reason: result.reason ?? "unknown reason",
						});
						if (result.reason === "before-start-date") {
							return;
						}
						break;
					case "error":
						logItemFetched({
							context: logContext,
							status: "failed",
							title: result.title ?? title,
							reason: result.reason ?? "unknown error",
						});
						break;
				}
			}
		},
	};
}
