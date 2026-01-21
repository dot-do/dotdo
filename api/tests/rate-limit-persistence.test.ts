/**
 * Rate Limit Persistence Tests - TDD for do-svo4
 *
 * Tests verifying that rate limit state persists across DO restarts.
 * Now uses SQLite storage for persistence.
 *
 * RED phase: Tests document the bug - rate limit state lost with in-memory storage.
 * GREEN phase: SQLite storage in RateLimiter class persists state across restarts.
 *
 * @module api/tests/rate-limit-persistence.test
 * @issue do-svo4 - Fix rate limiter in-memory storage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import {
  RateLimiter,
  type RateLimitConfig,
  type RateLimitSqlStorage,
} from '../middleware/rate-limit'

// ============================================================================
// TYPE DECLARATIONS
// ============================================================================

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DO: DurableObjectNamespace
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock HTTP request with configurable headers
 */
function createMockRequest(options: {
  tenantId?: string
  userId?: string
  ip?: string
}): Request {
  const { tenantId, userId, ip = '192.168.1.1' } = options

  const hostname = tenantId ? `${tenantId}.api.dotdo.dev` : 'api.dotdo.dev'
  const url = `https://${hostname}/api/test`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  }

  if (tenantId) {
    headers['X-Tenant-ID'] = tenantId
  }

  if (userId) {
    headers['X-User-ID'] = userId
  }

  return new Request(url, {
    method: 'GET',
    headers: new Headers(headers),
  })
}

/**
 * Create a mock SQLite storage for testing
 * This simulates DurableObjectState.storage.sql
 */
