import type { AgentType } from "./types.js";

export function generateFrontmatter(
	skillName: string,
	skillDescription: string,
	agent: AgentType,
): string {
	switch (agent) {
		case "claude-code":
			return `---
name: ${skillName}
description: ${skillDescription}
---`;

		case "codex":
			// Codex uses a simpler format
			return `# ${skillName}

> ${skillDescription}`;

		case "opencode":
			// OpenCode uses TOML-style frontmatter
			return `+++
name = "${skillName}"
description = "${skillDescription}"
+++`;

		default:
			return `---
name: ${skillName}
description: ${skillDescription}
---`;
	}
}
