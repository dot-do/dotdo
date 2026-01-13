/**
 * ACID Lifecycle Types
 *
 * Types for DO (Durable Object) lifecycle operations with ACID guarantees.
 * These types support Phase 2 clone operations and lifecycle event tracking.
 *
 * @module types/acid/lifecycle
 */

// =============================================================================
// Clone Mode Types
// =============================================================================

/**
 * Clone consistency modes for Phase 2 DO operations.
 *
 * Each mode offers different trade-offs between consistency, availability,
 * and performance:
 *
 * - `atomic`: All-or-nothing clone. Blocks until complete, guarantees
 *   consistency but may fail on large states or network issues.
 *
 * - `staged`: Two-phase commit with prepare/commit phases. Allows validation
 *   and rollback before finalizing. Best for critical data migrations.
 *
 * - `eventual`: Async reconciliation, returns immediately with a handle.
 *   Syncs in background with configurable divergence tolerance.
 *
 * - `resumable`: Checkpoint-based cloning that can resume after failure.
 *   Ideal for large datasets or unreliable network conditions.
 *
 * @example
 * ```typescript
 * // Atomic clone for small, critical state
 * await do.clone(target, { mode: 'atomic' })
 *
 * // Staged clone for controlled migration
 * const { token } = await do.clone(target, { mode: 'staged' })
 * await do.commitClone(token)
 *
 * // Eventual clone for large datasets
 * const handle = await do.clone(target, { mode: 'eventual' })
 * await handle.sync()
 *
 * // Resumable clone for reliability
 * const handle = await do.clone(target, { mode: 'resumable' })
 * const checkpoint = await handle.waitForCheckpoint()
 * ```
 */
export type CloneMode =
  | 'atomic' // All-or-nothing, blocks until complete
  | 'staged' // Two-phase commit with prepare/commit
  | 'eventual' // Async reconciliation, returns immediately
  | 'resumable' // Checkpoint-based, can resume after failure

// =============================================================================
// Clone Options
// =============================================================================

/**
 * Options for clone operations.
 *
 * Configures the behavior of DO clone operations including target location,
 * consistency mode, and scope of data to include.
 *
 * @example
 * ```typescript
 * const options: CloneOptions = {
 *   mode: 'staged',
 *   to: 'https://target.api.dotdo.dev',
 *   branch: 'main',
 *   includeHistory: false,
 *   timeout: 30000
 * }
 * ```
 */
export interface CloneOptions {
  /**
   * Clone consistency mode.
   * Determines the guarantees and behavior of the clone operation.
   */
  mode: CloneMode

  /**
   * Target namespace URL.
   * Must be a valid URL with http or https protocol.
   *
   * @example 'https://tenant.api.dotdo.dev'
   */
  to: string

  /**
   * Branch to clone.
   * If not specified, clones the current branch.
   *
   * @default Current branch
   */
  branch?: string

  /**
   * Whether to include full version history.
   * When false, only the latest state is cloned (fork behavior).
   * When true, includes all historical versions and actions.
   *
   * @default false
   */
  includeHistory?: boolean

  /**
   * Timeout in milliseconds for blocking modes (atomic, staged).
   * For eventual and resumable modes, this affects individual sync operations.
   *
   * @default 30000 (30 seconds)
   */
  timeout?: number
}

// =============================================================================
// Clone Result
// =============================================================================

/**
 * Result of a clone operation.
 *
 * Contains information about the cloned DO including its location
 * and mode-specific details for transaction management or resumption.
 *
 * @example
 * ```typescript
 * const result = await do.clone(target, { mode: 'staged', to: targetUrl })
 *
 * if (result.success) {
 *   console.log(`Cloned to ${result.ns} with DO ID ${result.doId}`)
 *
 *   if (result.txId) {
 *     // Staged mode - commit the transaction
 *     await do.commitClone(result.txId)
 *   }
 * }
 * ```
 */
export interface CloneResult {
  /**
   * Whether the clone operation succeeded.
   * For eventual/resumable modes, indicates initial setup success.
   */
  success: boolean

  /**
   * Namespace URL of the cloned DO.
   */
  ns: string

  /**
   * Durable Object ID of the cloned instance.
   */
  doId: string

  /**
   * Transaction ID for staged mode.
   * Use with `commitClone()` or `abortClone()` to finalize.
   * Only present when mode is 'staged'.
   */
  txId?: string

  /**
   * Checkpoint ID for resumable mode.
   * Use with `resumeClone()` to continue after interruption.
   * Only present when mode is 'resumable'.
   */
  checkpointId?: string
}

