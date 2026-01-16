/**
 * Storage Operations Module - Thing CRUD operations
 *
 * This module contains:
 * - Thing CRUD operations (create, read, update, delete, list)
 * - SQLite persistence for things
 * - Event emission on thing changes
 * - Query validation and filtering
 */

import {
  assertValidCreateThingInput,
  ThingValidationError,
} from '../lib/validation/thing-validation'
import {
  validateWhereClause,
  matchesWhere,
  buildSqlWhereClause,
  QueryValidationError,
} from './query-validation'
import { generateThingId } from './event-system'
import type { ThingData } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Interface for event emission (used by ThingStore)
 */
export interface EventEmitter {
  send(eventType: string, data: unknown): string
}

/**
 * Query options for listing things
 */
export interface ThingQueryOptions {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
}

// ============================================================================
// Thing Store Class
// ============================================================================

/**
 * ThingStore handles Thing CRUD operations with SQLite persistence
 * This is a helper class that DOCore uses to manage Things
 */
export class ThingStore {
  private things: Map<string, ThingData> = new Map()

  constructor(
    private ctx: DurableObjectState,
    private eventEmitter?: EventEmitter
  ) {}

  /**
   * Initialize the things table in SQLite
   */
  initTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT,
        data TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        version INTEGER DEFAULT 1
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type)
    `)
  }

  /**
   * Set the event emitter for thing change notifications
   */
  setEventEmitter(emitter: EventEmitter): void {
    this.eventEmitter = emitter
  }

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

    // Store in memory
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
    if (this.eventEmitter) {
      this.eventEmitter.send(`${type}.created`, thing)
    }

    return thing
  }

  /**
   * List things of a specific type with optional filtering
   * @param type The thing type to list
   * @param query Optional query options (where, limit, offset)
   * @returns Array of matching things
   */
  async list(type: string, query?: ThingQueryOptions): Promise<ThingData[]> {
    let sql = 'SELECT data FROM things WHERE type = ?'
    const params: unknown[] = [type]

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

    return results
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
   * Update a thing
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

    const now = new Date().toISOString()
    const updated: ThingData = {
      ...existing,
      ...updates,
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
    if (this.eventEmitter) {
      this.eventEmitter.send(`${type}.updated`, updated)
    }

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
   * Delete a thing
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
    if (this.eventEmitter) {
      this.eventEmitter.send(`${type}.deleted`, { $id: id })
    }

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

  /**
   * Clear the in-memory cache (for eviction simulation)
   * Note: Does not clear SQLite - things persist
   */
  clearCache(): void {
    this.things.clear()
  }

  /**
   * Get count of things in SQLite
   */
  getCount(): number {
    const result = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as count FROM things')
      .toArray()
    return (result[0]?.count as number) ?? 0
  }
}
