import pc from "picocolors";
import type { SourceId } from "../config.js";
import { getSourceLogo } from "./source-styles.js";

export type StatusBarWorkItem = {
	sourceId: SourceId;
	publisherId?: string;
	title: string;
};

export type SourceCountEntry = { fetched: number; processed: number };
export type SourceCounts = Record<string, SourceCountEntry>;

export class StatusBar {
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private fetching: Array<{ key: string; item: StatusBarWorkItem }> = [];
	private indexing: Array<{ key: string; item: StatusBarWorkItem }> = [];
	private listing: Array<{
		key: string;
		sourceId: SourceId;
		publisherId: string;
	}> = [];
	private sourceCounts: SourceCounts = {};
	private failedBySource: Record<string, Set<string>> = {};
	private stats = {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
	};
	private spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private isRunning = false;
	private lastRenderLines = 0;

	start() {
		if (this.isRunning) return;
		this.isRunning = true;
		this.timer = setInterval(() => {
			this.render();
		}, 80);
	}

	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.isRunning = false;
		this.clearRenderedBlock();
	}

	addFetchingItem(key: string, item: StatusBarWorkItem) {
		this.fetching.push({ key, item });
		this.ensureRunning();
		this.render();
	}

	removeFetchingItem(key: string) {
		this.removeItem(this.fetching, key);
	}

	addIndexingItem(key: string, item: StatusBarWorkItem) {
		this.indexing.push({ key, item });
		this.ensureRunning();
		this.render();
	}

	removeIndexingItem(key: string) {
		this.removeItem(this.indexing, key);
	}

	addListingItem(key: string, sourceId: SourceId, publisherId: string) {
		this.listing.push({ key, sourceId, publisherId });
		this.ensureRunning();
		this.render();
	}

	removeListingItem(key: string) {
		this.removeItem(this.listing, key);
	}

	markProcessingFailed(sourceId: SourceId, itemId: string) {
		if (!this.failedBySource[sourceId]) {
			this.failedBySource[sourceId] = new Set();
		}
		this.failedBySource[sourceId]?.add(itemId);
		this.ensureRunning();
		this.render();
	}

	markProcessingSucceeded(sourceId: SourceId, itemId: string) {
		const failedSet = this.failedBySource[sourceId];
		if (failedSet?.has(itemId)) {
			failedSet.delete(itemId);
			if (failedSet.size === 0) {
				delete this.failedBySource[sourceId];
			}
			this.ensureRunning();
			this.render();
		}
	}

	private removeItem(
		list: typeof this.fetching | typeof this.indexing | typeof this.listing,
		key: string,
	) {
		const idx = list.findIndex((x) => x.key === key);
		if (idx >= 0) list.splice(idx, 1);
		this.render();
	}

	updateStats(stats: Partial<typeof this.stats>) {
		this.stats = { ...this.stats, ...stats };
		this.ensureRunning();
		this.render();
	}

	updateSourceCounts(counts: SourceCounts) {
		this.sourceCounts = counts;
		this.ensureRunning();
		this.render();
	}

	addTokens(input: number, output: number) {
		this.stats.inputTokens += input;
		this.stats.outputTokens += output;
		this.stats.totalTokens += input + output;
		this.ensureRunning();
		this.render();
	}

	log(msg: string) {
		this.clearRenderedBlock();
		// Write the log message
		process.stdout.write(msg);
		// Ensure newline if missing (pino-pretty usually adds it, but let's be safe)
		if (!msg.endsWith("\n")) {
			process.stdout.write("\n");
		}
		// Redraw status bar
		this.render();
	}

	private ensureRunning() {
		if (!this.isRunning) {
			this.start();
		}
	}

	private clearRenderedBlock() {
		if (this.lastRenderLines > 1) {
			process.stdout.write(`\x1b[${this.lastRenderLines - 1}A`);
		}
		process.stdout.write("\r\x1b[J");
		this.lastRenderLines = 0;
	}

	private render() {
		if (!this.isRunning) {
			return;
		}

		this.frame++;
		const spinner = pc.cyan(this.spinners[this.frame % this.spinners.length]);

		const sourceStatsParts: string[] = [];
		const sources = new Set([
			...Object.keys(this.sourceCounts),
			...Object.keys(this.failedBySource),
		]);

		for (const source of sources) {
			const count = this.sourceCounts[source] ?? { fetched: 0, processed: 0 };
			const failed = this.failedBySource[source]?.size ?? 0;
			const pending = Math.max(0, count.fetched - count.processed - failed);
			const unprocessedPaths: string[] = [];

			if (pending > 0) {
				unprocessedPaths.push(
					`${pc.yellow(String(pending))} ${pc.dim("pending")}`,
				);
			}

			if (failed > 0) {
				unprocessedPaths.push(`${pc.red(String(failed))} ${pc.dim("failed")}`);
			}

			const unprocessedString =
				unprocessedPaths.length > 0
					? ` ${pc.dim("(")}${unprocessedPaths.join(", ")}${pc.dim(")")}`
					: "";

			sourceStatsParts.push(
				`${pc.dim(source)}: ${pc.green(String(count.fetched))}${unprocessedString}`,
			);
		}

		const sourceStatsStr =
			sourceStatsParts.length > 0
				? `${sourceStatsParts.join(pc.dim(" | "))}`
				: "";

		const inVal = this.formatNumber(this.stats.inputTokens);
		const outVal = this.formatNumber(this.stats.outputTokens);
		const totVal = this.formatNumber(this.stats.totalTokens);

		const tIn = `${pc.dim("Input:")} ${pc.blue(inVal)}`;
		const tOut = `${pc.dim("Output:")} ${pc.yellow(outVal)}`;
		const tTotal = `${pc.dim("Total:")} ${pc.white(totVal)}`;

		const right = `${sourceStatsStr}  │  ${tIn}  ${tOut}  ${tTotal}`;

		const cols = process.stdout.columns || 80;
		const lines: string[] = [];

		for (const { sourceId, publisherId } of this.listing) {
			lines.push(
				this.renderListingLine({ spinner, sourceId, publisherId, cols }),
			);
		}

		for (const { item } of this.fetching) {
			lines.push(
				this.renderWorkLine({ spinner, action: "fetching", item, cols }),
			);
		}

		for (const { item } of this.indexing) {
			lines.push(
				this.renderWorkLine({ spinner, action: "indexing", item, cols }),
			);
		}

		// Stats line is always present and pinned right.
		lines.push(this.renderRightAlignedLine({ right, cols }));

		this.clearRenderedBlock();
		process.stdout.write(lines.join("\n"));
		this.lastRenderLines = lines.length;
	}

	private renderListingLine(args: {
		spinner: string;
		sourceId: SourceId;
		publisherId: string;
		cols: number;
	}): string {
		const { spinner, sourceId, publisherId, cols } = args;
		const logo = getSourceLogo(sourceId);
		const publisherDisplay = pc.bold(pc.white(publisherId));

		const raw = `${spinner} ${pc.green("fetching items")} ${logo}  ${publisherDisplay}`;
		return this.truncateToCols(raw, cols);
	}

	private renderWorkLine(args: {
		spinner: string;
		action: "fetching" | "indexing";
		item: StatusBarWorkItem;
		cols: number;
	}): string {
		const { spinner, action, item, cols } = args;
		const logo = getSourceLogo(item.sourceId);
		const publisherId = item.publisherId
			? pc.white(item.publisherId)
			: pc.dim("(unknown)");
		const color = action === "fetching" ? pc.green : pc.blue;
		const title = this.truncate(item.title.trim().replace(/\s+/g, " "), 120);

		const raw = `${spinner} ${color(action)} ${logo}  ${publisherId} '${color(title)}'`;
		return this.truncateToCols(raw, cols);
	}

	private renderRightAlignedLine(args: {
		right: string;
		cols: number;
	}): string {
		const { right, cols } = args;
		const rightLen = this.stripAnsi(right).length;
		const paddingLen = Math.max(0, cols - rightLen);
		return " ".repeat(paddingLen) + right;
	}

	private truncateToCols(str: string, cols: number): string {
		const visible = this.stripAnsi(str);
		if (visible.length <= cols) return str;
		return str.slice(0, Math.max(0, cols - 1));
	}

	private formatNumber(num: number): string {
		if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
		if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
		return num.toString();
	}

	private truncate(str: string, max: number): string {
		if (str.length <= max) return str;
		return `${str.slice(0, max - 3)}...`;
	}

	private stripAnsi(str: string): string {
		return str.replace(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes
			/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
			"",
		);
	}
}

export const statusBar = new StatusBar();
