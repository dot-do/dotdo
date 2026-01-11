/**
 * Iceberg Puffin Sidecar File Format
 *
 * Puffin is Iceberg's format for storing additional table statistics like
 * bloom filters, theta sketches, and other indexed structures. These sidecars
 * enable efficient query pruning without scanning Parquet files.
 *
 * File format:
 * - Magic "PFA1" (4 bytes)
 * - Blob data (variable length blobs concatenated)
 * - Footer JSON (blob metadata)
 * - Footer length (4 bytes, little-endian)
 * - Magic "PFA1" (4 bytes)
 *
 * Key features:
 * - Range-addressable: Footer can be read independently, then specific blobs
 * - Supports multiple blob types per file (bloom, ngram, set index)
 * - Designed for Cloudflare Snippets (<1ms blob lookup from cache)
 *
 * @see https://iceberg.apache.org/puffin-spec/
 * @module db/iceberg/puffin
 */

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes for Puffin format: "PFA1" */
export const PUFFIN_MAGIC = new Uint8Array([0x50, 0x46, 0x41, 0x31]) // "PFA1"

/** Default false positive rate for bloom filters */
export const DEFAULT_FPR = 0.01

/** Bits per element at 1% FPR: -ln(0.01) / ln(2)^2 ≈ 9.6 */
export const BITS_PER_ELEMENT_1_PERCENT = 10

/** Number of hash functions for 1% FPR: ln(2) * (bits/element) ≈ 7 */
export const HASH_FUNCTIONS_1_PERCENT = 7

// ============================================================================
// Types
// ============================================================================

/**
 * Blob types supported in Puffin files
 */
export type BlobType =
  | 'apache-datasketches-theta-v1' // Theta sketch for distinct counts
  | 'bloom-filter-v1' // Standard bloom filter for equality
  | 'ngram-bloom-filter-v1' // N-gram bloom for substring search
  | 'set-index-v1' // Direct set for low-cardinality

/**
 * Compression codecs supported for blob data
 */
export type CompressionCodec = 'none' | 'zstd' | 'lz4' | 'snappy'

/**
 * Metadata for a single blob in the Puffin file
 */
export interface BlobMetadata {
  /** Type of the blob (e.g., 'bloom-filter-v1') */
  type: BlobType | string
  /** Column field IDs this blob applies to */
  fields: number[]
  /** Snapshot ID when this blob was created */
  snapshotId: number
  /** Sequence number for ordering */
  sequenceNumber: number
  /** Byte offset in file where blob data starts */
  offset: number
  /** Length of blob data in bytes */
  length: number
  /** Compression codec used */
  compressionCodec?: CompressionCodec
  /** Additional properties */
  properties?: Record<string, string>
}

/**
 * Puffin file footer containing blob metadata
 */
export interface PuffinFooter {
  /** List of blob metadata entries */
  blobs: BlobMetadata[]
  /** Puffin format properties */
  properties?: Record<string, string>
}

/**
 * Configuration for bloom filter creation
 */
export interface BloomFilterConfig {
  /** Expected number of elements */
  expectedElements: number
  /** Target false positive rate (default: 0.01 = 1%) */
  falsePositiveRate?: number
}

/**
 * Configuration for N-gram bloom filter
 */
export interface NgramBloomConfig extends BloomFilterConfig {
  /** N-gram size (default: 3 for trigrams) */
  ngramSize?: number
  /** Whether to pad start/end of strings */
  padStrings?: boolean
}

/**
 * A blob ready to be written to a Puffin file
 */
export interface PendingBlob {
  /** Blob type */
  type: BlobType | string
  /** Column field IDs */
  fields: number[]
  /** Blob data */
  data: Uint8Array
  /** Compression codec */
  compressionCodec?: CompressionCodec
  /** Additional properties */
  properties?: Record<string, string>
}

// ============================================================================
// MurmurHash3 Implementation
// ============================================================================

