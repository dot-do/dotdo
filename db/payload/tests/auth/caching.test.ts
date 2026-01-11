/**
 * Session Caching Tests (RED Phase)
 *
 * These tests define the contract for session caching with two-level cache:
 * - L1: In-memory cache (fast, per-instance)
 * - L2: KV cache (shared across instances)
 *
 * The caching strategy should:
 * - Check L1 memory cache first for fastest response
 * - Fall back to L2 KV cache on L1 miss
 * - Query database only on L2 miss
 * - Populate both caches on database hit
 * - Support cache invalidation on security events
 * - Handle cache errors gracefully (fallback to DB)
 *
 * Reference: dotdo-6osy - B08 RED: Session caching tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { BetterAuthUser, SessionData, SessionValidationResult } from '../../auth/types'

// ============================================================================
// Type definitions for the caching module (to be implemented)
// ============================================================================

/**
 * L1 memory cache interface for session data.
 * Uses LRU eviction when max size is reached.
 */
interface L1MemoryCache {
  /**
   * Get a cached session by token.
   */
  get(token: string): CachedSession | undefined

  /**
   * Set a session in the cache.
   */
  set(token: string, session: CachedSession): void

  /**
   * Delete a session from the cache.
   */
  delete(token: string): void

  /**
   * Clear all cached sessions.
   */
  clear(): void

  /**
   * Get the current size of the cache.
   */
  size(): number
}

/**
 * L2 KV cache interface for session data.
 * Uses Cloudflare Workers KV for persistence.
 */
interface L2KVCache {
  /**
   * Get a cached session by token.
   */
  get(token: string): Promise<CachedSession | null>

  /**
   * Set a session in the cache with TTL.
   */
  set(token: string, session: CachedSession, ttlSeconds: number): Promise<void>

  /**
   * Delete a session from the cache.
   */
  delete(token: string): Promise<void>
}

/**
 * Cached session data including user and expiry metadata.
 */
interface CachedSession {
  user: BetterAuthUser
  session: SessionData
  /** Timestamp when this cache entry was created */
  cachedAt: number
  /** Timestamp when this cache entry expires */
  expiresAt: number
}

/**
 * Configuration options for the session cache.
 */
interface SessionCacheConfig {
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
interface SessionDatabase {
  /**
   * Query session by token with joined user data.
   */
  getSessionByToken(token: string): Promise<SessionWithUser | null>
}

/**
 * Session record joined with user data from database.
 */
interface SessionWithUser {
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
type CacheInvalidationEvent =
  | { type: 'logout'; sessionToken: string }
  | { type: 'password_change'; userId: string }
  | { type: 'role_change'; userId: string }
  | { type: 'ban'; userId: string }

/**
 * Broadcast interface for cross-instance cache invalidation.
 */
interface CacheInvalidationBroadcast {
  /**
   * Publish an invalidation event to all instances.
   */
  publish(event: CacheInvalidationEvent): Promise<void>

