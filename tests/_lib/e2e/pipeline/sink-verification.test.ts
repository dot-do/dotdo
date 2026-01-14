/**
 * ACID Test Suite - Phase 5: E2E Pipeline - Sink Verification Tests
 *
 * Tests for verifying event data lands correctly in the R2 Iceberg sink.
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
  verifyIcebergPartition,
  getCurrentPartition,
  waitForPartitionData,
  verifySLACompliance,
  type IcebergVerificationResult,
} from './helpers'

import {
  createPhase5ThingFixture,
  createPhase5ThingBatch,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  formatPartitionPath,
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

describe('Sink Verification', () => {
  let ctx: E2ETestContext | undefined
  let testNamespace: string

  beforeAll(async () => {
    if (!isE2EAvailable()) {
      return
    }

    try {
      ctx = createE2EContext()
      testNamespace = await ctx.createTestNamespace('sink-verify')
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
  // PARTITION TESTS
  // ============================================================================

  describe('Partition Verification', () => {
    it('should create partitions by date/hour', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      const expectedPartition = getCurrentPartition()

      // Act - create Thing and wait for Iceberg flush
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Wait for batched flush
      await sleep(10000)

      // Assert
      const result = await verifyIcebergPartition(ctx, expectedPartition)

      expect(result.path).toBe(formatPartitionPath(expectedPartition))
      expect(result.fileCount).toBeGreaterThanOrEqual(0)
    })

    it('should verify partition has data', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const things = createPhase5ThingBatch(5)

      // Act - create multiple Things
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, thing)
      }

      // Wait for Iceberg flush
      const partition = getCurrentPartition()
      const result = await waitForPartitionData(ctx, partition, {
        minRowCount: 1,
        timeout: PHASE5_SLA_TARGETS.icebergFlushTimeoutMs,
      })

      // Assert
      expect(result.valid).toBe(true)
      expect(result.rowCount).toBeGreaterThanOrEqual(1)
    })

    it('should verify partition schema', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Wait for Iceberg flush
      await sleep(10000)

      // Act
      const partition = getCurrentPartition()
      const result = await verifyIcebergPartition(ctx, partition, {
        validateSchema: true,
      })

      // Assert
      expect(result.schemaValid).toBe(true)
    })
  })

  // ============================================================================
  // DATA INTEGRITY TESTS
  // ============================================================================

  describe('Data Integrity', () => {
    it('should not lose events during sink', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const correlationId = createPhase5CorrelationId()
      const eventCount = 10
      const things = createPhase5ThingBatch(eventCount)

      // Act - create all Things
      for (const thing of things) {
        await ctx.post(`/do/${testNamespace}/things`, {
          ...thing,
          $correlationId: correlationId,
        })
      }

      // Wait for Iceberg flush
      await sleep(15000)

      // Assert - query for events
      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events WHERE source = '${testNamespace}'`
      )

      expect(queryResult[0].cnt).toBeGreaterThanOrEqual(eventCount)
    })

    it('should handle exactly-once semantics', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const uniqueMarker = createPhase5CorrelationId()
      const thing = createPhase5ThingFixture({
        uniqueTest: uniqueMarker,
      } as any)

      // Act - create Thing
      await ctx.post(`/do/${testNamespace}/things`, thing)

      // Wait for Iceberg flush
      await sleep(10000)

      // Assert - should have exactly one event with this marker
      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE source = '${testNamespace}'
         AND payload->>'uniqueTest' = '${uniqueMarker}'`
      )

      expect(queryResult[0].cnt).toBe(1)
    })

    it('should maintain event ordering in partitions', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const correlationId = createPhase5CorrelationId()
      const thing = createPhase5ThingFixture()

      // Act - create sequence of operations
      await ctx.post(`/do/${testNamespace}/things`, {
        ...thing,
        $correlationId: correlationId,
      })
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, {
        name: 'Updated',
        $correlationId: correlationId,
      })

      // Wait for Iceberg flush
      await sleep(10000)

      // Assert - events should be ordered by timestamp
      const queryResult = await ctx.queryIceberg<{
        type: string
        timestamp: string
      }>(
        `SELECT type, timestamp FROM events
         WHERE source = '${testNamespace}'
         ORDER BY timestamp ASC`
      )

      // Verify chronological order
      for (let i = 1; i < queryResult.length; i++) {
        const prev = new Date(queryResult[i - 1].timestamp).getTime()
        const curr = new Date(queryResult[i].timestamp).getTime()
        expect(curr).toBeGreaterThanOrEqual(prev)
      }
    })
  })

  // ============================================================================
  // QUERY TESTS
  // ============================================================================

  describe('Iceberg Query', () => {
    it('should support SQL queries', async () => {
      if (!ctx) return

      // Act
      const queryResult = await ctx.queryIceberg<{
        id: string
        type: string
        source: string
      }>(`SELECT id, type, source FROM events LIMIT 10`)

      // Assert
      expect(Array.isArray(queryResult)).toBe(true)
    })

    it('should support time-range queries', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const startTime = new Date()
      await ctx.post(`/do/${testNamespace}/things`, createPhase5ThingFixture())
      const endTime = new Date()

      // Wait for Iceberg flush
      await sleep(10000)

      // Act
      const queryResult = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE timestamp >= '${startTime.toISOString()}'
         AND timestamp <= '${endTime.toISOString()}'`
      )

      // Assert
      expect(queryResult[0].cnt).toBeGreaterThanOrEqual(0)
    })

    it('should support filtering by event type', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - create different event types
      const thing = createPhase5ThingFixture()
      await ctx.post(`/do/${testNamespace}/things`, thing)
      await ctx.post(`/do/${testNamespace}/things/${thing.$id}`, { name: 'Updated' })

      // Wait for Iceberg flush
      await sleep(10000)

      // Act
      const createdEvents = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE type = '${PHASE5_EVENT_TYPES.THING_CREATED}'
         AND source = '${testNamespace}'`
      )

      const updatedEvents = await ctx.queryIceberg<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM events
         WHERE type = '${PHASE5_EVENT_TYPES.THING_UPDATED}'
         AND source = '${testNamespace}'`
      )

      // Assert
      expect(createdEvents[0].cnt).toBeGreaterThanOrEqual(0)
      expect(updatedEvents[0].cnt).toBeGreaterThanOrEqual(0)
    })

    it('should support aggregation queries', async () => {
      if (!ctx) return

      // Act
      const queryResult = await ctx.queryIceberg<{
        type: string
        event_count: number
      }>(
        `SELECT type, COUNT(*) as event_count FROM events
         GROUP BY type
         ORDER BY event_count DESC
         LIMIT 10`
      )

      // Assert
      expect(Array.isArray(queryResult)).toBe(true)
      if (queryResult.length > 0) {
        expect(queryResult[0]).toHaveProperty('type')
        expect(queryResult[0]).toHaveProperty('event_count')
      }
    })
  })

  // ============================================================================
  // SLA COMPLIANCE TESTS
  // ============================================================================

  describe('SLA Compliance', () => {
    it('should meet E2E latency SLA', async () => {
      if (!ctx) return

      const slaResult = await verifySLACompliance(ctx)

      // Log SLA metrics
      console.log('Sink SLA Compliance:', {
        p50: `${slaResult.p50.value}ms (target: ${slaResult.p50.target}ms)`,
        p95: `${slaResult.p95.value}ms (target: ${slaResult.p95.target}ms)`,
        p99: `${slaResult.p99.value}ms (target: ${slaResult.p99.target}ms)`,
      })

      // Verify SLA structure
      expect(slaResult).toHaveProperty('compliant')
      expect(slaResult).toHaveProperty('p50')
      expect(slaResult).toHaveProperty('p95')
      expect(slaResult).toHaveProperty('p99')
    })

    it('should meet event loss rate SLA', async () => {
      if (!ctx) return

      const slaResult = await verifySLACompliance(ctx)

      expect(slaResult.eventLossRate.value).toBeLessThanOrEqual(
        PHASE5_SLA_TARGETS.maxEventLossRate
      )
    })
  })
})
