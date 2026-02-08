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

import { createScopedLogger, LogLevel } from '@dotdo/utils'
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
import type { FireAndForgetErrorStore, RetryPendingResult } from '../fire-and-forget-errors'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[AlarmHandler]' })

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
      // Log with full context for debugging, but continue with empty alarm store
      // This is acceptable because the alarm store will be rebuilt from schedules
      logger.error('Failed to restore alarm state, continuing with empty store:', error)
      // Reset to clean state to ensure consistent behavior
      this.alarmStore = createAlarmStore()
    }
  }

  /**
   * Persist alarm state to storage.
   *
   * Note: The serialized alarm state must stay under the CF DO value size
   * limit of 128 KB (MAX_VALUE_SIZE). If you have many one-time alarms,
   * monitor the size. Use {@link StorageGuard.checkValueSize} to validate
   * before writing.
   *
   * @see https://developers.cloudflare.com/durable-objects/platform/limits/
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
      // Persistence failure is critical - throw to allow caller to handle
      // This prevents silent data loss where alarm state appears saved but isn't
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to persist alarm state:', error)
      throw new Error(`AlarmHandler: failed to persist state: ${errorMessage}`)
    }
  }

  /**
   * Schedule the next alarm based on registered schedules and pending retries.
   *
   * @param schedules - The registered schedules
   * @param fireAndForgetErrors - Optional error store to check for pending retries
   */
  async scheduleNextAlarm(
    schedules: Map<string, ScheduleRegistration>,
    fireAndForgetErrors?: FireAndForgetErrorStore
  ): Promise<void> {
    if (!this.state) {
      throw new Error('AlarmHandler: state not set. Call setState() first.')
    }

    // Calculate next alarm from schedules and one-time alarms
    let nextTime = calculateNextAlarmTime(
      schedules,
      this.alarmStore
    )

    // Also consider pending retry timing from the error store
    if (fireAndForgetErrors) {
      const nextRetryTime = fireAndForgetErrors.getNextRetryTime()
      if (nextRetryTime !== null) {
        if (nextTime === null || nextRetryTime < nextTime) {
          nextTime = nextRetryTime
        }
      }
    }

    if (schedules.size === 0 && this.alarmStore.oneTimeAlarms.size === 0 && nextTime === null) {
      return // Nothing to schedule
    }

    if (nextTime !== null) {
      try {
        await this.state.storage.setAlarm(nextTime)
        if (this.debug) {
          logger.debug(`Scheduled next alarm for ${new Date(nextTime).toISOString()}`)
        }
      } catch (error) {
        // Alarm scheduling failure is critical - throw to allow caller to handle
        // Silent failure here would cause schedules to stop executing
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Failed to set alarm:', error)
        throw new Error(`AlarmHandler: failed to schedule alarm for ${new Date(nextTime).toISOString()}: ${errorMessage}`)
      }
    }
  }

  /**
   * Process an alarm - execute schedules and one-time alarms.
   *
   * Uses a crash-safe pattern for alarm persistence:
   * 1. Calculate and persist next alarm time BEFORE executing handlers
   * 2. Execute the current handlers
   * 3. Recalculate and persist final alarm time after execution
   *
   * This ensures that if the DO crashes during handler execution, the
   * next alarm is already set and won't be lost.
   *
   * @param schedules - The registered schedules from WorkflowContext
   * @param fireAndForgetErrors - Optional error store for auto-retry integration
   * @returns Results of schedule and one-time alarm execution
   */
  async processAlarm(
    schedules: Map<string, ScheduleRegistration>,
    fireAndForgetErrors?: FireAndForgetErrorStore
  ): Promise<{
    scheduleResults: Array<{ id: string; success: boolean; error?: Error }>
    oneTimeResults: Array<{ id: string; success: boolean; error?: Error }>
    retryResults?: RetryPendingResult
  }> {
    await this.initializeAlarms()

    // STEP 1: Calculate and persist next alarm time BEFORE executing handlers.
    // This guarantees that if the DO crashes during handler execution,
    // the alarm is already set for the next run.
    await this.scheduleNextAlarm(schedules)

    // STEP 2: Execute all registered schedules
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

    // STEP 2b: Auto-retry pending fire-and-forget errors if store is provided
    let retryResults: RetryPendingResult | undefined
    if (fireAndForgetErrors) {
      try {
        retryResults = await fireAndForgetErrors.retryPending(async (error) => {
          // Default retry strategy: re-emit the event if we have event type info.
          // The retryFn can be overridden by callers for custom behavior.
          // For now, we simply re-throw to indicate the error needs a handler-level retry.
          // The error store retryPending will increment the attempt count on failure.
          throw new Error(`No automatic retry handler for operation "${error.operation}" (${error.eventType || 'unknown'})`)
        })

        if (retryResults.attempted > 0) {
          logger.info(
            `[retryPending] Processed ${retryResults.attempted} errors: ` +
            `${retryResults.recovered} recovered, ${retryResults.failed} failed, ${retryResults.abandoned} abandoned`
          )
        }
      } catch (retryErr) {
        logger.error('Error during retryPending:', retryErr)
      }
    }

    // Persist alarm state
    await this.persistAlarmState()

    // STEP 3: Recalculate and persist final alarm time after execution.
    // Handler execution may have changed alarm state (new one-time alarms,
    // updated schedule metadata, retry timing, etc.), so recalculate.
    await this.scheduleNextAlarm(schedules, fireAndForgetErrors)

    return { scheduleResults, oneTimeResults, retryResults }
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

    // Delete the alarm - collect errors and report at end
    const errors: Error[] = []

    try {
      await this.state.storage.deleteAlarm()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to delete alarm:', error)
      errors.push(err)
    }

    // Clear persisted state
    try {
      await this.state.storage.delete(ALARM_STORAGE_KEY)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to clear alarm storage:', error)
      errors.push(err)
    }

    // If any cleanup operation failed, throw aggregated error
    if (errors.length > 0) {
      const messages = errors.map(e => e.message).join('; ')
      throw new Error(`AlarmHandler: failed to clear alarms: ${messages}`)
    }
  }
}
