/**
 * Index Manager for Document Store
 *
 * Coordinates multiple TypedColumnStore instances for secondary indexes.
 * Provides a unified interface for creating, managing, and querying indexes
 * on JSON document paths.
 *
 * ## Features
 * - **Single-field indexes** - Index on a single JSON path
 * - **Compound indexes** - Multi-field indexes for complex queries
 * - **Sparse indexes** - Only index documents that have the field
 * - **Unique indexes** - Enforce uniqueness constraints
 * - **TTL indexes** - Automatic document expiration
 * - **Partial indexes** - Index subset of documents based on filter
 * - **Index suggestions** - Recommend indexes based on query patterns
 *
 * ## Architecture
 *
 * Each index is backed by a TypedColumnStore that extracts values from
 * JSON paths using the PathExtractor. The IndexManager coordinates:
 *
 * 1. Index creation/deletion
 * 2. Document insertion/update/deletion propagation
 * 3. Index scan operations for queries
 * 4. Index intersection for multi-index queries
 *
 * @module db/primitives/document-store/index-manager
 *
 * @example
 * ```typescript
 * import { IndexManager, createIndexManager } from './index-manager'
 * import Database from 'better-sqlite3'
 *
 * const sqlite = new Database(':memory:')
 * const manager = createIndexManager(sqlite, {
 *   tableName: 'documents',
 *   documentColumn: 'data',
 * })
 *
 * // Create a single-field index
 * manager.createIndex('email', { unique: true })
 *
 * // Create a compound index
 * manager.createIndex(['status', 'createdAt'], { name: 'status_time' })
 *
 * // Create a sparse index
 * manager.createIndex('premium', { sparse: true })
 *
 * // Create a TTL index (auto-expire documents)
 * manager.createIndex('expiresAt', { expireAfterSeconds: 3600 })
 *
 * // Query using index
 * const results = manager.scan('email', 'alice@example.com')
 * ```
 */

import {
  extractPaths,
  getPath,
  inferType,
  type JSONValue,
  type JSONObject,
  type JSONType,
} from './path-extractor'

// =============================================================================
// Types
// =============================================================================

/**
 * Index field specification
 */
export interface IndexField {
  /** JSON path (dot notation) */
  path: string
  /** Sort direction: 1 for ascending, -1 for descending */
  direction: 1 | -1
}

/**
 * Index specification for creating indexes
 */
export interface IndexSpec {
  /** Index fields (single path or array for compound index) */
  fields: string | string[] | IndexField[]
  /** Index name (auto-generated if not provided) */
  name?: string
  /** If true, enforce uniqueness */
  unique?: boolean
  /** If true, only index documents that have the field */
  sparse?: boolean
  /** TTL in seconds (for TTL indexes) */
  expireAfterSeconds?: number
  /** Filter expression for partial indexes */
  partialFilterExpression?: Record<string, unknown>
  /** Type filter: only index documents of this type */
  typeId?: number
  /** Type name filter */
  typeName?: string
  /** Background build (no-op in SQLite, for API compatibility) */
  background?: boolean
}

/**
 * Index information
 */
export interface IndexInfo {
  /** Index name */
  name: string
  /** Index fields with directions */
  fields: IndexField[]
  /** Whether index is unique */
  unique: boolean
  /** Whether index is sparse */
  sparse: boolean
  /** TTL in seconds (if TTL index) */
  expireAfterSeconds?: number
  /** Partial filter expression (if partial index) */
  partialFilterExpression?: Record<string, unknown>
  /** Type ID filter (if type-specific) */
  typeId?: number
  /** Type name filter */
  typeName?: string
  /** Number of documents indexed */
  documentCount: number
  /** Index size estimate in bytes */
  sizeBytes: number
  /** Whether index is ready for use */
  ready: boolean
  /** Creation timestamp */
  createdAt: number
}

/**
 * Index scan result
 */
export interface IndexScanResult {
  /** Document IDs that match the index scan */
  ids: string[]
  /** Number of documents scanned */
  scanned: number
  /** Whether the scan used the index or fell back to table scan */
  usedIndex: boolean
  /** Index name used (if any) */
  indexUsed?: string
}

/**
 * Index suggestion based on query patterns
 */
export interface IndexSuggestion {
  /** Suggested field paths */
  fields: string[]
  /** Reason for suggestion */
  reason: string
  /** Estimated improvement */
  estimatedImprovement: 'low' | 'medium' | 'high'
  /** Query patterns that would benefit */
  benefitsQueries: string[]
}

