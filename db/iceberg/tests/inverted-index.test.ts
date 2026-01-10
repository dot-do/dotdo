import { describe, it, expect } from 'vitest'

/**
 * Inverted Index Format Tests
 *
 * Tests for the compact binary inverted index implementation including:
 * - Varint encoding/decoding
 * - Posting list compression
 * - Index serialization and deserialization
 * - Term lookup with binary search
 * - Query operations (intersection, union, prefix search)
 * - Memory constraint verification
 *
 * @see db/iceberg/inverted-index.ts
 */

import {
  // Constants
  INVERTED_INDEX_MAGIC,
  INVERTED_INDEX_VERSION,
  HEADER_SIZE,
  MAX_TERM_LENGTH,

  // Varint functions
  encodeVarint,
  decodeVarint,
  varintSize,

  // Posting list functions
  encodePostingList,
  decodePostingList,

  // Classes
  InvertedIndexWriter,
  InvertedIndexReader,

  // Helper functions
  estimateInvertedIndexSize,
  simpleTokenize,
  createInvertedIndex,

  // Types
  type TermEntry,
} from '../inverted-index'

// ============================================================================
// Varint Encoding Tests
// ============================================================================

describe('Varint Encoding', () => {
  describe('encodeVarint', () => {
    it('encodes single byte values (0-127)', () => {
      expect(encodeVarint(0)).toEqual(new Uint8Array([0]))
      expect(encodeVarint(1)).toEqual(new Uint8Array([1]))
      expect(encodeVarint(127)).toEqual(new Uint8Array([127]))
    })

    it('encodes two byte values (128-16383)', () => {
      expect(encodeVarint(128)).toEqual(new Uint8Array([0x80, 0x01]))
      expect(encodeVarint(300)).toEqual(new Uint8Array([0xac, 0x02]))
      expect(encodeVarint(16383)).toEqual(new Uint8Array([0xff, 0x7f]))
    })

    it('encodes larger values', () => {
      expect(encodeVarint(16384)).toEqual(new Uint8Array([0x80, 0x80, 0x01]))
      expect(encodeVarint(1000000)).toEqual(new Uint8Array([0xc0, 0x84, 0x3d]))
    })

    it('throws on negative values', () => {
      expect(() => encodeVarint(-1)).toThrow()
    })
  })

  describe('decodeVarint', () => {
    it('decodes single byte values', () => {
      expect(decodeVarint(new Uint8Array([0]), 0)).toEqual([0, 1])
      expect(decodeVarint(new Uint8Array([127]), 0)).toEqual([127, 1])
    })

    it('decodes multi-byte values', () => {
      expect(decodeVarint(new Uint8Array([0x80, 0x01]), 0)).toEqual([128, 2])
      expect(decodeVarint(new Uint8Array([0xac, 0x02]), 0)).toEqual([300, 2])
    })

    it('decodes at offset', () => {
      const bytes = new Uint8Array([0x00, 0x00, 0xac, 0x02])
      expect(decodeVarint(bytes, 2)).toEqual([300, 2])
    })

    it('throws on truncated varint', () => {
      expect(() => decodeVarint(new Uint8Array([0x80]), 0)).toThrow()
    })
  })

  describe('varintSize', () => {
    it('returns correct sizes', () => {
      expect(varintSize(0)).toBe(1)
      expect(varintSize(127)).toBe(1)
      expect(varintSize(128)).toBe(2)
      expect(varintSize(16383)).toBe(2)
      expect(varintSize(16384)).toBe(3)
      expect(varintSize(1000000)).toBe(3)
    })
  })

  describe('roundtrip', () => {
    it('roundtrips correctly for various values', () => {
      const testValues = [0, 1, 127, 128, 255, 256, 16383, 16384, 1000000, 0x7fffffff]

      for (const value of testValues) {
        const encoded = encodeVarint(value)
        const [decoded, bytesRead] = decodeVarint(encoded, 0)
        expect(decoded).toBe(value)
        expect(bytesRead).toBe(encoded.length)
      }
    })
  })
})

