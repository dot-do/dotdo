/**
 * SPIKE: GIN Full-Text Index with BM25 Scoring and R2 Streaming
 *
 * A memory-efficient full-text search index designed for Cloudflare Workers
 * (128MB memory limit). Features:
 * - Inverted index with Roaring bitmap postings
 * - BM25 relevance scoring
 * - Streaming from R2 storage
 * - Dictionary and postings stored separately for efficient range requests
 *
 * @module db/compat/sql/clickhouse/spikes/full-text-index
 */

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes for dictionary: "FXDI" (Full-text Dictionary Index) */
export const DICTIONARY_MAGIC = new Uint8Array([0x46, 0x58, 0x44, 0x49])

/** Magic bytes for postings: "FXPO" (Full-text Postings) */
export const POSTINGS_MAGIC = new Uint8Array([0x46, 0x58, 0x50, 0x4f])

/** Current format version */
export const FORMAT_VERSION = 1

/** Header size in bytes */
export const HEADER_SIZE = 32

/** Maximum term length */
export const MAX_TERM_LENGTH = 255

/** BM25 parameters - typical values from literature */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

// ============================================================================
// Types
// ============================================================================

/**
 * Document metadata stored in the index
 */
export interface DocumentMetadata {
  /** Document ID (string-based for flexibility) */
  id: string
  /** Internal numeric ID for bitmap operations */
  numericId: number
  /** Number of terms in document (for BM25 length normalization) */
  length: number
}

/**
 * Term entry in the dictionary
 */
export interface DictionaryEntry {
  /** The term string */
  term: string
  /** Document frequency (number of docs containing this term) */
  df: number
  /** Byte offset to posting list in postings file */
  offset: number
  /** Byte length of the posting list */
  length: number
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
 * Search result with score
 */
export interface SearchResult {
  /** Document ID (string) */
  id: string
  /** BM25 score */
  score: number
}

/**
 * Index statistics for BM25
 */
export interface IndexStats {
  /** Total number of documents */
  totalDocs: number
  /** Average document length in terms */
  avgDocLength: number
  /** Sum of all document lengths */
  totalLength: number
}

/**
 * Range fetch function for streaming from R2
 */
export type RangeFetcher = (offset: number, length: number) => Promise<Uint8Array>

// ============================================================================
// Roaring Bitmap - Simplified Implementation
// ============================================================================

/**
 * Simplified Roaring Bitmap for posting lists
 *
 * Uses containers (array or bitmap) based on cardinality:
 * - Array container: for sparse sets (< 4096 elements per 65536 range)
 * - Bitmap container: for dense sets (>= 4096 elements)
 *
 * Each container covers a 16-bit key range (0-65535)
 */
export class RoaringBitmap {
  /** Map from high 16 bits to container */
  private containers: Map<number, ArrayContainer | BitmapContainer> = new Map()

  /**
   * Add a value to the bitmap
   */
  add(value: number): void {
    const high = value >>> 16
    const low = value & 0xffff

    let container = this.containers.get(high)
    if (!container) {
      container = new ArrayContainer()
      this.containers.set(high, container)
    }

    container.add(low)

    // Convert to bitmap if array gets too large
    if (container instanceof ArrayContainer && container.cardinality >= 4096) {
      this.containers.set(high, container.toBitmap())
    }
  }

  /**
   * Check if value exists
   */
  contains(value: number): boolean {
    const high = value >>> 16
    const low = value & 0xffff

    const container = this.containers.get(high)
    return container ? container.contains(low) : false
  }

  /**
   * Get all values as array
   */
  toArray(): number[] {
    const result: number[] = []

    const sortedKeys = Array.from(this.containers.keys()).sort((a, b) => a - b)

    for (const high of sortedKeys) {
      const container = this.containers.get(high)!
      const values = container.toArray()
      for (const low of values) {
        result.push((high << 16) | low)
      }
    }

    return result
  }

  /**
   * Get cardinality (number of values)
   */
  get cardinality(): number {
    let count = 0
    for (const container of this.containers.values()) {
      count += container.cardinality
    }
    return count
  }

  /**
   * Intersect with another bitmap (AND)
   */
  and(other: RoaringBitmap): RoaringBitmap {
    const result = new RoaringBitmap()

    for (const [high, container] of this.containers) {
      const otherContainer = other.containers.get(high)
      if (otherContainer) {
        const intersection = container.and(otherContainer)
        if (intersection.cardinality > 0) {
          result.containers.set(high, intersection)
        }
      }
    }

    return result
  }