  /**
   * Subscribe to invalidation events.
   */
  subscribe(handler: (event: CacheInvalidationEvent) => void): () => void
}

// ============================================================================
// Placeholder imports (to be implemented)
// ============================================================================

// These will fail until the implementation is created
import {
  createL1Cache,
  createCachedSessionValidator,
  CachedSessionValidator,
} from '../../auth/caching'

// ============================================================================
// Mock helpers
// ============================================================================

function createMockL2Cache(): L2KVCache & {
  store: Map<string, { data: CachedSession; expiresAt: number }>
} {
  const store = new Map<string, { data: CachedSession; expiresAt: number }>()

  return {
    store,
    get: vi.fn(async (token: string) => {
      const entry = store.get(token)
      if (!entry) return null
      if (Date.now() > entry.expiresAt) {
        store.delete(token)
        return null
      }
      return entry.data
    }),
    set: vi.fn(async (token: string, session: CachedSession, ttlSeconds: number) => {
      store.set(token, {
        data: session,
        expiresAt: Date.now() + ttlSeconds * 1000,
      })
    }),
    delete: vi.fn(async (token: string) => {
      store.delete(token)
    }),
  }
}

function createMockDb(data: { sessions?: SessionWithUser[] } = {}): SessionDatabase & {
  getSessionByToken: ReturnType<typeof vi.fn>
} {
  const sessions = data.sessions ?? []

  return {
    getSessionByToken: vi.fn(async (token: string) => {
      return sessions.find((s) => s.session.token === token) ?? null
    }),
  }
}

function createMockBroadcast(): CacheInvalidationBroadcast & {
  events: CacheInvalidationEvent[]
  handlers: Set<(event: CacheInvalidationEvent) => void>
} {
  const events: CacheInvalidationEvent[] = []
  const handlers = new Set<(event: CacheInvalidationEvent) => void>()

  return {
    events,
    handlers,
    publish: vi.fn(async (event: CacheInvalidationEvent) => {
      events.push(event)
      handlers.forEach((handler) => handler(event))
    }),
    subscribe: vi.fn((handler: (event: CacheInvalidationEvent) => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    }),
  }
}

function createValidSession(
  overrides: Partial<SessionWithUser['session']> = {},
): SessionWithUser['session'] {
  const now = new Date()
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days from now

  return {
    id: 'session-001',
    token: 'valid-token-abc123',
    userId: 'user-001',
    expiresAt: future,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    activeOrganizationId: null,
    activeTeamId: null,
    impersonatedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createValidUser(overrides: Partial<SessionWithUser['user']> = {}): SessionWithUser['user'] {
  const now = new Date()

  return {
    id: 'user-001',
    name: 'Alice Smith',
    email: 'alice@example.com.ai',
    emailVerified: true,
    image: null,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createSessionWithUser(
  sessionOverrides: Partial<SessionWithUser['session']> = {},
  userOverrides: Partial<SessionWithUser['user']> = {},
): SessionWithUser {
  return {
    session: createValidSession(sessionOverrides),
    user: createValidUser(userOverrides),
  }
}

function createCachedSessionData(
  sessionOverrides: Partial<SessionWithUser['session']> = {},
  userOverrides: Partial<SessionWithUser['user']> = {},
): CachedSession {
  const sessionWithUser = createSessionWithUser(sessionOverrides, userOverrides)
  const now = Date.now()

  return {
    user: {
      id: sessionWithUser.user.id,
      name: sessionWithUser.user.name,
      email: sessionWithUser.user.email,
      emailVerified: sessionWithUser.user.emailVerified,
      image: sessionWithUser.user.image,
      role: sessionWithUser.user.role,
      banned: sessionWithUser.user.banned ?? false,
      banReason: sessionWithUser.user.banReason,
      createdAt: sessionWithUser.user.createdAt,
      updatedAt: sessionWithUser.user.updatedAt,
    },
    session: {
      id: sessionWithUser.session.id,
      token: sessionWithUser.session.token,
      expiresAt: sessionWithUser.session.expiresAt,
      userId: sessionWithUser.session.userId,
    },
    cachedAt: now,
    expiresAt: now + 60000, // 1 minute default TTL
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Session Caching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('L1 Memory Cache', () => {
    it('should cache validated session in memory', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
      const cachedSession = createCachedSessionData()

      l1Cache.set('valid-token-abc123', cachedSession)

      const retrieved = l1Cache.get('valid-token-abc123')
      expect(retrieved).toBeDefined()
      expect(retrieved?.user.id).toBe('user-001')
      expect(retrieved?.session.token).toBe('valid-token-abc123')
    })

    it('should return cached session without DB query', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      // Pre-populate L1 cache
      const cachedSession = createCachedSessionData()
      l1Cache.set('valid-token-abc123', cachedSession)

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
      })

      const result = await validator.validate('valid-token-abc123')

      expect(result.valid).toBe(true)
      // DB should NOT have been called since L1 had the data
      expect(db.getSessionByToken).not.toHaveBeenCalled()
    })

    it('should expire cache after TTL', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 }) // 1 minute TTL
      const cachedSession = createCachedSessionData()

      l1Cache.set('valid-token-abc123', cachedSession)

      // Advance time past TTL
      vi.advanceTimersByTime(61000) // 61 seconds

      const retrieved = l1Cache.get('valid-token-abc123')
      expect(retrieved).toBeUndefined()
    })

    it('should invalidate cache on session update', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
      const cachedSession = createCachedSessionData()

      l1Cache.set('valid-token-abc123', cachedSession)
      expect(l1Cache.get('valid-token-abc123')).toBeDefined()

      // Invalidate the cache entry
      l1Cache.delete('valid-token-abc123')

      expect(l1Cache.get('valid-token-abc123')).toBeUndefined()
    })

