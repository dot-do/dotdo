/**
 * RED Phase Tests for A/B Testing Metrics API ($.measure)
 *
 * These tests define the expected behavior of the $.measure() A/B testing
 * and metrics tracking system. They will FAIL until the implementation is created.
 *
 * The measure API provides:
 * - $.measure('metric_name').increment() - Increment a counter
 * - $.measure('metric_name').record(value) - Record a value (for gauges/histograms)
 * - $.measure('experiment_A').compare('experiment_B') - Compare two experiments
 *
 * Usage scenarios:
 * - A/B testing: Track conversions in different experiment branches
 * - Business metrics: Track clicks, signups, revenue
 * - Performance metrics: Track latencies, error rates
 *
 * @module workflows/tests/measure
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the measure API (will fail - module doesn't exist yet)
import {
  createMeasureContext,
  type MeasureContext,
  type MetricInstance,
  type MetricsCollection,
  type MockStorage,
  type ComparisonResult,
} from '../context/measure'

describe('A/B Testing Metrics API ($.measure)', () => {
  let ctx: MeasureContext

  beforeEach(() => {
    // Create a fresh context for each test
    ctx = createMeasureContext()
  })

  // ============================================================================
  // INCREMENT COUNTER
  // ============================================================================

  describe('$.measure(name).increment()', () => {
    it('increments a counter by 1 by default', async () => {
      await ctx.measure('button_clicks').increment()

      const value = await ctx.measure('button_clicks').value()
      expect(value).toBe(1)
    })

    it('increments by specified amount', async () => {
      await ctx.measure('page_views').increment(5)

      const value = await ctx.measure('page_views').value()
      expect(value).toBe(5)
    })

    it('accumulates multiple increments', async () => {
      await ctx.measure('signups').increment()
      await ctx.measure('signups').increment()
      await ctx.measure('signups').increment()

      const value = await ctx.measure('signups').value()
      expect(value).toBe(3)
    })

    it('handles concurrent increments correctly', async () => {
      await Promise.all([
        ctx.measure('concurrent').increment(),
        ctx.measure('concurrent').increment(),
        ctx.measure('concurrent').increment(),
        ctx.measure('concurrent').increment(),
        ctx.measure('concurrent').increment(),
      ])

      const value = await ctx.measure('concurrent').value()
      expect(value).toBe(5)
    })

    it('supports negative increments (decrements)', async () => {
      await ctx.measure('balance').increment(100)
      await ctx.measure('balance').increment(-30)

      const value = await ctx.measure('balance').value()
      expect(value).toBe(70)
    })

    it('increments with floating point values', async () => {
      await ctx.measure('revenue').increment(99.99)
      await ctx.measure('revenue').increment(49.99)

      const value = await ctx.measure('revenue').value()
      expect(value).toBeCloseTo(149.98, 2)
    })

    it('returns new value after increment', async () => {
      const result1 = await ctx.measure('counter').increment()
      const result2 = await ctx.measure('counter').increment(5)

      expect(result1).toBe(1)
      expect(result2).toBe(6)
    })
  })

  // ============================================================================
  // RECORD VALUE
  // ============================================================================

  describe('$.measure(name).record(value)', () => {
    it('records a single value', async () => {
      await ctx.measure('conversion_rate').record(0.15)

      const stats = await ctx.measure('conversion_rate').stats()
      expect(stats.count).toBe(1)
      expect(stats.last).toBe(0.15)
    })

    it('tracks min, max, avg for recorded values', async () => {
      await ctx.measure('latency_ms').record(100)
      await ctx.measure('latency_ms').record(200)
      await ctx.measure('latency_ms').record(150)

      const stats = await ctx.measure('latency_ms').stats()
      expect(stats.min).toBe(100)
      expect(stats.max).toBe(200)
      expect(stats.avg).toBeCloseTo(150, 2)
      expect(stats.count).toBe(3)
    })

    it('tracks sum of all recorded values', async () => {
      await ctx.measure('revenue').record(100)
      await ctx.measure('revenue').record(250)
      await ctx.measure('revenue').record(75)

      const stats = await ctx.measure('revenue').stats()
      expect(stats.sum).toBe(425)
    })

    it('handles recording zero', async () => {
      await ctx.measure('errors').record(0)
      await ctx.measure('errors').record(5)
      await ctx.measure('errors').record(0)

      const stats = await ctx.measure('errors').stats()
      expect(stats.min).toBe(0)
      expect(stats.count).toBe(3)
    })

    it('handles negative values', async () => {
      await ctx.measure('profit_loss').record(-50)
      await ctx.measure('profit_loss').record(100)
      await ctx.measure('profit_loss').record(-25)

      const stats = await ctx.measure('profit_loss').stats()
      expect(stats.min).toBe(-50)
      expect(stats.max).toBe(100)
      expect(stats.sum).toBe(25)
    })

    it('records with timestamp', async () => {
      const before = Date.now()
      await ctx.measure('timed_metric').record(42)
      const after = Date.now()

      const stats = await ctx.measure('timed_metric').stats()
      expect(stats.lastRecordedAt).toBeGreaterThanOrEqual(before)
      expect(stats.lastRecordedAt).toBeLessThanOrEqual(after)
    })

    it('returns recorded value', async () => {
      const result = await ctx.measure('response_time').record(123)
      expect(result).toBe(123)
    })
  })

  // ============================================================================
  // EXPERIMENT COMPARISON
  // ============================================================================

  describe('$.measure(experiment_A).compare(experiment_B)', () => {
    it('compares two metrics and returns comparison result', async () => {
      // Record data for experiment A (control)
      await ctx.measure('checkout_v1').record(100) // 100 conversions
      await ctx.measure('checkout_v1').record(95)
      await ctx.measure('checkout_v1').record(105)

      // Record data for experiment B (variant)
      await ctx.measure('checkout_v2').record(120)
      await ctx.measure('checkout_v2').record(115)
      await ctx.measure('checkout_v2').record(125)

      const result = await ctx.measure('checkout_v1').compare('checkout_v2')

      expect(result).toHaveProperty('baseline')
      expect(result).toHaveProperty('variant')
      expect(result).toHaveProperty('difference')
      expect(result).toHaveProperty('percentChange')
    })

    it('calculates correct percent change', async () => {
      // Baseline: 100 avg
      await ctx.measure('baseline').record(100)

      // Variant: 120 avg (20% increase)
      await ctx.measure('variant').record(120)

      const result = await ctx.measure('baseline').compare('variant')

      expect(result.percentChange).toBeCloseTo(20, 1)
    })

    it('handles negative percent change', async () => {
      // Baseline: 100 avg
      await ctx.measure('original').record(100)

      // Variant: 80 avg (20% decrease)
      await ctx.measure('new_version').record(80)

      const result = await ctx.measure('original').compare('new_version')

      expect(result.percentChange).toBeCloseTo(-20, 1)
    })

    it('compares counter metrics', async () => {
      await ctx.measure('clicks_A').increment(1000)
      await ctx.measure('clicks_B').increment(1200)

      const result = await ctx.measure('clicks_A').compare('clicks_B')

      expect(result.baseline.value).toBe(1000)
      expect(result.variant.value).toBe(1200)
      expect(result.difference).toBe(200)
    })

    it('includes statistical confidence (sample size)', async () => {
      // Record many samples for experiment A
      for (let i = 0; i < 100; i++) {
        await ctx.measure('exp_A').record(50 + Math.random() * 10)
      }

      // Record many samples for experiment B
      for (let i = 0; i < 100; i++) {
        await ctx.measure('exp_B').record(55 + Math.random() * 10)
      }

      const result = await ctx.measure('exp_A').compare('exp_B')

      expect(result.baseline.sampleSize).toBe(100)
      expect(result.variant.sampleSize).toBe(100)
    })

    it('returns null for nonexistent variant', async () => {
      await ctx.measure('existing').record(100)

      const result = await ctx.measure('existing').compare('nonexistent')

      expect(result.variant.value).toBeNull()
      expect(result.percentChange).toBeNull()
    })

    it('handles comparison with zero baseline', async () => {
      await ctx.measure('zero_baseline').increment(0)
      await ctx.measure('some_variant').increment(50)

      const result = await ctx.measure('zero_baseline').compare('some_variant')

      // Division by zero should be handled gracefully
      expect(result.percentChange).toBeNull() // or Infinity, depending on implementation
    })

    it('determines winner based on higher avg', async () => {
      await ctx.measure('control').record(100)
      await ctx.measure('treatment').record(120)

      const result = await ctx.measure('control').compare('treatment')

      expect(result.winner).toBe('variant')
    })

    it('returns tie when metrics are equal', async () => {
      await ctx.measure('equal_A').record(100)
      await ctx.measure('equal_B').record(100)

      const result = await ctx.measure('equal_A').compare('equal_B')

      expect(result.winner).toBe('tie')
    })
  })

  // ============================================================================
  // VALUE AND STATS
  // ============================================================================

  describe('$.measure(name).value() and $.measure(name).stats()', () => {
    it('value() returns 0 for non-existent metric', async () => {
      const value = await ctx.measure('never_recorded').value()
      expect(value).toBe(0)
    })

    it('stats() returns default stats for non-existent metric', async () => {
      const stats = await ctx.measure('never_recorded').stats()

      expect(stats.count).toBe(0)
      expect(stats.sum).toBe(0)
      expect(stats.min).toBeNull()
      expect(stats.max).toBeNull()
      expect(stats.avg).toBeNull()
    })

    it('value() returns sum for counter metrics', async () => {
      await ctx.measure('counter_metric').increment(10)
      await ctx.measure('counter_metric').increment(20)

      const value = await ctx.measure('counter_metric').value()
      expect(value).toBe(30)
    })

    it('value() returns last recorded value for record metrics', async () => {
      await ctx.measure('gauge_metric').record(100)
      await ctx.measure('gauge_metric').record(150)
      await ctx.measure('gauge_metric').record(120)

      const value = await ctx.measure('gauge_metric').value()
      // For recorded metrics, value() could return last, avg, or sum
      // Based on typical use cases, we'll return sum (total)
      expect(value).toBe(370)
    })
  })

  // ============================================================================
  // RESET AND CLEAR
  // ============================================================================

  describe('$.measure(name).reset()', () => {
    it('resets a counter to zero', async () => {
      await ctx.measure('resettable').increment(100)
      await ctx.measure('resettable').reset()

      const value = await ctx.measure('resettable').value()
      expect(value).toBe(0)
    })

    it('clears all recorded values', async () => {
      await ctx.measure('clearable').record(100)
      await ctx.measure('clearable').record(200)
      await ctx.measure('clearable').reset()

      const stats = await ctx.measure('clearable').stats()
      expect(stats.count).toBe(0)
      expect(stats.sum).toBe(0)
    })

    it('reset is idempotent', async () => {
      await ctx.measure('idempotent').increment(50)
      await ctx.measure('idempotent').reset()
      await ctx.measure('idempotent').reset()
      await ctx.measure('idempotent').reset()

      const value = await ctx.measure('idempotent').value()
      expect(value).toBe(0)
    })
  })

  // ============================================================================
  // METRICS COLLECTION
  // ============================================================================

  describe('$.metrics collection', () => {
    it('lists all metrics', async () => {
      await ctx.measure('metric_1').increment()
      await ctx.measure('metric_2').record(100)
      await ctx.measure('metric_3').increment(5)

      const metrics = await ctx.metrics.list()

      expect(metrics).toHaveLength(3)
      expect(metrics.map((m) => m.name)).toContain('metric_1')
      expect(metrics.map((m) => m.name)).toContain('metric_2')
      expect(metrics.map((m) => m.name)).toContain('metric_3')
    })

    it('fetches all metrics with their values', async () => {
      await ctx.measure('fetch_1').increment(10)
      await ctx.measure('fetch_2').record(25)

      const all = await ctx.metrics.fetch()

      expect(all['fetch_1'].value).toBe(10)
      expect(all['fetch_2'].sum).toBe(25)
    })

    it('clears all metrics', async () => {
      await ctx.measure('clear_1').increment(100)
      await ctx.measure('clear_2').record(200)

      await ctx.metrics.clear()

      const metrics = await ctx.metrics.list()
      expect(metrics).toHaveLength(0)
    })

    it('exports metrics in standard format', async () => {
      await ctx.measure('export_test').increment(42)

      const exported = await ctx.metrics.export()

      expect(exported).toBeInstanceOf(Array)
      expect(exported[0]).toHaveProperty('name', 'export_test')
      expect(exported[0]).toHaveProperty('value', 42)
      expect(exported[0]).toHaveProperty('timestamp')
    })
  })

  // ============================================================================
  // LABELS AND DIMENSIONS
  // ============================================================================

  describe('Metric labels/dimensions', () => {
    it('supports metrics with labels', async () => {
      await ctx.measure('http_requests', { method: 'GET', status: '200' }).increment()
      await ctx.measure('http_requests', { method: 'POST', status: '200' }).increment()
      await ctx.measure('http_requests', { method: 'GET', status: '404' }).increment()

      const getSuccess = await ctx.measure('http_requests', { method: 'GET', status: '200' }).value()
      const postSuccess = await ctx.measure('http_requests', { method: 'POST', status: '200' }).value()

      expect(getSuccess).toBe(1)
      expect(postSuccess).toBe(1)
    })

    it('treats different label combinations as different metrics', async () => {
      await ctx.measure('api_calls', { endpoint: '/users' }).increment(10)
      await ctx.measure('api_calls', { endpoint: '/orders' }).increment(5)

      const usersEndpoint = await ctx.measure('api_calls', { endpoint: '/users' }).value()
      const ordersEndpoint = await ctx.measure('api_calls', { endpoint: '/orders' }).value()

      expect(usersEndpoint).toBe(10)
      expect(ordersEndpoint).toBe(5)
    })

    it('label order does not matter', async () => {
      await ctx.measure('labeled', { a: '1', b: '2' }).increment()

      const value1 = await ctx.measure('labeled', { a: '1', b: '2' }).value()
      const value2 = await ctx.measure('labeled', { b: '2', a: '1' }).value()

      expect(value1).toBe(value2)
    })
  })

  // ============================================================================
  // EXPERIMENT CONTEXT
  // ============================================================================

  describe('Experiment context', () => {
    it('supports recording metrics for experiment branches', async () => {
      // Simulate A/B test recording
      const experimentId = 'checkout_redesign'
      const variantA = `${experimentId}:control`
      const variantB = `${experimentId}:treatment`

      // Record conversions for each variant
      await ctx.measure(variantA).increment() // User converted in control
      await ctx.measure(variantB).increment() // User converted in treatment
      await ctx.measure(variantB).increment() // Another user converted in treatment

      const controlConversions = await ctx.measure(variantA).value()
      const treatmentConversions = await ctx.measure(variantB).value()

      expect(controlConversions).toBe(1)
      expect(treatmentConversions).toBe(2)
    })

    it('compares experiment variants', async () => {
      await ctx.measure('exp:control').record(10)
      await ctx.measure('exp:variant_A').record(12)
      await ctx.measure('exp:variant_B').record(8)

      const resultA = await ctx.measure('exp:control').compare('exp:variant_A')
      const resultB = await ctx.measure('exp:control').compare('exp:variant_B')

      expect(resultA.percentChange).toBeCloseTo(20, 1)
      expect(resultB.percentChange).toBeCloseTo(-20, 1)
    })
  })

  // ============================================================================
  // PERSISTENCE AND STATE
  // ============================================================================

  describe('Persistence', () => {
    it('metrics persist across measure() calls', async () => {
      const instance1 = ctx.measure('persistent')
      await instance1.increment(10)

      const instance2 = ctx.measure('persistent')
      await instance2.increment(5)

      const value = await ctx.measure('persistent').value()
      expect(value).toBe(15)
    })

    it('exposes internal storage for testing', () => {
      expect(ctx._storage).toBeDefined()
      expect(ctx._storage.metrics).toBeInstanceOf(Map)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge cases', () => {
    it('handles empty metric name gracefully', async () => {
      // Should either throw or handle gracefully
      await expect(ctx.measure('').increment()).rejects.toThrow()
    })

    it('handles special characters in metric name', async () => {
      await ctx.measure('my-metric_name.with:special/chars').increment()

      const value = await ctx.measure('my-metric_name.with:special/chars').value()
      expect(value).toBe(1)
    })

    it('handles very large numbers', async () => {
      await ctx.measure('large').increment(Number.MAX_SAFE_INTEGER - 1)
      await ctx.measure('large').increment(1)

      const value = await ctx.measure('large').value()
      expect(value).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('handles NaN gracefully', async () => {
      await expect(ctx.measure('nan_test').record(NaN)).rejects.toThrow()
    })

    it('handles Infinity gracefully', async () => {
      await expect(ctx.measure('inf_test').record(Infinity)).rejects.toThrow()
    })
  })
})
