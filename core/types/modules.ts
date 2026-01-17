/**
 * DOCore Module Interfaces - Type-safe contracts for extracted modules
 *
 * This file defines clean interfaces for all DOCore submodules:
 * - {@link IStorage}: Thing CRUD operations (DOCoreStorage)
 * - {@link ISchedule}: Schedule management (DOCoreSchedule)
 * - {@link IEvents}: Event emission and subscription (DOCoreEvents)
 *
 * ## Architecture
 *
 * DOCore delegates to these modules via lazy initialization:
 * ```
 * DOCore (coordinator)
 *   ├── IStorage  → DOCoreStorage  (Thing CRUD, LRU cache, SQLite)
 *   ├── ISchedule → DOCoreSchedule (CRON, fluent DSL, alarms)
 *   └── IEvents   → DOCoreEvents   (emit, subscribe, wildcards)
 * ```
 *
 * ## Design Principles
 *
 * 1. **Separation of Concerns**: Each module handles a single domain
 * 2. **RPC Compatibility**: All methods are async with JSON-serializable params/returns
 * 3. **Dependency Injection**: DOCore can use any implementation of these interfaces
 * 4. **Testability**: Interfaces enable easy mocking and unit testing
 * 5. **Event-Driven**: Storage mutations emit events through IEvents
 *
 * ## Usage
 *
 * @example
 * ```typescript
 * // DOCore uses these interfaces for delegation
 * class DOCore {
 *   private _storage: IStorage | null = null
 *   private _schedule: ISchedule | null = null
 *   private _events: IEvents | null = null
 *
 *   get storage(): IStorage {
 *     if (!this._storage) {
 *       this._storage = new DOCoreStorage(this.ctx)
 *     }
 *     return this._storage
 *   }
 * }
 *
 * // Modules implement these interfaces
 * class DOCoreStorage extends RpcTarget implements IStorage { ... }
 * class DOCoreSchedule extends RpcTarget implements ISchedule { ... }
 * class DOCoreEvents extends RpcTarget implements IEvents { ... }
 * ```
 *
 * @module core/types/modules
 * @packageDocumentation
 */

import type { ThingData } from '../../types'

// ============================================================================
// Common Types
// ============================================================================

/**
 * Query operators supported in where clauses
 *
 * These operators follow MongoDB-style query syntax and are pushed down
 * to SQLite where possible for efficient execution.
 *
 * @example
 * ```typescript
 * // Comparison operators
 * { age: { $gt: 18 } }           // age > 18
 * { age: { $gte: 18, $lt: 65 } } // 18 <= age < 65
 * { status: { $ne: 'deleted' } } // status !== 'deleted'
 * { role: { $in: ['admin', 'mod'] } } // role in array
 *
 * // Logical operators
 * { $and: [{ age: { $gte: 18 } }, { status: 'active' }] }
 * { $or: [{ role: 'admin' }, { role: 'superuser' }] }
 *
 * // Pattern matching (in-memory only)
 * { email: { $regex: /@example\.com$/ } }
 * { name: { $exists: true } }
 * ```
 */
export type QueryOperator =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: number | string | Date }
  | { $gte: number | string | Date }
  | { $lt: number | string | Date }
  | { $lte: number | string | Date }
  | { $in: unknown[] }
  | { $nin: unknown[] }
  | { $regex: RegExp | string }
  | { $exists: boolean }
  | { $and: Array<Record<string, unknown>> }
  | { $or: Array<Record<string, unknown>> }

// ============================================================================
// IStorage Interface
// ============================================================================

/**
 * Options for querying things with filtering and pagination
 *
 * Provides a flexible query API supporting:
 * - MongoDB-style where clauses (pushed to SQLite when possible)
 * - Pagination with limit/offset
 * - Field selection (include or exclude)
 * - Multi-field sorting
 * - Soft-delete awareness
 *
 * @example
 * ```typescript
 * // Complex query with all options
 * const results = await storage.list('Customer', {
 *   where: {
 *     status: 'active',
 *     createdAt: { $gte: '2024-01-01' },
 *     $or: [
 *       { tier: 'premium' },
 *       { totalSpent: { $gt: 1000 } }
 *     ]
 *   },
 *   orderBy: [
 *     { totalSpent: 'desc' },
 *     { createdAt: 'asc' }
 *   ],
 *   select: ['name', 'email', 'tier'],
 *   limit: 20,
 *   offset: 40
 * })
 * ```
 */
export interface StorageQueryOptions {
  /**
   * Filter things using MongoDB-like query syntax
   *
   * Supports:
   * - Equality: `{ field: value }`
   * - Comparison: `{ field: { $gt: 10 } }`
   * - Logical: `{ $and: [...] }`, `{ $or: [...] }`
   * - Pattern: `{ field: { $regex: /pattern/ } }` (in-memory only)
   * - Existence: `{ field: { $exists: true } }` (in-memory only)
   */
  where?: Record<string, unknown>

