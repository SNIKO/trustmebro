import { generateText, type LanguageModel } from "ai";
import YAML from "yaml";
import { createLogger, type Logger } from "../utils/logger.js";
import type { Storage } from "./storage.js";
import { getSource } from "./storage.js";
import type { DocumentRef, Tags } from "./types.js";

const log = createLogger("processing");

const PROCESSING_TEMPLATE = `# INSTRUCTIONS
Clean, chunk, and tag the raw content for **grep-based search** in the domain: {DOMAIN}.

## Core Principle
Optimize for **single-pass grep scanning**: a single grep hit should reveal what a chunk is about without reading other chunks.

## Objectives
- Remove noise and boilerplate: ads, sponsors, intros/outros, CTAs, repetitions, contact or social links, and sign-offs.
- Preserve **all meaning and factual detail exactly** (facts, names, dates, numbers, ranges, uncertainty, conditions, and meaningful URLs).
- Use **minimal wording** while keeping all information.
- Chunk the content into **semantic sections** (prefer fewer, richer chunks when possible; do not pad content to reach size targets).

## Output Format (Markdown only)

\`\`\`markdown
## 01 Short descriptive title for chunk 1
field_1=value_1,value_4
field_2=value_2
field_3=value_3
<cleaned, condensed content>

## 02 Short descriptive title for chunk 2
field_1=value_1
field_4=value_4
field_5=value_5,value_6
<cleaned, condensed content>
\`\`\`

## Tagging Rules
- Use ONLY fields defined in the SCHEMA (field names must exactly match schema).
- Do not invent new fields.
- Omit fields with no value.
- One tag field per line.
- DO NOT duplicate fields. For arrays, use comma-separated values.
- For enums, use only allowed enum values from the schema.
- Use ISO-8601 for dates (YYYY-MM-DD).
- Keep tag values grep-friendly: snake_case where appropriate, tickers/codes/symbols in UPPERCASE.
- Maintain tag order as per schema.

## Content Rules
- Output MUST be plain text or Markdown with simple formatting (headings, lists, bold/italic).
- Rewrite content to be token-efficient and grep-efficient without altering meaning.
- Split content into short paragraphs separated by blank lines.
- Each paragraph MUST be 1-3 sentences.
- Each sentence MUST be declarative and information-dense.
- Keep entities, tickers, and terms explicit; avoid pronouns.
- Normalize numbers (e.g., "1,000,000.00", "24%").
- Preserve uncertainty, ranges, and conditional statements exactly.
- Do not add interpretation, synthesis, or analysis.
- Preserve emotional tone and intent where relevant.
- Use scores and reaction metrics (likes, dislikes, upvotes, downvotes) to infer which posts or comments carry higher importance, agreement, disagreement, or emotional weight. Incorporate these signals when summarizing content and when determining how to break it into semantic chunks.

# TAG SCHEMA:
{TAG_SCHEMA}

# RAW CONTENT:
{CONTENT}`;

function buildPrompt(
	rawContent: string,
	domain: string,
	tagSchema: string,
	customPrompt?: string,
): string {
	if (customPrompt) {
		return customPrompt.replaceAll("{CONTENT}", rawContent);
	}
	return PROCESSING_TEMPLATE.replaceAll("{DOMAIN}", domain)
		.replaceAll("{TAG_SCHEMA}", tagSchema)
		.replaceAll("{CONTENT}", rawContent);
}

function renderDocument(tags: Tags, content: string): string {
	const doc = new YAML.Document(tags);
	YAML.visit(doc, {
		Seq(_, node) {
			if (node.items.every((item) => YAML.isScalar(item))) {
				node.flow = true;
			}
		},
	});
	const yaml = doc.toString({ lineWidth: 200 }).trimEnd();
	return `---\n${yaml}\n---\n\n${content.trim()}`;
}

function normalizePublisher(publisher: string): string {
	if (publisher.startsWith("@")) return publisher;
	return `@${publisher}`;
}

function resolveMetadata(
	ref: DocumentRef,
	tags?: Tags,
): { source: string; publisher?: string; label: string } {
	const parts = ref.split("/");
	const filename = parts.at(-1) ?? "";
	const sourceFromPath = parts[0] ?? "unknown";
	const publisherFromPath = parts.length > 3 ? parts[1] : undefined;
	const str = (v: unknown) =>
		typeof v === "string" && v.trim() ? v.trim() : undefined;

	const publisher = str(tags?.publisher) ?? publisherFromPath;
	return {
		source: str(tags?.source) ?? sourceFromPath,
		label: str(tags?.title) ?? filename.replace(/\.md$/, ""),
		publisher: publisher ? normalizePublisher(publisher) : undefined,
	};
}

