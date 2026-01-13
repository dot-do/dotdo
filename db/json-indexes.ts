/**
 * @module db/json-indexes
 *
 * JSON Path Indexing for SQLite Expression Indexes.
 *
 * This module provides utilities for creating, managing, and syncing JSON path
 * indexes on Things and Relationships tables. SQLite supports expression indexes
 * which can index json_extract() results for efficient JSON field queries.
 *
 * ## Why JSON Indexes?
 *
 * Without indexes, queries like `WHERE json_extract(data, '$.status') = 'active'`
 * require a full table scan. With a JSON path index, SQLite can use the index
 * for O(log n) lookups.
 *
 * ## Index Types
 *
 * - **Full index**: Indexes all rows (no WHERE clause)
 * - **Partial type index**: Indexes only rows of a specific type (partial index)
 * - **Partial verb index**: For relationships, indexes only rows with specific verb
 *
 * ## Functions
 *
 * | Function | Purpose |
 * |----------|---------|
 * | createJsonIndex | Create a single JSON path index |
 * | dropJsonIndex | Remove a JSON path index |
 * | listJsonIndexes | List all JSON path indexes on a table |
 * | syncNounIndexes | Sync indexes based on Noun schema |
 * | getIndexName | Generate consistent index names |
 * | validateIndexPath | Validate JSON path for safety |
 *
 * @example Create an index on things.data.status
 * ```ts
 * import { createJsonIndex } from 'dotdo/db'
 *
 * await createJsonIndex(db, {
 *   table: 'things',
 *   path: 'status',
 *   typeId: 1, // Optional: partial index for type 1 only
 * })
 * // Creates: CREATE INDEX idx_things_type1_data_status
 * //   ON things(type, json_extract(data, '$.status'))
 * //   WHERE type = 1
 * ```
 *
 * @example Sync indexes from Noun schema
 * ```ts
 * import { syncNounIndexes } from 'dotdo/db'
 *
 * await syncNounIndexes(db, {
 *   nounName: 'User',
 *   typeId: 1,
 *   schema: {
 *     email: { type: 'string', index: true },
 *     status: '#string', // # prefix = indexed
 *     profile: { type: 'object' }, // Not indexed
 *   },
 * })
 * // Creates indexes for email and status fields
 * ```
 *
 * @example List existing JSON indexes
 * ```ts
 * import { listJsonIndexes } from 'dotdo/db'
 *
 * const indexes = await listJsonIndexes(db, 'things')
 * for (const idx of indexes) {
 *   console.log(`${idx.name}: ${idx.path} (type: ${idx.typeId ?? 'all'})`)
 * }
 * ```
 *
 * @see https://www.sqlite.org/expridx.html SQLite Expression Indexes
 */

import { sql } from 'drizzle-orm'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for creating or dropping a JSON path index.
 *
 * @example Full index on things table
 * ```ts
 * const options: JsonIndexOptions = {
 *   table: 'things',
 *   path: 'status',
 * }
 * ```
 *
 * @example Partial index for specific type
 * ```ts
 * const options: JsonIndexOptions = {
 *   table: 'things',
 *   path: 'email',
 *   typeId: 1, // Only index User type (type ID 1)
 * }
 * ```
 *
 * @example Partial index for specific verb (relationships)
 * ```ts
 * const options: JsonIndexOptions = {
 *   table: 'relationships',
 *   path: 'role',
 *   verbFilter: 'memberOf',
 * }
 * ```
 */
export interface JsonIndexOptions {
  /** Table to create index on ('things' or 'relationships') */
  table: 'things' | 'relationships'
  /** JSON path to index (e.g., 'status', 'config.enabled') */
  path: string
  /** Type ID for partial index (things table only) */
  typeId?: number
  /** Verb filter for partial index (relationships table only) */
  verbFilter?: string
}

/**
 * Information about an existing JSON path index.
 *
 * Returned by listJsonIndexes() to describe existing indexes.
 *
 * @example
 * ```ts
 * const indexes = await listJsonIndexes(db, 'things')
 * for (const info of indexes) {
 *   console.log(`Index: ${info.name}`)
 *   console.log(`  Path: data.${info.path}`)
 *   console.log(`  Type filter: ${info.typeId ?? 'none'}`)
 * }
 * ```
 */
