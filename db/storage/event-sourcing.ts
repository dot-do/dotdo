// Event Sourcing - Auto-emit events on CRUD operations (do-rljr.5)
// Wraps stores to automatically emit events when entities change

import type { StorableData, JsonValue, JsonObject } from './types'
import type { ThingsStore, Thing, ThingUpdate, BulkUpdateItem } from './things'
import type { RelationshipsStore, Relationship, RelationshipInput, RelationshipQuery, BaseRelationship } from './relationships'
import type { EventsStore, EventInput } from './events'
import type { AuditContext } from './audit'
import type { ThingId } from './branded-types'

/**
 * Event types for entity CRUD operations
 */
export type CrudEventType =
  | 'Thing.created'
  | 'Thing.updated'
  | 'Thing.deleted'
  | 'Relationship.created'
  | 'Relationship.deleted'

/**
 * Payload for Thing.created events
 */
export interface ThingCreatedPayload extends JsonObject {
  $type: string
  $id: string
  data: JsonObject
}

/**
 * Payload for Thing.updated events
 */
export interface ThingUpdatedPayload extends JsonObject {
  $type: string
  $id: string
  changedFields: string[]
  previousValues: JsonObject
  newValues: JsonObject
}

/**
 * Payload for Thing.deleted events
 */
export interface ThingDeletedPayload extends JsonObject {
  $type: string
  $id: string
}

/**
 * Payload for Relationship.created events
 */
export interface RelationshipCreatedPayload extends JsonObject {
  subject: string
  predicate: string
  object: string
}

/**
 * Payload for Relationship.deleted events
 */
export interface RelationshipDeletedPayload extends JsonObject {
  subject: string
  predicate: string
  object: string
}

/**
 * Union of all CRUD event payloads
 */
export type CrudEventPayload =
  | ThingCreatedPayload
  | ThingUpdatedPayload
  | ThingDeletedPayload
  | RelationshipCreatedPayload
  | RelationshipDeletedPayload

/**
 * Configuration for event sourcing behavior
 */
export interface EventSourcingConfig {
  /** Enable/disable event emission (default: true) */
  enabled: boolean
  /** Include full entity data in created events (default: true) */
  includeFullData: boolean
  /** Include previous values in update events (default: true) */
  includePreviousValues: boolean
  /** Entity types to exclude from event emission */
  excludeTypes?: string[]
  /** Entity types to include (if set, only these types emit events) */
  includeTypes?: string[]
  /** Predicates to exclude from relationship events */
  excludePredicates?: string[]
}

/**
 * Default event sourcing configuration
 */
export const defaultEventSourcingConfig: EventSourcingConfig = {
  enabled: true,
  includeFullData: true,
  includePreviousValues: true
}

/**
 * Context provided during event emission
 */
export interface EventEmissionContext {
  /** Audit context for actor tracking */
  auditContext?: AuditContext
}

/**
 * Check if an entity type should emit events based on config
 */
function shouldEmitForType(config: EventSourcingConfig, entityType: string): boolean {
  if (!config.enabled) return false

  // If includeTypes is set, only include those types
  if (config.includeTypes && config.includeTypes.length > 0) {
    return config.includeTypes.includes(entityType)
  }

  // If excludeTypes is set, exclude those types
  if (config.excludeTypes && config.excludeTypes.length > 0) {
    return !config.excludeTypes.includes(entityType)
  }

  return true
}

/**
 * Check if a predicate should emit events based on config
 */
function shouldEmitForPredicate(config: EventSourcingConfig, predicate: string): boolean {
  if (!config.enabled) return false

  if (config.excludePredicates && config.excludePredicates.length > 0) {
    return !config.excludePredicates.includes(predicate)
  }

  return true
}

/**
 * Calculate which fields changed between two objects
 */
function getChangedFields<T extends StorableData>(
  previous: T,
  updated: T
): { changedFields: string[]; previousValues: JsonObject; newValues: JsonObject } {
  const changedFields: string[] = []
  const previousValues: JsonObject = {}
  const newValues: JsonObject = {}

  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(updated)])

  for (const key of allKeys) {
    // Skip system fields for change detection
    if (key.startsWith('$')) continue

    const prevValue = previous[key] as JsonValue
    const newValue = updated[key] as JsonValue

    // Compare JSON-stringified values for deep equality
    if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
      changedFields.push(key)
      if (prevValue !== undefined) {
        previousValues[key] = prevValue
      }
      if (newValue !== undefined) {
        newValues[key] = newValue
      }
    }
  }

  return { changedFields, previousValues, newValues }
}

/**
 * Extract storable data from a thing (exclude system fields except $type and $id)
 */
