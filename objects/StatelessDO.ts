/**
 * StatelessDO - Base class for stateless Durable Objects
 *
 * Provides a drop-in replacement for DurableObject that integrates libSQL storage
 * with Iceberg persistence. This enables Durable Objects to run on any platform
 * (Vercel, fly.io, K8s, etc.) with state durability through Iceberg snapshots.
 *
 * Key Features:
 * - Drop-in replacement for DurableObject
 * - Existing DO code works unchanged
 * - save() creates Iceberg snapshot
 * - restore() loads from snapshot
 * - clone() creates new DO from state
 * - snapshots() lists available snapshots
 *
 * @example Basic Usage
 * ```typescript
 * import { StatelessDO } from 'dotdo'
 *
 * class MyService extends StatelessDO {
 *   async fetch(request: Request): Promise<Response> {
 *     // Use storage just like regular DO
 *     const count = await this.storage.get<number>('count') ?? 0
 *     await this.storage.put('count', count + 1)
 *     return Response.json({ count: count + 1 })
 *   }
 * }
 *
 * // Later: save state to Iceberg
 * const snapshotId = await myService.save()
 *
 * // Restore to previous state
 * await myService.restore(snapshotId)
 * ```
 *
 * @see dotdo-l19j3 Stateless DO Base Class (TDD)
 * @module objects/StatelessDO
 */

// ============================================================================
// Types
// ============================================================================

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
 * SQL storage interface (matches Cloudflare SqlStorage)
 */
interface SqlStorageLike {
  exec(query: string, ...params: unknown[]): SqlResult
}

interface SqlResult {
  toArray(): unknown[]
}

/**
 * DurableObjectStorage interface for compatibility
 */
interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  sql: SqlStorageLike
}

/**
 * DurableObjectId interface
 */
interface DurableObjectIdLike {
  toString(): string
  equals(other: DurableObjectIdLike): boolean
}

/**
 * DurableObjectState interface for compatibility
 */
interface DurableObjectStateLike {
  id: DurableObjectIdLike
  storage: DurableObjectStorageLike
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Environment with R2 bucket for Iceberg storage
 */
interface StatelessDOEnv {
  R2?: R2BucketLike
}

/**
 * Snapshot info returned by snapshots()
 */
export interface Snapshot {
  id: string
  timestamp: Date
  parentId: string | null
}

/**
 * Iceberg manifest structure
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
  summary?: { message?: string }
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

interface TableInfo {
  name: string
  sql: string
}

// ============================================================================
// StatelessDO Implementation
// ============================================================================

/**
 * StatelessDO - Base class for stateless Durable Objects
 *
 * This class provides:
 * - Compatible DurableObject interface (fetch, storage)
 * - Iceberg persistence (save, restore, clone, snapshots)
 * - Lifecycle hooks (onStart, onStop)
 */
export abstract class StatelessDO<E extends StatelessDOEnv = StatelessDOEnv> {
  protected readonly state: DurableObjectStateLike
  protected readonly env: E

  // Storage access for subclasses
  protected readonly storage: DurableObjectStorageLike

  // Iceberg state
  private _lastSnapshotId: string | null = null
  private _tableUuid: string
  private _sequenceNumber = 0
  private _snapshotHistory: SnapshotEntry[] = []
  private _lastColumnId = 0
  private _started = false

  constructor(state: DurableObjectStateLike, env: E) {
    this.state = state
    this.env = env
    this.storage = state.storage
    this._tableUuid = this.generateUUID()
  }

  // ============================================================================
  // DurableObject Interface
  // ============================================================================

  /**
   * Handle incoming HTTP requests.
   * Subclasses should override this method.
   */
  async fetch(request: Request): Promise<Response> {
    // Call onStart on first request
    if (!this._started) {
      this._started = true
      if (this.onStart) {
        await this.onStart()
      }
    }

    return this.handleFetch(request)
  }

  /**
   * Override in subclasses to handle requests.
   * Default implementation returns 404.
   */
  protected async handleFetch(_request: Request): Promise<Response> {
    return new Response('Not Found', { status: 404 })
  }

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  /**
   * Called once when the first request arrives.
   * Override in subclasses for initialization.
   */
  protected onStart?(): Promise<void>

  /**
   * Called when the DO is about to be evicted.
   * Override in subclasses for cleanup.
   */
  protected onStop?(): Promise<void>

  // ============================================================================
  // Iceberg Snapshot Operations
  // ============================================================================

