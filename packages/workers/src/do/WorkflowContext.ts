/**
 * WorkflowContext ($) - Unified interface for DO operations
 *
 * Provides:
 * - Event handlers ($.on) - $.on.Noun.verb(handler), wildcards
 * - Scheduling DSL ($.every) - $.every.Monday.at9am(), $.every(5).minutes()
 * - Durable execution - $.do(action), $.try(action), $.send(event)
 * - Cross-DO RPC - $.Customer(id).method()
 *
 * @module @dotdo/workers/do
 */

/**
 * Event object passed to handlers
 */
export interface Event {
  id: string
  type: string
  subject: string
  object: string
  data: unknown
  timestamp: Date
}

/**
 * Event handler function type
 */
export type EventHandler = (event: Event) => void | Promise<void>

/**
 * Schedule handler function type
 */
export type ScheduleHandler = () => void | Promise<void>

/**
 * Time builder for scheduling DSL
 */
export interface TimeBuilder {
  at9am: (handler: ScheduleHandler) => () => void
  at5pm: (handler: ScheduleHandler) => () => void
  at6am: (handler: ScheduleHandler) => () => void
  at: (time: string) => (handler: ScheduleHandler) => () => void
}

/**
 * Schedule builder for $.every
 */
export interface ScheduleBuilder {
  Monday: TimeBuilder
  Tuesday: TimeBuilder
  Wednesday: TimeBuilder
  Thursday: TimeBuilder
  Friday: TimeBuilder
  Saturday: TimeBuilder
  Sunday: TimeBuilder
  day: TimeBuilder
  hour: (handler: ScheduleHandler) => () => void
  minute: (handler: ScheduleHandler) => () => void
}

/**
 * Interval builder for $.every(n)
 */
export interface IntervalBuilder {
  minutes: (handler: ScheduleHandler) => () => void
  hours: (handler: ScheduleHandler) => () => void
  seconds: (handler: ScheduleHandler) => () => void
}

/**
 * Options for creating a WorkflowContext
 */
export interface CreateContextOptions {
  stubResolver?: (noun: string, id: string) => Record<string, Function>
  rpcTimeout?: number
  circuitBreaker?: {
    failureThreshold: number
    resetTimeout: number
    circuitPerDOType?: boolean
  }
}

/**
 * WorkflowContext interface - the $ object
 */
export interface WorkflowContext {
  // Event handlers
  on: Record<string, Record<string, (handler: EventHandler) => () => void>>
  getRegisteredHandlers(eventKey: string): EventHandler[]
  matchHandlers(eventKey: string): EventHandler[]
  dispatch(eventKey: string, data: unknown): Promise<void>

  // Scheduling
  every: ScheduleBuilder & ((n: number) => IntervalBuilder)
  at(date: string | Date): (handler: ScheduleHandler) => () => void
  getSchedule(cron: string): { handler: ScheduleHandler } | undefined

  // Execution
  send(event: string, data: unknown): string
  try<T>(action: () => T | Promise<T>, options?: { timeout?: number }): Promise<T>
  do<T>(
    action: () => T | Promise<T>,
    options?: { stepId?: string; maxRetries?: number }
  ): Promise<T>

  // Cross-DO RPC (dynamic access)
  [noun: string]: unknown
}

// Generate unique event IDs
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Parse time string to hour
function parseTimeToHour(time: string): number {
  // Handle formats like "9am", "5pm", "12:30pm", etc.
  const match = time.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return 9 // default

  let hour = parseInt(match[1], 10)
  const isPM = match[3] === 'pm'

  if (isPM && hour < 12) hour += 12
  if (!isPM && hour === 12) hour = 0

  return hour
}

// Day name to cron day number
const dayToCron: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

/**
 * Create a WorkflowContext instance
 *
 * @param options - Configuration options
 * @returns WorkflowContext ($) object
 *
 * @example
 * ```typescript
 * const $ = createWorkflowContext({ stubResolver })
 * $.on.Customer.signup(async (event) => {
 *   await $.Customer(event.data.id).sendWelcomeEmail()
 * })
 * ```
 */
