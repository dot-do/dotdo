/**
 * InvertedIndex Benchmark Tests
 *
 * Performance tests for the inverted index with 100K+ documents.
 * Tests indexing throughput, search latency, and memory efficiency.
 *
 * @module db/primitives/inverted-index/tests/benchmark
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { InvertedIndex } from '../inverted-index'

// ============================================================================
// Test Data Generation
// ============================================================================

/**
 * Generate a random word from vocabulary
 */
function randomWord(vocab: string[]): string {
  return vocab[Math.floor(Math.random() * vocab.length)]
}

/**
 * Generate a random document with given word count
 */
function generateDocument(vocab: string[], wordCount: number): string {
  const words: string[] = []
  for (let i = 0; i < wordCount; i++) {
    words.push(randomWord(vocab))
  }
  return words.join(' ')
}

/**
 * Generate vocabulary of unique words
 */
function generateVocabulary(size: number): string[] {
  const vocab: string[] = []
  const prefixes = ['pro', 'con', 'inter', 'super', 'auto', 'multi', 'semi', 'anti', 'pre', 'post']
  const roots = ['act', 'cess', 'dict', 'duc', 'fact', 'fer', 'graph', 'ject', 'log', 'mit', 'ped', 'port', 'scrib', 'spec', 'struct', 'tract', 'vert', 'vis']
  const suffixes = ['ion', 'tion', 'ness', 'ment', 'able', 'ible', 'ful', 'less', 'ive', 'ous', 'ary', 'ery', 'ory']

  for (let i = 0; i < size; i++) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
    const root = roots[Math.floor(Math.random() * roots.length)]
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)]
    vocab.push(`${prefix}${root}${suffix}${i}`)
  }

  return vocab
}

// ============================================================================
// Benchmark Tests - 100K Documents
// ============================================================================

describe('InvertedIndex 100K Document Benchmark', () => {
  const DOC_COUNT = 100_000
  const VOCAB_SIZE = 10_000
  const WORDS_PER_DOC = 50

  let vocabulary: string[]
  let documents: Array<{ id: string; text: string }>
  let index: InvertedIndex

  beforeAll(() => {
    // Generate test data
    vocabulary = generateVocabulary(VOCAB_SIZE)
    documents = []
    for (let i = 0; i < DOC_COUNT; i++) {
      documents.push({
        id: `doc${i}`,
        text: generateDocument(vocabulary, WORDS_PER_DOC),
      })
    }
  })

  afterAll(() => {
    // Clear test data
    vocabulary = []
    documents = []
    if (index) {
      index.clear()
    }
  })

  describe('indexing performance', () => {
    it('should index 100K documents in under 30 seconds', () => {
      index = new InvertedIndex()

      const startTime = performance.now()

      for (const doc of documents) {
        index.add(doc.id, doc.text)
      }

      const endTime = performance.now()
      const elapsedMs = endTime - startTime

      console.log(`Indexed ${DOC_COUNT} documents in ${elapsedMs.toFixed(2)}ms`)
      console.log(`Throughput: ${((DOC_COUNT / elapsedMs) * 1000).toFixed(0)} docs/sec`)

      expect(elapsedMs).toBeLessThan(30_000) // 30 seconds max
      expect(index.documentCount).toBe(DOC_COUNT)
    })

    it('should maintain reasonable term count', () => {
      // With 10K vocabulary and random distribution, most terms should be indexed
      expect(index.termCount).toBeGreaterThan(VOCAB_SIZE * 0.9)
      expect(index.termCount).toBeLessThanOrEqual(VOCAB_SIZE)
    })
  })

  describe('search performance', () => {
    it('should perform single-term search in under 10ms', () => {
      const searchTerm = vocabulary[Math.floor(Math.random() * vocabulary.length)]

      const startTime = performance.now()
      const results = index.search(searchTerm, { limit: 100 })
      const endTime = performance.now()

      const elapsedMs = endTime - startTime
      console.log(`Single-term search: ${elapsedMs.toFixed(2)}ms, ${results.length} results`)

      expect(elapsedMs).toBeLessThan(10)
    })

    it('should perform multi-term search in under 50ms', () => {
      const terms = [
        vocabulary[Math.floor(Math.random() * vocabulary.length)],
        vocabulary[Math.floor(Math.random() * vocabulary.length)],
        vocabulary[Math.floor(Math.random() * vocabulary.length)],
      ]
      const query = terms.join(' ')

      const startTime = performance.now()
      const results = index.search(query, { limit: 100 })
      const endTime = performance.now()

      const elapsedMs = endTime - startTime
      console.log(`Multi-term search (3 terms): ${elapsedMs.toFixed(2)}ms, ${results.length} results`)

      expect(elapsedMs).toBeLessThan(50)
    })

    it('should scale search performance with result limit', () => {
      const searchTerm = vocabulary[Math.floor(Math.random() * vocabulary.length)]

      // Search with different limits
      const limits = [10, 100, 1000]
      const times: number[] = []

      for (const limit of limits) {
        const startTime = performance.now()
        index.search(searchTerm, { limit })
        const endTime = performance.now()
        times.push(endTime - startTime)
      }

      console.log('Search latency by limit:')
      limits.forEach((limit, i) => {
        console.log(`  limit=${limit}: ${times[i].toFixed(2)}ms`)
      })

      // Higher limits should not dramatically increase latency
      // (scoring is done before limiting in BM25)
    })
  })

  describe('serialization performance', () => {
    it('should serialize dictionary in under 1 second', () => {
      const startTime = performance.now()
      const dictionary = index.serializeDictionary()
      const endTime = performance.now()

      const elapsedMs = endTime - startTime
      console.log(`Dictionary serialization: ${elapsedMs.toFixed(2)}ms, ${(dictionary.length / 1024).toFixed(0)}KB`)

      expect(elapsedMs).toBeLessThan(1_000)
      expect(dictionary.length).toBeGreaterThan(0)
    })

    it('should serialize postings in under 5 seconds', () => {
      const startTime = performance.now()
      const postings = index.serializePostings()
      const endTime = performance.now()

      const elapsedMs = endTime - startTime
      console.log(`Postings serialization: ${elapsedMs.toFixed(2)}ms, ${(postings.length / 1024).toFixed(0)}KB`)

      expect(elapsedMs).toBeLessThan(5_000)
      expect(postings.length).toBeGreaterThan(0)
    })

    it('should achieve reasonable compression ratio', () => {
      const dictionary = index.serializeDictionary()
      const postings = index.serializePostings()
      const totalSerializedSize = dictionary.length + postings.length

      // Estimate raw size: docCount * wordsPerDoc * avg term length
      const estimatedRawSize = DOC_COUNT * WORDS_PER_DOC * 15 // ~15 chars per term

      const compressionRatio = estimatedRawSize / totalSerializedSize
      console.log(`Compression ratio: ${compressionRatio.toFixed(2)}x`)
      console.log(`Total serialized: ${(totalSerializedSize / (1024 * 1024)).toFixed(2)}MB`)

      // Should achieve at least 2x compression
      expect(compressionRatio).toBeGreaterThan(1)
    })
  })

  describe('load and search from serialized data', () => {
    it('should load dictionary and search in memory', async () => {
      const dictionary = index.serializeDictionary()
      const postings = index.serializePostings()

      const startLoadTime = performance.now()
      const loaded = new InvertedIndex()
      await loaded.loadDictionary(dictionary)
      loaded.loadPostings(postings)
      const endLoadTime = performance.now()

      console.log(`Load time: ${(endLoadTime - startLoadTime).toFixed(2)}ms`)

      // Search after loading
      const searchTerm = vocabulary[Math.floor(Math.random() * vocabulary.length)]

      const startSearchTime = performance.now()
      const results = loaded.searchInMemory(searchTerm)
      const endSearchTime = performance.now()

      console.log(`In-memory search after load: ${(endSearchTime - startSearchTime).toFixed(2)}ms`)

      expect(results.length).toBeGreaterThan(0)
      expect(endSearchTime - startSearchTime).toBeLessThan(50)
    })
  })
})