export interface JsonIndexInfo {
  /** Generated index name (e.g., 'idx_things_type1_data_status') */
  name: string
  /** JSON path that is indexed (without $. prefix) */
  path: string
  /** Table the index is on */
  table: 'things' | 'relationships'
  /** Type ID if this is a type-filtered partial index */
  typeId?: number
  /** Verb filter if this is a verb-filtered partial index */
  verbFilter?: string
}

/**
 * Options for syncing indexes based on a Noun schema.
 *
 * Used by syncNounIndexes() to create/drop indexes based on schema definitions.
 * Fields can be marked for indexing two ways:
 *
 * 1. Object notation with `index: true`
 * 2. Shorthand with `#` prefix (e.g., `#string`)
 *
 * @example
 * ```ts
 * const options: SyncNounIndexesOptions = {
 *   nounName: 'User',
 *   typeId: 1,
 *   schema: {
 *     // Object notation - explicit index flag
 *     email: { type: 'string', index: true },
 *     name: { type: 'string', index: false },
 *
 *     // Shorthand - # prefix means indexed
 *     status: '#string',
 *
 *     // Not indexed
 *     profile: { type: 'object' },
 *     bio: 'string',
 *   },
 * }
 * ```
 */
export interface SyncNounIndexesOptions {
  /** Noun name (for logging/debugging) */
  nounName: string
  /** Type ID (rowid from nouns table) */
  typeId: number
  /** Noun schema with field definitions (supports index:true or # prefix) */
  schema: Record<string, string | { type: string; index?: boolean; [key: string]: unknown }>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Valid tables for JSON indexing.
 * @internal
 */
const VALID_TABLES = ['things', 'relationships'] as const

/**
 * Regex for valid JSON paths.
 *
 * Security validation to prevent SQL injection in index creation.
 * - Must start with letter or underscore
 * - Can contain alphanumeric, underscore
 * - Dots allowed for nesting (but not leading, trailing, or consecutive)
 *
 * @internal
 */
const VALID_JSON_PATH_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/

/**
 * Prefix for all JSON path indexes to distinguish from regular indexes.
 * All JSON indexes start with 'idx_' followed by table name.
 * @internal
 */
const INDEX_PREFIX = 'idx_'

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate consistent index name for a JSON path.
 *
 * Creates a deterministic index name based on table, path, and optional type filter.
 * Dots in paths are converted to underscores for valid SQL identifiers.
 *
 * ## Naming Convention
 *
 * - Full index: `idx_{table}_data_{path}`
 * - Type-filtered: `idx_{table}_type{id}_data_{path}`
 * - Verb-filtered: `idx_{table}_verb_{verb}_data_{path}`
 *
 * @param table - Table name ('things' or 'relationships')
 * @param path - JSON path (e.g., 'status', 'config.enabled')
 * @param typeId - Optional type ID for partial index
 * @returns Generated index name
 *
 * @example
 * ```ts
 * getIndexName('things', 'status')
 * // Returns: 'idx_things_data_status'
 *
 * getIndexName('things', 'config.enabled', 1)
 * // Returns: 'idx_things_type1_data_config_enabled'
 * ```
 */
export function getIndexName(
  table: 'things' | 'relationships',
  path: string,
  typeId?: number
): string {
  // Convert path dots to underscores for valid SQL identifier
  const safePath = path.replace(/\./g, '_')

  if (typeId !== undefined) {
    return `${INDEX_PREFIX}${table}_type${typeId}_data_${safePath}`
  }

  return `${INDEX_PREFIX}${table}_data_${safePath}`
}

/**
 * Parse index name back to components.
 * @internal
 */
function parseIndexName(name: string): { table: string; path: string; typeId?: number; verbFilter?: string } | null {
  // Pattern: idx_{table}_data_{path} or idx_{table}_type{id}_data_{path}
  // or idx_{table}_verb_{verb}_data_{path}

  const typeMatch = name.match(/^idx_(\w+)_type(\d+)_data_(.+)$/)
  if (typeMatch) {
    return {
      table: typeMatch[1]!,
      typeId: parseInt(typeMatch[2]!, 10),
      path: typeMatch[3]!.replace(/_/g, '.'),
    }
  }

  const verbMatch = name.match(/^idx_(\w+)_verb_(\w+)_data_(.+)$/)
  if (verbMatch) {
    return {
      table: verbMatch[1]!,
      verbFilter: verbMatch[2],
      path: verbMatch[3]!.replace(/_/g, '.'),
    }
  }

  const simpleMatch = name.match(/^idx_(\w+)_data_(.+)$/)
  if (simpleMatch) {
    return {
      table: simpleMatch[1]!,
      path: simpleMatch[2]!.replace(/_/g, '.'),
    }
  }

  return null
}

/**
 * Validate JSON path for safety (prevent SQL injection).
 *
 * Ensures the path contains only safe characters that cannot be used
 * for SQL injection attacks. Throws an error if validation fails.
 *
 * ## Allowed Patterns
 *
 * - Single field: `status`, `email`, `user_id`
 * - Nested paths: `config.enabled`, `user.profile.name`
 *
 * ## Rejected Patterns
 *
 * - Leading/trailing dots: `.status`, `config.`
 * - Consecutive dots: `config..enabled`
 * - SQL metacharacters: `status; DROP TABLE`, `config'--`
 *
 * @param path - JSON path to validate
 * @throws Error if path is invalid
 *
 * @example
 * ```ts
 * validateIndexPath('status')        // OK
 * validateIndexPath('config.enabled') // OK
 * validateIndexPath('.bad')          // Throws!
 * validateIndexPath('a; DROP')       // Throws!
 * ```
 */
export function validateIndexPath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid JSON path: path is required')
  }

  if (!VALID_JSON_PATH_REGEX.test(path)) {
    throw new Error(
      `Invalid JSON path: '${path}'. Path must contain only alphanumeric characters, underscores, and dots for nesting.`
    )
  }
}

