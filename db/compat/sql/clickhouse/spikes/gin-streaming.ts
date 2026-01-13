/**
 * SPIKE: GIN Full-Text Index Streaming from R2
 *
 * A streaming GIN (Generalized Inverted Index) implementation designed for
 * Cloudflare Workers with R2 storage. Key features:
 *
 * - FST (Finite State Transducer) dictionary for term->posting mapping
 * - Roaring bitmap postings with range-request support
 * - BM25 ranking with term frequency preservation
 * - Memory budget tracking (<50MB during search)
 *
 * Index Structure:
 * - *.gin_dict - FST dictionary mapping term to posting offset/length
 * - *.gin_post - Roaring bitmap postings (term -> row IDs + TF)
 * - *.gin_meta - Statistics (termCount, docCount, avgDocLength, docLengths)
 *
 * @module db/compat/sql/clickhouse/spikes/gin-streaming
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

/** Format version */
export const FORMAT_VERSION = 1

/** FST header size */
export const FST_HEADER_SIZE = 64

/** BM25 parameters */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

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
export interface GINSearchResult {
  id: string
  score: number
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

// ============================================================================
// Varint Encoding
// ============================================================================

function encodeVarint(value: number): Uint8Array {
  if (value < 0) throw new Error('Varint requires non-negative integer')
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    bytes.push(byte)
  } while (value !== 0)
  return new Uint8Array(bytes)
}

function decodeVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let bytesRead = 0

  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]!
    bytesRead++
    value |= (byte & 0x7f) << shift
    shift += 7
    if ((byte & 0x80) === 0) return [value, bytesRead]
    if (bytesRead >= 5) throw new Error('Varint too large')
  }
  throw new Error('Truncated varint')
}