/**
 * MurmurHash3 32-bit implementation
 *
 * A fast, non-cryptographic hash function suitable for bloom filters.
 * This implementation is compatible with the reference implementation
 * used by Apache Iceberg.
 *
 * @param key - Input bytes to hash
 * @param seed - Hash seed for generating multiple hash values
 * @returns 32-bit unsigned hash value
 */
export function murmurHash3_32(key: Uint8Array, seed: number = 0): number {
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  const r1 = 15
  const r2 = 13
  const m = 5
  const n = 0xe6546b64

  let hash = seed >>> 0
  const len = key.length
  const nblocks = Math.floor(len / 4)

  // Process 4-byte blocks
  for (let i = 0; i < nblocks; i++) {
    const offset = i * 4
    let k =
      (key[offset] & 0xff) |
      ((key[offset + 1] & 0xff) << 8) |
      ((key[offset + 2] & 0xff) << 16) |
      ((key[offset + 3] & 0xff) << 24)

    k = Math.imul(k, c1)
    k = (k << r1) | (k >>> (32 - r1))
    k = Math.imul(k, c2)

    hash ^= k
    hash = (hash << r2) | (hash >>> (32 - r2))
    hash = Math.imul(hash, m) + n
  }

  // Process remaining bytes
  const tailOffset = nblocks * 4
  let k1 = 0
  const tail = len & 3

  if (tail >= 3) k1 ^= (key[tailOffset + 2] & 0xff) << 16
  if (tail >= 2) k1 ^= (key[tailOffset + 1] & 0xff) << 8
  if (tail >= 1) {
    k1 ^= key[tailOffset] & 0xff
    k1 = Math.imul(k1, c1)
    k1 = (k1 << r1) | (k1 >>> (32 - r1))
    k1 = Math.imul(k1, c2)
    hash ^= k1
  }

  // Finalization
  hash ^= len
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16

  return hash >>> 0
}

/**
 * Generate two hash values for enhanced double hashing
 *
 * Uses MurmurHash3 with two seeds to generate independent hash values.
 * These are combined to create k hash functions: h(i) = h1 + i*h2
 *
 * @param key - Input bytes
 * @returns Tuple of [hash1, hash2]
 */
export function doubleHash(key: Uint8Array): [number, number] {
  const h1 = murmurHash3_32(key, 0)
  const h2 = murmurHash3_32(key, h1)
  return [h1, h2]
}

// ============================================================================
// Bloom Filter Implementation
// ============================================================================

/**
 * Memory-efficient bloom filter for probabilistic set membership
 *
 * This implementation is optimized for the Puffin file format:
 * - Compact binary serialization (~1KB per 10,000 items at 1% FPR)
 * - Fast hashing with MurmurHash3
 * - Double hashing for multiple hash functions
 *
 * @example
 * ```typescript
 * // Create a bloom filter for 10,000 emails at 1% FPR
 * const bloom = new BloomFilter({ expectedElements: 10000 })
 *
 * // Add items
 * bloom.add('user@example.com.ai')
 * bloom.add('other@example.com.ai')
 *
 * // Check membership
 * bloom.mightContain('user@example.com.ai')  // true
 * bloom.mightContain('unknown@test.com')  // false (probably)
 *
 * // Serialize for Puffin file
 * const bytes = bloom.serialize()
 * ```
 */
export class BloomFilter {
  /** Bit array stored as bytes */
  private readonly bits: Uint8Array
  /** Number of hash functions */
  private readonly numHashFunctions: number
  /** Total number of bits */
  private readonly numBits: number

  /**
   * Create a new bloom filter
   *
   * @param config - Configuration including expected elements and FPR
   */
  constructor(config: BloomFilterConfig) {
    const { expectedElements, falsePositiveRate = DEFAULT_FPR } = config

    // Calculate optimal number of bits and hash functions
    // bits = -n * ln(p) / (ln(2)^2)
    const ln2Squared = Math.LN2 * Math.LN2
    this.numBits = Math.max(
      64, // Minimum 8 bytes
      Math.ceil((-expectedElements * Math.log(falsePositiveRate)) / ln2Squared)
    )

    // Round up to nearest byte
    const numBytes = Math.ceil(this.numBits / 8)
    this.bits = new Uint8Array(numBytes)

    // k = (m/n) * ln(2)
    this.numHashFunctions = Math.max(1, Math.min(16, Math.round((this.numBits / expectedElements) * Math.LN2)))
  }

