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

**TrustMeBro + Greptor solve this by:**
- **Automated fetching**: Pull content from your tracked sources on a schedule
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

### Create a Config File

Create a YAML config file (e.g., `stocks.yaml`) defining what to fetch:

```yaml
server:
  port: 3000

db:
  fileName: "stocks.sqlite"

outputFolder: "~/ai/stocks/"
startDate: 2025-12-01

topic: "Stock market, investing, and financial markets"

# Sources to track
sources:
  youtube:
    concurrency: 1
    channels:
      - "@everythingmoney"
      - "@JosephCarlsonShow"
      - "@BenFelixCSI"
      - "@AswathDamodaranonValuation"

  telegram:
    channels: []
    # Example:
    # - "cryptoinsights"

  twitter:
    accounts: []
    # Example:
    # - "elonmusk"

# Tag schema for Greptor indexing
tags:
  ticker:
    type: string[]
    description: "Stock tickers, UPPERCASE (e.g. AAPL, TSLA)"

  company:
    type: string[]
    description: "Company names in snake_case (e.g. apple, tesla)"

  sector:
    type: enum[]
    description: "GICS sector classification"
    values:
      - technology
      - healthcare
      - financials
      - consumer_discretionary
      - energy
      # ... add more sectors

  sentiment:
    type: enum[]
    description: "Market sentiment"
    values:
      - bullish
      - bearish
      - neutral

  recommendation:
    type: enum[]
    description: "Investment recommendation"
    values:
      - strong_buy
      - buy
      - hold
      - sell
      - strong_sell
```

### Run the Fetcher

```bash
# Fetch content from all configured sources
trustmebro fetch --config stocks.yaml

# Fetch from specific source only
trustmebro fetch --config stocks.yaml --source youtube

# Fetch and watch for new content (continuous mode)
trustmebro watch --config stocks.yaml

# One-time fetch for a specific channel
trustmebro fetch-channel --source youtube --id @JosephCarlsonShow --config stocks.yaml
```

### What Happens Next

TrustMeBro will:

1. **Connect to sources** using the channels/accounts in your config
2. **Fetch content** since `startDate` (or from last sync)
3. **Write to output folder** in Greptor-compatible format
4. **Track progress** in SQLite database to avoid duplicates
5. **Hand off to Greptor** for background processing (cleaning, chunking, tagging)

After the initial fetch, you'll have a structure like:

```
~/ai/stocks/
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
```

## Using with Greptor

TrustMeBro and Greptor are designed to work together:

```typescript
import { createGreptor } from 'greptor';
import { openai } from "@ai-sdk/openai";

// Initialize Greptor with your output folder
const greptor = await createGreptor({
  baseDir: '~/ai/stocks',
  topic: 'Stock market, investing, and financial markets',
  model: openai("gpt-4o-mini"),
});

// TrustMeBro feeds documents to Greptor
// This happens automatically after fetching
await greptor.eat({
  id: 'dQw4w9WgXcQ',
  source: 'youtube',
  publisher: '@JosephCarlsonShow',
  format: 'text',
  label: 'NVIDIA Q4 Earnings: AI Boom Continues',
  content: videoTranscript,
  creationDate: new Date('2025-12-15'),
  tags: {
    channelTitle: 'Joseph Carlson',
    duration: 1245,
    views: 45000
  },
});

// Generate Claude Code skill for your sources
await greptor.createSkill(['youtube', 'telegram', 'twitter']);
```

## Searching Your Content

Once TrustMeBro has fetched and Greptor has indexed your content, you can search it using ripgrep:

### Basic Searches

```bash
# Find all mentions of a specific ticker
rg -n -C 6 "ticker=NVDA" ~/ai/stocks/content/processed/

# Search for bullish sentiment
rg -n -C 6 "sentiment=bullish" ~/ai/stocks/content/processed/

# Case-insensitive full-text search
rg -i -n -C 3 "federal reserve" ~/ai/stocks/content/processed/

# Search within YouTube content only
rg -n -C 6 "sector=technology" ~/ai/stocks/content/processed/youtube/
```

### Time-Based Searches

```bash
# Content from December 2025
rg -n -C 6 "ticker=TSLA" ~/ai/stocks/content/processed/ --glob "**/2025-12/*.md"

# This month's bullish calls
rg -n -C 6 "sentiment=bullish" ~/ai/stocks/content/processed/ --glob "**/$(date +%Y-%m)/*.md"

# Specific YouTuber's content
rg -n -C 6 "ticker=AAPL" ~/ai/stocks/content/processed/youtube/JosephCarlsonShow/
```

