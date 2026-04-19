import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
	type LogContext,
	log,
	logFetchingItemsCompleted,
	logFetchingItemsStarted,
} from "../../ui/logger.js";
import type { Source, SourceContext } from "../types.js";
import {
	createClient,
	fetchMessages,
	type TelegramCredentials,
} from "./fetch.js";
import { groupMessages, processMessageGroup } from "./process.js";
import { TelegramState } from "./state.js";

const SESSION_FILE = "telegram-session.txt";

async function loadSession(workspacePath: string): Promise<string> {
	const filePath = path.join(workspacePath, ".trustmebro", SESSION_FILE);
	if (!existsSync(filePath)) return "";
	return (await readFile(filePath, "utf8")).trim();
}

async function saveSession(
	workspacePath: string,
	session: string,
): Promise<void> {
	const dir = path.join(workspacePath, ".trustmebro");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, SESSION_FILE), session, "utf8");
}

function resolveCredentials(sessionString: string): TelegramCredentials | null {
	const apiIdRaw = process.env.TELEGRAM_API_ID;
	const apiHash = process.env.TELEGRAM_API_HASH;

	if (!apiIdRaw || !apiHash) {
		log.error(
			"Telegram credentials not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables.",
			{ source: "telegram" },
		);
		return null;
	}

	if (!sessionString) {
		log.error(
			`Telegram session not found. Run the auth script to generate a session and save it to .trustmebro/${SESSION_FILE}.`,
			{ source: "telegram" },
		);
		return null;
	}

	const apiId = Number(apiIdRaw);
	if (!Number.isInteger(apiId) || apiId <= 0) {
		log.error("TELEGRAM_API_ID must be a positive integer.", {
			source: "telegram",
		});
		return null;
	}

	return { apiId, apiHash, sessionString };
}

async function authenticateTelegram(workspacePath: string): Promise<boolean> {
	const sessionString = await loadSession(workspacePath);
	if (sessionString) {
		log.info("Telegram session found", { source: "telegram" });
		return true;
	}

	const apiIdRaw = process.env.TELEGRAM_API_ID;
	const apiHash = process.env.TELEGRAM_API_HASH;

	if (!apiIdRaw || !apiHash) {
		log.error(
			"Telegram credentials not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables.",
			{ source: "telegram" },
		);
		return false;
	}

	const apiId = Number(apiIdRaw);
	if (!Number.isInteger(apiId) || apiId <= 0) {
		log.error("TELEGRAM_API_ID must be a positive integer.", {
			source: "telegram",
		});
		return false;
	}

	log.info("Telegram authentication required", { source: "telegram" });

	try {
		const stringSession = new StringSession("");
		const client = new TelegramClient(stringSession, apiId, apiHash, {
			connectionRetries: 5,
		});

		await client.start({
			phoneNumber: async () =>
				await input.text("Enter your phone number (with country code): "),
			password: async () =>
				await input.text("Enter your 2FA password (if any): "),
			phoneCode: async () => await input.text("Enter the code you received: "),
			onError: (err) => console.log(err),
		});

		log.info("✅ Logged in to Telegram!", { source: "telegram" });

		const session = client.session.save();
		await saveSession(workspacePath, session);

		log.info("Session saved successfully", { source: "telegram" });

		await client.disconnect();
		return true;
	} catch (error) {
		log.error(
			`Telegram authentication failed: ${error instanceof Error ? error.message : String(error)}`,
			{ source: "telegram" },
		);
		return false;
	}
}

export function createTelegramSource(): Source {
	return {
		sourceId: "telegram",
		authenticate: authenticateTelegram,

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const ctx: LogContext = { source: "telegram", publisher: publisherId };

			const sessionString = await loadSession(context.workspacePath);
			const creds = resolveCredentials(sessionString);
			if (!creds) return;

			const state = new TelegramState(context.workspacePath);
			await state.load();

			const lastMessageId = state.getLastMessageId(publisherId);

			logFetchingItemsStarted("telegram", publisherId);
			const client = await createClient(creds);
			try {
				// Persist the (possibly refreshed) session so it survives across runs
				const updatedSession = (client.session as StringSession).save();
				await saveSession(context.workspacePath, updatedSession);

				const messages = await fetchMessages(
					client,
					publisherId,
					context.config.startDate,
					lastMessageId,
				);
				logFetchingItemsCompleted("telegram", publisherId);

				// Process oldest-first so lastMessageId advances monotonically
				const ordered = messages.slice().sort((a, b) => a.id - b.id);
				const groups = groupMessages(ordered);

				for (const group of groups) {
					const result = await processMessageGroup({
						context,
						channelId: publisherId,
						group,
						state,
					});

					switch (result.status) {
						case "indexed":
							log.info(`Fetched '${result.title ?? result.groupId}'`, ctx);
							break;
						case "skipped":
							for (const message of group.messages) {
								const title = message.message
									? message.message.slice(0, 80).replace(/\n/g, " ").trim()
									: String(message.id);
								log.info(`Skipped post '${title}'`, ctx, {
									reason: result.reason ?? "unknown",
								});
							}
							break;
						case "error":
							log.error(
								`Failed group ${result.groupId} (${result.reason ?? "unknown error"})`,
								ctx,
							);
							break;
					}
				}
			} finally {
				await client.disconnect();
			}
		},
	};
}
