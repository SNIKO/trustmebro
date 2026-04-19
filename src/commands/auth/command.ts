import { buildCommand } from "@stricli/core";
import { sourceIdSchema } from "../../config.js";
import { buildSources } from "../../sources/index.js";

export interface AuthCommandFlags {
	workspacePath?: string;
	source?: string;
}

export const authCommand = buildCommand({
	loader: async () => {
		const { auth } = await import("./impl");
		return auth;
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
				brief: "Authenticate with a specific source",
			},
		},
	},
	docs: {
		brief: "Authenticate with configured sources",
		fullDescription:
			"Runs authentication for sources that require login. Use --source to limit to one provider.",
	},
});
