/**
 * @dotdo/mongo - MongoDB SDK compat
 *
 * Drop-in replacement for mongodb driver backed by DO SQLite with JSON storage.
 * This in-memory implementation matches the MongoDB Node.js driver API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://mongodb.github.io/node-mongodb-native/
 */
import type {
  MongoClient as IMongoClient,
  Db as IDb,
  Collection as ICollection,
  Document,
  Filter,
  UpdateFilter,
  FindOptions,
  FindCursor as IFindCursor,
  AggregationCursor as IAggregationCursor,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  BulkWriteResult,
  IndexSpecification,
  IndexInfo,
  CreateIndexesOptions,
  WithId,
  OptionalId,
  MongoClientOptions,
  ExtendedMongoClientOptions,
  PipelineStage,
  Projection,
  Sort,
  SortDirection,
  UpdateOptions,
  DeleteOptions,
  InsertOneOptions,
  InsertManyOptions,
  CountDocumentsOptions,
  EstimatedDocumentCountOptions,
  DistinctOptions,
  AggregateOptions,
  FindOneAndUpdateOptions,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  ClientSession as IClientSession,
  SessionOptions,
  TransactionOptions,
  CollStats,
  DbStats,
  CollectionInfo,
  ListCollectionsCursor as IListCollectionsCursor,
  CreateCollectionOptions,
  ListCollectionsOptions,
  ChangeStream as IChangeStream,
  ChangeStreamOptions,
  ChangeStreamDocument,
  Admin as IAdmin,
  ListDatabasesResult,
} from './types'
import {
  ObjectId,
  MongoError,
  MongoServerError,
  MongoDuplicateKeyError,
} from './types'

// Re-export types and classes from types.ts
export { ObjectId } from './types'
export {
  MongoError,
  MongoServerError,
  MongoDriverError,
  MongoNetworkError,
  MongoTimeoutError,
  MongoWriteConcernError,
  MongoBulkWriteError,
  MongoDuplicateKeyError,
} from './types'
export {
  Binary,
  Timestamp,
  Long,
  Decimal128,
  UUID,
  MinKey,
  MaxKey,
  Code,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Global in-memory storage for all databases
 * Structure: Map<dbName, Map<collectionName, Document[]>>
 */
const globalStorage = new Map<string, Map<string, Document[]>>()

/**
 * Global index storage
 * Structure: Map<namespace, IndexInfo[]>
 */
const globalIndexes = new Map<string, IndexInfo[]>()

/**
 * Get or create a database storage
 */
function getDbStorage(dbName: string): Map<string, Document[]> {
  let db = globalStorage.get(dbName)
  if (!db) {
    db = new Map()
    globalStorage.set(dbName, db)
  }
  return db
}

/**
 * Get or create a collection storage
 */
function getCollectionStorage(dbName: string, collName: string): Document[] {
  const db = getDbStorage(dbName)
  let coll = db.get(collName)
  if (!coll) {
    coll = []
    db.set(collName, coll)
  }
  return coll
}

/**
 * Get namespace string
 */
function getNamespace(dbName: string, collName: string): string {
  return `${dbName}.${collName}`
}

// ============================================================================
// FILTER MATCHING
// ============================================================================

/**
 * Get nested value from document using dot notation
 */
function getNestedValue(doc: Document, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = doc
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Document)[part]
  }
  return current
}

/**
 * Set nested value in document using dot notation
 */
function setNestedValue(doc: Document, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: Document = doc
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Document
  }
  current[parts[parts.length - 1]] = value
}

/**
 * Delete nested value from document using dot notation
 */
function deleteNestedValue(doc: Document, path: string): void {
  const parts = path.split('.')
  let current: Document = doc
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined) return
    current = current[part] as Document
  }
  delete current[parts[parts.length - 1]]
}

/**
 * Compare two values for sorting
 */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (a instanceof ObjectId && b instanceof ObjectId) {
    return a.toHexString().localeCompare(b.toHexString())
  }
  return String(a).localeCompare(String(b))
}

/**
 * Check if a value matches a filter condition
 */
function matchesCondition(value: unknown, condition: unknown): boolean {
  // Direct equality
  if (condition === null) {
    return value === null || value === undefined
  }

  if (condition instanceof ObjectId) {
    if (value instanceof ObjectId) {
      return condition.equals(value)
    }
    if (typeof value === 'string') {
      return condition.equals(value)
    }
    return false
  }

  if (condition instanceof RegExp) {
    return typeof value === 'string' && condition.test(value)
  }

  // Array membership check (for querying arrays)
  if (Array.isArray(value) && !Array.isArray(condition) && typeof condition !== 'object') {
    return value.includes(condition)
  }

  // Operator object
  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    const ops = condition as Record<string, unknown>

    for (const [op, opValue] of Object.entries(ops)) {
      if (!op.startsWith('$')) {
        // Not an operator, check equality
        continue
      }

      switch (op) {
        case '$eq':
          if (!matchesCondition(value, opValue)) return false
          break
        case '$ne':
          if (matchesCondition(value, opValue)) return false
          break
        case '$gt':
          if (compareValues(value, opValue) <= 0) return false
          break
        case '$gte':
          if (compareValues(value, opValue) < 0) return false
          break
        case '$lt':
          if (compareValues(value, opValue) >= 0) return false
          break
        case '$lte':
          if (compareValues(value, opValue) > 0) return false
          break
        case '$in':
          if (!Array.isArray(opValue)) return false
          if (Array.isArray(value)) {
            // Check if any element of value array is in opValue
            if (!value.some(v => opValue.some(ov => matchesCondition(v, ov)))) return false
          } else {
            if (!opValue.some(v => matchesCondition(value, v))) return false
          }
          break
        case '$nin':
          if (!Array.isArray(opValue)) return false
          if (Array.isArray(value)) {
            if (value.some(v => opValue.some(ov => matchesCondition(v, ov)))) return false
          } else {
            if (opValue.some(v => matchesCondition(value, v))) return false
          }
          break
        case '$exists':
          const exists = value !== undefined
          if (opValue !== exists) return false
          break
        case '$type':
          const valueType = getValueType(value)
          if (typeof opValue === 'string' && valueType !== opValue) return false
          break
        case '$regex': {
          if (typeof value !== 'string') return false
          const options = (ops.$options as string) || ''
          const regex = opValue instanceof RegExp ? opValue : new RegExp(opValue as string, options)
          if (!regex.test(value)) return false
          break
        }
        case '$options':
          // Handled with $regex
          break
        case '$size':
          if (!Array.isArray(value) || value.length !== opValue) return false
          break
        case '$all':
          if (!Array.isArray(value) || !Array.isArray(opValue)) return false
          if (!opValue.every(v => value.some(ve => matchesCondition(ve, v)))) return false
          break
        case '$elemMatch':
          if (!Array.isArray(value)) return false
          // For primitive arrays, the elemMatch condition applies to each element directly
          // For document arrays, matchesFilter is used
          if (!value.some(v => {
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              return matchesFilter(v as Document, opValue as Filter<Document>)
            }
            // For primitives, treat the condition as operators on the value itself
            return matchesCondition(v, opValue)
          })) return false
          break
        case '$not':
          if (matchesCondition(value, opValue)) return false
          break
        default:
          // Unknown operator - ignore
          break
      }
    }

    // Check if there are non-operator keys (nested equality)
    const hasNonOperatorKeys = Object.keys(ops).some(k => !k.startsWith('$'))
    if (hasNonOperatorKeys) {
      return deepEquals(value, condition)
    }

    return true
  }

  // Direct equality for primitives
  return deepEquals(value, condition)
}

