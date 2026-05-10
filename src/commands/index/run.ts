import path from "node:path";

import type { LanguageModel } from "ai";
import YAML from "yaml";

import { type Config, DATA_DIR_NAME, type DomainConfig, loadConfig, type SourceId } from "../../config.js";
import { type ContentEngine, createContentEngine, type DomainEntry } from "../../content/index.js";
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

type ProviderFactory = (opts: Record<string, unknown>) => (model: string) => LanguageModel;

type PublisherTask = { publisherId: string; context: SourceContext };
type PublisherError = { sourceId: SourceId; publisherId: string; error: unknown };
type SourceRun = { source: Source; publishers: PublisherTask[] };

type RunContext = {
	config: Config;
	workspacePath: string;
	engine: ContentEngine;
	model: LanguageModel;
};

export async function index(flags: IndexCommandFlags): Promise<void> {
	const workspacePath = flags.workspacePath ?? ".";
	const config = await loadConfig(path.join(workspacePath, "config.yaml"));
	const sources = buildSources();
	const model = await resolveModel(config);
	const engine = await createEngine(sources, config, workspacePath, model);

	await engine.start();

	const ctx: RunContext = { config, workspacePath, engine, model };
	const sourceRuns = buildSourceRuns(sources, flags, ctx);

	if (sourceRuns.length === 0) {
		log.warn("No sources configured.");
		await engine.stop();
		return;
	}

	log.info(`Running ${sourceRuns.length} source(s) across ${config.domains.length} domain(s) concurrently.`);

	await checkAuthentication(
		sourceRuns.map(({ source }) => source),
		workspacePath,
	);

	const runErrors = await Promise.all(sourceRuns.map(({ source, publishers }) => runSource(source, publishers)));
	const allErrors = runErrors.flat();

	await engine.waitForIdle();
	await engine.stop();

	log.info("Fetching completed for all domains.");

	if (allErrors.length > 0) {
		throw new Error(`Indexing completed with ${allErrors.length} failed publisher run(s)`);
	}
}

async function resolveModel(config: Config): Promise<LanguageModel> {
	const { provider, model: modelName, options } = config.indexing.model;
	const providerModule = await import(provider);
	const entry = Object.entries(providerModule).find(
		(pair): pair is [string, ProviderFactory] => /^create[A-Z]/.test(pair[0]) && isProviderFactory(pair[1]),
	);
	if (!entry) throw new Error(`No provider factory found in ${provider}`);
	return entry[1](resolveEnvVars(options ?? {}))(modelName);
}

async function createEngine(
	sources: Source[],
	config: Config,
	workspacePath: string,
	model: LanguageModel,
): Promise<ContentEngine> {
	return createContentEngine({
		basePath: path.join(workspacePath, DATA_DIR_NAME),
		domains: config.domains.map(buildDomainEntry),
		model,
		workers: config.indexing.workers,
		customPrompts: buildCustomPrompts(sources, config.domains),
	});
}

function buildDomainEntry(domain: DomainConfig): DomainEntry {
	return {
		name: domain.name,
		domain: domain.description,
		tagSchema: YAML.stringify(buildTagSchema(domain)),
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

function buildCustomPrompts(sources: Source[], domains: DomainConfig[]): Record<string, string> {
	const prompts: Record<string, string> = {};

	for (const domain of domains) {
		const tagSchemaJson = JSON.stringify(buildTagSchema(domain), null, 2);
		for (const source of sources) {
			const prompt = source.getProcessingPrompt?.(domain.description, tagSchemaJson);
			if (prompt) prompts[`${domain.name}/${source.sourceId}`] = prompt;
		}
	}

	return prompts;
}

function buildSourceRuns(sources: Source[], flags: IndexCommandFlags, ctx: RunContext): SourceRun[] {
	const runMap = new Map<SourceId, SourceRun>();

	for (const domain of ctx.config.domains) {
		const context: SourceContext = { ...ctx, domainConfig: domain, domain: domain.name };
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

async function runSource(source: Source, publishers: PublisherTask[]): Promise<PublisherError[]> {
	const logger = createLogger(source.sourceId);
	const errors: PublisherError[] = [];

	for (const [i, { publisherId, context }] of publishers.entries()) {
		try {
			logger.info(`Fetching publisher ${i + 1}/${publishers.length}`);
			await source.runOnce(context, publisherId);
		} catch (error) {
			errors.push({ sourceId: source.sourceId, publisherId, error });
			logger.error(`Error processing '${publisherId}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	logger.info("Fetching completed");

	return errors;
}

function isProviderFactory(value: unknown): value is ProviderFactory {
	return typeof value === "function";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).map(([key, value]) => {
			if (typeof value === "string" && value.startsWith("env.")) return [key, process.env[value.slice(4)]];
			if (isPlainObject(value)) return [key, resolveEnvVars(value)];
			return [key, value];
		}),
	);
}
