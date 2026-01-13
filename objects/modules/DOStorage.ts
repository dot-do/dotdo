/**
 * DOStorage Module - SQLite, stores, persistence
 *
 * This module extracts storage-related functionality from DOBase:
 * - Lazy-initialized stores (things, rels, actions, events, search, objects, dlq)
 * - Store context creation (getStoreContext)
 * - DO.with() eager feature initialization
 * - Store type caching (_typeCache)
 * - Step result persistence (persistStepResult, loadPersistedSteps)
 *
 * @module DOStorage
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  DLQStore,
  StoreContext,
} from '../../db/stores'

import {
  ThingsStore as ThingsStoreImpl,
  RelationshipsStore as RelationshipsStoreImpl,
  ActionsStore as ActionsStoreImpl,
  EventsStore as EventsStoreImpl,
  SearchStore as SearchStoreImpl,
  ObjectsStore as ObjectsStoreImpl,
  DLQStore as DLQStoreImpl,
} from '../../db/stores'

import type { DomainEvent, HandlerRegistration } from '../../types/WorkflowContext'
import { logBestEffortError } from '../../lib/logging/error-logger'

// Re-export StoreContext type for consumers
export type { StoreContext }

/**
 * Configuration for features that can be eagerly initialized.
 */
export interface DOFeatureConfig {
  things?: boolean
  relationships?: boolean
  actions?: boolean
  events?: boolean
  search?: boolean
  vectors?: boolean
  objects?: boolean
  dlq?: boolean
}

/**
 * Minimal storage interface for step persistence
 */
export interface StorageInterface {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
}

/**
 * Environment interface for store context
 */
export interface StorageEnv {
  [key: string]: unknown
}

/**
 * DOStorage - Manages lazy-loaded stores and step persistence
 */
export class DOStorage {
  // Private cached store instances
  _things?: ThingsStore
  _rels?: RelationshipsStore
  _actions?: ActionsStore
  _events?: EventsStore
  _search?: SearchStore
  _objects?: ObjectsStore
  _dlq?: DLQStore

  // Type cache shared across stores
  private _typeCache: Map<string, number> = new Map()

  // Step result cache for durable execution
  private _stepCache: Map<string, { result: unknown; completedAt: number }> = new Map()

  // Context components
  private readonly _db: DrizzleD1Database
  private readonly _ns: string
  private _currentBranch: string
  private readonly _env: StorageEnv
  private readonly _storage: StorageInterface

  // Event handlers for DLQ initialization (passed from workflow module)
  private _eventHandlers: Map<string, HandlerRegistration[]> = new Map()
  private _dispatchEventToHandlers?: (event: DomainEvent) => Promise<void>

  constructor(
    db: DrizzleD1Database,
    ns: string,
    currentBranch: string,
    env: StorageEnv,
    storage: StorageInterface
  ) {
    this._db = db
    this._ns = ns
    this._currentBranch = currentBranch
    this._env = env
    this._storage = storage
  }

  /**
   * Get the Drizzle database instance
   */
  get db(): DrizzleD1Database {
    return this._db
  }

  /**
   * Get the namespace
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
   * Set the current branch (clears cached stores)
   */
  setCurrentBranch(branch: string): void {
    if (this._currentBranch !== branch) {
      this._currentBranch = branch
      this.clearCachedStores()
    }
  }

  /**
   * Get the type cache (shared across stores)
   */
  get typeCache(): Map<string, number> {
    return this._typeCache
  }

