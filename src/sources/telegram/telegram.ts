import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import input from "input";
import { TelegramClient } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { createLogger } from "../../utils/logger.js";
import type { Source, SourceContext } from "../types.js";
import { TelegramState } from "./state.js";

const log = createLogger("telegram");

const SESSION_FILE = "telegram-session.txt";

type TelegramMessage = {
	id: number;
	date: number;
	message?: string;
};

let unhandledRejectionHandlerInstalled = false;

async function loadSession(workspacePath: string): Promise<string> {
	const filePath = path.join(workspacePath, ".trustmebro", SESSION_FILE);
	if (!existsSync(filePath)) return "";
	return (await fs.readFile(filePath, "utf8")).trim();
}

async function saveSession(workspacePath: string, session: string): Promise<void> {
	const dir = path.join(workspacePath, ".trustmebro");
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, SESSION_FILE), session, "utf8");
}

function resolveCredentials(sessionString: string): {
	apiId: number;
	apiHash: string;
	sessionString: string;
} | null {
	const apiIdRaw = process.env.TELEGRAM_API_ID;
	const apiHash = process.env.TELEGRAM_API_HASH;

	if (!apiIdRaw || !apiHash || !sessionString) return null;

	const apiId = Number(apiIdRaw);
	if (!Number.isInteger(apiId) || apiId <= 0) return null;

	return { apiId, apiHash, sessionString };
}

async function createClient(creds: { apiId: number; apiHash: string; sessionString: string }): Promise<TelegramClient> {
	const client = new TelegramClient(new StringSession(creds.sessionString), creds.apiId, creds.apiHash, {
		connectionRetries: 5,
		baseLogger: new Logger(LogLevel.NONE),
	});

	await client.connect();

	if (!unhandledRejectionHandlerInstalled) {
		unhandledRejectionHandlerInstalled = true;
		process.on("unhandledRejection", (reason) => {
			if (reason instanceof Error && reason.message === "TIMEOUT") {
				return;
			}
			throw reason;
		});
	}

	client.onError = async (error) => {
		if (error.message === "TIMEOUT") return;
		throw error;
	};

	return client;
}

async function authenticateTelegram(workspacePath: string): Promise<boolean> {
	const sessionString = await loadSession(workspacePath);
	if (sessionString) return true;

	const creds = resolveCredentials("");
	if (!creds) return false;

	try {
		const stringSession = new StringSession("");
		const client = new TelegramClient(stringSession, creds.apiId, creds.apiHash, {
			connectionRetries: 5,
		});

		await client.start({
			phoneNumber: async () => await input.text("Enter your phone number (with country code): "),
			password: async () => await input.text("Enter your 2FA password (if any): "),
			phoneCode: async () => await input.text("Enter the code you received: "),
			onError: (err) => {
				if (err.message !== "TIMEOUT") throw err;
			},
		});

		const session = stringSession.save();
		await saveSession(workspacePath, session);

		await client.disconnect();
		return true;
	} catch {
		return false;
	}
}

async function fetchMessages(
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

			results.push({
				id: msg.id,
				date: msg.date,
				message: msg.message,
			});
		}

		if (batch.length < batchSize) break;
		const last = batch[batch.length - 1];
		if (!last) break;
		offsetId = last.id;
	}

	return results;
}

async function getChannelSubscriberCount(client: TelegramClient, channelId: string): Promise<number | null> {
	try {
		const fullChannel = await client.invoke(
			new Api.channels.GetFullChannel({
				channel: channelId,
			}),
		);

		if (fullChannel.fullChat instanceof Api.ChannelFull) {
			return fullChannel.fullChat.participantsCount ?? null;
		}

		return null;
	} catch {
		return null;
	}
}

