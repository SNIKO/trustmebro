const META_PREFIXES = ["WEBVTT", "Kind:", "Language:"];

export function vttToPlainText(vtt: string): string {
	const lines = vtt.split(/\r?\n/);
	const seen = new Set<string>();
	const output: string[] = [];
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
		if (line.includes("-->")) continue;
		const clean = decodeEntities(stripTags(line));
		if (!clean) continue;
		if (seen.has(clean)) continue;
		seen.add(clean);
		output.push(clean);
	}
	return output.join("\n");
}

function stripTags(input: string): string {
	return input.replace(/<[^>]*>/g, "");
}

function decodeEntities(input: string): string {
	return input
		.replaceAll("&amp;", "&")
		.replaceAll("&gt;", ">")
		.replaceAll("&lt;", "<");
}
