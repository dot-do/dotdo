/**
 * Cross-DO Query Layer
 *
 * Enables DuckDB-style queries across all Durable Object states stored in Iceberg.
 * This provides analytics, debugging, and administrative capabilities across the DO fleet.
 *
 * Features:
 * - Query single DO state by ID
 * - Query across all DOs (wildcard)
 * - Filter with WHERE predicates
 * - Aggregations (COUNT, SUM, AVG, MIN, MAX)
 * - GROUP BY with HAVING
 * - Time-travel queries to historical snapshots
 * - Schema inference and drift detection
 *
 * @module db/do-analytics/cross-do-query
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * R2 bucket interface
 */
interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[]; truncated: boolean }>
  delete(key: string): Promise<void>
}

interface R2ObjectLike {
  key: string
  text(): Promise<string>
  json<T>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Query result from CrossDOQuery
 */
interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  columns: Array<{ name: string; type: string }>
  stats: {
    dosScanned: number
    filesScanned: number
    bytesScanned: number
    executionTimeMs: number
  }
}

/**
 * Query options for cross-DO queries
 */
interface CrossDOQueryOptions {
  doId?: string
  table: string
  where?: Record<string, unknown>
  columns?: string[]
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
  limit?: number
  snapshotId?: string
}

/**
 * Aggregation options
 */
interface AggregationOptions {
  doId?: string
  table: string
  groupBy?: string[]
  aggregations: Array<{
    function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
    column?: string
    alias: string
  }>
  where?: Record<string, unknown>
  having?: Record<string, unknown>
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
  limit?: number
}

/**
 * Aggregation result
 */
interface AggregationResult<T = Record<string, unknown>> {
  rows: T[]
  columns: Array<{ name: string; type: string }>
  stats: {
    dosScanned: number
    filesScanned: number
    bytesScanned: number
    executionTimeMs: number
  }
}

/**
 * Table info
 */
interface TableInfo {
  name: string
  doCount: number
  totalRows: number
  lastUpdated: Date
}

/**
 * Column info
 */
interface ColumnInfo {
  name: string
  type: string
  required: boolean
  nullable: boolean
  defaultValue?: unknown
}

/**
 * Table schema
 */
interface TableSchema {
  tableName: string
  columns: ColumnInfo[]
  primaryKey?: string[]
  doCount: number
  variants: SchemaVariant[]
}

/**
 * Schema variant
 */
interface SchemaVariant {
  columns: ColumnInfo[]
  doIds: string[]
  percentage: number
}

/**
 * Schema drift result
 */
interface SchemaDrift {
  tableName: string
  hasDrift: boolean
  baseSchema: ColumnInfo[]
  variants: Array<{
    doId: string
    differences: Array<{
      type: 'missing_column' | 'extra_column' | 'type_mismatch' | 'nullability_change'
      column: string
      expected?: string
      actual?: string
    }>
  }>
}

/**
 * Schema comparison result
 */
interface SchemaComparison {
  onlyInFirst: ColumnInfo[]
  onlyInSecond: ColumnInfo[]
  inBoth: ColumnInfo[]
}

/**
 * Inferred column type
 */
interface InferredColumnType {
  name: string
  inferredType: string
  schemaType: string
  samples: number
}

/**
 * Iceberg manifest structure
 */
interface IcebergManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'current-snapshot-id': string
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
  'added-rows-count': number
  table: string
  schema: string
}

interface CurrentPointer {
  currentSnapshotId: string
}

// =============================================================================
// CrossDOQuery Class
// =============================================================================

/**
 * CrossDOQuery - Query across all Durable Object states stored in Iceberg
 *
 * @example
 * ```typescript
 * const query = new CrossDOQuery(bucket)
 *
 * // Query single DO
 * const result = await query.execute({
 *   doId: 'do-123',
 *   table: 'orders'
 * })
 *
 * // Query all DOs
 * const allOrders = await query.execute({ table: 'orders' })
 *
 * // Aggregate across all DOs
 * const totals = await query.aggregate({
 *   table: 'orders',
 *   aggregations: [{ function: 'SUM', column: 'amount', alias: 'total' }]
 * })
 * ```
 */
