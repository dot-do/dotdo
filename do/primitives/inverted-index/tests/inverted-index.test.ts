/**
 * InvertedIndex Tests
 *
 * Comprehensive tests for the production InvertedIndex primitive
 * covering indexing, search, serialization, and streaming.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InvertedIndex,
  createInvertedIndex,
  loadInvertedIndex,
  tokenize,
  tokenizeWithFrequencies,
  INDEX_MAGIC,
  POSTINGS_MAGIC,
  INDEX_VERSION,
  type SearchResult,
  type RangeFetcher,
} from '../inverted-index'

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

    it('handles multiple spaces', () => {
      expect(tokenize('hello    world')).toEqual(['hello', 'world'])
    })

    it('handles special characters', () => {
      expect(tokenize('email@test.com')).toEqual(['email', 'test', 'com'])
    })

    it('handles unicode characters by filtering them out', () => {
      // Default tokenizer only keeps [a-z0-9]
      expect(tokenize('hello cafe')).toEqual(['hello', 'cafe'])
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

    it('handles empty string', () => {
      const freqs = tokenizeWithFrequencies('')
      expect(freqs.size).toBe(0)
    })

    it('accepts custom tokenizer', () => {
      const customTokenizer = (text: string) => text.split(',').map((t) => t.trim().toLowerCase())
      const freqs = tokenizeWithFrequencies('hello, world, hello', customTokenizer)
      expect(freqs.get('hello')).toBe(2)
      expect(freqs.get('world')).toBe(1)
    })
  })
})

// ============================================================================
// InvertedIndex Basic Operations Tests
// ============================================================================

describe('InvertedIndex', () => {
  let index: InvertedIndex

  beforeEach(() => {
    index = new InvertedIndex()
  })

  describe('constructor', () => {
    it('creates empty index with default options', () => {
      expect(index.documentCount).toBe(0)
      expect(index.termCount).toBe(0)
    })

    it('accepts custom BM25 parameters', () => {
      const customIndex = new InvertedIndex({ k1: 2.0, b: 0.5 })
      expect(customIndex.documentCount).toBe(0)
    })

    it('accepts custom tokenizer', () => {
      const customTokenizer = (text: string) => text.split('-')
      const customIndex = new InvertedIndex({ tokenizer: customTokenizer })
      customIndex.add('doc1', 'hello-world')
      expect(customIndex.hasTerm('hello')).toBe(true)
      expect(customIndex.hasTerm('world')).toBe(true)
    })
  })

  describe('add', () => {
    it('adds a document', () => {
      index.add('doc1', 'hello world')
      expect(index.documentCount).toBe(1)
      expect(index.hasDocument('doc1')).toBe(true)
    })

    it('indexes multiple documents', () => {
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

    it('handles empty text', () => {
      index.add('doc1', '')
      expect(index.documentCount).toBe(1)
      expect(index.termCount).toBe(0)
    })

    it('handles document with only punctuation', () => {
      index.add('doc1', '!!!???...')
      expect(index.documentCount).toBe(1)
      expect(index.termCount).toBe(0)
    })
  })

  describe('remove', () => {
    it('removes a document', () => {
      index.add('doc1', 'hello world')
      const removed = index.remove('doc1')

      expect(removed).toBe(true)
      expect(index.documentCount).toBe(0)
      expect(index.hasDocument('doc1')).toBe(false)
    })

    it('returns false for non-existent document', () => {
      const removed = index.remove('nonexistent')
      expect(removed).toBe(false)
    })

    it('updates term counts after removal', () => {
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')
      index.remove('doc1')

      expect(index.hasTerm('hello')).toBe(true) // Still in doc2
      expect(index.hasTerm('world')).toBe(false) // Only was in doc1
    })

    it('updates statistics after removal', () => {
      index.add('doc1', 'hello world foo bar')
      index.add('doc2', 'hello')

      const statsBefore = index.getStats()
      expect(statsBefore.totalDocs).toBe(2)

      index.remove('doc1')

      const statsAfter = index.getStats()
      expect(statsAfter.totalDocs).toBe(1)
      expect(statsAfter.avgDocLength).toBe(1)
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
      expect(results.length).toBe(2)
      expect(results.map((r) => r.id)).toContain('doc1')
      expect(results.map((r) => r.id)).toContain('doc3')
    })

    it('performs AND query for multiple terms', () => {
      const results = index.search('brown dog')
      expect(results.length).toBe(1)
      expect(results[0]!.id).toBe('doc2')
    })

    it('returns empty for missing terms', () => {
      const results = index.search('elephant')
      expect(results).toEqual([])
    })

    it('returns empty when any term is missing (AND semantics)', () => {
      const results = index.search('fox elephant')
      expect(results).toEqual([])
    })

    it('returns empty for empty query', () => {
      const results = index.search('')
      expect(results).toEqual([])
    })

    it('returns empty for query with only punctuation', () => {
      const results = index.search('!!!...')
      expect(results).toEqual([])
    })

    it('is case insensitive', () => {
      const results = index.search('FOX')
      expect(results.length).toBe(2)
    })
  })

  describe('search scoring', () => {
    it('ranks by BM25 score', () => {
      index.add('doc1', 'machine learning is great')
      index.add('doc2', 'machine learning machine learning rocks')
      index.add('doc3', 'deep learning is also great')

      const results = index.search('machine learning')

      expect(results.length).toBe(2)
      expect(results[0]!.id).toBe('doc2') // Higher TF for "machine"
      expect(results[1]!.id).toBe('doc1')
    })

    it('includes positive scores', () => {
      index.add('doc1', 'hello world')

      const results = index.search('hello')

      expect(results.length).toBe(1)
      expect(results[0]!.score).toBeGreaterThan(0)
    })

    it('ranks by term frequency', () => {
      index.add('doc1', 'apple')
      index.add('doc2', 'apple apple')
      index.add('doc3', 'apple apple apple')

      const results = index.search('apple')

      expect(results[0]!.id).toBe('doc3')
      expect(results[1]!.id).toBe('doc2')
      expect(results[2]!.id).toBe('doc1')
    })

    it('penalizes longer documents', () => {
      index.add('short', 'apple banana')
      index.add('long', 'apple banana cherry date elderberry fig grape')

      const results = index.search('apple')

      expect(results[0]!.id).toBe('short')
    })

    it('boosts rare terms', () => {
      // Add many docs with "the"
      for (let i = 0; i < 100; i++) {
        index.add(`common${i}`, 'the quick brown')
      }
      // Add one doc with unique term
      index.add('unique', 'the xylophone player')

      // Search for common + unique
      const results = index.search('the xylophone')

      expect(results[0]!.id).toBe('unique')
    })
  })

  describe('statistics', () => {
    it('tracks document count', () => {
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')

      const stats = index.getStats()
      expect(stats.totalDocs).toBe(2)
    })

    it('tracks total length', () => {
      index.add('doc1', 'hello world foo bar')
      index.add('doc2', 'hello')

      const stats = index.getStats()
      expect(stats.totalLength).toBe(5) // 4 + 1
    })

    it('calculates average document length', () => {
      index.add('doc1', 'hello world foo bar')
      index.add('doc2', 'hello')

      const stats = index.getStats()
      expect(stats.avgDocLength).toBe(2.5)
    })

    it('handles empty index', () => {
      const stats = index.getStats()
      expect(stats.totalDocs).toBe(0)
      expect(stats.avgDocLength).toBe(0)
      expect(stats.totalLength).toBe(0)
    })
  })

  describe('utility methods', () => {
    beforeEach(() => {
      index.add('doc1', 'hello world')
      index.add('doc2', 'hello there')
    })

    it('getDocumentIds returns all document IDs', () => {
      const ids = index.getDocumentIds()
      expect(ids).toContain('doc1')
      expect(ids).toContain('doc2')
      expect(ids.length).toBe(2)
    })

    it('hasDocument checks existence', () => {
      expect(index.hasDocument('doc1')).toBe(true)
      expect(index.hasDocument('nonexistent')).toBe(false)
    })

    it('getTerms returns all terms', () => {
      const terms = index.getTerms()
      expect(terms).toContain('hello')
      expect(terms).toContain('world')
      expect(terms).toContain('there')
    })

    it('hasTerm checks term existence', () => {
      expect(index.hasTerm('hello')).toBe(true)
      expect(index.hasTerm('nonexistent')).toBe(false)
    })

    it('getDocumentFrequency returns term df', () => {
      expect(index.getDocumentFrequency('hello')).toBe(2)
      expect(index.getDocumentFrequency('world')).toBe(1)
      expect(index.getDocumentFrequency('nonexistent')).toBe(0)
    })

    it('clear removes all data', () => {
      index.clear()

      expect(index.documentCount).toBe(0)
      expect(index.termCount).toBe(0)
      expect(index.getStats().totalDocs).toBe(0)
    })
  })
})

// ============================================================================
// Serialization Tests
// ============================================================================

describe('Serialization', () => {
  it('serializes and deserializes index', () => {
    const original = new InvertedIndex()
    original.add('doc1', 'hello world')
    original.add('doc2', 'hello there')

    const { dictionary, postings } = original.serialize()

    const restored = new InvertedIndex()
    restored.loadIndex(dictionary, postings)

    expect(restored.documentCount).toBe(2)
    expect(restored.hasTerm('hello')).toBe(true)
    expect(restored.hasTerm('world')).toBe(true)
    expect(restored.hasTerm('there')).toBe(true)
  })

  it('preserves search functionality after roundtrip', () => {
    const original = new InvertedIndex()
    original.add('doc1', 'the quick brown fox')
    original.add('doc2', 'the lazy brown dog')
    original.add('doc3', 'quick fox jumps')

    const { dictionary, postings } = original.serialize()

    const restored = new InvertedIndex()
    restored.loadIndex(dictionary, postings)

    const results = restored.search('quick fox')
    expect(results.map((r) => r.id).sort()).toEqual(['doc1', 'doc3'])
  })

  it('preserves BM25 scoring after roundtrip', () => {
    const original = new InvertedIndex()
    original.add('doc1', 'machine learning')
    original.add('doc2', 'machine machine learning')

    const originalResults = original.search('machine')

    const { dictionary, postings } = original.serialize()

    const restored = new InvertedIndex()
    restored.loadIndex(dictionary, postings)

    const restoredResults = restored.search('machine')

    expect(restoredResults[0]!.id).toBe(originalResults[0]!.id)
    // Scores should be approximately equal
    expect(Math.abs(restoredResults[0]!.score - originalResults[0]!.score)).toBeLessThan(0.001)
  })

  it('validates magic bytes', () => {
    const index = new InvertedIndex()
    index.add('doc1', 'hello')

    const { dictionary } = index.serialize()

    // Corrupt magic bytes
    dictionary[0] = 0x00

    expect(() => {
      const restored = new InvertedIndex()
      restored.loadIndex(dictionary)
    }).toThrow(/magic mismatch/)
  })

  it('handles empty index serialization', () => {
    const original = new InvertedIndex()
    const { dictionary, postings } = original.serialize()

    const restored = new InvertedIndex()
    restored.loadIndex(dictionary, postings)

    expect(restored.documentCount).toBe(0)
    expect(restored.termCount).toBe(0)
  })

  it('handles large document IDs', () => {
    const original = new InvertedIndex()
    original.add('very-long-document-id-that-might-cause-issues-12345', 'hello world')

    const { dictionary, postings } = original.serialize()

    const restored = new InvertedIndex()
    restored.loadIndex(dictionary, postings)

    expect(restored.hasDocument('very-long-document-id-that-might-cause-issues-12345')).toBe(true)
  })
})

// ============================================================================
// Streaming Search Tests
// ============================================================================

describe('Streaming Search', () => {
  let dictBytes: Uint8Array
  let postingsBytes: Uint8Array

  beforeEach(() => {
    const index = new InvertedIndex()
    index.add('doc1', 'the quick brown fox jumps over the lazy dog')
    index.add('doc2', 'a quick brown dog runs in the park')
    index.add('doc3', 'the lazy cat sleeps all day')
    index.add('doc4', 'quick quick quick is the name of the game')

    const serialized = index.serialize()
    dictBytes = serialized.dictionary
    postingsBytes = serialized.postings
  })

  it('searches with streaming fetch', async () => {
    const mockFetch: RangeFetcher = async (offset, length) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new InvertedIndex()
    index.loadIndex(dictBytes) // Load dict only, not postings

    const results = await index.searchStreaming('quick', mockFetch)

    expect(results.length).toBe(3)
    expect(results.map((r) => r.id)).toContain('doc1')
    expect(results.map((r) => r.id)).toContain('doc2')
    expect(results.map((r) => r.id)).toContain('doc4')
  })

  it('ranks streaming results by BM25', async () => {
    const mockFetch: RangeFetcher = async (offset, length) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new InvertedIndex()
    index.loadIndex(dictBytes)

    const results = await index.searchStreaming('quick', mockFetch)

    // doc4 has "quick" 3x, should rank highest
    expect(results[0]!.id).toBe('doc4')
  })

  it('performs AND query with streaming', async () => {
    const mockFetch: RangeFetcher = async (offset, length) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new InvertedIndex()
    index.loadIndex(dictBytes)

    const results = await index.searchStreaming('quick brown', mockFetch)

    // Only doc1 and doc2 have both "quick" and "brown"
    expect(results.length).toBe(2)
    expect(results.map((r) => r.id).sort()).toEqual(['doc1', 'doc2'])
  })

  it('returns empty for missing terms with streaming', async () => {
    const mockFetch: RangeFetcher = async (offset, length) => {
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new InvertedIndex()
    index.loadIndex(dictBytes)

    const results = await index.searchStreaming('elephant', mockFetch)
    expect(results).toEqual([])
  })

  it('tracks fetch count for efficiency analysis', async () => {
    let fetchCount = 0
    const mockFetch: RangeFetcher = async (offset, length) => {
      fetchCount++
      return postingsBytes.slice(offset, offset + length)
    }

    const index = new InvertedIndex()
    index.loadIndex(dictBytes)

    await index.searchStreaming('quick brown', mockFetch)

    // Should fetch 2 posting lists (one per term)
    expect(fetchCount).toBe(2)
  })

  it('throws error if dictionary not loaded', async () => {
    const mockFetch: RangeFetcher = async () => new Uint8Array(0)
    const index = new InvertedIndex()

    await expect(index.searchStreaming('test', mockFetch)).rejects.toThrow(/Dictionary not loaded/)
  })
})

// ============================================================================
// Large Index Tests
// ============================================================================

describe('Large Index', () => {
  it('indexes 1000+ documents', () => {
    const index = new InvertedIndex()

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
    const index = new InvertedIndex()

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
    const index = new InvertedIndex()

    for (let i = 0; i < 1000; i++) {
      index.add(`doc${i}`, `document number ${i}`)
    }

    const { dictionary, postings } = index.serialize()
    const totalSize = dictionary.length + postings.length

    // Should fit comfortably in 128MB Worker limit
    expect(totalSize).toBeLessThan(1024 * 1024) // < 1MB for this simple case
  })

  it('roundtrips 1000+ documents', () => {
    const original = new InvertedIndex()

    for (let i = 0; i < 1000; i++) {
      original.add(`doc${i}`, `document number ${i} category ${i % 5}`)
    }

    const { dictionary, postings } = original.serialize()

    const restored = new InvertedIndex()
    restored.loadIndex(dictionary, postings)

    expect(restored.documentCount).toBe(1000)

    const results = restored.search('category')
    expect(results.length).toBe(1000)
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createInvertedIndex', () => {
    it('creates index from document array', () => {
      const docs = [
        { id: 'doc1', text: 'hello world' },
        { id: 'doc2', text: 'hello there' },
      ]

      const index = createInvertedIndex(docs)

      expect(index.documentCount).toBe(2)
      expect(index.search('hello').length).toBe(2)
    })

    it('accepts options', () => {
      const docs = [{ id: 'doc1', text: 'hello-world' }]
      const customTokenizer = (text: string) => text.split('-')

      const index = createInvertedIndex(docs, { tokenizer: customTokenizer })

      expect(index.hasTerm('hello')).toBe(true)
      expect(index.hasTerm('world')).toBe(true)
    })
  })

  describe('loadInvertedIndex', () => {
    it('loads index from serialized data', () => {
      const original = new InvertedIndex()
      original.add('doc1', 'hello world')
      original.add('doc2', 'hello there')

      const { dictionary, postings } = original.serialize()

      const loaded = loadInvertedIndex(dictionary, postings)

      expect(loaded.documentCount).toBe(2)
      const results = loaded.search('hello')
      expect(results.length).toBe(2)
    })

    it('accepts options', () => {
      const original = new InvertedIndex()
      original.add('doc1', 'hello world')
      const { dictionary, postings } = original.serialize()

      const loaded = loadInvertedIndex(dictionary, postings, { k1: 2.0 })

      expect(loaded.documentCount).toBe(1)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let index: InvertedIndex

  beforeEach(() => {
    index = new InvertedIndex()
  })

  it('handles very long documents', () => {
    const longText = Array(10000).fill('word').join(' ')
    index.add('doc1', longText)

    expect(index.documentCount).toBe(1)
    expect(index.search('word').length).toBe(1)
  })

  it('handles duplicate terms in document', () => {
    index.add('doc1', 'hello hello hello world world')

    const results = index.search('hello')
    expect(results.length).toBe(1)
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it('handles numeric document IDs', () => {
    index.add('123', 'hello world')
    index.add('456', 'hello there')

    expect(index.hasDocument('123')).toBe(true)
    const results = index.search('hello')
    expect(results.length).toBe(2)
  })

  it('handles documents with same content', () => {
    index.add('doc1', 'identical content')
    index.add('doc2', 'identical content')

    const results = index.search('identical')
    expect(results.length).toBe(2)
    // Both should have same score
    expect(results[0]!.score).toBe(results[1]!.score)
  })

  it('handles re-adding same document multiple times', () => {
    index.add('doc1', 'first version')
    index.add('doc1', 'second version')
    index.add('doc1', 'third version')

    expect(index.documentCount).toBe(1)
    expect(index.hasTerm('third')).toBe(true)
    expect(index.hasTerm('first')).toBe(false)
    expect(index.hasTerm('second')).toBe(false)
  })

  it('handles search after all documents removed', () => {
    index.add('doc1', 'hello world')
    index.remove('doc1')

    const results = index.search('hello')
    expect(results).toEqual([])
    expect(index.termCount).toBe(0)
  })

  it('handles query with repeated terms', () => {
    index.add('doc1', 'hello world')
    index.add('doc2', 'hello there')

    // Query with repeated term - should still work
    const results = index.search('hello hello')
    expect(results.length).toBe(2)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('serializes 10K terms quickly', () => {
    const index = new InvertedIndex()

    for (let i = 0; i < 10000; i++) {
      index.add(`doc${i}`, `term${i} common word`)
    }

    const start = performance.now()
    const { dictionary, postings } = index.serialize()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1000) // < 1 second
    expect(dictionary.length).toBeGreaterThan(0)
    expect(postings.length).toBeGreaterThan(0)
  })

  it('deserializes 10K terms quickly', () => {
    const original = new InvertedIndex()

    for (let i = 0; i < 10000; i++) {
      original.add(`doc${i}`, `term${i} common word`)
    }

    const { dictionary, postings } = original.serialize()

    const start = performance.now()
    const index = new InvertedIndex()
    index.loadIndex(dictionary, postings)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500) // < 500ms
    expect(index.documentCount).toBe(10000)
  })

  it('searches 10K docs with BM25 quickly', () => {
    const index = new InvertedIndex()

    for (let i = 0; i < 10000; i++) {
      index.add(`doc${i}`, `document ${i} with some common words and unique term${i}`)
    }

    const start = performance.now()
    const results = index.search('common words')
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
    const index = new InvertedIndex()

    // Simulate realistic documents (100 words each)
    const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'and', 'cat']
    for (let i = 0; i < 10000; i++) {
      const text = Array(100)
        .fill(0)
        .map(() => words[Math.floor(Math.random() * words.length)]!)
        .join(' ')
      index.add(`doc${i}`, text)
    }

    const { dictionary, postings } = index.serialize()
    const totalSize = dictionary.length + postings.length

    // Should be well under 128MB
    expect(totalSize).toBeLessThan(10 * 1024 * 1024) // < 10MB
  })

  it('provides reasonable compression with delta encoding', () => {
    const index = new InvertedIndex()

    // Create term that appears in many consecutive docs
    for (let i = 0; i < 1000; i++) {
      index.add(`doc${i}`, 'common term appears everywhere')
    }

    const { postings } = index.serialize()

    // With delta encoding, 1000 consecutive IDs should compress well
    expect(postings.length).toBeLessThan(20000) // Very compact
  })
})