/**
 * Get the BSON type string of a value
 */
function getValueType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'bool'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (value instanceof ObjectId) return 'objectId'
  if (value instanceof RegExp) return 'regex'
  if (typeof value === 'object') return 'object'
  return 'unknown'
}

/**
 * Deep equality check
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (a === undefined || b === undefined) return a === b

  if (a instanceof ObjectId && b instanceof ObjectId) {
    return a.equals(b)
  }
  if (a instanceof ObjectId && typeof b === 'string') {
    return a.equals(b)
  }
  if (typeof a === 'string' && b instanceof ObjectId) {
    return b.equals(a)
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEquals(v, b[i]))
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object)
    const keysB = Object.keys(b as object)
    if (keysA.length !== keysB.length) return false
    return keysA.every(key => deepEquals((a as Document)[key], (b as Document)[key]))
  }

  return false
}

/**
 * Check if a document matches a filter
 */
function matchesFilter(doc: Document, filter: Filter<Document>): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true
  }

  for (const [key, condition] of Object.entries(filter)) {
    // Logical operators at root level
    if (key === '$and') {
      const conditions = condition as Filter<Document>[]
      if (!conditions.every(c => matchesFilter(doc, c))) return false
      continue
    }
    if (key === '$or') {
      const conditions = condition as Filter<Document>[]
      if (!conditions.some(c => matchesFilter(doc, c))) return false
      continue
    }
    if (key === '$nor') {
      const conditions = condition as Filter<Document>[]
      if (conditions.some(c => matchesFilter(doc, c))) return false
      continue
    }
    if (key === '$not') {
      if (matchesFilter(doc, condition as Filter<Document>)) return false
      continue
    }

    // Field condition
    const value = getNestedValue(doc, key)
    if (!matchesCondition(value, condition)) {
      return false
    }
  }

  return true
}

// ============================================================================
// UPDATE OPERATIONS
// ============================================================================

/**
 * Apply update operators to a document
 * Returns the modified document (mutates in place)
 */
function applyUpdate(doc: Document, update: UpdateFilter<Document>): Document {
  // $set
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      setNestedValue(doc, key, value)
    }
  }

  // $unset
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      deleteNestedValue(doc, key)
    }
  }

  // $inc
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) {
      const current = getNestedValue(doc, key)
      const currentNum = typeof current === 'number' ? current : 0
      setNestedValue(doc, key, currentNum + (amount as number))
    }
  }

  // $mul
  if (update.$mul) {
    for (const [key, amount] of Object.entries(update.$mul)) {
      const current = getNestedValue(doc, key)
      const currentNum = typeof current === 'number' ? current : 0
      setNestedValue(doc, key, currentNum * (amount as number))
    }
  }

  // $min
  if (update.$min) {
    for (const [key, value] of Object.entries(update.$min)) {
      const current = getNestedValue(doc, key)
      if (current === undefined || compareValues(value, current) < 0) {
        setNestedValue(doc, key, value)
      }
    }
  }

  // $max
  if (update.$max) {
    for (const [key, value] of Object.entries(update.$max)) {
      const current = getNestedValue(doc, key)
      if (current === undefined || compareValues(value, current) > 0) {
        setNestedValue(doc, key, value)
      }
    }
  }

  // $push
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push)) {
      let current = getNestedValue(doc, key) as unknown[]
      if (!Array.isArray(current)) {
        current = []
        setNestedValue(doc, key, current)
      }

      if (typeof value === 'object' && value !== null && '$each' in value) {
        const each = value.$each as unknown[]
        const position = (value as { $position?: number }).$position
        if (position !== undefined) {
          current.splice(position, 0, ...each)
        } else {
          current.push(...each)
        }
      } else {
        current.push(value)
      }
    }
  }

  // $pull
  if (update.$pull) {
    for (const [key, condition] of Object.entries(update.$pull)) {
      const current = getNestedValue(doc, key)
      if (Array.isArray(current)) {
        const filtered = current.filter(item => {
          if (typeof condition === 'object' && condition !== null) {
            return !matchesFilter(item as Document, condition as Filter<Document>)
          }
          return !deepEquals(item, condition)
        })
        setNestedValue(doc, key, filtered)
      }
    }
  }

  // $addToSet
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet)) {
      let current = getNestedValue(doc, key) as unknown[]
      if (!Array.isArray(current)) {
        current = []
        setNestedValue(doc, key, current)
      }

      if (typeof value === 'object' && value !== null && '$each' in value) {
        const each = value.$each as unknown[]
        for (const item of each) {
          if (!current.some(existing => deepEquals(existing, item))) {
            current.push(item)
          }
        }
      } else {
        if (!current.some(existing => deepEquals(existing, value))) {
          current.push(value)
        }
      }
    }
  }

  // $pop
  if (update.$pop) {
    for (const [key, direction] of Object.entries(update.$pop)) {
      const current = getNestedValue(doc, key)
      if (Array.isArray(current)) {
        if (direction === 1) {
          current.pop()
        } else if (direction === -1) {
          current.shift()
        }
      }
    }
  }

  // $rename
  if (update.$rename) {
    for (const [oldKey, newKey] of Object.entries(update.$rename)) {
      const value = getNestedValue(doc, oldKey)
      if (value !== undefined) {
        deleteNestedValue(doc, oldKey)
        setNestedValue(doc, newKey, value)
      }
    }
  }

  return doc
}

