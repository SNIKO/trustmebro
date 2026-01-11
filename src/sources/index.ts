import type { Source } from "./types.js";
import { createYoutubeSource } from "./youtube.js";

export function buildSources(): Source[] {
	const youtube = createYoutubeSource();
	if (!youtube) {
		console.warn("Youtube source can't be initialized, skipping");
	}

	return [
		youtube,
		// telegram, twitter, reddit sources will be added here
	].filter((source): source is Source => source !== null);
}
