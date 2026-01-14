/**
 * MongoDB-Compatible Collection Class
 *
 * Implements the MongoDB Collection interface using the unified primitives.
 *
 * @module db/compat/mongodb/collection
 */

import { QueryExecutor, evaluateFilterDirect } from './query'
import { AggregationExecutor } from './aggregation'
import { IndexManager, DuplicateKeyError } from './indexes'
import {
  ObjectId,
  MongoDuplicateKeyError,
  type Document,
  type WithId,
  type OptionalId,
  type Filter,
  type UpdateFilter,
  type Projection,
  type Sort,
  type SortDirection,
  type PipelineStage,
  type IndexSpecification,
  type CreateIndexOptions,
  type IndexInfo,
  type InsertOneResult,
  type InsertManyResult,
  type UpdateResult,
  type DeleteResult,
  type FindOptions,
  type FindCursor,
  type AggregationCursor,
  type UpdateOptions,
  type DeleteOptions,
  type InsertOneOptions,
  type InsertManyOptions,
  type CountDocumentsOptions,
  type AggregateOptions,
  type FindOneAndUpdateOptions,
  type FindOneAndDeleteOptions,
  type FindOneAndReplaceOptions,
  type Collection as ICollection,
} from './types'

// ============================================================================
// Find Cursor Implementation
// ============================================================================

/**
 * Document with metadata scores attached (for text/vector search)
 */
interface ScoredDocument<T extends Document> {
  doc: WithId<T>
  textScore?: number
  vectorScore?: number
}

/**
 * Cursor implementation for find operations
 */
class FindCursorImpl<T extends Document = Document> implements FindCursor<T> {
  private documents: WithId<T>[]
  private scoredDocuments: ScoredDocument<T>[] | null = null
  private position = 0
  private _closed = false
  private _filter: Filter<T>
  private _sort: Sort<T> | null = null
  private _skip: number | null = null
  private _limit: number | null = null
  private _projection: Projection<T> | null = null
  private _transform: ((doc: WithId<T>) => unknown) | null = null
  private _preFiltered = false

  constructor(documents: WithId<T>[], filter: Filter<T>, options?: { preFiltered?: boolean; scoredDocuments?: ScoredDocument<T>[] }) {
    this.documents = documents
    this._filter = filter
    this._preFiltered = options?.preFiltered ?? false
    this.scoredDocuments = options?.scoredDocuments ?? null
  }

  get closed(): boolean {
    return this._closed
  }

  async toArray(): Promise<WithId<T>[]> {
    return this.getResults()
  }

  async forEach(callback: (doc: WithId<T>) => void | Promise<void>): Promise<void> {
    const results = this.getResults()
    for (const doc of results) {
      await callback(doc)
    }
  }

  async hasNext(): Promise<boolean> {
    const results = this.getResults()
    return this.position < results.length
  }

  async next(): Promise<WithId<T> | null> {
    const results = this.getResults()
    if (this.position >= results.length) {
      return null
    }
    return results[this.position++] ?? null
  }

  async count(): Promise<number> {
    return this.getResults().length
  }

  limit(value: number): FindCursor<T> {
    this._limit = value
    return this
  }

  skip(value: number): FindCursor<T> {
    this._skip = value
    return this
  }

  sort(sort: Sort<T>): FindCursor<T> {
    this._sort = sort
    return this
  }

  project<P extends Document = Document>(projection: Projection<T>): FindCursor<P> {
    this._projection = projection
    return this as unknown as FindCursor<P>
  }

  filter(filter: Filter<T>): FindCursor<T> {
    this._filter = filter
    return this
  }

  map<U>(transform: (doc: WithId<T>) => U): FindCursor<U & Document> {
    this._transform = transform
    return this as unknown as FindCursor<U & Document>
  }

  async close(): Promise<void> {
    this._closed = true
  }

  [Symbol.asyncIterator](): AsyncIterator<WithId<T>> {
    const results = this.getResults()
    let index = 0
    return {
      async next(): Promise<IteratorResult<WithId<T>>> {
        if (index >= results.length) {
          return { value: undefined, done: true }
        }
        const result = results[index++]!
        return { value: result, done: false }
      },
    }
  }

