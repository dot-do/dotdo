/**
 * IcebergCatalog - Catalog Interface for Cross-DO Analytics
 *
 * Provides a catalog interface that enables DuckDB to query Iceberg tables
 * stored in R2. This bridges DO state management with analytics queries.
 *
 * Features:
 * - List all DOs with persisted state
 * - Enumerate tables within each DO
 * - Build DuckDB-compatible queries
 * - Support time-travel via snapshot IDs
 * - Cross-DO aggregation queries
 *
 * @module db/do-analytics/iceberg-catalog
 */

import type { R2Bucket } from '@cloudflare/workers-types'

// =============================================================================
// Types
// =============================================================================

/**
 * R2 bucket interface for catalog operations
 */
interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string; delimiter?: string }): Promise<{
    objects: { key: string }[]
    truncated: boolean
    delimitedPrefixes?: string[]
  }>
}

/**
 * R2 object interface for reading metadata
 */
interface R2ObjectLike {
  json<T>(): Promise<T>
  text(): Promise<string>
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
  manifests: ManifestFileEntry[]
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

interface ManifestFileEntry {
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

interface CurrentSnapshot {
  current_snapshot_id: string
}

/**
 * Information about a Durable Object with persisted state
 */
export interface DOInfo {
  /** DO identifier */
  id: string
  /** Current snapshot ID */
  currentSnapshotId: string
  /** Last update timestamp in milliseconds */
  lastUpdatedMs: number
}

/**
 * Column information for a table
 */
export interface ColumnInfo {
  /** Column name */
  name: string
  /** Iceberg type (long, string, double, etc.) */
  type: string
  /** Whether column is required (NOT NULL) */
  required: boolean
}

/**
 * Information about a table within a DO
 */
export interface TableInfo {
  /** Table name */
  name: string
  /** Approximate row count */
  rowCount: number
  /** Column definitions */
  columns: ColumnInfo[]
  /** Parquet file paths */
  paths: string[]
}

/**
 * Snapshot information for time travel
 */
export interface SnapshotInfo {
  /** Snapshot ID */
  id: string
  /** Parent snapshot ID (null for first snapshot) */
  parentId: string | null
  /** Creation timestamp */
  timestamp: Date
}

/**
 * Cross-DO query information
 */
export interface CrossDoQueryInfo {
  /** All Parquet file paths */
  paths: string[]
  /** Whether do_id column is included */
  includesDoId: boolean
  /** DO IDs included in the query */
  doIds: string[]
}

/**
 * Options for time travel queries
 */
export interface TimeTravel {
  /** Specific snapshot ID to query */
  snapshotId?: string
}

/**
 * Aggregation query options
 */
export interface AggregationOptions {
  /** SELECT clause columns/expressions */
  select: string[]
  /** WHERE clause (optional) */
  where?: string
  /** GROUP BY columns */
  groupBy?: string[]
  /** ORDER BY columns (optional) */
  orderBy?: string[]
  /** LIMIT (optional) */
  limit?: number
}

// =============================================================================
// IcebergCatalog Implementation
// =============================================================================

/**
 * IcebergCatalog provides catalog-level access to DO state stored in Iceberg format.
 *
 * This class enables analytics queries across multiple DOs by:
 * - Discovering all DOs with persisted state
 * - Enumerating tables within each DO
 * - Building DuckDB-compatible Parquet scan queries
 * - Supporting time travel to historical snapshots
 *
 * @example List all DOs and their tables
 * ```typescript
 * const catalog = new IcebergCatalog(bucket)
 *
 * // List all DOs
 * const dos = await catalog.listDOs()
 * console.log(`Found ${dos.length} DOs with state`)
 *
 * // List tables in a specific DO
 * const tables = await catalog.listTables('payments-do')
 * for (const table of tables) {
 *   console.log(`${table.name}: ${table.rowCount} rows`)
 * }
 * ```
 *
 * @example Cross-DO analytics query
 * ```typescript
 * // Build query across all DOs
 * const sql = await catalog.buildCrossDoQuery('orders')
 * // Returns: SELECT *, 'do-1' AS do_id FROM read_parquet(...) UNION ALL ...
 *
 * // Execute with DuckDB
 * const result = await duckdb.all(sql)
 * ```
 *
 * @example Time travel query
 * ```typescript
 * // Query historical state
 * const tables = await catalog.listTables('payments-do', { snapshotId: 'snap-v42' })
 * ```
 */
export class IcebergCatalog {
  private readonly bucket: R2BucketLike

