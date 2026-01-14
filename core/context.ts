/**
 * @module core/context
 *
 * WorkflowContext factory for @dotdo/core
 *
 * Creates the $ context object that provides:
 * - $.on.Noun.verb(handler) - Event handler registration via Proxy
 * - $.every.day.at('time') - Schedule builder for crons
 * - $.track(event) - Track event for telemetry (fire-and-forget)
 * - $.send(event) - Fire-and-forget event dispatch (durable)
 * - $.try(action) - Single attempt action
 * - $.do(action) - Durable action with retries
 * - $.state, $.get(key), $.set(key, value) - State management
 */

// ============================================================================
// BASE EVENT TYPE (compatible with @org.ai/types)
// ============================================================================

/**
 * Base event structure for all domain events.
 */
export interface BaseEvent<TType extends string = string, TData = unknown> {
  /** Event type identifier (e.g., 'contact.created') */
  type: TType
  /** Event payload */
  data: TData
  /** When the event occurred */
  timestamp: Date
  /** Unique event ID */
  id?: string
  /** Additional context/metadata */
  metadata?: Record<string, unknown>
  /** Source that emitted the event */
  source?: string
  /** Correlation ID for tracking related events */
  correlationId?: string
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (
  event: BaseEvent<string, T>,
  ctx: WorkflowContext
) => void | Promise<void>

/**
 * Schedule handler function type
 */
export type ScheduleHandler = () => void | Promise<void>

/**
 * Handler registration with cleanup support
 */
export interface HandlerRegistration {
  handler: Function
  eventKey: string
  context?: string
  registeredAt: number
}

/**
 * Unsubscribe function returned when registering a handler
 */
export type Unsubscribe = () => boolean

/**
 * Options for event handler registration
 */
export interface HandlerOptions {
  /** Context identifier for grouped cleanup (e.g., DO namespace) */
  context?: string
  /** Priority for execution ordering (higher = runs first) */
  priority?: number
  /** Handler name for debugging */
  name?: string
}

/**
 * Retry policy for durable execution
 */
export interface RetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitter: boolean
}

/**
 * Options for $.try() execution
 */
export interface TryOptions {
  timeout?: number
}

/**
 * Options for $.do() durable execution
 */
export interface DoOptions {
  retry?: Partial<RetryPolicy>
  timeout?: number
  stepId?: string
}

// ============================================================================
// SCHEDULE BUILDER TYPES
// ============================================================================

interface ScheduleTimeProxy {
  (handler: ScheduleHandler): Unsubscribe
  at(time: string): (handler: ScheduleHandler) => Unsubscribe
  at6am: (handler: ScheduleHandler) => Unsubscribe
  at7am: (handler: ScheduleHandler) => Unsubscribe
  at8am: (handler: ScheduleHandler) => Unsubscribe
  at9am: (handler: ScheduleHandler) => Unsubscribe
  at10am: (handler: ScheduleHandler) => Unsubscribe
  at11am: (handler: ScheduleHandler) => Unsubscribe
  at12pm: (handler: ScheduleHandler) => Unsubscribe
  at1pm: (handler: ScheduleHandler) => Unsubscribe
  at2pm: (handler: ScheduleHandler) => Unsubscribe
  at3pm: (handler: ScheduleHandler) => Unsubscribe
  at4pm: (handler: ScheduleHandler) => Unsubscribe
  at5pm: (handler: ScheduleHandler) => Unsubscribe
  at6pm: (handler: ScheduleHandler) => Unsubscribe
  atnoon: (handler: ScheduleHandler) => Unsubscribe
  atmidnight: (handler: ScheduleHandler) => Unsubscribe
}

interface ScheduleBuilder {
  (schedule: string, handler: ScheduleHandler): Unsubscribe
  Monday: ScheduleTimeProxy
  Tuesday: ScheduleTimeProxy
  Wednesday: ScheduleTimeProxy
  Thursday: ScheduleTimeProxy
  Friday: ScheduleTimeProxy
  Saturday: ScheduleTimeProxy
  Sunday: ScheduleTimeProxy
  day: ScheduleTimeProxy
  weekday: ScheduleTimeProxy
  weekend: ScheduleTimeProxy
  hour: (handler: ScheduleHandler) => Unsubscribe
  minute: (handler: ScheduleHandler) => Unsubscribe
}

// ============================================================================
// ON PROXY TYPES
// ============================================================================

type OnNounProxy<Noun extends string = string> = {
  [verb: string]: (handler: EventHandler<unknown>, options?: HandlerOptions) => Unsubscribe
}

type OnProxy = {
  [Noun: string]: OnNounProxy<typeof Noun>
}

// ============================================================================
// WORKFLOW CONTEXT TYPE
// ============================================================================

/**
 * WorkflowContext ($) - The unified interface for all DO operations
 */
