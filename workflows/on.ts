/**
 * @module workflows/on
 *
 * Event-Driven Workflow DSL for dotdo
 *
 * This module provides the core event system for declarative workflow programming,
 * enabling event subscription, scheduled execution, event emission, and conditional
 * logic through intuitive proxy-based APIs.
 *
 * ## Event Subscription
 *
 * The `on` proxy allows subscribing to domain events using a natural `Entity.verb` pattern:
 *
 * @example
 * ```typescript
 * import { on } from 'dotdo/workflows'
 *
 * // Subscribe to customer signup events
 * on.Customer.signup((customer) => {
 *   console.log('New customer:', customer.name)
 * })
 *
 * // Subscribe with context for cleanup
 * const unsubscribe = on.Order.shipped((order) => {
 *   sendNotification(order.customer)
 * }, { context: 'shipping-service' })
 *
 * // Cleanup when done
 * unsubscribe()
 * ```
 *
 * ## Scheduled Execution
 *
 * The `every` proxy enables declarative scheduling with human-readable syntax:
 *
 * @example
 * ```typescript
 * import { every } from 'dotdo/workflows'
 *
 * // Run every Monday at 9am
 * every.Monday.at9am(() => {
 *   generateWeeklyReport()
 * })
 *
 * // Run daily at 6pm
 * every.day.at6pm(() => {
 *   sendDailySummary()
 * })
 *
 * // Run every hour
 * every.hour(() => {
 *   syncExternalData()
 * })
 *
 * // Natural language scheduling
 * every('Monday at 9am', () => {
 *   weeklyStandup()
 * })
 * ```
 *
 * ## Event Emission
 *
 * The `send` proxy emits events as pipeline expressions for deferred execution:
 *
 * @example
 * ```typescript
 * import { send } from 'dotdo/workflows'
 *
 * // Fire-and-forget event emission
 * send.Order.shipped({ orderId: '123', carrier: 'UPS' })
 * send.Customer.signup({ email: 'user@example.com' })
 * ```
 *
 * ## Conditional Logic
 *
 * The `when` function provides declarative conditionals for workflow branching:
 *
 * @example
 * ```typescript
 * import { when } from 'dotdo/workflows'
 *
 * const result = when(order.total > 1000, {
 *   then: () => applyDiscount(order),
 *   else: () => order
 * })
 * ```
 *
 * ## Domain Factory
 *
 * The `Domain` factory creates callable domain objects for cross-cutting concerns:
 *
 * @example
 * ```typescript
 * import { Domain } from 'dotdo/workflows'
 *
 * const CRM = Domain('CRM', {
 *   createAccount: (customer) => ({ id: '123', ...customer }),
 *   sendWelcome: (account) => sendEmail(account.email)
 * })
 *
 * // Use directly - returns PipelinePromise
 * const account = CRM(customer).createAccount()
 * ```
 *
 * @see {@link on} - Event subscription proxy
 * @see {@link every} - Scheduling proxy
 * @see {@link send} - Event emission proxy
 * @see {@link when} - Conditional branching
 * @see {@link waitFor} - Human-in-the-loop waits
 * @see {@link Domain} - Domain factory
 */

import { createPipelinePromise, PipelineExpression, isPipelinePromise } from './pipeline-promise'

// ============================================================================
// Handler Registration with Cleanup Support
// ============================================================================

/**
 * Unsubscribe function returned when registering a handler
 */
export type Unsubscribe = () => boolean

/**
 * Handler registration metadata for tracking and cleanup
 */
export interface HandlerRegistration {
  handler: Function
  eventKey: string
  context?: string
  registeredAt: number
}

// Registry for event handlers with metadata
const eventHandlers = new Map<string, HandlerRegistration[]>()

// Index for fast context-based cleanup
const contextIndex = new Map<string, Set<string>>()

/**
 * Get all registered handlers for an event key.
 * If context is provided, only returns handlers registered with that context.
 *
 * @param eventKey - The event key (e.g., "Customer.signup")
 * @param context - Optional context to filter handlers by (e.g., DO namespace)
 * @returns Array of handler functions
 */
export function getRegisteredHandlers(eventKey: string, context?: string): Function[] {
  const registrations = eventHandlers.get(eventKey) || []
  if (context !== undefined) {
    return registrations.filter(r => r.context === context).map(r => r.handler)
  }
  return registrations.map(r => r.handler)
}

