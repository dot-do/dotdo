/**
 * Best-Effort Error Logger
 *
 * Provides a structured way to log errors from "best-effort" operations
 * that should not throw but need visibility into failures.
 *
 * This module addresses the pattern of silent catch blocks:
 *
 * BEFORE (silent):
 * ```typescript
 * try {
 *   await db.insert(...)
 * } catch {
 *   // Best-effort database insert
 * }
 * ```
 *
 * AFTER (logged):
 * ```typescript
 * try {
 *   await db.insert(...)
 * } catch (error) {
 *   logBestEffortError(error, {
 *     operation: 'insert',
 *     source: 'ThingStore.create',
 *     context: { thingId },
 *   })
 * }
 * ```
 *
 * Issue: dotdo-eagnv
 */

import { createLogger, LogLevel, type LogContext } from './index'

// ============================================================================
// Types
// ============================================================================

/**
 * Context for best-effort error logging
 */
export interface ErrorContext {
  /** Name of the operation that failed (e.g., 'insert', 'stream', 'healthCheck') */
  operation: string
  /** Source location (e.g., 'ThingStore.create', 'ShardModule.unshard:parseState') */
  source: string
  /** Optional correlation ID for request tracing */
  correlationId?: string
  /** Additional context specific to the operation */
  context?: LogContext
}

// ============================================================================
// Logger Instance
// ============================================================================

const bestEffortLogger = createLogger({
  name: 'best-effort',
  level: LogLevel.DEBUG, // Always log best-effort errors
})

// ============================================================================
// Error Serialization
// ============================================================================

/**
 * Serialize an error value to a loggable object
 */
function serializeErrorValue(error: unknown): { name: string; message: string; stack?: string } {
  if (error === null || error === undefined) {
    return {
      name: 'Unknown',
      message: 'Unknown error (null or undefined)',
    }
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  if (typeof error === 'string') {
    return {
      name: 'StringError',
      message: error,
    }
  }

  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>
    return {
      name: String(obj.name ?? 'Object'),
      message: String(obj.message ?? JSON.stringify(error)),
    }
  }

  return {
    name: 'Unknown',
    message: String(error),
  }
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Log a best-effort error with structured context.
 *
 * This function NEVER throws, making it safe to use in catch blocks
 * where you want to log but not propagate errors.
 *
 * @param error - The error that occurred (can be any type)
 * @param ctx - Context about the operation that failed
 *
 * @example
 * ```typescript
 * try {
 *   await this.db.insert(schema.things).values(thingData)
 * } catch (error) {
 *   logBestEffortError(error, {
 *     operation: 'insert',
 *     source: 'ThingStore.create',
 *     context: { thingId, verb: 'Thing.created' },
 *   })
 * }
 * ```
 */
export function logBestEffortError(error: unknown, ctx: ErrorContext): void {
  try {
    const serializedError = serializeErrorValue(error)

    const logContext: LogContext = {
      bestEffort: true,
      operation: ctx.operation,
      source: ctx.source,
      error: serializedError,
    }

    if (ctx.correlationId) {
      logContext.correlationId = ctx.correlationId
    }

    if (ctx.context) {
      logContext.context = ctx.context
    }

    // Log at warn level - these are errors but not critical failures
    bestEffortLogger.warn(
      `Best-effort operation failed: ${ctx.operation}`,
      logContext
    )
  } catch {
    // Ultimate fallback - never throw from error logger
    try {
      console.error('[logBestEffortError] Failed to log error:', {
        operation: ctx.operation,
        source: ctx.source,
        originalError: String(error),
      })
    } catch {
      // Completely silent fallback - nothing more we can do
    }
  }
}

/**
 * Create a scoped error logger for a specific component.
 *
 * @param source - Base source identifier (e.g., 'ThingStore', 'ShardModule')
 * @returns A function that logs errors with the given source prefix
 *
 * @example
 * ```typescript
 * const logError = createScopedErrorLogger('ThingStore')
 *
 * try {
 *   await db.insert(...)
 * } catch (error) {
 *   logError(error, 'create:insert', { thingId })
 * }
 * ```
 */
export function createScopedErrorLogger(source: string) {
  return function logError(
    error: unknown,
    operation: string,
    context?: LogContext,
    correlationId?: string
  ): void {
    logBestEffortError(error, {
      operation,
      source: `${source}.${operation}`,
      context,
      correlationId,
    })
  }
}
