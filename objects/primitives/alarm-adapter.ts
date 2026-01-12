/**
 * DO Alarm Adapter
 *
 * Adapts Durable Object alarms to work with WindowManager and other
 * time-based primitives. Provides a unified alarm scheduling interface
 * that handles:
 * - Alarm coalescing (merging multiple requests to earliest time)
 * - Callback registration for alarm triggers
 * - State persistence for alarm metadata
 *
 * DO alarms are single-fire, so this adapter manages multiple logical
 * alarms by tracking the earliest required time and dispatching to
 * registered callbacks on trigger.
 */

/**
 * Callback type for alarm triggers
 */
export type AlarmCallback = () => void | Promise<void>

/**
 * Scheduled alarm entry
 */
export interface ScheduledAlarm {
  /** Unique identifier for this alarm */
  id: string
  /** Name/type of the alarm */
  name: string
  /** Scheduled time in milliseconds since epoch */
  scheduledAt: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Alarm adapter interface
 */
export interface DOAlarmAdapter {
  /** Schedule an alarm at a specific time */
  scheduleAt(timestamp: number, metadata?: Record<string, unknown>): Promise<void>

  /** Schedule an alarm after a delay */
  scheduleIn(delayMs: number, metadata?: Record<string, unknown>): Promise<void>

  /** Cancel all pending alarms */
  cancel(): Promise<void>

  /** Get the next scheduled alarm time */
  getNextAlarmTime(): Promise<number | null>

  /** Register a callback for alarm triggers */
  onAlarm(name: string, callback: AlarmCallback): void

  /** Unregister a callback */
  offAlarm(name: string): void

  /** Handle DO alarm trigger - call this from DO.alarm() */
  handleAlarm(): Promise<void>
}

/**
 * Options for the alarm adapter
 */
export interface DOAlarmAdapterOptions {
  /** Prefix for storage keys */
  namespace?: string
}

/**
 * Internal storage key for alarm metadata
 */
const ALARM_METADATA_KEY = 'primitives:alarm:metadata'

/**
 * DO Alarm Adapter implementation
 */
class DOAlarmAdapterImpl implements DOAlarmAdapter {
  private readonly ctx: DurableObjectState
  private readonly namespace: string
  private readonly callbacks: Map<string, AlarmCallback> = new Map()

  constructor(ctx: DurableObjectState, options?: DOAlarmAdapterOptions) {
    this.ctx = ctx
    this.namespace = options?.namespace ?? 'primitives'
  }

  async scheduleAt(timestamp: number, metadata?: Record<string, unknown>): Promise<void> {
    // Get current alarm time
    const currentAlarm = await this.ctx.storage.getAlarm()

    // Only reschedule if this is earlier than current alarm
    if (currentAlarm === null || timestamp < currentAlarm) {
      await this.ctx.storage.setAlarm(timestamp)

      // Store metadata about what triggered this alarm
      if (metadata) {
        const existingMeta = await this.ctx.storage.get<Record<string, unknown>[]>(ALARM_METADATA_KEY)
        const metaList = existingMeta ?? []
        metaList.push({ ...metadata, scheduledAt: timestamp })
        await this.ctx.storage.put(ALARM_METADATA_KEY, metaList)
      }
    }
  }

  async scheduleIn(delayMs: number, metadata?: Record<string, unknown>): Promise<void> {
    await this.scheduleAt(Date.now() + delayMs, metadata)
  }

  async cancel(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.delete(ALARM_METADATA_KEY)
  }

  async getNextAlarmTime(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }

  onAlarm(name: string, callback: AlarmCallback): void {
    this.callbacks.set(name, callback)
  }

  offAlarm(name: string): void {
    this.callbacks.delete(name)
  }

  async handleAlarm(): Promise<void> {
    // Get metadata to understand what triggered this
    const metadata = await this.ctx.storage.get<Record<string, unknown>[]>(ALARM_METADATA_KEY)

    // Call all registered callbacks
    const promises: Promise<void>[] = []
    for (const [name, callback] of this.callbacks) {
      try {
        const result = callback()
        if (result instanceof Promise) {
          promises.push(result)
        }
      } catch (error) {
        console.error(`[DOAlarmAdapter] Error in callback '${name}':`, error)
      }
    }

    // Wait for all async callbacks
    if (promises.length > 0) {
      await Promise.allSettled(promises)
    }

    // Clear processed metadata
    await this.ctx.storage.delete(ALARM_METADATA_KEY)
  }
}

/**
 * Create a DO alarm adapter
 *
 * @param ctx - Durable Object state
 * @param options - Adapter configuration
 * @returns Alarm adapter instance
 */
export function createDOAlarmAdapter(
  ctx: DurableObjectState,
  options?: DOAlarmAdapterOptions
): DOAlarmAdapter {
  return new DOAlarmAdapterImpl(ctx, options)
}

/**
 * Window Manager Alarm Integration
 *
 * Provides automatic alarm scheduling for WindowManager triggers.
 * When a window is about to close (based on watermark), this schedules
 * an alarm to trigger the window.
 */
export interface WindowAlarmIntegration {
  /** Schedule alarm for window end time */
  scheduleWindowTrigger(windowEnd: number): Promise<void>
  /** Handle window alarm - advances watermark and triggers windows */
  handleWindowAlarm(advanceWatermark: (timestamp: number) => void): Promise<void>
  /** Get currently tracked window ends */
  getPendingWindowEnds(): Promise<number[]>
}

/**
 * Create window alarm integration
 */
export function createWindowAlarmIntegration(
  alarmAdapter: DOAlarmAdapter,
  storage: DurableObjectStorage
): WindowAlarmIntegration {
  const WINDOW_ENDS_KEY = 'primitives:window:pending-ends'

  return {
    async scheduleWindowTrigger(windowEnd: number) {
      // Track this window end time
      const ends = (await storage.get<number[]>(WINDOW_ENDS_KEY)) ?? []
      if (!ends.includes(windowEnd)) {
        ends.push(windowEnd)
        ends.sort((a, b) => a - b)
        await storage.put(WINDOW_ENDS_KEY, ends)
      }

      // Schedule alarm for this window end
      await alarmAdapter.scheduleAt(windowEnd, { type: 'window-trigger', windowEnd })
    },

    async handleWindowAlarm(advanceWatermark: (timestamp: number) => void) {
      const now = Date.now()
      const ends = (await storage.get<number[]>(WINDOW_ENDS_KEY)) ?? []

      // Find all window ends that have passed
      const triggeredEnds = ends.filter((end) => end <= now)
      const remainingEnds = ends.filter((end) => end > now)

      // Advance watermark for each triggered window
      for (const end of triggeredEnds) {
        advanceWatermark(end)
      }

      // Update pending ends
      if (remainingEnds.length > 0) {
        await storage.put(WINDOW_ENDS_KEY, remainingEnds)

        // Schedule next alarm for earliest remaining window
        const nextEnd = remainingEnds[0]!
        await alarmAdapter.scheduleAt(nextEnd, {
          type: 'window-trigger',
          windowEnd: nextEnd,
        })
      } else {
        await storage.delete(WINDOW_ENDS_KEY)
      }
    },

    async getPendingWindowEnds() {
      return (await storage.get<number[]>(WINDOW_ENDS_KEY)) ?? []
    },
  }
}
