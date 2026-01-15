import path from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGreptor, type Greptor } from "greptor";
import { type Config, loadConfig, type SourceId } from "../../config.js";
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
		// TODO: Align greptor + AI SDK model types during refactor.
		model: createOpenAICompatible({
			baseURL: "https://integrate.api.nvidia.com/v1",
			name: "moonshotai",
			apiKey: process.env.NVIDIA_API_KEY,
		}).chatModel("z-ai/glm4.7"),
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
