export type CommandResult = {
	code: number;
	stdout: string;
	stderr: string;
};

export async function runCommand(
	args: string[],
	options?: { cwd?: string },
): Promise<CommandResult> {
	const proc = Bun.spawn(args, {
		stdout: "pipe",
		stderr: "pipe",
		cwd: options?.cwd,
	});
	const stdoutPromise = proc.stdout
		? new Response(proc.stdout).text()
		: Promise.resolve("");
	const stderrPromise = proc.stderr
		? new Response(proc.stderr).text()
		: Promise.resolve("");
	const [stdout, stderr, code] = await Promise.all([
		stdoutPromise,
		stderrPromise,
		proc.exited,
	]);
	return { code, stdout, stderr };
}
