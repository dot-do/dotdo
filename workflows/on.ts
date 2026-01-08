/**
 * Event-Driven Workflow DSL
 *
 * on.Customer.signup(customer => { ... })
 * every.Monday.at9am(() => { ... })
 * send.Order.shipped(order)
 */

import { createPipelinePromise, PipelineExpression, isPipelinePromise } from './pipeline-promise'

// Registry for event handlers
const eventHandlers = new Map<string, Function[]>()

export function getRegisteredHandlers(eventKey: string): Function[] {
  return eventHandlers.get(eventKey) || []
}

export function clearHandlers(): void {
  eventHandlers.clear()
}

function registerHandler(eventKey: string, handler: Function): void {
  const handlers = eventHandlers.get(eventKey) || []
  handlers.push(handler)
  eventHandlers.set(eventKey, handlers)
}

// ============================================================================
// on.Entity.event(handler) - Event subscription
// ============================================================================

type OnEntityProxy = {
  [event: string]: (handler: (payload: any) => void) => void
}

type OnProxy = {
  [entity: string]: OnEntityProxy
}

export const on: OnProxy = new Proxy({} as OnProxy, {
  get(_, entity: string) {
    return new Proxy({} as OnEntityProxy, {
      get(_, event: string) {
        return (handler: Function) => {
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

// Create the every proxy with both function and property access
const everyHandler = {
  get(_: any, day: string) {
    if (day === 'hour' || day === 'minute') {
      // every.hour(handler) - direct call
      return (handler: Function) => {
        const cron = toCron(day)
        registerHandler(`schedule:${cron}`, handler)
      }
    }

    // every.Monday.at9am(handler)
    return new Proxy((() => {}) as EveryTimeProxy, {
      get(_, time: string) {
        return (handler: Function) => {
          const cron = toCron(day, time)
          registerHandler(`schedule:${cron}`, handler)
        }
      },
      apply(_, __, [handler]: [Function]) {
        // every.day(handler) without time
        const cron = toCron(day)
        registerHandler(`schedule:${cron}`, handler)
      },
    })
  },
  apply(_: any, __: any, [schedule, handler]: [string, Function]) {
    // every('Monday at 9am', handler)
    const cron = parseNaturalSchedule(schedule)
    registerHandler(`schedule:${cron}`, handler)
  },
}

export const every: EveryFunction = new Proxy((() => {}) as EveryFunction, everyHandler)

// ============================================================================
// send.Entity.event(payload) - Fire-and-forget event emission
// ============================================================================

type SendEventProxy = {
  [event: string]: (payload: any) => any
}

type SendProxy = {
  [entity: string]: SendEventProxy
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
          } as any // extend PipelineExpression type
          return createPipelinePromise(expr, {})
        }
      },
    })
  },
})

// ============================================================================
// when(condition, { then, else }) - Declarative conditional
// ============================================================================

export function when(condition: any, branches: { then: () => any; else?: () => any }): any {
  const conditionExpr = isPipelinePromise(condition) ? condition.__expr : { type: 'literal', value: condition }

  const thenResult = branches.then()
  const thenExpr = isPipelinePromise(thenResult) ? thenResult.__expr : { type: 'literal', value: thenResult }

  let elseExpr = null
  if (branches.else) {
    const elseResult = branches.else()
    elseExpr = isPipelinePromise(elseResult) ? elseResult.__expr : { type: 'literal', value: elseResult }
  }

  const expr: PipelineExpression = {
    type: 'conditional',
    condition: conditionExpr,
    thenBranch: thenExpr,
    elseBranch: elseExpr,
  } as any

  return createPipelinePromise(expr, {})
}

// ============================================================================
// waitFor(eventName, options) - Human-in-the-loop
// ============================================================================

export function waitFor(eventName: string, options: { timeout?: string; type?: string } = {}): any {
  const expr: PipelineExpression = {
    type: 'waitFor',
    eventName,
    options,
  } as any

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
  const domainObj = BaseDomain(name, handlers)
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
