import { describe, it, expect } from 'vitest'

/**
 * Iceberg Puffin Sidecar File Tests
 *
 * Tests for the Puffin file format implementation including:
 * - Bloom filter creation, serialization, and membership testing
 * - N-gram bloom filter for LIKE query support
 * - Set index for low-cardinality columns
 * - Puffin file writing and reading
 * - Range-addressable access patterns
 *
 * @see https://iceberg.apache.org/puffin-spec/
 * @see db/iceberg/puffin.ts
 */

import {
  // Core types
  PUFFIN_MAGIC,
  DEFAULT_FPR,
  type BlobMetadata,
  type PuffinFooter,

  // Hash function
  murmurHash3_32,
  doubleHash,

  // Bloom filter
  BloomFilter,
  type BloomFilterConfig,

  // N-gram bloom filter
  NgramBloomFilter,
  type NgramBloomConfig,

  // Set index
  SetIndex,

  // Puffin writer/reader
  PuffinWriter,
  PuffinReader,

  // Convenience functions
  createBloomFilterFromValues,
  createNgramBloomFromValues,
  createSetIndexFromValues,
  estimateBloomFilterSize,
} from '../puffin'

// ============================================================================
// MurmurHash3 Tests
// ============================================================================

describe('MurmurHash3', () => {
  describe('murmurHash3_32', () => {
    it('produces consistent hash for same input', () => {
      const input = new TextEncoder().encode('hello')

      const hash1 = murmurHash3_32(input)
      const hash2 = murmurHash3_32(input)

      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different inputs', () => {
      const input1 = new TextEncoder().encode('hello')
      const input2 = new TextEncoder().encode('world')

      const hash1 = murmurHash3_32(input1)
      const hash2 = murmurHash3_32(input2)

      expect(hash1).not.toBe(hash2)
    })

    it('produces different hashes with different seeds', () => {
      const input = new TextEncoder().encode('test')

      const hash1 = murmurHash3_32(input, 0)
      const hash2 = murmurHash3_32(input, 1)

      expect(hash1).not.toBe(hash2)
    })

    it('handles empty input', () => {
      const input = new Uint8Array(0)

      const hash = murmurHash3_32(input)

      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('handles inputs of various lengths', () => {
      const hashes = new Set<number>()

      // Test lengths 1-16 to cover block and tail processing
      for (let len = 1; len <= 16; len++) {
        const input = new Uint8Array(len).fill(0x42)
        hashes.add(murmurHash3_32(input))
      }

      // All should be unique
      expect(hashes.size).toBe(16)
    })

    it('produces 32-bit unsigned integers', () => {
      const input = new TextEncoder().encode('test value')

      const hash = murmurHash3_32(input)

      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
      expect(Number.isInteger(hash)).toBe(true)
    })
  })

  describe('doubleHash', () => {
    it('returns two different hash values', () => {
      const input = new TextEncoder().encode('test')

      const [h1, h2] = doubleHash(input)

      expect(h1).not.toBe(h2)
    })

    it('produces consistent results', () => {
      const input = new TextEncoder().encode('hello world')

      const [h1a, h2a] = doubleHash(input)
      const [h1b, h2b] = doubleHash(input)

      expect(h1a).toBe(h1b)
      expect(h2a).toBe(h2b)
    })
  })
})

// ============================================================================
// Bloom Filter Tests
// ============================================================================

describe('BloomFilter', () => {
  describe('construction', () => {
    it('creates filter with expected configuration', () => {
      const filter = new BloomFilter({ expectedElements: 1000 })

      expect(filter.sizeBytes).toBeGreaterThan(5) // At least header
    })

    it('creates larger filter for more elements', () => {
      const small = new BloomFilter({ expectedElements: 100 })
      const large = new BloomFilter({ expectedElements: 10000 })

      expect(large.sizeBytes).toBeGreaterThan(small.sizeBytes)
    })

    it('creates larger filter for lower FPR', () => {
      const loose = new BloomFilter({ expectedElements: 1000, falsePositiveRate: 0.1 })
      const strict = new BloomFilter({ expectedElements: 1000, falsePositiveRate: 0.001 })

      expect(strict.sizeBytes).toBeGreaterThan(loose.sizeBytes)
    })
  })

  describe('add and mightContain', () => {
    it('returns true for added items', () => {
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('test-value')
      filter.add('another-value')

      expect(filter.mightContain('test-value')).toBe(true)
      expect(filter.mightContain('another-value')).toBe(true)
    })

    it('returns false for items not added (usually)', () => {
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('apple')
      filter.add('banana')

      // These should almost certainly return false
      expect(filter.mightContain('xyz-never-added')).toBe(false)
      expect(filter.mightContain('completely-different-12345')).toBe(false)
    })

    it('handles empty strings', () => {
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('')

      expect(filter.mightContain('')).toBe(true)
      expect(filter.mightContain('not-empty')).toBe(false)
    })

    it('handles unicode strings', () => {
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('cafe')
      filter.add('hello')

      expect(filter.mightContain('cafe')).toBe(true)
      expect(filter.mightContain('hello')).toBe(true)
      expect(filter.mightContain('nope')).toBe(false)
    })

    it('handles bytes directly', () => {
      const filter = new BloomFilter({ expectedElements: 100 })
      const bytes = new Uint8Array([1, 2, 3, 4, 5])

      filter.addBytes(bytes)

      expect(filter.mightContainBytes(bytes)).toBe(true)
      expect(filter.mightContainBytes(new Uint8Array([5, 4, 3, 2, 1]))).toBe(false)
    })
  })

  describe('serialization', () => {
    it('roundtrips correctly', () => {
      const original = new BloomFilter({ expectedElements: 1000 })

      original.add('value1')
      original.add('value2')
      original.add('value3')

      const bytes = original.serialize()
      const restored = BloomFilter.deserialize(bytes)

      expect(restored.mightContain('value1')).toBe(true)
      expect(restored.mightContain('value2')).toBe(true)
      expect(restored.mightContain('value3')).toBe(true)
      expect(restored.mightContain('not-added')).toBe(false)
    })

    it('preserves size after roundtrip', () => {
      const original = new BloomFilter({ expectedElements: 500 })
      original.add('test')

      const bytes = original.serialize()
      const restored = BloomFilter.deserialize(bytes)

      expect(restored.sizeBytes).toBe(original.sizeBytes)
    })

    it('throws on invalid input', () => {
      expect(() => BloomFilter.deserialize(new Uint8Array([1, 2]))).toThrow()
    })
  })

  describe('size estimation', () => {
    it('achieves approximately 1KB per 10,000 items at 1% FPR', () => {
      const filter = new BloomFilter({ expectedElements: 10000, falsePositiveRate: 0.01 })

      // At 1% FPR, we need ~9.6 bits per element = 96,000 bits = 12,000 bytes
      // With header overhead, should be around 12KB
      expect(filter.sizeBytes).toBeLessThan(15000) // Max 15KB
      expect(filter.sizeBytes).toBeGreaterThan(8000) // At least 8KB
    })

    it('estimateBloomFilterSize matches actual size', () => {
      const elements = 5000
      const fpr = 0.02

      const estimated = estimateBloomFilterSize(elements, fpr)
      const actual = new BloomFilter({ expectedElements: elements, falsePositiveRate: fpr }).sizeBytes

      // Should be within 10% of each other
      expect(Math.abs(estimated - actual)).toBeLessThan(actual * 0.1)
    })
  })

  describe('false positive rate', () => {
    it('maintains acceptable FPR for large datasets', () => {
      const n = 10000
      const targetFpr = 0.01
      const filter = new BloomFilter({ expectedElements: n, falsePositiveRate: targetFpr })

      // Add n items
      for (let i = 0; i < n; i++) {
        filter.add(`item-${i}`)
      }

      // Check items we added (all should be true)
      let addedPositives = 0
      for (let i = 0; i < n; i++) {
        if (filter.mightContain(`item-${i}`)) {
          addedPositives++
        }
      }
      expect(addedPositives).toBe(n)

      // Check items we didn't add, count false positives
      let falsePositives = 0
      const testCount = 10000
      for (let i = 0; i < testCount; i++) {
        if (filter.mightContain(`not-added-${i}`)) {
          falsePositives++
        }
      }

      const observedFpr = falsePositives / testCount
      // Allow 3x tolerance for statistical variation
      expect(observedFpr).toBeLessThan(targetFpr * 3)
    })
  })
})

// ============================================================================
// N-gram Bloom Filter Tests
// ============================================================================

describe('NgramBloomFilter', () => {
  describe('construction', () => {
    it('creates filter with default trigrams', () => {
      const filter = new NgramBloomFilter({ expectedElements: 100 })

      expect(filter.sizeBytes).toBeGreaterThan(0)
    })

    it('accepts custom n-gram size', () => {
      const trigram = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3 })
      const bigram = new NgramBloomFilter({ expectedElements: 100, ngramSize: 2 })

      // Both should work
      expect(trigram.sizeBytes).toBeGreaterThan(0)
      expect(bigram.sizeBytes).toBeGreaterThan(0)
    })
  })

  describe('substring matching', () => {
    it('returns true for substring that exists', () => {
      const filter = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3 })

      filter.add('hello@example.com.ai')
      filter.add('world@test.org')

      expect(filter.mightContainSubstring('example')).toBe(true)
      expect(filter.mightContainSubstring('hello')).toBe(true)
      expect(filter.mightContainSubstring('test')).toBe(true)
    })

    it('returns false for substring that does not exist (usually)', () => {
      const filter = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3 })

      filter.add('hello@example.com.ai')
      filter.add('world@test.org')

      expect(filter.mightContainSubstring('zzzzz')).toBe(false)
      expect(filter.mightContainSubstring('nothere')).toBe(false)
    })

    it('returns true for patterns shorter than n-gram size (conservative)', () => {
      const filter = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3 })

      filter.add('test')

      // Can't determine for patterns < 3 chars, so return true
      expect(filter.mightContainSubstring('ab')).toBe(true)
      expect(filter.mightContainSubstring('x')).toBe(true)
    })

    it('handles exact match', () => {
      const filter = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3 })

      filter.add('exact-match')

      expect(filter.mightContainSubstring('exact-match')).toBe(true)
    })

    it('handles prefix and suffix patterns', () => {
      const filter = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3, padStrings: true })

      filter.add('testvalue')

      // With padding, start/end patterns should work
      expect(filter.mightContainSubstring('test')).toBe(true)
      expect(filter.mightContainSubstring('value')).toBe(true)
    })
  })

  describe('serialization', () => {
    it('roundtrips correctly', () => {
      const original = new NgramBloomFilter({ expectedElements: 100, ngramSize: 3 })

      original.add('hello@example.com.ai')
      original.add('test@domain.org')

      const bytes = original.serialize()
      const restored = NgramBloomFilter.deserialize(bytes)

      expect(restored.mightContainSubstring('example')).toBe(true)
      expect(restored.mightContainSubstring('domain')).toBe(true)
      expect(restored.mightContainSubstring('nothere')).toBe(false)
    })

    it('throws on invalid input', () => {
      expect(() => NgramBloomFilter.deserialize(new Uint8Array([1]))).toThrow()
    })
  })
})

