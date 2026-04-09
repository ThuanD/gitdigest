// ─── Environment Bindings ────────────────────────────────────────────────────

export interface Env {
  OPENAI_API_KEY?: string;
  GITHUB_TOKEN?: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  RATE_LIMIT_KV?: KVNamespace;
}

// ─── Domain Models ───────────────────────────────────────────────────────────

export interface TrendingRepo {
  id: string;
  fullName: string;
  url: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  starsToday: number;
}

export interface GitHubRepo {
  id: string;
  fullName: string;
  htmlUrl: string;
  stars: number;
  owner: string;
  defaultBranch: string;
  createdAt: number;
  pushedAt: number;
  description: string | null;
  language: string | null;
  topics: string[];
  forks: number;
  readmeUrl: string;
}

export interface GitHubRepoWithReadme extends GitHubRepo {
  readmeContent: string;
  readmeHtml: string;
  rawApiResponse: GitHubRepo;
  isCached: boolean;
}

// ─── Word Cloud ──────────────────────────────────────────────────────────────

export type WordCategory = "language" | "framework" | "domain" | "concept";

export interface WordEntry {
  text: string;
  size: number;
  category: WordCategory;
  repos: number;
  weight: number;
}

export interface CategoryStats {
  count: number;
  totalWeight: number;
}

export interface WordCloudData {
  words: WordEntry[];
  categories: {
    languages: CategoryStats;
    frameworks: CategoryStats;
    domains: CategoryStats;
    concepts: CategoryStats;
  };
  insights: string[];
  trends: {
    emerging: string[];
    established: string[];
    rising: string[];
  };
}

// ─── AI Provider ─────────────────────────────────────────────────────────────

export type AIProvider = "openai" | "groq" | "openrouter" | "gemini";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  data: T;
  time: number;
}

export interface CacheMetrics {
  size: number;
  hits: number;
  misses: number;
  hitRate: string;
  maxEntries?: number;
  ttl?: number;
}

export interface AllCacheStats {
  listIdCaches: CacheMetrics;
  summaryCache: CacheMetrics;
  repoCache: CacheMetrics;
  wordcloudCache: CacheMetrics;
  askCache: CacheMetrics;
}

// ─── API Response Shapes ─────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  errorCode: string;
}

export type AIErrorCode =
  | "no_api_key"
  | "invalid_api_key"
  | "rate_limit"
  | "quota_exceeded"
  | "forbidden"
  | "ai_error";
