import { z } from "zod";
import { BaseSourceState } from "../base-state.js";

const channelStateSchema = z.object({
	/** Highest message ID that has been successfully indexed */
	lastMessageId: z.number().default(0),
});

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
