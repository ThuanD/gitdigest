# GitHub Trending Digest

A small web app that lists trending GitHub repositories and generates AI summaries (with optional translation) using AI APIs. The UI lives in `public/`; **Cloudflare Workers** (`worker.js`) serves those assets and implements `/api/*` via Wrangler — see [`wrangler.jsonc`](wrangler.jsonc).

![github-trending preview](preview.png)

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (for Wrangler)
- An API key — either [OpenAI](https://platform.openai.com/) (starts with `sk-`), [Groq](https://console.groq.com/) (starts with `gsk_`), or [Gemini](https://makersuite.google.com/app/apikey) (starts with `AIza...`) — stored in the app settings (sent as `Authorization: Bearer …`) and/or as a Worker secret

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
   OPENAI_API_KEY=sk-...  # or gsk_... for Groq, or AIza... for Gemini
   ```

4. Run locally (Worker + static assets):

   ```bash
   npm run dev
   ```

   Wrangler prints the local URL (often `http://localhost:8787`).

5. (Optional) Set a default API key on the deployed Worker so visitors can summarize without pasting a key:

   ```bash
   npx wrangler secret put OPENAI_API_KEY
   # Use OpenAI (sk-...), Groq (gsk_...), or Gemini (AIza...) key
   ```

6. Deploy:

   ```bash
   npm run deploy
   ```

## API

Routes are implemented in `worker.js`:

- `GET /api/repos?page=1&period=daily&lang=javascript` — Paginated trending repositories from GitHub API (cached ~15 minutes in memory). Period: daily/weekly/monthly.
- `GET /api/repo?id=<repoId>` — Fetches repository details and README content.
- `GET /api/summarize?id=<repoId>&lang=<iso>` — Generates a cached AI summary of the repository; `lang` defaults to `en`. Send `Authorization: Bearer <API key>` (OpenAI `sk-...`, Groq `gsk_...`, or Gemini `AIza...`) and/or set the `OPENAI_API_KEY` secret / `.dev.vars`.

## Licence

This project is licensed under the MIT License — see [LICENCE.md](LICENCE.md).
