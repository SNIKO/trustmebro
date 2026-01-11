import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../utils/exec.js";
import { vttToPlainText } from "../utils/vtt.js";
import type { Source, SourceContext } from "./types.js";
import { YouTubeState } from "./youtube-state.js";

const YT_DLP = "yt-dlp";
const DEFAULT_LANGS = "en.*";

type YtDlpVideo = {
	id?: string;
	title?: string;
	webpage_url?: string;
	timestamp?: number;
	channel?: string;
	channel_follower_count?: number;
	view_count?: number;
	like_count?: number;
	comment_count?: number;
};

export function createYoutubeSource(): Source | null {
	if (!hasYtDlp()) {
		console.error(
			`[youtube] yt-dlp is required for youtube source. Install it from https://github.com/yt-dlp/yt-dlp#installation`,
		);
		return null;
	}

	return {
		sourceId: "youtube",

		async runOnce(context: SourceContext, publisherId: string): Promise<void> {
			const index = new YouTubeState(context.workspacePath);
			await index.load();

			const videos = await listVideos(publisherId);
			const newVideos = videos.filter(
				(v) => v.id && !index.contains(publisherId, v.id),
			);

			console.log(
				`[youtube] ${publisherId}: found ${videos.length} videos, ${newVideos.length} new to index`,
			);

			for (const entry of newVideos) {
				try {
					if (!entry.id) {
						continue;
					}

					const videoUrl =
						entry.url ?? `https://www.youtube.com/watch?v=${entry.id}`;

					const details = await fetchVideoDetails(videoUrl);
					if (!details || !details.timestamp) {
						console.warn(
							`[youtube] ${entry.id}: failed to fetch video details`,
						);
						continue;
					}

					// Skip videos older than startDate
					const publishedAt = new Date(details.timestamp * 1000);
					if (publishedAt < context.config.startDate) {
						console.log(
							`[youtube] Stopping indexing for ${publisherId}, reached the cutoff date at video ${entry.id}`,
						);
						break;
					}

					const transcript = await fetchTranscript(videoUrl);
					if (!transcript) {
						console.warn(`[youtube] ${entry.id}: no transcript available`);
						continue;
					}

					const result = await context.greptor.eat({
						id: entry.id,
						format: "text",
						label: details.title ?? entry.id,
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
							videoUrl: videoUrl,
						},
					});

					if (result.success) {
						await index.markIndexed(publisherId, entry.id);
						console.log(`[youtube] indexed ${entry.id}: ${details.title}`);
					} else {
						console.warn(`[youtube] failed to index ${entry.id}`);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(`[youtube] error ${entry.id}: ${message}`);
				}
			}
		},
	};
}

type FlatPlaylistEntry = {
	id?: string;
	title?: string;
	url?: string;
	timestamp?: number;
};

type FlatPlaylist = {
	entries?: FlatPlaylistEntry[];
};

async function listVideos(channelId: string): Promise<FlatPlaylistEntry[]> {
	const url = resolveChannelUrl(channelId);

	const result = await runCommand([
		YT_DLP,
		"--flat-playlist",
		"--skip-download",
		"--dump-single-json",
		"--no-warnings",
		url,
	]);

	if (result.code !== 0) {
		throw new Error(`yt-dlp failed to list ${channelId}: ${result.stderr}`);
	}

	const data = JSON.parse(result.stdout) as FlatPlaylist;
	const entries = data.entries ?? [];

	// Return all entries - filtering by indexed status happens in runOnce
	return entries.filter((entry) => !!entry.id);
}

async function fetchVideoDetails(videoUrl: string): Promise<YtDlpVideo | null> {
	const result = await runCommand([
		YT_DLP,
		"--dump-single-json",
		"--skip-download",
		"--no-warnings",
		videoUrl,
	]);

	if (result.code !== 0) {
		return null;
	}

	return JSON.parse(result.stdout) as YtDlpVideo;
}

async function fetchTranscript(videoUrl: string): Promise<string | null> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "trustmebro-yt-"));
	try {
		const vttPath = await downloadSubtitles(videoUrl, tempDir);
		if (!vttPath) {
			return null;
		}

		const vtt = await readFile(vttPath, "utf8");
		const text = vttToPlainText(vtt);
		return text.trim() || null;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function downloadSubtitles(
	videoUrl: string,
	workingDir: string,
): Promise<string | null> {
	const outputTemplate = path.join(workingDir, "transcript");

	// Try manual subtitles first
	await runCommand([
		YT_DLP,
		"--write-sub",
		"--skip-download",
		"--sub-langs",
		DEFAULT_LANGS,
		"--output",
		outputTemplate,
		videoUrl,
	]);

	const vttPath = await findVtt(workingDir);
	if (vttPath) return vttPath;

	// Fall back to auto-generated subtitles
	const auto = await runCommand([
		YT_DLP,
		"--write-auto-sub",
		"--skip-download",
		"--sub-langs",
		DEFAULT_LANGS,
		"--output",
		outputTemplate,
		videoUrl,
	]);

	if (auto.code !== 0) return null;
	return findVtt(workingDir);
}

function resolveChannelUrl(channelId: string): string {
	if (channelId.startsWith("http://") || channelId.startsWith("https://")) {
		return channelId;
	}
	if (channelId.startsWith("@")) {
		return `https://www.youtube.com/${channelId}/videos`;
	}
	if (channelId.startsWith("UC")) {
		return `https://www.youtube.com/channel/${channelId}/videos`;
	}
	return `https://www.youtube.com/@${channelId}/videos`;
}

function hasYtDlp(): boolean {
	const ytdlpPath = Bun.which(YT_DLP);
	return !!ytdlpPath;
}

async function findVtt(workingDir: string): Promise<string | null> {
	const glob = new Bun.Glob("*.vtt");
	for await (const entry of glob.scan({ cwd: workingDir })) {
		return path.join(workingDir, entry);
	}
	return null;
}
