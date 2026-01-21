/**
 * Tests for Async Context Propagation Issues
 *
 * This test file demonstrates that the AsyncLocalStorage fallback stack
 * implementation loses context across async boundaries.
 *
 * The fallback implementation uses a simple stack:
 * ```ts
 * run<R>(store: RequestContext, callback: () => R): R {
 *   contextStack.push(store)
 *   try {
 *     return callback()
 *   } finally {
 *     contextStack.pop()  // BUG: Pops BEFORE async callback completes!
 *   }
 * }
 * ```
 *
 * This works for synchronous operations, but fails when:
 * 1. The callback is async and returns a Promise
 * 2. Nested async operations occur within the callback
 * 3. setTimeout/setImmediate/microtasks are used
 *
 * @see do-5s0l - TDD test for async context propagation
 * @see do-xsmr - AsyncLocalStorage fallback stack implementation has async context propagation issues
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Simulates the broken fallback stack implementation from context.ts
 * This is extracted to make the test self-contained and demonstrate the bug.
 */
function createFallbackAsyncLocalStorage<T>() {
  const contextStack: T[] = []

  return {
    /**
     * The problematic run implementation.
     *
     * Issue: When callback() returns a Promise, the finally block executes
     * immediately (synchronously) BEFORE the Promise resolves. This means
     * the context is popped from the stack while async operations are still
     * running inside the callback.
     */
    run<R>(store: T, callback: () => R): R {
      contextStack.push(store)
      try {
        return callback()
      } finally {
        // BUG: This runs synchronously, before any await in callback completes
        contextStack.pop()
      }
    },

    getStore(): T | undefined {
      return contextStack[contextStack.length - 1]
    },

    // Expose stack for testing
    _getStackLength(): number {
      return contextStack.length
    },
  }
}