  /**
   * Create a bloom filter from serialized bytes
   *
   * @param bytes - Serialized bloom filter data
   * @returns Deserialized bloom filter
   */
  static deserialize(bytes: Uint8Array): BloomFilter {
    // Format: [numHashFunctions(1 byte), numBits(4 bytes LE), bits...]
    if (bytes.length < 5) {
      throw new Error('Invalid bloom filter: too short')
    }

    const numHashFunctions = bytes[0]
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const numBits = view.getUint32(1, true)
    const bits = bytes.slice(5)

    // Use internal construction bypassing size calculation
    return BloomFilter._fromRaw(numHashFunctions, numBits, bits)
  }

  /**
   * Internal factory for deserialization
   * @internal
   */
  static _fromRaw(numHashFunctions: number, numBits: number, bits: Uint8Array): BloomFilter {
    const filter = Object.create(BloomFilter.prototype) as BloomFilter
    Object.defineProperty(filter, 'numHashFunctions', { value: numHashFunctions, writable: false })
    Object.defineProperty(filter, 'numBits', { value: numBits, writable: false })
    Object.defineProperty(filter, 'bits', { value: bits, writable: false })
    return filter
  }

  /**
   * Add a string value to the filter
   */
  add(value: string): void {
    this.addBytes(new TextEncoder().encode(value))
  }

  /**
   * Add raw bytes to the filter
   */
  addBytes(value: Uint8Array): void {
    const [h1, h2] = doubleHash(value)

    for (let i = 0; i < this.numHashFunctions; i++) {
      const combinedHash = (h1 + i * h2) >>> 0
      const bitIndex = combinedHash % this.numBits
      const byteIndex = Math.floor(bitIndex / 8)
      const bitOffset = bitIndex % 8
      this.bits[byteIndex] |= 1 << bitOffset
    }
  }

  /**
   * Check if a string value might be in the set
   *
   * @returns true if the value might be present, false if definitely not
   */
  mightContain(value: string): boolean {
    return this.mightContainBytes(new TextEncoder().encode(value))
  }

  /**
   * Check if raw bytes might be in the set
   */
  mightContainBytes(value: Uint8Array): boolean {
    const [h1, h2] = doubleHash(value)

    for (let i = 0; i < this.numHashFunctions; i++) {
      const combinedHash = (h1 + i * h2) >>> 0
      const bitIndex = combinedHash % this.numBits
      const byteIndex = Math.floor(bitIndex / 8)
      const bitOffset = bitIndex % 8

      if ((this.bits[byteIndex] & (1 << bitOffset)) === 0) {
        return false
      }
    }

    return true
  }

  /**
   * Serialize the bloom filter to bytes
   *
   * Format: [numHashFunctions(1), numBits(4 LE), bits...]
   */
  serialize(): Uint8Array {
    const result = new Uint8Array(5 + this.bits.length)
    result[0] = this.numHashFunctions

    const view = new DataView(result.buffer)
    view.setUint32(1, this.numBits, true)

    result.set(this.bits, 5)
    return result
  }

  /**
   * Get the size of the serialized filter in bytes
   */
  get sizeBytes(): number {
    return 5 + this.bits.length
  }

  /**
   * Get the estimated false positive rate
   */
  get estimatedFPR(): number {
    // FPR ≈ (1 - e^(-kn/m))^k
    // This is approximate without knowing actual element count
    return Math.pow(1 - Math.exp(-this.numHashFunctions / (this.numBits / 8)), this.numHashFunctions)
  }
}

// ============================================================================
// N-gram Bloom Filter Implementation
// ============================================================================

