import { buildCommand } from "@stricli/core";

export const indexCommand = buildCommand({
	loader: async () => {
		const { index } = await import("./run");
		return index;
	},
	parameters: {
		flags: {
			workspacePath: {
				kind: "parsed",
				parse: String,
				optional: true,
				brief: "Path to the workspace directory where artifacts are stored. It must contain a config.yaml file.",
			},
			debug: {
				kind: "boolean",
				brief: "Show debug log entries in the terminal UI",
				optional: true,
			},
		},
	},
	docs: {
		brief: "Continuously index items from configured sources",
		fullDescription:
			"Runs continuously. Each configured source repeats after its global indexing.sources.<source>.updateIntervalMinutes interval once that source's fetch cycle completes.",
	},
});
