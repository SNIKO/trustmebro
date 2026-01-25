import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config, ConfigTag, ConfigTags } from "../../../config.js";
import type { AgentType } from "./types.js";
import { createYoutubeSkill, YOUTUBE_SKILL_NAME } from "./youtube-skill.js";

/**
 * Select example fields from the tag schema, prioritizing fields with enum values.
 */
function buildExampleFields(
	tags: ConfigTags,
	count: number,
): Record<string, string>[] {
	const getValue = (tagName: string, t: ConfigTag) =>
		t.type === "enum" || t.type === "enum[]"
			? (t.values[0] ?? `${tagName}_val_1`)
			: `${tagName}_val_1`;

	const entries = Object.entries(tags).sort(
		([, a], [, b]) => ("values" in b ? 1 : 0) - ("values" in a ? 1 : 0),
	);

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
				(field.type === "enum" || field.type === "enum[]") &&
				field.values.length > 0
					? ` — values: \`${field.values.join("`, `")}\``
					: "";
			return `- \`${name}\` (*${typeDisplay}*)${enumSuffix}`;
		})
		.join("\n");
}

/**
 * Get the skill file path based on agent type.
 */
function getSkillPath(agent: AgentType, skillName: string): string {
	switch (agent) {
		case "claude-code":
			return path.join(".claude", "skills", skillName, "SKILL.md");
		case "codex":
			return path.join(".codex", "skills", `${skillName}.md`);
		case "opencode":
			return path.join(".opencode", "skills", `${skillName}.md`);
		default:
			return path.join(".claude", "skills", skillName, "SKILL.md");
	}
}

async function saveSkill(
	agent: AgentType,
	skillName: string,
	skillContent: string,
): Promise<string> {
	const skillPath = getSkillPath(agent, skillName);
	const skillDir = path.dirname(skillPath);

	await mkdir(skillDir, { recursive: true });
	await writeFile(skillPath, skillContent, "utf8");

	return skillPath;
}

/**
 * Generate a skill file for the give options and agent type.
 */
export async function generateSkills(
	config: Config,
	agent: AgentType,
): Promise<string[]> {
	const data = {
		agent: agent,
		exampleFields: buildExampleFields(config.tags, 4),
		tagReferenceList: buildTagReferenceList(config.tags),
	};
	const youtubeSkillContent = await createYoutubeSkill(data);

	const youtubeSkillPath = await saveSkill(
		agent,
		YOUTUBE_SKILL_NAME,
		youtubeSkillContent,
	);

	return [youtubeSkillPath];
}