/**
 * Apply positional update (scores.$ notation)
 */
function applyPositionalUpdate(
  doc: Document,
  update: UpdateFilter<Document>,
  filter: Filter<Document>
): Document {
  // Find the matched array element position
  for (const [key, condition] of Object.entries(filter)) {
    if (key.startsWith('$')) continue

    const value = getNestedValue(doc, key)
    if (Array.isArray(value)) {
      const index = value.findIndex(item => matchesCondition(item, condition))
      if (index >= 0) {
        // Replace $ with the index in update operators
        const modifiedUpdate = JSON.parse(
          JSON.stringify(update).replace(/\.\$/g, `.${index}`)
        )
        return applyUpdate(doc, modifiedUpdate)
      }
    }
  }

  return applyUpdate(doc, update)
}

// ============================================================================
// PROJECTION
// ============================================================================

/**
 * Apply projection to a document
 */
function applyProjection(doc: WithId<Document>, projection: Projection<Document>): WithId<Document> {
  if (!projection || Object.keys(projection).length === 0) {
    return doc
  }

  const entries = Object.entries(projection)
  const hasInclusion = entries.some(([k, v]) => v === 1 || v === true)
  const hasExclusion = entries.some(([k, v]) => (v === 0 || v === false) && k !== '_id')

  const result: Document = {}

  if (hasInclusion && !hasExclusion) {
    // Inclusion mode - only include specified fields
    for (const [key, include] of entries) {
      if (include === 1 || include === true) {
        const value = getNestedValue(doc, key)
        if (value !== undefined) {
          setNestedValue(result, key, value)
        }
      }
    }
    // Always include _id unless explicitly excluded
    if (projection._id !== 0 && projection._id !== false) {
      result._id = doc._id
    }
  } else {
    // Exclusion mode - copy all fields except excluded ones
    const deepCopy = JSON.parse(JSON.stringify(doc))
    Object.assign(result, deepCopy)
    for (const [key, exclude] of entries) {
      if (exclude === 0 || exclude === false) {
        deleteNestedValue(result, key)
      }
    }
  }

  return result as WithId<Document>
}

// ============================================================================
// SORTING
// ============================================================================

/**
 * Normalize sort direction to 1 or -1
 */
function normalizeSortDirection(dir: SortDirection): 1 | -1 {
  if (dir === 1 || dir === 'asc' || dir === 'ascending') return 1
  return -1
}

/**
 * Parse sort specification into array of [field, direction] pairs
 */
function parseSortSpec(sort: Sort<Document>): [string, 1 | -1][] {
  if (typeof sort === 'string') {
    return [[sort, 1]]
  }
  if (Array.isArray(sort)) {
    return sort.map(([field, dir]) => [field, normalizeSortDirection(dir)])
  }
  return Object.entries(sort).map(([field, dir]) => [field, normalizeSortDirection(dir)])
}

/**
 * Sort documents according to sort specification
 */
function sortDocuments(docs: Document[], sort: Sort<Document>): Document[] {
  const sortSpec = parseSortSpec(sort)
  return [...docs].sort((a, b) => {
    for (const [field, direction] of sortSpec) {
      const aVal = getNestedValue(a, field)
      const bVal = getNestedValue(b, field)
      const cmp = compareValues(aVal, bVal)
      if (cmp !== 0) {
        return direction === 1 ? cmp : -cmp
      }
    }
    return 0
  })
}

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * Evaluate an aggregation expression
 */
function evaluateExpression(expr: unknown, doc: Document): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    // Field reference
    return getNestedValue(doc, expr.slice(1))
  }

  if (typeof expr === 'object' && expr !== null && !Array.isArray(expr)) {
    const ops = expr as Record<string, unknown>
    const keys = Object.keys(ops)

    if (keys.length === 1 && keys[0].startsWith('$')) {
      const op = keys[0]
      const args = ops[op]

      switch (op) {
        case '$multiply': {
          const arr = args as unknown[]
          const values = arr.map(a => evaluateExpression(a, doc) as number)
          return values.reduce((acc, v) => acc * v, 1)
        }
        case '$add': {
          const arr = args as unknown[]
          const values = arr.map(a => evaluateExpression(a, doc) as number)
          return values.reduce((acc, v) => acc + v, 0)
        }
        case '$subtract': {
          const arr = args as unknown[]
          const a = evaluateExpression(arr[0], doc) as number
          const b = evaluateExpression(arr[1], doc) as number
          return a - b
        }
        case '$divide': {
          const arr = args as unknown[]
          const a = evaluateExpression(arr[0], doc) as number
          const b = evaluateExpression(arr[1], doc) as number
          return a / b
        }
        case '$concat': {
          const arr = args as unknown[]
          return arr.map(a => String(evaluateExpression(a, doc))).join('')
        }
        case '$toLower': {
          return String(evaluateExpression(args, doc)).toLowerCase()
        }
        case '$toUpper': {
          return String(evaluateExpression(args, doc)).toUpperCase()
        }
        default:
          return expr
      }
    }
  }

  return expr
}

/**
 * Process a single aggregation stage
 */
