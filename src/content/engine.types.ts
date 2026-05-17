import type { LanguageModel } from "ai";

import type { SourceId } from "../config.js";

export interface ContentEngine {
	start(): Promise<void>;
	stop(): Promise<void>;
	waitForIdle(): Promise<void>;
	add(request: AddRequest): Promise<AddResult>;
}

export interface AddRequest {
	domain: string;
	id: string;
	label: string;
	source: SourceId;
	publisher: string;
	creationDate: Date;
	content: string;
	tags: Record<string, unknown>;
}

export interface AddResult {
	success: boolean;
	message?: string;
}

export interface DomainEntry {
	name: string;
	description: string;
	contentDir: string;
	tagSchema: string;
}

export interface ContentEngineConfig {
	domains: DomainEntry[];
	model: LanguageModel;
	workers: number;
	customPrompts?: Record<string, string>;
}
