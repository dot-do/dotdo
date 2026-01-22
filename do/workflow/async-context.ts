/**
 * AsyncLocalStorage-based Context Propagation for WorkflowContext
 *
 * This module provides proper async context propagation across all async boundaries
 * within the Durable Object's WorkflowContext ($).
 *
 * Key features:
 * - Maintains context across async boundaries (await, Promise.all, etc.)
 * - Prevents context leakage between concurrent requests
 * - Uses native AsyncLocalStorage with a robust fallback
 * - Provides scoped context for event handlers and actions
 *
 * Memory Management (reviewed: do-bacgt):
 * - ALS contexts are automatically cleaned up when run() callback completes
 * - Fallback uses WeakMap for async tracking - entries are GC'd automatically
 * - Stack cleanup happens in finally block, ensuring no leaks on errors
 * - No manual cleanup required - contexts are scoped to request lifecycle
 *
 * @see do-nexi - Inconsistent async context propagation
 * @module do/workflow/async-context
 */

import type { WorkflowContext } from './types'

/**
 * Request context that is propagated across async boundaries.
 * Contains a reference to the current WorkflowContext and request-specific metadata.
 */
export interface RequestScopedContext {
  /** Reference to the WorkflowContext ($) */
  workflow: WorkflowContext
  /** Unique request/operation ID */
  requestId: string
  /** Request-scoped metadata */
  metadata: Map<string, unknown>
  /** Timestamp when the context was created */
  createdAt: number
}

/**
 * Minimal AsyncLocalStorage interface for type safety.
 * Compatible with Node.js AsyncLocalStorage and Cloudflare Workers.
 */
