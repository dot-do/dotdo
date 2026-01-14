/**
 * Migration Tracking Module
 *
 * Provides the payload_migrations table and operations for tracking
 * which migrations have been run, their batch number, and execution time.
 *
 * Works with both Things and Drizzle storage strategies.
 *
 * @module @dotdo/payload/migrations/tracking
 */

import { sql } from 'drizzle-orm'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Applied migration record from the database
 */
export interface AppliedMigration {
  /** Unique ID */
  id: number
  /** Migration name (unique identifier) */
  name: string
  /** Batch number this migration was run in */
  batch: number
  /** When the migration was executed */
  executedAt: string
}

/**
 * Migration state summary
 */
export interface MigrationState {
  /** Number of applied migrations */
  applied: number
  /** Current batch number */
  currentBatch: number
  /** All applied migrations */
  migrations: AppliedMigration[]
}

/**
 * Database interface for tracking operations
 */
export interface TrackingDb {
  run?(query: any): Promise<any>
  all?(query: any): Promise<any[]>
  $client?: any
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Name of the migrations tracking table
 */
export const MIGRATIONS_TABLE = 'payload_migrations'

/**
 * SQL to create the migrations table
 */
export const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    batch INTEGER NOT NULL,
    executed_at TEXT NOT NULL
  )
`

/**
 * SQL to create an index on batch for rollback queries
 */
export const CREATE_MIGRATIONS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_${MIGRATIONS_TABLE}_batch
  ON ${MIGRATIONS_TABLE} (batch)
`

// ============================================================================
// TRACKING OPERATIONS
// ============================================================================

/**
 * Create the migrations tracking table if it doesn't exist.
 *
 * @param db - Database instance
 */
export async function ensureMigrationsTable(db: TrackingDb): Promise<void> {
  await runTrackingQuery(db, sql.raw(CREATE_MIGRATIONS_TABLE_SQL))
  await runTrackingQuery(db, sql.raw(CREATE_MIGRATIONS_INDEX_SQL))
}

/**
 * Record a migration as applied.
 *
 * @param db - Database instance
 * @param name - Migration name
 * @param batch - Batch number
 */
export async function recordMigration(
  db: TrackingDb,
  name: string,
  batch: number
): Promise<void> {
  const now = new Date().toISOString()
  // Use parameterized query to prevent SQL injection
  await runTrackingQueryWithParams(
    db,
    `INSERT INTO ${MIGRATIONS_TABLE} (name, batch, executed_at) VALUES (?, ?, ?)`,
    [name, batch, now]
  )
}

/**
 * Remove a migration record (for rollback).
 *
 * @param db - Database instance
 * @param name - Migration name to remove
 */
export async function removeMigration(db: TrackingDb, name: string): Promise<void> {
  // Use parameterized query to prevent SQL injection
  await runTrackingQueryWithParams(
    db,
    `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`,
    [name]
  )
}

/**
 * Get all applied migrations.
 *
 * @param db - Database instance
 * @returns Array of applied migrations
 */
export async function getAppliedMigrations(db: TrackingDb): Promise<AppliedMigration[]> {
  const selectSql = `
    SELECT id, name, batch, executed_at as executedAt
    FROM ${MIGRATIONS_TABLE}
    ORDER BY id ASC
  `
  const rows = await runTrackingQueryAll(db, sql.raw(selectSql))
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    batch: row.batch,
    executedAt: row.executedAt || row.executed_at,
  }))
}

/**
 * Get migrations for a specific batch.
 *
 * @param db - Database instance
 * @param batch - Batch number
 * @returns Array of migrations in that batch
 */
export async function getMigrationsForBatch(
  db: TrackingDb,
  batch: number
): Promise<AppliedMigration[]> {
  // Use parameterized query to prevent SQL injection
  const rows = await runTrackingQueryAllWithParams(
    db,
    `SELECT id, name, batch, executed_at as executedAt FROM ${MIGRATIONS_TABLE} WHERE batch = ? ORDER BY id DESC`,
    [batch]
  )
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    batch: row.batch,
    executedAt: row.executedAt || row.executed_at,
  }))
}

/**
 * Get the current (highest) batch number.
 *
 * @param db - Database instance
 * @returns Current batch number, or 0 if no migrations
 */
export async function getCurrentBatch(db: TrackingDb): Promise<number> {
  const selectSql = `SELECT MAX(batch) as maxBatch FROM ${MIGRATIONS_TABLE}`
  const rows = await runTrackingQueryAll(db, sql.raw(selectSql))
  return rows[0]?.maxBatch ?? 0
}

/**
 * Get the last batch number.
 *
 * @param db - Database instance
 * @returns Last batch number, or 0 if no migrations
 */
export async function getLastBatch(db: TrackingDb): Promise<number> {
  return getCurrentBatch(db)
}

/**
 * Get the full migration state.
 *
 * @param db - Database instance
 * @returns Migration state summary
 */
