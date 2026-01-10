/**
 * ActivityRouter - Reusable activity routing abstraction
 *
 * Provides a unified interface for routing activity invocations across
 * different compat layers (Temporal, Inngest, QStash, Trigger.dev).
 *
 * ## Architecture
 *
 * 1. **ActivityRouter interface** - Core abstraction for routing activities
 * 2. **WorkerActivityRouter** - Routes to registered worker handlers
 * 3. **DurableActivityRouter** - Wraps another router with CF Workflows durability
 *
 * ## Usage
 *
 * ```typescript
 * import { WorkerActivityRouter, DurableActivityRouter } from '@dotdo/workflows/compat'
 *
 * // Create a worker-based router
 * const workerRouter = new WorkerActivityRouter()
 *
 * // Register workers
 * const unregister = workerRouter.registerWorker('email-queue', {
 *   executeActivity: async (name, args) => {
 *     // Handle activity execution
 *   }
 * })
 *
 * // Wrap with durability for CF Workflows
 * const durableRouter = new DurableActivityRouter(workerRouter, step)
 *
 * // Route an activity
 * const result = await durableRouter.route('sendEmail', [to, subject, body], {
 *   timeout: 10000,
 *   taskQueue: 'email-queue'
 * })
 * ```
 */

import type { WorkflowStep, StepDoOptions } from '../../lib/cloudflare/workflows'
import { parseDuration, ensureError } from './utils'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Retry options for activity execution
 */
export interface ActivityRetryOptions {
  /** Maximum number of retry attempts */
  maximumAttempts?: number
  /** Initial interval between retries (ms or duration string) */
  initialInterval?: number | string
  /** Backoff coefficient for exponential backoff */
  backoffCoefficient?: number
  /** Maximum interval between retries (ms or duration string) */
  maximumInterval?: number | string
  /** Error types that should not be retried */
  nonRetryableErrors?: string[]
}

/**
 * Options for routing an activity
 */
export interface ActivityRouterOptions {
  /** Target task queue for the activity */
  taskQueue?: string
  /** Start-to-close timeout in milliseconds */
  timeout?: number
  /** Retry policy */
  retries?: ActivityRetryOptions
}

/**
 * Context passed to activity execution
 */
export interface ActivityContext {
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Core interface for activity routing
 *
 * Implementations can route activities to:
 * - Registered worker handlers (WorkerActivityRouter)
 * - CF Workflows step.do() (DurableActivityRouter)
 * - Remote execution endpoints
 */
export interface ActivityRouter {
  /**
   * Route an activity invocation to its handler
   *
   * @param activityName - Name of the activity to execute
   * @param args - Arguments to pass to the activity
   * @param options - Routing options (task queue, timeout, retries)
   * @param context - Execution context (cancellation signal)
   * @returns Promise resolving to the activity result
   */
  route<T>(
    activityName: string,
    args: unknown[],
    options?: ActivityRouterOptions,
    context?: ActivityContext
  ): Promise<T>
}

/**
 * Handler for executing activities on a worker
 */
export interface WorkerHandler {
  /** Registered workflow types this worker handles */
  workflowTypes?: Set<string>
  /** Registered activity types this worker handles */
  activityTypes?: Set<string>
  /** Custom handler for executing workflows */
  executeWorkflow?: (workflowType: string, args: unknown[]) => Promise<unknown>
  /** Custom handler for executing activities */
  executeActivity?: (activityName: string, args: unknown[], context?: ActivityContext) => Promise<unknown>
}

// ============================================================================
// TIMEOUT ERROR
// ============================================================================

/**
 * Error thrown when an activity exceeds its timeout
 */
export class ActivityTimeoutError extends Error {
  readonly activityName: string
  readonly timeoutMs: number
  readonly timeoutType: 'startToClose' | 'scheduleToClose' | 'heartbeat'

