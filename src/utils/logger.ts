import type {
	DocumentProcessingCompletedEvent,
	ErrorEvent,
	ProcessingRunCompletedEvent,
	ProcessingRunStartedEvent,
} from "greptor";
import pc from "picocolors";
import pino from "pino";
import pretty from "pino-pretty";
import type { SourceId } from "../config.js";

export type SourceLogContext = {
	sourceId: SourceId;
	publisherId: string;
};

export type LogStats = {
	total: number;
	indexed: number;
	skipped: number;
	failed: number;
};

type SourceStyle = {
	logo: string;
	color: (text: string) => string;
};

const sourceStyles: Record<SourceId, SourceStyle> = {
	youtube: { logo: "▶️", color: pc.red },
	twitter: { logo: "🐦", color: pc.cyan },
	telegram: { logo: "✈️", color: pc.blue },
	reddit: { logo: "👽", color: pc.yellow },
};

const fallbackStyle: SourceStyle = { logo: "📡", color: pc.magenta };

const stream = pretty({
	colorize: true,
	translateTime: "HH:MM:ss",
	ignore: "pid,hostname",
	messageFormat: "{msg}",
	singleLine: true,
});

export const logger = pino(
	{
		level: process.env.LOG_LEVEL ?? "info",
	},
	stream,
);

export function createStats(total: number): LogStats {
	return { total, indexed: 0, skipped: 0, failed: 0 };
}

export function logSourceStart(context: SourceLogContext): void {
	logger.info(`${formatPrefix(context)} starting`);
}

export function logSourceComplete(
	context: SourceLogContext,
	note?: string,
): void {
	const suffix = note ? ` ${pc.dim(`(${note})`)}` : "";
	logger.info(`${formatPrefix(context)} complete${suffix}`);
}

export function logSourceFound(
	context: SourceLogContext,
	total: number,
	newCount: number,
): void {
	const newLabel = newCount > 0 ? pc.green(`${newCount} new`) : pc.dim("0 new");
	const totalLabel = pc.dim(`${total} total`);
	logger.info(
		`${formatPrefix(context)} found ${newLabel} items | ${totalLabel}`,
	);
}

export function logItemResult(args: {
	context: SourceLogContext;
	status: "fetched" | "skipped" | "error";
	title: string;
	reason?: string;
}): void {
	const { context, status, title, reason } = args;
	const statusLabel = formatStatus(status);
	const detail = reason ? ` ${pc.dim(`(${reason})`)}` : "";
	const message = `${formatPrefix(context)} ${statusLabel} ${formatTitle(
		title,
	)}${detail}`;

	if (status === "error") {
		logger.warn(message);
	} else {
		logger.info(message);
	}
}

export function logGreptorRunStarted(event: ProcessingRunStartedEvent): void {
	logger.info(`${pc.magenta("🧠")} Documents processing started`);
}

export function logGreptorRunCompleted(
	event: ProcessingRunCompletedEvent,
): void {
	const elapsed = pc.dim(`in ${formatDuration(event.elapsedMs)}`);
	logger.info(`${pc.magenta("🧠")} Documents processing completed ${elapsed}`);
}

export function logGreptorDocumentCompleted(
	event: DocumentProcessingCompletedEvent,
): void {
	const prefix = formatGreptorPrefix(event.source, event.publisher);
	const status = event.success ? pc.green("processed") : pc.red("failed");
	const elapsed = pc.dim(`in ${formatDuration(event.elapsedMs)}`);
	const line = `${prefix} ${status} ${formatTitle(event.label)} ${elapsed}`;

	if (event.success) {
		logger.info(line);
	} else {
		logger.warn(line);
	}
}

export function logGreptorError(event: ErrorEvent): void {
	const message = event.error?.message ?? String(event.error);
	const prefix = formatGreptorPrefix(
		event.context?.source,
		event.context?.publisher,
	);
	const label = event.context?.label
		? ` ${formatTitle(event.context.label)}`
		: "";
	const ref = event.context?.ref ? ` ${pc.dim(event.context.ref)}` : "";
	logger.error(`${prefix} error${label}${ref} ${pc.dim(message)}`);
}

function formatPrefix(context: SourceLogContext): string {
	const style = sourceStyles[context.sourceId] ?? fallbackStyle;
	const logo = style.color(style.logo);
	const publisher = pc.bold(pc.white(context.publisherId));
	return `${logo}  ${publisher}`;
}

function formatGreptorPrefix(source?: string, publisher?: string): string {
	const style =
		source && source in sourceStyles
			? sourceStyles[source as SourceId]
			: fallbackStyle;
	const logo = style.color(style.logo);
	const publisherLabel = pc.bold(pc.white(publisher));
	return `${logo}  ${publisherLabel}`;
}

function formatTitle(title: string): string {
	const cleaned = title.trim().replace(/\s+/g, " ");
	const short = cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
	if (!short) {
		return pc.dim("'(untitled)'");
	}
	return pc.cyan(`'${short}'`);
}

function formatStatus(status: "fetched" | "skipped" | "error"): string {
	switch (status) {
		case "fetched":
			return pc.green("fetched");
		case "skipped":
			return pc.yellow("skipped");
		case "error":
			return pc.red("failed");
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}
