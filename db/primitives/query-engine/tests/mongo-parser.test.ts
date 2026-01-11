/**
 * RED Phase: MongoDB Query Parser Tests
 *
 * Tests for the MongoDB query language parser that converts
 * MongoDB query syntax to unified AST.
 *
 * @see dotdo-rfdrr
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import types that will be implemented in GREEN phase
import type { MongoQueryParser, MongoQuery, AggregationPipeline } from '../parsers/mongo-parser'
import type { PredicateNode, LogicalNode, QueryNode, GroupByNode, SortNode, ProjectionNode } from '../ast'

describe('MongoQueryParser', () => {
  let parser: MongoQueryParser

  beforeEach(() => {
    // Parser will be implemented in GREEN phase
    parser = {} as MongoQueryParser
  })

  describe('comparison operators', () => {
    it('should parse implicit $eq: {field: value}', () => {
      const query: MongoQuery = { name: 'Alice' }

      const ast = parser.parse(query)

      expect(ast.type).toBe('predicate')
      expect((ast as PredicateNode).column).toBe('name')
      expect((ast as PredicateNode).op).toBe('=')
      expect((ast as PredicateNode).value).toBe('Alice')
    })

    it('should parse $eq: {field: {$eq: value}}', () => {
      const query: MongoQuery = { age: { $eq: 25 } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('=')
      expect((ast as PredicateNode).value).toBe(25)
    })

    it('should parse $ne: {field: {$ne: value}}', () => {
      const query: MongoQuery = { status: { $ne: 'deleted' } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('!=')
      expect((ast as PredicateNode).value).toBe('deleted')
    })

    it('should parse $gt, $gte, $lt, $lte', () => {
      const queries: Array<{ query: MongoQuery; expectedOp: string }> = [
        { query: { age: { $gt: 21 } }, expectedOp: '>' },
        { query: { age: { $gte: 21 } }, expectedOp: '>=' },
        { query: { age: { $lt: 65 } }, expectedOp: '<' },
        { query: { age: { $lte: 65 } }, expectedOp: '<=' },
      ]

      for (const { query, expectedOp } of queries) {
        const ast = parser.parse(query)
        expect((ast as PredicateNode).op).toBe(expectedOp)
      }
    })

    it('should parse $in: {field: {$in: [a, b, c]}}', () => {
      const query: MongoQuery = { status: { $in: ['active', 'pending', 'review'] } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('IN')
      expect((ast as PredicateNode).value).toEqual(['active', 'pending', 'review'])
    })

    it('should parse $nin', () => {
      const query: MongoQuery = { category: { $nin: ['spam', 'deleted'] } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('NOT IN')
      expect((ast as PredicateNode).value).toEqual(['spam', 'deleted'])
    })

    it('should parse multiple comparison operators on same field', () => {
      // { age: { $gte: 18, $lte: 65 } }
      const query: MongoQuery = { age: { $gte: 18, $lte: 65 } }

      const ast = parser.parse(query)

      // Should produce AND of two predicates
      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('AND')
      expect((ast as LogicalNode).children).toHaveLength(2)
    })
  })

  describe('logical operators', () => {
    it('should parse $and: {$and: [{}, {}]}', () => {
      const query: MongoQuery = {
        $and: [{ age: { $gte: 18 } }, { status: 'active' }],
      }

      const ast = parser.parse(query)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('AND')
      expect((ast as LogicalNode).children).toHaveLength(2)
    })

    it('should parse $or: {$or: [{}, {}]}', () => {
      const query: MongoQuery = {
        $or: [{ role: 'admin' }, { role: 'moderator' }],
      }

      const ast = parser.parse(query)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('OR')
      expect((ast as LogicalNode).children).toHaveLength(2)
    })

    it('should parse $not: {field: {$not: {}}}', () => {
      const query: MongoQuery = {
        age: { $not: { $lt: 18 } },
      }

      const ast = parser.parse(query)

      // $not negates the inner condition
      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('NOT')
    })

    it('should parse $nor: {$nor: [{}, {}]}', () => {
      const query: MongoQuery = {
        $nor: [{ deleted: true }, { archived: true }],
      }

      const ast = parser.parse(query)

      // $nor is NOT(OR(...))
      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('NOT')
      const inner = (ast as LogicalNode).children[0] as LogicalNode
      expect(inner.op).toBe('OR')
    })

    it('should parse implicit AND for multiple fields', () => {
      const query: MongoQuery = {
        name: 'Alice',
        age: { $gte: 18 },
        status: 'active',
      }

      const ast = parser.parse(query)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('AND')
      expect((ast as LogicalNode).children).toHaveLength(3)
    })

    it('should handle deeply nested logical operators', () => {
      const query: MongoQuery = {
        $or: [
          {
            $and: [{ a: 1 }, { b: 2 }],
          },
          {
            $and: [{ c: 3 }, { d: 4 }],
          },
        ],
      }

      const ast = parser.parse(query)

      expect((ast as LogicalNode).op).toBe('OR')
      expect((ast as LogicalNode).children).toHaveLength(2)
      expect((ast as LogicalNode).children[0].type).toBe('logical')
    })
  })

  describe('element operators', () => {
    it('should parse $exists: true', () => {
      const query: MongoQuery = { email: { $exists: true } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('IS NOT NULL')
    })

    it('should parse $exists: false', () => {
      const query: MongoQuery = { deletedAt: { $exists: false } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('IS NULL')
    })

    it('should parse $type', () => {
      const query: MongoQuery = { value: { $type: 'number' } }

      const ast = parser.parse(query)

      // Type checking may be a special predicate or annotation
      expect(ast).toBeDefined()
    })

    it('should parse $type with BSON type codes', () => {
      const query: MongoQuery = { value: { $type: 1 } } // Double

      const ast = parser.parse(query)

      expect(ast).toBeDefined()
    })
  })

  describe('evaluation operators', () => {
    it('should parse $regex', () => {
      const query: MongoQuery = { email: { $regex: '^alice' } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('LIKE')
    })

    it('should parse $regex with $options', () => {
      const query: MongoQuery = {
        email: { $regex: 'example\\.com$', $options: 'i' },
      }

      const ast = parser.parse(query)

      // Should include case-insensitive flag
      expect(ast).toBeDefined()
    })

    it('should parse $regex as RegExp object', () => {
      const query: MongoQuery = { name: /^Alice/i }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('LIKE')
    })

    it('should parse $mod operator', () => {
      const query: MongoQuery = { age: { $mod: [2, 0] } } // Even numbers

      const ast = parser.parse(query)

      expect(ast).toBeDefined()
    })

    it('should parse $expr for expression evaluation', () => {
      const query: MongoQuery = {
        $expr: { $gt: ['$quantity', '$inStock'] },
      }

      const ast = parser.parse(query)

      // Expression comparing two fields
      expect(ast).toBeDefined()
    })
  })

  describe('array operators', () => {
    it('should parse $all', () => {
      const query: MongoQuery = { tags: { $all: ['urgent', 'important'] } }

      const ast = parser.parse(query)

      // $all means array contains all specified elements
      expect(ast).toBeDefined()
    })

    it('should parse $elemMatch', () => {
      const query: MongoQuery = {
        items: { $elemMatch: { price: { $gt: 100 }, quantity: { $gte: 5 } } },
      }

      const ast = parser.parse(query)

      // $elemMatch filters array elements
      expect(ast).toBeDefined()
    })

    it('should parse $size', () => {
      const query: MongoQuery = { tags: { $size: 3 } }

      const ast = parser.parse(query)

      // Array length predicate
      expect(ast).toBeDefined()
    })
  })

  describe('text/vector operators', () => {
    it('should parse $text: {$search: "query"}', () => {
      const query: MongoQuery = {
        $text: { $search: 'coffee shop' },
      }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('CONTAINS')
      expect((ast as PredicateNode).value).toBe('coffee shop')
    })

    it('should parse $text with language option', () => {
      const query: MongoQuery = {
        $text: { $search: 'cafe', $language: 'fr' },
      }

      const ast = parser.parse(query)

      expect(ast).toBeDefined()
    })

    it('should parse $text with caseSensitive option', () => {
      const query: MongoQuery = {
        $text: { $search: 'MongoDB', $caseSensitive: true },
      }

      const ast = parser.parse(query)

      expect(ast).toBeDefined()
    })

    it('should parse $vector: {$near: [], $k: 10}', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      const query: MongoQuery = {
        $vector: { $near: embedding, $k: 10 },
      }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('NEAR')
      expect((ast as PredicateNode).value).toEqual(embedding)
      expect((ast as PredicateNode).k).toBe(10)
    })

    it('should parse $vector with minScore', () => {
      const query: MongoQuery = {
        $vector: { $near: [0.1, 0.2, 0.3], $k: 10, $minScore: 0.8 },
      }

      const ast = parser.parse(query)

      expect(ast).toBeDefined()
    })
  })

  describe('nested fields', () => {
    it('should parse dot notation: {"a.b.c": value}', () => {
      const query: MongoQuery = { 'address.city': 'San Francisco' }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).column).toBe('address.city')
    })

    it('should handle array indexing: {"items.0.price": value}', () => {
      const query: MongoQuery = { 'items.0.price': { $gt: 100 } }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).column).toBe('items.0.price')
    })

    it('should handle deeply nested paths', () => {
      const query: MongoQuery = { 'a.b.c.d.e.f': 'value' }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).column).toBe('a.b.c.d.e.f')
    })

    it('should handle mixed nested and operators', () => {
      const query: MongoQuery = {
        'profile.settings.notifications.email': { $exists: true },
        'profile.settings.notifications.push': { $ne: false },
      }

      const ast = parser.parse(query)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).children).toHaveLength(2)
    })
  })

  describe('aggregation pipeline', () => {
    it('should parse $match stage', () => {
      const pipeline: AggregationPipeline = [{ $match: { status: 'active' } }]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })

    it('should parse $group stage with accumulators', () => {
      const pipeline: AggregationPipeline = [
        {
          $group: {
            _id: '$category',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' },
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast.groupBy).toBeDefined()
      expect((ast.groupBy as GroupByNode).columns).toContain('category')
    })

    it('should parse $project stage', () => {
      const pipeline: AggregationPipeline = [
        {
          $project: {
            name: 1,
            email: 1,
            _id: 0,
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast.projection).toBeDefined()
    })

    it('should parse $project with computed fields', () => {
      const pipeline: AggregationPipeline = [
        {
          $project: {
            fullName: { $concat: ['$firstName', ' ', '$lastName'] },
            total: { $add: ['$price', '$tax'] },
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast.projection).toBeDefined()
    })

    it('should parse $sort stage', () => {
      const pipeline: AggregationPipeline = [{ $sort: { createdAt: -1, name: 1 } }]

      const ast = parser.parsePipeline(pipeline)

      expect(ast.sort).toBeDefined()
      expect((ast.sort as SortNode).columns).toHaveLength(2)
    })

    it('should parse $limit and $skip', () => {
      const pipeline: AggregationPipeline = [{ $skip: 10 }, { $limit: 20 }]

      const ast = parser.parsePipeline(pipeline)

      expect(ast.skip).toBe(10)
      expect(ast.limit).toBe(20)
    })

    it('should parse $unwind', () => {
      const pipeline: AggregationPipeline = [{ $unwind: '$items' }]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })

    it('should parse $unwind with options', () => {
      const pipeline: AggregationPipeline = [
        {
          $unwind: {
            path: '$items',
            preserveNullAndEmptyArrays: true,
            includeArrayIndex: 'itemIndex',
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })

    it('should parse $lookup', () => {
      const pipeline: AggregationPipeline = [
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customer',
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast.join).toBeDefined()
    })

    it('should parse $lookup with pipeline', () => {
      const pipeline: AggregationPipeline = [
        {
          $lookup: {
            from: 'orders',
            let: { customerId: '$_id' },
            pipeline: [{ $match: { $expr: { $eq: ['$customerId', '$$customerId'] } } }],
            as: 'orders',
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })

    it('should parse complex multi-stage pipeline', () => {
      const pipeline: AggregationPipeline = [
        { $match: { status: 'active' } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$category',
            total: { $sum: '$items.price' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gte: 10 } } },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })

    it('should parse $facet stage', () => {
      const pipeline: AggregationPipeline = [
        {
          $facet: {
            byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })

    it('should parse $bucket stage', () => {
      const pipeline: AggregationPipeline = [
        {
          $bucket: {
            groupBy: '$price',
            boundaries: [0, 50, 100, 500, Infinity],
            default: 'Other',
            output: {
              count: { $sum: 1 },
              avgPrice: { $avg: '$price' },
            },
          },
        },
      ]

      const ast = parser.parsePipeline(pipeline)

      expect(ast).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw on unknown operator', () => {
      const query: MongoQuery = { field: { $unknownOp: 'value' } }

      expect(() => parser.parse(query)).toThrow(/unknown operator/i)
    })

    it('should throw on invalid $in value', () => {
      const query: MongoQuery = { field: { $in: 'not-an-array' } }

      expect(() => parser.parse(query)).toThrow(/array/i)
    })

    it('should throw on invalid $and value', () => {
      const query: MongoQuery = { $and: { field: 'value' } } // Should be array

      expect(() => parser.parse(query)).toThrow(/array/i)
    })

    it('should provide helpful error messages with field path', () => {
      const query: MongoQuery = { 'deep.nested.field': { $invalidOp: 1 } }

      expect(() => parser.parse(query)).toThrow(/deep\.nested\.field/i)
    })
  })

  describe('performance', () => {
    it('should parse 10k queries per second', () => {
      const queries: MongoQuery[] = []
      for (let i = 0; i < 10000; i++) {
        queries.push({
          [`field${i % 100}`]: { $gt: i, $lt: i + 100 },
          status: { $in: ['active', 'pending'] },
        })
      }

      const start = performance.now()
      for (const query of queries) {
        parser.parse(query)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000) // Under 1 second
    })

    it('should handle large $in arrays efficiently', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => `item-${i}`)
      const query: MongoQuery = { id: { $in: largeArray } }

      const start = performance.now()
      parser.parse(query)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100) // Under 100ms
    })
  })

  describe('edge cases', () => {
    it('should handle empty query', () => {
      const query: MongoQuery = {}

      const ast = parser.parse(query)

      // Empty query matches all - should produce no predicates or always-true
      expect(ast).toBeDefined()
    })

    it('should handle null values', () => {
      const query: MongoQuery = { field: null }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).op).toBe('IS NULL')
    })

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01')
      const query: MongoQuery = { createdAt: { $gte: date } }

      const ast = parser.parse(query)

      expect(typeof (ast as PredicateNode).value).toBe('number')
    })

    it('should handle ObjectId strings', () => {
      const query: MongoQuery = { _id: '507f1f77bcf86cd799439011' }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).value).toBe('507f1f77bcf86cd799439011')
    })

    it('should handle special characters in field names', () => {
      const query: MongoQuery = { 'field-with-dashes': 'value' }

      const ast = parser.parse(query)

      expect((ast as PredicateNode).column).toBe('field-with-dashes')
    })
  })
})