  constructor(bucket: R2Bucket) {
    this.bucket = bucket as unknown as R2BucketLike
  }

  // ===========================================================================
  // DO Discovery
  // ===========================================================================

  /**
   * List all Durable Objects with persisted state in R2.
   *
   * Scans the `do/` prefix for directories containing `current.json` which
   * indicates a valid DO with at least one snapshot.
   *
   * @returns Array of DO information objects
   */
  async listDOs(): Promise<DOInfo[]> {
    const dos: DOInfo[] = []

    // List all objects under do/ prefix with delimiter to get directories
    const listResult = await this.bucket.list({ prefix: 'do/', delimiter: '/' })

    // Get unique DO prefixes from delimited results
    const doPrefixes = listResult.delimitedPrefixes || []

    for (const prefix of doPrefixes) {
      // Extract DO ID from prefix (e.g., "do/payments-do/" -> "payments-do")
      const doId = prefix.replace(/^do\//, '').replace(/\/$/, '')
      if (!doId) continue

      try {
        // Check for current.json
        const currentObj = await this.bucket.get(`do/${doId}/metadata/current.json`)
        if (!currentObj) continue

        const current = await currentObj.json<CurrentSnapshot>()

        // Load manifest to get last updated time
        const manifestObj = await this.bucket.get(`do/${doId}/metadata/${current.current_snapshot_id}.json`)
        if (!manifestObj) continue

        const manifest = await manifestObj.json<IcebergManifest>()

        dos.push({
          id: doId,
          currentSnapshotId: current.current_snapshot_id,
          lastUpdatedMs: manifest['last-updated-ms'],
        })
      } catch {
        // Skip DOs with invalid state
        continue
      }
    }

    return dos
  }

  // ===========================================================================
  // Table Discovery
  // ===========================================================================

  /**
   * List all tables in a Durable Object's state.
   *
   * @param doId - DO identifier
   * @param options - Time travel options
   * @returns Array of table information
   * @throws Error if DO not found or snapshot not found
   */
  async listTables(doId: string, options?: TimeTravel): Promise<TableInfo[]> {
    const manifest = await this.loadManifest(doId, options?.snapshotId)

    // Group manifests by table name
    const tableMap = new Map<string, { entries: ManifestFileEntry[]; schema: SchemaEntry | undefined }>()

    for (const entry of manifest.manifests) {
      const existing = tableMap.get(entry.table)
      if (existing) {
        existing.entries.push(entry)
      } else {
        // Find matching schema
        const schemaIndex = manifest.manifests.findIndex((m) => m.table === entry.table)
        const schema = manifest.schemas[schemaIndex]

        tableMap.set(entry.table, {
          entries: [entry],
          schema,
        })
      }
    }

    // Build table info
    const tables: TableInfo[] = []
    for (const [name, { entries, schema }] of tableMap) {
      const rowCount = entries.reduce((sum, e) => sum + e['added-rows-count'], 0)
      const paths = entries.map((e) => e['manifest-path'])

      // Parse columns from schema or manifest entry
      let columns: ColumnInfo[] = []
      if (schema) {
        columns = schema.fields.map((f) => ({
          name: f.name,
          type: f.type,
          required: f.required,
        }))
      } else if (entries[0]) {
        // Fallback: parse from CREATE TABLE in manifest
        columns = this.parseColumnsFromSql(entries[0].schema)
      }

      tables.push({
        name,
        rowCount,
        columns,
        paths,
      })
    }

    return tables
  }

  /**
   * Get Parquet file paths for a specific table.
   *
   * @param doId - DO identifier
   * @param tableName - Table name
   * @param options - Time travel options
   * @returns Array of Parquet file paths
   * @throws Error if table not found
   */
  async getTablePaths(doId: string, tableName: string, options?: TimeTravel): Promise<string[]> {
    const manifest = await this.loadManifest(doId, options?.snapshotId)

    const entries = manifest.manifests.filter((m) => m.table === tableName)
    if (entries.length === 0) {
      throw new Error(`Table not found: ${tableName}`)
    }

    return entries.map((e) => e['manifest-path'])
  }

  /**
   * List all snapshots for a DO (for time travel).
   *
   * @param doId - DO identifier
   * @returns Array of snapshot info, sorted by timestamp descending
   */
  async listSnapshots(doId: string): Promise<SnapshotInfo[]> {
    // List all snapshot files in metadata
    const listResult = await this.bucket.list({ prefix: `do/${doId}/metadata/` })

    const snapshots: SnapshotInfo[] = []

    for (const obj of listResult.objects) {
      // Skip non-snapshot files
      if (!obj.key.endsWith('.json')) continue
      if (obj.key.includes('current')) continue

      try {
        const manifestObj = await this.bucket.get(obj.key)
        if (!manifestObj) continue

        const manifest = await manifestObj.json<IcebergManifest>()

        snapshots.push({
          id: manifest['current-snapshot-id'] || '',
          parentId: manifest['parent-snapshot-id'],
          timestamp: new Date(manifest['last-updated-ms']),
        })
      } catch {
        continue
      }
    }

    // Sort by timestamp descending (most recent first)
    return snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  // ===========================================================================
  // Cross-DO Queries
  // ===========================================================================

  /**
   * Get query information for cross-DO table access.
   *
   * @param tableName - Table name to query across all DOs
   * @returns Cross-DO query information
   */
  async getCrossDoQuery(tableName: string): Promise<CrossDoQueryInfo> {
    const dos = await this.listDOs()
    const paths: string[] = []
    const doIds: string[] = []

    for (const doInfo of dos) {
      try {
        const tablePaths = await this.getTablePaths(doInfo.id, tableName)
        paths.push(...tablePaths)
        doIds.push(doInfo.id)
      } catch {
        // DO doesn't have this table, skip
        continue
      }
    }

    return {
      paths,
      includesDoId: true,
      doIds,
    }
  }

  // ===========================================================================
  // DuckDB Query Building
  // ===========================================================================

  /**
   * Build a DuckDB query for a single DO table.
   *
   * @param doId - DO identifier
   * @param tableName - Table name
   * @param options - Time travel options
   * @returns DuckDB SQL query string
   */
  async buildDuckDbQuery(doId: string, tableName: string, options?: TimeTravel): Promise<string> {
    const paths = await this.getTablePaths(doId, tableName, options)

    if (paths.length === 1) {
      return `SELECT * FROM read_parquet('${paths[0]}')`
    }

    // Multiple files - use list syntax
    const pathList = paths.map((p) => `'${p}'`).join(', ')
    return `SELECT * FROM read_parquet([${pathList}])`
  }

  /**
   * Build a DuckDB query for cross-DO table access.
   *
   * Generates UNION ALL queries with do_id column for source identification.
   *
   * @param tableName - Table name to query across all DOs
   * @returns DuckDB SQL query string
   */
  async buildCrossDoQuery(tableName: string): Promise<string> {
    const queryInfo = await this.getCrossDoQuery(tableName)

    if (queryInfo.paths.length === 0) {
      return `SELECT * FROM (SELECT 1 WHERE 1=0)` // Empty result
    }

    // Group paths by DO
    const dos = await this.listDOs()
    const doQueries: string[] = []

    for (const doInfo of dos) {
      try {
        const paths = await this.getTablePaths(doInfo.id, tableName)
        if (paths.length === 0) continue

        const pathExpr =
          paths.length === 1 ? `'${paths[0]}'` : `[${paths.map((p) => `'${p}'`).join(', ')}]`

        doQueries.push(`SELECT *, '${doInfo.id}' AS do_id FROM read_parquet(${pathExpr})`)
      } catch {
        continue
      }
    }

    if (doQueries.length === 0) {
      return `SELECT * FROM (SELECT 1 WHERE 1=0)` // Empty result
    }

    return doQueries.join('\nUNION ALL\n')
  }

  /**
   * Build an aggregation query across all DOs.
   *
   * @param tableName - Table name
   * @param options - Aggregation options
   * @returns DuckDB SQL query string
   */
  async buildAggregationQuery(tableName: string, options: AggregationOptions): Promise<string> {
    const baseQuery = await this.buildCrossDoQuery(tableName)

    let sql = `SELECT ${options.select.join(', ')}\nFROM (\n${baseQuery}\n) AS combined`

    if (options.where) {
      sql += `\nWHERE ${options.where}`
    }

    if (options.groupBy && options.groupBy.length > 0) {
      sql += `\nGROUP BY ${options.groupBy.join(', ')}`
    }

    if (options.orderBy && options.orderBy.length > 0) {
      sql += `\nORDER BY ${options.orderBy.join(', ')}`
    }

    if (options.limit !== undefined) {
      sql += `\nLIMIT ${options.limit}`
    }

    return sql
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Load manifest for a DO, optionally at a specific snapshot.
   */
  private async loadManifest(doId: string, snapshotId?: string): Promise<IcebergManifest> {
    let targetSnapshotId = snapshotId

    // Get current snapshot if not specified
    if (!targetSnapshotId) {
      const currentObj = await this.bucket.get(`do/${doId}/metadata/current.json`)
      if (!currentObj) {
        throw new Error(`DO not found: ${doId}`)
      }
      const current = await currentObj.json<CurrentSnapshot>()
      targetSnapshotId = current.current_snapshot_id
    }

    // Load manifest
    const manifestObj = await this.bucket.get(`do/${doId}/metadata/${targetSnapshotId}.json`)
    if (!manifestObj) {
      throw new Error(`Snapshot not found: ${targetSnapshotId}`)
    }

    return manifestObj.json<IcebergManifest>()
  }

  /**
   * Parse columns from CREATE TABLE SQL statement.
   */
  private parseColumnsFromSql(createSql: string): ColumnInfo[] {
    const match = createSql.match(/\(([^)]+)\)/i)
    if (!match) return []

    const columns = match[1].split(',').map((c) => c.trim())
    return columns.map((col) => {
      const parts = col.split(/\s+/)
      const name = parts[0]
      const sqlType = parts[1] || 'TEXT'
      const isRequired = col.toUpperCase().includes('NOT NULL') || col.toUpperCase().includes('PRIMARY KEY')

      return {
        name,
        type: this.mapSqlTypeToIceberg(sqlType),
        required: isRequired,
      }
    })
  }

  /**
   * Map SQL type to Iceberg type.
   */
  private mapSqlTypeToIceberg(sqlType: string): string {
    const upper = sqlType.toUpperCase()
    if (upper.includes('INT')) return 'long'
    if (upper.includes('TEXT') || upper.includes('VARCHAR')) return 'string'
    if (upper.includes('REAL') || upper.includes('FLOAT') || upper.includes('DOUBLE')) return 'double'
    if (upper.includes('BOOL')) return 'boolean'
    if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) return 'decimal'
    if (upper.includes('DATE')) return 'date'
    if (upper.includes('TIME')) return 'timestamp'
    if (upper.includes('BLOB')) return 'binary'
    return 'string'
  }
}