  /**
   * Union with another bitmap (OR)
   */
  or(other: RoaringBitmap): RoaringBitmap {
    const result = new RoaringBitmap()

    // Copy this bitmap
    for (const [high, container] of this.containers) {
      result.containers.set(high, container.clone())
    }

    // Merge other bitmap
    for (const [high, otherContainer] of other.containers) {
      const existing = result.containers.get(high)
      if (existing) {
        result.containers.set(high, existing.or(otherContainer))
      } else {
        result.containers.set(high, otherContainer.clone())
      }
    }

    return result
  }

  /**
   * Serialize to bytes
   */
  serialize(): Uint8Array {
    const containerCount = this.containers.size
    const parts: Uint8Array[] = []

    // Header: container count (4 bytes)
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, containerCount, true)
    parts.push(header)

    // Container entries: high (2 bytes) + type (1 byte) + data
    const sortedKeys = Array.from(this.containers.keys()).sort((a, b) => a - b)

    for (const high of sortedKeys) {
      const container = this.containers.get(high)!
      const isArray = container instanceof ArrayContainer

      // Key entry: high (2) + type (1) + length (4)
      const entry = new Uint8Array(7)
      const entryView = new DataView(entry.buffer)
      entryView.setUint16(0, high, true)
      entry[2] = isArray ? 0 : 1
      const data = container.serialize()
      entryView.setUint32(3, data.length, true)

      parts.push(entry)
      parts.push(data)
    }

    // Concatenate all parts
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
   * Deserialize from bytes
   */
  static deserialize(bytes: Uint8Array): RoaringBitmap {
    const bitmap = new RoaringBitmap()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    const containerCount = view.getUint32(0, true)
    let offset = 4

    for (let i = 0; i < containerCount; i++) {
      const high = view.getUint16(offset, true)
      const type = bytes[offset + 2]
      const dataLength = view.getUint32(offset + 3, true)
      offset += 7

      const data = bytes.slice(offset, offset + dataLength)
      offset += dataLength

      if (type === 0) {
        bitmap.containers.set(high, ArrayContainer.deserialize(data))
      } else {
        bitmap.containers.set(high, BitmapContainer.deserialize(data))
      }
    }

    return bitmap
  }
}

/**
 * Array container for sparse sets
 */
class ArrayContainer {
  private values: Set<number> = new Set()

  get cardinality(): number {
    return this.values.size
  }

  add(value: number): void {
    this.values.add(value)
  }

  contains(value: number): boolean {
    return this.values.has(value)
  }

  toArray(): number[] {
    return Array.from(this.values).sort((a, b) => a - b)
  }

  toBitmap(): BitmapContainer {
    const bitmap = new BitmapContainer()
    for (const value of this.values) {
      bitmap.add(value)
    }
    return bitmap
  }

  clone(): ArrayContainer {
    const result = new ArrayContainer()
    result.values = new Set(this.values)
    return result
  }

  and(other: ArrayContainer | BitmapContainer): ArrayContainer | BitmapContainer {
    const result = new ArrayContainer()
    for (const value of this.values) {
      if (other.contains(value)) {
        result.add(value)
      }
    }
    return result
  }

  or(other: ArrayContainer | BitmapContainer): ArrayContainer | BitmapContainer {
    if (other instanceof BitmapContainer) {
      return other.or(this)
    }

    const result = new ArrayContainer()
    result.values = new Set(this.values)
    for (const value of other.values) {
      result.values.add(value)
    }

    if (result.cardinality >= 4096) {
      return result.toBitmap()
    }
    return result
  }

  serialize(): Uint8Array {
    const sorted = this.toArray()
    const result = new Uint8Array(2 + sorted.length * 2)
    const view = new DataView(result.buffer)

    view.setUint16(0, sorted.length, true)
    for (let i = 0; i < sorted.length; i++) {
      view.setUint16(2 + i * 2, sorted[i], true)
    }

    return result
  }

