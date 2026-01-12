/**
 * MongoDB Index Management using InvertedIndex Primitive
 *
 * Leverages the unified InvertedIndex for full-text search and
 * secondary indexes on document collections.
 *
 * @module db/compat/mongodb/indexes
 */

import { TagIndex, type Tags } from '../../primitives/inverted-index'
import { BM25Scorer, type IndexStats } from '../../primitives/inverted-index'
import type {
  Document,
  IndexSpecification,
  CreateIndexOptions,
  IndexInfo,
  WithId,
  ObjectId,
  Filter,
} from './types'

// ============================================================================
// Index Types
// ============================================================================

/**
 * Index entry for a document field
 */
interface IndexEntry {
  docId: string
  value: unknown
  score?: number
}

/**
 * Single field index implementation
 */
class FieldIndex {
  private entries: Map<string, Set<string>> = new Map()
  private docValues: Map<string, unknown> = new Map()

  add(docId: string, value: unknown): void {
    this.docValues.set(docId, value)

    const key = this.normalizeKey(value)
    if (!this.entries.has(key)) {
      this.entries.set(key, new Set())
    }
    this.entries.get(key)!.add(docId)
  }

  remove(docId: string): void {
    const value = this.docValues.get(docId)
    if (value !== undefined) {
      const key = this.normalizeKey(value)
      this.entries.get(key)?.delete(docId)
      this.docValues.delete(docId)
    }
  }

  find(value: unknown): string[] {
    const key = this.normalizeKey(value)
    return Array.from(this.entries.get(key) ?? [])
  }

  findRange(min: unknown, max: unknown, includeMin = true, includeMax = true): string[] {
    const result = new Set<string>()

    for (const [docId, value] of this.docValues) {
      const cmp = this.compareValues(value, min)
      const cmpMax = this.compareValues(value, max)

      const minOk = includeMin ? cmp >= 0 : cmp > 0
      const maxOk = includeMax ? cmpMax <= 0 : cmpMax < 0

      if (minOk && maxOk) {
        result.add(docId)
      }
    }

    return Array.from(result)
  }

  findIn(values: unknown[]): string[] {
    const result = new Set<string>()
    for (const value of values) {
      const docIds = this.find(value)
      for (const docId of docIds) {
        result.add(docId)
      }
    }
    return Array.from(result)
  }

  clear(): void {
    this.entries.clear()
    this.docValues.clear()
  }

  get size(): number {
    return this.docValues.size
  }

  private normalizeKey(value: unknown): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1

    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }

    return String(a).localeCompare(String(b))
  }
}

/**
 * Unique index with duplicate checking
 */
class UniqueFieldIndex extends FieldIndex {
  private uniqueValues: Map<string, string> = new Map()

  add(docId: string, value: unknown): void {
    const key = this.normalizeKey(value)

    // Check for duplicate
    const existingDocId = this.uniqueValues.get(key)
    if (existingDocId && existingDocId !== docId) {
      throw new DuplicateKeyError(docId, value)
    }

    this.uniqueValues.set(key, docId)
    super.add(docId, value)
  }

  remove(docId: string): void {
    // Find and remove from unique values
    for (const [key, id] of this.uniqueValues) {
      if (id === docId) {
        this.uniqueValues.delete(key)
        break
      }
    }
    super.remove(docId)
  }

  clear(): void {
    this.uniqueValues.clear()
    super.clear()
  }

  private normalizeKey(value: unknown): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
}

/**
 * Text index using BM25 scoring
 */
class TextIndex {
  private termDocs: Map<string, Set<string>> = new Map()
  private docTerms: Map<string, Map<string, number>> = new Map()
  private scorer: BM25Scorer
  private totalDocs = 0
  private avgDocLength = 0

  constructor() {
    this.scorer = new BM25Scorer()
  }

  add(docId: string, text: string): void {
    const terms = this.tokenize(text)
    const termFrequencies = new Map<string, number>()

    for (const term of terms) {
      termFrequencies.set(term, (termFrequencies.get(term) ?? 0) + 1)

      if (!this.termDocs.has(term)) {
        this.termDocs.set(term, new Set())
      }
      this.termDocs.get(term)!.add(docId)
    }

    this.docTerms.set(docId, termFrequencies)
    this.totalDocs++
    this.updateAvgDocLength()
  }

  remove(docId: string): void {
    const terms = this.docTerms.get(docId)
    if (terms) {
      for (const term of terms.keys()) {
        this.termDocs.get(term)?.delete(docId)
        if (this.termDocs.get(term)?.size === 0) {
          this.termDocs.delete(term)
        }
      }
      this.docTerms.delete(docId)
      this.totalDocs--
      this.updateAvgDocLength()
    }
  }

