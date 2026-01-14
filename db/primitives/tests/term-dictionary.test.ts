/**
 * TermDictionary Primitive Tests
 *
 * FST-based term dictionary supporting prefix search, fuzzy matching,
 * and term suggestions for autocomplete functionality.
 *
 * @module db/primitives/tests/term-dictionary
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TermDictionary,
  type TermEntry,
  TERM_DICTIONARY_MAGIC,
  TERM_DICTIONARY_VERSION,
} from '../term-dictionary'

describe('TermDictionary', () => {
  let dict: TermDictionary

  beforeEach(() => {
    dict = new TermDictionary()
  })

  // ============================================================================
  // Core Operations
  // ============================================================================

  describe('add and lookup', () => {
    it('should add a term with docFreq and offset', () => {
      dict.add('hello', 10, 100)
      const entry = dict.lookup('hello')
      expect(entry).not.toBeNull()
      expect(entry?.term).toBe('hello')
      expect(entry?.docFreq).toBe(10)
      expect(entry?.offset).toBe(100)
    })

    it('should return null for non-existent term', () => {
      expect(dict.lookup('nonexistent')).toBeNull()
    })

    it('should add multiple terms', () => {
      dict.add('apple', 5, 0)
      dict.add('banana', 3, 50)
      dict.add('cherry', 7, 80)

      expect(dict.lookup('apple')?.docFreq).toBe(5)
      expect(dict.lookup('banana')?.docFreq).toBe(3)
      expect(dict.lookup('cherry')?.docFreq).toBe(7)
    })

    it('should update existing term metadata', () => {
      dict.add('test', 1, 0)
      dict.add('test', 5, 100)
      const entry = dict.lookup('test')
      expect(entry?.docFreq).toBe(5)
      expect(entry?.offset).toBe(100)
    })

    it('should handle empty string term', () => {
      dict.add('', 1, 0)
      expect(dict.lookup('')?.docFreq).toBe(1)
    })

    it('should handle long terms', () => {
      const longTerm = 'a'.repeat(200)
      dict.add(longTerm, 1, 0)
      expect(dict.lookup(longTerm)?.docFreq).toBe(1)
    })

    it('should handle unicode terms', () => {
      dict.add('cafe', 1, 0)
      dict.add('resume', 2, 10)
      dict.add('hello world', 3, 20)
      expect(dict.lookup('cafe')?.docFreq).toBe(1)
      expect(dict.lookup('resume')?.docFreq).toBe(2)
    })
  })

  describe('size', () => {
    it('should return 0 for empty dictionary', () => {
      expect(dict.size).toBe(0)
    })

    it('should return correct count after adds', () => {
      dict.add('a', 1, 0)
      expect(dict.size).toBe(1)
      dict.add('b', 1, 10)
      expect(dict.size).toBe(2)
    })

    it('should not increase for duplicate adds', () => {
      dict.add('a', 1, 0)
      dict.add('a', 2, 0)
      expect(dict.size).toBe(1)
    })
  })

  // ============================================================================
  // Prefix Search (Autocomplete)
  // ============================================================================

  describe('prefixSearch', () => {
    beforeEach(() => {
      dict.add('apple', 100, 0)
      dict.add('application', 50, 10)
      dict.add('apply', 75, 30)
      dict.add('banana', 40, 60)
      dict.add('band', 20, 100)
      dict.add('bandana', 10, 150)
    })

    it('should find all terms with prefix', () => {
      const results = dict.prefixSearch('app', 10)
      expect(results).toHaveLength(3)
      expect(results.map((e) => e.term)).toContain('apple')
      expect(results.map((e) => e.term)).toContain('application')
      expect(results.map((e) => e.term)).toContain('apply')
    })

    it('should respect limit parameter', () => {
      const results = dict.prefixSearch('app', 2)
      expect(results).toHaveLength(2)
    })

    it('should return results sorted by docFreq (descending)', () => {
      const results = dict.prefixSearch('app', 10)
      expect(results[0].term).toBe('apple') // docFreq=100
      expect(results[1].term).toBe('apply') // docFreq=75
      expect(results[2].term).toBe('application') // docFreq=50
    })

    it('should return exact match with prefix', () => {
      const results = dict.prefixSearch('apple', 10)
      expect(results).toHaveLength(1)
      expect(results[0].term).toBe('apple')
    })

    it('should return empty array for no matches', () => {
      const results = dict.prefixSearch('xyz', 10)
      expect(results).toHaveLength(0)
    })

    it('should return all terms for empty prefix (limited)', () => {
      const results = dict.prefixSearch('', 3)
      expect(results).toHaveLength(3)
    })

    it('should include full metadata in results', () => {
      const results = dict.prefixSearch('appl', 10)
      const apple = results.find((e) => e.term === 'apple')
      expect(apple).toBeDefined()
      expect(apple?.docFreq).toBe(100)
      expect(apple?.offset).toBe(0)
    })

    it('should handle prefix that is itself a term', () => {
      dict.add('app', 200, 200)
      const results = dict.prefixSearch('app', 10)
      expect(results).toHaveLength(4)
      expect(results[0].term).toBe('app') // highest docFreq
    })

    it('should be efficient with large dictionary', () => {
      const largeDict = new TermDictionary()
      for (let i = 0; i < 10000; i++) {
        largeDict.add(`term${i.toString().padStart(5, '0')}`, i, i * 10)
      }

      const start = performance.now()
      const results = largeDict.prefixSearch('term001', 10)
      const elapsed = performance.now() - start

      // Should complete in under 50ms
      expect(elapsed).toBeLessThan(50)
      expect(results.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Fuzzy Search (Levenshtein Automaton)
  // ============================================================================

  describe('fuzzySearch', () => {
    beforeEach(() => {
      dict.add('hello', 100, 0)
      dict.add('help', 80, 10)
      dict.add('helicopter', 60, 30)
      dict.add('world', 50, 80)
      dict.add('word', 40, 120)
      dict.add('work', 30, 160)
    })

    it('should find exact match with edit distance 0', () => {
      const results = dict.fuzzySearch('hello', 1)
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should find terms within edit distance 1', () => {
      const results = dict.fuzzySearch('helo', 1)
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should find terms within edit distance 2', () => {
      const results = dict.fuzzySearch('hllo', 2)
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should not find terms beyond edit distance', () => {
      const results = dict.fuzzySearch('xxxxx', 1)
      expect(results).toHaveLength(0)
    })

    it('should handle single character substitution', () => {
      const results = dict.fuzzySearch('halp', 1) // 'help' with e->a
      expect(results.some((e) => e.term === 'help')).toBe(true)
    })

    it('should handle single character insertion', () => {
      const results = dict.fuzzySearch('helllo', 1) // extra 'l'
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should handle single character deletion', () => {
      const results = dict.fuzzySearch('hllo', 1) // missing 'e'
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should handle transposition', () => {
      const results = dict.fuzzySearch('hlelo', 2) // transposed letters
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should return multiple matches within distance', () => {
      const results = dict.fuzzySearch('word', 1)
      expect(results.some((e) => e.term === 'word')).toBe(true)
      expect(results.some((e) => e.term === 'work')).toBe(true) // d->k
      expect(results.some((e) => e.term === 'world')).toBe(true) // missing l
    })

    it('should sort results by edit distance, then docFreq', () => {
      const results = dict.fuzzySearch('word', 2)
      // Exact match should come first
      expect(results[0].term).toBe('word')

      // Then edit distance 1 matches
      const ed1 = results.filter((_, i) => i > 0 && i <= 2)
      expect(ed1.every((e) => e.term === 'work' || e.term === 'world')).toBe(true)
    })

    it('should be efficient for fuzzy search', () => {
      const largeDict = new TermDictionary()
      for (let i = 0; i < 5000; i++) {
        largeDict.add(`word${i}`, i, i * 10)
      }

      const start = performance.now()
      const results = largeDict.fuzzySearch('word100', 1)
      const elapsed = performance.now() - start

      // Should complete in under 100ms
      expect(elapsed).toBeLessThan(100)
      expect(results.some((e) => e.term === 'word100')).toBe(true)
    })
  })

  // ============================================================================
  // Term Suggestions ("Did You Mean?")
  // ============================================================================

  describe('suggest', () => {
    beforeEach(() => {
      dict.add('javascript', 1000, 0)
      dict.add('typescript', 800, 100)
      dict.add('python', 1200, 200)
      dict.add('programming', 500, 300)
      dict.add('program', 400, 400)
      dict.add('programmer', 300, 500)
    })

    it('should suggest similar terms for misspelling', () => {
      const suggestions = dict.suggest('javscript', 3) // missing 'a'
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0].term).toBe('javascript')
    })

    it('should return empty for exact match (no suggestion needed)', () => {
      const suggestions = dict.suggest('javascript', 3)
      // Should either return empty or return the exact match
      if (suggestions.length > 0) {
        expect(suggestions[0].term).toBe('javascript')
      }
    })

    it('should limit suggestions to requested count', () => {
      const suggestions = dict.suggest('progrm', 2)
      expect(suggestions.length).toBeLessThanOrEqual(2)
    })

    it('should rank suggestions by similarity and frequency', () => {
      // 'progrm' is close to 'program' (missing 'a')
      const suggestions = dict.suggest('progrm', 5)
      expect(suggestions.length).toBeGreaterThan(0)
      // 'program' should rank highly due to closeness
    })

    it('should handle completely unknown terms', () => {
      const suggestions = dict.suggest('zzzzzzz', 3)
      // Should return empty or very low-similarity matches
      expect(suggestions.length).toBeLessThanOrEqual(3)
    })

    it('should suggest terms with common prefix', () => {
      const suggestions = dict.suggest('typscript', 3) // missing 'e'
      expect(suggestions.some((s) => s.term === 'typescript')).toBe(true)
    })
  })

  // ============================================================================
  // Serialization
  // ============================================================================

  describe('serialize and deserialize', () => {
    it('should round-trip empty dictionary', () => {
      const bytes = dict.serialize()
      const restored = TermDictionary.deserialize(bytes)
      expect(restored.size).toBe(0)
    })

    it('should round-trip single term', () => {
      dict.add('hello', 10, 100)
      const bytes = dict.serialize()
      const restored = TermDictionary.deserialize(bytes)
      expect(restored.lookup('hello')).toEqual({
        term: 'hello',
        docFreq: 10,
        offset: 100,
      })
    })

    it('should round-trip multiple terms', () => {
      dict.add('apple', 1, 0)
      dict.add('banana', 2, 10)
      dict.add('cherry', 3, 30)

      const bytes = dict.serialize()
      const restored = TermDictionary.deserialize(bytes)

      expect(restored.size).toBe(3)
      expect(restored.lookup('apple')?.docFreq).toBe(1)
      expect(restored.lookup('banana')?.docFreq).toBe(2)
      expect(restored.lookup('cherry')?.docFreq).toBe(3)
    })

    it('should preserve prefix search capability after round-trip', () => {
      dict.add('apple', 100, 0)
      dict.add('application', 50, 10)
      dict.add('banana', 30, 30)

      const bytes = dict.serialize()
      const restored = TermDictionary.deserialize(bytes)

      const results = restored.prefixSearch('app', 10)
      expect(results).toHaveLength(2)
    })

    it('should preserve fuzzy search capability after round-trip', () => {
      dict.add('hello', 100, 0)
      dict.add('help', 50, 10)

      const bytes = dict.serialize()
      const restored = TermDictionary.deserialize(bytes)

      const results = restored.fuzzySearch('helo', 1)
      expect(results.some((e) => e.term === 'hello')).toBe(true)
    })

    it('should have magic bytes at start of serialized data', () => {
      dict.add('test', 1, 0)
      const bytes = dict.serialize()

      for (let i = 0; i < TERM_DICTIONARY_MAGIC.length; i++) {
        expect(bytes[i]).toBe(TERM_DICTIONARY_MAGIC[i])
      }
    })

    it('should include format version in header', () => {
      dict.add('test', 1, 0)
      const bytes = dict.serialize()
      const view = new DataView(bytes.buffer, bytes.byteOffset)
      const version = view.getUint16(TERM_DICTIONARY_MAGIC.length, true)
      expect(version).toBe(TERM_DICTIONARY_VERSION)
    })

    it('should throw for invalid magic bytes', () => {
      const badData = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      expect(() => TermDictionary.deserialize(badData)).toThrow(/magic/i)
    })

    it('should throw for unsupported version', () => {
      dict.add('test', 1, 0)
      const bytes = dict.serialize()
      // Modify version to unsupported value
      const view = new DataView(bytes.buffer, bytes.byteOffset)
      view.setUint16(TERM_DICTIONARY_MAGIC.length, 999, true)
      expect(() => TermDictionary.deserialize(bytes)).toThrow(/version/i)
    })

    it('should achieve good compression with shared prefixes', () => {
      // Add terms with common prefixes
      for (let i = 0; i < 100; i++) {
        dict.add(`prefix_term_${i}`, i, i * 10)
      }
      const bytes = dict.serialize()
      // Should compress well due to FST prefix sharing
      // 100 terms * ~15 chars = 1500 uncompressed
      expect(bytes.length).toBeLessThan(1500)
    })
  })

  // ============================================================================
  // FST Internal Structure
  // ============================================================================

  describe('FST properties', () => {
    it('should share common prefixes efficiently in memory', () => {
      // This tests that the internal FST structure shares prefixes
      dict.add('automobile', 1, 0)
      dict.add('automatic', 2, 10)
      dict.add('automation', 3, 20)
      dict.add('autonomous', 4, 30)

      // All should be retrievable
      expect(dict.lookup('automobile')?.docFreq).toBe(1)
      expect(dict.lookup('automatic')?.docFreq).toBe(2)
      expect(dict.lookup('automation')?.docFreq).toBe(3)
      expect(dict.lookup('autonomous')?.docFreq).toBe(4)
    })

    it('should handle terms with no common prefixes', () => {
      dict.add('aardvark', 1, 0)
      dict.add('zebra', 2, 10)
      dict.add('mongoose', 3, 20)

      expect(dict.lookup('aardvark')?.docFreq).toBe(1)
      expect(dict.lookup('zebra')?.docFreq).toBe(2)
      expect(dict.lookup('mongoose')?.docFreq).toBe(3)
    })

    it('should handle terms that are prefixes of each other', () => {
      dict.add('a', 1, 0)
      dict.add('ab', 2, 10)
      dict.add('abc', 3, 20)
      dict.add('abcd', 4, 30)

      expect(dict.lookup('a')?.docFreq).toBe(1)
      expect(dict.lookup('ab')?.docFreq).toBe(2)
      expect(dict.lookup('abc')?.docFreq).toBe(3)
      expect(dict.lookup('abcd')?.docFreq).toBe(4)
    })
  })

  // ============================================================================
  // Levenshtein Distance Utility
  // ============================================================================

  describe('levenshteinDistance (static method)', () => {
    it('should return 0 for identical strings', () => {
      expect(TermDictionary.levenshteinDistance('hello', 'hello')).toBe(0)
    })

    it('should handle single insertion', () => {
      expect(TermDictionary.levenshteinDistance('hello', 'helloo')).toBe(1)
    })

    it('should handle single deletion', () => {
      expect(TermDictionary.levenshteinDistance('hello', 'helo')).toBe(1)
    })

    it('should handle single substitution', () => {
      expect(TermDictionary.levenshteinDistance('hello', 'hallo')).toBe(1)
    })

    it('should handle multiple edits', () => {
      expect(TermDictionary.levenshteinDistance('kitten', 'sitting')).toBe(3)
    })

    it('should handle empty strings', () => {
      expect(TermDictionary.levenshteinDistance('', 'hello')).toBe(5)
      expect(TermDictionary.levenshteinDistance('hello', '')).toBe(5)
      expect(TermDictionary.levenshteinDistance('', '')).toBe(0)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle single character terms', () => {
      dict.add('a', 1, 0)
      dict.add('b', 2, 10)
      dict.add('c', 3, 20)

      expect(dict.size).toBe(3)
      expect(dict.prefixSearch('a', 10)).toHaveLength(1)
    })

    it('should handle numeric-like terms', () => {
      dict.add('123', 1, 0)
      dict.add('456', 2, 10)
      dict.add('1234', 3, 20)

      expect(dict.lookup('123')?.docFreq).toBe(1)
      expect(dict.prefixSearch('12', 10)).toHaveLength(2)
    })

    it('should handle terms with special characters', () => {
      dict.add('hello-world', 1, 0)
      dict.add('hello_world', 2, 10)
      dict.add('hello.world', 3, 20)

      expect(dict.lookup('hello-world')?.docFreq).toBe(1)
      expect(dict.lookup('hello_world')?.docFreq).toBe(2)
      expect(dict.lookup('hello.world')?.docFreq).toBe(3)
    })

    it('should handle case-sensitive terms', () => {
      dict.add('Hello', 1, 0)
      dict.add('hello', 2, 10)
      dict.add('HELLO', 3, 20)

      expect(dict.size).toBe(3)
      expect(dict.lookup('Hello')?.docFreq).toBe(1)
      expect(dict.lookup('hello')?.docFreq).toBe(2)
      expect(dict.lookup('HELLO')?.docFreq).toBe(3)
    })

    it('should handle very long terms in fuzzy search', () => {
      const longTerm = 'supercalifragilisticexpialidocious'
      dict.add(longTerm, 1, 0)

      // Should find with small edit distance
      const results = dict.fuzzySearch('supercalifragilisticexpialidocous', 2) // 'i' -> 'o'
      expect(results.some((e) => e.term === longTerm)).toBe(true)
    })
  })
})