export class CrossDOQuery {
  private _bucket: R2BucketLike

  constructor(bucket: R2BucketLike) {
    this._bucket = bucket
  }

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  /**
   * Execute a query against DO state
   */
  async execute<T = Record<string, unknown>>(options: CrossDOQueryOptions): Promise<QueryResult<T>> {
    const startTime = Date.now()
    const stats = {
      dosScanned: 0,
      filesScanned: 0,
      bytesScanned: 0,
      executionTimeMs: 0
    }

    let rows: Record<string, unknown>[] = []
    let columns: Array<{ name: string; type: string }> = []

    if (options.doId) {
      // Query single DO
      const result = await this._querySingleDO(options.doId, options.table, options.snapshotId)
      rows = result.rows
      columns = result.columns
      stats.dosScanned = 1
      stats.filesScanned = result.filesScanned
      stats.bytesScanned = result.bytesScanned
    } else {
      // Query all DOs
      const doIds = await this._listAllDOs()
      const allResults: Record<string, unknown>[] = []
      const columnSet = new Map<string, string>()

      for (const doId of doIds) {
        try {
          const result = await this._querySingleDO(doId, options.table)

          // Add _do_id to each row
          for (const row of result.rows) {
            allResults.push({ ...row, _do_id: doId })
          }

          // Merge columns
          for (const col of result.columns) {
            columnSet.set(col.name, col.type)
          }

          stats.dosScanned++
          stats.filesScanned += result.filesScanned
          stats.bytesScanned += result.bytesScanned
        } catch (error) {
          // Skip DOs that don't have the table
          continue
        }
      }

      rows = allResults
      columns = [
        { name: '_do_id', type: 'string' },
        ...Array.from(columnSet.entries()).map(([name, type]) => ({ name, type }))
      ]
    }

    // Apply WHERE filter
    if (options.where) {
      rows = this._applyWhere(rows, options.where)
    }

    // Apply column projection
    if (options.columns) {
      rows = rows.map(row => {
        const projected: Record<string, unknown> = {}
        for (const col of options.columns!) {
          if (col in row) {
            projected[col] = row[col]
          }
        }
        return projected
      })
      columns = columns.filter(c => options.columns!.includes(c.name))
    }

    // Apply ORDER BY
    if (options.orderBy) {
      rows = this._applyOrderBy(rows, options.orderBy)
    }

    // Apply LIMIT
    if (options.limit) {
      rows = rows.slice(0, options.limit)
    }

    stats.executionTimeMs = Date.now() - startTime

    return {
      rows: rows as T[],
      columns,
      stats
    }
  }

  /**
   * Execute raw SQL query
   */
  async sql<T = Record<string, unknown>>(
    sqlQuery: string,
    options?: { doId?: string }
  ): Promise<QueryResult<T>> {
    // Simple SQL parser for basic queries
    const selectMatch = sqlQuery.match(/SELECT\s+(.+)\s+FROM\s+(\w+)/i)
    if (!selectMatch) {
      throw new Error('Invalid SQL query')
    }

    const columns = selectMatch[1].trim()
    const table = selectMatch[2]

    // Parse WHERE clause
    const whereMatch = sqlQuery.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/i)
    const where: Record<string, unknown> = {}

    if (whereMatch) {
      // Simple WHERE parser for common patterns
      const conditions = whereMatch[1].trim()
      const condMatch = conditions.match(/(\w+)\s*(>|<|>=|<=|=|!=)\s*(\d+(?:\.\d+)?|'[^']*')/i)
      if (condMatch) {
        const col = condMatch[1]
        const op = condMatch[2]
        let val: unknown = condMatch[3]

        // Parse value
        if (val.startsWith("'")) {
          val = val.slice(1, -1)
        } else {
          val = parseFloat(val as string)
        }

        // Convert operator
        switch (op) {
          case '>':
            where[col] = { $gt: val }
            break
          case '>=':
            where[col] = { $gte: val }
            break
          case '<':
            where[col] = { $lt: val }
            break
          case '<=':
            where[col] = { $lte: val }
            break
          case '=':
            where[col] = val
            break
          case '!=':
            where[col] = { $ne: val }
            break
        }
      }
    }

    // Check for aggregations
    if (columns.toUpperCase().includes('SUM(') || columns.toUpperCase().includes('COUNT(')) {
      return this._executeAggregateSQL(sqlQuery, table, options?.doId) as Promise<QueryResult<T>>
    }

    return this.execute({
      doId: options?.doId,
      table,
      where: Object.keys(where).length > 0 ? where : undefined
    })
  }