  search(query: string, limit?: number): Array<{ docId: string; score: number }> {
    const queryTerms = this.tokenize(query)
    const scores = new Map<string, number>()

    for (const term of queryTerms) {
      const docs = this.termDocs.get(term)
      if (!docs) continue

      const df = docs.size
      for (const docId of docs) {
        const docTermFreqs = this.docTerms.get(docId)
        if (!docTermFreqs) continue

        const tf = docTermFreqs.get(term) ?? 0
        const docLength = Array.from(docTermFreqs.values()).reduce((a, b) => a + b, 0)

        const score = this.scorer.score({
          totalDocs: this.totalDocs,
          avgDocLength: this.avgDocLength,
          docLength,
          termFrequency: tf,
          documentFrequency: df,
        })

        scores.set(docId, (scores.get(docId) ?? 0) + score)
      }
    }

    const results = Array.from(scores.entries())
      .map(([docId, score]) => ({ docId, score }))
      .sort((a, b) => b.score - a.score)

    return limit ? results.slice(0, limit) : results
  }

  clear(): void {
    this.termDocs.clear()
    this.docTerms.clear()
    this.totalDocs = 0
    this.avgDocLength = 0
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0)
  }

  private updateAvgDocLength(): void {
    if (this.totalDocs === 0) {
      this.avgDocLength = 0
      return
    }

    let totalLength = 0
    for (const terms of this.docTerms.values()) {
      totalLength += Array.from(terms.values()).reduce((a, b) => a + b, 0)
    }
    this.avgDocLength = totalLength / this.totalDocs
  }
}

/**
 * Compound index on multiple fields
 */
class CompoundIndex {
  private entries: Map<string, Set<string>> = new Map()
  private docValues: Map<string, unknown[]> = new Map()
  private fields: string[]
  private directions: number[]

  constructor(spec: IndexSpecification) {
    this.fields = Object.keys(spec)
    this.directions = Object.values(spec).map((v) => (v === -1 ? -1 : 1))
  }

  add(docId: string, values: unknown[]): void {
    const key = this.normalizeKey(values)
    this.docValues.set(docId, values)

    if (!this.entries.has(key)) {
      this.entries.set(key, new Set())
    }
    this.entries.get(key)!.add(docId)
  }

  remove(docId: string): void {
    const values = this.docValues.get(docId)
    if (values) {
      const key = this.normalizeKey(values)
      this.entries.get(key)?.delete(docId)
      this.docValues.delete(docId)
    }
  }

  find(values: unknown[]): string[] {
    const key = this.normalizeKey(values)
    return Array.from(this.entries.get(key) ?? [])
  }

  clear(): void {
    this.entries.clear()
    this.docValues.clear()
  }

  private normalizeKey(values: unknown[]): string {
    return values.map((v) => (v === null ? 'null' : JSON.stringify(v))).join(':')
  }
}

// ============================================================================
// Index Manager
// ============================================================================

/**
 * Error thrown when a duplicate key is inserted into a unique index
 */
export class DuplicateKeyError extends Error {
  docId: string
  value: unknown

  constructor(docId: string, value: unknown) {
    super(`Duplicate key error: ${JSON.stringify(value)}`)
    this.name = 'DuplicateKeyError'
    this.docId = docId
    this.value = value
  }
}

/**
 * Manages indexes for a collection
 */
export class IndexManager<T extends Document = Document> {
  private fieldIndexes: Map<string, FieldIndex | UniqueFieldIndex> = new Map()
  private textIndexes: Map<string, TextIndex> = new Map()
  private compoundIndexes: Map<string, CompoundIndex> = new Map()
  private indexInfos: Map<string, IndexInfo> = new Map()

  /**
   * Create an index on the collection
   */
  createIndex(keys: IndexSpecification, options?: CreateIndexOptions): string {
    const indexName = options?.name ?? this.generateIndexName(keys)

    // Check if index already exists
    if (this.indexInfos.has(indexName)) {
      return indexName
    }

    const keyEntries = Object.entries(keys)

    if (keyEntries.length === 1) {
      const [field, type] = keyEntries[0]

      if (type === 'text') {
        // Text index
        const index = new TextIndex()
        this.textIndexes.set(indexName, index)
      } else {
        // Single field index
        const index = options?.unique ? new UniqueFieldIndex() : new FieldIndex()
        this.fieldIndexes.set(indexName, index)
      }
    } else {
      // Compound index
      const index = new CompoundIndex(keys)
      this.compoundIndexes.set(indexName, index)
    }

    // Store index info
    this.indexInfos.set(indexName, {
      name: indexName,
      key: keys,
      unique: options?.unique,
      sparse: options?.sparse,
      expireAfterSeconds: options?.expireAfterSeconds,
      v: 2,
    })

    return indexName
  }

  /**
   * Drop an index by name
   */
  dropIndex(indexName: string): void {
    this.fieldIndexes.delete(indexName)
    this.textIndexes.delete(indexName)
    this.compoundIndexes.delete(indexName)
    this.indexInfos.delete(indexName)
  }

  /**
   * Drop all indexes except _id
   */
  dropAllIndexes(): void {
    for (const name of this.indexInfos.keys()) {
      if (name !== '_id_') {
        this.dropIndex(name)
      }
    }
  }

  /**
   * List all indexes
   */
  listIndexes(): IndexInfo[] {
    return Array.from(this.indexInfos.values())
  }

