/**
 * RED Phase: Source Capability Detection Tests
 *
 * Tests for detecting and managing what operations each data source supports.
 * This enables the query planner to know what can be pushed down to each source.
 *
 * @see dotdo-wwnz3
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  SourceCapabilities,
  CapabilityDetector,
  canPushFilter,
  canPushProjection,
  canPushAggregation,
  canPushJoin,
  canExecuteQuery,
  createCapabilities,
  DEFAULT_CAPABILITIES,
  SQLITE_CAPABILITIES,
  POSTGRES_CAPABILITIES,
  MONGODB_CAPABILITIES,
  ELASTICSEARCH_CAPABILITIES,
  REDIS_CAPABILITIES,
} from '../federation/capabilities'

import type { PredicateNode, LogicalNode, QueryNode, GroupByNode, JoinNode, ProjectionNode, AggregationNode } from '../ast'

describe('SourceCapabilities', () => {
  describe('interface validation', () => {
    it('should define filtering capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsFiltering: true,
      })

      expect(caps.supportsFiltering).toBe(true)
    })

    it('should define projection capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsProjection: true,
      })

      expect(caps.supportsProjection).toBe(true)
    })

    it('should define aggregation capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsAggregation: true,
      })

      expect(caps.supportsAggregation).toBe(true)
    })

    it('should define supported comparison operators', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportedOperators: ['=', '!=', '>', '<', '>=', '<=', 'IN', 'LIKE'],
      })

      expect(caps.supportedOperators).toContain('=')
      expect(caps.supportedOperators).toContain('LIKE')
    })

    it('should define supported aggregate functions', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportedAggregates: ['count', 'sum', 'avg', 'min', 'max'],
      })

      expect(caps.supportedAggregates).toContain('count')
      expect(caps.supportedAggregates).toContain('avg')
    })

    it('should define join capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsJoins: true,
        supportedJoinTypes: ['INNER', 'LEFT', 'RIGHT'],
      })

      expect(caps.supportsJoins).toBe(true)
      expect(caps.supportedJoinTypes).toContain('INNER')
    })

    it('should define subquery capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsSubqueries: true,
      })

      expect(caps.supportsSubqueries).toBe(true)
    })

    it('should define result size limit', () => {
      const caps: SourceCapabilities = createCapabilities({
        maxResultSize: 10000,
      })

      expect(caps.maxResultSize).toBe(10000)
    })

    it('should define streaming capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsStreaming: true,
      })

      expect(caps.supportsStreaming).toBe(true)
    })

    it('should define sorting capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsSorting: true,
      })

      expect(caps.supportsSorting).toBe(true)
    })

    it('should define pagination capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsPagination: true,
        supportsOffset: true,
        supportsCursor: true,
      })

      expect(caps.supportsPagination).toBe(true)
      expect(caps.supportsOffset).toBe(true)
      expect(caps.supportsCursor).toBe(true)
    })

    it('should define text search capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsFullTextSearch: true,
      })

      expect(caps.supportsFullTextSearch).toBe(true)
    })

    it('should define vector search capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsVectorSearch: true,
        supportedDistanceMetrics: ['cosine', 'euclidean', 'dotProduct'],
      })

      expect(caps.supportsVectorSearch).toBe(true)
      expect(caps.supportedDistanceMetrics).toContain('cosine')
    })

    it('should define transaction capability', () => {
      const caps: SourceCapabilities = createCapabilities({
        supportsTransactions: true,
        isolationLevels: ['read_committed', 'repeatable_read', 'serializable'],
      })

      expect(caps.supportsTransactions).toBe(true)
      expect(caps.isolationLevels).toContain('serializable')
    })
  })

  describe('default capabilities', () => {
    it('should provide minimal default capabilities', () => {
      expect(DEFAULT_CAPABILITIES.supportsFiltering).toBe(true)
      expect(DEFAULT_CAPABILITIES.supportedOperators).toContain('=')
    })

    it('should have filtering disabled by default for unknown sources', () => {
      const caps = createCapabilities({})
      // A fresh capabilities object with no explicit settings should be minimal
      expect(caps.supportsFiltering).toBe(false)
    })
  })

  describe('preset capabilities', () => {
    describe('SQLite', () => {
      it('should support basic SQL operations', () => {
        expect(SQLITE_CAPABILITIES.supportsFiltering).toBe(true)
        expect(SQLITE_CAPABILITIES.supportsProjection).toBe(true)
        expect(SQLITE_CAPABILITIES.supportsAggregation).toBe(true)
        expect(SQLITE_CAPABILITIES.supportsJoins).toBe(true)
      })

      it('should support standard SQL operators', () => {
        expect(SQLITE_CAPABILITIES.supportedOperators).toContain('=')
        expect(SQLITE_CAPABILITIES.supportedOperators).toContain('LIKE')
        expect(SQLITE_CAPABILITIES.supportedOperators).toContain('IN')
        expect(SQLITE_CAPABILITIES.supportedOperators).toContain('BETWEEN')
      })

      it('should support standard aggregate functions', () => {
        expect(SQLITE_CAPABILITIES.supportedAggregates).toContain('count')
        expect(SQLITE_CAPABILITIES.supportedAggregates).toContain('sum')
        expect(SQLITE_CAPABILITIES.supportedAggregates).toContain('avg')
      })

      it('should support subqueries', () => {
        expect(SQLITE_CAPABILITIES.supportsSubqueries).toBe(true)
      })

      it('should NOT support vector search by default', () => {
        expect(SQLITE_CAPABILITIES.supportsVectorSearch).toBe(false)
      })
    })

    describe('PostgreSQL', () => {
      it('should support all SQLite capabilities plus more', () => {
        expect(POSTGRES_CAPABILITIES.supportsFiltering).toBe(true)
        expect(POSTGRES_CAPABILITIES.supportsProjection).toBe(true)
        expect(POSTGRES_CAPABILITIES.supportsAggregation).toBe(true)
        expect(POSTGRES_CAPABILITIES.supportsJoins).toBe(true)
        expect(POSTGRES_CAPABILITIES.supportsSubqueries).toBe(true)
      })

      it('should support streaming/cursors', () => {
        expect(POSTGRES_CAPABILITIES.supportsStreaming).toBe(true)
        expect(POSTGRES_CAPABILITIES.supportsCursor).toBe(true)
      })

      it('should support all join types', () => {
        expect(POSTGRES_CAPABILITIES.supportedJoinTypes).toContain('INNER')
        expect(POSTGRES_CAPABILITIES.supportedJoinTypes).toContain('LEFT')
        expect(POSTGRES_CAPABILITIES.supportedJoinTypes).toContain('RIGHT')
        expect(POSTGRES_CAPABILITIES.supportedJoinTypes).toContain('CROSS')
      })

      it('should support transactions with multiple isolation levels', () => {
        expect(POSTGRES_CAPABILITIES.supportsTransactions).toBe(true)
        expect(POSTGRES_CAPABILITIES.isolationLevels).toContain('serializable')
      })
    })

    describe('MongoDB', () => {
      it('should support document operations', () => {
        expect(MONGODB_CAPABILITIES.supportsFiltering).toBe(true)
        expect(MONGODB_CAPABILITIES.supportsProjection).toBe(true)
        expect(MONGODB_CAPABILITIES.supportsAggregation).toBe(true)
      })

      it('should support MongoDB-specific operators', () => {
        expect(MONGODB_CAPABILITIES.supportedOperators).toContain('=')
        expect(MONGODB_CAPABILITIES.supportedOperators).toContain('IN')
      })

      it('should NOT support SQL-style joins', () => {
        expect(MONGODB_CAPABILITIES.supportsJoins).toBe(false)
      })

      it('should support full-text search', () => {
        expect(MONGODB_CAPABILITIES.supportsFullTextSearch).toBe(true)
      })

      it('should support cursor-based pagination', () => {
        expect(MONGODB_CAPABILITIES.supportsCursor).toBe(true)
      })
    })

    describe('Elasticsearch', () => {
      it('should support search operations', () => {
        expect(ELASTICSEARCH_CAPABILITIES.supportsFiltering).toBe(true)
        expect(ELASTICSEARCH_CAPABILITIES.supportsProjection).toBe(true)
        expect(ELASTICSEARCH_CAPABILITIES.supportsAggregation).toBe(true)
      })

      it('should support full-text search', () => {
        expect(ELASTICSEARCH_CAPABILITIES.supportsFullTextSearch).toBe(true)
      })

      it('should support vector search', () => {
        expect(ELASTICSEARCH_CAPABILITIES.supportsVectorSearch).toBe(true)
      })

      it('should NOT support joins', () => {
        expect(ELASTICSEARCH_CAPABILITIES.supportsJoins).toBe(false)
      })

      it('should NOT support subqueries', () => {
        expect(ELASTICSEARCH_CAPABILITIES.supportsSubqueries).toBe(false)
      })
    })

    describe('Redis', () => {
      it('should support basic key-value operations only', () => {
        expect(REDIS_CAPABILITIES.supportsFiltering).toBe(true)
        expect(REDIS_CAPABILITIES.supportsProjection).toBe(false)
        expect(REDIS_CAPABILITIES.supportsAggregation).toBe(false)
      })

      it('should only support equality operator', () => {
        expect(REDIS_CAPABILITIES.supportedOperators).toContain('=')
        expect(REDIS_CAPABILITIES.supportedOperators).not.toContain('LIKE')
        expect(REDIS_CAPABILITIES.supportedOperators).not.toContain('>')
      })

      it('should NOT support joins or subqueries', () => {
        expect(REDIS_CAPABILITIES.supportsJoins).toBe(false)
        expect(REDIS_CAPABILITIES.supportsSubqueries).toBe(false)
      })
    })
  })
})

describe('CapabilityDetector', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = new CapabilityDetector()
  })

  describe('source registration', () => {
    it('should register a source with capabilities', () => {
      detector.registerSource('my-sqlite', SQLITE_CAPABILITIES)

      const caps = detector.getCapabilities('my-sqlite')
      expect(caps).toBeDefined()
      expect(caps!.supportsFiltering).toBe(true)
    })

    it('should return undefined for unregistered sources', () => {
      const caps = detector.getCapabilities('unknown-source')
      expect(caps).toBeUndefined()
    })

    it('should allow updating source capabilities', () => {
      detector.registerSource('my-db', createCapabilities({ supportsFiltering: true }))
      detector.registerSource('my-db', createCapabilities({
        supportsFiltering: true,
        supportsAggregation: true,
      }))

      const caps = detector.getCapabilities('my-db')
      expect(caps!.supportsAggregation).toBe(true)
    })

    it('should list all registered sources', () => {
      detector.registerSource('source-a', SQLITE_CAPABILITIES)
      detector.registerSource('source-b', MONGODB_CAPABILITIES)

      const sources = detector.listSources()
      expect(sources).toContain('source-a')
      expect(sources).toContain('source-b')
    })
  })

  describe('auto-detection', () => {
    it('should detect SQLite capabilities from connection string', () => {
      const caps = detector.detectFromConnectionString('sqlite:///path/to/db.sqlite')

      expect(caps.supportsFiltering).toBe(true)
      expect(caps.supportsJoins).toBe(true)
    })

    it('should detect PostgreSQL capabilities from connection string', () => {
      const caps = detector.detectFromConnectionString('postgres://user:pass@localhost:5432/db')

      expect(caps.supportsFiltering).toBe(true)
      expect(caps.supportsStreaming).toBe(true)
    })

    it('should detect MongoDB capabilities from connection string', () => {
      const caps = detector.detectFromConnectionString('mongodb://localhost:27017/mydb')

      expect(caps.supportsFiltering).toBe(true)
      expect(caps.supportsJoins).toBe(false)
    })

    it('should detect Elasticsearch capabilities from connection string', () => {
      const caps = detector.detectFromConnectionString('elasticsearch://localhost:9200')

      expect(caps.supportsFullTextSearch).toBe(true)
      expect(caps.supportsVectorSearch).toBe(true)
    })

    it('should detect Redis capabilities from connection string', () => {
      const caps = detector.detectFromConnectionString('redis://localhost:6379')

      expect(caps.supportsFiltering).toBe(true)
      expect(caps.supportsAggregation).toBe(false)
    })

    it('should return minimal capabilities for unknown connection strings', () => {
      const caps = detector.detectFromConnectionString('unknown://localhost:1234')

      expect(caps.supportsFiltering).toBe(false)
    })
  })

  describe('capability probing', () => {
    it('should probe source to verify filtering capability', async () => {
      // Mock source that responds to test queries
      const mockSource = {
        name: 'test-source',
        execute: async (query: string) => {
          if (query.includes('WHERE')) return [{ id: 1 }]
          return []
        },
      }

      detector.registerSource('test-source', createCapabilities({}))
      const result = await detector.probeFiltering(mockSource)

      expect(result).toBe(true)
    })

    it('should probe source to verify aggregation capability', async () => {
      const mockSource = {
        name: 'test-source',
        execute: async (query: string) => {
          if (query.includes('COUNT')) return [{ count: 10 }]
          return []
        },
      }

      detector.registerSource('test-source', createCapabilities({}))
      const result = await detector.probeAggregation(mockSource)

      expect(result).toBe(true)
    })

    it('should update capabilities based on probe results', async () => {
      const mockSource = {
        name: 'test-source',
        execute: async () => [{ id: 1 }],
      }

      detector.registerSource('test-source', createCapabilities({ supportsFiltering: false }))
      await detector.probeAndUpdate(mockSource)

      const caps = detector.getCapabilities('test-source')
      expect(caps!.supportsFiltering).toBe(true)
    })

    it('should handle probe failures gracefully', async () => {
      const mockSource = {
        name: 'failing-source',
        execute: async () => {
          throw new Error('Connection failed')
        },
      }

      detector.registerSource('failing-source', createCapabilities({ supportsFiltering: true }))
      const result = await detector.probeFiltering(mockSource)

      expect(result).toBe(false)
    })
  })
})

describe('Query Compatibility Helpers', () => {
  describe('canPushFilter', () => {
    it('should return true when source supports the operator', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['=', '>', '<', 'IN'],
      })

      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      expect(canPushFilter(predicate, caps)).toBe(true)
    })

    it('should return false when source does not support filtering', () => {
      const caps = createCapabilities({
        supportsFiltering: false,
      })

      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'name',
        op: '=',
        value: 'Alice',
      }

      expect(canPushFilter(predicate, caps)).toBe(false)
    })

    it('should return false when operator is not supported', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['=', '!='],
      })

      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'name',
        op: 'LIKE',
        value: '%test%',
      }

      expect(canPushFilter(predicate, caps)).toBe(false)
    })

    it('should handle AND logical nodes', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['=', '>'],
      })

      const logical: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>', value: 18 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      expect(canPushFilter(logical, caps)).toBe(true)
    })

    it('should return false if any child predicate cannot be pushed', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['='],
      })

      const logical: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'name', op: '=', value: 'Alice' },
          { type: 'predicate', column: 'age', op: '>', value: 18 }, // > not supported
        ],
      }

      expect(canPushFilter(logical, caps)).toBe(false)
    })

    it('should handle OR logical nodes', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['='],
      })

      const logical: LogicalNode = {
        type: 'logical',
        op: 'OR',
        children: [
          { type: 'predicate', column: 'role', op: '=', value: 'admin' },
          { type: 'predicate', column: 'role', op: '=', value: 'moderator' },
        ],
      }

      expect(canPushFilter(logical, caps)).toBe(true)
    })

    it('should handle NOT logical nodes', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['='],
      })

      const logical: LogicalNode = {
        type: 'logical',
        op: 'NOT',
        children: [{ type: 'predicate', column: 'deleted', op: '=', value: true }],
      }

      expect(canPushFilter(logical, caps)).toBe(true)
    })

    it('should handle nested logical expressions', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['=', '>', '<'],
      })

      const logical: LogicalNode = {
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

      expect(canPushFilter(logical, caps)).toBe(true)
    })

    it('should check NEAR operator requires vector search capability', () => {
      const capsWithVector = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['NEAR'],
        supportsVectorSearch: true,
        supportedDistanceMetrics: ['cosine'],
      })

      const capsWithoutVector = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['NEAR'],
        supportsVectorSearch: false,
      })

      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'embedding',
        op: 'NEAR',
        value: [0.1, 0.2, 0.3],
        metric: 'cosine',
        k: 10,
      }

      expect(canPushFilter(predicate, capsWithVector)).toBe(true)
      expect(canPushFilter(predicate, capsWithoutVector)).toBe(false)
    })
  })

  describe('canPushProjection', () => {
    it('should return true when source supports projection', () => {
      const caps = createCapabilities({
        supportsProjection: true,
      })

      const projection: ProjectionNode = {
        type: 'projection',
        columns: [
          { source: 'id', include: true },
          { source: 'name', include: true },
        ],
      }

      expect(canPushProjection(projection, caps)).toBe(true)
    })

    it('should return false when source does not support projection', () => {
      const caps = createCapabilities({
        supportsProjection: false,
      })

      const projection: ProjectionNode = {
        type: 'projection',
        columns: [{ source: 'id', include: true }],
      }

      expect(canPushProjection(projection, caps)).toBe(false)
    })
  })

  describe('canPushAggregation', () => {
    it('should return true when all aggregates are supported', () => {
      const caps = createCapabilities({
        supportsAggregation: true,
        supportedAggregates: ['count', 'sum', 'avg'],
      })

      const groupBy: GroupByNode = {
        type: 'groupBy',
        columns: ['category'],
        aggregations: [
          { alias: 'total', aggregation: { type: 'aggregation', function: 'sum', column: 'amount' } },
          { alias: 'count', aggregation: { type: 'aggregation', function: 'count' } },
        ],
      }

      expect(canPushAggregation(groupBy, caps)).toBe(true)
    })

    it('should return false when aggregation is not supported', () => {
      const caps = createCapabilities({
        supportsAggregation: false,
      })

      const groupBy: GroupByNode = {
        type: 'groupBy',
        columns: ['category'],
        aggregations: [
          { alias: 'count', aggregation: { type: 'aggregation', function: 'count' } },
        ],
      }

      expect(canPushAggregation(groupBy, caps)).toBe(false)
    })

    it('should return false when specific aggregate function is not supported', () => {
      const caps = createCapabilities({
        supportsAggregation: true,
        supportedAggregates: ['count', 'sum'],
      })

      const groupBy: GroupByNode = {
        type: 'groupBy',
        columns: ['category'],
        aggregations: [
          { alias: 'average', aggregation: { type: 'aggregation', function: 'avg', column: 'price' } },
        ],
      }

      expect(canPushAggregation(groupBy, caps)).toBe(false)
    })

    it('should handle HAVING clause capability check', () => {
      const caps = createCapabilities({
        supportsAggregation: true,
        supportedAggregates: ['count'],
        supportsFiltering: true,
        supportedOperators: ['>'],
      })

      const groupBy: GroupByNode = {
        type: 'groupBy',
        columns: ['category'],
        aggregations: [{ alias: 'cnt', aggregation: { type: 'aggregation', function: 'count' } }],
        having: { type: 'predicate', column: 'cnt', op: '>', value: 10 },
      }

      expect(canPushAggregation(groupBy, caps)).toBe(true)
    })
  })

  describe('canPushJoin', () => {
    it('should return true when join type is supported', () => {
      const caps = createCapabilities({
        supportsJoins: true,
        supportedJoinTypes: ['INNER', 'LEFT'],
      })

      const join: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'orders',
        right: 'customers',
        on: { type: 'predicate', column: 'orders.customerId', op: '=', value: { $ref: 'customers.id' } },
      }

      expect(canPushJoin(join, caps)).toBe(true)
    })

    it('should return false when joins are not supported', () => {
      const caps = createCapabilities({
        supportsJoins: false,
      })

      const join: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'a',
        right: 'b',
        on: { type: 'predicate', column: 'a.id', op: '=', value: { $ref: 'b.id' } },
      }

      expect(canPushJoin(join, caps)).toBe(false)
    })

    it('should return false when specific join type is not supported', () => {
      const caps = createCapabilities({
        supportsJoins: true,
        supportedJoinTypes: ['INNER'],
      })

      const join: JoinNode = {
        type: 'join',
        joinType: 'RIGHT',
        left: 'a',
        right: 'b',
        on: { type: 'predicate', column: 'a.id', op: '=', value: { $ref: 'b.id' } },
      }

      expect(canPushJoin(join, caps)).toBe(false)
    })
  })

  describe('canExecuteQuery', () => {
    it('should return true for a simple filter query on capable source', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportedOperators: ['=', '>'],
      })

      const query = {
        filter: { type: 'predicate', column: 'age', op: '>', value: 21 } as PredicateNode,
      }

      expect(canExecuteQuery(query, caps)).toBe(true)
    })

    it('should return true for query with projection and filter', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportsProjection: true,
        supportedOperators: ['='],
      })

      const query = {
        filter: { type: 'predicate', column: 'status', op: '=', value: 'active' } as PredicateNode,
        projection: {
          type: 'projection',
          columns: [{ source: 'id', include: true }, { source: 'name', include: true }],
        } as ProjectionNode,
      }

      expect(canExecuteQuery(query, caps)).toBe(true)
    })

    it('should return false when any part of query cannot be executed', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportsProjection: false,
        supportedOperators: ['='],
      })

      const query = {
        filter: { type: 'predicate', column: 'status', op: '=', value: 'active' } as PredicateNode,
        projection: {
          type: 'projection',
          columns: [{ source: 'id', include: true }],
        } as ProjectionNode,
      }

      expect(canExecuteQuery(query, caps)).toBe(false)
    })

    it('should handle complex queries with multiple operations', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportsProjection: true,
        supportsAggregation: true,
        supportsJoins: true,
        supportedOperators: ['=', '>', '<'],
        supportedAggregates: ['count', 'sum'],
        supportedJoinTypes: ['INNER'],
      })

      const query = {
        filter: {
          type: 'logical',
          op: 'AND',
          children: [
            { type: 'predicate', column: 'status', op: '=', value: 'active' },
            { type: 'predicate', column: 'amount', op: '>', value: 100 },
          ],
        } as LogicalNode,
        groupBy: {
          type: 'groupBy',
          columns: ['category'],
          aggregations: [
            { alias: 'total', aggregation: { type: 'aggregation', function: 'sum', column: 'amount' } },
          ],
        } as GroupByNode,
        join: {
          type: 'join',
          joinType: 'INNER',
          left: 'orders',
          right: 'products',
          on: { type: 'predicate', column: 'orders.productId', op: '=', value: { $ref: 'products.id' } },
        } as JoinNode,
      }

      expect(canExecuteQuery(query, caps)).toBe(true)
    })

    it('should return partial execution plan for partially supported queries', () => {
      const caps = createCapabilities({
        supportsFiltering: true,
        supportsProjection: true,
        supportsAggregation: false,
        supportedOperators: ['='],
      })

      const query = {
        filter: { type: 'predicate', column: 'status', op: '=', value: 'active' } as PredicateNode,
        groupBy: {
          type: 'groupBy',
          columns: ['category'],
          aggregations: [{ alias: 'count', aggregation: { type: 'aggregation', function: 'count' } }],
        } as GroupByNode,
      }

      // Full query cannot be executed, but we can get partial support info
      expect(canExecuteQuery(query, caps)).toBe(false)
    })
  })
})

describe('Capability Merge', () => {
  it('should merge capabilities from multiple sources', () => {
    const detector = new CapabilityDetector()

    const caps1 = createCapabilities({
      supportsFiltering: true,
      supportedOperators: ['=', '>'],
    })

    const caps2 = createCapabilities({
      supportsFiltering: true,
      supportedOperators: ['=', '<'],
    })

    // When federating, we need intersection of capabilities
    const merged = detector.intersectCapabilities([caps1, caps2])

    expect(merged.supportsFiltering).toBe(true)
    expect(merged.supportedOperators).toContain('=')
    expect(merged.supportedOperators).not.toContain('>') // Only in caps1
    expect(merged.supportedOperators).not.toContain('<') // Only in caps2
  })

  it('should handle empty capability intersection', () => {
    const detector = new CapabilityDetector()

    const caps1 = createCapabilities({
      supportsFiltering: true,
    })

    const caps2 = createCapabilities({
      supportsFiltering: false,
    })

    const merged = detector.intersectCapabilities([caps1, caps2])

    expect(merged.supportsFiltering).toBe(false)
  })
})
