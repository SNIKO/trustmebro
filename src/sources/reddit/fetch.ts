import type { RedditTokenProvider } from "./reddit-auth.js";
import type { RedditComment, RedditPost, RedditPostWithComments } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const REDDIT_API_BASE = "https://oauth.reddit.com";
const RATE_LIMIT_BUFFER_MS = 1000;

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

type RateLimitHeaders = {
	remaining: number | null;
	resetSeconds: number | null;
	retryAfterSeconds: number | null;
};

async function fetchJson<T>(
	url: string,
	tokenProvider: RedditTokenProvider,
	forceRefresh = false,
	retriedRateLimit = false,
): Promise<T> {
	const accessToken = await tokenProvider.getAccessToken(forceRefresh);
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"User-Agent": tokenProvider.getUserAgent(),
		},
	});

	if (response.status === 401 && !forceRefresh) {
		return fetchJson<T>(url, tokenProvider, true);
	}

	if (response.status === 429 && !retriedRateLimit) {
		await sleep(getRateLimitDelayMs(response.headers) ?? 60_000);
		return fetchJson<T>(url, tokenProvider, forceRefresh, true);
	}

	if (!response.ok) {
		throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
	}

	await waitForRateLimit(response.headers);

	return response.json() as Promise<T>;
}

async function waitForRateLimit(headers: Headers): Promise<void> {
	const delayMs = getRateLimitDelayMs(headers);
	if (delayMs !== null) await sleep(delayMs);
}

function getRateLimitDelayMs(headers: Headers): number | null {
	const rateLimit = readRateLimitHeaders(headers);
	if (rateLimit.retryAfterSeconds !== null) return secondsToDelay(rateLimit.retryAfterSeconds);
	if (rateLimit.remaining === null || rateLimit.remaining > 0) return null;
	if (rateLimit.resetSeconds === null) return null;
	return secondsToDelay(rateLimit.resetSeconds);
}

function readRateLimitHeaders(headers: Headers): RateLimitHeaders {
	return {
		remaining: readNumberHeader(headers, "x-ratelimit-remaining"),
		resetSeconds: readNumberHeader(headers, "x-ratelimit-reset"),
		retryAfterSeconds: readNumberHeader(headers, "retry-after"),
	};
}

function readNumberHeader(headers: Headers, name: string): number | null {
	const value = headers.get(name);
	if (value === null) return null;

	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return null;
	return numberValue;
}

function secondsToDelay(seconds: number): number {
	return Math.max(0, seconds * 1000 + RATE_LIMIT_BUFFER_MS);
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
	tokenProvider: RedditTokenProvider,
): AsyncGenerator<PostsBatch> {
	let after: string | undefined;
	const startTimestamp = startDate.getTime() / 1000; // Convert to Unix timestamp

	while (true) {
		const params = new URLSearchParams({
			limit: "100",
			raw_json: "1",
			...(after && { after }),
		});
		const url = `${REDDIT_API_BASE}/r/${subreddit}/new?${params}`;
		const response = await fetchJson<RedditListingResponse>(url, tokenProvider);

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
	tokenProvider: RedditTokenProvider,
): Promise<RedditPostWithComments | null> {
	// Remove "t3_" prefix if present
	const cleanId = postId.replace(/^t3_/, "");
	const params = new URLSearchParams({ limit: "500", depth: "10", raw_json: "1" });
	const url = `${REDDIT_API_BASE}/r/${subreddit}/comments/${cleanId}?${params}`;

	try {
		const response = await fetchJson<RedditCommentsResponse>(url, tokenProvider);

		const postData = response[0].data.children[0];
		if (postData?.kind !== "t3") {
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

function parseComments(children: Array<{ kind: string; data: RedditCommentData }>): RedditComment[] {
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
