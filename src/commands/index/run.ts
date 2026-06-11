import path from "node:path";

import type { LanguageModel } from "ai";
import YAML from "yaml";

import { type Config, type DomainConfig, loadConfig, type SourceId } from "../../config.js";
import { type ContentEngine, createContentEngine, type DomainEntry } from "../../content/index.js";
import { buildSources } from "../../sources/index.js";
import type { Source, SourceContext } from "../../sources/types.js";
import type { ProgressReporter } from "../../ui/events.js";
import { startIndexUi } from "../../ui/index-tui.js";
import { createLogger, resetLogReporter, setLogReporter } from "../../utils/logger.js";

const log = createLogger("index");

export interface IndexCommandFlags {
	workspacePath?: string;
	debug?: boolean;
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
	const ui = startIndexUi(flags.debug === true);
	setLogReporter(ui.logReporter);

	try {
		await runIndex(flags, ui.progress);
	} finally {
		try {
			await ui.stop();
		} finally {
			resetLogReporter();
		}
	}
}

async function runIndex(flags: IndexCommandFlags, progress: ProgressReporter): Promise<void> {
	const workspacePath = flags.workspacePath ?? ".";
	const config = await loadConfig(path.join(workspacePath, "config.yaml"));
	const sources = buildSources();
	const model = await resolveModel(config);
	const engine = await createEngine(sources, config, workspacePath, model, progress);

	try {
		await engine.start();

		const ctx: RunContext = { config, workspacePath, engine, model };
		const sourceRuns = buildSourceRuns(sources, ctx);
		emitPublisherRows(sourceRuns, progress);

		if (sourceRuns.length === 0) {
			log.warn("No sources configured.");
			return;
		}

		log.info(`Running ${sourceRuns.length} source loop(s) across ${config.domains.length} domain(s).`);

		await checkAuthentication(
			sourceRuns.map(({ source }) => source),
			workspacePath,
		);

		await Promise.all(sourceRuns.map((sourceRun) => runSourceLoop(sourceRun, config, progress)));
	} finally {
		await engine.stop();
	}
}

async function resolveModel(config: Config): Promise<LanguageModel> {
	const { provider, model, options } = config.indexing.model;
	const providerModule = await import(provider);
	const entry = Object.entries(providerModule).find(
		(pair): pair is [string, ProviderFactory] => /^create[A-Z]/.test(pair[0]) && isProviderFactory(pair[1]),
	);
	if (!entry) throw new Error(`No provider factory found in ${provider}`);
	return entry[1](resolveEnvVars(options ?? {}))(model);
}

async function createEngine(
	sources: Source[],
	config: Config,
	workspacePath: string,
	model: LanguageModel,
	progress: ProgressReporter,
): Promise<ContentEngine> {
	return createContentEngine({
		domains: config.domains.map((d) => buildDomainEntry(d, workspacePath)),
		model,
		workers: config.indexing.workers,
		customPrompts: buildCustomPrompts(sources, config.domains),
		progress,
	});
}

function buildDomainEntry(domain: DomainConfig, workspacePath: string): DomainEntry {
	return {
		name: domain.name,
		description: domain.description,
		contentDir: path.resolve(workspacePath, domain.contentDir),
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

function buildSourceRuns(sources: Source[], ctx: RunContext): SourceRun[] {
	const runMap = new Map<SourceId, SourceRun>();

	for (const domain of ctx.config.domains) {
		const context: SourceContext = { ...ctx, domainConfig: domain, domain: domain.name };
		for (const source of sources) {
			addSourcePublishers(runMap, source, context);
		}
	}

	return [...runMap.values()];
}

function emitPublisherRows(sourceRuns: SourceRun[], progress: ProgressReporter): void {
	for (const { source, publishers } of sourceRuns) {
		for (const { context } of publishers) {
			progress.emit({
				type: "publisher-register",
				domain: context.domain,
				sourceId: source.sourceId,
			});
		}
	}
}

function addSourcePublishers(runMap: Map<SourceId, SourceRun>, source: Source, context: SourceContext): void {
	const sourceConfig = context.domainConfig.sources[source.sourceId];
	if (!sourceConfig) return;

	const publisherIds = sourceConfig.publishers;
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

async function runSourceLoop(sourceRun: SourceRun, config: Config, progress: ProgressReporter): Promise<never> {
	const { source, publishers } = sourceRun;
	const logger = createLogger(source.sourceId);
	const intervalMinutes = config.indexing.sources[source.sourceId].updateIntervalMinutes;
	const intervalMs = intervalMinutes * 60 * 1000;

	while (true) {
		logger.info(`Starting ${source.sourceId} fetch cycle for ${publishers.length} publisher(s).`);
		const errors = await runSource(source, publishers, progress);
		if (errors.length > 0) {
			logger.warn(`${source.sourceId} fetch cycle completed with ${errors.length} publisher error(s).`);
		} else {
			logger.info(`${source.sourceId} fetch cycle completed.`);
		}

		logger.info(`Waiting ${intervalMinutes} minute(s) before next ${source.sourceId} fetch cycle.`);
		await sleep(intervalMs);
	}
}

async function runSource(
	source: Source,
	publishers: PublisherTask[],
	progress: ProgressReporter,
): Promise<PublisherError[]> {
	const logger = createLogger(source.sourceId);
	const errors: PublisherError[] = [];

	for (const { publisherId, context } of publishers) {
		try {
			progress.emit({
				type: "publisher-start",
				domain: context.domain,
				sourceId: source.sourceId,
			});
			await source.runOnce(context, publisherId);
			progress.emit({ type: "publisher-complete", domain: context.domain, sourceId: source.sourceId });
		} catch (error) {
			errors.push({ sourceId: source.sourceId, publisherId, error });
			progress.emit({ type: "publisher-error", domain: context.domain, sourceId: source.sourceId });
			logger.error(`Error processing '${publisherId}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return errors;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
