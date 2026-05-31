import type { SourceId } from "../config.js";
import type { LogRecord, LogReporter } from "../utils/logger.js";

export type ProgressEvent =
	| {
			type: "publisher-register";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "publisher-start";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "publisher-complete";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "publisher-error";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "content-storage-snapshot";
			domain: string;
			sourceId: SourceId;
			total: number;
			enriched: number;
	  }
	| {
			type: "content-raw-added";
			domain: string;
			sourceId: SourceId;
			count: number;
	  }
	| {
			type: "content-processed-removed";
			domain: string;
			sourceId: SourceId;
			count: number;
	  }
	| {
			type: "content-index-start";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "content-index-complete";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "content-index-error";
			domain: string;
			sourceId: SourceId;
	  }
	| {
			type: "content-index-retry";
			domain: string;
			sourceId: SourceId;
	  };

export type UiEvent = { type: "log"; record: LogRecord } | { type: "progress"; event: ProgressEvent };
export type UiEventBatch = { type: "batch"; events: UiEvent[] };
export type UiAction = UiEvent | UiEventBatch;

export interface ProgressReporter {
	emit(event: ProgressEvent): void;
}

export interface IndexUiSession {
	logReporter: LogReporter;
	progress: ProgressReporter;
	stop(): Promise<void>;
}

export const noopProgressReporter: ProgressReporter = {
	emit(): void {},
};
