/**
 * RateLimiterDO Tests - Distributed Rate Limiting with Real Miniflare
 *
 * Tests for the RateLimiterDO Durable Object that provides distributed
 * rate limiting state storage using SQLite.
 *
 * NO MOCKS - uses real Miniflare runtime per CLAUDE.md philosophy.
 *
 * Coverage:
 * - Sliding window rate limiting
 * - Fixed window rate limiting
 * - Key reset functionality
 * - State observability
 * - Concurrent request handling
 *
 * @module api/tests/rate-limiter-do.test
 * @issue do-zab7.4 - Create missing RateLimiterDO module
 * @issue do-h6df - Rate limiter state not distributed across workers
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import type { RateLimitCheckParams, RateLimitCheckResult } from '../middleware/RateLimiterDO'
import { generateTestId } from '@dotdo/test-utils'

// ============================================================================
// TYPE DECLARATIONS
// ============================================================================

// Extend env type for RATE_LIMITER binding
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    RATE_LIMITER: DurableObjectNamespace
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// generateTestId imported from test-utils

/**
 * Get a RateLimiterDO stub by name
 */
function getRateLimiterStub(name: string = generateTestId()) {
  const id = env.RATE_LIMITER.idFromName(name)
  return env.RATE_LIMITER.get(id)
}

/**
 * Make a rate limit check request to the DO
 */
