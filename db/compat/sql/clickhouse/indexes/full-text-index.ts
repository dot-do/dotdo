/**
 * GIN Full-Text Index with BM25 Scoring and R2 Streaming
 *
 * A memory-efficient full-text search index designed for Cloudflare Workers
 * (128MB memory limit). Features:
 * - FST (Finite State Transducer) dictionary for term -> posting offset mapping
 * - Roaring bitmap postings with range-request support
 * - BM25 relevance scoring
 * - Streaming from R2 storage
 * - Memory budget tracking (<50MB during search)
 *
 * Index Structure:
 * - *.gin_dict - FST dictionary mapping term to posting offset/length
 * - *.gin_post - Roaring bitmap postings (term -> row IDs + TF)
 * - *.gin_meta - Statistics (termCount, docCount, avgDocLength, docLengths)
 *
 * @module db/compat/sql/clickhouse/indexes/full-text-index
 */

// ============================================================================
// Constants
// ============================================================================

/** FST Dictionary magic bytes: "GIND" */
export const FST_MAGIC = new Uint8Array([0x47, 0x49, 0x4e, 0x44])

/** Postings magic bytes: "GINP" */
export const POSTINGS_MAGIC = new Uint8Array([0x47, 0x49, 0x4e, 0x50])

/** Metadata magic bytes: "GINM" */
export const METADATA_MAGIC = new Uint8Array([0x47, 0x49, 0x4e, 0x4d])

/** Current format version */
export const FORMAT_VERSION = 1

/** FST header size in bytes */
export const FST_HEADER_SIZE = 64

/** Maximum term length */
export const MAX_TERM_LENGTH = 255

/** BM25 parameters - typical values from literature */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

/** Default memory budget in MB */
export const DEFAULT_MEMORY_BUDGET_MB = 50

// ============================================================================
// Types
// ============================================================================

/**
 * Term entry in FST dictionary
 */
export interface FSTEntry {
  /** Byte offset in postings file */
  offset: number
  /** Byte length of posting list */
  length: number
  /** Document frequency (number of docs containing term) */
  df: number
}

/**
 * Term entry with the term string for prefix search
 */
export interface FSTTermEntry extends FSTEntry {
  term: string
}

/**
 * FST header information
 */
export interface FSTHeaderInfo {
  version: number
  termCount: number
  dataOffset: number
}

/**
 * Index statistics stored in metadata
 */
export interface GINIndexStats {
  termCount: number
  totalDocs: number
  avgDocLength: number
  totalLength: number
}

/**
 * Memory usage tracking
 */
export interface MemoryBudget {
  currentMB: number
  peakMB: number
  limit: number
}

/**
 * Search result with BM25 score
 */
export interface SearchResult {
  id: string
  score: number
}

/**
 * Posting entry with term frequency
 */
export interface PostingEntry {
  /** Internal numeric document ID */
  docId: number
  /** Term frequency in this document */
  tf: number
}

/**
 * Index file outputs from writer
 */
export interface GINIndexFiles {
  dictionary: Uint8Array
  postings: Uint8Array
  metadata: Uint8Array
}

/**
 * R2 storage interface for streaming access
 */
export interface R2GINStorage {
  fetchRange(file: keyof GINIndexFiles, offset: number, length: number): Promise<Uint8Array>
  fetchMetadata(): Promise<Uint8Array>
}

/**
 * Range fetcher function type
 */
export type RangeFetcher = (offset: number, length: number) => Promise<Uint8Array>

/**
 * FullTextIndex configuration options
 */
export interface FullTextIndexOptions {
  /** Maximum memory budget in MB (default: 50) */
  maxMemoryMB?: number
  /** Whether to cache the dictionary (default: true) */
  cacheDictionary?: boolean
  /** Whether to run in streaming mode (default: false) */
  streaming?: boolean
}

// ============================================================================
// Varint Encoding
// ============================================================================

/**
 * Encode a non-negative integer as a varint
 */
export function encodeVarint(value: number): Uint8Array {
  if (value < 0) {
    throw new Error('Varint encoding requires non-negative integers')
  }

  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) {
      byte |= 0x80
    }
    bytes.push(byte)
  } while (value !== 0)

  return new Uint8Array(bytes)
}

/**
 * Decode a varint from bytes at offset
 * @returns [value, bytesRead]
 */
