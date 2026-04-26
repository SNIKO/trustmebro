import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { AddInput, DocumentRef, SourceCounts, Tags } from "./types.js";

export interface Storage {
	saveRaw(
		input: AddInput,
	): Promise<
		| { type: "added"; ref: DocumentRef }
		| { type: "duplicate"; ref: DocumentRef }
		| { type: "error"; message: string }
	>;
	readRaw(ref: DocumentRef): Promise<{ tags: Tags; content: string }>;
	saveProcessed(ref: DocumentRef, content: string): Promise<void>;
	getUnprocessed(): Promise<DocumentRef[]>;
	getCounts(): SourceCounts;
}

function sanitize(name: string, maxLen = 50): string {
	let s = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-");
	s = s
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-")
		.slice(0, maxLen);
	return s;
}

function normalizePublisher(publisher: string): string {
	if (publisher.startsWith("@")) return publisher;
	return `@${publisher}`;
}

export function getSource(ref: DocumentRef): string {
	return ref.split("/")[0] ?? "unknown";
}

function generateRef(input: AddInput): DocumentRef {
	const ts = input.creationDate ?? new Date();
	const iso = ts.toISOString().split("T")[0];
	const ym = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, "0")}`;
	const slug = sanitize(input.label) || sanitize(input.id ?? "") || "unknown";
	const source = sanitize(input.source, 20) || "unknown";
	const publisher = input.publisher
		? normalizePublisher(sanitize(input.publisher) || "unknown")
		: undefined;
	return path.posix.join(
		source,
		...(publisher ? [publisher] : []),
		ym,
		`${iso}-${slug}.md`,
	);
}

function buildRawContent(input: AddInput): string {
	const header = {
		id: input.id,
		title: input.label,
		created_at: (input.creationDate ?? new Date()).toISOString(),
		...input.tags,
		source: input.source,
		...(input.publisher
			? { publisher: normalizePublisher(input.publisher) }
			: {}),
	};
	const yaml = YAML.stringify(header).trim();
	return `---\n${yaml}\n---\n\n${input.content.trim()}`;
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

export async function createStorage(baseDir: string): Promise<Storage> {
	const counts: SourceCounts = {};

	function ensureCounts(source: string): {
		fetched: number;
		processed: number;
	} {
		counts[source] ??= { fetched: 0, processed: 0 };
		return counts[source];
	}

	function resolvePath(layer: "raw" | "processed", ref: DocumentRef): string {
		return path.join(baseDir, layer, ref);
	}

	async function listRefs(layer: "raw" | "processed"): Promise<DocumentRef[]> {
		const root = path.join(baseDir, layer);
		const results: DocumentRef[] = [];

		async function walk(dir: string, rel: string): Promise<void> {
			const entries = await readdir(dir, { withFileTypes: true }).catch(
				() => [],
			);
			for (const e of entries) {
				const full = path.join(dir, e.name);
				const next = path.posix.join(rel, e.name);
				if (e.isDirectory()) await walk(full, next);
				else if (e.isFile() && e.name.endsWith(".md")) results.push(next);
			}
		}

		await walk(root, "");
		return results.sort();
	}

	// Initialize counts from existing files
	for (const ref of await listRefs("raw")) {
		const src = getSource(ref);
		ensureCounts(src).fetched++;
	}
	for (const ref of await listRefs("processed")) {
		const src = getSource(ref);
		ensureCounts(src).processed++;
	}

	return {
		async saveRaw(input) {
			try {
				const ref = generateRef(input);
				const fullPath = resolvePath("raw", ref);
				const existed = await fileExists(fullPath);
				if (!input.overwrite && existed) {
					return { type: "duplicate", ref };
				}
				await mkdir(path.dirname(fullPath), { recursive: true });
				await writeFile(fullPath, buildRawContent(input), "utf8");
				const src = getSource(ref);
				if (!existed) {
					ensureCounts(src).fetched++;
				}
				return { type: "added", ref };
			} catch (err) {
				return {
					type: "error",
					message: err instanceof Error ? err.message : String(err),
				};
			}
		},

		async readRaw(ref) {
			const raw = await readFile(resolvePath("raw", ref), "utf8");
			const match = /^---\n(?<yaml>[\s\S]*?)\n---\n(?<content>[\s\S]*)$/.exec(
				raw,
			);
			if (!match) throw new Error(`Invalid YAML front matter in ${ref}`);
			const { yaml, content } = match.groups as {
				yaml: string;
				content: string;
			};
			const tags = YAML.parse(yaml);
			if (typeof tags !== "object" || tags === null || Array.isArray(tags)) {
				throw new Error(`Invalid YAML header in ${ref}`);
			}
			return { tags: tags as Tags, content };
		},

		async saveProcessed(ref, content) {
			const fullPath = resolvePath("processed", ref);
			const existed = await fileExists(fullPath);
			await mkdir(path.dirname(fullPath), { recursive: true });
			await writeFile(fullPath, content, "utf8");
			const src = getSource(ref);
			if (!existed) {
				ensureCounts(src).processed++;
			}
		},

		async getUnprocessed() {
			const raw = await listRefs("raw");
			const processed = new Set(await listRefs("processed"));
			return raw.filter((r) => !processed.has(r));
		},

		getCounts() {
			return Object.fromEntries(
				Object.entries(counts).map(([k, v]) => [k, { ...v }]),
			);
		},
	};
}
