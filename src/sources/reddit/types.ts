export type RedditPost = {
	id: string;
	title: string;
	selftext: string;
	author: string;
	created_utc: number;
	score: number;
	upvote_ratio: number;
	num_comments: number;
	permalink: string;
	url: string;
	is_self: boolean;
	link_flair_text?: string;
	subreddit: string;
};

export type RedditComment = {
	id: string;
	author: string;
	body: string;
	score: number;
	created_utc: number;
	depth: number;
	replies?: RedditComment[];
};

export type RedditPostWithComments = {
	post: RedditPost;
	comments: RedditComment[];
};

export type PostRunResult = {
	postId: string;
	status: "indexed" | "skipped" | "error" | "updated";
	reason?: string;
	title?: string;
};

export type IndexedPostState = {
	commentCount: number;
	createdAt: number;
	indexedAt: number;
};
