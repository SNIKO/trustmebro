import { spawn } from "node:child_process";

export type CommandResult = {
	code: number;
	stdout: string;
	stderr: string;
};

export async function runCommand(
	args: string[],
	options?: { cwd?: string },
): Promise<CommandResult> {
	const [cmd, ...rest] = args;
	if (!cmd) throw new Error("runCommand requires at least one argument");

	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, rest, {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: options?.cwd,
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

		proc.on("error", reject);
		proc.on("close", (code) => {
			resolve({
				code: code ?? 1,
				stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
				stderr: Buffer.concat(stderrChunks).toString("utf-8"),
			});
		});
	});
}