  /**
   * Maximum number of results to return
   * @default unlimited
   */
  limit?: number

  /**
   * Number of results to skip (for pagination)
   * Use with limit for page-based navigation
   * @default 0
   */
  offset?: number

  /**
   * Fields to include in results
   *
   * System fields ($id, $type, $createdAt, $updatedAt, $version) are
   * always included regardless of this setting.
   *
   * Cannot be used with `exclude` - use one or the other.
   *
   * @example
   * ```typescript
   * // Only return name and email (plus system fields)
   * { select: ['name', 'email'] }
   * ```
   */
  select?: string[]

  /**
   * Fields to exclude from results
   *
   * System fields cannot be excluded - they are always present.
   *
   * Cannot be used with `select` - use one or the other.
   *
   * @example
   * ```typescript
   * // Exclude large fields to reduce response size
   * { exclude: ['profileImage', 'biography'] }
   * ```
   */
  exclude?: string[]

  /**
   * Sort order for results - single or multiple fields
   *
   * Sorting is performed at the SQLite level using json_extract.
   *
   * @example
   * ```typescript
   * // Single field
   * { orderBy: { createdAt: 'desc' } }
   *
   * // Multiple fields (array form)
   * { orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }
   * ```
   */
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>

  /**
   * Include soft-deleted things in results
   *
   * By default, things with `$deletedAt` set are excluded from queries.
   * Set this to `true` to include them.
   *
   * @default false
   */
  includeDeleted?: boolean
}

/**
 * Filter options for bulk operations (delete, update)
 *
 * A simplified subset of StorageQueryOptions for bulk mutations.
 */
export interface BulkFilterOptions {
  /**
   * Filter things using MongoDB-like query syntax
   * @see StorageQueryOptions.where
   */
  where?: Record<string, unknown>
}

/**
 * IStorage - Thing CRUD operations interface
 *
 * This interface defines the contract for thing storage operations.
 * It is implemented by {@link DOCoreStorage} which provides:
 *
 * - **LRU Cache**: Hot things are cached in memory (configurable size)
 * - **SQLite Persistence**: All things are durably stored in SQLite
 * - **Event Emission**: Mutations emit events (create, update, delete)
 * - **Query Pushdown**: Where clauses are pushed to SQLite when possible
 *
 * ## Storage Model
 *
 * Things are stored with these system fields:
 * - `$id`: Unique identifier (auto-generated or provided)
 * - `$type`: Thing type (e.g., "Customer", "Order")
 * - `$createdAt`: ISO timestamp of creation
 * - `$updatedAt`: ISO timestamp of last update
 * - `$version`: Incrementing version number (for optimistic locking)
 * - `$deletedAt`: ISO timestamp if soft-deleted (undefined otherwise)
 *
 * ## Event Integration
 *
 * Storage operations emit events through the IEvents interface:
 * - `create()` emits `{type}.created`
 * - `update()` emits `{type}.updated`
 * - `delete()` emits `{type}.deleted`
 * - `restore()` emits `{type}.restored`
 *
 * @example
 * ```typescript
 * // Basic CRUD
 * const customer = await storage.create('Customer', { name: 'Alice' })
 * const found = await storage.getById(customer.$id)
 * const updated = await storage.updateById(customer.$id, { status: 'active' })
 * const deleted = await storage.deleteById(customer.$id)
 *
 * // Query operations
 * const active = await storage.list('Customer', { where: { status: 'active' } })
 * const count = await storage.count('Customer', { where: { tier: 'premium' } })
 * const first = await storage.findFirst('Customer', { where: { email: 'alice@example.com' } })
 *
 * // Batch operations
 * const customers = await storage.createMany('Customer', [
 *   { name: 'Bob' },
 *   { name: 'Carol' }
 * ])
 * ```
 *
 * @see DOCoreStorage - The default implementation
 */
export interface IStorage {
  // =========================================================================
  // Basic CRUD
  // =========================================================================

  /**
   * Create a new thing
   *
   * Creates a thing with automatic metadata:
   * - `$id`: Auto-generated unless provided in data
   * - `$createdAt`: Current ISO timestamp
   * - `$updatedAt`: Current ISO timestamp
   * - `$version`: Set to 1
   *
   * @param type - The thing type (e.g., "Customer", "Order")
   * @param data - The thing data (can include custom fields and optional $id)
   * @returns The created thing with all metadata fields
   *
   * @throws {@link ThingValidationError} if input validation fails
   * @emits `{type}.created` event with the created thing as payload
   *
   * @example
   * ```typescript
   * // Auto-generated ID
   * const customer = await storage.create('Customer', {
   *   name: 'Alice',
   *   email: 'alice@example.com'
   * })
   * console.log(customer.$id) // 'thing_1234567890_abc123'
   *
   * // Custom ID
   * const order = await storage.create('Order', {
   *   $id: 'order_custom_123',
   *   customerId: customer.$id,
   *   total: 99.99
   * })
   * ```
   */
  create(type: string, data: Record<string, unknown>): Promise<ThingData>

