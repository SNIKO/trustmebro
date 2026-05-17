import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

export const sourceIdSchema = z.enum(["youtube", "telegram", "twitter", "reddit"]);
export type SourceId = z.infer<typeof sourceIdSchema>;

const configTagSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum(["enum", "enum[]"]),
		description: z.string().optional(),
		values: z.array(z.string()),
	}),
	z.object({
		type: z.enum(["string", "number", "boolean", "string[]", "number[]", "date"]),
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
	minMessageLength: z.coerce.number().int().nonnegative().default(200),
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

const redditConfigSchema = z.object({
	publishers: z.array(z.string()).default([]),
	/** Minimum number of comments required for a post to be indexed */
	commentsCountThreshold: z.coerce.number().int().nonnegative().default(0),
	sleepBetweenRequestsMs: z.coerce.number().int().nonnegative().default(1000),
});

export type RedditConfig = z.infer<typeof redditConfigSchema>;

const modelConfigSchema = z.object({
	provider: z.string(),
	model: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

const indexingConfigSchema = z.object({
	workers: z.coerce.number().int().default(5),
	model: modelConfigSchema,
});

const domainSourcesSchema = z.object({
	youtube: publisherConfigSchema.optional(),
	telegram: telegramConfigSchema.optional(),
	twitter: publisherConfigSchema.optional(),
	reddit: redditConfigSchema.optional(),
});

const domainConfigSchema = z
	.object({
		/** Slug used as the folder name for storage and reference files (kebab-case). */
		name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Domain name must be kebab-case (e.g. stock-market)"),
		description: z.string(),
		/** Relative or absolute path for storing fetched and indexed content. Defaults to ./{name}. */
		contentDir: z.string().optional(),
		/** Fetch content published on or after this date. */
		startDate: z.coerce.date(),
		sources: domainSourcesSchema,
		tags: tagsSchema,
	})
	.transform((d) => ({ ...d, contentDir: d.contentDir ?? d.name }));

const configSchema = z.object({
	indexing: indexingConfigSchema,
	domains: z.array(domainConfigSchema).min(1),
});

export type SourceConfig = z.infer<typeof publisherConfigSchema>;
export type DomainSources = z.infer<typeof domainSourcesSchema>;
export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type Config = z.infer<typeof configSchema>;

export async function loadConfig(configPath: string): Promise<Config> {
	const rawText = await readFile(configPath, "utf8");
	const config = configSchema.parse(parse(rawText.replace(/^\uFEFF/, "")));
	return { ...config, domains: config.domains.map(normalizeDomain) };
}

function normalizeDomain(domain: DomainConfig): DomainConfig {
	const { youtube, telegram, twitter, reddit } = domain.sources;
	return {
		...domain,
		sources: {
			youtube: youtube
				? { ...youtube, publishers: youtube.publishers.map((p) => normalizePublisherId("youtube", p)) }
				: undefined,
			telegram: telegram
				? { ...telegram, publishers: telegram.publishers.map((p) => normalizePublisherId("telegram", p)) }
				: undefined,
			twitter: twitter
				? { ...twitter, publishers: twitter.publishers.map((p) => normalizePublisherId("twitter", p)) }
				: undefined,
			reddit: reddit
				? { ...reddit, publishers: reddit.publishers.map((p) => normalizePublisherId("reddit", p)) }
				: undefined,
		},
	};
}

function normalizePublisherId(source: SourceId, id: string): string {
	const prefixes: Record<SourceId, string[]> = {
		youtube: ["@"],
		telegram: ["@"],
		twitter: ["@"],
		reddit: ["r/", "r:"],
	};
	const prefix = prefixes[source].find((p) => id.startsWith(p)) ?? "";
	return id.slice(prefix.length).toLowerCase();
}
