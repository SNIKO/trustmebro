import type { CommandContext } from "@stricli/core";

// Stricli only needs a process-like object; Node's `process` already matches.
export type LocalContext = CommandContext;

export function buildContext(process: NodeJS.Process): LocalContext {
	return { process };
}
