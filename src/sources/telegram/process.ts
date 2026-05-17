import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { createLogger } from "../../utils/logger.js";
import type { SourceContext } from "../types.js";
import type { TelegramMessage } from "./fetch.js";
import type { TelegramState } from "./state.js";

const log = createLogger("telegram");

const URL_REGEX = /https?:\/\/[^\s<>"'\])]+/g;

export async function processMessage(
	context: SourceContext,
	channelId: string,
	msg: TelegramMessage,
	state: TelegramState,
	subscriberCount: number | null | undefined,
): Promise<void> {
	const publishedAt = new Date(msg.date * 1000);
	if (publishedAt < context.domainConfig.startDate) return;

	const text = msg.message?.trim() ?? "";

	const label = text.slice(0, 80).replace(/\n/g, " ").trim();
	const handle = channelId.startsWith("@") ? channelId : `@${channelId}`;
	const messageUrl = `https://t.me/${handle.slice(1)}/${msg.id}`;

	try {
		const content = await enrichWithReferences(text);
		if (content.length < 500) {
			log.debug(`Ignoring short message ${msg.id} from @${channelId} (${text.length} chars)`);
			return;
		}

		await ingestMessage({ context, channelId, msg, state, label, messageUrl, content, subscriberCount, publishedAt });
	} catch (error) {
		const title = label || `Message ${msg.id}`;
		log.error(`Error processing message '${title}' from @${channelId}: ${error}`);
	}
}

async function ingestMessage(args: {
	context: SourceContext;
	channelId: string;
	msg: TelegramMessage;
	state: TelegramState;
	label: string;
	messageUrl: string;
	content: string;
	publishedAt: Date;
	subscriberCount: number | null | undefined;
}): Promise<void> {
	const { context, channelId, msg, state, label, messageUrl, content, subscriberCount, publishedAt } = args;

	const indexResult = await context.engine.add({
		domain: context.domain,
		id: String(msg.id),
		label,
		source: "telegram",
		publisher: channelId,
		creationDate: publishedAt,
		content,
		tags: {
			channelUsername: channelId,
			messageUrl,
			messageId: msg.id,
			...(subscriberCount == null ? {} : { subscriberCount }),
		},
	});

	if (indexResult.success) {
		log.debug(`Indexed message: '${label}' from @${channelId}`);
		await state.markIndexed(channelId, msg.id);
		return;
	}

	log.error(`Failed to index message '${label}' from @${channelId}: ${indexResult.message}`);
}

async function enrichWithReferences(text: string): Promise<string> {
	const urls = extractUrls(text);
	if (urls.length === 0) return text;

	log.debug(`Fetching ${urls.length} URL(s) referenced in message`);

	const refBlocks = await Promise.all(
		urls.map(async (url) => {
			const page = await fetchUrlContent(url);
			if (!page) return null;
			return `<reference name="${page.name}" url="${url}">\n${page.content}\n</reference>`;
		}),
	);

	const validRefs = refBlocks.filter((r): r is string => r !== null);
	if (validRefs.length === 0) return text;
	return `${text}\n\n${validRefs.join("\n\n")}`;
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
		const { document } = parseHTML(html);
		const article = new Readability(document as any).parse();
		const name = article?.title?.trim() || url;
		const content = article?.textContent?.trim() ?? "";
		if (!content) return null;
		return { name, content: content.slice(0, 50_000) };
	} catch {
		return null;
	}
}

function extractUrls(text: string): string[] {
	const urlsToExclude = ["https://t.me/", "youtube", "bybit", "binance"];
	const urls = new Set(text.match(URL_REGEX) ?? []);
	const filtered = [...urls].filter((url) => !urlsToExclude.some((exclude) => url.includes(exclude)));
	return filtered;
}
