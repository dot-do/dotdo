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
 * 1. If a remote activity worker binding is registered for the task queue,
 *    route via RPC to the dedicated activity worker
 *    - Enables independent scaling for CPU-intensive activities
 *    - Supports heartbeats for long-running activities
 *    - Worker-level timeout enforcement
 *
 * 2. If a local worker with executeActivity handler is registered, route to that handler
 *    - Enables testing workflows with mock activity implementations
 *    - Handles timeouts, retries, and error classification
 *
 * 3. If WorkflowStep context is available (CF Workflows), use step.do()
 *    - DURABLE: automatically retries and survives restarts
 *    - REPLAY: completed steps return cached results
 *
 * 4. Otherwise, fall back to DurableWorkflowRuntime
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
          // Priority: Remote worker > Local worker > Stub
          const callback = async () => {
            // 1. Check for remote activity worker binding (independent scaling)
            const remoteBinding = remoteActivityBindings.get(targetTaskQueue)
            if (remoteBinding) {
              const executionId = `${workflow.workflowId}:${workflow.runId}:${name}:${workflow.activityStepCounter}`
              const response = await remoteBinding.execute({
                executionId,
                activityName: name,
                args,
                startToCloseTimeoutMs,
                heartbeatTimeoutMs,
                workflowId: workflow.workflowId,
                runId: workflow.runId,
              })

              if (!response.success) {
                const error = new Error(response.error?.message ?? 'Activity execution failed')
                error.name = response.error?.name ?? 'ActivityError'
                throw error
              }

              return response.result
            }

            // 2. Check if local worker has a handler for this activity
            const worker = activityRouter.getWorker(targetTaskQueue)
            if (worker?.executeActivity) {
              // Create activity context with cancellation signal
              const activityContext: RouterActivityContext = {
                signal: workflow.abortController?.signal,
              }
              return worker.executeActivity(name, args, activityContext)
            }

            // 3. Fallback for CF Workflows runtime (no local handler)
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
        // Priority: Remote worker > Local worker > DurableWorkflowRuntime

        // 1. Check for remote activity worker binding (independent scaling)
        const remoteBinding = remoteActivityBindings.get(targetTaskQueue)
        if (remoteBinding) {
          const executionId = `${workflow.workflowId}:${workflow.runId}:${name}:${Date.now()}`
          try {
            const response = await remoteBinding.execute({
              executionId,
              activityName: name,
              args,
              startToCloseTimeoutMs,
              heartbeatTimeoutMs,
              workflowId: workflow.workflowId,
              runId: workflow.runId,
            })

            if (!response.success) {
              const error = new Error(response.error?.message ?? 'Activity execution failed')
              error.name = response.error?.name ?? 'ActivityError'
              // Cache error for replay
              workflow.stepResults.set(stepId, error)
              workflow.historyLength++
              throw error
            }

            // Cache successful result
            workflow.stepResults.set(stepId, response.result)
            workflow.historyLength++
            return response.result
          } catch (error) {
            const err = ensureError(error)
            workflow.stepResults.set(stepId, err)
            workflow.historyLength++
            throw err
          }
        }

        // 2. Get the local worker for this task queue via activityRouter
        const worker = activityRouter.getWorker(targetTaskQueue)

        // If local worker has executeActivity handler, route via activityRouter (no step.do() durability)
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

// ============================================================================
// ACTIVITY WORKER POOL - Independent Scaling for CPU-Intensive Tasks
// ============================================================================

/**
 * Activity function that can be executed by an activity worker.
 * Supports an optional heartbeat callback for long-running activities.
 */
export type ActivityWorkerFunction<TArgs extends unknown[] = unknown[], TResult = unknown> = (
  ...args: TArgs
) => Promise<TResult>

/**
 * Activity definitions map for type safety.
 */
export type ActivityDefinitions = Record<string, ActivityWorkerFunction>

/**
 * Heartbeat context passed to activities for progress reporting.
 *
 * Long-running activities should call heartbeat() periodically to:
 * 1. Prevent timeout (resets the heartbeat timer)
 * 2. Report progress details
 * 3. Allow cancellation detection
 *
 * @example
 * ```typescript
 * async function processLargeFile(
 *   filepath: string,
 *   ctx: HeartbeatContext
 * ): Promise<void> {
 *   const lines = await readLines(filepath)
 *   for (let i = 0; i < lines.length; i++) {
 *     await processLine(lines[i])
 *     // Report progress every 100 lines
 *     if (i % 100 === 0) {
 *       ctx.heartbeat({ progress: i / lines.length })
 *     }
 *   }
 * }
 * ```
 */
export interface HeartbeatContext {
  /**
   * Send a heartbeat to indicate the activity is still alive.
   * Resets the heartbeat timeout timer.
   *
   * @param details - Optional progress details (must be JSON-serializable)
   */
  heartbeat(details?: unknown): void

  /**
   * Check if cancellation has been requested.
   * Activities should periodically check this and clean up if true.
   */
  readonly isCancelled: boolean

  /**
   * Abort signal for cancellation propagation.
   * Can be passed to fetch() or other cancellable operations.
   */
  readonly signal: AbortSignal
}

/**
 * Activity with heartbeat support.
 * The last argument is always the HeartbeatContext.
 */
export type HeartbeatActivityFunction<TArgs extends unknown[] = unknown[], TResult = unknown> = (
  ctx: HeartbeatContext,
  ...args: TArgs
) => Promise<TResult>

/**
 * Configuration for creating an activity worker.
 *
 * @example
 * ```typescript
 * export const imageWorker = createActivityWorker({
 *   taskQueue: 'image-processing',
 *   activities: {
 *     resizeImage,
 *     convertFormat,
 *     applyFilters,
 *   },
 *   // Optional: configure default timeouts
 *   defaultStartToCloseTimeout: '10m',
 *   defaultHeartbeatTimeout: '30s',
 * })
 * ```
 */
export interface ActivityWorkerConfig<T extends ActivityDefinitions = ActivityDefinitions> {
  /**
   * Task queue name this worker polls for activities.
   * Must be unique per worker deployment.
   */
  taskQueue: string

  /**
   * Activity implementations mapped by name.
   */
  activities: T

  /**
   * Default start-to-close timeout for activities on this worker.
   * Can be overridden per-activity via proxyActivities options.
   * @default '5m'
   */
  defaultStartToCloseTimeout?: string | number

  /**
   * Default heartbeat timeout for activities on this worker.
   * Activities must call heartbeat() within this interval.
   * @default '30s'
   */
  defaultHeartbeatTimeout?: string | number

  /**
   * Maximum concurrent activities this worker can execute.
   * @default 10
   */
  maxConcurrentActivities?: number

  /**
   * Namespace for metrics and logging.
   * @default taskQueue
   */
  namespace?: string
}

/**
 * Internal state for tracking active activities.
 */
interface ActiveActivity {
  id: string
  name: string
  startTime: number
  lastHeartbeat: number
  heartbeatDetails?: unknown
  abortController: AbortController
  timeoutId?: ReturnType<typeof setTimeout>
  heartbeatTimeoutId?: ReturnType<typeof setTimeout>
}

/**
 * Activity execution request received from workflow via RPC.
 */
export interface ActivityExecutionRequest {
  /**
   * Unique execution ID for idempotency and tracking.
   */
  executionId: string

  /**
   * Name of the activity to execute.
   */
  activityName: string

  /**
   * Arguments to pass to the activity.
   */
  args: unknown[]

  /**
   * Start-to-close timeout in milliseconds.
   */
  startToCloseTimeoutMs?: number

  /**
   * Heartbeat timeout in milliseconds.
   */
  heartbeatTimeoutMs?: number

  /**
   * Optional: Workflow ID for correlation.
   */
  workflowId?: string

  /**
   * Optional: Run ID for correlation.
   */
  runId?: string
}

/**
 * Activity execution response returned to workflow.
 */
export interface ActivityExecutionResponse {
  /**
   * Execution ID from the request.
   */
  executionId: string

  /**
   * Whether the activity succeeded.
   */
  success: boolean

  /**
   * Result if success is true.
   */
  result?: unknown

  /**
   * Error details if success is false.
   */
  error?: {
    name: string
    message: string
    stack?: string
    isRetryable: boolean
  }

  /**
   * Execution duration in milliseconds.
   */
  durationMs: number

  /**
   * Last heartbeat details (if any).
   */
  lastHeartbeatDetails?: unknown
}

/**
 * Activity heartbeat message for long-running activities.
 */
export interface ActivityHeartbeatMessage {
  executionId: string
  details?: unknown
  timestamp: number
}

/**
 * Activity Worker - Executes activities on a dedicated CF Worker.
 *
 * This class implements the WorkerEntrypoint pattern for RPC access
 * via Service Bindings, enabling activities to run on separate workers
 * that can be independently scaled.
 *
 * ## Architecture
 *
 * ```
 * [Workflow DO] --RPC--> [Activity Worker] --execute--> [Activity Function]
 *      ^                        |
 *      |                        v
 *      +------- heartbeat ------+
 * ```
 *
 * ## Deployment
 *
 * ```toml
 * # wrangler.toml for activity worker
 * name = "activity-worker-image-processing"
 *
 * [[services]]
 * binding = "IMAGE_WORKER"
 * service = "activity-worker-image-processing"
 * entrypoint = "ActivityWorker"
 * ```
 *
 * @example
 * ```typescript
 * // activity-worker.ts
 * import { createActivityWorker } from '@dotdo/temporal'
 *
 * const processImage = async (imageUrl: string, options: ImageOptions) => {
 *   // CPU-intensive image processing
 *   return { url: processedUrl }
 * }
 *
 * export const ActivityWorker = createActivityWorker({
 *   taskQueue: 'image-processing',
 *   activities: {
 *     processImage,
 *   },
 * })
 *
 * // In workflow:
 * const activities = proxyActivities<typeof ActivityWorker.activities>({
 *   taskQueue: 'image-processing',
 *   startToCloseTimeout: '5m',
 * })
 *
 * const result = await activities.processImage(imageUrl, options)
 * ```
 */
export class ActivityWorker<T extends ActivityDefinitions = ActivityDefinitions> {
  readonly taskQueue: string
  readonly activities: T

  private readonly defaultStartToCloseTimeoutMs: number
  private readonly defaultHeartbeatTimeoutMs: number
  private readonly maxConcurrentActivities: number
  private readonly namespace: string

  private readonly activeActivities = new Map<string, ActiveActivity>()

  constructor(config: ActivityWorkerConfig<T>) {
    this.taskQueue = config.taskQueue
    this.activities = config.activities
    this.defaultStartToCloseTimeoutMs = config.defaultStartToCloseTimeout
      ? parseDuration(config.defaultStartToCloseTimeout)
      : 5 * 60 * 1000 // 5 minutes
    this.defaultHeartbeatTimeoutMs = config.defaultHeartbeatTimeout
      ? parseDuration(config.defaultHeartbeatTimeout)
      : 30 * 1000 // 30 seconds
    this.maxConcurrentActivities = config.maxConcurrentActivities ?? 10
    this.namespace = config.namespace ?? config.taskQueue
  }

  /**
   * Execute an activity.
   * This is the main RPC method called from workflows.
   */
  async execute(request: ActivityExecutionRequest): Promise<ActivityExecutionResponse> {
    const startTime = Date.now()
    const { executionId, activityName, args } = request

    // Check if activity exists
    const activityFn = this.activities[activityName]
    if (!activityFn) {
      return {
        executionId,
        success: false,
        error: {
          name: 'ActivityNotFoundError',
          message: `Activity "${activityName}" not found on task queue "${this.taskQueue}"`,
          isRetryable: false,
        },
        durationMs: Date.now() - startTime,
      }
    }

    // Check concurrency limit
    if (this.activeActivities.size >= this.maxConcurrentActivities) {
      return {
        executionId,
        success: false,
        error: {
          name: 'ActivityConcurrencyLimitError',
          message: `Activity worker at capacity (${this.maxConcurrentActivities} concurrent activities)`,
          isRetryable: true,
        },
        durationMs: Date.now() - startTime,
      }
    }

    // Setup activity tracking
    const abortController = new AbortController()
    const activeActivity: ActiveActivity = {
      id: executionId,
      name: activityName,
      startTime,
      lastHeartbeat: startTime,
      abortController,
    }
    this.activeActivities.set(executionId, activeActivity)

    // Setup timeouts
    const startToCloseTimeoutMs = request.startToCloseTimeoutMs ?? this.defaultStartToCloseTimeoutMs
    const heartbeatTimeoutMs = request.heartbeatTimeoutMs ?? this.defaultHeartbeatTimeoutMs

    let lastHeartbeatDetails: unknown

    // Heartbeat context for the activity
    const heartbeatCtx: HeartbeatContext = {
      heartbeat: (details?: unknown) => {
        activeActivity.lastHeartbeat = Date.now()
        activeActivity.heartbeatDetails = details
        lastHeartbeatDetails = details

        // Reset heartbeat timeout
        if (activeActivity.heartbeatTimeoutId) {
          clearTimeout(activeActivity.heartbeatTimeoutId)
        }
        activeActivity.heartbeatTimeoutId = setTimeout(() => {
          abortController.abort(new Error('Activity heartbeat timeout'))
        }, heartbeatTimeoutMs)
      },
      get isCancelled() {
        return abortController.signal.aborted
      },
      signal: abortController.signal,
    }

    try {
      // Setup start-to-close timeout
      activeActivity.timeoutId = setTimeout(() => {
        abortController.abort(new Error('Activity start-to-close timeout'))
      }, startToCloseTimeoutMs)

      // Setup initial heartbeat timeout
      activeActivity.heartbeatTimeoutId = setTimeout(() => {
        abortController.abort(new Error('Activity heartbeat timeout'))
      }, heartbeatTimeoutMs)

      // Execute the activity
      // Check if activity expects heartbeat context (first param is HeartbeatContext)
      const result = await activityFn(...args)

      return {
        executionId,
        success: true,
        result,
        durationMs: Date.now() - startTime,
        lastHeartbeatDetails,
      }
    } catch (error) {
      const err = ensureError(error)
      const isTimeout = err.message.includes('timeout')
      const isCancelled = err.message.includes('cancelled') || abortController.signal.aborted

      return {
        executionId,
        success: false,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
          // Timeouts and cancellations are not retryable
          isRetryable: !isTimeout && !isCancelled,
        },
        durationMs: Date.now() - startTime,
        lastHeartbeatDetails,
      }
    } finally {
      // Cleanup
      if (activeActivity.timeoutId) {
        clearTimeout(activeActivity.timeoutId)
      }
      if (activeActivity.heartbeatTimeoutId) {
        clearTimeout(activeActivity.heartbeatTimeoutId)
      }
      this.activeActivities.delete(executionId)
    }
  }

  /**
   * Cancel an in-progress activity.
   */
  async cancel(executionId: string): Promise<boolean> {
    const activity = this.activeActivities.get(executionId)
    if (!activity) {
      return false
    }

    activity.abortController.abort(new Error('Activity cancelled'))
    return true
  }

  /**
   * Get heartbeat status for an activity.
   */
  async heartbeatStatus(executionId: string): Promise<{
    found: boolean
    lastHeartbeat?: number
    details?: unknown
  }> {
    const activity = this.activeActivities.get(executionId)
    if (!activity) {
      return { found: false }
    }

    return {
      found: true,
      lastHeartbeat: activity.lastHeartbeat,
      details: activity.heartbeatDetails,
    }
  }

  /**
   * Get worker status (for health checks).
   */
  async status(): Promise<{
    taskQueue: string
    activeCount: number
    maxConcurrent: number
    activities: string[]
  }> {
    return {
      taskQueue: this.taskQueue,
      activeCount: this.activeActivities.size,
      maxConcurrent: this.maxConcurrentActivities,
      activities: Object.keys(this.activities),
    }
  }
}

