/**
 * WorkflowContext ($) - Core context for workflow operations
 *
 * Provides the $ context with a fluent API for:
 * - Event handlers: $.on.Customer.signup(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 * - Durability levels: $.send(), $.try(), $.do()
 *
 * @module do/workflow/context
 */

import { createEventsStore, type EventsStore, type Event } from '../../db'
import { createEveryProxy, type ScheduleRegistration } from './schedule'
import { createOnProxy, matchHandlers, invokeHandlers, type OnProxy, type EventHandler, type RetryOptions } from './events'
import { createDORPCProxy, type DOStubProxy } from './rpc'
import { RPCError, TimeoutError, InternalError, ValidationError } from '../../rpc/errors'
import {
  type FireAndForgetErrorStore,
  createInMemoryErrorStore,
  extractErrorInfo,
} from '../fire-and-forget-errors'
import { IntegrationRegistry, type Integration, type IntegrationConfig } from '../../integrations'
import { createLogger } from '../../utils/logger'
import {
  runWithWorkflowContextSync,
  getContextMetadata,
  setContextMetadata,
  getRequestId,
  hasWorkflowContext,
  initializeAsyncContext,
} from './async-context'

const logger = createLogger('[WorkflowContext]')

/**
 * WorkflowContext interface defining the $ API
 */
export interface WorkflowContext {
  // Durability levels
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void
  /** Single attempt (no retries) */
  try<T>(action: () => Promise<T>): Promise<T>
  /** Durable with retries */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>

  // Event handlers (Proxy-based)
  on: OnProxy

  // Scheduling DSL
  every: EveryProxy

  // Integration registry for third-party services
  integrations: IntegrationRegistry

  // Cross-DO RPC (Proxy-based)
  // Accessed dynamically via $.Customer(id), $.Worker(id), etc.
  [doName: string]: DOStubFactory | unknown

  // Context propagation methods (do-nexi)
  /** Run with context propagation across async boundaries */
  run<T>(fn: () => T): T
  /** Get the current request ID */
  getRequestId(): string | undefined
  /** Get request-scoped metadata */
  getMetadata<T = unknown>(key: string): T | undefined
  /** Set request-scoped metadata */
  setMetadata(key: string, value: unknown): void
  /** Check if running within a propagated context */
  hasContext(): boolean

  // Internal state (prefixed with _ to indicate private)
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
  _fireAndForgetErrors: FireAndForgetErrorStore
}

/**
 * Short alias for WorkflowContext
 */
export type $ = WorkflowContext

/**
 * Options for $.do() durable action execution
 */
