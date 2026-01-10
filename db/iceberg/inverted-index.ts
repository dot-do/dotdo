/**
 * Compact Binary Inverted Index Format
 *
 * A memory-efficient inverted index format designed for Cloudflare Snippets
 * (2MB memory, <5ms CPU). Enables full-text search via term -> posting list lookups.
 *
 * Binary Format:
 * ```
 * Header (16 bytes):
 *   magic:      4 bytes "INVI"
 *   version:    2 bytes (little-endian, currently 1)
 *   term_count: 4 bytes (little-endian, number of unique terms)
 *   flags:      2 bytes (bit flags for features)
 *   reserved:   4 bytes (future use, must be 0)
 *
 * Term Index (variable length):
 *   For each term (sorted lexicographically):
 *     term_length: 1 byte (max 255 chars)
 *     term:        term_length bytes (UTF-8)
 *     offset:      4 bytes (little-endian, byte offset to posting list)
 *     length:      4 bytes (little-endian, byte length of posting list)
 *
 * Term Index End Marker:
 *   0x00 (single null byte indicating end of term index)
 *
 * Posting Lists (variable length):
 *   For each posting list:
 *     doc_count: varint (number of document IDs)
 *     doc_ids:   varint-encoded, delta-compressed document IDs
 * ```
 *
 * Key Design Decisions:
 * - Fixed 16-byte header for fast validation
 * - Terms sorted for binary search (O(log n) lookup)
 * - Term index separate from posting lists for range requests
 * - Varint encoding for posting lists (1-5 bytes per ID)
 * - Delta encoding for sorted doc IDs (smaller deltas = smaller varints)
 *
 * Memory Budget Analysis (from issue):
 * - ~56K terms vocabulary-only per 1MB
 * - With posting lists: depends on average list size
 * - Typical: 10K terms + 100K postings in ~500KB
 *
 * @example
 * ```typescript
 * // Building an index
 * const writer = new InvertedIndexWriter()
 * writer.addPosting('hello', 1)
 * writer.addPosting('hello', 5)
 * writer.addPosting('world', 2)
 * const bytes = writer.serialize()
 *
 * // Querying an index
 * const reader = InvertedIndexReader.deserialize(bytes)
 * const postings = reader.getPostings('hello')  // [1, 5]
 * ```
 *
 * @see https://en.wikipedia.org/wiki/Inverted_index
 * @module db/iceberg/inverted-index
 */

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes for inverted index format: "INVI" */
export const INVERTED_INDEX_MAGIC = new Uint8Array([0x49, 0x4e, 0x56, 0x49]) // "INVI"

/** Current format version */
export const INVERTED_INDEX_VERSION = 1

/** Header size in bytes */
export const HEADER_SIZE = 16

/** Maximum term length (single byte length prefix) */
export const MAX_TERM_LENGTH = 255

/**
 * Feature flags for the index
 */
export const enum IndexFlags {
  /** No special features */
  NONE = 0,
  /** Term frequencies stored (not yet implemented) */
  HAS_FREQUENCIES = 1 << 0,
  /** Position data stored (not yet implemented) */
  HAS_POSITIONS = 1 << 1,
}

// ============================================================================
// Types
// ============================================================================

/**
 * A posting entry mapping a term to a document ID
 */
export interface Posting {
  /** The term (word/token) */
  term: string
  /** Document ID containing this term */
  docId: number
}

/**
 * Term entry in the index with offset information
 */
export interface TermEntry {
  /** The term string */
  term: string
  /** Byte offset to posting list in the file */
  offset: number
  /** Byte length of the posting list */
  length: number
}

/**
 * Range request for fetching specific bytes
 */
export interface RangeRequest {
  /** Start byte offset (inclusive) */
  start: number
  /** End byte offset (exclusive) */
  end: number
}

/**
 * Index metadata extracted from header
 */
export interface InvertedIndexMetadata {
  /** Format version */
  version: number
  /** Number of unique terms */
  termCount: number
  /** Feature flags */
  flags: number
}

// ============================================================================
// Varint Encoding/Decoding
// ============================================================================

