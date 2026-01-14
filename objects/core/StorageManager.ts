/**
 * @module StorageManager
 * @description Storage management for Durable Objects
 *
 * Handles lazy-loaded store accessors (things, rels, actions, events, search,
 * objects, dlq) and the shared store context. Extracted from DOBase.
 */

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  DLQStore,
  type StoreContext,
  type ThingsMutationCallback,
} from '../../db/stores'
import type { DomainEvent } from '../../types/WorkflowContext'

/**
 * Interface for the StorageManager component
 */
export interface IStorageManager {
  /** ThingsStore - CRUD operations for Things */
  readonly things: ThingsStore

  /** RelationshipsStore - Relationship management */
  readonly rels: RelationshipsStore

  /** ActionsStore - Action logging and lifecycle */
  readonly actions: ActionsStore

  /** EventsStore - Event emission and streaming */
  readonly events: EventsStore

  /** SearchStore - Full-text and semantic search */
  readonly search: SearchStore

  /** ObjectsStore - DO registry and resolution */
  readonly objects: ObjectsStore

  /** DLQStore - Dead Letter Queue for failed events */
  readonly dlq: DLQStore

  /** Type cache for noun FK resolution */
  readonly typeCache: Map<string, number>

  /** Clear all cached stores */
  clearStores(): void
}

/**
 * Dependencies required by StorageManager
 */
export interface StorageManagerDeps {
  /** Drizzle database instance */
  db: DrizzleSqliteDODatabase<Record<string, unknown>>

  /** Namespace URL */
  ns: string

  /** Current branch name */
  currentBranch: string

  /** Environment bindings */
  env: StoreContext['env']

  /** Callback for ThingsStore mutations (for sync engine) */
  onThingsMutation?: ThingsMutationCallback

  /** Event handlers map for DLQ replay */
  eventHandlersMap?: Map<string, (data: unknown) => Promise<unknown>>

  /** Callback to dispatch events to handlers */
  dispatchEventToHandlers?: (event: DomainEvent) => Promise<void>
}

/**
 * StorageManager - Manages lazy-loaded data stores for DOs
 *
 * This class encapsulates all storage-related state and behavior,
 * allowing it to be composed into DO classes rather than inherited.
 */
export class StorageManager implements IStorageManager {
  private _things?: ThingsStore
  private _rels?: RelationshipsStore
  private _actions?: ActionsStore
  private _events?: EventsStore
  private _search?: SearchStore
  private _objects?: ObjectsStore
  private _dlq?: DLQStore
  private _typeCache: Map<string, number> = new Map()

  private readonly deps: StorageManagerDeps

  constructor(deps: StorageManagerDeps) {
    this.deps = deps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORE CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  private getStoreContext(): StoreContext {
    return {
      db: this.deps.db,
      ns: this.deps.ns,
      currentBranch: this.deps.currentBranch,
      env: this.deps.env,
      typeCache: this._typeCache,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORE ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ThingsStore - CRUD operations for Things
   *
   * Automatically wires onMutation callback to SyncEngine for real-time sync.
   */
  get things(): ThingsStore {
    if (!this._things) {
      this._things = new ThingsStore(this.getStoreContext())

      // Wire ThingsStore mutations to callback if provided
      if (this.deps.onThingsMutation) {
        this._things.onMutation = this.deps.onThingsMutation
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
      // Build handler map from event handlers if provided
      const handlerMap = this.deps.eventHandlersMap ?? new Map()
      this._dlq = new DLQStore(this.getStoreContext(), handlerMap)
    }
    return this._dlq
  }

  /**
   * Type cache for noun FK resolution
   */
  get typeCache(): Map<string, number> {
    return this._typeCache
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clear all cached stores (useful for testing or reset)
   */
  clearStores(): void {
    this._things = undefined
    this._rels = undefined
    this._actions = undefined
    this._events = undefined
    this._search = undefined
    this._objects = undefined
    this._dlq = undefined
    this._typeCache.clear()
  }

  /**
   * Update dependencies (for when ns or branch changes)
   */
  updateDeps(updates: Partial<StorageManagerDeps>): void {
    Object.assign(this.deps, updates)
    // Clear stores to pick up new deps on next access
    this.clearStores()
  }
}

/**
 * Factory function to create a StorageManager instance
 */
export function createStorageManager(deps: StorageManagerDeps): StorageManager {
  return new StorageManager(deps)
}
