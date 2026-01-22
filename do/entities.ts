// Entity Management - Integration of db stores into DO class
// See do-7rf.6.5 and do-xebw (audit logging)

import {
  createThingsStoreWithAdapter,
  createEventsStore,
  createRelationshipsStore,
  createQuery,
  createAuditLogStore,
  MemoryStorageAdapter,
  defaultAuditConfig,
  maskSensitiveFields,
  toJsonObject,
} from '@dotdo/db'
import type {
  ThingsStore,
  EventsStore,
  RelationshipsStore,
  AuditLogStore,
  AuditContext,
  AuditLogConfig,
  Thing,
  Relationship,
  BaseRelationship,
  RelationshipQuery,
  RelationshipInput,
  QueryBuilder,
  StorableData,
  BulkUpdateItem,
} from '@dotdo/db'

/**
 * Options for EntityManager
 */
export interface EntityManagerOptions {
  /** Audit logging configuration */
  auditConfig?: Partial<AuditLogConfig>
}

/**
 * Entity Manager wraps the base stores and adds event emission on entity changes
 * Also provides audit logging for all CRUD operations (do-xebw)
 */
export class EntityManager {
  private _things: ThingsStore
  private _events: EventsStore
  private _relationships: RelationshipsStore
  private _auditLogs: AuditLogStore
  private _auditConfig: AuditLogConfig
  private _auditContext: AuditContext

  constructor(options: EntityManagerOptions = {}) {
    // Use adapter-based store (do-xjmbd migration from deprecated createThingsStore)
    this._things = createThingsStoreWithAdapter(new MemoryStorageAdapter())
    this._events = createEventsStore()
    this._relationships = createRelationshipsStore()
    this._auditLogs = createAuditLogStore()
    this._auditConfig = { ...defaultAuditConfig, ...options.auditConfig }
    this._auditContext = { actor: 'system' }
  }

  /**
   * Set the audit context for subsequent operations
   * Call this at the start of request handling
   */
  setAuditContext(context: AuditContext): void {
    this._auditContext = context
  }

  /**
   * Get the current audit context
   */
  getAuditContext(): AuditContext {
    return this._auditContext
  }

  /**
   * Direct access to audit logs store
   */
  get auditLogs(): AuditLogStore {
    return this._auditLogs
  }

  /**
   * Helper to log audit entries if enabled
   */
  private async logAudit<T extends StorableData = StorableData>(
    action: string,
    resource: string,
    resourceId?: string,
    details?: Partial<T>,
    level: 'info' | 'warn' | 'error' | 'security' = 'info'
  ): Promise<void> {
    if (!this._auditConfig.enabled) return

    // Mask sensitive fields in details
    const maskedDetails = details
      ? maskSensitiveFields(details, this._auditConfig.maskFields)
      : undefined

    await this._auditLogs.log({
      actor: this._auditContext.actor,
      action,
      resource,
      ...(resourceId !== undefined && { resourceId }),
      level,
      ...(maskedDetails !== undefined && { details: maskedDetails }),
      ...(this._auditContext.correlationId !== undefined && { correlationId: this._auditContext.correlationId }),
    })
  }

  /**
   * Things store with event emission and audit logging
   */
  get things(): ThingsStore {
    const baseStore = this._things
    const eventsStore = this._events
    const logAudit = this.logAudit.bind(this)

    return {
      async create<D extends Partial<StorableData> & { $type: string }>(data: D) {
        const thing = await baseStore.create(data)

        // Emit Thing.created event
        // Use toJsonObject to safely convert Thing to JsonValue (strips undefined)
        await eventsStore.emit({
          type: 'Thing.created',
          payload: toJsonObject(thing),
          source: thing.$id
        })

        // Audit log
        await logAudit('create', thing.$type, thing.$id, { name: (thing as Record<string, unknown>)['name'] as string })

        return thing
      },

      async get(id: string): Promise<Thing | null> {
        return baseStore.get(id)
      },

      async update(id: string, data: Partial<Omit<Thing, '$id' | '$type'>>): Promise<Thing> {
        const thing = await baseStore.update(id, data)

        // Emit Thing.updated event
        // Use toJsonObject to safely convert Thing to JsonValue (strips undefined)
        await eventsStore.emit({
          type: 'Thing.updated',
          payload: toJsonObject(thing),
          source: thing.$id
        })

        // Audit log
        await logAudit('update', thing.$type, thing.$id, { fields: Object.keys(data) })

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

          // Audit log
          await logAudit('delete', thing.$type, id)
        }
      },

      async list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]> {
        return baseStore.list(options)
      },