  private getResults(): WithId<T>[] {
    // If pre-filtered (e.g., $text or $vector search), use scored documents
    let scoredResults: ScoredDocument<T>[]

    if (this._preFiltered && this.scoredDocuments) {
      scoredResults = this.scoredDocuments
    } else if (this._preFiltered) {
      // Pre-filtered but no scores
      scoredResults = this.documents.map((doc) => ({ doc }))
    } else {
      // Apply filter normally
      scoredResults = this.documents
        .filter((doc) => evaluateFilterDirect(this._filter, doc))
        .map((doc) => ({ doc }))
    }

    // Apply sort (check for $meta sort)
    if (this._sort) {
      scoredResults = this.applySortingWithScores(scoredResults, this._sort)
    }

    // Apply skip
    if (this._skip !== null && this._skip > 0) {
      scoredResults = scoredResults.slice(this._skip)
    }

    // Apply limit
    if (this._limit !== null && this._limit > 0) {
      scoredResults = scoredResults.slice(0, this._limit)
    }

    // Apply projection (with $meta support)
    let results: WithId<T>[]
    if (this._projection) {
      results = this.applyProjectionWithMeta(scoredResults, this._projection)
    } else {
      results = scoredResults.map((s) => s.doc)
    }

    // Apply transform
    if (this._transform) {
      results = results.map((doc) => this._transform!(doc)) as WithId<T>[]
    }

    return results
  }

  private applySortingWithScores(documents: ScoredDocument<T>[], sort: Sort<T>): ScoredDocument<T>[] {
    let sortSpec: Array<[string, SortDirection | { $meta: string }]>

    if (typeof sort === 'string') {
      sortSpec = [[sort, 1]]
    } else if (Array.isArray(sort)) {
      sortSpec = sort as Array<[string, SortDirection | { $meta: string }]>
    } else {
      sortSpec = Object.entries(sort) as Array<[string, SortDirection | { $meta: string }]>
    }

    return [...documents].sort((a, b) => {
      for (const [field, direction] of sortSpec) {
        // Check for $meta sort
        if (typeof direction === 'object' && direction !== null && '$meta' in direction) {
          const metaType = direction.$meta
          let aScore: number, bScore: number

          if (metaType === 'textScore') {
            aScore = a.textScore ?? 0
            bScore = b.textScore ?? 0
          } else if (metaType === 'vectorSearchScore') {
            aScore = a.vectorScore ?? 0
            bScore = b.vectorScore ?? 0
          } else {
            continue
          }

          // Scores should be sorted descending by default
          const cmp = bScore - aScore
          if (cmp !== 0) return cmp
          continue
        }

        const dir = this.normalizeDirection(direction as SortDirection)
        const aValue = this.getFieldValue(a.doc, field)
        const bValue = this.getFieldValue(b.doc, field)
        const cmp = this.compareValues(aValue, bValue)

        if (cmp !== 0) {
          return cmp * dir
        }
      }
      return 0
    })
  }

  private applyProjectionWithMeta(scoredDocuments: ScoredDocument<T>[], projection: Projection<T>): WithId<T>[] {
    const hasInclusions = Object.entries(projection).some(([key, value]) => {
      if (key === '_id') return false
      return value === 1 || value === true || (typeof value === 'object' && value !== null && '$meta' in value)
    })
    const excludeId = projection._id === 0 || projection._id === false

    return scoredDocuments.map(({ doc, textScore, vectorScore }) => {
      const result: Document = {}

      if (hasInclusions) {
        // Include mode
        if (!excludeId && '_id' in doc) {
          result._id = doc._id
        }

        for (const [key, value] of Object.entries(projection)) {
          if (key === '_id') continue

          // Handle $meta projection
          if (typeof value === 'object' && value !== null && '$meta' in value) {
            const metaType = (value as { $meta: string }).$meta
            if (metaType === 'textScore') {
              result[key] = textScore ?? 0
            } else if (metaType === 'vectorSearchScore') {
              result[key] = vectorScore ?? 0
            }
            continue
          }

          // Handle $elemMatch projection
          if (typeof value === 'object' && value !== null && '$elemMatch' in value) {
            const elemMatchCondition = (value as { $elemMatch: Record<string, unknown> }).$elemMatch
            const fieldValue = doc[key as keyof typeof doc]
            if (Array.isArray(fieldValue)) {
              const matchingElement = fieldValue.find((item) => {
                if (typeof item !== 'object' || item === null) return false
                return evaluateFilterDirect(elemMatchCondition as Filter<Document>, item as WithId<Document>)
              })
              if (matchingElement !== undefined) {
                result[key] = [matchingElement]
              }
            }
            continue
          }

          if (value === 1 || value === true) {
            if (key in doc) {
              result[key] = doc[key]
            }
          }
        }
      } else {
        // Exclude mode
        for (const [key, value] of Object.entries(doc)) {
          if (key === '_id' && excludeId) continue
          if (key in projection && (projection[key as keyof typeof projection] === 0 || projection[key as keyof typeof projection] === false)) {
            continue
          }
          result[key] = value
        }
      }

      return result as WithId<T>
    })
  }

