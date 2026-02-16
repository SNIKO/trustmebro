import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/app.ts"],
	format: ["esm"],
	clean: true,
	target: "node18",
	banner: {
		js: "#!/usr/bin/env node",
	},
});
