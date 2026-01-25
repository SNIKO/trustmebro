export type AgentType = "claude-code" | "codex" | "opencode";

export interface SkillCreationOptions {
	agent: AgentType;
	exampleFields: Record<string, string>[];
	tagReferenceList: string;
}
