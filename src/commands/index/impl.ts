import path from "node:path";
import { createGreptor, type Greptor } from "greptor";
import {
	type Config,
	DATA_DIR_NAME,
	loadConfig,
	type SourceId,
} from "../../config.js";
import { buildSources } from "../../sources/index.js";
import type { SourceContext } from "../../sources/types.js";
import {
	log,
	logIndexingItemCompleted,
	logIndexingItemStarted,
} from "../../ui/logger.js";
import { statusBar } from "../../ui/status-bar.js";

type TagType =
	Config["tags"] extends Record<string, infer T>
		? T extends { type: infer K }
			? K
			: never
		: never;

function resolveEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
	const resolved: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (typeof value === "string" && value.startsWith("env.")) {
			const envVar = value.slice(4);
			resolved[key] = process.env[envVar];
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			resolved[key] = resolveEnvVars(value as Record<string, unknown>);
		} else {
			resolved[key] = value;
		}
	}
	return resolved;
}

interface IndexCommandFlags {
	workspacePath?: string;
	source?: SourceId;
	publisher?: string;
}

interface GreptorClientResult {
	greptor: Greptor;
	waitForProcessingComplete: () => Promise<void>;
}

async function createGreptorClient(
	config: Config,
	basePath: string,
	sources: ReturnType<typeof buildSources>,
): Promise<GreptorClientResult> {
	const tagSchema = Object.entries(config.tags).map(([name, entry]) => ({
		name,
		type: entry.type as TagType,
		description: entry.description ?? "",
		enumValues:
			entry.type === "enum" || entry.type === "enum[]" ? entry.values : null,
	}));

	// Extract prompts from sources that provide them
	const customProcessingPrompts: Record<string, string> = {};
	for (const source of sources) {
		if (source.getProcessingPrompt) {
			customProcessingPrompts[source.sourceId] = source.getProcessingPrompt(
				config.topic,
				JSON.stringify(tagSchema, null, 2),
			);
		}
	}

	// Track processing state so we can wait for all documents to finish
	let processingActive = false;
	let onComplete: (() => void) | null = null;

	const waitForProcessingComplete = async (): Promise<void> => {
		// Check document counts to detect queued-but-not-yet-started items
		const counts = await greptor.getDocumentCounts();
		const hasUnprocessed = Object.values(counts).some(
			(c) => c.fetched > c.processed,
		);

		if (!hasUnprocessed && !processingActive) return;

		return new Promise<void>((resolve) => {
			onComplete = resolve;
		});
	};

	let greptor!: Greptor;

	try {
		greptor = await createGreptor({
			basePath: basePath,
			topic: config.topic,
			model: {
				provider: config.indexing.model.provider,
				model: config.indexing.model.model,
				options: config.indexing.model.options
					? resolveEnvVars(config.indexing.model.options)
					: {},
			},
			workers: config.indexing.workers,
			tagSchema,
			customProcessingPrompts,
			hooks: {
				onProcessingStarted: () => {
					processingActive = true;
				},
				onProcessingCompleted: () => {
					processingActive = false;
					onComplete?.();
					onComplete = null;
				},
				onDocumentProcessingStarted: logIndexingItemStarted,
				onDocumentProcessingCompleted: logIndexingItemCompleted,
			},
		});

		return { greptor, waitForProcessingComplete };
	} catch (error) {
		console.error("Failed to create model:", error);
		throw error;
	}
}

export async function index(flags: IndexCommandFlags): Promise<void> {
	statusBar.start();
	try {
		const workspacePath = flags.workspacePath ?? ".";
		const configPath = path.join(workspacePath, "config.yaml");
		const dataPath = path.join(workspacePath, DATA_DIR_NAME);
		const config = await loadConfig(configPath);
		const sources = buildSources();
		const { greptor, waitForProcessingComplete } = await createGreptorClient(
			config,
			dataPath,
			sources,
		);
		const context: SourceContext = { config, workspacePath, greptor };

		const documentsCount = await greptor.getDocumentCounts();
		statusBar.updateSourceCounts(documentsCount);

		// Collect all sources and publishers we'll be processing
		const sourcesToProcess: Array<{
			source: (typeof sources)[number];
			publisherIds: string[];
		}> = [];

		for (const source of sources) {
			if (flags.source && source.sourceId !== flags.source) {
				continue;
			}

			const sourceConfig = config.sources[source.sourceId];
			if (!sourceConfig) {
				log.warn("Source not configured, skipping", {
					source: source.sourceId,
				});
				continue;
			}

			const publisherIds = flags.publisher
				? [flags.publisher]
				: sourceConfig.publishers;

			if (publisherIds.length > 0) {
				sourcesToProcess.push({ source, publisherIds });
			} else {
				log.warn("No publishers configured, skipping", {
					source: source.sourceId,
				});
			}
		}

		const fetchTotals: Partial<Record<SourceId, number>> = {};
		for (const { source, publisherIds } of sourcesToProcess) {
			fetchTotals[source.sourceId] = publisherIds.length;
		}
		statusBar.setFetchTotals(fetchTotals);

		await greptor.start();

		// Process each source concurrently, but keep publishers sequential within a source.
		const results = await Promise.all(
			sourcesToProcess.map(async ({ source, publisherIds }) => {
				const errors: Array<{
					sourceId: SourceId;
					publisherId: string;
					error: unknown;
				}> = [];

				for (const publisherId of publisherIds) {
					try {
						await source.runOnce(context, publisherId);
					} catch (error) {
						errors.push({
							sourceId: source.sourceId,
							publisherId,
							error,
						});
						log.error(`Failed processing publisher '${publisherId}'`, {
							source: source.sourceId,
							publisher: publisherId,
						});
					}
				}

				return { sourceId: source.sourceId, errors };
			}),
		);

		statusBar.setFetchTotals({});

		await waitForProcessingComplete();
		await greptor.stop();

		const failed = results.flatMap((r) => r.errors);
		if (failed.length > 0) {
			throw new Error(
				`Indexing completed with ${failed.length} failed publisher run(s) across ${results.length} source(s)`,
			);
		}

		log.info("Indexing run complete");
	} finally {
		statusBar.stop();
	}
}
