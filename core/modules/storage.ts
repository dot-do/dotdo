/**
 * DOCoreStorage Module - Thing CRUD operations extracted from DOCore
 *
 * This module provides RPC-compatible storage operations for Things:
 * - Basic CRUD (create, read, update, delete)
 * - Batch operations (createMany, updateMany, deleteMany)
 * - Upsert (create or update)
 * - Query operations (list, count, findFirst)
 * - Soft delete (softDelete, restore)
 *
 * This extraction reduces DOCore.ts complexity by moving all storage-related
 * methods into a dedicated module while maintaining full backward compatibility.
 */

import { RpcTarget } from 'cloudflare:workers'
import {
  assertValidCreateThingInput,
} from '../../lib/validation/thing-validation'
import {
  validateWhereClause,
  matchesWhere,
  buildSqlWhereClause,
} from '../query-validation'
import { generateThingId } from '../event-system'
import { LRUCache } from '../lru-cache'
import type { ThingData } from '../../types'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_THINGS_CACHE_SIZE = 1000

// ============================================================================
// Types
// ============================================================================

/**
 * Interface for event emission (used by DOCoreStorage)
 */
export interface StorageEventEmitter {
  send(eventType: string, data: unknown): string
}

/**
 * Extended query options for listing things
 */
export interface ThingQueryOptions {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
  select?: string[]
  exclude?: string[]
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
  includeDeleted?: boolean
}

// ============================================================================
// DOCoreStorage Class
// ============================================================================

/**
 * DOCoreStorage - RpcTarget class for Thing storage operations
 *
 * This class encapsulates all Thing CRUD operations, providing:
 * - LRU cache for hot things (backed by SQLite)
 * - Event emission on thing changes
 * - Query filtering with SQL pushdown optimization
 * - Batch operations for efficient bulk updates
 * - Soft delete support
 *
 * @example
 * ```typescript
 * const storage = new DOCoreStorage(ctx)
 * storage.setEventEmitter(doInstance)
 *
 * // Create a thing
 * const customer = await storage.create('Customer', { name: 'Alice' })
 *
 * // List with filtering
 * const active = await storage.list('Customer', { where: { status: 'active' } })
 * ```
 */
export class DOCoreStorage extends RpcTarget {
  // LRU cache for things with configurable max size (default 1000 entries)
  // Evicted entries are still available from SQLite, this is just a hot cache
  private things: LRUCache<ThingData>
  private eventEmitter?: StorageEventEmitter

  constructor(private ctx: DurableObjectState, cacheSize = DEFAULT_THINGS_CACHE_SIZE) {
    super()
    this.things = new LRUCache<ThingData>({ maxSize: cacheSize })
  }

  /**
   * Set the event emitter for thing change notifications
   */
  setEventEmitter(emitter: StorageEventEmitter): void {
    this.eventEmitter = emitter
  }

  /**
   * Emit an event if emitter is configured
   */
  private emit(eventType: string, data: unknown): void {
    if (this.eventEmitter) {
      this.eventEmitter.send(eventType, data)
    }
  }

  // =========================================================================
  // BASIC CRUD OPERATIONS
  // =========================================================================

  /**
   * Create a new thing
   * @param type The thing type (e.g., "Customer", "Order")
   * @param data The thing data
   * @returns The created thing with metadata
   */
  async create(type: string, data: Record<string, unknown>): Promise<ThingData> {
    // Validate input
    const inputForValidation = { $type: type, ...data }
    assertValidCreateThingInput(inputForValidation)

    const now = new Date().toISOString()
    const id = (data.$id as string) ?? generateThingId()

    const thing: ThingData = {
      $id: id,
      $type: type,
      $createdAt: now,
      $updatedAt: now,
      $version: 1,
      ...data,
    }

    // Store in memory cache
    this.things.set(id, thing)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO things (id, type, data, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      type,
      JSON.stringify(thing),
      Date.now(),
      Date.now(),
      1
    )

    // Emit created event
    this.emit(`${type}.created`, thing)

    return thing
  }

