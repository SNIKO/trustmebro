import type { LanguageModel } from "ai";
import { type DomainEntry, startWorkers, type WorkerHandle } from "./processor.js";
import { createStorage } from "./storage.js";
import type { AddInput, AddResult, DocumentRef, SourceCounts } from "./types.js";

export type { DomainEntry } from "./processor.js";
export type {
	AddInput,
	AddResult,
	SourceCounts,
} from "./types.js";

export interface ContentEngine {
	add(input: AddInput): Promise<AddResult>;
	getCounts(): SourceCounts;
	start(): Promise<void>;
	waitForIdle(): Promise<void>;
	stop(): Promise<void>;
}

export type ContentEngineOptions = {
	basePath: string;
	domains: DomainEntry[];
	model: LanguageModel;
	workers?: number;
	/** Custom prompts keyed by "{domainName}/{sourceId}" */
	customPrompts?: Record<string, string>;
};

export async function createContentEngine(options: ContentEngineOptions): Promise<ContentEngine> {
	const storage = await createStorage(options.basePath);
	const initialQueue: DocumentRef[] = [];

	// Enqueue existing unprocessed documents
	const unprocessed = await storage.getUnprocessed();
	initialQueue.push(...unprocessed);

	let workerHandle: WorkerHandle | undefined;

	return {
		async add(input) {
			const result = await storage.saveRaw(input);
			if (result.type === "duplicate") {
				return { success: false, message: "Document already exists." };
			}
			if (result.type === "error") {
				return { success: false, message: result.message };
			}
			if (workerHandle) {
				workerHandle.enqueue(result.ref);
			} else {
				initialQueue.push(result.ref);
			}
			return { success: true, ref: result.ref };
		},

		getCounts() {
			return storage.getCounts();
		},

		async start() {
			if (workerHandle) return;
			if (options.workers === 0) return; // No processing if workers set to 0

			workerHandle = startWorkers({
				storage,
				initialQueue,
				model: options.model,
				domains: options.domains,
				customPrompts: options.customPrompts,
				concurrency: options.workers,
			});
			initialQueue.length = 0;
		},

		async stop() {
			if (!workerHandle) return;
			await workerHandle.stop();
			workerHandle = undefined;
		},

		async waitForIdle() {
			if (!workerHandle) return;
			await workerHandle.waitForIdle();
		},
	};
}