/**
 * Get handler registrations with metadata
 */
export function getHandlerRegistrations(eventKey: string): HandlerRegistration[] {
  return eventHandlers.get(eventKey) || []
}

/**
 * Get total count of registered handlers across all events.
 * If context is provided, only counts handlers registered with that context.
 *
 * @param context - Optional context to filter handlers by (e.g., DO namespace)
 * @returns Total handler count
 */
export function getHandlerCount(context?: string): number {
  let count = 0
  for (const registrations of eventHandlers.values()) {
    if (context !== undefined) {
      count += registrations.filter(r => r.context === context).length
    } else {
      count += registrations.length
    }
  }
  return count
}

/**
 * Get all event keys that have registered handlers
 */
export function getRegisteredEventKeys(): string[] {
  return Array.from(eventHandlers.keys())
}

/**
 * Clear all handlers (for testing or full reset)
 */
export function clearHandlers(): void {
  eventHandlers.clear()
  contextIndex.clear()
}

/**
 * Clear all handlers registered under a specific context
 * Use this when a Durable Object is being destroyed
 *
 * @param context - The context identifier (e.g., DO namespace)
 * @returns Number of handlers removed
 */
export function clearHandlersByContext(context: string): number {
  const eventKeys = contextIndex.get(context)
  if (!eventKeys) return 0

  let removedCount = 0
  for (const eventKey of eventKeys) {
    const registrations = eventHandlers.get(eventKey)
    if (!registrations) continue

    const remaining = registrations.filter(r => r.context !== context)
    const removed = registrations.length - remaining.length
    removedCount += removed

    if (remaining.length === 0) {
      eventHandlers.delete(eventKey)
    } else {
      eventHandlers.set(eventKey, remaining)
    }
  }

  contextIndex.delete(context)
  return removedCount
}

/**
 * Unregister a specific handler by event key and handler reference
 *
 * @param eventKey - The event key (e.g., "Customer.signup")
 * @param handler - The handler function to remove
 * @returns true if handler was found and removed
 */
export function unregisterHandler(eventKey: string, handler: Function): boolean {
  const registrations = eventHandlers.get(eventKey)
  if (!registrations) return false

  const index = registrations.findIndex(r => r.handler === handler)
  if (index === -1) return false

  const [removed] = registrations.splice(index, 1)

  // Clean up context index
  if (removed?.context) {
    const contextEvents = contextIndex.get(removed.context)
    if (contextEvents) {
      // Only remove from index if no more handlers for this event/context combo
      const hasMoreInContext = registrations.some(r => r.context === removed.context)
      if (!hasMoreInContext) {
        contextEvents.delete(eventKey)
        if (contextEvents.size === 0) {
          contextIndex.delete(removed.context)
        }
      }
    }
  }

  // Clean up empty event key
  if (registrations.length === 0) {
    eventHandlers.delete(eventKey)
  }

  return true
}

/**
 * Register a handler and return an unsubscribe function
 *
 * @param eventKey - The event key (e.g., "Customer.signup" or "schedule:0 9 * * 1")
 * @param handler - The handler function
 * @param context - Optional context for grouped cleanup (e.g., DO namespace)
 * @returns Unsubscribe function that removes this handler
 */
function registerHandler(eventKey: string, handler: Function, context?: string): Unsubscribe {
  const registrations = eventHandlers.get(eventKey) || []

  const registration: HandlerRegistration = {
    handler,
    eventKey,
    context,
    registeredAt: Date.now(),
  }

  registrations.push(registration)
  eventHandlers.set(eventKey, registrations)

  // Update context index for fast cleanup
  if (context) {
    if (!contextIndex.has(context)) {
      contextIndex.set(context, new Set())
    }
    contextIndex.get(context)!.add(eventKey)
  }

  // Return unsubscribe function
  return () => unregisterHandler(eventKey, handler)
}

// ============================================================================
// on.Entity.event(handler) - Event subscription
// ============================================================================

import type { TypedEventHandler, TypedDomainEvent, EventPayload } from '../types/EventHandler'

/**
 * Options for event handler registration
 */
export interface OnHandlerOptions {
  /** Context identifier for grouped cleanup (e.g., DO namespace) */
  context?: string
}

/**
 * OnEntityProxy - Typed proxy for accessing event verbs on an entity
 *
 * @typeParam Entity - The entity (noun) name for type inference
 */
