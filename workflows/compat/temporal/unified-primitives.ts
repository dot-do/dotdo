/**
 * Unified Primitives Integration for Temporal Compat Layer
 *
 * This module integrates the unified primitives from db/primitives/ into the
 * Temporal-compatible workflow engine:
 *
 * - ExactlyOnceContext: Idempotent activity execution with deduplication
 * - TemporalStore: Workflow state persistence with history for replay
 * - WindowManager: Timer management for delays/timeouts (sleep, deadlines)
 * - WatermarkService: Event time tracking for distributed coordination
 *
 * These primitives provide production-grade durability and exactly-once
 * semantics that go beyond the basic in-memory implementation.
 */

import {
  ExactlyOnceContext,
  createExactlyOnceContext,
  type ExactlyOnceContextOptions,
  type Transaction,
  type CheckpointState,
} from '../../../db/primitives/exactly-once-context'

import {
  createTemporalStore,
  type TemporalStore,
  type TemporalStoreOptions,
  type RetentionPolicy,
  type TimeRange,
} from '../../../db/primitives/temporal-store'

import {
  WindowManager,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Trigger,
  TriggerResult,
  type Window,
  type Duration,
  seconds,
  minutes,
  hours,
  milliseconds,
} from '../../../db/primitives/window-manager'

import {
  WatermarkService,
  createWatermarkService,
} from '../../../db/primitives/watermark-service'

// ============================================================================
// Activity Deduplication Context
// ============================================================================

/**
 * Enhanced activity context that provides exactly-once execution semantics.
 * Wraps activities to ensure they are idempotent even if called multiple times
 * during workflow replay.
 */
export interface ActivityDeduplicationContext {
  /**
   * Execute an activity exactly once, returning cached result on retry.
   *
   * @param activityId - Unique identifier for this activity invocation
   * @param execute - The activity function to execute
   * @returns The activity result (cached on replay)
   */
  executeOnce<T>(activityId: string, execute: () => Promise<T>): Promise<T>

  /**
   * Check if an activity has already been executed.
   */
  isExecuted(activityId: string): Promise<boolean>

  /**
   * Execute a compensatable activity with rollback support.
   *
   * @param activityId - Unique identifier for this activity
   * @param execute - Forward action
   * @param compensate - Rollback action if saga fails
   */
  executeCompensatable<T>(
    activityId: string,
    execute: () => Promise<T>,
    compensate: (result: T) => Promise<void>
  ): Promise<T>

  /**
   * Get the underlying ExactlyOnceContext for advanced usage.
   */
  getContext(): ExactlyOnceContext
}

/**
 * Create an activity deduplication context for a workflow.
 */
export function createActivityDeduplicationContext(
  workflowId: string,
  options?: ExactlyOnceContextOptions
): ActivityDeduplicationContext {
  const ctx = createExactlyOnceContext({
    eventIdTtl: options?.eventIdTtl ?? 24 * 60 * 60 * 1000, // 24 hours default
    maxBufferedEvents: options?.maxBufferedEvents ?? 1000,
    onDeliver: options?.onDeliver,
    metrics: options?.metrics,
  })

  // Track compensations for saga pattern
  const compensations = new Map<string, { result: unknown; compensate: (result: unknown) => Promise<void> }>()

  return {
    async executeOnce<T>(activityId: string, execute: () => Promise<T>): Promise<T> {
      const eventId = `${workflowId}:activity:${activityId}`
      return ctx.processOnce(eventId, execute)
    },

    async isExecuted(activityId: string): Promise<boolean> {
      const eventId = `${workflowId}:activity:${activityId}`
      return ctx.isProcessed(eventId)
    },

    async executeCompensatable<T>(
      activityId: string,
      execute: () => Promise<T>,
      compensate: (result: T) => Promise<void>
    ): Promise<T> {
      const eventId = `${workflowId}:activity:${activityId}`

      const result = await ctx.processOnce(eventId, execute)

      // Store compensation for potential rollback
      compensations.set(activityId, {
        result,
        compensate: compensate as (result: unknown) => Promise<void>,
      })

      return result
    },

    getContext(): ExactlyOnceContext {
      return ctx
    },
  }
}

// ============================================================================
// Workflow History Store
// ============================================================================

/**
 * Workflow event types for history tracking
 */
export type WorkflowEventType =
  | 'WORKFLOW_STARTED'
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_FAILED'
  | 'WORKFLOW_CANCELED'
  | 'WORKFLOW_TIMED_OUT'
  | 'ACTIVITY_SCHEDULED'
  | 'ACTIVITY_STARTED'
  | 'ACTIVITY_COMPLETED'
  | 'ACTIVITY_FAILED'
  | 'ACTIVITY_TIMED_OUT'
  | 'TIMER_STARTED'
  | 'TIMER_FIRED'
  | 'TIMER_CANCELED'
  | 'SIGNAL_RECEIVED'
  | 'QUERY_RECEIVED'
  | 'CHILD_WORKFLOW_INITIATED'
  | 'CHILD_WORKFLOW_COMPLETED'
  | 'CHILD_WORKFLOW_FAILED'
  | 'MARKER_RECORDED'
  | 'SIDE_EFFECT_RECORDED'

