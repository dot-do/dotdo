/**
 * @module db/things
 *
 * Core versioned data storage for the dotdo platform.
 *
 * Things are the fundamental data abstraction in dotdo - versioned, typed entities
 * stored in an append-only log. Each row represents a version, with the SQLite rowid
 * serving as the version identifier. This enables time travel, branching, and
 * complete audit trails.
 *
 * ## Key Concepts
 *
 * - **Append-only**: Things are never mutated; new versions are appended
 * - **Version = rowid**: The SQLite rowid serves as the version identifier
 * - **Branching**: Things can exist on multiple branches (null = main branch)
 * - **Soft delete**: Deleted things have deleted=true, enabling undelete
 * - **Visibility**: Access control via public/unlisted/org/user levels
 *
 * ## Usage Patterns
 *
 * @example Get current version of a thing
 * ```ts
 * import { getCurrentThing, things } from 'dotdo/db'
 *
 * const user = await getCurrentThing(db, 'user-123')
 * console.log(user?.name, user?.data)
 * ```
 *
 * @example Time travel to a specific version
 * ```ts
 * import { getThingAtVersion } from 'dotdo/db'
 *
 * const oldVersion = await getThingAtVersion(db, 42)
 * console.log('State at version 42:', oldVersion)
 * ```
 *
 * @example List things with filters
 * ```ts
 * import { getCurrentThings } from 'dotdo/db'
 *
 * const publicFunctions = await getCurrentThings(db, {
 *   type: 1, // Function type ID
 *   visibility: 'public',
 *   limit: 50,
 * })
 * ```
 *
 * @example Branch-aware queries
 * ```ts
 * import { getThingOnBranch, getCurrentThing } from 'dotdo/db'
 *
 * // Get thing on main branch
 * const main = await getCurrentThing(db, 'config', null)
 *
 * // Get thing on experiment branch
 * const experiment = await getThingOnBranch(db, 'config', 'experiment')
 * ```
 *
 * @see {@link stores.ts} for ThingsStore class with CRUD operations
 * @see {@link nouns.ts} for type definitions (Noun → type ID mapping)
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { eq, and, isNull, desc, sql, inArray, type SQL } from 'drizzle-orm'

// ============================================================================
// VISIBILITY TYPE
// ============================================================================

/**
 * Valid visibility values for things.
 *
 * Controls who can access a thing:
 * - `'public'` - Visible to everyone, including anonymous users
 * - `'unlisted'` - Not discoverable, but accessible with direct link
 * - `'org'` - Visible only to organization members
 * - `'user'` - Visible only to the owner (most restrictive, default)
 *
 * @example
 * ```ts
 * // Query only public resources
 * const publicApis = await getCurrentThings(db, {
 *   visibility: 'public',
 * })
 *
 * // Query resources visible to org or public
 * const accessibleApis = await getCurrentThings(db, {
 *   visibility: ['public', 'org'],
 * })
 * ```
 */
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

// ============================================================================
// THINGS - Version Log (append-only)
// ============================================================================

/**
 * The things table - core versioned entity storage.
 *
 * Things are versioned, not mutated. Each row is a version.
 * The SQLite rowid IS the version ID.
 *
 * ## SQL Patterns
 *
 * ```sql
 * -- Time travel: Get thing at specific version
 * SELECT * FROM things WHERE rowid = ?
 *
 * -- Current state: Get latest version of a thing
 * SELECT * FROM things WHERE id = ? ORDER BY rowid DESC LIMIT 1
 *
 * -- Version history: Get all versions of a thing
 * SELECT rowid as version, * FROM things WHERE id = ? ORDER BY rowid ASC
 * ```
 *
 * ## Design Notes
 *
 * - No createdAt/updatedAt/createdBy columns - all derived from the Action
 *   that created this version (see actions.ts)
 * - Branch null = main branch (optimized for common case)
 * - Type is FK to nouns.rowid (integer for join performance)
 *
 * @example Direct Drizzle query
 * ```ts
 * import { things } from 'dotdo/db'
 * import { eq, desc } from 'drizzle-orm'
 *
 * // Get latest version of a thing
 * const results = await db
 *   .select()
 *   .from(things)
 *   .where(eq(things.id, 'user-123'))
 *   .orderBy(desc(things.id))
 *   .limit(1)
 * ```
 */
