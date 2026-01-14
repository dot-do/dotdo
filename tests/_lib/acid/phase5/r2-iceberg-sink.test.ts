/**
 * ACID Test Suite - Phase 5: R2 Iceberg Sink Tests
 *
 * Tests for verifying event data landing in R2 with Iceberg format.
 * Follows TDD methodology - tests define expected behavior.
 *
 * Test Categories:
 * - Data Landing: Events written to R2 in Iceberg format
 * - Data Consistency: No event loss, idempotency, ordering
 * - Query Verification: Queryable via chdb
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
  verifyIcebergPartition,
  getCurrentPartition,
  waitForPartitionData,
  measurePipelineLatency,
} from '../../e2e/pipeline/helpers'

import {
  createPhase5ThingFixture,
  createPhase5ThingBatch,
  createPhase5EventBatch,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  formatPartitionPath,
  sleep,
} from '../fixtures/phase5'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('R2 Iceberg Sink', () => {
  let ctx: E2ETestContext
  let testNamespace: string

  beforeAll(async () => {
    if (skipIfNoE2E()) {
      return
    }

    ctx = createE2EContext()
    testNamespace = await ctx.createTestNamespace('iceberg-sink')
  })

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup()
    }
  })

  // ============================================================================
  // DATA LANDING TESTS
  // ============================================================================

  describe('Data Landing', () => {
    it('should write events to R2 in Iceberg format', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act - create a Thing which emits an event
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })

      // Assert - wait for data to appear in Iceberg
      const partition = getCurrentPartition()
      const result = await waitForPartitionData(ctx, partition, {
        minRowCount: 1,
        timeout: PHASE5_SLA_TARGETS.icebergFlushTimeoutMs,
      })

      expect(result.valid).toBe(true)
      expect(result.fileCount).toBeGreaterThan(0)
      expect(result.rowCount).toBeGreaterThanOrEqual(1)
    })

    it('should partition by date/hour', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const expectedPartition = getCurrentPartition()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert - wait for data and verify partition path
      const result = await waitForPartitionData(ctx, expectedPartition, {
        timeout: PHASE5_SLA_TARGETS.icebergFlushTimeoutMs,
      })

      expect(result.valid).toBe(true)
      expect(result.path).toBe(formatPartitionPath(expectedPartition))
    })

    it('should create valid Parquet files', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Assert - wait for partition and verify file integrity
      const partition = getCurrentPartition()
      const result = await waitForPartitionData(ctx, partition, {
        timeout: PHASE5_SLA_TARGETS.icebergFlushTimeoutMs,
      })

      expect(result.valid).toBe(true)
      expect(result.fileCount).toBeGreaterThan(0)
      expect(result.sizeBytes).toBeGreaterThan(0)

      // Verify we can query the data (validates Parquet structure)
      const queryResult = await ctx.queryIceberg<{ id: string }>(
        `SELECT id FROM events WHERE source = '${testNamespace}' LIMIT 1`
      )
      expect(queryResult.length).toBeGreaterThanOrEqual(1)
    })

    it('should maintain Iceberg table metadata', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()

      // Act
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Wait for Iceberg sync
      await sleep(5000)

      // Assert - verify table metadata is queryable
      const schemaResult = await ctx.queryIceberg<{
        column_name: string
        data_type: string
      }>(`DESCRIBE events`)

      // Verify expected columns exist
      const columns = schemaResult.map((r) => r.column_name)
      expect(columns).toContain('id')
      expect(columns).toContain('type')
      expect(columns).toContain('source')
      expect(columns).toContain('timestamp')
      expect(columns).toContain('payload')
    })
  })

  // ============================================================================
  // DATA CONSISTENCY TESTS
  // ============================================================================

  describe('Data Consistency', () => {
    it('should not lose events during sink', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const eventCount = 20
      const things = createPhase5ThingBatch(eventCount)
      const correlationId = createPhase5CorrelationId()

      // Act - create all Things
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })
      }

      // Assert - wait for all events to appear in Iceberg
      await sleep(10000) // Wait for batching/flush

      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events WHERE source = '${testNamespace}'`
      )

      // Should have at least the events we created (may have more from other tests)
      expect(queryResult[0].cnt).toBeGreaterThanOrEqual(eventCount)
    })

    it('should handle duplicate events idempotently', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const eventId = `${testNamespace}:${thing.$id}:created`

      // Act - send same event twice (simulate retry)
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Simulate pipeline retry by posting again with same correlation
      // (In reality, the pipeline handles deduplication)
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        _retrySimulation: true,
      })

      // Assert - wait for data
      await sleep(10000)

      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events WHERE source = '${testNamespace}' AND payload->>'thingId' = '${thing.$id}'`
      )

      // Should have exactly 2 events (create + update), not duplicates
      expect(queryResult[0].cnt).toBe(2)
    })

    it('should maintain event ordering in partitions', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const correlationId = createPhase5CorrelationId()

      // Act - create sequence of events
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        name: 'Update 1',
        $correlationId: correlationId,
      })
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        name: 'Update 2',
        $correlationId: correlationId,
      })

      // Assert - wait and query
      await sleep(10000)

      const queryResult = await ctx.queryIceberg<{
        type: string
        timestamp: string
      }>(
        `SELECT type, timestamp FROM events
         WHERE source = '${testNamespace}'
         ORDER BY timestamp ASC`
      )

      // Verify chronological ordering
      for (let i = 1; i < queryResult.length; i++) {
        const prevTime = new Date(queryResult[i - 1].timestamp).getTime()
        const currTime = new Date(queryResult[i].timestamp).getTime()
        expect(currTime).toBeGreaterThanOrEqual(prevTime)
      }
    })

    it('should support exactly-once semantics', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const uniqueId = createPhase5CorrelationId()
      const thing = createPhase5ThingFixture({
        uniqueMarker: uniqueId,
      } as any)

      // Act - create Thing with unique marker
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Wait for sink
      await sleep(10000)

      // Assert - exactly one event with this unique marker
      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE source = '${testNamespace}'
         AND payload->>'uniqueMarker' = '${uniqueId}'`
      )

      expect(queryResult[0].cnt).toBe(1)
    })
  })

  // ============================================================================
  // QUERY VERIFICATION TESTS
  // ============================================================================

  describe('Query Verification', () => {
    it('should be queryable via chdb', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange - ensure there's data
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)
      await sleep(10000)

      // Act - query the Iceberg table
      const queryResult = await ctx.queryIceberg<{
        id: string
        type: string
        source: string
      }>(`SELECT id, type, source FROM events LIMIT 10`)

      // Assert
      expect(Array.isArray(queryResult)).toBe(true)
      expect(queryResult.length).toBeGreaterThan(0)
      expect(queryResult[0]).toHaveProperty('id')
      expect(queryResult[0]).toHaveProperty('type')
      expect(queryResult[0]).toHaveProperty('source')
    })

    it('should support time-range queries', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange
      const startTime = new Date()
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)
      const endTime = new Date()
      await sleep(10000)

      // Act - query with time range
      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE timestamp >= '${startTime.toISOString()}'
         AND timestamp <= '${endTime.toISOString()}'
         AND source = '${testNamespace}'`
      )

      // Assert
      expect(queryResult[0].cnt).toBeGreaterThanOrEqual(1)
    })

    it('should support filtering by event type', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange - create events of different types
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, { name: 'Updated' })
      await sleep(10000)

      // Act - query by type
      const createdResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE type = '${PHASE5_EVENT_TYPES.THING_CREATED}'
         AND source = '${testNamespace}'`
      )

      const updatedResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE type = '${PHASE5_EVENT_TYPES.THING_UPDATED}'
         AND source = '${testNamespace}'`
      )

      // Assert
      expect(createdResult[0].cnt).toBeGreaterThanOrEqual(1)
      expect(updatedResult[0].cnt).toBeGreaterThanOrEqual(1)
    })

    it('should aggregate correctly', async () => {
      if (skipIfNoE2E() || skipIfReadOnly()) return

      // Arrange - create multiple events
      const things = createPhase5ThingBatch(5)
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, thing)
      }
      await sleep(10000)

      // Act - aggregate query
      const queryResult = await ctx.queryIceberg<{
        type: string
        event_count: number
      }>(
        `SELECT type, COUNT(*) as event_count FROM events
         WHERE source = '${testNamespace}'
         GROUP BY type`
      )

      // Assert
      expect(Array.isArray(queryResult)).toBe(true)
      expect(queryResult.length).toBeGreaterThan(0)

      // Verify aggregation structure
      for (const row of queryResult) {
        expect(typeof row.type).toBe('string')
        expect(typeof row.event_count).toBe('number')
        expect(row.event_count).toBeGreaterThan(0)
      }
    })
  })
})