// ============================================================================
// Posting List Tests
// ============================================================================

describe('Posting List Encoding', () => {
  describe('encodePostingList', () => {
    it('encodes empty list', () => {
      const encoded = encodePostingList([])
      expect(encoded).toEqual(encodeVarint(0))
    })

    it('encodes single element', () => {
      const encoded = encodePostingList([5])
      const decoded = decodePostingList(encoded)
      expect(decoded).toEqual([5])
    })

    it('encodes multiple elements', () => {
      const ids = [1, 5, 10, 100]
      const encoded = encodePostingList(ids)
      const decoded = decodePostingList(encoded)
      expect(decoded).toEqual(ids)
    })

    it('uses delta encoding for compression', () => {
      // Sequential IDs should compress well (all deltas = 1)
      const sequential = Array.from({ length: 100 }, (_, i) => i)
      const sequentialEncoded = encodePostingList(sequential)

      // Sparse IDs have larger deltas
      const sparse = Array.from({ length: 100 }, (_, i) => i * 1000)
      const sparseEncoded = encodePostingList(sparse)

      // Sequential should be smaller
      expect(sequentialEncoded.length).toBeLessThan(sparseEncoded.length)
    })
  })

  describe('decodePostingList', () => {
    it('decodes empty list', () => {
      expect(decodePostingList(encodeVarint(0))).toEqual([])
    })

    it('handles empty byte array', () => {
      expect(decodePostingList(new Uint8Array(0))).toEqual([])
    })
  })

  describe('roundtrip', () => {
    it('roundtrips various list sizes', () => {
      const testCases = [
        [],
        [0],
        [1],
        [100],
        [1, 2, 3],
        [0, 1, 2, 3, 4, 5],
        [10, 20, 30, 40, 50],
        [1, 100, 1000, 10000, 100000],
        Array.from({ length: 1000 }, (_, i) => i * 2),
      ]

      for (const ids of testCases) {
        const encoded = encodePostingList(ids)
        const decoded = decodePostingList(encoded)
        expect(decoded).toEqual(ids)
      }
    })
  })
})

// ============================================================================
// InvertedIndexWriter Tests
// ============================================================================

