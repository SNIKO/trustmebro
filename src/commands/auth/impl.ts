import { buildSources } from "../../sources/index.js";
import { log } from "../../ui/logger.js";
import type { AuthCommandFlags } from "./command.js";

export async function auth(flags: AuthCommandFlags): Promise<void> {
	const workspacePath = flags.workspacePath ?? ".";
	const sources = buildSources();

	const sourcesToAuth = flags.source
		? sources.filter((s) => s.sourceId === flags.source)
		: sources;

	if (sourcesToAuth.length === 0) {
		log.warn("No sources found to authenticate");
		return;
	}

	for (const source of sourcesToAuth) {
		if (source.authenticate) {
			log.info(`Authenticating with ${source.sourceId}...`, {
				source: source.sourceId,
			});
			const success = await source.authenticate(workspacePath);
			if (success) {
				log.info(`Successfully authenticated with ${source.sourceId}`, {
					source: source.sourceId,
				});
			} else {
				log.error(`Failed to authenticate with ${source.sourceId}`, {
					source: source.sourceId,
				});
			}
		} else {
			log.info(`Source ${source.sourceId} does not require authentication`, {
				source: source.sourceId,
			});
		}
	}
}