  /**
   * Get a thing by ID
   *
   * Retrieves a thing from cache (if present) or SQLite.
   * Returns null if not found or if the thing is soft-deleted.
   *
   * @param id - The thing ID to retrieve
   * @returns The thing or null if not found
   *
   * @example
   * ```typescript
   * const customer = await storage.getById('thing_123')
   * if (customer) {
   *   console.log(`Found: ${customer.name}`)
   * } else {
   *   console.log('Not found')
   * }
   * ```
   */
  getById(id: string): Promise<ThingData | null>

  /**
   * Update a thing by ID
   *
   * Updates specified fields while preserving others.
   * Automatically increments `$version` and updates `$updatedAt`.
   *
   * Supports special update operators:
   * - `$inc`: Atomic increment of numeric fields
   * - `$expectedVersion`: Optimistic concurrency control
   * - `$ifMatch`: Conditional update based on current values
   *
   * @param id - The thing ID to update
   * @param updates - Fields to update (merged with existing data)
   * @returns The updated thing with new version/timestamp
   *
   * @throws Error if thing not found
   * @throws Error if `$expectedVersion` doesn't match current version
   * @throws Error if `$ifMatch` conditions are not met
   * @emits `{type}.updated` event with the updated thing as payload
   *
   * @example
   * ```typescript
   * // Simple update
   * const updated = await storage.updateById(id, { status: 'active' })
   *
   * // Atomic increment
   * await storage.updateById(id, { $inc: { viewCount: 1 } })
   *
   * // Optimistic concurrency control
   * await storage.updateById(id, {
   *   status: 'done',
   *   $expectedVersion: 2  // Fails if version != 2
   * })
   *
   * // Conditional update
   * await storage.updateById(id, {
   *   status: 'shipped',
   *   $ifMatch: { status: 'processing' }  // Fails if status != 'processing'
   * })
   * ```
   */
  updateById(id: string, updates: Record<string, unknown>): Promise<ThingData>

  /**
   * Delete a thing by ID (hard delete)
   *
   * Permanently removes the thing from both cache and SQLite.
   * For recoverable deletion, use {@link softDeleteById} instead.
   *
   * @param id - The thing ID to delete
   * @returns `true` if deleted, `false` if not found
   *
   * @emits `{type}.deleted` event with `{ $id: id }` as payload
   *
   * @example
   * ```typescript
   * const wasDeleted = await storage.deleteById('thing_123')
   * if (wasDeleted) {
   *   console.log('Thing deleted')
   * } else {
   *   console.log('Thing not found')
   * }
   * ```
   */
  deleteById(id: string): Promise<boolean>

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * List things of a specific type with optional filtering
   *
   * Executes a query against SQLite with optional filtering, sorting,
   * and pagination. Where clauses are pushed to SQLite when possible
   * for efficient execution.
   *
   * @param type - The thing type to list (e.g., "Customer")
   * @param query - Optional query options for filtering, sorting, pagination
   * @returns Array of matching things (empty array if none match)
   *
   * @example
   * ```typescript
   * // All customers
   * const all = await storage.list('Customer')
   *
   * // With filtering
   * const active = await storage.list('Customer', {
   *   where: { status: 'active' }
   * })
   *
   * // With pagination
   * const page = await storage.list('Customer', {
   *   where: { status: 'active' },
   *   limit: 10,
   *   offset: 20
   * })
   *
   * // With sorting
   * const sorted = await storage.list('Customer', {
   *   orderBy: { createdAt: 'desc' }
   * })
   *
   * // Complex query
   * const premium = await storage.list('Customer', {
   *   where: {
   *     $and: [
   *       { status: 'active' },
   *       { $or: [{ tier: 'premium' }, { totalSpent: { $gt: 1000 } }] }
   *     ]
   *   },
   *   orderBy: [{ tier: 'asc' }, { totalSpent: 'desc' }],
   *   limit: 50
   * })
   * ```
   */
  list(type: string, query?: StorageQueryOptions): Promise<ThingData[]>

  /**
   * Count things of a specific type with optional filtering
   *
   * Efficiently counts matching things without retrieving all data.
   * Uses SQL COUNT when possible, falls back to list().length for
   * complex patterns.
   *
   * @param type - The thing type to count
   * @param query - Optional filter options
   * @returns Number of matching things
   *
   * @example
   * ```typescript
   * const totalCustomers = await storage.count('Customer')
   * const activeCustomers = await storage.count('Customer', {
   *   where: { status: 'active' }
   * })
   * ```
   */
  count(type: string, query?: { where?: Record<string, unknown> }): Promise<number>

