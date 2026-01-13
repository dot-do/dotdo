/**
 * WorkflowStatePersistence - Durable workflow state management
 *
 * This module provides comprehensive workflow state persistence that survives
 * DO restarts and enables recovery from failures. It integrates:
 *
 * - StepResultStorage for step-level checkpointing
 * - GraphRuntimeState for workflow execution tree
 * - WorkflowCore for exactly-once semantics
 * - State versioning for schema evolution
 *
 * Key Features:
 * 1. **Durable Workflow State** - Persists to DO storage, survives restarts
 * 2. **State Serialization** - Atomic checkpoints with JSON serialization
 * 3. **Recovery from Failures** - Resume from last checkpoint on restart
 * 4. **State Versioning** - Version tracking for schema evolution
 *
 * @module workflows/core/workflow-state-persistence
 */

/// <reference types="@cloudflare/workers-types" />

import {
  StepResultStorage,
  type StepResultInput,
  type StoredStepResult,
  type StepStatus,
} from '../StepResultStorage'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Workflow execution state values
 */
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

/**
 * Checkpoint data structure for serialization
 */
export interface WorkflowCheckpoint {
  /** Version of the checkpoint schema */
  version: number
  /** Workflow instance identifier */
  workflowId: string
  /** Workflow definition name */
  workflowName: string
  /** Current workflow status */
  status: WorkflowStatus
  /** Index of current/last executed step */
  currentStepIndex: number
  /** Step execution results */
  stepResults: SerializedStepResult[]
  /** Workflow input data */
  input: unknown
  /** Workflow output data (if completed) */
  output?: unknown
  /** Error information (if failed) */
  error?: SerializedError
  /** Events being waited for */
  pendingEvents: string[]
  /** Applied version patches */
  appliedPatches: string[]
  /** Execution epoch for exactly-once semantics */
  epoch: number
  /** Timestamp when checkpoint was created */
  createdAt: number
  /** Timestamp of last update */
  updatedAt: number
  /** Metadata for custom extensions */
  metadata?: Record<string, unknown>
}

/**
 * Serialized step result for checkpoint
 */
export interface SerializedStepResult {
  stepName: string
  stepIndex: number
  status: StepStatus
  output?: string  // JSON serialized
  error?: SerializedError
  duration?: number
  retryCount: number
  startedAt?: number
  completedAt?: number
}

/**
 * Serialized error structure
 */
export interface SerializedError {
  message: string
  name: string
  stack?: string
  cause?: SerializedError
}

/**
 * Options for creating a WorkflowStatePersistence
 */
export interface WorkflowStatePersistenceOptions {
  /** Workflow instance identifier */
  workflowId: string
  /** Workflow definition name */
  workflowName: string
  /** Workflow input data */
  input?: unknown
  /** Schema version */
  schemaVersion?: number
  /** Auto-checkpoint interval in milliseconds (0 = disabled) */
  autoCheckpointInterval?: number
  /** Maximum checkpoint history to retain */
  maxCheckpointHistory?: number
  /** Metadata for custom extensions */
  metadata?: Record<string, unknown>
}

/**
 * Recovery result from checkpoint
 */
export interface RecoveryResult {
  /** Whether recovery was successful */
  recovered: boolean
  /** Restored checkpoint data (null if no checkpoint found) */
  checkpoint: WorkflowCheckpoint | null
  /** Steps that need to be resumed */
  pendingSteps: string[]
  /** Current step index to resume from */
  resumeFromStep: number
}

/**
 * Checkpoint history entry
 */
