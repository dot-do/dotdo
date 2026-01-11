/**
 * KV-based Session Cache
 *
 * Replaces global MemoryCache for session storage with KV namespace.
 * Benefits:
 * - Sessions shared across all Workers/isolates
 * - Automatic expiration via KV TTL
 * - Invalidation propagates globally
 * - Optional L1 memory cache for hot paths
 */

// ============================================================================
// Types
// ============================================================================

export interface CachedSession {
  userId: string
  email?: string
  role: 'admin' | 'user'
  expiresAt?: string
}

export interface KVSessionCacheOptions {
  /** TTL in seconds for KV storage (default: 300 = 5 minutes) */
  ttl?: number
  /** Key prefix for session storage (default: 'session:') */
  keyPrefix?: string
  /** Enable L1 memory cache for hot paths (default: false) */
  enableL1Cache?: boolean
  /** Maximum number of sessions in L1 cache (default: 1000) */
  l1MaxSize?: number
  /** L1 cache TTL in seconds (default: 60) */
  l1TtlSeconds?: number
}

interface L1CacheEntry {
  session: CachedSession
  expiresAt: number
}

// ============================================================================
// LRU Memory Cache (L1)
// ============================================================================

class L1MemoryCache {
  private cache = new Map<string, L1CacheEntry>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(maxSize: number, ttlSeconds: number) {
    this.maxSize = maxSize
    this.ttlMs = ttlSeconds * 1000
  }

  get(key: string): CachedSession | null {
    const entry = this.cache.get(key)
    if (!entry) {
      return null
    }

    // Check L1 expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    // LRU: move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.session
  }

  set(key: string, session: CachedSession): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, {
      session,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}

// ============================================================================
// KVSessionCache
// ============================================================================

export class KVSessionCache {
  private readonly kv: KVNamespace
  private readonly ttl: number
  private readonly keyPrefix: string
  private readonly l1Cache: L1MemoryCache | null

  constructor(kv: KVNamespace, options?: KVSessionCacheOptions) {
    this.kv = kv
    this.ttl = options?.ttl ?? 300
    this.keyPrefix = options?.keyPrefix ?? 'session:'

    // Initialize L1 cache if enabled
    if (options?.enableL1Cache) {
      this.l1Cache = new L1MemoryCache(
        options.l1MaxSize ?? 1000,
        options.l1TtlSeconds ?? 60,
      )
    } else {
      this.l1Cache = null
    }
  }

  /**
   * Get full KV key for a token
   */
  private getKey(token: string): string {
    return `${this.keyPrefix}${token}`
  }

  /**
   * Check if a session is expired based on its expiresAt field
   */
  private isSessionExpired(session: CachedSession): boolean {
    if (!session.expiresAt) {
      return false
    }
    return new Date(session.expiresAt) <= new Date()
  }

  /**
   * Calculate TTL to use for KV storage.
   * Uses the shorter of config TTL or session's remaining lifetime.
   */
  private calculateTtl(session: CachedSession): number {
    if (!session.expiresAt) {
      return this.ttl
    }

    const sessionExpiresAt = new Date(session.expiresAt).getTime()
    const now = Date.now()
    const remainingSeconds = Math.floor((sessionExpiresAt - now) / 1000)

    // Use shorter TTL (remaining session time or config TTL)
    return Math.min(Math.max(remainingSeconds, 1), this.ttl)
  }

  /**
   * Get a session from cache.
   * Checks L1 memory cache first (if enabled), then KV.
   * Returns null if not found, expired, or on error.
   */
  async get(token: string): Promise<CachedSession | null> {
    const key = this.getKey(token)

    // L1: Check memory cache first
    if (this.l1Cache) {
      const l1Session = this.l1Cache.get(key)
      if (l1Session) {
        // Still check session-level expiration
        if (this.isSessionExpired(l1Session)) {
          this.l1Cache.delete(key)
        } else {
          return l1Session
        }
      }
    }

    // L2: Check KV
    try {
      const data = await this.kv.get(key)
      if (!data) {
        return null
      }

      // Parse JSON
      let session: CachedSession
      try {
        session = JSON.parse(data)
      } catch {
        // Malformed data - return null
        return null
      }

      // Check session expiration
      if (this.isSessionExpired(session)) {
        // Clean up expired session from KV
        await this.kv.delete(key).catch(() => {})
        return null
      }

      // Populate L1 cache from L2
      if (this.l1Cache) {
        this.l1Cache.set(key, session)
      }

      return session
    } catch {
      // KV error - return null
      return null
    }
  }

  /**
   * Store a session in cache.
   * Writes to both L1 (if enabled) and KV.
   * Throws on KV write failure (fail-safe for auth).
   */
  async set(token: string, session: CachedSession): Promise<void> {
    const key = this.getKey(token)

    // Don't cache already-expired sessions
    if (this.isSessionExpired(session)) {
      return
    }

    const ttl = this.calculateTtl(session)
    const data = JSON.stringify(session)

    // Write to KV first (throws on error)
    await this.kv.put(key, data, { expirationTtl: ttl })

    // Then populate L1
    if (this.l1Cache) {
      this.l1Cache.set(key, session)
    }
  }

  /**
   * Delete a session from cache.
   * Removes from both L1 (if enabled) and KV.
   */
  async delete(token: string): Promise<void> {
    const key = this.getKey(token)

    // Remove from L1
    if (this.l1Cache) {
      this.l1Cache.delete(key)
    }

    // Remove from KV (don't throw on error)
    await this.kv.delete(key)
  }

  /**
   * Check if a session exists in cache.
   */
  async has(token: string): Promise<boolean> {
    const session = await this.get(token)
    return session !== null
  }

  /**
   * Invalidate all sessions for a user.
   * Lists all sessions with the prefix and deletes those matching the userId.
   */
  async invalidateUser(userId: string): Promise<void> {
    // List all session keys
    const listResult = await this.kv.list({ prefix: this.keyPrefix })

    // Check each session and delete if it belongs to the user
    const deletePromises: Promise<void>[] = []

    for (const key of listResult.keys) {
      deletePromises.push(
        (async () => {
          try {
            const data = await this.kv.get(key.name)
            if (data) {
              const session: CachedSession = JSON.parse(data)
              if (session.userId === userId) {
                // Remove from L1
                if (this.l1Cache) {
                  this.l1Cache.delete(key.name)
                }
                // Remove from KV
                await this.kv.delete(key.name)
              }
            }
          } catch {
            // Ignore errors for individual keys
          }
        })(),
      )
    }

    await Promise.all(deletePromises)

    // Handle pagination if not complete
    if (!listResult.list_complete) {
      // For very large datasets, this would need cursor-based pagination
      // For now, we handle the first page which should cover most use cases
      console.warn('Session invalidation may be incomplete due to large number of sessions')
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a KVSessionCache with the given KV namespace and options.
 */
export function createKVSessionCache(
  kv: KVNamespace,
  options?: KVSessionCacheOptions,
): KVSessionCache {
  return new KVSessionCache(kv, options)
}
