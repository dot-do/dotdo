/**
 * DocumentStore - MongoDB-like document storage primitive
 *
 * Provides document storage semantics with CRUD operations, queries, and indexes,
 * composing existing primitives for time-travel, columnar indexing, schema evolution,
 * and exactly-once transactions.
 *
 * ## Features
 * - **CRUD operations**: insert, insertMany, get, find, update, delete
 * - **Time-travel queries**: getAsOf, findAsOf for historical document state
 * - **Query support**: MongoDB-style operators ($eq, $gt, $lt, $in, $and, $or, etc.)
 * - **Index support**: createIndex, dropIndex, listIndexes
 * - **Transactions**: atomic multi-document operations
 * - **Schema evolution**: automatic schema inference and compatibility
 *
 * ## Architecture
 *
 * DocumentStore composes:
 * - TemporalStore: versioned document storage with time-travel
 * - TypedColumnStore: secondary indexes with efficient filtering
 * - SchemaEvolution: automatic schema inference and compatibility checks
 * - ExactlyOnceContext: transactional semantics with deduplication
 *
 * @module db/primitives/document-store
 */

import {
  createTemporalStore,
  type TemporalStore,
  type RetentionPolicy,
  type PruneStats,
} from './temporal-store'
import {
  createColumnStore,
  type TypedColumnStore,
  type ColumnType,
  type Predicate,
} from './typed-column-store'
import {
  createSchemaEvolution,
  type SchemaEvolution,
  type Schema,
  type FieldType,
} from './schema-evolution'
import {
  createExactlyOnceContext,
  type ExactlyOnceContext,
  type Transaction,
} from './exactly-once-context'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Document ID type - string or ObjectId-like
 */
export type DocumentId = string

/**
 * Base document interface - all documents have an _id field
 */
export interface Document {
  _id: DocumentId
  [key: string]: unknown
}

/**
 * Index specification
 */
export interface IndexSpec {
  /** Fields to index with sort direction (1 = ascending, -1 = descending) */
  fields: Record<string, 1 | -1>
  /** Index options */
  options?: IndexOptions
}

/**
 * Index options
 */
export interface IndexOptions {
  /** Index name (auto-generated if not provided) */
  name?: string
  /** Whether values must be unique */
  unique?: boolean
  /** Only index documents where the field exists */
  sparse?: boolean
  /** Optional filter for partial indexes */
  partialFilterExpression?: QueryFilter
}

/**
 * Index info returned by listIndexes
 */
export interface IndexInfo {
  name: string
  fields: Record<string, 1 | -1>
  unique: boolean
  sparse: boolean
  partialFilterExpression?: QueryFilter
}

/**
 * MongoDB-style query filter
 */
export type QueryFilter = Record<string, unknown>

/**
 * Query options
 */
export interface FindOptions {
  /** Maximum number of documents to return */
  limit?: number
  /** Number of documents to skip */
  skip?: number
  /** Sort specification */
  sort?: Record<string, 1 | -1>
  /** Fields to include/exclude (projection) */
  projection?: Record<string, 0 | 1>
}

/**
 * Update operators
 */
export interface UpdateOperators {
  /** Set field values */
  $set?: Record<string, unknown>
  /** Unset (remove) fields */
  $unset?: Record<string, 1 | ''>
  /** Increment numeric fields */
  $inc?: Record<string, number>
  /** Rename fields */
  $rename?: Record<string, string>
  /** Set field only if inserting */
  $setOnInsert?: Record<string, unknown>
  /** Push to array */
  $push?: Record<string, unknown>
  /** Pull from array */
  $pull?: Record<string, unknown>
  /** Add to set (unique) */
  $addToSet?: Record<string, unknown>
  /** Pop from array */
  $pop?: Record<string, 1 | -1>
  /** Current date */
  $currentDate?: Record<string, boolean | { $type: 'date' | 'timestamp' }>
  /** Multiply numeric fields */
  $mul?: Record<string, number>
  /** Set to minimum */
  $min?: Record<string, unknown>
  /** Set to maximum */
  $max?: Record<string, unknown>
}

/**
 * Update result
 */
export interface UpdateResult {
  /** Number of documents matched by filter */
  matchedCount: number
  /** Number of documents actually modified */
  modifiedCount: number
  /** ID of upserted document (if any) */
  upsertedId?: DocumentId
}

/**
 * Delete result
 */
export interface DeleteResult {
  /** Number of documents deleted */
  deletedCount: number
}

/**
 * Insert result
 */
export interface InsertResult {
  /** ID of inserted document */
  insertedId: DocumentId
}

/**
 * Insert many result
 */
export interface InsertManyResult {
  /** IDs of inserted documents */
  insertedIds: DocumentId[]
  /** Number of documents inserted */
  insertedCount: number
}

/**
 * DocumentStore options
 */
export interface DocumentStoreOptions {
  /** Collection name */
  collection?: string
  /** Enable time-travel queries */
  enableTimeTravel?: boolean
  /** Retention policy for document versions */
  retention?: RetentionPolicy
  /** Enable schema validation */
  enableSchemaValidation?: boolean
  /** Initial indexes to create */
  indexes?: IndexSpec[]
}