/**
 * Encode a non-negative integer as a varint
 *
 * Uses LEB128 encoding: 7 bits per byte, high bit indicates continuation.
 * Values 0-127 use 1 byte, 128-16383 use 2 bytes, etc.
 *
 * @param value - Non-negative integer to encode
 * @returns Varint-encoded bytes
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
      byte |= 0x80 // Set continuation bit
    }
    bytes.push(byte)
  } while (value !== 0)

  return new Uint8Array(bytes)
}

/**
 * Decode a varint from a byte array at the given offset
 *
 * @param bytes - Byte array containing the varint
 * @param offset - Starting offset in the array
 * @returns Tuple of [decoded value, bytes consumed]
 */
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

    // Prevent overflow (max 5 bytes for 32-bit values)
    if (bytesRead >= 5) {
      throw new Error('Varint exceeds maximum size')
    }
  }

  throw new Error('Unexpected end of varint')
}

/**
 * Calculate the byte size of a varint-encoded value
 *
 * @param value - Value to measure
 * @returns Number of bytes needed
 */
export function varintSize(value: number): number {
  if (value < 0) return 5 // Max size for negative (treated as large positive)
  if (value < 128) return 1
  if (value < 16384) return 2
  if (value < 2097152) return 3
  if (value < 268435456) return 4
  return 5
}

// ============================================================================
// Posting List Encoding/Decoding
// ============================================================================

/**
 * Encode a sorted array of document IDs as a delta-compressed posting list
 *
 * Format:
 * - doc_count: varint (number of IDs)
 * - doc_ids: varint-encoded deltas from previous ID (first ID is delta from 0)
 *
 * @param docIds - Sorted array of document IDs
 * @returns Encoded posting list bytes
 */
export function encodePostingList(docIds: number[]): Uint8Array {
  if (docIds.length === 0) {
    return encodeVarint(0)
  }

  // Calculate total size
  let totalSize = varintSize(docIds.length)
  let prevId = 0
  for (const docId of docIds) {
    const delta = docId - prevId
    totalSize += varintSize(delta)
    prevId = docId
  }

  // Encode
  const result = new Uint8Array(totalSize)
  let offset = 0

  // Write count
  const countBytes = encodeVarint(docIds.length)
  result.set(countBytes, offset)
  offset += countBytes.length

  // Write delta-encoded IDs
  prevId = 0
  for (const docId of docIds) {
    const delta = docId - prevId
    const deltaBytes = encodeVarint(delta)
    result.set(deltaBytes, offset)
    offset += deltaBytes.length
    prevId = docId
  }

  return result
}

/**
 * Decode a delta-compressed posting list
 *
 * @param bytes - Encoded posting list bytes
 * @returns Array of document IDs
 */
export function decodePostingList(bytes: Uint8Array): number[] {
  if (bytes.length === 0) {
    return []
  }

  let offset = 0

  // Read count
  const [count, countBytes] = decodeVarint(bytes, offset)
  offset += countBytes

  if (count === 0) {
    return []
  }

  // Read delta-encoded IDs
  const docIds: number[] = []
  let prevId = 0

  for (let i = 0; i < count; i++) {
    const [delta, deltaBytes] = decodeVarint(bytes, offset)
    offset += deltaBytes
    const docId = prevId + delta
    docIds.push(docId)
    prevId = docId
  }

  return docIds
}

// ============================================================================
// InvertedIndexWriter
// ============================================================================

/**
 * Builder for creating inverted index files
 *
 * Collects postings (term -> doc ID mappings) and serializes them into
 * the compact binary format for efficient storage and lookup.
 *
 * @example
 * ```typescript
 * const writer = new InvertedIndexWriter()
 *
 * // Add postings from documents
 * for (const [docId, doc] of documents.entries()) {
 *   for (const term of tokenize(doc.text)) {
 *     writer.addPosting(term, docId)
 *   }
 * }
 *
 * // Serialize to bytes
 * const bytes = writer.serialize()
 *
 * // Or get size estimate first
 * console.log(`Estimated size: ${writer.estimateSize()} bytes`)
 * ```
 */
export class InvertedIndexWriter {
  /** Map from term to set of document IDs */
  private readonly postings: Map<string, Set<number>> = new Map()
  /** Feature flags */
  private flags: number = IndexFlags.NONE

  /**
   * Add a posting (term -> document ID mapping)
   *
   * @param term - The term (will be normalized to lowercase)
   * @param docId - Document ID containing this term
   */
  addPosting(term: string, docId: number): void {
    if (term.length === 0 || term.length > MAX_TERM_LENGTH) {
      return // Skip invalid terms
    }
    if (docId < 0 || !Number.isInteger(docId)) {
      throw new Error(`Invalid document ID: ${docId}`)
    }

    let docIds = this.postings.get(term)
    if (!docIds) {
      docIds = new Set()
      this.postings.set(term, docIds)
    }
    docIds.add(docId)
  }

