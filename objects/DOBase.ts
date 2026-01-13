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
import { SyncEngine } from './transport/sync-engine'
import {
  handleCapnWebRpc,
  isCapnWebRequest,
  type CapnWebOptions,
} from './transport/capnweb-target'
import {
  handleRestRequest,
  handleGetIndex,
  type RestRouterContext,
} from './transport/rest-router'
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
import { logBestEffortError } from '../lib/logging/error-logger'
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
import type { AuthContext } from './transport/auth-layer'
import type {
  DOSchema,
  DOClassSchema,
  MCPToolSchema,
  RESTEndpointSchema,
  StoreSchema,
  StorageCapabilities,
  IntrospectNounSchema,
  VerbSchema,
  VisibilityRole,
} from '../types/introspect'
import {
  STORE_VISIBILITY,
  canAccessVisibility,
  getHighestRole,
} from '../types/introspect'
import type { DOLocation } from '../types/Location'
import type { ColoCode, ColoCity, Region, CFLocationHint } from '../types/Location'
import { codeToCity, coloRegion, regionToCF } from '../types/Location'
import { LocationCache, LOCATION_STORAGE_KEY } from '../lib/colo/caching'
import { extractStorageClaims } from '../lib/auth/jwt-storage-claims'
import { AuthorizedR2Client, type R2Bucket } from '../lib/storage/authorized-r2'
import { IcebergStateAdapter } from './persistence/iceberg-state'

// Re-export Env type for consumers
export type { Env }

// ============================================================================
// ICEBERG OPTIONS INTERFACE
// ============================================================================

/**
 * Configuration options for Iceberg state persistence
 */
export interface IcebergOptions {
  /**
   * Enable automatic periodic checkpointing
   * @default false
   */
  autoCheckpoint?: boolean

  /**
   * Interval in milliseconds between automatic checkpoints
   * Only used when autoCheckpoint is enabled
   * @default 60000 (1 minute)
   */
  checkpointIntervalMs?: number

  /**
   * Minimum number of changes before a checkpoint will be created
   * Helps debounce saves to reduce R2 operations
   * @default 1
   */
  minChangesBeforeCheckpoint?: number
}

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
  update(id: string, data: Partial<T>): Promise<T & { $rowid: number }>
  delete(id: string): Promise<T & { $rowid: number }>
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
// DO FEATURE CONFIGURATION
// ============================================================================

/**
 * Configuration for DO features that can be eagerly initialized.
 *
 * By default, all features are available in the base DO class but are
 * lazily initialized (tables created on first access). Use `DO.with()`
 * to eagerly initialize specific features when the DO starts.
 *
 * @example
 * ```typescript
 * // Enable search and vectors eager initialization
 * class SearchableDO extends DO.with({ search: true, vectors: true }) { }
 * ```
 */
export interface DOFeatureConfig {
  /**
   * Things store - CRUD operations for domain entities.
   * Initializes the `things` and `nouns` tables.
   */
  things?: boolean

  /**
   * Relationships store - Graph relationships between Things.
   * Initializes the `relationships` table.
   */
  relationships?: boolean

  /**
   * Actions store - Action logging and lifecycle tracking.
   * Initializes the `actions` table.
   */
  actions?: boolean

  /**
   * Events store - Event emission and streaming.
   * Initializes the `events` table.
   */
  events?: boolean

  /**
   * Search store - Full-text and semantic search.
   * Initializes the `search` table with FTS capabilities.
   */
  search?: boolean

  /**
   * Vectors - Vector embeddings for semantic search.
   * Initializes embedding columns in the `search` table.
   * Note: Full vector index functionality is in VectorShardDO.
   */
  vectors?: boolean

  /**
   * Objects store - DO registry and cross-DO resolution.
   * Initializes the `objects` table.
   */
  objects?: boolean

  /**
   * Dead Letter Queue - Failed events for retry.
   * Initializes the `dlq` table.
   */
  dlq?: boolean
}

// ============================================================================
// OKR (OBJECTIVES AND KEY RESULTS) TYPES
// ============================================================================

/**
 * Key Result definition with target and current values
 */
export interface KeyResult {
  name: string
  target: number
  current: number
  unit?: string
}

/**
 * OKR (Objective and Key Results) definition
 */
export interface OKR {
  objective: string
  keyResults: KeyResult[]
  progress(): number
  isComplete(): boolean
}

/**
 * OKR Definition input for defineOKR()
 */
export interface OKRDefinition {
  objective: string
  keyResults: Array<{
    name: string
    target: number
    current?: number
    unit?: string
  }>
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
  // CAPABILITY MIXIN INFRASTRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Static array of capability names supported by this class.
   * Populated by capability mixins (e.g., withFS, withGit, withBash).
   * Empty by default in base DO class.
   */
  static capabilities: string[] = []

  /**
   * Configuration for features that should be eagerly initialized.
   * When features are specified here, their tables are created on DO start
   * rather than lazily on first access.
   */
  static _eagerFeatures: DOFeatureConfig = {}

  /**
   * Create a DO subclass with specified features eagerly initialized.
   *
   * By default, all DO features (search, vectors, relationships, events, etc.)
   * are available but initialized lazily - their tables are created on first access.
   * Use `DO.with()` to eagerly initialize specific features when the DO starts.
   *
   * @param features - Features to eagerly initialize on DO creation
   * @returns A class that extends DO with eager initialization for specified features
   *
   * @example
   * ```typescript
   * // Base DO - everything available, all lazy init
   * class MyDO extends DO { }
   *
   * // Eager init for specific features
   * class SearchableDO extends DO.with({ search: true, vectors: true }) { }
   *
   * // Configure multiple features
   * class FullFeaturedDO extends DO.with({
   *   search: true,
   *   vectors: true,
   *   relationships: true,
   *   events: true,
   *   actions: true,
   *   things: true,
   * }) { }
   * ```
   */
  static with<E extends Env = Env>(features: DOFeatureConfig): typeof DO<E> {
    // Capture features in closure for the returned class
    const eagerFeatures = { ...features }

    // Create a new class that extends DO with eager initialization
    class DOWithFeatures extends (this as unknown as typeof DO<E>) {
      // Store the feature config for introspection
      static override _eagerFeatures = eagerFeatures

      constructor(ctx: DurableObjectState, env: E) {
        super(ctx, env)

        // Use blockConcurrencyWhile to ensure eager initialization completes
        // before any requests are processed
        ctx.blockConcurrencyWhile(async () => {
          await this._initializeEagerFeatures(eagerFeatures)
        })
      }
    }

    return DOWithFeatures as typeof DO<E>
  }

