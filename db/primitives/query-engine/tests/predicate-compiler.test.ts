/**
 * RED Phase: Predicate Compiler Tests
 *
 * Tests for the predicate compiler that converts unified AST
 * to TypedColumnStore predicates.
 *
 * @see dotdo-1ev1i
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import implementation and types
import type { PredicateNode, LogicalNode, QueryNode } from '../ast'
import { PredicateCompiler, type CompiledPredicate, type CompilationResult, type TypedColumnStore } from '../compiler/predicate-compiler'
import type { Predicate as TCSPredicate } from '../../typed-column-store'

describe('PredicateCompiler', () => {
  let compiler: PredicateCompiler

  beforeEach(() => {
    // GREEN phase: instantiate the actual compiler
    compiler = new PredicateCompiler()
  })

  describe('simple predicates', () => {
    it('should compile equality: AST(a = 5) -> TCS({column: "a", op: "=", value: 5})', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: '=',
        value: 5,
      }

      const result = compiler.compile(ast)

      expect(result.predicates).toHaveLength(1)
      expect(result.predicates[0].tcsPredicate).toEqual({
        column: 'a',
        op: '=',
        value: 5,
      })
    })

    it('should compile comparison: AST(a > 10) -> TCS predicate', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: '>',
        value: 10,
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].tcsPredicate.op).toBe('>')
      expect(result.predicates[0].tcsPredicate.value).toBe(10)
    })

    it('should compile all comparison operators correctly', () => {
      const ops: Array<{ ast: string; tcs: string }> = [
        { ast: '=', tcs: '=' },
        { ast: '!=', tcs: '!=' },
        { ast: '>', tcs: '>' },
        { ast: '>=', tcs: '>=' },
        { ast: '<', tcs: '<' },
        { ast: '<=', tcs: '<=' },
      ]

      for (const { ast: astOp, tcs: tcsOp } of ops) {
        const astNode: PredicateNode = {
          type: 'predicate',
          column: 'x',
          op: astOp as PredicateNode['op'],
          value: 42,
        }

        const result = compiler.compile(astNode)
        expect(result.predicates[0].tcsPredicate.op).toBe(tcsOp)
      }
    })

    it('should compile IN: AST(a IN [1,2,3]) -> TCS({op: "in", value: [1,2,3]})', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: 'IN',
        value: [1, 2, 3],
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].tcsPredicate.op).toBe('in')
      expect(result.predicates[0].tcsPredicate.value).toEqual([1, 2, 3])
    })

    it('should compile NOT IN: AST(a NOT IN [1,2,3]) -> TCS predicate', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: 'NOT IN',
        value: [1, 2, 3],
      }

      const result = compiler.compile(ast)

      // NOT IN may be represented as negated IN or separate operator
      expect(result.predicates[0].tcsPredicate.value).toEqual([1, 2, 3])
    })

    it('should compile BETWEEN: AST(a BETWEEN 1 AND 10) -> TCS({op: "between", value: [1,10]})', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: 'BETWEEN',
        value: [1, 10],
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].tcsPredicate.op).toBe('between')
      expect(result.predicates[0].tcsPredicate.value).toEqual([1, 10])
    })

    it('should compile IS NULL: AST(a IS NULL) -> TCS filter for nulls', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: 'IS NULL',
        value: null,
      }

      const result = compiler.compile(ast)

      // IS NULL may be represented specially in TCS
      expect(result.predicates[0].tcsPredicate.column).toBe('a')
    })

    it('should compile IS NOT NULL: AST(a IS NOT NULL) -> TCS filter', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'a',
        op: 'IS NOT NULL',
        value: null,
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].tcsPredicate.column).toBe('a')
    })

    it('should compile LIKE: AST(a LIKE "%pattern%") -> TCS predicate', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'name',
        op: 'LIKE',
        value: '%Alice%',
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].tcsPredicate.column).toBe('name')
      expect(result.predicates[0].tcsPredicate.value).toBe('%Alice%')
    })

    it('should compile CONTAINS for full-text search', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'description',
        op: 'CONTAINS',
        value: 'urgent meeting',
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].useFTSIndex).toBe(true)
    })

    it('should compile NEAR for vector similarity', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'embedding',
        op: 'NEAR',
        value: embedding,
        metric: 'cosine',
        k: 10,
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].useVectorIndex).toBe(true)
      expect(result.predicates[0].vectorConfig).toEqual({
        metric: 'cosine',
        k: 10,
      })
    })
  })

  describe('logical combinations', () => {
    it('should compile AND: multiple predicates joined', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'a', op: '>', value: 5 },
          { type: 'predicate', column: 'b', op: '<', value: 10 },
        ],
      }

      const result = compiler.compile(ast)

      expect(result.predicates).toHaveLength(2)
      expect(result.logicalOp).toBe('AND')
    })

    it('should compile OR: produces union of result sets', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'OR',
        children: [
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
          { type: 'predicate', column: 'status', op: '=', value: 'pending' },
        ],
      }

      const result = compiler.compile(ast)

      expect(result.logicalOp).toBe('OR')
      // OR requires separate scans, should flag this
      expect(result.requiresUnion).toBe(true)
    })

    it('should compile NOT: negates the predicate operator', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'NOT',
        children: [{ type: 'predicate', column: 'deleted', op: '=', value: true }],
      }

      const result = compiler.compile(ast)

      // NOT(a = true) should become (a != true) or (a = false)
      expect(result.predicates[0].tcsPredicate.op).toBe('!=')
    })

    it('should handle nested logic: (a > 5 AND b < 10) OR c = 3', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'OR',
        children: [
          {
            type: 'logical',
            op: 'AND',
            children: [
              { type: 'predicate', column: 'a', op: '>', value: 5 },
              { type: 'predicate', column: 'b', op: '<', value: 10 },
            ],
          },
          { type: 'predicate', column: 'c', op: '=', value: 3 },
        ],
      }

      const result = compiler.compile(ast)

      // Should produce two branches for the OR
      expect(result.branches).toHaveLength(2)
    })

    it('should flatten nested ANDs', () => {
      // ((a > 1 AND b > 2) AND (c > 3 AND d > 4)) should become [a>1, b>2, c>3, d>4]
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          {
            type: 'logical',
            op: 'AND',
            children: [
              { type: 'predicate', column: 'a', op: '>', value: 1 },
              { type: 'predicate', column: 'b', op: '>', value: 2 },
            ],
          },
          {
            type: 'logical',
            op: 'AND',
            children: [
              { type: 'predicate', column: 'c', op: '>', value: 3 },
              { type: 'predicate', column: 'd', op: '>', value: 4 },
            ],
          },
        ],
      }

      const result = compiler.compile(ast)

      expect(result.predicates).toHaveLength(4)
    })

    it('should handle double negation: NOT(NOT(a = 5)) -> a = 5', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'NOT',
        children: [
          {
            type: 'logical',
            op: 'NOT',
            children: [{ type: 'predicate', column: 'a', op: '=', value: 5 }],
          },
        ],
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].tcsPredicate.op).toBe('=')
      expect(result.predicates[0].tcsPredicate.value).toBe(5)
    })

    it('should apply De Morgan laws for NOT over AND/OR', () => {
      // NOT(a > 5 AND b < 10) = (a <= 5 OR b >= 10)
      const ast: LogicalNode = {
        type: 'logical',
        op: 'NOT',
        children: [
          {
            type: 'logical',
            op: 'AND',
            children: [
              { type: 'predicate', column: 'a', op: '>', value: 5 },
              { type: 'predicate', column: 'b', op: '<', value: 10 },
            ],
          },
        ],
      }

      const result = compiler.compile(ast)

      expect(result.logicalOp).toBe('OR')
      expect(result.predicates[0].tcsPredicate.op).toBe('<=')
      expect(result.predicates[1].tcsPredicate.op).toBe('>=')
    })
  })

  describe('type coercion', () => {
    it('should coerce string to number when column is numeric', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: '21', // String that should become number
      }

      const result = compiler.compile(ast, { columnTypes: { age: 'int64' } })

      expect(result.predicates[0].tcsPredicate.value).toBe(21)
      expect(typeof result.predicates[0].tcsPredicate.value).toBe('number')
    })

    it('should coerce ISO date string to timestamp', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'createdAt',
        op: '>=',
        value: '2024-01-01T00:00:00Z',
      }

      const result = compiler.compile(ast, { columnTypes: { createdAt: 'timestamp' } })

      expect(typeof result.predicates[0].tcsPredicate.value).toBe('number')
    })

    it('should handle relative date strings', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'createdAt',
        op: '>=',
        value: 'now-7d', // 7 days ago
      }

      const result = compiler.compile(ast, { columnTypes: { createdAt: 'timestamp' } })

      expect(typeof result.predicates[0].tcsPredicate.value).toBe('number')
    })

    it('should handle ObjectId string comparisons', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: '_id',
        op: '=',
        value: '507f1f77bcf86cd799439011',
      }

      const result = compiler.compile(ast, { columnTypes: { _id: 'objectId' } })

      // Should preserve ObjectId string format
      expect(result.predicates[0].tcsPredicate.value).toBe('507f1f77bcf86cd799439011')
    })

    it('should coerce boolean strings', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'active',
        op: '=',
        value: 'true',
      }

      const result = compiler.compile(ast, { columnTypes: { active: 'boolean' } })

      expect(result.predicates[0].tcsPredicate.value).toBe(true)
    })

    it('should report coercion errors for incompatible types', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 'not-a-number',
      }

      expect(() => compiler.compile(ast, { columnTypes: { age: 'int64' } })).toThrow(/coercion/i)
    })
  })

  describe('optimization hints', () => {
    it('should detect bloom filter eligible predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: '=',
        value: 'alice@example.com',
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].useBloomFilter).toBe(true)
    })

    it('should not use bloom filter for range predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].useBloomFilter).toBe(false)
    })

    it('should detect min/max prunable predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'timestamp',
        op: '>=',
        value: 1704067200000, // 2024-01-01
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].useMinMax).toBe(true)
    })

    it('should detect predicates suitable for partition pruning', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'date',
        op: 'BETWEEN',
        value: ['2024-01-01', '2024-01-31'],
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].partitionPrunable).toBe(true)
    })

    it('should annotate selectivity estimates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'status',
        op: '=',
        value: 'active',
      }

      const result = compiler.compile(ast, {
        statistics: {
          status: { distinctCount: 5, nullCount: 0, rowCount: 1000 },
        },
      })

      // Selectivity estimate for equality on 5 distinct values is ~0.2
      expect(result.predicates[0].estimatedSelectivity).toBeCloseTo(0.2, 1)
    })

    it('should estimate selectivity for range predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 50,
      }

      const result = compiler.compile(ast, {
        statistics: {
          age: { min: 0, max: 100, distinctCount: 100, rowCount: 1000 },
        },
      })

      // Range from 50 to 100 out of 0-100 is ~0.5
      expect(result.predicates[0].estimatedSelectivity).toBeCloseTo(0.5, 1)
    })

    it('should estimate selectivity for IN predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'category',
        op: 'IN',
        value: ['A', 'B', 'C'],
      }

      const result = compiler.compile(ast, {
        statistics: {
          category: { distinctCount: 10, rowCount: 1000 },
        },
      })

      // 3 out of 10 distinct values is ~0.3
      expect(result.predicates[0].estimatedSelectivity).toBeCloseTo(0.3, 1)
    })

    it('should flag pushdown-safe predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'price',
        op: '>',
        value: 100,
      }

      const result = compiler.compile(ast)

      expect(result.predicates[0].pushdownSafe).toBe(true)
    })
  })

  describe('integration with TypedColumnStore', () => {
    let columnStore: TypedColumnStore

    beforeEach(() => {
      // Mock TypedColumnStore - actual integration will be implemented in GREEN phase
      columnStore = {
        filter: vi.fn(),
        project: vi.fn(),
        bloomFilter: vi.fn(),
        minMax: vi.fn(),
      } as unknown as TypedColumnStore
    })

    it('should execute compiled predicate against column store', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      const result = compiler.compile(ast)
      const batch = compiler.execute(result, columnStore)

      expect(columnStore.filter).toHaveBeenCalledWith(result.predicates[0].tcsPredicate)
    })

    it('should utilize bloom filter for equality checks', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: '=',
        value: 'alice@example.com',
      }

      const result = compiler.compile(ast)
      compiler.execute(result, columnStore)

      // Should check bloom filter before full scan
      expect(columnStore.bloomFilter).toHaveBeenCalledWith('email')
    })

    it('should utilize min/max stats for range pruning', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'timestamp',
        op: '>',
        value: 1704067200000,
      }

      const result = compiler.compile(ast)
      compiler.execute(result, columnStore)

      // Should check min/max before scanning
      expect(columnStore.minMax).toHaveBeenCalledWith('timestamp')
    })

    it('should short-circuit when bloom filter returns false', () => {
      const mockBloom = { mightContain: vi.fn().mockReturnValue(false) }
      columnStore.bloomFilter = vi.fn().mockReturnValue(mockBloom)

      const ast: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: '=',
        value: 'nonexistent@example.com',
      }

      const result = compiler.compile(ast)
      const batch = compiler.execute(result, columnStore)

      expect(batch.rowCount).toBe(0)
      expect(columnStore.filter).not.toHaveBeenCalled()
    })

    it('should prune partitions using min/max', () => {
      columnStore.minMax = vi.fn().mockReturnValue({ min: 0, max: 50 })

      const ast: PredicateNode = {
        type: 'predicate',
        column: 'value',
        op: '>',
        value: 100, // Greater than max, should prune
      }

      const result = compiler.compile(ast)
      const batch = compiler.execute(result, columnStore)

      expect(batch.rowCount).toBe(0)
      expect(columnStore.filter).not.toHaveBeenCalled()
    })

    it('should chain multiple predicates for AND logic', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>=', value: 18 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      const result = compiler.compile(ast)
      compiler.execute(result, columnStore)

      // Should filter by each predicate in sequence
      expect(columnStore.filter).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('should throw on unknown predicate operator', () => {
      const ast = {
        type: 'predicate',
        column: 'x',
        op: 'UNKNOWN_OP',
        value: 1,
      } as unknown as PredicateNode

      expect(() => compiler.compile(ast)).toThrow(/unknown operator/i)
    })

    it('should throw on invalid IN value (non-array)', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'x',
        op: 'IN',
        value: 'not-an-array',
      }

      expect(() => compiler.compile(ast)).toThrow(/array/i)
    })

    it('should throw on invalid BETWEEN value (non-pair)', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'x',
        op: 'BETWEEN',
        value: [1], // Should be [low, high]
      }

      expect(() => compiler.compile(ast)).toThrow(/between/i)
    })

    it('should throw on circular reference in nested predicates', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [],
      }
      // Create circular reference
      ast.children = [ast as unknown as PredicateNode]

      expect(() => compiler.compile(ast)).toThrow(/circular/i)
    })
  })

  describe('performance', () => {
    it('should compile 10000 simple predicates per second', () => {
      const predicates: PredicateNode[] = []
      for (let i = 0; i < 10000; i++) {
        predicates.push({
          type: 'predicate',
          column: `col${i % 100}`,
          op: '=',
          value: i,
        })
      }

      const start = performance.now()
      for (const pred of predicates) {
        compiler.compile(pred)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000) // Under 1 second
    })

    it('should compile nested logical expressions efficiently', () => {
      // Build a deeply nested AND tree
      let ast: QueryNode = { type: 'predicate', column: 'x', op: '=', value: 0 }
      for (let i = 1; i < 100; i++) {
        ast = {
          type: 'logical',
          op: 'AND',
          children: [ast as PredicateNode, { type: 'predicate', column: 'x', op: '=', value: i }],
        }
      }

      const start = performance.now()
      const result = compiler.compile(ast)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100) // Under 100ms
      expect(result.predicates.length).toBeGreaterThanOrEqual(100)
    })
  })
})