// ============================================================================
// Set Index Tests
// ============================================================================

describe('SetIndex', () => {
  describe('add and contains', () => {
    it('returns true for added values', () => {
      const index = new SetIndex()

      index.add('active')
      index.add('pending')
      index.add('closed')

      expect(index.contains('active')).toBe(true)
      expect(index.contains('pending')).toBe(true)
      expect(index.contains('closed')).toBe(true)
    })

    it('returns false for values not added (exactly)', () => {
      const index = new SetIndex()

      index.add('active')
      index.add('pending')

      expect(index.contains('deleted')).toBe(false)
      expect(index.contains('unknown')).toBe(false)
    })

    it('deduplicates values', () => {
      const index = new SetIndex()

      index.add('active')
      index.add('active')
      index.add('active')

      expect(index.size).toBe(1)
    })
  })

  describe('containsAny', () => {
    it('returns true if any value matches', () => {
      const index = new SetIndex()

      index.add('status1')
      index.add('status2')

      expect(index.containsAny(['status1', 'other'])).toBe(true)
      expect(index.containsAny(['status2'])).toBe(true)
    })

    it('returns false if no values match', () => {
      const index = new SetIndex()

      index.add('active')

      expect(index.containsAny(['pending', 'closed'])).toBe(false)
    })

    it('handles empty array', () => {
      const index = new SetIndex()
      index.add('test')

      expect(index.containsAny([])).toBe(false)
    })
  })

  describe('getValues', () => {
    it('returns all unique values', () => {
      const index = new SetIndex()

      index.add('a')
      index.add('b')
      index.add('c')
      index.add('a') // duplicate

      const values = index.getValues()

      expect(values).toHaveLength(3)
      expect(values).toContain('a')
      expect(values).toContain('b')
      expect(values).toContain('c')
    })
  })

  describe('serialization', () => {
    it('roundtrips correctly', () => {
      const original = new SetIndex()

      original.add('value1')
      original.add('value2')
      original.add('value3')

      const bytes = original.serialize()
      const restored = SetIndex.deserialize(bytes)

      expect(restored.contains('value1')).toBe(true)
      expect(restored.contains('value2')).toBe(true)
      expect(restored.contains('value3')).toBe(true)
      expect(restored.contains('value4')).toBe(false)
      expect(restored.size).toBe(3)
    })

    it('preserves size after roundtrip', () => {
      const original = new SetIndex()
      original.add('a')
      original.add('b')

      const bytes = original.serialize()
      const restored = SetIndex.deserialize(bytes)

      expect(restored.size).toBe(original.size)
    })
  })
})