export const things = sqliteTable(
  'things',
  {
    // rowid is implicit in SQLite and serves as version ID

    // Identity
    id: text('id').notNull(), // Local path: 'acme', 'headless.ly'
    type: integer('type').notNull(), // FK → nouns.rowid

    // Branch (null = main)
    branch: text('branch'), // 'main', 'experiment', null = main

    // Core fields
    name: text('name'),
    data: text('data', { mode: 'json' }),

    // Soft delete marker (version where thing was deleted)
    deleted: integer('deleted', { mode: 'boolean' }).default(false),

    // Visibility controls who can see this thing
    // 'public' - visible to everyone (including anonymous)
    // 'unlisted' - not discoverable, but accessible with direct link
    // 'org' - visible to organization members only
    // 'user' - visible only to the owner (most restrictive - DEFAULT)
    visibility: text('visibility').$type<Visibility>().default('user'),
  },
  (table) => [
    // Primary lookup indexes
    index('things_id_idx').on(table.id),
    index('things_type_idx').on(table.type),
    index('things_branch_idx').on(table.branch),
    index('things_id_branch_idx').on(table.id, table.branch),

    // Visibility indexes - optimized for partition pruning strategy (ns, type, visibility)
    // See: streams/partitions.md for partition strategy documentation
    index('things_visibility_idx').on(table.visibility),

    // Composite: visibility + type for listing public/org resources by type
    // Supports: "List all public Functions", "List all org Schemas"
    index('things_visibility_type_idx').on(table.visibility, table.type),

    // Composite: type + visibility for type-first queries with visibility filter
    // Supports: "List Functions where visibility = public"
    // Matches Iceberg partition order (after ns): type before visibility
    index('things_type_visibility_idx').on(table.type, table.visibility),
  ],
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type for a selected Thing record (all fields).
 *
 * Inferred from the things table schema. Use this type when working
 * with Things retrieved from the database.
 *
 * @example
 * ```ts
 * import type { Thing } from 'dotdo/db'
 *
 * function processThing(thing: Thing) {
 *   console.log(`ID: ${thing.id}, Type: ${thing.type}`)
 *   if (thing.data) {
 *     console.log('Data:', JSON.stringify(thing.data))
 *   }
 * }
 * ```
 */
export type Thing = typeof things.$inferSelect

/**
 * Type for inserting a new Thing record.
 *
 * Inferred from the things table schema with optional fields marked.
 * Use this type when creating new Things.
 *
 * @example
 * ```ts
 * import type { NewThing } from 'dotdo/db'
 *
 * const newUser: NewThing = {
 *   id: 'user-123',
 *   type: 1, // User type ID
 *   name: 'John Doe',
 *   data: { email: 'john@example.com' },
 * }
 * ```
 */
export type NewThing = typeof things.$inferInsert

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Database interface required for query helpers.
 *
 * This interface abstracts the database operations needed by the query helpers,
 * allowing them to work with any Drizzle database instance (D1, better-sqlite3,
 * or mock implementations for testing).
 *
 * @example Using with a real database
 * ```ts
 * import { drizzle } from 'drizzle-orm/d1'
 * import { getCurrentThing } from 'dotdo/db'
 *
 * const db = drizzle(env.DB) as ThingsDb
 * const thing = await getCurrentThing(db, 'user-123')
 * ```
 *
 * @example Mock implementation for testing
 * ```ts
 * const mockDb: ThingsDb = {
 *   select: () => ({
 *     from: () => ({
 *       where: () => ({
 *         orderBy: () => ({
 *           limit: async () => [mockThing],
 *         }),
 *       }),
 *     }),
 *   }),
 *   insert: () => ({ values: () => ({ returning: async () => [mockThing] }) }),
 * }
 * ```
 */
export interface ThingsDb {
  select(): {
    from(table: typeof things): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(n: number): Promise<Thing[]>
        }
      }
    }
  }
  /** Select specific columns/expressions (used for COUNT queries) */
  select<T extends Record<string, unknown>>(fields: T): {
    from(table: typeof things): {
      where(condition: unknown): Promise<{ [K in keyof T]: unknown }[]>
    }
  }
  insert(table: typeof things): {
    values(values: NewThing): {
      returning(): Promise<Thing[]>
    }
  }
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Options for getCurrentThing query.
 *
 * @example Filter by visibility
 * ```ts
 * // Get only if publicly visible
 * const thing = await getCurrentThing(db, 'api-123', null, {
 *   visibility: 'public',
 * })
 *
 * // Get if visible to org or public
 * const thing = await getCurrentThing(db, 'api-123', null, {
 *   visibility: ['public', 'org'],
 * })
 * ```
 */
