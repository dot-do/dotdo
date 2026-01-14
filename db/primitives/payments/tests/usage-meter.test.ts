/**
 * Usage Meter Tests - TDD RED Phase
 *
 * Focused tests for:
 * 1. Usage event ingestion
 * 2. Aggregation: sum
 * 3. Aggregation: max
 * 4. Aggregation: unique (count distinct)
 * 5. Aggregation: last_during_period
 * 6. Billing period boundaries
 * 7. Rollup to invoice
 *
 * These tests should FAIL until the UsageMeter implementation is complete.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createUsageMeter,
  type UsageMeter,
  type UsageEvent,
  type AggregationType,
  type BillingPeriod,
  type UsageRollup,
  type InvoiceLineItem,
} from '../usage-meter'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMeter(): UsageMeter {
  return createUsageMeter()
}

const CUSTOMER_ID = 'cust_test_123'
const METRIC_API_CALLS = 'api_calls'
const METRIC_STORAGE = 'storage_gb'
const METRIC_ACTIVE_USERS = 'active_users'
const METRIC_BANDWIDTH = 'bandwidth_gb'

// =============================================================================
// 1. Usage Event Ingestion Tests
// =============================================================================

describe('UsageMeter', () => {
  describe('usage event ingestion', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createMeter()
    })

    it('should ingest a single usage event', async () => {
      const event = await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })

      expect(event.id).toBeDefined()
      expect(event.customerId).toBe(CUSTOMER_ID)
      expect(event.metricId).toBe(METRIC_API_CALLS)
      expect(event.value).toBe(100)
      expect(event.timestamp).toEqual(new Date('2024-01-15T10:00:00Z'))
    })

    it('should auto-generate timestamp if not provided', async () => {
      const before = new Date()
      const event = await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 50,
      })
      const after = new Date()

      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should ingest batch of events atomically', async () => {
      const events = await meter.ingestBatch([
        { customerId: CUSTOMER_ID, metricId: METRIC_API_CALLS, value: 10 },
        { customerId: CUSTOMER_ID, metricId: METRIC_API_CALLS, value: 20 },
        { customerId: CUSTOMER_ID, metricId: METRIC_STORAGE, value: 5 },
      ])

      expect(events).toHaveLength(3)
      expect(events.every((e) => e.id)).toBe(true)
    })

    it('should support idempotent ingestion with idempotency key', async () => {
      const event1 = await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        idempotencyKey: 'req_abc123',
      })

      const event2 = await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        idempotencyKey: 'req_abc123',
      })

      // Same idempotency key should return same event
      expect(event1.id).toBe(event2.id)
    })

    it('should attach metadata to events', async () => {
      const event = await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        metadata: {
          endpoint: '/api/users',
          method: 'GET',
          statusCode: 200,
        },
      })

      expect(event.metadata).toEqual({
        endpoint: '/api/users',
        method: 'GET',
        statusCode: 200,
      })
    })

    it('should reject negative values', async () => {
      await expect(
        meter.ingest({
          customerId: CUSTOMER_ID,
          metricId: METRIC_API_CALLS,
          value: -10,
        })
      ).rejects.toThrow('Value must be non-negative')
    })

    it('should accept zero values', async () => {
      const event = await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 0,
      })

      expect(event.value).toBe(0)
    })

    it('should query events by customer and time range', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 200,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 300,
        timestamp: new Date('2024-01-16T10:00:00Z'),
      })

      const events = await meter.queryEvents({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(events).toHaveLength(2)
      expect(events.map((e) => e.value)).toEqual([100, 200])
    })
  })

  // =============================================================================
  // 2. Aggregation: SUM Tests
  // =============================================================================

  describe('aggregation: sum', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createMeter()
    })

    it('should aggregate values using SUM', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 150,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 75,
        timestamp: new Date('2024-01-15T16:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(325) // 100 + 150 + 75
      expect(result.aggregation).toBe('sum')
      expect(result.eventCount).toBe(3)
    })

    it('should return zero for periods with no events', async () => {
      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(0)
      expect(result.eventCount).toBe(0)
    })

    it('should sum across billing period boundaries', async () => {
      // Events spanning multiple days
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: new Date('2024-01-01T10:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 200,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 300,
        timestamp: new Date('2024-01-31T10:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-31T23:59:59Z'),
      })

      expect(result.value).toBe(600)
    })

    it('should handle decimal values in sum', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_BANDWIDTH,
        value: 1.5,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_BANDWIDTH,
        value: 2.7,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_BANDWIDTH,
        aggregation: 'sum',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBeCloseTo(4.2, 10)
    })
  })

  // =============================================================================
  // 3. Aggregation: MAX Tests
  // =============================================================================

  describe('aggregation: max', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createMeter()
    })

    it('should find maximum value in period', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 50,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 100,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 75,
        timestamp: new Date('2024-01-15T16:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'max',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(100)
      expect(result.aggregation).toBe('max')
    })

    it('should return null for max with no events', async () => {
      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'max',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBeNull()
      expect(result.eventCount).toBe(0)
    })

    it('should track high water mark for storage-like metrics', async () => {
      // Simulate storage that grows and shrinks
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 10,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 50,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 30,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 80,
        timestamp: new Date('2024-01-15T14:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 60,
        timestamp: new Date('2024-01-15T16:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'max',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(80) // High water mark
    })

    it('should handle single event for max', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 42,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'max',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(42)
      expect(result.eventCount).toBe(1)
    })
  })

  // =============================================================================
  // 4. Aggregation: UNIQUE (Count Distinct) Tests
  // =============================================================================

  describe('aggregation: unique (count distinct)', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createMeter()
    })

    it('should count unique values based on property', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T08:00:00Z'),
        metadata: { userId: 'user_1' },
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T09:00:00Z'),
        metadata: { userId: 'user_2' },
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T10:00:00Z'),
        metadata: { userId: 'user_1' }, // Duplicate user
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T11:00:00Z'),
        metadata: { userId: 'user_3' },
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        aggregation: 'unique',
        uniqueProperty: 'userId',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(3) // user_1, user_2, user_3 (user_1 counted once)
      expect(result.aggregation).toBe('unique')
    })

    it('should return zero unique count with no events', async () => {
      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        aggregation: 'unique',
        uniqueProperty: 'userId',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(0)
    })

    it('should require uniqueProperty for unique aggregation', async () => {
      await expect(
        meter.aggregate({
          customerId: CUSTOMER_ID,
          metricId: METRIC_ACTIVE_USERS,
          aggregation: 'unique',
          // Missing uniqueProperty
          startTime: new Date('2024-01-15T00:00:00Z'),
          endTime: new Date('2024-01-15T23:59:59Z'),
        })
      ).rejects.toThrow('uniqueProperty is required for unique aggregation')
    })

    it('should handle events without the unique property', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T08:00:00Z'),
        metadata: { userId: 'user_1' },
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T09:00:00Z'),
        // No metadata/userId
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        value: 1,
        timestamp: new Date('2024-01-15T10:00:00Z'),
        metadata: { userId: 'user_2' },
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_ACTIVE_USERS,
        aggregation: 'unique',
        uniqueProperty: 'userId',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      // Events without property are either ignored or counted as one unknown
      expect(result.value).toBe(2) // Only user_1 and user_2 are valid unique values
    })

    it('should support nested property paths for uniqueness', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 1,
        timestamp: new Date('2024-01-15T08:00:00Z'),
        metadata: { request: { clientId: 'client_a' } },
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 1,
        timestamp: new Date('2024-01-15T09:00:00Z'),
        metadata: { request: { clientId: 'client_b' } },
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 1,
        timestamp: new Date('2024-01-15T10:00:00Z'),
        metadata: { request: { clientId: 'client_a' } },
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'unique',
        uniqueProperty: 'request.clientId',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(2) // client_a and client_b
    })
  })

  // =============================================================================
  // 5. Aggregation: LAST_DURING_PERIOD Tests
  // =============================================================================

  describe('aggregation: last_during_period', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createMeter()
    })

    it('should return the last value recorded in the period', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 50,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 75,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 60,
        timestamp: new Date('2024-01-15T16:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'last_during_period',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(60) // Last recorded value
      expect(result.aggregation).toBe('last_during_period')
    })

    it('should return null when no events in period', async () => {
      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'last_during_period',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBeNull()
    })

    it('should handle events ingested out of order', async () => {
      // Ingest in non-chronological order
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 75,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 50,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 90,
        timestamp: new Date('2024-01-15T18:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'last_during_period',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(90) // Latest by timestamp, not ingestion order
    })

    it('should track final state for gauge-like metrics', async () => {
      // Concurrent connections at end of period
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: 'concurrent_connections',
        value: 10,
        timestamp: new Date('2024-01-15T09:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: 'concurrent_connections',
        value: 25,
        timestamp: new Date('2024-01-15T14:00:00Z'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: 'concurrent_connections',
        value: 15,
        timestamp: new Date('2024-01-15T23:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: 'concurrent_connections',
        aggregation: 'last_during_period',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(15) // Final state at end of period
    })

    it('should return single event value', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 42,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        aggregation: 'last_during_period',
        startTime: new Date('2024-01-15T00:00:00Z'),
        endTime: new Date('2024-01-15T23:59:59Z'),
      })

      expect(result.value).toBe(42)
      expect(result.eventCount).toBe(1)
    })
  })

  // =============================================================================
  // 6. Billing Period Boundaries Tests
  // =============================================================================

  describe('billing period boundaries', () => {
    let meter: UsageMeter

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-20T12:00:00Z'))
      meter = createMeter()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should respect billing period start time (inclusive)', async () => {
      const periodStart = new Date('2024-01-01T00:00:00Z')

      // Event exactly at period start
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: periodStart,
      })
      // Event before period start
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 50,
        timestamp: new Date('2023-12-31T23:59:59Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        startTime: periodStart,
        endTime: new Date('2024-01-31T23:59:59Z'),
      })

      expect(result.value).toBe(100) // Only includes event at period start
    })

    it('should respect billing period end time (inclusive)', async () => {
      const periodEnd = new Date('2024-01-31T23:59:59Z')

      // Event exactly at period end
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: periodEnd,
      })
      // Event after period end
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 50,
        timestamp: new Date('2024-02-01T00:00:00Z'),
      })

      const result = await meter.aggregate({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: periodEnd,
      })

      expect(result.value).toBe(100) // Only includes event at period end
    })

    it('should define billing period with anchor date', async () => {
      await meter.defineBillingPeriod({
        customerId: CUSTOMER_ID,
        anchorDate: new Date('2024-01-15'),
        intervalType: 'month',
      })

      // Get current billing period
      const period = await meter.getCurrentBillingPeriod(CUSTOMER_ID)

      expect(period.startDate).toEqual(new Date('2024-01-15T00:00:00Z'))
      expect(period.endDate).toEqual(new Date('2024-02-15T00:00:00Z'))
    })

    it('should handle month-end anchor dates', async () => {
      await meter.defineBillingPeriod({
        customerId: CUSTOMER_ID,
        anchorDate: new Date('2024-01-31'), // End of January
        intervalType: 'month',
      })

      // February billing period (Feb doesn't have 31 days)
      vi.setSystemTime(new Date('2024-02-15'))
      const period = await meter.getCurrentBillingPeriod(CUSTOMER_ID)

      // Should handle gracefully - end of February
      expect(period.startDate).toEqual(new Date('2024-01-31T00:00:00Z'))
      expect(period.endDate.getMonth()).toBe(1) // February
    })

    it('should aggregate within custom billing period', async () => {
      await meter.defineBillingPeriod({
        customerId: CUSTOMER_ID,
        anchorDate: new Date('2024-01-15'),
        intervalType: 'month',
      })

      // Event before billing period
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 100,
        timestamp: new Date('2024-01-10'),
      })
      // Events within billing period
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 200,
        timestamp: new Date('2024-01-20'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 300,
        timestamp: new Date('2024-02-10'),
      })
      // Event after billing period
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 400,
        timestamp: new Date('2024-02-20'),
      })

      const result = await meter.aggregateForBillingPeriod({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        periodIndex: 0, // Current period
      })

      expect(result.value).toBe(500) // 200 + 300 within period
    })

    it('should support weekly billing periods', async () => {
      // Set time within the first week
      vi.setSystemTime(new Date('2024-01-05T12:00:00Z'))

      await meter.defineBillingPeriod({
        customerId: CUSTOMER_ID,
        anchorDate: new Date('2024-01-01'), // Monday
        intervalType: 'week',
      })

      const period = await meter.getCurrentBillingPeriod(CUSTOMER_ID)

      expect(period.startDate).toEqual(new Date('2024-01-01T00:00:00Z'))
      expect(period.endDate).toEqual(new Date('2024-01-08T00:00:00Z'))
    })

    it('should support yearly billing periods', async () => {
      await meter.defineBillingPeriod({
        customerId: CUSTOMER_ID,
        anchorDate: new Date('2024-01-01'),
        intervalType: 'year',
      })

      const period = await meter.getCurrentBillingPeriod(CUSTOMER_ID)

      expect(period.startDate).toEqual(new Date('2024-01-01T00:00:00Z'))
      expect(period.endDate).toEqual(new Date('2025-01-01T00:00:00Z'))
    })

    it('should get previous billing periods', async () => {
      await meter.defineBillingPeriod({
        customerId: CUSTOMER_ID,
        anchorDate: new Date('2024-01-01'),
        intervalType: 'month',
      })

      vi.setSystemTime(new Date('2024-03-15'))

      const prevPeriod = await meter.getBillingPeriod(CUSTOMER_ID, -1) // Previous period
      expect(prevPeriod.startDate).toEqual(new Date('2024-02-01T00:00:00Z'))
      expect(prevPeriod.endDate).toEqual(new Date('2024-03-01T00:00:00Z'))
    })
  })

  // =============================================================================
  // 7. Rollup to Invoice Tests
  // =============================================================================

  describe('rollup to invoice', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createMeter()
    })

    it('should generate usage rollup for billing period', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 5000,
        timestamp: new Date('2024-01-15'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 3000,
        timestamp: new Date('2024-01-20'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 100,
        timestamp: new Date('2024-01-25'),
      })

      const rollup = await meter.generateRollup({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      expect(rollup.customerId).toBe(CUSTOMER_ID)
      expect(rollup.periodStart).toEqual(new Date('2024-01-01'))
      expect(rollup.periodEnd).toEqual(new Date('2024-02-01'))
      expect(rollup.metrics).toHaveLength(2)
      expect(rollup.metrics.find((m) => m.metricId === METRIC_API_CALLS)?.value).toBe(8000)
      expect(rollup.metrics.find((m) => m.metricId === METRIC_STORAGE)?.value).toBe(100)
    })

    it('should generate invoice line items from rollup', async () => {
      // Configure pricing for metrics
      await meter.configureMetricPricing({
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        pricePerUnit: 0.001, // $0.001 per API call
        includedUnits: 1000, // First 1000 free
      })
      await meter.configureMetricPricing({
        metricId: METRIC_STORAGE,
        aggregation: 'max', // Bill for peak storage
        pricePerUnit: 0.10, // $0.10 per GB
      })

      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 5000,
        timestamp: new Date('2024-01-15'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 50,
        timestamp: new Date('2024-01-15'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 75,
        timestamp: new Date('2024-01-20'),
      })

      const lineItems = await meter.generateInvoiceLineItems({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      expect(lineItems).toHaveLength(2)

      const apiCallsItem = lineItems.find((i) => i.metricId === METRIC_API_CALLS)
      expect(apiCallsItem?.quantity).toBe(5000)
      expect(apiCallsItem?.billableQuantity).toBe(4000) // 5000 - 1000 included
      expect(apiCallsItem?.unitPrice).toBe(0.001)
      expect(apiCallsItem?.amount).toBe(4) // 4000 * $0.001

      const storageItem = lineItems.find((i) => i.metricId === METRIC_STORAGE)
      expect(storageItem?.quantity).toBe(75) // Max value
      expect(storageItem?.unitPrice).toBe(0.10)
      expect(storageItem?.amount).toBe(7.5) // 75 * $0.10
    })

    it('should apply tiered pricing to line items', async () => {
      await meter.configureMetricPricing({
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        tiers: [
          { upTo: 1000, pricePerUnit: 0 }, // Free tier
          { upTo: 10000, pricePerUnit: 0.002 }, // $0.002 for next 9000
          { upTo: null, pricePerUnit: 0.001 }, // $0.001 for rest
        ],
      })

      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 15000,
        timestamp: new Date('2024-01-15'),
      })

      const lineItems = await meter.generateInvoiceLineItems({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      const apiCallsItem = lineItems.find((i) => i.metricId === METRIC_API_CALLS)
      // 1000 free + 9000 * $0.002 + 5000 * $0.001 = $0 + $18 + $5 = $23
      expect(apiCallsItem?.amount).toBe(23)
      expect(apiCallsItem?.tierBreakdown).toHaveLength(3)
    })

    it('should mark rollup as finalized', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 1000,
        timestamp: new Date('2024-01-15'),
      })

      const rollup = await meter.generateRollup({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      await meter.finalizeRollup(rollup.id)

      const finalized = await meter.getRollup(rollup.id)
      expect(finalized?.finalized).toBe(true)
      expect(finalized?.finalizedAt).toBeInstanceOf(Date)
    })

    it('should prevent ingestion into finalized period', async () => {
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 1000,
        timestamp: new Date('2024-01-15'),
      })

      const rollup = await meter.generateRollup({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      await meter.finalizeRollup(rollup.id)

      // Attempt to ingest into finalized period
      await expect(
        meter.ingest({
          customerId: CUSTOMER_ID,
          metricId: METRIC_API_CALLS,
          value: 500,
          timestamp: new Date('2024-01-20'),
        })
      ).rejects.toThrow('Cannot ingest into finalized billing period')
    })

    it('should calculate total invoice amount', async () => {
      await meter.configureMetricPricing({
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        pricePerUnit: 0.001,
      })
      await meter.configureMetricPricing({
        metricId: METRIC_STORAGE,
        aggregation: 'max',
        pricePerUnit: 0.10,
      })
      await meter.configureMetricPricing({
        metricId: METRIC_BANDWIDTH,
        aggregation: 'sum',
        pricePerUnit: 0.05,
      })

      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 10000,
        timestamp: new Date('2024-01-15'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_STORAGE,
        value: 100,
        timestamp: new Date('2024-01-15'),
      })
      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_BANDWIDTH,
        value: 50,
        timestamp: new Date('2024-01-15'),
      })

      const lineItems = await meter.generateInvoiceLineItems({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      const total = lineItems.reduce((sum, item) => sum + item.amount, 0)
      // API: 10000 * $0.001 = $10
      // Storage: 100 * $0.10 = $10
      // Bandwidth: 50 * $0.05 = $2.50
      expect(total).toBe(22.5)
    })

    it('should include descriptive line item text', async () => {
      await meter.configureMetricPricing({
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        pricePerUnit: 0.001,
        displayName: 'API Requests',
        unit: 'requests',
      })

      await meter.ingest({
        customerId: CUSTOMER_ID,
        metricId: METRIC_API_CALLS,
        value: 5000,
        timestamp: new Date('2024-01-15'),
      })

      const lineItems = await meter.generateInvoiceLineItems({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      expect(lineItems[0].description).toBe('API Requests')
      expect(lineItems[0].unit).toBe('requests')
    })

    it('should handle zero usage gracefully', async () => {
      await meter.configureMetricPricing({
        metricId: METRIC_API_CALLS,
        aggregation: 'sum',
        pricePerUnit: 0.001,
      })

      // No usage recorded

      const lineItems = await meter.generateInvoiceLineItems({
        customerId: CUSTOMER_ID,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-02-01'),
      })

      // Should either return empty array or line item with $0
      expect(lineItems.length === 0 || lineItems[0].amount === 0).toBe(true)
    })
  })
})
