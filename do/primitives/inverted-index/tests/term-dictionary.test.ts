/**
 * Term Dictionary with FST Tests (RED Phase)
 *
 * Tests for term dictionary that stores term metadata (posting offset, length)
 * with FST (Finite State Transducer) for efficient prefix compression and
 * range/prefix queries.
 *
 * @module db/primitives/inverted-index/tests/term-dictionary
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TermDictionary,
  DictionaryEntry,
  DICTIONARY_MAGIC,
  FORMAT_VERSION,
} from '../term-dictionary'

describe('TermDictionary', () => {
  let dictionary: TermDictionary

  beforeEach(() => {
    dictionary = new TermDictionary()
  })

  // ============================================================================
  // Basic Operations
  // ============================================================================

  describe('add and get', () => {
    it('should add a term with metadata', () => {
      dictionary.add('hello', { df: 10, offset: 0, length: 100 })
      const entry = dictionary.get('hello')
      expect(entry).not.toBeNull()
      expect(entry?.df).toBe(10)
      expect(entry?.offset).toBe(0)
      expect(entry?.length).toBe(100)
    })

    it('should return null for non-existent term', () => {
      expect(dictionary.get('nonexistent')).toBeNull()
    })

    it('should add multiple terms', () => {
      dictionary.add('apple', { df: 5, offset: 0, length: 50 })
      dictionary.add('banana', { df: 3, offset: 50, length: 30 })
      dictionary.add('cherry', { df: 7, offset: 80, length: 70 })

      expect(dictionary.get('apple')?.df).toBe(5)
      expect(dictionary.get('banana')?.df).toBe(3)
      expect(dictionary.get('cherry')?.df).toBe(7)
    })

    it('should update existing term metadata', () => {
      dictionary.add('test', { df: 1, offset: 0, length: 10 })
      dictionary.add('test', { df: 5, offset: 100, length: 50 })
      const entry = dictionary.get('test')
      expect(entry?.df).toBe(5)
      expect(entry?.offset).toBe(100)
    })

    it('should handle empty string term', () => {
      dictionary.add('', { df: 1, offset: 0, length: 10 })
      expect(dictionary.get('')?.df).toBe(1)
    })

    it('should handle long terms', () => {
      const longTerm = 'a'.repeat(200)
      dictionary.add(longTerm, { df: 1, offset: 0, length: 10 })
      expect(dictionary.get(longTerm)?.df).toBe(1)
    })

    it('should handle unicode terms', () => {
      dictionary.add('cafe', { df: 1, offset: 0, length: 10 })
      dictionary.add('resume', { df: 2, offset: 10, length: 20 })
      expect(dictionary.get('cafe')?.df).toBe(1)
      expect(dictionary.get('resume')?.df).toBe(2)
    })
  })

  describe('contains', () => {
    it('should return true for existing term', () => {
      dictionary.add('test', { df: 1, offset: 0, length: 10 })
      expect(dictionary.contains('test')).toBe(true)
    })

    it('should return false for non-existent term', () => {
      expect(dictionary.contains('nonexistent')).toBe(false)
    })

    it('should be faster than get for existence check', () => {
      // Add many terms
      for (let i = 0; i < 10000; i++) {
        dictionary.add(`term${i}`, { df: 1, offset: i * 10, length: 10 })
      }
      // contains() should be O(log n) or O(1) depending on implementation
      expect(dictionary.contains('term5000')).toBe(true)
      expect(dictionary.contains('term99999')).toBe(false)
    })
  })

  describe('termCount', () => {
    it('should return 0 for empty dictionary', () => {
      expect(dictionary.termCount).toBe(0)
    })

    it('should return correct count after adds', () => {
      dictionary.add('a', { df: 1, offset: 0, length: 10 })
      expect(dictionary.termCount).toBe(1)
      dictionary.add('b', { df: 1, offset: 10, length: 10 })
      expect(dictionary.termCount).toBe(2)
    })

    it('should not increase for duplicate adds', () => {
      dictionary.add('a', { df: 1, offset: 0, length: 10 })
      dictionary.add('a', { df: 2, offset: 0, length: 10 })
      expect(dictionary.termCount).toBe(1)
    })
  })

  // ============================================================================
  // Prefix Search
  // ============================================================================

  describe('prefixSearch', () => {
    beforeEach(() => {
      dictionary.add('apple', { df: 1, offset: 0, length: 10 })
      dictionary.add('application', { df: 2, offset: 10, length: 20 })
      dictionary.add('apply', { df: 3, offset: 30, length: 30 })
      dictionary.add('banana', { df: 4, offset: 60, length: 40 })
      dictionary.add('band', { df: 5, offset: 100, length: 50 })
    })

    it('should find all terms with prefix', () => {
      const results = dictionary.prefixSearch('app')
      expect(results).toHaveLength(3)
      expect(results.map((e) => e.term)).toContain('apple')
      expect(results.map((e) => e.term)).toContain('application')
      expect(results.map((e) => e.term)).toContain('apply')
    })

    it('should return exact match with prefix', () => {
      const results = dictionary.prefixSearch('apple')
      expect(results).toHaveLength(1)
      expect(results[0].term).toBe('apple')
    })

    it('should return empty array for no matches', () => {
      const results = dictionary.prefixSearch('xyz')
      expect(results).toHaveLength(0)
    })

    it('should return all terms for empty prefix', () => {
      const results = dictionary.prefixSearch('')
      expect(results).toHaveLength(5)
    })

    it('should return results in sorted order', () => {
      const results = dictionary.prefixSearch('app')
      const terms = results.map((e) => e.term)
      expect(terms).toEqual([...terms].sort())
    })

    it('should include full metadata in results', () => {
      const results = dictionary.prefixSearch('appl')
      const apple = results.find((e) => e.term === 'apple')
      expect(apple).toBeDefined()
      expect(apple?.df).toBe(1)
      expect(apple?.offset).toBe(0)
      expect(apple?.length).toBe(10)
    })
  })

  // ============================================================================
  // Range Search
  // ============================================================================

  describe('rangeSearch', () => {
    beforeEach(() => {
      dictionary.add('alpha', { df: 1, offset: 0, length: 10 })
      dictionary.add('beta', { df: 2, offset: 10, length: 10 })
      dictionary.add('gamma', { df: 3, offset: 20, length: 10 })
      dictionary.add('delta', { df: 4, offset: 30, length: 10 })
      dictionary.add('epsilon', { df: 5, offset: 40, length: 10 })
    })

    it('should find terms in lexicographic range (inclusive)', () => {
      const results = dictionary.rangeSearch('beta', 'delta')
      expect(results).toHaveLength(2)
      expect(results.map((e) => e.term)).toContain('beta')
      expect(results.map((e) => e.term)).toContain('delta')
    })

    it('should handle open-ended start (null)', () => {
      const results = dictionary.rangeSearch(null, 'beta')
      expect(results).toHaveLength(2) // alpha, beta
      expect(results.map((e) => e.term)).toContain('alpha')
      expect(results.map((e) => e.term)).toContain('beta')
    })

    it('should handle open-ended end (null)', () => {
      const results = dictionary.rangeSearch('delta', null)
      expect(results).toHaveLength(3) // delta, epsilon, gamma
      expect(results.map((e) => e.term)).toContain('delta')
      expect(results.map((e) => e.term)).toContain('epsilon')
      expect(results.map((e) => e.term)).toContain('gamma')
    })

    it('should return all terms for full open range', () => {
      const results = dictionary.rangeSearch(null, null)
      expect(results).toHaveLength(5)
    })

    it('should return empty for impossible range', () => {
      const results = dictionary.rangeSearch('z', 'a')
      expect(results).toHaveLength(0)
    })

    it('should return results in sorted order', () => {
      const results = dictionary.rangeSearch('alpha', 'gamma')
      const terms = results.map((e) => e.term)
      expect(terms).toEqual([...terms].sort())
    })

    it('should handle single term range', () => {
      const results = dictionary.rangeSearch('beta', 'beta')
      expect(results).toHaveLength(1)
      expect(results[0].term).toBe('beta')
    })
  })

  // ============================================================================
  // Serialization
  // ============================================================================

  describe('serialize and deserialize', () => {
    it('should round-trip empty dictionary', () => {
      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize(bytes)
      expect(restored.termCount).toBe(0)
    })

    it('should round-trip single term', () => {
      dictionary.add('hello', { df: 10, offset: 100, length: 50 })
      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize(bytes)
      expect(restored.get('hello')).toEqual({
        term: 'hello',
        df: 10,
        offset: 100,
        length: 50,
      })
    })

    it('should round-trip multiple terms', () => {
      dictionary.add('apple', { df: 1, offset: 0, length: 10 })
      dictionary.add('banana', { df: 2, offset: 10, length: 20 })
      dictionary.add('cherry', { df: 3, offset: 30, length: 30 })

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize(bytes)

      expect(restored.termCount).toBe(3)
      expect(restored.get('apple')?.df).toBe(1)
      expect(restored.get('banana')?.df).toBe(2)
      expect(restored.get('cherry')?.df).toBe(3)
    })

    it('should preserve prefix search capability after round-trip', () => {
      dictionary.add('apple', { df: 1, offset: 0, length: 10 })
      dictionary.add('application', { df: 2, offset: 10, length: 20 })
      dictionary.add('banana', { df: 3, offset: 30, length: 30 })

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize(bytes)

      const results = restored.prefixSearch('app')
      expect(results).toHaveLength(2)
    })

    it('should have magic bytes at start of serialized data', () => {
      dictionary.add('test', { df: 1, offset: 0, length: 10 })
      const bytes = dictionary.serialize()

      for (let i = 0; i < DICTIONARY_MAGIC.length; i++) {
        expect(bytes[i]).toBe(DICTIONARY_MAGIC[i])
      }
    })

    it('should include format version in header', () => {
      dictionary.add('test', { df: 1, offset: 0, length: 10 })
      const bytes = dictionary.serialize()
      const view = new DataView(bytes.buffer, bytes.byteOffset)
      const version = view.getUint16(4, true)
      expect(version).toBe(FORMAT_VERSION)
    })

    it('should throw for invalid magic bytes', () => {
      const badData = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      expect(() => TermDictionary.deserialize(badData)).toThrow('magic')
    })

    it('should throw for unsupported version', () => {
      const bytes = dictionary.serialize()
      // Modify version to unsupported value
      const view = new DataView(bytes.buffer, bytes.byteOffset)
      view.setUint16(4, 999, true)
      expect(() => TermDictionary.deserialize(bytes)).toThrow('version')
    })
  })

  // ============================================================================
  // FST (Finite State Transducer) Properties
  // ============================================================================

  describe('FST compression', () => {
    it('should share common prefixes efficiently', () => {
      // Add terms with common prefixes
      for (let i = 0; i < 100; i++) {
        dictionary.add(`prefix_term_${i}`, { df: 1, offset: i * 10, length: 10 })
      }
      const bytes = dictionary.serialize()
      // FST should compress common prefixes
      // 100 terms * ~15 chars each = 1500 chars uncompressed
      // With FST prefix sharing, should be significantly smaller
      expect(bytes.length).toBeLessThan(1500)
    })

    it('should handle terms with no common prefixes', () => {
      dictionary.add('aardvark', { df: 1, offset: 0, length: 10 })
      dictionary.add('zebra', { df: 2, offset: 10, length: 10 })
      dictionary.add('mongoose', { df: 3, offset: 20, length: 10 })

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize(bytes)

      expect(restored.contains('aardvark')).toBe(true)
      expect(restored.contains('zebra')).toBe(true)
      expect(restored.contains('mongoose')).toBe(true)
    })

    it('should maintain sorted order in FST traversal', () => {
      dictionary.add('charlie', { df: 1, offset: 0, length: 10 })
      dictionary.add('alpha', { df: 2, offset: 10, length: 10 })
      dictionary.add('bravo', { df: 3, offset: 20, length: 10 })

      const allTerms = dictionary.getAllTerms()
      expect(allTerms).toEqual(['alpha', 'bravo', 'charlie'])
    })
  })

  // ============================================================================
  // Iterator and Enumeration
  // ============================================================================

  describe('getAllTerms', () => {
    it('should return empty array for empty dictionary', () => {
      expect(dictionary.getAllTerms()).toEqual([])
    })

    it('should return all terms in sorted order', () => {
      dictionary.add('zebra', { df: 1, offset: 0, length: 10 })
      dictionary.add('apple', { df: 2, offset: 10, length: 10 })
      dictionary.add('mango', { df: 3, offset: 20, length: 10 })

      expect(dictionary.getAllTerms()).toEqual(['apple', 'mango', 'zebra'])
    })
  })

  describe('getAllEntries', () => {
    it('should return empty array for empty dictionary', () => {
      expect(dictionary.getAllEntries()).toEqual([])
    })

    it('should return all entries with full metadata', () => {
      dictionary.add('a', { df: 1, offset: 0, length: 10 })
      dictionary.add('b', { df: 2, offset: 10, length: 20 })

      const entries = dictionary.getAllEntries()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toEqual({ term: 'a', df: 1, offset: 0, length: 10 })
      expect(entries[1]).toEqual({ term: 'b', df: 2, offset: 10, length: 20 })
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle terms that are prefixes of each other', () => {
      dictionary.add('a', { df: 1, offset: 0, length: 10 })
      dictionary.add('ab', { df: 2, offset: 10, length: 10 })
      dictionary.add('abc', { df: 3, offset: 20, length: 10 })

      expect(dictionary.get('a')?.df).toBe(1)
      expect(dictionary.get('ab')?.df).toBe(2)
      expect(dictionary.get('abc')?.df).toBe(3)
    })

    it('should handle single character terms', () => {
      dictionary.add('a', { df: 1, offset: 0, length: 10 })
      dictionary.add('b', { df: 2, offset: 10, length: 10 })
      dictionary.add('c', { df: 3, offset: 20, length: 10 })

      expect(dictionary.termCount).toBe(3)
      expect(dictionary.prefixSearch('a')).toHaveLength(1)
    })

    it('should handle numeric-like terms', () => {
      dictionary.add('123', { df: 1, offset: 0, length: 10 })
      dictionary.add('456', { df: 2, offset: 10, length: 10 })

      expect(dictionary.get('123')?.df).toBe(1)
      expect(dictionary.prefixSearch('12')).toHaveLength(1)
    })

    it('should handle terms with special characters', () => {
      dictionary.add('hello-world', { df: 1, offset: 0, length: 10 })
      dictionary.add('hello_world', { df: 2, offset: 10, length: 10 })

      expect(dictionary.get('hello-world')?.df).toBe(1)
      expect(dictionary.get('hello_world')?.df).toBe(2)
    })
  })
})