  /**
   * Set event handlers for DLQ initialization
   */
  setEventHandlers(
    handlers: Map<string, HandlerRegistration[]>,
    dispatchFn: (event: DomainEvent) => Promise<void>
  ): void {
    this._eventHandlers = handlers
    this._dispatchEventToHandlers = dispatchFn
    // Clear DLQ cache so it gets recreated with new handlers
    this._dlq = undefined
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
   * ThingsStore - CRUD operations for Things
   */
  get things(): ThingsStore {
    if (!this._things) {
      this._things = new ThingsStoreImpl(this.getStoreContext())
    }
    return this._things
  }

  /**
   * RelationshipsStore - Relationship management
   */
  get rels(): RelationshipsStore {
    if (!this._rels) {
      this._rels = new RelationshipsStoreImpl(this.getStoreContext())
    }
    return this._rels
  }

  /**
   * ActionsStore - Action logging and lifecycle
   */
  get actions(): ActionsStore {
    if (!this._actions) {
      this._actions = new ActionsStoreImpl(this.getStoreContext())
    }
    return this._actions
  }

  /**
   * EventsStore - Event emission and streaming
   */
  get events(): EventsStore {
    if (!this._events) {
      this._events = new EventsStoreImpl(this.getStoreContext())
    }
    return this._events
  }

  /**
   * SearchStore - Full-text and semantic search
   */
  get search(): SearchStore {
    if (!this._search) {
      this._search = new SearchStoreImpl(this.getStoreContext())
    }
    return this._search
  }

  /**
   * ObjectsStore - DO registry and resolution
   */
  get objects(): ObjectsStore {
    if (!this._objects) {
      this._objects = new ObjectsStoreImpl(this.getStoreContext())
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
            if (this._dispatchEventToHandlers) {
              const event: DomainEvent = {
                id: `dlq-replay-${crypto.randomUUID()}`,
                verb: eventKey.split('.')[1] || '',
                source: `https://${this._ns}/${eventKey.split('.')[0]}/replay`,
                data,
                timestamp: new Date(),
              }
              await this._dispatchEventToHandlers(event)
            }
          })
        }
      }
      this._dlq = new DLQStoreImpl(this.getStoreContext(), handlerMap)
    }
    return this._dlq
  }

  /**
   * Initialize features that are configured for eager initialization.
   * Called during DO construction when using DO.with().
   */
  async initializeEagerFeatures(features: DOFeatureConfig): Promise<void> {
    if (features.things) {
      void this.things
    }
    if (features.relationships) {
      void this.rels
    }
    if (features.actions) {
      void this.actions
    }
    if (features.events) {
      void this.events
    }
    if (features.search || features.vectors) {
      void this.search
    }
    if (features.objects) {
      void this.objects
    }
    if (features.dlq) {
      void this.dlq
    }
  }

  /**
   * Persist a step result to storage
   */
  async persistStepResult(stepId: string, result: unknown): Promise<void> {
    try {
      const stepData = { result, completedAt: Date.now() }
      this._stepCache.set(stepId, stepData)
      await this._storage.put(`step:${stepId}`, stepData)
    } catch (error) {
      logBestEffortError(error, {
        operation: 'persistStepResult',
        source: 'DOStorage.persistStepResult',
        context: { stepId, ns: this._ns },
      })
    }
  }

  /**
   * Load persisted steps from storage into cache
   */
  async loadPersistedSteps(): Promise<void> {
    try {
      const steps = await this._storage.list({ prefix: 'step:' })
      for (const [key, value] of steps) {
        const stepId = key.replace('step:', '')
        const data = value as { result: unknown; completedAt: number }
        this._stepCache.set(stepId, data)
      }
    } catch (error) {
      logBestEffortError(error, {
        operation: 'loadPersistedSteps',
        source: 'DOStorage.loadPersistedSteps',
        context: { ns: this._ns },
      })
    }
  }

  /**
   * Get a cached step result
   */
  getStepResult(stepId: string): { result: unknown; completedAt: number } | undefined {
    return this._stepCache.get(stepId)
  }

  /**
   * Get the step cache (for testing)
   */
  getStepCache(): Map<string, { result: unknown; completedAt: number }> {
    return this._stepCache
  }

  /**
   * Clear all cached store instances
   */
  private clearCachedStores(): void {
    this._things = undefined
    this._rels = undefined
    this._actions = undefined
    this._events = undefined
    this._search = undefined
    this._objects = undefined
    this._dlq = undefined
  }
}