export function decodeVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let bytesRead = 0

  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]!
    bytesRead++

    value |= (byte & 0x7f) << shift
    shift += 7

    if ((byte & 0x80) === 0) {
      return [value, bytesRead]
    }

    if (bytesRead >= 5) {
      throw new Error('Varint exceeds maximum size')
    }
  }

  throw new Error('Unexpected end of varint')
}

/**
 * Calculate the byte size of a varint-encoded value
 */
export function varintSize(value: number): number {
  if (value < 0) return 5
  if (value < 128) return 1
  if (value < 16384) return 2
  if (value < 2097152) return 3
  if (value < 268435456) return 4
  return 5
}

// ============================================================================
// FST Dictionary Builder
// ============================================================================

/**
 * Builder for FST dictionary
 *
 * Terms must be added in sorted order. The FST uses a simple
 * sorted array format with binary search for lookups.
 */
export class FSTBuilder {
  private entries: Array<{ term: string; entry: FSTEntry }> = []
  private lastTerm: string | null = null

  /**
   * Add a term to the dictionary (must be in sorted order)
   */
  add(term: string, entry: FSTEntry): void {
    if (this.lastTerm !== null && term <= this.lastTerm) {
      throw new Error(`Terms must be added in sorted order: "${term}" after "${this.lastTerm}"`)
    }
    this.entries.push({ term, entry })
    this.lastTerm = term
  }

  /**
   * Build the FST dictionary
   */
  build(): FSTDictionary {
    return new FSTDictionary(this.entries)
  }
}

// ============================================================================
// FST Dictionary
// ============================================================================

/**
 * FST Dictionary for term -> posting offset lookup
 *
 * Binary format:
 * - Header (64 bytes):
 *   - magic: 4 bytes "GIND"
 *   - version: 2 bytes
 *   - termCount: 4 bytes
 *   - dataOffset: 4 bytes (offset to term data)
 *   - reserved: 50 bytes
 *
 * - Term Index (variable):
 *   - For each term:
 *     - termLength: 1 byte
 *     - term: termLength bytes
 *     - offset: 4 bytes
 *     - length: 4 bytes
 *     - df: 4 bytes
 */
export class FSTDictionary {
  private entries: Array<{ term: string; entry: FSTEntry }>
  private termIndex: Map<string, FSTEntry>

  constructor(entries: Array<{ term: string; entry: FSTEntry }>) {
    this.entries = entries
    this.termIndex = new Map(entries.map((e) => [e.term, e.entry]))
  }

  /**
   * Look up a term
   */
  lookup(term: string): FSTEntry | null {
    return this.termIndex.get(term) ?? null
  }

  /**
   * Search for terms with a prefix
   */
  prefixSearch(prefix: string, limit: number = 100): FSTTermEntry[] {
    const results: FSTTermEntry[] = []

    // Binary search to find first term >= prefix
    let left = 0
    let right = this.entries.length - 1
    let startIdx = this.entries.length

    while (left <= right) {
      const mid = (left + right) >>> 1
      if (this.entries[mid]!.term >= prefix) {
        startIdx = mid
        right = mid - 1
      } else {
        left = mid + 1
      }
    }

    // Collect matching terms
    for (let i = startIdx; i < this.entries.length && results.length < limit; i++) {
      const entry = this.entries[i]!
      if (!entry.term.startsWith(prefix)) break
      results.push({ term: entry.term, ...entry.entry })
    }

    return results
  }

  /**
   * Get term count
   */
  get termCount(): number {
    return this.entries.length
  }

