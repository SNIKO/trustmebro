<div align="left">

# TrustMeBro

**Turn social media noise into a searchable knowledge base for AI agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/SNIKO/trustmebro/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/SNIKO/trustmebro/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nikosv/trustmebro)](https://www.npmjs.com/package/@nikosv/trustmebro)

Fetch content from YouTube, Reddit, and more — process it with LLMs — and let your AI agent search, analyze, and synthesize insights across all of it.

**Supported platforms:** YouTube, Reddit, Telegram · **Coming soon:** Twitter

</div>

---

## Why TrustMeBro?

Ever felt that low-key anxiety when you're 47 videos behind on your favorite finance YouTubers, three Reddit threads deep at 2 AM, and you *still* feel like you're missing something important? The FOMO is real. You can't watch everything, read everything, and remember everything — and yet somehow you're supposed to make informed decisions based on all of it.

We've all been there, and TrustMeBro is here to help.

It fetches all the content you care about, runs it through an LLM, and spits out a searchable, tagged, grep-friendly knowledge base. Then you point ClaudeCode (or any other AI agent) at it and ask questions like a normal person instead of doom-scrolling until 3 AM.

| The pain | The fix |
|---|---|
| 47 unwatched videos, infinite Reddit scroll | **Automated fetching** — pulls everything from your tracked sources |
| "I saw a great take on NVDA last week... somewhere" | **Persistent storage** — every piece of content saved as searchable Markdown |
| Can't `ctrl+F` your YouTube watch history | **Structured tagging** — LLM extracts tickers, sentiment, topics, narratives |
| Alt-tabbing between 6 platforms like a maniac | **Agent-ready output** — ask your AI to synthesize it all in one place |

---

## Quick Start

### 1. Install

```bash
# npm
npm install -g @nikosv/trustmebro

# bun
bun install -g @nikosv/trustmebro

# or run directly without installing
npx @nikosv/trustmebro index
bunx @nikosv/trustmebro index
```

> **Prerequisites:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) is required for YouTube fetching. Telegram requires API credentials from [my.telegram.org](https://my.telegram.org).

### 2. Create a Workspace

```bash
mkdir -p ~/stocks && cd ~/stocks
```

Create a `config.yaml` in your workspace directory. See [config.template.yaml](config.template.yaml) for a fully documented example with inline comments.

### 3. Configure the Model

TrustMeBro uses an LLM to process and tag content. It relies on [AI SDK providers](https://sdk.vercel.ai/providers/ai-sdk-providers) for model access, so you can choose from a wide range of providers and models based on your needs and budget.

1. **Set your API key** as an environment variable:
   ```bash
   export OPENAI_API_KEY="sk-..."
   # or add to ~/.bashrc, ~/.zshrc, etc.
   ```

2. **Reference it in `config.yaml`:**
   ```yaml
   indexing:
     workers: 5
     model:
       provider: "@ai-sdk/openai"
       model: "gpt-4o-mini"
       options:
         apiKey: "env.OPENAI_API_KEY"  # References environment variable
   ```

> **Tip:** Use `"env.VARIABLE_NAME"` syntax in your config to keep secrets out of config files.

### 4. Configure Domains

TrustMeBro organizes everything into **domains** — each domain groups a topic, its sources, and its tag schema. A workspace can have multiple independent domains (e.g. `stock-market`, `crypto`, `health`).

Edit your `config.yaml` and add a `domains` array. Each domain supports:

- **`name`** — Kebab-case slug used as the folder name on disk (e.g. `stock-market`)
- **`description`** — High-level description of the domain for LLM context
- **`startDate`** — Fetch content published on or after this date (YYYY-MM-DD)
- **`contentDir`** — *(optional)* Where to store raw and processed files. Defaults to the domain `name`. Accepts relative or absolute paths.
- **`sources.youtube.publishers`** — YouTube channel handles (with `@` prefix)
- **`sources.reddit.publishers`** — Subreddit names to track
- **`sources.reddit.commentsCountThreshold`** — Minimum comment count to index a post
- **`sources.telegram.publishers`** — Telegram channel usernames (with or without `@`)
- **`sources.telegram.minMessageLength`** — Minimum character length to index a message (default: 200)
- **`tags`** — Structured metadata to extract per domain (tickers, sentiment, sectors, narratives, etc.)

```yaml
domains:
  - name: stock-market
    description: "Stock market, investing, and financial markets"
    startDate: 2025-12-01
    sources:
      youtube:
        publishers:
          - "@everythingmoney"
          - "@JosephCarlsonShow"
      reddit:
        publishers:
          - "investing"
        commentsCountThreshold: 10
      telegram:
        publishers:
          - "trend_gen"
        minMessageLength: 200
    tags:
      ticker:
        type: string[]
        description: "Canonical stock tickers, UPPERCASE only."
      sentiment:
        type: enum[]
        description: "Directional stance on the stock/market."
        values: [bullish, bearish]
```

See [config.template.yaml](config.template.yaml) for a fully documented example with multiple domains and all available options.

### 5. Authenticate (Telegram only)

Telegram requires a one-time interactive login using your Telegram account. Set your credentials as environment variables first:

```bash
export TELEGRAM_API_ID="12345"        # from my.telegram.org
export TELEGRAM_API_HASH="abc123..."  # from my.telegram.org
```

Then run:

```bash
trustmebro auth --source telegram
```

This saves a session to `.trustmebro/telegram-session.txt`. You only need to do this once.

### 6. Run Indexing

```bash
cd ~/stocks

# Index all configured sources
trustmebro index

# Index a specific source
trustmebro index --source youtube
trustmebro index --source reddit
trustmebro index --source telegram

# Index a specific publisher
trustmebro index --source youtube --publisher @JosephCarlsonShow

# Use a different workspace
trustmebro index --workspacePath /path/to/workspace
```

---

## How It Works

TrustMeBro runs a three-step pipeline:

1. **Fetch** — Pulls content since `startDate` (or last sync) from all configured sources
2. **Process** — Chunks, tags, and enriches content with LLMs using your configured tag schema
3. **Write** — Outputs grep-friendly Markdown organized by source, publisher, and date

After indexing, your workspace looks like this:

```
~/stocks/
  .trustmebro/              # Internal state (auto-managed)
  stock-market/             # One folder per domain (contentDir defaults to domain name)
    raw/                    # Original fetched content
      youtube/
        everythingmoney/
          2025-12/
            2025-12-15-nvidia-earnings-analysis.md
      reddit/
        investing/
          2025-12/
            2025-12-20-best-etf-for-long-term-growth.md
      telegram/
        trend_gen/
          2025-12/
            2025-12-18-market-update.md
    processed/              # LLM-enriched, search-optimized content
      youtube/
        everythingmoney/
          2025-12/
            2025-12-15-nvidia-earnings-analysis.md
      reddit/
        investing/
          2025-12/
            2025-12-20-best-etf-for-long-term-growth.md
      telegram/
        trend_gen/
          2025-12/
            2025-12-18-market-update.md
  crypto/              # A second domain with its own sources and tags
    raw/
      youtube/
        ...
    processed/
      ...
  config.yaml
```

Each domain gets its own directory tree under `raw/` and `processed/`. You can override the path with the `contentDir` field in the domain config.

---

## AI Agent Integration

The real power of TrustMeBro is pairing indexed content with AI agents that can search and reason over it.

### Generate Agent Skills

TrustMeBro can generate skills that teach your agent to search indexed content with ripgrep:

```bash
cd ~/stocks
trustmebro generate skills
```

Select your agent type and TrustMeBro will generate a skill per source (e.g., `search-youtube`, `search-reddit`) tailored to your topic, tags, and directory structure.

These skills are a good starting point — customize them to fit your content domain.

### Start Chatting

Once set up, ask Claude Code (or any other agent):

> *"What's the sentiment on NVIDIA in the last month?"*

> *"Find all strong buy recommendations from December 2025"*

> *"Compare sentiment on Tesla across YouTube vs Reddit vs Telegram"*

> *"What narratives are trending in tech stocks this quarter?"*

> *"Show me dividend stock discussions with hold or sell recommendations"*

Your agent will use ripgrep to search the indexed content and synthesize insights across sources.

---

## Use Cases

### Stock Market Research

- Create a workspace `~/stocks` with your favorite YouTube finance channels, investing subreddits, and Telegram channels
- Connect finance-related MCP servers (Yahoo Finance, Seeking Alpha, etc.)
- Store your portfolio holdings and watchlists alongside the indexed content
- Ask your agent to find sentiment, recommendations, narratives, and insights

### Health & Wellness

- Create a workspace `~/health` with YouTube health channels, medical subreddits, and Telegram health communities
- Connect medical MCP servers (PubMed, Medscape, etc.)
- Store your medical history and test results in the workspace
- Ask your agent about trends, new research, supplements, and recommendations specific to your goals

### Real Estate

- Create a workspace `~/realestate` with real estate channels and subreddits for your market
- Connect real estate MCP servers and write skills for accessing government APIs (property records, zoning, etc.)
- Ask your agent about market trends, specific properties, suburbs, and investment opportunities

---

## License

MIT © Sergii Vashchyshchuk