function processAggregationStage(
  docs: Document[],
  stage: PipelineStage<Document>,
  dbName: string
): Document[] {
  if ('$match' in stage) {
    return docs.filter(doc => matchesFilter(doc, stage.$match))
  }

  if ('$group' in stage) {
    const groupSpec = stage.$group
    const groups = new Map<string, Document[]>()

    for (const doc of docs) {
      let groupKey: unknown
      if (groupSpec._id === null) {
        groupKey = 'null'
      } else if (typeof groupSpec._id === 'string' && groupSpec._id.startsWith('$')) {
        groupKey = getNestedValue(doc, groupSpec._id.slice(1))
      } else {
        groupKey = groupSpec._id
      }

      const keyStr = JSON.stringify(groupKey)
      if (!groups.has(keyStr)) {
        groups.set(keyStr, [])
      }
      groups.get(keyStr)!.push(doc)
    }

    const results: Document[] = []
    for (const [keyStr, groupDocs] of groups) {
      const result: Document = { _id: JSON.parse(keyStr) }

      for (const [field, accumulator] of Object.entries(groupSpec)) {
        if (field === '_id') continue

        const acc = accumulator as Record<string, unknown>
        const accOp = Object.keys(acc)[0]
        const accField = acc[accOp]

        switch (accOp) {
          case '$sum': {
            if (typeof accField === 'number') {
              result[field] = accField * groupDocs.length
            } else if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              result[field] = groupDocs.reduce((sum, d) => {
                const val = getNestedValue(d, fieldPath)
                return sum + (typeof val === 'number' ? val : 0)
              }, 0)
            }
            break
          }
          case '$avg': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              const sum = groupDocs.reduce((s, d) => {
                const val = getNestedValue(d, fieldPath)
                return s + (typeof val === 'number' ? val : 0)
              }, 0)
              result[field] = sum / groupDocs.length
            }
            break
          }
          case '$first': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              result[field] = getNestedValue(groupDocs[0], fieldPath)
            }
            break
          }
          case '$last': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              result[field] = getNestedValue(groupDocs[groupDocs.length - 1], fieldPath)
            }
            break
          }
          case '$max': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              result[field] = groupDocs.reduce((max, d) => {
                const val = getNestedValue(d, fieldPath)
                return max === undefined || compareValues(val, max) > 0 ? val : max
              }, undefined as unknown)
            }
            break
          }
          case '$min': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              result[field] = groupDocs.reduce((min, d) => {
                const val = getNestedValue(d, fieldPath)
                return min === undefined || compareValues(val, min) < 0 ? val : min
              }, undefined as unknown)
            }
            break
          }
          case '$push': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              result[field] = groupDocs.map(d => getNestedValue(d, fieldPath))
            }
            break
          }
          case '$addToSet': {
            if (typeof accField === 'string' && accField.startsWith('$')) {
              const fieldPath = accField.slice(1)
              const values: unknown[] = []
              for (const d of groupDocs) {
                const val = getNestedValue(d, fieldPath)
                if (!values.some(v => deepEquals(v, val))) {
                  values.push(val)
                }
              }
              result[field] = values
            }
            break
          }
        }
      }

      results.push(result)
    }

    return results
  }

  if ('$sort' in stage) {
    return sortDocuments(docs, stage.$sort as Sort<Document>)
  }

  if ('$limit' in stage) {
    return docs.slice(0, stage.$limit)
  }

  if ('$skip' in stage) {
    return docs.slice(stage.$skip)
  }

  if ('$project' in stage) {
    return docs.map(doc => {
      const result: Document = {}
      for (const [key, value] of Object.entries(stage.$project)) {
        if (value === 0 || value === false) {
          // Exclusion handled below
          continue
        }
        if (value === 1 || value === true) {
          const v = getNestedValue(doc, key)
          if (v !== undefined) {
            setNestedValue(result, key, v)
          }
        } else if (typeof value === 'object') {
          // Expression
          result[key] = evaluateExpression(value, doc)
        } else if (typeof value === 'string' && value.startsWith('$')) {
          result[key] = getNestedValue(doc, value.slice(1))
        }
      }
      // Handle _id
      if (stage.$project._id !== 0 && stage.$project._id !== false) {
        result._id = doc._id
      }
      return result
    })
  }

  if ('$addFields' in stage || '$set' in stage) {
    const fields = '$addFields' in stage ? stage.$addFields : stage.$set
    return docs.map(doc => {
      const result = { ...doc }
      for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
        result[key] = evaluateExpression(value, doc)
      }
      return result
    })
  }

  if ('$count' in stage) {
    return [{ [stage.$count]: docs.length }]
  }

  if ('$lookup' in stage) {
    const { from, localField, foreignField, as } = stage.$lookup
    const foreignDocs = getCollectionStorage(dbName, from)
    return docs.map(doc => {
      const localValue = getNestedValue(doc, localField)
      const matches = foreignDocs.filter(fd => {
        const foreignValue = getNestedValue(fd, foreignField)
        return deepEquals(localValue, foreignValue)
      })
      return { ...doc, [as]: matches }
    })
  }

  if ('$unwind' in stage) {
    const unwindSpec = stage.$unwind
    const path = typeof unwindSpec === 'string' ? unwindSpec : unwindSpec.path
    const preserveNullAndEmpty = typeof unwindSpec === 'object' && unwindSpec.preserveNullAndEmptyArrays
    const includeArrayIndex = typeof unwindSpec === 'object' ? unwindSpec.includeArrayIndex : undefined
    const fieldPath = path.startsWith('$') ? path.slice(1) : path

    const results: Document[] = []
    for (const doc of docs) {
      const arr = getNestedValue(doc, fieldPath)
      if (!Array.isArray(arr) || arr.length === 0) {
        if (preserveNullAndEmpty) {
          const newDoc = { ...doc }
          setNestedValue(newDoc, fieldPath, null)
          if (includeArrayIndex) {
            newDoc[includeArrayIndex] = null
          }
          results.push(newDoc)
        }
        continue
      }
      for (let i = 0; i < arr.length; i++) {
        const newDoc = JSON.parse(JSON.stringify(doc))
        setNestedValue(newDoc, fieldPath, arr[i])
        if (includeArrayIndex) {
          newDoc[includeArrayIndex] = i
        }
        results.push(newDoc)
      }
    }
    return results
  }

  return docs
}

// ============================================================================
// FIND CURSOR
// ============================================================================

class FindCursorImpl<T extends Document = Document> implements IFindCursor<T> {
  private docs: WithId<T>[]
  private _filter: Filter<T>
  private _projection?: Projection<T>
  private _sort?: Sort<T>
  private _limit?: number
  private _skip?: number
  private _closed = false
  private _position = 0
  private _transform?: (doc: WithId<T>) => unknown
  private _executed = false
  private _results: WithId<T>[] = []

  constructor(docs: WithId<T>[], filter?: Filter<T>) {
    this.docs = docs
    this._filter = filter ?? {}
  }

  private execute(): WithId<T>[] {
    if (this._executed) return this._results

    let result = this.docs.filter(doc => matchesFilter(doc, this._filter as Filter<Document>))

    if (this._sort) {
      result = sortDocuments(result, this._sort as Sort<Document>) as WithId<T>[]
    }

    if (this._skip !== undefined) {
      result = result.slice(this._skip)
    }

    if (this._limit !== undefined) {
      result = result.slice(0, this._limit)
    }

    if (this._projection) {
      result = result.map(doc => applyProjection(doc as WithId<Document>, this._projection as Projection<Document>) as WithId<T>)
    }

    this._results = result
    this._executed = true
    return this._results
  }

  async toArray(): Promise<WithId<T>[]> {
    const results = this.execute()
    if (this._transform) {
      return results.map(this._transform as (doc: WithId<T>) => WithId<T>)
    }
    return results
  }

