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
  type ScheduleHandler as ScheduleManagerHandler,
  type ScheduleEntry as ScheduleManagerEntry,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
} from '../schedule-manager'
import type { ISchedule, ScheduleEntry, PersistedScheduleEntry, ScheduleHandler } from '../types/modules'

// Re-export types for convenience (including from modules.ts for consistency)
export type { ScheduleHandler, ScheduleEntry, TimeBuilder, ScheduleBuilder, IntervalBuilder }
export { DAY_MAP, parseTime }

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Persisted schedule entry from SQLite
 * @internal Use ScheduleEntry from modules.ts for public API
 */
export interface PersistedSchedule {
  cron: string
  handler_id: string
  registered_at: number
}

/**
 * Internal schedule entry combining metadata with actual handler
 * @internal Not part of public ISchedule interface
 */
interface InternalScheduleEntry {
  cron: string
  handler: ScheduleManagerHandler
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
 * Implements: ISchedule interface for type-safe delegation from DOCore
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
export class DOCoreSchedule extends RpcTarget implements ISchedule {
  /** In-memory schedule registry for fast access */
  private schedules: Map<string, InternalScheduleEntry> = new Map()

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
   * @returns void (implements ISchedule)
   *
   * @example
   * this.schedule.registerSchedule('0 9 * * *', async () => {
   *   console.log('Good morning!')
   * })
   */
  registerSchedule(cron: string, handler: ScheduleHandler): void {
    const now = Date.now()
    const handlerId = `handler_${now}`

    this.schedules.set(cron, {
      cron,
      handler: handler as ScheduleManagerHandler,
      handler_id: handlerId,
      registered_at: now,
    })

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO schedules (cron, handler_id, registered_at) VALUES (?, ?, ?)`,
      cron,
      handlerId,
      now
    )
  }

  /**
   * Get a registered schedule by CRON expression
   *
   * @param cron The CRON expression to look up
   * @returns Promise resolving to the persisted schedule entry or null if not found
   */
  async getScheduleByCron(cron: string): Promise<PersistedScheduleEntry | null> {
    const internal = this.schedules.get(cron)
    if (!internal) return null
    // Return public interface (without handler function - can't serialize functions)
    return {
      cron: internal.cron,
      handler_id: internal.handler_id,
      registered_at: internal.registered_at,
    }
  }

  /**
   * Get all registered schedules (metadata only)
   *
   * @returns Promise resolving to array of persisted schedule entries
   */
  async getAllSchedules(): Promise<PersistedScheduleEntry[]> {
    return Array.from(this.schedules.values()).map(internal => ({
      cron: internal.cron,
      handler_id: internal.handler_id,
      registered_at: internal.registered_at,
    }))
  }

  /**
   * Delete a schedule by CRON expression
   *
   * @param cron The CRON expression to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteScheduleByCron(cron: string): Promise<boolean> {
    const existed = this.schedules.delete(cron)
    if (existed) {
      this.ctx.storage.sql.exec(`DELETE FROM schedules WHERE cron = ?`, cron)
    }
    return existed
  }

  /**
   * Clear all schedules
   *
   * @returns Promise that resolves when complete
   */
  async clearAllSchedules(): Promise<void> {
    this.schedules.clear()
    this.ctx.storage.sql.exec(`DELETE FROM schedules`)
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
   * Get a schedule with its handler (not RPC-compatible, for local use only)
   *
   * @param cron The CRON expression to look up
   * @returns Schedule entry with handler and cron, or undefined if not found
   */
  getScheduleInternal(cron: string): ScheduleEntry | undefined {
    const internal = this.schedules.get(cron)
    if (!internal) return undefined
    return {
      handler: internal.handler,
      cron: internal.cron,
    }
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
      const handlerId = row.handler_id as string
      const registeredAt = row.registered_at as number
      // Create a placeholder handler since functions cannot be persisted
      const placeholderHandler: ScheduleManagerHandler = () => {
        console.warn(`Recovered schedule ${cron} has no handler - re-register to restore functionality`)
      }
      this.schedules.set(cron, {
        handler: placeholderHandler,
        cron,
        handler_id: handlerId,
        registered_at: registeredAt,
      })
    }
  }

  // =========================================================================
  // Fluent DSL Registration Helpers (for RPC)
  // =========================================================================

  /**
   * Register schedule via fluent DSL (every.day.at(), every.Monday.at(), etc.)
   *
   * Note: RPC-compatible. Returns CRON string for unsubscription via removeSchedule().
   * Functions cannot be serialized over RPC, so we return the CRON expression instead.
   *
   * @param dayOrInterval Day of week ('Monday', 'day', 'hour', 'minute')
   * @param time Time string or null for hour/minute intervals
   * @param handler Handler function
   * @returns The CRON expression used to register the schedule (for unsubscription)
   */
  registerScheduleViaEvery(
    dayOrInterval: string,
    time: string | null,
    handler: ScheduleHandler
  ): string {
    // Handle hour/minute intervals
    if (dayOrInterval === 'hour') {
      const cron = '0 * * * *'
      this.registerSchedule(cron, handler)
      return cron
    }
    if (dayOrInterval === 'minute') {
      const cron = '* * * * *'
      this.registerSchedule(cron, handler)
      return cron
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

    const cron = `${minute} ${hour} * * ${dow}`
    this.registerSchedule(cron, handler)
    return cron
  }

  /**
   * Register schedule via shortcut methods (at9am, at5pm, at6am)
   *
   * Note: RPC-compatible. Returns CRON string for unsubscription via deleteScheduleByCron().
   *
   * @param dayOrInterval Day of week or 'day'
   * @param shortcut Shortcut name ('at9am', 'at5pm', 'at6am')
   * @param handler Handler function
   * @returns The CRON expression used to register the schedule (for unsubscription)
   */
  registerScheduleViaEveryShortcut(
    dayOrInterval: string,
    shortcut: string,
    handler: ScheduleHandler
  ): string {
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

    const cron = `${timeSpec.minute} ${timeSpec.hour} * * ${dow}`
    this.registerSchedule(cron, handler)
    return cron
  }

  /**
   * Register schedule via interval DSL (every(n).minutes(), every(n).hours(), every(n).seconds())
   *
   * Note: RPC-compatible. Returns CRON string for unsubscription via deleteScheduleByCron().
   *
   * @param n Interval value
   * @param unit Interval unit ('minutes', 'hours', 'seconds')
   * @param handler Handler function
   * @returns The CRON expression used to register the schedule (for unsubscription)
   */
  registerScheduleViaInterval(
    n: number,
    unit: 'minutes' | 'hours' | 'seconds',
    handler: ScheduleHandler
  ): string {
    let cron: string
    switch (unit) {
      case 'minutes':
        cron = `*/${n} * * * *`
        break
      case 'hours':
        cron = `0 */${n} * * *`
        break
      case 'seconds':
        // Seconds scheduling uses special format since CRON doesn't support seconds
        cron = `every:${n}s`
        break
      default:
        throw new Error(`Invalid unit: ${unit}`)
    }
    this.registerSchedule(cron, handler)
    return cron
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
                self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
                // Return a no-op unsubscribe function (schedule is persistent)
                return () => {}
              }
            }
          }

          if (shortcuts[prop]) {
            return (handler: ScheduleHandler): (() => void) => {
              const { hour, minute } = shortcuts[prop]
              self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
              // Return a no-op unsubscribe function (schedule is persistent)
              return () => {}
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
      hour: (handler: ScheduleHandler): (() => void) => {
        self.registerSchedule('0 * * * *', handler)
        return () => {} // No-op unsubscribe
      },
      minute: (handler: ScheduleHandler): (() => void) => {
        self.registerSchedule('* * * * *', handler)
        return () => {} // No-op unsubscribe
      },
    }

    const everyFn = (n: number): IntervalBuilder => {
      return {
        minutes: (handler: ScheduleHandler): (() => void) => {
          self.registerSchedule(`*/${n} * * * *`, handler)
          return () => {} // No-op unsubscribe
        },
        hours: (handler: ScheduleHandler): (() => void) => {
          self.registerSchedule(`0 */${n} * * *`, handler)
          return () => {} // No-op unsubscribe
        },
        seconds: (handler: ScheduleHandler): (() => void) => {
          self.registerSchedule(`every:${n}s`, handler)
          return () => {} // No-op unsubscribe
        },
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
   * List all registered CRON expressions (non-ISchedule method for testing)
   *
   * @returns Array of CRON expressions
   */
  listRegisteredCrons(): string[] {
    return Array.from(this.schedules.keys())
  }
}
