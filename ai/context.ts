/**
 * Request-Scoped AI Context
 *
 * Provides isolated AI state per request/context to prevent leakage
 * between different requests, tenants, or users.
 *
 * The global singleton pattern in the AI module can cause:
 * 1. Usage tracking leaking between requests
 * 2. Provider configuration leaking between tenants
 * 3. Budget thresholds firing for wrong requests
 *
 * This module provides a factory function to create request-scoped contexts
 * that contain their own isolated state.
 *
 * @example
 * ```ts
 * // In request handler
 * const ctx = createRequestContext()
 *
 * // Configure providers for this request
 * ctx.configureProvider({
 *   provider: 'openai',
 *   apiKey: request.headers.get('X-OpenAI-Key'),
 * })
 *
 * // Track usage for this request
 * ctx.tracker.record({ ... })
 *
 * // Cleanup at end of request
 * ctx.cleanup()
 * ```
 *
 * @see do-hdgk - Fix for global mutable tracker state leakage
 */

import { UsageTracker } from './tracking'
import type { Provider, ProviderConfig } from './types'

// Re-export for backward compatibility
export type { ProviderConfig } from './types'

/**
 * Request-scoped AI context that contains isolated state
 */
export interface RequestContext {
  /**
   * Isolated usage tracker for this request
   */
  tracker: UsageTracker

  /**
   * Configure a provider for this request context
   */
  configureProvider(config: ProviderConfig): void

  /**
   * Get provider configuration for this context
   */
  getProvider(provider?: Provider): ProviderConfig | undefined

  /**
   * Clear provider configuration for this context
   */
  clearProviders(): void

  /**
   * Get the default provider for this context
   */
  getDefaultProvider(): Provider | null

  /**
   * Cleanup all resources in this context
   */
  cleanup(): void
}

/**
 * Create a new request-scoped AI context with isolated state.
 *
 * Each context has its own:
 * - UsageTracker instance
 * - Provider configuration map
 * - Default provider setting
 *
 * This prevents state from leaking between different requests,
 * which is critical in multi-tenant environments.
 *
 * @returns A new isolated RequestContext
 *
 * @example
 * ```ts
 * // Per-request usage
 * export async function handleRequest(request: Request) {
 *   const ctx = createRequestContext()
 *
 *   try {
 *     // Use ctx.tracker for this request's usage
 *     // Use ctx.configureProvider for this request's providers
 *     return await processWithAI(ctx, request)
 *   } finally {
 *     ctx.cleanup()
 *   }
 * }
 * ```
 */
export function createRequestContext(): RequestContext {
  // Private state for this context
  const tracker = new UsageTracker()
  const providers = new Map<Provider, ProviderConfig>()
  let defaultProvider: Provider | null = null

  return {
    tracker,

    configureProvider(config: ProviderConfig): void {
      providers.set(config.provider, config)

      // Set as default if it's the first provider
      if (defaultProvider === null) {
        defaultProvider = config.provider
      }
    },

    getProvider(provider?: Provider): ProviderConfig | undefined {
      if (provider) {
        return providers.get(provider)
      }

      if (defaultProvider) {
        return providers.get(defaultProvider)
      }

      return undefined
    },

    clearProviders(): void {
      providers.clear()
      defaultProvider = null
    },

    getDefaultProvider(): Provider | null {
      return defaultProvider
    },

    cleanup(): void {
      // Reset the tracker
      tracker.reset()

      // Clear provider configurations
      providers.clear()
      defaultProvider = null
    },
  }
}

/**
 * AsyncLocalStorage-based context for automatic request scoping.
 *
 * This provides a way to automatically scope AI operations to the current
 * request without explicitly passing context around.
 *
 * @example
 * ```ts
 * // In middleware
 * import { runWithContext, getCurrentContext } from '@dotdo/ai/context'
 *
 * app.use(async (c, next) => {
 *   await runWithContext(async () => {
 *     await next()
 *   })
 * })
 *
 * // In handler
 * const ctx = getCurrentContext()
 * ctx?.tracker.record({ ... })
 * ```
 */

/**
 * Minimal AsyncLocalStorage interface for type safety.
 * Compatible with Node.js AsyncLocalStorage and Cloudflare Workers.
 */
interface AsyncLocalStorageInterface<T> {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

/**
 * AsyncLocalStorage instance - lazily initialized.
 * Works in Node.js, Cloudflare Workers, and other compatible runtimes.
 */
let asyncLocalStorage: AsyncLocalStorageInterface<RequestContext> | null = null

// Lazy initialization to avoid issues in environments without AsyncLocalStorage
async function getAsyncLocalStorage(): Promise<AsyncLocalStorageInterface<RequestContext>> {
  if (!asyncLocalStorage) {
    try {
      // Try dynamic import for Node.js/Workers environments
      // Use dynamic import with type assertion to avoid TypeScript Node.js dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const moduleName = 'node:async_hooks'
      const asyncHooks = await (import(moduleName) as Promise<{
        AsyncLocalStorage: new <T>() => AsyncLocalStorageInterface<T>
      }>)
      asyncLocalStorage = new asyncHooks.AsyncLocalStorage<RequestContext>()
    } catch {
      // Fallback: Simple implementation using a stack for non-ALS environments
      // This works for synchronous contexts but may not preserve context across async boundaries
      const contextStack: RequestContext[] = []
      asyncLocalStorage = {
        run<R>(store: RequestContext, callback: () => R): R {
          contextStack.push(store)
          try {
            return callback()
          } finally {
            contextStack.pop()
          }
        },
        getStore(): RequestContext | undefined {
          return contextStack[contextStack.length - 1]
        },
      }
    }
  }
  // Non-null assertion is safe here because we always assign in try or catch block
  return asyncLocalStorage!
}

/**
 * Run a function with a new request-scoped context.
 * The context is automatically available via getCurrentContext().
 *
 * @param fn - The async function to run with the context
 * @returns The result of the function
 */
export async function runWithContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = createRequestContext()
  const als = await getAsyncLocalStorage()

  try {
    return await als.run(ctx, fn)
  } finally {
    ctx.cleanup()
  }
}

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if not running within runWithContext().
 *
 * Note: This is synchronous, so it only works after runWithContext
 * has been called at least once (which initializes the ALS).
 *
 * @returns The current RequestContext or undefined
 */
export function getCurrentContext(): RequestContext | undefined {
  // If ALS hasn't been initialized yet, return undefined
  if (!asyncLocalStorage) {
    return undefined
  }
  return asyncLocalStorage.getStore()
}

/**
 * Get or create a context for the current request.
 * If running within runWithContext(), returns that context.
 * Otherwise, creates a new temporary context.
 *
 * Note: The temporary context is NOT cleaned up automatically,
 * so prefer using runWithContext() when possible.
 *
 * @returns A RequestContext (existing or new)
 */
export function getOrCreateContext(): RequestContext {
  const existing = getCurrentContext()
  if (existing) {
    return existing
  }
  return createRequestContext()
}
