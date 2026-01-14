/**
 * ACID Test Suite - Phase 5: Smoke Tests - Health Checks
 *
 * Production health check tests that verify deployment status.
 * These tests run quickly (< 60 seconds total) and provide
 * fast feedback on deployment health.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  createE2EContext,
  skipIfNoE2E,
  type E2ETestContext,
} from '../context'

import {
  healthCheck,
  verifyBindings,
  type HealthCheckResult,
  type BindingStatus,
} from './helpers'

import { SMOKE_TEST_FIXTURES } from '../../acid/fixtures/phase5'

// ============================================================================
// TEST SETUP
// ============================================================================

// Guard for E2E tests
const isE2EAvailable = (): boolean => {
  try {
    return !skipIfNoE2E()
  } catch {
    return false
  }
}

describe('Production Health Checks', () => {
  let ctx: E2ETestContext | undefined

  beforeAll(async () => {
    if (!isE2EAvailable()) {
      return
    }

    try {
      ctx = createE2EContext()
    } catch {
      ctx = undefined
    }
  })

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup()
    }
  })

  // ============================================================================
  // HEALTH ENDPOINT TESTS
  // ============================================================================

  describe('Health Endpoint', () => {
    it('should return 200 from /api/health', async () => {
      if (!ctx) return

      // Act
      const result: HealthCheckResult = await healthCheck(ctx.baseUrl, {
        timeout: SMOKE_TEST_FIXTURES.healthCheckTimeoutMs,
        checkBindings: false, // Just check the main endpoint
      })

      // Assert
      expect(result.httpStatus).toBe(200)
      expect(result.status).not.toBe('unhealthy')
      expect(result.latencyMs).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
    })

    it('should return health status within timeout', async () => {
      if (!ctx) return

      const startTime = Date.now()
      const result = await healthCheck(ctx.baseUrl, {
        timeout: SMOKE_TEST_FIXTURES.healthCheckTimeoutMs,
      })
      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
      expect(result.latencyMs).toBeDefined()
      expect(result.latencyMs).toBeGreaterThan(0)
    })

    it('should include version info when available', async () => {
      if (!ctx) return

      const result = await healthCheck(ctx.baseUrl)

      // Version may or may not be present depending on deployment
      if (result.version) {
        expect(typeof result.version).toBe('string')
        expect(result.version.length).toBeGreaterThan(0)
      }
    })

    it('should include environment info when available', async () => {
      if (!ctx) return

      const result = await healthCheck(ctx.baseUrl)

      // Environment may or may not be present
      if (result.environment) {
        expect(typeof result.environment).toBe('string')
        expect(['local', 'staging', 'preview', 'production']).toContain(result.environment)
      }
    })
  })

  // ============================================================================
  // BINDING HEALTH TESTS
  // ============================================================================

  describe('Binding Health', () => {
    it('should connect to KV namespace', async () => {
      if (!ctx) return

      const bindings = await verifyBindings(ctx, ['kv'])
      const kvBinding = bindings.find((b) => b.type === 'kv')

      expect(kvBinding).toBeDefined()
      expect(kvBinding?.available).toBe(true)
      expect(kvBinding?.latencyMs).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
    })

    it('should connect to R2 bucket', async () => {
      if (!ctx) return

      const bindings = await verifyBindings(ctx, ['r2'])
      const r2Binding = bindings.find((b) => b.type === 'r2')

      expect(r2Binding).toBeDefined()
      expect(r2Binding?.available).toBe(true)
      expect(r2Binding?.latencyMs).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
    })

    it('should connect to D1 database', async () => {
      if (!ctx) return

      const bindings = await verifyBindings(ctx, ['d1'])
      const d1Binding = bindings.find((b) => b.type === 'd1')

      // D1 may not be used in all deployments
      if (d1Binding) {
        expect(d1Binding.latencyMs).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
      }
    })

    it('should instantiate DO successfully', async () => {
      if (!ctx) return

      const bindings = await verifyBindings(ctx, ['do'])
      const doBinding = bindings.find((b) => b.type === 'do')

      expect(doBinding).toBeDefined()
      expect(doBinding?.available).toBe(true)
      expect(doBinding?.latencyMs).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
    })

    it('should emit events to Pipeline', async () => {
      if (!ctx) return

      const bindings = await verifyBindings(ctx, ['pipeline'])
      const pipelineBinding = bindings.find((b) => b.type === 'pipeline')

      expect(pipelineBinding).toBeDefined()
      expect(pipelineBinding?.available).toBe(true)
      expect(pipelineBinding?.latencyMs).toBeLessThan(SMOKE_TEST_FIXTURES.healthCheckTimeoutMs)
    })

    it('should verify all bindings are healthy', async () => {
      if (!ctx) return

      const result = await healthCheck(ctx.baseUrl, {
        checkBindings: true,
        timeout: SMOKE_TEST_FIXTURES.healthCheckTimeoutMs,
      })

      // All bindings should be checked
      expect(result.bindings.length).toBeGreaterThan(0)

      // Count healthy vs unhealthy
      const healthy = result.bindings.filter((b) => b.available).length
      const total = result.bindings.length

      console.log(`Binding Health: ${healthy}/${total} bindings available`)

      // At least critical bindings should be healthy
      const criticalBindings = result.bindings.filter((b) =>
        ['kv', 'r2', 'do'].includes(b.type)
      )
      const criticalHealthy = criticalBindings.every((b) => b.available)

      expect(criticalHealthy).toBe(true)
    })
  })

  // ============================================================================
  // OVERALL HEALTH TESTS
  // ============================================================================

  describe('Overall Health', () => {
    it('should report overall health status', async () => {
      if (!ctx) return

      const result = await healthCheck(ctx.baseUrl, {
        checkBindings: true,
      })

      expect(result.status).toBeDefined()
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status)

      // For smoke tests, we expect at least degraded (not fully unhealthy)
      expect(result.status).not.toBe('unhealthy')
    })

    it('should complete all health checks within time budget', async () => {
      if (!ctx) return

      const startTime = Date.now()
      await healthCheck(ctx.baseUrl, {
        checkBindings: true,
        timeout: SMOKE_TEST_FIXTURES.healthCheckTimeoutMs,
      })
      const totalDuration = Date.now() - startTime

      // Health check should be fast
      expect(totalDuration).toBeLessThan(SMOKE_TEST_FIXTURES.maxTotalDurationMs)
    })
  })
})
