/**
 * Dictionary Codec - Efficient string column encoding for analytics
 *
 * Dictionary encoding maps strings to integers, providing:
 * - 10x+ compression for low-cardinality strings (country codes, statuses, etc.)
 * - Faster GROUP BY using integer comparison
 * - Filter pushdown via dictionary lookup
 * - Variable-width indices based on cardinality
 *
 * Storage format:
 * - Dictionary: unique strings array (order determines index)
 * - Encoded: TypedArray of indices (Uint8/Uint16/Uint32 based on cardinality)
 *
 * @example
 * ```typescript
 * const codec = createDictionaryCodec()
 *
 * // Encode strings
 * const result = codec.encode(['US', 'UK', 'US', 'DE', 'US'])
 * // result.dictionary = ['US', 'UK', 'DE']
 * // result.encoded = Uint8Array [0, 1, 0, 2, 0]
 * // result.cardinality = 3
 *
 * // Decode back to strings
 * const decoded = codec.decode(result.dictionary, result.encoded)
 * // decoded = ['US', 'UK', 'US', 'DE', 'US']
 *
 * // Fast lookup for filtering
 * const idx = codec.lookup(result.dictionary, 'US') // 0
 *
 * // Merge dictionaries for append
 * const merged = codec.merge(['US', 'UK'], ['UK', 'DE', 'FR'])
 * // merged.merged = ['US', 'UK', 'DE', 'FR']
 * // merged.remapping = Map { 0 => 1, 1 => 2, 2 => 3 }
 * ```
 *
 * @module db/primitives/dictionary-codec
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Typed array for encoded indices (variable width based on cardinality)
 */
export type EncodedIndices = Uint8Array | Uint16Array | Uint32Array

/**
 * Result of dictionary encoding
 */
export interface DictionaryEncodeResult {
  /** Unique values in insertion order */
  dictionary: string[]
  /** Encoded indices into dictionary */
  encoded: EncodedIndices
  /** Number of unique values */
  cardinality: number
}

/**
 * Result of merging two dictionaries
 */
export interface DictionaryMergeResult {
  /** Combined dictionary with all unique values */
  merged: string[]
  /** Remapping of dict2 indices to merged indices */
  remapping: Map<number, number>
}

/**
 * Dictionary encoded column (for storage/transfer)
 */
export interface DictionaryEncodedColumn {
  dictionary: string[]
  encoded: EncodedIndices
  cardinality: number
}

/**
 * Dictionary codec interface
 */
export interface DictionaryCodec {
  /**
   * Encode string array to dictionary + indices
   */
  encode(values: string[]): DictionaryEncodeResult

  /**
   * Decode indices back to string array
   */
  decode(dictionary: string[], encoded: EncodedIndices): string[]

  /**
   * Lookup a value's index in dictionary (for filter pushdown)
   * Returns null if value not found
   */
  lookup(dictionary: string[], value: string): number | null

  /**
   * Merge two dictionaries, returning combined dictionary and remapping
   */
  merge(dict1: string[], dict2: string[]): DictionaryMergeResult

  /**
   * Serialize encoded column to bytes
   */
  serialize(encoded: DictionaryEncodeResult): Uint8Array

  /**
   * Deserialize bytes back to encoded column
   */
  deserialize(data: Uint8Array): DictionaryEncodeResult
}

// ============================================================================
// Implementation
// ============================================================================

class DictionaryCodecImpl implements DictionaryCodec {
  /**
   * Encode string array to dictionary + indices
   *
   * Uses insertion-order dictionary and variable-width indices
   */
  encode(values: string[]): DictionaryEncodeResult {
    if (values.length === 0) {
      return {
        dictionary: [],
        encoded: new Uint8Array(0),
        cardinality: 0,
      }
    }

    // Build dictionary with insertion order
    const valueToIndex = new Map<string, number>()
    const dictionary: string[] = []

    for (const value of values) {
      if (!valueToIndex.has(value)) {
        valueToIndex.set(value, dictionary.length)
        dictionary.push(value)
      }
    }

    const cardinality = dictionary.length

    // Create appropriately-sized typed array for indices
    const encoded = this.createEncodedArray(values.length, cardinality)

    // Encode values as indices
    for (let i = 0; i < values.length; i++) {
      encoded[i] = valueToIndex.get(values[i]!)!
    }

    return { dictionary, encoded, cardinality }
  }

  /**
   * Decode indices back to string array
   */
  decode(dictionary: string[], encoded: EncodedIndices): string[] {
    if (dictionary.length === 0 || encoded.length === 0) {
      return []
    }

    const result: string[] = new Array(encoded.length)

    for (let i = 0; i < encoded.length; i++) {
      const index = encoded[i]!
      if (index >= dictionary.length) {
        throw new Error(
          `Dictionary decode error: Index ${index} out of bounds (dictionary size: ${dictionary.length})`
        )
      }
      result[i] = dictionary[index]!
    }

    return result
  }

  /**
   * Lookup a value's index in dictionary
   *
   * Uses binary search for larger dictionaries (if sorted)
   * or linear scan for smaller ones
   */
  lookup(dictionary: string[], value: string): number | null {
    if (dictionary.length === 0) {
      return null
    }

    // For small dictionaries, linear search is fine
    // For large ones, we could build a Map cache, but dictionaries
    // are typically small enough that linear is acceptable
    const index = dictionary.indexOf(value)
    return index === -1 ? null : index
  }

