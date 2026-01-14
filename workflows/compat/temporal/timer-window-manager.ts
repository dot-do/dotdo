/**
 * TimerWindowManager - Timer and Deadline Management using WindowManager
 *
 * This module provides a unified timer management system backed by WindowManager
 * primitives instead of raw setTimeout. This enables:
 *
 * 1. Timer coalescing - Group timers firing within the same window
 * 2. Workflow timeouts - Global windows with deadlines
 * 3. Activity heartbeat tracking - Session windows with gaps
 * 4. Schedule-to-close timeouts - Windows with start/end boundaries
 *
 * Benefits over raw setTimeout:
 * - Unified handling of all temporal operations
 * - Session windows for activity heartbeat tracking
 * - Late data handling for out-of-order events
 * - Built-in metrics for timer operations
 * - Testable time advancement
 */

import {
  WindowManager,
  EventTimeTrigger,
  type Duration,
  type Window,
  milliseconds as windowMilliseconds,
  seconds as windowSeconds,
  minutes as windowMinutes,
} from '../../../db/primitives/window-manager'
import { type MetricsCollector, noopMetrics } from '../../../db/primitives/observability'

// Re-export duration helpers for convenience
export { milliseconds, seconds, minutes, hours } from '../../../db/primitives/window-manager'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating a timer
 */
export interface TimerConfig {
  /** Duration until timer fires */
  duration: Duration | string | number
  /** Optional custom timer ID (auto-generated if not provided) */
  timerId?: string
  /** Callback when timer fires */
  onFire?: () => void | Promise<void>
}

/**
 * Configuration for workflow execution timeout
 */
export interface WorkflowTimeoutConfig {
  /** Workflow ID */
  workflowId: string
  /** Timeout duration */
  timeout: Duration | string | number
  /** Callback when timeout is exceeded */
  onTimeout?: () => void | Promise<void>
}

/**
 * Configuration for activity heartbeat tracking
 */
export interface HeartbeatConfig {
  /** Activity ID */
  activityId: string
  /** Maximum time between heartbeats */
  heartbeatTimeout: Duration | string | number
  /** Callback when heartbeat timeout is exceeded */
  onHeartbeatTimeout?: () => void | Promise<void>
}

/**
 * Configuration for activity timeout
 */
export interface ActivityTimeoutConfig {
  /** Activity ID */
  activityId: string
  /** Schedule-to-close timeout */
  scheduleToCloseTimeout?: Duration | string | number
  /** Start-to-close timeout */
  startToCloseTimeout?: Duration | string | number
  /** Callback when timeout is exceeded */
  onTimeout?: () => void | Promise<void>
}

/**
 * Handle returned by createTimer
 */
export interface TimerWindowHandle {
  /** Unique timer ID */
  timerId: string
  /** Promise that resolves when timer fires */
  promise: Promise<void>
  /** Whether timer is still pending */
  pending: boolean
  /** Cancel the timer */
  cancel: () => boolean
}

/**
 * Options for creating a TimerWindowManager
 */
export interface TimerWindowManagerOptions {
  /** Window size for timer coalescing (default: 10ms) */
  coalesceWindow?: Duration
  /** Threshold for stale timer cleanup (default: 5 minutes) */
  staleTimerThreshold?: Duration
  /** Interval for cleanup checks (default: 5 minutes) */
  cleanupInterval?: Duration
  /** Metrics collector */
  metrics?: MetricsCollector
}

// ============================================================================
// Internal Types
// ============================================================================

interface TimerState {
  timerId: string
  pending: boolean
  scheduledAt: number
  fireAt: number
  resolve: () => void
  reject: (error: Error) => void
  onFire?: () => void | Promise<void>
  bucket: number
}

interface WorkflowTimeoutState {
  workflowId: string
  fireAt: number
  timeout: ReturnType<typeof setTimeout>
  onTimeout?: () => void | Promise<void>
}

interface HeartbeatState {
  activityId: string
  lastHeartbeat: number
  heartbeatTimeoutMs: number
  timeout: ReturnType<typeof setTimeout>
  onHeartbeatTimeout?: () => void | Promise<void>
  details?: Record<string, unknown>
}

interface ActivityTimeoutState {
  activityId: string
  fireAt: number
  timeout: ReturnType<typeof setTimeout>
  onTimeout?: () => void | Promise<void>
}

