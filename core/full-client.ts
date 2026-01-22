/**
 * @dotdo/core - Full Client Interface
 *
 * The complete DBClient that combines CRUD, Actions, and Events.
 * This is the full interface that all backends can implement.
 */

import type { DBClient } from './db-client'
import type { ActionsClient } from './actions'
import type { EventsClient } from './events'

// =============================================================================
// Full Client Interface
// =============================================================================

/**
 * DBClientFull - The complete database interface with Actions and Events
 *
 * This combines:
 * - DBClient - CRUD, Query, Relationships, Batch operations
 * - ActionsClient - Durable execution
 * - EventsClient - Immutable event log
 *
 * Backends can implement the full interface or just DBClient.
 *
 * @example
 * ```typescript
 * // Using the full client
 * const db: DBClientFull = createFullClient(storage)
 *
 * // CRUD operations
 * const user = await db.create({ ns: 'app', type: 'User', data: { name: 'Alice' } })
 *
 * // Actions for durable execution
 * const action = await db.createAction({
 *   type: 'User.sendWelcome',
 *   target: user.url,
 *   input: { template: 'welcome' }
 * })
 *
 * // Events for audit/history
 * const event = await db.emit({
 *   type: 'User.created',
 *   subject: user.url,
 *   data: { name: 'Alice' }
 * })
 * ```
 */
export interface DBClientFull extends DBClient, ActionsClient, EventsClient {}

/**
 * Create a full client from separate components
 *
 * @param dbClient - Base DBClient implementation
 * @param actionsClient - ActionsClient implementation
 * @param eventsClient - EventsClient implementation
 * @returns Combined DBClientFull
 */
export function combineClients(
  dbClient: DBClient,
  actionsClient: ActionsClient,
  eventsClient: EventsClient
): DBClientFull {
  const combined: DBClientFull = {
    // DBClient methods
    get: dbClient.get.bind(dbClient),
    getById: dbClient.getById.bind(dbClient),
    create: dbClient.create.bind(dbClient),
    update: dbClient.update.bind(dbClient),
    upsert: dbClient.upsert.bind(dbClient),
    delete: dbClient.delete.bind(dbClient),
    list: dbClient.list.bind(dbClient),
    find: dbClient.find.bind(dbClient),
    search: dbClient.search.bind(dbClient),
    count: dbClient.count.bind(dbClient),
    relate: dbClient.relate.bind(dbClient),
    unrelate: dbClient.unrelate.bind(dbClient),
    related: dbClient.related.bind(dbClient),
    references: dbClient.references.bind(dbClient),
    relationships: dbClient.relationships.bind(dbClient),
    batchGet: dbClient.batchGet.bind(dbClient),
    batchCreate: dbClient.batchCreate.bind(dbClient),

    // ActionsClient methods
    createAction: actionsClient.createAction.bind(actionsClient),
    getAction: actionsClient.getAction.bind(actionsClient),
    updateAction: actionsClient.updateAction.bind(actionsClient),
    findActions: actionsClient.findActions.bind(actionsClient),
    claimActions: actionsClient.claimActions.bind(actionsClient),

    // EventsClient methods
    emit: eventsClient.emit.bind(eventsClient),
    getEvent: eventsClient.getEvent.bind(eventsClient),
    queryEvents: eventsClient.queryEvents.bind(eventsClient),
    subscribeEvents: eventsClient.subscribeEvents.bind(eventsClient)
  }

  // Add optional DBClient methods
  if (dbClient.batchUpdate) {
    combined.batchUpdate = dbClient.batchUpdate.bind(dbClient)
  }
  if (dbClient.batchDelete) {
    combined.batchDelete = dbClient.batchDelete.bind(dbClient)
  }
  if (dbClient.close) {
    combined.close = dbClient.close.bind(dbClient)
  }

  // Add optional ActionsClient methods
  if (actionsClient.cancelAction) {
    combined.cancelAction = actionsClient.cancelAction.bind(actionsClient)
  }
  if (actionsClient.retryAction) {
    combined.retryAction = actionsClient.retryAction.bind(actionsClient)
  }
  if (actionsClient.getActionHistory) {
    combined.getActionHistory = actionsClient.getActionHistory.bind(actionsClient)
  }

  // Add optional EventsClient methods
  if (eventsClient.countEvents) {
    combined.countEvents = eventsClient.countEvents.bind(eventsClient)
  }

  return combined
}

// =============================================================================
// Type-Safe Collections
// =============================================================================

/**
 * Collection interface for type-safe entity access
 *
 * @example
 * ```typescript
 * interface User { name: string; email: string }
 *
 * const users = db.collection<User>('app', 'User')
 *
 * const alice = await users.create({ name: 'Alice', email: 'alice@example.com' })
 * const found = await users.find({ where: { email: 'alice@example.com' } })
 * ```
 */
export interface Collection<T> {
  /** Get by ID */
  get(id: string): Promise<T | null>

  /** Create a new entity */
  create(data: Omit<T, 'id'>): Promise<T>

  /** Update an entity */
  update(id: string, data: Partial<T>): Promise<T>

  /** Delete an entity */
  delete(id: string): Promise<boolean>

  /** Find entities */
  find(options?: { where?: Partial<T>; limit?: number; offset?: number }): Promise<T[]>

  /** Count entities */
  count(options?: { where?: Partial<T> }): Promise<number>
}

// =============================================================================
// DO Integration Interface
// =============================================================================

/**
 * Interface for DO class integration
 *
 * The DO class uses DBClientFull for all storage operations.
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env, { backend: 'db4' })
 *   }
 *
 *   async handleRequest(request: Request) {
 *     // Use this.db for all operations
 *     const user = await this.db.create({
 *       ns: this.ns,
 *       type: 'User',
 *       data: { name: 'Alice' }
 *     })
 *
 *     // Actions for background work
 *     await this.db.createAction({
 *       type: 'User.notify',
 *       target: user.url,
 *       input: { message: 'Welcome!' }
 *     })
 *
 *     return new Response(JSON.stringify(user))
 *   }
 * }
 * ```
 */
export interface DODatabaseConfig {
  /**
   * Database backend to use
   * - 'db4': Pure TypeScript columnar (default)
   * - 'sqlite': sql.js WASM
   * - 'postgres': PGlite WASM
   * - 'evodb': Columnar shredding
   * - 'mongo': MongoDB compatibility on postgres
   */
  backend?: 'db4' | 'sqlite' | 'postgres' | 'evodb' | 'mongo'

  /**
   * Namespace for this DO instance
   * Auto-derived from the DO name if not specified
   */
  ns?: string

  /**
   * Enable Actions system (default: true)
   */
  enableActions?: boolean

  /**
   * Enable Events system (default: true)
   */
  enableEvents?: boolean
}