  /**
   * Add multiple postings at once
   *
   * @param postings - Array of posting entries
   */
  addPostings(postings: Posting[]): void {
    for (const { term, docId } of postings) {
      this.addPosting(term, docId)
    }
  }

  /**
   * Add all terms from a document
   *
   * @param docId - Document ID
   * @param terms - Array of terms in the document
   */
  addDocument(docId: number, terms: string[]): void {
    for (const term of terms) {
      this.addPosting(term, docId)
    }
  }

  /**
   * Get the number of unique terms
   */
  get termCount(): number {
    return this.postings.size
  }

  /**
   * Get the total number of postings (term-doc pairs)
   */
  get postingCount(): number {
    let count = 0
    for (const docIds of this.postings.values()) {
      count += docIds.size
    }
    return count
  }

  /**
   * Estimate the serialized size in bytes
   *
   * Useful for checking memory constraints before serializing.
   *
   * @returns Estimated byte size
   */
  estimateSize(): number {
    let size = HEADER_SIZE

    // Term index size
    const encoder = new TextEncoder()
    for (const [term, docIds] of this.postings) {
      // term_length (1) + term + offset (4) + length (4)
      size += 1 + encoder.encode(term).length + 4 + 4
    }
    size += 1 // End marker

    // Posting lists size
    for (const docIds of this.postings.values()) {
      const sortedIds = Array.from(docIds).sort((a, b) => a - b)
      size += varintSize(sortedIds.length)
      let prevId = 0
      for (const id of sortedIds) {
        size += varintSize(id - prevId)
        prevId = id
      }
    }

    return size
  }

  /**
   * Check if the index fits within memory constraints
   *
   * @param maxBytes - Maximum allowed size (default: 2MB for Snippets)
   * @returns true if within constraints
   */
  fitsInMemory(maxBytes: number = 2 * 1024 * 1024): boolean {
    return this.estimateSize() <= maxBytes
  }

  /**
   * Serialize the index to binary format
   *
   * @returns Binary inverted index data
   * @throws Error if any term exceeds MAX_TERM_LENGTH
   */
  serialize(): Uint8Array {
    const encoder = new TextEncoder()

    // Sort terms lexicographically for binary search
    const sortedTerms = Array.from(this.postings.keys()).sort()

    // First pass: encode all posting lists and calculate offsets
    const postingListsData: Map<string, Uint8Array> = new Map()
    let totalPostingListSize = 0

    for (const term of sortedTerms) {
      const docIds = Array.from(this.postings.get(term)!).sort((a, b) => a - b)
      const encoded = encodePostingList(docIds)
      postingListsData.set(term, encoded)
      totalPostingListSize += encoded.length
    }

    // Calculate term index size
    let termIndexSize = 0
    for (const term of sortedTerms) {
      const termBytes = encoder.encode(term)
      if (termBytes.length > MAX_TERM_LENGTH) {
        throw new Error(`Term exceeds maximum length: ${term.substring(0, 50)}...`)
      }
      termIndexSize += 1 + termBytes.length + 4 + 4 // length + term + offset + length
    }
    termIndexSize += 1 // End marker

    // Calculate posting lists start offset
    const postingListsOffset = HEADER_SIZE + termIndexSize

    // Allocate result buffer
    const totalSize = HEADER_SIZE + termIndexSize + totalPostingListSize
    const result = new Uint8Array(totalSize)
    const view = new DataView(result.buffer)

    // Write header
    result.set(INVERTED_INDEX_MAGIC, 0)
    view.setUint16(4, INVERTED_INDEX_VERSION, true)
    view.setUint32(6, sortedTerms.length, true)
    view.setUint16(10, this.flags, true)
    view.setUint32(12, 0, true) // reserved

    // Write term index
    let writeOffset = HEADER_SIZE
    let postingOffset = postingListsOffset

    for (const term of sortedTerms) {
      const termBytes = encoder.encode(term)
      const postingListData = postingListsData.get(term)!

      // Write term length
      result[writeOffset++] = termBytes.length

      // Write term
      result.set(termBytes, writeOffset)
      writeOffset += termBytes.length

      // Write posting list offset
      view.setUint32(writeOffset, postingOffset, true)
      writeOffset += 4

      // Write posting list length
      view.setUint32(writeOffset, postingListData.length, true)
      writeOffset += 4

      postingOffset += postingListData.length
    }

    // Write end marker
    result[writeOffset++] = 0

    // Write posting lists
    for (const term of sortedTerms) {
      const postingListData = postingListsData.get(term)!
      result.set(postingListData, writeOffset)
      writeOffset += postingListData.length
    }

    return result
  }

