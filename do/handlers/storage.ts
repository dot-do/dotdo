/**
 * Storage Handler
 *
 * Handles all storage-related operations for a DO:
 * - Things (entities) CRUD operations
 * - Events store for event sourcing
 * - Relationships store for graph-like relationships
 * - Audit logging
 * - Query building
 *
 * @module do/handlers/storage
 */

import { EntityManager, type EntityManagerOptions } from '../entities'
import type {
  ThingsStore,
  EventsStore,
  RelationshipsStore,
  AuditLogStore,
  AuditContext,
  QueryBuilder,
  StorableData,
} from '../../db'
import type { DOHandler } from './registry'

/**
 * Options for creating a StorageHandler
 */
export interface StorageHandlerOptions extends EntityManagerOptions {}

/**
 * Handler for all storage operations in a DO.
 *
 * Delegates to EntityManager for actual storage operations.
 * Provides a clean interface for the DO class.
 *
 * @example
 * ```typescript
 * const handler = new StorageHandler({ state })
 *
 * // Create a thing
 * const customer = await handler.things.create({
 *   $type: 'Customer',
 *   name: 'Alice'
 * })
 *
 * // Query things
 * const results = handler.query()
 *   .where('$type', '=', 'Customer')
 *   .limit(10)
 *   .execute()
 * ```
 */
export class StorageHandler implements DOHandler {
  readonly name = 'storage'
  private entityManager: EntityManager

  constructor(options: StorageHandlerOptions = {}) {
    this.entityManager = new EntityManager(options)
  }

  /**
   * Things store for entity CRUD operations.
   *
   * @example
   * ```typescript
   * const customer = await handler.things.create({
   *   $type: 'Customer',
   *   name: 'Alice',
   *   email: 'alice@example.com'
   * })
   * ```
   */
  get things(): ThingsStore {
    return this.entityManager.things
  }

  /**
   * Events store for immutable event logging and querying.
   *
   * @example
   * ```typescript
   * await handler.events.emit({
   *   type: 'Customer.signup',
   *   payload: { customerId: '123' }
   * })
   * ```
   */
  get events(): EventsStore {
    return this.entityManager.events
  }

  /**
   * Relationships store for subject-predicate-object triples.
   *
   * @example
   * ```typescript
   * await handler.relationships.add({
   *   subject: customerId,
   *   predicate: 'owns',
   *   object: orderId
   * })
   * ```
   */
  get relationships(): RelationshipsStore {
    return this.entityManager.relationships
  }

  /**
   * Audit log store for tracking entity changes.
   *
   * @example
   * ```typescript
   * const logs = await handler.auditLogs.query({ entityId: customerId })
   * ```
   */
  get auditLogs(): AuditLogStore {
    return this.entityManager.auditLogs
  }

  /**
   * Set the audit context for tracking who performed actions.
   * Call this at the start of request handling.
   */
  setAuditContext(context: AuditContext): void {
    this.entityManager.setAuditContext(context)
  }

  /**
   * Get the current audit context.
   */
  getAuditContext(): AuditContext {
    return this.entityManager.getAuditContext()
  }

  /**
   * Create a query builder for cross-entity queries.
   *
   * @example
   * ```typescript
   * const results = handler.query()
   *   .from('things')
   *   .where('$type', '=', 'Customer')
   *   .orderBy('$createdAt', 'desc')
   *   .limit(10)
   *   .execute()
   * ```
   */
  query<T extends StorableData = StorableData>(): QueryBuilder<T> {
    return this.entityManager.query<T>()
  }
}
