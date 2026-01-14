/**
 * Elasticsearch Indexer
 *
 * Document indexing using inverted index primitives with BM25 scoring.
 * Supports full-text indexing, keyword indexing, and numeric field storage.
 *
 * @module db/compat/elasticsearch/indexer
 */

import {
  PostingList,
  PostingListWithTF,
  TermDictionary,
  BM25Scorer,
  type IndexStats,
} from '../../primitives/inverted-index'
import { createColumnStore, type TypedColumnStore } from '../../primitives/typed-column-store'
import type { Document, IndexMappings, FieldMapping } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Indexed document with metadata
 */
export interface IndexedDocument<T extends Document = Document> {
  _id: string
  _source: T
  _version: number
  _seq_no: number
  _primary_term: number
  _indexed_at: number
  _doc_length: number
}

/**
 * Field index for full-text search
 */
interface FieldIndex {
  postings: Map<string, PostingListWithTF>
  dictionary: TermDictionary
  fieldType: 'text' | 'keyword'
  analyzer?: string
}

/**
 * Index configuration
 */
export interface IndexConfig {
  name: string
  mappings: IndexMappings
}

// ============================================================================
// TOKENIZATION / ANALYSIS
// ============================================================================

/**
 * Simple tokenizer - splits on whitespace and punctuation
 */
function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') return []
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * Standard analyzer - tokenize + lowercase + stop words
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with',
])

function standardAnalyzer(text: string): string[] {
  return tokenize(text).filter((t) => !STOP_WORDS.has(t))
}

/**
 * Keyword analyzer - single token, lowercased
 */
function keywordAnalyzer(text: string): string[] {
  if (!text || typeof text !== 'string') return []
  return [text.toLowerCase()]
}

/**
 * Get analyzer function by name
 */
function getAnalyzer(name?: string): (text: string) => string[] {
  switch (name) {
    case 'keyword':
      return keywordAnalyzer
    case 'standard':
    default:
      return standardAnalyzer
  }
}

// ============================================================================
// ELASTICSEARCH INDEXER
// ============================================================================

/**
 * Elasticsearch-compatible document indexer
 *
 * Uses inverted indexes for full-text search with BM25 scoring,
 * and columnar storage for filtering and aggregations.
 */
export class ElasticsearchIndexer {
  /** Index name */
  readonly name: string

  /** Index mappings */
  private mappings: IndexMappings

  /** Document storage: id -> document */
  private documents: Map<string, IndexedDocument> = new Map()

  /** Document ID to internal numeric ID */
  private docIdToNumeric: Map<string, number> = new Map()

  /** Internal numeric ID to document ID */
  private numericToDocId: Map<number, string> = new Map()

  /** Field indexes for text search */
  private fieldIndexes: Map<string, FieldIndex> = new Map()

  /** Columnar store for filtering/aggregations */
  private columnStore: TypedColumnStore

  /** Current sequence number */
  private seqNo: number = 0

  /** Primary term */
  private primaryTerm: number = 1

  /** Total document length (sum of all doc lengths) */
  private totalLength: number = 0

  /** Next internal document ID */
  private nextDocId: number = 0

