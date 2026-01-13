/**
 * Inngest SDK Compatible Client
 *
 * Drop-in replacement for the Inngest SDK that runs on Durable Objects.
 *
 * @example
 * ```typescript
 * import { Inngest } from './client'
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

import {
  type Env,
  type FunctionConfig,
  type FunctionTrigger,
  type FunctionContext,
  type FunctionHandler,
  type FunctionRun,
  type InngestEvent,
  type SendEventPayload,
  type StepTools,
  type Logger,
  type InngestMiddleware,
  type MiddlewareLifecycle,
  parseDuration,
  generateRunId,
  generateEventId,
  getValueByPath,
  ensureError,
} from './types'

// Re-export error types
export {
  NonRetriableError,
  RetryAfterError,
  StepError,
  CancellationError,
} from './InngestDO'

// Re-export types
export type {
  FunctionConfig,
  FunctionTrigger,
  FunctionContext,
  FunctionHandler,
  FunctionRun,
  InngestEvent,
  SendEventPayload,
  StepTools,
  Logger,
  InngestMiddleware,
}

// ============================================================================
// INNGEST FUNCTION
// ============================================================================

/**
 * Inngest function definition
 */
export class InngestFunction<TEvent, TResult> {
  readonly id: string
  readonly name: string
  readonly config: FunctionConfig
  readonly trigger: FunctionTrigger
  readonly handler: FunctionHandler<TEvent, TResult>
  private readonly client: Inngest

  constructor(
    client: Inngest,
    config: FunctionConfig,
    trigger: FunctionTrigger,
    handler: FunctionHandler<TEvent, TResult>
  ) {
    this.client = client
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
   * Invoke this function directly with an event
   */
  async invoke(event: InngestEvent<TEvent>): Promise<TResult> {
    return this.client.invokeFunction(this, event)
  }
}

// ============================================================================
// INNGEST CLIENT (LOCAL MODE)
// ============================================================================

/**
 * Configuration for Inngest client
 */
export interface InngestConfig {
  /** Application ID */
  id: string
  /** Event key for sending events */
  eventKey?: string
  /** Base URL for Inngest API */
  baseUrl?: string
  /** Middleware */
  middleware?: InngestMiddleware[]
  /** Logger */
  logger?: Logger
  /** Durable Object environment (for remote mode) */
  env?: Env
}

/**
 * Default logger
 */
const defaultLogger: Logger = {
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

/**
 * Inngest client - SDK compatible interface
 *
 * Supports two modes:
 * 1. Local mode (no env): Executes functions in-process (for testing)
 * 2. Remote mode (with env): Delegates to InngestDO
 */
export class Inngest {
  readonly id: string
  private readonly config: InngestConfig
  private readonly functions = new Map<string, InngestFunction<unknown, unknown>>()
  private readonly eventHandlers = new Map<string, Set<InngestFunction<unknown, unknown>>>()
  private readonly middleware: InngestMiddleware[]
  private readonly logger: Logger
  private readonly env?: Env

  // In-memory state for local execution
  private readonly stepResults = new Map<string, unknown>()
  private readonly activeRuns = new Map<string, FunctionRun>()
  private readonly runCancellations = new Map<string, { reject: (error: Error) => void }>()

  constructor(config: InngestConfig) {
    this.id = config.id
    this.config = config
    this.middleware = config.middleware ?? []
    this.logger = config.logger ?? defaultLogger
    this.env = config.env

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

    // Register with remote DO if available
    if (this.env) {
      this.registerWithDO(fn as InngestFunction<unknown, unknown>)
    }

    return fn
  }

  /**
   * Register function with InngestDO
   */
  private async registerWithDO(fn: InngestFunction<unknown, unknown>): Promise<void> {
    if (!this.env) return

    const inngestDO = this.env.INNGEST_DO.get(this.env.INNGEST_DO.idFromName(this.id))

    await inngestDO.fetch(new Request('https://inngest-do/function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: fn.id,
        name: fn.name,
        config: fn.config,
        trigger: fn.trigger,
      }),
    }))
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

