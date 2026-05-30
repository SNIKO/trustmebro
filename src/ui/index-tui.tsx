import { Box, render, Text, useInput, useWindowSize } from "ink";
import type React from "react";
import { useEffect, useMemo, useReducer, useState } from "react";

import { formatLogRecord, type LogRecord, type LogReporter } from "../utils/logger.js";
import type { IndexUiSession, ProgressEvent, ProgressReporter, UiEvent } from "./events.js";
import {
	type CountProgress,
	type DomainSourceProgress,
	type IndexUiState,
	indexUiReducer,
	initialIndexUiState,
} from "./store.js";

type Listener = (event: UiEvent) => void;

type TuiController = {
	subscribe(listener: Listener): () => void;
	emit(event: UiEvent): void;
};

const LEVEL_COLORS: Record<LogRecord["level"], string> = {
	debug: "gray",
	info: "blue",
	warn: "yellow",
	error: "red",
};

const DONE_DOT = "●";
const PENDING_DOT = "●";
const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;

export function startIndexUi(debug: boolean): IndexUiSession {
	if (!isInteractiveTerminal()) return createFallbackReporter(debug);

	const controller = createTuiController();
	const logReporter = createTuiLogReporter(controller, debug);
	const progress = createTuiProgressReporter(controller);
	const instance = render(<IndexTui controller={controller} debug={debug} />, {
		alternateScreen: true,
		exitOnCtrlC: true,
		patchConsole: false,
		maxFps: 12,
	});

	return {
		logReporter,
		progress,
		async stop(): Promise<void> {
			instance.unmount();
			await instance.waitUntilExit();
		},
	};
}

function IndexTui({ controller, debug }: { controller: TuiController; debug: boolean }): React.JSX.Element {
	const [state, dispatch] = useReducer(indexUiReducer, initialIndexUiState);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	const size = useWindowSize();
	const dockHeight = getDockHeight(state, size.rows);
	const logHeight = Math.max(6, size.rows - dockHeight - 2);
	const visibleLogs = useVisibleLogs(state.logs, logHeight, debug ? scrollOffset : 0);

	useEffect(() => controller.subscribe(dispatch), [controller]);
	useEffect(() => {
		const interval = setInterval(() => setSpinnerFrame((current) => current + 1), 120);
		return () => clearInterval(interval);
	}, []);

	useInput((_input, key) => {
		if (!debug) return;
		if (key.upArrow) setScrollOffset((current) => Math.min(current + 1, state.logs.length));
		if (key.downArrow) setScrollOffset((current) => Math.max(current - 1, 0));
		if (key.pageUp) setScrollOffset((current) => Math.min(current + logHeight, state.logs.length));
		if (key.pageDown) setScrollOffset((current) => Math.max(current - logHeight, 0));
		if (key.home) setScrollOffset(state.logs.length);
		if (key.end) setScrollOffset(0);
	});

	return (
		<Box flexDirection="column" height={size.rows} width={size.columns}>
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				<Header debug={debug} scrollOffset={scrollOffset} />
				<LogFeed debug={debug} logs={visibleLogs} />
			</Box>
			<StatusDock height={dockHeight} spinnerFrame={spinnerFrame} state={state} />
		</Box>
	);
}

function Header({ debug, scrollOffset }: { debug: boolean; scrollOffset: number }): React.JSX.Element {
	const followText = scrollOffset === 0 ? "following" : "scrollback";
	const detailText = debug ? `raw logs: ${followText} | arrows/page keys scroll` : "Recent";

	return (
		<Box justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1}>
			<Text bold>TrustMeBro index</Text>
			<Text color="gray">{detailText}</Text>
		</Box>
	);
}

function LogFeed({ debug, logs }: { debug: boolean; logs: LogRecord[] }): React.JSX.Element {
	return (
		<Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
			{logs.length === 0 ? <Text color="gray">Waiting for recent events</Text> : null}
			{logs.map((record) => (
				<LogLine key={record.id} debug={debug} record={record} />
			))}
		</Box>
	);
}

function LogLine({ debug, record }: { debug: boolean; record: LogRecord }): React.JSX.Element {
	const time = record.timestamp.toLocaleTimeString("en-US", { hour12: false });
	const levelColor = LEVEL_COLORS[record.level];

	if (!debug) {
		return (
			<Box>
				{record.level === "info" ? null : <Text color={levelColor}>{record.level.padEnd(5)} </Text>}
				<Text color="gray">{formatCell(record.context, 10)} </Text>
				<Text color={record.level === "info" ? "gray" : undefined} wrap="truncate-end">
					{record.message}
				</Text>
			</Box>
		);
	}

	return (
		<Box>
			<Text color="gray">{time} </Text>
			<Text color={levelColor}>{record.level.padEnd(5)} </Text>
			<Text color="gray">{record.context.padEnd(10)} </Text>
			<Text wrap="truncate-end">{record.message}</Text>
		</Box>
	);
}

function StatusDock({
	height,
	spinnerFrame,
	state,
}: {
	height: number;
	spinnerFrame: number;
	state: IndexUiState;
}): React.JSX.Element {
	const rows = sortRows(Object.values(state.rows));
	const maxRows = Math.max(height - 4, 1);
	const visibleRows = rows.slice(0, maxRows);
	const hiddenCount = rows.length - visibleRows.length;

	return (
		<Box flexDirection="column" height={height} borderStyle="single" borderColor="cyan" paddingX={1} overflow="hidden">
			<Box justifyContent="space-between">
				<Text bold>Progress</Text>
				<Text color="gray">{new Date().toLocaleTimeString("en-US", { hour12: false })}</Text>
			</Box>
			<ProgressTable rows={visibleRows} spinnerFrame={spinnerFrame} />
			{hiddenCount > 0 ? <Text color="gray">{hiddenCount} more row(s) hidden</Text> : null}
		</Box>
	);
}

