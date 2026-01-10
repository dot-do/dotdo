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
import type { StepStorage, StepResult } from '../../runtime'
import { parseDuration, ensureError } from '../utils'
import type { WorkflowStep, StepDoOptions, RetryOptions } from '../../../lib/cloudflare/workflows'
import {
  WorkerActivityRouter,
  DurableActivityRouter,
  type ActivityRouter,
  type ActivityRouterOptions,
  type ActivityContext as RouterActivityContext,
  type WorkerHandler as RouterWorkerHandler,
  ActivityTimeoutError,
  TaskQueueNotRegisteredError,
} from '../activity-router'

// Re-export error classes for backward compatibility
export { ActivityTimeoutError, TaskQueueNotRegisteredError }

// ============================================================================
// STORAGE STRATEGY - Unified abstraction for step execution and durability
// ============================================================================

/**
 * WorkflowStorageStrategy abstracts the underlying execution and storage mechanism.
 *
 * This pattern allows the Temporal compat layer to use different backends:
 * - CFWorkflowsStrategy: Uses native step.do() and step.sleep() when WorkflowStep is available
 * - InMemoryStrategy: Uses in-memory Maps with setTimeout for testing/fallback
 *
 * ## Cost Implications
 *
 * When using CFWorkflowsStrategy:
 * - sleep() uses step.sleep() - FREE (doesn't consume DO wall-clock time)
 * - Activities use step.do() - DURABLE (survives restarts, automatic retries)
 *
 * When using InMemoryStrategy (fallback):
 * - sleep() uses setTimeout - BILLABLE (consumes DO wall-clock time)
 * - Activities execute directly - NOT DURABLE (no automatic retries or persistence)
 */
export interface WorkflowStorageStrategy {
  /**
   * Execute a step with automatic caching and optional durability.
   *
   * @param name - Unique step name for caching/replay
   * @param fn - The function to execute
   * @param options - Execution options (timeout, retries)
   * @returns The result of the function
   */
  executeStep<T>(name: string, fn: () => T | Promise<T>, options?: StepExecutionOptions): Promise<T>

  /**
   * Sleep for a duration (durable when using CF Workflows).
   *
   * @param name - Unique step name for caching/replay
   * @param durationMs - Duration in milliseconds
   * @param durationStr - Original duration string for CF Workflows
   */
  sleep(name: string, durationMs: number, durationStr: string): Promise<void>

  /**
   * Check if a step has been completed (for replay optimization).
   *
   * @param name - Step name to check
   * @returns True if step is completed
   */
  isStepCompleted(name: string): Promise<boolean>

  /**
   * Get the cached result of a completed step.
   *
   * @param name - Step name to retrieve
   * @returns The cached result or undefined
   */
  getStepResult<T>(name: string): Promise<T | undefined>

  /**
   * Store a step result (for replay).
   *
   * @param name - Step name
   * @param result - Result to store
   */
  setStepResult(name: string, result: unknown): Promise<void>
}

/**
 * Options for step execution
 */
export interface StepExecutionOptions {
  /** Timeout for the step */
  timeout?: string
  /** Retry configuration */
  retries?: RetryOptions
}

/**
 * Discriminated union for cached step results.
 * Provides type-safe handling of success values vs errors.
 */
export type CachedStepResult<T = unknown> =
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }

// ============================================================================
// CFWORKFLOWS STORAGE STRATEGY - Uses native CF Workflows APIs
// ============================================================================

/**
 * CFWorkflowsStorageStrategy uses Cloudflare Workflows native APIs for durable execution.
 *
 * Benefits:
 * - sleep() is FREE - you don't pay for wall-clock time
 * - step.do() is DURABLE - survives worker restarts, automatic retries
 * - Replay is automatic - completed steps return cached results
 *
 * This strategy is automatically selected when a WorkflowStep is available
 * in the current workflow context.
 */
export class CFWorkflowsStorageStrategy implements WorkflowStorageStrategy {
  private readonly stepResults = new Map<string, CachedStepResult>()

  constructor(private readonly step: WorkflowStep) {}

  async executeStep<T>(name: string, fn: () => T | Promise<T>, options?: StepExecutionOptions): Promise<T> {
    // Check for cached result (replay)
    const cached = this.stepResults.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Build step.do() options from execution options
    const stepOptions: StepDoOptions | undefined = this.buildStepDoOptions(options)

    try {
      // Execute via step.do() for durability
      const result = stepOptions
        ? await this.step.do(name, stepOptions, async () => fn())
        : await this.step.do(name, async () => fn())

      // Cache the result with discriminated union
      this.stepResults.set(name, { status: 'success', value: result })
      return result
    } catch (error) {
      // Cache errors for deterministic replay
      const err = ensureError(error)
      this.stepResults.set(name, { status: 'error', error: err })
      throw err
    }
  }

