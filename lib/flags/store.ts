import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  flags,
  type Flag,
  type NewFlag,
  type ListFlagsOptions,
  type Branch,
  type Filter,
  type Stickiness,
  type FlagStatus,
} from '../../db/flags'

// ============================================================================
// FLAGSTORE - Flag Persistence Layer
// ============================================================================
//
// Provides CRUD operations for feature flags stored in DO SQLite via Drizzle.
// Handles validation, JSON serialization for branches/filters, and timestamps.
//
// ============================================================================

/** Type for the schema containing the flags table */
type FlagSchema = {
  flags: typeof flags
}

/** Valid stickiness values */
const VALID_STICKINESS: Stickiness[] = ['user_id', 'session_id', 'random']

/** Valid status values */
const VALID_STATUS: FlagStatus[] = ['active', 'disabled']

/** Valid filter operators */
const VALID_OPERATORS = ['eq', 'gt', 'lt', 'contains', 'in'] as const

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates a branch object
 */
function validateBranch(branch: unknown, index: number): void {
  if (!branch || typeof branch !== 'object') {
    throw new Error(`Branch at index ${index} must be an object`)
  }

  const b = branch as Record<string, unknown>

  if (typeof b.key !== 'string' || !b.key) {
    throw new Error(`Branch at index ${index} must have a string key`)
  }

  if (typeof b.weight !== 'number') {
    throw new Error(`Branch at index ${index} must have a numeric weight`)
  }

  if (b.weight < 0) {
    throw new Error(`Branch at index ${index} has negative weight`)
  }
}

/**
 * Validates a filter object
 */
function validateFilter(filter: unknown, index: number): void {
  if (!filter || typeof filter !== 'object') {
    throw new Error(`Filter at index ${index} must be an object`)
  }

  const f = filter as Record<string, unknown>

  if (typeof f.type !== 'string') {
    throw new Error(`Filter at index ${index} must have a type`)
  }

  if (f.type !== 'property' && f.type !== 'cohort') {
    throw new Error(`Filter at index ${index} has invalid type: ${f.type}`)
  }

  if (f.type === 'property' && f.operator !== undefined) {
    if (!VALID_OPERATORS.includes(f.operator as (typeof VALID_OPERATORS)[number])) {
      throw new Error(`Filter at index ${index} has invalid operator: ${f.operator}`)
    }
  }
}

/**
 * Validates a flag for create or update operations
 */
function validateFlag(flag: Partial<NewFlag>, isCreate: boolean): void {
  if (isCreate) {
    // Required field checks for create
    if (flag.id === null || flag.id === undefined || flag.id === '') {
      throw new Error('Flag id is required and cannot be empty')
    }

    if (flag.key === null || flag.key === undefined || flag.key === '') {
      throw new Error('Flag key is required and cannot be empty')
    }

    if (!Array.isArray(flag.branches) || flag.branches.length === 0) {
      throw new Error('Flag must have at least one branch')
    }
  }

  // Traffic validation (for both create and update if provided)
  if (flag.traffic !== undefined) {
    if (typeof flag.traffic !== 'number' || flag.traffic < 0 || flag.traffic > 1) {
      throw new Error('Traffic must be a number between 0 and 1')
    }
  }

  // Stickiness validation
  if (flag.stickiness !== undefined) {
    if (!VALID_STICKINESS.includes(flag.stickiness)) {
      throw new Error(`Invalid stickiness value: ${flag.stickiness}`)
    }
  }

  // Status validation
  if (flag.status !== undefined) {
    if (!VALID_STATUS.includes(flag.status)) {
      throw new Error(`Invalid status value: ${flag.status}`)
    }
  }

  // Branches validation
  if (flag.branches !== undefined) {
    if (!Array.isArray(flag.branches)) {
      throw new Error('Branches must be an array')
    }
    if (flag.branches.length === 0) {
      throw new Error('Flag must have at least one branch')
    }
    flag.branches.forEach((branch, index) => {
      validateBranch(branch, index)
    })
  }

  // Filters validation (optional)
  if (flag.filters !== undefined && flag.filters !== null) {
    if (!Array.isArray(flag.filters)) {
      throw new Error('Filters must be an array')
    }
    flag.filters.forEach((filter, index) => {
      validateFilter(filter, index)
    })
  }
}