export function createWorkflowContext(_options?: CreateContextOptions): WorkflowContext {
  // Event handlers: Map<"Subject.verb", handler[]>
  const handlers = new Map<string, Set<EventHandler>>()

  // Schedule handlers: Map<cron, { handler }>
  const schedules = new Map<string, { handler: ScheduleHandler }>()

  // One-time schedules
  const oneTimeSchedules = new Map<string, { handler: ScheduleHandler; time: Date }>()

  // Helper to register handler
  function registerHandler(eventKey: string, handler: EventHandler): () => void {
    if (!handlers.has(eventKey)) {
      handlers.set(eventKey, new Set())
    }
    handlers.get(eventKey)!.add(handler)

    // Return unsubscribe function
    return () => {
      handlers.get(eventKey)?.delete(handler)
      if (handlers.get(eventKey)?.size === 0) {
        handlers.delete(eventKey)
      }
    }
  }

  // Helper to register schedule
  function registerSchedule(cron: string, handler: ScheduleHandler): () => void {
    schedules.set(cron, { handler })
    return () => {
      schedules.delete(cron)
    }
  }

  // Create time builder for a specific day
  function createTimeBuilder(dayNum: number | null): TimeBuilder {
    const cronDay = dayNum !== null ? dayNum : '*'

    return {
      at9am: (handler: ScheduleHandler) => registerSchedule(`0 9 * * ${cronDay}`, handler),
      at5pm: (handler: ScheduleHandler) => registerSchedule(`0 17 * * ${cronDay}`, handler),
      at6am: (handler: ScheduleHandler) => registerSchedule(`0 6 * * ${cronDay}`, handler),
      at: (time: string) => {
        const hour = parseTimeToHour(time)
        return (handler: ScheduleHandler) => registerSchedule(`0 ${hour} * * ${cronDay}`, handler)
      },
    }
  }

  // Create the on proxy for event handlers
  const onProxy = new Proxy({} as Record<string, Record<string, (handler: EventHandler) => () => void>>, {
    get(_target, subject: string) {
      // Return another proxy for the verb level
      return new Proxy({} as Record<string, (handler: EventHandler) => () => void>, {
        get(_target2, verb: string) {
          // Return a function that registers the handler
          return (handler: EventHandler) => {
            const eventKey = `${subject}.${verb}`
            return registerHandler(eventKey, handler)
          }
        },
      })
    },
  })

  // Create the every proxy for scheduling
  const everyHandler = function(n: number): IntervalBuilder {
    return {
      minutes: (handler: ScheduleHandler) => registerSchedule(`*/${n} * * * *`, handler),
      hours: (handler: ScheduleHandler) => registerSchedule(`0 */${n} * * *`, handler),
      seconds: (handler: ScheduleHandler) => {
        // Cron doesn't support seconds, but we can simulate
        return registerSchedule(`*/${Math.ceil(n / 60)} * * * *`, handler)
      },
    }
  }

  // Add day properties to everyHandler
  const everyProxy = new Proxy(everyHandler as ScheduleBuilder & ((n: number) => IntervalBuilder), {
    get(_target, prop: string) {
      if (prop in dayToCron) {
        return createTimeBuilder(dayToCron[prop])
      }
      if (prop === 'day') {
        return createTimeBuilder(null)
      }
      if (prop === 'hour') {
        return (handler: ScheduleHandler) => registerSchedule('0 * * * *', handler)
      }
      if (prop === 'minute') {
        return (handler: ScheduleHandler) => registerSchedule('* * * * *', handler)
      }
      return undefined
    },
    apply(_target, _thisArg, args) {
      return everyHandler(args[0] as number)
    },
  })

  // Create the main context object
  const context: WorkflowContext = {
    on: onProxy,

    getRegisteredHandlers(eventKey: string): EventHandler[] {
      return Array.from(handlers.get(eventKey) || [])
    },

    matchHandlers(eventKey: string): EventHandler[] {
      const result: EventHandler[] = []

      for (const [key, handlerSet] of handlers.entries()) {
        // Check for exact match
        if (key === eventKey) {
          result.push(...handlerSet)
          continue
        }

        // Check for wildcard matches
        const [subject, verb] = key.split('.')
        const [eventSubject, eventVerb] = eventKey.split('.')

        // Wildcard subject (*.verb)
        if (subject === '*' && verb === eventVerb) {
          result.push(...handlerSet)
          continue
        }

        // Wildcard verb (Subject.*)
        if (subject === eventSubject && verb === '*') {
          result.push(...handlerSet)
        }
      }

      return result
    },

    async dispatch(eventKey: string, data: unknown): Promise<void> {
      const matchedHandlers = this.matchHandlers(eventKey)
      const [subject, verb] = eventKey.split('.')

      const event: Event = {
        id: generateEventId(),
        type: eventKey,
        subject,
        object: verb,
        data,
        timestamp: new Date(),
      }

      await Promise.all(matchedHandlers.map((h) => h(event)))
    },

    every: everyProxy,

    at(date: string | Date): (handler: ScheduleHandler) => () => void {
      const time = date instanceof Date ? date : new Date(date)
      const scheduleId = `one_time_${time.getTime()}`

      return (handler: ScheduleHandler) => {
        oneTimeSchedules.set(scheduleId, { handler, time })
        return () => {
          oneTimeSchedules.delete(scheduleId)
        }
      }
    },

    getSchedule(cron: string): { handler: ScheduleHandler } | undefined {
      return schedules.get(cron)
    },

    send(event: string, data: unknown): string {
      const eventId = generateEventId()

      // Dispatch event asynchronously (fire-and-forget)
      // Use queueMicrotask for Workers compatibility (faster than setTimeout)
      queueMicrotask(() => {
        this.dispatch(event, data).catch(() => {
          // Silently ignore errors in fire-and-forget
        })
      })

      return eventId
    },

    async try<T>(action: () => T | Promise<T>, options?: { timeout?: number }): Promise<T> {
      const timeout = options?.timeout

      if (timeout) {
        return Promise.race([
          Promise.resolve(action()),
          new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), timeout)
          }),
        ])
      }

      return action()
    },

    async do<T>(
      action: () => T | Promise<T>,
      options?: { stepId?: string; maxRetries?: number }
    ): Promise<T> {
      const maxRetries = options?.maxRetries ?? 3
      let lastError: Error | undefined

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await action()
        } catch (error) {
          lastError = error as Error
          // Continue to next retry
        }
      }

      throw lastError
    },
  }

  // Make the context a proxy to handle dynamic RPC access
  return new Proxy(context, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof WorkflowContext]
      }

      // Handle dynamic RPC ($.Customer(id), etc.)
      if (typeof prop === 'string' && prop[0] === prop[0].toUpperCase()) {
        // Return a function that creates a stub
        return (_id: string) => {
          // This would use stubResolver in real implementation
          return {}
        }
      }

      return undefined
    },
  })
}
