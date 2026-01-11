/**
 * Entity Events (Event Sourcing) Module
 *
 * This module implements event sourcing for entities:
 * - $.Entity(id).append(eventType, data) - Append events
 * - $.Entity(id).state() - Reconstruct state from events
 * - $.Entity(id).events() - Get event history
 * - $.Entity(id).stateAt(timestamp) - Time-travel to point in time
 * - $.aggregate(entityType, config) - Define state reducers
 * - $.projection(name, config) - Define cross-entity projections
 *
 * @module workflows/data/entity-events
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * An event stored in an entity's event log
 */
export interface EntityEvent<TData = Record<string, unknown>> {
  /** Full event type, e.g., "Order.created" */
  type: string
  /** Event payload data */
  data: TData
  /** Monotonically increasing version number for this entity */
  version: number
  /** When the event was appended */
  timestamp: Date
  /** The entity ID this event belongs to */
  entityId: string
}

/**
 * Current state of an entity, reconstructed from events
 */
export interface EntityState<TState = Record<string, unknown>> {
  /** The reconstructed state */
  state: TState
  /** Version of the latest applied event */
  version: number
  /** Timestamp of the latest applied event */
  lastUpdated: Date
}

/**
 * Configuration for defining an aggregate
 */
export interface AggregateDefinition<TState = Record<string, unknown>> {
  /** Factory function returning initial state */
  initial: () => TState
  /** Map of event type to reducer function */
  reduce: Record<string, (state: TState, event: EntityEvent) => TState | Promise<TState>>
  /** Optional event schemas for validation */
  events?: Record<string, { schema: Record<string, { type: string; required?: boolean }> }>
  /** Snapshot configuration */
  snapshots?: SnapshotConfig
}

/**
 * Configuration for snapshots
 */
export interface SnapshotConfig {
  /** Create snapshot every N events (0 to disable) */
  every: number
}

/**
 * Configuration for defining a projection
 */
export interface ProjectionDefinition {
  /** Event types to subscribe to, e.g., ["Order.*", "Customer.created"] */
  from: string[]
  /** Map of event type to handler function */
  handle: Record<string, ProjectionHandler>
  /** Error handling strategy */
  onError?: 'throw' | 'skip' | 'retry'
}

/**
 * Handler function for projection events
 */
export type ProjectionHandler = (event: EntityEvent, utils: ProjectionUtils) => Promise<void>

/**
 * Utilities available in projection handlers
 */
export interface ProjectionUtils {
  /** Set a key to a value (overwrites) */
  set: (key: string, value: unknown) => Promise<void>
  /** Update a key using an updater function */
  upsert: <T>(key: string, updater: (current: T | undefined) => T) => Promise<void>
  /** Delete a key */
  del: (key: string) => Promise<void>
}

/**
 * Filter options for querying events
 */
export interface EventFilter {
  /** Filter by event type */
  type?: string
  /** Filter events from this version onwards */
  fromVersion?: number
  /** Filter events up to this version */
  toVersion?: number
  /** Filter events since this timestamp */
  since?: Date
  /** Maximum number of events to return */
  limit?: number
  /** Number of events to skip */
  offset?: number
}

/**
 * Snapshot information
 */
export interface SnapshotInfo {
  id: string
  version: number
  timestamp: Date
}

// ============================================================================
// ENTITY EVENT CONTEXT
// ============================================================================

/**
 * The main entity event context interface
 */
export interface EntityEventContext {
  /** The $ proxy for accessing entities and configuration */
  $: EntityEventProxy
  /** Check if an aggregate is defined */
  hasAggregate: (name: string) => boolean
  /** Check if a projection is defined */
  hasProjection: (name: string) => boolean
  /** Get aggregate definition */
  getAggregate: (name: string) => AggregateDefinition
  /** Set strict mode (throw on undefined aggregates) */
  setStrictMode: (strict: boolean) => void
  /** Internal: simulate storage failure for testing */
  _simulateStorageFailure: (fail: boolean) => void
  /** Internal: inject corrupted event for testing */
  _injectCorruptedEvent: (
    entityType: string,
    entityId: string,
    event: Partial<EntityEvent>
  ) => Promise<void>
}

/**
 * The $ proxy interface for entity operations
 */
export interface EntityEventProxy {
  /** Access an entity by type and id */
  [entityType: string]: (id: string) => EntityOperations

  /** Define an aggregate */
  aggregate: <TState = Record<string, unknown>>(
    name: string,
    definition: AggregateDefinition<TState>,
    options?: { force?: boolean }
  ) => void

