import pc from "picocolors";

type LogLevel = "debug" | "info" | "warn" | "error";

const CONTEXT_COL_WIDTH = 10;
const LEVEL_COL_WIDTH = 5;

const BRAND_COLORS: Record<string, (text: string) => string> = {
	telegram: pc.cyan,
	youtube: pc.red,
	reddit: pc.green,
	commands: pc.blue,
	processor: pc.magenta,
};

const PATTERNS = [
	{ regex: /(\d{4}-\d{2}-\d{2})/g, color: pc.magenta },
	{ regex: /\b(\d+)\b/g, color: pc.yellow },
	{ regex: /'([^']+)'|"([^"]+)"/g, color: pc.green },
];

function highlight(text: string, context: string): string {
	let result = text;
	PATTERNS.forEach(({ regex, color }) => {
		result = result.replace(regex, (match) => color(match));
	});

	result = highlightPublisher(result, context);
	return result;
}

function highlightPublisher(text: string, context: string): string {
	const pattern = /(@[\w.]+)/g;
	const colorFn = BRAND_COLORS[context] || pc.cyan;
	return text.replace(pattern, (match) => pc.dim(colorFn(match)));
}

function log(level: LogLevel, context: string, message: string): void {
	const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
	const levelColor = {
		debug: pc.gray,
		info: pc.blue,
		warn: pc.yellow,
		error: pc.red,
	}[level];
	const contextColor = BRAND_COLORS[context] || pc.white;
	const paddedLevel = level.padEnd(LEVEL_COL_WIDTH);
	const paddedContext = context.padEnd(CONTEXT_COL_WIDTH);
	console.log(
		`${pc.dim(timestamp)} ${levelColor(paddedLevel)} ${contextColor(paddedContext)} ${highlight(message, context)}`,
	);
}

export interface Logger {
	debug(msg: string): void;
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
	success(msg: string): void;
	publisherStart(publisher: string, total: number): void;
	publisherComplete(publisher: string, processed: number, errors: number): void;
	processProgress(publisher: string, current: number, total: number): void;
}

export function createLogger(context: string): Logger {
	return {
		debug(msg: string): void {
			log("debug", context, msg);
		},
		info(msg: string): void {
			log("info", context, msg);
		},
		warn(msg: string): void {
			log("warn", context, msg);
		},
		error(msg: string): void {
			log("error", context, msg);
		},
		success(msg: string): void {
			log("info", context, msg);
		},
		publisherStart(publisher: string, total: number): void {
			log("info", context, `Fetching ${total} items for ${publisher}`);
		},
		publisherComplete(
			publisher: string,
			processed: number,
			errors: number,
		): void {
			if (errors === 0) {
				log("info", context, `Processed ${processed} items for ${publisher}`);
			} else {
				log(
					"warn",
					context,
					`Processed ${processed} items with ${errors} errors for ${publisher}`,
				);
			}
		},
		processProgress(publisher: string, current: number, total: number): void {
			log(
				"info",
				context,
				`Processing ${current}/${total} items for ${publisher}`,
			);
		},
	};
}