  async forEach(callback: (doc: WithId<T>) => void | Promise<void>): Promise<void> {
    const results = await this.toArray()
    for (const doc of results) {
      await callback(doc)
    }
  }

  async hasNext(): Promise<boolean> {
    const results = this.execute()
    return this._position < results.length
  }

  async next(): Promise<WithId<T> | null> {
    const results = this.execute()
    if (this._position >= results.length) {
      return null
    }
    const doc = results[this._position++]
    return this._transform ? (this._transform(doc) as WithId<T>) : doc
  }

  async count(): Promise<number> {
    return this.execute().length
  }

  limit(value: number): IFindCursor<T> {
    this._limit = value
    this._executed = false
    return this
  }

  skip(value: number): IFindCursor<T> {
    this._skip = value
    this._executed = false
    return this
  }

  sort(sort: Sort<T>): IFindCursor<T> {
    this._sort = sort
    this._executed = false
    return this
  }

  project<P extends Document = Document>(projection: Projection<T>): IFindCursor<P> {
    this._projection = projection
    this._executed = false
    return this as unknown as IFindCursor<P>
  }

  filter(filter: Filter<T>): IFindCursor<T> {
    this._filter = { ...this._filter, ...filter }
    this._executed = false
    return this
  }

  map<U>(transform: (doc: WithId<T>) => U): IFindCursor<U & Document> {
    const newCursor = new FindCursorImpl<U & Document>(this.docs as unknown as WithId<(U & Document)>[], this._filter as Filter<U & Document>)
    newCursor._projection = this._projection as unknown as Projection<U & Document>
    newCursor._sort = this._sort as unknown as Sort<U & Document>
    newCursor._limit = this._limit
    newCursor._skip = this._skip
    newCursor._transform = transform as unknown as (doc: WithId<U & Document>) => unknown
    return newCursor
  }

  async close(): Promise<void> {
    this._closed = true
  }

  get closed(): boolean {
    return this._closed
  }

  [Symbol.asyncIterator](): AsyncIterator<WithId<T>> {
    const results = this.execute()
    let position = 0
    const transform = this._transform

    return {
      async next(): Promise<IteratorResult<WithId<T>>> {
        if (position >= results.length) {
          return { done: true, value: undefined }
        }
        const doc = results[position++]
        const value = transform ? (transform(doc) as WithId<T>) : doc
        return { done: false, value }
      }
    }
  }
}

// ============================================================================
// AGGREGATION CURSOR
// ============================================================================

class AggregationCursorImpl<T extends Document = Document> implements IAggregationCursor<T> {
  private _results: T[] | null = null
  private _position = 0
  private _closed = false

  constructor(
    private docs: Document[],
    private pipeline: PipelineStage<Document>[],
    private dbName: string
  ) {}

  private execute(): T[] {
    if (this._results) return this._results

    let result = [...this.docs]
    for (const stage of this.pipeline) {
      result = processAggregationStage(result, stage, this.dbName)
    }
    this._results = result as T[]
    return this._results
  }

  async toArray(): Promise<T[]> {
    return this.execute()
  }

  async forEach(callback: (doc: T) => void | Promise<void>): Promise<void> {
    const results = this.execute()
    for (const doc of results) {
      await callback(doc)
    }
  }

  async hasNext(): Promise<boolean> {
    const results = this.execute()
    return this._position < results.length
  }

  async next(): Promise<T | null> {
    const results = this.execute()
    if (this._position >= results.length) {
      return null
    }
    return results[this._position++]
  }

  async close(): Promise<void> {
    this._closed = true
  }

  get closed(): boolean {
    return this._closed
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const results = this.execute()
    let position = 0

    return {
      async next(): Promise<IteratorResult<T>> {
        if (position >= results.length) {
          return { done: true, value: undefined }
        }
        return { done: false, value: results[position++] }
      }
    }
  }
}

// ============================================================================
// LIST COLLECTIONS CURSOR
// ============================================================================

class ListCollectionsCursorImpl implements IListCollectionsCursor {
  private _position = 0
  private _closed = false

  constructor(private collections: CollectionInfo[]) {}

  async toArray(): Promise<CollectionInfo[]> {
    return this.collections
  }

  async hasNext(): Promise<boolean> {
    return this._position < this.collections.length
  }

  async next(): Promise<CollectionInfo | null> {
    if (this._position >= this.collections.length) {
      return null
    }
    return this.collections[this._position++]
  }

  async close(): Promise<void> {
    this._closed = true
  }

  [Symbol.asyncIterator](): AsyncIterator<CollectionInfo> {
    let position = 0
    const collections = this.collections

    return {
      async next(): Promise<IteratorResult<CollectionInfo>> {
        if (position >= collections.length) {
          return { done: true, value: undefined }
        }
        return { done: false, value: collections[position++] }
      }
    }
  }
}

// ============================================================================
// CHANGE STREAM (stub)
// ============================================================================

class ChangeStreamImpl<T extends Document = Document> implements IChangeStream<T> {
  private _closed = false

  async close(): Promise<void> {
    this._closed = true
  }

  async hasNext(): Promise<boolean> {
    return false
  }

  async next(): Promise<ChangeStreamDocument<T>> {
    throw new MongoError('Change stream not supported in in-memory mode')
  }

  get closed(): boolean {
    return this._closed
  }

  [Symbol.asyncIterator](): AsyncIterator<ChangeStreamDocument<T>> {
    return {
      async next(): Promise<IteratorResult<ChangeStreamDocument<T>>> {
        return { done: true, value: undefined }
      }
    }
  }
}

// ============================================================================
// COLLECTION
// ============================================================================

class CollectionImpl<T extends Document = Document> implements ICollection<T> {
  private _dbName: string
  private _collName: string

  constructor(dbName: string, collName: string) {
    this._dbName = dbName
    this._collName = collName
  }

  get collectionName(): string {
    return this._collName
  }

  get dbName(): string {
    return this._dbName
  }

  get namespace(): string {
    return getNamespace(this._dbName, this._collName)
  }

  private getStorage(): Document[] {
    return getCollectionStorage(this._dbName, this._collName)
  }

  private getIndexes(): IndexInfo[] {
    const ns = this.namespace
    if (!globalIndexes.has(ns)) {
      globalIndexes.set(ns, [{ name: '_id_', key: { _id: 1 }, unique: true, v: 2 }])
    }
    return globalIndexes.get(ns)!
  }

