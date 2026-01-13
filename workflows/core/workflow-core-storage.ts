/**
 * WorkflowCore Storage Strategy - Bridges WorkflowCore with compat layer storage strategies
 *
 * This module provides a storage strategy implementation that uses WorkflowCore
 * as the underlying abstraction, enabling all workflow compat layers (Temporal,
 * Inngest, Trigger.dev) to share the same unified primitives:
 *
 * - ExactlyOnceContext for idempotent step execution
 * - WorkflowHistory (backed by TemporalStore) for time-travel debugging
 * - WindowManager for timer/sleep management
 * - SchemaEvolution for workflow versioning
 *
 * This replaces the need for each compat layer to independently implement
 * these capabilities, reducing code duplication and ensuring consistent behavior.
 *
 * @module workflows/core/workflow-core-storage
 */

import {
  WorkflowCore,
  createWorkflowCore,
  type WorkflowCoreOptions,
  type CheckpointState,
  type TimerHandle,
} from './workflow-core'

import type { MetricsCollector } from '../../db/primitives/observability'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for step execution
 */
export interface StepExecutionOptions {
  /** Timeout for the step (duration string or ms) */
  timeout?: string | number
  /** Retry configuration */
  retries?: {
    limit?: number
    delay?: string | number
    backoff?: 'exponential' | 'linear' | 'constant'
  }
}

/**
 * Cached step result (discriminated union for type safety)
 */
export type CachedStepResult<T = unknown> =
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }

/**
 * Storage strategy interface that matches the existing compat layer patterns.
 * This is the contract that WorkflowCoreStorageStrategy implements.
 */
export interface WorkflowStorageStrategy {
  /**
   * Execute a step with automatic caching and optional durability.
   */
  executeStep<T>(name: string, fn: () => T | Promise<T>, options?: StepExecutionOptions): Promise<T>

  /**
   * Sleep for a duration (using WorkflowCore timer management).
   */
  sleep(name: string, durationMs: number, durationStr: string): Promise<void>

  /**
   * Check if a step has been completed.
   */
  isStepCompleted(name: string): Promise<boolean>

  /**
   * Get the cached result of a completed step.
   */
  getStepResult<T>(name: string): Promise<T | undefined>

  /**
   * Store a step result (for replay).
   */
  setStepResult(name: string, result: unknown): Promise<void>
}

/**
 * Options for creating a WorkflowCoreStorageStrategy
 */
export interface WorkflowCoreStorageOptions {
  /** Unique workflow instance ID */
  workflowId: string
  /** Optional run ID for this execution */
  runId?: string
  /** Optional metrics collector */
  metrics?: MetricsCollector
  /** TTL for step deduplication (ms) */
  stepIdTtl?: number
  /** Enable history tracking (default: true) */
  enableHistory?: boolean
  /** Retention policy for history */
  historyRetention?: {
    maxVersions?: number
    maxAge?: number | string
  }
}

// ============================================================================
// WorkflowCoreStorageStrategy Implementation
// ============================================================================

/**
 * WorkflowCoreStorageStrategy implements the storage strategy interface
 * using WorkflowCore as the underlying primitive composition.
 *
 * This enables all workflow compat layers to share the same:
 * - Exactly-once step execution semantics
 * - Time-travel enabled history
 * - Timer management with WindowManager
 * - Workflow versioning with SchemaEvolution
 *
 * @example
 * ```typescript
 * const strategy = new WorkflowCoreStorageStrategy({
 *   workflowId: 'order-processing-123',
 *   enableHistory: true
 * })
 *
 * // Execute steps with exactly-once semantics
 * const result = await strategy.executeStep('fetch-order', async () => {
 *   return await fetchOrder(orderId)
 * })
 *
 * // Sleep with timer management
 * await strategy.sleep('wait-for-payment', 5000, '5s')
 *
 * // Create checkpoint for durability
 * const checkpoint = await strategy.checkpoint()
 * ```
 */
export class WorkflowCoreStorageStrategy implements WorkflowStorageStrategy {
  private readonly core: WorkflowCore
  private readonly options: WorkflowCoreStorageOptions
  private readonly enableHistory: boolean

  // Local step result cache for fast lookups (supplements WorkflowCore's tracking)
  private readonly stepResultCache = new Map<string, CachedStepResult>()

  constructor(options: WorkflowCoreStorageOptions) {
    if (!options.workflowId) {
      throw new Error('workflowId is required')
    }

    this.options = options
    this.enableHistory = options.enableHistory ?? true

    // Initialize WorkflowCore with composed primitives
    this.core = createWorkflowCore({
      workflowId: options.workflowId,
      runId: options.runId,
      metrics: options.metrics,
      stepIdTtl: options.stepIdTtl,
      historyRetention: options.historyRetention,
    })
  }

  // ==========================================================================
  // Step Execution (via WorkflowCore's ExactlyOnceContext)
  // ==========================================================================

  /**
   * Execute a step with exactly-once semantics.
   * Uses WorkflowCore.executeStep which is backed by ExactlyOnceContext.
   */
  async executeStep<T>(
    name: string,
    fn: () => T | Promise<T>,
    _options?: StepExecutionOptions
  ): Promise<T> {
    // Check local cache first
    const cached = this.stepResultCache.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    try {
      // Execute via WorkflowCore (handles deduplication)
      const result = await this.core.executeStep(name, async () => fn())

      // Cache locally for fast subsequent lookups
      this.stepResultCache.set(name, { status: 'success', value: result })

      // Record in history if enabled
      if (this.enableHistory) {
        await this.core.recordEvent({
          type: 'STEP_COMPLETED',
          timestamp: Date.now(),
          stepId: name,
          result,
        })
      }

      return result
    } catch (error) {
      // Cache error for consistent behavior on retry attempts
      const err = error instanceof Error ? error : new Error(String(error))
      this.stepResultCache.set(name, { status: 'error', error: err })

      // Record failure in history if enabled
      if (this.enableHistory) {
        await this.core.recordEvent({
          type: 'STEP_FAILED',
          timestamp: Date.now(),
          stepId: name,
          error: err.message,
        })
      }

      throw err
    }
  }