### Multi-Tag Filters

```bash
# Tech stocks with bullish sentiment
rg -l "sector=technology" ~/ai/stocks/content/processed/ | xargs rg -n -C 6 "sentiment=bullish"

# Strong buy recommendations for dividend stocks
rg -l "investment_style=dividend" ~/ai/stocks/content/processed/ | xargs rg -n -C 6 "recommendation=strong_buy"

# AI narrative with specific tickers
rg -n -C 6 "narrative=.*ai" ~/ai/stocks/content/processed/ | rg "ticker=NVDA\|ticker=.*,NVDA"
```

### Discovery & Analysis

```bash
# List all tickers mentioned
rg -o "ticker=[^\n]+" ~/ai/stocks/content/processed/ | cut -d= -f2 | tr ',' '\n' | sort -u

# Count sentiment distribution
rg -o "sentiment=[^\n]+" ~/ai/stocks/content/processed/ | cut -d= -f2 | sort | uniq -c | sort -rn

# Top 20 most discussed companies
rg -o "company=[^\n]+" ~/ai/stocks/content/processed/ | cut -d= -f2 | tr ',' '\n' | sort | uniq -c | sort -rn | head -20

# Track narrative evolution over time
for month in 2025-{10..12}; do
  echo "=== $month ==="
  rg -o "narrative=[^\n]+" ~/ai/stocks/content/processed/ --glob "**/$month/*.md" | cut -d= -f2 | tr ',' '\n' | sort | uniq -c | sort -rn | head -5
done
```

## Agent Integration

The real power comes when you let AI agents search your indexed content:

### Claude Code Skill (Auto-Generated)

TrustMeBro + Greptor automatically generate a Claude Code skill with search instructions:

```markdown
# Search YouTube-Telegram-Twitter Skill

Use this skill when researching stocks, market sentiment, or investment insights.

## Available Sources
- YouTube: Financial channels (@JosephCarlsonShow, @BenFelixCSI, etc.)
- Telegram: Investment communities
- Twitter: Market commentators and analysts

## Search Patterns

### By Ticker
rg -n -C 6 "ticker=AAPL" content/processed/

### By Sentiment
rg -n -C 6 "sentiment=bullish" content/processed/

### By Recommendation
rg -n -C 6 "recommendation=strong_buy" content/processed/

### Combined Filters
rg -l "ticker=TSLA" content/processed/ | xargs rg -n -C 6 "sentiment=bearish"
```

### Example Agent Queries

Once set up, you can ask Claude (or any agent with ripgrep access):

> "What's the sentiment on NVIDIA in the last month?"

> "Find all strong buy recommendations from December 2025"

> "Compare sentiment on Tesla across YouTube vs Twitter"

> "What narratives are trending in tech stocks this quarter?"

> "Show me dividend stock discussions with hold or sell recommendations"

The agent will use ripgrep to search your indexed content and synthesize insights from multiple sources.

## Configuration Reference

### Server Settings

```yaml
server:
  port: 3000              # HTTP server port for webhooks/API
```

### Database

```yaml
db:
  fileName: "stocks.sqlite"   # SQLite database for tracking fetch progress
```

### Output

```yaml
outputFolder: "~/ai/stocks/"  # Where to write fetched content
startDate: 2025-12-01         # Fetch content from this date onward
```

### Sources

#### YouTube

```yaml
sources:
  youtube:
    concurrency: 1      # Number of parallel fetch workers
    channels:
      - "@channelhandle"
```

Fetches video transcripts using YouTube API. Requires `YOUTUBE_API_KEY` environment variable.

#### Telegram

```yaml
sources:
  telegram:
    channels:
      - "channelname"   # Public channel username
```

Fetches messages from public Telegram channels. Requires `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.

#### Twitter

```yaml
sources:
  twitter:
    accounts:
      - "username"      # Twitter handle without @
```

Fetches tweets and threads. Requires `TWITTER_BEARER_TOKEN`.

### Tag Schema

Define your domain-specific tags for better indexing:

```yaml
tags:
  ticker:
    type: string[]
    description: "Stock tickers, UPPERCASE"

  sentiment:
    type: enum[]
    description: "Market sentiment"
    values:
      - bullish
      - bearish
      - neutral

  # Add more tags as needed
