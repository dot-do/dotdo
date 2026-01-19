import { describe, it, expect, beforeEach } from 'vitest'
import {
  UsageTracker,
  countTokens,
  calculateCost,
  type Provider,
  type ModelConfig,
  type UsageRecord,
  type UsageReport,
  BudgetExceededError,
} from '../tracking'

describe('Token Counting', () => {
  it('should estimate tokens from text length', () => {
    const text = 'Hello, world! This is a test.'
    const tokens = countTokens(text)

    // Rough estimate: ~1 token per 4 characters
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(text.length)
  })

  it('should handle empty string', () => {
    expect(countTokens('')).toBe(0)
  })

  it('should handle long text', () => {
    const longText = 'word '.repeat(1000)
    const tokens = countTokens(longText)

    expect(tokens).toBeGreaterThan(1000)
  })

  it('should handle unicode characters', () => {
    const text = 'Hello 世界 🌍'
    const tokens = countTokens(text)

    expect(tokens).toBeGreaterThan(0)
  })
})

describe('Cost Calculation', () => {
  describe('OpenAI pricing', () => {
    it('should calculate gpt-4o cost', () => {
      const cost = calculateCost('openai', 'gpt-4o', { input: 1000, output: 500 })

      // gpt-4o: $2.50/$10.00 per 1M tokens
      const expected = (1000 * 2.50 + 500 * 10.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should calculate gpt-4o-mini cost', () => {
      const cost = calculateCost('openai', 'gpt-4o-mini', { input: 1000, output: 500 })

      // gpt-4o-mini: $0.150/$0.600 per 1M tokens
      const expected = (1000 * 0.150 + 500 * 0.600) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should calculate o1 cost', () => {
      const cost = calculateCost('openai', 'o1', { input: 1000, output: 500 })

      // o1: $15.00/$60.00 per 1M tokens
      const expected = (1000 * 15.00 + 500 * 60.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should calculate o1-mini cost', () => {
      const cost = calculateCost('openai', 'o1-mini', { input: 1000, output: 500 })

      // o1-mini: $3.00/$12.00 per 1M tokens
      const expected = (1000 * 3.00 + 500 * 12.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })
  })

  describe('Anthropic pricing', () => {
    it('should calculate claude-opus-4 cost', () => {
      const cost = calculateCost('anthropic', 'claude-opus-4', { input: 1000, output: 500 })

      // claude-opus-4: $15.00/$75.00 per 1M tokens
      const expected = (1000 * 15.00 + 500 * 75.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should calculate claude-sonnet-4 cost', () => {
      const cost = calculateCost('anthropic', 'claude-sonnet-4', { input: 1000, output: 500 })

      // claude-sonnet-4: $3.00/$15.00 per 1M tokens
      const expected = (1000 * 3.00 + 500 * 15.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should calculate claude-haiku-4 cost', () => {
      const cost = calculateCost('anthropic', 'claude-haiku-4', { input: 1000, output: 500 })

      // claude-haiku-4: $0.80/$4.00 per 1M tokens
      const expected = (1000 * 0.80 + 500 * 4.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })
  })

  describe('Google pricing', () => {
    it('should calculate gemini-2.0-flash cost', () => {
      const cost = calculateCost('google', 'gemini-2.0-flash', { input: 1000, output: 500 })

      // gemini-2.0-flash: Free for now (return 0)
      expect(cost).toBe(0)
    })

    it('should calculate gemini-1.5-pro cost', () => {
      const cost = calculateCost('google', 'gemini-1.5-pro', { input: 1000, output: 500 })

      // gemini-1.5-pro: $1.25/$5.00 per 1M tokens
      const expected = (1000 * 1.25 + 500 * 5.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })
  })

  describe('Cloudflare pricing', () => {
    it('should calculate workers-ai cost', () => {
      const cost = calculateCost('cloudflare', '@cf/meta/llama-3.1-8b-instruct', { input: 1000, output: 500 })

      // Workers AI: $0.011 per 1000 neurons (estimate as tokens)
      const totalTokens = 1000 + 500
      const expected = (totalTokens * 0.011) / 1000
      expect(cost).toBeCloseTo(expected, 6)
    })
  })

  it('should return 0 for unknown provider', () => {
    const cost = calculateCost('unknown' as Provider, 'unknown-model', { input: 1000, output: 500 })
    expect(cost).toBe(0)
  })

  it('should return 0 for unknown model', () => {
    const cost = calculateCost('openai', 'unknown-model', { input: 1000, output: 500 })
    expect(cost).toBe(0)
  })

  it('should handle zero tokens', () => {
    const cost = calculateCost('openai', 'gpt-4o', { input: 0, output: 0 })
    expect(cost).toBe(0)
  })

  it('should handle large token counts', () => {
    const cost = calculateCost('openai', 'gpt-4o', { input: 1_000_000, output: 500_000 })

    // Should not overflow
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(1000) // Sanity check
  })
})

describe('UsageTracker', () => {
  let tracker: UsageTracker

  beforeEach(() => {
    tracker = new UsageTracker()
  })

  describe('Basic tracking', () => {
    it('should record usage', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      const report = tracker.getReport()
      expect(report.totalCost).toBeCloseTo(0.001, 6)
      expect(report.totalTokens).toBe(150)
      expect(report.requestCount).toBe(1)
    })

    it('should aggregate multiple requests', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        tokens: { input: 200, output: 100 },
        cost: 0.002,
        timestamp: Date.now(),
      })

      const report = tracker.getReport()
      expect(report.totalCost).toBeCloseTo(0.003, 6)
      expect(report.totalTokens).toBe(450)
      expect(report.requestCount).toBe(2)
    })

    it('should track by provider', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokens: { input: 200, output: 100 },
        cost: 0.0005,
        timestamp: Date.now(),
      })

      tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        tokens: { input: 150, output: 75 },
        cost: 0.002,
        timestamp: Date.now(),
      })

      const report = tracker.getReport()
      expect(report.byProvider['openai'].cost).toBeCloseTo(0.0015, 6)
      expect(report.byProvider['openai'].tokens).toBe(450)
      expect(report.byProvider['openai'].requests).toBe(2)
      expect(report.byProvider['anthropic'].cost).toBeCloseTo(0.002, 6)
      expect(report.byProvider['anthropic'].tokens).toBe(225)
      expect(report.byProvider['anthropic'].requests).toBe(1)
    })

    it('should track by model', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 200, output: 100 },
        cost: 0.002,
        timestamp: Date.now(),
      })

      const report = tracker.getReport()
      expect(report.byModel['gpt-4o'].cost).toBeCloseTo(0.003, 6)
      expect(report.byModel['gpt-4o'].tokens).toBe(450)
      expect(report.byModel['gpt-4o'].requests).toBe(2)
    })
  })

  describe('Budget limits', () => {
    it('should allow setting budget limit', () => {
      tracker.setBudgetLimit(10.0)
      expect(tracker.getBudgetLimit()).toBe(10.0)
    })

    it('should not throw when under budget', () => {
      tracker.setBudgetLimit(10.0)

      expect(() => {
        tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })
      }).not.toThrow()
    })

    it('should throw BudgetExceededError when over budget', () => {
      tracker.setBudgetLimit(0.001)

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      expect(() => {
        tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })
      }).toThrow(BudgetExceededError)
    })

    it('should include budget info in error', () => {
      tracker.setBudgetLimit(0.001)

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      try {
        tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError)
        if (err instanceof BudgetExceededError) {
          expect(err.currentCost).toBeCloseTo(0.002, 6)
          expect(err.budgetLimit).toBe(0.001)
        }
      }
    })

    it('should allow unlimited budget by default', () => {
      for (let i = 0; i < 100; i++) {
        tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 1000, output: 500 },
          cost: 0.01,
          timestamp: Date.now(),
        })
      }

      const report = tracker.getReport()
      expect(report.totalCost).toBeCloseTo(1.0, 6)
    })

    it('should allow clearing budget limit', () => {
      tracker.setBudgetLimit(0.001)
      tracker.setBudgetLimit(Infinity)

      for (let i = 0; i < 10; i++) {
        tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })
      }

      expect(tracker.getReport().totalCost).toBeCloseTo(0.01, 6)
    })
  })

  describe('Usage reporting', () => {
    it('should generate empty report for no usage', () => {
      const report = tracker.getReport()

      expect(report.totalCost).toBe(0)
      expect(report.totalTokens).toBe(0)
      expect(report.requestCount).toBe(0)
      expect(Object.keys(report.byProvider)).toHaveLength(0)
      expect(Object.keys(report.byModel)).toHaveLength(0)
    })

    it('should include time range in report', () => {
      const now = Date.now()

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: now - 1000,
      })

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: now,
      })

      const report = tracker.getReport()
      expect(report.startTime).toBe(now - 1000)
      expect(report.endTime).toBe(now)
    })

    it('should support time-filtered reports', () => {
      const now = Date.now()
      const hourAgo = now - 3600 * 1000

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: hourAgo,
      })

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: now,
      })

      const report = tracker.getReport({ since: now - 1800 * 1000 }) // Last 30 min
      expect(report.totalCost).toBeCloseTo(0.001, 6)
      expect(report.requestCount).toBe(1)
    })

    it('should support provider-filtered reports', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        tokens: { input: 200, output: 100 },
        cost: 0.002,
        timestamp: Date.now(),
      })

      const report = tracker.getReport({ provider: 'openai' })
      expect(report.totalCost).toBeCloseTo(0.001, 6)
      expect(report.requestCount).toBe(1)
      expect(Object.keys(report.byProvider)).toHaveLength(1)
    })

    it('should support model-filtered reports', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokens: { input: 200, output: 100 },
        cost: 0.0005,
        timestamp: Date.now(),
      })

      const report = tracker.getReport({ model: 'gpt-4o' })
      expect(report.totalCost).toBeCloseTo(0.001, 6)
      expect(report.requestCount).toBe(1)
    })
  })

  describe('Reset and clear', () => {
    it('should clear all usage data', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.reset()

      const report = tracker.getReport()
      expect(report.totalCost).toBe(0)
      expect(report.requestCount).toBe(0)
    })

    it('should preserve budget limit when clearing', () => {
      tracker.setBudgetLimit(10.0)

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      tracker.reset()

      expect(tracker.getBudgetLimit()).toBe(10.0)
    })
  })

  describe('Integration with AIPromise', () => {
    it('should track usage from meta', () => {
      const meta = {
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: calculateCost('openai', 'gpt-4o', { input: 100, output: 50 }),
      }

      tracker.recordFromMeta('openai', meta)

      const report = tracker.getReport()
      expect(report.totalTokens).toBe(150)
      expect(report.totalCost).toBeGreaterThan(0)
    })

    it('should auto-calculate cost if not provided', () => {
      const meta = {
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
      }

      tracker.recordFromMeta('openai', meta)

      const report = tracker.getReport()
      expect(report.totalCost).toBeGreaterThan(0)
    })

    it('should skip tracking if no tokens', () => {
      const meta = {
        model: 'gpt-4o',
      }

      tracker.recordFromMeta('openai', meta)

      const report = tracker.getReport()
      expect(report.requestCount).toBe(0)
    })
  })

  describe('Alerts and notifications', () => {
    it('should trigger callback on budget threshold', () => {
      const alerts: number[] = []
      tracker.setBudgetLimit(1.0)
      tracker.onBudgetThreshold(0.8, (usage) => {
        alerts.push(usage)
      })

      // Add usage up to 80%
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.8,
        timestamp: Date.now(),
      })

      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toBeCloseTo(0.8, 6)
    })

    it('should not trigger callback below threshold', () => {
      const alerts: number[] = []
      tracker.setBudgetLimit(1.0)
      tracker.onBudgetThreshold(0.8, (usage) => {
        alerts.push(usage)
      })

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.5,
        timestamp: Date.now(),
      })

      expect(alerts).toHaveLength(0)
    })

    it('should support multiple threshold callbacks', () => {
      const alerts50: number[] = []
      const alerts80: number[] = []

      tracker.setBudgetLimit(1.0)
      tracker.onBudgetThreshold(0.5, (usage) => alerts50.push(usage))
      tracker.onBudgetThreshold(0.8, (usage) => alerts80.push(usage))

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.6,
        timestamp: Date.now(),
      })

      expect(alerts50).toHaveLength(1)
      expect(alerts80).toHaveLength(0)

      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.3,
        timestamp: Date.now(),
      })

      expect(alerts50).toHaveLength(1)
      expect(alerts80).toHaveLength(1)
    })
  })

  describe('Export and import', () => {
    it('should export usage records', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      const records = tracker.exportRecords()
      expect(records).toHaveLength(1)
      expect(records[0].provider).toBe('openai')
      expect(records[0].model).toBe('gpt-4o')
    })

    it('should import usage records', () => {
      const records: UsageRecord[] = [
        {
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        },
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          tokens: { input: 200, output: 100 },
          cost: 0.002,
          timestamp: Date.now(),
        },
      ]

      tracker.importRecords(records)

      const report = tracker.getReport()
      expect(report.totalCost).toBeCloseTo(0.003, 6)
      expect(report.requestCount).toBe(2)
    })

    it('should append to existing records on import', () => {
      tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      const records: UsageRecord[] = [
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          tokens: { input: 200, output: 100 },
          cost: 0.002,
          timestamp: Date.now(),
        },
      ]

      tracker.importRecords(records)

      const report = tracker.getReport()
      expect(report.requestCount).toBe(2)
    })
  })
})
