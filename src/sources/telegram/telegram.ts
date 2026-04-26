import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { generateText } from "ai";
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

type ImageInfo = {
	path: string;
	mimeType: string;
};

type TelegramMessage = {
	id: number;
	date: number;
	message?: string;
	images?: ImageInfo[];
};

let unhandledRejectionHandlerInstalled = false;

async function loadSession(workspacePath: string): Promise<string> {
	const filePath = path.join(workspacePath, ".trustmebro", SESSION_FILE);
	if (!existsSync(filePath)) return "";
	return (await fs.readFile(filePath, "utf8")).trim();
}

async function saveSession(
	workspacePath: string,
	session: string,
): Promise<void> {
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

async function createClient(creds: {
	apiId: number;
	apiHash: string;
	sessionString: string;
}): Promise<TelegramClient> {
	const client = new TelegramClient(
		new StringSession(creds.sessionString),
		creds.apiId,
		creds.apiHash,
		{
			connectionRetries: 5,
			baseLogger: new Logger(LogLevel.NONE),
		},
	);

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
		const client = new TelegramClient(
			stringSession,
			creds.apiId,
			creds.apiHash,
			{
				connectionRetries: 5,
			},
		);

		await client.start({
			phoneNumber: async () =>
				await input.text("Enter your phone number (with country code): "),
			password: async () =>
				await input.text("Enter your 2FA password (if any): "),
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

function extractPhotos(message: Api.Message): Api.Photo[] {
	const photos: Api.Photo[] = [];

	if (message.photo instanceof Api.Photo) {
		photos.push(message.photo);
	}

	if (message.media instanceof Api.MessageMediaPhoto) {
		const media = message.media as Api.MessageMediaPhoto;
		if (media.photo instanceof Api.Photo) {
			photos.push(media.photo);
		}
	}

	if (message.media instanceof Api.MessageMediaWebPage) {
		const media = message.media as Api.MessageMediaWebPage;
		if (
			media.webpage instanceof Api.WebPage &&
			media.webpage.photo instanceof Api.Photo
		) {
			photos.push(media.webpage.photo);
		}
	}

	return photos;
}

async function downloadImage(
	client: TelegramClient,
	photo: Api.Photo,
	messageId: number,
	imageIndex: number,
): Promise<ImageInfo | null> {
	try {
		const tempDir = path.join(os.tmpdir(), "trustmebro-telegram");
		await fs.mkdir(tempDir, { recursive: true });

		const filename = `telegram-${messageId}-${imageIndex}.jpg`;
		const filePath = path.join(tempDir, filename);

		const buffer = await client.downloadMedia(
			photo as unknown as Api.TypeMessageMedia,
		);
		if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
			return null;
		}

		await fs.writeFile(filePath, buffer);

		return {
			path: filePath,
			mimeType: "image/jpeg",
		};
	} catch {
		return null;
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

			const photos = extractPhotos(msg);
			const images: ImageInfo[] = [];

			for (let i = 0; i < photos.length; i++) {
				const photo = photos[i];
				if (!photo) continue;

				const imageInfo = await downloadImage(client, photo, msg.id, i);
				if (imageInfo) {
					images.push(imageInfo);
				}
			}

			results.push({
				id: msg.id,
				date: msg.date,
				message: msg.message,
				images: images.length > 0 ? images : undefined,
			});
		}

		if (batch.length < batchSize) break;
		const last = batch[batch.length - 1];
		if (!last) break;
		offsetId = last.id;
	}

	return results;
}

async function getChannelSubscriberCount(
	client: TelegramClient,
	channelId: string,
): Promise<number | null> {
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

async function processImagesWithLLM(
	context: SourceContext,
	postText: string,
	images: ImageInfo[],
): Promise<string> {
	if (images.length === 0) return "";

	const imageData = await Promise.all(
		images.map(async (img) => {
			try {
				const buffer = await fs.readFile(img.path);
				if (buffer.length === 0) return null;
				const base64 = buffer.toString("base64");
				return `<img src="data:${img.mimeType};base64,${base64}" />`;
			} catch {
				return null;
			}
		}),
	);

	const validImageData = imageData.filter(
		(data): data is string => data !== null,
	);

	if (validImageData.length === 0) return "";

	const prompt = `Analyze these images in the context of the following post. Provide a concise summary of what the images show that's relevant to understanding the post content.

Post: ${postText}

Output a paragraph describing the key visual information that adds context to the post. Focus on information that helps understand the post's meaning, data, or context.`;

	const res = [];

	for (const img of validImageData) {
		try {
			const { text } = await generateText({
				model: context.model,
				prompt: `${prompt}\n\n${img}`,
			});

			res.push(text.trim());
		} catch {
			// Ignore individual image processing errors
		}
	}

	return res.join("\n");
}

async function processMessage(
	context: SourceContext,
	channelId: string,
	msg: TelegramMessage,
	state: TelegramState,
	subscriberCount: number | null | undefined,
	minLength: number,
): Promise<void> {
	const publishedAt = new Date(msg.date * 1000);
	if (publishedAt < context.config.startDate) return;

	const text = msg.message?.trim() ?? "";
	const title =
		text.slice(0, 80).replace(/\n/g, " ").trim() || `Message ${msg.id}`;
	const images = msg.images ?? [];

	try {
		let imageAnalysis = "";
		if (images.length > 0) {
			log.debug(
				`Processing ${images.length} images for message '${title}' from @${channelId}`,
			);
			imageAnalysis = await processImagesWithLLM(context, text, images);
			log.debug(
				`Image analysis complete for message '${title}' from @${channelId}: ${imageAnalysis.length} chars`,
			);
			for (const img of images) {
				try {
					await fs.unlink(img.path);
				} catch {
					// Ignore cleanup errors
				}
			}
		}

		const finalContent = imageAnalysis
			? `${text}\n\n[Image Analysis: ${imageAnalysis}]`
			: text;

		if (finalContent.length < minLength) {
			log.debug(
				`Ignoring message '${title}' from @${channelId} (${finalContent.length} chars)`,
			);
			return;
		}

		const label = text.slice(0, 80).replace(/\n/g, " ").trim();
		const handle = channelId.startsWith("@") ? channelId : `@${channelId}`;
		const messageUrl = `https://t.me/${handle.slice(1)}/${msg.id}`;

		const result = await context.engine.add({
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
				hasImages: images.length > 0,
				imageCount: images.length,
				...(subscriberCount !== null && subscriberCount !== undefined
					? { subscriberCount }
					: {}),
			},
		});

		if (result.success) {
			log.debug(`Indexed message: '${label}' from @${channelId}`);
			await state.markIndexed(channelId, msg.id);
		} else {
			log.error(
				`Failed to index message '${label}' from @${channelId}: ${result.message}`,
			);
		}
	} catch (error) {
		log.error(
			`Error processing message '${title}' from @${channelId}: ${error}`,
		);
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

				const subscriberCount = await getChannelSubscriberCount(
					client,
					publisherId,
				);

				const messages = await fetchMessages(
					client,
					publisherId,
					context.config.startDate,
					lastMessageId,
				);

				if (messages.length === 0) {
					log.info(`No new messages for @${publisherId}`);
					return;
				}

				log.info(
					`Fetched ${messages.length} new messages from @${publisherId})`,
				);

				const ordered = messages.slice().sort((a, b) => a.id - b.id);
				const minLength =
					context.config.sources.telegram?.minMessageLength ?? 200;

				for (const msg of ordered) {
					try {
						await processMessage(
							context,
							publisherId,
							msg,
							state,
							subscriberCount,
							minLength,
						);
						indexedCount++;
						log.info(
							`Processed ${indexedCount}/${messages.length} messages for @${publisherId}`,
						);
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