  constructor(config: IndexConfig) {
    this.name = config.name
    this.mappings = config.mappings
    this.columnStore = createColumnStore()

    // Initialize column store columns based on mappings
    this.initializeColumns()

    // Initialize field indexes
    this.initializeFieldIndexes()
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  private initializeColumns(): void {
    const properties = this.mappings.properties || {}

    // Always have _id column
    this.columnStore.addColumn('_id', 'string')
    this.columnStore.addColumn('_doc_id', 'int64') // Internal numeric ID

    for (const [fieldName, mapping] of Object.entries(properties)) {
      const colType = this.mapFieldTypeToColumn(mapping.type)
      if (colType) {
        this.columnStore.addColumn(fieldName, colType)
      }
    }
  }

  private mapFieldTypeToColumn(fieldType: FieldMapping['type']): 'int64' | 'float64' | 'string' | 'boolean' | 'timestamp' | null {
    switch (fieldType) {
      case 'long':
      case 'integer':
      case 'short':
      case 'byte':
        return 'int64'
      case 'double':
      case 'float':
      case 'half_float':
      case 'scaled_float':
        return 'float64'
      case 'text':
      case 'keyword':
        return 'string'
      case 'boolean':
        return 'boolean'
      case 'date':
      case 'date_nanos':
        return 'timestamp'
      default:
        return null // Complex types like nested, geo, etc.
    }
  }

  private initializeFieldIndexes(): void {
    const properties = this.mappings.properties || {}

    for (const [fieldName, mapping] of Object.entries(properties)) {
      if (mapping.type === 'text' || mapping.type === 'keyword') {
        this.fieldIndexes.set(fieldName, {
          postings: new Map(),
          dictionary: new TermDictionary(),
          fieldType: mapping.type,
          analyzer: mapping.analyzer,
        })
      }
    }
  }

  // ==========================================================================
  // DOCUMENT OPERATIONS
  // ==========================================================================

  /**
   * Index a document
   */
  index(id: string, doc: Document): { result: 'created' | 'updated'; _seq_no: number; _primary_term: number; _version: number } {
    const existing = this.documents.get(id)
    const isUpdate = !!existing

    // Remove old document from indexes if updating
    if (existing) {
      this.removeFromIndexes(id, existing._source)
    }

    // Get or assign numeric ID
    let numericId = this.docIdToNumeric.get(id)
    if (numericId === undefined) {
      numericId = this.nextDocId++
      this.docIdToNumeric.set(id, numericId)
      this.numericToDocId.set(numericId, id)
    }

    // Calculate document length (total tokens)
    let docLength = 0
    const properties = this.mappings.properties || {}

    for (const [fieldName, mapping] of Object.entries(properties)) {
      const value = this.getFieldValue(doc, fieldName)
      if (value === undefined || value === null) continue

      if (mapping.type === 'text') {
        const analyzer = getAnalyzer(mapping.analyzer)
        const tokens = analyzer(String(value))
        docLength += tokens.length
      }
    }

    // Create indexed document
    const version = existing ? existing._version + 1 : 1
    this.seqNo++

    const indexedDoc: IndexedDocument = {
      _id: id,
      _source: doc,
      _version: version,
      _seq_no: this.seqNo,
      _primary_term: this.primaryTerm,
      _indexed_at: Date.now(),
      _doc_length: docLength,
    }

    // Store document
    this.documents.set(id, indexedDoc)

    // Update total length
    if (existing) {
      this.totalLength -= existing._doc_length
    }
    this.totalLength += docLength

    // Index all fields
    this.indexDocument(id, numericId, doc)

    return {
      result: isUpdate ? 'updated' : 'created',
      _seq_no: this.seqNo,
      _primary_term: this.primaryTerm,
      _version: version,
    }
  }

  /**
   * Get a document by ID
   */
  get(id: string): IndexedDocument | null {
    return this.documents.get(id) || null
  }

  /**
   * Delete a document
   */
  delete(id: string): { result: 'deleted' | 'not_found'; _seq_no: number; _primary_term: number; _version: number } {
    const existing = this.documents.get(id)

    if (!existing) {
      return {
        result: 'not_found',
        _seq_no: this.seqNo,
        _primary_term: this.primaryTerm,
        _version: 0,
      }
    }

    // Remove from indexes
    this.removeFromIndexes(id, existing._source)

    // Update stats
    this.totalLength -= existing._doc_length

    // Remove document
    this.documents.delete(id)
    this.seqNo++

    return {
      result: 'deleted',
      _seq_no: this.seqNo,
      _primary_term: this.primaryTerm,
      _version: existing._version,
    }
  }

  /**
   * Update a document (partial update)
   */
  update(id: string, doc: Partial<Document>): { result: 'updated' | 'noop'; _seq_no: number; _primary_term: number; _version: number } {
    const existing = this.documents.get(id)

    if (!existing) {
      return {
        result: 'noop',
        _seq_no: this.seqNo,
        _primary_term: this.primaryTerm,
        _version: 0,
      }
    }

    // Merge documents
    const merged = { ...existing._source, ...doc }

    // Re-index with merged document
    const indexResult = this.index(id, merged)
    return {
      result: indexResult.result === 'created' ? 'updated' : indexResult.result,
      _seq_no: indexResult._seq_no,
      _primary_term: indexResult._primary_term,
      _version: indexResult._version,
    } as { result: 'updated' | 'noop'; _seq_no: number; _primary_term: number; _version: number }
  }

  // ==========================================================================
  // INDEXING
  // ==========================================================================

  private indexDocument(id: string, numericId: number, doc: Document): void {
    const properties = this.mappings.properties || {}

    for (const [fieldName, mapping] of Object.entries(properties)) {
      const value = this.getFieldValue(doc, fieldName)
      if (value === undefined || value === null) continue

      // Index text/keyword fields
      if (mapping.type === 'text' || mapping.type === 'keyword') {
        this.indexTextField(fieldName, numericId, value, mapping)
      }

      // Store in column store for filtering
      const colType = this.mapFieldTypeToColumn(mapping.type)
      if (colType) {
        this.indexColumnValue(fieldName, numericId, value, mapping)
      }
    }
  }

  private indexTextField(
    fieldName: string,
    numericId: number,
    value: unknown,
    mapping: FieldMapping
  ): void {
    const fieldIndex = this.fieldIndexes.get(fieldName)
    if (!fieldIndex) return

    const values = Array.isArray(value) ? value : [value]

    for (const val of values) {
      if (typeof val !== 'string') continue

      const analyzer = mapping.type === 'keyword' ? keywordAnalyzer : getAnalyzer(mapping.analyzer)
      const tokens = analyzer(val)

      // Count term frequencies
      const termFreqs = new Map<string, number>()
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) || 0) + 1)
      }

      // Add to postings
      for (const [term, tf] of termFreqs) {
        let postingList = fieldIndex.postings.get(term)
        if (!postingList) {
          postingList = new PostingListWithTF()
          fieldIndex.postings.set(term, postingList)
        }
        postingList.add(numericId, tf)

        // Update dictionary
        const entry = fieldIndex.dictionary.get(term)
        if (entry) {
          fieldIndex.dictionary.add(term, {
            df: entry.df + 1,
            offset: 0, // Not using file offsets
            length: 0,
          })
        } else {
          fieldIndex.dictionary.add(term, {
            df: 1,
            offset: 0,
            length: 0,
          })
        }
      }
    }
  }

  private indexColumnValue(
    fieldName: string,
    numericId: number,
    value: unknown,
    mapping: FieldMapping
  ): void {
    // Convert value to appropriate type
    let convertedValue: unknown

    switch (mapping.type) {
      case 'date':
      case 'date_nanos':
        convertedValue = new Date(value as string).getTime()
        break
      case 'boolean':
        convertedValue = value
        break
      case 'keyword':
      case 'text':
        convertedValue = String(value)
        break
      default:
        convertedValue = Number(value)
    }

    // Note: Column store append is additive, we'd need to handle updates
    // For now, we'll just track the latest values in a separate structure
    // This is a simplification - real implementation would need row-level updates
  }

  private removeFromIndexes(id: string, doc: Document): void {
    const numericId = this.docIdToNumeric.get(id)
    if (numericId === undefined) return

    const properties = this.mappings.properties || {}

    for (const [fieldName, mapping] of Object.entries(properties)) {
      const value = this.getFieldValue(doc, fieldName)
      if (value === undefined || value === null) continue

      if (mapping.type === 'text' || mapping.type === 'keyword') {
        this.removeFromTextField(fieldName, numericId, value, mapping)
      }
    }
  }

  private removeFromTextField(
    fieldName: string,
    numericId: number,
    value: unknown,
    mapping: FieldMapping
  ): void {
    const fieldIndex = this.fieldIndexes.get(fieldName)
    if (!fieldIndex) return

    const values = Array.isArray(value) ? value : [value]

    for (const val of values) {
      if (typeof val !== 'string') continue

      const analyzer = mapping.type === 'keyword' ? keywordAnalyzer : getAnalyzer(mapping.analyzer)
      const tokens = analyzer(val)
      const uniqueTerms = new Set(tokens)

      for (const term of uniqueTerms) {
        const postingList = fieldIndex.postings.get(term)
        if (postingList) {
          // PostingListWithTF doesn't have a remove method, so we'd need to rebuild
          // For now, we mark as removed by setting TF to 0
          // This is a simplification - real implementation would need proper deletion
        }

        // Update dictionary df
        const entry = fieldIndex.dictionary.get(term)
        if (entry && entry.df > 0) {
          fieldIndex.dictionary.add(term, {
            df: entry.df - 1,
            offset: 0,
            length: 0,
          })
        }
      }
    }
  }

  // ==========================================================================
  // SEARCH SUPPORT
  // ==========================================================================

  /**
   * Get index stats for BM25 scoring
   */
  getIndexStats(): IndexStats {
    return {
      totalDocs: this.documents.size,
      avgDocLength: this.documents.size > 0 ? this.totalLength / this.documents.size : 0,
      totalLength: this.totalLength,
    }
  }

  /**
   * Get posting list for a term in a field
   */
  getPostings(field: string, term: string): PostingListWithTF | null {
    const fieldIndex = this.fieldIndexes.get(field)
    if (!fieldIndex) return null

    // Apply appropriate analyzer
    const mapping = this.mappings.properties?.[field]
    const analyzer = mapping?.type === 'keyword' ? keywordAnalyzer : getAnalyzer(mapping?.analyzer)
    const tokens = analyzer(term)

    if (tokens.length === 0) return null
    return fieldIndex.postings.get(tokens[0]!) || null
  }

  /**
   * Get document frequency for a term
   */
  getDocumentFrequency(field: string, term: string): number {
    const fieldIndex = this.fieldIndexes.get(field)
    if (!fieldIndex) return 0

    const mapping = this.mappings.properties?.[field]
    const analyzer = mapping?.type === 'keyword' ? keywordAnalyzer : getAnalyzer(mapping?.analyzer)
    const tokens = analyzer(term)

    if (tokens.length === 0) return 0
    const entry = fieldIndex.dictionary.get(tokens[0]!)
    return entry?.df || 0
  }

  /**
   * Tokenize text for a field
   */
  tokenizeField(field: string, text: string): string[] {
    const mapping = this.mappings.properties?.[field]
    const analyzer = mapping?.type === 'keyword' ? keywordAnalyzer : getAnalyzer(mapping?.analyzer)
    return analyzer(text)
  }

  /**
   * Get document by numeric ID
   */
  getDocumentByNumericId(numericId: number): IndexedDocument | null {
    const docId = this.numericToDocId.get(numericId)
    if (!docId) return null
    return this.documents.get(docId) || null
  }

  /**
   * Get numeric ID for document ID
   */
  getNumericId(docId: string): number | undefined {
    return this.docIdToNumeric.get(docId)
  }

  /**
   * Get all document IDs
   */
  getAllDocIds(): string[] {
    return Array.from(this.documents.keys())
  }

  /**
   * Get document count
   */
  getDocCount(): number {
    return this.documents.size
  }

  /**
   * Get all documents
   */
  getAllDocuments(): IndexedDocument[] {
    return Array.from(this.documents.values())
  }

  /**
   * Get field value from document (supports nested paths)
   */
  getFieldValue(doc: Document, path: string): unknown {
    const parts = path.split('.')
    let value: unknown = doc

    for (const part of parts) {
      if (value === null || value === undefined) return undefined
      if (typeof value !== 'object') return undefined
      value = (value as Record<string, unknown>)[part]
    }

    return value
  }

  /**
   * Check if field exists in mappings
   */
  hasField(field: string): boolean {
    return !!this.mappings.properties?.[field]
  }

  /**
   * Get field mapping
   */
  getFieldMapping(field: string): FieldMapping | undefined {
    return this.mappings.properties?.[field]
  }

  /**
   * Get all field names
   */
  getFieldNames(): string[] {
    return Object.keys(this.mappings.properties || {})
  }

  /**
   * Get mappings
   */
  getMappings(): IndexMappings {
    return this.mappings
  }

  /**
   * Update mappings (add new fields)
   */
  updateMappings(newMappings: IndexMappings): void {
    const newProperties = newMappings.properties || {}

    for (const [fieldName, mapping] of Object.entries(newProperties)) {
      if (!this.mappings.properties) {
        this.mappings.properties = {}
      }

      // Only allow adding new fields, not changing existing ones
      if (!this.mappings.properties[fieldName]) {
        this.mappings.properties[fieldName] = mapping

        // Initialize field index if text/keyword
        if (mapping.type === 'text' || mapping.type === 'keyword') {
          this.fieldIndexes.set(fieldName, {
            postings: new Map(),
            dictionary: new TermDictionary(),
            fieldType: mapping.type,
            analyzer: mapping.analyzer,
          })
        }

        // Add column to store
        const colType = this.mapFieldTypeToColumn(mapping.type)
        if (colType) {
          try {
            this.columnStore.addColumn(fieldName, colType)
          } catch {
            // Column might already exist
          }
        }
      }
    }
  }

  /**
   * Prefix search on a term dictionary
   */
  prefixSearch(field: string, prefix: string): string[] {
    const fieldIndex = this.fieldIndexes.get(field)
    if (!fieldIndex) return []

    const mapping = this.mappings.properties?.[field]
    const analyzer = mapping?.type === 'keyword' ? keywordAnalyzer : getAnalyzer(mapping?.analyzer)
    const normalizedPrefix = analyzer(prefix)[0] || prefix.toLowerCase()

    const entries = fieldIndex.dictionary.prefixSearch(normalizedPrefix)
    return entries.map((e) => e.term)
  }

  /**
   * Get all terms for a field
   */
  getAllTerms(field: string): string[] {
    const fieldIndex = this.fieldIndexes.get(field)
    if (!fieldIndex) return []
    return fieldIndex.dictionary.getAllTerms()
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new Elasticsearch indexer
 */
export function createIndexer(config: IndexConfig): ElasticsearchIndexer {
  return new ElasticsearchIndexer(config)
}
