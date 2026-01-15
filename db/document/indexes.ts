/**
 * DocumentStore Indexes
 *
 * Secondary index infrastructure for optimized queries on document fields.
 * Supports:
 * - Simple field indexes (single field)
 * - Compound indexes (multiple fields)
 * - Sparse indexes (only index documents where field exists)
 * - Partial indexes (index based on a filter condition)
 * - Text indexes for full-text search
 */

import type Database from 'better-sqlite3'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Index field definition
 */
export interface IndexField {
  /** Field path (supports dot notation for nested fields) */
  path: string
  /** Sort direction */
  order?: 'asc' | 'desc'
}

/**
 * Index definition
 */
export interface IndexDefinition {
  /** Index name (unique per type) */
  name: string
  /** Fields to index */
  fields: IndexField[]
  /** Only index documents where all fields exist */
  sparse?: boolean
  /** Only index documents matching this filter */
  where?: string
  /** Whether this is a unique index */
  unique?: boolean
}

/**
 * Index statistics
 */
export interface IndexStats {
  name: string
  rowCount: number
  sizeBytes: number
  lastRebuilt?: number
}

/**
 * Index manager options
 */
export interface IndexManagerOptions {
  /** Document type this manager handles */
  type: string
  /** Prefix for index table names */
  tablePrefix?: string
}

// ============================================================================
// INDEX MANAGER
// ============================================================================

/**
 * IndexManager - Manages secondary indexes for a document type
 *
 * Creates and maintains indexes stored in separate SQLite tables that
 * reference back to the main documents table.
 *
 * @example
 * ```typescript
 * const indexManager = new IndexManager(sqlite, { type: 'Customer' })
 *
 * // Create an index on email field
 * await indexManager.createIndex({
 *   name: 'email_idx',
 *   fields: [{ path: 'email' }],
 *   unique: true,
 * })
 *
 * // Create a compound index
 * await indexManager.createIndex({
 *   name: 'tier_created_idx',
 *   fields: [
 *     { path: 'metadata.tier' },
 *     { path: '$createdAt', order: 'desc' },
 *   ],
 * })
 *
 * // Lookup using index
 * const docIds = await indexManager.lookup('email_idx', { email: 'alice@example.com' })
 * ```
 */
export class IndexManager {
  private db: Database.Database
  private type: string
  private tablePrefix: string
  private indexes: Map<string, IndexDefinition> = new Map()

  constructor(db: Database.Database, options: IndexManagerOptions) {
    this.db = db
    this.type = options.type
    this.tablePrefix = options.tablePrefix ?? 'doc_idx'
    this.loadExistingIndexes()
  }

  /**
   * Load existing index definitions from metadata table
   */
  private loadExistingIndexes(): void {
    // Create metadata table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}_meta (
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        definition TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (type, name)
      )
    `)

    // Load indexes for this type
    const rows = this.db.prepare(`
      SELECT name, definition FROM ${this.tablePrefix}_meta WHERE type = ?
    `).all(this.type) as Array<{ name: string; definition: string }>

    for (const row of rows) {
      try {
        const def = JSON.parse(row.definition) as IndexDefinition
        this.indexes.set(row.name, def)
      } catch {
        // Skip invalid definitions
      }
    }
  }

  /**
   * Get the table name for an index
   */
  private getIndexTableName(indexName: string): string {
    // Sanitize for SQL safety
    const safeName = indexName.replace(/[^a-zA-Z0-9_]/g, '_')
    const safeType = this.type.replace(/[^a-zA-Z0-9_]/g, '_')
    return `${this.tablePrefix}_${safeType}_${safeName}`
  }

  /**
   * Get the SQL expression for extracting a field from JSON
   */
  private getFieldExpr(field: IndexField): string {
    if (field.path.startsWith('$')) {
      // System field stored as column
      return `"${field.path}"`
    }
    // JSON field
    return `json_extract(data, '$.${field.path}')`
  }

  /**
   * Create a secondary index
   */
  async createIndex(definition: IndexDefinition): Promise<void> {
    if (this.indexes.has(definition.name)) {
      throw new Error(`Index "${definition.name}" already exists for type "${this.type}"`)
    }

    const tableName = this.getIndexTableName(definition.name)

    // Build column definitions
    const columns: string[] = []
    const fieldExprs: string[] = []

    for (let i = 0; i < definition.fields.length; i++) {
      const field = definition.fields[i]
      columns.push(`f${i} TEXT`)
      fieldExprs.push(this.getFieldExpr(field))
    }

    // Create the index table
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        "$id" TEXT PRIMARY KEY,
        ${columns.join(',\n        ')},
        FOREIGN KEY ("$id") REFERENCES documents("$id") ON DELETE CASCADE
      )
    `
    this.db.exec(createTableSql)

    // Create indexes on the index table columns
    for (let i = 0; i < definition.fields.length; i++) {
      const field = definition.fields[i]
      const order = field.order?.toUpperCase() ?? 'ASC'
      const indexType = definition.unique && i === 0 ? 'UNIQUE INDEX' : 'INDEX'
      this.db.exec(`
        CREATE ${indexType} IF NOT EXISTS ${tableName}_f${i}
        ON ${tableName}(f${i} ${order})
      `)
    }

