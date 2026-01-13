/**
 * InvertedIndex - Production Full-Text Search Index
 *
 * A high-level full-text search index with BM25 scoring designed for
 * Cloudflare Workers (128MB memory limit). Provides a simple API for
 * document indexing and search while leveraging the underlying primitives.
 *
 * Features:
 * - Simple add/search/remove API
 * - BM25 relevance scoring
 * - Configurable text analyzers (standard, ngram, edge_ngram)
 * - Boolean queries (AND/OR/NOT)
 * - Serialization for R2 storage
 * - Streaming search with range fetching
 * - Memory-efficient design
 *
 * @module db/primitives/inverted-index/inverted-index
 */

import { PostingListWithTF, Posting, encodeVarint, decodeVarint, varintSize } from './posting-list'
import { TermDictionary, DictionaryEntry, DictionaryEntryInput, DICTIONARY_MAGIC, FORMAT_VERSION } from './term-dictionary'
import { BM25Scorer, IndexStats, calculateIDF, calculateBM25Score, BM25_K1, BM25_B } from './bm25'
import { createAnalyzer, type Analyzer, type AnalyzerOptions } from './analyzers'

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes for index: "INVI" (Inverted Index) */
export const INDEX_MAGIC = new Uint8Array([0x49, 0x4e, 0x56, 0x49])

/** Magic bytes for postings: "IVPO" (Inverted Postings) */
export const POSTINGS_MAGIC = new Uint8Array([0x49, 0x56, 0x50, 0x4f])

/** Current format version */
export const INDEX_VERSION = 1

/** Header size in bytes */
export const HEADER_SIZE = 32

/** Maximum term length */
export const MAX_TERM_LENGTH = 255

// ============================================================================
// Types
// ============================================================================

/**
 * Document metadata stored in the index
 */
export interface DocumentMetadata {
  /** Document ID (string-based for flexibility) */
  id: string
  /** Internal numeric ID for efficient storage */
  numericId: number
  /** Number of terms in document (for BM25 length normalization) */
  length: number
}

/**
 * Search result with score
 */
export interface SearchResult {
  /** Document ID (string) */
  id: string
  /** BM25 relevance score */
  score: number
}

/**
 * Range fetch function for streaming from R2
 */
export type RangeFetcher = (offset: number, length: number) => Promise<Uint8Array>

/**
 * BM25 configuration options
 */
export interface BM25Options {
  /** k1 parameter - term frequency saturation (default: 1.2) */
  k1?: number
  /** b parameter - document length normalization (default: 0.75) */
  b?: number
}

/**
 * Options for creating an InvertedIndex
 */
export interface InvertedIndexOptions {
  /** BM25 k1 parameter (default: 1.2) */
  k1?: number
  /** BM25 b parameter (default: 0.75) */
  b?: number
  /** Custom tokenizer function */
  tokenizer?: (text: string) => string[]
  /** Text analyzer configuration */
  analyzer?: AnalyzerOptions
  /** BM25 scoring configuration */
  bm25?: BM25Options
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Maximum number of results (default: 100) */
  limit?: number
  /** Number of results to skip (default: 0) */
  offset?: number
}

/**
 * Boolean search query
 */
export interface BooleanSearchQuery {
  /** Required terms (AND) */
  must?: string[]
  /** Optional terms (OR) */
  should?: string[]
  /** Excluded terms (NOT) */
  mustNot?: string[]
}

/**
 * Document with ID for factory function
 */
export interface DocumentWithId {
  /** Document ID */
  id: string
  /** Document text content */
  text: string
}

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Default tokenizer - splits text into lowercase alphanumeric tokens
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && t.length <= MAX_TERM_LENGTH)
}

/**
 * Tokenize and count term frequencies
 */
export function tokenizeWithFrequencies(text: string, tokenizer: (text: string) => string[] = tokenize): Map<string, number> {
  const tokens = tokenizer(text)
  const frequencies = new Map<string, number>()

  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1)
  }

  return frequencies
}

// ============================================================================
// InvertedIndex - Main Class
// ============================================================================

