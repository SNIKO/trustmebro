import type { LanguageModel } from "ai";
import { type DomainEntry, startWorkers, type WorkerHandle } from "./processor.js";
import { createStorage, getDomainFromRef, type Storage } from "./storage.js";
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

export type ContentEngineDomain = DomainEntry & {
	/** Absolute path to the directory where raw and processed files are stored. */
	dataDir: string;
};

export type ContentEngineOptions = {
	domains: ContentEngineDomain[];
	model: LanguageModel;
	workers?: number;
	/** Custom prompts keyed by "{domainName}/{sourceId}" */
	customPrompts?: Record<string, string>;
};

export async function createContentEngine(options: ContentEngineOptions): Promise<ContentEngine> {
	const storage = await buildCompositeStorage(options.domains);
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

async function buildCompositeStorage(domains: ContentEngineDomain[]): Promise<Storage> {
	const storageByPath = new Map<string, Storage>();
	const domainStorage = new Map<string, Storage>();

	for (const domain of domains) {
		let s = storageByPath.get(domain.dataDir);
		if (!s) {
			s = await createStorage(domain.dataDir);
			storageByPath.set(domain.dataDir, s);
		}
		domainStorage.set(domain.name, s);
	}

	const uniqueStorages = [...new Set(domainStorage.values())];

	function storageFor(domain: string): Storage {
		const s = domainStorage.get(domain);
		if (!s) throw new Error(`Unknown domain '${domain}'`);
		return s;
	}

	return {
		saveRaw: (input) => storageFor(input.domain).saveRaw(input),
		readRaw: (ref) => storageFor(getDomainFromRef(ref)).readRaw(ref),
		saveProcessed: (ref, content) => storageFor(getDomainFromRef(ref)).saveProcessed(ref, content),
		async getUnprocessed() {
			const results = await Promise.all(uniqueStorages.map((s) => s.getUnprocessed()));
			return results.flat().sort();
		},
		getCounts() {
			const combined: SourceCounts = {};
			for (const s of uniqueStorages) {
				for (const [source, counts] of Object.entries(s.getCounts())) {
					combined[source] ??= { fetched: 0, processed: 0 };
					combined[source].fetched += counts.fetched;
					combined[source].processed += counts.processed;
				}
			}
			return combined;
		},
	};
}