/**
 * Workflow history event
 */
export interface WorkflowHistoryEvent {
  eventId: number
  eventType: WorkflowEventType
  timestamp: number
  attributes: Record<string, unknown>
}

/**
 * Workflow history store using TemporalStore for time-travel queries.
 */
export interface WorkflowHistoryStore {
  /**
   * Append an event to the workflow history.
   */
  appendEvent(event: Omit<WorkflowHistoryEvent, 'eventId' | 'timestamp'>): Promise<WorkflowHistoryEvent>

  /**
   * Get the full history for a workflow.
   */
  getHistory(): Promise<WorkflowHistoryEvent[]>

  /**
   * Get history up to a specific event ID (for replay).
   */
  getHistoryUpTo(eventId: number): Promise<WorkflowHistoryEvent[]>

  /**
   * Get history within a time range.
   */
  getHistoryInRange(range: TimeRange): Promise<WorkflowHistoryEvent[]>

  /**
   * Get the last event of a specific type.
   */
  getLastEventOfType(eventType: WorkflowEventType): Promise<WorkflowHistoryEvent | null>

  /**
   * Create a snapshot of the current history.
   */
  snapshot(): Promise<string>

  /**
   * Restore from a snapshot.
   */
  restore(snapshotId: string): Promise<void>

  /**
   * Get current history length.
   */
  getHistoryLength(): number

  /**
   * Clear all history (for testing).
   */
  clear(): Promise<void>
}

/**
 * Create a workflow history store.
 */
export function createWorkflowHistoryStore(
  workflowId: string,
  options?: TemporalStoreOptions
): WorkflowHistoryStore {
  const store = createTemporalStore<WorkflowHistoryEvent>({
    enableTTL: options?.enableTTL ?? true,
    retention: options?.retention ?? {
      maxVersions: 10000, // Keep up to 10k events per workflow
      maxAge: '30d', // 30 day retention
    },
    metrics: options?.metrics,
  })

  let eventCounter = 0
  const events: WorkflowHistoryEvent[] = []

  return {
    async appendEvent(eventData): Promise<WorkflowHistoryEvent> {
      const event: WorkflowHistoryEvent = {
        eventId: ++eventCounter,
        eventType: eventData.eventType,
        timestamp: Date.now(),
        attributes: eventData.attributes,
      }

      const key = `${workflowId}:event:${event.eventId}`
      await store.put(key, event, event.timestamp)
      events.push(event)

      return event
    },

    async getHistory(): Promise<WorkflowHistoryEvent[]> {
      return [...events]
    },

    async getHistoryUpTo(eventId: number): Promise<WorkflowHistoryEvent[]> {
      return events.filter(e => e.eventId <= eventId)
    },

    async getHistoryInRange(range: TimeRange): Promise<WorkflowHistoryEvent[]> {
      return events.filter(e => {
        if (range.start !== undefined && e.timestamp < range.start) return false
        if (range.end !== undefined && e.timestamp > range.end) return false
        return true
      })
    },

    async getLastEventOfType(eventType: WorkflowEventType): Promise<WorkflowHistoryEvent | null> {
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i]
        if (event && event.eventType === eventType) {
          return event
        }
      }
      return null
    },

    async snapshot(): Promise<string> {
      return store.snapshot()
    },

    async restore(snapshotId: string): Promise<void> {
      await store.restoreSnapshot(snapshotId)
    },

    getHistoryLength(): number {
      return events.length
    },

    async clear(): Promise<void> {
      events.length = 0
      eventCounter = 0
    },
  }
}

// ============================================================================
// Timer Management with WindowManager
// ============================================================================

/**
 * Workflow timer configuration
 */
export interface WorkflowTimerConfig {
  timerId: string
  duration: Duration
  callback?: () => void | Promise<void>
}

/**
 * Timer manager for workflow sleep and timeout operations.
 * Uses WindowManager for efficient timer coalescing and management.
 */
export interface WorkflowTimerManager {
  /**
   * Start a timer that fires after the specified duration.
   */
  startTimer(config: WorkflowTimerConfig): Promise<void>

  /**
   * Cancel a timer by ID.
   */
  cancelTimer(timerId: string): boolean

  /**
   * Check if a timer is active.
   */
  isTimerActive(timerId: string): boolean

  /**
   * Get all active timer IDs.
   */
  getActiveTimers(): string[]

