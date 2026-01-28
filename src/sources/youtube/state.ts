import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const stateSchema = z
	.record(z.string(), z.array(z.string()).default([]))
	.default({});

type State = z.infer<typeof stateSchema>;

const skippedStateSchema = z
	.record(z.string(), z.record(z.string(), z.string()).default({}))
	.default({});

type SkippedState = z.infer<typeof skippedStateSchema>;

export class YouTubeState {
	readonly filePath: string;
	readonly skippedFilePath: string;
	private state: State = {};
	private skippedState: SkippedState = {};

	constructor(workspacePath: string) {
		this.filePath = path.join(
			workspacePath,
			".trustmebro",
			"index-youtube.yaml",
		);
		this.skippedFilePath = path.join(
			workspacePath,
			".trustmebro",
			"skipped-youtube.yaml",
		);
	}

	async load(): Promise<void> {
		if (!existsSync(this.filePath)) {
			this.state = {};
		} else {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = YAML.parse(raw);
			this.state = stateSchema.parse(parsed);
		}

		if (!existsSync(this.skippedFilePath)) {
			this.skippedState = {};
			return;
		}

		const skippedRaw = await readFile(this.skippedFilePath, "utf8");
		const skippedParsed = YAML.parse(skippedRaw);
		this.skippedState = skippedStateSchema.parse(skippedParsed);
	}

	contains(channelId: string, videoId: string): boolean {
		const channelIndex = this.state[channelId];
		return channelIndex ? channelIndex.includes(videoId) : false;
	}

	isSkipped(channelId: string, videoId: string): boolean {
		return Boolean(this.skippedState[channelId]?.[videoId]);
	}

	getSkippedReason(channelId: string, videoId: string): string | null {
		return this.skippedState[channelId]?.[videoId] ?? null;
	}

	async markIndexed(channelId: string, videoId: string): Promise<void> {
		if (!this.state[channelId]) {
			this.state[channelId] = [];
		}

		this.state[channelId].push(videoId);
		await this.persist();
	}

	async markSkipped(
		channelId: string,
		videoId: string,
		reason: string,
	): Promise<void> {
		if (!this.skippedState[channelId]) {
			this.skippedState[channelId] = {};
		}

		this.skippedState[channelId][videoId] = reason;
		await this.persistSkipped();
	}

	private async persist(): Promise<void> {
		const dir = path.dirname(this.filePath);
		await mkdir(dir, { recursive: true });
		const tmp = `${this.filePath}.tmp`;
		const validated = stateSchema.parse(this.state);
		const serialized = YAML.stringify(validated);
		await writeFile(tmp, serialized, "utf8");
		await rename(tmp, this.filePath);
	}

	private async persistSkipped(): Promise<void> {
		const dir = path.dirname(this.skippedFilePath);
		await mkdir(dir, { recursive: true });
		const tmp = `${this.skippedFilePath}.tmp`;
		const validated = skippedStateSchema.parse(this.skippedState);
		const serialized = YAML.stringify(validated);
		await writeFile(tmp, serialized, "utf8");
		await rename(tmp, this.skippedFilePath);
	}
}
