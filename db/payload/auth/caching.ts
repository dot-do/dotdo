/**
 * Session Caching Module
 *
 * Provides two-level session caching:
 * - L1: In-memory LRU cache (fast, per-instance)
 * - L2: KV cache (shared across instances)
 *
 * The caching strategy:
 * - Check L1 memory cache first for fastest response
 * - Fall back to L2 KV cache on L1 miss
 * - Query database only on L2 miss
 * - Populate both caches on database hit
 * - Support cache invalidation on security events
 * - Handle cache errors gracefully (fallback to DB)
 *
 * @module @dotdo/payload/auth/caching
 */

import type { SessionValidationResult, BetterAuthUser, SessionData } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Cached session data including user and expiry metadata.
 */
export interface CachedSession {
  user: BetterAuthUser
  session: SessionData
  /** Timestamp when this cache entry was created */
  cachedAt: number
  /** Timestamp when this cache entry expires */
  expiresAt: number
}

/**
 * L1 memory cache interface for session data.
 */
export interface L1MemoryCache {
  get(token: string): CachedSession | undefined
  set(token: string, session: CachedSession): void
  delete(token: string): void
  clear(): void
  size(): number
  /** Internal: iterate over all entries for invalidation purposes */
  entries?(): IterableIterator<[string, CachedSession]>
}

/**
 * L2 KV cache interface for session data.
 */
export interface L2KVCache {
  get(token: string): Promise<CachedSession | null>
  set(token: string, session: CachedSession, ttlSeconds: number): Promise<void>
  delete(token: string): Promise<void>
}

/**
 * Configuration options for the L1 cache.
 */
export interface L1CacheConfig {
  /** Maximum entries in the cache */
  maxSize: number
  /** TTL in milliseconds */
  ttlMs: number
}

/**
 * Configuration options for the session cache.
 */
export interface SessionCacheConfig {
  /** L1 cache TTL in milliseconds (default: 60000 = 1 minute) */
  l1TtlMs?: number
  /** L2 cache TTL in seconds (default: 300 = 5 minutes) */
  l2TtlSeconds?: number
  /** Maximum entries in L1 cache (default: 1000) */
  l1MaxSize?: number
}

/**
 * Database interface for session validation queries.
 */
export interface SessionDatabase {
  getSessionByToken(token: string): Promise<SessionWithUser | null>
}

/**
 * Session record joined with user data from database.
 */
export interface SessionWithUser {
  session: {
    id: string
    token: string
    userId: string
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
    activeOrganizationId: string | null
    activeTeamId: string | null
    impersonatedBy: string | null
    createdAt: Date
    updatedAt: Date
  }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    role: 'user' | 'admin' | 'owner' | null
    banned: boolean | null
    banReason: string | null
    banExpires: Date | null
    createdAt: Date
    updatedAt: Date
  }
}

/**
 * Cache invalidation event types.
 */
export type CacheInvalidationEvent =
  | { type: 'logout'; sessionToken: string }
  | { type: 'password_change'; userId: string }
  | { type: 'role_change'; userId: string }
  | { type: 'ban'; userId: string }

/**
 * Broadcast interface for cross-instance cache invalidation.
 */
export interface CacheInvalidationBroadcast {
  publish(event: CacheInvalidationEvent): Promise<void>
  subscribe(handler: (event: CacheInvalidationEvent) => void): () => void
}

/**
 * Options for creating a cached session validator.
 */
export interface CachedSessionValidatorOptions {
  db: SessionDatabase
  l1Cache: L1MemoryCache
  l2Cache: L2KVCache
  config?: SessionCacheConfig
  broadcast?: CacheInvalidationBroadcast
}

/**
 * Cached session validator interface.
 */
