/**
 * WorkflowCore - Unified workflow execution foundation
 *
 * Composes ExactlyOnceContext, WorkflowHistory, SchemaEvolution, and WindowManager
 * into a single, cohesive workflow execution abstraction.
 *
 * This provides the foundational capabilities for all workflow compat layers:
 * - Step execution with exactly-once semantics
 * - Event history with time-travel queries (via WorkflowHistory backed by TemporalStore)
 * - Workflow versioning and patching
 * - Timer/sleep management
 * - Checkpoint/restore for durability
 */

import {
  ExactlyOnceContext,
  createExactlyOnceContext,
  type CheckpointState as EOCCheckpointState,
} from '../../db/primitives/exactly-once-context'

import {
  createSchemaEvolution,
  type SchemaEvolution,
} from '../../db/primitives/schema-evolution'

import {
  WindowManager,
  milliseconds as windowMilliseconds,
  type Duration,
} from '../../db/primitives/window-manager'

import { type MetricsCollector, noopMetrics } from '../../db/primitives/observability'

import {
  WorkflowHistory,
  createWorkflowHistory,
  type HistoryEvent,
  type RetentionPolicy,
} from './workflow-history'

// ============================================================================
// Types
// ============================================================================

/**
 * Workflow event for history tracking
 */
export interface WorkflowEvent {
  type: string
  timestamp: number
  stepId?: string
  result?: unknown
  [key: string]: unknown
}

/**
 * Timer handle returned by createTimer
 */
export interface TimerHandle {
  /** Unique timer ID */
  timerId: string
  /** Promise that resolves when timer fires */
  promise: Promise<void>
  /** Cancel the timer */
  cancel: () => boolean
}

/**
 * Checkpoint state for durability
 */
export interface CheckpointState {
  workflowId: string
  version: number
  completedSteps: string[]
  appliedPatches: string[]
  events: WorkflowEvent[]
  epoch: number
}

/**
 * Options for creating a WorkflowCore
 */
export interface WorkflowCoreOptions {
  /** Unique workflow instance ID */
  workflowId: string
  /** Optional run ID for this execution */
  runId?: string
  /** Optional metrics collector */
  metrics?: MetricsCollector
  /** TTL for step deduplication (ms) */
  stepIdTtl?: number
  /** Default retention policy for workflow history */
  historyRetention?: RetentionPolicy
}

// ============================================================================
// WorkflowCore Implementation
// ============================================================================

/**
 * WorkflowCore composes unified primitives into a workflow execution foundation.
 */
export class WorkflowCore {
  private readonly workflowId: string
  private readonly runId: string
  private readonly metrics: MetricsCollector

  // Composed primitives
  private readonly exactlyOnce: ExactlyOnceContext
  private readonly workflowHistory: WorkflowHistory
  private readonly schemaEvolution: SchemaEvolution
  private readonly windowManager: WindowManager<TimerEvent>

  // Internal state
  private appliedPatches = new Set<string>()
  private activeTimers = new Map<string, TimerState>()
  private timerCounter = 0

  constructor(options: WorkflowCoreOptions) {
    if (!options.workflowId) {
      throw new Error('workflowId is required')
    }

    this.workflowId = options.workflowId
    this.runId = options.runId ?? `run-${Date.now()}`
    this.metrics = options.metrics ?? noopMetrics

    // Initialize primitives
    this.exactlyOnce = createExactlyOnceContext({
      eventIdTtl: options.stepIdTtl ?? 24 * 60 * 60 * 1000, // 24 hours default
      metrics: this.metrics,
    })

    // Use WorkflowHistory for time-travel enabled event tracking
    this.workflowHistory = createWorkflowHistory({
      workflowId: options.workflowId,
      runId: this.runId,
      metrics: this.metrics,
      retention: options.historyRetention,
    })

    this.schemaEvolution = createSchemaEvolution()

    this.windowManager = new WindowManager<TimerEvent>(
      WindowManager.global<TimerEvent>(),
      { metrics: this.metrics }
    )
  }

  // ==========================================================================
  // Step Execution (ExactlyOnceContext)
  // ==========================================================================

