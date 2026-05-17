import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LanguageModel } from "ai";
import { generateText } from "ai";

import type { SourceId } from "../config.js";
import type { DomainEntry } from "./engine.types.js";

export async function enrichDocument(args: {
	rawFilePath: string;
	processedFilePath: string;
	domain: DomainEntry;
	sourceId: SourceId;
	model: LanguageModel;
	customPrompts: Record<string, string>;
}): Promise<void> {
	const { rawFilePath, processedFilePath, domain, sourceId, model, customPrompts } = args;
	const rawContent = await readFile(rawFilePath, "utf8");
	const { frontMatter, body } = parseRawFile(rawContent);

	const promptTemplate = customPrompts[`${domain.name}/${sourceId}`] ?? buildDefaultPrompt(domain);
	const prompt = promptTemplate.replace("{CONTENT}", body);

	const { text } = await generateText({ model, prompt, maxRetries: 0 });

	await mkdir(path.dirname(processedFilePath), { recursive: true });

	const processedContent = `---\n${frontMatter}---\n\n${text}`;
	await writeFile(`${processedFilePath}.tmp`, processedContent, "utf8");
	await rename(`${processedFilePath}.tmp`, processedFilePath);
}

function parseRawFile(content: string): { frontMatter: string; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
	if (!match) return { frontMatter: "", body: content };
	return { frontMatter: `${match[1]}\n`, body: match[2] ?? "" };
}

function buildDefaultPrompt(domain: DomainEntry): string {
	return `# INSTRUCTIONS
Clean, chunk, and tag the raw content for **grep-based search** in the domain: ${domain.name}.

## Core Principle
Optimize for **single-pass grep scanning**: a single grep hit should reveal what a chunk is about without reading other chunks.

## Objectives
- Remove noise and boilerplate: ads, sponsors, intros/outros, CTAs, repetitions, contact or social links, and sign-offs.
- Preserve **all meaning and factual detail exactly** (facts, names, dates, numbers, ranges, uncertainty, conditions, and meaningful URLs).
- Use **minimal wording** while keeping all information.
- Chunk the content into **semantic sections** (prefer fewer, richer chunks when possible; do not pad content to reach size targets).

## Output Format (Markdown only)

\`\`\`markdown
## 01 Short descriptive title for chunk 1
field_1=value_1,value_4
field_2=value_2
field_3=value_3
<cleaned, condensed content>

## 02 Short descriptive title for chunk 2
field_1=value_1
field_4=value_4
field_5=value_5,value_6
<cleaned, condensed content>
\`\`\`

## Tagging Rules
- Use ONLY fields defined in the SCHEMA (field names must exactly match schema).
- Do not invent new fields.
- Omit fields with no value.
- One tag field per line.
- DO NOT duplicate fields. For arrays, use comma-separated values.
- For enums, use only allowed enum values from the schema.
- Use ISO-8601 for dates (YYYY-MM-DD).
- Keep tag values grep-friendly: snake_case where appropriate, tickers/codes/symbols in UPPERCASE.
- Maintain tag order as per schema.

## Content Rules
- Output MUST be plain text or Markdown with simple formatting (headings, lists, bold/italic).
- Rewrite content to be token-efficient and grep-efficient without altering meaning.
- Split content into short paragraphs separated by blank lines.
- Each paragraph MUST be 1-3 sentences.
- Each sentence MUST be declarative and information-dense.
- Keep entities, tickers, and terms explicit; avoid pronouns.
- Normalize numbers (e.g., "1,000,000.00", "24%").
- Preserve uncertainty, ranges, and conditional statements exactly.
- Do not add interpretation, synthesis, or analysis.
- Preserve emotional tone and intent where relevant.
- Use scores and reaction metrics (likes, dislikes, upvotes, downvotes) to infer which posts or comments carry higher importance, agreement, disagreement, or emotional weight. Incorporate these signals when summarizing content and when determining how to break it into semantic chunks.

## Tag Schema

${domain.tagSchema}

## Content to Process

{CONTENT}`;
}
