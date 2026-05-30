import type { LogRecord } from "../utils/logger.js";
import type { ProgressEvent, UiEvent } from "./events.js";

const MAX_LOG_LINES = 1_000;

export type CountProgress = {
	total: number;
	done: number;
	failed: number;
	active: number;
};

export type DomainSourceProgress = {
	key: string;
	domain: string;
	sourceId: string;
	publishers: CountProgress;
	content: CountProgress;
};

export type IndexUiState = {
	logs: LogRecord[];
	rows: Record<string, DomainSourceProgress>;
};

export const initialIndexUiState: IndexUiState = {
	logs: [],
	rows: {},
};

export function indexUiReducer(state: IndexUiState, event: UiEvent): IndexUiState {
	if (event.type === "log") return appendLog(state, event.record);
	return applyProgressEvent(state, event.event);
}

function appendLog(state: IndexUiState, record: LogRecord): IndexUiState {
	const logs = [...state.logs, record].slice(-MAX_LOG_LINES);
	return { ...state, logs };
}

function applyProgressEvent(state: IndexUiState, event: ProgressEvent): IndexUiState {
	switch (event.type) {
		case "publisher-register":
			return updatePublishers(state, event.domain, event.sourceId, (publishers) => ({
				...publishers,
				total: publishers.total + 1,
			}));
		case "publisher-start":
			return updatePublishers(state, event.domain, event.sourceId, (publishers) => ({
				...publishers,
				active: publishers.active + 1,
			}));
		case "publisher-complete":
			return updatePublishers(state, event.domain, event.sourceId, (publishers) => ({
				...publishers,
				done: publishers.done + 1,
				active: decrementActive(publishers.active),
			}));
		case "publisher-error":
			return updatePublishers(state, event.domain, event.sourceId, (publishers) => ({
				...publishers,
				failed: publishers.failed + 1,
				active: decrementActive(publishers.active),
			}));
		case "content-storage-snapshot":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				total: event.total,
				done: event.enriched,
			}));
		case "content-raw-added":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				total: content.total + event.count,
			}));
		case "content-processed-removed":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				done: Math.max(content.done - event.count, 0),
			}));
		case "content-index-start":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				active: content.active + 1,
			}));
		case "content-index-complete":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				done: Math.min(content.done + 1, content.total),
				active: decrementActive(content.active),
			}));
		case "content-index-error":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				failed: content.failed + 1,
				active: decrementActive(content.active),
			}));
		case "content-index-retry":
			return updateContent(state, event.domain, event.sourceId, (content) => ({
				...content,
				active: decrementActive(content.active),
			}));
	}
}

function updatePublishers(
	state: IndexUiState,
	domain: string,
	sourceId: string,
	update: (publishers: CountProgress) => CountProgress,
): IndexUiState {
	const row = getRow(state, domain, sourceId);
	return setRow(state, { ...row, publishers: update(row.publishers) });
}

function updateContent(
	state: IndexUiState,
	domain: string,
	sourceId: string,
	update: (content: CountProgress) => CountProgress,
): IndexUiState {
	const row = getRow(state, domain, sourceId);
	return setRow(state, { ...row, content: update(row.content) });
}

function getRow(state: IndexUiState, domain: string, sourceId: string): DomainSourceProgress {
	const key = buildRowKey(domain, sourceId);
	return state.rows[key] ?? createRow(key, domain, sourceId);
}

function setRow(state: IndexUiState, row: DomainSourceProgress): IndexUiState {
	return { ...state, rows: { ...state.rows, [row.key]: row } };
}

function createRow(key: string, domain: string, sourceId: string): DomainSourceProgress {
	return {
		key,
		domain,
		sourceId,
		publishers: createCountProgress(),
		content: createCountProgress(),
	};
}

function createCountProgress(): CountProgress {
	return { total: 0, done: 0, failed: 0, active: 0 };
}

function decrementActive(active: number): number {
	return Math.max(active - 1, 0);
}

function buildRowKey(domain: string, sourceId: string): string {
	return `${domain}/${sourceId}`;
}