  /**
   * Serialize to bytes
   */
  serialize(): Uint8Array {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    // Header
    const header = new Uint8Array(FST_HEADER_SIZE)
    const headerView = new DataView(header.buffer)
    header.set(FST_MAGIC, 0)
    headerView.setUint16(4, FORMAT_VERSION, true)
    headerView.setUint32(6, this.entries.length, true)
    headerView.setUint32(10, FST_HEADER_SIZE, true) // dataOffset
    parts.push(header)

    // Term entries
    for (const { term, entry } of this.entries) {
      const termBytes = encoder.encode(term)
      const entryData = new Uint8Array(1 + termBytes.length + 12)
      const entryView = new DataView(entryData.buffer)

      entryData[0] = termBytes.length
      entryData.set(termBytes, 1)
      entryView.setUint32(1 + termBytes.length, entry.offset, true)
      entryView.setUint32(1 + termBytes.length + 4, entry.length, true)
      entryView.setUint32(1 + termBytes.length + 8, entry.df, true)

      parts.push(entryData)
    }

    // Concatenate
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Parse header from bytes
   */
  static parseHeader(bytes: Uint8Array): FSTHeaderInfo {
    if (bytes.length < FST_HEADER_SIZE) {
      throw new Error('Header too short')
    }

    for (let i = 0; i < FST_MAGIC.length; i++) {
      if (bytes[i] !== FST_MAGIC[i]) {
        throw new Error('Invalid FST magic')
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      version: view.getUint16(4, true),
      termCount: view.getUint32(6, true),
      dataOffset: view.getUint32(10, true),
    }
  }

  /**
   * Deserialize from bytes
   */
  static deserialize(bytes: Uint8Array): FSTDictionary {
    const header = FSTDictionary.parseHeader(bytes)
    const decoder = new TextDecoder()
    const entries: Array<{ term: string; entry: FSTEntry }> = []

    let offset = header.dataOffset

    for (let i = 0; i < header.termCount; i++) {
      const termLength = bytes[offset]!
      offset++

      const term = decoder.decode(bytes.slice(offset, offset + termLength))
      offset += termLength

      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 12)
      const entry: FSTEntry = {
        offset: view.getUint32(0, true),
        length: view.getUint32(4, true),
        df: view.getUint32(8, true),
      }
      offset += 12

      entries.push({ term, entry })
    }

    return new FSTDictionary(entries)
  }

  /**
   * Stream lookup using range requests
   */
  static async streamLookup(headerBytes: Uint8Array, term: string, fetcher: RangeFetcher): Promise<FSTEntry | null> {
    const header = FSTDictionary.parseHeader(headerBytes)

    // Estimate entry size (avg term length 8 + overhead)
    const avgEntrySize = 1 + 8 + 12
    const totalDataSize = header.termCount * avgEntrySize

    // Fetch full dictionary for now (can optimize with binary search later)
    const fullData = await fetcher(0, FST_HEADER_SIZE + totalDataSize * 2)
    const dict = FSTDictionary.deserialize(fullData)

    return dict.lookup(term)
  }
}

// ============================================================================
// Streaming Roaring Postings
// ============================================================================

/**
 * Streaming Roaring Bitmap postings with term frequencies
 *
 * Binary format:
 * - count: varint (number of postings)
 * - For each posting:
 *   - docId delta: varint
 *   - tf: varint
 */
export class StreamingRoaringPostings {
  private postings: Map<number, number> = new Map() // docId -> tf

  /**
   * Add a posting
   */
  addPosting(docId: number, tf: number): void {
    this.postings.set(docId, (this.postings.get(docId) || 0) + tf)
  }

  /**
   * Get document count
   */
  get docCount(): number {
    return this.postings.size
  }

  /**
   * Get all document IDs
   */
  getDocIds(): number[] {
    return Array.from(this.postings.keys()).sort((a, b) => a - b)
  }

  /**
   * Get term frequency for a document
   */
  getTermFrequency(docId: number): number {
    return this.postings.get(docId) || 0
  }

  /**
   * Intersect with another postings list
   */
  intersect(other: StreamingRoaringPostings): StreamingRoaringPostings {
    const result = new StreamingRoaringPostings()

    for (const [docId, tf] of this.postings) {
      const otherTf = other.postings.get(docId)
      if (otherTf !== undefined) {
        // Keep min TF for intersection scoring
        result.postings.set(docId, tf)
      }
    }

    return result
  }