/**
 * N-gram bloom filter for substring/LIKE query support
 *
 * Stores n-grams (character sequences) of each value to enable
 * LIKE '%pattern%' query pruning. If a file's n-gram bloom doesn't
 * contain all n-grams of the search pattern, the file can be skipped.
 *
 * @example
 * ```typescript
 * const ngram = new NgramBloomFilter({
 *   expectedElements: 1000,
 *   ngramSize: 3
 * })
 *
 * ngram.add('hello@example.com.ai')
 *
 * // Check if a pattern might match any value
 * ngram.mightContainSubstring('example')  // true
 * ngram.mightContainSubstring('xyz')      // false (probably)
 * ```
 */
export class NgramBloomFilter {
  private readonly bloom: BloomFilter
  private readonly ngramSize: number
  private readonly padStrings: boolean

  /**
   * Create a new n-gram bloom filter
   */
  constructor(config: NgramBloomConfig) {
    const { ngramSize = 3, padStrings = true, ...bloomConfig } = config

    // Estimate n-grams: avg string length * elements
    // Assume average string length of 20 characters
    const avgStringLength = 20
    const estimatedNgrams = (avgStringLength - ngramSize + 1) * bloomConfig.expectedElements

    this.bloom = new BloomFilter({
      expectedElements: Math.max(estimatedNgrams, bloomConfig.expectedElements),
      falsePositiveRate: bloomConfig.falsePositiveRate,
    })

    this.ngramSize = ngramSize
    this.padStrings = padStrings
  }

  /**
   * Create from serialized bytes
   */
  static deserialize(bytes: Uint8Array): NgramBloomFilter {
    // Format: [ngramSize(1), padStrings(1), bloom...]
    if (bytes.length < 2) {
      throw new Error('Invalid ngram bloom filter: too short')
    }

    const ngramSize = bytes[0]
    const padStrings = bytes[1] === 1
    const bloom = BloomFilter.deserialize(bytes.slice(2))

    return NgramBloomFilter._fromRaw(ngramSize, padStrings, bloom)
  }

  /**
   * Internal factory for deserialization
   * @internal
   */
  static _fromRaw(ngramSize: number, padStrings: boolean, bloom: BloomFilter): NgramBloomFilter {
    const filter = Object.create(NgramBloomFilter.prototype) as NgramBloomFilter
    Object.defineProperty(filter, 'ngramSize', { value: ngramSize, writable: false })
    Object.defineProperty(filter, 'padStrings', { value: padStrings, writable: false })
    Object.defineProperty(filter, 'bloom', { value: bloom, writable: false })
    return filter
  }

  /**
   * Generate n-grams from a string
   */
  private generateNgrams(value: string): string[] {
    const ngrams: string[] = []

    // Pad string for prefix/suffix matching
    const padded = this.padStrings ? `\x00\x00${value}\x00\x00` : value

    for (let i = 0; i <= padded.length - this.ngramSize; i++) {
      ngrams.push(padded.substring(i, i + this.ngramSize))
    }

    return ngrams
  }

  /**
   * Add a string value (all its n-grams)
   */
  add(value: string): void {
    const ngrams = this.generateNgrams(value)
    for (const ngram of ngrams) {
      this.bloom.add(ngram)
    }
  }

  /**
   * Check if a substring pattern might match any stored value
   *
   * This checks if ALL n-grams of the pattern are present.
   * If any n-gram is missing, no stored value can contain the pattern.
   *
   * Note: We don't pad the pattern because we're searching for substrings
   * that appear anywhere within stored values, not matching start/end.
   */
  mightContainSubstring(pattern: string): boolean {
    // For patterns shorter than n-gram size, we can't prune
    if (pattern.length < this.ngramSize) {
      return true
    }

    // Generate n-grams WITHOUT padding for substring search
    // Pattern n-grams should match middle n-grams of stored values
    for (let i = 0; i <= pattern.length - this.ngramSize; i++) {
      const ngram = pattern.substring(i, i + this.ngramSize)
      if (!this.bloom.mightContain(ngram)) {
        return false
      }
    }

    return true
  }