  /**
   * Advance time for testing (simulates timer firing).
   */
  advanceTime(ms: number): void

  /**
   * Dispose of all timers.
   */
  dispose(): void
}

/**
 * Timer event for window processing
 */
interface TimerEvent {
  timerId: string
  scheduledAt: number
  fireAt: number
  callback?: () => void | Promise<void>
}

/**
 * Create a timer manager for a workflow.
 */
export function createWorkflowTimerManager(): WorkflowTimerManager {
  // Use global windows to coalesce timers
  const windowManager = new WindowManager<TimerEvent>(
    WindowManager.global<TimerEvent>()
  )

  // Track active timers
  const activeTimers = new Map<string, {
    fireAt: number
    resolve: () => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
    callback?: () => void | Promise<void>
  }>()

  let currentTime = Date.now()

  // Set up trigger callback
  windowManager.onTrigger((window, elements) => {
    for (const event of elements) {
      const timer = activeTimers.get(event.timerId)
      if (timer && currentTime >= event.fireAt) {
        // Fire the timer
        if (timer.callback) {
          Promise.resolve(timer.callback()).catch(console.error)
        }
        timer.resolve()
        activeTimers.delete(event.timerId)
      }
    }
  })

  return {
    async startTimer(config: WorkflowTimerConfig): Promise<void> {
      return new Promise((resolve, reject) => {
        const scheduledAt = currentTime
        const fireAt = scheduledAt + config.duration.toMillis()

        const event: TimerEvent = {
          timerId: config.timerId,
          scheduledAt,
          fireAt,
          callback: config.callback,
        }

        // Set up the actual timeout
        const timeout = setTimeout(() => {
          const timer = activeTimers.get(config.timerId)
          if (timer) {
            if (timer.callback) {
              Promise.resolve(timer.callback()).catch(console.error)
            }
            timer.resolve()
            activeTimers.delete(config.timerId)
          }
        }, config.duration.toMillis())

        activeTimers.set(config.timerId, {
          fireAt,
          resolve,
          reject,
          timeout,
          callback: config.callback,
        })

        // Process through window manager for tracking
        windowManager.process(event, scheduledAt)
      })
    },

    cancelTimer(timerId: string): boolean {
      const timer = activeTimers.get(timerId)
      if (timer) {
        clearTimeout(timer.timeout)
        timer.reject(new Error('Timer cancelled'))
        activeTimers.delete(timerId)
        return true
      }
      return false
    },

    isTimerActive(timerId: string): boolean {
      return activeTimers.has(timerId)
    },

    getActiveTimers(): string[] {
      return Array.from(activeTimers.keys())
    },

    advanceTime(ms: number): void {
      currentTime += ms

      // Check for timers that should fire
      for (const [timerId, timer] of activeTimers) {
        if (currentTime >= timer.fireAt) {
          clearTimeout(timer.timeout)
          if (timer.callback) {
            Promise.resolve(timer.callback()).catch(console.error)
          }
          timer.resolve()
          activeTimers.delete(timerId)
        }
      }

      // Advance watermark to trigger window processing
      windowManager.advanceWatermark(currentTime)
    },

    dispose(): void {
      // Clear all active timers
      for (const [timerId, timer] of activeTimers) {
        clearTimeout(timer.timeout)
        timer.reject(new Error('Timer manager disposed'))
      }
      activeTimers.clear()
      windowManager.dispose()
    },
  }
}

// ============================================================================
// Deadline Manager
// ============================================================================

/**
 * Deadline configuration for workflow operations
 */
export interface DeadlineConfig {
  deadlineId: string
  deadline: Date | number // Absolute time
  onDeadlineExceeded?: () => void | Promise<void>
}

/**
 * Deadline manager for workflow timeouts and SLAs.
 */
export interface WorkflowDeadlineManager {
  /**
   * Set a deadline for an operation.
   */
  setDeadline(config: DeadlineConfig): void

  /**
   * Clear a deadline.
   */
  clearDeadline(deadlineId: string): void

  /**
   * Check if a deadline has been exceeded.
   */
  isDeadlineExceeded(deadlineId: string): boolean

  /**
   * Get remaining time until deadline (ms).
   */
  getRemainingTime(deadlineId: string): number | null

  /**
   * Dispose of all deadlines.
   */
  dispose(): void
}

/**
 * Create a deadline manager.
 */
