/**
 * Hot Tier - DO SQLite Storage
 *
 * High-performance hot storage layer using Durable Object SQLite.
 * Provides low-latency reads and writes for recent data.
 *
 * Features:
 * - In-memory SQLite for sub-millisecond operations
 * - Schema auto-creation on first access
 * - Row count tracking for flush threshold
 * - Batch operations for efficiency
 *
 * @module db/compat/sql/clickhouse/storage/hot-tier
 */

import type {
  SqlStorageLike,
  SqlStorageCursorLike,
  ThingRow,
  QueryOptions,
  QueryResult,
} from './types'

/**
 * Schema for the things table in hot tier
 */
const THINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS things (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`

const THINGS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
CREATE INDEX IF NOT EXISTS idx_things_created ON things(created_at);
`

/**
 * HotTier - DO SQLite storage adapter
 *
 * Wraps Durable Object SQLite storage with a typed API for
 * things storage. Tracks row count for flush threshold.
 */
export class HotTier {
  private sql: SqlStorageLike
  private initialized = false
  private _rowCount = 0

  constructor(sql: SqlStorageLike) {
    this.sql = sql
  }

  /**
   * Initialize schema if not already done
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create table
    this.sql.exec(THINGS_SCHEMA)

    // Create indexes
    const indexStatements = THINGS_INDEXES.split(';').filter(s => s.trim())
    for (const stmt of indexStatements) {
      if (stmt.trim()) {
        this.sql.exec(stmt)
      }
    }

    // Count existing rows
    const result = this.sql.exec('SELECT COUNT(*) as count FROM things')
    const row = result.one() as { count: number } | null
    this._rowCount = row?.count ?? 0

    this.initialized = true
  }

  /**
   * Get current row count
   */
  get rowCount(): number {
    return this._rowCount
  }

  /**
   * Insert a row into the hot tier
   */
  async insert(row: ThingRow): Promise<void> {
    await this.initialize()

    const data = typeof row.data === 'string' ? row.data : JSON.stringify(row.data)

    this.sql.exec(
      `INSERT OR REPLACE INTO things (id, type, data, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row.id,
      row.type,
      data,
      row.embedding ?? null,
      row.created_at,
      row.updated_at
    )

    this._rowCount++
  }

  /**
   * Insert multiple rows in a batch
   */
  async insertBatch(rows: ThingRow[]): Promise<void> {
    await this.initialize()

    for (const row of rows) {
      const data = typeof row.data === 'string' ? row.data : JSON.stringify(row.data)
      this.sql.exec(
        `INSERT OR REPLACE INTO things (id, type, data, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        row.id,
        row.type,
        data,
        row.embedding ?? null,
        row.created_at,
        row.updated_at
      )
    }

    this._rowCount += rows.length
  }

  /**
   * Query the hot tier
   */
  async query(sql: string, options?: QueryOptions): Promise<QueryResult> {
    await this.initialize()

    const startTime = performance.now()

    let query = sql

    // Apply limit and offset if provided
    if (options?.limit !== undefined) {
      query += ` LIMIT ${options.limit}`
    }
    if (options?.offset !== undefined) {
      query += ` OFFSET ${options.offset}`
    }

    const result = this.sql.exec(query)
    const rows = result.toArray() as Record<string, unknown>[]

    // Parse JSON data fields
    const parsedRows = rows.map(row => {
      if (typeof row.data === 'string') {
        try {
          return { ...row, data: JSON.parse(row.data) }
        } catch {
          return row
        }
      }
      return row
    })

    return {
      rows: parsedRows,
      source: 'hot',
      durationMs: performance.now() - startTime,
      count: parsedRows.length,
    }
  }

  /**
   * Get all rows (for flush operation)
   */
  async getAllRows(): Promise<ThingRow[]> {
    await this.initialize()

    const result = this.sql.exec('SELECT * FROM things ORDER BY created_at ASC')
    const rows = result.toArray() as ThingRow[]

    return rows.map(row => ({
      ...row,
      data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data),
    }))
  }

  /**
   * Get rows created after a timestamp
   */
  async getRowsAfter(timestamp: number): Promise<ThingRow[]> {
    await this.initialize()

    const result = this.sql.exec(
      'SELECT * FROM things WHERE created_at > ? ORDER BY created_at ASC',
      timestamp
    )
    const rows = result.toArray() as ThingRow[]

    return rows.map(row => ({
      ...row,
      data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data),
    }))
  }

  /**
   * Delete rows (after successful flush)
   */
  async deleteRows(ids: string[]): Promise<number> {
    await this.initialize()

    if (ids.length === 0) return 0

    // SQLite has a limit on the number of placeholders, so batch if needed
    const BATCH_SIZE = 500
    let deleted = 0

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(',')
      const result = this.sql.exec(
        `DELETE FROM things WHERE id IN (${placeholders})`,
        ...batch
      )
      deleted += result.rowsWritten
    }

    this._rowCount = Math.max(0, this._rowCount - deleted)
    return deleted
  }

  /**
   * Clear all data (for testing or reset)
   */
  async clear(): Promise<void> {
    await this.initialize()
    this.sql.exec('DELETE FROM things')
    this._rowCount = 0
  }

  /**
   * Get row by ID
   */
  async get(id: string): Promise<ThingRow | null> {
    await this.initialize()

    const result = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
    const row = result.one() as ThingRow | null

    if (!row) return null

    return {
      ...row,
      data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data),
    }
  }

  /**
   * Delete a row by ID
   */
  async delete(id: string): Promise<boolean> {
    await this.initialize()

    const result = this.sql.exec('DELETE FROM things WHERE id = ?', id)
    if (result.rowsWritten > 0) {
      this._rowCount--
      return true
    }
    return false
  }

  /**
   * Update row count from storage (for recovery)
   */
  async syncRowCount(): Promise<number> {
    await this.initialize()

    const result = this.sql.exec('SELECT COUNT(*) as count FROM things')
    const row = result.one() as { count: number } | null
    this._rowCount = row?.count ?? 0
    return this._rowCount
  }
}
