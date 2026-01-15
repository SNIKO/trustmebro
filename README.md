# TrustMeBro

> **Your AI Agent's Social Media Research Assistant**: Fetch and index social media content for agentic search workflows.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

TrustMeBro is a CLI tool that fetches social media content (YouTube transcripts, Telegram posts, Twitter threads) and feeds it to [Greptor](https://github.com/greptorio/greptor) for indexing. Together, they transform scattered social media discussions into a searchable knowledge base for AI agents.

**The workflow:**
1. **TrustMeBro fetches** → Pulls content from YouTube, Telegram, Twitter based on your config
2. **Greptor indexes** → Cleans, chunks, tags, and structures the content for grep-ability
3. **Agent searches** → Uses ripgrep to find insights, patterns, and answers

## Why TrustMeBro?

Social media contains valuable insights — market sentiment, expert analysis, breaking news, community discussions — but it's scattered, noisy, and hard to process at scale.

**Problems with manual tracking:**
- **Time sink**: Watching dozens of YouTube videos or scrolling Twitter/Reddit for hours
- **No memory**: Good insights get lost in the feed
- **No search**: Can't grep your social media consumption history
- **Context switching**: Jumping between platforms breaks focus

**Terminology:**
- **Platform** — the service (YouTube, Telegram, Twitter, etc.)
- **Feed** — the account/channel/subreddit you track on that platform

**TrustMeBro + Greptor solve this by:**
- **Automated fetching**: Pull content from your tracked feeds on each platform on a schedule
- **Persistent storage**: All content saved as searchable Markdown
- **Structured tagging**: LLM-powered extraction of tickers, sentiment, topics, narratives
- **Agent-ready**: Your AI assistant can research on your behalf

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/trustmebro.git
cd trustmebro

# Install dependencies
bun install

# Build
bun run build
```

### Create a Workspace

Create a folder where you'll store configs and fetched content:

```bash
mkdir -p ~/stocks
cd ~/stocks
```

Copy the template config and customize it:

```bash
cp /path/to/trustmebro/config.template.yaml ./config.yaml
```

See [config.template.yaml](config.template.yaml) for a fully documented configuration with inline comments.

### Configure the Model

TrustMeBro uses an LLM (via [Greptor](https://github.com/greptorio/greptor)) to process and tag content. You'll need to:

1. **Choose a provider** from the [AI SDK ecosystem](https://sdk.vercel.ai/providers/ai-sdk-providers):
   - `@ai-sdk/openai` - OpenAI (GPT-4, GPT-4o, etc.)
   - `@ai-sdk/anthropic` - Anthropic (Claude)
   - `@ai-sdk/groq` - Groq (fast inference)
   - `@ai-sdk/openai-compatible` - OpenAI-compatible endpoints (NVIDIA NIM, OpenRouter, etc.)
   - And [many more](https://sdk.vercel.ai/providers/ai-sdk-providers)...

2. **Install the provider package**:
   ```bash
   bun add @ai-sdk/openai  # or your chosen provider
   ```

3. **Get an API key** from your provider and set it as an environment variable:
   ```bash
   export OPENAI_API_KEY="sk-..."
   # or add to ~/.bashrc, ~/.zshrc, etc.
   ```

4. **Configure in config.yaml**:
   ```yaml
   model:
     provider: "@ai-sdk/openai"
     model: "gpt-4o-mini"
     options:
       apiKey: "env.OPENAI_API_KEY"  # References environment variable
   ```

**Environment variable syntax:** Use `"env.VARIABLE_NAME"` in your config to reference environment variables. This keeps secrets out of your config files.

### Configure Sources and Tags

Edit your `config.yaml` to specify:

- **`startDate`**: Fetch content from this date forward (YYYY-MM-DD)
- **`topic`**: High-level description for context (used by the LLM)
- **`sources.youtube.publishers`**: List of YouTube channel handles (with `@` prefix)
- **`tags`**: Structured metadata to extract (tickers, sentiment, sectors, etc.)

See [config.template.yaml](config.template.yaml) for detailed documentation on all options.

### Run the Fetcher

```bash
# Navigate to your workspace directory
cd ~/stocks

# Fetch content from all configured platforms/feeds
trustmebro index

# Fetch from a specific platform only
trustmebro index --source youtube

# Fetch from a specific publisher only
trustmebro index --source youtube --publisher @JosephCarlsonShow
```

### What Happens Next

TrustMeBro will:

1. **Connect to sources** using the publishers in your config
2. **Fetch content** since `startDate` (or from last sync)
3. **Write to output folder** in Greptor-compatible format
4. **Track progress** in a tiny YAML state file to avoid duplicates
5. **Hand off to Greptor** for background processing (cleaning, chunking, tagging)

After the initial fetch, you'll have a structure like:

```
~/stocks/
  .claude/
    skills/
      search-youtube-telegram-twitter/
        SKILL.md
  content/
    raw/
      youtube/
        JosephCarlsonShow/
          2025-12/
            2025-12-15-NVIDIA-Earnings-Analysis.md
        BenFelixCSI/
          2025-12/
            2025-12-20-Index-Investing-vs-Active-Management.md
    processed/
      youtube/
        JosephCarlsonShow/
          2025-12/
            2025-12-15-NVIDIA-Earnings-Analysis.md
  config.yaml
```

## Searching Your Content

Once TrustMeBro has fetched and Greptor has indexed your content, you can search it using ripgrep:

### Basic Searches

```bash
# Find all mentions of a specific ticker
rg -n -C 6 "ticker=NVDA" content/processed/

# Search for bullish sentiment
rg -n -C 6 "sentiment=bullish" content/processed/

# Case-insensitive full-text search
rg -i -n -C 3 "federal reserve" content/processed/

# Search within YouTube content only
rg -n -C 6 "sector=technology" content/processed/youtube/
```

### Time-Based Searches

```bash
# Content from December 2025
rg -n -C 6 "ticker=TSLA" content/processed/ --glob "**/2025-12/*.md"

# This month's bullish calls
rg -n -C 6 "sentiment=bullish" content/processed/ --glob "**/$(date +%Y-%m)/*.md"

# Specific YouTuber's content
rg -n -C 6 "ticker=AAPL" content/processed/youtube/JosephCarlsonShow/
```

### Multi-Tag Filters

```bash
# Tech stocks with bullish sentiment
rg -l "sector=technology" content/processed/ | xargs rg -n -C 6 "sentiment=bullish"

# Strong buy recommendations for dividend stocks
rg -l "investment_style=dividend" content/processed/ | xargs rg -n -C 6 "recommendation=strong_buy"

# AI narrative with specific tickers
rg -n -C 6 "narrative=.*ai" content/processed/ | rg "ticker=NVDA\|ticker=.*,NVDA"
```

### Discovery & Analysis

```bash
# List all tickers mentioned
rg -o "ticker=[^\n]+" content/processed/ | cut -d= -f2 | tr ',' '\n' | sort -u

# Count sentiment distribution
rg -o "sentiment=[^\n]+" content/processed/ | cut -d= -f2 | sort | uniq -c | sort -rn

# Top 20 most discussed companies
rg -o "company=[^\n]+" content/processed/ | cut -d= -f2 | tr ',' '\n' | sort | uniq -c | sort -rn | head -20

# Track narrative evolution over time
for month in 2025-{10..12}; do
  echo "=== $month ==="
  rg -o "narrative=[^\n]+" content/processed/ --glob "**/$month/*.md" | cut -d= -f2 | tr ',' '\n' | sort | uniq -c | sort -rn | head -5
done
```

## Agent Integration

The real power comes when you let AI agents search your indexed content:

### Claude Code Skill (Auto-Generated)

TrustMeBro automatically generates a Claude Code skill with search instructions based on your config and tag schema. The skill is saved under:

### Example Agent Queries

Once set up, you can ask Claude (or any agent with ripgrep access):

> "What's the sentiment on NVIDIA in the last month?"

> "Find all strong buy recommendations from December 2025"

> "Compare sentiment on Tesla across YouTube vs Twitter"

> "What narratives are trending in tech stocks this quarter?"

> "Show me dividend stock discussions with hold or sell recommendations"

The agent will use ripgrep to search your indexed content and synthesize insights from multiple platforms/feeds.

## Use Cases

### Investment Research

Track YouTube finance channels, Reddit investing communities, and Twitter analysts to:
- Monitor sentiment on stocks in your portfolio
- Discover emerging narratives before they go mainstream
- Track analyst recommendations over time
- Research specific tickers or sectors

### Crypto Analysis

Follow crypto influencers, Telegram channels, and Twitter accounts to:
- Gauge market sentiment on coins/tokens
- Identify trending projects and narratives
- Monitor regulatory news and community reactions
- Analyze technical discussions and developer updates

## License

MIT © Sergii Vashchyshchuk