export function createWorkflowDeadlineManager(): WorkflowDeadlineManager {
  const deadlines = new Map<string, {
    deadline: number
    timeout: ReturnType<typeof setTimeout>
    exceeded: boolean
    callback?: () => void | Promise<void>
  }>()

  return {
    setDeadline(config: DeadlineConfig): void {
      const deadlineMs = config.deadline instanceof Date
        ? config.deadline.getTime()
        : config.deadline

      const remaining = deadlineMs - Date.now()

      if (remaining <= 0) {
        // Deadline already exceeded
        if (config.onDeadlineExceeded) {
          Promise.resolve(config.onDeadlineExceeded()).catch(console.error)
        }
        deadlines.set(config.deadlineId, {
          deadline: deadlineMs,
          timeout: setTimeout(() => {}, 0),
          exceeded: true,
          callback: config.onDeadlineExceeded,
        })
        return
      }

      const timeout = setTimeout(() => {
        const deadline = deadlines.get(config.deadlineId)
        if (deadline) {
          deadline.exceeded = true
          if (deadline.callback) {
            Promise.resolve(deadline.callback()).catch(console.error)
          }
        }
      }, remaining)

      deadlines.set(config.deadlineId, {
        deadline: deadlineMs,
        timeout,
        exceeded: false,
        callback: config.onDeadlineExceeded,
      })
    },

    clearDeadline(deadlineId: string): void {
      const deadline = deadlines.get(deadlineId)
      if (deadline) {
        clearTimeout(deadline.timeout)
        deadlines.delete(deadlineId)
      }
    },

    isDeadlineExceeded(deadlineId: string): boolean {
      const deadline = deadlines.get(deadlineId)
      if (!deadline) return false
      return deadline.exceeded || Date.now() >= deadline.deadline
    },

    getRemainingTime(deadlineId: string): number | null {
      const deadline = deadlines.get(deadlineId)
      if (!deadline) return null
      const remaining = deadline.deadline - Date.now()
      return remaining > 0 ? remaining : 0
    },

    dispose(): void {
      for (const deadline of deadlines.values()) {
        clearTimeout(deadline.timeout)
      }
      deadlines.clear()
    },
  }
}

// ============================================================================
// Unified Workflow Runtime
// ============================================================================

/**
 * Configuration for the unified workflow runtime
 */
export interface UnifiedWorkflowRuntimeConfig {
  workflowId: string
  runId?: string
  activityDeduplication?: ExactlyOnceContextOptions
  historyStore?: TemporalStoreOptions
}

/**
 * Unified workflow runtime that combines all primitives.
 */
export interface UnifiedWorkflowRuntime {
  /** Activity deduplication context */
  activities: ActivityDeduplicationContext

  /** Workflow history store */
  history: WorkflowHistoryStore

  /** Timer manager */
  timers: WorkflowTimerManager

  /** Deadline manager */
  deadlines: WorkflowDeadlineManager

  /** Watermark service for event time tracking */
  watermarks: WatermarkService

  /** Record a side effect (deterministic random/time) */
  sideEffect<T>(fn: () => T): Promise<T>

  /** Dispose of all resources */
  dispose(): void
}

/**
 * Create a unified workflow runtime with all primitives.
 */
export function createUnifiedWorkflowRuntime(
  config: UnifiedWorkflowRuntimeConfig
): UnifiedWorkflowRuntime {
  const workflowId = config.workflowId
  const runId = config.runId ?? `run-${Date.now()}`

  const activities = createActivityDeduplicationContext(workflowId, config.activityDeduplication)
  const history = createWorkflowHistoryStore(workflowId, config.historyStore)
  const timers = createWorkflowTimerManager()
  const deadlines = createWorkflowDeadlineManager()
  const watermarks = createWatermarkService()

  let sideEffectCounter = 0
  const sideEffectCache = new Map<string, unknown>()

  return {
    activities,
    history,
    timers,
    deadlines,
    watermarks,

    async sideEffect<T>(fn: () => T): Promise<T> {
      const key = `${workflowId}:${runId}:sideEffect:${sideEffectCounter++}`

      // Check cache for replay
      if (sideEffectCache.has(key)) {
        return sideEffectCache.get(key) as T
      }

      // Execute and cache
      const result = fn()
      sideEffectCache.set(key, result)

      // Record in history
      await history.appendEvent({
        eventType: 'SIDE_EFFECT_RECORDED',
        attributes: { key, result },
      })

      return result
    },

    dispose(): void {
      timers.dispose()
      deadlines.dispose()
      // WatermarkService doesn't require disposal
      sideEffectCache.clear()
    },
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  // Re-export primitives for direct access
  ExactlyOnceContext,
  createExactlyOnceContext,
  createTemporalStore,
  WindowManager,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Trigger,
  TriggerResult,
  WatermarkService,
  createWatermarkService,
  // Duration helpers
  seconds,
  minutes,
  hours,
  milliseconds,
}

export type {
  // Re-export types
  ExactlyOnceContextOptions,
  Transaction,
  CheckpointState,
  TemporalStore,
  TemporalStoreOptions,
  RetentionPolicy,
  TimeRange,
  Window,
  Duration,
}
