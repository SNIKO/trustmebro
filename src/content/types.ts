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
