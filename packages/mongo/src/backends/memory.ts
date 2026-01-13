/**
 * In-Memory Backend for MongoDB-compatible storage
 *
 * Stores documents in a Map for testing and lightweight use cases.
 */

import type { Backend } from './interface'
import type {
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  MongoFilter,
  MongoUpdate,
  UpdateOptions,
  SortSpec,
} from '../types'
import { ObjectId } from '../client'

/** In-memory storage backend */
export class MemoryBackend implements Backend {
  /** Storage: db -> collection -> Map<id, doc> */
  private storage: Map<string, Map<string, Map<string, Document>>> = new Map()

  /** Get or create collection storage */
  private getCollection(db: string, collection: string): Map<string, Document> {
    if (!this.storage.has(db)) {
      this.storage.set(db, new Map())
    }
    const dbMap = this.storage.get(db)!
    if (!dbMap.has(collection)) {
      dbMap.set(collection, new Map())
    }
    return dbMap.get(collection)!
  }

  /** Insert a single document */
  async insertOne(db: string, collection: string, doc: Document): Promise<InsertOneResult> {
    const coll = this.getCollection(db, collection)

    const id = (doc._id as string) ?? new ObjectId().toString()
    const docWithId: Document = { ...doc, _id: id }

    // Check for duplicate _id
    if (coll.has(id)) {
      throw new Error(`E11000 duplicate key error: _id: ${id}`)
    }

    coll.set(id, docWithId)

    return { acknowledged: true, insertedId: id }
  }

  /** Insert multiple documents */
  async insertMany(db: string, collection: string, docs: Document[]): Promise<InsertManyResult> {
    const insertedIds: string[] = []

    for (const doc of docs) {
      const result = await this.insertOne(db, collection, doc)
      insertedIds.push(result.insertedId)
    }

    return {
      acknowledged: true,
      insertedCount: insertedIds.length,
      insertedIds,
    }
  }

  /** Find documents matching filter */
  async find(db: string, collection: string, filter: MongoFilter, options?: FindOptions): Promise<Document[]> {
    const coll = this.getCollection(db, collection)

    let docs = Array.from(coll.values())

    // Apply filter
    docs = docs.filter(doc => this.matchesFilter(doc, filter))

    // Apply sort
    if (options?.sort) {
      docs = this.sortDocuments(docs, options.sort)
    }

    // Apply skip
    if (options?.skip) {
      docs = docs.slice(options.skip)
    }

    // Apply limit
    if (options?.limit !== undefined) {
      docs = docs.slice(0, options.limit)
    }

    // Apply projection (clone and project)
    if (options?.projection) {
      docs = docs.map(doc => this.applyProjection(doc, options.projection!))
    } else {
      // Clone documents
      docs = docs.map(doc => ({ ...doc }))
    }

    return docs
  }

  /** Find a single document */
  async findOne(db: string, collection: string, filter: MongoFilter, options?: FindOptions): Promise<Document | null> {
    const docs = await this.find(db, collection, filter, { ...options, limit: 1 })
    return docs[0] ?? null
  }