export interface WorkerHandle {
	enqueue(ref: DocumentRef): void;
	waitForIdle(): Promise<void>;
	stop(): Promise<void>;
}

export function startWorkers(args: {
	storage: Storage;
	initialQueue: DocumentRef[];
	model: LanguageModel;
	domain: string;
	tagSchema: string;
	customPrompts?: Record<string, string>;
	concurrency?: number;
}): WorkerHandle {
	const { storage, model, domain, tagSchema, customPrompts } = args;
	const concurrency = Math.max(1, args.concurrency ?? 1);
	const queue = [...args.initialQueue];
	let stopping = false;
	let activeWorkers = 0;
	let totalProcessed = 0;
	let totalErrors = 0;
	const startTime = Date.now();
	const refWaiters: Array<(ref: DocumentRef | undefined) => void> = [];
	const idleWaiters: Array<() => void> = [];

	function resolveIdleWaiters(): void {
		if (activeWorkers !== 0 || queue.length !== 0) return;
		while (idleWaiters.length > 0) {
			idleWaiters.shift()?.();
		}
	}

	function takeNextRef(): Promise<DocumentRef | undefined> {
		const next = queue.shift();
		if (next) return Promise.resolve(next);
		if (stopping) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			refWaiters.push(resolve);
		});
	}

	async function processOne(ref: DocumentRef, logger: Logger): Promise<void> {
		let raw: { tags: Tags; content: string } | undefined;
		let readError: unknown;

		try {
			raw = await storage.readRaw(ref);
		} catch (e) {
			readError = e;
		}

		const meta = resolveMetadata(ref, raw?.tags);
		const start = Date.now();

		if (readError || !raw) {
			const message =
				readError instanceof Error
					? readError.message
					: String(readError ?? "Failed to read raw document");
			logger.error(`Failed to read document: ${message}`);
			return;
		}

		try {
			const source = getSource(ref);
			const prompt = buildPrompt(
				raw.content,
				domain,
				tagSchema,
				customPrompts?.[source],
			);

			logger.info(
				`Processing '${meta.label}' ${meta.publisher ?? "unknown"} (${meta.source})`,
			);

			const { text } = await generateText({ model, prompt });
			const elapsed = (Date.now() - start) / 1000;

			if (!text) {
				logger.error(
					`No text generated for ${meta.label} by LLM in ${elapsed.toFixed(2)}s - skipping document.`,
				);
				totalErrors++;
				return;
			}

			logger.info(
				`Processed '${meta.label}' (${elapsed.toFixed(0)}s, ${queue.length} remaining)`,
			);

			await storage.saveProcessed(ref, renderDocument(raw.tags, text));
			totalProcessed++;
		} catch (err) {
			logger.error(
				`Failed to process document '${meta.label}': ${err instanceof Error ? err.message : String(err)}`,
			);
			totalErrors++;
		}
	}

	async function workerLoop(index: number): Promise<void> {
		const workerLogger = createLogger(`worker-${index + 1}`);

		while (true) {
			const ref = await takeNextRef();
			if (!ref) {
				return;
			}

			activeWorkers++;

			await processOne(ref, workerLogger);

			activeWorkers--;
			resolveIdleWaiters();
		}
	}

	// Start worker loops
	log.info(`Starting ${concurrency} worker(s) for content enrichment...`);
	const workers = Array.from({ length: concurrency }, (_, index) =>
		workerLoop(index),
	);

	return {
		enqueue(ref) {
			if (stopping) return;
			const waiter = refWaiters.shift();
			if (waiter) {
				waiter(ref);
				return;
			}
			queue.push(ref);
			log.debug(`Enqueued document: '${ref}', queue length: ${queue.length}`);
		},

		async waitForIdle() {
			if (activeWorkers === 0 && queue.length === 0) return;
			await new Promise<void>((resolve) => {
				idleWaiters.push(resolve);
			});
		},

		async stop() {
			stopping = true;
			while (refWaiters.length > 0) {
				refWaiters.shift()?.(undefined);
			}
			await Promise.all(workers);
			const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
			log.info(
				`Completed ${totalProcessed} documents, ${totalErrors} errors (${totalTime}s)`,
			);
		},
	};
}
