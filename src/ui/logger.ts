import { Writable } from "node:stream";
import type {
	DocumentProcessingCompletedEvent,
	DocumentProcessingStartedEvent,
} from "greptor";
import pc from "picocolors";
import pino from "pino";
import pretty from "pino-pretty";
import type { SourceId } from "../config.js";
import { getSourceLogo } from "./source-styles.js";
import { statusBar } from "./status-bar.js";

export type SourceLogContext = {
	sourceId: SourceId;
	publisherId: string;
};

export type LogStats = {
	total: number;
	indexed: number;
	fetched: number;
	skipped: number;
	failed: number;
};

export type Action = "fetched" | "indexed" | "skipped" | "failed";

const stream = pretty({
	colorize: true,
	translateTime: false,
	ignore: "pid,hostname,time,messageFormat,level",
	messageFormat: "{msg}",
	singleLine: true,
	destination: new Writable({
		write(chunk, _encoding, callback) {
			statusBar.log(chunk.toString());
			callback();
		},
	}),
});

export const logger = pino(
	{
		level: process.env.LOG_LEVEL ?? "info",
		serializers: {
			err: pino.stdSerializers.err,
			error: pino.stdSerializers.err,
		},
	},
	stream,
);

export function logFetchingItemsStarted(
	source: SourceId,
	publisherId: string,
): void {
	const key = `${source}:${publisherId}:listing`;
	statusBar.addListingItem(key, source, publisherId);
}

export function logFetchingItemsCompleted(
	source: SourceId,
	publisherId: string,
): void {
	const key = `${source}:${publisherId}:listing`;
	statusBar.removeListingItem(key);
}

export function logItemFetched(args: {
	context: SourceLogContext;
	action: Action;
	title: string;
	reason?: string;
}): void {
	const { context, action, title, reason } = args;

	const color = getColor(action);
	const dimColor = getDimColor(action);

	const time = new Date().toLocaleTimeString("en-US", { hour12: false });
	const logo = getSourceLogo(context.sourceId);
	const publisher = pc.white(context.publisherId);
	const actionLabel = color(action.toLowerCase());
	const message = formatItemTitle(action, title);
	const detail = reason ? ` ${dimColor(`(${reason})`)}` : "";

	const line = `${time} ${actionLabel} ${logo}  ${publisher} ${message}${detail}`;

	if (action === "failed") {
		logger.warn(line);
	} else {
		logger.info(line);
	}
}

export function logIndexingItemStarted(
	event: DocumentProcessingStartedEvent,
): void {
	const key = `${event.source}:${event.publisher ?? ""}:${event.label}`;
	statusBar.addIndexingItem(key, {
		sourceId: event.source as SourceId,
		publisherId: event.publisher,
		title: event.label,
	});
	statusBar.updateStats({ queue: event.queueSize });
}

export function logIndexingItemCompleted(
	event: DocumentProcessingCompletedEvent,
): void {
	const key = `${event.source}:${event.publisher ?? ""}:${event.label}`;
	statusBar.removeIndexingItem(key);
	statusBar.addTokens(event.inputTokens, event.outputTokens);
	statusBar.updateStats({ queue: event.queueSize });

	const action = event.success ? "indexed" : "failed";
	const color = getColor(action);
	const dimColor = getDimColor(action);

	const time = new Date().toLocaleTimeString("en-US", { hour12: false });
	const logo = getSourceLogo(event.source as SourceId);
	const publisher = pc.white(event.publisher ?? "");
	const actionLabel = color(action.toLowerCase());
	const message = formatItemTitle(action, event.label);
	const tokens = `${dimColor("[input_tokens: ")}${color(String(event.inputTokens))} ${dimColor("output_tokens: ")}${color(String(event.outputTokens))}${dimColor("]")}`;
	const elapsed = `${dimColor("in ")}${color(formatDuration(event.elapsedMs))}`;

	const line = `${time} ${actionLabel} ${logo}  ${publisher} ${message} ${elapsed} ${tokens}`;

	if (event.success) {
		logger.info(line);
	} else {
		logger.warn(line);
	}
}

function formatItemTitle(action: Action, title: string): string {
	const cleaned = title.trim().replace(/\s+/g, " ");
	const short = cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
	if (!short) {
		return pc.dim("'(untitled)'");
	}
	return getColor(action)(`'${short}'`);
}

function getColor(action: Action): (text: string) => string {
	return (text: string) => {
		switch (action) {
			case "fetched":
				return pc.green(text);
			case "skipped":
				return pc.dim(pc.yellow(text));
			case "failed":
				return pc.red(text);
			case "indexed":
				return pc.blue(text);
			default:
				return text;
		}
	};
}

function getDimColor(action: Action): (text: string) => string {
	return (text: string) => {
		return pc.dim(getColor(action)(text));
	};
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}