interface TimerEvent {
  timerId: string
  scheduledAt: number
  fireAt: number
}

// ============================================================================
// TimerWindowManager Implementation
// ============================================================================

export class TimerWindowManager {
  private readonly metrics: MetricsCollector
  private readonly coalesceWindowMs: number
  private readonly staleThresholdMs: number
  private readonly cleanupIntervalMs: number

  // Timer state
  private activeTimers = new Map<string, TimerState>()
  private coalescedBuckets = new Map<number, TimerState[]>()
  private bucketTimeouts = new Map<number, ReturnType<typeof setTimeout>>()
  private timerCounter = 0

  // Workflow timeout state
  private workflowTimeouts = new Map<string, WorkflowTimeoutState>()

  // Heartbeat tracking state
  private heartbeatTracking = new Map<string, HeartbeatState>()

  // Activity timeout state
  private activityTimeouts = new Map<string, ActivityTimeoutState>()

  // WindowManager for watermark tracking
  private windowManager: WindowManager<TimerEvent>
  private currentTime: number
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null

  // Disposed flag
  private disposed = false

  constructor(options: TimerWindowManagerOptions = {}) {
    this.metrics = options.metrics ?? noopMetrics
    this.coalesceWindowMs = options.coalesceWindow?.toMillis() ?? 10
    this.staleThresholdMs = options.staleTimerThreshold?.toMillis() ?? 5 * 60 * 1000
    this.cleanupIntervalMs = options.cleanupInterval?.toMillis() ?? 5 * 60 * 1000

    this.currentTime = Date.now()

    // Initialize WindowManager with global windows for timer tracking
    this.windowManager = new WindowManager<TimerEvent>(
      WindowManager.global<TimerEvent>(),
      { metrics: this.metrics }
    )
    this.windowManager.withTrigger(new EventTimeTrigger())

    // Set up cleanup interval
    if (this.cleanupIntervalMs > 0) {
      this.startCleanup()
    }
  }

  // ==========================================================================
  // Basic Timer Operations
  // ==========================================================================

  /**
   * Create a cancellable timer that fires after the specified duration.
   */
  createTimer(config: TimerConfig): TimerWindowHandle {
    this.ensureNotDisposed()

    const durationMs = parseDuration(config.duration)
    const timerId = config.timerId ?? `timer-${++this.timerCounter}-${Date.now()}`

    // Check for duplicate timer ID
    if (config.timerId && this.activeTimers.has(config.timerId)) {
      throw new Error(`Duplicate timer ID: ${config.timerId}`)
    }

    const now = this.currentTime
    const fireAt = now + durationMs
    const bucket = Math.floor(durationMs / this.coalesceWindowMs) * this.coalesceWindowMs

    let resolveTimer: () => void
    let rejectTimer: (error: Error) => void

    const promise = new Promise<void>((resolve, reject) => {
      resolveTimer = resolve
      rejectTimer = reject
    })

    const timerState: TimerState = {
      timerId,
      pending: true,
      scheduledAt: now,
      fireAt,
      resolve: resolveTimer!,
      reject: rejectTimer!,
      onFire: config.onFire,
      bucket,
    }

    this.activeTimers.set(timerId, timerState)
    this.addToCoalescedBucket(timerState, durationMs)

    // Record in WindowManager for tracking
    const event: TimerEvent = { timerId, scheduledAt: now, fireAt }
    this.windowManager.process(event, now)

    this.metrics.incrementCounter('timer.created', { bucket: String(bucket) })

    // Create handle with getter for pending state
    const handle: TimerWindowHandle = {
      timerId,
      promise,
      get pending() {
        return timerState.pending
      },
      cancel: () => this.cancelTimer(timerId),
    }

    return handle
  }

  /**
   * Sleep for the specified duration.
   */
  async sleep(duration: Duration | string | number): Promise<void> {
    const handle = this.createTimer({ duration })
    return handle.promise
  }

  /**
   * Cancel a timer by ID.
   */
  private cancelTimer(timerId: string): boolean {
    const timer = this.activeTimers.get(timerId)
    if (!timer || !timer.pending) {
      return false
    }

    timer.pending = false
    timer.reject(new Error('Timer cancelled'))
    this.activeTimers.delete(timerId)

    // Remove from coalesced bucket
    this.removeFromCoalescedBucket(timer)

    this.metrics.incrementCounter('timer.cancelled', { timerId })

    return true
  }

