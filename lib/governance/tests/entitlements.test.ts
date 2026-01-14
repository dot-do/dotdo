/**
 * Entitlements Tests - TDD Red-Green-Refactor
 *
 * Tests for entitlement checks following Polar patterns:
 * - Boolean feature checks
 * - Cached entitlement lookup
 * - Subscription tier mapping
 * - Graceful degradation when source unavailable
 *
 * @see https://docs.polar.sh
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  EntitlementChecker,
  type EntitlementSource,
  type Entitlement,
  type CheckResult,
  type EntitlementConfig,
} from '../entitlements'

// =============================================================================
// Mock Entitlement Source
// =============================================================================

class MockEntitlementSource implements EntitlementSource {
  private entitlements = new Map<string, Map<string, Entitlement>>()
  private callCount = 0
  private shouldFail = false
  private latencyMs = 0

  async getEntitlements(customerId: string): Promise<Entitlement[]> {
    this.callCount++

    if (this.shouldFail) {
      throw new Error('Source unavailable')
    }

    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs))
    }

    const customerEntitlements = this.entitlements.get(customerId)
    return customerEntitlements ? Array.from(customerEntitlements.values()) : []
  }

  // Test helpers
  setEntitlements(customerId: string, entitlements: Entitlement[]): void {
    const map = new Map<string, Entitlement>()
    for (const e of entitlements) {
      map.set(e.feature, e)
    }
    this.entitlements.set(customerId, map)
  }

  getCallCount(): number {
    return this.callCount
  }

  resetCallCount(): void {
    this.callCount = 0
  }

  setFailMode(fail: boolean): void {
    this.shouldFail = fail
  }

  setLatency(ms: number): void {
    this.latencyMs = ms
  }
}

// =============================================================================
// Boolean Feature Checks Tests
// =============================================================================

describe('EntitlementChecker', () => {
  let source: MockEntitlementSource
  let checker: EntitlementChecker

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    source = new MockEntitlementSource()
    checker = new EntitlementChecker(source)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('boolean feature checks', () => {
    it('should return true for an entitled feature', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'premium_support', enabled: true },
      ])

      const result = await checker.check('cust_123', 'premium_support')

      expect(result.entitled).toBe(true)
    })

    it('should return false for a non-entitled feature', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'basic', enabled: true },
      ])

      const result = await checker.check('cust_123', 'premium_support')

      expect(result.entitled).toBe(false)
      expect(result.reason).toBe('NOT_FOUND')
    })

    it('should return false for disabled feature', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'premium_support', enabled: false },
      ])

      const result = await checker.check('cust_123', 'premium_support')

      expect(result.entitled).toBe(false)
      expect(result.reason).toBe('DISABLED')
    })

    it('should return false for customer with no entitlements', async () => {
      const result = await checker.check('unknown_customer', 'any_feature')

      expect(result.entitled).toBe(false)
      // Returns NOT_FOUND when the specific feature isn't in the customer's entitlements
      expect(result.reason).toBe('NOT_FOUND')
    })
  })

  // =============================================================================
  // Value-Based Entitlements Tests
  // =============================================================================

  describe('value-based entitlements', () => {
    it('should return numeric limit', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'api_requests', enabled: true, limit: 10000 },
      ])

      const result = await checker.check('cust_123', 'api_requests')

      expect(result.entitled).toBe(true)
      expect(result.limit).toBe(10000)
    })

    it('should return string value', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'plan_tier', enabled: true, value: 'enterprise' },
      ])

      const result = await checker.check('cust_123', 'plan_tier')

      expect(result.entitled).toBe(true)
      expect(result.value).toBe('enterprise')
    })

    it('should support unlimited flag', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'storage', enabled: true, unlimited: true },
      ])

      const result = await checker.check('cust_123', 'storage')

      expect(result.entitled).toBe(true)
      expect(result.unlimited).toBe(true)
    })
  })

  // =============================================================================
  // Caching Tests
  // =============================================================================

  describe('caching', () => {
    it('should cache entitlements for a customer', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 60000,
      })

      source.setEntitlements('cust_123', [
        { feature: 'premium', enabled: true },
      ])

      // First check - should call source
      await cachedChecker.check('cust_123', 'premium')
      expect(source.getCallCount()).toBe(1)

      // Second check - should use cache
      await cachedChecker.check('cust_123', 'premium')
      expect(source.getCallCount()).toBe(1)
    })

    it('should respect cache TTL', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 30000,
      })

      source.setEntitlements('cust_123', [
        { feature: 'premium', enabled: true },
      ])

      // First check
      await cachedChecker.check('cust_123', 'premium')
      expect(source.getCallCount()).toBe(1)

      // Advance time past TTL
      vi.advanceTimersByTime(31000)

      // Should refresh from source
      await cachedChecker.check('cust_123', 'premium')
      expect(source.getCallCount()).toBe(2)
    })

    it('should invalidate cache manually', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 60000,
      })

      source.setEntitlements('cust_123', [
        { feature: 'premium', enabled: true },
      ])

      await cachedChecker.check('cust_123', 'premium')
      expect(source.getCallCount()).toBe(1)

      // Invalidate cache
      cachedChecker.invalidate('cust_123')

      // Should refresh from source
      await cachedChecker.check('cust_123', 'premium')
      expect(source.getCallCount()).toBe(2)
    })

    it('should isolate cache by customer', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 60000,
      })

      source.setEntitlements('cust_A', [{ feature: 'premium', enabled: true }])
      source.setEntitlements('cust_B', [{ feature: 'premium', enabled: false }])

      // Check both customers
      const resultA = await cachedChecker.check('cust_A', 'premium')
      const resultB = await cachedChecker.check('cust_B', 'premium')

      expect(resultA.entitled).toBe(true)
      expect(resultB.entitled).toBe(false)
    })
  })

  // =============================================================================
  // Subscription Tier Mapping Tests
  // =============================================================================

  describe('subscription tier mapping', () => {
    it('should support tier-based entitlements', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'tier', enabled: true, value: 'pro' },
        { feature: 'seats', enabled: true, limit: 10 },
        { feature: 'api_calls', enabled: true, limit: 100000 },
        { feature: 'custom_domain', enabled: true },
      ])

      const tierCheck = await checker.check('cust_123', 'tier')
      const seatsCheck = await checker.check('cust_123', 'seats')
      const apiCheck = await checker.check('cust_123', 'api_calls')
      const domainCheck = await checker.check('cust_123', 'custom_domain')

      expect(tierCheck.value).toBe('pro')
      expect(seatsCheck.limit).toBe(10)
      expect(apiCheck.limit).toBe(100000)
      expect(domainCheck.entitled).toBe(true)
    })

    it('should check all features for a customer', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'feature_a', enabled: true },
        { feature: 'feature_b', enabled: true },
        { feature: 'feature_c', enabled: false },
      ])

      const all = await checker.checkAll('cust_123')

      expect(all.entitled).toContain('feature_a')
      expect(all.entitled).toContain('feature_b')
      expect(all.notEntitled).toContain('feature_c')
    })
  })

  // =============================================================================
  // Graceful Degradation Tests
  // =============================================================================

  describe('graceful degradation', () => {
    it('should use fallback when source unavailable', async () => {
      const checkerWithFallback = new EntitlementChecker(source, {
        fallbackOnError: true,
        defaultEntitlements: [
          { feature: 'basic', enabled: true },
        ],
      })

      source.setFailMode(true)

      const result = await checkerWithFallback.check('cust_123', 'basic')

      expect(result.entitled).toBe(true)
      expect(result.fromFallback).toBe(true)
    })

    it('should return false by default when source unavailable and no fallback', async () => {
      const checkerNoFallback = new EntitlementChecker(source, {
        fallbackOnError: false,
      })

      source.setFailMode(true)

      const result = await checkerNoFallback.check('cust_123', 'premium')

      expect(result.entitled).toBe(false)
      expect(result.reason).toBe('SOURCE_ERROR')
    })

    it('should use cached value when source fails', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 60000,
        fallbackOnError: true,
        staleCacheOnError: true,
      })

      source.setEntitlements('cust_123', [
        { feature: 'premium', enabled: true },
      ])

      // First check - populate cache
      await cachedChecker.check('cust_123', 'premium')

      // Advance past TTL
      vi.advanceTimersByTime(61000)

      // Source fails
      source.setFailMode(true)

      // Should use stale cache
      const result = await cachedChecker.check('cust_123', 'premium')

      expect(result.entitled).toBe(true)
      expect(result.fromStaleCache).toBe(true)
    })
  })

  // =============================================================================
  // Batch Check Tests
  // =============================================================================

  describe('batch checking', () => {
    it('should check multiple features at once', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'premium', enabled: true },
        { feature: 'api_access', enabled: true },
        { feature: 'admin', enabled: false },
      ])

      const results = await checker.checkMany('cust_123', [
        'premium',
        'api_access',
        'admin',
        'unknown',
      ])

      expect(results.premium.entitled).toBe(true)
      expect(results.api_access.entitled).toBe(true)
      expect(results.admin.entitled).toBe(false)
      expect(results.unknown.entitled).toBe(false)
    })

    it('should only call source once for batch check', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 60000,
      })

      source.setEntitlements('cust_123', [
        { feature: 'a', enabled: true },
        { feature: 'b', enabled: true },
        { feature: 'c', enabled: true },
      ])

      await cachedChecker.checkMany('cust_123', ['a', 'b', 'c'])

      expect(source.getCallCount()).toBe(1)
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    it('should handle empty feature name', async () => {
      const result = await checker.check('cust_123', '')

      expect(result.entitled).toBe(false)
      expect(result.reason).toBe('INVALID_FEATURE')
    })

    it('should handle empty customer ID', async () => {
      const result = await checker.check('', 'premium')

      expect(result.entitled).toBe(false)
      expect(result.reason).toBe('INVALID_CUSTOMER')
    })

    it('should handle special characters in feature names', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'feature:with:colons', enabled: true },
        { feature: 'feature/with/slashes', enabled: true },
      ])

      const result1 = await checker.check('cust_123', 'feature:with:colons')
      const result2 = await checker.check('cust_123', 'feature/with/slashes')

      expect(result1.entitled).toBe(true)
      expect(result2.entitled).toBe(true)
    })

    it('should handle concurrent checks for same customer', async () => {
      const cachedChecker = new EntitlementChecker(source, {
        cacheTtlMs: 60000,
      })

      source.setEntitlements('cust_123', [
        { feature: 'premium', enabled: true },
      ])

      // Concurrent checks
      const results = await Promise.all([
        cachedChecker.check('cust_123', 'premium'),
        cachedChecker.check('cust_123', 'premium'),
        cachedChecker.check('cust_123', 'premium'),
      ])

      // All should succeed
      expect(results.every(r => r.entitled)).toBe(true)

      // Should have only called source once (cache coalescing)
      expect(source.getCallCount()).toBeLessThanOrEqual(3)
    })

    it('should handle null/undefined values in entitlements', async () => {
      source.setEntitlements('cust_123', [
        { feature: 'nullish', enabled: true, value: undefined, limit: undefined },
      ])

      const result = await checker.check('cust_123', 'nullish')

      expect(result.entitled).toBe(true)
      expect(result.value).toBeUndefined()
      expect(result.limit).toBeUndefined()
    })
  })
})