describe('Async Context Propagation Issues', () => {
  describe('Fallback Stack Implementation Bug', () => {
    it('should FAIL: context is lost after first await in async callback', async () => {
      const storage = createFallbackAsyncLocalStorage<{ id: string }>()
      const context = { id: 'request-123' }

      let contextBeforeAwait: { id: string } | undefined
      let contextAfterAwait: { id: string } | undefined

      await storage.run(context, async () => {
        // Context is available synchronously
        contextBeforeAwait = storage.getStore()

        // Simulate async operation (DB call, HTTP request, etc.)
        await Promise.resolve()

        // BUG: Context is GONE after await because finally{} already popped it
        contextAfterAwait = storage.getStore()
      })

      // This passes - context exists before await
      expect(contextBeforeAwait).toEqual({ id: 'request-123' })

      // THIS FAILS - context is lost after await
      // In a correct implementation, this should still be { id: 'request-123' }
      expect(contextAfterAwait).toEqual({ id: 'request-123' })
    })

    it('should FAIL: context is lost during chained async operations', async () => {
      const storage = createFallbackAsyncLocalStorage<{ userId: string }>()
      const context = { userId: 'user-456' }

      const contextAtEachStep: ({ userId: string } | undefined)[] = []

      await storage.run(context, async () => {
        contextAtEachStep.push(storage.getStore()) // Step 0: Should exist

        // Step 1: First async operation
        await new Promise((resolve) => setTimeout(resolve, 0))
        contextAtEachStep.push(storage.getStore()) // Step 1: Context LOST

        // Step 2: Second async operation
        // Intentionally ignoring fetch result - testing async context propagation, not fetch success
        await fetch('data:,').catch(() => {})
        contextAtEachStep.push(storage.getStore()) // Step 2: Context LOST

        // Step 3: Another await
        await Promise.resolve()
        contextAtEachStep.push(storage.getStore()) // Step 3: Context LOST
      })

      // All steps should have the context
      expect(contextAtEachStep[0]).toEqual({ userId: 'user-456' }) // Passes
      expect(contextAtEachStep[1]).toEqual({ userId: 'user-456' }) // FAILS
      expect(contextAtEachStep[2]).toEqual({ userId: 'user-456' }) // FAILS
      expect(contextAtEachStep[3]).toEqual({ userId: 'user-456' }) // FAILS
    })

    it('should FAIL: nested async callbacks lose parent context', async () => {
      const storage = createFallbackAsyncLocalStorage<{ level: number }>()

      const capturedContexts: ({ level: number } | undefined)[] = []

      await storage.run({ level: 1 }, async () => {
        capturedContexts.push(storage.getStore()) // Outer before await

        await Promise.resolve()

        capturedContexts.push(storage.getStore()) // Outer after await (LOST!)

        // Nested run
        await storage.run({ level: 2 }, async () => {
          capturedContexts.push(storage.getStore()) // Inner before await

          await Promise.resolve()

          capturedContexts.push(storage.getStore()) // Inner after await (LOST!)
        })

        // After inner completes
        capturedContexts.push(storage.getStore()) // Should be level 1 again
      })

      // Expected: [1, 1, 2, 2, 1]
      // Actual:   [1, undefined, 2, undefined, undefined]
      expect(capturedContexts.map((c) => c?.level)).toEqual([1, 1, 2, 2, 1])
    })

    it('should FAIL: context lost when using Promise.all', async () => {
      const storage = createFallbackAsyncLocalStorage<{ tenant: string }>()
      const context = { tenant: 'acme-corp' }

      const resultsWithContext: ({ tenant: string } | undefined)[] = []

      await storage.run(context, async () => {
        // Before any async work
        resultsWithContext.push(storage.getStore())

        // Run multiple async operations in parallel
        await Promise.all([
          (async () => {
            await Promise.resolve()
            resultsWithContext.push(storage.getStore()) // LOST
          })(),
          (async () => {
            await Promise.resolve()
            resultsWithContext.push(storage.getStore()) // LOST
          })(),
        ])

        // After Promise.all
        resultsWithContext.push(storage.getStore()) // LOST
      })

      // All should have the tenant context
      expect(resultsWithContext.every((c) => c?.tenant === 'acme-corp')).toBe(true)
    })

    it('should FAIL: context lost with queueMicrotask', async () => {
      const storage = createFallbackAsyncLocalStorage<{ requestId: string }>()
      const context = { requestId: 'req-789' }

      let contextInMicrotask: { requestId: string } | undefined

      await new Promise<void>((resolve) => {
        storage.run(context, () => {
          queueMicrotask(() => {
            // BUG: Context is already popped by the time microtask runs
            contextInMicrotask = storage.getStore()
            resolve()
          })
          // run() synchronously returns here, popping context
        })
      })

      // This FAILS - context is lost in microtask
      expect(contextInMicrotask).toEqual({ requestId: 'req-789' })
    })

    it('should FAIL: usage tracking leaks across concurrent requests', async () => {
      const storage = createFallbackAsyncLocalStorage<{ tracker: number[] }>()

      // Simulate two concurrent requests
      const request1Tracker = { tracker: [] as number[] }
      const request2Tracker = { tracker: [] as number[] }

      const request1 = storage.run(request1Tracker, async () => {
        storage.getStore()?.tracker.push(1)
        await Promise.resolve()
        // Context is lost here - this might push to wrong tracker or fail
        storage.getStore()?.tracker.push(2)
      })

      const request2 = storage.run(request2Tracker, async () => {
        storage.getStore()?.tracker.push(10)
        await Promise.resolve()
        // Context is lost here
        storage.getStore()?.tracker.push(20)
      })

      await Promise.all([request1, request2])

      // Each request should have its own isolated tracking
      // With the bug, values might leak between requests or be lost
      expect(request1Tracker.tracker).toEqual([1, 2])
      expect(request2Tracker.tracker).toEqual([10, 20])
    })
  })

  describe('Real-World Scenario: AI Module Context Loss', () => {
    it('should FAIL: provider config lost during AI call', async () => {
      // This simulates the actual bug in @dotdo/ai context
      const storage = createFallbackAsyncLocalStorage<{
        provider: string
        apiKey: string
      }>()

      const aiConfig = {
        provider: 'openai',
        apiKey: 'sk-secret-key',
      }

      let configDuringCall: typeof aiConfig | undefined
      let configAfterModelResponse: typeof aiConfig | undefined

      await storage.run(aiConfig, async () => {
        // Would be able to get config here
        configDuringCall = storage.getStore()

        // Simulate AI call that awaits
        await simulateAICall()

        // BUG: Config is GONE - can't charge to correct account,
        // can't use tenant-specific API key, etc.
        configAfterModelResponse = storage.getStore()
      })

      expect(configDuringCall?.apiKey).toBe('sk-secret-key')
      // THIS FAILS - we've lost the config after the AI call completes
      expect(configAfterModelResponse?.apiKey).toBe('sk-secret-key')
    })

    it('should FAIL: usage metrics lost across streaming response', async () => {
      const storage = createFallbackAsyncLocalStorage<{
        requestId: string
        tokens: { input: number; output: number }
      }>()

      const metricsContext = {
        requestId: 'ai-call-001',
        tokens: { input: 100, output: 0 },
      }

      const tokenUpdates: number[] = []

      await storage.run(metricsContext, async () => {
        // Simulate streaming response with multiple chunks
        for await (const chunk of simulateStreamingResponse()) {
          const ctx = storage.getStore()
          if (ctx) {
            ctx.tokens.output += chunk.tokenCount
            tokenUpdates.push(ctx.tokens.output)
          } else {
            // Context is lost - can't track tokens!
            tokenUpdates.push(-1)
          }
        }
      })

      // Should have incremental token counts, not -1 (lost context)
      expect(tokenUpdates).toEqual([10, 20, 30, 40, 50])
    })
  })
})

// Helper functions to simulate async operations
async function simulateAICall(): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1))
  return 'AI response'
}

async function* simulateStreamingResponse(): AsyncGenerator<{ tokenCount: number }> {
  for (let i = 1; i <= 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    yield { tokenCount: 10 }
  }
}
