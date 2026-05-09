import { z } from "zod";
import { DualFileState } from "../base-state.js";

const stateSchema = z
	.record(z.string(), z.array(z.string()).default([]))
	.default({});

type State = z.infer<typeof stateSchema>;

const skippedStateSchema = z
	.record(z.string(), z.record(z.string(), z.string()).default({}))
	.default({});

type SkippedState = z.infer<typeof skippedStateSchema>;

export class YouTubeState extends DualFileState<State, SkippedState> {
	constructor(workspacePath: string) {
		super(
			workspacePath,
			"index-youtube.yaml",
			"skipped-youtube.yaml",
			stateSchema,
			skippedStateSchema,
		);
	}

	contains(channelId: string, videoId: string): boolean {
		const mainState = this.getMainState();
		const channelIndex = mainState[channelId.toLowerCase()];
		return channelIndex ? channelIndex.includes(videoId) : false;
	}

	isSkipped(channelId: string, videoId: string): boolean {
		const skippedState = this.getSkippedState();
		return Boolean(skippedState[channelId.toLowerCase()]?.[videoId]);
	}

	async markIndexed(channelId: string, videoId: string): Promise<void> {
		const id = channelId.toLowerCase();
		const mainState = this.getMainState();
		if (!mainState[id]) {
			mainState[id] = [];
		}

		mainState[id].push(videoId);
		this.setMainState(mainState);
		await this.saveMain();
	}

	async markSkipped(
		channelId: string,
		videoId: string,
		reason: string,
	): Promise<void> {
		const id = channelId.toLowerCase();
		const skippedState = this.getSkippedState();
		if (!skippedState[id]) {
			skippedState[id] = {};
		}

		skippedState[id][videoId] = reason;
		this.setSkippedState(skippedState);
		await this.saveSkipped();
	}
}
