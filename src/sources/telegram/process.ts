import type { SourceContext } from "../types.js";
import { buildMessageUrl } from "./fetch.js";
import type { TelegramState } from "./state.js";
import type { GroupRunResult, MessageGroup, TelegramMessage } from "./types.js";

/** Messages within this window (seconds) of the previous one belong to the same group */
const GROUP_WINDOW_SEC = 60 * 60; // 1 hour

/** Ignore groups whose combined text is shorter than this */
const MIN_GROUP_LENGTH = 100;

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
}): Promise<GroupRunResult> {
	const { context, channelId, group, state } = args;
	const first = group.messages[0] as TelegramMessage;
	const groupId = first.id;

	try {
		const publishedAt = new Date(first.date * 1000);
		if (publishedAt < context.config.startDate) {
			return { groupId, status: "skipped", reason: "before-start-date" };
		}

		const texts = group.messages
			.map((m) => m.message?.trim())
			.filter((t): t is string => !!t);

		const combinedText = texts.join("\n\n");
		if (combinedText.length < MIN_GROUP_LENGTH) {
			return { groupId, status: "skipped", reason: "too-short" };
		}

		const longestText = texts.reduce(
			(a, b) => (b.length > a.length ? b : a),
			texts[0] ?? "",
		);
		const label = longestText.slice(0, 80).replace(/\n/g, " ").trim();

		const handle = channelId.startsWith("@") ? channelId : `@${channelId}`;
		const messageUrl = buildMessageUrl(handle, groupId);

		const result = await context.engine.add({
			id: String(groupId),
			label,
			source: "telegram",
			publisher: channelId,
			creationDate: publishedAt,
			overwrite: false,
			content: combinedText,
			tags: {
				channelUsername: channelId,
				messageUrl,
				messageId: groupId,
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
