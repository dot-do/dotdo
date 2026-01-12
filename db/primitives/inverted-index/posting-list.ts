/**
 * Posting List with Roaring Bitmap Support
 *
 * Provides efficient storage and operations for document ID sets
 * in inverted indexes. Uses Roaring bitmap concepts for memory-efficient
 * representation with automatic container switching.
 *
 * @module db/primitives/inverted-index/posting-list
 */

// ============================================================================
// Varint Encoding
// ============================================================================

/**
 * Encode a non-negative integer as a variable-length byte sequence
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
 * Decode a varint from a byte array at a given offset
 * @returns [value, bytesRead]
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

    if (bytesRead >= 5) {
      throw new Error('Varint exceeds maximum size')
    }
  }

  throw new Error('Unexpected end of varint')
}

/**
 * Calculate the number of bytes needed to encode a varint
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
// Container Types for Roaring Bitmap
// ============================================================================

/** Threshold for switching from array to bitmap container */
const ARRAY_TO_BITMAP_THRESHOLD = 4096

/**
 * Array container for sparse sets (< 4096 elements per 64K range)
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
    for (const value of (other as ArrayContainer).values) {
      result.values.add(value)
    }

    if (result.cardinality >= ARRAY_TO_BITMAP_THRESHOLD) {
      return result.toBitmap()
    }
    return result
  }

  andNot(other: ArrayContainer | BitmapContainer): ArrayContainer {
    const result = new ArrayContainer()
    for (const value of this.values) {
      if (!other.contains(value)) {
        result.add(value)
      }
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
 * Bitmap container for dense sets (>= 4096 elements per 64K range)
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

  andNot(other: ArrayContainer | BitmapContainer): BitmapContainer {
    const result = this.clone()

    if (other instanceof ArrayContainer) {
      for (const value of other.toArray()) {
        const wordIndex = value >>> 5
        const bitIndex = value & 31
        const mask = 1 << bitIndex
        if ((result.bitmap[wordIndex] & mask) !== 0) {
          result.bitmap[wordIndex] &= ~mask
          result.count--
        }
      }
    } else {
      for (let i = 0; i < 2048; i++) {
        result.bitmap[i] &= ~other.bitmap[i]
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
      const bitmapData = bytes.slice(1, 1 + 8192)
      container.bitmap = new Uint32Array(bitmapData.buffer.slice(bitmapData.byteOffset, bitmapData.byteOffset + 8192))
      container.count = container.toArray().length
    }

    return container
  }
}

// ============================================================================
// PostingList - Main Class
// ============================================================================

/** Magic bytes for PostingList serialization */
const POSTING_LIST_MAGIC = new Uint8Array([0x50, 0x4c, 0x53, 0x54]) // "PLST"

/**
 * Posting list using Roaring bitmap concepts
 *
 * Stores document IDs efficiently with automatic container switching
 * based on density within each 64K range.
 */
export class PostingList {
  /** Map from high 16 bits to container */
  private containers: Map<number, ArrayContainer | BitmapContainer> = new Map()

  /**
   * Add a document ID to the posting list
   */
  add(docId: number): void {
    const high = docId >>> 16
    const low = docId & 0xffff

    let container = this.containers.get(high)
    if (!container) {
      container = new ArrayContainer()
      this.containers.set(high, container)
    }

    container.add(low)

    // Convert to bitmap if array gets too large
    if (container instanceof ArrayContainer && container.cardinality >= ARRAY_TO_BITMAP_THRESHOLD) {
      this.containers.set(high, container.toBitmap())
    }
  }

  /**
   * Check if a document ID exists in the posting list
   */
  contains(docId: number): boolean {
    const high = docId >>> 16
    const low = docId & 0xffff

    const container = this.containers.get(high)
    return container ? container.contains(low) : false
  }

  /**
   * Get the number of document IDs in the posting list
   */
  get cardinality(): number {
    let count = 0
    for (const container of this.containers.values()) {
      count += container.cardinality
    }
    return count
  }

  /**
   * Get all document IDs as a sorted array
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
   * Get the container type for a given 64K range (for testing)
   */
  getContainerType(high: number): 'array' | 'bitmap' | null {
    const container = this.containers.get(high)
    if (!container) return null
    return container instanceof ArrayContainer ? 'array' : 'bitmap'
  }

