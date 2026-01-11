/**
 * Session Cache Isolation Tests (TDD RED Phase)
 *
 * Issue: dotdo-q9j38 - Session cache KV migration
 *
 * Problem: Global session cache in api/middleware/auth.ts:213 causes:
 * - Memory pressure in Workers
 * - Stale data between isolates (different Workers don't share memory)
 * - Cache invalidation doesn't propagate across isolates
 *
 * Solution: Replace global MemoryCache with KVSessionCache that:
 * - Stores sessions in KV (shared across all isolates)
 * - Handles expiration via KV TTL
 * - Propagates invalidation to all isolates
 *
 * These tests WILL FAIL because KVSessionCache doesn't exist yet.
 * This is the TDD RED phase.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// This import WILL FAIL - KVSessionCache doesn't exist yet
// This is intentional for TDD RED phase
import { KVSessionCache, type CachedSession } from '../../middleware/kv-session-cache'

// ============================================================================
// Types
// ============================================================================

/**
 * Mock KV namespace interface for testing
 */
interface MockKVNamespace {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

// ============================================================================
// Mock KV Factory
// ============================================================================

function createMockKV(): MockKVNamespace {
  const store = new Map<string, { value: string; expiration?: number }>()

  return {
    get: vi.fn(async (key: string, type?: string) => {
      const entry = store.get(key)
      if (!entry) return null

      // Check expiration
      if (entry.expiration && Date.now() > entry.expiration * 1000) {
        store.delete(key)
        return null
      }

      if (type === 'json') {
        return JSON.parse(entry.value)
      }
      return entry.value
    }),

    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      const expiration = options?.expirationTtl ? Math.floor(Date.now() / 1000) + options.expirationTtl : undefined

      store.set(key, { value, expiration })
    }),

    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),

    list: vi.fn(async (options?: { prefix?: string }) => {
      const keys: { name: string }[] = []
      for (const key of store.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          keys.push({ name: key })
        }
      }
      return { keys, list_complete: true }
    }),
  }
}

// ============================================================================
// Test Setup
// ============================================================================

