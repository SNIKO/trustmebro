import type { Config, SourceId } from "../config.js";
import type { ContentEngine } from "../content/index.js";

export interface SourceContext {
	config: Config;
	workspacePath: string;
	engine: ContentEngine;
}

export interface Source {
	sourceId: SourceId;
	runOnce(context: SourceContext, publisherId: string): Promise<void>;
	getProcessingPrompt?(topic: string, tagSchema: string): string;
	authenticate?(workspacePath: string): Promise<boolean>;
}