function varintSize(value: number): number {
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
 *     - offset: 4 bytes (varint)
 *     - length: 4 bytes (varint)
 *     - df: 4 bytes (varint)
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
  static async streamLookup(
    headerBytes: Uint8Array,
    term: string,
    fetcher: RangeFetcher
  ): Promise<FSTEntry | null> {
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
  static async streamPostings(
    offset: number,
    length: number,
    fetcher: RangeFetcher
  ): Promise<StreamingRoaringPostings> {
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
// GIN Index Writer
// ============================================================================

/**
 * Builds GIN index from documents
 */
export class GINIndexWriter {
  private documents: Map<string, { numericId: number; length: number }> = new Map()
  private numericToStringId: Map<number, string> = new Map()
  private termPostings: Map<string, Map<number, number>> = new Map() // term -> docId -> tf
  private nextNumericId = 0
  private totalLength = 0

  /**
   * Add a document to the index
   */
  addDocument(docId: string, text: string): void {
    if (this.documents.has(docId)) {
      // Remove existing document
      this.removeDocument(docId)
    }

    const numericId = this.nextNumericId++
    const tokens = this.tokenize(text)
    const tf = new Map<string, number>()

    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1)
    }

    const docLength = tokens.length
    this.documents.set(docId, { numericId, length: docLength })
    this.numericToStringId.set(numericId, docId)
    this.totalLength += docLength

    for (const [term, count] of tf) {
      let postings = this.termPostings.get(term)
      if (!postings) {
        postings = new Map()
        this.termPostings.set(term, postings)
      }
      postings.set(numericId, count)
    }
  }

  /**
   * Remove a document from the index
   */
  private removeDocument(docId: string): void {
    const doc = this.documents.get(docId)
    if (!doc) return

    for (const postings of this.termPostings.values()) {
      postings.delete(doc.numericId)
    }

    this.totalLength -= doc.length
    this.numericToStringId.delete(doc.numericId)
    this.documents.delete(docId)
  }

  /**
   * Simple tokenizer
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && t.length <= 255)
  }

  /**
   * Get document count
   */
  get documentCount(): number {
    return this.documents.size
  }

  /**
   * Get term count
   */
  get termCount(): number {
    return this.termPostings.size
  }

  /**
   * Build the index files
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

    // Calculate average doc length
    const avgDocLength = this.documents.size > 0 ? this.totalLength / this.documents.size : 0

    // Header (32 bytes)
    const header = new Uint8Array(32)
    const headerView = new DataView(header.buffer)
    header.set(METADATA_MAGIC, 0)
    headerView.setUint16(4, FORMAT_VERSION, true)
    headerView.setUint32(6, this.termPostings.size, true)
    headerView.setUint32(10, this.documents.size, true)
    headerView.setUint32(14, Math.round(avgDocLength * 100), true) // Fixed point
    headerView.setUint32(18, this.totalLength, true)

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
}

// ============================================================================
// Streaming GIN Index
// ============================================================================

/**
 * Streaming GIN Index for searching without loading full index
 */
export class StreamingGINIndex {
  private storage: R2GINStorage
  private options: { maxMemoryMB: number; cacheDictionary: boolean }

  private cachedDictionary: FSTDictionary | null = null
  private cachedStats: GINIndexStats | null = null
  private cachedDocInfo: Map<string, { numericId: number; length: number }> | null = null
  private numericToStringId: Map<number, string> | null = null

  private memoryUsage: MemoryBudget = { currentMB: 0, peakMB: 0, limit: 50 }

  constructor(
    storage: R2GINStorage,
    options: { maxMemoryMB?: number; cacheDictionary?: boolean } = {}
  ) {
    this.storage = storage
    this.options = {
      maxMemoryMB: options.maxMemoryMB ?? 50,
      cacheDictionary: options.cacheDictionary ?? true,
    }
    this.memoryUsage.limit = this.options.maxMemoryMB
  }

  /**
   * Search for documents matching query
   */
  async search(query: string): Promise<GINSearchResult[]> {
    const terms = this.tokenize(query)
    if (terms.length === 0) return []

    // Load metadata and dictionary if not cached
    await this.ensureLoaded()

    // Look up each term
    const termPostings: Array<{ term: string; entry: FSTEntry; postings: StreamingRoaringPostings }> = []

    for (const term of terms) {
      const entry = this.cachedDictionary!.lookup(term)
      if (!entry) {
        // AND query - if any term is missing, no results
        return []
      }

      // Fetch postings
      const postingsBytes = await this.storage.fetchRange('postings', entry.offset, entry.length)
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
    const stats = this.cachedStats!

    for (const docId of result.getDocIds()) {
      const docStringId = this.numericToStringId!.get(docId)
      if (!docStringId) continue

      const docInfo = this.cachedDocInfo!.get(docStringId)
      if (!docInfo) continue

      let totalScore = 0

      for (const { term, entry, postings } of termPostings) {
        const tf = postings.getTermFrequency(docId)
        if (tf === 0) continue

        const idf = this.calculateIDF(stats.totalDocs, entry.df)
        const termScore = this.calculateBM25(tf, docInfo.length, stats.avgDocLength, idf)
        totalScore += termScore
      }

      scores.set(docId, totalScore)
    }

    // Sort by score and return
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([numericId, score]) => ({
        id: this.numericToStringId!.get(numericId)!,
        score,
      }))
  }

  /**
   * Ensure dictionary and stats are loaded
   */
  private async ensureLoaded(): Promise<void> {
    if (this.cachedDictionary && this.cachedStats && this.cachedDocInfo) {
      return
    }

    // Load metadata
    const metadataBytes = await this.storage.fetchMetadata()
    this.trackMemory(metadataBytes.length)

    this.cachedStats = GINIndexWriter.parseMetadata(metadataBytes)
    this.cachedDocInfo = new Map()
    this.numericToStringId = new Map()

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

      this.cachedDocInfo.set(docId, { numericId, length })
      this.numericToStringId.set(numericId, docId)
    }

    // Load dictionary
    if (this.options.cacheDictionary) {
      // Fetch entire dictionary
      const dictHeader = await this.storage.fetchRange('dictionary', 0, FST_HEADER_SIZE)
      const headerInfo = FSTDictionary.parseHeader(dictHeader)

      // Estimate full dictionary size
      const estimatedSize = FST_HEADER_SIZE + headerInfo.termCount * 25 // avg entry size
      const dictBytes = await this.storage.fetchRange('dictionary', 0, estimatedSize * 2)
      this.trackMemory(dictBytes.length)

      this.cachedDictionary = FSTDictionary.deserialize(dictBytes)
    }
  }

  /**
   * Simple tokenizer
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0)
  }

  /**
   * Calculate BM25 IDF (BM25+ variant)
   */
  private calculateIDF(totalDocs: number, df: number): number {
    return Math.log((totalDocs + 1) / (df + 0.5))
  }

  /**
   * Calculate BM25 score for a term
   */
  private calculateBM25(tf: number, docLength: number, avgDocLength: number, idf: number): number {
    const numerator = tf * (BM25_K1 + 1)
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength))
    return idf * (numerator / denominator)
  }

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
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock R2 storage from index files
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