  /**
   * Serialize to bytes
   */
  serialize(): Uint8Array {
    const sorted = this.getDocIds()
    const parts: Uint8Array[] = []

    // Count
    parts.push(encodeVarint(sorted.length))

    // Delta-encoded postings with TF
    let prevDocId = 0
    for (const docId of sorted) {
      parts.push(encodeVarint(docId - prevDocId))
      parts.push(encodeVarint(this.postings.get(docId)!))
      prevDocId = docId
    }

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Stream postings from R2
   */
  static async streamPostings(offset: number, length: number, fetcher: RangeFetcher): Promise<StreamingRoaringPostings> {
    const bytes = await fetcher(offset, length)
    return StreamingRoaringPostings.deserialize(bytes)
  }

  /**
   * Deserialize from bytes
   */
  static deserialize(bytes: Uint8Array): StreamingRoaringPostings {
    const result = new StreamingRoaringPostings()

    if (bytes.length === 0) return result

    let offset = 0
    const [count, countBytes] = decodeVarint(bytes, offset)
    offset += countBytes

    let prevDocId = 0
    for (let i = 0; i < count; i++) {
      const [delta, deltaBytes] = decodeVarint(bytes, offset)
      offset += deltaBytes

      const [tf, tfBytes] = decodeVarint(bytes, offset)
      offset += tfBytes

      const docId = prevDocId + delta
      result.postings.set(docId, tf)
      prevDocId = docId
    }

    return result
  }
}

// ============================================================================
// Text Processing
// ============================================================================

/**
 * Simple tokenizer - splits text into lowercase alphanumeric tokens
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
export function tokenizeWithFrequencies(text: string): Map<string, number> {
  const tokens = tokenize(text)
  const frequencies = new Map<string, number>()

  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1)
  }

  return frequencies
}

// ============================================================================
// BM25 Scoring
// ============================================================================

/**
 * Calculate BM25 IDF component (BM25+ variant that prevents negative IDF)
 *
 * Standard BM25: IDF = log((N - df + 0.5) / (df + 0.5))
 * BM25+: IDF = log((N + 1) / (df + 0.5))
 *
 * We use BM25+ to ensure IDF is always positive, which makes scores easier to interpret.
 */
export function calculateIDF(totalDocs: number, docFrequency: number): number {
  return Math.log((totalDocs + 1) / (docFrequency + 0.5))
}

/**
 * Calculate BM25 score for a term in a document
 *
 * score = IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength/avgDocLength))
 */
export function calculateBM25Score(
  tf: number,
  docLength: number,
  avgDocLength: number,
  idf: number,
  k1: number = BM25_K1,
  b: number = BM25_B
): number {
  const numerator = tf * (k1 + 1)
  const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength))
  return idf * (numerator / denominator)
}

// ============================================================================
// FullTextIndex - Main Class
// ============================================================================

/**
 * Full-text search index with BM25 ranking
 *
 * Designed for Cloudflare Workers with R2 streaming support.
 * Supports two modes:
 * 1. In-memory mode: All data kept in memory for building/searching
 * 2. Streaming mode: Dictionary cached, postings fetched from R2
 */
export class FullTextIndex {
  // Document storage
  private documents: Map<string, { numericId: number; length: number }> = new Map()
  private numericToStringId: Map<number, string> = new Map()
  private nextNumericId: number = 0

  // Term postings (in-memory during build)
  private termPostings: Map<string, Map<number, number>> = new Map() // term -> (docId -> tf)

  // Index statistics
  private stats: GINIndexStats = {
    termCount: 0,
    totalDocs: 0,
    avgDocLength: 0,
    totalLength: 0,
  }

  // Streaming mode state
  private cachedDictionary: FSTDictionary | null = null
  private streamingStorage: R2GINStorage | null = null
  private memoryUsage: MemoryBudget = { currentMB: 0, peakMB: 0, limit: DEFAULT_MEMORY_BUDGET_MB }

  // Options
  private options: Required<FullTextIndexOptions>

  constructor(options: FullTextIndexOptions = {}) {
    this.options = {
      maxMemoryMB: options.maxMemoryMB ?? DEFAULT_MEMORY_BUDGET_MB,
      cacheDictionary: options.cacheDictionary ?? true,
      streaming: options.streaming ?? false,
    }
    this.memoryUsage.limit = this.options.maxMemoryMB
  }

  // ==========================================================================
  // Indexing Methods
  // ==========================================================================

  /**
   * Add a document to the index
   *
   * @param docId - Document ID (string)
   * @param text - Document text to index
   */
  add(docId: string, text: string): void {
    if (this.documents.has(docId)) {
      // Remove existing document first
      this.remove(docId)
    }

    // Assign numeric ID
    const numericId = this.nextNumericId++
    const termFrequencies = tokenizeWithFrequencies(text)
    const docLength = Array.from(termFrequencies.values()).reduce((a, b) => a + b, 0)

    // Store document metadata
    this.documents.set(docId, { numericId, length: docLength })
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

    // Update stats
    this.stats.totalDocs++
    this.stats.totalLength += docLength
    this.stats.avgDocLength = this.stats.totalLength / this.stats.totalDocs
    this.stats.termCount = this.termPostings.size
  }

