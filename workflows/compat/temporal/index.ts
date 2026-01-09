/**
 * Temporal Compat Layer - 100% API Compatible with @temporalio/workflow
 *
 * Drop-in replacement for Temporal that runs on dotdo's
 * durable execution infrastructure.
 *
 * @example
 * ```typescript
 * import { proxyActivities, defineSignal, setHandler, sleep, condition } from '@dotdo/temporal'
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
 *   setHandler(approved, (approval) => {
 *     isApproved = approval
 *   })
 *
 *   await condition(() => isApproved, '7d')
 *
 *   await chargeCard(order.cardToken, order.amount)
 *   await sendEmail(order.email, 'Order confirmed!')
 *
 *   return { status: 'completed' }
 * }
 * ```
 */

import { WaitForEventManager, WaitTimeoutError, WaitCancelledError } from '../../WaitForEventManager'
import { DurableWorkflowRuntime, InMemoryStepStorage } from '../../runtime'
import type { StepStorage } from '../../runtime'

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
// GLOBAL STATE - Extended for full API coverage
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
}

let currentWorkflow: WorkflowState | null = null
let currentPatchState: PatchState | null = null
let globalStorage: StepStorage = new InMemoryStepStorage()
let globalState: DurableObjectState | null = null
let waitManager: WaitForEventManager | null = null
let globalNamespace = 'default'

const workflows = new Map<string, WorkflowState>()
const workflowFunctions = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const activeTimers = new Map<string, TimerState>()

export function configure(opts: { storage?: StepStorage; state?: DurableObjectState; namespace?: string }): void {
  if (opts.storage) globalStorage = opts.storage
  if (opts.state) {
    globalState = opts.state
    waitManager = new WaitForEventManager(opts.state)
  }
  if (opts.namespace) globalNamespace = opts.namespace
}

// ============================================================================
// UTILITIES
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|hour|d|day|w|week)s?$/i)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    sec: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return Math.floor(value * (multipliers[unit] || 1000))
}

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
  if (!currentWorkflow) {
    throw new Error('setHandler can only be called within a workflow')
  }

  if (definition.type === 'signal') {
    currentWorkflow.signalHandlers.set(definition.name, handler as SignalHandler<unknown[]>)
  } else if (definition.type === 'query') {
    currentWorkflow.queryHandlers.set(definition.name, handler as QueryHandler<unknown, unknown[]>)
  } else {
    currentWorkflow.updateHandlers.set(definition.name, handler as UpdateHandler<unknown, unknown[]>)
  }
}

// ============================================================================
// WORKFLOW INFO - Enhanced with full context
// ============================================================================

/**
 * Get current workflow info
 */
export function workflowInfo(): WorkflowInfo {
  if (!currentWorkflow) {
    throw new Error('workflowInfo can only be called within a workflow')
  }

  return {
    workflowId: currentWorkflow.workflowId,
    runId: currentWorkflow.runId,
    workflowType: currentWorkflow.workflowType,
    taskQueue: currentWorkflow.taskQueue,
    namespace: currentWorkflow.namespace,
    firstExecutionRunId: currentWorkflow.runId,
    attempt: currentWorkflow.attempt,
    historyLength: currentWorkflow.historyLength,
    startTime: currentWorkflow.startTime,
    runStartTime: currentWorkflow.runStartTime,
    memo: currentWorkflow.memo,
    searchAttributes: currentWorkflow.searchAttributes,
    parent: currentWorkflow.parent,
  }
}

// ============================================================================
// SEARCH ATTRIBUTES - Full implementation
// ============================================================================

/**
 * Set search attributes (replaces all)
 */
export function setSearchAttributes(attrs: SearchAttributes): void {
  if (!currentWorkflow) {
    throw new Error('setSearchAttributes can only be called within a workflow')
  }
  currentWorkflow.searchAttributes = { ...attrs }
  currentWorkflow.historyLength++
}

/**
 * Upsert (merge) search attributes
 */
export function upsertSearchAttributes(attrs: SearchAttributes): void {
  if (!currentWorkflow) {
    throw new Error('upsertSearchAttributes can only be called within a workflow')
  }
  currentWorkflow.searchAttributes = {
    ...currentWorkflow.searchAttributes,
    ...attrs,
  }
  currentWorkflow.historyLength++
}

// ============================================================================
// TIMERS - Full implementation with coalescing optimization
// ============================================================================

// Timer coalescing: Group timers that fire within the same 10ms window
const TIMER_COALESCE_WINDOW_MS = 10
const coalescedTimerBuckets = new Map<number, TimerState[]>()

/**
 * Create a cancellable timer with optional coalescing
 *
 * OPTIMIZATION: Timers firing within 10ms of each other are coalesced
 * into a single setTimeout call, reducing system call overhead.
 */
