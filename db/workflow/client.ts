/**
 * Workflow Primitives - Workflow Client
 */

import type {
  WorkflowDefinition,
  WorkflowHandle,
  WorkflowInfo,
  WorkflowStartOptions,
  WorkflowListOptions,
  WorkflowListResult,
} from './types'
import {
  startWorkflowExecution,
  getWorkflowInfo,
  listWorkflows,
  terminateWorkflow,
} from './engine'

/**
 * Generate a unique workflow ID
 */
function generateWorkflowId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Workflow client for starting and managing workflows
 */
export class WorkflowClient {
  constructor(private _do: unknown) {
    // DO stub for real implementation
  }

  /**
   * Start a new workflow
   */
  async start<T, R>(
    workflow: WorkflowDefinition<T, R>,
    options: WorkflowStartOptions<T>
  ): Promise<WorkflowHandle<R>> {
    const workflowId = options.workflowId || generateWorkflowId()
    return startWorkflowExecution(
      workflow,
      workflowId,
      options.input,
      options.taskQueue
    )
  }

  /**
   * List workflows
   */
  async list(options: WorkflowListOptions): Promise<WorkflowListResult> {
    const limit = options.limit || 20
    const offset = options.pageToken ? parseInt(options.pageToken, 10) : 0

    const workflows = listWorkflows({
      status: options.status,
      taskQueue: options.taskQueue,
      limit: limit + 1, // Get one extra to check if there's more
      offset,
    })

    const hasMore = workflows.length > limit
    const result = workflows.slice(0, limit) as WorkflowListResult

    if (hasMore) {
      result.nextPageToken = String(offset + limit)
    }

    return result
  }

  /**
   * Get workflow execution info
   */
  async describe(workflowId: string): Promise<WorkflowInfo> {
    return getWorkflowInfo(workflowId)
  }

  /**
   * Terminate a workflow
   */
  async terminate(workflowId: string, reason: string): Promise<void> {
    terminateWorkflow(workflowId, reason)
  }
}
