/**
 * IndexManager - Secondary Index Coordinator for Document Collections
 *
 * Coordinates multiple TypedColumnStore instances for secondary indexes,
 * providing:
 *
 * - Compound indexes (multiple fields)
 * - Sparse indexes (only index docs with the field)
 * - Unique indexes (enforce uniqueness on insert)
 * - TTL indexes (automatic expiration)
 * - Partial indexes (with filter expression)
 *
 * Uses PathExtractor to automatically extract field values from documents
 * into typed columns. Integrates with SchemaEvolution to handle type changes
 * in indexed fields.
 *
 * @module db/primitives/index-manager
 * @see dotdo-0i3mp - Implement Index Manager for secondary indexes
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base document interface with required _id
 */
export interface Document {
  _id: string
  [key: string]: unknown
}

/**
 * Index direction: 1 for ascending, -1 for descending
 */
export type IndexDirection = 1 | -1

/**
 * Index field specification
 */
export type IndexFields = Record<string, IndexDirection>

/**
 * Query filter type
 */
export type QueryFilter = Record<string, unknown>

/**
 * Comparison operators for queries
 */
export interface QueryOperators<T = unknown> {
  $eq?: T
  $ne?: T
  $gt?: T
  $gte?: T
  $lt?: T
  $lte?: T
  $in?: T[]
  $nin?: T[]
  $exists?: boolean
}

/**
 * Sort specification for queries
 */
export type SortSpec = Record<string, IndexDirection>

/**
 * Index options for creating indexes
 */
export interface IndexOptions {
  /** Custom index name */
  name?: string
  /** Enforce uniqueness */
  unique?: boolean
  /** Only index documents where field exists */
  sparse?: boolean
  /** Expire documents after seconds */
  expireAfterSeconds?: number
  /** Only index documents matching this filter */
  partialFilterExpression?: QueryFilter
}

/**
 * Index definition for creating indexes
 */
export interface IndexDefinition {
  fields: IndexFields
  options?: IndexOptions
}

/**
 * Index information returned by listIndexes
 */
export interface IndexInfo {
  name: string
  fields: IndexFields
  unique: boolean
  sparse: boolean
  expireAfterSeconds?: number
  partialFilterExpression?: QueryFilter
}

/**
 * Index entry in the internal store
 */
export interface IndexEntry {
  value: unknown
  docId: string
}

/**
 * Index statistics
 */
export interface IndexStats {
  name: string
  documentCount: number
  uniqueValues: number
  avgEntriesPerValue: number
  typeStats: Record<string, number>
}

/**
 * Query options for index selection
 */
export interface QueryOptions {
  sort?: SortSpec
  limit?: number
  skip?: number
}

/**
 * Internal index structure
 */
interface InternalIndex {
  info: IndexInfo
  entries: Map<string, Set<string>> // value -> docIds
  docValues: Map<string, unknown[]> // docId -> compound key values
  typeStats: Map<string, number> // type name -> count
}

/**
 * IndexManager interface
 */
export interface IndexManager<TDoc extends Document = Document> {
  // Index creation
  createIndex(definition: IndexDefinition): string
  dropIndex(name: string): void
  listIndexes(): IndexInfo[]
  clearAllIndexes(): void
  rebuildIndex(name: string): void

  // Document operations
  indexDocument(doc: TDoc): void
  indexDocuments(docs: TDoc[]): void
  removeDocument(docId: string): void
  removeDocuments(docIds: string[]): void

  // Queries
  find(filter: QueryFilter, options?: QueryOptions): string[]
  selectIndex(filter: QueryFilter, options?: QueryOptions): IndexInfo | null

  // TTL
  getExpiredDocumentIds(): string[]

  // Stats
  getIndexStats(name: string): IndexStats | null

  // Path extraction
  extractValue(doc: TDoc, path: string): unknown
  extractCompoundKey(doc: TDoc, paths: string[]): unknown[]
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Generate index name from fields
 */
function generateIndexName(fields: IndexFields): string {
  return Object.entries(fields)
    .map(([field, dir]) => `${field.replace(/\./g, '_')}_${dir}`)
    .join('_')
}

/**
 * Create a comparable key from compound values
 */
function createCompoundKey(values: unknown[]): string {
  return values.map((v) => {
    if (v === null || v === undefined) return '\0null'
    if (typeof v === 'string') return `s:${v}`
    if (typeof v === 'number') return `n:${v.toString().padStart(20, '0')}`
    if (typeof v === 'boolean') return `b:${v}`
    if (Array.isArray(v)) return `a:${JSON.stringify(v)}`
    return `o:${JSON.stringify(v)}`
  }).join('\x01')
}

/**
 * Extract value from document by dot-notation path
 */
function extractValueByPath(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = doc

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Check if value matches a query filter
 */
function matchesFilter(doc: Document, filter: QueryFilter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const value = extractValueByPath(doc, key)

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      const ops = condition as QueryOperators
      if (!matchesOperators(value, ops)) {
        return false
      }
    } else {
      // Direct equality
      if (!isEqual(value, condition)) {
        return false
      }
    }
  }
  return true
}