/**
 * Create an activity worker for a task queue.
 *
 * This is the main factory function for creating activity workers that
 * run on dedicated Cloudflare Workers for independent scaling.
 *
 * ## Usage
 *
 * 1. Define your activities as async functions
 * 2. Create the worker with createActivityWorker()
 * 3. Export the worker class from your worker entry point
 * 4. Configure service binding in wrangler.toml
 * 5. Use proxyActivities() in workflows with matching taskQueue
 *
 * @example
 * ```typescript
 * // activities/image-worker.ts
 * import { createActivityWorker } from '@dotdo/temporal'
 *
 * // Define activities
 * async function processImage(url: string, options: ImageOptions) {
 *   // CPU-intensive processing
 *   return { processedUrl: '...' }
 * }
 *
 * async function generateThumbnail(url: string, size: number) {
 *   // Generate thumbnail
 *   return { thumbnailUrl: '...' }
 * }
 *
 * // Create the worker
 * export const activityWorker = createActivityWorker({
 *   taskQueue: 'image-processing',
 *   activities: {
 *     processImage,
 *     generateThumbnail,
 *   },
 *   defaultStartToCloseTimeout: '10m',
 *   defaultHeartbeatTimeout: '1m',
 *   maxConcurrentActivities: 5,
 * })
 *
 * // Export for Cloudflare Workers
 * export { activityWorker as ActivityWorker }
 *
 * // In wrangler.toml:
 * // [[services]]
 * // binding = "IMAGE_ACTIVITIES"
 * // service = "image-processing-worker"
 * // entrypoint = "ActivityWorker"
 * ```
 *
 * @param config - Activity worker configuration
 * @returns ActivityWorker instance that can be exported as a WorkerEntrypoint
 */
