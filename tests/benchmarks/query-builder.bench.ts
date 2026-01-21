/**
 * Query Builder Performance Benchmarks
 *
 * Tests performance characteristics of db/query.ts QueryBuilder including:
 * - Complex WHERE clauses with 10+ conditions
 * - Multiple JOIN operations
 * - Large result sets (1000+ items)
 * - Query limit warnings/enforcement
 *
 * These benchmarks establish baselines to detect performance regressions.
 *
 * Issue: do-d9gw - [testing] Add performance benchmarks for query builder
 *
 * @module tests/benchmarks/query-builder.bench
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { createThingsStore, type ThingsStore } from '../../db/things'
import { createRelationshipsStore, type RelationshipsStore } from '../../db/relationships'
import {
  query,
  createQueryWithJoins,
  configureQueryLimits,
  getQueryLimits,
  DEFAULT_QUERY_LIMITS,
  type QueryBuilder,
} from '../../db/query'
import { runBenchmark, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'

// ============================================================================
// TEST DATA GENERATION UTILITIES
// ============================================================================

/**
 * Generate test data for a User entity
 */
function generateUser(index: number) {
  return {
    $type: 'User',
    name: `User ${index}`,
    email: `user${index}@example.com`,
    age: 20 + (index % 50),
    role: index % 10 === 0 ? 'admin' : 'user',
    status: index % 5 === 0 ? 'inactive' : 'active',
    department: ['engineering', 'sales', 'marketing', 'support'][index % 4],
    level: Math.floor(index / 100) + 1,
    score: Math.random() * 100,
    verified: index % 3 === 0,
    country: ['US', 'UK', 'DE', 'FR', 'JP'][index % 5],
    city: `City${index % 20}`,
  }
}

/**
 * Generate test data for an Order entity
 */
function generateOrder(index: number, userId: string) {
  return {
    $type: 'Order',
    userId,
    total: (index % 100) * 10 + 5,
    status: ['pending', 'processing', 'shipped', 'delivered'][index % 4],
    items: Math.floor(index / 10) + 1,
    priority: index % 10 === 0 ? 'high' : 'normal',
  }
}

/**
 * Generate test data for a Product entity
 */
function generateProduct(index: number) {
  return {
    $type: 'Product',
    name: `Product ${index}`,
    price: (index % 50) * 10 + 5,
    category: ['electronics', 'clothing', 'home', 'sports'][index % 4],
    inStock: index % 5 !== 0,
    rating: (index % 5) + 1,
  }
}

// ============================================================================
// BASELINE PERFORMANCE EXPECTATIONS
// ============================================================================

/**
 * Performance baseline expectations (in milliseconds)
 * These are upper bounds - actual performance should be significantly better
 *
 * Environment: Node.js with in-memory store
 * These baselines are conservative to allow for CI environment variance
 */
const PERFORMANCE_BASELINES = {
  // Simple query with single WHERE condition on 1000 items
  SIMPLE_QUERY_1K_ITEMS: {
    mean: 50,      // Should complete within 50ms average
    p95: 100,      // 95th percentile under 100ms
    p99: 150,      // 99th percentile under 150ms
  },

  // Complex query with 10+ WHERE conditions on 1000 items
  COMPLEX_WHERE_10_CONDITIONS: {
    mean: 100,     // Should complete within 100ms average
    p95: 200,      // 95th percentile under 200ms
    p99: 300,      // 99th percentile under 300ms
  },

  // Query with single JOIN operation on 500 items
  SINGLE_JOIN_500_ITEMS: {
    mean: 150,     // Should complete within 150ms average
    p95: 300,      // 95th percentile under 300ms
    p99: 500,      // 99th percentile under 500ms
  },

  // Query with multiple (3) JOIN operations
  MULTIPLE_JOINS_3: {
    mean: 300,     // Should complete within 300ms average
    p95: 500,      // 95th percentile under 500ms
    p99: 750,      // 99th percentile under 750ms
  },

  // Bulk query returning 1000+ items
  BULK_RESULT_1K: {
    mean: 100,     // Should complete within 100ms average
    p95: 200,      // 95th percentile under 200ms
    p99: 300,      // 99th percentile under 300ms
  },

  // Query limit enforcement overhead
  LIMIT_ENFORCEMENT: {
    mean: 5,       // Should add minimal overhead (<5ms)
    p95: 10,       // 95th percentile under 10ms
    p99: 20,       // 99th percentile under 20ms
  },
}

// ============================================================================
// BENCHMARK TESTS
// ============================================================================

