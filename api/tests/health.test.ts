import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getHealthStatus,
  isSystemHealthy,
  type HealthStatus,
  type HealthStatusLevel,
} from '../utils/health'
import { clearNounConfigCache } from '../utils/router'
import type { Env } from '../types'

/**
 * Health Check Utility Tests
 *
 * These tests verify the health check utility functions:
 * - HealthStatus interface and response format
 * - Cache statistics inclusion
 * - Binding availability detection
 * - Status level determination (healthy/degraded/unhealthy)
 * - Response time requirements
 *
 * Note: Integration tests for the /health and /api/health endpoints
 * are in api/tests/routes/health.test.ts and require the Workers runtime.
 */

// ============================================================================
// MOCK ENVIRONMENT FACTORIES
// ============================================================================

/**
 * Create a fully configured mock environment with all bindings
 */
function createFullEnv(): Env {
  return {
    DO: createMockDO(),
    BROWSER_DO: createMockDO(),
    SANDBOX_DO: createMockDO(),
    OBS_BROADCASTER: createMockDO(),
    COLLECTION_DO: createMockDO(),
    REPLICA_DO: createMockDO(),
    KV: createMockKV(),
    R2: createMockR2(),
    AI: createMockAI(),
    TEST_KV: createMockKV(),
    TEST_DO: createMockDO(),
    ASSETS: createMockFetcher(),
  } as Env
}

/**
 * Create environment with only critical bindings (DO)
 */
function createMinimalEnv(): Env {
  return {
    DO: createMockDO(),
  } as Env
}

/**
 * Create environment missing the critical DO binding
 */
function createBrokenEnv(): Env {
  return {
    KV: createMockKV(),
    R2: createMockR2(),
  } as Env
}

/**
 * Create environment with critical bindings but missing important ones
 */
function createDegradedEnv(): Env {
  return {
    DO: createMockDO(),
    // Missing: BROWSER_DO, SANDBOX_DO, OBS_BROADCASTER, KV
  } as Env
}

// Mock helpers
function createMockDO(): DurableObjectNamespace {
  return {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'test-id' }),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      }),
    }),
  } as unknown as DurableObjectNamespace
}

function createMockKV(): KVNamespace {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as KVNamespace
}

function createMockR2(): R2Bucket {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
  } as unknown as R2Bucket
}

function createMockAI(): Ai {
  return {
    run: vi.fn(),
  } as unknown as Ai
}

function createMockFetcher(): Fetcher {
  return {
    fetch: vi.fn(),
  } as unknown as Fetcher
}

// ============================================================================
// TESTS
// ============================================================================

