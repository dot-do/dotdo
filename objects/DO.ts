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
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context as HonoContext } from 'hono'
import * as schema from '../db'
import { isValidNounName } from '../db/nouns'
import type { WorkflowContext, DomainProxy, OnProxy, OnNounProxy, EventHandler, DomainEvent, ScheduleBuilder, ScheduleTimeProxy, ScheduleExecutor, ScheduleHandler, TryOptions, DoOptions, RetryPolicy, ActionStatus, ActionError } from '../types/WorkflowContext'
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
} from '../db/stores'
import { parseNounId, formatNounId } from '../lib/noun-id'
import type {
  CloneOptions,
  CloneResult,
  EventualCloneHandle,
  EventualCloneState,
  SyncStatus,
  SyncResult,
  ConflictInfo,
  ConflictResolution,
  CloneStatus,
  SyncPhase,
  StagedPrepareResult,
  StagedCommitResult,
  StagedAbortResult,
  StagingStatus,
  StagingData,
  Checkpoint,
  CheckpointState,
  ResumableCloneHandle,
  ResumableCloneStatus,
  ResumableCheckpoint,
  ResumableCloneOptions,
  ResumableCloneState,
  CloneLockState,
  CloneLockInfo,
} from '../types/Lifecycle'

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
// ENVIRONMENT - Re-export from unified types
// ============================================================================

// Import unified CloudflareEnv from types/CloudflareBindings
import type { CloudflareEnv, Pipeline } from '../types/CloudflareBindings'

/**
 * Env - Re-export of CloudflareEnv for backward compatibility
 *
 * @see CloudflareEnv in types/CloudflareBindings.ts for full documentation
 */
export type Env = CloudflareEnv

/**
 * DO stub interface for cross-DO communication
 */
interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * Circuit breaker state
 */
type CircuitBreakerState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker entry with state tracking
 */
interface CircuitBreakerEntry {
  failures: number
  openUntil: number
  state: CircuitBreakerState
  halfOpenTestInProgress?: boolean
}

/**
 * Stub cache entry with LRU tracking
 */
