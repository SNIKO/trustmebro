import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

type State = Record<string, { lastMessageId: number }>;

export class TelegramState {
	private readonly filePath: string;
	private state: State = {};

	constructor(workspacePath: string) {
		this.filePath = path.join(
			workspacePath,
			".trustmebro",
			"index-telegram.yaml",
		);
	}

	async load(): Promise<void> {
		if (!existsSync(this.filePath)) {
			this.state = {};
			return;
		}

		try {
			const raw = await readFile(this.filePath, "utf8");
			this.state = YAML.parse(raw) ?? {};
		} catch {
			this.state = {};
		}
	}

	async save(): Promise<void> {
		const dir = path.dirname(this.filePath);
		await mkdir(dir, { recursive: true });

		const tempPath = `${this.filePath}.tmp`;
		const yaml = YAML.stringify(this.state);

		await writeFile(tempPath, yaml, "utf8");
		await writeFile(this.filePath, yaml, "utf8");
	}

	getLastMessageId(channelId: string): number {
		return this.state[channelId]?.lastMessageId ?? 0;
	}

	async markIndexed(channelId: string, messageId: number): Promise<void> {
		if (!this.state[channelId]) {
			this.state[channelId] = { lastMessageId: messageId };
		} else if (messageId > this.state[channelId].lastMessageId) {
			this.state[channelId].lastMessageId = messageId;
		}
		await this.save();
	}
}
