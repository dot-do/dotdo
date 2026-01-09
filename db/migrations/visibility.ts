import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { eq, and, isNull, desc, sql, inArray, ne, or, gt, lt } from 'drizzle-orm'
import { things, type Thing, type NewThing, type Visibility } from '../things'

// ============================================================================
// VISIBILITY MIGRATION TYPES
// ============================================================================

/**
 * Options for bulk visibility migration
 */
export interface MigrateVisibilityOptions {
  /** Filter: only migrate things with this current visibility */
  fromVisibility?: Visibility
  /** Target visibility to migrate to */
  toVisibility: Visibility
  /** Additional filter criteria */
  where?: {
    /** Filter by type (noun rowid) */
    type?: number
    /** Filter by ID pattern (exact match or array of IDs) */
    ids?: string | string[]
    /** Filter by branch (null = main branch) */
    branch?: string | null
  }
  /** If true, don't actually modify - just return what would change */
  dryRun?: boolean
  /** Batch size for processing (default: 100) */
  batchSize?: number
  /** Optional reason for audit trail */
  reason?: string
}

/**
 * Result of a visibility migration operation
 */
export interface MigrationResult {
  /** Number of things that would be/were affected */
  affectedCount: number
  /** List of affected thing IDs */
  affectedIds: string[]
  /** Whether this was a dry run */
  dryRun: boolean
  /** New versions created (rowids) */
  newVersions: number[]
  /** Migration change ID for rollback (if not dry run) */
  changeId?: string
  /** Timestamp of migration */
  timestamp: Date
  /** From visibility (if filtered) */
  fromVisibility?: Visibility
  /** To visibility */
  toVisibility: Visibility
  /** Reason for migration */
  reason?: string
}

/**
 * Record of a visibility change for audit trail
 */
export interface VisibilityChange {
  /** Unique identifier for this change */
  changeId: string
  /** Thing ID that was changed */
  thingId: string
  /** Previous visibility */
  fromVisibility: Visibility
  /** New visibility */
  toVisibility: Visibility
  /** Version (rowid) before the change */
  fromVersion: number
  /** Version (rowid) after the change */
  toVersion: number
  /** When the change was made */
  timestamp: Date
  /** Optional reason for the change */
  reason?: string
  /** Whether this change has been rolled back */
  rolledBack: boolean
  /** Change ID of the rollback (if rolled back) */
  rollbackChangeId?: string
}

/**
 * Statistics about visibility distribution
 */
export interface VisibilityStats {
  /** Count by visibility level */
  byVisibility: Record<Visibility, number>
  /** Total things count */
  total: number
  /** Things with null/missing visibility */
  nullVisibility: number
  /** Timestamp of stats calculation */
  timestamp: Date
}

// ============================================================================
// VISIBILITY CHANGE LOG TABLE
// ============================================================================

/**
 * Visibility change log for audit trail and rollback support.
 * This table tracks all visibility changes made through migration utilities.
 */
export const visibilityChanges = sqliteTable(
  'visibility_changes',
  {
    // Identity
    id: text('id').primaryKey(), // UUID for external reference

    // Change details
    thingId: text('thing_id').notNull(),
    fromVisibility: text('from_visibility').$type<Visibility>().notNull(),
    toVisibility: text('to_visibility').$type<Visibility>().notNull(),

    // Version references (rowids into things table)
    fromVersion: integer('from_version').notNull(),
    toVersion: integer('to_version').notNull(),

    // Audit metadata
    reason: text('reason'),
    migratedAt: integer('migrated_at', { mode: 'timestamp' }).notNull(),

    // Rollback tracking
    rolledBack: integer('rolled_back', { mode: 'boolean' }).default(false),
    rollbackChangeId: text('rollback_change_id'),

    // Batch reference (for bulk migrations)
    batchId: text('batch_id'),
  },
  (table) => [
    index('visibility_changes_thing_idx').on(table.thingId),
    index('visibility_changes_batch_idx').on(table.batchId),
    index('visibility_changes_migrated_idx').on(table.migratedAt),
  ],
)

/** Type for selecting visibility changes */
export type VisibilityChangeRecord = typeof visibilityChanges.$inferSelect

/** Type for inserting visibility changes */
export type NewVisibilityChangeRecord = typeof visibilityChanges.$inferInsert

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Database interface required for visibility migration utilities.
 * Extends the ThingsDb interface with additional capabilities.
 */
