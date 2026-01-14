/**
 * Type definitions for Temporal Compat Layer
 *
 * These types match the Temporal SDK exactly for API compatibility.
 */

import type { RetryOptions } from '../../../lib/cloudflare/workflows'
import type { StepStorage } from '../../runtime'

// ============================================================================
// ACTIVITY OPTIONS
// ============================================================================

export interface ActivityOptions {
  /** Start-to-close timeout */
  readonly startToCloseTimeout?: string | number
  /** Schedule-to-close timeout */
  readonly scheduleToCloseTimeout?: string | number
  /** Schedule-to-start timeout */
  readonly scheduleToStartTimeout?: string | number
  /** Heartbeat timeout */
  readonly heartbeatTimeout?: string | number
  /** Retry policy */
  readonly retry?: Readonly<RetryPolicy>
  /** Task queue */
  readonly taskQueue?: string
}

export interface LocalActivityOptions extends ActivityOptions {
  /** Local retry policy (uses shorter defaults) */
  readonly localRetryThreshold?: string | number
}

export interface RetryPolicy {
  /** Initial retry interval */
  readonly initialInterval?: string | number
  /** Backoff coefficient (multiplier) */
  readonly backoffCoefficient?: number
  /** Maximum retry interval */
  readonly maximumInterval?: string | number
  /** Maximum number of attempts (including first try) */
  readonly maximumAttempts?: number
  /** Non-retryable error types */
  readonly nonRetryableErrorTypes?: readonly string[]
}

// ============================================================================
// CHILD WORKFLOW OPTIONS
// ============================================================================

export interface ChildWorkflowOptions {
  /** Workflow ID */
  readonly workflowId?: string
  /** Task queue */
  readonly taskQueue?: string
  /** Workflow execution timeout */
  readonly workflowExecutionTimeout?: string | number
  /** Workflow run timeout */
  readonly workflowRunTimeout?: string | number
  /** Workflow task timeout */
  readonly workflowTaskTimeout?: string | number
  /** Retry policy */
  readonly retry?: Readonly<RetryPolicy>
  /** Cancellation type */
  readonly cancellationType?: CancellationType
  /** Parent close policy */
  readonly parentClosePolicy?: ParentClosePolicy
  /** Memo */
  readonly memo?: Readonly<Record<string, unknown>>
  /** Search attributes */
  readonly searchAttributes?: Readonly<SearchAttributes>
}

export type CancellationType = 'WAIT_CANCELLATION_COMPLETED' | 'TRY_CANCEL' | 'ABANDON'

export type ParentClosePolicy = 'TERMINATE' | 'ABANDON' | 'REQUEST_CANCEL'

// ============================================================================
// WORKFLOW INFO
// ============================================================================

export interface WorkflowInfo {
  workflowId: string
  runId: string
  workflowType: string
  taskQueue: string
  namespace: string
  firstExecutionRunId: string
  continuedFromExecutionRunId?: string
  attempt: number
  cronSchedule?: string
  memo?: Record<string, unknown>
  searchAttributes?: SearchAttributes
  parent?: ParentWorkflowInfo
  historyLength: number
  startTime: Date
  runStartTime: Date
  executionTimeout?: number
  runTimeout?: number
}

export interface ParentWorkflowInfo {
  workflowId: string
  runId: string
  namespace: string
}

export interface ContinueAsNewOptions {
  workflowType?: string
  taskQueue?: string
  args?: unknown[]
  memo?: Record<string, unknown>
  searchAttributes?: SearchAttributes
  workflowRunTimeout?: string | number
  workflowTaskTimeout?: string | number
}

// ============================================================================
// SEARCH ATTRIBUTES
// ============================================================================

/**
 * Search attributes for workflow queries
 */
export interface SearchAttributes {
  [key: string]: string | number | boolean | Date | string[] | number[]
}

// ============================================================================
// TIMER TYPES
// ============================================================================

/**
 * Timer handle for cancellation and status checking
 */
export interface TimerHandle extends Promise<void> {
  /** Unique timer ID */
  id: string
  /** Whether timer is still pending */
  pending: boolean
}

// ============================================================================
// SIGNAL, QUERY, UPDATE TYPES
// ============================================================================

export interface SignalDefinition<Args extends unknown[] = [], Name extends string = string> {
  readonly name: Name
  readonly type: 'signal'
}

export interface QueryDefinition<TResult = unknown, Args extends unknown[] = [], Name extends string = string> {
  readonly name: Name
  readonly type: 'query'
}

