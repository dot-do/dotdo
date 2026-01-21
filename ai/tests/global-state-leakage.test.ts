/**
 * Tests for Global State Leakage in AI Module
 *
 * This test file demonstrates and validates the fix for global mutable state
 * that can leak between requests in the AI module.
 *
 * Issues addressed:
 * 1. globalTracker singleton leaking usage data between requests
 * 2. Global providers Map leaking configuration between requests
 *
 * @see do-hdgk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  UsageTracker,
  globalTracker,
  type UsageRecord,
} from '../tracking'
import {
  configureProvider,
  getProvider,
  clearProviders,
  type Provider,
} from '../ai-core'

describe('Global State Leakage', () => {
  describe('globalTracker leakage', () => {
    // Save original state to restore after tests
    let originalRecords: UsageRecord[]

    beforeEach(() => {
      // Capture initial state
      originalRecords = globalTracker.exportRecords()
      globalTracker.reset()
    })

    afterEach(() => {
      // Restore original state
      globalTracker.reset()
      globalTracker.importRecords(originalRecords)
    })

    it('should demonstrate that globalTracker persists state across simulated requests', () => {
      // Simulate Request 1: Add usage
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      const reportAfterRequest1 = globalTracker.getReport()
      expect(reportAfterRequest1.requestCount).toBe(1)
      expect(reportAfterRequest1.totalCost).toBeCloseTo(0.001, 6)

      // Simulate Request 2: Different tenant/user - should NOT see Request 1 data
      // But with global state, it DOES see it (this is the bug!)
      const reportInRequest2 = globalTracker.getReport()

      // This assertion shows the LEAK - Request 2 sees Request 1's data
      // In a properly isolated system, this should be 0
      expect(reportInRequest2.requestCount).toBe(1) // BUG: Should be 0 for isolated requests
    })

    it('should demonstrate budget threshold callbacks leaking between requests', () => {
      const alertsFromRequest1: number[] = []
      const alertsFromRequest2: number[] = []

      // Request 1: Set up budget with threshold callback
      globalTracker.setBudgetLimit(1.0)
      globalTracker.onBudgetThreshold(0.5, (cost) => {
        alertsFromRequest1.push(cost)
      })

      // Request 2: Set up a different budget (simulating different tenant)
      // The threshold callback from Request 1 is still registered!
      globalTracker.onBudgetThreshold(0.8, (cost) => {
        alertsFromRequest2.push(cost)
      })

      // Add usage that triggers the 50% threshold
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.6,
        timestamp: Date.now(),
      })

      // Request 1's callback fires - this is a leak!
      // In isolated requests, Request 1's callback should not exist in Request 2's context
      expect(alertsFromRequest1.length).toBe(1) // BUG: Callback leaks between requests
    })
  })

  describe('provider configuration leakage', () => {
    beforeEach(() => {
      clearProviders()
    })

    afterEach(() => {
      clearProviders()
    })

    it('should demonstrate provider configuration persisting across requests', () => {
      // Request 1: Configure provider with specific API key
      configureProvider({
        provider: 'openai',
        apiKey: 'sk-request1-secret-key',
        defaultModel: 'gpt-4o',
      })

      const providerFromRequest1 = getProvider('openai')
      expect(providerFromRequest1?.apiKey).toBe('sk-request1-secret-key')

      // Request 2: Different tenant - should NOT see Request 1's configuration
      // But with global state, it DOES see it (this is the bug!)
      const providerInRequest2 = getProvider('openai')

      // This assertion shows the LEAK - Request 2 sees Request 1's API key
      // In a properly isolated system, this should be undefined
      expect(providerInRequest2?.apiKey).toBe('sk-request1-secret-key') // BUG: Should be undefined
    })

    it('should demonstrate default provider leaking between requests', () => {
      // Request 1: Configure anthropic as default
      configureProvider({
        provider: 'anthropic',
        apiKey: 'sk-ant-request1',
      })

      const defaultFromRequest1 = getProvider()
      expect(defaultFromRequest1?.provider).toBe('anthropic')

      // Request 2: Different tenant - should have NO default provider
      // But the global defaultProvider persists
      const defaultInRequest2 = getProvider()

      // This shows the leak
      expect(defaultInRequest2?.provider).toBe('anthropic') // BUG: Should be undefined
    })
  })

  describe('request-scoped isolation (desired behavior)', () => {
    it('should provide isolated usage tracking per request context', () => {
      // Create request-scoped trackers (the fix)
      const request1Tracker = new UsageTracker()
      const request2Tracker = new UsageTracker()

      // Request 1: Add usage
      request1Tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      // Request 2: Should be isolated
      const request2Report = request2Tracker.getReport()
      expect(request2Report.requestCount).toBe(0) // Correct: No leakage
      expect(request2Report.totalCost).toBe(0)

      // Request 1: Should still have its data
      const request1Report = request1Tracker.getReport()
      expect(request1Report.requestCount).toBe(1)
      expect(request1Report.totalCost).toBeCloseTo(0.001, 6)
    })

    it('should provide isolated budget thresholds per request context', () => {
      const request1Tracker = new UsageTracker()
      const request2Tracker = new UsageTracker()

      const request1Alerts: number[] = []
      const request2Alerts: number[] = []

      // Request 1: Set budget and threshold
      request1Tracker.setBudgetLimit(1.0)
      request1Tracker.onBudgetThreshold(0.5, (cost) => request1Alerts.push(cost))

      // Request 2: Different budget and threshold
      request2Tracker.setBudgetLimit(10.0)
      request2Tracker.onBudgetThreshold(0.5, (cost) => request2Alerts.push(cost))

      // Add usage to request 1 that triggers threshold
      request1Tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.6,
        timestamp: Date.now(),
      })

      // Only request 1's callback should fire
      expect(request1Alerts.length).toBe(1)
      expect(request2Alerts.length).toBe(0) // Correct: Isolated
    })
  })
})

describe('createRequestContext - Factory for Request-Scoped AI State', () => {
  it('should create isolated context for each request', async () => {
    // Import the factory function (to be implemented)
    const { createRequestContext } = await import('../context')

    const request1Context = createRequestContext()
    const request2Context = createRequestContext()

    // Configure provider in request 1
    request1Context.configureProvider({
      provider: 'openai',
      apiKey: 'sk-request1',
    })

    // Request 2 should not see request 1's configuration
    expect(request2Context.getProvider('openai')).toBeUndefined()
    expect(request1Context.getProvider('openai')?.apiKey).toBe('sk-request1')
  })

  it('should provide isolated usage tracking per context', async () => {
    const { createRequestContext } = await import('../context')

    const ctx1 = createRequestContext()
    const ctx2 = createRequestContext()

    // Track usage in context 1
    ctx1.tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokens: { input: 100, output: 50 },
      cost: 0.001,
      timestamp: Date.now(),
    })

    // Context 2 should have empty tracking
    expect(ctx2.tracker.getReport().requestCount).toBe(0)
    expect(ctx1.tracker.getReport().requestCount).toBe(1)
  })

  it('should allow cleanup of context resources', async () => {
    const { createRequestContext } = await import('../context')

    const ctx = createRequestContext()

    ctx.configureProvider({
      provider: 'openai',
      apiKey: 'sk-test',
    })

    ctx.tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokens: { input: 100, output: 50 },
      cost: 0.001,
      timestamp: Date.now(),
    })

    // Cleanup should reset all state
    ctx.cleanup()

    expect(ctx.getProvider('openai')).toBeUndefined()
    expect(ctx.tracker.getReport().requestCount).toBe(0)
  })

  it('should track default provider correctly', async () => {
    const { createRequestContext } = await import('../context')

    const ctx = createRequestContext()

    // First provider becomes default
    ctx.configureProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant',
    })

    expect(ctx.getDefaultProvider()).toBe('anthropic')
    expect(ctx.getProvider()?.provider).toBe('anthropic')

    // Adding another provider doesn't change default
    ctx.configureProvider({
      provider: 'openai',
      apiKey: 'sk-openai',
    })

    expect(ctx.getDefaultProvider()).toBe('anthropic')
  })

  it('should clear providers correctly', async () => {
    const { createRequestContext } = await import('../context')

    const ctx = createRequestContext()

    ctx.configureProvider({
      provider: 'openai',
      apiKey: 'sk-test',
    })

    ctx.clearProviders()

    expect(ctx.getProvider('openai')).toBeUndefined()
    expect(ctx.getDefaultProvider()).toBeNull()
  })
})

describe('AsyncLocalStorage-based Context (runWithContext)', () => {
  it('should provide context within runWithContext scope', async () => {
    const { runWithContext, getCurrentContext } = await import('../context')

    let contextInsideRun: ReturnType<typeof getCurrentContext>

    await runWithContext(async () => {
      contextInsideRun = getCurrentContext()
      expect(contextInsideRun).toBeDefined()
      expect(contextInsideRun?.tracker).toBeDefined()
    })

    // Context should be cleaned up after runWithContext completes
    expect(getCurrentContext()).toBeUndefined()
  })

  it('should isolate contexts between nested runWithContext calls', async () => {
    const { runWithContext, getCurrentContext } = await import('../context')

    await runWithContext(async () => {
      const outerCtx = getCurrentContext()!
      outerCtx.configureProvider({
        provider: 'openai',
        apiKey: 'outer-key',
      })

      await runWithContext(async () => {
        const innerCtx = getCurrentContext()!

        // Inner context should be a different instance
        expect(innerCtx).not.toBe(outerCtx)

        // Inner context should NOT see outer context's provider
        expect(innerCtx.getProvider('openai')).toBeUndefined()

        // Configure inner context
        innerCtx.configureProvider({
          provider: 'anthropic',
          apiKey: 'inner-key',
        })

        expect(innerCtx.getProvider('anthropic')?.apiKey).toBe('inner-key')
      })

      // After inner runWithContext, outer context should be restored
      // and should still have its original provider
      const restoredCtx = getCurrentContext()!
      expect(restoredCtx.getProvider('openai')?.apiKey).toBe('outer-key')
      expect(restoredCtx.getProvider('anthropic')).toBeUndefined()
    })
  })

  it('should automatically cleanup context on runWithContext completion', async () => {
    const { runWithContext, getCurrentContext } = await import('../context')

    let capturedContext: ReturnType<typeof getCurrentContext>

    await runWithContext(async () => {
      capturedContext = getCurrentContext()
      capturedContext?.tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      expect(capturedContext?.tracker.getReport().requestCount).toBe(1)
    })

    // After cleanup, the tracker should be reset
    expect(capturedContext?.tracker.getReport().requestCount).toBe(0)
  })

  it('should cleanup context even if function throws', async () => {
    const { runWithContext, getCurrentContext } = await import('../context')

    let capturedContext: ReturnType<typeof getCurrentContext>

    try {
      await runWithContext(async () => {
        capturedContext = getCurrentContext()
        capturedContext?.tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })
        throw new Error('Test error')
      })
    } catch {
      // Expected error
    }

    // Context should still be cleaned up
    expect(capturedContext?.tracker.getReport().requestCount).toBe(0)
    expect(getCurrentContext()).toBeUndefined()
  })
})

describe('getOrCreateContext helper', () => {
  it('should return existing context when inside runWithContext', async () => {
    const { runWithContext, getCurrentContext, getOrCreateContext } = await import('../context')

    await runWithContext(async () => {
      const existingCtx = getCurrentContext()!
      const retrievedCtx = getOrCreateContext()

      expect(retrievedCtx).toBe(existingCtx)
    })
  })

  it('should create new context when outside runWithContext', async () => {
    const { getCurrentContext, getOrCreateContext } = await import('../context')

    // Outside runWithContext, getCurrentContext returns undefined
    expect(getCurrentContext()).toBeUndefined()

    // getOrCreateContext should create a new one
    const newCtx = getOrCreateContext()
    expect(newCtx).toBeDefined()
    expect(newCtx.tracker).toBeDefined()
  })
})