describe('Session Cache Isolation', () => {
  let mockKV: MockKVNamespace

  beforeEach(() => {
    vi.clearAllMocks()
    mockKV = createMockKV()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Core Isolation Tests
  // ==========================================================================

  describe('Cross-Isolate Session Availability', () => {
    it('sessions stored in KV are available across isolates', async () => {
      // Simulate Isolate A storing a session
      const isolateA = new KVSessionCache(mockKV as unknown as KVNamespace)
      const session: CachedSession = {
        userId: 'user-123',
        email: 'user@example.com',
        role: 'user',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }

      await isolateA.set('token-abc', session)

      // Simulate Isolate B (new instance, simulating different Worker)
      // reading the same session from KV
      const isolateB = new KVSessionCache(mockKV as unknown as KVNamespace)
      const retrieved = await isolateB.get('token-abc')

      // Session should be available in Isolate B
      expect(retrieved).not.toBeNull()
      expect(retrieved?.userId).toBe('user-123')
      expect(retrieved?.email).toBe('user@example.com')
      expect(retrieved?.role).toBe('user')
    })

    it('session updates in one isolate are visible to other isolates', async () => {
      const isolateA = new KVSessionCache(mockKV as unknown as KVNamespace)
      const isolateB = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Isolate A stores initial session
      await isolateA.set('token-xyz', {
        userId: 'user-456',
        role: 'user',
      })

      // Verify Isolate B can read it
      let session = await isolateB.get('token-xyz')
      expect(session?.role).toBe('user')

      // Isolate A updates the session (e.g., role change)
      await isolateA.set('token-xyz', {
        userId: 'user-456',
        role: 'admin', // Role upgraded
      })

      // Isolate B should see the updated role
      session = await isolateB.get('token-xyz')
      expect(session?.role).toBe('admin')
    })

    it('new isolates can access sessions stored before they were created', async () => {
      // Store session before Isolate B exists
      const isolateA = new KVSessionCache(mockKV as unknown as KVNamespace)
      await isolateA.set('persistent-token', {
        userId: 'persistent-user',
        email: 'persistent@example.com',
        role: 'user',
      })

      // Simulate time passing, new Worker starts (fresh isolate)
      // In real Workers, this would be a completely new V8 isolate
      const isolateB = new KVSessionCache(mockKV as unknown as KVNamespace)

      const session = await isolateB.get('persistent-token')
      expect(session).not.toBeNull()
      expect(session?.userId).toBe('persistent-user')
    })
  })

  // ==========================================================================
  // Expiration Tests
  // ==========================================================================

  describe('Session Expiration', () => {
    it('expired sessions are not returned', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Store a session with past expiration
      const expiredSession: CachedSession = {
        userId: 'expired-user',
        role: 'user',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      }

      await cache.set('expired-token', expiredSession)

      // Should not return expired session
      const retrieved = await cache.get('expired-token')
      expect(retrieved).toBeNull()
    })

    it('sessions with future expiration are returned', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      const validSession: CachedSession = {
        userId: 'valid-user',
        role: 'user',
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      }

      await cache.set('valid-token', validSession)

      const retrieved = await cache.get('valid-token')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.userId).toBe('valid-user')
    })

    it('sessions without expiresAt are treated as valid', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Session with no expiration (e.g., remember-me sessions)
      const noExpirySession: CachedSession = {
        userId: 'no-expiry-user',
        role: 'admin',
        // No expiresAt
      }

      await cache.set('no-expiry-token', noExpirySession)

      const retrieved = await cache.get('no-expiry-token')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.userId).toBe('no-expiry-user')
    })

    it('KV TTL is set correctly for session storage', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace, { ttl: 600 })

      await cache.set('ttl-test-token', {
        userId: 'ttl-user',
        role: 'user',
      })

      // Verify KV put was called with correct TTL
      expect(mockKV.put).toHaveBeenCalledWith(
        expect.stringContaining('ttl-test-token'),
        expect.any(String),
        expect.objectContaining({ expirationTtl: 600 }),
      )
    })

    it('uses shorter TTL between config TTL and session expiration', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace, { ttl: 600 }) // 10 min default

      // Session expires in 2 minutes
      const shortExpirySession: CachedSession = {
        userId: 'short-expiry-user',
        role: 'user',
        expiresAt: new Date(Date.now() + 120000).toISOString(), // 2 minutes
      }

      await cache.set('short-expiry-token', shortExpirySession)

      // Should use ~120 seconds (session expiry), not 600 seconds (config TTL)
      expect(mockKV.put).toHaveBeenCalledWith(
        expect.stringContaining('short-expiry-token'),
        expect.any(String),
        expect.objectContaining({
          expirationTtl: expect.any(Number),
        }),
      )

      // Get the actual TTL used
      const putCall = mockKV.put.mock.calls[0]
      const ttlUsed = putCall[2]?.expirationTtl
      expect(ttlUsed).toBeLessThanOrEqual(130) // Allow some buffer for test execution time
    })
  })

  // ==========================================================================
  // Cache Invalidation Tests
  // ==========================================================================

  describe('Cache Invalidation Propagation', () => {
    it('cache invalidation propagates to all isolates', async () => {
      const isolateA = new KVSessionCache(mockKV as unknown as KVNamespace)
      const isolateB = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Store session in Isolate A
      await isolateA.set('invalidate-token', {
        userId: 'invalidate-user',
        role: 'user',
      })

      // Verify both isolates can access it
      expect(await isolateA.get('invalidate-token')).not.toBeNull()
      expect(await isolateB.get('invalidate-token')).not.toBeNull()

      // Invalidate from Isolate A (e.g., user logged out)
      await isolateA.delete('invalidate-token')

      // Isolate B should also see the session as gone
      const sessionInB = await isolateB.get('invalidate-token')
      expect(sessionInB).toBeNull()
    })

    it('bulk invalidation works across isolates', async () => {
      const isolateA = new KVSessionCache(mockKV as unknown as KVNamespace)
      const isolateB = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Store multiple sessions for same user
      await isolateA.set('user-session-1', { userId: 'bulk-user', role: 'user' })
      await isolateA.set('user-session-2', { userId: 'bulk-user', role: 'user' })
      await isolateA.set('user-session-3', { userId: 'bulk-user', role: 'user' })
      await isolateA.set('other-user-session', { userId: 'other-user', role: 'user' })

      // Invalidate all sessions for bulk-user (e.g., password change)
      await isolateA.invalidateUser('bulk-user')

      // All bulk-user sessions should be gone in Isolate B
      expect(await isolateB.get('user-session-1')).toBeNull()
      expect(await isolateB.get('user-session-2')).toBeNull()
      expect(await isolateB.get('user-session-3')).toBeNull()

      // Other user's session should remain
      expect(await isolateB.get('other-user-session')).not.toBeNull()
    })

    it('invalidation of non-existent session does not throw', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Should not throw when deleting non-existent session
      await expect(cache.delete('non-existent-token')).resolves.not.toThrow()
    })
  })

  // ==========================================================================
  // Cache Key Format Tests
  // ==========================================================================

  describe('Cache Key Format', () => {
    it('uses consistent key prefix for session storage', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      await cache.set('my-token', { userId: 'user', role: 'user' })

      // Should use 'session:' prefix
      expect(mockKV.put).toHaveBeenCalledWith(
        'session:my-token',
        expect.any(String),
        expect.any(Object),
      )
    })

    it('allows custom key prefix', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace, {
        keyPrefix: 'auth-session:',
      })

      await cache.set('custom-token', { userId: 'user', role: 'user' })

      expect(mockKV.put).toHaveBeenCalledWith(
        'auth-session:custom-token',
        expect.any(String),
        expect.any(Object),
      )
    })
  })

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('returns null when KV get fails', async () => {
      mockKV.get.mockRejectedValueOnce(new Error('KV unavailable'))

      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)
      const result = await cache.get('error-token')

      expect(result).toBeNull()
    })

    it('throws on set when KV is unavailable (fail-safe for auth)', async () => {
      mockKV.put.mockRejectedValueOnce(new Error('KV write failed'))

      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      // Set should throw so caller knows session wasn't cached
      await expect(
        cache.set('error-token', { userId: 'user', role: 'user' }),
      ).rejects.toThrow()
    })

    it('handles malformed cached data gracefully', async () => {
      // Simulate corrupted KV data
      mockKV.get.mockResolvedValueOnce('not-valid-json{{{')

      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)
      const result = await cache.get('corrupted-token')

      // Should return null, not throw
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Integration with Auth Middleware Tests
  // ==========================================================================

  describe('Integration Patterns', () => {
    it('can be used as sessionCache in auth middleware config', async () => {
      const kvCache = new KVSessionCache(mockKV as unknown as KVNamespace)

      // This simulates how it would be used in auth middleware
      // The KVSessionCache should be compatible with the existing
      // sessionCache interface used by authMiddleware

      // Store a session
      await kvCache.set('auth-token', {
        userId: 'auth-user',
        email: 'auth@example.com',
        role: 'user',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })

      // Retrieve it (as auth middleware would)
      const session = await kvCache.get('auth-token')

      expect(session).toMatchObject({
        userId: 'auth-user',
        email: 'auth@example.com',
        role: 'user',
      })
    })

    it('supports the has() method for cache hit checking', async () => {
      const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

      await cache.set('exists-token', { userId: 'user', role: 'user' })

      expect(await cache.has('exists-token')).toBe(true)
      expect(await cache.has('missing-token')).toBe(false)
    })
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createKVSessionCache factory', () => {
  let mockKV: MockKVNamespace

  beforeEach(() => {
    mockKV = createMockKV()
  })

  // This import WILL FAIL - function doesn't exist yet
  it('creates a KVSessionCache with default options', async () => {
    const { createKVSessionCache } = await import('../../middleware/kv-session-cache')

    const cache = createKVSessionCache(mockKV as unknown as KVNamespace)

    expect(cache).toBeInstanceOf(KVSessionCache)
  })

  it('creates a KVSessionCache with custom TTL', async () => {
    const { createKVSessionCache } = await import('../../middleware/kv-session-cache')

    const cache = createKVSessionCache(mockKV as unknown as KVNamespace, { ttl: 1800 })

    await cache.set('custom-ttl-token', { userId: 'user', role: 'user' })

    expect(mockKV.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ expirationTtl: 1800 }),
    )
  })
})

