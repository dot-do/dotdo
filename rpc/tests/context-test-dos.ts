/**
 * Test Durable Object Classes for Remote Context Tests
 *
 * These DO classes expose the $ (WorkflowContext) API via RPC for testing
 * remote access via FetchTransport.
 *
 * @module rpc/tests/context-test-dos
 */

import {
  createServer,
  createCrossDOClient,
  NotFoundError,
  ValidationError,
  RPCError,
  RPCErrorCode,
} from '../index'
import { createThingsStore, createEventsStore, type ThingsStore, type EventsStore } from '@dotdo/db'

// Type interfaces for cross-DO calls
interface EntityDOInterface {
  greet(name: string): Promise<string>
  getBalance(): Promise<number>
  charge(amount: number): Promise<{ success: boolean; balance: number }>
  throwNotFound(id: string): Promise<never>
  throwValidation(field: string): Promise<never>
}

interface Env {
  CONTEXT_DO: DurableObjectNamespace
  ENTITY_DO: DurableObjectNamespace
}

/**
 * ContextDO - Exposes WorkflowContext ($) operations via RPC
 *
 * This DO provides the things/events/scheduling API that the $ context provides,
 * allowing tests to verify remote access via FetchTransport works correctly.
 */
export class ContextDO implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private app: ReturnType<typeof createServer>
  private things: ThingsStore
  private events: EventsStore
  private handlers: Map<string, Array<(event: unknown) => void>> = new Map()
  private schedules: Map<string, { cron: string; handler: string }> = new Map()
  private eventCount = 0
  private metadata: Map<string, unknown> = new Map()
  private requestId: string | undefined

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.things = createThingsStore()
    this.events = createEventsStore()
    this.app = createServer({ target: this })
  }

  // =========================================================================
  // Things Operations ($.things)
  // =========================================================================

  /**
   * Create a new thing
   */
  async 'things.create'(data: {
    $type: string
    name: string
    [key: string]: unknown
  }): Promise<{ $id: string; $type: string; [key: string]: unknown }> {
    // Cast through unknown for StorableData compatibility
    const result = await this.things.create(data as unknown as Parameters<typeof this.things.create>[0])
    return result
  }

  /**
   * List things with optional filtering
   * Note: ThingsStore uses `type` not `$type` for filtering
   */
  async 'things.list'(
    opts?: { $type?: string; limit?: number }
  ): Promise<Array<{ $id: string; $type: string; [key: string]: unknown }>> {
    // Map $type to type for the thingsStore API
    const storeOpts = opts ? {
      type: opts.$type,
      limit: opts.limit,
    } : undefined
    const results = await this.things.list(storeOpts)
    return results
  }

  /**
   * Get a thing by ID
   */
  async 'things.get'(id: string): Promise<{ $id: string; $type: string; [key: string]: unknown } | null> {
    const result = await this.things.get(id)
    return result
  }

  /**
   * Update a thing by ID
   */
  async 'things.update'(
    id: string,
    data: Record<string, unknown>
  ): Promise<{ $id: string; $type: string; [key: string]: unknown }> {
    // Cast through unknown for StorableData compatibility
    const result = await this.things.update(id, data as unknown as Parameters<typeof this.things.update>[1])
    return result
  }

  /**
   * Delete a thing by ID
   * Returns an object for proper JSON serialization
   */
  async 'things.delete'(id: string): Promise<{ deleted: boolean }> {
    await this.things.delete(id)
    return { deleted: true }
  }

  // =========================================================================
  // Durability Operations ($.send, $.try, $.do)
  // =========================================================================

  /**
   * Send an event (fire-and-forget)
   * Returns void but we need to return something for JSON serialization
   */
  async sendEvent(type: string, payload?: unknown): Promise<{ success: true }> {
    await this.events.emit({
      type,
      payload: (payload ?? null) as import('@dotdo/db').JsonValue,
      source: 'workflow',
    })
    this.eventCount++

    // Invoke any registered handlers
    const typeHandlers = this.handlers.get(type) ?? []
    for (const handler of typeHandlers) {
      try {
        handler({ type, payload })
      } catch {
        // Fire-and-forget - swallow errors
      }
    }

    return { success: true }
  }

  /**
   * Execute a single-attempt action ($.try)
   */
  async tryAction<T>(action: string): Promise<T> {
    // Check if action starts with 'error:' to simulate failures
    if (action.startsWith('error:')) {
      const errorMessage = action.slice(6)
      throw new Error(errorMessage)
    }
    return action as unknown as T
  }

  /**
   * Execute a durable action with retries ($.do)
   */
  async doAction<T>(
    action: string,
    options?: { retries?: number; timeout?: number }
  ): Promise<T> {
    const { retries = 3, timeout = 30000 } = options ?? {}

    // Check if action starts with 'error:' to simulate failures
    if (action.startsWith('error:')) {
      const errorMessage = action.slice(6)
      // Simulate retry behavior by throwing after all retries
      throw new Error(`Failed after ${retries} retries: ${errorMessage}`)
    }

    return action as unknown as T
  }

  // =========================================================================
  // Context State Accessors
  // =========================================================================

  /**
   * Get the count of events emitted
   */
  async getEventCount(): Promise<number> {
    return this.eventCount
  }

  /**
   * Get the count of registered schedules
   */
  async getScheduleCount(): Promise<number> {
    return this.schedules.size
  }

  /**
   * Check if a handler is registered for an event type
   */
  async hasHandler(eventType: string): Promise<boolean> {
    return this.handlers.has(eventType)
  }

  // =========================================================================
  // Event Handler Registration ($.on)
  // =========================================================================

  /**
   * Register an event handler ($.on.Noun.verb)
   * Returns a unique handler ID for verification
   */
  async registerHandler(eventType: string): Promise<{ handlerId: string; eventType: string }> {
    const handlerId = `handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const existingHandlers = this.handlers.get(eventType) ?? []

    // Create a handler function that logs when called
    const handler = (_event: unknown) => {
      // Handler invoked - in real context this would process the event
    }

    this.handlers.set(eventType, [...existingHandlers, handler])

    return { handlerId, eventType }
  }

  /**
   * Get all registered event types (for verification)
   */
  async getRegisteredEventTypes(): Promise<string[]> {
    return Array.from(this.handlers.keys())
  }

  /**
   * Get handler count for a specific event type
   */
  async getHandlerCount(eventType: string): Promise<number> {
    return this.handlers.get(eventType)?.length ?? 0
  }

  // =========================================================================
  // Schedule Registration ($.every)
  // =========================================================================

  /**
   * Register a schedule ($.every.Monday.at('9am'))
   */
  async registerSchedule(scheduleId: string, cron: string): Promise<{ scheduleId: string; cron: string }> {
    this.schedules.set(scheduleId, { cron, handler: `handler-for-${scheduleId}` })
    return { scheduleId, cron }
  }

  /**
   * Get all registered schedules
   */
  async getSchedules(): Promise<Array<{ scheduleId: string; cron: string }>> {
    return Array.from(this.schedules.entries()).map(([id, config]) => ({
      scheduleId: id,
      cron: config.cron,
    }))
  }

  /**
   * Check if a schedule is registered
   */
  async hasSchedule(scheduleId: string): Promise<boolean> {
    return this.schedules.has(scheduleId)
  }

  // =========================================================================
  // Context Propagation ($.run, $.getRequestId, $.setMetadata)
  // =========================================================================

  /**
   * Set request ID for context propagation testing
   */
  async setContextRequestId(requestId: string): Promise<{ requestId: string }> {
    this.requestId = requestId
    return { requestId }
  }

  /**
   * Get current request ID
   */
  async getContextRequestId(): Promise<string | undefined> {
    return this.requestId
  }

  /**
   * Set metadata for context propagation testing
   */
  async setContextMetadata(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    this.metadata.set(key, value)
    return { key, value }
  }

  /**
   * Get metadata by key
   * Returns null instead of undefined for proper JSON serialization
   */
  async getContextMetadata(key: string): Promise<unknown | null> {
    return this.metadata.get(key) ?? null
  }

  /**
   * Get all metadata
   */
  async getAllContextMetadata(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.metadata.entries())
  }

  /**
   * Check if running within context
   */
  async hasContextActive(): Promise<boolean> {
    return this.requestId !== undefined || this.metadata.size > 0
  }

  // =========================================================================
  // Timeout and Retry Testing ($.try with timeout, $.do with retries)
  // =========================================================================

  /**
   * Execute action with configurable delay and potential failure
   * Used for testing timeout behavior
   */
  async executeWithDelay(
    delayMs: number,
    shouldFail: boolean = false,
    result: string = 'completed'
  ): Promise<{ result: string; elapsed: number }> {
    const start = Date.now()
    await new Promise(resolve => setTimeout(resolve, delayMs))

    if (shouldFail) {
      throw new Error('Action failed after delay')
    }

    return { result, elapsed: Date.now() - start }
  }

  /**
   * Execute action with retry simulation
   * Fails N times before succeeding
   */
  private retryAttempts: Map<string, number> = new Map()

  async executeWithRetries(
    actionId: string,
    failUntilAttempt: number = 1,
    result: string = 'success'
  ): Promise<{ result: string; attempts: number }> {
    const currentAttempt = (this.retryAttempts.get(actionId) ?? 0) + 1
    this.retryAttempts.set(actionId, currentAttempt)

    if (currentAttempt < failUntilAttempt) {
      throw new Error(`Attempt ${currentAttempt} failed, need ${failUntilAttempt} attempts`)
    }

    return { result, attempts: currentAttempt }
  }

  /**
   * Reset retry attempts for an action
   */
  async resetRetryAttempts(actionId: string): Promise<{ reset: boolean }> {
    this.retryAttempts.delete(actionId)
    return { reset: true }
  }

  // =========================================================================
  // Cross-DO Operations
  // =========================================================================

  /**
   * Call a method on another DO (tests cross-DO RPC)
   */
  async callRemoteDO(doId: string, method: string, args: unknown[]): Promise<unknown> {
    const client = createCrossDOClient<EntityDOInterface>(this.env.ENTITY_DO, doId)

    // Dynamic method invocation
    const methodFn = client[method as keyof EntityDOInterface] as (
      ...args: unknown[]
    ) => Promise<unknown>
    if (typeof methodFn !== 'function') {
      throw new NotFoundError(`Method "${method}" not found on EntityDO`, { method })
    }

    return methodFn(...args)
  }

  // =========================================================================
  // Fetch Handler
  // =========================================================================

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

/**
 * EntityDO - Simple DO for cross-DO RPC testing
 *
 * This DO provides basic entity operations and error scenarios
 * for testing error propagation via FetchTransport.
 */
export class EntityDO implements DurableObject {
  private state: DurableObjectState
  private app: ReturnType<typeof createServer>
  private balance = 1000

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.app = createServer({ target: this })
  }

  /**
   * Simple greeting method
   */
  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<number> {
    return this.balance
  }

  /**
   * Charge the balance
   */
  async charge(amount: number): Promise<{ success: boolean; balance: number }> {
    if (amount > this.balance) {
      throw new ValidationError('Insufficient balance', {
        requested: amount,
        available: this.balance,
      })
    }
    this.balance -= amount
    return { success: true, balance: this.balance }
  }

  /**
   * Throw a NotFoundError
   */
  async throwNotFound(id: string): Promise<never> {
    throw NotFoundError.forResource('Resource', id)
  }

  /**
   * Throw a ValidationError
   */
  async throwValidation(field: string): Promise<never> {
    throw ValidationError.forField(field, 'is invalid', null)
  }

  /**
   * Fetch handler
   */
  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
