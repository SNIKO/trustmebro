import {
	cancel,
	intro,
	isCancel,
	log,
	outro,
	select,
	spinner,
} from "@clack/prompts";
import { buildCommand } from "@stricli/core";
import { type Config, loadConfig } from "../../../config.js";
import { generateSkills } from "./generate-skills.js";
import type { AgentType } from "./types.js";

async function generateSkillsCommand(): Promise<void> {
	console.clear();
	intro("greptor skills");

	const s = spinner();

	try {
		// Step 1: Select agent type
		const agent = await select<AgentType>({
			message: "Select agent type:",
			options: [
				{
					value: "claude-code",
					label: "Claude Code",
					hint: "Anthropic Claude Code agent",
				},
				{ value: "codex", label: "Codex", hint: "OpenAI Codex CLI agent" },
				{ value: "opencode", label: "OpenCode", hint: "OpenCode agent" },
			],
		});

		if (isCancel(agent)) {
			cancel("Cancelled");
			return;
		}

		// Step 2: Load config
		let config: Config;
		try {
			s.start("Loading configuration...");

			config = await loadConfig("./config.yaml");
			if (!config || !config.tags) {
				cancel("The current directory is not a valid trustmebro workspace.");
				return;
			}

			s.stop("Configuration loaded");
		} catch (error) {
			s.stop("Failed to load configuration");
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Configuration loading failed: ${message}`);
			throw new Error(`Failed to load config: ${message}`);
		}

		// Step 3: Generate skills
		s.start("Generating skills...");
		const skillPaths = await generateSkills(config, agent);
		s.stop(`Skills generated:\n${skillPaths.join("\n")}`);

		outro("Skill generation complete!");
	} catch (error) {
		s.stop("Error");
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Failed to generate skill: ${message}`);
		cancel("Generation failed");
	}
}

export const skillsCommand = buildCommand({
	func: generateSkillsCommand,
	parameters: {
		flags: {},
		positional: { kind: "tuple", parameters: [] },
	},
	docs: {
		brief:
			"Generate skills for AI agents to effectively navigate and utilize the fetched data.",
	},
});
