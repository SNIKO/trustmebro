export type YtDlpVideo = {
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

export type FlatPlaylistEntry = {
  id?: string;
  title?: string;
  url?: string;
  timestamp?: number;
};

export type VideoRunResult = {
  videoId: string;
  status: "indexed" | "skipped" | "error";
  reason?: string;
  title?: string;
};
