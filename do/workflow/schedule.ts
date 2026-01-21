/**
 * Schedule DSL for WorkflowContext
 *
 * Provides fluent scheduling API:
 * - $.every.Monday.at9am(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every(5).minutes(handler)
 * - $.every.week.on.Friday.at('3pm')(handler)
 *
 * Converts fluent DSL to CRON expressions internally
 *
 * @module do/workflow/schedule
 */

export type ScheduleHandler = () => Promise<void>

export interface ScheduleInterval {
  type: 'cron' | 'second' | 'minute' | 'hour' | 'day' | 'week'
  expression?: string
  value?: number
  natural?: string
}

export interface ScheduleRegistration {
  interval: ScheduleInterval
  handler: ScheduleHandler
  source: string
}

/**
 * Handler registration function type
 */
export type HandlerRegistrar = (handler: ScheduleHandler) => void

/**
 * Time builder interface - returns a handler registrar
 */
export interface TimeBuilder {
  (timeStr: string): HandlerRegistrar
}

/**
 * Interval builder for $.every(n).minutes/hours/etc pattern
 */
export interface IntervalBuilder {
  seconds: HandlerRegistrar
  minutes: HandlerRegistrar
  hours: HandlerRegistrar
  days: HandlerRegistrar
  weeks: HandlerRegistrar
}

/**
 * Named time accessor interface (at9am, at5pm, etc.)
 */
export interface TimeAccessors {
  at6am: HandlerRegistrar
  at7am: HandlerRegistrar
  at8am: HandlerRegistrar
  at9am: HandlerRegistrar
  at10am: HandlerRegistrar
  at11am: HandlerRegistrar
  at12pm: HandlerRegistrar
  atnoon: HandlerRegistrar
  at1pm: HandlerRegistrar
  at2pm: HandlerRegistrar
  at3pm: HandlerRegistrar
  at4pm: HandlerRegistrar
  at5pm: HandlerRegistrar
  at6pm: HandlerRegistrar
  at7pm: HandlerRegistrar
  at8pm: HandlerRegistrar
  at9pm: HandlerRegistrar
  atmidnight: HandlerRegistrar
}

/**
 * Day of week builder interface
 */
export interface DayBuilder extends TimeAccessors {
  at: TimeBuilder
}

/**
 * Days of week accessors
 */
export interface DayAccessors {
  Monday: DayBuilder
  Tuesday: DayBuilder
  Wednesday: DayBuilder
  Thursday: DayBuilder
  Friday: DayBuilder
  Saturday: DayBuilder
  Sunday: DayBuilder
}

/**
 * On builder for week.on.Friday pattern
 */
export interface OnBuilder extends DayAccessors {}

/**
 * Week builder with on accessor
 */
export interface WeekBuilder extends DayBuilder {
  on: OnBuilder
}

/**
 * Unit builder for time units (day, hour, etc.)
 */
export interface UnitBuilder extends DayBuilder {
  (handler: ScheduleHandler): void
}

/**
 * Main EveryProxy interface - the fluent scheduling DSL entry point
 */
export interface EveryProxy extends DayAccessors {
  // Direct time unit accessors that can be called as handlers or chained
  second: UnitBuilder
  minute: UnitBuilder
  hour: UnitBuilder
  day: UnitBuilder
  week: WeekBuilder
  month: UnitBuilder
  year: UnitBuilder

  // Common patterns
  weekday: UnitBuilder
  weekend: UnitBuilder
  midnight: UnitBuilder
  noon: UnitBuilder

  // Interval pattern: $.every(5).minutes(handler)
  (value: number): IntervalBuilder
}

/**
 * Well-known cron patterns for common schedules
 */
const KNOWN_PATTERNS = {
  // Time units
  second: '* * * * * *',
  minute: '* * * * *',
  hour: '0 * * * *',
  day: '0 0 * * *',
  week: '0 0 * * 0',
  month: '0 0 1 * *',
  year: '0 0 1 1 *',

  // Days of week
  Monday: '0 0 * * 1',
  Tuesday: '0 0 * * 2',
  Wednesday: '0 0 * * 3',
  Thursday: '0 0 * * 4',
  Friday: '0 0 * * 5',
  Saturday: '0 0 * * 6',
  Sunday: '0 0 * * 0',

  // Common patterns
  weekday: '0 0 * * 1-5',
  weekend: '0 0 * * 0,6',
  midnight: '0 0 * * *',
  noon: '0 12 * * *',
} as const

/**
 * Day of week to cron number mapping
 */
const DAY_OF_WEEK: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

/**
 * Named time patterns for shorthand access (at9am, at5pm, etc.)
 */