  async sleep(name: string, _durationMs: number, durationStr: string): Promise<void> {
    // Check for cached completion (replay)
    if (this.stepResults.has(name)) {
      return
    }

    // Use CF Workflows native step.sleep() - FREE, doesn't consume wall-clock time
    await this.step.sleep(name, durationStr)

    // Cache completion
    this.stepResults.set(name, { status: 'success', value: true })
  }

  async isStepCompleted(name: string): Promise<boolean> {
    return this.stepResults.has(name)
  }

  async getStepResult<T>(name: string): Promise<T | undefined> {
    const cached = this.stepResults.get(name)
    if (!cached) return undefined
    if (cached.status === 'error') {
      throw cached.error
    }
    return cached.value as T
  }

  async setStepResult(name: string, result: unknown): Promise<void> {
    if (result instanceof Error) {
      this.stepResults.set(name, { status: 'error', error: result })
    } else {
      this.stepResults.set(name, { status: 'success', value: result })
    }
  }

  private buildStepDoOptions(options?: StepExecutionOptions): StepDoOptions | undefined {
    if (!options) return undefined

    const stepOptions: StepDoOptions = {}

    if (options.retries) {
      stepOptions.retries = options.retries
    }

    if (options.timeout) {
      stepOptions.timeout = options.timeout
    }

    // Only return if we have something to configure
    if (stepOptions.retries || stepOptions.timeout) {
      return stepOptions
    }
    return undefined
  }
}

// ============================================================================
// INMEMORY STORAGE STRATEGY - Fallback for testing and non-CF environments
// ============================================================================

/**
 * InMemoryStorageStrategy provides fallback behavior when no WorkflowStep is available.
 *
 * This is used in:
 * - Testing environments
 * - Development without CF Workflows runtime
 * - Direct workflow execution outside of CF Workflows
 *
 * Cost: sleep() uses setTimeout which is BILLABLE (consumes DO wall-clock time)
 */
export class InMemoryStorageStrategy implements WorkflowStorageStrategy {
  private readonly stepResults = new Map<string, CachedStepResult>()
  private readonly durableStorage: StepStorage

  constructor(storage?: StepStorage) {
    this.durableStorage = storage ?? new InMemoryStepStorage()
  }

  async executeStep<T>(name: string, fn: () => T | Promise<T>, _options?: StepExecutionOptions): Promise<T> {
    // Check in-memory cache first
    const cached = this.stepResults.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Check durable storage for completed steps (survives worker restarts)
    const durableResult = await this.durableStorage.get(name)
    if (durableResult?.status === 'completed') {
      this.stepResults.set(name, { status: 'success', value: durableResult.result })
      return durableResult.result as T
    }

    // Execute the function
    try {
      const result = await fn()

      // Store in both in-memory and durable storage
      this.stepResults.set(name, { status: 'success', value: result })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'completed',
        result,
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      })

      return result
    } catch (error) {
      const err = ensureError(error)
      this.stepResults.set(name, { status: 'error', error: err })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'failed',
        error: err.message,
        attempts: 1,
        createdAt: Date.now(),
      })
      throw err
    }
  }

  async sleep(name: string, durationMs: number, _durationStr: string): Promise<void> {
    // Check for cached completion
    if (this.stepResults.has(name)) {
      return
    }

    // Check durable storage
    const durableResult = await this.durableStorage.get(name)
    if (durableResult?.status === 'completed') {
      this.stepResults.set(name, { status: 'success', value: true })
      return
    }

    // Persist pending state before sleeping
    await this.durableStorage.set(name, {
      stepId: name,
      status: 'pending',
      attempts: 1,
      createdAt: Date.now(),
    })

    // Fallback to setTimeout - BILLABLE
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))

    // Persist completed state
    await this.durableStorage.set(name, {
      stepId: name,
      status: 'completed',
      result: true,
      attempts: 1,
      createdAt: Date.now(),
      completedAt: Date.now(),
    })

    this.stepResults.set(name, { status: 'success', value: true })
  }

  async isStepCompleted(name: string): Promise<boolean> {
    if (this.stepResults.has(name)) {
      return true
    }

    const durableResult = await this.durableStorage.get(name)
    return durableResult?.status === 'completed'
  }

  async getStepResult<T>(name: string): Promise<T | undefined> {
    // Check in-memory first
    const cached = this.stepResults.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Check durable storage
    const durableResult = await this.durableStorage.get(name)
    if (durableResult?.status === 'completed') {
      return durableResult.result as T | undefined
    }

    return undefined
  }

  async setStepResult(name: string, result: unknown): Promise<void> {
    if (result instanceof Error) {
      this.stepResults.set(name, { status: 'error', error: result })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'failed',
        error: result.message,
        attempts: 1,
        createdAt: Date.now(),
      })
    } else {
      this.stepResults.set(name, { status: 'success', value: result })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'completed',
        result,
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      })
    }
  }

  /**
   * Clear all cached results (for testing)
   */
  clear(): void {
    this.stepResults.clear()
  }
}

