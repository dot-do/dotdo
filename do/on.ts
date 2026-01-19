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
 *
 * @module do/on
 */

/**
 * Event handler function type
 */
export type EventHandler = (event: unknown) => Promise<void> | void

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
 * Create a proxy for event registration on a specific noun
 *
 * @param noun - The noun (e.g., 'Customer', 'Order')
 * @param handlers - Handler registry map
 * @returns Proxy that captures verb and registers handler
 */
function createNounEventProxy(
  noun: string,
  handlers: Map<string, EventHandler[]>
): NounEventProxy {
  return new Proxy({} as NounEventProxy, {
    get(_target, verb: string) {
      // Return a function that registers the handler
      return (handler: EventHandler) => {
        const key = `${noun}.${verb}`
        const existing = handlers.get(key) || []
        handlers.set(key, [...existing, handler])
      }
    }
  })
}

/**
 * Create the top-level OnProxy for event handler registration
 *
 * This creates a two-level proxy:
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
  return new Proxy({} as OnProxy, {
    get(_target, noun: string) {
      return createNounEventProxy(noun, handlers)
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
 * Invoke all handlers that match an event
 *
 * Finds matching handlers using matchHandlers() and invokes them.
 * Handles both sync and async handlers gracefully.
 * Errors in individual handlers don't prevent other handlers from running.
 *
 * @param eventType - Event type in format "Noun.verb"
 * @param event - Event data to pass to handlers
 * @param handlers - Handler registry map
 * @returns Promise that resolves when all handlers complete
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
 * await invokeHandlers('Order.placed', { orderId: '123' }, handlers)
 * // Both handlers execute
 * ```
 */
export async function invokeHandlers(
  eventType: string,
  event: unknown,
  handlers: Map<string, EventHandler[]>
): Promise<void> {
  const matched = matchHandlers(eventType, handlers)

  // Invoke all matched handlers
  await Promise.allSettled(
    matched.map(async (handler) => {
      try {
        await handler(event)
      } catch (error) {
        console.error(`Error in handler for ${eventType}:`, error)
      }
    })
  )
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
