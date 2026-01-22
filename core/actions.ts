/**
 * @dotdo/core - Actions Interface
 *
 * Actions represent durable execution of work. They have state that changes
 * over time as work progresses through its lifecycle.
 *
 * Actions support:
 * - Status lifecycle (pending → running → completed/failed)
 * - Retries with backoff
 * - Correlation for tracing
 * - Parent-child relationships for sub-tasks
 */

import type { StorableData } from './types'

// =============================================================================
// Action Status
// =============================================================================

/**
 * Action status lifecycle
 *
 * ```
 * pending ──→ running ──→ completed
 *               │
 *               ▼
 *            failed ──→ retrying ──→ running
 *               │
 *               ▼
 *           cancelled
 * ```
 */
export type ActionStatus =
  | 'pending'      // Queued, not yet started
  | 'running'      // Currently executing
  | 'completed'    // Finished successfully
  | 'failed'       // Finished with error
  | 'cancelled'    // Manually cancelled
  | 'timeout'      // Exceeded time limit
  | 'retrying'     // Failed, will retry

// =============================================================================
// Action Trigger
// =============================================================================

/**
 * What triggered the action
 */
export interface ActionTrigger {
  /** Trigger type */
  type: 'manual' | 'scheduled' | 'event' | 'webhook' | 'rpc'

  /** Source identifier (user ID, cron expression, event ID, etc.) */
  source: string
}

// =============================================================================
// Action Error
// =============================================================================

/**
 * Error information for failed actions
 */
export interface ActionError {
  /** Error code (e.g., 'TIMEOUT', 'EXECUTION_ERROR') */
  code: string

  /** Human-readable error message */
  message: string

  /** Optional stack trace */
  stack?: string

  /** Optional additional context */
  context?: Record<string, unknown>
}

// =============================================================================
// Action Type
// =============================================================================

/**
 * Action - Represents durable execution of work
 *
 * Actions have a lifecycle:
 * 1. Created with status 'pending'
 * 2. Claimed by a worker, status → 'running'
 * 3. Completed successfully, status → 'completed'
 *    OR failed, status → 'failed' or 'retrying'
 *
 * @example
 * ```typescript
 * const action: Action<{ orderId: string }, { success: boolean }> = {
 *   id: 'action-123',
 *   type: 'Order.process',
 *   trigger: { type: 'rpc', source: 'user-456' },
 *   target: 'https://app.do/Order/order-789',
 *   input: { orderId: 'order-789' },
 *   status: 'pending',
 *   createdAt: new Date(),
 *   attempts: 0,
 *   maxAttempts: 3
 * }
 * ```
 */
export interface Action<
  TInput extends StorableData = StorableData,
  TOutput extends StorableData = StorableData,
  TConfig extends StorableData = StorableData
> {
  // Identity
  /** Unique identifier */
  id: string

  /** Action type (e.g., 'Function.invoke', 'Order.process') */
  type: string

  // Trigger
  /** What triggered this action */
  trigger: ActionTrigger

  // Work
  /** Thing URL being acted upon */
  target: string

  /** Input data for the action */
  input: TInput

  /** Configuration for the action */
  config?: TConfig

  // Execution state
  /** Current status */
  status: ActionStatus

  /** Output data (when completed) */
  output?: TOutput

  /** Error information (when failed) */
  error?: ActionError

  // Timing
  /** When the action was created */
  createdAt: Date

  /** When execution started */
  startedAt?: Date

  /** When execution completed (success or failure) */
  completedAt?: Date

  // Retries
  /** Number of execution attempts */
  attempts: number

  /** Maximum number of attempts before permanent failure */
  maxAttempts: number

  /** When to retry next (if status is 'retrying') */
  nextRetryAt?: Date

  // Correlation
  /** Group related actions */
  correlationId?: string

  /** Action that caused this one */
  causationId?: string

  /** Parent action (for sub-tasks) */
  parentId?: string
}

// =============================================================================
// Action Input Types
// =============================================================================

/**
 * Input for creating an action
 */
export interface CreateActionInput<
  TInput extends StorableData = StorableData,
  TConfig extends StorableData = StorableData
> {
  /** Action type */
  type: string

  /** Target Thing URL */
  target: string

  /** Input data */
  input: TInput

  /** Optional configuration */
  config?: TConfig

  /** What triggered this action */
  trigger?: ActionTrigger

  /** Correlation ID for grouping */
  correlationId?: string

  /** Parent action ID */
  parentId?: string

  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number

  /** Delay before first execution (ms) */
  delay?: number
}

/**
 * Input for updating action status
 */
export interface UpdateActionInput {
  /** New status */
  status?: ActionStatus

  /** Output data (for completed) */
  output?: StorableData

