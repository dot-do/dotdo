/**
 * Workflow Primitives - Workflow Execution Engine
 */

import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowContext,
  WorkflowHandle,
  WorkflowInfo,
  WorkflowStatus,
  ActivityOptions,
  ChildWorkflowOptions,
  SignalOptions,
  DurationString,
} from './types'
import type { CDCEmitter } from '../cdc'
import { CancelledError, TimeoutError } from './types'
import { sleep as timerSleep, sleepUntil as timerSleepUntil, parseDuration } from './timer'
import { executeActivity } from './activity'
import { SignalQueue } from './signal'

// =============================================================================
// CDC Integration
// =============================================================================

/** Global CDC emitter for workflow events */
let globalCdcEmitter: CDCEmitter | undefined

/**
 * Set the global CDC emitter for workflow events
 */
export function setWorkflowCDCEmitter(emitter: CDCEmitter | undefined): void {
  globalCdcEmitter = emitter
}

/**
 * Emit a workflow CDC event
 */
function emitWorkflowCDC(
  op: 'c' | 'u' | 'd',
  workflowId: string,
  before?: Record<string, unknown>,
  after?: Record<string, unknown>
): void {
  if (globalCdcEmitter) {
    globalCdcEmitter.emit({
      op,
      store: 'workflow',
      table: 'executions',
      key: workflowId,
      before,
      after,
    }).catch(() => {
      // Don't block on CDC pipeline errors
    })
  }
}

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Define a workflow
 */
export function workflow<T, R>(
  name: string,
  handler: WorkflowHandler<T, R>
): WorkflowDefinition<T, R> {
  return {
    name,
    handler,
    toJSON() {
      return { name: this.name }
    },
  }
}

// =============================================================================
// Workflow Execution State
// =============================================================================

interface WorkflowExecution {
  workflowId: string
  workflowType: string
  status: WorkflowStatus
  taskQueue: string
  input: unknown
  result?: unknown
  error?: string
  startedAt: Date
  completedAt?: Date
  signalQueue: SignalQueue
  queryHandlers: Map<string, (...args: unknown[]) => unknown>
  cancelled: boolean
  cancelPromise?: Promise<never>
  cancelReject?: (error: Error) => void
  resultPromise: Promise<unknown>
  resultResolve?: (value: unknown) => void
  resultReject?: (error: Error) => void
  // Promise that resolves once handler has started running
  handlerStarted: Promise<void>
  handlerStartedResolve?: () => void
}

// Global workflow state (in real implementation, this would be in SQLite)
const workflowExecutions = new Map<string, WorkflowExecution>()

// =============================================================================
// Workflow Execution
// =============================================================================

/**
 * Create workflow context
 */
function createWorkflowContext(execution: WorkflowExecution): WorkflowContext {
  return {
    workflowId: execution.workflowId,
    taskQueue: execution.taskQueue,
    startTime: execution.startedAt,
    currentStep: 0,

    async activity<T, R>(name: string, options: ActivityOptions<T>): Promise<R> {
      if (execution.cancelled) {
        throw new CancelledError()
      }
      return executeActivity(name, options)
    },

    async sleep(duration: DurationString | number): Promise<void> {
      if (execution.cancelled) {
        throw new CancelledError()
      }
      // Race between sleep and cancellation
      await Promise.race([
        timerSleep(duration),
        execution.cancelPromise,
      ].filter(Boolean))
    },

    async sleepUntil(timestamp: string | Date): Promise<void> {
      if (execution.cancelled) {
        throw new CancelledError()
      }
      await Promise.race([
        timerSleepUntil(timestamp),
        execution.cancelPromise,
      ].filter(Boolean))
    },

    async waitForSignal<T>(name: string, options?: SignalOptions<T>): Promise<T> {
      if (execution.cancelled) {
        throw new CancelledError()
      }
      return execution.signalQueue.wait(name, options)
    },

    setQueryHandler<T>(name: string, handler: (...args: unknown[]) => T): void {
      execution.queryHandlers.set(name, handler)
    },

    async startChild<T, R>(
      childWorkflow: WorkflowDefinition<T, R>,
      options: ChildWorkflowOptions<T>
    ): Promise<WorkflowHandle<R>> {
      const childTaskQueue = options.taskQueue || execution.taskQueue
      return startWorkflowExecution(
        childWorkflow,
        options.workflowId,
        options.input,
        childTaskQueue
      )
    },
  }
}

