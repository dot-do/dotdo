/**
 * SPIKE TEST: GIN Full-Text Index Streaming from R2
 *
 * Tests for streaming GIN index that doesn't require full index in memory.
 * Key requirements:
 * - Index 1M documents successfully
 * - Term lookup < 50ms
 * - Posting intersection < 100ms
 * - Memory < 50MB during search
 * - BM25 ranking produces reasonable results
 *
 * @module db/compat/sql/clickhouse/spikes/gin-streaming.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Core classes
  StreamingGINIndex,
  GINIndexWriter,

  // R2 storage interface
  type R2GINStorage,
  type GINIndexFiles,

  // FST Dictionary
  FSTDictionary,
  FSTBuilder,

  // Roaring Bitmap streaming
  StreamingRoaringPostings,

  // Types
  type GINSearchResult,
  type GINIndexStats,
  type MemoryBudget,

  // Helpers
  createMockR2Storage,
} from './gin-streaming'

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

    it('performs binary search on streamed data', async () => {
      const builder = new FSTBuilder()
      const terms: string[] = []
      for (let i = 0; i < 10000; i++) {
        const term = `term${i.toString().padStart(5, '0')}`
        terms.push(term)
        builder.add(term, { offset: i * 100, length: 100, df: i % 100 })
      }

      const fst = builder.build()
      const bytes = fst.serialize()

      // Mock range fetcher
      const fetcher = async (offset: number, length: number) => {
        return bytes.slice(offset, offset + length)
      }

      // Stream lookup should fetch minimal data
      const result = await FSTDictionary.streamLookup(bytes.slice(0, 64), 'term05000', fetcher)

      expect(result).toEqual({ offset: 5000 * 100, length: 100, df: 0 })
    })
  })
})

// ============================================================================
// Streaming Roaring Postings Tests
// ============================================================================

describe('StreamingRoaringPostings', () => {
  it('streams posting list from R2 range request', async () => {
    const postings = new StreamingRoaringPostings()

    // Add postings for testing
    for (let i = 0; i < 1000; i++) {
      postings.addPosting(i, i % 10 + 1) // docId, tf
    }

    const bytes = postings.serialize()

    // Mock fetcher that simulates R2 range request
    let fetchCount = 0
    const fetcher = async (offset: number, length: number) => {
      fetchCount++
      return bytes.slice(offset, offset + length)
    }

    // Stream postings
    const result = await StreamingRoaringPostings.streamPostings(0, bytes.length, fetcher)

    expect(result.docCount).toBe(1000)
    expect(result.getDocIds()).toHaveLength(1000)
    expect(fetchCount).toBe(1) // Single range request
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

    const bytesA = postingsA.serialize()
    const bytesB = postingsB.serialize()

    const fetcherA = async (offset: number, length: number) => bytesA.slice(offset, offset + length)
    const fetcherB = async (offset: number, length: number) => bytesB.slice(offset, offset + length)

    const a = await StreamingRoaringPostings.streamPostings(0, bytesA.length, fetcherA)
    const b = await StreamingRoaringPostings.streamPostings(0, bytesB.length, fetcherB)

    const intersection = a.intersect(b)

    // Common docs: 0, 6, 12, 18, ... (multiples of 6)
    const expectedCount = Math.floor(1000 / 6) + 1 // 167 docs
    expect(intersection.docCount).toBe(expectedCount)
  })

  it('maintains term frequencies for BM25', async () => {
    const postings = new StreamingRoaringPostings()

    postings.addPosting(0, 3) // doc 0 has term 3 times
    postings.addPosting(1, 1) // doc 1 has term 1 time
    postings.addPosting(2, 5) // doc 2 has term 5 times

    const bytes = postings.serialize()
    const fetcher = async (offset: number, length: number) => bytes.slice(offset, offset + length)

    const result = await StreamingRoaringPostings.streamPostings(0, bytes.length, fetcher)

    expect(result.getTermFrequency(0)).toBe(3)
    expect(result.getTermFrequency(1)).toBe(1)
    expect(result.getTermFrequency(2)).toBe(5)
    expect(result.getTermFrequency(99)).toBe(0) // Missing doc
  })
})

// ============================================================================
// GINIndexWriter Tests
// ============================================================================

describe('GINIndexWriter', () => {
  it('builds index from documents', () => {
    const writer = new GINIndexWriter()

    writer.addDocument('doc1', 'the quick brown fox')
    writer.addDocument('doc2', 'the lazy brown dog')
    writer.addDocument('doc3', 'quick quick fox')

    expect(writer.documentCount).toBe(3)
    expect(writer.termCount).toBeGreaterThan(0)
  })

  it('produces three output files', () => {
    const writer = new GINIndexWriter()

    writer.addDocument('doc1', 'hello world')
    writer.addDocument('doc2', 'hello there')

    const files = writer.build()

    expect(files.dictionary).toBeInstanceOf(Uint8Array)
    expect(files.postings).toBeInstanceOf(Uint8Array)
    expect(files.metadata).toBeInstanceOf(Uint8Array)
  })

  it('stores document metadata for BM25', () => {
    const writer = new GINIndexWriter()

    writer.addDocument('doc1', 'hello world')
    writer.addDocument('doc2', 'hello there friend')

    const files = writer.build()
    const stats = GINIndexWriter.parseMetadata(files.metadata)

    expect(stats.totalDocs).toBe(2)
    expect(stats.avgDocLength).toBeCloseTo(2.5, 1)
    expect(stats.termCount).toBe(4) // hello, world, there, friend
  })

  it.skip('handles 1M documents', { timeout: 120000 }, () => {
    // SKIP: This test takes ~2 minutes. Enable for manual validation.
    const writer = new GINIndexWriter()

    const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog']

    for (let i = 0; i < 1_000_000; i++) {
      // Generate random 10-word document
      const docWords = Array.from({ length: 10 }, () => words[Math.floor(Math.random() * words.length)])
      writer.addDocument(`doc${i}`, docWords.join(' '))
    }

    expect(writer.documentCount).toBe(1_000_000)

    // Build should complete within reasonable time
    const start = Date.now()
    const files = writer.build()
    const elapsed = Date.now() - start

    console.log(`\n  Built 1M doc index in ${elapsed}ms`)
    console.log(`  Dictionary: ${(files.dictionary.length / 1024 / 1024).toFixed(2)} MB`)
    console.log(`  Postings: ${(files.postings.length / 1024 / 1024).toFixed(2)} MB`)
    console.log(`  Metadata: ${(files.metadata.length / 1024).toFixed(2)} KB\n`)

    // Should complete in under 120 seconds
    expect(elapsed).toBeLessThan(120000)
  })
})

// ============================================================================
// StreamingGINIndex Tests
// ============================================================================

describe('StreamingGINIndex', () => {
  let storage: R2GINStorage
  let indexFiles: GINIndexFiles

  beforeEach(() => {
    // Build a test index
    const writer = new GINIndexWriter()

    writer.addDocument('doc1', 'the quick brown fox jumps over the lazy dog')
    writer.addDocument('doc2', 'a quick brown dog runs in the park')
    writer.addDocument('doc3', 'the lazy cat sleeps all day')
    writer.addDocument('doc4', 'quick quick quick is the name of the game')
    writer.addDocument('doc5', 'the brown fox and the brown dog are friends')

    indexFiles = writer.build()
    storage = createMockR2Storage(indexFiles)
  })

  describe('search', () => {
    it('finds documents with single term', async () => {
      const index = new StreamingGINIndex(storage)

      const results = await index.search('fox')

      expect(results.map((r) => r.id)).toContain('doc1')
      expect(results.map((r) => r.id)).toContain('doc5')
      expect(results.map((r) => r.id)).not.toContain('doc3')
    })

    it('performs AND query for multiple terms', async () => {
      const index = new StreamingGINIndex(storage)

      const results = await index.search('brown dog')

      // doc1 has "brown fox" and "lazy dog", doc2 has "brown dog", doc5 has "brown fox" and "brown dog"
      // All three have both "brown" and "dog"
      expect(results.map((r) => r.id).sort()).toEqual(['doc1', 'doc2', 'doc5'])
    })

    it('returns empty for missing terms', async () => {
      const index = new StreamingGINIndex(storage)

      const results = await index.search('elephant')

      expect(results).toEqual([])
    })

    it('ranks by BM25 score', async () => {
      const index = new StreamingGINIndex(storage)

      const results = await index.search('quick')

      // doc4 has "quick" 3x, should rank highest
      expect(results[0].id).toBe('doc4')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })

  describe('memory budget', () => {
    it('tracks memory usage during search', async () => {
      const index = new StreamingGINIndex(storage, { maxMemoryMB: 50 })

      const results = await index.search('brown fox')
      const memoryUsed = index.getMemoryUsage()

      expect(memoryUsed.currentMB).toBeLessThan(50)
      expect(memoryUsed.peakMB).toBeLessThan(50)
    })

    it('throws when exceeding memory budget', async () => {
      // Very small budget (0.0001 MB = ~100 bytes)
      const index = new StreamingGINIndex(storage, { maxMemoryMB: 0.0001 })

      await expect(index.search('quick')).rejects.toThrow('Memory budget exceeded')
    })

    it('clears memory after search', async () => {
      const index = new StreamingGINIndex(storage)

      await index.search('quick brown')
      const afterSearch = index.getMemoryUsage()

      index.clearCache()
      const afterClear = index.getMemoryUsage()

      expect(afterClear.currentMB).toBeLessThan(afterSearch.currentMB)
    })
  })

  describe('performance', () => {
    it('completes term lookup in < 50ms', async () => {
      // Build larger index for realistic test
      const writer = new GINIndexWriter()
      for (let i = 0; i < 10000; i++) {
        writer.addDocument(`doc${i}`, `document ${i} with term${i % 100}`)
      }
      const files = writer.build()
      const bigStorage = createMockR2Storage(files)
      const index = new StreamingGINIndex(bigStorage)

      const start = Date.now()
      await index.search('term50')
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('completes intersection in < 100ms', async () => {
      // Build larger index
      const writer = new GINIndexWriter()
      for (let i = 0; i < 10000; i++) {
        writer.addDocument(`doc${i}`, `document ${i} common term rare${i % 100}`)
      }
      const files = writer.build()
      const bigStorage = createMockR2Storage(files)
      const index = new StreamingGINIndex(bigStorage)

      const start = Date.now()
      await index.search('common rare50')
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100)
    })

    it('uses < 50MB memory for search', async () => {
      // Build larger index
      const writer = new GINIndexWriter()
      for (let i = 0; i < 100000; i++) {
        writer.addDocument(`doc${i}`, `document ${i} with various terms cat${i % 1000}`)
      }
      const files = writer.build()
      const bigStorage = createMockR2Storage(files)
      const index = new StreamingGINIndex(bigStorage, { maxMemoryMB: 50 })

      await index.search('various cat500')
      const memory = index.getMemoryUsage()

      expect(memory.peakMB).toBeLessThan(50)
    })
  })
})

// ============================================================================
// R2 Integration Tests
// ============================================================================

describe('R2 Storage Integration', () => {
  it('fetches only required byte ranges', async () => {
    const writer = new GINIndexWriter()
    for (let i = 0; i < 1000; i++) {
      writer.addDocument(`doc${i}`, `term${i} common word`)
    }
    const files = writer.build()

    // Track fetch statistics
    let totalBytesRequested = 0
    const fetchRanges: Array<{ file: string; offset: number; length: number }> = []

    const storage: R2GINStorage = {
      async fetchRange(file: keyof GINIndexFiles, offset: number, length: number) {
        totalBytesRequested += length
        fetchRanges.push({ file, offset, length })
        return files[file].slice(offset, offset + length)
      },
      async fetchMetadata() {
        return files.metadata
      },
    }

    const index = new StreamingGINIndex(storage)
    await index.search('term500')

    // Should fetch much less than full index
    const fullIndexSize = files.dictionary.length + files.postings.length
    expect(totalBytesRequested).toBeLessThan(fullIndexSize * 0.1) // < 10%

    console.log(`\n  Full index size: ${(fullIndexSize / 1024).toFixed(2)} KB`)
    console.log(`  Bytes fetched: ${(totalBytesRequested / 1024).toFixed(2)} KB`)
    console.log(`  Efficiency: ${((1 - totalBytesRequested / fullIndexSize) * 100).toFixed(1)}% saved\n`)
  })

  it('caches dictionary for repeated searches', async () => {
    const writer = new GINIndexWriter()
    for (let i = 0; i < 1000; i++) {
      writer.addDocument(`doc${i}`, `term${i} common word`)
    }
    const files = writer.build()

    let dictFetches = 0
    const storage: R2GINStorage = {
      async fetchRange(file: keyof GINIndexFiles, offset: number, length: number) {
        if (file === 'dictionary') dictFetches++
        return files[file].slice(offset, offset + length)
      },
      async fetchMetadata() {
        return files.metadata
      },
    }

    const index = new StreamingGINIndex(storage, { cacheDictionary: true })

    // First search loads dictionary
    await index.search('term100')
    const firstSearchFetches = dictFetches

    // Second search should use cache
    await index.search('term200')
    const secondSearchFetches = dictFetches - firstSearchFetches

    expect(secondSearchFetches).toBeLessThan(firstSearchFetches)
  })
})

// ============================================================================
// BM25 Ranking Quality Tests
// ============================================================================

describe('BM25 Ranking Quality', () => {
  let storage: R2GINStorage

  beforeEach(() => {
    const writer = new GINIndexWriter()

    // Documents with varying term frequencies
    writer.addDocument('low_tf', 'machine learning')
    writer.addDocument('medium_tf', 'machine machine learning learning')
    writer.addDocument('high_tf', 'machine machine machine learning learning learning')

    // Documents with varying lengths
    writer.addDocument('short', 'machine learning is great')
    writer.addDocument('long', 'machine learning is great for solving complex problems in various domains')

    // Rare vs common terms
    for (let i = 0; i < 100; i++) {
      writer.addDocument(`common${i}`, 'the quick brown fox')
    }
    writer.addDocument('rare', 'the xylophone player')

    const files = writer.build()
    storage = createMockR2Storage(files)
  })

  it('ranks higher TF documents first', async () => {
    const index = new StreamingGINIndex(storage)

    const results = await index.search('machine learning')

    // Higher TF should rank higher
    const ranks = {
      high_tf: results.findIndex((r) => r.id === 'high_tf'),
      medium_tf: results.findIndex((r) => r.id === 'medium_tf'),
      low_tf: results.findIndex((r) => r.id === 'low_tf'),
    }

    expect(ranks.high_tf).toBeLessThan(ranks.medium_tf)
    expect(ranks.medium_tf).toBeLessThan(ranks.low_tf)
  })

  it('penalizes longer documents', async () => {
    const index = new StreamingGINIndex(storage)

    const results = await index.search('machine')

    // Same TF but shorter doc should rank higher
    const shortIdx = results.findIndex((r) => r.id === 'short')
    const longIdx = results.findIndex((r) => r.id === 'long')

    expect(shortIdx).toBeLessThan(longIdx)
  })

  it('boosts rare terms', async () => {
    const index = new StreamingGINIndex(storage)

    const results = await index.search('the xylophone')

    // Document with rare term should rank first
    expect(results[0].id).toBe('rare')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty query', async () => {
    const writer = new GINIndexWriter()
    writer.addDocument('doc1', 'hello world')
    const files = writer.build()
    const storage = createMockR2Storage(files)
    const index = new StreamingGINIndex(storage)

    const results = await index.search('')

    expect(results).toEqual([])
  })

  it('handles empty index', async () => {
    const writer = new GINIndexWriter()
    const files = writer.build()
    const storage = createMockR2Storage(files)
    const index = new StreamingGINIndex(storage)

    const results = await index.search('hello')

    expect(results).toEqual([])
  })

  it('handles very long query', async () => {
    const writer = new GINIndexWriter()
    writer.addDocument('doc1', 'hello world')
    const files = writer.build()
    const storage = createMockR2Storage(files)
    const index = new StreamingGINIndex(storage)

    const longQuery = Array(100).fill('term').join(' ')
    const results = await index.search(longQuery)

    expect(results).toEqual([]) // None of these terms exist
  })

  it('handles special characters in query', async () => {
    const writer = new GINIndexWriter()
    writer.addDocument('doc1', 'hello@world.com test-case')
    const files = writer.build()
    const storage = createMockR2Storage(files)
    const index = new StreamingGINIndex(storage)

    const results = await index.search('hello world')

    expect(results).toHaveLength(1)
  })

  it('handles concurrent searches', async () => {
    const writer = new GINIndexWriter()
    for (let i = 0; i < 100; i++) {
      writer.addDocument(`doc${i}`, `term${i} common word`)
    }
    const files = writer.build()
    const storage = createMockR2Storage(files)
    const index = new StreamingGINIndex(storage)

    // Run multiple searches concurrently
    const searches = [
      index.search('term1'),
      index.search('term50'),
      index.search('common'),
      index.search('word'),
    ]

    const results = await Promise.all(searches)

    expect(results[0].length).toBeGreaterThan(0)
    expect(results[1].length).toBeGreaterThan(0)
    expect(results[2].length).toBe(100)
    expect(results[3].length).toBe(100)
  })
})
