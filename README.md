# GitDigest

A modern web application that lists trending GitHub repositories and generates AI-powered summaries with multilingual support. Built with TypeScript, modular JavaScript, and enterprise-grade security features.

**🚀 Live Demo:** https://gitdigest.td-rootx.workers.dev/

![gitdigest preview](preview.png)

## Features

- 📊 **Trending Repositories**: Daily, weekly, and monthly GitHub trending repos
- 🤖 **AI Summaries**: Powered by OpenAI, Groq, OpenRouter, or Gemini
- 🌍 **Multilingual**: English and Vietnamese support with automatic translation
- 🔍 **Interactive Q&A**: Ask questions about repositories with AI assistance
- ☁️ **Word Cloud**: Visual technology trend analysis
- 🛡️ **Enterprise Security**: Rate limiting, input validation, and abuse prevention
- 📱 **Responsive Design**: Modern UI with TailwindCSS

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
- `GET /admin/stats` — Cache statistics and system health
- `POST /admin/clear` — Clear specific or all caches

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

## Licence

This project is licensed under the MIT License — see [LICENCE.md](LICENCE.md).

---

**Built with ❤️ by [thuandz](https://github.com/thuandz)**

**Deployed on Cloudflare Workers:** https://gitdigest.td-rootx.workers.dev/