  /**
   * Create an Iceberg snapshot of current state
   *
   * @param message - Optional message to include in snapshot metadata
   * @returns Snapshot ID (UUID string)
   */
  async save(message?: string): Promise<string> {
    const bucket = this.env.R2
    if (!bucket) {
      throw new Error('R2 bucket not configured')
    }

    const doId = this.state.id.toString()
    const snapshotId = this.generateUUID()
    const timestamp = Date.now()
    this._sequenceNumber++

    // 1. Get all user tables from sqlite_master
    const tables = this.getUserTables()

    // 2. Build manifest entries and write Parquet files
    const manifestEntries: ManifestEntry[] = []
    const schemas: SchemaEntry[] = []

    for (const table of tables) {
      // Get table rows
      const rows = this.getTableRows(table.name)

      // Parse schema from CREATE TABLE statement
      const schemaEntry = this.parseSchema(table.sql, schemas.length)
      schemas.push(schemaEntry)

      // Update lastColumnId
      const maxFieldId = Math.max(0, ...schemaEntry.fields.map((f) => f.id))
      if (maxFieldId > this._lastColumnId) {
        this._lastColumnId = maxFieldId
      }

      // Serialize to Parquet (simplified: JSON-based for compatibility)
      const parquetData = this.serializeToParquet(rows)

      // Write Parquet file to R2
      const parquetKey = `do/${doId}/data/${table.name}/${snapshotId}.parquet`
      await bucket.put(parquetKey, parquetData)

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

    // 3. Create snapshot entry
    const snapshotEntry: SnapshotEntry = {
      'snapshot-id': snapshotId,
      'parent-snapshot-id': this._lastSnapshotId,
      'timestamp-ms': timestamp,
      'manifest-list': `do/${doId}/metadata/${snapshotId}-manifest-list.avro`,
      summary: {
        operation: 'append',
        'added-data-files': String(manifestEntries.length),
        'added-records': String(manifestEntries.reduce((sum, m) => sum + m['added-rows-count'], 0)),
        ...(message ? { message } : {}),
      },
    }

    // Add to history
    this._snapshotHistory.push(snapshotEntry)

    // 4. Create Iceberg manifest
    const manifest: IcebergManifest = {
      'format-version': 2,
      'table-uuid': this._tableUuid,
      location: `do/${doId}`,
      'last-updated-ms': timestamp,
      'last-column-id': this._lastColumnId,
      'current-snapshot-id': snapshotId,
      'parent-snapshot-id': this._lastSnapshotId,
      snapshots: [...this._snapshotHistory],
      schemas,
      manifests: manifestEntries,
      summary: message ? { message } : undefined,
    }

    // 5. Write manifest to R2
    const manifestKey = `do/${doId}/metadata/${snapshotId}.json`
    await bucket.put(manifestKey, JSON.stringify(manifest, null, 2))

    // 6. Update last snapshot ID for next call
    this._lastSnapshotId = snapshotId

    return snapshotId
  }

  /**
   * Restore state from an Iceberg snapshot
   *
   * @param snapshotId - The snapshot ID to restore from
   * @throws Error if snapshot not found
   */
  async restore(snapshotId: string): Promise<void> {
    const bucket = this.env.R2
    if (!bucket) {
      throw new Error('R2 bucket not configured')
    }

    const doId = this.state.id.toString()

    // 1. Get manifest from R2
    const manifestKey = `do/${doId}/metadata/${snapshotId}.json`
    const manifestObj = await bucket.get(manifestKey)

    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }

    const manifest = (await manifestObj.json()) as IcebergManifest

    // 2. Clear existing tables
    await this.clearExistingTables()

    // 3. Restore each table from manifest
    for (const entry of manifest.manifests) {
      // Create table structure
      this.storage.sql.exec(entry.schema)

      // Load data from Parquet
      const parquetObj = await bucket.get(entry['manifest-path'])
      if (!parquetObj) {
        throw new Error(`Parquet file not found: ${entry['manifest-path']}`)
      }

      const buffer = await parquetObj.arrayBuffer()
      const rows = this.deserializeFromParquet(buffer)

      // Insert rows
      for (const row of rows) {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map((_, i) => `'${values[i]}'`).join(', ')

        this.storage.sql.exec(`INSERT INTO ${entry.table} (${columns.join(', ')}) VALUES (${placeholders})`)
      }
    }

    // Update internal state
    this._lastSnapshotId = snapshotId
  }