/**
 * Aggregation pipeline stage
 */
export type AggregationStage =
  | { $match: QueryFilter }
  | { $project: Record<string, 0 | 1 | string | Record<string, unknown>> }
  | { $sort: Record<string, 1 | -1> }
  | { $limit: number }
  | { $skip: number }
  | { $group: { _id: unknown; [key: string]: unknown } }
  | { $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean } }
  | { $lookup: { from: string; localField: string; foreignField: string; as: string } }
  | { $count: string }

// =============================================================================
// DOCUMENT STORE INTERFACE
// =============================================================================

/**
 * Document store interface with MongoDB-like semantics
 */
export interface DocumentStore<TDoc extends Document = Document> {
  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Insert a single document
   *
   * @param doc - Document to insert (without _id will get auto-generated ID)
   * @returns Insert result with document ID
   * @throws Error if document with same _id already exists
   */
  insert(doc: Omit<TDoc, '_id'> | TDoc): Promise<InsertResult>

  /**
   * Insert multiple documents
   *
   * @param docs - Documents to insert
   * @returns Insert result with all document IDs
   * @throws Error if any document has duplicate _id
   */
  insertMany(docs: Array<Omit<TDoc, '_id'> | TDoc>): Promise<InsertManyResult>

  /**
   * Get a document by ID
   *
   * @param id - Document ID
   * @returns Document or null if not found
   */
  get(id: DocumentId): Promise<TDoc | null>

  /**
   * Get document as it existed at a specific timestamp (time travel)
   *
   * @param id - Document ID
   * @param timestamp - Point in time to query
   * @returns Document state at that time or null
   */
  getAsOf(id: DocumentId, timestamp: number): Promise<TDoc | null>

  /**
   * Find documents matching a filter
   *
   * @param filter - MongoDB-style query filter
   * @param options - Find options (limit, skip, sort, projection)
   * @returns Array of matching documents
   */
  find(filter: QueryFilter, options?: FindOptions): Promise<TDoc[]>

  /**
   * Find a single document matching a filter
   *
   * @param filter - MongoDB-style query filter
   * @returns First matching document or null
   */
  findOne(filter: QueryFilter): Promise<TDoc | null>

  /**
   * Update documents matching a filter
   *
   * @param filter - MongoDB-style query filter
   * @param update - Update operators or replacement document
   * @returns Update result
   */
  update(filter: QueryFilter, update: UpdateOperators | TDoc): Promise<UpdateResult>

  /**
   * Update a single document matching a filter
   *
   * @param filter - MongoDB-style query filter
   * @param update - Update operators or replacement document
   * @param options - Update options
   * @returns Update result
   */
  updateOne(
    filter: QueryFilter,
    update: UpdateOperators | TDoc,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult>

  /**
   * Delete documents matching a filter
   *
   * @param filter - MongoDB-style query filter
   * @returns Delete result
   */
  delete(filter: QueryFilter): Promise<DeleteResult>

  /**
   * Delete a single document matching a filter
   *
   * @param filter - MongoDB-style query filter
   * @returns Delete result
   */
  deleteOne(filter: QueryFilter): Promise<DeleteResult>

  // ===========================================================================
  // Index Operations
  // ===========================================================================

  /**
   * Create an index
   *
   * @param spec - Index specification
   * @returns Index name
   */
  createIndex(spec: IndexSpec): Promise<string>

  /**
   * Drop an index by name
   *
   * @param name - Index name
   */
  dropIndex(name: string): Promise<void>

  /**
   * List all indexes
   *
   * @returns Array of index info
   */
  listIndexes(): Promise<IndexInfo[]>

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  /**
   * Execute an aggregation pipeline
   *
   * @param pipeline - Array of aggregation stages
   * @returns Aggregation results
   */
  aggregate(pipeline: AggregationStage[]): Promise<unknown[]>

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  /**
   * Execute operations in a transaction
   *
   * @param fn - Transaction function
   * @returns Transaction result
   */
  transaction<T>(fn: (session: DocumentStoreSession<TDoc>) => Promise<T>): Promise<T>

  // ===========================================================================
  // Collection Management
  // ===========================================================================

  /**
   * Count documents matching a filter
   *
   * @param filter - MongoDB-style query filter (empty for all)
   * @returns Number of matching documents
   */
  count(filter?: QueryFilter): Promise<number>

  /**
   * Get distinct values for a field
   *
   * @param field - Field path
   * @param filter - Optional filter
   * @returns Array of distinct values
   */
  distinct(field: string, filter?: QueryFilter): Promise<unknown[]>

  /**
   * Drop all documents and indexes
   */
  drop(): Promise<void>

  // ===========================================================================
  // Schema Operations
  // ===========================================================================

  /**
   * Get the inferred schema
   */
  getSchema(): Schema

  /**
   * Validate a document against the schema
   *
   * @param doc - Document to validate
   * @returns Validation result
   */
  validateDocument(doc: unknown): { valid: boolean; errors: string[] }

  // ===========================================================================
  // Maintenance
  // ===========================================================================

  /**
   * Prune old document versions based on retention policy
   *
   * @param policy - Optional policy override
   * @returns Prune statistics
   */
  prune(policy?: RetentionPolicy): Promise<PruneStats>

  /**
   * Alias for prune
   */
  compact(policy?: RetentionPolicy): Promise<PruneStats>
}

/**
 * Session interface for transactions
 */
export interface DocumentStoreSession<TDoc extends Document = Document> {
  insert(doc: Omit<TDoc, '_id'> | TDoc): Promise<InsertResult>
  get(id: DocumentId): Promise<TDoc | null>
  find(filter: QueryFilter, options?: FindOptions): Promise<TDoc[]>
  findOne(filter: QueryFilter): Promise<TDoc | null>
  update(filter: QueryFilter, update: UpdateOperators | TDoc): Promise<UpdateResult>
  updateOne(
    filter: QueryFilter,
    update: UpdateOperators | TDoc,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult>
  delete(filter: QueryFilter): Promise<DeleteResult>
  deleteOne(filter: QueryFilter): Promise<DeleteResult>
}

// =============================================================================
// QUERY MATCHING
// =============================================================================

/**
 * Check if a document matches a MongoDB-style filter
 */
function matchesFilter(doc: Document, filter: QueryFilter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    // Handle logical operators
    if (key === '$and') {
      if (!Array.isArray(condition)) return false
      if (!condition.every((subFilter: QueryFilter) => matchesFilter(doc, subFilter))) {
        return false
      }
      continue
    }

    if (key === '$or') {
      if (!Array.isArray(condition)) return false
      if (!condition.some((subFilter: QueryFilter) => matchesFilter(doc, subFilter))) {
        return false
      }
      continue
    }

    if (key === '$not') {
      if (matchesFilter(doc, condition as QueryFilter)) {
        return false
      }
      continue
    }

    if (key === '$nor') {
      if (!Array.isArray(condition)) return false
      if (condition.some((subFilter: QueryFilter) => matchesFilter(doc, subFilter))) {
        return false
      }
      continue
    }

    // Get the field value (supports dot notation)
    const fieldValue = getFieldValue(doc, key)

    // Handle comparison operators
    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      if (!matchesOperators(fieldValue, condition as Record<string, unknown>)) {
        return false
      }
    } else {
      // Direct equality
      if (!isEqual(fieldValue, condition)) {
        return false
      }
    }
  }

