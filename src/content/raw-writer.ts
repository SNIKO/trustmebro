import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import type { SourceId } from "../config.js";
import type { AddRequest } from "./engine.types.js";

export async function writeRawDocument(
	contentDir: string,
	request: AddRequest,
): Promise<{ filePath: string; relPath: string; written: boolean }> {
	const relPath = buildDocumentPath(request.source, request.publisher, request.creationDate, request.label);
	const filePath = path.join(contentDir, "raw", relPath);

	const body = request.content.trim();
	const newHash = hashContent(body);
	const newFile = buildFileContent(request, newHash, body);

	if (await fileExists(filePath)) {
		const existingFile = await readFile(filePath, "utf8");
		const existingHash = extractContentHash(existingFile);

		if (existingHash === null) {
			// No contentHash in existing file — treat as an existing content and overwrite to add hash
			await atomicWrite(filePath, newFile);
			return { filePath, relPath, written: false };
		}

		if (existingHash === newHash) {
			// Frontmatter may have drifted — silently update the file if needed
			if (existingFile !== newFile) await atomicWrite(filePath, newFile);
			return { filePath, relPath, written: false };
		}
	}

	await atomicWrite(filePath, newFile);
	return { filePath, relPath, written: true };
}

function buildFileContent(request: AddRequest, contentHash: string, body: string): string {
	const header = {
		id: request.id,
		title: request.label,
		created_at: request.creationDate.toISOString(),
		...request.tags,
		source: request.source,
		publisher: request.publisher,
		contentHash,
	};
	return `---\n${YAML.stringify(header).trim()}\n---\n\n${body}`;
}

function hashContent(body: string): string {
	return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/** Extract contentHash from YAML frontmatter, returns null if absent or unparseable. */
function extractContentHash(raw: string): string | null {
	const match = /^---\n([\s\S]*?)\n---/.exec(raw);
	if (!match?.[1]) return null;
	try {
		const parsed = YAML.parse(match[1]) as Record<string, unknown>;
		return typeof parsed?.contentHash === "string" ? parsed.contentHash : null;
	} catch {
		return null;
	}
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(`${filePath}.tmp`, content, "utf8");
	await rename(`${filePath}.tmp`, filePath);
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

function buildDocumentPath(source: SourceId, publisher: string, creationDate: Date, label: string): string {
	const iso = creationDate.toISOString();
	const yearMonth = iso.slice(0, 7);
	const datePrefix = iso.slice(0, 10);
	const slug = buildSlug(label);
	const normalizedPublisher = publisher.replace(/^@/, "").replace(/^r\//, "").toLowerCase();

	return `${source}/${normalizedPublisher}/${yearMonth}/${datePrefix}-${slug}.md`;
}

function buildSlug(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}