export interface WorkflowContext {
  /**
   * Track an event (fire and forget)
   * Best effort, no confirmation, swallows errors silently
   * Use for telemetry, analytics, non-critical logging
   */
  track: (event: string, data: unknown) => void

  /**
   * Send an event (durable)
   * Guaranteed delivery with retries, returns trackable EventId
   */
  send: <T = unknown>(event: string, data: T) => string

  /**
   * Try an action (fire and forget)
   * Single attempt, no retries
   */
  try: <T = unknown>(action: string, data: unknown, options?: TryOptions) => Promise<T>

  /**
   * Do an action (durable)
   * Retries on failure, guaranteed completion
   */
  do: <T = unknown>(action: string, data: unknown, options?: DoOptions) => Promise<T>

  /**
   * Event handler registry - $.on.Noun.verb(handler)
   */
  on: OnProxy

  /**
   * Scheduling registry - $.every.Monday.at9am(handler)
   */
  every: ScheduleBuilder

  /**
   * Current workflow state
   */
  state: Record<string, unknown>

  /**
   * Get a value from state
   */
  get: <T>(key: string) => T | undefined

  /**
   * Set a value in state
   */
  set: <T>(key: string, value: T) => void
}

// ============================================================================
// DAY AND TIME MAPPINGS
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
  weekday: '1-5',
  weekend: '0,6',
}

const TIMES: Record<string, { minute: string; hour: string }> = {
  at6am: { minute: '0', hour: '6' },
  at7am: { minute: '0', hour: '7' },
  at8am: { minute: '0', hour: '8' },
  at9am: { minute: '0', hour: '9' },
  at10am: { minute: '0', hour: '10' },
  at11am: { minute: '0', hour: '11' },
  at12pm: { minute: '0', hour: '12' },
  at1pm: { minute: '0', hour: '13' },
  at2pm: { minute: '0', hour: '14' },
  at3pm: { minute: '0', hour: '15' },
  at4pm: { minute: '0', hour: '16' },
  at5pm: { minute: '0', hour: '17' },
  at6pm: { minute: '0', hour: '18' },
  atnoon: { minute: '0', hour: '12' },
  atmidnight: { minute: '0', hour: '0' },
}

// ============================================================================
// TIME PARSING
// ============================================================================

/**
 * Parse a time string into minute and hour components.
 * Supports: 9am, 9:30pm, 14:30, noon, midnight
 */
function parseTime(timeStr: string): { minute: string; hour: string } {
  const lower = timeStr.toLowerCase().trim()

  if (lower === 'noon') return { minute: '0', hour: '12' }
  if (lower === 'midnight') return { minute: '0', hour: '0' }

  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`)
  }

  let hour = parseInt(match[1]!, 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      throw new Error(`Invalid hour for 12-hour format: ${hour}`)
    }
    if (meridiem === 'pm' && hour !== 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
  } else {
    if (hour < 0 || hour > 23) {
      throw new Error(`Invalid hour for 24-hour format: ${hour}`)
    }
  }

  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute: ${minute}`)
  }

  return { minute: String(minute), hour: String(hour) }
}

// ============================================================================
// CRON GENERATION
// ============================================================================

/**
 * Generate a cron expression for a day/time combination
 */
function toCron(day: string, time?: string | { minute: string; hour: string }): string {
  const dayNum = DAYS[day] ?? '*'

  if (day === 'hour') return '0 * * * *'
  if (day === 'minute') return '* * * * *'

  if (!time) return `0 0 * * ${dayNum}`

  if (typeof time === 'string') {
    const timeInfo = TIMES[time]
    if (timeInfo) {
      return `${timeInfo.minute} ${timeInfo.hour} * * ${dayNum}`
    }
    const parsed = parseTime(time)
    return `${parsed.minute} ${parsed.hour} * * ${dayNum}`
  }

  return `${time.minute} ${time.hour} * * ${dayNum}`
}

/**
 * Parse natural language schedule to cron expression
 */