// ============================================================================
// Puffin Writer Tests
// ============================================================================

describe('PuffinWriter', () => {
  describe('construction', () => {
    it('creates writer with required options', () => {
      const writer = new PuffinWriter({
        snapshotId: 123,
        sequenceNumber: 1,
      })

      expect(writer).toBeDefined()
    })

    it('accepts optional properties', () => {
      const writer = new PuffinWriter({
        snapshotId: 123,
        sequenceNumber: 1,
        properties: { 'write-engine': 'dotdo' },
      })

      expect(writer).toBeDefined()
    })
  })

  describe('adding blobs', () => {
    it('adds bloom filter blob', () => {
      const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('test')
      writer.addBloomFilter(5, filter)

      const bytes = writer.finish()
      expect(bytes.length).toBeGreaterThan(PUFFIN_MAGIC.length * 2)
    })

    it('adds ngram bloom filter blob', () => {
      const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })
      const filter = new NgramBloomFilter({ expectedElements: 100 })

      filter.add('test@example.com.ai')
      writer.addNgramBloomFilter(5, filter)

      const bytes = writer.finish()
      expect(bytes.length).toBeGreaterThan(PUFFIN_MAGIC.length * 2)
    })

    it('adds set index blob', () => {
      const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })
      const index = new SetIndex()

      index.add('active')
      index.add('pending')
      writer.addSetIndex(6, index)

      const bytes = writer.finish()
      expect(bytes.length).toBeGreaterThan(PUFFIN_MAGIC.length * 2)
    })

    it('adds multiple blobs', () => {
      const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })

      const bloom = new BloomFilter({ expectedElements: 100 })
      bloom.add('test')
      writer.addBloomFilter(5, bloom)

      const ngram = new NgramBloomFilter({ expectedElements: 100 })
      ngram.add('test@example.com.ai')
      writer.addNgramBloomFilter(5, ngram)

      const setIdx = new SetIndex()
      setIdx.add('active')
      writer.addSetIndex(6, setIdx)

      const bytes = writer.finish()
      expect(bytes.length).toBeGreaterThan(0)
    })
  })

  describe('finish', () => {
    it('produces valid Puffin file format', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('test')
      writer.addBloomFilter(5, filter)

      const bytes = writer.finish()

      // Check header magic
      expect(bytes.slice(0, 4)).toEqual(PUFFIN_MAGIC)

      // Check trailer magic
      expect(bytes.slice(-4)).toEqual(PUFFIN_MAGIC)
    })

    it('includes footer length', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addSetIndex(1, createSetIndexFromValues(['a', 'b']))

      const bytes = writer.finish()

      // Footer length is 4 bytes before trailer magic
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const footerLength = view.getUint32(bytes.length - 8, true)

      expect(footerLength).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Puffin Reader Tests
// ============================================================================

describe('PuffinReader', () => {
  describe('fromBytes', () => {
    it('parses complete Puffin file', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      const filter = new BloomFilter({ expectedElements: 100 })

      filter.add('test')
      writer.addBloomFilter(5, filter)

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      expect(reader.getBlobs()).toHaveLength(1)
    })

    it('throws on invalid magic', () => {
      const invalidBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00])

      expect(() => PuffinReader.fromBytes(invalidBytes)).toThrow('magic')
    })
  })

  describe('getBlobs', () => {
    it('returns all blob metadata', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })

      writer.addBloomFilter(5, createBloomFilterFromValues(['a', 'b']))
      writer.addSetIndex(6, createSetIndexFromValues(['x', 'y']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const blobs = reader.getBlobs()

      expect(blobs).toHaveLength(2)
      expect(blobs[0].type).toBe('bloom-filter-v1')
      expect(blobs[0].fields).toEqual([5])
      expect(blobs[1].type).toBe('set-index-v1')
      expect(blobs[1].fields).toEqual([6])
    })
  })

  describe('findBlob', () => {
    it('finds blob by type', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })

      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))
      writer.addSetIndex(6, createSetIndexFromValues(['active']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const bloomMeta = reader.findBlob('bloom-filter-v1')
      const setMeta = reader.findBlob('set-index-v1')

      expect(bloomMeta).not.toBeNull()
      expect(bloomMeta!.type).toBe('bloom-filter-v1')
      expect(setMeta).not.toBeNull()
      expect(setMeta!.type).toBe('set-index-v1')
    })

    it('finds blob by type and field', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })

      writer.addBloomFilter(5, createBloomFilterFromValues(['a']))
      writer.addBloomFilter(7, createBloomFilterFromValues(['b']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const field5Bloom = reader.findBlob('bloom-filter-v1', 5)
      const field7Bloom = reader.findBlob('bloom-filter-v1', 7)
      const field9Bloom = reader.findBlob('bloom-filter-v1', 9)

      expect(field5Bloom).not.toBeNull()
      expect(field5Bloom!.fields).toContain(5)
      expect(field7Bloom).not.toBeNull()
      expect(field7Bloom!.fields).toContain(7)
      expect(field9Bloom).toBeNull()
    })

    it('returns null for non-existent blob', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      expect(reader.findBlob('set-index-v1')).toBeNull()
    })
  })

  describe('findBlobsForField', () => {
    it('returns all blobs for a field', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })

      // Add two different blob types for same field
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))
      writer.addNgramBloomFilter(5, createNgramBloomFromValues(['test@example.com.ai']))
      writer.addBloomFilter(7, createBloomFilterFromValues(['other']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const field5Blobs = reader.findBlobsForField(5)
      const field7Blobs = reader.findBlobsForField(7)

      expect(field5Blobs).toHaveLength(2)
      expect(field7Blobs).toHaveLength(1)
    })
  })

  describe('extractBlob', () => {
    it('extracts and parses bloom filter', () => {
      const original = createBloomFilterFromValues(['value1', 'value2', 'value3'])

      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addBloomFilter(5, original)

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const metadata = reader.findBlob('bloom-filter-v1')!
      const restored = reader.extractBlob(metadata, bytes) as BloomFilter

      expect(restored.mightContain('value1')).toBe(true)
      expect(restored.mightContain('value2')).toBe(true)
      expect(restored.mightContain('value3')).toBe(true)
      expect(restored.mightContain('not-added')).toBe(false)
    })

    it('extracts and parses ngram bloom filter', () => {
      const original = createNgramBloomFromValues(['hello@example.com.ai', 'world@test.org'])

      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addNgramBloomFilter(5, original)

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const metadata = reader.findBlob('ngram-bloom-filter-v1')!
      const restored = reader.extractBlob(metadata, bytes) as NgramBloomFilter

      expect(restored.mightContainSubstring('example')).toBe(true)
      expect(restored.mightContainSubstring('test')).toBe(true)
      expect(restored.mightContainSubstring('zzzzz')).toBe(false)
    })

    it('extracts and parses set index', () => {
      const original = createSetIndexFromValues(['active', 'pending', 'closed'])

      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addSetIndex(6, original)

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const metadata = reader.findBlob('set-index-v1')!
      const restored = reader.extractBlob(metadata, bytes) as SetIndex

      expect(restored.contains('active')).toBe(true)
      expect(restored.contains('pending')).toBe(true)
      expect(restored.contains('closed')).toBe(true)
      expect(restored.contains('deleted')).toBe(false)
    })
  })

  describe('range-addressable access', () => {
    it('getFooterRange returns valid range', () => {
      const fileSize = 10000

      const range = PuffinReader.getFooterRange(fileSize)

      expect(range.start).toBeLessThan(range.end)
      expect(range.end).toBe(fileSize)
      expect(range.start).toBeGreaterThanOrEqual(0)
    })

    it('parseFooterLength extracts correct length', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))

      const bytes = writer.finish()

      // Get the tail bytes
      const tailBytes = bytes.slice(-100)
      const footerLength = PuffinReader.parseFooterLength(tailBytes)

      expect(footerLength).toBeGreaterThan(0)
      expect(footerLength).toBeLessThan(bytes.length)
    })

    it('fromFooterBytes creates working reader', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))

      const bytes = writer.finish()

      // Simulate range request for footer
      const footerRange = PuffinReader.getFooterRange(bytes.length)
      const footerBytes = bytes.slice(footerRange.start, footerRange.end)

      const reader = PuffinReader.fromFooterBytes(footerBytes, bytes.length)

      expect(reader.getBlobs()).toHaveLength(1)
    })

    it('getBlobRange returns correct offsets', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['a', 'b', 'c']))
      writer.addSetIndex(6, createSetIndexFromValues(['x', 'y']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const blob = reader.findBlob('bloom-filter-v1')!
      const range = reader.getBlobRange(blob)

      expect(range.start).toBe(blob.offset)
      expect(range.end).toBe(blob.offset + blob.length)
      expect(range.start).toBeGreaterThanOrEqual(PUFFIN_MAGIC.length)
    })

    it('parseBlob works with extracted bytes', () => {
      const writer = new PuffinWriter({ snapshotId: 123, sequenceNumber: 1 })
      const original = createBloomFilterFromValues(['value1', 'value2'])
      writer.addBloomFilter(5, original)

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const metadata = reader.findBlob('bloom-filter-v1')!
      const range = reader.getBlobRange(metadata)

      // Simulate fetching just the blob bytes
      const blobBytes = bytes.slice(range.start, range.end)
      const restored = reader.parseBlob(metadata, blobBytes) as BloomFilter

      expect(restored.mightContain('value1')).toBe(true)
      expect(restored.mightContain('value2')).toBe(true)
    })
  })

  describe('metadata preservation', () => {
    it('preserves snapshot and sequence info', () => {
      const writer = new PuffinWriter({ snapshotId: 999, sequenceNumber: 42 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const blob = reader.getBlobs()[0]

      expect(blob.snapshotId).toBe(999)
      expect(blob.sequenceNumber).toBe(42)
    })

    it('preserves blob properties', () => {
      const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']), { source: 'test' })

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      const blob = reader.getBlobs()[0]

      expect(blob.properties).toEqual({ source: 'test' })
    })

    it('preserves file properties', () => {
      const writer = new PuffinWriter({
        snapshotId: 1,
        sequenceNumber: 1,
        properties: { 'created-by': 'dotdo' },
      })
      writer.addBloomFilter(5, createBloomFilterFromValues(['test']))

      const bytes = writer.finish()
      const reader = PuffinReader.fromBytes(bytes)

      expect(reader.getProperties()).toEqual({ 'created-by': 'dotdo' })
    })
  })
})

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe('Convenience Functions', () => {
  describe('createBloomFilterFromValues', () => {
    it('creates filter with all values', () => {
      const values = ['a', 'b', 'c', 'd', 'e']
      const filter = createBloomFilterFromValues(values)

      for (const v of values) {
        expect(filter.mightContain(v)).toBe(true)
      }
    })

    it('accepts custom FPR', () => {
      const values = ['test']
      const loose = createBloomFilterFromValues(values, 0.1)
      const strict = createBloomFilterFromValues(values, 0.001)

      expect(strict.sizeBytes).toBeGreaterThan(loose.sizeBytes)
    })
  })

  describe('createNgramBloomFromValues', () => {
    it('creates filter supporting substring queries', () => {
      const values = ['hello@example.com.ai', 'world@test.org']
      const filter = createNgramBloomFromValues(values)

      expect(filter.mightContainSubstring('example')).toBe(true)
      expect(filter.mightContainSubstring('test')).toBe(true)
    })

    it('accepts custom n-gram size', () => {
      const values = ['test']
      const bigram = createNgramBloomFromValues(values, 2)
      const trigram = createNgramBloomFromValues(values, 3)

      // Both should work
      expect(bigram.mightContainSubstring('test')).toBe(true)
      expect(trigram.mightContainSubstring('test')).toBe(true)
    })
  })

  describe('createSetIndexFromValues', () => {
    it('creates index with all values', () => {
      const values = ['a', 'b', 'c']
      const index = createSetIndexFromValues(values)

      expect(index.size).toBe(3)
      for (const v of values) {
        expect(index.contains(v)).toBe(true)
      }
    })

    it('deduplicates values', () => {
      const values = ['a', 'b', 'a', 'c', 'b']
      const index = createSetIndexFromValues(values)

      expect(index.size).toBe(3)
    })
  })

  describe('estimateBloomFilterSize', () => {
    it('returns reasonable estimates', () => {
      expect(estimateBloomFilterSize(100)).toBeGreaterThan(100)
      expect(estimateBloomFilterSize(10000)).toBeGreaterThan(estimateBloomFilterSize(1000))
    })

    it('lower FPR means larger size', () => {
      const loose = estimateBloomFilterSize(1000, 0.1)
      const strict = estimateBloomFilterSize(1000, 0.001)

      expect(strict).toBeGreaterThan(loose)
    })
  })
})

