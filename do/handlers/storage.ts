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
 * ## Cloudflare DO Storage Limits
 *
 * All storage operations are subject to Cloudflare Durable Object limits:
 * - **128 MB** memory per DO instance (isolate terminated if exceeded)
 * - **10 GB** total persistent storage per DO
 * - **128 KB** maximum value size per `state.storage.put()` call
 * - **2 KB** maximum key size
 * - **1000** max entries per `state.storage.list()` call (paginate with `startAfter`)
 * - **128** max keys per batch `get()` or `put()` call
 *
 * Use {@link StorageGuard} from `../storage-limits` to validate operations
 * before they execute.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 * @module do/handlers/storage
 */

import { EntityManager, type EntityManagerOptions } from '../entities'
import {
  MemoryStorageAdapter,
} from '@dotdo/db'
import type {
  ThingsStore,
  EventsStore,
  RelationshipsStore,
  AuditLogStore,
  AuditContext,
  QueryBuilder,
  StorableData,
} from '@dotdo/db'
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
 * By default, creates a shared MemoryStorageAdapter for all stores,
 * enabling atomic multi-operation transactions via withTransaction() (do-9mrsg).
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
 * // Atomic transaction across stores
 * await handler.withTransaction(async () => {
 *   const customer = await handler.things.create({ $type: 'Customer', name: 'Alice' })
 *   await handler.relationships.add({
 *     subject: customer.$id,
 *     predicate: 'belongs_to',
 *     object: orgId
 *   })
 * })
 * ```
 */
export class StorageHandler implements DOHandler {
  readonly name = 'storage'
  private entityManager: EntityManager

  constructor(options: StorageHandlerOptions = {}) {
    // Default to a shared MemoryStorageAdapter if no adapter provided (do-9mrsg)
    // This enables withTransaction() to work out of the box
    const effectiveOptions: EntityManagerOptions = {
      ...options,
      adapter: options.adapter ?? new MemoryStorageAdapter(),
    }
    this.entityManager = new EntityManager(effectiveOptions)
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

  /**
   * Execute a function within an atomic transaction (do-9mrsg).
   *
   * All store operations (things, events, relationships) performed inside the
   * callback will either all succeed or all be rolled back if an error occurs.
   *
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   *
   * @example
   * ```typescript
   * await handler.withTransaction(async () => {
   *   const customer = await handler.things.create({ $type: 'Customer', name: 'Alice' })
   *   await handler.relationships.add({
   *     subject: customer.$id,
   *     predicate: 'belongs_to',
   *     object: orgId
   *   })
   * })
   * ```
   */
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.entityManager.withTransaction(fn)
  }

  /**
   * Check if a transaction is currently in progress.
   */
  get inTransaction(): boolean {
    return this.entityManager.inTransaction
  }
}