  private applySorting(documents: WithId<T>[], sort: Sort<T>): WithId<T>[] {
    let sortSpec: Array<[string, SortDirection]>

    if (typeof sort === 'string') {
      sortSpec = [[sort, 1]]
    } else if (Array.isArray(sort)) {
      sortSpec = sort
    } else {
      sortSpec = Object.entries(sort) as Array<[string, SortDirection]>
    }

    return [...documents].sort((a, b) => {
      for (const [field, direction] of sortSpec) {
        const dir = this.normalizeDirection(direction)
        const aValue = this.getFieldValue(a, field)
        const bValue = this.getFieldValue(b, field)
        const cmp = this.compareValues(aValue, bValue)

        if (cmp !== 0) {
          return cmp * dir
        }
      }
      return 0
    })
  }

  private applyProjection(documents: WithId<T>[], projection: Projection<T>): WithId<T>[] {
    const hasInclusions = Object.values(projection).some((v) => v === 1 || v === true)
    const excludeId = projection._id === 0 || projection._id === false

    return documents.map((doc) => {
      const result: Document = {}

      if (hasInclusions) {
        // Include mode
        if (!excludeId && '_id' in doc) {
          result._id = doc._id
        }

        for (const [key, value] of Object.entries(projection)) {
          if (key === '_id') continue
          if (value === 1 || value === true) {
            if (key in doc) {
              result[key] = doc[key]
            }
          }
        }
      } else {
        // Exclude mode
        for (const [key, value] of Object.entries(doc)) {
          if (key === '_id' && excludeId) continue
          if (key in projection && (projection[key as keyof typeof projection] === 0 || projection[key as keyof typeof projection] === false)) {
            continue
          }
          result[key] = value
        }
      }

      return result as WithId<T>
    })
  }

  private normalizeDirection(dir: SortDirection): 1 | -1 {
    if (dir === 1 || dir === 'asc' || dir === 'ascending') return 1
    if (dir === -1 || dir === 'desc' || dir === 'descending') return -1
    return 1
  }

  private getFieldValue(doc: Document, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = doc
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }
}

// ============================================================================
// Aggregation Cursor Implementation
// ============================================================================

/**
 * Cursor implementation for aggregation operations
 */
class AggregationCursorImpl<T extends Document = Document> implements AggregationCursor<T> {
  private results: T[]
  private position = 0
  private _closed = false

  constructor(results: T[]) {
    this.results = results
  }

  get closed(): boolean {
    return this._closed
  }

  async toArray(): Promise<T[]> {
    return this.results
  }

  async forEach(callback: (doc: T) => void | Promise<void>): Promise<void> {
    for (const doc of this.results) {
      await callback(doc)
    }
  }

  async hasNext(): Promise<boolean> {
    return this.position < this.results.length
  }

  async next(): Promise<T | null> {
    if (this.position >= this.results.length) {
      return null
    }
    return this.results[this.position++] ?? null
  }

  async close(): Promise<void> {
    this._closed = true
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    let index = 0
    const results = this.results
    return {
      async next(): Promise<IteratorResult<T>> {
        if (index >= results.length) {
          return { value: undefined, done: true }
        }
        const result = results[index++]!
        return { value: result, done: false }
      },
    }
  }
}

// ============================================================================
// Collection Implementation
// ============================================================================

/**
 * MongoDB-compatible Collection implementation using unified primitives
 */
export class Collection<T extends Document = Document> implements ICollection<T> {
  readonly collectionName: string
  readonly dbName: string
  private documents: Map<string, WithId<T>> = new Map()
  private queryExecutor: QueryExecutor<T>
  private aggregationExecutor: AggregationExecutor<T>
  private indexManager: IndexManager<T>

  constructor(dbName: string, collectionName: string) {
    this.dbName = dbName
    this.collectionName = collectionName
    this.queryExecutor = new QueryExecutor<T>()
    this.aggregationExecutor = new AggregationExecutor<T>()
    this.indexManager = new IndexManager<T>()

    // Create default _id index
    this.indexManager.createIndex({ _id: 1 }, { name: '_id_', unique: true })
  }

  get namespace(): string {
    return `${this.dbName}.${this.collectionName}`
  }

