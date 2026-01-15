import {
	logger,
	logItemResult,
	logSourceComplete,
	logSourceFound,
	type SourceLogContext,
} from "../../utils/logger.js";
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

			const videos = await listVideos(publisherId);
			const newVideos = videos.filter(
				(v) => v.id && !state.contains(publisherId, v.id),
			);

			logSourceFound(logContext, videos.length, newVideos.length);

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
						logItemResult({
							context: logContext,
							status: "fetched",
							title: result.title ?? title,
						});
						break;
					case "skipped":
						logItemResult({
							context: logContext,
							status: "skipped",
							title: result.title ?? title,
							reason: result.reason ?? "unknown reason",
						});
						if (result.reason === "before-start-date") {
							logSourceComplete(logContext, "reached start date");
							return;
						}
						break;
					case "error":
						logItemResult({
							context: logContext,
							status: "error",
							title: result.title ?? title,
							reason: result.reason ?? "unknown error",
						});
						break;
				}
			}

			logSourceComplete(logContext);
		},
	};
}