  /**
   * Find the first thing matching a query
   *
   * Efficiently retrieves a single matching thing.
   * Equivalent to `list(type, { ...query, limit: 1 })[0]`.
   *
   * @param type - The thing type to search
   * @param query - Optional query options
   * @returns The first matching thing or null
   *
   * @example
   * ```typescript
   * const admin = await storage.findFirst('User', {
   *   where: { role: 'admin' }
   * })
   *
   * const newest = await storage.findFirst('Order', {
   *   orderBy: { createdAt: 'desc' }
   * })
   * ```
   */
  findFirst(type: string, query?: StorageQueryOptions): Promise<ThingData | null>

  // =========================================================================
  // Batch Operations
  // =========================================================================

  /**
   * Create multiple things in a batch
   *
   * Creates multiple things of the same type in sequence.
   * Each creation emits its own event.
   *
   * @param type - The thing type for all items
   * @param items - Array of thing data objects
   * @returns Array of created things (same order as input)
   *
   * @emits `{type}.created` event for each created thing
   *
   * @example
   * ```typescript
   * const customers = await storage.createMany('Customer', [
   *   { name: 'Alice', email: 'alice@example.com' },
   *   { name: 'Bob', email: 'bob@example.com' },
   *   { name: 'Carol', email: 'carol@example.com' }
   * ])
   * console.log(customers.length) // 3
   * ```
   */
  createMany(type: string, items: Array<Record<string, unknown>>): Promise<ThingData[]>

  /**
   * Update multiple things matching a filter
   *
   * Updates all things matching the filter with the same updates.
   * Each update emits its own event.
   *
   * @param type - The thing type to update
   * @param filter - Filter options to select things
   * @param updates - Fields to update on all matching things
   * @returns Number of things updated
   *
   * @emits `{type}.updated` event for each updated thing
   *
   * @example
   * ```typescript
   * // Activate all pending customers
   * const count = await storage.updateMany(
   *   'Customer',
   *   { where: { status: 'pending' } },
   *   { status: 'active', activatedAt: new Date().toISOString() }
   * )
   * console.log(`Activated ${count} customers`)
   * ```
   */
  updateMany(
    type: string,
    filter: BulkFilterOptions,
    updates: Record<string, unknown>
  ): Promise<number>

  /**
   * Delete multiple things matching a filter (hard delete)
   *
   * Permanently removes all things matching the filter.
   * Each deletion emits its own event.
   *
   * @param type - The thing type to delete
   * @param filter - Filter options to select things
   * @returns Number of things deleted
   *
   * @emits `{type}.deleted` event for each deleted thing
   *
   * @example
   * ```typescript
   * // Delete all inactive customers
   * const count = await storage.deleteMany('Customer', {
   *   where: { status: 'inactive' }
   * })
   * console.log(`Deleted ${count} inactive customers`)
   * ```
   */
  deleteMany(type: string, filter: BulkFilterOptions): Promise<number>

  // =========================================================================
  // Upsert
  // =========================================================================

  /**
   * Create or update a thing (upsert)
   *
   * If `$id` is provided and exists, updates the thing.
   * Otherwise, creates a new thing.
   *
   * @param type - The thing type
   * @param data - The thing data (include `$id` for update path)
   * @returns The created or updated thing
   *
   * @emits `{type}.created` if created, `{type}.updated` if updated
   *
   * @example
   * ```typescript
   * // Creates new thing (no $id)
   * const created = await storage.upsert('Customer', { name: 'Alice' })
   *
   * // Creates new thing ($id doesn't exist)
   * const created2 = await storage.upsert('Customer', {
   *   $id: 'cust_new',
   *   name: 'Bob'
   * })
   *
   * // Updates existing thing ($id exists)
   * const updated = await storage.upsert('Customer', {
   *   $id: created.$id,
   *   name: 'Alice Updated',
   *   email: 'alice@new-email.com'
   * })
   * ```
   */
  upsert(type: string, data: Record<string, unknown>): Promise<ThingData>

  // =========================================================================
  // Soft Delete
  // =========================================================================

  /**
   * Soft delete a thing by ID
   *
   * Marks a thing as deleted by setting `$deletedAt` timestamp.
   * The thing remains in storage but is excluded from queries by default.
   * Use {@link restoreById} to undo soft deletion.
   *
   * @param id - The thing ID to soft delete
   * @returns The updated thing with `$deletedAt` set
   *
   * @throws Error if thing not found
   * @emits `{type}.updated` event (with the new `$deletedAt` field)
   *
   * @example
   * ```typescript
   * const deleted = await storage.softDeleteById('thing_123')
   * console.log(deleted.$deletedAt) // '2024-01-15T10:30:00.000Z'
   *
   * // Thing is now excluded from list()
   * const customers = await storage.list('Customer')
   * // deleted thing not in results
   *
   * // But can still be retrieved with includeDeleted
   * const all = await storage.list('Customer', { includeDeleted: true })
   * // deleted thing IS in results
   * ```
   */
  softDeleteById(id: string): Promise<ThingData>