      async bulkCreate<D extends Partial<StorableData> & { $type: string }>(things: D[]) {
        const created = await baseStore.bulkCreate(things)

        // Emit individual events for each created thing
        for (const thing of created) {
          // Use toJsonObject to safely convert Thing to JsonValue (strips undefined)
          await eventsStore.emit({
            type: 'Thing.created',
            payload: toJsonObject(thing),
            source: thing.$id
          })
        }

        // Log a single bulk audit entry
        const types = [...new Set(created.map(t => t.$type))]
        const ids = created.map(t => t.$id)
        await logAudit('bulk_create', 'Thing', undefined, {
          count: created.length,
          types,
          ids
        })

        return created
      },

      async bulkUpdate(items: BulkUpdateItem<StorableData>[]) {
        const updated = await baseStore.bulkUpdate(items)

        // Emit individual events for each updated thing
        for (const thing of updated) {
          // Use toJsonObject to safely convert Thing to JsonValue (strips undefined)
          await eventsStore.emit({
            type: 'Thing.updated',
            payload: toJsonObject(thing),
            source: thing.$id
          })
        }

        // Log a single bulk audit entry
        const ids = updated.map(t => t.$id)
        const allFields = new Set<string>()
        for (const item of items) {
          Object.keys(item.data).forEach(f => allFields.add(f))
        }
        await logAudit('bulk_update', 'Thing', undefined, {
          count: updated.length,
          ids,
          fields: [...allFields]
        })

        return updated
      },

      async bulkDelete(ids: string[]) {
        // Get things before deletion to capture types
        const things: (Thing | null)[] = []
        for (const id of ids) {
          things.push(await baseStore.get(id))
        }

        await baseStore.bulkDelete(ids)

        // Emit individual events for each deleted thing
        for (let i = 0; i < ids.length; i++) {
          const thing = things[i]
          if (thing) {
            await eventsStore.emit({
              type: 'Thing.deleted',
              payload: { $id: ids[i], $type: thing.$type },
              source: ids[i]
            })
          }
        }

        // Log a single bulk audit entry
        const deletedThings = things.filter((t): t is Thing => t !== null)
        const types = [...new Set(deletedThings.map(t => t.$type))]
        await logAudit('bulk_delete', 'Thing', undefined, {
          count: ids.length,
          ids,
          types
        })
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
   * Relationships store with event emission and audit logging
   */
  get relationships(): RelationshipsStore {
    const baseStore = this._relationships
    const eventsStore = this._events
    const logAudit = this.logAudit.bind(this)

    return {
      async add(rel: RelationshipInput): Promise<Relationship> {
        const relationship = await baseStore.add(rel)

        // Emit Relationship.added event
        // Relationship has only primitive fields so it's safe to use toJsonObject
        await eventsStore.emit({
          type: 'Relationship.added',
          payload: toJsonObject(relationship as StorableData),
          source: relationship.subject
        })

        // Audit log
        await logAudit('create', 'Relationship', undefined, {
          subject: rel.subject,
          predicate: rel.predicate,
          object: rel.object
        })

        return relationship
      },

      async remove(rel: Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>): Promise<void> {
        await baseStore.remove(rel)

        // Emit Relationship.removed event
        await eventsStore.emit({
          type: 'Relationship.removed',
          payload: rel,
          source: rel.subject
        })

        // Audit log
        await logAudit('delete', 'Relationship', undefined, {
          subject: rel.subject,
          predicate: rel.predicate,
          object: rel.object
        })
      },

      async find(query: RelationshipQuery): Promise<Relationship[]> {
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
  query<T extends StorableData = StorableData>(): QueryBuilder<T> {
    return createQuery<T>(this.things)
  }
}

/**
 * Mixin to add entity management to DO classes
 */
// TypeScript mixin pattern requires `any` for constructor type parameters (TS2545)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withEntities<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base {
    /**
     * @internal Entity manager instance - use public accessors (things, events, relationships) instead
     */
    _entityManager: EntityManager

    // Mixin constructors must use `any[]` to accept arbitrary base class constructor args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this._entityManager = new EntityManager()
    }

    get things(): ThingsStore {
      return this._entityManager.things
    }

    get events(): EventsStore {
      return this._entityManager.events
    }

    get relationships(): RelationshipsStore {
      return this._entityManager.relationships
    }

    get auditLogs(): AuditLogStore {
      return this._entityManager.auditLogs
    }

    setAuditContext(context: AuditContext): void {
      this._entityManager.setAuditContext(context)
    }

    getAuditContext(): AuditContext {
      return this._entityManager.getAuditContext()
    }

    query<T extends StorableData = StorableData>(): QueryBuilder<T> {
      return this._entityManager.query<T>()
    }
  }
}
