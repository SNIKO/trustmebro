import path from "node:path";
import { createGreptor, type Greptor } from "greptor";
import {
	type Config,
	loadConfig,
	type ModelConfig,
	type SourceId,
} from "../../config.js";
import { buildSources } from "../../sources/index.js";
import type { SourceContext } from "../../sources/types.js";
import {
	logGreptorDocumentCompleted as logDocumentProcessingCompleted,
	logGreptorError,
	logger,
	logGreptorRunCompleted as logProcessingRunCompleted,
	logGreptorRunStarted as logProcessingRunStarted,
	logSourceStart,
} from "../../utils/logger.js";

type TagType =
	Config["tags"] extends Record<string, infer T>
		? T extends { type: infer K }
			? K
			: never
		: never;

const PROVIDER_EXPORTS: Record<string, string> = {
	"@ai-sdk/amazon-bedrock": "createAmazonBedrock",
	"@ai-sdk/anthropic": "createAnthropic",
	"@ai-sdk/azure": "createAzure",
	"@ai-sdk/cerebras": "createCerebras",
	"@ai-sdk/cohere": "createCohere",
	"@ai-sdk/deepinfra": "createDeepInfra",
	"@ai-sdk/google": "createGoogleGenerativeAI",
	"@ai-sdk/google-vertex": "createVertex",
	"@ai-sdk/groq": "createGroq",
	"@ai-sdk/mistral": "createMistral",
	"@ai-sdk/openai": "createOpenAI",
	"@ai-sdk/openai-compatible": "createOpenAICompatible",
	"@ai-sdk/perplexity": "createPerplexity",
	"@ai-sdk/togetherai": "createTogetherAI",
	"@ai-sdk/xai": "createXai",
	"@openrouter/ai-sdk-provider": "createOpenRouter",
};

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

async function createModel(modelConfig: ModelConfig) {
	const exportName = PROVIDER_EXPORTS[modelConfig.provider];
	if (!exportName) {
		throw new Error(`Unknown provider: ${modelConfig.provider}`);
	}
	const mod = await import(modelConfig.provider);
	const factory = mod[exportName];
	const options = modelConfig.options
		? resolveEnvVars(modelConfig.options)
		: {};
	const sdk = factory(options);
	return sdk.chatModel(modelConfig.model);
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

	return createGreptor({
		baseDir: basePath,
		topic: config.topic,
		model: await createModel(config.model),
		workers: 1,
		tagSchema,
		hooks: {
			onProcessingRunStarted: logProcessingRunStarted,
			onDocumentProcessingCompleted: logDocumentProcessingCompleted,
			onProcessingRunCompleted: logProcessingRunCompleted,
			onError: logGreptorError,
		},
	});
}

export async function index(flags: IndexCommandFlags): Promise<void> {
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
			continue;
		}

		const publisherIds = flags.publisher
			? [flags.publisher]
			: sourceConfig.publishers;

		if (publisherIds.length > 0) {
			sourcesToProcess.push({ source, publisherIds });
		}
	}

	// Process each source
	for (const { source, publisherIds } of sourcesToProcess) {
		for (const publisherId of publisherIds) {
			logSourceStart({ sourceId: source.sourceId, publisherId });
			await source.runOnce(context, publisherId);
		}
	}

	logger.info("Indexing run complete");
}
