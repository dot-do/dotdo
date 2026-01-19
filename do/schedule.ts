/**
 * Schedule DSL for @dotdo/do package
 *
 * Provides fluent scheduling API:
 * - $.every.Monday.at9am(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every(5).minutes(handler)
 * - $.every.week.on.Friday.at('3pm')(handler)
 *
 * Converts fluent DSL to CRON expressions internally
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
const KNOWN_PATTERNS: Record<string, string> = {
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
}

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

  let hour = parseInt(match[1], 10)
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
  parts[0] = String(time.minute)
  parts[1] = String(time.hour)
  return parts.join(' ')
}

/**
 * Create the scheduling DSL proxy
 */
export function createEveryProxy(
  schedules: Map<string, ScheduleRegistration>
): any {
  /**
   * Builder state for chaining
   */
  interface BuilderState {
    path: string[]
    baseCron?: string
    dayOfWeek?: number
  }

  /**
   * Create a chainable proxy builder
   */
  function createBuilder(state: BuilderState): any {
    const builder = function(arg?: any) {
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
          return createBuilder({
            path: [...state.path, 'on'],
            baseCron: state.baseCron,
            dayOfWeek: state.dayOfWeek,
          })
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
        return createBuilder({
          path: [...state.path, prop],
          baseCron: state.baseCron,
          dayOfWeek: state.dayOfWeek,
        })
      },
    })
  }

  /**
   * Create a proxy for interval patterns: $.every(5).minutes(handler)
   */
  function createIntervalProxy(value: number, state: BuilderState): any {
    return new Proxy({}, {
      get(_target, prop: string) {
        // Map plural forms to interval types
        const intervalMap: Record<string, string> = {
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
              interval: { type: intervalType as any, value, natural },
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
