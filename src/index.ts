import type { Env } from "./types";
import { corsPreflightResponse, json } from "./http";
import {
  handleRepos,
  handleRepoDetails,
  handleSummarize,
  handleAsk,
  handleWordCloud,
} from "./handlers";
import { handleAdminStats, handleAdminClear } from "./admin";

// ─── Route Table ──────────────────────────────────────────────────────────────

type RouteHandler = (request: Request, url: URL, env: Env) => Promise<Response>;

const routes: Array<{
  path: string;
  methods?: string[];
  handler: RouteHandler;
}> = [
  { path: "/api/repos", handler: handleRepos },
  { path: "/api/repo", handler: handleRepoDetails },
  { path: "/api/summarize", handler: handleSummarize },
  { path: "/api/ask", methods: ["GET", "POST"], handler: handleAsk },
  { path: "/api/wordcloud", handler: handleWordCloud },
  {
    path: "/api/admin/stats",
    methods: ["GET"],
    handler: (req) => handleAdminStats(req),
  },
  {
    path: "/api/admin/clear",
    methods: ["POST"],
    handler: (req) => handleAdminClear(req),
  },
];

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") return corsPreflightResponse();

    const url = new URL(request.url);

    // Match API routes
    for (const route of routes) {
      if (url.pathname !== route.path) continue;
      if (route.methods && !route.methods.includes(request.method)) {
        return json({ error: "Method not allowed" }, 405);
      }
      try {
        return await route.handler(request, url, env);
      } catch (error) {
        console.error(`Unhandled error on ${url.pathname}:`, error);
        return json({ error: "Internal server error" }, 500);
      }
    }

    // Static assets fallback
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
