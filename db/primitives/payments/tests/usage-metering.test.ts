/**
 * Usage Metering Tests - TDD RED Phase
 *
 * Comprehensive tests for usage event ingestion, aggregation, and billing:
 * - Record usage event (single and batch)
 * - Aggregate usage by period (day, month, hour)
 * - Usage tiers (graduated, volume, tiered)
 * - Usage limits and alerts
 * - Usage reset on billing cycle
 * - Usage rollover
 * - Real-time vs batch reporting
 * - Usage-based pricing calculation
 * - Usage summary for invoicing
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createUsageMeter,
  type UsageMeter,
  type UsageEvent,
  type UsageAggregate,
  type UsageTier,
  type UsageLimit,
  type UsageAlert,
  type UsageSummary,
  type UsagePricingConfig,
  type UsageReportingMode,
  type AggregationPeriod,
  type TierType,
  type UsageRolloverPolicy,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestMeter(): UsageMeter {
  return createUsageMeter()
}

function createTestUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    customerId: 'cust_123',
    metricId: 'api_calls',
    quantity: 1,
    timestamp: new Date(),
    properties: {},
    ...overrides,
  }
}

// =============================================================================
// Record Usage Event Tests
// =============================================================================

describe('UsageMeter', () => {
  describe('record usage event', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should record a single usage event', async () => {
      const event = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1,
      })

      expect(event.id).toBeDefined()
      expect(event.customerId).toBe('cust_123')
      expect(event.metricId).toBe('api_calls')
      expect(event.quantity).toBe(1)
      expect(event.timestamp).toBeInstanceOf(Date)
    })

    it('should record event with custom timestamp', async () => {
      const customTime = new Date('2024-01-15T10:00:00Z')
      const event = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 5,
        timestamp: customTime,
      })

      expect(event.timestamp).toEqual(customTime)
    })

    it('should record event with properties', async () => {
      const event = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'storage_bytes',
        quantity: 1024,
        properties: {
          region: 'us-east-1',
          tier: 'standard',
        },
      })

      expect(event.properties).toEqual({
        region: 'us-east-1',
        tier: 'standard',
      })
    })

    it('should record event with idempotency key', async () => {
      const event1 = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1,
        idempotencyKey: 'unique_key_123',
      })

      const event2 = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1,
        idempotencyKey: 'unique_key_123',
      })

      expect(event1.id).toBe(event2.id)
    })

    it('should record batch of events', async () => {
      const events = await meter.recordEvents([
        { customerId: 'cust_123', metricId: 'api_calls', quantity: 1 },
        { customerId: 'cust_123', metricId: 'api_calls', quantity: 2 },
        { customerId: 'cust_123', metricId: 'storage_bytes', quantity: 1024 },
      ])

      expect(events).toHaveLength(3)
      expect(events.every((e) => e.id)).toBe(true)
    })

    it('should validate positive quantity', async () => {
      await expect(
        meter.recordEvent({
          customerId: 'cust_123',
          metricId: 'api_calls',
          quantity: -1,
        })
      ).rejects.toThrow('Quantity must be non-negative')
    })

    it('should allow zero quantity for delta events', async () => {
      const event = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 0,
      })

      expect(event.quantity).toBe(0)
    })

    it('should require customer ID', async () => {
      await expect(
        meter.recordEvent({
          customerId: '',
          metricId: 'api_calls',
          quantity: 1,
        })
      ).rejects.toThrow('Customer ID is required')
    })

    it('should require metric ID', async () => {
      await expect(
        meter.recordEvent({
          customerId: 'cust_123',
          metricId: '',
          quantity: 1,
        })
      ).rejects.toThrow('Metric ID is required')
    })

    it('should get event by ID', async () => {
      const created = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1,
      })

      const retrieved = await meter.getEvent(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should list events for customer', async () => {
      await meter.recordEvent({ customerId: 'cust_abc', metricId: 'api_calls', quantity: 1 })
      await meter.recordEvent({ customerId: 'cust_abc', metricId: 'api_calls', quantity: 2 })
      await meter.recordEvent({ customerId: 'cust_xyz', metricId: 'api_calls', quantity: 1 })

      const events = await meter.listEvents({ customerId: 'cust_abc' })

      expect(events).toHaveLength(2)
      expect(events.every((e) => e.customerId === 'cust_abc')).toBe(true)
    })

    it('should filter events by metric', async () => {
      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 1 })
      await meter.recordEvent({ customerId: 'cust_123', metricId: 'storage_bytes', quantity: 1024 })

      const events = await meter.listEvents({
        customerId: 'cust_123',
        metricId: 'api_calls',
      })

      expect(events).toHaveLength(1)
      expect(events[0].metricId).toBe('api_calls')
    })

    it('should filter events by time range', async () => {
      const jan15 = new Date('2024-01-15T10:00:00Z')
      const jan16 = new Date('2024-01-16T10:00:00Z')
      const jan17 = new Date('2024-01-17T10:00:00Z')

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1,
        timestamp: jan15,
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 2,
        timestamp: jan16,
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 3,
        timestamp: jan17,
      })

      const events = await meter.listEvents({
        customerId: 'cust_123',
        startTime: jan15,
        endTime: jan16,
      })

      expect(events).toHaveLength(2)
    })
  })

  // =============================================================================
  // Aggregate Usage by Period Tests
  // =============================================================================

  describe('aggregate usage by period', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should aggregate usage by day (sum)', async () => {
      const date = new Date('2024-01-15T00:00:00Z')
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 150,
        timestamp: new Date('2024-01-15T16:00:00Z'),
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'day',
        date,
      })

      expect(aggregate.total).toBe(250)
      expect(aggregate.period).toBe('day')
      expect(aggregate.startTime).toEqual(date)
    })

    it('should aggregate usage by month', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1000,
        timestamp: new Date('2024-01-05T10:00:00Z'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 2000,
        timestamp: new Date('2024-01-20T10:00:00Z'),
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(aggregate.total).toBe(3000)
      expect(aggregate.period).toBe('month')
    })

    it('should aggregate usage by hour', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10,
        timestamp: new Date('2024-01-15T10:15:00Z'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 20,
        timestamp: new Date('2024-01-15T10:45:00Z'),
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'hour',
        date: new Date('2024-01-15T10:00:00Z'),
      })

      expect(aggregate.total).toBe(30)
    })

    it('should aggregate using max aggregation', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'concurrent_connections',
        quantity: 50,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'concurrent_connections',
        quantity: 100,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'concurrent_connections',
        quantity: 75,
        timestamp: new Date('2024-01-15T16:00:00Z'),
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'concurrent_connections',
        period: 'day',
        date: new Date('2024-01-15'),
        aggregation: 'max',
      })

      expect(aggregate.total).toBe(100)
    })

    it('should aggregate using unique count', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'active_users',
        quantity: 1,
        timestamp: new Date('2024-01-15T08:00:00Z'),
        properties: { userId: 'user_1' },
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'active_users',
        quantity: 1,
        timestamp: new Date('2024-01-15T09:00:00Z'),
        properties: { userId: 'user_2' },
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'active_users',
        quantity: 1,
        timestamp: new Date('2024-01-15T10:00:00Z'),
        properties: { userId: 'user_1' }, // Duplicate
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'active_users',
        period: 'day',
        date: new Date('2024-01-15'),
        aggregation: 'unique',
        uniqueKey: 'userId',
      })

      expect(aggregate.total).toBe(2) // Only 2 unique users
    })

    it('should get aggregates for date range', async () => {
      // Record events across multiple days
      for (let day = 1; day <= 5; day++) {
        await meter.recordEvent({
          customerId: 'cust_123',
          metricId: 'api_calls',
          quantity: day * 100,
          timestamp: new Date(`2024-01-${day.toString().padStart(2, '0')}T10:00:00Z`),
        })
      }

      const aggregates = await meter.getAggregates({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'day',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-05'),
      })

      expect(aggregates).toHaveLength(5)
      expect(aggregates[0].total).toBe(100)
      expect(aggregates[4].total).toBe(500)
    })

    it('should return zero for periods with no usage', async () => {
      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'day',
        date: new Date('2024-01-15'),
      })

      expect(aggregate.total).toBe(0)
      expect(aggregate.count).toBe(0)
    })

    it('should track event count in aggregate', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100,
        timestamp: new Date('2024-01-15T08:00:00Z'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 200,
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'day',
        date: new Date('2024-01-15'),
      })

      expect(aggregate.count).toBe(2)
    })
  })

  // =============================================================================
  // Usage Tiers Tests
  // =============================================================================

  describe('usage tiers', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should configure graduated pricing tiers', async () => {
      await meter.configureTiers('cust_123', 'api_calls', {
        type: 'graduated',
        tiers: [
          { upTo: 1000, pricePerUnit: 0.01 }, // First 1000 at $0.01
          { upTo: 10000, pricePerUnit: 0.005 }, // Next 9000 at $0.005
          { upTo: null, pricePerUnit: 0.001 }, // Rest at $0.001
        ],
      })

      const config = await meter.getTierConfig('cust_123', 'api_calls')

      expect(config?.type).toBe('graduated')
      expect(config?.tiers).toHaveLength(3)
    })

    it('should configure volume pricing tiers', async () => {
      await meter.configureTiers('cust_123', 'storage_gb', {
        type: 'volume',
        tiers: [
          { upTo: 100, pricePerUnit: 0.10 }, // All units at $0.10 if under 100
          { upTo: 1000, pricePerUnit: 0.08 }, // All units at $0.08 if under 1000
          { upTo: null, pricePerUnit: 0.05 }, // All units at $0.05 for 1000+
        ],
      })

      const config = await meter.getTierConfig('cust_123', 'storage_gb')

      expect(config?.type).toBe('volume')
    })

    it('should calculate graduated tier pricing', async () => {
      await meter.configureTiers('cust_123', 'api_calls', {
        type: 'graduated',
        tiers: [
          { upTo: 1000, pricePerUnit: 0.01 },
          { upTo: 5000, pricePerUnit: 0.005 },
          { upTo: null, pricePerUnit: 0.001 },
        ],
      })

      // 6000 calls: 1000 * $0.01 + 4000 * $0.005 + 1000 * $0.001 = $10 + $20 + $1 = $31
      const price = await meter.calculatePrice('cust_123', 'api_calls', 6000)

      expect(price.total).toBe(31)
      expect(price.breakdown).toEqual([
        { tier: 0, quantity: 1000, pricePerUnit: 0.01, amount: 10 },
        { tier: 1, quantity: 4000, pricePerUnit: 0.005, amount: 20 },
        { tier: 2, quantity: 1000, pricePerUnit: 0.001, amount: 1 },
      ])
    })

    it('should calculate volume tier pricing', async () => {
      await meter.configureTiers('cust_123', 'storage_gb', {
        type: 'volume',
        tiers: [
          { upTo: 100, pricePerUnit: 0.10 },
          { upTo: 1000, pricePerUnit: 0.08 },
          { upTo: null, pricePerUnit: 0.05 },
        ],
      })

      // 500 GB at volume tier 2 ($0.08): 500 * $0.08 = $40
      const price = await meter.calculatePrice('cust_123', 'storage_gb', 500)

      expect(price.total).toBe(40)
      expect(price.appliedTier).toBe(1)
    })

    it('should support package pricing tier', async () => {
      await meter.configureTiers('cust_123', 'messages', {
        type: 'package',
        packageSize: 1000,
        packagePrice: 5.00,
      })

      // 2500 messages = 3 packages (round up) = $15
      const price = await meter.calculatePrice('cust_123', 'messages', 2500)

      expect(price.total).toBe(15)
      expect(price.packages).toBe(3)
    })

    it('should support flat fee plus per-unit tier', async () => {
      await meter.configureTiers('cust_123', 'api_calls', {
        type: 'graduated',
        flatFee: 10.00,
        tiers: [
          { upTo: null, pricePerUnit: 0.001 },
        ],
      })

      // $10 flat + 5000 * $0.001 = $10 + $5 = $15
      const price = await meter.calculatePrice('cust_123', 'api_calls', 5000)

      expect(price.total).toBe(15)
      expect(price.flatFee).toBe(10)
      expect(price.usageFee).toBe(5)
    })

    it('should include free tier in graduated pricing', async () => {
      await meter.configureTiers('cust_123', 'api_calls', {
        type: 'graduated',
        tiers: [
          { upTo: 1000, pricePerUnit: 0 }, // Free tier
          { upTo: null, pricePerUnit: 0.01 },
        ],
      })

      // 1500 calls: 1000 free + 500 * $0.01 = $5
      const price = await meter.calculatePrice('cust_123', 'api_calls', 1500)

      expect(price.total).toBe(5)
    })

    it('should get current tier for customer usage', async () => {
      await meter.configureTiers('cust_123', 'api_calls', {
        type: 'graduated',
        tiers: [
          { upTo: 1000, pricePerUnit: 0.01, name: 'Basic' },
          { upTo: 10000, pricePerUnit: 0.005, name: 'Growth' },
          { upTo: null, pricePerUnit: 0.001, name: 'Enterprise' },
        ],
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 5000,
      })

      const currentTier = await meter.getCurrentTier('cust_123', 'api_calls')

      expect(currentTier.name).toBe('Growth')
      expect(currentTier.usageInTier).toBe(4000) // 5000 - 1000 in first tier
    })
  })

  // =============================================================================
  // Usage Limits and Alerts Tests
  // =============================================================================

  describe('usage limits and alerts', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should set usage limit for customer', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 10000,
        period: 'month',
        action: 'block',
      })

      const limit = await meter.getLimit('cust_123', 'api_calls')

      expect(limit?.limit).toBe(10000)
      expect(limit?.period).toBe('month')
      expect(limit?.action).toBe('block')
    })

    it('should check if usage is within limit', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 1000,
        period: 'day',
        action: 'block',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 500,
      })

      const status = await meter.checkLimit('cust_123', 'api_calls')

      expect(status.withinLimit).toBe(true)
      expect(status.currentUsage).toBe(500)
      expect(status.limit).toBe(1000)
      expect(status.remaining).toBe(500)
    })

    it('should detect when usage exceeds limit', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 1000,
        period: 'day',
        action: 'block',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1500,
      })

      const status = await meter.checkLimit('cust_123', 'api_calls')

      expect(status.withinLimit).toBe(false)
      expect(status.exceeded).toBe(true)
      expect(status.overage).toBe(500)
    })

    it('should block usage when limit action is block', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 100,
        period: 'day',
        action: 'block',
      })

      // Record up to limit
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100,
      })

      // Attempt to record more
      await expect(
        meter.recordEvent({
          customerId: 'cust_123',
          metricId: 'api_calls',
          quantity: 1,
          enforceLimit: true,
        })
      ).rejects.toThrow('Usage limit exceeded')
    })

    it('should allow overage when limit action is warn', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 100,
        period: 'day',
        action: 'warn',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100,
      })

      // Should succeed even over limit
      const event = await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 50,
        enforceLimit: true,
      })

      expect(event.quantity).toBe(50)
    })

    it('should configure alert thresholds', async () => {
      await meter.setAlert('cust_123', 'api_calls', {
        thresholds: [50, 75, 90, 100],
        channels: ['email', 'webhook'],
      })

      const alert = await meter.getAlert('cust_123', 'api_calls')

      expect(alert?.thresholds).toEqual([50, 75, 90, 100])
      expect(alert?.channels).toContain('email')
    })

    it('should trigger alert when threshold reached', async () => {
      const alertHandler = vi.fn()
      meter.onAlert(alertHandler)

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 1000,
        period: 'day',
        action: 'warn',
      })

      await meter.setAlert('cust_123', 'api_calls', {
        thresholds: [50, 75, 90],
        channels: ['webhook'],
      })

      // Record 500 (50% of limit)
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 500,
      })

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust_123',
          metricId: 'api_calls',
          threshold: 50,
          currentUsage: 500,
          limit: 1000,
        })
      )
    })

    it('should not trigger duplicate alerts for same threshold', async () => {
      const alertHandler = vi.fn()
      meter.onAlert(alertHandler)

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 1000,
        period: 'day',
        action: 'warn',
      })

      await meter.setAlert('cust_123', 'api_calls', {
        thresholds: [50],
        channels: ['webhook'],
      })

      // Record 500 twice
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 500,
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100, // Still at 60%, but 50% already triggered
      })

      // Should only trigger once
      expect(alertHandler).toHaveBeenCalledTimes(1)
    })

    it('should remove limit', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 1000,
        period: 'day',
        action: 'block',
      })

      await meter.removeLimit('cust_123', 'api_calls')

      const limit = await meter.getLimit('cust_123', 'api_calls')
      expect(limit).toBeNull()
    })

    it('should list all limits for customer', async () => {
      await meter.setLimit('cust_123', 'api_calls', {
        limit: 10000,
        period: 'month',
        action: 'block',
      })
      await meter.setLimit('cust_123', 'storage_gb', {
        limit: 100,
        period: 'month',
        action: 'warn',
      })

      const limits = await meter.listLimits('cust_123')

      expect(limits).toHaveLength(2)
    })
  })

  // =============================================================================
  // Usage Reset on Billing Cycle Tests
  // =============================================================================

  describe('usage reset on billing cycle', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should configure billing cycle start', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      const cycle = await meter.getBillingCycle('cust_123')

      expect(cycle?.anchorDate).toEqual(new Date('2024-01-01'))
      expect(cycle?.period).toBe('month')
    })

    it('should get current billing period', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-15'),
        period: 'month',
      })

      // Assuming current date is 2024-01-20
      vi.setSystemTime(new Date('2024-01-20T10:00:00Z'))

      const period = await meter.getCurrentBillingPeriod('cust_123')

      expect(period.startDate).toEqual(new Date('2024-01-15'))
      expect(period.endDate).toEqual(new Date('2024-02-15'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should aggregate usage for current billing period only', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      // Record in previous period
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1000,
        timestamp: new Date('2023-12-15'),
      })

      // Record in current period
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 500,
        timestamp: new Date('2024-01-15'),
      })

      vi.setSystemTime(new Date('2024-01-20T10:00:00Z'))

      const usage = await meter.getCurrentPeriodUsage('cust_123', 'api_calls')

      expect(usage).toBe(500) // Only current period
    })

    it('should reset usage counters on billing cycle', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 1000,
        period: 'billing_cycle',
        action: 'block',
      })

      // Fill up in January
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1000,
        timestamp: new Date('2024-01-15'),
      })

      vi.setSystemTime(new Date('2024-01-20'))
      let status = await meter.checkLimit('cust_123', 'api_calls')
      expect(status.remaining).toBe(0)

      // Move to February
      vi.setSystemTime(new Date('2024-02-05'))
      status = await meter.checkLimit('cust_123', 'api_calls')
      expect(status.remaining).toBe(1000) // Reset
    })

    it('should support yearly billing cycle', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'year',
      })

      vi.setSystemTime(new Date('2024-06-15'))

      const period = await meter.getCurrentBillingPeriod('cust_123')

      expect(period.startDate).toEqual(new Date('2024-01-01'))
      expect(period.endDate).toEqual(new Date('2025-01-01'))
    })

    it('should handle mid-month billing anchor', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-15'),
        period: 'month',
      })

      vi.setSystemTime(new Date('2024-02-10')) // Before anchor day

      const period = await meter.getCurrentBillingPeriod('cust_123')

      expect(period.startDate).toEqual(new Date('2024-01-15'))
      expect(period.endDate).toEqual(new Date('2024-02-15'))
    })
  })

  // =============================================================================
  // Usage Rollover Tests
  // =============================================================================

  describe('usage rollover', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should configure rollover policy', async () => {
      await meter.setRolloverPolicy('cust_123', 'api_calls', {
        enabled: true,
        maxRollover: 5000,
        expirationPeriods: 3,
      })

      const policy = await meter.getRolloverPolicy('cust_123', 'api_calls')

      expect(policy?.enabled).toBe(true)
      expect(policy?.maxRollover).toBe(5000)
    })

    it('should rollover unused quota to next period', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 10000,
        period: 'billing_cycle',
        action: 'warn',
      })

      await meter.setRolloverPolicy('cust_123', 'api_calls', {
        enabled: true,
        maxRollover: 5000,
      })

      // Use 7000 of 10000 in January
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 7000,
        timestamp: new Date('2024-01-15'),
      })

      vi.setSystemTime(new Date('2024-02-05'))

      // Should have 10000 + 3000 rollover = 13000 available
      const status = await meter.checkLimit('cust_123', 'api_calls')

      expect(status.limit).toBe(13000)
      expect(status.rollover).toBe(3000)
    })

    it('should cap rollover at max limit', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 10000,
        period: 'billing_cycle',
        action: 'warn',
      })

      await meter.setRolloverPolicy('cust_123', 'api_calls', {
        enabled: true,
        maxRollover: 2000, // Cap at 2000
      })

      // Use 5000 of 10000 (unused: 5000, but cap is 2000)
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 5000,
        timestamp: new Date('2024-01-15'),
      })

      vi.setSystemTime(new Date('2024-02-05'))

      const status = await meter.checkLimit('cust_123', 'api_calls')

      expect(status.rollover).toBe(2000) // Capped at max
      expect(status.limit).toBe(12000)
    })

    it('should expire rollover after specified periods', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 10000,
        period: 'billing_cycle',
        action: 'warn',
      })

      await meter.setRolloverPolicy('cust_123', 'api_calls', {
        enabled: true,
        maxRollover: 5000,
        expirationPeriods: 2, // Expires after 2 months
      })

      // Rollover from January
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 7000,
        timestamp: new Date('2024-01-15'),
      })

      // February - rollover available
      vi.setSystemTime(new Date('2024-02-05'))
      let status = await meter.checkLimit('cust_123', 'api_calls')
      expect(status.rollover).toBe(3000)

      // March - rollover still available
      vi.setSystemTime(new Date('2024-03-05'))
      status = await meter.checkLimit('cust_123', 'api_calls')
      expect(status.rollover).toBe(3000)

      // April - rollover expired
      vi.setSystemTime(new Date('2024-04-05'))
      status = await meter.checkLimit('cust_123', 'api_calls')
      expect(status.rollover).toBe(0)
    })

    it('should track rollover history', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 10000,
        period: 'billing_cycle',
        action: 'warn',
      })

      await meter.setRolloverPolicy('cust_123', 'api_calls', {
        enabled: true,
        maxRollover: 5000,
      })

      // January: use 8000
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 8000,
        timestamp: new Date('2024-01-15'),
      })

      // February: use 6000
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 6000,
        timestamp: new Date('2024-02-15'),
      })

      vi.setSystemTime(new Date('2024-03-05'))

      const history = await meter.getRolloverHistory('cust_123', 'api_calls')

      expect(history).toHaveLength(2)
      expect(history[0].period).toEqual(new Date('2024-01-01'))
      expect(history[0].rolledOver).toBe(2000)
    })

    it('should disable rollover', async () => {
      await meter.setRolloverPolicy('cust_123', 'api_calls', {
        enabled: false,
      })

      const policy = await meter.getRolloverPolicy('cust_123', 'api_calls')

      expect(policy?.enabled).toBe(false)
    })
  })

  // =============================================================================
  // Real-time vs Batch Reporting Tests
  // =============================================================================

  describe('real-time vs batch reporting', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should configure reporting mode', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'real-time',
      })

      const config = await meter.getReportingMode('cust_123', 'api_calls')

      expect(config?.mode).toBe('real-time')
    })

    it('should update aggregates immediately in real-time mode', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'real-time',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100,
      })

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'day',
        date: new Date(),
      })

      expect(aggregate.total).toBe(100)
    })

    it('should buffer events in batch mode', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'batch',
        flushInterval: 60000, // 1 minute
        batchSize: 100,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 50,
      })

      // Events are buffered, not yet aggregated
      const pending = await meter.getPendingEvents('cust_123', 'api_calls')
      expect(pending).toHaveLength(1)
    })

    it('should flush batch when size threshold reached', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'batch',
        batchSize: 3,
      })

      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 10 })
      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 20 })
      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 30 })

      // Batch should be flushed after 3 events
      const pending = await meter.getPendingEvents('cust_123', 'api_calls')
      expect(pending).toHaveLength(0)

      const aggregate = await meter.getAggregate({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'day',
        date: new Date(),
      })
      expect(aggregate.total).toBe(60)
    })

    it('should flush batch manually', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'batch',
        batchSize: 100, // High threshold
      })

      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 50 })

      // Manual flush
      await meter.flushPending('cust_123', 'api_calls')

      const pending = await meter.getPendingEvents('cust_123', 'api_calls')
      expect(pending).toHaveLength(0)
    })

    it('should flush all pending events for customer', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', { mode: 'batch', batchSize: 100 })
      await meter.setReportingMode('cust_123', 'storage_gb', { mode: 'batch', batchSize: 100 })

      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 50 })
      await meter.recordEvent({ customerId: 'cust_123', metricId: 'storage_gb', quantity: 10 })

      await meter.flushAllPending('cust_123')

      const pendingCalls = await meter.getPendingEvents('cust_123', 'api_calls')
      const pendingStorage = await meter.getPendingEvents('cust_123', 'storage_gb')

      expect(pendingCalls).toHaveLength(0)
      expect(pendingStorage).toHaveLength(0)
    })

    it('should support hybrid mode with immediate limits', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'batch',
        immediateForLimits: true, // Check limits immediately even in batch mode
      })

      await meter.setLimit('cust_123', 'api_calls', {
        limit: 100,
        period: 'day',
        action: 'block',
      })

      // Should still enforce limits in real-time
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 100,
        enforceLimit: true,
      })

      await expect(
        meter.recordEvent({
          customerId: 'cust_123',
          metricId: 'api_calls',
          quantity: 1,
          enforceLimit: true,
        })
      ).rejects.toThrow('Usage limit exceeded')
    })

    it('should report sync status', async () => {
      await meter.setReportingMode('cust_123', 'api_calls', {
        mode: 'batch',
        batchSize: 100,
      })

      await meter.recordEvent({ customerId: 'cust_123', metricId: 'api_calls', quantity: 50 })

      const status = await meter.getSyncStatus('cust_123', 'api_calls')

      expect(status.pendingEvents).toBe(1)
      expect(status.lastFlushed).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Usage-based Pricing Calculation Tests
  // =============================================================================

  describe('usage-based pricing calculation', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should calculate simple per-unit pricing', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.001,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10000,
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.total).toBe(10) // 10000 * $0.001
    })

    it('should calculate pricing with minimum charge', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.001,
        minimumCharge: 5.00,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1000, // Would be $1
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.total).toBe(5) // Minimum charge
      expect(price.minimumApplied).toBe(true)
    })

    it('should calculate pricing with maximum cap', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.01,
        maximumCharge: 100.00,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 50000, // Would be $500
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.total).toBe(100) // Maximum cap
      expect(price.maximumApplied).toBe(true)
    })

    it('should calculate pricing with included units', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.01,
        includedUnits: 1000, // First 1000 free
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 2500,
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.total).toBe(15) // (2500 - 1000) * $0.01
      expect(price.includedUnits).toBe(1000)
      expect(price.billableUnits).toBe(1500)
    })

    it('should calculate overage pricing', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'overage',
        includedUnits: 10000,
        overagePrice: 0.02,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 15000,
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.total).toBe(100) // 5000 overage * $0.02
      expect(price.overage).toBe(5000)
    })

    it('should apply currency formatting', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.001,
        currency: 'EUR',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10000,
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'api_calls',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.currency).toBe('EUR')
    })

    it('should calculate pricing across multiple metrics', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.001,
      })
      await meter.setPricing('cust_123', 'storage_gb', {
        type: 'per_unit',
        pricePerUnit: 0.10,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10000,
        timestamp: new Date('2024-01-15'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'storage_gb',
        quantity: 50,
        timestamp: new Date('2024-01-15'),
      })

      const totalPrice = await meter.calculateTotalPrice({
        customerId: 'cust_123',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(totalPrice.total).toBe(15) // $10 + $5
      expect(totalPrice.breakdown).toHaveLength(2)
    })

    it('should handle fractional pricing correctly', async () => {
      await meter.setPricing('cust_123', 'bandwidth_gb', {
        type: 'per_unit',
        pricePerUnit: 0.085,
        roundingMode: 'half_up',
        decimalPlaces: 2,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'bandwidth_gb',
        quantity: 123,
        timestamp: new Date('2024-01-15'),
      })

      const price = await meter.calculatePeriodPrice({
        customerId: 'cust_123',
        metricId: 'bandwidth_gb',
        period: 'month',
        date: new Date('2024-01-01'),
      })

      expect(price.total).toBe(10.46) // 123 * 0.085 = 10.455 → 10.46
    })
  })

  // =============================================================================
  // Usage Summary for Invoicing Tests
  // =============================================================================

  describe('usage summary for invoicing', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should generate usage summary for billing period', async () => {
      await meter.setBillingCycle('cust_123', {
        anchorDate: new Date('2024-01-01'),
        period: 'month',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 5000,
        timestamp: new Date('2024-01-10'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 3000,
        timestamp: new Date('2024-01-20'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'storage_gb',
        quantity: 50,
        timestamp: new Date('2024-01-15'),
      })

      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
      })

      expect(summary.customerId).toBe('cust_123')
      expect(summary.metrics).toHaveLength(2)
      expect(summary.metrics.find((m) => m.metricId === 'api_calls')?.total).toBe(8000)
      expect(summary.metrics.find((m) => m.metricId === 'storage_gb')?.total).toBe(50)
    })

    it('should include daily breakdown in summary', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1000,
        timestamp: new Date('2024-01-15'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 2000,
        timestamp: new Date('2024-01-16'),
      })

      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-01-17'),
        includeBreakdown: true,
        breakdownPeriod: 'day',
      })

      const apiCallsMetric = summary.metrics.find((m) => m.metricId === 'api_calls')
      expect(apiCallsMetric?.breakdown).toHaveLength(2)
      expect(apiCallsMetric?.breakdown?.[0].total).toBe(1000)
      expect(apiCallsMetric?.breakdown?.[1].total).toBe(2000)
    })

    it('should include pricing in summary', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.001,
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10000,
        timestamp: new Date('2024-01-15'),
      })

      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
        includePricing: true,
      })

      const apiCallsMetric = summary.metrics.find((m) => m.metricId === 'api_calls')
      expect(apiCallsMetric?.price).toBe(10)
      expect(summary.totalPrice).toBe(10)
    })

    it('should include tier information in summary', async () => {
      await meter.configureTiers('cust_123', 'api_calls', {
        type: 'graduated',
        tiers: [
          { upTo: 1000, pricePerUnit: 0 },
          { upTo: 10000, pricePerUnit: 0.005 },
          { upTo: null, pricePerUnit: 0.001 },
        ],
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 5000,
        timestamp: new Date('2024-01-15'),
      })

      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
        includePricing: true,
      })

      const apiCallsMetric = summary.metrics.find((m) => m.metricId === 'api_calls')
      expect(apiCallsMetric?.tierBreakdown).toBeDefined()
      expect(apiCallsMetric?.tierBreakdown?.[0].quantity).toBe(1000) // Free tier
      expect(apiCallsMetric?.tierBreakdown?.[1].quantity).toBe(4000) // Paid tier
    })

    it('should generate invoice line items from summary', async () => {
      await meter.setPricing('cust_123', 'api_calls', {
        type: 'per_unit',
        pricePerUnit: 0.001,
        description: 'API Calls',
      })
      await meter.setPricing('cust_123', 'storage_gb', {
        type: 'per_unit',
        pricePerUnit: 0.10,
        description: 'Storage (GB)',
      })

      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10000,
        timestamp: new Date('2024-01-15'),
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'storage_gb',
        quantity: 50,
        timestamp: new Date('2024-01-15'),
      })

      const lineItems = await meter.generateInvoiceLineItems({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
      })

      expect(lineItems).toHaveLength(2)
      expect(lineItems[0].description).toContain('API Calls')
      expect(lineItems[0].quantity).toBe(10000)
      expect(lineItems[0].amount).toBe(10)
      expect(lineItems[1].description).toContain('Storage')
      expect(lineItems[1].quantity).toBe(50)
      expect(lineItems[1].amount).toBe(5)
    })

    it('should export summary in different formats', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 10000,
        timestamp: new Date('2024-01-15'),
      })

      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
      })

      const json = await meter.exportSummary(summary, 'json')
      const csv = await meter.exportSummary(summary, 'csv')

      expect(JSON.parse(json)).toHaveProperty('metrics')
      expect(csv).toContain('metric_id,total')
    })

    it('should include metadata in summary', async () => {
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 1000,
        timestamp: new Date('2024-01-15'),
        properties: { endpoint: '/api/users' },
      })
      await meter.recordEvent({
        customerId: 'cust_123',
        metricId: 'api_calls',
        quantity: 2000,
        timestamp: new Date('2024-01-15'),
        properties: { endpoint: '/api/orders' },
      })

      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
        groupBy: ['endpoint'],
      })

      const apiCallsMetric = summary.metrics.find((m) => m.metricId === 'api_calls')
      expect(apiCallsMetric?.groups).toBeDefined()
      expect(apiCallsMetric?.groups?.['/api/users']).toBe(1000)
      expect(apiCallsMetric?.groups?.['/api/orders']).toBe(2000)
    })

    it('should handle empty usage period', async () => {
      const summary = await meter.generateSummary({
        customerId: 'cust_123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-01'),
      })

      expect(summary.metrics).toHaveLength(0)
      expect(summary.totalPrice).toBe(0)
    })

    it('should validate date range', async () => {
      await expect(
        meter.generateSummary({
          customerId: 'cust_123',
          startDate: new Date('2024-02-01'),
          endDate: new Date('2024-01-01'), // End before start
        })
      ).rejects.toThrow('End date must be after start date')
    })
  })

  // =============================================================================
  // Metric Configuration Tests
  // =============================================================================

  describe('metric configuration', () => {
    let meter: UsageMeter

    beforeEach(() => {
      meter = createTestMeter()
    })

    it('should register a metric', async () => {
      await meter.registerMetric({
        id: 'api_calls',
        name: 'API Calls',
        description: 'Number of API calls made',
        unit: 'calls',
        aggregation: 'sum',
      })

      const metric = await meter.getMetric('api_calls')

      expect(metric?.id).toBe('api_calls')
      expect(metric?.name).toBe('API Calls')
      expect(metric?.aggregation).toBe('sum')
    })

    it('should list all registered metrics', async () => {
      await meter.registerMetric({ id: 'api_calls', name: 'API Calls', aggregation: 'sum' })
      await meter.registerMetric({ id: 'storage_gb', name: 'Storage', aggregation: 'max' })

      const metrics = await meter.listMetrics()

      expect(metrics).toHaveLength(2)
    })

    it('should update metric configuration', async () => {
      await meter.registerMetric({
        id: 'api_calls',
        name: 'API Calls',
        aggregation: 'sum',
      })

      await meter.updateMetric('api_calls', {
        name: 'API Requests',
        description: 'Total API requests',
      })

      const metric = await meter.getMetric('api_calls')

      expect(metric?.name).toBe('API Requests')
      expect(metric?.description).toBe('Total API requests')
    })

    it('should delete metric', async () => {
      await meter.registerMetric({ id: 'test_metric', name: 'Test', aggregation: 'sum' })
      await meter.deleteMetric('test_metric')

      const metric = await meter.getMetric('test_metric')
      expect(metric).toBeNull()
    })
  })
})
