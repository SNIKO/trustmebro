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
				brief: "Fetch only the publisher with this id",
			},
		},
	},
	docs: {
		brief: "Continuously index items from configured sources",
		fullDescription:
			"Runs continuously, polling each configured source on its poll interval. Use --source to limit to one provider and --publisher to target a single publisher.",
	},
});
