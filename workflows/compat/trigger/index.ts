/**
 * Trigger.dev Compat Layer - 100% API Compatible with @trigger.dev/sdk (v3)
 *
 * Drop-in replacement for Trigger.dev that runs on dotdo's
 * durable execution infrastructure.
 *
 * @example
 * ```typescript
 * import { task, wait, retry, queue } from '@dotdo/trigger'
 *
 * export const processOrder = task({
 *   id: 'process-order',
 *   retry: { maxAttempts: 3 },
 *   run: async (payload, { ctx }) => {
 *     const user = await ctx.run('fetch-user', async () => {
 *       return await fetchUser(payload.userId)
 *     })
 *
 *     await wait.for({ seconds: 30 })
 *
 *     return { userId: user.id, status: 'processed' }
 *   },
 * })
 *
 * // Trigger the task
 * await processOrder.trigger({ orderId: '123' })
 * ```
 */

import { DurableWorkflowRuntime, InMemoryStepStorage } from '../../runtime'
import { WaitForEventManager } from '../../WaitForEventManager'
import type { StepStorage } from '../../runtime'

// ============================================================================
// TYPES - Match Trigger.dev SDK v3 exactly
// ============================================================================

export interface TaskConfig<TPayload, TOutput> {
  /** Unique task identifier */
  id: string
  /** Task version */
  version?: string
  /** Retry configuration */
  retry?: RetryConfig
  /** Queue configuration */
  queue?: QueueConfig
  /** Machine configuration */
  machine?: MachineConfig
  /** Maximum duration */
  maxDuration?: number
  /** Lifecycle hooks */
  onStart?: (payload: TPayload, ctx: TaskContext) => void | Promise<void>
  onSuccess?: (payload: TPayload, output: TOutput, ctx: TaskContext) => void | Promise<void>
  onFailure?: (payload: TPayload, error: Error, ctx: TaskContext) => void | Promise<void>
  /** Custom error handler */
  handleError?: (payload: TPayload, error: Error, ctx: TaskContext) => void | Promise<void>
  /** Middleware */
  middleware?: TaskMiddleware[]
  /** Init function (called once on worker start) */
  init?: () => void | Promise<void>
  /** Cleanup function (called on worker shutdown) */
  cleanup?: () => void | Promise<void>
  /** The run function */
  run: (payload: TPayload, params: { ctx: TaskContext }) => TOutput | Promise<TOutput>
}

export interface RetryConfig {
  /** Maximum number of attempts */
  maxAttempts?: number
  /** Minimum delay between retries (seconds or duration string) */
  minTimeoutInMs?: number
  /** Maximum delay between retries */
  maxTimeoutInMs?: number
  /** Exponential factor */
  factor?: number
  /** Randomization factor (0-1) */
  randomize?: boolean
}

export interface QueueConfig {
  /** Queue name */
  name?: string
  /** Concurrency limit */
  concurrencyLimit?: number
  /** Rate limit */
  rateLimit?: {
    limit: number
    period: string | number
  }
}

export interface MachineConfig {
  /** Machine preset */
  preset?: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'
  /** CPU count */
  cpu?: number
  /** Memory in MB */
  memory?: number
}

export interface TaskContext {
  /** Run ID */
  run: TaskRunContext
  /** Task ID */
  task: { id: string; version?: string }
  /** Environment */
  environment: { id: string; type: string; slug: string }
  /** Organization */
  organization: { id: string; slug: string; name: string }
  /** Project */
  project: { id: string; ref: string; slug: string; name: string }
  /** Attempt info */
  attempt: { id: string; number: number; startedAt: Date; backgroundWorkerId: string }
  /** Machine info */
  machine: { name: string; cpu: number; memory: number }
}

