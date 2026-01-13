/**
 * InngestDO - Durable Object for Function Execution Engine
 *
 * The main execution engine that handles:
 * - Function registration and execution
 * - Step execution with memoization
 * - Concurrency management
 * - Rate limiting (leaky bucket)
 * - Priority queues
 * - Cancellation
 * - Fan-out patterns
 * - Retry with backoff
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
  type RunStatus,
  type RetryConfig,
  type ConcurrencyConfig,
  type ThrottleConfig,
  type CancelOnConfig,
  type Logger,
  parseDuration,
  generateRunId,
  generateEventId,
  getValueByPath,
  ensureError,
} from './types'

/**
 * SQL schema for function execution state
 */
const SCHEMA = `
  -- Registered functions
  CREATE TABLE IF NOT EXISTS functions (
    id TEXT PRIMARY KEY,
    name TEXT,
    config TEXT NOT NULL,
    trigger TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  -- Function runs
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    function_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    event TEXT NOT NULL,
    events TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    current_step TEXT,
    error TEXT,
    result TEXT,
    attempt INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    parent_run_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_runs_function ON runs(function_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
  CREATE INDEX IF NOT EXISTS idx_runs_priority ON runs(priority DESC, created_at ASC);

  -- Concurrency tracking
  CREATE TABLE IF NOT EXISTS concurrency (
    key TEXT PRIMARY KEY,
    current_count INTEGER DEFAULT 0,
    limit_value INTEGER NOT NULL
  );

  -- Rate limit buckets (leaky bucket)
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    tokens REAL NOT NULL,
    last_update INTEGER NOT NULL,
    rate REAL NOT NULL,
    capacity INTEGER NOT NULL
  );

  -- Priority queue
  CREATE TABLE IF NOT EXISTS priority_queue (
    run_id TEXT PRIMARY KEY,
    function_id TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    queued_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
  );

  CREATE INDEX IF NOT EXISTS idx_priority_queue ON priority_queue(priority DESC, queued_at ASC);

  -- Cancellation subscriptions
  CREATE TABLE IF NOT EXISTS cancel_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    function_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    match_expr TEXT,
    if_expr TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cancel_subs_event ON cancel_subscriptions(event_name);
`

/**
 * Error types matching Inngest SDK
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

export class CancellationError extends Error {
  readonly isCancellationError = true
  readonly runId: string
  readonly reason?: string

  constructor(runId: string, reason?: string) {
    super(reason ? `Run ${runId} cancelled: ${reason}` : `Run ${runId} cancelled`)
    this.name = 'CancellationError'
    this.runId = runId
    this.reason = reason
  }
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
 * InngestDO - Function execution engine
 */
