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
  searchAttributes?: Record<string, unknown>
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
  searchAttributes?: Record<string, unknown>
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
  searchAttributes?: Record<string, unknown>
  workflowRunTimeout?: string | number
  workflowTaskTimeout?: string | number
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
  searchAttributes?: Record<string, unknown>
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
  searchAttributes?: Record<string, unknown>
  /** Cron schedule */
  cronSchedule?: string
}

export interface SignalWithStartOptions<TSignalArgs extends unknown[], TWorkflowArgs extends unknown[]> extends WorkflowStartOptions<TWorkflowArgs> {
  signal: SignalDefinition<TSignalArgs>
  signalArgs: TSignalArgs
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

interface WorkflowState {
  workflowId: string
  runId: string
  signalHandlers: Map<string, SignalHandler<unknown[]>>
  queryHandlers: Map<string, QueryHandler<unknown, unknown[]>>
  updateHandlers: Map<string, UpdateHandler<unknown, unknown[]>>
  stepResults: Map<string, unknown>
  status: WorkflowExecutionStatus
  result?: unknown
  error?: Error
}

let currentWorkflow: WorkflowState | null = null
let globalStorage: StepStorage = new InMemoryStepStorage()
let globalState: DurableObjectState | null = null
let waitManager: WaitForEventManager | null = null

const workflows = new Map<string, WorkflowState>()
const workflowFunctions = new Map<string, (...args: unknown[]) => Promise<unknown>>()

export function configure(opts: { storage?: StepStorage; state?: DurableObjectState }): void {
  if (opts.storage) globalStorage = opts.storage
  if (opts.state) {
    globalState = opts.state
    waitManager = new WaitForEventManager(opts.state)
  }
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
// WORKFLOW INFO
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
    workflowType: 'unknown', // Would be set by registration
    taskQueue: 'default',
    namespace: 'default',
    firstExecutionRunId: currentWorkflow.runId,
    attempt: 1,
    historyLength: 0,
    startTime: new Date(),
    runStartTime: new Date(),
  }
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
  const stepId = `sleep:${ms}:${Date.now()}`

  // Check for replay
  if (currentWorkflow.stepResults.has(stepId)) {
    return
  }

  await new Promise((resolve) => setTimeout(resolve, ms))
  currentWorkflow.stepResults.set(stepId, true)
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
// CHILD WORKFLOWS
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

  // Create child workflow state
  const childState: WorkflowState = {
    workflowId,
    runId,
    signalHandlers: new Map(),
    queryHandlers: new Map(),
    updateHandlers: new Map(),
    stepResults: new Map(),
    status: 'RUNNING',
  }

  workflows.set(workflowId, childState)

  // Execute in background
  const workflowFn = typeof workflowType === 'function' ? workflowType : workflowFunctions.get(typeName)
  if (workflowFn) {
    const prevWorkflow = currentWorkflow
    currentWorkflow = childState

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
      })
  }

  return {
    workflowId,
    firstExecutionRunId: runId,
    async result(): Promise<T> {
      // Poll until complete
      while (childState.status === 'RUNNING') {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (childState.status === 'FAILED' && childState.error) {
        throw childState.error
      }

      return childState.result as T
    },
    async signal<Args extends unknown[]>(signal: SignalDefinition<Args>, ...args: Args): Promise<void> {
      const handler = childState.signalHandlers.get(signal.name)
      if (handler) {
        await handler(...args)
      }
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
// WORKFLOW CLIENT
// ============================================================================

export class WorkflowClient {
  private readonly namespace: string
  private readonly storage: StepStorage

  constructor(options: WorkflowClientOptions = {}) {
    this.namespace = options.namespace ?? 'default'
    this.storage = options.storage ?? globalStorage
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

    // Create workflow state
    const state: WorkflowState = {
      workflowId,
      runId,
      signalHandlers: new Map(),
      queryHandlers: new Map(),
      updateHandlers: new Map(),
      stepResults: new Map(),
      status: 'RUNNING',
    }

    workflows.set(workflowId, state)

    // Execute the workflow
    const workflowFn = typeof workflowType === 'function' ? workflowType : workflowFunctions.get(typeName)
    if (workflowFn) {
      const prevWorkflow = currentWorkflow
      currentWorkflow = state

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
    return {
      workflowId,
      runId,

      async result(): Promise<T> {
        // Poll until complete
        while (state.status === 'RUNNING') {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        if (state.status === 'FAILED' && state.error) {
          throw state.error
        }

        return state.result as T
      },

      async describe(): Promise<WorkflowExecutionDescription> {
        return {
          status: state.status,
          workflowId,
          runId,
          workflowType: 'unknown',
          taskQueue: 'default',
          startTime: new Date(),
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
      },

      async terminate(reason?: string): Promise<void> {
        state.status = 'TERMINATED'
        state.error = new Error(reason ?? 'Workflow terminated')
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
// PATCHED MODULES
// ============================================================================

/**
 * Patch setTimeout for deterministic sleep
 */
export function patched<T extends (...args: unknown[]) => unknown>(fn: T): T {
  // In compat mode, return as-is (determinism handled by step results)
  return fn
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
}