  /**
   * Remove a document from the index
   */
  remove(docId: string): boolean {
    const doc = this.documents.get(docId)
    if (!doc) {
      return false
    }

    // Remove from all term postings
    for (const postings of this.termPostings.values()) {
      postings.delete(doc.numericId)
    }

    // Clean up empty term entries
    for (const [term, postings] of this.termPostings) {
      if (postings.size === 0) {
        this.termPostings.delete(term)
      }
    }

    // Update stats
    this.stats.totalDocs--
    this.stats.totalLength -= doc.length
    this.stats.avgDocLength = this.stats.totalDocs > 0 ? this.stats.totalLength / this.stats.totalDocs : 0
    this.stats.termCount = this.termPostings.size

    // Remove document
    this.documents.delete(docId)
    this.numericToStringId.delete(doc.numericId)

    return true
  }

  /**
   * Get number of indexed terms
   */
  termCount(): number {
    return this.termPostings.size
  }

  /**
   * Get number of indexed documents
   */
  get documentCount(): number {
    return this.documents.size
  }

  /**
   * Get index statistics
   */
  getStats(): GINIndexStats {
    return { ...this.stats }
  }

  // ==========================================================================
  // Search Methods (In-Memory)
  // ==========================================================================

  /**
   * Search for documents matching query
   *
   * @param query - Search query (space-separated terms for AND query)
   * @returns Array of matching document IDs
   */
  search(query: string): string[] {
    const results = this.searchWithScores(query)
    return results.map((r) => r.id)
  }