  /**
   * Execute a step exactly once, returning cached result on replay.
   */
  async executeStep<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
    const eventId = `${this.workflowId}:${this.runId}:step:${stepId}`
    return this.exactlyOnce.processOnce(eventId, fn)
  }

  /**
   * Check if a step has been completed.
   */
  async isStepCompleted(stepId: string): Promise<boolean> {
    const eventId = `${this.workflowId}:${this.runId}:step:${stepId}`
    return this.exactlyOnce.isProcessed(eventId)
  }

  // ==========================================================================
  // History (WorkflowHistory backed by TemporalStore)
  // ==========================================================================

  /**
   * Record a workflow event to history.
   */
  async recordEvent(event: WorkflowEvent): Promise<void> {
    await this.workflowHistory.recordEvent(event)
  }

  /**
   * Get all workflow history events.
   */
  async getHistory(): Promise<WorkflowEvent[]> {
    return this.workflowHistory.getEvents()
  }

  /**
   * Get history as of a specific timestamp (time-travel query).
   */
  async getHistoryAsOf(timestamp: number): Promise<WorkflowEvent[]> {
    return this.workflowHistory.getEventsAsOf(timestamp)
  }

  /**
   * Get current history length.
   */
  async getHistoryLength(): Promise<number> {
    return this.workflowHistory.getLength()
  }

  /**
   * Create a snapshot of the current workflow history.
   * Useful for Continue-As-New and checkpointing.
   *
   * @returns Unique snapshot identifier
   */
  async snapshotHistory(): Promise<string> {
    return this.workflowHistory.snapshot()
  }

  /**
   * Restore workflow history to a previous snapshot.
   *
   * @param snapshotId - Snapshot to restore
   */
  async restoreHistorySnapshot(snapshotId: string): Promise<void> {
    return this.workflowHistory.restoreSnapshot(snapshotId)
  }

  /**
   * Prune old history events based on retention policy.
   * Useful for Continue-As-New to prevent unbounded history growth.
   *
   * @param policy - Retention policy to apply
   */
  async pruneHistory(policy?: RetentionPolicy): Promise<{ versionsRemoved: number }> {
    return this.workflowHistory.prune(policy)
  }

  // ==========================================================================
  // Versioning (SchemaEvolution)
  // ==========================================================================

  /**
   * Apply a version patch.
   * Returns true if patch was newly applied, false if already applied.
   */
  applyPatch(patchId: string): boolean {
    if (this.appliedPatches.has(patchId)) {
      return false
    }

    // Initialize schema if needed
    if (this.schemaEvolution.getVersion() === 0) {
      this.schemaEvolution.inferSchema([{ patchId }])
    }

    // Create a diff to evolve schema
    const currentSchema = this.schemaEvolution.getSchema()
    const newSchema = {
      ...currentSchema,
      version: currentSchema.version + 1,
      fields: new Map(currentSchema.fields),
      requiredFields: new Set(currentSchema.requiredFields),
    }
    newSchema.fields.set(patchId, 'string')

    const diff = this.schemaEvolution.diff(currentSchema, newSchema)
    this.schemaEvolution.evolve(diff)

    this.appliedPatches.add(patchId)
    return true
  }

  /**
   * Check if a patch has been applied.
   */
  isPatchApplied(patchId: string): boolean {
    return this.appliedPatches.has(patchId)
  }

  /**
   * Get current workflow version.
   */
  getVersion(): number {
    return this.appliedPatches.size
  }

  // ==========================================================================
  // Timers (WindowManager)
  // ==========================================================================

  /**
   * Create a timer that fires after the specified duration.
   */
  createTimer(duration: Duration | string | number): TimerHandle {
    const timerId = `${this.workflowId}:timer:${++this.timerCounter}`
    const durationMs = parseDuration(duration)

    let resolveTimer: () => void
    let rejectTimer: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveTimer = resolve
      rejectTimer = reject
    })

    const timeout = setTimeout(() => {
      const timer = this.activeTimers.get(timerId)
      if (timer) {
        timer.resolve()
        this.activeTimers.delete(timerId)
      }
    }, durationMs)

    const timerState: TimerState = {
      timerId,
      timeout,
      resolve: resolveTimer!,
      reject: rejectTimer!,
    }

    this.activeTimers.set(timerId, timerState)

    // Process through window manager for tracking
    const event: TimerEvent = {
      timerId,
      scheduledAt: Date.now(),
      fireAt: Date.now() + durationMs,
    }
    this.windowManager.process(event, event.scheduledAt)

    return {
      timerId,
      promise,
      cancel: () => this.cancelTimer(timerId),
    }
  }

  /**
   * Sleep for the specified duration.
   */
  async sleep(duration: Duration | string | number): Promise<void> {
    const handle = this.createTimer(duration)
    return handle.promise
  }

  /**
   * Cancel a timer by ID.
   */
  private cancelTimer(timerId: string): boolean {
    const timer = this.activeTimers.get(timerId)
    if (timer) {
      clearTimeout(timer.timeout)
      timer.reject(new Error('Timer cancelled'))
      this.activeTimers.delete(timerId)
      return true
    }
    return false
  }

  // ==========================================================================
  // Checkpointing
  // ==========================================================================

  /**
   * Create a checkpoint of current workflow state.
   */
  async checkpoint(): Promise<CheckpointState> {
    const eocState = await this.exactlyOnce.getCheckpointState()

    // Extract completed steps from processed IDs
    const completedSteps: string[] = []
    const stepPrefix = `${this.workflowId}:${this.runId}:step:`
    for (const id of eocState.processedIds) {
      if (id.startsWith(stepPrefix)) {
        completedSteps.push(id.slice(stepPrefix.length))
      }
    }

    // Get events from workflow history
    const events = await this.workflowHistory.getEvents()

    return {
      workflowId: this.workflowId,
      version: this.getVersion(),
      completedSteps,
      appliedPatches: Array.from(this.appliedPatches),
      events,
      epoch: eocState.epoch,
    }
  }

  /**
   * Restore workflow state from a checkpoint.
   */
  async restore(state: CheckpointState): Promise<void> {
    // Restore exactly-once state
    const stepPrefix = `${this.workflowId}:${this.runId}:step:`
    const processedIds = new Set<string>()
    for (const stepId of state.completedSteps) {
      processedIds.add(stepPrefix + stepId)
    }

    const eocState: EOCCheckpointState = {
      state: new Map(),
      processedIds,
      pendingEvents: [],
      epoch: state.epoch,
    }
    await this.exactlyOnce.restoreFromCheckpoint(eocState)

    // Restore patches
    this.appliedPatches = new Set(state.appliedPatches)

    // Restore events via workflow history
    await this.workflowHistory.importCheckpoint({
      workflowId: this.workflowId,
      events: state.events,
      historyTimestamp: state.events.length > 0
        ? Math.max(...state.events.map((e) => e.timestamp))
        : 0,
    })

    // Restore schema version
    for (const patchId of state.appliedPatches) {
      if (this.schemaEvolution.getVersion() === 0) {
        this.schemaEvolution.inferSchema([{ patchId }])
      }
      const currentSchema = this.schemaEvolution.getSchema()
      if (!currentSchema.fields.has(patchId)) {
        const newSchema = {
          ...currentSchema,
          version: currentSchema.version + 1,
          fields: new Map(currentSchema.fields),
          requiredFields: new Set(currentSchema.requiredFields),
        }
        newSchema.fields.set(patchId, 'string')
        const diff = this.schemaEvolution.diff(currentSchema, newSchema)
        await this.schemaEvolution.evolve(diff)
      }
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    // Cancel all active timers
    for (const [timerId, timer] of this.activeTimers) {
      clearTimeout(timer.timeout)
      timer.reject(new Error('WorkflowCore disposed'))
    }
    this.activeTimers.clear()

    // Dispose window manager
    this.windowManager.dispose()

    // Dispose workflow history
    this.workflowHistory.dispose()

    // Clear exactly-once state
    this.exactlyOnce.clear()
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface TimerEvent {
  timerId: string
  scheduledAt: number
  fireAt: number
}

interface TimerState {
  timerId: string
  timeout: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (error: Error) => void
}

// ============================================================================
// Helpers
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
 * Create a new WorkflowCore instance.
 */
export function createWorkflowCore(options: WorkflowCoreOptions): WorkflowCore {
  return new WorkflowCore(options)
}