/**
 * Converts a database row to a Flag entity
 */
function rowToFlag(row: typeof flags.$inferSelect): Flag {
  return {
    id: row.id,
    key: row.key,
    traffic: row.traffic,
    stickiness: row.stickiness as Stickiness,
    status: row.status as FlagStatus,
    branches: row.branches as Branch[],
    // Convert null to undefined for filters (null in DB means no filters)
    filters: row.filters === null ? undefined : (row.filters as Filter[]),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ============================================================================
// FLAGSTORE CLASS
// ============================================================================

/**
 * FlagStore provides CRUD operations for feature flags.
 *
 * Uses Drizzle ORM for SQLite persistence in Durable Objects.
 * Handles validation, JSON serialization, and timestamp management.
 */
export class FlagStore {
  constructor(private db: BetterSQLite3Database<FlagSchema>) {}

  /**
   * Create a new flag in storage.
   *
   * @param flag - The flag data to create (without timestamps)
   * @returns The created flag with generated timestamps
   * @throws Error if validation fails or flag ID already exists
   */
  async create(flag: NewFlag): Promise<Flag> {
    validateFlag(flag, true)

    const now = new Date()

    const result = await this.db
      .insert(flags)
      .values({
        id: flag.id,
        key: flag.key,
        traffic: flag.traffic,
        stickiness: flag.stickiness,
        status: flag.status,
        branches: flag.branches,
        filters: flag.filters ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return rowToFlag(result[0]!)
  }

  /**
   * Get a flag by ID.
   *
   * @param id - The flag ID to retrieve
   * @returns The flag or null if not found
   */
  async get(id: string): Promise<Flag | null> {
    const result = await this.db.select().from(flags).where(eq(flags.id, id))

    if (result.length === 0) {
      return null
    }

    return rowToFlag(result[0]!)
  }

  /**
   * Update an existing flag.
   *
   * @param id - The flag ID to update
   * @param updates - Partial flag data to merge
   * @returns The updated flag
   * @throws Error if flag not found or validation fails
   */
  async update(id: string, updates: Partial<NewFlag>): Promise<Flag> {
    // First get the existing flag
    const existing = await this.get(id)
    if (!existing) {
      throw new Error(`Flag not found: ${id}`)
    }

    // Validate the updates
    validateFlag(updates, false)

    const now = new Date()

    // Build the update object
    const updateData: Record<string, unknown> = {
      updatedAt: now,
    }

    if (updates.key !== undefined) {
      updateData.key = updates.key
    }
    if (updates.traffic !== undefined) {
      updateData.traffic = updates.traffic
    }
    if (updates.stickiness !== undefined) {
      updateData.stickiness = updates.stickiness
    }
    if (updates.status !== undefined) {
      updateData.status = updates.status
    }
    if (updates.branches !== undefined) {
      updateData.branches = updates.branches
    }
    if (updates.filters !== undefined) {
      updateData.filters = updates.filters
    }

    await this.db.update(flags).set(updateData).where(eq(flags.id, id))

    // Return the updated flag
    const updated = await this.get(id)
    return updated!
  }

  /**
   * Delete a flag by ID.
   *
   * @param id - The flag ID to delete
   * @returns true if flag was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id)
    if (!existing) {
      return false
    }

    await this.db.delete(flags).where(eq(flags.id, id))
    return true
  }

  /**
   * List flags with optional filters.
   *
   * @param options - Filter and pagination options
   * @returns Array of flags
   */
  async list(options: ListFlagsOptions = {}): Promise<Flag[]> {
    const { status, limit, offset } = options

    let query = this.db.select().from(flags)

    // Apply status filter
    if (status) {
      query = query.where(eq(flags.status, status)) as typeof query
    }

    // Apply pagination
    // Note: Drizzle's query builder returns all results, then we slice
    const results = await query

    let filtered = results.map(rowToFlag)

    // Apply offset
    if (offset !== undefined && offset > 0) {
      filtered = filtered.slice(offset)
    }

    // Apply limit
    if (limit !== undefined && limit > 0) {
      filtered = filtered.slice(0, limit)
    }

    return filtered
  }
}