    // Remote mode: delegate to InngestDO
    if (this.env) {
      const inngestDO = this.env.INNGEST_DO.get(this.env.INNGEST_DO.idFromName(this.id))

      const response = await inngestDO.fetch(new Request('https://inngest-do/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processedEvents),
      }))

      return await response.json() as { ids: string[] }
    }

    // Local mode: execute in-process
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
          // Execute in background
          this.invokeFunction(fn, event).catch((error) => {
            this.logger.error(`Function ${fn.id} failed:`, error)
          })
        }
      }
    }

    return { ids }
  }

  /**
   * Invoke a function directly
   */
  async invokeFunction<TEvent, TResult>(
    fn: InngestFunction<TEvent, TResult>,
    event: InngestEvent<TEvent>
  ): Promise<TResult> {
    // Remote mode: delegate to InngestDO
    if (this.env) {
      const inngestDO = this.env.INNGEST_DO.get(this.env.INNGEST_DO.idFromName(this.id))

      const response = await inngestDO.fetch(new Request('https://inngest-do/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionId: fn.id,
          event,
        }),
      }))

      const run = await response.json() as FunctionRun

      // Wait for completion
      while (run.status === 'pending' || run.status === 'running' ||
             run.status === 'sleeping' || run.status === 'waiting') {
        await new Promise(resolve => setTimeout(resolve, 100))

        const statusResponse = await inngestDO.fetch(
          new Request(`https://inngest-do/run/${run.runId}`)
        )
        const updatedRun = await statusResponse.json() as FunctionRun

        if (updatedRun.status === 'completed') {
          return updatedRun.result as TResult
        }
        if (updatedRun.status === 'failed') {
          throw new Error(updatedRun.error ?? 'Function failed')
        }
        if (updatedRun.status === 'cancelled') {
          throw new Error('Function was cancelled')
        }
      }

      throw new Error('Unexpected run state')
    }

    // Local mode: execute in-process
    return this.executeLocal(fn, event)
  }

  /**
   * Execute function locally (in-process)
   */
  private async executeLocal<TEvent, TResult>(
    fn: InngestFunction<TEvent, TResult>,
    event: InngestEvent<TEvent>
  ): Promise<TResult> {
    const runId = generateRunId()

    // Track run
    const run: FunctionRun = {
      runId,
      functionId: fn.id,
      status: 'running',
      event: event as InngestEvent,
      startedAt: Date.now(),
      attempt: 1,
    }
    this.activeRuns.set(runId, run)

    // Apply middleware
    let middlewareLifecycles: MiddlewareLifecycle[] = []
    for (const mw of this.middleware) {
      if (mw.onFunctionRun) {
        const lifecycle = await mw.onFunctionRun({
          event: event as InngestEvent,
          runId,
          functionId: fn.id,
        })
        middlewareLifecycles.push(lifecycle)
      }
    }

    // Build context
    let ctx: FunctionContext<TEvent> = {
      event,
      events: [event],
      step: this.createLocalStepTools(runId),
      runId,
      attempt: 1,
      logger: this.logger,
    }

    // Transform input
    for (const lifecycle of middlewareLifecycles) {
      if (lifecycle.transformInput) {
        ctx = (await lifecycle.transformInput(ctx as FunctionContext<unknown>)) as FunctionContext<TEvent>
      }
    }

    // Before execution
    for (const lifecycle of middlewareLifecycles) {
      await lifecycle.beforeExecution?.()
    }

    try {
      let result = await fn.handler(ctx)

      // Transform output
      for (const lifecycle of middlewareLifecycles) {
        if (lifecycle.transformOutput) {
          result = (await lifecycle.transformOutput(result)) as TResult
        }
      }

      // After execution
      for (const lifecycle of middlewareLifecycles) {
        await lifecycle.afterExecution?.()
      }

      run.status = 'completed'
      run.completedAt = Date.now()
      run.result = result

      return result
    } catch (error) {
      const err = ensureError(error)

      // Error hooks
      for (const lifecycle of middlewareLifecycles) {
        await lifecycle.onError?.(err)
      }

      run.status = 'failed'
      run.error = err.message
      run.completedAt = Date.now()

      throw error
    } finally {
      // Cleanup
      this.runCancellations.delete(runId)

      // Clear step results
      for (const key of this.stepResults.keys()) {
        if (key.startsWith(`${runId}:`)) {
          this.stepResults.delete(key)
        }
      }

      // Remove run after delay
      setTimeout(() => this.activeRuns.delete(runId), 60000)
    }
  }

  /**
   * Create step tools for local execution
   */
  private createLocalStepTools(runId: string): StepTools {
    const self = this

    return {
      async run<T>(stepId: string, fn: () => T | Promise<T>): Promise<T> {
        const cacheKey = `${runId}:${stepId}`

        // Check cache (memoization)
        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        // Check if cancelled
        const run = self.activeRuns.get(runId)
        if (run?.status === 'cancelled') {
          const { CancellationError } = await import('./InngestDO')
          throw new CancellationError(runId)
        }

        try {
          const result = await fn()
          self.stepResults.set(cacheKey, result)
          return result
        } catch (error) {
          const { StepError } = await import('./InngestDO')
          const err = ensureError(error)
          throw new StepError(err.message, stepId, { cause: err })
        }
      },

      async sleep(stepId: string, duration: string | number): Promise<void> {
        const cacheKey = `${runId}:${stepId}`

        if (self.stepResults.has(cacheKey)) {
          return
        }

        const ms = parseDuration(duration)

        // Create cancellable sleep
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            self.runCancellations.delete(runId)
            resolve()
          }, ms)

          self.runCancellations.set(runId, {
            reject: (error) => {
              clearTimeout(timeoutId)
              reject(error)
            },
          })
        })

        self.stepResults.set(cacheKey, true)
      },

      async sleepUntil(stepId: string, timestamp: Date | string | number): Promise<void> {
        const ts = timestamp instanceof Date
          ? timestamp.getTime()
          : typeof timestamp === 'string'
            ? new Date(timestamp).getTime()
            : timestamp

        const now = Date.now()
        if (ts <= now) return

        await this.sleep(stepId, ts - now)
      },

      async waitForEvent<T = unknown>(
        stepId: string,
        options: { event: string; timeout?: string | number; match?: string; if?: string }
      ): Promise<InngestEvent<T> | null> {
        const cacheKey = `${runId}:${stepId}`

        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as InngestEvent<T> | null
        }

        // In local mode, waitForEvent just times out
        // Real implementation would use event correlation
        const timeoutMs = options.timeout ? parseDuration(options.timeout) : 60000

        await new Promise(resolve => setTimeout(resolve, timeoutMs))

        self.stepResults.set(cacheKey, null)
        return null
      },

      async invoke<T = unknown>(
        stepId: string,
        options: { function: { id: string } | string; data: unknown; timeout?: string | number }
      ): Promise<T> {
        const cacheKey = `${runId}:${stepId}`

        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        const functionId = typeof options.function === 'string'
          ? options.function
          : options.function.id

        const fn = self.functions.get(functionId)
        if (!fn) {
          throw new Error(`Function not found: ${functionId}`)
        }

        const event: InngestEvent = {
          id: generateEventId(),
          name: fn.eventName ?? `invoke/${functionId}`,
          data: options.data,
          ts: Date.now(),
        }

        const result = await self.invokeFunction(fn, event)
        self.stepResults.set(cacheKey, result)
        return result as T
      },

      async sendEvent(
        stepId: string,
        event: SendEventPayload | SendEventPayload[]
      ): Promise<{ ids: string[] }> {
        const cacheKey = `${runId}:${stepId}`

        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as { ids: string[] }
        }

        const result = await self.send(event)
        self.stepResults.set(cacheKey, result)
        return result
      },

      async parallel<T extends readonly unknown[]>(
        stepId: string,
        steps: { [K in keyof T]: () => Promise<T[K]> }
      ): Promise<T> {
        const cacheKey = `${runId}:${stepId}`

        if (self.stepResults.has(cacheKey)) {
          return self.stepResults.get(cacheKey) as T
        }

        const results = await Promise.all(steps.map(step => step()))
        self.stepResults.set(cacheKey, results)
        return results as unknown as T
      },
    }
  }

  /**
   * Get runs for a function
   */
  async getRuns(options: { functionId?: string } = {}): Promise<FunctionRun[]> {
    // Remote mode
    if (this.env) {
      const inngestDO = this.env.INNGEST_DO.get(this.env.INNGEST_DO.idFromName(this.id))

      const url = options.functionId
        ? `https://inngest-do/runs?functionId=${options.functionId}`
        : 'https://inngest-do/runs'

      const response = await inngestDO.fetch(new Request(url))
      return await response.json() as FunctionRun[]
    }

    // Local mode
    const runs: FunctionRun[] = []
    for (const run of this.activeRuns.values()) {
      if (!options.functionId || run.functionId === options.functionId) {
        runs.push(run)
      }
    }
    return runs
  }

  /**
   * Get run state
   */
  async getRunState(runId: string): Promise<FunctionRun | null> {
    // Remote mode
    if (this.env) {
      const inngestDO = this.env.INNGEST_DO.get(this.env.INNGEST_DO.idFromName(this.id))

      const response = await inngestDO.fetch(new Request(`https://inngest-do/run/${runId}`))
      const run = await response.json() as FunctionRun | null
      return run
    }

    // Local mode
    return this.activeRuns.get(runId) ?? null
  }

  /**
   * Cancel a run
   */
  async cancel(runId: string, reason?: string): Promise<void> {
    // Remote mode
    if (this.env) {
      const inngestDO = this.env.INNGEST_DO.get(this.env.INNGEST_DO.idFromName(this.id))

      const url = reason
        ? `https://inngest-do/run/${runId}?reason=${encodeURIComponent(reason)}`
        : `https://inngest-do/run/${runId}`

      await inngestDO.fetch(new Request(url, { method: 'DELETE' }))
      return
    }

    // Local mode
    const run = this.activeRuns.get(runId)
    if (!run) return

    run.status = 'cancelled'
    run.completedAt = Date.now()

    const cancellation = this.runCancellations.get(runId)
    if (cancellation) {
      const { CancellationError } = await import('./InngestDO')
      cancellation.reject(new CancellationError(runId, reason))
      this.runCancellations.delete(runId)
    }

    // Clear step results
    for (const key of this.stepResults.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.stepResults.delete(key)
      }
    }

    this.activeRuns.delete(runId)
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