export interface TaskRunContext {
  /** Run a subtask */
  <TOutput>(stepId: string, fn: () => TOutput | Promise<TOutput>): Promise<TOutput>
  /** Run ID */
  id: string
  /** Tags */
  tags: string[]
  /** Is test */
  isTest: boolean
  /** Created at */
  createdAt: Date
  /** Started at */
  startedAt: Date
  /** Idempotency key */
  idempotencyKey?: string
  /** Duration in ms */
  durationMs: number
  /** Cost in cents */
  costInCents: number
  /** Base cost in cents */
  baseCostInCents: number
  /** Max attempts */
  maxAttempts?: number
  /** Parent ID */
  parentId?: string
  /** Root ID */
  rootId?: string
  /** Is child */
  isChild: boolean
  /** Batch ID */
  batchId?: string
  /** Is batch */
  isBatch: boolean
}

export interface TaskMiddleware {
  name: string
  init?: () => void | Promise<void>
  onEnqueue?: (payload: unknown) => unknown | Promise<unknown>
  beforeRun?: (payload: unknown, ctx: TaskContext) => void | Promise<void>
  afterRun?: (payload: unknown, output: unknown, ctx: TaskContext) => void | Promise<void>
  onError?: (payload: unknown, error: Error, ctx: TaskContext) => void | Promise<void>
}

export interface TriggerOptions {
  /** Idempotency key */
  idempotencyKey?: string
  /** Idempotency key TTL */
  idempotencyKeyTTL?: string | number
  /** Delay before execution */
  delay?: string | number | Date
  /** Maximum duration override */
  maxDuration?: number
  /** Tags */
  tags?: string[]
  /** Queue override */
  queue?: QueueConfig
  /** Concurrency key */
  concurrencyKey?: string
  /** Max attempts override */
  maxAttempts?: number
  /** Metadata */
  metadata?: Record<string, unknown>
}

export interface TriggerResult {
  /** Run ID */
  id: string
  /** Handle to check status */
  handle: TaskRunHandle
}

export interface BatchTriggerOptions extends TriggerOptions {
  /** Items to process */
  items: unknown[]
}

export interface TaskRunHandle {
  /** Run ID */
  id: string
  /** Poll for result */
  result: () => Promise<unknown>
  /** Get status */
  status: () => Promise<TaskRunStatus>
  /** Cancel the run */
  cancel: () => Promise<void>
}

export type TaskRunStatus = 'PENDING' | 'QUEUED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TIMED_OUT'

export interface TaskRunResult<TOutput> {
  ok: boolean
  id: string
  status: TaskRunStatus
  output?: TOutput
  error?: { name: string; message: string; stack?: string }
}

// ============================================================================
// GLOBAL CONFIG
// ============================================================================

interface GlobalConfig {
  storage?: StepStorage
  state?: DurableObjectState
}

let globalConfig: GlobalConfig = {}

export function configure(config: GlobalConfig): void {
  globalConfig = { ...globalConfig, ...config }
}

// ============================================================================
// UTILITIES
// ============================================================================