// =============================================================================
// Lifecycle Status
// =============================================================================

/**
 * Status of a lifecycle operation.
 *
 * Tracks the state of DO lifecycle operations through their execution phases.
 *
 * State transitions:
 * ```
 * pending -> in_progress -> completed
 *                       -> failed -> rolled_back
 * ```
 *
 * @example
 * ```typescript
 * function handleStatusChange(status: LifecycleStatus) {
 *   switch (status) {
 *     case 'pending':
 *       console.log('Operation queued')
 *       break
 *     case 'in_progress':
 *       console.log('Operation executing')
 *       break
 *     case 'completed':
 *       console.log('Operation succeeded')
 *       break
 *     case 'failed':
 *       console.log('Operation failed, may require rollback')
 *       break
 *     case 'rolled_back':
 *       console.log('Operation rolled back to previous state')
 *       break
 *   }
 * }
 * ```
 */
export type LifecycleStatus =
  | 'pending' // Queued but not started
  | 'in_progress' // Currently executing
  | 'completed' // Successfully finished
  | 'failed' // Failed during execution
  | 'rolled_back' // Rolled back after failure

// =============================================================================
// Lifecycle Operations
// =============================================================================

/**
 * Types of DO lifecycle operations.
 *
 * These operations modify the structure, location, or state of Durable Objects:
 *
 * - `fork`: Create a new DO from current state without history
 * - `compact`: Archive old data and reduce storage footprint
 * - `moveTo`: Relocate DO to a different colo/region
 * - `clone`: Duplicate DO with configurable consistency modes
 * - `shard`: Split DO across multiple instances for scale
 * - `unshard`: Merge sharded instances back into one
 * - `replicate`: Create read replicas for query load distribution
 *
 * @example
 * ```typescript
 * const event: LifecycleEvent = {
 *   operation: 'clone',
 *   status: 'in_progress',
 *   startedAt: new Date(),
 *   metadata: {
 *     target: 'https://clone.api.dotdo.dev',
 *     mode: 'staged'
 *   }
 * }
 * ```
 */
export type LifecycleOperation =
  | 'fork' // Create new DO from current state
  | 'compact' // Archive old data, reduce storage
  | 'moveTo' // Relocate to different colo
  | 'clone' // Duplicate with consistency modes
  | 'shard' // Split across instances
  | 'unshard' // Merge sharded instances
  | 'replicate' // Create read replicas

// =============================================================================
// Lifecycle Event
// =============================================================================

/**
 * Event record for tracking lifecycle operations.
 *
 * Provides comprehensive tracking of DO lifecycle operations for
 * observability, debugging, and audit purposes.
 *
 * @example
 * ```typescript
 * const event: LifecycleEvent = {
 *   operation: 'clone',
 *   status: 'completed',
 *   startedAt: new Date('2024-01-01T10:00:00Z'),
 *   completedAt: new Date('2024-01-01T10:00:05Z'),
 *   metadata: {
 *     source: 'https://source.api.dotdo.dev',
 *     target: 'https://target.api.dotdo.dev',
 *     mode: 'atomic',
 *     thingsCloned: 1500,
 *     duration: 5000
 *   }
 * }
 *
 * // Log lifecycle events for observability
 * function logEvent(event: LifecycleEvent) {
 *   const duration = event.completedAt
 *     ? event.completedAt.getTime() - event.startedAt.getTime()
 *     : 'ongoing'
 *
 *   console.log(`[${event.operation}] ${event.status} - ${duration}ms`)
 *
 *   if (event.error) {
 *     console.error(`Error: ${event.error}`)
 *   }
 * }
 * ```
 */
export interface LifecycleEvent {
  /**
   * The type of lifecycle operation being performed.
   */
  operation: LifecycleOperation

  /**
   * Current status of the operation.
   */
  status: LifecycleStatus

  /**
   * When the operation was initiated.
   */
  startedAt: Date

  /**
   * When the operation completed (success or failure).
   * Undefined if operation is still in progress.
   */
  completedAt?: Date

  /**
   * Operation-specific metadata.
   * Contains details relevant to the specific operation type.
   *
   * Common fields:
   * - `source`: Source namespace URL
   * - `target`: Target namespace URL
   * - `mode`: Clone mode for clone operations
   * - `duration`: Operation duration in ms
   * - `thingsCount`: Number of things affected
   * - `correlationId`: Correlation ID for tracing
   */
  metadata: Record<string, unknown>