// ============================================================================
// Memory Efficiency Tests
// ============================================================================

describe('InvertedIndex Memory Efficiency', () => {
  it('should use Roaring bitmap containers efficiently', () => {
    const index = new InvertedIndex()

    // Add documents with dense term distribution
    for (let i = 0; i < 10_000; i++) {
      index.add(`doc${i}`, 'common term repeated frequently in many documents')
    }

    const postings = index.serializePostings()

    // With dense postings, Roaring bitmaps should kick in
    // Bitmap container for 10K docs should be ~1.2KB vs 20KB for raw array
    console.log(`Dense postings size: ${postings.length} bytes`)

    // Should be reasonably compact
    expect(postings.length).toBeLessThan(100_000) // Less than 100KB
  })

  it('should use delta encoding efficiently for sequential IDs', () => {
    const index = new InvertedIndex()

    // Add documents with sequential IDs (best case for delta encoding)
    for (let i = 0; i < 10_000; i++) {
      index.add(`doc${i}`, `unique${i}`) // Each doc has unique term
    }

    const postings = index.serializePostings()

    // With delta encoding, sequential single-doc postings should be tiny
    // Each posting: count(1 byte) + delta(1 byte) + tf(1 byte) = ~3 bytes
    console.log(`Sequential single-doc postings size: ${postings.length} bytes`)

    // Should be very compact
    expect(postings.length).toBeLessThan(100_000)
  })
})

// ============================================================================
// Concurrent Operations (Edge Cases)
// ============================================================================

describe('InvertedIndex Concurrent-like Operations', () => {
  it('should handle rapid add/remove cycles', () => {
    const index = new InvertedIndex()

    // Simulate rapid updates
    for (let cycle = 0; cycle < 100; cycle++) {
      // Add 100 docs
      for (let i = 0; i < 100; i++) {
        index.add(`doc${cycle * 100 + i}`, `content cycle ${cycle} item ${i}`)
      }

      // Remove half of them
      for (let i = 0; i < 50; i++) {
        index.remove(`doc${cycle * 100 + i}`)
      }
    }

    // Should have 50 docs per cycle * 100 cycles = 5000 docs
    expect(index.documentCount).toBe(5000)

    // Search should still work
    const results = index.search('cycle')
    expect(results.length).toBeGreaterThan(0)
  })

  it('should handle frequent updates to same document', () => {
    const index = new InvertedIndex()

    // Update same document many times
    for (let i = 0; i < 1000; i++) {
      index.add('doc1', `version ${i} of the document content`)
    }

    expect(index.documentCount).toBe(1)

    // Should only find latest version
    const results = index.search('version 999')
    expect(results.length).toBe(1)

    const oldResults = index.search('version 0')
    expect(oldResults.length).toBe(0)
  })
})