  /**
   * Initialize features that are configured for eager initialization.
   * Called during DO construction when using DO.with().
   *
   * @param features - Feature configuration from DO.with()
   */
  protected async _initializeEagerFeatures(features: DOFeatureConfig): Promise<void> {
    // Access each feature's getter to trigger lazy initialization
    // This creates the tables and initializes the stores

    if (features.things) {
      // Access things store to initialize things and nouns tables
      void this.things
    }

    if (features.relationships) {
      // Access rels store to initialize relationships table
      void this.rels
    }

    if (features.actions) {
      // Access actions store to initialize actions table
      void this.actions
    }

    if (features.events) {
      // Access events store to initialize events table
      void this.events
    }

    if (features.search) {
      // Access search store to initialize search table
      void this.search
    }

    if (features.vectors) {
      // For vectors, we initialize the search store which handles embeddings
      // The full vector index functionality is in VectorShardDO
      void this.search
    }

    if (features.objects) {
      // Access objects store to initialize DO registry
      void this.objects
    }

    if (features.dlq) {
      // Access DLQ store to initialize dead letter queue
      void this.dlq
    }
  }

  /**
   * Check if this DO instance has a specific capability.
   * Capabilities are added via mixins and registered in the static capabilities array.
   *
   * @param name - Capability name to check (e.g., 'fs', 'git', 'bash')
   * @returns true if the capability is registered on this class
   *
   * @example
   * ```typescript
   * if (this.hasCapability('fs')) {
   *   await this.$.fs.read('/config.json')
   * }
   * ```
   */
  hasCapability(name: string): boolean {
    return (this.constructor as typeof DO).capabilities?.includes(name) ?? false
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OKR (OBJECTIVES AND KEY RESULTS) FRAMEWORK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * OKRs (Objectives and Key Results) for this DO instance.
   * Subclasses can extend this with custom metrics using defineOKR().
   *
   * @example
   * ```typescript
   * class MyApp extends DO {
   *   override okrs = {
   *     ...super.okrs,
   *     Revenue: this.defineOKR({
   *       objective: 'Achieve revenue targets',
   *       keyResults: [
   *         { name: 'MRR', target: 10000, current: 5000 },
   *         { name: 'ARR', target: 120000, current: 60000 },
   *       ],
   *     }),
   *   }
   * }
   * ```
   */
  okrs: Record<string, OKR> = {}

  /**
   * Define an OKR (Objective and Key Results) with progress tracking.
   *
   * @param definition - The OKR definition with objective and key results
   * @returns A typed OKR object with progress() and isComplete() methods
   *
   * @example
   * ```typescript
   * const revenueOKR = this.defineOKR({
   *   objective: 'Grow monthly revenue',
   *   keyResults: [
   *     { name: 'MRR', target: 10000, current: 2500 },
   *     { name: 'Customers', target: 100, current: 25, unit: 'count' },
   *   ],
   * })
   *
   * console.log(revenueOKR.progress()) // 25 (average of 25% and 25%)
   * console.log(revenueOKR.isComplete()) // false
   * ```
   */
  defineOKR(definition: OKRDefinition): OKR {
    // Create key results with defaults
    const keyResults: KeyResult[] = definition.keyResults.map((kr) => ({
      name: kr.name,
      target: kr.target,
      current: kr.current ?? 0,
      unit: kr.unit,
    }))

    return {
      objective: definition.objective,
      keyResults,

      /**
       * Calculate overall progress as average of key result progress.
       * Returns 100 if no key results or all targets are 0.
       */
      progress(): number {
        if (keyResults.length === 0) {
          return 100
        }

        let totalProgress = 0
        let validResults = 0

        for (const kr of keyResults) {
          if (kr.target === 0) {
            // Zero target is considered complete
            totalProgress += 100
          } else {
            totalProgress += Math.min((kr.current / kr.target) * 100, 100)
          }
          validResults++
        }

        if (validResults === 0) {
          return 100
        }

        return Math.round(totalProgress / validResults)
      },

      /**
       * Check if all key results have met or exceeded their targets.
       * Returns true if no key results.
       */
      isComplete(): boolean {
        if (keyResults.length === 0) {
          return true
        }

        for (const kr of keyResults) {
          if (kr.target !== 0 && kr.current < kr.target) {
            return false
          }
        }

        return true
      },
    }
  }

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
  // SYNC ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * SyncEngine instance for WebSocket sync protocol support.
   * Lazy-initialized on first access.
   */
  private _syncEngine?: SyncEngine

  /**
   * Get the SyncEngine instance.
   * Creates the engine on first access.
   */
  get syncEngine(): SyncEngine {
    if (!this._syncEngine) {
      this._syncEngine = new SyncEngine(this.things)
    }
    return this._syncEngine
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

  // Iceberg state persistence
  private _snapshotSequence: number = 0
  private _r2Client?: AuthorizedR2Client
  private _icebergAdapter?: IcebergStateAdapter

  // Auto-checkpoint and consistency guard state
  private _pendingChanges: number = 0
  private _lastCheckpointTimestamp: number = 0
  private _checkpointTimer?: ReturnType<typeof setInterval>
  private _icebergOptions: IcebergOptions = {}
  private _fencingToken?: string

  // Lifecycle event listeners (for stateLoaded, checkpointed, etc.)
  private _lifecycleListeners: Map<string, Array<(data: unknown) => void>> = new Map()

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
   *
   * Automatically wires onMutation callback to SyncEngine for real-time sync.
   * When things.create/update/delete succeeds, subscribers receive broadcasts.
   */
  get things(): ThingsStore {
    if (!this._things) {
      this._things = new ThingsStore(this.getStoreContext())

      // Wire ThingsStore mutations to SyncEngine broadcasts
      // Uses lazy reference to syncEngine to avoid circular initialization
      this._things.onMutation = (type, thing, rowid) => {
        // Transform ThingEntity to SyncThing for the wire protocol
        const now = new Date().toISOString()
        const syncThing = {
          $id: thing.$id,
          $type: thing.$type,
          name: thing.name ?? undefined,
          data: thing.data ?? undefined,
          branch: thing.branch ?? null,
          createdAt: now,
          updatedAt: now,
        }

        switch (type) {
          case 'insert':
            this.syncEngine.onThingCreated(syncThing, rowid)
            break
          case 'update':
            this.syncEngine.onThingUpdated(syncThing, rowid)
            break
          case 'delete':
            // For delete, use the thing's $type to determine collection
            this.syncEngine.onThingDeleted(thing.$type, thing.$id, thing.branch ?? null, rowid)
            break
        }
      }
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
  // LOCATION DETECTION & CACHING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Cached location instance (in-memory) */
  private _cachedLocation?: DOLocation

  /** Flag to track if location hook was already called */
  private _locationHookCalled: boolean = false

  /** Coordinates extracted from CF request headers */
  private _extractedCoordinates?: { lat: number; lng: number }

  /**
   * Get the DO's location (with caching).
   *
   * On first call, detects location via Cloudflare's trace endpoint,
   * caches it in storage, and calls the onLocationDetected hook.
   * Subsequent calls return the cached location immediately.
   *
   * @returns Promise resolving to the DO's location
   */
  async getLocation(): Promise<DOLocation> {
    // Return cached location if available
    if (this._cachedLocation) {
      return this._cachedLocation
    }

    // Check DO storage for persisted location
    // Note: Storage may have legacy format with latitude/longitude or new format with lat/lng
    const cached = await this.ctx.storage.get<{
      colo: string
      city: string
      region: string
      cfHint: string
      detectedAt: string | Date
      coordinates?: { lat?: number; lng?: number; latitude?: number; longitude?: number }
    }>(LOCATION_STORAGE_KEY)

    if (cached) {
      // Restore from storage, converting coordinates to canonical format if needed
      const coords = cached.coordinates
        ? {
            lat: cached.coordinates.lat ?? cached.coordinates.latitude ?? 0,
            lng: cached.coordinates.lng ?? cached.coordinates.longitude ?? 0,
          }
        : undefined
      this._cachedLocation = Object.freeze({
        colo: cached.colo as ColoCode,
        city: cached.city as ColoCity,
        region: cached.region as Region,
        cfHint: cached.cfHint as CFLocationHint,
        detectedAt: cached.detectedAt instanceof Date
          ? cached.detectedAt
          : new Date(cached.detectedAt),
        coordinates: coords,
      }) as DOLocation
      return this._cachedLocation
    }

    // Detect fresh location
    const location = await this._detectLocation()

    // Cache in memory (frozen for immutability)
    this._cachedLocation = Object.freeze(location) as DOLocation

    // Persist to storage
    await this.ctx.storage.put(LOCATION_STORAGE_KEY, {
      colo: location.colo,
      city: location.city,
      region: location.region,
      cfHint: location.cfHint,
      detectedAt: location.detectedAt.toISOString(),
      coordinates: location.coordinates,
    })

    // Call lifecycle hook (only once)
    if (!this._locationHookCalled) {
      this._locationHookCalled = true
      try {
        await this.onLocationDetected(this._cachedLocation)
      } catch (error) {
        // Log but don't propagate hook errors
        console.error('Error in onLocationDetected hook:', error)
      }
    }

    return this._cachedLocation
  }

  /**
   * Internal method to detect location from Cloudflare's trace endpoint.
   * Override in tests to provide mock location data.
   *
   * @returns Promise resolving to detected DOLocation
   */
  async _detectLocation(): Promise<DOLocation> {
    try {
      // Fetch from Cloudflare's trace endpoint
      const response = await fetch('https://cloudflare.com/cdn-cgi/trace')
      if (!response.ok) {
        throw new Error(`Trace endpoint returned ${response.status}`)
      }

      const text = await response.text()
      const lines = text.split('\n')
      const data: Record<string, string> = {}

      for (const line of lines) {
        const [key, value] = line.split('=')
        if (key && value) {
          data[key.trim()] = value.trim()
        }
      }

      const coloCode = (data.colo || 'lax').toLowerCase() as ColoCode
      const city = (codeToCity[coloCode as keyof typeof codeToCity] || 'LosAngeles') as ColoCity
      const region = (coloRegion[coloCode as keyof typeof coloRegion] || 'us-west') as Region
      const cfHint = (regionToCF[region as keyof typeof regionToCF] || 'wnam') as CFLocationHint

      const location: DOLocation = {
        colo: coloCode,
        city,
        region,
        cfHint,
        detectedAt: new Date(),
      }

      // Add coordinates if extracted from request
      if (this._extractedCoordinates) {
        location.coordinates = this._extractedCoordinates
      }

      return location
    } catch (error) {
      // Fallback to default location on error
      console.error('Failed to detect location:', error)
      const location: DOLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: new Date(),
      }
      if (this._extractedCoordinates) {
        location.coordinates = this._extractedCoordinates
      }
      return location
    }
  }

  /**
   * Lifecycle hook called when location is first detected.
   * Override in subclasses to perform custom actions.
   *
   * @param location - The detected DO location
   */
  protected async onLocationDetected(location: DOLocation): Promise<void> {
    // Default implementation does nothing
    // Subclasses can override to react to location detection
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

    // List of known properties for hasOwnProperty checks
    const knownProperties = new Set([
      'send', 'try', 'do', 'on', 'every', 'log', 'state', 'location', 'user',
      'ai', 'write', 'summarize', 'list', 'extract', 'is', 'decide',
    ])

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

          // Location access (lazy, returns Promise)
          case 'location':
            return self.getLocation()

          // User context (from X-User-* headers)
          case 'user':
            return self.user

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
      has(_, prop: string | symbol) {
        // Support `in` operator and hasOwnProperty checks for known properties
        return knownProperties.has(String(prop))
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
    } catch (catchError) {
      // Never throw from error handler, but log the failure
      logBestEffortError(catchError, {
        operation: 'emitSystemError',
        source: 'DOBase.emitSystemError',
        context: { errorType, originalEvent, ns: this.ns },
      })
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
    } catch (error) {
      logBestEffortError(error, {
        operation: 'persistStepResult',
        source: 'DOBase.persistStepResult',
        context: { stepId, ns: this.ns },
      })
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
    } catch (error) {
      logBestEffortError(error, {
        operation: 'loadPersistedSteps',
        source: 'DOBase.loadPersistedSteps',
        context: { ns: this.ns },
      })
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
    } catch (error) {
      logBestEffortError(error, {
        operation: 'updateActionStatus',
        source: 'DOBase.updateActionStatus',
        context: { actionId, status, ns: this.ns },
      })
    }
  }

  protected async updateActionAttempts(actionId: string, attempts: number): Promise<void> {
    try {
      await this.db
        .update(schema.actions)
        .set({ options: JSON.stringify({ attempts }) })
        .where(eq(schema.actions.id, actionId))
    } catch (error) {
      logBestEffortError(error, {
        operation: 'updateActionAttempts',
        source: 'DOBase.updateActionAttempts',
        context: { actionId, attempts, ns: this.ns },
      })
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
    } catch (error) {
      logBestEffortError(error, {
        operation: 'completeAction',
        source: 'DOBase.completeAction',
        context: { actionId, ns: this.ns },
      })
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
    } catch (catchError) {
      logBestEffortError(catchError, {
        operation: 'failAction',
        source: 'DOBase.failAction',
        context: { actionId, errorMessage: error.message, ns: this.ns },
      })
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
  // LIFECYCLE EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a listener for lifecycle events (stateLoaded, checkpointed, etc.)
   * @param event - Event name (e.g., 'stateLoaded', 'checkpointed')
   * @param callback - Callback function to invoke when event fires
   */
  on(event: string, callback: (data: unknown) => void): void {
    const listeners = this._lifecycleListeners.get(event) ?? []
    listeners.push(callback)
    this._lifecycleListeners.set(event, listeners)
  }

  /**
   * Emit a lifecycle event to registered listeners
   * @param event - Event name
   * @param data - Event data to pass to listeners
   */
  private emitLifecycleEvent(event: string, data: unknown): void {
    const listeners = this._lifecycleListeners.get(event) ?? []
    for (const listener of listeners) {
      try {
        listener(data)
      } catch (error) {
        console.error(`Lifecycle event listener error for '${event}':`, error)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ICEBERG STATE PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load state from Iceberg snapshot on cold start.
   * Uses JWT claims to determine R2 path.
   * @param jwt - Optional JWT token (if not provided, will try to get from context)
   */
  async loadFromIceberg(jwt?: string): Promise<void> {
    // Get R2 bucket from env
    const r2 = (this.env as Record<string, unknown>).R2 as {
      list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
      get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; json<T>(): Promise<T> } | null>
    } | undefined

    if (!r2) {
      console.warn('No R2 bucket configured, starting with empty state')
      this.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
      return
    }

    const token = jwt ?? this.getJwtFromContextInternal()

    // Build prefix for snapshot path
    let prefix: string
    if (token) {
      // Extract storage claims from JWT (decode payload without verification for path construction)
      const claims = this.decodeJwtClaimsInternal(token)
      const orgId = claims.org_id as string
      const tenantId = (claims.tenant_id as string) ?? orgId
      prefix = `orgs/${orgId}/tenants/${tenantId}/do/${this.ctx.id.toString()}/snapshots/`
    } else {
      // Fallback: use DO id only (for tests without JWT)
      console.warn('No JWT available, using default snapshot path')
      prefix = `do/${this.ctx.id.toString()}/snapshots/`
    }

    // List snapshots - propagate R2 errors directly
    const result = await r2.list({ prefix })
    const snapshots = result.objects.map((obj) => obj.key)

    if (snapshots.length === 0) {
      this.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
      return
    }

    // Sort by sequence number (embedded in filename as seq-N)
    snapshots.sort((a, b) => {
      const seqA = parseInt(a.match(/seq-(\d+)/)?.[1] ?? '0')
      const seqB = parseInt(b.match(/seq-(\d+)/)?.[1] ?? '0')
      return seqB - seqA // Descending order (latest first)
    })

    const snapshotPath = snapshots[0]

    // Load snapshot data
    const snapshotData = await r2.get(snapshotPath)
    if (!snapshotData) {
      // Snapshot was listed but not found (race condition) - treat as fresh
      this.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
      return
    }

    // Parse snapshot - propagate JSON parse errors
    const snapshotBuffer = await snapshotData.arrayBuffer()
    const snapshotText = new TextDecoder().decode(snapshotBuffer)
    const snapshot = JSON.parse(snapshotText)

    // Only attempt restore if we have a proper IcebergSnapshot with required fields
    // Simple test snapshots (e.g., { tables: {} }) should just verify R2 flow
    const sqlInterface = (this.ctx.storage as { sql?: { exec(query: string, ...params: unknown[]): { toArray(): unknown[] } } }).sql
    if (sqlInterface && this.isValidIcebergSnapshot(snapshot)) {
      this._icebergAdapter = new IcebergStateAdapter(sqlInterface)
      await this._icebergAdapter.restoreFromSnapshot(snapshot)
    }

    this.emitLifecycleEvent('stateLoaded', { fromSnapshot: true, snapshotId: snapshotPath })
  }

  /**
   * Check if a parsed snapshot object is a valid IcebergSnapshot with proper structure.
   * Used to distinguish between full snapshots and simplified test data.
   */
  private isValidIcebergSnapshot(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== 'object') return false
    const s = snapshot as Record<string, unknown>
    // A valid IcebergSnapshot has checksum, schemaVersion, and tables with ArrayBuffer values
    return (
      typeof s.checksum === 'string' &&
      typeof s.schemaVersion === 'number' &&
      typeof s.tables === 'object' &&
      s.tables !== null
    )
  }

  /**
   * Decode JWT payload without signature verification.
   * Used for extracting claims for path construction.
   */
  private decodeJwtClaimsInternal(jwt: string): Record<string, unknown> {
    const parts = jwt.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format')
    }
    try {
      // Base64url decode the payload (second part)
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
      const decoded = atob(padded)
      return JSON.parse(decoded)
    } catch {
      throw new Error('Failed to decode JWT payload')
    }
  }

  /**
   * Get JWT from context or environment
   * @returns JWT token string or null
   */
  private getJwtFromContextInternal(): string | null {
    // Try various sources for JWT
    return (this.ctx as { jwt?: string })?.jwt ?? (this.env as { JWT?: string })?.JWT ?? null
  }

  /**
   * Save current state to Iceberg snapshot on R2.
   * Creates metadata, manifests, and Parquet data files.
   *
   * @throws Error if no JWT is available for storage authorization
   * @throws Error if R2 operations fail
   */
  async saveToIceberg(): Promise<void> {
    const jwt = this.getJwtFromContextInternal()
    if (!jwt) {
      throw new Error('No JWT available for storage')
    }

    // Get R2 bucket from env
    const r2 = (this.env as Record<string, unknown>).R2 as {
      put(key: string, data: ArrayBuffer | string): Promise<void>
    } | undefined

    if (!r2) {
      throw new Error('No R2 bucket configured')
    }

    // Initialize R2 client if needed
    if (!this._r2Client) {
      const claims = this.decodeJwtClaimsInternal(jwt)
      const r2Claims = {
        orgId: claims.org_id as string,
        tenantId: (claims.tenant_id as string) ?? (claims.org_id as string),
        bucket: 'default',
        pathPrefix: '',
      }
      this._r2Client = new AuthorizedR2Client(r2Claims, r2 as R2Bucket)
    }

    // Initialize Iceberg adapter if needed
    if (!this._icebergAdapter) {
      // Get raw SQL interface from ctx.storage.sql
      const sqlInterface = (this.ctx.storage as { sql?: { exec(query: string, ...params: unknown[]): { toArray(): unknown[] } } }).sql
      if (!sqlInterface) {
        throw new Error('SQL storage not available')
      }
      this._icebergAdapter = new IcebergStateAdapter(sqlInterface)
    }

    // Create snapshot
    this._snapshotSequence++
    const snapshot = await this._icebergAdapter.createSnapshot()
    const snapshotId = `seq-${this._snapshotSequence}-${snapshot.id}`
    const doId = this.ctx.id.toString()

    // Write data files (Parquet)
    for (const [table, data] of Object.entries(snapshot.tables)) {
      await this._r2Client.putSnapshot(
        doId,
        snapshotId,
        `data/${table}.parquet`,
        data
      )
    }

    // Write manifests
    for (const manifest of snapshot.manifests) {
      await this._r2Client.putSnapshot(
        doId,
        snapshotId,
        `manifests/${manifest.manifest_path}`,
        JSON.stringify(manifest)
      )
    }

    // Write metadata.json with Iceberg format
    const metadataWithTimestamp = {
      ...snapshot.metadata,
      snapshots: snapshot.metadata.snapshots.map((s: { snapshot_id: number; manifest_list: string }) => ({
        ...s,
        'timestamp-ms': Date.now(),
      })),
    }
    await this._r2Client.putSnapshot(
      doId,
      snapshotId,
      'metadata.json',
      JSON.stringify(metadataWithTimestamp)
    )

    // Update latest pointer
    await this._r2Client.putSnapshot(
      doId,
      'snapshots',
      'latest',
      snapshotId
    )

    // Emit lifecycle event
    this.emitLifecycleEvent('checkpointed', { snapshotId, sequence: this._snapshotSequence })

    // Reset pending changes counter and update timestamp
    this._pendingChanges = 0
    this._lastCheckpointTimestamp = Date.now()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ICEBERG AUTO-CHECKPOINT AND CONSISTENCY GUARD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configure Iceberg state persistence options.
   * Enables auto-checkpoint, debounced saves, and consistency guards.
   *
   * @example
   * ```typescript
   * this.configureIceberg({
   *   autoCheckpoint: true,
   *   checkpointIntervalMs: 30000,      // 30 seconds
   *   minChangesBeforeCheckpoint: 5,    // Wait for at least 5 changes
   * })
   * ```
   */
  protected configureIceberg(options: IcebergOptions): void {
    this._icebergOptions = { ...options }

    // Start auto-checkpoint if enabled
    if (options.autoCheckpoint) {
      this.startAutoCheckpoint(options.checkpointIntervalMs ?? 60000)
    }
  }

  /**
   * Start automatic periodic checkpointing.
   * Creates non-blocking background saves at the specified interval.
   *
   * @param intervalMs - Interval between checkpoints in milliseconds
   */
  private startAutoCheckpoint(intervalMs: number): void {
    // Clear any existing timer
    this.stopAutoCheckpoint()

    const minChanges = this._icebergOptions.minChangesBeforeCheckpoint ?? 1

    this._checkpointTimer = setInterval(async () => {
      // Only checkpoint if we have pending changes above the threshold
      if (this._pendingChanges >= minChanges) {
        try {
          await this.saveToIceberg()
          // Note: saveToIceberg now resets _pendingChanges
        } catch (error) {
          // Log but don't throw - this is background operation
          console.error('Auto-checkpoint failed:', error)
          this.emitLifecycleEvent('checkpointFailed', { error })
        }
      }
    }, intervalMs)

    this.emitLifecycleEvent('autoCheckpointStarted', { intervalMs, minChanges })
  }

  /**
   * Stop automatic checkpointing.
   * Clears the checkpoint timer if running.
   */
  protected stopAutoCheckpoint(): void {
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer)
      this._checkpointTimer = undefined
      this.emitLifecycleEvent('autoCheckpointStopped', {})
    }
  }

  /**
   * Track data changes for smart checkpointing.
   * Call this method after any mutation to state that should be persisted.
   * Auto-checkpoint will use this count to decide when to save.
   *
   * @example
   * ```typescript
   * // After creating/updating/deleting entities
   * await this.things.create({ type: 'Customer', data: { name: 'Alice' } })
   * this.onDataChange()
   * ```
   */
  protected onDataChange(): void {
    this._pendingChanges++
  }

  /**
   * Get the current count of pending (unsaved) changes.
   * Useful for debugging or deciding whether to force a checkpoint.
   */
  protected get pendingChanges(): number {
    return this._pendingChanges
  }

  /**
   * Get the timestamp of the last successful checkpoint.
   * Returns 0 if no checkpoint has been created yet.
   */
  protected get lastCheckpointTimestamp(): number {
    return this._lastCheckpointTimestamp
  }

  /**
   * Acquire a fencing token for single-writer semantics.
   * Provides consistency guard to prevent concurrent writes from multiple instances.
   *
   * The fencing token is stored in R2 with conditional write semantics:
   * - Only succeeds if no lock exists (ifNoneMatch: '*')
   * - Subsequent calls will fail until the lock is released
   *
   * @returns The fencing token if acquired successfully
   * @throws Error if lock already held by another instance or R2 operation fails
   *
   * @example
   * ```typescript
   * try {
   *   const token = await this.acquireFencingToken()
   *   // Safe to write - we hold the lock
   *   await this.saveToIceberg()
   *   await this.releaseFencingToken(token)
   * } catch (error) {
   *   console.log('Could not acquire lock - another instance is active')
   * }
   * ```
   */
  async acquireFencingToken(): Promise<string> {
    const jwt = this.getJwtFromContextInternal()
    if (!jwt) {
      throw new Error('No JWT available for storage')
    }

    const r2 = (this.env as Record<string, unknown>).R2 as R2Bucket | undefined
    if (!r2) {
      throw new Error('No R2 bucket configured')
    }

    // Initialize R2 client if needed
    if (!this._r2Client) {
      const claims = this.decodeJwtClaimsInternal(jwt)
      const r2Claims = {
        orgId: claims.org_id as string,
        tenantId: (claims.tenant_id as string) ?? (claims.org_id as string),
        bucket: 'default',
        pathPrefix: '',
      }
      this._r2Client = new AuthorizedR2Client(r2Claims, r2)
    }

    const token = crypto.randomUUID()
    const doId = this.ctx.id.toString()

    // Try to acquire lock with conditional write
    await this._r2Client.putWithCondition(
      doId,
      'lock',
      JSON.stringify({
        token,
        acquiredAt: Date.now(),
        acquiredBy: doId,
      }),
      { onlyIfNotExists: true }
    )

    this._fencingToken = token
    this.emitLifecycleEvent('fencingTokenAcquired', { token })

    return token
  }

  /**
   * Release a previously acquired fencing token.
   * Only succeeds if the provided token matches the current lock.
   *
   * @param token - The fencing token to release
   * @throws Error if token doesn't match or R2 operation fails
   */
  async releaseFencingToken(token: string): Promise<void> {
    if (!this._r2Client) {
      throw new Error('R2 client not initialized - was fencing token acquired?')
    }

    if (this._fencingToken !== token) {
      throw new Error('Fencing token mismatch - cannot release lock held by another instance')
    }

    const doId = this.ctx.id.toString()

    // Read current lock to verify we own it
    const currentLock = await this._r2Client.get(doId, 'lock')
    if (currentLock) {
      const lockData = await currentLock.json<{ token: string }>()
      if (lockData.token !== token) {
        throw new Error('Lock stolen by another instance')
      }
    }

    // Delete the lock
    await this._r2Client.delete(doId, 'lock')

    this._fencingToken = undefined
    this.emitLifecycleEvent('fencingTokenReleased', { token })
  }

  /**
   * Check if this instance currently holds a fencing token.
   */
  protected get hasFencingToken(): boolean {
    return this._fencingToken !== undefined
  }

  /**
   * Get the current fencing token if held.
   * Returns undefined if no token is held.
   */
  protected get currentFencingToken(): string | undefined {
    return this._fencingToken
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

    const fk = results[0]!.rowid
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
      const fk = existing[0]!.rowid
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

    const fk = inserted[0]!.rowid
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
      update: async (id: string, data: Partial<T>): Promise<T & { $rowid: number }> => {
        const result = await self.things.update(id, {
          data: data as Record<string, unknown>,
        })
        return {
          $id: result.$id,
          $type: noun,
          ...result.data,
          $rowid: result.version ?? 0,
        } as T & { $rowid: number }
      },
      delete: async (id: string): Promise<T & { $rowid: number }> => {
        const result = await self.things.delete(id)
        return {
          $id: result.$id,
          $type: noun,
          ...result.data,
          $rowid: result.version ?? 0,
        } as T & { $rowid: number }
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

  /**
   * Reset all static state - ONLY for testing.
   * This clears accumulated static Maps that persist across test runs.
   */
  static _resetTestState(): void {
    DO._circuitBreakers.clear()
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

  // NOTE: `parent` is now defined in DOTiny base class

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
  // REST ROUTER CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get REST router context for handling REST API requests.
   * Provides the things store and namespace for CRUD operations.
   */
  protected getRestRouterContext(): RestRouterContext {
    // Get the DO class type from static $type or constructor name
    const DOClass = this.constructor as typeof DO & { $type?: string }
    const doType = DOClass.$type || this.constructor.name

    return {
      things: this.things,
      ns: this.ns,
      contextUrl: 'https://dotdo.dev/context',
      parent: this.parent,
      nouns: this.getRegisteredNouns(),
      doType,
    }
  }

  /**
   * Get list of registered nouns for the index.
   * Override in subclasses to provide custom noun list.
   */
  protected getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    // Return cached nouns from typeCache
    // This is populated as types are used
    const nouns: Array<{ noun: string; plural: string }> = []
    for (const [noun] of this._typeCache) {
      // Simple pluralization (subclasses can override for complex cases)
      const plural = noun.endsWith('y')
        ? noun.slice(0, -1) + 'ies'
        : noun.endsWith('s') || noun.endsWith('x') || noun.endsWith('ch') || noun.endsWith('sh')
        ? noun + 'es'
        : noun + 's'
      nouns.push({ noun, plural })
    }
    return nouns
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
  // SYNC WEBSOCKET AUTH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract bearer token from Sec-WebSocket-Protocol header.
   * Format: "capnp-rpc, bearer.{token}" or "bearer.{token}, capnp-rpc"
   *
   * @param protocols - The Sec-WebSocket-Protocol header value
   * @returns The extracted token or null if not found
   */
  protected extractBearerTokenFromProtocol(protocols: string | null): string | null {
    if (!protocols) {
      return null
    }

    const protocolList = protocols.split(',').map((p) => p.trim())
    const bearerProtocol = protocolList.find((p) => p.startsWith('bearer.'))

    if (!bearerProtocol) {
      return null
    }

    const token = bearerProtocol.slice(7) // Remove 'bearer.' prefix
    return token || null // Return null for empty tokens
  }

  /**
   * Validate a sync auth token and return user context.
   * Override this method in subclasses to implement custom validation.
   *
   * By default, this method requires a token but does not validate it.
   * Production implementations should:
   * - Verify JWT tokens with a secret/JWKS
   * - Validate session tokens against a database
   * - Return user context from the validated token
   *
   * @param token - The bearer token to validate
   * @returns Promise resolving to { user: UserContext } on success, null on failure
   */
  protected async validateSyncAuthToken(token: string): Promise<{ user: import('../types/WorkflowContext').UserContext } | null> {
    // Default implementation: require a token but don't validate it
    // This is a stub that subclasses should override with real validation
    // For now, accept any non-empty token (for development/testing)
    if (!token) {
      return null
    }

    // In production, this should validate the token and extract user info
    // For now, return a default user context
    return {
      user: {
        id: 'anonymous',
        // email and role would be extracted from the validated token
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC WEBSOCKET HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle WebSocket sync requests for TanStack DB integration.
   * Requires authentication via Sec-WebSocket-Protocol: "capnp-rpc, bearer.{token}"
   *
   * Returns:
   * - 426 Upgrade Required for non-WebSocket requests
   * - 401 Unauthorized for missing or invalid auth token
   * - 101 Switching Protocols for successful WebSocket upgrade
   *
   * @param request - The incoming HTTP request
   * @returns Response (101 for WebSocket upgrade, 401 for auth failure, 426 for non-WebSocket)
   */
  protected async handleSyncWebSocket(request: Request): Promise<Response> {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('upgrade')

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return Response.json(
        { error: 'WebSocket upgrade required for /sync endpoint' },
        {
          status: 426,
          headers: { 'Upgrade': 'websocket' },
        }
      )
    }

    // Extract token from Sec-WebSocket-Protocol: "capnp-rpc, bearer.{token}"
    const protocols = request.headers.get('Sec-WebSocket-Protocol')
    const token = this.extractBearerTokenFromProtocol(protocols)

    if (!token) {
      return Response.json(
        { error: 'Missing auth token. Use Sec-WebSocket-Protocol: capnp-rpc, bearer.{token}' },
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate the token
    let session: { user: import('../types/WorkflowContext').UserContext } | null = null
    try {
      session = await this.validateSyncAuthToken(token)
    } catch {
      // Token validation threw an error
      session = null
    }

    if (!session) {
      return Response.json(
        { error: 'Invalid auth token' },
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept the server side
    server!.accept()

    // Register with sync engine (pass user context for future use)
    this.syncEngine.accept(server!, session.user)

    // Return the client side to the caller with accepted protocol header
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'Sec-WebSocket-Protocol': 'capnp-rpc',
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER (Extended from DOTiny)
  // ═══════════════════════════════════════════════════════════════════════════

  protected override async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract coordinates from CF request headers if available
    const cf = (request as Request & { cf?: { latitude?: string; longitude?: string } }).cf
    if (cf?.latitude && cf?.longitude && !this._extractedCoordinates) {
      const lat = parseFloat(cf.latitude)
      const lng = parseFloat(cf.longitude)
      if (!isNaN(lat) && !isNaN(lng)) {
        this._extractedCoordinates = { lat, lng }
      }
    }

    // Built-in routes
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this.ns })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ROOT ENDPOINT (/) - Cap'n Web RPC
    // ═══════════════════════════════════════════════════════════════════════════
    // POST / → capnweb RPC (HTTP batch)
    // WebSocket / → capnweb RPC (persistent connection)
    // GET / → info/discovery
    if (url.pathname === '/') {
      // Handle Cap'n Web RPC (POST or WebSocket upgrade)
      if (isCapnWebRequest(request)) {
        return this.#handleCapnWebRpc(request)
      }

      // GET request - return JSON-LD index with collections
      if (request.method === 'GET') {
        // Build REST router context for index generation
        const restCtx = this.getRestRouterContext()
        return handleGetIndex(restCtx, request)
      }

      // Other methods not supported at root
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Allow': 'GET, POST' },
      })
    }

    // Handle /$introspect endpoint for schema discovery
    if (url.pathname === '/$introspect') {
      return this.handleIntrospectRoute(request)
    }

    // Handle /mcp endpoint for MCP transport
    if (url.pathname === '/mcp') {
      return this.handleMcp(request)
    }

    // Handle /rpc endpoint for RPC protocol (JSON-RPC 2.0 + Chain RPC)
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

    // Handle /sync endpoint for WebSocket sync protocol (TanStack DB)
    if (url.pathname === '/sync') {
      return this.handleSyncWebSocket(request)
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

    // ═══════════════════════════════════════════════════════════════════════════
    // REST API ROUTES (/:type and /:type/:id)
    // ═══════════════════════════════════════════════════════════════════════════
    // Handle REST routes for Things CRUD operations
    // GET /customers → list customers
    // GET /customers/cust-1 → get customer by id
    // POST /customers → create customer
    // PUT /customers/cust-1 → replace customer
    // PATCH /customers/cust-1 → update customer (merge)
    // DELETE /customers/cust-1 → delete customer
    const restCtx = this.getRestRouterContext()
    const restResponse = await handleRestRequest(request, restCtx)
    if (restResponse) {
      return restResponse
    }

    // Default: 404 Not Found
    return new Response('Not Found', { status: 404 })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAP'N WEB RPC HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cap'n Web RPC options. Override in subclasses to customize.
   */
  protected get capnWebOptions(): CapnWebOptions {
    return {
      includeStackTraces: (this.env as Record<string, unknown>).ENVIRONMENT !== 'production',
    }
  }

  /**
   * Handle Cap'n Web RPC requests (POST or WebSocket upgrade at root endpoint).
   *
   * This is marked with # prefix to indicate it's internal and should not
   * be exposed via RPC itself.
   */
  async #handleCapnWebRpc(request: Request): Promise<Response> {
    return handleCapnWebRpc(request, this, this.capnWebOptions)
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

  // ═══════════════════════════════════════════════════════════════════════════
  // INTROSPECTION HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle the /$introspect HTTP route.
   * Requires authentication and returns the DOSchema.
   */
  private async handleIntrospectRoute(request: Request): Promise<Response> {
    // Only allow GET requests
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    // Check for Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Parse JWT from Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Invalid authorization header' }, { status: 401 })
    }

    const token = authHeader.slice(7)

    // Parse and verify the JWT
    try {
      const parts = token.split('.')
      if (parts.length !== 3) {
        return Response.json({ error: 'Invalid token format' }, { status: 401 })
      }

      // Verify JWT signature if JWT_SECRET is configured
      const jwtSecret = (this.env as Record<string, unknown>).JWT_SECRET as string | undefined
      if (jwtSecret) {
        const isValid = await this.verifyJwtSignature(token, jwtSecret)
        if (!isValid) {
          return Response.json({ error: 'Invalid token signature' }, { status: 401 })
        }
      } else {
        // In development without JWT_SECRET, log warning but allow request
        console.warn('JWT_SECRET not configured - skipping signature verification')
      }

      const payload = JSON.parse(atob(parts[1]!)) as {
        sub?: string
        email?: string
        name?: string
        roles?: string[]
        permissions?: string[]
        exp?: number
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && payload.exp < now) {
        return Response.json({ error: 'Token expired' }, { status: 401 })
      }

      // Build auth context from JWT claims
      const authContext: AuthContext = {
        authenticated: true,
        user: {
          id: payload.sub || 'anonymous',
          email: payload.email,
          name: payload.name,
          roles: payload.roles || [],
          permissions: payload.permissions || [],
        },
        token: {
          type: 'jwt',
          expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 3600000),
        },
      }

      // Call $introspect with auth context
      const schema = await this.$introspect(authContext)
      return Response.json(schema)
    } catch (error) {
      return Response.json({ error: 'Invalid token' }, { status: 401 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTROSPECTION ($introspect)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Introspect the DO schema, filtered by user role.
   *
   * Returns information about:
   * - Available classes and their methods
   * - MCP tools from static $mcp config
   * - REST endpoints from static $rest config
   * - Available stores (filtered by role)
   * - Storage capabilities (filtered by role)
   * - Registered nouns and verbs
   *
   * @param authContext - Optional auth context for role-based filtering
   * @returns DOSchema object with introspection data
   */
  async $introspect(authContext?: AuthContext): Promise<DOSchema> {
    // Determine role from auth context
    const role = this.determineRole(authContext)
    const scopes = authContext?.user?.permissions || []

    // Build the schema response
    const schema: DOSchema = {
      ns: this.ns,
      permissions: {
        role,
        scopes,
      },
      classes: this.introspectClasses(role),
      nouns: await this.introspectNouns(),
      verbs: await this.introspectVerbs(),
      stores: this.introspectStores(role),
      storage: this.introspectStorage(role),
    }

    return schema
  }

  /**
   * Determine the effective role from auth context
   */
  private determineRole(authContext?: AuthContext): VisibilityRole {
    if (!authContext || !authContext.authenticated) {
      return 'public'
    }

    const roles = authContext.user?.roles || []

    if (roles.length === 0) {
      // Authenticated but no specific roles - default to 'user'
      return 'user'
    }

    return getHighestRole(roles)
  }

  /**
   * Introspect available classes
   */
  private introspectClasses(role: VisibilityRole): DOClassSchema[] {
    const classes: DOClassSchema[] = []

    // Get class info from constructor
    const DOClass = this.constructor as typeof DO & {
      $type?: string
      $mcp?: {
        tools?: Record<string, {
          description: string
          inputSchema: Record<string, unknown>
          visibility?: VisibilityRole
        }>
        resources?: string[]
      }
      $rest?: {
        endpoints?: Array<{
          method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
          path: string
          description?: string
          visibility?: VisibilityRole
        }>
      }
    }

    const className = DOClass.$type || this.constructor.name

    // Determine class visibility based on config
    // Default to 'user' visibility for the class itself
    const classVisibility: VisibilityRole = 'user'

    // Only include class if caller can access it
    if (!canAccessVisibility(role, classVisibility)) {
      return classes
    }

    // Build tools list from $mcp config, filtered by role
    const tools: MCPToolSchema[] = []
    if (DOClass.$mcp?.tools) {
      for (const [name, config] of Object.entries(DOClass.$mcp.tools)) {
        const toolVisibility = config.visibility || 'user'
        if (canAccessVisibility(role, toolVisibility)) {
          tools.push({
            name,
            description: config.description,
            inputSchema: config.inputSchema,
          })
        }
      }
    }

    // Build endpoints list from $rest config, filtered by role
    const endpoints: RESTEndpointSchema[] = []
    if (DOClass.$rest?.endpoints) {
      for (const endpoint of DOClass.$rest.endpoints) {
        const endpointVisibility = endpoint.visibility || 'user'
        if (canAccessVisibility(role, endpointVisibility)) {
          endpoints.push({
            method: endpoint.method,
            path: endpoint.path,
            description: endpoint.description,
          })
        }
      }
    }

    // Build class schema
    classes.push({
      name: className,
      type: 'thing', // Default to 'thing', could be 'collection' for collection DOs
      pattern: `/:type/:id`,
      visibility: classVisibility,
      tools,
      endpoints,
      properties: [], // Could be populated from static schema
      actions: [], // Could be populated from method decorators
    })

    return classes
  }

  /**
   * Introspect available stores, filtered by role
   */
  private introspectStores(role: VisibilityRole): StoreSchema[] {
    const stores: StoreSchema[] = []

    const storeDefinitions: Array<{ name: string; type: StoreSchema['type'] }> = [
      { name: 'things', type: 'things' },
      { name: 'relationships', type: 'relationships' },
      { name: 'actions', type: 'actions' },
      { name: 'events', type: 'events' },
      { name: 'search', type: 'search' },
      { name: 'objects', type: 'objects' },
      { name: 'dlq', type: 'dlq' },
    ]

    for (const store of storeDefinitions) {
      const storeVisibility = STORE_VISIBILITY[store.type]
      if (canAccessVisibility(role, storeVisibility)) {
        stores.push({
          name: store.name,
          type: store.type,
          visibility: storeVisibility,
        })
      }
    }

    return stores
  }

  /**
   * Introspect storage capabilities, filtered by role
   */
  private introspectStorage(role: VisibilityRole): StorageCapabilities {
    // Capability visibility levels:
    // - fsx, gitx: user and above
    // - bashx, r2, sql: admin and above
    // - iceberg, edgevec: system only

    const isUser = canAccessVisibility(role, 'user')
    const isAdmin = canAccessVisibility(role, 'admin')
    const isSystem = canAccessVisibility(role, 'system')

    return {
      fsx: isUser,
      gitx: isUser,
      bashx: isAdmin,
      r2: {
        enabled: isAdmin,
        buckets: isAdmin ? [] : undefined, // Would list actual buckets from env
      },
      sql: {
        enabled: isAdmin,
        tables: isAdmin ? [] : undefined, // Would list actual tables from schema
      },
      iceberg: isSystem,
      edgevec: isSystem,
    }
  }

  /**
   * Introspect registered nouns
   */
  private async introspectNouns(): Promise<IntrospectNounSchema[]> {
    // Query nouns from the database (simplified for now)
    // In full implementation, would query from db.nouns table
    return []
  }

  /**
   * Introspect registered verbs
   */
  private async introspectVerbs(): Promise<VerbSchema[]> {
    // TODO: Query verbs from the database
    // In full implementation, would query from db.verbs table
    return []
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JWT VERIFICATION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify JWT signature using HMAC-SHA256.
   *
   * @param token - The full JWT token string
   * @param secret - The secret key for verification
   * @returns true if signature is valid, false otherwise
   */
  private async verifyJwtSignature(token: string, secret: string): Promise<boolean> {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return false

      const signatureInput = `${parts[0]}.${parts[1]}`
      const signature = parts[2]

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      )

      // Base64url decode the signature
      const signatureBytes = this.base64UrlDecode(signature!)

      return await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBytes,
        encoder.encode(signatureInput)
      )
    } catch {
      return false
    }
  }

  /**
   * Decode a base64url-encoded string to Uint8Array.
   */
  private base64UrlDecode(str: string): Uint8Array {
    // Replace base64url chars with base64 chars
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
    // Pad with '=' to make it valid base64
    while (base64.length % 4) {
      base64 += '='
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}

export default DO
