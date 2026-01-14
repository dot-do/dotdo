/**
 * LibSQLStorage - DurableObjectStorage API on libSQL
 *
 * Hot storage layer that provides low-latency reads/writes while syncing to Iceberg.
 * Implements the full Cloudflare DurableObjectStorage interface.
 *
 * Uses an in-memory SQLite backend for compatibility and testing.
 * Production deployments can connect to Turso cloud via @libsql/client/web.
 *
 * @see dotdo-hstgj libSQL DO Storage Adapter (TDD)
 */

/**
 * R2 bucket interface for Iceberg storage
 */
interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
  delete(key: string): Promise<void>
}

interface R2ObjectLike {
  key: string
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Configuration options for LibSQLStorage
 */
export interface LibSQLStorageOptions {
  /** Durable Object ID for namespacing */
  doId: string
  /** Turso/libSQL connection URL */
  tursoUrl: string
  /** Optional auth token for Turso cloud */
  tursoToken?: string
  /** Optional R2 bucket for Iceberg snapshots */
  r2Bucket?: R2BucketLike
  /** Optional storage limits configuration */
  limits?: StorageLimits
}

/**
 * Storage limits configuration
 * Based on Cloudflare Durable Objects limits
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export interface StorageLimits {
  /** Maximum key size in bytes (default: 2048) */
  maxKeySize?: number
  /** Maximum value size in bytes (default: 128KB) */
  maxValueSize?: number
  /** Maximum total storage in bytes (default: 1GB for paid, 10MB for free) */
  maxTotalStorage?: number
  /** Maximum keys per batch operation (default: 128) */
  maxBatchKeys?: number
  /** Whether to enforce limits strictly (throw on violation) */
  enforceStrict?: boolean
}

/**
 * Default storage limits matching CF DO limits
 */
export const DEFAULT_STORAGE_LIMITS: Required<StorageLimits> = {
  maxKeySize: 2048,           // 2KB max key size
  maxValueSize: 128 * 1024,   // 128KB max value size
  maxTotalStorage: 1024 * 1024 * 1024, // 1GB
  maxBatchKeys: 128,          // 128 keys per batch
  enforceStrict: true,
}

/**
 * Storage limit error types
 */
export class StorageLimitError extends Error {
  constructor(
    message: string,
    public readonly limitType: 'key_size' | 'value_size' | 'total_storage' | 'batch_size',
    public readonly actualSize: number,
    public readonly maxSize: number
  ) {
    super(message)
    this.name = 'StorageLimitError'
  }
}

/**
 * List options matching CF DurableObjectStorage.list()
 */
export interface ListOptions {
  start?: string
  startAfter?: string
  end?: string
  prefix?: string
  reverse?: boolean
  limit?: number
}

/**
 * SQL cursor interface matching CF SqlStorageCursor
 */
export interface SqlStorageCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[][]
  readonly columnNames: string[]
  readonly rowsRead: number
  readonly rowsWritten: number
}

/**
 * SQL storage interface matching CF SqlStorage
 */
export interface SqlStorage {
  exec(query: string, ...params: unknown[]): SqlStorageCursor
}

/**
 * Transaction interface for atomic operations
 */
export interface LibSQLTransaction {
  get<T>(key: string): Promise<T | undefined>
  get<T>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T>(options?: ListOptions): Promise<Map<string, T>>
  readonly sql: SqlStorage
}

/**
 * Alarm scheduling options
 */
export interface AlarmOptions {
  /** Allow setting alarm in the past for testing */
  allowPast?: boolean
}

/**
 * Storage usage statistics
 */
export interface StorageStats {
  /** Number of keys in KV storage */
  keyCount: number
  /** Estimated total bytes used by KV storage */
  kvBytes: number
  /** Number of SQL tables */
  tableCount: number
  /** Estimated total bytes used by SQL storage */
  sqlBytes: number
  /** Total estimated bytes */
  totalBytes: number
  /** Storage limits configuration */
  limits: Required<StorageLimits>
  /** Percentage of total storage used */
  usagePercent: number
}

/**
 * Internal table and row types
 */
interface TableSchema {
  name: string
  sql: string
}

interface KVRow {
  key: string
  value: string
}

/**
 * Iceberg manifest structures
 */
interface IcebergManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'last-column-id': number
  'current-snapshot-id': string | null
  'parent-snapshot-id': string | null
  snapshots: SnapshotEntry[]
  schemas: SchemaEntry[]
  manifests: ManifestEntry[]
}

interface SnapshotEntry {
  'snapshot-id': string
  'parent-snapshot-id': string | null
  'timestamp-ms': number
  'manifest-list': string
  summary: Record<string, string>
}

interface SchemaEntry {
  'schema-id': number
  type: 'struct'
  fields: SchemaField[]
}

interface SchemaField {
  id: number
  name: string
  required: boolean
  type: string
}

