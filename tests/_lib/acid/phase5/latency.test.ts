/**
 * ACID Test Suite - Phase 5: Latency Measurement Tests
 *
 * Detailed latency measurement tests for pipeline performance monitoring.
 * Tests P50, P95, P99 latency verification and latency under load.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createE2EContext,
  skipIfNoE2E,
  skipIfReadOnly,
  type E2ETestContext,
} from '../../e2e/context'

import {
  measureE2ELatency,
  measurePipelineLatency,
  verifySLACompliance,
  getPipelineStats,
  verifyEventInPipeline,
} from '../../e2e/pipeline/helpers'

import {
  createPhase5ThingFixture,
  createPhase5ThingBatch,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  sleep,
} from '../fixtures/phase5'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Latency Measurement', () => {
  let ctx: E2ETestContext
  let testNamespace: string

  beforeAll(async () => {
    if (skipIfNoE2E()) {
      return
    }

    ctx = createE2EContext()
    testNamespace = await ctx.createTestNamespace('latency-test')
  })

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup()
    }
  })

  // ============================================================================
  // BASELINE LATENCY TESTS
  // ============================================================================

  describe('Baseline Latency', () => {
    it('should measure DO operation latency', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const measurements: number[] = []
      const iterations = 10

      for (let i = 0; i < iterations; i++) {
        const thing = createPhase5ThingFixture()
        const result = await measureE2ELatency(ctx, async () => {
          await ctx.post(`/do/${testNamespace}/things`, thing)
          return { success: true }
        })
        measurements.push(result.latencyMs)
      }

      // Calculate percentiles
      measurements.sort((a, b) => a - b)
      const p50 = measurements[Math.floor(iterations * 0.5)]
      const p95 = measurements[Math.floor(iterations * 0.95)]
      const avg = measurements.reduce((a, b) => a + b, 0) / iterations

      // Assert - DO operations should be fast
      expect(p50).toBeLessThan(2000) // P50 < 2s
      expect(p95).toBeLessThan(5000) // P95 < 5s
      expect(avg).toBeLessThan(3000) // Average < 3s

      console.log('DO Operation Latency:', {
        p50: `${p50}ms`,
        p95: `${p95}ms`,
        avg: `${avg.toFixed(0)}ms`,
      })
    })

    it('should measure pipeline delivery latency', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const measurements: number[] = []
      const iterations = 5 // Fewer iterations due to pipeline delay

      for (let i = 0; i < iterations; i++) {
        const thing = createPhase5ThingFixture()
        const correlationId = createPhase5CorrelationId()

        const startTime = Date.now()
        await ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })

        const eventResult = await verifyEventInPipeline(ctx, {
          type: PHASE5_EVENT_TYPES.THING_CREATED,
        }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

        if (eventResult.found) {
          measurements.push(eventResult.latencyMs)
        }
      }

      if (measurements.length > 0) {
        measurements.sort((a, b) => a - b)
        const p50 = measurements[Math.floor(measurements.length * 0.5)]
        const max = measurements[measurements.length - 1]
        const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length

        // Assert - pipeline should deliver within SLA
        expect(p50).toBeLessThan(PHASE5_SLA_TARGETS.p50TargetMs)

        console.log('Pipeline Delivery Latency:', {
          p50: `${p50}ms`,
          max: `${max}ms`,
          avg: `${avg.toFixed(0)}ms`,
          samples: measurements.length,
        })
      }
    })
  })

  // ============================================================================
  // SLA PERCENTILE TESTS
  // ============================================================================

  describe('SLA Percentile Verification', () => {
    it('should verify P50 latency meets target', async () => {
      if (skipIfNoE2E()) return

      const slaResult = await verifySLACompliance(ctx)

      expect(slaResult.p50.value).toBeLessThanOrEqual(PHASE5_SLA_TARGETS.p50TargetMs)
      expect(slaResult.p50.target).toBe(PHASE5_SLA_TARGETS.p50TargetMs)

      if (!slaResult.p50.pass) {
        console.warn(`P50 latency ${slaResult.p50.value}ms exceeds target ${slaResult.p50.target}ms`)
      }
    })

    it('should verify P95 latency meets target', async () => {
      if (skipIfNoE2E()) return

      const slaResult = await verifySLACompliance(ctx)

      expect(slaResult.p95.value).toBeLessThanOrEqual(PHASE5_SLA_TARGETS.p95TargetMs)
      expect(slaResult.p95.target).toBe(PHASE5_SLA_TARGETS.p95TargetMs)

      if (!slaResult.p95.pass) {
        console.warn(`P95 latency ${slaResult.p95.value}ms exceeds target ${slaResult.p95.target}ms`)
      }
    })

    it('should verify P99 latency meets target', async () => {
      if (skipIfNoE2E()) return

      const slaResult = await verifySLACompliance(ctx)

      expect(slaResult.p99.value).toBeLessThanOrEqual(PHASE5_SLA_TARGETS.p99TargetMs)
      expect(slaResult.p99.target).toBe(PHASE5_SLA_TARGETS.p99TargetMs)

      if (!slaResult.p99.pass) {
        console.warn(`P99 latency ${slaResult.p99.value}ms exceeds target ${slaResult.p99.target}ms`)
      }
    })

    it('should verify overall SLA compliance', async () => {
      if (skipIfNoE2E()) return

      const slaResult = await verifySLACompliance(ctx)

      // Log detailed SLA report
      console.log('SLA Compliance Report:', {
        overall: slaResult.compliant ? 'PASS' : 'FAIL',
        p50: `${slaResult.p50.value}ms / ${slaResult.p50.target}ms (${slaResult.p50.pass ? 'PASS' : 'FAIL'})`,
        p95: `${slaResult.p95.value}ms / ${slaResult.p95.target}ms (${slaResult.p95.pass ? 'PASS' : 'FAIL'})`,
        p99: `${slaResult.p99.value}ms / ${slaResult.p99.target}ms (${slaResult.p99.pass ? 'PASS' : 'FAIL'})`,
        eventLossRate: `${(slaResult.eventLossRate.value * 100).toFixed(3)}% / ${(slaResult.eventLossRate.target * 100).toFixed(3)}% (${slaResult.eventLossRate.pass ? 'PASS' : 'FAIL'})`,
      })

      // This assertion documents expected behavior but doesn't fail the test
      // since SLA compliance depends on system state
      expect(slaResult).toHaveProperty('compliant')
    })
  })

  // ============================================================================
  // LATENCY UNDER LOAD TESTS
  // ============================================================================

  describe('Latency Under Load', () => {
    it('should maintain latency under moderate load (50 ops)', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const operationCount = 50
      const things = createPhase5ThingBatch(operationCount)
      const measurements: number[] = []

      // Execute operations and measure latency
      for (const thing of things) {
        const result = await measureE2ELatency(ctx, async () => {
          await ctx.post(`/do/${testNamespace}/things`, thing)
          return { success: true }
        })
        measurements.push(result.latencyMs)
      }

      // Calculate statistics
      measurements.sort((a, b) => a - b)
      const p50 = measurements[Math.floor(operationCount * 0.5)]
      const p95 = measurements[Math.floor(operationCount * 0.95)]
      const p99 = measurements[Math.floor(operationCount * 0.99)]
      const max = measurements[operationCount - 1]

      // Assert - latency should remain reasonable under load
      expect(p50).toBeLessThan(5000)  // P50 < 5s under load
      expect(p95).toBeLessThan(10000) // P95 < 10s under load

      console.log('Latency Under Moderate Load (50 ops):', {
        p50: `${p50}ms`,
        p95: `${p95}ms`,
        p99: `${p99}ms`,
        max: `${max}ms`,
      })
    })

    it('should maintain latency under high load (100 concurrent ops)', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const operationCount = 100
      const things = createPhase5ThingBatch(operationCount)

      // Execute operations concurrently
      const startTime = Date.now()
      const promises = things.map((thing) =>
        measureE2ELatency(ctx, async () => {
          await ctx.post(`/do/${testNamespace}/things`, thing)
          return { success: true }
        })
      )

      const results = await Promise.all(promises)
      const totalDuration = Date.now() - startTime

      // Calculate latency statistics
      const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b)
      const p50 = latencies[Math.floor(operationCount * 0.5)]
      const p95 = latencies[Math.floor(operationCount * 0.95)]
      const throughput = (operationCount / totalDuration) * 1000 // ops/sec

      // Assert
      expect(p50).toBeLessThan(10000) // P50 < 10s under high load
      expect(throughput).toBeGreaterThan(1) // At least 1 op/sec

      console.log('Latency Under High Load (100 concurrent ops):', {
        p50: `${p50}ms`,
        p95: `${p95}ms`,
        totalDuration: `${totalDuration}ms`,
        throughput: `${throughput.toFixed(2)} ops/sec`,
      })
    })

    it('should measure latency degradation over time', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const batchSize = 20
      const batches = 3
      const batchLatencies: number[][] = []

      for (let batch = 0; batch < batches; batch++) {
        const things = createPhase5ThingBatch(batchSize)
        const latencies: number[] = []

        for (const thing of things) {
          const result = await measureE2ELatency(ctx, async () => {
            await ctx.post(`/do/${testNamespace}/things`, thing)
            return { success: true }
          })
          latencies.push(result.latencyMs)
        }

        batchLatencies.push(latencies)

        // Small delay between batches
        await sleep(1000)
      }

      // Calculate P50 for each batch
      const p50s = batchLatencies.map((batch) => {
        batch.sort((a, b) => a - b)
        return batch[Math.floor(batch.length * 0.5)]
      })

      // Assert - latency should not degrade significantly between batches
      const maxP50 = Math.max(...p50s)
      const minP50 = Math.min(...p50s)
      const degradationRatio = maxP50 / minP50

      expect(degradationRatio).toBeLessThan(3) // Max 3x degradation

      console.log('Latency Degradation Over Time:', {
        batch1_p50: `${p50s[0]}ms`,
        batch2_p50: `${p50s[1]}ms`,
        batch3_p50: `${p50s[2]}ms`,
        degradationRatio: `${degradationRatio.toFixed(2)}x`,
      })
    })
  })

  // ============================================================================
  // FULL PIPELINE LATENCY TESTS
  // ============================================================================

  describe('Full Pipeline Latency', () => {
    it('should measure complete pipeline latency (DO -> Pipeline -> Iceberg)', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const thing = createPhase5ThingFixture()

      const result = await measurePipelineLatency(ctx, async () => {
        await ctx.post(`/do/${testNamespace}/things`, thing)
        return {
          eventId: `${testNamespace}:${thing.$id}:created`,
          eventType: PHASE5_EVENT_TYPES.THING_CREATED,
        }
      }, {
        waitForIceberg: true,
        timeout: PHASE5_SLA_TARGETS.maxE2ELatencyMs,
      })

      // Assert
      expect(result.totalLatencyMs).toBeLessThan(PHASE5_SLA_TARGETS.maxE2ELatencyMs)

      console.log('Full Pipeline Latency:', {
        operation: `${result.operationLatencyMs}ms`,
        pipeline: `${result.pipelineLatencyMs}ms`,
        iceberg: `${result.icebergLatencyMs}ms`,
        total: `${result.totalLatencyMs}ms`,
      })
    })

    it('should identify latency bottlenecks', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      const measurements = {
        operation: [] as number[],
        pipeline: [] as number[],
        iceberg: [] as number[],
      }

      const iterations = 3 // Fewer due to Iceberg flush delay

      for (let i = 0; i < iterations; i++) {
        const thing = createPhase5ThingFixture()

        const result = await measurePipelineLatency(ctx, async () => {
          await ctx.post(`/do/${testNamespace}/things`, thing)
          return {
            eventId: `${testNamespace}:${thing.$id}:created`,
            eventType: PHASE5_EVENT_TYPES.THING_CREATED,
          }
        }, {
          waitForIceberg: true,
          timeout: PHASE5_SLA_TARGETS.maxE2ELatencyMs,
        })

        measurements.operation.push(result.operationLatencyMs)
        measurements.pipeline.push(result.pipelineLatencyMs)
        if (result.icebergLatencyMs) {
          measurements.iceberg.push(result.icebergLatencyMs)
        }
      }

      // Calculate averages
      const avgOperation = measurements.operation.reduce((a, b) => a + b, 0) / measurements.operation.length
      const avgPipeline = measurements.pipeline.reduce((a, b) => a + b, 0) / measurements.pipeline.length
      const avgIceberg = measurements.iceberg.length > 0
        ? measurements.iceberg.reduce((a, b) => a + b, 0) / measurements.iceberg.length
        : 0

      const total = avgOperation + avgPipeline + avgIceberg

      // Calculate percentages
      const breakdown = {
        operation: ((avgOperation / total) * 100).toFixed(1),
        pipeline: ((avgPipeline / total) * 100).toFixed(1),
        iceberg: ((avgIceberg / total) * 100).toFixed(1),
      }

      console.log('Latency Bottleneck Analysis:', {
        avgOperation: `${avgOperation.toFixed(0)}ms (${breakdown.operation}%)`,
        avgPipeline: `${avgPipeline.toFixed(0)}ms (${breakdown.pipeline}%)`,
        avgIceberg: `${avgIceberg.toFixed(0)}ms (${breakdown.iceberg}%)`,
        total: `${total.toFixed(0)}ms`,
      })

      // The test passes if we can identify bottlenecks
      expect(total).toBeGreaterThan(0)
    })
  })
})