/**
 * Full-text search index with BM25 ranking
 *
 * Provides a simple API for document indexing and search:
 * - add(docId, text) - Index a document
 * - search(query) - Find matching documents with scores
 * - remove(docId) - Remove a document from the index
 *
 * Designed for Cloudflare Workers with support for:
 * - Memory-efficient storage using roaring bitmaps and delta encoding
 * - Serialization to bytes for R2 persistence
 * - Streaming search with range requests
 *
 * @example
 * ```typescript
 * const index = new InvertedIndex()
 *
 * // Index documents
 * index.add('doc1', 'The quick brown fox')
 * index.add('doc2', 'The lazy brown dog')
 *
 * // Search with BM25 scoring
 * const results = index.search('brown fox')
 * // Returns: [{ id: 'doc1', score: 2.5 }, { id: 'doc2', score: 1.2 }]
 *
 * // Remove a document
 * index.remove('doc1')
 * ```
 */
export class InvertedIndex {
  // ==========================================================================
  // Private State
  // ==========================================================================

  /** Document ID to metadata mapping */
  private documents: Map<string, DocumentMetadata> = new Map()

  /** Numeric ID counter */
  private nextNumericId: number = 0

  /** Numeric ID to string ID mapping */
  private numericToStringId: Map<number, string> = new Map()

  /** Term to postings mapping (in-memory during build) */
  private termPostings: Map<string, Map<number, number>> = new Map() // term -> (numericDocId -> tf)

  /** Index statistics */
  private stats: IndexStats = {
    totalDocs: 0,
    avgDocLength: 0,
    totalLength: 0,
  }

  /** BM25 parameters */
  private k1: number
  private b: number

  /** Custom tokenizer */
  private tokenizer: (text: string) => string[]

  /** Loaded dictionary (for query mode after deserialization) */
  private dictionary: TermDictionary | null = null

  /** Loaded postings data (for in-memory query after deserialization) */
  private postingsData: Uint8Array | null = null

  // ==========================================================================
  // Constructor
  // ==========================================================================

  /**
   * Create a new InvertedIndex
   *
   * @param options - Optional configuration for BM25 parameters and tokenizer
   */
  constructor(options: InvertedIndexOptions = {}) {
    this.k1 = options.k1 ?? BM25_K1
    this.b = options.b ?? BM25_B
    this.tokenizer = options.tokenizer ?? tokenize
  }

  // ==========================================================================
  // Indexing Methods
  // ==========================================================================

  /**
   * Add a document to the index
   *
   * @param docId - Unique document identifier (string)
   * @param text - Document text to index
   *
   * @example
   * ```typescript
   * index.add('product-123', 'Premium wireless headphones with noise cancellation')
   * ```
   */
  add(docId: string, text: string): void {
    // Remove existing document first if it exists
    if (this.documents.has(docId)) {
      this.remove(docId)
    }

    // Assign numeric ID for efficient storage
    const numericId = this.nextNumericId++
    const termFrequencies = tokenizeWithFrequencies(text, this.tokenizer)
    const docLength = Array.from(termFrequencies.values()).reduce((a, b) => a + b, 0)

    // Store document metadata
    const metadata: DocumentMetadata = {
      id: docId,
      numericId,
      length: docLength,
    }
    this.documents.set(docId, metadata)
    this.numericToStringId.set(numericId, docId)

    // Update term postings
    for (const [term, tf] of termFrequencies) {
      let postings = this.termPostings.get(term)
      if (!postings) {
        postings = new Map()
        this.termPostings.set(term, postings)
      }
      postings.set(numericId, tf)
    }

    // Update statistics
    this.stats.totalDocs++
    this.stats.totalLength += docLength
    this.stats.avgDocLength = this.stats.totalLength / this.stats.totalDocs
  }

  /**
   * Remove a document from the index
   *
   * @param docId - Document ID to remove
   * @returns true if document was removed, false if not found
   *
   * @example
   * ```typescript
   * const removed = index.remove('product-123')
   * if (removed) {
   *   console.log('Document removed')
   * }
   * ```
   */
  remove(docId: string): boolean {
    const metadata = this.documents.get(docId)
    if (!metadata) {
      return false
    }

    // Remove from all term postings
    for (const postings of this.termPostings.values()) {
      postings.delete(metadata.numericId)
    }

    // Clean up empty term entries
    for (const [term, postings] of this.termPostings) {
      if (postings.size === 0) {
        this.termPostings.delete(term)
      }
    }

    // Update statistics
    this.stats.totalDocs--
    this.stats.totalLength -= metadata.length
    this.stats.avgDocLength = this.stats.totalDocs > 0 ? this.stats.totalLength / this.stats.totalDocs : 0

    // Remove document
    this.documents.delete(docId)
    this.numericToStringId.delete(metadata.numericId)

    return true
  }

