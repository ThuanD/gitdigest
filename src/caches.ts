import type { Env, GitHubRepo, TrendingRepo, WordCloudData } from "./types";
import { HybridCache } from "./cache";

export interface Caches {
  trending: HybridCache<TrendingRepo[]>;
  repo: HybridCache<GitHubRepo>;
  summary: HybridCache<string>;
  ask: HybridCache<string>;
  wordcloud: HybridCache<WordCloudData>;
}

const LIST_TTL_MS = 30 * 60 * 1000; // 30 min
const WC_TTL_MS = 30 * 60 * 1000; // 30 min
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const ASK_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let instance: Caches | undefined;

/**
 * Returns a singleton set of hybrid caches bound to the current isolate's env.
 * The KV binding is optional — when absent, caches run L1-only (in-memory).
 */
export function getCaches(env: Env): Caches {
  if (instance) return instance;
  const kv = env.CACHE_KV;
  instance = {
    trending: new HybridCache<TrendingRepo[]>({
      prefix: "trending",
      maxL1: 50,
      ttlMs: LIST_TTL_MS,
      ...(kv && { kv }),
    }),
    repo: new HybridCache<GitHubRepo>({
      prefix: "repo",
      maxL1: 200,
      ttlMs: LIST_TTL_MS,
      ...(kv && { kv }),
    }),
    summary: new HybridCache<string>({
      prefix: "summary",
      maxL1: 500,
      ttlMs: SUMMARY_TTL_MS,
      ...(kv && { kv }),
    }),
    ask: new HybridCache<string>({
      prefix: "ask",
      maxL1: 1000,
      ttlMs: ASK_TTL_MS,
      ...(kv && { kv }),
    }),
    wordcloud: new HybridCache<WordCloudData>({
      prefix: "wc",
      maxL1: 100,
      ttlMs: WC_TTL_MS,
      ...(kv && { kv }),
    }),
  };
  return instance;
}

/**
 * Testing / admin helper to reset the singleton (e.g., after clearing).
 */
export function resetCachesSingleton(): void {
  instance = undefined;
}