export interface UpdateDefinition<TResult = unknown, Args extends unknown[] = [], Name extends string = string> {
  readonly name: Name
  readonly type: 'update'
}

export type SignalHandler<Args extends unknown[]> = (...args: Args) => void | Promise<void>
export type QueryHandler<TResult, Args extends unknown[]> = (...args: Args) => TResult
export type UpdateHandler<TResult, Args extends unknown[]> = (...args: Args) => TResult | Promise<TResult>

// ============================================================================
// WORKFLOW HANDLE TYPES
// ============================================================================

export interface WorkflowHandle<T = unknown> {
  /** Workflow ID */
  workflowId: string
  /** Run ID */
  runId?: string
  /** Get result */
  result(): Promise<T>
  /** Get description/status */
  describe(): Promise<WorkflowExecutionDescription>
  /** Send a signal */
  signal<Args extends unknown[]>(signal: SignalDefinition<Args>, ...args: Args): Promise<void>
  /** Query the workflow */
  query<TResult, Args extends unknown[]>(query: QueryDefinition<TResult, Args>, ...args: Args): Promise<TResult>
  /** Update the workflow */
  executeUpdate<TResult, Args extends unknown[]>(update: UpdateDefinition<TResult, Args>, ...args: Args): Promise<TResult>
  /** Cancel the workflow */
  cancel(): Promise<void>
  /** Terminate the workflow */
  terminate(reason?: string): Promise<void>
}

export interface ChildWorkflowHandle<T = unknown> {
  /** Workflow ID */
  workflowId: string
  /** First execution run ID */
  firstExecutionRunId: string
  /** Get result */
  result(): Promise<T>
  /** Send a signal */
  signal<Args extends unknown[]>(signal: SignalDefinition<Args>, ...args: Args): Promise<void>
  /** Cancel the child workflow */
  cancel(): Promise<void>
}

export interface WorkflowExecutionDescription {
  status: WorkflowExecutionStatus
  workflowId: string
  runId: string
  workflowType: string
  taskQueue: string
  startTime: Date
  closeTime?: Date
  executionTime?: Date
  memo?: Record<string, unknown>
  searchAttributes?: SearchAttributes
}

export type WorkflowExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TERMINATED' | 'CONTINUED_AS_NEW' | 'TIMED_OUT'

// ============================================================================
// CLIENT TYPES
// ============================================================================

export interface WorkflowClientOptions {
  /** Service connection (unused in compat) */
  readonly connection?: unknown
  /** Namespace */
  readonly namespace?: string
  /** Data converter */
  readonly dataConverter?: unknown
  /** Interceptors */
  readonly interceptors?: readonly unknown[]
  /** Durable storage */
  readonly storage?: StepStorage
  /** DO state */
  readonly state?: DurableObjectState
}

export interface WorkflowStartOptions<TArgs extends unknown[]> {
  /** Task queue */
  readonly taskQueue: string
  /** Workflow ID */
  readonly workflowId?: string
  /** Workflow arguments */
  readonly args?: TArgs
  /** Retry policy */
  readonly retry?: Readonly<RetryPolicy>
  /** Workflow execution timeout */
  readonly workflowExecutionTimeout?: string | number
  /** Workflow run timeout */
  readonly workflowRunTimeout?: string | number
  /** Workflow task timeout */
  readonly workflowTaskTimeout?: string | number
  /** Memo */
  readonly memo?: Readonly<Record<string, unknown>>
  /** Search attributes */
  readonly searchAttributes?: Readonly<SearchAttributes>
  /** Cron schedule */
  readonly cronSchedule?: string
}

export interface SignalWithStartOptions<TSignalArgs extends unknown[], TWorkflowArgs extends unknown[]> extends WorkflowStartOptions<TWorkflowArgs> {
  readonly signal: SignalDefinition<TSignalArgs>
  readonly signalArgs: TSignalArgs
}

export interface ListWorkflowOptions {
  /** Search query (Temporal SQL-like syntax) */
  readonly query?: string
  /** Maximum number of results */
  readonly pageSize?: number
}

// ============================================================================
// WORKFLOW STATE (Internal)
// ============================================================================

