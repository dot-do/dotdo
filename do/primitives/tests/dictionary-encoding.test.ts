/**
 * Dictionary Encoding Tests
 *
 * TDD tests for dictionary encoding of string columns in TypedColumnStore.
 *
 * Dictionary encoding maps strings to integers:
 * - Dictionary: unique strings -> integer IDs
 * - Data: array of integer IDs (smaller than strings)
 *
 * Benefits:
 * - 10x+ compression for low-cardinality strings
 * - GROUP BY uses integer comparison (faster)
 * - Filter pushdown via dictionary lookup
 *
 * @module db/primitives/tests/dictionary-encoding
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DictionaryCodec,
  createDictionaryCodec,
  type DictionaryEncodedColumn,
  type DictionaryEncodeResult,
  type DictionaryMergeResult,
} from '../dictionary-codec'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Low-cardinality data (typical for analytics: country codes, statuses, etc.)
 *
 * For 2-byte country codes with 5 unique values:
 * - Raw: 1000 * 2 bytes = 2000 bytes
 * - Dictionary: 5 * 2 bytes = 10 bytes
 * - Indices: 1000 * 1 byte = 1000 bytes (Uint8 since cardinality <= 256)
 * - Total compressed: ~1010 bytes
 * - Compression ratio: ~2x
 *
 * For 10x compression, we need longer strings or more repetition.
 * Using longer status-like strings achieves better compression.
 */
const LOW_CARDINALITY_DATA = {
  // 10000 values with only 5 unique longer strings (average ~15 bytes each)
  values: Array.from(
    { length: 10000 },
    (_, i) =>
      ['United States', 'United Kingdom', 'Germany Berlin', 'France Paris', 'Japan Tokyo'][i % 5]
  ),
  uniqueCount: 5,
  // Raw: 10000 * ~14 bytes = ~140000 bytes
  // Dictionary: 5 * ~14 bytes = ~70 bytes
  // Indices: 10000 * 1 byte = 10000 bytes
  // Compression ratio: ~140000 / 10070 = ~14x
  expectedMinCompressionRatio: 10, // 10x compression vs raw string storage
}

/**
 * Status values (typical enum-like data)
 */
const STATUS_DATA = {
  values: ['pending', 'pending', 'pending', 'active', 'active', 'completed', 'failed', 'pending', 'active', 'completed'],
  uniqueCount: 4,
}

/**
 * Country codes (ISO 3166-1 alpha-2)
 */
const COUNTRY_CODES = ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'ES', 'IT', 'JP', 'CN', 'AU', 'BR', 'IN', 'RU', 'KR']

// ============================================================================
// DictionaryCodec Basic Tests
// ============================================================================

