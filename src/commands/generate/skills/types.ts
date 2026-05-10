export type AgentType = "claude-code" | "codex" | "opencode";

export interface DomainSkillData {
	name: string;
	description: string;
	/** Relative path to processed content for this domain (e.g. data/social/processed/stock-market) */
	processedPath: string;
	rawPath: string;
	tagReferenceList: string;
	exampleFields: Array<{ name: string; value: string }>;
	/** Publishers per source platform (non-empty lists only) */
	publishers: Partial<Record<string, string[]>>;
}

export interface SkillCreationOptions {
	agent: AgentType;
	dataDir: string;
	domains: DomainSkillData[];
}