  // ===========================================================================
  // Aggregations
  // ===========================================================================

  /**
   * Execute an aggregation query
   */
  async aggregate<T = Record<string, unknown>>(options: AggregationOptions): Promise<AggregationResult<T>> {
    const startTime = Date.now()
    const stats = {
      dosScanned: 0,
      filesScanned: 0,
      bytesScanned: 0,
      executionTimeMs: 0
    }

    // Get all rows first
    const queryResult = await this.execute({
      doId: options.doId,
      table: options.table,
      where: options.where
    })

    stats.dosScanned = queryResult.stats.dosScanned
    stats.filesScanned = queryResult.stats.filesScanned
    stats.bytesScanned = queryResult.stats.bytesScanned

    let rows = queryResult.rows as Record<string, unknown>[]

    // Group rows if GROUP BY specified
    let groups: Map<string, Record<string, unknown>[]>

    if (options.groupBy && options.groupBy.length > 0) {
      groups = new Map()
      for (const row of rows) {
        const key = options.groupBy.map(col => String(row[col])).join('|')
        const group = groups.get(key) || []
        group.push(row)
        groups.set(key, group)
      }
    } else {
      // Single group with all rows
      groups = new Map([['', rows]])
    }

    // Compute aggregations for each group
    const results: Record<string, unknown>[] = []

    for (const [key, groupRows] of groups) {
      const result: Record<string, unknown> = {}

      // Add group key columns
      if (options.groupBy && options.groupBy.length > 0 && groupRows.length > 0) {
        for (const col of options.groupBy) {
          result[col] = groupRows[0][col]
        }
      }

      // Compute each aggregation
      for (const agg of options.aggregations) {
        result[agg.alias] = this._computeAggregation(agg.function, agg.column, groupRows)
      }

      results.push(result)
    }

    // Apply HAVING filter
    let filteredResults = results
    if (options.having) {
      filteredResults = this._applyWhere(results, options.having)
    }

    // Apply ORDER BY
    if (options.orderBy) {
      filteredResults = this._applyOrderBy(filteredResults, options.orderBy)
    }

    // Apply LIMIT
    if (options.limit) {
      filteredResults = filteredResults.slice(0, options.limit)
    }

    // Build columns
    const columns: Array<{ name: string; type: string }> = []
    if (options.groupBy) {
      for (const col of options.groupBy) {
        columns.push({ name: col, type: 'string' })
      }
    }
    for (const agg of options.aggregations) {
      columns.push({ name: agg.alias, type: 'number' })
    }

    stats.executionTimeMs = Date.now() - startTime

    return {
      rows: filteredResults as T[],
      columns,
      stats
    }
  }

  // ===========================================================================
  // Schema Inference
  // ===========================================================================

  /**
   * List all unique tables across DOs
   */
  async listTables(): Promise<TableInfo[]> {
    const tableMap = new Map<string, { doCount: number; totalRows: number; lastUpdated: number }>()
    const doIds = await this._listAllDOs()

    for (const doId of doIds) {
      try {
        const manifest = await this._loadManifest(doId)

        for (const m of manifest.manifests) {
          const existing = tableMap.get(m.table) || { doCount: 0, totalRows: 0, lastUpdated: 0 }
          existing.doCount++
          existing.totalRows += m['added-rows-count']
          existing.lastUpdated = Math.max(existing.lastUpdated, manifest['last-updated-ms'])
          tableMap.set(m.table, existing)
        }
      } catch {
        continue
      }
    }

    return Array.from(tableMap.entries()).map(([name, info]) => ({
      name,
      doCount: info.doCount,
      totalRows: info.totalRows,
      lastUpdated: new Date(info.lastUpdated)
    }))
  }