  /**
   * Clear all postings
   */
  clear(): void {
    this.postings.clear()
  }
}

// ============================================================================
// InvertedIndexReader
// ============================================================================

/**
 * Reader for querying inverted index files
 *
 * Supports both full in-memory loading and range-addressable access
 * for partial loading (fetch term index first, then specific posting lists).
 *
 * @example
 * ```typescript
 * // Full loading
 * const reader = InvertedIndexReader.deserialize(bytes)
 * const postings = reader.getPostings('hello')
 *
 * // Range-addressable access (two requests)
 * const header = InvertedIndexReader.parseHeader(headerBytes)
 * const termIndex = InvertedIndexReader.parseTermIndex(termIndexBytes)
 * const entry = InvertedIndexReader.findTerm(termIndex, 'hello')
 * // Fetch bytes[entry.offset:entry.offset+entry.length]
 * const postings = InvertedIndexReader.parsePostingList(postingBytes)
 * ```
 */
export class InvertedIndexReader {
  private readonly metadata: InvertedIndexMetadata
  private readonly termIndex: TermEntry[]
  private readonly postingListsData: Uint8Array
  private readonly postingListsOffset: number

  private constructor(
    metadata: InvertedIndexMetadata,
    termIndex: TermEntry[],
    postingListsData: Uint8Array,
    postingListsOffset: number
  ) {
    this.metadata = metadata
    this.termIndex = termIndex
    this.postingListsData = postingListsData
    this.postingListsOffset = postingListsOffset
  }

