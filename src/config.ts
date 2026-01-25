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
	workers: z.coerce.number().int().positive().optional().default(5),
	model: modelConfigSchema,
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

const configSchema = z.object({
	startDate: z.coerce.date(),
	topic: z.string(),
	indexing: indexingConfigSchema,
	tags: tagsSchema,
	sources: z.object({
		youtube: publisherConfigSchema.optional(),
		telegram: publisherConfigSchema.optional(),
		twitter: publisherConfigSchema.optional(),
		reddit: redditConfigSchema.optional(),
	}),
});

export type SourceConfig = z.infer<typeof publisherConfigSchema>;
export type Config = z.infer<typeof configSchema>;

export async function loadConfig(configPath: string): Promise<Config> {
	const rawText = await readFile(configPath, "utf8");
	const clean = rawText.replace(/^\uFEFF/, "");
	const parsed = parse(clean);

	return configSchema.parse(parsed);
}
