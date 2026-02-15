import type {
	DocumentProcessingCompletedEvent,
	DocumentProcessingStartedEvent,
} from "greptor";
import pc from "picocolors";
import type { SourceId } from "../config.js";
import { statusBar } from "./status-bar.js";

// ── Types ──────────────────────────────────────────────────────────────

export type LogContext = {
	source?: SourceId;
	publisher?: string;
};

export type LogParams = Record<string, string | number>;

type LogLevel = "debug" | "info" | "warn" | "error";

// ── Level gating ───────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
	return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

// ── Formatting helpers ─────────────────────────────────────────────────

function timestamp(): string {
	return pc.dim(new Date().toLocaleTimeString("en-US", { hour12: false }));
}

function levelLabel(level: LogLevel): string {
	const tag = level.toUpperCase().padEnd(5);
	switch (level) {
		case "debug":
			return pc.dim(tag);
		case "info":
			return pc.gray(tag);
		case "warn":
			return pc.yellow(tag);
		case "error":
			return pc.red(tag);
	}
}

const COL_SOURCE = 10;
const COL_PUBLISHER = 15;

function sourceTag(source?: SourceId): string {
	if (!source) return "".padStart(COL_SOURCE);
	const label = `[${source}]`;
	return pc.cyan(label.padStart(COL_SOURCE));
}

function publisherTag(publisher?: string): string {
	if (!publisher) return "".padEnd(COL_PUBLISHER);
	const trimmed =
		publisher.length > COL_PUBLISHER
			? `${publisher.slice(0, COL_PUBLISHER - 3)}...`
			: publisher;
	return pc.magenta(trimmed.padEnd(COL_PUBLISHER));
}

function formatParams(params?: LogParams): string {
	if (!params || Object.keys(params).length === 0) return "";
	const pairs = Object.entries(params)
		.map(([k, v]) => `${pc.dim(`${k}:`)} ${pc.dim(pc.cyan(String(v)))}`)
		.join(" ");
	return `${pc.dim("[")}${pairs}${pc.dim("]")}`;
}

function truncateTitle(title: string, max = 120): string {
	const cleaned = title.trim().replace(/\s+/g, " ");
	if (!cleaned) return "(untitled)";
	return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

// ── Core write ─────────────────────────────────────────────────────────

function write(
	level: LogLevel,
	message: string,
	context?: LogContext,
	params?: LogParams,
): void {
	if (!shouldLog(level)) return;

	const parts: string[] = [
		timestamp(),
		levelLabel(level),
		sourceTag(context?.source),
		publisherTag(context?.publisher),
		message,
	];

	const p = formatParams(params);
	if (p) parts.push(p);

	statusBar.log(`${parts.join(" ")}\n`);
}

// ── Public API ─────────────────────────────────────────────────────────

export const log = {
	debug(msg: string, ctx?: LogContext, params?: LogParams): void {
		write("debug", msg, ctx, params);
	},
	info(msg: string, ctx?: LogContext, params?: LogParams): void {
		write("info", msg, ctx, params);
	},
	warn(msg: string, ctx?: LogContext, params?: LogParams): void {
		write("warn", msg, ctx, params);
	},
	error(msg: string, ctx?: LogContext, params?: LogParams): void {
		write("error", msg, ctx, params);
	},
};

// ── Status-bar integration (domain helpers) ────────────────────────────

export function logFetchingItemsStarted(
	source: SourceId,
	_publisherId: string,
): void {
	statusBar.startPublisher(source);
}

export function logFetchingItemsCompleted(
	source: SourceId,
	_publisherId: string,
): void {
	statusBar.completePublisher(source);
}

export function logIndexingItemStarted(
	event: DocumentProcessingStartedEvent,
): void {
	statusBar.updateSourceCounts(event.documentsCount);
}

export function logIndexingItemCompleted(
	event: DocumentProcessingCompletedEvent,
): void {
	const key = `${event.source}:${event.publisher ?? ""}:${event.label}`;
	const source = event.source as SourceId;
	const ctx: LogContext = {
		source,
		publisher: event.publisher ?? undefined,
	};

	if (event.success) {
		statusBar.markProcessingSucceeded(source, key);
		statusBar.addTokens(event.inputTokens, event.outputTokens);
		statusBar.updateSourceCounts(event.documentsCount);

		log.info(`Processed '${truncateTitle(event.label)}'`, ctx, {
			input_tokens: event.inputTokens,
			output_tokens: event.outputTokens,
			elapsed: formatDuration(event.elapsedMs),
		});
	} else {
		statusBar.markProcessingFailed(source, key);

		log.error(`Failed '${truncateTitle(event.label)}' (${event.error})`, ctx);
	}
}