/**
 * Index Manager options
 */
export interface IndexManagerOptions {
  /** Table name containing documents */
  tableName: string
  /** Column name for JSON document data */
  documentColumn: string
  /** Column name for document ID (default: 'id') */
  idColumn?: string
  /** Column name for type ID (for partial indexes) */
  typeIdColumn?: string
  /** Column name for type name */
  typeNameColumn?: string
  /** Whether to track index usage statistics */
  trackUsage?: boolean
}

/**
 * Index entry for propagating changes
 */
interface IndexEntry {
  docId: string
  values: Map<string, JSONValue>
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ID_COLUMN = 'id'
const DEFAULT_TYPE_ID_COLUMN = 'type_id'
const DEFAULT_TYPE_NAME_COLUMN = 'type_name'

// Valid path pattern (alphanumeric, underscore, dots for nesting)
const VALID_PATH_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/

// =============================================================================
// Index Manager Implementation
// =============================================================================

/**
 * IndexManager for Document Store
 *
 * Manages secondary indexes on JSON documents stored in SQLite.
 */
export class IndexManager {
  private readonly sqlite: SqliteDatabase
  private readonly options: Required<IndexManagerOptions>
  private readonly indexes: Map<string, IndexInfo> = new Map()
  private readonly usageStats: Map<string, number> = new Map()
  private initialized = false

  constructor(sqlite: SqliteDatabase, options: IndexManagerOptions) {
    this.sqlite = sqlite
    this.options = {
      tableName: options.tableName,
      documentColumn: options.documentColumn,
      idColumn: options.idColumn ?? DEFAULT_ID_COLUMN,
      typeIdColumn: options.typeIdColumn ?? DEFAULT_TYPE_ID_COLUMN,
      typeNameColumn: options.typeNameColumn ?? DEFAULT_TYPE_NAME_COLUMN,
      trackUsage: options.trackUsage ?? true,
    }
  }

  /**
   * Initialize the index manager, loading existing indexes from database
   */
  initialize(): void {
    if (this.initialized) return

    // Load existing indexes from sqlite_master
    this.loadExistingIndexes()
    this.initialized = true
  }

  /**
   * Create an index on one or more JSON paths
   *
   * @param fields - Field path(s) to index
   * @param options - Index options
   * @returns Index name
   */
  createIndex(fields: string | string[] | IndexField[], options: Omit<IndexSpec, 'fields'> = {}): string {
    this.ensureInitialized()

    const normalizedFields = this.normalizeFields(fields)
    const indexName = options.name ?? this.generateIndexName(normalizedFields, options)

    // Validate paths
    for (const field of normalizedFields) {
      this.validatePath(field.path)
    }

    // Check if index already exists
    if (this.indexes.has(indexName)) {
      return indexName // Idempotent - return existing index name
    }

    // Build SQL for index creation
    const sql = this.buildCreateIndexSql(indexName, normalizedFields, options)

    // Create the index
    this.sqlite.exec(sql)

    // Store index info
    const indexInfo: IndexInfo = {
      name: indexName,
      fields: normalizedFields,
      unique: options.unique ?? false,
      sparse: options.sparse ?? false,
      expireAfterSeconds: options.expireAfterSeconds,
      partialFilterExpression: options.partialFilterExpression,
      typeId: options.typeId,
      typeName: options.typeName,
      documentCount: 0,
      sizeBytes: 0,
      ready: true,
      createdAt: Date.now(),
    }

    this.indexes.set(indexName, indexInfo)
    this.usageStats.set(indexName, 0)

    return indexName
  }

  /**
   * Create a compound index on multiple fields
   *
   * @param paths - Array of field paths
   * @param options - Index options
   * @returns Index name
   */
  createCompoundIndex(
    paths: string[],
    options: Omit<IndexSpec, 'fields'> & {
      includeTypeId?: boolean
      includeTypeName?: boolean
    } = {}
  ): string {
    const fields: IndexField[] = []

    // Add type columns if requested
    if (options.includeTypeId) {
      fields.push({ path: this.options.typeIdColumn, direction: 1 })
    }
    if (options.includeTypeName) {
      fields.push({ path: this.options.typeNameColumn, direction: 1 })
    }

    // Add specified paths
    for (const path of paths) {
      fields.push({ path, direction: 1 })
    }

    return this.createIndex(fields, options)
  }

