/**
 * State Manager Module - SQLite-backed state operations
 *
 * This module contains:
 * - State management constants
 * - State list options type
 * - Transaction operation types
 * - StateManager class for get/set/delete/list operations
 */

// ============================================================================
// State Keys Constants
// ============================================================================

export const STATE_KEYS = {
  LIFECYCLE_START: '_lifecycle:onStart',
  LIFECYCLE_START_COUNT: '_lifecycle:onStartCount',
  LIFECYCLE_HIBERNATE: '_lifecycle:onHibernate',
  LIFECYCLE_WAKE: '_lifecycle:onWake',
  LIFECYCLE_WAKE_COUNT: '_lifecycle:wakeCount',
  INITIALIZED: '_initialized',
  ALARM_TRIGGERED: '_alarm_triggered',
  CONNECTIONS_RESTORED: '_connections:restored',
} as const

// ============================================================================
// Types
// ============================================================================

/**
 * Options for listing state entries with filtering and pagination
 */
export interface ListOptions {
  /** Prefix to filter keys by (e.g., "user:" matches "user:1", "user:2", etc.) */
  prefix?: string
  /** Start of key range (inclusive) */
  start?: string
  /** End of key range (exclusive) */
  end?: string
  /** Maximum number of entries to return */
  limit?: number
  /** Sort results in reverse order */
  reverse?: boolean
}

/**
 * Operation for transactional updates to state
 */
export interface TransactionOp {
  /** Operation type: 'set' to store, 'delete' to remove, 'error' to trigger rollback */
  op: 'set' | 'delete' | 'error'
  /** Key for set/delete operations */
  key?: string
  /** Value for set operations */
  value?: unknown
}

/**
 * Result of a transaction operation
 */
export interface TransactionResult {
  success: boolean
  error?: string
}

// ============================================================================
// State Manager Class
// ============================================================================

/**
 * StateManager handles SQLite-backed state operations
 * This is a helper class that DOCore uses to manage key-value state
 */
export class StateManager {
  constructor(private ctx: DurableObjectState) {}

  /**
   * Initialize the state table in SQLite
   */
  initTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)
  }

  /**
   * Synchronously store a value in SQLite for initialization purposes
   */
  setSync(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      JSON.stringify(value)
    )
  }

  /**
   * Synchronously retrieve a value from SQLite
   */
  getSync(key: string): unknown {
    const results = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray()
    if (results.length === 0) return undefined
    return JSON.parse(results[0].value as string)
  }

  /**
   * Retrieve a value from state by key
   * @param key The state key to retrieve
   * @returns The stored value, or undefined if not found
   */
  async get(key: string): Promise<unknown> {
    const results = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray()

    if (results.length === 0) return undefined

    const valueStr = results[0].value as string
    return JSON.parse(valueStr)
  }

  /**
   * Store a value in state
   * @param key The state key to store under
   * @param value The value to store (will be JSON serialized)
   * @returns true on success
   */
  async set(key: string, value: unknown): Promise<boolean> {
    const valueStr = JSON.stringify(value)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      valueStr
    )
    return true
  }

  /**
   * Remove a value from state
   * @param key The state key to delete
   * @returns true on success
   */
  async delete(key: string): Promise<boolean> {
    this.ctx.storage.sql.exec('DELETE FROM state WHERE key = ?', key)
    return true
  }

  /**
   * Store multiple key-value pairs in state
   * @param entries Object with keys to store
   * @returns true on success
   */
  async setMany(entries: Record<string, unknown>): Promise<boolean> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value)
    }
    return true
  }

  /**
   * Delete multiple keys from state
   * @param keys Array of keys to delete
   * @returns true on success
   */
  async deleteMany(keys: string[]): Promise<boolean> {
    for (const key of keys) {
      await this.delete(key)
    }
    return true
  }

  /**
   * List state entries with optional filtering and pagination
   * @param options Filter and pagination options
   * @returns Object mapping keys to their values
   */
  async list(options: ListOptions = {}): Promise<Record<string, unknown>> {
    const { sql, params } = this.buildListQuery(options)
    const results = this.ctx.storage.sql.exec(sql, ...params).toArray()
    return this.parseStateResults(results)
  }

  /**
   * Build a SQL query with parameters for listing state entries
   */
  private buildListQuery(options: ListOptions): { sql: string; params: (string | number)[] } {
    const { prefix, start, end, limit, reverse } = options
    let query = 'SELECT key, value FROM state'
    const params: (string | number)[] = []
    const conditions: string[] = []

    if (prefix) {
      conditions.push('key LIKE ?')
      params.push(`${prefix}%`)
    }

    if (start) {
      conditions.push('key >= ?')
      params.push(start)
    }

    if (end) {
      conditions.push('key < ?')
      params.push(end)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ` ORDER BY key ${reverse ? 'DESC' : 'ASC'}`

    if (limit) {
      query += ' LIMIT ?'
      params.push(limit)
    }

    return { sql: query, params }
  }

  /**
   * Convert SQL query results to state entries object
   */
  private parseStateResults(results: Array<Record<string, unknown>>): Record<string, unknown> {
    const entries: Record<string, unknown> = {}
    for (const row of results) {
      entries[row.key as string] = JSON.parse(row.value as string)
    }
    return entries
  }

  /**
   * Execute a series of state operations atomically with automatic rollback on error
   * @param ops Array of operations to execute
   * @returns Object indicating success or failure with optional error message
   */
  async transaction(ops: TransactionOp[]): Promise<TransactionResult> {
    // Store original values for rollback
    const originalValues = new Map<string, unknown>()

    try {
      for (const op of ops) {
        if (op.op === 'error') {
          throw new Error('Transaction operation error triggered')
        }

        if (op.op === 'set' && op.key) {
          // Store original for rollback
          const original = await this.get(op.key)
          originalValues.set(op.key, original)
          await this.set(op.key, op.value)
        }

        if (op.op === 'delete' && op.key) {
          const original = await this.get(op.key)
          originalValues.set(op.key, original)
          await this.delete(op.key)
        }
      }

      return { success: true }
    } catch (err) {
      // Rollback all changes on error
      for (const [key, value] of originalValues) {
        if (value === undefined) {
          await this.delete(key)
        } else {
          await this.set(key, value)
        }
      }

      return { success: false, error: (err as Error).message }
    }
  }

  /**
   * Execute a raw SQL query against the state storage
   * @param sql SQL query string with ? placeholders for parameters
   * @param params Parameter values for the query
   * @returns Array of rows matching the query
   */
  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const results = this.ctx.storage.sql.exec(sql, ...params).toArray()
    return results.map((row) => this.parseQueryRow(row))
  }

  /**
   * Parse a single query row, handling JSON-serialized values
   */
  private parseQueryRow(row: Record<string, unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (key === 'value' && typeof value === 'string') {
        try {
          obj[key] = JSON.parse(value)
        } catch {
          obj[key] = value
        }
      } else {
        obj[key] = value
      }
    }
    return obj
  }
}

// ============================================================================
// Type Declarations for Cloudflare
// ============================================================================

declare global {
  interface DurableObjectState {
    storage: {
      sql: {
        exec(sql: string, ...params: unknown[]): { toArray(): Array<Record<string, unknown>> }
      }
      setAlarm(time: number): Promise<void>
      getAlarm(): Promise<number | null>
      deleteAlarm(): Promise<void>
    }
  }
}