  async insertOne(doc: OptionalId<T>, _options?: InsertOneOptions): Promise<InsertOneResult> {
    const storage = this.getStorage()
    const _id = (doc._id as ObjectId) ?? new ObjectId()

    // Check for duplicate _id
    const existingIndex = storage.findIndex(d => {
      const dId = d._id as ObjectId
      return dId instanceof ObjectId ? dId.equals(_id) : d._id === _id.toHexString()
    })
    if (existingIndex >= 0) {
      throw new MongoDuplicateKeyError(
        `E11000 duplicate key error collection: ${this.namespace}`,
        { _id: _id.toHexString() },
        { _id: 1 }
      )
    }

    // Check unique indexes
    const indexes = this.getIndexes()
    for (const idx of indexes) {
      if (idx.unique && idx.name !== '_id_') {
        for (const existingDoc of storage) {
          let allMatch = true
          const keyValue: Document = {}
          for (const key of Object.keys(idx.key)) {
            const newVal = getNestedValue(doc, key)
            const existingVal = getNestedValue(existingDoc, key)
            keyValue[key] = newVal
            if (!deepEquals(newVal, existingVal) || newVal === null || newVal === undefined) {
              allMatch = false
              break
            }
          }
          if (allMatch) {
            throw new MongoDuplicateKeyError(
              `E11000 duplicate key error collection: ${this.namespace} index: ${idx.name}`,
              keyValue,
              idx.key
            )
          }
        }
      }
    }

    const newDoc = { ...doc, _id } as Document
    storage.push(newDoc)

    return { acknowledged: true, insertedId: _id }
  }

  async insertMany(docs: OptionalId<T>[], options?: InsertManyOptions): Promise<InsertManyResult> {
    const insertedIds: { [key: number]: ObjectId } = {}
    const ordered = options?.ordered !== false
    let lastError: Error | undefined

    for (let i = 0; i < docs.length; i++) {
      try {
        const result = await this.insertOne(docs[i])
        insertedIds[i] = result.insertedId
      } catch (e) {
        lastError = e as Error
        if (ordered) throw e
        // Continue for unordered, but track the error to throw at the end
      }
    }

    // For unordered inserts, throw the error after processing all documents
    if (lastError) {
      throw lastError
    }

    return {
      acknowledged: true,
      insertedCount: Object.keys(insertedIds).length,
      insertedIds
    }
  }

  async findOne(filter?: Filter<T>, options?: FindOptions<T>): Promise<WithId<T> | null> {
    const cursor = this.find(filter, options)
    const results = await cursor.limit(1).toArray()
    return results[0] ?? null
  }

  find(filter?: Filter<T>, options?: FindOptions<T>): IFindCursor<T> {
    const storage = this.getStorage()
    const cursor = new FindCursorImpl<T>(storage as WithId<T>[], filter)

    if (options?.projection) {
      cursor.project(options.projection)
    }
    if (options?.sort) {
      cursor.sort(options.sort)
    }
    if (options?.skip !== undefined) {
      cursor.skip(options.skip)
    }
    if (options?.limit !== undefined) {
      cursor.limit(options.limit)
    }

    return cursor
  }

