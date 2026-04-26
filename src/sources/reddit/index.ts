import { createLogger } from "../../utils/logger.js";
import type { Source, SourceContext } from "../types.js";
import { listPostsBatched } from "./fetch.js";
import { processPost } from "./process.js";
import { getRedditProcessingPrompt } from "./process-prompt.js";
import { RedditState } from "./state.js";
import type { RedditPost } from "./types.js";

const log = createLogger("reddit");

/** Overlap window: re-check posts within this period for comment updates */
const OVERLAP_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export function createRedditSource(): Source {
	return {
		sourceId: "reddit",
		getProcessingPrompt: getRedditProcessingPrompt,

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const state = new RedditState(context.workspacePath);
			await state.load();

			const redditConfig = context.config.sources.reddit;
			const minCommentCount = redditConfig?.commentsCountThreshold ?? 0;

			const isBackfillComplete = state.isBackfillComplete(publisherId);
			const latestFetched = state.getLatestFetched(publisherId);

			const cutoffDate =
				isBackfillComplete && latestFetched !== null
					? new Date(latestFetched - OVERLAP_MS)
					: context.config.startDate;

			log.info(
				`Fetching ${publisherId} posts since ${cutoffDate.toISOString().split("T")[0]}`,
			);

			const postsToReindex: RedditPost[] = [];
			let reachedEndForBackfill = false;
			let processedCount = 0;
			let errorCount = 0;

			const fetchStart = Date.now();
			for await (const batch of listPostsBatched(
				publisherId,
				cutoffDate,
				context.config.sources.reddit?.sleepBetweenRequestsMs ?? 1000,
			)) {
				if (batch.reachedEnd && !isBackfillComplete) {
					reachedEndForBackfill = true;
				}

				if (batch.posts.length === 0) continue;

				for (const post of batch.posts) {
					const isIndexed = state.contains(publisherId, post.id);

					if (!isIndexed) {
						const result = await processPost({
							context,
							subreddit: publisherId,
							post,
							state,
							minCommentCount,
						});

						if (result.status === "indexed") {
							processedCount++;
							if (processedCount % 10 === 0) {
								log.info(
									`Processed ${processedCount} posts for ${publisherId}`,
								);
							}
						} else if (result.status === "error") {
							errorCount++;
							log.error(
								`Failed to index post "${post.title}": ${result.reason}`,
							);
						}
					} else if (
						state.shouldReindex(publisherId, post.id, post.num_comments)
					) {
						postsToReindex.push(post);
					}
				}
			}

			const fetchElapsed = ((Date.now() - fetchStart) / 1000).toFixed(0);
			log.info(`Fetched ${processedCount} posts (${fetchElapsed}s)`);

			if (
				!isBackfillComplete &&
				cutoffDate.getTime() === context.config.startDate.getTime() &&
				reachedEndForBackfill
			) {
				await state.markBackfillComplete(publisherId);
				log.info(`Backfill completed for subreddit ${publisherId}`);
			}

			if (postsToReindex.length > 0) {
				log.info(`Re-indexing ${postsToReindex.length} posts`);

				for (const post of postsToReindex) {
					const result = await processPost({
						context,
						subreddit: publisherId,
						post,
						state,
						minCommentCount,
						isReindex: true,
					});

					if (result.status === "indexed") {
						processedCount++;
					} else if (result.status === "error") {
						errorCount++;
						log.error(
							`Failed to re-index post "${post.title}": ${result.reason}`,
						);
					}
				}
			}

			log.info(
				`Completed ${publisherId} (${processedCount} items${errorCount > 0 ? `, ${errorCount} errors` : ""})`,
			);
		},
	};
}