interface StubCacheEntry {
  stub: DOStub
  cachedAt: number
  lastUsed: number
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
  /** Maximum number of stubs to cache (LRU eviction) */
  STUB_CACHE_MAX_SIZE: 100,
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
  private _stubCache: Map<string, StubCacheEntry> = new Map()
  private _circuitBreaker: Map<string, CircuitBreakerEntry> = new Map()
  private _stubCacheMaxSize: number = CROSS_DO_CONFIG.STUB_CACHE_MAX_SIZE

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
  // NOUN FK RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a noun name to its FK (rowid) in the nouns table.
   * Results are cached in _typeCache for performance.
   *
   * @param noun - The noun name to resolve (must be PascalCase)
   * @returns The FK (rowid) of the noun in the nouns table
   * @throws Error if noun is not found in the nouns table
   *
   * @example
   * ```typescript
   * const fk = await this.resolveNounToFK('Startup')
   * // fk is the rowid of 'Startup' in the nouns table
   * ```
   */
  protected async resolveNounToFK(noun: string): Promise<number> {
    // Validate noun name
    if (!noun || noun.trim() === '') {
      throw new Error('Noun name cannot be empty')
    }

    if (!isValidNounName(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    // Check cache first
    const cached = this._typeCache.get(noun)
    if (cached !== undefined) {
      return cached
    }

    // Query the nouns table to get the rowid
    // SQLite tables have an implicit rowid column
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

    // Cache the result
    this._typeCache.set(noun, fk)

    return fk
  }

  /**
   * Register a noun in the nouns table and return its FK (rowid).
   * If the noun already exists, returns its existing FK.
   *
   * @param noun - The noun name to register (must be PascalCase)
   * @param config - Optional configuration for the noun
   * @returns The FK (rowid) of the noun in the nouns table
   *
   * @example
   * ```typescript
   * const fk = await this.registerNoun('Startup', { plural: 'Startups' })
   * ```
   */
  protected async registerNoun(
    noun: string,
    config?: { plural?: string; description?: string; schema?: unknown; doClass?: string }
  ): Promise<number> {
    // Validate noun name
    if (!noun || noun.trim() === '') {
      throw new Error('Noun name cannot be empty')
    }

    if (!isValidNounName(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    // Check if already exists (and cached)
    const cached = this._typeCache.get(noun)
    if (cached !== undefined) {
      return cached
    }

    // Check if exists in database
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

    // Insert the new noun
    await this.db.insert(schema.nouns).values({
      noun,
      plural: config?.plural ?? `${noun}s`,
      description: config?.description ?? null,
      schema: config?.schema ? JSON.stringify(config.schema) : null,
      doClass: config?.doClass ?? null,
    })

    // Get the rowid of the inserted noun
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

  /**
   * Get a typed collection accessor for a noun.
   * The noun must be registered in the nouns table before use.
   *
   * @param noun - The noun name (must be PascalCase)
   * @returns A collection accessor with get, list, find, create methods
   * @throws Error if noun name is invalid (not PascalCase or empty)
   *
   * @example
   * ```typescript
   * const startups = this.collection<Startup>('Startup')
   * const list = await startups.list()
   * const item = await startups.create({ name: 'Acme' })
   * ```
   */
  protected collection<T extends Thing = Thing>(noun: string): ThingsCollection<T> {
    // Validate noun name synchronously
    if (!noun || noun.trim() === '') {
      throw new Error('Noun name cannot be empty')
    }

    if (!isValidNounName(noun)) {
      throw new Error(`Invalid noun '${noun}': must be PascalCase`)
    }

    const self = this
    return {
      get: async (id: string): Promise<T | null> => {
        // Resolve noun to FK (uses cache)
        const typeFK = await self.resolveNounToFK(noun)

        // Query things filtered by type FK
        const results = await self.db.select().from(schema.things)
        const result = results.find((r) => r.id === id && r.type === typeFK && !r.deleted)
        if (!result) return null
        const data = result.data as Record<string, unknown> | null
        return { $id: result.id, $type: noun, ...data } as T
      },
      list: async (): Promise<T[]> => {
        // Resolve noun to FK (uses cache)
        const typeFK = await self.resolveNounToFK(noun)

        // Query things filtered by type FK
        const results = await self.db.select().from(schema.things)
        return results
          .filter((r) => r.type === typeFK && !r.deleted)
          .map((r) => {
            const data = r.data as Record<string, unknown> | null
            return { $id: r.id, $type: noun, ...data } as T
          })
      },
      find: async (query: Record<string, unknown>): Promise<T[]> => {
        // Resolve noun to FK (uses cache)
        const typeFK = await self.resolveNounToFK(noun)

        // Query things filtered by type FK and additional query
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
        // Resolve noun to FK (uses cache)
        const typeFK = await self.resolveNounToFK(noun)

        const id = (data as Record<string, unknown>).$id as string || crypto.randomUUID()
        await self.db.insert(schema.things).values({
          id,
          type: typeFK, // Use resolved FK instead of hardcoded 0
          branch: self.currentBranch,
          data: data as Record<string, unknown>,
          deleted: false,
        })

        // Update cache to ensure noun is cached after create
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
   * Default retry policy for durable execution
   */
  protected static readonly DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
  }

  /**
   * Default timeout for try operations (30 seconds)
   */
  protected static readonly DEFAULT_TRY_TIMEOUT = 30000

  /**
   * Step result cache for replay (maps stepId -> result)
   * Used by $.do() for durable execution
   */
  private _stepCache: Map<string, { result: unknown; completedAt: number }> = new Map()

  /**
   * Fire-and-forget event emission (non-blocking, non-durable)
   *
   * Uses queueMicrotask for truly non-blocking execution.
   * Does not await logging or event emission.
   * Swallows all errors silently (best effort).
   */
  protected send(event: string, data: unknown): void {
    // Use queueMicrotask for truly non-blocking execution
    queueMicrotask(() => {
      // Best-effort action logging - don't await
      this.logAction('send', event, data).catch(() => {
        // Silently swallow logging errors
      })

      // Best-effort event emission - don't await
      this.emitEvent(event, data).catch(() => {
        // Silently swallow event emission errors
      })

      // Best-effort action execution - don't await
      this.executeAction(event, data).catch(() => {
        // Silently swallow execution errors
      })
    })
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   *
   * Features:
   * - Single attempt, no retries
   * - Proper error propagation with original error type
   * - Timeout support
   * - Complete action status tracking
   *
   * @param action - The action to execute
   * @param data - The data to pass to the action
   * @param options - Optional execution options (timeout)
   */
  protected async try<T>(action: string, data: unknown, options?: TryOptions): Promise<T> {
    const timeout = options?.timeout ?? DO.DEFAULT_TRY_TIMEOUT
    const startedAt = new Date()

    // Log action with pending status
    const actionRecord = await this.logAction('try', action, data)

    // Update status to running
    await this.updateActionStatus(actionRecord.id, 'running', { startedAt })

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Action '${action}' timed out after ${timeout}ms`))
      }, timeout)
    })

    try {
      // Race between action execution and timeout
      const result = await Promise.race([
        this.executeAction(action, data),
        timeoutPromise,
      ]) as T

      // Calculate duration
      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      // Update action to completed
      await this.completeAction(actionRecord.id, result, { completedAt, duration })

      // Emit completion event
      await this.emitEvent(`${action}.completed`, { result })

      return result
    } catch (error) {
      // Calculate duration
      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      // Convert error to ActionError format
      const actionError: ActionError = {
        message: (error as Error).message,
        name: (error as Error).name,
        stack: (error as Error).stack,
      }

      // Update action to failed
      await this.failAction(actionRecord.id, actionError, { completedAt, duration })

      // Emit failure event (best effort)
      await this.emitEvent(`${action}.failed`, { error: actionError }).catch(() => {})

      // Re-throw original error to preserve type and stack
      throw error
    }
  }

  /**
   * Durable execution with retries (blocking, durable)
   *
   * Features:
   * - Configurable retry policy with exponential backoff and jitter
   * - Step persistence for replay
   * - Complete action lifecycle tracking
   * - Integration with WorkflowRuntime
   *
   * @param action - The action to execute
   * @param data - The data to pass to the action
   * @param options - Optional execution options (retry, timeout, stepId)
   */
  protected async do<T>(action: string, data: unknown, options?: DoOptions): Promise<T> {
    // Merge retry policy with defaults
    const retryPolicy: RetryPolicy = {
      ...DO.DEFAULT_RETRY_POLICY,
      ...options?.retry,
    }

    // Generate or use provided step ID
    const stepId = options?.stepId ?? this.generateStepId(action, data)

    // Check for cached step result (replay)
    const cachedResult = this._stepCache.get(stepId)
    if (cachedResult) {
      return cachedResult.result as T
    }

    const startedAt = new Date()

    // Log action with pending status
    const actionRecord = await this.logAction('do', action, data)

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      attempts = attempt

      // Update status to running (first attempt) or retrying (subsequent)
      const status: ActionStatus = attempt === 1 ? 'running' : 'retrying'
      await this.updateActionStatus(actionRecord.id, status, {
        startedAt,
        attempts,
      })

      try {
        // Execute the action
        const result = await this.executeAction(action, data) as T

        // Calculate duration
        const completedAt = new Date()
        const duration = completedAt.getTime() - startedAt.getTime()

        // Update action to completed
        await this.completeAction(actionRecord.id, result, {
          completedAt,
          duration,
          attempts,
        })

        // Cache step result for replay
        this._stepCache.set(stepId, {
          result,
          completedAt: completedAt.getTime(),
        })

        // Persist step result to storage
        await this.persistStepResult(stepId, result)

        // Emit completion event
        await this.emitEvent(`${action}.completed`, { result })

        return result
      } catch (error) {
        lastError = error as Error

        // Update attempts count
        await this.updateActionAttempts(actionRecord.id, attempts)

        // If more retries remain, wait with exponential backoff
        if (attempt < retryPolicy.maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt, retryPolicy)
          await this.sleep(delay)
        }
      }
    }

    // All retries exhausted - record failure
    const completedAt = new Date()
    const duration = completedAt.getTime() - startedAt.getTime()

    const actionError: ActionError = {
      message: lastError!.message,
      name: lastError!.name,
      stack: lastError!.stack,
    }

    await this.failAction(actionRecord.id, actionError, {
      completedAt,
      duration,
      attempts,
    })

    // Emit failure event
    await this.emitEvent(`${action}.failed`, { error: actionError })

    throw lastError
  }

  /**
   * Calculate backoff delay with optional jitter
   */
  protected calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
    // Exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
    let delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)

    // Cap at max delay
    delay = Math.min(delay, policy.maxDelayMs)

    // Add jitter (0-25% of delay)
    if (policy.jitter) {
      const jitterRange = delay * 0.25
      delay += Math.random() * jitterRange
    }

    return Math.floor(delay)
  }

  /**
   * Generate a deterministic step ID from action and data
   */
  protected generateStepId(action: string, data: unknown): string {
    const content = JSON.stringify({ action, data })
    // Simple hash for step ID (in production, use a proper hash function)
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return `${action}:${Math.abs(hash).toString(36)}`
  }

  /**
   * Persist step result to storage for durable replay
   */
  protected async persistStepResult(stepId: string, result: unknown): Promise<void> {
    try {
      await this.ctx.storage.put(`step:${stepId}`, {
        result,
        completedAt: Date.now(),
      })
    } catch {
      // Best effort persistence
    }
  }

  /**
   * Load persisted step results on initialization
   */
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

  /**
   * Log a new action to the actions table
   */
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

    return { id, rowid: 0 } // SQLite rowid is auto-assigned
  }

  /**
   * Update action status and optional fields
   */
  protected async updateActionStatus(
    actionId: string,
    status: ActionStatus,
    fields?: {
      startedAt?: Date
      attempts?: number
    }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = { status }

      if (fields?.startedAt) {
        updateData.startedAt = fields.startedAt
      }
      if (fields?.attempts !== undefined) {
        // Store attempts in options JSON field
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

  /**
   * Update action attempts count
   */
  protected async updateActionAttempts(actionId: string, attempts: number): Promise<void> {
    try {
      await this.db
        .update(schema.actions)
        .set({
          options: JSON.stringify({ attempts }),
        })
        .where(eq(schema.actions.id, actionId))
    } catch {
      // Best effort update
    }
  }

  /**
   * Complete an action successfully
   */
  protected async completeAction(
    actionId: string,
    output: unknown,
    fields?: {
      completedAt?: Date
      duration?: number
      attempts?: number
    }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status: 'completed' as ActionStatus,
        output: output as number, // This maps to the output field (thing rowid)
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

  /**
   * Fail an action with error details
   */
  protected async failAction(
    actionId: string,
    error: ActionError,
    fields?: {
      completedAt?: Date
      duration?: number
      attempts?: number
    }
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
   * Clone current state to a new DO with configurable modes.
   *
   * Atomic mode provides all-or-nothing semantics:
   * - Uses blockConcurrencyWhile for exclusive lock
   * - On failure, target has no partial state
   * - Source remains unchanged regardless of outcome
   *
   * Eventual mode provides async reconciliation:
   * - Returns immediately with a handle for monitoring/controlling
   * - Clone proceeds in background via alarms
   * - Supports eventual consistency with conflict resolution
   *
   * @param target - Target namespace URL
   * @param options - Clone options (mode, includeHistory, timeout, correlationId)
   * @returns CloneResult with stats about the cloned data, or EventualCloneHandle for eventual mode
   */
  async clone(
    target: string,
    options: {
      mode: 'atomic' | 'staged' | 'eventual' | 'resumable'
      includeHistory?: boolean
      timeout?: number
      correlationId?: string
      // Eventual mode options
      syncInterval?: number
      maxDivergence?: number
      conflictResolution?: 'last-write-wins' | 'source-wins' | 'target-wins' | 'merge'
      conflictResolver?: (conflict: ConflictInfo) => Promise<unknown>
      chunked?: boolean
      chunkSize?: number
      rateLimit?: number
    }
  ): Promise<{
    success: boolean
    ns: string
    doId: string
    mode: 'atomic' | 'staged' | 'eventual' | 'resumable'
    thingsCloned: number
    relationshipsCloned: number
    duration: number
    historyIncluded: boolean
    staged?: unknown
    checkpoint?: {
      id: string
      progress: number
      resumable?: boolean
    }
    // EventualCloneHandle properties for eventual mode
    id?: string
    status?: CloneStatus
    getProgress?: () => Promise<number>
    getSyncStatus?: () => Promise<SyncStatus>
    pause?: () => Promise<void>
    resume?: () => Promise<void>
    sync?: () => Promise<SyncResult>
    cancel?: () => Promise<void>
  } | EventualCloneHandle> {
    const {
      mode,
      includeHistory = false,
      timeout = 30000,
      correlationId = crypto.randomUUID(),
    } = options

    // Handle eventual mode
    if (mode === 'eventual') {
      return this.initiateEventualClone(target, options as typeof options & { mode: 'eventual' })
    }

    // Handle staged mode (two-phase commit)
    if (mode === 'staged') {
      return this.prepareStagedClone(target, options as typeof options & { mode: 'staged' })
    }

    // Handle resumable mode (checkpoint-based)
    if (mode === 'resumable') {
      return this.initiateResumableClone(target, options as unknown as ResumableCloneOptions) as unknown as ReturnType<typeof this.clone>
    }

    // For now, only atomic mode is implemented for other modes
    if (mode !== 'atomic') {
      throw new Error(`Clone mode '${mode}' not yet implemented`)
    }

    const startTime = Date.now()

    // === VALIDATION ===

    // Validate options
    if (typeof timeout !== 'number' || timeout < 0) {
      throw new Error('Invalid timeout: must be a non-negative number')
    }

    // Validate target namespace URL format
    try {
      const url = new URL(target)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid namespace URL: must use http or https protocol')
      }
    } catch (e) {
      if ((e as Error).message?.includes('Invalid namespace URL')) {
        throw e
      }
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Prevent cloning to same namespace
    if (target === this.ns) {
      throw new Error('Cannot clone to same namespace')
    }

    // Get things to validate source has state
    const things = await this.db.select().from(schema.things)
    const nonDeletedThings = things.filter((t) => !t.deleted)

    if (nonDeletedThings.length === 0) {
      throw new Error('No state to clone: source is empty')
    }

    // Get relationships
    const relationships = await this.db.select().from(schema.relationships)

    // Acquire exclusive lock using blockConcurrencyWhile
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        // Emit clone.started event
        await this.emitEvent('clone.started', {
          target,
          mode,
          correlationId,
          thingsCount: nonDeletedThings.length,
        })

        // Validate DO namespace is configured
        if (!this.env.DO) {
          throw new Error('DO namespace not configured')
        }

        // Create target DO and check reachability via health check
        const doId = this.env.DO.idFromName(target)
        const stub = this.env.DO.get(doId)

        // Health check - validate target is reachable
        try {
          const healthResponse = await Promise.race([
            stub.fetch(new Request(`https://${target}/health`)),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout')), Math.min(timeout, 5000))
            ),
          ])

          // Check for non-2xx/non-OK responses (404 is acceptable for new DOs)
          if (!healthResponse.ok && healthResponse.status !== 404) {
            throw new Error(`Target health check failed: ${healthResponse.status}`)
          }
        } catch (e) {
          const errorMessage = (e as Error).message || String(e)
          if (
            errorMessage.includes('Connection refused') ||
            errorMessage.includes('unreachable') ||
            errorMessage.includes('Health check')
          ) {
            throw new Error(`Target unreachable: health check failed - ${errorMessage}`)
          }
          // Re-throw other errors
          throw e
        }

        // Get latest version of each thing (by id)
        const latestVersions = new Map<string, (typeof things)[0]>()
        for (const thing of nonDeletedThings) {
          const existing = latestVersions.get(thing.id)
          if (!existing) {
            latestVersions.set(thing.id, thing)
          }
        }

        // Prepare data for transfer
        const thingsToClone = Array.from(latestVersions.values()).map((t) => ({
          id: t.id,
          type: t.type,
          branch: t.branch,
          name: t.name,
          data: t.data,
          deleted: false,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }))

        // Clone relationships
        const relationshipsToClone = relationships.map((r) => ({
          id: r.id,
          verb: r.verb,
          from: r.from,
          to: r.to,
          data: r.data,
          createdAt: r.createdAt,
        }))

        // If includeHistory is true, get actions and events
        let actionsToClone: unknown[] = []
        let eventsToClone: unknown[] = []

        if (includeHistory) {
          const actions = await this.db.select().from(schema.actions)
          actionsToClone = actions

          const events = await this.db.select().from(schema.events)
          eventsToClone = events
        }

        // Transfer to target with timeout
        const transferPromise = stub.fetch(
          new Request(`https://${target}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              things: thingsToClone,
              relationships: relationshipsToClone,
              actions: includeHistory ? actionsToClone : undefined,
              events: includeHistory ? eventsToClone : undefined,
              correlationId,
            }),
          })
        )

        const response = await Promise.race([
          transferPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Clone timeout after ${timeout}ms`)), timeout)
          ),
        ])

        // Check response
        if (!response.ok) {
          throw new Error(`Transfer failed: ${response.status} ${response.statusText}`)
        }

        const duration = Date.now() - startTime

        // Emit clone.completed event
        await this.emitEvent('clone.completed', {
          target,
          doId: doId.toString(),
          correlationId,
          thingsCount: latestVersions.size,
          duration,
        })

        return {
          success: true,
          ns: target,
          doId: doId.toString(),
          mode: 'atomic' as const,
          thingsCloned: latestVersions.size,
          relationshipsCloned: relationshipsToClone.length,
          duration,
          historyIncluded: includeHistory,
        }
      } catch (error) {
        const errorMessage = (error as Error).message || String(error)

        // Emit clone.failed event
        await this.emitEvent('clone.failed', {
          target,
          error: errorMessage,
          correlationId,
        })

        // Emit clone.rollback event
        await this.emitEvent('clone.rollback', {
          target,
          reason: errorMessage,
          correlationId,
        })

        throw error
      }
    })
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
  // EVENTUAL CLONE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Custom conflict resolver functions keyed by clone ID
   * (Cannot be stored in durable storage, so kept in memory)
   */
  private _conflictResolvers: Map<string, (conflict: ConflictInfo) => Promise<unknown>> = new Map()

  /**
   * Initiate an eventual clone operation
   * Returns immediately with a handle for monitoring/controlling the clone
   */
  private async initiateEventualClone(
    target: string,
    options: CloneOptions & { mode: 'eventual' }
  ): Promise<EventualCloneHandle> {
    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Generate unique clone ID
    const id = crypto.randomUUID()

    // Get initial thing count for progress tracking
    const things = await this.db.select().from(schema.things)
    const cloneBranch = options?.branch || this.currentBranch
    const branchFilter = cloneBranch === 'main' ? null : cloneBranch
    const branchThings = things.filter(t => t.branch === branchFilter && !t.deleted)
    const totalItems = branchThings.length

    // Extract options with defaults
    const syncInterval = (options as Record<string, unknown>)?.syncInterval as number ?? 5000
    const maxDivergence = (options as Record<string, unknown>)?.maxDivergence as number ?? 100
    const conflictResolution = ((options as Record<string, unknown>)?.conflictResolution as ConflictResolution) ?? 'last-write-wins'
    const chunked = (options as Record<string, unknown>)?.chunked as boolean ?? false
    const chunkSize = (options as Record<string, unknown>)?.chunkSize as number ?? 1000
    const rateLimit = (options as Record<string, unknown>)?.rateLimit as number | null ?? null

    // Store custom resolver if provided
    const customResolver = (options as Record<string, unknown>)?.conflictResolver as ((conflict: ConflictInfo) => Promise<unknown>) | undefined
    if (customResolver) {
      this._conflictResolvers.set(id, customResolver)
    }

    // Create initial state
    const state: EventualCloneState = {
      id,
      targetNs: target,
      status: 'pending',
      progress: 0,
      phase: 'initial',
      itemsSynced: 0,
      totalItems,
      itemsRemaining: totalItems,
      lastSyncAt: null,
      divergence: totalItems, // Initially all items need syncing
      maxDivergence,
      syncInterval,
      errorCount: 0,
      lastError: null,
      conflictResolution: customResolver ? 'custom' : conflictResolution,
      hasCustomResolver: !!customResolver,
      chunked,
      chunkSize,
      rateLimit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedVersion: 0,
    }

    // Store clone operation state
    await this.ctx.storage.put(`eventual:${id}`, state)

    // Emit clone.initiated event
    await this.emitEvent('clone.initiated', { id, target, mode: 'eventual' })

    // Schedule initial sync via alarm (100ms delay to allow immediate return)
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (!currentAlarm || currentAlarm > Date.now() + 100) {
      await this.ctx.storage.setAlarm(Date.now() + 100)
    }

    // Return handle
    return this.createEventualHandle(id, state)
  }

  /**
   * Create an EventualCloneHandle for controlling a clone operation
   */
  private createEventualHandle(id: string, initialState: EventualCloneState): EventualCloneHandle {
    const self = this

    // Create a mutable status property that updates when handle methods are called
    let currentStatus: CloneStatus = initialState.status

    const handle: EventualCloneHandle = {
      id,
      get status() {
        return currentStatus
      },

      async getProgress(): Promise<number> {
        const state = await self.getEventualCloneState(id)
        if (state) {
          currentStatus = state.status
        }
        return state?.progress ?? 0
      },

      async getSyncStatus(): Promise<SyncStatus> {
        const state = await self.getEventualCloneState(id)
        if (state) {
          currentStatus = state.status
        }
        return {
          phase: state?.phase ?? 'initial',
          itemsSynced: state?.itemsSynced ?? 0,
          totalItems: state?.totalItems ?? 0,
          lastSyncAt: state?.lastSyncAt ? new Date(state.lastSyncAt) : null,
          divergence: state?.divergence ?? 0,
          maxDivergence: state?.maxDivergence ?? 100,
          syncInterval: state?.syncInterval ?? 5000,
          errorCount: state?.errorCount ?? 0,
          lastError: state?.lastError ? new Error(state.lastError) : null,
        }
      },

      async pause(): Promise<void> {
        const state = await self.getEventualCloneState(id)
        if (!state) {
          throw new Error(`Clone operation not found: ${id}`)
        }
        state.status = 'paused'
        state.updatedAt = new Date().toISOString()
        await self.ctx.storage.put(`eventual:${id}`, state)
        currentStatus = 'paused'
        await self.emitEvent('clone.paused', { id })
      },

      async resume(): Promise<void> {
        const state = await self.getEventualCloneState(id)
        if (!state) {
          throw new Error(`Clone operation not found: ${id}`)
        }
        state.status = state.phase === 'delta' || state.phase === 'catchup' ? 'active' : 'syncing'
        state.updatedAt = new Date().toISOString()
        await self.ctx.storage.put(`eventual:${id}`, state)
        currentStatus = state.status
        await self.emitEvent('clone.resumed', { id })

        // Schedule immediate sync
        const currentAlarm = await self.ctx.storage.getAlarm()
        if (!currentAlarm || currentAlarm > Date.now() + 100) {
          await self.ctx.storage.setAlarm(Date.now() + 100)
        }
      },

      async sync(): Promise<SyncResult> {
        return self.performEventualSync(id)
      },

      async cancel(): Promise<void> {
        const state = await self.getEventualCloneState(id)
        if (!state) {
          throw new Error(`Clone operation not found: ${id}`)
        }
        state.status = 'cancelled'
        state.updatedAt = new Date().toISOString()
        await self.ctx.storage.put(`eventual:${id}`, state)
        currentStatus = 'cancelled'
        await self.emitEvent('clone.cancelled', { id })
      },
    }

    return handle
  }

  /**
   * Get the current state of an eventual clone operation
   */
  private async getEventualCloneState(id: string): Promise<EventualCloneState | null> {
    return await this.ctx.storage.get(`eventual:${id}`) as EventualCloneState | null
  }

  /**
   * Perform a sync operation for an eventual clone
   */
  private async performEventualSync(id: string): Promise<SyncResult> {
    const startTime = Date.now()
    const state = await this.getEventualCloneState(id)
    if (!state) {
      throw new Error(`Clone operation not found: ${id}`)
    }

    // Skip if cancelled or paused
    if (state.status === 'cancelled' || state.status === 'paused') {
      return { itemsSynced: 0, duration: 0, conflicts: [] }
    }

    const conflicts: ConflictInfo[] = []
    let itemsSynced = 0

    try {
      // Update status to syncing
      if (state.status === 'pending') {
        state.status = 'syncing'
        state.phase = 'bulk'
        await this.ctx.storage.put(`eventual:${id}`, state)
        await this.emitEvent('clone.syncing', { id, progress: state.progress })
      }

      // Get things to sync
      const things = await this.db.select().from(schema.things)
      const cloneBranch = 'main' // Default to main for now
      const branchFilter = cloneBranch === 'main' ? null : cloneBranch
      const branchThings = things.filter(t => t.branch === branchFilter && !t.deleted)

      // Get latest version of each thing
      const latestVersions = new Map<string, typeof things[0]>()
      for (const thing of branchThings) {
        latestVersions.set(thing.id, thing)
      }

      // Calculate items to sync based on phase
      let itemsToSync: Array<typeof things[0]> = []
      if (state.phase === 'bulk' || state.phase === 'initial') {
        // Bulk transfer: send all items
        itemsToSync = Array.from(latestVersions.values())
      } else {
        // Delta sync: only send items changed since last sync
        itemsToSync = Array.from(latestVersions.values()).filter((_, idx) => idx >= state.lastSyncedVersion)
      }

      // Apply chunking if enabled
      if (state.chunked && itemsToSync.length > state.chunkSize) {
        itemsToSync = itemsToSync.slice(0, state.chunkSize)
      }

      // Apply rate limiting if configured
      if (state.rateLimit && itemsToSync.length > state.rateLimit) {
        itemsToSync = itemsToSync.slice(0, state.rateLimit)
      }

      // Send items to target DO
      if (this.env.DO && itemsToSync.length > 0) {
        const doId = this.env.DO.idFromName(state.targetNs)
        const stub = this.env.DO.get(doId)

        // Attempt to send data to target
        const response = await stub.fetch(new Request(`https://${state.targetNs}/sync`, {
          method: 'POST',
          body: JSON.stringify({
            cloneId: id,
            things: itemsToSync.map(t => ({
              id: t.id,
              type: t.type,
              branch: null,
              name: t.name,
              data: t.data,
              deleted: false,
              version: things.indexOf(t) + 1, // Simulate version
            })),
          }),
        }))

        if (response.ok) {
          itemsSynced = itemsToSync.length

          // Check for conflicts in response
          try {
            const responseData = await response.json() as { conflicts?: Array<{ thingId: string; sourceVersion: number; targetVersion: number }> }
            if (responseData.conflicts && Array.isArray(responseData.conflicts)) {
              for (const conflict of responseData.conflicts) {
                const resolution = state.hasCustomResolver ? 'custom' : state.conflictResolution
                const conflictInfo: ConflictInfo = {
                  thingId: conflict.thingId,
                  sourceVersion: conflict.sourceVersion,
                  targetVersion: conflict.targetVersion,
                  resolution,
                  resolvedAt: new Date(),
                }
                conflicts.push(conflictInfo)

                // Emit conflict event
                await this.emitEvent('clone.conflict', { id, ...conflictInfo })
              }
            }
          } catch {
            // Response may not be JSON, that's ok
          }
        }
      } else if (itemsToSync.length === 0) {
        // Nothing to sync
        itemsSynced = 0
      }

      // Update state
      state.itemsSynced += itemsSynced
      state.lastSyncedVersion += itemsSynced
      state.lastSyncAt = new Date().toISOString()
      state.itemsRemaining = Math.max(0, state.totalItems - state.itemsSynced)
      state.progress = state.totalItems > 0 ? Math.floor((state.itemsSynced / state.totalItems) * 100) : 100
      state.divergence = state.itemsRemaining
      state.errorCount = 0 // Reset error count on success
      state.lastError = null
      state.updatedAt = new Date().toISOString()

      // Transition phases
      if (state.progress >= 100) {
        state.status = 'active'
        state.phase = 'delta'
        await this.emitEvent('clone.active', { id, target: state.targetNs })
      } else if (state.itemsSynced > 0 && state.phase === 'bulk') {
        // Still in bulk phase but making progress
        state.phase = state.progress >= 80 ? 'catchup' : 'bulk'
      }

      await this.ctx.storage.put(`eventual:${id}`, state)

      const duration = Date.now() - startTime
      await this.emitEvent('clone.sync.completed', { id, itemsSynced, duration })

      return { itemsSynced, duration, conflicts }
    } catch (error) {
      // Handle errors with backoff
      state.errorCount++
      state.lastError = (error as Error).message
      state.updatedAt = new Date().toISOString()

      // If too many errors, transition to error state
      if (state.errorCount >= 10) {
        state.status = 'error'
        await this.emitEvent('clone.error', { id, error: state.lastError })
      }

      await this.ctx.storage.put(`eventual:${id}`, state)

      const duration = Date.now() - startTime
      return { itemsSynced: 0, duration, conflicts: [] }
    }
  }

  /**
   * Handle eventual clone syncing in the alarm handler
   */
  private async handleEventualCloneAlarms(): Promise<void> {
    // Find all active eventual clones
    const keys = await this.ctx.storage.list({ prefix: 'eventual:' })

    let nextAlarmTime: number | null = null

    for (const [key, value] of keys) {
      const state = value as EventualCloneState

      // Skip cancelled, paused, or error states
      if (state.status === 'cancelled' || state.status === 'paused' || state.status === 'error') {
        continue
      }

      // Check if sync is due
      const lastSync = state.lastSyncAt ? new Date(state.lastSyncAt).getTime() : 0
      const now = Date.now()
      const nextSync = lastSync + state.syncInterval

      // Check for divergence threshold trigger
      const needsSync = now >= nextSync || state.divergence > state.maxDivergence

      if (needsSync || state.status === 'pending') {
        // Perform sync
        await this.performEventualSync(state.id)

        // Refresh state after sync
        const updatedState = await this.getEventualCloneState(state.id)
        if (updatedState && updatedState.status !== 'active' && updatedState.status !== 'cancelled' && updatedState.status !== 'error') {
          // Schedule next sync
          const nextSyncTime = Date.now() + updatedState.syncInterval
          if (!nextAlarmTime || nextSyncTime < nextAlarmTime) {
            nextAlarmTime = nextSyncTime
          }
        }
      } else {
        // Schedule alarm for when sync is due
        if (!nextAlarmTime || nextSync < nextAlarmTime) {
          nextAlarmTime = nextSync
        }
      }
    }

    // Set next alarm if needed
    if (nextAlarmTime) {
      await this.ctx.storage.setAlarm(nextAlarmTime)
    }
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
    // Check circuit breaker state
    const circuitState = this._circuitBreaker.get(ns)
    if (circuitState) {
      const now = Date.now()

      if (circuitState.state === 'open') {
        if (now >= circuitState.openUntil) {
          // Transition to half-open state
          circuitState.state = 'half-open'
          circuitState.halfOpenTestInProgress = false
          this._circuitBreaker.set(ns, circuitState)
        } else {
          throw new Error(`Circuit breaker open for namespace: ${ns}`)
        }
      }

      if (circuitState.state === 'half-open') {
        if (circuitState.halfOpenTestInProgress) {
          // Another request is testing the circuit
          throw new Error('Circuit breaker in half-open test')
        }
        // Mark that we're testing the circuit
        circuitState.halfOpenTestInProgress = true
        this._circuitBreaker.set(ns, circuitState)
      }
    }

    // Look up namespace in objects table (with R2 SQL fallback)
    let obj = await this.objects.get(ns)
    if (!obj) {
      // Try R2 SQL global fallback if available
      const objectsWithGlobal = this.objects as typeof this.objects & { getGlobal?: (ns: string) => Promise<unknown> }
      if (typeof objectsWithGlobal.getGlobal === 'function') {
        obj = await objectsWithGlobal.getGlobal(ns) as typeof obj

        // Cache global result in local objects table
        if (obj) {
          const objectsWithRegister = this.objects as typeof this.objects & { register?: (data: unknown) => Promise<unknown> }
          if (typeof objectsWithRegister.register === 'function') {
            await objectsWithRegister.register(obj).catch(() => {}) // Best effort
          }
        }
      }
    }

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
   * Get a cached stub or create a new one (with LRU eviction)
   */
  private getOrCreateStub(ns: string, doId: string): DOStub {
    const now = Date.now()
    const cached = this._stubCache.get(ns)

    // Return cached stub if still valid, updating lastUsed for LRU
    if (cached && now - cached.cachedAt < CROSS_DO_CONFIG.STUB_CACHE_TTL) {
      cached.lastUsed = now
      return cached.stub
    }

    // Create new stub
    const doNamespace = this.env.DO as {
      idFromString(id: string): unknown
      get(id: unknown): DOStub
    }
    const id = doNamespace.idFromString(doId)
    const stub = doNamespace.get(id)

    // Evict LRU entries if cache is full
    this.evictLRUStubs()

    // Cache the stub with LRU tracking
    this._stubCache.set(ns, { stub, cachedAt: now, lastUsed: now })

    return stub
  }

  /**
   * Evict least recently used stubs if cache exceeds max size
   */
  private evictLRUStubs(): void {
    while (this._stubCache.size >= this._stubCacheMaxSize) {
      // Find the least recently used entry
      let lruNs: string | null = null
      let lruLastUsed = Infinity

      for (const [ns, entry] of this._stubCache) {
        if (entry.lastUsed < lruLastUsed) {
          lruLastUsed = entry.lastUsed
          lruNs = ns
        }
      }

      if (lruNs) {
        this._stubCache.delete(lruNs)
      } else {
        break // Safety: avoid infinite loop
      }
    }
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordFailure(ns: string): void {
    const state = this._circuitBreaker.get(ns) || { failures: 0, openUntil: 0, state: 'closed' as CircuitBreakerState }
    state.failures++

    if (state.failures >= CROSS_DO_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      // Open the circuit
      state.state = 'open'
      state.openUntil = Date.now() + CROSS_DO_CONFIG.CIRCUIT_BREAKER_TIMEOUT
      state.failures = 0 // Reset for next cycle

      // Invalidate cached stub when circuit breaks
      this._stubCache.delete(ns)
    }

    // If in half-open state and we got a failure, re-open the circuit
    if (state.state === 'half-open') {
      state.state = 'open'
      state.openUntil = Date.now() + CROSS_DO_CONFIG.CIRCUIT_BREAKER_TIMEOUT
      state.halfOpenTestInProgress = false
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
    // Handle eventual clone syncing
    await this.handleEventualCloneAlarms()

    // Delegate to schedule manager to handle scheduled tasks
    if (this._scheduleManager) {
      await this._scheduleManager.handleAlarm()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISIBILITY HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Actor context for visibility checks.
   * Set per-request from session/auth context.
   */
  private _currentActorContext: { userId?: string; orgId?: string } = {}

  /**
   * Set the current actor context for visibility checks.
   * Call this at the start of each request after authentication.
   *
   * @param actor - Actor context with userId and optional orgId
   *
   * @example
   * ```typescript
   * // In your fetch handler after authentication
   * this.setActorContext({
   *   userId: authContext.userId,
   *   orgId: session?.activeOrganizationId
   * })
   * ```
   */
  protected setActorContext(actor: { userId?: string; orgId?: string }): void {
    this._currentActorContext = actor
  }

  /**
   * Get the current actor context for visibility checks.
   *
   * @returns Current actor context
   */
  protected getActorContext(): { userId?: string; orgId?: string } {
    return this._currentActorContext
  }

  /**
   * Clear the current actor context.
   * Call this at the end of each request to prevent context leakage.
   */
  protected clearActorContext(): void {
    this._currentActorContext = {}
  }

  /**
   * Check if the current actor can view a thing based on visibility.
   *
   * Visibility rules:
   * - 'public': Anyone can view
   * - 'unlisted': Anyone with the link can view
   * - 'org': Only members of the thing's organization can view
   * - 'user': Only the owner can view
   *
   * @param thing - The thing to check visibility for
   * @returns true if the current actor can view the thing
   *
   * @example
   * ```typescript
   * const thing = await this.things.get(id)
   * if (!this.canViewThing(thing)) {
   *   throw new Error('Access denied')
   * }
   * ```
   */
  protected canViewThing(thing: Thing | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const visibility = (thing.data as Record<string, unknown>)?.visibility as string | undefined ?? 'user'
    const actor = this._currentActorContext

    // Public and unlisted are viewable by anyone
    if (visibility === 'public' || visibility === 'unlisted') {
      return true
    }

    // Org visibility requires matching orgId
    if (visibility === 'org') {
      const thingOrgId = (thing.data as Record<string, unknown>)?.meta?.orgId as string | undefined ??
                          (thing.data as Record<string, unknown>)?.orgId as string | undefined
      return !!actor.orgId && actor.orgId === thingOrgId
    }

    // User visibility requires matching ownerId
    const thingOwnerId = (thing.data as Record<string, unknown>)?.meta?.ownerId as string | undefined ??
                          (thing.data as Record<string, unknown>)?.ownerId as string | undefined
    return !!actor.userId && actor.userId === thingOwnerId
  }

  /**
   * Assert that the current actor can view a thing, throwing if not.
   *
   * @param thing - The thing to check visibility for
   * @param message - Optional custom error message
   * @throws Error if access is denied
   *
   * @example
   * ```typescript
   * const thing = await this.things.get(id)
   * this.assertCanView(thing) // throws if not allowed
   * return thing
   * ```
   */
  protected assertCanView(thing: Thing | null | undefined, message?: string): void {
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

  /**
   * Filter a list of things to only those the current actor can view.
   *
   * @param things - Array of things to filter
   * @returns Filtered array of visible things
   *
   * @example
   * ```typescript
   * const allThings = await this.things.list()
   * return this.filterVisibleThings(allThings)
   * ```
   */
  protected filterVisibleThings<T extends Thing>(things: T[]): T[] {
    return things.filter((thing) => this.canViewThing(thing))
  }

  /**
   * Get a thing by ID, checking visibility.
   * Returns null if the thing doesn't exist or isn't visible to the actor.
   *
   * @param id - Thing ID to retrieve
   * @returns The thing if found and visible, null otherwise
   *
   * @example
   * ```typescript
   * const thing = await this.getVisibleThing('thing-123')
   * if (!thing) {
   *   return c.json({ error: 'Not found' }, 404)
   * }
   * ```
   */
  protected async getVisibleThing(id: string): Promise<Thing | null> {
    const thing = await this.things.get(id)
    if (!thing) {
      return null
    }
    return this.canViewThing(thing) ? thing : null
  }

  /**
   * Get the visibility level of a thing.
   *
   * @param thing - The thing to check
   * @returns The visibility level ('public', 'unlisted', 'org', 'user')
   */
  protected getVisibility(thing: Thing | null | undefined): 'public' | 'unlisted' | 'org' | 'user' {
    if (!thing) {
      return 'user'
    }
    return ((thing.data as Record<string, unknown>)?.visibility as string | undefined) as 'public' | 'unlisted' | 'org' | 'user' ?? 'user'
  }

  /**
   * Check if the current actor is the owner of a thing.
   *
   * @param thing - The thing to check ownership of
   * @returns true if the current actor is the owner
   */
  protected isOwner(thing: Thing | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const thingOwnerId = (thing.data as Record<string, unknown>)?.meta?.ownerId as string | undefined ??
                          (thing.data as Record<string, unknown>)?.ownerId as string | undefined

    const actor = this._currentActorContext
    return !!actor.userId && actor.userId === thingOwnerId
  }

  /**
   * Check if the current actor is in the same org as a thing.
   *
   * @param thing - The thing to check org membership for
   * @returns true if the current actor is in the thing's org
   */
  protected isInThingOrg(thing: Thing | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const thingOrgId = (thing.data as Record<string, unknown>)?.meta?.orgId as string | undefined ??
                        (thing.data as Record<string, unknown>)?.orgId as string | undefined

    const actor = this._currentActorContext
    return !!actor.orgId && actor.orgId === thingOrgId
  }
}

export default DO
