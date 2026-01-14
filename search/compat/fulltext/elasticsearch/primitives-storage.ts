/**
 * Primitives-based Storage Layer for Elasticsearch Compat
 *
 * This module provides a storage backend for the Elasticsearch compatibility layer
 * using the search primitives (InvertedIndex, TypedColumnStore, RankFusion).
 *
 * Key components:
 * - PrimitivesIndexStorage: Per-index storage using InvertedIndex + TypedColumnStore
 * - SearchEngine: Unified search with BM25 scoring via primitives
 * - AggregationEngine: Aggregations using TypedColumnStore
 *
 * @module search/compat/fulltext/elasticsearch/primitives-storage
 */

import { InvertedIndex, type SearchResult } from '../../../../db/primitives/inverted-index/inverted-index'
import { createColumnStore, type TypedColumnStore, type Predicate, type AggregateFunction } from '../../../../db/primitives/typed-column-store'
import { RankFusion, type RankedResult } from '../../../../db/primitives/rank-fusion'
import type { IndexSettings, IndexMappings, QueryDsl, AggregationDsl, AggregationResult, AggregationBucket } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Stored document with metadata
 */
export interface StoredDocument {
  _source: Record<string, unknown>
  _version: number
  _seq_no: number
  _primary_term: number
}

/**
 * Index field type from mapping
 */
export type FieldType = 'text' | 'keyword' | 'long' | 'integer' | 'short' | 'byte' | 'double' | 'float' | 'boolean' | 'date' | 'object' | 'nested' | 'dense_vector'

/**
 * Field mapping configuration
 */
export interface FieldMapping {
  type: FieldType
  analyzer?: string
  search_analyzer?: string
  index?: boolean
  store?: boolean
  dims?: number // for dense_vector
}

/**
 * Internal document representation with ID
 */
interface InternalDocument {
  id: string
  source: Record<string, unknown>
  version: number
  seqNo: number
  primaryTerm: number
}

// ============================================================================
// Field Extraction Helpers
// ============================================================================

/**
 * Get nested value from object using dot notation
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Extract all text fields from a document for full-text indexing
 */
