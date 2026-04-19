import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { TelegramMessage } from "./types.js";

export type TelegramCredentials = {
	apiId: number;
	apiHash: string;
	sessionString: string;
};

/**
 * Create and connect a TelegramClient. Caller is responsible for disconnecting.
 */
export async function createClient(
	creds: TelegramCredentials,
): Promise<TelegramClient> {
	const client = new TelegramClient(
		new StringSession(creds.sessionString),
		creds.apiId,
		creds.apiHash,
		{ connectionRetries: 5 },
	);
	await client.connect();

	// Suppress TIMEOUT errors from the update loop
	client.onError = async (error) => {
		if (error.message === "TIMEOUT") {
			return;
		}
		throw error;
	};

	return client;
}

/**
 * Fetch messages from a channel posted on or after `startDate`.
 * Iterates pages (newest-first) until a message older than startDate is seen.
 */
export async function fetchMessages(
	client: TelegramClient,
	channelId: string,
	startDate: Date,
	sinceMessageId: number,
): Promise<TelegramMessage[]> {
	const startTimestamp = Math.floor(startDate.getTime() / 1000);
	const results: TelegramMessage[] = [];
	const batchSize = 100;
	let offsetId = 0;

	while (true) {
		const batch = await client.getMessages(channelId, {
			limit: batchSize,
			offsetId,
			minId: sinceMessageId,
		});

		if (batch.length === 0) break;

		for (const msg of batch) {
			if (msg.date < startTimestamp) return results;
			results.push({ id: msg.id, date: msg.date, message: msg.message });
		}

		if (batch.length < batchSize) break;
		const last = batch[batch.length - 1];
		if (!last) break;
		offsetId = last.id;
	}

	return results;
}

/**
 * Build the public URL for a Telegram channel message.
 */
export function buildMessageUrl(
	channelUsername: string,
	messageId: number,
): string {
	const handle = channelUsername.startsWith("@")
		? channelUsername.slice(1)
		: channelUsername;
	return `https://t.me/${handle}/${messageId}`;
}
