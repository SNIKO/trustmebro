import { z } from "zod";
import { BaseSourceState } from "../base-state.js";

const channelStateSchema = z.object({ lastMessageId: z.number() });
const stateSchema = z.record(z.string(), channelStateSchema).default({});

type State = z.infer<typeof stateSchema>;

export class TelegramState extends BaseSourceState<State> {
	protected schema = stateSchema;

	constructor(workspacePath: string) {
		super(workspacePath, "index-telegram.yaml");
	}

	protected getDefaultState(): State {
		return {};
	}

	private key(channelId: string): string {
		return channelId.toLowerCase();
	}

	getLastMessageId(channelId: string): number {
		return this.state[this.key(channelId)]?.lastMessageId ?? 0;
	}

	async markIndexed(channelId: string, messageId: number): Promise<void> {
		const id = this.key(channelId);
		const current = this.state[id]?.lastMessageId ?? 0;
		if (messageId <= current) return;
		this.state[id] = { lastMessageId: messageId };
		await this.save();
	}
}
