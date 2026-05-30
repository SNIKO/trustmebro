import { fetchPostWithComments, listPostsBatched } from "../src/sources/reddit/fetch.js";
import { createRedditTokenProvider } from "../src/sources/reddit/reddit-auth.js";

type Args = {
	workspacePath: string;
	subreddits: string[];
};

const DEFAULT_SUBREDDITS = ["MachineLearning", "LocalLLaMA", "stocks"];
const POSTS_SINCE_DAYS = 14;
const REQUEST_SLEEP_MS = 250;

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const tokenProvider = createRedditTokenProvider(args.workspacePath);
	const startDate = new Date(Date.now() - POSTS_SINCE_DAYS * 24 * 60 * 60 * 1000);

	console.log(`Testing Reddit OAuth from workspace: ${args.workspacePath}`);
	await tokenProvider.getAccessToken();

	for (const subreddit of args.subreddits) {
		await testSubreddit(subreddit, startDate, tokenProvider);
	}
}

async function testSubreddit(
	subreddit: string,
	startDate: Date,
	tokenProvider: ReturnType<typeof createRedditTokenProvider>,
): Promise<void> {
	console.log(`\nFetching r/${subreddit} posts since ${startDate.toISOString().slice(0, 10)}`);

	for await (const batch of listPostsBatched(subreddit, startDate, REQUEST_SLEEP_MS, tokenProvider)) {
		const post = batch.posts.find((candidate) => candidate.num_comments > 0) ?? batch.posts[0];
		console.log(`Fetched ${batch.posts.length} post(s). reachedEnd=${batch.reachedEnd}`);

		if (!post) {
			console.log(`No recent posts found for r/${subreddit}`);
			return;
		}

		console.log(`Post: ${post.title}`);
		console.log(`Comments reported by listing: ${post.num_comments}`);

		const postData = await fetchPostWithComments(subreddit, post.id, REQUEST_SLEEP_MS, tokenProvider);
		if (!postData) throw new Error(`Failed to fetch comments for r/${subreddit} post ${post.id}`);

		console.log(`Fetched comments tree roots: ${postData.comments.length}`);
		return;
	}
}

function parseArgs(argv: string[]): Args {
	const workspaceIndex = argv.indexOf("--workspace");
	const workspacePath = workspaceIndex >= 0 ? (argv[workspaceIndex + 1] ?? ".") : ".";
	const subreddits = argv.filter((_, index) => index !== workspaceIndex && index !== workspaceIndex + 1);

	return {
		workspacePath,
		subreddits: subreddits.length > 0 ? subreddits : DEFAULT_SUBREDDITS,
	};
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
