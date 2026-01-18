import pc from "picocolors";

export type StatusBarStats = {
	queue: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
};

export type StatusBarWorkItem = {
	source: string;
	publisher?: string;
	title: string;
};

type WorkKey = string;

export class StatusBar {
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private fetching: Array<{ key: WorkKey; item: StatusBarWorkItem }> = [];
	private indexing: Array<{ key: WorkKey; item: StatusBarWorkItem }> = [];
	private stats: StatusBarStats = {
		queue: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
	};
	private spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private isRunning = false;
	private startTime = Date.now();
	private lastRenderLines = 0;

	constructor() {
		// Hide cursor
		process.stdout.write("\x1b[?25l");
		// Restore cursor on exit
		process.on("exit", () => {
			process.stdout.write("\x1b[?25h\n");
		});
	}

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

	setFetchingItems(items: StatusBarWorkItem[]) {
		this.fetching = items.map((item) => ({
			key: this.defaultKey(item),
			item,
		}));
		this.ensureRunning();
		this.render();
	}

	setIndexingItems(items: StatusBarWorkItem[]) {
		this.indexing = items.map((item) => ({
			key: this.defaultKey(item),
			item,
		}));
		this.ensureRunning();
		this.render();
	}

	addFetchingItem(key: string, item: StatusBarWorkItem) {
		this.fetching.push({ key, item });
		this.ensureRunning();
		this.render();
	}

	removeFetchingItem(key: string) {
		const idx = this.fetching.findIndex((x) => x.key === key);
		if (idx >= 0) this.fetching.splice(idx, 1);
		this.render();
	}

	addIndexingItem(key: string, item: StatusBarWorkItem) {
		this.indexing.push({ key, item });
		this.ensureRunning();
		this.render();
	}

	removeIndexingItem(key: string) {
		const idx = this.indexing.findIndex((x) => x.key === key);
		if (idx >= 0) this.indexing.splice(idx, 1);
		this.render();
	}

	updateStats(stats: Partial<StatusBarStats>) {
		this.stats = { ...this.stats, ...stats };
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
		if (this.lastRenderLines === 0) {
			// Still ensure we clear the current line if something else wrote over it.
			process.stdout.write("\x1b[2K\r");
			return;
		}
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

		const qVal = this.stats.queue.toString().padStart(3, " ");
		const q = pc.bold(pc.magenta(`Queue: ${qVal}`));

		const inVal = this.formatNumber(this.stats.inputTokens);
		const outVal = this.formatNumber(this.stats.outputTokens);
		const totVal = this.formatNumber(this.stats.totalTokens);

		const tIn = `${pc.dim("Input:")} ${pc.blue(inVal)}`;
		const tOut = `${pc.dim("Output:")} ${pc.yellow(outVal)}`;
		const tTotal = `${pc.dim("Total:")} ${pc.white(totVal)}`;

		const right = `${q}  │  ${tIn}  ${tOut}  ${tTotal}`;

		const cols = process.stdout.columns || 80;
		const lines: string[] = [];

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

	private renderWorkLine(args: {
		spinner: string;
		action: "fetching" | "indexing";
		item: StatusBarWorkItem;
		cols: number;
	}): string {
		const { spinner, action, item, cols } = args;
		const source = pc.dim(item.source);
		const publisher = item.publisher
			? pc.bold(pc.white(item.publisher))
			: pc.dim("(unknown)");
		const title = pc.cyan(
			this.truncate(item.title.trim().replace(/\s+/g, " "), 120),
		);

		const raw = `${spinner} ${action} ${source} ${publisher} ${title}`;
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
		// Very simple truncation: keep left side, drop tail.
		// Note: ANSI-aware truncation is more complex; titles are already truncated to keep this stable.
		return str.slice(0, Math.max(0, cols - 1));
	}

	private defaultKey(item: StatusBarWorkItem): string {
		return `${item.source}:${item.publisher ?? ""}:${item.title}`;
	}

	private formatNumber(num: number): string {
		if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
		if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
		return num.toString();
	}

	private truncate(str: string, max: number): string {
		if (str.length <= max) return str;
		return str.slice(0, max - 3) + "...";
	}

	private stripAnsi(str: string): string {
		return str.replace(
			/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
			"",
		);
	}
}

export const statusBar = new StatusBar();
