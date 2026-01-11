import path from "node:path";
import { openai } from "@ai-sdk/openai";
import { createGreptor, type Greptor } from "greptor";
import { type Config, loadConfig, type SourceId } from "../../config.js";
import { buildSources } from "../../sources/index.js";
import type { SourceContext } from "../../sources/types.js";

type TagType = Config["tags"] extends Record<string, infer T>
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
		model: openai("gpt-5-mini") as unknown as Parameters<
			typeof createGreptor
		>[0]["model"],
		workers: 1,
		tagSchema,
	});
}

export async function index(
	flags: IndexCommandFlags,
): Promise<void> {
	const workspacePath = flags.workspacePath ?? ".";
	const configPath = path.join(workspacePath, "config.yaml");
	const dataPath = path.join(workspacePath, "data");
	const config = await loadConfig(configPath);
	const greptor = await createGreptorClient(config, dataPath);
	const sources = buildSources();
	const context: SourceContext = { config, workspacePath, greptor };

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

		for (const publisherId of publisherIds) {
			console.log(`[${source.sourceId}] ${publisherId}: starting run`);
			await source.runOnce(context, publisherId);
			console.log(`[${source.sourceId}] ${publisherId}: run complete`);
		}
	}

	console.log("Indexing run complete");
}
