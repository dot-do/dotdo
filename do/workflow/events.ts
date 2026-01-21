/**
 * Event handler registration using $.on.Noun.verb() syntax
 *
 * Implements a two-level Proxy pattern for infinite Noun.verb combinations:
 *   $.on.Customer.signup(handler)
 *   $.on.Payment.failed(handler)
 *   $.on.Order.placed(handler)
 *
 * Features:
 * - Infinite Noun.verb combinations via nested Proxy
 * - Wildcard support: $.on.*.created(), $.on.Customer.*(), $.on.*.*()
 * - Multiple handlers per event
 * - Async handler support
 * - Type-safe with common nouns + index signature for custom ones
 * - Retry with exponential backoff for transient failures
 * - Dead letter queue for persistently failing handlers
 *
 * @module do/workflow/events
 */

import { createNestedProxy, createScopedLogger, LogLevel } from '@dotdo/utils'
import { isRetryableError, ValidationError } from '@dotdo/rpc'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[EventHandlers]' })

/**
 * Event handler function type
 * @template T - The type of the event payload (defaults to unknown for backward compatibility)
 */
export type EventHandler<T = unknown> = (event: T) => Promise<void> | void

/**
 * Proxy for event handlers on a specific noun
 * Allows: $.on.Customer.signup(handler)
 */
export interface NounEventProxy {
  // Common verbs (for better IDE autocomplete)
  created: (handler: EventHandler) => void
  updated: (handler: EventHandler) => void
  deleted: (handler: EventHandler) => void
  placed: (handler: EventHandler) => void
  completed: (handler: EventHandler) => void
  failed: (handler: EventHandler) => void
  sent: (handler: EventHandler) => void
  received: (handler: EventHandler) => void
  generated: (handler: EventHandler) => void
  authenticated: (handler: EventHandler) => void
  authorized: (handler: EventHandler) => void
  signup: (handler: EventHandler) => void
  signin: (handler: EventHandler) => void
  signout: (handler: EventHandler) => void
  renewed: (handler: EventHandler) => void
  expired: (handler: EventHandler) => void
  verified: (handler: EventHandler) => void
  rejected: (handler: EventHandler) => void
  approved: (handler: EventHandler) => void
  cancelled: (handler: EventHandler) => void

  // Wildcard support
  '*': (handler: EventHandler) => void

  // Index signature for arbitrary verbs
  [verb: string]: (handler: EventHandler) => void
}

/**
 * Top-level OnProxy for event handler registration
 * Allows: $.on.Customer.created(handler)
 */
export interface OnProxy {
  // Common nouns (for better IDE autocomplete)
  Customer: NounEventProxy
  Order: NounEventProxy
  Payment: NounEventProxy
  User: NounEventProxy
  Email: NounEventProxy
  Invoice: NounEventProxy
  Product: NounEventProxy
  Subscription: NounEventProxy
  Profile: NounEventProxy
  Account: NounEventProxy
  Session: NounEventProxy
  Transaction: NounEventProxy
  Notification: NounEventProxy
  Message: NounEventProxy
  Event: NounEventProxy
  Task: NounEventProxy
  Workflow: NounEventProxy

  // Wildcard support
  '*': NounEventProxy

  // Index signature for arbitrary nouns
  [noun: string]: NounEventProxy
}

/**
 * Create the top-level OnProxy for event handler registration
 *
 * This creates a two-level proxy using the shared createNestedProxy utility:
 * 1. First level captures the noun (Customer, Order, etc.)
 * 2. Second level captures the verb (created, updated, etc.)
 * 3. Function call registers the handler
 *
 * @param handlers - Handler registry map
 * @returns OnProxy for registering event handlers
 *
 * @example
 * ```ts
 * const handlers = new Map()
 * const on = createOnProxy(handlers)
 *
 * on.Customer.signup(async (event) => {
 *   console.log('Customer signed up:', event)
 * })
 *
 * on.Payment.failed(async (event) => {
 *   console.log('Payment failed:', event)
 * })
 *
 * // Wildcards
 * on.*.created(async (event) => {
 *   console.log('Something was created:', event)
 * })
 *
 * on.Customer['*'](async (event) => {
 *   console.log('Customer event:', event)
 * })
 *
 * on['*']['*'](async (event) => {
 *   console.log('Any event:', event)
 * })
 * ```
 */
export function createOnProxy(
  handlers: Map<string, EventHandler[]>
): OnProxy {
  return createNestedProxy<OnProxy>((noun, verb) => {
    // Return a function that registers the handler
    return (handler: EventHandler) => {
      const key = `${noun}.${verb}`
      const existing = handlers.get(key) || []
      handlers.set(key, [...existing, handler])
    }
  })
}

/**
 * Find all handlers that match a given event type
 *
 * Matches handlers in order of specificity:
 * 1. Exact match (Customer.signup)
 * 2. Noun wildcard (Customer.*)
 * 3. Verb wildcard (*.signup)
 * 4. Global wildcard (*.*)
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param handlers - Handler registry map
 * @returns Array of matching handlers
 *
 * @example
 * ```ts
 * const handlers = new Map()
 * const on = createOnProxy(handlers)
 *
 * on.Order.placed(handler1)
 * on.Order['*'](handler2)
 * on['*'].placed(handler3)
 * on['*']['*'](handler4)
 *
 * const matches = matchHandlers('Order.placed', handlers)
 * // Returns: [handler1, handler2, handler3, handler4]
 * ```
 */
