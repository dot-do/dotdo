/**
 * Storage Mixin for Durable Objects
 *
 * Provides composable storage functionality including:
 * - Things store (entities with CRUD operations)
 * - Events store (event sourcing)
 * - Relationships store (graph-like relationships)
 * - Audit logging
 * - Query builder
 *
 * @example
 * ```typescript
 * class MyDO extends WithStorage(BaseDO) {
 *   async handleCreate(data: unknown) {
 *     // this.things, this.events, this.relationships are available
 *     const thing = await this.things.create({ $type: 'Customer', ...data })
 *     return thing
 *   }
 * }
 * ```
 *
 * @module do/mixins/storage
 */

import { EntityManager, type EntityManagerOptions } from '../entities'
import type {
  ThingsStore,
  EventsStore,
  RelationshipsStore,
  AuditLogStore,
  AuditContext,
  QueryBuilder,
  StorableData
} from '../../db'

// =============================================================================
// Types
// =============================================================================

/**
 * Constructor type for mixin pattern.
 * The `any[]` is required by TypeScript's mixin pattern (TS2545) - more specific
 * constructor signatures cannot be composed with arbitrary base classes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Interface for classes that have storage capabilities
 */
export interface HasStorage {
  /** Things (entities) store */
  readonly things: ThingsStore
  /** Events store */
  readonly events: EventsStore
  /** Relationships store */
  readonly relationships: RelationshipsStore
  /** Audit logs store */
  readonly auditLogs: AuditLogStore
  /** Set audit context for tracking who performed actions */
  setAuditContext(context: AuditContext): void
  /** Get current audit context */
  getAuditContext(): AuditContext
  /** Create a query builder */
  query<T extends StorableData>(): QueryBuilder<T>
}

/**
 * Options for the WithStorage mixin
 */
export interface WithStorageOptions {
  /** Entity manager configuration */
  entityManagerOptions?: EntityManagerOptions
}

// =============================================================================
// Mixin Implementation
// =============================================================================

/**
 * Storage mixin that adds Things, Events, Relationships, and Audit Logging
 * to a Durable Object base class.
 *
 * This mixin provides:
 * - `this.things` - CRUD operations for entities
 * - `this.events` - Event sourcing and emission
 * - `this.relationships` - Graph-like relationships between entities
 * - `this.auditLogs` - Audit logging for compliance and debugging
 * - `this.query()` - Fluent query builder
 *
 * @template TBase - The base class constructor type
 * @param Base - The base class to extend
 * @param options - Optional configuration for the entity manager
 * @returns A new class with storage capabilities
 *
 * @example
 * ```typescript
 * // Basic usage
 * class MyDO extends WithStorage(BaseDO) {
 *   async createCustomer(name: string) {
 *     return this.things.create({ $type: 'Customer', name })
 *   }
 * }
 *
 * // With options
 * class AuditedDO extends WithStorage(BaseDO, {
 *   entityManagerOptions: {
 *     auditConfig: { enabled: true, retentionDays: 90 }
 *   }
 * }) {
 *   // ...
 * }
 *
 * // Composing with other mixins
 * class FullFeatureDO extends WithStorage(WithWebSocket(BaseDO)) {
 *   // Has both storage and websocket capabilities
 * }
 * ```
 */
export function WithStorage<TBase extends Constructor>(
  Base: TBase,
  options: WithStorageOptions = {}
) {
  return class StorageMixin extends Base implements HasStorage {
    private _entityManager: EntityManager

    // Mixin constructors must use `any[]` to accept arbitrary base class constructor args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this._entityManager = new EntityManager(options.entityManagerOptions)
    }

    /**
     * Access to the Things store for entity CRUD operations
     *
     * @example
     * ```typescript
     * // Create a thing
     * const customer = await this.things.create({
     *   $type: 'Customer',
     *   name: 'Alice',
     *   email: 'alice@example.com'
     * })
     *
     * // Get a thing by ID
     * const thing = await this.things.get(customer.$id)
     *
     * // Update a thing
     * await this.things.update(customer.$id, { name: 'Alice Smith' })
     *
     * // Delete a thing
     * await this.things.delete(customer.$id)
     *
     * // List things
     * const customers = await this.things.list({ type: 'Customer', limit: 10 })
     * ```
     */
    get things(): ThingsStore {
      return this._entityManager.things
    }

    /**
     * Access to the Events store for event sourcing
     *
     * @example
     * ```typescript
     * // Emit an event
     * await this.events.emit({
     *   type: 'Customer.created',
     *   payload: { customerId: 'cust-123', name: 'Alice' },
     *   source: 'CustomerDO'
     * })
     *
     * // Query events
     * const events = await this.events.query({
     *   type: 'Customer.created',
     *   after: new Date('2024-01-01').getTime()
     * })
     * ```
     */
    get events(): EventsStore {
      return this._entityManager.events
    }

    /**
     * Access to the Relationships store for graph-like relationships
     *
     * @example
     * ```typescript
     * // Add a relationship
     * await this.relationships.add({
     *   subject: 'user-123',
     *   predicate: 'owns',
     *   object: 'document-456'
     * })
     *
     * // Find related objects
     * const documents = await this.relationships.getRelated('user-123', 'owns')
     *
     * // Find subjects that relate to an object
     * const owners = await this.relationships.getRelatedTo('document-456', 'owns')
     *
     * // Remove a relationship
     * await this.relationships.remove({
     *   subject: 'user-123',
     *   predicate: 'owns',
     *   object: 'document-456'
     * })
     * ```
     */
    get relationships(): RelationshipsStore {
      return this._entityManager.relationships
    }

    /**
     * Access to the Audit Logs store for compliance and debugging
     *
     * @example
     * ```typescript
     * // Query audit logs
     * const logs = await this.auditLogs.query({
     *   actor: 'user-123',
     *   action: 'create',
     *   resource: 'Customer',
     *   after: new Date('2024-01-01').getTime()
     * })
     * ```
     */
    get auditLogs(): AuditLogStore {
      return this._entityManager.auditLogs
    }

    /**
     * Set the audit context for tracking who performed actions.
     * Call this at the start of request handling.
     *
     * @example
     * ```typescript
     * async fetch(request: Request) {
     *   // Extract user info from JWT or headers
     *   const userId = extractUserId(request)
     *
     *   // Set audit context for this request
     *   this.setAuditContext({
     *     actor: userId,
     *     correlationId: request.headers.get('X-Correlation-ID')
     *   })
     *
     *   // All subsequent operations will be logged with this context
     *   await this.things.create({ ... })
     * }
     * ```
     */
    setAuditContext(context: AuditContext): void {
      this._entityManager.setAuditContext(context)
    }

    /**
     * Get the current audit context
     */
    getAuditContext(): AuditContext {
      return this._entityManager.getAuditContext()
    }

    /**
     * Create a fluent query builder for complex queries
     *
     * @example
     * ```typescript
     * // Build complex queries
     * const results = await this.query<Customer>()
     *   .where('status', '=', 'active')
     *   .where('createdAt', '>', lastMonth)
     *   .orderBy('name', 'asc')
     *   .limit(10)
     *   .execute()
     * ```
     */
    query<T extends StorableData = StorableData>(): QueryBuilder<T> {
      return this._entityManager.query<T>()
    }
  }
}

/**
 * Type helper to extract the instance type of a mixin result.
 * The `any[]` is required by TypeScript's conditional type inference for constructor types.
 *
 * @example
 * ```typescript
 * type MyDOInstance = MixinInstance<typeof WithStorage<typeof BaseDO>>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MixinInstance<T> = T extends new (...args: any[]) => infer R ? R : never
