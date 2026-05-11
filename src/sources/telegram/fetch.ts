import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { TelegramClient } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";

const SESSION_FILE = "telegram-session.txt";

// Suppress spurious TIMEOUT rejections emitted by gramjs — they are safe to ignore
process.on("unhandledRejection", (reason) => {
	if (reason instanceof Error && reason.message === "TIMEOUT") return;
	throw reason;
});

export type ApiCredentials = { apiId: number; apiHash: string };
export type RunCredentials = ApiCredentials & { sessionString: string };
export type TelegramMessage = { id: number; date: number; message?: string };

export function resolveApiCredentials(): ApiCredentials | null {
	const apiIdRaw = process.env.TELEGRAM_API_ID;
	const apiHash = process.env.TELEGRAM_API_HASH;
	if (!apiIdRaw || !apiHash) return null;

	const apiId = Number(apiIdRaw);
	if (!Number.isInteger(apiId) || apiId <= 0) return null;

	return { apiId, apiHash };
}

export function resolveRunCredentials(sessionString: string): RunCredentials | null {
	const api = resolveApiCredentials();
	if (!api || !sessionString) return null;
	return { ...api, sessionString };
}

export async function loadSession(workspacePath: string): Promise<string> {
	const filePath = path.join(workspacePath, ".trustmebro", SESSION_FILE);
	if (!existsSync(filePath)) return "";
	return (await readFile(filePath, "utf8")).trim();
}

export async function saveSession(workspacePath: string, session: string): Promise<void> {
	const dir = path.join(workspacePath, ".trustmebro");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, SESSION_FILE), session, "utf8");
}

export async function createClient(creds: RunCredentials): Promise<TelegramClient> {
	const client = new TelegramClient(new StringSession(creds.sessionString), creds.apiId, creds.apiHash, {
		connectionRetries: 5,
		baseLogger: new Logger(LogLevel.NONE),
	});

	await client.connect();

	client.onError = async (error) => {
		if (error.message !== "TIMEOUT") throw error;
	};

	return client;
}

export async function fetchMessages(
	client: TelegramClient,
	channelId: string,
	startDate: Date,
	sinceMessageId: number,
): Promise<TelegramMessage[]> {
	const startTimestamp = Math.floor(startDate.getTime() / 1000);
	const messages: TelegramMessage[] = [];
	const batchSize = 100;
	let offsetId = 0;

	while (true) {
		const batch = await client.getMessages(channelId, { limit: batchSize, offsetId, minId: sinceMessageId });

		if (batch.length === 0) break;

		for (const msg of batch) {
			if (msg.date < startTimestamp) return messages;
			messages.push({ id: msg.id, date: msg.date, message: msg.message });
		}

		if (batch.length < batchSize) break;
		const last = batch[batch.length - 1];
		if (!last) break;
		offsetId = last.id;
	}

	return messages;
}

export async function getChannelSubscriberCount(client: TelegramClient, channelId: string): Promise<number | null> {
	try {
		const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: channelId }));

		if (fullChannel.fullChat instanceof Api.ChannelFull) {
			return fullChannel.fullChat.participantsCount ?? null;
		}

		return null;
	} catch {
		return null;
	}
}