    // Also create a compound index if multiple fields
    if (definition.fields.length > 1) {
      const compoundCols = definition.fields.map((f, i) => {
        const order = f.order?.toUpperCase() ?? 'ASC'
        return `f${i} ${order}`
      }).join(', ')

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS ${tableName}_compound
        ON ${tableName}(${compoundCols})
      `)
    }

    // Populate the index from existing documents
    const whereClause = definition.sparse
      ? `WHERE "$type" = ? AND ${fieldExprs.map(e => `${e} IS NOT NULL`).join(' AND ')}`
      : `WHERE "$type" = ?`

    const selectCols = ['$id', ...fieldExprs].map((e, i) => i === 0 ? `"$id"` : `${e} as f${i - 1}`).join(', ')
    const insertCols = ['"$id"', ...definition.fields.map((_, i) => `f${i}`)].join(', ')
    const selectColsForInsert = ['"$id"', ...fieldExprs].join(', ')

    const populateSql = `
      INSERT OR REPLACE INTO ${tableName} (${insertCols})
      SELECT ${selectColsForInsert}
      FROM documents
      ${whereClause}
    `
    this.db.prepare(populateSql).run(this.type)

    // Save index definition to metadata
    this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tablePrefix}_meta (type, name, definition, created_at)
      VALUES (?, ?, ?, ?)
    `).run(this.type, definition.name, JSON.stringify(definition), Date.now())

