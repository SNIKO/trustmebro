// ANSI color codes for modern pastel colors
const ansiColors = {
	// Source colors (modern pastel)
	youtube: (text: string) => `\x1b[38;2;255;107;107m${text}\x1b[0m`, // #FF6B6B
	reddit: (text: string) => `\x1b[38;2;78;205;196m${text}\x1b[0m`, // #4ECDC4
	telegram: (text: string) => `\x1b[38;2;149;225;211m${text}\x1b[0m`, // #95E1D3
	twitter: (text: string) => `\x1b[38;2;221;160;221m${text}\x1b[0m`, // #DDA0DD

	// Status colors
	success: (text: string) => `\x1b[38;2;152;216;200m${text}\x1b[0m`, // #98D8C8
	error: (text: string) => `\x1b[38;2;255;107;107m${text}\x1b[0m`, // #FF6B6B
	warning: (text: string) => `\x1b[38;2;255;234;167m${text}\x1b[0m`, // #FFEAA7
	info: (text: string) => `\x1b[38;2;116;185;255m${text}\x1b[0m`, // #74B9FF
	summary: (text: string) => `\x1b[38;2;162;155;254m${text}\x1b[0m`, // #A29BFE

	// Utility colors
	dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
};

export const colors = ansiColors;

export function getSourceColor(source: string): (text: string) => string {
	switch (source) {
		case "youtube":
			return colors.youtube;
		case "reddit":
			return colors.reddit;
		case "telegram":
			return colors.telegram;
		case "twitter":
			return colors.twitter;
		default:
			return colors.info;
	}
}

export function getStatusColor(status: "success" | "error" | "warning" | "info" | "summary"): (text: string) => string {
	return colors[status];
}