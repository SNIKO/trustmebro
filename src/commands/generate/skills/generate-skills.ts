import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config, ConfigTag, ConfigTags, DomainConfig } from "../../../config.js";
import { createDomainReference, createSkillIndex, SOCIAL_SKILL_NAME } from "./social-skill.js";
import type { AgentType, DomainSkillData, SkillCreationOptions } from "./types.js";

/**
 * Select example fields from the tag schema, prioritizing fields with enum values.
 */
function buildExampleFields(tags: ConfigTags, count: number): Array<{ name: string; value: string }> {
	const getValue = (tagName: string, t: ConfigTag) =>
		t.type === "enum" || t.type === "enum[]" ? (t.values[0] ?? `${tagName}_val_1`) : `${tagName}_val_1`;

	const entries = Object.entries(tags).sort(([, a], [, b]) => ("values" in b ? 1 : 0) - ("values" in a ? 1 : 0));

	return entries.slice(0, count).map(([name, field]) => ({
		name,
		value: getValue(name, field),
	}));
}

function buildTagReferenceList(tags: ConfigTags): string {
	return Object.entries(tags)
		.map(([name, field]) => {
			const typeDisplay = field.type;
			const enumSuffix =
				(field.type === "enum" || field.type === "enum[]") && field.values.length > 0
					? ` — values: \`${field.values.join("`, `")}\``
					: "";
			return `- \`${name}\` (*${typeDisplay}*)${enumSuffix}`;
		})
		.join("\n");
}

function buildPublishers(domain: DomainConfig): Partial<Record<string, string[]>> {
	const result: Partial<Record<string, string[]>> = {};
	for (const [platformId, cfg] of Object.entries(domain.sources)) {
		if (cfg && cfg.publishers.length > 0) {
			result[platformId] = cfg.publishers;
		}
	}
	return result;
}

function buildDomainSkillData(domain: DomainConfig): DomainSkillData {
	const processedPath = `${domain.contentDir}/processed/${domain.name}`;
	const rawPath = `${domain.contentDir}/raw/${domain.name}`;
	return {
		name: domain.name,
		description: domain.description,
		processedPath,
		rawPath,
		tagReferenceList: buildTagReferenceList(domain.tags),
		exampleFields: buildExampleFields(domain.tags, 4),
		publishers: buildPublishers(domain),
	};
}

/**
 * Get the skill folder path based on agent type.
 * All agents use a folder so the references/ subfolder can live alongside SKILL.md.
 */
function getSkillDir(agent: AgentType): string {
	switch (agent) {
		case "claude-code":
			return path.join(".claude", "skills", SOCIAL_SKILL_NAME);
		case "codex":
			return path.join(".codex", "skills", SOCIAL_SKILL_NAME);
		case "opencode":
			return path.join(".opencode", "skills", SOCIAL_SKILL_NAME);
		default:
			return path.join(".claude", "skills", SOCIAL_SKILL_NAME);
	}
}

function getSkillIndexFileName(agent: AgentType): string {
	switch (agent) {
		case "claude-code":
			return "SKILL.md";
		case "codex":
		case "opencode":
			return "SKILL.md";
		default:
			return "SKILL.md";
	}
}

async function saveFile(filePath: string, content: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content, "utf8");
}

/**
 * Generate all skill files (index + per-domain references) for the given agent type.
 * Returns the list of written file paths.
 */
export async function generateSkills(config: Config, agent: AgentType): Promise<string[]> {
	const skillDir = getSkillDir(agent);

	const domainSkillData = config.domains.map((d) => buildDomainSkillData(d));

	const options: SkillCreationOptions = {
		agent,
		contentDir: config.domains[0]?.contentDir ?? ".",
		domains: domainSkillData,
	};

	const writtenPaths: string[] = [];

	// Write the index SKILL.md
	const indexPath = path.join(skillDir, getSkillIndexFileName(agent));
	await saveFile(indexPath, createSkillIndex(options));
	writtenPaths.push(indexPath);

	// Write per-domain reference files
	for (const domainData of domainSkillData) {
		const refPath = path.join(skillDir, "references", `${domainData.name}.md`);
		await saveFile(refPath, createDomainReference(domainData));
		writtenPaths.push(refPath);
	}

	return writtenPaths;
}
