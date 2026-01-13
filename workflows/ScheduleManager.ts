/**
 * @module workflows/ScheduleManager
 *
 * ScheduleManager - Runtime for Cron-Triggered Workflow Schedules
 *
 * This module provides the schedule management runtime for Durable Objects,
 * enabling cron-based scheduling with timezone support and integration
 * with the DO alarm API for reliable execution.
 *
 * ## Schedule Registration
 *
 * Register schedules using standard cron expressions or fluent DSL:
 *
 * @example Basic scheduling
 * ```typescript
 * class MyWorkflow extends DurableObject {
 *   private scheduleManager: ScheduleManager
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.scheduleManager = new ScheduleManager(ctx.state)
 *
 *     // Register handler for schedule triggers
 *     this.scheduleManager.onScheduleTrigger(async (schedule) => {
 *       console.log(`Running ${schedule.name}`)
 *       await this.runScheduledTask(schedule)
 *     })
 *   }
 *
 *   async setup() {
 *     // Register a schedule
 *     await this.scheduleManager.schedule('0 9 * * 1', 'weekly-report', {
 *       timezone: 'America/New_York'
 *     })
 *   }
 *
 *   async alarm() {
 *     // DO alarm triggers schedule execution
 *     await this.scheduleManager.handleAlarm()
 *   }
 * }
 * ```
 *
 * ## Cron Expression Format
 *
 * Standard 5-field cron expressions are supported:
 *
 * ```
 * ┌───────────── minute (0-59)
 * │ ┌───────────── hour (0-23)
 * │ │ ┌───────────── day of month (1-31)
 * │ │ │ ┌───────────── month (1-12)
 * │ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
 * │ │ │ │ │
 * * * * * *
 * ```
 *
 * @example Cron patterns
 * ```typescript
 * // Every Monday at 9am
 * await manager.schedule('0 9 * * 1', 'monday-standup')
 *
 * // Every day at 6pm
 * await manager.schedule('0 18 * * *', 'daily-summary')
 *
 * // Every 5 minutes
 * await manager.schedule('*​/5 * * * *', 'health-check')
 *
 * // First day of month at midnight
 * await manager.schedule('0 0 1 * *', 'monthly-billing')
 *
 * // Weekdays at 8:30am
 * await manager.schedule('30 8 * * 1-5', 'weekday-standup')
 * ```
 *
 * ## Timezone Support
 *
 * Schedules can be configured with IANA timezone identifiers:
 *
 * @example Timezone-aware scheduling
 * ```typescript
 * // Run at 9am New York time
 * await manager.schedule('0 9 * * *', 'ny-morning', {
 *   timezone: 'America/New_York'
 * })
 *
 * // Run at 6pm Tokyo time
 * await manager.schedule('0 18 * * *', 'tokyo-evening', {
 *   timezone: 'Asia/Tokyo'
 * })
 * ```
 *
 * ## Schedule Management
 *
 * Full CRUD operations for schedules:
 *
 * @example Managing schedules
 * ```typescript
 * // List all schedules
 * const schedules = await manager.listSchedules()
 *
 * // Get specific schedule
 * const schedule = await manager.getSchedule('weekly-report')
 *
 * // Update schedule
 * await manager.updateSchedule('weekly-report', {
 *   cronExpression: '0 10 * * 1',  // Change to 10am
 *   enabled: false  // Pause schedule
 * })
 *
 * // Delete schedule
 * await manager.deleteSchedule('weekly-report')
 * ```
 *
 * ## Integration with DO Alarms
 *
 * The ScheduleManager automatically sets DO alarms for the next scheduled run:
 *
 * @example Alarm integration
 * ```typescript
 * class MyWorkflow extends DurableObject {
 *   async alarm() {
 *     // This is called by the DO alarm API
 *     await this.scheduleManager.handleAlarm()
 *     // handleAlarm:
 *     // 1. Finds all schedules due to run
 *     // 2. Calls the trigger handler for each
 *     // 3. Updates lastRunAt and nextRunAt
 *     // 4. Sets alarm for next scheduled run
 *   }
 * }
 * ```
 *
 * Storage Layer: Uses graph Things for schedule persistence.
 * @see dotdo-2n693 - [REFACTOR] Migrate ScheduleManager to use graph Things
 *
 * @see {@link ScheduleManager} - The main class
 * @see {@link parseCronExpression} - Cron parser
 * @see {@link getNextRunTime} - Next run calculator
 */