  constructor(
    activityName: string,
    timeoutMs: number,
    timeoutType: 'startToClose' | 'scheduleToClose' | 'heartbeat' = 'startToClose'
  ) {
    super(`Activity ${activityName} timed out after ${timeoutMs}ms (${timeoutType} timeout)`)
    this.name = 'ActivityTimeoutError'
    this.activityName = activityName
    this.timeoutMs = timeoutMs
    this.timeoutType = timeoutType
  }
}

/**
 * Error thrown when no worker is registered for a task queue
 */
export class TaskQueueNotRegisteredError extends Error {
  readonly taskQueue: string
  readonly type: 'workflow' | 'activity'

  constructor(taskQueue: string, type: 'workflow' | 'activity' = 'activity') {
    super(
      `No worker registered for task queue "${taskQueue}". ` +
        `Ensure a worker is polling this queue before starting ${type === 'workflow' ? 'workflows' : 'activities'}.`
    )
    this.name = 'TaskQueueNotRegisteredError'
    this.taskQueue = taskQueue
    this.type = type
  }
}

// ============================================================================
// WORKER ACTIVITY ROUTER
// ============================================================================

/**
 * Routes activities to registered worker handlers.
 *
 * This router maintains a registry of workers by task queue and routes
 * activity invocations to the appropriate handler. It handles:
 *
 * - Task queue validation
 * - Timeout enforcement
 * - Retry logic with exponential backoff
 * - Error classification (retryable vs non-retryable)
 *
 * @example
 * ```typescript
 * const router = new WorkerActivityRouter()
 *
 * // Register a worker
 * const unregister = router.registerWorker('my-queue', {
 *   activityTypes: new Set(['sendEmail', 'processPayment']),
 *   executeActivity: async (name, args) => {
 *     switch (name) {
 *       case 'sendEmail': return sendEmail(...args)
 *       case 'processPayment': return processPayment(...args)
 *     }
 *   }
 * })
 *
 * // Route activity
 * const result = await router.route('sendEmail', [to, subject], {
 *   taskQueue: 'my-queue',
 *   timeout: 10000
 * })
 *
 * // Cleanup
 * unregister()
 * ```
 */
export class WorkerActivityRouter implements ActivityRouter {
  private workers = new Map<string, WorkerHandler>()

  /**
   * Register a worker for a task queue
   *
   * @param taskQueue - Name of the task queue
   * @param handler - Worker handler configuration
   * @returns Function to unregister the worker
   */
  registerWorker(taskQueue: string, handler: WorkerHandler = {}): () => void {
    if (!taskQueue || typeof taskQueue !== 'string') {
      throw new Error('Task queue name must be a non-empty string')
    }

    this.workers.set(taskQueue, {
      workflowTypes: handler.workflowTypes ?? new Set(),
      activityTypes: handler.activityTypes ?? new Set(),
      executeWorkflow: handler.executeWorkflow,
      executeActivity: handler.executeActivity,
    })

    return () => {
      this.workers.delete(taskQueue)
    }
  }

  /**
   * Check if a worker is registered for a task queue
   */
  hasWorker(taskQueue: string): boolean {
    return this.workers.has(taskQueue)
  }

  /**
   * Get the worker handler for a task queue
   */
  getWorker(taskQueue: string): WorkerHandler | undefined {
    return this.workers.get(taskQueue)
  }

  /**
   * List all registered task queues
   */
  listTaskQueues(): string[] {
    return Array.from(this.workers.keys())
  }

  /**
   * Check if task queue routing is enabled (at least one worker registered)
   */
  isRoutingEnabled(): boolean {
    return this.workers.size > 0
  }

  /**
   * Clear all registered workers
   */
  clear(): void {
    this.workers.clear()
  }