export interface DoOptions {
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Backoff strategy: 'linear' or 'exponential' (default: 'exponential') */
  backoff?: 'linear' | 'exponential'
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Function type for creating DO stubs from an ID.
 */
export type DOStubFactory = (id: string | DurableObjectId) => DOStubProxy

/**
 * EveryProxy type for the scheduling DSL
 */
type EveryProxy = {
  [key: string]: EveryProxy
} & {
  (handler: () => Promise<void>): void
}

/**
 * Options for creating a WorkflowContext
 */
export interface CreateContextOptions {
  /** Custom error store for fire-and-forget errors */
  errorStore?: FireAndForgetErrorStore
  /** Custom integration registry instance (shared across contexts if desired) */
  integrationRegistry?: IntegrationRegistry
  /** Initial integration configurations to auto-initialize */
  integrationConfigs?: Record<string, IntegrationConfig>
}

/**
 * Create a WorkflowContext ($) instance
 *
 * This is the main factory function for creating the $ context that provides
 * the fluent API for event handlers, scheduling, cross-DO RPC, and durability levels.
 *
 * @param state - The DurableObjectState
 * @param env - The environment containing DO namespace bindings
 * @param options - Optional configuration
 * @returns WorkflowContext instance
 *
 * @example
 * ```ts
 * const $ = createContext(state, env)
 *
 * // Event handlers
 * $.on.Customer.signup(async (event) => {
 *   await $.send({ type: 'welcome-email', payload: { to: event.email } })
 * })
 *
 * // Scheduling
 * $.every.Monday.at('9am')(async () => {
 *   await generateWeeklyReport()
 * })
 *
 * // Cross-DO RPC
 * await $.Customer(customerId).notify({ message: 'Hello' })
 *
 * // Durability levels
 * $.send(event)              // Fire-and-forget
 * await $.try(action)        // Single attempt
 * await $.do(action)         // Durable with retries
 * ```
 */
export function createContext(
  _state: DurableObjectState,
  env: unknown,
  options?: CreateContextOptions
): WorkflowContext {
  const events = createEventsStore()
  const handlers = new Map<string, EventHandler[]>()
  const schedules = new Map<string, ScheduleRegistration>()
  const stubCache = new Map<string, DOStubProxy>()
  const fireAndForgetErrors = options?.errorStore ?? createInMemoryErrorStore()
  const integrations = options?.integrationRegistry ?? new IntegrationRegistry()

  // Initialize async context system (do-nexi)
  initializeAsyncContext().catch((err) => {
    logger.error('Failed to initialize async context:', err)
  })

  // Initialize integrations if configs provided
  if (options?.integrationConfigs) {
    integrations.initAll(options.integrationConfigs).catch((err) => {
      logger.error('Failed to initialize integrations:', err)
    })
  }

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

    // Handle failed handlers - add to DLQ, track validation failures, and track in error store
    for (let i = 0; i < result.failed.length; i++) {
      const failure = result.failed[i]
      const errorInfo = extractErrorInfo(failure.error)

      // Track in fire-and-forget error store
      const errorContext = typeof payload === 'object' && payload !== null
        ? payload as Record<string, unknown>
        : undefined
      fireAndForgetErrors.track({
        operation: 'event.handler',
        eventType: eventType,
        handlerIndex: i,
        message: errorInfo.message,
        ...(errorInfo.stack !== undefined && { stack: errorInfo.stack }),
        errorType: errorInfo.errorType,
        retriable: errorInfo.retriable,
        ...(errorContext !== undefined && { context: errorContext }),
        attempts: failure.attempts,
      })

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
            logger.error('Error in recovery handler:', err)
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
      logger.error(`Error processing replayed event "${event.type}":`, err)
    })
  })

  // Create the base context object
  const baseContext = {
    // Fire-and-forget event emission with retry support
    send(event: { type: string; payload?: unknown }) {
      events.emit({
        type: event.type,
        payload: event.payload,
        source: 'workflow'
      }).then(async (emitted) => {
        // Process handlers with retry logic
        await processEvent(emitted, event.type, event.payload)
      }).catch((err: unknown) => {
        // Catch any errors from emit() or processEvent()
        logger.error(`Error processing event "${event.type}":`, err)
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
          logger.warn(`Attempt ${attempt + 1}/${retries + 1} failed:`, lastError.message)

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

    // Event handlers - Proxy-based
    on: createOnProxy(handlers),

    // Scheduling DSL
    every: createEveryProxy(schedules),

    // Integration registry for third-party services
    integrations,

    // Context propagation methods (do-nexi)
    run<T>(fn: () => T): T {
      return runWithWorkflowContextSync(baseContext as unknown as WorkflowContext, fn)
    },
    getRequestId(): string | undefined {
      return getRequestId()
    },
    getMetadata<T = unknown>(key: string): T | undefined {
      return getContextMetadata<T>(key)
    },
    setMetadata(key: string, value: unknown): void {
      setContextMetadata(key, value)
    },
    hasContext(): boolean {
      return hasWorkflowContext()
    },

    // Internal state
    _events: events,
    _handlers: handlers,
    _schedules: schedules,
    _stubCache: stubCache,
    _env: env,
    _fireAndForgetErrors: fireAndForgetErrors
  }

  // Wrap context in Proxy to support cross-DO RPC: $.Customer(id)
  // Uses _env and _stubCache from baseContext directly - no duplicate reference needed (do-1e3z)
  return createDORPCProxy(baseContext) as WorkflowContext
}

// Re-export types for convenience
export type { EventHandler, OnProxy, RetryOptions } from './events'
export type { ScheduleHandler, ScheduleInterval, ScheduleRegistration } from './schedule'
export type { DOStubProxy } from './rpc'
