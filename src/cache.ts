import type { CacheEntry, CacheMetrics } from "./types";

/**
 * Simple LRU-eviction Map-backed cache with a configurable max-size.
 * When the cache is full, the oldest inserted entry is evicted (insertion order).
 * Kept for backward compatibility / pure-L1 scenarios.
 */
export class LRUCache<V> {
  private readonly store = new Map<string, V>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const value = this.store.get(key);
    if (value !== undefined) {
      this.hits++;
      this.store.delete(key);
      this.store.set(key, value);
    } else {
      this.misses++;
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.store.size;
  }

  stats(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) : "0",
      maxEntries: this.maxSize,
    };
  }

  resetCounters(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * TTL-aware cache backed by LRUCache.
 * Each entry is wrapped with a timestamp; expired entries are treated as misses.
 */
export class TTLCache<V> {
  private readonly inner: LRUCache<CacheEntry<V>>;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.inner = new LRUCache(maxSize);
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.inner.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.time > this.ttlMs) {
      this.inner.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, value: V): void {
    this.inner.set(key, { data: value, time: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.inner.clear();
  }

  get size(): number {
    return this.inner.size;
  }

  stats(): CacheMetrics {
    return { ...this.inner.stats(), ttl: this.ttlMs };
  }

  resetCounters(): void {
    this.inner.resetCounters();
  }
}

/**
 * Hybrid L1 (in-memory Map) + L2 (Cloudflare KV) cache.
 *
 * - L1: fast, isolate-local, LRU-evicted, optional TTL
 * - L2: shared cross-isolate, survives eviction/redeploy, optional `expirationTtl`
 *
 * get flow: L1 hit → return. L1 miss → await KV → populate L1 → return.
 * set flow: write L1 synchronously, fire-and-forget KV write via `ctx.waitUntil`
 *           when a context is provided; otherwise awaits the KV write.
 * clear: clears L1 immediately; KV keys under this cache's prefix are
 *           paginated and deleted (deferred via `ctx.waitUntil` when available).
 */
export class HybridCache<V> {
  private readonly l1: Map<string, CacheEntry<V>> = new Map();
  private readonly kv: KVNamespace | undefined;
  private readonly prefix: string;
  private readonly maxL1: number;
  private readonly ttlMs: number | undefined;
  private readonly ttlSeconds: number | undefined;
  private l1Hits = 0;
  private l2Hits = 0;
  private misses = 0;

  constructor(opts: {
    prefix: string;
    maxL1: number;
    ttlMs?: number;
    kv?: KVNamespace;
  }) {
    this.prefix = opts.prefix;
    this.maxL1 = opts.maxL1;
    this.kv = opts.kv;
    this.ttlMs = opts.ttlMs;
    // KV expirationTtl must be >= 60s
    this.ttlSeconds = opts.ttlMs
      ? Math.max(60, Math.floor(opts.ttlMs / 1000))
      : undefined;
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private evictIfNeeded() {
    if (this.l1.size <= this.maxL1) return;
    const oldest = this.l1.keys().next().value;
    if (oldest !== undefined) this.l1.delete(oldest);
  }

  private setL1(key: string, value: V) {
    this.l1.delete(key);
    this.l1.set(key, { data: value, time: Date.now() });
    this.evictIfNeeded();
  }

  async get(key: string): Promise<V | undefined> {
    // L1
    const entry = this.l1.get(key);
    if (entry) {
      if (this.ttlMs && Date.now() - entry.time > this.ttlMs) {
        this.l1.delete(key);
      } else {
        // Refresh LRU order
        this.l1.delete(key);
        this.l1.set(key, entry);
        this.l1Hits++;
        return entry.data;
      }
    }

    // L2
    if (this.kv) {
      try {
        const raw = await this.kv.get(this.fullKey(key), { type: "json" });
        if (raw !== null) {
          this.l2Hits++;
          this.setL1(key, raw as V);
          return raw as V;
        }
      } catch (err) {
        console.error(`KV get failed for ${this.fullKey(key)}:`, err);
      }
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store into L1 immediately; write to KV (L2).
   * Pass `ctx` to offload the KV write via `waitUntil` (non-blocking).
   */
  async set(key: string, value: V, ctx?: ExecutionContext): Promise<void> {
    this.setL1(key, value);
    if (!this.kv) return;
    const put = this.kv.put(
      this.fullKey(key),
      JSON.stringify(value),
      this.ttlSeconds ? { expirationTtl: this.ttlSeconds } : undefined,
    );
    if (ctx) ctx.waitUntil(put);
    else await put;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    if (this.kv) {
      try {
        await this.kv.delete(this.fullKey(key));
      } catch (err) {
        console.error(`KV delete failed for ${this.fullKey(key)}:`, err);
      }
    }
  }

  /**
   * Clear L1 immediately. KV keys matching this cache's prefix are deleted
   * (paginated). When a context is provided the KV scan is deferred.
   */
  clear(ctx?: ExecutionContext): void {
    this.l1.clear();
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.misses = 0;
    if (!this.kv) return;
    const task = this.clearKV();
    if (ctx) ctx.waitUntil(task);
    else void task;
  }

  private async clearKV(): Promise<void> {
    const kv = this.kv;
    if (!kv) return;
    let cursor: string | null = null;
    while (true) {
      const listResult: KVNamespaceListResult<unknown, string> = await kv.list({
        prefix: `${this.prefix}:`,
        ...(cursor ? { cursor } : {}),
      });
      await Promise.all(listResult.keys.map((k) => kv.delete(k.name)));
      if (listResult.list_complete) break;
      cursor = listResult.cursor;
    }
  }

  get size(): number {
    return this.l1.size;
  }

  stats(): CacheMetrics {
    const total = this.l1Hits + this.l2Hits + this.misses;
    return {
      size: this.l1.size,
      hits: this.l1Hits + this.l2Hits,
      misses: this.misses,
      hitRate: total > 0
        ? (((this.l1Hits + this.l2Hits) / total) * 100).toFixed(1)
        : "0",
      maxEntries: this.maxL1,
      ...(this.ttlMs ? { ttl: this.ttlMs } : {}),
    };
  }

  resetCounters(): void {
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.misses = 0;
  }
}