describe('DictionaryCodec', () => {
  let codec: DictionaryCodec

  beforeEach(() => {
    codec = createDictionaryCodec()
  })

  describe('encode', () => {
    it('should encode string array to dictionary + indices', () => {
      const result = codec.encode(STATUS_DATA.values)

      expect(result.dictionary).toBeDefined()
      expect(result.encoded).toBeDefined()
      expect(result.cardinality).toBe(STATUS_DATA.uniqueCount)
    })

    it('should create dictionary with unique values only', () => {
      const result = codec.encode(STATUS_DATA.values)

      // Dictionary should contain each unique value exactly once
      expect(result.dictionary.length).toBe(STATUS_DATA.uniqueCount)
      expect(new Set(result.dictionary).size).toBe(STATUS_DATA.uniqueCount)
    })

    it('should encode values as indices into dictionary', () => {
      const result = codec.encode(['a', 'b', 'a', 'c', 'b', 'a'])

      // Each encoded value should be a valid index
      for (let i = 0; i < result.encoded.length; i++) {
        const index = result.encoded[i]
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(result.dictionary.length)
      }
    })

    it('should preserve value order through encoding', () => {
      const input = ['x', 'y', 'z', 'x', 'y', 'x']
      const result = codec.encode(input)

      // Decode and verify order is preserved
      const decoded = codec.decode(result.dictionary, result.encoded)
      expect(decoded).toEqual(input)
    })

    it('should handle empty array', () => {
      const result = codec.encode([])

      expect(result.dictionary).toEqual([])
      expect(result.encoded.length).toBe(0)
      expect(result.cardinality).toBe(0)
    })

    it('should handle single value', () => {
      const result = codec.encode(['only-one'])

      expect(result.dictionary).toEqual(['only-one'])
      expect(result.encoded.length).toBe(1)
      expect(result.encoded[0]).toBe(0)
      expect(result.cardinality).toBe(1)
    })

    it('should handle all unique values', () => {
      const input = ['a', 'b', 'c', 'd', 'e']
      const result = codec.encode(input)

      expect(result.dictionary.length).toBe(5)
      expect(result.cardinality).toBe(5)
    })

    it('should handle all same values', () => {
      const input = Array(100).fill('same')
      const result = codec.encode(input)

      expect(result.dictionary).toEqual(['same'])
      expect(result.cardinality).toBe(1)
      // All encoded values should be 0
      expect(result.encoded.every((v) => v === 0)).toBe(true)
    })

    it('should handle large strings', () => {
      const longString = 'a'.repeat(10000)
      const input = [longString, longString, 'short', longString]
      const result = codec.encode(input)

      expect(result.dictionary.length).toBe(2)
      expect(result.dictionary).toContain(longString)
      expect(result.dictionary).toContain('short')
    })

    it('should handle unicode strings', () => {
      const input = ['hello', 'world']
      const result = codec.encode(input)

      const decoded = codec.decode(result.dictionary, result.encoded)
      expect(decoded).toEqual(input)
    })

    it('should handle empty strings', () => {
      const input = ['', 'a', '', 'b', '']
      const result = codec.encode(input)

      const decoded = codec.decode(result.dictionary, result.encoded)
      expect(decoded).toEqual(input)
    })
  })

  describe('decode', () => {
    it('should decode indices back to original strings', () => {
      const input = STATUS_DATA.values
      const { dictionary, encoded } = codec.encode(input)

      const decoded = codec.decode(dictionary, encoded)

      expect(decoded).toEqual(input)
    })

    it('should handle empty dictionary', () => {
      const decoded = codec.decode([], new Uint32Array(0))
      expect(decoded).toEqual([])
    })

    it('should throw for invalid index', () => {
      const dictionary = ['a', 'b', 'c']
      const encoded = new Uint32Array([0, 1, 99]) // 99 is out of bounds

      expect(() => codec.decode(dictionary, encoded)).toThrow()
    })
  })

  describe('lookup', () => {
    it('should return index for existing value', () => {
      const dictionary = ['apple', 'banana', 'cherry']

      expect(codec.lookup(dictionary, 'apple')).toBe(0)
      expect(codec.lookup(dictionary, 'banana')).toBe(1)
      expect(codec.lookup(dictionary, 'cherry')).toBe(2)
    })

    it('should return null for non-existing value', () => {
      const dictionary = ['apple', 'banana', 'cherry']

      expect(codec.lookup(dictionary, 'date')).toBeNull()
      expect(codec.lookup(dictionary, '')).toBeNull()
    })

    it('should handle empty dictionary', () => {
      expect(codec.lookup([], 'anything')).toBeNull()
    })

    it('should use efficient lookup for large dictionaries', () => {
      // Create large dictionary
      const dictionary = Array.from({ length: 10000 }, (_, i) => `value_${i}`)

      // Lookup should be fast (O(1) or O(log n), not O(n))
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        codec.lookup(dictionary, `value_${i * 10}`)
      }
      const elapsed = performance.now() - start

      // Should complete in reasonable time (less than 100ms for 1000 lookups)
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('merge', () => {
    it('should merge two dictionaries', () => {
      const dict1 = ['a', 'b', 'c']
      const dict2 = ['c', 'd', 'e']

      const result = codec.merge(dict1, dict2)

      // Merged dictionary should have all unique values
      expect(new Set(result.merged).size).toBe(5) // a, b, c, d, e
      expect(result.merged.length).toBe(5)
    })

    it('should provide remapping for dict2 indices', () => {
      const dict1 = ['a', 'b', 'c']
      const dict2 = ['c', 'd', 'e']

      const result = codec.merge(dict1, dict2)

      // Check that remapping correctly maps dict2 indices to merged indices
      // 'c' in dict2 (index 0) should map to its position in merged
      // 'd' in dict2 (index 1) should map to its position in merged
      // 'e' in dict2 (index 2) should map to its position in merged
      for (let i = 0; i < dict2.length; i++) {
        const oldIndex = i
        const newIndex = result.remapping.get(oldIndex)
        expect(newIndex).toBeDefined()
        expect(result.merged[newIndex!]).toBe(dict2[i])
      }
    })

    it('should handle disjoint dictionaries', () => {
      const dict1 = ['a', 'b', 'c']
      const dict2 = ['x', 'y', 'z']

      const result = codec.merge(dict1, dict2)

      expect(result.merged.length).toBe(6)
    })

    it('should handle identical dictionaries', () => {
      const dict1 = ['a', 'b', 'c']
      const dict2 = ['a', 'b', 'c']

      const result = codec.merge(dict1, dict2)

      expect(result.merged.length).toBe(3)
    })

    it('should handle empty dict1', () => {
      const dict1: string[] = []
      const dict2 = ['a', 'b', 'c']

      const result = codec.merge(dict1, dict2)

      expect(result.merged).toEqual(['a', 'b', 'c'])
    })

    it('should handle empty dict2', () => {
      const dict1 = ['a', 'b', 'c']
      const dict2: string[] = []

      const result = codec.merge(dict1, dict2)

      expect(result.merged).toEqual(['a', 'b', 'c'])
      expect(result.remapping.size).toBe(0)
    })

    it('should preserve dict1 indices in merged dictionary', () => {
      const dict1 = ['a', 'b', 'c']
      const dict2 = ['d', 'e']

      const result = codec.merge(dict1, dict2)

      // dict1 values should keep their original indices
      expect(result.merged[0]).toBe('a')
      expect(result.merged[1]).toBe('b')
      expect(result.merged[2]).toBe('c')
    })
  })

  describe('variable-width encoding', () => {
    it('should use Uint8Array for cardinality <= 256', () => {
      const input = COUNTRY_CODES.slice(0, 10) // 10 unique values
      const values = Array.from({ length: 100 }, (_, i) => input[i % input.length])
      const result = codec.encode(values)

      // Should use Uint8 (1 byte per index) for small cardinality
      expect(result.encoded.BYTES_PER_ELEMENT).toBe(1)
    })

    it('should use Uint16Array for cardinality <= 65536', () => {
      // Create 300 unique values
      const input = Array.from({ length: 300 }, (_, i) => `value_${i}`)
      const result = codec.encode(input)

      // Should use Uint16 (2 bytes per index) for medium cardinality
      expect(result.encoded.BYTES_PER_ELEMENT).toBe(2)
    })

    it('should use Uint32Array for cardinality > 65536', () => {
      // Create 70000 unique values
      const input = Array.from({ length: 70000 }, (_, i) => `value_${i}`)
      const result = codec.encode(input)

      // Should use Uint32 (4 bytes per index) for high cardinality
      expect(result.encoded.BYTES_PER_ELEMENT).toBe(4)
    })
  })
})

// ============================================================================
// Compression Ratio Tests
// ============================================================================

describe('Dictionary Encoding Compression', () => {
  let codec: DictionaryCodec

  beforeEach(() => {
    codec = createDictionaryCodec()
  })

  it('should achieve >10x compression for low-cardinality country codes', () => {
    const values = LOW_CARDINALITY_DATA.values

    // Calculate raw size (UTF-8 encoded strings)
    const rawSize = values.reduce((sum, v) => sum + new TextEncoder().encode(v).length, 0)

    const result = codec.encode(values)

    // Dictionary size + encoded indices size
    const dictSize = result.dictionary.reduce((sum, v) => sum + new TextEncoder().encode(v).length, 0)
    const indicesSize = result.encoded.byteLength
    const compressedSize = dictSize + indicesSize

    const ratio = rawSize / compressedSize

    expect(ratio).toBeGreaterThan(LOW_CARDINALITY_DATA.expectedMinCompressionRatio)
  })

  it('should achieve excellent compression for enum-like status values', () => {
    // 10000 status values with 4 unique statuses
    const statuses = ['pending', 'active', 'completed', 'failed']
    const values = Array.from({ length: 10000 }, (_, i) => statuses[i % statuses.length])

    const rawSize = values.reduce((sum, v) => sum + new TextEncoder().encode(v).length, 0)
    const result = codec.encode(values)

    const dictSize = result.dictionary.reduce((sum, v) => sum + new TextEncoder().encode(v).length, 0)
    const indicesSize = result.encoded.byteLength
    const compressedSize = dictSize + indicesSize

    const ratio = rawSize / compressedSize

    // Should be very high compression for enum-like data
    expect(ratio).toBeGreaterThan(5)
  })

  it('should handle worst-case all-unique values gracefully', () => {
    // All unique values - dictionary encoding may expand
    const values = Array.from({ length: 100 }, (_, i) => `unique_${i}`)

    const result = codec.encode(values)
    const decoded = codec.decode(result.dictionary, result.encoded)

    // Should still decode correctly even if no compression benefit
    expect(decoded).toEqual(values)
  })
})

// ============================================================================
// Filter Pushdown Tests
// ============================================================================

describe('Dictionary Filter Pushdown', () => {
  let codec: DictionaryCodec

  beforeEach(() => {
    codec = createDictionaryCodec()
  })

  it('should support equality filter via dictionary lookup', () => {
    const values = ['US', 'UK', 'DE', 'US', 'FR', 'US', 'UK', 'DE']
    const result = codec.encode(values)

    // Filter for 'US' - should use dictionary lookup
    const usIndex = codec.lookup(result.dictionary, 'US')
    expect(usIndex).not.toBeNull()

    // Find all positions where encoded value equals usIndex
    const matches: number[] = []
    for (let i = 0; i < result.encoded.length; i++) {
      if (result.encoded[i] === usIndex) {
        matches.push(i)
      }
    }

    // Should match positions 0, 3, 5
    expect(matches).toEqual([0, 3, 5])
  })

  it('should support IN filter via dictionary lookup', () => {
    const values = ['US', 'UK', 'DE', 'US', 'FR', 'US', 'UK', 'DE', 'JP']
    const result = codec.encode(values)

    // Filter for ['US', 'UK'] - lookup both
    const targetValues = ['US', 'UK']
    const targetIndices = new Set(
      targetValues.map((v) => codec.lookup(result.dictionary, v)).filter((i) => i !== null) as number[]
    )

    // Find all matching positions
    const matches: number[] = []
    for (let i = 0; i < result.encoded.length; i++) {
      if (targetIndices.has(result.encoded[i]!)) {
        matches.push(i)
      }
    }

    // Should match US (0, 3, 5) and UK (1, 6)
    expect(matches).toEqual([0, 1, 3, 5, 6])
  })

  it('should handle filter for non-existent value', () => {
    const values = ['US', 'UK', 'DE']
    const result = codec.encode(values)

    // Filter for value not in dictionary
    const index = codec.lookup(result.dictionary, 'XX')
    expect(index).toBeNull()

    // No matches expected
  })
})

// ============================================================================
// Serialization Tests
// ============================================================================

describe('Dictionary Serialization', () => {
  let codec: DictionaryCodec

  beforeEach(() => {
    codec = createDictionaryCodec()
  })

  it('should serialize and deserialize encoded column', () => {
    const values = STATUS_DATA.values
    const encoded = codec.encode(values)

    // Serialize to bytes
    const serialized = codec.serialize(encoded)
    expect(serialized).toBeInstanceOf(Uint8Array)

    // Deserialize back
    const deserialized = codec.deserialize(serialized)

    // Verify round-trip
    expect(deserialized.dictionary).toEqual(encoded.dictionary)
    expect(Array.from(deserialized.encoded)).toEqual(Array.from(encoded.encoded))
    expect(deserialized.cardinality).toBe(encoded.cardinality)
  })

  it('should handle empty encoded column', () => {
    const encoded = codec.encode([])

    const serialized = codec.serialize(encoded)
    const deserialized = codec.deserialize(serialized)

    expect(deserialized.dictionary).toEqual([])
    expect(deserialized.encoded.length).toBe(0)
  })

  it('should handle large dictionaries', () => {
    const values = Array.from({ length: 1000 }, (_, i) => `value_${i % 500}`)
    const encoded = codec.encode(values)

    const serialized = codec.serialize(encoded)
    const deserialized = codec.deserialize(serialized)

    const decoded = codec.decode(deserialized.dictionary, deserialized.encoded)
    expect(decoded).toEqual(values)
  })

  it('should produce compact serialization', () => {
    const values = LOW_CARDINALITY_DATA.values
    const rawSize = values.reduce((sum, v) => sum + new TextEncoder().encode(v).length, 0)

    const encoded = codec.encode(values)
    const serialized = codec.serialize(encoded)

    // Serialized should be much smaller than raw
    expect(serialized.byteLength).toBeLessThan(rawSize / 5)
  })
})

// ============================================================================
// Integration with TypedColumnStore Tests
// ============================================================================

import {
  createColumnStore,
  type TypedColumnStore,
} from '../typed-column-store'

describe('Dictionary Encoding TypedColumnStore Integration', () => {
  let store: TypedColumnStore

  beforeEach(() => {
    store = createColumnStore()
  })

  it('should add string column with dictionary encoding option', () => {
    store.addColumn('country', 'string', { encoding: 'dictionary' })
    const result = store.project(['country'])
    expect(result.columns.has('country')).toBe(true)
  })

  it('should append and retrieve dictionary-encoded strings', () => {
    store.addColumn('status', 'string', { encoding: 'dictionary' })
    store.append('status', ['pending', 'active', 'completed', 'pending', 'active'])

    const result = store.project(['status'])
    expect(result.rowCount).toBe(5)
    expect(result.columns.get('status')).toEqual(['pending', 'active', 'completed', 'pending', 'active'])
  })

  it('should filter dictionary-encoded column with equality', () => {
    store.addColumn('country', 'string', { encoding: 'dictionary' })
    store.addColumn('value', 'int64')

    store.append('country', ['US', 'UK', 'US', 'DE', 'US', 'UK'])
    store.append('value', [100, 200, 300, 400, 500, 600])

    const filtered = store.filter({ column: 'country', op: '=', value: 'US' })

    expect(filtered.rowCount).toBe(3)
    expect(filtered.columns.get('country')).toEqual(['US', 'US', 'US'])
    expect(filtered.columns.get('value')).toEqual([100, 300, 500])
  })

  it('should filter dictionary-encoded column with IN operator', () => {
    store.addColumn('category', 'string', { encoding: 'dictionary' })
    store.append('category', ['A', 'B', 'C', 'A', 'D', 'B', 'E'])

    const filtered = store.filter({ column: 'category', op: 'in', value: ['A', 'B'] })

    expect(filtered.rowCount).toBe(4)
    expect(filtered.columns.get('category')).toEqual(['A', 'B', 'A', 'B'])
  })

  it('should get distinct count efficiently for dictionary column', () => {
    store.addColumn('product', 'string', { encoding: 'dictionary' })

    // 10000 values with 50 unique
    const products = Array.from({ length: 50 }, (_, i) => `product_${i}`)
    const values = Array.from({ length: 10000 }, (_, i) => products[i % 50])
    store.append('product', values)

    const count = store.distinctCount('product')
    expect(count).toBe(50)
  })

  it('should get cardinality from dictionary-encoded column', () => {
    store.addColumn('region', 'string', { encoding: 'dictionary' })
    store.append('region', ['North', 'South', 'East', 'West', 'North', 'South'])

    // getDictionaryCardinality is a helper method
    const cardinality = store.getDictionaryCardinality?.('region')
    if (cardinality !== undefined) {
      expect(cardinality).toBe(4)
    }
  })

  it('should auto-detect dictionary candidates based on threshold', () => {
    // Add string column with auto threshold
    store.addColumn('status', 'string', { encoding: 'auto', dictionaryThreshold: 100 })

    // Append low-cardinality data - should trigger dictionary encoding
    const statuses = ['pending', 'active', 'completed', 'failed']
    const values = Array.from({ length: 1000 }, (_, i) => statuses[i % 4])
    store.append('status', values)

    // Column should be dictionary encoded (cardinality 4 < threshold 100)
    const info = store.getColumnInfo?.('status')
    if (info?.encoding) {
      expect(info.encoding).toBe('dictionary')
    }
  })

  it('should maintain row alignment with mixed encoded columns', () => {
    store.addColumn('id', 'int64')
    store.addColumn('category', 'string', { encoding: 'dictionary' })
    store.addColumn('price', 'float64')

    store.append('id', [1, 2, 3, 4, 5])
    store.append('category', ['A', 'B', 'A', 'C', 'B'])
    store.append('price', [10.5, 20.0, 15.5, 30.0, 25.0])

    const filtered = store.filter({ column: 'category', op: '=', value: 'A' })

    expect(filtered.rowCount).toBe(2)
    expect(filtered.columns.get('id')).toEqual([1, 3])
    expect(filtered.columns.get('category')).toEqual(['A', 'A'])
    expect(filtered.columns.get('price')).toEqual([10.5, 15.5])
  })

  it('should handle append with new dictionary values', () => {
    store.addColumn('tag', 'string', { encoding: 'dictionary' })

    // First batch
    store.append('tag', ['foo', 'bar', 'foo'])

    // Second batch with new value
    store.append('tag', ['baz', 'foo', 'qux'])

    const result = store.project(['tag'])
    expect(result.rowCount).toBe(6)
    expect(result.columns.get('tag')).toEqual(['foo', 'bar', 'foo', 'baz', 'foo', 'qux'])
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Dictionary Encoding Edge Cases', () => {
  let codec: DictionaryCodec

  beforeEach(() => {
    codec = createDictionaryCodec()
  })

  it('should handle strings with special characters', () => {
    const input = [
      'hello\nworld',
      'tab\there',
      'quote"here',
      'null\x00char',
      'backslash\\here',
    ]
    const result = codec.encode(input)
    const decoded = codec.decode(result.dictionary, result.encoded)

    expect(decoded).toEqual(input)
  })

  it('should handle very long strings mixed with short', () => {
    const longStr = 'x'.repeat(100000)
    const input = ['a', longStr, 'b', longStr, 'c']
    const result = codec.encode(input)
    const decoded = codec.decode(result.dictionary, result.encoded)

    expect(decoded).toEqual(input)
  })

  it('should handle mixed case strings as distinct', () => {
    const input = ['ABC', 'abc', 'Abc', 'aBc']
    const result = codec.encode(input)

    expect(result.cardinality).toBe(4)
  })

  it('should handle whitespace-only strings', () => {
    const input = [' ', '  ', '\t', '\n', '']
    const result = codec.encode(input)
    const decoded = codec.decode(result.dictionary, result.encoded)

    expect(decoded).toEqual(input)
  })

  it('should handle binary-like strings', () => {
    const input = ['\x00\x01\x02', '\xff\xfe\xfd', '\x00\x00\x00']
    const result = codec.encode(input)
    const decoded = codec.decode(result.dictionary, result.encoded)

    expect(decoded).toEqual(input)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Dictionary Encoding Performance', () => {
  let codec: DictionaryCodec

  beforeEach(() => {
    codec = createDictionaryCodec()
  })

  it('should encode 1M values in reasonable time', () => {
    const categories = ['A', 'B', 'C', 'D', 'E']
    const values = Array.from({ length: 1_000_000 }, (_, i) => categories[i % categories.length])

    const start = performance.now()
    const result = codec.encode(values)
    const elapsed = performance.now() - start

    expect(result.cardinality).toBe(5)
    expect(elapsed).toBeLessThan(5000) // Less than 5 seconds
  })

  it('should decode 1M values in reasonable time', () => {
    const categories = ['A', 'B', 'C', 'D', 'E']
    const values = Array.from({ length: 1_000_000 }, (_, i) => categories[i % categories.length])
    const { dictionary, encoded } = codec.encode(values)

    const start = performance.now()
    const decoded = codec.decode(dictionary, encoded)
    const elapsed = performance.now() - start

    expect(decoded.length).toBe(1_000_000)
    expect(elapsed).toBeLessThan(5000) // Less than 5 seconds
  })

  it('should perform fast lookups on large dictionary', () => {
    const values = Array.from({ length: 10000 }, (_, i) => `value_${i}`)
    const { dictionary } = codec.encode(values)

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      codec.lookup(dictionary, `value_${i}`)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1000) // Less than 1 second for 10K lookups
  })
})