/**
 * Validate table name.
 * @internal
 */
function validateTable(table: string): asserts table is 'things' | 'relationships' {
  if (!VALID_TABLES.includes(table as any)) {
    throw new Error(`Invalid table: '${table}'. Must be 'things' or 'relationships'.`)
  }
}

/**
 * Build SQLite JSON path string.
 * @internal
 */
function buildJsonPath(path: string): string {
  return `$.${path}`
}

// ============================================================================
// INDEX OPERATIONS
// ============================================================================

/**
 * Create a JSON path index on a table.
 *
 * Creates an SQLite expression index using json_extract() to enable
 * efficient queries on JSON data fields.
 *
 * ## Generated SQL
 *
 * For a full index:
 * ```sql
 * CREATE INDEX IF NOT EXISTS idx_things_data_status
 *   ON things(json_extract(data, '$.status'))
 * ```
 *
 * For a partial type-filtered index:
 * ```sql
 * CREATE INDEX IF NOT EXISTS idx_things_type1_data_status
 *   ON things(type, json_extract(data, '$.status'))
 *   WHERE type = 1
 * ```
 *
 * @param db - Drizzle database instance (or raw sqlite3 connection)
 * @param options - Index configuration
 *
 * @example Create a full index
 * ```ts
 * await createJsonIndex(db, {
 *   table: 'things',
 *   path: 'status',
 * })
 * ```
 *
 * @example Create a partial index for a specific type
 * ```ts
 * await createJsonIndex(db, {
 *   table: 'things',
 *   path: 'email',
 *   typeId: 1, // Only for User type
 * })
 * ```
 *
 * @example Create a verb-filtered index on relationships
 * ```ts
 * await createJsonIndex(db, {
 *   table: 'relationships',
 *   path: 'role',
 *   verbFilter: 'memberOf',
 * })
 * ```
 */
