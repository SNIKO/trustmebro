import type { Config, SourceId } from "../config.js";
import type { ContentEngine } from "../content/index.js";
import type { LanguageModel } from "ai";

export interface SourceContext {
	config: Config;
	workspacePath: string;
	engine: ContentEngine;
	model: LanguageModel;
}

export interface Source {
	sourceId: SourceId;
	runOnce(context: SourceContext, publisherId: string): Promise<void>;
	getProcessingPrompt?(topic: string, tagSchema: string): string;
	authenticate?(workspacePath: string): Promise<boolean>;
}