export interface WorkflowState {
  workflowId: string
  runId: string
  workflowType: string
  taskQueue: string
  namespace: string
  signalHandlers: Map<string, SignalHandler<unknown[]>>
  queryHandlers: Map<string, QueryHandler<unknown, unknown[]>>
  updateHandlers: Map<string, UpdateHandler<unknown, unknown[]>>
  stepResults: Map<string, unknown>
  status: WorkflowExecutionStatus
  result?: unknown
  error?: Error
  searchAttributes: SearchAttributes
  memo?: Record<string, unknown>
  parent?: ParentWorkflowInfo
  startTime: Date
  runStartTime: Date
  historyLength: number
  attempt: number
  // Child workflow tracking
  children: Set<string>
  parentClosePolicy?: ParentClosePolicy
  // Cancellation support
  abortController?: AbortController
  // Per-workflow step counters for deterministic step IDs
  sleepStepCounter: number
  activityStepCounter: number
}

// ============================================================================
// PATCH STATE (Internal)
// ============================================================================

export interface PatchState {
  appliedPatches: Set<string>
  deprecatedPatches: Set<string>
}

// ============================================================================
// WORKFLOW CONTEXT (Internal)
// ============================================================================

import { WaitForEventManager } from '../../WaitForEventManager'
import type { WorkflowStep } from '../../../lib/cloudflare/workflows'

/**
 * WorkflowContext encapsulates all per-execution state, enabling concurrent
 * workflow execution without global state pollution.
 */
export interface WorkflowContext {
  workflow: WorkflowState
  patchState: PatchState | null
  storage: StepStorage
  waitManager: WaitForEventManager | null
  /** CF Workflows step context for this workflow execution */
  workflowStep: WorkflowStep | null
}

// ============================================================================
// TIMER STATE (Internal)
// ============================================================================

// NOTE: timeoutId is NOT stored here - it's stored in bucketTimeouts Map
// to avoid the "cancelled leader" bug where cancelling the first timer in a
// coalesced bucket would leave other timers without a scheduled callback
export interface TimerState {
  id: string
  pending: boolean
  resolve: () => void
  reject: (error: Error) => void
  /** Timestamp when timer was created, for staleness detection */
  createdAt: number
  /** Expected fire time for cleanup calculations */
  expectedFireAt: number
}

// ============================================================================
// STEP EXECUTION OPTIONS
// ============================================================================

/**
 * Options for step execution
 */
export interface StepExecutionOptions {
  /** Timeout for the step */
  timeout?: string
  /** Retry configuration */
  retries?: RetryOptions
}

// ============================================================================
// CACHED STEP RESULT
// ============================================================================

/**
 * Discriminated union for cached step results.
 * Provides type-safe handling of success values vs errors.
 */
export type CachedStepResult<T = unknown> =
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }

// ============================================================================
// ACTIVITY TYPES
// ============================================================================

export type ActivityFunction = (...args: unknown[]) => Promise<unknown>
export type Activities = Record<string, ActivityFunction>

// ============================================================================
// ACTIVITY CONTEXT
// ============================================================================

/**
 * Activity execution context passed to executeActivity handlers.
 * This mirrors RouterActivityContext for compatibility.
 */
export interface ActivityContext {
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Worker handler type - receives workflow/activity execution requests.
 */
export interface WorkerHandler {
  /** Optional: Execute an activity by name */
  executeActivity?: (name: string, args: unknown[], context: ActivityContext) => Promise<unknown>
  /** Optional: Set of workflow types this worker handles */
  workflowTypes?: Set<string>
  /** Optional: Set of activity types this worker handles */
  activityTypes?: Set<string>
}

// ============================================================================
// ACTIVITY WORKER POOL TYPES
// ============================================================================

/**
 * Heartbeat details for long-running activities.
 * Activities should periodically report progress via heartbeat.
 */
export interface HeartbeatDetails {
  /** Progress percentage (0-100) */
  progress?: number
  /** Current status message */
  message?: string
  /** Custom details */
  [key: string]: unknown
}

/**
 * Activity worker status for health checks and monitoring.
 */
export interface ActivityWorkerStatus {
  /** Task queue this worker handles */
  taskQueue: string
  /** Number of currently executing activities */
  activeCount: number
  /** Maximum concurrent activities allowed */
  maxConcurrent: number
  /** List of registered activity names */
  activities: string[]
  /** Worker start time */
  startedAt?: number
  /** Total activities processed */
  totalProcessed?: number
  /** Total activities failed */
  totalFailed?: number
}

/**
 * Options for remote activity execution via service binding.
 */
export interface RemoteActivityOptions {
  /** Task queue where the activity worker is running */
  taskQueue: string
  /** Start-to-close timeout */
  startToCloseTimeout?: string | number
  /** Heartbeat timeout - activity must heartbeat within this interval */
  heartbeatTimeout?: string | number
  /** Retry policy */
  retry?: RetryPolicy
}