/**
 * Start a workflow execution
 */
export async function startWorkflowExecution<T, R>(
  workflowDef: WorkflowDefinition<T, R>,
  workflowId: string,
  input: T,
  taskQueue: string
): Promise<WorkflowHandle<R>> {
  // Check for duplicate
  if (workflowExecutions.has(workflowId)) {
    throw new Error(`Workflow ${workflowId} already exists`)
  }

  // Create result promise
  let resultResolve: ((value: unknown) => void) | undefined
  let resultReject: ((error: Error) => void) | undefined
  const resultPromise = new Promise<unknown>((resolve, reject) => {
    resultResolve = resolve
    resultReject = reject
  })

  // Create cancel promise
  let cancelReject: ((error: Error) => void) | undefined
  const cancelPromise = new Promise<never>((_, reject) => {
    cancelReject = reject
  })

  // Create handler started promise
  let handlerStartedResolve: (() => void) | undefined
  const handlerStarted = new Promise<void>((resolve) => {
    handlerStartedResolve = resolve
  })

  // Create execution state
  const execution: WorkflowExecution = {
    workflowId,
    workflowType: workflowDef.name,
    status: 'running',
    taskQueue,
    input,
    startedAt: new Date(),
    signalQueue: new SignalQueue(),
    queryHandlers: new Map(),
    cancelled: false,
    cancelPromise,
    cancelReject,
    resultPromise,
    resultResolve,
    resultReject,
    handlerStarted,
    handlerStartedResolve,
  }

  workflowExecutions.set(workflowId, execution)

  // Emit CDC event for workflow creation
  emitWorkflowCDC('c', workflowId, undefined, {
    workflowType: workflowDef.name,
    status: 'running',
    taskQueue,
    startedAt: execution.startedAt.toISOString(),
  })

  // Create context and run workflow
  const ctx = createWorkflowContext(execution)

  // Run workflow in background
  // Use queueMicrotask to allow start() to return first
  // The handler promise starts immediately and runs synchronously until first await
  queueMicrotask(() => {
    // Start the async handler - it runs synchronously until first await,
    // allowing query handlers to be registered before we resolve handlerStarted
    const handlerPromise = workflowDef.handler(ctx, input)

    // After the sync portion completes (query handlers registered),
    // signal that handler has started
    execution.handlerStartedResolve?.()

    // Then wait for the full result
    // Use setTimeout(0) to ensure completion happens after
    // any synchronous list()/describe() calls (setTimeout runs after microtasks)
    handlerPromise
      .then((result) => {
        setTimeout(() => {
          if (!execution.cancelled) {
            execution.status = 'completed'
            execution.result = result
            execution.completedAt = new Date()
            // Emit CDC event for workflow completion
            emitWorkflowCDC('u', execution.workflowId, { status: 'running' }, {
              status: 'completed',
              completedAt: execution.completedAt.toISOString(),
            })
            resultResolve?.(result)
          }
        }, 0)
      })
      .catch((error) => {
        setTimeout(() => {
          if (error instanceof CancelledError) {
            execution.status = 'cancelled'
            execution.completedAt = new Date()
            // Emit CDC event for workflow cancellation
            emitWorkflowCDC('u', execution.workflowId, { status: 'running' }, {
              status: 'cancelled',
              completedAt: execution.completedAt.toISOString(),
            })
            resultReject?.(error)
          } else {
            execution.status = 'failed'
            execution.error = (error as Error).message
            execution.completedAt = new Date()
            // Emit CDC event for workflow failure
            emitWorkflowCDC('u', execution.workflowId, { status: 'running' }, {
              status: 'failed',
              error: (error as Error).message,
              completedAt: execution.completedAt.toISOString(),
            })
            resultReject?.(error as Error)
          }
        }, 0)
      })
  })

  return createWorkflowHandle(execution)
}

