/**
 * Schedule Builder - Fluent API for $.every scheduling
 *
 * Creates a proxy that converts fluent scheduling syntax to cron expressions
 * and registers schedules with the ScheduleManager.
 *
 * Supports:
 * - $.every.Monday.at9am(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every('every 5 minutes', handler)
 *
 * Converts to cron and registers with DO alarm API.
 */

/// <reference types="@cloudflare/workers-types" />

import type { ScheduleHandler } from '../types/WorkflowContext'

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ScheduleBuilderConfig {
  state: DurableObjectState
  onScheduleRegistered?: (cron: string, name: string, handler: ScheduleHandler) => void
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
 * Parse a time string like '9am', '9:30am', 'noon', 'midnight'
 * Returns { minute, hour }
 */
function parseTime(timeStr: string): { minute: string; hour: string } {
  const lower = timeStr.toLowerCase().trim()

  // Handle special cases
  if (lower === 'noon') {
    return { minute: '0', hour: '12' }
  }
  if (lower === 'midnight') {
    return { minute: '0', hour: '0' }
  }

  // Match patterns like '9am', '9:30am', '9pm', '14:30'
  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`)
  }

  let hour = parseInt(match[1]!, 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]

  // Validate hour based on format
  if (meridiem) {
    // 12-hour format
    if (hour < 1 || hour > 12) {
      throw new Error(`Invalid hour for 12-hour format: ${hour}`)
    }
    if (meridiem === 'pm' && hour !== 12) {
      hour += 12
    }
    if (meridiem === 'am' && hour === 12) {
      hour = 0
    }
  } else {
    // 24-hour format
    if (hour < 0 || hour > 23) {
      throw new Error(`Invalid hour for 24-hour format: ${hour}`)
    }
  }

  // Validate minute
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute: ${minute}`)
  }

  return { minute: String(minute), hour: String(hour) }
}

// ============================================================================
// NATURAL LANGUAGE PARSING
// ============================================================================

/**
 * Parse natural language schedule strings
 * - 'every 5 minutes' -> '* /5 * * * *'
 * - 'every hour' -> '0 * * * *'
 * - 'daily at 9am' -> '0 9 * * *'
 * - 'Monday at 9am' -> '0 9 * * 1'
 * - 'weekdays at 8:30am' -> '30 8 * * 1-5'
 */
function parseNaturalSchedule(schedule: string): string {
  const lower = schedule.toLowerCase().trim()

  // Match 'every N minutes'
  const everyMinutesMatch = lower.match(/every\s+(\d+)\s+minutes?/)
  if (everyMinutesMatch) {
    const interval = parseInt(everyMinutesMatch[1]!, 10)
    if (interval < 1 || interval > 59) {
      throw new Error(`Invalid minute interval: ${interval}`)
    }
    return `*/${interval} * * * *`
  }

  // Match 'every hour'
  if (lower === 'every hour' || lower === 'hourly') {
    return '0 * * * *'
  }

  // Match 'every minute'
  if (lower === 'every minute') {
    return '* * * * *'
  }

  // Match 'daily at TIME' or 'everyday at TIME'
  const dailyMatch = lower.match(/(?:daily|everyday)\s+at\s+(.+)/)
  if (dailyMatch) {
    const time = parseTime(dailyMatch[1]!)
    return `${time.minute} ${time.hour} * * *`
  }

  // Match 'weekdays at TIME'
  const weekdaysMatch = lower.match(/weekdays?\s+at\s+(.+)/)
  if (weekdaysMatch) {
    const time = parseTime(weekdaysMatch[1]!)
    return `${time.minute} ${time.hour} * * 1-5`
  }

  // Match 'weekends at TIME'
  const weekendsMatch = lower.match(/weekends?\s+at\s+(.+)/)
  if (weekendsMatch) {
    const time = parseTime(weekendsMatch[1]!)
    return `${time.minute} ${time.hour} * * 0,6`
  }

  // Match 'DAY at TIME'
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
// CRON GENERATION
// ============================================================================

/**
 * Generate a cron expression for a day/time combination
 */
function toCron(day: string, time?: string | { minute: string; hour: string }): string {
  const dayNum = DAYS[day] ?? '*'

  // Handle interval shortcuts
  if (day === 'hour') {
    return '0 * * * *'
  }
  if (day === 'minute') {
    return '* * * * *'
  }

  // If no time specified, default to midnight
  if (!time) {
    return `0 0 * * ${dayNum}`
  }

  // If time is a string (from TIMES lookup or .at() method)
  if (typeof time === 'string') {
    const timeInfo = TIMES[time]
    if (timeInfo) {
      return `${timeInfo.minute} ${timeInfo.hour} * * ${dayNum}`
    }
    // Parse the time string
    const parsed = parseTime(time)
    return `${parsed.minute} ${parsed.hour} * * ${dayNum}`
  }

  // Time is already parsed
  return `${time.minute} ${time.hour} * * ${dayNum}`
}

/**
 * Generate a unique schedule name
 */
function generateScheduleName(cron: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 6)
  return `schedule-${timestamp}-${random}`
}

// ============================================================================
// SCHEDULE BUILDER PROXY
// ============================================================================

