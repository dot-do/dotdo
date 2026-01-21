/**
 * Rate Limiter Memory Cleanup Tests
 *
 * TDD tests for rate limiter cleanup functionality to ensure bounded memory usage.
 * Tests expired entry removal and LRU eviction for slidingWindows and fixedWindows Maps.
 *
 * Coverage:
 * - Expired entries are removed during cleanup
 * - Cleanup runs periodically (configurable interval)
 * - Memory is bounded via LRU eviction when max entries exceeded
 * - Metrics expose current map sizes
 *
 * @module api/tests/rate-limiter-cleanup.test
 * @issue do-ti43.9 - [TDD] Rate limiter memory cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RateLimiter,
  type RateLimitConfig,
} from '../middleware/rate-limit'

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
  const {
    tenantId = 'default',
    userId,
    ip = '192.168.1.1',
  } = options

  const hostname = tenantId ? `${tenantId}.api.dotdo.dev` : 'api.dotdo.dev'
  const url = `https://${hostname}/api/test`

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  }

  if (tenantId) {
    requestHeaders['X-Tenant-ID'] = tenantId
  }

  if (userId) {
    requestHeaders['X-User-ID'] = userId
  }

  return new Request(url, {
    method: 'GET',
    headers: new Headers(requestHeaders),
  })
}

// ============================================================================
// TESTS: EXPIRED ENTRY CLEANUP - SLIDING WINDOW
// ============================================================================

describe('Rate Limiter Memory Cleanup - Sliding Window', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should remove expired sliding window entries during cleanup', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 }, // 1 minute window
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
    })

    // Create entries for multiple tenants
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-c' }))

    // Verify entries exist
    const metricsBeforeExpire = await rateLimiter.getMetrics()
    expect(metricsBeforeExpire.slidingWindowCount).toBe(3)

    // Advance time past the window expiration (61 seconds)
    await vi.advanceTimersByTimeAsync(61000)

    // Trigger cleanup
    const entriesRemoved = await rateLimiter.cleanup()

    // All entries should be removed since they expired
    const metricsAfterCleanup = await rateLimiter.getMetrics()
    expect(metricsAfterCleanup.slidingWindowCount).toBe(0)

    // cleanup() should return number of entries removed
    expect(entriesRemoved).toBe(3)
  })

  it('should retain active sliding window entries during cleanup', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
    })

    // Create entries for multiple tenants
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))

    // Advance time partially (30 seconds - half the window)
    await vi.advanceTimersByTimeAsync(30000)

    // Add a new entry
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-c' }))

    // Trigger cleanup - nothing should be removed yet
    await rateLimiter.cleanup()
    let metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(3)

    // Advance time past original entries' expiration (35 more seconds)
    await vi.advanceTimersByTimeAsync(35000)

    // Trigger cleanup - first two entries should be removed
    await rateLimiter.cleanup()
    metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(1)

    // The third entry should still be active
    const state = await rateLimiter.getState('tenant:tenant-c')
    expect(state).not.toBeNull()
  })

  it('should handle cleanup with empty maps gracefully', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
      windowStrategy: 'sliding',
    })

    // Cleanup on empty maps should not throw
    await expect(rateLimiter.cleanup()).resolves.not.toThrow()

    const metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(0)
  })
})

// ============================================================================
// TESTS: EXPIRED ENTRY CLEANUP - FIXED WINDOW
// ============================================================================

describe('Rate Limiter Memory Cleanup - Fixed Window', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should remove expired fixed window entries during cleanup', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'fixed',
    })

    // Create entries for multiple tenants
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-c' }))

    // Verify entries exist
    const metricsBeforeExpire = await rateLimiter.getMetrics()
    expect(metricsBeforeExpire.fixedWindowCount).toBe(3)

    // Advance time past the window expiration (61 seconds)
    await vi.advanceTimersByTimeAsync(61000)

    // Trigger cleanup
    const entriesRemoved = await rateLimiter.cleanup()

    // All entries should be removed since they expired
    const metricsAfterCleanup = await rateLimiter.getMetrics()
    expect(metricsAfterCleanup.fixedWindowCount).toBe(0)

    // cleanup() should return number of entries removed
    expect(entriesRemoved).toBe(3)
  })

  it('should retain active fixed window entries during cleanup', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'fixed',
    })

    // Create entries
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))

    // Advance time partially
    await vi.advanceTimersByTimeAsync(30000)

    // Add a new entry
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))

    // Trigger cleanup - nothing should be removed yet
    await rateLimiter.cleanup()
    let metrics = await rateLimiter.getMetrics()
    expect(metrics.fixedWindowCount).toBe(2)

    // Advance time past first entry's expiration
    await vi.advanceTimersByTimeAsync(35000)

    // Trigger cleanup - first entry should be removed
    await rateLimiter.cleanup()
    metrics = await rateLimiter.getMetrics()
    expect(metrics.fixedWindowCount).toBe(1)
  })
})

// ============================================================================
// TESTS: LRU EVICTION
// ============================================================================

describe('Rate Limiter LRU Eviction', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should evict least recently used entries when maxEntries exceeded', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
      maxEntries: 3, // Limit to 3 entries
    })

    // Create 3 entries at capacity
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' })) // oldest
    await vi.advanceTimersByTimeAsync(100) // small delay to ensure ordering
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))
    await vi.advanceTimersByTimeAsync(100)
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-c' }))

    let metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(3)

    // Add a 4th entry - should evict tenant-a (LRU)
    await vi.advanceTimersByTimeAsync(100)
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-d' }))

    metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(3)

    // tenant-a should be evicted
    const stateA = await rateLimiter.getState('tenant:tenant-a')
    expect(stateA).toBeNull()

    // Others should still exist
    const stateB = await rateLimiter.getState('tenant:tenant-b')
    expect(stateB).not.toBeNull()
    const stateC = await rateLimiter.getState('tenant:tenant-c')
    expect(stateC).not.toBeNull()
    const stateD = await rateLimiter.getState('tenant:tenant-d')
    expect(stateD).not.toBeNull()
  })

  it('should update LRU order when entry is accessed', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
      maxEntries: 3,
    })

    // Create 3 entries
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' })) // oldest
    await vi.advanceTimersByTimeAsync(100)
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))
    await vi.advanceTimersByTimeAsync(100)
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-c' }))

    // Access tenant-a again to make it most recently used
    await vi.advanceTimersByTimeAsync(100)
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))

    // Add new entry - should evict tenant-b (now LRU)
    await vi.advanceTimersByTimeAsync(100)
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-d' }))

    // tenant-b should be evicted, tenant-a should remain
    const stateA = await rateLimiter.getState('tenant:tenant-a')
    expect(stateA).not.toBeNull()
    const stateB = await rateLimiter.getState('tenant:tenant-b')
    expect(stateB).toBeNull()
  })

  it('should not evict when under maxEntries limit', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
      maxEntries: 10, // High limit
    })

    // Create only 3 entries
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-c' }))

    const metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(3)

    // All should exist
    expect(await rateLimiter.getState('tenant:tenant-a')).not.toBeNull()
    expect(await rateLimiter.getState('tenant:tenant-b')).not.toBeNull()
    expect(await rateLimiter.getState('tenant:tenant-c')).not.toBeNull()
  })
})

// ============================================================================
// TESTS: METRICS
// ============================================================================

describe('Rate Limiter Metrics', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should expose map sizes via getMetrics()', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
      windowStrategy: 'sliding',
    })

    const initialMetrics = await rateLimiter.getMetrics()
    expect(initialMetrics).toEqual({
      slidingWindowCount: 0,
      fixedWindowCount: 0,
      totalEntries: 0,
      lastCleanup: null,
      entriesRemoved: 0,
    })

    // Add some entries
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))

    const updatedMetrics = await rateLimiter.getMetrics()
    expect(updatedMetrics.slidingWindowCount).toBe(2)
    expect(updatedMetrics.totalEntries).toBe(2)
  })

  it('should track lastCleanup timestamp', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
    })

    let metrics = await rateLimiter.getMetrics()
    expect(metrics.lastCleanup).toBeNull()

    // Trigger cleanup
    await rateLimiter.cleanup()

    metrics = await rateLimiter.getMetrics()
    expect(metrics.lastCleanup).toBe(Date.now())
  })

  it('should track entriesRemoved in metrics', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
    })

    // Add entries and let them expire
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))

    // Advance time past expiration
    await vi.advanceTimersByTimeAsync(61000)

    // Trigger cleanup
    await rateLimiter.cleanup()

    // Metrics should reflect entries removed
    const metrics = await rateLimiter.getMetrics()
    expect(metrics.entriesRemoved).toBe(2)
  })

  it('cleanup() should return 0 when no entries to clean', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
    })

    const entriesRemoved = await rateLimiter.cleanup()
    expect(entriesRemoved).toBe(0)
  })

  it('should include both sliding and fixed window counts', async () => {
    // Create two rate limiters with different strategies
    const slidingLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
      windowStrategy: 'sliding',
    })

    const fixedLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
      windowStrategy: 'fixed',
    })

    await slidingLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await fixedLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))

    const slidingMetrics = await slidingLimiter.getMetrics()
    expect(slidingMetrics.slidingWindowCount).toBe(1)
    expect(slidingMetrics.fixedWindowCount).toBe(0)

    const fixedMetrics = await fixedLimiter.getMetrics()
    expect(fixedMetrics.slidingWindowCount).toBe(0)
    expect(fixedMetrics.fixedWindowCount).toBe(1)
  })
})

// ============================================================================
// TESTS: AUTO-CLEANUP (PERIODIC)
// ============================================================================

describe('Rate Limiter Auto Cleanup', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should run cleanup automatically at configured interval', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 30000 }, // 30s window
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
      cleanupIntervalMs: 60000, // Cleanup every 60 seconds
    })

    // Start auto cleanup
    rateLimiter.startAutoCleanup()

    // Add entries
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))

    let metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(2)

    // Advance time past window expiration (35s) but before cleanup interval
    await vi.advanceTimersByTimeAsync(35000)
    metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(2) // Not cleaned yet

    // Advance time to cleanup interval (25 more seconds to reach 60s total)
    await vi.advanceTimersByTimeAsync(25000)
    metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(0) // Auto-cleanup triggered

    // Stop auto cleanup
    rateLimiter.stopAutoCleanup()
  })

  it('should stop auto cleanup when stopAutoCleanup() called', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 30000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
      cleanupIntervalMs: 60000,
    })

    rateLimiter.startAutoCleanup()

    // Add entry
    await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))

    // Advance past window expiration
    await vi.advanceTimersByTimeAsync(35000)

    // Stop auto cleanup before interval fires
    rateLimiter.stopAutoCleanup()

    // Advance past cleanup interval
    await vi.advanceTimersByTimeAsync(30000)

    // Entry should still exist (no cleanup ran)
    const metrics = await rateLimiter.getMetrics()
    expect(metrics.slidingWindowCount).toBe(1)
  })

  it('should not throw if stopAutoCleanup called without startAutoCleanup', () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
    })

    // Should not throw
    expect(() => rateLimiter.stopAutoCleanup()).not.toThrow()
  })

  it('should handle multiple startAutoCleanup calls gracefully', () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
      cleanupIntervalMs: 60000,
    })

    // Multiple starts should not create multiple intervals
    rateLimiter.startAutoCleanup()
    rateLimiter.startAutoCleanup()
    rateLimiter.startAutoCleanup()

    // Should only have one cleanup running - verify no error and stop works
    expect(() => rateLimiter.stopAutoCleanup()).not.toThrow()
  })
})

// ============================================================================
// TESTS: DEFAULT CONFIGURATION
// ============================================================================

describe('Rate Limiter Cleanup Configuration Defaults', () => {
  it('should default maxEntries to 10000 if not specified', async () => {
    const rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
    })

    // The default should be high enough that normal usage doesn't trigger eviction
    // We can verify by checking the config via metrics or by creating many entries
    const config = rateLimiter.getConfig()
    expect(config.maxEntries).toBe(10000)
  })

  it('should default cleanupIntervalMs to 5 minutes if not specified', () => {
    const rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      defaultTier: 'free',
    })

    const config = rateLimiter.getConfig()
    expect(config.cleanupIntervalMs).toBe(300000) // 5 minutes
  })
})