/**
 * Create a workflow handle
 */
function createWorkflowHandle<R>(execution: WorkflowExecution): WorkflowHandle<R> {
  return {
    workflowId: execution.workflowId,

    async result(options?: { timeout?: DurationString }): Promise<R> {
      if (options?.timeout) {
        const ms = parseDuration(options.timeout)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new TimeoutError('Result timeout')), ms)
        })
        return Promise.race([execution.resultPromise, timeoutPromise]) as Promise<R>
      }
      return execution.resultPromise as Promise<R>
    },

    async query<T>(name: string, ...args: unknown[]): Promise<T> {
      // Wait for handler to have started (query handlers should be registered)
      await execution.handlerStarted
      const handler = execution.queryHandlers.get(name)
      if (!handler) {
        throw new Error(`query handler '${name}' not found`)
      }
      return handler(...args) as T
    },

    async signal<T>(name: string, payload: T): Promise<void> {
      execution.signalQueue.send(name, payload)
    },

    async cancel(): Promise<void> {
      execution.cancelled = true
      execution.status = 'cancelled'
      const error = new CancelledError()
      execution.cancelReject?.(error)
      execution.resultReject?.(error)
    },
  }
}

/**
 * Get workflow execution
 */
export function getWorkflowExecution(workflowId: string): WorkflowExecution | undefined {
  return workflowExecutions.get(workflowId)
}

/**
 * Get workflow info
 */
export function getWorkflowInfo(workflowId: string): WorkflowInfo {
  const execution = workflowExecutions.get(workflowId)
  if (!execution) {
    throw new Error(`Workflow ${workflowId} not found`)
  }
  return {
    workflowId: execution.workflowId,
    workflowType: execution.workflowType,
    status: execution.status,
    taskQueue: execution.taskQueue,
    input: execution.input,
    result: execution.result,
    error: execution.error,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  }
}

/**
 * List workflows
 */
export function listWorkflows(options: {
  status?: WorkflowStatus
  taskQueue?: string
  limit?: number
  offset?: number
}): WorkflowInfo[] {
  let results = Array.from(workflowExecutions.values())

  if (options.status) {
    results = results.filter((e) => e.status === options.status)
  }
  if (options.taskQueue) {
    results = results.filter((e) => e.taskQueue === options.taskQueue)
  }

  const offset = options.offset || 0
  const limit = options.limit || results.length

  return results.slice(offset, offset + limit).map((e) => ({
    workflowId: e.workflowId,
    workflowType: e.workflowType,
    status: e.status,
    taskQueue: e.taskQueue,
    input: e.input,
    result: e.result,
    error: e.error,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
  }))
}

/**
 * Terminate workflow
 */
export function terminateWorkflow(workflowId: string, reason: string): void {
  const execution = workflowExecutions.get(workflowId)
  if (!execution) {
    throw new Error(`Workflow ${workflowId} not found`)
  }
  const previousStatus = execution.status
  execution.cancelled = true
  execution.status = 'cancelled'
  // Emit CDC event for workflow termination
  emitWorkflowCDC('u', workflowId, { status: previousStatus }, {
    status: 'cancelled',
    terminationReason: reason,
  })
  const error = new Error(`terminated: ${reason}`)
  error.name = 'CancelledError'
  execution.cancelReject?.(error)
  execution.resultReject?.(error)
}

/**
 * Clear all workflows (for testing)
 */
export function clearWorkflows(): void {
  workflowExecutions.clear()
}
