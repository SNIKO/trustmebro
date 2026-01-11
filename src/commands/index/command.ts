import { buildCommand } from "@stricli/core";
import { sourceIdSchema } from "../../config.js";

export const indexCommand = buildCommand({
	loader: async () => {
		const { index } = await import("./impl");
		return index;
	},
	parameters: {
		flags: {
			workspacePath: {
				kind: "parsed",
				parse: String,
				optional: true,
				brief:
					"Path to the workspace directory where artifacts are stored. It must contain a config.yaml file.",
			},
			source: {
				kind: "enum",
				values: sourceIdSchema.options,
				optional: true,
				brief: "Limit to a specific source",
			},
			publisher: {
				kind: "parsed",
				parse: String,
				optional: true,
				brief: "Fetch only the channel with this id",
			},
		},
	},
	docs: {
		brief: "Index items once from configured sources",
		fullDescription:
			"Runs a single pass over configured sources. Use --source to limit to one provider and --channel to target a single channel.",
	},
});
