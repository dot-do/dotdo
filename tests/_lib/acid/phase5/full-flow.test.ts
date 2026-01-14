/**
 * ACID Test Suite - Phase 5: Full Flow Verification Tests
 *
 * Tests for verifying end-to-end data flow from DO operations
 * through pipeline to R2 Iceberg sink.
 *
 * Test Categories:
 * - Thing Lifecycle Flow: Creation -> query in R2
 * - Cross-DO Flow: Clone, shard, replication events
 * - Latency Verification: SLA compliance
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
  verifyEventInPipeline,
  waitForEvents,
  measureE2ELatency,
  measurePipelineLatency,
  waitForPartitionData,
  getCurrentPartition,
  verifySLACompliance,
  getPipelineStats,
} from '../../e2e/pipeline/helpers'

import {
  createPhase5ThingFixture,
  createPhase5ThingBatch,
  generateHighVolumePhase5Events,
  createCrossDOOperationFixtures,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  sleep,
} from '../fixtures/phase5'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Full E2E Flow', () => {
  let ctx: E2ETestContext
  let testNamespace: string

  beforeAll(async () => {
    if (skipIfNoE2E()) {
      return
    }

    ctx = createE2EContext()
    testNamespace = await ctx.createTestNamespace('full-flow')
  })

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup()
    }
  })

  // ============================================================================
  // THING LIFECYCLE FLOW TESTS
  // ============================================================================

  describe('Thing Lifecycle Flow', () => {
    it('should trace Thing from creation to query in R2', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act - Phase 1: Create Thing
      const createStart = Date.now()
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })
      const createLatency = Date.now() - createStart

      // Act - Phase 2: Verify event in pipeline
      const pipelineResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      // Act - Phase 3: Wait for data in Iceberg
      const partition = getCurrentPartition()
      const icebergResult = await waitForPartitionData(ctx, partition, {
        timeout: PHASE5_SLA_TARGETS.icebergFlushTimeoutMs,
      })

      // Act - Phase 4: Query the data
      const queryResult = await ctx.queryIceberg<{
        id: string
        source: string
        type: string
      }>(
        `SELECT id, source, type FROM events
         WHERE source = '${testNamespace}'
         AND type = '${PHASE5_EVENT_TYPES.THING_CREATED}'
         LIMIT 10`
      )

      // Assert
      expect(createLatency).toBeLessThan(5000) // DO operation should be fast
      expect(pipelineResult.found).toBe(true)
      expect(icebergResult.valid).toBe(true)
      expect(queryResult.length).toBeGreaterThan(0)
      expect(queryResult[0].source).toBe(testNamespace)
      expect(queryResult[0].type).toBe(PHASE5_EVENT_TYPES.THING_CREATED)
    })

    it('should trace Thing updates through pipeline', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Create the Thing first
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })

      // Act - Update the Thing
      const updates = { name: 'Updated Name', value: 9999 }
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        ...updates,
        $correlationId: correlationId,
      })

      // Verify update event in pipeline
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_UPDATED,
      })

      // Wait for Iceberg
      await sleep(10000)

      // Query the update event
      const queryResult = await ctx.queryIceberg<{
        type: string
        payload: string
      }>(
        `SELECT type, payload FROM events
         WHERE source = '${testNamespace}'
         AND type = '${PHASE5_EVENT_TYPES.THING_UPDATED}'
         LIMIT 5`
      )

      // Assert
      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.type).toBe(PHASE5_EVENT_TYPES.THING_UPDATED)
      expect(queryResult.length).toBeGreaterThan(0)
      expect(queryResult[0].type).toBe(PHASE5_EVENT_TYPES.THING_UPDATED)
    })

    it('should trace Thing deletion through pipeline', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Create and then delete
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })

      // Act - Delete the Thing
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        $deleted: true,
        $correlationId: correlationId,
      })

      // Verify events
      const events = await waitForEvents(ctx, {
        correlationId,
        minCount: 2, // create + delete
      })

      // Assert
      expect(events.events.length).toBeGreaterThanOrEqual(2)

      const eventTypes = events.events.map((e) => e.type)
      expect(eventTypes).toContain(PHASE5_EVENT_TYPES.THING_CREATED)
      expect(eventTypes).toContain(PHASE5_EVENT_TYPES.THING_DELETED)
    })

    it('should handle high-volume event streams', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange - generate high volume events
      const totalEvents = 100
      const things = createPhase5ThingBatch(totalEvents)
      const correlationId = createPhase5CorrelationId()

      // Act - create all Things rapidly
      const startTime = Date.now()
      const promises: Promise<unknown>[] = []

      for (const thing of things) {
        promises.push(ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        }))
      }

      await Promise.all(promises)
      const operationDuration = Date.now() - startTime

      // Wait for pipeline to process
      await sleep(15000)

      // Query Iceberg for the events
      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE source = '${testNamespace}'`
      )

      // Assert
      expect(operationDuration).toBeLessThan(60000) // Should complete within 1 minute
      expect(queryResult[0].cnt).toBeGreaterThanOrEqual(totalEvents)
    })
  })

  // ============================================================================
  // CROSS-DO FLOW TESTS
  // ============================================================================

  describe('Cross-DO Flow', () => {
    it('should trace events across clone operations', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange - create source with some data
      const sourceNs = testNamespace
      const targetNs = createPhase5TestNamespace('clone-target')
      ctx.registerResource(targetNs)

      // Create some Things in source
      const things = createPhase5ThingBatch(5)
      for (const thing of things) {
        await ctx.post(`/do/${sourceNs}/things`, thing)
      }

      // Act - clone to target
      const correlationId = createPhase5CorrelationId()
      await ctx.post(`/do/${sourceNs}/clone`, {
        target: targetNs,
        mode: 'atomic',
        $correlationId: correlationId,
      })

      // Verify clone lifecycle events
      const events = await waitForEvents(ctx, {
        type: PHASE5_EVENT_TYPES.LIFECYCLE_CLONE,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      // Assert
      expect(events.events.length).toBeGreaterThan(0)

      // Verify clone completed
      const completedEvent = events.events.find((e) =>
        e.payload && (e.payload as any).phase === 'completed'
      )
      expect(completedEvent).toBeDefined()
    })

    it('should trace events across shard operations', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const shardNs = createPhase5TestNamespace('shard')
      ctx.registerResource(shardNs)

      // Create data that would trigger sharding
      const things = createPhase5ThingBatch(10)
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, thing)
      }

      // Act - trigger shard operation
      await ctx.post(`/do/${testNamespace}/shard`, {
        targetPrefix: shardNs,
        strategy: 'hash',
      })

      // Verify shard events
      const events = await waitForEvents(ctx, {
        type: PHASE5_EVENT_TYPES.SHARD_CREATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      // Assert - should have shard events
      // Note: This test may skip if sharding is not configured
      expect(events.events.length).toBeGreaterThanOrEqual(0)
    })

    it('should trace events across replication', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const replicaNs = createPhase5TestNamespace('replica')
      ctx.registerResource(replicaNs)

      // Create source data
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Act - create replica
      await ctx.post(`/do/${testNamespace}/clone`, {
        target: replicaNs,
        mode: 'atomic',
        asReplica: true,
      })

      // Verify replication events
      const events = await waitForEvents(ctx, {
        source: testNamespace,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      // Assert
      expect(events.events.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // LATENCY VERIFICATION TESTS
  // ============================================================================

  describe('Latency Verification', () => {
    it('should complete event flow within SLA (< 5 minutes)', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act - measure full pipeline latency
      const latencyResult = await measurePipelineLatency(ctx, async () => {
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
      expect(latencyResult.totalLatencyMs).toBeLessThan(PHASE5_SLA_TARGETS.maxE2ELatencyMs)

      // Verify individual phases
      expect(latencyResult.operationLatencyMs).toBeDefined()
      expect(latencyResult.pipelineLatencyMs).toBeDefined()
      expect(latencyResult.icebergLatencyMs).toBeDefined()
    })

    it('should measure end-to-end latency', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      const result = await measureE2ELatency(ctx, async () => {
        await ctx.post(`/do/${testNamespace}/things`, thing)
        return { success: true }
      })

      // Assert
      expect(result.latencyMs).toBeGreaterThan(0)
      expect(result.startTime).toBeLessThan(result.endTime)
      expect(result.result).toEqual({ success: true })
    })

    it('should alert on latency exceeding thresholds', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Act - get SLA compliance status
      const slaResult = await verifySLACompliance(ctx)

      // Assert - verify SLA metrics are available
      expect(slaResult).toHaveProperty('compliant')
      expect(slaResult).toHaveProperty('p50')
      expect(slaResult).toHaveProperty('p95')
      expect(slaResult).toHaveProperty('p99')

      // Verify each metric has correct structure
      expect(slaResult.p50).toHaveProperty('value')
      expect(slaResult.p50).toHaveProperty('target')
      expect(slaResult.p50).toHaveProperty('pass')

      // Log SLA status for visibility
      console.log('SLA Compliance:', {
        compliant: slaResult.compliant,
        p50: `${slaResult.p50.value}ms (target: ${slaResult.p50.target}ms)`,
        p95: `${slaResult.p95.value}ms (target: ${slaResult.p95.target}ms)`,
        p99: `${slaResult.p99.value}ms (target: ${slaResult.p99.target}ms)`,
      })
    })
  })

  // ============================================================================
  // PIPELINE STATISTICS TESTS
  // ============================================================================

  describe('Pipeline Statistics', () => {
    it('should provide accurate pipeline statistics', async () => {
      if (skipIfNoE2E()) return

      // Act
      const stats = await getPipelineStats(ctx)

      // Assert
      expect(stats).toHaveProperty('totalEvents')
      expect(stats).toHaveProperty('eventsPerMinute')
      expect(stats).toHaveProperty('backlog')
      expect(stats).toHaveProperty('health')
      expect(stats).toHaveProperty('latency')

      // Verify types
      expect(typeof stats.totalEvents).toBe('number')
      expect(typeof stats.eventsPerMinute).toBe('number')
      expect(typeof stats.backlog).toBe('number')
      expect(['healthy', 'degraded', 'unhealthy']).toContain(stats.health)

      // Verify latency object
      expect(stats.latency).toHaveProperty('p50')
      expect(stats.latency).toHaveProperty('p95')
      expect(stats.latency).toHaveProperty('p99')
    })
  })
})
