import type { Source, SourceContext } from "../types.js";
import { hasYtDlp, listVideos } from "./fetch.js";
import { processVideo } from "./process.js";
import { YouTubeState } from "./state.js";

export function createYoutubeSource(): Source | null {
	if (!hasYtDlp()) {
		console.error(
			"[youtube] yt-dlp is required for youtube source. Install it from https://github.com/yt-dlp/yt-dlp#installation",
		);
		return null;
	}

	return {
		sourceId: "youtube",

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const state = new YouTubeState(context.workspacePath);
			await state.load();

			const videos = await listVideos(publisherId);
			const newVideos = videos.filter(
				(v) => v.id && !state.contains(publisherId, v.id),
			);

			console.log(
				`[youtube] ${publisherId}: found ${videos.length} videos, ${newVideos.length} new to index`,
			);

			for (const entry of newVideos) {
				if (!entry.id) continue;

				const result = await processVideo({
					context,
					publisherId,
					entry,
					state,
				});

				switch (result.status) {
					case "indexed":
						console.log(
							`[youtube] indexed ${result.videoId}: ${result.title ?? "(no title)"}`,
						);
						break;
					case "skipped":
						console.log(
							`[youtube] skipped ${result.videoId}: ${result.reason ?? "unknown reason"}`,
						);
						if (result.reason === "before-start-date") {
							return;
						}
						break;
					case "error":
						console.warn(
							`[youtube] failed ${result.videoId}: ${result.reason ?? "unknown error"}`,
						);
						break;
				}
			}
		},
	};
}
