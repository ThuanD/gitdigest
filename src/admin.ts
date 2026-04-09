import type { AllCacheStats, Env } from "./types";
import { json } from "./http";
import { trendingCache, repoCache } from "./github";
import { summaryCache, askCache, wordcloudCache } from "./handlers";

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getCacheStats(): AllCacheStats {
  return {
    listIdCaches: trendingCache.stats(),
    summaryCache: summaryCache.stats(),
    repoCache: repoCache.stats(),
    wordcloudCache: wordcloudCache.stats(),
    askCache: askCache.stats(),
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

const cacheMap: Record<Exclude<CacheType, "all">, { clear(): void }> = {
  trendingCache,
  summaryCache,
  repoCache,
  wordcloudCache,
  askCache,
};

function clearCache(type: CacheType): { success: boolean; message: string } {
  if (type === "all") {
    Object.values(cacheMap).forEach((c) => c.clear());
    return { success: true, message: "All caches cleared" };
  }
  const cache = cacheMap[type];
  if (!cache) return { success: false, message: `Unknown cache type: ${type}` };
  cache.clear();
  return { success: true, message: `${type} cleared` };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function handleAdminStats(request: Request): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "Method not allowed" }, 405);
  return json(getCacheStats());
}

export async function handleAdminClear(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  try {
    const body = (await request.json().catch(() => ({}))) as {
      type?: CacheType;
    };
    return json(clearCache(body.type ?? "all"));
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
}