export interface VisibilityMigrationDb {
  select(): {
    from(table: typeof things | typeof visibilityChanges): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(n: number): Promise<unknown[]>
        }
      }
    }
  }
  insert(table: typeof things | typeof visibilityChanges): {
    values(values: NewThing | NewThing[] | NewVisibilityChangeRecord | NewVisibilityChangeRecord[]): {
      returning(): Promise<unknown[]>
    }
  }
  update(table: typeof visibilityChanges): {
    set(values: Partial<VisibilityChangeRecord>): {
      where(condition: unknown): Promise<unknown>
    }
  }
  // For raw SQL queries (stats, etc.)
  run?(query: unknown): Promise<unknown>
  all?(query: unknown): Promise<unknown[]>
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a UUID v4 for change IDs
 */
function generateChangeId(): string {
  return crypto.randomUUID()
}

/**
 * Get current timestamp
 */
function now(): Date {
  return new Date()
}

// ============================================================================
// CORE MIGRATION FUNCTIONS
// ============================================================================

/**
 * Migrate visibility for things matching criteria.
 *
 * This function creates new versions of affected things with updated visibility.
 * All changes are logged to the visibility_changes table for audit trail and rollback.
 *
 * @param db - Database instance
 * @param opts - Migration options
 * @returns Migration result with affected IDs and change IDs
 *
 * @example
 * ```ts
 * // Migrate all 'user' visibility things to 'org' (dry run first)
 * const preview = await migrateVisibility(db, {
 *   fromVisibility: 'user',
 *   toVisibility: 'org',
 *   dryRun: true
 * })
 *
 * // Actually perform the migration
 * const result = await migrateVisibility(db, {
 *   fromVisibility: 'user',
 *   toVisibility: 'org',
 *   reason: 'Initial migration to org visibility'
 * })
 * ```
 */
export async function migrateVisibility(
  db: VisibilityMigrationDb,
  opts: MigrateVisibilityOptions
): Promise<MigrationResult> {
  const {
    fromVisibility,
    toVisibility,
    where = {},
    dryRun = false,
    batchSize = 100,
    reason,
  } = opts

  const timestamp = now()
  const batchId = generateChangeId()

  // Build query conditions
  const conditions: unknown[] = []

  // Filter by source visibility if specified
  if (fromVisibility !== undefined) {
    conditions.push(eq(things.visibility, fromVisibility))
  }

  // Filter by type if specified
  if (where.type !== undefined) {
    conditions.push(eq(things.type, where.type))
  }

  // Filter by IDs if specified
  if (where.ids !== undefined) {
    if (Array.isArray(where.ids)) {
      conditions.push(inArray(things.id, where.ids))
    } else {
      conditions.push(eq(things.id, where.ids))
    }
  }

  // Filter by branch if specified
  if (where.branch === null) {
    conditions.push(isNull(things.branch))
  } else if (where.branch !== undefined) {
    conditions.push(eq(things.branch, where.branch))
  }

  // Exclude already matching visibility
  conditions.push(ne(things.visibility, toVisibility))

  // Exclude soft-deleted things
  conditions.push(eq(things.deleted, false))

  // Build the condition (handle empty conditions array)
  const condition = conditions.length > 0
    ? conditions.length > 1
      ? and(...(conditions as Parameters<typeof and>))
      : conditions[0]
    : undefined

  // Get affected things using window function pattern to get current versions
  // We need to get unique current versions (latest rowid per id)
  const affectedThings = await db
    .select()
    .from(things)
    .where(condition as ReturnType<typeof eq>)
    .orderBy(desc(things.id))
    .limit(batchSize * 10) as Thing[] // Get more to handle duplicates

  // Deduplicate to get only current versions (first occurrence per id)
  const seenIds = new Set<string>()
  const currentVersions = affectedThings.filter((thing) => {
    if (seenIds.has(thing.id)) {
      return false
    }
    seenIds.add(thing.id)
    return true
  }).slice(0, batchSize)

  const affectedIds = currentVersions.map((t) => t.id)
  const affectedCount = affectedIds.length

  // If dry run, return preview
  if (dryRun) {
    return {
      affectedCount,
      affectedIds,
      dryRun: true,
      newVersions: [],
      timestamp,
      fromVisibility,
      toVisibility,
      reason,
    }
  }

  // If no things to migrate, return early
  if (affectedCount === 0) {
    return {
      affectedCount: 0,
      affectedIds: [],
      dryRun: false,
      newVersions: [],
      changeId: batchId,
      timestamp,
      fromVisibility,
      toVisibility,
      reason,
    }
  }

  // Create new versions with updated visibility
  const newVersions: number[] = []
  const changeRecords: NewVisibilityChangeRecord[] = []

  for (const thing of currentVersions) {
    // Create new version with updated visibility
    const newVersion: NewThing = {
      id: thing.id,
      type: thing.type,
      branch: thing.branch,
      name: thing.name,
      data: thing.data,
      deleted: thing.deleted,
      visibility: toVisibility,
    }

    // Insert new version
    const [inserted] = await db
      .insert(things)
      .values(newVersion)
      .returning() as Thing[]

    // Get the new rowid (we need to query for it since SQLite doesn't return rowid directly)
    // For now, we'll use a placeholder - in real implementation, use lastInsertRowId
    const newRowid = inserted ? Date.now() : 0 // Placeholder - real impl uses lastInsertRowId
    newVersions.push(newRowid)

    // Record the change
    changeRecords.push({
      id: generateChangeId(),
      thingId: thing.id,
      fromVisibility: thing.visibility ?? 'user',
      toVisibility,
      fromVersion: 0, // Would be thing's actual rowid
      toVersion: newRowid,
      reason,
      migratedAt: timestamp,
      rolledBack: false,
      batchId,
    })
  }

  // Insert change records for audit trail
  if (changeRecords.length > 0) {
    await db
      .insert(visibilityChanges)
      .values(changeRecords)
      .returning()
  }

  return {
    affectedCount,
    affectedIds,
    dryRun: false,
    newVersions,
    changeId: batchId,
    timestamp,
    fromVisibility,
    toVisibility,
    reason,
  }
}