export interface CachedSessionValidator {
  validate(token: string): Promise<SessionValidationResult>
  invalidate(event: CacheInvalidationEvent): Promise<void>
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_L1_TTL_MS = 60000 // 1 minute
const DEFAULT_L2_TTL_SECONDS = 300 // 5 minutes
const DEFAULT_L1_MAX_SIZE = 1000

// ============================================================================
// L1 Memory Cache Implementation
// ============================================================================

/**
 * Internal cache entry with access tracking for LRU eviction.
 */
interface L1CacheEntry {
  data: CachedSession
  lastAccess: number
}

/**
 * Creates an L1 memory cache with LRU eviction.
 *
 * @param config - Cache configuration (maxSize, ttlMs)
 * @returns L1MemoryCache instance
 *
 * @example
 * ```typescript
 * const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
 * l1Cache.set('token', cachedSession)
 * const cached = l1Cache.get('token')
 * ```
 */
export function createL1Cache(config: L1CacheConfig): L1MemoryCache {
  const { maxSize, ttlMs } = config
  const cache = new Map<string, L1CacheEntry>()

  return {
    get(token: string): CachedSession | undefined {
      const entry = cache.get(token)
      if (!entry) {
        return undefined
      }

      const now = Date.now()

      // Check if cache entry has expired based on configured TTL
      if (now - entry.data.cachedAt >= ttlMs) {
        cache.delete(token)
        return undefined
      }

      // Check if the cached session itself has expired
      if (now >= entry.data.expiresAt) {
        cache.delete(token)
        return undefined
      }

      // Update last access time for LRU tracking
      entry.lastAccess = now

      return entry.data
    },

    set(token: string, session: CachedSession): void {
      const now = Date.now()

      // Evict LRU entries if at capacity
      if (cache.size >= maxSize && !cache.has(token)) {
        // Find and remove the least recently used entry
        let lruKey: string | null = null
        let lruTime = Infinity

        for (const [key, entry] of cache) {
          if (entry.lastAccess < lruTime) {
            lruTime = entry.lastAccess
            lruKey = key
          }
        }

        if (lruKey) {
          cache.delete(lruKey)
        }
      }

      cache.set(token, {
        data: session,
        lastAccess: now,
      })
    },

    delete(token: string): void {
      cache.delete(token)
    },

    clear(): void {
      cache.clear()
    },

    size(): number {
      return cache.size
    },

    *entries(): IterableIterator<[string, CachedSession]> {
      for (const [key, entry] of cache) {
        yield [key, entry.data]
      }
    },
  }
}

// ============================================================================
// Cached Session Validator Implementation
// ============================================================================

/**
 * Creates a cached session validator with two-level caching.
 *
 * Cache lookup order:
 * 1. L1 memory cache (fastest, per-instance)
 * 2. L2 KV cache (shared across instances)
 * 3. Database (slowest, source of truth)
 *
 * On successful validation, both caches are populated.
 * Invalid sessions are not cached.
 *
 * @param options - Validator options including db, caches, and config
 * @returns CachedSessionValidator instance
 *
 * @example
 * ```typescript
 * const validator = createCachedSessionValidator({
 *   db,
 *   l1Cache: createL1Cache({ maxSize: 100, ttlMs: 60000 }),
 *   l2Cache: kvCacheAdapter,
 *   config: { l2TtlSeconds: 300 }
 * })
 *
 * const result = await validator.validate(sessionToken)
 * if (result.valid) {
 *   console.log('User:', result.user.email)
 * }
 * ```
 */
export function createCachedSessionValidator(
  options: CachedSessionValidatorOptions,
): CachedSessionValidator {
  const { db, l1Cache, l2Cache, config = {}, broadcast } = options

  const l1TtlMs = config.l1TtlMs ?? DEFAULT_L1_TTL_MS
  const l2TtlSeconds = config.l2TtlSeconds ?? DEFAULT_L2_TTL_SECONDS

  // Track tokens by userId for user-level invalidation
  const tokensByUser = new Map<string, Set<string>>()

  /**
   * Track a token for a user (for invalidation purposes).
   */
  function trackToken(userId: string, token: string): void {
    let tokens = tokensByUser.get(userId)
    if (!tokens) {
      tokens = new Set()
      tokensByUser.set(userId, tokens)
    }
    tokens.add(token)
  }

  /**
   * Get all tracked tokens for a user.
   */
  function getTokensForUser(userId: string): string[] {
    const tokens = tokensByUser.get(userId)
    return tokens ? Array.from(tokens) : []
  }

  /**
   * Remove a token from tracking.
   */
  function untrackToken(userId: string, token: string): void {
    const tokens = tokensByUser.get(userId)
    if (tokens) {
      tokens.delete(token)
      if (tokens.size === 0) {
        tokensByUser.delete(userId)
      }
    }
  }

  /**
   * Validate a session token.
   */
  async function validate(token: string): Promise<SessionValidationResult> {
    // Check L1 cache first
    const l1Entry = l1Cache.get(token)
    if (l1Entry) {
      return {
        valid: true,
        user: l1Entry.user,
        session: l1Entry.session,
      }
    }

    // Check L2 cache
    try {
      const l2Entry = await l2Cache.get(token)
      if (l2Entry && Date.now() < l2Entry.expiresAt) {
        // Populate L1 from L2 hit
        l1Cache.set(token, l2Entry)
        trackToken(l2Entry.user.id, token)
        return {
          valid: true,
          user: l2Entry.user,
          session: l2Entry.session,
        }
      }
    } catch {
      // L2 error, continue to DB
    }

    // Query database
    try {
      const sessionWithUser = await db.getSessionByToken(token)

      if (!sessionWithUser) {
        return { valid: false, error: 'session_not_found' }
      }

      const { session, user } = sessionWithUser
      const now = new Date()

      // Check if session is expired
      if (now >= session.expiresAt) {
        return { valid: false, error: 'session_expired' }
      }

      // Check if user is banned
      if (user.banned) {
        if (user.banExpires && now >= user.banExpires) {
          // Ban has expired
        } else {
          return { valid: false, error: 'user_banned' }
        }
      }

      // Build result types
      const betterAuthUser: BetterAuthUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        image: user.image,
        banned: user.banned ?? false,
        banReason: user.banReason,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }

      const sessionData: SessionData = {
        id: session.id,
        token: session.token,
        expiresAt: session.expiresAt,
        userId: session.userId,
      }

      // Create cache entry
      const cachedSession: CachedSession = {
        user: betterAuthUser,
        session: sessionData,
        cachedAt: Date.now(),
        expiresAt: Date.now() + l1TtlMs,
      }

      // Populate L1 cache
      l1Cache.set(token, cachedSession)
      trackToken(user.id, token)

      // Populate L2 cache (fire and forget, don't block on errors)
      l2Cache.set(token, cachedSession, l2TtlSeconds).catch(() => {
        // Ignore L2 cache errors
      })

      return {
        valid: true,
        user: betterAuthUser,
        session: sessionData,
      }
    } catch {
      return { valid: false, error: 'database_error' }
    }
  }

