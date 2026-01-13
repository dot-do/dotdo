/**
 * Redis Storage Layer using SQLite
 * Provides O(1) operations with proper indexes
 */

export type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset'
export type RedisValueType = string | string[] | Record<string, string> | Array<{ member: string; score: number }>

export interface StorageEntry {
  key: string
  type: RedisType
  value: RedisValueType
  expires_at: number | null
  created_at: number
  updated_at: number
}

export class RedisStorage {
  private sql: SqlStorage
  private initialized = false

  constructor(private state: DurableObjectState) {
    this.sql = state.storage.sql
  }

  /**
   * Initialize the database schema
   */
  async init(): Promise<void> {
    if (this.initialized) return

    // Main key-value store
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS redis_data (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
      )
    `)

    // Index for expiration queries
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_expires_at ON redis_data(expires_at)
      WHERE expires_at IS NOT NULL
    `)

    // Index for type-based queries
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_type ON redis_data(type)
    `)

    this.initialized = true
  }

  /**
   * Get a key's entry
   */
  async get(key: string): Promise<StorageEntry | null> {
    const result = this.sql.exec<{
      key: string
      type: string
      value: string
      expires_at: number | null
      created_at: number
      updated_at: number
    }>(`SELECT * FROM redis_data WHERE key = ?`, key).toArray()

    if (result.length === 0) return null

    const row = result[0]

    // Check expiration
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      await this.delete(key)
      return null
    }

    return {
      key: row.key,
      type: row.type as RedisType,
      value: JSON.parse(row.value),
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  /**
   * Set a key's value
   */
  async set(key: string, type: RedisType, value: RedisValueType, expiresAt?: number): Promise<void> {
    const now = Date.now()
    const valueJson = JSON.stringify(value)

    this.sql.exec(
      `
      INSERT INTO redis_data (key, type, value, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        type = excluded.type,
        value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
      key,
      type,
      valueJson,
      expiresAt ?? null,
      now,
      now
    )

    // Schedule alarm if TTL is set
    if (expiresAt) {
      await this.scheduleExpiration(expiresAt)
    }
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<boolean> {
    const result = this.sql.exec(`DELETE FROM redis_data WHERE key = ? RETURNING key`, key).toArray()
    return result.length > 0
  }

  /**
   * Set expiration on a key
   */
  async setExpiry(key: string, expiresAt: number | undefined): Promise<boolean> {
    const result = this.sql
      .exec(`UPDATE redis_data SET expires_at = ?, updated_at = ? WHERE key = ? RETURNING key`, expiresAt ?? null, Date.now(), key)
      .toArray()

    if (result.length > 0 && expiresAt) {
      await this.scheduleExpiration(expiresAt)
    }

    return result.length > 0
  }

  /**
   * Get all keys
   */
  async keys(): Promise<string[]> {
    // First clean expired keys
    await this.cleanExpired()

    const result = this.sql.exec<{ key: string }>(`SELECT key FROM redis_data`).toArray()
    return result.map((row) => row.key)
  }

  /**
   * Clear all keys
   */
  async clear(): Promise<void> {
    this.sql.exec(`DELETE FROM redis_data`)
  }

  /**
   * Clean expired keys
   */
  async cleanExpired(): Promise<number> {
    const now = Date.now()
    const result = this.sql.exec(`DELETE FROM redis_data WHERE expires_at IS NOT NULL AND expires_at <= ? RETURNING key`, now).toArray()
    return result.length
  }

  /**
   * Get next expiration time
   */
  async getNextExpiration(): Promise<number | null> {
    const result = this.sql
      .exec<{ expires_at: number }>(
        `
      SELECT MIN(expires_at) as expires_at
      FROM redis_data
      WHERE expires_at IS NOT NULL AND expires_at > ?
    `,
        Date.now()
      )
      .toArray()

    return result[0]?.expires_at ?? null
  }

  /**
   * Schedule an alarm for key expiration
   */
  private async scheduleExpiration(expiresAt: number): Promise<void> {
    const currentAlarm = await this.state.storage.getAlarm()

    // Only update if new expiration is sooner or no alarm is set
    if (currentAlarm === null || expiresAt < currentAlarm) {
      await this.state.storage.setAlarm(expiresAt)
    }
  }

  /**
   * Handle alarm (called by DO)
   */
  async handleAlarm(): Promise<void> {
    await this.cleanExpired()

    // Schedule next alarm if there are more expirations
    const next = await this.getNextExpiration()
    if (next) {
      await this.state.storage.setAlarm(next)
    }
  }

  /**
   * Get database stats
   */
  async stats(): Promise<{
    keys: number
    expiringKeys: number
    types: Record<string, number>
  }> {
    const totalResult = this.sql.exec<{ count: number }>(`SELECT COUNT(*) as count FROM redis_data`).toArray()

    const expiringResult = this.sql
      .exec<{ count: number }>(`SELECT COUNT(*) as count FROM redis_data WHERE expires_at IS NOT NULL`)
      .toArray()

    const typeResult = this.sql.exec<{ type: string; count: number }>(`SELECT type, COUNT(*) as count FROM redis_data GROUP BY type`).toArray()

    const types: Record<string, number> = {}
    for (const row of typeResult) {
      types[row.type] = row.count
    }

    return {
      keys: totalResult[0]?.count ?? 0,
      expiringKeys: expiringResult[0]?.count ?? 0,
      types,
    }
  }
}
