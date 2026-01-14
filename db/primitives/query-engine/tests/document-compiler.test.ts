/**
 * Document Compiler Tests
 *
 * Tests for the query compiler that translates document queries
 * (MongoDB, Mango, DynamoDB) to primitive operations.
 *
 * Following TDD: write failing tests first, then implement to make them pass.
 *
 * @see dotdo-4kx6k
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import types and the compiler
import type { PredicateNode, LogicalNode, QueryNode } from '../ast'
import type { Predicate, ColumnBatch } from '../../typed-column-store'
import type { TimeRange } from '../../temporal-store'

// Import the DocumentCompiler (to be implemented)
import {
  DocumentCompiler,
  type DocumentQuery,
  type MangoSelector,
  type DynamoDBQuery,
  type CompiledDocumentQuery,
  type ExecutionPlan,
  type IndexedFieldConfig,
} from '../compilers/document-compiler'

describe('DocumentCompiler', () => {
  let compiler: DocumentCompiler

  beforeEach(() => {
    compiler = new DocumentCompiler()
  })

  // ==========================================================================
  // MongoDB Filter Syntax
  // ==========================================================================

  describe('MongoDB filter syntax', () => {
    describe('comparison operators', () => {
      it('should compile $eq: { field: { $eq: value } }', () => {
        const query: DocumentQuery = { status: { $eq: 'active' } }
        const result = compiler.compile(query)

        expect(result.ast).toBeDefined()
        expect(result.ast.type).toBe('predicate')
        expect((result.ast as PredicateNode).column).toBe('status')
        expect((result.ast as PredicateNode).op).toBe('=')
        expect((result.ast as PredicateNode).value).toBe('active')
      })

      it('should compile implicit $eq: { field: value }', () => {
        const query: DocumentQuery = { status: 'active' }
        const result = compiler.compile(query)

        expect(result.ast.type).toBe('predicate')
        expect((result.ast as PredicateNode).op).toBe('=')
      })

      it('should compile $ne: { field: { $ne: value } }', () => {
        const query: DocumentQuery = { status: { $ne: 'deleted' } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('!=')
      })

      it('should compile $gt: { age: { $gt: 21 } }', () => {
        const query: DocumentQuery = { age: { $gt: 21 } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).column).toBe('age')
        expect((result.ast as PredicateNode).op).toBe('>')
        expect((result.ast as PredicateNode).value).toBe(21)
      })

      it('should compile $gte: { age: { $gte: 18 } }', () => {
        const query: DocumentQuery = { age: { $gte: 18 } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('>=')
      })

      it('should compile $lt: { price: { $lt: 100 } }', () => {
        const query: DocumentQuery = { price: { $lt: 100 } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('<')
      })

      it('should compile $lte: { price: { $lte: 50 } }', () => {
        const query: DocumentQuery = { price: { $lte: 50 } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('<=')
      })

      it('should compile $in: { category: { $in: ["A", "B", "C"] } }', () => {
        const query: DocumentQuery = { category: { $in: ['A', 'B', 'C'] } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('IN')
        expect((result.ast as PredicateNode).value).toEqual(['A', 'B', 'C'])
      })

      it('should compile $nin: { status: { $nin: ["deleted", "archived"] } }', () => {
        const query: DocumentQuery = { status: { $nin: ['deleted', 'archived'] } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('NOT IN')
      })
    })

    describe('logical operators', () => {
      it('should compile $and: { $and: [{ a: 1 }, { b: 2 }] }', () => {
        const query: DocumentQuery = { $and: [{ a: 1 }, { b: 2 }] }
        const result = compiler.compile(query)

        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('AND')
        expect((result.ast as LogicalNode).children).toHaveLength(2)
      })

      it('should compile $or: { $or: [{ status: "active" }, { priority: "high" }] }', () => {
        const query: DocumentQuery = { $or: [{ status: 'active' }, { priority: 'high' }] }
        const result = compiler.compile(query)

        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('OR')
      })

      it('should compile $not: { age: { $not: { $gt: 21 } } }', () => {
        const query: DocumentQuery = { age: { $not: { $gt: 21 } } }
        const result = compiler.compile(query)

        // NOT(age > 21) = age <= 21
        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('NOT')
      })

      it('should compile $nor: { $nor: [{ status: "deleted" }, { archived: true }] }', () => {
        const query: DocumentQuery = { $nor: [{ status: 'deleted' }, { archived: true }] }
        const result = compiler.compile(query)

        // $nor is NOT(OR(...))
        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('NOT')
        const inner = (result.ast as LogicalNode).children[0] as LogicalNode
        expect(inner.op).toBe('OR')
      })

      it('should compile implicit AND for multiple fields: { a: 1, b: 2 }', () => {
        const query: DocumentQuery = { a: 1, b: 2 }
        const result = compiler.compile(query)

        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('AND')
        expect((result.ast as LogicalNode).children).toHaveLength(2)
      })
    })

    describe('element operators', () => {
      it('should compile $exists: true', () => {
        const query: DocumentQuery = { email: { $exists: true } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('IS NOT NULL')
      })

      it('should compile $exists: false', () => {
        const query: DocumentQuery = { email: { $exists: false } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('IS NULL')
      })
    })

    describe('string operators', () => {
      it('should compile $regex: { name: { $regex: "^John" } }', () => {
        const query: DocumentQuery = { name: { $regex: '^John' } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).op).toBe('LIKE')
        expect((result.ast as PredicateNode).value).toBe('John%')
      })

      it('should compile $regex with $options: { name: { $regex: "john", $options: "i" } }', () => {
        const query: DocumentQuery = { name: { $regex: 'john', $options: 'i' } }
        const result = compiler.compile(query)

        // Case-insensitive regex
        expect(result.ast.type).toBe('predicate')
        expect(result.regexOptions).toEqual({ caseInsensitive: true })
      })

      it('should compile regex suffix pattern to LIKE', () => {
        const query: DocumentQuery = { email: { $regex: '@gmail\\.com$' } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).value).toBe('%@gmail.com')
      })

      it('should compile regex contains pattern to LIKE', () => {
        const query: DocumentQuery = { description: { $regex: 'urgent' } }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).value).toBe('%urgent%')
      })
    })

    describe('nested fields', () => {
      it('should compile dot notation: { "address.city": "NYC" }', () => {
        const query: DocumentQuery = { 'address.city': 'NYC' }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).column).toBe('address.city')
      })

      it('should compile deeply nested: { "user.profile.settings.theme": "dark" }', () => {
        const query: DocumentQuery = { 'user.profile.settings.theme': 'dark' }
        const result = compiler.compile(query)

        expect((result.ast as PredicateNode).column).toBe('user.profile.settings.theme')
      })
    })

    describe('combined operators on same field', () => {
      it('should compile multiple operators: { age: { $gte: 18, $lte: 65 } }', () => {
        const query: DocumentQuery = { age: { $gte: 18, $lte: 65 } }
        const result = compiler.compile(query)

        // Becomes AND(age >= 18, age <= 65)
        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('AND')
        expect((result.ast as LogicalNode).children).toHaveLength(2)
      })
    })
  })

  // ==========================================================================
  // Mango Selector Syntax (CouchDB/Cloudant)
  // ==========================================================================

  describe('Mango selector syntax', () => {
    it('should compile Mango equality: { selector: { field: value } }', () => {
      const selector: MangoSelector = { status: 'active' }
      const result = compiler.compileMango(selector)

      expect((result.ast as PredicateNode).column).toBe('status')
      expect((result.ast as PredicateNode).op).toBe('=')
    })

    it('should compile Mango $eq: { selector: { field: { "$eq": value } } }', () => {
      const selector: MangoSelector = { type: { $eq: 'user' } }
      const result = compiler.compileMango(selector)

      expect((result.ast as PredicateNode).op).toBe('=')
    })

    it('should compile Mango $gt/$lt range: { age: { "$gt": 18, "$lt": 65 } }', () => {
      const selector: MangoSelector = { age: { $gt: 18, $lt: 65 } }
      const result = compiler.compileMango(selector)

      expect(result.ast.type).toBe('logical')
      expect((result.ast as LogicalNode).op).toBe('AND')
    })

    it('should compile Mango $and: { "$and": [...] }', () => {
      const selector: MangoSelector = {
        $and: [{ status: 'active' }, { type: 'premium' }],
      }
      const result = compiler.compileMango(selector)

      expect((result.ast as LogicalNode).op).toBe('AND')
    })

    it('should compile Mango $or: { "$or": [...] }', () => {
      const selector: MangoSelector = {
        $or: [{ status: 'active' }, { status: 'pending' }],
      }
      const result = compiler.compileMango(selector)

      expect((result.ast as LogicalNode).op).toBe('OR')
    })

    it('should compile Mango $not: { field: { "$not": { "$eq": value } } }', () => {
      const selector: MangoSelector = {
        status: { $not: { $eq: 'deleted' } },
      }
      const result = compiler.compileMango(selector)

      // $not wraps the inner condition
      expect(result.ast.type).toBe('logical')
    })

    it('should compile Mango $in: { field: { "$in": [...] } }', () => {
      const selector: MangoSelector = {
        category: { $in: ['A', 'B', 'C'] },
      }
      const result = compiler.compileMango(selector)

      expect((result.ast as PredicateNode).op).toBe('IN')
    })

    it('should compile Mango $nin: { field: { "$nin": [...] } }', () => {
      const selector: MangoSelector = {
        status: { $nin: ['deleted', 'archived'] },
      }
      const result = compiler.compileMango(selector)

      expect((result.ast as PredicateNode).op).toBe('NOT IN')
    })

    it('should compile Mango $exists: { field: { "$exists": true } }', () => {
      const selector: MangoSelector = {
        email: { $exists: true },
      }
      const result = compiler.compileMango(selector)

      expect((result.ast as PredicateNode).op).toBe('IS NOT NULL')
    })

    it('should compile Mango $regex: { field: { "$regex": "pattern" } }', () => {
      const selector: MangoSelector = {
        name: { $regex: '^John' },
      }
      const result = compiler.compileMango(selector)

      expect((result.ast as PredicateNode).op).toBe('LIKE')
    })

    it('should compile Mango $nor: { "$nor": [...] }', () => {
      const selector: MangoSelector = {
        $nor: [{ status: 'deleted' }, { archived: true }],
      }
      const result = compiler.compileMango(selector)

      // $nor is NOT(OR(...))
      const ast = result.ast as LogicalNode
      expect(ast.op).toBe('NOT')
    })
  })

  // ==========================================================================
  // DynamoDB Query Syntax
  // ==========================================================================

  describe('DynamoDB query syntax', () => {
    describe('KeyConditionExpression', () => {
      it('should compile simple equality: pk = :pkVal', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pkVal',
          ExpressionAttributeValues: { ':pkVal': 'user#123' },
        }
        const result = compiler.compileDynamoDB(query)

        expect((result.ast as PredicateNode).column).toBe('pk')
        expect((result.ast as PredicateNode).op).toBe('=')
        expect((result.ast as PredicateNode).value).toBe('user#123')
      })

      it('should compile compound key: pk = :pk AND sk > :sk', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk AND sk > :sk',
          ExpressionAttributeValues: { ':pk': 'user#123', ':sk': '2024-01-01' },
        }
        const result = compiler.compileDynamoDB(query)

        expect(result.ast.type).toBe('logical')
        expect((result.ast as LogicalNode).op).toBe('AND')
        expect((result.ast as LogicalNode).children).toHaveLength(2)
      })

      it('should compile begins_with: pk = :pk AND begins_with(sk, :prefix)', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': 'user#123', ':prefix': 'order#' },
        }
        const result = compiler.compileDynamoDB(query)

        const andNode = result.ast as LogicalNode
        const beginsWithPred = andNode.children[1] as PredicateNode
        expect(beginsWithPred.op).toBe('STARTS_WITH')
        expect(beginsWithPred.value).toBe('order#')
      })

      it('should compile between: pk = :pk AND sk BETWEEN :start AND :end', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: { ':pk': 'user#123', ':start': '2024-01-01', ':end': '2024-12-31' },
        }
        const result = compiler.compileDynamoDB(query)

        const andNode = result.ast as LogicalNode
        const betweenPred = andNode.children[1] as PredicateNode
        expect(betweenPred.op).toBe('BETWEEN')
        expect(betweenPred.value).toEqual(['2024-01-01', '2024-12-31'])
      })
    })

    describe('FilterExpression', () => {
      it('should compile simple filter: status = :status', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :status',
          ExpressionAttributeValues: { ':pk': 'user#123', ':status': 'active' },
        }
        const result = compiler.compileDynamoDB(query)

        expect(result.filterPredicates).toBeDefined()
        expect(result.filterPredicates).toHaveLength(1)
      })

      it('should compile filter with AND: status = :s AND age > :a', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :s AND age > :a',
          ExpressionAttributeValues: { ':pk': 'user#123', ':s': 'active', ':a': 18 },
        }
        const result = compiler.compileDynamoDB(query)

        expect(result.filterPredicates).toHaveLength(2)
      })

      it('should compile filter with OR: status = :s OR priority = :p', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :s OR priority = :p',
          ExpressionAttributeValues: { ':pk': 'user#123', ':s': 'active', ':p': 'high' },
        }
        const result = compiler.compileDynamoDB(query)

        expect(result.filterLogicalOp).toBe('OR')
      })

      it('should compile filter with NOT: NOT status = :s', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'NOT status = :s',
          ExpressionAttributeValues: { ':pk': 'user#123', ':s': 'deleted' },
        }
        const result = compiler.compileDynamoDB(query)

        expect(result.filterPredicates).toBeDefined()
      })

      it('should compile attribute_exists', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'attribute_exists(email)',
          ExpressionAttributeValues: { ':pk': 'user#123' },
        }
        const result = compiler.compileDynamoDB(query)

        const filterPred = result.filterPredicates![0]
        expect((filterPred as PredicateNode).op).toBe('IS NOT NULL')
      })

      it('should compile attribute_not_exists', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'attribute_not_exists(deletedAt)',
          ExpressionAttributeValues: { ':pk': 'user#123' },
        }
        const result = compiler.compileDynamoDB(query)

        const filterPred = result.filterPredicates![0]
        expect((filterPred as PredicateNode).op).toBe('IS NULL')
      })

      it('should compile contains function', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'contains(tags, :tag)',
          ExpressionAttributeValues: { ':pk': 'user#123', ':tag': 'premium' },
        }
        const result = compiler.compileDynamoDB(query)

        const filterPred = result.filterPredicates![0]
        expect((filterPred as PredicateNode).op).toBe('CONTAINS')
      })

      it('should compile size function', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'size(items) > :count',
          ExpressionAttributeValues: { ':pk': 'user#123', ':count': 0 },
        }
        const result = compiler.compileDynamoDB(query)

        // Size becomes a special predicate
        expect(result.filterPredicates).toBeDefined()
      })
    })

    describe('ExpressionAttributeNames', () => {
      it('should resolve attribute name placeholders: #s = :status', () => {
        const query: DynamoDBQuery = {
          KeyConditionExpression: '#pk = :pk',
          FilterExpression: '#s = :status',
          ExpressionAttributeNames: { '#pk': 'pk', '#s': 'status' },
          ExpressionAttributeValues: { ':pk': 'user#123', ':status': 'active' },
        }
        const result = compiler.compileDynamoDB(query)

        const filterPred = result.filterPredicates![0] as PredicateNode
        expect(filterPred.column).toBe('status')
      })
    })
  })

  // ==========================================================================
  // Execution Planning
  // ==========================================================================

  describe('execution planning', () => {
    it('should route indexed fields to TypedColumnStore.filter()', () => {
      const query: DocumentQuery = { status: 'active' }
      const indexedFields: IndexedFieldConfig[] = [{ field: 'status', type: 'string' }]

      const result = compiler.compile(query, { indexedFields })

      expect(result.plan.indexedOperations).toHaveLength(1)
      expect(result.plan.indexedOperations[0].field).toBe('status')
    })

    it('should route non-indexed fields to full scan', () => {
      const query: DocumentQuery = { customField: 'value' }
      const indexedFields: IndexedFieldConfig[] = []

      const result = compiler.compile(query, { indexedFields })

      expect(result.plan.fullScanPredicates).toHaveLength(1)
    })

    it('should split query into indexed and non-indexed parts', () => {
      const query: DocumentQuery = { status: 'active', customField: 'value' }
      const indexedFields: IndexedFieldConfig[] = [{ field: 'status', type: 'string' }]

      const result = compiler.compile(query, { indexedFields })

      expect(result.plan.indexedOperations).toHaveLength(1)
      expect(result.plan.fullScanPredicates).toHaveLength(1)
    })

    it('should identify time range for TemporalStore operations', () => {
      const query: DocumentQuery = {
        createdAt: { $gte: 1704067200000, $lte: 1706745600000 },
      }
      const indexedFields: IndexedFieldConfig[] = [{ field: 'createdAt', type: 'timestamp', temporal: true }]

      const result = compiler.compile(query, { indexedFields })

      expect(result.plan.temporalRange).toBeDefined()
      expect(result.plan.temporalRange!.start).toBe(1704067200000)
      expect(result.plan.temporalRange!.end).toBe(1706745600000)
    })

    it('should combine results with AND logic', () => {
      const query: DocumentQuery = { status: 'active', priority: 'high' }
      const indexedFields: IndexedFieldConfig[] = [
        { field: 'status', type: 'string' },
        { field: 'priority', type: 'string' },
      ]

      const result = compiler.compile(query, { indexedFields })

      expect(result.plan.combineLogic).toBe('AND')
    })

    it('should flag OR queries for union operation', () => {
      const query: DocumentQuery = { $or: [{ status: 'active' }, { priority: 'high' }] }
      const indexedFields: IndexedFieldConfig[] = [
        { field: 'status', type: 'string' },
        { field: 'priority', type: 'string' },
      ]

      const result = compiler.compile(query, { indexedFields })

      expect(result.plan.combineLogic).toBe('OR')
      expect(result.plan.requiresUnion).toBe(true)
    })
  })

  // ==========================================================================
  // TypedColumnStore Predicate Output
  // ==========================================================================

  describe('TypedColumnStore predicate output', () => {
    it('should output TCS predicate for equality', () => {
      const query: DocumentQuery = { status: 'active' }
      const result = compiler.compile(query)

      const tcsPredicate = result.toTCSPredicates()[0]
      expect(tcsPredicate).toEqual({
        column: 'status',
        op: '=',
        value: 'active',
      })
    })

    it('should output TCS predicate for range', () => {
      const query: DocumentQuery = { age: { $gt: 21 } }
      const result = compiler.compile(query)

      const tcsPredicate = result.toTCSPredicates()[0]
      expect(tcsPredicate.op).toBe('>')
    })

    it('should output TCS predicate for IN', () => {
      const query: DocumentQuery = { category: { $in: ['A', 'B'] } }
      const result = compiler.compile(query)

      const tcsPredicate = result.toTCSPredicates()[0]
      expect(tcsPredicate.op).toBe('in')
      expect(tcsPredicate.value).toEqual(['A', 'B'])
    })

    it('should output TCS predicate for BETWEEN', () => {
      const query: DocumentQuery = { age: { $gte: 18, $lte: 65 } }
      const result = compiler.compile(query)

      const tcsPredicates = result.toTCSPredicates()
      // May output BETWEEN or two separate predicates
      expect(tcsPredicates.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // TemporalStore Range Output
  // ==========================================================================

  describe('TemporalStore range output', () => {
    it('should output time range for timestamp field with $gte/$lte', () => {
      const query: DocumentQuery = {
        updatedAt: { $gte: 1704067200000, $lte: 1706745600000 },
      }
      const indexedFields: IndexedFieldConfig[] = [{ field: 'updatedAt', type: 'timestamp', temporal: true }]

      const result = compiler.compile(query, { indexedFields })
      const timeRange = result.toTemporalRange()

      expect(timeRange).toEqual({
        start: 1704067200000,
        end: 1706745600000,
      })
    })

    it('should output open-ended range for $gte only', () => {
      const query: DocumentQuery = { createdAt: { $gte: 1704067200000 } }
      const indexedFields: IndexedFieldConfig[] = [{ field: 'createdAt', type: 'timestamp', temporal: true }]

      const result = compiler.compile(query, { indexedFields })
      const timeRange = result.toTemporalRange()

      expect(timeRange).toEqual({ start: 1704067200000 })
    })

    it('should output open-ended range for $lte only', () => {
      const query: DocumentQuery = { createdAt: { $lte: 1706745600000 } }
      const indexedFields: IndexedFieldConfig[] = [{ field: 'createdAt', type: 'timestamp', temporal: true }]

      const result = compiler.compile(query, { indexedFields })
      const timeRange = result.toTemporalRange()

      expect(timeRange).toEqual({ end: 1706745600000 })
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should throw on unknown MongoDB operator', () => {
      const query: DocumentQuery = { field: { $unknownOp: 'value' } }

      expect(() => compiler.compile(query)).toThrow(/unknown operator/i)
    })

    it('should throw on invalid $in value (non-array)', () => {
      const query: DocumentQuery = { field: { $in: 'not-an-array' } }

      expect(() => compiler.compile(query)).toThrow(/array/i)
    })

    it('should throw on invalid DynamoDB expression syntax', () => {
      const query: DynamoDBQuery = {
        KeyConditionExpression: 'invalid syntax !!!',
        ExpressionAttributeValues: {},
      }

      expect(() => compiler.compileDynamoDB(query)).toThrow(/parse/i)
    })

    it('should throw on missing ExpressionAttributeValues', () => {
      const query: DynamoDBQuery = {
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {}, // Missing :pk
      }

      expect(() => compiler.compileDynamoDB(query)).toThrow(/missing.*:pk/i)
    })

    it('should throw on unresolved ExpressionAttributeName', () => {
      const query: DynamoDBQuery = {
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeValues: { ':pk': 'value' },
        ExpressionAttributeNames: {}, // Missing #pk
      }

      expect(() => compiler.compileDynamoDB(query)).toThrow(/missing.*#pk/i)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty query (match all)', () => {
      const query: DocumentQuery = {}
      const result = compiler.compile(query)

      expect(result.matchAll).toBe(true)
    })

    it('should handle null value in equality', () => {
      const query: DocumentQuery = { deletedAt: null }
      const result = compiler.compile(query)

      expect((result.ast as PredicateNode).op).toBe('IS NULL')
    })

    it('should handle Date objects in query', () => {
      const date = new Date('2024-01-01T00:00:00Z')
      const query: DocumentQuery = { createdAt: { $gte: date } }
      const result = compiler.compile(query)

      // Should convert Date to timestamp
      expect((result.ast as PredicateNode).value).toBe(date.getTime())
    })

    it('should handle RegExp objects', () => {
      const query: DocumentQuery = { name: /^John/i }
      const result = compiler.compile(query)

      expect((result.ast as PredicateNode).op).toBe('LIKE')
      expect(result.regexOptions?.caseInsensitive).toBe(true)
    })

    it('should handle deeply nested $and/$or', () => {
      const query: DocumentQuery = {
        $and: [
          { $or: [{ a: 1 }, { b: 2 }] },
          { $or: [{ c: 3 }, { d: 4 }] },
        ],
      }
      const result = compiler.compile(query)

      expect(result.ast.type).toBe('logical')
      expect((result.ast as LogicalNode).op).toBe('AND')
    })

    it('should handle special characters in field names', () => {
      const query: DocumentQuery = { 'field-with-dashes': 'value', 'field.with.dots': 'value2' }
      const result = compiler.compile(query)

      expect(result.ast.type).toBe('logical')
    })
  })

  // ==========================================================================
  // Performance
  // ==========================================================================

  describe('performance', () => {
    it('should compile 1000 simple queries under 100ms', () => {
      const queries: DocumentQuery[] = []
      for (let i = 0; i < 1000; i++) {
        queries.push({ [`field${i % 100}`]: i })
      }

      const start = performance.now()
      for (const query of queries) {
        compiler.compile(query)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100)
    })

    it('should compile complex nested query under 10ms', () => {
      const query: DocumentQuery = {
        $and: [
          { $or: Array.from({ length: 10 }, (_, i) => ({ [`field${i}`]: i })) },
          { $or: Array.from({ length: 10 }, (_, i) => ({ [`other${i}`]: i })) },
        ],
      }

      const start = performance.now()
      compiler.compile(query)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(10)
    })
  })
})
