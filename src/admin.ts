import type { AllCacheStats, Env } from "./types";
import { json } from "./http";
import { getCaches } from "./caches";

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getCacheStats(env: Env): AllCacheStats {
  const c = getCaches(env);
  return {
    listIdCaches: c.trending.stats(),
    summaryCache: c.summary.stats(),
    repoCache: c.repo.stats(),
    wordcloudCache: c.wordcloud.stats(),
    askCache: c.ask.stats(),
  };
}

// ─── Clear ────────────────────────────────────────────────────────────────────

type CacheType =
  | "trendingCache"
  | "summaryCache"
  | "repoCache"
  | "wordcloudCache"
  | "askCache"
  | "all";

function clearCache(
  env: Env,
  ctx: ExecutionContext | undefined,
  type: CacheType,
): { success: boolean; message: string } {
  const c = getCaches(env);
  const map: Record<Exclude<CacheType, "all">, { clear(ctx?: ExecutionContext): void }> = {
    trendingCache: c.trending,
    summaryCache: c.summary,
    repoCache: c.repo,
    wordcloudCache: c.wordcloud,
    askCache: c.ask,
  };
  if (type === "all") {
    Object.values(map).forEach((cache) => cache.clear(ctx));
    return { success: true, message: "All caches cleared" };
  }
  const cache = map[type];
  if (!cache) return { success: false, message: `Unknown cache type: ${type}` };
  cache.clear(ctx);
  return { success: true, message: `${type} cleared` };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function handleAdminStats(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "Method not allowed" }, 405);
  return json(getCacheStats(env));
}

export async function handleAdminClear(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  try {
    const body = (await request.json().catch(() => ({}))) as {
      type?: CacheType;
    };
    return json(clearCache(env, ctx, body.type ?? "all"));
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
}
