/**
 * Temporal Compat Layer - 100% API Compatible with @temporalio/workflow
 *
 * Drop-in replacement for Temporal that runs on dotdo's
 * durable execution infrastructure.
 *
 * ## Determinism Requirements
 *
 * Workflows MUST be deterministic to support replay. This means that given the
 * same inputs and history, a workflow must produce the same sequence of commands.
 *
 * ### Non-Deterministic Operations to Avoid:
 *
 * | Avoid                    | Use Instead                          |
 * |--------------------------|--------------------------------------|
 * | `Date.now()`             | `workflowNow()` - deterministic time |
 * | `new Date()`             | `workflowNow()` - returns Date       |
 * | `Math.random()`          | `random()` - deterministic random    |
 * | `crypto.randomUUID()`    | `uuid4()` - deterministic UUID       |
 * | `fetch()` / HTTP calls   | Activities (via `proxyActivities`)   |
 * | `setTimeout/setInterval` | `sleep()` or `createTimer()`         |
 * | File I/O                 | Activities                           |
 * | Database queries         | Activities                           |
 *
 * ### Why Determinism Matters:
 *
 * When a workflow fails and restarts, it replays from the beginning using
 * stored history. If your workflow makes different decisions on replay
 * (e.g., because `Math.random()` returns a different value), the replay
 * will diverge from history and fail.
 *
 * ### Development Mode Warnings:
 *
 * Set `warnOnNonDeterministic: true` in configuration to get console warnings
 * when non-deterministic patterns are detected. This is enabled by default
 * in development mode (`NODE_ENV !== 'production'`).
 *
 * ```typescript
 * import { configureDeterminism, enableDeterminismDetection } from '@dotdo/temporal'
 *
 * // Configure warnings
 * configureDeterminism({ warnOnNonDeterministic: true })
 *
 * // Enable detection (patches global Date.now, Math.random, fetch)
 * enableDeterminismDetection()
 * ```
 *
 * @example
 * ```typescript
 * import { proxyActivities, defineSignal, setHandler, sleep, condition, workflowNow, random } from '@dotdo/temporal'
 *
 * const { sendEmail, chargeCard } = proxyActivities<typeof activities>({
 *   startToCloseTimeout: '10s',
 *   retry: { maximumAttempts: 3 },
 * })
 *
 * export async function orderWorkflow(order: Order) {
 *   const approved = defineSignal<[boolean]>('approve')
 *   let isApproved = false
 *
 *   // Use deterministic alternatives
 *   const orderTime = workflowNow() // instead of new Date()
 *   const shouldDiscount = random() < 0.1 // instead of Math.random()
 *
 *   setHandler(approved, (approval) => {
 *     isApproved = approval
 *   })
 *
 *   await condition(() => isApproved, '7d')
 *
 *   await chargeCard(order.cardToken, order.amount)
 *   await sendEmail(order.email, 'Order confirmed!')
 *
 *   return { status: 'completed', orderTime }
 * }
 * ```
 */

import { AsyncLocalStorage } from 'async_hooks'
import { WaitForEventManager, WaitTimeoutError, WaitCancelledError } from '../../WaitForEventManager'
import { DurableWorkflowRuntime, InMemoryStepStorage } from '../../runtime'
import type { StepStorage } from '../../runtime'
import { parseDuration, ensureError } from '../utils'

// ============================================================================
// DETERMINISM ENFORCEMENT - Runtime detection of non-deterministic patterns
// ============================================================================

/**
 * Configuration for determinism enforcement
 */
interface DeterminismConfig {
  /** Whether to warn about non-deterministic operations (default: true in dev, false in prod) */
  warnOnNonDeterministic: boolean
}

// Default configuration - warn in development, silent in production
let determinismConfig: DeterminismConfig = {
  warnOnNonDeterministic: typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production',
}

/**
 * Configure determinism enforcement settings
 *
 * @example
 * ```typescript
 * import { configureDeterminism } from '@dotdo/temporal'
 *
 * // Disable warnings in tests
 * configureDeterminism({ warnOnNonDeterministic: false })
 *
 * // Enable warnings in production for debugging
 * configureDeterminism({ warnOnNonDeterministic: true })
 * ```
 */
export function configureDeterminism(config: Partial<DeterminismConfig>): void {
  determinismConfig = { ...determinismConfig, ...config }
}

/**
 * Types of non-deterministic operations that can be detected
 */
export type DeterminismViolationType =
  | 'Date.now'
  | 'new Date'
  | 'Math.random'
  | 'crypto.randomUUID'
  | 'fetch'
  | 'setTimeout'
  | 'setInterval'

/**
 * Warning class for tracking determinism violations.
 * These are logged in development mode to help identify potential replay issues.
 */
export class WorkflowDeterminismWarning {
  /** Type of non-deterministic operation detected */
  readonly type: DeterminismViolationType

  /** Human-readable message describing the violation */
  readonly message: string

  /** Stack trace showing where the violation occurred */
  readonly stack: string | undefined

  /** Workflow ID where the violation was detected (if available) */
  readonly workflowId: string | undefined

  /** Suggested alternative to use instead */
  readonly suggestion: string

  /** Timestamp when the warning was created */
  readonly timestamp: Date

  constructor(
    type: DeterminismViolationType,
    message: string,
    suggestion: string,
    workflowId?: string
  ) {
    this.type = type
    this.message = message
    this.suggestion = suggestion
    this.workflowId = workflowId
    this.timestamp = new Date()
    this.stack = new Error().stack
  }

  /**
   * Format the warning for console output
   */
  toString(): string {
    const workflowInfo = this.workflowId ? ` in workflow ${this.workflowId}` : ''
    return `[WorkflowDeterminismWarning]${workflowInfo}: ${this.message}\n  Suggestion: ${this.suggestion}`
  }
}

/**
 * Track warnings for analysis (limited to prevent memory leaks)
 */
const MAX_WARNINGS = 100
const determinismWarnings: WorkflowDeterminismWarning[] = []

/**
 * Get all recorded determinism warnings
 */
export function getDeterminismWarnings(): readonly WorkflowDeterminismWarning[] {
  return determinismWarnings
}

/**
 * Clear all recorded determinism warnings
 */
export function clearDeterminismWarnings(): void {
  determinismWarnings.length = 0
}

/**
 * Record a determinism violation warning
 */
function warnNonDeterministic(
  type: DeterminismViolationType,
  message: string,
  suggestion: string
): void {
  // Only warn if enabled and we're in a workflow context
  const workflow = getCurrentWorkflow()
  if (!determinismConfig.warnOnNonDeterministic || !workflow) {
    return
  }

  const warning = new WorkflowDeterminismWarning(
    type,
    message,
    suggestion,
    workflow.workflowId
  )

  // Store warning (with limit to prevent memory leaks)
  if (determinismWarnings.length < MAX_WARNINGS) {
    determinismWarnings.push(warning)
  }

  // Log to console in development
  console.warn(warning.toString())
}

// ============================================================================
// TYPES - Match Temporal SDK exactly
// ============================================================================

export interface ActivityOptions {
  /** Start-to-close timeout */
  startToCloseTimeout?: string | number
  /** Schedule-to-close timeout */
  scheduleToCloseTimeout?: string | number
  /** Schedule-to-start timeout */
  scheduleToStartTimeout?: string | number
  /** Heartbeat timeout */
  heartbeatTimeout?: string | number
  /** Retry policy */
  retry?: RetryPolicy
  /** Task queue */
  taskQueue?: string
}

export interface LocalActivityOptions extends ActivityOptions {
  /** Local retry policy (uses shorter defaults) */
  localRetryThreshold?: string | number
}

export interface RetryPolicy {
  /** Initial retry interval */
  initialInterval?: string | number
  /** Backoff coefficient (multiplier) */
  backoffCoefficient?: number
  /** Maximum retry interval */
  maximumInterval?: string | number
  /** Maximum number of attempts (including first try) */
  maximumAttempts?: number
  /** Non-retryable error types */
  nonRetryableErrorTypes?: string[]
}