  /**
   * Drop an index
   *
   * @param path - Field path or index name
   * @param options - Options to identify partial indexes
   */
  dropIndex(path: string, options: { typeId?: number; typeName?: string } = {}): void {
    this.ensureInitialized()

    // Find the index
    let indexName: string | undefined

    // First, try to find by exact name
    if (this.indexes.has(path)) {
      indexName = path
    } else {
      // Find by path and options
      for (const [name, info] of this.indexes) {
        if (info.fields.length === 1 && info.fields[0]?.path === path) {
          // Match type filters if provided
          if (options.typeId !== undefined && info.typeId !== options.typeId) continue
          if (options.typeName !== undefined && info.typeName !== options.typeName) continue
          indexName = name
          break
        }
      }
    }

    if (!indexName) {
      return // Idempotent - no error if index doesn't exist
    }

    // Drop the SQL index
    this.sqlite.exec(`DROP INDEX IF EXISTS "${indexName}"`)

    // Remove from our tracking
    this.indexes.delete(indexName)
    this.usageStats.delete(indexName)
  }

  /**
   * Check if an index exists
   *
   * @param path - Field path to check
   * @param options - Options to identify partial indexes
   * @returns true if index exists
   */
  hasIndex(path: string, options: { typeId?: number; typeName?: string } = {}): boolean {
    this.ensureInitialized()

    // Check by exact name first
    if (this.indexes.has(path)) {
      const info = this.indexes.get(path)!
      if (options.typeId === undefined && options.typeName === undefined) {
        return true
      }
      if (options.typeId !== undefined && info.typeId !== options.typeId) return false
      if (options.typeName !== undefined && info.typeName !== options.typeName) return false
      return true
    }

    // Search by field path
    for (const info of this.indexes.values()) {
      if (info.fields.length === 1 && info.fields[0]?.path === path) {
        if (options.typeId === undefined && options.typeName === undefined) {
          // Looking for global index (no type filter)
          if (info.typeId === undefined && info.typeName === undefined) {
            return true
          }
        } else {
          if (options.typeId !== undefined && info.typeId !== options.typeId) continue
          if (options.typeName !== undefined && info.typeName !== options.typeName) continue
          return true
        }
      }
    }

    return false
  }

  /**
   * List all indexes
   *
   * @returns Array of index information
   */
  listIndexes(): IndexInfo[] {
    this.ensureInitialized()
    return Array.from(this.indexes.values())
  }

  /**
   * Get index information
   *
   * @param name - Index name
   * @returns Index info or undefined
   */
  getIndex(name: string): IndexInfo | undefined {
    this.ensureInitialized()
    return this.indexes.get(name)
  }

  /**
   * Synchronize indexes from schema definition
   *
   * Creates indexes for fields marked with `index: true` or shorthand `#type`.
   * Drops indexes no longer in schema.
   *
   * @param schema - Field schema definition
   * @param options - Type filter options
   */
  syncFromSchema(
    schema: Record<string, string | { type: string; index?: boolean }>,
    options: { typeId?: number; typeName?: string } = {}
  ): void {
    this.ensureInitialized()

    const desiredPaths = new Set<string>()

    // Parse schema to find indexed fields
    for (const [fieldName, fieldDef] of Object.entries(schema)) {
      let shouldIndex = false

      if (typeof fieldDef === 'string') {
        // Shorthand: "#string" means indexed string
        shouldIndex = fieldDef.startsWith('#')
      } else {
        shouldIndex = fieldDef.index === true
      }

      if (shouldIndex) {
        desiredPaths.add(fieldName)
      }
    }

    // Find existing indexes for this type
    const existingPaths = new Set<string>()
    for (const info of this.indexes.values()) {
      // Match type filter
      if (options.typeId !== undefined && info.typeId !== options.typeId) continue
      if (options.typeName !== undefined && info.typeName !== options.typeName) continue

      // Only consider single-field indexes
      if (info.fields.length === 1) {
        existingPaths.add(info.fields[0]!.path)
      }
    }

    // Create missing indexes
    for (const path of desiredPaths) {
      if (!existingPaths.has(path)) {
        this.createIndex(path, { typeId: options.typeId, typeName: options.typeName })
      }
    }

    // Drop obsolete indexes
    for (const path of existingPaths) {
      if (!desiredPaths.has(path)) {
        this.dropIndex(path, { typeId: options.typeId, typeName: options.typeName })
      }
    }
  }

