import type { SourceContext } from "../types.js";
import {
	buildPostUrl,
	fetchPostWithComments,
	formatCommentsAsText,
} from "./fetch.js";
import type { RedditState } from "./state.js";
import type {
	PostRunResult,
	RedditPost,
	RedditPostWithComments,
} from "./types.js";

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

		const ingested = await ingestPostToGreptor({
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
	}
}

async function ingestPostToGreptor(args: {
	context: SourceContext;
	subreddit: string;
	postData: RedditPostWithComments;
	publishedAt: Date;
}): Promise<boolean> {
	const { context, subreddit, postData, publishedAt } = args;
	const { post, comments } = postData;

	const postUrl = buildPostUrl(post);

	// Build the document content: post body + comments
	const contentParts: string[] = [];

	// Add post title and body
	contentParts.push(`# ${post.title}`);
	contentParts.push("");

	if (post.selftext?.trim()) {
		contentParts.push(post.selftext);
		contentParts.push("");
	}

	// Add link if it's a link post
	if (!post.is_self && post.url) {
		contentParts.push(`Link: ${post.url}`);
		contentParts.push("");
	}

	// Add comments section
	if (comments.length > 0) {
		contentParts.push("---");
		contentParts.push("## Comments");
		contentParts.push("");
		contentParts.push(formatCommentsAsText(comments));
	}

	const content = contentParts.join("\n");

	const result = await context.greptor.eat({
		id: post.id,
		format: "text",
		label: post.title,
		source: "reddit",
		publisher: subreddit,
		creationDate: publishedAt,
		overwrite: true,
		content,
		tags: {
			subreddit: post.subreddit,
			author: post.author,
			score: post.score,
			upvoteRatio: post.upvote_ratio,
			commentCount: post.num_comments,
			flair: post.link_flair_text ?? "",
			isLinkPost: !post.is_self,
			postUrl,
		},
	});

	return result.success;
}