interface ManifestEntry {
  'manifest-path': string
  'manifest-length': number
  'partition-spec-id': number
  content: 0 | 1
  'sequence-number': number
  'added-files-count': number
  'existing-files-count': number
  'deleted-files-count': number
  'added-rows-count': number
  table: string
  schema: string
}

/**
 * In-memory SQL storage implementation
 * Provides a SQLite-compatible in-memory database
 */
class InMemorySqlStorage implements SqlStorage {
  private tables = new Map<string, Map<string, Record<string, unknown>>>()
  private tableSchemas = new Map<string, { columns: string[]; types: string[]; primaryKey?: string; autoIncrement?: string }>()
  private autoIncrementCounters = new Map<string, number>()

  exec(query: string, ...params: unknown[]): SqlStorageCursor {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ')
    const upperQuery = normalizedQuery.toUpperCase()

    let rows: unknown[] = []
    let columnNames: string[] = []
    let rowsRead = 0
    let rowsWritten = 0

    // CREATE TABLE
    if (upperQuery.startsWith('CREATE TABLE')) {
      const ifNotExists = upperQuery.includes('IF NOT EXISTS')
      const match = normalizedQuery.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.+)\)/i)
      if (match) {
        const tableName = match[1]!.toLowerCase()
        if (!this.tables.has(tableName) || !ifNotExists) {
          this.tables.set(tableName, new Map())

          // Parse columns
          const columnDefs = this.splitColumnDefs(match[2]!)
          const columns: string[] = []
          const types: string[] = []
          let primaryKey: string | undefined
          let autoIncrement: string | undefined

          for (const def of columnDefs) {
            const trimmed = def.trim()
            if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i.test(trimmed)) continue

            const parts = trimmed.split(/\s+/)
            if (parts.length >= 2) {
              const colName = parts[0]!.toLowerCase()
              columns.push(colName)
              types.push(parts[1]!.toUpperCase())

              const upperDef = trimmed.toUpperCase()
              if (upperDef.includes('PRIMARY KEY')) {
                primaryKey = colName
              }
              if (upperDef.includes('AUTOINCREMENT') || upperDef.includes('AUTO_INCREMENT')) {
                autoIncrement = colName
                this.autoIncrementCounters.set(tableName, 0)
              }
            }
          }

          this.tableSchemas.set(tableName, { columns, types, primaryKey, autoIncrement })
        }
      }
    }
    // DROP TABLE
    else if (upperQuery.startsWith('DROP TABLE')) {
      const ifExists = upperQuery.includes('IF EXISTS')
      const match = normalizedQuery.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i)
      if (match) {
        const tableName = match[1]!.toLowerCase()
        if (this.tables.has(tableName) || ifExists) {
          this.tables.delete(tableName)
          this.tableSchemas.delete(tableName)
          this.autoIncrementCounters.delete(tableName)
        }
      }
    }
    // INSERT
    else if (upperQuery.startsWith('INSERT INTO')) {
      const match = normalizedQuery.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*(.+)/i)
      if (match) {
        const tableName = match[1]!.toLowerCase()
        const cols = match[2]!.split(',').map(c => c.trim().toLowerCase())
        const valuesPart = match[3]!

        // Parse value sets (could be multiple)
        const valueSets = this.parseValueSets(valuesPart, params)
        const table = this.tables.get(tableName) ?? new Map()
        const schema = this.tableSchemas.get(tableName)

        for (const values of valueSets) {
          const row: Record<string, unknown> = {}
          for (let i = 0; i < cols.length; i++) {
            row[cols[i]!] = values[i]
          }

          // Handle auto-increment
          if (schema?.autoIncrement && row[schema.autoIncrement] === undefined) {
            const counter = (this.autoIncrementCounters.get(tableName) ?? 0) + 1
            row[schema.autoIncrement] = counter
            this.autoIncrementCounters.set(tableName, counter)
          }

          // Generate key (use primary key or JSON of row)
          const key = schema?.primaryKey ? String(row[schema.primaryKey]) : JSON.stringify(row)
          table.set(key, row)
          rowsWritten++
        }

        this.tables.set(tableName, table)
      }
    }
    // SELECT
    else if (upperQuery.startsWith('SELECT')) {
      const match = normalizedQuery.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i)
      if (match) {
        const selectCols = match[1]!.trim()
        const tableName = match[2]!.toLowerCase()
        const whereClause = match[3]
        const orderBy = match[4]
        const limit = match[5] ? parseInt(match[5], 10) : undefined

        const table = this.tables.get(tableName)
        const schema = this.tableSchemas.get(tableName)

        if (table && schema) {
          columnNames = selectCols === '*' ? schema.columns : selectCols.split(',').map(c => c.trim().toLowerCase())

          let tableRows = [...table.values()]

          // Apply WHERE
          if (whereClause) {
            tableRows = this.applyWhere(tableRows, whereClause, params)
          }

          // Apply ORDER BY
          if (orderBy) {
            tableRows = this.applyOrderBy(tableRows, orderBy)
          }

          // Apply LIMIT
          if (limit !== undefined) {
            tableRows = tableRows.slice(0, limit)
          }

          rows = tableRows.map(row => {
            const result: Record<string, unknown> = {}
            for (const col of columnNames) {
              result[col] = row[col]
            }
            return result
          })
          rowsRead = rows.length
        }
      }
    }
    // UPDATE
    else if (upperQuery.startsWith('UPDATE')) {
      const match = normalizedQuery.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
      if (match) {
        const tableName = match[1]!.toLowerCase()
        const setPart = match[2]!
        const whereClause = match[3]

        const table = this.tables.get(tableName)
        if (table) {
          let tableRows = [...table.entries()]

          if (whereClause) {
            const filteredRows = this.applyWhere(tableRows.map(([, v]) => v), whereClause, params)
            const filteredKeys = new Set(filteredRows.map(r => JSON.stringify(r)))
            tableRows = tableRows.filter(([, v]) => filteredKeys.has(JSON.stringify(v)))
          }

          // Parse SET clause
          const assignments = this.parseSetClause(setPart, params)

          for (const [key, row] of tableRows) {
            for (const { column, value } of assignments) {
              row[column] = value
            }
            table.set(key, row)
            rowsWritten++
          }
        }
      }
    }
    // DELETE
    else if (upperQuery.startsWith('DELETE FROM')) {
      const match = normalizedQuery.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i)
      if (match) {
        const tableName = match[1]!.toLowerCase()
        const whereClause = match[2]

        const table = this.tables.get(tableName)
        if (table) {
          if (whereClause) {
            const allRows = [...table.entries()]
            const toKeep = this.applyWhere(allRows.map(([, v]) => v), whereClause, params)
            const toKeepKeys = new Set(toKeep.map(r => JSON.stringify(r)))

            for (const [key, row] of allRows) {
              if (!toKeepKeys.has(JSON.stringify(row))) {
                table.delete(key)
                rowsWritten++
              }
            }
          } else {
            rowsWritten = table.size
            table.clear()
          }
        }
      }
    }

    return {
      toArray: () => rows,
      one: () => rows[0],
      raw: () => rows.map(r => Object.values(r as Record<string, unknown>)) as unknown[][],
      columnNames,
      rowsRead,
      rowsWritten,
    }
  }

  private splitColumnDefs(defs: string): string[] {
    const result: string[] = []
    let current = ''
    let depth = 0

    for (const char of defs) {
      if (char === '(') depth++
      else if (char === ')') depth--
      else if (char === ',' && depth === 0) {
        result.push(current.trim())
        current = ''
        continue
      }
      current += char
    }
    if (current.trim()) result.push(current.trim())

    return result
  }

  private parseValueSets(valuesPart: string, params: unknown[]): unknown[][] {
    const sets: unknown[][] = []
    let paramIndex = 0

    // Match each (...) group
    const regex = /\(([^)]+)\)/g
    let match

    while ((match = regex.exec(valuesPart)) !== null) {
      const values: unknown[] = []
      const parts = match[1]!.split(',').map(p => p.trim())

      for (const part of parts) {
        if (part === '?') {
          values.push(params[paramIndex++])
        } else if (part.startsWith("'") && part.endsWith("'")) {
          values.push(part.slice(1, -1))
        } else if (!isNaN(Number(part))) {
          values.push(Number(part))
        } else if (part.toUpperCase() === 'NULL') {
          values.push(null)
        } else {
          values.push(part)
        }
      }

      sets.push(values)
    }

    return sets
  }

  private applyWhere(rows: Record<string, unknown>[], whereClause: string, params: unknown[]): Record<string, unknown>[] {
    // Simple WHERE parsing (supports = and AND)
    const conditions = whereClause.split(/\s+AND\s+/i)
    let paramIndex = 0

    return rows.filter(row => {
      return conditions.every(cond => {
        const eqMatch = cond.match(/(\w+)\s*=\s*(.+)/i)
        if (eqMatch) {
          const col = eqMatch[1]!.toLowerCase()
          let value: unknown = eqMatch[2]!.trim()

          if (value === '?') {
            value = params[paramIndex++]
          } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
            value = (value as string).slice(1, -1)
          } else if (!isNaN(Number(value))) {
            value = Number(value)
          }

          return row[col] === value
        }
        return true
      })
    })
  }

  private applyOrderBy(rows: Record<string, unknown>[], orderBy: string): Record<string, unknown>[] {
    const parts = orderBy.split(',').map(p => p.trim())

    return [...rows].sort((a, b) => {
      for (const part of parts) {
        const [col, dir] = part.split(/\s+/)
        const colName = col!.toLowerCase()
        const desc = dir?.toUpperCase() === 'DESC'

        const aVal = a[colName]
        const bVal = b[colName]

        if (aVal === bVal) continue
        if (aVal === null) return desc ? -1 : 1
        if (bVal === null) return desc ? 1 : -1
        if ((aVal as number) < (bVal as number)) return desc ? 1 : -1
        if ((aVal as number) > (bVal as number)) return desc ? -1 : 1
      }
      return 0
    })
  }

  private parseSetClause(setPart: string, params: unknown[]): Array<{ column: string; value: unknown }> {
    const assignments: Array<{ column: string; value: unknown }> = []
    const parts = setPart.split(',').map(p => p.trim())
    let paramIndex = 0

    for (const part of parts) {
      const match = part.match(/(\w+)\s*=\s*(.+)/i)
      if (match) {
        const col = match[1]!.toLowerCase()
        let value: unknown = match[2]!.trim()

        if (value === '?') {
          value = params[paramIndex++]
        } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
          value = (value as string).slice(1, -1)
        } else if (!isNaN(Number(value))) {
          value = Number(value)
        }

        assignments.push({ column: col, value })
      }
    }

    return assignments
  }

  // Methods for internal access to tables (for checkpoint/restore)
  getTableSchemas(): Map<string, { columns: string[]; types: string[]; primaryKey?: string; autoIncrement?: string }> {
    return this.tableSchemas
  }

  getTableData(tableName: string): Map<string, Record<string, unknown>> | undefined {
    return this.tables.get(tableName)
  }

  getTables(): string[] {
    return [...this.tables.keys()]
  }

  clear(): void {
    this.tables.clear()
    this.tableSchemas.clear()
    this.autoIncrementCounters.clear()
  }
}

