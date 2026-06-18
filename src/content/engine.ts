import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { APICallError } from "ai";

import { noopProgressReporter } from "../ui/events.js";
import { createLogger } from "../utils/logger.js";
import type { AddRequest, AddResult, ContentEngine, ContentEngineConfig, DomainEntry } from "./engine.types.js";
import { enrichDocument } from "./enricher.js";
import {
	type ClaimedEnrichmentTask,
	createPersistentEnrichmentQueue,
	type PendingEnrichmentTask,
} from "./persistent-queue.js";
import { writeRawDocument } from "./raw-writer.js";

const log = createLogger("content");

const BACKOFF_SCHEDULE_MS = [60_000, 300_000, 600_000] as const;

type RateLimiter = {
	waitIfThrottled(): Promise<void>;
	onRateLimit(): number;
	onSuccess(): void;
};

function createRateLimiter(): RateLimiter {
	let level = 0;
	let throttleUntil = 0;

	return {
		async waitIfThrottled(): Promise<void> {
			const remaining = throttleUntil - Date.now();
			if (remaining > 0) await sleep(remaining);
		},
		onRateLimit(): number {
			const sleepMs = BACKOFF_SCHEDULE_MS[Math.min(level, BACKOFF_SCHEDULE_MS.length - 1)] ?? 600_000;
			level++;
			throttleUntil = Math.max(throttleUntil, Date.now() + sleepMs);
			return sleepMs / 1000;
		},
		onSuccess(): void {
			level = 0;
		},
	};
}

function isRateLimitError(error: unknown): boolean {
	return APICallError.isInstance(error) && error.statusCode === 429;
}

type EnrichmentTask = {
	rawFilePath: string;
	processedFilePath: string;
	domain: DomainEntry;
	sourceId: AddRequest["source"];
};

export function createContentEngine(config: ContentEngineConfig): ContentEngine {
	const domainMap = new Map(config.domains.map((d) => [d.name, d]));
	const customPrompts = config.customPrompts ?? {};
	const progress = config.progress ?? noopProgressReporter;
	const queue = createPersistentEnrichmentQueue(config.queueDir);
	const rateLimiter = createRateLimiter();
	let activeWorkers = 0;
	let running = false;
	let workerPromises: Promise<void>[] = [];

	async function runWorker(workerId: number): Promise<void> {
		while (running) {
			await rateLimiter.waitIfThrottled();

			const claimedTask = await queue.claim(workerId);
			if (!claimedTask) {
				await sleep(100);
				continue;
			}

			activeWorkers++;
			try {
				await processTask(claimedTask);
			} finally {
				activeWorkers--;
			}
		}
	}

	async function processTask(claimedTask: ClaimedEnrichmentTask): Promise<void> {
		const domain = domainMap.get(claimedTask.task.domainName);
		if (!domain) {
			await queue.fail(claimedTask, `unknown domain: ${claimedTask.task.domainName}`);
			return;
		}

		const task = { ...claimedTask.task, domain };
		emitContentProgress("content-index-start", task);
		log.debug(`Starting enrichment pending=${await queue.countPending()} file=${task.rawFilePath}`);

		try {
			if (await fileExists(task.processedFilePath)) {
				await queue.complete(claimedTask);
				emitContentProgress("content-index-complete", task);
				return;
			}

			await enrichDocument({ ...task, model: config.model, customPrompts });
			rateLimiter.onSuccess();
			await queue.complete(claimedTask);
			emitContentProgress("content-index-complete", task);
			log.debug(`Completed enrichment pending=${await queue.countPending()} file=${task.rawFilePath}`);
		} catch (error) {
			await handleEnrichmentError(claimedTask, task, error);
		}
	}

	async function handleEnrichmentError(
		claimedTask: ClaimedEnrichmentTask,
		task: EnrichmentTask,
		error: unknown,
	): Promise<void> {
		if (isRateLimitError(error)) {
			const sleepSecs = rateLimiter.onRateLimit();
			await queue.retry(claimedTask, error);
			log.warn(
				`Rate-limited by LLM. Sleeping ${sleepSecs}s before retry. pending=${await queue.countPending()} file=${task.rawFilePath}`,
			);
			emitContentProgress("content-index-retry", task);
			return;
		}

		await queue.fail(claimedTask, error);
		emitContentProgress("content-index-error", task);
		log.error(`Enrichment failed for ${task.rawFilePath}: ${error instanceof Error ? error.message : String(error)}`);
	}

	function emitContentProgress(
		type: "content-index-start" | "content-index-complete" | "content-index-error" | "content-index-retry",
		task: EnrichmentTask,
	): void {
		progress.emit({
			type,
			domain: task.domain.name,
			sourceId: task.sourceId,
		});
	}

	return {
		async start(): Promise<void> {
			if (running) return;

			await queue.init();
			const recovered = await queue.recoverActive();
			if (recovered > 0) log.info(`Recovered ${recovered} active enrichment task(s) from previous run.`);

			await emitContentStorageSnapshot(progress, config.domains);
			const backlogCount = await enqueueUnprocessedDocuments(config.domains, queue.enqueue);
			if (backlogCount > 0) log.info(`Queued ${backlogCount} unprocessed document(s) from previous runs.`);
			log.debug(`Persistent enrichment queue pending=${await queue.countPending()} dir=${config.queueDir}`);

			running = true;
			workerPromises = Array.from({ length: config.workers }, (_, index) => runWorker(index + 1));
		},

		async stop(): Promise<void> {
			running = false;
			await Promise.all(workerPromises);
		},

		async waitForIdle(): Promise<void> {
			while (activeWorkers > 0 || (await queue.hasPending())) {
				await sleep(1000);
			}
		},

		async add(request: AddRequest): Promise<AddResult> {
			const domain = domainMap.get(request.domain);
			if (!domain) return { success: false, message: `unknown domain: ${request.domain}` };

			const { filePath: rawFilePath, relPath, written, created } = await writeRawDocument(domain.contentDir, request);

			const processedFilePath = path.join(domain.contentDir, "processed", relPath);

			if (written) {
				if (created) {
					progress.emit({ type: "content-raw-added", domain: domain.name, sourceId: request.source, count: 1 });
				}
				const removed = await unlinkIfExists(processedFilePath);
				if (removed) {
					progress.emit({
						type: "content-processed-removed",
						domain: domain.name,
						sourceId: request.source,
						count: 1,
					});
				}
			} else if (await fileExists(processedFilePath)) {
				return { success: true };
			}

			const queued = await queue.enqueue({
				rawFilePath,
				processedFilePath,
				domainName: domain.name,
				sourceId: request.source,
			});
			if (queued) log.debug(`Queued enrichment pending=${await queue.countPending()} file=${rawFilePath}`);

			return { success: true };
		},
	};
}