export async function createJsonIndex(
  db: any,
  options: JsonIndexOptions
): Promise<void> {
  // Validate inputs
  validateTable(options.table)
  validateIndexPath(options.path)

  const indexName = options.typeId !== undefined
    ? getIndexName(options.table, options.path, options.typeId)
    : options.verbFilter
      ? `${INDEX_PREFIX}${options.table}_verb_${options.verbFilter}_data_${options.path.replace(/\./g, '_')}`
      : getIndexName(options.table, options.path)

  const jsonPath = buildJsonPath(options.path)

  // Build CREATE INDEX statement
  let indexSql: string

  if (options.table === 'things') {
    if (options.typeId !== undefined) {
      // Partial index filtered by type - include type in index for composite filtering
      indexSql = `CREATE INDEX IF NOT EXISTS ${indexName} ON things(type, json_extract(data, '${jsonPath}')) WHERE type = ${options.typeId}`
    } else {
      // Full index on all rows
      indexSql = `CREATE INDEX IF NOT EXISTS ${indexName} ON things(json_extract(data, '${jsonPath}'))`
    }
  } else {
    // relationships table
    if (options.verbFilter) {
      // Partial index filtered by verb
      indexSql = `CREATE INDEX IF NOT EXISTS ${indexName} ON relationships(verb, json_extract(data, '${jsonPath}')) WHERE verb = '${options.verbFilter}'`
    } else {
      // Full index on all rows
      indexSql = `CREATE INDEX IF NOT EXISTS ${indexName} ON relationships(json_extract(data, '${jsonPath}'))`
    }
  }

  // Execute the SQL
  // Handle both Drizzle and raw sqlite3 database objects
  // First try to get the underlying connection via $client (Drizzle pattern)
  const connection = db.$client || db

  if (typeof connection.exec === 'function') {
    // better-sqlite3 Database object
    connection.exec(indexSql)
  } else if (typeof connection.run === 'function') {
    // Some other sqlite driver
    connection.run(indexSql)
  } else if (typeof db.run === 'function') {
    // Drizzle's run method
    await db.run(sql.raw(indexSql))
  } else {
    throw new Error('Unsupported database type for createJsonIndex')
  }
}

/**
 * Drop a JSON path index from a table.
 *
 * Removes an existing JSON path index. Uses IF EXISTS so it's safe
 * to call even if the index doesn't exist.
 *
 * @param db - Drizzle database instance (or raw sqlite3 connection)
 * @param options - Index options (path and typeId used to determine index name)
 *
 * @example
 * ```ts
 * await dropJsonIndex(db, {
 *   table: 'things',
 *   path: 'status',
 *   typeId: 1,
 * })
 * ```
 */
export async function dropJsonIndex(
  db: any,
  options: Omit<JsonIndexOptions, 'verbFilter'>
): Promise<void> {
  validateTable(options.table)
  validateIndexPath(options.path)

  const indexName = getIndexName(options.table, options.path, options.typeId)
  const dropSql = `DROP INDEX IF EXISTS ${indexName}`

  // Execute the SQL
  const connection = db.$client || db
  if (typeof connection.exec === 'function') {
    connection.exec(dropSql)
  } else if (typeof connection.run === 'function') {
    connection.run(dropSql)
  } else {
    await db.run(sql.raw(dropSql))
  }
}

/**
 * List all JSON path indexes on a table.
 *
 * Queries sqlite_master for indexes matching our naming convention
 * (idx_{table}_*data_*). Returns parsed information about each index.
 *
 * @param db - Drizzle database instance (or raw sqlite3 connection)
 * @param table - Table name ('things' or 'relationships')
 * @returns Array of JSON index info
 *
 * @example
 * ```ts
 * const indexes = await listJsonIndexes(db, 'things')
 * console.log(`Found ${indexes.length} JSON indexes`)
 *
 * for (const idx of indexes) {
 *   console.log(`- ${idx.name}`)
 *   console.log(`  Path: ${idx.path}`)
 *   if (idx.typeId) {
 *     console.log(`  Type filter: ${idx.typeId}`)
 *   }
 * }
 * ```
 */
export async function listJsonIndexes(
  db: any,
  table: 'things' | 'relationships'
): Promise<JsonIndexInfo[]> {
  validateTable(table)

  // Query sqlite_master for indexes on the table
  // Pattern matches: idx_{table}_data_*, idx_{table}_type*_data_*, idx_{table}_verb_*_data_*
  const querySql = `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND name LIKE 'idx_${table}%data_%'`

  let rows: Array<{ name: string }>

  // Execute the query
  const connection = db.$client || db
  if (typeof connection.prepare === 'function') {
    // better-sqlite3
    const stmt = connection.prepare(querySql)
    rows = stmt.all() as Array<{ name: string }>
  } else if (typeof connection.all === 'function') {
    // D1 or other async sqlite
    rows = await connection.all(querySql)
  } else {
    // Drizzle
    const result = await db.all(sql.raw(querySql))
    rows = result as Array<{ name: string }>
  }

  // Parse index names back to JsonIndexInfo
  const indexes: JsonIndexInfo[] = []
  for (const row of rows) {
    const parsed = parseIndexName(row.name)
    if (parsed && parsed.table === table) {
      indexes.push({
        name: row.name,
        path: parsed.path,
        table: table,
        typeId: parsed.typeId,
        verbFilter: parsed.verbFilter,
      })
    }
  }

  return indexes
}

