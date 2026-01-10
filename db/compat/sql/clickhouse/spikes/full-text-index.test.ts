/**
 * SPIKE TEST: GIN Full-Text Index with BM25 Scoring and R2 Streaming
 *
 * Tests for:
 * - Roaring bitmap operations
 * - BM25 scoring calculations
 * - Index building and serialization
 * - Streaming from mock R2
 * - Multi-term AND queries
 * - Ranking quality
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Classes
  FullTextIndex,
  RoaringBitmap,

  // Encoding functions
  encodeVarint,
  decodeVarint,
  varintSize,
  encodePostingsWithTF,
  decodePostingsWithTF,

  // Tokenization
  tokenize,
  tokenizeWithFrequencies,

  // BM25
  calculateIDF,
  calculateBM25Score,
  BM25_K1,
  BM25_B,

  // Factory functions
  createFullTextIndex,
  loadFullTextIndex,

  // Types
  type SearchResult,
  type PostingEntry,
  type RangeFetcher,
} from './full-text-index'

// ============================================================================
// Roaring Bitmap Tests
// ============================================================================

describe('RoaringBitmap', () => {
  describe('basic operations', () => {
    it('adds and contains values', () => {
      const bitmap = new RoaringBitmap()
      bitmap.add(1)
      bitmap.add(100)
      bitmap.add(10000)

      expect(bitmap.contains(1)).toBe(true)
      expect(bitmap.contains(100)).toBe(true)
      expect(bitmap.contains(10000)).toBe(true)
      expect(bitmap.contains(2)).toBe(false)
    })

    it('handles large values correctly', () => {
      const bitmap = new RoaringBitmap()
      bitmap.add(0)
      bitmap.add(65535)
      bitmap.add(65536) // New container
      bitmap.add(1000000)

      expect(bitmap.contains(0)).toBe(true)
      expect(bitmap.contains(65535)).toBe(true)
      expect(bitmap.contains(65536)).toBe(true)
      expect(bitmap.contains(1000000)).toBe(true)
    })

    it('returns correct cardinality', () => {
      const bitmap = new RoaringBitmap()
      expect(bitmap.cardinality).toBe(0)

      bitmap.add(1)
      bitmap.add(2)
      bitmap.add(3)
      expect(bitmap.cardinality).toBe(3)

      // Duplicate add should not increase cardinality
      bitmap.add(1)
      expect(bitmap.cardinality).toBe(3)
    })

    it('converts to array correctly', () => {
      const bitmap = new RoaringBitmap()
      bitmap.add(5)
      bitmap.add(1)
      bitmap.add(3)
      bitmap.add(100)

      expect(bitmap.toArray()).toEqual([1, 3, 5, 100])
    })
  })

  describe('set operations', () => {
    it('performs AND (intersection)', () => {
      const a = new RoaringBitmap()
      a.add(1)
      a.add(2)
      a.add(3)

      const b = new RoaringBitmap()
      b.add(2)
      b.add(3)
      b.add(4)

      const result = a.and(b)
      expect(result.toArray()).toEqual([2, 3])
    })

    it('performs OR (union)', () => {
      const a = new RoaringBitmap()
      a.add(1)
      a.add(2)

      const b = new RoaringBitmap()
      b.add(2)
      b.add(3)

      const result = a.or(b)
      expect(result.toArray()).toEqual([1, 2, 3])
    })

    it('handles empty intersection', () => {
      const a = new RoaringBitmap()
      a.add(1)
      a.add(2)

      const b = new RoaringBitmap()
      b.add(3)
      b.add(4)

      const result = a.and(b)
      expect(result.cardinality).toBe(0)
    })

    it('handles cross-container operations', () => {
      const a = new RoaringBitmap()
      a.add(1) // Container 0
      a.add(65537) // Container 1

      const b = new RoaringBitmap()
      b.add(1) // Container 0
      b.add(65538) // Container 1

      const intersection = a.and(b)
      expect(intersection.toArray()).toEqual([1])

      const union = a.or(b)
      expect(union.toArray()).toEqual([1, 65537, 65538])
    })
  })

  describe('serialization', () => {
    it('roundtrips small bitmap', () => {
      const original = new RoaringBitmap()
      original.add(1)
      original.add(5)
      original.add(100)

      const bytes = original.serialize()
      const restored = RoaringBitmap.deserialize(bytes)

      expect(restored.toArray()).toEqual(original.toArray())
    })

    it('roundtrips large bitmap with multiple containers', () => {
      const original = new RoaringBitmap()
      for (let i = 0; i < 1000; i++) {
        original.add(i * 100)
      }

      const bytes = original.serialize()
      const restored = RoaringBitmap.deserialize(bytes)

      expect(restored.cardinality).toBe(original.cardinality)
      expect(restored.toArray()).toEqual(original.toArray())
    })

    it('handles bitmap container (dense data)', () => {
      const original = new RoaringBitmap()
      // Add enough values to trigger bitmap container conversion
      for (let i = 0; i < 5000; i++) {
        original.add(i)
      }

      const bytes = original.serialize()
      const restored = RoaringBitmap.deserialize(bytes)

      expect(restored.cardinality).toBe(5000)
    })
  })
})

// ============================================================================
// Varint Encoding Tests
// ============================================================================

describe('Varint Encoding', () => {
  describe('encodeVarint', () => {
    it('encodes single byte values', () => {
      expect(encodeVarint(0)).toEqual(new Uint8Array([0]))
      expect(encodeVarint(127)).toEqual(new Uint8Array([127]))
    })

    it('encodes multi-byte values', () => {
      expect(encodeVarint(128)).toEqual(new Uint8Array([0x80, 0x01]))
      expect(encodeVarint(300)).toEqual(new Uint8Array([0xac, 0x02]))
    })

    it('throws on negative values', () => {
      expect(() => encodeVarint(-1)).toThrow()
    })
  })

  describe('decodeVarint', () => {
    it('decodes at offset', () => {
      const bytes = new Uint8Array([0x00, 0x00, 0xac, 0x02])
      expect(decodeVarint(bytes, 2)).toEqual([300, 2])
    })
  })

  describe('varintSize', () => {
    it('returns correct sizes', () => {
      expect(varintSize(0)).toBe(1)
      expect(varintSize(127)).toBe(1)
      expect(varintSize(128)).toBe(2)
      expect(varintSize(16384)).toBe(3)
    })
  })

  describe('roundtrip', () => {
    it('roundtrips various values', () => {
      const values = [0, 1, 127, 128, 16383, 16384, 1000000]
      for (const v of values) {
        const encoded = encodeVarint(v)
        const [decoded] = decodeVarint(encoded, 0)
        expect(decoded).toBe(v)
      }
    })
  })
})

// ============================================================================
// Posting List Encoding Tests
// ============================================================================

describe('Posting List Encoding', () => {
  describe('encodePostingsWithTF', () => {
    it('encodes empty list', () => {
      const encoded = encodePostingsWithTF([])
      const decoded = decodePostingsWithTF(encoded)
      expect(decoded).toEqual([])
    })

    it('encodes single posting', () => {
      const postings: PostingEntry[] = [{ docId: 5, tf: 3 }]
      const encoded = encodePostingsWithTF(postings)
      const decoded = decodePostingsWithTF(encoded)
      expect(decoded).toEqual(postings)
    })

    it('encodes multiple postings with delta encoding', () => {
      const postings: PostingEntry[] = [
        { docId: 1, tf: 2 },
        { docId: 5, tf: 1 },
        { docId: 10, tf: 4 },
      ]
      const encoded = encodePostingsWithTF(postings)
      const decoded = decodePostingsWithTF(encoded)
      expect(decoded).toEqual(postings)
    })

    it('handles unsorted input (sorts automatically)', () => {
      const postings: PostingEntry[] = [
        { docId: 10, tf: 1 },
        { docId: 1, tf: 2 },
        { docId: 5, tf: 3 },
      ]
      const encoded = encodePostingsWithTF(postings)
      const decoded = decodePostingsWithTF(encoded)
      expect(decoded).toEqual([
        { docId: 1, tf: 2 },
        { docId: 5, tf: 3 },
        { docId: 10, tf: 1 },
      ])
    })
  })
})

// ============================================================================
// Tokenization Tests
// ============================================================================

describe('Tokenization', () => {
  describe('tokenize', () => {
    it('splits text into lowercase tokens', () => {
      expect(tokenize('Hello World')).toEqual(['hello', 'world'])
    })

    it('removes punctuation', () => {
      expect(tokenize('Hello, World!')).toEqual(['hello', 'world'])
    })

    it('handles numbers', () => {
      expect(tokenize('test123 abc456')).toEqual(['test123', 'abc456'])
    })

    it('handles empty string', () => {
      expect(tokenize('')).toEqual([])
    })
  })

  describe('tokenizeWithFrequencies', () => {
    it('counts term frequencies', () => {
      const freqs = tokenizeWithFrequencies('hello world hello')
      expect(freqs.get('hello')).toBe(2)
      expect(freqs.get('world')).toBe(1)
    })

    it('normalizes to lowercase', () => {
      const freqs = tokenizeWithFrequencies('Hello HELLO hello')
      expect(freqs.get('hello')).toBe(3)
    })
  })
})

// ============================================================================
// BM25 Scoring Tests
// ============================================================================

describe('BM25 Scoring', () => {
  describe('calculateIDF', () => {
    it('returns positive value for rare terms', () => {
      // Term in 1 of 1000 docs
      const idf = calculateIDF(1000, 1)
      expect(idf).toBeGreaterThan(0)
    })

    it('returns lower value for common terms', () => {
      // Term in 500 of 1000 docs
      const commonIDF = calculateIDF(1000, 500)
      const rareIDF = calculateIDF(1000, 1)
      expect(commonIDF).toBeLessThan(rareIDF)
    })

    it('returns positive value even for very common terms (BM25+)', () => {
      // Term in 900 of 1000 docs - BM25+ variant always returns positive IDF
      const idf = calculateIDF(1000, 900)
      expect(idf).toBeGreaterThan(0)
    })

    it('returns positive value even when term appears in all docs', () => {
      // Term in all 100 docs
      const idf = calculateIDF(100, 100)
      expect(idf).toBeGreaterThan(0)
    })
  })

  describe('calculateBM25Score', () => {
    it('returns higher score for higher term frequency', () => {
      const idf = calculateIDF(1000, 10)
      const score1 = calculateBM25Score(1, 100, 100, idf)
      const score2 = calculateBM25Score(5, 100, 100, idf)
      expect(score2).toBeGreaterThan(score1)
    })

    it('applies length normalization', () => {
      const idf = calculateIDF(1000, 10)
      // Same TF but shorter doc should score higher
      const shortDoc = calculateBM25Score(2, 50, 100, idf)
      const longDoc = calculateBM25Score(2, 200, 100, idf)
      expect(shortDoc).toBeGreaterThan(longDoc)
    })

    it('uses default k1 and b values', () => {
      const idf = calculateIDF(1000, 10)
      const score = calculateBM25Score(2, 100, 100, idf)
      const scoreWithParams = calculateBM25Score(2, 100, 100, idf, BM25_K1, BM25_B)
      expect(score).toBe(scoreWithParams)
    })
  })
})

// ============================================================================
// FullTextIndex Tests
// ============================================================================

describe('FullTextIndex', () => {
  let index: FullTextIndex

  beforeEach(() => {
    index = new FullTextIndex()
  })

  describe('indexing', () => {
    it('adds documents', () => {
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')

      expect(index.documentCount).toBe(2)
    })

    it('counts unique terms', () => {
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')

      expect(index.termCount).toBe(3) // hello, world, there
    })

    it('updates existing document', () => {
      index.add('doc1', 'hello world')
      index.add('doc1', 'goodbye world')

      expect(index.documentCount).toBe(1)
      expect(index.hasTerm('goodbye')).toBe(true)
      expect(index.hasTerm('hello')).toBe(false)
    })

    it('removes documents', () => {
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')

      const removed = index.remove('doc1')

      expect(removed).toBe(true)
      expect(index.documentCount).toBe(1)
    })

    it('tracks document lengths', () => {
      index.add('doc1', 'hello world foo bar')
      index.add('doc2', 'hello')

      const stats = index.getStats()
      expect(stats.totalDocs).toBe(2)
      expect(stats.totalLength).toBe(5) // 4 + 1
      expect(stats.avgDocLength).toBe(2.5)
    })
  })

  describe('search', () => {
    beforeEach(() => {
      index.add('doc1', 'the quick brown fox')
      index.add('doc2', 'the lazy brown dog')
      index.add('doc3', 'quick quick quick fox')
    })

    it('finds documents with single term', () => {
      const results = index.search('fox')
      expect(results).toContain('doc1')
      expect(results).toContain('doc3')
      expect(results).not.toContain('doc2')
    })

    it('performs AND query for multiple terms', () => {
      const results = index.search('brown dog')
      expect(results).toEqual(['doc2'])
    })

    it('returns empty for missing terms', () => {
      const results = index.search('elephant')
      expect(results).toEqual([])
    })

    it('returns empty when any term is missing (AND)', () => {
      const results = index.search('fox elephant')
      expect(results).toEqual([])
    })
  })

  describe('searchWithScores', () => {
    beforeEach(() => {
      index.add('doc1', 'machine learning is great')
      index.add('doc2', 'machine learning machine learning rocks')
      index.add('doc3', 'deep learning is also great')
    })

    it('ranks by BM25 score', () => {
      const results = index.searchWithScores('machine learning')

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('doc2') // Higher TF for "machine"
      expect(results[1].id).toBe('doc1')
    })

    it('includes scores in results', () => {
      const results = index.searchWithScores('learning')

      for (const result of results) {
        expect(result.score).toBeGreaterThan(0)
      }
    })

    it('returns higher score for more relevant documents', () => {
      // doc2 has "machine" 2x, doc1 has it 1x
      const results = index.searchWithScores('machine')

      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })
})

// ============================================================================
// Serialization Tests
// ============================================================================

describe('Serialization', () => {
  it('serializes and deserializes dictionary', async () => {
    const original = new FullTextIndex()
    original.add('doc1', 'hello world')
    original.add('doc2', 'hello there')

    const dictBytes = original.serializeDictionary()
    const postingsBytes = original.serializePostings()

    const restored = new FullTextIndex()
    await restored.loadDictionary(dictBytes)
    restored.loadPostings(postingsBytes)

    expect(restored.documentCount).toBe(2)
    expect(restored.hasTerm('hello')).toBe(true)
    expect(restored.hasTerm('world')).toBe(true)
    expect(restored.hasTerm('there')).toBe(true)
  })

  it('preserves search functionality after roundtrip', async () => {
    const original = new FullTextIndex()
    original.add('doc1', 'the quick brown fox')
    original.add('doc2', 'the lazy brown dog')
    original.add('doc3', 'quick fox jumps')

    const dictBytes = original.serializeDictionary()
    const postingsBytes = original.serializePostings()

    const restored = new FullTextIndex()
    await restored.loadDictionary(dictBytes)
    restored.loadPostings(postingsBytes)

    const results = restored.searchInMemory('quick fox')
    expect(results.map((r) => r.id).sort()).toEqual(['doc1', 'doc3'])
  })

  it('preserves BM25 scoring after roundtrip', async () => {
    const original = new FullTextIndex()
    original.add('doc1', 'machine learning')
    original.add('doc2', 'machine machine learning')

    const originalResults = original.searchWithScores('machine')

    const dictBytes = original.serializeDictionary()
    const postingsBytes = original.serializePostings()

    const restored = new FullTextIndex()
    await restored.loadDictionary(dictBytes)
    restored.loadPostings(postingsBytes)

    const restoredResults = restored.searchInMemory('machine')

    expect(restoredResults[0].id).toBe(originalResults[0].id)
    // Scores should be approximately equal (may have minor floating point differences)
    expect(Math.abs(restoredResults[0].score - originalResults[0].score)).toBeLessThan(0.001)
  })
})

// ============================================================================
// R2 Streaming Tests
// ============================================================================

describe('R2 Streaming', () => {
  let dictBytes: Uint8Array
  let postingsBytes: Uint8Array

  beforeEach(() => {
    const index = new FullTextIndex()
    index.add('doc1', 'the quick brown fox jumps over the lazy dog')
    index.add('doc2', 'a quick brown dog runs in the park')
    index.add('doc3', 'the lazy cat sleeps all day')
    index.add('doc4', 'quick quick quick is the name of the game')

    dictBytes = index.serializeDictionary()
    postingsBytes = index.serializePostings()
  })

  it('searches with streaming fetch', async () => {
    // Create mock R2 fetcher
    const mockFetch: RangeFetcher = async (offset: number, length: number) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new FullTextIndex()
    await index.loadDictionary(dictBytes)

    const results = await index.searchStreaming('quick', mockFetch)

    expect(results.length).toBe(3)
    expect(results.map((r) => r.id)).toContain('doc1')
    expect(results.map((r) => r.id)).toContain('doc2')
    expect(results.map((r) => r.id)).toContain('doc4')
  })

  it('ranks streaming results by BM25', async () => {
    const mockFetch: RangeFetcher = async (offset: number, length: number) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new FullTextIndex()
    await index.loadDictionary(dictBytes)

    const results = await index.searchStreaming('quick', mockFetch)

    // doc4 has "quick" 3x, should rank highest
    expect(results[0].id).toBe('doc4')
  })

  it('performs AND query with streaming', async () => {
    const mockFetch: RangeFetcher = async (offset: number, length: number) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new FullTextIndex()
    await index.loadDictionary(dictBytes)

    const results = await index.searchStreaming('quick brown', mockFetch)

    // Only doc1 and doc2 have both "quick" and "brown"
    expect(results.length).toBe(2)
    expect(results.map((r) => r.id).sort()).toEqual(['doc1', 'doc2'])
  })

  it('returns empty for missing terms with streaming', async () => {
    const mockFetch: RangeFetcher = async (offset: number, length: number) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new FullTextIndex()
    await index.loadDictionary(dictBytes)

    const results = await index.searchStreaming('elephant', mockFetch)
    expect(results).toEqual([])
  })

  it('tracks fetch count for efficiency analysis', async () => {
    let fetchCount = 0
    const mockFetch: RangeFetcher = async (offset: number, length: number) => {
      fetchCount++
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new FullTextIndex()
    await index.loadDictionary(dictBytes)

    await index.searchStreaming('quick brown', mockFetch)

    // Should fetch 2 posting lists (one per term)
    expect(fetchCount).toBe(2)
  })
})

// ============================================================================
// Large Index Tests
// ============================================================================

describe('Large Index', () => {
  it('indexes 1000+ documents', () => {
    const index = new FullTextIndex()

    for (let i = 0; i < 1000; i++) {
      const terms = ['document', 'number', String(i), 'test', i % 2 === 0 ? 'even' : 'odd']
      index.add(`doc${i}`, terms.join(' '))
    }

    expect(index.documentCount).toBe(1000)
    expect(index.getDocumentFrequency('document')).toBe(1000)
    expect(index.getDocumentFrequency('even')).toBe(500)
    expect(index.getDocumentFrequency('odd')).toBe(500)
  })

  it('searches 1000+ documents efficiently', () => {
    const index = new FullTextIndex()

    for (let i = 0; i < 1000; i++) {
      index.add(`doc${i}`, `document number ${i} with content ${i % 10}`)
    }

    const start = performance.now()
    const results = index.search('document number')
    const elapsed = performance.now() - start

    expect(results.length).toBe(1000)
    expect(elapsed).toBeLessThan(100) // Should be fast
  })

  it('serializes 1000+ documents within reasonable size', () => {
    const index = new FullTextIndex()

    for (let i = 0; i < 1000; i++) {
      index.add(`doc${i}`, `document number ${i}`)
    }

    const dictBytes = index.serializeDictionary()
    const postingsBytes = index.serializePostings()

    const totalSize = dictBytes.length + postingsBytes.length

    // Should fit comfortably in 128MB Worker limit
    expect(totalSize).toBeLessThan(1024 * 1024) // < 1MB for this simple case
  })

  it('roundtrips 1000+ documents', async () => {
    const original = new FullTextIndex()

    for (let i = 0; i < 1000; i++) {
      original.add(`doc${i}`, `document number ${i} category ${i % 5}`)
    }

    const dictBytes = original.serializeDictionary()
    const postingsBytes = original.serializePostings()

    const restored = new FullTextIndex()
    await restored.loadDictionary(dictBytes)
    restored.loadPostings(postingsBytes)

    expect(restored.documentCount).toBe(1000)

    const results = restored.searchInMemory('category')
    expect(results.length).toBe(1000)
  })
})

// ============================================================================
// BM25 Ranking Quality Tests
// ============================================================================

describe('BM25 Ranking Quality', () => {
  it('ranks by term frequency', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'apple')
    index.add('doc2', 'apple apple')
    index.add('doc3', 'apple apple apple')

    const results = index.searchWithScores('apple')

    expect(results[0].id).toBe('doc3')
    expect(results[1].id).toBe('doc2')
    expect(results[2].id).toBe('doc1')
  })

  it('penalizes longer documents', () => {
    const index = new FullTextIndex()
    // Same TF but different lengths
    index.add('short', 'apple banana')
    index.add('long', 'apple banana cherry date elderberry fig grape')

    const results = index.searchWithScores('apple')

    expect(results[0].id).toBe('short')
  })

  it('boosts rare terms', () => {
    const index = new FullTextIndex()
    // Add many docs with "the"
    for (let i = 0; i < 100; i++) {
      index.add(`common${i}`, 'the quick brown')
    }
    // Add one doc with unique term
    index.add('unique', 'the xylophone player')

    // Search for common + unique
    const results = index.searchWithScores('the xylophone')

    expect(results[0].id).toBe('unique')
  })

  it('handles multi-term queries correctly', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'machine learning algorithms')
    index.add('doc2', 'machine learning machine learning deep')
    index.add('doc3', 'machine learning machine learning machine learning')

    const results = index.searchWithScores('machine learning')

    // doc3 has highest combined TF
    expect(results[0].id).toBe('doc3')
    expect(results[1].id).toBe('doc2')
    expect(results[2].id).toBe('doc1')
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createFullTextIndex', () => {
    it('creates index from document array', () => {
      const docs = [
        { id: 'doc1', text: 'hello world' },
        { id: 'doc2', text: 'hello there' },
      ]

      const index = createFullTextIndex(docs)

      expect(index.documentCount).toBe(2)
      expect(index.search('hello')).toEqual(expect.arrayContaining(['doc1', 'doc2']))
    })
  })

  describe('loadFullTextIndex', () => {
    it('loads index from serialized data', async () => {
      const original = new FullTextIndex()
      original.add('doc1', 'hello world')
      original.add('doc2', 'hello there')

      const dictBytes = original.serializeDictionary()
      const postingsBytes = original.serializePostings()

      const loaded = await loadFullTextIndex(dictBytes, postingsBytes)

      expect(loaded.documentCount).toBe(2)
      const results = loaded.searchInMemory('hello')
      expect(results.length).toBe(2)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty query', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'hello world')

    expect(index.search('')).toEqual([])
    expect(index.searchWithScores('')).toEqual([])
  })

  it('handles empty index', () => {
    const index = new FullTextIndex()

    expect(index.search('hello')).toEqual([])
    expect(index.documentCount).toBe(0)
  })

  it('handles document with empty text', () => {
    const index = new FullTextIndex()
    index.add('doc1', '')

    expect(index.documentCount).toBe(1)
    expect(index.termCount).toBe(0)
  })

  it('handles special characters', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'hello@world.com test-case under_score')

    expect(index.hasTerm('hello')).toBe(true)
    expect(index.hasTerm('world')).toBe(true)
    expect(index.hasTerm('com')).toBe(true)
    expect(index.hasTerm('test')).toBe(true)
    expect(index.hasTerm('case')).toBe(true)
  })

  it('clears index completely', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'hello world')
    index.add('doc2', 'test content')

    index.clear()

    expect(index.documentCount).toBe(0)
    expect(index.termCount).toBe(0)
    expect(index.getStats().totalDocs).toBe(0)
  })

  it('handles very long documents', () => {
    const index = new FullTextIndex()
    const longText = Array(10000).fill('word').join(' ')
    index.add('doc1', longText)

    expect(index.documentCount).toBe(1)
    expect(index.search('word').length).toBe(1)
  })

  it('handles duplicate terms in document', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'hello hello hello world world')

    const results = index.searchWithScores('hello')
    expect(results.length).toBe(1)
    // Higher TF should result in higher score
    expect(results[0].score).toBeGreaterThan(0)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('serializes 10K terms quickly', () => {
    const index = new FullTextIndex()

    for (let i = 0; i < 10000; i++) {
      index.add(`doc${i}`, `term${i} common word`)
    }

    const start = performance.now()
    const dictBytes = index.serializeDictionary()
    const postingsBytes = index.serializePostings()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1000) // < 1 second
    expect(dictBytes.length).toBeGreaterThan(0)
    expect(postingsBytes.length).toBeGreaterThan(0)
  })

  it('deserializes 10K terms quickly', async () => {
    const original = new FullTextIndex()

    for (let i = 0; i < 10000; i++) {
      original.add(`doc${i}`, `term${i} common word`)
    }

    const dictBytes = original.serializeDictionary()
    const postingsBytes = original.serializePostings()

    const start = performance.now()
    const index = new FullTextIndex()
    await index.loadDictionary(dictBytes)
    index.loadPostings(postingsBytes)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500) // < 500ms
    expect(index.documentCount).toBe(10000)
  })

  it('searches 10K docs with BM25 quickly', () => {
    const index = new FullTextIndex()

    for (let i = 0; i < 10000; i++) {
      index.add(`doc${i}`, `document ${i} with some common words and unique term${i}`)
    }

    const start = performance.now()
    const results = index.searchWithScores('common words')
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(200) // < 200ms
    expect(results.length).toBe(10000)
  })
})

// ============================================================================
// Memory Constraint Tests
// ============================================================================

describe('Memory Constraints', () => {
  it('stays well under 128MB for 10K documents', () => {
    const index = new FullTextIndex()

    // Simulate realistic documents (100 words each)
    const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'and', 'cat']
    for (let i = 0; i < 10000; i++) {
      const text = Array(100)
        .fill(0)
        .map(() => words[Math.floor(Math.random() * words.length)])
        .join(' ')
      index.add(`doc${i}`, text)
    }

    const dictBytes = index.serializeDictionary()
    const postingsBytes = index.serializePostings()
    const totalSize = dictBytes.length + postingsBytes.length

    // Should be well under 128MB
    expect(totalSize).toBeLessThan(10 * 1024 * 1024) // < 10MB
    console.log(`\n  Index size for 10K docs: ${(totalSize / 1024).toFixed(2)} KB\n`)
  })

  it('provides reasonable compression with delta encoding', () => {
    const index = new FullTextIndex()

    // Create term that appears in many consecutive docs
    for (let i = 0; i < 1000; i++) {
      index.add(`doc${i}`, 'common term appears everywhere')
    }

    const postingsBytes = index.serializePostings()

    // With delta encoding, 1000 consecutive IDs should compress well
    // Each delta is 1, which is 1 byte per doc
    // Plus overhead for count and TFs
    expect(postingsBytes.length).toBeLessThan(10000) // Very compact
  })
})
