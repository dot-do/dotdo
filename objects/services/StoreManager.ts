/**
 * StoreManager - Store lifecycle and lazy loading service
 *
 * Extracted from DOBase to provide:
 * - Lazy initialization of stores (things, rels, actions, events, search, objects, dlq)
 * - Type cache management for noun FK resolution
 * - Store context creation
 *
 * This service encapsulates the store lifecycle pattern:
 * - Stores are only created when first accessed
 * - Each store receives a shared context (db, ns, branch, env, typeCache)
 * - The DLQ store requires a handler map for replay functionality
 *
 * @example
 * ```typescript
 * const storeManager = new StoreManager(db, ns, currentBranch, env)
 *
 * // Stores are lazy-loaded on first access
 * const things = storeManager.things
 * const rels = storeManager.rels
 * ```
 */

import type { DODatabase, AppSchema } from '../../types/drizzle'
import {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  DLQStore,
  type StoreContext,
} from '../../db/stores'

/**
 * Environment bindings required by stores
 */
export interface StoreEnv {
  DO?: {
    idFromName(name: string): { toString(): string }
    idFromString(id: string): { toString(): string }
    get(id: { toString(): string }): { fetch(request: Request): Promise<Response> }
  }
  PIPELINE?: { send(data: unknown): Promise<void> }
  AI?: { fetch(request: Request): Promise<Response> }
  R2_SQL?: {
    exec(query: string, params: unknown[]): Promise<{ results: unknown[] }>
  }
}

/**
 * Configuration for StoreManager
 */
export interface StoreManagerConfig {
  /** Drizzle database instance */
  db: DODatabase<AppSchema>
  /** Namespace identifier for this DO instance */
  ns: string
  /** Current branch (e.g., 'main') */
  currentBranch: string
  /** Environment bindings */
  env: StoreEnv
  /** Optional shared type cache (if not provided, creates internal cache) */
  typeCache?: Map<string, number>
}

/**
 * Handler map for DLQ replay functionality
 * Maps event keys (e.g., 'Customer.signup') to handler functions
 */
export type DLQHandlerMap = Map<string, (data: unknown) => Promise<unknown>>

/**
 * StoreManager - Manages store lifecycle and lazy loading
 *
 * Provides lazy-initialized store accessors and manages the shared
 * context (db, ns, branch, env, typeCache) across all stores.
 */
export class StoreManager {
  private readonly _db: DODatabase<AppSchema>
  private readonly _ns: string
  private readonly _env: StoreEnv
  private readonly _typeCache: Map<string, number>

  private _currentBranch: string

  // Lazy-loaded store instances
  private _things?: ThingsStore
  private _rels?: RelationshipsStore
  private _actions?: ActionsStore
  private _events?: EventsStore
  private _search?: SearchStore
  private _objects?: ObjectsStore
  private _dlq?: DLQStore

  // DLQ handler map (set via setDlqHandlers)
  private _dlqHandlers?: DLQHandlerMap

  constructor(config: StoreManagerConfig) {
    this._db = config.db
    this._ns = config.ns
    this._currentBranch = config.currentBranch
    this._env = config.env
    this._typeCache = config.typeCache ?? new Map()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT & CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current namespace
   */
  get ns(): string {
    return this._ns
  }

  /**
   * Get the current branch
   */
  get currentBranch(): string {
    return this._currentBranch
  }

  /**
   * Set the current branch (for branch switching)
   */
  set currentBranch(branch: string) {
    this._currentBranch = branch
    // Reset stores to pick up new branch - they'll be recreated on next access
    this.resetStores()
  }

  /**
   * Get the type cache (for noun FK resolution)
   */
  get typeCache(): Map<string, number> {
    return this._typeCache
  }

  /**
   * Get the database instance
   */
  get db(): DODatabase<AppSchema> {
    return this._db
  }

  /**
   * Get the store context for initializing stores
   */
  getStoreContext(): StoreContext {
    return {
      db: this._db,
      ns: this._ns,
      currentBranch: this._currentBranch,
      env: this._env as StoreContext['env'],
      typeCache: this._typeCache,
    }
  }

  /**
   * Set DLQ handlers for replay functionality
   * Must be called before accessing the dlq store if replay is needed
   */
  setDlqHandlers(handlers: DLQHandlerMap): void {
    this._dlqHandlers = handlers
    // Reset DLQ store to pick up new handlers
    this._dlq = undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORE ACCESSORS (lazy-loaded)
  // ═══════════════════════════════════════════════════════════════════════════

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
      this._dlq = new DLQStore(this.getStoreContext(), this._dlqHandlers)
    }
    return this._dlq
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reset all store instances
   * Stores will be re-created on next access with fresh context
   */
  resetStores(): void {
    this._things = undefined
    this._rels = undefined
    this._actions = undefined
    this._events = undefined
    this._search = undefined
    this._objects = undefined
    this._dlq = undefined
  }

  /**
   * Check if a specific store has been initialized
   */
  isStoreInitialized(store: 'things' | 'rels' | 'actions' | 'events' | 'search' | 'objects' | 'dlq'): boolean {
    switch (store) {
      case 'things': return this._things !== undefined
      case 'rels': return this._rels !== undefined
      case 'actions': return this._actions !== undefined
      case 'events': return this._events !== undefined
      case 'search': return this._search !== undefined
      case 'objects': return this._objects !== undefined
      case 'dlq': return this._dlq !== undefined
    }
  }

  /**
   * Get list of initialized stores
   */
  getInitializedStores(): string[] {
    const stores: string[] = []
    if (this._things) stores.push('things')
    if (this._rels) stores.push('rels')
    if (this._actions) stores.push('actions')
    if (this._events) stores.push('events')
    if (this._search) stores.push('search')
    if (this._objects) stores.push('objects')
    if (this._dlq) stores.push('dlq')
    return stores
  }
}