export interface GetCurrentThingOptions {
  /** Filter by visibility level(s). Can be a single visibility or an array. */
  visibility?: Visibility | Visibility[]
}

/**
 * Get the current version of a thing by ID.
 *
 * Returns the latest version of a thing on the specified branch.
 * Uses the rowid ordering to efficiently find the most recent version.
 *
 * ## SQL Pattern
 * ```sql
 * SELECT * FROM things
 * WHERE id = ? AND branch IS NULL
 * ORDER BY rowid DESC
 * LIMIT 1
 * ```
 *
 * @param db - Drizzle database instance
 * @param id - The thing ID to look up
 * @param branch - Optional branch name (null = main branch)
 * @param options - Optional query options (visibility filter)
 * @returns The current version of the thing or undefined if not found
 *
 * @example Basic usage
 * ```ts
 * const user = await getCurrentThing(db, 'user-123')
 * if (user) {
 *   console.log(`Found: ${user.name}`)
 * }
 * ```
 *
 * @example With branch and visibility
 * ```ts
 * const config = await getCurrentThing(db, 'app-config', 'staging', {
 *   visibility: ['org', 'public'],
 * })
 * ```
 */
export async function getCurrentThing(
  db: ThingsDb,
  id: string,
  branch: string | null = null,
  options: GetCurrentThingOptions = {}
): Promise<Thing | undefined> {
  const { visibility } = options

  // Build conditions array
  const conditions: SQL[] = [eq(things.id, id)]

  if (branch === null) {
    conditions.push(isNull(things.branch))
  } else {
    conditions.push(eq(things.branch, branch))
  }

  // Add visibility filter
  if (visibility !== undefined) {
    if (Array.isArray(visibility)) {
      conditions.push(inArray(things.visibility, visibility))
    } else {
      conditions.push(eq(things.visibility, visibility))
    }
  }

  const condition = and(...conditions)

  const results = await db
    .select()
    .from(things)
    .where(condition)
    .orderBy(desc(things.id)) // Using id as proxy for rowid in mock; actual impl uses rowid
    .limit(1)

  return results[0]
}

/**
 * Get a thing at a specific version (rowid).
 *
 * Used for time travel queries - retrieve the exact state of a thing
 * at a specific point in its version history.
 *
 * ## SQL Pattern
 * ```sql
 * SELECT * FROM things WHERE rowid = ?
 * ```
 *
 * @param db - Drizzle database instance
 * @param rowid - The version (rowid) to retrieve
 * @returns The thing at the specified version or undefined if not found
 *
 * @example Time travel to inspect historical state
 * ```ts
 * // Get the thing as it was at version 42
 * const historicalState = await getThingAtVersion(db, 42)
 * if (historicalState) {
 *   console.log('State at version 42:', historicalState.data)
 * }
 * ```
 *
 * @example Implement undo functionality
 * ```ts
 * // Get previous version and revert
 * const versions = await getThingVersions(db, 'doc-123')
 * const previousVersion = versions[versions.length - 2]
 * if (previousVersion) {
 *   // Revert by copying the previous state
 *   await things.create({ ...previousVersion })
 * }
 * ```
 */
export async function getThingAtVersion(
  db: ThingsDb,
  rowid: number
): Promise<Thing | undefined> {
  const results = await db
    .select()
    .from(things)
    .where(sql`rowid = ${rowid}`)
    .orderBy(desc(things.id))
    .limit(1)

  return results[0]
}