describe('InvertedIndexWriter', () => {
  describe('construction', () => {
    it('creates empty writer', () => {
      const writer = new InvertedIndexWriter()
      expect(writer.termCount).toBe(0)
      expect(writer.postingCount).toBe(0)
    })
  })

  describe('addPosting', () => {
    it('adds single posting', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      expect(writer.termCount).toBe(1)
      expect(writer.postingCount).toBe(1)
    })

    it('adds multiple postings for same term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 5)
      writer.addPosting('hello', 10)

      expect(writer.termCount).toBe(1)
      expect(writer.postingCount).toBe(3)
    })

    it('adds postings for different terms', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('world', 2)

      expect(writer.termCount).toBe(2)
      expect(writer.postingCount).toBe(2)
    })

    it('deduplicates same term-doc pair', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 1)

      expect(writer.termCount).toBe(1)
      expect(writer.postingCount).toBe(1)
    })

    it('skips empty terms', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('', 1)

      expect(writer.termCount).toBe(0)
    })

    it('skips terms exceeding max length', () => {
      const writer = new InvertedIndexWriter()
      const longTerm = 'a'.repeat(MAX_TERM_LENGTH + 1)
      writer.addPosting(longTerm, 1)

      expect(writer.termCount).toBe(0)
    })

    it('throws on invalid doc ID', () => {
      const writer = new InvertedIndexWriter()
      expect(() => writer.addPosting('hello', -1)).toThrow()
      expect(() => writer.addPosting('hello', 1.5)).toThrow()
    })
  })

  describe('addPostings', () => {
    it('adds multiple postings at once', () => {
      const writer = new InvertedIndexWriter()
      writer.addPostings([
        { term: 'hello', docId: 1 },
        { term: 'hello', docId: 2 },
        { term: 'world', docId: 1 },
      ])

      expect(writer.termCount).toBe(2)
      expect(writer.postingCount).toBe(3)
    })
  })

  describe('addDocument', () => {
    it('adds all terms from document', () => {
      const writer = new InvertedIndexWriter()
      writer.addDocument(1, ['hello', 'world', 'test'])

      expect(writer.termCount).toBe(3)
      expect(writer.postingCount).toBe(3)
    })

    it('deduplicates terms within document', () => {
      const writer = new InvertedIndexWriter()
      writer.addDocument(1, ['hello', 'hello', 'hello'])

      expect(writer.termCount).toBe(1)
      expect(writer.postingCount).toBe(1)
    })
  })

  describe('estimateSize', () => {
    it('estimates size for empty index', () => {
      const writer = new InvertedIndexWriter()
      const estimated = writer.estimateSize()

      // Header + end marker
      expect(estimated).toBe(HEADER_SIZE + 1)
    })

    it('estimates size increases with content', () => {
      const writer = new InvertedIndexWriter()
      const emptySize = writer.estimateSize()

      writer.addPosting('hello', 1)
      const withContent = writer.estimateSize()

      expect(withContent).toBeGreaterThan(emptySize)
    })

    it('estimate is close to actual size', () => {
      const writer = new InvertedIndexWriter()
      for (let i = 0; i < 100; i++) {
        writer.addPosting(`term${i}`, i)
        writer.addPosting(`term${i}`, i + 100)
      }

      const estimated = writer.estimateSize()
      const actual = writer.serialize().length

      // Should be within 10%
      expect(Math.abs(estimated - actual)).toBeLessThan(actual * 0.1)
    })
  })

  describe('fitsInMemory', () => {
    it('returns true for small index within default budget', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('test', 1)

      expect(writer.fitsInMemory()).toBe(true)
    })

    it('returns false when exceeding specified budget', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('test', 1)

      // A single posting index is at least HEADER_SIZE + term entry + posting list
      // ~16 + 1 + 4 + 8 + 1 + ~3 = ~33 bytes minimum
      expect(writer.fitsInMemory(10)).toBe(false)
    })
  })

  describe('serialize', () => {
    it('produces valid header', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('test', 1)
      const bytes = writer.serialize()

      // Check magic
      expect(bytes.slice(0, 4)).toEqual(INVERTED_INDEX_MAGIC)

      // Check version
      const view = new DataView(bytes.buffer)
      expect(view.getUint16(4, true)).toBe(INVERTED_INDEX_VERSION)

      // Check term count
      expect(view.getUint32(6, true)).toBe(1)
    })

    it('serializes empty index', () => {
      const writer = new InvertedIndexWriter()
      const bytes = writer.serialize()

      expect(bytes.length).toBe(HEADER_SIZE + 1) // Header + end marker
    })

    it('serializes multiple terms', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('apple', 1)
      writer.addPosting('banana', 2)
      writer.addPosting('cherry', 3)

      const bytes = writer.serialize()

      expect(bytes.length).toBeGreaterThan(HEADER_SIZE)
    })

    it('sorts terms lexicographically', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('zebra', 1)
      writer.addPosting('apple', 2)
      writer.addPosting('mango', 3)

      const bytes = writer.serialize()
      const reader = InvertedIndexReader.deserialize(bytes)

      const terms = reader.getTerms()
      expect(terms).toEqual(['apple', 'mango', 'zebra'])
    })
  })

  describe('clear', () => {
    it('clears all postings', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('world', 2)

      writer.clear()

      expect(writer.termCount).toBe(0)
      expect(writer.postingCount).toBe(0)
    })
  })
})

// ============================================================================
// InvertedIndexReader Tests
// ============================================================================