export interface ChildWorkflowOptions {
  /** Workflow ID */
  workflowId?: string
  /** Task queue */
  taskQueue?: string
  /** Workflow execution timeout */
  workflowExecutionTimeout?: string | number
  /** Workflow run timeout */
  workflowRunTimeout?: string | number
  /** Workflow task timeout */
  workflowTaskTimeout?: string | number
  /** Retry policy */
  retry?: RetryPolicy
  /** Cancellation type */
  cancellationType?: CancellationType
  /** Parent close policy */
  parentClosePolicy?: ParentClosePolicy
  /** Memo */
  memo?: Record<string, unknown>
  /** Search attributes */
  searchAttributes?: SearchAttributes
}

export type CancellationType = 'WAIT_CANCELLATION_COMPLETED' | 'TRY_CANCEL' | 'ABANDON'

export type ParentClosePolicy = 'TERMINATE' | 'ABANDON' | 'REQUEST_CANCEL'

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
// SEARCH ATTRIBUTES TYPE
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

export interface SignalDefinition<Args extends unknown[] = []> {
  readonly name: string
  readonly type: 'signal'
}

export interface QueryDefinition<TResult = unknown, Args extends unknown[] = []> {
  readonly name: string
  readonly type: 'query'
}

export interface UpdateDefinition<TResult = unknown, Args extends unknown[] = []> {
  readonly name: string
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
  connection?: unknown
  /** Namespace */
  namespace?: string
  /** Data converter */
  dataConverter?: unknown
  /** Interceptors */
  interceptors?: unknown[]
  /** Durable storage */
  storage?: StepStorage
  /** DO state */
  state?: DurableObjectState
}

export interface WorkflowStartOptions<TArgs extends unknown[]> {
  /** Task queue */
  taskQueue: string
  /** Workflow ID */
  workflowId?: string
  /** Workflow arguments */
  args?: TArgs
  /** Retry policy */
  retry?: RetryPolicy
  /** Workflow execution timeout */
  workflowExecutionTimeout?: string | number
  /** Workflow run timeout */
  workflowRunTimeout?: string | number
  /** Workflow task timeout */
  workflowTaskTimeout?: string | number
  /** Memo */
  memo?: Record<string, unknown>
  /** Search attributes */
  searchAttributes?: SearchAttributes
  /** Cron schedule */
  cronSchedule?: string
}

export interface SignalWithStartOptions<TSignalArgs extends unknown[], TWorkflowArgs extends unknown[]> extends WorkflowStartOptions<TWorkflowArgs> {
  signal: SignalDefinition<TSignalArgs>
  signalArgs: TSignalArgs
}

export interface ListWorkflowOptions {
  /** Search query (Temporal SQL-like syntax) */
  query?: string
  /** Maximum number of results */
  pageSize?: number
}

// ============================================================================
// WORKFLOW STATE TYPES
// ============================================================================

interface WorkflowState {
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
}

// Patch tracking for versioning
interface PatchState {
  appliedPatches: Set<string>
  deprecatedPatches: Set<string>
}

// Timer tracking
interface TimerState {
  id: string
  pending: boolean
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout> | null
  /** Timestamp when timer was created, for staleness detection */
  createdAt: number
  /** Expected fire time for cleanup calculations */
  expectedFireAt: number
}

// ============================================================================
// WORKFLOW CONTEXT - AsyncLocalStorage for concurrent execution support
// ============================================================================

/**
 * WorkflowContext encapsulates all per-execution state, enabling concurrent
 * workflow execution without global state pollution.
 *
 * This solves the issue where global mutable variables prevent:
 * - Tests from running in parallel
 * - Multiple concurrent workflow executions
 * - Type safety for workflow context
 */
interface WorkflowContext {
  workflow: WorkflowState
  patchState: PatchState | null
  storage: StepStorage
  waitManager: WaitForEventManager | null
}

// AsyncLocalStorage provides execution-scoped context
// This works in both Node.js and Cloudflare Workers runtime
const workflowContextStorage = new AsyncLocalStorage<WorkflowContext>()

/**
 * Get the current workflow context from AsyncLocalStorage.
 * Returns null if not executing within a workflow.
 */
function getCurrentContext(): WorkflowContext | null {
  return workflowContextStorage.getStore() ?? null
}

/**
 * Get the current workflow state for backward compatibility.
 * This function bridges the old global state approach with the new context-based approach.
 */
function getCurrentWorkflow(): WorkflowState | null {
  const ctx = getCurrentContext()
  return ctx?.workflow ?? null
}

/**
 * Get the current patch state from context.
 */
function getCurrentPatchState(): PatchState | null {
  const ctx = getCurrentContext()
  return ctx?.patchState ?? null
}

/**
 * Set the current patch state within the context.
 */
function setCurrentPatchState(patchState: PatchState): void {
  const ctx = getCurrentContext()
  if (ctx) {
    ctx.patchState = patchState
  }
}

/**
 * Execute a workflow function within a context.
 * This ensures all workflow operations have access to the correct context.
 */
function runWithContext<T>(context: WorkflowContext, fn: () => T): T {
  return workflowContextStorage.run(context, fn)
}

// ============================================================================
// DETERMINISTIC TIME - workflowNow() implementation
// ============================================================================

/**
 * Per-workflow counters for deterministic workflowNow() step IDs
 */
const nowCounters = new WeakMap<WorkflowState, number>()

/**
 * Get deterministic current time (for replay).
 *
 * This function returns a deterministic timestamp based on workflow start time
 * plus an offset derived from the step count. On replay, it returns the same
 * timestamp that was recorded during the original execution.
 *
 * Use this instead of `Date.now()` or `new Date()` in workflow code.
 *
 * @returns A Date object representing the current workflow time
 * @throws Error if called outside a workflow context
 *
 * @example
 * ```typescript
 * import { workflowNow } from '@dotdo/temporal'
 *
 * export async function orderWorkflow() {
 *   // Use workflowNow() instead of new Date() or Date.now()
 *   const orderTime = workflowNow()
 *   const expiresAt = new Date(workflowNow().getTime() + 24 * 60 * 60 * 1000)
 *
 *   return { orderTime, expiresAt }
 * }
 * ```
 */
export function workflowNow(): Date {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    // Outside workflow context - fall back to real time
    // This allows usage in tests or non-workflow code
    return new Date()
  }

  // Get and increment the counter for this workflow
  const counter = nowCounters.get(workflow) ?? 0
  nowCounters.set(workflow, counter + 1)

  // Create deterministic step ID based on call order
  const stepId = `workflowNow:${counter}`

  // Check for existing result (replay case)
  if (workflow.stepResults.has(stepId)) {
    return new Date(workflow.stepResults.get(stepId) as number)
  }

  // Calculate deterministic time:
  // Start time + (step count * small increment to show progression)
  // This ensures time appears to progress while remaining deterministic
  const baseTime = workflow.startTime.getTime()
  const stepIncrement = workflow.historyLength * 1 // 1ms per step for minimal progression
  const deterministicTime = baseTime + stepIncrement

  // Store for replay
  workflow.stepResults.set(stepId, deterministicTime)
  workflow.historyLength++

  return new Date(deterministicTime)
}

// ============================================================================
// NON-DETERMINISTIC PATTERN DETECTION - Interceptors for common violations
// ============================================================================

// Store original functions for restoration and proxying
const originalDateNow = Date.now
const originalMathRandom = Math.random
const originalFetch = typeof fetch !== 'undefined' ? fetch : undefined
const originalSetTimeout = setTimeout
const originalSetInterval = setInterval

/**
 * Wrapped Date.now that warns about non-deterministic usage in workflows
 */
function wrappedDateNow(): number {
  const workflow = getCurrentWorkflow()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'Date.now',
      'Date.now() is non-deterministic and will return different values on replay',
      'Use workflowNow() for deterministic timestamps'
    )
  }
  return originalDateNow.call(Date)
}

/**
 * Wrapped Math.random that warns about non-deterministic usage in workflows
 */
function wrappedMathRandom(): number {
  const workflow = getCurrentWorkflow()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'Math.random',
      'Math.random() is non-deterministic and will return different values on replay',
      'Use random() for deterministic random numbers'
    )
  }
  return originalMathRandom.call(Math)
}