type OnEntityProxy<Entity extends string = string> = {
  [Verb in string]: (handler: TypedEventHandler<EventPayload<Entity, Verb>>, options?: OnHandlerOptions) => Unsubscribe
}

/**
 * OnProxy - Typed proxy for accessing entities in the event system
 */
type OnProxy = {
  [Entity in string]: OnEntityProxy<Entity>
}

/**
 * Event subscription proxy for declarative event handling.
 *
 * Supports infinite `Noun.verb` combinations via JavaScript Proxy, enabling
 * natural domain event subscription without pre-defining event types.
 *
 * @example Basic event subscription
 * ```typescript
 * // Subscribe to customer signup events
 * on.Customer.signup((customer) => {
 *   console.log('Welcome', customer.name)
 *   sendWelcomeEmail(customer.email)
 * })
 *
 * // Subscribe to payment events
 * on.Payment.failed((payment) => {
 *   notifyBilling(payment.customerId)
 * })
 * ```
 *
 * @example With context for cleanup
 * ```typescript
 * // Register with context for grouped cleanup
 * on.Order.created((order) => {
 *   processOrder(order)
 * }, { context: 'order-processor' })
 *
 * // Later, clean up all handlers for this context
 * clearHandlersByContext('order-processor')
 * ```
 *
 * @example Unsubscribe pattern
 * ```typescript
 * const unsubscribe = on.User.updated((user) => {
 *   syncToExternalSystem(user)
 * })
 *
 * // Stop listening when no longer needed
 * unsubscribe()
 * ```
 *
 * @returns Unsubscribe function to remove the handler
 */
export const on: OnProxy = new Proxy({} as OnProxy, {
  get(_, entity: string) {
    return new Proxy({} as OnEntityProxy<typeof entity>, {
      get(_, event: string) {
        return (handler: TypedEventHandler<unknown>, options?: OnHandlerOptions): Unsubscribe => {
          return registerHandler(`${entity}.${event}`, handler, options?.context)
        }
      },
    })
  },
})

// ============================================================================
// every.Monday.at9am(handler) - Scheduled execution
// ============================================================================

const DAYS: Record<string, string> = {
  Sunday: '0',
  Monday: '1',
  Tuesday: '2',
  Wednesday: '3',
  Thursday: '4',
  Friday: '5',
  Saturday: '6',
  day: '*',
  daily: '*',
}

const TIMES: Record<string, string> = {
  at12am: '0 0',
  at1am: '0 1',
  at2am: '0 2',
  at3am: '0 3',
  at4am: '0 4',
  at5am: '0 5',
  at6am: '0 6',
  at7am: '0 7',
  at8am: '0 8',
  at9am: '0 9',
  at10am: '0 10',
  at11am: '0 11',
  at12pm: '0 12',
  at1pm: '0 13',
  at2pm: '0 14',
  at3pm: '0 15',
  at4pm: '0 16',
  at5pm: '0 17',
  at6pm: '0 18',
  at7pm: '0 19',
  at8pm: '0 20',
  at9pm: '0 21',
  at10pm: '0 22',
  at11pm: '0 23',
}

function toCron(day: string, time?: string): string {
  const dayNum = DAYS[day] || '*'

  if (!time) {
    // every.hour, every.minute
    if (day === 'hour') return '0 * * * *'
    if (day === 'minute') return '* * * * *'
    return `0 0 * * ${dayNum}`
  }

  const [minute, hour] = (TIMES[time] || '0 0').split(' ')
  return `${minute} ${hour} * * ${dayNum}`
}

function parseNaturalSchedule(schedule: string): string {
  // "Monday at 9am" -> "0 9 * * 1"
  // "daily at 6am" -> "0 6 * * *"
  // "hourly" -> "0 * * * *"

  const lower = schedule.toLowerCase()

  if (lower === 'hourly') return '0 * * * *'

  const dayMatch = lower.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|daily?)/)
  const timeMatch = lower.match(/at\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)

  let dayNum = '*'
  if (dayMatch) {
    const dayName = dayMatch[1]!.charAt(0).toUpperCase() + dayMatch[1]!.slice(1)
    dayNum = DAYS[dayName] || DAYS[dayMatch[1]!] || '*'
  }

  let hour = '0'
  let minute = '0'
  if (timeMatch) {
    hour = timeMatch[1]!
    minute = timeMatch[2] || '0'
    if (timeMatch[3]?.toLowerCase() === 'pm' && parseInt(hour) < 12) {
      hour = String(parseInt(hour) + 12)
    }
    if (timeMatch[3]?.toLowerCase() === 'am' && hour === '12') {
      hour = '0'
    }
  }

  return `${minute} ${hour} * * ${dayNum}`
}

