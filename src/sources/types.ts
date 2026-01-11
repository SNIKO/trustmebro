import type { Greptor } from "greptor";
import type { Config, SourceId } from "../config.js";

export interface SourceContext {
	config: Config;
	workspacePath: string;
	greptor: Greptor;
}

export interface Source {
	sourceId: SourceId;
	runOnce(context: SourceContext, publisherId: string): Promise<void>;
}
