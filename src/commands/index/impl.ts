import path from "node:path";
import { createGreptor, type Greptor } from "greptor";
import { type Config, loadConfig, type SourceId } from "../../config.js";
import { buildSources } from "../../sources/index.js";
import type { SourceContext } from "../../sources/types.js";
import {
	logIndexingItemCompleted as logDocumentProcessingCompleted,
	logIndexingItemStarted as logDocumentProcessingStarted,
	logger,
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

async function createGreptorClient(
	config: Config,
	basePath: string,
): Promise<Greptor> {
	const tagSchema = config.tags
		? Object.entries(config.tags).map(([name, entry]) => ({
				name,
				type: entry.type as TagType,
				description: entry.description ?? "",
				enumValues:
					entry.type === "enum" || entry.type === "enum[]"
						? entry.values
						: null,
			}))
		: undefined;

	try {
		const greptor = createGreptor({
			baseDir: basePath,
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
			hooks: {
				onDocumentProcessingStarted: logDocumentProcessingStarted,
				onDocumentProcessingCompleted: logDocumentProcessingCompleted,
			},
		});

		return greptor;
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
		const dataPath = path.join(workspacePath, "data");
		const config = await loadConfig(configPath);
		const greptor = await createGreptorClient(config, dataPath);
		const sources = buildSources();
		const context: SourceContext = { config, workspacePath, greptor };

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
				logger.warn(
					`[${source.sourceId}] Source not configured, skipping source.`,
				);
				continue;
			}

			const publisherIds = flags.publisher
				? [flags.publisher]
				: sourceConfig.publishers;

			if (publisherIds.length > 0) {
				sourcesToProcess.push({ source, publisherIds });
			} else {
				logger.warn(
					`[${source.sourceId}] No publishers configured, skipping source.`,
				);
			}
		}

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
						logger.error(
							{
								sourceId: source.sourceId,
								publisherId,
								err: error,
							},
							`[${source.sourceId}] Failed processing publisher '${publisherId}'`,
						);
					}
				}

				return { sourceId: source.sourceId, errors };
			}),
		);

		const failed = results.flatMap((r) => r.errors);
		if (failed.length > 0) {
			throw new Error(
				`Indexing completed with ${failed.length} failed publisher run(s) across ${results.length} source(s)`,
			);
		}

		logger.info("Indexing run complete");
	} finally {
		statusBar.stop();
	}
}
