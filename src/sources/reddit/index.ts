import { createLogger } from "../../utils/logger.js";
import type { Source, SourceContext } from "../types.js";
import { listPostsBatched } from "./fetch.js";
import { processPost } from "./process.js";
import { getRedditProcessingPrompt } from "./process-prompt.js";
import { authenticateReddit, createRedditTokenProvider } from "./reddit-auth.js";
import { RedditState } from "./state.js";
import type { RedditPost } from "./types.js";

const log = createLogger("reddit");

/** Overlap window: re-check posts within this period for comment updates */
const OVERLAP_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

type RedditRunContext = {
	context: SourceContext;
	publisherId: string;
	state: RedditState;
	tokenProvider: ReturnType<typeof createRedditTokenProvider>;
	minCommentCount: number;
};

type RedditRunCounts = {
	processed: number;
	errors: number;
};

export function createRedditSource(): Source {
	return {
		sourceId: "reddit",
		authenticate: authenticateReddit,
		getProcessingPrompt: getRedditProcessingPrompt,

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			await runRedditIndex(context, publisherId);
		},
	};
}

async function runRedditIndex(context: SourceContext, publisherId: string): Promise<void> {
	const state = new RedditState(context.workspacePath);
	const tokenProvider = createRedditTokenProvider(context.workspacePath);
	await state.load();

	const runContext = {
		context,
		publisherId,
		state,
		tokenProvider,
		minCommentCount: context.domainConfig.sources.reddit?.commentsCountThreshold ?? 0,
	};
	const backfill = getBackfillState(context, publisherId, state);
	const postsToReindex: RedditPost[] = [];

	log.info(`Fetching r/${publisherId} posts since ${backfill.cutoffDate.toISOString().split("T")[0]}`);

	const counts = await processRedditBatches(runContext, backfill.cutoffDate, backfill.isComplete, postsToReindex);
	await markBackfillIfComplete(context, publisherId, state, backfill, counts.reachedEndForBackfill);
	const reindexCounts = await reindexPosts(runContext, postsToReindex);

	const processed = counts.processed + reindexCounts.processed;
	const errors = counts.errors + reindexCounts.errors;
	log.info(`Completed r/${publisherId} (${processed} items${errors > 0 ? `, ${errors} errors` : ""})`);
}

function getBackfillState(
	context: SourceContext,
	publisherId: string,
	state: RedditState,
): { isComplete: boolean; cutoffDate: Date } {
	const isComplete = state.isBackfillComplete(publisherId);
	const latestFetched = state.getLatestFetched(publisherId);
	const cutoffDate =
		isComplete && latestFetched !== null ? new Date(latestFetched - OVERLAP_MS) : context.domainConfig.startDate;

	return { isComplete, cutoffDate };
}

async function processRedditBatches(
	runContext: RedditRunContext,
	cutoffDate: Date,
	isBackfillComplete: boolean,
	postsToReindex: RedditPost[],
): Promise<RedditRunCounts & { reachedEndForBackfill: boolean }> {
	const counts = { processed: 0, errors: 0, reachedEndForBackfill: false };
	const sleepMs = runContext.context.domainConfig.sources.reddit?.sleepBetweenRequestsMs ?? 1000;

	for await (const batch of listPostsBatched(runContext.publisherId, cutoffDate, sleepMs, runContext.tokenProvider)) {
		if (batch.reachedEnd && !isBackfillComplete) counts.reachedEndForBackfill = true;
		for (const post of batch.posts) await processFetchedPost(runContext, post, postsToReindex, counts);
	}

	return counts;
}

async function processFetchedPost(
	runContext: RedditRunContext,
	post: RedditPost,
	postsToReindex: RedditPost[],
	counts: RedditRunCounts,
): Promise<void> {
	const { publisherId, state } = runContext;
	const isIndexed = state.contains(publisherId, post.id);

	if (isIndexed) {
		if (state.shouldReindex(publisherId, post.id, post.num_comments)) postsToReindex.push(post);
		return;
	}

	const result = await processPost({
		context: runContext.context,
		subreddit: publisherId,
		post,
		state,
		minCommentCount: runContext.minCommentCount,
		tokenProvider: runContext.tokenProvider,
	});
	updateCounts(counts, result.status, post.title, publisherId, result.status === "error" ? result.reason : undefined);
}

async function markBackfillIfComplete(
	context: SourceContext,
	publisherId: string,
	state: RedditState,
	backfill: { isComplete: boolean; cutoffDate: Date },
	reachedEndForBackfill: boolean,
): Promise<void> {
	if (backfill.isComplete) return;
	if (!reachedEndForBackfill) return;
	if (backfill.cutoffDate.getTime() !== context.domainConfig.startDate.getTime()) return;

	await state.markBackfillComplete(publisherId);
	log.info(`Backfill completed for subreddit r/${publisherId}`);
}

async function reindexPosts(runContext: RedditRunContext, postsToReindex: RedditPost[]): Promise<RedditRunCounts> {
	const counts = { processed: 0, errors: 0 };
	if (postsToReindex.length === 0) return counts;

	log.info(`Re-indexing ${postsToReindex.length} posts`);

	for (const post of postsToReindex) {
		const result = await processPost({
			context: runContext.context,
			subreddit: runContext.publisherId,
			post,
			state: runContext.state,
			minCommentCount: runContext.minCommentCount,
			tokenProvider: runContext.tokenProvider,
			isReindex: true,
		});
		updateCounts(
			counts,
			result.status,
			post.title,
			runContext.publisherId,
			result.status === "error" ? result.reason : undefined,
		);
	}

	return counts;
}

function updateCounts(
	counts: RedditRunCounts,
	status: "indexed" | "updated" | "skipped" | "error",
	title: string,
	publisherId: string,
	errorReason?: string,
): void {
	if (status === "indexed" || status === "updated") counts.processed++;
	if (status !== "error") return;

	counts.errors++;
	log.error(`Failed to index post "${title}" for r/${publisherId}: ${errorReason ?? "unknown error"}`);
}