const URL_REGEX = /https?:\/\/[^\s<>"'\]\)]+/g;

function extractUrls(text: string): string[] {
	return [...new Set(text.match(URL_REGEX) ?? [])];
}

async function buildReferenceBlocks(urls: string[]): Promise<string> {
	if (urls.length === 0) return "";
	const refs = await Promise.all(
		urls.map(async (url) => {
			const result = await fetchUrlContent(url);
			if (!result) return null;
			return `<reference name="${result.name}" url="${url}">\n${result.content}\n</reference>`;
		}),
	);
	const validRefs = refs.filter((r): r is string => r !== null);
	return validRefs.length > 0 ? "\n\n" + validRefs.join("\n\n") : "";
}

async function fetchUrlContent(url: string): Promise<{ name: string; content: string } | null> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 10_000);
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": "Mozilla/5.0 (compatible; TrustMeBro/1.0)" },
		});
		clearTimeout(timer);
		if (!response.ok) return null;
		const html = await response.text();
		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		const name = titleMatch?.[1]?.trim() ?? url;
		return { name, content: html.slice(0, 50_000) };
	} catch {
		return null;
	}
}


async function processMessage(
	context: SourceContext,
	channelId: string,
	msg: TelegramMessage,
	state: TelegramState,
	subscriberCount: number | null | undefined,
): Promise<void> {
	const publishedAt = new Date(msg.date * 1000);
	if (publishedAt < context.domainConfig.startDate) return;

	const text = msg.message?.trim() ?? "";

	if (text.length < 100) {
		log.debug(`Ignoring short message ${msg.id} from @${channelId} (${text.length} chars)`);
		return;
	}

	const title = text.slice(0, 80).replace(/\n/g, " ").trim() || `Message ${msg.id}`;

	try {
		// Fetch referenced URLs and append as <reference> blocks
		const urls = extractUrls(text);
		if (urls.length > 0) {
			log.debug(`Fetching ${urls.length} URL(s) for message '${title}' from @${channelId}`);
		}
		const referenceBlocks = await buildReferenceBlocks(urls);

		const finalContent = text + referenceBlocks;

		const label = text.slice(0, 80).replace(/\n/g, " ").trim();
		const handle = channelId.startsWith("@") ? channelId : `@${channelId}`;
		const messageUrl = `https://t.me/${handle.slice(1)}/${msg.id}`;

		const result = await context.engine.add({
			domain: context.domain,
			id: String(msg.id),
			label,
			source: "telegram",
			publisher: channelId,
			creationDate: publishedAt,
			overwrite: false,
			content: finalContent,
			tags: {
				channelUsername: channelId,
				messageUrl,
				messageId: msg.id,
				...(subscriberCount !== null && subscriberCount !== undefined ? { subscriberCount } : {}),
			},
		});

		if (result.success) {
			log.debug(`Indexed message: '${label}' from @${channelId}`);
			await state.markIndexed(channelId, msg.id);
		} else {
			log.error(`Failed to index message '${label}' from @${channelId}: ${result.message}`);
		}
	} catch (error) {
		log.error(`Error processing message '${title}' from @${channelId}: ${error}`);
	}
}

export function createTelegramSource(): Source {
	return {
		sourceId: "telegram",
		authenticate: authenticateTelegram,

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const sessionString = await loadSession(context.workspacePath);
			const creds = resolveCredentials(sessionString);
			if (!creds) return;

			const state = new TelegramState(context.workspacePath);
			await state.load();

			const lastMessageId = state.getLastMessageId(publisherId);
			let indexedCount = 0;

			log.info(`Fetching @${publisherId} messages`);

			const client = await createClient(creds);
			try {
				const updatedSession = (client.session as StringSession).save();
				await saveSession(context.workspacePath, updatedSession);

				const subscriberCount = await getChannelSubscriberCount(client, publisherId);

				const messages = await fetchMessages(client, publisherId, context.domainConfig.startDate, lastMessageId);

				if (messages.length === 0) {
					log.info(`No new messages for @${publisherId}`);
					return;
				}

				log.info(`Fetched ${messages.length} new messages from @${publisherId}`);

				const ordered = messages.slice().sort((a, b) => a.id - b.id);
				for (const msg of ordered) {
					try {
						await processMessage(context, publisherId, msg, state, subscriberCount);
						indexedCount++;
						log.info(`Processed ${indexedCount}/${messages.length} messages for @${publisherId}`);
					} catch (error) {
						log.error(
							`Failed to index message for @${publisherId}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				log.info(`Completed @${publisherId} (${indexedCount} items)`);
			} finally {
				await client.disconnect();
			}
		},
	};
}
