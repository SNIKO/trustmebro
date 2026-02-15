import { log } from "../ui/logger.js";
import { createRedditSource } from "./reddit/index.js";
import type { Source } from "./types.js";
import { createYoutubeSource } from "./youtube/index.js";

export function buildSources(): Source[] {
	const youtube = createYoutubeSource();
	if (!youtube) {
		log.warn("YouTube source can't be initialized, skipping");
	}

	const reddit = createRedditSource();

	return [youtube, reddit].filter(
		(source): source is Source => source !== null,
	);
}