  // ============================================================================
  // Insert Operations
  // ============================================================================

  async insertOne(doc: OptionalId<T>, options?: InsertOneOptions): Promise<InsertOneResult> {
    const _id = doc._id ?? new ObjectId()
    const fullDoc = { ...doc, _id } as WithId<T>

    // Check for duplicate _id
    if (this.documents.has(_id.toHexString())) {
      throw new MongoDuplicateKeyError(
        `E11000 duplicate key error`,
        { _id },
        { _id: 1 }
      )
    }

    try {
      // Index the document (may throw on unique constraint violation)
      this.indexManager.indexDocument(fullDoc)
    } catch (error) {
      if (error instanceof DuplicateKeyError) {
        throw new MongoDuplicateKeyError(
          `E11000 duplicate key error`,
          { value: error.value },
          {}
        )
      }
      throw error
    }

    // Store the document
    this.documents.set(_id.toHexString(), fullDoc)

    return {
      acknowledged: true,
      insertedId: _id,
    }
  }

  async insertMany(docs: OptionalId<T>[], options?: InsertManyOptions): Promise<InsertManyResult> {
    const ordered = options?.ordered ?? true
    const insertedIds: { [key: number]: ObjectId } = {}
    let insertedCount = 0

    for (let i = 0; i < docs.length; i++) {
      try {
        const doc = docs[i]!
        const result = await this.insertOne(doc)
        insertedIds[i] = result.insertedId
        insertedCount++
      } catch (error) {
        if (ordered) {
          throw error
        }
        // In unordered mode, continue on error but still throw at the end
      }
    }

    return {
      acknowledged: true,
      insertedCount,
      insertedIds,
    }
  }

  // ============================================================================
  // Find Operations
  // ============================================================================

