import { createRedditSource } from "./reddit/index.js";
import { createTelegramSource } from "./telegram/telegram.js";
import type { Source } from "./types.js";
import { createYoutubeSource } from "./youtube/index.js";

export function buildSources(): Source[] {
	const youtube = createYoutubeSource();

	const reddit = createRedditSource();
	const telegram = createTelegramSource();

	return [youtube, reddit, telegram].filter(
		(source): source is Source => source !== null,
	);
}