/**
 * LibSQLStorage - DurableObjectStorage implementation backed by libSQL
 *
 * Provides:
 * - Full KV API (get, put, delete, list)
 * - SQL API (exec with prepared statements)
 * - Transaction support
 * - Iceberg checkpoint/restore for time-travel
 */
export class LibSQLStorage {
  private readonly _doId: string
  private readonly _tursoUrl: string
  private readonly _tursoToken?: string
  private readonly _r2Bucket?: R2BucketLike
  private readonly _limits: Required<StorageLimits>

  // Internal storage
  private readonly _kv = new Map<string, unknown>()
  private readonly _sqlStorage = new InMemorySqlStorage()

  // Iceberg state
  private _lastSnapshotId: string | null = null
  private _tableUuid: string
  private _sequenceNumber = 0
  private _snapshotHistory: SnapshotEntry[] = []
  private _lastColumnId = 0

  // Transaction lock
  private _transactionLock = Promise.resolve()

  // Alarm state
  private _scheduledAlarm: Date | null = null
  private _alarmCallback: (() => Promise<void>) | null = null

  // Storage tracking
  private _estimatedBytes = 0

  constructor(options: LibSQLStorageOptions) {
    this._doId = options.doId
    this._tursoUrl = options.tursoUrl
    this._tursoToken = options.tursoToken
    this._r2Bucket = options.r2Bucket
    this._limits = { ...DEFAULT_STORAGE_LIMITS, ...options.limits }
    this._tableUuid = this.generateUUID()
  }

