import pc from "picocolors";
import type { SourceId } from "../config.js";

export type SourceCountEntry = { fetched: number; processed: number };
export type SourceCounts = Record<string, SourceCountEntry>;

export class StatusBar {
	// Line 1: fetch progress per source (disappears when done)
	private fetchTotals: Partial<Record<SourceId, number>> = {};
	private fetchCompleted: Partial<Record<SourceId, number>> = {};
	private fetchActive: Partial<Record<SourceId, number>> = {};

	// Line 2: always-visible processing stats + tokens
	private sourceCounts: SourceCounts = {};
	private failedBySource: Record<string, Set<string>> = {};
	private stats = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

	// Internals
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
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

	setFetchTotals(totals: Partial<Record<SourceId, number>>) {
		this.fetchTotals = { ...totals };
		this.fetchCompleted = {};
		this.fetchActive = {};
		for (const source of Object.keys(this.fetchTotals)) {
			this.fetchCompleted[source as SourceId] = 0;
			this.fetchActive[source as SourceId] = 0;
		}
		this.ensureRunning();
		this.render();
	}

	startPublisher(sourceId: SourceId) {
		this.fetchActive[sourceId] = (this.fetchActive[sourceId] ?? 0) + 1;
		this.ensureRunning();
		this.render();
	}

	completePublisher(sourceId: SourceId) {
		const active = this.fetchActive[sourceId] ?? 0;
		if (active > 0) this.fetchActive[sourceId] = active - 1;
		this.fetchCompleted[sourceId] = (this.fetchCompleted[sourceId] ?? 0) + 1;
		this.render();
	}

	updateSourceCounts(counts: SourceCounts) {
		this.sourceCounts = counts;
		this.ensureRunning();
		this.render();
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

	addTokens(input: number, output: number) {
		this.stats.inputTokens += input;
		this.stats.outputTokens += output;
		this.stats.totalTokens += input + output;
		this.ensureRunning();
		this.render();
	}

	log(msg: string) {
		this.clearRenderedBlock();
		process.stdout.write(msg);
		if (!msg.endsWith("\n")) {
			process.stdout.write("\n");
		}
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
		if (!this.isRunning) return;

		this.frame++;
		const spinner = pc.cyan(this.spinners[this.frame % this.spinners.length]);
		const cols = process.stdout.columns || 80;
		const lines: string[] = [];

		// Line 1 per source: fetch progress (only while fetching)
		for (const source of Object.keys(this.fetchTotals)) {
			const completed = this.fetchCompleted[source as SourceId] ?? 0;
			const active = this.fetchActive[source as SourceId] ?? 0;
			const total = this.fetchTotals[source as SourceId] ?? 0;
			if (total <= 0 || completed >= total) continue;

			const current = Math.min(total, completed + active);
			const unit = this.getFetchUnit(source, total);
			lines.push(
				this.renderFetchProgressLine({
					spinner,
					sourceId: source as SourceId,
					current,
					total,
					unit,
					cols,
				}),
			);
		}

		// Always-visible stats line: documents per source + token usage
		const sourceStatsParts: string[] = [];
		const sources = new Set([
			...Object.keys(this.sourceCounts),
			...Object.keys(this.failedBySource),
		]);

		for (const source of sources) {
			const count = this.sourceCounts[source] ?? { fetched: 0, processed: 0 };
			const failed = this.failedBySource[source]?.size ?? 0;
			const pending = Math.max(0, count.fetched - count.processed - failed);
			const details: string[] = [];

			if (pending > 0) {
				details.push(`${pc.yellow(String(pending))} ${pc.dim("pending")}`);
			}
			if (failed > 0) {
				details.push(`${pc.red(String(failed))} ${pc.dim("failed")}`);
			}

			const detailStr =
				details.length > 0
					? ` ${pc.dim("(")}${details.join(", ")}${pc.dim(")")}`
					: "";

			sourceStatsParts.push(
				`${pc.dim(source)}: ${pc.green(String(count.fetched))}${detailStr}`,
			);
		}

		const sourceStatsStr =
			sourceStatsParts.length > 0 ? sourceStatsParts.join(pc.dim(" | ")) : "";

		const tIn = `${pc.dim("Input:")} ${pc.blue(this.formatNumber(this.stats.inputTokens))}`;
		const tOut = `${pc.dim("Output:")} ${pc.yellow(this.formatNumber(this.stats.outputTokens))}`;
		const tTotal = `${pc.dim("Total:")} ${pc.white(this.formatNumber(this.stats.totalTokens))}`;
		const right = `${sourceStatsStr}  │  ${tIn}  ${tOut}  ${tTotal}`;

		lines.push(this.renderRightAlignedLine({ right, cols }));

		this.clearRenderedBlock();
		process.stdout.write(lines.join("\n"));
		this.lastRenderLines = lines.length;
	}

	private renderFetchProgressLine(args: {
		spinner: string;
		sourceId: SourceId;
		current: number;
		total: number;
		unit: string;
		cols: number;
	}): string {
		const { spinner, sourceId, current, total, unit, cols } = args;
		const sourceLabel = pc.bold(pc.white(sourceId));
		const currentLabel = pc.green(String(current));
		const totalLabel = pc.dim(String(total));
		const unitLabel = pc.dim(unit);
		const counts = `${pc.dim("(")}${currentLabel}${pc.dim("/")}${totalLabel} ${unitLabel}${pc.dim(")")}`;

		const raw = `${spinner} ${pc.cyan("fetching")} ${sourceLabel} ${counts}`;
		return this.truncateToCols(raw, cols);
	}

	private getFetchUnit(sourceId: string, total: number): string {
		const plural = total !== 1;
		switch (sourceId) {
			case "youtube":
				return plural ? "channels" : "channel";
			case "reddit":
				return plural ? "subreddits" : "subreddit";
			case "twitter":
				return plural ? "accounts" : "account";
			case "telegram":
				return plural ? "channels" : "channel";
			default:
				return plural ? "publishers" : "publisher";
		}
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

	private stripAnsi(str: string): string {
		return str.replace(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes
			/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
			"",
		);
	}
}

export const statusBar = new StatusBar();