  /**
   * Get schema for a specific table (unified across all DOs)
   */
  async getTableSchema(table: string): Promise<TableSchema> {
    const doIds = await this._listAllDOs()
    const schemaVariants = new Map<string, { columns: ColumnInfo[]; doIds: string[] }>()
    let doCount = 0

    for (const doId of doIds) {
      try {
        const manifest = await this._loadManifest(doId)
        const tableManifest = manifest.manifests.find(m => m.table === table)

        if (!tableManifest) continue

        doCount++

        const columns = this._parseSchemaToColumns(tableManifest.schema)
        const key = JSON.stringify(columns)

        const variant = schemaVariants.get(key) || { columns, doIds: [] }
        variant.doIds.push(doId)
        schemaVariants.set(key, variant)
      } catch {
        continue
      }
    }

    if (doCount === 0) {
      throw new Error(`Table '${table}' not found`)
    }

    // Build unified schema (union of all columns)
    const unifiedColumns = new Map<string, ColumnInfo>()
    const variants: SchemaVariant[] = []

    for (const [, variant] of schemaVariants) {
      for (const col of variant.columns) {
        if (!unifiedColumns.has(col.name)) {
          unifiedColumns.set(col.name, col)
        }
      }
      variants.push({
        columns: variant.columns,
        doIds: variant.doIds,
        percentage: (variant.doIds.length / doCount) * 100
      })
    }

    return {
      tableName: table,
      columns: Array.from(unifiedColumns.values()),
      doCount,
      variants
    }
  }

  /**
   * Get schema for a specific DO
   */
  async getDOSchema(doId: string): Promise<TableSchema[]> {
    try {
      const manifest = await this._loadManifest(doId)
      const schemas: TableSchema[] = []

      for (const m of manifest.manifests) {
        const columns = this._parseSchemaToColumns(m.schema)
        schemas.push({
          tableName: m.table,
          columns,
          doCount: 1,
          variants: [{ columns, doIds: [doId], percentage: 100 }]
        })
      }

      return schemas
    } catch {
      throw new Error(`DO '${doId}' not found`)
    }
  }

  /**
   * Detect schema drift across DOs for a table
   */
  async detectSchemaDrift(table: string): Promise<SchemaDrift> {
    const doIds = await this._listAllDOs()
    const schemaVariants = new Map<string, { columns: ColumnInfo[]; doIds: string[] }>()

    for (const doId of doIds) {
      try {
        const manifest = await this._loadManifest(doId)
        const tableManifest = manifest.manifests.find(m => m.table === table)

        if (!tableManifest) continue

        const columns = this._parseSchemaToColumns(tableManifest.schema)
        const key = JSON.stringify(columns)

        const variant = schemaVariants.get(key) || { columns, doIds: [] }
        variant.doIds.push(doId)
        schemaVariants.set(key, variant)
      } catch {
        continue
      }
    }

    if (schemaVariants.size === 0) {
      throw new Error(`Table '${table}' not found`)
    }

    // Find most common schema as base
    let baseSchema: ColumnInfo[] = []
    let maxCount = 0

    for (const variant of schemaVariants.values()) {
      if (variant.doIds.length > maxCount) {
        maxCount = variant.doIds.length
        baseSchema = variant.columns
      }
    }

    // Find differences
    const variants: SchemaDrift['variants'] = []
    const baseColumnMap = new Map(baseSchema.map(c => [c.name, c]))

    for (const variant of schemaVariants.values()) {
      if (JSON.stringify(variant.columns) === JSON.stringify(baseSchema)) continue

      const variantColumnMap = new Map(variant.columns.map(c => [c.name, c]))

      for (const doId of variant.doIds) {
        const differences: SchemaDrift['variants'][0]['differences'] = []

        // Check for missing columns
        for (const baseCol of baseSchema) {
          if (!variantColumnMap.has(baseCol.name)) {
            differences.push({
              type: 'missing_column',
              column: baseCol.name,
              expected: baseCol.type
            })
          } else {
            const variantCol = variantColumnMap.get(baseCol.name)!
            if (variantCol.type !== baseCol.type) {
              differences.push({
                type: 'type_mismatch',
                column: baseCol.name,
                expected: baseCol.type,
                actual: variantCol.type
              })
            }
            if (variantCol.required !== baseCol.required) {
              differences.push({
                type: 'nullability_change',
                column: baseCol.name,
                expected: baseCol.required ? 'NOT NULL' : 'NULL',
                actual: variantCol.required ? 'NOT NULL' : 'NULL'
              })
            }
          }
        }

        // Check for extra columns
        for (const variantCol of variant.columns) {
          if (!baseColumnMap.has(variantCol.name)) {
            differences.push({
              type: 'extra_column',
              column: variantCol.name,
              actual: variantCol.type
            })
          }
        }

        variants.push({ doId, differences })
      }
    }

    return {
      tableName: table,
      hasDrift: variants.length > 0,
      baseSchema,
      variants
    }
  }