  /**
   * Restore a soft-deleted thing by ID
   *
   * Clears the `$deletedAt` timestamp, making the thing visible
   * in queries again.
   *
   * @param id - The thing ID to restore
   * @returns The updated thing with `$deletedAt` cleared
   *
   * @throws Error if thing not found
   * @emits `{type}.restored` event with the restored thing
   *
   * @example
   * ```typescript
   * // Soft delete then restore
   * await storage.softDeleteById('thing_123')
   * const restored = await storage.restoreById('thing_123')
   * console.log(restored.$deletedAt) // undefined
   * ```
   */
  restoreById(id: string): Promise<ThingData>
}

// ============================================================================
// ISchedule Interface
// ============================================================================

/**
 * Handler function for scheduled events
 *
 * Called when a schedule triggers. The handler should be idempotent
 * when possible since schedules may fire multiple times on recovery.
 *
 * @returns void or Promise<void> for async handlers
 *
 * @example
 * ```typescript
 * const handler: ScheduleHandler = async () => {
 *   console.log('Schedule triggered!')
 *   await doSomeWork()
 * }
 * ```
 */
export type ScheduleHandler = () => void | Promise<void>

/**
 * Schedule entry - represents a registered/persisted schedule
 *
 * Contains the in-memory handler and CRON expression.
 * Note: The actual handler function cannot be persisted to SQLite.
 * On recovery after eviction, schedules are restored with placeholder
 * handlers that log warnings. Re-register handlers to restore full
 * functionality.
 */
export interface ScheduleEntry {
  /** The handler function (in-memory only, not persisted) */
  handler: ScheduleHandler
  /** CRON expression for this schedule */
  cron: string
}

/**
 * Persisted schedule entry from SQLite
 *
 * This is the serialized form stored in the database.
 * Note: Handler functions cannot be serialized, so only metadata is stored.
 */
export interface PersistedScheduleEntry {
  /** CRON expression */
  cron: string
  /** Handler function ID (for tracking/debugging) */
  handler_id: string
  /** Timestamp when scheduled (milliseconds since epoch) */
  registered_at: number
}

/**
 * Builder for creating interval-based schedules
 *
 * Used with `every(n)` to create fixed-interval schedules.
 *
 * @example
 * ```typescript
 * every(5).minutes(handler)  // Every 5 minutes
 * every(2).hours(handler)    // Every 2 hours
 * every(30).seconds(handler) // Every 30 seconds (special handling)
 * ```
 */
export interface IntervalBuilder {
  /**
   * Execute handler every N seconds
   * @note Seconds are handled specially since CRON doesn't support them
   */
  seconds(handler: ScheduleHandler): void

  /** Execute handler every N minutes */
  minutes(handler: ScheduleHandler): void

  /** Execute handler every N hours */
  hours(handler: ScheduleHandler): void

  /** Execute handler every N days */
  days(handler: ScheduleHandler): void
}

/**
 * Builder for creating time-based schedules
 *
 * Used with day builders to specify execution time.
 *
 * @example
 * ```typescript
 * every.Monday.at('9:30am')(handler)
 * every.day.at9am(handler)
 * every.Friday.at6pm(handler)
 * ```
 */
export interface TimeBuilder {
  /**
   * Execute at a specific time
   * @param time - Time string (e.g., '9am', '14:30', '6:00pm')
   * @returns Function that accepts the handler
   */
  at(time: string | number): (handler: ScheduleHandler) => void

  /** Shortcut for at('9:00am') */
  at9am(handler: ScheduleHandler): void

  /** Shortcut for at('6:00pm') */
  at6pm(handler: ScheduleHandler): void
}

/**
 * Builder for creating daily/weekly schedules
 *
 * Provides a fluent DSL for schedule configuration.
 *
 * @example
 * ```typescript
 * // Daily schedules
 * every.day.at('9am')(handler)
 * every.day.at9am(handler)
 *
 * // Weekly schedules
 * every.Monday.at('9am')(handler)
 * every.Friday.at6pm(handler)
 *
 * // Simple intervals
 * every.hour(handler)
 * every.minute(handler)
 * ```
 */
export interface ScheduleBuilder {
  /** Daily schedule builder */
  day: TimeBuilder & { at: (time: string | number) => (handler: ScheduleHandler) => void }

  /** Monday schedule builder */
  Monday: TimeBuilder

  /** Tuesday schedule builder */
  Tuesday: TimeBuilder

  /** Wednesday schedule builder */
  Wednesday: TimeBuilder

  /** Thursday schedule builder */
  Thursday: TimeBuilder

  /** Friday schedule builder */
  Friday: TimeBuilder

  /** Saturday schedule builder */
  Saturday: TimeBuilder

  /** Sunday schedule builder */
  Sunday: TimeBuilder

