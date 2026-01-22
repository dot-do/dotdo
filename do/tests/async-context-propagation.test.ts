/**
 * Tests for Async Context Propagation in WorkflowContext
 *
 * These tests verify that the WorkflowContext ($) properly propagates
 * context across async boundaries, preventing context leakage between
 * concurrent requests.
 *
 * @see do-nexi - Inconsistent async context propagation
 * @module do/tests/async-context-propagation.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createContext, type WorkflowContext } from '../workflow/context'
import {
  runWithWorkflowContext,
  runWithWorkflowContextSync,
  getCurrentWorkflowContext,
  getCurrentRequestContext,
  getContextMetadata,
  setContextMetadata,
  getRequestId,
  hasWorkflowContext,
  wrapHandler,
  resetAsyncContext,
  initializeAsyncContext,
} from '../workflow/async-context'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  return {
    id: { toString: () => 'test-do' },
    storage: {
      get: async () => undefined,
      put: async () => {},
      list: async () => new Map(),
      delete: async () => true,
      deleteAll: async () => {},
      sql: {
        exec: () => ({ changes: 0, lastRowId: 0 }),
      },
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

// ============================================================================
// TESTS: Async Context Propagation
// ============================================================================

describe('Async Context Propagation (do-nexi)', () => {
  let $: WorkflowContext

  beforeEach(async () => {
    // Reset the async context system before each test
    resetAsyncContext()
    await initializeAsyncContext()

    const mockState = createMockState()
    $ = createContext(mockState, {})
  })

  afterEach(() => {
    resetAsyncContext()
  })

  describe('runWithWorkflowContext', () => {
    it('should maintain context across simple await', async () => {
      let contextBeforeAwait: WorkflowContext | undefined
      let contextAfterAwait: WorkflowContext | undefined

      await runWithWorkflowContext($, async () => {
        contextBeforeAwait = getCurrentWorkflowContext()
        await Promise.resolve()
        contextAfterAwait = getCurrentWorkflowContext()
      })

      expect(contextBeforeAwait).toBeDefined()
      expect(contextAfterAwait).toBeDefined()
      expect(contextBeforeAwait).toBe(contextAfterAwait)
    })

    it('should maintain context across multiple awaits', async () => {
      const capturedContexts: (WorkflowContext | undefined)[] = []

      await runWithWorkflowContext($, async () => {
        capturedContexts.push(getCurrentWorkflowContext())
        await Promise.resolve()
        capturedContexts.push(getCurrentWorkflowContext())
        await new Promise((resolve) => setTimeout(resolve, 10))
        capturedContexts.push(getCurrentWorkflowContext())
        await Promise.resolve()
        capturedContexts.push(getCurrentWorkflowContext())
      })

      expect(capturedContexts.every((ctx) => ctx === $)).toBe(true)
    })

    it('should maintain context in Promise.all', async () => {
      const capturedContexts: (WorkflowContext | undefined)[] = []

      await runWithWorkflowContext($, async () => {
        capturedContexts.push(getCurrentWorkflowContext())

        await Promise.all([
          (async () => {
            await Promise.resolve()
            capturedContexts.push(getCurrentWorkflowContext())
          })(),
          (async () => {
            await new Promise((r) => setTimeout(r, 5))
            capturedContexts.push(getCurrentWorkflowContext())
          })(),
          (async () => {
            await Promise.resolve()
            await Promise.resolve()
            capturedContexts.push(getCurrentWorkflowContext())
          })(),
        ])

        capturedContexts.push(getCurrentWorkflowContext())
      })

      // All captured contexts should be the same
      expect(capturedContexts.every((ctx) => ctx === $)).toBe(true)
    })

    it('should not leak context between concurrent requests', async () => {
      const $1 = createContext(createMockState(), {})
      const $2 = createContext(createMockState(), {})

      const results1: (WorkflowContext | undefined)[] = []
      const results2: (WorkflowContext | undefined)[] = []

      const request1 = runWithWorkflowContext($1, async () => {
        results1.push(getCurrentWorkflowContext())
        await new Promise((r) => setTimeout(r, 20))
        results1.push(getCurrentWorkflowContext())
        await Promise.resolve()
        results1.push(getCurrentWorkflowContext())
      })

      const request2 = runWithWorkflowContext($2, async () => {
        results2.push(getCurrentWorkflowContext())
        await new Promise((r) => setTimeout(r, 10))
        results2.push(getCurrentWorkflowContext())
        await Promise.resolve()
        results2.push(getCurrentWorkflowContext())
      })

      await Promise.all([request1, request2])

      // Request 1 should always see context 1
      expect(results1.every((ctx) => ctx === $1)).toBe(true)
      // Request 2 should always see context 2
      expect(results2.every((ctx) => ctx === $2)).toBe(true)
    })

    it('should handle nested context runs', async () => {
      const $inner = createContext(createMockState(), {})

      let outerBefore: WorkflowContext | undefined
      let innerBefore: WorkflowContext | undefined
      let innerAfter: WorkflowContext | undefined
      let outerAfter: WorkflowContext | undefined

      await runWithWorkflowContext($, async () => {
        outerBefore = getCurrentWorkflowContext()
        await Promise.resolve()

        await runWithWorkflowContext($inner, async () => {
          innerBefore = getCurrentWorkflowContext()
          await Promise.resolve()
          innerAfter = getCurrentWorkflowContext()
        })

        outerAfter = getCurrentWorkflowContext()
      })

      expect(outerBefore).toBe($)
      expect(innerBefore).toBe($inner)
      expect(innerAfter).toBe($inner)
      expect(outerAfter).toBe($)
    })

    it('should return undefined outside of context', async () => {
      const outside = getCurrentWorkflowContext()
      expect(outside).toBeUndefined()

      await runWithWorkflowContext($, async () => {
        expect(getCurrentWorkflowContext()).toBe($)
      })

      const outsideAfter = getCurrentWorkflowContext()
      expect(outsideAfter).toBeUndefined()
    })
  })

  describe('runWithWorkflowContextSync', () => {
    it('should work with synchronous callbacks', () => {
      let capturedContext: WorkflowContext | undefined

      const result = runWithWorkflowContextSync($, () => {
        capturedContext = getCurrentWorkflowContext()
        return 'sync-result'
      })

      expect(result).toBe('sync-result')
      expect(capturedContext).toBe($)
    })

    it('should propagate errors correctly', () => {
      expect(() => {
        runWithWorkflowContextSync($, () => {
          throw new Error('sync error')
        })
      }).toThrow('sync error')

      // Context should be cleaned up after error
      expect(getCurrentWorkflowContext()).toBeUndefined()
    })
  })

  describe('Request-scoped metadata', () => {
    it('should store and retrieve metadata', async () => {
      await runWithWorkflowContext($, async () => {
        setContextMetadata('userId', 'user-123')
        setContextMetadata('tenantId', 'tenant-abc')

        await Promise.resolve()

        expect(getContextMetadata('userId')).toBe('user-123')
        expect(getContextMetadata('tenantId')).toBe('tenant-abc')
      })
    })

    it('should not leak metadata between requests', async () => {
      const $1 = createContext(createMockState(), {})
      const $2 = createContext(createMockState(), {})

      await runWithWorkflowContext($1, async () => {
        setContextMetadata('requestId', 'req-1')
        await Promise.resolve()
        expect(getContextMetadata('requestId')).toBe('req-1')
      })

      await runWithWorkflowContext($2, async () => {
        // Should not see metadata from $1
        expect(getContextMetadata('requestId')).toBeUndefined()
        setContextMetadata('requestId', 'req-2')
        expect(getContextMetadata('requestId')).toBe('req-2')
      })
    })

    it('should maintain metadata across await boundaries', async () => {
      await runWithWorkflowContext($, async () => {
        setContextMetadata('counter', 0)

        await Promise.resolve()
        const count1 = getContextMetadata<number>('counter') ?? 0
        setContextMetadata('counter', count1 + 1)

        await new Promise((r) => setTimeout(r, 5))
        const count2 = getContextMetadata<number>('counter') ?? 0
        setContextMetadata('counter', count2 + 1)

        await Promise.resolve()
        expect(getContextMetadata<number>('counter')).toBe(2)
      })
    })
  })

  describe('Request ID', () => {
    it('should generate unique request IDs', async () => {
      let requestId1: string | undefined
      let requestId2: string | undefined

      await runWithWorkflowContext($, async () => {
        requestId1 = getRequestId()
      })

      await runWithWorkflowContext($, async () => {
        requestId2 = getRequestId()
      })

      expect(requestId1).toBeDefined()
      expect(requestId2).toBeDefined()
      expect(requestId1).not.toBe(requestId2)
    })

    it('should maintain request ID across awaits', async () => {
      const capturedIds: (string | undefined)[] = []

      await runWithWorkflowContext($, async () => {
        capturedIds.push(getRequestId())
        await Promise.resolve()
        capturedIds.push(getRequestId())
        await new Promise((r) => setTimeout(r, 5))
        capturedIds.push(getRequestId())
      })

      expect(capturedIds.every((id) => id === capturedIds[0])).toBe(true)
    })
  })

  describe('hasWorkflowContext', () => {
    it('should return false outside context', () => {
      expect(hasWorkflowContext()).toBe(false)
    })

    it('should return true inside context', async () => {
      await runWithWorkflowContext($, async () => {
        expect(hasWorkflowContext()).toBe(true)
        await Promise.resolve()
        expect(hasWorkflowContext()).toBe(true)
      })
    })
  })

  describe('wrapHandler', () => {
    it('should propagate context in wrapped handlers', async () => {
      const capturedContexts: (WorkflowContext | undefined)[] = []

      const handler = wrapHandler($, async (event: { id: string }) => {
        capturedContexts.push(getCurrentWorkflowContext())
        await Promise.resolve()
        capturedContexts.push(getCurrentWorkflowContext())
        await new Promise((r) => setTimeout(r, 5))
        capturedContexts.push(getCurrentWorkflowContext())
        return event.id
      })

      const result = await handler({ id: 'test-event' })

      expect(result).toBe('test-event')
      expect(capturedContexts.every((ctx) => ctx === $)).toBe(true)
    })

    it('should work with sync handlers', async () => {
      let capturedContext: WorkflowContext | undefined

      const handler = wrapHandler($, (event: { value: number }) => {
        capturedContext = getCurrentWorkflowContext()
        return event.value * 2
      })

      const result = await handler({ value: 21 })

      expect(result).toBe(42)
      expect(capturedContext).toBe($)
    })
  })

  describe('WorkflowContext methods', () => {
    it('$.run() should propagate context', () => {
      let capturedContext: WorkflowContext | undefined

      $.run(() => {
        capturedContext = getCurrentWorkflowContext()
      })

      // Note: $.run() uses baseContext which may not equal $ (the proxy)
      // but we should at least have a context
      expect(capturedContext).toBeDefined()
    })

    it('$.getRequestId() should work inside context', async () => {
      await runWithWorkflowContext($, async () => {
        const id = $.getRequestId()
        expect(id).toBeDefined()
        expect(typeof id).toBe('string')
      })
    })

    it('$.hasContext() should return correct value', async () => {
      // Outside context
      expect($.hasContext()).toBe(false)

      await runWithWorkflowContext($, async () => {
        expect($.hasContext()).toBe(true)
        await Promise.resolve()
        expect($.hasContext()).toBe(true)
      })

      expect($.hasContext()).toBe(false)
    })

    it('$.getMetadata() and $.setMetadata() should work', async () => {
      await runWithWorkflowContext($, async () => {
        $.setMetadata('key1', 'value1')
        $.setMetadata('key2', { nested: true })

        await Promise.resolve()

        expect($.getMetadata('key1')).toBe('value1')
        expect($.getMetadata<{ nested: boolean }>('key2')).toEqual({ nested: true })
      })
    })
  })

  describe('Real-world scenarios', () => {
    it('should handle event handler with async database calls', async () => {
      const dbCallContexts: (WorkflowContext | undefined)[] = []

      // Simulate database calls
      async function simulateDbCall(query: string): Promise<{ rows: string[] }> {
        dbCallContexts.push(getCurrentWorkflowContext())
        await new Promise((r) => setTimeout(r, 5))
        return { rows: [query] }
      }

      await runWithWorkflowContext($, async () => {
        // Simulate event handler that makes multiple DB calls
        const result1 = await simulateDbCall('SELECT 1')
        const result2 = await simulateDbCall('SELECT 2')

        expect(result1.rows).toEqual(['SELECT 1'])
        expect(result2.rows).toEqual(['SELECT 2'])
      })

      // All DB calls should have seen the context
      expect(dbCallContexts.every((ctx) => ctx === $)).toBe(true)
    })

    it('should handle streaming response with context', async () => {
      const tokenContexts: (WorkflowContext | undefined)[] = []

      async function* streamTokens(): AsyncGenerator<{ token: string }> {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 2))
          tokenContexts.push(getCurrentWorkflowContext())
          yield { token: `token-${i}` }
        }
      }

      const tokens: string[] = []

      await runWithWorkflowContext($, async () => {
        for await (const { token } of streamTokens()) {
          tokens.push(token)
        }
      })

      expect(tokens).toEqual(['token-0', 'token-1', 'token-2', 'token-3', 'token-4'])
      expect(tokenContexts.every((ctx) => ctx === $)).toBe(true)
    })

    it('should handle concurrent event processing without leakage', async () => {
      const $event1 = createContext(createMockState(), {})
      const $event2 = createContext(createMockState(), {})
      const $event3 = createContext(createMockState(), {})

      const results: { event: number; contexts: (WorkflowContext | undefined)[] }[] = []

      const processEvent = async (ctx: WorkflowContext, eventNum: number, delay: number) => {
        const contexts: (WorkflowContext | undefined)[] = []

        await runWithWorkflowContext(ctx, async () => {
          contexts.push(getCurrentWorkflowContext())
          await new Promise((r) => setTimeout(r, delay))
          contexts.push(getCurrentWorkflowContext())
          await Promise.resolve()
          contexts.push(getCurrentWorkflowContext())
        })

        results.push({ event: eventNum, contexts })
      }

      // Process events concurrently with different timings
      await Promise.all([
        processEvent($event1, 1, 30),
        processEvent($event2, 2, 10),
        processEvent($event3, 3, 20),
      ])

      // Each event should only see its own context
      for (const result of results) {
        const expectedCtx = result.event === 1 ? $event1 : result.event === 2 ? $event2 : $event3
        expect(result.contexts.every((ctx) => ctx === expectedCtx)).toBe(true)
      }
    })
  })
})
