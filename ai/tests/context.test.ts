/**
 * Tests for Request-Scoped AI Context
 *
 * This test file validates the context.ts module which provides:
 * 1. createRequestContext() - Factory for isolated request contexts
 * 2. runWithContext() - AsyncLocalStorage-based automatic scoping
 * 3. getCurrentContext() - Retrieve current context from ALS
 * 4. getOrCreateContext() - Get existing or create new context
 *
 * These functions prevent global state leakage between requests in
 * multi-tenant environments.
 *
 * @see do-hdgk - Fix for global mutable tracker state leakage
 * @see do-bsno.12 - Test task for context module
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRequestContext,
  runWithContext,
  getCurrentContext,
  getOrCreateContext,
  type RequestContext,
} from '../context'

describe('createRequestContext', () => {
  describe('context factory', () => {
    it('should create a new context with isolated tracker', () => {
      const ctx = createRequestContext()

      expect(ctx).toBeDefined()
      expect(ctx.tracker).toBeDefined()
      expect(ctx.tracker.getReport().requestCount).toBe(0)
    })

    it('should create independent contexts on each call', () => {
      const ctx1 = createRequestContext()
      const ctx2 = createRequestContext()

      expect(ctx1).not.toBe(ctx2)
      expect(ctx1.tracker).not.toBe(ctx2.tracker)
    })
  })

  describe('context isolation', () => {
    it('should isolate tracker state between contexts', () => {
      const ctx1 = createRequestContext()
      const ctx2 = createRequestContext()

      // Record usage in context 1
      ctx1.tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      // Context 2 should not see context 1's usage
      expect(ctx2.tracker.getReport().requestCount).toBe(0)
      expect(ctx2.tracker.getReport().totalCost).toBe(0)

      // Context 1 should have its usage
      expect(ctx1.tracker.getReport().requestCount).toBe(1)
      expect(ctx1.tracker.getReport().totalCost).toBeCloseTo(0.001, 6)
    })

    it('should isolate provider configuration between contexts', () => {
      const ctx1 = createRequestContext()
      const ctx2 = createRequestContext()

      // Configure provider in context 1
      ctx1.configureProvider({
        provider: 'openai',
        apiKey: 'sk-ctx1-secret',
      })

      // Context 2 should not see context 1's provider
      expect(ctx2.getProvider('openai')).toBeUndefined()

      // Context 1 should have its provider
      expect(ctx1.getProvider('openai')?.apiKey).toBe('sk-ctx1-secret')
    })

    it('should isolate default provider between contexts', () => {
      const ctx1 = createRequestContext()
      const ctx2 = createRequestContext()

      // Set default provider in context 1
      ctx1.configureProvider({
        provider: 'anthropic',
        apiKey: 'sk-ant-ctx1',
      })

      // Context 1 should have anthropic as default
      expect(ctx1.getDefaultProvider()).toBe('anthropic')

      // Context 2 should have no default
      expect(ctx2.getDefaultProvider()).toBeNull()
    })

    it('should isolate budget settings between contexts', () => {
      const ctx1 = createRequestContext()
      const ctx2 = createRequestContext()

      // Set budget in context 1
      ctx1.tracker.setBudgetLimit(10.0)

      // Context 2 should have unlimited budget (Infinity)
      expect(ctx1.tracker.getBudgetLimit()).toBe(10.0)
      expect(ctx2.tracker.getBudgetLimit()).toBe(Infinity)
    })

    it('should isolate budget threshold callbacks between contexts', () => {
      const ctx1Alerts: number[] = []
      const ctx2Alerts: number[] = []

      const ctx1 = createRequestContext()
      const ctx2 = createRequestContext()

      ctx1.tracker.setBudgetLimit(1.0)
      ctx1.tracker.onBudgetThreshold(0.5, (cost) => ctx1Alerts.push(cost))

      ctx2.tracker.setBudgetLimit(1.0)
      ctx2.tracker.onBudgetThreshold(0.5, (cost) => ctx2Alerts.push(cost))

      // Trigger threshold in context 1 only
      ctx1.tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.6,
        timestamp: Date.now(),
      })

      // Only context 1's callback should fire
      expect(ctx1Alerts).toHaveLength(1)
      expect(ctx2Alerts).toHaveLength(0)
    })
  })

  describe('provider management', () => {
    let ctx: RequestContext

    beforeEach(() => {
      ctx = createRequestContext()
    })

    it('should configure and retrieve providers', () => {
      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-test',
        defaultModel: 'gpt-4o',
      })

      const provider = ctx.getProvider('openai')
      expect(provider?.provider).toBe('openai')
      expect(provider?.apiKey).toBe('sk-test')
      expect(provider?.defaultModel).toBe('gpt-4o')
    })

    it('should set first configured provider as default', () => {
      ctx.configureProvider({
        provider: 'anthropic',
        apiKey: 'sk-ant',
      })

      expect(ctx.getDefaultProvider()).toBe('anthropic')
      expect(ctx.getProvider()?.provider).toBe('anthropic')
    })

    it('should not change default when configuring additional providers', () => {
      ctx.configureProvider({
        provider: 'anthropic',
        apiKey: 'sk-ant',
      })

      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-openai',
      })

      // Default should still be anthropic
      expect(ctx.getDefaultProvider()).toBe('anthropic')
    })

    it('should return undefined for unconfigured providers', () => {
      expect(ctx.getProvider('openai')).toBeUndefined()
      expect(ctx.getProvider('anthropic')).toBeUndefined()
      expect(ctx.getProvider()).toBeUndefined()
    })

    it('should clear all providers', () => {
      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-openai',
      })

      ctx.configureProvider({
        provider: 'anthropic',
        apiKey: 'sk-ant',
      })

      ctx.clearProviders()

      expect(ctx.getProvider('openai')).toBeUndefined()
      expect(ctx.getProvider('anthropic')).toBeUndefined()
      expect(ctx.getDefaultProvider()).toBeNull()
    })

    it('should update existing provider configuration', () => {
      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-old',
      })

      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-new',
        defaultModel: 'gpt-4o-mini',
      })

      const provider = ctx.getProvider('openai')
      expect(provider?.apiKey).toBe('sk-new')
      expect(provider?.defaultModel).toBe('gpt-4o-mini')
    })
  })

  describe('cleanup', () => {
    it('should reset tracker on cleanup', () => {
      const ctx = createRequestContext()

      ctx.tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      expect(ctx.tracker.getReport().requestCount).toBe(1)

      ctx.cleanup()

      expect(ctx.tracker.getReport().requestCount).toBe(0)
    })

    it('should clear providers on cleanup', () => {
      const ctx = createRequestContext()

      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-test',
      })

      ctx.cleanup()

      expect(ctx.getProvider('openai')).toBeUndefined()
      expect(ctx.getDefaultProvider()).toBeNull()
    })

    it('should allow reuse after cleanup', () => {
      const ctx = createRequestContext()

      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'sk-old',
      })

      ctx.cleanup()

      // Configure again after cleanup
      ctx.configureProvider({
        provider: 'anthropic',
        apiKey: 'sk-new',
      })

      expect(ctx.getProvider('anthropic')?.apiKey).toBe('sk-new')
      expect(ctx.getDefaultProvider()).toBe('anthropic')
    })
  })
})

describe('runWithContext (AsyncLocalStorage)', () => {
  describe('context availability', () => {
    it('should provide context within runWithContext scope', async () => {
      let insideContext: RequestContext | undefined

      await runWithContext(async () => {
        insideContext = getCurrentContext()
        expect(insideContext).toBeDefined()
        expect(insideContext?.tracker).toBeDefined()
      })

      expect(insideContext).toBeDefined()
    })

    it('should not provide context outside runWithContext', async () => {
      // First, run one context to initialize ALS
      await runWithContext(async () => {
        expect(getCurrentContext()).toBeDefined()
      })

      // Outside of runWithContext, context should be undefined
      expect(getCurrentContext()).toBeUndefined()
    })

    it('should return undefined before any runWithContext call', () => {
      // Note: This depends on test isolation. If ALS was never initialized,
      // getCurrentContext should return undefined
      // This test may be affected by test order - ALS is lazily initialized
      const ctx = getCurrentContext()
      // Can be undefined if ALS not initialized, or undefined if not in context
      expect(ctx).toBeUndefined()
    })
  })

  describe('context propagation', () => {
    it('should propagate context through async operations', async () => {
      await runWithContext(async () => {
        const ctx1 = getCurrentContext()

        // Simulate async operation
        await Promise.resolve()

        const ctx2 = getCurrentContext()

        // Same context should be available after async boundary
        expect(ctx2).toBe(ctx1)
      })
    })

    it('should propagate context through nested async calls', async () => {
      await runWithContext(async () => {
        const outerCtx = getCurrentContext()

        const innerResult = await (async () => {
          await Promise.resolve()
          return getCurrentContext()
        })()

        expect(innerResult).toBe(outerCtx)
      })
    })

    it('should propagate context through Promise.all', async () => {
      await runWithContext(async () => {
        const ctx = getCurrentContext()

        const [ctx1, ctx2, ctx3] = await Promise.all([
          Promise.resolve().then(() => getCurrentContext()),
          Promise.resolve().then(() => getCurrentContext()),
          Promise.resolve().then(() => getCurrentContext()),
        ])

        expect(ctx1).toBe(ctx)
        expect(ctx2).toBe(ctx)
        expect(ctx3).toBe(ctx)
      })
    })

    it('should maintain context modifications within scope', async () => {
      await runWithContext(async () => {
        const ctx = getCurrentContext()!

        ctx.configureProvider({
          provider: 'openai',
          apiKey: 'sk-test',
        })

        await Promise.resolve()

        // Modifications should persist through async boundaries
        const laterCtx = getCurrentContext()!
        expect(laterCtx.getProvider('openai')?.apiKey).toBe('sk-test')
      })
    })
  })

  describe('nested contexts', () => {
    it('should create new context for nested runWithContext', async () => {
      await runWithContext(async () => {
        const outerCtx = getCurrentContext()

        await runWithContext(async () => {
          const innerCtx = getCurrentContext()

          // Inner context should be different from outer
          expect(innerCtx).not.toBe(outerCtx)
        })
      })
    })

    it('should isolate state between nested contexts', async () => {
      await runWithContext(async () => {
        const outerCtx = getCurrentContext()!
        outerCtx.configureProvider({
          provider: 'openai',
          apiKey: 'outer-key',
        })

        await runWithContext(async () => {
          const innerCtx = getCurrentContext()!

          // Inner context should not see outer's provider
          expect(innerCtx.getProvider('openai')).toBeUndefined()

          // Configure different provider in inner
          innerCtx.configureProvider({
            provider: 'anthropic',
            apiKey: 'inner-key',
          })

          expect(innerCtx.getProvider('anthropic')?.apiKey).toBe('inner-key')
        })

        // After inner completes, outer should be restored
        // Note: With real AsyncLocalStorage, outer context is restored
        // but our current implementation may differ
        const restoredCtx = getCurrentContext()
        // Outer context's configuration should be unchanged
        expect(restoredCtx?.getProvider('openai')?.apiKey).toBe('outer-key')
      })
    })

    it('should cleanup inner context independently', async () => {
      let innerTracker: ReturnType<typeof getCurrentContext>

      await runWithContext(async () => {
        const outerCtx = getCurrentContext()!
        outerCtx.tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })

        await runWithContext(async () => {
          innerTracker = getCurrentContext()
          innerTracker?.tracker.record({
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            tokens: { input: 200, output: 100 },
            cost: 0.002,
            timestamp: Date.now(),
          })

          expect(innerTracker?.tracker.getReport().requestCount).toBe(1)
        })

        // Inner context should be cleaned up
        expect(innerTracker?.tracker.getReport().requestCount).toBe(0)

        // Outer context should be unaffected
        expect(outerCtx.tracker.getReport().requestCount).toBe(1)
      })
    })
  })

  describe('automatic cleanup', () => {
    it('should cleanup context when function completes normally', async () => {
      let capturedCtx: RequestContext | undefined

      await runWithContext(async () => {
        capturedCtx = getCurrentContext()
        capturedCtx?.tracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })

        expect(capturedCtx?.tracker.getReport().requestCount).toBe(1)
      })

      // After completion, tracker should be reset
      expect(capturedCtx?.tracker.getReport().requestCount).toBe(0)
    })

    it('should cleanup context when function throws', async () => {
      let capturedCtx: RequestContext | undefined

      try {
        await runWithContext(async () => {
          capturedCtx = getCurrentContext()
          capturedCtx?.configureProvider({
            provider: 'openai',
            apiKey: 'sk-test',
          })
          throw new Error('Test error')
        })
      } catch {
        // Expected
      }

      // Context should still be cleaned up
      expect(capturedCtx?.getProvider('openai')).toBeUndefined()
      expect(capturedCtx?.tracker.getReport().requestCount).toBe(0)
    })

    it('should return value from runWithContext', async () => {
      const result = await runWithContext(async () => {
        return 'test-value'
      })

      expect(result).toBe('test-value')
    })

    it('should propagate errors from runWithContext', async () => {
      const error = new Error('Test error')

      await expect(
        runWithContext(async () => {
          throw error
        }),
      ).rejects.toThrow('Test error')
    })
  })
})

describe('getOrCreateContext', () => {
  it('should return existing context when inside runWithContext', async () => {
    await runWithContext(async () => {
      const existingCtx = getCurrentContext()
      const retrievedCtx = getOrCreateContext()

      expect(retrievedCtx).toBe(existingCtx)
    })
  })

  it('should create new context when outside runWithContext', async () => {
    // Ensure we're outside any context
    // First run one context to initialize ALS
    await runWithContext(async () => {
      // Just initialize
    })

    // Now outside runWithContext
    expect(getCurrentContext()).toBeUndefined()

    const newCtx = getOrCreateContext()
    expect(newCtx).toBeDefined()
    expect(newCtx.tracker).toBeDefined()
  })

  it('should create independent contexts when called multiple times outside runWithContext', async () => {
    // Initialize ALS
    await runWithContext(async () => {})

    const ctx1 = getOrCreateContext()
    const ctx2 = getOrCreateContext()

    // Each call creates a new context when outside runWithContext
    expect(ctx1).not.toBe(ctx2)
  })

  it('should return same context when called multiple times inside runWithContext', async () => {
    await runWithContext(async () => {
      const ctx1 = getOrCreateContext()
      const ctx2 = getOrCreateContext()
      const ctx3 = getOrCreateContext()

      expect(ctx1).toBe(ctx2)
      expect(ctx2).toBe(ctx3)
    })
  })
})

describe('concurrent request simulation', () => {
  it('should isolate concurrent requests', async () => {
    const results: { id: string; provider: string | null }[] = []

    // Simulate concurrent requests
    const request1 = runWithContext(async () => {
      const ctx = getCurrentContext()!
      ctx.configureProvider({
        provider: 'openai',
        apiKey: 'request-1-key',
      })

      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 10))

      const provider = ctx.getDefaultProvider()
      results.push({ id: 'request-1', provider })
    })

    const request2 = runWithContext(async () => {
      const ctx = getCurrentContext()!
      ctx.configureProvider({
        provider: 'anthropic',
        apiKey: 'request-2-key',
      })

      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 5))

      const provider = ctx.getDefaultProvider()
      results.push({ id: 'request-2', provider })
    })

    await Promise.all([request1, request2])

    // Each request should have its own provider
    const req1Result = results.find((r) => r.id === 'request-1')
    const req2Result = results.find((r) => r.id === 'request-2')

    expect(req1Result?.provider).toBe('openai')
    expect(req2Result?.provider).toBe('anthropic')
  })

  it('should isolate usage tracking between concurrent requests', async () => {
    const reports: { id: string; cost: number }[] = []

    const request1 = runWithContext(async () => {
      const ctx = getCurrentContext()!

      ctx.tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 1000, output: 500 },
        cost: 0.01,
        timestamp: Date.now(),
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      reports.push({ id: 'request-1', cost: ctx.tracker.getReport().totalCost })
    })

    const request2 = runWithContext(async () => {
      const ctx = getCurrentContext()!

      ctx.tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        tokens: { input: 500, output: 250 },
        cost: 0.005,
        timestamp: Date.now(),
      })

      await new Promise((resolve) => setTimeout(resolve, 5))

      reports.push({ id: 'request-2', cost: ctx.tracker.getReport().totalCost })
    })

    await Promise.all([request1, request2])

    const req1Report = reports.find((r) => r.id === 'request-1')
    const req2Report = reports.find((r) => r.id === 'request-2')

    // Each request should only see its own usage
    expect(req1Report?.cost).toBeCloseTo(0.01, 6)
    expect(req2Report?.cost).toBeCloseTo(0.005, 6)
  })

  it('should handle many concurrent requests without cross-contamination', async () => {
    const requestCount = 20
    const results: Map<number, { provider: string | null; cost: number }> = new Map()

    const requests = Array.from({ length: requestCount }, (_, i) =>
      runWithContext(async () => {
        const ctx = getCurrentContext()!
        const provider = i % 2 === 0 ? 'openai' : 'anthropic'
        const cost = i * 0.001

        ctx.configureProvider({
          provider: provider as 'openai' | 'anthropic',
          apiKey: `sk-request-${i}`,
        })

        ctx.tracker.record({
          provider: provider as 'openai' | 'anthropic',
          model: provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4',
          tokens: { input: 100, output: 50 },
          cost,
          timestamp: Date.now(),
        })

        // Random delay to simulate real-world async behavior
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20))

        results.set(i, {
          provider: ctx.getDefaultProvider(),
          cost: ctx.tracker.getReport().totalCost,
        })
      }),
    )

    await Promise.all(requests)

    // Verify each request has correct isolated data
    for (let i = 0; i < requestCount; i++) {
      const result = results.get(i)
      const expectedProvider = i % 2 === 0 ? 'openai' : 'anthropic'
      const expectedCost = i * 0.001

      expect(result?.provider).toBe(expectedProvider)
      expect(result?.cost).toBeCloseTo(expectedCost, 6)
    }
  })
})