/**
 * Options for schedule handler registration
 */
export interface EveryHandlerOptions {
  /** Context identifier for grouped cleanup (e.g., DO namespace) */
  context?: string
}

type EveryTimeProxy = {
  [time: string]: (handler: () => void, options?: EveryHandlerOptions) => Unsubscribe
} & ((handler: () => void, options?: EveryHandlerOptions) => Unsubscribe)

type EveryDayProxy = {
  [day: string]: EveryTimeProxy
}

type EveryFunction = {
  (schedule: string, handler: () => void, options?: EveryHandlerOptions): Unsubscribe
} & EveryDayProxy

/** Schedule handler type for recurring tasks */
type ScheduleHandlerFn = () => void | Promise<void>

/**
 * Schedule builder proxy for declarative recurring task scheduling.
 *
 * Converts human-readable scheduling expressions to cron and registers
 * handlers for execution at specified times.
 *
 * @example Day and time combinations
 * ```typescript
 * // Every Monday at 9am
 * every.Monday.at9am(() => {
 *   generateWeeklyReport()
 * })
 *
 * // Every Friday at 5pm
 * every.Friday.at5pm(() => {
 *   sendWeeklyNewsletter()
 * })
 * ```
 *
 * @example Daily schedules
 * ```typescript
 * // Every day at noon
 * every.day.at12pm(() => {
 *   runDailyMaintenance()
 * })
 *
 * // Every day at midnight
 * every.day.at12am(() => {
 *   rotateLogFiles()
 * })
 * ```
 *
 * @example Interval schedules
 * ```typescript
 * // Every hour
 * every.hour(() => {
 *   checkSystemHealth()
 * })
 *
 * // Every minute
 * every.minute(() => {
 *   pingMonitoringService()
 * })
 * ```
 *
 * @example Natural language (function call syntax)
 * ```typescript
 * // Natural language parsing
 * every('Monday at 9am', () => {
 *   teamStandup()
 * })
 *
 * every('daily at 6am', () => {
 *   prepareReports()
 * })
 * ```
 *
 * @returns Unsubscribe function to cancel the schedule
 */
// Create the every proxy with both function and property access
const everyHandler: ProxyHandler<EveryFunction> = {
  get(_target: EveryFunction, day: string) {
    if (day === 'hour' || day === 'minute') {
      // every.hour(handler) - direct call
      return (handler: ScheduleHandlerFn, options?: EveryHandlerOptions): Unsubscribe => {
        const cron = toCron(day)
        return registerHandler(`schedule:${cron}`, handler, options?.context)
      }
    }

    // every.Monday.at9am(handler)
    return new Proxy((() => {}) as unknown as EveryTimeProxy, {
      get(_timeTarget, time: string) {
        return (handler: ScheduleHandlerFn, options?: EveryHandlerOptions): Unsubscribe => {
          const cron = toCron(day, time)
          return registerHandler(`schedule:${cron}`, handler, options?.context)
        }
      },
      apply(_timeTarget, _thisArg, args: [ScheduleHandlerFn, EveryHandlerOptions?]): Unsubscribe {
        // every.day(handler) without time
        const [handler, options] = args
        const cron = toCron(day)
        return registerHandler(`schedule:${cron}`, handler, options?.context)
      },
    })
  },
  apply(_target: EveryFunction, _thisArg: unknown, args: [string, ScheduleHandlerFn, EveryHandlerOptions?]): Unsubscribe {
    // every('Monday at 9am', handler)
    const [schedule, handler, options] = args
    const cron = parseNaturalSchedule(schedule)
    return registerHandler(`schedule:${cron}`, handler, options?.context)
  },
}

export const every: EveryFunction = new Proxy((() => {}) as unknown as EveryFunction, everyHandler)

// ============================================================================
// send.Entity.event(payload) - Fire-and-forget event emission
// ============================================================================

/**
 * SendEventProxy - Typed proxy for sending events with payloads
 *
 * @typeParam Entity - The entity (noun) name for type inference
 */
type SendEventProxy<Entity extends string = string> = {
  [Verb in string]: (payload: EventPayload<Entity, Verb>) => ReturnType<typeof createPipelinePromise>
}