  /**
   * List all DOs that have a specific table
   */
  async listDOsWithTable(table: string): Promise<string[]> {
    const doIds = await this._listAllDOs()
    const result: string[] = []

    for (const doId of doIds) {
      try {
        const manifest = await this._loadManifest(doId)
        if (manifest.manifests.some(m => m.table === table)) {
          result.push(doId)
        }
      } catch {
        continue
      }
    }

    return result
  }

  /**
   * Compare schemas between two DOs for a table
   */
  async compareSchemas(table: string, doId1: string, doId2: string): Promise<SchemaComparison> {
    const manifest1 = await this._loadManifest(doId1)
    const manifest2 = await this._loadManifest(doId2)

    const tableManifest1 = manifest1.manifests.find(m => m.table === table)
    const tableManifest2 = manifest2.manifests.find(m => m.table === table)

    if (!tableManifest1) {
      throw new Error(`${doId1} does not have table '${table}'`)
    }
    if (!tableManifest2) {
      throw new Error(`${doId2} does not have table '${table}' not found`)
    }

    const columns1 = this._parseSchemaToColumns(tableManifest1.schema)
    const columns2 = this._parseSchemaToColumns(tableManifest2.schema)

    const names1 = new Set(columns1.map(c => c.name))
    const names2 = new Set(columns2.map(c => c.name))

    return {
      onlyInFirst: columns1.filter(c => !names2.has(c.name)),
      onlyInSecond: columns2.filter(c => !names1.has(c.name)),
      inBoth: columns1.filter(c => names2.has(c.name))
    }
  }