  /**
   * Merge two dictionaries
   *
   * Preserves dict1 indices, appends new values from dict2
   * Returns remapping for dict2 indices to merged indices
   */
  merge(dict1: string[], dict2: string[]): DictionaryMergeResult {
    if (dict1.length === 0) {
      // Just return dict2 with identity remapping
      const remapping = new Map<number, number>()
      for (let i = 0; i < dict2.length; i++) {
        remapping.set(i, i)
      }
      return { merged: [...dict2], remapping }
    }

    if (dict2.length === 0) {
      return { merged: [...dict1], remapping: new Map() }
    }

    // Build index for dict1 values
    const dict1Index = new Map<string, number>()
    for (let i = 0; i < dict1.length; i++) {
      dict1Index.set(dict1[i]!, i)
    }

    // Start with copy of dict1
    const merged = [...dict1]
    const remapping = new Map<number, number>()

    // Add dict2 values, tracking remapping
    for (let i = 0; i < dict2.length; i++) {
      const value = dict2[i]!
      if (dict1Index.has(value)) {
        // Value exists in dict1, remap to dict1's index
        remapping.set(i, dict1Index.get(value)!)
      } else {
        // New value, append to merged
        const newIndex = merged.length
        merged.push(value)
        remapping.set(i, newIndex)
      }
    }

    return { merged, remapping }
  }

  /**
   * Serialize encoded column to bytes
   *
   * Format:
   * - Header (16 bytes):
   *   - Magic (4 bytes): 'DICT'
   *   - Version (1 byte): 1
   *   - Index width (1 byte): 1, 2, or 4
   *   - Reserved (2 bytes)
   *   - Cardinality (4 bytes): number of dictionary entries
   *   - Value count (4 bytes): number of encoded values
   * - Dictionary:
   *   - For each entry: [length (4 bytes)][UTF-8 bytes]
   * - Encoded indices (raw bytes of typed array)
   */
  serialize(encoded: DictionaryEncodeResult): Uint8Array {
    const { dictionary, encoded: indices, cardinality } = encoded

    // Calculate sizes
    let dictSize = 0
    for (const value of dictionary) {
      dictSize += 4 + new TextEncoder().encode(value).length
    }
    const indicesSize = indices.byteLength
    const headerSize = 16
    const totalSize = headerSize + dictSize + indicesSize

    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    let offset = 0

    // Write header
    bytes[offset++] = 0x44 // 'D'
    bytes[offset++] = 0x49 // 'I'
    bytes[offset++] = 0x43 // 'C'
    bytes[offset++] = 0x54 // 'T'
    bytes[offset++] = 1 // Version
    bytes[offset++] = indices.BYTES_PER_ELEMENT // Index width
    bytes[offset++] = 0 // Reserved
    bytes[offset++] = 0 // Reserved
    view.setUint32(offset, cardinality, true)
    offset += 4
    view.setUint32(offset, indices.length, true)
    offset += 4

    // Write dictionary
    const encoder = new TextEncoder()
    for (const value of dictionary) {
      const utf8 = encoder.encode(value)
      view.setUint32(offset, utf8.length, true)
      offset += 4
      bytes.set(utf8, offset)
      offset += utf8.length
    }

    // Write indices
    bytes.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), offset)

    return bytes
  }

  /**
   * Deserialize bytes back to encoded column
   */
  deserialize(data: Uint8Array): DictionaryEncodeResult {
    if (data.length < 16) {
      throw new Error('Dictionary deserialize error: Buffer too small for header')
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0

    // Read and validate magic
    if (data[0] !== 0x44 || data[1] !== 0x49 || data[2] !== 0x43 || data[3] !== 0x54) {
      throw new Error('Dictionary deserialize error: Invalid magic bytes')
    }
    offset += 4

    const version = data[offset++]
    if (version !== 1) {
      throw new Error(`Dictionary deserialize error: Unsupported version ${version}`)
    }

    const indexWidth = data[offset++]
    offset += 2 // Skip reserved

    const cardinality = view.getUint32(offset, true)
    offset += 4

    const valueCount = view.getUint32(offset, true)
    offset += 4

    // Read dictionary
    const decoder = new TextDecoder()
    const dictionary: string[] = []
    for (let i = 0; i < cardinality; i++) {
      const length = view.getUint32(offset, true)
      offset += 4
      const utf8 = data.slice(offset, offset + length)
      dictionary.push(decoder.decode(utf8))
      offset += length
    }

    // Read indices
    const indicesBytes = data.slice(offset)
    let encoded: EncodedIndices

    switch (indexWidth) {
      case 1:
        encoded = new Uint8Array(indicesBytes.buffer, indicesBytes.byteOffset, valueCount)
        break
      case 2:
        encoded = new Uint16Array(
          indicesBytes.buffer,
          indicesBytes.byteOffset,
          valueCount
        )
        break
      case 4:
        encoded = new Uint32Array(
          indicesBytes.buffer,
          indicesBytes.byteOffset,
          valueCount
        )
        break
      default:
        throw new Error(`Dictionary deserialize error: Invalid index width ${indexWidth}`)
    }

    return { dictionary, encoded, cardinality }
  }

  /**
   * Create appropriately-sized typed array based on cardinality
   */
  private createEncodedArray(length: number, cardinality: number): EncodedIndices {
    if (cardinality <= 256) {
      return new Uint8Array(length)
    } else if (cardinality <= 65536) {
      return new Uint16Array(length)
    } else {
      return new Uint32Array(length)
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new DictionaryCodec instance
 */
export function createDictionaryCodec(): DictionaryCodec {
  return new DictionaryCodecImpl()
}

// Re-export class for testing
export { DictionaryCodecImpl }
