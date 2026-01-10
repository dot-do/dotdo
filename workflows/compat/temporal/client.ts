/**
 * WorkflowClient Module
 *
 * Client for starting, querying, and managing workflows.
 */

import type { StepStorage } from '../../runtime'
import type {
  WorkflowClientOptions,
  WorkflowStartOptions,
  SignalWithStartOptions,
  ListWorkflowOptions,
  WorkflowHandle,
  WorkflowExecutionDescription,
  SignalDefinition,
  QueryDefinition,
  UpdateDefinition,
  WorkflowState,
  WorkflowExecutionStatus,
  WorkflowContext,
} from './types'

// Terminal states for workflows
const TERMINAL_STATUS_SET = new Set<WorkflowExecutionStatus>([
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
])
import {
  getCurrentStorage,
  getWorkflowsRegistry,
  getWorkflowFunctionsRegistry,
  getGlobalNamespace,
  setGlobalNamespace,
  getGlobalWaitManager,
  generateWorkflowId,
  generateRunId,
  runWithContext,
} from './context'
import { validateTaskQueueForWorkflow } from './activities'
import { ensureCleanupStarted, setWorkflowCleanupFn } from './timers'
import { ContinueAsNew } from './signals'
import { markWorkflowCompleted, getWorkflowCompletionTimes } from './child-workflows'

// ============================================================================
// WORKFLOW REGISTRY CLEANUP
// ============================================================================

// Completed workflows are kept for a short TTL to allow result retrieval
const WORKFLOW_COMPLETED_TTL_MS = 60 * 60 * 1000 // 1 hour
// Maximum number of workflows to keep in registry (LRU eviction)
const WORKFLOW_MAX_REGISTRY_SIZE = 10000
// Cleanup interval for expired workflows
const WORKFLOW_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

let workflowCleanupIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Terminal states that indicate a workflow has finished execution
 */
const TERMINAL_STATES = TERMINAL_STATUS_SET

/**
 * Check if a workflow status is terminal (finished)
 */
export function isTerminalState(status: WorkflowExecutionStatus): boolean {
  return TERMINAL_STATES.has(status)
}

/**
 * Remove a workflow from the registry and cleanup tracking
 */
function removeWorkflow(workflowId: string): void {
  const workflows = getWorkflowsRegistry()
  const workflowCompletionTimes = getWorkflowCompletionTimes()
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
  const workflows = getWorkflowsRegistry()
  const workflowCompletionTimes = getWorkflowCompletionTimes()

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

// Wire up the cleanup function to the timers module
setWorkflowCleanupFn(__startWorkflowCleanup)

// ============================================================================
// WORKFLOW CLIENT
// ============================================================================

export class WorkflowClient {
  private readonly namespace: string
  private readonly storage: StepStorage

  constructor(options: WorkflowClientOptions = {}) {
    this.namespace = options.namespace ?? getGlobalNamespace()
    // Use explicit storage if provided, otherwise use current context storage or global fallback
    this.storage = options.storage ?? getCurrentStorage()
    // Update global namespace for workflows started by this client
    setGlobalNamespace(this.namespace)
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
    const workflows = getWorkflowsRegistry()
    const workflowFunctions = getWorkflowFunctionsRegistry()

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
        waitManager: getGlobalWaitManager(),
        workflowStep: null,
      }

      // Run the workflow in its own context (enabling concurrent execution)
      runWithContext(context, () => {
        workflowFn(...((options.args ?? []) as TArgs))
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
    const workflows = getWorkflowsRegistry()
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
    const workflows = getWorkflowsRegistry()

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
    const workflows = getWorkflowsRegistry()

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
    const workflows = getWorkflowsRegistry()
    const globalWaitManager = getGlobalWaitManager()

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