  static deserialize(bytes: Uint8Array): ArrayContainer {
    const container = new ArrayContainer()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    const count = view.getUint16(0, true)
    for (let i = 0; i < count; i++) {
      container.add(view.getUint16(2 + i * 2, true))
    }

    return container
  }
}

/**
 * Bitmap container for dense sets
 */
class BitmapContainer {
  private bitmap: Uint32Array = new Uint32Array(2048) // 65536 bits = 2048 uint32
  private count: number = 0

  get cardinality(): number {
    return this.count
  }

  add(value: number): void {
    const wordIndex = value >>> 5
    const bitIndex = value & 31
    const mask = 1 << bitIndex

    if ((this.bitmap[wordIndex] & mask) === 0) {
      this.bitmap[wordIndex] |= mask
      this.count++
    }
  }

  contains(value: number): boolean {
    const wordIndex = value >>> 5
    const bitIndex = value & 31
    return (this.bitmap[wordIndex] & (1 << bitIndex)) !== 0
  }

  toArray(): number[] {
    const result: number[] = []
    for (let wordIndex = 0; wordIndex < 2048; wordIndex++) {
      let word = this.bitmap[wordIndex]
      if (word !== 0) {
        for (let bitIndex = 0; bitIndex < 32; bitIndex++) {
          if ((word & (1 << bitIndex)) !== 0) {
            result.push((wordIndex << 5) | bitIndex)
          }
        }
      }
    }
    return result
  }

  clone(): BitmapContainer {
    const result = new BitmapContainer()
    result.bitmap = new Uint32Array(this.bitmap)
    result.count = this.count
    return result
  }

  and(other: ArrayContainer | BitmapContainer): ArrayContainer | BitmapContainer {
    if (other instanceof ArrayContainer) {
      const result = new ArrayContainer()
      for (const value of other.toArray()) {
        if (this.contains(value)) {
          result.add(value)
        }
      }
      return result
    }

    const result = new BitmapContainer()
    for (let i = 0; i < 2048; i++) {
      result.bitmap[i] = this.bitmap[i] & other.bitmap[i]
    }
    result.count = result.toArray().length
    return result
  }

  or(other: ArrayContainer | BitmapContainer): BitmapContainer {
    const result = this.clone()

    if (other instanceof ArrayContainer) {
      for (const value of other.toArray()) {
        result.add(value)
      }
    } else {
      for (let i = 0; i < 2048; i++) {
        result.bitmap[i] |= other.bitmap[i]
      }
      result.count = result.toArray().length
    }

    return result
  }

  serialize(): Uint8Array {
    // Run-length encode the bitmap for compression
    const runs: Array<[number, number]> = []
    let start = -1

    for (let i = 0; i < 65536; i++) {
      const isSet = this.contains(i)
      if (isSet && start === -1) {
        start = i
      } else if (!isSet && start !== -1) {
        runs.push([start, i - start])
        start = -1
      }
    }
    if (start !== -1) {
      runs.push([start, 65536 - start])
    }

    // If runs are efficient, use RLE; otherwise store full bitmap
    const rleSize = 4 + runs.length * 4
    const fullSize = 4 + 8192

    if (rleSize < fullSize) {
      const result = new Uint8Array(1 + rleSize)
      result[0] = 0 // RLE marker
      const view = new DataView(result.buffer)
      view.setUint32(1, runs.length, true)
      for (let i = 0; i < runs.length; i++) {
        view.setUint16(5 + i * 4, runs[i][0], true)
        view.setUint16(7 + i * 4, runs[i][1], true)
      }
      return result
    }

    const result = new Uint8Array(1 + 8192)
    result[0] = 1 // Full bitmap marker
    new Uint8Array(result.buffer, 1).set(new Uint8Array(this.bitmap.buffer))
    return result
  }

