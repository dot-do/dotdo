/**
 * Elasticsearch DSL Parser Tests
 *
 * Comprehensive tests for the ES DSL parser covering:
 * - Query parsing (match, term, bool, range)
 * - Aggregation parsing
 * - Sort and pagination parsing
 * - Query analysis utilities
 */

import { describe, it, expect } from 'vitest'
import {
  EsDslParser,
  createDslParser,
  analyzeQuery,
  extractSearchTerms,
  DslParseError,
  type NormalizedQuery,
  type NormalizedBoolClause,
  type NormalizedMatchClause,
  type NormalizedTermClause,
  type NormalizedRangeClause,
  type NormalizedTermsAgg,
  type NormalizedMetricAgg,
} from '../dsl-parser'

describe('EsDslParser', () => {
  const parser = createDslParser()

  // ==========================================================================
  // QUERY PARSING
  // ==========================================================================

  describe('Query Parsing', () => {
    describe('match_all query', () => {
      it('should parse empty query as match_all', () => {
        const result = parser.parseQuery(undefined)
        expect(result.type).toBe('match_all')
        expect((result as { boost: number }).boost).toBe(1.0)
      })

      it('should parse match_all with boost', () => {
        const result = parser.parseQuery({ match_all: { boost: 2.5 } })
        expect(result.type).toBe('match_all')
        expect((result as { boost: number }).boost).toBe(2.5)
      })

      it('should parse empty object as match_all', () => {
        const result = parser.parseQuery({} as any)
        expect(result.type).toBe('match_all')
      })
    })

    describe('match_none query', () => {
      it('should parse match_none', () => {
        const result = parser.parseQuery({ match_none: {} })
        expect(result.type).toBe('match_none')
      })
    })

    describe('match query', () => {
      it('should parse simple match query', () => {
        const result = parser.parseQuery({
          match: { title: 'hello world' },
        }) as NormalizedMatchClause

        expect(result.type).toBe('match')
        expect(result.field).toBe('title')
        expect(result.query).toBe('hello world')
        expect(result.operator).toBe('or')
        expect(result.boost).toBe(1.0)
      })

      it('should parse match query with options', () => {
        const result = parser.parseQuery({
          match: {
            title: {
              query: 'hello world',
              operator: 'and',
              boost: 2.0,
              fuzziness: 'AUTO',
              minimum_should_match: '75%',
            },
          },
        }) as NormalizedMatchClause

        expect(result.type).toBe('match')
        expect(result.field).toBe('title')
        expect(result.query).toBe('hello world')
        expect(result.operator).toBe('and')
        expect(result.boost).toBe(2.0)
        expect(result.fuzziness).toBe('AUTO')
        expect(result.minimumShouldMatch).toBe('75%')
      })
    })

    describe('multi_match query', () => {
      it('should parse multi_match query', () => {
        const result = parser.parseQuery({
          multi_match: {
            query: 'search text',
            fields: ['title', 'description'],
          },
        })

        expect(result.type).toBe('multi_match')
        const mm = result as { fields: Array<{ name: string; boost: number }> }
        expect(mm.fields).toHaveLength(2)
        expect(mm.fields[0]!.name).toBe('title')
        expect(mm.fields[0]!.boost).toBe(1.0)
      })

      it('should parse multi_match with field boosts', () => {
        const result = parser.parseQuery({
          multi_match: {
            query: 'search text',
            fields: ['title^3', 'description^1.5', 'tags'],
          },
        })

        const mm = result as { fields: Array<{ name: string; boost: number }> }
        expect(mm.fields[0]!.name).toBe('title')
        expect(mm.fields[0]!.boost).toBe(3)
        expect(mm.fields[1]!.name).toBe('description')
        expect(mm.fields[1]!.boost).toBe(1.5)
        expect(mm.fields[2]!.name).toBe('tags')
        expect(mm.fields[2]!.boost).toBe(1.0)
      })

      it('should parse multi_match with type', () => {
        const result = parser.parseQuery({
          multi_match: {
            query: 'search text',
            fields: ['title', 'description'],
            type: 'cross_fields',
            operator: 'and',
          },
        })

        expect(result.type).toBe('multi_match')
        const mm = result as { matchType: string; operator: string }
        expect(mm.matchType).toBe('cross_fields')
        expect(mm.operator).toBe('and')
      })
    })

    describe('match_phrase query', () => {
      it('should parse simple match_phrase', () => {
        const result = parser.parseQuery({
          match_phrase: { title: 'exact phrase' },
        })

        expect(result.type).toBe('match_phrase')
        const mp = result as { field: string; query: string; slop: number }
        expect(mp.field).toBe('title')
        expect(mp.query).toBe('exact phrase')
        expect(mp.slop).toBe(0)
      })

      it('should parse match_phrase with slop', () => {
        const result = parser.parseQuery({
          match_phrase: {
            title: {
              query: 'near phrase',
              slop: 2,
              boost: 1.5,
            },
          },
        })

        const mp = result as { field: string; query: string; slop: number; boost: number }
        expect(mp.slop).toBe(2)
        expect(mp.boost).toBe(1.5)
      })
    })

    describe('term query', () => {
      it('should parse simple term query', () => {
        const result = parser.parseQuery({
          term: { status: 'active' },
        }) as NormalizedTermClause

        expect(result.type).toBe('term')
        expect(result.field).toBe('status')
        expect(result.value).toBe('active')
        expect(result.boost).toBe(1.0)
      })

      it('should parse term query with value object', () => {
        const result = parser.parseQuery({
          term: { status: { value: 'active', boost: 2.0 } },
        }) as NormalizedTermClause

        expect(result.type).toBe('term')
        expect(result.value).toBe('active')
        expect(result.boost).toBe(2.0)
      })

      it('should parse term query with numeric value', () => {
        const result = parser.parseQuery({
          term: { priority: 5 },
        }) as NormalizedTermClause

        expect(result.type).toBe('term')
        expect(result.value).toBe(5)
      })

      it('should parse term query with boolean value', () => {
        const result = parser.parseQuery({
          term: { active: true },
        }) as NormalizedTermClause

        expect(result.type).toBe('term')
        expect(result.value).toBe(true)
      })
    })

    describe('terms query', () => {
      it('should parse terms query', () => {
        const result = parser.parseQuery({
          terms: { status: ['active', 'pending', 'review'] },
        })

        expect(result.type).toBe('terms')
        const t = result as { field: string; values: string[] }
        expect(t.field).toBe('status')
        expect(t.values).toEqual(['active', 'pending', 'review'])
      })

      it('should parse terms query with numeric values', () => {
        const result = parser.parseQuery({
          terms: { priority: [1, 2, 3] },
        })

        const t = result as { field: string; values: number[] }
        expect(t.values).toEqual([1, 2, 3])
      })
    })

    describe('range query', () => {
      it('should parse range query with gte/lte', () => {
        const result = parser.parseQuery({
          range: { price: { gte: 100, lte: 500 } },
        }) as NormalizedRangeClause

        expect(result.type).toBe('range')
        expect(result.field).toBe('price')
        expect(result.gte).toBe(100)
        expect(result.lte).toBe(500)
      })

      it('should parse range query with gt/lt', () => {
        const result = parser.parseQuery({
          range: { price: { gt: 100, lt: 500 } },
        }) as NormalizedRangeClause

        expect(result.gt).toBe(100)
        expect(result.lt).toBe(500)
      })

      it('should parse range query with date values', () => {
        const result = parser.parseQuery({
          range: {
            created_at: {
              gte: '2024-01-01',
              lt: '2024-12-31',
              format: 'yyyy-MM-dd',
            },
          },
        }) as NormalizedRangeClause

        expect(result.gte).toBe('2024-01-01')
        expect(result.lt).toBe('2024-12-31')
        expect(result.format).toBe('yyyy-MM-dd')
      })

      it('should parse range query with boost', () => {
        const result = parser.parseQuery({
          range: { price: { gte: 100, boost: 2.0 } },
        }) as NormalizedRangeClause

        expect(result.boost).toBe(2.0)
      })
    })

    describe('exists query', () => {
      it('should parse exists query', () => {
        const result = parser.parseQuery({
          exists: { field: 'description' },
        })

        expect(result.type).toBe('exists')
        expect((result as { field: string }).field).toBe('description')
      })
    })

    describe('prefix query', () => {
      it('should parse simple prefix query', () => {
        const result = parser.parseQuery({
          prefix: { name: 'mac' },
        })

        expect(result.type).toBe('prefix')
        const p = result as { field: string; value: string }
        expect(p.field).toBe('name')
        expect(p.value).toBe('mac')
      })

      it('should parse prefix query with options', () => {
        const result = parser.parseQuery({
          prefix: { name: { value: 'mac', boost: 1.5 } },
        })

        const p = result as { value: string; boost: number }
        expect(p.value).toBe('mac')
        expect(p.boost).toBe(1.5)
      })
    })

    describe('wildcard query', () => {
      it('should parse wildcard query', () => {
        const result = parser.parseQuery({
          wildcard: { name: '*book*' },
        })

        expect(result.type).toBe('wildcard')
        const w = result as { field: string; value: string }
        expect(w.field).toBe('name')
        expect(w.value).toBe('*book*')
      })
    })

    describe('ids query', () => {
      it('should parse ids query', () => {
        const result = parser.parseQuery({
          ids: { values: ['id1', 'id2', 'id3'] },
        })

        expect(result.type).toBe('ids')
        expect((result as { values: string[] }).values).toEqual(['id1', 'id2', 'id3'])
      })
    })

    describe('bool query', () => {
      it('should parse bool query with must', () => {
        const result = parser.parseQuery({
          bool: {
            must: [{ match: { title: 'hello' } }, { term: { status: 'active' } }],
          },
        }) as NormalizedBoolClause

        expect(result.type).toBe('bool')
        expect(result.must).toHaveLength(2)
        expect(result.must[0]!.type).toBe('match')
        expect(result.must[1]!.type).toBe('term')
      })

      it('should parse bool query with filter', () => {
        const result = parser.parseQuery({
          bool: {
            must: [{ match: { title: 'hello' } }],
            filter: [{ range: { price: { gte: 100 } } }],
          },
        }) as NormalizedBoolClause

        expect(result.filter).toHaveLength(1)
        expect(result.filter[0]!.type).toBe('range')
      })

      it('should parse bool query with should and minimum_should_match', () => {
        const result = parser.parseQuery({
          bool: {
            should: [{ term: { tag: 'a' } }, { term: { tag: 'b' } }, { term: { tag: 'c' } }],
            minimum_should_match: 2,
          },
        }) as NormalizedBoolClause

        expect(result.should).toHaveLength(3)
        expect(result.minimumShouldMatch).toBe(2)
      })

      it('should parse bool query with must_not', () => {
        const result = parser.parseQuery({
          bool: {
            must: [{ match_all: {} }],
            must_not: [{ term: { status: 'deleted' } }],
          },
        }) as NormalizedBoolClause

        expect(result.mustNot).toHaveLength(1)
        expect(result.mustNot[0]!.type).toBe('term')
      })

      it('should handle single query as clause (not array)', () => {
        const result = parser.parseQuery({
          bool: {
            must: { match: { title: 'hello' } },
          },
        }) as NormalizedBoolClause

        expect(result.must).toHaveLength(1)
        expect(result.must[0]!.type).toBe('match')
      })

      it('should set default minimum_should_match when only should clauses', () => {
        const result = parser.parseQuery({
          bool: {
            should: [{ term: { tag: 'a' } }, { term: { tag: 'b' } }],
          },
        }) as NormalizedBoolClause

        expect(result.minimumShouldMatch).toBe(1)
      })

      it('should parse nested bool queries', () => {
        const result = parser.parseQuery({
          bool: {
            must: [
              {
                bool: {
                  should: [{ term: { tag: 'a' } }, { term: { tag: 'b' } }],
                },
              },
            ],
            filter: [{ range: { price: { gte: 100 } } }],
          },
        }) as NormalizedBoolClause

        expect(result.must).toHaveLength(1)
        expect(result.must[0]!.type).toBe('bool')
        const nested = result.must[0] as NormalizedBoolClause
        expect(nested.should).toHaveLength(2)
      })

      it('should parse minimum_should_match as percentage', () => {
        const result = parser.parseQuery({
          bool: {
            should: [{ term: { tag: 'a' } }, { term: { tag: 'b' } }, { term: { tag: 'c' } }, { term: { tag: 'd' } }],
            minimum_should_match: '75%',
          },
        }) as NormalizedBoolClause

        // 75% of 4 = 3
        expect(result.minimumShouldMatch).toBe(3)
      })

      it('should parse negative minimum_should_match', () => {
        const result = parser.parseQuery({
          bool: {
            should: [{ term: { tag: 'a' } }, { term: { tag: 'b' } }, { term: { tag: 'c' } }, { term: { tag: 'd' } }],
            minimum_should_match: '-1',
          },
        }) as NormalizedBoolClause

        // 4 - 1 = 3
        expect(result.minimumShouldMatch).toBe(3)
      })
    })
  })

  // ==========================================================================
  // AGGREGATION PARSING
  // ==========================================================================

  describe('Aggregation Parsing', () => {
    describe('terms aggregation', () => {
      it('should parse terms aggregation', () => {
        const result = parser.parseAggregations({
          categories: {
            terms: { field: 'category' },
          },
        })

        const agg = result.categories as NormalizedTermsAgg
        expect(agg.type).toBe('terms')
        expect(agg.field).toBe('category')
        expect(agg.size).toBe(10) // default
        expect(agg.minDocCount).toBe(1) // default
      })

      it('should parse terms aggregation with options', () => {
        const result = parser.parseAggregations({
          categories: {
            terms: {
              field: 'category',
              size: 20,
              min_doc_count: 5,
              order: { _count: 'asc' },
            },
          },
        })

        const agg = result.categories as NormalizedTermsAgg
        expect(agg.size).toBe(20)
        expect(agg.minDocCount).toBe(5)
        expect(agg.order).toEqual([{ field: '_count', direction: 'asc' }])
      })

      it('should parse terms aggregation with sub-aggregations', () => {
        const result = parser.parseAggregations({
          categories: {
            terms: { field: 'category' },
            aggs: {
              avg_price: { avg: { field: 'price' } },
            },
          },
        })

        const agg = result.categories as NormalizedTermsAgg
        expect(agg.subAggs.avg_price).toBeDefined()
        expect(agg.subAggs.avg_price!.type).toBe('avg')
      })
    })

    describe('histogram aggregation', () => {
      it('should parse histogram aggregation', () => {
        const result = parser.parseAggregations({
          price_histogram: {
            histogram: { field: 'price', interval: 100 },
          },
        })

        const agg = result.price_histogram!
        expect(agg.type).toBe('histogram')
        expect((agg as any).field).toBe('price')
        expect((agg as any).interval).toBe(100)
      })
    })

    describe('date_histogram aggregation', () => {
      it('should parse date_histogram aggregation', () => {
        const result = parser.parseAggregations({
          by_month: {
            date_histogram: {
              field: 'created_at',
              calendar_interval: 'month',
              format: 'yyyy-MM',
            },
          },
        })

        const agg = result.by_month!
        expect(agg.type).toBe('date_histogram')
        expect((agg as any).calendarInterval).toBe('month')
        expect((agg as any).format).toBe('yyyy-MM')
      })
    })

    describe('range aggregation', () => {
      it('should parse range aggregation', () => {
        const result = parser.parseAggregations({
          price_ranges: {
            range: {
              field: 'price',
              ranges: [{ to: 100 }, { from: 100, to: 500 }, { from: 500 }],
            },
          },
        })

        const agg = result.price_ranges!
        expect(agg.type).toBe('range')
        expect((agg as any).ranges).toHaveLength(3)
      })
    })

    describe('metric aggregations', () => {
      it('should parse avg aggregation', () => {
        const result = parser.parseAggregations({
          avg_price: { avg: { field: 'price' } },
        })

        const agg = result.avg_price as NormalizedMetricAgg
        expect(agg.type).toBe('avg')
        expect(agg.field).toBe('price')
      })

      it('should parse sum aggregation', () => {
        const result = parser.parseAggregations({
          total: { sum: { field: 'amount' } },
        })

        expect(result.total!.type).toBe('sum')
      })

      it('should parse min aggregation', () => {
        const result = parser.parseAggregations({
          min_price: { min: { field: 'price' } },
        })

        expect(result.min_price!.type).toBe('min')
      })

      it('should parse max aggregation', () => {
        const result = parser.parseAggregations({
          max_price: { max: { field: 'price' } },
        })

        expect(result.max_price!.type).toBe('max')
      })

      it('should parse cardinality aggregation', () => {
        const result = parser.parseAggregations({
          unique_users: { cardinality: { field: 'user_id' } },
        })

        expect(result.unique_users!.type).toBe('cardinality')
      })

      it('should parse stats aggregation', () => {
        const result = parser.parseAggregations({
          price_stats: { stats: { field: 'price' } },
        })

        expect(result.price_stats!.type).toBe('stats')
      })

      it('should parse value_count aggregation', () => {
        const result = parser.parseAggregations({
          doc_count: { value_count: { field: 'id' } },
        })

        expect(result.doc_count!.type).toBe('value_count')
      })
    })

    describe('filter aggregation', () => {
      it('should parse filter aggregation', () => {
        const result = parser.parseAggregations({
          active_products: {
            filter: { term: { status: 'active' } },
            aggs: {
              avg_price: { avg: { field: 'price' } },
            },
          },
        })

        const agg = result.active_products!
        expect(agg.type).toBe('filter')
        expect((agg as any).filter.type).toBe('term')
        expect((agg as any).subAggs.avg_price).toBeDefined()
      })
    })

    describe('nested aggregations', () => {
      it('should parse deeply nested aggregations', () => {
        const result = parser.parseAggregations({
          by_category: {
            terms: { field: 'category' },
            aggs: {
              by_brand: {
                terms: { field: 'brand' },
                aggs: {
                  avg_price: { avg: { field: 'price' } },
                },
              },
            },
          },
        })

        const agg = result.by_category as NormalizedTermsAgg
        expect(agg.subAggs.by_brand).toBeDefined()
        const nested = agg.subAggs.by_brand as NormalizedTermsAgg
        expect(nested.subAggs.avg_price).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // SORT PARSING
  // ==========================================================================

  describe('Sort Parsing', () => {
    it('should parse empty sort', () => {
      const result = parser.parseSort(undefined)
      expect(result).toEqual([])
    })

    it('should parse string sort', () => {
      const result = parser.parseSort(['price'])
      expect(result).toHaveLength(1)
      expect(result[0]!.field).toBe('price')
      expect(result[0]!.order).toBe('asc')
    })

    it('should parse _score sort with default desc', () => {
      const result = parser.parseSort(['_score'])
      expect(result[0]!.field).toBe('_score')
      expect(result[0]!.order).toBe('desc')
    })

    it('should parse object sort with order', () => {
      const result = parser.parseSort([{ price: 'desc' }])
      expect(result[0]!.field).toBe('price')
      expect(result[0]!.order).toBe('desc')
    })

    it('should parse object sort with options', () => {
      const result = parser.parseSort([
        {
          price: {
            order: 'desc',
            mode: 'avg',
            missing: '_last',
          },
        },
      ])

      expect(result[0]!.field).toBe('price')
      expect(result[0]!.order).toBe('desc')
      expect(result[0]!.mode).toBe('avg')
      expect(result[0]!.missing).toBe('_last')
    })

    it('should parse multiple sort fields', () => {
      const result = parser.parseSort([{ category: 'asc' }, { price: 'desc' }, '_score'])

      expect(result).toHaveLength(3)
      expect(result[0]!.field).toBe('category')
      expect(result[0]!.order).toBe('asc')
      expect(result[1]!.field).toBe('price')
      expect(result[1]!.order).toBe('desc')
      expect(result[2]!.field).toBe('_score')
      expect(result[2]!.order).toBe('desc')
    })

    it('should parse ScoreSort object format', () => {
      const result = parser.parseSort([{ _score: 'asc' }])

      expect(result).toHaveLength(1)
      expect(result[0]!.field).toBe('_score')
      expect(result[0]!.order).toBe('asc')
    })

    it('should parse ScoreSort with order object', () => {
      const result = parser.parseSort([{ _score: { order: 'desc' } }])

      expect(result).toHaveLength(1)
      expect(result[0]!.field).toBe('_score')
      expect(result[0]!.order).toBe('desc')
    })
  })

  // ==========================================================================
  // PAGINATION PARSING
  // ==========================================================================

  describe('Pagination Parsing', () => {
    it('should parse default pagination', () => {
      const result = parser.parsePagination()
      expect(result.from).toBe(0)
      expect(result.size).toBe(10)
    })

    it('should parse custom pagination', () => {
      const result = parser.parsePagination(20, 50)
      expect(result.from).toBe(20)
      expect(result.size).toBe(50)
    })

    it('should parse search_after', () => {
      const result = parser.parsePagination(0, 10, ['2024-01-01', 'doc-123'])
      expect(result.searchAfter).toEqual(['2024-01-01', 'doc-123'])
    })
  })

  // ==========================================================================
  // SOURCE FILTER PARSING
  // ==========================================================================

  describe('Source Filter Parsing', () => {
    it('should parse undefined as enabled with all fields', () => {
      const result = parser.parseSourceFilter(undefined)
      expect(result.enabled).toBe(true)
      expect(result.includes).toEqual([])
      expect(result.excludes).toEqual([])
    })

    it('should parse true as enabled', () => {
      const result = parser.parseSourceFilter(true)
      expect(result.enabled).toBe(true)
    })

    it('should parse false as disabled', () => {
      const result = parser.parseSourceFilter(false)
      expect(result.enabled).toBe(false)
    })

    it('should parse string as single include', () => {
      const result = parser.parseSourceFilter('title')
      expect(result.enabled).toBe(true)
      expect(result.includes).toEqual(['title'])
    })

    it('should parse array as includes', () => {
      const result = parser.parseSourceFilter(['title', 'description'])
      expect(result.includes).toEqual(['title', 'description'])
    })

    it('should parse object with includes/excludes', () => {
      const result = parser.parseSourceFilter({
        includes: ['title', 'description'],
        excludes: ['internal_*'],
      })
      expect(result.includes).toEqual(['title', 'description'])
      expect(result.excludes).toEqual(['internal_*'])
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('Validation', () => {
    it('should validate correct query', () => {
      const result = parser.validateQuery({
        bool: {
          must: [{ match: { title: 'hello' } }],
        },
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate correct aggregations', () => {
      const result = parser.validateAggregations({
        categories: { terms: { field: 'category' } },
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  // ==========================================================================
  // QUERY ANALYSIS
  // ==========================================================================

  describe('Query Analysis', () => {
    it('should analyze simple match query', () => {
      const query = parser.parseQuery({ match: { title: 'hello' } })
      const analysis = analyzeQuery(query)

      expect(analysis.queryTypes).toContain('match')
      expect(analysis.fields).toContain('title')
      expect(analysis.hasFullText).toBe(true)
      expect(analysis.isFilterOnly).toBe(false)
    })

    it('should analyze bool query', () => {
      const query = parser.parseQuery({
        bool: {
          must: [{ match: { title: 'hello' } }],
          filter: [{ term: { status: 'active' } }, { range: { price: { gte: 100 } } }],
        },
      })
      const analysis = analyzeQuery(query)

      expect(analysis.queryTypes).toContain('bool')
      expect(analysis.queryTypes).toContain('match')
      expect(analysis.queryTypes).toContain('term')
      expect(analysis.queryTypes).toContain('range')
      expect(analysis.fields).toContain('title')
      expect(analysis.fields).toContain('status')
      expect(analysis.fields).toContain('price')
    })

    it('should identify filter-only query', () => {
      const query = parser.parseQuery({
        bool: {
          filter: [{ term: { status: 'active' } }],
        },
      })
      const analysis = analyzeQuery(query)

      expect(analysis.hasFullText).toBe(false)
    })
  })

  // ==========================================================================
  // SEARCH TERMS EXTRACTION
  // ==========================================================================

  describe('Search Terms Extraction', () => {
    it('should extract terms from match query', () => {
      const query = parser.parseQuery({ match: { title: 'hello world' } })
      const terms = extractSearchTerms(query)

      expect(terms).toContain('hello world')
    })

    it('should extract terms from multi_match query', () => {
      const query = parser.parseQuery({
        multi_match: {
          query: 'search text',
          fields: ['title', 'description'],
        },
      })
      const terms = extractSearchTerms(query)

      expect(terms).toContain('search text')
    })

    it('should extract terms from bool query', () => {
      const query = parser.parseQuery({
        bool: {
          must: [{ match: { title: 'hello' } }],
          should: [{ match: { description: 'world' } }],
        },
      })
      const terms = extractSearchTerms(query)

      expect(terms).toContain('hello')
      expect(terms).toContain('world')
    })

    it('should deduplicate terms', () => {
      const query = parser.parseQuery({
        bool: {
          should: [{ match: { title: 'same' } }, { match: { description: 'same' } }],
        },
      })
      const terms = extractSearchTerms(query)

      expect(terms).toHaveLength(1)
      expect(terms).toContain('same')
    })
  })
})
