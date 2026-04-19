# TrustMeBro Agent Guide

## Stack & Runtime

- **Runtime**: Bun (latest)
- **Language**: TypeScript (ESNext, strict mode)
- **Package Manager**: Bun
- **Build Tool**: tsup (ESM output to `dist/`)

## Development Commands

```bash
# Development
bun run dev              # Run CLI from source
bun run build            # Build to dist/
bun run typecheck        # TypeScript type checking

# Code Quality
bun run lint             # Biome lint
bun run fix              # Biome format + fix
bun run check            # Biome check (lint + format)

# Release
bun run changeset        # Create changeset
bun run version          # Bump versions from changesets
bun run release          # Publish to npm
```

**Required order**: `lint → typecheck → build` (CI enforces typecheck + build)

## Code Style

- **Formatter**: Biome
- **Indentation**: Tabs
- **Quotes**: Double quotes
- **Semicolons**: Always
- **Imports**: Auto-organized on format

## Git Conventions

**Branch names**: `feat|fix|refactor|chore|docs|test/{description}`

**Commit messages**:
- `feat:` - New features
- `fix:` - Bug fixes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks
- `docs:` - Documentation

**Base branch**: `master`

## Architecture

### Source-Based Design

Each platform (YouTube, Reddit, Telegram, Twitter) is a self-contained source in `src/sources/{source}/`:

```
src/sources/
├── youtube/      # YouTube ingestion
├── reddit/       # Reddit ingestion
├── telegram/     # Telegram ingestion
└── types.ts      # Shared source interfaces
```

Each source implements:
- `fetch.ts` - Fetch raw content
- `process.ts` - Transform and enrich with LLM
- `state.ts` - Track last fetched position
- `types.ts` - Source-specific types
- `index.ts` - Source factory (exports `Source` interface)

### Content Engine

`src/content/` handles LLM processing and storage:
- `processor.ts` - LLM-based tagging and summarization
- `storage.ts` - File system output (Markdown)
- `types.ts` - Content engine interfaces

### Configuration

- **Format**: YAML (`config.yaml` in workspace)
- **Validation**: Zod schemas in `src/config.ts`
- **Environment**: Use `"env.VARIABLE_NAME"` syntax for secrets

### CLI Structure

`src/commands/` using `@stricli/core`:
- `auth/` - Authentication commands
- `index/` - Main indexing command
- `generate/` - Asset generation (skills, etc.)

## Important Gotchas

### Telegram TIMEOUT Errors

Telegram's update loop throws `TIMEOUT` errors when pings fail. These are expected and harmless. Suppress them in error handlers:

```typescript
client.onError = async (error) => {
  if (error.message === "TIMEOUT") return;
  throw error;
};
```

### No Tests

Currently no test suite. Verify changes manually with `bun run dev` and `bun run typecheck`.

### Release Process

Uses Changesets for versioning:
1. `bun run changeset` - Describe changes
2. Push to master triggers automatic version bump
3. `bun run release` - Publishes to npm

### External Dependencies

- **yt-dlp**: Required for YouTube fetching (install separately)
- **Telegram**: Requires `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` env vars
- **LLM**: Requires provider API keys (e.g., `OPENAI_API_KEY`)

## Workspace Structure

User workspaces contain:
```
~/workspace/
├── config.yaml              # User configuration
├── .trustmebro/            # Internal state (auto-managed)
│   └── telegram-session.txt
└── data/social/
    ├── raw/                # Original fetched content
    └── processed/          # LLM-enriched Markdown
```

## Type Safety

- **Strict mode**: Enabled
- **No unchecked indexed access**: Enabled
- **No implicit override**: Enabled
- **Unused locals/params**: Disabled (allow for future use)

Always run `bun run typecheck` before committing.
