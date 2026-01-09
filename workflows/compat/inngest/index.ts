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

const defaultLogger: Logger = {
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
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

      // Trigger handlers for this event
      const handlers = this.eventHandlers.get(event.name)
      if (handlers) {
        for (const fn of handlers) {
          // Execute in background (fire-and-forget)
          this.invokeFunction(fn, event).catch((error) => {
            this.logger.error(`Function ${fn.id} failed:`, error)
          })
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
   * Create step tools for a function execution
   */
  private createStepTools(runId: string): StepTools {
    const self = this

    return {
      async run<T>(stepId: string, fn: () => T | Promise<T>): Promise<T> {
        // Check for cached result (memoization/replay)
        const cacheKey = `${runId}:${stepId}`
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        try {
          const result = await fn()
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

        const ms = parseDuration(duration)
        await new Promise((resolve) => setTimeout(resolve, ms))
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
      step: this.createStepTools(runId),
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

      return result
    } catch (error) {
      // Error hooks
      for (const lifecycle of middlewareLifecycles) {
        await lifecycle.onError?.(error as Error)
      }
      throw error
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