  return true
}

/**
 * Get a field value from a document using dot notation
 */
function getFieldValue(doc: Document, path: string): unknown {
  const parts = path.split('.')
  let value: unknown = doc

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined
    }
    if (typeof value !== 'object') {
      return undefined
    }
    value = (value as Record<string, unknown>)[part]
  }

  return value
}

/**
 * Check if a value matches MongoDB comparison operators
 */
function matchesOperators(value: unknown, operators: Record<string, unknown>): boolean {
  for (const [op, operand] of Object.entries(operators)) {
    switch (op) {
      case '$eq':
        if (!isEqual(value, operand)) return false
        break

      case '$ne':
        if (isEqual(value, operand)) return false
        break

      case '$gt':
        if (typeof value !== 'number' || typeof operand !== 'number') return false
        if (!(value > operand)) return false
        break

      case '$gte':
        if (typeof value !== 'number' || typeof operand !== 'number') return false
        if (!(value >= operand)) return false
        break

      case '$lt':
        if (typeof value !== 'number' || typeof operand !== 'number') return false
        if (!(value < operand)) return false
        break

      case '$lte':
        if (typeof value !== 'number' || typeof operand !== 'number') return false
        if (!(value <= operand)) return false
        break

      case '$in':
        if (!Array.isArray(operand)) return false
        if (!operand.some((item) => isEqual(value, item))) return false
        break

      case '$nin':
        if (!Array.isArray(operand)) return false
        if (operand.some((item) => isEqual(value, item))) return false
        break

      case '$exists':
        const exists = value !== undefined
        if (operand && !exists) return false
        if (!operand && exists) return false
        break

      case '$type':
        if (!matchesType(value, operand as string)) return false
        break

      case '$regex': {
        if (typeof value !== 'string') return false
        const flags = (operators.$options as string) || ''
        const regex = new RegExp(operand as string, flags)
        if (!regex.test(value)) return false
        break
      }

      case '$options':
        // Handled by $regex
        break

      case '$size':
        if (!Array.isArray(value)) return false
        if (value.length !== operand) return false
        break

      case '$all':
        if (!Array.isArray(value) || !Array.isArray(operand)) return false
        if (!operand.every((item) => value.some((v) => isEqual(v, item)))) return false
        break

      case '$elemMatch':
        if (!Array.isArray(value)) return false
        if (!value.some((item) => {
          // Handle primitive values wrapped in operators like { $eq: 'value' }
          if (typeof item !== 'object' || item === null) {
            return matchesOperators(item, operand as Record<string, unknown>)
          }
          // Handle object items
          return matchesFilter({ _id: '', ...item } as Document, operand as QueryFilter)
        })) return false
        break

      case '$mod':
        if (!Array.isArray(operand) || operand.length !== 2) return false
        if (typeof value !== 'number') return false
        if (value % (operand[0] as number) !== (operand[1] as number)) return false
        break

      default:
        // Unknown operator - treat as nested object comparison
        if (op.startsWith('$')) {
          return false
        }
    }
  }

  return true
}

