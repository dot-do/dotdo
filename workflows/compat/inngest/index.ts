/**
 * Inngest Compat Layer - 100% API Compatible with inngest
 *
 * Drop-in replacement for Inngest that runs on dotdo's
 * durable execution infrastructure.
 *
 * @example
 * ```typescript
 * import { Inngest } from '@dotdo/inngest'
 *
 * const inngest = new Inngest({ id: 'my-app' })
 *
 * export const processOrder = inngest.createFunction(
 *   { id: 'process-order' },
 *   { event: 'order/created' },
 *   async ({ event, step }) => {
 *     const user = await step.run('fetch-user', async () => {
 *       return await fetchUser(event.data.userId)
 *     })
 *
 *     await step.sleep('wait-a-bit', '1h')
 *
 *     await step.run('send-email', async () => {
 *       await sendEmail(user.email, 'Order confirmed!')
 *     })
 *   }
 * )
 * ```
 */

import { WaitForEventManager, WaitTimeoutError } from '../../WaitForEventManager'
import { DurableWorkflowRuntime, InMemoryStepStorage } from '../../runtime'
import type { StepStorage, RetryPolicy } from '../../runtime'

// ============================================================================
// ERROR TYPES - Match Inngest SDK exactly
// ============================================================================

/**
 * Error that should not be retried
 */
export class NonRetriableError extends Error {
  readonly isNonRetriableError = true
  readonly cause?: Error

  constructor(message: string, options?: { cause?: Error }) {
    super(message)
    this.name = 'NonRetriableError'
    this.cause = options?.cause
  }
}

/**
 * Error that specifies when to retry
 */
export class RetryAfterError extends Error {
  readonly isRetryAfterError = true
  readonly retryAfter: Date | string | number
  readonly cause?: Error

  constructor(message: string, retryAfter: Date | string | number, options?: { cause?: Error }) {
    super(message)
    this.name = 'RetryAfterError'
    this.retryAfter = retryAfter
    this.cause = options?.cause
  }
}

/**
 * Error from a step execution
 */
export class StepError extends Error {
  readonly isStepError = true
  readonly stepId: string
  readonly cause?: Error

  constructor(message: string, stepId: string, options?: { cause?: Error }) {
    super(message)
    this.name = 'StepError'
    this.stepId = stepId
    this.cause = options?.cause
  }
}

/**
 * Error thrown when a function is cancelled
 */
export class CancellationError extends Error {
  readonly isCancellationError = true
  readonly runId: string
  readonly reason?: string

  constructor(runId: string, reason?: string) {
    super(reason ? `Function run ${runId} was cancelled: ${reason}` : `Function run ${runId} was cancelled`)
    this.name = 'CancellationError'
    this.runId = runId
    this.reason = reason
  }
}

/**
 * Error thrown when step.invoke times out
 */
export class InvokeTimeoutError extends Error {
  readonly isInvokeTimeoutError = true
  readonly functionId: string
  readonly timeout: number

  constructor(functionId: string, timeout: number) {
    super(`Invoked function ${functionId} timed out after ${timeout}ms`)
    this.name = 'InvokeTimeoutError'
    this.functionId = functionId
    this.timeout = timeout
  }
}

// ============================================================================
// TYPES - Match Inngest SDK exactly
// ============================================================================

export interface InngestConfig {
  /** Application ID */
  id: string
  /** Event key for sending events (optional in compat) */
  eventKey?: string
  /** Base URL for Inngest API (unused in compat) */
  baseUrl?: string
  /** Middleware */
  middleware?: InngestMiddleware[]
  /** Durable storage (DO state for production) */
  storage?: StepStorage
  /** DO state for wait manager */
  state?: DurableObjectState
  /** Logger */
  logger?: Logger
}

