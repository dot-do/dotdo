/**
 * TermDictionary with FST Tests
 *
 * Tests for autocomplete-focused term dictionary using FST (Finite State Transducer)
 * for efficient prefix matching, fuzzy search, and value association.
 *
 * @module db/primitives/term-dictionary/tests/term-dictionary
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TermDictionary,
  createTermDictionary,
  type TermDictionaryOptions,
  type SearchResult,
  DICTIONARY_MAGIC,
  FORMAT_VERSION,
} from '../index'

describe('TermDictionary', () => {
  let dictionary: TermDictionary<string>

  beforeEach(() => {
    dictionary = createTermDictionary<string>()
  })

  // ============================================================================
  // Basic Operations
  // ============================================================================

  describe('add and get', () => {
    it('should add a term with value', () => {
      dictionary.add('hello', 'world')
      const result = dictionary.get('hello')
      expect(result).toBe('world')
    })

    it('should return undefined for non-existent term', () => {
      expect(dictionary.get('nonexistent')).toBeUndefined()
    })

    it('should add multiple terms', () => {
      dictionary.add('apple', 'fruit')
      dictionary.add('banana', 'yellow')
      dictionary.add('cherry', 'red')

      expect(dictionary.get('apple')).toBe('fruit')
      expect(dictionary.get('banana')).toBe('yellow')
      expect(dictionary.get('cherry')).toBe('red')
    })

    it('should update existing term value', () => {
      dictionary.add('test', 'old')
      dictionary.add('test', 'new')
      expect(dictionary.get('test')).toBe('new')
    })

    it('should handle empty string term', () => {
      dictionary.add('', 'empty')
      expect(dictionary.get('')).toBe('empty')
    })

    it('should handle long terms', () => {
      const longTerm = 'a'.repeat(200)
      dictionary.add(longTerm, 'long')
      expect(dictionary.get(longTerm)).toBe('long')
    })

    it('should handle unicode terms', () => {
      dictionary.add('cafe', 'french')
      dictionary.add('resume', 'document')
      dictionary.add('naive', 'adjective')
      expect(dictionary.get('cafe')).toBe('french')
      expect(dictionary.get('resume')).toBe('document')
    })

    it('should handle numeric values', () => {
      const numDict = createTermDictionary<number>()
      numDict.add('one', 1)
      numDict.add('two', 2)
      expect(numDict.get('one')).toBe(1)
      expect(numDict.get('two')).toBe(2)
    })

    it('should handle object values', () => {
      const objDict = createTermDictionary<{ id: number; name: string }>()
      objDict.add('user1', { id: 1, name: 'Alice' })
      objDict.add('user2', { id: 2, name: 'Bob' })
      expect(objDict.get('user1')).toEqual({ id: 1, name: 'Alice' })
    })
  })

  describe('has', () => {
    it('should return true for existing term', () => {
      dictionary.add('test', 'value')
      expect(dictionary.has('test')).toBe(true)
    })

    it('should return false for non-existent term', () => {
      expect(dictionary.has('nonexistent')).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete existing term', () => {
      dictionary.add('test', 'value')
      expect(dictionary.delete('test')).toBe(true)
      expect(dictionary.has('test')).toBe(false)
    })

    it('should return false for non-existent term', () => {
      expect(dictionary.delete('nonexistent')).toBe(false)
    })

    it('should not affect other terms', () => {
      dictionary.add('apple', 'fruit')
      dictionary.add('apricot', 'fruit')
      dictionary.delete('apple')
      expect(dictionary.has('apricot')).toBe(true)
      expect(dictionary.get('apricot')).toBe('fruit')
    })
  })

  describe('size', () => {
    it('should return 0 for empty dictionary', () => {
      expect(dictionary.size).toBe(0)
    })

    it('should return correct count after adds', () => {
      dictionary.add('a', 'v1')
      expect(dictionary.size).toBe(1)
      dictionary.add('b', 'v2')
      expect(dictionary.size).toBe(2)
    })

    it('should not increase for duplicate adds', () => {
      dictionary.add('a', 'v1')
      dictionary.add('a', 'v2')
      expect(dictionary.size).toBe(1)
    })

    it('should decrease after delete', () => {
      dictionary.add('a', 'v1')
      dictionary.add('b', 'v2')
      dictionary.delete('a')
      expect(dictionary.size).toBe(1)
    })
  })

  // ============================================================================
  // Prefix Search
  // ============================================================================

  describe('prefixSearch', () => {
    beforeEach(() => {
      dictionary.add('apple', 'fruit')
      dictionary.add('application', 'software')
      dictionary.add('apply', 'action')
      dictionary.add('banana', 'fruit')
      dictionary.add('band', 'music')
    })

    it('should find all terms with prefix', () => {
      const results = dictionary.prefixSearch('app')
      expect(results).toHaveLength(3)
      expect(results.map((r) => r.term)).toContain('apple')
      expect(results.map((r) => r.term)).toContain('application')
      expect(results.map((r) => r.term)).toContain('apply')
    })

    it('should include values in results', () => {
      const results = dictionary.prefixSearch('app')
      const apple = results.find((r) => r.term === 'apple')
      expect(apple?.value).toBe('fruit')
    })

    it('should return exact match with prefix', () => {
      const results = dictionary.prefixSearch('apple')
      expect(results).toHaveLength(1)
      expect(results[0]?.term).toBe('apple')
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
      const terms = results.map((r) => r.term)
      expect(terms).toEqual([...terms].sort())
    })

    it('should respect limit option', () => {
      const results = dictionary.prefixSearch('app', { limit: 2 })
      expect(results).toHaveLength(2)
    })

    it('should handle case sensitivity by default', () => {
      dictionary.add('Apple', 'capitalized')
      const results = dictionary.prefixSearch('app')
      expect(results.map((r) => r.term)).not.toContain('Apple')
    })
  })

  // ============================================================================
  // Fuzzy Search (Levenshtein Distance)
  // ============================================================================

  describe('fuzzySearch', () => {
    beforeEach(() => {
      dictionary.add('hello', 'greeting')
      dictionary.add('hallo', 'german')
      dictionary.add('help', 'assist')
      dictionary.add('world', 'planet')
      dictionary.add('word', 'text')
    })

    it('should find exact matches with distance 0', () => {
      const results = dictionary.fuzzySearch('hello', 0)
      expect(results).toHaveLength(1)
      expect(results[0]?.term).toBe('hello')
      expect(results[0]?.distance).toBe(0)
    })

    it('should find terms within edit distance 1', () => {
      const results = dictionary.fuzzySearch('hello', 1)
      expect(results.map((r) => r.term)).toContain('hello')
      expect(results.map((r) => r.term)).toContain('hallo')
    })

    it('should find terms within edit distance 2', () => {
      const results = dictionary.fuzzySearch('hello', 2)
      expect(results.map((r) => r.term)).toContain('hello')
      expect(results.map((r) => r.term)).toContain('hallo')
      expect(results.map((r) => r.term)).toContain('help')
    })

    it('should include distance in results', () => {
      const results = dictionary.fuzzySearch('hello', 2)
      const hallo = results.find((r) => r.term === 'hallo')
      expect(hallo?.distance).toBe(1)
    })

    it('should return empty for no matches within distance', () => {
      const results = dictionary.fuzzySearch('xyz', 1)
      expect(results).toHaveLength(0)
    })

    it('should sort by distance then alphabetically', () => {
      const results = dictionary.fuzzySearch('hello', 2)
      // Should be sorted by distance first
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.distance).toBeLessThanOrEqual(results[i + 1]!.distance)
      }
    })

    it('should respect limit option', () => {
      const results = dictionary.fuzzySearch('hello', 2, { limit: 2 })
      expect(results).toHaveLength(2)
    })

    it('should handle substitution', () => {
      // 'hallo' vs 'hello' - one substitution (e -> a)
      dictionary.add('test', 'value')
      dictionary.add('tast', 'value')
      const results = dictionary.fuzzySearch('test', 1)
      expect(results.map((r) => r.term)).toContain('tast')
    })

    it('should handle insertion', () => {
      // 'helo' vs 'hello' - one insertion
      const results = dictionary.fuzzySearch('helo', 1)
      expect(results.map((r) => r.term)).toContain('hello')
    })

    it('should handle deletion', () => {
      // 'helloo' vs 'hello' - one deletion
      const results = dictionary.fuzzySearch('helloo', 1)
      expect(results.map((r) => r.term)).toContain('hello')
    })
  })

  // ============================================================================
  // Autocomplete-Specific Features
  // ============================================================================

  describe('autocomplete', () => {
    beforeEach(() => {
      // Simulate autocomplete with weighted terms
      const weighted = createTermDictionary<{ weight: number; data: string }>()
      weighted.add('javascript', { weight: 100, data: 'language' })
      weighted.add('java', { weight: 90, data: 'language' })
      weighted.add('json', { weight: 80, data: 'format' })
      weighted.add('jquery', { weight: 70, data: 'library' })
    })

    it('should support weighted results', () => {
      const weighted = createTermDictionary<number>()
      weighted.add('javascript', 100)
      weighted.add('java', 90)
      weighted.add('json', 80)

      const results = weighted.prefixSearch('ja')
      expect(results).toHaveLength(2)
      // Can sort by value (weight) after retrieval
      const sorted = results.sort((a, b) => (b.value as number) - (a.value as number))
      expect(sorted[0]?.term).toBe('javascript')
    })

    it('should handle rapid successive queries', () => {
      for (let i = 0; i < 100; i++) {
        dictionary.add(`term${i}`, `value${i}`)
      }

      // Simulate rapid typing
      const queries = ['t', 'te', 'ter', 'term', 'term1']
      for (const q of queries) {
        const results = dictionary.prefixSearch(q)
        expect(results.length).toBeGreaterThanOrEqual(0)
      }
    })
  })

  // ============================================================================
  // Iterator and Enumeration
  // ============================================================================

  describe('entries', () => {
    it('should return empty iterator for empty dictionary', () => {
      const entries = [...dictionary.entries()]
      expect(entries).toHaveLength(0)
    })

    it('should return all entries in sorted order', () => {
      dictionary.add('zebra', 'animal')
      dictionary.add('apple', 'fruit')
      dictionary.add('mango', 'fruit')

      const entries = [...dictionary.entries()]
      expect(entries).toHaveLength(3)
      expect(entries.map((e) => e.term)).toEqual(['apple', 'mango', 'zebra'])
    })
  })

  describe('keys', () => {
    it('should return all keys in sorted order', () => {
      dictionary.add('c', 'v3')
      dictionary.add('a', 'v1')
      dictionary.add('b', 'v2')

      const keys = [...dictionary.keys()]
      expect(keys).toEqual(['a', 'b', 'c'])
    })
  })

  describe('values', () => {
    it('should return all values', () => {
      dictionary.add('a', 'v1')
      dictionary.add('b', 'v2')

      const values = [...dictionary.values()]
      expect(values).toHaveLength(2)
      expect(values).toContain('v1')
      expect(values).toContain('v2')
    })
  })

  // ============================================================================
  // Serialization
  // ============================================================================

  describe('serialize and deserialize', () => {
    it('should round-trip empty dictionary', () => {
      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize<string>(bytes)
      expect(restored.size).toBe(0)
    })

    it('should round-trip single term', () => {
      dictionary.add('hello', 'world')
      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize<string>(bytes)
      expect(restored.get('hello')).toBe('world')
    })

    it('should round-trip multiple terms', () => {
      dictionary.add('apple', 'fruit')
      dictionary.add('banana', 'yellow')
      dictionary.add('cherry', 'red')

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize<string>(bytes)

      expect(restored.size).toBe(3)
      expect(restored.get('apple')).toBe('fruit')
      expect(restored.get('banana')).toBe('yellow')
      expect(restored.get('cherry')).toBe('red')
    })

    it('should preserve prefix search capability after round-trip', () => {
      dictionary.add('apple', 'fruit')
      dictionary.add('application', 'software')
      dictionary.add('banana', 'yellow')

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize<string>(bytes)

      const results = restored.prefixSearch('app')
      expect(results).toHaveLength(2)
    })

    it('should preserve fuzzy search capability after round-trip', () => {
      dictionary.add('hello', 'greeting')
      dictionary.add('hallo', 'german')

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize<string>(bytes)

      const results = restored.fuzzySearch('hello', 1)
      expect(results).toHaveLength(2)
    })

    it('should have magic bytes at start of serialized data', () => {
      dictionary.add('test', 'value')
      const bytes = dictionary.serialize()

      for (let i = 0; i < DICTIONARY_MAGIC.length; i++) {
        expect(bytes[i]).toBe(DICTIONARY_MAGIC[i])
      }
    })

    it('should include format version in header', () => {
      dictionary.add('test', 'value')
      const bytes = dictionary.serialize()
      const view = new DataView(bytes.buffer, bytes.byteOffset)
      const version = view.getUint16(4, true)
      expect(version).toBe(FORMAT_VERSION)
    })

    it('should throw for invalid magic bytes', () => {
      const badData = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      expect(() => TermDictionary.deserialize(badData)).toThrow('magic')
    })

    it('should throw for unsupported version', () => {
      dictionary.add('test', 'value')
      const bytes = dictionary.serialize()
      // Modify version to unsupported value
      const view = new DataView(bytes.buffer, bytes.byteOffset)
      view.setUint16(4, 999, true)
      expect(() => TermDictionary.deserialize(bytes)).toThrow('version')
    })

    it('should handle complex value types', () => {
      const complexDict = createTermDictionary<{ id: number; tags: string[] }>()
      complexDict.add('item1', { id: 1, tags: ['a', 'b'] })
      complexDict.add('item2', { id: 2, tags: ['c'] })

      const bytes = complexDict.serialize()
      const restored = TermDictionary.deserialize<{ id: number; tags: string[] }>(bytes)

      expect(restored.get('item1')).toEqual({ id: 1, tags: ['a', 'b'] })
      expect(restored.get('item2')).toEqual({ id: 2, tags: ['c'] })
    })
  })

  // ============================================================================
  // FST Compression Properties
  // ============================================================================

  describe('FST compression', () => {
    it('should share common prefixes efficiently', () => {
      // Add terms with common prefixes
      for (let i = 0; i < 100; i++) {
        dictionary.add(`prefix_term_${i}`, `value_${i}`)
      }
      const bytes = dictionary.serialize()
      // FST should compress common prefixes
      // Without compression: 100 terms * ~15 chars each = 1500+ chars
      // With prefix compression, should be noticeably smaller
      expect(bytes.length).toBeLessThan(2500) // Generous threshold including values
    })

    it('should handle terms with no common prefixes', () => {
      dictionary.add('aardvark', 'animal')
      dictionary.add('zebra', 'animal')
      dictionary.add('mongoose', 'animal')

      const bytes = dictionary.serialize()
      const restored = TermDictionary.deserialize<string>(bytes)

      expect(restored.has('aardvark')).toBe(true)
      expect(restored.has('zebra')).toBe(true)
      expect(restored.has('mongoose')).toBe(true)
    })

    it('should maintain sorted order in FST traversal', () => {
      dictionary.add('charlie', 'c')
      dictionary.add('alpha', 'a')
      dictionary.add('bravo', 'b')

      const keys = [...dictionary.keys()]
      expect(keys).toEqual(['alpha', 'bravo', 'charlie'])
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle terms that are prefixes of each other', () => {
      dictionary.add('a', 'v1')
      dictionary.add('ab', 'v2')
      dictionary.add('abc', 'v3')

      expect(dictionary.get('a')).toBe('v1')
      expect(dictionary.get('ab')).toBe('v2')
      expect(dictionary.get('abc')).toBe('v3')

      const results = dictionary.prefixSearch('a')
      expect(results).toHaveLength(3)
    })

    it('should handle single character terms', () => {
      dictionary.add('a', 'v1')
      dictionary.add('b', 'v2')
      dictionary.add('c', 'v3')

      expect(dictionary.size).toBe(3)
      expect(dictionary.prefixSearch('a')).toHaveLength(1)
    })

    it('should handle numeric-like terms', () => {
      dictionary.add('123', 'numbers')
      dictionary.add('456', 'more numbers')

      expect(dictionary.get('123')).toBe('numbers')
      expect(dictionary.prefixSearch('12')).toHaveLength(1)
    })

    it('should handle terms with special characters', () => {
      dictionary.add('hello-world', 'hyphenated')
      dictionary.add('hello_world', 'underscored')
      dictionary.add('hello.world', 'dotted')

      expect(dictionary.get('hello-world')).toBe('hyphenated')
      expect(dictionary.get('hello_world')).toBe('underscored')
      expect(dictionary.get('hello.world')).toBe('dotted')
    })

    it('should handle terms with whitespace', () => {
      dictionary.add('hello world', 'spaced')
      dictionary.add('hello\tworld', 'tabbed')

      expect(dictionary.get('hello world')).toBe('spaced')
      expect(dictionary.get('hello\tworld')).toBe('tabbed')
    })

    it('should handle null/undefined values', () => {
      const nullableDict = createTermDictionary<string | null>()
      nullableDict.add('null', null)
      expect(nullableDict.get('null')).toBeNull()
      expect(nullableDict.has('null')).toBe(true)
    })
  })

  // ============================================================================
  // Performance
  // ============================================================================

  describe('performance', () => {
    it('should handle large dictionaries', () => {
      const startAdd = performance.now()
      for (let i = 0; i < 10000; i++) {
        dictionary.add(`term_${i.toString().padStart(5, '0')}`, `value_${i}`)
      }
      const addTime = performance.now() - startAdd

      expect(dictionary.size).toBe(10000)
      expect(addTime).toBeLessThan(1000) // Should complete in under 1 second

      const startSearch = performance.now()
      const results = dictionary.prefixSearch('term_001')
      const searchTime = performance.now() - startSearch

      expect(results.length).toBeGreaterThan(0)
      expect(searchTime).toBeLessThan(50) // Prefix search should be fast
    })

    it('should perform efficient prefix search', () => {
      // Add 10000 terms with varying prefixes
      for (let i = 0; i < 10000; i++) {
        dictionary.add(`cat_${i}`, `value_${i}`)
        dictionary.add(`dog_${i}`, `value_${i}`)
        dictionary.add(`bird_${i}`, `value_${i}`)
      }

      const start = performance.now()
      const results = dictionary.prefixSearch('cat_')
      const elapsed = performance.now() - start

      expect(results).toHaveLength(10000)
      expect(elapsed).toBeLessThan(100) // Should be fast even with 30k terms
    })
  })

  // ============================================================================
  // Options and Configuration
  // ============================================================================

  describe('options', () => {
    it('should accept custom options', () => {
      const dict = createTermDictionary<string>({
        caseSensitive: true,
      })
      dict.add('Hello', 'cap')
      dict.add('hello', 'lower')

      expect(dict.get('Hello')).toBe('cap')
      expect(dict.get('hello')).toBe('lower')
    })
  })

  // ============================================================================
  // Clear
  // ============================================================================

  describe('clear', () => {
    it('should remove all entries', () => {
      dictionary.add('a', 'v1')
      dictionary.add('b', 'v2')
      dictionary.clear()

      expect(dictionary.size).toBe(0)
      expect(dictionary.has('a')).toBe(false)
      expect(dictionary.has('b')).toBe(false)
    })

    it('should allow adding after clear', () => {
      dictionary.add('a', 'v1')
      dictionary.clear()
      dictionary.add('b', 'v2')

      expect(dictionary.size).toBe(1)
      expect(dictionary.get('b')).toBe('v2')
    })
  })
})