  /**
   * Execute at a specific time daily
   * @param time - Time string (e.g., '9am', '14:30')
   */
  at(time: string | number): (handler: ScheduleHandler) => void

  /** Shortcut for at('9:00am') */
  at9am(handler: ScheduleHandler): void

  /** Shortcut for at('6:00pm') */
  at6pm(handler: ScheduleHandler): void
}

/**
 * ISchedule - Schedule management interface
 *
 * This interface defines the contract for schedule operations.
 * It is implemented by {@link DOCoreSchedule} which provides:
 *
 * - **CRON-based Scheduling**: Standard 5-part CRON expressions
 * - **Fluent DSL**: `every.day.at('9am')`, `every(5).minutes`, etc.
 * - **SQLite Persistence**: Schedules survive DO eviction (handlers don't)
 * - **Alarm Integration**: Works with Cloudflare Durable Object alarms
 *
 * ## CRON Expression Format
 *
 * ```
 * ┌───────────── minute (0 - 59)
 * │ ┌───────────── hour (0 - 23)
 * │ │ ┌───────────── day of month (1 - 31)
 * │ │ │ ┌───────────── month (1 - 12)
 * │ │ │ │ ┌───────────── day of week (0 - 6) (Sunday = 0)
 * │ │ │ │ │
 * * * * * *
 * ```
 *
 * ## Handler Persistence
 *
 * **Important**: Handler functions cannot be persisted to SQLite.
 * After DO eviction, schedules are restored from SQLite but handlers
 * are replaced with placeholders. You must re-register handlers after
 * eviction to restore full functionality.
 *
 * @example
 * ```typescript
 * // Direct CRON registration
 * schedule.registerSchedule('0 9 * * *', () => {
 *   console.log('Good morning!')
 * })
 *
 * // Via fluent DSL (through DOCore.every)
 * $.every.day.at('9am')(() => console.log('Good morning!'))
 * $.every.Monday.at9am(() => console.log('Start of week!'))
 * $.every(5).minutes(() => console.log('Heartbeat'))
 *
 * // Query schedules
 * const entry = await schedule.getScheduleByCron('0 9 * * *')
 * const all = await schedule.getAllSchedules()
 *
 * // Cleanup
 * await schedule.deleteScheduleByCron('0 9 * * *')
 * await schedule.clearAllSchedules()
 * ```
 *
 * @see DOCoreSchedule - The default implementation
 */
export interface ISchedule {
  /**
   * Register a schedule with a CRON expression
   *
   * Persists the schedule to SQLite and stores the handler in memory.
   * The handler will be called when the schedule triggers (via alarm).
   *
   * @param cron - CRON expression (e.g., "0 9 * * *" for 9am daily)
   * @param handler - Function to execute when schedule triggers
   *
   * @example
   * ```typescript
   * // Daily at 9am
   * schedule.registerSchedule('0 9 * * *', async () => {
   *   await sendDailyReport()
   * })
   *
   * // Every 5 minutes
   * schedule.registerSchedule('*​/5 * * * *', () => {
   *   console.log('Heartbeat')
   * })
   *
   * // Every Monday at 6pm
   * schedule.registerSchedule('0 18 * * 1', () => {
   *   console.log('Week summary time!')
   * })
   * ```
   */
  registerSchedule(cron: string, handler: ScheduleHandler): void

  /**
   * Get schedule metadata by CRON expression
   *
   * Note: Returns metadata only; handler functions cannot be serialized
   * for RPC and must be re-registered after DO recovery.
   *
   * @param cron - CRON expression to search for
   * @returns Persisted schedule entry if found, null otherwise
   *
   * @example
   * ```typescript
   * const entry = await schedule.getScheduleByCron('0 9 * * *')
   * if (entry) {
   *   console.log(`Found schedule: ${entry.cron}, registered at ${entry.registered_at}`)
   * }
   * ```
   */
  getScheduleByCron(cron: string): Promise<PersistedScheduleEntry | null>

  /**
   * Get all registered schedules (metadata only)
   *
   * Note: Returns metadata only; handler functions cannot be serialized
   * for RPC and must be re-registered after DO recovery.
   *
   * @returns Array of persisted schedule entries (may be empty)
   *
   * @example
   * ```typescript
   * const schedules = await schedule.getAllSchedules()
   * console.log(`${schedules.length} schedules registered`)
   * for (const s of schedules) {
   *   console.log(`- ${s.cron} (registered: ${new Date(s.registered_at)})`)
   * }
   * ```
   */
  getAllSchedules(): Promise<PersistedScheduleEntry[]>

  /**
   * Delete a schedule by CRON expression
   *
   * Removes from both memory and SQLite.
   *
   * @param cron - CRON expression to delete
   * @returns `true` if deleted, `false` if not found
   *
   * @example
   * ```typescript
   * const wasDeleted = await schedule.deleteScheduleByCron('0 9 * * *')
   * if (wasDeleted) {
   *   console.log('Schedule removed')
   * }
   * ```
   */
  deleteScheduleByCron(cron: string): Promise<boolean>

