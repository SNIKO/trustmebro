import { DATA_DIR_NAME } from "../../../config.js";
import { generateFrontmatter } from "./formatter";
import type { SkillCreationOptions } from "./types.js";

export const SOCIAL_SKILL_NAME = "search-social";

export function createSocialSkill(data: SkillCreationOptions): string {
	const [field1, field2, field3, field4] = data.exampleFields;

	const fieldName1 = field1?.name ?? "field1";
	const fieldName2 = field2?.name ?? "field2";
	const fieldName3 = field3?.name ?? "field3";
	const fieldName4 = field4?.name ?? "field4";

	const val1 = field1?.value ?? "value1";
	const val2 = field2?.value ?? "value2";
	const val3 = field3?.value ?? "value3";
	const val4 = field4?.value ?? "value4";

	const description = `Search and analyze indexed content from social sources: YouTube transcripts, Reddit discussions, and Telegram channels. Use this skill when you need information from any of these platforms to answer questions or conduct research.`;
	const processedPath = `${DATA_DIR_NAME}/processed`;
	const rawPath = `${DATA_DIR_NAME}/raw`;
	const formatter = generateFrontmatter(
		SOCIAL_SKILL_NAME,
		description,
		data.agent,
	);

	return `${formatter}

# Skill Overview

This skill enables efficient search across indexed content from three social platforms:

- **YouTube** — Video transcripts from indexed channels
- **Reddit** — Posts and comment threads from indexed subreddits
- **Telegram** — Messages from indexed channels and groups

All content is optimized for **ripgrep-based retrieval** using:

- Document-level metadata in YAML frontmatter
- Chunk-level inline tags for granular filtering
- Small, localized context windows for precise extraction

---

## Content Model

Content from all platforms is processed through the same pipeline:

1. **Ingested** — Raw content is captured and stored per platform.
2. **Chunked** — Content is split into semantic chunks (paragraphs, sections, threads).
3. **Enriched** — Each chunk is tagged with structured metadata.
4. **Stored** — Final output is written as grep-friendly Markdown files.

---

## Directory Structure

\`\`\`text
├── ${processedPath}/          # Search-optimized content with tags
│   ├── youtube/
│   │   └── {channel}/            # e.g. @financialeducation
│   │       └── YYYY-MM/
│   │           └── YYYY-MM-DD-label.md
│   ├── reddit/
│   │   └── {subreddit}/          # e.g. investing
│   │       └── YYYY-MM/
│   │           └── YYYY-MM-DD-label.md
│   └── telegram/
│       └── {channel}/            # e.g. mychannel
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
source: "youtube"          # youtube | reddit | telegram
publisher: "@channel"      # channel, subreddit, or group name
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

### Step 1: Constrain by Platform and Path First (fastest win)

Use glob filters to shrink the search surface before scanning content. Content is organized by **platform**, **publisher/subreddit/channel**, and **date**.

\`\`\`bash
# Search across all platforms
rg -F "query" ${processedPath}/

# Search a specific platform
rg -F "query" ${processedPath}/youtube/
rg -F "query" ${processedPath}/reddit/
rg -F "query" ${processedPath}/telegram/

# Search a specific publisher and month
rg -F "query" ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md"
rg -F "query" ${processedPath}/reddit/ -g "**/investing/2025-12/*.md"
rg -F "query" ${processedPath}/telegram/ -g "**/mychannel/2025-12/*.md"

# List candidate files first, then search only those
rg --files --null ${processedPath}/ -g "**/2025-12/*.md" | xargs -0 rg -F -n -C 6 "query"
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
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/ | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Restrict by platform + publisher + month + tag, then refine
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md" | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"
\`\`\`

### Step 4: Inspect Matched Chunks

Once you identify a relevant chunk:

1. Read the chunk content (paragraphs below the tags).
2. Read the file's YAML frontmatter (first ~10 lines) for document-level context.
3. Note the \`source\` field to understand which platform the content came from.
4. Avoid reading entire files or jumping between chunks without justification.

---

## Ripgrep Examples

### Basic Examples (fast defaults)

\`\`\`bash
# Simple tag search across all platforms
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/

# Platform-scoped tag search
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/youtube/
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit/
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/telegram/

# Search for any value in a tag field
rg -F -n -C 6 "${fieldName2}=" ${processedPath}/

# Case-insensitive content search (use only when needed)
rg -i -n -C 6 "${val3}" ${processedPath}/
\`\`\`

### Filtered by Date

\`\`\`bash
# Content from December 2025 across all platforms
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/ -g "**/2025-12/*.md"

# Content from Q4 2025
rg -F -n -C 6 "${fieldName2}=${val2}" ${processedPath}/ -g "**/2025-1[0-2]/*.md"

# Specific platform, specific channel/subreddit, specific date
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/youtube/ -g "**/@channel/2025-12/*.md"
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit/ -g "**/investing/2025-12/*.md"
\`\`\`

### Combined Tag Filters

\`\`\`bash
# Match chunks with two specific tags (using file list)
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/ | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Pipeline filter for complex queries
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/ | rg "${fieldName3}=.*${val3}"
\`\`\`

### Cross-Platform Research

\`\`\`bash
# Find the same topic across all platforms
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/youtube/ > /tmp/yt_files
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/reddit/ > /tmp/reddit_files
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/telegram/ > /tmp/tg_files
cat /tmp/yt_files /tmp/reddit_files /tmp/tg_files | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Compare sentiment across platforms for the same topic
rg -n -C 3 "keyword phrase" ${processedPath}/youtube/ > /tmp/yt_results.txt
rg -n -C 3 "keyword phrase" ${processedPath}/reddit/ > /tmp/reddit_results.txt
rg -n -C 3 "keyword phrase" ${processedPath}/telegram/ > /tmp/tg_results.txt
\`\`\`

### Discovery and Exploration

\`\`\`bash
# List all unique values for a tag field across all platforms
rg -o "${fieldName1}=[^\n]+" ${processedPath}/ | cut -d= -f2 | tr ',' '\n' | sort -u

# Count occurrences of each value
rg -o "${fieldName2}=[^\n]+" ${processedPath}/ | cut -d= -f2 | sort | uniq -c | sort -rn | head -20

# Find all files containing a specific tag
rg -l -F "${fieldName4}=${val4}" ${processedPath}/

# List all indexed publishers per platform
ls ${processedPath}/youtube/
ls ${processedPath}/reddit/
ls ${processedPath}/telegram/
\`\`\`

### Full-Text Search (Fallback)

\`\`\`bash
# Search body content when tags don't match
rg -n -C 3 "keyword phrase" ${processedPath}/

# Regex pattern search
rg -n -C 3 "\\b(term1|term2|term3)\\b" ${processedPath}/

# Platform-scoped full-text search
rg -n -C 3 "keyword phrase" ${processedPath}/reddit/
\`\`\`

---

## Handling No Results

Not all tags are present or accurate in every chunk. If no matches are found:

1. **Widen the time range** — Remove or expand date glob patterns.
2. **Try other platforms** — The topic may be covered on YouTube but not Reddit, or vice versa.
3. **Try alternative values** — Use different spellings, synonyms, or related terms.
4. **Check for partial matches** — Use \`=.*value\` pattern for array fields.
5. **Fall back to full-text search** — Search body content directly.
6. **Explore available values** — Use the discovery commands above to see what tags exist.

---

## Output Guidelines

When presenting information to users:

- **Cite sources** by document title, source platform, and publisher/subreddit/channel.
- **Attribute by platform** — distinguish YouTube opinions from Reddit community views from Telegram discussions.
- **Summarize faithfully** — Do not extrapolate beyond the evidence.
- **Never expose** internal file paths, IDs, or implementation details.
`;
}
