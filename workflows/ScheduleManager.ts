/**
 * ScheduleManager - Manages cron-triggered workflow schedules
 *
 * Provides:
 * - Schedule registration with cron expressions
 * - Cron expression parsing (standard 5-field format)
 * - Next run time calculation with timezone support
 * - Schedule listing, updating, and deletion
 * - Integration with DO alarm API for execution
 *
 * This is the runtime for scheduled workflow triggers in DOs.
 */

/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleValidationError'
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(name: string) {
    super(`Schedule not found: ${name}`)
    this.name = 'ScheduleNotFoundError'
  }
}

export class InvalidCronExpressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCronExpressionError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Schedule {
  id: string
  name: string
  cronExpression: string
  status: 'active' | 'paused'
  nextRunAt: Date | null
  lastRunAt: Date | null
  runCount: number
  timezone?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface ScheduleOptions {
  timezone?: string
  metadata?: Record<string, unknown>
  enabled?: boolean
}

export interface ScheduleUpdateOptions {
  cronExpression?: string
  timezone?: string
  metadata?: Record<string, unknown>
  enabled?: boolean
}

export interface ScheduleListOptions {
  status?: 'active' | 'paused'
}

export interface CronExpression {
  minute: number[] | '*'
  hour: number[] | '*'
  dayOfMonth: number[] | '*'
  month: number[] | '*'
  dayOfWeek: number[] | '*'
}

export interface NextRunTimeOptions {
  timezone?: string
  from?: Date
}

type ScheduleTriggerHandler = (schedule: Schedule) => void | Promise<void>

// ============================================================================
// STORAGE KEYS
// ============================================================================

const SCHEDULE_PREFIX = 'schedule:'

function scheduleKey(name: string): string {
  return `${SCHEDULE_PREFIX}${name}`
}

// ============================================================================
// MONTH AND DAY NAME ALIASES
// ============================================================================

const MONTH_ALIASES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

const DAY_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
}

// ============================================================================
// CRON EXPRESSION PARSING
// ============================================================================

function replaceAliases(field: string, aliases: Record<string, number>): string {
  let result = field.toUpperCase()
  for (const [alias, value] of Object.entries(aliases)) {
    result = result.replace(new RegExp(alias, 'g'), String(value))
  }
  return result
}

function parseField(field: string, min: number, max: number, fieldName: string): number[] | '*' {
  if (field === '*') {
    return '*'
  }

  const values: number[] = []

  // Split by comma for lists
  const parts = field.split(',')

  for (const part of parts) {
    // Check for step values (e.g., */15 or 0-30/10)
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    if (stepMatch) {
      const [, rangePart, stepStr] = stepMatch
      const step = parseInt(stepStr, 10)

      let rangeStart = min
      let rangeEnd = max

      if (rangePart !== '*') {
        // Parse range like 0-30
        const rangeMatch = rangePart.match(/^(\d+)-(\d+)$/)
        if (rangeMatch) {
          rangeStart = parseInt(rangeMatch[1], 10)
          rangeEnd = parseInt(rangeMatch[2], 10)
        } else {
          rangeStart = parseInt(rangePart, 10)
          rangeEnd = max
        }
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) {
        values.push(i)
      }
      continue
    }

    // Check for range (e.g., 1-5)
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)

      if (start > end) {
        throw new InvalidCronExpressionError(`Invalid range in ${fieldName}: ${part} (start > end)`)
      }

      for (let i = start; i <= end; i++) {
        values.push(i)
      }
      continue
    }

    // Single value
    const value = parseInt(part, 10)
    if (isNaN(value)) {
      throw new InvalidCronExpressionError(`Invalid value in ${fieldName}: ${part}`)
    }
    values.push(value)
  }

  // Validate all values are within range
  for (const value of values) {
    if (value < min || value > max) {
      throw new InvalidCronExpressionError(`Value ${value} in ${fieldName} is out of range (${min}-${max})`)
    }
  }

  return values.sort((a, b) => a - b)
}

/**
 * Parse a cron expression string into a structured CronExpression object
 *
 * Supports standard 5-field format:
 * - minute (0-59)
 * - hour (0-23)
 * - day of month (1-31)
 * - month (1-12)
 * - day of week (0-6, where 0 = Sunday)
 *
 * Supports:
 * - Wildcards (*)
 * - Ranges (1-5)
 * - Lists (1,3,5)
 * - Steps (star/15, 0-30/10)
 * - Month names (JAN-DEC)
 * - Day names (SUN-SAT)
 */
