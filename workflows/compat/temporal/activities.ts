/**
 * Activities Module
 *
 * Activity proxying and local activity support.
 */

import { DurableWorkflowRuntime } from '../../runtime'
import { parseDuration } from '../utils'
import type { StepDoOptions } from '../../../lib/cloudflare/workflows'
import {
  WorkerActivityRouter,
  type ActivityRouter,
  type ActivityRouterOptions,
  type ActivityContext as RouterActivityContext,
  ActivityTimeoutError,
  TaskQueueNotRegisteredError,
} from '../activity-router'
import type {
  ActivityOptions,
  LocalActivityOptions,
  Activities,
  ActivityContext,
  WorkerHandler,
} from './types'
import {
  getCurrentWorkflow,
  getCurrentStorage,
  getWorkflowStep,
  formatDurationForCF,
} from './context'
import { ensureError } from '../utils'

// Re-export error classes for backward compatibility
export { ActivityTimeoutError, TaskQueueNotRegisteredError }

// ============================================================================
// TASK QUEUE REGISTRY
// ============================================================================

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
  // Cast to router's WorkerHandler type (compatible interface, context param optionality differs)
  return activityRouter.registerWorker(taskQueue, handler as Parameters<typeof activityRouter.registerWorker>[1])
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
 * Get the activity router (for testing)
 */
export function getActivityRouter(): ActivityRouter {
  return activityRouter
}

/**
 * Clear the activity router (for testing)
 */
export function clearActivityRouter(): void {
  activityRouter.clear()
}

// ============================================================================
// TASK QUEUE VALIDATION
// ============================================================================

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
export function validateTaskQueueForWorkflow(taskQueue: string, workflowType?: string): void {
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

// ============================================================================
// PROXY ACTIVITIES
// ============================================================================

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

// ============================================================================
// LOCAL ACTIVITIES
// ============================================================================

/**
 * Create local activity proxies
 */
export function proxyLocalActivities<T extends Activities>(options: LocalActivityOptions): T {
  // Local activities run in the same process with shorter timeouts
  return proxyActivities(options)
}