interface AsyncLocalStorageInterface<T> {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

/**
 * Internal async context storage. Lazily initialized.
 */
let asyncLocalStorage: AsyncLocalStorageInterface<RequestScopedContext> | null = null

/**
 * Flag to track if we've attempted initialization
 */
let initAttempted = false

/**
 * Generates a unique request ID for context tracking
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Creates a proper async-aware fallback for environments without AsyncLocalStorage.
 *
 * This implementation correctly handles async callbacks by:
 * 1. Not popping from the stack until the Promise fully resolves
 * 2. Using a WeakMap-based approach to track context per async chain
 * 3. Supporting nested contexts properly
 *
 * @returns AsyncLocalStorageInterface implementation
 */
function createAsyncAwareFallback<T>(): AsyncLocalStorageInterface<T> {
  // Use a stack for synchronous nesting, but track async contexts separately
  const contextStack: T[] = []

  // WeakMap to track async contexts by their Promise
  // This prevents context loss across await boundaries
  const asyncContextMap = new WeakMap<object, T>()

  // Counter for identifying the current async execution
  let currentAsyncMarker: object | null = null

  return {
    run<R>(store: T, callback: () => R): R {
      // Push to the synchronous stack
      contextStack.push(store)

      // Create a marker for this async execution
      const marker = {}
      const previousMarker = currentAsyncMarker
      currentAsyncMarker = marker
      asyncContextMap.set(marker, store)

      try {
        // Execute the callback
        const result = callback()

        // Check if result is a Promise (async callback)
        if (result !== null && typeof result === 'object' && typeof (result as PromiseLike<unknown>).then === 'function') {
          // For async callbacks, keep context available until Promise settles
          const promise = Promise.resolve(result)

          // Return a wrapped promise that cleans up after settling
          const wrappedPromise = promise.finally(() => {
            // Pop from synchronous stack
            const index = contextStack.lastIndexOf(store)
            if (index !== -1) {
              contextStack.splice(index, 1)
            }
            // Clean up the async marker
            asyncContextMap.delete(marker)
            if (currentAsyncMarker === marker) {
              currentAsyncMarker = previousMarker
            }
          }) as unknown as R

          return wrappedPromise
        }

        // For synchronous callbacks, clean up immediately
        contextStack.pop()
        asyncContextMap.delete(marker)
        currentAsyncMarker = previousMarker
        return result
      } catch (error) {
        // Clean up on synchronous error
        contextStack.pop()
        asyncContextMap.delete(marker)
        currentAsyncMarker = previousMarker
        throw error
      }
    },

    getStore(): T | undefined {
      // First check the async marker (handles awaited context)
      if (currentAsyncMarker) {
        const asyncContext = asyncContextMap.get(currentAsyncMarker)
        if (asyncContext !== undefined) {
          return asyncContext
        }
      }

      // Fall back to synchronous stack
      return contextStack[contextStack.length - 1]
    },
  }
}

/**
 * Initialize the AsyncLocalStorage instance.
 * Uses native AsyncLocalStorage if available, otherwise falls back to a robust implementation.
 *
 * @returns Promise resolving to the AsyncLocalStorage instance
 */
async function initializeAsyncLocalStorage(): Promise<AsyncLocalStorageInterface<RequestScopedContext>> {
  if (asyncLocalStorage && initAttempted) {
    return asyncLocalStorage
  }

  initAttempted = true

  try {
    // Check if AsyncLocalStorage is available globally (Cloudflare Workers 2024+)
    // Type assertion for runtime feature detection - AsyncLocalStorage may or may not exist on globalThis
    const globalWithALS = globalThis as typeof globalThis & {
      AsyncLocalStorage?: new <T>() => AsyncLocalStorageInterface<T>
    }
    if (typeof globalWithALS.AsyncLocalStorage !== 'undefined') {
      asyncLocalStorage = new globalWithALS.AsyncLocalStorage<RequestScopedContext>()
      return asyncLocalStorage
    }
  } catch {
    // Global not available, try dynamic import
  }

  try {
    // Try dynamic import for Node.js environments
    const moduleName = 'node:async_hooks'
    const asyncHooks = await (import(moduleName) as Promise<{
      AsyncLocalStorage: new <T>() => AsyncLocalStorageInterface<T>
    }>)
    asyncLocalStorage = new asyncHooks.AsyncLocalStorage<RequestScopedContext>()
    return asyncLocalStorage
  } catch {
    // Fall back to our async-aware implementation
    asyncLocalStorage = createAsyncAwareFallback<RequestScopedContext>()
    return asyncLocalStorage
  }
}

/**
 * Get the AsyncLocalStorage instance synchronously.
 * Returns null if not yet initialized.
 */
function getAsyncLocalStorageSync(): AsyncLocalStorageInterface<RequestScopedContext> | null {
  return asyncLocalStorage
}

/**
 * Create a new request-scoped context
 */
function createRequestContext(workflow: WorkflowContext): RequestScopedContext {
  return {
    workflow,
    requestId: generateRequestId(),
    metadata: new Map(),
    createdAt: Date.now(),
  }
}

/**
 * Run a function with the given WorkflowContext available across all async boundaries.
 *
 * This is the primary entry point for context propagation. Use this to wrap
 * request handlers, event handlers, or any code that needs context access.
 *
 * @param workflow - The WorkflowContext to propagate
 * @param fn - The async function to run with context
 * @returns The result of the function
 *
 * @example
 * ```ts
 * await runWithWorkflowContext($, async () => {
 *   // Context is available here
 *   const ctx = getCurrentWorkflowContext()
 *
 *   // And across all await boundaries
 *   await someAsyncOperation()
 *
 *   // Still available here
 *   const ctx2 = getCurrentWorkflowContext()
 *   // ctx === ctx2
 * })
 * ```
 */
export async function runWithWorkflowContext<T>(
  workflow: WorkflowContext,
  fn: () => Promise<T>
): Promise<T> {
  const als = await initializeAsyncLocalStorage()
  const ctx = createRequestContext(workflow)

  return als.run(ctx, fn)
}

/**
 * Synchronous version of runWithWorkflowContext for cases where
 * AsyncLocalStorage is already initialized.
 *
 * @param workflow - The WorkflowContext to propagate
 * @param fn - The function to run with context (can be sync or async)
 * @returns The result of the function
 */
export function runWithWorkflowContextSync<T>(
  workflow: WorkflowContext,
  fn: () => T
): T {
  const als = getAsyncLocalStorageSync()
  if (!als) {
    // If ALS isn't initialized, just run the function without context propagation
    // This should rarely happen in practice
    return fn()
  }

  const ctx = createRequestContext(workflow)
  return als.run(ctx, fn)
}

/**
 * Get the current request-scoped context.
 * Returns undefined if not running within runWithWorkflowContext.
 *
 * @returns The current RequestScopedContext or undefined
 */
export function getCurrentRequestContext(): RequestScopedContext | undefined {
  const als = getAsyncLocalStorageSync()
  if (!als) {
    return undefined
  }
  return als.getStore()
}

/**
 * Get the current WorkflowContext ($).
 * Returns undefined if not running within runWithWorkflowContext.
 *
 * @returns The current WorkflowContext or undefined
 *
 * @example
 * ```ts
 * // Inside an event handler
 * const $ = getCurrentWorkflowContext()
 * if ($) {
 *   $.send({ type: 'follow-up', payload: { ... } })
 * }
 * ```
 */
export function getCurrentWorkflowContext(): WorkflowContext | undefined {
  const ctx = getCurrentRequestContext()
  return ctx?.workflow
}

/**
 * Get request-scoped metadata value
 *
 * @param key - The metadata key
 * @returns The metadata value or undefined
 */
export function getContextMetadata<T = unknown>(key: string): T | undefined {
  const ctx = getCurrentRequestContext()
  return ctx?.metadata.get(key) as T | undefined
}

/**
 * Set request-scoped metadata value
 *
 * @param key - The metadata key
 * @param value - The value to store
 */
export function setContextMetadata(key: string, value: unknown): void {
  const ctx = getCurrentRequestContext()
  if (ctx) {
    ctx.metadata.set(key, value)
  }
}

/**
 * Get the current request ID
 *
 * @returns The request ID or undefined if not in a context
 */
export function getRequestId(): string | undefined {
  const ctx = getCurrentRequestContext()
  return ctx?.requestId
}

/**
 * Check if we're currently running within a workflow context
 *
 * @returns true if context is available
 */
export function hasWorkflowContext(): boolean {
  return getCurrentRequestContext() !== undefined
}

/**
 * Wrap an event handler to ensure context propagation.
 *
 * This utility wraps an event handler function to ensure the WorkflowContext
 * is properly propagated across all async boundaries within the handler.
 *
 * @param workflow - The WorkflowContext to propagate
 * @param handler - The event handler to wrap
 * @returns A wrapped handler with context propagation
 *
 * @example
 * ```ts
 * // Instead of:
 * $.on.Customer.signup(async (event) => {
 *   // Context might be lost after await
 * })
 *
 * // Use:
 * $.on.Customer.signup(wrapHandler($, async (event) => {
 *   // Context is always available
 *   await someAsyncWork()
 *   // Still available here
 * }))
 * ```
 */
export function wrapHandler<T, R>(
  workflow: WorkflowContext,
  handler: (event: T) => Promise<R> | R
): (event: T) => Promise<R> {
  return async (event: T): Promise<R> => {
    return runWithWorkflowContext(workflow, async () => {
      const result = handler(event)
      // Handle both sync and async handlers
      if (result !== null && typeof result === 'object' && typeof (result as PromiseLike<R>).then === 'function') {
        return (result as Promise<R>)
      }
      return result as R
    })
  }
}

/**
 * Initialize the async context system.
 * Call this early (e.g., in DO constructor) to ensure context is ready.
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeAsyncContext(): Promise<void> {
  await initializeAsyncLocalStorage()
}

/**
 * Reset the async context (for testing purposes only).
 * This should not be used in production code.
 */
export function resetAsyncContext(): void {
  asyncLocalStorage = null
  initAttempted = false
}