  /**
   * Route an activity to its registered handler
   */
  async route<T>(
    activityName: string,
    args: unknown[],
    options?: ActivityRouterOptions,
    context?: ActivityContext
  ): Promise<T> {
    const taskQueue = options?.taskQueue ?? 'default'

    // Validate task queue if routing is enabled
    if (this.isRoutingEnabled()) {
      const worker = this.workers.get(taskQueue)
      if (!worker) {
        throw new TaskQueueNotRegisteredError(taskQueue, 'activity')
      }

      // Validate activity type if worker specifies types
      if (worker.activityTypes && worker.activityTypes.size > 0) {
        if (!worker.activityTypes.has(activityName)) {
          throw new Error(
            `Activity "${activityName}" is not registered on task queue "${taskQueue}". ` +
              `Registered activities: ${Array.from(worker.activityTypes).join(', ')}`
          )
        }
      }

      // Route to worker's executeActivity handler
      if (worker.executeActivity) {
        return this.executeWithOptions<T>(
          () => worker.executeActivity!(activityName, args, context),
          activityName,
          options
        )
      }
    }

    // No handler registered - this is an error in production
    // but allows for stubbed execution in test mode
    throw new Error(
      `No executeActivity handler registered for task queue "${taskQueue}". ` +
        `Activity "${activityName}" cannot be executed.`
    )
  }

  /**
   * Execute activity with timeout and retry handling
   */
  private async executeWithOptions<T>(
    activityFn: () => Promise<unknown>,
    activityName: string,
    options?: ActivityRouterOptions
  ): Promise<T> {
    const timeoutMs = options?.timeout
    const retry = options?.retries

    // If no retry configured, execute once with timeout
    if (!retry || (retry.maximumAttempts ?? 1) <= 1) {
      return this.executeWithTimeout<T>(activityFn, activityName, timeoutMs)
    }

    // Execute with retries
    return this.executeWithRetry<T>(activityFn, activityName, retry, timeoutMs)
  }

  /**
   * Execute with timeout handling
   */
  private async executeWithTimeout<T>(
    activityFn: () => Promise<unknown>,
    activityName: string,
    timeoutMs?: number
  ): Promise<T> {
    if (!timeoutMs) {
      return activityFn() as Promise<T>
    }

    return Promise.race([
      activityFn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new ActivityTimeoutError(activityName, timeoutMs, 'startToClose'))
        }, timeoutMs)
      }),
    ]) as Promise<T>
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry<T>(
    activityFn: () => Promise<unknown>,
    activityName: string,
    retry: ActivityRetryOptions,
    timeoutMs?: number
  ): Promise<T> {
    const maxAttempts = retry.maximumAttempts ?? 1
    const initialInterval = retry.initialInterval
      ? (typeof retry.initialInterval === 'number' ? retry.initialInterval : parseDuration(retry.initialInterval))
      : 100
    const backoffCoefficient = retry.backoffCoefficient ?? 2
    const maximumInterval = retry.maximumInterval
      ? (typeof retry.maximumInterval === 'number' ? retry.maximumInterval : parseDuration(retry.maximumInterval))
      : 100000
    const nonRetryableTypes = retry.nonRetryableErrors

    let delay = initialInterval
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.executeWithTimeout<T>(activityFn, activityName, timeoutMs)
      } catch (error) {
        lastError = ensureError(error)

        // Check if error is non-retryable
        if (this.isNonRetryableError(error, nonRetryableTypes)) {
          throw error
        }

        // Check if we've exhausted all attempts
        if (attempt >= maxAttempts) {
          throw error
        }

        // Wait with jittered backoff before retrying
        const jitteredDelay = this.calculateJitteredDelay(delay)
        await this.sleepMs(jitteredDelay)

        // Calculate next delay with backoff, capped at maximum
        delay = Math.min(delay * backoffCoefficient, maximumInterval)
      }
    }

    throw lastError ?? new Error(`Activity ${activityName} failed after ${maxAttempts} attempts`)
  }

  /**
   * Check if an error is non-retryable
   */
  private isNonRetryableError(error: unknown, nonRetryableTypes?: string[]): boolean {
    if (!nonRetryableTypes || nonRetryableTypes.length === 0) {
      return false
    }
    const errorName = error instanceof Error ? error.name : 'Error'
    return nonRetryableTypes.includes(errorName)
  }

  /**
   * Calculate jittered delay for retries
   */
  private calculateJitteredDelay(baseDelay: number): number {
    // Add -20% to +20% jitter
    const jitterFactor = 0.8 + Math.random() * 0.4
    return Math.floor(baseDelay * jitterFactor)
  }

  /**
   * Sleep for a duration (non-workflow context)
   */
  private sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// DURABLE ACTIVITY ROUTER