/**
 * Check if value matches query operators
 */
function matchesOperators(value: unknown, ops: QueryOperators): boolean {
  for (const [op, operand] of Object.entries(ops)) {
    switch (op) {
      case '$eq':
        if (!isEqual(value, operand)) return false
        break
      case '$ne':
        if (isEqual(value, operand)) return false
        break
      case '$gt':
        if (!isComparable(value, operand) || compare(value, operand) <= 0) return false
        break
      case '$gte':
        if (!isComparable(value, operand) || compare(value, operand) < 0) return false
        break
      case '$lt':
        if (!isComparable(value, operand) || compare(value, operand) >= 0) return false
        break
      case '$lte':
        if (!isComparable(value, operand) || compare(value, operand) > 0) return false
        break
      case '$in':
        if (!Array.isArray(operand) || !operand.some((v) => isEqual(value, v))) return false
        break
      case '$nin':
        if (Array.isArray(operand) && operand.some((v) => isEqual(value, v))) return false
        break
      case '$exists':
        if (operand && value === undefined) return false
        if (!operand && value !== undefined) return false
        break
    }
  }
  return true
}

/**
 * Check if two values are equal
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => isEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) =>
      isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    )
  }
  return false
}

/**
 * Check if values are comparable
 */
function isComparable(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  const typeA = typeof a
  const typeB = typeof b
  return typeA === typeB && (typeA === 'number' || typeA === 'string')
}

/**
 * Compare two values
 */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b)
  }
  return 0
}

/**
 * Get type name for stats
 */
