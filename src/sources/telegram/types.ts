export type ImageInfo = {
	path: string;
	url?: string;
	mimeType?: string;
	width?: number;
	height?: number;
};

export type TelegramMessage = {
	id: number;
	date: number;
	message?: string;
	images?: ImageInfo[];
};

export type MessageGroup = {
	messages: TelegramMessage[];
};

export type GroupRunResult = {
	/** ID of the first message in the group */
	groupId: number;
	status: "indexed" | "skipped" | "error";
	reason?: string;
	title?: string;
};