  /**
   * Scan an index for a specific value
   *
   * @param path - Field path to scan
   * @param value - Value to find
   * @returns Scan result with matching document IDs
   */
  scan(path: string, value: JSONValue): IndexScanResult {
    this.ensureInitialized()

    // Find an index that covers this path
    const indexInfo = this.findIndexForPath(path)

    if (!indexInfo) {
      // Fall back to table scan
      return this.tableScan(path, value)
    }

    // Use the index
    const jsonPath = this.pathToJsonPath(path)
    const sql = `
      SELECT ${this.options.idColumn} AS id
      FROM ${this.options.tableName}
      WHERE ${jsonPath} = ?
    `

    const stmt = this.sqlite.prepare(sql)
    const rows = stmt.all(this.valueToSqlParam(value)) as { id: string }[]

    // Track usage
    if (this.options.trackUsage) {
      this.usageStats.set(indexInfo.name, (this.usageStats.get(indexInfo.name) ?? 0) + 1)
    }

    return {
      ids: rows.map((r) => r.id),
      scanned: rows.length,
      usedIndex: true,
      indexUsed: indexInfo.name,
    }
  }

  /**
   * Range scan on an index
   *
   * @param path - Field path to scan
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns Scan result with matching document IDs
   */
  scanRange(path: string, min: JSONValue, max: JSONValue): IndexScanResult {
    this.ensureInitialized()

    const indexInfo = this.findIndexForPath(path)
    const jsonPath = this.pathToJsonPath(path)

    const sql = `
      SELECT ${this.options.idColumn} AS id
      FROM ${this.options.tableName}
      WHERE ${jsonPath} >= ? AND ${jsonPath} <= ?
    `

    const stmt = this.sqlite.prepare(sql)
    const rows = stmt.all(this.valueToSqlParam(min), this.valueToSqlParam(max)) as { id: string }[]

    if (indexInfo && this.options.trackUsage) {
      this.usageStats.set(indexInfo.name, (this.usageStats.get(indexInfo.name) ?? 0) + 1)
    }

    return {
      ids: rows.map((r) => r.id),
      scanned: rows.length,
      usedIndex: !!indexInfo,
      indexUsed: indexInfo?.name,
    }
  }

  /**
   * Intersect multiple index scans
   *
   * @param conditions - Array of [path, value] pairs
   * @returns Scan result with IDs matching ALL conditions
   */
  intersect(conditions: Array<[string, JSONValue]>): IndexScanResult {
    this.ensureInitialized()

    if (conditions.length === 0) {
      return { ids: [], scanned: 0, usedIndex: false }
    }

    // Start with the first condition
    let result = this.scan(conditions[0]![0], conditions[0]![1])
    let usedIndexes: string[] = result.indexUsed ? [result.indexUsed] : []

    // Intersect with remaining conditions
    for (let i = 1; i < conditions.length; i++) {
      const [path, value] = conditions[i]!
      const scanResult = this.scan(path, value)

      // Intersect IDs
      const resultSet = new Set(result.ids)
      result.ids = scanResult.ids.filter((id) => resultSet.has(id))
      result.scanned += scanResult.scanned

      if (scanResult.indexUsed) {
        usedIndexes.push(scanResult.indexUsed)
      }
    }

    return {
      ids: result.ids,
      scanned: result.scanned,
      usedIndex: usedIndexes.length > 0,
      indexUsed: usedIndexes.length > 0 ? usedIndexes.join('+') : undefined,
    }
  }

  /**
   * Suggest indexes based on a query filter
   *
   * @param filter - MongoDB-style query filter
   * @returns Array of index suggestions
   */
  suggestIndexes(filter: Record<string, unknown>): IndexSuggestion[] {
    this.ensureInitialized()

    const suggestions: IndexSuggestion[] = []
    const fieldsInQuery = this.extractFieldsFromFilter(filter)

    // Check which fields are not indexed
    const unindexedFields: string[] = []
    for (const field of fieldsInQuery) {
      if (!this.hasIndex(field)) {
        unindexedFields.push(field)
      }
    }

    // Suggest indexes for unindexed fields
    if (unindexedFields.length > 0) {
      // Single field indexes
      for (const field of unindexedFields) {
        suggestions.push({
          fields: [field],
          reason: `Field '${field}' is used in queries but has no index`,
          estimatedImprovement: 'high',
          benefitsQueries: [`{ ${field}: ... }`],
        })
      }

      // Compound index if multiple fields
      if (unindexedFields.length > 1) {
        suggestions.push({
          fields: unindexedFields,
          reason: 'Multiple fields queried together - compound index may help',
          estimatedImprovement: 'medium',
          benefitsQueries: [JSON.stringify(filter)],
        })
      }
    }

    return suggestions
  }

