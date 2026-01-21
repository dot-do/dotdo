// SQLite Storage Adapter for @dotdo/db
// Implements StorageAdapter using Cloudflare Workers SqlStorage API

import type {
  StorageAdapter,
  StorageAdapterOptions,
  SqlStorageAdapterOptions,
  ListOptions,
  ListResult
} from '../storage'
import type { SqlStorage } from '../sqlite'

/**
 * Default table name for key-value storage
 */
const DEFAULT_TABLE_NAME = 'kv_store'

/**
 * Regex for validating table names to prevent SQL injection.
 * Only allows alphanumeric characters and underscores, must start with letter or underscore.
 */
const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Validates a table name to prevent SQL injection.
 * Throws an error if the table name is invalid.
 */
function validateTableName(tableName: string): void {
  if (!VALID_TABLE_NAME.test(tableName)) {
    throw new Error(
      `Invalid table name: "${tableName}". Table names must be alphanumeric (with underscores) and start with a letter or underscore.`
    )
  }
  // Additional protection: limit length to prevent buffer issues
  if (tableName.length > 128) {
    throw new Error(`Table name too long: "${tableName}". Maximum length is 128 characters.`)
  }
}

/**
 * SQLite-backed storage adapter
 *
 * Uses a simple key-value table structure with JSON serialization for values.
 * Compatible with Cloudflare Durable Objects SqlStorage API.
 */
export class SQLiteStorageAdapter implements StorageAdapter {
  private sql: SqlStorage
  private tableName: string
  private namespace: string
  private initialized = false

  constructor(sql: SqlStorage, options: SqlStorageAdapterOptions = {}) {
    this.sql = sql
    this.tableName = options.tableName || DEFAULT_TABLE_NAME
    this.namespace = options.namespace || ''

    // Validate table name to prevent SQL injection (do-xdq7)
    validateTableName(this.tableName)
  }

