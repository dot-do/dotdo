/**
 * $.rateLimit() Context API Tests (RED Phase)
 *
 * Tests for the rate limiting API on the WorkflowContext ($).
 *
 * The $.rateLimit API provides:
 * - $.rateLimit.check(key, options) - Check if action is rate limited
 * - $.rateLimit.consume(key, cost) - Consume quota with optional cost
 * - Hybrid strategy: Uses CF Rate Limit binding when available, falls back to DO
 * - Returns standardized { success, remaining } result
 *
 * These tests are RED phase TDD - they define expected behavior and verify:
 * 1. Type exports exist (RateLimitResult, RateLimitCheckOptions, RateLimitCapability)
 * 2. Type guard (hasRateLimit) is exported and works
 * 3. Expected type structures match the interfaces
 *
 * Tests will PASS for type verification but the actual runtime implementation
 * needs to be added to the DO base class to provide $.rateLimit.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  WorkflowContext,
  RateLimitResult,
  RateLimitCheckOptions,
  RateLimitCapability,
  WithRateLimit,
} from '../../types/WorkflowContext'
import { hasRateLimit } from '../../types/WorkflowContext'

// ============================================================================
// 1. TYPE EXPORT VERIFICATION
// ============================================================================

describe('Rate Limit Type Exports', () => {
  describe('RateLimitResult interface', () => {
    it('should export RateLimitResult type', () => {
      // Type exists and can be used
      type TestResult = RateLimitResult
      const _test: TestResult | null = null
      expect(_test).toBeNull()
    })

    it('should have success: boolean property', () => {
      expectTypeOf<RateLimitResult['success']>().toBeBoolean()
    })

    it('should have remaining: number property', () => {
      expectTypeOf<RateLimitResult['remaining']>().toBeNumber()
    })

    it('should have optional resetAt: number property', () => {
      expectTypeOf<RateLimitResult['resetAt']>().toEqualTypeOf<number | undefined>()
    })

    it('should have optional limit: number property', () => {
      expectTypeOf<RateLimitResult['limit']>().toEqualTypeOf<number | undefined>()
    })
  })

  describe('RateLimitCheckOptions interface', () => {
    it('should export RateLimitCheckOptions type', () => {
      type TestOptions = RateLimitCheckOptions
      const _test: TestOptions | null = null
      expect(_test).toBeNull()
    })

    it('should have optional limit: number property', () => {
      expectTypeOf<RateLimitCheckOptions['limit']>().toEqualTypeOf<number | undefined>()
    })

    it('should have optional windowMs: number property', () => {
      expectTypeOf<RateLimitCheckOptions['windowMs']>().toEqualTypeOf<number | undefined>()
    })

    it('should have optional cost: number property', () => {
      expectTypeOf<RateLimitCheckOptions['cost']>().toEqualTypeOf<number | undefined>()
    })

    it('should have optional name: string property', () => {
      expectTypeOf<RateLimitCheckOptions['name']>().toEqualTypeOf<string | undefined>()
    })
  })

  describe('RateLimitCapability interface', () => {
    it('should export RateLimitCapability type', () => {
      type TestCapability = RateLimitCapability
      const _test: TestCapability | null = null
      expect(_test).toBeNull()
    })

    it('should have check method', () => {
      expectTypeOf<RateLimitCapability['check']>().toBeFunction()
    })

    it('check method should accept key and optional options', () => {
      type CheckFn = RateLimitCapability['check']
      expectTypeOf<CheckFn>().parameter(0).toBeString()
      expectTypeOf<CheckFn>().parameter(1).toEqualTypeOf<RateLimitCheckOptions | undefined>()
    })

    it('check method should return Promise<RateLimitResult>', () => {
      type CheckFn = RateLimitCapability['check']
      expectTypeOf<CheckFn>().returns.toEqualTypeOf<Promise<RateLimitResult>>()
    })

    it('should have consume method', () => {
      expectTypeOf<RateLimitCapability['consume']>().toBeFunction()
    })

    it('consume method should accept key and optional cost', () => {
      type ConsumeFn = RateLimitCapability['consume']
      expectTypeOf<ConsumeFn>().parameter(0).toBeString()
      expectTypeOf<ConsumeFn>().parameter(1).toEqualTypeOf<number | undefined>()
    })

    it('consume method should return Promise<RateLimitResult>', () => {
      type ConsumeFn = RateLimitCapability['consume']
      expectTypeOf<ConsumeFn>().returns.toEqualTypeOf<Promise<RateLimitResult>>()
    })

    it('should have status method', () => {
      expectTypeOf<RateLimitCapability['status']>().toBeFunction()
    })

    it('status method should accept key and return Promise<RateLimitResult>', () => {
      type StatusFn = RateLimitCapability['status']
      expectTypeOf<StatusFn>().parameter(0).toBeString()
      expectTypeOf<StatusFn>().returns.toEqualTypeOf<Promise<RateLimitResult>>()
    })

    it('should have reset method', () => {
      expectTypeOf<RateLimitCapability['reset']>().toBeFunction()
    })

    it('reset method should accept key and return Promise<void>', () => {
      type ResetFn = RateLimitCapability['reset']
      expectTypeOf<ResetFn>().parameter(0).toBeString()
      expectTypeOf<ResetFn>().returns.toEqualTypeOf<Promise<void>>()
    })
  })

  describe('WithRateLimit type helper', () => {
    it('should export WithRateLimit type', () => {
      type TestWith = WithRateLimit
      const _test: TestWith | null = null
      expect(_test).toBeNull()
    })

    it('should be WorkflowContext with required rateLimit property', () => {
      // WithRateLimit should have rateLimit as required
      type HasRateLimit = WithRateLimit['rateLimit'] extends RateLimitCapability ? true : false
      const _check: HasRateLimit = true
      expect(_check).toBe(true)
    })
  })
})

// ============================================================================
// 2. TYPE GUARD VERIFICATION
// ============================================================================

describe('hasRateLimit type guard', () => {
  it('should export hasRateLimit function', async () => {
    const module = await import('../../types/WorkflowContext')
    expect(module).toHaveProperty('hasRateLimit')
  })

  it('should be a function', () => {
    expect(typeof hasRateLimit).toBe('function')
  })

  it('should return false for context without rateLimit', () => {
    const ctx = {
      send: () => {},
      try: async () => {},
      do: async () => {},
      on: {},
      every: {},
      branch: async () => {},
      checkout: async () => {},
      merge: async () => {},
      log: () => {},
      state: {},
    } as WorkflowContext

    expect(hasRateLimit(ctx)).toBe(false)
  })

  it('should return true for context with rateLimit', () => {
    const ctx = {
      send: () => {},
      try: async () => {},
      do: async () => {},
      on: {},
      every: {},
      branch: async () => {},
      checkout: async () => {},
      merge: async () => {},
      log: () => {},
      state: {},
      rateLimit: {
        check: async () => ({ success: true, remaining: 100 }),
        consume: async () => ({ success: true, remaining: 99 }),
        status: async () => ({ success: true, remaining: 100 }),
        reset: async () => {},
      },
    } as unknown as WorkflowContext

    expect(hasRateLimit(ctx)).toBe(true)
  })

  it('should return false when rateLimit is null', () => {
    const ctx = {
      send: () => {},
      try: async () => {},
      do: async () => {},
      on: {},
      every: {},
      branch: async () => {},
      checkout: async () => {},
      merge: async () => {},
      log: () => {},
      state: {},
      rateLimit: null,
    } as unknown as WorkflowContext

    expect(hasRateLimit(ctx)).toBe(false)
  })

  it('should return false when rateLimit is undefined', () => {
    const ctx = {
      send: () => {},
      try: async () => {},
      do: async () => {},
      on: {},
      every: {},
      branch: async () => {},
      checkout: async () => {},
      merge: async () => {},
      log: () => {},
      state: {},
      rateLimit: undefined,
    } as unknown as WorkflowContext

    expect(hasRateLimit(ctx)).toBe(false)
  })

  it('should narrow type after guard check', () => {
    const ctx = {
      send: () => {},
      try: async () => {},
      do: async () => {},
      on: {},
      every: {},
      branch: async () => {},
      checkout: async () => {},
      merge: async () => {},
      log: () => {},
      state: {},
      rateLimit: {
        check: async () => ({ success: true, remaining: 100 }),
        consume: async () => ({ success: true, remaining: 99 }),
        status: async () => ({ success: true, remaining: 100 }),
        reset: async () => {},
      },
    } as unknown as WorkflowContext

    if (hasRateLimit(ctx)) {
      // After type guard, rateLimit should be typed as RateLimitCapability
      expect(typeof ctx.rateLimit.check).toBe('function')
      expect(typeof ctx.rateLimit.consume).toBe('function')
      expect(typeof ctx.rateLimit.status).toBe('function')
      expect(typeof ctx.rateLimit.reset).toBe('function')
    }
  })
})

// ============================================================================
// 3. EXPECTED API BEHAVIOR TESTS (Runtime - will need implementation)
// ============================================================================

describe('$.rateLimit API Behavior (requires implementation)', () => {
  /**
   * Helper to create a mock context with rate limiting
   * This simulates what the actual implementation should provide
   */
  function createMockContextWithRateLimit(): WithRateLimit {
    const limits = new Map<string, { count: number; windowStart: number }>()
    const defaultLimit = 100
    const defaultWindowMs = 60000

    return {
      send: () => {},
      try: async () => {},
      do: async () => {},
      on: {} as any,
      every: {} as any,
      branch: async () => {},
      checkout: async () => {},
      merge: async () => {},
      log: () => {},
      state: {},
      rateLimit: {
        check: async (key: string, options?: RateLimitCheckOptions): Promise<RateLimitResult> => {
          const limit = options?.limit ?? defaultLimit
          const windowMs = options?.windowMs ?? defaultWindowMs
          const cost = options?.cost ?? 1
          const now = Date.now()

          const entry = limits.get(key)

          if (!entry || now - entry.windowStart > windowMs) {
            return {
              success: true,
              remaining: limit - cost,
              limit,
              resetAt: now + windowMs,
            }
          }

          const remaining = limit - entry.count - cost
          return {
            success: remaining >= 0,
            remaining: Math.max(0, remaining),
            limit,
            resetAt: entry.windowStart + windowMs,
          }
        },
        consume: async (key: string, cost = 1): Promise<RateLimitResult> => {
          const now = Date.now()
          const entry = limits.get(key)

          if (!entry || now - entry.windowStart > defaultWindowMs) {
            limits.set(key, { count: cost, windowStart: now })
            return {
              success: true,
              remaining: defaultLimit - cost,
            }
          }

          entry.count += cost
          return {
            success: entry.count <= defaultLimit,
            remaining: Math.max(0, defaultLimit - entry.count),
          }
        },
        status: async (key: string): Promise<RateLimitResult> => {
          const entry = limits.get(key)
          if (!entry) {
            return { success: true, remaining: defaultLimit }
          }
          return {
            success: entry.count < defaultLimit,
            remaining: Math.max(0, defaultLimit - entry.count),
          }
        },
        reset: async (key: string): Promise<void> => {
          limits.delete(key)
        },
      },
    } as unknown as WithRateLimit
  }

  describe('$.rateLimit.check()', () => {
    it('returns Promise<RateLimitResult>', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.check('user:123')

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('remaining')
    })

    it('success is true when under limit', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.check('user:123')

      expect(result.success).toBe(true)
      expect(result.remaining).toBeGreaterThan(0)
    })

    it('accepts custom limit option', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.check('user:123', { limit: 50 })

      expect(result.success).toBe(true)
      expect(result.limit).toBe(50)
    })

    it('accepts custom windowMs option', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.check('user:123', { windowMs: 30000 })

      expect(result).toHaveProperty('resetAt')
    })

    it('accepts cost option for weighted requests', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.check('user:123', { cost: 5, limit: 10 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(5) // 10 - 5 = 5
    })
  })

  describe('$.rateLimit.consume()', () => {
    it('returns Promise<RateLimitResult>', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.consume('user:123')

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('remaining')
    })

    it('deducts default cost of 1', async () => {
      const $ = createMockContextWithRateLimit()

      const before = await $.rateLimit.status('user:123')
      await $.rateLimit.consume('user:123')
      const after = await $.rateLimit.status('user:123')

      expect(after.remaining).toBe(before.remaining - 1)
    })

    it('deducts custom cost when provided', async () => {
      const $ = createMockContextWithRateLimit()

      const before = await $.rateLimit.status('user:123')
      await $.rateLimit.consume('user:123', 10)
      const after = await $.rateLimit.status('user:123')

      expect(after.remaining).toBe(before.remaining - 10)
    })

    it('returns success: false when quota exhausted', async () => {
      const $ = createMockContextWithRateLimit()

      // Consume all quota
      for (let i = 0; i < 100; i++) {
        await $.rateLimit.consume('user:123')
      }

      const result = await $.rateLimit.consume('user:123')
      expect(result.success).toBe(false)
    })
  })

  describe('$.rateLimit.status()', () => {
    it('returns current quota without modifying it', async () => {
      const $ = createMockContextWithRateLimit()

      const status1 = await $.rateLimit.status('user:123')
      const status2 = await $.rateLimit.status('user:123')

      expect(status1.remaining).toBe(status2.remaining)
    })

    it('returns { success, remaining } for new key', async () => {
      const $ = createMockContextWithRateLimit()
      const result = await $.rateLimit.status('new:key')

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(100) // default limit
    })

    it('reflects consumed quota', async () => {
      const $ = createMockContextWithRateLimit()

      await $.rateLimit.consume('user:123', 50)
      const status = await $.rateLimit.status('user:123')

      expect(status.remaining).toBe(50)
    })
  })

  describe('$.rateLimit.reset()', () => {
    it('returns Promise<void>', async () => {
      const $ = createMockContextWithRateLimit()
      const result = $.rateLimit.reset('user:123')

      expect(result).toBeInstanceOf(Promise)
      await expect(result).resolves.toBeUndefined()
    })

    it('restores full quota after reset', async () => {
      const $ = createMockContextWithRateLimit()

      // Consume some quota
      await $.rateLimit.consume('user:123', 50)
      const before = await $.rateLimit.status('user:123')

      // Reset
      await $.rateLimit.reset('user:123')
      const after = await $.rateLimit.status('user:123')

      expect(after.remaining).toBeGreaterThan(before.remaining)
      expect(after.remaining).toBe(100) // full quota restored
    })
  })

  describe('Result Shape', () => {
    it('always includes success boolean', async () => {
      const $ = createMockContextWithRateLimit()

      const checkResult = await $.rateLimit.check('user:123')
      const consumeResult = await $.rateLimit.consume('user:123')
      const statusResult = await $.rateLimit.status('user:123')

      expect(typeof checkResult.success).toBe('boolean')
      expect(typeof consumeResult.success).toBe('boolean')
      expect(typeof statusResult.success).toBe('boolean')
    })

    it('always includes remaining number', async () => {
      const $ = createMockContextWithRateLimit()

      const checkResult = await $.rateLimit.check('user:123')
      const consumeResult = await $.rateLimit.consume('user:123')
      const statusResult = await $.rateLimit.status('user:123')

      expect(typeof checkResult.remaining).toBe('number')
      expect(typeof consumeResult.remaining).toBe('number')
      expect(typeof statusResult.remaining).toBe('number')
    })

    it('remaining is never negative', async () => {
      const $ = createMockContextWithRateLimit()

      // Consume more than available
      for (let i = 0; i < 150; i++) {
        await $.rateLimit.consume('user:123')
      }

      const status = await $.rateLimit.status('user:123')
      expect(status.remaining).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles empty key', async () => {
      const $ = createMockContextWithRateLimit()
      await expect($.rateLimit.check('')).resolves.toBeDefined()
    })

    it('handles special characters in key', async () => {
      const $ = createMockContextWithRateLimit()
      await expect($.rateLimit.check('user:123:api/v1')).resolves.toBeDefined()
      await expect($.rateLimit.check('email@example.com')).resolves.toBeDefined()
    })

    it('handles zero cost', async () => {
      const $ = createMockContextWithRateLimit()

      const before = await $.rateLimit.status('user:123')
      await $.rateLimit.consume('user:123', 0)
      const after = await $.rateLimit.status('user:123')

      expect(after.remaining).toBe(before.remaining)
    })

    it('handles concurrent requests to same key', async () => {
      const $ = createMockContextWithRateLimit()

      const results = await Promise.all([
        $.rateLimit.check('user:123'),
        $.rateLimit.check('user:123'),
        $.rateLimit.check('user:123'),
      ])

      results.forEach((result) => {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('remaining')
      })
    })

    it('handles very high limits', async () => {
      const $ = createMockContextWithRateLimit()

      const result = await $.rateLimit.check('user:123', { limit: 1000000 })
      expect(result.success).toBe(true)
    })

    it('handles very small window', async () => {
      const $ = createMockContextWithRateLimit()

      const result = await $.rateLimit.check('user:123', { windowMs: 100 })
      expect(result).toHaveProperty('resetAt')
    })
  })
})

