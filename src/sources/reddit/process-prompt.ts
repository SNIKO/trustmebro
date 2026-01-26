export function getRedditProcessingPrompt(
	domain: string,
	tagSchema: string,
): string {
	return `# INSTRUCTIONS

Clean, chunk, and tag Reddit content for **grep-based search** in the domain: ${domain}.

This content comes from Reddit and consists of:
- A primary post (title + body)
- A tree of comments with scores (upvotes/downvotes)
- Nested replies expressing agreement, disagreement, clarification, or emotional reactions

Process Reddit content differently from linear articles.

## Core Principle

Optimize for **single-pass grep scanning**:

A single grep hit must immediately reveal:
- What was said
- How strongly the community reacted (score-based importance)
- Whether the statement reflects consensus, dissent, or a niche opinion

## Processing guide

### Content Structure Awareness
- Treat the **post** as the root context and always process it first.
- Treat **comments** as independent informational units weighted by score.
- Flatten comment trees into semantic groups **only when meaningfully related**.
- Preserve reply relationships only when they add new facts or clear disagreement.

### Score & Signal Usage

Use comment scores to infer importance:
- High-score comments → represent consensus, strong agreement, or high informational value.
- Medium-score comments → relevant perspectives or supporting detail.
- Low-score or negative-score comments → dissent, controversy, skepticism, or emotional reactions.

Explicitly reflect score signals in wording (e.g. "widely agreed", "highly upvoted", "controversial", "minor dissent").

### Cleaning Strattegy

Remove:
- Bot and auto-generated comments
- Usernames, flairs, karma counts, awards
- Meme-only replies, jokes without factual content
- "This", "lol", "same", emoji-only reactions
- Meta comments about the platform itself
- Repeated paraphrases unless they add new facts

Preserve:
- Arguments, counterarguments, clarifications
- First-hand experiences
- Claims tied to evidence, links, numbers, or dates
- Emotional tone when it explains motivation or sentiment

## Chunking Strategy

Prefer **fewer, information-dense chunks**:

1. Post summary chunk (title + distilled body)
2. Consensus / dominant viewpoints (high-score comments)
3. Key supporting evidence or examples
4. Major disagreements or counterpoints
5. Edge cases, niche insights, or strong emotional reactions (if informative)

Do NOT:
- Create one chunk per comment
- Pad chunks to hit size targets
- Merge unrelated viewpoints

Each chunk must stand alone.

## Output

### Format

The output format is defined inside markdown code block as follows:

\`\`\`markdown
## 01 Short descriptive title for chunk
tag_1=value_1
tag_2=value_4
tag_3=value_5,value_6
<cleaned, condensed content>

## 02 Short descriptive title for chunk
tag_1=value_1
tag_2=value_9
tag_4=value_7,value_8
<cleaned, condensed content>
\`\`\`

Do NOT include the block markers in your output (i.e. \`\`\`).

### Tagging Rules
- Use ONLY fields defined in the SCHEMA below.
- Do not invent fields.
- Omit empty fields.
- One field per line.
- No duplicate fields.
- Arrays = comma-separated.
- Enums = schema values only.
- Dates = ISO-8601 (YYYY-MM-DD).
- Snake_case where appropriate.
- Uppercase for tickers, symbols, codes.
- Maintain schema field order.

### Content Rules
- Output MUST be plain text.
- No analysis, interpretation, or synthesis beyond condensation.
- Preserve **all factual claims**, uncertainty, ranges, and conditions.
- Preserve sentiment and emotional intensity when relevant
- Sentences must be declarative and information-dense.
- Avoid pronouns; keep entities explicit.
- Normalize numbers (e.g. 1,200 → 1,200.00 when appropriate).

When summarizing comments:
- Attribute claims implicitly (e.g. "Multiple commenters report…", "A minority view argues…").
- Reflect score-derived importance explicitly in phrasing.

## Tag Schema

${tagSchema}

## Content to Process

{CONTENT}`;
}