export class InngestDO implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private initialized = false
  private handlers = new Map<string, FunctionHandler<unknown, unknown>>()
  private runCancellations = new Map<string, { reject: (error: Error) => void }>()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  /**
   * Initialize the database schema
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    await this.state.storage.sql.exec(SCHEMA)
    this.initialized = true
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.init()

    const url = new URL(request.url)
    const method = request.method

    try {
      // POST /function - Register a function
      if (method === 'POST' && url.pathname === '/function') {
        const body = await request.json() as {
          id: string
          name?: string
          config: FunctionConfig
          trigger: FunctionTrigger
        }
        await this.registerFunction(body)
        return Response.json({ success: true })
      }

      // GET /function/:id - Get function info
      if (method === 'GET' && url.pathname.startsWith('/function/')) {
        const functionId = url.pathname.split('/')[2]
        const fn = await this.getFunction(functionId)
        return Response.json(fn)
      }

      // DELETE /function/:id - Unregister function
      if (method === 'DELETE' && url.pathname.startsWith('/function/')) {
        const functionId = url.pathname.split('/')[2]
        await this.unregisterFunction(functionId)
        return Response.json({ success: true })
      }

      // GET /functions - List all functions
      if (method === 'GET' && url.pathname === '/functions') {
        const functions = await this.listFunctions()
        return Response.json(functions)
      }

      // POST /run - Execute a function
      if (method === 'POST' && url.pathname === '/run') {
        const body = await request.json() as {
          functionId: string
          event: InngestEvent
          events?: InngestEvent[]
          priority?: number
          parentRunId?: string
        }
        const result = await this.executeFunction(body)
        return Response.json(result)
      }

      // GET /run/:runId - Get run status
      if (method === 'GET' && url.pathname.startsWith('/run/')) {
        const runId = url.pathname.split('/')[2]
        const run = await this.getRun(runId)
        return Response.json(run)
      }

      // DELETE /run/:runId - Cancel a run
      if (method === 'DELETE' && url.pathname.startsWith('/run/')) {
        const runId = url.pathname.split('/')[2]
        const reason = url.searchParams.get('reason') ?? undefined
        await this.cancelRun(runId, reason)
        return Response.json({ success: true })
      }

      // GET /runs - List runs
      if (method === 'GET' && url.pathname === '/runs') {
        const functionId = url.searchParams.get('functionId') ?? undefined
        const status = url.searchParams.get('status') as RunStatus | undefined
        const limit = parseInt(url.searchParams.get('limit') ?? '100')
        const runs = await this.listRuns(functionId, status, limit)
        return Response.json(runs)
      }

      // POST /send - Send events (triggers functions)
      if (method === 'POST' && url.pathname === '/send') {
        const body = await request.json() as SendEventPayload | SendEventPayload[]
        const result = await this.sendEvents(body)
        return Response.json(result)
      }

      // POST /step/complete - Complete a step (callback from StepDO)
      if (method === 'POST' && url.pathname === '/step/complete') {
        const body = await request.json() as {
          runId: string
          stepId: string
          result?: unknown
          error?: string
        }
        await this.handleStepComplete(body)
        return Response.json({ success: true })
      }

      // POST /replay - Replay a run
      if (method === 'POST' && url.pathname === '/replay') {
        const body = await request.json() as { runId: string }
        const result = await this.replayRun(body.runId)
        return Response.json(result)
      }

      // GET /queue - Get priority queue status
      if (method === 'GET' && url.pathname === '/queue') {
        const queue = await this.getQueueStatus()
        return Response.json(queue)
      }

      // POST /concurrency/acquire - Acquire concurrency slot
      if (method === 'POST' && url.pathname === '/concurrency/acquire') {
        const body = await request.json() as { key: string; limit: number }
        const acquired = await this.acquireConcurrency(body.key, body.limit)
        return Response.json({ acquired })
      }

      // POST /concurrency/release - Release concurrency slot
      if (method === 'POST' && url.pathname === '/concurrency/release') {
        const body = await request.json() as { key: string }
        await this.releaseConcurrency(body.key)
        return Response.json({ success: true })
      }

      // POST /ratelimit/check - Check rate limit
      if (method === 'POST' && url.pathname === '/ratelimit/check') {
        const body = await request.json() as {
          key: string
          rate: number
          capacity: number
        }
        const allowed = await this.checkRateLimit(body.key, body.rate, body.capacity)
        return Response.json({ allowed })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      const err = ensureError(error)
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  /**
   * Handle DO alarm for scheduled retries
   */
  async alarm(): Promise<void> {
    await this.init()

    // Process priority queue
    await this.processQueue()

    // Schedule next alarm if needed
    await this.scheduleNextAlarm()
  }

  // ===========================================================================
  // Function Registration
  // ===========================================================================

  /**
   * Register a function
   */
  private async registerFunction(params: {
    id: string
    name?: string
    config: FunctionConfig
    trigger: FunctionTrigger
  }): Promise<void> {
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO functions (id, name, config, trigger)
       VALUES (?, ?, ?, ?)`,
      params.id,
      params.name ?? params.id,
      JSON.stringify(params.config),
      JSON.stringify(params.trigger)
    )

    // Register cancellation subscriptions
    if (params.config.cancelOn) {
      for (const cancel of params.config.cancelOn) {
        this.state.storage.sql.exec(
          `INSERT INTO cancel_subscriptions (function_id, event_name, match_expr, if_expr)
           VALUES (?, ?, ?, ?)`,
          params.id,
          cancel.event,
          cancel.match ?? null,
          cancel.if ?? null
        )
      }
    }

    // Register with EventDO
    const eventDO = this.env.EVENT_DO.get(this.env.EVENT_DO.idFromName('default'))
    const eventName = typeof params.trigger === 'string'
      ? params.trigger
      : 'event' in params.trigger
        ? params.trigger.event
        : null

    if (eventName) {
      await eventDO.fetch(new Request('https://event-do/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionId: params.id,
          eventName,
        }),
      }))
    }
  }

  /**
   * Get function info
   */
  private async getFunction(functionId: string): Promise<{
    id: string
    name: string
    config: FunctionConfig
    trigger: FunctionTrigger
  } | null> {
    const row = this.state.storage.sql.exec<{
      id: string
      name: string
      config: string
      trigger: string
    }>(
      `SELECT * FROM functions WHERE id = ?`,
      functionId
    ).one()

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      config: JSON.parse(row.config),
      trigger: JSON.parse(row.trigger),
    }
  }

  /**
   * Unregister function
   */
  private async unregisterFunction(functionId: string): Promise<void> {
    const fn = await this.getFunction(functionId)
    if (!fn) return

    this.state.storage.sql.exec(`DELETE FROM functions WHERE id = ?`, functionId)
    this.state.storage.sql.exec(`DELETE FROM cancel_subscriptions WHERE function_id = ?`, functionId)

    // Unregister from EventDO
    const eventDO = this.env.EVENT_DO.get(this.env.EVENT_DO.idFromName('default'))
    const eventName = typeof fn.trigger === 'string'
      ? fn.trigger
      : 'event' in fn.trigger
        ? fn.trigger.event
        : null

    if (eventName) {
      await eventDO.fetch(new Request('https://event-do/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionId,
          eventName,
        }),
      }))
    }
  }

  /**
   * List all functions
   */
  private async listFunctions(): Promise<Array<{
    id: string
    name: string
    config: FunctionConfig
    trigger: FunctionTrigger
  }>> {
    const rows = this.state.storage.sql.exec<{
      id: string
      name: string
      config: string
      trigger: string
    }>(`SELECT * FROM functions`).toArray()

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      config: JSON.parse(row.config),
      trigger: JSON.parse(row.trigger),
    }))
  }

  // ===========================================================================
  // Function Execution
  // ===========================================================================

  /**
   * Execute a function
   */
  private async executeFunction(params: {
    functionId: string
    event: InngestEvent
    events?: InngestEvent[]
    priority?: number
    parentRunId?: string
  }): Promise<FunctionRun> {
    const fn = await this.getFunction(params.functionId)
    if (!fn) {
      throw new Error(`Function not found: ${params.functionId}`)
    }

    const runId = generateRunId()
    const now = Date.now()

    // Create run record
    this.state.storage.sql.exec(
      `INSERT INTO runs (run_id, function_id, status, event, events, started_at, priority, parent_run_id)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      runId,
      params.functionId,
      JSON.stringify(params.event),
      params.events ? JSON.stringify(params.events) : null,
      now,
      params.priority ?? 0,
      params.parentRunId ?? null
    )

    // Check concurrency limits
    const concurrency = fn.config.concurrency
    if (concurrency) {
      const config: ConcurrencyConfig = typeof concurrency === 'number'
        ? { limit: concurrency }
        : concurrency

      const key = this.getConcurrencyKey(params.functionId, config, params.event)
      const acquired = await this.acquireConcurrency(key, config.limit)

      if (!acquired) {
        // Queue for later execution
        this.state.storage.sql.exec(
          `INSERT INTO priority_queue (run_id, function_id, priority)
           VALUES (?, ?, ?)`,
          runId,
          params.functionId,
          params.priority ?? 0
        )

        this.state.storage.sql.exec(
          `UPDATE runs SET status = 'pending' WHERE run_id = ?`,
          runId
        )

        await this.scheduleNextAlarm()

        return await this.getRun(runId) as FunctionRun
      }
    }

    // Check throttle/rate limit
    const throttle = fn.config.throttle
    if (throttle) {
      const key = this.getThrottleKey(params.functionId, throttle, params.event)
      const rate = throttle.count / (parseDuration(throttle.period) / 1000) // tokens per second
      const allowed = await this.checkRateLimit(key, rate, throttle.count)

      if (!allowed) {
        // Queue for later execution
        this.state.storage.sql.exec(
          `INSERT INTO priority_queue (run_id, function_id, priority)
           VALUES (?, ?, ?)`,
          runId,
          params.functionId,
          params.priority ?? 0
        )

        await this.scheduleNextAlarm()

        return await this.getRun(runId) as FunctionRun
      }
    }

    // Execute the function
    await this.runFunction(runId, fn, params.event, params.events)

    return await this.getRun(runId) as FunctionRun
  }

  /**
   * Run a function (internal execution)
   */
  private async runFunction(
    runId: string,
    fn: { id: string; config: FunctionConfig },
    event: InngestEvent,
    events?: InngestEvent[]
  ): Promise<void> {
    // Update status to running
    this.state.storage.sql.exec(
      `UPDATE runs SET status = 'running', started_at = ? WHERE run_id = ?`,
      Date.now(),
      runId
    )

    // Get the handler
    const handler = this.handlers.get(fn.id)
    if (!handler) {
      // No handler registered - this DO doesn't execute handlers directly
      // The client is responsible for executing handlers
      return
    }

    // Build context
    const stepTools = this.createStepTools(runId, fn)
    const ctx: FunctionContext = {
      event,
      events: events ?? [event],
      step: stepTools,
      runId,
      attempt: 1,
      logger: defaultLogger,
    }

    try {
      const result = await handler(ctx)

      // Update to completed
      this.state.storage.sql.exec(
        `UPDATE runs SET status = 'completed', completed_at = ?, result = ? WHERE run_id = ?`,
        Date.now(),
        JSON.stringify(result),
        runId
      )
    } catch (error) {
      const err = ensureError(error)

      if (err instanceof CancellationError) {
        // Already cancelled, nothing to do
        return
      }

      if (err instanceof NonRetriableError) {
        // Mark as failed, no retry
        this.state.storage.sql.exec(
          `UPDATE runs SET status = 'failed', completed_at = ?, error = ? WHERE run_id = ?`,
          Date.now(),
          err.message,
          runId
        )
        return
      }

      // Check retry config
      const retryConfig = this.getRetryConfig(fn.config)
      const run = await this.getRun(runId)

      if (run && run.attempt < retryConfig.attempts) {
        // Schedule retry
        const backoffMs = this.calculateBackoff(run.attempt, retryConfig)

        this.state.storage.sql.exec(
          `UPDATE runs SET status = 'pending', attempt = ? WHERE run_id = ?`,
          run.attempt + 1,
          runId
        )

        this.state.storage.sql.exec(
          `INSERT OR REPLACE INTO priority_queue (run_id, function_id, priority, queued_at)
           VALUES (?, ?, ?, ?)`,
          runId,
          fn.id,
          run.priority ?? 0,
          Date.now() + backoffMs
        )

        await this.scheduleNextAlarm()
      } else {
        // Max retries exceeded
        this.state.storage.sql.exec(
          `UPDATE runs SET status = 'failed', completed_at = ?, error = ? WHERE run_id = ?`,
          Date.now(),
          err.message,
          runId
        )
      }
    } finally {
      // Release concurrency slot
      const concurrency = fn.config.concurrency
      if (concurrency) {
        const config: ConcurrencyConfig = typeof concurrency === 'number'
          ? { limit: concurrency }
          : concurrency
        const key = this.getConcurrencyKey(fn.id, config, event)
        await this.releaseConcurrency(key)
      }
    }
  }

  /**
   * Create step tools for a function execution
   */
  private createStepTools(runId: string, fn: { id: string; config: FunctionConfig }): StepTools {
    const self = this

    return {
      async run<T>(stepId: string, stepFn: () => T | Promise<T>): Promise<T> {
        // Check if cancelled
        const run = await self.getRun(runId)
        if (run?.status === 'cancelled') {
          throw new CancellationError(runId)
        }

        // Check StepDO for memoized result
        const stepDO = self.env.STEP_DO.get(self.env.STEP_DO.idFromName(runId))
        const checkResult = await stepDO.fetch(new Request('https://step-do/step/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, stepId }),
        }))

        const checkData = await checkResult.json() as {
          status: 'new' | 'completed' | 'failed' | 'sleeping'
          result?: unknown
          error?: string
        }

        if (checkData.status === 'completed') {
          return checkData.result as T
        }

        if (checkData.status === 'failed') {
          throw new StepError(checkData.error ?? 'Step failed', stepId)
        }

        // Execute the step
        try {
          const result = await stepFn()

          // Store result
          await stepDO.fetch(new Request('https://step-do/step/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId, stepId, result }),
          }))

          return result
        } catch (error) {
          const err = ensureError(error)

          // Store failure
          await stepDO.fetch(new Request('https://step-do/step/fail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId, stepId, error: err.message }),
          }))

          throw new StepError(err.message, stepId, { cause: err })
        }
      },

      async sleep(stepId: string, duration: string | number): Promise<void> {
        const stepDO = self.env.STEP_DO.get(self.env.STEP_DO.idFromName(runId))

        // Check for memoized sleep
        const checkResult = await stepDO.fetch(new Request('https://step-do/step/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, stepId }),
        }))

        const checkData = await checkResult.json() as {
          status: 'new' | 'completed' | 'sleeping'
          sleepUntil?: number
        }

        if (checkData.status === 'completed') {
          return
        }

        if (checkData.status === 'sleeping') {
          // Wait for alarm
          const waitMs = (checkData.sleepUntil ?? 0) - Date.now()
          if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs))
          }
          return
        }

        // Schedule sleep
        await stepDO.fetch(new Request('https://step-do/step/sleep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, stepId, duration }),
        }))

        // Update run status
        self.state.storage.sql.exec(
          `UPDATE runs SET status = 'sleeping', current_step = ? WHERE run_id = ?`,
          stepId,
          runId
        )

        // Wait for the duration
        const ms = parseDuration(duration)
        await new Promise(resolve => setTimeout(resolve, ms))
      },

      async sleepUntil(stepId: string, timestamp: Date | string | number): Promise<void> {
        const ts = timestamp instanceof Date
          ? timestamp.getTime()
          : typeof timestamp === 'string'
            ? new Date(timestamp).getTime()
            : timestamp

        const now = Date.now()
        if (ts <= now) return

        const stepDO = self.env.STEP_DO.get(self.env.STEP_DO.idFromName(runId))

        await stepDO.fetch(new Request('https://step-do/step/sleep-until', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, stepId, timestamp: ts }),
        }))

        // Wait
        await new Promise(resolve => setTimeout(resolve, ts - now))
      },

      async waitForEvent<T = unknown>(
        stepId: string,
        options: { event: string; timeout?: string | number; match?: string; if?: string }
      ): Promise<InngestEvent<T> | null> {
        const eventDO = self.env.EVENT_DO.get(self.env.EVENT_DO.idFromName('default'))

        const waiterId = `${runId}:${stepId}`

        // Register waiter
        await eventDO.fetch(new Request('https://event-do/wait', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            waiterId,
            runId,
            eventName: options.event,
            match: options.match,
            if: options.if,
            timeout: options.timeout,
          }),
        }))

        // Update run status
        self.state.storage.sql.exec(
          `UPDATE runs SET status = 'waiting', current_step = ? WHERE run_id = ?`,
          stepId,
          runId
        )

        // Poll for result (in production, this would use hibernation)
        const timeoutMs = options.timeout ? parseDuration(options.timeout) : 24 * 60 * 60 * 1000
        const deadline = Date.now() + timeoutMs

        while (Date.now() < deadline) {
          const result = await self.state.storage.get(`waiter:${waiterId}:result`)
          if (result !== undefined) {
            await self.state.storage.delete(`waiter:${waiterId}:result`)
            return result as InngestEvent<T> | null
          }

          // Check if cancelled
          const run = await self.getRun(runId)
          if (run?.status === 'cancelled') {
            // Cancel the waiter
            await eventDO.fetch(new Request(`https://event-do/wait/${waiterId}`, {
              method: 'DELETE',
            }))
            throw new CancellationError(runId)
          }

          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // Timeout
        return null
      },

      async invoke<T = unknown>(
        stepId: string,
        options: { function: { id: string } | string; data: unknown; timeout?: string | number }
      ): Promise<T> {
        const functionId = typeof options.function === 'string'
          ? options.function
          : options.function.id

        const event: InngestEvent = {
          id: generateEventId(),
          name: `invoke/${functionId}`,
          data: options.data,
          ts: Date.now(),
        }

        // Execute the function
        const result = await self.executeFunction({
          functionId,
          event,
          parentRunId: runId,
        })

        // Wait for completion
        const timeoutMs = options.timeout ? parseDuration(options.timeout) : 60 * 60 * 1000
        const deadline = Date.now() + timeoutMs

        while (Date.now() < deadline) {
          const run = await self.getRun(result.runId)
          if (!run) break

          if (run.status === 'completed') {
            return run.result as T
          }

          if (run.status === 'failed') {
            throw new Error(run.error ?? 'Invoked function failed')
          }

          if (run.status === 'cancelled') {
            throw new CancellationError(result.runId, 'Invoked function was cancelled')
          }

          await new Promise(resolve => setTimeout(resolve, 100))
        }

        throw new Error(`Invoked function ${functionId} timed out`)
      },

      async sendEvent(
        stepId: string,
        event: SendEventPayload | SendEventPayload[]
      ): Promise<{ ids: string[] }> {
        return await self.sendEvents(event)
      },

      async parallel<T extends readonly unknown[]>(
        stepId: string,
        steps: { [K in keyof T]: () => Promise<T[K]> }
      ): Promise<T> {
        const results = await Promise.all(steps.map(step => step()))
        return results as unknown as T
      },
    }
  }

  // ===========================================================================
  // Run Management
  // ===========================================================================

  /**
   * Get run status
   */
  private async getRun(runId: string): Promise<FunctionRun | null> {
    const row = this.state.storage.sql.exec<{
      run_id: string
      function_id: string
      status: string
      event: string
      events: string | null
      started_at: number | null
      completed_at: number | null
      current_step: string | null
      error: string | null
      result: string | null
      attempt: number
      priority: number
      parent_run_id: string | null
    }>(
      `SELECT * FROM runs WHERE run_id = ?`,
      runId
    ).one()

    if (!row) return null

    return {
      runId: row.run_id,
      functionId: row.function_id,
      status: row.status as RunStatus,
      event: JSON.parse(row.event),
      events: row.events ? JSON.parse(row.events) : undefined,
      startedAt: row.started_at ?? 0,
      completedAt: row.completed_at ?? undefined,
      currentStep: row.current_step ?? undefined,
      error: row.error ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      attempt: row.attempt,
      priority: row.priority,
      parentRunId: row.parent_run_id ?? undefined,
    }
  }

  /**
   * Cancel a run
   */
  private async cancelRun(runId: string, reason?: string): Promise<void> {
    const run = await this.getRun(runId)
    if (!run) return

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return
    }

    // Update status
    this.state.storage.sql.exec(
      `UPDATE runs SET status = 'cancelled', completed_at = ?, error = ? WHERE run_id = ?`,
      Date.now(),
      reason ?? 'Cancelled',
      runId
    )

    // Remove from queue
    this.state.storage.sql.exec(`DELETE FROM priority_queue WHERE run_id = ?`, runId)

    // Reject any waiting promises
    const cancellation = this.runCancellations.get(runId)
    if (cancellation) {
      cancellation.reject(new CancellationError(runId, reason))
      this.runCancellations.delete(runId)
    }

    // Clean up step state
    const stepDO = this.env.STEP_DO.get(this.env.STEP_DO.idFromName(runId))
    await stepDO.fetch(new Request(`https://step-do/steps/${runId}`, {
      method: 'DELETE',
    }))
  }

  /**
   * List runs
   */
  private async listRuns(
    functionId?: string,
    status?: RunStatus,
    limit = 100
  ): Promise<FunctionRun[]> {
    let query = `SELECT * FROM runs WHERE 1=1`
    const args: (string | number)[] = []

    if (functionId) {
      query += ` AND function_id = ?`
      args.push(functionId)
    }

    if (status) {
      query += ` AND status = ?`
      args.push(status)
    }

    query += ` ORDER BY started_at DESC LIMIT ?`
    args.push(limit)

    const rows = this.state.storage.sql.exec<{
      run_id: string
      function_id: string
      status: string
      event: string
      events: string | null
      started_at: number | null
      completed_at: number | null
      current_step: string | null
      error: string | null
      result: string | null
      attempt: number
      priority: number
      parent_run_id: string | null
    }>(query, ...args).toArray()

    return rows.map(row => ({
      runId: row.run_id,
      functionId: row.function_id,
      status: row.status as RunStatus,
      event: JSON.parse(row.event),
      events: row.events ? JSON.parse(row.events) : undefined,
      startedAt: row.started_at ?? 0,
      completedAt: row.completed_at ?? undefined,
      currentStep: row.current_step ?? undefined,
      error: row.error ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      attempt: row.attempt,
      priority: row.priority,
      parentRunId: row.parent_run_id ?? undefined,
    }))
  }

  /**
   * Replay a failed run
   */
  private async replayRun(runId: string): Promise<FunctionRun> {
    const run = await this.getRun(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    // Clear step state
    const stepDO = this.env.STEP_DO.get(this.env.STEP_DO.idFromName(runId))
    await stepDO.fetch(new Request(`https://step-do/steps/${runId}`, {
      method: 'DELETE',
    }))

    // Re-execute
    const fn = await this.getFunction(run.functionId)
    if (!fn) {
      throw new Error(`Function not found: ${run.functionId}`)
    }

    // Reset run state
    this.state.storage.sql.exec(
      `UPDATE runs SET status = 'pending', attempt = 1, error = NULL, result = NULL,
       completed_at = NULL, current_step = NULL WHERE run_id = ?`,
      runId
    )

    await this.runFunction(runId, fn, run.event, run.events)

    return await this.getRun(runId) as FunctionRun
  }

  // ===========================================================================
  // Event Sending
  // ===========================================================================

  /**
   * Send events (triggers matching functions)
   */
  private async sendEvents(
    payload: SendEventPayload | SendEventPayload[]
  ): Promise<{ ids: string[]; runs: string[] }> {
    const events = Array.isArray(payload) ? payload : [payload]
    const ids: string[] = []
    const runs: string[] = []

    // Send to EventDO
    const eventDO = this.env.EVENT_DO.get(this.env.EVENT_DO.idFromName('default'))
    const result = await eventDO.fetch(new Request('https://event-do/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    }))

    const eventResult = await result.json() as {
      ids: string[]
      triggeredFunctions: string[]
    }

    ids.push(...eventResult.ids)

    // Execute triggered functions
    for (let i = 0; i < events.length; i++) {
      const event: InngestEvent = {
        ...events[i],
        id: eventResult.ids[i],
        ts: events[i].ts ?? Date.now(),
      }

      // Check for cancellation events
      await this.processCancellationEvent(event)

      // Get functions for this event
      const functions = await this.listFunctions()
      for (const fn of functions) {
        const eventName = typeof fn.trigger === 'string'
          ? fn.trigger
          : 'event' in fn.trigger
            ? fn.trigger.event
            : null

        if (eventName === event.name) {
          const run = await this.executeFunction({
            functionId: fn.id,
            event,
          })
          runs.push(run.runId)
        }
      }
    }

    return { ids, runs }
  }

  /**
   * Process cancellation events
   */
  private async processCancellationEvent(event: InngestEvent): Promise<void> {
    const subs = this.state.storage.sql.exec<{
      function_id: string
      match_expr: string | null
      if_expr: string | null
    }>(
      `SELECT function_id, match_expr, if_expr FROM cancel_subscriptions WHERE event_name = ?`,
      event.name
    ).toArray()

    for (const sub of subs) {
      // Find matching active runs
      const activeRuns = this.state.storage.sql.exec<{
        run_id: string
        event: string
      }>(
        `SELECT run_id, event FROM runs
         WHERE function_id = ? AND status IN ('running', 'sleeping', 'waiting', 'pending')`,
        sub.function_id
      ).toArray()

      for (const run of activeRuns) {
        const runEvent = JSON.parse(run.event) as InngestEvent
        let shouldCancel = false

        if (sub.match_expr) {
          const cancelValue = getValueByPath(event, sub.match_expr.replace('data.', ''))
          const runValue = getValueByPath(runEvent, sub.match_expr.replace('data.', ''))
          shouldCancel = cancelValue === runValue
        } else if (sub.if_expr) {
          // Simple expression evaluation
          shouldCancel = true
        } else {
          shouldCancel = true
        }

        if (shouldCancel) {
          await this.cancelRun(run.run_id, `Cancelled by event: ${event.name}`)
        }
      }
    }
  }

  // ===========================================================================
  // Concurrency Management
  // ===========================================================================

  /**
   * Get concurrency key
   */
  private getConcurrencyKey(
    functionId: string,
    config: ConcurrencyConfig,
    event: InngestEvent
  ): string {
    if (config.key) {
      const value = getValueByPath({ event }, config.key)
      return `${functionId}:${String(value)}`
    }

    switch (config.scope) {
      case 'env':
        return 'env'
      case 'account':
        return 'account'
      case 'fn':
      default:
        return functionId
    }
  }

  /**
   * Acquire concurrency slot
   */
  private async acquireConcurrency(key: string, limit: number): Promise<boolean> {
    const row = this.state.storage.sql.exec<{
      current_count: number
      limit_value: number
    }>(
      `SELECT current_count, limit_value FROM concurrency WHERE key = ?`,
      key
    ).one()

    const currentCount = row?.current_count ?? 0

    if (currentCount >= limit) {
      return false
    }

    this.state.storage.sql.exec(
      `INSERT INTO concurrency (key, current_count, limit_value)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET current_count = current_count + 1`,
      key,
      limit
    )

    return true
  }

  /**
   * Release concurrency slot
   */
  private async releaseConcurrency(key: string): Promise<void> {
    this.state.storage.sql.exec(
      `UPDATE concurrency SET current_count = MAX(0, current_count - 1) WHERE key = ?`,
      key
    )
  }

  // ===========================================================================
  // Rate Limiting (Leaky Bucket)
  // ===========================================================================

  /**
   * Get throttle key
   */
  private getThrottleKey(
    functionId: string,
    config: ThrottleConfig,
    event: InngestEvent
  ): string {
    if (config.key) {
      const value = getValueByPath({ event }, config.key)
      return `throttle:${functionId}:${String(value)}`
    }
    return `throttle:${functionId}`
  }

  /**
   * Check rate limit (leaky bucket algorithm)
   */
  private async checkRateLimit(key: string, rate: number, capacity: number): Promise<boolean> {
    const now = Date.now()

    const row = this.state.storage.sql.exec<{
      tokens: number
      last_update: number
    }>(
      `SELECT tokens, last_update FROM rate_limits WHERE key = ?`,
      key
    ).one()

    let tokens = capacity
    let lastUpdate = now

    if (row) {
      // Calculate leaked tokens since last update
      const elapsed = (now - row.last_update) / 1000 // seconds
      const leaked = elapsed * rate
      tokens = Math.min(capacity, row.tokens + leaked)
      lastUpdate = row.last_update
    }

    if (tokens < 1) {
      return false
    }

    // Consume a token
    this.state.storage.sql.exec(
      `INSERT INTO rate_limits (key, tokens, last_update, rate, capacity)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET tokens = ?, last_update = ?`,
      key,
      tokens - 1,
      now,
      rate,
      capacity,
      tokens - 1,
      now
    )

    return true
  }

  // ===========================================================================
  // Priority Queue
  // ===========================================================================

  /**
   * Get queue status
   */
  private async getQueueStatus(): Promise<{
    pending: number
    items: Array<{ runId: string; functionId: string; priority: number; queuedAt: number }>
  }> {
    const count = this.state.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM priority_queue`
    ).one()

    const items = this.state.storage.sql.exec<{
      run_id: string
      function_id: string
      priority: number
      queued_at: number
    }>(
      `SELECT * FROM priority_queue ORDER BY priority DESC, queued_at ASC LIMIT 100`
    ).toArray()

    return {
      pending: count?.count ?? 0,
      items: items.map(row => ({
        runId: row.run_id,
        functionId: row.function_id,
        priority: row.priority,
        queuedAt: row.queued_at,
      })),
    }
  }

  /**
   * Process priority queue
   */
  private async processQueue(): Promise<void> {
    const now = Date.now()

    // Get next items to process (respecting queued_at for scheduled retries)
    const items = this.state.storage.sql.exec<{
      run_id: string
      function_id: string
    }>(
      `SELECT run_id, function_id FROM priority_queue
       WHERE queued_at <= ?
       ORDER BY priority DESC, queued_at ASC
       LIMIT 10`,
      now
    ).toArray()

    for (const item of items) {
      const fn = await this.getFunction(item.function_id)
      if (!fn) continue

      const run = await this.getRun(item.run_id)
      if (!run || run.status !== 'pending') {
        // Remove from queue
        this.state.storage.sql.exec(`DELETE FROM priority_queue WHERE run_id = ?`, item.run_id)
        continue
      }

      // Check concurrency
      const concurrency = fn.config.concurrency
      if (concurrency) {
        const config: ConcurrencyConfig = typeof concurrency === 'number'
          ? { limit: concurrency }
          : concurrency
        const key = this.getConcurrencyKey(fn.id, config, run.event)
        const acquired = await this.acquireConcurrency(key, config.limit)

        if (!acquired) {
          continue // Leave in queue
        }
      }

      // Remove from queue and execute
      this.state.storage.sql.exec(`DELETE FROM priority_queue WHERE run_id = ?`, item.run_id)

      await this.runFunction(item.run_id, fn, run.event, run.events)
    }
  }

  /**
   * Handle step completion callback
   */
  private async handleStepComplete(params: {
    runId: string
    stepId: string
    result?: unknown
    error?: string
  }): Promise<void> {
    const run = await this.getRun(params.runId)
    if (!run) return

    if (params.error) {
      // Step failed - may trigger retry
      this.state.storage.sql.exec(
        `UPDATE runs SET current_step = NULL WHERE run_id = ?`,
        params.runId
      )
    } else {
      // Step completed - continue execution
      this.state.storage.sql.exec(
        `UPDATE runs SET status = 'running', current_step = NULL WHERE run_id = ?`,
        params.runId
      )
    }
  }

  // ===========================================================================
  // Retry Logic
  // ===========================================================================

  /**
   * Get retry config with defaults
   */
  private getRetryConfig(config: FunctionConfig): {
    attempts: number
    backoff: 'exponential' | 'linear' | 'constant'
    initialInterval: number
    maxInterval: number
  } {
    const retries = config.retries
    if (typeof retries === 'number') {
      return {
        attempts: retries,
        backoff: 'exponential',
        initialInterval: 1000,
        maxInterval: 60000,
      }
    }

    return {
      attempts: retries?.attempts ?? 3,
      backoff: retries?.backoff ?? 'exponential',
      initialInterval: retries?.initialInterval
        ? parseDuration(retries.initialInterval)
        : 1000,
      maxInterval: retries?.maxInterval
        ? parseDuration(retries.maxInterval)
        : 60000,
    }
  }

  /**
   * Calculate backoff delay
   */
  private calculateBackoff(
    attempt: number,
    config: { backoff: 'exponential' | 'linear' | 'constant'; initialInterval: number; maxInterval: number }
  ): number {
    let delay: number

    switch (config.backoff) {
      case 'constant':
        delay = config.initialInterval
        break
      case 'linear':
        delay = config.initialInterval * attempt
        break
      case 'exponential':
      default:
        delay = config.initialInterval * Math.pow(2, attempt - 1)
    }

    return Math.min(delay, config.maxInterval)
  }

  /**
   * Schedule next alarm
   */
  private async scheduleNextAlarm(): Promise<void> {
    const nextQueued = this.state.storage.sql.exec<{ queued_at: number }>(
      `SELECT MIN(queued_at) as queued_at FROM priority_queue`
    ).one()

    if (nextQueued?.queued_at) {
      await this.state.storage.setAlarm(nextQueued.queued_at)
    }
  }

  /**
   * Register a handler (for in-process execution)
   */
  registerHandler(functionId: string, handler: FunctionHandler<unknown, unknown>): void {
    this.handlers.set(functionId, handler)
  }
}
