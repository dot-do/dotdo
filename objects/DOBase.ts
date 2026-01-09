/**
 * DO - Core Durable Object with WorkflowContext
 *
 * Extends DOTiny (~80KB) with:
 * - WorkflowContext ($)
 * - Event handlers ($.on)
 * - Stores (things, rels, actions, events, search, objects, dlq)
 * - Scheduling ($.every, alarm)
 * - Actor context
 * - Collection accessors
 * - Event emission and dispatch
 *
 * Does NOT include (see DOFull for these):
 * - Lifecycle (fork, clone, compact, move)
 * - Sharding (shard, unshard, routing)
 * - Branching (branch, checkout, merge)
 * - Promotion (promote, demote)
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 *
 * class MyDO extends DO {
 *   async onStart() {
 *     // Use workflow context
 *     this.$.on.Customer.created(async (event) => {
 *       console.log('Customer created:', event)
 *     })
 *
 *     this.$.every.hour(async () => {
 *       // Hourly task
 *     })
 *   }
 * }
 * ```
 */

import { DO as DOTiny, type Env } from './DOTiny'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import * as schema from '../db'
import { isValidNounName } from '../db/nouns'
import {
  createMcpHandler,
  hasMcpConfig,
  type McpSession,
  type McpConfig,
} from './transport/mcp-server'
import { RPCServer, type RPCServerConfig } from './transport/rpc-server'
import type {
  WorkflowContext,
  DomainProxy,
  OnProxy,
  OnNounProxy,
  EventHandler,
  DomainEvent,
  ScheduleBuilder,
  ScheduleHandler,
  TryOptions,
  DoOptions,
  RetryPolicy,
  ActionStatus,
  ActionError,
  HandlerOptions,
  HandlerRegistration,
  EnhancedDispatchResult,
} from '../types/WorkflowContext'
import { createScheduleBuilderProxy, type ScheduleBuilderConfig } from '../workflows/schedule-builder'
import { ScheduleManager, type Schedule } from '../workflows/ScheduleManager'
import type { Thing } from '../types/Thing'
import {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  DLQStore,
  type StoreContext,
  type ThingEntity,
} from '../db/stores'
import { parseNounId } from '../lib/noun-id'
import {
  ai as aiFunc,
  write as writeFunc,
  summarize as summarizeFunc,
  list as listFunc,
  extract as extractFunc,
  is as isFunc,
  decide as decideFunc,
} from '../ai'

// Re-export Env type for consumers
export type { Env }

// ============================================================================
// CROSS-DO ERROR CLASS
// ============================================================================

/**
 * Custom error class for cross-DO call failures with rich context
 */
export class CrossDOError extends Error {
  code: string
  context: {
    targetDO?: string
    method?: string
    source?: string
    attempts?: number
    originalError?: string
  }

  constructor(
    code: string,
    message: string,
    context: {
      targetDO?: string
      method?: string
      source?: string
      attempts?: number
      originalError?: string
    } = {}
  ) {
    super(message)
    this.name = 'CrossDOError'
    this.code = code
    this.context = context

    // Preserve stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CrossDOError)
    }
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        context: this.context,
      },
    }
  }
}

// ============================================================================
// COLLECTION & RELATIONSHIP TYPES
// ============================================================================

export interface ThingsCollection<T extends Thing = Thing> {
  get(id: string): Promise<T | null>
  list(): Promise<T[]>
  find(query: Record<string, unknown>): Promise<T[]>
  create(data: Partial<T>): Promise<T>
}

export interface RelationshipsAccessor {
  create(data: { verb: string; from: string; to: string; data?: unknown }): Promise<{ id: string }>
  list(query?: { from?: string; to?: string; verb?: string }): Promise<RelationshipRecord[]>
}

export interface RelationshipRecord {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}

// ============================================================================
// DO - Core Durable Object with WorkflowContext
// ============================================================================