  /**
   * Serialize to bytes
   */
  serialize(): Uint8Array {
    const bloomBytes = this.bloom.serialize()
    const result = new Uint8Array(2 + bloomBytes.length)
    result[0] = this.ngramSize
    result[1] = this.padStrings ? 1 : 0
    result.set(bloomBytes, 2)
    return result
  }

  /**
   * Get serialized size in bytes
   */
  get sizeBytes(): number {
    return 2 + this.bloom.sizeBytes
  }
}

// ============================================================================
// Set Index Implementation
// ============================================================================

/**
 * Direct set index for low-cardinality columns
 *
 * For columns with few distinct values (like status, type, visibility),
 * we store the actual values rather than a probabilistic structure.
 * This enables exact pruning with no false positives.
 *
 * @example
 * ```typescript
 * const setIndex = new SetIndex()
 *
 * setIndex.add('active')
 * setIndex.add('pending')
 * setIndex.add('active') // Deduplicated
 *
 * setIndex.contains('active')   // true
 * setIndex.contains('deleted')  // false (exactly)
 * ```
 */
export class SetIndex {
  private readonly values: Set<string> = new Set()

  /**
   * Create from serialized bytes
   */
  static deserialize(bytes: Uint8Array): SetIndex {
    const decoder = new TextDecoder()
    const json = decoder.decode(bytes)
    const values = JSON.parse(json) as string[]

    const index = new SetIndex()
    for (const value of values) {
      index.values.add(value)
    }

    return index
  }

  /**
   * Add a value to the set
   */
  add(value: string): void {
    this.values.add(value)
  }

  /**
   * Check if the set contains a value (exact match)
   */
  contains(value: string): boolean {
    return this.values.has(value)
  }

  /**
   * Check if any values match a pattern
   */
  containsAny(values: string[]): boolean {
    for (const value of values) {
      if (this.values.has(value)) {
        return true
      }
    }
    return false
  }

  /**
   * Get all values in the set
   */
  getValues(): string[] {
    return Array.from(this.values)
  }

  /**
   * Get the number of distinct values
   */
  get size(): number {
    return this.values.size
  }

  /**
   * Serialize to bytes (JSON array)
   */
  serialize(): Uint8Array {
    const json = JSON.stringify(Array.from(this.values))
    return new TextEncoder().encode(json)
  }

  /**
   * Get serialized size in bytes
   */
  get sizeBytes(): number {
    return this.serialize().length
  }
}

// ============================================================================
// Puffin Writer
// ============================================================================

/**
 * Writer for creating Puffin sidecar files
 *
 * Assembles blobs (bloom filters, set indices, etc.) and writes them
 * in the Puffin format with proper header, footer, and metadata.
 *
 * @example
 * ```typescript
 * const writer = new PuffinWriter({
 *   snapshotId: 123456789,
 *   sequenceNumber: 1
 * })
 *
 * // Add a bloom filter for email column
 * const emailBloom = new BloomFilter({ expectedElements: 10000 })
 * emailBloom.add('user@example.com.ai')
 * writer.addBloomFilter(5, emailBloom)
 *
 * // Add a set index for status column
 * const statusIndex = new SetIndex()
 * statusIndex.add('active')
 * statusIndex.add('pending')
 * writer.addSetIndex(6, statusIndex)
 *
 * // Generate the Puffin file
 * const puffinBytes = writer.finish()
 * ```
 */
export class PuffinWriter {
  private readonly snapshotId: number
  private readonly sequenceNumber: number
  private readonly blobs: PendingBlob[] = []
  private readonly properties: Record<string, string>

  constructor(options: { snapshotId: number; sequenceNumber: number; properties?: Record<string, string> }) {
    this.snapshotId = options.snapshotId
    this.sequenceNumber = options.sequenceNumber
    this.properties = options.properties ?? {}
  }