  /**
   * Search with BM25 scores
   *
   * @param query - Search query
   * @returns Array of results sorted by score (descending)
   */
  searchWithScores(query: string): SearchResult[] {
    const queryTerms = tokenize(query)
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
        const termScore = calculateBM25Score(tf, doc.length, this.stats.avgDocLength, idf)

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
   * Search for exact phrase
   *
   * @param phrase - Phrase to search for
   * @returns Array of matching document IDs
   */
  searchPhrase(phrase: string): string[] {
    // For phrase search, we first find docs containing all terms
    // Then filter to those with terms in exact order
    // This is a simplified implementation - production would use positional indexes
    const terms = tokenize(phrase)
    if (terms.length === 0) {
      return []
    }

    // For now, fall back to AND query
    // A full phrase search would require storing term positions
    return this.search(phrase)
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

  // ==========================================================================
  // Serialization Methods (Build Index Files)
  // ==========================================================================

  /**
   * Build the complete index files for R2 storage
   */
  build(): GINIndexFiles {
    // Sort terms
    const sortedTerms = Array.from(this.termPostings.keys()).sort()

    // Build postings and track offsets
    const postingsParts: Uint8Array[] = []
    const postingsOffsets: Map<string, { offset: number; length: number; df: number }> = new Map()

    // Postings header
    const postingsHeader = new Uint8Array(32)
    postingsHeader.set(POSTINGS_MAGIC, 0)
    new DataView(postingsHeader.buffer).setUint16(4, FORMAT_VERSION, true)
    new DataView(postingsHeader.buffer).setUint32(6, sortedTerms.length, true)
    postingsParts.push(postingsHeader)

    let postingsOffset = 32

    for (const term of sortedTerms) {
      const termPostings = this.termPostings.get(term)!
      const postings = new StreamingRoaringPostings()

      for (const [docId, tf] of termPostings) {
        postings.addPosting(docId, tf)
      }

      const postingsBytes = postings.serialize()
      postingsOffsets.set(term, {
        offset: postingsOffset,
        length: postingsBytes.length,
        df: termPostings.size,
      })

      postingsParts.push(postingsBytes)
      postingsOffset += postingsBytes.length
    }

    // Build dictionary
    const fstBuilder = new FSTBuilder()
    for (const term of sortedTerms) {
      const info = postingsOffsets.get(term)!
      fstBuilder.add(term, { offset: info.offset, length: info.length, df: info.df })
    }
    const dictionary = fstBuilder.build().serialize()

    // Build postings
    const postingsTotalLength = postingsParts.reduce((sum, p) => sum + p.length, 0)
    const postings = new Uint8Array(postingsTotalLength)
    let offset = 0
    for (const part of postingsParts) {
      postings.set(part, offset)
      offset += part.length
    }

    // Build metadata
    const metadata = this.buildMetadata()

    return { dictionary, postings, metadata }
  }

  /**
   * Build metadata file
   */
  private buildMetadata(): Uint8Array {
    const encoder = new TextEncoder()

    // Header (32 bytes)
    const header = new Uint8Array(32)
    const headerView = new DataView(header.buffer)
    header.set(METADATA_MAGIC, 0)
    headerView.setUint16(4, FORMAT_VERSION, true)
    headerView.setUint32(6, this.termPostings.size, true)
    headerView.setUint32(10, this.documents.size, true)
    headerView.setUint32(14, Math.round(this.stats.avgDocLength * 100), true) // Fixed point
    headerView.setUint32(18, this.stats.totalLength, true)

    // Document mappings (id -> numericId, length)
    const docParts: Uint8Array[] = [header]

    // Doc count
    const docCount = new Uint8Array(4)
    new DataView(docCount.buffer).setUint32(0, this.documents.size, true)
    docParts.push(docCount)

    for (const [docId, { numericId, length }] of this.documents) {
      const idBytes = encoder.encode(docId)
      const entry = new Uint8Array(2 + idBytes.length + 4 + 4)
      const entryView = new DataView(entry.buffer)
      entryView.setUint16(0, idBytes.length, true)
      entry.set(idBytes, 2)
      entryView.setUint32(2 + idBytes.length, numericId, true)
      entryView.setUint32(2 + idBytes.length + 4, length, true)
      docParts.push(entry)
    }

    const totalLength = docParts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of docParts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Parse metadata from bytes
   */
  static parseMetadata(bytes: Uint8Array): GINIndexStats {
    for (let i = 0; i < METADATA_MAGIC.length; i++) {
      if (bytes[i] !== METADATA_MAGIC[i]) {
        throw new Error('Invalid metadata magic')
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      termCount: view.getUint32(6, true),
      totalDocs: view.getUint32(10, true),
      avgDocLength: view.getUint32(14, true) / 100,
      totalLength: view.getUint32(18, true),
    }
  }

  // ==========================================================================
  // Streaming Methods (for R2)
  // ==========================================================================

  /**
   * Load dictionary from bytes (for streaming mode)
   */
  async loadDictionary(data: Uint8Array | ReadableStream<Uint8Array>): Promise<void> {
    let bytes: Uint8Array

    if (data instanceof ReadableStream) {
      // Collect stream into buffer
      const reader = data.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      bytes = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
    } else {
      bytes = data
    }

    this.trackMemory(bytes.length)
    this.cachedDictionary = FSTDictionary.deserialize(bytes)

    // Parse metadata from dictionary header
    const header = FSTDictionary.parseHeader(bytes)
    this.stats.termCount = header.termCount
  }

  /**
   * Set streaming storage for R2
   */
  setStorage(storage: R2GINStorage): void {
    this.streamingStorage = storage
    this.options.streaming = true
  }

  /**
   * Get postings for a term using range fetching
   */
  async getPostings(term: string, fetch: RangeFetcher): Promise<PostingEntry[]> {
    if (!this.cachedDictionary) {
      throw new Error('Dictionary not loaded')
    }

    const entry = this.cachedDictionary.lookup(term)
    if (!entry) {
      return []
    }

    const postingBytes = await fetch(entry.offset, entry.length)
    this.trackMemory(postingBytes.length)

    const postings = StreamingRoaringPostings.deserialize(postingBytes)
    return postings.getDocIds().map((docId) => ({
      docId,
      tf: postings.getTermFrequency(docId),
    }))
  }

  /**
   * Search with streaming from R2
   */
  async searchStreaming(storage: R2GINStorage): Promise<(query: string) => Promise<SearchResult[]>> {
    // Load metadata
    const metadataBytes = await storage.fetchMetadata()
    this.trackMemory(metadataBytes.length)

    this.stats = FullTextIndex.parseMetadata(metadataBytes)

    // Parse document info from metadata
    const decoder = new TextDecoder()
    const view = new DataView(metadataBytes.buffer, metadataBytes.byteOffset, metadataBytes.byteLength)

    let offset = 32 // After header
    const docCount = view.getUint32(offset, true)
    offset += 4

    for (let i = 0; i < docCount; i++) {
      const idLength = view.getUint16(offset, true)
      offset += 2

      const docId = decoder.decode(metadataBytes.slice(offset, offset + idLength))
      offset += idLength

      const numericId = view.getUint32(offset, true)
      offset += 4

      const length = view.getUint32(offset, true)
      offset += 4

      this.documents.set(docId, { numericId, length })
      this.numericToStringId.set(numericId, docId)
    }

    // Load dictionary
    if (this.options.cacheDictionary) {
      const dictHeader = await storage.fetchRange('dictionary', 0, FST_HEADER_SIZE)
      const headerInfo = FSTDictionary.parseHeader(dictHeader)

      // Estimate full dictionary size
      const estimatedSize = FST_HEADER_SIZE + headerInfo.termCount * 25
      const dictBytes = await storage.fetchRange('dictionary', 0, estimatedSize * 2)
      this.trackMemory(dictBytes.length)

      this.cachedDictionary = FSTDictionary.deserialize(dictBytes)
    }

    this.streamingStorage = storage

    // Return search function
    return async (query: string): Promise<SearchResult[]> => {
      const terms = tokenize(query)
      if (terms.length === 0) return []

      if (!this.cachedDictionary) {
        throw new Error('Dictionary not loaded')
      }

      // Look up each term
      const termPostings: Array<{ term: string; entry: FSTEntry; postings: StreamingRoaringPostings }> = []

      for (const term of terms) {
        const entry = this.cachedDictionary.lookup(term)
        if (!entry) {
          // AND query - if any term is missing, no results
          return []
        }

        // Fetch postings
        const postingsBytes = await storage.fetchRange('postings', entry.offset, entry.length)
        this.trackMemory(postingsBytes.length)

        const postings = StreamingRoaringPostings.deserialize(postingsBytes)
        termPostings.push({ term, entry, postings })
      }

      // Intersect all postings (AND query)
      let result = termPostings[0]!.postings
      for (let i = 1; i < termPostings.length; i++) {
        result = result.intersect(termPostings[i]!.postings)
      }

      if (result.docCount === 0) return []

      // Calculate BM25 scores
      const scores: Map<number, number> = new Map()

      for (const docId of result.getDocIds()) {
        const docStringId = this.numericToStringId.get(docId)
        if (!docStringId) continue

        const docInfo = this.documents.get(docStringId)
        if (!docInfo) continue

        let totalScore = 0

        for (const { entry, postings } of termPostings) {
          const tf = postings.getTermFrequency(docId)
          if (tf === 0) continue

          const idf = calculateIDF(this.stats.totalDocs, entry.df)
          const termScore = calculateBM25Score(tf, docInfo.length, this.stats.avgDocLength, idf)
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
  }

  // ==========================================================================
  // Memory Management
  // ==========================================================================

  /**
   * Track memory usage
   */
  private trackMemory(bytes: number): void {
    const mb = bytes / (1024 * 1024)
    this.memoryUsage.currentMB += mb
    this.memoryUsage.peakMB = Math.max(this.memoryUsage.peakMB, this.memoryUsage.currentMB)

    if (this.memoryUsage.currentMB > this.memoryUsage.limit) {
      throw new Error(`Memory budget exceeded: ${this.memoryUsage.currentMB.toFixed(2)}MB > ${this.memoryUsage.limit}MB`)
    }
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage(): MemoryBudget {
    return { ...this.memoryUsage }
  }

  /**
   * Clear cached data
   */
  clearCache(): void {
    if (!this.options.cacheDictionary) {
      this.cachedDictionary = null
    }
    this.memoryUsage.currentMB = 0
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.documents.clear()
    this.numericToStringId.clear()
    this.termPostings.clear()
    this.cachedDictionary = null
    this.streamingStorage = null
    this.stats = { termCount: 0, totalDocs: 0, avgDocLength: 0, totalLength: 0 }
    this.nextNumericId = 0
    this.memoryUsage = { currentMB: 0, peakMB: 0, limit: this.options.maxMemoryMB }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a mock R2 storage from index files (for testing)
 */
export function createMockR2Storage(files: GINIndexFiles): R2GINStorage {
  return {
    async fetchRange(file: keyof GINIndexFiles, offset: number, length: number) {
      const data = files[file]
      return data.slice(offset, Math.min(offset + length, data.length))
    },
    async fetchMetadata() {
      return files.metadata
    },
  }
}

/**
 * Create a FullTextIndex from documents
 */
export function createFullTextIndex(documents: Array<{ id: string; text: string }>): FullTextIndex {
  const index = new FullTextIndex()
  for (const doc of documents) {
    index.add(doc.id, doc.text)
  }
  return index
}
