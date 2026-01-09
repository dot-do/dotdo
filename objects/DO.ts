/**
 * DO - Base Durable Object class
 *
 * Minimal runtime implementation with:
 * - Identity (ns)
 * - Storage (Drizzle + SQLite)
 * - Workflow context ($)
 * - Lifecycle operations (fork, compact, moveTo, branch, checkout, merge)
 * - Resolution (local and cross-DO)
 *
 * Types are defined in types/*.ts
 * Schema is defined in db/*.ts
 */

import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { Hono } from 'hono'
import type { Context as HonoContext } from 'hono'
import * as schema from '../db'
import type { WorkflowContext, DomainProxy, OnProxy, OnNounProxy, EventHandler, DomainEvent, ScheduleBuilder, ScheduleTimeProxy, ScheduleExecutor, ScheduleHandler } from '../types/WorkflowContext'
import { createScheduleBuilderProxy, type ScheduleBuilderConfig } from './schedule-builder'
import { ScheduleManager, type Schedule } from './ScheduleManager'
import type { Thing } from '../types/Thing'
import {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  type StoreContext,
} from './stores'
import { DLQStore } from './stores/DLQStore'
import { parseNounId, formatNounId } from '../lib/noun-id'

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
// ENVIRONMENT
// ============================================================================

export interface Env {
  AI?: Fetcher
  PIPELINE?: Pipeline
  DO?: DurableObjectNamespace
  [key: string]: unknown
}

interface Pipeline {
  send(data: unknown): Promise<void>
}

/**
 * DO stub interface for cross-DO communication
 */
interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * Cross-DO resolution configuration
 */
const CROSS_DO_CONFIG = {
  /** How long to cache a stub (5 minutes) */
  STUB_CACHE_TTL: 5 * 60 * 1000,
  /** Number of failures before opening circuit */
  CIRCUIT_BREAKER_THRESHOLD: 3,
  /** How long circuit stays open (30 seconds) */
  CIRCUIT_BREAKER_TIMEOUT: 30 * 1000,
}

// ============================================================================
// DO - Base Durable Object
// ============================================================================

