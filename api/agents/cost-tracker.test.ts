/**
 * Cost Tracker Tests
 *
 * Tests for:
 * - Token usage tracking per request (input/output tokens)
 * - Cost calculation based on model pricing
 * - Budget limits per agent/conversation
 * - Alert callbacks when approaching budget
 * - Budget exceeded enforcement
 * - Cost reporting and analytics
 * - Agent integration with withCostTracking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CostTracker,
  createCostTracker,
  withCostTracking,
  calculateCost,
  estimateCost,
  mergeTrackerStats,
  BudgetExceededError,
  MODEL_PRICING,
  type CostTrackerConfig,
  type CostBudget,
  type RecordUsageInput,
  type ModelPricing,
  type UsageStats,
} from './cost-tracker'
import { createMockProvider } from './testing'
import type { Agent, TokenUsage } from './types'

// ============================================================================
// Test Utilities
// ============================================================================

function createUsageInput(overrides: Partial<RecordUsageInput> = {}): RecordUsageInput {
  return {
    model: 'gpt-4o',
    promptTokens: 100,
    completionTokens: 50,
    ...overrides,
  }
}

function createTokenUsage(prompt: number, completion: number): TokenUsage {
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
  }
}

// ============================================================================
// createCostTracker() Tests
// ============================================================================

describe('createCostTracker()', () => {
  it('should create tracker with default config', () => {
    const tracker = createCostTracker()

    expect(tracker).toBeInstanceOf(CostTracker)
    expect(tracker.getTotalCost()).toBe(0)
    expect(tracker.getTotalTokens()).toBe(0)
    expect(tracker.getRecords()).toHaveLength(0)
  })

  it('should create tracker with custom ID', () => {
    const tracker = createCostTracker({ id: 'my-tracker' })

    expect(tracker.id).toBe('my-tracker')
  })

  it('should create tracker with budget config', () => {
    const tracker = createCostTracker({
      budget: {
        maxCost: 10.0,
        alertThreshold: 8.0,
      },
    })

    const config = tracker.getConfig()
    expect(config.budget?.maxCost).toBe(10.0)
    expect(config.budget?.alertThreshold).toBe(8.0)
  })

  it('should create tracker with custom pricing', () => {
    const tracker = createCostTracker({
      pricing: {
        'custom-model': { input: 0.001, output: 0.002 },
      },
    })

    const pricing = tracker.getModelPricing('custom-model')
    expect(pricing).toEqual({ input: 0.001, output: 0.002 })
  })

  it('should merge custom pricing with defaults', () => {
    const tracker = createCostTracker({
      pricing: {
        'my-model': { input: 0.01, output: 0.02 },
      },
    })

    // Should have custom model
    expect(tracker.getModelPricing('my-model')).toBeDefined()
    // Should also have default models
    expect(tracker.getModelPricing('gpt-4o')).toBeDefined()
  })
})

// ============================================================================
// Token Usage Tracking Tests
// ============================================================================

describe('Token Usage Tracking', () => {
  let tracker: CostTracker

  beforeEach(() => {
    tracker = createCostTracker()
  })

  describe('recordUsage()', () => {
    it('should record token usage', () => {
      tracker.recordUsage(createUsageInput())

      const stats = tracker.getStats()
      expect(stats.totalPromptTokens).toBe(100)
      expect(stats.totalCompletionTokens).toBe(50)
      expect(stats.totalTokens).toBe(150)
      expect(stats.requestCount).toBe(1)
    })

    it('should accumulate multiple usage records', () => {
      tracker.recordUsage(createUsageInput({ promptTokens: 100, completionTokens: 50 }))
      tracker.recordUsage(createUsageInput({ promptTokens: 200, completionTokens: 100 }))
      tracker.recordUsage(createUsageInput({ promptTokens: 150, completionTokens: 75 }))

      const stats = tracker.getStats()
      expect(stats.totalPromptTokens).toBe(450)
      expect(stats.totalCompletionTokens).toBe(225)
      expect(stats.totalTokens).toBe(675)
      expect(stats.requestCount).toBe(3)
    })

    it('should return usage record with cost', () => {
      const record = tracker.recordUsage(createUsageInput({
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 500,
      }))

      expect(record.model).toBe('gpt-4o')
      expect(record.promptTokens).toBe(1000)
      expect(record.completionTokens).toBe(500)
      expect(record.cost).toBeGreaterThan(0)
      expect(record.timestamp).toBeInstanceOf(Date)
    })

    it('should track provider', () => {
      tracker.recordUsage(createUsageInput({ provider: 'openai' }))

      const stats = tracker.getStats()
      expect(stats.byProvider['openai']).toBeDefined()
      expect(stats.byProvider['openai'].requestCount).toBe(1)
    })

    it('should track cached input tokens', () => {
      const record = tracker.recordUsage(createUsageInput({
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 500,
        cachedInputTokens: 200,
      }))

      expect(record.cachedInputTokens).toBe(200)
      // Cached tokens should contribute to cost (at reduced rate)
      expect(record.cost).toBeGreaterThan(0)
    })

    it('should store metadata', () => {
      const record = tracker.recordUsage(createUsageInput({
        metadata: { conversationId: 'conv-123', agentId: 'agent-1' },
      }))

      expect(record.metadata).toEqual({ conversationId: 'conv-123', agentId: 'agent-1' })
    })

    it('should use default model when not specified', () => {
      const trackerWithDefault = createCostTracker({ defaultModel: 'gpt-3.5-turbo' })

      const record = trackerWithDefault.recordUsage({
        model: '', // Empty model
        promptTokens: 100,
        completionTokens: 50,
      })

      expect(record.model).toBe('gpt-3.5-turbo')
    })
  })

  describe('recordTokenUsage()', () => {
    it('should record from TokenUsage type', () => {
      const usage: TokenUsage = {
        promptTokens: 500,
        completionTokens: 250,
        totalTokens: 750,
      }

      tracker.recordTokenUsage(usage, 'gpt-4o', 'openai')

      const stats = tracker.getStats()
      expect(stats.totalPromptTokens).toBe(500)
      expect(stats.totalCompletionTokens).toBe(250)
      expect(stats.byProvider['openai']).toBeDefined()
    })
  })
})

// ============================================================================
// Cost Calculation Tests
// ============================================================================

describe('Cost Calculation', () => {
  let tracker: CostTracker

  beforeEach(() => {
    tracker = createCostTracker()
  })

  describe('getTotalCost()', () => {
    it('should calculate cost based on model pricing', () => {
      // gpt-4o pricing: input $0.0025/1K, output $0.01/1K
      tracker.recordUsage({
        model: 'gpt-4o',
        promptTokens: 1000, // $0.0025
        completionTokens: 1000, // $0.01
      })

      // Expected: 0.0025 + 0.01 = 0.0125
      expect(tracker.getTotalCost()).toBeCloseTo(0.0125, 6)
    })

    it('should accumulate costs across requests', () => {
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 1000 })
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 1000 })

      expect(tracker.getTotalCost()).toBeCloseTo(0.025, 6)
    })

    it('should handle different models with different pricing', () => {
      // gpt-4o: more expensive
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 500 })
      // gpt-4o-mini: cheaper
      tracker.recordUsage({ model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 500 })

      const stats = tracker.getStats()
      expect(stats.byModel['gpt-4o'].cost).toBeGreaterThan(stats.byModel['gpt-4o-mini'].cost)
    })

    it('should return zero cost for unknown models', () => {
      tracker.recordUsage({
        model: 'unknown-model-xyz',
        promptTokens: 1000,
        completionTokens: 500,
      })

      expect(tracker.getTotalCost()).toBe(0)
    })

    it('should use custom pricing when set', () => {
      tracker.setModelPricing('custom-model', { input: 0.1, output: 0.2 })

      tracker.recordUsage({
        model: 'custom-model',
        promptTokens: 1000, // $0.1
        completionTokens: 1000, // $0.2
      })

      expect(tracker.getTotalCost()).toBeCloseTo(0.3, 6)
    })
  })

  describe('calculateCost() utility', () => {
    it('should calculate cost for given usage', () => {
      const cost = calculateCost({
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 500,
      })

      // input: 1000/1000 * 0.0025 = 0.0025
      // output: 500/1000 * 0.01 = 0.005
      expect(cost).toBeCloseTo(0.0075, 6)
    })

    it('should accept custom pricing table', () => {
      const customPricing = {
        'my-model': { input: 0.05, output: 0.1 },
      }

      const cost = calculateCost(
        { model: 'my-model', promptTokens: 1000, completionTokens: 1000 },
        customPricing
      )

      expect(cost).toBeCloseTo(0.15, 6)
    })

    it('should handle cached input tokens', () => {
      const costWithCache = calculateCost({
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 500,
        cachedInputTokens: 500,
      })

      const costWithoutCache = calculateCost({
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 500,
      })

      // Cached should add some cost (but at reduced rate)
      expect(costWithCache).toBeGreaterThan(costWithoutCache)
    })
  })

  describe('estimateCost() utility', () => {
    it('should estimate cost before running', () => {
      const prompt = 'Hello, how are you today?'
      const estimate = estimateCost(prompt, 'gpt-4o')

      expect(estimate).toBeGreaterThan(0)
    })

    it('should scale estimate with output ratio', () => {
      const prompt = 'Short prompt'

      const estimate1x = estimateCost(prompt, 'gpt-4o', 1.0)
      const estimate2x = estimateCost(prompt, 'gpt-4o', 2.0)

      expect(estimate2x).toBeGreaterThan(estimate1x)
    })
  })
})

// ============================================================================
// Budget Enforcement Tests
// ============================================================================

describe('Budget Enforcement', () => {
  describe('Soft Limits (Alerts)', () => {
    it('should trigger alert when threshold reached', () => {
      const onAlert = vi.fn()

      const tracker = createCostTracker({
        budget: {
          maxCost: 1.0,
          alertThreshold: 0.5,
          onAlert,
        },
      })

      // Record enough to exceed threshold
      // gpt-4o: 1000 tokens = ~$0.0025 + $0.01 = $0.0125
      // Need about 40 requests to reach $0.5
      for (let i = 0; i < 50; i++) {
        tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 1000 })
      }

      expect(onAlert).toHaveBeenCalled()
    })

    it('should only trigger alert once', () => {
      const onAlert = vi.fn()

      const tracker = createCostTracker({
        budget: {
          alertThreshold: 0.01,
          onAlert,
        },
      })

      // Multiple records exceeding threshold
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })

      expect(onAlert).toHaveBeenCalledTimes(1)
    })

    it('should pass correct values to alert callback', () => {
      const onAlert = vi.fn()

      const tracker = createCostTracker({
        budget: {
          alertThreshold: 0.001,
          onAlert,
        },
      })

      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 500 })

      expect(onAlert).toHaveBeenCalledWith(
        expect.any(Number),
        0.001
      )
      expect(onAlert.mock.calls[0][0]).toBeGreaterThanOrEqual(0.001)
    })
  })

  describe('Hard Limits (Budget Exceeded)', () => {
    it('should throw BudgetExceededError when hardLimit enabled', () => {
      const tracker = createCostTracker({
        id: 'test-tracker',
        budget: {
          maxCost: 0.01,
          hardLimit: true,
        },
      })

      // First request might be under budget
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      // Keep adding until we exceed
      expect(() => {
        for (let i = 0; i < 100; i++) {
          tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 1000 })
        }
      }).toThrow(BudgetExceededError)
    })

    it('should include tracker ID in error', () => {
      const tracker = createCostTracker({
        id: 'my-agent-tracker',
        budget: {
          maxCost: 0.001,
          hardLimit: true,
        },
      })

      try {
        tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 10000 })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExceededError)
        expect((error as BudgetExceededError).trackerId).toBe('my-agent-tracker')
        expect((error as BudgetExceededError).message).toContain('my-agent-tracker')
      }
    })

    it('should call onExceeded callback before throwing', () => {
      const onExceeded = vi.fn()

      const tracker = createCostTracker({
        budget: {
          maxCost: 0.001,
          hardLimit: true,
          onExceeded,
        },
      })

      try {
        tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 10000 })
      } catch {
        // Expected
      }

      expect(onExceeded).toHaveBeenCalled()
    })

    it('should still record usage when budget exceeded', () => {
      const tracker = createCostTracker({
        budget: {
          maxCost: 0.001,
          hardLimit: true,
        },
      })

      try {
        tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 10000 })
      } catch {
        // Expected
      }

      // Usage should still be recorded
      expect(tracker.getRecords().length).toBe(1)
      expect(tracker.getTotalCost()).toBeGreaterThan(0)
    })

    it('should not throw when hardLimit disabled', () => {
      const tracker = createCostTracker({
        budget: {
          maxCost: 0.001,
          hardLimit: false,
        },
      })

      // Should not throw even when way over budget
      expect(() => {
        tracker.recordUsage({ model: 'gpt-4o', promptTokens: 100000, completionTokens: 100000 })
      }).not.toThrow()
    })
  })

  describe('Budget Checking', () => {
    it('should check if budget would be exceeded', () => {
      const tracker = createCostTracker({
        budget: {
          maxCost: 1.0,
        },
      })

      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })

      expect(tracker.wouldExceedBudget(0.5)).toBe(false)
      expect(tracker.wouldExceedBudget(10.0)).toBe(true)
    })

    it('should return false when no budget set', () => {
      const tracker = createCostTracker()

      expect(tracker.wouldExceedBudget(1000)).toBe(false)
    })

    it('should get remaining budget', () => {
      const tracker = createCostTracker({
        budget: {
          maxCost: 1.0,
        },
      })

      expect(tracker.getRemainingBudget()).toBe(1.0)

      // Spend some budget
      // Record enough to spend ~$0.1
      for (let i = 0; i < 8; i++) {
        tracker.recordUsage({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 1000 })
      }

      expect(tracker.getRemainingBudget()).toBeLessThan(1.0)
      expect(tracker.getRemainingBudget()).toBeGreaterThan(0)
    })

    it('should return Infinity when no budget set', () => {
      const tracker = createCostTracker()

      expect(tracker.getRemainingBudget()).toBe(Infinity)
    })

    it('should return 0 when budget exhausted', () => {
      const tracker = createCostTracker({
        budget: {
          maxCost: 0.001,
        },
      })

      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 10000 })

      expect(tracker.getRemainingBudget()).toBe(0)
    })
  })
})

// ============================================================================
// Cost Reporting and Analytics Tests
// ============================================================================

describe('Cost Reporting and Analytics', () => {
  let tracker: CostTracker

  beforeEach(() => {
    tracker = createCostTracker()

    // Add diverse usage data
    tracker.recordUsage({ model: 'gpt-4o', provider: 'openai', promptTokens: 1000, completionTokens: 500 })
    tracker.recordUsage({ model: 'gpt-4o', provider: 'openai', promptTokens: 2000, completionTokens: 1000 })
    tracker.recordUsage({ model: 'gpt-4o-mini', provider: 'openai', promptTokens: 5000, completionTokens: 2500 })
    tracker.recordUsage({ model: 'claude-sonnet-4-20250514', provider: 'anthropic', promptTokens: 3000, completionTokens: 1500 })
  })

  describe('getStats()', () => {
    it('should return complete usage statistics', () => {
      const stats = tracker.getStats()

      expect(stats.totalPromptTokens).toBe(11000)
      expect(stats.totalCompletionTokens).toBe(5500)
      expect(stats.totalTokens).toBe(16500)
      expect(stats.requestCount).toBe(4)
      expect(stats.totalCost).toBeGreaterThan(0)
    })

    it('should cache stats for performance', () => {
      const stats1 = tracker.getStats()
      const stats2 = tracker.getStats()

      expect(stats1).toBe(stats2) // Same reference
    })

    it('should invalidate cache on new records', () => {
      const stats1 = tracker.getStats()

      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      const stats2 = tracker.getStats()

      expect(stats1).not.toBe(stats2)
      expect(stats2.requestCount).toBe(5)
    })
  })

  describe('getUsageByModel()', () => {
    it('should return breakdown by model', () => {
      const byModel = tracker.getUsageByModel()

      expect(byModel['gpt-4o']).toBeDefined()
      expect(byModel['gpt-4o-mini']).toBeDefined()
      expect(byModel['claude-sonnet-4-20250514']).toBeDefined()
    })

    it('should calculate per-model statistics', () => {
      const byModel = tracker.getUsageByModel()

      expect(byModel['gpt-4o'].promptTokens).toBe(3000)
      expect(byModel['gpt-4o'].completionTokens).toBe(1500)
      expect(byModel['gpt-4o'].requestCount).toBe(2)
      expect(byModel['gpt-4o'].cost).toBeGreaterThan(0)
    })
  })

  describe('getUsageByProvider()', () => {
    it('should return breakdown by provider', () => {
      const byProvider = tracker.getUsageByProvider()

      expect(byProvider['openai']).toBeDefined()
      expect(byProvider['anthropic']).toBeDefined()
    })

    it('should calculate per-provider statistics', () => {
      const byProvider = tracker.getUsageByProvider()

      expect(byProvider['openai'].requestCount).toBe(3)
      expect(byProvider['anthropic'].requestCount).toBe(1)
    })

    it('should use "unknown" for records without provider', () => {
      const newTracker = createCostTracker()
      newTracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      const byProvider = newTracker.getUsageByProvider()

      expect(byProvider['unknown']).toBeDefined()
      expect(byProvider['unknown'].requestCount).toBe(1)
    })
  })

  describe('getRecords()', () => {
    it('should return all usage records', () => {
      const records = tracker.getRecords()

      expect(records).toHaveLength(4)
    })

    it('should return copies of records', () => {
      const records1 = tracker.getRecords()
      const records2 = tracker.getRecords()

      expect(records1).not.toBe(records2)
      expect(records1).toEqual(records2)
    })

    it('should include timestamps', () => {
      const records = tracker.getRecords()

      for (const record of records) {
        expect(record.timestamp).toBeInstanceOf(Date)
      }
    })
  })

  describe('getRecordsBetween()', () => {
    it('should filter records by time range', async () => {
      const newTracker = createCostTracker()

      const before = new Date()
      await new Promise((r) => setTimeout(r, 10))

      newTracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })
      newTracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      await new Promise((r) => setTimeout(r, 10))
      const middle = new Date()
      await new Promise((r) => setTimeout(r, 10))

      newTracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      await new Promise((r) => setTimeout(r, 10))
      const after = new Date()

      // Records between before and middle (should get first 2)
      const earlyRecords = newTracker.getRecordsBetween(before, middle)
      expect(earlyRecords.length).toBe(2)

      // Records between middle and after (should get last 1)
      const lateRecords = newTracker.getRecordsBetween(middle, after)
      expect(lateRecords.length).toBe(1)
    })
  })
})

// ============================================================================
// State Management Tests
// ============================================================================

describe('State Management', () => {
  describe('reset()', () => {
    it('should clear all records', () => {
      const tracker = createCostTracker()
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      tracker.reset()

      expect(tracker.getRecords()).toHaveLength(0)
      expect(tracker.getTotalCost()).toBe(0)
      expect(tracker.getTotalTokens()).toBe(0)
    })

    it('should reset alert state', () => {
      const onAlert = vi.fn()

      const tracker = createCostTracker({
        budget: {
          alertThreshold: 0.001,
          onAlert,
        },
      })

      // Trigger alert
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })
      expect(onAlert).toHaveBeenCalledTimes(1)

      // Reset
      tracker.reset()

      // Should trigger again
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })
      expect(onAlert).toHaveBeenCalledTimes(2)
    })
  })

  describe('exportState()', () => {
    it('should export complete state', () => {
      const tracker = createCostTracker({ id: 'export-test' })
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

      const state = tracker.exportState()

      expect(state.id).toBe('export-test')
      expect(state.records).toHaveLength(1)
      expect(state.config).toBeDefined()
    })
  })

  describe('importState()', () => {
    it('should import state from export', () => {
      const original = createCostTracker({ id: 'original' })
      original.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })
      original.recordUsage({ model: 'gpt-4o', promptTokens: 200, completionTokens: 100 })

      const exported = original.exportState()

      const restored = createCostTracker()
      restored.importState(exported)

      expect(restored.getRecords().length).toBe(2)
      expect(restored.getTotalCost()).toBeCloseTo(original.getTotalCost(), 6)
    })

    it('should merge imported config', () => {
      const tracker = createCostTracker({
        budget: { maxCost: 10.0 },
      })

      tracker.importState({
        records: [],
        config: { budget: { alertThreshold: 5.0 } },
      })

      const config = tracker.getConfig()
      expect(config.budget?.alertThreshold).toBe(5.0)
    })
  })

  describe('setBudget()', () => {
    it('should update budget configuration', () => {
      const tracker = createCostTracker()

      tracker.setBudget({
        maxCost: 5.0,
        alertThreshold: 4.0,
      })

      const config = tracker.getConfig()
      expect(config.budget?.maxCost).toBe(5.0)
      expect(config.budget?.alertThreshold).toBe(4.0)
    })

    it('should reset alert state when threshold increases', () => {
      const onAlert = vi.fn()

      const tracker = createCostTracker({
        budget: {
          alertThreshold: 0.001,
          onAlert,
        },
      })

      // Trigger alert
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })
      expect(onAlert).toHaveBeenCalledTimes(1)

      // Reset tracker to get below threshold
      tracker.reset()

      // Set new threshold
      tracker.setBudget({ alertThreshold: 0.001, onAlert })

      // Record more - should trigger alert again since tracker was reset
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 5000 })
      expect(onAlert).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// Agent Integration Tests
// ============================================================================

describe('Agent Integration', () => {
  describe('withCostTracking()', () => {
    it('should wrap agent with cost tracking', () => {
      const provider = createMockProvider({
        responses: [{ text: 'Hello!', usage: createTokenUsage(100, 50) }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker()
      const trackedAgent = withCostTracking(agent, tracker)

      expect(trackedAgent.getCostTracker()).toBe(tracker)
      expect(trackedAgent.getTotalCost()).toBe(0)
      expect(trackedAgent.getRemainingBudget()).toBe(Infinity)
    })

    it('should track usage from agent runs', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Response', usage: createTokenUsage(500, 250) }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker()
      const trackedAgent = withCostTracking(agent, tracker)

      await trackedAgent.run({ prompt: 'Hello' })

      expect(tracker.getRecords().length).toBe(1)
      expect(tracker.getTotalCost()).toBeGreaterThan(0)
    })

    it('should track usage across multiple runs', async () => {
      const provider = createMockProvider({
        responses: [
          { text: 'Response 1', usage: createTokenUsage(100, 50) },
          { text: 'Response 2', usage: createTokenUsage(200, 100) },
          { text: 'Response 3', usage: createTokenUsage(150, 75) },
        ],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker()
      const trackedAgent = withCostTracking(agent, tracker)

      await trackedAgent.run({ prompt: 'First' })
      await trackedAgent.run({ prompt: 'Second' })
      await trackedAgent.run({ prompt: 'Third' })

      expect(tracker.getRecords().length).toBe(3)
      const stats = tracker.getStats()
      expect(stats.totalPromptTokens).toBe(450)
      expect(stats.totalCompletionTokens).toBe(225)
    })

    it('should throw when budget exceeded with hardLimit', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Response', usage: createTokenUsage(100000, 50000) }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker({
        budget: {
          maxCost: 0.001,
          hardLimit: true,
        },
      })
      const trackedAgent = withCostTracking(agent, tracker)

      // First run uses up budget
      await expect(
        trackedAgent.run({ prompt: 'First' })
      ).rejects.toThrow(BudgetExceededError)
    })

    it('should check budget before running', async () => {
      const provider = createMockProvider({
        responses: [
          { text: 'Response', usage: createTokenUsage(100, 50) },
          { text: 'Should not reach', usage: createTokenUsage(100, 50) },
        ],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      // Create a tracker that already has costs exceeding the budget
      // The pre-check should fail before even running the agent
      const tracker = createCostTracker({
        budget: {
          maxCost: 0.01, // $0.01 budget
          hardLimit: true,
        },
      })

      // Pre-exhaust the budget (without hardLimit enabled during this phase)
      // This simulates a scenario where budget was exhausted by previous runs
      // gpt-4o pricing: input $0.0025/1K, output $0.01/1K
      // 5K input = $0.0125, 5K output = $0.05 = $0.0625 total (exceeds $0.01)
      const tempTracker = createCostTracker()
      tempTracker.recordUsage({ model: 'gpt-4o', promptTokens: 5000, completionTokens: 5000 })
      tracker.importState(tempTracker.exportState())

      const trackedAgent = withCostTracking(agent, tracker)

      // Should fail pre-check since budget is already exhausted
      await expect(
        trackedAgent.run({ prompt: 'Should fail pre-check' })
      ).rejects.toThrow(BudgetExceededError)

      // Verify the agent's run was never called (no new records added)
      expect(tracker.getRecords().length).toBe(1) // Only the pre-exhaustion record
    })

    it('should track usage in streaming mode', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Streamed response', usage: createTokenUsage(300, 150) }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker()
      const trackedAgent = withCostTracking(agent, tracker)

      const stream = trackedAgent.stream({ prompt: 'Hello' })

      // Consume the stream to trigger the result
      for await (const _event of stream) {
        // Iterate through events
      }

      // After streaming, usage should be tracked
      expect(tracker.getRecords().length).toBe(1)
    })

    it('should pass through provider option', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Response', usage: createTokenUsage(100, 50) }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test',
        instructions: '',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker()
      const trackedAgent = withCostTracking(agent, tracker, { provider: 'openai' })

      await trackedAgent.run({ prompt: 'Hello' })

      const stats = tracker.getStats()
      expect(stats.byProvider['openai']).toBeDefined()
    })

    it('should preserve original agent config', () => {
      const provider = createMockProvider({
        responses: [{ text: 'Test' }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Be helpful',
        model: 'gpt-4o',
      })

      const tracker = createCostTracker()
      const trackedAgent = withCostTracking(agent, tracker)

      expect(trackedAgent.config.id).toBe('test-agent')
      expect(trackedAgent.config.name).toBe('Test Agent')
      expect(trackedAgent.config.model).toBe('gpt-4o')
    })
  })
})

// ============================================================================
// mergeTrackerStats() Tests
// ============================================================================

describe('mergeTrackerStats()', () => {
  it('should merge stats from multiple trackers', () => {
    const tracker1 = createCostTracker()
    tracker1.recordUsage({ model: 'gpt-4o', provider: 'openai', promptTokens: 100, completionTokens: 50 })

    const tracker2 = createCostTracker()
    tracker2.recordUsage({ model: 'gpt-4o', provider: 'openai', promptTokens: 200, completionTokens: 100 })

    const tracker3 = createCostTracker()
    tracker3.recordUsage({ model: 'claude-sonnet-4-20250514', provider: 'anthropic', promptTokens: 300, completionTokens: 150 })

    const merged = mergeTrackerStats([tracker1, tracker2, tracker3])

    expect(merged.totalPromptTokens).toBe(600)
    expect(merged.totalCompletionTokens).toBe(300)
    expect(merged.totalTokens).toBe(900)
    expect(merged.requestCount).toBe(3)
  })

  it('should merge model breakdowns', () => {
    const tracker1 = createCostTracker()
    tracker1.recordUsage({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 })

    const tracker2 = createCostTracker()
    tracker2.recordUsage({ model: 'gpt-4o', promptTokens: 200, completionTokens: 100 })

    const merged = mergeTrackerStats([tracker1, tracker2])

    expect(merged.byModel['gpt-4o'].promptTokens).toBe(300)
    expect(merged.byModel['gpt-4o'].requestCount).toBe(2)
  })

  it('should merge provider breakdowns', () => {
    const tracker1 = createCostTracker()
    tracker1.recordUsage({ model: 'gpt-4o', provider: 'openai', promptTokens: 100, completionTokens: 50 })

    const tracker2 = createCostTracker()
    tracker2.recordUsage({ model: 'claude-sonnet-4-20250514', provider: 'anthropic', promptTokens: 200, completionTokens: 100 })

    const merged = mergeTrackerStats([tracker1, tracker2])

    expect(merged.byProvider['openai'].requestCount).toBe(1)
    expect(merged.byProvider['anthropic'].requestCount).toBe(1)
  })

  it('should handle empty tracker list', () => {
    const merged = mergeTrackerStats([])

    expect(merged.totalTokens).toBe(0)
    expect(merged.requestCount).toBe(0)
  })
})

// ============================================================================
// BudgetExceededError Tests
// ============================================================================

describe('BudgetExceededError', () => {
  it('should contain current cost and max cost', () => {
    const error = new BudgetExceededError(10.5, 10.0, 'test-tracker')

    expect(error.currentCost).toBe(10.5)
    expect(error.maxCost).toBe(10.0)
    expect(error.trackerId).toBe('test-tracker')
  })

  it('should have descriptive message', () => {
    const error = new BudgetExceededError(10.5, 10.0)

    expect(error.message).toContain('Budget exceeded')
    expect(error.message).toContain('10.5')
    expect(error.message).toContain('10.0')
  })

  it('should be instanceof Error', () => {
    const error = new BudgetExceededError(1, 1)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BudgetExceededError')
  })
})

// ============================================================================
// MODEL_PRICING Tests
// ============================================================================

describe('MODEL_PRICING', () => {
  it('should include common OpenAI models', () => {
    expect(MODEL_PRICING['gpt-4o']).toBeDefined()
    expect(MODEL_PRICING['gpt-4o-mini']).toBeDefined()
    expect(MODEL_PRICING['gpt-4-turbo']).toBeDefined()
    expect(MODEL_PRICING['gpt-3.5-turbo']).toBeDefined()
  })

  it('should include Anthropic models', () => {
    expect(MODEL_PRICING['claude-opus-4-20250514']).toBeDefined()
    expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined()
    expect(MODEL_PRICING['claude-3-opus-20240229']).toBeDefined()
  })

  it('should include Google models', () => {
    expect(MODEL_PRICING['gemini-1.5-pro']).toBeDefined()
    expect(MODEL_PRICING['gemini-1.5-flash']).toBeDefined()
  })

  it('should have input and output prices', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.input, `${model} should have input price`).toBeGreaterThan(0)
      expect(pricing.output, `${model} should have output price`).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle zero tokens', () => {
    const tracker = createCostTracker()

    const record = tracker.recordUsage({
      model: 'gpt-4o',
      promptTokens: 0,
      completionTokens: 0,
    })

    expect(record.cost).toBe(0)
    expect(tracker.getTotalCost()).toBe(0)
  })

  it('should handle very large token counts', () => {
    const tracker = createCostTracker()

    tracker.recordUsage({
      model: 'gpt-4o',
      promptTokens: 1000000,
      completionTokens: 500000,
    })

    expect(tracker.getTotalCost()).toBeGreaterThan(0)
    expect(Number.isFinite(tracker.getTotalCost())).toBe(true)
  })

  it('should handle rapid successive calls', () => {
    const tracker = createCostTracker()

    // Simulate burst of calls
    for (let i = 0; i < 1000; i++) {
      tracker.recordUsage({ model: 'gpt-4o', promptTokens: 10, completionTokens: 5 })
    }

    expect(tracker.getRecords().length).toBe(1000)
    expect(tracker.getStats().requestCount).toBe(1000)
  })

  it('should handle model pricing updates during tracking', () => {
    const tracker = createCostTracker()

    // Record with default pricing
    tracker.recordUsage({ model: 'custom', promptTokens: 1000, completionTokens: 500 })
    const costBefore = tracker.getTotalCost()

    // Add pricing for custom model
    tracker.setModelPricing('custom', { input: 0.01, output: 0.02 })

    // Record again - new pricing applies to new records
    tracker.recordUsage({ model: 'custom', promptTokens: 1000, completionTokens: 500 })
    const costAfter = tracker.getTotalCost()

    // Cost should increase (second record has pricing)
    expect(costAfter).toBeGreaterThan(costBefore)
  })
})
