/**
 * JSON Path Indexing Module
 *
 * Provides utilities for creating, managing, and syncing JSON path indexes
 * on Things and Relationships tables.
 *
 * SQLite supports expression indexes which can index json_extract() results:
 * CREATE INDEX idx ON things(json_extract(data, '$.field'))
 *
 * This module provides:
 * - createJsonIndex: Create a single JSON path index
 * - dropJsonIndex: Remove a JSON path index
 * - listJsonIndexes: List all JSON path indexes on a table
 * - syncNounIndexes: Sync indexes based on Noun schema
 * - getIndexName: Generate consistent index names
 * - validateIndexPath: Validate JSON path for safety
 *
 * @see dotdo-p2r1z for issue details
 */

import { sql } from 'drizzle-orm'

// ============================================================================
// TYPES
// ============================================================================

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

export interface JsonIndexInfo {
  /** Index name */
  name: string
  /** JSON path that is indexed */
  path: string
  /** Table the index is on */
  table: 'things' | 'relationships'
  /** Type ID if this is a type-filtered partial index */
  typeId?: number
  /** Verb filter if this is a verb-filtered partial index */
  verbFilter?: string
}

export interface SyncNounIndexesOptions {
  /** Noun name */
  nounName: string
  /** Type ID (rowid from nouns table) */
  typeId: number
  /** Noun schema with field definitions */
  schema: Record<string, string | { type: string; index?: boolean; [key: string]: unknown }>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Valid tables for JSON indexing
 */
const VALID_TABLES = ['things', 'relationships'] as const

/**
 * Regex for valid JSON paths:
 * - Must start with letter or underscore
 * - Can contain alphanumeric, underscore
 * - Dots allowed for nesting (but not leading, trailing, or consecutive)
 */
const VALID_JSON_PATH_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/

/**
 * Prefix for all JSON path indexes to distinguish from regular indexes
 */
const INDEX_PREFIX = 'idx_'

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate consistent index name for a JSON path.
 *
 * Format: idx_{table}_data_{path} or idx_{table}_type{id}_data_{path}
 *
 * @param table - Table name ('things' or 'relationships')
 * @param path - JSON path (e.g., 'status', 'config.enabled')
 * @param typeId - Optional type ID for partial index
 * @returns Generated index name
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
 * @param path - JSON path to validate
 * @throws Error if path is invalid
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
 * Creates an expression index using json_extract():
 * CREATE INDEX IF NOT EXISTS idx_things_data_status
 *   ON things(type, json_extract(data, '$.status'))
 *   WHERE type = 1;
 *
 * @param db - Drizzle database instance
 * @param options - Index options
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
 * @param db - Drizzle database instance
 * @param options - Index options (path and typeId used to determine index name)
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
 * Queries sqlite_master for indexes matching our naming convention.
 *
 * @param db - Drizzle database instance
 * @param table - Table name
 * @returns Array of JSON index info
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
 * Creates indexes for fields marked with index: true.
 * Drops indexes for fields no longer marked as indexed.
 *
 * @param db - Drizzle database instance
 * @param options - Sync options
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