describe('Query Builder Performance Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}
  let thingsStore: ThingsStore
  let relationshipsStore: RelationshipsStore
  let warningCount: number
  let originalConfig: ReturnType<typeof getQueryLimits>

  beforeEach(async () => {
    thingsStore = createThingsStore()
    relationshipsStore = createRelationshipsStore()
    warningCount = 0

    // Save original config
    originalConfig = getQueryLimits()

    // Configure warnings for testing
    configureQueryLimits({
      onWarning: () => {
        warningCount++
      },
    })
  })

  afterEach(() => {
    // Restore original config
    configureQueryLimits({
      defaultLimit: originalConfig.defaultLimit,
      defaultJoinLimit: originalConfig.defaultJoinLimit,
      maxLimit: originalConfig.maxLimit,
      warningThreshold: originalConfig.warningThreshold,
      onWarning: originalConfig.onWarning,
    })
  })

  // ========================================================================
  // 1. SIMPLE QUERY PERFORMANCE
  // ========================================================================

  describe('Simple Query Performance', () => {
    it('should benchmark simple WHERE clause on 1000 items', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-simple-where-1k',
        async () => {
          await query(thingsStore)
            .type('User')
            .where('role', 'admin')
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-simple-where-1k'] = metrics
      console.log('\n' + formatMetrics(metrics))

      // Verify baseline expectations
      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
      expect(metrics.p95).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.p95)
    })

    it('should benchmark simple range query on 1000 items', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-simple-range-1k',
        async () => {
          await query(thingsStore)
            .type('User')
            .whereOp('age', '>=', 30)
            .whereOp('age', '<=', 40)
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-simple-range-1k'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })

    it('should benchmark LIKE pattern matching on 1000 items', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-like-pattern-1k',
        async () => {
          await query(thingsStore)
            .type('User')
            .whereOp('email', 'LIKE', '%@example.com')
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-like-pattern-1k'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })

    it('should benchmark IN operator with multiple values', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const departments = ['engineering', 'sales', 'marketing']

      const metrics = await runBenchmark(
        'query-in-operator-1k',
        async () => {
          await query(thingsStore)
            .type('User')
            .whereOp('department', 'IN', departments)
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-in-operator-1k'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })
  })

  // ========================================================================
  // 2. COMPLEX QUERY PERFORMANCE (10+ CONDITIONS)
  // ========================================================================

  describe('Complex WHERE Clauses (10+ conditions)', () => {
    it('should benchmark 10 WHERE conditions on 1000 items', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-complex-10-conditions',
        async () => {
          await query(thingsStore)
            .type('User')
            .where('role', 'user')
            .where('status', 'active')
            .whereOp('age', '>=', 25)
            .whereOp('age', '<=', 45)
            .whereOp('level', '>=', 1)
            .whereOp('level', '<=', 5)
            .whereOp('score', '>=', 20)
            .whereOp('verified', '=', true)
            .whereOp('department', 'IN', ['engineering', 'sales'])
            .whereOp('country', 'IN', ['US', 'UK', 'DE'])
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-complex-10-conditions'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.COMPLEX_WHERE_10_CONDITIONS.mean)
      expect(metrics.p95).toBeLessThan(PERFORMANCE_BASELINES.COMPLEX_WHERE_10_CONDITIONS.p95)
    })

    it('should benchmark 15 WHERE conditions with mixed operators', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-complex-15-conditions',
        async () => {
          await query(thingsStore)
            .type('User')
            .where('role', 'user')
            .where('status', 'active')
            .whereOp('age', '>=', 20)
            .whereOp('age', '<=', 50)
            .whereOp('level', '>=', 1)
            .whereOp('level', '<=', 10)
            .whereOp('score', '>=', 10)
            .whereOp('score', '<=', 90)
            .whereOp('verified', '=', true)
            .whereOp('department', 'IN', ['engineering', 'sales', 'marketing'])
            .whereOp('country', 'IN', ['US', 'UK', 'DE', 'FR'])
            .whereOp('name', 'LIKE', 'User%')
            .whereOp('email', 'LIKE', '%@example.com')
            .whereOp('city', '!=', 'City0')
            .whereOp('city', '!=', 'City1')
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-complex-15-conditions'] = metrics
      console.log('\n' + formatMetrics(metrics))

      // 15 conditions should still be within 2x the 10-condition baseline
      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.COMPLEX_WHERE_10_CONDITIONS.mean * 2)
    })

    it('should scale linearly with number of conditions', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      // Benchmark 5 conditions
      const metrics5 = await runBenchmark(
        'query-conditions-5',
        async () => {
          await query(thingsStore)
            .type('User')
            .where('role', 'user')
            .where('status', 'active')
            .whereOp('age', '>=', 25)
            .whereOp('age', '<=', 45)
            .whereOp('verified', '=', true)
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      // Benchmark 10 conditions
      const metrics10 = await runBenchmark(
        'query-conditions-10',
        async () => {
          await query(thingsStore)
            .type('User')
            .where('role', 'user')
            .where('status', 'active')
            .whereOp('age', '>=', 25)
            .whereOp('age', '<=', 45)
            .whereOp('level', '>=', 1)
            .whereOp('level', '<=', 5)
            .whereOp('score', '>=', 20)
            .whereOp('verified', '=', true)
            .whereOp('department', 'IN', ['engineering', 'sales'])
            .whereOp('country', 'IN', ['US', 'UK', 'DE'])
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-conditions-5'] = metrics5
      benchmarkResults['query-conditions-10'] = metrics10

      console.log('\n5 conditions: ' + formatMetrics(metrics5))
      console.log('\n10 conditions: ' + formatMetrics(metrics10))

      // 10 conditions should be less than 3x slower than 5 conditions
      // (sublinear scaling is expected due to early filtering)
      expect(metrics10.mean).toBeLessThan(metrics5.mean * 3)
    })
  })

  // ========================================================================
  // 3. JOIN OPERATION PERFORMANCE
  // ========================================================================

  describe('JOIN Operation Performance', () => {
    it('should benchmark single LEFT JOIN on 500 items', async () => {
      // Seed 500 users and 1000 orders (2 per user)
      const userIds: string[] = []
      for (let i = 0; i < 500; i++) {
        const user = await thingsStore.create(generateUser(i))
        userIds.push(user.$id)
      }

      for (let i = 0; i < 1000; i++) {
        const order = await thingsStore.create(generateOrder(i, userIds[i % 500]!))
        await relationshipsStore.add({
          subject: userIds[i % 500]!,
          predicate: 'hasOrder',
          object: order.$id,
        })
      }

      const queryBuilder = createQueryWithJoins(thingsStore, relationshipsStore)

      const metrics = await runBenchmark(
        'query-single-join-500',
        async () => {
          await queryBuilder
            .type('User')
            .leftJoin('hasOrder', 'Order')
            .limit(100)
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-single-join-500'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SINGLE_JOIN_500_ITEMS.mean)
      expect(metrics.p95).toBeLessThan(PERFORMANCE_BASELINES.SINGLE_JOIN_500_ITEMS.p95)
    })

    it('should benchmark INNER JOIN filtering', async () => {
      // Seed 500 users, but only 250 have orders
      const userIds: string[] = []
      for (let i = 0; i < 500; i++) {
        const user = await thingsStore.create(generateUser(i))
        userIds.push(user.$id)
      }

      // Only odd-indexed users have orders
      for (let i = 0; i < 250; i++) {
        const userIndex = i * 2 + 1
        const order = await thingsStore.create(generateOrder(i, userIds[userIndex]!))
        await relationshipsStore.add({
          subject: userIds[userIndex]!,
          predicate: 'hasOrder',
          object: order.$id,
        })
      }

      const queryBuilder = createQueryWithJoins(thingsStore, relationshipsStore)

      const metrics = await runBenchmark(
        'query-inner-join-filter',
        async () => {
          await queryBuilder
            .type('User')
            .join('hasOrder', 'Order') // INNER JOIN excludes users without orders
            .limit(100)
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-inner-join-filter'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SINGLE_JOIN_500_ITEMS.mean)
    })

    it('should benchmark multiple JOINs (3 relationships)', async () => {
      // Seed users, orders, and products with relationships
      const userIds: string[] = []
      const orderIds: string[] = []

      for (let i = 0; i < 200; i++) {
        const user = await thingsStore.create(generateUser(i))
        userIds.push(user.$id)
      }

      for (let i = 0; i < 400; i++) {
        const order = await thingsStore.create(generateOrder(i, userIds[i % 200]!))
        orderIds.push(order.$id)
        await relationshipsStore.add({
          subject: userIds[i % 200]!,
          predicate: 'hasOrder',
          object: order.$id,
        })
      }

      for (let i = 0; i < 200; i++) {
        const product = await thingsStore.create(generateProduct(i))
        // Each order has 2 products
        await relationshipsStore.add({
          subject: orderIds[i * 2]!,
          predicate: 'containsProduct',
          object: product.$id,
        })
        await relationshipsStore.add({
          subject: orderIds[i * 2 + 1]!,
          predicate: 'containsProduct',
          object: product.$id,
        })
      }

      const queryBuilder = createQueryWithJoins(thingsStore, relationshipsStore)

      const metrics = await runBenchmark(
        'query-multiple-joins-3',
        async () => {
          await queryBuilder
            .type('User')
            .leftJoin('hasOrder', 'Order')
            .limit(50)
            .execute()
        },
        { iterations: 20, warmupIterations: 3 }
      )

      benchmarkResults['query-multiple-joins-3'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.MULTIPLE_JOINS_3.mean)
      expect(metrics.p95).toBeLessThan(PERFORMANCE_BASELINES.MULTIPLE_JOINS_3.p95)
    })

    it('should benchmark JOIN with conditions', async () => {
      // Seed users and orders
      const userIds: string[] = []
      for (let i = 0; i < 300; i++) {
        const user = await thingsStore.create(generateUser(i))
        userIds.push(user.$id)
      }

      for (let i = 0; i < 600; i++) {
        const order = await thingsStore.create(generateOrder(i, userIds[i % 300]!))
        await relationshipsStore.add({
          subject: userIds[i % 300]!,
          predicate: 'hasOrder',
          object: order.$id,
        })
      }

      const queryBuilder = createQueryWithJoins(thingsStore, relationshipsStore)

      const metrics = await runBenchmark(
        'query-join-with-conditions',
        async () => {
          await queryBuilder
            .type('User')
            .where('role', 'user')
            .leftJoin('hasOrder', 'Order', { status: 'delivered' })
            .limit(50)
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-join-with-conditions'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SINGLE_JOIN_500_ITEMS.mean)
    })
  })

  // ========================================================================
  // 4. LARGE RESULT SET PERFORMANCE
  // ========================================================================

  describe('Large Result Set Performance (1000+ items)', () => {
    it('should benchmark returning 1000 items', async () => {
      // Seed 2000 users
      for (let i = 0; i < 2000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-bulk-result-1k',
        async () => {
          await query(thingsStore)
            .type('User')
            .limit(1000)
            .execute()
        },
        { iterations: 20, warmupIterations: 3 }
      )

      benchmarkResults['query-bulk-result-1k'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.BULK_RESULT_1K.mean)
      expect(metrics.p95).toBeLessThan(PERFORMANCE_BASELINES.BULK_RESULT_1K.p95)
    })

    it('should benchmark paginated queries on large dataset', async () => {
      // Seed 2000 users
      for (let i = 0; i < 2000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-paginated-large',
        async () => {
          // Simulate paginating through results
          const results = await query(thingsStore)
            .type('User')
            .limit(100)
            .offset(500)
            .execute()
          expect(results.length).toBeLessThanOrEqual(100)
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-paginated-large'] = metrics
      console.log('\n' + formatMetrics(metrics))

      // Pagination should be efficient
      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })

    it('should benchmark count operation on large dataset', async () => {
      // Seed 2000 users
      for (let i = 0; i < 2000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-count-large',
        async () => {
          const count = await query(thingsStore)
            .type('User')
            .where('role', 'user')
            .count()
          expect(count).toBeGreaterThan(0)
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-count-large'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.BULK_RESULT_1K.mean)
    })

    it('should benchmark first() operation on large dataset', async () => {
      // Seed 2000 users
      for (let i = 0; i < 2000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-first-large',
        async () => {
          const result = await query(thingsStore)
            .type('User')
            .where('role', 'admin')
            .first()
          expect(result).not.toBeNull()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-first-large'] = metrics
      console.log('\n' + formatMetrics(metrics))

      // first() should be very fast
      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })
  })

  // ========================================================================
  // 5. QUERY LIMIT WARNINGS/ENFORCEMENT
  // ========================================================================

  describe('Query Limit Warnings and Enforcement', () => {
    it('should benchmark limit enforcement overhead', async () => {
      // Seed 500 users
      for (let i = 0; i < 500; i++) {
        await thingsStore.create(generateUser(i))
      }

      // Benchmark with default limits
      const metricsDefault = await runBenchmark(
        'query-limit-default',
        async () => {
          await query(thingsStore)
            .type('User')
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      // Benchmark with explicit limit
      const metricsExplicit = await runBenchmark(
        'query-limit-explicit',
        async () => {
          await query(thingsStore)
            .type('User')
            .limit(100)
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-limit-default'] = metricsDefault
      benchmarkResults['query-limit-explicit'] = metricsExplicit

      console.log('\nDefault limit: ' + formatMetrics(metricsDefault))
      console.log('\nExplicit limit: ' + formatMetrics(metricsExplicit))

      // Limit enforcement overhead should be minimal
      const overhead = Math.abs(metricsExplicit.mean - metricsDefault.mean)
      expect(overhead).toBeLessThan(PERFORMANCE_BASELINES.LIMIT_ENFORCEMENT.mean)
    })

    it('should benchmark warning callback overhead', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      // Configure with warning threshold
      configureQueryLimits({
        warningThreshold: 100,
        onWarning: () => {
          warningCount++
        },
      })

      const metricsWithWarning = await runBenchmark(
        'query-with-warning',
        async () => {
          await query(thingsStore)
            .type('User')
            .limit(500) // Above threshold
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      // Reset warning count and disable warnings
      warningCount = 0
      configureQueryLimits({
        warningThreshold: 10000, // Very high threshold
        onWarning: undefined,
      })

      const metricsNoWarning = await runBenchmark(
        'query-no-warning',
        async () => {
          await query(thingsStore)
            .type('User')
            .limit(500)
            .execute()
        },
        { iterations: 30, warmupIterations: 5 }
      )

      benchmarkResults['query-with-warning'] = metricsWithWarning
      benchmarkResults['query-no-warning'] = metricsNoWarning

      console.log('\nWith warning callback: ' + formatMetrics(metricsWithWarning))
      console.log('\nWithout warning callback: ' + formatMetrics(metricsNoWarning))

      // Warning callback overhead should be minimal
      const overhead = Math.abs(metricsWithWarning.mean - metricsNoWarning.mean)
      expect(overhead).toBeLessThan(PERFORMANCE_BASELINES.LIMIT_ENFORCEMENT.p95)
    })

    it('should benchmark max limit clamping', async () => {
      // Seed 500 users
      for (let i = 0; i < 500; i++) {
        await thingsStore.create(generateUser(i))
      }

      // Configure with low max limit
      configureQueryLimits({
        maxLimit: 50,
      })

      const metrics = await runBenchmark(
        'query-clamped-limit',
        async () => {
          const results = await query(thingsStore)
            .type('User')
            .limit(1000) // Should be clamped to 50
            .execute()
          // Verify clamping worked
          expect(results.length).toBeLessThanOrEqual(50)
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-clamped-limit'] = metrics
      console.log('\n' + formatMetrics(metrics))

      // Clamping should not add significant overhead
      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })
  })

  // ========================================================================
  // 6. ORDERING AND PROJECTION PERFORMANCE
  // ========================================================================

  describe('Ordering and Projection Performance', () => {
    it('should benchmark orderBy performance', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-orderby',
        async () => {
          await query(thingsStore)
            .type('User')
            .orderBy('age', 'asc')
            .limit(100)
            .execute()
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-orderby'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })

    it('should benchmark select projection performance', async () => {
      // Seed 1000 users
      for (let i = 0; i < 1000; i++) {
        await thingsStore.create(generateUser(i))
      }

      const metrics = await runBenchmark(
        'query-select-projection',
        async () => {
          const results = await query(thingsStore)
            .type('User')
            .select('name', 'email', 'role')
            .limit(100)
            .execute()
          // Verify projection
          if (results.length > 0) {
            expect(results[0]).toHaveProperty('name')
            expect(results[0]).not.toHaveProperty('age')
          }
        },
        { iterations: 50, warmupIterations: 5 }
      )

      benchmarkResults['query-select-projection'] = metrics
      console.log('\n' + formatMetrics(metrics))

      expect(metrics.mean).toBeLessThan(PERFORMANCE_BASELINES.SIMPLE_QUERY_1K_ITEMS.mean)
    })
  })

  // Export results for baseline comparison
  afterAll(() => {
    ;(globalThis as any).__benchmarkResults = {
      ...((globalThis as any).__benchmarkResults || {}),
      ...benchmarkResults,
    }

    // Print summary
    console.log('\n========================================')
    console.log('QUERY BUILDER BENCHMARK SUMMARY')
    console.log('========================================')
    for (const [name, metrics] of Object.entries(benchmarkResults)) {
      console.log(`${name}: mean=${metrics.mean.toFixed(2)}ms, p95=${metrics.p95.toFixed(2)}ms, ops/sec=${metrics.opsPerSecond.toFixed(0)}`)
    }
    console.log('========================================\n')
  })
})