function createMockSqlStorage(): RateLimitSqlStorage {
  const db = new Map<string, unknown[]>()

  // Initialize tables
  db.set('rate_limit_sliding_window', [])
  db.set('rate_limit_fixed_window', [])

  let autoIncrement = 0

  return {
    exec<T = unknown>(query: string, ...params: unknown[]): { toArray(): T[] } {
      const normalizedQuery = query.trim().toLowerCase()

      // CREATE TABLE - no-op for mock
      if (normalizedQuery.startsWith('create table') || normalizedQuery.startsWith('create index')) {
        return { toArray: () => [] as T[] }
      }

      // INSERT INTO rate_limit_sliding_window
      if (normalizedQuery.includes('insert into rate_limit_sliding_window')) {
        const rows = db.get('rate_limit_sliding_window') as Array<{ id: number; key: string; timestamp_ms: number }>
        rows.push({ id: ++autoIncrement, key: params[0] as string, timestamp_ms: params[1] as number })
        return { toArray: () => [] as T[] }
      }

      // INSERT INTO rate_limit_fixed_window
      if (normalizedQuery.includes('insert into rate_limit_fixed_window')) {
        const rows = db.get('rate_limit_fixed_window') as Array<{ key: string; window_start_ms: number; count: number }>
        rows.push({ key: params[0] as string, window_start_ms: params[1] as number, count: 0 })
        return { toArray: () => [] as T[] }
      }

      // DELETE FROM rate_limit_sliding_window WHERE key = ? AND timestamp_ms <= ?
      // This requires 2 parameters: key and cutoff
      if (normalizedQuery.includes('delete from rate_limit_sliding_window') &&
          normalizedQuery.includes('key =') && normalizedQuery.includes('timestamp_ms') &&
          params.length >= 2) {
        const rows = db.get('rate_limit_sliding_window') as Array<{ id: number; key: string; timestamp_ms: number }>
        const key = params[0] as string
        const cutoff = params[1] as number
        const filtered = rows.filter(r => !(r.key === key && r.timestamp_ms <= cutoff))
        db.set('rate_limit_sliding_window', filtered)
        return { toArray: () => [] as T[] }
      }

      // DELETE FROM rate_limit_sliding_window WHERE key = ?
      if (normalizedQuery.includes('delete from rate_limit_sliding_window') && !normalizedQuery.includes('timestamp_ms')) {
        const rows = db.get('rate_limit_sliding_window') as Array<{ id: number; key: string; timestamp_ms: number }>
        const key = params[0] as string
        const filtered = rows.filter(r => r.key !== key)
        db.set('rate_limit_sliding_window', filtered)
        return { toArray: () => [] as T[] }
      }

      // DELETE FROM rate_limit_fixed_window WHERE key = ?
      if (normalizedQuery.includes('delete from rate_limit_fixed_window')) {
        const rows = db.get('rate_limit_fixed_window') as Array<{ key: string; window_start_ms: number; count: number }>
        const key = params[0] as string
        const filtered = rows.filter(r => r.key !== key)
        db.set('rate_limit_fixed_window', filtered)
        return { toArray: () => [] as T[] }
      }

      // SELECT COUNT(*) FROM rate_limit_sliding_window
      if (normalizedQuery.includes('select count(*)') && normalizedQuery.includes('rate_limit_sliding_window')) {
        const rows = db.get('rate_limit_sliding_window') as Array<{ id: number; key: string; timestamp_ms: number }>
        const key = params[0] as string
        const count = rows.filter(r => r.key === key).length
        return { toArray: () => [{ count }] as T[] }
      }

      // SELECT MIN(timestamp_ms) FROM rate_limit_sliding_window
      if (normalizedQuery.includes('select min(timestamp_ms)')) {
        const rows = db.get('rate_limit_sliding_window') as Array<{ id: number; key: string; timestamp_ms: number }>
        const key = params[0] as string
        const filtered = rows.filter(r => r.key === key)
        const first_ts = filtered.length > 0 ? Math.min(...filtered.map(r => r.timestamp_ms)) : null
        return { toArray: () => [{ first_ts }] as T[] }
      }

      // SELECT window_start_ms, count FROM rate_limit_fixed_window
      if (normalizedQuery.includes('select window_start_ms, count')) {
        const rows = db.get('rate_limit_fixed_window') as Array<{ key: string; window_start_ms: number; count: number }>
        const key = params[0] as string
        const filtered = rows.filter(r => r.key === key)
        return { toArray: () => filtered as T[] }
      }

      // SELECT count FROM rate_limit_fixed_window
      if (normalizedQuery.includes('select count from rate_limit_fixed_window')) {
        const rows = db.get('rate_limit_fixed_window') as Array<{ key: string; window_start_ms: number; count: number }>
        const key = params[0] as string
        const filtered = rows.filter(r => r.key === key)
        return { toArray: () => filtered.map(r => ({ count: r.count })) as T[] }
      }

      // UPDATE rate_limit_fixed_window SET window_start_ms = ?, count = 0
      if (normalizedQuery.includes('update rate_limit_fixed_window') && normalizedQuery.includes('window_start_ms')) {
        const rows = db.get('rate_limit_fixed_window') as Array<{ key: string; window_start_ms: number; count: number }>
        const windowStart = params[0] as number
        const key = params[1] as string
        const row = rows.find(r => r.key === key)
        if (row) {
          row.window_start_ms = windowStart
          row.count = 0
        }
        return { toArray: () => [] as T[] }
      }

      // UPDATE rate_limit_fixed_window SET count = count + 1
      if (normalizedQuery.includes('update rate_limit_fixed_window') && normalizedQuery.includes('count + 1')) {
        const rows = db.get('rate_limit_fixed_window') as Array<{ key: string; window_start_ms: number; count: number }>
        const key = params[0] as string
        const row = rows.find(r => r.key === key)
        if (row) {
          row.count++
        }
        return { toArray: () => [] as T[] }
      }

      // DELETE FROM rate_limit_sliding_window WHERE timestamp_ms <= ? (global cleanup)
      // This handles cleanupExpiredEntries which has only one parameter (cutoff)
      if (normalizedQuery.includes('delete from rate_limit_sliding_window') &&
          !normalizedQuery.includes('key') && params.length === 1) {
        const rows = db.get('rate_limit_sliding_window') as Array<{ id: number; key: string; timestamp_ms: number }>
        const cutoff = params[0] as number
        const filtered = rows.filter(r => r.timestamp_ms > cutoff)
        db.set('rate_limit_sliding_window', filtered)
        return { toArray: () => [] as T[] }
      }

      return { toArray: () => [] as T[] }
    }
  }
}