  // ==========================================================================
  // Timer Coalescing
  // ==========================================================================

  private addToCoalescedBucket(timer: TimerState, durationMs: number): void {
    const bucket = timer.bucket

    const existingBucket = this.coalescedBuckets.get(bucket)
    if (existingBucket && existingBucket.length > 0) {
      // Add to existing bucket
      existingBucket.push(timer)
    } else {
      // Create new bucket
      const newBucket = [timer]
      this.coalescedBuckets.set(bucket, newBucket)

      // Set up the actual timeout for this bucket
      const timeoutId = setTimeout(() => {
        this.fireBucket(bucket)
      }, durationMs)

      this.bucketTimeouts.set(bucket, timeoutId)
    }
  }

  private removeFromCoalescedBucket(timer: TimerState): void {
    const bucket = timer.bucket
    const timers = this.coalescedBuckets.get(bucket)
    if (!timers) return

    const index = timers.findIndex(t => t.timerId === timer.timerId)
    if (index !== -1) {
      timers.splice(index, 1)

      if (timers.length === 0) {
        // Last timer in bucket - clean up
        this.coalescedBuckets.delete(bucket)
        const timeoutId = this.bucketTimeouts.get(bucket)
        if (timeoutId) {
          clearTimeout(timeoutId)
          this.bucketTimeouts.delete(bucket)
        }
      }
    }
  }

  private fireBucket(bucket: number): void {
    this.bucketTimeouts.delete(bucket)
    const timers = this.coalescedBuckets.get(bucket) || []
    this.coalescedBuckets.delete(bucket)

    for (const timer of timers) {
      if (timer.pending) {
        timer.pending = false
        this.activeTimers.delete(timer.timerId)

        // Fire callback if provided
        if (timer.onFire) {
          Promise.resolve(timer.onFire()).catch(console.error)
        }

        timer.resolve()

        this.metrics.incrementCounter('timer.fired', { bucket: String(bucket) })
      }
    }
  }

  /**
   * Get the number of coalesced timer buckets.
   */
  getCoalescedBucketCount(): number {
    return this.coalescedBuckets.size
  }

  // ==========================================================================
  // Workflow Execution Timeout
  // ==========================================================================

  /**
   * Set a global timeout for workflow execution.
   */
  setWorkflowTimeout(config: WorkflowTimeoutConfig): void {
    this.ensureNotDisposed()

    // Clear existing timeout if any
    this.clearWorkflowTimeout(config.workflowId)

    const timeoutMs = parseDuration(config.timeout)
    const fireAt = this.currentTime + timeoutMs

    const timeout = setTimeout(() => {
      const state = this.workflowTimeouts.get(config.workflowId)
      if (state?.onTimeout) {
        Promise.resolve(state.onTimeout()).catch(console.error)
      }
      this.workflowTimeouts.delete(config.workflowId)
    }, timeoutMs)

    this.workflowTimeouts.set(config.workflowId, {
      workflowId: config.workflowId,
      fireAt,
      timeout,
      onTimeout: config.onTimeout,
    })
  }

  /**
   * Clear a workflow timeout.
   */
  clearWorkflowTimeout(workflowId: string): void {
    const state = this.workflowTimeouts.get(workflowId)
    if (state) {
      clearTimeout(state.timeout)
      this.workflowTimeouts.delete(workflowId)
    }
  }

  /**
   * Check if a workflow has an active timeout.
   */
  hasWorkflowTimeout(workflowId: string): boolean {
    return this.workflowTimeouts.has(workflowId)
  }

  /**
   * Get remaining time until workflow timeout.
   */
  getWorkflowTimeoutRemaining(workflowId: string): number | null {
    const state = this.workflowTimeouts.get(workflowId)
    if (!state) return null
    return Math.max(0, state.fireAt - this.currentTime)
  }

  // ==========================================================================
  // Activity Heartbeat Tracking
  // ==========================================================================

