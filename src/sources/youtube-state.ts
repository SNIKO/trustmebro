import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const stateSchema = z
	.record(z.string(), z.array(z.string()).default([]))
	.default({});

type State = z.infer<typeof stateSchema>;

export class YouTubeState {
	readonly filePath: string;
	private state: State = {};

	constructor(workspacePath: string) {
		this.filePath = path.join(workspacePath, "index-youtube.yaml");
	}

	async load(): Promise<void> {
		if (!existsSync(this.filePath)) {
			this.state = {};
			return;
		}

		const raw = await readFile(this.filePath, "utf8");
		const parsed = YAML.parse(raw);
		this.state = stateSchema.parse(parsed);
	}

	contains(channelId: string, videoId: string): boolean {
		const channelIndex = this.state[channelId];
		return channelIndex ? channelIndex.includes(videoId) : false;
	}

	async markIndexed(channelId: string, videoId: string): Promise<void> {
		if (!this.state[channelId]) {
			this.state[channelId] = [];
		}

		this.state[channelId].push(videoId);
		await this.persist();
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
}