  /**
   * Add a bloom filter blob for a column
   */
  addBloomFilter(fieldId: number, filter: BloomFilter, properties?: Record<string, string>): void {
    this.blobs.push({
      type: 'bloom-filter-v1',
      fields: [fieldId],
      data: filter.serialize(),
      properties,
    })
  }

  /**
   * Add an n-gram bloom filter blob for substring queries
   */
  addNgramBloomFilter(fieldId: number, filter: NgramBloomFilter, properties?: Record<string, string>): void {
    this.blobs.push({
      type: 'ngram-bloom-filter-v1',
      fields: [fieldId],
      data: filter.serialize(),
      properties,
    })
  }

  /**
   * Add a set index blob for low-cardinality columns
   */
  addSetIndex(fieldId: number, index: SetIndex, properties?: Record<string, string>): void {
    this.blobs.push({
      type: 'set-index-v1',
      fields: [fieldId],
      data: index.serialize(),
      properties,
    })
  }

  /**
   * Add a raw blob with custom type
   */
  addBlob(blob: PendingBlob): void {
    this.blobs.push(blob)
  }

  /**
   * Finish writing and generate the Puffin file bytes
   *
   * File layout:
   * [Magic 4B][Blob1][Blob2]...[Footer JSON][Footer Length 4B][Magic 4B]
   */
  finish(): Uint8Array {
    // Calculate total blob data size
    let blobDataSize = 0
    for (const blob of this.blobs) {
      blobDataSize += blob.data.length
    }

    // Build footer with blob metadata
    const blobMetadata: BlobMetadata[] = []
    let currentOffset = PUFFIN_MAGIC.length // Start after header magic

    for (const blob of this.blobs) {
      blobMetadata.push({
        type: blob.type,
        fields: blob.fields,
        snapshotId: this.snapshotId,
        sequenceNumber: this.sequenceNumber,
        offset: currentOffset,
        length: blob.data.length,
        compressionCodec: blob.compressionCodec,
        properties: blob.properties,
      })
      currentOffset += blob.data.length
    }

    const footer: PuffinFooter = {
      blobs: blobMetadata,
      properties: this.properties,
    }

    const footerJson = JSON.stringify(footer)
    const footerBytes = new TextEncoder().encode(footerJson)

    // Calculate total file size
    const totalSize =
      PUFFIN_MAGIC.length + // Header magic
      blobDataSize + // All blob data
      footerBytes.length + // Footer JSON
      4 + // Footer length
      PUFFIN_MAGIC.length // Trailer magic

    // Allocate result buffer
    const result = new Uint8Array(totalSize)
    let writeOffset = 0

    // Write header magic
    result.set(PUFFIN_MAGIC, writeOffset)
    writeOffset += PUFFIN_MAGIC.length

    // Write blob data
    for (const blob of this.blobs) {
      result.set(blob.data, writeOffset)
      writeOffset += blob.data.length
    }

    // Write footer JSON
    result.set(footerBytes, writeOffset)
    writeOffset += footerBytes.length

    // Write footer length (little-endian)
    const view = new DataView(result.buffer)
    view.setUint32(writeOffset, footerBytes.length, true)
    writeOffset += 4

    // Write trailer magic
    result.set(PUFFIN_MAGIC, writeOffset)

    return result
  }
}

// ============================================================================
// Puffin Reader
// ============================================================================

/**
 * Range request for fetching specific bytes from storage
 */
export interface RangeRequest {
  /** Start byte offset (inclusive) */
  start: number
  /** End byte offset (exclusive) */
  end: number
}

