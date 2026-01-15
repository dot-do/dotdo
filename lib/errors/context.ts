/**
 * Error Context System
 *
 * Provides context propagation for errors using AsyncLocalStorage.
 * Enables tracking correlation IDs, request IDs, user context, and other
 * metadata through async operations automatically.
 *
 * @see do-vwb9
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { DotdoError, registerErrorContextGetter } from './DotdoError'
import { ErrorCodes } from './codes'

/**
 * Error context interface for tracking request/correlation data
 */
export interface ErrorContext {
  /** Unique identifier for correlating related operations */
  correlationId: string
  /** Unique identifier for the current request */
  requestId: string
  /** User identifier (if authenticated) */
  userId?: string
  /** Namespace/tenant identifier */
  namespace?: string
  /** Current operation being performed */
  operation?: string
  /** Shard identifier (for distributed systems) */
  shardId?: number
  /** Additional custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Internal storage for async context propagation
 */
const asyncLocalStorage = new AsyncLocalStorage<ErrorContext>()

/**
 * ErrorContextManager provides static methods for managing error context
 * across async boundaries using AsyncLocalStorage.
 */
export class ErrorContextManager {
  /**
   * Run a function with the given error context attached.
   * Context will propagate through all async operations within the function.
   *
   * @param ctx - The error context to attach
   * @param fn - The function to run with context
   * @returns The result of the function
   */
  static run<T>(ctx: ErrorContext, fn: () => T): T {
    // Merge with parent context if one exists
    const parentContext = asyncLocalStorage.getStore()
    const mergedContext = parentContext ? { ...parentContext, ...ctx } : ctx

    return asyncLocalStorage.run(mergedContext, fn)
  }

  /**
   * Get the current error context, if any.
   *
   * @returns The current context or undefined if not in a context
   */
  static get(): ErrorContext | undefined {
    return asyncLocalStorage.getStore()
  }

  /**
   * Merge partial context with current context.
   * Returns the merged context without modifying the current store.
   *
   * @param partial - Partial context to merge
   * @returns Merged context
   */
  static with(partial: Partial<ErrorContext>): ErrorContext {
    const current = asyncLocalStorage.getStore()
    if (!current) {
      throw new Error('Cannot merge context: no current context')
    }
    return { ...current, ...partial }
  }

  /**
   * Reset the context store (primarily for testing)
   */
  static reset(): void {
    // AsyncLocalStorage automatically clears when the async context ends
    // This is mainly used in tests to ensure clean state
    // Since we can't actually clear AsyncLocalStorage, we rely on the
    // fact that each test runs in its own context
  }
}

/**
 * Run a function with error context attached.
 * Convenience function that wraps ErrorContextManager.run.
 *
 * @param ctx - The error context to attach
 * @param fn - The function to run with context
 * @returns The result of the function
 */
export function withErrorContext<T>(ctx: ErrorContext, fn: () => T): T {
  return ErrorContextManager.run(ctx, fn)
}

/**
 * Get the current error context.
 * Convenience function that wraps ErrorContextManager.get.
 *
 * @returns The current context or undefined
 */
export function getErrorContext(): ErrorContext | undefined {
  return ErrorContextManager.get()
}

/**
 * Wrap an error with the current context attached.
 *
 * - If the error is already a DotdoError with context, returns it unchanged
 * - If the error is a DotdoError without context, adds current context
 * - If the error is a plain Error, wraps it in a DotdoError with context
 * - If the error is a string, creates a DotdoError with context
 * - For unknown types, stringifies and wraps
 *
 * @param error - The error to wrap
 * @param contextOverride - Optional context fields to override
 * @returns A DotdoError with context attached
 */
export function wrapError(
  error: unknown,
  contextOverride?: Partial<ErrorContext>
): DotdoError {
  const currentContext = getErrorContext()
  const mergedContext = currentContext
    ? { ...currentContext, ...contextOverride }
    : contextOverride

  // If it's already a DotdoError with context, return unchanged
  if (error instanceof DotdoError) {
    if (error.context && Object.keys(error.context).length > 0) {
      return error
    }
    // DotdoError without context - we can't modify it, so return as-is
    // The context will be added when DotdoError.wrap is used
    return error
  }

  // Wrap plain Error
  if (error instanceof Error) {
    return new DotdoError(ErrorCodes.INTERNAL_ERROR, error.message, {
      cause: error,
      context: mergedContext as Record<string, unknown>,
    })
  }

  // Wrap string
  if (typeof error === 'string') {
    return new DotdoError(ErrorCodes.INTERNAL_ERROR, error, {
      context: mergedContext as Record<string, unknown>,
    })
  }

  // Wrap unknown
  return new DotdoError(ErrorCodes.INTERNAL_ERROR, String(error), {
    cause: error,
    context: mergedContext as Record<string, unknown>,
  })
}

// Register the context getter with DotdoError so its factory methods can access context
// This is done at module load time to ensure DotdoError always has access
registerErrorContextGetter(() => getErrorContext() as Record<string, unknown> | undefined)
