/**
 * StoresModule - Extracted store accessors from DOBase
 *
 * This module provides lazy-loaded, cached store accessors for all 7 stores:
 * - things    - ThingsStore: CRUD operations for Things
 * - rels      - RelationshipsStore: Relationship CRUD and traversal
 * - actions   - ActionsStore: Action logging and lifecycle
 * - events    - EventsStore: Event emission and streaming
 * - search    - SearchStore: Full-text and semantic search
 * - objects   - ObjectsStore: DO registry and resolution
 * - dlq       - DLQStore: Dead Letter Queue for failed events
 *
 * Features:
 * - Lazy loading: Stores are created on first access
 * - Caching: Same instance returned on multiple accesses
 * - Context updates: Branch changes clear cached stores
 * - DLQ special handling: Event handlers for replay functionality
 */

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

/**
 * Event handler map type for DLQ initialization.
 * Maps event keys (e.g., 'Customer.created') to arrays of handler registrations.
 */
export type EventHandlerMap = Map<string, Array<{ handler: () => Promise<void> }>>

/**
 * StoresModule - Manages lazy-loaded, cached store instances
 *
 * Extracted from DOBase to separate store accessor concerns from the main DO logic.
 */
export class StoresModule {
  // Private cached store instances
  private _things?: ThingsStore
  private _rels?: RelationshipsStore
  private _actions?: ActionsStore
  private _events?: EventsStore
  private _search?: SearchStore
  private _objects?: ObjectsStore
  private _dlq?: DLQStore

  // Store context and event handlers
  private _context: StoreContext
  private _eventHandlers: EventHandlerMap

  constructor(context: StoreContext, eventHandlers: EventHandlerMap) {
    this._context = context
    this._eventHandlers = eventHandlers
  }

  /**
   * ThingsStore - CRUD operations for Things
   */
  get things(): ThingsStore {
    if (!this._things) {
      this._things = new ThingsStoreImpl(this._context)
    }
    return this._things
  }

  /**
   * RelationshipsStore - Relationship management
   */
  get rels(): RelationshipsStore {
    if (!this._rels) {
      this._rels = new RelationshipsStoreImpl(this._context)
    }
    return this._rels
  }

  /**
   * ActionsStore - Action logging and lifecycle
   */
  get actions(): ActionsStore {
    if (!this._actions) {
      this._actions = new ActionsStoreImpl(this._context)
    }
    return this._actions
  }

  /**
   * EventsStore - Event emission and streaming
   */
  get events(): EventsStore {
    if (!this._events) {
      this._events = new EventsStoreImpl(this._context)
    }
    return this._events
  }

  /**
   * SearchStore - Full-text and semantic search
   */
  get search(): SearchStore {
    if (!this._search) {
      this._search = new SearchStoreImpl(this._context)
    }
    return this._search
  }

  /**
   * ObjectsStore - DO registry and resolution
   */
  get objects(): ObjectsStore {
    if (!this._objects) {
      this._objects = new ObjectsStoreImpl(this._context)
    }
    return this._objects
  }

  /**
   * DLQStore - Dead Letter Queue for failed events
   *
   * Special initialization: Creates a handler map from the registered event handlers
   * to enable replay functionality.
   */
  get dlq(): DLQStore {
    if (!this._dlq) {
      const handlerMap = new Map<string, (data: unknown) => Promise<unknown>>()
      for (const [eventKey, registrations] of this._eventHandlers) {
        if (registrations.length > 0) {
          handlerMap.set(eventKey, async (data) => {
            // Execute all registered handlers for this event
            for (const registration of registrations) {
              await registration.handler()
            }
          })
        }
      }
      this._dlq = new DLQStoreImpl(this._context, handlerMap)
    }
    return this._dlq
  }

  /**
   * Update the store context (e.g., on branch change)
   *
   * Clears all cached stores so they will be recreated with the new context
   * on next access.
   */
  updateContext(newContext: StoreContext): void {
    this._context = newContext
    this.clearCachedStores()
  }

  /**
   * Update event handlers (for DLQ replay functionality)
   *
   * Clears the cached DLQ store so it will be recreated with new handlers.
   */
  updateEventHandlers(handlers: EventHandlerMap): void {
    this._eventHandlers = handlers
    // Only clear DLQ since it's the only store that depends on event handlers
    this._dlq = undefined
  }

  /**
   * Clear all cached store instances
   *
   * Called when context changes to ensure stores are recreated with new context.
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