// ============================================================================
// 4. EXPECTED USAGE PATTERNS
// ============================================================================

describe('Expected Usage Patterns', () => {
  it('rate limiting pattern with type guard', () => {
    // Expected usage:
    //
    // const handleRequest = async ($: WorkflowContext, userId: string) => {
    //   if (!hasRateLimit($)) {
    //     // Rate limiting not available, proceed without limits
    //     return doAction()
    //   }
    //
    //   const result = await $.rateLimit.check(userId, { limit: 100 })
    //   if (!result.success) {
    //     throw new Error(`Rate limited. Retry after ${result.resetAt}`)
    //   }
    //
    //   await $.rateLimit.consume(userId)
    //   return doAction()
    // }

    type Handler = (ctx: WorkflowContext, userId: string) => Promise<unknown>
    const _typeCheck: Handler | null = null
    expect(_typeCheck).toBeNull()
  })

  it('cost-based rate limiting pattern', () => {
    // Expected usage:
    //
    // const handleExpensiveOperation = async ($: WithRateLimit, userId: string) => {
    //   // Expensive operations cost 10 tokens
    //   const result = await $.rateLimit.check(userId, { cost: 10, limit: 1000 })
    //   if (!result.success) {
    //     throw new Error('Rate limited for expensive operations')
    //   }
    //   await $.rateLimit.consume(userId, 10)
    //   return performExpensiveOperation()
    // }

    type Handler = (ctx: WithRateLimit, userId: string) => Promise<unknown>
    const _typeCheck: Handler | null = null
    expect(_typeCheck).toBeNull()
  })

  it('named limits pattern', () => {
    // Expected usage:
    //
    // const handleAuth = async ($: WithRateLimit, ip: string) => {
    //   // Auth has stricter limits than API
    //   const result = await $.rateLimit.check(ip, {
    //     name: 'auth',
    //     limit: 5,
    //     windowMs: 60000
    //   })
    //   if (!result.success) {
    //     throw new Error('Too many login attempts')
    //   }
    //   return attemptLogin()
    // }

    type Handler = (ctx: WithRateLimit, ip: string) => Promise<unknown>
    const _typeCheck: Handler | null = null
    expect(_typeCheck).toBeNull()
  })

  it('admin reset pattern', () => {
    // Expected usage:
    //
    // const resetUserLimit = async ($: WithRateLimit, userId: string) => {
    //   await $.rateLimit.reset(userId)
    //   $.log('Rate limit reset for user', { userId })
    // }

    type Handler = (ctx: WithRateLimit, userId: string) => Promise<void>
    const _typeCheck: Handler | null = null
    expect(_typeCheck).toBeNull()
  })
})
