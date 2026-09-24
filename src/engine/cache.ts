// Provider Execution Engine — Intelligent TTL Cache
// - Never caches failed responses
// - Auto-expires on TTL
// - Per-provider and global stats

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
  providerId: string;
  cacheKey: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  expirations: number;
}

class EngineCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, entries: 0, expirations: 0 };

  /**
   * Store a successful response. Failed/null data is silently rejected.
   */
  set<T>(cacheKey: string, data: T, ttlMs: number, providerId: string): void {
    if (data === null || data === undefined) return; // never cache failures
    this.store.set(cacheKey, {
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      providerId,
      cacheKey,
    });
    this.stats.entries = this.store.size;
  }

  /**
   * Retrieve a cached entry if still valid. Returns null on miss or expiry.
   */
  get<T>(cacheKey: string): T | null {
    const entry = this.store.get(cacheKey) as CacheEntry<T> | undefined;
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(cacheKey);
      this.stats.expirations++;
      this.stats.misses++;
      this.stats.entries = this.store.size;
      return null;
    }
    this.stats.hits++;
    return entry.data;
  }

  /** Invalidate a single key */
  invalidate(cacheKey: string): void {
    this.store.delete(cacheKey);
    this.stats.entries = this.store.size;
  }

  /** Invalidate all keys belonging to a provider */
  invalidateProvider(providerId: string): void {
    for (const [k, v] of this.store.entries()) {
      if ((v as CacheEntry<unknown>).providerId === providerId) {
        this.store.delete(k);
      }
    }
    this.stats.entries = this.store.size;
  }

  /** Purge all expired entries (can be called periodically) */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [k, v] of this.store.entries()) {
      if (now > (v as CacheEntry<unknown>).expiresAt) {
        this.store.delete(k);
        purged++;
      }
    }
    this.stats.entries = this.store.size;
    this.stats.expirations += purged;
    return purged;
  }

  /** Clear everything */
  clear(): void {
    this.store.clear();
    this.stats.entries = 0;
  }

  /** Read-only stats snapshot */
  getStats(): Readonly<CacheStats> {
    return { ...this.stats };
  }

  /** List all valid (non-expired) cache keys with metadata */
  listEntries(): Array<{ key: string; providerId: string; createdAt: number; expiresAt: number; remainingMs: number }> {
    const now = Date.now();
    return Array.from(this.store.entries())
      .filter(([, v]) => now <= (v as CacheEntry<unknown>).expiresAt)
      .map(([, v]) => {
        const e = v as CacheEntry<unknown>;
        return { key: e.cacheKey, providerId: e.providerId, createdAt: e.createdAt, expiresAt: e.expiresAt, remainingMs: e.expiresAt - now };
      });
  }
}

// Singleton — shared across the entire engine
export const engineCache = new EngineCache();

/** Convenience: build a deterministic cache key */
export function buildCacheKey(providerId: string, checkerType: string, params: Record<string, unknown> = {}): string {
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${k}=${String(params[k])}`)
    .join('&');
  return `${providerId}:${checkerType}:${sorted}`;
}