// ============================================================================
// Integration / E2E Tests
// ============================================================================

describe('End-to-End Scenarios', () => {
  describe('Query pruning workflow', () => {
    it('can prune files for equality query (email lookup)', () => {
      // Scenario: We have 3 parquet files, each with emails
      // Query: WHERE email = 'john@example.com.ai'

      const file1Emails = ['alice@a.com', 'bob@b.com', 'carol@c.com']
      const file2Emails = ['dave@d.com', 'eve@e.com', 'frank@f.com']
      const file3Emails = ['john@example.com.ai', 'jane@example.com.ai'] // Target here!

      // Create Puffin sidecars for each file
      const puffin1 = createPuffinForFile(file1Emails, 1)
      const puffin2 = createPuffinForFile(file2Emails, 2)
      const puffin3 = createPuffinForFile(file3Emails, 3)

      // Query: can we prune?
      const targetEmail = 'john@example.com.ai'

      const reader1 = PuffinReader.fromBytes(puffin1)
      const reader2 = PuffinReader.fromBytes(puffin2)
      const reader3 = PuffinReader.fromBytes(puffin3)

      const bloom1 = reader1.extractBlob(reader1.findBlob('bloom-filter-v1')!, puffin1) as BloomFilter
      const bloom2 = reader2.extractBlob(reader2.findBlob('bloom-filter-v1')!, puffin2) as BloomFilter
      const bloom3 = reader3.extractBlob(reader3.findBlob('bloom-filter-v1')!, puffin3) as BloomFilter

      // File 1 and 2 should be pruned, file 3 should be kept
      expect(bloom1.mightContain(targetEmail)).toBe(false)
      expect(bloom2.mightContain(targetEmail)).toBe(false)
      expect(bloom3.mightContain(targetEmail)).toBe(true)
    })

    it('can prune files for LIKE query (substring search)', () => {
      // Scenario: WHERE email LIKE '%example%'

      const file1Emails = ['alice@a.com', 'bob@b.com']
      const file2Emails = ['john@example.com.ai', 'jane@example.org'] // Has 'example'
      const file3Emails = ['dave@other.net', 'eve@test.io']

      const puffin1 = createPuffinForLike(file1Emails, 1)
      const puffin2 = createPuffinForLike(file2Emails, 2)
      const puffin3 = createPuffinForLike(file3Emails, 3)

      const targetPattern = 'example'

      const reader1 = PuffinReader.fromBytes(puffin1)
      const reader2 = PuffinReader.fromBytes(puffin2)
      const reader3 = PuffinReader.fromBytes(puffin3)

      const ngram1 = reader1.extractBlob(
        reader1.findBlob('ngram-bloom-filter-v1')!,
        puffin1
      ) as NgramBloomFilter
      const ngram2 = reader2.extractBlob(
        reader2.findBlob('ngram-bloom-filter-v1')!,
        puffin2
      ) as NgramBloomFilter
      const ngram3 = reader3.extractBlob(
        reader3.findBlob('ngram-bloom-filter-v1')!,
        puffin3
      ) as NgramBloomFilter

      // File 1 and 3 should be pruned
      expect(ngram1.mightContainSubstring(targetPattern)).toBe(false)
      expect(ngram2.mightContainSubstring(targetPattern)).toBe(true)
      expect(ngram3.mightContainSubstring(targetPattern)).toBe(false)
    })

    it('can prune files for status filter (set index)', () => {
      // Scenario: WHERE status IN ('active', 'pending')

      const file1Statuses = ['active', 'pending'] // Matches
      const file2Statuses = ['closed', 'archived'] // No match
      const file3Statuses = ['active', 'closed'] // Partial match - keep

      const puffin1 = createPuffinForStatus(file1Statuses, 1)
      const puffin2 = createPuffinForStatus(file2Statuses, 2)
      const puffin3 = createPuffinForStatus(file3Statuses, 3)

      const targetStatuses = ['active', 'pending']

      const reader1 = PuffinReader.fromBytes(puffin1)
      const reader2 = PuffinReader.fromBytes(puffin2)
      const reader3 = PuffinReader.fromBytes(puffin3)

      const set1 = reader1.extractBlob(reader1.findBlob('set-index-v1')!, puffin1) as SetIndex
      const set2 = reader2.extractBlob(reader2.findBlob('set-index-v1')!, puffin2) as SetIndex
      const set3 = reader3.extractBlob(reader3.findBlob('set-index-v1')!, puffin3) as SetIndex

      // File 2 should be pruned (no matching statuses)
      expect(set1.containsAny(targetStatuses)).toBe(true)
      expect(set2.containsAny(targetStatuses)).toBe(false)
      expect(set3.containsAny(targetStatuses)).toBe(true)
    })
  })

  describe('Snippet-compatible access pattern', () => {
    it('supports two-request pattern: footer then blob', () => {
      // This simulates how a Cloudflare Snippet would access a Puffin file:
      // 1. Range request for footer
      // 2. Range request for specific blob

      const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })
      writer.addBloomFilter(5, createBloomFilterFromValues(['target@email.com', 'other@email.com']))
      writer.addSetIndex(6, createSetIndexFromValues(['active']))

      const fullFile = writer.finish()

      // Request 1: Fetch footer (last ~4KB or so)
      const footerRange = PuffinReader.getFooterRange(fullFile.length, 4096)
      const footerBytes = fullFile.slice(footerRange.start, footerRange.end)

      // Parse footer to get blob info
      const reader = PuffinReader.fromFooterBytes(footerBytes, fullFile.length)
      const bloomMeta = reader.findBlob('bloom-filter-v1', 5)!

      // Request 2: Fetch specific blob
      const blobRange = reader.getBlobRange(bloomMeta)
      const blobBytes = fullFile.slice(blobRange.start, blobRange.end)

      // Parse and use the bloom filter
      const bloom = reader.parseBlob(bloomMeta, blobBytes) as BloomFilter

      expect(bloom.mightContain('target@email.com')).toBe(true)
      expect(bloom.mightContain('not-in-filter@test.com')).toBe(false)
    })
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('bloom filter operations complete quickly', () => {
    const filter = new BloomFilter({ expectedElements: 100000 })

    // Add 10,000 items
    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      filter.add(`item-${i}`)
    }
    const addTime = performance.now() - start

    // Check 10,000 items
    const checkStart = performance.now()
    for (let i = 0; i < 10000; i++) {
      filter.mightContain(`check-${i}`)
    }
    const checkTime = performance.now() - checkStart

    expect(addTime).toBeLessThan(500) // 10k adds in < 500ms
    expect(checkTime).toBeLessThan(100) // 10k checks in < 100ms
  })

  it('puffin file parsing is fast', () => {
    // Create a Puffin file with multiple blobs
    const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })

    for (let i = 0; i < 10; i++) {
      writer.addBloomFilter(i, createBloomFilterFromValues([`field-${i}-value`]))
    }

    const bytes = writer.finish()

    // Parse should be < 1ms
    const start = performance.now()
    const reader = PuffinReader.fromBytes(bytes)
    const blobs = reader.getBlobs()
    const elapsed = performance.now() - start

    expect(blobs).toHaveLength(10)
    expect(elapsed).toBeLessThan(10) // < 10ms
  })

  it('blob lookup is O(n) but fast', () => {
    const writer = new PuffinWriter({ snapshotId: 1, sequenceNumber: 1 })

    // Add 100 blobs
    for (let i = 0; i < 100; i++) {
      writer.addBloomFilter(i, createBloomFilterFromValues([`value-${i}`]))
    }

    const bytes = writer.finish()
    const reader = PuffinReader.fromBytes(bytes)

    // Find specific blob should be fast
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      reader.findBlob('bloom-filter-v1', i)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(10) // 100 lookups in < 10ms
  })
})

// ============================================================================
// Helper Functions for Tests
// ============================================================================

function createPuffinForFile(emails: string[], snapshotId: number): Uint8Array {
  const writer = new PuffinWriter({ snapshotId, sequenceNumber: 1 })
  writer.addBloomFilter(5, createBloomFilterFromValues(emails))
  return writer.finish()
}

function createPuffinForLike(emails: string[], snapshotId: number): Uint8Array {
  const writer = new PuffinWriter({ snapshotId, sequenceNumber: 1 })
  writer.addNgramBloomFilter(5, createNgramBloomFromValues(emails))
  return writer.finish()
}

function createPuffinForStatus(statuses: string[], snapshotId: number): Uint8Array {
  const writer = new PuffinWriter({ snapshotId, sequenceNumber: 1 })
  writer.addSetIndex(6, createSetIndexFromValues(statuses))
  return writer.finish()
}
