/**
 * Elasticsearch DSL Parser Tests
 *
 * Tests for parsing Elasticsearch Query DSL into unified AST format.
 *
 * @see dotdo-y78ii
 */

import { describe, it, expect } from 'vitest'
import {
  ElasticsearchParser,
  type ParsedElasticsearch,
} from '../parsers/elasticsearch-parser'
import type { PredicateNode, LogicalNode, QueryNode } from '../ast'

describe('ElasticsearchParser', () => {
  const parser = new ElasticsearchParser()

  // ===========================================================================
  // Bool Queries
  // ===========================================================================

  describe('bool queries', () => {
    describe('must clause', () => {
      it('should parse single must clause as predicate', () => {
        const result = parser.parse({
          query: {
            bool: {
              must: { term: { status: 'published' } },
            },
          },
        })

        expect(result.query).toEqual({
          type: 'predicate',
          column: 'status',
          op: '=',
          value: 'published',
        })
      })

      it('should parse multiple must clauses as AND', () => {
        const result = parser.parse({
          query: {
            bool: {
              must: [
                { term: { status: 'published' } },
                { term: { category: 'tech' } },
              ],
            },
          },
        })

        expect(result.query).toEqual({
          type: 'logical',
          op: 'AND',
          children: [
            { type: 'predicate', column: 'status', op: '=', value: 'published' },
            { type: 'predicate', column: 'category', op: '=', value: 'tech' },
          ],
        })
      })
    })

    describe('should clause', () => {
      it('should parse should clauses as OR', () => {
        const result = parser.parse({
          query: {
            bool: {
              should: [
                { term: { status: 'published' } },
                { term: { status: 'draft' } },
              ],
            },
          },
        })

        expect(result.query).toEqual({
          type: 'logical',
          op: 'OR',
          children: [
            { type: 'predicate', column: 'status', op: '=', value: 'published' },
            { type: 'predicate', column: 'status', op: '=', value: 'draft' },
          ],
        })
      })

      it('should handle minimum_should_match', () => {
        const result = parser.parse({
          query: {
            bool: {
              should: [
                { match: { title: 'elasticsearch' } },
                { match: { content: 'search' } },
              ],
              minimum_should_match: 1,
            },
          },
        })

        expect(result.query?.type).toBe('logical')
        expect((result.query as LogicalNode).op).toBe('OR')
      })
    })

    describe('filter clause', () => {
      it('should parse filter clauses same as must (AND)', () => {
        const result = parser.parse({
          query: {
            bool: {
              filter: [
                { term: { status: 'published' } },
                { range: { date: { gte: '2024-01-01' } } },
              ],
            },
          },
        })

        expect(result.query?.type).toBe('logical')
        expect((result.query as LogicalNode).op).toBe('AND')
        expect((result.query as LogicalNode).children).toHaveLength(2)
      })
    })

    describe('must_not clause', () => {
      it('should parse must_not as NOT', () => {
        const result = parser.parse({
          query: {
            bool: {
              must_not: { term: { status: 'deleted' } },
            },
          },
        })

        expect(result.query).toEqual({
          type: 'logical',
          op: 'NOT',
          children: [
            { type: 'predicate', column: 'status', op: '=', value: 'deleted' },
          ],
        })
      })

      it('should parse multiple must_not clauses', () => {
        const result = parser.parse({
          query: {
            bool: {
              must_not: [
                { term: { status: 'deleted' } },
                { term: { status: 'archived' } },
              ],
            },
          },
        })

        expect(result.query?.type).toBe('logical')
        expect((result.query as LogicalNode).op).toBe('AND')
        expect((result.query as LogicalNode).children).toHaveLength(2)
        expect((result.query as LogicalNode).children[0]).toEqual({
          type: 'logical',
          op: 'NOT',
          children: [{ type: 'predicate', column: 'status', op: '=', value: 'deleted' }],
        })
      })
    })

    describe('combined bool clauses', () => {
      it('should combine must, filter, and should', () => {
        const result = parser.parse({
          query: {
            bool: {
              must: [{ match: { title: 'search' } }],
              filter: [{ term: { status: 'published' } }],
              should: [{ match: { content: 'elasticsearch' } }],
              minimum_should_match: 1,
            },
          },
        })

        expect(result.query?.type).toBe('logical')
        expect((result.query as LogicalNode).op).toBe('AND')
        // Should have must, filter, and should as children
        expect((result.query as LogicalNode).children.length).toBeGreaterThanOrEqual(2)
      })
    })
  })

  // ===========================================================================
  // Term Queries
  // ===========================================================================

  describe('term queries', () => {
    it('should parse term query', () => {
      const result = parser.parseQuery({ term: { status: 'active' } })

      expect(result).toEqual({
        type: 'predicate',
        column: 'status',
        op: '=',
        value: 'active',
      })
    })

    it('should parse term query with value object', () => {
      const result = parser.parseQuery({
        term: { status: { value: 'active', boost: 1.5 } },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'status',
        op: '=',
        value: 'active',
      })
    })

    it('should parse terms query as IN', () => {
      const result = parser.parseQuery({
        terms: { status: ['active', 'pending', 'review'] },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'status',
        op: 'IN',
        value: ['active', 'pending', 'review'],
      })
    })
  })

  // ===========================================================================
  // Match Queries
  // ===========================================================================

  describe('match queries', () => {
    it('should parse match query as CONTAINS', () => {
      const result = parser.parseQuery({
        match: { title: 'elasticsearch tutorial' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'title',
        op: 'CONTAINS',
        value: 'elasticsearch tutorial',
      })
    })

    it('should parse match query with query object', () => {
      const result = parser.parseQuery({
        match: { title: { query: 'elasticsearch', operator: 'and' } },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'title',
        op: 'CONTAINS',
        value: 'elasticsearch',
      })
    })

    it('should parse match_phrase query', () => {
      const result = parser.parseQuery({
        match_phrase: { title: 'quick brown fox' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'title',
        op: 'CONTAINS',
        value: 'quick brown fox',
      })
    })
  })

  // ===========================================================================
  // Range Queries
  // ===========================================================================

  describe('range queries', () => {
    it('should parse range with gte', () => {
      const result = parser.parseQuery({
        range: { date: { gte: '2024-01-01' } },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'date',
        op: '>=',
        value: '2024-01-01',
      })
    })

    it('should parse range with gt', () => {
      const result = parser.parseQuery({
        range: { age: { gt: 18 } },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 18,
      })
    })

    it('should parse range with lte', () => {
      const result = parser.parseQuery({
        range: { price: { lte: 100 } },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'price',
        op: '<=',
        value: 100,
      })
    })

    it('should parse range with lt', () => {
      const result = parser.parseQuery({
        range: { score: { lt: 50 } },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'score',
        op: '<',
        value: 50,
      })
    })

    it('should parse range with multiple conditions as AND', () => {
      const result = parser.parseQuery({
        range: { age: { gte: 18, lte: 65 } },
      })

      expect(result).toEqual({
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>=', value: 18 },
          { type: 'predicate', column: 'age', op: '<=', value: 65 },
        ],
      })
    })
  })

  // ===========================================================================
  // Exists Query
  // ===========================================================================

  describe('exists query', () => {
    it('should parse exists query as IS NOT NULL', () => {
      const result = parser.parseQuery({
        exists: { field: 'email' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'email',
        op: 'IS NOT NULL',
        value: null,
      })
    })
  })

  // ===========================================================================
  // Pattern Queries
  // ===========================================================================

  describe('pattern queries', () => {
    it('should parse prefix query as STARTS_WITH', () => {
      const result = parser.parseQuery({
        prefix: { name: 'john' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'name',
        op: 'STARTS_WITH',
        value: 'john',
      })
    })

    it('should parse wildcard query as LIKE', () => {
      const result = parser.parseQuery({
        wildcard: { email: '*@example.com' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'email',
        op: 'LIKE',
        value: '%@example.com',
      })
    })

    it('should convert wildcard ? to _', () => {
      const result = parser.parseQuery({
        wildcard: { code: 'AB??' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'code',
        op: 'LIKE',
        value: 'AB__',
      })
    })

    it('should parse regexp query', () => {
      const result = parser.parseQuery({
        regexp: { email: '.*@example\\.com' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'email',
        op: 'LIKE',
        value: '.*@example\\.com',
      })
    })

    it('should parse fuzzy query as CONTAINS', () => {
      const result = parser.parseQuery({
        fuzzy: { name: 'johnn' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'name',
        op: 'CONTAINS',
        value: 'johnn',
      })
    })
  })

  // ===========================================================================
  // IDs Query
  // ===========================================================================

  describe('ids query', () => {
    it('should parse ids query as IN on _id', () => {
      const result = parser.parseQuery({
        ids: { values: ['id1', 'id2', 'id3'] },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: '_id',
        op: 'IN',
        value: ['id1', 'id2', 'id3'],
      })
    })
  })

  // ===========================================================================
  // Nested Query
  // ===========================================================================

  describe('nested query', () => {
    it('should prefix nested field paths', () => {
      const result = parser.parseQuery({
        nested: {
          path: 'comments',
          query: {
            bool: {
              must: [
                { term: { 'author': 'john' } },
                { range: { date: { gte: '2024-01-01' } } },
              ],
            },
          },
        },
      })

      expect(result.type).toBe('logical')
      const logicalNode = result as LogicalNode
      expect(logicalNode.children[0]).toEqual({
        type: 'predicate',
        column: 'comments.author',
        op: '=',
        value: 'john',
      })
    })
  })

  // ===========================================================================
  // Query String
  // ===========================================================================

  describe('query_string', () => {
    it('should parse query_string as CONTAINS', () => {
      const result = parser.parseQuery({
        query_string: { query: 'foo AND bar' },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: '_all',
        op: 'CONTAINS',
        value: 'foo AND bar',
      })
    })

    it('should parse query_string with default_field', () => {
      const result = parser.parseQuery({
        query_string: {
          query: 'elasticsearch',
          default_field: 'title',
        },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'title',
        op: 'CONTAINS',
        value: 'elasticsearch',
      })
    })

    it('should parse simple_query_string', () => {
      const result = parser.parseQuery({
        simple_query_string: {
          query: 'elasticsearch search',
          fields: ['title', 'content'],
        },
      })

      expect(result).toEqual({
        type: 'predicate',
        column: 'title',
        op: 'CONTAINS',
        value: 'elasticsearch search',
      })
    })
  })

  // ===========================================================================
  // match_all Query
  // ===========================================================================

  describe('match_all query', () => {
    it('should parse match_all as always-true predicate', () => {
      const result = parser.parseQuery({ match_all: {} })

      expect(result).toEqual({
        type: 'predicate',
        column: '_',
        op: '=',
        value: { $always: true },
      })
    })

    it('should handle empty query as match_all', () => {
      const result = parser.parseQuery({})

      expect(result).toEqual({
        type: 'predicate',
        column: '_',
        op: '=',
        value: { $always: true },
      })
    })
  })

  // ===========================================================================
  // Sort
  // ===========================================================================

  describe('sort parsing', () => {
    it('should parse simple field sort', () => {
      const result = parser.parse({
        sort: ['date'],
      })

      expect(result.sort).toEqual({
        type: 'sort',
        columns: [{ column: 'date', direction: 'ASC' }],
      })
    })

    it('should parse field with direction', () => {
      const result = parser.parse({
        sort: [{ date: 'desc' }],
      })

      expect(result.sort).toEqual({
        type: 'sort',
        columns: [{ column: 'date', direction: 'DESC' }],
      })
    })

    it('should parse field with order object', () => {
      const result = parser.parse({
        sort: [{ date: { order: 'desc' } }],
      })

      expect(result.sort).toEqual({
        type: 'sort',
        columns: [{ column: 'date', direction: 'DESC' }],
      })
    })

    it('should parse multiple sort fields', () => {
      const result = parser.parse({
        sort: [
          { date: 'desc' },
          { _score: 'asc' },
        ],
      })

      expect(result.sort).toEqual({
        type: 'sort',
        columns: [
          { column: 'date', direction: 'DESC' },
          { column: '$score', direction: 'ASC' },
        ],
      })
    })

    it('should convert _score to $score', () => {
      const result = parser.parse({
        sort: ['_score'],
      })

      expect(result.sort?.columns[0]?.column).toBe('$score')
    })
  })

  // ===========================================================================
  // Source (Projection)
  // ===========================================================================

  describe('_source parsing', () => {
    it('should parse _source: false as empty projection', () => {
      const result = parser.parse({
        _source: false,
      })

      expect(result.projection).toEqual({
        type: 'projection',
        columns: [],
      })
    })

    it('should parse _source: true as all fields', () => {
      const result = parser.parse({
        _source: true,
      })

      expect(result.projection).toEqual({
        type: 'projection',
        columns: [{ source: '*', include: true }],
      })
    })

    it('should parse _source array as includes', () => {
      const result = parser.parse({
        _source: ['title', 'author', 'date'],
      })

      expect(result.projection).toEqual({
        type: 'projection',
        columns: [
          { source: 'title', include: true },
          { source: 'author', include: true },
          { source: 'date', include: true },
        ],
      })
    })

    it('should parse _source with includes/excludes', () => {
      const result = parser.parse({
        _source: {
          includes: ['title', 'content'],
          excludes: ['metadata'],
        },
      })

      expect(result.projection).toEqual({
        type: 'projection',
        columns: [
          { source: 'title', include: true },
          { source: 'content', include: true },
          { source: 'metadata', include: false },
        ],
      })
    })
  })

  // ===========================================================================
  // Pagination
  // ===========================================================================

  describe('pagination', () => {
    it('should parse from and size', () => {
      const result = parser.parse({
        from: 10,
        size: 20,
      })

      expect(result.from).toBe(10)
      expect(result.size).toBe(20)
    })
  })

  // ===========================================================================
  // Complex Queries
  // ===========================================================================

  describe('complex queries', () => {
    it('should parse typical search query', () => {
      const result = parser.parse({
        query: {
          bool: {
            must: [{ match: { title: 'search' } }],
            filter: [
              { term: { status: 'published' } },
              { range: { date: { gte: '2024-01-01' } } },
            ],
            should: [{ match: { content: 'elasticsearch' } }],
            minimum_should_match: 1,
          },
        },
        sort: [{ date: 'desc' }, '_score'],
        _source: ['title', 'author', 'date'],
        from: 0,
        size: 10,
      })

      expect(result.query?.type).toBe('logical')
      expect(result.sort?.columns).toHaveLength(2)
      expect(result.projection?.columns).toHaveLength(3)
      expect(result.from).toBe(0)
      expect(result.size).toBe(10)
    })

    it('should parse nested bool queries', () => {
      const result = parser.parseQuery({
        bool: {
          must: [
            {
              bool: {
                should: [
                  { term: { category: 'tech' } },
                  { term: { category: 'science' } },
                ],
              },
            },
            { term: { status: 'published' } },
          ],
        },
      })

      expect(result.type).toBe('logical')
      expect((result as LogicalNode).op).toBe('AND')
      expect((result as LogicalNode).children[0]!.type).toBe('logical')
      expect(((result as LogicalNode).children[0] as LogicalNode).op).toBe('OR')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should throw on unknown query type', () => {
      expect(() => {
        parser.parseQuery({ unknown_query_type: {} })
      }).toThrow('Unknown Elasticsearch query type: unknown_query_type')
    })

    it('should throw on invalid terms value', () => {
      expect(() => {
        parser.parseQuery({ terms: { status: 'not-an-array' } })
      }).toThrow('terms query requires an array of values')
    })
  })

  // ===========================================================================
  // Performance
  // ===========================================================================

  describe('performance', () => {
    it('should parse 10k queries per second', () => {
      const query = {
        query: {
          bool: {
            must: [{ match: { title: 'search' } }],
            filter: [{ term: { status: 'published' } }],
          },
        },
      }

      const iterations = 1000
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        parser.parse(query)
      }

      const elapsed = performance.now() - start
      const queriesPerSecond = (iterations / elapsed) * 1000

      // Should be able to parse at least 10k queries per second
      expect(queriesPerSecond).toBeGreaterThan(10000)
    })
  })
})