  /**
   * Get index usage statistics
   *
   * @returns Map of index name to usage count
   */
  getUsageStats(): Map<string, number> {
    return new Map(this.usageStats)
  }

  /**
   * Propagate document insertion to indexes
   *
   * Called by DocumentStore when a document is inserted.
   *
   * @param docId - Document ID
   * @param doc - Document data
   */
  onInsert(docId: string, doc: JSONObject): void {
    // Indexes are expression-based in SQLite, so they auto-update
    // This hook is for tracking/validation only
  }

  /**
   * Propagate document update to indexes
   *
   * @param docId - Document ID
   * @param oldDoc - Previous document data
   * @param newDoc - New document data
   */
  onUpdate(docId: string, oldDoc: JSONObject, newDoc: JSONObject): void {
    // Expression-based indexes auto-update
  }

  /**
   * Propagate document deletion to indexes
   *
   * @param docId - Document ID
   */
  onDelete(docId: string): void {
    // Expression-based indexes auto-update
  }

  /**
   * Run TTL index expiration
   *
   * @returns Number of documents expired
   */
  expireTtlDocuments(): number {
    this.ensureInitialized()

    let totalExpired = 0

    for (const info of this.indexes.values()) {
      if (info.expireAfterSeconds === undefined) continue

      const expirationThreshold = Date.now() - info.expireAfterSeconds * 1000
      const path = info.fields[0]?.path
      if (!path) continue

      const jsonPath = this.pathToJsonPath(path)

      // Delete expired documents
      const sql = `
        DELETE FROM ${this.options.tableName}
        WHERE ${jsonPath} < ?
      `

      const result = this.sqlite.prepare(sql).run(expirationThreshold)
      totalExpired += result.changes
    }

    return totalExpired
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize()
    }
  }

  private loadExistingIndexes(): void {
    // Query sqlite_master for indexes on our table
    const sql = `
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index'
        AND tbl_name = ?
        AND name LIKE 'idx_${this.options.tableName}_data_%'
    `

    const rows = this.sqlite.prepare(sql).all(this.options.tableName) as { name: string; sql: string }[]

    for (const row of rows) {
      // Parse index info from SQL
      const info = this.parseIndexSql(row.name, row.sql)
      if (info) {
        this.indexes.set(info.name, info)
        this.usageStats.set(info.name, 0)
      }
    }
  }

  private parseIndexSql(name: string, sql: string): IndexInfo | null {
    // Extract fields from index SQL
    const match = sql.match(/json_extract\([^,]+,\s*'([^']+)'\)/g)
    if (!match) return null

    const fields: IndexField[] = match.map((m) => {
      const pathMatch = m.match(/'\$\.([^']+)'/)
      return {
        path: pathMatch?.[1] ?? '',
        direction: 1 as const,
      }
    })

    // Check for partial index (WHERE clause)
    let typeId: number | undefined
    let typeName: string | undefined

    const whereMatch = sql.match(/WHERE\s+(.+)$/i)
    if (whereMatch) {
      const whereClause = whereMatch[1]
      const typeIdMatch = whereClause?.match(/type_id\s*=\s*(\d+)/)
      const typeNameMatch = whereClause?.match(/type_name\s*=\s*'([^']+)'/)