  /**
   * Clear all schedules
   *
   * Removes all schedules from both memory and SQLite.
   * **Use with caution** - this action cannot be undone.
   *
   * @example
   * ```typescript
   * // Remove all schedules
   * await schedule.clearAllSchedules()
   * ```
   */
  clearAllSchedules(): Promise<void>
}

// ============================================================================
// IEvents Interface
// ============================================================================

/**
 * Event structure for workflow context events
 *
 * Events are the primary communication mechanism in DOCore.
 * They follow the pattern `Noun.verb` (e.g., "Customer.created").
 */
export interface Event {
  /**
   * Unique event ID
   * @example 'evt_1705312200000_abc123def'
   */
  id: string

  /**
   * Event type in format "Noun.verb"
   * @example 'Customer.created', 'Order.shipped', 'Payment.failed'
   */
  type: string

  /**
   * Event subject/noun (first part of type)
   * @example 'Customer', 'Order', 'Payment'
   */
  subject: string

  /**
   * Event verb/action (second part of type)
   * @example 'created', 'updated', 'deleted', 'shipped'
   */
  object: string

  /**
   * Event data payload
   * Typically the thing that triggered the event or relevant data
   */
  data: unknown

  /**
   * Event timestamp
   * When the event was emitted
   */
  timestamp: Date
}

/**
 * Handler function for events
 *
 * Called when a matching event is emitted.
 * Handlers should be idempotent when possible.
 *
 * @param event - The event that triggered this handler
 * @returns void or Promise<void> for async handlers
 *
 * @example
 * ```typescript
 * const handler: EventHandler = async (event) => {
 *   console.log(`Event: ${event.type}`)
 *   console.log(`Data: ${JSON.stringify(event.data)}`)
 *   await processEvent(event)
 * }
 * ```
 */
export type EventHandler = (event: Event) => void | Promise<void>

/**
 * Unsubscribe function returned from event handler registration
 *
 * Call this function to remove the handler from the event system.
 *
 * @example
 * ```typescript
 * const unsubscribe = events.on('Customer.created', handler)
 * // Later...
 * unsubscribe() // Handler no longer receives events
 * ```
 */
export type Unsubscribe = () => void

/**
 * OnProxy type for ergonomic event handler registration
 *
 * Provides a fluent API for subscribing to events using JavaScript Proxy.
 * Supports infinite noun/verb combinations and wildcards.
 *
 * ## Wildcard Support
 *
 * - `$.on.Customer.created` - Exact match
 * - `$.on.*.created` - Any noun with "created" verb
 * - `$.on.Customer.*` - Any verb for "Customer"
 * - `$.on.*.*` - All events (global handler)
 *
 * @example
 * ```typescript
 * // Exact match
 * $.on.Customer.signup((event) => {
 *   console.log('New customer signed up:', event.data)
 * })
 *
 * // Wildcard noun - all "created" events
 * $.on['*'].created((event) => {
 *   console.log(`${event.subject} created:`, event.data)
 * })
 *
 * // Wildcard verb - all Customer events
 * $.on.Customer['*']((event) => {
 *   console.log(`Customer ${event.object}:`, event.data)
 * })
 *
 * // Global handler - all events
 * $.on['*']['*']((event) => {
 *   console.log(`[${event.type}]`, event.data)
 * })
 * ```
 */
export type OnProxy = {
  [noun: string]: {
    [verb: string]: (handler: EventHandler) => Unsubscribe
  }
}

/**
 * IEvents - Event emission and subscription interface
 *
 * This interface defines the contract for event operations.
 * It is implemented by {@link DOCoreEvents} which provides:
 *
 * - **Fire-and-Forget Emission**: `send()` returns immediately
 * - **Pattern Subscription**: Exact match and wildcard support
 * - **OnProxy Pattern**: Ergonomic `$.on.Noun.verb` syntax
 * - **WebSocket Broadcast**: Events sent to connected clients
 *
 * ## Event Delivery Semantics
 *
 * - **Fire-and-Forget**: `send()` returns event ID immediately
 * - **No Guarantees**: Events may be dropped, duplicated, or reordered
 * - **Local First**: Local handlers are called before WebSocket broadcast
 * - **Error Isolation**: Handler errors don't affect other handlers
 *
 * ## Wildcard Matching
 *
 * When an event is emitted, handlers are matched in this order:
 * 1. Exact match: `Customer.created`
 * 2. Wildcard noun: `*.created`
 * 3. Wildcard verb: `Customer.*`
 * 4. Global wildcard: `*.*`
 *
 * @example
 * ```typescript
 * // Emit events
 * const eventId = events.send('Customer.created', { name: 'Alice' })
 * events.send('Order.shipped', { orderId: '123', trackingNumber: 'ABC' })
 *
 * // Subscribe via on() method
 * const unsub = events.on('Customer.created', (event) => {
 *   console.log('New customer:', event.data)
 * })
 *
 * // Subscribe via OnProxy (through DOCore)
 * $.on.Customer.created((event) => {
 *   console.log('New customer:', event.data)
 * })
 *
 * // Unsubscribe
 * unsub()
 *
 * // Clear all handlers
 * events.clearAllHandlers()
 * ```
 *
 * @see DOCoreEvents - The default implementation
 */
