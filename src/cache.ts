import type { CacheEntry, CacheMetrics } from "./types";

/**
 * Simple LRU-eviction Map-backed cache with a configurable max-size.
 * When the cache is full, the oldest inserted entry is evicted (insertion order).
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
      // Re-insert to refresh insertion order (poor-man's LRU)
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

  stats(label?: string): CacheMetrics {
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