  // ==========================================================================
  // Sleep (via WorkflowCore's WindowManager)
  // ==========================================================================

  /**
   * Sleep for a duration using WorkflowCore's timer management.
   * Integrates with WindowManager for efficient timer coalescing.
   */
  async sleep(name: string, durationMs: number, durationStr: string): Promise<void> {
    // Check if already completed (for replay)
    if (this.stepResultCache.has(name)) {
      return
    }

    // Check via WorkflowCore
    if (await this.core.isStepCompleted(name)) {
      this.stepResultCache.set(name, { status: 'success', value: true })
      return
    }

    // Record sleep start in history
    if (this.enableHistory) {
      await this.core.recordEvent({
        type: 'TIMER_STARTED',
        timestamp: Date.now(),
        timerId: name,
        duration: durationStr,
        durationMs,
      })
    }

    // Use WorkflowCore's sleep (backed by WindowManager timers)
    await this.core.sleep(durationMs)

    // Mark as completed
    this.stepResultCache.set(name, { status: 'success', value: true })

    // Record sleep completion in history
    if (this.enableHistory) {
      await this.core.recordEvent({
        type: 'TIMER_FIRED',
        timestamp: Date.now(),
        timerId: name,
      })
    }
  }

  // ==========================================================================
  // Step Status Queries
  // ==========================================================================

  /**
   * Check if a step has been completed.
   */
  async isStepCompleted(name: string): Promise<boolean> {
    // Check local cache first
    if (this.stepResultCache.has(name)) {
      return true
    }

    // Check WorkflowCore's exactly-once context
    return this.core.isStepCompleted(name)
  }

  /**
   * Get the cached result of a completed step.
   */
  async getStepResult<T>(name: string): Promise<T | undefined> {
    const cached = this.stepResultCache.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }
    return undefined
  }

  /**
   * Store a step result (for replay or external persistence).
   */
  async setStepResult(name: string, result: unknown): Promise<void> {
    if (result instanceof Error) {
      this.stepResultCache.set(name, { status: 'error', error: result })
    } else {
      this.stepResultCache.set(name, { status: 'success', value: result })
    }
  }

  // ==========================================================================
  // History Access (via WorkflowCore's WorkflowHistory)
  // ==========================================================================

  /**
   * Get all workflow history events.
   * Provides time-travel debugging capability.
   */
  async getHistory() {
    return this.core.getHistory()
  }

  /**
   * Get history as of a specific timestamp.
   * Enables time-travel debugging.
   */
  async getHistoryAsOf(timestamp: number) {
    return this.core.getHistoryAsOf(timestamp)
  }

  /**
   * Get current history length.
   */
  async getHistoryLength(): Promise<number> {
    return this.core.getHistoryLength()
  }

  // ==========================================================================
  // Versioning (via WorkflowCore's SchemaEvolution)
  // ==========================================================================

  /**
   * Apply a version patch for workflow evolution.
   */
  applyPatch(patchId: string): boolean {
    return this.core.applyPatch(patchId)
  }

  /**
   * Check if a patch has been applied.
   */
  isPatchApplied(patchId: string): boolean {
    return this.core.isPatchApplied(patchId)
  }

  /**
   * Get current workflow version.
   */
  getVersion(): number {
    return this.core.getVersion()
  }

  // ==========================================================================
  // Checkpointing
  // ==========================================================================

  /**
   * Create a checkpoint of current workflow state.
   * Can be used for Continue-As-New or durability.
   */
  async checkpoint(): Promise<CheckpointState> {
    return this.core.checkpoint()
  }

  /**
   * Restore workflow state from a checkpoint.
   */
  async restore(state: CheckpointState): Promise<void> {
    // Clear local cache
    this.stepResultCache.clear()

    // Restore WorkflowCore state
    await this.core.restore(state)

    // Rebuild local cache from completed steps
    for (const stepId of state.completedSteps) {
      this.stepResultCache.set(stepId, { status: 'success', value: undefined })
    }
  }

  // ==========================================================================
  // Timer Management (direct access)
  // ==========================================================================

  /**
   * Create a timer that fires after the specified duration.
   */
  createTimer(duration: number | string): TimerHandle {
    return this.core.createTimer(duration)
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clear local cache (for testing).
   */
  clear(): void {
    this.stepResultCache.clear()
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.stepResultCache.clear()
    this.core.dispose()
  }

  // ==========================================================================
  // Access to underlying WorkflowCore
  // ==========================================================================

  /**
   * Get the underlying WorkflowCore instance.
   * Useful for advanced operations like history snapshots.
   */
  getCore(): WorkflowCore {
    return this.core
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new WorkflowCoreStorageStrategy instance.
 *
 * @param options - Configuration options
 * @returns New strategy instance
 *
 * @example
 * ```typescript
 * const strategy = createWorkflowCoreStorageStrategy({
 *   workflowId: 'order-123',
 *   enableHistory: true,
 *   historyRetention: { maxVersions: 100, maxAge: '7d' }
 * })
 * ```
 */
export function createWorkflowCoreStorageStrategy(
  options: WorkflowCoreStorageOptions
): WorkflowCoreStorageStrategy {
  return new WorkflowCoreStorageStrategy(options)
}