```

Tags are used by Greptor to structure chunks for grep-ability.

## Environment Variables

Create a `.env` file in your project root:

```bash
# YouTube Data API v3
YOUTUBE_API_KEY=your_key_here

# Telegram API (get from https://my.telegram.org)
TELEGRAM_API_ID=your_id
TELEGRAM_API_HASH=your_hash

# Twitter API v2
TWITTER_BEARER_TOKEN=your_token

# OpenAI for Greptor processing
OPENAI_API_KEY=your_key
```

## Use Cases

### Investment Research

Track YouTube finance channels, Reddit investing communities, and Twitter analysts to:
- Monitor sentiment on stocks in your portfolio
- Discover emerging narratives before they go mainstream
- Track analyst recommendations over time
- Research specific tickers or sectors

### Market Intelligence

Stay updated on:
- Macro trends from economics channels
- Sector rotations from market commentators
- Earnings reactions from the community
- Policy impacts from finance Twitter

### Portfolio Management

Combine with Yahoo Finance MCP and personal data:
- Get sentiment data for your holdings
- Research new investment ideas mentioned across sources
- Track narrative shifts that might affect your positions
- Automate monthly portfolio reviews with agent-generated reports

## Advanced Patterns

### Scheduled Fetching

Use cron to fetch new content regularly:

```bash
# Fetch every 6 hours
0 */6 * * * cd ~/git/trustmebro && ./trustmebro fetch --config ~/ai/stocks.yaml
```

### Multi-Topic Setup

Organize multiple research areas:

```
~/ai/
  stocks/
    config: stocks.yaml
  crypto/
    config: crypto.yaml
  tech/
    config: tech.yaml
```

Each with its own config, sources, and tag schema.

### Custom Processing Pipeline

Hook into the fetch → index workflow:

```typescript
// custom-pipeline.ts
import { fetchYouTube } from 'trustmebro';
import { createGreptor } from 'greptor';

const content = await fetchYouTube('@JosephCarlsonShow', { since: '2025-12-01' });

// Custom pre-processing
const cleaned = removeAds(content);

// Feed to Greptor
await greptor.eat(cleaned);
```

## Roadmap

- [ ] Reddit support (via API)
- [ ] Discord channel fetching
- [ ] Newsletter/blog RSS feeds
- [ ] Podcast transcript fetching (Spotify, Apple Podcasts)
- [ ] Web scraping for articles
- [ ] Real-time streaming mode (WebSockets)
- [ ] Custom fetcher plugins
- [ ] Cloud deployment templates (Docker, Railway, Fly.io)

## FAQ

**Q: How much does it cost to run?**

Fetching is free (just API limits). LLM processing costs depend on volume:
- ~$0.01-0.05 per YouTube video (using GPT-4o-mini)
- ~$0.001-0.01 per tweet/post
- Estimate ~$10-30/month for moderate usage (50-100 videos, 1000 posts)

**Q: Can I use this without Greptor?**

Yes! TrustMeBro writes raw Markdown files immediately, which you can search/read without Greptor. But Greptor adds:
- LLM-powered cleaning and structuring
- Semantic chunking for better context
- Tag extraction for precise filtering
- Claude Code skill generation

**Q: What if I don't have API keys?**

Some sources work without keys:
- YouTube: Transcript download (no key needed, but rate-limited)
- Reddit: Public scraping (no key, but fragile)

For production use, official APIs are recommended.

**Q: How do I handle API rate limits?**

TrustMeBro tracks fetch progress in SQLite and resumes where it left off. If you hit rate limits:
- Reduce `concurrency` in config
- Add delays between requests
- Spread fetches across multiple API keys (advanced)

**Q: Is this legal?**

You're responsible for complying with each platform's Terms of Service:
- YouTube: ✅ Transcripts are public data
- Twitter: ✅ Public tweets (respect rate limits)
- Telegram: ✅ Public channels

Don't scrape private content or violate platform policies.

## Contributing

Contributions welcome! Areas of interest:
- New source integrations (Reddit, Discord, etc.)
- Better error handling and retry logic
- Performance optimizations
- Documentation improvements

## License

MIT © Sergii Vashchyshchuk

---

**TrustMeBro**: Because your AI agent should trust the data you feed it, bro. 🤝
