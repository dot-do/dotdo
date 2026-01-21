/**
 * Alarm Handler
 *
 * Handles all alarm-related operations for a DO:
 * - Alarm state initialization and persistence
 * - Schedule execution
 * - One-time alarm execution
 * - Next alarm scheduling
 *
 * @module do/handlers/alarm
 */

import { createLogger } from '../../utils/logger'
import {
  createAlarmStore,
  executeSchedules,
  executeOneTimeAlarms,
  calculateNextAlarmTime,
  serializeAlarmStore,
  deserializeAlarmStore,
  type AlarmStore,
} from '../workflow/alarm'
import type { ScheduleRegistration } from '../workflow/schedule'
import type { DOHandler } from './registry'

const logger = createLogger('[AlarmHandler]')

/** Storage key for persisted alarm metadata */
const ALARM_STORAGE_KEY = '_alarms'

/**
 * Options for creating an AlarmHandler
 */
export interface AlarmHandlerOptions {
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Handler for all alarm operations in a DO.
 *
 * Manages:
 * - Alarm state initialization from storage
 * - Schedule execution
 * - One-time alarm execution
 * - Alarm state persistence
 * - Next alarm scheduling
 *
 * @example
 * ```typescript
 * const handler = new AlarmHandler()
 *
 * // Initialize with state
 * handler.setState(state)
 *
 * // Process alarm
 * await handler.processAlarm(schedules)
 * ```
 */
export class AlarmHandler implements DOHandler {
  readonly name = 'alarm'
  private alarmStore: AlarmStore
  private alarmInitialized = false
  private state: DurableObjectState | null = null
  private debug: boolean

  constructor(options: AlarmHandlerOptions = {}) {
    this.alarmStore = createAlarmStore()
    this.debug = options.debug ?? false
  }

  /**
   * Set the DurableObjectState for storage access.
   * Must be called before using the handler.
   */
  setState(state: DurableObjectState): void {
    this.state = state
  }

  /**
   * Get the alarm store for direct access.
   */
  getAlarmStore(): AlarmStore {
    return this.alarmStore
  }

  /**
   * Initialize alarms from storage (for DO restart recovery).
   */
  async initializeAlarms(): Promise<void> {
    if (this.alarmInitialized) return
    if (!this.state) {
      throw new Error('AlarmHandler: state not set. Call setState() first.')
    }

    this.alarmInitialized = true

    try {
      const stored = await this.state.storage.get<ReturnType<typeof serializeAlarmStore>>(
        ALARM_STORAGE_KEY
      )
      if (stored) {
        deserializeAlarmStore(stored, this.alarmStore)
        if (this.debug) {
          logger.debug('Restored alarm state from storage')
        }
      }
    } catch (error) {
      logger.error('Failed to restore alarm state:', error)
    }
  }

  /**
   * Persist alarm state to storage.
   */
  async persistAlarmState(): Promise<void> {
    if (!this.state) {
      throw new Error('AlarmHandler: state not set. Call setState() first.')
    }

    try {
      const data = serializeAlarmStore(this.alarmStore)
      await this.state.storage.put(ALARM_STORAGE_KEY, data)
      if (this.debug) {
        logger.debug('Persisted alarm state to storage')
      }
    } catch (error) {
      logger.error('Failed to persist alarm state:', error)
    }
  }

  /**
   * Schedule the next alarm based on registered schedules.
   */
  async scheduleNextAlarm(schedules: Map<string, ScheduleRegistration>): Promise<void> {
    if (!this.state) {
      throw new Error('AlarmHandler: state not set. Call setState() first.')
    }

    if (schedules.size === 0 && this.alarmStore.oneTimeAlarms.size === 0) {
      return // No schedules to set alarm for
    }

    const nextTime = calculateNextAlarmTime(
      schedules,
      this.alarmStore
    )

    if (nextTime !== null) {
      try {
        await this.state.storage.setAlarm(nextTime)
        if (this.debug) {
          logger.debug(`Scheduled next alarm for ${new Date(nextTime).toISOString()}`)
        }
      } catch (error) {
        logger.error('Failed to set alarm:', error)
      }
    }
  }

  /**
   * Process an alarm - execute schedules and one-time alarms.
   *
   * @param schedules - The registered schedules from WorkflowContext
   * @returns Results of schedule and one-time alarm execution
   */
  async processAlarm(
    schedules: Map<string, ScheduleRegistration>
  ): Promise<{
    scheduleResults: Array<{ id: string; success: boolean; error?: Error }>
    oneTimeResults: Array<{ id: string; success: boolean; error?: Error }>
  }> {
    await this.initializeAlarms()

    // Execute all registered schedules
    const scheduleResults = await executeSchedules(schedules, this.alarmStore)

    // Log any errors
    for (const result of scheduleResults) {
      if (!result.success && result.error) {
        logger.error(`Schedule "${result.id}" failed:`, result.error.message)
      }
    }

    // Execute one-time alarms
    const oneTimeResults = await executeOneTimeAlarms(this.alarmStore)

    for (const result of oneTimeResults) {
      if (!result.success && result.error) {
        logger.error(`One-time alarm "${result.id}" failed:`, result.error.message)
      }
    }

    // Persist alarm state
    await this.persistAlarmState()

    // Schedule next alarm
    await this.scheduleNextAlarm(schedules)

    return { scheduleResults, oneTimeResults }
  }

  /**
   * Schedule a one-time alarm to execute a handler after a delay.
   *
   * @param delayMs - Delay in milliseconds before execution
   * @param handler - The handler function to execute
   */
  async scheduleOneTimeAlarm(
    delayMs: number,
    handler: () => Promise<void>,
    schedules: Map<string, ScheduleRegistration>
  ): Promise<void> {
    await this.initializeAlarms()

    const id = `one-time-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const runAt = Date.now() + delayMs

    // Store the alarm metadata (PERSISTED)
    this.alarmStore.oneTimeAlarms.set(id, {
      id,
      runAt,
      handlerRef: id,
    })

    // Store the handler reference (IN-MEMORY ONLY)
    this.alarmStore.oneTimeHandlers.set(id, handler)

    // Persist and schedule
    await this.persistAlarmState()
    await this.scheduleNextAlarm(schedules)
  }

  /**
   * Clear all alarms (both recurring and one-time).
   */
  async clearAllAlarms(): Promise<void> {
    if (!this.state) {
      throw new Error('AlarmHandler: state not set. Call setState() first.')
    }

    // Clear alarm store
    this.alarmStore.alarms.clear()
    this.alarmStore.oneTimeAlarms.clear()
    this.alarmStore.oneTimeHandlers.clear()

    // Delete the alarm
    try {
      await this.state.storage.deleteAlarm()
    } catch (error) {
      logger.error('Failed to delete alarm:', error)
    }

    // Clear persisted state
    try {
      await this.state.storage.delete(ALARM_STORAGE_KEY)
    } catch (error) {
      logger.error('Failed to clear alarm storage:', error)
    }
  }
}