describe('Health Check', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure consistent state
    clearNounConfigCache()
    vi.clearAllMocks()
  })

  describe('getHealthStatus', () => {
    describe('Response Format', () => {
      it('returns correct HealthStatus interface', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        // Verify all required properties exist
        expect(health).toHaveProperty('status')
        expect(health).toHaveProperty('timestamp')
        expect(health).toHaveProperty('checks')
        expect(health.checks).toHaveProperty('cache')
        expect(health.checks).toHaveProperty('bindings')
      })

      it('returns valid ISO 8601 timestamp', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        // Timestamp should be a valid ISO 8601 date string
        const parsedDate = new Date(health.timestamp)
        expect(parsedDate.toISOString()).toBe(health.timestamp)
        expect(isNaN(parsedDate.getTime())).toBe(false)
      })

      it('includes version when provided', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env, '1.2.3')

        expect(health.version).toBe('1.2.3')
      })

      it('omits version when not provided', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        expect(health.version).toBeUndefined()
      })
    })

    describe('Cache Statistics', () => {
      it('includes cache size information', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        expect(health.checks.cache).toHaveProperty('size')
        expect(health.checks.cache).toHaveProperty('maxSize')
        expect(health.checks.cache).toHaveProperty('ttlMs')
        expect(typeof health.checks.cache.size).toBe('number')
        expect(typeof health.checks.cache.maxSize).toBe('number')
        expect(typeof health.checks.cache.ttlMs).toBe('number')
      })

      it('includes cache utilization percentage', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        expect(health.checks.cache).toHaveProperty('utilizationPercent')
        expect(health.checks.cache.utilizationPercent).toBeGreaterThanOrEqual(0)
        expect(health.checks.cache.utilizationPercent).toBeLessThanOrEqual(100)
      })

      it('cache status is ok when utilization is normal', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        // With empty cache, status should be 'ok'
        expect(health.checks.cache.status).toBe('ok')
      })

      it('includes correct cache TTL', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        // TTL should be 5 minutes (300000ms) based on router.ts constants
        expect(health.checks.cache.ttlMs).toBe(5 * 60 * 1000)
      })

      it('includes correct max size', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        // Max size should be 100 based on router.ts constants
        expect(health.checks.cache.maxSize).toBe(100)
      })
    })

    describe('Binding Availability', () => {
      it('reports all bindings when fully configured', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        expect(health.checks.bindings.DO).toBe(true)
        expect(health.checks.bindings.BROWSER_DO).toBe(true)
        expect(health.checks.bindings.SANDBOX_DO).toBe(true)
        expect(health.checks.bindings.OBS_BROADCASTER).toBe(true)
        expect(health.checks.bindings.COLLECTION_DO).toBe(true)
        expect(health.checks.bindings.REPLICA_DO).toBe(true)
        expect(health.checks.bindings.KV).toBe(true)
        expect(health.checks.bindings.R2).toBe(true)
        expect(health.checks.bindings.AI).toBe(true)
      })

      it('reports missing bindings correctly', async () => {
        const env = createMinimalEnv()
        const health = await getHealthStatus(env)

        expect(health.checks.bindings.DO).toBe(true)
        expect(health.checks.bindings.BROWSER_DO).toBe(false)
        expect(health.checks.bindings.SANDBOX_DO).toBe(false)
        expect(health.checks.bindings.OBS_BROADCASTER).toBe(false)
        expect(health.checks.bindings.KV).toBe(false)
        expect(health.checks.bindings.R2).toBe(false)
        expect(health.checks.bindings.AI).toBe(false)
      })

      it('detects missing critical DO binding', async () => {
        const env = createBrokenEnv()
        const health = await getHealthStatus(env)

        expect(health.checks.bindings.DO).toBe(false)
      })
    })

    describe('Health Status Determination', () => {
      it('returns healthy when all bindings present', async () => {
        const env = createFullEnv()
        const health = await getHealthStatus(env)

        expect(health.status).toBe('healthy')
      })

      it('returns unhealthy when critical DO binding is missing', async () => {
        const env = createBrokenEnv()
        const health = await getHealthStatus(env)

        expect(health.status).toBe('unhealthy')
      })

      it('returns degraded when important bindings are missing', async () => {
        const env = createDegradedEnv()
        const health = await getHealthStatus(env)

        expect(health.status).toBe('degraded')
      })

      it('status is never undefined', async () => {
        const testCases: Env[] = [
          createFullEnv(),
          createMinimalEnv(),
          createBrokenEnv(),
          createDegradedEnv(),
          {} as Env,
        ]

        for (const env of testCases) {
          const health = await getHealthStatus(env)
          expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status)
        }
      })
    })

    describe('Performance', () => {
      it('completes within 10ms', async () => {
        const env = createFullEnv()

        const start = performance.now()
        await getHealthStatus(env)
        const duration = performance.now() - start

        // Health check should be very fast (< 10ms)
        expect(duration).toBeLessThan(10)
      })

      it('does not make DO calls', async () => {
        const env = createFullEnv()
        const doBinding = env.DO as any

        await getHealthStatus(env)

        // Verify no DO operations were triggered
        expect(doBinding.idFromName).not.toHaveBeenCalled()
        expect(doBinding.get).not.toHaveBeenCalled()
      })
    })
  })

  describe('isSystemHealthy', () => {
    it('returns true when DO binding is present', () => {
      const env = createFullEnv()
      expect(isSystemHealthy(env)).toBe(true)
    })

    it('returns true with minimal environment (just DO)', () => {
      const env = createMinimalEnv()
      expect(isSystemHealthy(env)).toBe(true)
    })

    it('returns false when DO binding is missing', () => {
      const env = createBrokenEnv()
      expect(isSystemHealthy(env)).toBe(false)
    })

    it('returns false for empty environment', () => {
      const env = {} as Env
      expect(isSystemHealthy(env)).toBe(false)
    })
  })
})