export function createActivityWorker<T extends ActivityDefinitions>(
  config: ActivityWorkerConfig<T>
): ActivityWorker<T> {
  return new ActivityWorker(config)
}

// ============================================================================
// REMOTE ACTIVITY WORKER BINDING - For calling activities on remote workers
// ============================================================================

/**
 * Type for activity worker service binding.
 * Use this to type your env bindings for activity workers.
 *
 * @example
 * ```typescript
 * interface Env {
 *   IMAGE_ACTIVITIES: ActivityWorkerBinding<typeof imageActivities>
 *   EMAIL_ACTIVITIES: ActivityWorkerBinding<typeof emailActivities>
 * }
 * ```
 */
export interface ActivityWorkerBinding<T extends ActivityDefinitions = ActivityDefinitions> {
  /**
   * Execute an activity on the remote worker.
   */
  execute(request: ActivityExecutionRequest): Promise<ActivityExecutionResponse>

  /**
   * Cancel an in-progress activity.
   */
  cancel(executionId: string): Promise<boolean>

  /**
   * Get heartbeat status for an activity.
   */
  heartbeatStatus(executionId: string): Promise<{
    found: boolean
    lastHeartbeat?: number
    details?: unknown
  }>

  /**
   * Get worker status.
   */
  status(): Promise<{
    taskQueue: string
    activeCount: number
    maxConcurrent: number
    activities: string[]
  }>
}

