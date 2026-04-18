export type DocumentRef = string;
export type Tags = Record<string, unknown>;
export type SourceCounts = Record<
	string,
	{ fetched: number; processed: number }
>;

export type AddInput = {
	id?: string;
	label: string;
	source: string;
	publisher?: string;
	creationDate?: Date;
	overwrite?: boolean;
	content: string;
	tags: Tags;
};

export type AddResult =
	| { success: true; ref: DocumentRef }
	| { success: false; message: string };

export type DocumentProcessingStartedEvent = {
	source: string;
	publisher?: string;
	label: string;
	documentsCount: SourceCounts;
};

export type DocumentProcessingCompletedEvent = {
	source: string;
	publisher?: string;
	label: string;
} & (
	| {
			success: true;
			documentsCount: SourceCounts;
			elapsedMs: number;
			inputTokens: number;
			outputTokens: number;
			totalTokens: number;
	  }
	| { success: false; error: string }
);

export type ContentEngineHooks = {
	onDocumentProcessingStarted?: (data: DocumentProcessingStartedEvent) => void;
	onDocumentProcessingCompleted?: (
		data: DocumentProcessingCompletedEvent,
	) => void;
};