// ============================================================================
// STRATEGY FACTORY - Creates the appropriate strategy based on context
// ============================================================================

/**
 * Get the appropriate storage strategy for the current workflow execution.
 *
 * Selection logic:
 * 1. If WorkflowStep is available in context, use CFWorkflowsStorageStrategy (FREE sleeping, durable)
 * 2. Otherwise, use InMemoryStorageStrategy (fallback, BILLABLE sleeping)
 *
 * @param workflowStep - Optional WorkflowStep from CF Workflows runtime
 * @param storage - Optional StepStorage for InMemory fallback
 * @returns The appropriate storage strategy
 */
export function createStorageStrategy(
  workflowStep: WorkflowStep | null,
  storage?: StepStorage
): WorkflowStorageStrategy {
  if (workflowStep) {
    return new CFWorkflowsStorageStrategy(workflowStep)
  }
  return new InMemoryStorageStrategy(storage)
}

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
  // Cancellation support
  abortController?: AbortController
  // Per-workflow step counters for deterministic step IDs
  sleepStepCounter: number
  activityStepCounter: number
}

// Patch tracking for versioning
interface PatchState {
  appliedPatches: Set<string>
  deprecatedPatches: Set<string>
}

// Timer tracking
// NOTE: timeoutId is NOT stored here - it's stored in bucketTimeouts Map
// to avoid the "cancelled leader" bug where cancelling the first timer in a
// coalesced bucket would leave other timers without a scheduled callback
interface TimerState {
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
  /** CF Workflows step context for this workflow execution */
  workflowStep: WorkflowStep | null
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

/**
 * Get the storage strategy for the current workflow context.
 *
 * This function creates the appropriate storage strategy based on the current context:
 * - If a WorkflowStep is available, returns CFWorkflowsStorageStrategy (FREE sleeping, durable)
 * - Otherwise, returns InMemoryStorageStrategy (fallback, BILLABLE sleeping)
 *
 * Note: Strategies are created on-demand rather than stored in context to avoid
 * stale strategy references when WorkflowStep is set/cleared dynamically.
 */
function getCurrentStorageStrategy(): WorkflowStorageStrategy {
  const ctx = getCurrentContext()
  const step = ctx?.workflowStep ?? null
  const storage = getCurrentStorage()
  return createStorageStrategy(step, storage)
}

/**
 * Get the current storage from context or fallback to global.
 *
 * This provides a single source of truth for storage access, consolidating
 * the pattern of `ctx?.storage ?? globalStorage` that was previously
 * scattered throughout the codebase.
 */
function getCurrentStorage(): StepStorage {
  const ctx = getCurrentContext()
  return ctx?.storage ?? globalStorage
}

// ============================================================================
// CF WORKFLOWS STEP CONTEXT - For native Cloudflare Workflows integration
// ============================================================================

/**
 * Set the WorkflowStep context for the current workflow execution.
 * Call this at the beginning of a CF Workflows run() method to enable
 * native step.do() and step.sleep() execution.
 *
 * The step is stored in the workflow's AsyncLocalStorage context, ensuring
 * isolation between concurrent workflow executions.
 *
 * @param step - The WorkflowStep from CF Workflows runtime, or null to clear
 *
 * @example
 * ```typescript
 * async run(event: WorkflowEvent, step: WorkflowStep) {
 *   setWorkflowStep(step)
 *   try {
 *     // Temporal compat layer will use step.sleep() and step.do()
 *     await sleep('5s')
 *     await activities.processOrder(event.payload.orderId)
 *   } finally {
 *     clearWorkflowStep()
 *   }
 * }
 * ```
 */
export function setWorkflowStep(step: WorkflowStep | null): void {
  const ctx = getCurrentContext()
  if (ctx) {
    ctx.workflowStep = step
  }
}

/**
 * Clear the WorkflowStep context for the current workflow.
 * Call this when exiting the CF Workflows context.
 */
export function clearWorkflowStep(): void {
  const ctx = getCurrentContext()
  if (ctx) {
    ctx.workflowStep = null
  }
}

/**
 * Get the current WorkflowStep context, or null if not in a CF Workflows context.
 * Used internally by sleep() and proxyActivities() to route to native APIs.
 */
export function getWorkflowStep(): WorkflowStep | null {
  const ctx = getCurrentContext()
  return ctx?.workflowStep ?? null
}

/**
 * Format a duration in milliseconds to CF Workflows format string.
 * CF Workflows accepts durations like '5s', '1m', '1h', etc.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
function formatDurationForCF(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60 * 1000) {
    const seconds = Math.round(ms / 1000)
    return `${seconds}s`
  }
  if (ms < 60 * 60 * 1000) {
    const minutes = Math.round(ms / (60 * 1000))
    return `${minutes}m`
  }
  const hours = Math.round(ms / (60 * 60 * 1000))
  return `${hours}h`
}

/**
 * Generate a unique step ID for sleep operations.
 * Uses per-workflow counter for deterministic IDs across concurrent workflows.
 *
 * @param ms - Duration in milliseconds
 * @returns Unique step ID
 */
function generateSleepStepId(ms: number): string {
  const ctx = getCurrentContext()
  if (!ctx?.workflow) {
    // Fallback for non-workflow context (testing)
    return `sleep:${formatDurationForCF(ms)}:${Date.now()}`
  }
  ctx.workflow.sleepStepCounter++
  return `sleep:${formatDurationForCF(ms)}:${ctx.workflow.sleepStepCounter}`
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
  // Start time + (counter * small increment to show progression)
  // This ensures time appears to progress while remaining deterministic
  // NOTE: We use the workflowNow counter (not historyLength) because historyLength
  // can vary between replays due to conditional paths or optimizations
  const baseTime = workflow.startTime.getTime()
  const stepIncrement = counter + 1 // 1ms per call for minimal progression (counter is 0-indexed)
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
// TASK QUEUE REGISTRY - Worker registration and routing via ActivityRouter
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
 * This extends the RouterWorkerHandler with the same interface for compatibility.
 */
export type WorkerHandler = RouterWorkerHandler

/**
 * Shared ActivityRouter instance used for routing activities to workers.
 * This provides the unified routing abstraction used across all compat layers.
 */
const activityRouter = new WorkerActivityRouter()

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
  // Delegate to the shared ActivityRouter instance
  return activityRouter.registerWorker(taskQueue, handler)
}

/**
 * Check if a task queue has a registered worker
 */
export function hasWorker(taskQueue: string): boolean {
  return activityRouter.hasWorker(taskQueue)
}

/**
 * Get the worker handler for a task queue
 */
export function getWorker(taskQueue: string): WorkerHandler | undefined {
  return activityRouter.getWorker(taskQueue)
}

/**
 * List all registered task queues
 */
export function listTaskQueues(): string[] {
  return activityRouter.listTaskQueues()
}

/**
 * Check if task queue routing is enabled.
 *
 * Task queue validation is enabled when at least one worker has been registered.
 * This maintains backward compatibility - existing code that doesnt use
 * registerWorker() will continue to work without changes.
 */
function isTaskQueueRoutingEnabled(): boolean {
  return activityRouter.isRoutingEnabled()
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

  const worker = activityRouter.getWorker(taskQueue)
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

  const worker = activityRouter.getWorker(taskQueue)
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
const TERMINAL_STATES = new Set<WorkflowExecutionStatus>([
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
  for (const [workflowId, completionTime] of Array.from(workflowCompletionTimes.entries())) {
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
    const completedWorkflows = Array.from(workflowCompletionTimes.entries())
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

// ============================================================================
// LAZY CLEANUP INITIALIZATION - Auto-start cleanup on first usage
// ============================================================================

/**
 * Track whether cleanup intervals have been auto-started.
 * This enables lazy initialization - cleanup only starts when actually needed.
 */
let cleanupStarted = false

/**
 * Ensure cleanup intervals are started (lazy initialization).
 *
 * This function is called automatically when:
 * - A workflow is started (WorkflowClient.start, startChild)
 * - A timer is created (createTimer)
 *
 * This eliminates the need to manually call __startWorkflowCleanup() and
 * __startTimerCleanup(), preventing memory leaks from accumulated workflows
 * and timers even when the manual calls are forgotten.
 *
 * The cleanup intervals are idempotent - calling this multiple times is safe.
 */
export function ensureCleanupStarted(): void {
  if (cleanupStarted) return
  cleanupStarted = true
  __startWorkflowCleanup()
  __startTimerCleanup()
}

/**
 * Reset the cleanup started flag (for testing only).
 * This allows tests to verify the lazy initialization behavior.
 */
export function __resetCleanupStarted(): void {
  cleanupStarted = false
}

/**
 * Check if cleanup has been auto-started (for testing only).
 */
export function __isCleanupStarted(): boolean {
  return cleanupStarted
}

/**
 * Configure the Temporal compat layer globals.
 *
 * This is the single entry point for backend configuration. The storage
 * strategy (CFWorkflows vs InMemory) is auto-detected at runtime based on
 * whether a WorkflowStep context is available.
 *
 * ## Configuration Flow
 *
 * 1. Set `storage` for durable step persistence
 * 2. Set `state` for DurableObject state access (required for waitForEvent)
 * 3. Set `namespace` for workflow isolation
 *
 * ## Storage Strategy Selection (Automatic)
 *
 * - If WorkflowStep context is available: Uses CFWorkflowsStorageStrategy
 *   - sleep() uses step.sleep() - FREE (no wall-clock billing)
 *   - Activities use step.do() - DURABLE (survives restarts)
 *
 * - Otherwise: Uses InMemoryStorageStrategy (fallback)
 *   - sleep() uses setTimeout - BILLABLE (consumes DO time)
 *   - Activities execute directly - NOT DURABLE
 *
 * @example
 * ```typescript
 * import { configure } from '@dotdo/temporal'
 *
 * // In a Durable Object
 * configure({
 *   storage: new DOStepStorage(ctx.storage),
 *   state: ctx.state,
 *   namespace: 'production'
 * })
 * ```
 */
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
export function defineSignal<Args extends unknown[] = [], Name extends string = string>(name: Name): SignalDefinition<Args, Name> {
  return { name, type: 'signal' }
}

/**
 * Define a query
 */
export function defineQuery<TResult = unknown, Args extends unknown[] = [], Name extends string = string>(name: Name): QueryDefinition<TResult, Args, Name> {
  return { name, type: 'query' }
}

/**
 * Define an update
 */
export function defineUpdate<TResult = unknown, Args extends unknown[] = [], Name extends string = string>(name: Name): UpdateDefinition<TResult, Args, Name> {
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
// Store bucket timeouts separately to avoid "cancelled leader" bug
// When the first timer in a bucket is cancelled, other timers still need the timeout
const bucketTimeouts = new Map<number, ReturnType<typeof setTimeout>>()

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

  for (const [bucket, timers] of Array.from(coalescedTimerBuckets.entries())) {
    // Filter out stale timers from this bucket
    const activeTimersInBucket = timers.filter((timer) => {
      // Timer is stale if it's past its expected fire time + threshold
      const isStale = timer.pending && now > timer.expectedFireAt + TIMER_STALE_THRESHOLD_MS

      if (isStale) {
        // Clean up the stale timer
        timer.pending = false
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

  // Delete empty buckets and their timeouts
  for (const bucket of bucketsToDelete) {
    coalescedTimerBuckets.delete(bucket)
    const timeoutId = bucketTimeouts.get(bucket)
    if (timeoutId) {
      clearTimeout(timeoutId)
      bucketTimeouts.delete(bucket)
    }
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
  // Auto-start cleanup on first timer creation
  ensureCleanupStarted()

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

    // Set the actual timeout - stored on bucket, not individual timer
    // This prevents the "cancelled leader" bug where cancelling the first timer
    // would leave other timers in the bucket without a scheduled callback
    const timeoutId = setTimeout(() => {
      bucketTimeouts.delete(bucket)
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
    bucketTimeouts.set(bucket, timeoutId)
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
 *
 * FIX: Timeouts are now stored on the bucket (bucketTimeouts), not on individual
 * timers. This prevents the "cancelled leader" bug where cancelling the first timer
 * in a bucket would leave other timers without a scheduled callback.
 * When cancelling, we only clear the bucket timeout if this was the last timer.
 */
export function cancelTimer(timer: TimerHandle): void {
  const timerState = activeTimers.get(timer.id)
  if (timerState && timerState.pending) {
    timerState.pending = false

    // Remove from coalesced bucket if present
    for (const [bucket, timers] of Array.from(coalescedTimerBuckets.entries())) {
      const index = timers.findIndex(t => t.id === timer.id)
      if (index !== -1) {
        timers.splice(index, 1)
        if (timers.length === 0) {
          // Only clear the bucket timeout when the last timer is cancelled
          coalescedTimerBuckets.delete(bucket)
          const timeoutId = bucketTimeouts.get(bucket)
          if (timeoutId) {
            clearTimeout(timeoutId)
            bucketTimeouts.delete(bucket)
          }
        }
        // If other timers remain in the bucket, leave the timeout running
        // so those timers will fire when the timeout expires
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

  // Clear task queue registry via activityRouter
  activityRouter.clear()

  // Properly cancel all active timers to prevent memory leaks
  for (const timer of Array.from(activeTimers.values())) {
    timer.pending = false
  }
  activeTimers.clear()

  // Clear bucket timeouts (timeouts are stored on buckets, not individual timers)
  for (const timeoutId of Array.from(bucketTimeouts.values())) {
    clearTimeout(timeoutId)
  }
  bucketTimeouts.clear()

  // Clear coalesced timer buckets
  for (const timers of Array.from(coalescedTimerBuckets.values())) {
    for (const timer of timers) {
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

  // Note: Step counters are now per-workflow (in WorkflowState), not global.
  // They are automatically reset when workflows are created.

  // Clear WorkflowStep context
  clearWorkflowStep()

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
 * This implementation integrates with both CF Workflows native sleep and
 * the Temporal compat layer's durable storage:
 *
 * 1. If WorkflowStep context is available (CF Workflows), use step.sleep()
 *    - FREE: doesn't use billable DO time
 *    - DURABLE: survives worker restarts
 *
 * 2. Otherwise, fall back to setTimeout with durable storage
 *    - Persists sleep state to storage (in case of crash)
 *    - On replay, completed sleeps are skipped immediately
 */
export async function sleep(duration: string | number): Promise<void> {
  const ctx = getCurrentContext()
  const workflow = ctx?.workflow ?? null
  if (!workflow) {
    throw new Error('sleep can only be called within a workflow')
  }

  const ms = parseDuration(duration)
  const durationStr = typeof duration === 'string' ? duration : formatDurationForCF(ms)
  const stepId = generateSleepStepId(ms)

  // Use the unified storage strategy pattern
  // - CFWorkflowsStorageStrategy: Uses step.sleep() - FREE, doesn't consume wall-clock time
  // - InMemoryStorageStrategy: Uses setTimeout with durable storage - BILLABLE
  const strategy = getCurrentStorageStrategy()
  await strategy.sleep(stepId, ms, durationStr)

  // Update in-memory cache for replay within same execution
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

// Note: ActivityTimeoutError and TaskQueueNotRegisteredError are imported from '../activity-router'
// and re-exported at the top of this file for backward compatibility.
//
// Activity execution (retry, timeout, error handling) is now handled by the shared
// WorkerActivityRouter instance, eliminating duplicate code.

/**
 * Create activity proxies
 *
 * Activities integrate with multiple execution backends:
 *
 * 1. If a worker with executeActivity handler is registered, route to that handler
 *    - Enables testing workflows with mock activity implementations
 *    - Handles timeouts, retries, and error classification
 *
 * 2. If WorkflowStep context is available (CF Workflows), use step.do()
 *    - DURABLE: automatically retries and survives restarts
 *    - REPLAY: completed steps return cached results
 *
 * 3. Otherwise, fall back to DurableWorkflowRuntime
 *
 * Activities can specify a `taskQueue` option to route execution to a specific
 * worker. If a task queue is specified, it must have a registered worker.
 * If no task queue is specified, activities use the workflow's task queue.
 */
export function proxyActivities<T extends Activities>(options: ActivityOptions): T {
  // Activity task queue (can be different from workflow's task queue)
  const activityTaskQueue = options.taskQueue

  // Parse timeouts once
  const startToCloseTimeoutMs = options.startToCloseTimeout
    ? parseDuration(options.startToCloseTimeout)
    : undefined
  const heartbeatTimeoutMs = options.heartbeatTimeout
    ? parseDuration(options.heartbeatTimeout)
    : undefined

  // Build CF Workflows step.do() options from Temporal activity options
  const buildStepDoOptions = (): StepDoOptions | undefined => {
    const stepOptions: StepDoOptions = {}

    // Map retry policy
    if (options.retry?.maximumAttempts) {
      stepOptions.retries = {
        limit: options.retry.maximumAttempts,
        backoff: options.retry.backoffCoefficient && options.retry.backoffCoefficient > 1 ? 'exponential' : 'constant',
        delay: options.retry.initialInterval ? String(options.retry.initialInterval) : undefined,
      }
    }

    // Map timeout
    if (options.startToCloseTimeout) {
      stepOptions.timeout = typeof options.startToCloseTimeout === 'string'
        ? options.startToCloseTimeout
        : formatDurationForCF(parseDuration(options.startToCloseTimeout))
    }

    // Only return options if we have something to configure
    if (stepOptions.retries || stepOptions.timeout) {
      return stepOptions
    }
    return undefined
  }

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

        // Include task queue in step ID to ensure isolation between queues
        const stepId = `activity:${targetTaskQueue}:${name}:${JSON.stringify(args)}`

        // Check for replay in workflow stepResults (handles both success and error)
        if (workflow.stepResults.has(stepId)) {
          const cached = workflow.stepResults.get(stepId)
          // If cached value is an error, re-throw it
          if (cached instanceof Error) {
            throw cached
          }
          return cached
        }

        // Check for CF Workflows step context - use step.do() for durability
        const step = getWorkflowStep()
        if (step) {
          // Use CF Workflows native step.do() - DURABLE
          // Use per-workflow counter for deterministic IDs across concurrent workflows
          workflow.activityStepCounter++
          const stepName = `activity:${name}:${workflow.activityStepCounter}`
          const stepDoOptions = buildStepDoOptions()

          // The callback is what CF Workflows will execute.
          // When a worker handler is registered, invoke it for actual activity execution.
          // Otherwise, return a stub for CF Workflows runtime (production mode).
          const callback = async () => {
            // Check if worker has a handler for this activity
            const worker = activityRouter.getWorker(targetTaskQueue)
            if (worker?.executeActivity) {
              // Create activity context with cancellation signal
              const activityContext: RouterActivityContext = {
                signal: workflow.abortController?.signal,
              }
              return worker.executeActivity(name, args, activityContext)
            }
            // Fallback for CF Workflows runtime (no local handler)
            return { _activity: name, _args: args, _stub: true }
          }

          // Call step.do() with or without options
          const result = stepDoOptions
            ? await step.do(stepName, stepDoOptions, callback)
            : await step.do(stepName, callback)

          workflow.stepResults.set(stepId, result)
          workflow.historyLength++
          return result
        }

        // Fallback when no WorkflowStep is available:
        // Get the worker for this task queue via activityRouter
        const worker = activityRouter.getWorker(targetTaskQueue)

        // If worker has executeActivity handler, route via activityRouter (no step.do() durability)
        if (worker?.executeActivity) {
          // Create activity context with cancellation signal
          const activityContext: RouterActivityContext = {
            signal: workflow.abortController?.signal,
          }

          // Build ActivityRouterOptions from Temporal ActivityOptions
          // Use heartbeat timeout if specified and shorter than start-to-close timeout
          // Heartbeat timeout in Temporal means the activity must heartbeat within this interval
          // In our emulation, we use it as an effective timeout for activities that don't heartbeat
          let effectiveTimeout = startToCloseTimeoutMs
          if (heartbeatTimeoutMs) {
            if (!effectiveTimeout || heartbeatTimeoutMs < effectiveTimeout) {
              effectiveTimeout = heartbeatTimeoutMs
            }
          }

          const routerOptions: ActivityRouterOptions = {
            taskQueue: targetTaskQueue,
            timeout: effectiveTimeout,
            retries: options.retry ? {
              maximumAttempts: options.retry.maximumAttempts,
              initialInterval: options.retry.initialInterval,
              backoffCoefficient: options.retry.backoffCoefficient,
              maximumInterval: options.retry.maximumInterval,
              nonRetryableErrors: options.retry.nonRetryableErrorTypes ? [...options.retry.nonRetryableErrorTypes] : undefined,
            } : undefined,
          }

          try {
            // Route activity via the shared ActivityRouter - handles timeouts and retries
            const result = await activityRouter.route(name, args, routerOptions, activityContext)

            // Cache successful result
            workflow.stepResults.set(stepId, result)
            workflow.historyLength++
            return result
          } catch (error) {
            // Cache error for replay (determinism)
            const err = ensureError(error)
            workflow.stepResults.set(stepId, err)
            workflow.historyLength++
            throw err
          }
        }

        // Fallback: Execute through DurableWorkflowRuntime
        // Uses getCurrentStorage() for consistent storage access
        const runtime = new DurableWorkflowRuntime({
          storage: getCurrentStorage(),
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
  // Auto-start cleanup on first workflow creation
  ensureCleanupStarted()

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
    abortController: new AbortController(),
    sleepStepCounter: 0,
    activityStepCounter: 0,
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
    // Inherits storage from parent context or uses global fallback
    const childContext: WorkflowContext = {
      workflow: childState,
      patchState: null,
      storage: getCurrentStorage(),
      waitManager: globalWaitManager,
      workflowStep: null,
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
// TEMPORAL ERROR CLASSES - Standard error types for workflow failures
// ============================================================================

/**
 * Application-level failure that can be thrown from workflows or activities.
 * Use this to signal business logic failures vs infrastructure errors.
 *
 * @example
 * ```typescript
 * import { ApplicationFailure } from '@dotdo/temporal'
 *
 * if (!user.hasPermission('admin')) {
 *   throw new ApplicationFailure('User does not have admin permission', true)
 * }
 * ```
 */
export class ApplicationFailure extends Error {
  readonly type = 'ApplicationFailure' as const

  constructor(
    message: string,
    readonly nonRetryable: boolean = false,
    readonly details?: unknown[]
  ) {
    super(message)
    this.name = 'ApplicationFailure'
  }

  /**
   * Create a non-retryable application failure
   */
  static nonRetryable(message: string, ...details: unknown[]): ApplicationFailure {
    return new ApplicationFailure(message, true, details.length > 0 ? details : undefined)
  }

  /**
   * Create a retryable application failure
   */
  static retryable(message: string, ...details: unknown[]): ApplicationFailure {
    return new ApplicationFailure(message, false, details.length > 0 ? details : undefined)
  }
}

/**
 * Failure thrown when an activity execution fails.
 * Contains information about the failed activity and the underlying cause.
 *
 * @example
 * ```typescript
 * try {
 *   await activities.processPayment(order)
 * } catch (error) {
 *   if (error instanceof ActivityFailure) {
 *     console.log(`Activity ${error.activityType} failed: ${error.cause?.message}`)
 *   }
 * }
 * ```
 */
export class ActivityFailure extends Error {
  readonly type = 'ActivityFailure' as const

  constructor(
    readonly activityType: string,
    readonly activityId: string,
    readonly cause?: Error
  ) {
    super(`Activity ${activityType} (${activityId}) failed${cause ? `: ${cause.message}` : ''}`)
    this.name = 'ActivityFailure'
  }
}

/**
 * Failure thrown when a child workflow execution fails.
 * Contains information about the failed child workflow and the underlying cause.
 *
 * @example
 * ```typescript
 * try {
 *   await executeChild(childWorkflow, { workflowId: 'child-1' })
 * } catch (error) {
 *   if (error instanceof ChildWorkflowFailure) {
 *     console.log(`Child workflow ${error.workflowType} failed: ${error.cause?.message}`)
 *   }
 * }
 * ```
 */
export class ChildWorkflowFailure extends Error {
  readonly type = 'ChildWorkflowFailure' as const

  constructor(
    readonly workflowType: string,
    readonly workflowId: string,
    readonly cause?: Error
  ) {
    super(`Child workflow ${workflowType} (${workflowId}) failed${cause ? `: ${cause.message}` : ''}`)
    this.name = 'ChildWorkflowFailure'
  }
}

/**
 * Check if an error is an ApplicationFailure
 */
export function isApplicationFailure(error: unknown): error is ApplicationFailure {
  return error instanceof ApplicationFailure
}

/**
 * Check if an error is an ActivityFailure
 */
export function isActivityFailure(error: unknown): error is ActivityFailure {
  return error instanceof ActivityFailure
}

/**
 * Check if an error is a ChildWorkflowFailure
 */
export function isChildWorkflowFailure(error: unknown): error is ChildWorkflowFailure {
  return error instanceof ChildWorkflowFailure
}

// ============================================================================
// WORKFLOW CLIENT - Enhanced with list and search
// ============================================================================

export class WorkflowClient {
  private readonly namespace: string
  private readonly storage: StepStorage

  constructor(options: WorkflowClientOptions = {}) {
    this.namespace = options.namespace ?? globalNamespace
    // Use explicit storage if provided, otherwise use current context storage or global fallback
    this.storage = options.storage ?? getCurrentStorage()
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
    // Auto-start cleanup on first workflow creation
    ensureCleanupStarted()

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
      abortController: new AbortController(),
      sleepStepCounter: 0,
      activityStepCounter: 0,
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
        workflowStep: null,
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

    for (const [, state] of Array.from(workflows.entries())) {
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
        // Abort any pending activities
        if (state.abortController) {
          state.abortController.abort()
        }
        // Cancel all children based on parent close policy
        for (const childId of Array.from(state.children)) {
          const childState = workflows.get(childId)
          if (childState && childState.status === 'RUNNING') {
            childState.status = 'CANCELED'
            if (childState.abortController) {
              childState.abortController.abort()
            }
          }
        }
      },

      async terminate(reason?: string): Promise<void> {
        state.status = 'TERMINATED'
        state.error = new Error(reason ?? 'Workflow terminated')
        // Terminate all children based on parent close policy
        for (const childId of Array.from(state.children)) {
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
  ActivityTimeoutError,
  // Determinism enforcement
  workflowNow,
  WorkflowDeterminismWarning,
  configureDeterminism,
  getDeterminismWarnings,
  clearDeterminismWarnings,
  enableDeterminismDetection,
  disableDeterminismDetection,
  inWorkflowContext,
  // CF Workflows integration
  setWorkflowStep,
  clearWorkflowStep,
  getWorkflowStep,
  // Storage strategy pattern (for advanced use)
  createStorageStrategy,
  CFWorkflowsStorageStrategy,
  InMemoryStorageStrategy,
  // Utility for testing
  __clearTemporalState,
}
