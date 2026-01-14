/**
 * Phrase Query Tests (RED Phase)
 *
 * Tests for phrase queries that match sequences of terms in exact order.
 * Requires positional information in posting lists to verify term adjacency.
 *
 * @module db/primitives/inverted-index/tests/phrase-queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PositionalPosting,
  PositionalPostingList,
  PhraseQuery,
  PhraseQueryResult,
} from '../phrase-query'

describe('Phrase Queries', () => {
  // ============================================================================
  // PositionalPosting Structure
  // ============================================================================

  describe('PositionalPosting', () => {
    it('should store docId with positions array', () => {
      const posting: PositionalPosting = {
        docId: 1,
        positions: [0, 5, 10],
      }
      expect(posting.docId).toBe(1)
      expect(posting.positions).toEqual([0, 5, 10])
    })

    it('should handle single position', () => {
      const posting: PositionalPosting = {
        docId: 42,
        positions: [7],
      }
      expect(posting.positions).toHaveLength(1)
      expect(posting.positions[0]).toBe(7)
    })

    it('should handle empty positions array', () => {
      const posting: PositionalPosting = {
        docId: 1,
        positions: [],
      }
      expect(posting.positions).toHaveLength(0)
    })
  })

  // ============================================================================
  // PositionalPostingList
  // ============================================================================

  describe('PositionalPostingList', () => {
    let list: PositionalPostingList

    beforeEach(() => {
      list = new PositionalPostingList()
    })

    describe('add', () => {
      it('should add document with single position', () => {
        list.add(1, 0)
        expect(list.contains(1)).toBe(true)
        expect(list.getPositions(1)).toEqual([0])
      })

      it('should add document with multiple positions', () => {
        list.add(1, 0)
        list.add(1, 5)
        list.add(1, 10)
        expect(list.getPositions(1)).toEqual([0, 5, 10])
      })

      it('should add multiple documents', () => {
        list.add(1, 0)
        list.add(2, 3)
        list.add(3, 7)
        expect(list.contains(1)).toBe(true)
        expect(list.contains(2)).toBe(true)
        expect(list.contains(3)).toBe(true)
      })

      it('should maintain sorted positions', () => {
        list.add(1, 10)
        list.add(1, 5)
        list.add(1, 15)
        list.add(1, 0)
        expect(list.getPositions(1)).toEqual([0, 5, 10, 15])
      })

      it('should handle duplicate positions idempotently', () => {
        list.add(1, 5)
        list.add(1, 5)
        expect(list.getPositions(1)).toEqual([5])
      })
    })

    describe('getPositions', () => {
      it('should return empty array for non-existent document', () => {
        expect(list.getPositions(999)).toEqual([])
      })

      it('should return all positions for document', () => {
        list.add(1, 0)
        list.add(1, 3)
        list.add(1, 7)
        expect(list.getPositions(1)).toEqual([0, 3, 7])
      })
    })

    describe('cardinality', () => {
      it('should return 0 for empty list', () => {
        expect(list.cardinality).toBe(0)
      })

      it('should return document count', () => {
        list.add(1, 0)
        list.add(2, 0)
        list.add(3, 0)
        expect(list.cardinality).toBe(3)
      })

      it('should not count positions, only documents', () => {
        list.add(1, 0)
        list.add(1, 1)
        list.add(1, 2)
        expect(list.cardinality).toBe(1)
      })
    })

    describe('getPostings', () => {
      it('should return all postings with positions', () => {
        list.add(1, 0)
        list.add(1, 5)
        list.add(2, 3)

        const postings = list.getPostings()
        expect(postings).toHaveLength(2)

        const doc1 = postings.find((p) => p.docId === 1)
        expect(doc1?.positions).toEqual([0, 5])

        const doc2 = postings.find((p) => p.docId === 2)
        expect(doc2?.positions).toEqual([3])
      })

      it('should return postings sorted by docId', () => {
        list.add(3, 0)
        list.add(1, 0)
        list.add(2, 0)

        const postings = list.getPostings()
        expect(postings.map((p) => p.docId)).toEqual([1, 2, 3])
      })
    })

    describe('serialize and deserialize', () => {
      it('should round-trip empty list', () => {
        const bytes = list.serialize()
        const restored = PositionalPostingList.deserialize(bytes)
        expect(restored.cardinality).toBe(0)
      })

      it('should round-trip single posting', () => {
        list.add(1, 5)
        list.add(1, 10)

        const bytes = list.serialize()
        const restored = PositionalPostingList.deserialize(bytes)

        expect(restored.contains(1)).toBe(true)
        expect(restored.getPositions(1)).toEqual([5, 10])
      })

      it('should round-trip multiple postings', () => {
        list.add(1, 0)
        list.add(1, 5)
        list.add(2, 3)
        list.add(2, 7)
        list.add(3, 10)

        const bytes = list.serialize()
        const restored = PositionalPostingList.deserialize(bytes)

        expect(restored.getPositions(1)).toEqual([0, 5])
        expect(restored.getPositions(2)).toEqual([3, 7])
        expect(restored.getPositions(3)).toEqual([10])
      })

      it('should use delta encoding for positions', () => {
        // Sequential positions should compress well
        for (let i = 0; i < 100; i++) {
          list.add(1, i)
        }
        const bytes = list.serialize()
        // Delta encoding: positions [0,1,2,...,99] become deltas [0,1,1,1,...]
        // This should be much smaller than storing raw positions
        expect(bytes.length).toBeLessThan(200)
      })
    })
  })

  // ============================================================================
  // PhraseQuery - Exact Phrase Matching
  // ============================================================================

  describe('PhraseQuery', () => {
    // Setup: "the quick brown fox jumps over the lazy dog"
    // Positions: 0   1     2     3   4     5    6   7    8
    let theList: PositionalPostingList
    let quickList: PositionalPostingList
    let brownList: PositionalPostingList
    let foxList: PositionalPostingList
    let jumpsList: PositionalPostingList
    let overList: PositionalPostingList
    let lazyList: PositionalPostingList
    let dogList: PositionalPostingList

    beforeEach(() => {
      // Document 1: "the quick brown fox jumps over the lazy dog"
      theList = new PositionalPostingList()
      theList.add(1, 0)
      theList.add(1, 6) // "the" appears twice

      quickList = new PositionalPostingList()
      quickList.add(1, 1)

      brownList = new PositionalPostingList()
      brownList.add(1, 2)

      foxList = new PositionalPostingList()
      foxList.add(1, 3)

      jumpsList = new PositionalPostingList()
      jumpsList.add(1, 4)

      overList = new PositionalPostingList()
      overList.add(1, 5)

      lazyList = new PositionalPostingList()
      lazyList.add(1, 7)

      dogList = new PositionalPostingList()
      dogList.add(1, 8)
    })

    describe('search', () => {
      it('should find exact two-word phrase', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('brown', brownList)

        const results = query.search()
        expect(results.docIds).toContain(1)
      })

      it('should find exact three-word phrase', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('brown', brownList)
        query.addTerm('fox', foxList)

        const results = query.search()
        expect(results.docIds).toContain(1)
      })

      it('should NOT find non-adjacent terms', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('fox', foxList) // Missing "brown" between

        const results = query.search()
        expect(results.docIds).not.toContain(1)
      })

      it('should NOT find terms in wrong order', () => {
        const query = new PhraseQuery()
        query.addTerm('brown', brownList)
        query.addTerm('quick', quickList) // Wrong order

        const results = query.search()
        expect(results.docIds).not.toContain(1)
      })

      it('should find phrase at document start', () => {
        const query = new PhraseQuery()
        query.addTerm('the', theList)
        query.addTerm('quick', quickList)

        const results = query.search()
        expect(results.docIds).toContain(1)
      })

      it('should find phrase at document end', () => {
        const query = new PhraseQuery()
        query.addTerm('lazy', lazyList)
        query.addTerm('dog', dogList)

        const results = query.search()
        expect(results.docIds).toContain(1)
      })

      it('should handle single term phrase', () => {
        const query = new PhraseQuery()
        query.addTerm('fox', foxList)

        const results = query.search()
        expect(results.docIds).toContain(1)
      })

      it('should return empty for no matching terms', () => {
        const emptyList = new PositionalPostingList()
        const query = new PhraseQuery()
        query.addTerm('missing', emptyList)

        const results = query.search()
        expect(results.docIds).toHaveLength(0)
      })

      it('should handle repeated terms in phrase', () => {
        // Search for "the ... the" - both occurrences of "the"
        // "the" at position 0 and 6
        const query = new PhraseQuery()
        query.addTerm('the', theList)
        query.addTerm('lazy', lazyList)

        const results = query.search()
        // "the lazy" at positions 6,7 should match
        expect(results.docIds).toContain(1)
      })
    })

    describe('search with slop', () => {
      it('should find phrase with slop=1 (one word between)', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('fox', foxList) // "brown" is between

        const results = query.search(1) // slop=1
        expect(results.docIds).toContain(1)
      })

      it('should find phrase with slop=2 (two words between)', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('jumps', jumpsList) // "brown fox" is between

        const results = query.search(2) // slop=2
        expect(results.docIds).toContain(1)
      })

      it('should NOT find phrase when gap exceeds slop', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('over', overList) // 3 words between: brown, fox, jumps

        const results = query.search(2) // slop=2 is not enough
        expect(results.docIds).not.toContain(1)
      })

      it('should find with sufficient slop', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('over', overList)

        const results = query.search(3) // slop=3 is enough
        expect(results.docIds).toContain(1)
      })

      it('should find exact adjacent with slop=0', () => {
        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('brown', brownList)

        const results = query.search(0)
        expect(results.docIds).toContain(1)
      })
    })

    describe('multiple documents', () => {
      it('should find phrase in multiple documents', () => {
        // Add document 2 with "quick brown"
        quickList.add(2, 0)
        brownList.add(2, 1)

        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('brown', brownList)

        const results = query.search()
        expect(results.docIds).toContain(1)
        expect(results.docIds).toContain(2)
      })

      it('should only return documents with complete phrase', () => {
        // Add document 2 with only "quick" (no "brown")
        quickList.add(2, 0)
        // brownList does NOT have doc 2

        const query = new PhraseQuery()
        query.addTerm('quick', quickList)
        query.addTerm('brown', brownList)

        const results = query.search()
        expect(results.docIds).toContain(1)
        expect(results.docIds).not.toContain(2)
      })
    })
  })

  // ============================================================================
  // Phrase Query with Scoring
  // ============================================================================

  describe('phrase query scoring', () => {
    it('should return match positions for scoring', () => {
      const list1 = new PositionalPostingList()
      list1.add(1, 0)

      const list2 = new PositionalPostingList()
      list2.add(1, 1)

      const query = new PhraseQuery()
      query.addTerm('hello', list1)
      query.addTerm('world', list2)

      const results = query.searchWithPositions()

      expect(results).toHaveLength(1)
      expect(results[0].docId).toBe(1)
      expect(results[0].matchPositions).toContain(0) // Starting position of match
    })

    it('should return multiple match positions for repeated phrases', () => {
      // "hello world hello world"
      // pos:  0     1     2     3
      const helloList = new PositionalPostingList()
      helloList.add(1, 0)
      helloList.add(1, 2)

      const worldList = new PositionalPostingList()
      worldList.add(1, 1)
      worldList.add(1, 3)

      const query = new PhraseQuery()
      query.addTerm('hello', helloList)
      query.addTerm('world', worldList)

      const results = query.searchWithPositions()

      expect(results).toHaveLength(1)
      expect(results[0].matchPositions).toContain(0)
      expect(results[0].matchPositions).toContain(2)
    })

    it('should support proximity boost calculation', () => {
      const list1 = new PositionalPostingList()
      list1.add(1, 0)
      list1.add(2, 0)

      const list2 = new PositionalPostingList()
      list2.add(1, 1) // Adjacent in doc 1
      list2.add(2, 5) // 4 words apart in doc 2

      const query = new PhraseQuery()
      query.addTerm('a', list1)
      query.addTerm('b', list2)

      const results = query.searchWithPositions(4) // slop=4 to match both

      // Doc 1 should have higher proximity score (closer match)
      const doc1 = results.find((r) => r.docId === 1)
      const doc2 = results.find((r) => r.docId === 2)

      expect(doc1).toBeDefined()
      expect(doc2).toBeDefined()
      expect(doc1!.minDistance).toBe(1)
      expect(doc2!.minDistance).toBe(5)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty phrase query', () => {
      const query = new PhraseQuery()
      const results = query.search()
      expect(results.docIds).toHaveLength(0)
    })

    it('should handle term not in any document', () => {
      const emptyList = new PositionalPostingList()
      const validList = new PositionalPostingList()
      validList.add(1, 0)

      const query = new PhraseQuery()
      query.addTerm('valid', validList)
      query.addTerm('missing', emptyList)

      const results = query.search()
      expect(results.docIds).toHaveLength(0)
    })

    it('should handle very long phrases', () => {
      const lists: PositionalPostingList[] = []

      // Create 10-word phrase
      for (let i = 0; i < 10; i++) {
        const list = new PositionalPostingList()
        list.add(1, i)
        lists.push(list)
      }

      const query = new PhraseQuery()
      lists.forEach((list, i) => {
        query.addTerm(`word${i}`, list)
      })

      const results = query.search()
      expect(results.docIds).toContain(1)
    })

    it('should handle large position values', () => {
      const list1 = new PositionalPostingList()
      list1.add(1, 1000000)

      const list2 = new PositionalPostingList()
      list2.add(1, 1000001)

      const query = new PhraseQuery()
      query.addTerm('a', list1)
      query.addTerm('b', list2)

      const results = query.search()
      expect(results.docIds).toContain(1)
    })

    it('should handle document with many term occurrences', () => {
      const list1 = new PositionalPostingList()
      const list2 = new PositionalPostingList()

      // 1000 occurrences of phrase "a b"
      for (let i = 0; i < 1000; i++) {
        list1.add(1, i * 2)
        list2.add(1, i * 2 + 1)
      }

      const query = new PhraseQuery()
      query.addTerm('a', list1)
      query.addTerm('b', list2)

      const results = query.searchWithPositions()
      expect(results[0].matchPositions).toHaveLength(1000)
    })
  })

  // ============================================================================
  // Phrase Query Builder Pattern
  // ============================================================================

  describe('PhraseQuery.fromTerms', () => {
    it('should create phrase query from term array', () => {
      const termPostings = new Map<string, PositionalPostingList>()

      const quickList = new PositionalPostingList()
      quickList.add(1, 0)
      const brownList = new PositionalPostingList()
      brownList.add(1, 1)
      const foxList = new PositionalPostingList()
      foxList.add(1, 2)

      termPostings.set('quick', quickList)
      termPostings.set('brown', brownList)
      termPostings.set('fox', foxList)

      const query = PhraseQuery.fromTerms(['quick', 'brown', 'fox'], termPostings)
      const results = query.search()

      expect(results.docIds).toContain(1)
    })

    it('should throw for missing term', () => {
      const termPostings = new Map<string, PositionalPostingList>()

      expect(() => {
        PhraseQuery.fromTerms(['missing'], termPostings)
      }).toThrow('missing')
    })
  })
})