/**
 * Get all versions of a thing.
 *
 * Returns the complete version history of a thing, ordered from oldest
 * to newest. Useful for auditing, debugging, and implementing version
 * comparison features.
 *
 * ## SQL Pattern
 * ```sql
 * SELECT rowid, * FROM things WHERE id = ? ORDER BY rowid ASC
 * ```
 *
 * @param db - Drizzle database instance
 * @param id - The thing ID to get versions for
 * @returns Array of all versions of the thing (oldest first)
 *
 * @example Display version history
 * ```ts
 * const versions = await getThingVersions(db, 'doc-123')
 * console.log(`Document has ${versions.length} versions`)
 *
 * for (const version of versions) {
 *   console.log(`Version ${version.id}: ${version.name}`)
 * }
 * ```
 *
 * @example Diff between versions
 * ```ts
 * const versions = await getThingVersions(db, 'config')
 * const [v1, v2] = [versions[0], versions[1]]
 * if (v1 && v2) {
 *   const diff = computeDiff(v1.data, v2.data)
 *   console.log('Changes:', diff)
 * }
 * ```
 */
export async function getThingVersions(
  db: ThingsDb,
  id: string
): Promise<Thing[]> {
  const results = await db
    .select()
    .from(things)
    .where(eq(things.id, id))
    .orderBy(things.id) // ASC order for version history
    .limit(1000) // Safety limit

  return results
}

/**
 * Get the current version of a thing on a specific branch.
 *
 * Used for branch-aware queries when you need to read from a non-main branch.
 * Unlike getCurrentThing with branch parameter, this requires the branch to exist.
 *
 * ## SQL Pattern
 * ```sql
 * SELECT * FROM things WHERE id = ? AND branch = ? ORDER BY rowid DESC LIMIT 1
 * ```
 *
 * @param db - Drizzle database instance
 * @param id - The thing ID to look up
 * @param branch - The branch name (required, use getCurrentThing for main branch)
 * @returns The current version on the branch or undefined if not found
 *
 * @example Feature branch testing
 * ```ts
 * // Test new config on feature branch
 * const prodConfig = await getCurrentThing(db, 'app-config')
 * const testConfig = await getThingOnBranch(db, 'app-config', 'feature-x')
 *
 * if (testConfig) {
 *   console.log('Testing with:', testConfig.data)
 * } else {
 *   console.log('No override on feature-x, using prod')
 * }
 * ```
 *
 * @example Branch comparison
 * ```ts
 * const branches = ['staging', 'production', 'canary']
 * for (const branch of branches) {
 *   const config = await getThingOnBranch(db, 'config', branch)
 *   console.log(`${branch}: ${config?.data?.version ?? 'not set'}`)
 * }
 * ```
 */
export async function getThingOnBranch(
  db: ThingsDb,
  id: string,
  branch: string
): Promise<Thing | undefined> {
  const results = await db
    .select()
    .from(things)
    .where(and(eq(things.id, id), eq(things.branch, branch)))
    .orderBy(desc(things.id))
    .limit(1)

  return results[0]
}

/**
 * Options for getCurrentThings query.
 *
 * Provides filtering, pagination, and visibility control for listing things.
 *
 * @example List public Functions
 * ```ts
 * const publicFunctions = await getCurrentThings(db, {
 *   type: 1, // Function type ID
 *   visibility: 'public',
 *   limit: 50,
 * })
 * ```
 *
 * @example List all things on a branch including deleted
 * ```ts
 * const allThings = await getCurrentThings(db, {
 *   branch: 'staging',
 *   includeDeleted: true,
 *   limit: 1000,
 * })
 * ```
 */
export interface GetCurrentThingsOptions {
  /** Filter by type ID (from nouns table rowid) */
  type?: number
  /** Filter by branch (null = main branch) */
  branch?: string | null
  /** Include soft-deleted things (default: false) */
  includeDeleted?: boolean
  /** Maximum number of results (default: 100) */
  limit?: number
  /** Filter by visibility level(s). Can be single or array. */
  visibility?: Visibility | Visibility[]
}

