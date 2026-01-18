import { sleep } from "bun";
import {
	logFetchingItemsCompleted,
	logFetchingItemsStarted,
	logItemFetched,
	type SourceLogContext,
} from "../../ui/logger.js";
import type { Source, SourceContext } from "../types.js";
import { listPostsBatched } from "./fetch.js";
import { processPost } from "./process.js";
import { RedditState } from "./state.js";
import type { RedditPost } from "./types.js";

export function createRedditSource(): Source {
	return {
		sourceId: "reddit",

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const logContext = {
				sourceId: "reddit",
				publisherId,
			} as SourceLogContext;

			const state = new RedditState(context.workspacePath);
			await state.load();

			const redditConfig = context.config.sources.reddit;
			const minCommentCount = redditConfig?.commentsCountThreshold ?? 0;

			logFetchingItemsStarted("reddit", publisherId);

			// Process posts batch by batch (100 at a time)
			// This ensures state is persisted between batches, so if something fails
			// we don't lose all the work done so far
			const postsToReindex: RedditPost[] = [];

			for await (const batch of listPostsBatched(
				publisherId,
				context.config.startDate,
			)) {
				// Separate posts in this batch
				const newPosts = batch.posts.filter(
					(p) => !state.contains(publisherId, p.id),
				);
				const existingPosts = batch.posts.filter((p) =>
					state.contains(publisherId, p.id),
				);

				// Collect posts that need re-indexing (process after all new posts)
				for (const post of existingPosts) {
					if (state.shouldReindex(publisherId, post.id, post.num_comments)) {
						postsToReindex.push(post);
					}
				}

				// Process new posts immediately (state persisted after each)
				for (const post of newPosts) {
					const result = await processPost({
						context,
						subreddit: publisherId,
						post,
						state,
						minCommentCount,
					});

					logResult(logContext, result);

					// Be nice to Reddit's API
					await sleep(
						context.config.sources.reddit?.sleepBetweenRequestsMs ?? 1000,
					);
				}
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

				logResult(logContext, result);
			}
		},
	};
}

function logResult(
	logContext: SourceLogContext,
	result: { status: string; title?: string; reason?: string },
): void {
	const title = result.title ?? "<unknown>";

	switch (result.status) {
		case "indexed":
			logItemFetched({
				context: logContext,
				status: "fetched",
				title,
			});
			break;
		case "updated":
			logItemFetched({
				context: logContext,
				status: "fetched",
				title: `${title} (re-indexed)`,
			});
			break;
		case "skipped":
			logItemFetched({
				context: logContext,
				status: "skipped",
				title,
				reason: result.reason ?? "unknown reason",
			});
			break;
		case "error":
			logItemFetched({
				context: logContext,
				status: "failed",
				title,
				reason: result.reason ?? "unknown error",
			});
			break;
	}
}