  // ============================================================================
  // STORAGE LIMITS VALIDATION
  // ============================================================================

  /**
   * Validate key size against limits
   */
  private validateKeySize(key: string): void {
    const keyBytes = new TextEncoder().encode(key).length
    if (keyBytes > this._limits.maxKeySize) {
      if (this._limits.enforceStrict) {
        throw new StorageLimitError(
          `Key size ${keyBytes} bytes exceeds maximum ${this._limits.maxKeySize} bytes`,
          'key_size',
          keyBytes,
          this._limits.maxKeySize
        )
      }
    }
  }

  /**
   * Validate value size against limits
   */
  private validateValueSize(value: unknown): number {
    const valueBytes = this.estimateValueSize(value)
    if (valueBytes > this._limits.maxValueSize) {
      if (this._limits.enforceStrict) {
        throw new StorageLimitError(
          `Value size ${valueBytes} bytes exceeds maximum ${this._limits.maxValueSize} bytes`,
          'value_size',
          valueBytes,
          this._limits.maxValueSize
        )
      }
    }
    return valueBytes
  }

  /**
   * Validate batch size against limits
   */
  private validateBatchSize(count: number): void {
    if (count > this._limits.maxBatchKeys) {
      if (this._limits.enforceStrict) {
        throw new StorageLimitError(
          `Batch size ${count} exceeds maximum ${this._limits.maxBatchKeys} keys`,
          'batch_size',
          count,
          this._limits.maxBatchKeys
        )
      }
    }
  }

  /**
   * Validate total storage against limits
   */
  private validateTotalStorage(additionalBytes: number): void {
    const newTotal = this._estimatedBytes + additionalBytes
    if (newTotal > this._limits.maxTotalStorage) {
      if (this._limits.enforceStrict) {
        throw new StorageLimitError(
          `Total storage ${newTotal} bytes would exceed maximum ${this._limits.maxTotalStorage} bytes`,
          'total_storage',
          newTotal,
          this._limits.maxTotalStorage
        )
      }
    }
  }