describe('InvertedIndexReader', () => {
  describe('parseHeader', () => {
    it('parses valid header', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('test', 1)
      const bytes = writer.serialize()

      const metadata = InvertedIndexReader.parseHeader(bytes)

      expect(metadata.version).toBe(INVERTED_INDEX_VERSION)
      expect(metadata.termCount).toBe(1)
      expect(metadata.flags).toBe(0)
    })

    it('throws on short header', () => {
      const bytes = new Uint8Array(10)
      expect(() => InvertedIndexReader.parseHeader(bytes)).toThrow('too short')
    })

    it('throws on invalid magic', () => {
      const bytes = new Uint8Array(HEADER_SIZE)
      bytes[0] = 0x00 // Wrong magic
      expect(() => InvertedIndexReader.parseHeader(bytes)).toThrow('magic mismatch')
    })
  })

  describe('deserialize', () => {
    it('deserializes empty index', () => {
      const writer = new InvertedIndexWriter()
      const bytes = writer.serialize()

      const reader = InvertedIndexReader.deserialize(bytes)

      expect(reader.termCount).toBe(0)
      expect(reader.getTerms()).toEqual([])
    })

    it('deserializes index with terms', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 5)
      writer.addPosting('world', 2)

      const bytes = writer.serialize()
      const reader = InvertedIndexReader.deserialize(bytes)

      expect(reader.termCount).toBe(2)
      expect(reader.getTerms()).toEqual(['hello', 'world'])
    })
  })

  describe('getMetadata', () => {
    it('returns metadata copy', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('test', 1)
      const reader = InvertedIndexReader.deserialize(writer.serialize())

      const metadata = reader.getMetadata()
      expect(metadata.termCount).toBe(1)
      expect(metadata.version).toBe(INVERTED_INDEX_VERSION)
    })
  })

  describe('hasTerm', () => {
    it('returns true for existing term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      const reader = InvertedIndexReader.deserialize(writer.serialize())

      expect(reader.hasTerm('hello')).toBe(true)
    })

    it('returns false for missing term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      const reader = InvertedIndexReader.deserialize(writer.serialize())

      expect(reader.hasTerm('world')).toBe(false)
    })
  })

  describe('getPostings', () => {
    it('returns posting list for existing term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 5)
      writer.addPosting('hello', 10)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const postings = reader.getPostings('hello')

      expect(postings).toEqual([1, 5, 10])
    })

    it('returns empty array for missing term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const postings = reader.getPostings('world')

      expect(postings).toEqual([])
    })

    it('returns sorted posting list', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 10)
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 5)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const postings = reader.getPostings('hello')

      expect(postings).toEqual([1, 5, 10])
    })
  })

  describe('getDocumentFrequency', () => {
    it('returns count of documents', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('common', 1)
      writer.addPosting('common', 2)
      writer.addPosting('common', 3)
      writer.addPosting('rare', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())

      expect(reader.getDocumentFrequency('common')).toBe(3)
      expect(reader.getDocumentFrequency('rare')).toBe(1)
      expect(reader.getDocumentFrequency('missing')).toBe(0)
    })
  })

  describe('getPostingListRange', () => {
    it('returns range for existing term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 2)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const range = reader.getPostingListRange('hello')

      expect(range).not.toBeNull()
      expect(range!.start).toBeGreaterThan(HEADER_SIZE)
      expect(range!.end).toBeGreaterThan(range!.start)
    })

    it('returns null for missing term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const range = reader.getPostingListRange('world')

      expect(range).toBeNull()
    })
  })

  describe('getTermIndexRange', () => {
    it('returns valid range', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('world', 2)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const range = reader.getTermIndexRange()

      expect(range.start).toBe(HEADER_SIZE)
      expect(range.end).toBeGreaterThan(range.start)
    })
  })

  describe('searchPrefix', () => {
    it('finds terms with prefix', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('apple', 1)
      writer.addPosting('application', 2)
      writer.addPosting('apply', 3)
      writer.addPosting('banana', 4)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const results = reader.searchPrefix('app')

      expect(results.map((r) => r.term)).toEqual(['apple', 'application', 'apply'])
    })

    it('returns empty for no matches', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('apple', 1)
      writer.addPosting('banana', 2)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const results = reader.searchPrefix('cherry')

      expect(results).toEqual([])
    })

    it('respects limit', () => {
      const writer = new InvertedIndexWriter()
      for (let i = 0; i < 100; i++) {
        writer.addPosting(`term${i.toString().padStart(3, '0')}`, i)
      }

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const results = reader.searchPrefix('term', 5)

      expect(results).toHaveLength(5)
    })
  })

  describe('intersect', () => {
    it('intersects posting lists (AND query)', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 2)
      writer.addPosting('hello', 3)
      writer.addPosting('world', 2)
      writer.addPosting('world', 3)
      writer.addPosting('world', 4)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.intersect(['hello', 'world'])

      expect(result).toEqual([2, 3])
    })

    it('returns empty when no intersection', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('world', 2)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.intersect(['hello', 'world'])

      expect(result).toEqual([])
    })

    it('returns empty when term is missing', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.intersect(['hello', 'missing'])

      expect(result).toEqual([])
    })

    it('returns empty for empty input', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.intersect([])

      expect(result).toEqual([])
    })

    it('handles single term', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 2)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.intersect(['hello'])

      expect(result).toEqual([1, 2])
    })
  })

  describe('union', () => {
    it('unions posting lists (OR query)', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)
      writer.addPosting('hello', 2)
      writer.addPosting('world', 2)
      writer.addPosting('world', 3)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.union(['hello', 'world'])

      expect(result).toEqual([1, 2, 3])
    })

    it('handles missing terms', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.union(['hello', 'missing'])

      expect(result).toEqual([1])
    })

    it('returns empty for empty input', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.union([])

      expect(result).toEqual([])
    })

    it('handles all missing terms', () => {
      const writer = new InvertedIndexWriter()
      writer.addPosting('hello', 1)

      const reader = InvertedIndexReader.deserialize(writer.serialize())
      const result = reader.union(['missing1', 'missing2'])

      expect(result).toEqual([])
    })
  })

  describe('findTerm (binary search)', () => {
    it('finds term in sorted index', () => {
      const termIndex: TermEntry[] = [
        { term: 'apple', offset: 100, length: 10 },
        { term: 'banana', offset: 110, length: 10 },
        { term: 'cherry', offset: 120, length: 10 },
      ]

      expect(InvertedIndexReader.findTerm(termIndex, 'apple')?.term).toBe('apple')
      expect(InvertedIndexReader.findTerm(termIndex, 'banana')?.term).toBe('banana')
      expect(InvertedIndexReader.findTerm(termIndex, 'cherry')?.term).toBe('cherry')
    })

    it('returns null for missing term', () => {
      const termIndex: TermEntry[] = [
        { term: 'apple', offset: 100, length: 10 },
        { term: 'cherry', offset: 120, length: 10 },
      ]

      expect(InvertedIndexReader.findTerm(termIndex, 'banana')).toBeNull()
    })

    it('handles empty index', () => {
      expect(InvertedIndexReader.findTerm([], 'test')).toBeNull()
    })

    it('handles single element', () => {
      const termIndex: TermEntry[] = [{ term: 'apple', offset: 100, length: 10 }]

      expect(InvertedIndexReader.findTerm(termIndex, 'apple')?.term).toBe('apple')
      expect(InvertedIndexReader.findTerm(termIndex, 'banana')).toBeNull()
    })
  })
})

