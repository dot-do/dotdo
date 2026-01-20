// Entity Management - Integration of db stores into DO class
// See do-7rf.6.5 and do-xebw (audit logging)
// SQLite storage integration added per do-8m4e

import {
  createThingsStore,
  createEventsStore,
  createRelationshipsStore,
  createQuery,
  createAuditLogStore,
  // SQLite store creators for persistent storage (do-8m4e)
  SQLiteAdapter,
  createSQLiteThingsStore,
  createSQLiteEventsStore,
  createSQLiteRelationshipsStore,
  createSQLiteAuditLogStore,
  type ThingsStore,
  type EventsStore,
  type RelationshipsStore,
  type AuditLogStore,
  type AuditContext,
  type AuditLogConfig,
  type Thing,
  type Relationship,
  type BaseRelationship,
  type RelationshipQuery,
  type RelationshipInput,
  type QueryBuilder,
  type StorableData,
  type BulkUpdateItem,
  type SqlStorage,
  defaultAuditConfig,
  maskSensitiveFields
} from '@dotdo/db'

/**
 * Options for EntityManager
 */
export interface EntityManagerOptions {
  /** Audit logging configuration */
  auditConfig?: Partial<AuditLogConfig>
  /**
   * DurableObjectState for SQLite persistence (do-8m4e)
   * When provided, stores will use SQLite via state.storage.sql
   * When omitted, falls back to in-memory stores for backward compatibility
   */
  state?: DurableObjectState
}

/**
 * Entity Manager wraps the base stores and adds event emission on entity changes
 * Also provides audit logging for all CRUD operations (do-xebw)
 *
 * When constructed with a DurableObjectState, uses SQLite storage for persistence (do-8m4e).
 * When constructed without state, uses in-memory stores (backward compatible).
 */
export class EntityManager {
  private _things: ThingsStore
  private _events: EventsStore
  private _relationships: RelationshipsStore
  private _auditLogs: AuditLogStore
  private _auditConfig: AuditLogConfig
  private _auditContext: AuditContext
  private _sqliteAdapter?: SQLiteAdapter
  private _initialized: boolean = false
  private _initPromise?: Promise<void>

  constructor(options: EntityManagerOptions = {}) {
    if (options.state?.storage?.sql) {
      // Use SQLite stores for persistent storage (do-8m4e)
      this._sqliteAdapter = new SQLiteAdapter(options.state.storage.sql as SqlStorage)
      this._things = createSQLiteThingsStore(this._sqliteAdapter)
      this._events = createSQLiteEventsStore(this._sqliteAdapter)
      this._relationships = createSQLiteRelationshipsStore(this._sqliteAdapter)
      this._auditLogs = createSQLiteAuditLogStore(this._sqliteAdapter)

      // Initialize SQLite adapter asynchronously
      // The stores will handle initialization lazily if needed
      this._initPromise = this._sqliteAdapter.initialize().then(() => {
        this._initialized = true
      })
    } else {
      // Fall back to in-memory stores for backward compatibility
      this._things = createThingsStore()
      this._events = createEventsStore()
      this._relationships = createRelationshipsStore()
      this._auditLogs = createAuditLogStore()
      this._initialized = true
    }
    this._auditConfig = { ...defaultAuditConfig, ...options.auditConfig }
    this._auditContext = { actor: 'system' }
  }

