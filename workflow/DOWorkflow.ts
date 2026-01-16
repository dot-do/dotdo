/**
 * DOWorkflow - Extends DOStorage with WorkflowContext ($) (~60KB)
 *
 * Adds:
 * - WorkflowContext ($) - The unified interface for DO operations
 * - Event Handlers ($.on) - $.on.Noun.verb(handler), wildcards
 * - Scheduling DSL ($.every) - $.every.Monday.at9am(), $.every.day.at('6pm')()
 * - Durable Execution - $.do(action), $.try(action), $.send(event)
 * - Cross-DO RPC - $.Customer(id).method()
 */

import { DOStorageClass, type DOStorageEnv } from '../storage/DOStorage'
import { createWorkflowContext, type WorkflowContext, type CascadeOptions, type CascadeResult, type CircuitBreakerPersistenceState } from './workflow-context'

// ============================================================================
// Types
// ============================================================================

/**
 * DOWorkflowEnv extends DOStorageEnv with workflow-specific bindings.
 *
 * Note: The interface extension causes strict type conflicts with DurableObjectNamespace<T>
 * because TypeScript checks that DurableObjectStub<DOWorkflowClass> is assignable to
 * DurableObjectStub<DOStorageClass>, which fails due to RPC type inference.
 *
 * This is a known limitation of Cloudflare's DO type system when using inheritance.
 * The workaround uses @ts-expect-error to suppress the expected extension error.
 */
// @ts-expect-error - Intentional: DOWorkflowClass extends DOStorageClass, but TS can't verify DurableObjectNamespace covariance
export interface DOWorkflowEnv extends DOStorageEnv {
  DOWorkflow: DurableObjectNamespace<DOWorkflowClass>
}

interface HandlerRegistration {
  id: string
  eventKey: string
  handlerId: string
  registered: Date
  /** Flag indicating handler needs re-registration after cold start */
  needsReregistration: boolean
}

/**
 * Handler factory function type - called on cold start to recreate handlers
 * @param eventKey - The event key (e.g., "Customer.signup")
 * @param handlerId - The unique handler ID
 * @returns The handler function or null if handler should be removed
 */
export type HandlerFactory = (eventKey: string, handlerId: string) => EventHandler | null

/**
 * Event handler function type
 */
type EventHandler = (event: unknown) => void | Promise<void>

interface ScheduleRegistration {
  cron: string
  day?: string
  time?: string
  handlerId: string
  registered: Date
}

interface DoActionResult {
  status: 'completed' | 'failed'
  stepId: string
  result?: unknown
  error?: string
}

// ============================================================================
// DOWorkflow Class
// ============================================================================

export class DOWorkflowClass extends DOStorageClass {
  // WorkflowContext instance
  protected $: WorkflowContext
  protected handlers: Map<string, HandlerRegistration[]> = new Map()
  protected workflowSchedules: Map<string, ScheduleRegistration> = new Map()
  protected workflowActionLog: Map<string, { status: string; result?: unknown; error?: string }> = new Map()

  /**
   * Registry of handler factories for re-creating handlers on cold start.
   * Key is the handler ID, value is the factory function.
   */
  private handlerFactories: Map<string, HandlerFactory> = new Map()

  /**
   * Map of active handler functions (recreated from factories on cold start)
   * Key is the registration ID (eventKey:handlerId)
   */
  private activeHandlers: Map<string, EventHandler> = new Map()

  /**
   * Flag indicating if cold start recovery has been performed
   */
  private coldStartRecovered = false

  constructor(ctx: DurableObjectState, env: DOWorkflowEnv) {
    super(ctx, env as unknown as DOStorageEnv)

    // Initialize workflow tables
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS event_handlers (
        id TEXT PRIMARY KEY,
        event_key TEXT,
        handler_id TEXT,
        registered_at INTEGER
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        cron TEXT PRIMARY KEY,
        day TEXT,
        time TEXT,
        handler_id TEXT,
        registered_at INTEGER
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS action_log (
        step_id TEXT PRIMARY KEY,
        status TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER
      )
    `)

    // Initialize circuit breaker state table for cold start recovery
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS circuit_breaker_state (
        tier TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('closed', 'open', 'half_open')),
        failure_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER,
        opened_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `)

    // Initialize WorkflowContext with stub resolver and circuit breaker persistence
    this.$ = createWorkflowContext({
      stubResolver: (noun: string, id: string) => this.resolveStub(noun, id),
      rpcTimeout: 30000,
      circuitBreakerPersistence: {
        save: (state: CircuitBreakerPersistenceState) => this.saveCircuitBreakerState(state),
        load: () => this.loadCircuitBreakerState(),
        clear: () => this.clearCircuitBreakerState(),
      },
    })

    // Load existing data
    this.loadWorkflowData()
  }