function extractEntityData(thing: Thing): JsonObject {
  const data: JsonObject = {}
  for (const [key, value] of Object.entries(thing)) {
    // Include user data fields, not system timestamps
    if (!['$createdAt', '$updatedAt'].includes(key)) {
      data[key] = value as JsonValue
    }
  }
  return data
}

/**
 * Wrap a ThingsStore with automatic event emission
 */
export function withEventSourcing<T extends StorableData = StorableData>(
  store: ThingsStore<T>,
  events: EventsStore<JsonValue>,
  config: Partial<EventSourcingConfig> = {},
  context: EventEmissionContext = {}
): ThingsStore<T> {
  const cfg: EventSourcingConfig = { ...defaultEventSourcingConfig, ...config }

  const emitEvent = async (type: CrudEventType, payload: CrudEventPayload) => {
    // Build event input, only including defined properties for exactOptionalPropertyTypes
    const eventInput: EventInput<JsonValue> = {
      type,
      payload,
    }
    if (context.auditContext?.actor !== undefined) {
      eventInput.source = context.auditContext.actor
    }
    if (context.auditContext?.correlationId !== undefined) {
      eventInput.correlationId = context.auditContext.correlationId
    }
    await events.emit(eventInput)
  }

  return {
    async create(data) {
      const thing = await store.create(data)

      if (shouldEmitForType(cfg, thing.$type)) {
        const payload: ThingCreatedPayload = {
          $type: thing.$type,
          $id: thing.$id,
          data: cfg.includeFullData ? extractEntityData(thing) : { $type: thing.$type, $id: thing.$id }
        }
        await emitEvent('Thing.created', payload)
      }

      return thing
    },

    async get(id) {
      return store.get(id)
    },

    async getMany(ids) {
      if (store.getMany) {
        return store.getMany(ids)
      }
      // Fallback: implement getMany using individual get calls
      const result = new Map<string, Thing<T>>()
      for (const id of ids) {
        const item = await store.get(id)
        if (item) {
          result.set(id, item)
        }
      }
      return result
    },

    async update(id, data) {
      // Get previous state for change tracking
      const previous = await store.get(id)
      if (!previous) {
        throw new Error(`Thing not found: ${id}`)
      }

      const updated = await store.update(id, data)

      if (shouldEmitForType(cfg, updated.$type)) {
        const { changedFields, previousValues, newValues } = getChangedFields(
          previous as unknown as StorableData,
          updated as unknown as StorableData
        )

        // Only emit if there are actual changes
        if (changedFields.length > 0) {
          const payload: ThingUpdatedPayload = {
            $type: updated.$type,
            $id: updated.$id,
            changedFields,
            previousValues: cfg.includePreviousValues ? previousValues : {},
            newValues
          }
          await emitEvent('Thing.updated', payload)
        }
      }

      return updated
    },

    async delete(id) {
      // Get thing before deletion to know its type
      const thing = await store.get(id)
      if (!thing) {
        throw new Error(`Thing not found: ${id}`)
      }

      await store.delete(id)

      if (shouldEmitForType(cfg, thing.$type)) {
        const payload: ThingDeletedPayload = {
          $type: thing.$type,
          $id: thing.$id
        }
        await emitEvent('Thing.deleted', payload)
      }
    },

    async list(options) {
      return store.list(options)
    },

    async listWithCursor(options) {
      if (store.listWithCursor) {
        return store.listWithCursor(options)
      }
      // Fallback: implement using list with offset-based pagination
      const listOptions: { type?: string; limit?: number; offset: number } = {
        offset: 0 // cursor-based not supported in fallback
      }
      if (options?.type !== undefined) {
        listOptions.type = options.type
      }
      if (options?.limit !== undefined) {
        listOptions.limit = options.limit
      }
      const items = await store.list(listOptions)
      return { items, hasMore: false }
    },

    async bulkCreate(items) {
      const created = await store.bulkCreate(items)

      // Emit events for each created item
      for (const thing of created) {
        if (shouldEmitForType(cfg, thing.$type)) {
          const payload: ThingCreatedPayload = {
            $type: thing.$type,
            $id: thing.$id,
            data: cfg.includeFullData ? extractEntityData(thing) : { $type: thing.$type, $id: thing.$id }
          }
          await emitEvent('Thing.created', payload)
        }
      }

      return created
    },

    async bulkUpdate(items) {
      // Get previous states for all items
      const previousStates = new Map<string, Thing<T>>()
      for (const { id } of items) {
        const prev = await store.get(id as string)
        if (prev) {
          previousStates.set(id as string, prev)
        }
      }

      const updated = await store.bulkUpdate(items)

      // Emit events for each updated item
      for (const thing of updated) {
        if (shouldEmitForType(cfg, thing.$type)) {
          const previous = previousStates.get(thing.$id)
          if (previous) {
            const { changedFields, previousValues, newValues } = getChangedFields(
              previous as unknown as StorableData,
              thing as unknown as StorableData
            )

            if (changedFields.length > 0) {
              const payload: ThingUpdatedPayload = {
                $type: thing.$type,
                $id: thing.$id,
                changedFields,
                previousValues: cfg.includePreviousValues ? previousValues : {},
                newValues
              }
              await emitEvent('Thing.updated', payload)
            }
          }
        }
      }

      return updated
    },

    async bulkDelete(ids) {
      // Get things before deletion to know their types
      const thingsToDelete: Thing<T>[] = []
      for (const id of ids) {
        const thing = await store.get(id)
        if (thing) {
          thingsToDelete.push(thing)
        }
      }

      await store.bulkDelete(ids)

      // Emit events for each deleted item
      for (const thing of thingsToDelete) {
        if (shouldEmitForType(cfg, thing.$type)) {
          const payload: ThingDeletedPayload = {
            $type: thing.$type,
            $id: thing.$id
          }
          await emitEvent('Thing.deleted', payload)
        }
      }
    }
  }
}

