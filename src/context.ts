import type { CommandContext } from "@stricli/core";
import { createLogger } from "./utils/logger.js";

export interface LocalContext extends CommandContext {
	createLogger: typeof createLogger;
}

export function buildContext(process: NodeJS.Process): LocalContext {
	return { process, createLogger };
}