/**
 * Get visibility change history for a specific thing.
 *
 * Returns all recorded visibility changes for the thing, ordered by timestamp.
 *
 * @param db - Database instance
 * @param thingId - ID of the thing to get history for
 * @returns Array of visibility changes
 *
 * @example
 * ```ts
 * const history = await getVisibilityHistory(db, 'customer-001')
 * console.log(history)
 * // [
 * //   { changeId: '...', fromVisibility: 'user', toVisibility: 'org', ... },
 * //   { changeId: '...', fromVisibility: 'org', toVisibility: 'public', ... }
 * // ]
 * ```
 */
export async function getVisibilityHistory(
  db: VisibilityMigrationDb,
  thingId: string
): Promise<VisibilityChange[]> {
  const results = await db
    .select()
    .from(visibilityChanges)
    .where(eq(visibilityChanges.thingId, thingId))
    .orderBy(desc(visibilityChanges.migratedAt))
    .limit(1000) as VisibilityChangeRecord[]

  return results.map((record) => ({
    changeId: record.id,
    thingId: record.thingId,
    fromVisibility: record.fromVisibility,
    toVisibility: record.toVisibility,
    fromVersion: record.fromVersion,
    toVersion: record.toVersion,
    timestamp: record.migratedAt,
    reason: record.reason ?? undefined,
    rolledBack: record.rolledBack ?? false,
    rollbackChangeId: record.rollbackChangeId ?? undefined,
  }))
}

/**
 * Rollback a specific visibility change.
 *
 * This creates a new version with the original visibility and marks the change as rolled back.
 *
 * @param db - Database instance
 * @param changeId - ID of the visibility change to rollback
 * @returns The new change record for the rollback
 *
 * @throws Error if change not found or already rolled back
 *
 * @example
 * ```ts
 * // Rollback a specific change
 * const rollback = await rollbackVisibilityChange(db, 'change-uuid')
 * ```
 */