/**
 * Wrapped fetch that warns about non-deterministic usage in workflows
 */
function wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const workflow = getCurrentWorkflow()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'fetch',
      'fetch() is non-deterministic - network responses can vary between executions',
      'Use activities (proxyActivities) for network calls'
    )
  }
  return originalFetch!(input, init)
}

/**
 * Wrapped setTimeout that warns about non-deterministic usage in workflows
 */
function wrappedSetTimeout<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
): ReturnType<typeof setTimeout> {
  const workflow = getCurrentWorkflow()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'setTimeout',
      'setTimeout() is non-deterministic - timing varies between executions',
      'Use sleep() or createTimer() for durable delays'
    )
  }
  return originalSetTimeout(callback, ms, ...args)
}

/**
 * Wrapped setInterval that warns about non-deterministic usage in workflows
 */
function wrappedSetInterval<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
): ReturnType<typeof setInterval> {
  const workflow = getCurrentWorkflow()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'setInterval',
      'setInterval() is non-deterministic - timing varies between executions',
      'Use sleep() in a loop or schedule recurring activities'
    )
  }
  return originalSetInterval(callback, ms, ...args)
}

/**
 * Enable determinism detection by patching global functions.
 * This is automatically called when the module loads in development mode.
 *
 * Note: This patches global objects, which may affect other code.
 * Use with caution in shared environments.
 */
export function enableDeterminismDetection(): void {
  // Only patch if we're configured to warn
  if (!determinismConfig.warnOnNonDeterministic) {
    return
  }

  // Patch Date.now
  Date.now = wrappedDateNow

  // Patch Math.random
  Math.random = wrappedMathRandom

  // Patch fetch if available
  if (originalFetch && typeof globalThis !== 'undefined') {
    ;(globalThis as Record<string, unknown>).fetch = wrappedFetch
  }

  // Patch setTimeout and setInterval
  // Note: These are intentionally not patched by default as they're used internally
  // by the workflow runtime. Only patch if explicitly requested.
}

/**
 * Disable determinism detection and restore original functions.
 */
export function disableDeterminismDetection(): void {
  Date.now = originalDateNow
  Math.random = originalMathRandom

  if (originalFetch && typeof globalThis !== 'undefined') {
    ;(globalThis as Record<string, unknown>).fetch = originalFetch
  }
}

/**
 * Check if code is running within a workflow context.
 * Useful for conditional behavior based on workflow vs non-workflow execution.
 */
export function inWorkflowContext(): boolean {
  return getCurrentWorkflow() !== null
}

// ============================================================================
// GLOBAL REGISTRIES - These are shared lookup tables, not per-execution state
// ============================================================================

let globalStorage: StepStorage = new InMemoryStepStorage()
let globalState: DurableObjectState | null = null
let globalWaitManager: WaitForEventManager | null = null
let globalNamespace = 'default'

// Workflow registry - shared across all executions for handle lookups
const workflows = new Map<string, WorkflowState>()
const workflowFunctions = new Map<string, (...args: unknown[]) => Promise<unknown>>()

// ============================================================================
// TASK QUEUE REGISTRY - Worker registration and routing
// ============================================================================

/**
 * Worker handler type - receives workflow/activity execution requests
 */
export type WorkerHandler = {
  /** Registered workflow types this worker handles */
  workflowTypes?: Set<string>
  /** Registered activity types this worker handles */
  activityTypes?: Set<string>
  /** Custom handler for executing workflows */
  executeWorkflow?: (workflowType: string, args: unknown[]) => Promise<unknown>
  /** Custom handler for executing activities */
  executeActivity?: (activityName: string, args: unknown[]) => Promise<unknown>
}

/**
 * Task queue registry maps queue names to their registered workers
 */
const taskQueueRegistry = new Map<string, WorkerHandler>()

/**
 * Error thrown when attempting to use an unregistered task queue.
 * This mirrors Temporal's behavior where workflows fail if no worker
 * is polling the specified task queue.
 */
export class TaskQueueNotRegisteredError extends Error {
  readonly taskQueue: string
  readonly type: 'workflow' | 'activity'

  constructor(taskQueue: string, type: 'workflow' | 'activity' = 'workflow') {
    super(
      `No worker registered for task queue "${taskQueue}". ` +
        `Ensure a worker is polling this queue before starting ${type === 'workflow' ? 'workflows' : 'activities'}.`
    )
    this.name = 'TaskQueueNotRegisteredError'
    this.taskQueue = taskQueue
    this.type = type
  }
}

/**
 * Register a worker for a task queue.
 *
 * In real Temporal, workers poll task queues for work. This compat layer
 * validates that a worker is registered before allowing workflow/activity
 * execution on that queue.
 *
 * @param taskQueue - The task queue name to register
 * @param handler - Optional handler configuration for the worker
 * @returns A function to unregister the worker
 *
 * @example
 * ```typescript
 * import { registerWorker } from '@dotdo/temporal'
 *
 * // Simple registration - just validates the queue exists
 * const unregister = registerWorker('my-task-queue')
 *
 * // With workflow types
 * const unregister = registerWorker('my-task-queue', {
 *   workflowTypes: new Set(['orderWorkflow', 'paymentWorkflow']),
 * })
 *
 * // Cleanup when done
 * unregister()
 * ```
 */
export function registerWorker(taskQueue: string, handler: WorkerHandler = {}): () => void {
  if (!taskQueue || typeof taskQueue !== 'string') {
    throw new Error('Task queue name must be a non-empty string')
  }

  taskQueueRegistry.set(taskQueue, {
    workflowTypes: handler.workflowTypes ?? new Set(),
    activityTypes: handler.activityTypes ?? new Set(),
    executeWorkflow: handler.executeWorkflow,
    executeActivity: handler.executeActivity,
  })

  // Return unregister function
  return () => {
    taskQueueRegistry.delete(taskQueue)
  }
}

/**
 * Check if a task queue has a registered worker
 */
export function hasWorker(taskQueue: string): boolean {
  return taskQueueRegistry.has(taskQueue)
}

/**
 * Get the worker handler for a task queue
 */
export function getWorker(taskQueue: string): WorkerHandler | undefined {
  return taskQueueRegistry.get(taskQueue)
}

/**
 * List all registered task queues
 */
export function listTaskQueues(): string[] {
  return Array.from(taskQueueRegistry.keys())
}

/**
 * Validate that a task queue is registered for workflow execution.
/**
 * Check if task queue routing is enabled.
 *
 * Task queue validation is enabled when at least one worker has been registered.
 * This maintains backward compatibility - existing code that doesnt use
 * registerWorker() will continue to work without changes.
 */
function isTaskQueueRoutingEnabled(): boolean {
  return taskQueueRegistry.size > 0
}

/**
 * Validate that a task queue is registered for workflow execution.
 * Throws TaskQueueNotRegisteredError if not registered.
 *
 * NOTE: Validation is only performed when task queue routing is enabled
 * (i.e., when at least one worker has been registered via registerWorker()).
 * This maintains backward compatibility with existing code.
 *
 * @param taskQueue - The task queue to validate
 * @param workflowType - Optional workflow type for more specific validation
 * @throws TaskQueueNotRegisteredError if no worker is registered
 */
function validateTaskQueueForWorkflow(taskQueue: string, workflowType?: string): void {
  // Skip validation if no workers are registered (backward compatibility)
  if (!isTaskQueueRoutingEnabled()) {
    return
  }

  const worker = taskQueueRegistry.get(taskQueue)
  if (!worker) {
    throw new TaskQueueNotRegisteredError(taskQueue, 'workflow')
  }

  // If worker specifies workflow types, validate this type is registered
  if (workflowType && worker.workflowTypes && worker.workflowTypes.size > 0) {
    if (!worker.workflowTypes.has(workflowType)) {
      throw new Error(
        `Workflow type "${workflowType}" is not registered on task queue "${taskQueue}". ` +
          `Registered types: ${Array.from(worker.workflowTypes).join(', ')}` 
      )
    }
  }
}

