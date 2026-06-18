import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SourceId } from "../config.js";

export type PendingEnrichmentTask = {
	rawFilePath: string;
	processedFilePath: string;
	domainName: string;
	sourceId: SourceId;
};

export type QueuedEnrichmentTask = PendingEnrichmentTask & {
	version: 1;
	queuedAt: string;
	attempts: number;
	lastError?: string;
	lastErrorAt?: string;
};

export type ClaimedEnrichmentTask = {
	task: QueuedEnrichmentTask;
	filePath: string;
};

export type PersistentEnrichmentQueue = {
	init(): Promise<void>;
	recoverActive(): Promise<number>;
	enqueue(task: PendingEnrichmentTask): Promise<boolean>;
	claim(workerId: number): Promise<ClaimedEnrichmentTask | null>;
	complete(claimedTask: ClaimedEnrichmentTask): Promise<void>;
	retry(claimedTask: ClaimedEnrichmentTask, error: unknown): Promise<void>;
	fail(claimedTask: ClaimedEnrichmentTask, error: unknown): Promise<void>;
	hasPending(): Promise<boolean>;
	countPending(): Promise<number>;
};

type QueueDirs = {
	pending: string;
	active: string;
	failed: string;
};

export function createPersistentEnrichmentQueue(queueDir: string): PersistentEnrichmentQueue {
	const dirs = {
		pending: path.join(queueDir, "pending"),
		active: path.join(queueDir, "active"),
		failed: path.join(queueDir, "failed"),
	};

	return {
		async init(): Promise<void> {
			await Promise.all([
				mkdir(dirs.pending, { recursive: true }),
				mkdir(dirs.active, { recursive: true }),
				mkdir(dirs.failed, { recursive: true }),
			]);
		},

		async recoverActive(): Promise<number> {
			return recoverActiveTasks(dirs);
		},

		async enqueue(task: PendingEnrichmentTask): Promise<boolean> {
			return enqueueTask(dirs, task);
		},

		async claim(workerId: number): Promise<ClaimedEnrichmentTask | null> {
			return claimTask(dirs, workerId);
		},

		async complete(claimedTask: ClaimedEnrichmentTask): Promise<void> {
			await unlinkIfExists(claimedTask.filePath);
		},

		async retry(claimedTask: ClaimedEnrichmentTask, error: unknown): Promise<void> {
			await moveClaimedTask(dirs.pending, claimedTask, error);
		},

		async fail(claimedTask: ClaimedEnrichmentTask, error: unknown): Promise<void> {
			await moveClaimedTask(dirs.failed, claimedTask, error);
		},

		async hasPending(): Promise<boolean> {
			const taskFile = await readFirstTaskFile(dirs.pending);
			return taskFile !== null;
		},

		async countPending(): Promise<number> {
			const fileNames = await readTaskFileNames(dirs.pending);
			return fileNames.length;
		},
	};
}

async function recoverActiveTasks(dirs: QueueDirs): Promise<number> {
	const fileNames = await readTaskFileNames(dirs.active);

	let recovered = 0;
	for (const fileName of fileNames) {
		const activeFilePath = path.join(dirs.active, fileName);
		const pendingFilePath = path.join(dirs.pending, stripWorkerPrefix(fileName));
		try {
			await rename(activeFilePath, pendingFilePath);
			recovered++;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	return recovered;
}

async function enqueueTask(dirs: QueueDirs, task: PendingEnrichmentTask): Promise<boolean> {
	const taskId = getTaskId(task);
	const pendingFilePath = path.join(dirs.pending, `${taskId}.json`);
	const activeFilePathPattern = `-${taskId}.json`;

	if (await fileExists(pendingFilePath)) return false;
	if (await hasActiveTask(dirs.active, activeFilePathPattern)) return false;

	await unlinkIfExists(path.join(dirs.failed, `${taskId}.json`));
	await writeQueueFile(pendingFilePath, {
		version: 1,
		queuedAt: new Date().toISOString(),
		attempts: 0,
		...task,
	});

	return true;
}

async function claimTask(dirs: QueueDirs, workerId: number): Promise<ClaimedEnrichmentTask | null> {
	const fileNames = await readTaskFileNames(dirs.pending);

	for (const fileName of fileNames) {
		const pendingFilePath = path.join(dirs.pending, fileName);
		const activeFilePath = path.join(dirs.active, `worker-${workerId}-${fileName}`);
		try {
			await rename(pendingFilePath, activeFilePath);
			const task = await readQueueFile(activeFilePath);
			return { task, filePath: activeFilePath };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
	}

	return null;
}

async function moveClaimedTask(targetDir: string, claimedTask: ClaimedEnrichmentTask, error: unknown): Promise<void> {
	const task = {
		...claimedTask.task,
		attempts: claimedTask.task.attempts + 1,
		lastError: formatError(error),
		lastErrorAt: new Date().toISOString(),
	};
	const targetFilePath = path.join(targetDir, stripWorkerPrefix(path.basename(claimedTask.filePath)));

	await writeQueueFile(targetFilePath, task);
	await unlinkIfExists(claimedTask.filePath);
}

async function writeQueueFile(filePath: string, task: QueuedEnrichmentTask): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(`${filePath}.tmp`, `${JSON.stringify(task, null, 2)}\n`, "utf8");
	await rename(`${filePath}.tmp`, filePath);
}

async function readQueueFile(filePath: string): Promise<QueuedEnrichmentTask> {
	const raw = await readFile(filePath, "utf8");
	return JSON.parse(raw) as QueuedEnrichmentTask;
}

async function readFirstTaskFile(dir: string): Promise<string | null> {
	const fileNames = await readTaskFileNames(dir);
	return fileNames[0] ?? null;
}

async function readTaskFileNames(dir: string): Promise<string[]> {
	try {
		const fileNames = await readdir(dir);
		return fileNames.filter((fileName) => fileName.endsWith(".json")).sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function hasActiveTask(activeDir: string, filePathPattern: string): Promise<boolean> {
	const fileNames = await readTaskFileNames(activeDir);
	return fileNames.some((fileName) => fileName.endsWith(filePathPattern));
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function unlinkIfExists(filePath: string): Promise<void> {
	try {
		await unlink(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function getTaskId(task: PendingEnrichmentTask): string {
	return createHash("sha256").update(task.processedFilePath).digest("hex").slice(0, 24);
}

function stripWorkerPrefix(fileName: string): string {
	return fileName.replace(/^worker-\d+-/, "");
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
