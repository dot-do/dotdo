/**
 * Alarm scheduling utilities for Durable Objects
 *
 * Provides functionality for:
 * - Processing scheduled events from $.every DSL
 * - Re-scheduling recurring alarms
 * - Handling one-time alarms
 * - Calculating next execution times from cron expressions
 *
 * @module do/workflow/alarm
 */

import type { ScheduleRegistration, ScheduleInterval } from './schedule'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[Alarm]')

/**
 * Stored alarm metadata for persistence
 */
export interface AlarmMetadata {
  /** Schedule ID */
  id: string
  /** Next scheduled run time (unix ms) */
  nextRun: number
  /** Whether this is a recurring schedule */
  recurring: boolean
  /** The interval configuration */
  interval: ScheduleInterval
  /** Last execution time (unix ms) */
  lastRun?: number
}

/**
 * One-time alarm registration
 */
export interface OneTimeAlarm {
  /** Unique alarm ID */
  id: string
  /** Scheduled execution time (unix ms) */
  runAt: number
  /** The handler to execute (serialized or reference) */
  handlerRef: string
}

/**
 * Alarm store interface for persistence
 */
export interface AlarmStore {
  alarms: Map<string, AlarmMetadata>
  oneTimeAlarms: Map<string, OneTimeAlarm>
  oneTimeHandlers: Map<string, () => Promise<void>>
}

/**
 * Create an in-memory alarm store
 */
export function createAlarmStore(): AlarmStore {
  return {
    alarms: new Map(),
    oneTimeAlarms: new Map(),
    oneTimeHandlers: new Map(),
  }
}

/**
 * Calculate the next run time for a schedule interval
 *
 * @param interval - The schedule interval configuration
 * @param fromTime - The time to calculate from (default: now)
 * @returns Next run time in unix milliseconds
 */
export function calculateNextRunTime(
  interval: ScheduleInterval,
  fromTime: number = Date.now()
): number {
  if (interval.type === 'cron' && interval.expression) {
    return calculateNextCronTime(interval.expression, fromTime)
  }

  // Handle interval-based schedules (every N minutes/hours/etc)
  const multipliers: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  const multiplier = multipliers[interval.type] || 60 * 1000 // default to minute
  const value = interval.value || 1

  return fromTime + (value * multiplier)
}

/**
 * Parse a cron expression and calculate the next run time
 *
 * Cron format: minute hour day-of-month month day-of-week
 * Example: "0 9 * * 1" = Monday at 9am
 *
 * @param expression - Cron expression string
 * @param fromTime - Time to calculate from
 * @returns Next run time in unix milliseconds
 */
export function calculateNextCronTime(expression: string, fromTime: number = Date.now()): number {
  const parts = expression.split(' ')

  // Handle 5-part (standard) and 6-part (with seconds) cron
  const isWithSeconds = parts.length === 6
  const minute = isWithSeconds ? parts[1] : parts[0]
  const hour = isWithSeconds ? parts[2] : parts[1]
  const dayOfMonth = isWithSeconds ? parts[3] : parts[2]
  const month = isWithSeconds ? parts[4] : parts[3]
  const dayOfWeek = isWithSeconds ? parts[5] : parts[4]

  const from = new Date(fromTime)

  // Start from next minute (don't run immediately if exactly on time)
  from.setSeconds(0, 0)
  from.setMinutes(from.getMinutes() + 1)

  // Search for the next matching time (up to 1 year ahead)
  const maxIterations = 365 * 24 * 60 // 1 year of minutes
  let iterations = 0

  while (iterations < maxIterations) {
    if (
      matchCronField(minute, from.getMinutes()) &&
      matchCronField(hour, from.getHours()) &&
      matchCronField(dayOfMonth, from.getDate()) &&
      matchCronField(month, from.getMonth() + 1) &&
      matchCronDayOfWeek(dayOfWeek, from.getDay())
    ) {
      return from.getTime()
    }

    // Advance by 1 minute
    from.setMinutes(from.getMinutes() + 1)
    iterations++
  }

  // Fallback: if no match found, return 1 hour from now
  logger.warn(`Could not find next cron time for expression: ${expression}, using fallback`)
  return fromTime + 60 * 60 * 1000
}

/**
 * Check if a value matches a cron field
 *
 * @param field - Cron field (e.g., "*", "0", "1-5", "0,15,30,45")
 * @param value - Current value to check
 * @returns Whether the value matches
 */
function matchCronField(field: string | undefined, value: number): boolean {
  if (!field || field === '*') return true

  // Handle lists: "0,15,30,45"
  if (field.includes(',')) {
    return field.split(',').some(part => matchCronField(part.trim(), value))
  }

  // Handle ranges: "1-5"
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number)
    if (typeof start === 'number' && typeof end === 'number') {
      return value >= start && value <= end
    }
  }

  // Handle step values: "*/5" or "0-30/5"
  if (field.includes('/')) {
    const [range, stepStr] = field.split('/')
    const step = Number(stepStr)
    if (range === '*') {
      return value % step === 0
    }
    // Handle range/step like "0-30/5"
    if (range && range.includes('-')) {
      const [start, end] = range.split('-').map(Number)
      if (typeof start === 'number' && typeof end === 'number') {
        return value >= start && value <= end && (value - start) % step === 0
      }
    }
  }

  // Direct match
  return Number(field) === value
}