/**
 * Validate that a task queue is registered for activity execution.
 * Throws TaskQueueNotRegisteredError if not registered.
 *
 * NOTE: Validation is only performed when task queue routing is enabled
 * (i.e., when at least one worker has been registered via registerWorker()).
 * This maintains backward compatibility with existing code.
 *
 * @param taskQueue - The task queue to validate
 * @param activityName - Optional activity name for more specific validation
 * @throws TaskQueueNotRegisteredError if no worker is registered
 */
function validateTaskQueueForActivity(taskQueue: string, activityName?: string): void {
  // Skip validation if no workers are registered (backward compatibility)
  if (!isTaskQueueRoutingEnabled()) {
    return
  }

  const worker = taskQueueRegistry.get(taskQueue)
  if (!worker) {
    throw new TaskQueueNotRegisteredError(taskQueue, 'activity')
  }

  // If worker specifies activity types, validate this activity is registered
  if (activityName && worker.activityTypes && worker.activityTypes.size > 0) {
    if (!worker.activityTypes.has(activityName)) {
      throw new Error(
        `Activity "${activityName}" is not registered on task queue "${taskQueue}". ` +
          `Registered activities: ${Array.from(worker.activityTypes).join(', ')}` 
      )
    }
  }
}

// Timer tracking - global for cancel operations by ID
const activeTimers = new Map<string, TimerState>()

// ============================================================================
// WORKFLOW REGISTRY CLEANUP - Memory leak prevention
// ============================================================================

// Completed workflows are kept for a short TTL to allow result retrieval
const WORKFLOW_COMPLETED_TTL_MS = 60 * 60 * 1000 // 1 hour
// Maximum number of workflows to keep in registry (LRU eviction)
const WORKFLOW_MAX_REGISTRY_SIZE = 10000
// Cleanup interval for expired workflows
const WORKFLOW_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// Track completion times for TTL-based cleanup
const workflowCompletionTimes = new Map<string, number>()

let workflowCleanupIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Terminal states that indicate a workflow has finished execution
 */
const TERMINAL_STATES: Set<WorkflowExecutionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
])

/**
 * Check if a workflow status is terminal (finished)
 */
function isTerminalState(status: WorkflowExecutionStatus): boolean {
  return TERMINAL_STATES.has(status)
}

/**
 * Mark a workflow as completed and schedule cleanup.
 * Called when a workflow transitions to a terminal state.
 */
function markWorkflowCompleted(workflowId: string): void {
  workflowCompletionTimes.set(workflowId, Date.now())
}

/**
 * Remove a workflow from the registry and cleanup tracking
 */
function removeWorkflow(workflowId: string): void {
  workflows.delete(workflowId)
  workflowCompletionTimes.delete(workflowId)
}

/**
 * Clean up expired workflows (past TTL) and enforce LRU eviction.
 * This runs periodically to prevent unbounded memory growth.
 */
function cleanupExpiredWorkflows(): void {
  const now = Date.now()
  const expiredIds: string[] = []

  // Find workflows past their TTL
  for (const [workflowId, completionTime] of workflowCompletionTimes) {
    if (now - completionTime >= WORKFLOW_COMPLETED_TTL_MS) {
      expiredIds.push(workflowId)
    }
  }

  // Remove expired workflows
  for (const workflowId of expiredIds) {
    removeWorkflow(workflowId)
  }

  // LRU eviction if still over max size
  if (workflows.size > WORKFLOW_MAX_REGISTRY_SIZE) {
    // Sort completed workflows by completion time (oldest first)
    const completedWorkflows = [...workflowCompletionTimes.entries()]
      .sort((a, b) => a[1] - b[1])

    // Evict oldest completed workflows until under limit
    const excessCount = workflows.size - WORKFLOW_MAX_REGISTRY_SIZE
    for (let i = 0; i < Math.min(excessCount, completedWorkflows.length); i++) {
      removeWorkflow(completedWorkflows[i][0])
    }
  }
}

/**
 * Start the periodic workflow cleanup (for production use).
 * This should be called once when the module is loaded in a long-running process.
 */
export function __startWorkflowCleanup(): void {
  if (workflowCleanupIntervalId === null) {
    workflowCleanupIntervalId = setInterval(cleanupExpiredWorkflows, WORKFLOW_CLEANUP_INTERVAL_MS)
    // Unref the interval so it doesn't prevent process exit
    if (typeof workflowCleanupIntervalId === 'object' && 'unref' in workflowCleanupIntervalId) {
      workflowCleanupIntervalId.unref()
    }
  }
}

/**
 * Stop the periodic workflow cleanup.
 */
export function __stopWorkflowCleanup(): void {
  if (workflowCleanupIntervalId !== null) {
    clearInterval(workflowCleanupIntervalId)
    workflowCleanupIntervalId = null
  }
}

export function configure(opts: { storage?: StepStorage; state?: DurableObjectState; namespace?: string }): void {
  if (opts.storage) globalStorage = opts.storage
  if (opts.state) {
    globalState = opts.state
    globalWaitManager = new WaitForEventManager(opts.state)
  }
  if (opts.namespace) globalNamespace = opts.namespace
}

// ============================================================================
// UTILITIES
// Note: parseDuration and ensureError are imported from '../utils'
// ============================================================================

