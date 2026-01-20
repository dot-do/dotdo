// $ WorkflowContext - same interface everywhere via RPC

import { createEventsStore, type EventsStore, type Event } from '../db'
import { createEveryProxy, type ScheduleRegistration } from './schedule'
import { createOnProxy, matchHandlers, invokeHandlers, type OnProxy, type EventHandler, type RetryOptions } from './on'
import { createDOStub } from '../rpc/client'
import { RPCError, RPCErrorCode, NotFoundError, TimeoutError, InternalError, ValidationError, isRetryableError } from '../rpc/errors'

/**
 * A proxy type representing a DO stub that intercepts method calls
 * and forwards them via RPC. Methods can have any arguments and return
 * Promise<unknown> since the actual return type depends on the remote DO.
 */
export type DOStubProxy = {
  [method: string]: (...args: unknown[]) => Promise<unknown>
}

/**
 * Function type for creating DO stubs from an ID.
 * Used by the index signature for dynamic DO access like $.Customer(id)
 */
export type DOStubFactory = (id: string | DurableObjectId) => DOStubProxy

export interface WorkflowContext {
  // Durability levels
  send(event: { type: string; payload?: unknown }): void  // Fire-and-forget
  try<T>(action: () => Promise<T>): Promise<T>            // Single attempt
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>  // Durable with retries

  // Event handlers (Proxy-based - see do-7rf.6.3)
  on: OnProxy

  // Scheduling DSL (see do-7rf.6.4)
  every: EveryProxy

  // Cross-DO RPC (Proxy-based - see do-7rf.6.6)
  // Accessed dynamically via $.Customer(id), $.Worker(id), etc.
  [doName: string]: DOStubFactory | unknown

  // Internal
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
}

export type $ = WorkflowContext

export interface DoOptions {
  retries?: number
  backoff?: 'linear' | 'exponential'
  timeout?: number
}

// Re-export types from on.ts
export type { EventHandler, OnProxy } from './on'

type EveryProxy = {
  [key: string]: EveryProxy
} & {
  (handler: () => Promise<void>): void
}