/**
 * Wrap a RelationshipsStore with automatic event emission
 */
export function withRelationshipEventSourcing<M extends StorableData = StorableData>(
  store: RelationshipsStore<M>,
  events: EventsStore<JsonValue>,
  config: Partial<EventSourcingConfig> = {},
  context: EventEmissionContext = {}
): RelationshipsStore<M> {
  const cfg: EventSourcingConfig = { ...defaultEventSourcingConfig, ...config }

  const emitEvent = async (type: CrudEventType, payload: CrudEventPayload) => {
    // Build event input, only including defined properties for exactOptionalPropertyTypes
    const eventInput: EventInput<JsonValue> = {
      type,
      payload,
    }
    if (context.auditContext?.actor !== undefined) {
      eventInput.source = context.auditContext.actor
    }
    if (context.auditContext?.correlationId !== undefined) {
      eventInput.correlationId = context.auditContext.correlationId
    }
    await events.emit(eventInput)
  }

  return {
    async add(rel) {
      const relationship = await store.add(rel)

      if (shouldEmitForPredicate(cfg, relationship.predicate)) {
        const payload: RelationshipCreatedPayload = {
          subject: relationship.subject as string,
          predicate: relationship.predicate,
          object: relationship.object as string
        }
        await emitEvent('Relationship.created', payload)
      }

      return relationship
    },

    async remove(rel) {
      await store.remove(rel)

      if (shouldEmitForPredicate(cfg, rel.predicate)) {
        const payload: RelationshipDeletedPayload = {
          subject: rel.subject as string,
          predicate: rel.predicate,
          object: rel.object as string
        }
        await emitEvent('Relationship.deleted', payload)
      }
    },

    async find(query) {
      return store.find(query)
    },

    async findWithCursor(options) {
      if (store.findWithCursor) {
        return store.findWithCursor(options)
      }
      // Fallback: implement using find
      const findQuery: Partial<Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>> = {}
      if (options?.subject !== undefined) {
        findQuery.subject = options.subject
      }
      if (options?.predicate !== undefined) {
        findQuery.predicate = options.predicate
      }
      if (options?.object !== undefined) {
        findQuery.object = options.object
      }
      const items = await store.find(findQuery)
      const limited = options?.limit ? items.slice(0, options.limit) : items
      return { items: limited, hasMore: false }
    },

    async getRelated(subjectId, predicate) {
      return store.getRelated(subjectId, predicate)
    },

    async getRelatedTo(objectId, predicate) {
      return store.getRelatedTo(objectId, predicate)
    }
  }
}

/**
 * Create an event-sourcing enabled ThingsStore from scratch
 * Convenience function that combines store creation and event sourcing
 */
export function createEventSourcedThingsStore<T extends StorableData = StorableData>(
  baseStoreFactory: () => ThingsStore<T>,
  events: EventsStore<JsonValue>,
  config?: Partial<EventSourcingConfig>,
  context?: EventEmissionContext
): ThingsStore<T> {
  return withEventSourcing(baseStoreFactory(), events, config, context)
}

/**
 * Create an event-sourcing enabled RelationshipsStore from scratch
 * Convenience function that combines store creation and event sourcing
 */
export function createEventSourcedRelationshipsStore<M extends StorableData = StorableData>(
  baseStoreFactory: () => RelationshipsStore<M>,
  events: EventsStore<JsonValue>,
  config?: Partial<EventSourcingConfig>,
  context?: EventEmissionContext
): RelationshipsStore<M> {
  return withRelationshipEventSourcing(baseStoreFactory(), events, config, context)
}
