import { DATA_DIR_NAME } from "../../../config.js";
import { generateFrontmatter } from "./formatter";
import type { SkillCreationOptions } from "./types.js";

export const YOUTUBE_SKILL_NAME = "search-youtube";

export function createYoutubeSkill(data: SkillCreationOptions): string {
	const [field1, field2, field3, field4] = data.exampleFields;

	const fieldName1 = field1?.name ?? "field1";
	const fieldName2 = field2?.name ?? "field2";
	const fieldName3 = field3?.name ?? "field3";
	const fieldName4 = field4?.name ?? "field4";

	const val1 = field1?.value ?? "value1";
	const val2 = field2?.value ?? "value2";
	const val3 = field3?.value ?? "value3";
	const val4 = field4?.value ?? "value4";

	const description = `Search and analyze indexed content from youtube. Use this skill when you need information from youtube transcripts to answer questions or conduct research.`;
	const processedPath = `${DATA_DIR_NAME}/processed`;
	const rawPath = `${DATA_DIR_NAME}/raw`;
	const formatter = generateFrontmatter(
		YOUTUBE_SKILL_NAME,
		description,
		data.agent,
	);

	return `${formatter}

# Skill Overview

This skill enables efficient search across indexed transcripts from youtube.

The indexed transcript content is optimized for **ripgrep-based retrieval** using:

- Document-level metadata in YAML frontmatter
- Chunk-level inline tags for granular filtering
- Small, localized context windows for precise extraction

---

## Content Model

All content from dedicated youtube channels is processed through this pipeline:

1. **Ingested** — Raw content is captured and stored.
2. **Chunked** — Content is split into semantic chunks (paragraphs, sections).
3. **Enriched** — Each chunk is tagged with structured metadata.
4. **Stored** — Final output is written as grep-friendly Markdown files.

---

## Directory Structure

\`\`\`text
├── ${processedPath}/          # Search-optimized content with tags
│   └── youtube/
│       └── {publisher}/          # Optional publisher subdirectory
│           └── YYYY-MM/
│               └── YYYY-MM-DD-label.md
└── ${rawPath}/                # Original content (mirrors ${processedPath}/)
\`\`\`

**Important:** Always search \`${processedPath}/\` first. Only consult \`${rawPath}/\` if you need the exact original wording or if processed content is insufficient.

---

## File Format

Each processed file consists of:

1. **YAML frontmatter** — Document-level metadata (title, source, publisher, date).
2. **Chunked content** — Each chunk has:
   - A numbered heading (e.g., \`## 01 Chunk Title\`)
   - Inline tag lines (key=value format)
   - Paragraph content

**Example structure:**

\`\`\`markdown
---
title: "Example Document Title"
source: "youtube"
publisher: "@financialeducation"
created_at: 2025-12-15T10:00:00Z
---

## 01 First Chunk Title
${fieldName1}=${val1}
${fieldName2}=${val2}

This is the content of the first chunk. It contains the relevant
information extracted from the source material.

## 02 Second Chunk Title
${fieldName3}=${val3}
${fieldName4}=${val4}

Content of the second chunk continues here with additional details.
\`\`\`

---

## Tag Format

- **Location:** Tag lines appear directly below each chunk heading.
- **Syntax:** \`field_name=value\` (no spaces around \`=\`).
- **Arrays:** Comma-separated with no spaces: \`field=val1,val2,val3\`.
- **Coverage:** Each chunk contains only the tags relevant to its content; expect approximately half of all possible tags per chunk.

---

## Available Tag Fields

Use only the following tag fields. Do not invent new tag names.

${data.tagReferenceList}

---

## Search Strategy

### Step 0: Always Use ripgrep

\`rg\` is the **required** tool for searching this content. Prefer fixed-string searches (\`-F\`) for tags and metadata whenever possible — it's faster and avoids regex overhead.

### Step 1: Constrain by Path First (fastest win)

Use glob filters to shrink the search surface before scanning content. The transcript index is organized by **channel** and **date**, so path globs are extremely effective.

\`\`\`bash
# Search within a specific month (all channels)
rg -F "query" ${processedPath}/youtube/ -g "**/2025-12/*.md"

# Search a specific channel and month
rg -F "query" ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md"

# List candidate files first, then search only those
rg --files --null ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md" | xargs -0 rg -F -n -C 6 "query"
\`\`\`

### Step 2: Filter by Tags (fast + precise)

Search tag lines to locate relevant chunks. Always include context (\`-C 6\`) to capture the full tag block and surrounding content.

**Simple exact match (fixed string):**

\`\`\`bash
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/
\`\`\`

**Array field (regex only when needed):**

\`\`\`bash
rg -n -C 6 "${fieldName1}=.*${val1}" ${processedPath}/
\`\`\`

### Step 3: Combine Filters Efficiently

Use a file list to intersect multiple criteria without rescanning everything:

\`\`\`bash
# Find files with tag A, then search those files for tag B
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/youtube | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Restrict by channel + month + tag, then refine
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md" | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"
\`\`\`

### Step 4: Inspect Matched Chunks

Once you identify a relevant chunk:

1. Read the chunk content (paragraphs below the tags).
2. Read the file's YAML frontmatter (first ~10 lines) for document-level context.
3. Avoid reading entire files or jumping between chunks without justification.

---

## Ripgrep Examples

### Basic Examples (fast defaults)

\`\`\`bash
# Simple tag search with context (fixed string)
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/youtube/

# Search for any value in a tag field
rg -F -n -C 6 "${fieldName2}=" ${processedPath}/youtube/

# Case-insensitive content search (use only when needed)
rg -i -n -C 6 "${val3}" ${processedPath}/youtube/

# Search within a specific channel directory
rg -F -n -C 6 "${fieldName3}=${val3}" ${processedPath}/youtube/ -g "**/@channel/**/*.md"
\`\`\`

### Filtered by Date

\`\`\`bash
# Content from December 2025
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/youtube/ -g "**/2025-12/*.md"

# Content from Q4 2025
rg -F -n -C 6 "${fieldName2}=${val2}" ${processedPath}/youtube/ -g "**/2025-1[0-2]/*.md"

# Specific channel, specific date
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md"
\`\`\`

### Combined Tag Filters

\`\`\`bash
# Match chunks with two specific tags (using file list)
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/youtube/ | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Pipeline filter for complex queries
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/youtube/ | rg "${fieldName3}=.*${val3}"
\`\`\`

### Discovery and Exploration

\`\`\`bash
# List all unique values for a tag field
rg -o "${fieldName1}=[^\n]+" ${processedPath}/youtube/ | cut -d= -f2 | tr ',' '\n' | sort -u

# Count occurrences of each value
rg -o "${fieldName2}=[^\n]+" ${processedPath}/youtube/ | cut -d= -f2 | sort | uniq -c | sort -rn | head -20

# Find all files containing a specific tag
rg -l -F "${fieldName4}=${val4}" ${processedPath}/youtube/
\`\`\`

### Full-Text Search (Fallback)

\`\`\`bash
# Search body content when tags don't match
rg -n -C 3 "keyword phrase" ${processedPath}/youtube/

# Regex pattern search
rg -n -C 3 "\\b(term1|term2|term3)\\b" ${processedPath}/youtube/
\`\`\`

---

## Handling No Results

Not all tags are present or accurate in every chunk. If no matches are found:

1. **Widen the time range** — Remove or expand date glob patterns.
2. **Try alternative values** — Use different spellings, synonyms, or related terms.
3. **Check for partial matches** — Use \`=.*value\` pattern for array fields.
4. **Fall back to full-text search** — Search body content directly.
5. **Explore available values** — Use the discovery commands above to see what tags exist.

---

## Output Guidelines

When presenting information to users:

- **Cite sources** by document title, source, and publisher.
- **Summarize faithfully** — Do not extrapolate beyond the evidence.
- **Never expose** internal file paths, IDs, or implementation details.
`;
}
