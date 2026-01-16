/**
 * Schedule Manager Module - Alarm scheduling and CRON DSL
 *
 * This module contains:
 * - Schedule entry types
 * - Time parsing utilities
 * - Schedule builder types (every.day.at, every.hour, etc.)
 * - ScheduleManager class for managing scheduled tasks
 */

// ============================================================================
// Types
// ============================================================================

/**
 * ScheduleHandler - Typed handler for scheduled tasks
 */
export type ScheduleHandler = () => void | Promise<void>

/**
 * Entry in the schedule registry
 */
export interface ScheduleEntry {
  handler: ScheduleHandler
  cron: string
}

/**
 * Time builder interface for day.at() style scheduling
 */
export interface TimeBuilder {
  at9am: (handler: ScheduleHandler) => () => void
  at5pm: (handler: ScheduleHandler) => () => void
  at6am: (handler: ScheduleHandler) => () => void
  at: (time: string) => (handler: ScheduleHandler) => () => void
}

/**
 * Schedule builder interface for every.X style scheduling
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
 * Interval builder interface for every(n).X style scheduling
 */
export interface IntervalBuilder {
  minutes: (handler: ScheduleHandler) => () => void
  hours: (handler: ScheduleHandler) => () => void
  seconds: (handler: ScheduleHandler) => () => void
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Day of week mapping for CRON expressions
 */
export const DAY_MAP: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a time string into hour and minute components
 * Supports formats: "9am", "9:30am", "17:00", "noon", "midnight"
 *
 * @param time Time string to parse
 * @returns Object with hour (0-23) and minute (0-59)
 * @throws Error if time format is invalid
 */
export function parseTime(time: string): { hour: number; minute: number } {
  if (time === 'noon') return { hour: 12, minute: 0 }
  if (time === 'midnight') return { hour: 0, minute: 0 }

  const match = time.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i)
  if (!match) {
    throw new Error(`Invalid time format: ${time}`)
  }

  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const period = match[3]?.toLowerCase()

  // Validate minutes range (0-59)
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid time format: ${time}`)
  }

  // Validate hour based on format
  if (period) {
    // AM/PM format: hour must be 1-12
    if (hour < 1 || hour > 12) {
      throw new Error(`Invalid time format: ${time}`)
    }
  } else {
    // 24-hour format: hour must be 0-23
    if (hour < 0 || hour > 23) {
      throw new Error(`Invalid time format: ${time}`)
    }
  }

  if (period === 'pm' && hour < 12) {
    hour += 12
  } else if (period === 'am' && hour === 12) {
    hour = 0
  }

  return { hour, minute }
}

// ============================================================================
// Schedule Manager Class
// ============================================================================

/**
 * ScheduleManager handles scheduled task registration and CRON DSL
 * This is a helper class that DOCore uses to manage the scheduling system
 */
export class ScheduleManager {
  private schedules: Map<string, ScheduleEntry> = new Map()

  constructor(private ctx: DurableObjectState) {}

  /**
   * Initialize the schedules table in SQLite
   */
  initTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        cron TEXT PRIMARY KEY,
        handler_id TEXT,
        registered_at INTEGER
      )
    `)
  }

  /**
   * Register a scheduled handler
   * @param cron CRON expression or special interval string
   * @param handler Function to call when scheduled
   * @returns Unsubscribe function
   */
  registerSchedule(cron: string, handler: ScheduleHandler): () => void {
    this.schedules.set(cron, { handler, cron })

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO schedules (cron, handler_id, registered_at) VALUES (?, ?, ?)`,
      cron,
      `handler_${Date.now()}`,
      Date.now()
    )

    return () => {
      this.schedules.delete(cron)
      this.ctx.storage.sql.exec(`DELETE FROM schedules WHERE cron = ?`, cron)
    }
  }

  /**
   * Get a registered schedule by CRON expression
   */
  getSchedule(cron: string): ScheduleEntry | undefined {
    return this.schedules.get(cron)
  }

  /**
   * Clear all schedules (for eviction simulation)
   */
  clearSchedules(): void {
    this.schedules.clear()
  }

  /**
   * Create the schedule builder DSL
   * Usage: every.day.at('9am')(handler), every(5).minutes(handler)
   */
  createEveryBuilder(): ScheduleBuilder & ((n: number) => IntervalBuilder) {
    const self = this

    function createTimeBuilder(dayOfWeek: string | null): TimeBuilder {
      const dow = dayOfWeek ? DAY_MAP[dayOfWeek] : '*'

      const shortcuts: Record<string, { hour: number; minute: number }> = {
        at9am: { hour: 9, minute: 0 },
        at5pm: { hour: 17, minute: 0 },
        at6am: { hour: 6, minute: 0 },
      }

      return new Proxy({} as TimeBuilder, {
        get(_target, prop: string) {
          if (prop === 'at') {
            return (time: string) => {
              return (handler: ScheduleHandler): (() => void) => {
                const { hour, minute } = parseTime(time)
                return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
              }
            }
          }

          if (shortcuts[prop]) {
            return (handler: ScheduleHandler): (() => void) => {
              const { hour, minute } = shortcuts[prop]
              return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
            }
          }

          return undefined
        },
      })
    }

    const scheduleBuilder: ScheduleBuilder = {
      Monday: createTimeBuilder('Monday'),
      Tuesday: createTimeBuilder('Tuesday'),
      Wednesday: createTimeBuilder('Wednesday'),
      Thursday: createTimeBuilder('Thursday'),
      Friday: createTimeBuilder('Friday'),
      Saturday: createTimeBuilder('Saturday'),
      Sunday: createTimeBuilder('Sunday'),
      day: createTimeBuilder(null),
      hour: (handler: ScheduleHandler): (() => void) => self.registerSchedule('0 * * * *', handler),
      minute: (handler: ScheduleHandler): (() => void) => self.registerSchedule('* * * * *', handler),
    }

    const everyFn = (n: number): IntervalBuilder => {
      return {
        minutes: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`*/${n} * * * *`, handler),
        hours: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`0 */${n} * * *`, handler),
        seconds: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`every:${n}s`, handler),
      }
    }

    return Object.assign(everyFn, scheduleBuilder) as ScheduleBuilder & ((n: number) => IntervalBuilder)
  }
}