      if (typeIdMatch) typeId = parseInt(typeIdMatch[1]!, 10)
      if (typeNameMatch) typeName = typeNameMatch[1]
    }

    return {
      name,
      fields,
      unique: sql.includes('UNIQUE'),
      sparse: false,
      typeId,
      typeName,
      documentCount: 0,
      sizeBytes: 0,
      ready: true,
      createdAt: Date.now(),
    }
  }

  private normalizeFields(fields: string | string[] | IndexField[]): IndexField[] {
    if (typeof fields === 'string') {
      return [{ path: fields, direction: 1 }]
    }

    if (Array.isArray(fields) && fields.length > 0) {
      if (typeof fields[0] === 'string') {
        return (fields as string[]).map((f) => ({ path: f, direction: 1 as const }))
      }
      return fields as IndexField[]
    }

    return []
  }

  private generateIndexName(fields: IndexField[], options: Omit<IndexSpec, 'fields'>): string {
    const parts = ['idx', this.options.tableName, 'data']

    // Add type prefix if partial index
    if (options.typeId !== undefined) {
      parts.push(`type${options.typeId}`)
    } else if (options.typeName !== undefined) {
      parts.push(options.typeName.toLowerCase())
    }

    // Add field names
    for (const field of fields) {
      const safePath = field.path.replace(/\./g, '_')
      parts.push(safePath)
    }

    return parts.join('_')
  }

  private validatePath(path: string): void {
    if (!path) {
      throw new IndexManagerError('Invalid path: empty path')
    }

    // Skip validation for built-in columns
    if ([this.options.typeIdColumn, this.options.typeNameColumn, this.options.idColumn].includes(path)) {
      return
    }

    if (!VALID_PATH_PATTERN.test(path)) {
      throw new IndexManagerError(`Invalid path: ${path}`)
    }
  }

  private buildCreateIndexSql(
    name: string,
    fields: IndexField[],
    options: Omit<IndexSpec, 'fields'>
  ): string {
    const uniqueClause = options.unique ? 'UNIQUE' : ''

    // Build column expressions
    const columns = fields.map((field) => {
      // Check if it's a built-in column
      if ([this.options.typeIdColumn, this.options.typeNameColumn].includes(field.path)) {
        return field.path
      }
      // JSON path extraction
      return `json_extract(${this.options.documentColumn}, '$.${field.path}')`
    })

    // Build WHERE clause for partial indexes
    const whereClauses: string[] = []

    if (options.typeId !== undefined) {
      whereClauses.push(`${this.options.typeIdColumn} = ${options.typeId}`)
    }

    if (options.typeName !== undefined) {
      whereClauses.push(`${this.options.typeNameColumn} = '${options.typeName}'`)
    }

    if (options.partialFilterExpression) {
      // Convert partial filter to SQL (simplified)
      for (const [key, value] of Object.entries(options.partialFilterExpression)) {
        const jsonPath = this.pathToJsonPath(key)
        whereClauses.push(`${jsonPath} = ${JSON.stringify(value)}`)
      }
    }

    // Sparse indexes only include documents where the field exists
    if (options.sparse && fields.length === 1) {
      const jsonPath = this.pathToJsonPath(fields[0]!.path)
      whereClauses.push(`${jsonPath} IS NOT NULL`)
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    return `
      CREATE ${uniqueClause} INDEX IF NOT EXISTS "${name}"
      ON ${this.options.tableName}(${columns.join(', ')})
      ${whereClause}
    `.trim()
  }

  private pathToJsonPath(path: string): string {
    // Check if it's a built-in column
    if ([this.options.typeIdColumn, this.options.typeNameColumn, this.options.idColumn].includes(path)) {
      return path
    }
    return `json_extract(${this.options.documentColumn}, '$.${path}')`
  }

  private valueToSqlParam(value: JSONValue): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === 'object') return JSON.stringify(value)
    return value
  }

  private findIndexForPath(path: string): IndexInfo | undefined {
    for (const info of this.indexes.values()) {
      if (info.fields.some((f) => f.path === path)) {
        return info
      }
    }
    return undefined
  }

  private tableScan(path: string, value: JSONValue): IndexScanResult {
    const jsonPath = this.pathToJsonPath(path)
    const sql = `
      SELECT ${this.options.idColumn} AS id
      FROM ${this.options.tableName}
      WHERE ${jsonPath} = ?
    `

    const stmt = this.sqlite.prepare(sql)
    const rows = stmt.all(this.valueToSqlParam(value)) as { id: string }[]

    return {
      ids: rows.map((r) => r.id),
      scanned: rows.length,
      usedIndex: false,
    }
  }

  private extractFieldsFromFilter(filter: Record<string, unknown>, prefix = ''): string[] {
    const fields: string[] = []

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) {
        // Logical operator - recurse into operands
        if (Array.isArray(value)) {
          for (const item of value) {
            fields.push(...this.extractFieldsFromFilter(item as Record<string, unknown>, prefix))
          }
        }
      } else {
        const fullPath = prefix ? `${prefix}.${key}` : key
        fields.push(fullPath)
      }
    }

    return fields
  }
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown by IndexManager
 */
export class IndexManagerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IndexManagerError'
  }
}

// =============================================================================
// SQLite Database Interface
// =============================================================================

/**
 * Minimal SQLite database interface
 * Compatible with better-sqlite3 and Cloudflare D1
 */
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number }
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new IndexManager instance
 *
 * @param sqlite - SQLite database connection
 * @param options - Index manager options
 * @returns New IndexManager instance
 */
export function createIndexManager(sqlite: SqliteDatabase, options: IndexManagerOptions): IndexManager {
  const manager = new IndexManager(sqlite, options)
  manager.initialize()
  return manager
}
