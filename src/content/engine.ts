import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { APICallError } from "ai";

import { noopProgressReporter } from "../ui/events.js";
import { createLogger } from "../utils/logger.js";
import type { AddRequest, AddResult, ContentEngine, ContentEngineConfig, DomainEntry } from "./engine.types.js";
import { enrichDocument } from "./enricher.js";
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
	const queue: EnrichmentTask[] = [];
	const idleResolvers: Array<() => void> = [];
	const customPrompts = config.customPrompts ?? {};
	const progress = config.progress ?? noopProgressReporter;
	const rateLimiter = createRateLimiter();
	let activeWorkers = 0;
	let running = false;
	let workerPromises: Promise<void>[] = [];

	function notifyIdleIfDone(): void {
		if (queue.length === 0 && activeWorkers === 0) {
			for (const resolve of idleResolvers) resolve();
			idleResolvers.length = 0;
		}
	}

	async function runWorker(): Promise<void> {
		while (running) {
			const task = queue.shift();
			if (!task) {
				await sleep(100);
				continue;
			}
			activeWorkers++;
			try {
				await processTask(task);
			} finally {
				activeWorkers--;
				notifyIdleIfDone();
			}
		}
	}

	async function processTask(task: EnrichmentTask): Promise<void> {
		await rateLimiter.waitIfThrottled();
		emitContentProgress("content-index-start", task);

		try {
			await enrichDocument({ ...task, model: config.model, customPrompts });
			rateLimiter.onSuccess();
			emitContentProgress("content-index-complete", task);
		} catch (error) {
			handleEnrichmentError(task, error);
		}
	}

	function handleEnrichmentError(task: EnrichmentTask, error: unknown): void {
		if (isRateLimitError(error)) {
			const sleepSecs = rateLimiter.onRateLimit();
			log.warn(`Rate-limited by LLM. Sleeping ${sleepSecs}s before retry...`);
			emitContentProgress("content-index-retry", task);
			queue.unshift(task);
			return;
		}

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
			running = true;
			workerPromises = Array.from({ length: config.workers }, () => runWorker());

			await emitContentStorageSnapshot(progress, config.domains);
			const backlog = await scanUnprocessed(config.domains);
			for (const task of backlog) queue.push(task);
			if (backlog.length > 0) log.info(`Enqueued ${backlog.length} unprocessed document(s) from previous runs.`);
		},

		async stop(): Promise<void> {
			running = false;
			await Promise.all(workerPromises);
			for (const resolve of idleResolvers) resolve();
			idleResolvers.length = 0;
		},

		async waitForIdle(): Promise<void> {
			if (queue.length === 0 && activeWorkers === 0) return;
			await new Promise<void>((resolve) => idleResolvers.push(resolve));
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

			queue.push({ rawFilePath, processedFilePath, domain, sourceId: request.source });

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

async function scanUnprocessed(domains: DomainEntry[]): Promise<EnrichmentTask[]> {
	const tasks: EnrichmentTask[] = [];

	for (const domain of domains) {
		const rawDir = path.join(domain.contentDir, "raw");

		let relPaths: string[];
		try {
			const entries = await readdir(rawDir, { recursive: true });
			relPaths = (entries as string[]).filter((e) => e.endsWith(".md"));
		} catch {
			continue;
		}

		for (const relPath of relPaths) {
			const rawFilePath = path.join(rawDir, relPath);
			const processedFilePath = path.join(domain.contentDir, "processed", relPath);
			if (await fileExists(processedFilePath)) continue;

			const sourceId = relPath.split(path.sep)[0] as AddRequest["source"];
			tasks.push({ rawFilePath, processedFilePath, domain, sourceId });
		}
	}

	return tasks;
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
