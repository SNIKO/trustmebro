import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
	id: number;
	timestamp: Date;
	level: LogLevel;
	context: string;
	message: string;
};

export interface LogReporter {
	log(record: LogRecord): void;
}

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

let nextLogId = 1;
let activeReporter: LogReporter = {
	log(record): void {
		console.log(formatLogRecord(record));
	},
};

export function setLogReporter(reporter: LogReporter): void {
	activeReporter = reporter;
}

export function resetLogReporter(): void {
	activeReporter = {
		log(record): void {
			console.log(formatLogRecord(record));
		},
	};
}

export function formatLogRecord(record: LogRecord): string {
	const timestamp = record.timestamp.toLocaleTimeString("en-US", { hour12: false });
	const levelColor = {
		debug: pc.gray,
		info: pc.blue,
		warn: pc.yellow,
		error: pc.red,
	}[record.level];
	const contextColor = BRAND_COLORS[record.context] || pc.white;
	const paddedLevel = record.level.padEnd(LEVEL_COL_WIDTH);
	const paddedContext = record.context.padEnd(CONTEXT_COL_WIDTH);

	return `${pc.dim(timestamp)} ${levelColor(paddedLevel)} ${contextColor(paddedContext)} ${highlight(record.message, record.context)}`;
}

function highlight(text: string, context: string): string {
	let result = text;
	PATTERNS.forEach(({ regex, color }) => {
		result = result.replace(regex, (match) => color(match));
	});

	result = highlightPublisher(result, context);
	return result;
}

function highlightPublisher(text: string, context: string): string {
	const pattern = /(@[\w.]+|r\/[\w.]+)/g;
	const colorFn = BRAND_COLORS[context] || pc.cyan;
	return text.replace(pattern, (match) => pc.dim(colorFn(match)));
}

function log(level: LogLevel, context: string, message: string): void {
	activeReporter.log({
		id: nextLogId++,
		timestamp: new Date(),
		level,
		context,
		message,
	});
}

export interface Logger {
	debug(msg: string): void;
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
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
	};
}