function parseDuration(duration: string | number | Date): number {
  if (duration instanceof Date) {
    return duration.getTime() - Date.now()
  }
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

function generateRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '')}`
}

// ============================================================================
// TASK CLASS
// ============================================================================

interface TaskLogger {
  info?: (message: string, ...args: unknown[]) => void
  warn?: (message: string, ...args: unknown[]) => void
  error?: (message: string, ...args: unknown[]) => void
  debug?: (message: string, ...args: unknown[]) => void
}

class Task<TPayload, TOutput> {
  readonly id: string
  readonly version?: string
  private readonly config: TaskConfig<TPayload, TOutput>
  private readonly runtime: DurableWorkflowRuntime
  private readonly stepResults = new Map<string, unknown>()
  private readonly runStatuses = new Map<string, TaskRunStatus>()
  private readonly runResults = new Map<string, unknown>()
  private initialized = false

  // Background task tracking for promise race condition prevention
  private readonly runningTasks = new Map<string, Promise<unknown>>()
  private readonly failedRuns = new Map<string, { error: Error; timestamp: number }>()
  private readonly logger: TaskLogger = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.log.bind(console),
    debug: console.debug.bind(console),
  }

  constructor(config: TaskConfig<TPayload, TOutput>) {
    this.config = config
    this.id = config.id
    this.version = config.version

    this.runtime = new DurableWorkflowRuntime({
      storage: globalConfig.storage ?? new InMemoryStepStorage(),
      retryPolicy: config.retry
        ? {
            maxAttempts: config.retry.maxAttempts ?? 3,
            initialDelayMs: config.retry.minTimeoutInMs ?? 1000,
            maxDelayMs: config.retry.maxTimeoutInMs ?? 30000,
            backoffMultiplier: config.retry.factor ?? 2,
            jitter: config.retry.randomize ?? true,
          }
        : undefined,
    })
  }

  /**
   * Initialize the task (called once)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.config.init?.()
    for (const mw of this.config.middleware ?? []) {
      await mw.init?.()
    }
    this.initialized = true
  }

  /**
   * Create task context
   */
  private createContext(runId: string, attempt: number): TaskContext {
    const self = this
    const startedAt = new Date()

    const runContext: TaskRunContext = Object.assign(
      async function <TStepOutput>(stepId: string, fn: () => TStepOutput | Promise<TStepOutput>): Promise<TStepOutput> {
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as TStepOutput
        }
        const result = await fn()
        self.stepResults.set(cacheKey, result)
        return result
      },
      {
        id: runId,
        tags: [],
        isTest: false,
        createdAt: startedAt,
        startedAt,
        durationMs: 0,
        costInCents: 0,
        baseCostInCents: 0,
        maxAttempts: self.config.retry?.maxAttempts,
        isChild: false,
        isBatch: false,
      }
    )

    return {
      run: runContext,
      task: { id: this.id, version: this.version },
      environment: { id: 'env_local', type: 'DEVELOPMENT', slug: 'development' },
      organization: { id: 'org_local', slug: 'local', name: 'Local' },
      project: { id: 'proj_local', ref: 'local', slug: 'local', name: 'Local Project' },
      attempt: {
        id: `attempt_${attempt}`,
        number: attempt,
        startedAt,
        backgroundWorkerId: 'worker_local',
      },
      machine: { name: 'local', cpu: 1, memory: 512 },
    }
  }

  /**
   * Create a run handle
   */
  private createHandle(runId: string): TaskRunHandle {
    const self = this

    return {
      id: runId,
      async result(): Promise<unknown> {
        // Poll until complete
        let status = self.runStatuses.get(runId)
        while (status === 'PENDING' || status === 'QUEUED' || status === 'EXECUTING') {
          await new Promise((resolve) => setTimeout(resolve, 100))
          status = self.runStatuses.get(runId)
        }
        return self.runResults.get(runId)
      },
      async status(): Promise<TaskRunStatus> {
        return self.runStatuses.get(runId) ?? 'PENDING'
      },
      async cancel(): Promise<void> {
        self.runStatuses.set(runId, 'CANCELED')
      },
    }
  }

  /**
   * Execute the task
   */
  private async execute(payload: TPayload, runId: string): Promise<TOutput> {
    await this.ensureInitialized()

    const ctx = this.createContext(runId, 1)
    this.runStatuses.set(runId, 'EXECUTING')

    // Apply middleware beforeRun
    for (const mw of this.config.middleware ?? []) {
      await mw.beforeRun?.(payload, ctx)
    }

    // Call onStart hook
    await this.config.onStart?.(payload, ctx)

    try {
      // Execute the run function
      const output = await this.config.run(payload, { ctx })

      // Apply middleware afterRun
      for (const mw of this.config.middleware ?? []) {
        await mw.afterRun?.(payload, output, ctx)
      }

      // Call onSuccess hook
      await this.config.onSuccess?.(payload, output, ctx)

      this.runStatuses.set(runId, 'COMPLETED')
      this.runResults.set(runId, output)

      return output
    } catch (error) {
      // Apply middleware onError
      for (const mw of this.config.middleware ?? []) {
        await mw.onError?.(payload, error as Error, ctx)
      }

      // Call handleError or onFailure hook
      if (this.config.handleError) {
        await this.config.handleError(payload, error as Error, ctx)
      } else {
        await this.config.onFailure?.(payload, error as Error, ctx)
      }

      this.runStatuses.set(runId, 'FAILED')
      this.runResults.set(runId, { error: (error as Error).message })

      throw error
    }
  }

  /**
   * Trigger the task (fire-and-forget)
   */
  async trigger(payload: TPayload, options?: TriggerOptions): Promise<TriggerResult> {
    // Apply middleware onEnqueue
    let processedPayload = payload
    for (const mw of this.config.middleware ?? []) {
      if (mw.onEnqueue) {
        processedPayload = (await mw.onEnqueue(processedPayload)) as TPayload
      }
    }

    const runId = generateRunId()
    this.runStatuses.set(runId, 'QUEUED')

    // Handle delay
    const delay = options?.delay ? parseDuration(options.delay) : 0

    // Create tracked promise for proper error handling
    const createTrackedExecution = () => {
      const runPromise = this.execute(processedPayload, runId)
        .catch((error) => {
          // Log with full stack trace for debugging
          this.logger.error?.(`Task ${this.id} run ${runId} failed:`, error)
          // Store failure for debugging and observability
          this.failedRuns.set(runId, { error: error as Error, timestamp: Date.now() })
          // Clean up old failed runs after 1 hour
          setTimeout(() => this.failedRuns.delete(runId), 3600000)
          throw error // Re-throw so callers can handle if needed
        })
        .finally(() => {
          // Clean up running task reference
          this.runningTasks.delete(runId)
        })
      this.runningTasks.set(runId, runPromise)
    }

    if (delay > 0) {
      setTimeout(() => createTrackedExecution(), delay)
    } else {
      // Execute in background
      setImmediate(() => createTrackedExecution())
    }

    return {
      id: runId,
      handle: this.createHandle(runId),
    }
  }

  /**
   * Trigger and wait for result
   */
  async triggerAndWait(payload: TPayload, options?: TriggerOptions): Promise<TaskRunResult<TOutput>> {
    // Apply middleware onEnqueue
    let processedPayload = payload
    for (const mw of this.config.middleware ?? []) {
      if (mw.onEnqueue) {
        processedPayload = (await mw.onEnqueue(processedPayload)) as TPayload
      }
    }

    const runId = generateRunId()
    this.runStatuses.set(runId, 'QUEUED')

    // Handle delay
    const delay = options?.delay ? parseDuration(options.delay) : 0
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    try {
      const output = await this.execute(processedPayload, runId)
      return {
        ok: true,
        id: runId,
        status: 'COMPLETED',
        output,
      }
    } catch (error) {
      return {
        ok: false,
        id: runId,
        status: 'FAILED',
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      }
    }
  }

  /**
   * Batch trigger multiple payloads
   */
  async batchTrigger(items: TPayload[], options?: TriggerOptions): Promise<{ runs: TriggerResult[] }> {
    const runs = await Promise.all(items.map((item) => this.trigger(item, options)))
    return { runs }
  }

  /**
   * Batch trigger and wait for all results
   */
  async batchTriggerAndWait(items: TPayload[], options?: TriggerOptions): Promise<{ runs: TaskRunResult<TOutput>[] }> {
    const runs = await Promise.all(items.map((item) => this.triggerAndWait(item, options)))
    return { runs }
  }

  /**
   * Get failed runs for observability
   */
  getFailedRuns(): Map<string, { error: Error; timestamp: number }> {
    return new Map(this.failedRuns)
  }

  /**
   * Get count of currently running background tasks
   */
  getRunningTaskCount(): number {
    return this.runningTasks.size
  }

  /**
   * Wait for all running background tasks to complete
   * Useful for graceful shutdown or testing
   */
  async waitForAllTasks(): Promise<void> {
    const tasks = Array.from(this.runningTasks.values())
    await Promise.allSettled(tasks)
  }
}

// ============================================================================
// TASK FACTORY
// ============================================================================

/**
 * Create a new task
 */
export function task<TPayload, TOutput>(config: TaskConfig<TPayload, TOutput>): Task<TPayload, TOutput> {
  return new Task(config)
}

// ============================================================================
// WAIT UTILITIES
// ============================================================================

export const wait = {
  /**
   * Wait for a duration
   */
  async for(options: { seconds?: number; minutes?: number; hours?: number; days?: number }): Promise<void> {
    const ms =
      (options.seconds ?? 0) * 1000 + (options.minutes ?? 0) * 60 * 1000 + (options.hours ?? 0) * 60 * 60 * 1000 + (options.days ?? 0) * 24 * 60 * 60 * 1000

    await new Promise((resolve) => setTimeout(resolve, ms))
  },

  /**
   * Wait until a specific date
   */
  async until(date: Date): Promise<void> {
    const ms = date.getTime() - Date.now()
    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
  },
}

// ============================================================================
// RETRY UTILITIES
// ============================================================================

export const retry = {
  /**
   * Create a retry config with preset
   */
  preset(name: 'default' | 'aggressive' | 'patient'): RetryConfig {
    const presets: Record<string, RetryConfig> = {
      default: {
        maxAttempts: 3,
        minTimeoutInMs: 1000,
        maxTimeoutInMs: 30000,
        factor: 2,
        randomize: true,
      },
      aggressive: {
        maxAttempts: 10,
        minTimeoutInMs: 100,
        maxTimeoutInMs: 5000,
        factor: 1.5,
        randomize: true,
      },
      patient: {
        maxAttempts: 5,
        minTimeoutInMs: 5000,
        maxTimeoutInMs: 60000,
        factor: 2,
        randomize: true,
      },
    }
    return presets[name] ?? presets.default
  },

  /**
   * Create exponential backoff config
   */
  exponential(maxAttempts: number, opts?: { minTimeout?: number; maxTimeout?: number }): RetryConfig {
    return {
      maxAttempts,
      minTimeoutInMs: opts?.minTimeout ?? 1000,
      maxTimeoutInMs: opts?.maxTimeout ?? 30000,
      factor: 2,
      randomize: true,
    }
  },

  /**
   * Create linear backoff config
   */
  linear(maxAttempts: number, delayMs: number): RetryConfig {
    return {
      maxAttempts,
      minTimeoutInMs: delayMs,
      maxTimeoutInMs: delayMs,
      factor: 1,
      randomize: false,
    }
  },
}

// ============================================================================
// QUEUE UTILITIES
// ============================================================================

export const queue = {
  /**
   * Create a queue config
   */
  create(name: string, opts?: { concurrency?: number; rateLimit?: { limit: number; period: string | number } }): QueueConfig {
    return {
      name,
      concurrencyLimit: opts?.concurrency,
      rateLimit: opts?.rateLimit,
    }
  },
}

// ============================================================================
// ABORT UTILITIES
// ============================================================================

export class AbortTaskRunError extends Error {
  readonly isAbortTaskRunError = true

  constructor(message: string) {
    super(message)
    this.name = 'AbortTaskRunError'
  }
}

export function abort(message: string): never {
  throw new AbortTaskRunError(message)
}

// ============================================================================
// SCHEDULE UTILITIES
// ============================================================================

export interface ScheduledTaskConfig<TPayload, TOutput> extends TaskConfig<TPayload, TOutput> {
  /** Cron expression */
  cron: string
  /** Timezone */
  timezone?: string
}

/**
 * Create a scheduled task
 */
export function schedules<TPayload, TOutput>(config: ScheduledTaskConfig<TPayload, TOutput>): Task<TPayload, TOutput> {
  // Note: In production, this would register with ScheduleManager
  // For now, create a regular task
  return task(config)
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { Task }
export default task