  /**
   * Check if an index exists
   */
  indexExists(name: string): boolean {
    return this.indexInfos.has(name)
  }

  /**
   * Get index by name
   */
  getIndex(name: string): IndexInfo | undefined {
    return this.indexInfos.get(name)
  }

  /**
   * Index a document
   */
  indexDocument(doc: WithId<T>): void {
    const docId = doc._id.toHexString()

    for (const [indexName, info] of this.indexInfos) {
      const keyEntries = Object.entries(info.key)

      if (keyEntries.length === 1) {
        const [field, type] = keyEntries[0]

        if (type === 'text') {
          // Text index
          const textIndex = this.textIndexes.get(indexName)
          const value = this.getFieldValue(doc, field)
          if (typeof value === 'string' && textIndex) {
            textIndex.add(docId, value)
          }
        } else {
          // Field index
          const fieldIndex = this.fieldIndexes.get(indexName)
          const value = this.getFieldValue(doc, field)

          // Skip if sparse and value is undefined
          if (info.sparse && value === undefined) continue

          if (fieldIndex) {
            fieldIndex.add(docId, value)
          }
        }
      } else {
        // Compound index
        const compoundIndex = this.compoundIndexes.get(indexName)
        const values = keyEntries.map(([field]) => this.getFieldValue(doc, field))

        // Skip if sparse and any value is undefined
        if (info.sparse && values.some((v) => v === undefined)) continue

        if (compoundIndex) {
          compoundIndex.add(docId, values)
        }
      }
    }
  }

  /**
   * Remove a document from all indexes
   */
  unindexDocument(doc: WithId<T>): void {
    const docId = doc._id.toHexString()

    for (const [indexName] of this.indexInfos) {
      const fieldIndex = this.fieldIndexes.get(indexName)
      if (fieldIndex) {
        fieldIndex.remove(docId)
        continue
      }

      const textIndex = this.textIndexes.get(indexName)
      if (textIndex) {
        textIndex.remove(docId)
        continue
      }

      const compoundIndex = this.compoundIndexes.get(indexName)
      if (compoundIndex) {
        compoundIndex.remove(docId)
      }
    }
  }

  /**
   * Update a document in all indexes
   */
  updateDocument(oldDoc: WithId<T>, newDoc: WithId<T>): void {
    this.unindexDocument(oldDoc)
    this.indexDocument(newDoc)
  }

  /**
   * Find documents using an index (returns document IDs)
   */
  findUsingIndex(indexName: string, filter: Filter<T>): string[] | null {
    const info = this.indexInfos.get(indexName)
    if (!info) return null

    const keyEntries = Object.entries(info.key)
    if (keyEntries.length !== 1) return null

    const [field] = keyEntries

    // Check if filter matches this index
    if (!(field in filter)) return null

    const condition = filter[field as keyof typeof filter]
    const fieldIndex = this.fieldIndexes.get(indexName)

    if (!fieldIndex) return null

    // Direct equality
    if (condition === null || typeof condition !== 'object') {
      return fieldIndex.find(condition)
    }

    const operators = condition as Record<string, unknown>

    // $eq operator
    if ('$eq' in operators) {
      return fieldIndex.find(operators.$eq)
    }

    // $in operator
    if ('$in' in operators && Array.isArray(operators.$in)) {
      return fieldIndex.findIn(operators.$in)
    }

    // $gt/$gte/$lt/$lte operators
    if ('$gt' in operators || '$gte' in operators || '$lt' in operators || '$lte' in operators) {
      const min = operators.$gt ?? operators.$gte ?? null
      const max = operators.$lt ?? operators.$lte ?? null
      const includeMin = !('$gt' in operators)
      const includeMax = !('$lt' in operators)

      if (min !== null && max !== null) {
        return fieldIndex.findRange(min, max, includeMin, includeMax)
      }
    }

    return null
  }

  /**
   * Perform text search
   */
  textSearch(query: string, limit?: number): Array<{ docId: string; score: number }> {
    // Find text index
    for (const [indexName, info] of this.indexInfos) {
      const hasTextIndex = Object.values(info.key).some((v) => v === 'text')
      if (hasTextIndex) {
        const textIndex = this.textIndexes.get(indexName)
        if (textIndex) {
          return textIndex.search(query, limit)
        }
      }
    }
    return []
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    for (const index of this.fieldIndexes.values()) {
      index.clear()
    }
    for (const index of this.textIndexes.values()) {
      index.clear()
    }
    for (const index of this.compoundIndexes.values()) {
      index.clear()
    }
  }

  /**
   * Generate index name from key specification
   */
  private generateIndexName(keys: IndexSpecification): string {
    return Object.entries(keys)
      .map(([field, dir]) => `${field}_${dir}`)
      .join('_')
  }

  /**
   * Get a field value from a document using dot notation
   */
  private getFieldValue(doc: Document, path: string): unknown {
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
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an index manager for a collection
 */
export function createIndexManager<T extends Document = Document>(): IndexManager<T> {
  return new IndexManager<T>()
}