// ============================================================================

/**
 * Wraps another ActivityRouter with CF Workflows durability.
 *
 * Each activity invocation is wrapped in a step.do() call, which provides:
 * - Automatic retry on worker restart
 * - Result caching for replay
 * - Billing-efficient execution (free waits)
 *
 * @example
 * ```typescript
 * // In a CF Workflows run() method:
 * async run(event: WorkflowEvent, step: WorkflowStep) {
 *   const workerRouter = new WorkerActivityRouter()
 *   const durableRouter = new DurableActivityRouter(workerRouter, step)
 *
 *   // This activity call is durable - survives worker restarts
 *   const result = await durableRouter.route('processOrder', [orderId])
 * }
 * ```
 */
export class DurableActivityRouter implements ActivityRouter {
  constructor(
    private inner: ActivityRouter,
    private step: WorkflowStep
  ) {}

  /**
   * Route an activity with CF Workflows durability
   */
  async route<T>(
    activityName: string,
    args: unknown[],
    options?: ActivityRouterOptions,
    context?: ActivityContext
  ): Promise<T> {
    // Generate a deterministic step ID based on activity name and args
    const argsStr = JSON.stringify(args)
    const stepId = `activity:${options?.taskQueue ?? 'default'}:${activityName}:${argsStr.slice(0, 100)}`

    // Build step.do() options from router options
    const stepOptions = this.buildStepDoOptions(options)

    // Wrap the inner router call in step.do() for durability
    return this.step.do(stepId, stepOptions, async () => {
      return this.inner.route<T>(activityName, args, options, context)
    }) as Promise<T>
  }

  /**
   * Build CF Workflows step.do() options from router options
   */
  private buildStepDoOptions(options?: ActivityRouterOptions): StepDoOptions | undefined {
    if (!options) return undefined

    const stepOptions: StepDoOptions = {}

    // Map retry policy
    if (options.retries?.maximumAttempts) {
      stepOptions.retries = {
        limit: options.retries.maximumAttempts,
        backoff: (options.retries.backoffCoefficient ?? 2) > 1 ? 'exponential' : 'constant',
        delay: options.retries.initialInterval
          ? String(options.retries.initialInterval)
          : undefined,
      }
    }

    // Map timeout
    if (options.timeout) {
      stepOptions.timeout = this.formatDuration(options.timeout)
    }

    // Only return options if we have something to configure
    if (stepOptions.retries || stepOptions.timeout) {
      return stepOptions
    }
    return undefined
  }

  /**
   * Format a duration in milliseconds to CF Workflows format
   */
  private formatDuration(ms: number): string {
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
}

// ============================================================================
// ACTIVITY METRICS
// ============================================================================

/**
 * Metrics for activity execution
 */
export interface ActivityMetrics {
  /** Total number of activity executions */
  executionCount: number
  /** Number of successful executions */
  successCount: number
  /** Number of failed executions */
  errorCount: number
  /** Number of timeouts */
  timeoutCount: number
  /** Latency statistics in milliseconds */
  latency: {
    /** Minimum latency */
    min: number
    /** Maximum latency */
    max: number
    /** Sum of all latencies (for computing average) */
    sum: number
    /** Number of samples */
    count: number
  }
  /** Per-activity breakdown */
  byActivity: Map<string, {
    executionCount: number
    successCount: number
    errorCount: number
    avgLatencyMs: number
  }>
}

/**
 * Interface for collecting activity metrics
 */
export interface ActivityMetricsCollector {
  /** Record a successful activity execution */
  recordSuccess(activityName: string, durationMs: number): void
  /** Record a failed activity execution */
  recordError(activityName: string, durationMs: number, error: Error): void
  /** Record a timeout */
  recordTimeout(activityName: string, durationMs: number): void
  /** Get current metrics snapshot */
  getMetrics(): ActivityMetrics
  /** Reset all metrics */
  reset(): void
}

/**
 * In-memory implementation of ActivityMetricsCollector
 */
export class InMemoryActivityMetrics implements ActivityMetricsCollector {
  private executionCount = 0
  private successCount = 0
  private errorCount = 0
  private timeoutCount = 0
  private latencyMin = Infinity
  private latencyMax = 0
  private latencySum = 0
  private latencyCount = 0
  private byActivity = new Map<string, {
    executionCount: number
    successCount: number
    errorCount: number
    latencySum: number
    latencyCount: number
  }>()