  /** Update a single document */
  async updateOne(
    db: string,
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    const coll = this.getCollection(db, collection)

    // Find matching document
    let matched: Document | null = null
    for (const doc of coll.values()) {
      if (this.matchesFilter(doc, filter)) {
        matched = doc
        break
      }
    }

    if (!matched) {
      if (options?.upsert) {
        // Create new document from filter equality conditions and update
        const newDoc = this.buildUpsertDoc(filter, update)
        const result = await this.insertOne(db, collection, newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: result.insertedId,
          upsertedCount: 1,
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    // Apply update
    const updated = this.applyUpdate(matched, update)
    coll.set(matched._id!, updated)

    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }

  /** Update multiple documents */
  async updateMany(
    db: string,
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    const coll = this.getCollection(db, collection)

    const matched: Document[] = []
    for (const doc of coll.values()) {
      if (this.matchesFilter(doc, filter)) {
        matched.push(doc)
      }
    }

    if (matched.length === 0) {
      if (options?.upsert) {
        const newDoc = this.buildUpsertDoc(filter, update)
        const result = await this.insertOne(db, collection, newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: result.insertedId,
          upsertedCount: 1,
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    for (const doc of matched) {
      const updated = this.applyUpdate(doc, update)
      coll.set(doc._id!, updated)
    }

    return {
      acknowledged: true,
      matchedCount: matched.length,
      modifiedCount: matched.length,
      upsertedCount: 0,
    }
  }

  /** Delete a single document */
  async deleteOne(db: string, collection: string, filter: MongoFilter): Promise<DeleteResult> {
    const coll = this.getCollection(db, collection)

    for (const [id, doc] of coll.entries()) {
      if (this.matchesFilter(doc, filter)) {
        coll.delete(id)
        return { acknowledged: true, deletedCount: 1 }
      }
    }

    return { acknowledged: true, deletedCount: 0 }
  }

  /** Delete multiple documents */
  async deleteMany(db: string, collection: string, filter: MongoFilter): Promise<DeleteResult> {
    const coll = this.getCollection(db, collection)

    const toDelete: string[] = []
    for (const [id, doc] of coll.entries()) {
      if (this.matchesFilter(doc, filter)) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      coll.delete(id)
    }

    return { acknowledged: true, deletedCount: toDelete.length }
  }

  /** Count documents matching filter */
  async countDocuments(db: string, collection: string, filter?: MongoFilter): Promise<number> {
    const coll = this.getCollection(db, collection)

    if (!filter || Object.keys(filter).length === 0) {
      return coll.size
    }

    let count = 0
    for (const doc of coll.values()) {
      if (this.matchesFilter(doc, filter)) {
        count++
      }
    }

    return count
  }

  // ============================================================================
  // Filter Matching
  // ============================================================================

  /** Check if document matches filter */
  private matchesFilter(doc: Document, filter: MongoFilter): boolean {
    for (const [key, value] of Object.entries(filter)) {
      // Handle logical operators
      if (key === '$and') {
        const conditions = value as MongoFilter[]
        if (!conditions.every(cond => this.matchesFilter(doc, cond))) {
          return false
        }
        continue
      }

      if (key === '$or') {
        const conditions = value as MongoFilter[]
        if (!conditions.some(cond => this.matchesFilter(doc, cond))) {
          return false
        }
        continue
      }

      if (key === '$nor') {
        const conditions = value as MongoFilter[]
        if (conditions.some(cond => this.matchesFilter(doc, cond))) {
          return false
        }
        continue
      }

      // Get document field value
      const docValue = this.getNestedValue(doc, key)

      // Handle operator expressions
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const operators = value as Record<string, unknown>
        const operatorKeys = Object.keys(operators)

        // Check if this is an operator object (starts with $)
        if (operatorKeys.length > 0 && operatorKeys[0].startsWith('$')) {
          if (!this.matchesOperators(docValue, operators)) {
            return false
          }
          continue
        }
      }

      // Direct equality comparison
      if (!this.deepEquals(docValue, value)) {
        return false
      }
    }

    return true
  }

  /** Check if value matches operator expressions */
  private matchesOperators(value: unknown, operators: Record<string, unknown>): boolean {
    for (const [op, operand] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
          if (!this.deepEquals(value, operand)) return false
          break

        case '$ne':
          if (this.deepEquals(value, operand)) return false
          break

        case '$gt':
          if (!this.compare(value, operand, (a, b) => a > b)) return false
          break

        case '$gte':
          if (!this.compare(value, operand, (a, b) => a >= b)) return false
          break

        case '$lt':
          if (!this.compare(value, operand, (a, b) => a < b)) return false
          break

        case '$lte':
          if (!this.compare(value, operand, (a, b) => a <= b)) return false
          break

        case '$in':
          if (!Array.isArray(operand)) return false
          if (!operand.some(item => this.deepEquals(value, item))) return false
          break

        case '$nin':
          if (!Array.isArray(operand)) return false
          if (operand.some(item => this.deepEquals(value, item))) return false
          break

        case '$exists':
          if (operand && value === undefined) return false
          if (!operand && value !== undefined) return false
          break

        case '$regex':
          if (typeof value !== 'string') return false
          const regex = operand instanceof RegExp ? operand : new RegExp(operand as string)
          if (!regex.test(value)) return false
          break

        default:
          // Unknown operator, skip
          break
      }
    }

    return true
  }

  /** Compare two values using a comparator */
  private compare(a: unknown, b: unknown, comparator: (a: number, b: number) => boolean): boolean {
    if (typeof a === 'number' && typeof b === 'number') {
      return comparator(a, b)
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return comparator(a.localeCompare(b), 0)
    }
    if (a instanceof Date && b instanceof Date) {
      return comparator(a.getTime(), b.getTime())
    }
    return false
  }

  // ============================================================================
  // Update Application
  // ============================================================================

  /** Apply update operators to document */
  private applyUpdate(doc: Document, update: MongoUpdate): Document {
    const result: Document = { ...doc }

    // $set
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        this.setNestedValue(result, key, value)
      }
    }

    // $unset
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        this.deleteNestedValue(result, key)
      }
    }

    // $inc
    if (update.$inc) {
      for (const [key, amount] of Object.entries(update.$inc)) {
        const current = this.getNestedValue(result, key)
        const currentNum = typeof current === 'number' ? current : 0
        this.setNestedValue(result, key, currentNum + amount)
      }
    }

    // $push
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        let arr = this.getNestedValue(result, key) as unknown[]
        if (!Array.isArray(arr)) {
          arr = []
        }
        arr = [...arr, value]
        this.setNestedValue(result, key, arr)
      }
    }

    // $pull
    if (update.$pull) {
      for (const [key, condition] of Object.entries(update.$pull)) {
        const arr = this.getNestedValue(result, key)
        if (Array.isArray(arr)) {
          const filtered = arr.filter(item => !this.deepEquals(item, condition))
          this.setNestedValue(result, key, filtered)
        }
      }
    }

    // $addToSet
    if (update.$addToSet) {
      for (const [key, value] of Object.entries(update.$addToSet)) {
        let arr = this.getNestedValue(result, key) as unknown[]
        if (!Array.isArray(arr)) {
          arr = []
        }
        if (!arr.some(item => this.deepEquals(item, value))) {
          arr = [...arr, value]
        }
        this.setNestedValue(result, key, arr)
      }
    }

    // $pop
    if (update.$pop) {
      for (const [key, direction] of Object.entries(update.$pop)) {
        const arr = this.getNestedValue(result, key)
        if (Array.isArray(arr)) {
          if (direction === 1) {
            this.setNestedValue(result, key, arr.slice(0, -1))
          } else {
            this.setNestedValue(result, key, arr.slice(1))
          }
        }
      }
    }

    // $min
    if (update.$min) {
      for (const [key, value] of Object.entries(update.$min)) {
        const current = this.getNestedValue(result, key)
        if (current === undefined || this.compareValues(value, current) < 0) {
          this.setNestedValue(result, key, value)
        }
      }
    }

    // $max
    if (update.$max) {
      for (const [key, value] of Object.entries(update.$max)) {
        const current = this.getNestedValue(result, key)
        if (current === undefined || this.compareValues(value, current) > 0) {
          this.setNestedValue(result, key, value)
        }
      }
    }

    // $mul
    if (update.$mul) {
      for (const [key, amount] of Object.entries(update.$mul)) {
        const current = this.getNestedValue(result, key)
        const currentNum = typeof current === 'number' ? current : 0
        this.setNestedValue(result, key, currentNum * amount)
      }
    }

    // $rename
    if (update.$rename) {
      for (const [oldKey, newKey] of Object.entries(update.$rename)) {
        const value = this.getNestedValue(result, oldKey)
        if (value !== undefined) {
          this.deleteNestedValue(result, oldKey)
          this.setNestedValue(result, newKey, value)
        }
      }
    }

    return result
  }

  /** Build document for upsert */
  private buildUpsertDoc(filter: MongoFilter, update: MongoUpdate): Document {
    const doc: Document = {}

    // Extract equality conditions from filter
    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) continue
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const ops = value as Record<string, unknown>
        if ('$eq' in ops) {
          doc[key] = ops.$eq
        }
      } else {
        doc[key] = value
      }
    }

    return this.applyUpdate(doc, update)
  }

  // ============================================================================
  // Sorting
  // ============================================================================

  /** Sort documents according to sort spec */
  private sortDocuments(docs: Document[], sort: SortSpec): Document[] {
    const sortEntries = Object.entries(sort)

    return [...docs].sort((a, b) => {
      for (const [field, direction] of sortEntries) {
        const aVal = this.getNestedValue(a, field)
        const bVal = this.getNestedValue(b, field)
        const cmp = this.compareValues(aVal, bVal)
        if (cmp !== 0) {
          return direction * cmp
        }
      }
      return 0
    })
  }

  // ============================================================================
  // Projection
  // ============================================================================

  /** Apply projection to document */
  private applyProjection(doc: Document, projection: { [field: string]: 0 | 1 }): Document {
    const entries = Object.entries(projection)
    const hasInclusion = entries.some(([, v]) => v === 1)

    if (hasInclusion) {
      // Inclusion mode
      const result: Document = {}
      for (const [field, value] of entries) {
        if (value === 1) {
          const val = this.getNestedValue(doc, field)
          if (val !== undefined) {
            result[field] = val
          }
        }
      }
      // Always include _id unless explicitly excluded
      if (projection._id !== 0 && doc._id !== undefined) {
        result._id = doc._id
      }
      return result
    } else {
      // Exclusion mode
      const result = { ...doc }
      for (const [field, value] of entries) {
        if (value === 0) {
          delete result[field]
        }
      }
      return result
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /** Get nested value from object */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /** Set nested value in object */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  /** Delete nested value from object */
  private deleteNestedValue(obj: Record<string, unknown>, path: string): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined) return
      current = current[part] as Record<string, unknown>
    }
    delete current[parts[parts.length - 1]]
  }

  /** Compare two values, returns -1, 0, or 1 */
  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return -1
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }

  /** Deep equality check */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (a === undefined || b === undefined) return a === b

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((v, i) => this.deepEquals(v, b[i]))
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object)
      const keysB = Object.keys(b as object)
      if (keysA.length !== keysB.length) return false
      return keysA.every(key =>
        this.deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      )
    }

    return false
  }
}