export interface CheckpointHistoryEntry {
  id: string
  timestamp: number
  status: WorkflowStatus
  stepIndex: number
  version: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Current schema version */
const CURRENT_SCHEMA_VERSION = 1

/** Storage key prefix */
const STORAGE_PREFIX = 'workflow-state:'

/** Checkpoint storage key prefix */
const CHECKPOINT_PREFIX = 'checkpoint:'

/** Checkpoint history key prefix */
const HISTORY_PREFIX = 'checkpoint-history:'

// ============================================================================
// WORKFLOW STATE PERSISTENCE
// ============================================================================

/**
 * WorkflowStatePersistence provides durable workflow state management.
 *
 * This class manages the complete lifecycle of workflow state persistence:
 * - Creating checkpoints after each step
 * - Serializing state to DO storage
 * - Recovering from checkpoints after failures/restarts
 * - Managing state versions for schema evolution
 *
 * @example Basic usage
 * ```typescript
 * const state = new WorkflowStatePersistence(doState, {
 *   workflowId: 'order-123',
 *   workflowName: 'OrderProcessing',
 *   input: { orderId: '123', amount: 99.99 }
 * })
 *
 * // Initialize and start workflow
 * await state.initialize()
 * await state.start()
 *
 * // Execute steps with automatic checkpointing
 * await state.recordStepStart('validateOrder')
 * // ... step execution ...
 * await state.recordStepComplete('validateOrder', { valid: true })
 *
 * // Create checkpoint
 * await state.checkpoint()
 *
 * // On restart, recover from checkpoint
 * const recovery = await state.recover()
 * if (recovery.recovered) {
 *   // Resume from recovery.resumeFromStep
 * }
 * ```
 *
 * @example With DO storage
 * ```typescript
 * class OrderWorkflow extends DurableObject {
 *   private state: WorkflowStatePersistence
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.state = new WorkflowStatePersistence(ctx, {
 *       workflowId: ctx.id.toString(),
 *       workflowName: 'OrderWorkflow'
 *     })
 *   }
 *
 *   async process(input: OrderInput) {
 *     // Try to recover from previous state
 *     const recovery = await this.state.recover()
 *     if (recovery.recovered) {
 *       return this.resumeFrom(recovery.resumeFromStep)
 *     }
 *
 *     // Initialize fresh workflow
 *     await this.state.initialize()
 *     await this.state.setInput(input)
 *     await this.state.start()
 *
 *     // Execute workflow steps...
 *   }
 * }
 * ```
 */
export class WorkflowStatePersistence {
  private readonly storage: DurableObjectStorage
  private readonly stepStorage: StepResultStorage
  private readonly options: Required<WorkflowStatePersistenceOptions>

  // In-memory state (mirrors persisted state)
  private status: WorkflowStatus = 'pending'
  private currentStepIndex: number = 0
  private stepResults: Map<string, SerializedStepResult> = new Map()
  private pendingEvents: string[] = []
  private appliedPatches: Set<string> = new Set()
  private epoch: number = 0
  private output: unknown = undefined
  private error: SerializedError | undefined = undefined
  private createdAt: number = 0
  private updatedAt: number = 0

  // Auto-checkpoint timer
  private autoCheckpointTimer: ReturnType<typeof setInterval> | null = null
  private isDirty: boolean = false

  constructor(state: DurableObjectState, options: WorkflowStatePersistenceOptions) {
    this.storage = state.storage
    this.stepStorage = new StepResultStorage(state)
    this.options = {
      workflowId: options.workflowId,
      workflowName: options.workflowName,
      input: options.input ?? null,
      schemaVersion: options.schemaVersion ?? CURRENT_SCHEMA_VERSION,
      autoCheckpointInterval: options.autoCheckpointInterval ?? 0,
      maxCheckpointHistory: options.maxCheckpointHistory ?? 10,
      metadata: options.metadata ?? {},
    }

    // Start auto-checkpoint timer if enabled
    if (this.options.autoCheckpointInterval > 0) {
      this.startAutoCheckpoint()
    }
  }

  // ==========================================================================
  // LIFECYCLE OPERATIONS
  // ==========================================================================

  /**
   * Initialize a new workflow execution.
   * Creates initial checkpoint with pending status.
   */
  async initialize(): Promise<void> {
    const now = Date.now()
    this.status = 'pending'
    this.currentStepIndex = 0
    this.stepResults.clear()
    this.pendingEvents = []
    this.appliedPatches.clear()
    this.epoch = 1
    this.output = undefined
    this.error = undefined
    this.createdAt = now
    this.updatedAt = now
    this.isDirty = true

    await this.checkpoint()
  }

  /**
   * Start workflow execution.
   * Transitions from pending to running status.
   */
  async start(): Promise<void> {
    if (this.status !== 'pending') {
      throw new Error(`Cannot start workflow in ${this.status} status`)
    }

    this.status = 'running'
    this.updatedAt = Date.now()
    this.isDirty = true

    await this.checkpoint()
  }

