/**
 * SyncStatus - Sync status tracking and progress reporting
 *
 * This module provides real-time tracking of sync operations with:
 * - State machine for sync lifecycle (pending -> running -> completed/failed/cancelled)
 * - Progress tracking with atomic updates
 * - Event emission for state changes and progress updates
 * - Serialization for persistence across restarts
 *
 * ## Usage Example
 *
 * ```typescript
 * import { SyncStatus, createSyncStatus } from './sync-status'
 *
 * const status = createSyncStatus({
 *   planId: 'plan-123',
 *   totalRecords: 1000,
 * })
 *
 * status.on('progress', ({ percentage }) => {
 *   console.log(`Sync progress: ${percentage}%`)
 * })
 *
 * status.start()
 * status.recordProcessed('added')
 * status.complete()
 * ```
 *
 * @module db/primitives/sync/sync-status
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Valid sync status states
 */
export type SyncStatusState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * Progress counters for sync operations
 */
export interface SyncProgress {
  /** Total number of records to process */
  totalRecords: number
  /** Number of records processed so far */
  processedRecords: number
  /** Number of records added */
  addedCount: number
  /** Number of records modified */
  modifiedCount: number
  /** Number of records deleted */
  deletedCount: number
  /** Number of records that failed to process */
  failedCount: number
}

/**
 * Error information for failed syncs
 */
export interface SyncError {
  /** Error code for categorization */
  code: string
  /** Human-readable error message */
  message: string
  /** Additional error details */
  details?: Record<string, unknown>
}

/**
 * Type of record processing result
 */
export type ProcessedResultType = 'added' | 'modified' | 'deleted' | 'failed'

/**
 * Batch processing result counts
 */
export interface BatchResult {
  added?: number
  modified?: number
  deleted?: number
  failed?: number
}

/**
 * Event types emitted by SyncStatus
 */
export interface SyncStatusEvents {
  started: {
    syncId: string
    planId: string
    startedAt: Date
  }
  completed: {
    syncId: string
    planId: string
    completedAt: Date
    progress: SyncProgress
  }
  failed: {
    syncId: string
    planId: string
    error: SyncError
    completedAt: Date
  }
  cancelled: {
    syncId: string
    planId: string
    completedAt: Date
  }
  progress: {
    syncId: string
    progress: SyncProgress
    percentage: number
  }
  stateChange: {
    syncId: string
    previousState: SyncStatusState
    currentState: SyncStatusState
  }
}

/**
 * Event handler type
 */
export type EventHandler<T> = (data: T) => void

/**
 * Serialized SyncStatus for persistence
 */
export interface SyncStatusJSON {
  syncId: string
  planId: string
  status: SyncStatusState
  startedAt: string
  completedAt?: string
  progress: SyncProgress
  error?: SyncError
}

/**
 * Options for creating a SyncStatus
 */
export interface SyncStatusOptions {
  /** Unique sync operation ID (auto-generated if not provided) */
  syncId?: string
  /** ID of the sync plan being executed */
  planId: string
  /** Initial total records count */
  totalRecords?: number
}

// =============================================================================
// VALID STATE TRANSITIONS
// =============================================================================

const VALID_TRANSITIONS: Record<SyncStatusState, SyncStatusState[]> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * SyncStatus tracks the state and progress of a sync operation
 *
 * @example
 * ```typescript
 * const status = new SyncStatus({ planId: 'plan-123', totalRecords: 100 })
 * status.on('progress', ({ percentage }) => console.log(`${percentage}%`))
 * status.start()
 * status.recordProcessed('added')
 * status.complete()
 * ```
 */
export class SyncStatus {
  readonly syncId: string
  readonly planId: string

  private _status: SyncStatusState = 'pending'
  private _startedAt: Date
  private _completedAt?: Date
  private _progress: SyncProgress
  private _error?: SyncError

  // Event handlers
  private _handlers = new Map<string, Set<{ callback: EventHandler<unknown>; once: boolean }>>()

  constructor(options: SyncStatusOptions) {
    this.syncId = options.syncId ?? generateSyncId()
    this.planId = options.planId
    this._startedAt = new Date()
    this._progress = {
      totalRecords: options.totalRecords ?? 0,
      processedRecords: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      failedCount: 0,
    }
  }

  // ===========================================================================
  // STATE ACCESSORS
  // ===========================================================================

  /** Current sync status */
  get status(): SyncStatusState {
    return this._status
  }

  /** When the sync was started */
  get startedAt(): Date {
    return this._startedAt
  }