export interface IEvents {
  /**
   * Emit an event (fire-and-forget)
   *
   * Dispatches an event to all matching handlers and WebSocket subscribers.
   * Returns immediately - does not wait for handlers to complete.
   *
   * @param eventType - Event type in format "Noun.verb"
   * @param data - Event payload (should be JSON-serializable)
   * @returns Event ID for tracking/correlation
   *
   * @example
   * ```typescript
   * const eventId = events.send('Customer.created', {
   *   $id: 'cust_123',
   *   name: 'Alice',
   *   email: 'alice@example.com'
   * })
   * console.log(`Emitted event: ${eventId}`)
   * ```
   */
  send(eventType: string, data: unknown): string

  /**
   * Subscribe to events matching a pattern
   *
   * @param eventType - Event pattern (e.g., "Customer.created", "*.created")
   * @param handler - Function to call when event matches
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * // Exact match
   * const unsub1 = events.subscribe('Customer.created', handler)
   *
   * // Wildcard patterns
   * const unsub2 = events.subscribe('*.created', handler)  // All "created" events
   * const unsub3 = events.subscribe('Customer.*', handler) // All Customer events
   * const unsub4 = events.subscribe('*.*', handler)        // All events
   *
   * // Unsubscribe
   * unsub1()
   * ```
   */
  subscribe(eventType: string, handler: EventHandler): Unsubscribe

  /**
   * Get the OnProxy object for ergonomic handler registration
   *
   * Returns a Proxy object that allows `$.on.Noun.verb(handler)` syntax.
   * This is the primary subscription method in DOCore context.
   *
   * @returns OnProxy object
   *
   * @example
   * ```typescript
   * const on = events.getOnProxy()
   *
   * on.Customer.created((event) => {
   *   console.log('New customer:', event.data)
   * })
   *
   * on.Order.shipped((event) => {
   *   console.log('Order shipped:', event.data)
   * })
   * ```
   */
  getOnProxy(): OnProxy

  /**
   * Get all handlers for a specific event pattern
   *
   * Returns the handlers registered for an exact pattern.
   * Does not include wildcard-matched handlers.
   *
   * @param pattern - Event pattern to query
   * @returns Array of registered handlers (may be empty)
   *
   * @example
   * ```typescript
   * const handlers = events.getHandlers('Customer.created')
   * console.log(`${handlers.length} handlers for Customer.created`)
   * ```
   */
  getHandlers(pattern: string): EventHandler[]

  /**
   * Clear all event handlers
   *
   * Removes all subscriptions from all patterns.
   * **Use with caution** - this will stop all event processing.
   *
   * @example
   * ```typescript
   * // Clear all handlers (useful for cleanup/testing)
   * events.clearAllHandlers()
   * ```
   */
  clearAllHandlers(): void
}

// ============================================================================
// Module Initialization Options
// ============================================================================

/**
 * Options for initializing the storage module
 *
 * @example
 * ```typescript
 * const storage = new DOCoreStorage(ctx, {
 *   cacheSize: 5000  // Larger cache for high-traffic DO
 * })
 * ```
 */
export interface StorageModuleOptions {
  /**
   * Maximum size of LRU cache for things
   *
   * Hot things are cached in memory for fast access.
   * Evicted entries are still available from SQLite.
   *
   * @default 1000
   */
  cacheSize?: number
}

/**
 * Options for initializing the schedule module
 *
 * @example
 * ```typescript
 * const schedule = new DOCoreSchedule(ctx, {
 *   autoRecover: true  // Restore schedules from SQLite on init
 * })
 * ```
 */
export interface ScheduleModuleOptions {
  /**
   * Whether to auto-recover persisted schedules on initialization
   *
   * If true, schedules are loaded from SQLite on startup.
   * Note: Handlers cannot be recovered - only CRON expressions.
   *
   * @default true
   */
  autoRecover?: boolean
}

/**
 * Options for initializing the events module
 *
 * @example
 * ```typescript
 * const events = new DOCoreEvents(rpcHandler, ctx, {
 *   enableBroadcast: true  // Enable WebSocket broadcasting
 * })
 * ```
 */
export interface EventsModuleOptions {
  /**
   * Whether to enable WebSocket broadcasting
   *
   * If true, events are broadcast to connected WebSocket clients.
   * Requires rpcHandler and ctx to be provided.
   *
   * @default true
   */
  enableBroadcast?: boolean
}
