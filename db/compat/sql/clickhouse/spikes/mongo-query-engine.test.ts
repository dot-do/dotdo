/**
 * Tests for MongoDB Query Engine Spike
 *
 * Validates MongoDB-compatible query parsing, execution, and index acceleration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MongoQueryParser,
  AggregationPipelineParser,
  ShardRouter,
  EdgeCacheManager,
  MongoQueryEngine,
  generateTestData,
  costAnalysis,
  type MongoQuery,
  type AggregationStage,
  type IndexShard,
  type Predicate,
} from './mongo-query-engine'

describe('MongoDB Query Engine', () => {
  // ============================================================================
  // Query Parser Tests
  // ============================================================================
  describe('MongoQueryParser', () => {
    let parser: MongoQueryParser

    beforeEach(() => {
      parser = new MongoQueryParser()
    })

    describe('Basic Queries', () => {
      it('should parse simple equality query', () => {
        const query: MongoQuery = { name: 'John' }
        const result = parser.parse(query)

        expect(result.predicates).toHaveLength(1)
        expect(result.predicates[0]).toEqual({
          column: 'name',
          op: '=',
          value: 'John',
        })
      })

      it('should parse nested field query', () => {
        const query: MongoQuery = { 'data.email': 'test@example.com' }
        const result = parser.parse(query)

        expect(result.predicates[0].column).toBe('data.email')
        expect(result.predicates[0].value).toBe('test@example.com')
      })

      it('should parse null value as IS NULL', () => {
        const query: MongoQuery = { deletedAt: null }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'deletedAt',
          op: 'IS NULL',
          value: null,
        })
      })

      it('should parse array value as implicit $in', () => {
        const query: MongoQuery = { status: ['active', 'pending'] as unknown as string }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'status',
          op: 'IN',
          value: ['active', 'pending'],
        })
      })
    })

    describe('Comparison Operators', () => {
      it('should parse $eq operator', () => {
        const query: MongoQuery = { age: { $eq: 25 } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'age',
          op: '=',
          value: 25,
        })
      })

      it('should parse $gt operator', () => {
        const query: MongoQuery = { age: { $gt: 18 } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'age',
          op: '>',
          value: 18,
        })
      })

      it('should parse $gte operator', () => {
        const query: MongoQuery = { score: { $gte: 90 } }
        const result = parser.parse(query)

        expect(result.predicates[0].op).toBe('>=')
      })

      it('should parse $lt operator', () => {
        const query: MongoQuery = { price: { $lt: 100 } }
        const result = parser.parse(query)

        expect(result.predicates[0].op).toBe('<')
      })

      it('should parse $lte operator', () => {
        const query: MongoQuery = { quantity: { $lte: 10 } }
        const result = parser.parse(query)

        expect(result.predicates[0].op).toBe('<=')
      })

      it('should parse $ne operator', () => {
        const query: MongoQuery = { status: { $ne: 'deleted' } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'status',
          op: '!=',
          value: 'deleted',
        })
      })

      it('should parse $in operator', () => {
        const query: MongoQuery = { type: { $in: ['A', 'B', 'C'] } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'type',
          op: 'IN',
          value: ['A', 'B', 'C'],
        })
      })

      it('should parse $nin operator', () => {
        const query: MongoQuery = { status: { $nin: ['deleted', 'archived'] } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'status',
          op: 'NOT IN',
          value: ['deleted', 'archived'],
        })
      })

      it('should parse multiple operators on same field', () => {
        const query: MongoQuery = { age: { $gte: 18, $lte: 65 } }
        const result = parser.parse(query)

        expect(result.predicates).toHaveLength(2)
        expect(result.predicates.find((p: Predicate) => p.op === '>=')).toBeDefined()
        expect(result.predicates.find((p: Predicate) => p.op === '<=')).toBeDefined()
      })
    })

    describe('Logical Operators', () => {
      it('should parse $and operator', () => {
        const query: MongoQuery = {
          $and: [{ age: { $gte: 18 } }, { status: 'active' }],
        }
        const result = parser.parse(query)

        expect(result.logicalOp).toBe('AND')
        expect(result.nested).toHaveLength(2)
      })

      it('should parse $or operator', () => {
        const query: MongoQuery = {
          $or: [{ type: 'admin' }, { type: 'superuser' }],
        }
        const result = parser.parse(query)

        expect(result.logicalOp).toBe('OR')
        expect(result.nested).toHaveLength(2)
      })

      it('should parse complex nested query', () => {
        const query: MongoQuery = {
          $and: [
            { status: 'active' },
            {
              $or: [{ type: 'premium' }, { 'data.trial': true }],
            },
          ],
        }
        const result = parser.parse(query)

        expect(result.logicalOp).toBe('AND')
        expect(result.nested).toHaveLength(2)
        expect(result.nested![1].logicalOp).toBe('OR')
      })
    })

    describe('Element Operators', () => {
      it('should parse $exists: true', () => {
        const query: MongoQuery = { email: { $exists: true } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'email',
          op: 'IS NOT NULL',
          value: null,
        })
      })

      it('should parse $exists: false', () => {
        const query: MongoQuery = { deletedAt: { $exists: false } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'deletedAt',
          op: 'IS NULL',
          value: null,
        })
      })
    })

    describe('Text and Regex', () => {
      it('should parse $regex operator', () => {
        const query: MongoQuery = { name: { $regex: '^John' } }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: 'name',
          op: 'LIKE',
          value: '^John',
        })
      })

      it('should parse $text operator', () => {
        const query: MongoQuery = {
          $text: { $search: 'urgent important' },
        }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: '$text',
          op: 'CONTAINS',
          value: 'urgent important',
        })
      })
    })

    describe('Vector Search', () => {
      it('should parse $vector operator', () => {
        const embedding = [0.1, 0.2, 0.3, 0.4]
        const query: MongoQuery = {
          $vector: { $near: embedding, $k: 10 },
        }
        const result = parser.parse(query)

        expect(result.predicates[0]).toEqual({
          column: '$vector',
          op: 'NEAR',
          value: embedding,
          k: 10,
          minScore: undefined,
        })
      })
    })
  })

  // ============================================================================
  // Aggregation Pipeline Parser Tests
  // ============================================================================
  describe('AggregationPipelineParser', () => {
    let parser: AggregationPipelineParser

    beforeEach(() => {
      parser = new AggregationPipelineParser()
    })

    it('should parse $match stage', () => {
      const pipeline: AggregationStage[] = [{ $match: { status: 'active' } }]

      const result = parser.parse(pipeline)

      expect(result.predicates).toHaveLength(1)
      expect(result.predicates[0].column).toBe('status')
    })

    it('should parse $project stage', () => {
      const pipeline: AggregationStage[] = [{ $project: { name: 1, email: 1, _id: 0 } }]

      const result = parser.parse(pipeline)

      expect(result.projection).toEqual(['name', 'email'])
    })

    it('should parse $group stage with _id', () => {
      const pipeline: AggregationStage[] = [
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]

      const result = parser.parse(pipeline)

      expect(result.groupBy).toEqual(['type'])
      expect(result.aggregations).toHaveLength(2)
      expect(result.aggregations![0]).toEqual({
        function: 'sum',
        column: undefined,
        alias: 'count',
      })
      expect(result.aggregations![1]).toEqual({
        function: 'sum',
        column: 'amount',
        alias: 'totalAmount',
      })
    })

    it('should parse $sort stage', () => {
      const pipeline: AggregationStage[] = [{ $sort: { createdAt: -1, name: 1 } }]

      const result = parser.parse(pipeline)

      expect(result.sort).toEqual([
        { field: 'createdAt', direction: 'desc' },
        { field: 'name', direction: 'asc' },
      ])
    })

    it('should parse $limit and $skip stages', () => {
      const pipeline: AggregationStage[] = [{ $skip: 10 }, { $limit: 20 }]

      const result = parser.parse(pipeline)

      expect(result.skip).toBe(10)
      expect(result.limit).toBe(20)
    })

    it('should parse complex aggregation pipeline', () => {
      const pipeline: AggregationStage[] = [
        { $match: { type: 'Order', 'data.status': 'completed' } },
        {
          $group: {
            _id: '$data.customerId',
            orderCount: { $count: {} },
            totalSpent: { $sum: '$data.amount' },
            avgOrder: { $avg: '$data.amount' },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 },
      ]

      const result = parser.parse(pipeline)

      expect(result.predicates.length).toBeGreaterThanOrEqual(2)
      expect(result.groupBy).toEqual(['data.customerId'])
      expect(result.aggregations).toHaveLength(3)
      expect(result.sort).toEqual([{ field: 'totalSpent', direction: 'desc' }])
      expect(result.limit).toBe(10)
    })
  })

  // ============================================================================
  // Shard Router Tests
  // ============================================================================
  describe('ShardRouter', () => {
    let router: ShardRouter

    beforeEach(() => {
      router = new ShardRouter()

      // Register type-based shards
      router.registerShard({
        id: 'shard-user-1',
        type: 'type',
        value: 'User',
        doId: 'do-user-1',
      })
      router.registerShard({
        id: 'shard-order-1',
        type: 'type',
        value: 'Order',
        doId: 'do-order-1',
      })

      // Register geo replica
      router.registerShard({
        id: 'shard-user-eu',
        type: 'type',
        value: 'User',
        doId: 'do-user-eu',
        colo: 'FRA',
        replicaOf: 'shard-user-1',
      })
    })

    it('should route by type when type predicate present', () => {
      const route = router.route({
        predicates: [{ column: 'type', op: '=', value: 'User' }],
        logicalOp: 'AND',
      })

      expect(route.strategy).toBe('single')
      expect(route.shards).toHaveLength(1)
      expect(route.shards[0].value).toBe('User')
    })

    it('should prefer local geo replica', () => {
      const route = router.route(
        {
          predicates: [{ column: 'type', op: '=', value: 'User' }],
          logicalOp: 'AND',
        },
        'FRA'
      )

      expect(route.shards[0].colo).toBe('FRA')
    })

    it('should scatter to all type shards when no type predicate', () => {
      const route = router.route({
        predicates: [{ column: 'status', op: '=', value: 'active' }],
        logicalOp: 'AND',
      })

      expect(route.strategy).toBe('scatter')
      expect(route.shards.length).toBeGreaterThan(1)
    })
  })

  // ============================================================================
  // Edge Cache Manager Tests
  // ============================================================================
  describe('EdgeCacheManager', () => {
    let cache: EdgeCacheManager

    beforeEach(() => {
      cache = new EdgeCacheManager({
        maxSizeBytes: 1024 * 1024, // 1MB
        defaultTTL: 60000,
        colo: 'SFO',
      })
    })

    it('should cache and retrieve data', () => {
      const data = { users: [{ id: 1, name: 'John' }] }
      cache.set('key1', data)

      expect(cache.get('key1')).toEqual(data)
    })

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('should evict expired entries', async () => {
      cache.set('key1', { test: true }, 10) // 10ms TTL

      await new Promise((r) => setTimeout(r, 20))

      expect(cache.get('key1')).toBeUndefined()
    })

    it('should evict old entries when full', () => {
      // Fill cache with large entries
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, { data: 'x'.repeat(50000) })
      }

      // Cache should still be under max size
      const stats = cache.getStats()
      expect(stats.sizeBytes).toBeLessThanOrEqual(1024 * 1024)
    })

    it('should generate correct partition keys', () => {
      const key = EdgeCacheManager.partitionKey('type=User/dt=2024-01-01', ['id', 'name', 'email'])

      expect(key).toBe('partition:type=User/dt=2024-01-01:cols:email,id,name')
    })
  })

  // ============================================================================
  // MongoDB Query Engine Tests
  // ============================================================================
  describe('MongoQueryEngine', () => {
    let engine: MongoQueryEngine

    beforeEach(() => {
      engine = new MongoQueryEngine({ colo: 'SFO' })

      // Register type shard
      engine.registerShard({
        id: 'shard-user',
        type: 'type',
        value: 'User',
        doId: 'do-user',
      })

      // Add bloom filter for email
      engine.addBloomFilter('data.email', [
        'alice@example.com',
        'bob@example.com',
        'charlie@example.com',
      ])

      // Add min/max for createdAt
      const baseTime = Date.now()
      engine.addMinMaxStats(
        'createdAt',
        'type=User/dt=2024-01-01',
        baseTime - 86400000,
        baseTime,
        1000
      )
    })

    describe('find()', () => {
      it('should execute simple find query', async () => {
        const result = await engine.find('User', { 'data.active': true })

        expect(result.stats).toBeDefined()
        expect(result.stats.parseTimeMs).toBeGreaterThanOrEqual(0)
        expect(result.stats.routingTimeMs).toBeGreaterThanOrEqual(0)
      })

      it('should use bloom filter to skip fetch', async () => {
        const result = await engine.find('User', {
          'data.email': 'nonexistent@nowhere.com',
        })

        // Bloom filter says definitely not exists
        expect(result.data).toEqual([])
        expect(result.stats.partitionsFetched).toBe(0)
      })

      it('should track query statistics', async () => {
        const result = await engine.find('User', { type: 'User' }, { limit: 10 })

        expect(result.stats.totalTimeMs).toBeGreaterThan(0)
        expect(result.stats.shardsQueried).toBeGreaterThanOrEqual(1)
      })
    })

    describe('aggregate()', () => {
      it('should execute count aggregation from index', async () => {
        const result = await engine.aggregate('User', [
          { $match: { type: 'User' } },
          { $group: { _id: null, count: { $count: {} } } },
        ])

        expect(result.stats.indexTimeMs).toBeGreaterThanOrEqual(0)
      })

      it('should parse and execute full pipeline', async () => {
        const pipeline: AggregationStage[] = [
          { $match: { 'data.status': 'active' } },
          {
            $group: {
              _id: '$type',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ]

        const result = await engine.aggregate('User', pipeline)

        expect(result.stats.parseTimeMs).toBeGreaterThanOrEqual(0)
        expect(result.stats.aggregateTimeMs).toBeGreaterThanOrEqual(0)
      })
    })
  })

  // ============================================================================
  // Test Data Generation
  // ============================================================================
  describe('Test Data Generation', () => {
    it('should generate test data with correct structure', () => {
      const data = generateTestData(100, 'User')

      expect(data).toHaveLength(100)
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('type', 'User')
      expect(data[0]).toHaveProperty('data')
      expect(data[0].data).toHaveProperty('email')
      expect(data[0].data).toHaveProperty('age')
    })

    it('should generate unique IDs', () => {
      const data = generateTestData(100, 'Order')
      const ids = data.map((d) => d.id)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(100)
    })
  })

  // ============================================================================
  // Cost Analysis
  // ============================================================================
  describe('Cost Analysis', () => {
    it('should show savings for count queries', () => {
      const analysis = costAnalysis(10000000, 1000)
      const countQuery = analysis.find((a) => a.query === 'db.users.countDocuments()')

      expect(countQuery).toBeDefined()
      expect(countQuery!.accelerated.partitionsFetched).toBe(0)
      expect(countQuery!.savings).toBe('99.99%')
    })

    it('should show savings for bloom filter queries', () => {
      const analysis = costAnalysis(10000000, 1000)
      const emailQuery = analysis.find((a) => a.query === 'db.users.find({"data.email": "x@y.com"})')

      expect(emailQuery).toBeDefined()
      expect(emailQuery!.accelerated.partitionsFetched).toBe(0)
      expect(emailQuery!.savings).toBe('99.99%')
    })

    it('should show savings for range queries', () => {
      const analysis = costAnalysis(10000000, 1000)
      const rangeQuery = analysis.find((a) => a.query === 'db.users.find({createdAt: {$gt: date}})')

      expect(rangeQuery).toBeDefined()
      expect(rangeQuery!.accelerated.partitionsFetched).toBeLessThan(
        rangeQuery!.traditional.partitionsFetched
      )
      expect(rangeQuery!.savings).toBe('75%')
    })

    it('should show savings for vector queries', () => {
      const analysis = costAnalysis(10000000, 1000)
      const vectorQuery = analysis.find((a) =>
        a.query.includes('$vector')
      )

      expect(vectorQuery).toBeDefined()
      expect(vectorQuery!.accelerated.partitionsFetched).toBe(0)
      expect(vectorQuery!.savings).toBe('99.99%')
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================
  describe('Integration', () => {
    it('should handle real-world query pattern', async () => {
      const engine = new MongoQueryEngine({ colo: 'SFO' })

      // Setup shards
      engine.registerShard({ id: 's1', type: 'type', value: 'Order', doId: 'do1' })

      // Add indexes
      engine.addBloomFilter('data.customerId', ['cust-1', 'cust-2', 'cust-3'])
      engine.addMinMaxStats(
        'data.amount',
        'type=Order/dt=2024-01',
        0,
        10000,
        5000
      )

      // Execute typical e-commerce query
      const result = await engine.aggregate('Order', [
        {
          $match: {
            'data.status': 'completed',
            'data.amount': { $gte: 100 },
          },
        },
        {
          $group: {
            _id: '$data.customerId',
            totalSpent: { $sum: '$data.amount' },
            orderCount: { $count: {} },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 },
      ])

      expect(result.stats.totalTimeMs).toBeGreaterThan(0)
    })

    it('should parse complex nested query with all operators', () => {
      const parser = new MongoQueryParser()

      const query: MongoQuery = {
        $and: [
          { type: 'User' },
          {
            $or: [
              { 'data.premium': true },
              { 'data.trialEndsAt': { $gt: new Date() } },
            ],
          },
          { 'data.email': { $exists: true } },
          { status: { $nin: ['deleted', 'suspended'] } },
          { age: { $gte: 18, $lte: 100 } },
        ],
      }

      const result = parser.parse(query)

      expect(result.logicalOp).toBe('AND')
      expect(result.nested).toBeDefined()
      // All predicates are inside $and, so they're in nested queries
      expect(result.nested!.length).toBeGreaterThan(0)
    })
  })
})
