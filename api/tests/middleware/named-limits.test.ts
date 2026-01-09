/**
 * RED Phase Tests for Named Limits per API Key (Unkey Pattern)
 *
 * These tests define the expected behavior for API keys with multiple named limits.
 * Tests are designed to FAIL initially as the implementation does not exist yet.
 *
 * Related issue: dotdo-7p92 - [Red] Named limits tests (Unkey pattern)
 *
 * Named Limits Pattern:
 * - Each API key can have multiple named limits (e.g., 'api', 'ai', 'upload')
 * - Each named limit tracks usage independently
 * - Limits are defined in the API key configuration
 * - Different limits can have different refill windows and quotas
 *
 * Example API key with named limits:
 * ```typescript
 * const key = {
 *   limits: {
 *     api: { limit: 1000, refill: 'hourly' },
 *     ai: { limit: 100, refill: 'daily' }
 *   }
 * }
 * ```
 *
 * @module api/tests/middleware/named-limits.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Refill period options for rate limits
 */
type RefillPeriod = 'secondly' | 'minutely' | 'hourly' | 'daily' | 'monthly'

/**
 * Configuration for a single named limit
 */
interface NamedLimitConfig {
  /** Maximum requests/units allowed in the refill period */
  limit: number
  /** When the limit refills (resets) */
  refill: RefillPeriod
  /** Optional: remaining quota (for response) */
  remaining?: number
}

/**
 * API key configuration with named limits (Unkey pattern)
 */
interface ApiKeyWithLimits {
  /** Unique key identifier */
  id: string
  /** Key string (hashed in production) */
  key: string
  /** User/owner of this key */
  userId: string
  /** API key name for display */
  name?: string
  /** Named limits configuration */
  limits: Record<string, NamedLimitConfig>
  /** Key metadata */
  meta?: Record<string, unknown>
}

/**
 * Result from checking a named limit
 */
interface LimitCheckResult {
  /** Whether the request is allowed */
  valid: boolean
  /** Name of the limit that was checked */
  name: string
  /** Remaining quota after this request */
  remaining: number
  /** Total limit for this period */
  limit: number
  /** When the limit resets (epoch ms) */
  reset: number
}

/**
 * Interface for the named limits checker/manager
 */
interface NamedLimitsManager {
  /**
   * Check a named limit for an API key
   * @param keyId - The API key identifier
   * @param limitName - The name of the limit to check (e.g., 'api', 'ai')
   * @param cost - The cost of this request (default: 1)
   * @returns The limit check result
   */
  checkLimit(keyId: string, limitName: string, cost?: number): Promise<LimitCheckResult>

  /**
   * Get current status of all limits for a key (without consuming)
   * @param keyId - The API key identifier
   * @returns Map of limit names to their current status
   */
  getLimits(keyId: string): Promise<Record<string, LimitCheckResult>>

  /**
   * Get status of a specific limit (without consuming)
   * @param keyId - The API key identifier
   * @param limitName - The name of the limit
   * @returns The limit status or undefined if not configured
   */
  getLimit(keyId: string, limitName: string): Promise<LimitCheckResult | undefined>

  /**
   * Reset a specific limit for a key (admin operation)
   * @param keyId - The API key identifier
   * @param limitName - The name of the limit to reset
   */
  resetLimit(keyId: string, limitName: string): Promise<void>

  /**
   * Configure limits for an API key
   * @param keyId - The API key identifier
   * @param limits - The limits configuration
   */
  configureLimits(keyId: string, limits: Record<string, NamedLimitConfig>): Promise<void>
}

// ============================================================================
// MOCK IMPORTS (Will be replaced with real imports in GREEN phase)
// ============================================================================

// TODO: Import actual implementation in GREEN phase
// import { NamedLimitsManager, checkNamedLimit } from '../../middleware/named-limits'

