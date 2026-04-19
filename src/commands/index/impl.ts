import path from "node:path";
import type { LanguageModel } from "ai";
import YAML from "yaml";
import {
	type Config,
	DATA_DIR_NAME,
	loadConfig,
	type SourceId,
} from "../../config.js";
import { createContentEngine } from "../../content/index.js";
import { buildSources } from "../../sources/index.js";
import type { Source, SourceContext } from "../../sources/types.js";
import {
	log,
	logIndexingItemCompleted,
	logIndexingItemStarted,
} from "../../ui/logger.js";

export interface IndexCommandFlags {
	workspacePath?: string;
	source?: SourceId;
	publisher?: string;
}

type TagSchema = Array<{
	name: string;
	type: string;
	description: string;
	enumValues: string[] | null;
}>;

type SourceToProcess = { source: Source; publisherIds: string[] };

function resolveEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).map(([key, value]) => {
			if (typeof value === "string" && value.startsWith("env."))
				return [key, process.env[value.slice(4)]];
			if (typeof value === "object" && value !== null && !Array.isArray(value))
				return [key, resolveEnvVars(value as Record<string, unknown>)];
			return [key, value];
		}),
	);
}

async function resolveModel(config: Config): Promise<LanguageModel> {
	const { provider, model: modelName, options } = config.indexing.model;
	const mod = await import(provider);
	const entry = Object.entries(mod).find(
		([key, val]) => /^create[A-Z]/.test(key) && typeof val === "function",
	);
	if (!entry) throw new Error(`No provider factory found in ${provider}`);
	const factory = entry[1] as (
		opts: Record<string, unknown>,
	) => (model: string) => LanguageModel;
	return factory(options ? resolveEnvVars(options) : {})(modelName);
}

function buildTagSchema(config: Config): TagSchema {
	return Object.entries(config.tags).map(([name, entry]) => ({
		name,
		type: entry.type,
		description: entry.description ?? "",
		enumValues:
			entry.type === "enum" || entry.type === "enum[]" ? entry.values : null,
	}));
}

function buildCustomPrompts(
	sources: Source[],
	topic: string,
	tagSchema: TagSchema,
): Record<string, string> {
	const tagSchemaJson = JSON.stringify(tagSchema, null, 2);
	return Object.fromEntries(
		sources
			.filter(
				(s): s is Source & Required<Pick<Source, "getProcessingPrompt">> =>
					s.getProcessingPrompt != null,
			)
			.map((s) => [s.sourceId, s.getProcessingPrompt(topic, tagSchemaJson)]),
	);
}

function filterSourcesToProcess(
	sources: Source[],
	config: Config,
	flags: IndexCommandFlags,
): SourceToProcess[] {
	const result: SourceToProcess[] = [];
	for (const source of sources) {
		if (flags.source && source.sourceId !== flags.source) continue;

		const sourceConfig = config.sources[source.sourceId];
		if (!sourceConfig) {
			log.warn("Source not configured, skipping", { source: source.sourceId });
			continue;
		}

		const publisherIds = flags.publisher
			? [flags.publisher]
			: sourceConfig.publishers;
		if (publisherIds.length > 0) {
			result.push({ source, publisherIds });
		} else {
			log.warn("No publishers configured, skipping", {
				source: source.sourceId,
			});
		}
	}
	return result;
}

async function runSource(
	source: Source,
	publisherIds: string[],
	context: SourceContext,
): Promise<{
	sourceId: SourceId;
	errors: Array<{ sourceId: SourceId; publisherId: string; error: unknown }>;
}> {
	const errors: Array<{
		sourceId: SourceId;
		publisherId: string;
		error: unknown;
	}> = [];
	for (const publisherId of publisherIds) {
		try {
			await source.runOnce(context, publisherId);
		} catch (error) {
			errors.push({ sourceId: source.sourceId, publisherId, error });
			log.error(
				`Failed processing publisher '${publisherId}'`,
				{ source: source.sourceId, publisher: publisherId },
				{ error: error instanceof Error ? error.message : String(error) },
			);
		}
	}
	return { sourceId: source.sourceId, errors };
}

async function checkAuthentication(
	sources: Source[],
	workspacePath: string,
): Promise<void> {
	for (const source of sources) {
		if (source.authenticate) {
			const isAuthenticated = await source.authenticate(workspacePath);
			if (!isAuthenticated) {
				throw new Error(
					`Authentication failed for source '${source.sourceId}'. Please configure credentials and try again.`,
				);
			}
		}
	}
}

export async function index(flags: IndexCommandFlags): Promise<void> {
	try {
		const workspacePath = flags.workspacePath ?? ".";
		const config = await loadConfig(path.join(workspacePath, "config.yaml"));
		const sources = buildSources();
		const tagSchema = buildTagSchema(config);
		const model = await resolveModel(config);

		const contentEngine = await createContentEngine({
			basePath: path.join(workspacePath, DATA_DIR_NAME),
			domain: config.topic,
			tagSchema: YAML.stringify(tagSchema),
			model,
			workers: config.indexing.workers,
			customPrompts: buildCustomPrompts(sources, config.topic, tagSchema),
			hooks: {
				onDocumentProcessingStarted: logIndexingItemStarted,
				onDocumentProcessingCompleted: logIndexingItemCompleted,
			},
		});

		const context: SourceContext = {
			config,
			workspacePath,
			engine: contentEngine,
			model,
		};
		log.updateSourceCounts(contentEngine.getCounts());

		const sourcesToProcess = filterSourcesToProcess(sources, config, flags);

		await checkAuthentication(sourcesToProcess.map((s) => s.source), workspacePath);

		await contentEngine.start();

		const results = await Promise.all(
			sourcesToProcess.map(({ source, publisherIds }) =>
				runSource(source, publisherIds, context),
			),
		);

		await contentEngine.waitForIdle();
		await contentEngine.stop();

		const failed = results.flatMap((r) => r.errors);
		if (failed.length > 0) {
			throw new Error(
				`Indexing completed with ${failed.length} failed publisher run(s) across ${results.length} source(s)`,
			);
		}

		log.info("Indexing run complete");
	} finally {
	}
}