function extractTextContent(
  doc: Record<string, unknown>,
  mappings: IndexMappings,
  targetFields?: string[]
): Map<string, string> {
  const texts = new Map<string, string>()
  const properties = mappings.properties ?? {}

  function extractField(value: unknown, path: string, mapping?: FieldMapping): void {
    if (value === null || value === undefined) return

    // Check if we should index this field
    if (targetFields && targetFields.length > 0 && !targetFields.includes(path) && !targetFields.includes('*')) {
      return
    }

    // Determine field type from mapping or infer
    const fieldType = mapping?.type ?? (typeof value === 'string' ? 'text' : 'keyword')

    if (typeof value === 'string') {
      if (fieldType === 'text' || fieldType === 'keyword') {
        texts.set(path, value)
      }
    } else if (Array.isArray(value)) {
      // Handle arrays - concatenate string values
      const stringValues = value
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
      if (stringValues) {
        texts.set(path, stringValues)
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recurse into nested objects
      for (const [key, val] of Object.entries(value)) {
        const nestedPath = path ? `${path}.${key}` : key
        const nestedMapping = properties[nestedPath] as FieldMapping | undefined
        extractField(val, nestedPath, nestedMapping)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      // Convert primitives to string for text search
      texts.set(path, String(value))
    }
  }

  for (const [key, value] of Object.entries(doc)) {
    const mapping = properties[key] as FieldMapping | undefined
    extractField(value, key, mapping)
  }

  return texts
}

/**
 * Concatenate all text content from a document
 */
function getAllTextContent(doc: Record<string, unknown>, mappings: IndexMappings): string {
  const texts = extractTextContent(doc, mappings)
  return Array.from(texts.values()).join(' ')
}

// ============================================================================
// PrimitivesIndexStorage - Per-Index Storage
// ============================================================================

/**
 * Storage for a single Elasticsearch index using primitives
 *
 * Uses:
 * - InvertedIndex for full-text search with BM25 scoring
 * - TypedColumnStore for efficient aggregations
 * - Map for document storage (source data)
 */
export class PrimitivesIndexStorage {
  /** Full-text search index */
  private textIndex: InvertedIndex

  /** Column store for aggregations */
  private columnStore: TypedColumnStore

  /** Document storage (source data) */
  private documents: Map<string, InternalDocument> = new Map()

  /** Index settings */
  public settings: IndexSettings

  /** Index mappings */
  public mappings: IndexMappings

  /** Index creation time */
  public createdAt: Date

  /** Last update time */
  public updatedAt: Date

  /** Aliases */
  public aliases: Record<string, { filter?: QueryDsl; routing?: string; is_write_index?: boolean }> = {}

  /** Field name to column store columns mapping */
  private columnFields: Map<string, boolean> = new Map()

  /** Sequence counter for document operations */
  private seqNoCounter = 0

  constructor(settings: IndexSettings = {}, mappings: IndexMappings = {}) {
    this.settings = {
      number_of_shards: settings.number_of_shards ?? 1,
      number_of_replicas: settings.number_of_replicas ?? 1,
      ...settings,
    }
    this.mappings = mappings
    this.createdAt = new Date()
    this.updatedAt = new Date()

    // Initialize InvertedIndex with BM25 scoring
    this.textIndex = new InvertedIndex({
      k1: 1.2, // BM25 k1 parameter
      b: 0.75, // BM25 b parameter
    })

    // Initialize TypedColumnStore
    this.columnStore = createColumnStore()

    // Set up column store based on mappings
    this.initializeColumnsFromMappings()
  }

  /**
   * Initialize column store columns from index mappings
   */
  private initializeColumnsFromMappings(): void {
    const properties = this.mappings.properties ?? {}

    for (const [field, config] of Object.entries(properties)) {
      const mapping = config as FieldMapping
      const columnType = this.mapFieldTypeToColumn(mapping.type)

      if (columnType) {
        try {
          this.columnStore.addColumn(field, columnType)
          this.columnFields.set(field, true)
        } catch {
          // Column may already exist
        }
      }
    }
  }

  /**
   * Map Elasticsearch field type to TypedColumnStore column type
   */
  private mapFieldTypeToColumn(fieldType: FieldType): 'int64' | 'float64' | 'string' | 'boolean' | 'timestamp' | null {
    switch (fieldType) {
      case 'long':
      case 'integer':
      case 'short':
      case 'byte':
        return 'int64'
      case 'double':
      case 'float':
        return 'float64'
      case 'keyword':
      case 'text':
        return 'string'
      case 'boolean':
        return 'boolean'
      case 'date':
        return 'timestamp'
      default:
        return null // Unsupported types
    }
  }

  /**
   * Generate a new sequence number
   */
  private generateSeqNo(): number {
    return ++this.seqNoCounter
  }

  /**
   * Get document count
   */
  get size(): number {
    return this.documents.size
  }

  /**
   * Check if document exists
   */
  has(id: string): boolean {
    return this.documents.has(id)
  }

  /**
   * Get a document by ID
   */
  get(id: string): StoredDocument | undefined {
    const doc = this.documents.get(id)
    if (!doc) return undefined

    return {
      _source: doc.source,
      _version: doc.version,
      _seq_no: doc.seqNo,
      _primary_term: doc.primaryTerm,
    }
  }

  /**
   * Index a document
   */
  index(id: string, source: Record<string, unknown>): StoredDocument {
    const existing = this.documents.get(id)
    const isUpdate = !!existing

    // Remove from text index if updating
    if (isUpdate) {
      this.textIndex.remove(id)
    }

    // Create internal document
    const doc: InternalDocument = {
      id,
      source,
      version: isUpdate ? existing!.version + 1 : 1,
      seqNo: this.generateSeqNo(),
      primaryTerm: 1,
    }

    // Store document
    this.documents.set(id, doc)

    // Index in full-text search
    const textContent = getAllTextContent(source, this.mappings)
    if (textContent) {
      this.textIndex.add(id, textContent)
    }

    // Update column store for aggregatable fields
    // Note: TypedColumnStore append is columnar, so we track per-field
    // In a production implementation, we would batch these updates

    this.updatedAt = new Date()

    return {
      _source: doc.source,
      _version: doc.version,
      _seq_no: doc.seqNo,
      _primary_term: doc.primaryTerm,
    }
  }

  /**
   * Delete a document
   */
  delete(id: string): boolean {
    const doc = this.documents.get(id)
    if (!doc) return false

    // Remove from text index
    this.textIndex.remove(id)

    // Remove from documents
    this.documents.delete(id)

    this.updatedAt = new Date()
    return true
  }

  /**
   * Update a document
   */
  update(id: string, partialDoc: Record<string, unknown>): StoredDocument | null {
    const existing = this.documents.get(id)
    if (!existing) return null

    // Merge with existing source
    const updatedSource = { ...existing.source, ...partialDoc }

    // Re-index
    return this.index(id, updatedSource)
  }

  /**
   * Search documents using full-text search with BM25
   */
  search(query: string): SearchResult[] {
    return this.textIndex.search(query)
  }

  /**
   * Boolean search with must/should/must_not
   */
  booleanSearch(boolQuery: { must?: string[]; should?: string[]; mustNot?: string[] }): SearchResult[] {
    // For now, use simple AND/OR logic
    // TODO: Implement full boolean query support in InvertedIndex
    if (boolQuery.must && boolQuery.must.length > 0) {
      return this.textIndex.search(boolQuery.must.join(' '))
    }
    if (boolQuery.should && boolQuery.should.length > 0) {
      // For should, search each term and combine results
      const fusion = new RankFusion({ defaultMethod: 'rrf' })
      const allResults: RankedResult[][] = []

      for (const term of boolQuery.should) {
        const results = this.textIndex.search(term)
        allResults.push(results.map((r) => ({ id: r.id, score: r.score })))
      }

      const fused = fusion.fuse(allResults)
      return fused.map((r) => ({ id: r.id, score: r.score }))
    }

    return []
  }

  /**
   * Iterate over all documents
   */
  *entries(): IterableIterator<[string, StoredDocument]> {
    for (const [id, doc] of this.documents) {
      yield [id, {
        _source: doc.source,
        _version: doc.version,
        _seq_no: doc.seqNo,
        _primary_term: doc.primaryTerm,
      }]
    }
  }

  /**
   * Get all document IDs
   */
  keys(): IterableIterator<string> {
    return this.documents.keys()
  }

  /**
   * Get document count statistics
   */
  getStats(): { docCount: number; sizeBytes: number } {
    let sizeBytes = 0
    for (const doc of this.documents.values()) {
      sizeBytes += JSON.stringify(doc.source).length
    }
    return {
      docCount: this.documents.size,
      sizeBytes,
    }
  }
}

// ============================================================================
// Global Storage Manager
// ============================================================================

/**
 * Global storage for all indices
 */
class PrimitivesStorageManager {
  private indices = new Map<string, PrimitivesIndexStorage>()
  private scrollContexts = new Map<string, ScrollContext>()

  /**
   * Get or create an index
   */
  getOrCreate(indexName: string, settings?: IndexSettings, mappings?: IndexMappings): PrimitivesIndexStorage {
    let index = this.indices.get(indexName)
    if (!index) {
      index = new PrimitivesIndexStorage(settings, mappings)
      this.indices.set(indexName, index)
    }
    return index
  }

  /**
   * Get an index if it exists
   */
  get(indexName: string): PrimitivesIndexStorage | undefined {
    return this.indices.get(indexName)
  }

  /**
   * Check if an index exists
   */
  has(indexName: string): boolean {
    return this.indices.has(indexName)
  }

  /**
   * Delete an index
   */
  delete(indexName: string): boolean {
    return this.indices.delete(indexName)
  }

  /**
   * Get all index names
   */
  keys(): IterableIterator<string> {
    return this.indices.keys()
  }

  /**
   * Get index count
   */
  get size(): number {
    return this.indices.size
  }

  /**
   * Clear all indices
   */
  clear(): void {
    this.indices.clear()
    this.scrollContexts.clear()
  }

  /**
   * Store a scroll context
   */
  setScrollContext(id: string, context: ScrollContext): void {
    this.scrollContexts.set(id, context)
  }

  /**
   * Get a scroll context
   */
  getScrollContext(id: string): ScrollContext | undefined {
    return this.scrollContexts.get(id)
  }

  /**
   * Delete a scroll context
   */
  deleteScrollContext(id: string): boolean {
    return this.scrollContexts.delete(id)
  }

  /**
   * Clear all scroll contexts
   */
  clearScrollContexts(): void {
    this.scrollContexts.clear()
  }
}

/**
 * Scroll context for paginated search
 */
export interface ScrollContext {
  index: string | string[]
  query?: QueryDsl
  sort?: unknown[]
  size: number
  from: number
  _source?: unknown
  expiresAt: number
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Global storage instance
 */
export const primitivesStorage = new PrimitivesStorageManager()

/**
 * Tokenize text for search
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s*"]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}