// Placeholder for the implementation - will fail until implemented
function createNamedLimitsManager(): NamedLimitsManager {
  throw new Error('NamedLimitsManager not implemented yet')
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Converts refill period to milliseconds
 */
function refillToMs(refill: RefillPeriod): number {
  switch (refill) {
    case 'secondly':
      return 1000
    case 'minutely':
      return 60 * 1000
    case 'hourly':
      return 60 * 60 * 1000
    case 'daily':
      return 24 * 60 * 60 * 1000
    case 'monthly':
      return 30 * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown refill period: ${refill}`)
  }
}

// ============================================================================
// TESTS: TRACKS LIMITS INDEPENDENTLY BY NAME
// ============================================================================

describe('Named Limits: tracks limits independently by name', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks different named limits separately for the same key', async () => {
    // Configure an API key with two limits
    await manager.configureLimits('key-123', {
      api: { limit: 100, refill: 'hourly' },
      ai: { limit: 10, refill: 'hourly' },
    })

    // Use some of the 'api' limit
    await manager.checkLimit('key-123', 'api')
    await manager.checkLimit('key-123', 'api')
    await manager.checkLimit('key-123', 'api')

    // Use some of the 'ai' limit
    await manager.checkLimit('key-123', 'ai')

    // Check remaining for each limit - they should be independent
    const apiStatus = await manager.getLimit('key-123', 'api')
    const aiStatus = await manager.getLimit('key-123', 'ai')

    expect(apiStatus?.remaining).toBe(97) // 100 - 3
    expect(aiStatus?.remaining).toBe(9) // 10 - 1
  })

  it('exhausting one limit does not affect other limits', async () => {
    await manager.configureLimits('key-456', {
      api: { limit: 2, refill: 'hourly' },
      ai: { limit: 5, refill: 'hourly' },
    })

    // Exhaust the 'api' limit
    await manager.checkLimit('key-456', 'api')
    await manager.checkLimit('key-456', 'api')
    const apiBlocked = await manager.checkLimit('key-456', 'api')

    // 'api' should be blocked
    expect(apiBlocked.valid).toBe(false)
    expect(apiBlocked.remaining).toBe(0)

    // 'ai' should still have full quota
    const aiResult = await manager.checkLimit('key-456', 'ai')
    expect(aiResult.valid).toBe(true)
    expect(aiResult.remaining).toBe(4)
  })

  it('tracks multiple named limits with different refill periods', async () => {
    await manager.configureLimits('key-789', {
      burst: { limit: 10, refill: 'minutely' },
      standard: { limit: 1000, refill: 'hourly' },
      quota: { limit: 10000, refill: 'daily' },
    })

    // Use some of each limit
    await manager.checkLimit('key-789', 'burst', 5)
    await manager.checkLimit('key-789', 'standard', 100)
    await manager.checkLimit('key-789', 'quota', 500)

    const limits = await manager.getLimits('key-789')

    expect(limits.burst.remaining).toBe(5) // 10 - 5
    expect(limits.standard.remaining).toBe(900) // 1000 - 100
    expect(limits.quota.remaining).toBe(9500) // 10000 - 500
  })

  it('each limit has its own reset time based on refill period', async () => {
    const now = Date.now()

    await manager.configureLimits('key-reset', {
      minutely: { limit: 60, refill: 'minutely' },
      hourly: { limit: 1000, refill: 'hourly' },
    })

    await manager.checkLimit('key-reset', 'minutely')
    await manager.checkLimit('key-reset', 'hourly')

    const limits = await manager.getLimits('key-reset')

    // Minutely should reset in ~1 minute
    expect(limits.minutely.reset).toBeGreaterThan(now)
    expect(limits.minutely.reset).toBeLessThanOrEqual(now + refillToMs('minutely'))

    // Hourly should reset in ~1 hour
    expect(limits.hourly.reset).toBeGreaterThan(now)
    expect(limits.hourly.reset).toBeLessThanOrEqual(now + refillToMs('hourly'))
  })

  it('resetting one limit does not affect other limits', async () => {
    await manager.configureLimits('key-reset-test', {
      limit1: { limit: 10, refill: 'hourly' },
      limit2: { limit: 10, refill: 'hourly' },
    })

    // Use both limits
    await manager.checkLimit('key-reset-test', 'limit1', 5)
    await manager.checkLimit('key-reset-test', 'limit2', 5)

    // Reset only limit1
    await manager.resetLimit('key-reset-test', 'limit1')

    const limits = await manager.getLimits('key-reset-test')

    expect(limits.limit1.remaining).toBe(10) // Reset to full
    expect(limits.limit2.remaining).toBe(5) // Unchanged
  })
})

// ============================================================================
// TESTS: API AND AI LIMITS ARE SEPARATE
// ============================================================================

describe('Named Limits: api and ai limits are separate', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('api and ai have completely independent counters', async () => {
    await manager.configureLimits('key-api-ai', {
      api: { limit: 1000, refill: 'hourly' },
      ai: { limit: 100, refill: 'hourly' },
    })

    // Make 500 API calls
    for (let i = 0; i < 500; i++) {
      await manager.checkLimit('key-api-ai', 'api')
    }

    // AI should still have full quota
    const aiStatus = await manager.getLimit('key-api-ai', 'ai')
    expect(aiStatus?.remaining).toBe(100)
  })

  it('ai limit can be exhausted while api has remaining quota', async () => {
    await manager.configureLimits('key-ai-exhaust', {
      api: { limit: 1000, refill: 'hourly' },
      ai: { limit: 5, refill: 'hourly' },
    })

    // Exhaust AI limit
    for (let i = 0; i < 5; i++) {
      await manager.checkLimit('key-ai-exhaust', 'ai')
    }

    // AI should be blocked
    const aiBlocked = await manager.checkLimit('key-ai-exhaust', 'ai')
    expect(aiBlocked.valid).toBe(false)

    // API should still work
    const apiResult = await manager.checkLimit('key-ai-exhaust', 'api')
    expect(apiResult.valid).toBe(true)
    expect(apiResult.remaining).toBe(999)
  })

  it('api and ai can have different refill periods', async () => {
    await manager.configureLimits('key-diff-periods', {
      api: { limit: 100, refill: 'minutely' },
      ai: { limit: 1000, refill: 'daily' },
    })

    // Use some quota
    await manager.checkLimit('key-diff-periods', 'api', 50)
    await manager.checkLimit('key-diff-periods', 'ai', 500)

    // Advance time by 2 minutes (api should refill)
    vi.advanceTimersByTime(2 * 60 * 1000)

    // API should have refilled
    const apiStatus = await manager.getLimit('key-diff-periods', 'api')
    expect(apiStatus?.remaining).toBe(100)

    // AI should still have 500 remaining (daily refill)
    const aiStatus = await manager.getLimit('key-diff-periods', 'ai')
    expect(aiStatus?.remaining).toBe(500)
  })

  it('ai requests with token costs track separately from api calls', async () => {
    await manager.configureLimits('key-tokens', {
      api: { limit: 1000, refill: 'hourly' }, // 1 unit per request
      ai: { limit: 100000, refill: 'hourly' }, // Token-based
    })

    // Make 10 API calls (cost 1 each)
    for (let i = 0; i < 10; i++) {
      await manager.checkLimit('key-tokens', 'api', 1)
    }

    // Make 5 AI calls with varying token costs
    await manager.checkLimit('key-tokens', 'ai', 1000) // 1k tokens
    await manager.checkLimit('key-tokens', 'ai', 5000) // 5k tokens
    await manager.checkLimit('key-tokens', 'ai', 2500) // 2.5k tokens
    await manager.checkLimit('key-tokens', 'ai', 500) // 500 tokens
    await manager.checkLimit('key-tokens', 'ai', 3000) // 3k tokens

    const apiStatus = await manager.getLimit('key-tokens', 'api')
    const aiStatus = await manager.getLimit('key-tokens', 'ai')

    expect(apiStatus?.remaining).toBe(990) // 1000 - 10
    expect(aiStatus?.remaining).toBe(88000) // 100000 - 12000
  })

  it('error responses include which limit was exceeded', async () => {
    await manager.configureLimits('key-error-info', {
      api: { limit: 100, refill: 'hourly' },
      ai: { limit: 5, refill: 'hourly' },
    })

    // Exhaust AI
    for (let i = 0; i < 5; i++) {
      await manager.checkLimit('key-error-info', 'ai')
    }

    const result = await manager.checkLimit('key-error-info', 'ai')

    expect(result.valid).toBe(false)
    expect(result.name).toBe('ai')
    expect(result.limit).toBe(5)
    expect(result.remaining).toBe(0)
  })
})

// ============================================================================
// TESTS: APPLIES PER-KEY LIMITS FROM KEY DEFINITION
// ============================================================================

describe('Named Limits: applies per-key limits from key definition', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('different keys can have different limit configurations', async () => {
    // Free tier key
    await manager.configureLimits('free-key', {
      api: { limit: 100, refill: 'daily' },
      ai: { limit: 10, refill: 'daily' },
    })

    // Pro tier key
    await manager.configureLimits('pro-key', {
      api: { limit: 10000, refill: 'daily' },
      ai: { limit: 1000, refill: 'daily' },
    })

    // Enterprise tier key
    await manager.configureLimits('enterprise-key', {
      api: { limit: 1000000, refill: 'daily' },
      ai: { limit: 100000, refill: 'daily' },
    })

    // Check limits reflect per-key configuration
    const freeApi = await manager.getLimit('free-key', 'api')
    const proApi = await manager.getLimit('pro-key', 'api')
    const enterpriseApi = await manager.getLimit('enterprise-key', 'api')

    expect(freeApi?.limit).toBe(100)
    expect(proApi?.limit).toBe(10000)
    expect(enterpriseApi?.limit).toBe(1000000)
  })

  it('keys can have different named limits defined', async () => {
    // Basic key with only api limit
    await manager.configureLimits('basic-key', {
      api: { limit: 1000, refill: 'hourly' },
    })

    // Advanced key with api, ai, and upload limits
    await manager.configureLimits('advanced-key', {
      api: { limit: 10000, refill: 'hourly' },
      ai: { limit: 5000, refill: 'daily' },
      upload: { limit: 100, refill: 'daily' }, // 100 uploads per day
    })

    // Basic key should not have 'ai' or 'upload' limits
    const basicAi = await manager.getLimit('basic-key', 'ai')
    expect(basicAi).toBeUndefined()

    // Advanced key should have all limits
    const advancedLimits = await manager.getLimits('advanced-key')
    expect(advancedLimits.api).toBeDefined()
    expect(advancedLimits.ai).toBeDefined()
    expect(advancedLimits.upload).toBeDefined()
  })

  it('checking a limit that is not defined for a key returns error/undefined', async () => {
    await manager.configureLimits('limited-key', {
      api: { limit: 1000, refill: 'hourly' },
    })

    // Trying to check 'ai' limit which is not defined should fail gracefully
    const result = await manager.getLimit('limited-key', 'ai')
    expect(result).toBeUndefined()

    // Or checkLimit should indicate the limit doesn't exist
    await expect(manager.checkLimit('limited-key', 'ai')).rejects.toThrow()
  })

  it('usage is tracked per key, not globally', async () => {
    // Two keys with same limits
    await manager.configureLimits('user-A-key', {
      api: { limit: 100, refill: 'hourly' },
    })

    await manager.configureLimits('user-B-key', {
      api: { limit: 100, refill: 'hourly' },
    })

    // User A uses 50 requests
    for (let i = 0; i < 50; i++) {
      await manager.checkLimit('user-A-key', 'api')
    }

    // User B should still have full quota
    const userBStatus = await manager.getLimit('user-B-key', 'api')
    expect(userBStatus?.remaining).toBe(100)

    // User A should have 50 remaining
    const userAStatus = await manager.getLimit('user-A-key', 'api')
    expect(userAStatus?.remaining).toBe(50)
  })

  it('limit configurations can be updated for a key', async () => {
    // Start with free tier
    await manager.configureLimits('upgradeable-key', {
      api: { limit: 100, refill: 'daily' },
    })

    // Use some quota
    await manager.checkLimit('upgradeable-key', 'api', 50)

    // Upgrade to pro tier
    await manager.configureLimits('upgradeable-key', {
      api: { limit: 10000, refill: 'daily' },
      ai: { limit: 1000, refill: 'daily' },
    })

    // New limit should be applied
    const apiStatus = await manager.getLimit('upgradeable-key', 'api')
    expect(apiStatus?.limit).toBe(10000)

    // New limit type should be available
    const aiStatus = await manager.getLimit('upgradeable-key', 'ai')
    expect(aiStatus).toBeDefined()
    expect(aiStatus?.limit).toBe(1000)
  })

  it('respects custom limit names beyond api/ai', async () => {
    await manager.configureLimits('custom-limits-key', {
      requests: { limit: 1000, refill: 'hourly' },
      embeddings: { limit: 500, refill: 'hourly' },
      completions: { limit: 100, refill: 'hourly' },
      images: { limit: 10, refill: 'daily' },
      audio: { limit: 60, refill: 'daily' }, // 60 minutes of audio per day
    })

    const limits = await manager.getLimits('custom-limits-key')

    expect(Object.keys(limits)).toHaveLength(5)
    expect(limits.requests.limit).toBe(1000)
    expect(limits.embeddings.limit).toBe(500)
    expect(limits.completions.limit).toBe(100)
    expect(limits.images.limit).toBe(10)
    expect(limits.audio.limit).toBe(60)
  })
})

// ============================================================================
// TESTS: REFILL BEHAVIOR
// ============================================================================

describe('Named Limits: refill behavior', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('minutely limits refill after 1 minute', async () => {
    await manager.configureLimits('minutely-key', {
      burst: { limit: 10, refill: 'minutely' },
    })

    // Exhaust the limit
    for (let i = 0; i < 10; i++) {
      await manager.checkLimit('minutely-key', 'burst')
    }

    // Should be blocked
    expect((await manager.checkLimit('minutely-key', 'burst')).valid).toBe(false)

    // Advance 61 seconds
    vi.advanceTimersByTime(61 * 1000)

    // Should be allowed again
    const result = await manager.checkLimit('minutely-key', 'burst')
    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(9)
  })

  it('hourly limits refill after 1 hour', async () => {
    await manager.configureLimits('hourly-key', {
      api: { limit: 100, refill: 'hourly' },
    })

    // Exhaust the limit
    for (let i = 0; i < 100; i++) {
      await manager.checkLimit('hourly-key', 'api')
    }

    // Should be blocked
    expect((await manager.checkLimit('hourly-key', 'api')).valid).toBe(false)

    // Advance 30 minutes - still blocked
    vi.advanceTimersByTime(30 * 60 * 1000)
    expect((await manager.checkLimit('hourly-key', 'api')).valid).toBe(false)

    // Advance another 31 minutes (total 61 minutes)
    vi.advanceTimersByTime(31 * 60 * 1000)

    // Should be allowed again
    const result = await manager.checkLimit('hourly-key', 'api')
    expect(result.valid).toBe(true)
  })

  it('daily limits refill after 24 hours', async () => {
    await manager.configureLimits('daily-key', {
      ai: { limit: 1000, refill: 'daily' },
    })

    // Exhaust the limit
    await manager.checkLimit('daily-key', 'ai', 1000)

    // Should be blocked
    expect((await manager.checkLimit('daily-key', 'ai')).valid).toBe(false)

    // Advance 12 hours - still blocked
    vi.advanceTimersByTime(12 * 60 * 60 * 1000)
    expect((await manager.checkLimit('daily-key', 'ai')).valid).toBe(false)

    // Advance another 13 hours (total 25 hours)
    vi.advanceTimersByTime(13 * 60 * 60 * 1000)

    // Should be allowed again
    const result = await manager.checkLimit('daily-key', 'ai')
    expect(result.valid).toBe(true)
  })

  it('different limits within same key refill independently', async () => {
    await manager.configureLimits('multi-refill-key', {
      burst: { limit: 10, refill: 'minutely' },
      standard: { limit: 100, refill: 'hourly' },
    })

    // Exhaust both limits
    for (let i = 0; i < 10; i++) {
      await manager.checkLimit('multi-refill-key', 'burst')
    }
    for (let i = 0; i < 100; i++) {
      await manager.checkLimit('multi-refill-key', 'standard')
    }

    // Both blocked
    expect((await manager.checkLimit('multi-refill-key', 'burst')).valid).toBe(false)
    expect((await manager.checkLimit('multi-refill-key', 'standard')).valid).toBe(false)

    // Advance 2 minutes - burst should refill
    vi.advanceTimersByTime(2 * 60 * 1000)

    // Burst should be available, standard still blocked
    expect((await manager.checkLimit('multi-refill-key', 'burst')).valid).toBe(true)
    expect((await manager.checkLimit('multi-refill-key', 'standard')).valid).toBe(false)
  })
})

// ============================================================================
// TESTS: COST-BASED LIMITS
// ============================================================================

describe('Named Limits: cost-based consumption', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('default cost is 1', async () => {
    await manager.configureLimits('default-cost-key', {
      api: { limit: 10, refill: 'hourly' },
    })

    await manager.checkLimit('default-cost-key', 'api')
    const status = await manager.getLimit('default-cost-key', 'api')

    expect(status?.remaining).toBe(9) // 10 - 1
  })

  it('custom cost consumes multiple units', async () => {
    await manager.configureLimits('custom-cost-key', {
      tokens: { limit: 1000, refill: 'hourly' },
    })

    await manager.checkLimit('custom-cost-key', 'tokens', 250)
    const status = await manager.getLimit('custom-cost-key', 'tokens')

    expect(status?.remaining).toBe(750) // 1000 - 250
  })

  it('blocks when cost exceeds remaining', async () => {
    await manager.configureLimits('exceed-key', {
      tokens: { limit: 100, refill: 'hourly' },
    })

    // Use 80 tokens
    await manager.checkLimit('exceed-key', 'tokens', 80)

    // Try to use 30 more (only 20 remaining)
    const result = await manager.checkLimit('exceed-key', 'tokens', 30)

    expect(result.valid).toBe(false)
    expect(result.remaining).toBe(20)
  })

  it('allows request when cost exactly equals remaining', async () => {
    await manager.configureLimits('exact-key', {
      tokens: { limit: 100, refill: 'hourly' },
    })

    // Use 80 tokens
    await manager.checkLimit('exact-key', 'tokens', 80)

    // Use exactly remaining 20
    const result = await manager.checkLimit('exact-key', 'tokens', 20)

    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('rejects negative cost', async () => {
    await manager.configureLimits('negative-key', {
      api: { limit: 100, refill: 'hourly' },
    })

    await expect(manager.checkLimit('negative-key', 'api', -5)).rejects.toThrow()
  })

  it('handles zero cost (peek without consuming)', async () => {
    await manager.configureLimits('zero-cost-key', {
      api: { limit: 100, refill: 'hourly' },
    })

    // Zero cost should not consume
    const result = await manager.checkLimit('zero-cost-key', 'api', 0)

    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(100) // No consumption
  })
})

// ============================================================================
// TESTS: CONCURRENT ACCESS
// ============================================================================

describe('Named Limits: concurrent access', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles concurrent requests to same limit correctly', async () => {
    await manager.configureLimits('concurrent-key', {
      api: { limit: 10, refill: 'hourly' },
    })

    // Fire 20 concurrent requests
    const promises = Array(20)
      .fill(null)
      .map(() => manager.checkLimit('concurrent-key', 'api'))

    const results = await Promise.all(promises)

    const successes = results.filter((r) => r.valid).length
    const failures = results.filter((r) => !r.valid).length

    expect(successes).toBe(10)
    expect(failures).toBe(10)
  })

  it('handles concurrent requests to different limits correctly', async () => {
    await manager.configureLimits('multi-concurrent-key', {
      api: { limit: 5, refill: 'hourly' },
      ai: { limit: 3, refill: 'hourly' },
    })

    // Fire concurrent requests to both limits
    const promises = [
      ...Array(10)
        .fill(null)
        .map(() => manager.checkLimit('multi-concurrent-key', 'api')),
      ...Array(10)
        .fill(null)
        .map(() => manager.checkLimit('multi-concurrent-key', 'ai')),
    ]

    const results = await Promise.all(promises)

    const apiResults = results.slice(0, 10)
    const aiResults = results.slice(10, 20)

    expect(apiResults.filter((r) => r.valid).length).toBe(5)
    expect(aiResults.filter((r) => r.valid).length).toBe(3)
  })
})

// ============================================================================
// TESTS: EDGE CASES
// ============================================================================

describe('Named Limits: edge cases', () => {
  let manager: NamedLimitsManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    manager = createNamedLimitsManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles limit of 0 (all requests blocked)', async () => {
    await manager.configureLimits('zero-limit-key', {
      disabled: { limit: 0, refill: 'hourly' },
    })

    const result = await manager.checkLimit('zero-limit-key', 'disabled')

    expect(result.valid).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('handles very high limits', async () => {
    await manager.configureLimits('high-limit-key', {
      unlimited: { limit: 1000000000, refill: 'monthly' },
    })

    const result = await manager.checkLimit('high-limit-key', 'unlimited')

    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(999999999)
  })

  it('handles very high costs', async () => {
    await manager.configureLimits('high-cost-key', {
      bulk: { limit: 1000000000, refill: 'monthly' },
    })

    const result = await manager.checkLimit('high-cost-key', 'bulk', 500000000)

    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(500000000)
  })

  it('handles key IDs with special characters', async () => {
    const specialKeyId = 'key:user@example.com/api/v1?scope=all'

    await manager.configureLimits(specialKeyId, {
      api: { limit: 100, refill: 'hourly' },
    })

    const result = await manager.checkLimit(specialKeyId, 'api')

    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(99)
  })

  it('handles limit names with special characters', async () => {
    await manager.configureLimits('special-name-key', {
      'api:v1': { limit: 100, refill: 'hourly' },
      'ai.tokens': { limit: 1000, refill: 'hourly' },
    })

    const apiResult = await manager.checkLimit('special-name-key', 'api:v1')
    const aiResult = await manager.checkLimit('special-name-key', 'ai.tokens')

    expect(apiResult.valid).toBe(true)
    expect(aiResult.valid).toBe(true)
  })

  it('returns correct limit info in response for blocking', async () => {
    await manager.configureLimits('info-key', {
      api: { limit: 5, refill: 'hourly' },
    })

    // Exhaust limit
    for (let i = 0; i < 5; i++) {
      await manager.checkLimit('info-key', 'api')
    }

    const result = await manager.checkLimit('info-key', 'api')

    expect(result.valid).toBe(false)
    expect(result.name).toBe('api')
    expect(result.limit).toBe(5)
    expect(result.remaining).toBe(0)
    expect(result.reset).toBeGreaterThan(Date.now())
  })
})

// ============================================================================
// TESTS: HONO MIDDLEWARE INTEGRATION (conceptual)
// ============================================================================

describe('Named Limits: Hono middleware integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.skip('middleware checks appropriate limit based on route', async () => {
    // This test is conceptual and shows expected middleware behavior
    // Skip for now as it requires full middleware implementation

    const app = new Hono()

    // Middleware would:
    // 1. Extract API key from request
    // 2. Determine which limit to check based on route/operation
    // 3. Check the limit
    // 4. Return 429 if exceeded, otherwise continue

    // Example routes:
    // /api/* -> checks 'api' limit
    // /v1/ai/* -> checks 'ai' limit
    // /v1/upload -> checks 'upload' limit

    expect(true).toBe(true) // Placeholder
  })

  it.skip('middleware sets rate limit headers', async () => {
    // Expected headers:
    // X-RateLimit-Limit: 1000
    // X-RateLimit-Remaining: 999
    // X-RateLimit-Reset: 1704805200 (epoch timestamp)
    // X-RateLimit-Name: api (which limit was checked)

    expect(true).toBe(true) // Placeholder
  })
})