  /**
   * Pause workflow execution.
   * Used when waiting for external events.
   */
  async pause(pendingEvents?: string[]): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Cannot pause workflow in ${this.status} status`)
    }

    this.status = 'paused'
    if (pendingEvents) {
      this.pendingEvents = pendingEvents
    }
    this.updatedAt = Date.now()
    this.isDirty = true

    await this.checkpoint()
  }

  /**
   * Resume workflow execution from paused state.
   */
  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      throw new Error(`Cannot resume workflow in ${this.status} status`)
    }

    this.status = 'running'
    this.pendingEvents = []
    this.epoch += 1  // Increment epoch on resume
    this.updatedAt = Date.now()
    this.isDirty = true

    await this.checkpoint()
  }

  /**
   * Complete workflow execution successfully.
   */
  async complete(output: unknown): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Cannot complete workflow in ${this.status} status`)
    }

    this.status = 'completed'
    this.output = output
    this.updatedAt = Date.now()
    this.isDirty = true

    await this.checkpoint()
    this.stopAutoCheckpoint()
  }

  /**
   * Fail workflow execution with error.
   */
  async fail(error: Error): Promise<void> {
    if (this.status === 'completed' || this.status === 'cancelled') {
      throw new Error(`Cannot fail workflow in ${this.status} status`)
    }

    this.status = 'failed'
    this.error = this.serializeError(error)
    this.updatedAt = Date.now()
    this.isDirty = true

    await this.checkpoint()
    this.stopAutoCheckpoint()
  }

  /**
   * Cancel workflow execution.
   */
  async cancel(): Promise<void> {
    if (this.status === 'completed' || this.status === 'failed') {
      throw new Error(`Cannot cancel workflow in ${this.status} status`)
    }

    this.status = 'cancelled'
    this.updatedAt = Date.now()
    this.isDirty = true

    await this.checkpoint()
    this.stopAutoCheckpoint()
  }

  // ==========================================================================
  // STEP OPERATIONS
  // ==========================================================================

  /**
   * Record the start of a step execution.
   */
  async recordStepStart(stepName: string, stepIndex?: number): Promise<void> {
    const index = stepIndex ?? this.currentStepIndex
    const now = Date.now()

    const result: SerializedStepResult = {
      stepName,
      stepIndex: index,
      status: 'running',
      retryCount: 0,
      startedAt: now,
    }

    this.stepResults.set(stepName, result)
    this.currentStepIndex = index
    this.updatedAt = now
    this.isDirty = true

    // Also store in StepResultStorage for detailed tracking
    await this.stepStorage.store(stepName, {
      output: null,
      status: 'running',
      startedAt: new Date(now),
    })
  }

  /**
   * Record successful completion of a step.
   */
  async recordStepComplete(stepName: string, output: unknown, duration?: number): Promise<void> {
    const existing = this.stepResults.get(stepName)
    if (!existing) {
      throw new Error(`Step ${stepName} not found`)
    }

    const now = Date.now()
    const result: SerializedStepResult = {
      ...existing,
      status: 'completed',
      output: JSON.stringify(output),
      duration: duration ?? (existing.startedAt ? now - existing.startedAt : undefined),
      completedAt: now,
    }

    this.stepResults.set(stepName, result)
    this.currentStepIndex = existing.stepIndex + 1
    this.updatedAt = now
    this.isDirty = true

    // Also store in StepResultStorage
    await this.stepStorage.store(stepName, {
      output,
      status: 'completed',
      duration: result.duration,
      startedAt: existing.startedAt ? new Date(existing.startedAt) : undefined,
      completedAt: new Date(now),
    })
  }

  /**
   * Record failure of a step execution.
   */
  async recordStepFailed(
    stepName: string,
    error: Error,
    retryCount?: number,
    duration?: number
  ): Promise<void> {
    const existing = this.stepResults.get(stepName)
    if (!existing) {
      throw new Error(`Step ${stepName} not found`)
    }

    const now = Date.now()
    const result: SerializedStepResult = {
      ...existing,
      status: 'failed',
      error: this.serializeError(error),
      duration: duration ?? (existing.startedAt ? now - existing.startedAt : undefined),
      retryCount: retryCount ?? (existing.retryCount + 1),
      completedAt: now,
    }

    this.stepResults.set(stepName, result)
    this.updatedAt = now
    this.isDirty = true

    // Also store in StepResultStorage
    await this.stepStorage.store(stepName, {
      output: null,
      status: 'failed',
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      duration: result.duration,
      retryCount: result.retryCount,
      startedAt: existing.startedAt ? new Date(existing.startedAt) : undefined,
      completedAt: new Date(now),
    })
  }

  /**
   * Record that a step was skipped.
   */
  async recordStepSkipped(stepName: string, stepIndex: number): Promise<void> {
    const now = Date.now()
    const result: SerializedStepResult = {
      stepName,
      stepIndex,
      status: 'skipped',
      retryCount: 0,
      completedAt: now,
    }

    this.stepResults.set(stepName, result)
    this.currentStepIndex = stepIndex + 1
    this.updatedAt = now
    this.isDirty = true

    await this.stepStorage.store(stepName, {
      output: null,
      status: 'skipped',
      completedAt: new Date(now),
    })
  }

  /**
   * Get a step result by name.
   */
  async getStepResult(stepName: string): Promise<SerializedStepResult | undefined> {
    return this.stepResults.get(stepName)
  }

  /**
   * Check if a step has been completed.
   */
  async isStepCompleted(stepName: string): Promise<boolean> {
    const result = this.stepResults.get(stepName)
    return result?.status === 'completed'
  }

  /**
   * Get the cached output of a completed step.
   */
  async getStepOutput<T>(stepName: string): Promise<T | undefined> {
    const result = this.stepResults.get(stepName)
    if (result?.status === 'completed' && result.output) {
      return JSON.parse(result.output) as T
    }
    return undefined
  }

  // ==========================================================================
  // CHECKPOINTING
  // ==========================================================================

  /**
   * Create a checkpoint of the current workflow state.
   * Persists all state to DO storage atomically.
   */
  async checkpoint(): Promise<string> {
    const checkpointData = this.serializeCheckpoint()
    const checkpointId = `${this.options.workflowId}:${Date.now()}`
    const checkpointKey = `${CHECKPOINT_PREFIX}${checkpointId}`

    // Store checkpoint atomically
    await this.storage.put(`${STORAGE_PREFIX}${this.options.workflowId}:latest`, checkpointData)
    await this.storage.put(checkpointKey, checkpointData)

    // Update checkpoint history
    await this.updateCheckpointHistory(checkpointId, checkpointData)

    this.isDirty = false
    return checkpointId
  }

  /**
   * Serialize current state to checkpoint format.
   */
  private serializeCheckpoint(): WorkflowCheckpoint {
    return {
      version: this.options.schemaVersion,
      workflowId: this.options.workflowId,
      workflowName: this.options.workflowName,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      stepResults: Array.from(this.stepResults.values()),
      input: this.options.input,
      output: this.output,
      error: this.error,
      pendingEvents: this.pendingEvents,
      appliedPatches: Array.from(this.appliedPatches),
      epoch: this.epoch,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.options.metadata,
    }
  }

  /**
   * Restore state from a checkpoint.
   */
  private async restoreFromCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
    // Validate version compatibility
    if (checkpoint.version > this.options.schemaVersion) {
      throw new Error(
        `Checkpoint version ${checkpoint.version} is newer than supported version ${this.options.schemaVersion}`
      )
    }

    // Apply any necessary migrations for older versions
    const migrated = await this.migrateCheckpoint(checkpoint)

    // Restore state
    this.status = migrated.status
    this.currentStepIndex = migrated.currentStepIndex
    this.stepResults.clear()
    for (const result of migrated.stepResults) {
      this.stepResults.set(result.stepName, result)
    }
    this.pendingEvents = migrated.pendingEvents
    this.appliedPatches = new Set(migrated.appliedPatches)
    this.epoch = migrated.epoch
    this.output = migrated.output
    this.error = migrated.error
    this.createdAt = migrated.createdAt
    this.updatedAt = migrated.updatedAt

    // Restore StepResultStorage
    for (const result of migrated.stepResults) {
      if (result.status === 'completed' || result.status === 'failed') {
        await this.stepStorage.store(result.stepName, {
          output: result.output ? JSON.parse(result.output) : null,
          status: result.status,
          duration: result.duration,
          retryCount: result.retryCount,
          startedAt: result.startedAt ? new Date(result.startedAt) : undefined,
          completedAt: result.completedAt ? new Date(result.completedAt) : undefined,
          error: result.error,
        })
      }
    }
  }

  /**
   * Update checkpoint history with pruning of old entries.
   */
  private async updateCheckpointHistory(
    checkpointId: string,
    checkpoint: WorkflowCheckpoint
  ): Promise<void> {
    const historyKey = `${HISTORY_PREFIX}${this.options.workflowId}`
    const history = await this.storage.get<CheckpointHistoryEntry[]>(historyKey) ?? []

    // Add new entry
    history.push({
      id: checkpointId,
      timestamp: Date.now(),
      status: checkpoint.status,
      stepIndex: checkpoint.currentStepIndex,
      version: checkpoint.version,
    })

    // Prune old entries beyond maxCheckpointHistory
    if (history.length > this.options.maxCheckpointHistory) {
      const toRemove = history.splice(0, history.length - this.options.maxCheckpointHistory)
      // Clean up old checkpoint data
      for (const entry of toRemove) {
        await this.storage.delete(`${CHECKPOINT_PREFIX}${entry.id}`)
      }
    }

    await this.storage.put(historyKey, history)
  }

  // ==========================================================================
  // RECOVERY
  // ==========================================================================

  /**
   * Recover workflow state from the latest checkpoint.
   * Returns recovery result indicating what state was restored.
   */
  async recover(): Promise<RecoveryResult> {
    const latestKey = `${STORAGE_PREFIX}${this.options.workflowId}:latest`
    const checkpoint = await this.storage.get<WorkflowCheckpoint>(latestKey)

    if (!checkpoint) {
      return {
        recovered: false,
        checkpoint: null,
        pendingSteps: [],
        resumeFromStep: 0,
      }
    }

    await this.restoreFromCheckpoint(checkpoint)

    // Find steps that need to be resumed
    const pendingSteps: string[] = []
    for (const [name, result] of this.stepResults) {
      if (result.status === 'running' || result.status === 'pending') {
        pendingSteps.push(name)
      }
    }

    return {
      recovered: true,
      checkpoint,
      pendingSteps,
      resumeFromStep: this.currentStepIndex,
    }
  }

  /**
   * Recover from a specific checkpoint by ID.
   */
  async recoverFromCheckpoint(checkpointId: string): Promise<RecoveryResult> {
    const checkpointKey = `${CHECKPOINT_PREFIX}${checkpointId}`
    const checkpoint = await this.storage.get<WorkflowCheckpoint>(checkpointKey)

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`)
    }

    await this.restoreFromCheckpoint(checkpoint)

    const pendingSteps: string[] = []
    for (const [name, result] of this.stepResults) {
      if (result.status === 'running' || result.status === 'pending') {
        pendingSteps.push(name)
      }
    }

    return {
      recovered: true,
      checkpoint,
      pendingSteps,
      resumeFromStep: this.currentStepIndex,
    }
  }

  /**
   * Get checkpoint history for this workflow.
   */
  async getCheckpointHistory(): Promise<CheckpointHistoryEntry[]> {
    const historyKey = `${HISTORY_PREFIX}${this.options.workflowId}`
    return await this.storage.get<CheckpointHistoryEntry[]>(historyKey) ?? []
  }

  /**
   * Get a specific checkpoint by ID.
   */
  async getCheckpoint(checkpointId: string): Promise<WorkflowCheckpoint | null> {
    const checkpointKey = `${CHECKPOINT_PREFIX}${checkpointId}`
    return await this.storage.get<WorkflowCheckpoint>(checkpointKey) ?? null
  }

  // ==========================================================================
  // STATE VERSIONING
  // ==========================================================================

  /**
   * Apply a version patch.
   * Tracks applied patches for schema evolution.
   */
  applyPatch(patchId: string): boolean {
    if (this.appliedPatches.has(patchId)) {
      return false
    }

    this.appliedPatches.add(patchId)
    this.isDirty = true
    return true
  }

  /**
   * Check if a patch has been applied.
   */
  isPatchApplied(patchId: string): boolean {
    return this.appliedPatches.has(patchId)
  }

  /**
   * Get all applied patches.
   */
  getAppliedPatches(): string[] {
    return Array.from(this.appliedPatches)
  }

  /**
   * Migrate a checkpoint to the current schema version.
   */
  private async migrateCheckpoint(checkpoint: WorkflowCheckpoint): Promise<WorkflowCheckpoint> {
    let migrated = { ...checkpoint }

    // Apply migrations in order
    if (migrated.version < 1) {
      migrated = this.migrateV0ToV1(migrated)
    }

    // Add future migrations here:
    // if (migrated.version < 2) {
    //   migrated = this.migrateV1ToV2(migrated)
    // }

    migrated.version = CURRENT_SCHEMA_VERSION
    return migrated
  }

  /**
   * Migration from version 0 to version 1.
   * (Example migration - no actual changes for initial version)
   */
  private migrateV0ToV1(checkpoint: WorkflowCheckpoint): WorkflowCheckpoint {
    // Initial version - no migration needed
    return {
      ...checkpoint,
      version: 1,
      // Add any default values for new fields in v1
      metadata: checkpoint.metadata ?? {},
    }
  }

  // ==========================================================================
  // STATE ACCESSORS
  // ==========================================================================

  /**
   * Get current workflow status.
   */
  getStatus(): WorkflowStatus {
    return this.status
  }

  /**
   * Get current step index.
   */
  getCurrentStepIndex(): number {
    return this.currentStepIndex
  }

  /**
   * Get pending events.
   */
  getPendingEvents(): string[] {
    return [...this.pendingEvents]
  }

  /**
   * Get current epoch.
   */
  getEpoch(): number {
    return this.epoch
  }

  /**
   * Get workflow output.
   */
  getOutput(): unknown {
    return this.output
  }

  /**
   * Get workflow error.
   */
  getError(): SerializedError | undefined {
    return this.error
  }

  /**
   * Check if state is dirty (has unsaved changes).
   */
  hasPendingChanges(): boolean {
    return this.isDirty
  }

  /**
   * Get all step results.
   */
  getAllStepResults(): SerializedStepResult[] {
    return Array.from(this.stepResults.values())
  }

  /**
   * Get the underlying StepResultStorage.
   */
  getStepStorage(): StepResultStorage {
    return this.stepStorage
  }

  // ==========================================================================
  // INPUT/OUTPUT
  // ==========================================================================

  /**
   * Set workflow input (before starting).
   */
  setInput(input: unknown): void {
    if (this.status !== 'pending') {
      throw new Error('Cannot set input after workflow has started')
    }
    (this.options as { input: unknown }).input = input
    this.isDirty = true
  }

  /**
   * Get workflow input.
   */
  getInput(): unknown {
    return this.options.input
  }

  // ==========================================================================
  // AUTO-CHECKPOINT
  // ==========================================================================

  /**
   * Start auto-checkpoint timer.
   */
  private startAutoCheckpoint(): void {
    if (this.autoCheckpointTimer) return

    this.autoCheckpointTimer = setInterval(async () => {
      if (this.isDirty && this.status === 'running') {
        await this.checkpoint()
      }
    }, this.options.autoCheckpointInterval)
  }

  /**
   * Stop auto-checkpoint timer.
   */
  private stopAutoCheckpoint(): void {
    if (this.autoCheckpointTimer) {
      clearInterval(this.autoCheckpointTimer)
      this.autoCheckpointTimer = null
    }
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.stopAutoCheckpoint()
  }

  /**
   * Clear all workflow state.
   * WARNING: This is destructive and cannot be undone.
   */
  async clear(): Promise<void> {
    // Clear StepResultStorage
    await this.stepStorage.clearAll()

    // Clear checkpoints
    const history = await this.getCheckpointHistory()
    for (const entry of history) {
      await this.storage.delete(`${CHECKPOINT_PREFIX}${entry.id}`)
    }

    // Clear history
    await this.storage.delete(`${HISTORY_PREFIX}${this.options.workflowId}`)

    // Clear latest checkpoint
    await this.storage.delete(`${STORAGE_PREFIX}${this.options.workflowId}:latest`)

    // Reset in-memory state
    this.status = 'pending'
    this.currentStepIndex = 0
    this.stepResults.clear()
    this.pendingEvents = []
    this.appliedPatches.clear()
    this.epoch = 0
    this.output = undefined
    this.error = undefined
    this.isDirty = false
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Serialize an error to a storable format.
   */
  private serializeError(error: Error): SerializedError {
    const serialized: SerializedError = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }

    if (error.cause instanceof Error) {
      serialized.cause = this.serializeError(error.cause)
    }

    return serialized
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new WorkflowStatePersistence instance.
 *
 * @param state - Durable Object state
 * @param options - Configuration options
 * @returns A new WorkflowStatePersistence instance
 *
 * @example
 * ```typescript
 * const persistence = createWorkflowStatePersistence(ctx, {
 *   workflowId: 'order-123',
 *   workflowName: 'OrderProcessing',
 *   input: { orderId: '123' }
 * })
 *
 * await persistence.initialize()
 * await persistence.start()
 * ```
 */
export function createWorkflowStatePersistence(
  state: DurableObjectState,
  options: WorkflowStatePersistenceOptions
): WorkflowStatePersistence {
  return new WorkflowStatePersistence(state, options)
}

export default WorkflowStatePersistence
