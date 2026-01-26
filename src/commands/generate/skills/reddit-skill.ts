import { DATA_DIR_NAME } from "../../../config.js";
import { generateFrontmatter } from "./formatter";
import type { SkillCreationOptions } from "./types.js";

export const REDDIT_SKILL_NAME = "search-reddit";

export function createRedditSkill(data: SkillCreationOptions): string {
	const [field1, field2, field3, field4] = data.exampleFields;

	const fieldName1 = field1?.name ?? "field1";
	const fieldName2 = field2?.name ?? "field2";
	const fieldName3 = field3?.name ?? "field3";
	const fieldName4 = field4?.name ?? "field4";

	const val1 = field1?.value ?? "programming";
	const val2 = field2?.value ?? "high";
	const val3 = field3?.value ?? "discussion";
	const val4 = field4?.value ?? "user123";

	const description = `Search and analyze indexed content from reddit. Use this skill when you need information from reddit discussions to answer questions or conduct research.`;
	const processedPath = `${DATA_DIR_NAME}/processed`;
	const rawPath = `${DATA_DIR_NAME}/raw`;
	const formatter = generateFrontmatter(
		REDDIT_SKILL_NAME,
		description,
		data.agent,
	);

	return `${formatter}

# Skill Overview

This skill enables efficient search across indexed discussions from reddit.

The indexed reddit content is optimized for **ripgrep-based retrieval** using:

- Document-level metadata in YAML frontmatter
- Chunk-level inline tags for granular filtering
- Score-weighted content for consensus detection
- Small, localized context windows for precise extraction

---

## Content Model

All content from reddit discussions is processed through this pipeline:

1. **Ingested** — Raw posts and comments are captured and stored.
2. **Chunked** — Content is split into semantic groups (post, consensus, dissent, evidence).
3. **Enriched** — Each chunk is tagged with structured metadata and score signals.
4. **Stored** — Final output is written as grep-friendly Markdown files.

---

## Directory Structure

\`\`\`text
├── ${processedPath}/          # Search-optimized content with tags
│   └── reddit/
│       └── {subreddit}/          # Subreddit organization
│           └── YYYY-MM/
│               └── YYYY-MM-DD-label.md
└── ${rawPath}/                # Original content (mirrors ${processedPath}/)
\`\`\`

**Important:** Always search \`${processedPath}/\` first. Only consult \`${rawPath}/\` if you need the exact original wording, full comment threads, or if processed content is insufficient.

---

## File Format

Each processed file consists of:

1. **YAML frontmatter** — Document-level metadata (title, source, subreddit, date).
2. **Chunked content** — Each chunk has:
   - A numbered heading (e.g., \`## 01 Chunk Title\`)
   - Inline tag lines (key=value format)
   - Paragraph content with score-weighted importance

**Example structure:**

\`\`\`markdown
---
title: "Example Post Title"
source: "reddit"
publisher: "programming"
created_at: 2025-12-15T10:00:00Z
---

## 01 Post Summary
${fieldName1}=${val1}
${fieldName2}=${val2}

This is the distilled essence of the original post, capturing the main question or topic.

## 02 Community Consensus
${fieldName3}=${val3}
${fieldName4}=${val4}

Widely agreed upon points from highly upvoted comments, representing the dominant community view.

## 03 Major Disagreements
${fieldName1}=${val1}

Significant counterarguments or dissenting opinions from medium-score comments.

## 04 Supporting Evidence
${fieldName2}=${val2}

First-hand experiences, data points, or evidence shared by commenters.
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

Use glob filters to shrink the search surface before scanning content. The reddit index is organized by **subreddit** and **date**, so path globs are extremely effective.

\`\`\`bash
# Search within a specific subreddit (all time)
rg -F "query" ${processedPath}/reddit/ -g "**/programming/*.md"

# Search within a specific month (all subreddits)
rg -F "query" ${processedPath}/reddit/ -g "**/2025-12/*.md"

# Search specific subreddit and month
rg -F "query" ${processedPath}/reddit/ -g "**/programming/2025-12/*.md"

# List candidate files first, then search only those
rg --files --null ${processedPath}/reddit/ -g "**/programming/2025-12/*.md" | xargs -0 rg -F -n -C 6 "query"
\`\`\`

### Step 2: Filter by Tags (fast + precise)

Search tag lines to locate relevant chunks. Always include context (\`-C 6\`) to capture the full tag block and surrounding content.

**Simple exact match (fixed string):**

\`\`\`bash
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit/
\`\`\`

**Array field (regex only when needed):**

\`\`\`bash
rg -n -C 6 "${fieldName1}=.*${val1}" ${processedPath}/reddit/
\`\`\`

### Step 3: Combine Filters Efficiently

Use a file list to intersect multiple criteria without rescanning everything:

\`\`\`bash
# Find files with tag A, then search those files for tag B
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/reddit | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Restrict by subreddit + month + tag, then refine
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/reddit/ -g "**/programming/2025-12/*.md" | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"
\`\`\`

### Step 4: Inspect Matched Chunks

Once you identify a relevant chunk:

1. Read the chunk content (paragraphs below the tags).
2. Read the file's YAML frontmatter (first ~10 lines) for document-level context.
3. For full conversation threads, consult the raw content in \`${rawPath}/\`.

---

## Ripgrep Examples

### Basic Examples (fast defaults)

\`\`\`bash
# Simple tag search with context (fixed string)
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit/

# Search for any value in a tag field
rg -F -n -C 6 "${fieldName2}=" ${processedPath}/reddit/

# Case-insensitive content search (use only when needed)
rg -i -n -C 6 "${val3}" ${processedPath}/reddit/

# Search within a specific subreddit directory
rg -F -n -C 6 "${fieldName3}=${val3}" ${processedPath}/reddit/ -g "**/programming/**/*.md"
\`\`\`

### Filtered by Date

\`\`\`bash
# Content from December 2025
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit/ -g "**/2025-12/*.md"

# Content from Q4 2025
rg -F -n -C 6 "${fieldName2}=${val2}" ${processedPath}/reddit/ -g "**/2025-1[0-2]/*.md"

# Specific subreddit, specific date
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit/ -g "**/programming/2025-12/*.md"
\`\`\`

### Combined Tag Filters

\`\`\`bash
# Match chunks with two specific tags (using file list)
rg -l --null -F "${fieldName1}=${val1}" ${processedPath}/reddit | xargs -0 rg -F -n -C 6 "${fieldName2}=${val2}"

# Pipeline filter for complex queries
rg -F -n -C 6 "${fieldName1}=${val1}" ${processedPath}/reddit | rg "${fieldName3}=.*${val3}"
\`\`\`

### Discovery and Exploration

\`\`\`bash
# List all unique values for a tag field
rg -o "${fieldName1}=[^\n]+" ${processedPath}/reddit/ | cut -d= -f2 | tr ',' '\n' | sort -u

# Count occurrences of each value
rg -o "${fieldName2}=[^\n]+" ${processedPath}/reddit/ | cut -d= -f2 | sort | uniq -c | sort -rn | head -20

# Find all files containing a specific tag
rg -l -F "${fieldName4}=${val4}" ${processedPath}/reddit/
\`\`\`

### Full-Text Search (Fallback)

\`\`\`bash
# Search body content when tags don't match
rg -n -C 3 "keyword phrase" ${processedPath}/reddit/

# Regex pattern search
rg -n -C 3 "\\b(term1|term2|term3)\\b" ${processedPath}/reddit/
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

## Raw Content Access

When you need the exact original conversations, full comment threads, or unprocessed content:

\`\`\`bash
# Access raw reddit content
ls ${rawPath}/reddit/{subreddit}/YYYY-MM/

# Read the original post and all comments
cat ${rawPath}/reddit/programming/2025-12/2025-12-15-post-title.md
\`\`\`

**When to use raw content:**
- You need the exact wording of comments
- You want to see the full conversation thread structure
- Processed content seems incomplete or missing context
- You need to verify the accuracy of processed summaries

---

## Output Guidelines

When presenting information to users:

- **Cite sources** by document title, source, and subreddit.
- **Summarize faithfully** — Do not extrapolate beyond the evidence.
- **Indicate consensus level** — Use phrases like "widely agreed", "controversial", "minority view" based on score signals.
- **Never expose** internal file paths, IDs, or implementation details.
`;
}
