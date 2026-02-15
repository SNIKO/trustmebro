import {
	type LogContext,
	log,
	logFetchingItemsCompleted,
	logFetchingItemsStarted,
} from "../../ui/logger.js";
import type { Source, SourceContext } from "../types.js";
import { listPostsBatched } from "./fetch.js";
import { processPost } from "./process.js";
import { getRedditProcessingPrompt } from "./process-prompt.js";
import { RedditState } from "./state.js";
import type { RedditPost } from "./types.js";

/** Overlap window: re-check posts within this period for comment updates */
const OVERLAP_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export function createRedditSource(): Source {
	return {
		sourceId: "reddit",
		getProcessingPrompt: getRedditProcessingPrompt,

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const ctx: LogContext = {
				source: "reddit",
				publisher: publisherId,
			};

			const state = new RedditState(context.workspacePath);
			await state.load();

			const redditConfig = context.config.sources.reddit;
			const minCommentCount = redditConfig?.commentsCountThreshold ?? 0;

			logFetchingItemsStarted("reddit", publisherId);

			const isBackfillComplete = state.isBackfillComplete(publisherId);
			const latestFetched = state.getLatestFetched(publisherId);

			// Determine cutoff date:
			// - Backfill complete: fetch from (latestFetched - overlap) to catch updated posts
			// - Backfill not complete: fetch all posts till config start date
			const cutoffDate =
				isBackfillComplete && latestFetched !== null
					? new Date(latestFetched - OVERLAP_MS)
					: context.config.startDate;

			const postsToReindex: RedditPost[] = [];
			let reachedEndForBackfill = false;

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
						// New post: process immediately
						const result = await processPost({
							context,
							subreddit: publisherId,
							post,
							state,
							minCommentCount,
						});
						logResult(ctx, result);
					} else if (
						state.shouldReindex(publisherId, post.id, post.num_comments)
					) {
						// Existing post with significant comment increase: queue for re-index
						postsToReindex.push(post);
					}
				}
			}

			// Mark backfill complete if we fetched all the way to config start date
			if (
				!isBackfillComplete &&
				cutoffDate.getTime() === context.config.startDate.getTime() &&
				reachedEndForBackfill
			) {
				await state.markBackfillComplete(publisherId);
			}

			logFetchingItemsCompleted("reddit", publisherId);

			// Process posts that need re-indexing
			for (const post of postsToReindex) {
				const result = await processPost({
					context,
					subreddit: publisherId,
					post,
					state,
					minCommentCount,
					isReindex: true,
				});
				logResult(ctx, result);
			}
		},
	};
}

function logResult(
	ctx: LogContext,
	result: { status: string; title?: string; reason?: string },
): void {
	const title = result.title ?? "<unknown>";

	switch (result.status) {
		case "indexed":
			log.info(`Fetched '${title}'`, ctx);
			break;
		case "updated":
			log.info(`Re-indexed '${title}'`, ctx);
			break;
		case "skipped":
			log.info(`Skipped '${title}'`, ctx, {
				reason: result.reason ?? "unknown",
			});
			break;
		case "error":
			log.error(`Failed '${title}' (${result.reason ?? "unknown error"})`, ctx);
			break;
	}
}