  static deserialize(bytes: Uint8Array): BitmapContainer {
    const container = new BitmapContainer()
    const marker = bytes[0]

    if (marker === 0) {
      // RLE encoded
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const runCount = view.getUint32(1, true)
      for (let i = 0; i < runCount; i++) {
        const start = view.getUint16(5 + i * 4, true)
        const length = view.getUint16(7 + i * 4, true)
        for (let j = 0; j < length; j++) {
          container.add(start + j)
        }
      }
    } else {
      // Full bitmap
      container.bitmap = new Uint32Array(bytes.buffer.slice(bytes.byteOffset + 1, bytes.byteOffset + 1 + 8192))
      container.count = container.toArray().length
    }

    return container
  }
}

// ============================================================================
// Posting List with Term Frequencies
// ============================================================================

/**
 * Encode a posting list with term frequencies
 *
 * Format:
 * - count: varint (number of postings)
 * - For each posting:
 *   - docId delta: varint
 *   - tf: varint
 */
export function encodePostingsWithTF(postings: PostingEntry[]): Uint8Array {
  if (postings.length === 0) {
    return encodeVarint(0)
  }

  // Sort by docId
  const sorted = postings.slice().sort((a, b) => a.docId - b.docId)

  // Calculate size
  let size = varintSize(sorted.length)
  let prevDocId = 0
  for (const posting of sorted) {
    size += varintSize(posting.docId - prevDocId)
    size += varintSize(posting.tf)
    prevDocId = posting.docId
  }

  // Encode
  const result = new Uint8Array(size)
  let offset = 0

  // Write count
  const countBytes = encodeVarint(sorted.length)
  result.set(countBytes, offset)
  offset += countBytes.length

  // Write postings
  prevDocId = 0
  for (const posting of sorted) {
    const deltaBytes = encodeVarint(posting.docId - prevDocId)
    result.set(deltaBytes, offset)
    offset += deltaBytes.length

    const tfBytes = encodeVarint(posting.tf)
    result.set(tfBytes, offset)
    offset += tfBytes.length

    prevDocId = posting.docId
  }

  return result
}

/**
 * Decode a posting list with term frequencies
 */
export function decodePostingsWithTF(bytes: Uint8Array): PostingEntry[] {
  if (bytes.length === 0) {
    return []
  }

  let offset = 0

  const [count, countBytes] = decodeVarint(bytes, offset)
  offset += countBytes

  if (count === 0) {
    return []
  }

  const postings: PostingEntry[] = []
  let prevDocId = 0

  for (let i = 0; i < count; i++) {
    const [delta, deltaBytes] = decodeVarint(bytes, offset)
    offset += deltaBytes

    const [tf, tfBytes] = decodeVarint(bytes, offset)
    offset += tfBytes

    const docId = prevDocId + delta
    postings.push({ docId, tf })
    prevDocId = docId
  }

  return postings
}

// ============================================================================
// Varint Encoding (reused from existing implementation)
// ============================================================================

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

export function decodeVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let bytesRead = 0

  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]
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

