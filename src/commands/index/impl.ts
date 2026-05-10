import path from "node:path";
import type { LanguageModel } from "ai";
import YAML from "yaml";
import { type Config, DATA_DIR_NAME, type DomainConfig, loadConfig, type SourceId } from "../../config.js";
import {
	type ContentEngine,
	type ContentEngineOptions,
	createContentEngine,
	type DomainEntry,
} from "../../content/index.js";
import { buildSources } from "../../sources/index.js";
import type { Source, SourceContext } from "../../sources/types.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("index");

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

type PublisherTask = { publisherId: string; context: SourceContext };
type SourceRun = { source: Source; publishers: PublisherTask[] };
type SourceRunResult = {
	sourceId: SourceId;
	errors: Array<{ sourceId: SourceId; publisherId: string; error: unknown }>;
};

export async function index(flags: IndexCommandFlags): Promise<void> {
	const workspacePath = flags.workspacePath ?? ".";
	const config = await loadConfig(path.join(workspacePath, "config.yaml"));
	const sources = buildSources();
	const model = await resolveModel(config);
	const engine = await createEngine(sources, config, workspacePath, model);

	await engine.start();

	const sourceRuns = buildSourceRuns(sources, config, flags, workspacePath, engine, model);

	if (sourceRuns.length === 0) {
		log.warn("No sources configured.");
		await engine.stop();
		return;
	}

	log.info(`Running ${sourceRuns.length} source(s) across ${config.domains.length} domain(s) concurrently.`);

	await checkAuthentication(
		sourceRuns.map((run) => run.source),
		workspacePath,
	);

	const results = await Promise.all(sourceRuns.map(({ source, publishers }) => runSource(source, publishers)));

	await engine.waitForIdle();
	await engine.stop();

	log.info("Fetching completed for all domains.");

	const allErrors = results.flatMap((run) => run.errors);
	if (allErrors.length > 0) {
		throw new Error(`Indexing completed with ${allErrors.length} failed publisher run(s)`);
	}
}

async function resolveModel(config: Config): Promise<LanguageModel> {
	const { provider, model: modelName, options } = config.indexing.model;
	const providerModule = await import(provider);
	const factoryEntry = Object.entries(providerModule).find(
		([key, val]) => /^create[A-Z]/.test(key) && typeof val === "function",
	);
	if (!factoryEntry) throw new Error(`No provider factory found in ${provider}`);
	const factory = factoryEntry[1] as (opts: Record<string, unknown>) => (model: string) => LanguageModel;
	return factory(options ? resolveEnvVars(options) : {})(modelName);
}

async function createEngine(
	sources: Source[],
	config: Config,
	workspacePath: string,
	model: LanguageModel,
): Promise<ContentEngine> {
	const engineOptions: ContentEngineOptions = {
		basePath: path.join(workspacePath, DATA_DIR_NAME),
		domains: config.domains.map(buildDomainEntry),
		model,
		workers: config.indexing.workers,
		customPrompts: buildCustomPrompts(sources, config.domains),
	};
	return createContentEngine(engineOptions);
}

function buildSourceRuns(
	sources: Source[],
	config: Config,
	flags: IndexCommandFlags,
	workspacePath: string,
	engine: ContentEngine,
	model: LanguageModel,
): SourceRun[] {
	const runMap = new Map<SourceId, SourceRun>();

	for (const domain of config.domains) {
		const context: SourceContext = { config, domainConfig: domain, domain: domain.name, workspacePath, engine, model };
		for (const source of sources) {
			addSourcePublishers(runMap, source, context, flags);
		}
	}

	return [...runMap.values()];
}

function addSourcePublishers(
	runMap: Map<SourceId, SourceRun>,
	source: Source,
	context: SourceContext,
	flags: IndexCommandFlags,
): void {
	if (flags.source && source.sourceId !== flags.source) return;

	const sourceConfig = context.domainConfig.sources[source.sourceId];
	if (!sourceConfig) return;

	const publisherIds = flags.publisher ? [flags.publisher] : sourceConfig.publishers;
	if (publisherIds.length === 0) return;

	const publishers = publisherIds.map((publisherId) => ({ publisherId, context }));
	const existing = runMap.get(source.sourceId);
	if (existing) existing.publishers.push(...publishers);
	else runMap.set(source.sourceId, { source, publishers });
}

async function checkAuthentication(sources: Source[], workspacePath: string): Promise<void> {
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

async function runSource(source: Source, publishers: PublisherTask[]): Promise<SourceRunResult> {
	const errors: SourceRunResult["errors"] = [];
	const sourceLogger = createLogger(source.sourceId);

	for (const [i, { publisherId, context }] of publishers.entries()) {
		try {
			sourceLogger.info(`Fetching ${i + 1}/${publishers.length} publishers`);
			await source.runOnce(context, publisherId);
			sourceLogger.info(`Fetched ${i + 1}/${publishers.length} publishers`);
		} catch (error) {
			errors.push({ sourceId: source.sourceId, publisherId, error });
			sourceLogger.error(
				`Error processing '${publisherId}': ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	sourceLogger.info("Fetching completed");

	return { sourceId: source.sourceId, errors };
}

function buildCustomPrompts(sources: Source[], domains: DomainConfig[]): Record<string, string> {
	const promptsByKey: Record<string, string> = {};

	for (const domain of domains) {
		const tagSchema = buildTagSchema(domain);
		const tagSchemaJson = JSON.stringify(tagSchema, null, 2);
		for (const source of sources) {
			if (source.getProcessingPrompt) {
				promptsByKey[`${domain.name}/${source.sourceId}`] = source.getProcessingPrompt(
					domain.description,
					tagSchemaJson,
				);
			}
		}
	}

	return promptsByKey;
}

function buildDomainEntry(domain: DomainConfig): DomainEntry {
	const tagSchema = buildTagSchema(domain);
	const tagSchemaYaml = YAML.stringify(tagSchema);
	return {
		name: domain.name,
		domain: domain.description,
		tagSchema: tagSchemaYaml,
	};
}

function buildTagSchema(domain: DomainConfig): TagSchema {
	return Object.entries(domain.tags).map(([name, entry]) => ({
		name,
		type: entry.type,
		description: entry.description ?? "",
		enumValues: entry.type === "enum" || entry.type === "enum[]" ? entry.values : null,
	}));
}

function resolveEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).map(([key, value]) => {
			if (typeof value === "string" && value.startsWith("env.")) return [key, process.env[value.slice(4)]];
			if (typeof value === "object" && value !== null && !Array.isArray(value))
				return [key, resolveEnvVars(value as Record<string, unknown>)];
			return [key, value];
		}),
	);
}