export async function rollbackVisibilityChange(
  db: VisibilityMigrationDb,
  changeId: string
): Promise<VisibilityChange> {
  // Get the change record
  const [change] = await db
    .select()
    .from(visibilityChanges)
    .where(eq(visibilityChanges.id, changeId))
    .orderBy(desc(visibilityChanges.migratedAt))
    .limit(1) as VisibilityChangeRecord[]

  if (!change) {
    throw new Error(`Visibility change not found: ${changeId}`)
  }

  if (change.rolledBack) {
    throw new Error(`Visibility change already rolled back: ${changeId}`)
  }

  // Get the current version of the thing
  const [currentThing] = await db
    .select()
    .from(things)
    .where(eq(things.id, change.thingId))
    .orderBy(desc(things.id))
    .limit(1) as Thing[]

  if (!currentThing) {
    throw new Error(`Thing not found: ${change.thingId}`)
  }

  const timestamp = now()
  const rollbackChangeId = generateChangeId()

  // Create new version with original visibility
  const newVersion: NewThing = {
    id: currentThing.id,
    type: currentThing.type,
    branch: currentThing.branch,
    name: currentThing.name,
    data: currentThing.data,
    deleted: currentThing.deleted,
    visibility: change.fromVisibility,
  }

  const [inserted] = await db
    .insert(things)
    .values(newVersion)
    .returning() as Thing[]

  const newRowid = inserted ? Date.now() : 0 // Placeholder

  // Mark original change as rolled back
  await db
    .update(visibilityChanges)
    .set({
      rolledBack: true,
      rollbackChangeId,
    })
    .where(eq(visibilityChanges.id, changeId))

  // Create rollback change record
  const rollbackRecord: NewVisibilityChangeRecord = {
    id: rollbackChangeId,
    thingId: change.thingId,
    fromVisibility: change.toVisibility,
    toVisibility: change.fromVisibility,
    fromVersion: change.toVersion,
    toVersion: newRowid,
    reason: `Rollback of change ${changeId}`,
    migratedAt: timestamp,
    rolledBack: false,
    batchId: `rollback-${changeId}`,
  }

  await db
    .insert(visibilityChanges)
    .values(rollbackRecord)
    .returning()

  return {
    changeId: rollbackChangeId,
    thingId: change.thingId,
    fromVisibility: change.toVisibility,
    toVisibility: change.fromVisibility,
    fromVersion: change.toVersion,
    toVersion: newRowid,
    timestamp,
    reason: rollbackRecord.reason ?? undefined,
    rolledBack: false,
  }
}

/**
 * Rollback all changes from a batch migration.
 *
 * @param db - Database instance
 * @param batchId - ID of the batch to rollback
 * @returns Array of rollback change records
 *
 * @example
 * ```ts
 * const result = await migrateVisibility(db, { ... })
 * // Later, rollback the entire batch
 * const rollbacks = await rollbackBatch(db, result.changeId!)
 * ```
 */
export async function rollbackBatch(
  db: VisibilityMigrationDb,
  batchId: string
): Promise<VisibilityChange[]> {
  // Get all changes in the batch that haven't been rolled back
  const batchChanges = await db
    .select()
    .from(visibilityChanges)
    .where(and(
      eq(visibilityChanges.batchId, batchId),
      eq(visibilityChanges.rolledBack, false)
    ))
    .orderBy(desc(visibilityChanges.migratedAt))
    .limit(1000) as VisibilityChangeRecord[]

  const rollbacks: VisibilityChange[] = []

  for (const change of batchChanges) {
    const rollback = await rollbackVisibilityChange(db, change.id)
    rollbacks.push(rollback)
  }

  return rollbacks
}

// ============================================================================
// STATISTICS AND REPORTING
// ============================================================================

/**
 * Get visibility statistics for all things.
 *
 * @param db - Database instance
 * @returns Visibility distribution statistics
 *
 * @example
 * ```ts
 * const stats = await getVisibilityStats(db)
 * console.log(stats)
 * // {
 * //   byVisibility: { public: 100, unlisted: 50, org: 200, user: 1000 },
 * //   total: 1350,
 * //   nullVisibility: 0,
 * //   timestamp: Date
 * // }
 * ```
 */
export async function getVisibilityStats(
  db: VisibilityMigrationDb
): Promise<VisibilityStats> {
  const timestamp = now()

  // Get counts by visibility
  // This is a simplified implementation - real impl would use COUNT/GROUP BY
  const allThings = await db
    .select()
    .from(things)
    .where(eq(things.deleted, false))
    .orderBy(desc(things.id))
    .limit(100000) as Thing[]

  // Deduplicate to get current versions only
  const seenIds = new Set<string>()
  const currentThings = allThings.filter((thing) => {
    if (seenIds.has(thing.id)) {
      return false
    }
    seenIds.add(thing.id)
    return true
  })

  const stats: VisibilityStats = {
    byVisibility: {
      public: 0,
      unlisted: 0,
      org: 0,
      user: 0,
    },
    total: currentThings.length,
    nullVisibility: 0,
    timestamp,
  }

  for (const thing of currentThings) {
    const visibility = thing.visibility
    if (visibility === null || visibility === undefined) {
      stats.nullVisibility++
    } else if (visibility in stats.byVisibility) {
      stats.byVisibility[visibility]++
    }
  }

  return stats
}

/**
 * Find things with null/missing visibility.
 *
 * Used for identifying data that needs migration to have explicit visibility.
 *
 * @param db - Database instance
 * @param limit - Maximum number of results
 * @returns Array of thing IDs with null visibility
 */