// ============================================================================
// Roundtrip Tests
// ============================================================================

describe('Roundtrip', () => {
  it('preserves all data through serialize/deserialize', () => {
    const writer = new InvertedIndexWriter()

    // Add various postings
    writer.addPosting('apple', 1)
    writer.addPosting('apple', 5)
    writer.addPosting('apple', 100)
    writer.addPosting('banana', 2)
    writer.addPosting('cherry', 3)
    writer.addPosting('cherry', 4)

    const bytes = writer.serialize()
    const reader = InvertedIndexReader.deserialize(bytes)

    expect(reader.termCount).toBe(3)
    expect(reader.getPostings('apple')).toEqual([1, 5, 100])
    expect(reader.getPostings('banana')).toEqual([2])
    expect(reader.getPostings('cherry')).toEqual([3, 4])
  })

  it('handles large posting lists', () => {
    const writer = new InvertedIndexWriter()

    // Add 1000 documents to a single term
    for (let i = 0; i < 1000; i++) {
      writer.addPosting('popular', i)
    }

    const bytes = writer.serialize()
    const reader = InvertedIndexReader.deserialize(bytes)

    const postings = reader.getPostings('popular')
    expect(postings).toHaveLength(1000)
    expect(postings[0]).toBe(0)
    expect(postings[999]).toBe(999)
  })

  it('handles many terms', () => {
    const writer = new InvertedIndexWriter()

    // Add 1000 unique terms
    for (let i = 0; i < 1000; i++) {
      writer.addPosting(`term${i.toString().padStart(4, '0')}`, i)
    }

    const bytes = writer.serialize()
    const reader = InvertedIndexReader.deserialize(bytes)

    expect(reader.termCount).toBe(1000)

    // Verify random terms
    expect(reader.getPostings('term0000')).toEqual([0])
    expect(reader.getPostings('term0500')).toEqual([500])
    expect(reader.getPostings('term0999')).toEqual([999])
  })

  it('handles unicode terms', () => {
    const writer = new InvertedIndexWriter()

    writer.addPosting('cafe', 1)
    writer.addPosting('hello', 2)
    writer.addPosting('world', 3)

    const bytes = writer.serialize()
    const reader = InvertedIndexReader.deserialize(bytes)

    expect(reader.hasTerm('cafe')).toBe(true)
    expect(reader.hasTerm('hello')).toBe(true)
    expect(reader.getPostings('cafe')).toEqual([1])
  })
})

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('Helper Functions', () => {
  describe('estimateInvertedIndexSize', () => {
    it('estimates size for given parameters', () => {
      const size = estimateInvertedIndexSize(1000, 8, 10, 10)

      expect(size).toBeGreaterThan(HEADER_SIZE)
      expect(size).toBeLessThan(100000) // Reasonable upper bound
    })

    it('scales with term count', () => {
      const small = estimateInvertedIndexSize(100)
      const large = estimateInvertedIndexSize(10000)

      expect(large).toBeGreaterThan(small)
    })

    it('scales with postings per term', () => {
      const sparse = estimateInvertedIndexSize(1000, 8, 1)
      const dense = estimateInvertedIndexSize(1000, 8, 100)

      expect(dense).toBeGreaterThan(sparse)
    })
  })

  describe('simpleTokenize', () => {
    it('tokenizes text to lowercase', () => {
      expect(simpleTokenize('Hello World')).toEqual(['hello', 'world'])
    })

    it('removes punctuation', () => {
      expect(simpleTokenize('Hello, World!')).toEqual(['hello', 'world'])
    })

    it('handles numbers', () => {
      expect(simpleTokenize('test123 abc456')).toEqual(['test123', 'abc456'])
    })

    it('handles empty string', () => {
      expect(simpleTokenize('')).toEqual([])
    })

    it('handles only punctuation', () => {
      expect(simpleTokenize('!@#$%')).toEqual([])
    })
  })

  describe('createInvertedIndex', () => {
    it('creates index from Map', () => {
      const docs = new Map([
        [1, 'hello world'],
        [2, 'hello test'],
        [3, 'world test'],
      ])

      const bytes = createInvertedIndex(docs)
      const reader = InvertedIndexReader.deserialize(bytes)

      expect(reader.getPostings('hello')).toEqual([1, 2])
      expect(reader.getPostings('world')).toEqual([1, 3])
      expect(reader.getPostings('test')).toEqual([2, 3])
    })

    it('creates index from array', () => {
      const docs: Array<[number, string]> = [
        [1, 'hello world'],
        [2, 'hello test'],
      ]

      const bytes = createInvertedIndex(docs)
      const reader = InvertedIndexReader.deserialize(bytes)

      expect(reader.getPostings('hello')).toEqual([1, 2])
    })

    it('accepts custom tokenizer', () => {
      const docs = new Map([[1, 'Hello World']])

      // Custom tokenizer that preserves case
      const customTokenizer = (text: string) => text.split(' ')

      const bytes = createInvertedIndex(docs, customTokenizer)
      const reader = InvertedIndexReader.deserialize(bytes)

      expect(reader.hasTerm('Hello')).toBe(true)
      expect(reader.hasTerm('hello')).toBe(false)
    })
  })
})

