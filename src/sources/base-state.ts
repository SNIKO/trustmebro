import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";

export abstract class BaseSourceState<T = unknown> {
	protected readonly filePath: string;
	protected abstract schema: z.ZodSchema<T>;
	protected state: T;

	constructor(workspacePath: string, fileName: string) {
		this.filePath = path.join(workspacePath, ".trustmebro", fileName);
		this.state = {} as T;
	}

	async load(): Promise<void> {
		if (!existsSync(this.filePath)) {
			this.state = this.getDefaultState();
			return;
		}

		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = YAML.parse(raw);
			this.state = this.schema.parse(parsed);
		} catch (error) {
			console.warn(
				`Failed to load state from ${this.filePath}, using defaults:`,
				error,
			);
			this.state = this.getDefaultState();
		}
	}

	async save(): Promise<void> {
		const dir = path.dirname(this.filePath);
		await mkdir(dir, { recursive: true });

		const tempPath = `${this.filePath}.tmp`;
		const yaml = YAML.stringify(this.state);

		await writeFile(tempPath, yaml, "utf8");
		await rename(tempPath, this.filePath);
	}

	protected abstract getDefaultState(): T;
}

export class DualFileState<TMain, TSkipped> {
	private readonly mainFilePath: string;
	private readonly skippedFilePath: string;
	private readonly mainSchema: z.ZodSchema<TMain>;
	private readonly skippedSchema: z.ZodSchema<TSkipped>;
	private mainState: TMain;
	private skippedState: TSkipped;

	constructor(
		workspacePath: string,
		mainFileName: string,
		skippedFileName: string,
		mainSchema: z.ZodSchema<TMain>,
		skippedSchema: z.ZodSchema<TSkipped>,
	) {
		this.mainFilePath = path.join(workspacePath, ".trustmebro", mainFileName);
		this.skippedFilePath = path.join(
			workspacePath,
			".trustmebro",
			skippedFileName,
		);
		this.mainSchema = mainSchema;
		this.skippedSchema = skippedSchema;
		this.mainState = {} as TMain;
		this.skippedState = {} as TSkipped;
	}

	async load(): Promise<void> {
		// Load main state
		if (!existsSync(this.mainFilePath)) {
			this.mainState = {} as TMain;
		} else {
			const raw = await readFile(this.mainFilePath, "utf8");
			const parsed = YAML.parse(raw);
			this.mainState = this.mainSchema.parse(parsed);
		}

		// Load skipped state
		if (!existsSync(this.skippedFilePath)) {
			this.skippedState = {} as TSkipped;
		} else {
			const raw = await readFile(this.skippedFilePath, "utf8");
			const parsed = YAML.parse(raw);
			this.skippedState = this.skippedSchema.parse(parsed);
		}
	}

	async saveMain(): Promise<void> {
		const dir = path.dirname(this.mainFilePath);
		await mkdir(dir, { recursive: true });

		const tempPath = `${this.mainFilePath}.tmp`;
		const yaml = YAML.stringify(this.mainState);

		await writeFile(tempPath, yaml, "utf8");
		await rename(tempPath, this.mainFilePath);
	}

	async saveSkipped(): Promise<void> {
		const dir = path.dirname(this.skippedFilePath);
		await mkdir(dir, { recursive: true });

		const tempPath = `${this.skippedFilePath}.tmp`;
		const yaml = YAML.stringify(this.skippedState);

		await writeFile(tempPath, yaml, "utf8");
		await rename(tempPath, this.skippedFilePath);
	}

	protected getMainState(): TMain {
		return this.mainState;
	}

	protected getSkippedState(): TSkipped {
		return this.skippedState;
	}

	protected setMainState(state: TMain): void {
		this.mainState = state;
	}

	protected setSkippedState(state: TSkipped): void {
		this.skippedState = state;
	}
}