  async updateOne(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult> {
    const storage = this.getStorage()
    const index = storage.findIndex(doc => matchesFilter(doc, filter as Filter<Document>))

    if (index < 0) {
      if (options?.upsert) {
        const newDoc: Document = { ...filter }
        applyUpdate(newDoc, update as UpdateFilter<Document>)
        const _id = newDoc._id as ObjectId ?? new ObjectId()
        newDoc._id = _id
        storage.push(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
          upsertedId: _id
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    // Check if update has positional operator
    const hasPositional = JSON.stringify(update).includes('.$')
    if (hasPositional) {
      applyPositionalUpdate(storage[index], update as UpdateFilter<Document>, filter as Filter<Document>)
    } else {
      applyUpdate(storage[index], update as UpdateFilter<Document>)
    }

    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }

  async updateMany(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult> {
    const storage = this.getStorage()
    let matchedCount = 0
    let modifiedCount = 0

    for (const doc of storage) {
      if (matchesFilter(doc, filter as Filter<Document>)) {
        matchedCount++
        applyUpdate(doc, update as UpdateFilter<Document>)
        modifiedCount++
      }
    }

    if (matchedCount === 0 && options?.upsert) {
      const newDoc: Document = { ...filter }
      applyUpdate(newDoc, update as UpdateFilter<Document>)
      const _id = newDoc._id as ObjectId ?? new ObjectId()
      newDoc._id = _id
      storage.push(newDoc)
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: _id
      }
    }

    return { acknowledged: true, matchedCount, modifiedCount, upsertedCount: 0 }
  }

  async replaceOne(filter: Filter<T>, replacement: T, options?: UpdateOptions): Promise<UpdateResult> {
    const storage = this.getStorage()
    const index = storage.findIndex(doc => matchesFilter(doc, filter as Filter<Document>))

    if (index < 0) {
      if (options?.upsert) {
        const _id = (replacement as Document)._id as ObjectId ?? new ObjectId()
        const newDoc = { ...replacement, _id } as Document
        storage.push(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
          upsertedId: _id
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    const _id = storage[index]._id
    storage[index] = { ...replacement, _id } as Document

    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }

  async deleteOne(filter: Filter<T>, _options?: DeleteOptions): Promise<DeleteResult> {
    const storage = this.getStorage()
    const index = storage.findIndex(doc => matchesFilter(doc, filter as Filter<Document>))

    if (index < 0) {
      return { acknowledged: true, deletedCount: 0 }
    }

    storage.splice(index, 1)
    return { acknowledged: true, deletedCount: 1 }
  }

  async deleteMany(filter: Filter<T>, _options?: DeleteOptions): Promise<DeleteResult> {
    const storage = this.getStorage()
    const initialLength = storage.length
    const filtered = storage.filter(doc => !matchesFilter(doc, filter as Filter<Document>))

    // Replace storage contents
    storage.length = 0
    storage.push(...filtered)

    return { acknowledged: true, deletedCount: initialLength - filtered.length }
  }

  async findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: FindOneAndUpdateOptions<T>
  ): Promise<WithId<T> | null> {
    const storage = this.getStorage()
    const index = storage.findIndex(doc => matchesFilter(doc, filter as Filter<Document>))

    if (index < 0) {
      if (options?.upsert) {
        const newDoc: Document = { ...filter }
        applyUpdate(newDoc, update as UpdateFilter<Document>)
        const _id = newDoc._id as ObjectId ?? new ObjectId()
        newDoc._id = _id
        storage.push(newDoc)
        return options.returnDocument === 'after' ? newDoc as WithId<T> : null
      }
      return null
    }

    const before = { ...storage[index] } as WithId<T>
    applyUpdate(storage[index], update as UpdateFilter<Document>)
    const after = storage[index] as WithId<T>

    return options?.returnDocument === 'after' ? after : before
  }

  async findOneAndDelete(filter: Filter<T>, _options?: FindOneAndDeleteOptions<T>): Promise<WithId<T> | null> {
    const storage = this.getStorage()
    const index = storage.findIndex(doc => matchesFilter(doc, filter as Filter<Document>))

    if (index < 0) {
      return null
    }

    const doc = storage[index] as WithId<T>
    storage.splice(index, 1)
    return doc
  }

  async findOneAndReplace(
    filter: Filter<T>,
    replacement: T,
    options?: FindOneAndReplaceOptions<T>
  ): Promise<WithId<T> | null> {
    const storage = this.getStorage()
    const index = storage.findIndex(doc => matchesFilter(doc, filter as Filter<Document>))

    if (index < 0) {
      if (options?.upsert) {
        const _id = (replacement as Document)._id as ObjectId ?? new ObjectId()
        const newDoc = { ...replacement, _id } as Document
        storage.push(newDoc)
        return options.returnDocument === 'after' ? newDoc as WithId<T> : null
      }
      return null
    }

    const before = { ...storage[index] } as WithId<T>
    const _id = storage[index]._id
    storage[index] = { ...replacement, _id } as Document
    const after = storage[index] as WithId<T>

    return options?.returnDocument === 'after' ? after : before
  }

  aggregate<R extends Document = Document>(
    pipeline: PipelineStage<T>[],
    _options?: AggregateOptions
  ): IAggregationCursor<R> {
    const storage = this.getStorage()
    return new AggregationCursorImpl<R>(storage, pipeline as PipelineStage<Document>[], this._dbName)
  }

  async countDocuments(filter?: Filter<T>, options?: CountDocumentsOptions): Promise<number> {
    let cursor = this.find(filter)
    if (options?.skip !== undefined) {
      cursor = cursor.skip(options.skip)
    }
    if (options?.limit !== undefined) {
      cursor = cursor.limit(options.limit)
    }
    return (await cursor.toArray()).length
  }

  async estimatedDocumentCount(_options?: EstimatedDocumentCountOptions): Promise<number> {
    return this.getStorage().length
  }

  async distinct<K extends keyof WithId<T>>(
    key: K,
    filter?: Filter<T>,
    _options?: DistinctOptions
  ): Promise<WithId<T>[K][]> {
    const docs = await this.find(filter).toArray()
    const values = new Set<unknown>()
    for (const doc of docs) {
      const value = getNestedValue(doc, key as string)
      if (value !== undefined) {
        values.add(value)
      }
    }
    return Array.from(values) as WithId<T>[K][]
  }

  async createIndex(keys: IndexSpecification, options?: CreateIndexesOptions): Promise<string> {
    const indexes = this.getIndexes()

    // Generate index name
    const name = options?.name ?? Object.entries(keys)
      .map(([k, v]) => `${k}_${v}`)
      .join('_')

    // Check if index already exists
    if (indexes.some(idx => idx.name === name)) {
      return name
    }

    indexes.push({
      name,
      key: keys,
      unique: options?.unique,
      sparse: options?.sparse,
      expireAfterSeconds: options?.expireAfterSeconds,
      v: 2
    })

    return name
  }

  async createIndexes(
    indexes: { key: IndexSpecification; options?: CreateIndexesOptions }[]
  ): Promise<string[]> {
    const names: string[] = []
    for (const idx of indexes) {
      names.push(await this.createIndex(idx.key, idx.options))
    }
    return names
  }

  async dropIndex(indexName: string): Promise<void> {
    const indexes = this.getIndexes()
    const idx = indexes.findIndex(i => i.name === indexName)
    if (idx >= 0 && indexName !== '_id_') {
      indexes.splice(idx, 1)
    }
  }

  async dropIndexes(): Promise<void> {
    const ns = this.namespace
    globalIndexes.set(ns, [{ name: '_id_', key: { _id: 1 }, unique: true, v: 2 }])
  }

  listIndexes(): IFindCursor<IndexInfo> {
    const indexes = this.getIndexes()
    return new FindCursorImpl<IndexInfo>(indexes as WithId<IndexInfo>[])
  }

  async indexExists(name: string | string[]): Promise<boolean> {
    const indexes = this.getIndexes()
    const names = Array.isArray(name) ? name : [name]
    return names.every(n => indexes.some(idx => idx.name === n))
  }

  async indexes(): Promise<IndexInfo[]> {
    return this.getIndexes()
  }

  async drop(): Promise<boolean> {
    const db = getDbStorage(this._dbName)
    db.delete(this._collName)
    globalIndexes.delete(this.namespace)
    return true
  }

  async rename(newName: string): Promise<ICollection<T>> {
    const db = getDbStorage(this._dbName)
    const data = db.get(this._collName) ?? []
    db.delete(this._collName)
    db.set(newName, data)

    // Move indexes
    const indexes = globalIndexes.get(this.namespace)
    if (indexes) {
      globalIndexes.delete(this.namespace)
      globalIndexes.set(getNamespace(this._dbName, newName), indexes)
    }

    return new CollectionImpl<T>(this._dbName, newName)
  }

  async isCapped(): Promise<boolean> {
    return false
  }

  async stats(): Promise<CollStats> {
    const storage = this.getStorage()
    const indexes = this.getIndexes()
    const size = JSON.stringify(storage).length

    return {
      ns: this.namespace,
      count: storage.length,
      size,
      avgObjSize: storage.length > 0 ? size / storage.length : 0,
      storageSize: size,
      totalIndexSize: indexes.length * 100,
      indexSizes: Object.fromEntries(indexes.map(idx => [idx.name, 100])),
      nindexes: indexes.length
    }
  }

  watch<C extends Document = T>(
    _pipeline?: PipelineStage<T>[],
    _options?: ChangeStreamOptions
  ): IChangeStream<C> {
    return new ChangeStreamImpl<C>()
  }
}

// ============================================================================
// DATABASE
// ============================================================================

class DbImpl implements IDb {
  private _name: string

  constructor(name: string) {
    this._name = name
  }

  get databaseName(): string {
    return this._name
  }

  collection<T extends Document = Document>(name: string): ICollection<T> {
    return new CollectionImpl<T>(this._name, name)
  }

  async createCollection<T extends Document = Document>(
    name: string,
    _options?: CreateCollectionOptions
  ): Promise<ICollection<T>> {
    // Ensure collection storage exists
    getCollectionStorage(this._name, name)
    return new CollectionImpl<T>(this._name, name)
  }

  listCollections(_filter?: Document, _options?: ListCollectionsOptions): IListCollectionsCursor {
    const db = getDbStorage(this._name)
    const collections: CollectionInfo[] = []

    for (const name of db.keys()) {
      collections.push({
        name,
        type: 'collection',
        options: {},
        info: { readOnly: false }
      })
    }

    return new ListCollectionsCursorImpl(collections)
  }

  async dropCollection(name: string): Promise<boolean> {
    const db = getDbStorage(this._name)
    const had = db.has(name)
    db.delete(name)
    globalIndexes.delete(getNamespace(this._name, name))
    return had
  }

  async dropDatabase(): Promise<boolean> {
    globalStorage.delete(this._name)
    // Clean up indexes
    for (const key of globalIndexes.keys()) {
      if (key.startsWith(this._name + '.')) {
        globalIndexes.delete(key)
      }
    }
    return true
  }

  async collections(): Promise<ICollection[]> {
    const db = getDbStorage(this._name)
    return Array.from(db.keys()).map(name => new CollectionImpl(this._name, name))
  }

  async command(command: Document): Promise<Document> {
    if ('ping' in command) {
      return { ok: 1 }
    }
    return { ok: 1 }
  }

  async stats(): Promise<DbStats> {
    const db = getDbStorage(this._name)
    let objects = 0
    let dataSize = 0
    let indexCount = 0

    for (const [collName, docs] of db) {
      objects += docs.length
      dataSize += JSON.stringify(docs).length
      const indexes = globalIndexes.get(getNamespace(this._name, collName))
      if (indexes) {
        indexCount += indexes.length
      }
    }

    return {
      db: this._name,
      collections: db.size,
      views: 0,
      objects,
      avgObjSize: objects > 0 ? dataSize / objects : 0,
      dataSize,
      storageSize: dataSize,
      indexes: indexCount,
      indexSize: indexCount * 100
    }
  }

  admin(): IAdmin {
    return new AdminImpl()
  }
}

// ============================================================================
// ADMIN
// ============================================================================

class AdminImpl implements IAdmin {
  async listDatabases(): Promise<ListDatabasesResult> {
    const databases: { name: string; sizeOnDisk: number; empty: boolean }[] = []
    let totalSize = 0

    for (const [name, db] of globalStorage) {
      let size = 0
      for (const docs of db.values()) {
        size += JSON.stringify(docs).length
      }
      databases.push({
        name,
        sizeOnDisk: size,
        empty: db.size === 0
      })
      totalSize += size
    }

    return { databases, totalSize, ok: 1 }
  }

  async serverInfo(): Promise<Document> {
    return {
      version: '7.0.0',
      gitVersion: 'mock',
      modules: [],
      allocator: 'mock',
      javascriptEngine: 'none',
      sysInfo: 'deprecated',
      versionArray: [7, 0, 0, 0],
      ok: 1
    }
  }

  async serverStatus(): Promise<Document> {
    return {
      host: 'localhost',
      version: '7.0.0',
      process: 'mock',
      pid: 1,
      uptime: 1000,
      uptimeMillis: 1000000,
      uptimeEstimate: 1000,
      ok: 1
    }
  }

  async ping(): Promise<Document> {
    return { ok: 1 }
  }
}

// ============================================================================
// CLIENT SESSION
// ============================================================================

class ClientSessionImpl implements IClientSession {
  private _id = { id: new ObjectId() }
  private _hasEnded = false
  private _inTransaction = false

  get id(): { id: unknown } {
    return this._id
  }

  get hasEnded(): boolean {
    return this._hasEnded
  }

  get inTransaction(): boolean {
    return this._inTransaction
  }

  startTransaction(_options?: TransactionOptions): void {
    this._inTransaction = true
  }

  async commitTransaction(): Promise<void> {
    this._inTransaction = false
  }

  async abortTransaction(): Promise<void> {
    this._inTransaction = false
  }

  async endSession(): Promise<void> {
    this._hasEnded = true
    this._inTransaction = false
  }

  async withTransaction<T>(
    fn: (session: IClientSession) => Promise<T>,
    _options?: TransactionOptions
  ): Promise<T> {
    this.startTransaction(_options)
    try {
      const result = await fn(this)
      await this.commitTransaction()
      return result
    } catch (e) {
      await this.abortTransaction()
      throw e
    }
  }
}

// ============================================================================
// MONGO CLIENT
// ============================================================================

class MongoClientImpl implements IMongoClient {
  private _url: string
  private _options: ExtendedMongoClientOptions
  private _connected = false
  private _defaultDb: string | undefined

  constructor(url?: string, options?: ExtendedMongoClientOptions) {
    this._url = url ?? 'mongodb://localhost:27017'
    this._options = options ?? {}

    // Parse default database from URL
    const match = this._url.match(/mongodb:\/\/[^/]+\/([^?]+)/)
    if (match) {
      this._defaultDb = match[1]
    }
  }

  async connect(): Promise<IMongoClient> {
    this._connected = true
    return this
  }

  async close(_force?: boolean): Promise<void> {
    this._connected = false
  }

  get isConnected(): boolean {
    return this._connected
  }

  get options(): MongoClientOptions {
    return this._options
  }

  db(name?: string): IDb {
    const dbName = name ?? this._defaultDb ?? 'test'
    return new DbImpl(dbName)
  }

  startSession(_options?: SessionOptions): IClientSession {
    return new ClientSessionImpl()
  }

  async withSession<T>(fn: (session: IClientSession) => Promise<T>): Promise<T> {
    const session = this.startSession()
    try {
      return await fn(session)
    } finally {
      await session.endSession()
    }
  }

  watch<T extends Document = Document>(
    _pipeline?: PipelineStage<T>[],
    _options?: ChangeStreamOptions
  ): IChangeStream<T> {
    return new ChangeStreamImpl<T>()
  }
}

// ============================================================================
// CREATE CLIENT
// ============================================================================

/**
 * Create a new MongoDB client
 */
export function createClient(
  url?: string,
  options?: MongoClientOptions | ExtendedMongoClientOptions
): IMongoClient {
  return new MongoClientImpl(url, options as ExtendedMongoClientOptions)
}
