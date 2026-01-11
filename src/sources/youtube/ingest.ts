import type { SourceContext } from "../types.js";
import type { YtDlpVideo } from "./types.js";

export async function ingestVideo(args: {
	context: SourceContext;
	publisherId: string;
	videoId: string;
	videoUrl: string;
	transcript: string;
	details: YtDlpVideo;
	publishedAt: Date;
}): Promise<boolean> {
	const {
		context,
		publisherId,
		videoId,
		videoUrl,
		transcript,
		details,
		publishedAt,
	} = args;

	const result = await context.greptor.eat({
		id: videoId,
		format: "text",
		label: details.title ?? videoId,
		source: "youtube",
		publisher: publisherId,
		creationDate: publishedAt,
		content: transcript,
		tags: {
			channelName: details.channel ?? publisherId,
			channelSubscribersCount: details.channel_follower_count ?? 0,
			videoViewsCount: details.view_count ?? 0,
			videoLikesCount: details.like_count ?? 0,
			videoCommentsCount: details.comment_count ?? 0,
			videoUrl,
		},
	});

	return result.success;
}