export function varintSize(value: number): number {
  if (value < 0) return 5
  if (value < 128) return 1
  if (value < 16384) return 2
  if (value < 2097152) return 3
  if (value < 268435456) return 4
  return 5
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
  // BM25+ variant: always positive IDF
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
 * Separates dictionary (term -> offset) from postings (doc IDs + TF)
 * for efficient range requests.
 */
export class FullTextIndex {
  /** Document ID to metadata mapping */
  private documents: Map<string, DocumentMetadata> = new Map()

  /** Numeric ID counter */
  private nextNumericId: number = 0

  /** Numeric ID to string ID mapping */
  private numericToStringId: Map<number, string> = new Map()

  /** Term to postings mapping (in-memory during build) */
  private termPostings: Map<string, Map<number, number>> = new Map() // term -> (docId -> tf)

  /** Index statistics */
  private stats: IndexStats = {
    totalDocs: 0,
    avgDocLength: 0,
    totalLength: 0,
  }

  /** Loaded dictionary entries (for query mode) */
  private dictionary: Map<string, DictionaryEntry> = new Map()

  /** Loaded postings data (for in-memory query) */
  private postingsData: Uint8Array | null = null

  /** Postings base offset (for range calculations) */
  private postingsBaseOffset: number = 0

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

    // Update stats
    this.stats.totalDocs++
    this.stats.totalLength += docLength
    this.stats.avgDocLength = this.stats.totalLength / this.stats.totalDocs
  }

  /**
   * Remove a document from the index
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

    // Update stats
    this.stats.totalDocs--
    this.stats.totalLength -= metadata.length
    this.stats.avgDocLength = this.stats.totalDocs > 0 ? this.stats.totalLength / this.stats.totalDocs : 0

    // Remove document
    this.documents.delete(docId)
    this.numericToStringId.delete(metadata.numericId)

    return true
  }

  /**
   * Get number of indexed documents
   */
  get documentCount(): number {
    return this.documents.size
  }

  /**
   * Get number of unique terms
   */
  get termCount(): number {
    return this.termPostings.size
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return { ...this.stats }
  }

  // ==========================================================================
  // Search Methods (In-Memory)
  // ==========================================================================

  /**
   * Search for documents matching query
   *
   * @param query - Search query (space-separated terms)
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
      const docMetadata = this.numericToStringId.get(docId)
      if (!docMetadata) continue

      const doc = this.documents.get(docMetadata)
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
    let result = new Set(sorted[0].keys())

    for (let i = 1; i < sorted.length && result.size > 0; i++) {
      const otherKeys = new Set(sorted[i].keys())
      result = new Set([...result].filter((x) => otherKeys.has(x)))
    }

    return Array.from(result)
  }

  // ==========================================================================
  // Serialization Methods
  // ==========================================================================

  /**
   * Serialize dictionary to bytes
   *
   * Format:
   * - Header (32 bytes):
   *   - magic: 4 bytes "FXDI"
   *   - version: 2 bytes
   *   - term_count: 4 bytes
   *   - total_docs: 4 bytes
   *   - avg_doc_length: 4 bytes (fixed point, multiply by 100)
   *   - total_length: 4 bytes
   *   - reserved: 10 bytes
   *
   * - Document metadata:
   *   - doc_count: 4 bytes
   *   - For each doc:
   *     - id_length: 2 bytes
   *     - id: string bytes
   *     - numeric_id: 4 bytes
   *     - doc_length: 4 bytes
   *
   * - Term entries:
   *   - For each term (sorted):
   *     - term_length: 1 byte
   *     - term: string bytes
   *     - df: 4 bytes
   *     - offset: 4 bytes
   *     - length: 4 bytes
   *   - End marker: 0x00
   */
  serializeDictionary(): Uint8Array {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    // Sort terms
    const sortedTerms = Array.from(this.termPostings.keys()).sort()

    // Build postings first to get offsets
    const postingsInfo = this.buildPostingsInfo(sortedTerms)

    // Header
    const header = new Uint8Array(HEADER_SIZE)
    const headerView = new DataView(header.buffer)
    header.set(DICTIONARY_MAGIC, 0)
    headerView.setUint16(4, FORMAT_VERSION, true)
    headerView.setUint32(6, sortedTerms.length, true)
    headerView.setUint32(10, this.stats.totalDocs, true)
    headerView.setUint32(14, Math.round(this.stats.avgDocLength * 100), true)
    headerView.setUint32(18, this.stats.totalLength, true)
    parts.push(header)

    // Document metadata
    const docCount = new Uint8Array(4)
    new DataView(docCount.buffer).setUint32(0, this.documents.size, true)
    parts.push(docCount)

    for (const [docId, metadata] of this.documents) {
      const idBytes = encoder.encode(docId)
      const docEntry = new Uint8Array(2 + idBytes.length + 4 + 4)
      const docView = new DataView(docEntry.buffer)
      docView.setUint16(0, idBytes.length, true)
      docEntry.set(idBytes, 2)
      docView.setUint32(2 + idBytes.length, metadata.numericId, true)
      docView.setUint32(2 + idBytes.length + 4, metadata.length, true)
      parts.push(docEntry)
    }

    // Term entries
    for (const term of sortedTerms) {
      const termBytes = encoder.encode(term)
      const info = postingsInfo.get(term)!

      const entry = new Uint8Array(1 + termBytes.length + 4 + 4 + 4)
      const entryView = new DataView(entry.buffer)
      entry[0] = termBytes.length
      entry.set(termBytes, 1)
      entryView.setUint32(1 + termBytes.length, info.df, true)
      entryView.setUint32(1 + termBytes.length + 4, info.offset, true)
      entryView.setUint32(1 + termBytes.length + 8, info.length, true)
      parts.push(entry)
    }

    // End marker
    parts.push(new Uint8Array([0]))

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
   * Serialize postings to bytes
   *
   * Format:
   * - Header (32 bytes):
   *   - magic: 4 bytes "FXPO"
   *   - version: 2 bytes
   *   - term_count: 4 bytes
   *   - reserved: 22 bytes
   *
   * - Posting lists (concatenated):
   *   - Each list: varint-encoded count + delta-encoded docIds with TFs
   */
  serializePostings(): Uint8Array {
    const sortedTerms = Array.from(this.termPostings.keys()).sort()
    const parts: Uint8Array[] = []

    // Header
    const header = new Uint8Array(HEADER_SIZE)
    const headerView = new DataView(header.buffer)
    header.set(POSTINGS_MAGIC, 0)
    headerView.setUint16(4, FORMAT_VERSION, true)
    headerView.setUint32(6, sortedTerms.length, true)
    parts.push(header)

    // Posting lists
    for (const term of sortedTerms) {
      const postings = this.termPostings.get(term)!
      const entries: PostingEntry[] = Array.from(postings.entries()).map(([docId, tf]) => ({ docId, tf }))
      parts.push(encodePostingsWithTF(entries))
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
   * Build postings info (offset, length) for each term
   */
  private buildPostingsInfo(sortedTerms: string[]): Map<string, { df: number; offset: number; length: number }> {
    const info = new Map<string, { df: number; offset: number; length: number }>()
    let offset = HEADER_SIZE // Start after postings header

    for (const term of sortedTerms) {
      const postings = this.termPostings.get(term)!
      const entries: PostingEntry[] = Array.from(postings.entries()).map(([docId, tf]) => ({ docId, tf }))
      const encoded = encodePostingsWithTF(entries)

      info.set(term, {
        df: postings.size,
        offset,
        length: encoded.length,
      })

      offset += encoded.length
    }

    return info
  }

  // ==========================================================================
  // Streaming Methods (for R2)
  // ==========================================================================

  /**
   * Load dictionary from bytes
   */
  async loadDictionary(data: Uint8Array): Promise<void> {
    const decoder = new TextDecoder()
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    // Validate magic
    for (let i = 0; i < DICTIONARY_MAGIC.length; i++) {
      if (data[i] !== DICTIONARY_MAGIC[i]) {
        throw new Error('Invalid dictionary: magic mismatch')
      }
    }

    // Parse header
    const version = view.getUint16(4, true)
    if (version !== FORMAT_VERSION) {
      throw new Error(`Unsupported dictionary version: ${version}`)
    }

    const termCount = view.getUint32(6, true)
    this.stats.totalDocs = view.getUint32(10, true)
    this.stats.avgDocLength = view.getUint32(14, true) / 100
    this.stats.totalLength = view.getUint32(18, true)

    let offset = HEADER_SIZE

    // Parse document metadata
    const docCount = view.getUint32(offset, true)
    offset += 4

    for (let i = 0; i < docCount; i++) {
      const idLength = view.getUint16(offset, true)
      offset += 2

      const id = decoder.decode(data.slice(offset, offset + idLength))
      offset += idLength

      const numericId = view.getUint32(offset, true)
      offset += 4

      const docLength = view.getUint32(offset, true)
      offset += 4

      this.documents.set(id, { id, numericId, length: docLength })
      this.numericToStringId.set(numericId, id)
    }

    // Parse term entries
    this.dictionary.clear()

    for (let i = 0; i < termCount; i++) {
      const termLength = data[offset]
      if (termLength === 0) break
      offset++

      const term = decoder.decode(data.slice(offset, offset + termLength))
      offset += termLength

      const df = view.getUint32(offset, true)
      offset += 4

      const postingOffset = view.getUint32(offset, true)
      offset += 4

      const postingLength = view.getUint32(offset, true)
      offset += 4

      this.dictionary.set(term, { term, df, offset: postingOffset, length: postingLength })
    }
  }

  /**
   * Get postings for a term using range fetching
   *
   * @param term - Term to look up
   * @param fetch - Function to fetch byte range from R2
   * @returns Array of numeric doc IDs, or empty if term not found
   */
  async getPostings(term: string, fetch: RangeFetcher): Promise<PostingEntry[]> {
    const entry = this.dictionary.get(term)
    if (!entry) {
      return []
    }

    const postingBytes = await fetch(entry.offset, entry.length)
    return decodePostingsWithTF(postingBytes)
  }

  /**
   * Search with streaming from R2
   *
   * @param query - Search query
   * @param fetch - Function to fetch byte range from R2
   * @returns Array of results sorted by score
   */
  async searchStreaming(query: string, fetch: RangeFetcher): Promise<SearchResult[]> {
    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) {
      return []
    }

    // Check if all terms exist
    for (const term of queryTerms) {
      if (!this.dictionary.has(term)) {
        return []
      }
    }

    // Fetch postings for all query terms
    const termPostings = new Map<string, PostingEntry[]>()
    for (const term of queryTerms) {
      const postings = await this.getPostings(term, fetch)
      termPostings.set(term, postings)
    }

    // Find intersection
    const firstPostings = termPostings.get(queryTerms[0])!
    let matchingDocIds = new Set(firstPostings.map((p) => p.docId))

    for (let i = 1; i < queryTerms.length; i++) {
      const postings = termPostings.get(queryTerms[i])!
      const otherDocIds = new Set(postings.map((p) => p.docId))
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
        const posting = postings.find((p) => p.docId === docId)
        if (!posting) continue

        const entry = this.dictionary.get(term)!
        const idf = calculateIDF(this.stats.totalDocs, entry.df)
        const termScore = calculateBM25Score(posting.tf, doc.length, this.stats.avgDocLength, idf)

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
   * Load full postings data (for smaller indexes that fit in memory)
   */
  loadPostings(data: Uint8Array): void {
    // Validate magic
    for (let i = 0; i < POSTINGS_MAGIC.length; i++) {
      if (data[i] !== POSTINGS_MAGIC[i]) {
        throw new Error('Invalid postings: magic mismatch')
      }
    }

    this.postingsData = data
    this.postingsBaseOffset = HEADER_SIZE
  }

  /**
   * Get postings from loaded in-memory data
   */
  getPostingsInMemory(term: string): PostingEntry[] {
    if (!this.postingsData) {
      throw new Error('Postings data not loaded')
    }

    const entry = this.dictionary.get(term)
    if (!entry) {
      return []
    }

    const postingBytes = this.postingsData.slice(entry.offset, entry.offset + entry.length)
    return decodePostingsWithTF(postingBytes)
  }

  /**
   * Search using in-memory postings
   */
  searchInMemory(query: string): SearchResult[] {
    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) {
      return []
    }

    // Check if all terms exist
    for (const term of queryTerms) {
      if (!this.dictionary.has(term)) {
        return []
      }
    }

    // Get postings for all query terms
    const termPostings = new Map<string, PostingEntry[]>()
    for (const term of queryTerms) {
      termPostings.set(term, this.getPostingsInMemory(term))
    }

    // Find intersection
    const firstPostings = termPostings.get(queryTerms[0])!
    let matchingDocIds = new Set(firstPostings.map((p) => p.docId))

    for (let i = 1; i < queryTerms.length; i++) {
      const postings = termPostings.get(queryTerms[i])!
      const otherDocIds = new Set(postings.map((p) => p.docId))
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
        const posting = postings.find((p) => p.docId === docId)
        if (!posting) continue

        const entry = this.dictionary.get(term)!
        const idf = calculateIDF(this.stats.totalDocs, entry.df)
        const termScore = calculateBM25Score(posting.tf, doc.length, this.stats.avgDocLength, idf)

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
  // Utility Methods
  // ==========================================================================

  /**
   * Get all terms in the dictionary
   */
  getTerms(): string[] {
    if (this.dictionary.size > 0) {
      return Array.from(this.dictionary.keys()).sort()
    }
    return Array.from(this.termPostings.keys()).sort()
  }

  /**
   * Check if a term exists
   */
  hasTerm(term: string): boolean {
    if (this.dictionary.size > 0) {
      return this.dictionary.has(term)
    }
    return this.termPostings.has(term)
  }

  /**
   * Get document frequency for a term
   */
  getDocumentFrequency(term: string): number {
    if (this.dictionary.size > 0) {
      return this.dictionary.get(term)?.df || 0
    }
    return this.termPostings.get(term)?.size || 0
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear()
    this.numericToStringId.clear()
    this.termPostings.clear()
    this.dictionary.clear()
    this.postingsData = null
    this.stats = { totalDocs: 0, avgDocLength: 0, totalLength: 0 }
    this.nextNumericId = 0
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

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

/**
 * Load a FullTextIndex from serialized dictionary and postings
 */
export async function loadFullTextIndex(dictionary: Uint8Array, postings: Uint8Array): Promise<FullTextIndex> {
  const index = new FullTextIndex()
  await index.loadDictionary(dictionary)
  index.loadPostings(postings)
  return index
}