export function parseCronExpression(expression: string): CronExpression {
  if (!expression || typeof expression !== 'string') {
    throw new InvalidCronExpressionError('Cron expression is required')
  }

  const trimmed = expression.trim()
  if (!trimmed) {
    throw new InvalidCronExpressionError('Cron expression cannot be empty')
  }

  const fields = trimmed.split(/\s+/)

  // Standard cron has 5 fields, some systems have 6 (with seconds)
  if (fields.length < 5 || fields.length > 6) {
    throw new InvalidCronExpressionError(
      `Invalid cron expression: expected 5 fields, got ${fields.length}. Expression: "${expression}"`,
    )
  }

  // If 6 fields, skip the first (seconds) field
  const offset = fields.length === 6 ? 1 : 0

  // Replace day/month name aliases
  const monthField = replaceAliases(fields[offset + 3], MONTH_ALIASES)
  const dowField = replaceAliases(fields[offset + 4], DAY_ALIASES)

  return {
    minute: parseField(fields[offset + 0], 0, 59, 'minute'),
    hour: parseField(fields[offset + 1], 0, 23, 'hour'),
    dayOfMonth: parseField(fields[offset + 2], 1, 31, 'dayOfMonth'),
    month: parseField(monthField, 1, 12, 'month'),
    dayOfWeek: parseField(dowField, 0, 6, 'dayOfWeek'),
  }
}

// ============================================================================
// NEXT RUN TIME CALCULATION
// ============================================================================

function fieldMatches(value: number, field: number[] | '*'): boolean {
  if (field === '*') return true
  return field.includes(value)
}

function getNextValue(current: number, field: number[] | '*', max: number): { value: number; wrapped: boolean } {
  if (field === '*') {
    if (current >= max) {
      return { value: 0, wrapped: true }
    }
    return { value: current, wrapped: false }
  }

  // Find the next value >= current
  for (const v of field) {
    if (v >= current) {
      return { value: v, wrapped: false }
    }
  }

  // Wrap around to first value
  return { value: field[0], wrapped: true }
}

/**
 * Get UTC time components from a Date, optionally treating them as if they were in a timezone
 */
function getTimeComponents(date: Date, timezone?: string): {
  year: number
  month: number
  dayOfMonth: number
  dayOfWeek: number
  hour: number
  minute: number
} {
  if (timezone) {
    // Get the time as it appears in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const getPart = (type: string): string => parts.find((p) => p.type === type)?.value || '0'

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    }

    return {
      year: parseInt(getPart('year'), 10),
      month: parseInt(getPart('month'), 10),
      dayOfMonth: parseInt(getPart('day'), 10),
      dayOfWeek: weekdayMap[getPart('weekday')] ?? 0,
      hour: parseInt(getPart('hour'), 10),
      minute: parseInt(getPart('minute'), 10),
    }
  }

  // Default: use UTC components
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    dayOfMonth: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

/**
 * Calculate the next run time for a cron expression
 *
 * @param cron - Parsed cron expression
 * @param options - Optional timezone and reference time
 * @returns The next Date when the schedule should run (in UTC)
 */
export function getNextRunTime(cron: CronExpression, options: NextRunTimeOptions = {}): Date {
  const now = options.from || new Date()
  const timezone = options.timezone

  // Work with a copy in milliseconds since epoch
  let timestamp = now.getTime()

  // Round up to the next minute
  timestamp = Math.ceil(timestamp / 60000) * 60000
  // Add one minute to start from the NEXT minute
  timestamp += 60000

  // Maximum iterations to prevent infinite loops (approximately 4 years of minutes)
  const maxIterations = 60 * 24 * 366 * 4

  for (let i = 0; i < maxIterations; i++) {
    const date = new Date(timestamp)
    const components = getTimeComponents(date, timezone)

    // Check if current time matches the cron expression
    if (
      fieldMatches(components.month, cron.month) &&
      fieldMatches(components.dayOfMonth, cron.dayOfMonth) &&
      fieldMatches(components.dayOfWeek, cron.dayOfWeek) &&
      fieldMatches(components.hour, cron.hour) &&
      fieldMatches(components.minute, cron.minute)
    ) {
      // Found a match! Return the UTC time
      return date
    }

    // Advance to next minute
    timestamp += 60000
  }

  throw new Error('Could not find next run time within reasonable time frame')
}

// ============================================================================
// SCHEDULE MANAGER
// ============================================================================

export class ScheduleManager {
  private readonly storage: DurableObjectStorage
  private triggerHandler: ScheduleTriggerHandler | null = null

  constructor(state: DurableObjectState) {
    this.storage = state.storage
  }

  /**
   * Register a handler to be called when a schedule triggers
   */
  onScheduleTrigger(handler: ScheduleTriggerHandler): void {
    this.triggerHandler = handler
  }