async function emitContentStorageSnapshot(
	progress: NonNullable<ContentEngineConfig["progress"]>,
	domains: DomainEntry[],
): Promise<void> {
	for (const domain of domains) {
		const rawCounts = await countMarkdownBySource(path.join(domain.contentDir, "raw"));
		const processedCounts = await countMarkdownBySource(path.join(domain.contentDir, "processed"));
		const sourceIds = new Set([...rawCounts.keys(), ...processedCounts.keys()]);

		for (const sourceId of sourceIds) {
			progress.emit({
				type: "content-storage-snapshot",
				domain: domain.name,
				sourceId,
				total: rawCounts.get(sourceId) ?? 0,
				enriched: processedCounts.get(sourceId) ?? 0,
			});
		}
	}
}

async function countMarkdownBySource(rootDir: string): Promise<Map<AddRequest["source"], number>> {
	const counts = new Map<AddRequest["source"], number>();

	let relPaths: string[];
	try {
		const entries = await readdir(rootDir, { recursive: true });
		relPaths = (entries as string[]).filter((entry) => entry.endsWith(".md"));
	} catch {
		return counts;
	}

	for (const relPath of relPaths) {
		const [sourceId] = relPath.split(path.sep);
		if (!sourceId) continue;
		counts.set(sourceId as AddRequest["source"], (counts.get(sourceId as AddRequest["source"]) ?? 0) + 1);
	}

	return counts;
}

async function enqueueUnprocessedDocuments(
	domains: DomainEntry[],
	enqueue: (task: PendingEnrichmentTask) => Promise<boolean>,
): Promise<number> {
	let queuedCount = 0;

	for await (const task of scanUnprocessed(domains)) {
		if (await enqueue(task)) queuedCount++;
	}

	return queuedCount;
}

async function* scanUnprocessed(domains: DomainEntry[]): AsyncGenerator<PendingEnrichmentTask> {
	for (const domain of domains) {
		const rawDir = path.join(domain.contentDir, "raw");

		let relPaths: string[];
		try {
			const entries = await readdir(rawDir, { recursive: true });
			relPaths = (entries as string[]).filter((entry) => entry.endsWith(".md"));
		} catch {
			continue;
		}

		for (const relPath of relPaths) {
			const rawFilePath = path.join(rawDir, relPath);
			const processedFilePath = path.join(domain.contentDir, "processed", relPath);
			if (await fileExists(processedFilePath)) continue;

			const sourceId = relPath.split(path.sep)[0] as AddRequest["source"];
			yield { rawFilePath, processedFilePath, domainName: domain.name, sourceId };
		}
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function unlinkIfExists(filePath: string): Promise<boolean> {
	try {
		await unlink(filePath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
