import {
	type LogContext,
	log,
	logFetchingItemsCompleted,
	logFetchingItemsStarted,
} from "../../ui/logger.js";
import type { Source, SourceContext } from "../types.js";
import { hasYtDlp, listVideos } from "./fetch.js";
import { processVideo } from "./process.js";
import { YouTubeState } from "./state.js";

export function createYoutubeSource(): Source | null {
	if (!hasYtDlp()) {
		log.error(
			"yt-dlp is required for youtube source. Install it from https://github.com/yt-dlp/yt-dlp#installation",
			{ source: "youtube" },
		);
		return null;
	}

	return {
		sourceId: "youtube",

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const ctx: LogContext = {
				source: "youtube",
				publisher: publisherId,
			};
			const state = new YouTubeState(context.workspacePath);
			await state.load();

			logFetchingItemsStarted("youtube", publisherId);
			const videos = await listVideos(publisherId);
			logFetchingItemsCompleted("youtube", publisherId);
			const newVideos = videos.filter(
				(v) =>
					v.id &&
					!state.contains(publisherId, v.id) &&
					!state.isSkipped(publisherId, v.id),
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
						log.info(`Fetched '${result.title ?? title}'`, ctx);
						break;
					case "skipped":
						log.info(`Skipped '${result.title ?? title}'`, ctx, {
							reason: result.reason ?? "unknown",
						});
						if (result.reason === "before-start-date") {
							return;
						}
						break;
					case "error":
						log.error(
							`Failed '${result.title ?? title}' (${result.reason ?? "unknown error"})`,
							ctx,
						);
						break;
				}
			}
		},
	};
}
