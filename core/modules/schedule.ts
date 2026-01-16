/**
 * DOCoreSchedule Module - RPC-compatible scheduling functionality
 *
 * This module extracts scheduling concerns from DOCore into a separate module,
 * following the pattern established by noun-accessors.ts and state-manager.ts.
 *
 * Provides:
 * - Schedule registration and management
 * - Fluent DSL: every.day.at(), every.Monday.at9am(), etc.
 * - CRON generation and parsing
 * - SQLite persistence for schedule recovery
 * - RPC-compatible methods for cross-DO communication
 *
 * Usage patterns:
 * - this.schedule.registerSchedule('0 9 * * *', handler)
 * - this.every.day.at('9am')(handler)
 * - this.every(5).minutes(handler)
 * - this.schedule.getScheduleByCron('0 9 * * *')
 */

import { RpcTarget } from 'cloudflare:workers'
import {
  DAY_MAP,
  parseTime,
  type ScheduleHandler,
  type ScheduleEntry,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
} from '../schedule-manager'

// Re-export types for convenience
export type { ScheduleHandler, ScheduleEntry, TimeBuilder, ScheduleBuilder, IntervalBuilder }
export { DAY_MAP, parseTime }

// ============================================================================
// Persisted Schedule Type
// ============================================================================

/**
 * Persisted schedule entry from SQLite
 */
export interface PersistedSchedule {
  cron: string
  handler_id: string
  registered_at: number
}

// ============================================================================
// DOCoreSchedule Class
// ============================================================================

/**
 * DOCoreSchedule - RpcTarget class for scheduling operations
 *
 * This class is exposed via RPC and provides all schedule management
 * functionality. It maintains both in-memory state (for fast access)
 * and SQLite persistence (for recovery after eviction).
 *
 * @example
 * ```typescript
 * // Via DOCore (internal)
 * this.scheduleModule.registerSchedule('0 9 * * *', handler)
 *
 * // Via RPC (external)
 * await doStub.schedule.registerSchedule('0 9 * * *', handler)
 * ```
 */
export class DOCoreSchedule extends RpcTarget {
  /** In-memory schedule registry for fast access */
  private schedules: Map<string, ScheduleEntry> = new Map()

  constructor(private ctx: DurableObjectState) {
    super()
  }

  // =========================================================================
  // Core Schedule Operations
  // =========================================================================

  /**
   * Register a scheduled handler
   *
   * @param cron CRON expression or special interval string
   * @param handler Function to call when scheduled
   * @returns Unsubscribe function
   *
   * @example
   * const unsub = this.schedule.registerSchedule('0 9 * * *', async () => {
   *   console.log('Good morning!')
   * })
   * // Later: unsub() to remove the schedule
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
   *
   * @param cron The CRON expression to look up
   * @returns The schedule entry or undefined if not found
   */
  getScheduleByCron(cron: string): ScheduleEntry | undefined {
    return this.schedules.get(cron)
  }

  /**
   * Get the count of registered schedules
   *
   * @returns Number of registered schedules
   */
  getScheduleCount(): number {
    return this.schedules.size
  }

  /**
   * Get all persisted schedules from SQLite
   *
   * @returns Array of persisted schedule entries
   */
  getPersistedSchedules(): PersistedSchedule[] {
    const rows = this.ctx.storage.sql.exec(
      `SELECT cron, handler_id, registered_at FROM schedules`
    ).toArray()
    return rows.map(row => ({
      cron: row.cron as string,
      handler_id: row.handler_id as string,
      registered_at: row.registered_at as number,
    }))
  }

  /**
   * Clear all schedules (both in-memory and SQLite)
   */
  clearAllSchedules(): void {
    this.schedules.clear()
    this.ctx.storage.sql.exec(`DELETE FROM schedules`)
  }

  /**
   * Clear only in-memory schedules (for eviction simulation)
   */
  clearInMemorySchedules(): void {
    this.schedules.clear()
  }

  /**
   * Get count of in-memory schedules only
   *
   * @returns Number of in-memory schedules
   */
  getInMemoryScheduleCount(): number {
    return this.schedules.size
  }

  /**
   * Recover schedules from SQLite storage after eviction
   * Note: Handlers cannot be recovered since they are functions.
   * This method restores the CRON entries with placeholder handlers.
   */
  recoverSchedulesFromStorage(): void {
    const rows = this.ctx.storage.sql.exec(
      `SELECT cron, handler_id, registered_at FROM schedules`
    ).toArray()

    for (const row of rows) {
      const cron = row.cron as string
      // Create a placeholder handler since functions cannot be persisted
      const placeholderHandler: ScheduleHandler = () => {
        console.warn(`Recovered schedule ${cron} has no handler - re-register to restore functionality`)
      }
      this.schedules.set(cron, { handler: placeholderHandler, cron })
    }
  }

  // =========================================================================
  // Fluent DSL Registration Helpers (for RPC)
  // =========================================================================