  recordSuccess(activityName: string, durationMs: number): void {
    this.executionCount++
    this.successCount++
    this.updateLatency(durationMs)
    this.updateActivityMetrics(activityName, durationMs, true)
  }

  recordError(activityName: string, durationMs: number, _error: Error): void {
    this.executionCount++
    this.errorCount++
    this.updateLatency(durationMs)
    this.updateActivityMetrics(activityName, durationMs, false)
  }

  recordTimeout(activityName: string, durationMs: number): void {
    this.executionCount++
    this.timeoutCount++
    this.errorCount++
    this.updateLatency(durationMs)
    this.updateActivityMetrics(activityName, durationMs, false)
  }

  getMetrics(): ActivityMetrics {
    const byActivity = new Map<string, {
      executionCount: number
      successCount: number
      errorCount: number
      avgLatencyMs: number
    }>()

    this.byActivity.forEach((data, name) => {
      byActivity.set(name, {
        executionCount: data.executionCount,
        successCount: data.successCount,
        errorCount: data.errorCount,
        avgLatencyMs: data.latencyCount > 0 ? data.latencySum / data.latencyCount : 0,
      })
    })

    return {
      executionCount: this.executionCount,
      successCount: this.successCount,
      errorCount: this.errorCount,
      timeoutCount: this.timeoutCount,
      latency: {
        min: this.latencyMin === Infinity ? 0 : this.latencyMin,
        max: this.latencyMax,
        sum: this.latencySum,
        count: this.latencyCount,
      },
      byActivity,
    }
  }

  reset(): void {
    this.executionCount = 0
    this.successCount = 0
    this.errorCount = 0
    this.timeoutCount = 0
    this.latencyMin = Infinity
    this.latencyMax = 0
    this.latencySum = 0
    this.latencyCount = 0
    this.byActivity.clear()
  }

  private updateLatency(durationMs: number): void {
    this.latencyMin = Math.min(this.latencyMin, durationMs)
    this.latencyMax = Math.max(this.latencyMax, durationMs)
    this.latencySum += durationMs
    this.latencyCount++
  }

  private updateActivityMetrics(activityName: string, durationMs: number, success: boolean): void {
    let data = this.byActivity.get(activityName)
    if (!data) {
      data = { executionCount: 0, successCount: 0, errorCount: 0, latencySum: 0, latencyCount: 0 }
      this.byActivity.set(activityName, data)
    }
    data.executionCount++
    if (success) {
      data.successCount++
    } else {
      data.errorCount++
    }
    data.latencySum += durationMs
    data.latencyCount++
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new WorkerActivityRouter instance
 */
export function createWorkerRouter(): WorkerActivityRouter {
  return new WorkerActivityRouter()
}

/**
 * Create a DurableActivityRouter that wraps another router
 */
export function createDurableRouter(inner: ActivityRouter, step: WorkflowStep): DurableActivityRouter {
  return new DurableActivityRouter(inner, step)
}

/**
 * Create a new InMemoryActivityMetrics instance
 */
export function createMetricsCollector(): InMemoryActivityMetrics {
  return new InMemoryActivityMetrics()
}