/**
 * Get current versions of all things (or filtered subset).
 *
 * Returns the latest version of each thing matching the filter criteria.
 * Uses a subquery pattern to efficiently get only the most recent version
 * per ID.
 *
 * ## Performance
 *
 * This query uses a GROUP BY subquery to find the max rowid per thing ID,
 * then joins back to get full records. Indexes on (id, branch), (type),
 * and (visibility) ensure efficient filtering.
 *
 * @param db - Drizzle database instance
 * @param options - Filter and pagination options
 * @returns Array of current thing versions
 *
 * @example List all public APIs
 * ```ts
 * const publicApis = await getCurrentThings(db, {
 *   type: apiTypeId,
 *   visibility: 'public',
 * })
 * ```
 *
 * @example Paginated listing
 * ```ts
 * const page1 = await getCurrentThings(db, { limit: 20 })
 * const page2 = await getCurrentThings(db, { limit: 20, offset: 20 })
 * ```
 *
 * @example Count all users (use with limit: 0 and inspect length)
 * ```ts
 * // Note: For counting, prefer countVersions() for efficiency
 * const users = await getCurrentThings(db, { type: userTypeId })
 * console.log(`Total users: ${users.length}`)
 * ```
 */
export async function getCurrentThings(
  db: ThingsDb,
  options: GetCurrentThingsOptions = {}
): Promise<Thing[]> {
  const { type, branch = null, includeDeleted = false, limit = 100, visibility } = options

  // Build conditions array
  const conditions: SQL[] = []

  if (branch === null) {
    conditions.push(isNull(things.branch))
  } else {
    conditions.push(eq(things.branch, branch))
  }

  if (type !== undefined) {
    conditions.push(eq(things.type, type))
  }

  if (!includeDeleted) {
    conditions.push(eq(things.deleted, false))
  }

  // Add visibility filter
  if (visibility !== undefined) {
    if (Array.isArray(visibility)) {
      conditions.push(inArray(things.visibility, visibility))
    } else {
      conditions.push(eq(things.visibility, visibility))
    }
  }

  const condition = conditions.length > 1 ? and(...conditions) : conditions[0]

  const results = await db
    .select()
    .from(things)
    .where(condition)
    .orderBy(desc(things.id))
    .limit(limit)

  return results
}

/**
 * Soft delete a thing by creating a new version with deleted = true.
 *
 * Implements soft delete by appending a new version with deleted=true.
 * The thing's history is preserved, and it can be restored with undeleteThing().
 *
 * ## Soft Delete Pattern
 *
 * Instead of removing data, we append a new version:
 * ```sql
 * INSERT INTO things (id, type, ..., deleted)
 * SELECT id, type, ..., true FROM things WHERE id = ?
 * ```
 *
 * @param db - Drizzle database instance
 * @param id - The thing ID to soft delete
 * @returns The new version with deleted = true
 * @throws Error if thing not found
 *
 * @example Soft delete a user
 * ```ts
 * try {
 *   const deleted = await softDeleteThing(db, 'user-123')
 *   console.log('Soft deleted:', deleted.id)
 * } catch (error) {
 *   console.error('User not found')
 * }
 * ```
 *
 * @example Delete with audit log
 * ```ts
 * const deleted = await softDeleteThing(db, 'doc-456')
 * await auditLog.record({
 *   action: 'delete',
 *   target: deleted.id,
 *   version: deleted.version,
 * })
 * ```
 */
export async function softDeleteThing(
  db: ThingsDb,
  id: string
): Promise<Thing> {
  // First get the current version
  const current = await getCurrentThing(db, id)

  if (!current) {
    throw new Error(`Thing not found: ${id}`)
  }

  // Create new version with deleted = true
  const newVersion: NewThing = {
    id: current.id,
    type: current.type,
    branch: current.branch,
    name: current.name,
    data: current.data,
    deleted: true,
    visibility: current.visibility,
  }

  const results = await db
    .insert(things)
    .values(newVersion)
    .returning()

  return results[0]!
}

/**
 * Undelete a thing by creating a new version with deleted = false.
 *
 * Restores a soft-deleted thing by appending a new version with deleted=false.
 * The delete operation is preserved in history, maintaining full audit trail.
 *
 * @param db - Drizzle database instance
 * @param id - The thing ID to undelete
 * @returns The new version with deleted = false
 * @throws Error if thing not found
 *
 * @example Restore a deleted document
 * ```ts
 * const restored = await undeleteThing(db, 'doc-456')
 * console.log('Restored document:', restored.name)
 * ```
 *
 * @example Undo accidental delete
 * ```ts
 * // User accidentally deleted, restore within grace period
 * try {
 *   const user = await undeleteThing(db, 'user-123')
 *   console.log('User restored successfully')
 * } catch (error) {
 *   console.error('Cannot restore: user not found or already active')
 * }
 * ```
 */