export async function getMigrationState(db: TrackingDb): Promise<MigrationState> {
  const migrations = await getAppliedMigrations(db)
  const currentBatch = await getCurrentBatch(db)

  return {
    applied: migrations.length,
    currentBatch,
    migrations,
  }
}

/**
 * Check if a specific migration has been applied.
 *
 * @param db - Database instance
 * @param name - Migration name
 * @returns True if migration is applied
 */
export async function isMigrationApplied(db: TrackingDb, name: string): Promise<boolean> {
  // Use parameterized query to prevent SQL injection
  const rows = await runTrackingQueryAllWithParams(
    db,
    `SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name = ? LIMIT 1`,
    [name]
  )
  return rows.length > 0
}

/**
 * Clear all migration records (for fresh/reset).
 *
 * @param db - Database instance
 */
export async function clearMigrationRecords(db: TrackingDb): Promise<void> {
  const deleteSql = `DELETE FROM ${MIGRATIONS_TABLE}`
  await runTrackingQuery(db, sql.raw(deleteSql))
}

/**
 * Get names of all applied migrations.
 *
 * @param db - Database instance
 * @returns Set of migration names
 */
export async function getAppliedMigrationNames(db: TrackingDb): Promise<Set<string>> {
  const migrations = await getAppliedMigrations(db)
  return new Set(migrations.map((m) => m.name))
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Run a tracking query (no result).
 */
async function runTrackingQuery(db: TrackingDb, query: any): Promise<void> {
  const { sql: sqlString } = extractSqlAndParams(query)
  const connection = db.$client || db

  if (typeof connection.exec === 'function') {
    // better-sqlite3
    connection.exec(sqlString)
  } else if (typeof connection.run === 'function') {
    // D1 or other async sqlite
    await connection.run(sqlString)
  } else if (typeof (db as any).run === 'function') {
    // Drizzle
    await (db as any).run(query)
  }
}

/**
 * Run a parameterized tracking query (no result) - prevents SQL injection.
 */
async function runTrackingQueryWithParams(db: TrackingDb, sqlString: string, params: any[]): Promise<void> {
  const connection = db.$client || db

  if (typeof connection.prepare === 'function') {
    // better-sqlite3
    const stmt = connection.prepare(sqlString)
    stmt.run(...params)
  } else if (typeof connection.run === 'function') {
    // D1 or other async sqlite
    await connection.run(sqlString, params)
  } else if (typeof (db as any).run === 'function') {
    // Drizzle - use sql template tag with parameters
    await (db as any).run(sql.raw(sqlString), params)
  }
}

/**
 * Run a parameterized tracking query and return all rows - prevents SQL injection.
 */
async function runTrackingQueryAllWithParams(db: TrackingDb, sqlString: string, params: any[]): Promise<any[]> {
  const connection = db.$client || db

  if (typeof connection.prepare === 'function') {
    // better-sqlite3
    try {
      const stmt = connection.prepare(sqlString)
      return stmt.all(...params)
    } catch (error) {
      // Table may not exist yet
      if ((error as Error).message?.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  if (typeof connection.all === 'function') {
    // D1 or other async sqlite
    try {
      return await connection.all(sqlString, params)
    } catch (error) {
      if ((error as Error).message?.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  if (typeof (db as any).all === 'function') {
    // Drizzle
    try {
      return await (db as any).all(sql.raw(sqlString), params)
    } catch (error) {
      if ((error as Error).message?.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  return []
}

/**
 * Run a tracking query and return all rows.
 */
async function runTrackingQueryAll(db: TrackingDb, query: any): Promise<any[]> {
  const { sql: sqlString } = extractSqlAndParams(query)
  const connection = db.$client || db

  if (typeof connection.prepare === 'function') {
    // better-sqlite3
    try {
      const stmt = connection.prepare(sqlString)
      return stmt.all()
    } catch (error) {
      // Table may not exist yet
      if ((error as Error).message?.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  if (typeof connection.all === 'function') {
    // D1 or other async sqlite
    try {
      return await connection.all(sqlString)
    } catch (error) {
      if ((error as Error).message?.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  if (typeof (db as any).all === 'function') {
    // Drizzle
    try {
      return await (db as any).all(query)
    } catch (error) {
      if ((error as Error).message?.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  return []
}

/**
 * Extract SQL string and parameters from a query object.
 */
function extractSqlAndParams(query: any): { sql: string; params: any[] } {
  if (typeof query?.sql === 'string') {
    return { sql: query.sql, params: query.params || [] }
  }

  if (query?.queryChunks) {
    const sqlParts: string[] = []
    const params: any[] = []

    for (const chunk of query.queryChunks) {
      if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        const value = (chunk as { value: string[] }).value
        sqlParts.push(Array.isArray(value) ? value.join('') : String(value))
      } else {
        sqlParts.push('?')
        params.push(chunk)
      }
    }

    return { sql: sqlParts.join(''), params }
  }

  if (typeof query === 'string') {
    return { sql: query, params: [] }
  }

  return { sql: '', params: [] }
}