/**
 * Special handler for day-of-week field
 * Cron uses 0 = Sunday, 7 = Sunday (both valid)
 */
function matchCronDayOfWeek(field: string | undefined, value: number): boolean {
  if (!field || field === '*') return true

  // Handle both 0 and 7 as Sunday
  if (field === '7' || field === '0') {
    return value === 0
  }

  // Handle ranges with day of week
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number)
    if (typeof start === 'number' && typeof end === 'number') {
      // Handle wrap-around (e.g., 5-1 means Fri, Sat, Sun, Mon)
      if (start <= end) {
        return value >= start && value <= end
      } else {
        return value >= start || value <= end
      }
    }
  }

  return matchCronField(field, value)
}

/**
 * Execute all due schedules
 *
 * @param schedules - Map of schedule registrations from WorkflowContext
 * @param alarmStore - Alarm metadata store
 * @returns Array of execution results
 */
export async function executeSchedules(
  schedules: Map<string, ScheduleRegistration>,
  alarmStore: AlarmStore
): Promise<{ id: string; success: boolean; error?: Error }[]> {
  const results: { id: string; success: boolean; error?: Error }[] = []
  const now = Date.now()

  // Execute all schedules (on alarm trigger, we run all registered handlers)
  for (const [id, schedule] of schedules) {
    try {
      await schedule.handler()
      results.push({ id, success: true })

      // Update last run time
      const metadata = alarmStore.alarms.get(id)
      if (metadata) {
        metadata.lastRun = now
        metadata.nextRun = calculateNextRunTime(schedule.interval, now)
      }
    } catch (error) {
      logger.error(`Schedule handler "${id}" failed:`, error)
      results.push({
        id,
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  return results
}

/**
 * Execute due one-time alarms
 *
 * @param alarmStore - Alarm store containing one-time alarms
 * @returns Array of execution results
 */
export async function executeOneTimeAlarms(
  alarmStore: AlarmStore
): Promise<{ id: string; success: boolean; error?: Error }[]> {
  const results: { id: string; success: boolean; error?: Error }[] = []
  const now = Date.now()

  // Find and execute due one-time alarms
  for (const [id, alarm] of alarmStore.oneTimeAlarms) {
    if (alarm.runAt <= now) {
      const handler = alarmStore.oneTimeHandlers.get(id)
      if (handler) {
        try {
          await handler()
          results.push({ id, success: true })
        } catch (error) {
          logger.error(`One-time alarm "${id}" failed:`, error)
          results.push({
            id,
            success: false,
            error: error instanceof Error ? error : new Error(String(error))
          })
        }
      }

      // Remove the one-time alarm after execution
      alarmStore.oneTimeAlarms.delete(id)
      alarmStore.oneTimeHandlers.delete(id)
    }
  }

  return results
}

/**
 * Calculate the next alarm time based on all schedules
 *
 * @param schedules - Map of schedule registrations
 * @param alarmStore - Alarm store with metadata
 * @returns Next alarm time in unix ms, or null if no schedules
 */
export function calculateNextAlarmTime(
  schedules: Map<string, ScheduleRegistration>,
  alarmStore: AlarmStore
): number | null {
  const now = Date.now()
  let nextTime: number | null = null

  // Check recurring schedules
  for (const [id, schedule] of schedules) {
    let metadata = alarmStore.alarms.get(id)

    if (!metadata) {
      // Initialize metadata for new schedule
      metadata = {
        id,
        nextRun: calculateNextRunTime(schedule.interval, now),
        recurring: true,
        interval: schedule.interval,
      }
      alarmStore.alarms.set(id, metadata)
    }

    if (nextTime === null || metadata.nextRun < nextTime) {
      nextTime = metadata.nextRun
    }
  }

  // Check one-time alarms
  for (const [, alarm] of alarmStore.oneTimeAlarms) {
    if (nextTime === null || alarm.runAt < nextTime) {
      nextTime = alarm.runAt
    }
  }

  return nextTime
}

/**
 * Serialize alarm store for persistence
 */
export function serializeAlarmStore(store: AlarmStore): {
  alarms: AlarmMetadata[]
  oneTimeAlarms: OneTimeAlarm[]
} {
  return {
    alarms: Array.from(store.alarms.values()),
    oneTimeAlarms: Array.from(store.oneTimeAlarms.values()),
  }
}

/**
 * Deserialize alarm store from persistence
 */
export function deserializeAlarmStore(
  data: { alarms?: AlarmMetadata[]; oneTimeAlarms?: OneTimeAlarm[] } | null | undefined,
  store: AlarmStore
): void {
  if (!data) return

  if (data.alarms) {
    for (const alarm of data.alarms) {
      store.alarms.set(alarm.id, alarm)
    }
  }

  if (data.oneTimeAlarms) {
    for (const alarm of data.oneTimeAlarms) {
      store.oneTimeAlarms.set(alarm.id, alarm)
    }
  }
}