/**
 * SendProxy - Typed proxy for accessing entities when sending events
 */
type SendProxy = {
  [Entity in string]: SendEventProxy<Entity>
}

/**
 * Event emission proxy for fire-and-forget event dispatch.
 *
 * Creates pipeline expressions for deferred event emission, enabling
 * event-driven workflows with Cap'n Web RPC promise pipelining.
 *
 * @example Basic event emission
 * ```typescript
 * // Emit order shipped event
 * send.Order.shipped({
 *   orderId: '12345',
 *   carrier: 'UPS',
 *   trackingNumber: '1Z999AA10123456784'
 * })
 *
 * // Emit customer created event
 * send.Customer.created({
 *   id: 'cust_123',
 *   email: 'user@example.com',
 *   name: 'John Doe'
 * })
 * ```
 *
 * @example In workflow context
 * ```typescript
 * async function processOrder(order: Order) {
 *   await validateOrder(order)
 *
 *   // Fire-and-forget notification
 *   send.Order.validated({ orderId: order.id })
 *
 *   await chargePayment(order)
 *   send.Payment.captured({ orderId: order.id, amount: order.total })
 *
 *   return order
 * }
 * ```
 *
 * @returns PipelinePromise representing the deferred event emission
 */
export const send: SendProxy = new Proxy({} as SendProxy, {
  get(_, entity: string) {
    return new Proxy({} as SendEventProxy, {
      get(_, event: string) {
        return (payload: unknown) => {
          const expr: PipelineExpression = {
            type: 'send',
            entity,
            event,
            payload,
          }
          return createPipelinePromise(expr, {})
        }
      },
    })
  },
})

// ============================================================================
// when(condition, { then, else }) - Declarative conditional
// ============================================================================

/**
 * Declarative conditional for workflow branching.
 *
 * Creates a pipeline expression that evaluates the condition and executes
 * the appropriate branch. Works with both pipeline promises and literal values.
 *
 * @typeParam TThen - Return type of the then branch
 * @typeParam TElse - Return type of the else branch (default: never)
 *
 * @param condition - Condition to evaluate (can be a PipelinePromise or literal)
 * @param branches - Object containing `then` and optional `else` branch functions
 * @returns PipelinePromise representing the conditional expression
 *
 * @example Basic conditional
 * ```typescript
 * const result = when(order.total > 100, {
 *   then: () => applyDiscount(order, 0.1),
 *   else: () => order
 * })
 * ```
 *
 * @example With pipeline promise condition
 * ```typescript
 * const status = $.Inventory(product).check()
 *
 * const result = when(status.available, {
 *   then: () => $.Order(order).fulfill(),
 *   else: () => $.Order(order).backorder()
 * })
 * ```
 *
 * @example Without else branch
 * ```typescript
 * when(user.isVIP, {
 *   then: () => send.Notification.vipWelcome({ userId: user.id })
 * })
 * ```
 */
export function when<TThen, TElse = never>(
  condition: unknown,
  branches: { then: () => TThen; else?: () => TElse }
): ReturnType<typeof createPipelinePromise> {
  const conditionExpr: PipelineExpression = isPipelinePromise(condition)
    ? condition.__expr
    : { type: 'literal' as const, value: condition }

  const thenResult = branches.then()
  const thenExpr: PipelineExpression = isPipelinePromise(thenResult)
    ? thenResult.__expr
    : { type: 'literal' as const, value: thenResult }

  let elseExpr: PipelineExpression | null = null
  if (branches.else) {
    const elseResult = branches.else()
    elseExpr = isPipelinePromise(elseResult) ? elseResult.__expr : { type: 'literal' as const, value: elseResult }
  }

  const expr: PipelineExpression = {
    type: 'conditional',
    condition: conditionExpr,
    thenBranch: thenExpr,
    elseBranch: elseExpr,
  }

  return createPipelinePromise(expr, {})
}

// ============================================================================
// waitFor(eventName, options) - Human-in-the-loop
// ============================================================================