  /**
   * Ensure SQLite is initialized before operations
   * This is called internally to handle the async initialization
   */
  private async ensureInitialized(): Promise<void> {
    if (this._initPromise) {
      await this._initPromise
    }
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
   * Audit logs store with initialization guarantee
   */
  get auditLogs(): AuditLogStore {
    const baseStore = this._auditLogs
    const ensureInit = () => this.ensureInitialized()

    return {
      async log(entry) {
        await ensureInit()
        return baseStore.log(entry)
      },
      async get(id: string) {
        await ensureInit()
        return baseStore.get(id)
      },
      async query(options?) {
        await ensureInit()
        return baseStore.query(options)
      },
      async count(options?) {
        await ensureInit()
        return baseStore.count(options)
      }
    }
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

    // Ensure initialization before logging
    await this.ensureInitialized()

    // Mask sensitive fields in details
    const maskedDetails = details
      ? maskSensitiveFields(details, this._auditConfig.maskFields)
      : undefined

    await this._auditLogs.log({
      actor: this._auditContext.actor,
      action,
      resource,
      resourceId,
      level,
      details: maskedDetails,
      correlationId: this._auditContext.correlationId
    })
  }

  /**
   * Things store with event emission and audit logging
   * Includes bulk operations with audit logging (do-grp5.8)
   */
  get things(): ThingsStore {
    const baseStore = this._things
    const eventsStore = this._events
    const logAudit = this.logAudit.bind(this)
    const ensureInit = () => this.ensureInitialized()

    return {
      async create(data) {
        await ensureInit()
        const thing = await baseStore.create(data)

        // Emit Thing.created event
        await eventsStore.emit({
          type: 'Thing.created',
          payload: thing,
          source: thing.$id
        })

        // Audit log - safely access name if it exists
        const auditDetails: StorableData | undefined = 'name' in thing
          ? { name: String((thing as Record<string, unknown>)['name']) }
          : undefined
        await logAudit('create', thing.$type, thing.$id, auditDetails)

        return thing
      },

      async get(id: string): Promise<Thing | null> {
        await ensureInit()
        return baseStore.get(id)
      },

      async getMany(ids: string[]): Promise<Map<string, Thing>> {
        await ensureInit()
        return baseStore.getMany(ids)
      },

      async update(id, data) {
        await ensureInit()
        const thing = await baseStore.update(id, data)

        // Emit Thing.updated event
        await eventsStore.emit({
          type: 'Thing.updated',
          payload: thing,
          source: thing.$id
        })

        // Audit log
        await logAudit('update', thing.$type, thing.$id, { fields: Object.keys(data) })

        return thing
      },

      async delete(id: string): Promise<void> {
        await ensureInit()
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
        await ensureInit()
        return baseStore.list(options)
      },

      async listWithCursor(options) {
        await ensureInit()
        return baseStore.listWithCursor(options)
      },

      async bulkCreate(items) {
        await ensureInit()
        const things = await baseStore.bulkCreate(items)

        // Emit Thing.created events for each created thing
        for (const thing of things) {
          await eventsStore.emit({
            type: 'Thing.created',
            payload: thing,
            source: thing.$id
          })
        }

        // Audit log for bulk create
        await logAudit('bulk_create', 'Thing', undefined, {
          count: things.length,
          types: [...new Set(things.map(t => t.$type))],
          ids: things.map(t => t.$id)
        })

        return things
      },

      async bulkUpdate(items: BulkUpdateItem[]): Promise<Thing[]> {
        await ensureInit()
        const things = await baseStore.bulkUpdate(items)

        // Emit Thing.updated events for each updated thing
        for (const thing of things) {
          await eventsStore.emit({
            type: 'Thing.updated',
            payload: thing,
            source: thing.$id
          })
        }

        // Audit log for bulk update
        await logAudit('bulk_update', 'Thing', undefined, {
          count: things.length,
          ids: items.map(i => String(i.id)),
          fields: [...new Set(items.flatMap(i => Object.keys(i.data)))]
        })

        return things
      },

      async bulkDelete(ids: string[]): Promise<void> {
        await ensureInit()
        // Get things before deletion for event emission and audit
        const thingsMap = new Map<string, Thing>()
        for (const id of ids) {
          const thing = await baseStore.get(id)
          if (thing) {
            thingsMap.set(id, thing)
          }
        }

        await baseStore.bulkDelete(ids)

        // Emit Thing.deleted events for each deleted thing
        for (const [id, thing] of thingsMap) {
          await eventsStore.emit({
            type: 'Thing.deleted',
            payload: { $id: id, $type: thing.$type },
            source: id
          })
        }

        // Audit log for bulk delete
        const types = [...new Set([...thingsMap.values()].map(t => t.$type))]
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
    const ensureInit = () => this.ensureInitialized()

    return {
      async add(rel: RelationshipInput): Promise<Relationship> {
        await ensureInit()
        const relationship = await baseStore.add(rel)

        // Emit Relationship.added event
        await eventsStore.emit({
          type: 'Relationship.added',
          payload: relationship,
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
        await ensureInit()
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
        await ensureInit()
        return baseStore.find(query)
      },

      async findWithCursor(options) {
        await ensureInit()
        return baseStore.findWithCursor(options)
      },

      async getRelated(subjectId: string, predicate: string): Promise<string[]> {
        await ensureInit()
        return baseStore.getRelated(subjectId, predicate)
      },

      async getRelatedTo(objectId: string, predicate: string): Promise<string[]> {
        await ensureInit()
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
 * Constructor type for mixin pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntityMixinConstructor = new (...args: unknown[]) => object

/**
 * Mixin to add entity management to DO classes
 */
export function withEntities<T extends EntityMixinConstructor>(Base: T) {
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

    get auditLogs(): AuditLogStore {
      return this.entityManager.auditLogs
    }

    setAuditContext(context: AuditContext): void {
      this.entityManager.setAuditContext(context)
    }

    getAuditContext(): AuditContext {
      return this.entityManager.getAuditContext()
    }

    query<T extends StorableData = StorableData>(): QueryBuilder<T> {
      return this.entityManager.query<T>()
    }
  }
}
