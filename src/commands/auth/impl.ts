import { buildSources } from "../../sources/index.js";
import type { AuthCommandFlags } from "./command.js";

export async function auth(flags: AuthCommandFlags): Promise<void> {
	const workspacePath = flags.workspacePath ?? ".";
	const sources = buildSources();

	const sourcesToAuth = flags.source ? sources.filter((s) => s.sourceId === flags.source) : sources;

	if (sourcesToAuth.length === 0) {
		return;
	}

	for (const source of sourcesToAuth) {
		if (source.authenticate) {
			const authenticated = await source.authenticate(workspacePath);
			if (!authenticated) throw new Error(`Authentication failed for source '${source.sourceId}'.`);
		}
	}
}