const TIME_PATTERNS: Record<string, { hour: number; minute: number }> = {
  at6am: { hour: 6, minute: 0 },
  at7am: { hour: 7, minute: 0 },
  at8am: { hour: 8, minute: 0 },
  at9am: { hour: 9, minute: 0 },
  at10am: { hour: 10, minute: 0 },
  at11am: { hour: 11, minute: 0 },
  at12pm: { hour: 12, minute: 0 },
  atnoon: { hour: 12, minute: 0 },
  at1pm: { hour: 13, minute: 0 },
  at2pm: { hour: 14, minute: 0 },
  at3pm: { hour: 15, minute: 0 },
  at4pm: { hour: 16, minute: 0 },
  at5pm: { hour: 17, minute: 0 },
  at6pm: { hour: 18, minute: 0 },
  at7pm: { hour: 19, minute: 0 },
  at8pm: { hour: 20, minute: 0 },
  at9pm: { hour: 21, minute: 0 },
  atmidnight: { hour: 0, minute: 0 },
}

/**
 * Parse time string like "6pm", "9am", "3:45pm" to hour and minute
 */
function parseTimeString(timeStr: string): { hour: number; minute: number } {
  const clean = timeStr.toLowerCase().trim()

  // Check for named patterns first
  const named = TIME_PATTERNS[`at${clean.replace(/[:\s]/g, '')}`]
  if (named) return named

  // Parse formats: "6pm", "9am", "3:45pm", "15:30"
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}. Use formats like "9am", "3:45pm", or "15:30"`)
  }

  const hourStr = match[1]
  if (!hourStr) {
    throw new Error(`Invalid time format: ${timeStr}. Use formats like "9am", "3:45pm", or "15:30"`)
  }
  let hour = parseInt(hourStr, 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]?.toLowerCase()

  if (meridiem === 'pm' && hour < 12) {
    hour += 12
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time: ${timeStr}`)
  }

  return { hour, minute }
}

/**
 * Combine a cron pattern with a specific time
 */
function combineWithTime(baseCron: string, time: { hour: number; minute: number }): string {
  const parts = baseCron.split(' ')
  // Cron format: minute hour day month weekday (5 parts)
  // We modify parts[0] and parts[1] - they must exist for a valid cron
  if (parts.length < 2) {
    throw new Error(`Invalid cron pattern: ${baseCron}`)
  }
  return [String(time.minute), String(time.hour), ...parts.slice(2)].join(' ')
}

/**
 * Options for creating an EveryProxy
 */
export interface CreateEveryProxyOptions {
  /**
   * Callback invoked when a schedule is registered.
   * Used to trigger alarm scheduling when schedules are added.
   */
  onScheduleRegistered?: (scheduleId: string, registration: ScheduleRegistration) => void
}

/**
 * Create the scheduling DSL proxy
 *
 * This creates a fluent API for scheduling that supports patterns like:
 * - $.every.Monday.at9am(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every(5).minutes(handler)
 * - $.every.week.on.Friday.at('3pm')(handler)
 *
 * @param schedules - Schedule registry map
 * @param options - Optional configuration including onScheduleRegistered callback
 * @returns EveryProxy for registering schedules
 *
 * @example
 * ```ts
 * const schedules = new Map()
 * const every = createEveryProxy(schedules, {
 *   onScheduleRegistered: (id, reg) => {
 *     console.log(`Registered schedule ${id}: ${reg.interval.natural}`)
 *   }
 * })
 *
 * every.Monday.at9am(async () => {
 *   console.log('Monday 9am task')
 * })
 *
 * every.day.at('6pm')(async () => {
 *   console.log('Daily 6pm task')
 * })
 *
 * every(5).minutes(async () => {
 *   console.log('Every 5 minutes')
 * })
 * ```
 */