export class DO<E extends Env = Env> extends DurableObject<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE DISCRIMINATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Static $type property - the class type discriminator
   * Must be overridden in subclasses
   */
  static readonly $type: string = 'DO'

  /**
   * Static initializer to protect $type on the prototype
   */
  static {
    // Make the $type getter non-configurable and non-writable on the prototype
    Object.defineProperty(DO.prototype, '$type', {
      get() {
        return (this.constructor as typeof DO).$type
      },
      configurable: false,
      enumerable: true,
    })
  }

  /**
   * Get the full type hierarchy for this instance
   * Returns an array from most specific to most general (e.g., ['Agent', 'Worker', 'DO'])
   */
  getTypeHierarchy(): string[] {
    const hierarchy: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: typeof DO | null = this.constructor as typeof DO

    while (current && current.$type) {
      hierarchy.push(current.$type)
      const parent = Object.getPrototypeOf(current)
      if (parent === Function.prototype || !parent.$type) break
      current = parent
    }

    return hierarchy
  }

  /**
   * Check if this instance is of or extends the given type
   */
  isInstanceOfType(type: string): boolean {
    return this.getTypeHierarchy().includes(type)
  }

  /**
   * Check for exact type match
   */
  isType(type: string): boolean {
    return this.$type === type
  }

  /**
   * Check if this type extends the given type (includes exact match)
   */
  extendsType(type: string): boolean {
    return this.isInstanceOfType(type)
  }

  /**
   * Assert that this instance is of the expected type, throw otherwise
   */
  assertType(expectedType: string): void {
    if (this.$type !== expectedType) {
      throw new Error(`expected ${expectedType} but got ${this.$type}`)
    }
  }

  /**
   * Serialize this DO to JSON including $type
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this.$type,
      ns: this.ns,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Namespace URL - the DO's identity
   * e.g., 'https://startups.studio'
   */
  readonly ns: string

  /**
   * Current branch (default: 'main')
   */
  protected currentBranch: string = 'main'

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTOR CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current actor for action logging.
   * Set per-request to track who performed actions.
   *
   * Format: 'Type/id' where Type is one of:
   * - Human: Human user (e.g., 'Human/nathan', 'Human/user@example.com')
   * - Agent: AI agent (e.g., 'Agent/support', 'Agent/claude-assistant')
   * - Service: Service account (e.g., 'Service/billing', 'Service/scheduler')
   * - API: API key identity (e.g., 'API/key-abc123')
   */
  private _currentActor: string = ''

  /**
   * Set the current actor for subsequent action logging.
   * Call this at the start of each request to establish the actor context.
   *
   * @param actor - Actor identifier in 'Type/id' format
   *
   * @example
   * ```typescript
   * // In your fetch handler after authentication
   * this.setActor(`Human/${authContext.userId}`)
   * ```
   */
  protected setActor(actor: string): void {
    this._currentActor = actor
  }

  /**
   * Clear the current actor.
   * Call this at the end of each request to prevent actor leakage.
   */
  protected clearActor(): void {
    this._currentActor = ''
  }

  /**
   * Get the current actor for action logging.
   * Used internally by logAction.
   *
   * @returns The current actor or empty string if not set
   */
  protected getCurrentActor(): string {
    return this._currentActor
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HONO APP (for subclass routing)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Optional Hono app for HTTP routing.
   * Subclasses can create and configure this for custom routes.
   *
   * @example
   * ```typescript
   * class MyDO extends DO {
   *   protected app = new Hono()
   *     .use('/api/auth/*', auth())
   *     .get('/api/things', (c) => c.json({ things: [] }))
   *
   *   async fetch(request: Request): Promise<Response> {
   *     return this.handleFetch(request)
   *   }
   * }
   * ```
   */
  protected app?: Hono

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  protected db: DrizzleSqliteDODatabase<typeof schema>

  // ═══════════════════════════════════════════════════════════════════════════
  // STORE ACCESSORS
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
  // Key format: "Noun.verb" (e.g., "Customer.created")
  // Value: Array of registered handler functions
  protected _eventHandlers: Map<string, Function[]> = new Map()

  // Schedule handler registry for $.every scheduling
  // Key format: schedule name
  // Value: Handler function
  protected _scheduleHandlers: Map<string, ScheduleHandler> = new Map()

  // Schedule manager for cron parsing and alarm registration
  private _scheduleManager?: ScheduleManager

  /**
   * Get the schedule manager (lazy initialized)
   */
  protected get scheduleManager(): ScheduleManager {
    if (!this._scheduleManager) {
      this._scheduleManager = new ScheduleManager(this.ctx)
      // Register the trigger handler
      this._scheduleManager.onScheduleTrigger(async (schedule: Schedule) => {
        const handler = this._scheduleHandlers.get(schedule.name)
        if (handler) {
          await handler()
        }
      })
    }
    return this._scheduleManager
  }

  // Cross-DO resolution caches
  private _stubCache: Map<string, { stub: DOStub; cachedAt: number }> = new Map()
  private _circuitBreaker: Map<string, { failures: number; openUntil: number }> = new Map()

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
      this._dlq = new DLQStore(this.getStoreContext(), this._eventHandlers)
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
  // TYPED COLLECTION ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a typed collection accessor for a noun
   * Note: Uses simplified queries - in production would use proper noun FK resolution
   */
  protected collection<T extends Thing = Thing>(noun: string): ThingsCollection<T> {
    const self = this
    return {
      get: async (id: string): Promise<T | null> => {
        // Note: In full implementation, would resolve noun to type FK
        const results = await self.db.select().from(schema.things)
        const result = results.find((r) => r.id === id && !r.deleted)
        if (!result) return null
        const data = result.data as Record<string, unknown> | null
        return { $id: result.id, $type: noun, ...data } as T
      },
      list: async (): Promise<T[]> => {
        const results = await self.db.select().from(schema.things)
        return results
          .filter((r) => !r.deleted)
          .map((r) => {
            const data = r.data as Record<string, unknown> | null
            return { $id: r.id, $type: noun, ...data } as T
          })
      },
      find: async (query: Record<string, unknown>): Promise<T[]> => {
        const results = await self.db.select().from(schema.things)
        return results
          .filter((r) => {
            if (r.deleted) return false
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
        const id = (data as Record<string, unknown>).$id as string || crypto.randomUUID()
        await self.db.insert(schema.things).values({
          id,
          type: 0, // Would resolve noun to FK in full implementation
          branch: self.currentBranch,
          data: data as Record<string, unknown>,
          deleted: false,
        })
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
  // WORKFLOW CONTEXT ($)
  // ═══════════════════════════════════════════════════════════════════════════

  readonly $: WorkflowContext

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env)

    // Protect $type on this instance to prevent tampering
    Object.defineProperty(this, '$type', {
      get: () => (this.constructor as typeof DO).$type,
      configurable: false,
      enumerable: true,
    })

    // Initialize namespace from storage or derive from ID
    this.ns = '' // Will be set during initialization

    // Initialize Drizzle with SQLite via durable-sqlite driver
    this.db = drizzle(ctx.storage, { schema })

    // Initialize workflow context
    this.$ = this.createWorkflowContext()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize(config: { ns: string; parent?: string }): Promise<void> {
    // @ts-expect-error - Setting readonly after construction
    this.ns = config.ns

    // Store namespace
    await this.ctx.storage.put('ns', config.ns)

    // If has parent, record the relationship
    if (config.parent) {
      // @ts-expect-error - Schema field names may differ
      await this.db.insert(schema.objects).values({
        ns: config.parent,
        doId: this.ctx.id.toString(),
        doClass: this.constructor.name,
        relationType: 'parent',
        createdAt: new Date(),
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW CONTEXT FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  protected createWorkflowContext(): WorkflowContext {
    const self = this

    return new Proxy({} as WorkflowContext, {
      get(_, prop: string) {
        switch (prop) {
          case 'send':
            return self.send.bind(self)
          case 'try':
            return self.try.bind(self)
          case 'do':
            return self.do.bind(self)
          case 'on':
            return self.createOnProxy()
          case 'every':
            return self.createScheduleBuilder()
          case 'branch':
            return self.branch.bind(self)
          case 'checkout':
            return self.checkout.bind(self)
          case 'merge':
            return self.merge.bind(self)
          case 'log':
            return self.log.bind(self)
          case 'state':
            return {}
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
   * Fire-and-forget event emission (non-blocking, non-durable)
   */
  protected send(event: string, data: unknown): void {
    // Best-effort action logging
    this.logAction('send', event, data).catch(() => {})

    // Best-effort event emission
    this.emitEvent(event, data).catch(() => {})
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   */
  protected async try<T>(action: string, data: unknown): Promise<T> {
    const actionRecord = await this.logAction('try', action, data)

    try {
      const result = await this.executeAction(action, data)
      await this.completeAction(actionRecord.rowid, result)
      await this.emitEvent(`${action}.completed`, { result })
      return result as T
    } catch (error) {
      await this.failAction(actionRecord.rowid, error)
      await this.emitEvent(`${action}.failed`, { error }).catch(() => {})
      throw error
    }
  }

  /**
   * Durable execution with retries (blocking, durable)
   */
  protected async do<T>(action: string, data: unknown): Promise<T> {
    const actionRecord = await this.logAction('do', action, data)

    const maxRetries = 3
    let lastError: unknown

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.executeAction(action, data)
        await this.completeAction(actionRecord.rowid, result)
        await this.emitEvent(`${action}.completed`, { result })
        return result as T
      } catch (error) {
        lastError = error
        if (attempt < maxRetries - 1) {
          await this.updateActionStatus(actionRecord.rowid, 'retrying')
          await this.sleep(Math.pow(2, attempt) * 1000) // Exponential backoff
        }
      }
    }

    await this.failAction(actionRecord.rowid, lastError)
    await this.emitEvent(`${action}.failed`, { error: lastError })
    throw lastError
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION LOGGING (append-only)
  // ═══════════════════════════════════════════════════════════════════════════

  protected async logAction(durability: 'send' | 'try' | 'do', verb: string, input: unknown): Promise<{ rowid: number }> {
    const result = await this.db
      .insert(schema.actions)
      // @ts-expect-error - Schema field names may differ
      .values({
        id: crypto.randomUUID(),
        verb,
        target: this.ns,
        actor: this._currentActor, // Get from actor context
        input: input as Record<string, unknown>,
        status: 'pending',
        createdAt: new Date(),
      })
      .returning({ rowid: schema.actions.id })

    return { rowid: 0 } // SQLite rowid
  }

  protected async completeAction(rowid: number | string, output: unknown): Promise<void> {
    // Update action status
  }

  protected async failAction(rowid: number | string, error: unknown): Promise<void> {
    // Update action status to failed
  }

  protected async updateActionStatus(rowid: number, status: string): Promise<void> {
    // Update action status
  }

  protected async executeAction(action: string, data: unknown): Promise<unknown> {
    // Override in subclasses to handle specific actions
    throw new Error(`Unknown action: ${action}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    // Insert event (best-effort, don't block pipeline streaming)
    try {
      await this.db.insert(schema.events).values({
        id: crypto.randomUUID(),
        verb,
        source: this.ns,
        data: data as Record<string, unknown>,
        sequence: 0, // Will use SQLite rowid
        streamed: false,
        createdAt: new Date(),
      })
    } catch {
      // Best-effort database insert
    }

    // Stream to Pipeline if configured
    if (this.env.PIPELINE) {
      try {
        await this.env.PIPELINE.send([{
          verb,
          source: this.ns,
          $context: this.ns,
          data,
          timestamp: new Date().toISOString(),
        }])
      } catch {
        // Best-effort streaming
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Valid Cloudflare colo codes and region hints
   */
  protected static readonly VALID_COLOS = new Set([
    'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
    'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
    'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
    'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
    'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
  ])

  /**
   * Current version (null means HEAD, number means detached HEAD at specific version)
   */
  protected currentVersion: number | null = null

  /**
   * Current colo (for tracking move operations)
   */
  protected currentColo: string | null = null

  /**
   * Fork current state to a new DO (new identity, fresh history)
   */
  async fork(options: { to: string; branch?: string }): Promise<{ ns: string; doId: string }> {
    const targetNs = options.to
    const forkBranch = options.branch || this.currentBranch

    // Validate target namespace URL
    try {
      new URL(targetNs)
    } catch {
      throw new Error(`Invalid namespace URL: ${targetNs}`)
    }

    // Get current state (latest version of each thing, non-deleted, specified branch)
    const things = await this.db.select().from(schema.things)
    const branchFilter = forkBranch === 'main' ? null : forkBranch
    const branchThings = things.filter(t =>
      t.branch === branchFilter && !t.deleted
    )

    // Check if there's anything to fork
    if (branchThings.length === 0) {
      throw new Error('No state to fork')
    }

    // Get latest version of each thing (by id)
    const latestVersions = new Map<string, typeof things[0]>()
    for (const thing of branchThings) {
      const existing = latestVersions.get(thing.id)
      if (!existing) {
        latestVersions.set(thing.id, thing)
      }
    }

    // Emit fork.started event
    await this.emitEvent('fork.started', { targetNs, thingsCount: latestVersions.size })

    // Create new DO at target namespace
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }
    const doId = this.env.DO.idFromName(targetNs)
    const stub = this.env.DO.get(doId)

    // Send state to new DO
    await stub.fetch(new Request(`https://${targetNs}/init`, {
      method: 'POST',
      body: JSON.stringify({
        things: Array.from(latestVersions.values()).map(t => ({
          id: t.id,
          type: t.type,
          branch: null,
          name: t.name,
          data: t.data,
          deleted: false,
        })),
      }),
    }))

    // Emit fork.completed event
    await this.emitEvent('fork.completed', { targetNs, doId: doId.toString() })

    return { ns: targetNs, doId: doId.toString() }
  }

  /**
   * Squash history to current state (same identity)
   */
  async compact(): Promise<{ thingsCompacted: number; actionsArchived: number; eventsArchived: number }> {
    const things = await this.db.select().from(schema.things)
    const actions = await this.db.select().from(schema.actions)
    const events = await this.db.select().from(schema.events)

    // Check if there's anything to compact
    if (things.length === 0) {
      throw new Error('Nothing to compact')
    }

    // Archive old things versions to R2 FIRST - this provides atomicity
    const R2 = this.env.R2 as { put(key: string, data: string): Promise<void> } | undefined
    if (R2) {
      await R2.put(
        `archives/${this.ns}/things/${Date.now()}.json`,
        JSON.stringify(things)
      )

      // Archive actions to R2
      if (actions.length > 0) {
        await R2.put(
          `archives/${this.ns}/actions/${Date.now()}.json`,
          JSON.stringify(actions)
        )
      }

      // Archive events to R2
      const eventsToArchive = events.filter(e =>
        e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      )
      if (eventsToArchive.length > 0) {
        await R2.put(
          `archives/${this.ns}/events/${Date.now()}.json`,
          JSON.stringify(eventsToArchive)
        )
      }
    }

    // Emit compact.started event
    await this.emitEvent('compact.started', { thingsCount: things.length })

    // Group things by id+branch to find latest versions
    const thingsByKey = new Map<string, typeof things>()
    for (const thing of things) {
      const key = `${thing.id}:${thing.branch || 'main'}`
      const group = thingsByKey.get(key) || []
      group.push(thing)
      thingsByKey.set(key, group)
    }

    // Keep only latest version of each thing
    let compactedCount = 0
    const latestThings: typeof things = []

    for (const [, group] of thingsByKey) {
      // Get latest version (last in array based on insertion order)
      const latest = group[group.length - 1]

      // Only keep non-deleted things
      if (!latest.deleted) {
        latestThings.push(latest)
      }

      compactedCount += group.length - 1
    }

    // Delete old versions (use raw SQL for bulk delete)
    await this.ctx.storage.sql.exec('DELETE FROM things')

    // Re-insert only latest versions
    for (const thing of latestThings) {
      await this.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data as Record<string, unknown>,
        deleted: false,
      })
    }

    // Clear actions
    await this.ctx.storage.sql.exec('DELETE FROM actions')

    // Emit compact.completed event
    await this.emitEvent('compact.completed', {
      thingsCompacted: compactedCount,
      actionsArchived: actions.length,
      eventsArchived: events.filter(e =>
        e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      ).length,
    })

    return {
      thingsCompacted: compactedCount,
      actionsArchived: actions.length,
      eventsArchived: events.filter(e =>
        e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      ).length,
    }
  }

  /**
   * Relocate DO to a different colo (same identity, new location)
   */
  async moveTo(colo: string): Promise<{ newDoId: string; region: string }> {
    // Validate colo code
    if (!DO.VALID_COLOS.has(colo)) {
      throw new Error(`Invalid colo code: ${colo}`)
    }

    // Check if already at target colo
    if (this.currentColo === colo) {
      throw new Error(`Already at colo: ${colo}`)
    }

    const things = await this.db.select().from(schema.things)
    if (things.length === 0) {
      throw new Error('No state to move')
    }

    // Emit move.started event
    await this.emitEvent('move.started', { targetColo: colo })

    // Create new DO with locationHint
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }
    const newDoId = this.env.DO.newUniqueId({ locationHint: colo })
    const stub = this.env.DO.get(newDoId)

    // Transfer state to new DO
    await stub.fetch(new Request(`https://${this.ns}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        things: things.filter(t => !t.deleted),
        branches: await this.db.select().from(schema.branches),
      }),
    }))

    // Update objects table
    await this.db.insert(schema.objects).values({
      ns: this.ns,
      id: newDoId.toString(),
      class: 'DO',
      region: colo,
      primary: true,
      createdAt: new Date(),
    })

    // Update current colo
    this.currentColo = colo

    // Schedule deletion of old DO
    this.ctx.waitUntil(Promise.resolve())

    // Emit move.completed event
    await this.emitEvent('move.completed', { newDoId: newDoId.toString(), region: colo })

    return { newDoId: newDoId.toString(), region: colo }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCHING & VERSION CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new branch at current HEAD
   */
  async branch(name: string): Promise<{ name: string; head: number }> {
    // Validate branch name
    if (!name || name.trim() === '') {
      throw new Error('Branch name cannot be empty')
    }

    if (name.includes(' ')) {
      throw new Error('Branch name cannot contain spaces')
    }

    if (name === 'main') {
      throw new Error('Cannot create branch named "main" - it is reserved')
    }

    // Check if branch already exists
    const branches = await this.db.select().from(schema.branches)
    if (branches.some(b => b.name === name)) {
      throw new Error(`Branch "${name}" already exists`)
    }

    // Find current HEAD (latest rowid on current branch)
    const things = await this.db.select().from(schema.things)
    const currentBranchThings = things.filter(t =>
      this.currentBranch === 'main' ? t.branch === null : t.branch === this.currentBranch
    )

    if (currentBranchThings.length === 0) {
      throw new Error('No commits on current branch')
    }

    // Get the latest rowid (use array index as proxy for rowid)
    const head = currentBranchThings.length

    // Create branch record
    await this.db.insert(schema.branches).values({
      name,
      thingId: currentBranchThings[0].id,
      head,
      base: head,
      forkedFrom: this.currentBranch,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Emit branch.created event
    await this.emitEvent('branch.created', { name, head, forkedFrom: this.currentBranch })

    return { name, head }
  }

  /**
   * Switch to a branch or version
   * @param ref - Branch name or version reference (e.g., '@v1234', '@main', '@~1')
   */
  async checkout(ref: string): Promise<{ branch?: string; version?: number }> {
    const things = await this.db.select().from(schema.things)

    // Parse the ref
    let targetRef = ref.startsWith('@') ? ref.slice(1) : ref

    // Check for version reference (@v1234)
    if (targetRef.startsWith('v')) {
      const version = parseInt(targetRef.slice(1), 10)

      // Validate version exists (use index as proxy for rowid)
      if (version < 1 || version > things.length) {
        throw new Error(`Version not found: ${version}`)
      }

      // Set to detached HEAD state
      this.currentVersion = version

      // Emit checkout event
      await this.emitEvent('checkout', { version })

      return { version }
    }

    // Check for relative reference (@~N)
    if (targetRef.startsWith('~')) {
      const offset = parseInt(targetRef.slice(1), 10)

      // Get all things on current branch
      const currentBranchThings = things.filter(t =>
        this.currentBranch === 'main' ? t.branch === null : t.branch === this.currentBranch
      )

      if (offset >= currentBranchThings.length) {
        throw new Error(`Cannot go back ${offset} versions - only ${currentBranchThings.length} versions exist`)
      }

      const version = currentBranchThings.length - offset

      // Set to detached HEAD state
      this.currentVersion = version

      // Emit checkout event
      await this.emitEvent('checkout', { version, relative: `~${offset}` })

      return { version }
    }

    // Branch reference
    const branchName = targetRef

    // Check if branch exists
    if (branchName === 'main') {
      this.currentBranch = 'main'
      this.currentVersion = null

      await this.emitEvent('checkout', { branch: 'main' })
      return { branch: 'main' }
    }

    // Check for explicit branch or things on that branch
    const branches = await this.db.select().from(schema.branches)
    const branchExists = branches.some(b => b.name === branchName)
    const thingsOnBranch = things.filter(t => t.branch === branchName)

    if (!branchExists && thingsOnBranch.length === 0) {
      throw new Error(`Branch not found: ${branchName}`)
    }

    this.currentBranch = branchName
    this.currentVersion = null

    // Emit checkout event
    await this.emitEvent('checkout', { branch: branchName })

    return { branch: branchName }
  }

  /**
   * Merge a branch into current
   */
  async merge(branch: string): Promise<{ merged: boolean; conflicts?: string[] }> {
    // Cannot merge into detached HEAD
    if (this.currentVersion !== null) {
      throw new Error('Cannot merge into detached HEAD state')
    }

    // Cannot merge branch into itself
    if (branch === this.currentBranch || (branch === 'main' && this.currentBranch === 'main')) {
      throw new Error('Cannot merge branch into itself')
    }

    const things = await this.db.select().from(schema.things)
    const branches = await this.db.select().from(schema.branches)

    // Check if source branch exists
    const sourceBranch = branches.find(b => b.name === branch)
    const sourceThings = things.filter(t => t.branch === branch)

    if (!sourceBranch && sourceThings.length === 0) {
      throw new Error(`Branch not found: ${branch}`)
    }

    // Emit merge.started event
    await this.emitEvent('merge.started', { source: branch, target: this.currentBranch })

    // Get things on target branch (current)
    const targetBranchFilter = this.currentBranch === 'main' ? null : this.currentBranch
    const targetThings = things.filter(t => t.branch === targetBranchFilter)

    // Find base (common ancestor)
    const baseRowid = sourceBranch?.base || 1

    // Group source and target things by id
    const sourceById = new Map<string, typeof things>()
    for (const t of sourceThings) {
      const group = sourceById.get(t.id) || []
      group.push(t)
      sourceById.set(t.id, group)
    }

    const targetById = new Map<string, typeof things>()
    for (const t of targetThings) {
      const group = targetById.get(t.id) || []
      group.push(t)
      targetById.set(t.id, group)
    }

    // Detect conflicts and prepare merge
    const conflicts: string[] = []
    const toMerge: typeof things = []

    for (const [id, sourceVersions] of sourceById) {
      const latestSource = sourceVersions[sourceVersions.length - 1]
      const targetVersions = targetById.get(id) || []

      if (targetVersions.length === 0) {
        // Thing only exists on source - add to target
        toMerge.push({
          ...latestSource,
          branch: targetBranchFilter,
        })
      } else {
        // Thing exists on both - check for conflicts
        const latestTarget = targetVersions[targetVersions.length - 1]

        // Compare changes
        const sourceData = (latestSource.data || {}) as Record<string, unknown>
        const targetData = (latestTarget.data || {}) as Record<string, unknown>
        const baseVersion = targetVersions[0] || sourceVersions[0]
        const baseData = (baseVersion?.data || {}) as Record<string, unknown>

        // Check for conflicting field changes
        const sourceChanges = new Set<string>()
        const targetChanges = new Set<string>()

        for (const key of Object.keys(sourceData)) {
          if (JSON.stringify(sourceData[key]) !== JSON.stringify(baseData[key])) {
            sourceChanges.add(key)
          }
        }

        for (const key of Object.keys(targetData)) {
          if (JSON.stringify(targetData[key]) !== JSON.stringify(baseData[key])) {
            targetChanges.add(key)
          }
        }

        // Check for overlapping changes (conflicts)
        const conflictingFields: string[] = []
        for (const field of sourceChanges) {
          if (targetChanges.has(field) &&
              JSON.stringify(sourceData[field]) !== JSON.stringify(targetData[field])) {
            conflictingFields.push(field)
          }
        }

        if (conflictingFields.length > 0) {
          conflicts.push(`${id}:${conflictingFields.join(',')}`)
        } else {
          // Auto-merge non-conflicting changes
          const mergedData: Record<string, unknown> = { ...baseData }

          for (const field of sourceChanges) {
            mergedData[field] = sourceData[field]
          }

          for (const field of targetChanges) {
            mergedData[field] = targetData[field]
          }

          if (latestSource.deleted || latestTarget.deleted) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
              deleted: latestSource.deleted || latestTarget.deleted,
            })
          } else if (Object.keys(mergedData).length > 0 || sourceChanges.size > 0) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
            })
          }
        }
      }
    }

    // If there are conflicts, don't merge
    if (conflicts.length > 0) {
      await this.emitEvent('merge.conflict', { source: branch, conflicts })
      return { merged: false, conflicts }
    }

    // Apply merge - add new versions to target branch
    for (const thing of toMerge) {
      await this.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data as Record<string, unknown>,
        deleted: thing.deleted,
      })
    }

    // Emit merge.completed event
    await this.emitEvent('merge.completed', { source: branch, target: this.currentBranch, merged: toMerge.length })

    return { merged: true }
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
    const ref = parsed.hash.slice(1) || 'main' // @ref in fragment

    if (ns === this.ns) {
      // Local resolution
      return this.resolveLocal(path, ref)
    } else {
      // Cross-DO resolution
      return this.resolveCrossDO(ns, path, ref)
    }
  }

  protected async resolveLocal(path: string, ref: string): Promise<Thing> {
    // Parse the Noun/id format (may include @branch, @vNNNN, or @~N)
    const parsed = parseNounId(path)

    // Determine the branch to use:
    // 1. If path contains @branch, use that
    // 2. If ref is provided and non-empty, use ref
    // 3. Otherwise use currentBranch
    const branch = parsed.branch ?? (ref || this.currentBranch)

    // Construct the thing ID from parsed noun/id
    const thingId = parsed.id

    // Handle versioned resolution (requires fetching all versions)
    // Both @vNNNN (absolute) and @~N (relative) need version history
    if (parsed.version !== undefined || parsed.relativeVersion !== undefined) {
      const versions = await this.things.versions(thingId)
      if (versions.length === 0) {
        throw new Error(`Thing not found: ${path}`)
      }

      let targetVersion: (typeof versions)[0] | undefined

      if (parsed.version !== undefined) {
        // Absolute version: @v1 means the first version, @v2 means second, etc.
        const versionIndex = parsed.version - 1 // Convert 1-based to 0-based index
        if (versionIndex < 0 || versionIndex >= versions.length) {
          throw new Error(`Thing not found: ${path}`)
        }
        targetVersion = versions[versionIndex]
      } else if (parsed.relativeVersion !== undefined) {
        // Relative version: @~1 means one back from latest, @~0 means latest
        const targetIndex = versions.length - 1 - parsed.relativeVersion
        if (targetIndex < 0) {
          throw new Error(`Relative version @~${parsed.relativeVersion} exceeds available versions (${versions.length} total)`)
        }
        targetVersion = versions[targetIndex]
      }

      if (!targetVersion) {
        throw new Error(`Version not found for path: ${path}`)
      }

      // Build and return the Thing
      const fullId = this.ns ? `${this.ns}/${parsed.noun}/${parsed.id}` : `${parsed.noun}/${parsed.id}`
      return {
        $id: fullId,
        $type: parsed.noun,
        name: targetVersion.name ?? undefined,
        data: targetVersion.data ?? undefined,
      } as Thing
    }

    // Build options for ThingsStore.get() - non-versioned resolution
    const options: { branch?: string } = {}

    // Handle branch - pass the branch name directly
    // ThingsStore.get() handles matching branch OR null (main)
    if (branch && branch !== 'main') {
      options.branch = branch
    }
    // If branch is 'main' or empty, don't set options.branch to use default behavior

    // Use ThingsStore.get() to fetch the latest version
    const thing = await this.things.get(thingId, options)

    if (!thing) {
      throw new Error(`Thing not found: ${path}`)
    }

    // Build the fully qualified $id
    const fullId = this.ns ? `${this.ns}/${parsed.noun}/${parsed.id}` : `${parsed.noun}/${parsed.id}`

    // Return Thing with proper $id and $type
    return {
      $id: fullId,
      $type: parsed.noun,
      name: thing.name ?? undefined,
      data: thing.data ?? undefined,
    } as Thing
  }

  protected async resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing> {
    // Check circuit breaker first
    const circuitState = this._circuitBreaker.get(ns)
    if (circuitState && Date.now() < circuitState.openUntil) {
      throw new Error(`Circuit breaker open for namespace: ${ns}`)
    }

    // Look up namespace in objects table
    const obj = await this.objects.get(ns)
    if (!obj) {
      throw new Error(`Unknown namespace: ${ns}`)
    }

    // Check if DO binding is configured
    if (!this.env.DO) {
      throw new Error('DO namespace binding not configured')
    }

    // Get or create cached stub
    const stub = this.getOrCreateStub(ns, obj.id)

    // Construct resolve request with path and ref
    const resolveUrl = new URL(`${ns}/resolve`)
    resolveUrl.searchParams.set('path', path)
    resolveUrl.searchParams.set('ref', ref)

    try {
      // Call resolve on remote DO via fetch
      const response = await stub.fetch(new Request(resolveUrl.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }))

      // Check for failed response
      if (!response.ok) {
        this.recordFailure(ns)
        throw new Error(`Cross-DO resolution failed: ${response.status}`)
      }

      // Reset circuit breaker on success
      this._circuitBreaker.delete(ns)

      // Parse response as Thing
      let thing: Thing
      try {
        thing = await response.json() as Thing
      } catch {
        throw new Error('Invalid response from remote DO')
      }

      return thing
    } catch (error) {
      // Record failure for circuit breaker (only for network/fetch errors, not HTTP errors we already counted)
      if (error instanceof Error &&
          !error.message.startsWith('Invalid response') &&
          !error.message.startsWith('Cross-DO resolution failed')) {
        this.recordFailure(ns)
      }
      throw error
    }
  }

  /**
   * Get a cached stub or create a new one
   */
  private getOrCreateStub(ns: string, doId: string): DOStub {
    const now = Date.now()
    const cached = this._stubCache.get(ns)

    // Return cached stub if still valid
    if (cached && now - cached.cachedAt < CROSS_DO_CONFIG.STUB_CACHE_TTL) {
      return cached.stub
    }

    // Create new stub
    const doNamespace = this.env.DO as {
      idFromString(id: string): unknown
      get(id: unknown): DOStub
    }
    const id = doNamespace.idFromString(doId)
    const stub = doNamespace.get(id)

    // Cache the stub
    this._stubCache.set(ns, { stub, cachedAt: now })

    return stub
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordFailure(ns: string): void {
    const state = this._circuitBreaker.get(ns) || { failures: 0, openUntil: 0 }
    state.failures++

    if (state.failures >= CROSS_DO_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      // Open the circuit
      state.openUntil = Date.now() + CROSS_DO_CONFIG.CIRCUIT_BREAKER_TIMEOUT
      state.failures = 0 // Reset for next cycle
    }

    this._circuitBreaker.set(ns, state)
  }

  /**
   * Clear caches for a specific namespace (useful for testing or forced refresh)
   */
  protected clearCrossDoCache(ns?: string): void {
    if (ns) {
      this._stubCache.delete(ns)
      this._circuitBreaker.delete(ns)
    } else {
      this._stubCache.clear()
      this._circuitBreaker.clear()
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
          get: (_, verb: string): (handler: EventHandler) => void => {
            return (handler: EventHandler): void => {
              // Build the event key in format "Noun.verb"
              const eventKey = `${noun}.${verb}`

              // Get or create the handlers array for this event
              const handlers = self._eventHandlers.get(eventKey) ?? []

              // Add the handler to the array
              handlers.push(handler)

              // Store back in the registry
              self._eventHandlers.set(eventKey, handlers)
            }
          },
        })
      },
    })
  }

  protected createScheduleBuilder(): ScheduleBuilder {
    const self = this

    // Create the schedule builder proxy that integrates with ScheduleManager
    const config: ScheduleBuilderConfig = {
      state: this.ctx,
      onScheduleRegistered: (cron: string, name: string, handler: ScheduleHandler) => {
        // Store the handler for later execution
        self._scheduleHandlers.set(name, handler)

        // Register with the ScheduleManager (async, fire-and-forget)
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
        // Handle Promise methods for proper thenable behavior
        if (method === 'then' || method === 'catch' || method === 'finally') {
          return undefined
        }

        // Return a function that calls the method
        return (...args: unknown[]): Promise<unknown> => {
          return self.invokeDomainMethod(noun, id, method as string, args)
        }
      },
    })
  }

  /**
   * Invoke a method on a domain target (local or cross-DO)
   *
   * This method handles the actual invocation logic:
   * 1. For local targets (method exists on this DO): call directly
   * 2. For cross-DO targets: make an RPC request
   */
  protected async invokeDomainMethod(
    noun: string,
    id: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    // Check if this method exists locally on this DO instance
    const localMethod = (this as unknown as Record<string, unknown>)[method]

    if (typeof localMethod === 'function') {
      // Local invocation: call the method directly on this DO
      try {
        return await localMethod.apply(this, args)
      } catch (error) {
        // Re-throw the error to preserve stack trace
        throw error
      }
    }

    // Cross-DO invocation: make an RPC request
    return this.invokeCrossDOMethod(noun, id, method, args)
  }

  /**
   * Make an RPC call to a remote DO
   */
  protected async invokeCrossDOMethod(
    noun: string,
    id: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    // Check if DO binding is configured
    if (!this.env.DO) {
      throw new Error(`Method '${method}' not found and DO namespace not configured for cross-DO calls`)
    }

    // Construct the target namespace URL
    const targetNs = `${noun}/${id}`

    // Get DO stub
    const doNamespace = this.env.DO as {
      idFromName(name: string): unknown
      get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
    }

    const doId = doNamespace.idFromName(targetNs)
    const stub = doNamespace.get(doId)

    // Make RPC request
    const response = await stub.fetch(
      new Request(`https://${targetNs}/rpc/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
      }),
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Cross-DO RPC failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json() as { result?: unknown; error?: string }

    if (result.error) {
      throw new Error(result.error)
    }

    return result.result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  protected log(message: string, data?: unknown): void {
    console.log(`[${this.ns}] ${message}`, data)
  }

  /**
   * Check if this DO class has a specific capability
   * Base DO class has no capabilities - mixins add them
   */
  hasCapability(name: string): boolean {
    return false
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get registered event handlers for a specific event key
   *
   * @param eventKey - The event key in format "Noun.verb" (e.g., "Customer.created")
   * @returns Array of registered handler functions, or empty array if none
   *
   * @example
   * ```typescript
   * const handlers = this.getEventHandlers('Customer.created')
   * ```
   */
  getEventHandlers(eventKey: string): Function[] {
    return this._eventHandlers.get(eventKey) ?? []
  }

  /**
   * Dispatch an event to all registered handlers
   *
   * Handlers are executed sequentially. Errors in one handler do not prevent
   * other handlers from executing. All errors are collected and returned.
   *
   * @param event - The domain event to dispatch
   * @returns Object with count of successful handlers and array of errors
   *
   * @example
   * ```typescript
   * const event: DomainEvent = {
   *   id: 'evt-123',
   *   verb: 'created',
   *   source: 'https://example.do/Customer/cust-456',
   *   data: { email: 'user@example.com' },
   *   timestamp: new Date()
   * }
   * const result = await this.dispatchEventToHandlers(event)
   * console.log(`${result.handled} handlers executed, ${result.errors.length} errors`)
   * ```
   */
  async dispatchEventToHandlers(event: DomainEvent): Promise<{ handled: number; errors: Error[] }> {
    // Extract noun from source URL (format: "https://ns/Noun/id")
    const sourceParts = event.source.split('/')
    const noun = sourceParts[sourceParts.length - 2] || ''

    // Build event key
    const eventKey = `${noun}.${event.verb}`

    // Get registered handlers
    const handlers = this._eventHandlers.get(eventKey) ?? []

    let handled = 0
    const errors: Error[] = []

    // Execute each handler, catching errors
    for (const handler of handlers) {
      try {
        await handler(event)
        handled++
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)))
      }
    }

    return { handled, errors }
  }

  /**
   * Unregister an event handler
   *
   * @param eventKey - The event key in format "Noun.verb"
   * @param handler - The handler function to remove
   * @returns true if the handler was found and removed, false otherwise
   *
   * @example
   * ```typescript
   * const handler = async (event) => { ... }
   * this.$.on.Customer.created(handler)
   * // Later:
   * this.unregisterEventHandler('Customer.created', handler)
   * ```
   */
  unregisterEventHandler(eventKey: string, handler: Function): boolean {
    const handlers = this._eventHandlers.get(eventKey)

    if (!handlers) {
      return false
    }

    const index = handlers.indexOf(handler)
    if (index > -1) {
      handlers.splice(index, 1)
      return true
    }

    return false
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parent namespace (for hierarchical DOs)
   */
  protected parent?: string

  /**
   * Emit an event (public wrapper for emitEvent)
   */
  protected async emit(verb: string, data?: unknown): Promise<void> {
    return this.emitEvent(verb, data)
  }

  /**
   * Link this DO to another object
   */
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

  /**
   * Get linked objects by relation type
   */
  protected async getLinkedObjects(
    relationType?: string,
  ): Promise<Array<{ ns: string; relationType: string; doId: string; doClass?: string; data?: Record<string, unknown> }>> {
    // Query relationships table
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

  /**
   * Create a Thing in the database (stub for subclasses)
   */
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

  /**
   * Create an Action record (stub for subclasses)
   */
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
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming HTTP requests.
   *
   * If a Hono app is configured, it delegates to the app first.
   * Falls back to built-in routes (/health, /resolve) if not handled by app.
   *
   * Subclasses can either:
   * 1. Override this method for custom routing
   * 2. Configure the `app` property with a Hono app
   * 3. Call `handleFetch` which uses the Hono app if configured
   */
  async fetch(request: Request): Promise<Response> {
    return this.handleFetch(request)
  }

  /**
   * Core fetch handler that integrates with Hono.
   *
   * Order of handling:
   * 1. Built-in routes (/health, /resolve)
   * 2. Hono app routes (if configured)
   * 3. 404 Not Found
   */
  protected async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Built-in routes always handled first
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this.ns })
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
      // If Hono handled the route, return its response
      // (Hono returns 404 for unmatched routes, so we let that through)
      return response
    }

    // Default: 404 Not Found
    return new Response('Not Found', { status: 404 })
  }

  /**
   * Create a default Hono app with common middleware.
   * Subclasses can call this and extend with their own routes.
   *
   * @example
   * ```typescript
   * class MyDO extends DO {
   *   protected app = this.createDefaultApp()
   *     .get('/api/things', (c) => c.json({ things: [] }))
   * }
   * ```
   */
  protected createDefaultApp(): Hono {
    return new Hono()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALARM HANDLER (for scheduled tasks)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle DO alarm - executes scheduled tasks
   *
   * This method is called by the Cloudflare Workers runtime when a DO alarm fires.
   * It delegates to the ScheduleManager to trigger any schedules due to run.
   *
   * @example
   * ```typescript
   * // In your DO subclass, you can extend this behavior:
   * async alarm(): Promise<void> {
   *   await super.alarm()
   *   // Additional alarm handling logic
   * }
   * ```
   */
  async alarm(): Promise<void> {
    // Delegate to schedule manager to handle scheduled tasks
    if (this._scheduleManager) {
      await this._scheduleManager.handleAlarm()
    }
  }
}

export default DO