function parseNaturalSchedule(schedule: string): string {
  const lower = schedule.toLowerCase().trim()

  // Every N minutes
  const everyMinutesMatch = lower.match(/every\s+(\d+)\s+minutes?/)
  if (everyMinutesMatch) {
    const interval = parseInt(everyMinutesMatch[1]!, 10)
    if (interval < 1 || interval > 59) throw new Error(`Invalid minute interval: ${interval}`)
    return `*/${interval} * * * *`
  }

  // Every N hours
  const everyHoursMatch = lower.match(/every\s+(\d+)\s+hours?/)
  if (everyHoursMatch) {
    const interval = parseInt(everyHoursMatch[1]!, 10)
    if (interval < 1 || interval > 23) throw new Error(`Invalid hour interval: ${interval}`)
    return `0 */${interval} * * *`
  }

  // Every hour / minute
  if (lower === 'every hour' || lower === 'hourly') return '0 * * * *'
  if (lower === 'every minute') return '* * * * *'

  // Daily at TIME
  const dailyMatch = lower.match(/(?:daily|everyday|every\s+day)\s+at\s+(.+)/)
  if (dailyMatch) {
    const time = parseTime(dailyMatch[1]!)
    return `${time.minute} ${time.hour} * * *`
  }

  // Weekdays at TIME
  const weekdaysMatch = lower.match(/(?:every\s+)?weekdays?\s+at\s+(.+)/)
  if (weekdaysMatch) {
    const time = parseTime(weekdaysMatch[1]!)
    return `${time.minute} ${time.hour} * * 1-5`
  }

  // DAY at TIME
  const dayTimeMatch = lower.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(.+)/)
  if (dayTimeMatch) {
    const dayName = dayTimeMatch[1]!.charAt(0).toUpperCase() + dayTimeMatch[1]!.slice(1)
    const dayNum = DAYS[dayName]
    const time = parseTime(dayTimeMatch[2]!)
    return `${time.minute} ${time.hour} * * ${dayNum}`
  }

  throw new Error(`Unrecognized schedule format: ${schedule}`)
}

// ============================================================================
// WORKFLOW CONTEXT CONFIGURATION
// ============================================================================

/**
 * Configuration for creating a WorkflowContext
 */
export interface WorkflowContextConfig {
  /** Namespace/context identifier for handler cleanup */
  namespace?: string

  /** Callback when schedule is registered */
  onScheduleRegistered?: (cron: string, name: string, handler: ScheduleHandler) => void

  /** Callback when event handler is registered */
  onEventRegistered?: (eventKey: string, handler: EventHandler) => void

  /** Action executor for $.try() */
  tryExecutor?: <T>(action: string, data: unknown, options?: TryOptions) => Promise<T>

  /** Durable action executor for $.do() */
  doExecutor?: <T>(action: string, data: unknown, options?: DoOptions) => Promise<T>

  /** Event sender for $.send() */
  sendEvent?: <T>(event: string, data: T) => string

  /** Event tracker for $.track() */
  trackEvent?: (event: string, data: unknown) => void
}

// ============================================================================
// WORKFLOW CONTEXT FACTORY
// ============================================================================

/**
 * Create a WorkflowContext ($) instance.
 *
 * The WorkflowContext provides the unified interface for:
 * - Event handling via $.on.Noun.verb(handler)
 * - Scheduling via $.every.day.at('9am')(handler)
 * - State management via $.state, $.get(), $.set()
 * - Event dispatch via $.send() and $.track()
 * - Action execution via $.try() and $.do()
 *
 * @example
 * ```typescript
 * const $ = createWorkflowContext({
 *   namespace: 'my-workflow',
 *   onScheduleRegistered: (cron, name, handler) => {
 *     console.log(`Schedule registered: ${cron}`)
 *   }
 * })
 *
 * // Register event handlers
 * $.on.Customer.created((event) => {
 *   console.log('Customer created:', event.data)
 * })
 *
 * // Schedule recurring tasks
 * $.every.Monday.at9am(() => {
 *   console.log('Weekly report time!')
 * })
 *
 * // State management
 * $.set('counter', 0)
 * const count = $.get<number>('counter')
 * ```
 */