    this.indexes.set(definition.name, definition)
  }

  /**
   * Drop an index
   */
  async dropIndex(name: string): Promise<void> {
    if (!this.indexes.has(name)) {
      throw new Error(`Index "${name}" does not exist for type "${this.type}"`)
    }

    const tableName = this.getIndexTableName(name)

    // Drop the index table
    this.db.exec(`DROP TABLE IF EXISTS ${tableName}`)

    // Remove from metadata
    this.db.prepare(`
      DELETE FROM ${this.tablePrefix}_meta WHERE type = ? AND name = ?
    `).run(this.type, name)

    this.indexes.delete(name)
  }

  /**
   * Rebuild an index from scratch
   */
  async rebuildIndex(name: string): Promise<void> {
    const definition = this.indexes.get(name)
    if (!definition) {
      throw new Error(`Index "${name}" does not exist for type "${this.type}"`)
    }

    const tableName = this.getIndexTableName(name)

    // Clear existing data
    this.db.exec(`DELETE FROM ${tableName}`)

    // Repopulate
    const fieldExprs = definition.fields.map(f => this.getFieldExpr(f))
    const whereClause = definition.sparse
      ? `WHERE "$type" = ? AND ${fieldExprs.map(e => `${e} IS NOT NULL`).join(' AND ')}`
      : `WHERE "$type" = ?`

    const insertCols = ['"$id"', ...definition.fields.map((_, i) => `f${i}`)].join(', ')
    const selectCols = ['"$id"', ...fieldExprs].join(', ')

    const populateSql = `
      INSERT INTO ${tableName} (${insertCols})
      SELECT ${selectCols}
      FROM documents
      ${whereClause}
    `
    this.db.prepare(populateSql).run(this.type)
  }

  /**
   * Update index entries for a document
   * Call this after document create/update
   */
  updateDocument(docId: string, data: Record<string, unknown>): void {
    for (const [name, definition] of this.indexes) {
      const tableName = this.getIndexTableName(name)
      const fieldValues: (string | number | boolean | null)[] = []

      // Extract field values
      for (const field of definition.fields) {
        const value = this.extractFieldValue(data, field.path)
        fieldValues.push(value as string | number | boolean | null)
      }

      // Check sparse condition
      if (definition.sparse && fieldValues.some(v => v === null || v === undefined)) {
        // Delete from index if it exists
        this.db.prepare(`DELETE FROM ${tableName} WHERE "$id" = ?`).run(docId)
        continue
      }

      // Upsert into index
      const cols = ['"$id"', ...definition.fields.map((_, i) => `f${i}`)].join(', ')
      const placeholders = ['?', ...definition.fields.map(() => '?')].join(', ')

      this.db.prepare(`
        INSERT OR REPLACE INTO ${tableName} (${cols})
        VALUES (${placeholders})
      `).run(docId, ...fieldValues)
    }
  }

  /**
   * Remove document from all indexes
   * Call this after document delete
   */
  removeDocument(docId: string): void {
    for (const name of this.indexes.keys()) {
      const tableName = this.getIndexTableName(name)
      this.db.prepare(`DELETE FROM ${tableName} WHERE "$id" = ?`).run(docId)
    }
  }

  /**
   * Extract a nested field value using dot notation
   */
  private extractFieldValue(data: Record<string, unknown>, path: string): unknown {
    if (path.startsWith('$')) {
      // System field should be in data directly
      return data[path]
    }

    const parts = path.split('.')
    let current: unknown = data

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Lookup documents using an index
   */
  lookup(indexName: string, values: Record<string, unknown>): string[] {
    const definition = this.indexes.get(indexName)
    if (!definition) {
      throw new Error(`Index "${indexName}" does not exist`)
    }

    const tableName = this.getIndexTableName(indexName)
    const conditions: string[] = []
    const params: unknown[] = []

    // Build conditions based on provided values
    for (let i = 0; i < definition.fields.length; i++) {
      const field = definition.fields[i]
      const value = this.extractFieldValue(values as Record<string, unknown>, field.path)

      if (value !== undefined) {
        conditions.push(`f${i} = ?`)
        params.push(value)
      }
    }

    if (conditions.length === 0) {
      return []
    }

    const sql = `SELECT "$id" FROM ${tableName} WHERE ${conditions.join(' AND ')}`
    const rows = this.db.prepare(sql).all(...params) as Array<{ $id: string }>

    return rows.map(r => r.$id)
  }

  /**
   * Range lookup on an index
   */
  lookupRange(
    indexName: string,
    field: string,
    options: {
      gt?: unknown
      gte?: unknown
      lt?: unknown
      lte?: unknown
      limit?: number
      order?: 'asc' | 'desc'
    }
  ): string[] {
    const definition = this.indexes.get(indexName)
    if (!definition) {
      throw new Error(`Index "${indexName}" does not exist`)
    }

    // Find field index
    const fieldIdx = definition.fields.findIndex(f => f.path === field)
    if (fieldIdx === -1) {
      throw new Error(`Field "${field}" is not part of index "${indexName}"`)
    }

    const tableName = this.getIndexTableName(indexName)
    const conditions: string[] = []
    const params: unknown[] = []

    if (options.gt !== undefined) {
      conditions.push(`f${fieldIdx} > ?`)
      params.push(options.gt)
    }
    if (options.gte !== undefined) {
      conditions.push(`f${fieldIdx} >= ?`)
      params.push(options.gte)
    }
    if (options.lt !== undefined) {
      conditions.push(`f${fieldIdx} < ?`)
      params.push(options.lt)
    }
    if (options.lte !== undefined) {
      conditions.push(`f${fieldIdx} <= ?`)
      params.push(options.lte)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const order = options.order?.toUpperCase() ?? 'ASC'
    const limit = options.limit ? `LIMIT ${options.limit}` : ''

    const sql = `
      SELECT "$id" FROM ${tableName}
      ${where}
      ORDER BY f${fieldIdx} ${order}
      ${limit}
    `

    const rows = this.db.prepare(sql).all(...params) as Array<{ $id: string }>
    return rows.map(r => r.$id)
  }

  /**
   * Get all index definitions
   */
  getIndexes(): IndexDefinition[] {
    return Array.from(this.indexes.values())
  }

  /**
   * Get statistics for an index
   */
  getStats(indexName: string): IndexStats {
    if (!this.indexes.has(indexName)) {
      throw new Error(`Index "${indexName}" does not exist`)
    }

    const tableName = this.getIndexTableName(indexName)

    const countResult = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number }

    // Estimate size (rough calculation)
    const pageSize = 4096 // SQLite default page size
    const pageCountResult = this.db.prepare(`
      SELECT (
        SELECT page_count FROM pragma_page_count
      ) * ${pageSize} as total_size
    `).get() as { total_size: number }

    return {
      name: indexName,
      rowCount: countResult.count,
      sizeBytes: pageCountResult?.total_size ?? 0,
    }
  }

  /**
   * Check if a query can use an index
   */
  canUseIndex(queryFields: string[]): { indexName: string; coverage: 'full' | 'partial' } | null {
    for (const [name, definition] of this.indexes) {
      const indexFields = definition.fields.map(f => f.path)

      // Check for full coverage
      if (queryFields.every(f => indexFields.includes(f))) {
        return { indexName: name, coverage: 'full' }
      }

      // Check for partial coverage (first field matches)
      if (queryFields.some(f => f === indexFields[0])) {
        return { indexName: name, coverage: 'partial' }
      }
    }

    return null
  }
}

// ============================================================================
// PREDEFINED INDEX TEMPLATES
// ============================================================================

/**
 * Common index templates
 */
export const INDEX_TEMPLATES = {
  /**
   * Create a unique email index
   */
  uniqueEmail: {
    name: 'unique_email',
    fields: [{ path: 'email' }],
    unique: true,
    sparse: true,
  } as IndexDefinition,

  /**
   * Create a created_at index for time-based queries
   */
  createdAt: {
    name: 'created_at',
    fields: [{ path: '$createdAt', order: 'desc' as const }],
  } as IndexDefinition,

  /**
   * Create an updated_at index for sync operations
   */
  updatedAt: {
    name: 'updated_at',
    fields: [{ path: '$updatedAt', order: 'desc' as const }],
  } as IndexDefinition,

  /**
   * Create a status index for workflow queries
   */
  status: {
    name: 'status',
    fields: [{ path: 'status' }],
    sparse: true,
  } as IndexDefinition,

  /**
   * Create a tenant/org index for multi-tenant queries
   */
  tenant: {
    name: 'tenant',
    fields: [{ path: 'tenantId' }],
    sparse: true,
  } as IndexDefinition,
}
