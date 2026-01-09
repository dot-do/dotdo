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
import type { WorkflowContext, DomainProxy, OnProxy, OnNounProxy, EventHandler, DomainEvent, ScheduleBuilder, ScheduleTimeProxy, ScheduleExecutor, ScheduleHandler, TryOptions, DoOptions, RetryPolicy, ActionStatus, ActionError, HandlerOptions, HandlerRegistration, EnhancedDispatchResult, EventFilter, AIPipelinePromise, WriteResult, ExtractResult, AITemplateLiteralFn, DecideFn } from '../types/WorkflowContext'
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
import { parseNounId, formatNounId } from '../lib/noun-id'
import {
  ai as aiFunc,
  write as writeFunc,
  summarize as summarizeFunc,
  list as listFunc,
  extract as extractFunc,
  is as isFunc,
  decide as decideFunc,
} from '../ai'
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
  MoveResult,
} from '../types/Lifecycle'
import type { ColoCode, ColoCity, Region } from '../types/Location'
import { normalizeLocation, coloRegion, cityToCode } from '../types/Location'

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
   * Instance getter that delegates to the static $type property.
   * This allows TypeScript to recognize `this.$type` on instances.
   */
  get $type(): string {
    return (this.constructor as typeof DO).$type
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
  // Value: Array of registered handler registrations with metadata
  protected _eventHandlers: Map<string, HandlerRegistration[]> = new Map()

  // Counter for generating unique handler names
  private _handlerCounter: number = 0

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
   *
   * The DLQ integrates with event handlers for replay functionality.
   * When a handler fails, the event is added to the DLQ and can be replayed.
   */
  get dlq(): DLQStore {
    if (!this._dlq) {
      // Create an adapter map for DLQ that extracts handlers from registrations
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

          // Branching
          case 'branch':
            return self.branch.bind(self)
          case 'checkout':
            return self.checkout.bind(self)
          case 'merge':
            return self.merge.bind(self)

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
      includeState?: boolean
      shallow?: boolean
      transform?: (state: { things: Array<{ id: string; type: unknown; branch: string | null; name: string | null; data: Record<string, unknown>; deleted: boolean }>; relationships?: Array<{ id: string; verb: string; from: string; to: string; data: Record<string, unknown> | null }> }) => { things: Array<{ id: string; type: unknown; branch: string | null; name: string | null; data: Record<string, unknown>; deleted: boolean }>; relationships?: Array<{ id: string; verb: string; from: string; to: string; data: Record<string, unknown> | null }> } | Promise<{ things: Array<{ id: string; type: unknown; branch: string | null; name: string | null; data: Record<string, unknown>; deleted: boolean }>; relationships?: Array<{ id: string; verb: string; from: string; to: string; data: Record<string, unknown> | null }> }>
      branch?: string
      version?: number
      colo?: string
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
      includeState = true,
      shallow = false,
      transform,
      branch: targetBranch,
      version: targetVersion,
      colo,
      timeout = 30000,
      correlationId = crypto.randomUUID(),
    } = options

    // Validate mode first
    const validModes = ['atomic', 'staged', 'eventual', 'resumable']
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode: '${mode}' is not a valid clone mode`)
    }

    // Handle eventual mode
    if (mode === 'eventual') {
      return this.initiateEventualClone(target, options as typeof options & { mode: 'eventual' })
    }

    // Handle staged mode (two-phase commit)
    if (mode === 'staged') {
      return this.prepareStagedClone(target, options as typeof options & { mode: 'staged' }) as unknown as ReturnType<typeof this.clone>
    }

    // Handle resumable mode (checkpoint-based)
    if (mode === 'resumable') {
      return this.initiateResumableClone(target, options as unknown as ResumableCloneOptions) as unknown as ReturnType<typeof this.clone>
    }

    const startTime = Date.now()

    // === VALIDATION ===

    // Validate options
    if (typeof timeout !== 'number' || timeout < 0) {
      throw new Error('Invalid timeout: must be a non-negative number')
    }

    // Validate colo code if provided
    if (colo && !DO.VALID_COLOS.has(colo)) {
      throw new Error(`Invalid colo: '${colo}' is not a valid location code`)
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

    // Validate branch if specified
    if (targetBranch) {
      const branches = await this.db.select().from(schema.branches)
      const branchExists = branches.some(b => b.name === targetBranch)
      if (!branchExists) {
        throw new Error(`Branch not found: '${targetBranch}'`)
      }
    }

    // Validate version if specified
    if (targetVersion !== undefined) {
      // First, check if version is a positive number
      if (targetVersion < 0 || !Number.isInteger(targetVersion)) {
        throw new Error(`Invalid version: ${targetVersion}`)
      }

      // Get branches and find the main branch
      const branches = await this.db.select().from(schema.branches)
      const mainBranch = branches.find(b => b.name === 'main' || b.name === null)

      // Get the max version from things table as fallback
      const allThings = await this.db.select().from(schema.things)
      const maxVersion = Math.max(allThings.length, mainBranch?.head ?? 0)

      // Version must exist (not exceed max known version)
      if (targetVersion > maxVersion) {
        throw new Error(`Version not found: ${targetVersion}`)
      }
    }

    // Get things to validate source has state
    let things = await this.db.select().from(schema.things)

    // Filter by branch if specified
    if (targetBranch) {
      things = things.filter((t) => t.branch === targetBranch)
    }

    const nonDeletedThings = things.filter((t) => !t.deleted)

    // Only check for empty state if includeState is true
    if (includeState && nonDeletedThings.length === 0) {
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
        const targetUrl = new URL(target)
        const doId = this.env.DO.idFromName(target)
        const stub = this.env.DO.get(doId)

        // Health check - validate target is reachable
        try {
          const healthResponse = await Promise.race([
            stub.fetch(new Request(`${targetUrl.origin}/health`)),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout')), Math.min(timeout, 5000))
            ),
          ])

          // Check for non-2xx/non-OK responses (404 is acceptable for new DOs)
          if (!healthResponse.ok && healthResponse.status !== 404) {
            // 409 Conflict means target already exists
            if (healthResponse.status === 409) {
              throw new Error('Target already exists: conflict detected')
            }
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

        // Get latest version of each thing (by id) - skip if includeState is false
        const latestVersions = new Map<string, (typeof things)[0]>()
        if (includeState) {
          for (const thing of nonDeletedThings) {
            const existing = latestVersions.get(thing.id)
            if (!existing) {
              latestVersions.set(thing.id, thing)
            }
          }
        }

        // Prepare data for transfer (empty if includeState is false)
        const thingsToClone = includeState
          ? Array.from(latestVersions.values()).map((t) => ({
              id: t.id,
              type: t.type,
              branch: t.branch,
              name: t.name,
              data: t.data,
              deleted: false,
            }))
          : []

        // Clone relationships (skip if shallow mode)
        const relationshipsToClone = shallow
          ? []
          : relationships.map((r) => ({
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

        // Apply transform function if provided
        let finalThingsToClone = thingsToClone
        let finalRelationshipsToClone = relationshipsToClone

        if (transform) {
          try {
            // Build state object for transform
            const stateForTransform = {
              things: thingsToClone.map((t) => ({
                id: t.id,
                type: t.type as unknown,
                branch: t.branch,
                name: t.name,
                data: t.data as Record<string, unknown>,
                deleted: t.deleted,
              })),
              relationships: relationshipsToClone.map((r) => ({
                id: r.id,
                verb: r.verb,
                from: r.from,
                to: r.to,
                data: r.data as Record<string, unknown> | null,
              })),
            }

            // Call transform (may be async)
            const transformedState = await Promise.resolve(transform(stateForTransform))

            // Use transformed data
            finalThingsToClone = transformedState.things.map((t) => ({
              id: t.id,
              type: t.type as number,
              branch: t.branch,
              name: t.name,
              data: t.data as unknown,
              deleted: t.deleted,
            }))

            finalRelationshipsToClone = (transformedState.relationships || []).map((r) => ({
              id: r.id,
              verb: r.verb,
              from: r.from,
              to: r.to,
              data: r.data as unknown,
              createdAt: new Date(),
            }))
          } catch (transformError) {
            throw new Error(`Transform error: ${(transformError as Error).message}`)
          }
        }

        // Step 1: Initialize target
        const initPromise = stub.fetch(
          new Request(`${targetUrl.origin}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              correlationId,
              mode: 'atomic',
            }),
          })
        )

        const initResponse = await Promise.race([
          initPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Clone timeout after ${timeout}ms`)), timeout)
          ),
        ])

        // Check init response
        if (!initResponse.ok) {
          throw new Error(`Init failed: ${initResponse.status} ${initResponse.statusText}`)
        }

        // Step 2: Transfer data to target
        const transferPromise = stub.fetch(
          new Request(`${targetUrl.origin}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              things: finalThingsToClone,
              relationships: finalRelationshipsToClone,
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

        // Check transfer response
        if (!response.ok) {
          throw new Error(`Transfer failed: ${response.status} ${response.statusText}`)
        }

        const duration = Date.now() - startTime

        // Emit clone.completed event
        await this.emitEvent('clone.completed', {
          target,
          doId: doId.toString(),
          correlationId,
          thingsCount: finalThingsToClone.length,
          duration,
        })

        return {
          success: true,
          ns: target,
          doId: doId.toString(),
          mode: 'atomic' as const,
          thingsCloned: finalThingsToClone.length,
          relationshipsCloned: finalRelationshipsToClone.length,
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
    // Use type assertion for locationHint which is a valid Cloudflare option not in types
    const newDoId = this.env.DO.newUniqueId({ locationHint: colo } as DurableObjectNamespaceNewUniqueIdOptions)
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

  /**
   * Move DO to a new location with enhanced location support
   *
   * Accepts ColoCode (IATA), ColoCity (city name), or Region.
   * Returns MoveResult with normalized location info.
   *
   * @param options - Move options with 'to' destination
   * @returns Promise<MoveResult> - New DO ID and location info
   */
  async move(options: { to: ColoCode | ColoCity | Region }): Promise<MoveResult> {
    const { to } = options

    // Validate input
    if (!to || (typeof to === 'string' && to.trim() === '')) {
      throw new Error('Invalid location: target is required and cannot be empty')
    }

    // Normalize the location input (handles ColoCode, ColoCity, and Region)
    let normalized: { code: ColoCode | undefined; region: Region; cfHint: string }
    try {
      // Handle case normalization for colo codes
      const normalizedInput = typeof to === 'string' ? to.toLowerCase() : to

      // Check if it's a valid colo code (lowercase)
      if (coloRegion[normalizedInput as ColoCode]) {
        normalized = normalizeLocation(normalizedInput as ColoCode)
      }
      // Check if it's a city name (PascalCase)
      else if (cityToCode[to as ColoCity]) {
        normalized = normalizeLocation(to as ColoCity)
      }
      // Try as region (kebab-case)
      else {
        normalized = normalizeLocation(to as Region)
      }
    } catch {
      throw new Error(`Invalid location: ${to}`)
    }

    // Check if DO namespace is configured
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }

    // Check if already at target location
    if (this.currentColo) {
      const currentNormalized = this.currentColo.toLowerCase()
      if (normalized.code === currentNormalized || normalized.region === currentNormalized) {
        throw new Error(`Already at colo: ${to}`)
      }
    }

    // Get things to move (all versions, including deleted for full history)
    const things = await this.db.select().from(schema.things)
    const actions = await this.db.select().from(schema.actions)
    const events = await this.db.select().from(schema.events)
    const branches = await this.db.select().from(schema.branches)

    if (things.length === 0) {
      throw new Error('No state to move - nothing to move')
    }

    // Emit move.started event to the pipeline
    if (this.env.PIPELINE) {
      await (this.env.PIPELINE as { send(data: unknown): Promise<void> }).send({
        verb: 'move.started',
        source: this.ns,
        data: {
          targetLocation: normalized.code ?? normalized.region,
          targetRegion: normalized.region,
        },
        createdAt: new Date().toISOString(),
      })
    }

    // Create new DO with locationHint (using CF hint for optimal placement)
    const newDoId = this.env.DO.newUniqueId({ locationHint: normalized.cfHint } as DurableObjectNamespaceNewUniqueIdOptions)
    const stub = this.env.DO.get(newDoId)

    // Transfer state to new DO (including all data for full preservation)
    await stub.fetch(new Request(`https://${this.ns}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        things,
        actions,
        events,
        branches,
      }),
    }))

    // Update objects table with new location
    await this.db.insert(schema.objects).values({
      ns: this.ns,
      id: newDoId.toString(),
      class: 'DO',
      region: normalized.code ?? normalized.region,
      primary: true,
      createdAt: new Date(),
    })

    // Update current colo tracking
    this.currentColo = normalized.code ?? normalized.region

    // Emit move.completed event to the pipeline
    if (this.env.PIPELINE) {
      await (this.env.PIPELINE as { send(data: unknown): Promise<void> }).send({
        verb: 'move.completed',
        source: this.ns,
        data: {
          newDoId: newDoId.toString(),
          location: {
            code: normalized.code,
            region: normalized.region,
          },
        },
        createdAt: new Date().toISOString(),
      })
    }

    return {
      newDoId: newDoId.toString(),
      location: {
        code: normalized.code ?? (normalized.region as string),
        region: normalized.region,
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMOTE & DEMOTE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Promote a Thing to its own Durable Object
   *
   * Takes a Thing stored in this DO's things table and elevates it to its own
   * independent DO with its own lifecycle, storage, and identity.
   *
   * @param thingId - ID of the Thing to promote
   * @param options - Promotion options
   * @returns PromoteResult with new DO's namespace, ID, and previous Thing ID
   */
  // Track in-progress promotions for concurrent access detection
  private _promotingThings: Set<string> = new Set()

  async promote(
    thingId: string,
    options: {
      /** Custom ID for the new DO (default: auto-generated from Thing ID) */
      newId?: string
      /** Keep Thing's action/event history in new DO (default: true) */
      preserveHistory?: boolean
      /** Maintain reference to original parent DO (default: true) */
      linkParent?: boolean
      /** What kind of DO to create (default: inferred from Thing.$type) */
      type?: string
      /** Target colo for the new DO (e.g., 'ewr', 'lax') */
      colo?: string
      /** Target region for the new DO (e.g., 'enam', 'wnam', 'weur', 'apac') */
      region?: string
    } = {}
  ): Promise<{ ns: string; doId: string; previousId: string; parentLinked?: boolean }> {
    const {
      newId,
      preserveHistory = true,
      linkParent = true,
      type,
      colo,
      region,
    } = options

    // Validate thingId is provided and not empty
    if (thingId === undefined || thingId === null || typeof thingId !== 'string') {
      throw new Error('thingId is required')
    }

    // Empty string is a special case - it represents the root DO
    if (thingId === '') {
      throw new Error('Cannot promote root: empty thingId cannot be promoted as it represents the DO root')
    }

    // Validate thingId format - reject path traversal and control characters
    // Match: ../anything, ..\anything, anything/../, anything\..\, or control chars
    if (/\.\.[\\/]|[\\/]\.\./.test(thingId) || /[\x00-\x1f]/.test(thingId)) {
      throw new Error(`Invalid thingId format: '${thingId}' contains invalid characters`)
    }

    // Check for concurrent promotion - must be synchronous to catch parallel calls
    if (this._promotingThings.has(thingId)) {
      throw new Error(`Thing '${thingId}' is already being promoted (concurrent promotion detected)`)
    }
    // Mark as promoting immediately (before any async operations)
    this._promotingThings.add(thingId)

    // Validate type if provided - must be a valid PascalCase noun name
    // Allow any PascalCase name (e.g., 'Customer', 'User', 'MyCustomDO') but reject:
    // - Invalid formats (not PascalCase)
    // - Reserved/test prefixes like 'Invalid', 'Test', 'Mock'
    // - Types that are too long (max 64 chars)
    if (type) {
      if (!isValidNounName(type)) {
        this._promotingThings.delete(thingId)
        throw new Error(`Invalid type: '${type}' is not a valid DO type`)
      }
      // Reject reserved prefixes that indicate test/mock types
      if (/^(Invalid|Mock|Fake|Stub|Test)/.test(type)) {
        this._promotingThings.delete(thingId)
        throw new Error(`Invalid type: '${type}' uses a reserved prefix`)
      }
      // Reject excessively long type names
      if (type.length > 64) {
        this._promotingThings.delete(thingId)
        throw new Error(`Invalid type: '${type}' exceeds maximum length of 64 characters`)
      }
    }

    // Check if DO namespace is configured
    if (!this.env.DO) {
      this._promotingThings.delete(thingId)
      throw new Error('DO binding unavailable: DO namespace not configured')
    }

    // Find the thing to promote
    let things: Array<{ id: string; deleted: boolean | null; data: unknown; type: number | null; branch: string | null; name: string | null; visibility: string | null }>
    try {
      things = await this.db.select().from(schema.things)
    } catch (error) {
      this._promotingThings.delete(thingId)
      throw error
    }
    const thing = things.find(t => t.id === thingId && !t.deleted)

    if (!thing) {
      this._promotingThings.delete(thingId)
      throw new Error(`Thing not found: ${thingId}`)
    }

    // Check if thing was already promoted
    const thingData = (thing.data as Record<string, unknown> | null | undefined) ?? null
    if (thingData?._promoted === true || thingData?.$promotedTo) {
      this._promotingThings.delete(thingId)
      throw new Error(`Thing '${thingId}' was already promoted`)
    }

    // Use blockConcurrencyWhile for atomicity
    return this.ctx.blockConcurrencyWhile(async () => {
      // Emit promote.started event
      await this.emitEvent('promote.started', {
        thingId,
        thingName: thing.name,
        preserveHistory,
        linkParent,
      })

      try {
        // Validate DO namespace is configured
        if (!this.env.DO) {
          throw new Error('DO namespace not configured')
        }

        // Create new DO
        let newDoId: DurableObjectId
        if (colo) {
          newDoId = this.env.DO.newUniqueId({ locationHint: colo } as DurableObjectNamespaceNewUniqueIdOptions)
        } else {
          newDoId = this.env.DO.newUniqueId()
        }

        const doIdString = newId || newDoId.toString()
        const newNs = `https://${doIdString}.do`
        const stub = this.env.DO.get(newDoId)

        // Collect history if needed
        let actionsToTransfer: unknown[] = []
        let eventsToTransfer: unknown[] = []

        if (preserveHistory) {
          const allActions = await this.db.select().from(schema.actions)
          const allEvents = await this.db.select().from(schema.events)

          // Filter actions and events related to this thing
          actionsToTransfer = allActions.filter(a =>
            a.target === `Thing/${thingId}` || a.target?.includes(thingId)
          )
          eventsToTransfer = allEvents.filter(e =>
            e.source?.includes(thingId)
          )
        }

        // Step 1: Initialize the new DO (validates it's ready to receive data)
        await stub.fetch(new Request(`${newNs}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promotedFrom: this.ns,
            thingId,
          }),
        }))

        // Step 2: Transfer state to new DO
        const transferPayload = {
          things: [{
            ...thing,
            id: 'root', // The thing becomes the root of the new DO
          }],
          actions: actionsToTransfer,
          events: eventsToTransfer,
          parentNs: linkParent ? this.ns : null,
          promotedFrom: {
            ns: this.ns,
            thingId,
            thingName: thing.name,
          },
        }

        await stub.fetch(new Request(`${newNs}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transferPayload),
        }))

        // Step 3: Finalize the promotion on the new DO (confirms data was received)
        await stub.fetch(new Request(`${newNs}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promotedFrom: this.ns,
            thingId,
            linkParent,
          }),
        }))

        // Update relationships if any point to this thing
        const relationships = await this.db.select().from(schema.relationships)
        const thingRelationships = relationships.filter(r =>
          r.from?.includes(thingId) || r.to?.includes(thingId)
        )

        // Create relationship record for parent link
        if (linkParent) {
          await this.db.insert(schema.relationships).values({
            id: `rel-promote-${Date.now()}`,
            verb: 'promotedFrom',
            from: newNs,
            to: `${this.ns}/Thing/${thingId}`,
            data: { promotedAt: new Date().toISOString() },
            createdAt: new Date(),
          })
        }

        // Record in objects table
        await this.db.insert(schema.objects).values({
          ns: newNs,
          id: doIdString,
          class: type || 'DO',
          region: colo || null,
          primary: true,
          createdAt: new Date(),
        })

        // Soft-delete the original thing by updating in place
        await this.db.update(schema.things)
          .set({
            data: {
              ...(thing.data as Record<string, unknown> || {}),
              $promotedTo: newNs,
              $promotedAt: new Date().toISOString(),
            },
            deleted: true,
          })
          .where(eq(schema.things.id, thingId))

        // Remove migrated actions from parent DO
        if (preserveHistory && actionsToTransfer.length > 0) {
          for (const action of actionsToTransfer as Array<{ id: string }>) {
            await this.db.delete(schema.actions).where(eq(schema.actions.id, action.id))
          }
        }

        // Remove migrated events from parent DO
        if (preserveHistory && eventsToTransfer.length > 0) {
          for (const event of eventsToTransfer as Array<{ id: string }>) {
            await this.db.delete(schema.events).where(eq(schema.events.id, event.id))
          }
        }

        // Clear the promotion tracking
        this._promotingThings.delete(thingId)

        // Emit promote.completed event
        await this.emitEvent('promote.completed', {
          thingId,
          newNs,
          doId: doIdString,
          actionsMigrated: actionsToTransfer.length,
          eventsMigrated: eventsToTransfer.length,
          parentLinked: linkParent,
          relationshipsUpdated: thingRelationships.length,
        })

        return {
          ns: newNs,
          doId: doIdString,
          previousId: thingId,
          parentLinked: linkParent,
        }
      } catch (error) {
        // Clear the promotion tracking
        this._promotingThings.delete(thingId)

        // Emit promote.failed event
        const errorMessage = (error as Error).message || String(error)
        await this.emitEvent('promote.failed', {
          thingId,
          error: errorMessage,
        })

        // Emit rollback event
        await this.emitEvent('promote.rollback', {
          thingId,
          reason: errorMessage,
        })

        throw error
      }
    })
  }

  /**
   * Demote this DO back into a parent DO as a Thing
   *
   * This is the inverse of promote(). When a DO no longer needs its own
   * lifecycle, it can be demoted back into a parent DO as a Thing. The DO's
   * state is folded into the parent, and the original DO is deleted.
   *
   * @param options - Demotion options (to is required)
   * @returns DemoteResult with new Thing ID, parent namespace, and deleted DO namespace
   */
  async demote(options: {
    /** Parent DO namespace to demote into (required) */
    to: string
    /** Squash history before demoting (default: false) */
    compress?: boolean
    /** Demotion mode (default: 'atomic') */
    mode?: 'atomic' | 'staged'
    /** Keep original DO ID as Thing ID (default: false) */
    preserveId?: boolean
    /** Custom type for the demoted Thing (default: inferred from DO) */
    type?: string
  }): Promise<{ thingId: string; parentNs: string; deletedNs: string; stagedToken?: string }> {
    // Validate options
    if (!options || typeof options !== 'object') {
      throw new Error('options is required')
    }

    const {
      to: parentNs,
      compress = false,
      mode = 'atomic',
      preserveId = false,
      type,
    } = options

    // Validate 'to' is provided
    if (parentNs === undefined || parentNs === null || typeof parentNs !== 'string') {
      throw new Error('"to" option is required for demote')
    }

    if (parentNs === '' || parentNs.trim() === '') {
      throw new Error('Invalid namespace: "to" cannot be empty')
    }

    // Validate URL format
    try {
      new URL(parentNs)
    } catch {
      throw new Error(`Invalid target URL: ${parentNs}`)
    }

    // Cannot demote to self
    if (parentNs === this.ns) {
      throw new Error('Cannot demote to self')
    }

    // Check if DO binding is available
    if (!this.env.DO) {
      throw new Error('DO binding is unavailable')
    }

    // Validate type if provided
    if (type) {
      // Only allow valid type names (PascalCase, no weird characters, reasonable length)
      // Max length of 25 prevents unreasonably long type names
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(type) || type.length > 25) {
        throw new Error(`Invalid type: "${type}"`)
      }
    }

    // Check for circular relationship (cannot demote into a child of this DO)
    const relationships = await this.db.select().from(schema.relationships)
    const isChildOf = relationships.some(r =>
      r.verb === 'parent-child' && r.from === this.ns && r.to === parentNs
    )
    if (isChildOf) {
      throw new Error(`Cannot demote into child - circular relationship detected with ${parentNs}`)
    }

    // Handle staged mode
    if (mode === 'staged') {
      return this.prepareStagedDemote(parentNs, options)
    }

    // Atomic mode - use blockConcurrencyWhile
    return this.ctx.blockConcurrencyWhile(async () => {
      // Emit demote.started event
      await this.emitEvent('demote.started', {
        targetNs: parentNs,
        sourceNs: this.ns,
        parentNs,
        compress,
        mode,
        preserveId,
      })

      try {
        // Get all state from this DO
        const things = await this.db.select().from(schema.things)
        const actions = await this.db.select().from(schema.actions)
        const events = await this.db.select().from(schema.events)
        const allRelationships = await this.db.select().from(schema.relationships)

        // Filter non-deleted things
        const activeThings = things.filter(t => !t.deleted)

        // Generate new thing ID
        const newThingId = preserveId
          ? this.ns.replace(/^https?:\/\//, '').replace(/\.do$/, '')
          : `demoted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

        // Compress history if requested
        let actionsToTransfer = actions
        let eventsToTransfer = events

        if (compress) {
          // Only keep the most recent version of each thing
          actionsToTransfer = []
          eventsToTransfer = events.filter(e =>
            e.verb === 'demote.started' || e.verb === 'demote.completed'
          )
        }

        // Prepare transfer payload - allow empty state (creates empty Thing in parent)
        const transferPayload = {
          things: activeThings.length > 0 ? activeThings.map(t => ({
            ...t,
            id: t.id === 'root' ? newThingId : `${newThingId}/${t.id}`,
          })) : [{
            // Create an empty Thing placeholder
            id: newThingId,
            type: 0,
            branch: null,
            name: `Demoted from ${this.ns}`,
            data: { $demotedFrom: this.ns },
            deleted: false,
          }],
          actions: actionsToTransfer.map(a => ({
            ...a,
            target: a.target?.replace(/^Thing\//, `Thing/${newThingId}/`),
          })),
          events: eventsToTransfer.map(e => ({
            ...e,
            source: e.source?.replace(this.ns, parentNs),
          })),
          relationships: allRelationships.map(r => ({
            ...r,
            from: r.from?.replace(this.ns, `${parentNs}/Thing/${newThingId}`),
            to: r.to?.replace(this.ns, `${parentNs}/Thing/${newThingId}`),
          })),
          demotedFrom: {
            ns: this.ns,
            thingsCount: activeThings.length,
            compress,
          },
        }

        // Resolve parent DO and transfer state
        // Validate DO namespace is configured
        if (!this.env.DO) {
          throw new Error('DO namespace not configured')
        }

        // Try to get parent DO stub
        const parentId = this.env.DO.idFromName(parentNs)
        const parentStub = this.env.DO.get(parentId)

        try {
          // Phase 1: Transfer state to parent
          const response = await parentStub.fetch(new Request(`${parentNs}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transferPayload),
          }))

          if (!response.ok) {
            throw new Error(`Transfer to ${parentNs} failed: ${response.status} ${response.statusText}`)
          }

          // Phase 2: Confirm transfer complete (two-phase commit style)
          const confirmResponse = await parentStub.fetch(new Request(`${parentNs}/confirm-transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thingId: newThingId, sourceNs: this.ns }),
          }))

          if (!confirmResponse.ok) {
            throw new Error(`Transfer confirmation to ${parentNs} failed: ${confirmResponse.status} ${confirmResponse.statusText}`)
          }

          // Phase 3: Finalize - notify parent that source DO is about to be deleted
          const finalizeResponse = await parentStub.fetch(new Request(`${parentNs}/finalize-demote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              thingId: newThingId,
              sourceNs: this.ns,
              thingsCount: activeThings.length,
            }),
          }))

          if (!finalizeResponse.ok) {
            throw new Error(`Demote finalization to ${parentNs} failed: ${finalizeResponse.status} ${finalizeResponse.statusText}`)
          }
        } catch (fetchError) {
          const errorMessage = (fetchError as Error).message || String(fetchError)
          // Re-throw with namespace included in error message
          if (errorMessage.includes('not found') || errorMessage.includes('unavailable')) {
            throw new Error(`Parent DO not found: ${parentNs} - ${errorMessage}`)
          }
          if (errorMessage.includes('Access denied') || errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
            throw new Error(`Access denied to parent DO: ${parentNs} - ${errorMessage}`)
          }
          throw new Error(`Transfer to ${parentNs} failed: ${errorMessage}`)
        }

        // Mark this DO for deletion
        const deletedNs = this.ns

        // Clear local state (the DO will be garbage collected)
        await this.ctx.storage.sql.exec('DELETE FROM things')
        await this.ctx.storage.sql.exec('DELETE FROM actions')
        await this.ctx.storage.sql.exec('DELETE FROM events')
        await this.ctx.storage.sql.exec('DELETE FROM relationships')

        // Emit demote.completed event
        await this.emitEvent('demote.completed', {
          thingId: newThingId,
          parentNs,
          deletedNs,
          thingsFolded: activeThings.length,
          actionsMigrated: actionsToTransfer.length,
          eventsMigrated: eventsToTransfer.length,
          compress,
        })

        return {
          thingId: newThingId,
          parentNs,
          deletedNs,
        }
      } catch (error) {
        // Emit demote.failed event
        const errorMessage = (error as Error).message || String(error)
        await this.emitEvent('demote.failed', {
          parentNs,
          error: errorMessage,
        })

        // Emit rollback event
        await this.emitEvent('demote.rollback', {
          parentNs,
          reason: errorMessage,
        })

        throw error
      }
    })
  }

  /**
   * Prepare a staged demote operation (Phase 1 of two-phase commit)
   */
  private async prepareStagedDemote(
    parentNs: string,
    options: {
      to: string
      compress?: boolean
      mode?: 'atomic' | 'staged'
      preserveId?: boolean
      type?: string
    }
  ): Promise<{ thingId: string; parentNs: string; deletedNs: string; stagedToken: string }> {
    const { compress = false, preserveId = false } = options

    // Generate staging token
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    // Get state to transfer
    const things = await this.db.select().from(schema.things)
    const activeThings = things.filter(t => !t.deleted)

    if (activeThings.length === 0) {
      throw new Error('No state to demote: source is empty')
    }

    // Generate thing ID
    const newThingId = preserveId
      ? this.ns.replace(/^https?:\/\//, '').replace(/\.do$/, '')
      : `demoted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

    // Store staging data
    const stagingData = {
      token,
      parentNs,
      newThingId,
      things: activeThings,
      compress,
      expiresAt: expiresAt.toISOString(),
      status: 'prepared' as const,
    }

    await this.ctx.storage.put(`demote-staging:${token}`, stagingData)

    // Emit staging event
    await this.emitEvent('demote.staging.started', { token, parentNs })
    await this.emitEvent('demote.prepared', { token, parentNs, expiresAt: expiresAt.toISOString() })

    return {
      thingId: newThingId,
      parentNs,
      deletedNs: this.ns,
      stagedToken: token,
    }
  }

  /**
   * Commit a staged demote operation
   */
  async commitDemote(token: string): Promise<{ thingId: string; parentNs: string; deletedNs: string }> {
    const staging = await this.ctx.storage.get<{
      token: string
      parentNs: string
      newThingId: string
      things: unknown[]
      compress: boolean
      expiresAt: string
      status: 'prepared' | 'committed' | 'aborted'
    }>(`demote-staging:${token}`)

    if (!staging) {
      throw new Error('Invalid or not found: staging token')
    }

    if (staging.status === 'committed') {
      throw new Error('Demote already committed')
    }

    if (staging.status === 'aborted') {
      throw new Error('Demote was aborted')
    }

    if (new Date(staging.expiresAt) < new Date()) {
      throw new Error('Token expired')
    }

    // Commit the demote
    staging.status = 'committed'
    await this.ctx.storage.put(`demote-staging:${token}`, staging)

    // Emit commit events
    await this.emitEvent('demote.commit.started', { token, parentNs: staging.parentNs })
    await this.emitEvent('demote.committed', { token, parentNs: staging.parentNs, thingId: staging.newThingId })

    return {
      thingId: staging.newThingId,
      parentNs: staging.parentNs,
      deletedNs: this.ns,
    }
  }

  /**
   * Abort a staged demote operation
   */
  async abortDemote(token: string, reason?: string): Promise<void> {
    const staging = await this.ctx.storage.get<{
      token: string
      parentNs: string
      status: 'prepared' | 'committed' | 'aborted'
    }>(`demote-staging:${token}`)

    if (!staging) {
      throw new Error('Invalid or not found: staging token')
    }

    if (staging.status === 'committed') {
      throw new Error('Cannot abort committed demote')
    }

    staging.status = 'aborted'
    await this.ctx.storage.put(`demote-staging:${token}`, staging)

    await this.emitEvent('demote.aborted', { token, parentNs: staging.parentNs, reason })
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
  // STAGED CLONE OPERATIONS (TWO-PHASE COMMIT)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Storage prefixes for staged clone data
   */
  protected static readonly STAGING_PREFIX = 'staging:'
  protected static readonly CHECKPOINT_PREFIX = 'checkpoint:'
  protected static readonly DEFAULT_TOKEN_TIMEOUT = 5 * 60 * 1000 // 5 minutes

  /**
   * Prepare a staged clone (Phase 1 of two-phase commit)
   *
   * This method validates the target, creates a staging area, and transfers
   * state to staging. Returns a token that can be used to commit or abort.
   */
  private async prepareStagedClone(
    target: string,
    options: {
      mode: 'staged'
      tokenTimeout?: number
      validateTarget?: boolean
      onPrepareProgress?: (progress: number) => void
      checkpointInterval?: number
      maxCheckpoints?: number
      validationMode?: 'strict' | 'lenient'
    }
  ): Promise<StagedPrepareResult> {
    const token = crypto.randomUUID()
    const timeout = options.tokenTimeout ?? DO.DEFAULT_TOKEN_TIMEOUT
    const expiresAt = new Date(Date.now() + timeout)
    const stagingNs = `${target}-staging-${token.slice(0, 8)}`

    // Report initial progress
    options.onPrepareProgress?.(0)

    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Check if target is occupied (if validation requested)
    if (options.validateTarget) {
      const existingObjects = await this.db.select().from(schema.objects)
      const occupied = existingObjects.some(obj => obj.ns === target && obj.primary)
      if (occupied) {
        throw new Error(`Target namespace is occupied: ${target}`)
      }
    }

    // Check for concurrent staging to same target
    const existingStagings = await this.ctx.storage.list({ prefix: DO.STAGING_PREFIX })
    for (const [, value] of existingStagings) {
      const staging = value as StagingData
      if (staging.targetNs === target && staging.status === 'prepared') {
        // Check if not expired
        if (new Date(staging.expiresAt) > new Date()) {
          throw new Error(`Target namespace is locked by pending clone operation`)
        }
      }
    }

    // Emit staging started event
    await this.emitEvent('clone.staging.started', { token, target })

    // Get things to clone
    const things = await this.db.select().from(schema.things)
    const branchThings = things.filter(t => !t.deleted && (t.branch === null || t.branch === this.currentBranch))

    // Check if there's anything to clone
    if (branchThings.length === 0) {
      throw new Error('No state to clone: source is empty')
    }

    // Get latest version of each thing
    const latestVersions = new Map<string, typeof things[0]>()
    for (const thing of branchThings) {
      const existing = latestVersions.get(thing.id)
      if (!existing) {
        latestVersions.set(thing.id, thing)
      }
    }

    const thingsToClone = Array.from(latestVersions.values())
    const totalItems = thingsToClone.length

    // Create checkpoints if interval is set
    const checkpoints: Checkpoint[] = []
    const checkpointInterval = options.checkpointInterval ?? 0
    const maxCheckpoints = options.maxCheckpoints ?? 100

    let itemsProcessed = 0
    const clonedThingIds: string[] = []
    const clonedRelationshipIds: string[] = []

    for (const thing of thingsToClone) {
      clonedThingIds.push(thing.id)
      itemsProcessed++

      // Create checkpoint at intervals
      if (checkpointInterval > 0 && itemsProcessed % checkpointInterval === 0) {
        const checkpoint = this.createStagedCheckpoint(
          token,
          checkpoints.length + 1,
          itemsProcessed,
          totalItems,
          clonedThingIds.slice(),
          clonedRelationshipIds.slice(),
          this.currentBranch,
          itemsProcessed,
          options.validationMode === 'strict'
        )
        checkpoints.push(checkpoint)

        // Enforce max checkpoints (keep most recent)
        while (checkpoints.length > maxCheckpoints) {
          checkpoints.shift()
        }
      }

      // Report progress
      const progress = Math.floor((itemsProcessed / totalItems) * 100)
      options.onPrepareProgress?.(progress)
    }

    // Final checkpoint if using checkpoints and last item wasn't already checkpointed
    // (avoid duplicate checkpoint when totalItems % checkpointInterval === 0)
    if (checkpointInterval > 0 && itemsProcessed > 0 && itemsProcessed % checkpointInterval !== 0) {
      const finalCheckpoint = this.createStagedCheckpoint(
        token,
        checkpoints.length + 1,
        itemsProcessed,
        totalItems,
        clonedThingIds.slice(),
        clonedRelationshipIds.slice(),
        this.currentBranch,
        itemsProcessed,
        options.validationMode === 'strict'
      )
      checkpoints.push(finalCheckpoint)

      // Enforce max checkpoints
      while (checkpoints.length > maxCheckpoints) {
        checkpoints.shift()
      }
    }

    // Calculate size (approximate)
    const sizeBytes = JSON.stringify(thingsToClone).length

    // Map things to staging format
    const mappedThings = thingsToClone.map(t => ({
      id: t.id,
      type: t.type,
      branch: t.branch,
      name: t.name,
      data: t.data,
      deleted: t.deleted ?? false,
    }))

    // Store staging data (compute hash on the mapped data that will be stored)
    const stagingData: StagingData = {
      sourceNs: this.ns,
      targetNs: target,
      stagingNs,
      things: mappedThings,
      expiresAt: expiresAt.toISOString(),
      status: 'prepared',
      createdAt: new Date().toISOString(),
      integrityHash: this.computeStagingIntegrityHash(mappedThings),
      metadata: {
        thingsCount: thingsToClone.length,
        sizeBytes,
        branch: this.currentBranch,
        version: thingsToClone.length,
      },
    }

    await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, stagingData)

    // Store checkpoints
    for (const checkpoint of checkpoints) {
      await this.ctx.storage.put(`${DO.CHECKPOINT_PREFIX}${token}:${checkpoint.id}`, checkpoint)
    }

    // Report completion
    options.onPrepareProgress?.(100)

    // Emit events
    await this.emitEvent('clone.staging.completed', { token, target, thingsCount: thingsToClone.length })
    await this.emitEvent('clone.prepared', { token, target, expiresAt })

    return {
      phase: 'prepared',
      token,
      expiresAt,
      stagingNs,
      metadata: {
        thingsCount: thingsToClone.length,
        sizeBytes,
        branch: this.currentBranch,
        version: thingsToClone.length,
      },
    }
  }

  /**
   * Create a checkpoint for staged clone
   */
  private createStagedCheckpoint(
    cloneId: string,
    sequence: number,
    itemsProcessed: number,
    totalItems: number,
    clonedThingIds: string[],
    clonedRelationshipIds: string[],
    branch: string,
    lastVersion: number,
    validated: boolean
  ): Checkpoint {
    const state: CheckpointState = {
      clonedThingIds,
      clonedRelationshipIds,
      branch,
      lastVersion,
    }

    const checksum = this.computeCheckpointChecksum(state)

    return {
      id: `cp-${cloneId.slice(0, 8)}-${sequence}`,
      cloneId,
      sequence,
      itemsProcessed,
      totalItems,
      createdAt: new Date(),
      checksum,
      state,
      validated,
    }
  }

  /**
   * Compute checksum for checkpoint validation
   */
  private computeCheckpointChecksum(state: CheckpointState): string {
    const content = JSON.stringify(state)
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Compute integrity hash for staging data
   */
  private computeStagingIntegrityHash(things: unknown[]): string {
    const content = JSON.stringify(things)
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Commit a staged clone (Phase 2 of two-phase commit)
   *
   * This method atomically moves the staged state to the target namespace,
   * cleans up the staging area, and emits completion events.
   */
  async commitClone(token: string): Promise<StagedCommitResult> {
    // Validate token format
    if (!token || token.trim() === '') {
      throw new Error('Invalid token: token is empty')
    }

    // Get staging data
    const staging = await this.ctx.storage.get(`${DO.STAGING_PREFIX}${token}`) as StagingData | undefined

    if (!staging) {
      await this.emitEvent('clone.commit.failed', { token, reason: 'Invalid or not found' })
      throw new Error('Invalid or not found: staging token')
    }

    // Check status
    if (staging.status === 'committed') {
      await this.emitEvent('clone.commit.failed', { token, reason: 'Already committed' })
      throw new Error('Clone already committed')
    }

    if (staging.status === 'aborted') {
      await this.emitEvent('clone.commit.failed', { token, reason: 'Already aborted' })
      throw new Error('Clone was aborted')
    }

    // Check expiration
    if (new Date(staging.expiresAt) < new Date()) {
      await this.emitEvent('clone.commit.failed', { token, reason: 'Token expired' })
      throw new Error('Token expired')
    }

    // Verify integrity (check for corruption)
    const currentHash = this.computeStagingIntegrityHash(staging.things)
    if (currentHash !== staging.integrityHash) {
      await this.emitEvent('clone.staging.corrupted', { token, target: staging.targetNs })
      await this.emitEvent('clone.commit.failed', { token, reason: 'Integrity check failed' })
      throw new Error('Staging data corrupted: integrity check failed')
    }

    // Validate checkpoints in strict mode (if any exist)
    const checkpointKeys = await this.ctx.storage.list({ prefix: `${DO.CHECKPOINT_PREFIX}${token}:` })
    for (const [, value] of checkpointKeys) {
      const checkpoint = value as Checkpoint
      const expectedChecksum = this.computeCheckpointChecksum(checkpoint.state)
      if (checkpoint.checksum !== expectedChecksum) {
        await this.emitEvent('clone.commit.failed', { token, reason: 'Checkpoint validation failed' })
        throw new Error('Checkpoint validation failed: checksum mismatch')
      }
    }

    // Emit commit started event
    await this.emitEvent('clone.commit.started', { token, target: staging.targetNs })

    // Create the target DO and transfer state
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }

    const doId = this.env.DO.idFromName(staging.targetNs)
    const stub = this.env.DO.get(doId)

    // Transfer state to new DO
    await stub.fetch(new Request(`https://${staging.targetNs}/init`, {
      method: 'POST',
      body: JSON.stringify({
        things: staging.things,
      }),
    }))

    const committedAt = new Date()

    // Store a tombstone entry marking the token as committed (for status queries)
    const tombstone: StagingData = {
      ...staging,
      things: [], // Clear the data
      status: 'committed',
    }
    await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, tombstone)

    // Clean up checkpoints
    for (const [key] of checkpointKeys) {
      await this.ctx.storage.delete(key)
    }

    // Emit committed event
    await this.emitEvent('clone.committed', {
      token,
      target: staging.targetNs,
      result: {
        ns: staging.targetNs,
        doId: doId.toString(),
        mode: 'staged',
      },
    })

    return {
      phase: 'committed',
      result: {
        ns: staging.targetNs,
        doId: doId.toString(),
        mode: 'staged',
        staged: {
          prepareId: token,
          committed: true,
        },
      },
      committedAt,
    }
  }

  /**
   * Abort a staged clone
   *
   * This method cleans up the staging area and releases any locks.
   * It is idempotent - multiple calls with the same token will succeed.
   */
  async abortClone(token: string, reason?: string): Promise<StagedAbortResult> {
    // Get staging data (may not exist if already aborted - idempotent)
    const staging = await this.ctx.storage.get(`${DO.STAGING_PREFIX}${token}`) as StagingData | undefined

    const abortedAt = new Date()

    if (staging) {
      // Store a tombstone entry marking the token as aborted (for status queries)
      const tombstone: StagingData = {
        ...staging,
        things: [], // Clear the data
        status: 'aborted',
      }
      await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, tombstone)

      // Clean up any checkpoints
      const checkpointKeys = await this.ctx.storage.list({ prefix: `${DO.CHECKPOINT_PREFIX}${token}:` })
      for (const [key] of checkpointKeys) {
        await this.ctx.storage.delete(key)
      }

      // Emit aborted event
      await this.emitEvent('clone.aborted', { token, target: staging.targetNs, reason })
    }

    return {
      phase: 'aborted',
      token,
      reason,
      abortedAt,
    }
  }

  /**
   * Get the status of a staging area by namespace
   * Note: Returns null for aborted/committed staging areas since they've been cleaned up
   */
  async getStagingStatus(stagingNs: string): Promise<StagingStatus | null> {
    // Search for staging data matching the stagingNs
    const allStagings = await this.ctx.storage.list({ prefix: DO.STAGING_PREFIX })

    for (const [key, value] of allStagings) {
      const staging = value as StagingData
      if (staging.stagingNs === stagingNs) {
        // Skip aborted/committed entries - the staging area is effectively gone
        if (staging.status === 'aborted' || staging.status === 'committed') {
          return null
        }
        const token = key.replace(DO.STAGING_PREFIX, '')
        return {
          exists: true,
          status: staging.status === 'prepared' ? 'ready' : staging.status,
          token,
          createdAt: new Date(staging.createdAt),
          expiresAt: new Date(staging.expiresAt),
          integrityHash: staging.integrityHash,
        }
      }
    }

    return null
  }

  /**
   * Get clone token status
   */
  async getCloneTokenStatus(token: string): Promise<{ valid: boolean; status: string; expiresAt?: Date }> {
    const staging = await this.ctx.storage.get(`${DO.STAGING_PREFIX}${token}`) as StagingData | undefined

    if (!staging) {
      // Check if it was committed or aborted (token history)
      return { valid: false, status: 'not_found' }
    }

    // Check expiration
    const expiresAt = new Date(staging.expiresAt)
    if (expiresAt < new Date()) {
      return { valid: false, status: 'expired', expiresAt }
    }

    return {
      valid: staging.status === 'prepared',
      status: staging.status,
      expiresAt,
    }
  }

  /**
   * Get checkpoints for a clone operation
   */
  async getCloneCheckpoints(token: string): Promise<Checkpoint[]> {
    const checkpointKeys = await this.ctx.storage.list({ prefix: `${DO.CHECKPOINT_PREFIX}${token}:` })
    const checkpoints: Checkpoint[] = []

    for (const [, value] of checkpointKeys) {
      checkpoints.push(value as Checkpoint)
    }

    // Sort by sequence
    checkpoints.sort((a, b) => a.sequence - b.sequence)
    return checkpoints
  }

  /**
   * Validate a specific checkpoint
   */
  async validateCheckpoint(checkpointId: string): Promise<{ valid: boolean; error?: string }> {
    // Find checkpoint across all tokens
    const allCheckpoints = await this.ctx.storage.list({ prefix: DO.CHECKPOINT_PREFIX })

    for (const [, value] of allCheckpoints) {
      const checkpoint = value as Checkpoint
      if (checkpoint.id === checkpointId) {
        const expectedChecksum = this.computeCheckpointChecksum(checkpoint.state)
        if (checkpoint.checksum === expectedChecksum) {
          return { valid: true }
        } else {
          return { valid: false, error: 'Checksum mismatch' }
        }
      }
    }

    return { valid: false, error: 'Checkpoint not found' }
  }

  /**
   * Resume a clone operation from a checkpoint
   */
  async resumeCloneFromCheckpoint(checkpointId: string): Promise<StagedPrepareResult> {
    // Find the checkpoint
    const allCheckpoints = await this.ctx.storage.list({ prefix: DO.CHECKPOINT_PREFIX })
    let foundCheckpoint: Checkpoint | null = null
    let originalToken: string | null = null

    for (const [key, value] of allCheckpoints) {
      const checkpoint = value as Checkpoint
      if (checkpoint.id === checkpointId) {
        foundCheckpoint = checkpoint
        // Extract token from key: checkpoint:token:id
        const parts = key.split(':')
        if (parts.length >= 2) {
          originalToken = parts[1]
        }
        break
      }
    }

    if (!foundCheckpoint || !originalToken) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    // Get original staging data
    const staging = await this.ctx.storage.get(`${DO.STAGING_PREFIX}${originalToken}`) as StagingData | undefined
    if (!staging) {
      throw new Error(`Original staging data not found for checkpoint`)
    }

    // Create new prepare result using checkpoint state
    const newToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + DO.DEFAULT_TOKEN_TIMEOUT)
    const stagingNs = `${staging.targetNs}-staging-${newToken.slice(0, 8)}`

    // Create new staging data from checkpoint
    const newStagingData: StagingData = {
      ...staging,
      stagingNs,
      expiresAt: expiresAt.toISOString(),
      status: 'prepared',
      createdAt: new Date().toISOString(),
    }

    await this.ctx.storage.put(`${DO.STAGING_PREFIX}${newToken}`, newStagingData)

    // Copy remaining checkpoints with updated token
    const originalCheckpoints = await this.getCloneCheckpoints(originalToken)
    for (const cp of originalCheckpoints) {
      const newCheckpoint = {
        ...cp,
        cloneId: newToken,
      }
      await this.ctx.storage.put(`${DO.CHECKPOINT_PREFIX}${newToken}:${cp.id}`, newCheckpoint)
    }

    return {
      phase: 'prepared',
      token: newToken,
      expiresAt,
      stagingNs,
      metadata: staging.metadata,
    }
  }

  /**
   * Corrupt a checkpoint (for testing)
   */
  async _corruptCheckpoint(token: string, checkpointId: string): Promise<void> {
    const checkpointKey = `${DO.CHECKPOINT_PREFIX}${token}:${checkpointId}`
    const checkpoint = await this.ctx.storage.get(checkpointKey) as Checkpoint | undefined

    if (checkpoint) {
      checkpoint.checksum = 'corrupted-checksum'
      await this.ctx.storage.put(checkpointKey, checkpoint)
    }
  }

  /**
   * Corrupt the staging area (for testing)
   */
  async _corruptStagingArea(token: string): Promise<void> {
    const staging = await this.ctx.storage.get(`${DO.STAGING_PREFIX}${token}`) as StagingData | undefined

    if (staging) {
      staging.integrityHash = 'corrupted-hash'
      await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, staging)
    }
  }

  /**
   * Garbage collect expired staging areas
   */
  async gcStagingAreas(): Promise<{ cleaned: number; checkpointsCleaned: number }> {
    let cleaned = 0
    let checkpointsCleaned = 0
    const now = new Date()

    // Find all expired staging areas
    const allStagings = await this.ctx.storage.list({ prefix: DO.STAGING_PREFIX })

    for (const [key, value] of allStagings) {
      const staging = value as StagingData
      const expiresAt = new Date(staging.expiresAt)

      if (expiresAt < now) {
        const token = key.replace(DO.STAGING_PREFIX, '')

        // Emit expired event
        await this.emitEvent('clone.expired', { token, target: staging.targetNs })

        // Clean up staging data
        await this.ctx.storage.delete(key)
        cleaned++

        // Clean up checkpoints
        const checkpointKeys = await this.ctx.storage.list({ prefix: `${DO.CHECKPOINT_PREFIX}${token}:` })
        for (const [cpKey] of checkpointKeys) {
          await this.ctx.storage.delete(cpKey)
          checkpointsCleaned++
        }
      }
    }

    return { cleaned, checkpointsCleaned }
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

    // Extract options with defaults (use unknown cast to access eventual-specific options)
    const eventualOptions = options as unknown as Record<string, unknown>
    const syncInterval = eventualOptions?.syncInterval as number ?? 5000
    const maxDivergence = eventualOptions?.maxDivergence as number ?? 100
    const conflictResolution = (eventualOptions?.conflictResolution as ConflictResolution) ?? 'last-write-wins'
    const chunked = eventualOptions?.chunked as boolean ?? false
    const chunkSize = eventualOptions?.chunkSize as number ?? 1000
    const rateLimit = eventualOptions?.rateLimit as number | null ?? null

    // Store custom resolver if provided
    const customResolver = eventualOptions?.conflictResolver as ((conflict: ConflictInfo) => Promise<unknown>) | undefined
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

    // Process resumable clones
    await this.processResumableClones()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESUMABLE CLONE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Internal state for resumable clone operations
   */
  private _resumableClones: Map<string, ResumableCloneState> = new Map()

  /**
   * Clone locks per target namespace
   */
  private _cloneLocks: Map<string, CloneLockState> = new Map()

  /**
   * Initiate a resumable clone operation
   */
  private async initiateResumableClone(
    target: string,
    options: ResumableCloneOptions
  ): Promise<ResumableCloneHandle> {
    const batchSize = options?.batchSize || 100
    const checkpointInterval = options?.checkpointInterval || 1
    const maxRetries = options?.maxRetries || 3
    const retryDelay = options?.retryDelay || 1000
    const lockTimeout = options?.lockTimeout || 300000 // 5 minutes
    const checkpointRetentionMs = options?.checkpointRetentionMs || 3600000 // 1 hour
    const compress = options?.compress || false
    const maxBandwidth = options?.maxBandwidth

    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Check for existing lock on target
    const existingLock = this._cloneLocks.get(target) || await this.ctx.storage.get<CloneLockState>(`clone-lock:${target}`)
    const now = Date.now()

    if (existingLock && !existingLock.isStale && new Date(existingLock.expiresAt).getTime() > now) {
      if (!options?.forceLock) {
        throw new Error(`Clone operation already in progress for target: ${target}`)
      }
      // Force override - release old lock
      await this.releaseCloneLock(target, existingLock.cloneId)
    }

    // Check if we're resuming from a checkpoint
    let state: ResumableCloneState
    let cloneId: string

    if (options?.resumeFrom) {
      // Find existing state from checkpoint
      const existingState = await this.findResumableStateFromCheckpoint(options.resumeFrom)
      if (!existingState) {
        throw new Error(`Checkpoint not found: ${options.resumeFrom}`)
      }
      state = existingState
      cloneId = state.id
      state.status = 'transferring'
      state.pauseRequested = false
    } else {
      // Create new clone state
      cloneId = crypto.randomUUID()
      state = {
        id: cloneId,
        targetNs: target,
        status: 'initializing',
        checkpoints: [],
        position: 0,
        batchSize,
        checkpointInterval,
        maxRetries,
        retryDelay,
        retryCount: 0,
        compress,
        maxBandwidth,
        checkpointRetentionMs,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(),
        bytesTransferred: 0,
        totalBytes: 0,
        startedAt: null,
      }
    }

    // Acquire lock
    const lockId = crypto.randomUUID()
    const lock: CloneLockState = {
      lockId,
      cloneId,
      target,
      acquiredAt: new Date(),
      expiresAt: new Date(now + lockTimeout),
      isStale: false,
    }
    this._cloneLocks.set(target, lock)
    await this.ctx.storage.put(`clone-lock:${target}`, lock)
    await this.emitEvent('clone.lock.acquired', { lockId, target, cloneId })

    // Store state
    this._resumableClones.set(cloneId, state)
    await this.ctx.storage.put(`resumable:${cloneId}`, state)

    // Run GC for orphaned checkpoints (fire and forget)
    this.cleanupOrphanedCheckpoints(checkpointRetentionMs).catch(() => {})

    // Schedule the clone to start
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (!currentAlarm || currentAlarm > Date.now() + 100) {
      await this.ctx.storage.setAlarm(Date.now() + 100)
    }

    // Return handle
    return this.createResumableCloneHandle(cloneId)
  }

  /**
   * Create a handle for managing a resumable clone operation
   */
  private createResumableCloneHandle(cloneId: string): ResumableCloneHandle {
    const self = this

    // Create reactive getters that always return current state
    const handle: ResumableCloneHandle = {
      id: cloneId,

      get status(): ResumableCloneStatus {
        const state = self._resumableClones.get(cloneId)
        return state?.status || 'failed'
      },

      get checkpoints(): ResumableCheckpoint[] {
        const state = self._resumableClones.get(cloneId)
        return state?.checkpoints || []
      },

      async getProgress(): Promise<number> {
        const state = await self.getResumableState(cloneId)
        if (!state) return 0
        return state.progress || 0
      },

      async pause(): Promise<void> {
        const state = await self.getResumableState(cloneId)
        if (!state) throw new Error('Clone not found')

        state.pauseRequested = true
        state.status = 'paused'
        await self.ctx.storage.put(`resumable:${cloneId}`, state)
        self._resumableClones.set(cloneId, state)

        const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1]
        await self.emitEvent('clone.paused', {
          id: cloneId,
          checkpoint: lastCheckpoint,
          progress: state.progress,
        })
      },

      async resume(): Promise<void> {
        const state = await self.getResumableState(cloneId)
        if (!state) throw new Error('Clone not found')

        state.pauseRequested = false
        state.status = 'transferring'
        await self.ctx.storage.put(`resumable:${cloneId}`, state)
        self._resumableClones.set(cloneId, state)

        const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1]
        await self.emitEvent('clone.resumed', {
          id: cloneId,
          fromCheckpoint: lastCheckpoint,
        })

        // Schedule continuation
        const currentAlarm = await self.ctx.storage.getAlarm()
        if (!currentAlarm || currentAlarm > Date.now() + 100) {
          await self.ctx.storage.setAlarm(Date.now() + 100)
        }
      },

      async cancel(): Promise<void> {
        const state = await self.getResumableState(cloneId)
        if (!state) throw new Error('Clone not found')

        const progress = state.progress || 0
        const checkpointsCreated = state.checkpoints.length

        state.cancelRequested = true
        state.status = 'cancelled'
        await self.ctx.storage.put(`resumable:${cloneId}`, state)
        self._resumableClones.set(cloneId, state)

        // Release lock
        await self.releaseCloneLock(state.targetNs, cloneId)

        // Clean up checkpoints
        await self.cleanupCloneCheckpoints(cloneId)

        await self.emitEvent('clone.cancelled', {
          id: cloneId,
          progress,
          checkpointsCreated,
        })
      },

      async waitForCheckpoint(): Promise<ResumableCheckpoint> {
        const pollInterval = 50
        const maxWait = 60000 // 60 seconds max
        const startTime = Date.now()

        return new Promise((resolve, reject) => {
          const poll = async () => {
            const state = await self.getResumableState(cloneId)
            if (!state) {
              reject(new Error('Clone not found'))
              return
            }

            if (state.checkpoints.length > 0) {
              resolve(state.checkpoints[state.checkpoints.length - 1])
              return
            }

            if (Date.now() - startTime > maxWait) {
              reject(new Error('Timeout waiting for checkpoint'))
              return
            }

            setTimeout(poll, pollInterval)
          }
          poll()
        })
      },

      async canResumeFrom(checkpointId: string): Promise<boolean> {
        // Check if checkpoint exists and is valid
        const checkpoint = await self.ctx.storage.get<ResumableCheckpoint>(`checkpoint:${checkpointId}`)
        if (!checkpoint) return false

        // Validate hash integrity
        const isValid = await self.validateCheckpointHash(checkpoint)
        return isValid
      },

      async getIntegrityHash(): Promise<string> {
        const state = await self.getResumableState(cloneId)
        if (!state || state.checkpoints.length === 0) return ''
        return state.checkpoints[state.checkpoints.length - 1].hash
      },

      async getLockInfo(): Promise<CloneLockInfo | null> {
        const state = await self.getResumableState(cloneId)
        if (!state) return null

        const lock = self._cloneLocks.get(state.targetNs) || await self.ctx.storage.get<CloneLockState>(`clone-lock:${state.targetNs}`)
        if (!lock || lock.cloneId !== cloneId) return null

        return {
          lockId: lock.lockId,
          cloneId: lock.cloneId,
          acquiredAt: new Date(lock.acquiredAt),
          expiresAt: new Date(lock.expiresAt),
          isStale: lock.isStale || new Date(lock.expiresAt).getTime() < Date.now(),
        }
      },

      async forceOverrideLock(): Promise<void> {
        const state = await self.getResumableState(cloneId)
        if (!state) throw new Error('Clone not found')

        await self.releaseCloneLock(state.targetNs, cloneId)
      },
    }

    return handle
  }

  /**
   * Process resumable clone operations in alarm handler
   */
  private async processResumableClones(): Promise<void> {
    // Load any resumable clones from storage that might not be in memory
    const storageKeys = await this.ctx.storage.list({ prefix: 'resumable:' })
    for (const [key, value] of storageKeys) {
      const cloneId = key.replace('resumable:', '')
      if (!this._resumableClones.has(cloneId)) {
        this._resumableClones.set(cloneId, value as ResumableCloneState)
      }
    }

    // Process all active resumable clones
    for (const [cloneId, state] of this._resumableClones) {
      if (state.status === 'paused' || state.pauseRequested) continue
      if (state.status === 'cancelled' || state.cancelRequested) continue
      if (state.status === 'completed' || state.status === 'failed') continue

      await this.processResumableCloneBatch(cloneId)
    }
  }

  /**
   * Process a single batch of a resumable clone
   */
  private async processResumableCloneBatch(cloneId: string): Promise<void> {
    const state = await this.getResumableState(cloneId)
    if (!state) return

    // Check for pause/cancel requests
    if (state.pauseRequested || state.status === 'paused') return
    if (state.cancelRequested || state.status === 'cancelled') return

    // Update status to transferring if needed
    if (state.status === 'initializing') {
      state.status = 'transferring'
      state.startedAt = new Date()
    }

    try {
      // Get all things from database
      const allThings = await this.db.select().from(schema.things)
      const nonDeletedThings = allThings.filter(t => !t.deleted)
      const totalItems = nonDeletedThings.length

      // Calculate total bytes (estimate based on JSON size)
      if (state.totalBytes === 0) {
        state.totalBytes = nonDeletedThings.reduce((acc, t) => {
          return acc + JSON.stringify(t).length
        }, 0)
      }

      // Get batch to process
      const batch = nonDeletedThings.slice(state.position, state.position + state.batchSize)

      if (batch.length === 0) {
        // Clone completed
        await this.completeResumableClone(cloneId, state)
        return
      }

      // Apply bandwidth throttling if configured
      if (state.maxBandwidth) {
        const batchBytes = batch.reduce((acc, t) => acc + JSON.stringify(t).length, 0)
        const expectedTime = (batchBytes / state.maxBandwidth) * 1000
        if (expectedTime > 0) {
          await this.sleep(Math.floor(expectedTime))
          // Emit throttle event if delay was significant
          if (expectedTime > 100) {
            await this.emitEvent('clone.throttled', {
              id: cloneId,
              delayMs: expectedTime,
              batchBytes,
            })
          }
        }
      }

      // Transfer batch (simulated - in real implementation would call target DO)
      await this.transferBatchToTarget(state.targetNs, batch, state.compress)

      // Update bytes transferred
      const batchBytes = batch.reduce((acc, t) => acc + JSON.stringify(t).length, 0)
      state.bytesTransferred += batchBytes

      // Update position
      state.position += batch.length

      // Calculate progress
      state.progress = Math.round((state.position / totalItems) * 100)

      // Emit batch completed event
      const batchNumber = Math.ceil(state.position / state.batchSize)
      await this.emitEvent('clone.batch.completed', {
        id: cloneId,
        batchNumber,
        itemsInBatch: batch.length,
        itemsProcessed: state.position,
        progress: state.progress,
      })

      // Create checkpoint if at interval
      const shouldCreateCheckpoint = batchNumber % state.checkpointInterval === 0

      if (shouldCreateCheckpoint) {
        const checkpoint = await this.createResumableCheckpoint(cloneId, state, batch, batchNumber)
        state.checkpoints.push(checkpoint)

        // Store checkpoint
        await this.ctx.storage.put(`checkpoint:${cloneId}:${checkpoint.id}`, checkpoint)
        await this.ctx.storage.put(`checkpoint:${checkpoint.id}`, checkpoint)

        await this.emitEvent('clone.checkpoint', {
          id: cloneId,
          checkpoint,
          checkpointId: checkpoint.id,
          position: checkpoint.position,
          hash: checkpoint.hash,
        })
      }

      // Reset retry count on success
      state.retryCount = 0

      // Save state
      await this.ctx.storage.put(`resumable:${cloneId}`, state)
      this._resumableClones.set(cloneId, state)

      // Schedule next batch if not done and not paused
      if (state.position < totalItems && !state.pauseRequested && !state.cancelRequested) {
        const currentAlarm = await this.ctx.storage.getAlarm()
        if (!currentAlarm || currentAlarm > Date.now() + 100) {
          await this.ctx.storage.setAlarm(Date.now() + 100)
        }
      } else if (state.position >= totalItems) {
        await this.completeResumableClone(cloneId, state)
      }
    } catch (error) {
      // Handle failure with retry
      await this.handleResumableCloneError(cloneId, state, error as Error)
    }
  }

  /**
   * Create a checkpoint for a resumable clone
   */
  private async createResumableCheckpoint(
    cloneId: string,
    state: ResumableCloneState,
    batch: unknown[],
    batchNumber: number
  ): Promise<ResumableCheckpoint> {
    // Calculate hash of batch data
    const batchJson = JSON.stringify(batch)
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(batchJson))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const checkpoint: ResumableCheckpoint = {
      id: crypto.randomUUID(),
      position: state.position,
      hash,
      timestamp: new Date(),
      itemsProcessed: state.position,
      batchNumber,
      cloneId,
      compressed: state.compress,
    }

    return checkpoint
  }

  /**
   * Complete a resumable clone operation
   */
  private async completeResumableClone(cloneId: string, state: ResumableCloneState): Promise<void> {
    const duration = state.startedAt
      ? Date.now() - new Date(state.startedAt).getTime()
      : 0

    state.status = 'completed'
    await this.ctx.storage.put(`resumable:${cloneId}`, state)
    this._resumableClones.set(cloneId, state)

    // Release lock
    await this.releaseCloneLock(state.targetNs, cloneId)

    // Clean up checkpoints
    await this.cleanupCloneCheckpoints(cloneId)

    await this.emitEvent('clone.completed', {
      id: cloneId,
      totalCheckpoints: state.checkpoints.length,
      totalItems: state.position,
      duration,
    })
  }

  /**
   * Handle error during resumable clone with retry logic
   */
  private async handleResumableCloneError(
    cloneId: string,
    state: ResumableCloneState,
    error: Error
  ): Promise<void> {
    state.retryCount++

    await this.emitEvent('clone.retry', {
      id: cloneId,
      attempt: state.retryCount,
      error: error.message,
    })

    if (state.retryCount >= state.maxRetries) {
      // Max retries exceeded - mark as failed
      state.status = 'failed'
      await this.ctx.storage.put(`resumable:${cloneId}`, state)
      this._resumableClones.set(cloneId, state)

      await this.emitEvent('clone.failed', {
        id: cloneId,
        error: error.message,
        retryCount: state.retryCount,
      })

      // Release lock
      await this.releaseCloneLock(state.targetNs, cloneId)
      return
    }

    // Calculate exponential backoff with jitter
    const baseDelay = state.retryDelay * Math.pow(2, state.retryCount - 1)
    const jitter = Math.random() * baseDelay * 0.25
    const delay = Math.floor(baseDelay + jitter)

    // Save state
    await this.ctx.storage.put(`resumable:${cloneId}`, state)
    this._resumableClones.set(cloneId, state)

    // Schedule retry
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (!currentAlarm || currentAlarm > Date.now() + delay) {
      await this.ctx.storage.setAlarm(Date.now() + delay)
    }
  }

  /**
   * Transfer a batch of things to target DO
   */
  private async transferBatchToTarget(
    targetNs: string,
    batch: unknown[],
    compress?: boolean
  ): Promise<void> {
    // In real implementation, this would call the target DO
    // For now, just validate the target is accessible
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }

    // Simulate transfer (in production this would be actual fetch to target)
    // The batch is ready to be sent
    await Promise.resolve()
  }

  /**
   * Get resumable clone state from memory or storage
   */
  private async getResumableState(cloneId: string): Promise<ResumableCloneState | null> {
    // Check memory first
    let state = this._resumableClones.get(cloneId)
    if (state) return state

    // Load from storage
    state = await this.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
    if (state) {
      this._resumableClones.set(cloneId, state)
    }
    return state || null
  }

  /**
   * Find resumable state from a checkpoint ID
   */
  private async findResumableStateFromCheckpoint(checkpointId: string): Promise<ResumableCloneState | null> {
    const checkpoint = await this.ctx.storage.get<ResumableCheckpoint>(`checkpoint:${checkpointId}`)
    if (!checkpoint || !checkpoint.cloneId) return null

    return this.getResumableState(checkpoint.cloneId)
  }

  /**
   * Validate checkpoint hash integrity
   */
  private async validateCheckpointHash(checkpoint: ResumableCheckpoint): Promise<boolean> {
    // Basic validation - check if hash is well-formed SHA-256
    if (!checkpoint.hash || !/^[a-f0-9]{64}$/.test(checkpoint.hash)) {
      return false
    }
    // Position must be valid
    if (checkpoint.position < 0) {
      return false
    }
    return true
  }

  /**
   * Release clone lock for a target
   */
  private async releaseCloneLock(target: string, cloneId: string): Promise<void> {
    const lock = this._cloneLocks.get(target) || await this.ctx.storage.get<CloneLockState>(`clone-lock:${target}`)
    if (lock && lock.cloneId === cloneId) {
      this._cloneLocks.delete(target)
      await this.ctx.storage.delete(`clone-lock:${target}`)
      await this.emitEvent('clone.lock.released', { lockId: lock.lockId, target })
    }
  }

  /**
   * Clean up checkpoints for a specific clone
   */
  private async cleanupCloneCheckpoints(cloneId: string): Promise<void> {
    const state = await this.getResumableState(cloneId)
    if (!state) return

    // Delete all checkpoints for this clone
    for (const checkpoint of state.checkpoints) {
      await this.ctx.storage.delete(`checkpoint:${cloneId}:${checkpoint.id}`)
      await this.ctx.storage.delete(`checkpoint:${checkpoint.id}`)
    }
  }

  /**
   * Clean up orphaned checkpoints older than retention period
   */
  private async cleanupOrphanedCheckpoints(retentionMs: number): Promise<void> {
    const now = Date.now()
    const cutoff = now - retentionMs

    // List all checkpoint keys
    const checkpointKeys = await this.ctx.storage.list({ prefix: 'checkpoint:' })

    for (const [key, value] of checkpointKeys) {
      const checkpoint = value as ResumableCheckpoint
      if (!checkpoint.timestamp) continue

      const checkpointTime = new Date(checkpoint.timestamp).getTime()
      if (checkpointTime < cutoff) {
        // Check if the clone is still active/paused
        if (checkpoint.cloneId) {
          const state = await this.getResumableState(checkpoint.cloneId)
          // Don't delete checkpoints for paused clones
          if (state && state.status === 'paused') {
            continue
          }
        }

        // Delete orphaned checkpoint
        await this.ctx.storage.delete(key)
      }
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
          get: (_, verb: string): ((handler: EventHandler, options?: HandlerOptions) => void) => {
            return (handler: EventHandler, options?: HandlerOptions): void => {
              // Build the event key in format "Noun.verb"
              const eventKey = `${noun}.${verb}`

              // Get or create the handlers array for this event
              const registrations = self._eventHandlers.get(eventKey) ?? []

              // Generate handler name if not provided
              const handlerName = options?.name
                || (handler as Function).name
                || `handler_${++self._handlerCounter}`

              // Create the handler registration with metadata
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

              // Add the registration to the array
              registrations.push(registration)

              // Sort by priority (higher priority first), then by registration order
              registrations.sort((a, b) => {
                if (b.priority !== a.priority) {
                  return b.priority - a.priority
                }
                return a.registeredAt - b.registeredAt
              })

              // Store back in the registry
              self._eventHandlers.set(eventKey, registrations)
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
  protected canViewThing(thing: Thing | ThingEntity | null | undefined): boolean {
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
      const dataObj = thing.data as Record<string, unknown> | undefined
      const metaObj = dataObj?.meta as Record<string, unknown> | undefined
      const thingOrgId = (metaObj?.orgId as string | undefined) ?? (dataObj?.orgId as string | undefined)
      return !!actor.orgId && actor.orgId === thingOrgId
    }

    // User visibility requires matching ownerId
    const dataObj = thing.data as Record<string, unknown> | undefined
    const metaObj = dataObj?.meta as Record<string, unknown> | undefined
    const thingOwnerId = (metaObj?.ownerId as string | undefined) ?? (dataObj?.ownerId as string | undefined)
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
  protected filterVisibleThings<T extends Thing | ThingEntity>(things: T[]): T[] {
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
  protected async getVisibleThing(id: string): Promise<ThingEntity | null> {
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
  protected getVisibility(thing: Thing | ThingEntity | null | undefined): 'public' | 'unlisted' | 'org' | 'user' {
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

  /**
   * Check if the current actor is in the same org as a thing.
   *
   * @param thing - The thing to check org membership for
   * @returns true if the current actor is in the thing's org
   */
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
}

export default DO