export function createEveryProxy(
  schedules: Map<string, ScheduleRegistration>,
  options?: CreateEveryProxyOptions
): EveryProxy {
  const onScheduleRegistered = options?.onScheduleRegistered

  /**
   * Helper function to register a schedule and invoke the callback
   */
  function registerSchedule(registration: ScheduleRegistration): void {
    const id = `schedule-${schedules.size}`
    schedules.set(id, registration)
    // Invoke callback to trigger alarm scheduling
    if (onScheduleRegistered) {
      onScheduleRegistered(id, registration)
    }
  }

  /**
   * Builder state for chaining
   */
  interface BuilderState {
    path: string[]
    baseCron?: string
    dayOfWeek?: number
  }

  /**
   * Create a chainable proxy builder.
   * The actual runtime behavior is determined by the Proxy, but we cast to EveryProxy for type safety.
   */
  function createBuilder(state: BuilderState): EveryProxy {
    // Handler argument can be number, string, or function depending on DSL usage
    const builder = function(arg?: number | string | ScheduleHandler): void | IntervalBuilder | HandlerRegistrar {
      // If called with a number: $.every(5).minutes(handler)
      if (typeof arg === 'number') {
        return createIntervalProxy(arg)
      }

      // If called with a time string: $.every.day.at('6pm')(handler)
      if (typeof arg === 'string') {
        const time = parseTimeString(arg)
        const cron = combineWithTime(state.baseCron!, time)
        const natural = [...state.path, `at(${arg})`].join('.')

        return (handler: ScheduleHandler): void => {
          registerSchedule({
            interval: { type: 'cron', expression: cron, natural },
            handler,
            source: handler.toString(),
          })
        }
      }

      // If called as a handler: $.every.hour(handler)
      if (typeof arg === 'function') {
        const handler = arg as ScheduleHandler
        const natural = state.path.join('.')

        registerSchedule({
          interval: { type: 'cron', expression: state.baseCron!, natural },
          handler,
          source: handler.toString(),
        })
      }
    }

    return new Proxy(builder, {
      get(_target, prop: string): HandlerRegistrar | TimeBuilder | EveryProxy | OnBuilder | undefined {
        // Handle named time accessors: at9am, at5pm, etc.
        if (TIME_PATTERNS[prop]) {
          const time = TIME_PATTERNS[prop]
          const cron = combineWithTime(state.baseCron!, time)
          const natural = [...state.path, prop].join('.')

          return (handler: ScheduleHandler): void => {
            registerSchedule({
              interval: { type: 'cron', expression: cron, natural },
              handler,
              source: handler.toString(),
            })
          }
        }

        // Handle 'at' for dynamic time: $.every.day.at('6pm')
        if (prop === 'at') {
          return (timeStr: string): HandlerRegistrar => {
            const time = parseTimeString(timeStr)
            const cron = combineWithTime(state.baseCron!, time)
            const natural = [...state.path, `at(${timeStr})`].join('.')

            return (handler: ScheduleHandler): void => {
              registerSchedule({
                interval: { type: 'cron', expression: cron, natural },
                handler,
                source: handler.toString(),
              })
            }
          }
        }

        // Handle 'on' for week.on.Friday pattern
        if (prop === 'on') {
          const newState: BuilderState = { path: [...state.path, 'on'] }
          if (state.baseCron !== undefined) newState.baseCron = state.baseCron
          if (state.dayOfWeek !== undefined) newState.dayOfWeek = state.dayOfWeek
          return createBuilder(newState) as OnBuilder
        }

        // Handle days of week
        if (DAY_OF_WEEK[prop] !== undefined) {
          const dayNum = DAY_OF_WEEK[prop]
          const baseCron = `0 0 * * ${dayNum}`

          return createBuilder({
            path: [...state.path, prop],
            baseCron,
            dayOfWeek: dayNum,
          })
        }

        // Handle known patterns
        if (KNOWN_PATTERNS[prop as keyof typeof KNOWN_PATTERNS]) {
          return createBuilder({
            path: [...state.path, prop],
            baseCron: KNOWN_PATTERNS[prop as keyof typeof KNOWN_PATTERNS],
          })
        }

        // Unknown property - return builder for chaining
        const unknownState: BuilderState = { path: [...state.path, prop] }
        if (state.baseCron !== undefined) unknownState.baseCron = state.baseCron
        if (state.dayOfWeek !== undefined) unknownState.dayOfWeek = state.dayOfWeek
        return createBuilder(unknownState)
      },
    }) as EveryProxy
  }

  /**
   * Create a proxy for interval patterns: $.every(5).minutes(handler).
   */
  function createIntervalProxy(value: number): IntervalBuilder {
    return new Proxy({} as IntervalBuilder, {
      get(_target, prop: string): HandlerRegistrar | undefined {
        // Map plural forms to interval types
        const intervalMap: Record<string, ScheduleInterval['type']> = {
          seconds: 'second',
          minutes: 'minute',
          hours: 'hour',
          days: 'day',
          weeks: 'week',
        }

        const intervalType = intervalMap[prop]
        if (intervalType) {
          const natural = `${value} ${prop}`

          return (handler: ScheduleHandler): void => {
            registerSchedule({
              interval: { type: intervalType, value, natural },
              handler,
              source: handler.toString(),
            })
          }
        }

        return undefined
      },
    })
  }

  // Return the main proxy
  return createBuilder({ path: [] })
}

/**
 * Get all registered schedules
 *
 * @param schedules - Schedule registry map
 * @returns Array of schedule registration entries
 */
export function getSchedules(
  schedules: Map<string, ScheduleRegistration>
): ScheduleRegistration[] {
  return Array.from(schedules.values())
}

/**
 * Get schedule count
 *
 * @param schedules - Schedule registry map
 * @returns Number of registered schedules
 */
export function getScheduleCount(
  schedules: Map<string, ScheduleRegistration>
): number {
  return schedules.size
}

/**
 * Clear all schedules
 *
 * @param schedules - Schedule registry map
 */
export function clearSchedules(
  schedules: Map<string, ScheduleRegistration>
): void {
  schedules.clear()
}

/**
 * Execute a specific schedule by ID
 *
 * @param scheduleId - The schedule ID
 * @param schedules - Schedule registry map
 * @returns Promise resolving when handler completes
 */
export async function executeSchedule(
  scheduleId: string,
  schedules: Map<string, ScheduleRegistration>
): Promise<void> {
  const schedule = schedules.get(scheduleId)
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`)
  }
  await schedule.handler()
}