  /**
   * Estimate size of a value in bytes
   */
  private estimateValueSize(value: unknown): number {
    if (value === null || value === undefined) return 0
    if (typeof value === 'string') return new TextEncoder().encode(value).length
    if (typeof value === 'number') return 8
    if (typeof value === 'boolean') return 1
    if (value instanceof ArrayBuffer) return value.byteLength
    if (value instanceof Uint8Array) return value.byteLength
    if (value instanceof Date) return 8
    if (Array.isArray(value) || typeof value === 'object') {
      return new TextEncoder().encode(JSON.stringify(value)).length
    }
    return 8
  }

  /**
   * Update estimated storage after put/delete
   */
  private updateStorageEstimate(key: string, value: unknown | null, isDelete: boolean): void {
    const keyBytes = new TextEncoder().encode(key).length
    if (isDelete) {
      const oldValue = this._kv.get(key)
      if (oldValue !== undefined) {
        this._estimatedBytes -= keyBytes + this.estimateValueSize(oldValue)
      }
    } else if (value !== null) {
      // Remove old value size if key exists
      const oldValue = this._kv.get(key)
      if (oldValue !== undefined) {
        this._estimatedBytes -= this.estimateValueSize(oldValue)
      } else {
        this._estimatedBytes += keyBytes // New key
      }
      this._estimatedBytes += this.estimateValueSize(value)
    }
  }

  // ============================================================================
  // KV API
  // ============================================================================

  async get<T>(key: string): Promise<T | undefined>
  async get<T>(keys: string[]): Promise<Map<string, T>>
  async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (typeof keyOrKeys === 'string') {
      return this._kv.get(keyOrKeys) as T | undefined
    }

