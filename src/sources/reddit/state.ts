import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const postStateSchema = z.object({
	commentCount: z.number(),
	indexedAt: z.number(),
});

const subredditStateSchema = z.record(z.string(), postStateSchema).default({});

const stateSchema = z.record(z.string(), subredditStateSchema).default({});

type PostState = z.infer<typeof postStateSchema>;
type State = z.infer<typeof stateSchema>;

/** Threshold for re-indexing: if comments increased by this ratio, re-fetch */
const COMMENT_INCREASE_THRESHOLD = 1.5;
/** Minimum time before considering re-index (1 week in ms) */
const MIN_REINDEX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class RedditState {
	readonly filePath: string;
	private state: State = {};

	constructor(workspacePath: string) {
		this.filePath = path.join(workspacePath, "index-reddit.yaml");
	}

	async load(): Promise<void> {
		if (!existsSync(this.filePath)) {
			this.state = {};
			return;
		}

		const raw = await readFile(this.filePath, "utf8");
		const parsed = YAML.parse(raw);
		this.state = stateSchema.parse(parsed);
	}

	contains(subreddit: string, postId: string): boolean {
		const subredditIndex = this.state[subreddit];
		return subredditIndex ? postId in subredditIndex : false;
	}

	getPostState(subreddit: string, postId: string): PostState | null {
		const subredditIndex = this.state[subreddit];
		if (!subredditIndex) return null;
		return subredditIndex[postId] ?? null;
	}

	/**
	 * Check if a post should be re-indexed based on comment count change.
	 * Returns true if:
	 * - Post was indexed more than MIN_REINDEX_AGE_MS ago
	 * - Comment count increased by more than COMMENT_INCREASE_THRESHOLD
	 */
	shouldReindex(
		subreddit: string,
		postId: string,
		currentCommentCount: number,
	): boolean {
		const postState = this.getPostState(subreddit, postId);
		if (!postState) return false;

		const now = Date.now();
		const age = now - postState.indexedAt;

		if (age < MIN_REINDEX_AGE_MS) {
			return false;
		}

		const commentRatio =
			currentCommentCount / Math.max(postState.commentCount, 1);
		return commentRatio >= COMMENT_INCREASE_THRESHOLD;
	}

	async markIndexed(
		subreddit: string,
		postId: string,
		commentCount: number,
	): Promise<void> {
		if (!this.state[subreddit]) {
			this.state[subreddit] = {};
		}

		this.state[subreddit][postId] = {
			commentCount,
			indexedAt: Date.now(),
		};

		await this.persist();
	}

	private async persist(): Promise<void> {
		const dir = path.dirname(this.filePath);
		await mkdir(dir, { recursive: true });
		const tmp = `${this.filePath}.tmp`;
		const validated = stateSchema.parse(this.state);
		const serialized = YAML.stringify(validated);
		await writeFile(tmp, serialized, "utf8");
		await rename(tmp, this.filePath);
	}
}
