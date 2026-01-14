/**
 * Boolean Query Operations Tests (RED Phase)
 *
 * Tests for boolean query operations (AND/OR/NOT) on posting lists.
 * These operations form the foundation of search query execution.
 *
 * @module db/primitives/inverted-index/tests/boolean-queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PostingList } from '../posting-list'
import { BooleanQuery, BooleanClause, BooleanOperator } from '../boolean-query'

describe('Boolean Query Operations', () => {
  // ============================================================================
  // PostingList Set Operations
  // ============================================================================

  describe('PostingList.and (intersection)', () => {
    it('should return intersection of two posting lists', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(3)
      list2.add(4)

      const result = list1.and(list2)
      expect(result.toArray()).toEqual([2, 3])
    })

    it('should return empty for no overlap', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()
      list2.add(3)
      list2.add(4)

      const result = list1.and(list2)
      expect(result.cardinality).toBe(0)
      expect(result.toArray()).toEqual([])
    })

    it('should return empty when one list is empty', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()

      expect(list1.and(list2).cardinality).toBe(0)
      expect(list2.and(list1).cardinality).toBe(0)
    })

    it('should handle identical lists', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(1)
      list2.add(2)
      list2.add(3)

      const result = list1.and(list2)
      expect(result.toArray()).toEqual([1, 2, 3])
    })

    it('should handle subset relationships', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)
      list1.add(3)
      list1.add(4)
      list1.add(5)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(4)

      const result = list1.and(list2)
      expect(result.toArray()).toEqual([2, 4])
    })

    it('should be commutative (A AND B = B AND A)', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(3)
      list1.add(5)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(3)
      list2.add(4)

      expect(list1.and(list2).toArray()).toEqual(list2.and(list1).toArray())
    })

    it('should handle large posting lists', () => {
      const list1 = new PostingList()
      const list2 = new PostingList()

      for (let i = 0; i < 10000; i++) {
        list1.add(i * 2) // Even numbers
        list2.add(i * 3) // Multiples of 3
      }

      const result = list1.and(list2)
      // Intersection should be multiples of 6
      expect(result.contains(0)).toBe(true)
      expect(result.contains(6)).toBe(true)
      expect(result.contains(12)).toBe(true)
      expect(result.contains(3)).toBe(false) // 3 is not even
      expect(result.contains(4)).toBe(false) // 4 is not multiple of 3
    })
  })

  describe('PostingList.or (union)', () => {
    it('should return union of two posting lists', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()
      list2.add(3)
      list2.add(4)

      const result = list1.or(list2)
      expect(result.toArray()).toEqual([1, 2, 3, 4])
    })

    it('should handle overlapping lists', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(3)
      list2.add(4)

      const result = list1.or(list2)
      expect(result.toArray()).toEqual([1, 2, 3, 4])
    })

    it('should handle one empty list', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()

      expect(list1.or(list2).toArray()).toEqual([1, 2])
      expect(list2.or(list1).toArray()).toEqual([1, 2])
    })

    it('should handle both empty lists', () => {
      const list1 = new PostingList()
      const list2 = new PostingList()

      const result = list1.or(list2)
      expect(result.cardinality).toBe(0)
    })

    it('should be commutative (A OR B = B OR A)', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(4)

      expect(list1.or(list2).toArray()).toEqual(list2.or(list1).toArray())
    })

    it('should handle identical lists', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()
      list2.add(1)
      list2.add(2)

      const result = list1.or(list2)
      expect(result.toArray()).toEqual([1, 2])
    })
  })

  describe('PostingList.andNot (difference)', () => {
    it('should return docs in A but not in B', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(4)

      const result = list1.andNot(list2)
      expect(result.toArray()).toEqual([1, 3])
    })

    it('should return all of A when no overlap', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()
      list2.add(3)
      list2.add(4)

      const result = list1.andNot(list2)
      expect(result.toArray()).toEqual([1, 2])
    })

    it('should return empty when A is subset of B', () => {
      const list1 = new PostingList()
      list1.add(2)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(1)
      list2.add(2)
      list2.add(3)
      list2.add(4)

      const result = list1.andNot(list2)
      expect(result.cardinality).toBe(0)
    })

    it('should return all of A when B is empty', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()

      const result = list1.andNot(list2)
      expect(result.toArray()).toEqual([1, 2])
    })

    it('should return empty when A is empty', () => {
      const list1 = new PostingList()

      const list2 = new PostingList()
      list2.add(1)
      list2.add(2)

      const result = list1.andNot(list2)
      expect(result.cardinality).toBe(0)
    })

    it('should NOT be commutative', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)
      list1.add(3)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(3)
      list2.add(4)

      expect(list1.andNot(list2).toArray()).toEqual([1])
      expect(list2.andNot(list1).toArray()).toEqual([4])
    })
  })

  // ============================================================================
  // BooleanQuery Builder
  // ============================================================================

  describe('BooleanQuery', () => {
    describe('construction', () => {
      it('should create empty query', () => {
        const query = new BooleanQuery()
        expect(query.clauses).toHaveLength(0)
      })

      it('should add must clause (AND)', () => {
        const query = new BooleanQuery()
        const list = new PostingList()
        list.add(1)

        query.must('term1', list)
        expect(query.clauses).toHaveLength(1)
        expect(query.clauses[0].operator).toBe(BooleanOperator.MUST)
      })

      it('should add should clause (OR)', () => {
        const query = new BooleanQuery()
        const list = new PostingList()
        list.add(1)

        query.should('term1', list)
        expect(query.clauses).toHaveLength(1)
        expect(query.clauses[0].operator).toBe(BooleanOperator.SHOULD)
      })

      it('should add mustNot clause (NOT)', () => {
        const query = new BooleanQuery()
        const list = new PostingList()
        list.add(1)

        query.mustNot('term1', list)
        expect(query.clauses).toHaveLength(1)
        expect(query.clauses[0].operator).toBe(BooleanOperator.MUST_NOT)
      })

      it('should support fluent API', () => {
        const list1 = new PostingList()
        list1.add(1)
        const list2 = new PostingList()
        list2.add(2)

        const query = new BooleanQuery().must('a', list1).must('b', list2)

        expect(query.clauses).toHaveLength(2)
      })
    })

    describe('execute', () => {
      let listA: PostingList
      let listB: PostingList
      let listC: PostingList

      beforeEach(() => {
        // A = [1, 2, 3, 4]
        listA = new PostingList()
        ;[1, 2, 3, 4].forEach((id) => listA.add(id))

        // B = [2, 3, 4, 5]
        listB = new PostingList()
        ;[2, 3, 4, 5].forEach((id) => listB.add(id))

        // C = [3, 4, 5, 6]
        listC = new PostingList()
        ;[3, 4, 5, 6].forEach((id) => listC.add(id))
      })

      it('should execute single must clause', () => {
        const query = new BooleanQuery().must('a', listA)
        const result = query.execute()
        expect(result.toArray()).toEqual([1, 2, 3, 4])
      })

      it('should execute AND query (multiple must)', () => {
        const query = new BooleanQuery().must('a', listA).must('b', listB)

        const result = query.execute()
        expect(result.toArray()).toEqual([2, 3, 4])
      })

      it('should execute OR query (multiple should)', () => {
        const query = new BooleanQuery().should('a', listA).should('c', listC)

        const result = query.execute()
        expect(result.toArray()).toEqual([1, 2, 3, 4, 5, 6])
      })

      it('should execute NOT query (must + mustNot)', () => {
        const query = new BooleanQuery().must('a', listA).mustNot('b', listB)

        const result = query.execute()
        expect(result.toArray()).toEqual([1])
      })

      it('should execute complex query (A AND B AND NOT C)', () => {
        const query = new BooleanQuery().must('a', listA).must('b', listB).mustNot('c', listC)

        const result = query.execute()
        expect(result.toArray()).toEqual([2])
      })

      it('should execute mixed must/should query', () => {
        // (A AND B) OR C
        // Actually: must(A), must(B), should(C) means:
        // - Match all musts, then expand with shoulds
        // This is Lucene-style behavior
        const query = new BooleanQuery().must('a', listA).should('c', listC)

        const result = query.execute()
        // Must A is required, should C is optional boost
        expect(result.toArray()).toEqual([1, 2, 3, 4])
      })

      it('should handle empty result', () => {
        const listX = new PostingList()
        listX.add(100)

        const query = new BooleanQuery().must('a', listA).must('x', listX)

        const result = query.execute()
        expect(result.cardinality).toBe(0)
      })

      it('should handle all mustNot with no must', () => {
        // Pure NOT query needs a universe - should throw or return empty
        const query = new BooleanQuery().mustNot('a', listA)

        expect(() => query.execute()).toThrow('must')
      })

      it('should return empty for query with no clauses', () => {
        const query = new BooleanQuery()
        const result = query.execute()
        expect(result.cardinality).toBe(0)
      })
    })

    describe('query optimization', () => {
      it('should process smallest posting list first for AND queries', () => {
        const small = new PostingList()
        small.add(1)

        const large = new PostingList()
        for (let i = 0; i < 10000; i++) {
          large.add(i)
        }

        // Order shouldn't matter for correctness, but small first is faster
        const query1 = new BooleanQuery().must('small', small).must('large', large)

        const query2 = new BooleanQuery().must('large', large).must('small', small)

        expect(query1.execute().toArray()).toEqual(query2.execute().toArray())
      })
    })
  })

  // ============================================================================
  // Nested Boolean Queries
  // ============================================================================

  describe('nested boolean queries', () => {
    let listA: PostingList
    let listB: PostingList
    let listC: PostingList
    let listD: PostingList

    beforeEach(() => {
      listA = new PostingList()
      ;[1, 2, 3].forEach((id) => listA.add(id))

      listB = new PostingList()
      ;[2, 3, 4].forEach((id) => listB.add(id))

      listC = new PostingList()
      ;[3, 4, 5].forEach((id) => listC.add(id))

      listD = new PostingList()
      ;[4, 5, 6].forEach((id) => listD.add(id))
    })

    it('should execute (A AND B) OR (C AND D)', () => {
      const subQuery1 = new BooleanQuery().must('a', listA).must('b', listB)

      const subQuery2 = new BooleanQuery().must('c', listC).must('d', listD)

      // Get results from sub-queries
      const result1 = subQuery1.execute()
      const result2 = subQuery2.execute()

      // Combine with OR
      const combined = result1.or(result2)

      // A AND B = [2, 3]
      // C AND D = [4, 5]
      // (A AND B) OR (C AND D) = [2, 3, 4, 5]
      expect(combined.toArray()).toEqual([2, 3, 4, 5])
    })

    it('should execute (A OR B) AND (C OR D)', () => {
      const subQuery1 = new BooleanQuery().should('a', listA).should('b', listB)

      const subQuery2 = new BooleanQuery().should('c', listC).should('d', listD)

      const result1 = subQuery1.execute()
      const result2 = subQuery2.execute()
      const combined = result1.and(result2)

      // A OR B = [1, 2, 3, 4]
      // C OR D = [3, 4, 5, 6]
      // (A OR B) AND (C OR D) = [3, 4]
      expect(combined.toArray()).toEqual([3, 4])
    })

    it('should execute (A AND B) OR (C AND NOT D)', () => {
      const subQuery1 = new BooleanQuery().must('a', listA).must('b', listB)

      const subQuery2 = new BooleanQuery().must('c', listC).mustNot('d', listD)

      const result1 = subQuery1.execute()
      const result2 = subQuery2.execute()
      const combined = result1.or(result2)

      // A AND B = [2, 3]
      // C AND NOT D = C - D = [3, 4, 5] - [4, 5, 6] = [3]
      // Combined = [2, 3]
      expect(combined.toArray()).toEqual([2, 3])
    })

    it('should support BooleanQuery.subquery() for nested queries', () => {
      const query = new BooleanQuery()
        .subquery((sub) => sub.must('a', listA).must('b', listB), BooleanOperator.SHOULD)
        .subquery((sub) => sub.must('c', listC).must('d', listD), BooleanOperator.SHOULD)

      const result = query.execute()
      expect(result.toArray()).toEqual([2, 3, 4, 5])
    })
  })

  // ============================================================================
  // Query Parsing (optional DSL)
  // ============================================================================

  describe('BooleanQuery.parse', () => {
    it('should parse simple AND query', () => {
      const postings = new Map<string, PostingList>()
      const listA = new PostingList()
      listA.add(1)
      listA.add(2)
      const listB = new PostingList()
      listB.add(2)
      listB.add(3)
      postings.set('a', listA)
      postings.set('b', listB)

      const query = BooleanQuery.parse('a AND b', postings)
      const result = query.execute()
      expect(result.toArray()).toEqual([2])
    })

    it('should parse simple OR query', () => {
      const postings = new Map<string, PostingList>()
      const listA = new PostingList()
      listA.add(1)
      const listB = new PostingList()
      listB.add(2)
      postings.set('a', listA)
      postings.set('b', listB)

      const query = BooleanQuery.parse('a OR b', postings)
      const result = query.execute()
      expect(result.toArray()).toEqual([1, 2])
    })

    it('should parse NOT query', () => {
      const postings = new Map<string, PostingList>()
      const listA = new PostingList()
      ;[1, 2, 3].forEach((id) => listA.add(id))
      const listB = new PostingList()
      listB.add(2)
      postings.set('a', listA)
      postings.set('b', listB)

      const query = BooleanQuery.parse('a AND NOT b', postings)
      const result = query.execute()
      expect(result.toArray()).toEqual([1, 3])
    })

    it('should handle parentheses for grouping', () => {
      const postings = new Map<string, PostingList>()
      const listA = new PostingList()
      ;[1, 2].forEach((id) => listA.add(id))
      const listB = new PostingList()
      ;[2, 3].forEach((id) => listB.add(id))
      const listC = new PostingList()
      ;[3, 4].forEach((id) => listC.add(id))
      postings.set('a', listA)
      postings.set('b', listB)
      postings.set('c', listC)

      const query = BooleanQuery.parse('(a OR b) AND c', postings)
      const result = query.execute()
      expect(result.toArray()).toEqual([3])
    })

    it('should throw for invalid syntax', () => {
      const postings = new Map<string, PostingList>()
      expect(() => BooleanQuery.parse('AND AND', postings)).toThrow()
      expect(() => BooleanQuery.parse('(unclosed', postings)).toThrow()
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle very large posting lists', () => {
      const list1 = new PostingList()
      const list2 = new PostingList()

      for (let i = 0; i < 100000; i++) {
        list1.add(i)
        if (i % 2 === 0) list2.add(i)
      }

      const result = list1.and(list2)
      expect(result.cardinality).toBe(50000)
    })

    it('should handle repeated operations', () => {
      const list1 = new PostingList()
      list1.add(1)
      list1.add(2)

      const list2 = new PostingList()
      list2.add(2)
      list2.add(3)

      // Multiple operations on same lists
      const and1 = list1.and(list2)
      const and2 = list1.and(list2)
      expect(and1.toArray()).toEqual(and2.toArray())

      // Operations should not modify original lists
      expect(list1.toArray()).toEqual([1, 2])
      expect(list2.toArray()).toEqual([2, 3])
    })

    it('should handle chained operations', () => {
      const a = new PostingList()
      ;[1, 2, 3, 4, 5].forEach((id) => a.add(id))

      const b = new PostingList()
      ;[2, 3, 4].forEach((id) => b.add(id))

      const c = new PostingList()
      ;[3, 4, 5].forEach((id) => c.add(id))

      // a AND b AND c
      const result = a.and(b).and(c)
      expect(result.toArray()).toEqual([3, 4])
    })
  })
})
