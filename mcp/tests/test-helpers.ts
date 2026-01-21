/**
 * Test Helpers for MCP Sandbox Tests
 *
 * Following the NO MOCKS philosophy from CLAUDE.md, these helpers create
 * real implementations rather than vi.fn() mocks.
 *
 * @module mcp/tests/test-helpers
 */

import { createContext, type WorkflowContext } from '../../do/context'

/**
 * Create a Map-backed DurableObjectState for testing.
 *
 * This creates a minimal but functional DurableObjectState that can be used
 * with createContext() to get real WorkflowContext instances.
 *
 * @param idSuffix - Optional suffix for the ID (defaults to a random string)
 * @returns A DurableObjectState backed by an in-memory Map
 */
export function createMapBackedState(idSuffix?: string): DurableObjectState {
  const storage = new Map<string, unknown>()
  const id = idSuffix ?? Math.random().toString(36).substring(7)

  return {
    id: { toString: () => `test-${id}` } as DurableObjectId,
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => {
        storage.delete(key)
        return true
      },
      list: async () => storage,
      deleteAll: async () => {
        storage.clear()
      },
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

/**
 * Create a real WorkflowContext for testing.
 *
 * This creates an actual WorkflowContext using createContext() with a
 * Map-backed DurableObjectState. This follows the NO MOCKS philosophy.
 *
 * @param testName - Optional name to identify the test context
 * @returns A real WorkflowContext instance
 *
 * @example
 * ```typescript
 * import { createTestContext } from './test-helpers'
 *
 * describe('My Test', () => {
 *   let context: WorkflowContext
 *
 *   beforeEach(() => {
 *     context = createTestContext('my-test')
 *   })
 *
 *   it('should work with real context', async () => {
 *     // context.send(), context.try(), context.do(), context.on, context.every
 *     // all work as real implementations
 *   })
 * })
 * ```
 */
export function createTestContext(testName?: string): WorkflowContext {
  const state = createMapBackedState(testName)
  return createContext(state, {})
}

/**
 * Event capture helper for tracking events sent via $.send()
 *
 * Since we're using real WorkflowContext, we need a way to observe
 * the events being sent. This helper wraps the context to capture events.
 *
 * @param context - The WorkflowContext to wrap
 * @returns Object with the wrapped context and captured events array
 *
 * @example
 * ```typescript
 * const context = createTestContext('test')
 * const { wrappedContext, capturedEvents } = createEventCapture(context)
 *
 * // Use wrappedContext in sandbox
 * const sandbox = createSandbox({ context: wrappedContext })
 * await sandbox.execute('$.send({ type: "Test.event" })')
 *
 * // Check captured events
 * expect(capturedEvents).toContainEqual({ type: 'Test.event' })
 * ```
 */
export function createEventCapture(context: WorkflowContext): {
  wrappedContext: WorkflowContext
  capturedEvents: Array<{ type: string; payload?: unknown }>
} {
  const capturedEvents: Array<{ type: string; payload?: unknown }> = []
  const originalSend = context.send.bind(context)

  // Create a wrapped context that captures events
  const wrappedContext = {
    ...context,
    send(event: { type: string; payload?: unknown }) {
      capturedEvents.push(event)
      return originalSend(event)
    }
  } as WorkflowContext

  return { wrappedContext, capturedEvents }
}

/**
 * Action capture helper for tracking actions executed via $.try() and $.do()
 *
 * @param context - The WorkflowContext to wrap
 * @returns Object with the wrapped context and captured actions
 */
export function createActionCapture(context: WorkflowContext): {
  wrappedContext: WorkflowContext
  capturedTryActions: Array<{ action: () => Promise<unknown> }>
  capturedDoActions: Array<{ action: () => Promise<unknown>; options?: unknown }>
} {
  const capturedTryActions: Array<{ action: () => Promise<unknown> }> = []
  const capturedDoActions: Array<{ action: () => Promise<unknown>; options?: unknown }> = []

  const originalTry = context.try.bind(context)
  const originalDo = context.do.bind(context)

  const wrappedContext = {
    ...context,
    async try<T>(action: () => Promise<T>): Promise<T> {
      capturedTryActions.push({ action: action as () => Promise<unknown> })
      return originalTry(action)
    },
    async do<T>(action: () => Promise<T>, options?: unknown): Promise<T> {
      capturedDoActions.push({ action: action as () => Promise<unknown>, options })
      return originalDo(action, options as Parameters<typeof originalDo>[1])
    }
  } as WorkflowContext

  return { wrappedContext, capturedTryActions, capturedDoActions }
}
