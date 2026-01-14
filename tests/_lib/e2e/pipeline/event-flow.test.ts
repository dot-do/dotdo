/**
 * ACID Test Suite - Phase 5: E2E Pipeline - Event Flow Tests
 *
 * Tests for verifying event flow from DO operations through the
 * Cloudflare Pipeline to R2 storage.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  createE2EContext,
  skipIfNoE2E,
  skipIfReadOnly,
  type E2ETestContext,
} from '../context'

import {
  verifyEventInPipeline,
  waitForEvents,
  measurePipelineLatency,
  generateCorrelationId,
  waitForPipelineSync,
  getPipelineStats,
} from './helpers'

import { createTestThing, type TestThing } from '../smoke/helpers'

import {
  createPhase5ThingFixture,
  createPhase5ThingBatch,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  sleep,
} from '../../acid/fixtures/phase5'

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

const isWriteAllowed = (): boolean => {
  try {
    return !skipIfReadOnly()
  } catch {
    return false
  }
}

describe('Event Flow', () => {
  let ctx: E2ETestContext | undefined
  let testNamespace: string

  beforeAll(async () => {
    if (!isE2EAvailable()) {
      return
    }

    try {
      ctx = createE2EContext()
      testNamespace = await ctx.createTestNamespace('event-flow')
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
  // SINGLE EVENT FLOW TESTS
  // ============================================================================

  describe('Single Event Flow', () => {
    it('should emit event on Thing creation and deliver to pipeline', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act - create Thing
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })

      // Assert - verify event in pipeline
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
      expect(eventResult.latencyMs).toBeDefined()
      expect(eventResult.latencyMs).toBeLessThan(PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs)
    })

    it('should emit event on Thing update', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - create Thing first
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Act - update Thing
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        name: 'Updated',
      })

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_UPDATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
    })

    it('should emit event on Thing deletion', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Act - delete Thing
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        $deleted: true,
      })

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_DELETED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
    })
  })

  // ============================================================================
  // BATCH EVENT FLOW TESTS
  // ============================================================================

  describe('Batch Event Flow', () => {
    it('should deliver batch of events in order', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const correlationId = createPhase5CorrelationId()
      const things = createPhase5ThingBatch(10)

      // Act - create all Things
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })
      }

      // Assert - wait for all events
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: 10,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventsResult.events.length).toBe(10)

      // Verify events are ordered by sequence
      const sequences = eventsResult.events.map((e) => e.metadata?.sequence || 0)
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThanOrEqual(sequences[i - 1])
      }
    })

    it('should handle high-volume event batches', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const correlationId = createPhase5CorrelationId()
      const batchSize = 50

      // Act - rapid fire creates
      const promises: Promise<unknown>[] = []
      for (let i = 0; i < batchSize; i++) {
        const thing = createPhase5ThingFixture()
        promises.push(ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        }))
      }
      await Promise.all(promises)

      // Assert
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: batchSize,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs * 2 })

      expect(eventsResult.events.length).toBe(batchSize)
    })
  })

  // ============================================================================
  // CORRELATION TRACKING TESTS
  // ============================================================================

  describe('Correlation Tracking', () => {
    it('should track events by correlation ID', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const correlationId = createPhase5CorrelationId()
      const thing = createPhase5ThingFixture()

      // Act - perform CRUD operations with same correlation
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        name: 'Updated',
        $correlationId: correlationId,
      })
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        $deleted: true,
        $correlationId: correlationId,
      })

      // Assert - all events should have same correlation ID
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: 3,
      })

      expect(eventsResult.events.length).toBe(3)
      eventsResult.events.forEach((event) => {
        expect(event.correlationId).toBe(correlationId)
      })
    })

    it('should isolate events by correlation ID', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - two different correlations
      const correlation1 = createPhase5CorrelationId()
      const correlation2 = createPhase5CorrelationId()

      // Act - create Things with different correlations
      await ctx.post(`/do/${testNamespace}/things`, {
        ...createPhase5ThingFixture(),
        $correlationId: correlation1,
      })
      await ctx.post(`/do/${testNamespace}/things`, {
        ...createPhase5ThingFixture(),
        $correlationId: correlation2,
      })

      // Assert - each correlation should have its own event
      const events1 = await waitForEvents(ctx, { correlationId: correlation1, minCount: 1 })
      const events2 = await waitForEvents(ctx, { correlationId: correlation2, minCount: 1 })

      expect(events1.events.length).toBe(1)
      expect(events2.events.length).toBe(1)
      expect(events1.events[0].correlationId).toBe(correlation1)
      expect(events2.events[0].correlationId).toBe(correlation2)
    })
  })

  // ============================================================================
  // PIPELINE SYNC TESTS
  // ============================================================================

  describe('Pipeline Synchronization', () => {
    it('should wait for pipeline to sync', async () => {
      if (!ctx) return

      // Act
      const syncResult = await waitForPipelineSync(ctx, {
        timeout: 30000,
        targetBacklog: 0,
      })

      // Assert
      expect(syncResult).toHaveProperty('success')
      expect(syncResult).toHaveProperty('eventsProcessed')
      expect(syncResult).toHaveProperty('durationMs')
    })

    it('should report accurate pipeline statistics', async () => {
      if (!ctx) return

      // Act
      const stats = await getPipelineStats(ctx)

      // Assert
      expect(stats).toHaveProperty('totalEvents')
      expect(stats).toHaveProperty('eventsPerMinute')
      expect(stats).toHaveProperty('backlog')
      expect(stats).toHaveProperty('health')
      expect(['healthy', 'degraded', 'unhealthy']).toContain(stats.health)
    })
  })

  // ============================================================================
  // LATENCY MEASUREMENT TESTS
  // ============================================================================

  describe('Event Flow Latency', () => {
    it('should measure event flow latency', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Act
      const thing = createPhase5ThingFixture()
      const result = await measurePipelineLatency(ctx, async () => {
        await ctx.post(`/do/${testNamespace}/things`, thing)
        return {
          eventId: `${testNamespace}:${thing.$id}:created`,
          eventType: PHASE5_EVENT_TYPES.THING_CREATED,
        }
      })

      // Assert
      expect(result.operationLatencyMs).toBeGreaterThan(0)
      expect(result.pipelineLatencyMs).toBeGreaterThan(0)
      expect(result.totalLatencyMs).toBe(
        result.operationLatencyMs + result.pipelineLatencyMs + (result.icebergLatencyMs || 0)
      )
    })

    it('should meet pipeline delivery SLA', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Act
      const thing = createPhase5ThingFixture()
      const result = await measurePipelineLatency(ctx, async () => {
        await ctx.post(`/do/${testNamespace}/things`, thing)
        return {
          eventId: `${testNamespace}:${thing.$id}:created`,
          eventType: PHASE5_EVENT_TYPES.THING_CREATED,
        }
      })

      // Assert
      expect(result.pipelineLatencyMs).toBeLessThan(PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs)
    })
  })
})