/**
 * Registry of remote activity worker bindings.
 * Used by proxyActivities to route to remote workers.
 */
const remoteActivityBindings = new Map<string, ActivityWorkerBinding>()

/**
 * Register a remote activity worker binding for a task queue.
 *
 * Call this during worker initialization to register service bindings
 * for remote activity workers.
 *
 * @example
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     // Register remote activity workers
 *     registerRemoteActivityWorker('image-processing', env.IMAGE_ACTIVITIES)
 *     registerRemoteActivityWorker('email-sending', env.EMAIL_ACTIVITIES)
 *
 *     // ... rest of handler
 *   }
 * }
 * ```
 *
 * @param taskQueue - Task queue name
 * @param binding - Service binding to the activity worker
 */
export function registerRemoteActivityWorker(
  taskQueue: string,
  binding: ActivityWorkerBinding
): void {
  remoteActivityBindings.set(taskQueue, binding)
}

/**
 * Get a registered remote activity worker binding.
 */
export function getRemoteActivityWorker(taskQueue: string): ActivityWorkerBinding | undefined {
  return remoteActivityBindings.get(taskQueue)
}

/**
 * Clear remote activity worker bindings (for testing).
 */
export function clearRemoteActivityWorkers(): void {
  remoteActivityBindings.clear()
}

/**
 * Check if a task queue has a remote activity worker binding.
 */
export function hasRemoteActivityWorker(taskQueue: string): boolean {
  return remoteActivityBindings.has(taskQueue)
}
