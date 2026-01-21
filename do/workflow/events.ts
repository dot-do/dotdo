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
 * Remote event handler registration (stringified code for server-side execution)
 */
export interface RemoteEventHandler {
  /** Unique identifier for this handler registration */
  id: string
  /** Event type pattern (e.g., 'Customer.signup', '*.created') */
  event: string
  /** Stringified handler code */
  code: string
  /** When the handler was registered */
  registeredAt: number
  /** Source identifier (e.g., client ID, DO ID) */
  source?: string
}

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

// ============================================================================
// Remote Event Handler Management
// ============================================================================

/**
 * Generate a unique ID for a remote handler registration
 */
function generateHandlerId(): string {
  return `rh-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Register a remote event handler from stringified code.
 *
 * This stores the handler code for server-side execution when events fire.
 * The handler will be executed using a sandboxed script interpreter with
 * access to the $ context.
 *
 * @param event - Event type pattern (e.g., 'Customer.signup')
 * @param code - Stringified handler function code
 * @param remoteHandlers - Map storing remote handler registrations
 * @param source - Optional source identifier
 * @returns The registered remote handler
 *
 * @example
 * ```ts
 * const remoteHandlers = new Map()
 *
 * // Register a remote handler
 * const handler = registerRemoteHandler(
 *   'Customer.signup',
 *   'async (event) => { console.log(event.email) }',
 *   remoteHandlers,
 *   'client-123'
 * )
 * ```
 */
export function registerRemoteHandler(
  event: string,
  code: string,
  remoteHandlers: Map<string, RemoteEventHandler[]>,
  source?: string
): RemoteEventHandler {
  const handler: RemoteEventHandler = {
    id: generateHandlerId(),
    event,
    code,
    registeredAt: Date.now(),
    source
  }

  const existing = remoteHandlers.get(event) || []
  remoteHandlers.set(event, [...existing, handler])

  logger.debug(`Registered remote handler for "${event}" (id: ${handler.id})`)

  return handler
}

/**
 * Find all remote handlers that match a given event type
 *
 * Matches handlers in order of specificity (same as matchHandlers):
 * 1. Exact match (Customer.signup)
 * 2. Noun wildcard (Customer.*)
 * 3. Verb wildcard (*.signup)
 * 4. Global wildcard (*.*)
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param remoteHandlers - Remote handler registry map
 * @returns Array of matching remote handlers
 */
export function matchRemoteHandlers(
  eventType: string,
  remoteHandlers: Map<string, RemoteEventHandler[]>
): RemoteEventHandler[] {
  const [noun, verb] = eventType.split('.')
  const matched: RemoteEventHandler[] = []

  // 1. Exact match
  const exact = remoteHandlers.get(eventType)
  if (exact) matched.push(...exact)

  // 2. Noun wildcard (Customer.*)
  if (noun && verb) {
    const nounWild = remoteHandlers.get(`${noun}.*`)
    if (nounWild) matched.push(...nounWild)
  }

  // 3. Verb wildcard (*.created)
  if (noun && verb) {
    const verbWild = remoteHandlers.get(`*.${verb}`)
    if (verbWild) matched.push(...verbWild)
  }

  // 4. Global wildcard (*.*)
  const globalWild = remoteHandlers.get('*.*')
  if (globalWild) matched.push(...globalWild)

  return matched
}

/**
 * Type for a custom code evaluator function
 * Used to execute stringified handler code in a sandboxed environment
 */
export type CodeEvaluator = (
  code: string,
  event: unknown,
  context: Record<string, unknown>
) => Promise<unknown>

/**
 * Options for executing remote handlers
 */
export interface ExecuteRemoteHandlerOptions {
  /** The $ context to make available to the handler */
  context?: Record<string, unknown>
  /** Timeout for handler execution in milliseconds */
  timeout?: number
  /**
   * Custom code evaluator for executing handler code.
   * In production, this should be a sandboxed evaluator (V8 isolates, WASM, etc.).
   * If not provided, uses a default Function()-based evaluator which may not be
   * available in all environments (e.g., Cloudflare Workers disallow new Function()).
   */
  evaluator?: CodeEvaluator
}

/**
 * Result of executing a remote handler
 */
export interface RemoteHandlerResult {
  handler: RemoteEventHandler
  succeeded: boolean
  attempts: number
  error?: Error
}

/**
 * Execute a single remote handler by evaluating its stringified code.
 *
 * The handler code is executed in a sandboxed context with access to the
 * $ context for workflow operations. This enables remote clients to register
 * handlers that run server-side with full DO capabilities.
 *
 * SECURITY NOTE: This executes user-provided code. In production, this should
 * be sandboxed (e.g., using V8 isolates, WebAssembly, or a custom interpreter).
 * The current implementation uses Function() which is suitable for trusted code.
 *
 * @param handler - The remote handler to execute
 * @param event - Event data to pass to the handler
 * @param options - Execution options
 * @returns Result of the execution
 *
 * @example
 * ```ts
 * const result = await executeRemoteHandler(
 *   remoteHandler,
 *   { email: 'user@example.com' },
 *   { context: { $: workflowContext } }
 * )
 * ```
 */
/**
 * Default code evaluator using Function() constructor.
 * Note: This may not work in environments that disallow dynamic code
 * generation (e.g., Cloudflare Workers with unsafe-eval CSP).
 */
const defaultEvaluator: CodeEvaluator = async (code, event, context) => {
  const contextKeys = Object.keys(context)
  const contextValues = Object.values(context)

  // Build a wrapper that creates the handler function and calls it
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const createHandler = new Function(
    ...contextKeys,
    '__handlerCode__',
    '__event__',
    `
    'use strict';
    const handler = eval('(' + __handlerCode__ + ')');
    return handler(__event__);
    `
  )

  return createHandler(...contextValues, code, event)
}

export async function executeRemoteHandler(
  handler: RemoteEventHandler,
  event: unknown,
  options: ExecuteRemoteHandlerOptions = {}
): Promise<RemoteHandlerResult> {
  const { context = {}, timeout = 30000, evaluator = defaultEvaluator } = options

  try {
    // Execute with timeout
    const result = await Promise.race([
      evaluator(handler.code, event, context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Handler execution timed out after ${timeout}ms`)), timeout)
      )
    ])

    return {
      handler,
      succeeded: true,
      attempts: 1
    }
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error))
    logger.error(`Remote handler "${handler.id}" failed:`, errorObj.message)

    return {
      handler,
      succeeded: false,
      attempts: 1,
      error: errorObj
    }
  }
}