    it('should have configurable max size', async () => {
      const l1Cache = createL1Cache({ maxSize: 3, ttlMs: 60000 })

      // Fill cache to capacity
      l1Cache.set('token-1', createCachedSessionData({ token: 'token-1' }))
      l1Cache.set('token-2', createCachedSessionData({ token: 'token-2' }))
      l1Cache.set('token-3', createCachedSessionData({ token: 'token-3' }))

      expect(l1Cache.size()).toBe(3)
    })

    it('should evict LRU entries when full', async () => {
      const l1Cache = createL1Cache({ maxSize: 2, ttlMs: 60000 })

      // Add two entries
      l1Cache.set('token-1', createCachedSessionData({ token: 'token-1' }))
      vi.advanceTimersByTime(100)
      l1Cache.set('token-2', createCachedSessionData({ token: 'token-2' }))

      // Access token-1 to make it recently used
      vi.advanceTimersByTime(100)
      l1Cache.get('token-1')

      // Add a third entry, should evict token-2 (LRU)
      vi.advanceTimersByTime(100)
      l1Cache.set('token-3', createCachedSessionData({ token: 'token-3' }))

      expect(l1Cache.size()).toBe(2)
      expect(l1Cache.get('token-1')).toBeDefined() // Still there (was accessed)
      expect(l1Cache.get('token-2')).toBeUndefined() // Evicted (LRU)
      expect(l1Cache.get('token-3')).toBeDefined() // Newly added
    })
  })

  describe('L2 KV Cache', () => {
    it('should cache session in KV on L1 miss', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
        config: { l2TtlSeconds: 300 },
      })

      // L1 is empty, so should query DB and cache in L2
      await validator.validate('valid-token-abc123')

      expect(db.getSessionByToken).toHaveBeenCalledWith('valid-token-abc123')
      expect(l2Cache.set).toHaveBeenCalledWith(
        'valid-token-abc123',
        expect.objectContaining({
          user: expect.objectContaining({ id: 'user-001' }),
          session: expect.objectContaining({ token: 'valid-token-abc123' }),
        }),
        300,
      )
    })

    it('should return from KV without DB on L1 miss', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      // Pre-populate L2 cache
      const cachedSession = createCachedSessionData()
      await l2Cache.set('valid-token-abc123', cachedSession, 300)

      // Clear the mock call counts
      vi.mocked(l2Cache.get).mockClear()
      vi.mocked(db.getSessionByToken).mockClear()

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
      })

      const result = await validator.validate('valid-token-abc123')

      expect(result.valid).toBe(true)
      expect(l2Cache.get).toHaveBeenCalledWith('valid-token-abc123')
      expect(db.getSessionByToken).not.toHaveBeenCalled()
    })

    it('should populate L1 from KV hit', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      // Pre-populate L2 cache only
      const cachedSession = createCachedSessionData()
      await l2Cache.set('valid-token-abc123', cachedSession, 300)

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
      })

      // First call - L1 miss, L2 hit
      await validator.validate('valid-token-abc123')

      // L1 should now have the entry
      const l1Entry = l1Cache.get('valid-token-abc123')
      expect(l1Entry).toBeDefined()
      expect(l1Entry?.user.id).toBe('user-001')
    })

    it('should set TTL on KV entries', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
        config: { l2TtlSeconds: 600 }, // 10 minutes
      })

      await validator.validate('valid-token-abc123')

      expect(l2Cache.set).toHaveBeenCalledWith(
        'valid-token-abc123',
        expect.any(Object),
        600, // TTL should match config
      )
    })

    it('should handle KV errors gracefully', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      const failingL2Cache: L2KVCache = {
        get: vi.fn(async () => {
          throw new Error('KV unavailable')
        }),
        set: vi.fn(async () => {
          throw new Error('KV unavailable')
        }),
        delete: vi.fn(async () => {
          throw new Error('KV unavailable')
        }),
      }

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache: failingL2Cache,
      })

      // Should still work by falling back to DB
      const result = await validator.validate('valid-token-abc123')

      expect(result.valid).toBe(true)
      expect(db.getSessionByToken).toHaveBeenCalled()
    })
  })

  describe('cache invalidation', () => {
    it('should invalidate on logout', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
      const l2Cache = createMockL2Cache()
      const broadcast = createMockBroadcast()

      // Pre-populate caches
      const cachedSession = createCachedSessionData()
      l1Cache.set('valid-token-abc123', cachedSession)
      await l2Cache.set('valid-token-abc123', cachedSession, 300)

      const validator = createCachedSessionValidator({
        db: createMockDb(),
        l1Cache,
        l2Cache,
        broadcast,
      })

      await validator.invalidate({ type: 'logout', sessionToken: 'valid-token-abc123' })

      expect(l1Cache.get('valid-token-abc123')).toBeUndefined()
      expect(l2Cache.delete).toHaveBeenCalledWith('valid-token-abc123')
    })

    it('should invalidate on password change', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
      const l2Cache = createMockL2Cache()

      // Pre-populate caches with sessions for user-001
      const cachedSession1 = createCachedSessionData({ token: 'token-1', userId: 'user-001' })
      const cachedSession2 = createCachedSessionData({ token: 'token-2', userId: 'user-001' })
      l1Cache.set('token-1', cachedSession1)
      l1Cache.set('token-2', cachedSession2)
      await l2Cache.set('token-1', cachedSession1, 300)
      await l2Cache.set('token-2', cachedSession2, 300)

      const validator = createCachedSessionValidator({
        db: createMockDb(),
        l1Cache,
        l2Cache,
      })

      await validator.invalidate({ type: 'password_change', userId: 'user-001' })

      // All sessions for this user should be invalidated
      expect(l1Cache.get('token-1')).toBeUndefined()
      expect(l1Cache.get('token-2')).toBeUndefined()
    })

    it('should invalidate on role change', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
      const l2Cache = createMockL2Cache()

      // Pre-populate cache
      const cachedSession = createCachedSessionData({ token: 'token-1', userId: 'user-001' })
      l1Cache.set('token-1', cachedSession)
      await l2Cache.set('token-1', cachedSession, 300)

      const validator = createCachedSessionValidator({
        db: createMockDb(),
        l1Cache,
        l2Cache,
      })

      await validator.invalidate({ type: 'role_change', userId: 'user-001' })

      // Session should be invalidated so user gets fresh role on next request
      expect(l1Cache.get('token-1')).toBeUndefined()
    })

    it('should broadcast invalidation across instances', async () => {
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })
      const l2Cache = createMockL2Cache()
      const broadcast = createMockBroadcast()

      const validator = createCachedSessionValidator({
        db: createMockDb(),
        l1Cache,
        l2Cache,
        broadcast,
      })

      await validator.invalidate({ type: 'logout', sessionToken: 'valid-token-abc123' })

      expect(broadcast.publish).toHaveBeenCalledWith({
        type: 'logout',
        sessionToken: 'valid-token-abc123',
      })
    })
  })

  describe('CachedSessionValidator', () => {
    it('should try L1 -> L2 -> DB in order', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
      })

      // First request - all caches empty, should hit DB
      await validator.validate('valid-token-abc123')

      expect(db.getSessionByToken).toHaveBeenCalledTimes(1)
      expect(l2Cache.get).toHaveBeenCalledTimes(1)

      // Reset mocks
      vi.mocked(db.getSessionByToken).mockClear()
      vi.mocked(l2Cache.get).mockClear()

      // Second request - should hit L1, no L2 or DB
      await validator.validate('valid-token-abc123')

      expect(db.getSessionByToken).not.toHaveBeenCalled()
      expect(l2Cache.get).not.toHaveBeenCalled()
    })

    it('should update caches on DB hit', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
        config: { l2TtlSeconds: 300 },
      })

      // Validate - should hit DB and populate caches
      await validator.validate('valid-token-abc123')

      // L1 should be populated
      const l1Entry = l1Cache.get('valid-token-abc123')
      expect(l1Entry).toBeDefined()
      expect(l1Entry?.user.id).toBe('user-001')

      // L2 should be populated
      expect(l2Cache.set).toHaveBeenCalledWith(
        'valid-token-abc123',
        expect.objectContaining({
          user: expect.objectContaining({ id: 'user-001' }),
        }),
        300,
      )
    })

    it('should skip caching for invalid sessions', async () => {
      const db = createMockDb({ sessions: [] }) // No sessions
      const l2Cache = createMockL2Cache()
      const l1Cache = createL1Cache({ maxSize: 100, ttlMs: 60000 })

      const validator = createCachedSessionValidator({
        db,
        l1Cache,
        l2Cache,
      })

      const result = await validator.validate('invalid-token')

      expect(result.valid).toBe(false)
      // Should not cache invalid sessions
      expect(l1Cache.get('invalid-token')).toBeUndefined()
      expect(l2Cache.set).not.toHaveBeenCalled()
    })
  })
})
