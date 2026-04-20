import * as fs from "node:fs/promises";
import { generateText } from "ai";
import type { SourceContext } from "../types.js";
import { buildMessageUrl } from "./fetch.js";
import type { TelegramState } from "./state.js";
import type {
	GroupRunResult,
	ImageInfo,
	MessageGroup,
	TelegramMessage,
} from "./types.js";

/** Messages within this window (seconds) of the previous one belong to the same group */
const GROUP_WINDOW_SEC = 60 * 60; // 1 hour

/** Ignore groups whose combined text is shorter than this */
const MIN_GROUP_LENGTH = 100;

const IMAGE_ANALYSIS_TEMPLATE = `Analyze these images in the context of the following post. Provide a concise summary of what the images show that's relevant to understanding the post content.

Post: {POST_TEXT}

Output a paragraph describing the key visual information that adds context to the post. Focus on information that helps understand the post's meaning, data, or context.`;

async function processImagesWithLLM(args: {
	context: SourceContext;
	postText: string;
	images: ImageInfo[];
}): Promise<string> {
	const { context, postText, images } = args;

	if (images.length === 0) return "";

	try {
		const imageData = await Promise.all(
			images.map(async (img) => {
				try {
					const buffer = await fs.readFile(img.path);
					if (buffer.length === 0) {
						console.warn(`[Telegram] Image file is empty: ${img.path}`);
						return null;
					}
					const base64 = buffer.toString("base64");
					return `<img src="data:${img.mimeType ?? "image/jpeg"};base64,${base64}" />`;
				} catch (error) {
					console.warn(
						`[Telegram] Failed to read image file ${img.path}:`,
						error instanceof Error ? error.message : String(error),
					);
					return null;
				}
			}),
		);

		const validImageData = imageData.filter(
			(data): data is string => data !== null,
		);

		if (validImageData.length === 0) {
			console.warn("[Telegram] No valid image data to process");
			return "";
		}

		const prompt = IMAGE_ANALYSIS_TEMPLATE.replace("{POST_TEXT}", postText);
		const contentWithImages = `${prompt}\n\n${imageData.join("\n")}`;

		const { text } = await generateText({
			model: context.model,
			prompt: contentWithImages,
		});

		return text.trim();
	} catch (error) {
		console.warn(
			"[Telegram] Failed to process images with LLM:",
			error instanceof Error ? error.message : String(error),
		);
		return "";
	}
}

async function cleanupImages(images: ImageInfo[]): Promise<void> {
	await Promise.all(
		images.map(async (img) => {
			try {
				await fs.unlink(img.path);
			} catch {
				// Ignore cleanup errors
			}
		}),
	);
}

/**
 * Group messages that are within GROUP_WINDOW_SEC of the previous one.
 * Input must be sorted oldest-first.
 */
export function groupMessages(messages: TelegramMessage[]): MessageGroup[] {
	const groups: MessageGroup[] = [];
	let current: TelegramMessage[] = [];

	for (const msg of messages) {
		if (current.length === 0) {
			current.push(msg);
			continue;
		}
		const prev = current[current.length - 1] as TelegramMessage;
		if (msg.date - prev.date <= GROUP_WINDOW_SEC) {
			current.push(msg);
		} else {
			groups.push({ messages: current });
			current = [msg];
		}
	}

	if (current.length > 0) groups.push({ messages: current });
	return groups;
}

export async function processMessageGroup(args: {
	context: SourceContext;
	channelId: string;
	group: MessageGroup;
	state: TelegramState;
	subscriberCount?: number | null;
}): Promise<GroupRunResult> {
	const { context, channelId, group, state, subscriberCount } = args;
	const first = group.messages[0] as TelegramMessage;
	const groupId = first.id;

	try {
		const publishedAt = new Date(first.date * 1000);
		if (publishedAt < context.config.startDate) {
			console.log(
				`[Telegram] Group ${groupId} skipped: before start date (${publishedAt.toISOString()})`,
			);
			return { groupId, status: "skipped", reason: "before-start-date" };
		}

		const texts = group.messages
			.map((m) => m.message?.trim())
			.filter((t): t is string => !!t);

		const combinedText = texts.join("\n\n");
		const allImages = group.messages.flatMap((m) => m.images ?? []);

		if (combinedText.length < MIN_GROUP_LENGTH) {
			return { groupId, status: "skipped", reason: "too-short" };
		}

		let imageAnalysis = "";
		if (allImages.length > 0) {
			imageAnalysis = await processImagesWithLLM({
				context,
				postText: combinedText,
				images: allImages,
			});

			await cleanupImages(allImages);
		}

		const longestText = texts.reduce(
			(a, b) => (b.length > a.length ? b : a),
			texts[0] ?? "",
		);
		const label = longestText.slice(0, 80).replace(/\n/g, " ").trim();

		const handle = channelId.startsWith("@") ? channelId : `@${channelId}`;
		const messageUrl = buildMessageUrl(handle, groupId);

		const finalContent = imageAnalysis
			? `${combinedText}\n\n[Image Analysis: ${imageAnalysis}]`
			: combinedText;

		const result = await context.engine.add({
			id: String(groupId),
			label,
			source: "telegram",
			publisher: channelId,
			creationDate: publishedAt,
			overwrite: false,
			content: finalContent,
			tags: {
				channelUsername: channelId,
				messageUrl,
				messageId: groupId,
				hasImages: allImages.length > 0,
				imageCount: allImages.length,
				...(subscriberCount !== null && subscriberCount !== undefined
					? { subscriberCount }
					: {}),
			},
		});

		if (!result.success) {
			return {
				groupId,
				status: "error",
				reason: "ingest-failed",
				title: label,
			};
		}

		// Advance the high-water mark to the last message in the group
		const lastId = (
			group.messages[group.messages.length - 1] as TelegramMessage
		).id;
		await state.markIndexed(channelId, lastId);
		return { groupId, status: "indexed", title: label };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return { groupId, status: "error", reason };
	}
}
