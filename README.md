# GitDigest

> Discover what's trending on GitHub with AI-powered summaries, a trend wordcloud, and a reading activity heatmap — all in one split-pane dashboard.

[![Live Demo](https://img.shields.io/badge/live-demo-22d3ee?style=flat-square)](https://gitdigest.td-rootx.workers.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-8b5cf6?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

**🚀 Live:** https://gitdigest.td-rootx.workers.dev/

![gitdigest preview](preview.png)

## Highlights

- **Split-pane dashboard** — browse a feed of trending repos on the left, AI summary / wordcloud / README on the right. Mobile-first responsive layout.
- **Multi-provider AI** — bring your own key for OpenAI, Groq, OpenRouter, or Gemini. No vendor lock-in.
- **Zero cold start** — deployed to the edge on Cloudflare Workers, cached per region.

## Features

- 📊 **Trending repositories** — daily / weekly / monthly, with language and topic filters
- 🤖 **AI summaries** — structured technical breakdowns (overview, stack, features, traction)
- ☁️ **Trend wordcloud** — visual technology trend analysis + category / insight panels
- 💬 **Chat with AI** — interactive Q&A per repository (grounded on the summary)
- ⭐ **Favorites & filters** — star repos, filter by favorites / unread, one-click clear all
- 📅 **Reading activity** — GitHub-style contribution heatmap that tracks what you've read
- 🌍 **Multilingual** — English & Vietnamese with automatic translation between cached entries
- 🎨 **Polished motion** — staggered card entrance, slide-in panels, water-flow toggles, subtle hover lifts
- 🧩 **Custom UI primitives** — dropdowns, compact filter toolbar, status pills, tooltip
- 🛡️ **Built-in security** — per-IP rate limiting, input validation, prompt-injection escaping
- 📱 **Responsive** — split-pane on desktop, stack-with-back on mobile

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (for Wrangler)
- API key from one of the supported providers:
  - **OpenAI** (starts with `sk-`)
  - **Groq** (starts with `gsk_`)
  - **OpenRouter** (starts with `sk-or-`)
  - **Gemini** (starts with `AIza...`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Log in to Cloudflare (once):

   ```bash
   npx wrangler login
   ```

3. (Optional) For local `npm run dev`, create `.dev.vars` in the project root (do not commit it):

   ```bash
   API_KEY=sk-...        # or gsk_... for Groq, sk-or-... for OpenRouter, or AIza... for Gemini
   GITHUB_TOKEN=ghp_...          # GitHub Personal Access Token
   
   # Optional: Custom AI models (defaults shown)
   OPENAI_MODEL=gpt-4o-mini
   GROQ_MODEL=llama-3.3-70b-versatile
   OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
   GEMINI_MODEL=gemini-2.0-flash-lite
   ```

   **Note**: `GITHUB_TOKEN` is **required** for production to avoid rate limits (60 requests/hour unauthenticated vs 5,000 requests/hour authenticated).

4. Run locally (Worker + static assets):

   ```bash
   npm run dev
   ```

   Wrangler prints the local URL (often `http://localhost:8787`).

5. Set up GitHub API token (required for production):

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   # Create a Personal Access Token at: https://github.com/settings/tokens
   # Scopes needed: public_repo (read-only access to public repositories)
   ```

6. (Optional) Set default API keys and models on the deployed Worker:

   ```bash
   # Default AI API key
   npx wrangler secret put API_KEY
   
   # Optional: Custom AI models
   npx wrangler secret put OPENAI_MODEL
   npx wrangler secret put GROQ_MODEL
   npx wrangler secret put OPENROUTER_MODEL
   npx wrangler secret put GEMINI_MODEL
   ```

7. Deploy:

   ```bash
   npm run deploy
   ```

## API

Routes are implemented in TypeScript (`src/handlers.ts`):

### Repository Endpoints
- `GET /api/repos?page=1&period=daily&lang=javascript` — Paginated trending repositories (cached 15 minutes)
- `GET /api/repo?id=<repoId>` — Repository details and README content
- `GET /api/summarize?id=<repoId>&lang=<iso>` — AI-powered repository summary
- `POST /api/ask` — Interactive Q&A about repositories
- `GET /api/wordcloud?period=daily&lang=en` — Technology trend word cloud

### Admin Endpoints
- `GET /api/admin/stats` — Cache statistics and system health
- `POST /api/admin/clear` — Clear specific or all caches (optional `{ type }` body to clear a single cache)

### Authentication
Send `Authorization: Bearer <API key>` header or set `API_KEY` secret.

### Rate Limiting
- **Summarize**: 5 requests/hour per IP
- **Ask**: 10 requests/hour per IP  
- **WordCloud**: 20 requests/hour per IP

## Architecture

- **Frontend**: Modular JavaScript with ES modules (`public/js/`)
- **Backend**: TypeScript with Cloudflare Workers (`src/`)
- **Caching**: LRU and TTL cache implementations
- **Security**: Input validation, rate limiting, and abuse prevention
- **AI**: Multi-provider support with configurable models

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | - | OpenAI API key |
| `GITHUB_TOKEN` | - | GitHub Personal Access Token |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter model |
| `GEMINI_MODEL` | `gemini-2.0-flash-lite` | Gemini model |
| `RATE_LIMIT_KV` | - | KV namespace for rate limiting |

### Cache Configuration

- **Trending Lists**: 30 minutes TTL, 50 entries
- **Summaries**: 500 entries max
- **Repository Details**: 200 entries max
- **Word Cloud**: 30 minutes TTL, 100 entries max
- **Ask Q&A**: 1000 entries max

## Security

- ✅ **Input Validation**: Type checking and sanitization
- ✅ **Rate Limiting**: IP-based with atomic operations
- ✅ **Prompt Injection**: Escaped user input
- ✅ **Cache Security**: Hash-based keys prevent collisions
- ✅ **Abuse Prevention**: Pattern filtering and validation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

---

**Built with ❤️ by [ThuanD](https://github.com/ThuanD)**

**Deployed on Cloudflare Workers:** https://gitdigest.td-rootx.workers.dev/