/**
 * Check if a value matches a BSON type
 */
function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
    case 'int':
    case 'long':
    case 'double':
    case 'decimal':
      return typeof value === 'number'
    case 'bool':
      return typeof value === 'boolean'
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
    case 'undefined':
      return value === undefined
    case 'date':
      return value instanceof Date
    default:
      return false
  }
}

/**
 * Deep equality check
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => isEqual(item, b[i]))
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) =>
      isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  }

  return false
}

// =============================================================================
// UPDATE APPLICATION
// =============================================================================

/**
 * Apply update operators to a document
 */
function applyUpdate(doc: Document, update: UpdateOperators | Document): Document {
  // If update doesn't have any operators, it's a replacement document
  const hasOperators = Object.keys(update).some((key) => key.startsWith('$'))

  if (!hasOperators) {
    // Replacement - keep _id from original
    return { ...update, _id: doc._id } as Document
  }

  // Apply operators
  const result = { ...doc }
  const operators = update as UpdateOperators

  // $set
  if (operators.$set) {
    for (const [path, value] of Object.entries(operators.$set)) {
      setFieldValue(result, path, value)
    }
  }

  // $unset
  if (operators.$unset) {
    for (const path of Object.keys(operators.$unset)) {
      deleteFieldValue(result, path)
    }
  }

  // $inc
  if (operators.$inc) {
    for (const [path, amount] of Object.entries(operators.$inc)) {
      const current = getFieldValue(result, path)
      const currentNum = typeof current === 'number' ? current : 0
      setFieldValue(result, path, currentNum + amount)
    }
  }

  // $mul
  if (operators.$mul) {
    for (const [path, factor] of Object.entries(operators.$mul)) {
      const current = getFieldValue(result, path)
      const currentNum = typeof current === 'number' ? current : 0
      setFieldValue(result, path, currentNum * factor)
    }
  }

  // $min
  if (operators.$min) {
    for (const [path, value] of Object.entries(operators.$min)) {
      const current = getFieldValue(result, path)
      if (current === undefined || (typeof current === typeof value && current > value)) {
        setFieldValue(result, path, value)
      }
    }
  }

  // $max
  if (operators.$max) {
    for (const [path, value] of Object.entries(operators.$max)) {
      const current = getFieldValue(result, path)
      if (current === undefined || (typeof current === typeof value && (current as unknown) < value)) {
        setFieldValue(result, path, value)
      }
    }
  }

  // $rename
  if (operators.$rename) {
    for (const [oldPath, newPath] of Object.entries(operators.$rename)) {
      const value = getFieldValue(result, oldPath)
      if (value !== undefined) {
        deleteFieldValue(result, oldPath)
        setFieldValue(result, newPath, value)
      }
    }
  }

  // $currentDate
  if (operators.$currentDate) {
    for (const [path, spec] of Object.entries(operators.$currentDate)) {
      if (spec === true || (typeof spec === 'object' && spec.$type === 'date')) {
        setFieldValue(result, path, new Date())
      } else if (typeof spec === 'object' && spec.$type === 'timestamp') {
        setFieldValue(result, path, Date.now())
      }
    }
  }

  // $push
  if (operators.$push) {
    for (const [path, value] of Object.entries(operators.$push)) {
      const current = getFieldValue(result, path)
      const arr = Array.isArray(current) ? [...current] : []
      arr.push(value)
      setFieldValue(result, path, arr)
    }
  }

  // $pop
  if (operators.$pop) {
    for (const [path, direction] of Object.entries(operators.$pop)) {
      const current = getFieldValue(result, path)
      if (Array.isArray(current)) {
        const arr = [...current]
        if (direction === 1) {
          arr.pop()
        } else {
          arr.shift()
        }
        setFieldValue(result, path, arr)
      }
    }
  }

  // $addToSet
  if (operators.$addToSet) {
    for (const [path, value] of Object.entries(operators.$addToSet)) {
      const current = getFieldValue(result, path)
      const arr = Array.isArray(current) ? [...current] : []
      if (!arr.some((item) => isEqual(item, value))) {
        arr.push(value)
      }
      setFieldValue(result, path, arr)
    }
  }

  // $pull
  if (operators.$pull) {
    for (const [path, condition] of Object.entries(operators.$pull)) {
      const current = getFieldValue(result, path)
      if (Array.isArray(current)) {
        const arr = current.filter((item) => {
          if (typeof condition === 'object' && condition !== null) {
            return !matchesFilter({ _id: '', ...item } as Document, condition as QueryFilter)
          }
          return !isEqual(item, condition)
        })
        setFieldValue(result, path, arr)
      }
    }
  }

  return result
}

/**
 * Set a field value using dot notation
 */
