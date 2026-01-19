import { sleep } from "bun";
import type {
	RedditComment,
	RedditPost,
	RedditPostWithComments,
} from "./types.js";

const USER_AGENT = "trustmebro:v0.6.6 (sentiment analysis bot by /u/swniko)";
const REDDIT_API_BASE = "https://www.reddit.com";

type RedditListingResponse = {
	data: {
		children: Array<{
			kind: string;
			data: RedditPost;
		}>;
		after?: string;
	};
};

type RedditCommentsResponse = [
	RedditListingResponse,
	{
		data: {
			children: Array<{
				kind: string;
				data: RedditCommentData;
			}>;
		};
	},
];

type RedditCommentData = {
	id: string;
	author: string;
	body: string;
	score: number;
	created_utc: number;
	depth: number;
	replies?: {
		data?: {
			children?: Array<{
				kind: string;
				data: RedditCommentData;
			}>;
		};
	};
};

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
		},
	});

	if (!response.ok) {
		throw new Error(
			`Reddit API error: ${response.status} ${response.statusText}`,
		);
	}

	return response.json() as Promise<T>;
}

export type PostsBatch = {
	posts: RedditPost[];
	reachedStartDate: boolean;
	reachedEnd: boolean;
};

/**
 * Async generator that yields batches of posts from a subreddit.
 * Fetches 100 posts at a time, allowing processing between batches.
 * Stops when reaching posts before startDate.
 */
export async function* listPostsBatched(
	subreddit: string,
	startDate: Date,
	sleepBetweenRequestsMs: number,
): AsyncGenerator<PostsBatch> {
	let after: string | undefined;
	const startTimestamp = startDate.getTime() / 1000; // Convert to Unix timestamp

	while (true) {
		const params = new URLSearchParams({
			limit: "100",
			...(after && { after }),
		});
		const url = `${REDDIT_API_BASE}/r/${subreddit}/new.json?${params}`;
		const response = await fetchJson<RedditListingResponse>(url);

		const allPosts = response.data.children
			.filter((child) => child.kind === "t3") // t3 = post
			.map((child) => child.data);

		if (allPosts.length === 0) {
			yield { posts: [], reachedStartDate: false, reachedEnd: true };
			return; // No more posts
		}

		// Filter posts by date
		const postsInRange: RedditPost[] = [];
		let reachedStartDate = false;

		for (const post of allPosts) {
			if (post.created_utc >= startTimestamp) {
				postsInRange.push(post);
			} else {
				reachedStartDate = true;
				break;
			}
		}

		const reachedEnd = reachedStartDate || !response.data.after;

		if (postsInRange.length > 0) {
			yield { posts: postsInRange, reachedStartDate, reachedEnd };
		} else if (reachedStartDate) {
			// We hit the cutoff before collecting any posts from this page.
			// Still yield once so callers can observe termination.
			yield { posts: [], reachedStartDate: true, reachedEnd: true };
		}

		if (reachedStartDate) {
			return; // Stop pagination
		}

		// Check if there's more data to fetch
		after = response.data.after;
		if (!after) {
			return; // No more pages
		}

		// Be nice to Reddit's API
		await sleep(sleepBetweenRequestsMs);
	}
}

/**
 * Fetch a single post with all its comments.
 */
export async function fetchPostWithComments(
	subreddit: string,
	postId: string,
	sleepBetweenRequestsMs: number,
): Promise<RedditPostWithComments | null> {
	// Remove "t3_" prefix if present
	const cleanId = postId.replace(/^t3_/, "");
	const url = `${REDDIT_API_BASE}/r/${subreddit}/comments/${cleanId}.json?limit=500&depth=10`;

	try {
		const response = await fetchJson<RedditCommentsResponse>(url);

		const postData = response[0].data.children[0];
		if (!postData || postData.kind !== "t3") {
			return null;
		}

		const post = postData.data;
		const comments = parseComments(response[1].data.children);

		return { post, comments };
	} catch {
		return null;
	} finally {
		// Be nice to Reddit's API
		await sleep(sleepBetweenRequestsMs);
	}
}

function parseComments(
	children: Array<{ kind: string; data: RedditCommentData }>,
): RedditComment[] {
	const comments: RedditComment[] = [];

	for (const child of children) {
		if (child.kind !== "t1") continue; // t1 = comment

		const data = child.data;
		const comment: RedditComment = {
			id: data.id,
			author: data.author,
			body: data.body,
			score: data.score,
			created_utc: data.created_utc,
			depth: data.depth,
		};

		// Recursively parse nested replies
		if (data.replies?.data?.children) {
			comment.replies = parseComments(data.replies.data.children);
		}

		comments.push(comment);
	}

	return comments;
}

/**
 * Build the full Reddit URL for a post.
 */
export function buildPostUrl(post: RedditPost): string {
	return `https://www.reddit.com${post.permalink}`;
}

/**
 * Flatten nested comments into a single array with depth preserved.
 */
export function flattenComments(comments: RedditComment[]): RedditComment[] {
	const result: RedditComment[] = [];

	function traverse(items: RedditComment[]) {
		for (const comment of items) {
			result.push(comment);
			if (comment.replies) {
				traverse(comment.replies);
			}
		}
	}

	traverse(comments);
	return result;
}

/**
 * Format comments as readable text for indexing.
 */
export function formatCommentsAsText(comments: RedditComment[]): string {
	const flat = flattenComments(comments);
	const lines: string[] = [];

	for (const comment of flat) {
		if (comment.author === "[deleted]" || comment.body === "[deleted]") {
			continue;
		}

		const indent = "  ".repeat(comment.depth);
		const header = `${indent}[${comment.author}] (score: ${comment.score})`;
		const body = comment.body
			.split("\n")
			.map((line) => `${indent}${line}`)
			.join("\n");

		lines.push(header);
		lines.push(body);
		lines.push("");
	}

	return lines.join("\n");
}
