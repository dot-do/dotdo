// Entity Management - Integration of db stores into DO class
// See do-7rf.6.5

import {
  createThingsStore,
  createEventsStore,
  createRelationshipsStore,
  createQuery,
  type ThingsStore,
  type EventsStore,
  type RelationshipsStore,
  type Thing,
  type Event,
  type Relationship,
  type QueryBuilder
} from '../db'

/**
 * Entity Manager wraps the base stores and adds event emission on entity changes
 */
export class EntityManager {
  private _things: ThingsStore
  private _events: EventsStore
  private _relationships: RelationshipsStore

  constructor() {
    this._things = createThingsStore()
    this._events = createEventsStore()
    this._relationships = createRelationshipsStore()
  }

  /**
   * Things store with event emission
   */
  get things(): ThingsStore {
    const baseStore = this._things
    const eventsStore = this._events

    return {
      async create(data: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>): Promise<Thing> {
        const thing = await baseStore.create(data)

        // Emit Thing.created event
        await eventsStore.emit({
          type: 'Thing.created',
          payload: thing,
          source: thing.$id
        })

        return thing
      },

      async get(id: string): Promise<Thing | null> {
        return baseStore.get(id)
      },

      async update(id: string, data: Partial<Omit<Thing, '$id' | '$type'>>): Promise<Thing> {
        const thing = await baseStore.update(id, data)

        // Emit Thing.updated event
        await eventsStore.emit({
          type: 'Thing.updated',
          payload: thing,
          source: thing.$id
        })

        return thing
      },

      async delete(id: string): Promise<void> {
        const thing = await baseStore.get(id)
        await baseStore.delete(id)

        // Emit Thing.deleted event
        if (thing) {
          await eventsStore.emit({
            type: 'Thing.deleted',
            payload: { $id: id, $type: thing.$type },
            source: id
          })
        }
      },

      async list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]> {
        return baseStore.list(options)
      }
    }
  }

  /**
   * Events store (direct access, no wrapping needed)
   */
  get events(): EventsStore {
    return this._events
  }

  /**
   * Relationships store with event emission
   */
  get relationships(): RelationshipsStore {
    const baseStore = this._relationships
    const eventsStore = this._events

    return {
      async add(rel: Omit<Relationship, '$createdAt'>): Promise<Relationship> {
        const relationship = await baseStore.add(rel)

        // Emit Relationship.added event
        await eventsStore.emit({
          type: 'Relationship.added',
          payload: relationship,
          source: relationship.subject
        })

        return relationship
      },

      async remove(rel: Pick<Relationship, 'subject' | 'predicate' | 'object'>): Promise<void> {
        await baseStore.remove(rel)

        // Emit Relationship.removed event
        await eventsStore.emit({
          type: 'Relationship.removed',
          payload: rel,
          source: rel.subject
        })
      },

      async find(query: Partial<Pick<Relationship, 'subject' | 'predicate' | 'object'>>): Promise<Relationship[]> {
        return baseStore.find(query)
      },

      async getRelated(subjectId: string, predicate: string): Promise<string[]> {
        return baseStore.getRelated(subjectId, predicate)
      },

      async getRelatedTo(objectId: string, predicate: string): Promise<string[]> {
        return baseStore.getRelatedTo(objectId, predicate)
      }
    }
  }

  /**
   * Query builder factory
   */
  query(): QueryBuilder {
    return createQuery(this.things)
  }
}

/**
 * Mixin to add entity management to DO classes
 */
export function withEntities<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base {
    private entityManager: EntityManager

    constructor(...args: any[]) {
      super(...args)
      this.entityManager = new EntityManager()
    }

    get things(): ThingsStore {
      return this.entityManager.things
    }

    get events(): EventsStore {
      return this.entityManager.events
    }

    get relationships(): RelationshipsStore {
      return this.entityManager.relationships
    }

    query(): QueryBuilder {
      return this.entityManager.query()
    }
  }
}