export interface ScheduleTimeProxy {
  (handler: ScheduleHandler): void
  at(time: string): (handler: ScheduleHandler) => void
  at6am: (handler: ScheduleHandler) => void
  at7am: (handler: ScheduleHandler) => void
  at8am: (handler: ScheduleHandler) => void
  at9am: (handler: ScheduleHandler) => void
  at10am: (handler: ScheduleHandler) => void
  at11am: (handler: ScheduleHandler) => void
  at12pm: (handler: ScheduleHandler) => void
  at1pm: (handler: ScheduleHandler) => void
  at2pm: (handler: ScheduleHandler) => void
  at3pm: (handler: ScheduleHandler) => void
  at4pm: (handler: ScheduleHandler) => void
  at5pm: (handler: ScheduleHandler) => void
  at6pm: (handler: ScheduleHandler) => void
  atnoon: (handler: ScheduleHandler) => void
  atmidnight: (handler: ScheduleHandler) => void
}

export interface ScheduleBuilderProxy {
  (schedule: string, handler: ScheduleHandler): void
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
  hour: (handler: ScheduleHandler) => void
  minute: (handler: ScheduleHandler) => void
}

/**
 * Create a schedule builder proxy for $.every
 */
export function createScheduleBuilderProxy(config: ScheduleBuilderConfig): ScheduleBuilderProxy {
  const { state, onScheduleRegistered } = config

  /**
   * Register a schedule - stores cron and sets alarm
   */
  const registerSchedule = async (cron: string, handler: ScheduleHandler): Promise<void> => {
    const name = generateScheduleName(cron)

    // Notify callback if provided
    if (onScheduleRegistered) {
      onScheduleRegistered(cron, name, handler)
    }

    // Set alarm for next occurrence
    // This requires calculating the next run time from the cron expression
    // For now, we'll use a simple approach - in production, this would use getNextRunTime
    const nextRun = calculateNextRun(cron)
    if (nextRun) {
      await state.storage.setAlarm(nextRun)
    }
  }

  /**
   * Calculate next run time from cron expression
   * Simplified version - for full implementation, use getNextRunTime from ScheduleManager
   */
  const calculateNextRun = (cron: string): Date | null => {
    // Parse cron: minute hour dayOfMonth month dayOfWeek
    const parts = cron.split(' ')
    if (parts.length !== 5) return null

    const [minutePart, hourPart, , , dayOfWeekPart] = parts

    const now = new Date()
    let nextRun = new Date(now)

    // Start from next minute
    nextRun.setUTCSeconds(0, 0)
    nextRun.setUTCMinutes(nextRun.getUTCMinutes() + 1)

    // Simple iteration to find next match (max 1 week)
    const maxIterations = 60 * 24 * 7 // 1 week of minutes
    for (let i = 0; i < maxIterations; i++) {
      const minute = nextRun.getUTCMinutes()
      const hour = nextRun.getUTCHours()
      const dayOfWeek = nextRun.getUTCDay()

      if (
        matchesCronField(minute, minutePart!) &&
        matchesCronField(hour, hourPart!) &&
        matchesCronField(dayOfWeek, dayOfWeekPart!)
      ) {
        return nextRun
      }

      nextRun = new Date(nextRun.getTime() + 60000) // Add 1 minute
    }

    return null
  }

  /**
   * Check if a value matches a cron field
   */
  const matchesCronField = (value: number, field: string): boolean => {
    if (field === '*') return true

    // Handle step values like */5
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10)
      return value % step === 0
    }

    // Handle ranges like 1-5
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number)
      return value >= start! && value <= end!
    }

    // Handle lists like 0,6
    if (field.includes(',')) {
      const values = field.split(',').map(Number)
      return values.includes(value)
    }

    // Single value
    return value === parseInt(field, 10)
  }

  /**
   * Create a time proxy for a specific day
   */
  const createTimeProxy = (day: string): ScheduleTimeProxy => {
    const baseHandler = (handler: ScheduleHandler): void => {
      const cron = toCron(day)
      registerSchedule(cron, handler)
    }

    return new Proxy(baseHandler as ScheduleTimeProxy, {
      get(_, prop: string) {
        // Handle .at('time') method
        if (prop === 'at') {
          return (time: string) => (handler: ScheduleHandler) => {
            const cron = toCron(day, time)
            registerSchedule(cron, handler)
          }
        }

        // Handle preset times like at9am, atnoon
        if (TIMES[prop]) {
          return (handler: ScheduleHandler) => {
            const cron = toCron(day, prop)
            registerSchedule(cron, handler)
          }
        }

        return undefined
      },
    })
  }

  // Main proxy handler
  const baseHandler = (schedule: string, handler: ScheduleHandler): void => {
    const cron = parseNaturalSchedule(schedule)
    registerSchedule(cron, handler)
  }

  return new Proxy(baseHandler as ScheduleBuilderProxy, {
    get(_, prop: string) {
      // Handle interval shortcuts
      if (prop === 'hour') {
        return (handler: ScheduleHandler) => {
          const cron = '0 * * * *'
          registerSchedule(cron, handler)
        }
      }

      if (prop === 'minute') {
        return (handler: ScheduleHandler) => {
          const cron = '* * * * *'
          registerSchedule(cron, handler)
        }
      }

      // Handle day names and special days
      if (DAYS[prop] !== undefined) {
        return createTimeProxy(prop)
      }

      return undefined
    },
  })
}

export default createScheduleBuilderProxy
