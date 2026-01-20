// $ WorkflowContext - same interface everywhere via RPC

import { createEventsStore, type EventsStore, type Event } from '../db'
import { createEveryProxy, type ScheduleRegistration } from './schedule'
import { createOnProxy, matchHandlers, invokeHandlers, type OnProxy, type EventHandler, type RetryOptions } from './on'
import { createDOStub } from '../rpc/client'
import { RPCError, RPCErrorCode, NotFoundError, TimeoutError, InternalError, ValidationError, isRetryableError } from '../rpc/errors'
import {
  type FireAndForgetErrorStore,
  createInMemoryErrorStore,
  extractErrorInfo
} from './fire-and-forget-errors'

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
  _fireAndForgetErrors: FireAndForgetErrorStore
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
  env: unknown,
  options?: { errorStore?: FireAndForgetErrorStore }
): WorkflowContext {
  const events = createEventsStore()
  const handlers = new Map<string, EventHandler[]>()
  const schedules = new Map<string, ScheduleRegistration>()
  const stubCache = new Map<string, DOStubProxy>()
  const fireAndForgetErrors = options?.errorStore ?? createInMemoryErrorStore()

  // Helper function to process an event (invoke handlers with retry logic)
  async function processEvent(emitted: Event, eventType: string, payload: unknown): Promise<void> {
    // Get durability config for this event type (supports per-type configuration)
    const config = events.getDurabilityConfig(eventType)
    const retryOptions: RetryOptions = {
      maxRetries: config.retries ?? 3, // Max 3 retries by default as per task spec
      backoff: config.backoff ?? 'exponential',
      initialDelay: 100
    }

    // Use invokeHandlers which includes retry logic
    const result = await invokeHandlers(eventType, emitted, handlers, retryOptions)

    // Handle failed handlers - add to DLQ and track validation failures
    for (const failure of result.failed) {
      if (failure.error instanceof ValidationError) {
        events.addValidationFailure({
          type: eventType,
          payload: payload,
          error: `ValidationError: ${failure.error.message}`,
          details: failure.error.details
        })
      } else {
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
    const eventId = (payload as { id?: string })?.id || emitted.$id
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
        eventType,
        result.failed.length === 0,
        totalRetries
      )
    }

    // Emit recovery event if handlers succeeded after retries
    for (const success of result.succeeded) {
      if (success.attempts > 1) {
        const recoveryEvent = {
          $id: `recovery-${emitted.$id}`,
          type: 'System.recovered',
          originalEvent: { type: eventType },
          attempts: success.attempts,
          $timestamp: Date.now(),
          source: 'system'
        }

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
  }

  // Subscribe to events from the store to handle replayed events only
  events.subscribe((event) => {
    // Only process events replayed from the DLQ (source: 'dlq-replay')
    // Events from $.send() have source: 'workflow' and are processed separately
    if (event.source !== 'dlq-replay') {
      return
    }

    // Process replayed events with retry logic
    processEvent(event, event.type, event.payload).catch((err) => {
      console.error(`[subscribe] Error processing replayed event "${event.type}":`, err)
    })
  })

  const context: WorkflowContext = {
    // Fire-and-forget event emission with retry support
    send(event) {
      events.emit({
        type: event.type,
        payload: event.payload,
        source: 'workflow'
      }).then(async (emitted) => {
        // Process handlers with retry logic
        await processEvent(emitted, event.type, event.payload)
      }).catch((err: unknown) => {
        // Catch any errors from emit() or processEvent()
        console.error(`[send] Error processing event "${event.type}":`, err)
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

// =============================================================================
// TYPED CONTEXT FACTORY
// =============================================================================

// Import the typed context types
import type {
  TypedWorkflowContext,
  DOBindingsConstraint,
  EventSchemasConstraint,
  EmptyBindings,
  EmptyEventSchemas,
  CreateTypedContextOptions
} from './types'

/**
 * Creates a typed WorkflowContext with full type inference for DO bindings and events.
 *
 * This is a type-safe wrapper around createContext that provides:
 * - Typed cross-DO RPC calls: $.Customer(id).method() with proper return types
 * - Typed event handlers: $.on.Customer.signup(handler) with typed event payloads
 * - Typed scheduling: $.every.Monday.at('9am')(handler) with proper return types
 *
 * @template B - DO bindings map (maps binding names to DO interface types)
 * @template E - Event schemas map (maps 'Noun.verb' to payload types)
 *
 * @param state - The DurableObjectState
 * @param env - The environment containing DO namespace bindings
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * // Define your DO interfaces
 * interface CustomerDO {
 *   getProfile(): Promise<{ name: string; email: string }>
 *   notify(params: { message: string }): Promise<{ delivered: boolean }>
 * }
 *
 * interface OrderDO {
 *   ship(): Promise<{ status: string }>
 *   getItems(): Promise<string[]>
 * }
 *
 * // Define DO bindings map
 * interface DOBindings {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 *
 * // Define event schemas
 * interface EventSchemas {
 *   'Customer.signup': { customerId: string; email: string; plan: string }
 *   'Order.placed': { orderId: string; items: string[]; total: number }
 * }
 *
 * // Create typed context
 * const $ = createTypedContext<DOBindings, EventSchemas>(state, env)
 *
 * // Now get full type inference!
 * const customer = $.Customer('user-123')
 * const profile = await customer.getProfile()  // Typed as { name: string; email: string }
 *
 * $.on.Customer.signup((event) => {
 *   // event.payload is typed as { customerId: string; email: string; plan: string }
 *   console.log(event.payload.email)
 * })
 *
 * $.every.Monday.at('9am')(async () => {
 *   await generateWeeklyReport()
 * })
 * ```
 */
export function createTypedContext<
  B extends DOBindingsConstraint = EmptyBindings,
  E extends EventSchemasConstraint = EmptyEventSchemas
>(
  state: DurableObjectState,
  env: unknown,
  options?: CreateTypedContextOptions
): TypedWorkflowContext<B, E> {
  // The underlying createContext already creates the proper proxy structure
  // We just cast the result to the typed version for compile-time type checking
  return createContext(state, env, options) as unknown as TypedWorkflowContext<B, E>
}