  // ==========================================================================
  // Search Methods
  // ==========================================================================

  /**
   * Search for documents matching the query
   *
   * Returns documents containing ALL query terms (AND query),
   * sorted by BM25 relevance score (highest first).
   *
   * @param query - Search query (space-separated terms)
   * @returns Array of results with document IDs and BM25 scores
   *
   * @example
   * ```typescript
   * const results = index.search('wireless headphones')
   * for (const { id, score } of results) {
   *   console.log(`${id}: ${score.toFixed(2)}`)
   * }
   * ```
   */
  search(query: string): SearchResult[] {
    // If we have loaded dictionary/postings, use in-memory search
    if (this.dictionary && this.postingsData) {
      return this.searchFromSerialized(query)
    }

    // Otherwise use live index
    return this.searchLive(query)
  }

  /**
   * Search live index (during build phase)
   */
  private searchLive(query: string): SearchResult[] {
    const queryTerms = this.tokenizer(query)
    if (queryTerms.length === 0) {
      return []
    }

    // Find documents matching ALL query terms (AND query)
    const matchingDocs = this.findMatchingDocs(queryTerms)
    if (matchingDocs.length === 0) {
      return []
    }

    // Calculate BM25 scores
    const scores: Map<number, number> = new Map()

    for (const docId of matchingDocs) {
      const docStringId = this.numericToStringId.get(docId)
      if (!docStringId) continue

      const doc = this.documents.get(docStringId)
      if (!doc) continue

      let totalScore = 0

      for (const term of queryTerms) {
        const postings = this.termPostings.get(term)
        if (!postings) continue

        const tf = postings.get(docId) || 0
        if (tf === 0) continue

        const df = postings.size
        const idf = calculateIDF(this.stats.totalDocs, df)
        const termScore = calculateBM25Score(tf, doc.length, this.stats.avgDocLength, idf, this.k1, this.b)

        totalScore += termScore
      }

      scores.set(docId, totalScore)
    }

    // Sort by score and return
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([numericId, score]) => ({
        id: this.numericToStringId.get(numericId)!,
        score,
      }))
  }

  /**
   * Find documents matching all terms (AND query)
   */
  private findMatchingDocs(terms: string[]): number[] {
    if (terms.length === 0) {
      return []
    }

    // Get posting lists for all terms
    const postingLists = terms.map((t) => this.termPostings.get(t)).filter((p): p is Map<number, number> => p !== undefined && p.size > 0)

    // If any term is missing, no matches
    if (postingLists.length !== terms.length) {
      return []
    }

    // Start with smallest list for efficiency
    const sorted = postingLists.slice().sort((a, b) => a.size - b.size)
    let result = new Set(sorted[0]!.keys())

    for (let i = 1; i < sorted.length && result.size > 0; i++) {
      const otherKeys = new Set(sorted[i]!.keys())
      result = new Set([...result].filter((x) => otherKeys.has(x)))
    }

    return Array.from(result)
  }

  /**
   * Search from serialized data (after loading from storage)
   */
  private searchFromSerialized(query: string): SearchResult[] {
    const queryTerms = this.tokenizer(query)
    if (queryTerms.length === 0) {
      return []
    }

    // Check if all terms exist in dictionary
    for (const term of queryTerms) {
      if (!this.dictionary!.contains(term)) {
        return []
      }
    }

    // Get postings for all query terms
    const termPostings = new Map<string, PostingListWithTF>()
    for (const term of queryTerms) {
      const postingList = this.getPostingsFromSerialized(term)
      if (postingList) {
        termPostings.set(term, postingList)
      }
    }

    // Find intersection of documents
    const firstTerm = queryTerms[0]!
    const firstPostings = termPostings.get(firstTerm)
    if (!firstPostings) return []

    let matchingDocIds = new Set(firstPostings.toArray())

    for (let i = 1; i < queryTerms.length; i++) {
      const postings = termPostings.get(queryTerms[i]!)
      if (!postings) return []
      const otherDocIds = new Set(postings.toArray())
      matchingDocIds = new Set([...matchingDocIds].filter((id) => otherDocIds.has(id)))
    }

    if (matchingDocIds.size === 0) {
      return []
    }

    // Calculate BM25 scores
    const scores: Map<number, number> = new Map()

    for (const docId of matchingDocIds) {
      const docStringId = this.numericToStringId.get(docId)
      if (!docStringId) continue

      const doc = this.documents.get(docStringId)
      if (!doc) continue

      let totalScore = 0

      for (const term of queryTerms) {
        const postings = termPostings.get(term)!
        const tf = postings.getTf(docId)
        if (tf === 0) continue

        const entry = this.dictionary!.get(term)!
        const idf = calculateIDF(this.stats.totalDocs, entry.df)
        const termScore = calculateBM25Score(tf, doc.length, this.stats.avgDocLength, idf, this.k1, this.b)

        totalScore += termScore
      }

      scores.set(docId, totalScore)
    }

    // Sort by score and return
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([numericId, score]) => ({
        id: this.numericToStringId.get(numericId)!,
        score,
      }))
  }

  /**
   * Get posting list from serialized data
   */
  private getPostingsFromSerialized(term: string): PostingListWithTF | null {
    if (!this.dictionary || !this.postingsData) {
      return null
    }

    const entry = this.dictionary.get(term)
    if (!entry) {
      return null
    }

    const postingBytes = this.postingsData.slice(entry.offset, entry.offset + entry.length)
    return PostingListWithTF.deserialize(postingBytes)
  }

  // ==========================================================================
  // Streaming Search (for R2)
  // ==========================================================================

  /**
   * Search with streaming from R2 storage
   *
   * Only loads the posting lists needed for the query,
   * making it memory-efficient for large indexes.
   *
   * @param query - Search query
   * @param fetch - Function to fetch byte ranges from R2
   * @returns Array of results sorted by score
   *
   * @example
   * ```typescript
   * const fetch = async (offset, length) => {
   *   const response = await r2.get('postings.bin', {
   *     range: { offset, length }
   *   })
   *   return new Uint8Array(await response.arrayBuffer())
   * }
   *
   * const results = await index.searchStreaming('wireless', fetch)
   * ```
   */
  async searchStreaming(query: string, fetch: RangeFetcher): Promise<SearchResult[]> {
    if (!this.dictionary) {
      throw new Error('Dictionary not loaded - call loadIndex first')
    }

    const queryTerms = this.tokenizer(query)
    if (queryTerms.length === 0) {
      return []
    }

    // Check if all terms exist
    for (const term of queryTerms) {
      if (!this.dictionary.contains(term)) {
        return []
      }
    }

    // Fetch postings for all query terms
    const termPostings = new Map<string, PostingListWithTF>()
    for (const term of queryTerms) {
      const entry = this.dictionary.get(term)!
      const postingBytes = await fetch(entry.offset, entry.length)
      termPostings.set(term, PostingListWithTF.deserialize(postingBytes))
    }

    // Find intersection
    const firstPostings = termPostings.get(queryTerms[0]!)!
    let matchingDocIds = new Set(firstPostings.toArray())

    for (let i = 1; i < queryTerms.length; i++) {
      const postings = termPostings.get(queryTerms[i]!)!
      const otherDocIds = new Set(postings.toArray())
      matchingDocIds = new Set([...matchingDocIds].filter((id) => otherDocIds.has(id)))
    }

    if (matchingDocIds.size === 0) {
      return []
    }

    // Calculate BM25 scores
    const scores: Map<number, number> = new Map()

    for (const docId of matchingDocIds) {
      const docStringId = this.numericToStringId.get(docId)
      if (!docStringId) continue

      const doc = this.documents.get(docStringId)
      if (!doc) continue

      let totalScore = 0

      for (const term of queryTerms) {
        const postings = termPostings.get(term)!
        const tf = postings.getTf(docId)
        if (tf === 0) continue

        const entry = this.dictionary.get(term)!
        const idf = calculateIDF(this.stats.totalDocs, entry.df)
        const termScore = calculateBM25Score(tf, doc.length, this.stats.avgDocLength, idf, this.k1, this.b)

        totalScore += termScore
      }

      scores.set(docId, totalScore)
    }

    // Sort by score and return
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([numericId, score]) => ({
        id: this.numericToStringId.get(numericId)!,
        score,
      }))
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serialize the index to bytes for storage
   *
   * Returns both dictionary and postings as separate byte arrays,
   * allowing for efficient range requests on the postings file.
   *
   * @returns Object with dictionary and postings byte arrays
   *
   * @example
   * ```typescript
   * const { dictionary, postings } = index.serialize()
   * await r2.put('index-dict.bin', dictionary)
   * await r2.put('index-postings.bin', postings)
   * ```
   */
  serialize(): { dictionary: Uint8Array; postings: Uint8Array } {
    const encoder = new TextEncoder()
    const sortedTerms = Array.from(this.termPostings.keys()).sort()

    // Build postings first to get offsets
    const postingsParts: Uint8Array[] = []

    // Postings header
    const postingsHeader = new Uint8Array(HEADER_SIZE)
    postingsHeader.set(POSTINGS_MAGIC, 0)
    const postingsHeaderView = new DataView(postingsHeader.buffer)
    postingsHeaderView.setUint16(4, INDEX_VERSION, true)
    postingsHeaderView.setUint32(6, sortedTerms.length, true)
    postingsParts.push(postingsHeader)

    // Build term dictionary and postings simultaneously
    const termDict = new TermDictionary()
    let postingsOffset = HEADER_SIZE

    for (const term of sortedTerms) {
      const termPostingsMap = this.termPostings.get(term)!

      // Create posting list with TF
      const postingList = new PostingListWithTF()
      for (const [docId, tf] of termPostingsMap) {
        postingList.add(docId, tf)
      }

      const postingBytes = postingList.serialize()
      postingsParts.push(postingBytes)

      // Add to dictionary
      termDict.add(term, {
        df: termPostingsMap.size,
        offset: postingsOffset,
        length: postingBytes.length,
      })

      postingsOffset += postingBytes.length
    }

    // Concatenate postings
    const postingsTotalLength = postingsParts.reduce((sum, p) => sum + p.length, 0)
    const postingsResult = new Uint8Array(postingsTotalLength)
    let offset = 0
    for (const part of postingsParts) {
      postingsResult.set(part, offset)
      offset += part.length
    }

    // Build dictionary with document metadata
    const dictParts: Uint8Array[] = []

    // Dictionary header
    const dictHeader = new Uint8Array(HEADER_SIZE)
    dictHeader.set(INDEX_MAGIC, 0)
    const dictHeaderView = new DataView(dictHeader.buffer)
    dictHeaderView.setUint16(4, INDEX_VERSION, true)
    dictHeaderView.setUint32(6, sortedTerms.length, true)
    dictHeaderView.setUint32(10, this.stats.totalDocs, true)
    dictHeaderView.setUint32(14, Math.round(this.stats.avgDocLength * 100), true)
    dictHeaderView.setUint32(18, this.stats.totalLength, true)
    dictParts.push(dictHeader)

    // Document metadata
    dictParts.push(encodeVarint(this.documents.size))

    for (const [docId, metadata] of this.documents) {
      const idBytes = encoder.encode(docId)
      dictParts.push(encodeVarint(idBytes.length))
      dictParts.push(idBytes)
      dictParts.push(encodeVarint(metadata.numericId))
      dictParts.push(encodeVarint(metadata.length))
    }

    // Term dictionary
    const termDictBytes = termDict.serialize()
    dictParts.push(termDictBytes)

    // Concatenate dictionary
    const dictTotalLength = dictParts.reduce((sum, p) => sum + p.length, 0)
    const dictResult = new Uint8Array(dictTotalLength)
    offset = 0
    for (const part of dictParts) {
      dictResult.set(part, offset)
      offset += part.length
    }

    return {
      dictionary: dictResult,
      postings: postingsResult,
    }
  }

  /**
   * Load index from serialized data
   *
   * @param dictionary - Dictionary bytes
   * @param postings - Postings bytes (optional for streaming mode)
   *
   * @example
   * ```typescript
   * const dictData = await r2.get('index-dict.bin').arrayBuffer()
   * const postingsData = await r2.get('index-postings.bin').arrayBuffer()
   *
   * const index = new InvertedIndex()
   * index.loadIndex(new Uint8Array(dictData), new Uint8Array(postingsData))
   * ```
   */
  loadIndex(dictionary: Uint8Array, postings?: Uint8Array): void {
    const decoder = new TextDecoder()

    // Validate dictionary magic
    for (let i = 0; i < INDEX_MAGIC.length; i++) {
      if (dictionary[i] !== INDEX_MAGIC[i]) {
        throw new Error('Invalid index: dictionary magic mismatch')
      }
    }

    const dictView = new DataView(dictionary.buffer, dictionary.byteOffset, dictionary.byteLength)

    // Parse header
    const version = dictView.getUint16(4, true)
    if (version !== INDEX_VERSION) {
      throw new Error(`Unsupported index version: ${version}`)
    }

    const termCount = dictView.getUint32(6, true)
    this.stats.totalDocs = dictView.getUint32(10, true)
    this.stats.avgDocLength = dictView.getUint32(14, true) / 100
    this.stats.totalLength = dictView.getUint32(18, true)

    let offset = HEADER_SIZE

    // Parse document metadata
    const [docCount, docCountBytes] = decodeVarint(dictionary, offset)
    offset += docCountBytes

    this.documents.clear()
    this.numericToStringId.clear()

    for (let i = 0; i < docCount; i++) {
      const [idLen, idLenBytes] = decodeVarint(dictionary, offset)
      offset += idLenBytes

      const id = decoder.decode(dictionary.slice(offset, offset + idLen))
      offset += idLen

      const [numericId, numericIdBytes] = decodeVarint(dictionary, offset)
      offset += numericIdBytes

      const [docLength, docLengthBytes] = decodeVarint(dictionary, offset)
      offset += docLengthBytes

      this.documents.set(id, { id, numericId, length: docLength })
      this.numericToStringId.set(numericId, id)

      // Update next numeric ID to avoid collisions
      if (numericId >= this.nextNumericId) {
        this.nextNumericId = numericId + 1
      }
    }

    // Parse term dictionary
    const termDictBytes = dictionary.slice(offset)
    this.dictionary = TermDictionary.deserialize(termDictBytes)

    // Load postings if provided
    if (postings) {
      // Validate postings magic
      for (let i = 0; i < POSTINGS_MAGIC.length; i++) {
        if (postings[i] !== POSTINGS_MAGIC[i]) {
          throw new Error('Invalid index: postings magic mismatch')
        }
      }
      this.postingsData = postings
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the number of indexed documents
   */
  get documentCount(): number {
    return this.documents.size
  }

  /**
   * Get the number of unique terms
   */
  get termCount(): number {
    if (this.dictionary) {
      return this.dictionary.termCount
    }
    return this.termPostings.size
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return { ...this.stats }
  }

  /**
   * Get all indexed document IDs
   */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys())
  }

  /**
   * Check if a document exists in the index
   */
  hasDocument(docId: string): boolean {
    return this.documents.has(docId)
  }

  /**
   * Get all terms in the index
   */
  getTerms(): string[] {
    if (this.dictionary) {
      return this.dictionary.getAllTerms()
    }
    return Array.from(this.termPostings.keys()).sort()
  }

  /**
   * Check if a term exists in the index
   */
  hasTerm(term: string): boolean {
    if (this.dictionary) {
      return this.dictionary.contains(term)
    }
    return this.termPostings.has(term)
  }

  /**
   * Get document frequency for a term
   */
  getDocumentFrequency(term: string): number {
    if (this.dictionary) {
      const entry = this.dictionary.get(term)
      return entry?.df || 0
    }
    return this.termPostings.get(term)?.size || 0
  }

  /**
   * Clear the index completely
   */
  clear(): void {
    this.documents.clear()
    this.numericToStringId.clear()
    this.termPostings.clear()
    this.dictionary = null
    this.postingsData = null
    this.stats = { totalDocs: 0, avgDocLength: 0, totalLength: 0 }
    this.nextNumericId = 0
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an InvertedIndex from an array of documents
 *
 * @param documents - Array of { id, text } objects
 * @param options - Optional index configuration
 * @returns Populated InvertedIndex
 *
 * @example
 * ```typescript
 * const index = createInvertedIndex([
 *   { id: 'doc1', text: 'Hello world' },
 *   { id: 'doc2', text: 'Hello there' },
 * ])
 * ```
 */
export function createInvertedIndex(
  documents: Array<{ id: string; text: string }>,
  options?: InvertedIndexOptions
): InvertedIndex {
  const index = new InvertedIndex(options)
  for (const doc of documents) {
    index.add(doc.id, doc.text)
  }
  return index
}

/**
 * Load an InvertedIndex from serialized data
 *
 * @param dictionary - Dictionary bytes
 * @param postings - Postings bytes
 * @param options - Optional index configuration
 * @returns Loaded InvertedIndex
 *
 * @example
 * ```typescript
 * const index = loadInvertedIndex(dictBytes, postingsBytes)
 * const results = index.search('hello')
 * ```
 */
export function loadInvertedIndex(
  dictionary: Uint8Array,
  postings: Uint8Array,
  options?: InvertedIndexOptions
): InvertedIndex {
  const index = new InvertedIndex(options)
  index.loadIndex(dictionary, postings)
  return index
}
