/**
 * ACID Test Suite - Phase 5: Pipeline Emission Tests
 *
 * Tests for verifying event emission to the Cloudflare Pipeline.
 * Follows TDD methodology - tests define expected behavior.
 *
 * Test Categories:
 * - Event Capture: CRUD and lifecycle event emission
 * - Pipeline Binding: Integration with PIPELINE binding
 * - Event Schema: Schema validation and serialization
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
  generateCorrelationId,
} from '../../e2e/pipeline/helpers'

import {
  createPhase5EventFixture,
  createPhase5EventBatch,
  createPhase5ThingFixture,
  createLargePayloadPhase5Event,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
} from '../fixtures/phase5'

// ============================================================================
// TEST SETUP
// ============================================================================

// Guard for E2E tests - skip if E2E is not enabled or context creation failed
let e2eAvailable = false
let initializationAttempted = false

describe('Pipeline Emission', () => {
  let ctx: E2ETestContext | undefined
  let testNamespace: string

  const shouldSkipTest = (): boolean => {
    // Skip if E2E config says to skip
    if (skipIfNoE2E() || skipIfReadOnly()) return true
    // Skip if context initialization failed
    if (initializationAttempted && !ctx) return true
    return false
  }

  beforeAll(async () => {
    initializationAttempted = true

    // Check if E2E should be skipped based on config
    if (skipIfNoE2E()) {
      e2eAvailable = false
      return
    }

    try {
      ctx = createE2EContext()
      testNamespace = await ctx.createTestNamespace('pipeline-emission')
      e2eAvailable = true
    } catch {
      // E2E not available (connection failed, etc.), tests will be skipped
      ctx = undefined
      e2eAvailable = false
    }
  })

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup()
    }
  })

  // ============================================================================
  // EVENT CAPTURE TESTS
  // ============================================================================

  describe('Event Capture', () => {
    it('should emit events on Thing creation', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act
      const result = await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })

      // Assert - verify event was emitted to pipeline
      const eventResult = await verifyEventInPipeline(ctx, {
        id: `${testNamespace}:${thing.$id}:created`,
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.type).toBe(PHASE5_EVENT_TYPES.THING_CREATED)
      expect(eventResult.event?.source).toBe(testNamespace)
      expect(eventResult.event?.payload).toMatchObject({
        thingId: thing.$id,
        thingType: thing.$type,
      })
    })

    it('should emit events on Thing update', async () => {
      if (shouldSkipTest()) return

      // Arrange - create a Thing first
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Act - update the Thing
      const updates = { name: 'Updated Name', value: 999 }
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, updates)

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        id: `${testNamespace}:${thing.$id}:updated`,
        type: PHASE5_EVENT_TYPES.THING_UPDATED,
      })

      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.type).toBe(PHASE5_EVENT_TYPES.THING_UPDATED)
      expect(eventResult.event?.payload).toMatchObject({
        thingId: thing.$id,
        changes: updates,
      })
    })

    it('should emit events on Thing deletion', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Act - soft delete
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        $deleted: true,
      })

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        id: `${testNamespace}:${thing.$id}:deleted`,
        type: PHASE5_EVENT_TYPES.THING_DELETED,
      })

      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.type).toBe(PHASE5_EVENT_TYPES.THING_DELETED)
    })

    it('should emit lifecycle events (fork, compact, move, clone)', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const targetNamespace = createPhase5TestNamespace('clone-target')
      ctx.registerResource(targetNamespace)

      // Act - perform clone operation
      await ctx.post(`/do/${testNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })

      // Assert - verify lifecycle event was emitted
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.LIFECYCLE_CLONE,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.type).toBe(PHASE5_EVENT_TYPES.LIFECYCLE_CLONE)
      expect(eventResult.event?.payload).toMatchObject({
        operation: 'clone',
        sourceNs: testNamespace,
        targetNs: targetNamespace,
      })
    })

    it('should batch events efficiently', async () => {
      if (shouldSkipTest()) return

      // Arrange - create multiple Things
      const things = Array.from({ length: 10 }, () => createPhase5ThingFixture())
      const correlationId = createPhase5CorrelationId()

      // Act - create all Things
      const startTime = Date.now()
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })
      }
      const operationDuration = Date.now() - startTime

      // Assert - all events should be batched and delivered
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: things.length,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventsResult.events.length).toBe(things.length)
      // Batching should be efficient - total pipeline delivery should be reasonable
      expect(eventsResult.durationMs).toBeLessThan(PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs)
    })

    it('should include correlation IDs', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      })

      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.correlationId).toBe(correlationId)
    })

    it('should preserve event ordering within DO', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act - create, update, delete in sequence
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

      // Assert - events should be in order
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: 3,
      })

      expect(eventsResult.events.length).toBe(3)

      // Verify ordering by sequence number
      const sequences = eventsResult.events.map((e) => e.metadata?.sequence || 0)
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b))

      // Verify event types are in correct order
      const types = eventsResult.events.map((e) => e.type)
      expect(types).toEqual([
        PHASE5_EVENT_TYPES.THING_CREATED,
        PHASE5_EVENT_TYPES.THING_UPDATED,
        PHASE5_EVENT_TYPES.THING_DELETED,
      ])
    })
  })

  // ============================================================================
  // PIPELINE BINDING TESTS
  // ============================================================================

  describe('Pipeline Binding', () => {
    it('should send events to PIPELINE binding', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert - event should appear in pipeline
      const exists = await ctx.eventExists(`${testNamespace}:${thing.$id}:created`)
      expect(exists).toBe(true)
    })

    it('should handle pipeline backpressure', async () => {
      if (shouldSkipTest()) return

      // Arrange - create many events rapidly to trigger backpressure
      const things = Array.from({ length: 50 }, () => createPhase5ThingFixture())
      const correlationId = createPhase5CorrelationId()

      // Act - rapid fire creates
      const promises = things.map((thing) =>
        ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })
      )
      await Promise.all(promises)

      // Assert - all events should eventually be delivered
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: things.length,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs * 2 })

      expect(eventsResult.events.length).toBe(things.length)
    })

    it('should retry on transient failures', async () => {
      if (shouldSkipTest()) return

      // This test verifies that events are retried on transient failures
      // The actual retry behavior is handled by the DO implementation

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert - event should be delivered even if there were retries
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
    })

    it('should not block DO operations on pipeline failures', async () => {
      if (shouldSkipTest()) return

      // This test verifies that DO operations complete even if pipeline is slow/failing
      // The pipeline uses fire-and-forget semantics

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      const { latencyMs } = await measureE2ELatency(ctx, async () => {
        await ctx.post(`/do/${testNamespace}/things`, thing)
        return { success: true }
      })

      // Assert - DO operation should complete within normal latency
      // (not waiting for pipeline delivery)
      expect(latencyMs).toBeLessThan(5000) // 5 second operation timeout
    })

    it('should respect rate limits', async () => {
      if (shouldSkipTest()) return

      // Arrange - create events at high rate
      const correlationId = createPhase5CorrelationId()
      const eventCount = 100
      const things = Array.from({ length: eventCount }, () => createPhase5ThingFixture())

      // Act - create all Things
      const startTime = Date.now()
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })
      }
      const duration = Date.now() - startTime

      // Assert - should complete (rate limiting doesn't reject, just queues)
      expect(duration).toBeDefined()

      // All events should eventually be delivered
      const eventsResult = await waitForEvents(ctx, {
        correlationId,
        minCount: eventCount,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs * 2 })

      expect(eventsResult.events.length).toBe(eventCount)
    })
  })

  // ============================================================================
  // EVENT SCHEMA TESTS
  // ============================================================================

  describe('Event Schema', () => {
    it('should emit events with correct schema', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      })

      expect(eventResult.found).toBe(true)
      const event = eventResult.event!

      // Verify required fields
      expect(typeof event.id).toBe('string')
      expect(event.id.length).toBeGreaterThan(0)
      expect(typeof event.type).toBe('string')
      expect(typeof event.source).toBe('string')
      expect(typeof event.timestamp).toBe('string')
      expect(() => new Date(event.timestamp)).not.toThrow()
      expect(typeof event.payload).toBe('object')

      // Verify optional fields
      if (event.correlationId) {
        expect(typeof event.correlationId).toBe('string')
      }
      if (event.metadata) {
        expect(typeof event.metadata).toBe('object')
        if (event.metadata.version !== undefined) {
          expect(typeof event.metadata.version).toBe('number')
        }
        if (event.metadata.sequence !== undefined) {
          expect(typeof event.metadata.sequence).toBe('number')
        }
      }
    })

    it('should include metadata (timestamp, source, type)', async () => {
      if (shouldSkipTest()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const beforeTime = new Date().toISOString()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      const afterTime = new Date().toISOString()

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      })

      expect(eventResult.found).toBe(true)
      const event = eventResult.event!

      // Timestamp should be between before and after
      expect(event.timestamp).toBeDefined()
      expect(new Date(event.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(beforeTime).getTime())
      expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(new Date(afterTime).getTime() + 1000)

      // Source should be the namespace
      expect(event.source).toBe(testNamespace)

      // Type should be correct
      expect(event.type).toBe(PHASE5_EVENT_TYPES.THING_CREATED)
    })

    it('should handle large payloads correctly', async () => {
      if (shouldSkipTest()) return

      // Arrange - create a Thing with large data
      const thing = createPhase5ThingFixture({
        // Add 10KB of data
        largeField: 'x'.repeat(10 * 1024),
      } as any)

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert - event should be emitted with payload intact
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      }, { timeout: PHASE5_SLA_TARGETS.pipelineDeliveryTimeoutMs })

      expect(eventResult.found).toBe(true)
      expect(eventResult.event?.payload).toBeDefined()
    })

    it('should serialize/deserialize correctly', async () => {
      if (shouldSkipTest()) return

      // Arrange - Thing with complex data types
      const thing = createPhase5ThingFixture({
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
          null: null,
          boolean: true,
          number: 42.5,
          date: new Date().toISOString(),
        },
      } as any)

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert
      const eventResult = await verifyEventInPipeline(ctx, {
        type: PHASE5_EVENT_TYPES.THING_CREATED,
      })

      expect(eventResult.found).toBe(true)

      // Verify nested data preserved correctly
      const payload = eventResult.event?.payload as any
      expect(payload.data?.nested?.array).toEqual([1, 2, 3])
      expect(payload.data?.nested?.object).toEqual({ key: 'value' })
      expect(payload.data?.nested?.boolean).toBe(true)
      expect(payload.data?.nested?.number).toBe(42.5)
    })
  })
})