/**
 * Reader for parsing Puffin sidecar files
 *
 * Designed for range-addressable access from R2 or cache:
 * 1. Fetch footer (last 8+ bytes) to get metadata
 * 2. Parse footer to find blob offsets
 * 3. Fetch specific blobs by type/column as needed
 *
 * @example
 * ```typescript
 * // Step 1: Get footer info for range request
 * const footerRange = PuffinReader.getFooterRange(fileSize)
 *
 * // Step 2: Fetch footer bytes and parse
 * const footerBytes = await fetch(url, {
 *   headers: { Range: `bytes=${footerRange.start}-${footerRange.end}` }
 * }).then(r => r.arrayBuffer())
 *
 * const reader = PuffinReader.fromFooterBytes(new Uint8Array(footerBytes), fileSize)
 *
 * // Step 3: Get range for specific blob
 * const bloomMeta = reader.findBlob('bloom-filter-v1', 5) // field ID 5
 * const blobRange = reader.getBlobRange(bloomMeta)
 *
 * // Step 4: Fetch and parse blob
 * const blobBytes = await fetch(url, {
 *   headers: { Range: `bytes=${blobRange.start}-${blobRange.end}` }
 * }).then(r => r.arrayBuffer())
 *
 * const bloom = reader.parseBlob(bloomMeta, new Uint8Array(blobBytes))
 * ```
 */
export class PuffinReader {
  private readonly footer: PuffinFooter
  private readonly fileSize: number

  private constructor(footer: PuffinFooter, fileSize: number) {
    this.footer = footer
    this.fileSize = fileSize
  }

  /**
   * Calculate the range needed to fetch the footer
   *
   * The footer is at the end of the file:
   * [...][Footer JSON][Footer Length 4B][Magic 4B]
   *
   * We fetch enough bytes to get the length, then the full footer.
   * For initial request, fetch last 8 bytes to get footer length.
   *
   * @param fileSize - Total file size in bytes
   * @param estimatedFooterSize - Estimated footer size (default: 4KB)
   */
  static getFooterRange(fileSize: number, estimatedFooterSize: number = 4096): RangeRequest {
    // Minimum is 8 bytes (footer length + magic)
    // We estimate a reasonable footer size to minimize round trips
    const fetchSize = Math.min(estimatedFooterSize, fileSize)
    return {
      start: fileSize - fetchSize,
      end: fileSize,
    }
  }