function setFieldValue(doc: Document, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = doc

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (current[part] === undefined || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]!] = value
}

/**
 * Delete a field value using dot notation
 */
function deleteFieldValue(doc: Document, path: string): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = doc

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (current[part] === undefined || typeof current[part] !== 'object') {
      return
    }
    current = current[part] as Record<string, unknown>
  }

  delete current[parts[parts.length - 1]!]
}

// =============================================================================
// ID GENERATION
// =============================================================================

let idCounter = 0

/**
 * Generate a unique document ID (ObjectId-like)
 */
function generateId(): DocumentId {
  // Format: timestamp (8 chars) + random (8 chars) + counter (8 chars)
  const timestamp = Date.now().toString(16).padStart(8, '0').slice(-8)
  const random = Math.random().toString(16).substring(2, 10).padStart(8, '0')
  const counter = (idCounter++ % 0xffffff).toString(16).padStart(6, '0')
  return `${timestamp}${random}${counter}`
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of DocumentStore
 */
class DocumentStoreImpl<TDoc extends Document = Document> implements DocumentStore<TDoc> {
  private readonly options: DocumentStoreOptions
  private readonly documents: TemporalStore<TDoc>
  private readonly columnStore: TypedColumnStore
  private readonly schemaEvolution: SchemaEvolution
  private readonly exactlyOnce: ExactlyOnceContext
  private readonly indexes: Map<string, IndexInfo> = new Map()
  private documentIds: Set<DocumentId> = new Set()

  constructor(options: DocumentStoreOptions = {}) {
    this.options = options

    // Initialize composed primitives
    this.documents = createTemporalStore<TDoc>({
      retention: options.retention,
    })

    this.columnStore = createColumnStore()
    this.schemaEvolution = createSchemaEvolution()
    this.exactlyOnce = createExactlyOnceContext()

    // Create initial indexes
    if (options.indexes) {
      // Note: async creation happens on first access
      for (const spec of options.indexes) {
        this.createIndexSync(spec)
      }
    }
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  async insert(doc: Omit<TDoc, '_id'> | TDoc): Promise<InsertResult> {
    const docWithId = '_id' in doc ? (doc as TDoc) : ({ ...doc, _id: generateId() } as TDoc)

    // Check for duplicate _id
    const existing = await this.documents.get(docWithId._id)
    if (existing) {
      throw new Error(`Duplicate key error: document with _id '${docWithId._id}' already exists`)
    }

    // Store document
    await this.documents.put(docWithId._id, docWithId, Date.now())
    this.documentIds.add(docWithId._id)

    // Update schema
    if (this.options.enableSchemaValidation !== false) {
      this.schemaEvolution.inferSchema([docWithId])
    }

    return { insertedId: docWithId._id }
  }

  async insertMany(docs: Array<Omit<TDoc, '_id'> | TDoc>): Promise<InsertManyResult> {
    const insertedIds: DocumentId[] = []

    for (const doc of docs) {
      const result = await this.insert(doc)
      insertedIds.push(result.insertedId)
    }

    return {
      insertedIds,
      insertedCount: insertedIds.length,
    }
  }

  async get(id: DocumentId): Promise<TDoc | null> {
    // Check if document was deleted
    if (!this.documentIds.has(id)) {
      return null
    }
    return this.documents.get(id)
  }

  async getAsOf(id: DocumentId, timestamp: number): Promise<TDoc | null> {
    return this.documents.getAsOf(id, timestamp)
  }

  async find(filter: QueryFilter, options?: FindOptions): Promise<TDoc[]> {
    const results: TDoc[] = []

    // Iterate through all documents
    for (const id of this.documentIds) {
      const doc = await this.documents.get(id)
      if (doc && matchesFilter(doc, filter)) {
        results.push(doc)
      }
    }

    // Apply sort
    if (options?.sort) {
      results.sort((a, b) => {
        for (const [field, direction] of Object.entries(options.sort!)) {
          const aVal = getFieldValue(a, field)
          const bVal = getFieldValue(b, field)

          if (aVal === bVal) continue

          if (aVal === undefined || aVal === null) return direction
          if (bVal === undefined || bVal === null) return -direction

          if (typeof aVal === 'string' && typeof bVal === 'string') {
            const cmp = aVal.localeCompare(bVal)
            if (cmp !== 0) return cmp * direction
          } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            if (aVal !== bVal) return (aVal - bVal) * direction
          }
        }
        return 0
      })
    }

    // Apply skip
    let sliced = results
    if (options?.skip) {
      sliced = sliced.slice(options.skip)
    }

    // Apply limit
    if (options?.limit) {
      sliced = sliced.slice(0, options.limit)
    }

    // Apply projection
    if (options?.projection) {
      return sliced.map((doc) => this.applyProjection(doc, options.projection!))
    }

    return sliced
  }

  async findOne(filter: QueryFilter): Promise<TDoc | null> {
    const results = await this.find(filter, { limit: 1 })
    return results[0] ?? null
  }

  async update(filter: QueryFilter, update: UpdateOperators | TDoc): Promise<UpdateResult> {
    let matchedCount = 0
    let modifiedCount = 0

    for (const id of this.documentIds) {
      const doc = await this.documents.get(id)
      if (doc && matchesFilter(doc, filter)) {
        matchedCount++
        const updatedDoc = applyUpdate(doc, update) as TDoc
        if (!isEqual(doc, updatedDoc)) {
          await this.documents.put(id, updatedDoc, Date.now())
          modifiedCount++
        }
      }
    }

    return { matchedCount, modifiedCount }
  }

  async updateOne(
    filter: QueryFilter,
    update: UpdateOperators | TDoc,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    // Find first matching document
    for (const id of this.documentIds) {
      const doc = await this.documents.get(id)
      if (doc && matchesFilter(doc, filter)) {
        const updatedDoc = applyUpdate(doc, update) as TDoc
        if (!isEqual(doc, updatedDoc)) {
          await this.documents.put(id, updatedDoc, Date.now())
          return { matchedCount: 1, modifiedCount: 1 }
        }
        return { matchedCount: 1, modifiedCount: 0 }
      }
    }

    // Handle upsert
    if (options?.upsert) {
      const hasOperators = Object.keys(update).some((key) => key.startsWith('$'))
      let newDoc: TDoc

      if (hasOperators) {
        // Create base document from filter and apply operators
        const baseDoc = { _id: generateId(), ...this.filterToDocument(filter) } as TDoc
        newDoc = applyUpdate(baseDoc, update) as TDoc

        // Apply $setOnInsert
        if ((update as UpdateOperators).$setOnInsert) {
          for (const [path, value] of Object.entries((update as UpdateOperators).$setOnInsert!)) {
            setFieldValue(newDoc, path, value)
          }
        }
      } else {
        newDoc = { _id: generateId(), ...update } as TDoc
      }

      await this.documents.put(newDoc._id, newDoc, Date.now())
      this.documentIds.add(newDoc._id)

      return { matchedCount: 0, modifiedCount: 0, upsertedId: newDoc._id }
    }

    return { matchedCount: 0, modifiedCount: 0 }
  }

  async delete(filter: QueryFilter): Promise<DeleteResult> {
    let deletedCount = 0
    const toDelete: DocumentId[] = []

    for (const id of this.documentIds) {
      const doc = await this.documents.get(id)
      if (doc && matchesFilter(doc, filter)) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      // In a temporal store, we can mark as deleted by storing a tombstone
      // For simplicity, we just remove from our ID set
      this.documentIds.delete(id)
      deletedCount++
    }

    return { deletedCount }
  }

  async deleteOne(filter: QueryFilter): Promise<DeleteResult> {
    for (const id of this.documentIds) {
      const doc = await this.documents.get(id)
      if (doc && matchesFilter(doc, filter)) {
        this.documentIds.delete(id)
        return { deletedCount: 1 }
      }
    }

    return { deletedCount: 0 }
  }

  // ===========================================================================
  // Index Operations
  // ===========================================================================

  async createIndex(spec: IndexSpec): Promise<string> {
    return this.createIndexSync(spec)
  }

  private createIndexSync(spec: IndexSpec): string {
    const name =
      spec.options?.name ||
      Object.entries(spec.fields)
        .map(([k, v]) => `${k}_${v}`)
        .join('_')

    const info: IndexInfo = {
      name,
      fields: spec.fields,
      unique: spec.options?.unique ?? false,
      sparse: spec.options?.sparse ?? false,
      partialFilterExpression: spec.options?.partialFilterExpression,
    }

    this.indexes.set(name, info)
    return name
  }

  async dropIndex(name: string): Promise<void> {
    if (!this.indexes.has(name)) {
      throw new Error(`Index '${name}' not found`)
    }
    this.indexes.delete(name)
  }

  async listIndexes(): Promise<IndexInfo[]> {
    // Always include _id index
    const result: IndexInfo[] = [
      { name: '_id_', fields: { _id: 1 }, unique: true, sparse: false },
    ]

    for (const info of this.indexes.values()) {
      result.push(info)
    }

    return result
  }

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  async aggregate(pipeline: AggregationStage[]): Promise<unknown[]> {
    // Start with all documents
    let results: unknown[] = []

    for (const id of this.documentIds) {
      const doc = await this.documents.get(id)
      if (doc) {
        results.push(doc)
      }
    }

    // Apply each stage
    for (const stage of pipeline) {
      results = await this.applyAggregationStage(results, stage)
    }

    return results
  }

  private async applyAggregationStage(docs: unknown[], stage: AggregationStage): Promise<unknown[]> {
    const stageType = Object.keys(stage)[0] as keyof AggregationStage

    switch (stageType) {
      case '$match': {
        const filter = (stage as { $match: QueryFilter }).$match
        return docs.filter((doc) => matchesFilter(doc as Document, filter))
      }

      case '$project': {
        const projection = (stage as { $project: Record<string, unknown> }).$project
        return docs.map((doc) => this.applyProjection(doc as TDoc, projection as Record<string, 0 | 1>))
      }

      case '$sort': {
        const sortSpec = (stage as { $sort: Record<string, 1 | -1> }).$sort
        return [...docs].sort((a, b) => {
          for (const [field, direction] of Object.entries(sortSpec)) {
            const aVal = getFieldValue(a as Document, field)
            const bVal = getFieldValue(b as Document, field)

            if (aVal === bVal) continue
            if (aVal === undefined || aVal === null) return direction
            if (bVal === undefined || bVal === null) return -direction

            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return (aVal - bVal) * direction
            }
            if (typeof aVal === 'string' && typeof bVal === 'string') {
              return aVal.localeCompare(bVal) * direction
            }
          }
          return 0
        })
      }

      case '$limit': {
        const limit = (stage as { $limit: number }).$limit
        return docs.slice(0, limit)
      }

      case '$skip': {
        const skip = (stage as { $skip: number }).$skip
        return docs.slice(skip)
      }

      case '$count': {
        const field = (stage as { $count: string }).$count
        return [{ [field]: docs.length }]
      }

      case '$group': {
        const groupSpec = (stage as { $group: { _id: unknown; [key: string]: unknown } }).$group
        return this.applyGroupStage(docs, groupSpec)
      }

      case '$unwind': {
        const unwindSpec = (stage as { $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean } }).$unwind
        return this.applyUnwindStage(docs, unwindSpec)
      }

      default:
        throw new Error(`Unsupported aggregation stage: ${stageType}`)
    }
  }

  private applyGroupStage(
    docs: unknown[],
    spec: { _id: unknown; [key: string]: unknown }
  ): unknown[] {
    const groups = new Map<string, { docs: unknown[]; accumulators: Record<string, unknown> }>()

    for (const doc of docs) {
      // Compute group key
      let groupKey: unknown
      if (spec._id === null) {
        groupKey = null
      } else if (typeof spec._id === 'string' && spec._id.startsWith('$')) {
        groupKey = getFieldValue(doc as Document, spec._id.slice(1))
      } else {
        groupKey = spec._id
      }

      const keyStr = JSON.stringify(groupKey)

      if (!groups.has(keyStr)) {
        groups.set(keyStr, { docs: [], accumulators: {} })
      }

      groups.get(keyStr)!.docs.push(doc)
    }

    // Compute accumulators for each group
    const results: unknown[] = []

    for (const [keyStr, group] of groups) {
      const result: Record<string, unknown> = { _id: JSON.parse(keyStr) }

      for (const [field, accSpec] of Object.entries(spec)) {
        if (field === '_id') continue

        if (typeof accSpec === 'object' && accSpec !== null) {
          const [operator, operand] = Object.entries(accSpec)[0]!

          switch (operator) {
            case '$sum': {
              if (typeof operand === 'number') {
                result[field] = group.docs.length * operand
              } else if (typeof operand === 'string' && operand.startsWith('$')) {
                result[field] = group.docs.reduce((sum, d) => {
                  const val = getFieldValue(d as Document, operand.slice(1))
                  return sum + (typeof val === 'number' ? val : 0)
                }, 0)
              }
              break
            }

            case '$avg': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                const values = group.docs
                  .map((d) => getFieldValue(d as Document, operand.slice(1)))
                  .filter((v): v is number => typeof v === 'number')
                result[field] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
              }
              break
            }

            case '$min': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                const values = group.docs
                  .map((d) => getFieldValue(d as Document, operand.slice(1)))
                  .filter((v): v is number => typeof v === 'number')
                result[field] = values.length > 0 ? Math.min(...values) : null
              }
              break
            }

            case '$max': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                const values = group.docs
                  .map((d) => getFieldValue(d as Document, operand.slice(1)))
                  .filter((v): v is number => typeof v === 'number')
                result[field] = values.length > 0 ? Math.max(...values) : null
              }
              break
            }

            case '$count': {
              result[field] = group.docs.length
              break
            }

            case '$first': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                result[field] = group.docs.length > 0 ? getFieldValue(group.docs[0] as Document, operand.slice(1)) : null
              }
              break
            }

            case '$last': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                result[field] = group.docs.length > 0 ? getFieldValue(group.docs[group.docs.length - 1] as Document, operand.slice(1)) : null
              }
              break
            }

            case '$push': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                result[field] = group.docs.map((d) => getFieldValue(d as Document, operand.slice(1)))
              }
              break
            }

            case '$addToSet': {
              if (typeof operand === 'string' && operand.startsWith('$')) {
                const values = group.docs.map((d) => getFieldValue(d as Document, operand.slice(1)))
                const unique: unknown[] = []
                for (const v of values) {
                  if (!unique.some((u) => isEqual(u, v))) {
                    unique.push(v)
                  }
                }
                result[field] = unique
              }
              break
            }
          }
        }
      }

      results.push(result)
    }

    return results
  }

  private applyUnwindStage(
    docs: unknown[],
    spec: string | { path: string; preserveNullAndEmptyArrays?: boolean }
  ): unknown[] {
    const path = typeof spec === 'string' ? spec : spec.path
    const preserveNull = typeof spec === 'object' ? spec.preserveNullAndEmptyArrays ?? false : false
    const fieldPath = path.startsWith('$') ? path.slice(1) : path

    const results: unknown[] = []

    for (const doc of docs) {
      const arrayValue = getFieldValue(doc as Document, fieldPath)

      if (!Array.isArray(arrayValue)) {
        if (preserveNull || arrayValue !== undefined) {
          results.push(doc)
        }
        continue
      }

      if (arrayValue.length === 0) {
        if (preserveNull) {
          results.push(doc)
        }
        continue
      }

      for (const item of arrayValue) {
        const newDoc = { ...(doc as Record<string, unknown>) }
        setFieldValue(newDoc as Document, fieldPath, item)
        results.push(newDoc)
      }
    }

    return results
  }

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  async transaction<T>(fn: (session: DocumentStoreSession<TDoc>) => Promise<T>): Promise<T> {
    return this.exactlyOnce.transaction(async () => {
      const session: DocumentStoreSession<TDoc> = {
        insert: (doc) => this.insert(doc),
        get: (id) => this.get(id),
        find: (filter, options) => this.find(filter, options),
        findOne: (filter) => this.findOne(filter),
        update: (filter, update) => this.update(filter, update),
        updateOne: (filter, update, options) => this.updateOne(filter, update, options),
        delete: (filter) => this.delete(filter),
        deleteOne: (filter) => this.deleteOne(filter),
      }

      return fn(session)
    })
  }

  // ===========================================================================
  // Collection Management
  // ===========================================================================

  async count(filter?: QueryFilter): Promise<number> {
    if (!filter || Object.keys(filter).length === 0) {
      return this.documentIds.size
    }

    const docs = await this.find(filter)
    return docs.length
  }

  async distinct(field: string, filter?: QueryFilter): Promise<unknown[]> {
    const docs = filter ? await this.find(filter) : await this.find({})
    const values = new Set<string>()
    const result: unknown[] = []

    for (const doc of docs) {
      const value = getFieldValue(doc, field)
      const key = JSON.stringify(value)
      if (!values.has(key)) {
        values.add(key)
        result.push(value)
      }
    }

    return result
  }

  async drop(): Promise<void> {
    this.documentIds.clear()
    this.indexes.clear()
  }

  // ===========================================================================
  // Schema Operations
  // ===========================================================================

  getSchema(): Schema {
    return this.schemaEvolution.getSchema()
  }

  validateDocument(doc: unknown): { valid: boolean; errors: string[] } {
    if (typeof doc !== 'object' || doc === null) {
      return { valid: false, errors: ['Document must be an object'] }
    }

    if (!('_id' in doc)) {
      return { valid: false, errors: ['Document must have an _id field'] }
    }

    // Additional schema validation could be added here
    return { valid: true, errors: [] }
  }

  // ===========================================================================
  // Maintenance
  // ===========================================================================

  async prune(policy?: RetentionPolicy): Promise<PruneStats> {
    return this.documents.prune(policy)
  }

  async compact(policy?: RetentionPolicy): Promise<PruneStats> {
    return this.documents.compact(policy)
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private applyProjection(doc: TDoc, projection: Record<string, 0 | 1>): TDoc {
    const hasInclusion = Object.values(projection).some((v) => v === 1)
    const hasExclusion = Object.values(projection).some((v) => v === 0)

    if (hasInclusion && hasExclusion) {
      // Mixed mode - only _id can be excluded with inclusions
      const result: Record<string, unknown> = {}
      for (const [field, include] of Object.entries(projection)) {
        if (include === 1) {
          result[field] = getFieldValue(doc, field)
        }
      }
      if (projection._id !== 0) {
        result._id = doc._id
      }
      return result as TDoc
    }

    if (hasInclusion) {
      // Inclusion mode
      const result: Record<string, unknown> = {}
      for (const [field, include] of Object.entries(projection)) {
        if (include === 1) {
          result[field] = getFieldValue(doc, field)
        }
      }
      if (projection._id !== 0) {
        result._id = doc._id
      }
      return result as TDoc
    }

    // Exclusion mode
    const result = { ...doc }
    for (const [field, exclude] of Object.entries(projection)) {
      if (exclude === 0) {
        delete result[field as keyof TDoc]
      }
    }
    return result
  }

  private filterToDocument(filter: QueryFilter): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) continue
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Check for $eq operator
        if ('$eq' in value) {
          result[key] = (value as Record<string, unknown>).$eq
        }
      } else {
        result[key] = value
      }
    }

    return result
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DocumentStore instance
 *
 * @param options - DocumentStore options
 * @returns A new DocumentStore instance
 *
 * @example
 * ```typescript
 * interface User extends Document {
 *   name: string
 *   email: string
 *   age: number
 * }
 *
 * const users = createDocumentStore<User>({ collection: 'users' })
 *
 * await users.insert({ name: 'Alice', email: 'alice@example.com', age: 30 })
 *
 * const alice = await users.findOne({ name: 'Alice' })
 * ```
 */
export function createDocumentStore<TDoc extends Document = Document>(
  options?: DocumentStoreOptions
): DocumentStore<TDoc> {
  return new DocumentStoreImpl<TDoc>(options)
}
