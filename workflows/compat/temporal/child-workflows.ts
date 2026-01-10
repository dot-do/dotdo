/**
 * Child Workflows Module
 *
 * Starting and managing child workflow executions.
 */

import { WaitCancelledError } from '../../WaitForEventManager'
import type {
  ChildWorkflowOptions,
  ChildWorkflowHandle,
  SignalDefinition,
  ParentWorkflowInfo,
  WorkflowState,
  WorkflowContext,
} from './types'
import {
  getCurrentWorkflow,
  getCurrentStorage,
  getWorkflowsRegistry,
  getWorkflowFunctionsRegistry,
  getGlobalNamespace,
  getGlobalWaitManager,
  generateWorkflowId,
  generateRunId,
  runWithContext,
} from './context'
import { validateTaskQueueForWorkflow } from './activities'
import { ensureCleanupStarted } from './timers'

// ============================================================================
// WORKFLOW COMPLETION TRACKING
// ============================================================================

// Track completion times for TTL-based cleanup
const workflowCompletionTimes = new Map<string, number>()

/**
 * Mark a workflow as completed and schedule cleanup.
 * Called when a workflow transitions to a terminal state.
 */
export function markWorkflowCompleted(workflowId: string): void {
  workflowCompletionTimes.set(workflowId, Date.now())
}

/**
 * Get the completion times map (for cleanup module)
 */
export function getWorkflowCompletionTimes(): Map<string, number> {
  return workflowCompletionTimes
}

// ============================================================================
// START CHILD WORKFLOW
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
  const workflows = getWorkflowsRegistry()
  const workflowFunctions = getWorkflowFunctionsRegistry()

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
    namespace: parentWorkflow?.namespace ?? getGlobalNamespace(),
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
      waitManager: getGlobalWaitManager(),
      workflowStep: null,
    }

    // Run the child workflow in its own context
    runWithContext(childContext, () => {
      workflowFn(...((options.args ?? []) as TArgs))
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

// ============================================================================
// EXECUTE CHILD WORKFLOW
// ============================================================================

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