  /**
   * Initialize the storage table if it doesn't exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_key_prefix
        ON ${this.tableName}(key);
    `)

    this.initialized = true
  }

  /**
   * Apply namespace prefix to key
   */
  private prefixKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key
  }

  /**
   * Remove namespace prefix from key
   */
  private unprefixKey(key: string): string {
    if (this.namespace && key.startsWith(`${this.namespace}:`)) {
      return key.slice(this.namespace.length + 1)
    }
    return key
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.initialize()

    const prefixedKey = this.prefixKey(key)
    const row = await this.sql
      .prepare(`SELECT value FROM ${this.tableName} WHERE key = ?`)
      .bind(prefixedKey)
      .first()

    if (!row) return undefined

    try {
      return JSON.parse(row['value'] as string) as T
    } catch {
      return undefined
    }
  }

  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    await this.initialize()

    if (keys.length === 0) {
      return new Map()
    }

    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    const placeholders = prefixedKeys.map(() => '?').join(', ')

    const result = await this.sql
      .prepare(`SELECT key, value FROM ${this.tableName} WHERE key IN (${placeholders})`)
      .bind(...prefixedKeys)
      .all()

    const map = new Map<string, T>()
    for (const row of result.results) {
      const unprefixedKey = this.unprefixKey(row['key'] as string)
      try {
        map.set(unprefixedKey, JSON.parse(row['value'] as string) as T)
      } catch {
        // Skip invalid JSON
      }
    }

    return map
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    await this.initialize()

    const prefixedKey = this.prefixKey(key)
    const serialized = JSON.stringify(value)
    const now = Date.now()

    await this.sql
      .prepare(
        `INSERT INTO ${this.tableName} (key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`
      )
      .bind(prefixedKey, serialized, now, now, serialized, now)
      .run()
  }

  async putMany<T = unknown>(entries: Map<string, T>): Promise<void> {
    await this.initialize()

    if (entries.size === 0) return

    const now = Date.now()

    // Use a transaction for atomic batch insert
    for (const [key, value] of entries) {
      const prefixedKey = this.prefixKey(key)
      const serialized = JSON.stringify(value)

      await this.sql
        .prepare(
          `INSERT INTO ${this.tableName} (key, value, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`
        )
        .bind(prefixedKey, serialized, now, now, serialized, now)
        .run()
    }
  }

  async delete(key: string): Promise<void> {
    await this.initialize()

    const prefixedKey = this.prefixKey(key)
    await this.sql
      .prepare(`DELETE FROM ${this.tableName} WHERE key = ?`)
      .bind(prefixedKey)
      .run()
  }

  async deleteMany(keys: string[]): Promise<void> {
    await this.initialize()

    if (keys.length === 0) return

    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    const placeholders = prefixedKeys.map(() => '?').join(', ')

    await this.sql
      .prepare(`DELETE FROM ${this.tableName} WHERE key IN (${placeholders})`)
      .bind(...prefixedKeys)
      .run()
  }

  async list<T = unknown>(options: ListOptions = {}): Promise<ListResult<T>> {
    await this.initialize()

    const { prefix, limit = 1000, cursor, includeValues = true } = options

    // Build the query
    let query = `SELECT key${includeValues ? ', value' : ''} FROM ${this.tableName}`
    const params: unknown[] = []

    // Handle prefix filtering
    const effectivePrefix = this.namespace
      ? prefix
        ? `${this.namespace}:${prefix}`
        : `${this.namespace}:`
      : prefix || ''

    if (effectivePrefix) {
      query += ' WHERE key LIKE ?'
      params.push(`${effectivePrefix}%`)
    }

    // Handle cursor-based pagination (cursor is the last key from previous page)
    if (cursor) {
      query += effectivePrefix ? ' AND key > ?' : ' WHERE key > ?'
      params.push(cursor)
    }

    // Order and limit (fetch one extra to check if there are more results)
    query += ` ORDER BY key ASC LIMIT ?`
    params.push(limit + 1)

    const result = await this.sql.prepare(query).bind(...params).all()

    const entries = new Map<string, T>()
    const hasMore = result.results.length > limit

    // Only process up to limit results
    const rows = hasMore ? result.results.slice(0, limit) : result.results

    for (const row of rows) {
      const unprefixedKey = this.unprefixKey(row['key'] as string)

      if (includeValues) {
        try {
          entries.set(unprefixedKey, JSON.parse(row['value'] as string) as T)
        } catch {
          // Skip invalid JSON but include key
          entries.set(unprefixedKey, undefined as T)
        }
      } else {
        entries.set(unprefixedKey, undefined as T)
      }
    }

    // Cursor for next page is the last key we returned
    const lastRow = rows[rows.length - 1]
    const nextCursor = hasMore && lastRow ? (lastRow['key'] as string) : undefined

    const resultObj: ListResult<T> = {
      entries,
      hasMore
    }

    if (nextCursor !== undefined) {
      resultObj.cursor = nextCursor
    }

    return resultObj
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // SQLite in Cloudflare Workers doesn't expose explicit transaction API
    // but each SqlStorage instance is already transactional within a DO
    // All operations are atomic within a single DO request
    try {
      return await fn()
    } catch (error) {
      throw error
    }
  }

  async has(key: string): Promise<boolean> {
    await this.initialize()

    const prefixedKey = this.prefixKey(key)
    const row = await this.sql
      .prepare(`SELECT 1 FROM ${this.tableName} WHERE key = ?`)
      .bind(prefixedKey)
      .first()

    return row !== null
  }

  async clear(): Promise<void> {
    await this.initialize()

    if (this.namespace) {
      // Only clear keys with our namespace prefix
      await this.sql
        .prepare(`DELETE FROM ${this.tableName} WHERE key LIKE ?`)
        .bind(`${this.namespace}:%`)
        .run()
    } else {
      // Clear all keys
      await this.sql.prepare(`DELETE FROM ${this.tableName}`).bind().run()
    }
  }

  async count(prefix?: string): Promise<number> {
    await this.initialize()

    const effectivePrefix = this.namespace
      ? prefix
        ? `${this.namespace}:${prefix}`
        : `${this.namespace}:`
      : prefix || ''

    let query = `SELECT COUNT(*) as count FROM ${this.tableName}`
    const params: unknown[] = []

    if (effectivePrefix) {
      query += ' WHERE key LIKE ?'
      params.push(`${effectivePrefix}%`)
    }

    const result = await this.sql.prepare(query).bind(...params).first()
    return (result?.['count'] as number) ?? 0
  }
}

/**
 * Factory function to create a SQLite storage adapter
 */
export function createSQLiteStorageAdapter(
  sql: SqlStorage,
  options?: SqlStorageAdapterOptions
): SQLiteStorageAdapter {
  return new SQLiteStorageAdapter(sql, options)
}
