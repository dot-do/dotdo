/**
 * Usage Metering System Tests
 *
 * TDD tests for the metering system including:
 * - Counter increment/query
 * - Aggregation to Parquet
 * - Limit enforcement
 * - Multi-service usage
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  UsageMetering,
  InMemoryCounterStorage,
  InMemoryAggregationSink,
  UsageLimiter,
} from '../src/index'
import type {
  UsageLimit,
  UsageQuery,
  CounterKey,
  BillingPeriod,
  MeteringService,
} from '../src/types'

// ============================================================================
// Counter Tests
// ============================================================================

describe('UsageCounter', () => {
  let storage: InMemoryCounterStorage

  beforeEach(() => {
    storage = new InMemoryCounterStorage()
  })

  describe('increment', () => {
    it('should increment a counter atomically', async () => {
      const key: CounterKey = {
        agentId: 'agent-123',
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
        periodTimestamp: new Date('2026-01-01'),
      }

      const result = await storage.increment(key, 1500)
      expect(result).toBe(1500)

      const result2 = await storage.increment(key, 500)
      expect(result2).toBe(2000)
    })

    it('should handle concurrent increments', async () => {
      const key: CounterKey = {
        agentId: 'agent-123',
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
        periodTimestamp: new Date('2026-01-01'),
      }

      // Simulate concurrent increments
      const promises = Array(10)
        .fill(null)
        .map(() => storage.increment(key, 100))
      await Promise.all(promises)

      const value = await storage.get(key)
      expect(value).toBe(1000)
    })

    it('should track different metrics separately', async () => {
      const base = {
        agentId: 'agent-123',
        period: 'monthly' as BillingPeriod,
        periodTimestamp: new Date('2026-01-01'),
      }

      await storage.increment({ ...base, service: 'llm.do', metric: 'tokens' }, 1000)
      await storage.increment({ ...base, service: 'llm.do', metric: 'requests' }, 5)
      await storage.increment({ ...base, service: 'emails.do', metric: 'sent' }, 10)

      const tokens = await storage.get({ ...base, service: 'llm.do', metric: 'tokens' })
      const requests = await storage.get({ ...base, service: 'llm.do', metric: 'requests' })
      const emails = await storage.get({ ...base, service: 'emails.do', metric: 'sent' })

      expect(tokens).toBe(1000)
      expect(requests).toBe(5)
      expect(emails).toBe(10)
    })
  })

  describe('get', () => {
    it('should return 0 for non-existent counters', async () => {
      const key: CounterKey = {
        agentId: 'agent-nonexistent',
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
        periodTimestamp: new Date('2026-01-01'),
      }

      const value = await storage.get(key)
      expect(value).toBe(0)
    })
  })

  describe('reset', () => {
    it('should reset a counter to zero', async () => {
      const key: CounterKey = {
        agentId: 'agent-123',
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
        periodTimestamp: new Date('2026-01-01'),
      }

      await storage.increment(key, 1000)
      expect(await storage.get(key)).toBe(1000)

      await storage.reset(key)
      expect(await storage.get(key)).toBe(0)
    })
  })

  describe('getAll', () => {
    it('should return all counters for an agent in a period', async () => {
      const agentId = 'agent-123'
      const period: BillingPeriod = 'monthly'
      const periodTimestamp = new Date('2026-01-01')

      await storage.increment(
        { agentId, service: 'llm.do', metric: 'tokens', period, periodTimestamp },
        1000
      )
      await storage.increment(
        { agentId, service: 'llm.do', metric: 'requests', period, periodTimestamp },
        5
      )
      await storage.increment(
        { agentId, service: 'emails.do', metric: 'sent', period, periodTimestamp },
        10
      )

      const all = await storage.getAll(agentId, period)
      expect(all.size).toBe(3)
      expect(all.get('llm.do:tokens')).toBe(1000)
      expect(all.get('llm.do:requests')).toBe(5)
      expect(all.get('emails.do:sent')).toBe(10)
    })
  })
})

// ============================================================================
// Aggregator Tests
// ============================================================================

describe('UsageAggregator', () => {
  let sink: InMemoryAggregationSink

  beforeEach(() => {
    sink = new InMemoryAggregationSink()
  })

  describe('aggregate', () => {
    it('should aggregate counters to rollup records', async () => {
      // Add some rollup data
      await sink.write([
        {
          agentId: 'agent-123',
          service: 'llm.do',
          metric: 'tokens',
          periodType: 'hourly',
          periodStart: new Date('2026-01-11T10:00:00Z'),
          periodEnd: new Date('2026-01-11T11:00:00Z'),
          totalValue: 5000,
          eventCount: 10,
          minValue: 100,
          maxValue: 1000,
          avgValue: 500,
          costUnits: 50,
        },
      ])

      const records = sink.getRecords()
      expect(records.length).toBe(1)
      expect(records[0].totalValue).toBe(5000)
    })

    it('should support hourly rollups', async () => {
      const now = new Date('2026-01-11T15:30:00Z')
      const hourStart = new Date('2026-01-11T15:00:00Z')
      const hourEnd = new Date('2026-01-11T16:00:00Z')

      await sink.write([
        {
          agentId: 'agent-123',
          service: 'llm.do',
          metric: 'tokens',
          periodType: 'hourly',
          periodStart: hourStart,
          periodEnd: hourEnd,
          totalValue: 2500,
          eventCount: 5,
          minValue: 200,
          maxValue: 800,
          avgValue: 500,
          costUnits: 25,
        },
      ])

      const records = sink.getRecords()
      expect(records[0].periodType).toBe('hourly')
      expect(records[0].periodStart).toEqual(hourStart)
    })

    it('should support daily rollups', async () => {
      const dayStart = new Date('2026-01-11T00:00:00Z')
      const dayEnd = new Date('2026-01-12T00:00:00Z')

      await sink.write([
        {
          agentId: 'agent-123',
          service: 'llm.do',
          metric: 'tokens',
          periodType: 'daily',
          periodStart: dayStart,
          periodEnd: dayEnd,
          totalValue: 50000,
          eventCount: 100,
          minValue: 50,
          maxValue: 2000,
          avgValue: 500,
          costUnits: 500,
        },
      ])

      const records = sink.getRecords()
      expect(records[0].periodType).toBe('daily')
      expect(records[0].totalValue).toBe(50000)
    })
  })

  describe('flush', () => {
    it('should flush buffered records', async () => {
      await sink.write([
        {
          agentId: 'agent-123',
          service: 'llm.do',
          metric: 'tokens',
          periodType: 'hourly',
          periodStart: new Date('2026-01-11T10:00:00Z'),
          periodEnd: new Date('2026-01-11T11:00:00Z'),
          totalValue: 1000,
          eventCount: 2,
          minValue: 400,
          maxValue: 600,
          avgValue: 500,
          costUnits: 10,
        },
      ])

      await sink.flush()
      expect(sink.getFlushedCount()).toBe(1)
    })
  })
})

// ============================================================================
// Limiter Tests
// ============================================================================

describe('UsageLimiter', () => {
  let limiter: UsageLimiter
  let storage: InMemoryCounterStorage

  beforeEach(() => {
    storage = new InMemoryCounterStorage()
    limiter = new UsageLimiter(storage)
  })

  describe('checkLimit', () => {
    it('should allow operations under quota', async () => {
      const limit: UsageLimit = {
        service: 'llm.do',
        metric: 'tokens',
        quota: 100000,
        period: 'monthly',
        type: 'hard',
      }

      limiter.setLimit('agent-123', limit)

      const result = await limiter.checkLimit('agent-123', 'llm.do', 'tokens')
      expect(result.allowed).toBe(true)
      expect(result.percentUsed).toBe(0)
    })

    it('should block operations exceeding hard limit', async () => {
      const limit: UsageLimit = {
        service: 'llm.do',
        metric: 'tokens',
        quota: 1000,
        period: 'monthly',
        type: 'hard',
      }

      limiter.setLimit('agent-123', limit)

      // Use up the quota
      const key: CounterKey = {
        agentId: 'agent-123',
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
        periodTimestamp: limiter.getPeriodStart('monthly'),
      }
      await storage.increment(key, 1000)

      const result = await limiter.checkLimit('agent-123', 'llm.do', 'tokens')
      expect(result.allowed).toBe(false)
      expect(result.percentUsed).toBe(1)
      expect(result.reason).toBeDefined()
    })

    it('should warn but allow operations exceeding soft limit', async () => {
      const limit: UsageLimit = {
        service: 'emails.do',
        metric: 'sent',
        quota: 1000,
        period: 'daily',
        type: 'soft',
        gracePeriod: 0.2, // 20% grace period
      }

      limiter.setLimit('agent-123', limit)

      // Use 100% of quota
      const key: CounterKey = {
        agentId: 'agent-123',
        service: 'emails.do',
        metric: 'sent',
        period: 'daily',
        periodTimestamp: limiter.getPeriodStart('daily'),
      }
      await storage.increment(key, 1000)

      const result = await limiter.checkLimit('agent-123', 'emails.do', 'sent')
      expect(result.allowed).toBe(true) // Soft limit allows
      expect(result.warning).toBeDefined() // But warns

      // Exceed grace period
      await storage.increment(key, 200) // Now at 120%
      const result2 = await limiter.checkLimit('agent-123', 'emails.do', 'sent')
      expect(result2.allowed).toBe(false) // Grace period exceeded
    })

    it('should trigger warning at alert threshold', async () => {
      const limit: UsageLimit = {
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        period: 'monthly',
        type: 'hard',
        alertThreshold: 0.8, // Warn at 80%
      }

      limiter.setLimit('agent-123', limit)

      const key: CounterKey = {
        agentId: 'agent-123',
        service: 'llm.do',
        metric: 'tokens',
        period: 'monthly',
        periodTimestamp: limiter.getPeriodStart('monthly'),
      }
      await storage.increment(key, 8000) // 80% used

      const result = await limiter.checkLimit('agent-123', 'llm.do', 'tokens')
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeDefined()
      expect(result.percentUsed).toBe(0.8)
    })
  })

  describe('setLimit', () => {
    it('should store and retrieve limits', () => {
      const limit: UsageLimit = {
        service: 'llm.do',
        metric: 'tokens',
        quota: 100000,
        period: 'monthly',
        type: 'hard',
      }

      limiter.setLimit('agent-123', limit)
      const retrieved = limiter.getLimit('agent-123', 'llm.do', 'tokens')

      expect(retrieved).toEqual(limit)
    })

    it('should support multiple limits per agent', () => {
      const limit1: UsageLimit = {
        service: 'llm.do',
        metric: 'tokens',
        quota: 100000,
        period: 'monthly',
        type: 'hard',
      }

      const limit2: UsageLimit = {
        service: 'emails.do',
        metric: 'sent',
        quota: 10000,
        period: 'monthly',
        type: 'soft',
      }

      limiter.setLimit('agent-123', limit1)
      limiter.setLimit('agent-123', limit2)

      expect(limiter.getLimit('agent-123', 'llm.do', 'tokens')).toEqual(limit1)
      expect(limiter.getLimit('agent-123', 'emails.do', 'sent')).toEqual(limit2)
    })
  })

  describe('getPeriodStart', () => {
    it('should calculate correct period start for hourly', () => {
      vi.setSystemTime(new Date('2026-01-11T15:30:45Z'))
      const start = limiter.getPeriodStart('hourly')
      expect(start).toEqual(new Date('2026-01-11T15:00:00Z'))
      vi.useRealTimers()
    })

    it('should calculate correct period start for daily', () => {
      vi.setSystemTime(new Date('2026-01-11T15:30:45Z'))
      const start = limiter.getPeriodStart('daily')
      expect(start).toEqual(new Date('2026-01-11T00:00:00Z'))
      vi.useRealTimers()
    })

    it('should calculate correct period start for monthly', () => {
      vi.setSystemTime(new Date('2026-01-11T15:30:45Z'))
      const start = limiter.getPeriodStart('monthly')
      expect(start).toEqual(new Date('2026-01-01T00:00:00Z'))
      vi.useRealTimers()
    })
  })
})

// ============================================================================
// UsageMetering (Main API) Tests
// ============================================================================

describe('UsageMetering', () => {
  let metering: UsageMetering

  beforeEach(() => {
    metering = new UsageMetering()
  })

  afterEach(() => {
    metering.dispose()
  })

  describe('track', () => {
    it('should track usage for a service', async () => {
      await metering.track('agent-123', 'llm.do', 'tokens', 1500)

      const usage = await metering.query({
        agentId: 'agent-123',
        service: 'llm.do',
      })

      expect(usage.totals.apiCalls).toBeGreaterThan(0)
    })

    it('should track multiple services', async () => {
      await metering.track('agent-123', 'llm.do', 'tokens', 1500)
      await metering.track('agent-123', 'llm.do', 'requests', 1)
      await metering.track('agent-123', 'emails.do', 'sent', 5)

      const usage = await metering.query({ agentId: 'agent-123' })

      expect(usage.byService['llm.do']).toBeDefined()
      expect(usage.byService['emails.do']).toBeDefined()
    })
  })

  describe('query', () => {
    it('should query usage for a time range', async () => {
      await metering.track('agent-123', 'llm.do', 'tokens', 1000)
      await metering.track('agent-123', 'llm.do', 'tokens', 500)

      const usage = await metering.query({
        agentId: 'agent-123',
        timeRange: { last: '30d' },
      })

      expect(usage.agentId).toBe('agent-123')
      expect(usage.byService['llm.do'].metrics['tokens']).toBe(1500)
    })

    it('should filter by service', async () => {
      await metering.track('agent-123', 'llm.do', 'tokens', 1000)
      await metering.track('agent-123', 'emails.do', 'sent', 10)

      const usage = await metering.query({
        agentId: 'agent-123',
        service: 'llm.do',
      })

      expect(usage.byService['llm.do']).toBeDefined()
      expect(usage.byService['emails.do']).toBeUndefined()
    })
  })

  describe('checkLimit', () => {
    it('should check usage against limits', async () => {
      metering.setLimit('agent-123', {
        service: 'llm.do',
        metric: 'tokens',
        quota: 10000,
        period: 'monthly',
        type: 'hard',
      })

      await metering.track('agent-123', 'llm.do', 'tokens', 5000)

      const result = await metering.checkLimit('agent-123', 'llm.do', 'tokens')
      expect(result.allowed).toBe(true)
      expect(result.percentUsed).toBe(0.5)
    })

    it('should return unlimited for agents without limits', async () => {
      const result = await metering.checkLimit('agent-123', 'llm.do', 'tokens')
      expect(result.allowed).toBe(true)
      expect(result.quota).toBe(Infinity)
    })
  })

  describe('getSummary', () => {
    it('should return usage summary', async () => {
      await metering.track('agent-123', 'llm.do', 'tokens', 1000)
      await metering.track('agent-123', 'llm.do', 'requests', 2)
      await metering.track('agent-123', 'emails.do', 'sent', 5)
      await metering.track('agent-123', 'payments.do', 'transactions', 1)

      const summary = await metering.getSummary('agent-123')

      expect(summary.agentId).toBe('agent-123')
      expect(Object.keys(summary.byService).length).toBeGreaterThanOrEqual(3)
    })
  })
})

// ============================================================================
// Multi-Service Usage Tests
// ============================================================================

describe('Multi-Service Usage', () => {
  let metering: UsageMetering

  beforeEach(() => {
    metering = new UsageMetering()
  })

  afterEach(() => {
    metering.dispose()
  })

  it('should track calls.do metrics', async () => {
    await metering.track('agent-123', 'calls.do', 'minutes', 5)
    await metering.track('agent-123', 'calls.do', 'calls', 2)

    const usage = await metering.query({ agentId: 'agent-123', service: 'calls.do' })
    expect(usage.byService['calls.do'].metrics['minutes']).toBe(5)
    expect(usage.byService['calls.do'].metrics['calls']).toBe(2)
  })

  it('should track texts.do metrics', async () => {
    await metering.track('agent-123', 'texts.do', 'sent', 10)
    await metering.track('agent-123', 'texts.do', 'received', 5)

    const usage = await metering.query({ agentId: 'agent-123', service: 'texts.do' })
    expect(usage.byService['texts.do'].metrics['sent']).toBe(10)
    expect(usage.byService['texts.do'].metrics['received']).toBe(5)
  })

  it('should track emails.do metrics', async () => {
    await metering.track('agent-123', 'emails.do', 'sent', 100)
    await metering.track('agent-123', 'emails.do', 'opens', 50)
    await metering.track('agent-123', 'emails.do', 'clicks', 10)

    const usage = await metering.query({ agentId: 'agent-123', service: 'emails.do' })
    expect(usage.byService['emails.do'].metrics['sent']).toBe(100)
    expect(usage.byService['emails.do'].metrics['opens']).toBe(50)
    expect(usage.byService['emails.do'].metrics['clicks']).toBe(10)
  })

  it('should track payments.do metrics', async () => {
    await metering.track('agent-123', 'payments.do', 'transactions', 5)
    await metering.track('agent-123', 'payments.do', 'volume', 50000) // $500.00 in cents

    const usage = await metering.query({ agentId: 'agent-123', service: 'payments.do' })
    expect(usage.byService['payments.do'].metrics['transactions']).toBe(5)
    expect(usage.byService['payments.do'].metrics['volume']).toBe(50000)
  })

  it('should track llm.do metrics', async () => {
    await metering.track('agent-123', 'llm.do', 'tokens', 15000)
    await metering.track('agent-123', 'llm.do', 'requests', 10)

    const usage = await metering.query({ agentId: 'agent-123', service: 'llm.do' })
    expect(usage.byService['llm.do'].metrics['tokens']).toBe(15000)
    expect(usage.byService['llm.do'].metrics['requests']).toBe(10)
  })

  it('should track queue.do metrics', async () => {
    await metering.track('agent-123', 'queue.do', 'messages', 1000)
    await metering.track('agent-123', 'queue.do', 'processed', 950)

    const usage = await metering.query({ agentId: 'agent-123', service: 'queue.do' })
    expect(usage.byService['queue.do'].metrics['messages']).toBe(1000)
    expect(usage.byService['queue.do'].metrics['processed']).toBe(950)
  })

  it('should handle multiple agents', async () => {
    await metering.track('agent-1', 'llm.do', 'tokens', 1000)
    await metering.track('agent-2', 'llm.do', 'tokens', 2000)
    await metering.track('agent-3', 'llm.do', 'tokens', 3000)

    const usage1 = await metering.query({ agentId: 'agent-1' })
    const usage2 = await metering.query({ agentId: 'agent-2' })
    const usage3 = await metering.query({ agentId: 'agent-3' })

    expect(usage1.byService['llm.do'].metrics['tokens']).toBe(1000)
    expect(usage2.byService['llm.do'].metrics['tokens']).toBe(2000)
    expect(usage3.byService['llm.do'].metrics['tokens']).toBe(3000)
  })
})