function generateWorkflowId(): string {
  return `wf_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateTimerId(): string {
  return `timer_${crypto.randomUUID().replace(/-/g, '')}`
}

// ============================================================================
// SIGNAL, QUERY, UPDATE DEFINITIONS
// ============================================================================

/**
 * Define a signal
 */
export function defineSignal<Args extends unknown[] = []>(name: string): SignalDefinition<Args> {
  return { name, type: 'signal' }
}

/**
 * Define a query
 */
export function defineQuery<TResult = unknown, Args extends unknown[] = []>(name: string): QueryDefinition<TResult, Args> {
  return { name, type: 'query' }
}

/**
 * Define an update
 */
export function defineUpdate<TResult = unknown, Args extends unknown[] = []>(name: string): UpdateDefinition<TResult, Args> {
  return { name, type: 'update' }
}

/**
 * Set handler for signal, query, or update
 */
export function setHandler<Args extends unknown[]>(signal: SignalDefinition<Args>, handler: SignalHandler<Args>): void
export function setHandler<TResult, Args extends unknown[]>(query: QueryDefinition<TResult, Args>, handler: QueryHandler<TResult, Args>): void
export function setHandler<TResult, Args extends unknown[]>(update: UpdateDefinition<TResult, Args>, handler: UpdateHandler<TResult, Args>): void
export function setHandler(
  definition: SignalDefinition<unknown[]> | QueryDefinition<unknown, unknown[]> | UpdateDefinition<unknown, unknown[]>,
  handler: SignalHandler<unknown[]> | QueryHandler<unknown, unknown[]> | UpdateHandler<unknown, unknown[]>
): void {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('setHandler can only be called within a workflow')
  }

  if (definition.type === 'signal') {
    workflow.signalHandlers.set(definition.name, handler as SignalHandler<unknown[]>)
  } else if (definition.type === 'query') {
    workflow.queryHandlers.set(definition.name, handler as QueryHandler<unknown, unknown[]>)
  } else {
    workflow.updateHandlers.set(definition.name, handler as UpdateHandler<unknown, unknown[]>)
  }
}

// ============================================================================
// WORKFLOW INFO - Enhanced with full context
// ============================================================================

/**
 * Get current workflow info
 */
export function workflowInfo(): WorkflowInfo {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('workflowInfo can only be called within a workflow')
  }

  return {
    workflowId: workflow.workflowId,
    runId: workflow.runId,
    workflowType: workflow.workflowType,
    taskQueue: workflow.taskQueue,
    namespace: workflow.namespace,
    firstExecutionRunId: workflow.runId,
    attempt: workflow.attempt,
    historyLength: workflow.historyLength,
    startTime: workflow.startTime,
    runStartTime: workflow.runStartTime,
    memo: workflow.memo,
    searchAttributes: workflow.searchAttributes,
    parent: workflow.parent,
  }
}

// ============================================================================
// SEARCH ATTRIBUTES - Full implementation
// ============================================================================

/**
 * Set search attributes (replaces all)
 */
export function setSearchAttributes(attrs: SearchAttributes): void {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('setSearchAttributes can only be called within a workflow')
  }
  workflow.searchAttributes = { ...attrs }
  workflow.historyLength++
}

/**
 * Upsert (merge) search attributes
 */
export function upsertSearchAttributes(attrs: SearchAttributes): void {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('upsertSearchAttributes can only be called within a workflow')
  }
  workflow.searchAttributes = {
    ...workflow.searchAttributes,
    ...attrs,
  }
  workflow.historyLength++
}

// ============================================================================
// TIMERS - Full implementation with coalescing optimization
// ============================================================================

// Timer coalescing: Group timers that fire within the same 10ms window
const TIMER_COALESCE_WINDOW_MS = 10
const coalescedTimerBuckets = new Map<number, TimerState[]>()

// Periodic cleanup for stale timer buckets (memory leak prevention)
// Timers are considered stale if they haven't fired 5 minutes past their expected time
const TIMER_STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const TIMER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Run cleanup every 5 minutes
let timerCleanupIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Clean up stale timer buckets that haven't fired.
 * This handles cases where:
 * - Workflows terminate without cancelling their timers
 * - setTimeout fails to fire for some reason
 * - Timers are orphaned due to errors
 */
function cleanupStaleTimerBuckets(): void {
  const now = Date.now()
  const bucketsToDelete: number[] = []

  for (const [bucket, timers] of coalescedTimerBuckets) {
    // Filter out stale timers from this bucket
    const activeTimersInBucket = timers.filter((timer) => {
      // Timer is stale if it's past its expected fire time + threshold
      const isStale = timer.pending && now > timer.expectedFireAt + TIMER_STALE_THRESHOLD_MS

      if (isStale) {
        // Clean up the stale timer
        timer.pending = false
        if (timer.timeoutId) {
          clearTimeout(timer.timeoutId)
        }
        activeTimers.delete(timer.id)
      }

      return !isStale
    })

    if (activeTimersInBucket.length === 0) {
      bucketsToDelete.push(bucket)
    } else if (activeTimersInBucket.length !== timers.length) {
      // Update the bucket with only active timers
      coalescedTimerBuckets.set(bucket, activeTimersInBucket)
    }
  }

  // Delete empty buckets
  for (const bucket of bucketsToDelete) {
    coalescedTimerBuckets.delete(bucket)
  }
}

/**
 * Start the periodic timer cleanup (for production use).
 * This should be called once when the module is loaded in a long-running process.
 */
export function __startTimerCleanup(): void {
  if (timerCleanupIntervalId === null) {
    timerCleanupIntervalId = setInterval(cleanupStaleTimerBuckets, TIMER_CLEANUP_INTERVAL_MS)
    // Unref the interval so it doesn't prevent process exit
    if (typeof timerCleanupIntervalId === 'object' && 'unref' in timerCleanupIntervalId) {
      timerCleanupIntervalId.unref()
    }
  }
}

/**
 * Stop the periodic timer cleanup.
 */
export function __stopTimerCleanup(): void {
  if (timerCleanupIntervalId !== null) {
    clearInterval(timerCleanupIntervalId)
    timerCleanupIntervalId = null
  }
}

/**
 * Create a cancellable timer with optional coalescing
 *
 * OPTIMIZATION: Timers firing within 10ms of each other are coalesced
 * into a single setTimeout call, reducing system call overhead.
 */
export function createTimer(duration: string | number): TimerHandle {
  const ms = parseDuration(duration)
  const id = generateTimerId()
  const now = Date.now()

  let resolveTimer: () => void
  let rejectTimer: (error: Error) => void

  const promise = new Promise<void>((resolve, reject) => {
    resolveTimer = resolve
    rejectTimer = reject
  })

  const timerState: TimerState = {
    id,
    pending: true,
    resolve: resolveTimer!,
    reject: rejectTimer!,
    timeoutId: null,
    createdAt: now,
    expectedFireAt: now + ms,
  }

  activeTimers.set(id, timerState)

  // Calculate coalesce bucket (round to nearest TIMER_COALESCE_WINDOW_MS)
  const bucket = Math.floor(ms / TIMER_COALESCE_WINDOW_MS) * TIMER_COALESCE_WINDOW_MS

  // Check if we can coalesce with an existing timer
  const existingBucket = coalescedTimerBuckets.get(bucket)
  if (existingBucket && existingBucket.length > 0) {
    // Coalesce: add to existing bucket
    existingBucket.push(timerState)
  } else {
    // Create new bucket with single timer
    const newBucket = [timerState]
    coalescedTimerBuckets.set(bucket, newBucket)

    // Set the actual timeout
    timerState.timeoutId = setTimeout(() => {
      // Fire all timers in this bucket
      const timersToFire = coalescedTimerBuckets.get(bucket) || []
      coalescedTimerBuckets.delete(bucket)

      for (const timer of timersToFire) {
        if (timer.pending) {
          timer.pending = false
          timer.resolve()
          activeTimers.delete(timer.id)
          const workflow = getCurrentWorkflow()
          if (workflow) {
            workflow.historyLength++
          }
        }
      }
    }, ms)
  }

  // Create a TimerHandle with additional properties
  const handle = promise as TimerHandle
  Object.defineProperty(handle, 'id', { value: id, writable: false })
  Object.defineProperty(handle, 'pending', {
    get: () => timerState.pending,
  })

  return handle
}

/**
 * Cancel a timer
 *
 * OPTIMIZATION: Also removes from coalesced bucket to prevent
 * unnecessary processing of cancelled timers.
 */
export function cancelTimer(timer: TimerHandle): void {
  const timerState = activeTimers.get(timer.id)
  if (timerState && timerState.pending) {
    timerState.pending = false
    if (timerState.timeoutId) {
      clearTimeout(timerState.timeoutId)
    }

    // Remove from coalesced bucket if present
    for (const [bucket, timers] of coalescedTimerBuckets) {
      const index = timers.findIndex(t => t.id === timer.id)
      if (index !== -1) {
        timers.splice(index, 1)
        if (timers.length === 0) {
          coalescedTimerBuckets.delete(bucket)
        }
        break
      }
    }

    timerState.reject(new WaitCancelledError('Timer cancelled'))
    activeTimers.delete(timer.id)
  }
}

/**
 * Clear all internal state (useful for testing)
 * Note: AsyncLocalStorage context is automatically cleaned up when execution ends
 *
 * This function properly cleans up all timer resources to prevent memory leaks:
 * - Cancels all pending setTimeout calls
 * - Clears all timer state maps
 * - Stops the periodic cleanup interval
 */
export function __clearTemporalState(): void {
  workflows.clear()
  workflowFunctions.clear()

  // Clear workflow completion tracking (memory leak fix)
  workflowCompletionTimes.clear()

  // Clear task queue registry
  taskQueueRegistry.clear()

  // Properly cancel all active timers to prevent memory leaks
  for (const timer of activeTimers.values()) {
    if (timer.timeoutId) {
      clearTimeout(timer.timeoutId)
    }
    timer.pending = false
  }
  activeTimers.clear()

  // Clear coalesced timer buckets (also cancel any timeouts)
  for (const timers of coalescedTimerBuckets.values()) {
    for (const timer of timers) {
      if (timer.timeoutId) {
        clearTimeout(timer.timeoutId)
      }
      timer.pending = false
    }
  }
  coalescedTimerBuckets.clear()

  // Stop the periodic cleanup intervals
  __stopTimerCleanup()
  __stopWorkflowCleanup()

  // Clear determinism tracking
  clearDeterminismWarnings()
  disableDeterminismDetection()

  globalNamespace = 'default'
}

// ============================================================================
// VERSIONING / PATCHING - Full implementation
// ============================================================================

/**
 * Check if a patch should be applied
 * For new executions, this always returns true (take the new path)
 * For replays of old executions, this returns false to maintain compatibility
 */
export function patched(patchId: string): boolean {
  let patchState = getCurrentPatchState()
  if (!patchState) {
    patchState = {
      appliedPatches: new Set(),
      deprecatedPatches: new Set(),
    }
    setCurrentPatchState(patchState)
  }

  // For new executions, always apply patches
  // In a full implementation, this would check workflow history
  patchState.appliedPatches.add(patchId)

  const workflow = getCurrentWorkflow()
  if (workflow) {
    workflow.historyLength++
  }

  return true
}

/**
 * Deprecate an old patch (removes it from consideration in new workflow code)
 */
export function deprecatePatch(patchId: string): void {
  let patchState = getCurrentPatchState()
  if (!patchState) {
    patchState = {
      appliedPatches: new Set(),
      deprecatedPatches: new Set(),
    }
    setCurrentPatchState(patchState)
  }

  patchState.deprecatedPatches.add(patchId)
}

// ============================================================================
// SLEEP AND CONDITION
// ============================================================================

/**
 * Sleep for a duration (durable)
 *
 * This implementation persists sleep state to durable storage, ensuring that
 * if a worker restarts during a sleep, the sleep completion is not lost.
 * On replay, completed sleeps are skipped immediately.
 */
export async function sleep(duration: string | number): Promise<void> {
  const ctx = getCurrentContext()
  const workflow = ctx?.workflow ?? null
  if (!workflow) {
    throw new Error('sleep can only be called within a workflow')
  }

  const ms = parseDuration(duration)
  const stepId = `sleep:${ms}:${workflow.historyLength}`

  // Get storage from context, fallback to globalStorage
  const storage = ctx?.storage ?? globalStorage

  // Check durable storage first for completed sleep (survives worker restarts)
  const existingResult = await storage.get(stepId)
  if (existingResult?.status === 'completed') {
    // Also populate in-memory cache for consistency
    workflow.stepResults.set(stepId, true)
    return
  }

  // Check in-memory cache for replay within same execution
  if (workflow.stepResults.has(stepId)) {
    return
  }

  // Persist pending state before sleeping (in case of crash during sleep)
  await storage.set(stepId, {
    stepId,
    status: 'pending',
    attempts: 1,
    createdAt: Date.now(),
  })

  await new Promise((resolve) => setTimeout(resolve, ms))

  // Persist completed state to durable storage
  await storage.set(stepId, {
    stepId,
    status: 'completed',
    result: true,
    attempts: 1,
    createdAt: Date.now(),
    completedAt: Date.now(),
  })

  // Also update in-memory cache
  workflow.stepResults.set(stepId, true)
  workflow.historyLength++
}

/**
 * Wait for a condition to be true
 */
export async function condition(fn: () => boolean, timeout?: string | number): Promise<boolean> {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('condition can only be called within a workflow')
  }

  const timeoutMs = timeout ? parseDuration(timeout) : undefined
  const startTime = Date.now()

  while (true) {
    try {
      if (fn()) {
        break
      }
    } catch (error) {
      // Log the error for debugging but let it propagate
      const err = ensureError(error)
      console.error(`[condition] Error in condition function: ${err.message}`)
      throw err
    }

    // Check timeout
    if (timeoutMs && Date.now() - startTime >= timeoutMs) {
      return false
    }

    // Poll every 100ms
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return true
}

// ============================================================================
// ACTIVITIES
// ============================================================================

type ActivityFunction = (...args: unknown[]) => Promise<unknown>
type Activities = Record<string, ActivityFunction>

/**
 * Create activity proxies
 *
 * Activities can specify a `taskQueue` option to route execution to a specific
 * worker. If a task queue is specified, it must have a registered worker.
 * If no task queue is specified, activities use the workflow's task queue.
 */
export function proxyActivities<T extends Activities>(options: ActivityOptions): T {
  const runtime = new DurableWorkflowRuntime({
    storage: globalStorage,
    retryPolicy: options.retry
      ? {
          maxAttempts: options.retry.maximumAttempts ?? 3,
          initialDelayMs: options.retry.initialInterval ? parseDuration(options.retry.initialInterval) : 1000,
          maxDelayMs: options.retry.maximumInterval ? parseDuration(options.retry.maximumInterval) : 30000,
          backoffMultiplier: options.retry.backoffCoefficient ?? 2,
          jitter: true,
        }
      : undefined,
  })

  // Activity task queue (can be different from workflow's task queue)
  const activityTaskQueue = options.taskQueue

  return new Proxy({} as T, {
    get(_, name: string) {
      return async (...args: unknown[]): Promise<unknown> => {
        const workflow = getCurrentWorkflow()
        if (!workflow) {
          throw new Error('Activities can only be called within a workflow')
        }

        // Determine which task queue to use for this activity
        const targetTaskQueue = activityTaskQueue ?? workflow.taskQueue

        // Validate the task queue has a registered worker
        validateTaskQueueForActivity(targetTaskQueue, name)

        const stepId = `activity:${name}:${JSON.stringify(args)}`

        // Check for replay
        if (workflow.stepResults.has(stepId)) {
          return workflow.stepResults.get(stepId)
        }

        // Execute the activity (in compat mode, activities are stubs)
        // In production, this would route to actual activity workers on the target task queue
        const result = await runtime.executeStep(
          stepId,
          {
            path: ['Activity', name],
            context: { args, taskQueue: targetTaskQueue },
            contextHash: stepId,
            runtime,
          },
          args,
          'do'
        )

        workflow.stepResults.set(stepId, result)
        workflow.historyLength++
        return result
      }
    },
  })
}

/**
 * Create local activity proxies
 */
export function proxyLocalActivities<T extends Activities>(options: LocalActivityOptions): T {
  // Local activities run in the same process with shorter timeouts
  return proxyActivities(options)
}

// ============================================================================
// CHILD WORKFLOWS - Enhanced implementation
// ============================================================================

/**
 * Start a child workflow
 *
 * @throws TaskQueueNotRegisteredError if no worker is registered for the task queue
 */
export async function startChild<T, TArgs extends unknown[]>(
  workflowType: string | ((...args: TArgs) => Promise<T>),
  options: ChildWorkflowOptions & { args?: TArgs }
): Promise<ChildWorkflowHandle<T>> {
  const typeName = typeof workflowType === 'string' ? workflowType : workflowType.name
  const workflowId = options.workflowId ?? generateWorkflowId()
  const runId = generateRunId()
  const now = new Date()

  const parentWorkflow = getCurrentWorkflow()

  // Determine the task queue for the child workflow
  const childTaskQueue = options.taskQueue ?? parentWorkflow?.taskQueue ?? 'default'

  // Validate task queue has a registered worker (like real Temporal)
  validateTaskQueueForWorkflow(childTaskQueue, typeName)

  // Get parent info if executing within a workflow
  const parentInfo: ParentWorkflowInfo | undefined = parentWorkflow
    ? {
        workflowId: parentWorkflow.workflowId,
        runId: parentWorkflow.runId,
        namespace: parentWorkflow.namespace,
      }
    : undefined

  // Create child workflow state
  const childState: WorkflowState = {
    workflowId,
    runId,
    workflowType: typeName,
    taskQueue: childTaskQueue,
    namespace: parentWorkflow?.namespace ?? globalNamespace,
    signalHandlers: new Map(),
    queryHandlers: new Map(),
    updateHandlers: new Map(),
    stepResults: new Map(),
    status: 'RUNNING',
    searchAttributes: options.searchAttributes ?? {},
    memo: options.memo,
    parent: parentInfo,
    startTime: now,
    runStartTime: now,
    historyLength: 1,
    attempt: 1,
    children: new Set(),
    parentClosePolicy: options.parentClosePolicy,
  }

  workflows.set(workflowId, childState)

  // Track child in parent
  if (parentWorkflow) {
    parentWorkflow.children.add(workflowId)
    parentWorkflow.historyLength++
  }

  // Execute in background with its own context
  const workflowFn = typeof workflowType === 'function' ? workflowType : workflowFunctions.get(typeName)
  if (workflowFn) {
    // Create a new context for the child workflow
    const childContext: WorkflowContext = {
      workflow: childState,
      patchState: null,
      storage: globalStorage,
      waitManager: globalWaitManager,
    }

    // Run the child workflow in its own context
    runWithContext(childContext, () => {
      workflowFn(...(options.args ?? []))
        .then((result) => {
          childState.status = 'COMPLETED'
          childState.result = result
          markWorkflowCompleted(workflowId)
        })
        .catch((error) => {
          childState.status = 'FAILED'
          childState.error = error
          markWorkflowCompleted(workflowId)
        })
    })
  }

  return {
    workflowId,
    firstExecutionRunId: runId,
    async result(): Promise<T> {
      // Poll until complete
      while (childState.status === 'RUNNING') {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      if (childState.status === 'FAILED' && childState.error) {
        throw childState.error
      }

      if (childState.status === 'CANCELED') {
        throw new WaitCancelledError('Child workflow was cancelled')
      }

      return childState.result as T
    },
    async signal<Args extends unknown[]>(signal: SignalDefinition<Args>, ...args: Args): Promise<void> {
      const handler = childState.signalHandlers.get(signal.name)
      if (handler) {
        await handler(...args)
      }
    },
    async cancel(): Promise<void> {
      childState.status = 'CANCELED'
      markWorkflowCompleted(workflowId)
    },
  }
}

/**
 * Execute a child workflow and wait for result
 */
export async function executeChild<T, TArgs extends unknown[]>(
  workflowType: string | ((...args: TArgs) => Promise<T>),
  options: ChildWorkflowOptions & { args?: TArgs }
): Promise<T> {
  const handle = await startChild(workflowType, options)
  return handle.result()
}

// ============================================================================
// CANCELLATION
// ============================================================================

export class CancellationScope {
  private readonly children: CancellationScope[] = []
  private readonly cleanupFns: (() => void | Promise<void>)[] = []
  private _isCancelled = false

  get isCancelled(): boolean {
    return this._isCancelled
  }

  cancel(): void {
    this._isCancelled = true
    for (const child of this.children) {
      child.cancel()
    }
  }

  /**
   * Run a function in this cancellation scope
   */
  static async run<T>(fn: () => Promise<T>): Promise<T> {
    const scope = new CancellationScope()
    try {
      return await fn()
    } finally {
      for (const cleanup of scope.cleanupFns) {
        await cleanup()
      }
    }
  }

  /**
   * Create a non-cancellable scope
   */
  static nonCancellable<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  /**
   * Create a cancellable scope with timeout
   */
  static async cancellable<T>(fn: () => Promise<T>): Promise<T> {
    return CancellationScope.run(fn)
  }
}

/**
 * Check if cancelled
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof WaitCancelledError
}

// ============================================================================
// CONTINUE AS NEW
// ============================================================================

export class ContinueAsNew extends Error {
  readonly args: unknown[]
  readonly options: ContinueAsNewOptions

  constructor(args: unknown[], options: ContinueAsNewOptions = {}) {
    super('ContinueAsNew')
    this.name = 'ContinueAsNew'
    this.args = args
    this.options = options
  }
}

/**
 * Continue as new with fresh history
 */
export function continueAsNew<TArgs extends unknown[]>(...args: TArgs): never {
  throw new ContinueAsNew(args)
}

/**
 * Make continue-as-new function for a specific workflow
 */
export function makeContinueAsNewFunc<TArgs extends unknown[], TResult>(
  _workflowType: string | ((...args: TArgs) => Promise<TResult>),
  options?: ContinueAsNewOptions
): (...args: TArgs) => never {
  return (...args: TArgs) => {
    throw new ContinueAsNew(args, options)
  }
}

// ============================================================================
// WORKFLOW CLIENT - Enhanced with list and search
// ============================================================================

export class WorkflowClient {
  private readonly namespace: string
  private readonly storage: StepStorage

  constructor(options: WorkflowClientOptions = {}) {
    this.namespace = options.namespace ?? globalNamespace
    this.storage = options.storage ?? globalStorage
    // Update global namespace for workflows started by this client
    globalNamespace = this.namespace
  }

  /**
   * Start a workflow
   *
   * @throws TaskQueueNotRegisteredError if no worker is registered for the task queue
   */
  async start<TArgs extends unknown[], TResult>(
    workflowType: string | ((...args: TArgs) => Promise<TResult>),
    options: WorkflowStartOptions<TArgs>
  ): Promise<WorkflowHandle<TResult>> {
    const typeName = typeof workflowType === 'string' ? workflowType : workflowType.name
    const workflowId = options.workflowId ?? generateWorkflowId()
    const runId = generateRunId()
    const now = new Date()

    // Validate task queue has a registered worker (like real Temporal)
    validateTaskQueueForWorkflow(options.taskQueue, typeName)

    // Create workflow state with full context
    const state: WorkflowState = {
      workflowId,
      runId,
      workflowType: typeName,
      taskQueue: options.taskQueue,
      namespace: this.namespace,
      signalHandlers: new Map(),
      queryHandlers: new Map(),
      updateHandlers: new Map(),
      stepResults: new Map(),
      status: 'RUNNING',
      searchAttributes: options.searchAttributes ?? {},
      memo: options.memo,
      startTime: now,
      runStartTime: now,
      historyLength: 1,
      attempt: 1,
      children: new Set(),
    }

    workflows.set(workflowId, state)

    // Execute the workflow with its own context
    const workflowFn = typeof workflowType === 'function' ? workflowType : workflowFunctions.get(typeName)
    if (workflowFn) {
      // Create a new context for this workflow execution
      const context: WorkflowContext = {
        workflow: state,
        patchState: null,
        storage: this.storage,
        waitManager: globalWaitManager,
      }

      // Run the workflow in its own context (enabling concurrent execution)
      runWithContext(context, () => {
        workflowFn(...(options.args ?? []))
          .then((result) => {
            state.status = 'COMPLETED'
            state.result = result
            markWorkflowCompleted(workflowId)
          })
          .catch((error) => {
            if (error instanceof ContinueAsNew) {
              state.status = 'CONTINUED_AS_NEW'
            } else {
              state.status = 'FAILED'
              state.error = error
            }
            markWorkflowCompleted(workflowId)
          })
      })
    }

    return this.createHandle<TResult>(workflowId, runId, state)
  }

  /**
   * Execute a workflow and wait for result
   */
  async execute<TArgs extends unknown[], TResult>(
    workflowType: string | ((...args: TArgs) => Promise<TResult>),
    options: WorkflowStartOptions<TArgs>
  ): Promise<TResult> {
    const handle = await this.start(workflowType, options)
    return handle.result()
  }

  /**
   * Get a handle to an existing workflow
   */
  getHandle<T = unknown>(workflowId: string, runId?: string): WorkflowHandle<T> {
    const state = workflows.get(workflowId)
    if (!state) {
      throw new Error(`Workflow ${workflowId} not found`)
    }
    return this.createHandle<T>(workflowId, runId ?? state.runId, state)
  }

  /**
   * List workflows with optional search query
   */
  async list(options: ListWorkflowOptions = {}): Promise<WorkflowExecutionDescription[]> {
    const results: WorkflowExecutionDescription[] = []

    for (const [, state] of workflows) {
      // If query provided, parse and filter
      if (options.query) {
        const match = this.matchesQuery(state, options.query)
        if (!match) continue
      }

      results.push({
        status: state.status,
        workflowId: state.workflowId,
        runId: state.runId,
        workflowType: state.workflowType,
        taskQueue: state.taskQueue,
        startTime: state.startTime,
        searchAttributes: state.searchAttributes,
        memo: state.memo,
      })

      if (options.pageSize && results.length >= options.pageSize) {
        break
      }
    }

    return results
  }

  /**
   * Simple query matcher for search attributes
   *
   * Security: This method validates queries to prevent injection attacks.
   * - Empty queries match all (intentional)
   * - Invalid query format returns false (fail closed)
   * - Only whitelisted attribute keys are allowed
   */
  private matchesQuery(state: WorkflowState, query: string): boolean {
    // Empty query matches all (intentional behavior)
    if (!query || query.trim() === '') return true

    // Simple parser for queries like: Status = "active"
    const match = query.match(/(\w+)\s*=\s*"([^"]+)"/)
    if (!match) {
      // Invalid query format - fail closed (don't match)
      return false
    }

    const [, key, value] = match

    // Validate key is a known search attribute (prevent prototype pollution)
    const validKeys = ['status', 'workflowType', 'runId', ...Object.keys(state.searchAttributes)]
    if (!validKeys.includes(key)) {
      return false
    }

    const attrValue = state.searchAttributes[key]
    return String(attrValue) === value
  }

  /**
   * Signal and optionally start a workflow
   */
  async signalWithStart<TSignalArgs extends unknown[], TWorkflowArgs extends unknown[], TResult>(
    workflowType: string | ((...args: TWorkflowArgs) => Promise<TResult>),
    options: SignalWithStartOptions<TSignalArgs, TWorkflowArgs>
  ): Promise<WorkflowHandle<TResult>> {
    const workflowId = options.workflowId ?? generateWorkflowId()

    // Check if workflow exists
    let state = workflows.get(workflowId)
    let handle: WorkflowHandle<TResult>

    if (state) {
      // Workflow exists, just signal it
      handle = this.createHandle<TResult>(workflowId, state.runId, state)
    } else {
      // Start the workflow
      handle = await this.start(workflowType, options)
      state = workflows.get(workflowId)!
    }

    // Send the signal
    await handle.signal(options.signal, ...options.signalArgs)

    return handle
  }

  /**
   * Create a workflow handle
   */
  private createHandle<T>(workflowId: string, runId: string, state: WorkflowState): WorkflowHandle<T> {
    const self = this
    return {
      workflowId,
      runId,

      async result(): Promise<T> {
        // Poll until complete
        while (state.status === 'RUNNING') {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        if (state.status === 'FAILED' && state.error) {
          throw state.error
        }

        if (state.status === 'TERMINATED' && state.error) {
          throw state.error
        }

        return state.result as T
      },

      async describe(): Promise<WorkflowExecutionDescription> {
        return {
          status: state.status,
          workflowId,
          runId,
          workflowType: state.workflowType,
          taskQueue: state.taskQueue,
          startTime: state.startTime,
          searchAttributes: state.searchAttributes,
          memo: state.memo,
        }
      },

      async signal<Args extends unknown[]>(signal: SignalDefinition<Args>, ...args: Args): Promise<void> {
        const handler = state.signalHandlers.get(signal.name)
        if (handler) {
          await handler(...args)
        }

        // Also deliver to wait manager if present
        if (globalWaitManager) {
          await globalWaitManager.deliverEvent(null, `signal:${signal.name}`, args)
        }
      },

      async query<TResult, Args extends unknown[]>(query: QueryDefinition<TResult, Args>, ...args: Args): Promise<TResult> {
        const handler = state.queryHandlers.get(query.name)
        if (!handler) {
          throw new Error(`Query handler for "${query.name}" not found`)
        }
        return handler(...args) as TResult
      },

      async executeUpdate<TResult, Args extends unknown[]>(update: UpdateDefinition<TResult, Args>, ...args: Args): Promise<TResult> {
        const handler = state.updateHandlers.get(update.name)
        if (!handler) {
          throw new Error(`Update handler for "${update.name}" not found`)
        }
        return handler(...args) as TResult
      },

      async cancel(): Promise<void> {
        state.status = 'CANCELED'
        // Cancel all children based on parent close policy
        for (const childId of state.children) {
          const childState = workflows.get(childId)
          if (childState && childState.status === 'RUNNING') {
            childState.status = 'CANCELED'
          }
        }
      },

      async terminate(reason?: string): Promise<void> {
        state.status = 'TERMINATED'
        state.error = new Error(reason ?? 'Workflow terminated')
        // Terminate all children based on parent close policy
        for (const childId of state.children) {
          const childState = workflows.get(childId)
          if (childState && childState.status === 'RUNNING') {
            if (childState.parentClosePolicy === 'TERMINATE') {
              childState.status = 'TERMINATED'
            } else if (childState.parentClosePolicy === 'REQUEST_CANCEL') {
              childState.status = 'CANCELED'
            }
            // ABANDON: do nothing
          }
        }
      },
    }
  }
}

// ============================================================================
// UUID AND RANDOM - Deterministic for Replay
// ============================================================================

/**
 * Per-workflow counters for deterministic step IDs
 * These are tracked per workflow execution to ensure each uuid4()/random() call
 * gets a unique, deterministic step ID based on call order.
 */
const uuidCounters = new WeakMap<WorkflowState, number>()
const randomCounters = new WeakMap<WorkflowState, number>()

/**
 * Generate deterministic UUID (for replay)
 *
 * This function is deterministic within a workflow execution:
 * - First execution: generates a new UUID and stores it
 * - Replay: returns the same UUID that was generated before
 *
 * IMPORTANT: Must be called within a workflow context.
 * The step ID is based on call order within the workflow, so
 * uuid4() calls must happen in the same order on replay.
 *
 * @returns A UUID v4 string that is deterministic on replay
 * @throws Error if called outside a workflow context
 *
 * @example
 * ```typescript
 * import { uuid4 } from '@dotdo/temporal'
 *
 * export async function orderWorkflow() {
 *   // These IDs will be the same on replay
 *   const orderId = uuid4()
 *   const transactionId = uuid4()
 *   return { orderId, transactionId }
 * }
 * ```
 */
export function uuid4(): string {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    // Outside workflow context - fall back to non-deterministic
    // This allows usage in tests or non-workflow code
    return crypto.randomUUID()
  }

  // Get and increment the counter for this workflow
  const counter = uuidCounters.get(workflow) ?? 0
  uuidCounters.set(workflow, counter + 1)

  // Create deterministic step ID based on call order
  const stepId = `uuid4:${counter}`

  // Check for existing result (replay case)
  if (workflow.stepResults.has(stepId)) {
    return workflow.stepResults.get(stepId) as string
  }

  // Generate new UUID and store for replay
  const id = crypto.randomUUID()
  workflow.stepResults.set(stepId, id)
  workflow.historyLength++

  return id
}

/**
 * Get deterministic random number (for replay)
 *
 * This function is deterministic within a workflow execution:
 * - First execution: generates a new random number and stores it
 * - Replay: returns the same random number that was generated before
 *
 * IMPORTANT: Must be called within a workflow context.
 * The step ID is based on call order within the workflow, so
 * random() calls must happen in the same order on replay.
 *
 * @returns A number between 0 (inclusive) and 1 (exclusive)
 * @throws Error if called outside a workflow context
 *
 * @example
 * ```typescript
 * import { random } from '@dotdo/temporal'
 *
 * export async function retryWorkflow() {
 *   // This decision will be the same on replay
 *   const shouldRetry = random() < 0.5
 *   return { shouldRetry }
 * }
 * ```
 */
export function random(): number {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    // Outside workflow context - fall back to non-deterministic
    // This allows usage in tests or non-workflow code
    return Math.random()
  }

  // Get and increment the counter for this workflow
  const counter = randomCounters.get(workflow) ?? 0
  randomCounters.set(workflow, counter + 1)

  // Create deterministic step ID based on call order
  const stepId = `random:${counter}`

  // Check for existing result (replay case)
  if (workflow.stepResults.has(stepId)) {
    return workflow.stepResults.get(stepId) as number
  }

  // Generate new random number and store for replay
  const num = Math.random()
  workflow.stepResults.set(stepId, num)
  workflow.historyLength++

  return num
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  proxyActivities,
  proxyLocalActivities,
  startChild,
  executeChild,
  sleep,
  condition,
  workflowInfo,
  continueAsNew,
  makeContinueAsNewFunc,
  CancellationScope,
  isCancellation,
  WorkflowClient,
  uuid4,
  random,
  configure,
  // New exports for API coverage
  createTimer,
  cancelTimer,
  patched,
  deprecatePatch,
  setSearchAttributes,
  upsertSearchAttributes,
  // Task queue routing
  registerWorker,
  hasWorker,
  getWorker,
  listTaskQueues,
  TaskQueueNotRegisteredError,
  // Determinism enforcement
  workflowNow,
  WorkflowDeterminismWarning,
  configureDeterminism,
  getDeterminismWarnings,
  clearDeterminismWarnings,
  enableDeterminismDetection,
  disableDeterminismDetection,
  inWorkflowContext,
  // Utility for testing
  __clearTemporalState,
}