  /**
   * Register schedule via fluent DSL (every.day.at(), every.Monday.at(), etc.)
   *
   * @param dayOrInterval Day of week ('Monday', 'day', 'hour', 'minute')
   * @param time Time string or null for hour/minute intervals
   * @param handler Handler function
   * @returns Unsubscribe function
   */
  registerScheduleViaEvery(
    dayOrInterval: string,
    time: string | null,
    handler: ScheduleHandler
  ): () => void {
    // Handle hour/minute intervals
    if (dayOrInterval === 'hour') {
      return this.registerSchedule('0 * * * *', handler)
    }
    if (dayOrInterval === 'minute') {
      return this.registerSchedule('* * * * *', handler)
    }

    // Parse the time
    if (!time) {
      throw new Error(`Time is required for day-based schedules`)
    }

    const { hour, minute } = parseTime(time)
    const dow = dayOrInterval === 'day' ? '*' : DAY_MAP[dayOrInterval]

    if (dow === undefined) {
      throw new Error(`Invalid day: ${dayOrInterval}`)
    }

    return this.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
  }

  /**
   * Register schedule via shortcut methods (at9am, at5pm, at6am)
   *
   * @param dayOrInterval Day of week or 'day'
   * @param shortcut Shortcut name ('at9am', 'at5pm', 'at6am')
   * @param handler Handler function
   * @returns Unsubscribe function
   */
  registerScheduleViaEveryShortcut(
    dayOrInterval: string,
    shortcut: string,
    handler: ScheduleHandler
  ): () => void {
    const shortcuts: Record<string, { hour: number; minute: number }> = {
      at9am: { hour: 9, minute: 0 },
      at5pm: { hour: 17, minute: 0 },
      at6am: { hour: 6, minute: 0 },
    }

    const timeSpec = shortcuts[shortcut]
    if (!timeSpec) {
      throw new Error(`Invalid shortcut: ${shortcut}`)
    }

    const dow = dayOrInterval === 'day' ? '*' : DAY_MAP[dayOrInterval]
    if (dow === undefined) {
      throw new Error(`Invalid day: ${dayOrInterval}`)
    }

    return this.registerSchedule(`${timeSpec.minute} ${timeSpec.hour} * * ${dow}`, handler)
  }

  /**
   * Register schedule via interval DSL (every(n).minutes(), every(n).hours(), every(n).seconds())
   *
   * @param n Interval value
   * @param unit Interval unit ('minutes', 'hours', 'seconds')
   * @param handler Handler function
   * @returns Unsubscribe function
   */
  registerScheduleViaInterval(
    n: number,
    unit: 'minutes' | 'hours' | 'seconds',
    handler: ScheduleHandler
  ): () => void {
    switch (unit) {
      case 'minutes':
        return this.registerSchedule(`*/${n} * * * *`, handler)
      case 'hours':
        return this.registerSchedule(`0 */${n} * * *`, handler)
      case 'seconds':
        // Seconds scheduling uses special format since CRON doesn't support seconds
        return this.registerSchedule(`every:${n}s`, handler)
      default:
        throw new Error(`Invalid unit: ${unit}`)
    }
  }

  // =========================================================================
  // Fluent DSL Builder
  // =========================================================================

  /**
   * Get the fluent schedule builder DSL
   *
   * @returns ScheduleBuilder with callable function for intervals
   *
   * @example
   * const every = this.schedule.getEveryBuilder()
   * every.day.at('9am')(handler)
   * every.Monday.at5pm(handler)
   * every(5).minutes(handler)
   */
  getEveryBuilder(): ScheduleBuilder & ((n: number) => IntervalBuilder) {
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

  // =========================================================================
  // Schedule Execution (for alarm handler)
  // =========================================================================

  /**
   * Get the handler for a schedule by CRON expression
   *
   * @param cron The CRON expression
   * @returns The handler function or undefined
   */
  getHandler(cron: string): ScheduleHandler | undefined {
    return this.schedules.get(cron)?.handler
  }

  /**
   * Execute all schedules that match the current time
   * Called by DOCore.alarm() when an alarm triggers
   *
   * @param currentCron The CRON expression that triggered
   */
  async executeSchedule(cron: string): Promise<void> {
    const entry = this.schedules.get(cron)
    if (entry?.handler) {
      await entry.handler()
    }
  }

  /**
   * List all registered CRON expressions
   *
   * @returns Array of CRON expressions
   */
  listSchedules(): string[] {
    return Array.from(this.schedules.keys())
  }

  /**
   * Remove a schedule by CRON expression
   *
   * @param cron The CRON expression to remove
   * @returns True if the schedule was removed, false if it didn't exist
   */
  removeSchedule(cron: string): boolean {
    const existed = this.schedules.delete(cron)
    if (existed) {
      this.ctx.storage.sql.exec(`DELETE FROM schedules WHERE cron = ?`, cron)
    }
    return existed
  }
}
