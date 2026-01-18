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

const actionConfig = {
	fetched: { label: "fetched", color: pc.green },
	skipped: { label: "skipped", color: pc.yellow },
	failed: { label: " failed", color: pc.red },
	indexed: { label: "indexed", color: pc.blue },
} as const;

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
	status: Action;
	title: string;
	reason?: string;
}): void {
	const { context, status, title, reason } = args;
	const time = new Date().toLocaleTimeString("en-US", { hour12: false });
	const logo = getSourceLogo(context.sourceId);
	const publisher = pc.white(context.publisherId);
	const action = formatAction(status);
	const message = formatItemTitle(title, getColorForAction(status));
	const dimColor = getDimColorForAction(status);
	const detail = reason ? ` ${dimColor(`(${reason})`)}` : "";

	const line = `${time} ${action} ${logo}  ${publisher} ${message}${detail}`;

	if (status === "failed") {
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

	const time = new Date().toLocaleTimeString("en-US", { hour12: false });
	const logo = getSourceLogo(event.source as SourceId);
	const publisher = pc.white(event.publisher ?? "");
	const action = event.success ? "indexed" : "failed";
	const statusLabel = formatAction(action);
	const color = getColorForAction(action);
	const dimColor = getDimColorForAction(action);
	const message = formatItemTitle(event.label, color);
	const tokens = `${dimColor("[input_tokens: ")}${color(String(event.inputTokens))} ${dimColor("output_tokens: ")}${color(String(event.outputTokens))}${dimColor("]")}`;
	const elapsed = `${dimColor("in ")}${color(formatDuration(event.elapsedMs))}`;

	const line = `${time} ${statusLabel} ${logo}  ${publisher} ${message} ${elapsed} ${tokens}`;

	if (event.success) {
		logger.info(line);
	} else {
		logger.warn(line);
	}
}

function formatItemTitle(
	title: string,
	color: (text: string) => string = pc.cyan,
): string {
	const cleaned = title.trim().replace(/\s+/g, " ");
	const short = cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
	if (!short) {
		return pc.dim("'(untitled)'");
	}
	return color(`'${short}'`);
}

function formatAction(status: Action): string {
	return actionConfig[status].color(actionConfig[status].label);
}

function getColorForAction(status: Action): (text: string) => string {
	return actionConfig[status].color;
}

function getDimColorForAction(action: Action): (text: string) => string {
	const color = actionConfig[action].color;
	return (text: string) => pc.dim(color(text));
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}