/**
 * Execute all matching remote handlers for an event
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param event - Event data to pass to handlers
 * @param remoteHandlers - Remote handler registry
 * @param options - Execution options
 * @returns Results for all handlers
 */
export async function invokeRemoteHandlers(
  eventType: string,
  event: unknown,
  remoteHandlers: Map<string, RemoteEventHandler[]>,
  options: ExecuteRemoteHandlerOptions = {}
): Promise<{ succeeded: RemoteHandlerResult[]; failed: RemoteHandlerResult[] }> {
  const matched = matchRemoteHandlers(eventType, remoteHandlers)

  if (matched.length === 0) {
    return { succeeded: [], failed: [] }
  }

  const results = await Promise.all(
    matched.map(handler => executeRemoteHandler(handler, event, options))
  )

  const succeeded = results.filter(r => r.succeeded)
  const failed = results.filter(r => !r.succeeded)

  return { succeeded, failed }
}

/**
 * Remove a specific remote handler by ID
 *
 * @param handlerId - The ID of the handler to remove
 * @param remoteHandlers - Remote handler registry
 * @returns True if the handler was found and removed
 */
export function removeRemoteHandler(
  handlerId: string,
  remoteHandlers: Map<string, RemoteEventHandler[]>
): boolean {
  for (const [event, handlers] of remoteHandlers) {
    const index = handlers.findIndex(h => h.id === handlerId)
    if (index !== -1) {
      handlers.splice(index, 1)
      if (handlers.length === 0) {
        remoteHandlers.delete(event)
      }
      logger.debug(`Removed remote handler "${handlerId}" for event "${event}"`)
      return true
    }
  }
  return false
}

/**
 * Clear all remote handlers for a specific event type
 *
 * @param event - Event type pattern
 * @param remoteHandlers - Remote handler registry
 */
export function clearRemoteHandlers(
  event: string,
  remoteHandlers: Map<string, RemoteEventHandler[]>
): void {
  remoteHandlers.delete(event)
}

/**
 * Clear all remote handlers
 *
 * @param remoteHandlers - Remote handler registry
 */
export function clearAllRemoteHandlers(
  remoteHandlers: Map<string, RemoteEventHandler[]>
): void {
  remoteHandlers.clear()
}

/**
 * Get all registered remote handlers
 *
 * @param remoteHandlers - Remote handler registry
 * @returns Array of all remote handlers
 */
export function getAllRemoteHandlers(
  remoteHandlers: Map<string, RemoteEventHandler[]>
): RemoteEventHandler[] {
  const all: RemoteEventHandler[] = []
  for (const handlers of remoteHandlers.values()) {
    all.push(...handlers)
  }
  return all
}