  /** Error information (for failed) */
  error?: ActionError

  /** When execution started */
  startedAt?: Date

  /** When execution completed */
  completedAt?: Date

  /** When to retry next */
  nextRetryAt?: Date
}

/**
 * Options for finding actions
 */
export interface FindActionsOptions {
  /** Filter by action type */
  type?: string

  /** Filter by target Thing URL */
  target?: string

  /** Filter by status (single or multiple) */
  status?: ActionStatus | ActionStatus[]

  /** Filter by correlation ID */
  correlationId?: string

  /** Filter by parent action ID */
  parentId?: string

  /** Actions created after this date */
  after?: Date

  /** Actions created before this date */
  before?: Date

  /** Maximum number of results */
  limit?: number

  /** Number of results to skip */
  offset?: number

  /** Order by field */
  orderBy?: 'createdAt' | 'startedAt' | 'completedAt'

  /** Sort order */
  order?: 'asc' | 'desc'
}

/**
 * Options for claiming actions (for workers)
 */
export interface ClaimActionsOptions {
  /** Filter by action type */
  type?: string

  /** Maximum number of actions to claim */
  limit?: number

  /** How long to lock claimed actions (ms) */
  lockDuration?: number
}

// =============================================================================
// Actions Client Interface
// =============================================================================

/**
 * ActionsClient - Interface for managing actions
 *
 * This extends the base DBClient with action-specific methods.
 *
 * @example
 * ```typescript
 * // Create an action
 * const action = await db.createAction({
 *   type: 'Email.send',
 *   target: 'https://app.do/Email/welcome',
 *   input: { to: 'alice@example.com', template: 'welcome' },
 *   trigger: { type: 'event', source: 'User.created' }
 * })
 *
 * // Workers claim and execute actions
 * const [claimed] = await db.claimActions({ type: 'Email.send', limit: 10 })
 *
 * await db.updateAction(claimed.id, { status: 'running', startedAt: new Date() })
 *
 * try {
 *   const result = await sendEmail(claimed.input)
 *   await db.updateAction(claimed.id, {
 *     status: 'completed',
 *     output: result,
 *     completedAt: new Date()
 *   })
 * } catch (error) {
 *   await db.updateAction(claimed.id, {
 *     status: 'failed',
 *     error: { code: 'SEND_ERROR', message: error.message },
 *     completedAt: new Date()
 *   })
 * }
 * ```
 */
export interface ActionsClient {
  /**
   * Create a new action (queued for execution)
   *
   * @param options - Action creation options
   * @returns The created action with status 'pending'
   */
  createAction<TInput extends StorableData, TConfig extends StorableData = StorableData>(
    options: CreateActionInput<TInput, TConfig>
  ): Promise<Action<TInput>>

  /**
   * Get an action by ID
   *
   * @param id - Action ID
   * @returns The action or null if not found
   */
  getAction(id: string): Promise<Action | null>

  /**
   * Update an action's status
   *
   * @param id - Action ID
   * @param update - Status update
   * @returns The updated action
   */
  updateAction(id: string, update: UpdateActionInput): Promise<Action>

  /**
   * Find actions matching criteria
   *
   * @param options - Search options
   * @returns Array of matching actions
   */
  findActions(options: FindActionsOptions): Promise<Action[]>

  /**
   * Claim pending actions for execution
   *
   * This atomically:
   * 1. Finds pending actions matching the criteria
   * 2. Updates their status to 'running'
   * 3. Returns the claimed actions
   *
   * Use lockDuration to prevent other workers from claiming the same actions.
   *
   * @param options - Claim options
   * @returns Array of claimed actions
   */
  claimActions(options: ClaimActionsOptions): Promise<Action[]>

  /**
   * Cancel an action
   *
   * Only pending or retrying actions can be cancelled.
   *
   * @param id - Action ID
   * @param reason - Optional cancellation reason
   * @returns True if cancelled, false if not cancellable
   */
  cancelAction?(id: string, reason?: string): Promise<boolean>

  /**
   * Retry a failed action
   *
   * Resets the action to 'pending' status for re-execution.
   *
   * @param id - Action ID
   * @returns The reset action
   */
  retryAction?(id: string): Promise<Action>

  /**
   * Get action history (all status changes)
   *
   * @param id - Action ID
   * @returns Array of status change events
   */
  getActionHistory?(id: string): Promise<ActionStatusChange[]>
}

/**
 * Record of an action status change
 */
export interface ActionStatusChange {
  /** Action ID */
  actionId: string

  /** Previous status */
  fromStatus: ActionStatus | null

  /** New status */
  toStatus: ActionStatus

  /** When the change occurred */
  timestamp: Date

  /** Optional reason for the change */
  reason?: string
}
