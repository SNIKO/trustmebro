import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

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

export type ConfigTag = z.infer<typeof configTagSchema>;

export type TagType = ConfigTag["type"];

const publisherConfigSchema = z.object({
	publishers: z.array(z.string()).default([]),
	pollIntervalMinutes: z.coerce
		.number()
		.int()
		.positive()
		.optional()
		.default(60),
});

const modelConfigSchema = z.object({
	provider: z.string(),
	model: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

const configSchema = z.object({
	startDate: z.coerce.date(),
	topic: z.string(),
	model: modelConfigSchema,
	tags: z.record(z.string(), configTagSchema).optional(),
	sources: z.object({
		youtube: publisherConfigSchema.optional(),
		telegram: publisherConfigSchema.optional(),
		twitter: publisherConfigSchema.optional(),
		reddit: publisherConfigSchema.optional(),
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