  /** When the sync completed (if terminal state) */
  get completedAt(): Date | undefined {
    return this._completedAt
  }

  /** Current progress snapshot (immutable copy) */
  get progress(): SyncProgress {
    return { ...this._progress }
  }

  /** Error information (if failed) */
  get error(): SyncError | undefined {
    return this._error ? { ...this._error } : undefined
  }

  /** Progress as a percentage (0-100) */
  get progressPercentage(): number {
    if (this._progress.totalRecords === 0) {
      return 0
    }
    return Math.round((this._progress.processedRecords / this._progress.totalRecords) * 100)
  }

  /** Duration in milliseconds (from start to completion or now) */
  get durationMs(): number | undefined {
    if (this._status === 'pending') {
      return undefined
    }
    const endTime = this._completedAt ?? new Date()
    return endTime.getTime() - this._startedAt.getTime()
  }

  // ===========================================================================
  // STATE TRANSITIONS
  // ===========================================================================

  /**
   * Start the sync operation
   * @throws Error if transition is invalid
   */
  start(): void {
    this.transition('running')
    this.emit('started', {
      syncId: this.syncId,
      planId: this.planId,
      startedAt: this._startedAt,
    })
  }

  /**
   * Mark the sync as completed successfully
   * @throws Error if transition is invalid
   */
  complete(): void {
    this.transition('completed')
    this._completedAt = new Date()
    this.emit('completed', {
      syncId: this.syncId,
      planId: this.planId,
      completedAt: this._completedAt,
      progress: this.progress,
    })
  }

  /**
   * Mark the sync as failed with error
   * @param error - Error information
   * @throws Error if transition is invalid
   */
  fail(error: SyncError): void {
    this.transition('failed')
    this._completedAt = new Date()
    this._error = { ...error }
    this.emit('failed', {
      syncId: this.syncId,
      planId: this.planId,
      error: this._error,
      completedAt: this._completedAt,
    })
  }

  /**
   * Cancel the sync operation
   * @throws Error if transition is invalid
   */
  cancel(): void {
    this.transition('cancelled')
    this._completedAt = new Date()
    this.emit('cancelled', {
      syncId: this.syncId,
      planId: this.planId,
      completedAt: this._completedAt,
    })
  }

  /**
   * Validate and perform state transition
   */
  private transition(newState: SyncStatusState): void {
    const validTargets = VALID_TRANSITIONS[this._status]
    if (!validTargets.includes(newState)) {
      throw new Error(
        `Invalid state transition from '${this._status}' to '${newState}'. ` +
        `Valid transitions: ${validTargets.join(', ') || 'none (terminal state)'}`
      )
    }

    const previousState = this._status
    this._status = newState
    this.emit('stateChange', {
      syncId: this.syncId,
      previousState,
      currentState: newState,
    })
  }

  // ===========================================================================
  // PROGRESS UPDATES
  // ===========================================================================

  /**
   * Set the total number of records to process
   * @param totalRecords - Total record count
   */
  setTotalRecords(totalRecords: number): void {
    this._progress.totalRecords = totalRecords
  }

  /**
   * Update progress counters atomically
   * @param updates - Partial progress update
   * @throws Error if sync is not running
   */
  updateProgress(updates: Partial<Omit<SyncProgress, 'totalRecords'>>): void {
    this.assertRunning()

    if (updates.processedRecords !== undefined) {
      this._progress.processedRecords = updates.processedRecords
    }
    if (updates.addedCount !== undefined) {
      this._progress.addedCount = updates.addedCount
    }
    if (updates.modifiedCount !== undefined) {
      this._progress.modifiedCount = updates.modifiedCount
    }
    if (updates.deletedCount !== undefined) {
      this._progress.deletedCount = updates.deletedCount
    }
    if (updates.failedCount !== undefined) {
      this._progress.failedCount = updates.failedCount
    }

    this.emitProgress()
  }

  /**
   * Increment a progress counter by a given amount
   * @param counter - Counter to increment
   * @param amount - Amount to add (default: 1)
   */
  incrementProgress(counter: keyof Omit<SyncProgress, 'totalRecords'>, amount = 1): void {
    this.assertRunning()
    this._progress[counter] += amount
    this.emitProgress()
  }

  /**
   * Record a single processed item with its result type
   * @param result - Result type (added, modified, deleted, failed)
   */
  recordProcessed(result: ProcessedResultType): void {
    this.assertRunning()
    this._progress.processedRecords++

    switch (result) {
      case 'added':
        this._progress.addedCount++
        break
      case 'modified':
        this._progress.modifiedCount++
        break
      case 'deleted':
        this._progress.deletedCount++
        break
      case 'failed':
        this._progress.failedCount++
        break
    }

    this.emitProgress()
  }

