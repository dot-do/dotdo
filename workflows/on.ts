/**
 * Event-Driven Workflow DSL
 *
 * on.Customer.signup(customer => { ... })
 * every.Monday.at9am(() => { ... })
 * send.Order.shipped(order)
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
 * Get all registered handlers for an event key
 */
export function getRegisteredHandlers(eventKey: string): Function[] {
  return (eventHandlers.get(eventKey) || []).map(r => r.handler)
}

/**
 * Get handler registrations with metadata
 */
export function getHandlerRegistrations(eventKey: string): HandlerRegistration[] {
  return eventHandlers.get(eventKey) || []
}

/**
 * Get total count of registered handlers across all events
 */
export function getHandlerCount(): number {
  let count = 0
  for (const registrations of eventHandlers.values()) {
    count += registrations.length
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
  if (removed.context) {
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
 * OnEntityProxy - Typed proxy for accessing event verbs on an entity
 *
 * @typeParam Entity - The entity (noun) name for type inference
 */
type OnEntityProxy<Entity extends string = string> = {
  [Verb in string]: (handler: TypedEventHandler<EventPayload<Entity, Verb>>) => void
}

/**
 * OnProxy - Typed proxy for accessing entities in the event system
 */
type OnProxy = {
  [Entity in string]: OnEntityProxy<Entity>
}

export const on: OnProxy = new Proxy({} as OnProxy, {
  get(_, entity: string) {
    return new Proxy({} as OnEntityProxy<typeof entity>, {
      get(_, event: string) {
        return (handler: TypedEventHandler<unknown>) => {
          registerHandler(`${entity}.${event}`, handler)
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
    const dayName = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1)
    dayNum = DAYS[dayName] || DAYS[dayMatch[1]] || '*'
  }

  let hour = '0'
  let minute = '0'
  if (timeMatch) {
    hour = timeMatch[1]
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

type EveryTimeProxy = {
  [time: string]: (handler: () => void) => void
} & ((handler: () => void) => void)

type EveryDayProxy = {
  [day: string]: EveryTimeProxy
}

type EveryFunction = {
  (schedule: string, handler: () => void): void
} & EveryDayProxy

/** Schedule handler type for recurring tasks */
type ScheduleHandlerFn = () => void | Promise<void>

// Create the every proxy with both function and property access
const everyHandler: ProxyHandler<EveryFunction> = {
  get(_target: EveryFunction, day: string) {
    if (day === 'hour' || day === 'minute') {
      // every.hour(handler) - direct call
      return (handler: ScheduleHandlerFn) => {
        const cron = toCron(day)
        registerHandler(`schedule:${cron}`, handler)
      }
    }

    // every.Monday.at9am(handler)
    return new Proxy((() => {}) as unknown as EveryTimeProxy, {
      get(_timeTarget, time: string) {
        return (handler: ScheduleHandlerFn) => {
          const cron = toCron(day, time)
          registerHandler(`schedule:${cron}`, handler)
        }
      },
      apply(_timeTarget, _thisArg, [handler]: [ScheduleHandlerFn]) {
        // every.day(handler) without time
        const cron = toCron(day)
        registerHandler(`schedule:${cron}`, handler)
      },
    })
  },
  apply(_target: EveryFunction, _thisArg: unknown, [schedule, handler]: [string, ScheduleHandlerFn]) {
    // every('Monday at 9am', handler)
    const cron = parseNaturalSchedule(schedule)
    registerHandler(`schedule:${cron}`, handler)
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
 * Creates a domain that can be called directly without $ prefix.
 *
 * @example
 * const CRM = Domain('CRM', {
 *   createAccount: (customer) => ({ id: '123' })
 * })
 *
 * // Use directly - returns PipelinePromise
 * const result = CRM(customer).createAccount()
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
