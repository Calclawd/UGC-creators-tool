/**
 * Simple in-memory cache with TTL support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T = unknown> {
  private entries: Map<string, CacheEntry<T>> = new Map();

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.entries.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, ttlMs: number = 60000) {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete specific key
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.entries.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Get or fetch
   */
  async getOrFetch<U = T>(
    key: string,
    fetcher: () => Promise<U>,
    ttlMs: number = 60000,
  ): Promise<U> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached as U;
    }

    const value = await fetcher();
    this.set(key, value as T, ttlMs);
    return value;
  }
}

export const createCache = <T = unknown>() => new Cache<T>();