  /**
   * Infer column types from actual data
   */
  async inferColumnTypes(
    table: string,
    options?: { doId?: string; sampleSize?: number }
  ): Promise<InferredColumnType[]> {
    const queryResult = await this.execute({
      doId: options?.doId,
      table,
      limit: options?.sampleSize || 100
    })

    const typeMap = new Map<string, { inferredType: string; samples: number }>()

    for (const row of queryResult.rows) {
      for (const [key, value] of Object.entries(row)) {
        const existing = typeMap.get(key) || { inferredType: 'unknown', samples: 0 }
        existing.samples++
        existing.inferredType = this._inferType(value)
        typeMap.set(key, existing)
      }
    }

    const schemaColumns = queryResult.columns

    return Array.from(typeMap.entries()).map(([name, info]) => ({
      name,
      inferredType: info.inferredType,
      schemaType: schemaColumns.find(c => c.name === name)?.type || 'unknown',
      samples: info.samples
    }))
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Query a single DO's state
   */
  private async _querySingleDO(
    doId: string,
    table: string,
    snapshotId?: string
  ): Promise<{ rows: Record<string, unknown>[]; columns: Array<{ name: string; type: string }>; filesScanned: number; bytesScanned: number }> {
    // Load manifest
    const manifest = await this._loadManifest(doId, snapshotId)

    // Find table in manifest
    const tableManifest = manifest.manifests.find(m => m.table === table)
    if (!tableManifest) {
      throw new Error(`Table '${table}' not found in DO '${doId}'`)
    }

    // Load Parquet data
    const parquetObj = await this._bucket.get(tableManifest['manifest-path'])
    if (!parquetObj) {
      throw new Error(`Parquet file not found: ${tableManifest['manifest-path']}`)
    }

    const buffer = await parquetObj.arrayBuffer()
    const rows = this._parseParquet(buffer)

    // Parse schema to columns
    const columns = this._parseSchemaToColumns(tableManifest.schema).map(c => ({
      name: c.name,
      type: c.type
    }))

    return {
      rows,
      columns,
      filesScanned: 1,
      bytesScanned: buffer.byteLength
    }
  }

  /**
   * Load manifest for a DO
   */
  private async _loadManifest(doId: string, snapshotId?: string): Promise<IcebergManifest> {
    // Get current snapshot ID if not specified
    if (!snapshotId) {
      const currentObj = await this._bucket.get(`do/${doId}/metadata/current.json`)
      if (!currentObj) {
        throw new Error(`DO '${doId}' not found`)
      }
      const current = await currentObj.json<CurrentPointer>()
      snapshotId = current.currentSnapshotId
    }

    // Load manifest
    const manifestObj = await this._bucket.get(`do/${doId}/metadata/${snapshotId}.json`)
    if (!manifestObj) {
      throw new Error(`Snapshot '${snapshotId}' not found`)
    }

    try {
      return await manifestObj.json<IcebergManifest>()
    } catch {
      throw new Error('Failed to parse manifest (corrupted)')
    }
  }

  /**
   * List all DO IDs
   */
  private async _listAllDOs(): Promise<string[]> {
    const result = await this._bucket.list({ prefix: 'do/' })
    const doIds = new Set<string>()

    for (const obj of result.objects) {
      // Extract DO ID from path like "do/do-123/metadata/..."
      const match = obj.key.match(/^do\/([^/]+)\//)
      if (match) {
        doIds.add(match[1])
      }
    }

    return Array.from(doIds)
  }

  /**
   * Parse Parquet data (simplified JSON-based format)
   */
  private _parseParquet(buffer: ArrayBuffer): Record<string, unknown>[] {
    const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31])
    const view = new Uint8Array(buffer)

    // Verify magic header
    if (view.length < 8) {
      throw new Error('Invalid Parquet file (too small)')
    }

    const headerMagic = view.slice(0, 4)
    if (!this._arrayEquals(headerMagic, PARQUET_MAGIC)) {
      throw new Error('Invalid Parquet file (bad header)')
    }

    // Extract JSON data between magic headers
    const jsonData = new TextDecoder().decode(view.slice(4, -4))

    try {
      return JSON.parse(jsonData)
    } catch {
      throw new Error('Failed to parse Parquet data (invalid JSON)')
    }
  }

  /**
   * Parse CREATE TABLE schema string to ColumnInfo[]
   */
  private _parseSchemaToColumns(schema: string): ColumnInfo[] {
    const match = schema.match(/\(([^)]+)\)/i)
    if (!match) return []