  /**
   * Intersect with another posting list (AND)
   */
  and(other: PostingList): PostingList {
    const result = new PostingList()

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
   * Union with another posting list (OR)
   */
  or(other: PostingList): PostingList {
    const result = new PostingList()

    // Copy this posting list
    for (const [high, container] of this.containers) {
      result.containers.set(high, container.clone())
    }

    // Merge other posting list
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
   * Difference with another posting list (AND NOT)
   */
  andNot(other: PostingList): PostingList {
    const result = new PostingList()

    for (const [high, container] of this.containers) {
      const otherContainer = other.containers.get(high)
      if (otherContainer) {
        const difference =
          container instanceof ArrayContainer
            ? container.andNot(otherContainer)
            : container.andNot(otherContainer)
        if (difference.cardinality > 0) {
          result.containers.set(high, difference)
        }
      } else {
        result.containers.set(high, container.clone())
      }
    }

    return result
  }

  /**
   * Serialize the posting list to bytes
   */
  serialize(): Uint8Array {
    const containerCount = this.containers.size
    const parts: Uint8Array[] = []

    // Magic + version + container count
    const header = new Uint8Array(8)
    header.set(POSTING_LIST_MAGIC, 0)
    new DataView(header.buffer).setUint32(4, containerCount, true)
    parts.push(header)

    // Container entries: high (2 bytes) + type (1 byte) + data
    const sortedKeys = Array.from(this.containers.keys()).sort((a, b) => a - b)

    for (const high of sortedKeys) {
      const container = this.containers.get(high)!
      const isArray = container instanceof ArrayContainer

      const data = container.serialize()

      // Key entry: high (2) + type (1) + length (4)
      const entry = new Uint8Array(7)
      const entryView = new DataView(entry.buffer)
      entryView.setUint16(0, high, true)
      entry[2] = isArray ? 0 : 1
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
   * Deserialize a posting list from bytes
   */
  static deserialize(bytes: Uint8Array): PostingList {
    const list = new PostingList()

    if (bytes.length === 0) {
      return list
    }

    // Validate magic
    for (let i = 0; i < POSTING_LIST_MAGIC.length; i++) {
      if (bytes[i] !== POSTING_LIST_MAGIC[i]) {
        throw new Error('Invalid posting list: corrupted data')
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const containerCount = view.getUint32(4, true)
    let offset = 8

    for (let i = 0; i < containerCount; i++) {
      const high = view.getUint16(offset, true)
      const type = bytes[offset + 2]
      const dataLength = view.getUint32(offset + 3, true)
      offset += 7

      const data = bytes.slice(offset, offset + dataLength)
      offset += dataLength

      if (type === 0) {
        list.containers.set(high, ArrayContainer.deserialize(data))
      } else {
        list.containers.set(high, BitmapContainer.deserialize(data))
      }
    }

    return list
  }
}

// ============================================================================
// PostingListWithTF - Posting List with Term Frequencies
// ============================================================================

/** Magic bytes for PostingListWithTF serialization */
const POSTING_LIST_TF_MAGIC = new Uint8Array([0x50, 0x4c, 0x54, 0x46]) // "PLTF"

/**
 * Posting entry with term frequency
 */
export interface Posting {
  docId: number
  tf: number
}

/**
 * Posting list with term frequency information
 *
 * Stores document IDs along with their term frequencies,
 * using delta encoding for efficient serialization.
 */
export class PostingListWithTF {
  /** Map from document ID to term frequency */
  private postings: Map<number, number> = new Map()

  /**
   * Add a document with term frequency
   */
  add(docId: number, tf: number): void {
    this.postings.set(docId, tf)
  }

  /**
   * Check if a document exists
   */
  contains(docId: number): boolean {
    return this.postings.has(docId)
  }

  /**
   * Get term frequency for a document
   */
  getTf(docId: number): number {
    return this.postings.get(docId) || 0
  }

  /**
   * Get number of documents
   */
  get cardinality(): number {
    return this.postings.size
  }

  /**
   * Get all postings sorted by docId
   */
  getPostings(): Posting[] {
    return Array.from(this.postings.entries())
      .map(([docId, tf]) => ({ docId, tf }))
      .sort((a, b) => a.docId - b.docId)
  }

  /**
   * Get all document IDs as sorted array
   */
  toArray(): number[] {
    return Array.from(this.postings.keys()).sort((a, b) => a - b)
  }

  /**
   * Serialize with delta encoding
   */
  serialize(): Uint8Array {
    const postings = this.getPostings()

    if (postings.length === 0) {
      // Just magic + count
      const result = new Uint8Array(5)
      result.set(POSTING_LIST_TF_MAGIC, 0)
      result[4] = 0
      return result
    }

    // Calculate size
    let size = 4 + varintSize(postings.length) // magic + count
    let prevDocId = 0
    for (const posting of postings) {
      size += varintSize(posting.docId - prevDocId)
      size += varintSize(posting.tf)
      prevDocId = posting.docId
    }

    // Encode
    const result = new Uint8Array(size)
    result.set(POSTING_LIST_TF_MAGIC, 0)
    let offset = 4

    // Write count
    const countBytes = encodeVarint(postings.length)
    result.set(countBytes, offset)
    offset += countBytes.length

    // Write postings with delta encoding
    prevDocId = 0
    for (const posting of postings) {
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
   * Deserialize from bytes
   */
  static deserialize(bytes: Uint8Array): PostingListWithTF {
    const list = new PostingListWithTF()

    if (bytes.length === 0) {
      return list
    }

    // Check magic
    for (let i = 0; i < POSTING_LIST_TF_MAGIC.length; i++) {
      if (bytes[i] !== POSTING_LIST_TF_MAGIC[i]) {
        throw new Error('Invalid posting list with TF: corrupted data')
      }
    }

    let offset = 4

    const [count, countBytes] = decodeVarint(bytes, offset)
    offset += countBytes

    if (count === 0) {
      return list
    }

    let prevDocId = 0
    for (let i = 0; i < count; i++) {
      const [delta, deltaBytes] = decodeVarint(bytes, offset)
      offset += deltaBytes

      const [tf, tfBytes] = decodeVarint(bytes, offset)
      offset += tfBytes

      const docId = prevDocId + delta
      list.add(docId, tf)
      prevDocId = docId
    }

    return list
  }
}