async function checkRateLimit(
  stub: DurableObjectStub,
  params: RateLimitCheckParams
): Promise<RateLimitCheckResult> {
  const response = await stub.fetch('https://rate-limiter/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  expect(response.ok).toBe(true)
  return response.json() as Promise<RateLimitCheckResult>
}

/**
 * Reset a rate limit key
 */
async function resetKey(stub: DurableObjectStub, key: string): Promise<void> {
  const response = await stub.fetch('https://rate-limiter/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })

  expect(response.ok).toBe(true)
}

/**
 * Get state for a key
 */
async function getState(stub: DurableObjectStub, key: string): Promise<{ found: boolean; requests?: number }> {
  const response = await stub.fetch(`https://rate-limiter/state/${encodeURIComponent(key)}`)
  expect(response.ok).toBe(true)
  return response.json() as Promise<{ found: boolean; requests?: number }>
}

// ============================================================================
// TESTS: BASIC FUNCTIONALITY
// ============================================================================

describe('RateLimiterDO', () => {
  describe('Health Check', () => {
    it('should respond to GET / with health status', async () => {
      const stub = getRateLimiterStub()
      const response = await stub.fetch('https://rate-limiter/')

      expect(response.status).toBe(200)

      const json = await response.json() as { status: string; type: string; id: string }
      expect(json.status).toBe('ok')
      expect(json.type).toBe('RateLimiterDO')
      expect(json.id).toBeDefined()
    })
  })

  describe('Sliding Window Rate Limiting', () => {
    it('should allow requests under the limit', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`

      const result = await checkRateLimit(stub, {
        key,
        windowMs: 60000,
        limit: 10,
        windowStrategy: 'sliding',
      })

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
      expect(result.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })

    it('should track remaining requests correctly', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`
      const limit = 5

      // Make requests and verify remaining decrements
      for (let i = 0; i < limit; i++) {
        const result = await checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(limit - i - 1)
      }
    })

    it('should deny requests when limit is exceeded', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`
      const limit = 3

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      }

      // Next request should be denied
      const result = await checkRateLimit(stub, {
        key,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfterMs).toBeDefined()
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('should isolate rate limits per key', async () => {
      const stub = getRateLimiterStub()
      const keyA = `tenant:${generateTestId()}-A`
      const keyB = `tenant:${generateTestId()}-B`
      const limit = 2

      // Exhaust limit for key A
      for (let i = 0; i < limit; i++) {
        await checkRateLimit(stub, {
          key: keyA,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      }

      // Key A should be rate limited
      const resultA = await checkRateLimit(stub, {
        key: keyA,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(resultA.allowed).toBe(false)

      // Key B should still be allowed
      const resultB = await checkRateLimit(stub, {
        key: keyB,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(resultB.allowed).toBe(true)
      expect(resultB.remaining).toBe(limit - 1)
    })
  })

  describe('Fixed Window Rate Limiting', () => {
    it('should allow requests under the limit', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`

      const result = await checkRateLimit(stub, {
        key,
        windowMs: 60000,
        limit: 10,
        windowStrategy: 'fixed',
      })

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it('should deny requests when limit is exceeded', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`
      const limit = 3

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'fixed',
        })
      }

      // Next request should be denied
      const result = await checkRateLimit(stub, {
        key,
        windowMs: 60000,
        limit,
        windowStrategy: 'fixed',
      })

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfterMs).toBeDefined()
    })
  })

  describe('Key Reset', () => {
    it('should reset rate limit state for a key', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`
      const limit = 2

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      }

      // Verify rate limited
      let result = await checkRateLimit(stub, {
        key,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(result.allowed).toBe(false)

      // Reset the key
      await resetKey(stub, key)

      // Should now be allowed with full quota
      result = await checkRateLimit(stub, {
        key,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(limit - 1)
    })

    it('should only reset the specified key', async () => {
      const stub = getRateLimiterStub()
      const keyA = `tenant:${generateTestId()}-A`
      const keyB = `tenant:${generateTestId()}-B`
      const limit = 2

      // Exhaust both keys
      for (let i = 0; i < limit; i++) {
        await checkRateLimit(stub, {
          key: keyA,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
        await checkRateLimit(stub, {
          key: keyB,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      }

      // Reset only key A
      await resetKey(stub, keyA)

      // Key A should be allowed
      const resultA = await checkRateLimit(stub, {
        key: keyA,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(resultA.allowed).toBe(true)

      // Key B should still be rate limited
      const resultB = await checkRateLimit(stub, {
        key: keyB,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(resultB.allowed).toBe(false)
    })
  })

  describe('State Observability', () => {
    it('should return state for an existing key', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`

      // Make some requests
      for (let i = 0; i < 3; i++) {
        await checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit: 10,
          windowStrategy: 'sliding',
        })
      }

      // Check state
      const state = await getState(stub, key)

      expect(state.found).toBe(true)
      expect(state.requests).toBe(3)
    })

    it('should return not found for unknown key', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:unknown-${generateTestId()}`

      const state = await getState(stub, key)

      expect(state.found).toBe(false)
    })
  })

  describe('Concurrent Requests', () => {
    it('should handle concurrent rate limit checks correctly', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`
      const limit = 10

      // Fire concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      )

      const results = await Promise.all(requests)

      // All should be allowed
      for (const result of results) {
        expect(result.allowed).toBe(true)
      }

      // Total count should be 5
      const state = await getState(stub, key)
      expect(state.requests).toBe(5)
    })

    it('should correctly enforce limits under concurrent load', async () => {
      const stub = getRateLimiterStub()
      const key = `tenant:${generateTestId()}`
      const limit = 5

      // Fire more concurrent requests than the limit
      const requests = Array.from({ length: 10 }, () =>
        checkRateLimit(stub, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      )

      const results = await Promise.all(requests)

      // Exactly 'limit' should be allowed
      const allowed = results.filter((r) => r.allowed).length
      const denied = results.filter((r) => !r.allowed).length

      expect(allowed).toBe(limit)
      expect(denied).toBe(5)
    })
  })

  describe('Different DO Instances', () => {
    it('should isolate state between different DO instances', async () => {
      const stubA = getRateLimiterStub('instance-A-' + generateTestId())
      const stubB = getRateLimiterStub('instance-B-' + generateTestId())
      const key = 'tenant:shared-key'
      const limit = 2

      // Exhaust limit on instance A
      for (let i = 0; i < limit; i++) {
        await checkRateLimit(stubA, {
          key,
          windowMs: 60000,
          limit,
          windowStrategy: 'sliding',
        })
      }

      // Instance A should be rate limited
      const resultA = await checkRateLimit(stubA, {
        key,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(resultA.allowed).toBe(false)

      // Instance B should have fresh state (different DO instance)
      const resultB = await checkRateLimit(stubB, {
        key,
        windowMs: 60000,
        limit,
        windowStrategy: 'sliding',
      })
      expect(resultB.allowed).toBe(true)
    })
  })
})