  /**
   * Parse the header from raw bytes
   *
   * @param bytes - At least HEADER_SIZE bytes
   * @returns Parsed metadata
   */
  static parseHeader(bytes: Uint8Array): InvertedIndexMetadata {
    if (bytes.length < HEADER_SIZE) {
      throw new Error(`Header too short: expected ${HEADER_SIZE} bytes, got ${bytes.length}`)
    }

    // Validate magic
    for (let i = 0; i < INVERTED_INDEX_MAGIC.length; i++) {
      if (bytes[i] !== INVERTED_INDEX_MAGIC[i]) {
        throw new Error('Invalid inverted index: magic mismatch')
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = view.getUint16(4, true)
    const termCount = view.getUint32(6, true)
    const flags = view.getUint16(10, true)

    if (version !== INVERTED_INDEX_VERSION) {
      throw new Error(`Unsupported version: ${version}`)
    }

    return { version, termCount, flags }
  }

  /**
   * Parse the term index from raw bytes (starting after header)
   *
   * @param bytes - Bytes containing the term index (starting at offset 0)
   * @param termCount - Number of terms to parse
   * @returns Array of term entries
   */
  static parseTermIndex(bytes: Uint8Array, termCount: number): TermEntry[] {
    const decoder = new TextDecoder()
    const entries: TermEntry[] = []
    let offset = 0

    for (let i = 0; i < termCount; i++) {
      const termLength = bytes[offset++]

      if (termLength === 0 && i < termCount - 1) {
        throw new Error('Unexpected end of term index')
      }

      const termBytes = bytes.slice(offset, offset + termLength)
      offset += termLength

      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
      const postingOffset = view.getUint32(0, true)
      const postingLength = view.getUint32(4, true)
      offset += 8

      entries.push({
        term: decoder.decode(termBytes),
        offset: postingOffset,
        length: postingLength,
      })
    }

    return entries
  }

  /**
   * Parse a posting list from raw bytes
   *
   * @param bytes - Encoded posting list
   * @returns Array of document IDs
   */
  static parsePostingList(bytes: Uint8Array): number[] {
    return decodePostingList(bytes)
  }

  /**
   * Find a term in the sorted term index using binary search
   *
   * @param termIndex - Sorted array of term entries
   * @param term - Term to find
   * @returns Term entry or null if not found
   */
  static findTerm(termIndex: readonly TermEntry[], term: string): TermEntry | null {
    let left = 0
    let right = termIndex.length - 1

    while (left <= right) {
      const mid = (left + right) >>> 1
      const midTerm = termIndex[mid].term

      // Use simple lexicographic comparison (matches default sort order)
      if (term === midTerm) {
        return termIndex[mid]
      } else if (term < midTerm) {
        right = mid - 1
      } else {
        left = mid + 1
      }
    }

    return null
  }

  /**
   * Deserialize a complete inverted index from bytes
   *
   * @param bytes - Full inverted index data
   * @returns Reader instance
   */
  static deserialize(bytes: Uint8Array): InvertedIndexReader {
    const metadata = InvertedIndexReader.parseHeader(bytes)

    // Parse term index
    const termIndexStart = HEADER_SIZE
    const termIndexBytes = bytes.slice(termIndexStart)
    const termIndex = InvertedIndexReader.parseTermIndex(termIndexBytes, metadata.termCount)

    // Calculate posting lists offset
    // Find the end of term index (after all entries + end marker)
    let termIndexEnd = 0
    for (const entry of termIndex) {
      // Each entry: 1 (length) + term.length + 4 (offset) + 4 (length)
      termIndexEnd += 1 + new TextEncoder().encode(entry.term).length + 8
    }
    termIndexEnd += 1 // End marker

    const postingListsOffset = HEADER_SIZE + termIndexEnd
    const postingListsData = bytes.slice(postingListsOffset)

    return new InvertedIndexReader(metadata, termIndex, postingListsData, postingListsOffset)
  }

  /**
   * Get metadata about the index
   */
  getMetadata(): InvertedIndexMetadata {
    return { ...this.metadata }
  }

  /**
   * Get the number of unique terms
   */
  get termCount(): number {
    return this.metadata.termCount
  }

  /**
   * Get all terms in the index
   */
  getTerms(): string[] {
    return this.termIndex.map((e) => e.term)
  }

  /**
   * Check if a term exists in the index
   *
   * @param term - Term to check
   * @returns true if the term exists
   */
  hasTerm(term: string): boolean {
    return InvertedIndexReader.findTerm(this.termIndex, term) !== null
  }

  /**
   * Get the posting list for a term
   *
   * @param term - Term to look up
   * @returns Array of document IDs, or empty array if term not found
   */
  getPostings(term: string): number[] {
    const entry = InvertedIndexReader.findTerm(this.termIndex, term)
    if (!entry) {
      return []
    }

    // Calculate offset within posting lists data
    const localOffset = entry.offset - this.postingListsOffset
    const postingBytes = this.postingListsData.slice(localOffset, localOffset + entry.length)

    return InvertedIndexReader.parsePostingList(postingBytes)
  }

  /**
   * Get document frequency (number of docs containing term)
   *
   * @param term - Term to check
   * @returns Number of documents, or 0 if term not found
   */
  getDocumentFrequency(term: string): number {
    return this.getPostings(term).length
  }

  /**
   * Get the range request for a term's posting list
   *
   * Useful for range-addressable access without loading full index.
   *
   * @param term - Term to look up
   * @returns Range request or null if term not found
   */
  getPostingListRange(term: string): RangeRequest | null {
    const entry = InvertedIndexReader.findTerm(this.termIndex, term)
    if (!entry) {
      return null
    }
    return {
      start: entry.offset,
      end: entry.offset + entry.length,
    }
  }

  /**
   * Get range request for the term index portion
   *
   * @returns Range request for term index
   */
  getTermIndexRange(): RangeRequest {
    // First posting list offset tells us where term index ends
    if (this.termIndex.length === 0) {
      return { start: HEADER_SIZE, end: HEADER_SIZE + 1 } // Just end marker
    }
    return {
      start: HEADER_SIZE,
      end: this.termIndex[0].offset,
    }
  }

  /**
   * Search for terms matching a prefix
   *
   * @param prefix - Prefix to match
   * @param limit - Maximum results (default: 100)
   * @returns Array of matching term entries
   */
  searchPrefix(prefix: string, limit: number = 100): TermEntry[] {
    const results: TermEntry[] = []

    // Binary search to find first term >= prefix
    let left = 0
    let right = this.termIndex.length - 1
    let startIdx = this.termIndex.length

    while (left <= right) {
      const mid = (left + right) >>> 1
      const midTerm = this.termIndex[mid].term

      if (midTerm >= prefix) {
        startIdx = mid
        right = mid - 1
      } else {
        left = mid + 1
      }
    }

    // Collect matching terms
    for (let i = startIdx; i < this.termIndex.length && results.length < limit; i++) {
      const entry = this.termIndex[i]
      if (!entry.term.startsWith(prefix)) {
        break
      }
      results.push(entry)
    }

    return results
  }

  /**
   * Intersect posting lists for multiple terms (AND query)
   *
   * @param terms - Terms to intersect
   * @returns Document IDs that contain ALL terms
   */
  intersect(terms: string[]): number[] {
    if (terms.length === 0) {
      return []
    }

    // Get all posting lists
    const postingLists = terms.map((t) => this.getPostings(t))

    // If any term is missing, result is empty
    if (postingLists.some((p) => p.length === 0)) {
      return []
    }

    // Start with smallest list for efficiency
    const sorted = postingLists.slice().sort((a, b) => a.length - b.length)
    let result = sorted[0]

    for (let i = 1; i < sorted.length && result.length > 0; i++) {
      result = intersectSorted(result, sorted[i])
    }

    return result
  }

  /**
   * Union posting lists for multiple terms (OR query)
   *
   * @param terms - Terms to union
   * @returns Document IDs that contain ANY term
   */
  union(terms: string[]): number[] {
    if (terms.length === 0) {
      return []
    }

    const postingLists = terms.map((t) => this.getPostings(t)).filter((p) => p.length > 0)

    if (postingLists.length === 0) {
      return []
    }

    if (postingLists.length === 1) {
      return postingLists[0]
    }

    // Merge all lists
    let result = postingLists[0]
    for (let i = 1; i < postingLists.length; i++) {
      result = unionSorted(result, postingLists[i])
    }

    return result
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Intersect two sorted arrays of numbers
 *
 * @param a - First sorted array
 * @param b - Second sorted array
 * @returns Intersection (elements in both)
 */
function intersectSorted(a: number[], b: number[]): number[] {
  const result: number[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push(a[i])
      i++
      j++
    } else if (a[i] < b[j]) {
      i++
    } else {
      j++
    }
  }

  return result
}

/**
 * Union two sorted arrays of numbers
 *
 * @param a - First sorted array
 * @param b - Second sorted array
 * @returns Union (unique elements from both)
 */
function unionSorted(a: number[], b: number[]): number[] {
  const result: number[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push(a[i])
      i++
      j++
    } else if (a[i] < b[j]) {
      result.push(a[i])
      i++
    } else {
      result.push(b[j])
      j++
    }
  }

  // Add remaining elements
  while (i < a.length) {
    result.push(a[i++])
  }
  while (j < b.length) {
    result.push(b[j++])
  }

  return result
}

/**
 * Estimate the size of an inverted index for given parameters
 *
 * @param termCount - Number of unique terms
 * @param avgTermLength - Average term length in bytes (default: 8)
 * @param avgPostingsPerTerm - Average documents per term (default: 10)
 * @param avgDocIdBits - Average bits per doc ID delta (default: 10)
 * @returns Estimated size in bytes
 */
export function estimateInvertedIndexSize(
  termCount: number,
  avgTermLength: number = 8,
  avgPostingsPerTerm: number = 10,
  avgDocIdBits: number = 10
): number {
  // Header
  let size = HEADER_SIZE

  // Term index: 1 (length) + avgTermLength + 4 (offset) + 4 (length) per term
  size += termCount * (1 + avgTermLength + 8)
  size += 1 // End marker

  // Posting lists: count varint + doc_ids varints per term
  // Average varint size based on avgDocIdBits
  const avgVarintSize = Math.ceil(avgDocIdBits / 7)
  size += termCount * (1 + avgPostingsPerTerm * avgVarintSize)

  return size
}

/**
 * Simple tokenizer for testing
 *
 * Splits text into lowercase alphanumeric tokens.
 *
 * @param text - Text to tokenize
 * @returns Array of tokens
 */
export function simpleTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

/**
 * Create an inverted index from documents
 *
 * @param documents - Map or array of doc ID -> text
 * @param tokenizer - Function to tokenize text (default: simpleTokenize)
 * @returns Serialized inverted index bytes
 */
export function createInvertedIndex(
  documents: Map<number, string> | Array<[number, string]>,
  tokenizer: (text: string) => string[] = simpleTokenize
): Uint8Array {
  const writer = new InvertedIndexWriter()

  const entries = documents instanceof Map ? documents.entries() : documents

  for (const [docId, text] of entries) {
    const terms = tokenizer(text)
    writer.addDocument(docId, terms)
  }

  return writer.serialize()
}