// ============================================================================
// Migration Helper Tests
// ============================================================================

describe('Migration from MemoryCache to KVSessionCache', () => {
  let mockKV: MockKVNamespace

  beforeEach(() => {
    mockKV = createMockKV()
  })

  it('KVSessionCache API is compatible with existing MemoryCache usage', async () => {
    // This ensures KVSessionCache can be a drop-in replacement
    const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

    // These are the methods used by auth.ts with MemoryCache
    // KVSessionCache should support all of them

    // set(key, value, ttl?)
    await cache.set('compat-token', { userId: 'user', role: 'user' })

    // get(key)
    const session = await cache.get('compat-token')
    expect(session).not.toBeNull()

    // delete(key)
    await cache.delete('compat-token')
    expect(await cache.get('compat-token')).toBeNull()
  })

  it('supports optional memory cache as L1 (for hot paths)', async () => {
    // For high-frequency access, we might want L1 memory + L2 KV
    const cache = new KVSessionCache(mockKV as unknown as KVNamespace, {
      enableL1Cache: true,
      l1MaxSize: 100,
      l1TtlSeconds: 60,
    })

    await cache.set('l1-token', { userId: 'l1-user', role: 'user' })

    // First get should populate L1
    await cache.get('l1-token')

    // Second get should hit L1, not KV
    const getCallsBefore = mockKV.get.mock.calls.length
    await cache.get('l1-token')
    const getCallsAfter = mockKV.get.mock.calls.length

    // If L1 is working, no additional KV get should have been made
    expect(getCallsAfter).toBe(getCallsBefore)
  })
})