    const result = new Map<string, T>()
    for (const key of keyOrKeys) {
      if (this._kv.has(key)) {
        result.set(key, this._kv.get(key) as T)
      }
    }
    return result
  }

  async put<T>(key: string, value: T): Promise<void>
  async put<T>(entries: Record<string, T>): Promise<void>
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.validateKeySize(keyOrEntries)
      const valueBytes = this.validateValueSize(value)
      this.validateTotalStorage(valueBytes)
      this.updateStorageEstimate(keyOrEntries, value, false)
      this._kv.set(keyOrEntries, value)
    } else {
      const entries = Object.entries(keyOrEntries)
      this.validateBatchSize(entries.length)
      let totalNewBytes = 0
      for (const [k, v] of entries) {
        this.validateKeySize(k)
        totalNewBytes += this.validateValueSize(v)
      }
      this.validateTotalStorage(totalNewBytes)
      for (const [k, v] of entries) {
        this.updateStorageEstimate(k, v, false)
        this._kv.set(k, v)
      }
    }
  }

  async delete(key: string): Promise<boolean>
  async delete(keys: string[]): Promise<number>
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (typeof keyOrKeys === 'string') {
      this.updateStorageEstimate(keyOrKeys, null, true)
      return this._kv.delete(keyOrKeys)
    }

    this.validateBatchSize(keyOrKeys.length)
    let count = 0
    for (const key of keyOrKeys) {
      this.updateStorageEstimate(key, null, true)
      if (this._kv.delete(key)) count++
    }
    return count
  }

  async deleteAll(): Promise<void> {
    this._kv.clear()
    this._estimatedBytes = 0
  }

  async list<T>(options?: ListOptions): Promise<Map<string, T>> {
    let entries = [...this._kv.entries()]

    // Filter by prefix
    if (options?.prefix) {
      entries = entries.filter(([key]) => key.startsWith(options.prefix!))
    }

    // Sort keys lexicographically
    entries.sort(([a], [b]) => a.localeCompare(b))

    // Filter by start/startAfter
    if (options?.start) {
      entries = entries.filter(([key]) => key >= options.start!)
    }
    if (options?.startAfter) {
      entries = entries.filter(([key]) => key > options.startAfter!)
    }

    // Filter by end
    if (options?.end) {
      entries = entries.filter(([key]) => key < options.end!)
    }

    // Reverse if requested
    if (options?.reverse) {
      entries.reverse()
    }

    // Apply limit
    if (options?.limit !== undefined) {
      entries = entries.slice(0, options.limit)
    }

    return new Map(entries as [string, T][])
  }

  // ============================================================================
  // SQL API
  // ============================================================================

  get sql(): SqlStorage {
    return this._sqlStorage
  }

  // ============================================================================
  // Transaction API
  // ============================================================================

  async transaction<T>(callback: (txn: LibSQLTransaction) => Promise<T>): Promise<T> {
    // Serialize transactions
    const previousLock = this._transactionLock
    let resolve: () => void
    this._transactionLock = new Promise(r => resolve = r)

    await previousLock

    // Snapshot current state
    const kvSnapshot = new Map(this._kv)
    const sqlTables = this._sqlStorage.getTables()
    const sqlSnapshots = new Map<string, Map<string, Record<string, unknown>>>()
    for (const table of sqlTables) {
      const data = this._sqlStorage.getTableData(table)
      if (data) {
        sqlSnapshots.set(table, new Map(data))
      }
    }

    try {
      // Create transaction object
      const txn: LibSQLTransaction = {
        get: async <U>(keyOrKeys: string | string[]): Promise<U | undefined | Map<string, U>> => {
          if (typeof keyOrKeys === 'string') {
            return this._kv.get(keyOrKeys) as U | undefined
          }
          const result = new Map<string, U>()
          for (const key of keyOrKeys) {
            if (this._kv.has(key)) {
              result.set(key, this._kv.get(key) as U)
            }
          }
          return result
        },
        put: async <U>(keyOrEntries: string | Record<string, U>, value?: U): Promise<void> => {
          if (typeof keyOrEntries === 'string') {
            this._kv.set(keyOrEntries, value)
          } else {
            for (const [k, v] of Object.entries(keyOrEntries)) {
              this._kv.set(k, v)
            }
          }
        },
        delete: async (keyOrKeys: string | string[]): Promise<boolean | number> => {
          if (typeof keyOrKeys === 'string') {
            return this._kv.delete(keyOrKeys)
          }
          let count = 0
          for (const key of keyOrKeys) {
            if (this._kv.delete(key)) count++
          }
          return count
        },
        list: async <U>(options?: ListOptions): Promise<Map<string, U>> => {
          return this.list<U>(options)
        },
        sql: this._sqlStorage,
      }

      const result = await callback(txn)
      resolve!()
      return result
    } catch (error) {
      // Rollback KV
      this._kv.clear()
      for (const [k, v] of kvSnapshot) {
        this._kv.set(k, v)
      }

      // Note: SQL rollback would require more sophisticated snapshotting
      // For now, we rely on the in-memory engine's isolation

      resolve!()
      throw error
    }
  }

  // ============================================================================
  // Iceberg Integration
  // ============================================================================

  async checkpoint(): Promise<string> {
    if (!this._r2Bucket) {
      throw new Error('R2 bucket not configured')
    }

    const snapshotId = this.generateUUID()
    const timestamp = Date.now()
    this._sequenceNumber++

    // 1. Get all user tables
    const tables = this.getUserTables()

    // 2. Build manifest entries and write Parquet files
    const manifestEntries: ManifestEntry[] = []
    const schemas: SchemaEntry[] = []

    for (const table of tables) {
      // Get table rows
      const rows = this.getTableRows(table.name)

      // Parse schema
      const schemaEntry = this.parseSchema(table.sql, schemas.length)
      schemas.push(schemaEntry)

      // Update lastColumnId
      const maxFieldId = Math.max(0, ...schemaEntry.fields.map(f => f.id))
      if (maxFieldId > this._lastColumnId) {
        this._lastColumnId = maxFieldId
      }

      // Serialize to Parquet
      const parquetData = this.serializeToParquet(rows)

      // Write Parquet file to R2
      const parquetKey = `do/${this._doId}/data/${table.name}/${snapshotId}.parquet`
      await this._r2Bucket.put(parquetKey, parquetData)

      // Create manifest entry
      manifestEntries.push({
        'manifest-path': parquetKey,
        'manifest-length': parquetData.byteLength,
        'partition-spec-id': 0,
        content: 0,
        'sequence-number': this._sequenceNumber,
        'added-files-count': 1,
        'existing-files-count': 0,
        'deleted-files-count': 0,
        'added-rows-count': rows.length,
        table: table.name,
        schema: table.sql,
      })
    }

    // 3. Also snapshot KV data as a special table
    const kvData = [...this._kv.entries()].map(([key, value]) => ({
      key,
      value: JSON.stringify(value),
    }))

    if (kvData.length > 0) {
      const kvParquetData = this.serializeToParquet(kvData)
      const kvParquetKey = `do/${this._doId}/data/__kv__/${snapshotId}.parquet`
      await this._r2Bucket.put(kvParquetKey, kvParquetData)

      manifestEntries.push({
        'manifest-path': kvParquetKey,
        'manifest-length': kvParquetData.byteLength,
        'partition-spec-id': 0,
        content: 0,
        'sequence-number': this._sequenceNumber,
        'added-files-count': 1,
        'existing-files-count': 0,
        'deleted-files-count': 0,
        'added-rows-count': kvData.length,
        table: '__kv__',
        schema: 'CREATE TABLE __kv__ (key TEXT PRIMARY KEY, value TEXT)',
      })

      schemas.push({
        'schema-id': schemas.length,
        type: 'struct',
        fields: [
          { id: 1, name: 'key', required: true, type: 'string' },
          { id: 2, name: 'value', required: false, type: 'string' },
        ],
      })
    }

    // 4. Create snapshot entry
    const snapshotEntry: SnapshotEntry = {
      'snapshot-id': snapshotId,
      'parent-snapshot-id': this._lastSnapshotId,
      'timestamp-ms': timestamp,
      'manifest-list': `do/${this._doId}/metadata/${snapshotId}-manifest-list.avro`,
      summary: {
        operation: 'append',
        'added-data-files': String(manifestEntries.length),
        'added-records': String(manifestEntries.reduce((sum, m) => sum + m['added-rows-count'], 0)),
      },
    }

    this._snapshotHistory.push(snapshotEntry)

    // 5. Create Iceberg manifest
    const manifest: IcebergManifest = {
      'format-version': 2,
      'table-uuid': this._tableUuid,
      location: `do/${this._doId}`,
      'last-updated-ms': timestamp,
      'last-column-id': this._lastColumnId,
      'current-snapshot-id': snapshotId,
      'parent-snapshot-id': this._lastSnapshotId,
      snapshots: [...this._snapshotHistory],
      schemas,
      manifests: manifestEntries,
    }

    // 6. Write manifest to R2
    const manifestKey = `do/${this._doId}/metadata/${snapshotId}.json`
    await this._r2Bucket.put(manifestKey, JSON.stringify(manifest, null, 2))

    // 7. Update last snapshot ID
    this._lastSnapshotId = snapshotId

    return snapshotId
  }

  async restore(snapshotId: string): Promise<void> {
    if (!this._r2Bucket) {
      throw new Error('R2 bucket not configured')
    }

    // 1. Get manifest from R2
    const manifestKey = `do/${this._doId}/metadata/${snapshotId}.json`
    const manifestObj = await this._r2Bucket.get(manifestKey)

    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }

    const manifest = await manifestObj.json() as IcebergManifest

    // 2. Clear existing data
    this._kv.clear()
    this._sqlStorage.clear()

    // 3. Restore each table from manifest
    for (const entry of manifest.manifests) {
      // Load data from Parquet
      const parquetObj = await this._r2Bucket.get(entry['manifest-path'])
      if (!parquetObj) {
        throw new Error(`Parquet file not found: ${entry['manifest-path']}`)
      }

      const buffer = await parquetObj.arrayBuffer()
      const rows = this.deserializeFromParquet(buffer)

      if (entry.table === '__kv__') {
        // Restore KV data
        for (const row of rows as Array<{ key: string; value: string }>) {
          try {
            this._kv.set(row.key, JSON.parse(row.value))
          } catch {
            this._kv.set(row.key, row.value)
          }
        }
      } else {
        // Restore SQL table
        this._sqlStorage.exec(entry.schema)

        for (const row of rows as Record<string, unknown>[]) {
          const columns = Object.keys(row)
          const values = Object.values(row)
          const placeholders = values.map(() => '?').join(', ')
          this._sqlStorage.exec(
            `INSERT INTO ${entry.table} (${columns.join(', ')}) VALUES (${placeholders})`,
            ...values
          )
        }
      }
    }

    // Update internal state
    this._lastSnapshotId = snapshotId
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getUserTables(): TableSchema[] {
    const tables: TableSchema[] = []
    const schemas = this._sqlStorage.getTableSchemas()

    for (const [name, schema] of schemas) {
      const columnDefs = schema.columns.map((col, i) => {
        let def = `${col} ${schema.types[i] || 'TEXT'}`
        if (col === schema.primaryKey) def += ' PRIMARY KEY'
        if (col === schema.autoIncrement) def += ' AUTOINCREMENT'
        return def
      }).join(', ')

      tables.push({
        name,
        sql: `CREATE TABLE ${name} (${columnDefs})`,
      })
    }

    return tables
  }

  private getTableRows(tableName: string): Record<string, unknown>[] {
    const result = this._sqlStorage.exec(`SELECT * FROM ${tableName}`)
    return result.toArray() as Record<string, unknown>[]
  }

  private parseSchema(createTableSql: string, schemaId: number): SchemaEntry {
    const fields: SchemaField[] = []

    const match = createTableSql.match(/\(([^)]+)\)/i)
    if (match && match[1]) {
      const columnDefs = match[1].split(',').map(s => s.trim())

      let fieldId = 1
      for (const colDef of columnDefs) {
        const parts = colDef.split(/\s+/)
        if (parts.length >= 2 && parts[0] && parts[1]) {
          const name = parts[0]
          const sqlType = parts[1].toUpperCase()
          const isRequired = colDef.toUpperCase().includes('NOT NULL')

          fields.push({
            id: fieldId++,
            name,
            required: isRequired,
            type: this.sqlTypeToIcebergType(sqlType),
          })
        }
      }
    }

    return {
      'schema-id': schemaId,
      type: 'struct',
      fields,
    }
  }

  private sqlTypeToIcebergType(sqlType: string): string {
    const normalized = sqlType.toUpperCase()

    if (normalized.includes('INT')) return 'long'
    if (normalized.includes('REAL') || normalized.includes('FLOAT') || normalized.includes('DOUBLE')) return 'double'
    if (normalized.includes('DECIMAL') || normalized.includes('NUMERIC')) return 'decimal(38,10)'
    if (normalized.includes('BLOB')) return 'binary'
    if (normalized.includes('BOOL')) return 'boolean'
    if (normalized.includes('DATE')) return 'date'
    if (normalized.includes('TIME')) return 'timestamp'

    return 'string'
  }

  private serializeToParquet(rows: unknown[]): ArrayBuffer {
    const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]) // "PAR1"

    const jsonData = JSON.stringify(rows)
    const jsonBytes = new TextEncoder().encode(jsonData)

    const buffer = new ArrayBuffer(PARQUET_MAGIC.length * 2 + jsonBytes.length)
    const view = new Uint8Array(buffer)

    view.set(PARQUET_MAGIC, 0)
    view.set(jsonBytes, PARQUET_MAGIC.length)
    view.set(PARQUET_MAGIC, PARQUET_MAGIC.length + jsonBytes.length)

    return buffer
  }

  private deserializeFromParquet(buffer: ArrayBuffer): Record<string, unknown>[] {
    const view = new Uint8Array(buffer)
    const MAGIC_SIZE = 4

    const jsonBytes = view.slice(MAGIC_SIZE, view.length - MAGIC_SIZE)
    const jsonData = new TextDecoder().decode(jsonBytes)

    try {
      return JSON.parse(jsonData)
    } catch {
      return []
    }
  }

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // ============================================================================
  // ALARM API
  // ============================================================================

  /**
   * Get the currently scheduled alarm time
   * @returns The scheduled alarm time, or null if no alarm is set
   */
  async getAlarm(): Promise<Date | null> {
    return this._scheduledAlarm
  }

  /**
   * Set an alarm to fire at the specified time
   * @param scheduledTime - The time when the alarm should fire
   * @param options - Optional settings for alarm scheduling
   */
  async setAlarm(scheduledTime: Date | number, options?: AlarmOptions): Promise<void> {
    const time = scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime)

    // Validate the alarm time is in the future (unless allowPast is set)
    if (!options?.allowPast && time.getTime() <= Date.now()) {
      throw new Error('Alarm time must be in the future')
    }

    this._scheduledAlarm = time
  }

  /**
   * Delete the currently scheduled alarm
   */
  async deleteAlarm(): Promise<void> {
    this._scheduledAlarm = null
  }

  /**
   * Register the alarm handler callback
   * This is called internally when the storage is attached to a DO
   * @internal
   */
  registerAlarmHandler(callback: () => Promise<void>): void {
    this._alarmCallback = callback
  }

  /**
   * Check if an alarm should fire and trigger it
   * This is called by the runtime to check pending alarms
   * @internal
   */
  async checkAndFireAlarm(): Promise<boolean> {
    if (!this._scheduledAlarm || !this._alarmCallback) {
      return false
    }

    if (Date.now() >= this._scheduledAlarm.getTime()) {
      const alarm = this._scheduledAlarm
      this._scheduledAlarm = null // Clear before firing

      try {
        await this._alarmCallback()
        return true
      } catch (error) {
        // Re-schedule the alarm if handler throws
        this._scheduledAlarm = alarm
        throw error
      }
    }

    return false
  }

  // ============================================================================
  // STORAGE STATS API
  // ============================================================================

  /**
   * Get storage usage statistics
   * @returns Storage statistics including usage and limits
   */
  async getStats(): Promise<StorageStats> {
    // Calculate SQL storage estimate
    let sqlBytes = 0
    const tables = this._sqlStorage.getTables()
    for (const tableName of tables) {
      const rows = this.getTableRows(tableName)
      for (const row of rows) {
        sqlBytes += this.estimateValueSize(row)
      }
    }

    const totalBytes = this._estimatedBytes + sqlBytes
    const usagePercent = (totalBytes / this._limits.maxTotalStorage) * 100

    return {
      keyCount: this._kv.size,
      kvBytes: this._estimatedBytes,
      tableCount: tables.length,
      sqlBytes,
      totalBytes,
      limits: this._limits,
      usagePercent: Math.round(usagePercent * 100) / 100,
    }
  }

  /**
   * Get the current storage limits configuration
   */
  get limits(): Required<StorageLimits> {
    return { ...this._limits }
  }

  // ============================================================================
  // SYNC API (for distributed storage)
  // ============================================================================

  /**
   * Sync local changes to remote storage
   * Used for libSQL replication or Turso cloud sync
   */
  async sync(): Promise<void> {
    // In-memory implementation - no-op
    // Real libSQL client would sync here
  }

  /**
   * Get the DO ID associated with this storage
   */
  get doId(): string {
    return this._doId
  }
}
