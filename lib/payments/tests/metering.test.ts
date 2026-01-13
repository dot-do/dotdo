/**
 * Usage Metering Tests (TDD RED Phase)
 *
 * Defines the contract for usage metering system including:
 * - Recording usage events
 * - Aggregating usage by period (hourly, daily, monthly)
 * - Usage-based billing calculation
 * - Tiered pricing evaluation
 * - Overage tracking
 * - Usage alerts and thresholds
 * - Usage rollover between periods
 * - Usage summary reports
 *
 * @module lib/payments/tests/metering.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  UsageMeter,
  createUsageMeter,
  UsageEventRecorder,
  UsageAggregator,
  TieredPricingCalculator,
  OverageTracker,
  UsageAlertManager,
  UsageRollover,
  UsageReportGenerator,
  type UsageEvent,
  type UsagePeriod,
  type AggregatedUsage,
  type TieredPricing,
  type OveragePolicy,
  type UsageAlert,
  type AlertThreshold,
  type RolloverConfig,
  type UsageSummary,
  type UsageReport,
  type MeteringConfig,
} from '../metering'

// ============================================================================
// UsageEventRecorder Tests
// ============================================================================

describe('UsageEventRecorder', () => {
  let recorder: UsageEventRecorder

  beforeEach(() => {
    recorder = new UsageEventRecorder()
  })

  describe('record', () => {
    it('should record a usage event with all required fields', async () => {
      const event: UsageEvent = {
        tenantId: 'tenant-123',
        service: 'llm.do',
        metric: 'tokens',
        value: 1500,
        timestamp: new Date('2026-01-13T10:00:00Z'),
      }

      const recorded = await recorder.record(event)

      expect(recorded.id).toBeDefined()
      expect(recorded.tenantId).toBe('tenant-123')
      expect(recorded.service).toBe('llm.do')
      expect(recorded.metric).toBe('tokens')
      expect(recorded.value).toBe(1500)
    })

    it('should auto-generate timestamp if not provided', async () => {
      const event = {
        tenantId: 'tenant-123',
        service: 'llm.do',
        metric: 'tokens',
        value: 1500,
      }

      const recorded = await recorder.record(event)

      expect(recorded.timestamp).toBeInstanceOf(Date)
    })

    it('should record events with optional metadata', async () => {
      const event: UsageEvent = {
        tenantId: 'tenant-123',
        service: 'agents.do',
        metric: 'invocations',
        value: 1,
        metadata: {
          agentId: 'agent-456',
          model: 'claude-3-opus',
          inputTokens: 500,
          outputTokens: 200,
        },
      }

      const recorded = await recorder.record(event)

      expect(recorded.metadata?.agentId).toBe('agent-456')
      expect(recorded.metadata?.model).toBe('claude-3-opus')
    })

    it('should batch multiple events efficiently', async () => {
      const events: UsageEvent[] = [
        { tenantId: 'tenant-123', service: 'llm.do', metric: 'tokens', value: 1000 },
        { tenantId: 'tenant-123', service: 'llm.do', metric: 'tokens', value: 500 },
        { tenantId: 'tenant-123', service: 'emails.do', metric: 'sent', value: 10 },
      ]

      const recorded = await recorder.recordBatch(events)

      expect(recorded).toHaveLength(3)
      expect(recorded.every((e) => e.id !== undefined)).toBe(true)
    })

    it('should reject events with invalid values', async () => {
      const event: UsageEvent = {
        tenantId: 'tenant-123',
        service: 'llm.do',
        metric: 'tokens',
        value: -100, // Invalid negative value
      }

      await expect(recorder.record(event)).rejects.toThrow('invalid_value')
    })

    it('should reject events missing required fields', async () => {
      const event = {
        tenantId: 'tenant-123',
        // Missing service and metric
        value: 100,
      } as UsageEvent

      await expect(recorder.record(event)).rejects.toThrow('missing_required_field')
    })
  })

  describe('query', () => {
    it('should query events by tenant', async () => {
      await recorder.record({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 100 })
      await recorder.record({ tenantId: 'tenant-2', service: 'llm.do', metric: 'tokens', value: 200 })

      const events = await recorder.query({ tenantId: 'tenant-1' })

      expect(events).toHaveLength(1)
      expect(events[0].tenantId).toBe('tenant-1')
    })

    it('should query events by time range', async () => {
      vi.setSystemTime(new Date('2026-01-13T10:00:00Z'))
      await recorder.record({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 100 })

      vi.setSystemTime(new Date('2026-01-13T12:00:00Z'))
      await recorder.record({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 200 })

      const events = await recorder.query({
        tenantId: 'tenant-1',
        from: new Date('2026-01-13T11:00:00Z'),
        to: new Date('2026-01-13T13:00:00Z'),
      })

      expect(events).toHaveLength(1)
      expect(events[0].value).toBe(200)

      vi.useRealTimers()
    })

    it('should query events by service and metric', async () => {
      await recorder.record({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 100 })
      await recorder.record({ tenantId: 'tenant-1', service: 'emails.do', metric: 'sent', value: 10 })

      const events = await recorder.query({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
      })

      expect(events).toHaveLength(1)
      expect(events[0].service).toBe('llm.do')
    })
  })
})

// ============================================================================
// UsageAggregator Tests - Aggregate usage by period
// ============================================================================

describe('UsageAggregator', () => {
  let aggregator: UsageAggregator

  beforeEach(() => {
    aggregator = new UsageAggregator()
  })

  describe('aggregateByPeriod', () => {
    it('should aggregate usage hourly', async () => {
      const events: UsageEvent[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 500, timestamp: new Date('2026-01-13T10:15:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 300, timestamp: new Date('2026-01-13T10:45:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 200, timestamp: new Date('2026-01-13T11:15:00Z') },
      ]

      const aggregated = await aggregator.aggregateByPeriod(events, 'hourly')

      expect(aggregated).toHaveLength(2) // Two hours
      const hour10 = aggregated.find((a) => a.periodStart.getHours() === 10)
      expect(hour10?.totalValue).toBe(800) // 500 + 300
      expect(hour10?.eventCount).toBe(2)
    })

    it('should aggregate usage daily', async () => {
      const events: UsageEvent[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 1000, timestamp: new Date('2026-01-13T08:00:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 2000, timestamp: new Date('2026-01-13T14:00:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 1500, timestamp: new Date('2026-01-14T10:00:00Z') },
      ]

      const aggregated = await aggregator.aggregateByPeriod(events, 'daily')

      expect(aggregated).toHaveLength(2) // Two days
      const jan13 = aggregated.find((a) => a.periodStart.getDate() === 13)
      expect(jan13?.totalValue).toBe(3000) // 1000 + 2000
    })

    it('should aggregate usage monthly', async () => {
      const events: UsageEvent[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 10000, timestamp: new Date('2026-01-05T10:00:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 15000, timestamp: new Date('2026-01-20T10:00:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 5000, timestamp: new Date('2026-02-05T10:00:00Z') },
      ]

      const aggregated = await aggregator.aggregateByPeriod(events, 'monthly')

      expect(aggregated).toHaveLength(2) // Two months
      const jan = aggregated.find((a) => a.periodStart.getMonth() === 0)
      expect(jan?.totalValue).toBe(25000) // 10000 + 15000
    })

    it('should calculate statistics for aggregated periods', async () => {
      const events: UsageEvent[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 100, timestamp: new Date('2026-01-13T10:00:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 500, timestamp: new Date('2026-01-13T10:30:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 200, timestamp: new Date('2026-01-13T10:45:00Z') },
      ]

      const aggregated = await aggregator.aggregateByPeriod(events, 'hourly')

      expect(aggregated[0].minValue).toBe(100)
      expect(aggregated[0].maxValue).toBe(500)
      expect(aggregated[0].avgValue).toBeCloseTo(266.67, 1)
      expect(aggregated[0].eventCount).toBe(3)
    })

    it('should group by service and metric', async () => {
      const events: UsageEvent[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 1000, timestamp: new Date('2026-01-13T10:00:00Z') },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'requests', value: 5, timestamp: new Date('2026-01-13T10:00:00Z') },
        { tenantId: 'tenant-1', service: 'emails.do', metric: 'sent', value: 10, timestamp: new Date('2026-01-13T10:00:00Z') },
      ]

      const aggregated = await aggregator.aggregateByPeriod(events, 'hourly', { groupBy: ['service', 'metric'] })

      expect(aggregated).toHaveLength(3) // Three different service:metric combinations
    })
  })

  describe('rollup', () => {
    it('should rollup hourly aggregates to daily', async () => {
      const hourlyAggregates: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'hourly', periodStart: new Date('2026-01-13T10:00:00Z'), periodEnd: new Date('2026-01-13T11:00:00Z'), totalValue: 1000, eventCount: 5, minValue: 100, maxValue: 300, avgValue: 200 },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'hourly', periodStart: new Date('2026-01-13T11:00:00Z'), periodEnd: new Date('2026-01-13T12:00:00Z'), totalValue: 2000, eventCount: 8, minValue: 150, maxValue: 400, avgValue: 250 },
      ]

      const daily = await aggregator.rollup(hourlyAggregates, 'daily')

      expect(daily).toHaveLength(1)
      expect(daily[0].totalValue).toBe(3000)
      expect(daily[0].eventCount).toBe(13)
      expect(daily[0].minValue).toBe(100) // Min across all hourly
      expect(daily[0].maxValue).toBe(400) // Max across all hourly
    })
  })
})

// ============================================================================
// TieredPricingCalculator Tests - Usage-based billing with tiers
// ============================================================================

describe('TieredPricingCalculator', () => {
  let calculator: TieredPricingCalculator

  beforeEach(() => {
    calculator = new TieredPricingCalculator()
  })

  describe('calculateCost', () => {
    it('should calculate cost for flat rate pricing', () => {
      const pricing: TieredPricing = {
        type: 'flat',
        unitPrice: 0.01, // $0.01 per token
      }

      const cost = calculator.calculateCost(10000, pricing)

      expect(cost).toBe(100) // 10000 * 0.01 = $100
    })

    it('should calculate cost for volume tiered pricing', () => {
      const pricing: TieredPricing = {
        type: 'volume',
        tiers: [
          { upTo: 1000, unitPrice: 0.02 },
          { upTo: 10000, unitPrice: 0.015 },
          { upTo: null, unitPrice: 0.01 }, // Unlimited
        ],
      }

      // 5000 tokens at $0.015 (volume pricing uses single tier rate)
      const cost = calculator.calculateCost(5000, pricing)

      expect(cost).toBe(75) // 5000 * 0.015 = $75
    })

    it('should calculate cost for graduated tiered pricing', () => {
      const pricing: TieredPricing = {
        type: 'graduated',
        tiers: [
          { upTo: 1000, unitPrice: 0.02 },
          { upTo: 5000, unitPrice: 0.015 },
          { upTo: null, unitPrice: 0.01 },
        ],
      }

      // First 1000 at $0.02, next 4000 at $0.015, remaining at $0.01
      const cost = calculator.calculateCost(10000, pricing)

      // 1000 * 0.02 + 4000 * 0.015 + 5000 * 0.01 = 20 + 60 + 50 = $130
      expect(cost).toBe(130)
    })

    it('should handle package pricing (bundles)', () => {
      const pricing: TieredPricing = {
        type: 'package',
        packageSize: 1000,
        packagePrice: 5, // $5 per 1000 tokens
      }

      // 2500 tokens = 3 packages (rounds up)
      const cost = calculator.calculateCost(2500, pricing)

      expect(cost).toBe(15) // 3 * $5 = $15
    })

    it('should calculate cost with included units (freemium)', () => {
      const pricing: TieredPricing = {
        type: 'graduated',
        includedUnits: 500, // First 500 free
        tiers: [
          { upTo: null, unitPrice: 0.01 },
        ],
      }

      const cost = calculator.calculateCost(1500, pricing)

      expect(cost).toBe(10) // (1500 - 500) * 0.01 = $10
    })

    it('should return 0 when usage is within free tier', () => {
      const pricing: TieredPricing = {
        type: 'graduated',
        includedUnits: 1000,
        tiers: [
          { upTo: null, unitPrice: 0.01 },
        ],
      }

      const cost = calculator.calculateCost(500, pricing)

      expect(cost).toBe(0)
    })

    it('should apply minimum charge', () => {
      const pricing: TieredPricing = {
        type: 'flat',
        unitPrice: 0.001,
        minimumCharge: 1, // $1 minimum
      }

      // 100 tokens * 0.001 = $0.10, but minimum is $1
      const cost = calculator.calculateCost(100, pricing)

      expect(cost).toBe(1)
    })

    it('should apply maximum charge (cap)', () => {
      const pricing: TieredPricing = {
        type: 'flat',
        unitPrice: 0.01,
        maximumCharge: 1000, // $1000 cap
      }

      // 200000 tokens * 0.01 = $2000, but cap is $1000
      const cost = calculator.calculateCost(200000, pricing)

      expect(cost).toBe(1000)
    })
  })

  describe('evaluateTier', () => {
    it('should return the current tier for given usage', () => {
      const pricing: TieredPricing = {
        type: 'volume',
        tiers: [
          { upTo: 1000, unitPrice: 0.02, name: 'starter' },
          { upTo: 10000, unitPrice: 0.015, name: 'growth' },
          { upTo: null, unitPrice: 0.01, name: 'enterprise' },
        ],
      }

      expect(calculator.evaluateTier(500, pricing).name).toBe('starter')
      expect(calculator.evaluateTier(5000, pricing).name).toBe('growth')
      expect(calculator.evaluateTier(50000, pricing).name).toBe('enterprise')
    })
  })
})

// ============================================================================
// OverageTracker Tests - Track and manage usage overages
// ============================================================================

describe('OverageTracker', () => {
  let tracker: OverageTracker

  beforeEach(() => {
    tracker = new OverageTracker()
  })

  describe('checkOverage', () => {
    it('should detect when usage exceeds quota', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'charge',
      }

      const result = tracker.checkOverage('tenant-1', 12000, policy)

      expect(result.isOverage).toBe(true)
      expect(result.overageAmount).toBe(2000)
      expect(result.percentUsed).toBe(1.2)
    })

    it('should return no overage when under quota', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'charge',
      }

      const result = tracker.checkOverage('tenant-1', 5000, policy)

      expect(result.isOverage).toBe(false)
      expect(result.overageAmount).toBe(0)
      expect(result.percentUsed).toBe(0.5)
    })

    it('should enforce hard limit (block) on overage', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'block',
      }

      const result = tracker.checkOverage('tenant-1', 12000, policy)

      expect(result.isOverage).toBe(true)
      expect(result.shouldBlock).toBe(true)
    })

    it('should allow overage with charge action', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'charge',
        overageRate: 0.02, // $0.02 per unit overage
      }

      const result = tracker.checkOverage('tenant-1', 12000, policy)

      expect(result.isOverage).toBe(true)
      expect(result.shouldBlock).toBe(false)
      expect(result.overageCharge).toBe(40) // 2000 * 0.02
    })

    it('should support soft limit with warning', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'warn',
      }

      const result = tracker.checkOverage('tenant-1', 12000, policy)

      expect(result.isOverage).toBe(true)
      expect(result.shouldBlock).toBe(false)
      expect(result.warning).toBeDefined()
    })

    it('should track overage history', async () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'charge',
      }

      tracker.checkOverage('tenant-1', 12000, policy)
      tracker.checkOverage('tenant-1', 15000, policy)

      const history = await tracker.getOverageHistory('tenant-1')

      expect(history).toHaveLength(2)
      expect(history[0].overageAmount).toBe(2000)
      expect(history[1].overageAmount).toBe(5000)
    })
  })

  describe('applyGracePeriod', () => {
    it('should allow overage during grace period', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'block',
        gracePeriod: 0.1, // 10% grace
      }

      // 10500 is within 10% grace period
      const result = tracker.checkOverage('tenant-1', 10500, policy)

      expect(result.isOverage).toBe(true)
      expect(result.shouldBlock).toBe(false)
      expect(result.inGracePeriod).toBe(true)
    })

    it('should block when grace period exceeded', () => {
      const policy: OveragePolicy = {
        quota: 10000,
        period: 'monthly',
        action: 'block',
        gracePeriod: 0.1, // 10% grace (11000)
      }

      // 12000 exceeds 10% grace period
      const result = tracker.checkOverage('tenant-1', 12000, policy)

      expect(result.isOverage).toBe(true)
      expect(result.shouldBlock).toBe(true)
      expect(result.inGracePeriod).toBe(false)
    })
  })
})

// ============================================================================
// UsageAlertManager Tests - Usage alerts and thresholds
// ============================================================================

describe('UsageAlertManager', () => {
  let alertManager: UsageAlertManager

  beforeEach(() => {
    alertManager = new UsageAlertManager()
  })

  describe('setThreshold', () => {
    it('should create an alert threshold', () => {
      const threshold: AlertThreshold = {
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8, // Alert at 80%
        criticalPercent: 0.95, // Critical at 95%
      }

      alertManager.setThreshold(threshold)

      const thresholds = alertManager.getThresholds('tenant-1')
      expect(thresholds).toHaveLength(1)
      expect(thresholds[0].limit).toBe(10000)
    })

    it('should support multiple thresholds per tenant', () => {
      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
      })

      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'emails.do',
        metric: 'sent',
        limit: 1000,
        warningPercent: 0.9,
      })

      const thresholds = alertManager.getThresholds('tenant-1')
      expect(thresholds).toHaveLength(2)
    })
  })

  describe('checkThresholds', () => {
    it('should trigger warning alert when threshold exceeded', async () => {
      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
      })

      const alerts = await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 8500)

      expect(alerts).toHaveLength(1)
      expect(alerts[0].level).toBe('warning')
      expect(alerts[0].percentUsed).toBe(0.85)
    })

    it('should trigger critical alert when critical threshold exceeded', async () => {
      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
        criticalPercent: 0.95,
      })

      const alerts = await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 9700)

      expect(alerts).toHaveLength(1)
      expect(alerts[0].level).toBe('critical')
    })

    it('should not trigger alert when below threshold', async () => {
      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
      })

      const alerts = await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 5000)

      expect(alerts).toHaveLength(0)
    })

    it('should trigger limit exceeded alert', async () => {
      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
      })

      const alerts = await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 12000)

      expect(alerts).toHaveLength(1)
      expect(alerts[0].level).toBe('exceeded')
    })
  })

  describe('subscribeToAlerts', () => {
    it('should notify subscribers when alerts are triggered', async () => {
      const handler = vi.fn()

      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
      })

      alertManager.subscribe('tenant-1', handler)
      await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 8500)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          tenantId: 'tenant-1',
        })
      )
    })

    it('should not duplicate alerts within cooldown period', async () => {
      const handler = vi.fn()

      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
        cooldownMinutes: 60, // 1 hour cooldown
      })

      alertManager.subscribe('tenant-1', handler)

      await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 8500)
      await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 8600)

      expect(handler).toHaveBeenCalledTimes(1) // Only once due to cooldown
    })
  })

  describe('getAlertHistory', () => {
    it('should return alert history for a tenant', async () => {
      alertManager.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 10000,
        warningPercent: 0.8,
        cooldownMinutes: 0, // No cooldown for testing
      })

      await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 8500)
      await alertManager.checkThresholds('tenant-1', 'llm.do', 'tokens', 9500)

      const history = await alertManager.getAlertHistory('tenant-1')

      expect(history).toHaveLength(2)
    })
  })
})

// ============================================================================
// UsageRollover Tests - Usage rollover between periods
// ============================================================================

describe('UsageRollover', () => {
  let rollover: UsageRollover

  beforeEach(() => {
    rollover = new UsageRollover()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('configureRollover', () => {
    it('should configure rollover settings', () => {
      const config: RolloverConfig = {
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.5, // 50% max rollover
        maxRolloverPeriods: 3, // Roll over for up to 3 periods
      }

      rollover.configure(config)

      const savedConfig = rollover.getConfig('tenant-1', 'llm.do', 'tokens')
      expect(savedConfig?.enabled).toBe(true)
      expect(savedConfig?.maxRolloverPercent).toBe(0.5)
    })
  })

  describe('calculateRollover', () => {
    it('should calculate rollover for unused quota', () => {
      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.5,
        maxRolloverPeriods: 3,
      })

      const result = rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 6000,
        period: 'monthly',
      })

      // 4000 unused, 50% max = 2000 rollover
      expect(result.rolloverAmount).toBe(2000)
    })

    it('should cap rollover at max percent', () => {
      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.2, // Only 20% max
        maxRolloverPeriods: 3,
      })

      const result = rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 0, // All unused
        period: 'monthly',
      })

      // 10000 unused, but 20% max = 2000 rollover
      expect(result.rolloverAmount).toBe(2000)
    })

    it('should return 0 when rollover is disabled', () => {
      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: false,
        maxRolloverPercent: 0.5,
        maxRolloverPeriods: 3,
      })

      const result = rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 5000,
        period: 'monthly',
      })

      expect(result.rolloverAmount).toBe(0)
    })

    it('should return 0 when usage exceeds quota', () => {
      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.5,
        maxRolloverPeriods: 3,
      })

      const result = rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 12000, // Over quota
        period: 'monthly',
      })

      expect(result.rolloverAmount).toBe(0)
    })
  })

  describe('applyRollover', () => {
    it('should apply accumulated rollover to new period', () => {
      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.5,
        maxRolloverPeriods: 3,
      })

      // First period: accumulate rollover
      rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 6000,
        period: 'monthly',
      })

      // Apply to new period
      const effectiveQuota = rollover.applyRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        baseQuota: 10000,
        period: 'monthly',
      })

      expect(effectiveQuota).toBe(12000) // 10000 base + 2000 rollover
    })

    it('should expire rollover after max periods', () => {
      vi.useFakeTimers()

      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.5,
        maxRolloverPeriods: 2, // Only 2 periods
      })

      // Month 1: accumulate
      vi.setSystemTime(new Date('2026-01-01'))
      rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 6000,
        period: 'monthly',
      })

      // Month 4: rollover should be expired
      vi.setSystemTime(new Date('2026-04-01'))
      const effectiveQuota = rollover.applyRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        baseQuota: 10000,
        period: 'monthly',
      })

      expect(effectiveQuota).toBe(10000) // No rollover, it expired

      vi.useRealTimers()
    })
  })

  describe('getRolloverBalance', () => {
    it('should return current rollover balance', () => {
      rollover.configure({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        enabled: true,
        maxRolloverPercent: 0.5,
        maxRolloverPeriods: 3,
      })

      rollover.calculateRollover({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        used: 6000,
        period: 'monthly',
      })

      const balance = rollover.getRolloverBalance('tenant-1', 'llm.do', 'tokens')

      expect(balance).toBe(2000)
    })
  })
})

// ============================================================================
// UsageReportGenerator Tests - Usage summary reports
// ============================================================================

describe('UsageReportGenerator', () => {
  let generator: UsageReportGenerator

  beforeEach(() => {
    generator = new UsageReportGenerator()
  })

  describe('generateSummary', () => {
    it('should generate a usage summary for a tenant', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'monthly', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), totalValue: 50000, eventCount: 100, minValue: 100, maxValue: 2000, avgValue: 500 },
        { tenantId: 'tenant-1', service: 'emails.do', metric: 'sent', period: 'monthly', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), totalValue: 500, eventCount: 50, minValue: 5, maxValue: 20, avgValue: 10 },
      ]

      const summary = await generator.generateSummary('tenant-1', usage)

      expect(summary.tenantId).toBe('tenant-1')
      expect(summary.totalCost).toBeGreaterThan(0)
      expect(summary.byService['llm.do']).toBeDefined()
      expect(summary.byService['emails.do']).toBeDefined()
    })

    it('should include quota and overage information', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'monthly', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), totalValue: 15000, eventCount: 50, minValue: 100, maxValue: 1000, avgValue: 300 },
      ]

      const quota = { 'llm.do:tokens': 10000 }

      const summary = await generator.generateSummary('tenant-1', usage, { quotas: quota })

      expect(summary.byService['llm.do'].quota).toBe(10000)
      expect(summary.byService['llm.do'].used).toBe(15000)
      expect(summary.byService['llm.do'].overage).toBe(5000)
      expect(summary.byService['llm.do'].percentUsed).toBe(1.5)
    })
  })

  describe('generateReport', () => {
    it('should generate a detailed usage report', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'daily', periodStart: new Date('2026-01-13'), periodEnd: new Date('2026-01-14'), totalValue: 5000, eventCount: 20, minValue: 100, maxValue: 500, avgValue: 250 },
      ]

      const report = await generator.generateReport('tenant-1', {
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
        granularity: 'daily',
        usage,
      })

      expect(report.tenantId).toBe('tenant-1')
      expect(report.period.from).toEqual(new Date('2026-01-01'))
      expect(report.period.to).toEqual(new Date('2026-01-31'))
      expect(report.granularity).toBe('daily')
      expect(report.breakdown).toHaveLength(1)
    })

    it('should include trend analysis', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'daily', periodStart: new Date('2026-01-10'), periodEnd: new Date('2026-01-11'), totalValue: 4000, eventCount: 10, minValue: 200, maxValue: 600, avgValue: 400 },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'daily', periodStart: new Date('2026-01-11'), periodEnd: new Date('2026-01-12'), totalValue: 5000, eventCount: 12, minValue: 200, maxValue: 700, avgValue: 416 },
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'daily', periodStart: new Date('2026-01-12'), periodEnd: new Date('2026-01-13'), totalValue: 6000, eventCount: 15, minValue: 200, maxValue: 800, avgValue: 400 },
      ]

      const report = await generator.generateReport('tenant-1', {
        from: new Date('2026-01-10'),
        to: new Date('2026-01-13'),
        granularity: 'daily',
        usage,
        includeTrends: true,
      })

      expect(report.trends).toBeDefined()
      expect(report.trends?.['llm.do:tokens'].direction).toBe('increasing')
      expect(report.trends?.['llm.do:tokens'].changePercent).toBeGreaterThan(0)
    })

    it('should include cost breakdown', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'monthly', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), totalValue: 10000, eventCount: 50, minValue: 100, maxValue: 500, avgValue: 200 },
        { tenantId: 'tenant-1', service: 'emails.do', metric: 'sent', period: 'monthly', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), totalValue: 100, eventCount: 100, minValue: 1, maxValue: 1, avgValue: 1 },
      ]

      const report = await generator.generateReport('tenant-1', {
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
        granularity: 'monthly',
        usage,
        includeCosts: true,
      })

      expect(report.costs).toBeDefined()
      expect(report.costs?.total).toBeGreaterThan(0)
      expect(report.costs?.byService['llm.do']).toBeDefined()
      expect(report.costs?.byService['emails.do']).toBeDefined()
    })

    it('should support CSV export format', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'daily', periodStart: new Date('2026-01-13'), periodEnd: new Date('2026-01-14'), totalValue: 5000, eventCount: 20, minValue: 100, maxValue: 500, avgValue: 250 },
      ]

      const csv = await generator.exportReport('tenant-1', {
        from: new Date('2026-01-13'),
        to: new Date('2026-01-14'),
        usage,
        format: 'csv',
      })

      expect(csv).toContain('tenant,service,metric,period_start,total_value,cost')
      expect(csv).toContain('tenant-1,llm.do,tokens')
    })

    it('should support JSON export format', async () => {
      const usage: AggregatedUsage[] = [
        { tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', period: 'daily', periodStart: new Date('2026-01-13'), periodEnd: new Date('2026-01-14'), totalValue: 5000, eventCount: 20, minValue: 100, maxValue: 500, avgValue: 250 },
      ]

      const json = await generator.exportReport('tenant-1', {
        from: new Date('2026-01-13'),
        to: new Date('2026-01-14'),
        usage,
        format: 'json',
      })

      const parsed = JSON.parse(json)
      expect(parsed.tenantId).toBe('tenant-1')
      expect(parsed.usage).toHaveLength(1)
    })
  })
})

// ============================================================================
// UsageMeter Integration Tests
// ============================================================================

describe('UsageMeter', () => {
  let meter: UsageMeter

  beforeEach(() => {
    meter = createUsageMeter()
  })

  afterEach(() => {
    meter.dispose()
  })

  describe('track', () => {
    it('should track usage end-to-end', async () => {
      await meter.track({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        value: 1500,
      })

      const usage = await meter.getUsage('tenant-1', {
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
      })

      expect(usage.totalValue).toBe(1500)
    })

    it('should check limits before tracking', async () => {
      meter.setLimit('tenant-1', {
        service: 'llm.do',
        metric: 'tokens',
        quota: 1000,
        period: 'monthly',
        action: 'block',
      })

      await meter.track({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 500 })

      // Should be blocked as it exceeds limit
      await expect(
        meter.track({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 600 })
      ).rejects.toThrow('quota_exceeded')
    })

    it('should trigger alerts when thresholds crossed', async () => {
      const alertHandler = vi.fn()

      meter.setThreshold({
        tenantId: 'tenant-1',
        service: 'llm.do',
        metric: 'tokens',
        limit: 1000,
        warningPercent: 0.8,
      })

      meter.onAlert('tenant-1', alertHandler)

      await meter.track({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 850 })

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warning' })
      )
    })
  })

  describe('getInvoice', () => {
    it('should generate an invoice for a billing period', async () => {
      await meter.track({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 10000 })
      await meter.track({ tenantId: 'tenant-1', service: 'emails.do', metric: 'sent', value: 100 })

      const invoice = await meter.getInvoice('tenant-1', {
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
      })

      expect(invoice.tenantId).toBe('tenant-1')
      expect(invoice.lineItems).toHaveLength(2)
      expect(invoice.total).toBeGreaterThan(0)
    })
  })

  describe('reset', () => {
    it('should reset usage for a new period', async () => {
      await meter.track({ tenantId: 'tenant-1', service: 'llm.do', metric: 'tokens', value: 5000 })

      await meter.resetPeriod('tenant-1', 'monthly')

      const usage = await meter.getUsage('tenant-1', {
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
      })

      expect(usage.totalValue).toBe(0)
    })
  })
})