export class DO<E extends Env = Env> extends DOTiny<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC MCP CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Static MCP configuration for exposing methods as MCP tools and data as resources.
   * Override in subclasses to expose tools and resources.
   *
   * @example
   * ```typescript
   * static $mcp = {
   *   tools: {
   *     search: {
   *       description: 'Search items',
   *       inputSchema: { query: { type: 'string' } },
   *       required: ['query'],
   *     },
   *   },
   *   resources: ['items', 'users'],
   * }
   * ```
   */
  static $mcp?: McpConfig

  // ═══════════════════════════════════════════════════════════════════════════
  // HONO APP (for HTTP routing)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Optional Hono app for HTTP routing.
   * Subclasses can create and configure this for custom routes.
   */
  protected app?: Hono

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP SESSION STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * MCP session storage for this DO instance.
   */
  private _mcpSessions: Map<string, McpSession> = new Map()

  /**
   * Cached MCP handler for this class.
   */
  private _mcpHandler?: (
    instance: { ns: string; [key: string]: unknown },
    request: Request,
    sessions: Map<string, McpSession>
  ) => Promise<Response>

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC SERVER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * RPC Server instance for Cap'n Web RPC protocol support.
   * Lazy-initialized on first access.
   */
  private _rpcServer?: RPCServer

  /**
   * Get the RPC server instance.
   * Creates the server on first access.
   */
  get rpcServer(): RPCServer {
    if (!this._rpcServer) {
      this._rpcServer = new RPCServer(this)
    }
    return this._rpcServer
  }

  /**
   * Check if a method is exposed via RPC.
   * Note: This method is bound in the constructor to ensure `this` is always correct.
   */
  isRpcExposed = (method: string): boolean => {
    return this.rpcServer.isRpcExposed(method)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTOR CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current actor for action logging.
   * Format: 'Type/id' (e.g., 'Human/nathan', 'Agent/support')
   */
  private _currentActor: string = ''

  /**
   * Set the current actor for subsequent action logging.
   */
  protected setActor(actor: string): void {
    this._currentActor = actor
  }

  /**
   * Clear the current actor.
   */
  protected clearActor(): void {
    this._currentActor = ''
  }

  /**
   * Get the current actor for action logging.
   */
  protected getCurrentActor(): string {
    return this._currentActor
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORE ACCESSORS (lazy-loaded)
  // ═══════════════════════════════════════════════════════════════════════════

  private _things?: ThingsStore
  private _rels?: RelationshipsStore
  private _actions?: ActionsStore
  private _events?: EventsStore
  private _search?: SearchStore
  private _objects?: ObjectsStore
  private _dlq?: DLQStore
  private _typeCache: Map<string, number> = new Map()

  // Event handler registry for $.on.Noun.verb() registration
  protected _eventHandlers: Map<string, HandlerRegistration[]> = new Map()
  private _handlerCounter: number = 0

  // Schedule handler registry for $.every scheduling
  protected _scheduleHandlers: Map<string, ScheduleHandler> = new Map()
  private _scheduleManager?: ScheduleManager

  /**
   * Get the schedule manager (lazy initialized)
   */
  protected get scheduleManager(): ScheduleManager {
    if (!this._scheduleManager) {
      this._scheduleManager = new ScheduleManager(this.ctx)
      this._scheduleManager.onScheduleTrigger(async (schedule: Schedule) => {
        const handler = this._scheduleHandlers.get(schedule.name)
        if (handler) {
          await handler()
        }
      })
    }
    return this._scheduleManager
  }

  /**
   * ThingsStore - CRUD operations for Things
   */
  get things(): ThingsStore {
    if (!this._things) {
      this._things = new ThingsStore(this.getStoreContext())
    }
    return this._things
  }

  /**
   * RelationshipsStore - Relationship management
   */
  get rels(): RelationshipsStore {
    if (!this._rels) {
      this._rels = new RelationshipsStore(this.getStoreContext())
    }
    return this._rels
  }

  /**
   * ActionsStore - Action logging and lifecycle
   */
  get actions(): ActionsStore {
    if (!this._actions) {
      this._actions = new ActionsStore(this.getStoreContext())
    }
    return this._actions
  }

  /**
   * EventsStore - Event emission and streaming
   */
  get events(): EventsStore {
    if (!this._events) {
      this._events = new EventsStore(this.getStoreContext())
    }
    return this._events
  }

  /**
   * SearchStore - Full-text and semantic search
   */
  get search(): SearchStore {
    if (!this._search) {
      this._search = new SearchStore(this.getStoreContext())
    }
    return this._search
  }

  /**
   * ObjectsStore - DO registry and resolution
   */
  get objects(): ObjectsStore {
    if (!this._objects) {
      this._objects = new ObjectsStore(this.getStoreContext())
    }
    return this._objects
  }

  /**
   * DLQStore - Dead Letter Queue for failed events
   */
  get dlq(): DLQStore {
    if (!this._dlq) {
      const handlerMap = new Map<string, (data: unknown) => Promise<unknown>>()
      for (const [eventKey, registrations] of this._eventHandlers) {
        if (registrations.length > 0) {
          handlerMap.set(eventKey, async (data) => {
            const event: DomainEvent = {
              id: `dlq-replay-${crypto.randomUUID()}`,
              verb: eventKey.split('.')[1] || '',
              source: `https://${this.ns}/${eventKey.split('.')[0]}/replay`,
              data,
              timestamp: new Date(),
            }
            await this.dispatchEventToHandlers(event)
          })
        }
      }
      this._dlq = new DLQStore(this.getStoreContext(), handlerMap)
    }
    return this._dlq
  }

  /**
   * Get the store context for initializing stores
   */
  private getStoreContext(): StoreContext {
    return {
      db: this.db,
      ns: this.ns,
      currentBranch: this.currentBranch,
      env: this.env as StoreContext['env'],
      typeCache: this._typeCache,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW CONTEXT ($)
  // ═══════════════════════════════════════════════════════════════════════════

  readonly $: WorkflowContext

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env)

    // Initialize workflow context
    this.$ = this.createWorkflowContext()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW CONTEXT FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  protected createWorkflowContext(): WorkflowContext {
    const self = this

    return new Proxy({} as WorkflowContext, {
      get(_, prop: string) {
        switch (prop) {
          // Execution modes
          case 'send':
            return self.send.bind(self)
          case 'try':
            return self.try.bind(self)
          case 'do':
            return self.do.bind(self)

          // Event subscriptions and scheduling
          case 'on':
            return self.createOnProxy()
          case 'every':
            return self.createScheduleBuilder()

          // Utilities
          case 'log':
            return self.log.bind(self)
          case 'state':
            return {}

          // AI Functions - Generation
          case 'ai':
            return aiFunc
          case 'write':
            return writeFunc
          case 'summarize':
            return summarizeFunc
          case 'list':
            return listFunc
          case 'extract':
            return extractFunc

          // AI Functions - Classification
          case 'is':
            return isFunc
          case 'decide':
            return decideFunc

          default:
            // Domain resolution: $.Noun(id)
            return (id: string) => self.createDomainProxy(prop, id)
        }
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION MODES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Default retry policy for durable execution
   */
  protected static readonly DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
  }

  protected static readonly DEFAULT_TRY_TIMEOUT = 30000

  private _stepCache: Map<string, { result: unknown; completedAt: number }> = new Map()

  /**
   * Fire-and-forget event emission (non-blocking, non-durable)
   * Errors are logged but don't propagate (by design for fire-and-forget)
   */
  protected send(event: string, data: unknown): void {
    queueMicrotask(() => {
      this.logAction('send', event, data).catch((error) => {
        console.error(`[send] Failed to log action for ${event}:`, error)
        this.emitSystemError('send.logAction.failed', event, error)
      })
      this.emitEvent(event, data).catch((error) => {
        console.error(`[send] Failed to emit event ${event}:`, error)
        this.emitSystemError('send.emitEvent.failed', event, error)
      })
      this.executeAction(event, data).catch((error) => {
        console.error(`[send] Failed to execute action ${event}:`, error)
        this.emitSystemError('send.executeAction.failed', event, error)
      })
    })
  }

  /**
   * Emit a system error event for monitoring/observability
   * This is a best-effort operation that should never throw
   */
  private emitSystemError(errorType: string, originalEvent: string, error: unknown): void {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined

      // Log to console for immediate visibility
      console.error(`[system.${errorType}]`, {
        ns: this.ns,
        originalEvent,
        error: errorMessage,
        stack: errorStack,
      })

      // Try to persist to DLQ for later replay
      this.dlq.add({
        eventId: `system-error-${crypto.randomUUID()}`,
        verb: errorType,
        source: this.ns,
        data: { originalEvent, error: errorMessage },
        error: errorMessage,
        errorStack,
        maxRetries: 3,
      }).catch(() => {
        // Absolute last resort - can't even log to DLQ
        console.error(`[CRITICAL] Failed to add system error to DLQ: ${errorType}`)
      })
    } catch {
      // Never throw from error handler
    }
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   */
  protected async try<T>(action: string, data: unknown, options?: TryOptions): Promise<T> {
    const timeout = options?.timeout ?? DO.DEFAULT_TRY_TIMEOUT
    const startedAt = new Date()

    const actionRecord = await this.logAction('try', action, data)
    await this.updateActionStatus(actionRecord.id, 'running', { startedAt })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Action '${action}' timed out after ${timeout}ms`))
      }, timeout)
    })

    try {
      const result = await Promise.race([
        this.executeAction(action, data),
        timeoutPromise,
      ]) as T

      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      await this.completeAction(actionRecord.id, result, { completedAt, duration })
      await this.emitEvent(`${action}.completed`, { result })

      return result
    } catch (error) {
      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      const actionError: ActionError = {
        message: (error as Error).message,
        name: (error as Error).name,
        stack: (error as Error).stack,
      }

      await this.failAction(actionRecord.id, actionError, { completedAt, duration })
      await this.emitEvent(`${action}.failed`, { error: actionError }).catch(() => {})

      throw error
    }
  }

  /**
   * Durable execution with retries (blocking, durable)
   */
  protected async do<T>(action: string, data: unknown, options?: DoOptions): Promise<T> {
    const retryPolicy: RetryPolicy = {
      ...DO.DEFAULT_RETRY_POLICY,
      ...options?.retry,
    }

    const stepId = options?.stepId ?? this.generateStepId(action, data)

    const cachedResult = this._stepCache.get(stepId)
    if (cachedResult) {
      return cachedResult.result as T
    }

    const startedAt = new Date()
    const actionRecord = await this.logAction('do', action, data)

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      attempts = attempt

      const status: ActionStatus = attempt === 1 ? 'running' : 'retrying'
      await this.updateActionStatus(actionRecord.id, status, { startedAt, attempts })

      try {
        const result = await this.executeAction(action, data) as T

        const completedAt = new Date()
        const duration = completedAt.getTime() - startedAt.getTime()

        await this.completeAction(actionRecord.id, result, { completedAt, duration, attempts })

        this._stepCache.set(stepId, { result, completedAt: completedAt.getTime() })
        await this.persistStepResult(stepId, result)
        await this.emitEvent(`${action}.completed`, { result })

        return result
      } catch (error) {
        lastError = error as Error
        await this.updateActionAttempts(actionRecord.id, attempts)

        if (attempt < retryPolicy.maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt, retryPolicy)
          await this.sleep(delay)
        }
      }
    }

    const completedAt = new Date()
    const duration = completedAt.getTime() - startedAt.getTime()

    const actionError: ActionError = {
      message: lastError!.message,
      name: lastError!.name,
      stack: lastError!.stack,
    }

    await this.failAction(actionRecord.id, actionError, { completedAt, duration, attempts })
    await this.emitEvent(`${action}.failed`, { error: actionError })

    throw lastError
  }

  protected calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
    let delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)
    delay = Math.min(delay, policy.maxDelayMs)

    if (policy.jitter) {
      const jitterRange = delay * 0.25
      delay += Math.random() * jitterRange
    }

    return Math.floor(delay)
  }

  protected generateStepId(action: string, data: unknown): string {
    const content = JSON.stringify({ action, data })
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${action}:${Math.abs(hash).toString(36)}`
  }

  protected async persistStepResult(stepId: string, result: unknown): Promise<void> {
    try {
      await this.ctx.storage.put(`step:${stepId}`, { result, completedAt: Date.now() })
    } catch {
      // Best effort persistence
    }
  }

  protected async loadPersistedSteps(): Promise<void> {
    try {
      const steps = await this.ctx.storage.list({ prefix: 'step:' })
      for (const [key, value] of steps) {
        const stepId = key.replace('step:', '')
        const data = value as { result: unknown; completedAt: number }
        this._stepCache.set(stepId, data)
      }
    } catch {
      // Best effort loading
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION LOGGING (append-only)
  // ═══════════════════════════════════════════════════════════════════════════

  protected async logAction(
    durability: 'send' | 'try' | 'do',
    verb: string,
    input: unknown
  ): Promise<{ id: string; rowid: number }> {
    const id = crypto.randomUUID()

    await this.db
      .insert(schema.actions)
      // @ts-expect-error - Schema field names may differ
      .values({
        id,
        verb,
        target: this.ns,
        actor: this._currentActor,
        input: input as Record<string, unknown>,
        durability,
        status: 'pending',
        createdAt: new Date(),
      })

    return { id, rowid: 0 }
  }

  protected async updateActionStatus(
    actionId: string,
    status: ActionStatus,
    fields?: { startedAt?: Date; attempts?: number }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = { status }

      if (fields?.startedAt) {
        updateData.startedAt = fields.startedAt
      }
      if (fields?.attempts !== undefined) {
        updateData.options = JSON.stringify({ attempts: fields.attempts })
      }

      await this.db
        .update(schema.actions)
        .set(updateData)
        .where(eq(schema.actions.id, actionId))
    } catch {
      // Best effort status update
    }
  }

  protected async updateActionAttempts(actionId: string, attempts: number): Promise<void> {
    try {
      await this.db
        .update(schema.actions)
        .set({ options: JSON.stringify({ attempts }) })
        .where(eq(schema.actions.id, actionId))
    } catch {
      // Best effort update
    }
  }

  protected async completeAction(
    actionId: string,
    output: unknown,
    fields?: { completedAt?: Date; duration?: number; attempts?: number }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status: 'completed' as ActionStatus,
        output: output as number,
      }

      if (fields?.completedAt) {
        updateData.completedAt = fields.completedAt
      }
      if (fields?.duration !== undefined) {
        updateData.duration = fields.duration
      }
      if (fields?.attempts !== undefined) {
        updateData.options = JSON.stringify({ attempts: fields.attempts })
      }

      await this.db
        .update(schema.actions)
        .set(updateData)
        .where(eq(schema.actions.id, actionId))
    } catch {
      // Best effort completion
    }
  }

  protected async failAction(
    actionId: string,
    error: ActionError,
    fields?: { completedAt?: Date; duration?: number; attempts?: number }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status: 'failed' as ActionStatus,
        error: error,
      }

      if (fields?.completedAt) {
        updateData.completedAt = fields.completedAt
      }
      if (fields?.duration !== undefined) {
        updateData.duration = fields.duration
      }
      if (fields?.attempts !== undefined) {
        updateData.options = JSON.stringify({ attempts: fields.attempts })
      }

      await this.db
        .update(schema.actions)
        .set(updateData)
        .where(eq(schema.actions.id, actionId))
    } catch {
      // Best effort failure recording
    }
  }

  /**
   * Execute an action - override in subclasses to handle specific actions
   */
  protected async executeAction(action: string, data: unknown): Promise<unknown> {
    throw new Error(`Unknown action: ${action}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    const eventId = crypto.randomUUID()
    let dbError: Error | null = null
    let pipelineError: Error | null = null

    // Attempt database insert with error capture
    try {
      await this.db.insert(schema.events).values({
        id: eventId,
        verb,
        source: this.ns,
        data: data as Record<string, unknown>,
        sequence: 0,
        streamed: false,
        createdAt: new Date(),
      })
    } catch (error) {
      dbError = error instanceof Error ? error : new Error(String(error))
      console.error(`[emitEvent] Database insert failed for ${verb}:`, dbError.message)

      // Add to DLQ for retry
      try {
        await this.dlq.add({
          eventId,
          verb,
          source: this.ns,
          data: data as Record<string, unknown>,
          error: dbError.message,
          errorStack: dbError.stack,
          maxRetries: 3,
        })
      } catch (dlqError) {
        console.error(`[emitEvent] Failed to add to DLQ:`, dlqError)
      }
    }

    // Attempt pipeline send with error capture and retry
    if (this.env.PIPELINE) {
      const maxPipelineRetries = 3
      const baseDelay = 100

      for (let attempt = 1; attempt <= maxPipelineRetries; attempt++) {
        try {
          await this.env.PIPELINE.send([{
            verb,
            source: this.ns,
            $context: this.ns,
            data,
            timestamp: new Date().toISOString(),
          }])
          pipelineError = null // Success - clear any previous error
          break
        } catch (error) {
          pipelineError = error instanceof Error ? error : new Error(String(error))
          console.error(`[emitEvent] Pipeline send attempt ${attempt}/${maxPipelineRetries} failed for ${verb}:`, pipelineError.message)

          if (attempt < maxPipelineRetries) {
            // Exponential backoff
            const delay = baseDelay * Math.pow(2, attempt - 1)
            await this.sleep(delay)
          }
        }
      }

      // If all pipeline retries failed, log for metrics
      if (pipelineError) {
        console.error(`[emitEvent] Pipeline send failed after ${maxPipelineRetries} attempts for ${verb}`)
      }
    }

    // Emit system error event if either operation failed (for observability)
    if (dbError || pipelineError) {
      try {
        // Use console for metrics visibility (can be scraped by log aggregators)
        console.error('[metrics.event.emission.failure]', {
          ns: this.ns,
          verb,
          dbError: dbError?.message ?? null,
          pipelineError: pipelineError?.message ?? null,
        })
      } catch {
        // Never throw from error reporting
      }
    }
  }

  /**
   * Emit an event (public wrapper for emitEvent)
   */
  protected async emit(verb: string, data?: unknown): Promise<void> {
    return this.emitEvent(verb, data)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN FK RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  protected async resolveNounToFK(noun: string): Promise<number> {
    if (!noun || noun.trim() === '') {
      throw new Error('Noun name cannot be empty')
    }

    if (!isValidNounName(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    const cached = this._typeCache.get(noun)
    if (cached !== undefined) {
      return cached
    }

    const results = await this.db
      .select({
        noun: schema.nouns.noun,
        rowid: sql<number>`rowid`,
      })
      .from(schema.nouns)
      .where(eq(schema.nouns.noun, noun))

    if (results.length === 0) {
      throw new Error(`Noun '${noun}' not found in nouns table. Register it first with registerNoun().`)
    }

    const fk = results[0].rowid
    this._typeCache.set(noun, fk)

    return fk
  }

  protected async registerNoun(
    noun: string,
    config?: { plural?: string; description?: string; schema?: unknown; doClass?: string }
  ): Promise<number> {
    if (!noun || noun.trim() === '') {
      throw new Error('Noun name cannot be empty')
    }

    if (!isValidNounName(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    const cached = this._typeCache.get(noun)
    if (cached !== undefined) {
      return cached
    }

    const existing = await this.db
      .select({
        noun: schema.nouns.noun,
        rowid: sql<number>`rowid`,
      })
      .from(schema.nouns)
      .where(eq(schema.nouns.noun, noun))

    if (existing.length > 0) {
      const fk = existing[0].rowid
      this._typeCache.set(noun, fk)
      return fk
    }

    await this.db.insert(schema.nouns).values({
      noun,
      plural: config?.plural ?? `${noun}s`,
      description: config?.description ?? null,
      schema: config?.schema ? JSON.stringify(config.schema) : null,
      doClass: config?.doClass ?? null,
    })

    const inserted = await this.db
      .select({
        noun: schema.nouns.noun,
        rowid: sql<number>`rowid`,
      })
      .from(schema.nouns)
      .where(eq(schema.nouns.noun, noun))

    if (inserted.length === 0) {
      throw new Error(`Failed to register noun '${noun}'`)
    }

    const fk = inserted[0].rowid
    this._typeCache.set(noun, fk)

    return fk
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TYPED COLLECTION ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  protected collection<T extends Thing = Thing>(noun: string): ThingsCollection<T> {
    if (!noun || noun.trim() === '') {
      throw new Error('Noun name cannot be empty')
    }

    if (!isValidNounName(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    const self = this
    return {
      get: async (id: string): Promise<T | null> => {
        const typeFK = await self.resolveNounToFK(noun)
        const results = await self.db.select().from(schema.things)
        const result = results.find((r) => r.id === id && r.type === typeFK && !r.deleted)
        if (!result) return null
        const data = result.data as Record<string, unknown> | null
        return { $id: result.id, $type: noun, ...data } as T
      },
      list: async (): Promise<T[]> => {
        const typeFK = await self.resolveNounToFK(noun)
        const results = await self.db.select().from(schema.things)
        return results
          .filter((r) => r.type === typeFK && !r.deleted)
          .map((r) => {
            const data = r.data as Record<string, unknown> | null
            return { $id: r.id, $type: noun, ...data } as T
          })
      },
      find: async (query: Record<string, unknown>): Promise<T[]> => {
        const typeFK = await self.resolveNounToFK(noun)
        const results = await self.db.select().from(schema.things)
        return results
          .filter((r) => {
            if (r.type !== typeFK || r.deleted) return false
            const data = r.data as Record<string, unknown> | null
            if (!data) return false
            return Object.entries(query).every(([key, value]) => data[key] === value)
          })
          .map((r) => {
            const data = r.data as Record<string, unknown> | null
            return { $id: r.id, $type: noun, ...data } as T
          })
      },
      create: async (data: Partial<T>): Promise<T> => {
        const typeFK = await self.resolveNounToFK(noun)
        const id = (data as Record<string, unknown>).$id as string || crypto.randomUUID()
        await self.db.insert(schema.things).values({
          id,
          type: typeFK,
          branch: self.currentBranch,
          data: data as Record<string, unknown>,
          deleted: false,
        })
        self._typeCache.set(noun, typeFK)
        return { ...data, $id: id, $type: noun } as T
      },
    }
  }

  /**
   * Relationships table accessor
   */
  protected get relationships(): RelationshipsAccessor {
    return {
      create: async (data: { verb: string; from: string; to: string; data?: unknown }): Promise<{ id: string }> => {
        const id = crypto.randomUUID()
        await this.db.insert(schema.relationships).values({
          id,
          verb: data.verb,
          from: data.from,
          to: data.to,
          data: data.data as Record<string, unknown> | null,
          createdAt: new Date(),
        })
        return { id }
      },
      list: async (query?: { from?: string; to?: string; verb?: string }): Promise<RelationshipRecord[]> => {
        const results = await this.db.select().from(schema.relationships)
        return results
          .filter((r) => {
            if (query?.from && r.from !== query.from) return false
            if (query?.to && r.to !== query.to) return false
            if (query?.verb && r.verb !== query.verb) return false
            return true
          })
          .map((r) => ({
            id: r.id,
            verb: r.verb,
            from: r.from,
            to: r.to,
            data: r.data as Record<string, unknown> | null,
            createdAt: r.createdAt,
          }))
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROXY FACTORIES
  // ═══════════════════════════════════════════════════════════════════════════

  protected createOnProxy(): OnProxy {
    const self = this

    return new Proxy({} as OnProxy, {
      get: (_, noun: string): OnNounProxy => {
        return new Proxy({} as OnNounProxy, {
          get: (_, verb: string): ((handler: EventHandler, options?: HandlerOptions) => void) => {
            return (handler: EventHandler, options?: HandlerOptions): void => {
              const eventKey = `${noun}.${verb}`
              const registrations = self._eventHandlers.get(eventKey) ?? []

              const handlerName = options?.name
                || (handler as Function).name
                || `handler_${++self._handlerCounter}`

              const registration: HandlerRegistration = {
                name: handlerName,
                priority: options?.priority ?? 0,
                registeredAt: Date.now(),
                sourceNs: self.ns,
                handler,
                filter: options?.filter,
                maxRetries: options?.maxRetries ?? 3,
                executionCount: 0,
                successCount: 0,
                failureCount: 0,
              }

              registrations.push(registration)
              registrations.sort((a, b) => {
                if (b.priority !== a.priority) {
                  return b.priority - a.priority
                }
                return a.registeredAt - b.registeredAt
              })

              self._eventHandlers.set(eventKey, registrations)
            }
          },
        })
      },
    })
  }

  protected createScheduleBuilder(): ScheduleBuilder {
    const self = this

    const config: ScheduleBuilderConfig = {
      state: this.ctx,
      onScheduleRegistered: (cron: string, name: string, handler: ScheduleHandler) => {
        self._scheduleHandlers.set(name, handler)
        self.scheduleManager.schedule(cron, name).catch((error) => {
          console.error(`Failed to register schedule ${name}:`, error)
        })
      },
    }

    return createScheduleBuilderProxy(config) as unknown as ScheduleBuilder
  }

  protected createDomainProxy(noun: string, id: string): DomainProxy {
    const self = this

    return new Proxy({} as DomainProxy, {
      get(_, method: string) {
        if (method === 'then' || method === 'catch' || method === 'finally') {
          return undefined
        }

        return (...args: unknown[]): Promise<unknown> => {
          return self.invokeDomainMethod(noun, id, method as string, args)
        }
      },
    })
  }

  protected async invokeDomainMethod(
    noun: string,
    id: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    const localMethod = (this as unknown as Record<string, unknown>)[method]

    if (typeof localMethod === 'function') {
      try {
        return await localMethod.apply(this, args)
      } catch (error) {
        throw error
      }
    }

    return this.invokeCrossDOMethod(noun, id, method, args)
  }

  // Circuit breaker state for cross-DO calls (per target DO)
  private static _circuitBreakers: Map<string, {
    failures: number
    lastFailure: number
    state: 'closed' | 'open' | 'half-open'
  }> = new Map()

  // Circuit breaker configuration
  private static readonly CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenRequests: 1,
  }

  // Cross-DO retry configuration
  private static readonly CROSS_DO_RETRY_CONFIG = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    retryableStatuses: [500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
  }

  // Default timeout for cross-DO calls
  private static readonly CROSS_DO_TIMEOUT_MS = 30000

  protected async invokeCrossDOMethod(
    noun: string,
    id: string,
    method: string,
    args: unknown[],
    options?: { timeout?: number }
  ): Promise<unknown> {
    if (!this.env.DO) {
      throw new Error(`Method '${method}' not found and DO namespace not configured for cross-DO calls`)
    }

    const targetNs = `${noun}/${id}`
    const timeout = options?.timeout ?? DO.CROSS_DO_TIMEOUT_MS

    // Check circuit breaker
    const circuitState = this.checkCircuitBreaker(targetNs)
    if (circuitState === 'open') {
      throw new CrossDOError(
        'CIRCUIT_BREAKER_OPEN',
        `Circuit breaker open for ${targetNs}`,
        { targetDO: targetNs, source: this.ns }
      )
    }

    const doNamespace = this.env.DO as {
      idFromName(name: string): unknown
      get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
    }

    const doId = doNamespace.idFromName(targetNs)
    const stub = doNamespace.get(doId)

    const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, retryableStatuses } = DO.CROSS_DO_RETRY_CONFIG

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt

      try {
        const response = await this.fetchWithCrossDOTimeout(
          stub,
          `https://${targetNs}/rpc/${method}`,
          { args },
          timeout
        )

        // Check for rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)
          if (attempt < maxAttempts) {
            await this.sleep(Math.min(delay, maxDelayMs))
            continue
          }
        }

        // Non-retryable client errors
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const errorText = await response.text()
          this.recordCircuitBreakerSuccess(targetNs)
          throw new CrossDOError(
            'CROSS_DO_CLIENT_ERROR',
            `Cross-DO RPC failed: ${response.status} - ${errorText}`,
            { targetDO: targetNs, method, source: this.ns }
          )
        }

        // Retryable server errors
        if (!response.ok && retryableStatuses.includes(response.status)) {
          const errorText = await response.text()
          lastError = new Error(`Cross-DO RPC failed: ${response.status} - ${errorText}`)

          if (attempt < maxAttempts) {
            const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs)
            await this.sleep(delay)
            continue
          }
        }

        if (!response.ok) {
          const errorText = await response.text()
          this.recordCircuitBreakerFailure(targetNs)
          throw new CrossDOError(
            'CROSS_DO_ERROR',
            `Cross-DO RPC failed: ${response.status} - ${errorText}`,
            { targetDO: targetNs, method, attempts, source: this.ns }
          )
        }

        const result = await response.json() as { result?: unknown; error?: string }

        if (result.error) {
          this.recordCircuitBreakerFailure(targetNs)
          throw new CrossDOError(
            'CROSS_DO_ERROR',
            result.error,
            { targetDO: targetNs, method, source: this.ns }
          )
        }

        // Success - record and return
        this.recordCircuitBreakerSuccess(targetNs)
        return result.result

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check for timeout
        if (lastError.name === 'AbortError' || lastError.message.includes('timeout')) {
          this.recordCircuitBreakerFailure(targetNs)
          throw new CrossDOError(
            'CROSS_DO_TIMEOUT',
            `Cross-DO call to ${targetNs}.${method}() timed out after ${timeout}ms`,
            { targetDO: targetNs, method, source: this.ns }
          )
        }

        // Check if error is retryable
        const isRetryable = DO.CROSS_DO_RETRY_CONFIG.retryableErrors.some(
          errType => lastError!.message.includes(errType)
        )

        if (isRetryable && attempt < maxAttempts) {
          const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs)
          await this.sleep(delay)
          continue
        }

        // Not retryable or exhausted retries
        this.recordCircuitBreakerFailure(targetNs)
        throw lastError
      }
    }

    // Exhausted all retries
    this.recordCircuitBreakerFailure(targetNs)
    throw new CrossDOError(
      'CROSS_DO_ERROR',
      `Cross-DO call failed after ${attempts} attempts`,
      {
        targetDO: targetNs,
        method,
        attempts,
        source: this.ns,
        originalError: lastError?.message,
      }
    )
  }

  /**
   * Fetch with timeout for cross-DO calls
   */
  private async fetchWithCrossDOTimeout(
    stub: { fetch(request: Request | string, init?: RequestInit): Promise<Response> },
    url: string,
    body: unknown,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await stub.fetch(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Check circuit breaker state for a target DO
   */
  private checkCircuitBreaker(targetNs: string): 'closed' | 'open' | 'half-open' {
    const breaker = DO._circuitBreakers.get(targetNs)
    if (!breaker) return 'closed'

    const { failureThreshold, resetTimeoutMs } = DO.CIRCUIT_BREAKER_CONFIG

    if (breaker.state === 'open') {
      // Check if enough time has passed to try half-open
      if (Date.now() - breaker.lastFailure >= resetTimeoutMs) {
        breaker.state = 'half-open'
        return 'half-open'
      }
      return 'open'
    }

    if (breaker.failures >= failureThreshold) {
      breaker.state = 'open'
      return 'open'
    }

    return breaker.state
  }

  /**
   * Record a successful cross-DO call (reset circuit breaker)
   */
  private recordCircuitBreakerSuccess(targetNs: string): void {
    DO._circuitBreakers.set(targetNs, {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
    })
  }

  /**
   * Record a failed cross-DO call
   */
  private recordCircuitBreakerFailure(targetNs: string): void {
    const breaker = DO._circuitBreakers.get(targetNs) ?? {
      failures: 0,
      lastFailure: 0,
      state: 'closed' as const,
    }

    breaker.failures++
    breaker.lastFailure = Date.now()

    if (breaker.failures >= DO.CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      breaker.state = 'open'
    }

    DO._circuitBreakers.set(targetNs, breaker)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  getEventHandlers(eventKey: string): Function[] {
    const registrations = this._eventHandlers.get(eventKey) ?? []
    return registrations.map((r) => r.handler)
  }

  getHandlersByPriority(eventKey: string): Array<{ handler: Function; priority: number }> {
    const registrations = this._eventHandlers.get(eventKey) ?? []
    return registrations.map((r) => ({ handler: r.handler, priority: r.priority }))
  }

  getHandlerMetadata(eventKey: string, handlerName: string): HandlerRegistration | undefined {
    const registrations = this._eventHandlers.get(eventKey) ?? []
    return registrations.find((r) => r.name === handlerName)
  }

  getHandlerRegistrations(eventKey: string): HandlerRegistration[] {
    return this._eventHandlers.get(eventKey) ?? []
  }

  listAllHandlers(): Map<string, HandlerRegistration[]> {
    return new Map(this._eventHandlers)
  }

  private collectMatchingHandlers(noun: string, verb: string): HandlerRegistration[] {
    const matchingHandlers: Array<{ registration: HandlerRegistration; isWildcard: boolean }> = []
    const exactKey = `${noun}.${verb}`
    for (const reg of this._eventHandlers.get(exactKey) ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: false })
    }
    for (const reg of this._eventHandlers.get(`*.${verb}`) ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: true })
    }
    for (const reg of this._eventHandlers.get(`${noun}.*`) ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: true })
    }
    for (const reg of this._eventHandlers.get('*.*') ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: true })
    }
    matchingHandlers.sort((a, b) => {
      if (b.registration.priority !== a.registration.priority) {
        return b.registration.priority - a.registration.priority
      }
      if (a.isWildcard !== b.isWildcard) {
        return a.isWildcard ? 1 : -1
      }
      return a.registration.registeredAt - b.registration.registeredAt
    })
    return matchingHandlers.map((h) => h.registration)
  }

  async dispatchEventToHandlers(event: DomainEvent): Promise<EnhancedDispatchResult> {
    const sourceParts = event.source.split('/')
    const noun = sourceParts[sourceParts.length - 2] || ''
    const registrations = this.collectMatchingHandlers(noun, event.verb)

    let handled = 0
    let filtered = 0
    let wildcardMatches = 0
    const errors: Error[] = []
    const dlqEntries: string[] = []

    const exactKey = `${noun}.${event.verb}`
    const exactRegistrations = new Set((this._eventHandlers.get(exactKey) ?? []).map((r) => r.name))

    for (const registration of registrations) {
      if (!exactRegistrations.has(registration.name)) {
        wildcardMatches++
      }
      if (registration.filter) {
        try {
          const shouldExecute = await registration.filter(event)
          if (!shouldExecute) {
            filtered++
            continue
          }
        } catch {
          filtered++
          continue
        }
      }
      registration.executionCount++
      registration.lastExecutedAt = Date.now()
      try {
        await registration.handler(event)
        registration.successCount++
        handled++
      } catch (e) {
        registration.failureCount++
        const error = e instanceof Error ? e : new Error(String(e))
        errors.push(error)
        try {
          const dlqEntry = await this.dlq.add({
            eventId: event.id,
            verb: `${noun}.${event.verb}`,
            source: event.source,
            data: event.data as Record<string, unknown>,
            error: error.message,
            errorStack: error.stack,
            maxRetries: registration.maxRetries,
          })
          dlqEntries.push(dlqEntry.id)
        } catch {
          console.error('Failed to add event to DLQ')
        }
      }
    }
    return { handled, errors, dlqEntries, filtered, wildcardMatches }
  }

  unregisterEventHandler(eventKey: string, handler: Function): boolean {
    const registrations = this._eventHandlers.get(eventKey)
    if (!registrations) {
      return false
    }
    const index = registrations.findIndex((r) => r.handler === handler)
    if (index > -1) {
      registrations.splice(index, 1)
      return true
    }
    return false
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve any URL to a Thing (local, cross-DO, or external)
   */
  async resolve(url: string): Promise<Thing> {
    const parsed = new URL(url)
    const ns = `${parsed.protocol}//${parsed.host}`
    const path = parsed.pathname.slice(1)
    const ref = parsed.hash.slice(1) || 'main'

    if (ns === this.ns) {
      return this.resolveLocal(path, ref)
    } else {
      return this.resolveCrossDO(ns, path, ref)
    }
  }

  protected async resolveLocal(path: string, ref: string): Promise<Thing> {
    const parsed = parseNounId(path)
    const branch = parsed.branch ?? (ref || this.currentBranch)
    const thingId = parsed.id

    if (parsed.version !== undefined || parsed.relativeVersion !== undefined) {
      const versions = await this.things.versions(thingId)
      if (versions.length === 0) {
        throw new Error(`Thing not found: ${path}`)
      }

      let targetVersion: (typeof versions)[0] | undefined

      if (parsed.version !== undefined) {
        const versionIndex = parsed.version - 1
        if (versionIndex < 0 || versionIndex >= versions.length) {
          throw new Error(`Thing not found: ${path}`)
        }
        targetVersion = versions[versionIndex]
      } else if (parsed.relativeVersion !== undefined) {
        const targetIndex = versions.length - 1 - parsed.relativeVersion
        if (targetIndex < 0) {
          throw new Error(`Relative version @~${parsed.relativeVersion} exceeds available versions (${versions.length} total)`)
        }
        targetVersion = versions[targetIndex]
      }

      if (!targetVersion) {
        throw new Error(`Version not found for path: ${path}`)
      }

      const fullId = this.ns ? `${this.ns}/${parsed.noun}/${parsed.id}` : `${parsed.noun}/${parsed.id}`
      return {
        $id: fullId,
        $type: parsed.noun,
        name: targetVersion.name ?? undefined,
        data: targetVersion.data ?? undefined,
      } as Thing
    }

    const options: { branch?: string } = {}
    if (branch && branch !== 'main') {
      options.branch = branch
    }

    const thing = await this.things.get(thingId, options)

    if (!thing) {
      throw new Error(`Thing not found: ${path}`)
    }

    const fullId = this.ns ? `${this.ns}/${parsed.noun}/${parsed.id}` : `${parsed.noun}/${parsed.id}`

    return {
      $id: fullId,
      $type: parsed.noun,
      name: thing.name ?? undefined,
      data: thing.data ?? undefined,
    } as Thing
  }

  protected async resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing> {
    const obj = await this.objects.get(ns)

    if (!obj) {
      throw new Error(`Unknown namespace: ${ns}`)
    }

    if (!this.env.DO) {
      throw new Error('DO namespace binding not configured')
    }

    const doNamespace = this.env.DO as {
      idFromString(id: string): unknown
      get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
    }
    const id = doNamespace.idFromString(obj.id)
    const stub = doNamespace.get(id)

    const resolveUrl = new URL(`${ns}/resolve`)
    resolveUrl.searchParams.set('path', path)
    resolveUrl.searchParams.set('ref', ref)

    const response = await stub.fetch(new Request(resolveUrl.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }))

    if (!response.ok) {
      throw new Error(`Cross-DO resolution failed: ${response.status}`)
    }

    let thing: Thing
    try {
      thing = await response.json() as Thing
    } catch {
      throw new Error('Invalid response from remote DO')
    }

    return thing
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  protected parent?: string

  protected async link(
    target: string | { doId: string; doClass: string; role?: string; data?: Record<string, unknown> },
    relationType: string = 'related',
  ): Promise<void> {
    const targetNs = typeof target === 'string' ? target : target.doId
    const metadata = typeof target === 'string' ? undefined : target
    await this.db.insert(schema.relationships).values({
      id: crypto.randomUUID(),
      verb: typeof target === 'string' ? relationType : target.role || relationType,
      from: this.ns,
      to: targetNs,
      data: metadata as Record<string, unknown> | null,
      createdAt: new Date(),
    })
  }

  protected async getLinkedObjects(
    relationType?: string,
  ): Promise<Array<{ ns: string; relationType: string; doId: string; doClass?: string; data?: Record<string, unknown> }>> {
    const results = await this.db.select().from(schema.relationships)
    return results
      .filter((r) => r.from === this.ns && (!relationType || r.verb === relationType))
      .map((r) => ({
        ns: r.to,
        relationType: r.verb,
        doId: r.to,
        doClass: (r.data as Record<string, unknown> | null)?.doClass as string | undefined,
        data: r.data as Record<string, unknown> | undefined,
      }))
  }

  protected async createThing(data: { type: string; name: string; data?: Record<string, unknown> }): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    // @ts-expect-error - Drizzle schema types may differ slightly
    await this.db.insert(schema.things).values({
      id,
      ns: this.ns,
      type: data.type,
      data: { name: data.name, ...data.data } as Record<string, unknown>,
      version: 1,
      branch: this.currentBranch,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    return { id }
  }

  protected async createAction(data: {
    type: string
    target: string
    actor: string
    data?: Record<string, unknown>
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    // @ts-expect-error - Schema field names may differ
    await this.db.insert(schema.actions).values({
      id,
      verb: data.type,
      target: data.target,
      actor: data.actor,
      input: data.data as Record<string, unknown>,
      status: 'pending',
      createdAt: new Date(),
    })
    return { id }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISIBILITY HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _currentActorContext: { userId?: string; orgId?: string } = {}

  protected setActorContext(actor: { userId?: string; orgId?: string }): void {
    this._currentActorContext = actor
  }

  protected getActorContext(): { userId?: string; orgId?: string } {
    return this._currentActorContext
  }

  protected clearActorContext(): void {
    this._currentActorContext = {}
  }

  protected canViewThing(thing: Thing | ThingEntity | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const visibility = (thing.data as Record<string, unknown>)?.visibility as string | undefined ?? 'user'
    const actor = this._currentActorContext

    if (visibility === 'public' || visibility === 'unlisted') {
      return true
    }

    if (visibility === 'org') {
      const dataObj = thing.data as Record<string, unknown> | undefined
      const metaObj = dataObj?.meta as Record<string, unknown> | undefined
      const thingOrgId = (metaObj?.orgId as string | undefined) ?? (dataObj?.orgId as string | undefined)
      return !!actor.orgId && actor.orgId === thingOrgId
    }

    const dataObj = thing.data as Record<string, unknown> | undefined
    const metaObj = dataObj?.meta as Record<string, unknown> | undefined
    const thingOwnerId = (metaObj?.ownerId as string | undefined) ?? (dataObj?.ownerId as string | undefined)
    return !!actor.userId && actor.userId === thingOwnerId
  }

  protected assertCanView(thing: Thing | ThingEntity | null | undefined, message?: string): void {
    if (!thing) {
      throw new Error(message ?? 'Thing not found')
    }

    if (!this.canViewThing(thing)) {
      const visibility = (thing.data as Record<string, unknown>)?.visibility as string | undefined ?? 'user'
      let reason: string
      switch (visibility) {
        case 'org':
          reason = 'Organization membership required'
          break
        case 'user':
          reason = 'Owner access required'
          break
        default:
          reason = 'Access denied'
      }
      throw new Error(message ?? reason)
    }
  }

  protected filterVisibleThings<T extends Thing | ThingEntity>(things: T[]): T[] {
    return things.filter((thing) => this.canViewThing(thing))
  }

  protected async getVisibleThing(id: string): Promise<ThingEntity | null> {
    const thing = await this.things.get(id)
    if (!thing) {
      return null
    }
    return this.canViewThing(thing) ? thing : null
  }

  protected getVisibility(thing: Thing | ThingEntity | null | undefined): 'public' | 'unlisted' | 'org' | 'user' {
    if (!thing) {
      return 'user'
    }
    return ((thing.data as Record<string, unknown>)?.visibility as string | undefined) as 'public' | 'unlisted' | 'org' | 'user' ?? 'user'
  }

  protected isOwner(thing: Thing | ThingEntity | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const dataObj = thing.data as Record<string, unknown> | undefined
    const metaObj = dataObj?.meta as Record<string, unknown> | undefined
    const thingOwnerId = (metaObj?.ownerId as string | undefined) ?? (dataObj?.ownerId as string | undefined)

    const actor = this._currentActorContext
    return !!actor.userId && actor.userId === thingOwnerId
  }

  protected isInThingOrg(thing: Thing | ThingEntity | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const dataObj = thing.data as Record<string, unknown> | undefined
    const metaObj = dataObj?.meta as Record<string, unknown> | undefined
    const thingOrgId = (metaObj?.orgId as string | undefined) ?? (dataObj?.orgId as string | undefined)

    const actor = this._currentActorContext
    return !!actor.orgId && actor.orgId === thingOrgId
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle MCP (Model Context Protocol) requests.
   * This method is exposed for direct MCP access and is also routed from /mcp path.
   *
   * @param request - The incoming HTTP request
   * @returns Response with JSON-RPC 2.0 formatted result
   */
  async handleMcp(request: Request): Promise<Response> {
    const DOClass = this.constructor as typeof DO

    // Initialize MCP handler if not already done
    if (!this._mcpHandler) {
      this._mcpHandler = createMcpHandler(DOClass as unknown as {
        new (...args: unknown[]): { ns: string; [key: string]: unknown }
        $mcp?: McpConfig
        prototype: Record<string, unknown>
      })
    }

    return this._mcpHandler(this as unknown as { ns: string; [key: string]: unknown }, request, this._mcpSessions)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER (Extended from DOTiny)
  // ═══════════════════════════════════════════════════════════════════════════

  protected override async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Built-in routes
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this.ns })
    }

    // Handle /mcp endpoint for MCP transport
    if (url.pathname === '/mcp') {
      return this.handleMcp(request)
    }

    // Handle /rpc endpoint for RPC protocol (JSON-RPC 2.0 + Cap'n Web)
    if (url.pathname === '/rpc') {
      // Check for WebSocket upgrade
      const upgradeHeader = request.headers.get('upgrade')
      const connectionHeader = request.headers.get('connection')?.toLowerCase() || ''
      const hasConnectionUpgrade = connectionHeader.includes('upgrade')

      if (upgradeHeader?.toLowerCase() === 'websocket' && hasConnectionUpgrade) {
        return this.rpcServer.handleWebSocketRpc()
      }

      // HTTP RPC request
      if (request.method === 'POST') {
        return this.rpcServer.handleRpcRequest(request)
      }

      // GET request - return RPC info
      return Response.json({
        message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
        methods: this.rpcServer.methods,
      }, { headers: { 'Content-Type': 'application/json' } })
    }

    // Handle /resolve endpoint for cross-DO resolution
    if (url.pathname === '/resolve') {
      const path = url.searchParams.get('path')
      const ref = url.searchParams.get('ref') || 'main'

      if (!path) {
        return Response.json({ error: 'Missing path parameter' }, { status: 400 })
      }

      try {
        const thing = await this.resolveLocal(path, ref)
        return Response.json(thing)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Resolution failed'
        return Response.json({ error: message }, { status: 404 })
      }
    }

    // Delegate to Hono app if configured
    if (this.app) {
      const response = await this.app.fetch(request, this.env)
      return response
    }

    // Default: 404 Not Found
    return new Response('Not Found', { status: 404 })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALARM HANDLER (for scheduled tasks)
  // ═══════════════════════════════════════════════════════════════════════════

  async alarm(): Promise<void> {
    // Delegate to schedule manager to handle scheduled tasks
    if (this._scheduleManager) {
      await this._scheduleManager.handleAlarm()
    }
  }
}

export default DO