  async findOne(filter: Filter<T> = {}, options?: FindOptions<T>): Promise<WithId<T> | null> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      return null
    }

    let result = matching[0]!

    // Apply projection if specified
    if (options?.projection) {
      result = this.applyProjection(result, options.projection)
    }

    return result
  }

  find(filter: Filter<T> = {}, options?: FindOptions<T>): FindCursor<T> {
    const allDocs = Array.from(this.documents.values())

    // Check for special operators that require index-based search
    const filterObj = filter as Record<string, unknown>

    // Handle $text operator (full-text search)
    if ('$text' in filterObj) {
      const textFilter = filterObj.$text as { $search: string; $language?: string; $caseSensitive?: boolean; $diacriticSensitive?: boolean }
      const searchQuery = this.parseTextSearch(textFilter.$search, {
        caseSensitive: textFilter.$caseSensitive,
        diacriticSensitive: textFilter.$diacriticSensitive,
      })

      // Build search terms - include words from phrases when no positive terms
      let searchTerms = searchQuery.positiveTerms
      if (searchTerms.length === 0 && searchQuery.phrases.length > 0) {
        // Extract words from phrases for index search
        searchTerms = searchQuery.phrases.flatMap((phrase) => phrase.split(/\s+/))
      }

      // Use text index to search
      const searchResults = this.indexManager.textSearch(searchTerms.join(' '))

      // Create document map for quick lookup
      const docMap = new Map<string, WithId<T>>()
      for (const doc of allDocs) {
        docMap.set(doc._id.toHexString(), doc)
      }

      // Filter results based on text search
      const scoredDocs: Array<{ doc: WithId<T>; textScore: number }> = []
      for (const result of searchResults) {
        const doc = docMap.get(result.docId)
        if (!doc) continue

        // Apply negative term filtering
        if (searchQuery.negativeTerms.length > 0) {
          // Get text field value from the document
          let hasNegativeTerm = false
          for (const negTerm of searchQuery.negativeTerms) {
            // Check all string fields for negative terms
            const textContent = this.extractTextContent(doc).toLowerCase()
            if (textContent.includes(negTerm.toLowerCase())) {
              hasNegativeTerm = true
              break
            }
          }
          if (hasNegativeTerm) continue
        }

        // Apply phrase filtering
        if (searchQuery.phrases.length > 0) {
          const textContent = this.extractTextContent(doc).toLowerCase()
          const hasAllPhrases = searchQuery.phrases.every((phrase) => textContent.includes(phrase.toLowerCase()))
          if (!hasAllPhrases) continue
        }

        // Apply remaining filter conditions (excluding $text)
        const remainingFilter = { ...filter }
        delete (remainingFilter as Record<string, unknown>).$text
        if (Object.keys(remainingFilter).length > 0) {
          if (!evaluateFilterDirect(remainingFilter, doc)) continue
        }

        scoredDocs.push({ doc, textScore: result.score })
      }

      const cursor = new FindCursorImpl<T>(
        scoredDocs.map((s) => s.doc),
        {},
        { preFiltered: true, scoredDocuments: scoredDocs }
      )

      if (options?.sort) {
        cursor.sort(options.sort)
      }
      if (options?.skip !== undefined) {
        cursor.skip(options.skip)
      }
      if (options?.limit !== undefined) {
        cursor.limit(options.limit)
      }
      if (options?.projection) {
        cursor.project(options.projection)
      }

      return cursor
    }

    // Handle $vector operator (vector similarity search)
    if ('$vector' in filterObj) {
      const vectorFilter = filterObj.$vector as {
        $near: number[]
        $k?: number
        $minScore?: number
        $maxDistance?: number
        $path?: string
      }
      const queryVector = vectorFilter.$near
      const k = vectorFilter.$k ?? 10
      const minScore = vectorFilter.$minScore
      const maxDistance = vectorFilter.$maxDistance
      const vectorPath = vectorFilter.$path ?? 'embedding'

      // Calculate cosine similarity for all documents with embeddings
      const scoredDocs: Array<{ doc: WithId<T>; vectorScore: number; distance: number }> = []

      for (const doc of allDocs) {
        const docVector = this.getFieldValue(doc, vectorPath) as number[] | undefined
        if (!docVector || !Array.isArray(docVector)) continue

        const similarity = this.cosineSimilarity(queryVector, docVector)
        const distance = 1 - similarity

        // Apply minScore filter
        if (minScore !== undefined && similarity < minScore) continue

        // Apply maxDistance filter
        if (maxDistance !== undefined && distance > maxDistance) continue

        // Apply remaining filter conditions (excluding $vector)
        const remainingFilter = { ...filter }
        delete (remainingFilter as Record<string, unknown>).$vector
        if (Object.keys(remainingFilter).length > 0) {
          if (!evaluateFilterDirect(remainingFilter, doc)) continue
        }

        scoredDocs.push({ doc, vectorScore: similarity, distance })
      }

      // Sort by similarity (descending) and take top K
      scoredDocs.sort((a, b) => b.vectorScore - a.vectorScore)
      const topK = scoredDocs.slice(0, k)

      const cursor = new FindCursorImpl<T>(
        topK.map((s) => s.doc),
        {},
        { preFiltered: true, scoredDocuments: topK.map((s) => ({ doc: s.doc, vectorScore: s.vectorScore })) }
      )

      if (options?.sort) {
        cursor.sort(options.sort)
      }
      if (options?.skip !== undefined) {
        cursor.skip(options.skip)
      }
      if (options?.limit !== undefined) {
        cursor.limit(options.limit)
      }
      if (options?.projection) {
        cursor.project(options.projection)
      }

      return cursor
    }

    // Standard find operation
    const cursor = new FindCursorImpl<T>(allDocs, filter)

    if (options?.sort) {
      cursor.sort(options.sort)
    }
    if (options?.skip !== undefined) {
      cursor.skip(options.skip)
    }
    if (options?.limit !== undefined) {
      cursor.limit(options.limit)
    }
    if (options?.projection) {
      cursor.project(options.projection)
    }

    return cursor
  }

  /**
   * Parse text search query to extract positive terms, negative terms, and phrases
   */
  private parseTextSearch(
    query: string,
    options?: { caseSensitive?: boolean; diacriticSensitive?: boolean }
  ): { positiveTerms: string[]; negativeTerms: string[]; phrases: string[] } {
    const positiveTerms: string[] = []
    const negativeTerms: string[] = []
    const phrases: string[] = []

    // Extract quoted phrases
    const phraseRegex = /"([^"]+)"/g
    let match
    let remainingQuery = query

    while ((match = phraseRegex.exec(query)) !== null) {
      phrases.push(match[1]!)
      remainingQuery = remainingQuery.replace(match[0], '')
    }

    // Split remaining query into terms
    const terms = remainingQuery.trim().split(/\s+/).filter((t) => t.length > 0)

    for (const term of terms) {
      if (term.startsWith('-')) {
        negativeTerms.push(term.slice(1))
      } else {
        positiveTerms.push(term)
      }
    }

    return { positiveTerms, negativeTerms, phrases }
  }

  /**
   * Extract all text content from a document for phrase matching
   */
  private extractTextContent(doc: WithId<T>): string {
    const textParts: string[] = []

    const extractFromValue = (value: unknown): void => {
      if (typeof value === 'string') {
        textParts.push(value)
      } else if (Array.isArray(value)) {
        for (const item of value) {
          extractFromValue(item)
        }
      } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) {
          extractFromValue(v)
        }
      }
    }

    extractFromValue(doc)
    return textParts.join(' ')
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }

    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  // ============================================================================
  // Update Operations
  // ============================================================================

  async updateOne(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      if (options?.upsert) {
        const newDoc = this.createFromUpdate(filter, update)
        const result = await this.insertOne(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
          upsertedId: result.insertedId,
        }
      }
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }
    }

    const doc = matching[0]!
    const oldDoc = { ...doc } as WithId<T>
    const newDoc = this.applyUpdate(doc, update)

    // Update indexes
    this.indexManager.updateDocument(oldDoc, newDoc)

    // Store updated document
    this.documents.set(newDoc._id.toHexString(), newDoc)

    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    }
  }

  async updateMany(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      if (options?.upsert) {
        const newDoc = this.createFromUpdate(filter, update)
        const result = await this.insertOne(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
          upsertedId: result.insertedId,
        }
      }
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }
    }

    let modifiedCount = 0

    for (const doc of matching) {
      const oldDoc = { ...doc } as WithId<T>
      const newDoc = this.applyUpdate(doc, update)

      this.indexManager.updateDocument(oldDoc, newDoc)
      this.documents.set(newDoc._id.toHexString(), newDoc)
      modifiedCount++
    }

    return {
      acknowledged: true,
      matchedCount: matching.length,
      modifiedCount,
      upsertedCount: 0,
    }
  }

  async replaceOne(filter: Filter<T>, replacement: T, options?: UpdateOptions): Promise<UpdateResult> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      if (options?.upsert) {
        const _id = new ObjectId()
        const newDoc = { ...replacement, _id } as WithId<T>
        await this.insertOne(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
          upsertedId: _id,
        }
      }
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }
    }

    const doc = matching[0]!
    const newDoc = { ...replacement, _id: doc._id } as WithId<T>

    this.indexManager.updateDocument(doc, newDoc)
    this.documents.set(newDoc._id.toHexString(), newDoc)

    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    }
  }

  // ============================================================================
  // Delete Operations
  // ============================================================================

  async deleteOne(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      return { acknowledged: true, deletedCount: 0 }
    }

    const doc = matching[0]!
    this.indexManager.unindexDocument(doc)
    this.documents.delete(doc._id.toHexString())

    return { acknowledged: true, deletedCount: 1 }
  }

  async deleteMany(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    for (const doc of matching) {
      this.indexManager.unindexDocument(doc)
      this.documents.delete(doc._id.toHexString())
    }

    return { acknowledged: true, deletedCount: matching.length }
  }

  // ============================================================================
  // Find and Modify Operations
  // ============================================================================

  async findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: FindOneAndUpdateOptions<T>
  ): Promise<WithId<T> | null> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      if (options?.upsert) {
        const newDoc = this.createFromUpdate(filter, update)
        await this.insertOne(newDoc)
        return options.returnDocument === 'after' ? newDoc as WithId<T> : null
      }
      return null
    }

    const doc = matching[0]!
    const before = { ...doc } as WithId<T>
    const after = this.applyUpdate(doc, update)

    this.indexManager.updateDocument(before, after)
    this.documents.set(after._id.toHexString(), after)

    return options?.returnDocument === 'after' ? after : before
  }

  async findOneAndDelete(filter: Filter<T>, options?: FindOneAndDeleteOptions<T>): Promise<WithId<T> | null> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      return null
    }

    const doc = matching[0]!
    this.indexManager.unindexDocument(doc)
    this.documents.delete(doc._id.toHexString())

    return doc
  }

  async findOneAndReplace(
    filter: Filter<T>,
    replacement: T,
    options?: FindOneAndReplaceOptions<T>
  ): Promise<WithId<T> | null> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (matching.length === 0) {
      if (options?.upsert) {
        const _id = new ObjectId()
        const newDoc = { ...replacement, _id } as WithId<T>
        await this.insertOne(newDoc)
        return options.returnDocument === 'after' ? newDoc : null
      }
      return null
    }

    const doc = matching[0]!
    const before = { ...doc } as WithId<T>
    const after = { ...replacement, _id: doc._id } as WithId<T>

    this.indexManager.updateDocument(before, after)
    this.documents.set(after._id.toHexString(), after)

    return options?.returnDocument === 'after' ? after : before
  }

  // ============================================================================
  // Aggregation
  // ============================================================================

  aggregate<R extends Document = Document>(
    pipeline: PipelineStage<T>[],
    options?: AggregateOptions
  ): AggregationCursor<R> {
    const allDocs = Array.from(this.documents.values())
    const results = this.aggregationExecutor.execute<R>(pipeline, allDocs)
    return new AggregationCursorImpl<R>(results)
  }

  // ============================================================================
  // Count Operations
  // ============================================================================

  async countDocuments(filter: Filter<T> = {}, options?: CountDocumentsOptions): Promise<number> {
    let allDocs = Array.from(this.documents.values())
    let matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    if (options?.skip) {
      matching = matching.slice(options.skip)
    }
    if (options?.limit) {
      matching = matching.slice(0, options.limit)
    }

    return matching.length
  }

  async estimatedDocumentCount(): Promise<number> {
    return this.documents.size
  }

  // ============================================================================
  // Distinct
  // ============================================================================

  async distinct<K extends keyof WithId<T>>(key: K, filter: Filter<T> = {}): Promise<WithId<T>[K][]> {
    const allDocs = Array.from(this.documents.values())
    const matching = allDocs.filter((doc) => evaluateFilterDirect(filter, doc))

    const seen = new Set<string>()
    const result: WithId<T>[K][] = []

    for (const doc of matching) {
      const value = this.getFieldValue(doc, String(key)) as WithId<T>[K]
      const key_str = JSON.stringify(value)

      if (!seen.has(key_str)) {
        seen.add(key_str)
        result.push(value)
      }
    }

    return result
  }

  // ============================================================================
  // Index Operations
  // ============================================================================

  async createIndex(keys: IndexSpecification, options?: CreateIndexOptions): Promise<string> {
    const indexName = this.indexManager.createIndex(keys, options)

    // Index existing documents
    for (const doc of this.documents.values()) {
      try {
        this.indexManager.indexDocument(doc)
      } catch {
        // Skip documents that violate unique constraint
      }
    }

    return indexName
  }

  async createIndexes(indexes: { key: IndexSpecification; options?: CreateIndexOptions }[]): Promise<string[]> {
    const names: string[] = []
    for (const { key, options } of indexes) {
      const name = await this.createIndex(key, options)
      names.push(name)
    }
    return names
  }

  async dropIndex(indexName: string): Promise<void> {
    this.indexManager.dropIndex(indexName)
  }

  async dropIndexes(): Promise<void> {
    this.indexManager.dropAllIndexes()
  }

  listIndexes(): FindCursor<IndexInfo> {
    const indexes = this.indexManager.listIndexes()
    return new FindCursorImpl<IndexInfo>(indexes as any, {})
  }

  async indexExists(name: string | string[]): Promise<boolean> {
    if (Array.isArray(name)) {
      return name.every((n) => this.indexManager.indexExists(n))
    }
    return this.indexManager.indexExists(name)
  }

  async indexes(): Promise<IndexInfo[]> {
    return this.indexManager.listIndexes()
  }

  // ============================================================================
  // Collection Operations
  // ============================================================================

  async drop(): Promise<boolean> {
    this.documents.clear()
    this.indexManager.clear()
    return true
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private applyProjection(doc: WithId<T>, projection: Projection<T>): WithId<T> {
    const hasInclusions = Object.values(projection).some((v) => v === 1 || v === true)
    const excludeId = projection._id === 0 || projection._id === false
    const result: Document = {}

    if (hasInclusions) {
      if (!excludeId && '_id' in doc) {
        result._id = doc._id
      }
      for (const [key, value] of Object.entries(projection)) {
        if (key === '_id') continue
        if (value === 1 || value === true) {
          if (key in doc) {
            result[key] = doc[key]
          }
        }
      }
    } else {
      for (const [key, value] of Object.entries(doc)) {
        if (key === '_id' && excludeId) continue
        if (key in projection && (projection[key as keyof typeof projection] === 0 || projection[key as keyof typeof projection] === false)) {
          continue
        }
        result[key] = value
      }
    }

    return result as WithId<T>
  }

  private applyUpdate(doc: WithId<T>, update: UpdateFilter<T>): WithId<T> {
    const result = { ...doc }

    // $set
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        this.setFieldValue(result, key, value)
      }
    }

    // $unset
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        this.deleteFieldValue(result, key)
      }
    }

    // $inc
    if (update.$inc) {
      for (const [key, amount] of Object.entries(update.$inc)) {
        const current = this.getFieldValue(result, key)
        const newValue = (typeof current === 'number' ? current : 0) + (amount as number)
        this.setFieldValue(result, key, newValue)
      }
    }

    // $mul
    if (update.$mul) {
      for (const [key, factor] of Object.entries(update.$mul)) {
        const current = this.getFieldValue(result, key)
        const newValue = (typeof current === 'number' ? current : 0) * (factor as number)
        this.setFieldValue(result, key, newValue)
      }
    }

    // $min
    if (update.$min) {
      for (const [key, value] of Object.entries(update.$min)) {
        const current = this.getFieldValue(result, key)
        if (current === undefined || this.compareValues(value, current) < 0) {
          this.setFieldValue(result, key, value)
        }
      }
    }

    // $max
    if (update.$max) {
      for (const [key, value] of Object.entries(update.$max)) {
        const current = this.getFieldValue(result, key)
        if (current === undefined || this.compareValues(value, current) > 0) {
          this.setFieldValue(result, key, value)
        }
      }
    }

    // $push
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        const current = this.getFieldValue(result, key)
        const arr = Array.isArray(current) ? [...current] : []

        if (typeof value === 'object' && value !== null && '$each' in (value as object)) {
          const pushSpec = value as { $each?: unknown[] }
          if (Array.isArray(pushSpec.$each)) {
            arr.push(...pushSpec.$each)
          }
        } else {
          arr.push(value)
        }

        this.setFieldValue(result, key, arr)
      }
    }

    // $pull
    if (update.$pull) {
      for (const [key, condition] of Object.entries(update.$pull)) {
        const current = this.getFieldValue(result, key)
        if (Array.isArray(current)) {
          const filtered = current.filter((item) => {
            if (typeof condition === 'object' && condition !== null) {
              return !evaluateFilterDirect(condition as Filter<Document>, item as WithId<Document>)
            }
            return !this.equalValues(item, condition)
          })
          this.setFieldValue(result, key, filtered)
        }
      }
    }

    // $addToSet
    if (update.$addToSet) {
      for (const [key, value] of Object.entries(update.$addToSet)) {
        const current = this.getFieldValue(result, key)
        const arr = Array.isArray(current) ? [...current] : []

        if (typeof value === 'object' && value !== null && '$each' in (value as object)) {
          const addSpec = value as { $each?: unknown[] }
          if (Array.isArray(addSpec.$each)) {
            for (const item of addSpec.$each) {
              if (!arr.some((existing) => this.equalValues(existing, item))) {
                arr.push(item)
              }
            }
          }
        } else {
          if (!arr.some((existing) => this.equalValues(existing, value))) {
            arr.push(value)
          }
        }

        this.setFieldValue(result, key, arr)
      }
    }

    // $pop
    if (update.$pop) {
      for (const [key, direction] of Object.entries(update.$pop)) {
        const current = this.getFieldValue(result, key)
        if (Array.isArray(current)) {
          const arr = [...current]
          if (direction === 1) {
            arr.pop()
          } else {
            arr.shift()
          }
          this.setFieldValue(result, key, arr)
        }
      }
    }

    // $currentDate
    if (update.$currentDate) {
      for (const [key, value] of Object.entries(update.$currentDate)) {
        this.setFieldValue(result, key, new Date())
      }
    }

    return result as WithId<T>
  }

  private createFromUpdate(filter: Filter<T>, update: UpdateFilter<T>): OptionalId<T> {
    const doc: Document = {}

    // Extract equality conditions from filter
    for (const [key, value] of Object.entries(filter)) {
      if (!key.startsWith('$') && typeof value !== 'object') {
        doc[key] = value
      }
    }

    // Apply $set and $setOnInsert
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        this.setFieldValue(doc, key, value)
      }
    }

    if (update.$setOnInsert) {
      for (const [key, value] of Object.entries(update.$setOnInsert)) {
        this.setFieldValue(doc, key, value)
      }
    }

    return doc as OptionalId<T>
  }

  private getFieldValue(doc: Document, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = doc
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  private setFieldValue(doc: Document, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = doc

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]!
    current[lastPart] = value
  }

  private deleteFieldValue(doc: Document, path: string): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = doc

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (!(part in current) || typeof current[part] !== 'object') {
        return
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]!
    delete current[lastPart]
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }

  private equalValues(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }
}
