/**
 * RED Phase: Unified AST Representation Tests
 *
 * These tests define the expected unified AST that can represent
 * MongoDB, SQL, Elasticsearch DSL, and Cypher query syntaxes.
 *
 * @see dotdo-x5lig
 */

import { describe, it, expect } from 'vitest'

// Import types that will be implemented in GREEN phase
import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  ProjectionNode,
  AggregationNode,
  GroupByNode,
  SortNode,
  JoinNode,
  TraversalNode,
  ExpressionNode,
  ComparisonOp,
  AggregateFunction,
  DistanceMetric,
} from '../ast'

describe('UnifiedAST', () => {
  describe('PredicateNode', () => {
    it('should represent equality predicate: field = value', () => {
      const node: PredicateNode = {
        type: 'predicate',
        column: 'name',
        op: '=',
        value: 'Alice',
      }

      expect(node.type).toBe('predicate')
      expect(node.column).toBe('name')
      expect(node.op).toBe('=')
      expect(node.value).toBe('Alice')
    })

    it('should represent comparison predicates: >, <, >=, <=, !=', () => {
      const ops: ComparisonOp[] = ['>', '<', '>=', '<=', '!=']

      for (const op of ops) {
        const node: PredicateNode = {
          type: 'predicate',
          column: 'age',
          op,
          value: 21,
        }
        expect(node.op).toBe(op)
      }
    })

    it('should represent set predicates: IN, NOT IN', () => {
      const inNode: PredicateNode = {
        type: 'predicate',
        column: 'status',
        op: 'IN',
        value: ['active', 'pending', 'review'],
      }

      expect(inNode.op).toBe('IN')
      expect(inNode.value).toEqual(['active', 'pending', 'review'])

      const notInNode: PredicateNode = {
        type: 'predicate',
        column: 'status',
        op: 'NOT IN',
        value: ['deleted', 'archived'],
      }

      expect(notInNode.op).toBe('NOT IN')
    })

    it('should represent null predicates: IS NULL, IS NOT NULL', () => {
      const isNullNode: PredicateNode = {
        type: 'predicate',
        column: 'deletedAt',
        op: 'IS NULL',
        value: null,
      }

      expect(isNullNode.op).toBe('IS NULL')

      const isNotNullNode: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: 'IS NOT NULL',
        value: null,
      }

      expect(isNotNullNode.op).toBe('IS NOT NULL')
    })

    it('should represent range predicates: BETWEEN', () => {
      const node: PredicateNode = {
        type: 'predicate',
        column: 'price',
        op: 'BETWEEN',
        value: [10, 100],
      }

      expect(node.op).toBe('BETWEEN')
      expect(node.value).toEqual([10, 100])
    })

    it('should represent text predicates: LIKE, CONTAINS, STARTS_WITH', () => {
      const likeNode: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: 'LIKE',
        value: '%@example.com',
      }
      expect(likeNode.op).toBe('LIKE')

      const containsNode: PredicateNode = {
        type: 'predicate',
        column: 'description',
        op: 'CONTAINS',
        value: 'urgent',
      }
      expect(containsNode.op).toBe('CONTAINS')

      const startsWithNode: PredicateNode = {
        type: 'predicate',
        column: 'url',
        op: 'STARTS_WITH',
        value: 'https://',
      }
      expect(startsWithNode.op).toBe('STARTS_WITH')
    })

    it('should represent vector predicates: NEAR with distance metric', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      const node: PredicateNode = {
        type: 'predicate',
        column: 'embedding',
        op: 'NEAR',
        value: embedding,
        metric: 'cosine',
        k: 10,
      }

      expect(node.op).toBe('NEAR')
      expect(node.value).toEqual(embedding)
      expect(node.metric).toBe('cosine')
      expect(node.k).toBe(10)
    })

    it('should support different distance metrics for vector predicates', () => {
      const metrics: DistanceMetric[] = ['cosine', 'euclidean', 'dotProduct']

      for (const metric of metrics) {
        const node: PredicateNode = {
          type: 'predicate',
          column: 'vector',
          op: 'NEAR',
          value: [1, 2, 3],
          metric,
          k: 5,
        }
        expect(node.metric).toBe(metric)
      }
    })

    it('should support nested field paths with dot notation', () => {
      const node: PredicateNode = {
        type: 'predicate',
        column: 'address.city.zipCode',
        op: '=',
        value: '94102',
      }

      expect(node.column).toBe('address.city.zipCode')
    })

    it('should support array indexing in field paths', () => {
      const node: PredicateNode = {
        type: 'predicate',
        column: 'items.0.price',
        op: '>',
        value: 100,
      }

      expect(node.column).toBe('items.0.price')
    })
  })

  describe('LogicalNode', () => {
    it('should combine predicates with AND', () => {
      const node: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>=', value: 18 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      expect(node.op).toBe('AND')
      expect(node.children).toHaveLength(2)
    })

    it('should combine predicates with OR', () => {
      const node: LogicalNode = {
        type: 'logical',
        op: 'OR',
        children: [
          { type: 'predicate', column: 'role', op: '=', value: 'admin' },
          { type: 'predicate', column: 'role', op: '=', value: 'moderator' },
        ],
      }

      expect(node.op).toBe('OR')
      expect(node.children).toHaveLength(2)
    })

    it('should negate predicates with NOT', () => {
      const node: LogicalNode = {
        type: 'logical',
        op: 'NOT',
        children: [{ type: 'predicate', column: 'deleted', op: '=', value: true }],
      }

      expect(node.op).toBe('NOT')
      expect(node.children).toHaveLength(1)
    })

    it('should handle nested logical expressions', () => {
      // (a > 5 AND b < 10) OR (c = 3)
      const node: LogicalNode = {
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

      expect(node.op).toBe('OR')
      expect(node.children).toHaveLength(2)
      expect((node.children[0] as LogicalNode).op).toBe('AND')
    })

    it('should handle deeply nested logical expressions', () => {
      // NOT ((a = 1 OR b = 2) AND (c = 3 OR d = 4))
      const node: LogicalNode = {
        type: 'logical',
        op: 'NOT',
        children: [
          {
            type: 'logical',
            op: 'AND',
            children: [
              {
                type: 'logical',
                op: 'OR',
                children: [
                  { type: 'predicate', column: 'a', op: '=', value: 1 },
                  { type: 'predicate', column: 'b', op: '=', value: 2 },
                ],
              },
              {
                type: 'logical',
                op: 'OR',
                children: [
                  { type: 'predicate', column: 'c', op: '=', value: 3 },
                  { type: 'predicate', column: 'd', op: '=', value: 4 },
                ],
              },
            ],
          },
        ],
      }

      expect(node.op).toBe('NOT')
      const andNode = node.children[0] as LogicalNode
      expect(andNode.op).toBe('AND')
      expect(andNode.children).toHaveLength(2)
    })
  })

  describe('ProjectionNode', () => {
    it('should select specific columns', () => {
      const node: ProjectionNode = {
        type: 'projection',
        columns: [
          { source: 'id', include: true },
          { source: 'name', include: true },
          { source: 'email', include: true },
        ],
      }

      expect(node.columns).toHaveLength(3)
      expect(node.columns.every((c) => c.include)).toBe(true)
    })

    it('should exclude columns', () => {
      const node: ProjectionNode = {
        type: 'projection',
        columns: [
          { source: 'password', include: false },
          { source: 'internalId', include: false },
        ],
      }

      expect(node.columns.every((c) => !c.include)).toBe(true)
    })

    it('should rename columns with aliases', () => {
      const node: ProjectionNode = {
        type: 'projection',
        columns: [
          { source: 'firstName', alias: 'first_name', include: true },
          { source: 'lastName', alias: 'last_name', include: true },
        ],
      }

      expect(node.columns[0].alias).toBe('first_name')
      expect(node.columns[1].alias).toBe('last_name')
    })

    it('should compute expressions', () => {
      const expr: ExpressionNode = {
        type: 'expression',
        operator: 'add',
        operands: ['price', 'tax'],
      }

      const node: ProjectionNode = {
        type: 'projection',
        columns: [
          { source: 'id', include: true },
          { source: expr, alias: 'total', include: true },
        ],
      }

      expect(node.columns[1].source).toEqual(expr)
      expect(node.columns[1].alias).toBe('total')
    })

    it('should support complex expression trees', () => {
      // (price * quantity) + (tax * quantity)
      const expr: ExpressionNode = {
        type: 'expression',
        operator: 'add',
        operands: [
          { type: 'expression', operator: 'multiply', operands: ['price', 'quantity'] },
          { type: 'expression', operator: 'multiply', operands: ['tax', 'quantity'] },
        ],
      }

      const node: ProjectionNode = {
        type: 'projection',
        columns: [{ source: expr, alias: 'lineTotal', include: true }],
      }

      expect(node.columns[0].source).toEqual(expr)
    })
  })

  describe('AggregationNode', () => {
    it('should represent COUNT, SUM, AVG, MIN, MAX', () => {
      const functions: AggregateFunction[] = ['count', 'sum', 'avg', 'min', 'max']

      for (const fn of functions) {
        const node: AggregationNode = {
          type: 'aggregation',
          function: fn,
          column: 'amount',
        }
        expect(node.function).toBe(fn)
      }
    })

    it('should represent COUNT(*) without column', () => {
      const node: AggregationNode = {
        type: 'aggregation',
        function: 'count',
        column: undefined,
      }

      expect(node.column).toBeUndefined()
    })

    it('should represent COUNT DISTINCT', () => {
      const node: AggregationNode = {
        type: 'aggregation',
        function: 'count',
        column: 'userId',
        distinct: true,
      }

      expect(node.distinct).toBe(true)
    })

    it('should represent FIRST, LAST for ordered aggregations', () => {
      const firstNode: AggregationNode = {
        type: 'aggregation',
        function: 'first',
        column: 'timestamp',
      }

      const lastNode: AggregationNode = {
        type: 'aggregation',
        function: 'last',
        column: 'timestamp',
      }

      expect(firstNode.function).toBe('first')
      expect(lastNode.function).toBe('last')
    })

    it('should represent PUSH and ADD_TO_SET for collection aggregations', () => {
      const pushNode: AggregationNode = {
        type: 'aggregation',
        function: 'push',
        column: 'tag',
      }

      const addToSetNode: AggregationNode = {
        type: 'aggregation',
        function: 'addToSet',
        column: 'category',
      }

      expect(pushNode.function).toBe('push')
      expect(addToSetNode.function).toBe('addToSet')
    })
  })

  describe('GroupByNode', () => {
    it('should represent GROUP BY columns', () => {
      const node: GroupByNode = {
        type: 'groupBy',
        columns: ['category', 'region'],
        aggregations: [
          { alias: 'total', aggregation: { type: 'aggregation', function: 'sum', column: 'amount' } },
        ],
      }

      expect(node.columns).toEqual(['category', 'region'])
    })

    it('should include aggregations with aliases', () => {
      const node: GroupByNode = {
        type: 'groupBy',
        columns: ['department'],
        aggregations: [
          { alias: 'totalSalary', aggregation: { type: 'aggregation', function: 'sum', column: 'salary' } },
          { alias: 'avgSalary', aggregation: { type: 'aggregation', function: 'avg', column: 'salary' } },
          { alias: 'headcount', aggregation: { type: 'aggregation', function: 'count' } },
        ],
      }

      expect(node.aggregations).toHaveLength(3)
      expect(node.aggregations[0].alias).toBe('totalSalary')
    })

    it('should represent HAVING predicates', () => {
      const havingPredicate: PredicateNode = {
        type: 'predicate',
        column: 'count',
        op: '>',
        value: 10,
      }

      const node: GroupByNode = {
        type: 'groupBy',
        columns: ['category'],
        aggregations: [{ alias: 'count', aggregation: { type: 'aggregation', function: 'count' } }],
        having: havingPredicate,
      }

      expect(node.having).toBeDefined()
      expect((node.having as PredicateNode).op).toBe('>')
    })

    it('should support null grouping for global aggregation', () => {
      const node: GroupByNode = {
        type: 'groupBy',
        columns: [],
        aggregations: [
          { alias: 'total', aggregation: { type: 'aggregation', function: 'count' } },
        ],
      }

      expect(node.columns).toEqual([])
    })
  })

  describe('SortNode', () => {
    it('should specify column and direction (ASC/DESC)', () => {
      const node: SortNode = {
        type: 'sort',
        columns: [{ column: 'createdAt', direction: 'DESC' }],
      }

      expect(node.columns[0].column).toBe('createdAt')
      expect(node.columns[0].direction).toBe('DESC')
    })

    it('should handle multi-column sort', () => {
      const node: SortNode = {
        type: 'sort',
        columns: [
          { column: 'priority', direction: 'ASC' },
          { column: 'createdAt', direction: 'DESC' },
          { column: 'id', direction: 'ASC' },
        ],
      }

      expect(node.columns).toHaveLength(3)
    })

    it('should support nulls first/last options', () => {
      const node: SortNode = {
        type: 'sort',
        columns: [{ column: 'completedAt', direction: 'DESC', nulls: 'last' }],
      }

      expect(node.columns[0].nulls).toBe('last')
    })
  })

  describe('JoinNode', () => {
    it('should represent join type: INNER, LEFT, RIGHT, CROSS', () => {
      const joinTypes = ['INNER', 'LEFT', 'RIGHT', 'CROSS'] as const

      for (const joinType of joinTypes) {
        const node: JoinNode = {
          type: 'join',
          joinType,
          left: 'orders',
          right: 'customers',
          on: {
            type: 'predicate',
            column: 'orders.customerId',
            op: '=',
            value: { $ref: 'customers.id' },
          },
        }
        expect(node.joinType).toBe(joinType)
      }
    })

    it('should specify join condition', () => {
      const node: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'products',
        right: 'categories',
        on: {
          type: 'predicate',
          column: 'products.categoryId',
          op: '=',
          value: { $ref: 'categories.id' },
        },
      }

      expect(node.on.column).toBe('products.categoryId')
    })

    it('should support complex join conditions', () => {
      const node: JoinNode = {
        type: 'join',
        joinType: 'LEFT',
        left: 'orders',
        right: 'order_items',
        on: {
          type: 'logical',
          op: 'AND',
          children: [
            {
              type: 'predicate',
              column: 'orders.id',
              op: '=',
              value: { $ref: 'order_items.orderId' },
            },
            {
              type: 'predicate',
              column: 'order_items.status',
              op: '=',
              value: 'active',
            },
          ],
        } as unknown as PredicateNode,
      }

      expect(node.on.type).toBe('logical')
    })
  })

  describe('TraversalNode', () => {
    it('should represent graph traversal direction: OUT, IN, BOTH', () => {
      const directions = ['OUT', 'IN', 'BOTH'] as const

      for (const direction of directions) {
        const node: TraversalNode = {
          type: 'traversal',
          direction,
          minHops: 1,
          maxHops: 1,
        }
        expect(node.direction).toBe(direction)
      }
    })

    it('should specify edge types filter', () => {
      const node: TraversalNode = {
        type: 'traversal',
        direction: 'OUT',
        edgeTypes: ['KNOWS', 'FOLLOWS'],
        minHops: 1,
        maxHops: 1,
      }

      expect(node.edgeTypes).toEqual(['KNOWS', 'FOLLOWS'])
    })

    it('should specify min/max hops', () => {
      const node: TraversalNode = {
        type: 'traversal',
        direction: 'BOTH',
        minHops: 1,
        maxHops: 3,
      }

      expect(node.minHops).toBe(1)
      expect(node.maxHops).toBe(3)
    })

    it('should support variable length paths', () => {
      // Equivalent to Cypher: -[:KNOWS*1..5]->
      const node: TraversalNode = {
        type: 'traversal',
        direction: 'OUT',
        edgeTypes: ['KNOWS'],
        minHops: 1,
        maxHops: 5,
      }

      expect(node.minHops).toBe(1)
      expect(node.maxHops).toBe(5)
    })

    it('should support unbounded traversals', () => {
      // Equivalent to Cypher: -[:KNOWS*]->
      const node: TraversalNode = {
        type: 'traversal',
        direction: 'OUT',
        edgeTypes: ['KNOWS'],
        minHops: 1,
        maxHops: Infinity,
      }

      expect(node.maxHops).toBe(Infinity)
    })

    it('should include optional filter predicates', () => {
      const node: TraversalNode = {
        type: 'traversal',
        direction: 'OUT',
        edgeTypes: ['WORKS_AT'],
        minHops: 1,
        maxHops: 1,
        filter: {
          type: 'predicate',
          column: 'node.department',
          op: '=',
          value: 'Engineering',
        },
      }

      expect(node.filter).toBeDefined()
    })
  })

  describe('Serialization', () => {
    it('should serialize AST to JSON', () => {
      const ast: QueryNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>=', value: 18 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      const json = JSON.stringify(ast)
      expect(() => JSON.parse(json)).not.toThrow()
    })

    it('should deserialize JSON to AST', () => {
      const json = `{
        "type": "predicate",
        "column": "name",
        "op": "=",
        "value": "Alice"
      }`

      const ast = JSON.parse(json) as PredicateNode
      expect(ast.type).toBe('predicate')
      expect(ast.column).toBe('name')
    })

    it('should round-trip complex AST through JSON', () => {
      const original: LogicalNode = {
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
          { type: 'predicate', column: 'c', op: 'IN', value: [1, 2, 3] },
        ],
      }

      const roundTripped = JSON.parse(JSON.stringify(original)) as LogicalNode
      expect(roundTripped).toEqual(original)
    })
  })

  describe('Visitor Pattern', () => {
    it('should support visitor pattern for AST traversal', () => {
      // This tests that the visitor interface is defined correctly
      interface ASTVisitor<T> {
        visitPredicate(node: PredicateNode): T
        visitLogical(node: LogicalNode): T
        visitProjection(node: ProjectionNode): T
        visitAggregation(node: AggregationNode): T
        visitGroupBy(node: GroupByNode): T
        visitSort(node: SortNode): T
        visitJoin(node: JoinNode): T
        visitTraversal(node: TraversalNode): T
      }

      // Verify the interface compiles - actual visitor will be implemented in GREEN phase
      const mockVisitor: ASTVisitor<string> = {
        visitPredicate: () => 'predicate',
        visitLogical: () => 'logical',
        visitProjection: () => 'projection',
        visitAggregation: () => 'aggregation',
        visitGroupBy: () => 'groupBy',
        visitSort: () => 'sort',
        visitJoin: () => 'join',
        visitTraversal: () => 'traversal',
      }

      expect(mockVisitor).toBeDefined()
    })
  })

  describe('Source Language Mapping', () => {
    it('should represent MongoDB query: {age: {$gt: 21}}', () => {
      // MongoDB: db.users.find({age: {$gt: 21}})
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      expect(ast.op).toBe('>')
    })

    it('should represent SQL query: WHERE age > 21', () => {
      // SQL: SELECT * FROM users WHERE age > 21
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      expect(ast.op).toBe('>')
    })

    it('should represent Elasticsearch query: {"range": {"age": {"gt": 21}}}', () => {
      // ES: {"query": {"range": {"age": {"gt": 21}}}}
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      expect(ast.op).toBe('>')
    })

    it('should represent Cypher query: WHERE n.age > 21', () => {
      // Cypher: MATCH (n:Person) WHERE n.age > 21 RETURN n
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'n.age',
        op: '>',
        value: 21,
      }

      expect(ast.op).toBe('>')
    })
  })
})