// ============================================================================
// Memory Constraint Tests
// ============================================================================

describe('Memory Constraints', () => {
  it('stays within 2MB for typical use case', () => {
    const writer = new InvertedIndexWriter()

    // Simulate 10,000 documents with ~50 unique terms each
    // Total: ~50,000 postings
    const termPool = Array.from({ length: 5000 }, (_, i) => `term${i}`)

    for (let docId = 0; docId < 10000; docId++) {
      // Each doc has ~10 random terms
      for (let j = 0; j < 10; j++) {
        const term = termPool[Math.floor(Math.random() * termPool.length)]
        writer.addPosting(term, docId)
      }
    }

    const size = writer.estimateSize()
    const actualSize = writer.serialize().length

    // Should be well under 2MB
    expect(size).toBeLessThan(2 * 1024 * 1024)
    expect(actualSize).toBeLessThan(2 * 1024 * 1024)

    // And fit in memory check should pass
    expect(writer.fitsInMemory()).toBe(true)
  })

  it('correctly reports when exceeding memory budget', () => {
    const writer = new InvertedIndexWriter()

    // Add enough data to exceed 1KB
    for (let i = 0; i < 100; i++) {
      writer.addPosting(`longtermname${i}`, i)
    }

    expect(writer.fitsInMemory(1024)).toBe(false)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('serializes 10K terms quickly', () => {
    const writer = new InvertedIndexWriter()

    for (let i = 0; i < 10000; i++) {
      writer.addPosting(`term${i}`, i)
      writer.addPosting(`term${i}`, i + 10000)
    }

    const start = performance.now()
    const bytes = writer.serialize()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500) // < 500ms
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('deserializes 10K terms quickly', () => {
    const writer = new InvertedIndexWriter()

    for (let i = 0; i < 10000; i++) {
      writer.addPosting(`term${i}`, i)
    }

    const bytes = writer.serialize()

    const start = performance.now()
    const reader = InvertedIndexReader.deserialize(bytes)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100) // < 100ms
    expect(reader.termCount).toBe(10000)
  })

  it('binary search is O(log n)', () => {
    const writer = new InvertedIndexWriter()

    for (let i = 0; i < 10000; i++) {
      writer.addPosting(`term${i.toString().padStart(5, '0')}`, i)
    }

    const reader = InvertedIndexReader.deserialize(writer.serialize())

    // 10,000 lookups should be fast due to binary search
    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      reader.hasTerm(`term${(i % 10000).toString().padStart(5, '0')}`)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(50) // < 50ms for 10K lookups
  })

  it('posting list retrieval is fast', () => {
    const writer = new InvertedIndexWriter()

    // Create term with large posting list
    for (let i = 0; i < 10000; i++) {
      writer.addPosting('popular', i)
    }

    const reader = InvertedIndexReader.deserialize(writer.serialize())

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      reader.getPostings('popular')
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100) // < 100ms for 1K retrievals
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles term at max length', () => {
    const writer = new InvertedIndexWriter()
    const maxTerm = 'a'.repeat(MAX_TERM_LENGTH)

    writer.addPosting(maxTerm, 1)

    const reader = InvertedIndexReader.deserialize(writer.serialize())
    expect(reader.hasTerm(maxTerm)).toBe(true)
  })

  it('handles doc ID 0', () => {
    const writer = new InvertedIndexWriter()
    writer.addPosting('test', 0)

    const reader = InvertedIndexReader.deserialize(writer.serialize())
    expect(reader.getPostings('test')).toEqual([0])
  })

  it('handles large doc IDs', () => {
    const writer = new InvertedIndexWriter()
    writer.addPosting('test', 1000000)

    const reader = InvertedIndexReader.deserialize(writer.serialize())
    expect(reader.getPostings('test')).toEqual([1000000])
  })

  it('handles consecutive doc IDs efficiently', () => {
    const writer = new InvertedIndexWriter()

    // Consecutive IDs should compress well
    for (let i = 0; i < 1000; i++) {
      writer.addPosting('sequential', i)
    }

    const bytes = writer.serialize()

    // Size should be compact due to delta encoding
    // 1000 sequential IDs: count (2 bytes) + 1000 * 1 byte = ~1002 bytes
    // Plus overhead for term index
    expect(bytes.length).toBeLessThan(1200)
  })

  it('handles special characters in terms', () => {
    const writer = new InvertedIndexWriter()

    writer.addPosting('test-term', 1)
    writer.addPosting('test_term', 2)
    writer.addPosting('test.term', 3)

    const reader = InvertedIndexReader.deserialize(writer.serialize())

    expect(reader.hasTerm('test-term')).toBe(true)
    expect(reader.hasTerm('test_term')).toBe(true)
    expect(reader.hasTerm('test.term')).toBe(true)
  })
})

// ============================================================================
// Range Request Pattern Tests (for Cloudflare Snippets)
// ============================================================================

describe('Range Request Patterns', () => {
  it('supports two-request pattern: header + term index, then posting list', () => {
    const writer = new InvertedIndexWriter()
    writer.addPosting('hello', 1)
    writer.addPosting('hello', 2)
    writer.addPosting('world', 3)

    const fullFile = writer.serialize()

    // Request 1: Fetch header
    const headerBytes = fullFile.slice(0, HEADER_SIZE)
    const metadata = InvertedIndexReader.parseHeader(headerBytes)
    expect(metadata.termCount).toBe(2)

    // Request 2: Fetch term index based on header info
    // For simplicity, we need the full file to parse term index here
    // In practice, you'd fetch bytes from HEADER_SIZE to first posting list offset
    const reader = InvertedIndexReader.deserialize(fullFile)
    const termIndexRange = reader.getTermIndexRange()

    expect(termIndexRange.start).toBe(HEADER_SIZE)
    expect(termIndexRange.end).toBeGreaterThan(termIndexRange.start)

    // Request 3: Fetch specific posting list
    const postingRange = reader.getPostingListRange('hello')
    expect(postingRange).not.toBeNull()

    const postingBytes = fullFile.slice(postingRange!.start, postingRange!.end)
    const postings = InvertedIndexReader.parsePostingList(postingBytes)

    expect(postings).toEqual([1, 2])
  })

  it('demonstrates efficient partial loading', () => {
    const writer = new InvertedIndexWriter()

    // Create index with many terms
    for (let i = 0; i < 1000; i++) {
      writer.addPosting(`term${i.toString().padStart(4, '0')}`, i)
      writer.addPosting(`term${i.toString().padStart(4, '0')}`, i + 1000)
    }

    const fullFile = writer.serialize()
    const reader = InvertedIndexReader.deserialize(fullFile)

    // Get range for a specific term's posting list
    const range = reader.getPostingListRange('term0500')!

    // The posting list is much smaller than the full file
    const postingListSize = range.end - range.start
    expect(postingListSize).toBeLessThan(fullFile.length * 0.01) // < 1% of file

    // Can parse just that portion
    const postingBytes = fullFile.slice(range.start, range.end)
    const postings = InvertedIndexReader.parsePostingList(postingBytes)

    expect(postings).toEqual([500, 1500])
  })
})