  /**
   * Parse the footer length from the last 8 bytes
   *
   * @param tailBytes - Last 8+ bytes of the file
   * @returns Footer JSON length in bytes
   */
  static parseFooterLength(tailBytes: Uint8Array): number {
    if (tailBytes.length < 8) {
      throw new Error('Need at least 8 bytes to parse footer length')
    }

    // Validate trailer magic
    const trailerOffset = tailBytes.length - PUFFIN_MAGIC.length
    const trailer = tailBytes.slice(trailerOffset)

    if (!arraysEqual(trailer, PUFFIN_MAGIC)) {
      throw new Error('Invalid Puffin file: trailer magic mismatch')
    }

    // Read footer length (4 bytes before trailer, little-endian)
    const lengthOffset = trailerOffset - 4
    const view = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength)
    return view.getUint32(lengthOffset, true)
  }

  /**
   * Create a reader from footer bytes
   *
   * @param bytes - Bytes from the footer range request
   * @param fileSize - Total file size
   */
  static fromFooterBytes(bytes: Uint8Array, fileSize: number): PuffinReader {
    const footerLength = PuffinReader.parseFooterLength(bytes)

    // Extract footer JSON
    const trailerSize = 4 + PUFFIN_MAGIC.length // length + magic
    const footerStart = bytes.length - trailerSize - footerLength

    if (footerStart < 0) {
      throw new Error('Footer extends beyond fetched bytes - need larger range')
    }

    const footerBytes = bytes.slice(footerStart, footerStart + footerLength)
    const footerJson = new TextDecoder().decode(footerBytes)
    const footer = JSON.parse(footerJson) as PuffinFooter

    return new PuffinReader(footer, fileSize)
  }

  /**
   * Parse a complete Puffin file
   *
   * Use this when you have the entire file in memory.
   */
  static fromBytes(bytes: Uint8Array): PuffinReader {
    // Validate header magic
    const header = bytes.slice(0, PUFFIN_MAGIC.length)
    if (!arraysEqual(header, PUFFIN_MAGIC)) {
      throw new Error('Invalid Puffin file: header magic mismatch')
    }

    return PuffinReader.fromFooterBytes(bytes, bytes.length)
  }

  /**
   * Get all blob metadata
   */
  getBlobs(): readonly BlobMetadata[] {
    return this.footer.blobs
  }

  /**
   * Get file properties
   */
  getProperties(): Record<string, string> {
    return this.footer.properties ?? {}
  }

  /**
   * Find a blob by type and optional field ID
   */
  findBlob(type: BlobType | string, fieldId?: number): BlobMetadata | null {
    for (const blob of this.footer.blobs) {
      if (blob.type !== type) continue
      if (fieldId !== undefined && !blob.fields.includes(fieldId)) continue
      return blob
    }
    return null
  }

  /**
   * Find all blobs for a specific field
   */
  findBlobsForField(fieldId: number): BlobMetadata[] {
    return this.footer.blobs.filter((blob) => blob.fields.includes(fieldId))
  }

  /**
   * Find all blobs of a specific type
   */
  findBlobsByType(type: BlobType | string): BlobMetadata[] {
    return this.footer.blobs.filter((blob) => blob.type === type)
  }

  /**
   * Get the range request for a specific blob
   */
  getBlobRange(blob: BlobMetadata): RangeRequest {
    return {
      start: blob.offset,
      end: blob.offset + blob.length,
    }
  }

  /**
   * Parse blob data into the appropriate structure
   *
   * @param metadata - Blob metadata
   * @param data - Raw blob bytes
   * @returns Parsed bloom filter, set index, or raw bytes
   */
  parseBlob(metadata: BlobMetadata, data: Uint8Array): BloomFilter | NgramBloomFilter | SetIndex | Uint8Array {
    switch (metadata.type) {
      case 'bloom-filter-v1':
        return BloomFilter.deserialize(data)
      case 'ngram-bloom-filter-v1':
        return NgramBloomFilter.deserialize(data)
      case 'set-index-v1':
        return SetIndex.deserialize(data)
      default:
        return data
    }
  }

  /**
   * Extract a blob from the full file bytes
   *
   * Use when you have the complete file in memory.
   */
  extractBlob(metadata: BlobMetadata, fileBytes: Uint8Array): BloomFilter | NgramBloomFilter | SetIndex | Uint8Array {
    const blobData = fileBytes.slice(metadata.offset, metadata.offset + metadata.length)
    return this.parseBlob(metadata, blobData)
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compare two Uint8Arrays for equality
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Create a bloom filter for a list of string values
 *
 * Convenience function for common use case.
 */
export function createBloomFilterFromValues(values: string[], fpr: number = DEFAULT_FPR): BloomFilter {
  const filter = new BloomFilter({
    expectedElements: Math.max(values.length, 100),
    falsePositiveRate: fpr,
  })

  for (const value of values) {
    filter.add(value)
  }

  return filter
}

/**
 * Create an n-gram bloom filter from a list of string values
 */
export function createNgramBloomFromValues(values: string[], ngramSize: number = 3, fpr: number = DEFAULT_FPR): NgramBloomFilter {
  const filter = new NgramBloomFilter({
    expectedElements: Math.max(values.length, 100),
    falsePositiveRate: fpr,
    ngramSize,
  })

  for (const value of values) {
    filter.add(value)
  }

  return filter
}

/**
 * Create a set index from a list of values
 */
export function createSetIndexFromValues(values: string[]): SetIndex {
  const index = new SetIndex()
  for (const value of values) {
    index.add(value)
  }
  return index
}

/**
 * Estimate bloom filter size for given parameters
 *
 * @param elements - Expected number of elements
 * @param fpr - False positive rate (default: 1%)
 * @returns Estimated size in bytes
 */
export function estimateBloomFilterSize(elements: number, fpr: number = DEFAULT_FPR): number {
  const ln2Squared = Math.LN2 * Math.LN2
  const numBits = Math.ceil((-elements * Math.log(fpr)) / ln2Squared)
  const numBytes = Math.ceil(numBits / 8)
  return 5 + numBytes // 5 byte header + bits
}