  /**
   * Start tracking heartbeats for an activity.
   */
  startHeartbeatTracking(config: HeartbeatConfig): void {
    this.ensureNotDisposed()

    // Stop existing tracking if any
    this.stopHeartbeatTracking(config.activityId)

    const timeoutMs = parseDuration(config.heartbeatTimeout)
    const now = this.currentTime

    const scheduleTimeout = () => {
      return setTimeout(() => {
        const state = this.heartbeatTracking.get(config.activityId)
        if (state?.onHeartbeatTimeout) {
          Promise.resolve(state.onHeartbeatTimeout()).catch(console.error)
        }
        this.heartbeatTracking.delete(config.activityId)
      }, timeoutMs)
    }

    this.heartbeatTracking.set(config.activityId, {
      activityId: config.activityId,
      lastHeartbeat: now,
      heartbeatTimeoutMs: timeoutMs,
      timeout: scheduleTimeout(),
      onHeartbeatTimeout: config.onHeartbeatTimeout,
    })
  }

  /**
   * Record a heartbeat for an activity.
   */
  recordHeartbeat(activityId: string, details?: Record<string, unknown>): void {
    const state = this.heartbeatTracking.get(activityId)
    if (!state) return

    // Update last heartbeat time
    state.lastHeartbeat = this.currentTime
    state.details = details

    // Reset the timeout
    clearTimeout(state.timeout)
    state.timeout = setTimeout(() => {
      const currentState = this.heartbeatTracking.get(activityId)
      if (currentState?.onHeartbeatTimeout) {
        Promise.resolve(currentState.onHeartbeatTimeout()).catch(console.error)
      }
      this.heartbeatTracking.delete(activityId)
    }, state.heartbeatTimeoutMs)
  }

  /**
   * Stop tracking heartbeats for an activity.
   */
  stopHeartbeatTracking(activityId: string): void {
    const state = this.heartbeatTracking.get(activityId)
    if (state) {
      clearTimeout(state.timeout)
      this.heartbeatTracking.delete(activityId)
    }
  }

  /**
   * Check if heartbeat tracking is active for an activity.
   */
  isActivityHeartbeatActive(activityId: string): boolean {
    return this.heartbeatTracking.has(activityId)
  }

  /**
   * Get the last heartbeat timestamp for an activity.
   */
  getLastHeartbeat(activityId: string): number | null {
    const state = this.heartbeatTracking.get(activityId)
    return state?.lastHeartbeat ?? null
  }

  /**
   * Get the heartbeat details for an activity.
   */
  getHeartbeatDetails(activityId: string): Record<string, unknown> | undefined {
    const state = this.heartbeatTracking.get(activityId)
    return state?.details
  }

  // ==========================================================================
  // Activity Timeout
  // ==========================================================================

  /**
   * Set a timeout for an activity.
   */
  setActivityTimeout(config: ActivityTimeoutConfig): void {
    this.ensureNotDisposed()

    // Clear existing timeout if any
    this.clearActivityTimeout(config.activityId)

    const timeoutMs = parseDuration(
      config.scheduleToCloseTimeout ?? config.startToCloseTimeout ?? 0
    )
    if (timeoutMs === 0) return

    const fireAt = this.currentTime + timeoutMs

    const timeout = setTimeout(() => {
      const state = this.activityTimeouts.get(config.activityId)
      if (state?.onTimeout) {
        Promise.resolve(state.onTimeout()).catch(console.error)
      }
      this.activityTimeouts.delete(config.activityId)
    }, timeoutMs)

    this.activityTimeouts.set(config.activityId, {
      activityId: config.activityId,
      fireAt,
      timeout,
      onTimeout: config.onTimeout,
    })
  }

  /**
   * Clear an activity timeout.
   */
  clearActivityTimeout(activityId: string): void {
    const state = this.activityTimeouts.get(activityId)
    if (state) {
      clearTimeout(state.timeout)
      this.activityTimeouts.delete(activityId)
    }
  }

  /**
   * Check if an activity has an active timeout.
   */
  hasActivityTimeout(activityId: string): boolean {
    return this.activityTimeouts.has(activityId)
  }

  /**
   * Get remaining time until activity timeout.
   */
  getActivityTimeoutRemaining(activityId: string): number | null {
    const state = this.activityTimeouts.get(activityId)
    if (!state) return null
    return Math.max(0, state.fireAt - this.currentTime)
  }

  // ==========================================================================
  // Time Management (for testing)
  // ==========================================================================