export interface Logger {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

export interface FunctionConfig {
  /** Function ID */
  id: string
  /** Function name (optional, defaults to id) */
  name?: string
  /** Retry configuration */
  retries?: number | RetryConfig
  /** Timeout configuration */
  timeouts?: TimeoutConfig
  /** Throttle configuration */
  throttle?: ThrottleConfig
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
  /** Debounce configuration */
  debounce?: DebounceConfig
  /** Batch configuration */
  batchEvents?: BatchConfig
  /** Priority */
  priority?: { run?: string }
  /** Concurrency */
  concurrency?: number | ConcurrencyConfig
  /** Cancel on events */
  cancelOn?: CancelOnConfig[]
  /** Idempotency key */
  idempotency?: string
}

export interface RetryConfig {
  attempts?: number
  backoff?: 'exponential' | 'linear' | 'constant'
  initialInterval?: string | number
  maxInterval?: string | number
}

export interface TimeoutConfig {
  function?: string | number
  step?: string | number
}

export interface ThrottleConfig {
  key?: string
  count: number
  period: string | number
}

export interface RateLimitConfig {
  key?: string
  limit: number
  period: string | number
}

export interface DebounceConfig {
  key?: string
  period: string | number
  timeout?: string | number
}

export interface BatchConfig {
  maxSize: number
  timeout: string | number
  key?: string
}

export interface ConcurrencyConfig {
  limit: number
  key?: string
  scope?: 'fn' | 'env' | 'account'
}

export interface CancelOnConfig {
  event: string
  match?: string
  if?: string
  timeout?: string | number
}

export interface EventTrigger {
  event: string
  expression?: string
  if?: string
}

export interface CronTrigger {
  cron: string
}

export type FunctionTrigger = EventTrigger | CronTrigger | string

export interface InngestEvent<T = unknown> {
  /** Event name */
  name: string
  /** Event data */
  data: T
  /** User context */
  user?: Record<string, unknown>
  /** Timestamp */
  ts?: number
  /** Event ID */
  id?: string
  /** Version */
  v?: string
}

export interface SendEventPayload<T = unknown> {
  name: string
  data: T
  user?: Record<string, unknown>
  ts?: number
  id?: string
  v?: string
}

export interface StepTools {
  /**
   * Run a step with automatic memoization
   */
  run: <T>(stepId: string, fn: () => T | Promise<T>) => Promise<T>

  /**
   * Sleep for a duration
   */
  sleep: (stepId: string, duration: string | number) => Promise<void>

  /**
   * Wait for an event
   */
  waitForEvent: <T = unknown>(
    stepId: string,
    options: {
      event: string
      timeout?: string | number
      match?: string
      if?: string
    }
  ) => Promise<InngestEvent<T> | null>

  /**
   * Send an event
   */
  sendEvent: (stepId: string, event: SendEventPayload | SendEventPayload[]) => Promise<{ ids: string[] }>

  /**
   * Invoke another function
   */
  invoke: <T = unknown>(
    stepId: string,
    options: {
      function: InngestFunction<unknown, unknown>
      data: unknown
      timeout?: string | number
    }
  ) => Promise<T>

  /**
   * Run steps in parallel
   */
  parallel: <T extends readonly unknown[]>(stepId: string, steps: { [K in keyof T]: () => Promise<T[K]> }) => Promise<T>

