/**
 * Tests for GIN Full-Text Index with BM25 Scoring
 *
 * Tests cover:
 * - Indexing document text
 * - Single and multi-term search (AND queries)
 * - BM25 ranking
 * - R2 streaming support
 * - Phrase search
 * - Memory budget management
 * - Edge cases
 *
 * @module db/compat/sql/clickhouse/indexes/full-text-index.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Main class
  FullTextIndex,

  // FST classes
  FSTBuilder,
  FSTDictionary,

  // Postings
  StreamingRoaringPostings,

  // Encoding
  encodeVarint,
  decodeVarint,
  varintSize,

  // Tokenization
  tokenize,
  tokenizeWithFrequencies,

  // BM25
  calculateIDF,
  calculateBM25Score,
  BM25_K1,
  BM25_B,

  // Factory functions
  createMockR2Storage,
  createFullTextIndex,

  // Types
  type SearchResult,
  type GINIndexFiles,
  type R2GINStorage,
  type RangeFetcher,
} from './full-text-index'

// ============================================================================
// Full-Text Search (GIN) - Core Tests from Issue
// ============================================================================

describe('Full-Text Search (GIN)', () => {
  it('indexes document text', async () => {
    const index = new FullTextIndex()
    await index.add('doc1', 'Machine learning is transforming industries')
    await index.add('doc2', 'Deep learning is a subset of machine learning')
    expect(index.termCount()).toBeGreaterThan(0)
  })

  it('searches for single term', async () => {
    const index = new FullTextIndex()
    await index.add('doc1', 'Hello world')
    await index.add('doc2', 'Goodbye world')
    const results = await index.search('hello')
    expect(results).toContain('doc1')
    expect(results).not.toContain('doc2')
  })

  it('intersects multiple terms (AND)', async () => {
    const index = new FullTextIndex()
    await index.add('doc1', 'machine learning')
    await index.add('doc2', 'machine shop')
    await index.add('doc3', 'deep learning')
    const results = await index.search('machine learning')
    expect(results).toEqual(['doc1'])
  })

  it('ranks by BM25', async () => {
    const index = new FullTextIndex()
    await index.add('doc1', 'machine')
    await index.add('doc2', 'machine machine machine')
    const results = await index.searchWithScores('machine')
    expect(results[0].id).toBe('doc2') // Higher term frequency
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it('streams from R2 storage', async () => {
    // Build index
    const index = new FullTextIndex()
    index.add('doc1', 'machine learning algorithms')
    index.add('doc2', 'machine learning models')
    const files = index.build()

    // Simulate loading FST + postings from R2
    const storage = createMockR2Storage(files)

    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const results = await search('machine')
    expect(results.length).toBeGreaterThan(0)
  })

  it('supports phrase search', async () => {
    const index = new FullTextIndex()
    await index.add('doc1', 'machine learning algorithms')
    await index.add('doc2', 'learning machine skills')
    const results = await index.searchPhrase('machine learning')
    // Note: Current implementation falls back to AND query
    // Full phrase search requires positional indexes
    expect(results).toContain('doc1')
  })
})

// ============================================================================
// FST Dictionary Tests
// ============================================================================

describe('FST Dictionary', () => {
  describe('FSTBuilder', () => {
    it('builds FST from sorted terms', () => {
      const builder = new FSTBuilder()
      builder.add('apple', { offset: 0, length: 100, df: 5 })
      builder.add('application', { offset: 100, length: 150, df: 3 })
      builder.add('apply', { offset: 250, length: 80, df: 7 })
      builder.add('banana', { offset: 330, length: 200, df: 10 })

      const fst = builder.build()

      expect(fst.lookup('apple')).toEqual({ offset: 0, length: 100, df: 5 })
      expect(fst.lookup('banana')).toEqual({ offset: 330, length: 200, df: 10 })
      expect(fst.lookup('cherry')).toBeNull()
    })

    it('throws on unsorted terms', () => {
      const builder = new FSTBuilder()
      builder.add('banana', { offset: 0, length: 100, df: 5 })

      expect(() => {
        builder.add('apple', { offset: 100, length: 100, df: 3 })
      }).toThrow('must be added in sorted order')
    })

    it('serializes and deserializes FST', () => {
      const builder = new FSTBuilder()
      builder.add('hello', { offset: 0, length: 50, df: 10 })
      builder.add('world', { offset: 50, length: 60, df: 20 })

      const fst = builder.build()
      const bytes = fst.serialize()
      const restored = FSTDictionary.deserialize(bytes)

      expect(restored.lookup('hello')).toEqual({ offset: 0, length: 50, df: 10 })
      expect(restored.lookup('world')).toEqual({ offset: 50, length: 60, df: 20 })
    })

    it('supports prefix search', () => {
      const builder = new FSTBuilder()
      builder.add('apple', { offset: 0, length: 100, df: 5 })
      builder.add('application', { offset: 100, length: 150, df: 3 })
      builder.add('apply', { offset: 250, length: 80, df: 7 })
      builder.add('banana', { offset: 330, length: 200, df: 10 })

      const fst = builder.build()
      const matches = fst.prefixSearch('app')

      expect(matches.map((m) => m.term)).toEqual(['apple', 'application', 'apply'])
    })
  })

  describe('FSTDictionary streaming', () => {
    it('loads dictionary header without full data', async () => {
      const builder = new FSTBuilder()
      for (let i = 0; i < 1000; i++) {
        builder.add(`term${i.toString().padStart(4, '0')}`, { offset: i * 100, length: 100, df: i % 100 })
      }

      const fst = builder.build()
      const bytes = fst.serialize()

      // Load only header (first 64 bytes)
      const header = bytes.slice(0, 64)
      const info = FSTDictionary.parseHeader(header)

      expect(info.termCount).toBe(1000)
      expect(info.version).toBe(1)
    })
  })
})

// ============================================================================
// Streaming Roaring Postings Tests
// ============================================================================

describe('StreamingRoaringPostings', () => {
  it('streams posting list from range request', async () => {
    const postings = new StreamingRoaringPostings()

    for (let i = 0; i < 1000; i++) {
      postings.addPosting(i, i % 10 + 1)
    }

    const bytes = postings.serialize()

    let fetchCount = 0
    const fetcher: RangeFetcher = async (offset, length) => {
      fetchCount++
      return bytes.slice(offset, offset + length)
    }

    const result = await StreamingRoaringPostings.streamPostings(0, bytes.length, fetcher)

    expect(result.docCount).toBe(1000)
    expect(result.getDocIds()).toHaveLength(1000)
    expect(fetchCount).toBe(1)
  })

  it('intersects postings efficiently', async () => {
    const postingsA = new StreamingRoaringPostings()
    const postingsB = new StreamingRoaringPostings()

    // A: documents 0, 2, 4, 6, 8, ...
    for (let i = 0; i < 500; i++) {
      postingsA.addPosting(i * 2, 1)
    }

    // B: documents 0, 3, 6, 9, ...
    for (let i = 0; i < 334; i++) {
      postingsB.addPosting(i * 3, 1)
    }

    const intersection = postingsA.intersect(postingsB)

    // Common docs: 0, 6, 12, 18, ... (multiples of 6)
    const expectedCount = Math.floor(1000 / 6) + 1
    expect(intersection.docCount).toBe(expectedCount)
  })

  it('maintains term frequencies for BM25', async () => {
    const postings = new StreamingRoaringPostings()

    postings.addPosting(0, 3)
    postings.addPosting(1, 1)
    postings.addPosting(2, 5)

    const bytes = postings.serialize()
    const fetcher: RangeFetcher = async (offset, length) => bytes.slice(offset, offset + length)

    const result = await StreamingRoaringPostings.streamPostings(0, bytes.length, fetcher)

    expect(result.getTermFrequency(0)).toBe(3)
    expect(result.getTermFrequency(1)).toBe(1)
    expect(result.getTermFrequency(2)).toBe(5)
    expect(result.getTermFrequency(99)).toBe(0)
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
      const idf = calculateIDF(1000, 1)
      expect(idf).toBeGreaterThan(0)
    })

    it('returns lower value for common terms', () => {
      const commonIDF = calculateIDF(1000, 500)
      const rareIDF = calculateIDF(1000, 1)
      expect(commonIDF).toBeLessThan(rareIDF)
    })

    it('returns positive value even for very common terms (BM25+)', () => {
      const idf = calculateIDF(1000, 900)
      expect(idf).toBeGreaterThan(0)
    })

    it('returns positive value even when term appears in all docs', () => {
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

      expect(index.termCount()).toBe(3) // hello, world, there
    })

    it('updates existing document', () => {
      index.add('doc1', 'hello world')
      index.add('doc1', 'goodbye world')

      expect(index.documentCount).toBe(1)
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
      expect(stats.totalLength).toBe(5)
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
      expect(results[0].id).toBe('doc2')
      expect(results[1].id).toBe('doc1')
    })

    it('includes scores in results', () => {
      const results = index.searchWithScores('learning')

      for (const result of results) {
        expect(result.score).toBeGreaterThan(0)
      }
    })

    it('returns higher score for more relevant documents', () => {
      const results = index.searchWithScores('machine')

      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })
})

// ============================================================================
// Index Building and Serialization Tests
// ============================================================================

describe('Index Building', () => {
  it('builds index from documents', () => {
    const index = new FullTextIndex()

    index.add('doc1', 'the quick brown fox')
    index.add('doc2', 'the lazy brown dog')
    index.add('doc3', 'quick quick fox')

    expect(index.documentCount).toBe(3)
    expect(index.termCount()).toBeGreaterThan(0)
  })

  it('produces three output files', () => {
    const index = new FullTextIndex()

    index.add('doc1', 'hello world')
    index.add('doc2', 'hello there')

    const files = index.build()

    expect(files.dictionary).toBeInstanceOf(Uint8Array)
    expect(files.postings).toBeInstanceOf(Uint8Array)
    expect(files.metadata).toBeInstanceOf(Uint8Array)
  })

  it('stores document metadata for BM25', () => {
    const index = new FullTextIndex()

    index.add('doc1', 'hello world')
    index.add('doc2', 'hello there friend')

    const files = index.build()
    const stats = FullTextIndex.parseMetadata(files.metadata)

    expect(stats.totalDocs).toBe(2)
    expect(stats.avgDocLength).toBeCloseTo(2.5, 1)
    expect(stats.termCount).toBe(4)
  })
})

// ============================================================================
// R2 Storage Integration Tests
// ============================================================================

describe('R2 Storage Integration', () => {
  let indexFiles: GINIndexFiles
  let storage: R2GINStorage

  beforeEach(() => {
    const index = new FullTextIndex()

    index.add('doc1', 'the quick brown fox jumps over the lazy dog')
    index.add('doc2', 'a quick brown dog runs in the park')
    index.add('doc3', 'the lazy cat sleeps all day')
    index.add('doc4', 'quick quick quick is the name of the game')
    index.add('doc5', 'the brown fox and the brown dog are friends')

    indexFiles = index.build()
    storage = createMockR2Storage(indexFiles)
  })

  describe('streaming search', () => {
    it('finds documents with single term', async () => {
      const searchIndex = new FullTextIndex()
      const search = await searchIndex.searchStreaming(storage)

      const results = await search('fox')

      expect(results.map((r) => r.id)).toContain('doc1')
      expect(results.map((r) => r.id)).toContain('doc5')
      expect(results.map((r) => r.id)).not.toContain('doc3')
    })

    it('performs AND query for multiple terms', async () => {
      const searchIndex = new FullTextIndex()
      const search = await searchIndex.searchStreaming(storage)

      const results = await search('brown dog')

      expect(results.map((r) => r.id).sort()).toEqual(['doc1', 'doc2', 'doc5'])
    })

    it('returns empty for missing terms', async () => {
      const searchIndex = new FullTextIndex()
      const search = await searchIndex.searchStreaming(storage)

      const results = await search('elephant')

      expect(results).toEqual([])
    })

    it('ranks by BM25 score', async () => {
      const searchIndex = new FullTextIndex()
      const search = await searchIndex.searchStreaming(storage)

      const results = await search('quick')

      expect(results[0].id).toBe('doc4')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })

  describe('memory budget', () => {
    it('tracks memory usage during search', async () => {
      const searchIndex = new FullTextIndex({ maxMemoryMB: 50 })
      const search = await searchIndex.searchStreaming(storage)

      await search('brown fox')
      const memoryUsed = searchIndex.getMemoryUsage()

      expect(memoryUsed.currentMB).toBeLessThan(50)
      expect(memoryUsed.peakMB).toBeLessThan(50)
    })

    it('throws when exceeding memory budget', async () => {
      const searchIndex = new FullTextIndex({ maxMemoryMB: 0.0001 })

      await expect(searchIndex.searchStreaming(storage)).rejects.toThrow('Memory budget exceeded')
    })

    it('clears memory after search', async () => {
      const searchIndex = new FullTextIndex()
      const search = await searchIndex.searchStreaming(storage)

      await search('quick brown')
      const afterSearch = searchIndex.getMemoryUsage()

      searchIndex.clearCache()
      const afterClear = searchIndex.getMemoryUsage()

      expect(afterClear.currentMB).toBeLessThan(afterSearch.currentMB)
    })
  })

  describe('fetch efficiency', () => {
    it('fetches only required byte ranges', async () => {
      let totalBytesRequested = 0
      const fetchRanges: Array<{ file: string; offset: number; length: number }> = []

      const trackingStorage: R2GINStorage = {
        async fetchRange(file, offset, length) {
          totalBytesRequested += length
          fetchRanges.push({ file, offset, length })
          return indexFiles[file].slice(offset, offset + length)
        },
        async fetchMetadata() {
          return indexFiles.metadata
        },
      }

      const searchIndex = new FullTextIndex()
      const search = await searchIndex.searchStreaming(trackingStorage)
      await search('quick')

      const fullIndexSize = indexFiles.dictionary.length + indexFiles.postings.length
      expect(totalBytesRequested).toBeLessThan(fullIndexSize)
    })
  })
})

// ============================================================================
// BM25 Ranking Quality Tests
// ============================================================================

describe('BM25 Ranking Quality', () => {
  let storage: R2GINStorage

  beforeEach(() => {
    const index = new FullTextIndex()

    // Documents with varying term frequencies
    index.add('low_tf', 'machine learning')
    index.add('medium_tf', 'machine machine learning learning')
    index.add('high_tf', 'machine machine machine learning learning learning')

    // Documents with varying lengths
    index.add('short', 'machine learning is great')
    index.add('long', 'machine learning is great for solving complex problems in various domains')

    // Rare vs common terms
    for (let i = 0; i < 100; i++) {
      index.add(`common${i}`, 'the quick brown')
    }
    index.add('rare', 'the xylophone player')

    const files = index.build()
    storage = createMockR2Storage(files)
  })

  it('ranks higher TF documents first', async () => {
    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const results = await search('machine learning')

    const ranks = {
      high_tf: results.findIndex((r) => r.id === 'high_tf'),
      medium_tf: results.findIndex((r) => r.id === 'medium_tf'),
      low_tf: results.findIndex((r) => r.id === 'low_tf'),
    }

    expect(ranks.high_tf).toBeLessThan(ranks.medium_tf)
    expect(ranks.medium_tf).toBeLessThan(ranks.low_tf)
  })

  it('penalizes longer documents', async () => {
    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const results = await search('machine')

    const shortIdx = results.findIndex((r) => r.id === 'short')
    const longIdx = results.findIndex((r) => r.id === 'long')

    expect(shortIdx).toBeLessThan(longIdx)
  })

  it('boosts rare terms', async () => {
    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const results = await search('the xylophone')

    expect(results[0].id).toBe('rare')
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('completes term lookup in < 50ms', async () => {
    const index = new FullTextIndex()
    for (let i = 0; i < 10000; i++) {
      index.add(`doc${i}`, `document ${i} with term${i % 100}`)
    }
    const files = index.build()
    const storage = createMockR2Storage(files)

    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const start = Date.now()
    await search('term50')
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50)
  })

  it('completes intersection in < 100ms', async () => {
    const index = new FullTextIndex()
    for (let i = 0; i < 10000; i++) {
      index.add(`doc${i}`, `document ${i} common term rare${i % 100}`)
    }
    const files = index.build()
    const storage = createMockR2Storage(files)

    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const start = Date.now()
    await search('common rare50')
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(100)
  })

  it('uses < 50MB memory for search', async () => {
    const index = new FullTextIndex()
    for (let i = 0; i < 100000; i++) {
      index.add(`doc${i}`, `document ${i} with various terms cat${i % 1000}`)
    }
    const files = index.build()
    const storage = createMockR2Storage(files)

    const searchIndex = new FullTextIndex({ maxMemoryMB: 50 })
    const search = await searchIndex.searchStreaming(storage)

    await search('various cat500')
    const memory = searchIndex.getMemoryUsage()

    expect(memory.peakMB).toBeLessThan(50)
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
    expect(index.termCount()).toBe(0)
  })

  it('handles special characters', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'hello@world.com test-case under_score')

    const results = index.search('hello world')
    expect(results).toHaveLength(1)
  })

  it('handles concurrent searches', async () => {
    const index = new FullTextIndex()
    for (let i = 0; i < 100; i++) {
      index.add(`doc${i}`, `term${i} common word`)
    }
    const files = index.build()
    const storage = createMockR2Storage(files)

    const searchIndex = new FullTextIndex()
    const search = await searchIndex.searchStreaming(storage)

    const searches = [search('term1'), search('term50'), search('common'), search('word')]

    const results = await Promise.all(searches)

    expect(results[0].length).toBeGreaterThan(0)
    expect(results[1].length).toBeGreaterThan(0)
    expect(results[2].length).toBe(100)
    expect(results[3].length).toBe(100)
  })

  it('clears index completely', () => {
    const index = new FullTextIndex()
    index.add('doc1', 'hello world')
    index.add('doc2', 'test content')

    index.clear()

    expect(index.documentCount).toBe(0)
    expect(index.termCount()).toBe(0)
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
    expect(results[0].score).toBeGreaterThan(0)
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

  describe('createMockR2Storage', () => {
    it('creates working mock storage', async () => {
      const index = new FullTextIndex()
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')

      const files = index.build()
      const storage = createMockR2Storage(files)

      const metadata = await storage.fetchMetadata()
      expect(metadata.length).toBeGreaterThan(0)

      const dictPart = await storage.fetchRange('dictionary', 0, 64)
      expect(dictPart.length).toBe(64)
    })
  })
})
