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
 * @returns EveryProxy for registering schedules
 *
 * @example
 * ```ts
 * const schedules = new Map()
 * const every = createEveryProxy(schedules)
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
/**
 * Interval builder type for $.every(5).minutes patterns
 */
export interface IntervalBuilder {
  seconds: (handler: ScheduleHandler) => void
  minutes: (handler: ScheduleHandler) => void
  hours: (handler: ScheduleHandler) => void
  days: (handler: ScheduleHandler) => void
  weeks: (handler: ScheduleHandler) => void
}

/**
 * Schedule builder type returned by createEveryProxy.
 * Uses Proxy for fluent DSL so returns a callable object with dynamic properties.
 * The actual implementation uses Proxy to enable dynamic property access.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScheduleBuilder = ((arg?: number | string | ScheduleHandler) => any) & Record<string, any>

export function createEveryProxy(
  schedules: Map<string, ScheduleRegistration>
): ScheduleBuilder {
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
   * Returns ScheduleBuilder which is a complex callable+indexable object via Proxy.
   */
  function createBuilder(state: BuilderState): ScheduleBuilder {
    const builder = function(arg?: number | string | ScheduleHandler) {
      // If called with a number: $.every(5).minutes(handler)
      if (typeof arg === 'number') {
        return createIntervalProxy(arg, state)
      }

      // If called with a time string: $.every.day.at('6pm')(handler)
      if (typeof arg === 'string') {
        const time = parseTimeString(arg)
        const cron = combineWithTime(state.baseCron!, time)
        const natural = [...state.path, `at(${arg})`].join('.')

        return (handler: ScheduleHandler) => {
          const id = `schedule-${schedules.size}`
          schedules.set(id, {
            interval: { type: 'cron', expression: cron, natural },
            handler,
            source: handler.toString(),
          })
        }
      }

      // If called as a handler: $.every.hour(handler)
      if (typeof arg === 'function') {
        const handler = arg as ScheduleHandler
        const id = `schedule-${schedules.size}`
        const natural = state.path.join('.')

        schedules.set(id, {
          interval: { type: 'cron', expression: state.baseCron!, natural },
          handler,
          source: handler.toString(),
        })
      }
    }

    return new Proxy(builder, {
      get(_target, prop: string) {
        // Handle named time accessors: at9am, at5pm, etc.
        if (TIME_PATTERNS[prop]) {
          const time = TIME_PATTERNS[prop]
          const cron = combineWithTime(state.baseCron!, time)
          const natural = [...state.path, prop].join('.')

          return (handler: ScheduleHandler) => {
            const id = `schedule-${schedules.size}`
            schedules.set(id, {
              interval: { type: 'cron', expression: cron, natural },
              handler,
              source: handler.toString(),
            })
          }
        }

        // Handle 'at' for dynamic time: $.every.day.at('6pm')
        if (prop === 'at') {
          return (timeStr: string) => {
            const time = parseTimeString(timeStr)
            const cron = combineWithTime(state.baseCron!, time)
            const natural = [...state.path, `at(${timeStr})`].join('.')

            return (handler: ScheduleHandler) => {
              const id = `schedule-${schedules.size}`
              schedules.set(id, {
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
          return createBuilder(newState)
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
        if (KNOWN_PATTERNS[prop]) {
          return createBuilder({
            path: [...state.path, prop],
            baseCron: KNOWN_PATTERNS[prop],
          })
        }

        // Unknown property - return builder for chaining
        const unknownState: BuilderState = { path: [...state.path, prop] }
        if (state.baseCron !== undefined) unknownState.baseCron = state.baseCron
        if (state.dayOfWeek !== undefined) unknownState.dayOfWeek = state.dayOfWeek
        return createBuilder(unknownState)
      },
    })
  }

  /**
   * Create a proxy for interval patterns: $.every(5).minutes(handler)
   */
  function createIntervalProxy(value: number, _state: BuilderState): IntervalBuilder {
    return new Proxy({}, {
      get(_target, prop: string) {
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

          return (handler: ScheduleHandler) => {
            const id = `schedule-${schedules.size}`
            schedules.set(id, {
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
