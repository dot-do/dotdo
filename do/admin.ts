// Admin interface hooks for DO introspection and management
//
// Provides administrative endpoints for:
// - Entity inspection (list, get, delete)
// - Event inspection (list, get, emit)
// - Relationship inspection (list)
// - State inspection (comprehensive overview)
// - Health checks
//
// Usage:
//
// ```typescript
// import { createAdminHooks, createThingsStore, createEventsStore, createRelationshipsStore } from '@dotdo/do'
//
// const admin = createAdminHooks({
//   things: createThingsStore(),
//   events: createEventsStore(),
//   relationships: createRelationshipsStore()
// })
//
// // List entities
// const entities = await admin.listEntities({ type: 'Customer', limit: 10 })
//
// // List events with filters
// const events = await admin.listEvents({
//   type: 'Customer.created',
//   since: Date.now() - 3600000
// })
//
// // Manual event emission (for testing/admin)
// await admin.emitEvent({
//   type: 'admin.maintenance',
//   payload: { action: 'cleanup' },
//   source: 'admin-console'
// })
//
// // State inspection
// const state = await admin.inspectState()
// console.log(state.entities.byType) // { Customer: 42, Order: 123 }
//
// // Health check
// const health = await admin.healthCheck()
// console.log(health.status) // 'healthy' | 'degraded' | 'unhealthy'
// ```
//
import type { Thing, ThingsStore } from '@dotdo/db'
import type { Event, EventsStore, EventQueryOptions } from '@dotdo/db'
import type { Relationship, RelationshipsStore } from '@dotdo/db'

export interface AdminStores {
  things: ThingsStore
  events: EventsStore
  relationships: RelationshipsStore
}

export interface EntityListOptions {
  type?: string
  limit?: number
  offset?: number
}

export interface EntityListResult {
  entities: Thing[]
  total: number
  meta?: {
    types: Record<string, number>
  }
}

export interface EventListOptions {
  type?: string
  source?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}

export interface EventListResult {
  events: Event[]
  total: number
}

export interface RelationshipListOptions {
  subject?: string
  predicate?: string
  object?: string
}

export interface RelationshipListResult {
  relationships: Relationship[]
  total: number
}

export interface EmitEventOptions {
  type: string
  payload?: unknown
  source?: string
  correlationId?: string
}

export interface StateInspection {
  entities: {
    total: number
    byType: Record<string, number>
  }
  events: {
    total: number
    byType: Record<string, number>
  }
  relationships: {
    total: number
    byPredicate: Record<string, number>
  }
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: number
  stores: {
    things: boolean
    events: boolean
    relationships: boolean
  }
  metrics: {
    entityCount: number
    eventCount: number
    relationshipCount: number
  }
}

/**
 * AdminDO - Administrative interface for DO introspection
 *
 * Provides admin endpoints for:
 * - Listing entities, events, relationships
 * - Manual event emission
 * - State inspection
 * - Health checks
 */
export class AdminDO {
  private stores: AdminStores

  constructor(stores: AdminStores) {
    this.stores = stores
  }

  /**
   * List entities with optional filtering and pagination
   */
  async listEntities(options: EntityListOptions = {}): Promise<EntityListResult> {
    const { type, limit = 100, offset = 0 } = options

    // Get entities from store
    const entities = await this.stores.things.list({ type, limit, offset })

    // Calculate total (get all and count)
    const all = await this.stores.things.list({ type })
    const total = all.length

    // Build type metadata
    const typeMap: Record<string, number> = {}
    const allEntities = await this.stores.things.list({})
    for (const entity of allEntities) {
      typeMap[entity.$type] = (typeMap[entity.$type] || 0) + 1
    }

    return {
      entities,
      total,
      meta: {
        types: typeMap
      }
    }
  }

  /**
   * List events with optional filtering and pagination
   */
  async listEvents(options: EventListOptions = {}): Promise<EventListResult> {
    const { type, source, since, until, limit = 100, offset = 0 } = options

    // Build query options
    const queryOptions: EventQueryOptions = {
      type,
      source,
      since,
      until,
      limit,
      offset
    }

    // Get events from store
    const events = await this.stores.events.query(queryOptions)

    // Calculate total (get all with filters but no pagination)
    const allEvents = await this.stores.events.query({
      type,
      source,
      since,
      until
    })
    const total = allEvents.length

    return {
      events,
      total
    }
  }