  /**
   * Manually advance time (for testing).
   */
  advanceTime(ms: number): void {
    this.currentTime += ms
    this.windowManager.advanceWatermark(this.currentTime)

    // Check and fire timers that should have fired
    for (const [timerId, timer] of this.activeTimers) {
      if (timer.pending && this.currentTime >= timer.fireAt) {
        timer.pending = false
        this.activeTimers.delete(timerId)

        if (timer.onFire) {
          Promise.resolve(timer.onFire()).catch(console.error)
        }

        timer.resolve()
        this.removeFromCoalescedBucket(timer)
      }
    }

    // Check workflow timeouts
    for (const [workflowId, state] of this.workflowTimeouts) {
      if (this.currentTime >= state.fireAt) {
        if (state.onTimeout) {
          Promise.resolve(state.onTimeout()).catch(console.error)
        }
        this.workflowTimeouts.delete(workflowId)
        clearTimeout(state.timeout)
      }
    }
  }

  /**
   * Get current watermark.
   */
  getWatermark(): number {
    return this.currentTime
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get number of active timers.
   */
  getActiveTimerCount(): number {
    return this.activeTimers.size
  }

  /**
   * Get number of active windows.
   */
  getActiveWindowCount(): number {
    return this.activeTimers.size
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  private startCleanup(): void {
    if (this.cleanupIntervalId) return

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupStaleTimers()
    }, this.cleanupIntervalMs)

    // Unref the interval so it doesn't prevent process exit
    if (typeof this.cleanupIntervalId === 'object' && 'unref' in this.cleanupIntervalId) {
      (this.cleanupIntervalId as NodeJS.Timeout).unref()
    }
  }

  private stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }
  }

  private cleanupStaleTimers(): void {
    const now = this.currentTime
    const staleTimers: string[] = []

    for (const [timerId, timer] of this.activeTimers) {
      // Timer is stale if it's past its expected fire time + threshold
      if (timer.pending && now > timer.fireAt + this.staleThresholdMs) {
        staleTimers.push(timerId)
      }
    }

    for (const timerId of staleTimers) {
      const timer = this.activeTimers.get(timerId)
      if (timer) {
        timer.pending = false
        this.activeTimers.delete(timerId)
        this.removeFromCoalescedBucket(timer)
        this.metrics.incrementCounter('timer.stale_cleanup', { timerId })
      }
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('TimerWindowManager has been disposed')
    }
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // Stop cleanup interval
    this.stopCleanup()

    // Cancel all active timers
    for (const [timerId, timer] of this.activeTimers) {
      if (timer.pending) {
        timer.pending = false
        timer.reject(new Error('TimerWindowManager disposed'))
      }
    }
    this.activeTimers.clear()

    // Clear all bucket timeouts
    for (const timeoutId of this.bucketTimeouts.values()) {
      clearTimeout(timeoutId)
    }
    this.bucketTimeouts.clear()
    this.coalescedBuckets.clear()

    // Clear all workflow timeouts
    for (const state of this.workflowTimeouts.values()) {
      clearTimeout(state.timeout)
    }
    this.workflowTimeouts.clear()

    // Stop all heartbeat tracking
    for (const state of this.heartbeatTracking.values()) {
      clearTimeout(state.timeout)
    }
    this.heartbeatTracking.clear()

    // Clear all activity timeouts
    for (const state of this.activityTimeouts.values()) {
      clearTimeout(state.timeout)
    }
    this.activityTimeouts.clear()

    // Dispose WindowManager
    this.windowManager.dispose()
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a duration value to milliseconds.
 */
function parseDuration(duration: Duration | string | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  if (typeof duration === 'string') {
    // Parse string format like "50ms", "5s", "1m", "1h"
    const match = duration.match(/^(\d+)(ms|s|m|h)$/)
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`)
    }
    const value = parseInt(match[1]!, 10)
    const unit = match[2]!
    switch (unit) {
      case 'ms':
        return value
      case 's':
        return value * 1000
      case 'm':
        return value * 60 * 1000
      case 'h':
        return value * 60 * 60 * 1000
      default:
        throw new Error(`Unknown duration unit: ${unit}`)
    }
  }

  // Duration object from window-manager
  if (typeof duration === 'object' && 'toMillis' in duration) {
    return duration.toMillis()
  }

  throw new Error(`Invalid duration: ${duration}`)
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new TimerWindowManager instance.
 */
export function createTimerWindowManager(
  options?: TimerWindowManagerOptions
): TimerWindowManager {
  return new TimerWindowManager(options)
}