  /**
   * Get a thing by ID
   * @param id The thing ID
   * @returns The thing or null if not found
   */
  get(id: string): ThingData | null {
    // Check memory first
    const fromMemory = this.things.get(id)
    if (fromMemory) return fromMemory

    // Check SQLite
    const rows = this.ctx.storage.sql.exec('SELECT data FROM things WHERE id = ?', id).toArray()
    if (rows.length > 0) {
      const thing = JSON.parse(rows[0].data as string) as ThingData
      this.things.set(id, thing)
      return thing
    }

    return null
  }

  /**
   * Get a thing by ID (async version for RPC compatibility)
   * @param id The thing ID
   * @returns Promise resolving to the thing or null
   */
  async getById(id: string): Promise<ThingData | null> {
    return this.get(id)
  }

  /**
   * Update a thing by type and ID
   * @param type The thing type
   * @param id The thing ID
   * @param updates The updates to apply
   * @returns The updated thing
   * @throws Error if thing not found
   */
  async update(type: string, id: string, updates: Record<string, unknown>): Promise<ThingData> {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Thing not found: ${id}`)
    }

    // Extract special update options
    const { $expectedVersion, $ifMatch, $inc, ...regularUpdates } = updates

    // Check optimistic concurrency control - version
    if ($expectedVersion !== undefined) {
      if (existing.$version !== $expectedVersion) {
        throw new Error(`Version conflict: expected version ${$expectedVersion}, but found version ${existing.$version}`)
      }
    }

    // Check conditional update - $ifMatch
    if ($ifMatch !== undefined) {
      const conditions = $ifMatch as Record<string, unknown>
      for (const [field, expected] of Object.entries(conditions)) {
        const actual = existing[field as keyof ThingData]
        if (actual !== expected) {
          throw new Error(`condition failed: ${field} expected ${JSON.stringify(expected)}, but found ${JSON.stringify(actual)}`)
        }
      }
    }

    // Apply atomic increments
    let finalUpdates = { ...regularUpdates }
    if ($inc !== undefined) {
      const increments = $inc as Record<string, number>
      for (const [field, delta] of Object.entries(increments)) {
        const currentValue = existing[field as keyof ThingData]
        if (typeof currentValue === 'number') {
          finalUpdates[field] = currentValue + delta
        } else {
          finalUpdates[field] = delta // If field doesn't exist or isn't a number, set to delta
        }
      }
    }

    const now = new Date().toISOString()
    const updated: ThingData = {
      ...existing,
      ...finalUpdates,
      $id: id,
      $type: type,
      $updatedAt: now,
      $version: (existing.$version ?? 0) + 1,
    }

    // Store in memory
    this.things.set(id, updated)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `UPDATE things SET data = ?, updated_at = ?, version = ? WHERE id = ?`,
      JSON.stringify(updated),
      Date.now(),
      updated.$version,
      id
    )

    // Emit updated event
    this.emit(`${type}.updated`, updated)

    return updated
  }

  /**
   * Update a thing by ID (looks up type automatically)
   * @param id The thing ID
   * @param updates The updates to apply
   * @returns The updated thing
   * @throws Error if thing not found
   */
  async updateById(id: string, updates: Record<string, unknown>): Promise<ThingData> {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Thing not found: ${id}`)
    }
    return this.update(existing.$type, id, updates)
  }

  /**
   * Delete a thing by type and ID
   * @param type The thing type
   * @param id The thing ID
   * @returns true if deleted, false if not found
   */
  async delete(type: string, id: string): Promise<boolean> {
    const existing = this.get(id)
    if (!existing) {
      return false
    }

    // Remove from memory
    this.things.delete(id)

    // Remove from SQLite
    this.ctx.storage.sql.exec('DELETE FROM things WHERE id = ?', id)

    // Emit deleted event
    this.emit(`${type}.deleted`, { $id: id })

    return true
  }

  /**
   * Delete a thing by ID (looks up type automatically)
   * @param id The thing ID
   * @returns true if deleted, false if not found
   */
  async deleteById(id: string): Promise<boolean> {
    const existing = this.get(id)
    if (!existing) {
      return false
    }
    return this.delete(existing.$type, id)
  }

  // =========================================================================
  // LIST AND QUERY OPERATIONS
  // =========================================================================

  /**
   * List things of a specific type with optional filtering
   * @param type The thing type to list
   * @param query Optional query options (where, limit, offset, orderBy, etc.)
   * @returns Array of matching things
   */
  async list(type: string, query?: ThingQueryOptions): Promise<ThingData[]> {
    let sql = 'SELECT data FROM things WHERE type = ?'
    const params: unknown[] = [type]

    // Exclude soft-deleted items by default
    if (!query?.includeDeleted) {
      sql += " AND (json_extract(data, '$.$deletedAt') IS NULL)"
    }

    // Track if we have any in-memory-only operators that need post-filtering
    let remainingWhere: Record<string, unknown> | null = null

    // Build SQL WHERE clause from query operators (pushdown optimization)
    if (query?.where) {
      // Validate the where clause first - throws QueryValidationError if invalid
      const validatedWhere = validateWhereClause(query.where)

      // Build SQL WHERE clause for operators that can be pushed to SQLite
      const sqlWhere = buildSqlWhereClause(validatedWhere)

      if (sqlWhere.sql) {
        sql += ' AND ' + sqlWhere.sql
        params.push(...sqlWhere.params)
      }

      // Keep track of operators that need in-memory filtering ($regex, $exists)
      remainingWhere = sqlWhere.remainingWhere
    }

    // Apply ORDER BY for sorting
    if (query?.orderBy) {
      const orderClauses: string[] = []
      const orderByArray = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy]

      for (const orderSpec of orderByArray) {
        for (const [field, direction] of Object.entries(orderSpec)) {
          const dir = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
          orderClauses.push(`json_extract(data, '$.${field}') ${dir}`)
        }
      }

      if (orderClauses.length > 0) {
        sql += ' ORDER BY ' + orderClauses.join(', ')
      }
    }

    // Apply LIMIT before OFFSET for proper pagination
    if (query?.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query?.offset) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.ctx.storage.sql.exec(sql, ...params).toArray()
    let results = rows.map((row) => JSON.parse(row.data as string) as ThingData)

    // Apply in-memory filtering for operators that couldn't be pushed to SQL ($regex, $exists)
    if (remainingWhere) {
      results = results.filter((thing) => matchesWhere(thing, remainingWhere!))
    }

    // Apply field selection or exclusion
    if (query?.select || query?.exclude) {
      results = results.map((thing) => this.applyFieldSelection(thing, query.select, query.exclude))
    }

    return results
  }

  /**
   * Apply field selection (select) or exclusion (exclude) to a thing
   */
  private applyFieldSelection(
    thing: ThingData,
    select?: string[],
    exclude?: string[]
  ): ThingData {
    // Always include system fields
    const systemFields = ['$id', '$type', '$createdAt', '$updatedAt', '$version', '$deletedAt']

    if (select) {
      // Only include selected fields + system fields
      const result: ThingData = {} as ThingData
      for (const key of Object.keys(thing)) {
        if (systemFields.includes(key) || select.includes(key)) {
          result[key as keyof ThingData] = thing[key as keyof ThingData]
        }
      }
      return result
    }

    if (exclude) {
      // Exclude specified fields (but never system fields)
      const result: ThingData = { ...thing }
      for (const key of exclude) {
        if (!systemFields.includes(key)) {
          delete (result as Record<string, unknown>)[key]
        }
      }
      return result
    }

    return thing
  }

  // =========================================================================
  // BATCH OPERATIONS
  // =========================================================================

  /**
   * Create multiple things at once
   */
  async createMany(type: string, items: Array<Record<string, unknown>>): Promise<ThingData[]> {
    const results: ThingData[] = []
    for (const data of items) {
      const thing = await this.create(type, data)
      results.push(thing)
    }
    return results
  }

  /**
   * Update multiple things matching a filter
   * @returns Number of updated things
   */
  async updateMany(
    type: string,
    filter: { where?: Record<string, unknown> },
    updates: Record<string, unknown>
  ): Promise<number> {
    const things = await this.list(type, { where: filter.where })
    let count = 0
    for (const thing of things) {
      await this.update(type, thing.$id, updates)
      count++
    }
    return count
  }

  /**
   * Delete multiple things matching a filter
   */
  async deleteMany(type: string, filter: { where?: Record<string, unknown> }): Promise<number> {
    const things = await this.list(type, { where: filter.where })
    let count = 0
    for (const thing of things) {
      const deleted = await this.delete(type, thing.$id)
      if (deleted) count++
    }
    return count
  }

  // =========================================================================
  // UPSERT OPERATION
  // =========================================================================

  /**
   * Create or update a thing (upsert)
   */
  async upsert(type: string, data: Record<string, unknown>): Promise<ThingData> {
    const id = data.$id as string
    if (!id) {
      return this.create(type, data)
    }

    const existing = this.get(id)
    if (existing) {
      return this.update(type, id, data)
    } else {
      return this.create(type, data)
    }
  }

  // =========================================================================
  // COUNT AND AGGREGATION
  // =========================================================================

  /**
   * Count things of a specific type with optional filtering
   */
  async count(type: string, query?: { where?: Record<string, unknown> }): Promise<number> {
    let sql = "SELECT COUNT(*) as count FROM things WHERE type = ? AND (json_extract(data, '$.$deletedAt') IS NULL)"
    const params: unknown[] = [type]

    if (query?.where) {
      const validatedWhere = validateWhereClause(query.where)
      const sqlWhere = buildSqlWhereClause(validatedWhere)

      if (sqlWhere.sql) {
        sql += ' AND ' + sqlWhere.sql
        params.push(...sqlWhere.params)
      }

      // If there are remaining where clauses, fall back to list and count
      if (sqlWhere.remainingWhere && Object.keys(sqlWhere.remainingWhere).length > 0) {
        const things = await this.list(type, query)
        return things.length
      }
    }

    const result = this.ctx.storage.sql.exec(sql, ...params).toArray()
    return (result[0]?.count as number) ?? 0
  }

  /**
   * Find the first thing matching the query
   */
  async findFirst(type: string, query?: ThingQueryOptions): Promise<ThingData | null> {
    const results = await this.list(type, { ...query, limit: 1 })
    return results.length > 0 ? results[0] : null
  }

  // =========================================================================
  // SOFT DELETE
  // =========================================================================

  /**
   * Soft delete a thing by ID
   */
  async softDeleteById(id: string): Promise<ThingData> {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Thing not found: ${id}`)
    }
    const now = new Date().toISOString()
    return this.update(existing.$type, id, { $deletedAt: now })
  }

  /**
   * Restore a soft-deleted thing by ID
   */
  async restoreById(id: string): Promise<ThingData> {
    // Need to get the thing even if it's deleted
    const rows = this.ctx.storage.sql.exec('SELECT data FROM things WHERE id = ?', id).toArray()
    if (rows.length === 0) {
      throw new Error(`Thing not found: ${id}`)
    }

    const existing = JSON.parse(rows[0].data as string) as ThingData
    const now = new Date().toISOString()

    const updated: ThingData = {
      ...existing,
      $deletedAt: undefined, // Clear deletion timestamp
      $updatedAt: now,
      $version: (existing.$version ?? 0) + 1,
    }

    // Store in memory
    this.things.set(id, updated)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `UPDATE things SET data = ?, updated_at = ?, version = ? WHERE id = ?`,
      JSON.stringify(updated),
      Date.now(),
      updated.$version,
      id
    )

    // Emit restored event
    this.emit(`${existing.$type}.restored`, updated)

    return updated
  }

  // =========================================================================
  // CACHE MANAGEMENT
  // =========================================================================

  /**
   * Clear the in-memory cache (for eviction simulation)
   * Note: Does not clear SQLite - things persist
   */
  clearCache(): void {
    this.things.clear()
  }

  /**
   * Get count of things in SQLite (for recovery stats)
   */
  getCount(): number {
    const result = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as count FROM things')
      .toArray()
    return (result[0]?.count as number) ?? 0
  }
}