export async function findNullVisibilityThings(
  db: VisibilityMigrationDb,
  limit: number = 100
): Promise<string[]> {
  const results = await db
    .select()
    .from(things)
    .where(and(
      isNull(things.visibility),
      eq(things.deleted, false)
    ))
    .orderBy(desc(things.id))
    .limit(limit) as Thing[]

  // Deduplicate
  const seenIds = new Set<string>()
  return results.filter((thing) => {
    if (seenIds.has(thing.id)) {
      return false
    }
    seenIds.add(thing.id)
    return true
  }).map((t) => t.id)
}

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

/**
 * Migrate all things with null visibility to 'user' (secure by default).
 *
 * This is the recommended first migration to ensure all existing data
 * has explicit visibility set.
 *
 * @param db - Database instance
 * @param opts - Optional migration options
 * @returns Migration result
 *
 * @example
 * ```ts
 * // Preview what would be migrated
 * const preview = await migrateNullToUserVisibility(db, { dryRun: true })
 *
 * // Actually migrate
 * const result = await migrateNullToUserVisibility(db)
 * ```
 */
export async function migrateNullToUserVisibility(
  db: VisibilityMigrationDb,
  opts: Omit<MigrateVisibilityOptions, 'fromVisibility' | 'toVisibility'> = {}
): Promise<MigrationResult> {
  // Find things with null visibility
  const nullVisibilityIds = await findNullVisibilityThings(db, opts.batchSize ?? 1000)

  if (nullVisibilityIds.length === 0) {
    return {
      affectedCount: 0,
      affectedIds: [],
      dryRun: opts.dryRun ?? false,
      newVersions: [],
      changeId: generateChangeId(),
      timestamp: now(),
      toVisibility: 'user',
      reason: opts.reason ?? 'Migrate null visibility to user (secure by default)',
    }
  }

  return migrateVisibility(db, {
    ...opts,
    toVisibility: 'user',
    where: {
      ...opts.where,
      ids: nullVisibilityIds,
    },
    reason: opts.reason ?? 'Migrate null visibility to user (secure by default)',
  })
}

/**
 * Promote things to a less restrictive visibility level.
 *
 * Visibility levels from most to least restrictive:
 * 1. 'user' - only owner can see
 * 2. 'org' - organization members can see
 * 3. 'unlisted' - anyone with link can see
 * 4. 'public' - everyone can see
 *
 * @param db - Database instance
 * @param opts - Promotion options
 * @returns Migration result
 */
export async function promoteVisibility(
  db: VisibilityMigrationDb,
  opts: MigrateVisibilityOptions
): Promise<MigrationResult> {
  const visibilityOrder: Visibility[] = ['user', 'org', 'unlisted', 'public']

  const fromIndex = opts.fromVisibility
    ? visibilityOrder.indexOf(opts.fromVisibility)
    : -1
  const toIndex = visibilityOrder.indexOf(opts.toVisibility)

  if (fromIndex >= toIndex && opts.fromVisibility !== undefined) {
    throw new Error(
      `Cannot promote from '${opts.fromVisibility}' to '${opts.toVisibility}' - ` +
      `target must be less restrictive than source`
    )
  }

  return migrateVisibility(db, {
    ...opts,
    reason: opts.reason ?? `Promote visibility to ${opts.toVisibility}`,
  })
}

/**
 * Restrict things to a more restrictive visibility level.
 *
 * @param db - Database instance
 * @param opts - Restriction options
 * @returns Migration result
 */
export async function restrictVisibility(
  db: VisibilityMigrationDb,
  opts: MigrateVisibilityOptions
): Promise<MigrationResult> {
  const visibilityOrder: Visibility[] = ['user', 'org', 'unlisted', 'public']

  const fromIndex = opts.fromVisibility
    ? visibilityOrder.indexOf(opts.fromVisibility)
    : 4 // Treat undefined as "any"
  const toIndex = visibilityOrder.indexOf(opts.toVisibility)

  if (fromIndex <= toIndex && opts.fromVisibility !== undefined) {
    throw new Error(
      `Cannot restrict from '${opts.fromVisibility}' to '${opts.toVisibility}' - ` +
      `target must be more restrictive than source`
    )
  }

  return migrateVisibility(db, {
    ...opts,
    reason: opts.reason ?? `Restrict visibility to ${opts.toVisibility}`,
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Re-export Visibility type from things.ts for convenience
  type Visibility,
}
