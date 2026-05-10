import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

export const DATA_DIR_NAME = "data/social";

export const sourceIdSchema = z.enum([
	"youtube",
	"telegram",
	"twitter",
	"reddit",
]);
export type SourceId = z.infer<typeof sourceIdSchema>;

const configTagSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum(["enum", "enum[]"]),
		description: z.string().optional(),
		values: z.array(z.string()),
	}),
	z.object({
		type: z.enum([
			"string",
			"number",
			"boolean",
			"string[]",
			"number[]",
			"date",
		]),
		description: z.string().optional(),
	}),
]);

const tagsSchema = z.record(z.string(), configTagSchema);

export type ConfigTag = z.infer<typeof configTagSchema>;

export type ConfigTags = z.infer<typeof tagsSchema>;

export type TagType = ConfigTag["type"];

const publisherConfigSchema = z.object({
	publishers: z.array(z.string()).default([]),
});

const telegramConfigSchema = z.object({
	publishers: z.array(z.string()).default([]),
	/** Minimum message length (characters) to index. Messages shorter than this with no images are ignored. */
	minMessageLength: z.coerce
		.number()
		.int()
		.nonnegative()
		.optional()
		.default(200),
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

const redditConfigSchema = z.object({
	publishers: z.array(z.string()).default([]),
	/** Minimum number of comments required for a post to be indexed */
	commentsCountThreshold: z.coerce
		.number()
		.int()
		.nonnegative()
		.optional()
		.default(0),
	sleepBetweenRequestsMs: z.coerce
		.number()
		.int()
		.nonnegative()
		.optional()
		.default(1000),
});

export type RedditConfig = z.infer<typeof redditConfigSchema>;

const modelConfigSchema = z.object({
	provider: z.string(),
	model: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
});

const indexingConfigSchema = z.object({
	workers: z.coerce.number().int().optional().default(5),
	model: modelConfigSchema,
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

const domainSourcesSchema = z.object({
	youtube: publisherConfigSchema.optional(),
	telegram: telegramConfigSchema.optional(),
	twitter: publisherConfigSchema.optional(),
	reddit: redditConfigSchema.optional(),
});

const domainConfigSchema = z.object({
	/** Slug used as the folder name for storage and reference files (kebab-case). */
	name: z
		.string()
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"Domain name must be kebab-case (e.g. stock-market)",
		),
	description: z.string(),
	sources: domainSourcesSchema,
	tags: tagsSchema,
});

const configSchema = z.object({
	startDate: z.coerce.date(),
	indexing: indexingConfigSchema,
	domains: z.array(domainConfigSchema).min(1),
});

export type SourceConfig = z.infer<typeof publisherConfigSchema>;
export type DomainSources = z.infer<typeof domainSourcesSchema>;
export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type Config = z.infer<typeof configSchema>;

function normalizePublisherId(source: SourceId, id: string): string {
	let normalized = id;
	switch (source) {
		case "youtube":
		case "telegram":
		case "twitter":
			if (normalized.startsWith("@")) normalized = normalized.slice(1);
			break;
		case "reddit":
			if (normalized.startsWith("r/")) normalized = normalized.slice(2);
			else if (normalized.startsWith("r:")) normalized = normalized.slice(2);
			break;
	}
	return normalized.toLowerCase();
}

function normalizePublishers(source: SourceId, publishers: string[]): string[] {
	return publishers.map((p) => normalizePublisherId(source, p));
}

function normalizeDomainSources(domain: DomainConfig): DomainConfig {
	const normalizedSources = Object.fromEntries(
		Object.entries(domain.sources).map(([key, sourceConfig]) => {
			if (!sourceConfig?.publishers) return [key, sourceConfig];
			return [
				key,
				{
					...sourceConfig,
					publishers: normalizePublishers(
						key as SourceId,
						sourceConfig.publishers,
					),
				},
			];
		}),
	);
	return { ...domain, sources: normalizedSources as DomainConfig["sources"] };
}

export async function loadConfig(configPath: string): Promise<Config> {
	const rawText = await readFile(configPath, "utf8");
	const clean = rawText.replace(/^\uFEFF/, "");
	const parsed = parse(clean);

	const config = configSchema.parse(parsed);
	return {
		...config,
		domains: config.domains.map(normalizeDomainSources),
	};
}