  /**
   * Invalidate cached sessions based on an event.
   */
  async function invalidate(event: CacheInvalidationEvent): Promise<void> {
    // Broadcast to other instances if available
    if (broadcast) {
      await broadcast.publish(event).catch(() => {
        // Ignore broadcast errors
      })
    }

    switch (event.type) {
      case 'logout': {
        // Invalidate specific session
        const token = event.sessionToken
        const l1Entry = l1Cache.get(token)
        if (l1Entry) {
          untrackToken(l1Entry.user.id, token)
        }
        l1Cache.delete(token)
        await l2Cache.delete(token).catch(() => {})
        break
      }

      case 'password_change':
      case 'role_change':
      case 'ban': {
        // Invalidate all sessions for the user
        const userId = event.userId

        // Get tracked tokens
        const trackedTokens = getTokensForUser(userId)

        // Also scan the cache for any tokens that weren't tracked
        // (e.g., if they were added directly to the cache)
        const tokensToInvalidate = new Set(trackedTokens)

        if (l1Cache.entries) {
          for (const [token, session] of l1Cache.entries()) {
            if (session.user.id === userId) {
              tokensToInvalidate.add(token)
            }
          }
        }

        for (const token of tokensToInvalidate) {
          l1Cache.delete(token)
          await l2Cache.delete(token).catch(() => {})
        }

        tokensByUser.delete(userId)
        break
      }
    }
  }

  return {
    validate,
    invalidate,
  }
}
