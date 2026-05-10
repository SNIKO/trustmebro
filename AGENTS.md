# Agent Guidelines

## Project

TrustMeBro turns social media noise into a grep-friendly, agent-searchable knowledge base. It fetches content from YouTube, Reddit, and Telegram; processes it through an LLM to extract structured tags (tickers, sentiment, narratives); and writes searchable Markdown to a local workspace. The end goal: point an AI agent at the workspace and ask natural-language questions instead of doom-scrolling six platforms.

## Project Structure

```
src/
  app.ts              # CLI entry point — registers commands
  config.ts           # Config loading and validation (config.yaml)
  context.ts          # Shared runtime context passed through the pipeline
  commands/
    auth/             # `trustmebro auth` — one-time source authentication (Telegram)
    index/            # `trustmebro index` — fetch → process → write pipeline
    generate/         # `trustmebro generate skills` — generates agent skill files
  sources/
    youtube/          # YouTube fetcher (yt-dlp, transcript extraction)
    reddit/           # Reddit fetcher
    telegram/         # Telegram fetcher (MTProto session)
    types.ts          # Shared source types
    base-state.ts     # Incremental sync state (last-fetched tracking)
    index.ts          # Source registry
  content/
    processor.ts      # LLM tagging and enrichment
    storage.ts        # Markdown writer — raw/ and processed/ layout
    types.ts          # Content and tag types
    index.ts
  utils/
    logger.ts         # Structured console logger
    exec.ts           # Shell command helpers
    vtt.ts            # VTT subtitle parser
    colors.ts         # Terminal color helpers
```

## Rules

Use `.agents/design-rules.md` when:
- doing design or architecture work
- creating new files or modules
- making significant changes to existing code

Use `.agents/coding-rules.md` when:
- writing or modifying code

Use `.agents/git-rules.md` when:
- working with Git branches and commits
- creating pull requests