function ProgressTable({
	rows,
	spinnerFrame,
}: {
	rows: DomainSourceProgress[];
	spinnerFrame: number;
}): React.JSX.Element {
	if (rows.length === 0) return <Text color="gray">Waiting for configured sources</Text>;

	return (
		<Box flexDirection="column">
			<Text color="gray">{"Domain           Source     S  Publishers                  E  Content"}</Text>
			{rows.map((row) => (
				<ProgressRow key={row.key} row={row} spinnerFrame={spinnerFrame} />
			))}
		</Box>
	);
}

function ProgressRow({ row, spinnerFrame }: { row: DomainSourceProgress; spinnerFrame: number }): React.JSX.Element {
	const syncIndicator = getStatusIndicator(row.publishers, spinnerFrame);
	const enrichIndicator = getStatusIndicator(row.content, spinnerFrame);

	return (
		<Box>
			<Text>{formatCell(row.domain, 17)}</Text>
			<Text color="gray">{formatCell(row.sourceId, 11)}</Text>
			<StatusIndicator indicator={syncIndicator} />
			<Box width={28}>
				<ProgressSummary progress={row.publishers} />
			</Box>
			<StatusIndicator indicator={enrichIndicator} />
			<Text wrap="truncate-end">
				<ProgressSummary progress={row.content} />
			</Text>
		</Box>
	);
}

function StatusIndicator({ indicator }: { indicator: StatusIndicatorValue }): React.JSX.Element {
	return (
		<Text color={indicator.color} dimColor={indicator.dim}>
			{formatCell(indicator.label, 3)}
		</Text>
	);
}

function ProgressSummary({ progress }: { progress: CountProgress }): React.JSX.Element {
	const left = getLeft(progress);

	return (
		<Text>
			<Text color="green">{progress.done}</Text>
			<Text color="gray"> / </Text>
			{progress.failed > 0 ? (
				<>
					<Text color="red">{progress.failed}</Text>
					<Text color="gray"> / </Text>
				</>
			) : null}
			<Text color="gray">{progress.total}</Text>
			{left > 0 ? <Text color="yellow">{` (${left} pending)`}</Text> : null}
		</Text>
	);
}

function useVisibleLogs(logs: LogRecord[], height: number, scrollOffset: number): LogRecord[] {
	return useMemo(() => {
		const end = Math.max(logs.length - scrollOffset, 0);
		const start = Math.max(end - height, 0);
		return logs.slice(start, end);
	}, [logs, height, scrollOffset]);
}

function createTuiController(): TuiController {
	const listeners = new Set<Listener>();
	const events: UiEvent[] = [];

	return {
		subscribe(listener): () => void {
			listeners.add(listener);
			for (const event of events) listener(event);
			return () => {
				listeners.delete(listener);
			};
		},
		emit(event): void {
			events.push(event);
			if (events.length > 1_500) events.shift();
			for (const listener of listeners) listener(event);
		},
	};
}

function createTuiLogReporter(controller: TuiController, debug: boolean): LogReporter {
	return {
		log(record): void {
			if (record.level === "debug" && !debug) return;
			controller.emit({ type: "log", record });
		},
	};
}

function createTuiProgressReporter(controller: TuiController): ProgressReporter {
	return {
		emit(event: ProgressEvent): void {
			controller.emit({ type: "progress", event });
		},
	};
}

function isInteractiveTerminal(): boolean {
	return process.stdout.isTTY === true && process.stdin.isTTY === true;
}

function createFallbackReporter(debug: boolean): IndexUiSession {
	const logReporter: LogReporter = {
		log(record): void {
			if (record.level === "debug" && !debug) return;
			console.log(formatLogRecord(record));
		},
	};

	return {
		logReporter,
		progress: { emit(): void {} },
		async stop(): Promise<void> {},
	};
}

function getDockHeight(state: IndexUiState, terminalRows: number): number {
	const rowCount = Object.keys(state.rows).length;
	const preferredHeight = Math.max(5, rowCount + 4);
	return Math.min(preferredHeight, Math.max(5, terminalRows - 7));
}

function sortRows(rows: DomainSourceProgress[]): DomainSourceProgress[] {
	return rows.sort((a, b) => a.domain.localeCompare(b.domain) || a.sourceId.localeCompare(b.sourceId));
}

function getLeft(progress: CountProgress): number {
	return Math.max(progress.total - progress.done - progress.failed, 0);
}

type StatusIndicatorValue = {
	label: string;
	color: string;
	dim: boolean;
};

function getStatusIndicator(progress: CountProgress, frame: number): StatusIndicatorValue {
	const isComplete = progress.total > 0 && getLeft(progress) === 0 && progress.failed === 0;

	if (progress.active > 0) return { label: getSpinner(frame), color: "yellow", dim: false };
	if (isComplete) return { label: DONE_DOT, color: "green", dim: false };
	return { label: PENDING_DOT, color: "yellow", dim: true };
}

function getSpinner(frame: number): string {
	return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "|";
}

function formatCell(value: string, width: number): string {
	if (value.length >= width) return `${value.slice(0, width - 1)} `;
	return value.padEnd(width);
}
