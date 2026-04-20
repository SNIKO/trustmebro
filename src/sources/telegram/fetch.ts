import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TelegramClient } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import type { ImageInfo, TelegramMessage } from "./types.js";

let unhandledRejectionHandlerInstalled = false;

async function downloadImage(
	client: TelegramClient,
	_message: Api.Message,
	photo: Api.Photo,
	messageId: number,
	imageIndex: number,
): Promise<ImageInfo | null> {
	try {
		const tempDir = path.join(os.tmpdir(), "trustmebro-telegram");
		await fs.promises.mkdir(tempDir, { recursive: true });

		const filename = `telegram-${messageId}-${imageIndex}.jpg`;
		const filePath = path.join(tempDir, filename);

		const buffer = await client.downloadMedia(
			photo as unknown as Api.TypeMessageMedia,
		);
		if (!Buffer.isBuffer(buffer)) {
			console.warn(`Downloaded media for message ${messageId} is not a buffer`);
			return null;
		}
		if (buffer.length === 0) {
			console.warn(
				`Downloaded image for message ${messageId} is empty (0 bytes)`,
			);
			return null;
		}

		await fs.promises.writeFile(filePath, buffer);

		return {
			path: filePath,
			mimeType: "image/jpeg",
		};
	} catch (error) {
		console.warn(
			`Failed to download image for message ${messageId}:`,
			error instanceof Error ? error.message : String(error),
		);
		return null;
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

	if (message.media instanceof Api.MessageMediaDocument) {
		const media = message.media as Api.MessageMediaDocument;
		if (
			media.document instanceof Api.Document &&
			media.document.mimeType?.startsWith("image/")
		) {
			// Image documents are not currently supported
		}
	}

	return photos;
}

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
		{
			connectionRetries: 5,
			baseLogger: new Logger(LogLevel.NONE),
		},
	);

	await client.connect();

	// The library's timeout() helper can produce unhandled rejections when the
	// ping resolves just as the sleep timer fires (a race condition in gramjs).
	// Install a global handler once to suppress these harmless errors.
	if (!unhandledRejectionHandlerInstalled) {
		unhandledRejectionHandlerInstalled = true;
		process.on("unhandledRejection", (reason) => {
			if (reason instanceof Error && reason.message === "TIMEOUT") {
				return; // Suppress expected TIMEOUT rejections from gramjs ping loop
			}
			// Re-throw anything else to preserve proper error handling
			throw reason;
		});
	}

	// Suppress TIMEOUT errors from the error handler path too
	client.onError = async (error) => {
		if (error.message === "TIMEOUT") return;
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

			const photos = extractPhotos(msg);
			const images: ImageInfo[] = [];

			for (let i = 0; i < photos.length; i++) {
				const photo = photos[i];
				if (!photo) continue;

				const imageInfo = await downloadImage(client, msg, photo, msg.id, i);
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

/**
 * Fetch the subscriber count for a Telegram channel.
 * Returns null if the channel is not found or the count is not available.
 */
export async function getChannelSubscriberCount(
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
	} catch (error) {
		console.warn(
			`Failed to get subscriber count for channel ${channelId}:`,
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}