export function createWorkflowContext(config: WorkflowContextConfig = {}): WorkflowContext {
  const {
    namespace,
    onScheduleRegistered,
    onEventRegistered,
    tryExecutor,
    doExecutor,
    sendEvent,
    trackEvent,
  } = config

  // Internal state
  const state: Record<string, unknown> = {}
  const eventHandlers = new Map<string, HandlerRegistration[]>()

  // Generate unique ID for events
  let eventCounter = 0
  const generateEventId = () => `evt_${Date.now().toString(36)}_${(++eventCounter).toString(36)}`

  // Generate schedule name
  const generateScheduleName = (cron: string) => {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 6)
    return `schedule-${timestamp}-${random}`
  }

  /**
   * Register an event handler
   */
  function registerHandler(eventKey: string, handler: Function, context?: string): Unsubscribe {
    const registrations = eventHandlers.get(eventKey) || []

    const registration: HandlerRegistration = {
      handler,
      eventKey,
      context: context ?? namespace,
      registeredAt: Date.now(),
    }

    registrations.push(registration)
    eventHandlers.set(eventKey, registrations)

    if (onEventRegistered) {
      onEventRegistered(eventKey, handler as EventHandler)
    }

    // Return unsubscribe function
    return () => {
      const regs = eventHandlers.get(eventKey)
      if (!regs) return false
      const index = regs.findIndex(r => r.handler === handler)
      if (index === -1) return false
      regs.splice(index, 1)
      if (regs.length === 0) eventHandlers.delete(eventKey)
      return true
    }
  }

  /**
   * Register a schedule handler
   */
  function registerSchedule(cron: string, handler: ScheduleHandler): Unsubscribe {
    const name = generateScheduleName(cron)
    const eventKey = `schedule:${cron}`

    if (onScheduleRegistered) {
      onScheduleRegistered(cron, name, handler)
    }

    return registerHandler(eventKey, handler, namespace)
  }

  // ============================================================================
  // CREATE ON PROXY
  // ============================================================================

  const on: OnProxy = new Proxy({} as OnProxy, {
    get(_, noun: string) {
      return new Proxy({} as OnNounProxy, {
        get(_, verb: string) {
          return (handler: EventHandler, options?: HandlerOptions): Unsubscribe => {
            return registerHandler(`${noun}.${verb}`, handler, options?.context ?? namespace)
          }
        },
      })
    },
  })

  // ============================================================================
  // CREATE EVERY PROXY (Schedule Builder)
  // ============================================================================

  /**
   * Create a time proxy for a specific day
   */
  function createTimeProxy(day: string): ScheduleTimeProxy {
    const baseHandler = (handler: ScheduleHandler): Unsubscribe => {
      const cron = toCron(day)
      return registerSchedule(cron, handler)
    }

    return new Proxy(baseHandler as ScheduleTimeProxy, {
      get(_, prop: string) {
        // Handle .at('time') method
        if (prop === 'at') {
          return (time: string) => (handler: ScheduleHandler): Unsubscribe => {
            const cron = toCron(day, time)
            return registerSchedule(cron, handler)
          }
        }

        // Handle preset times like at9am, atnoon
        if (TIMES[prop]) {
          return (handler: ScheduleHandler): Unsubscribe => {
            const cron = toCron(day, prop)
            return registerSchedule(cron, handler)
          }
        }

        return undefined
      },
    })
  }

  const baseEveryHandler = (schedule: string, handler: ScheduleHandler): Unsubscribe => {
    const cron = parseNaturalSchedule(schedule)
    return registerSchedule(cron, handler)
  }

  const every: ScheduleBuilder = new Proxy(baseEveryHandler as ScheduleBuilder, {
    get(_, prop: string) {
      // Handle interval shortcuts
      if (prop === 'hour') {
        return (handler: ScheduleHandler): Unsubscribe => {
          return registerSchedule('0 * * * *', handler)
        }
      }

      if (prop === 'minute') {
        return (handler: ScheduleHandler): Unsubscribe => {
          return registerSchedule('* * * * *', handler)
        }
      }

      // Handle day names and special days
      if (DAYS[prop] !== undefined) {
        return createTimeProxy(prop)
      }

      return undefined
    },
  })

  // ============================================================================
  // CREATE WORKFLOW CONTEXT
  // ============================================================================

  const ctx: WorkflowContext = {
    // Event tracking (fire-and-forget telemetry)
    track: (event: string, data: unknown) => {
      if (trackEvent) {
        try {
          trackEvent(event, data)
        } catch {
          // Swallow errors for fire-and-forget
        }
      }
    },

    // Event sending (durable)
    send: <T = unknown>(event: string, data: T): string => {
      if (sendEvent) {
        return sendEvent(event, data)
      }
      // Default: generate event ID but don't persist
      return generateEventId()
    },

    // Try action (single attempt)
    try: async <T = unknown>(action: string, data: unknown, options?: TryOptions): Promise<T> => {
      if (tryExecutor) {
        return tryExecutor<T>(action, data, options)
      }
      throw new Error(`No executor configured for $.try('${action}')`)
    },

    // Do action (durable with retries)
    do: async <T = unknown>(action: string, data: unknown, options?: DoOptions): Promise<T> => {
      if (doExecutor) {
        return doExecutor<T>(action, data, options)
      }
      throw new Error(`No executor configured for $.do('${action}')`)
    },

    // Event handlers
    on,

    // Scheduling
    every,

    // State management
    state,

    get: <T>(key: string): T | undefined => {
      return state[key] as T | undefined
    },

    set: <T>(key: string, value: T): void => {
      state[key] = value
    },
  }

  return ctx
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Get registered handlers for an event key (for testing/debugging)
 */
export function getHandlers(ctx: WorkflowContext, eventKey: string): Function[] {
  // This would need access to internal state - keeping for API completeness
  // In practice, the DO will maintain its own handler registry
  return []
}

/**
 * Dispatch an event to registered handlers (for testing/debugging)
 */
export async function dispatchEvent(
  ctx: WorkflowContext,
  noun: string,
  verb: string,
  data: unknown
): Promise<{ handled: number; errors: Error[] }> {
  // This would need access to internal state - keeping for API completeness
  // In practice, the DO will handle event dispatch
  return { handled: 0, errors: [] }
}