/**
 * Serve configuration
 */
export interface ServeConfig {
  /** Base path for the handler */
  path?: string
  /** Signing key for verification */
  signingKey?: string
}

/**
 * Create a serve handler for HTTP frameworks
 */
export function serve(
  inngest: Inngest,
  functions: InngestFunction<unknown, unknown>[],
  config?: ServeConfig
) {
  // Register all functions
  for (const fn of functions) {
    inngest.createFunction(fn.config, fn.trigger, fn.handler)
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const basePath = config?.path ?? '/api/inngest'

    // Health check / introspection
    if (request.method === 'GET' && url.pathname === basePath) {
      return new Response(
        JSON.stringify({
          appId: inngest.id,
          functions: functions.map(f => ({
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
        const err = ensureError(error)
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

// ============================================================================
// HONO INTEGRATION
// ============================================================================

/**
 * Create Hono routes for Inngest
 */
export function createHonoRoutes(inngest: Inngest, functions: InngestFunction<unknown, unknown>[]) {
  // Register all functions
  for (const fn of functions) {
    inngest.createFunction(fn.config, fn.trigger, fn.handler)
  }

  return {
    /**
     * Handle GET request (introspection)
     */
    get: () => {
      return {
        appId: inngest.id,
        functions: functions.map(f => ({
          id: f.id,
          name: f.name,
          trigger: f.trigger,
        })),
      }
    },

    /**
     * Handle POST request (event ingestion)
     */
    post: async (events: SendEventPayload | SendEventPayload[]) => {
      return await inngest.send(events)
    },
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default Inngest