  /**
   * Record a batch of processed items
   * @param batch - Batch result counts
   */
  recordBatch(batch: BatchResult): void {
    this.assertRunning()

    const added = batch.added ?? 0
    const modified = batch.modified ?? 0
    const deleted = batch.deleted ?? 0
    const failed = batch.failed ?? 0

    this._progress.addedCount += added
    this._progress.modifiedCount += modified
    this._progress.deletedCount += deleted
    this._progress.failedCount += failed
    this._progress.processedRecords += added + modified + deleted + failed

    this.emitProgress()
  }

  /**
   * Assert that the sync is in running state
   */
  private assertRunning(): void {
    if (this._status !== 'running') {
      throw new Error('Cannot update progress when sync is not running')
    }
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    this.emit('progress', {
      syncId: this.syncId,
      progress: this.progress,
      percentage: this.progressPercentage,
    })
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  /**
   * Add an event listener
   * @param event - Event name
   * @param handler - Event handler
   */
  on<K extends keyof SyncStatusEvents>(event: K, handler: EventHandler<SyncStatusEvents[K]>): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set())
    }
    this._handlers.get(event)!.add({ callback: handler as EventHandler<unknown>, once: false })
    return this
  }

  /**
   * Add a one-time event listener
   * @param event - Event name
   * @param handler - Event handler
   */
  once<K extends keyof SyncStatusEvents>(event: K, handler: EventHandler<SyncStatusEvents[K]>): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set())
    }
    this._handlers.get(event)!.add({ callback: handler as EventHandler<unknown>, once: true })
    return this
  }

  /**
   * Remove an event listener
   * @param event - Event name
   * @param handler - Event handler to remove
   */
  off<K extends keyof SyncStatusEvents>(event: K, handler: EventHandler<SyncStatusEvents[K]>): this {
    const handlers = this._handlers.get(event)
    if (handlers) {
      for (const entry of handlers) {
        if (entry.callback === handler) {
          handlers.delete(entry)
          break
        }
      }
    }
    return this
  }

  /**
   * Remove all event listeners
   * @param event - Optional event name (removes all if not specified)
   */
  removeAllListeners(event?: keyof SyncStatusEvents): this {
    if (event) {
      this._handlers.delete(event)
    } else {
      this._handlers.clear()
    }
    return this
  }

  /**
   * Emit an event to all listeners
   */
  private emit<K extends keyof SyncStatusEvents>(event: K, data: SyncStatusEvents[K]): void {
    const handlers = this._handlers.get(event)
    if (!handlers) return

    const toRemove: { callback: EventHandler<unknown>; once: boolean }[] = []

    for (const entry of handlers) {
      try {
        entry.callback(data)
      } catch (e) {
        console.error(`Error in SyncStatus event handler for '${event}':`, e)
      }
      if (entry.once) {
        toRemove.push(entry)
      }
    }

    for (const entry of toRemove) {
      handlers.delete(entry)
    }
  }

  // ===========================================================================
  // SERIALIZATION
  // ===========================================================================

  /**
   * Serialize to JSON for persistence
   */
  toJSON(): SyncStatusJSON {
    return {
      syncId: this.syncId,
      planId: this.planId,
      status: this._status,
      startedAt: this._startedAt.toISOString(),
      completedAt: this._completedAt?.toISOString(),
      progress: { ...this._progress },
      error: this._error ? { ...this._error } : undefined,
    }
  }

  /**
   * Deserialize from JSON
   * @param json - Serialized SyncStatus
   */
  static fromJSON(json: SyncStatusJSON): SyncStatus {
    const status = new SyncStatus({
      syncId: json.syncId,
      planId: json.planId,
      totalRecords: json.progress.totalRecords,
    })

    // Restore internal state directly
    status._status = json.status
    status._startedAt = new Date(json.startedAt)
    if (json.completedAt) {
      status._completedAt = new Date(json.completedAt)
    }
    status._progress = { ...json.progress }
    if (json.error) {
      status._error = { ...json.error }
    }

    return status
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new SyncStatus instance
 *
 * @param options - SyncStatus options
 * @returns A new SyncStatus instance
 */
export function createSyncStatus(options: SyncStatusOptions): SyncStatus {
  return new SyncStatus(options)
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a unique sync ID
 */
function generateSyncId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `sync-${timestamp}-${random}`
}