export function matchHandlers(
  eventType: string,
  handlers: Map<string, EventHandler[]>
): EventHandler[] {
  const [noun, verb] = eventType.split('.')
  const matched: EventHandler[] = []

  // 1. Exact match
  const exact = handlers.get(eventType)
  if (exact) matched.push(...exact)

  // 2. Noun wildcard (Customer.*)
  if (noun && verb) {
    const nounWild = handlers.get(`${noun}.*`)
    if (nounWild) matched.push(...nounWild)
  }

  // 3. Verb wildcard (*.created)
  if (noun && verb) {
    const verbWild = handlers.get(`*.${verb}`)
    if (verbWild) matched.push(...verbWild)
  }

  // 4. Global wildcard (*.*)
  const globalWild = handlers.get('*.*')
  if (globalWild) matched.push(...globalWild)

  return matched
}

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 5) */
  maxRetries?: number
  /** Backoff strategy: 'exponential' doubles delay each retry, 'linear' uses fixed delay (default: 'exponential') */
  backoff?: 'exponential' | 'linear'
  /** Initial delay in milliseconds (default: 100) */
  initialDelay?: number
}

/**
 * Result of a handler execution
 */
export interface HandlerResult {
  handler: EventHandler
  succeeded: boolean
  attempts: number
  error?: Error
}

/**
 * Result of invokeHandlers
 */
export interface InvokeHandlersResult {
  succeeded: HandlerResult[]
  failed: HandlerResult[]
}

/**
 * Execute a single handler with retry logic
 *
 * @param handler - The handler function to execute
 * @param event - Event data to pass to handler
 * @param options - Retry options
 * @returns HandlerResult with execution outcome
 */
async function executeWithRetry(
  handler: EventHandler,
  event: unknown,
  options: RetryOptions = {}
): Promise<HandlerResult> {
  const { maxRetries = 5, backoff = 'exponential', initialDelay = 100 } = options

  let lastError: Error | undefined
  let attempts = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++
    try {
      await handler(event)
      return { handler, succeeded: true, attempts }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry non-retriable errors (ValidationError, errors with retriable=false)
      if (error instanceof ValidationError) {
        return { handler, succeeded: false, attempts, error: lastError }
      }

      // Check for explicit non-retriable flag
      if (error && typeof error === 'object' && 'retriable' in error && !(error as { retriable: boolean }).retriable) {
        return { handler, succeeded: false, attempts, error: lastError }
      }

      // Only retry if it's a retriable error
      if (!isRetryableError(error)) {
        return { handler, succeeded: false, attempts, error: lastError }
      }

      // Don't delay after the last attempt
      if (attempt < maxRetries) {
        const delay = backoff === 'exponential'
          ? initialDelay * Math.pow(2, attempt)
          : initialDelay
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  // Max retries exceeded - lastError is guaranteed to be set since we always enter the catch
  // Use a fallback error just in case for type safety
  const finalError = lastError ?? new Error('Max retries exceeded without error')
  return { handler, succeeded: false, attempts, error: finalError }
}

/**
 * Invoke all handlers that match an event with retry support
 *
 * Finds matching handlers using matchHandlers() and invokes them.
 * Handles both sync and async handlers gracefully.
 * Retries transient errors with exponential backoff.
 * Non-retriable errors (ValidationError, etc.) are not retried.
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param event - Event data to pass to handlers
 * @param handlers - Handler registry map
 * @param options - Optional retry configuration
 * @returns Promise with result containing succeeded and failed handlers
 *
 * @example
 * ```ts
 * const handlers = new Map()
 * const on = createOnProxy(handlers)
 *
 * on.Order.placed(async (event) => {
 *   console.log('Handler 1:', event)
 * })
 *
 * on.Order.placed(async (event) => {
 *   console.log('Handler 2:', event)
 * })
 *
 * const result = await invokeHandlers('Order.placed', { orderId: '123' }, handlers)
 * console.log(`${result.succeeded.length} succeeded, ${result.failed.length} failed`)
 * ```
 */
export async function invokeHandlers(
  eventType: string,
  event: unknown,
  handlers: Map<string, EventHandler[]>,
  options: RetryOptions = {}
): Promise<InvokeHandlersResult> {
  const matched = matchHandlers(eventType, handlers)

  const results = await Promise.all(
    matched.map(async (handler, index) => {
      const result = await executeWithRetry(handler, event, options)

      if (!result.succeeded) {
        logger.error(
          `Handler ${index + 1}/${matched.length} for "${eventType}" failed after ${result.attempts} attempt(s):`,
          result.error
        )
      }

      return result
    })
  )

  const succeeded = results.filter(r => r.succeeded)
  const failed = results.filter(r => !r.succeeded)

  return { succeeded, failed }
}

/**
 * Get all registered event types
 *
 * @param handlers - Handler registry map
 * @returns Array of event type strings
 */
export function getEventTypes(
  handlers: Map<string, EventHandler[]>
): string[] {
  return Array.from(handlers.keys())
}

/**
 * Get handler count for a specific event type
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param handlers - Handler registry map
 * @returns Number of handlers registered for this event type
 */
export function getHandlerCount(
  eventType: string,
  handlers: Map<string, EventHandler[]>
): number {
  const handlers_ = handlers.get(eventType)
  return handlers_ ? handlers_.length : 0
}

/**
 * Clear all handlers for a specific event type
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param handlers - Handler registry map
 */
export function clearHandlers(
  eventType: string,
  handlers: Map<string, EventHandler[]>
): void {
  handlers.delete(eventType)
}

/**
 * Clear all handlers
 *
 * @param handlers - Handler registry map
 */
export function clearAllHandlers(
  handlers: Map<string, EventHandler[]>
): void {
  handlers.clear()
}
