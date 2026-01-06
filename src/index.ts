export type CliResult = {
	code: number;
};

export async function runCli(argv: string[]): Promise<CliResult> {
	// argv is expected to be process.argv.slice(2)
	const args = argv;
	if (args.includes("--help") || args.includes("-h") || args.length === 0) {
		printHelp();
		return { code: 0 };
	}

	if (args.includes("--version") || args.includes("-v")) {
		await printVersion();
		return { code: 0 };
	}

	console.error("Unknown arguments: ", args.join(" "));
	printHelp();
	return { code: 1 };
}

function printHelp(): void {
	console.log(
		[
			"TrustMeBro",
			"",
			"Usage:",
			"  trustmebro [--help] [--version]",
			"",
			"Options:",
			"  -h, --help     Show help",
			"  -v, --version  Show version",
		].join("\n"),
	);
}

async function printVersion(): Promise<void> {
	const pkg = await readPackageJson();
	console.log(pkg.version ?? "0.0.0");
}

async function readPackageJson(): Promise<{ version?: string }> {
	const packageJsonUrl = new URL("../package.json", import.meta.url);
	return (await Bun.file(packageJsonUrl).json()) as { version?: string };
}