// ============================================================================
// NOUN SYNC
// ============================================================================

/**
 * Parse schema definition to check if field should be indexed.
 *
 * Supports two notations:
 * - Object with `index: true`
 * - Shorthand string starting with `#` (e.g., '#string')
 *
 * @internal
 */
function shouldIndex(definition: string | { type: string; index?: boolean; [key: string]: unknown }): boolean {
  if (typeof definition === 'string') {
    // Support shorthand: '#string' (hash prefix = indexed)
    return definition.startsWith('#')
  }
  return definition.index === true
}

/**
 * Extract field path from schema key.
 * For nested paths like 'config.enabled', returns as-is.
 * @internal
 */
function getFieldPath(key: string): string {
  return key
}

/**
 * Sync JSON path indexes based on Noun schema.
 *
 * Ensures the database indexes match the schema definition by:
 * 1. Creating indexes for fields marked as indexed
 * 2. Dropping indexes for fields no longer marked as indexed
 *
 * This is idempotent - safe to call multiple times. Uses CREATE INDEX
 * IF NOT EXISTS and DROP INDEX IF EXISTS.
 *
 * ## Schema Notation
 *
 * Fields can be marked for indexing two ways:
 * - Object notation: `{ type: 'string', index: true }`
 * - Shorthand: `'#string'` (# prefix = indexed)
 *
 * @param db - Drizzle database instance (or raw sqlite3 connection)
 * @param options - Sync configuration including noun name, type ID, and schema
 *
 * @example
 * ```ts
 * await syncNounIndexes(db, {
 *   nounName: 'User',
 *   typeId: 1,
 *   schema: {
 *     email: { type: 'string', index: true },
 *     status: '#string', // # prefix = indexed
 *     name: { type: 'string' }, // Not indexed
 *   },
 * })
 * // Creates: idx_things_type1_data_email
 * // Creates: idx_things_type1_data_status
 * ```
 *
 * @example Schema changes (drop old index)
 * ```ts
 * // If email was previously indexed but schema changed:
 * await syncNounIndexes(db, {
 *   nounName: 'User',
 *   typeId: 1,
 *   schema: {
 *     email: { type: 'string' }, // No longer indexed
 *     status: '#string',
 *   },
 * })
 * // Drops: idx_things_type1_data_email
 * // Keeps: idx_things_type1_data_status
 * ```
 */
export async function syncNounIndexes(
  db: any,
  options: SyncNounIndexesOptions
): Promise<void> {
  const { typeId, schema } = options

  // Get current indexes for this type
  const existingIndexes = await listJsonIndexes(db, 'things')
  const typeIndexes = existingIndexes.filter((idx) => idx.typeId === typeId)
  const existingPaths = new Set(typeIndexes.map((idx) => idx.path))

  // Determine which paths should be indexed
  const desiredPaths = new Set<string>()
  for (const [key, definition] of Object.entries(schema)) {
    if (shouldIndex(definition)) {
      const path = getFieldPath(key)
      try {
        validateIndexPath(path)
        desiredPaths.add(path)
      } catch {
        // Invalid path - skip
        console.warn(`Skipping invalid index path: ${path}`)
      }
    }
  }

  // Create missing indexes
  for (const path of desiredPaths) {
    if (!existingPaths.has(path)) {
      await createJsonIndex(db, {
        table: 'things',
        path,
        typeId,
      })
    }
  }

  // Drop obsolete indexes
  for (const path of existingPaths) {
    if (!desiredPaths.has(path)) {
      await dropJsonIndex(db, {
        table: 'things',
        path,
        typeId,
      })
    }
  }
}
