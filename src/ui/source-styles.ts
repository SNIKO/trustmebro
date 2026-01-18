import type { SourceId } from "../config.js";

export const sourceStyles: Record<SourceId, string> = {
	youtube: "▶️",
	twitter: "🐦",
	telegram: "✈️",
	reddit: "👽",
};

export const getSourceLogo = (sourceId: SourceId): string => {
	return sourceStyles[sourceId] || sourceId;
};
