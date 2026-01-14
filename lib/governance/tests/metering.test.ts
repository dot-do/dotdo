/**
 * Usage Metering Tests - TDD Red-Green-Refactor
 *
 * Tests for usage metering following Orb/Metronome patterns:
 * - Event ingestion with idempotency keys
 * - Customer/org association
 * - Numeric value aggregation
 * - Property dimensions (model, region, tier)
 * - Batch queuing for payments.do integration
 *
 * @see https://www.getorb.com/docs
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  UsageMeter,
  type MeterEvent,
  type MeterQuery,
  type AggregatedUsage,
  type MeterStorage,
} from '../metering'

// =============================================================================
// Mock Storage Implementation
// =============================================================================

class MemoryMeterStorage implements MeterStorage {
  private events = new Map<string, unknown>()
  private counters = new Map<string, number>()

  async storeEvent(event: MeterEvent): Promise<void> {
    this.events.set(event.idempotencyKey, event)

    // Update aggregated counter
    const counterKey = `${event.customerId}:${event.eventName}`
    const current = this.counters.get(counterKey) ?? 0
    this.counters.set(counterKey, current + event.value)
  }

  async getEvent(idempotencyKey: string): Promise<MeterEvent | null> {
    return (this.events.get(idempotencyKey) as MeterEvent) ?? null
  }

  async query(query: MeterQuery): Promise<AggregatedUsage> {
    let total = 0
    const breakdown: Record<string, number> = {}

    for (const [key, event] of this.events) {
      const e = event as MeterEvent

      // Filter by customer
      if (query.customerId && e.customerId !== query.customerId) continue

      // Filter by event name
      if (query.eventName && e.eventName !== query.eventName) continue

      // Filter by time range
      if (query.startTime && new Date(e.timestamp) < query.startTime) continue
      if (query.endTime && new Date(e.timestamp) > query.endTime) continue

      // Filter by dimensions
      if (query.dimensions) {
        const matches = Object.entries(query.dimensions).every(
          ([key, value]) => e.properties?.[key] === value
        )
        if (!matches) continue
      }

      total += e.value

      // Build breakdown by groupBy dimension
      if (query.groupBy) {
        const groupValue = String(e.properties?.[query.groupBy] ?? 'unknown')
        breakdown[groupValue] = (breakdown[groupValue] ?? 0) + e.value
      }
    }

    return {
      total,
      breakdown: Object.keys(breakdown).length > 0 ? breakdown : undefined,
      count: Array.from(this.events.values()).filter(e => {
        const event = e as MeterEvent
        if (query.customerId && event.customerId !== query.customerId) return false
        if (query.eventName && event.eventName !== query.eventName) return false
        return true
      }).length,
    }
  }

  async flush(): Promise<MeterEvent[]> {
    const events = Array.from(this.events.values()) as MeterEvent[]
    return events
  }
}

// =============================================================================
// Event Ingestion Tests
// =============================================================================

describe('UsageMeter', () => {
  let storage: MemoryMeterStorage
  let meter: UsageMeter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryMeterStorage()
    meter = new UsageMeter(storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('event ingestion', () => {
    it('should ingest a basic usage event', async () => {
      const event = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      expect(event.idempotencyKey).toBeTruthy()
      expect(event.eventName).toBe('api_request')
      expect(event.customerId).toBe('cust_123')
      expect(event.value).toBe(1)
    })

    it('should auto-generate idempotency key if not provided', async () => {
      const event = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      expect(event.idempotencyKey).toBeTruthy()
      expect(event.idempotencyKey.length).toBeGreaterThan(0)
    })

    it('should use provided idempotency key', async () => {
      const event = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
        idempotencyKey: 'req_abc123',
      })

      expect(event.idempotencyKey).toBe('req_abc123')
    })

    it('should deduplicate events with same idempotency key', async () => {
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 100,
        idempotencyKey: 'req_unique',
      })

      // Second ingestion with same key should be ignored
      const duplicate = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 100,
        idempotencyKey: 'req_unique',
      })

      expect(duplicate.deduplicated).toBe(true)

      // Query should show only one event's value
      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'api_request',
      })

      expect(usage.total).toBe(100)
    })

    it('should record timestamp', async () => {
      const event = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      expect(event.timestamp).toEqual(new Date('2024-01-01T00:00:00.000Z'))
    })

    it('should accept custom timestamp', async () => {
      const customTime = new Date('2023-12-15T10:30:00.000Z')
      const event = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
        timestamp: customTime,
      })

      expect(event.timestamp).toEqual(customTime)
    })
  })

  // =============================================================================
  // Property Dimensions Tests
  // =============================================================================

  describe('property dimensions', () => {
    it('should store arbitrary properties', async () => {
      const event = await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 1500,
        properties: {
          model: 'gpt-4',
          region: 'us-east-1',
          tier: 'premium',
        },
      })

      expect(event.properties).toEqual({
        model: 'gpt-4',
        region: 'us-east-1',
        tier: 'premium',
      })
    })

    it('should query by property dimensions', async () => {
      // Ingest events with different models
      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 1000,
        properties: { model: 'gpt-4' },
      })

      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 500,
        properties: { model: 'gpt-3.5-turbo' },
      })

      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 2000,
        properties: { model: 'gpt-4' },
      })

      // Query for GPT-4 only
      const gpt4Usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'llm_tokens',
        dimensions: { model: 'gpt-4' },
      })

      expect(gpt4Usage.total).toBe(3000)
    })

    it('should group by property dimension', async () => {
      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 1000,
        properties: { model: 'gpt-4' },
      })

      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 500,
        properties: { model: 'gpt-3.5-turbo' },
      })

      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 800,
        properties: { model: 'gpt-4' },
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'llm_tokens',
        groupBy: 'model',
      })

      expect(usage.breakdown).toEqual({
        'gpt-4': 1800,
        'gpt-3.5-turbo': 500,
      })
    })
  })

  // =============================================================================
  // Aggregation Tests
  // =============================================================================

  describe('aggregation', () => {
    it('should sum values for same customer and event', async () => {
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 10,
      })

      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 25,
      })

      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 15,
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'api_request',
      })

      expect(usage.total).toBe(50)
    })

    it('should query by time range', async () => {
      // Day 1 events
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 100,
        timestamp: new Date('2024-01-01T10:00:00.000Z'),
      })

      // Day 2 events
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 200,
        timestamp: new Date('2024-01-02T10:00:00.000Z'),
      })

      // Day 3 events
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 300,
        timestamp: new Date('2024-01-03T10:00:00.000Z'),
      })

      // Query for day 2 only
      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'api_request',
        startTime: new Date('2024-01-02T00:00:00.000Z'),
        endTime: new Date('2024-01-02T23:59:59.999Z'),
      })

      expect(usage.total).toBe(200)
    })

    it('should return event count', async () => {
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'api_request',
      })

      expect(usage.count).toBe(3)
    })

    it('should isolate customers', async () => {
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_A',
        value: 100,
      })

      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_B',
        value: 200,
      })

      const usageA = await meter.query({
        customerId: 'cust_A',
        eventName: 'api_request',
      })

      const usageB = await meter.query({
        customerId: 'cust_B',
        eventName: 'api_request',
      })

      expect(usageA.total).toBe(100)
      expect(usageB.total).toBe(200)
    })

    it('should handle different event names', async () => {
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 100,
      })

      await meter.ingest({
        eventName: 'storage_bytes',
        customerId: 'cust_123',
        value: 1024,
      })

      const apiUsage = await meter.query({
        customerId: 'cust_123',
        eventName: 'api_request',
      })

      const storageUsage = await meter.query({
        customerId: 'cust_123',
        eventName: 'storage_bytes',
      })

      expect(apiUsage.total).toBe(100)
      expect(storageUsage.total).toBe(1024)
    })
  })

  // =============================================================================
  // Batch Queue Tests
  // =============================================================================

  describe('batch queuing', () => {
    it('should batch events for flushing', async () => {
      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      const batch = await meter.flush()

      expect(batch).toHaveLength(2)
    })

    it('should support configurable batch size', async () => {
      const batchMeter = new UsageMeter(storage, { batchSize: 2 })

      await batchMeter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      await batchMeter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 1,
      })

      // Should auto-flush when batch size reached
      expect(batchMeter.getPendingCount()).toBe(0)
    })

    it('should include all event data in batch', async () => {
      await meter.ingest({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 1500,
        properties: { model: 'gpt-4' },
      })

      const batch = await meter.flush()

      expect(batch[0]).toMatchObject({
        eventName: 'llm_tokens',
        customerId: 'cust_123',
        value: 1500,
        properties: { model: 'gpt-4' },
      })
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    it('should handle zero values', async () => {
      const event = await meter.ingest({
        eventName: 'api_request',
        customerId: 'cust_123',
        value: 0,
      })

      expect(event.value).toBe(0)
    })

    it('should handle negative values (for credits)', async () => {
      await meter.ingest({
        eventName: 'credits',
        customerId: 'cust_123',
        value: -50, // Refund
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'credits',
      })

      expect(usage.total).toBe(-50)
    })

    it('should handle decimal values', async () => {
      await meter.ingest({
        eventName: 'cpu_hours',
        customerId: 'cust_123',
        value: 0.5,
      })

      await meter.ingest({
        eventName: 'cpu_hours',
        customerId: 'cust_123',
        value: 0.75,
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'cpu_hours',
      })

      expect(usage.total).toBeCloseTo(1.25)
    })

    it('should handle large values', async () => {
      await meter.ingest({
        eventName: 'bytes_transferred',
        customerId: 'cust_123',
        value: 1_000_000_000_000, // 1 TB
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'bytes_transferred',
      })

      expect(usage.total).toBe(1_000_000_000_000)
    })

    it('should handle special characters in event names', async () => {
      await meter.ingest({
        eventName: 'api/v2/users:read',
        customerId: 'cust_123',
        value: 1,
      })

      const usage = await meter.query({
        customerId: 'cust_123',
        eventName: 'api/v2/users:read',
      })

      expect(usage.total).toBe(1)
    })

    it('should return zero for non-existent usage', async () => {
      const usage = await meter.query({
        customerId: 'non_existent',
        eventName: 'api_request',
      })

      expect(usage.total).toBe(0)
      expect(usage.count).toBe(0)
    })
  })
})
