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
import { createWorkflowContext, type WorkflowContext, type CascadeOptions, type CascadeResult } from './workflow-context'

// ============================================================================
// Types
// ============================================================================

export interface DOWorkflowEnv extends DOStorageEnv {
  DOWorkflow: DurableObjectNamespace<DOWorkflowClass>
}

interface HandlerRegistration {
  id: string
  eventKey: string
  registered: Date
}

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

  constructor(ctx: DurableObjectState, env: DOWorkflowEnv) {
    super(ctx, env as DOStorageEnv)

    // Initialize WorkflowContext with stub resolver
    this.$ = createWorkflowContext({
      stubResolver: (noun: string, id: string) => this.resolveStub(noun, id),
      rpcTimeout: 30000,
    })

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

    // Load existing data
    this.loadWorkflowData()
  }

  private loadWorkflowData(): void {
    // Load handlers
    const handlers = this.ctx.storage.sql
      .exec('SELECT * FROM event_handlers')
      .toArray()

    for (const row of handlers) {
      const eventKey = row.event_key as string
      const registration: HandlerRegistration = {
        id: row.id as string,
        eventKey,
        registered: new Date(row.registered_at as number),
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
   * Register an event handler for workflow persistence
   * Returns the number of handlers registered for this event
   *
   * Note: Named registerWorkflowHandler to avoid conflicts with DOCore.registerHandler
   */
  registerWorkflowHandler(eventKey: string, handlerId: string): number {
    const registration: HandlerRegistration = {
      id: `${eventKey}:${handlerId}`,
      eventKey,
      registered: new Date(),
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

    // Also register with WorkflowContext
    this.$.on[eventKey.split('.')[0]][eventKey.split('.')[1]](() => {
      // Handler registered
    })

    return existing.length
  }

  /**
   * Dispatch an event to registered handlers
   */
  async dispatchEvent(eventKey: string, data: unknown): Promise<boolean> {
    const handlers = this.handlers.get(eventKey)
    if (!handlers || handlers.length === 0) {
      return false
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