export async function undeleteThing(
  db: ThingsDb,
  id: string
): Promise<Thing> {
  // First get the current version (which should be deleted)
  const current = await getCurrentThing(db, id)

  if (!current) {
    throw new Error(`Thing not found: ${id}`)
  }

  // Create new version with deleted = false
  const newVersion: NewThing = {
    id: current.id,
    type: current.type,
    branch: current.branch,
    name: current.name,
    data: current.data,
    deleted: false,
    visibility: current.visibility,
  }

  const results = await db
    .insert(things)
    .values(newVersion)
    .returning()

  return results[0]!
}

/**
 * Options for countVersions query.
 *
 * ## Performance Notes
 *
 * The limit option enables "has more than N" checks without counting all rows.
 * This is useful when you only need to know if a threshold is exceeded.
 *
 * ```ts
 * // Check if thing has more than 100 versions (for cleanup)
 * const count = await countVersions(db, 'doc-123', { limit: 101 })
 * if (count > 100) {
 *   console.log('Thing has many versions, consider compaction')
 * }
 * ```
 *
 * @example Count all versions
 * ```ts
 * const versionCount = await countVersions(db, 'user-123')
 * console.log(`User has ${versionCount} versions`)
 * ```
 */
export interface CountVersionsOptions {
  /**
   * Maximum count to return (default: undefined = no limit).
   * When set, the query will use LIMIT to cap the count.
   * Useful for "has more than N versions" checks.
   */
  limit?: number
}

/**
 * Count the number of versions for a thing.
 *
 * Uses SQL COUNT(*) for efficiency - returns the count directly without fetching rows.
 * This is O(1) memory and network transfer regardless of how many versions exist.
 *
 * ## SQL Pattern
 * ```sql
 * SELECT COUNT(*) as count FROM things WHERE id = ?
 * ```
 *
 * ## Performance
 *
 * Unlike getThingVersions() which fetches all rows, this query only returns
 * a single integer. Use this when you only need the count, not the actual data.
 *
 * @param db - Drizzle database instance
 * @param id - The thing ID to count versions for
 * @param options - Optional configuration (e.g., limit for "more than N" checks)
 * @returns The number of versions
 *
 * @example Simple version count
 * ```ts
 * const count = await countVersions(db, 'doc-123')
 * console.log(`Document has ${count} versions`)
 * ```
 *
 * @example Check if cleanup needed
 * ```ts
 * const count = await countVersions(db, 'config', { limit: 1001 })
 * if (count > 1000) {
 *   await compactVersions(db, 'config')
 * }
 * ```
 *
 * @example Version count for analytics
 * ```ts
 * const docs = await getCurrentThings(db, { type: docTypeId })
 * for (const doc of docs) {
 *   const versions = await countVersions(db, doc.id)
 *   console.log(`${doc.name}: ${versions} edits`)
 * }
 * ```
 */
export async function countVersions(
  db: ThingsDb,
  id: string,
  options?: CountVersionsOptions
): Promise<number> {
  // Use SQL COUNT(*) for efficiency - doesn't fetch rows, just returns the count
  const results = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(things)
    .where(eq(things.id, id))

  // Cast to number since the interface returns unknown for count result
  const count = (results[0]?.count as number | undefined) ?? 0

  // Apply optional limit (for "has more than N" checks)
  if (options?.limit !== undefined) {
    return Math.min(count, options.limit)
  }

  return count
}

// ============================================================================
// SQL PATTERNS (Reference Documentation)
// ============================================================================
//
// Helper: Get current version of a thing
// ============================================================================
//
// SELECT * FROM things
// WHERE id = ? AND (branch = ? OR branch IS NULL)
// ORDER BY rowid DESC
// LIMIT 1
//
// ============================================================================
// Helper: Get thing at specific version
// ============================================================================
//
// SELECT * FROM things WHERE rowid = ?
//
// ============================================================================
// Helper: Get thing at timestamp (requires joining with actions)
// ============================================================================
//
// SELECT t.* FROM things t
// JOIN actions a ON a.output = t.rowid
// WHERE t.id = ? AND a.created_at <= ?
// ORDER BY t.rowid DESC
// LIMIT 1
//
