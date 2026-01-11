import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../utils/exec.js";
import { vttToPlainText } from "../../utils/vtt.js";
import type { FlatPlaylistEntry, YtDlpVideo } from "./types.js";

const YT_DLP = "yt-dlp";
const DEFAULT_LANGS = "en.*";

type FlatPlaylist = {
	entries?: FlatPlaylistEntry[];
};

export function hasYtDlp(): boolean {
	const ytdlpPath = Bun.which(YT_DLP);
	return !!ytdlpPath;
}

export async function listVideos(
	channelId: string,
): Promise<FlatPlaylistEntry[]> {
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
	return entries.filter((entry) => !!entry.id);
}

export async function fetchVideoDetails(
	videoUrl: string,
): Promise<YtDlpVideo | null> {
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

export async function fetchTranscript(
	videoUrl: string,
): Promise<string | null> {
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

export function buildVideoUrl(entry: FlatPlaylistEntry): string {
	if (entry.url) return entry.url;
	if (entry.id) return `https://www.youtube.com/watch?v=${entry.id}`;
	return "";
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

async function downloadSubtitles(
	videoUrl: string,
	workingDir: string,
): Promise<string | null> {
	const outputTemplate = path.join(workingDir, "transcript");

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

async function findVtt(workingDir: string): Promise<string | null> {
	const glob = new Bun.Glob("*.vtt");
	for await (const entry of glob.scan({ cwd: workingDir })) {
		return path.join(workingDir, entry);
	}
	return null;
}