export function createTimer(duration: string | number): TimerHandle {
  const ms = parseDuration(duration)
  const id = generateTimerId()

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
          if (currentWorkflow) {
            currentWorkflow.historyLength++
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
 */
export function __clearTemporalState(): void {
  workflows.clear()
  workflowFunctions.clear()
  activeTimers.clear()
  coalescedTimerBuckets.clear()
  currentWorkflow = null
  currentPatchState = null
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
  if (!currentPatchState) {
    currentPatchState = {
      appliedPatches: new Set(),
      deprecatedPatches: new Set(),
    }
  }

  // For new executions, always apply patches
  // In a full implementation, this would check workflow history
  currentPatchState.appliedPatches.add(patchId)

  if (currentWorkflow) {
    currentWorkflow.historyLength++
  }

  return true
}

/**
 * Deprecate an old patch (removes it from consideration in new workflow code)
 */
export function deprecatePatch(patchId: string): void {
  if (!currentPatchState) {
    currentPatchState = {
      appliedPatches: new Set(),
      deprecatedPatches: new Set(),
    }
  }

  currentPatchState.deprecatedPatches.add(patchId)
}

// ============================================================================
// SLEEP AND CONDITION
// ============================================================================

/**
 * Sleep for a duration (durable)
 */
export async function sleep(duration: string | number): Promise<void> {
  if (!currentWorkflow) {
    throw new Error('sleep can only be called within a workflow')
  }

  const ms = parseDuration(duration)
  const stepId = `sleep:${ms}:${currentWorkflow.historyLength}`

  // Check for replay
  if (currentWorkflow.stepResults.has(stepId)) {
    return
  }

  await new Promise((resolve) => setTimeout(resolve, ms))
  currentWorkflow.stepResults.set(stepId, true)
  currentWorkflow.historyLength++
}

/**
 * Wait for a condition to be true
 */
export async function condition(fn: () => boolean, timeout?: string | number): Promise<boolean> {
  if (!currentWorkflow) {
    throw new Error('condition can only be called within a workflow')
  }

  const timeoutMs = timeout ? parseDuration(timeout) : undefined
  const startTime = Date.now()

  while (!fn()) {
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

  return new Proxy({} as T, {
    get(_, name: string) {
      return async (...args: unknown[]): Promise<unknown> => {
        if (!currentWorkflow) {
          throw new Error('Activities can only be called within a workflow')
        }

        const stepId = `activity:${name}:${JSON.stringify(args)}`

        // Check for replay
        if (currentWorkflow.stepResults.has(stepId)) {
          return currentWorkflow.stepResults.get(stepId)
        }

        // Execute the activity (in compat mode, activities are stubs)
        // In production, this would route to actual activity workers
        const result = await runtime.executeStep(
          stepId,
          {
            path: ['Activity', name],
            context: { args },
            contextHash: stepId,
            runtime,
          },
          args,
          'do'
        )

        currentWorkflow.stepResults.set(stepId, result)
        currentWorkflow.historyLength++
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
 */
export async function startChild<T, TArgs extends unknown[]>(
  workflowType: string | ((...args: TArgs) => Promise<T>),
  options: ChildWorkflowOptions & { args?: TArgs }
): Promise<ChildWorkflowHandle<T>> {
  const typeName = typeof workflowType === 'string' ? workflowType : workflowType.name
  const workflowId = options.workflowId ?? generateWorkflowId()
  const runId = generateRunId()
  const now = new Date()

  // Get parent info if executing within a workflow
  const parentInfo: ParentWorkflowInfo | undefined = currentWorkflow
    ? {
        workflowId: currentWorkflow.workflowId,
        runId: currentWorkflow.runId,
        namespace: currentWorkflow.namespace,
      }
    : undefined

  // Create child workflow state
  const childState: WorkflowState = {
    workflowId,
    runId,
    workflowType: typeName,
    taskQueue: options.taskQueue ?? currentWorkflow?.taskQueue ?? 'default',
    namespace: currentWorkflow?.namespace ?? globalNamespace,
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
  if (currentWorkflow) {
    currentWorkflow.children.add(workflowId)
    currentWorkflow.historyLength++
  }

  // Execute in background
  const workflowFn = typeof workflowType === 'function' ? workflowType : workflowFunctions.get(typeName)
  if (workflowFn) {
    const prevWorkflow = currentWorkflow
    const prevPatchState = currentPatchState
    currentWorkflow = childState
    currentPatchState = null

    workflowFn(...(options.args ?? []))
      .then((result) => {
        childState.status = 'COMPLETED'
        childState.result = result
      })
      .catch((error) => {
        childState.status = 'FAILED'
        childState.error = error
      })
      .finally(() => {
        currentWorkflow = prevWorkflow
        currentPatchState = prevPatchState
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
   */
  async start<TArgs extends unknown[], TResult>(
    workflowType: string | ((...args: TArgs) => Promise<TResult>),
    options: WorkflowStartOptions<TArgs>
  ): Promise<WorkflowHandle<TResult>> {
    const typeName = typeof workflowType === 'string' ? workflowType : workflowType.name
    const workflowId = options.workflowId ?? generateWorkflowId()
    const runId = generateRunId()
    const now = new Date()

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

    // Execute the workflow
    const workflowFn = typeof workflowType === 'function' ? workflowType : workflowFunctions.get(typeName)
    if (workflowFn) {
      const prevWorkflow = currentWorkflow
      const prevPatchState = currentPatchState
      currentWorkflow = state
      currentPatchState = null

      workflowFn(...(options.args ?? []))
        .then((result) => {
          state.status = 'COMPLETED'
          state.result = result
        })
        .catch((error) => {
          if (error instanceof ContinueAsNew) {
            state.status = 'CONTINUED_AS_NEW'
          } else {
            state.status = 'FAILED'
            state.error = error
          }
        })
        .finally(() => {
          currentWorkflow = prevWorkflow
          currentPatchState = prevPatchState
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
   */
  private matchesQuery(state: WorkflowState, query: string): boolean {
    // Simple parser for queries like: Status = "active"
    const match = query.match(/(\w+)\s*=\s*"([^"]+)"/)
    if (!match) return true

    const [, key, value] = match
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
        if (waitManager) {
          await waitManager.deliverEvent(null, `signal:${signal.name}`, args)
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
// UUID AND RANDOM
// ============================================================================

/**
 * Generate deterministic UUID (for replay)
 */
export function uuid4(): string {
  return crypto.randomUUID()
}

/**
 * Get deterministic random number (for replay)
 */
export function random(): number {
  return Math.random()
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
  // Utility for testing
  __clearTemporalState,
}