// ============================================================================
// TESTS: RATE LIMIT STATE PERSISTENCE (do-svo4)
// ============================================================================

describe('Rate Limit Persistence (do-svo4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-20T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('In-Memory Storage Problem (documents the bug)', () => {
    it('should show that rate limit state is lost without SQLite storage', async () => {
      // Config WITHOUT storage - uses in-memory Map
      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
        },
        defaultTier: 'test',
        // NO storage - uses in-memory Map
      }

      const tenantId = 'acme-corp'

      // First RateLimiter instance - exhaust the limit
      const rateLimiter1 = new RateLimiter(config)

      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter1.check(createMockRequest({ tenantId }))
        expect(result.allowed).toBe(true)
      }

      // Verify rate limited
      const blockedResult = await rateLimiter1.check(createMockRequest({ tenantId }))
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.statusCode).toBe(429)

      // Create a NEW RateLimiter instance (simulates DO restart)
      // Without storage, state is lost
      const rateLimiter2 = new RateLimiter(config)

      // State is lost - allowed when it should be blocked
      const afterRestartResult = await rateLimiter2.check(createMockRequest({ tenantId }))
      expect(afterRestartResult.allowed).toBe(true) // BUG: Should be false with persistence!
    })
  })

  describe('SQLite Storage Fix (GREEN phase)', () => {
    it('should persist rate limit state across RateLimiter instances with shared storage', async () => {
      // Create shared SQLite storage (simulates DO's state.storage.sql)
      const sharedStorage = createMockSqlStorage()

      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
        },
        defaultTier: 'test',
        storage: sharedStorage, // Use SQLite storage!
      }

      const tenantId = 'acme-corp'

      // First RateLimiter instance - exhaust the limit
      const rateLimiter1 = new RateLimiter(config)

      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter1.check(createMockRequest({ tenantId }))
        expect(result.allowed).toBe(true)
      }

      // Verify rate limited
      const blockedResult = await rateLimiter1.check(createMockRequest({ tenantId }))
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.statusCode).toBe(429)

      // Create a NEW RateLimiter instance with SAME storage (simulates DO restart)
      const rateLimiter2 = new RateLimiter({
        ...config,
        storage: sharedStorage, // Same storage!
      })

      // State persists - should still be blocked
      const afterRestartResult = await rateLimiter2.check(createMockRequest({ tenantId }))
      expect(afterRestartResult.allowed).toBe(false) // Fixed! State persisted!
      expect(afterRestartResult.statusCode).toBe(429)
    })

    it('should persist getState data across RateLimiter instances with shared storage', async () => {
      const sharedStorage = createMockSqlStorage()

      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 10, windowMs: 60000 },
        },
        defaultTier: 'test',
        storage: sharedStorage,
      }

      const tenantId = 'persist-test'

      // First instance - make some requests
      const rateLimiter1 = new RateLimiter(config)

      for (let i = 0; i < 3; i++) {
        await rateLimiter1.check(createMockRequest({ tenantId }))
      }

      // Verify state exists
      const state1 = await rateLimiter1.getState('tenant:persist-test')
      expect(state1).toBeDefined()
      expect(state1?.requests).toBe(3)

      // Create a NEW RateLimiter instance with same storage
      const rateLimiter2 = new RateLimiter({
        ...config,
        storage: sharedStorage,
      })

      // State persists!
      const state2 = await rateLimiter2.getState('tenant:persist-test')
      expect(state2).toBeDefined()
      expect(state2?.requests).toBe(3) // Fixed! State persisted!
    })

    it('should work with fixed window strategy and SQLite storage', async () => {
      const sharedStorage = createMockSqlStorage()

      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
        },
        defaultTier: 'test',
        windowStrategy: 'fixed',
        storage: sharedStorage,
      }

      const tenantId = 'fixed-test'

      // First instance - exhaust limit
      const rateLimiter1 = new RateLimiter(config)

      for (let i = 0; i < 3; i++) {
        const result = await rateLimiter1.check(createMockRequest({ tenantId }))
        expect(result.allowed).toBe(true)
      }

      // Verify rate limited
      const blockedResult = await rateLimiter1.check(createMockRequest({ tenantId }))
      expect(blockedResult.allowed).toBe(false)

      // Create NEW instance with same storage
      const rateLimiter2 = new RateLimiter({
        ...config,
        storage: sharedStorage,
      })

      // State persists with fixed window too
      const afterRestartResult = await rateLimiter2.check(createMockRequest({ tenantId }))
      expect(afterRestartResult.allowed).toBe(false) // Fixed! State persisted!
    })
  })

  describe('TTL Cleanup', () => {
    it('should clean up expired entries from SQLite storage', async () => {
      const storage = createMockSqlStorage()

      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
        },
        defaultTier: 'test',
        storage,
      }

      const tenantId = 'ttl-test'
      const rateLimiter = new RateLimiter(config)

      // Make requests at time T=0
      for (let i = 0; i < 3; i++) {
        await rateLimiter.check(createMockRequest({ tenantId }))
      }

      // Verify 3 requests
      let state = await rateLimiter.getState('tenant:ttl-test')
      expect(state?.requests).toBe(3)

      // Advance past window
      await vi.advanceTimersByTimeAsync(61000)

      // The next check should trigger TTL cleanup
      await rateLimiter.check(createMockRequest({ tenantId }))

      // State should show only 1 request (the new one, old ones cleaned up)
      state = await rateLimiter.getState('tenant:ttl-test')
      expect(state?.requests).toBe(1)
    })

    it('should support manual cleanup via cleanupExpiredEntries', async () => {
      const storage = createMockSqlStorage()

      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 10, windowMs: 60000 },
        },
        defaultTier: 'test',
        storage,
      }

      const rateLimiter = new RateLimiter(config)

      // Make requests
      await rateLimiter.check(createMockRequest({ tenantId: 'cleanup-test' }))
      await rateLimiter.check(createMockRequest({ tenantId: 'cleanup-test' }))

      // Advance time
      await vi.advanceTimersByTimeAsync(61000)

      // Manual cleanup
      await rateLimiter.cleanupExpiredEntries(60000)

      // State should be empty after cleanup
      const state = await rateLimiter.getState('tenant:cleanup-test')
      expect(state).toBeNull()
    })
  })

  describe('Reset Key with SQLite Storage', () => {
    it('should reset rate limit state for a key in SQLite', async () => {
      const storage = createMockSqlStorage()

      const config: RateLimitConfig = {
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 2, windowMs: 60000 },
        },
        defaultTier: 'test',
        storage,
      }

      const tenantId = 'reset-test'
      const rateLimiter = new RateLimiter(config)

      // Exhaust limit
      for (let i = 0; i < 2; i++) {
        await rateLimiter.check(createMockRequest({ tenantId }))
      }

      // Verify rate limited
      let result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(false)

      // Reset
      await rateLimiter.resetKey('tenant:reset-test')

      // Should now be allowed with full quota
      result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })
  })
})

// ============================================================================
// TESTS: STORAGE INTERFACE
// ============================================================================

describe('RateLimitSqlStorage Interface', () => {
  it('should accept storage in config', () => {
    const storage = createMockSqlStorage()

    const rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      storage,
    })

    expect(rateLimiter).toBeDefined()
  })

  it('should work without storage (backwards compatible)', () => {
    const rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      // No storage - uses in-memory
    })

    expect(rateLimiter).toBeDefined()
  })
})