  /** Define a projection */
  projection: ((name: string, definition: ProjectionDefinition) => void) & {
    (name: string): ProjectionOperations
  }

  /** Event handlers (integration with workflow context) */
  on: Record<string, Record<string, (handler: (event: EntityEvent) => void | Promise<void>) => void>>

  /** Durable execution (integration with workflow context) */
  do: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * Operations available on an entity
 */
export interface EntityOperations<TState = Record<string, unknown>> {
  /** Append an event to the entity's event log */
  append: <TData = Record<string, unknown>>(
    eventType: string,
    data: TData
  ) => Promise<EntityEvent<TData>>

  /** Append multiple events atomically */
  appendBatch: (events: Array<{ type: string; data: unknown }>) => Promise<EntityEvent[]>

  /** Get current state by replaying all events */
  state: <T = TState>() => Promise<T>

  /** Get state as it existed at a specific timestamp */
  stateAt: <T = TState>(timestamp: Date | number | string) => Promise<T>

  /** Get event history */
  events: (filter?: EventFilter) => Promise<EntityEvent[]>

  /** Create a manual snapshot */
  createSnapshot: () => Promise<string>

  /** Get snapshot by ID */
  getSnapshot: <T = TState>(snapshotId: string) => Promise<T>

  /** List all snapshots */
  listSnapshots: () => Promise<SnapshotInfo[]>
}

/**
 * Operations available on a projection
 */
export interface ProjectionOperations {
  /** Process pending events */
  process: () => Promise<void>
  /** Rebuild projection from scratch */
  rebuild: () => Promise<void>
  /** Get a value by key */
  get: <T = unknown>(key: string) => Promise<T | undefined>
  /** List values by prefix */
  list: <T = unknown>(options: { prefix: string }) => Promise<T[]>
  /** Get current position in event stream */
  getPosition: () => Promise<number>
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export interface EntityEventContextOptions {
  storage?: Map<string, unknown>
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

interface StoredEvent {
  type: string
  data: unknown
  version: number
  timestamp: number
  entityId: string
}

interface StoredSnapshot {
  id: string
  version: number
  timestamp: number
  state: unknown
}

interface ProjectionState {
  definition: ProjectionDefinition
  position: number
  data: Map<string, unknown>
}

/**
 * Create an entity event context
 */
export function createEntityEventContext(
  options: EntityEventContextOptions = {}
): EntityEventContext {
  // Storage
  const storage = options.storage ?? new Map<string, unknown>()

  // Registry
  const aggregates = new Map<string, AggregateDefinition>()
  const projections = new Map<string, ProjectionState>()
  const eventHandlers = new Map<string, Array<(event: EntityEvent) => void | Promise<void>>>()

  // Configuration
  let strictMode = false
  let simulateStorageFailure = false

  // Transaction state for $.do
  let inTransaction = false
  let transactionEvents: Array<{ key: string; event: StoredEvent }> = []

  // Global event log for projections
  const globalEventLog: StoredEvent[] = []

  // Helper to get events key
  function getEventsKey(entityType: string, entityId: string): string {
    return `events:${entityType}:${entityId}`
  }

  // Helper to get snapshots key
  function getSnapshotsKey(entityType: string, entityId: string): string {
    return `snapshots:${entityType}:${entityId}`
  }

  // Helper to store events
  function getStoredEvents(entityType: string, entityId: string): StoredEvent[] {
    const key = getEventsKey(entityType, entityId)
    return (storage.get(key) as StoredEvent[]) ?? []
  }

  // Helper to save events
  function saveStoredEvents(entityType: string, entityId: string, events: StoredEvent[]): void {
    const key = getEventsKey(entityType, entityId)
    storage.set(key, events)
  }

  // Helper to get snapshots
  function getStoredSnapshots(entityType: string, entityId: string): StoredSnapshot[] {
    const key = getSnapshotsKey(entityType, entityId)
    return (storage.get(key) as StoredSnapshot[]) ?? []
  }

  // Helper to save snapshots
  function saveStoredSnapshots(entityType: string, entityId: string, snapshots: StoredSnapshot[]): void {
    const key = getSnapshotsKey(entityType, entityId)
    storage.set(key, snapshots)
  }

  // Convert stored event to EntityEvent
  function toEntityEvent(stored: StoredEvent): EntityEvent {
    return {
      type: stored.type,
      data: stored.data as Record<string, unknown>,
      version: stored.version,
      timestamp: new Date(stored.timestamp),
      entityId: stored.entityId,
    }
  }

  // Deep clone to ensure immutability
  function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }
    if (obj instanceof Date) {
      return new Date(obj.getTime()) as T
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => deepClone(item)) as T
    }
    const cloned = {} as T
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone(obj[key])
      }
    }
    return cloned
  }

  // Validate event data against schema
  function validateEventData(
    aggregateName: string,
    eventType: string,
    data: Record<string, unknown>
  ): void {
    const aggregate = aggregates.get(aggregateName)
    if (!aggregate?.events) return

    // Always prefix with entity type
    const fullEventType = `${aggregateName}.${eventType}`
    const eventDef = aggregate.events[fullEventType]
    if (!eventDef?.schema) return

    for (const [field, fieldDef] of Object.entries(eventDef.schema)) {
      if (fieldDef.required && !(field in data)) {
        throw new Error(`Validation error: ${field} is required`)
      }
    }
  }

  // Reconstruct state from events
  async function reconstructState(
    entityType: string,
    entityId: string,
    upToTimestamp?: number
  ): Promise<unknown> {
    let events = getStoredEvents(entityType, entityId)

    // Check for corrupted events first (before aggregate check)
    for (const event of events) {
      if (event.data === null && event.type !== null) {
        throw new Error(`Corrupted event data for entity ${entityId}`)
      }
    }

    const aggregate = aggregates.get(entityType)
    if (!aggregate) {
      if (strictMode) {
        throw new Error(`Aggregate '${entityType}' is not defined`)
      }
      return {}
    }

    // Find best snapshot to start from
    const snapshots = getStoredSnapshots(entityType, entityId)
    let state = deepClone(aggregate.initial())
    let startVersion = 0

    if (snapshots.length > 0) {
      // Find the best snapshot (latest one before upToTimestamp if specified)
      let bestSnapshot: StoredSnapshot | null = null
      for (const snapshot of snapshots) {
        if (upToTimestamp === undefined || snapshot.timestamp <= upToTimestamp) {
          if (!bestSnapshot || snapshot.version > bestSnapshot.version) {
            bestSnapshot = snapshot
          }
        }
      }
      if (bestSnapshot) {
        state = deepClone(bestSnapshot.state) as typeof state
        startVersion = bestSnapshot.version
      }
    }

    // Filter events by version and timestamp
    events = events.filter((e) => e.version > startVersion)
    if (upToTimestamp !== undefined) {
      events = events.filter((e) => e.timestamp <= upToTimestamp)
    }

    // Apply events
    for (const event of events) {
      const reducer = aggregate.reduce[event.type]
      if (reducer) {
        const result = reducer(state as Record<string, unknown>, toEntityEvent(event))
        state = (result instanceof Promise ? await result : result) as typeof state
      }
      // Unknown event types are silently skipped
    }

    return deepClone(state)
  }

  // Create entity operations
  function createEntityOperations(entityType: string, entityId: string): EntityOperations {
    return {
      async append<TData = Record<string, unknown>>(
        eventType: string,
        data: TData
      ): Promise<EntityEvent<TData>> {
        // Validate inputs
        if (!entityId || entityId.trim() === '') {
          throw new Error('Invalid entity ID')
        }
        if (!eventType || eventType.trim() === '') {
          throw new Error('Event type is required')
        }

        // Check storage failure simulation
        if (simulateStorageFailure) {
          throw new Error('Storage failure')
        }

        // Check strict mode
        if (strictMode && !aggregates.has(entityType)) {
          throw new Error(`Aggregate '${entityType}' is not defined`)
        }

        // Validate event data against schema
        validateEventData(entityType, eventType, data as Record<string, unknown>)

        // Get current events and determine version
        const events = getStoredEvents(entityType, entityId)
        const version = events.length + 1
        const timestamp = Date.now()

        // Create full event type - always prefix with entity type
        const fullEventType = `${entityType}.${eventType}`

        const storedEvent: StoredEvent = {
          type: fullEventType,
          data: deepClone(data),
          version,
          timestamp,
          entityId,
        }

        // Store event (or buffer in transaction)
        if (inTransaction) {
          transactionEvents.push({ key: getEventsKey(entityType, entityId), event: storedEvent })
        } else {
          events.push(storedEvent)
          saveStoredEvents(entityType, entityId, events)
          globalEventLog.push(storedEvent)
        }

        // Auto-snapshot if configured
        const aggregate = aggregates.get(entityType)
        if (aggregate?.snapshots?.every && aggregate.snapshots.every > 0) {
          if (version % aggregate.snapshots.every === 0) {
            // Create automatic snapshot
            const state = await reconstructState(entityType, entityId)
            const snapshots = getStoredSnapshots(entityType, entityId)
            snapshots.push({
              id: `snapshot-${version}-${timestamp}`,
              version,
              timestamp,
              state,
            })
            saveStoredSnapshots(entityType, entityId, snapshots)
          }
        }

        // Trigger event handlers
        const entityEvent = toEntityEvent(storedEvent)
        const handlerKey = fullEventType
        const handlers = eventHandlers.get(handlerKey) ?? []
        for (const handler of handlers) {
          await handler(entityEvent)
        }

        return entityEvent as EntityEvent<TData>
      },

      async appendBatch(
        eventsToAppend: Array<{ type: string; data: unknown }>
      ): Promise<EntityEvent[]> {
        const results: EntityEvent[] = []
        for (const event of eventsToAppend) {
          const result = await this.append(event.type, event.data)
          results.push(result)
        }
        return results
      },

      async state<T = unknown>(): Promise<T> {
        return (await reconstructState(entityType, entityId)) as T
      },

      async stateAt<T = unknown>(timestamp: Date | number | string): Promise<T> {
        let ts: number
        if (timestamp instanceof Date) {
          ts = timestamp.getTime()
        } else if (typeof timestamp === 'string') {
          ts = new Date(timestamp).getTime()
        } else {
          ts = timestamp
        }
        return (await reconstructState(entityType, entityId, ts)) as T
      },

      async events(filter?: EventFilter): Promise<EntityEvent[]> {
        let events = getStoredEvents(entityType, entityId).map(toEntityEvent)

        if (filter) {
          if (filter.type) {
            events = events.filter((e) => e.type === filter.type)
          }
          if (filter.fromVersion !== undefined) {
            events = events.filter((e) => e.version >= filter.fromVersion!)
          }
          if (filter.toVersion !== undefined) {
            events = events.filter((e) => e.version <= filter.toVersion!)
          }
          if (filter.since) {
            const sinceTime = filter.since.getTime()
            events = events.filter((e) => e.timestamp.getTime() >= sinceTime)
          }
          if (filter.offset !== undefined) {
            events = events.slice(filter.offset)
          }
          if (filter.limit !== undefined) {
            events = events.slice(0, filter.limit)
          }
        }

        return events
      },

      async createSnapshot(): Promise<string> {
        const events = getStoredEvents(entityType, entityId)
        const version = events.length
        const timestamp = Date.now()
        const state = await reconstructState(entityType, entityId)

        const snapshotId = `snapshot-${version}-${timestamp}`
        const snapshots = getStoredSnapshots(entityType, entityId)
        snapshots.push({
          id: snapshotId,
          version,
          timestamp,
          state,
        })
        saveStoredSnapshots(entityType, entityId, snapshots)

        return snapshotId
      },

      async getSnapshot<T = unknown>(snapshotId: string): Promise<T> {
        const snapshots = getStoredSnapshots(entityType, entityId)
        const snapshot = snapshots.find((s) => s.id === snapshotId)
        if (!snapshot) {
          throw new Error(`Snapshot '${snapshotId}' not found`)
        }
        return deepClone(snapshot.state) as T
      },

      async listSnapshots(): Promise<SnapshotInfo[]> {
        const snapshots = getStoredSnapshots(entityType, entityId)
        return snapshots.map((s) => ({
          id: s.id,
          version: s.version,
          timestamp: new Date(s.timestamp),
        }))
      },
    }
  }

  // Create projection operations
  function createProjectionOperations(name: string): ProjectionOperations {
    const projectionState = projections.get(name)
    if (!projectionState) {
      throw new Error(`Projection '${name}' not found`)
    }

    return {
      async process(): Promise<void> {
        const { definition, position, data } = projectionState

        // Find events to process
        const eventsToProcess = globalEventLog.slice(position)

        for (const storedEvent of eventsToProcess) {
          // Check if event matches any "from" pattern
          const matches = definition.from.some((pattern) => {
            if (pattern.endsWith('.*')) {
              const prefix = pattern.slice(0, -2)
              return storedEvent.type.startsWith(prefix + '.')
            }
            return storedEvent.type === pattern
          })

          if (!matches) continue

          const handler = definition.handle[storedEvent.type]
          if (!handler) continue

          const event = toEntityEvent(storedEvent)

          const utils: ProjectionUtils = {
            async set(key: string, value: unknown): Promise<void> {
              data.set(key, deepClone(value))
            },
            async upsert<T>(key: string, updater: (current: T | undefined) => T): Promise<void> {
              const current = data.get(key) as T | undefined
              const updated = updater(current !== undefined ? deepClone(current) : undefined)
              data.set(key, deepClone(updated))
            },
            async del(key: string): Promise<void> {
              data.delete(key)
            },
          }

          try {
            await handler(event, utils)
          } catch (err) {
            if (definition.onError === 'skip') {
              continue
            }
            throw err
          }
        }

        projectionState.position = globalEventLog.length
      },

      async rebuild(): Promise<void> {
        projectionState.position = 0
        projectionState.data.clear()
        await this.process()
      },

      async get<T = unknown>(key: string): Promise<T | undefined> {
        const value = projectionState.data.get(key)
        return value !== undefined ? deepClone(value) as T : undefined
      },

      async list<T = unknown>(options: { prefix: string }): Promise<T[]> {
        const results: T[] = []
        for (const [key, value] of projectionState.data) {
          if (key.startsWith(options.prefix)) {
            results.push(deepClone(value) as T)
          }
        }
        return results
      },

      async getPosition(): Promise<number> {
        return projectionState.position
      },
    }
  }

  // Create the $ proxy
  const proxy = new Proxy({} as EntityEventProxy, {
    get(target, prop: string) {
      if (prop === 'aggregate') {
        return function <TState = Record<string, unknown>>(
          name: string,
          definition: AggregateDefinition<TState>,
          options?: { force?: boolean }
        ): void {
          if (aggregates.has(name) && !options?.force) {
            throw new Error(`Aggregate '${name}' is already defined`)
          }
          aggregates.set(name, definition as AggregateDefinition)
        }
      }

      if (prop === 'projection') {
        const projectionFn = function (
          nameOrDef: string,
          definition?: ProjectionDefinition
        ): void | ProjectionOperations {
          if (definition !== undefined) {
            // Defining a projection
            projections.set(nameOrDef, {
              definition,
              position: 0,
              data: new Map(),
            })
          } else {
            // Getting projection operations
            return createProjectionOperations(nameOrDef)
          }
        }
        return projectionFn
      }

      if (prop === 'on') {
        // Return a proxy for $.on.EntityType.eventType(handler)
        return new Proxy(
          {},
          {
            get(_onTarget, entityType: string) {
              return new Proxy(
                {},
                {
                  get(_entityTarget, eventType: string) {
                    return function (handler: (event: EntityEvent) => void | Promise<void>): void {
                      const fullEventType = `${entityType}.${eventType}`
                      if (!eventHandlers.has(fullEventType)) {
                        eventHandlers.set(fullEventType, [])
                      }
                      eventHandlers.get(fullEventType)!.push(handler)
                    }
                  },
                }
              )
            },
          }
        )
      }

      if (prop === 'do') {
        return async function <T>(fn: () => Promise<T>): Promise<T> {
          inTransaction = true
          transactionEvents = []
          try {
            const result = await fn()
            // Commit transaction
            for (const { key, event } of transactionEvents) {
              const [, entityType, entityId] = key.split(':')
              const events = getStoredEvents(entityType, entityId)
              events.push(event)
              saveStoredEvents(entityType, entityId, events)
              globalEventLog.push(event)
            }
            return result
          } catch (err) {
            // Rollback - discard buffered events
            transactionEvents = []
            throw err
          } finally {
            inTransaction = false
          }
        }
      }

      // Entity type access - return a function that takes an ID
      return function (id: string): EntityOperations {
        return createEntityOperations(prop, id)
      }
    },
  })

  return {
    $: proxy,
    hasAggregate: (name: string) => aggregates.has(name),
    hasProjection: (name: string) => projections.has(name),
    getAggregate: (name: string) => {
      const agg = aggregates.get(name)
      if (!agg) {
        throw new Error(`Aggregate '${name}' not found`)
      }
      return agg
    },
    setStrictMode: (strict: boolean) => {
      strictMode = strict
    },
    _simulateStorageFailure: (fail: boolean) => {
      simulateStorageFailure = fail
    },
    _injectCorruptedEvent: async (
      entityType: string,
      entityId: string,
      event: Partial<EntityEvent>
    ): Promise<void> => {
      const events = getStoredEvents(entityType, entityId)
      events.push({
        type: event.type ?? 'unknown',
        data: event.data as unknown,
        version: event.version ?? events.length + 1,
        timestamp: event.timestamp?.getTime() ?? Date.now(),
        entityId,
      })
      saveStoredEvents(entityType, entityId, events)
    },
  }
}