function getTypeName(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * IndexManager implementation
 */
class IndexManagerImpl<TDoc extends Document = Document> implements IndexManager<TDoc> {
  private indexes: Map<string, InternalIndex> = new Map()
  private documentData: Map<string, TDoc> = new Map()

  // ============================================================================
  // INDEX CREATION
  // ============================================================================

  createIndex(definition: IndexDefinition): string {
    const { fields, options = {} } = definition

    // Validate fields
    if (!fields || Object.keys(fields).length === 0) {
      throw new Error('Index must have at least one field (empty fields)')
    }

    for (const [field, direction] of Object.entries(fields)) {
      if (field.startsWith('$')) {
        throw new Error(`Invalid field name: ${field} (invalid field)`)
      }
      if (direction !== 1 && direction !== -1) {
        throw new Error(`Invalid direction for field ${field}: ${direction} (invalid direction)`)
      }
    }

    const name = options.name || generateIndexName(fields)

    // Check for existing index with same fields
    for (const [existingName, existingIndex] of this.indexes) {
      const existingFields = Object.keys(existingIndex.info.fields)
      const newFields = Object.keys(fields)

      if (
        existingFields.length === newFields.length &&
        existingFields.every(
          (f, i) =>
            f === newFields[i] &&
            existingIndex.info.fields[f] === fields[newFields[i]!]
        )
      ) {
        // Same fields - return existing index name
        return existingName
      }
    }

    const info: IndexInfo = {
      name,
      fields,
      unique: options.unique ?? false,
      sparse: options.sparse ?? false,
      expireAfterSeconds: options.expireAfterSeconds,
      partialFilterExpression: options.partialFilterExpression,
    }

    const index: InternalIndex = {
      info,
      entries: new Map(),
      docValues: new Map(),
      typeStats: new Map(),
    }

    this.indexes.set(name, index)

    // Re-index existing documents for new index
    for (const doc of this.documentData.values()) {
      this.indexDocumentForIndex(doc, index)
    }

    return name
  }

  dropIndex(name: string): void {
    if (!this.indexes.has(name)) {
      throw new Error(`Index '${name}' not found`)
    }
    this.indexes.delete(name)
  }

  listIndexes(): IndexInfo[] {
    return Array.from(this.indexes.values()).map((idx) => idx.info)
  }

  clearAllIndexes(): void {
    this.indexes.clear()
  }

  rebuildIndex(name: string): void {
    const index = this.indexes.get(name)
    if (!index) {
      throw new Error(`Index '${name}' not found`)
    }

    // Clear existing entries
    index.entries.clear()
    index.docValues.clear()
    index.typeStats.clear()

    // Re-index all documents
    for (const doc of this.documentData.values()) {
      this.indexDocumentForIndex(doc, index)
    }
  }

  // ============================================================================
  // DOCUMENT OPERATIONS
  // ============================================================================

  indexDocument(doc: TDoc): void {
    const docId = doc._id

    // Check if updating existing document
    const isUpdate = this.documentData.has(docId)
    if (isUpdate) {
      // Remove old entries
      this.removeDocumentFromIndexes(docId)
    }

    // Store document
    this.documentData.set(docId, doc)

    // Index in all indexes
    for (const index of this.indexes.values()) {
      this.indexDocumentForIndex(doc, index)
    }
  }

  indexDocuments(docs: TDoc[]): void {
    for (const doc of docs) {
      this.indexDocument(doc)
    }
  }

  removeDocument(docId: string): void {
    this.removeDocumentFromIndexes(docId)
    this.documentData.delete(docId)
  }

  removeDocuments(docIds: string[]): void {
    for (const docId of docIds) {
      this.removeDocument(docId)
    }
  }

  private indexDocumentForIndex(doc: TDoc, index: InternalIndex): void {
    const { info } = index

    // Check partial filter
    if (info.partialFilterExpression) {
      if (!matchesFilter(doc, info.partialFilterExpression)) {
        return
      }
    }

    // Extract compound key values
    const paths = Object.keys(info.fields)
    const values = paths.map((path) => extractValueByPath(doc, path))

    // Handle sparse index
    if (info.sparse) {
      const hasValue = values.some((v) => v !== undefined && v !== null)
      if (!hasValue) {
        return
      }
    }

    // Update type stats
    for (const value of values) {
      const typeName = getTypeName(value)
      index.typeStats.set(typeName, (index.typeStats.get(typeName) ?? 0) + 1)
    }

    const key = createCompoundKey(values)

    // Check unique constraint
    if (info.unique && !info.sparse) {
      const existing = index.entries.get(key)
      if (existing && existing.size > 0) {
        const existingId = Array.from(existing)[0]
        if (existingId !== doc._id) {
          throw new Error(`Duplicate key error: value '${key}' already exists in unique index '${info.name}'`)
        }
      }
    } else if (info.unique && info.sparse) {
      // For sparse unique, only check if all values are non-null
      const allNonNull = values.every((v) => v !== undefined && v !== null)
      if (allNonNull) {
        const existing = index.entries.get(key)
        if (existing && existing.size > 0) {
          const existingId = Array.from(existing)[0]
          if (existingId !== doc._id) {
            throw new Error(`Duplicate key error: value '${key}' already exists in unique index '${info.name}'`)
          }
        }
      }
    }

    // Add to index
    if (!index.entries.has(key)) {
      index.entries.set(key, new Set())
    }
    index.entries.get(key)!.add(doc._id)
    index.docValues.set(doc._id, values)
  }

  private removeDocumentFromIndexes(docId: string): void {
    for (const index of this.indexes.values()) {
      const values = index.docValues.get(docId)
      if (values) {
        const key = createCompoundKey(values)
        index.entries.get(key)?.delete(docId)

        // Update type stats
        for (const value of values) {
          const typeName = getTypeName(value)
          const count = index.typeStats.get(typeName) ?? 0
          if (count > 1) {
            index.typeStats.set(typeName, count - 1)
          } else {
            index.typeStats.delete(typeName)
          }
        }
      }
      index.docValues.delete(docId)
    }
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  find(filter: QueryFilter, options?: QueryOptions): string[] {
    const index = this.selectIndex(filter, options)

    if (!index) {
      // No suitable index - fall back to full scan
      const results: string[] = []
      for (const [docId, doc] of this.documentData) {
        if (matchesFilter(doc, filter)) {
          results.push(docId)
        }
      }
      return results
    }

    // Use index
    const internalIndex = this.indexes.get(index.name)!
    const indexFields = Object.keys(index.fields)

    // Build filter values for indexed fields
    const filterEntries = Object.entries(filter)
    const indexedFilters: Array<{ field: string; value: unknown; ops?: QueryOperators }> = []

    for (const [field, condition] of filterEntries) {
      if (indexFields.includes(field)) {
        if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
          indexedFilters.push({ field, value: undefined, ops: condition as QueryOperators })
        } else {
          indexedFilters.push({ field, value: condition })
        }
      }
    }

    // If first filter is equality, use direct lookup
    if (indexedFilters.length > 0) {
      const firstFilter = indexedFilters[0]!
      if (firstFilter.value !== undefined || (firstFilter.ops && '$eq' in firstFilter.ops)) {
        const eqValue = firstFilter.value ?? firstFilter.ops?.$eq

        // Find matching entries
        const results = new Set<string>()

        for (const [key, docIds] of internalIndex.entries) {
          // Decode key and check if matches
          const keyParts = key.split('\x01')
          const fieldIndex = indexFields.indexOf(firstFilter.field)

          if (fieldIndex >= 0 && keyParts[fieldIndex] !== undefined) {
            const storedValue = this.decodeKeyPart(keyParts[fieldIndex]!)
            if (isEqual(storedValue, eqValue)) {
              for (const docId of docIds) {
                // Verify full filter match
                const doc = this.documentData.get(docId)
                if (doc && matchesFilter(doc, filter)) {
                  results.add(docId)
                }
              }
            }
          }
        }

        return Array.from(results)
      }
    }

    // Range query or complex filter - scan index
    const results: string[] = []
    for (const docIds of internalIndex.entries.values()) {
      for (const docId of docIds) {
        const doc = this.documentData.get(docId)
        if (doc && matchesFilter(doc, filter)) {
          results.push(docId)
        }
      }
    }

    return results
  }

  private decodeKeyPart(part: string): unknown {
    if (part === '\0null') return null
    const prefix = part.slice(0, 2)
    const value = part.slice(2)
    switch (prefix) {
      case 's:':
        return value
      case 'n:':
        return parseFloat(value)
      case 'b:':
        return value === 'true'
      case 'a:':
        return JSON.parse(value)
      case 'o:':
        return JSON.parse(value)
      default:
        return part
    }
  }

  selectIndex(filter: QueryFilter, options?: QueryOptions): IndexInfo | null {
    const filterFields = Object.keys(filter)
    const sortFields = options?.sort ? Object.keys(options.sort) : []

    let bestIndex: IndexInfo | null = null
    let bestScore = -1

    for (const index of this.indexes.values()) {
      const indexFields = Object.keys(index.info.fields)
      let score = 0

      // Score based on filter field coverage
      for (const field of filterFields) {
        const idx = indexFields.indexOf(field)
        if (idx === 0) {
          score += 10 // First field - best
        } else if (idx > 0) {
          score += 5 // Subsequent field
        }
      }

      // Bonus for compound index covering filter + sort
      if (sortFields.length > 0) {
        for (const sortField of sortFields) {
          if (indexFields.includes(sortField)) {
            score += 3
            // Check direction match
            const sortDir = options!.sort![sortField]
            if (index.info.fields[sortField] === sortDir) {
              score += 2
            }
          }
        }
      }

      // Prefer exact field count match
      if (filterFields.every((f) => indexFields.includes(f))) {
        score += 5
      }

      if (score > bestScore) {
        bestScore = score
        bestIndex = index.info
      }
    }

    return bestScore > 0 ? bestIndex : null
  }

  // ============================================================================
  // TTL
  // ============================================================================

  getExpiredDocumentIds(): string[] {
    const now = Date.now()
    const expired: string[] = []

    for (const index of this.indexes.values()) {
      if (index.info.expireAfterSeconds === undefined) continue

      const ttlMs = index.info.expireAfterSeconds * 1000
      const ttlField = Object.keys(index.info.fields)[0]

      for (const [docId, doc] of this.documentData) {
        const fieldValue = extractValueByPath(doc, ttlField!)
        if (typeof fieldValue === 'number') {
          if (now > fieldValue + ttlMs) {
            expired.push(docId)
          }
        }
      }
    }

    return [...new Set(expired)]
  }

  // ============================================================================
  // STATS
  // ============================================================================

  getIndexStats(name: string): IndexStats | null {
    const index = this.indexes.get(name)
    if (!index) return null

    const documentCount = index.docValues.size
    const uniqueValues = index.entries.size

    let totalEntries = 0
    for (const docIds of index.entries.values()) {
      totalEntries += docIds.size
    }

    const avgEntriesPerValue = uniqueValues > 0 ? totalEntries / uniqueValues : 0

    const typeStats: Record<string, number> = {}
    for (const [type, count] of index.typeStats) {
      typeStats[type] = count
    }

    return {
      name,
      documentCount,
      uniqueValues,
      avgEntriesPerValue,
      typeStats,
    }
  }

  // ============================================================================
  // PATH EXTRACTION
  // ============================================================================

  extractValue(doc: TDoc, path: string): unknown {
    return extractValueByPath(doc, path)
  }

  extractCompoundKey(doc: TDoc, paths: string[]): unknown[] {
    return paths.map((path) => extractValueByPath(doc, path))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new IndexManager instance
 */
export function createIndexManager<TDoc extends Document = Document>(): IndexManager<TDoc> {
  return new IndexManagerImpl<TDoc>()
}
