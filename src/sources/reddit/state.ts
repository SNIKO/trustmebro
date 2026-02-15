import { z } from "zod";
import { BaseSourceState } from "../base-state.js";

/** Threshold for re-indexing: if comments increased by this ratio, re-fetch */
const COMMENT_INCREASE_THRESHOLD = 1.5;

// posts: postId -> commentCount (just the number)
const postsSchema = z.record(z.string(), z.number()).default({});

const subredditStateSchema = z.object({
	posts: postsSchema,
	backfillComplete: z.boolean().default(false),
	latestFetched: z.number().optional(),
});

const stateSchema = z.record(z.string(), subredditStateSchema).default({});

type State = z.infer<typeof stateSchema>;

export class RedditState extends BaseSourceState<State> {
	protected schema = stateSchema;

	constructor(workspacePath: string) {
		super(workspacePath, "index-reddit.yaml");
	}

	protected getDefaultState(): State {
		return {};
	}

	contains(subreddit: string, postId: string): boolean {
		return postId in (this.state[subreddit]?.posts ?? {});
	}

	getCommentCount(subreddit: string, postId: string): number | null {
		return this.state[subreddit]?.posts[postId] ?? null;
	}

	isBackfillComplete(subreddit: string): boolean {
		return this.state[subreddit]?.backfillComplete ?? false;
	}

	getLatestFetched(subreddit: string): number | null {
		return this.state[subreddit]?.latestFetched ?? null;
	}

	/**
	 * Check if a post should be re-indexed based on comment count increase.
	 * Only considers posts within the overlay window (recent posts that may get more comments).
	 */
	shouldReindex(
		subreddit: string,
		postId: string,
		currentCommentCount: number,
	): boolean {
		const storedCount = this.getCommentCount(subreddit, postId);
		if (storedCount === null) return false;

		const ratio = currentCommentCount / Math.max(storedCount, 1);
		return ratio >= COMMENT_INCREASE_THRESHOLD;
	}

	async markIndexed(
		subreddit: string,
		postId: string,
		commentCount: number,
		postCreatedAt: number,
	): Promise<void> {
		if (!this.state[subreddit]) {
			this.state[subreddit] = { posts: {}, backfillComplete: false };
		}

		this.state[subreddit].posts[postId] = commentCount;

		// Update latestFetched if this post is newer
		const prev = this.state[subreddit].latestFetched;
		if (prev === undefined || postCreatedAt > prev) {
			this.state[subreddit].latestFetched = postCreatedAt;
		}

		await this.save();
	}

	async markBackfillComplete(subreddit: string): Promise<void> {
		if (!this.state[subreddit]) {
			this.state[subreddit] = { posts: {}, backfillComplete: true };
		} else {
			this.state[subreddit].backfillComplete = true;
		}
		await this.save();
	}
}