/**
 * Human-in-the-loop wait for external events or approvals.
 *
 * Suspends workflow execution until the specified event is received,
 * enabling human approval workflows, external system callbacks, and
 * long-running asynchronous operations.
 *
 * @param eventName - Name of the event to wait for
 * @param options - Optional timeout and event type configuration
 * @returns PipelinePromise that resolves when the event is received
 *
 * @example Wait for human approval
 * ```typescript
 * const approval = await waitFor('manager.approval', {
 *   timeout: '24 hours',
 *   type: 'approval'
 * })
 *
 * if (approval.approved) {
 *   processRefund(order)
 * }
 * ```
 *
 * @example Wait for external webhook
 * ```typescript
 * // Workflow pauses until payment provider sends webhook
 * const paymentResult = await waitFor('payment.completed', {
 *   timeout: '30 minutes'
 * })
 *
 * if (paymentResult.success) {
 *   send.Order.paid({ orderId: order.id })
 * }
 * ```
 *
 * @example In approval workflow
 * ```typescript
 * async function processLargeRefund(refund: Refund) {
 *   // Escalate to manager for approval
 *   send.Approval.requested({
 *     type: 'refund',
 *     amount: refund.amount,
 *     customerId: refund.customerId
 *   })
 *
 *   // Workflow hibernates until approval
 *   const decision = await waitFor('refund.decision')
 *
 *   return decision.approved
 *     ? executeRefund(refund)
 *     : rejectRefund(refund, decision.reason)
 * }
 * ```
 */
export function waitFor(
  eventName: string,
  options: { timeout?: string; type?: string } = {}
): ReturnType<typeof createPipelinePromise> {
  const expr: PipelineExpression = {
    type: 'waitFor',
    eventName,
    options,
  }

  return createPipelinePromise(expr, {})
}

// ============================================================================
// Domain(name, handlers) - Domain factory that returns callable
// ============================================================================

import { Domain as BaseDomain, registerDomain as baseRegisterDomain } from './domain'

type DomainCallable = {
  (context: unknown): any
  __domainName: string
  __handlers: Record<string, Function>
}

/**
 * Factory for creating callable domain objects.
 *
 * Domains encapsulate related business logic and can be invoked directly
 * in workflow expressions. They integrate with the pipeline promise system
 * for deferred execution and promise pipelining.
 *
 * @param name - Unique identifier for the domain
 * @param handlers - Object mapping method names to handler functions
 * @returns A callable domain object that creates pipeline expressions
 *
 * @example Basic domain definition
 * ```typescript
 * const CRM = Domain('CRM', {
 *   createAccount: (customer) => ({
 *     id: generateId(),
 *     ...customer,
 *     createdAt: new Date()
 *   }),
 *   sendWelcome: (account) => {
 *     return sendEmail({
 *       to: account.email,
 *       template: 'welcome'
 *     })
 *   }
 * })
 * ```
 *
 * @example Using domain in workflows
 * ```typescript
 * // Direct invocation returns PipelinePromise
 * const account = CRM(customer).createAccount()
 * const emailResult = CRM(account).sendWelcome()
 *
 * // Can be awaited when needed
 * const result = await account
 * ```
 *
 * @example Chaining domain calls
 * ```typescript
 * const Inventory = Domain('Inventory', {
 *   check: (product) => getStock(product.id),
 *   reserve: (product, quantity) => reserveStock(product.id, quantity),
 *   release: (reservation) => releaseStock(reservation.id)
 * })
 *
 * const Shipping = Domain('Shipping', {
 *   calculate: (order) => calculateRates(order),
 *   create: (order, rate) => createShipment(order, rate)
 * })
 *
 * // Compose domains in workflows
 * async function fulfillOrder(order: Order) {
 *   const stock = await Inventory(order.product).check()
 *   if (stock.available >= order.quantity) {
 *     const reservation = await Inventory(order.product).reserve(order.quantity)
 *     const rates = await Shipping(order).calculate()
 *     return Shipping(order).create(rates[0])
 *   }
 * }
 * ```
 */
export function Domain(name: string, handlers: Record<string, Function>): DomainCallable {
  // Register with base domain system
  // Cast to HandlerMap since we're accepting more flexible function types
  const domainObj = BaseDomain(name, handlers as any)
  baseRegisterDomain(domainObj)

  // Create callable that returns a proxy for method access
  const callable = ((context: unknown) => {
    return new Proxy(
      {},
      {
        get(_, method: string) {
          // Return function that creates PipelinePromise
          return (...args: unknown[]) => {
            const expr: PipelineExpression = {
              type: 'call',
              domain: name,
              method: [method],
              context,
              args,
            }
            return createPipelinePromise(expr, {})
          }
        },
      },
    )
  }) as DomainCallable

  callable.__domainName = name
  callable.__handlers = handlers

  return callable
}