export function createContext(
  state: DurableObjectState,
  env: unknown
): WorkflowContext {
  const events = createEventsStore()
  const handlers = new Map<string, EventHandler[]>()
  const schedules = new Map<string, ScheduleRegistration>()
  const stubCache = new Map<string, DOStubProxy>()

  const context: WorkflowContext = {
    // Fire-and-forget event emission with retry support
    send(event) {
      events.emit({
        type: event.type,
        payload: event.payload,
        source: 'workflow'
      }).then(async (emitted) => {
        // Get durability config for this event type (supports per-type configuration)
        const config = events.getDurabilityConfig(event.type)
        const retryOptions: RetryOptions = {
          maxRetries: config.retries ?? 5,
          backoff: config.backoff ?? 'exponential',
          initialDelay: 100
        }

        // Use invokeHandlers which includes retry logic
        const result = await invokeHandlers(event.type, emitted, handlers, retryOptions)

        // Handle failed handlers - add to DLQ and track validation failures
        for (const failure of result.failed) {
          if (failure.error instanceof ValidationError) {
            // Track validation failures separately
            events.addValidationFailure({
              type: event.type,
              payload: event.payload,
              error: `ValidationError: ${failure.error.message}`,
              details: failure.error.details
            })
          } else {
            // Add to dead letter queue for potential replay
            events.addToDeadLetterQueue({
              event: emitted,
              attempts: failure.attempts,
              lastError: failure.error?.message || 'Unknown error'
            })
          }
        }

        // Calculate total attempts (max across all handlers)
        const totalAttempts = Math.max(
          ...result.succeeded.map(h => h.attempts),
          ...result.failed.map(h => h.attempts),
          1
        )

        // Track event retry status using event payload's id or the emitted $id
        const eventId = (event.payload as any)?.id || emitted.$id
        events.setEventRetryStatus(eventId, {
          attempts: totalAttempts,
          succeeded: result.failed.length === 0,
          lastAttempt: Date.now()
        })

        // Record retry metrics
        const totalRetries = result.succeeded.reduce((sum, h) => sum + (h.attempts - 1), 0) +
                            result.failed.reduce((sum, h) => sum + (h.attempts - 1), 0)

        if (result.succeeded.length > 0 || result.failed.length > 0) {
          events.recordRetryAttempt(
            event.type,
            result.failed.length === 0, // Overall success if no failures
            totalRetries
          )
        }

        // Emit recovery event if handlers succeeded after retries
        for (const success of result.succeeded) {
          if (success.attempts > 1) {
            // Handler recovered after retries - emit System.recovered event
            // Use matchHandlers + direct invocation to ensure recovery handlers are called
            // Note: Recovery event has originalEvent and attempts at top level for easy access
            const recoveryEvent = {
              $id: `recovery-${emitted.$id}`,
              type: 'System.recovered',
              originalEvent: { type: event.type },
              attempts: success.attempts,
              $timestamp: Date.now(),
              source: 'system'
            }

            // Invoke handlers directly for recovery event (no retries for recovery events)
            const recoveryHandlers = matchHandlers('System.recovered', handlers)
            for (const handler of recoveryHandlers) {
              try {
                await handler(recoveryEvent)
              } catch (err) {
                console.error('[send] Error in recovery handler:', err)
              }
            }
          }
        }
      }).catch((err: unknown) => {
        // Catch any errors from emit() itself
        console.error(`[send] Error emitting event "${event.type}":`, err)
      })
    },

    // Single attempt - no retries
    async try<T>(action: () => Promise<T>): Promise<T> {
      return action()
    },

    // Durable with retries
    async do<T>(action: () => Promise<T>, options: DoOptions = {}): Promise<T> {
      const { retries = 3, backoff = 'exponential', timeout = 30000 } = options

      let lastError: RPCError | undefined

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Wrap with timeout
          const result = await Promise.race([
            action(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(TimeoutError.afterMs(timeout)), timeout)
            )
          ])
          return result
        } catch (error) {
          // Preserve RPCErrors, wrap others
          if (error instanceof RPCError) {
            lastError = error
          } else {
            lastError = InternalError.wrap(error)
          }

          // Log retry attempt (no silent catches)
          console.warn(`[$.do] Attempt ${attempt + 1}/${retries + 1} failed:`, lastError.message)

          if (attempt < retries) {
            // Wait before retry
            const delay = backoff === 'exponential'
              ? Math.pow(2, attempt) * 100
              : (attempt + 1) * 100
            await new Promise(r => setTimeout(r, delay))
          }
        }
      }

      throw lastError
    },

    // Event handlers - Proxy-based (from do/on.ts)
    on: createOnProxy(handlers),

    // Scheduling DSL - full implementation (do-7rf.6.4)
    every: createEveryProxy(schedules),

    _events: events,
    _handlers: handlers,
    _schedules: schedules,
    _stubCache: stubCache,
    _env: env
  }

  // Wrap context in Proxy to support cross-DO RPC: $.Customer(id)
  return new Proxy(context, {
    get(target, prop: string | symbol) {
      // Bypass symbols and internal properties
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop)
      }

      // Return existing properties (send, try, do, on, every, etc.)
      if (prop in target) {
        return Reflect.get(target, prop)
      }

      // For unknown properties, assume it's a DO binding name
      // Return a function that creates a cached DO stub
      return (id: string | DurableObjectId) => {
        const cacheKey = `${prop}:${typeof id === 'string' ? id : id.toString()}`

        // Return cached stub if exists
        if (stubCache.has(cacheKey)) {
          return stubCache.get(cacheKey)
        }

        // Get DO namespace binding from env
        const envObj = env as Record<string, unknown>
        const binding = envObj?.[prop] as DurableObjectNamespace | undefined

        if (!binding) {
          throw new NotFoundError(
            `Durable Object binding "${prop}" not found in environment`,
            { binding: prop }
          )
        }

        // Create and cache the stub
        const stub = createDOStub<DOStubProxy>(binding, id)
        stubCache.set(cacheKey, stub)

        return stub
      }
    }
  })
}
