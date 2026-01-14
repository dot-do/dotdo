/**
 * Workflow Primitives
 *
 * Temporal-inspired durable execution with activities, timers, and signals.
 *
 * @example
 * ```typescript
 * import { workflow, activity, WorkflowClient, WorkflowWorker } from 'dotdo/db/workflow'
 *
 * const myWorkflow = workflow('processOrder', async (ctx, order) => {
 *   const result = await ctx.activity('reserve', { input: order })
 *   await ctx.sleep('1h')
 *   return result
 * })
 *
 * const client = new WorkflowClient(env.DO)
 * const handle = await client.start(myWorkflow, { input: order, taskQueue: 'orders' })
 * const result = await handle.result()
 * ```
 */

// Types
export type {
  DurationString,
  RetryPolicy,
  ActivityOptions,
  ActivityContext,
  ActivityHandler,
  ActivityDefinition,
  SignalOptions,
  ChildWorkflowOptions,
  WorkflowContext,
  WorkflowHandler,
  WorkflowDefinition,
  WorkflowHandle,
  WorkflowStartOptions,
  WorkflowStatus,
  WorkflowInfo,
  WorkflowListOptions,
  WorkflowListResult,
} from './types'

// Errors
export { CancelledError, TimeoutError, SignalTimeoutError } from './types'

// Workflow definition
export { workflow } from './engine'

// Activity definition
export { defineActivity, getActivity, clearActivities, executeActivity } from './activity'

// For backward compatibility
export { defineActivity as activity } from './activity'

// Timer utilities
export { sleep, sleepUntil, parseDuration } from './timer'

// Signal handling
export { SignalQueue } from './signal'

// Client
export { WorkflowClient } from './client'

// Worker
export { WorkflowWorker } from './worker'
export type { WorkflowWorkerOptions } from './worker'

// Engine utilities (for testing)
export { clearWorkflows, getWorkflowExecution } from './engine'