  /**
   * Clone current state to a new DO ID
   *
   * @param newDoId - The new DO ID to clone to
   */
  async clone(newDoId: string): Promise<void> {
    const bucket = this.env.R2
    if (!bucket) {
      throw new Error('R2 bucket not configured')
    }

    const sourceDoId = this.state.id.toString()
    const snapshotId = this.generateUUID()
    const timestamp = Date.now()

    // 1. Get all user tables
    const tables = this.getUserTables()

    // 2. Write Parquet files for new DO
    const manifestEntries: ManifestEntry[] = []
    const schemas: SchemaEntry[] = []

    for (const table of tables) {
      const rows = this.getTableRows(table.name)
      const schemaEntry = this.parseSchema(table.sql, schemas.length)
      schemas.push(schemaEntry)

      const parquetData = this.serializeToParquet(rows)
      const parquetKey = `do/${newDoId}/data/${table.name}/${snapshotId}.parquet`
      await bucket.put(parquetKey, parquetData)

      manifestEntries.push({
        'manifest-path': parquetKey,
        'manifest-length': parquetData.byteLength,
        'partition-spec-id': 0,
        content: 0,
        'sequence-number': 1,
        'added-files-count': 1,
        'existing-files-count': 0,
        'deleted-files-count': 0,
        'added-rows-count': rows.length,
        table: table.name,
        schema: table.sql,
      })
    }

    // 3. Create manifest for new DO
    const manifest: IcebergManifest = {
      'format-version': 2,
      'table-uuid': this.generateUUID(),
      location: `do/${newDoId}`,
      'last-updated-ms': timestamp,
      'last-column-id': this._lastColumnId,
      'current-snapshot-id': snapshotId,
      'parent-snapshot-id': null, // Clone starts fresh
      snapshots: [
        {
          'snapshot-id': snapshotId,
          'parent-snapshot-id': null,
          'timestamp-ms': timestamp,
          'manifest-list': `do/${newDoId}/metadata/${snapshotId}-manifest-list.avro`,
          summary: {
            operation: 'append',
            'cloned-from': sourceDoId,
          },
        },
      ],
      schemas,
      manifests: manifestEntries,
    }

    // 4. Write manifest to R2
    const manifestKey = `do/${newDoId}/metadata/${snapshotId}.json`
    await bucket.put(manifestKey, JSON.stringify(manifest, null, 2))
  }

  /**
   * List all available snapshots for this DO
   *
   * @returns Array of snapshot info sorted by timestamp descending
   */
  async snapshots(): Promise<Snapshot[]> {
    const bucket = this.env.R2
    if (!bucket) {
      return []
    }

    const doId = this.state.id.toString()
    const prefix = `do/${doId}/metadata/`
    const list = await bucket.list({ prefix })

    const snapshotList: Snapshot[] = []

    for (const obj of list.objects) {
      // Skip non-JSON files
      if (!obj.key.endsWith('.json')) continue

      try {
        const manifestObj = await bucket.get(obj.key)
        if (!manifestObj) continue

        const manifest = (await manifestObj.json()) as IcebergManifest

        snapshotList.push({
          id: manifest['current-snapshot-id'] || obj.key.split('/').pop()?.replace('.json', '') || '',
          timestamp: new Date(manifest['last-updated-ms']),
          parentId: manifest['parent-snapshot-id'],
        })
      } catch {
        // Skip corrupt manifests
        continue
      }
    }

    // Sort by timestamp descending (most recent first)
    return snapshotList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get all user tables from sqlite_master
   */
  private getUserTables(): TableInfo[] {
    const result = this.storage.sql.exec(
      `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    )
    const rawTables = result.toArray() as TableInfo[]

    // Filter out internal tables
    return rawTables.filter((t) => t.name && t.sql && !t.name.startsWith('sqlite_') && t.name !== 'kv')
  }

  /**
   * Get all rows from a table
   */
  private getTableRows(tableName: string): Record<string, unknown>[] {
    const result = this.storage.sql.exec(`SELECT * FROM ${tableName}`)
    return result.toArray() as Record<string, unknown>[]
  }

  /**
   * Parse CREATE TABLE statement into Iceberg schema
   */
  private parseSchema(createTableSql: string, schemaId: number): SchemaEntry {
    const fields: SchemaField[] = []

    const match = createTableSql.match(/\(([^)]+)\)/i)
    if (match && match[1]) {
      const columnDefs = match[1].split(',').map((s) => s.trim())

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

  /**
   * Convert SQL type to Iceberg type
   */
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

  /**
   * Serialize rows to Parquet format (simplified JSON for compatibility)
   */
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

  /**
   * Deserialize rows from Parquet format
   */
  private deserializeFromParquet(buffer: ArrayBuffer): Record<string, unknown>[] {
    const view = new Uint8Array(buffer)
    const MAGIC_SIZE = 4

    // Skip header magic and footer magic
    const jsonBytes = view.slice(MAGIC_SIZE, view.length - MAGIC_SIZE)
    const jsonData = new TextDecoder().decode(jsonBytes)

    try {
      return JSON.parse(jsonData)
    } catch {
      return []
    }
  }

  /**
   * Clear all existing user tables
   */
  private async clearExistingTables(): Promise<void> {
    const result = this.storage.sql.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)

    for (const row of result.toArray() as Array<{ name: string }>) {
      this.storage.sql.exec(`DROP TABLE IF EXISTS ${row.name}`)
    }
  }

  /**
   * Generate a UUID v4
   */
  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

export default StatelessDO