  /**
   * Error message if the operation failed.
   * Only present when status is 'failed' or 'rolled_back'.
   */
  error?: string
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a valid CloneMode.
 *
 * @param value - Value to check
 * @returns True if value is a valid CloneMode
 *
 * @example
 * ```typescript
 * const mode: unknown = 'atomic'
 * if (isCloneMode(mode)) {
 *   // mode is narrowed to CloneMode
 *   console.log(`Valid clone mode: ${mode}`)
 * }
 * ```
 */
export function isCloneMode(value: unknown): value is CloneMode {
  return (
    typeof value === 'string' &&
    ['atomic', 'staged', 'eventual', 'resumable'].includes(value)
  )
}

/**
 * Type guard to check if a value is a valid LifecycleStatus.
 *
 * @param value - Value to check
 * @returns True if value is a valid LifecycleStatus
 *
 * @example
 * ```typescript
 * const status: unknown = 'completed'
 * if (isLifecycleStatus(status)) {
 *   // status is narrowed to LifecycleStatus
 *   handleStatus(status)
 * }
 * ```
 */
export function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return (
    typeof value === 'string' &&
    ['pending', 'in_progress', 'completed', 'failed', 'rolled_back'].includes(value)
  )
}

/**
 * Type guard to check if a value is a valid LifecycleOperation.
 *
 * @param value - Value to check
 * @returns True if value is a valid LifecycleOperation
 *
 * @example
 * ```typescript
 * const op: unknown = 'clone'
 * if (isLifecycleOperation(op)) {
 *   // op is narrowed to LifecycleOperation
 *   scheduleOperation(op)
 * }
 * ```
 */
export function isLifecycleOperation(value: unknown): value is LifecycleOperation {
  return (
    typeof value === 'string' &&
    ['fork', 'compact', 'moveTo', 'clone', 'shard', 'unshard', 'replicate'].includes(value)
  )
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates CloneOptions structure.
 *
 * @param options - Options to validate
 * @returns Validation result with error messages if invalid
 *
 * @example
 * ```typescript
 * const result = validateCloneOptions({
 *   mode: 'atomic',
 *   to: 'https://target.api.dotdo.dev'
 * })
 *
 * if (!result.valid) {
 *   console.error('Invalid options:', result.errors)
 * }
 * ```
 */
export function validateCloneOptions(options: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!options || typeof options !== 'object') {
    return { valid: false, errors: ['Options must be an object'] }
  }

  const opts = options as Record<string, unknown>

  // Validate mode
  if (!('mode' in opts)) {
    errors.push('mode is required')
  } else if (!isCloneMode(opts.mode)) {
    errors.push(`Invalid mode: '${opts.mode}'. Must be one of: atomic, staged, eventual, resumable`)
  }

  // Validate to
  if (!('to' in opts)) {
    errors.push('to is required')
  } else if (typeof opts.to !== 'string') {
    errors.push('to must be a string')
  } else {
    try {
      const url = new URL(opts.to)
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('to must use http or https protocol')
      }
    } catch {
      errors.push(`Invalid URL for 'to': ${opts.to}`)
    }
  }

  // Validate optional fields
  if ('branch' in opts && opts.branch !== undefined && typeof opts.branch !== 'string') {
    errors.push('branch must be a string')
  }

  if ('includeHistory' in opts && opts.includeHistory !== undefined && typeof opts.includeHistory !== 'boolean') {
    errors.push('includeHistory must be a boolean')
  }

  if ('timeout' in opts && opts.timeout !== undefined) {
    if (typeof opts.timeout !== 'number' || opts.timeout < 0) {
      errors.push('timeout must be a non-negative number')
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Creates a LifecycleEvent with default values.
 *
 * @param operation - Type of lifecycle operation
 * @param metadata - Operation-specific metadata
 * @returns A new LifecycleEvent in 'pending' status
 *
 * @example
 * ```typescript
 * const event = createLifecycleEvent('clone', {
 *   target: 'https://target.api.dotdo.dev',
 *   mode: 'atomic'
 * })
 *
 * // Later, update status
 * event.status = 'in_progress'
 *
 * // On completion
 * event.status = 'completed'
 * event.completedAt = new Date()
 * ```
 */
export function createLifecycleEvent(
  operation: LifecycleOperation,
  metadata: Record<string, unknown> = {}
): LifecycleEvent {
  return {
    operation,
    status: 'pending',
    startedAt: new Date(),
    metadata,
  }
}