    return match[1].split(',').map(col => {
      const parts = col.trim().split(/\s+/)
      const name = parts[0]
      const type = this._mapSqlType(parts[1] || 'TEXT')
      const required = col.toUpperCase().includes('NOT NULL')

      return {
        name,
        type,
        required,
        nullable: !required
      }
    })
  }

  /**
   * Map SQL type to Iceberg type
   */
  private _mapSqlType(sqlType: string): string {
    const upper = sqlType.toUpperCase()
    if (upper.includes('INT')) return 'long'
    if (upper.includes('REAL') || upper.includes('FLOAT')) return 'double'
    if (upper.includes('DECIMAL')) return 'decimal'
    if (upper.includes('BOOL')) return 'boolean'
    if (upper.includes('DATE')) return 'date'
    if (upper.includes('TIME')) return 'timestamp'
    return 'string'
  }

  /**
   * Infer type from value
   */
  private _inferType(value: unknown): string {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'decimal'
    }
    if (typeof value === 'string') {
      // Check for date patterns
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'timestamp'
      return 'string'
    }
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object') return 'object'
    return 'unknown'
  }

  /**
   * Apply WHERE filter to rows
   */
  private _applyWhere(rows: Record<string, unknown>[], where: Record<string, unknown>): Record<string, unknown>[] {
    return rows.filter(row => {
      for (const [key, condition] of Object.entries(where)) {
        const value = row[key]

        if (typeof condition === 'object' && condition !== null) {
          const ops = condition as Record<string, unknown>
          if ('$gt' in ops && !(Number(value) > Number(ops.$gt))) return false
          if ('$gte' in ops && !(Number(value) >= Number(ops.$gte))) return false
          if ('$lt' in ops && !(Number(value) < Number(ops.$lt))) return false
          if ('$lte' in ops && !(Number(value) <= Number(ops.$lte))) return false
          if ('$ne' in ops && value === ops.$ne) return false
          if ('$in' in ops && !Array.isArray(ops.$in)) return false
          if ('$in' in ops && Array.isArray(ops.$in) && !ops.$in.includes(value)) return false
        } else {
          if (value !== condition) return false
        }
      }
      return true
    })
  }

  /**
   * Apply ORDER BY to rows
   */
  private _applyOrderBy(
    rows: Record<string, unknown>[],
    orderBy: Array<{ column: string; direction: 'asc' | 'desc' }>
  ): Record<string, unknown>[] {
    return [...rows].sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const aVal = a[column]
        const bVal = b[column]
        const cmp = this._compare(aVal, bVal)
        if (cmp !== 0) {
          return direction === 'asc' ? cmp : -cmp
        }
      }
      return 0
    })
  }

  /**
   * Compare two values
   */
  private _compare(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return -1
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    return 0
  }

  /**
   * Compute aggregation
   */
  private _computeAggregation(
    func: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    column: string | undefined,
    rows: Record<string, unknown>[]
  ): number | null {
    if (rows.length === 0) {
      return func === 'COUNT' ? 0 : null
    }

    switch (func) {
      case 'COUNT':
        if (column) {
          return rows.filter(r => r[column] !== null && r[column] !== undefined).length
        }
        return rows.length

      case 'SUM': {
        const values = rows.map(r => Number(r[column!])).filter(v => !isNaN(v))
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
      }

      case 'AVG': {
        const values = rows.map(r => Number(r[column!])).filter(v => !isNaN(v))
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
      }

      case 'MIN': {
        const values = rows.map(r => Number(r[column!])).filter(v => !isNaN(v))
        return values.length > 0 ? Math.min(...values) : null
      }

      case 'MAX': {
        const values = rows.map(r => Number(r[column!])).filter(v => !isNaN(v))
        return values.length > 0 ? Math.max(...values) : null
      }
    }
  }

  /**
   * Execute aggregate SQL query
   */
  private async _executeAggregateSQL(
    sqlQuery: string,
    table: string,
    doId?: string
  ): Promise<QueryResult> {
    // Parse aggregation functions from SELECT clause
    const aggregations: AggregationOptions['aggregations'] = []

    // Match SUM(column) as alias
    const sumMatches = sqlQuery.matchAll(/SUM\((\w+)\)\s+(?:as\s+)?(\w+)/gi)
    for (const match of sumMatches) {
      aggregations.push({
        function: 'SUM',
        column: match[1],
        alias: match[2]
      })
    }

    // Match COUNT(*) as alias
    const countMatches = sqlQuery.matchAll(/COUNT\(\*?\)\s+(?:as\s+)?(\w+)/gi)
    for (const match of countMatches) {
      aggregations.push({
        function: 'COUNT',
        alias: match[1]
      })
    }

    if (aggregations.length === 0) {
      throw new Error('No aggregations found in SQL query')
    }

    const result = await this.aggregate({
      doId,
      table,
      aggregations
    })

    return {
      rows: result.rows,
      columns: result.columns,
      stats: result.stats
    }
  }

  /**
   * Compare two Uint8Arrays
   */
  private _arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}
