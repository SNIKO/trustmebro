import type { SourceContext } from "../types.js";
import { buildPostUrl, formatCommentsAsText } from "./fetch.js";
import type { RedditPostWithComments } from "./types.js";

export async function ingestPost(args: {
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