  // =========================================================================
  // CIRCUIT BREAKER PERSISTENCE
  // =========================================================================

  /**
   * Save circuit breaker state to SQLite
   */
  private saveCircuitBreakerState(state: CircuitBreakerPersistenceState): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO circuit_breaker_state
       (tier, state, failure_count, success_count, last_failure_at, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      state.tier,
      state.state,
      state.failure_count,
      state.success_count,
      state.last_failure_at,
      state.opened_at,
      state.updated_at
    )
  }

  /**
   * Load circuit breaker state from SQLite
   */
  private loadCircuitBreakerState(): CircuitBreakerPersistenceState[] {
    const rows = this.ctx.storage.sql
      .exec('SELECT tier, state, failure_count, success_count, last_failure_at, opened_at, updated_at FROM circuit_breaker_state')
      .toArray()

    return rows.map((row) => ({
      tier: row.tier as string,
      state: row.state as 'closed' | 'open' | 'half_open',
      failure_count: row.failure_count as number,
      success_count: row.success_count as number,
      last_failure_at: row.last_failure_at as number | null,
      opened_at: row.opened_at as number | null,
      updated_at: row.updated_at as number,
    }))
  }

  /**
   * Clear all circuit breaker state from SQLite
   */
  private clearCircuitBreakerState(): void {
    this.ctx.storage.sql.exec('DELETE FROM circuit_breaker_state')
  }

  private loadWorkflowData(): void {
    // Load handlers - mark all as needing re-registration (cold start)
    const handlers = this.ctx.storage.sql
      .exec('SELECT * FROM event_handlers')
      .toArray()

    for (const row of handlers) {
      const eventKey = row.event_key as string
      const handlerId = row.handler_id as string
      const registration: HandlerRegistration = {
        id: row.id as string,
        eventKey,
        handlerId,
        registered: new Date(row.registered_at as number),
        needsReregistration: true, // Mark for re-registration on cold start
      }

      const existing = this.handlers.get(eventKey) ?? []
      existing.push(registration)
      this.handlers.set(eventKey, existing)
    }

    // Load schedules
    const schedules = this.ctx.storage.sql.exec('SELECT * FROM schedules').toArray()
    for (const row of schedules) {
      this.workflowSchedules.set(row.cron as string, {
        cron: row.cron as string,
        day: row.day as string,
        time: row.time as string,
        handlerId: row.handler_id as string,
        registered: new Date(row.registered_at as number),
      })
    }

    // Load action log
    const actions = this.ctx.storage.sql.exec('SELECT * FROM action_log').toArray()
    for (const row of actions) {
      this.workflowActionLog.set(row.step_id as string, {
        status: row.status as string,
        result: row.result ? JSON.parse(row.result as string) : undefined,
        error: row.error as string | undefined,
      })
    }
  }

  /**
   * Resolve a stub for cross-DO RPC
   */
  protected resolveStub(noun: string, id: string): Record<string, Function> {
    // In a real implementation, this would resolve to actual DO stubs
    // For now, return a proxy that logs calls
    return new Proxy(
      {},
      {
        get: (_target, method: string) => {
          return async (...args: unknown[]) => {
            console.log(`RPC call: ${noun}(${id}).${method}(${JSON.stringify(args)})`)
            return { success: true, noun, id, method, args }
          }
        },
      }
    )
  }

  // =========================================================================
  // WORKFLOWCONTEXT ($) ACCESS
  // =========================================================================

  /**
   * Get the WorkflowContext instance
   */
  getContext(): WorkflowContext {
    return this.$
  }

  // =========================================================================
  // EVENT HANDLER REGISTRATION
  // =========================================================================

  /**
   * Register a handler factory for recreating handlers on cold start.
   * Call this method once during your subclass initialization to register
   * a factory that can recreate handlers by their ID.
   *
   * @param factoryId - Unique ID for this factory (e.g., "my-workflow")
   * @param factory - Function that returns a handler given eventKey and handlerId
   *
   * @example
   * ```typescript
   * class MyWorkflow extends DOWorkflowClass {
   *   constructor(ctx, env) {
   *     super(ctx, env)
   *     this.registerHandlerFactory('my-workflow', (eventKey, handlerId) => {
   *       if (handlerId === 'send-welcome-email') {
   *         return (event) => this.sendWelcomeEmail(event)
   *       }
   *       return null
   *     })
   *     // Trigger re-registration of persisted handlers
   *     this.recoverHandlers()
   *   }
   * }
   * ```
   */
  registerHandlerFactory(factoryId: string, factory: HandlerFactory): void {
    this.handlerFactories.set(factoryId, factory)
  }

  /**
   * Remove a handler factory
   */
  unregisterHandlerFactory(factoryId: string): void {
    this.handlerFactories.delete(factoryId)
  }

  /**
   * Recover handlers after cold start by calling registered factories.
   * This should be called by subclasses after registering their handler factories.
   *
   * @returns Number of handlers successfully recovered
   */
  recoverHandlers(): number {
    if (this.coldStartRecovered) {
      return 0 // Already recovered
    }

    let recoveredCount = 0

    // Iterate through all registered handler metadata
    for (const [eventKey, registrations] of this.handlers) {
      for (const registration of registrations) {
        if (!registration.needsReregistration) {
          continue // Already active
        }

        // Try each factory to find one that can create this handler
        for (const factory of this.handlerFactories.values()) {
          const handler = factory(eventKey, registration.handlerId)
          if (handler) {
            // Found a factory that can create this handler
            this.activateHandler(registration, handler)
            recoveredCount++
            break // Don't try other factories
          }
        }
      }
    }

    this.coldStartRecovered = true
    return recoveredCount
  }

  /**
   * Activate a handler by registering it with the WorkflowContext
   */
  private activateHandler(registration: HandlerRegistration, handler: EventHandler): void {
    const [noun, verb] = registration.eventKey.split('.')

    // Register with WorkflowContext
    this.$.on[noun][verb](handler)

    // Store active handler reference
    this.activeHandlers.set(registration.id, handler)

    // Mark as no longer needing re-registration
    registration.needsReregistration = false
  }

  /**
   * Register an event handler for workflow persistence
   * Returns the number of handlers registered for this event
   *
   * Note: Named registerWorkflowHandler to avoid conflicts with DOCore.registerHandler
   *
   * @param eventKey - Event key (e.g., "Customer.signup")
   * @param handlerId - Unique ID for this handler (used for recovery)
   * @param handler - Optional handler function. If not provided, handler must be
   *                  recovered via a registered factory on cold start.
   */
  registerWorkflowHandler(
    eventKey: string,
    handlerId: string,
    handler?: EventHandler
  ): number {
    const registrationId = `${eventKey}:${handlerId}`
    const registration: HandlerRegistration = {
      id: registrationId,
      eventKey,
      handlerId,
      registered: new Date(),
      needsReregistration: !handler, // Needs re-registration if no handler provided
    }

    // Store in memory
    const existing = this.handlers.get(eventKey) ?? []
    existing.push(registration)
    this.handlers.set(eventKey, existing)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO event_handlers (id, event_key, handler_id, registered_at)
       VALUES (?, ?, ?, ?)`,
      registration.id,
      eventKey,
      handlerId,
      Date.now()
    )

    // If handler provided, activate it immediately
    if (handler) {
      this.activateHandler(registration, handler)
    }

    return existing.length
  }

  /**
   * Unregister an event handler and remove from persistence
   */
  unregisterWorkflowHandler(eventKey: string, handlerId: string): boolean {
    const registrationId = `${eventKey}:${handlerId}`

    // Remove from memory
    const registrations = this.handlers.get(eventKey)
    if (registrations) {
      const idx = registrations.findIndex((r) => r.id === registrationId)
      if (idx >= 0) {
        registrations.splice(idx, 1)
        if (registrations.length === 0) {
          this.handlers.delete(eventKey)
        }
      }
    }

    // Remove active handler
    this.activeHandlers.delete(registrationId)

    // Remove from SQLite
    this.ctx.storage.sql.exec(
      'DELETE FROM event_handlers WHERE id = ?',
      registrationId
    )

    return true
  }

  /**
   * Get handlers that need re-registration (for debugging/monitoring)
   */
  getPendingHandlers(): HandlerRegistration[] {
    const pending: HandlerRegistration[] = []
    for (const registrations of this.handlers.values()) {
      for (const registration of registrations) {
        if (registration.needsReregistration) {
          pending.push(registration)
        }
      }
    }
    return pending
  }

  /**
   * Check if cold start recovery has been performed
   */
  isColdStartRecovered(): boolean {
    return this.coldStartRecovered
  }

  /**
   * Dispatch an event to registered handlers
   */
  async dispatchEvent(eventKey: string, data: unknown): Promise<boolean> {
    const handlers = this.handlers.get(eventKey)
    if (!handlers || handlers.length === 0) {
      return false
    }

    // Check for handlers that haven't been re-registered
    const pendingHandlers = handlers.filter((h) => h.needsReregistration)
    if (pendingHandlers.length > 0) {
      console.warn(
        `[DOWorkflow] ${pendingHandlers.length} handler(s) for ${eventKey} need re-registration. ` +
        `Call recoverHandlers() after registering handler factories.`
      )
    }

    // Dispatch via WorkflowContext
    await this.$.dispatch(eventKey, data)

    return true
  }

  /**
   * Get registered handlers for an event key
   */
  getHandlers(eventKey: string): HandlerRegistration[] {
    return this.handlers.get(eventKey) ?? []
  }

  // =========================================================================
  // SCHEDULE REGISTRATION
  // =========================================================================

  /**
   * Register a scheduled handler for workflow persistence
   * Returns the CRON expression
   *
   * Note: Named registerWorkflowSchedule to avoid conflicts with DOCore.registerSchedule
   */
  registerWorkflowSchedule(day: string, time: string, handlerId: string): string {
    // Map day + time to CRON expression
    const dayMap: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
    }

    const timeMap: Record<string, { hour: number; minute: number }> = {
      at9am: { hour: 9, minute: 0 },
      at5pm: { hour: 17, minute: 0 },
      at6am: { hour: 6, minute: 0 },
    }

    const dow = dayMap[day]
    const { hour, minute } = timeMap[time] ?? { hour: 0, minute: 0 }
    const cron = `${minute} ${hour} * * ${dow}`

    const registration: ScheduleRegistration = {
      cron,
      day,
      time,
      handlerId,
      registered: new Date(),
    }

    // Store in memory
    this.workflowSchedules.set(cron, registration)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO schedules (cron, day, time, handler_id, registered_at)
       VALUES (?, ?, ?, ?, ?)`,
      cron,
      day,
      time,
      handlerId,
      Date.now()
    )

    return cron
  }

  /**
   * Get a registered schedule
   */
  getScheduleByDay(day: string, time: string): ScheduleRegistration | undefined {
    for (const schedule of this.workflowSchedules.values()) {
      if (schedule.day === day && schedule.time === time) {
        return schedule
      }
    }
    return undefined
  }

  // =========================================================================
  // DURABLE EXECUTION
  // =========================================================================

  /**
   * Execute an action with $.do semantics (durable with retries)
   */
  async doAction(stepId: string, actionName: string): Promise<DoActionResult> {
    // Check for existing completed action (replay semantics)
    const existing = this.workflowActionLog.get(stepId)
    if (existing?.status === 'completed') {
      return {
        status: 'completed',
        stepId,
        result: existing.result,
      }
    }

    try {
      // Execute the action
      const result = await this.$.do(
        async () => {
          // Simulate action execution
          return { actionName, executed: true, timestamp: Date.now() }
        },
        { stepId, maxRetries: 3 }
      )

      // Record success
      const entry = { status: 'completed', result }
      this.workflowActionLog.set(stepId, entry)
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO action_log (step_id, status, result, created_at)
         VALUES (?, ?, ?, ?)`,
        stepId,
        'completed',
        JSON.stringify(result),
        Date.now()
      )

      return { status: 'completed', stepId, result }
    } catch (err) {
      const error = (err as Error).message

      // Record failure
      const entry = { status: 'failed', error }
      this.workflowActionLog.set(stepId, entry)
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO action_log (step_id, status, error, created_at)
         VALUES (?, ?, ?, ?)`,
        stepId,
        'failed',
        error,
        Date.now()
      )

      return { status: 'failed', stepId, error }
    }
  }

  /**
   * Send a fire-and-forget event via $.send
   */
  sendEvent(eventType: string, data: unknown): string {
    return this.$.send(eventType, data)
  }

  /**
   * Get the workflow action log
   *
   * Note: Named getWorkflowActionLog to avoid conflicts with DOCore.getActionLog
   */
  getWorkflowActionLog(): Array<{ stepId: string; status: string; result?: unknown; error?: string }> {
    return Array.from(this.workflowActionLog.entries()).map(([stepId, entry]) => ({
      stepId,
      ...entry,
    }))
  }

  /**
   * Get the event log from WorkflowContext
   */
  getEventLog(): Array<{ id: string; type: string }> {
    return this.$.getEventLog()
  }
}

// Use a named export alias for compatibility
export { DOWorkflowClass as DOWorkflow }

// ============================================================================
// Default Worker Export
// ============================================================================

export default {
  async fetch(request: Request, env: DOWorkflowEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOWorkflow.idFromName(ns)
    const stub = env.DOWorkflow.get(id)

    return stub.fetch(request)
  },
}