/// <reference types="@cloudflare/workers-types" />

import {
  createSchedule as createScheduleThing,
  getScheduleByName,
  listSchedules as listScheduleThings,
  updateSchedule as updateScheduleThing,
  deleteScheduleByName,
  recordTriggerEvent,
  type ScheduleThing,
  type ScheduleStatus,
} from './graph/schedule-thing'

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
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a ScheduleThing to the public Schedule interface.
 */
function scheduleThingToSchedule(thing: ScheduleThing): Schedule {
  const data = thing.data!
  return {
    id: thing.id,
    name: data.name,
    cronExpression: data.cronExpression,
    status: data.status,
    nextRunAt: data.nextRunAt ? new Date(data.nextRunAt) : null,
    lastRunAt: data.lastRunAt ? new Date(data.lastRunAt) : null,
    runCount: data.runCount,
    timezone: data.timezone,
    metadata: data.metadata,
    createdAt: new Date(thing.createdAt),
    updatedAt: new Date(thing.updatedAt),
  }
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
      const step = parseInt(stepStr!, 10)

      let rangeStart = min
      let rangeEnd = max

      if (rangePart !== '*') {
        // Parse range like 0-30
        const rangeMatch = rangePart!.match(/^(\d+)-(\d+)$/)
        if (rangeMatch) {
          rangeStart = parseInt(rangeMatch[1]!, 10)
          rangeEnd = parseInt(rangeMatch[2]!, 10)
        } else {
          rangeStart = parseInt(rangePart!, 10)
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
      const start = parseInt(rangeMatch[1]!, 10)
      const end = parseInt(rangeMatch[2]!, 10)

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
 * Parse a cron expression string into a structured CronExpression object.
 *
 * Supports standard 5-field cron format with extensions for readability.
 *
 * ## Fields
 *
 * | Position | Field | Range | Example |
 * |----------|-------|-------|---------|
 * | 1 | minute | 0-59 | `0`, `30`, `*​/5` |
 * | 2 | hour | 0-23 | `9`, `0-12`, `*` |
 * | 3 | day of month | 1-31 | `1`, `15`, `1,15` |
 * | 4 | month | 1-12 | `1`, `JAN`, `*` |
 * | 5 | day of week | 0-6 | `0`, `MON`, `1-5` |
 *
 * ## Supported Syntax
 *
 * - **Wildcards**: `*` matches all values
 * - **Ranges**: `1-5` matches 1, 2, 3, 4, 5
 * - **Lists**: `1,3,5` matches 1, 3, or 5
 * - **Steps**: `*​/15` (every 15), `0-30/10` (0, 10, 20, 30)
 * - **Month names**: `JAN`, `FEB`, ..., `DEC`
 * - **Day names**: `SUN`, `MON`, ..., `SAT`
 *
 * @param expression - The cron expression string to parse
 * @returns Parsed CronExpression object
 * @throws InvalidCronExpressionError if the expression is malformed
 *
 * @example
 * ```typescript
 * // Every Monday at 9am
 * const cron = parseCronExpression('0 9 * * 1')
 * // { minute: [0], hour: [9], dayOfMonth: '*', month: '*', dayOfWeek: [1] }
 *
 * // Every 5 minutes
 * const cron2 = parseCronExpression('*​/5 * * * *')
 * // { minute: [0,5,10,15,20,25,30,35,40,45,50,55], ... }
 *
 * // Weekdays at 8:30am
 * const cron3 = parseCronExpression('30 8 * * MON-FRI')
 * // { minute: [30], hour: [8], ..., dayOfWeek: [1,2,3,4,5] }
 * ```
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
  const monthField = replaceAliases(fields[offset + 3]!, MONTH_ALIASES)
  const dowField = replaceAliases(fields[offset + 4]!, DAY_ALIASES)

  return {
    minute: parseField(fields[offset + 0]!, 0, 59, 'minute'),
    hour: parseField(fields[offset + 1]!, 0, 23, 'hour'),
    dayOfMonth: parseField(fields[offset + 2]!, 1, 31, 'dayOfMonth'),
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
  return { value: field[0]!, wrapped: true }
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
 * Calculate the next run time for a cron expression.
 *
 * Iterates through future times to find the next moment that matches
 * all fields in the cron expression. Supports timezone-aware calculation.
 *
 * @param cron - Parsed cron expression object
 * @param options - Optional configuration
 * @param options.timezone - IANA timezone (e.g., 'America/New_York')
 * @param options.from - Reference time (defaults to now)
 * @returns The next Date when the schedule should run (in UTC)
 *
 * @example Basic usage
 * ```typescript
 * const cron = parseCronExpression('0 9 * * 1')  // Monday 9am
 * const nextRun = getNextRunTime(cron)
 * console.log(nextRun)  // Next Monday at 9am UTC
 * ```
 *
 * @example With timezone
 * ```typescript
 * const cron = parseCronExpression('0 9 * * *')  // Daily 9am
 * const nextRun = getNextRunTime(cron, {
 *   timezone: 'America/New_York'
 * })
 * // Returns UTC time that corresponds to 9am in New York
 * ```
 *
 * @example From specific time
 * ```typescript
 * const cron = parseCronExpression('0 9 * * *')
 * const nextRun = getNextRunTime(cron, {
 *   from: new Date('2024-01-15T08:00:00Z')
 * })
 * // Returns 2024-01-15T09:00:00Z
 * ```
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

/**
 * Schedule Manager for Durable Objects.
 *
 * Manages cron-based schedules with full CRUD operations, timezone support,
 * and integration with the Durable Object alarm API for reliable execution.
 *
 * @example Basic usage
 * ```typescript
 * class MyWorkflow extends DurableObject {
 *   private scheduleManager: ScheduleManager
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.scheduleManager = new ScheduleManager(ctx.state)
 *
 *     this.scheduleManager.onScheduleTrigger(async (schedule) => {
 *       await this.runTask(schedule.name)
 *     })
 *   }
 *
 *   async registerSchedules() {
 *     await this.scheduleManager.schedule('0 9 * * 1', 'weekly-sync')
 *     await this.scheduleManager.schedule('0 0 1 * *', 'monthly-report')
 *   }
 *
 *   async alarm() {
 *     await this.scheduleManager.handleAlarm()
 *   }
 * }
 * ```
 *
 * @example Schedule with metadata
 * ```typescript
 * await scheduleManager.schedule('0 9 * * *', 'daily-sync', {
 *   timezone: 'America/New_York',
 *   metadata: {
 *     target: 'salesforce',
 *     priority: 'high'
 *   }
 * })
 * ```
 */
export class ScheduleManager {
  private readonly storage: DurableObjectStorage
  /** Graph database for schedule Things (uses storage as db key for isolation) */
  private readonly db: object
  private triggerHandler: ScheduleTriggerHandler | null = null

  /**
   * Create a new ScheduleManager.
   *
   * @param state - The Durable Object state, providing storage access
   */
  constructor(state: DurableObjectState) {
    this.storage = state.storage
    // Use the storage object as the db key for isolation between DOs
    this.db = state.storage
  }

  /**
   * Register a handler to be called when a schedule triggers.
   *
   * The handler is invoked during `handleAlarm()` for each schedule
   * that is due to run. Only one handler can be registered at a time.
   *
   * @param handler - Async function called with the triggering schedule
   *
   * @example
   * ```typescript
   * scheduleManager.onScheduleTrigger(async (schedule) => {
   *   console.log(`Running: ${schedule.name}`)
   *   console.log(`Cron: ${schedule.cronExpression}`)
   *   console.log(`Run count: ${schedule.runCount}`)
   *
   *   if (schedule.metadata?.target === 'salesforce') {
   *     await syncSalesforce()
   *   }
   * })
   * ```
   */
  onScheduleTrigger(handler: ScheduleTriggerHandler): void {
    this.triggerHandler = handler
  }

  /**
   * Register a new cron schedule.
   *
   * Creates a schedule that will trigger at times matching the cron expression.
   * The schedule is persisted and survives DO hibernation.
   *
   * @param cronExpression - Standard 5-field cron expression
   * @param name - Unique name for the schedule
   * @param options - Optional configuration
   * @param options.timezone - IANA timezone for cron evaluation
   * @param options.metadata - Arbitrary data to attach to the schedule
   * @param options.enabled - Whether the schedule is active (default: true)
   * @returns The created schedule object
   * @throws ScheduleValidationError if name already exists
   * @throws InvalidCronExpressionError if cron is malformed
   *
   * @example Basic schedule
   * ```typescript
   * const schedule = await manager.schedule('0 9 * * 1', 'weekly-report')
   * console.log(schedule.nextRunAt)  // Next Monday 9am
   * ```
   *
   * @example With options
   * ```typescript
   * const schedule = await manager.schedule('0 18 * * *', 'daily-sync', {
   *   timezone: 'Asia/Tokyo',
   *   metadata: { region: 'apac', priority: 1 },
   *   enabled: true
   * })
   * ```
   *
   * @example Create disabled schedule
   * ```typescript
   * // Create but don't run until explicitly enabled
   * const schedule = await manager.schedule('0 0 * * *', 'migration', {
   *   enabled: false
   * })
   *
   * // Later, enable it
   * await manager.updateSchedule('migration', { enabled: true })
   * ```
   */
  async schedule(cronExpression: string, name: string, options: ScheduleOptions = {}): Promise<Schedule> {
    // Parse and validate cron expression first
    const cron = parseCronExpression(cronExpression)

    // Calculate next run time (if enabled)
    const enabled = options.enabled !== false
    let nextRunAt: Date | null = null

    if (enabled) {
      nextRunAt = getNextRunTime(cron, { timezone: options.timezone })
    }

    const status: ScheduleStatus = enabled ? 'active' : 'paused'

    try {
      // Create schedule Thing in graph store
      const scheduleThing = await createScheduleThing(this.db, {
        name,
        cronExpression,
        status,
        nextRunAt,
        timezone: options.timezone,
        metadata: options.metadata,
      })

      // Set alarm for next run if enabled
      if (enabled && nextRunAt) {
        await this.updateAlarm()
      }

      return scheduleThingToSchedule(scheduleThing)
    } catch (error) {
      // Convert graph Thing errors to ScheduleValidationError
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new ScheduleValidationError(`Schedule with name "${name}" already exists`)
      }
      throw error
    }
  }

  /**
   * Get a schedule by name
   */
  async getSchedule(name: string): Promise<Schedule | null> {
    const scheduleThing = await getScheduleByName(this.db, name)
    if (!scheduleThing) {
      return null
    }
    return scheduleThingToSchedule(scheduleThing)
  }

  /**
   * List all registered schedules
   */
  async listSchedules(options: ScheduleListOptions = {}): Promise<Schedule[]> {
    const scheduleThings = await listScheduleThings(this.db, {
      status: options.status,
    })

    return scheduleThings.map(scheduleThingToSchedule)
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(name: string): Promise<void> {
    const deleted = await deleteScheduleByName(this.db, name)
    if (!deleted) {
      throw new ScheduleNotFoundError(name)
    }

    // Update alarm for remaining schedules
    await this.updateAlarm()
  }

  /**
   * Update a schedule
   */
  async updateSchedule(name: string, options: ScheduleUpdateOptions): Promise<Schedule> {
    const existing = await getScheduleByName(this.db, name)
    if (!existing) {
      throw new ScheduleNotFoundError(name)
    }

    // Build update object
    const updates: {
      cronExpression?: string
      status?: ScheduleStatus
      nextRunAt?: Date | null
      timezone?: string
      metadata?: Record<string, unknown>
    } = {}

    // Update cron expression if provided
    if (options.cronExpression !== undefined) {
      parseCronExpression(options.cronExpression) // Validate
      updates.cronExpression = options.cronExpression
    }

    // Update timezone if provided
    if (options.timezone !== undefined) {
      updates.timezone = options.timezone
    }

    // Update metadata if provided
    if (options.metadata !== undefined) {
      updates.metadata = options.metadata
    }

    // Update enabled status if provided
    if (options.enabled !== undefined) {
      updates.status = options.enabled ? 'active' : 'paused'
    }

    // Calculate new status (use update or existing)
    const newStatus = updates.status ?? existing.data!.status

    // Recalculate next run time based on new status
    if (newStatus === 'active') {
      const cronExpr = updates.cronExpression ?? existing.data!.cronExpression
      const timezone = updates.timezone ?? existing.data!.timezone
      const cron = parseCronExpression(cronExpr)
      updates.nextRunAt = getNextRunTime(cron, { timezone })
    } else {
      updates.nextRunAt = null
    }

    const updatedThing = await updateScheduleThing(this.db, existing.id, updates)
    if (!updatedThing) {
      throw new ScheduleNotFoundError(name)
    }

    // Update alarm
    await this.updateAlarm()

    return scheduleThingToSchedule(updatedThing)
  }

  /**
   * Handle a DO alarm - triggers any schedules due to run.
   *
   * This method should be called from the Durable Object's `alarm()` method.
   * It finds all active schedules that are due, triggers them, and sets
   * the next alarm.
   *
   * For each due schedule:
   * 1. Calls the registered trigger handler
   * 2. Records the trigger event for auditing
   * 3. Updates lastRunAt and increments runCount
   * 4. Calculates and stores the next run time
   *
   * After processing, sets the DO alarm for the next scheduled run.
   *
   * @example Integration with DO alarm
   * ```typescript
   * class MyWorkflow extends DurableObject {
   *   private scheduleManager: ScheduleManager
   *
   *   constructor(ctx: DurableObjectState, env: Env) {
   *     super(ctx, env)
   *     this.scheduleManager = new ScheduleManager(ctx.state)
   *
   *     this.scheduleManager.onScheduleTrigger(async (schedule) => {
   *       await this.executeScheduledTask(schedule)
   *     })
   *   }
   *
   *   // Called by Cloudflare when alarm fires
   *   async alarm() {
   *     await this.scheduleManager.handleAlarm()
   *   }
   * }
   * ```
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

      // Record trigger event as relationship
      // This creates a 'triggered' relationship for audit/tracking
      await recordTriggerEvent(
        this.db,
        schedule.id,
        `do://schedules/${schedule.id}/triggers/${Date.now()}`
      )

      // Update schedule: lastRunAt, runCount, nextRunAt
      const cron = parseCronExpression(schedule.cronExpression)
      const nextRunAt = getNextRunTime(cron, { timezone: schedule.timezone, from: now })

      // Get the thing by name and update it
      const thing = await getScheduleByName(this.db, schedule.name)
      if (thing) {
        await updateScheduleThing(this.db, thing.id, {
          lastRunAt: now,
          runCount: schedule.runCount + 1,
          nextRunAt,
        })
      }
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