  /**
   * List relationships with optional filtering
   */
  async listRelationships(options: RelationshipListOptions = {}): Promise<RelationshipListResult> {
    const { subject, predicate, object } = options

    const relationships = await this.stores.relationships.find({
      subject,
      predicate,
      object
    })

    return {
      relationships,
      total: relationships.length
    }
  }

  /**
   * Manually emit an event (for admin/testing purposes)
   */
  async emitEvent(options: EmitEventOptions): Promise<Event> {
    const { type, payload, source, correlationId } = options

    return await this.stores.events.emit({
      type,
      payload,
      source,
      correlationId
    })
  }

  /**
   * Get comprehensive state inspection
   */
  async inspectState(): Promise<StateInspection> {
    // Get all entities
    const allEntities = await this.stores.things.list({})
    const entityTypeMap: Record<string, number> = {}
    for (const entity of allEntities) {
      entityTypeMap[entity.$type] = (entityTypeMap[entity.$type] || 0) + 1
    }

    // Get all events
    const allEvents = await this.stores.events.query({})
    const eventTypeMap: Record<string, number> = {}
    for (const event of allEvents) {
      eventTypeMap[event.type] = (eventTypeMap[event.type] || 0) + 1
    }

    // Get all relationships
    const allRelationships = await this.stores.relationships.find({})
    const predicateMap: Record<string, number> = {}
    for (const rel of allRelationships) {
      predicateMap[rel.predicate] = (predicateMap[rel.predicate] || 0) + 1
    }

    return {
      entities: {
        total: allEntities.length,
        byType: entityTypeMap
      },
      events: {
        total: allEvents.length,
        byType: eventTypeMap
      },
      relationships: {
        total: allRelationships.length,
        byPredicate: predicateMap
      }
    }
  }

  /**
   * Health check for DO state
   *
   * Optimized to avoid N+1 queries by:
   * - Batching all three store queries in parallel with Promise.allSettled
   * - Using the same query results for both availability checking AND metrics
   * - Deriving store status from query success/failure
   */
  async healthCheck(): Promise<HealthCheck> {
    // Batch all store queries in parallel - this replaces 6 separate queries with 3
    const [thingsResult, eventsResult, relationshipsResult] = await Promise.allSettled([
      this.stores.things.list({}),
      this.stores.events.query({}),
      this.stores.relationships.find({})
    ])

    // Derive store availability from query results
    const storeStatus = {
      things: thingsResult.status === 'fulfilled',
      events: eventsResult.status === 'fulfilled',
      relationships: relationshipsResult.status === 'fulfilled'
    }

    // Determine overall health status
    const availableCount = [storeStatus.things, storeStatus.events, storeStatus.relationships]
      .filter(Boolean).length

    let status: 'healthy' | 'degraded' | 'unhealthy'
    if (availableCount === 3) {
      status = 'healthy'
    } else if (availableCount === 0) {
      status = 'unhealthy'
    } else {
      status = 'degraded'
    }

    // Extract counts from the same query results (no additional queries needed)
    const entityCount = thingsResult.status === 'fulfilled' ? thingsResult.value.length : 0
    const eventCount = eventsResult.status === 'fulfilled' ? eventsResult.value.length : 0
    const relationshipCount = relationshipsResult.status === 'fulfilled' ? relationshipsResult.value.length : 0

    return {
      status,
      timestamp: Date.now(),
      stores: storeStatus,
      metrics: {
        entityCount,
        eventCount,
        relationshipCount
      }
    }
  }

  /**
   * Get a single entity by ID
   */
  async getEntity(id: string): Promise<Thing | null> {
    return await this.stores.things.get(id)
  }

  /**
   * Get a single event by ID
   */
  async getEvent(id: string): Promise<Event | null> {
    return await this.stores.events.get(id)
  }

  /**
   * Delete an entity by ID
   */
  async deleteEntity(id: string): Promise<void> {
    await this.stores.things.delete(id)
  }
}

/**
 * Create admin hooks for a DO with stores
 */
export function createAdminHooks(stores: AdminStores): AdminDO {
  return new AdminDO(stores)
}