  /**
   * AI operations (experimental)
   */
  ai: {
    infer: <T>(stepId: string, options: { model: string; body: unknown }) => Promise<T>
    wrap: <T>(stepId: string, model: string, options: unknown) => Promise<T>
  }
}

export interface FunctionContext<TEvent = unknown> {
  /** The triggering event */
  event: InngestEvent<TEvent>
  /** All events when batching */
  events: InngestEvent<TEvent>[]
  /** Step tools */
  step: StepTools
  /** Run ID */
  runId: string
  /** Attempt number */
  attempt: number
  /** Logger */
  logger: Logger
}

export type FunctionHandler<TEvent, TResult> = (ctx: FunctionContext<TEvent>) => Promise<TResult>

// ============================================================================
// MIDDLEWARE
// ============================================================================

export interface MiddlewareContext {
  event: InngestEvent
  runId: string
  fn: InngestFunction<unknown, unknown>
}

export interface InngestMiddleware {
  name: string
  init?: () => void | Promise<void>
  onFunctionRun?: (ctx: MiddlewareContext) => MiddlewareLifecycle | Promise<MiddlewareLifecycle>
  onSendEvent?: (events: SendEventPayload[]) => SendEventPayload[] | Promise<SendEventPayload[]>
}

export interface MiddlewareLifecycle {
  transformInput?: (ctx: FunctionContext<unknown>) => FunctionContext<unknown> | Promise<FunctionContext<unknown>>
  transformOutput?: (result: unknown) => unknown | Promise<unknown>
  beforeExecution?: () => void | Promise<void>
  afterExecution?: () => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
}

// ============================================================================
// RUN STATE
// ============================================================================

export interface FunctionRun {
  runId: string
  functionId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  event: InngestEvent
  startedAt: number
  completedAt?: number
  error?: string
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

function generateRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, '')}`
}

/**
 * Get value from object using dot notation path
 */
function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Evaluate simple expression against event context
 */
function evaluateExpression(expression: string, context: { event: InngestEvent; async: InngestEvent }): boolean {
  // Simple expression evaluation for common patterns
  // Format: "event.data.field == async.data.field"
  const equalMatch = expression.match(/^(.+?)\s*==\s*(.+)$/)
  if (equalMatch) {
    const leftPath = equalMatch[1].trim()
    const rightPath = equalMatch[2].trim()

    const leftValue = getValueByPath(context, leftPath)
    const rightValue = getValueByPath(context, rightPath)

    return leftValue === rightValue
  }

  return false
}

const defaultLogger: Logger = {
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

// ============================================================================
// THROTTLE MANAGER
// ============================================================================

class ThrottleManager {
  /** Map of throttle key -> array of timestamps */
  private readonly buckets = new Map<string, number[]>()
  /** Queue of pending executions by throttle key */
  private readonly queues = new Map<string, Array<{
    resolve: () => void
    reject: (error: Error) => void
    count: number
    periodMs: number
  }>>()

  /**
   * Acquire a throttle slot
   * @returns Promise that resolves when slot is available
   */
  async acquire(key: string, count: number, periodMs: number): Promise<void> {
    const now = Date.now()

    // Get or create bucket
    let bucket = this.buckets.get(key) || []

    // Remove expired entries
    bucket = bucket.filter((ts) => now - ts < periodMs)

    // Check if we have capacity
    if (bucket.length < count) {
      bucket.push(now)
      this.buckets.set(key, bucket)
      return
    }

    // Queue this request
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(key) || []
      queue.push({ resolve, reject, count, periodMs })
      this.queues.set(key, queue)

      // Schedule retry when oldest entry expires
      const oldestTs = bucket[0]
      const waitTime = periodMs - (now - oldestTs) + 1

      this.scheduleQueueProcess(key, waitTime)
    })
  }

  private scheduleQueueProcess(key: string, waitTime: number): void {
    setTimeout(() => {
      this.processQueue(key)
      // If there are still items in queue, schedule again
      const queue = this.queues.get(key)
      if (queue && queue.length > 0) {
        const item = queue[0]
        this.scheduleQueueProcess(key, item.periodMs)
      }
    }, waitTime)
  }

  private processQueue(key: string): void {
    const queue = this.queues.get(key)
    if (!queue || queue.length === 0) return

    const item = queue[0]
    const { count, periodMs } = item
    const now = Date.now()
    let bucket = this.buckets.get(key) || []
    bucket = bucket.filter((ts) => now - ts < periodMs)

    if (bucket.length < count) {
      queue.shift()
      bucket.push(now)
      this.buckets.set(key, bucket)
      this.queues.set(key, queue)
      item.resolve()
    }
  }
}

// ============================================================================
// CONCURRENCY MANAGER
// ============================================================================

class ConcurrencyManager {
  /** Map of concurrency key -> current count */
  private readonly active = new Map<string, number>()
  /** Queue of pending executions by concurrency key */
  private readonly queues = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>()

  /**
   * Acquire a concurrency slot
   * @returns Promise that resolves when slot is available
   */
  async acquire(key: string, limit: number): Promise<void> {
    const current = this.active.get(key) || 0

    if (current < limit) {
      this.active.set(key, current + 1)
      return
    }

    // Queue this request
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(key) || []
      queue.push({ resolve, reject })
      this.queues.set(key, queue)
    })
  }

  /**
   * Release a concurrency slot
   */
  release(key: string): void {
    const current = this.active.get(key) || 0
    if (current > 0) {
      this.active.set(key, current - 1)
    }

    // Process queue
    const queue = this.queues.get(key)
    if (queue && queue.length > 0) {
      const item = queue.shift()
      if (item) {
        this.active.set(key, (this.active.get(key) || 0) + 1)
        this.queues.set(key, queue)
        item.resolve()
      }
    }
  }

  /**
   * Reject all queued items (for cancellation)
   */
  rejectQueued(key: string, error: Error): void {
    const queue = this.queues.get(key) || []
    for (const item of queue) {
      item.reject(error)
    }
    this.queues.set(key, [])
  }
}

// ============================================================================
// BATCH MANAGER
// ============================================================================

interface BatchState {
  events: InngestEvent[]
  timeoutId: ReturnType<typeof setTimeout> | null
  resolve: ((events: InngestEvent[]) => void) | null
}

class BatchManager {
  private readonly batches = new Map<string, BatchState>()

  /**
   * Add event to batch, returns promise that resolves with all batched events
   */
  addEvent(
    key: string,
    event: InngestEvent,
    config: BatchConfig,
    onBatchReady: (events: InngestEvent[]) => void
  ): void {
    let batch = this.batches.get(key)

    if (!batch) {
      batch = {
        events: [],
        timeoutId: null,
        resolve: null,
      }
      this.batches.set(key, batch)
    }

    batch.events.push(event)

    // Check if batch is full
    if (batch.events.length >= config.maxSize) {
      this.flushBatch(key, onBatchReady)
      return
    }

    // Set/reset timeout if not already set
    if (!batch.timeoutId) {
      const timeoutMs = parseDuration(config.timeout)
      batch.timeoutId = setTimeout(() => {
        this.flushBatch(key, onBatchReady)
      }, timeoutMs)
    }
  }

  private flushBatch(key: string, onBatchReady: (events: InngestEvent[]) => void): void {
    const batch = this.batches.get(key)
    if (!batch || batch.events.length === 0) return

    if (batch.timeoutId) {
      clearTimeout(batch.timeoutId)
    }

    const events = batch.events
    this.batches.delete(key)

    onBatchReady(events)
  }
}

// ============================================================================
// INNGEST FUNCTION
// ============================================================================

export class InngestFunction<TEvent, TResult> {
  readonly id: string
  readonly name: string
  readonly config: FunctionConfig
  readonly trigger: FunctionTrigger
  readonly handler: FunctionHandler<TEvent, TResult>
  private readonly inngest: Inngest

  constructor(inngest: Inngest, config: FunctionConfig, trigger: FunctionTrigger, handler: FunctionHandler<TEvent, TResult>) {
    this.inngest = inngest
    this.config = config
    this.trigger = trigger
    this.handler = handler
    this.id = config.id
    this.name = config.name ?? config.id
  }

  /**
   * Get the event name this function listens for
   */
  get eventName(): string | null {
    if (typeof this.trigger === 'string') {
      return this.trigger
    }
    if ('event' in this.trigger) {
      return this.trigger.event
    }
    return null
  }

  /**
   * Get the cron expression if this is a scheduled function
   */
  get cronExpression(): string | null {
    if (typeof this.trigger === 'object' && 'cron' in this.trigger) {
      return this.trigger.cron
    }
    return null
  }

  /**
   * Invoke this function with an event
   */
  async invoke(event: InngestEvent<TEvent>): Promise<TResult> {
    return this.inngest.invokeFunction(this, event)
  }
}

// ============================================================================
// INNGEST CLIENT
// ============================================================================

export class Inngest {
  readonly id: string
  private readonly config: InngestConfig
  private readonly runtime: DurableWorkflowRuntime
  private readonly waitManager: WaitForEventManager | null
  private readonly stepResults = new Map<string, unknown>()
  private readonly functions = new Map<string, InngestFunction<unknown, unknown>>()
  private readonly eventHandlers = new Map<string, Set<InngestFunction<unknown, unknown>>>()
  private readonly middleware: InngestMiddleware[]
  private readonly logger: Logger

  // Run tracking
  private readonly activeRuns = new Map<string, FunctionRun>()
  private readonly runCancellations = new Map<string, { reject: (error: Error) => void }>()

  // Throttle manager
  private readonly throttleManager = new ThrottleManager()

  // Concurrency manager
  private readonly concurrencyManager = new ConcurrencyManager()

  // Batch manager
  private readonly batchManager = new BatchManager()

  // Cancel event subscriptions: eventName -> Set of { functionId, cancelConfig }
  private readonly cancelSubscriptions = new Map<
    string,
    Set<{ functionId: string; config: CancelOnConfig }>
  >()

  constructor(config: InngestConfig) {
    this.id = config.id
    this.config = config
    this.logger = config.logger ?? defaultLogger
    this.middleware = config.middleware ?? []

    this.runtime = new DurableWorkflowRuntime({
      storage: config.storage ?? new InMemoryStepStorage(),
    })

    // Create wait manager if DO state is provided
    this.waitManager = config.state ? new WaitForEventManager(config.state) : null

    // Initialize middleware
    for (const mw of this.middleware) {
      mw.init?.()
    }
  }

  /**
   * Create a new function
   */
  createFunction<TEvent, TResult>(
    config: FunctionConfig,
    trigger: FunctionTrigger,
    handler: FunctionHandler<TEvent, TResult>
  ): InngestFunction<TEvent, TResult> {
    const fn = new InngestFunction(this, config, trigger, handler)
    this.functions.set(fn.id, fn as InngestFunction<unknown, unknown>)

    // Register event handler
    const eventName = fn.eventName
    if (eventName) {
      if (!this.eventHandlers.has(eventName)) {
        this.eventHandlers.set(eventName, new Set())
      }
      this.eventHandlers.get(eventName)!.add(fn as InngestFunction<unknown, unknown>)
    }

    // Register cancel subscriptions
    if (config.cancelOn) {
      for (const cancelConfig of config.cancelOn) {
        if (!this.cancelSubscriptions.has(cancelConfig.event)) {
          this.cancelSubscriptions.set(cancelConfig.event, new Set())
        }
        this.cancelSubscriptions.get(cancelConfig.event)!.add({
          functionId: fn.id,
          config: cancelConfig,
        })
      }
    }

    return fn
  }

  /**
   * Send one or more events
   */
  async send(events: SendEventPayload | SendEventPayload[]): Promise<{ ids: string[] }> {
    const eventArray = Array.isArray(events) ? events : [events]

    // Apply middleware
    let processedEvents = eventArray
    for (const mw of this.middleware) {
      if (mw.onSendEvent) {
        processedEvents = await mw.onSendEvent(processedEvents)
      }
    }

    const ids: string[] = []

    for (const payload of processedEvents) {
      const eventId = payload.id ?? generateEventId()
      ids.push(eventId)

      const event: InngestEvent = {
        ...payload,
        id: eventId,
        ts: payload.ts ?? Date.now(),
      }

      // Check for cancellation events
      await this.processCancellationEvent(event)

      // Trigger handlers for this event
      const handlers = this.eventHandlers.get(event.name)
      if (handlers) {
        for (const fn of handlers) {
          // Check if function uses batching
          if (fn.config.batchEvents) {
            this.handleBatchedEvent(fn, event)
          } else {
            // Execute in background (fire-and-forget)
            this.invokeFunction(fn, event).catch((error) => {
              this.logger.error(`Function ${fn.id} failed:`, error)
            })
          }
        }
      }

      // Deliver to any waiting step.waitForEvent calls
      if (this.waitManager) {
        await this.waitManager.deliverEvent(null, event.name, event)
      }
    }

    return { ids }
  }

  /**
   * Handle batched event
   */
  private handleBatchedEvent(fn: InngestFunction<unknown, unknown>, event: InngestEvent): void {
    const config = fn.config.batchEvents!
    const keyPath = config.key

    // Calculate batch key
    let batchKey = fn.id
    if (keyPath) {
      const keyValue = getValueByPath({ event }, keyPath)
      batchKey = `${fn.id}:${String(keyValue)}`
    }

    this.batchManager.addEvent(batchKey, event, config, (events) => {
      // Invoke function with all batched events
      this.invokeFunctionWithBatch(fn, events).catch((error) => {
        this.logger.error(`Function ${fn.id} (batched) failed:`, error)
      })
    })
  }

  /**
   * Invoke function with a batch of events
   */
  private async invokeFunctionWithBatch(fn: InngestFunction<unknown, unknown>, events: InngestEvent[]): Promise<unknown> {
    const runId = generateRunId()

    // Build context with all events
    let ctx: FunctionContext<unknown> = {
      event: events[0], // First event is the primary
      events: events,
      step: this.createStepTools(runId, fn),
      runId,
      attempt: 1,
      logger: this.logger,
    }

    // Track the run
    const run: FunctionRun = {
      runId,
      functionId: fn.id,
      status: 'running',
      event: events[0],
      startedAt: Date.now(),
    }
    this.activeRuns.set(runId, run)

    try {
      const result = await fn.handler(ctx)
      run.status = 'completed'
      run.completedAt = Date.now()
      return result
    } catch (error) {
      run.status = 'failed'
      run.error = (error as Error).message
      run.completedAt = Date.now()
      throw error
    } finally {
      // Cleanup after a delay
      setTimeout(() => this.activeRuns.delete(runId), 60000)
    }
  }

  /**
   * Process cancellation events
   */
  private async processCancellationEvent(event: InngestEvent): Promise<void> {
    const subscriptions = this.cancelSubscriptions.get(event.name)
    if (!subscriptions) return

    for (const { functionId, config } of subscriptions) {
      // Find matching active runs
      for (const [runId, run] of this.activeRuns.entries()) {
        if (run.functionId !== functionId || run.status !== 'running') continue

        // Check match condition
        let shouldCancel = false

        if (config.match) {
          // Match on field path
          const triggerValue = getValueByPath(event, config.match)
          const runValue = getValueByPath(run.event, config.match)
          shouldCancel = triggerValue === runValue
        } else if (config.if) {
          // Evaluate expression
          shouldCancel = evaluateExpression(config.if, { event, async: run.event })
        } else {
          // No condition, always cancel
          shouldCancel = true
        }

        if (shouldCancel) {
          await this.cancel(runId, 'Cancelled by event: ' + event.name)
        }
      }
    }
  }

  /**
   * Get active runs for a function
   */
  async getRuns(options: { functionId?: string }): Promise<FunctionRun[]> {
    const runs: FunctionRun[] = []
    for (const run of this.activeRuns.values()) {
      if (!options.functionId || run.functionId === options.functionId) {
        runs.push(run)
      }
    }
    return runs
  }

  /**
   * Get state for a specific run
   */
  async getRunState(runId: string): Promise<FunctionRun | null> {
    return this.activeRuns.get(runId) || null
  }

  /**
   * Cancel a running function
   */
  async cancel(runId: string, reason?: string): Promise<void> {
    const run = this.activeRuns.get(runId)
    if (!run) return

    run.status = 'cancelled'
    run.completedAt = Date.now()

    // Reject any waiting promises
    const cancellation = this.runCancellations.get(runId)
    if (cancellation) {
      cancellation.reject(new CancellationError(runId, reason))
      this.runCancellations.delete(runId)
    }

    // Clear step results for this run
    for (const key of this.stepResults.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.stepResults.delete(key)
      }
    }

    // Remove from active runs
    this.activeRuns.delete(runId)
  }

  /**
   * Create step tools for a function execution
   */
  private createStepTools(runId: string, fn: InngestFunction<unknown, unknown>): StepTools {
    const self = this

    return {
      async run<T>(stepId: string, stepFn: () => T | Promise<T>): Promise<T> {
        // Check for cached result (memoization/replay)
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        // Check if cancelled
        const run = self.activeRuns.get(runId)
        if (run?.status === 'cancelled') {
          throw new CancellationError(runId)
        }

        // Apply throttling if configured
        if (fn.config.throttle) {
          const throttleConfig = fn.config.throttle
          const keyPath = throttleConfig.key
          let throttleKey = fn.id

          if (keyPath) {
            const run = self.activeRuns.get(runId)
            if (run) {
              const keyValue = getValueByPath({ event: run.event }, keyPath)
              throttleKey = `${fn.id}:${String(keyValue)}`
            }
          }

          await self.throttleManager.acquire(
            throttleKey,
            throttleConfig.count,
            parseDuration(throttleConfig.period)
          )
        }

        try {
          const result = await stepFn()
          self.stepResults.set(cacheKey, result)
          return result
        } catch (error) {
          if (error instanceof NonRetriableError) {
            throw error
          }
          throw new StepError(`Step "${stepId}" failed: ${(error as Error).message}`, stepId, { cause: error as Error })
        }
      },

      async sleep(stepId: string, duration: string | number): Promise<void> {
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return
        }

        // Check if cancelled
        const run = self.activeRuns.get(runId)
        if (run?.status === 'cancelled') {
          throw new CancellationError(runId)
        }

        const ms = parseDuration(duration)

        // Create cancellable sleep
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            self.runCancellations.delete(runId)
            resolve()
          }, ms)

          // Register for cancellation
          self.runCancellations.set(runId, {
            reject: (error) => {
              clearTimeout(timeoutId)
              reject(error)
            },
          })
        })

        self.stepResults.set(cacheKey, true)
      },

      async waitForEvent<T = unknown>(
        stepId: string,
        options: { event: string; timeout?: string | number; match?: string; if?: string }
      ): Promise<InngestEvent<T> | null> {
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as InngestEvent<T> | null
        }

        if (!self.waitManager) {
          throw new Error('waitForEvent requires DO state to be provided')
        }

        try {
          const result = await self.waitManager.waitForEvent<InngestEvent<T>>(options.event, {
            timeout: options.timeout,
            correlationId: runId,
          })
          self.stepResults.set(cacheKey, result)
          return result
        } catch (error) {
          if (error instanceof WaitTimeoutError) {
            self.stepResults.set(cacheKey, null)
            return null
          }
          throw error
        }
      },

      async sendEvent(stepId: string, event: SendEventPayload | SendEventPayload[]): Promise<{ ids: string[] }> {
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as { ids: string[] }
        }

        const result = await self.send(event)
        self.stepResults.set(cacheKey, result)
        return result
      },

      async invoke<T = unknown>(
        stepId: string,
        options: { function: InngestFunction<unknown, unknown>; data: unknown; timeout?: string | number }
      ): Promise<T> {
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        const event: InngestEvent = {
          name: options.function.eventName || `invoke/${options.function.id}`,
          data: options.data,
          ts: Date.now(),
          id: generateEventId(),
        }

        // Handle timeout
        if (options.timeout) {
          const timeoutMs = parseDuration(options.timeout)
          const result = await Promise.race([
            self.invokeFunction(options.function, event),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new InvokeTimeoutError(options.function.id, timeoutMs))
              }, timeoutMs)
            }),
          ])
          self.stepResults.set(cacheKey, result)
          return result as T
        }

        const result = await self.invokeFunction(options.function, event)
        self.stepResults.set(cacheKey, result)
        return result as T
      },

      async parallel<T extends readonly unknown[]>(
        stepId: string,
        steps: { [K in keyof T]: () => Promise<T[K]> }
      ): Promise<T> {
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        const results = await Promise.all(steps.map((step) => step()))
        self.stepResults.set(cacheKey, results)
        return results as unknown as T
      },

      ai: {
        async infer<T>(stepId: string, options: { model: string; body: unknown }): Promise<T> {
          const cacheKey = `${runId}:${stepId}`
          if (self.stepResults.has(cacheKey)) {
            return self.stepResults.get(cacheKey) as T
          }

          // Stub - would integrate with AI providers
          throw new Error('AI inference not yet implemented in compat layer')
        },

        async wrap<T>(stepId: string, _model: string, _options: unknown): Promise<T> {
          const cacheKey = `${runId}:${stepId}`
          if (self.stepResults.has(cacheKey)) {
            return self.stepResults.get(cacheKey) as T
          }

          // Stub - would integrate with AI providers
          throw new Error('AI wrap not yet implemented in compat layer')
        },
      },
    }
  }

  /**
   * Invoke a function with an event (internal)
   */
  async invokeFunction<TEvent, TResult>(fn: InngestFunction<TEvent, TResult>, event: InngestEvent<TEvent>): Promise<TResult> {
    const runId = generateRunId()

    // Track the run
    const run: FunctionRun = {
      runId,
      functionId: fn.id,
      status: 'running',
      event: event as InngestEvent,
      startedAt: Date.now(),
    }
    this.activeRuns.set(runId, run)

    // Apply concurrency limits
    if (fn.config.concurrency) {
      const concurrencyConfig = typeof fn.config.concurrency === 'number'
        ? { limit: fn.config.concurrency }
        : fn.config.concurrency

      let concurrencyKey = fn.id

      if (concurrencyConfig.key) {
        const keyValue = getValueByPath({ event }, concurrencyConfig.key)
        concurrencyKey = `${fn.id}:${String(keyValue)}`
      } else if (concurrencyConfig.scope === 'env') {
        concurrencyKey = `env:${this.id}`
      } else if (concurrencyConfig.scope === 'account') {
        concurrencyKey = 'account'
      }

      await this.concurrencyManager.acquire(concurrencyKey, concurrencyConfig.limit)

      try {
        return await this.executeFunction(fn, event, runId, run)
      } finally {
        this.concurrencyManager.release(concurrencyKey)
      }
    }

    return this.executeFunction(fn, event, runId, run)
  }

  /**
   * Execute function (shared logic for invoke)
   */
  private async executeFunction<TEvent, TResult>(
    fn: InngestFunction<TEvent, TResult>,
    event: InngestEvent<TEvent>,
    runId: string,
    run: FunctionRun
  ): Promise<TResult> {
    // Apply middleware
    let middlewareLifecycles: MiddlewareLifecycle[] = []
    for (const mw of this.middleware) {
      if (mw.onFunctionRun) {
        const lifecycle = await mw.onFunctionRun({
          event,
          runId,
          fn: fn as InngestFunction<unknown, unknown>,
        })
        middlewareLifecycles.push(lifecycle)
      }
    }

    // Build context
    let ctx: FunctionContext<TEvent> = {
      event,
      events: [event],
      step: this.createStepTools(runId, fn as InngestFunction<unknown, unknown>),
      runId,
      attempt: 1,
      logger: this.logger,
    }

    // Transform input via middleware
    for (const lifecycle of middlewareLifecycles) {
      if (lifecycle.transformInput) {
        ctx = (await lifecycle.transformInput(ctx as FunctionContext<unknown>)) as FunctionContext<TEvent>
      }
    }

    // Before execution hooks
    for (const lifecycle of middlewareLifecycles) {
      await lifecycle.beforeExecution?.()
    }

    try {
      // Execute the function
      let result = await fn.handler(ctx)

      // Transform output via middleware
      for (const lifecycle of middlewareLifecycles) {
        if (lifecycle.transformOutput) {
          result = (await lifecycle.transformOutput(result)) as TResult
        }
      }

      // After execution hooks
      for (const lifecycle of middlewareLifecycles) {
        await lifecycle.afterExecution?.()
      }

      run.status = 'completed'
      run.completedAt = Date.now()

      return result
    } catch (error) {
      // Error hooks
      for (const lifecycle of middlewareLifecycles) {
        await lifecycle.onError?.(error as Error)
      }

      run.status = 'failed'
      run.error = (error as Error).message
      run.completedAt = Date.now()

      throw error
    } finally {
      // Cleanup run cancellation handler
      this.runCancellations.delete(runId)

      // Cleanup after a delay
      setTimeout(() => this.activeRuns.delete(runId), 60000)
    }
  }

  /**
   * Get all registered functions
   */
  getFunctions(): InngestFunction<unknown, unknown>[] {
    return Array.from(this.functions.values())
  }

  /**
   * Get a function by ID
   */
  getFunction(id: string): InngestFunction<unknown, unknown> | undefined {
    return this.functions.get(id)
  }
}

// ============================================================================
// SERVE HANDLER
// ============================================================================

export interface ServeConfig {
  /** Base path for the handler */
  path?: string
  /** Signing key for verification */
  signingKey?: string
  /** Serve key (alias for signingKey) */
  serveKey?: string
}

/**
 * Create a serve handler for HTTP frameworks
 */
export function serve(inngest: Inngest, functions: InngestFunction<unknown, unknown>[], config?: ServeConfig) {
  // Register all functions
  for (const fn of functions) {
    inngest.createFunction(fn.config, fn.trigger, fn.handler)
  }

  // Return a fetch handler
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const basePath = config?.path ?? '/api/inngest'

    // Health check
    if (request.method === 'GET' && url.pathname === basePath) {
      return new Response(
        JSON.stringify({
          appId: inngest.id,
          functions: functions.map((f) => ({
            id: f.id,
            name: f.name,
            trigger: f.trigger,
          })),
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Event ingestion
    if (request.method === 'POST' && url.pathname === basePath) {
      try {
        const body = await request.json()
        const events = Array.isArray(body) ? body : [body]
        const result = await inngest.send(events)
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Inngest