  /**
   * Register a new cron schedule
   *
   * @param cronExpression - Standard 5-field cron expression
   * @param name - Unique name for the schedule
   * @param options - Optional timezone, metadata, and enabled flag
   * @returns The created schedule
   */
  async schedule(cronExpression: string, name: string, options: ScheduleOptions = {}): Promise<Schedule> {
    // Check for duplicate name
    const existing = await this.storage.get(scheduleKey(name))
    if (existing) {
      throw new ScheduleValidationError(`Schedule with name "${name}" already exists`)
    }

    // Parse and validate cron expression
    const cron = parseCronExpression(cronExpression)

    // Calculate next run time (if enabled)
    const enabled = options.enabled !== false
    let nextRunAt: Date | null = null

    if (enabled) {
      nextRunAt = getNextRunTime(cron, { timezone: options.timezone })
    }

    const now = new Date()
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      name,
      cronExpression,
      status: enabled ? 'active' : 'paused',
      nextRunAt,
      lastRunAt: null,
      runCount: 0,
      timezone: options.timezone,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
    }

    // Persist to storage
    await this.storage.put(scheduleKey(name), schedule)

    // Set alarm for next run if enabled
    if (enabled && nextRunAt) {
      await this.updateAlarm()
    }

    return schedule
  }

  /**
   * Get a schedule by name
   */
  async getSchedule(name: string): Promise<Schedule | null> {
    const schedule = await this.storage.get(scheduleKey(name))
    return (schedule as Schedule) || null
  }

  /**
   * List all registered schedules
   */
  async listSchedules(options: ScheduleListOptions = {}): Promise<Schedule[]> {
    const map = await this.storage.list({ prefix: SCHEDULE_PREFIX })
    const schedules: Schedule[] = []

    for (const [, value] of map) {
      const schedule = value as Schedule
      if (!options.status || schedule.status === options.status) {
        schedules.push(schedule)
      }
    }

    return schedules
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(name: string): Promise<void> {
    const existing = await this.storage.get(scheduleKey(name))
    if (!existing) {
      throw new ScheduleNotFoundError(name)
    }

    await this.storage.delete(scheduleKey(name))

    // Update alarm for remaining schedules
    await this.updateAlarm()
  }

  /**
   * Update a schedule
   */
  async updateSchedule(name: string, options: ScheduleUpdateOptions): Promise<Schedule> {
    const existing = await this.storage.get(scheduleKey(name))
    if (!existing) {
      throw new ScheduleNotFoundError(name)
    }

    const schedule = existing as Schedule
    const now = new Date()

    // Update cron expression if provided
    if (options.cronExpression !== undefined) {
      parseCronExpression(options.cronExpression) // Validate
      schedule.cronExpression = options.cronExpression
    }

    // Update timezone if provided
    if (options.timezone !== undefined) {
      schedule.timezone = options.timezone
    }

    // Update metadata if provided
    if (options.metadata !== undefined) {
      schedule.metadata = options.metadata
    }

    // Update enabled status if provided
    if (options.enabled !== undefined) {
      schedule.status = options.enabled ? 'active' : 'paused'
    }

    // Recalculate next run time
    if (schedule.status === 'active') {
      const cron = parseCronExpression(schedule.cronExpression)
      schedule.nextRunAt = getNextRunTime(cron, { timezone: schedule.timezone })
    } else {
      schedule.nextRunAt = null
    }

    schedule.updatedAt = now

    // Persist updated schedule
    await this.storage.put(scheduleKey(name), schedule)

    // Update alarm
    await this.updateAlarm()

    return schedule
  }

  /**
   * Handle a DO alarm - triggers any schedules due to run
   */
  async handleAlarm(): Promise<void> {
    const now = new Date()
    const schedules = await this.listSchedules({ status: 'active' })

    // Find all schedules due to run
    const dueSchedules = schedules.filter((s) => s.nextRunAt && s.nextRunAt.getTime() <= now.getTime())

    for (const schedule of dueSchedules) {
      // Trigger the handler
      if (this.triggerHandler) {
        await this.triggerHandler(schedule)
      }

      // Update schedule: lastRunAt, runCount, nextRunAt
      const cron = parseCronExpression(schedule.cronExpression)
      schedule.lastRunAt = now
      schedule.runCount += 1
      schedule.nextRunAt = getNextRunTime(cron, { timezone: schedule.timezone, from: now })
      schedule.updatedAt = now

      // Persist updated schedule
      await this.storage.put(scheduleKey(schedule.name), schedule)
    }

    // Set alarm for next due schedule
    await this.updateAlarm()
  }

  /**
   * Update the DO alarm to fire at the next scheduled time
   */
  private async updateAlarm(): Promise<void> {
    const schedules = await this.listSchedules({ status: 'active' })

    if (schedules.length === 0) {
      await this.storage.deleteAlarm()
      return
    }

    // Find the earliest next run time
    let earliestTime: Date | null = null
    for (const schedule of schedules) {
      if (schedule.nextRunAt) {
        if (!earliestTime || schedule.nextRunAt.getTime() < earliestTime.getTime()) {
          earliestTime = schedule.nextRunAt
        }
      }
    }

    if (earliestTime) {
      await this.storage.setAlarm(earliestTime)
    } else {
      await this.storage.deleteAlarm()
    }
  }
}

export default ScheduleManager
