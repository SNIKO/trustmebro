import { statusBar } from "../../ui/status-bar.js";
import type { SourceContext } from "../types.js";
import { fetchPostWithComments } from "./fetch.js";
import { ingestPost } from "./ingest.js";
import type { RedditState } from "./state.js";
import type { PostRunResult, RedditPost } from "./types.js";

export async function processPost(args: {
	context: SourceContext;
	subreddit: string;
	post: RedditPost;
	state: RedditState;
	minCommentCount: number;
	isReindex?: boolean;
}): Promise<PostRunResult> {
	const { context, subreddit, post, state, minCommentCount, isReindex } = args;
	const postId = post.id;

	const fetchKey = `reddit:${subreddit}:${postId}`;
	statusBar.addFetchingItem(fetchKey, {
		sourceId: "reddit",
		publisherId: subreddit,
		title: post.title,
	});

	try {
		// Check comment count threshold
		if (post.num_comments < minCommentCount) {
			return {
				postId,
				status: "skipped",
				reason: "below-comment-threshold",
				title: post.title,
			};
		}

		const publishedAt = new Date(post.created_utc * 1000);
		if (publishedAt < context.config.startDate) {
			return {
				postId,
				status: "skipped",
				reason: "before-start-date",
				title: post.title,
			};
		}

		// Fetch full post with comments
		const postData = await fetchPostWithComments(
			subreddit,
			postId,
			context.config.sources.reddit?.sleepBetweenRequestsMs ?? 1000,
		);
		if (!postData) {
			return {
				postId,
				status: "error",
				reason: "fetch-failed",
				title: post.title,
			};
		}

		// Switch from fetching -> indexing
		statusBar.removeFetchingItem(fetchKey);

		const ingested = await ingestPost({
			context,
			subreddit,
			postData,
			publishedAt,
		});

		if (!ingested) {
			return {
				postId,
				status: "error",
				reason: "ingest-failed",
				title: post.title,
			};
		}

		await state.markIndexed(
			subreddit,
			postId,
			post.num_comments,
			post.created_utc * 1000,
		);

		return {
			postId,
			status: isReindex ? "updated" : "indexed",
			title: post.title,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { postId, status: "error", reason: message, title: post.title };
	} finally {
		statusBar.removeFetchingItem(fetchKey);
	}
}
