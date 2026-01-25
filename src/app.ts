import { buildApplication, buildRouteMap, run } from "@stricli/core";
import { skillsCommand } from "./commands/generate/skills/command.js";
import { indexCommand } from "./commands/index/command.js";
import { buildContext } from "./context.js";

export const generateRoutes = buildRouteMap({
	routes: {
		skills: skillsCommand,
	},
	docs: {
		brief: "Generate assets for coding agents",
	},
});

const routes = buildRouteMap({
	routes: {
		index: indexCommand,
		generate: generateRoutes,
	},
	docs: {
		brief: "Fetch and index social media content for agentic search workflows.",
	},
});

export const app = buildApplication(routes, {
	name: "TrustMeBro",
	versionInfo: {
		currentVersion: "0.5.0",
	},
});

await run(app, process.argv.slice(2), buildContext(process));
