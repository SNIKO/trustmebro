import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { createLogger } from "../../utils/logger.js";
import type { Source, SourceContext } from "../types.js";
import {
	createClient,
	fetchMessages,
	getChannelSubscriberCount,
	loadSession,
	resolveApiCredentials,
	resolveRunCredentials,
	saveSession,
} from "./fetch.js";
import { processMessage } from "./process.js";
import { TelegramState } from "./state.js";

const log = createLogger("telegram");

export function createTelegramSource(): Source {
	return {
		sourceId: "telegram",
		authenticate: authenticateTelegram,
		runOnce: runTelegramOnce,
	};
}

async function authenticateTelegram(workspacePath: string): Promise<boolean> {
	const sessionString = await loadSession(workspacePath);
	if (sessionString) return true;

	const api = resolveApiCredentials();
	if (!api) return false;

	try {
		const stringSession = new StringSession("");
		const client = new TelegramClient(stringSession, api.apiId, api.apiHash, { connectionRetries: 5 });

		await client.start({
			phoneNumber: async () => input.text("Enter your phone number (with country code): "),
			password: async () => input.text("Enter your 2FA password (if any): "),
			phoneCode: async () => input.text("Enter the code you received: "),
			onError: (err) => {
				if (err.message !== "TIMEOUT") throw err;
			},
		});

		await saveSession(workspacePath, stringSession.save());
		await client.disconnect();
		return true;
	} catch {
		return false;
	}
}

async function runTelegramOnce(context: SourceContext, publisherId: string): Promise<void> {
	const sessionString = await loadSession(context.workspacePath);
	const creds = resolveRunCredentials(sessionString);
	if (!creds) return;

	const state = new TelegramState(context.workspacePath);
	await state.load();

	const lastMessageId = state.getLastMessageId(publisherId);

	log.info(`Fetching @${publisherId} messages`);

	const client = await createClient(creds);
	try {
		await saveSession(context.workspacePath, (client.session as StringSession).save());

		const subscriberCount = await getChannelSubscriberCount(client, publisherId);
		const messages = await fetchMessages(client, publisherId, context.domainConfig.startDate, lastMessageId);

		if (messages.length === 0) {
			log.info(`No new messages for @${publisherId}`);
			return;
		}

		log.info(`Fetched ${messages.length} new messages from @${publisherId}`);

		const ordered = messages.slice().sort((a, b) => a.id - b.id);
		let processedCount = 0;

		for (const msg of ordered) {
			try {
				await processMessage(context, publisherId, msg, state, subscriberCount);
				processedCount++;
				log.info(`Processed ${processedCount}/${messages.length} messages for @${publisherId}`);
			} catch (error) {
				log.error(
					`Failed to process message for @${publisherId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		log.info(`Completed @${publisherId} (${processedCount} items)`);
	} finally {
		await client.disconnect();
	}
}
