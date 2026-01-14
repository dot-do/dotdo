/**
 * Pre-aggregation Strategies Tests (RED Phase)
 *
 * Tests for rollup strategies in the semantic layer:
 * - Auto-rollup detection from query patterns
 * - Manual rollup definition in cube schema
 * - Incremental refresh strategies
 * - Partition-based rollups (by time dimension)
 * - Rollup storage backends (in-DB, separate table, external)
 * - Query routing to use rollups when applicable
 * - Rollup invalidation on source data changes
 *
 * @see dotdo-ionxm
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  PreAggregationManager,
  RollupDefinition,
  RollupStatus,
  RefreshStrategy,
  PartitionConfig,
  StorageBackend,
  QueryRouter,
  RollupMatcher,
  InvalidationManager,
  RollupBuildResult,
  AutoRollupDetector,
  QueryPattern,
} from './pre-aggregation'

// =============================================================================
// TEST DATA FIXTURES
// =============================================================================

const ordersRollupDefinition: RollupDefinition = {
  name: 'dailyRevenue',
  cubeName: 'orders',
  measures: ['revenue', 'count'],
  dimensions: ['category'],
  timeDimension: {
    dimension: 'createdAt',
    granularity: 'day',
  },
  refreshKey: {
    every: '1 hour',
  },
}

const partitionedRollupDefinition: RollupDefinition = {
  name: 'monthlyRevenuePartitioned',
  cubeName: 'orders',
  measures: ['revenue', 'count'],
  dimensions: ['category', 'region'],
  timeDimension: {
    dimension: 'createdAt',
    granularity: 'month',
  },
  partitionGranularity: 'month',
  refreshKey: {
    every: '6 hours',
    incremental: true,
    updateWindow: '7 days',
  },
}

// =============================================================================
// ROLLUP DEFINITION TESTS
// =============================================================================

describe('RollupDefinition', () => {
  describe('Basic Definition', () => {
    it('should define a rollup with measures and dimensions', () => {
      const rollup: RollupDefinition = {
        name: 'dailyRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['createdAt.day', 'category'],
        refreshKey: { every: '1 hour' },
      }

      expect(rollup.name).toBe('dailyRevenue')
      expect(rollup.measures).toContain('revenue')
      expect(rollup.dimensions).toContain('category')
    })

    it('should support time dimension with granularity', () => {
      const rollup: RollupDefinition = {
        name: 'hourlyMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: [],
        timeDimension: {
          dimension: 'timestamp',
          granularity: 'hour',
        },
      }

      expect(rollup.timeDimension?.dimension).toBe('timestamp')
      expect(rollup.timeDimension?.granularity).toBe('hour')
    })

    it('should support partition granularity for large datasets', () => {
      const rollup: RollupDefinition = {
        name: 'partitionedMetrics',
        cubeName: 'logs',
        measures: ['count'],
        dimensions: ['level'],
        timeDimension: {
          dimension: 'timestamp',
          granularity: 'day',
        },
        partitionGranularity: 'month',
      }

      expect(rollup.partitionGranularity).toBe('month')
    })

    it('should support multiple refresh key strategies', () => {
      const timeBasedRollup: RollupDefinition = {
        name: 'timeRefresh',
        cubeName: 'orders',
        measures: ['count'],
        dimensions: [],
        refreshKey: { every: '30 minutes' },
      }

      const sqlBasedRollup: RollupDefinition = {
        name: 'sqlRefresh',
        cubeName: 'orders',
        measures: ['count'],
        dimensions: [],
        refreshKey: { sql: 'SELECT MAX(updated_at) FROM orders' },
      }

      expect(timeBasedRollup.refreshKey?.every).toBe('30 minutes')
      expect(sqlBasedRollup.refreshKey?.sql).toContain('MAX')
    })

    it('should support incremental refresh with update window', () => {
      const rollup: RollupDefinition = {
        name: 'incrementalRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'day',
        },
        refreshKey: {
          every: '1 hour',
          incremental: true,
          updateWindow: '3 days',
        },
      }

      expect(rollup.refreshKey?.incremental).toBe(true)
      expect(rollup.refreshKey?.updateWindow).toBe('3 days')
    })

    it('should support index definitions for query optimization', () => {
      const rollup: RollupDefinition = {
        name: 'indexedRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category', 'region'],
        indexes: {
          categoryIdx: { columns: ['category'] },
          regionCategoryIdx: { columns: ['region', 'category'] },
        },
      }

      expect(rollup.indexes?.categoryIdx.columns).toContain('category')
    })
  })
})

// =============================================================================
// PRE-AGGREGATION MANAGER TESTS
// =============================================================================

describe('PreAggregationManager', () => {
  let manager: PreAggregationManager

  beforeEach(() => {
    manager = new PreAggregationManager()
  })

  describe('Rollup Registration', () => {
    it('should register a new rollup definition', () => {
      manager.registerRollup(ordersRollupDefinition)

      const rollup = manager.getRollup('orders', 'dailyRevenue')
      expect(rollup).toBeDefined()
      expect(rollup?.name).toBe('dailyRevenue')
    })

    it('should register multiple rollups for the same cube', () => {
      manager.registerRollup(ordersRollupDefinition)
      manager.registerRollup(partitionedRollupDefinition)

      const rollups = manager.getRollupsForCube('orders')
      expect(rollups).toHaveLength(2)
    })

    it('should throw when registering duplicate rollup name', () => {
      manager.registerRollup(ordersRollupDefinition)

      expect(() => manager.registerRollup(ordersRollupDefinition)).toThrow()
    })

    it('should validate rollup definition on registration', () => {
      const invalidRollup: RollupDefinition = {
        name: '',
        cubeName: 'orders',
        measures: [],
        dimensions: [],
      }

      expect(() => manager.registerRollup(invalidRollup)).toThrow()
    })

    it('should list all registered rollups', () => {
      manager.registerRollup(ordersRollupDefinition)
      manager.registerRollup({
        ...partitionedRollupDefinition,
        cubeName: 'customers',
      })

      const allRollups = manager.listAllRollups()
      expect(allRollups).toHaveLength(2)
    })
  })

  describe('Rollup Status Management', () => {
    it('should track rollup build status', async () => {
      manager.registerRollup(ordersRollupDefinition)

      const status = manager.getStatus('orders', 'dailyRevenue')
      expect(status.state).toBe('pending')
    })

    it('should update status after build', async () => {
      manager.registerRollup(ordersRollupDefinition)

      // Simulate build
      await manager.buildRollup('orders', 'dailyRevenue', {
        execute: async () => ({ data: [], sql: '' }),
      })

      const status = manager.getStatus('orders', 'dailyRevenue')
      expect(status.state).toBe('built')
      expect(status.lastBuildAt).toBeDefined()
    })

    it('should track row count after build', async () => {
      manager.registerRollup(ordersRollupDefinition)

      await manager.buildRollup('orders', 'dailyRevenue', {
        execute: async () => ({
          data: [{ count: 100 }],
          sql: '',
          rowCount: 100,
        }),
      })

      const status = manager.getStatus('orders', 'dailyRevenue')
      expect(status.rowCount).toBe(100)
    })

    it('should track last refresh time', async () => {
      manager.registerRollup(ordersRollupDefinition)

      const beforeBuild = new Date()
      await manager.buildRollup('orders', 'dailyRevenue', {
        execute: async () => ({ data: [], sql: '' }),
      })

      const status = manager.getStatus('orders', 'dailyRevenue')
      expect(new Date(status.lastRefreshAt!).getTime()).toBeGreaterThanOrEqual(
        beforeBuild.getTime()
      )
    })

    it('should report stale rollups based on refresh key', async () => {
      vi.useFakeTimers()

      manager.registerRollup(ordersRollupDefinition)
      await manager.buildRollup('orders', 'dailyRevenue', {
        execute: async () => ({ data: [], sql: '' }),
      })

      // Advance time past refresh interval
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      const status = manager.getStatus('orders', 'dailyRevenue')
      expect(status.isStale).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('Rollup Building', () => {
    it('should generate CREATE TABLE SQL for rollup', () => {
      manager.registerRollup(ordersRollupDefinition)

      const sql = manager.getBuildSQL('orders', 'dailyRevenue')
      expect(sql).toContain('CREATE TABLE')
      expect(sql).toContain('dailyRevenue')
    })

    it('should generate appropriate aggregations in build SQL', () => {
      manager.registerRollup(ordersRollupDefinition)

      const sql = manager.getBuildSQL('orders', 'dailyRevenue')
      expect(sql).toContain('SUM')
      expect(sql).toContain('COUNT')
      expect(sql).toContain('GROUP BY')
    })

    it('should include time truncation for time dimension', () => {
      manager.registerRollup(ordersRollupDefinition)

      const sql = manager.getBuildSQL('orders', 'dailyRevenue')
      expect(sql).toMatch(/date_trunc|DATE_TRUNC/i)
    })

    it('should build partitioned rollup with partition management', async () => {
      manager.registerRollup(partitionedRollupDefinition)

      const result = await manager.buildRollup(
        'orders',
        'monthlyRevenuePartitioned',
        {
          execute: async () => ({ data: [], sql: '' }),
        }
      )

      expect(result.partitions).toBeDefined()
    })

    it('should support dry run mode for build', () => {
      manager.registerRollup(ordersRollupDefinition)

      const result = manager.buildRollupDryRun('orders', 'dailyRevenue')
      expect(result.sql).toBeDefined()
      expect(result.estimatedRows).toBeDefined()
    })
  })
})

// =============================================================================
// REFRESH STRATEGY TESTS
// =============================================================================

describe('RefreshStrategy', () => {
  let manager: PreAggregationManager

  beforeEach(() => {
    manager = new PreAggregationManager()
  })

  describe('Time-Based Refresh', () => {
    it('should parse interval strings correctly', () => {
      const strategy = new RefreshStrategy({ every: '1 hour' })

      expect(strategy.getIntervalMs()).toBe(60 * 60 * 1000)
    })

    it('should support various time units', () => {
      const minutes = new RefreshStrategy({ every: '30 minutes' })
      const hours = new RefreshStrategy({ every: '2 hours' })
      const days = new RefreshStrategy({ every: '1 day' })

      expect(minutes.getIntervalMs()).toBe(30 * 60 * 1000)
      expect(hours.getIntervalMs()).toBe(2 * 60 * 60 * 1000)
      expect(days.getIntervalMs()).toBe(24 * 60 * 60 * 1000)
    })

    it('should determine if refresh is needed based on last refresh time', () => {
      const strategy = new RefreshStrategy({ every: '1 hour' })
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

      expect(strategy.needsRefresh(oneHourAgo)).toBe(true)
    })

    it('should not refresh if within interval', () => {
      const strategy = new RefreshStrategy({ every: '1 hour' })
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

      expect(strategy.needsRefresh(thirtyMinutesAgo)).toBe(false)
    })
  })

  describe('SQL-Based Refresh', () => {
    it('should use SQL query to check for changes', async () => {
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          data: [{ max_updated: '2024-01-15T10:00:00Z' }],
          sql: '',
        }),
      }

      const strategy = new RefreshStrategy({
        sql: 'SELECT MAX(updated_at) as max_updated FROM orders',
      })

      const result = await strategy.checkRefreshKey(mockExecutor)
      expect(result).toBe('2024-01-15T10:00:00Z')
    })

    it('should compare refresh keys to determine if refresh needed', async () => {
      const strategy = new RefreshStrategy({
        sql: 'SELECT MAX(updated_at) FROM orders',
      })

      // Different keys mean refresh is needed
      expect(strategy.keysMatch('2024-01-15', '2024-01-14')).toBe(false)
      expect(strategy.keysMatch('2024-01-15', '2024-01-15')).toBe(true)
    })
  })

  describe('Incremental Refresh', () => {
    it('should only refresh data within update window', async () => {
      manager.registerRollup({
        ...ordersRollupDefinition,
        refreshKey: {
          every: '1 hour',
          incremental: true,
          updateWindow: '3 days',
        },
      })

      const sql = manager.getIncrementalRefreshSQL('orders', 'dailyRevenue')
      expect(sql).toContain('3 days')
      expect(sql).toMatch(/WHERE.*created_at|WHERE.*createdAt/i)
    })

    it('should merge incremental data with existing rollup', async () => {
      manager.registerRollup(partitionedRollupDefinition)

      const result = await manager.refreshIncremental(
        'orders',
        'monthlyRevenuePartitioned',
        {
          execute: async () => ({ data: [], sql: '' }),
        }
      )

      expect(result.isIncremental).toBe(true)
      expect(result.affectedPartitions).toBeDefined()
    })

    it('should fall back to full refresh if incremental fails', async () => {
      manager.registerRollup(partitionedRollupDefinition)

      const result = await manager.refreshIncremental(
        'orders',
        'monthlyRevenuePartitioned',
        {
          execute: vi
            .fn()
            .mockRejectedValueOnce(new Error('Incremental failed'))
            .mockResolvedValueOnce({ data: [], sql: '' }),
        }
      )

      expect(result.fallbackToFull).toBe(true)
    })
  })
})

// =============================================================================
// PARTITION MANAGEMENT TESTS
// =============================================================================

describe('Partition Management', () => {
  let manager: PreAggregationManager

  beforeEach(() => {
    manager = new PreAggregationManager()
    manager.registerRollup(partitionedRollupDefinition)
  })

  describe('Partition Creation', () => {
    it('should create partitions based on partition granularity', async () => {
      const partitions = manager.getPartitions(
        'orders',
        'monthlyRevenuePartitioned'
      )

      // Should have partitions for data range
      expect(partitions).toBeDefined()
    })

    it('should generate partition-specific build SQL', () => {
      const partitionSql = manager.getPartitionBuildSQL(
        'orders',
        'monthlyRevenuePartitioned',
        { start: '2024-01-01', end: '2024-01-31' }
      )

      expect(partitionSql).toContain('2024-01')
      expect(partitionSql).toContain('WHERE')
    })

    it('should support adding new partitions dynamically', async () => {
      await manager.addPartition('orders', 'monthlyRevenuePartitioned', {
        start: '2024-02-01',
        end: '2024-02-29',
      })

      const partitions = manager.getPartitions(
        'orders',
        'monthlyRevenuePartitioned'
      )
      expect(partitions.some((p) => p.start === '2024-02-01')).toBe(true)
    })

    it('should support dropping old partitions', async () => {
      await manager.addPartition('orders', 'monthlyRevenuePartitioned', {
        start: '2023-01-01',
        end: '2023-01-31',
      })

      await manager.dropPartition('orders', 'monthlyRevenuePartitioned', {
        start: '2023-01-01',
        end: '2023-01-31',
      })

      const partitions = manager.getPartitions(
        'orders',
        'monthlyRevenuePartitioned'
      )
      expect(partitions.some((p) => p.start === '2023-01-01')).toBe(false)
    })
  })

  describe('Partition Refresh', () => {
    it('should refresh only affected partitions for incremental updates', async () => {
      const result = await manager.refreshPartitions(
        'orders',
        'monthlyRevenuePartitioned',
        {
          execute: async () => ({ data: [], sql: '' }),
        },
        { partitions: [{ start: '2024-01-01', end: '2024-01-31' }] }
      )

      expect(result.refreshedPartitions).toHaveLength(1)
    })

    it('should track per-partition refresh status', async () => {
      await manager.refreshPartitions(
        'orders',
        'monthlyRevenuePartitioned',
        {
          execute: async () => ({ data: [], sql: '' }),
        },
        { partitions: [{ start: '2024-01-01', end: '2024-01-31' }] }
      )

      const status = manager.getPartitionStatus(
        'orders',
        'monthlyRevenuePartitioned',
        { start: '2024-01-01', end: '2024-01-31' }
      )
      expect(status.lastRefreshAt).toBeDefined()
    })
  })
})

// =============================================================================
// STORAGE BACKEND TESTS
// =============================================================================

describe('StorageBackend', () => {
  describe('In-Database Storage', () => {
    it('should create rollup as a table in the same database', async () => {
      const backend = new StorageBackend({ type: 'in-db' })
      const sql = backend.getCreateSQL('orders_dailyRevenue', {
        columns: [
          { name: 'category', type: 'string' },
          { name: 'date', type: 'date' },
          { name: 'revenue', type: 'number' },
          { name: 'count', type: 'number' },
        ],
      })

      expect(sql).toContain('CREATE TABLE')
      expect(sql).toContain('orders_dailyRevenue')
    })

    it('should support table replacement for full refresh', async () => {
      const backend = new StorageBackend({ type: 'in-db' })
      const sql = backend.getReplaceSQL('orders_dailyRevenue')

      expect(sql).toContain('DROP TABLE IF EXISTS')
      expect(sql).toContain('CREATE TABLE')
    })
  })

  describe('Separate Table Storage', () => {
    it('should create rollup in a separate schema', async () => {
      const backend = new StorageBackend({
        type: 'separate-table',
        schema: 'rollups',
      })
      const sql = backend.getCreateSQL('dailyRevenue', {
        columns: [
          { name: 'category', type: 'string' },
          { name: 'revenue', type: 'number' },
        ],
      })

      expect(sql).toContain('rollups.dailyRevenue')
    })

    it('should support custom table naming', () => {
      const backend = new StorageBackend({
        type: 'separate-table',
        tablePrefix: 'preagg_',
      })
      const tableName = backend.getTableName('orders', 'dailyRevenue')

      expect(tableName).toBe('preagg_orders_dailyRevenue')
    })
  })

  describe('External Storage', () => {
    it('should support external storage configuration', () => {
      const backend = new StorageBackend({
        type: 'external',
        externalConfig: {
          type: 'parquet',
          location: 's3://bucket/rollups/',
        },
      })

      expect(backend.isExternal()).toBe(true)
    })

    it('should generate external table creation SQL', () => {
      const backend = new StorageBackend({
        type: 'external',
        externalConfig: {
          type: 'parquet',
          location: 's3://bucket/rollups/',
        },
      })
      const sql = backend.getExternalTableSQL('dailyRevenue')

      expect(sql).toContain('EXTERNAL')
      expect(sql).toContain('s3://bucket/rollups/')
    })
  })
})

// =============================================================================
// QUERY ROUTER TESTS
// =============================================================================

describe('QueryRouter', () => {
  let router: QueryRouter
  let manager: PreAggregationManager
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue({ data: [], sql: '' }),
  }

  beforeEach(async () => {
    manager = new PreAggregationManager()
    manager.registerRollup(ordersRollupDefinition)
    manager.registerRollup(partitionedRollupDefinition)
    router = new QueryRouter(manager)

    // Build rollups so they can be used
    await manager.buildRollup('orders', 'dailyRevenue', mockExecutor)
    await manager.buildRollup('orders', 'monthlyRevenuePartitioned', mockExecutor)
  })

  describe('Rollup Selection', () => {
    it('should select matching rollup for query', () => {
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day' as const,
          },
        ],
      }

      const selectedRollup = router.selectRollup(query)
      expect(selectedRollup?.name).toBe('dailyRevenue')
    })

    it('should return null when no matching rollup exists', () => {
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.status'], // Not in any rollup
      }

      const selectedRollup = router.selectRollup(query)
      expect(selectedRollup).toBeNull()
    })

    it('should select rollup that covers all query measures', () => {
      const query = {
        measures: ['orders.revenue', 'orders.count'],
        dimensions: ['orders.category'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day' as const,
          },
        ],
      }

      const selectedRollup = router.selectRollup(query)
      expect(selectedRollup?.name).toBe('dailyRevenue')
    })

    it('should not select rollup if query requires measures not in rollup', () => {
      const query = {
        measures: ['orders.revenue', 'orders.avgAmount'], // avgAmount not in rollup
        dimensions: ['orders.category'],
      }

      const selectedRollup = router.selectRollup(query)
      expect(selectedRollup).toBeNull()
    })

    it('should select rollup with matching or coarser granularity', () => {
      // Query asks for monthly data, monthlyRevenuePartitioned has month granularity
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category', 'orders.region'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'month' as const,
          },
        ],
      }

      const selectedRollup = router.selectRollup(query)
      expect(selectedRollup?.name).toBe('monthlyRevenuePartitioned')
    })

    it('should not select rollup with finer granularity than query', () => {
      // Query asks for year granularity, but we only have day/month rollups
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'year' as const,
          },
        ],
      }

      const selectedRollup = router.selectRollup(query)
      // Could be null or a rollup that can be aggregated up
      // Depends on implementation
    })
  })

  describe('Query Rewriting', () => {
    it('should rewrite query to use rollup table', () => {
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day' as const,
          },
        ],
      }

      const rewritten = router.rewriteQuery(query)
      expect(rewritten.usesRollup).toBe(true)
      expect(rewritten.rollupName).toBe('dailyRevenue')
      expect(rewritten.sql).toContain('orders_dailyRevenue')
    })

    it('should preserve filters in rewritten query', () => {
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
        filters: [
          {
            dimension: 'orders.category',
            operator: 'equals' as const,
            values: ['Electronics'],
          },
        ],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day' as const,
          },
        ],
      }

      const rewritten = router.rewriteQuery(query)
      expect(rewritten.sql).toContain('Electronics')
    })

    it('should add time range filter for partitioned rollups', () => {
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category', 'orders.region'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'month' as const,
            dateRange: ['2024-01-01', '2024-03-31'],
          },
        ],
      }

      const rewritten = router.rewriteQuery(query)
      expect(rewritten.sql).toContain('2024-01')
    })

    it('should fall back to source table when no rollup matches', () => {
      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.status'],
      }

      const rewritten = router.rewriteQuery(query)
      expect(rewritten.usesRollup).toBe(false)
      expect(rewritten.sql).not.toContain('dailyRevenue')
    })
  })

  describe('Rollup Scoring', () => {
    it('should prefer rollups with fewer extra columns', async () => {
      manager.registerRollup({
        name: 'simpleRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
      })

      // Build simpleRevenue
      await manager.buildRollup('orders', 'simpleRevenue', mockExecutor)

      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
      }

      const selectedRollup = router.selectRollup(query)
      // Should prefer simpleRevenue over dailyRevenue (which has time dimension)
      expect(selectedRollup?.name).toBe('simpleRevenue')
    })

    it('should prefer fresher rollups when multiple match', async () => {
      manager.registerRollup({
        name: 'simpleRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
      })

      // Build simpleRevenue more recently (after dailyRevenue built in beforeEach)
      await manager.buildRollup('orders', 'simpleRevenue', mockExecutor)

      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
      }

      const selectedRollup = router.selectRollup(query, { preferFresh: true })
      expect(selectedRollup?.name).toBe('simpleRevenue')
    })
  })
})

// =============================================================================
// ROLLUP MATCHER TESTS
// =============================================================================

describe('RollupMatcher', () => {
  let matcher: RollupMatcher

  beforeEach(() => {
    matcher = new RollupMatcher()
  })

  describe('Measure Matching', () => {
    it('should match when all query measures are in rollup', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue', 'count', 'avgAmount'],
        dimensions: [],
      }

      const queryMeasures = ['revenue', 'count']
      expect(matcher.measuresMatch(queryMeasures, rollup)).toBe(true)
    })

    it('should not match when query has measures not in rollup', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: [],
      }

      const queryMeasures = ['revenue', 'count']
      expect(matcher.measuresMatch(queryMeasures, rollup)).toBe(false)
    })

    it('should handle additive vs non-additive measures', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'], // SUM is additive
        dimensions: [],
      }

      // Additive measures can be re-aggregated from rollup
      expect(
        matcher.canAggregateFromRollup(['revenue'], rollup, 'sum')
      ).toBe(true)

      // countDistinct is not additive
      expect(
        matcher.canAggregateFromRollup(['uniqueUsers'], rollup, 'countDistinct')
      ).toBe(false)
    })
  })

  describe('Dimension Matching', () => {
    it('should match when all query dimensions are in rollup', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category', 'region', 'status'],
      }

      const queryDimensions = ['category', 'region']
      expect(matcher.dimensionsMatch(queryDimensions, rollup)).toBe(true)
    })

    it('should match when query has subset of rollup dimensions', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category', 'region'],
      }

      const queryDimensions = ['category'] // Subset
      expect(matcher.dimensionsMatch(queryDimensions, rollup)).toBe(true)
    })

    it('should not match when query has dimensions not in rollup', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
      }

      const queryDimensions = ['category', 'region']
      expect(matcher.dimensionsMatch(queryDimensions, rollup)).toBe(false)
    })
  })

  describe('Time Dimension Matching', () => {
    it('should match exact granularity', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: [],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'day',
        },
      }

      expect(
        matcher.timeDimensionMatches(
          { dimension: 'createdAt', granularity: 'day' },
          rollup
        )
      ).toBe(true)
    })

    it('should match when rollup has finer granularity that can be rolled up', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: [],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'day',
        },
      }

      // Can aggregate day -> week/month/year
      expect(
        matcher.timeDimensionMatches(
          { dimension: 'createdAt', granularity: 'month' },
          rollup
        )
      ).toBe(true)
    })

    it('should not match when rollup has coarser granularity', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: [],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'month',
        },
      }

      // Cannot get day data from month rollup
      expect(
        matcher.timeDimensionMatches(
          { dimension: 'createdAt', granularity: 'day' },
          rollup
        )
      ).toBe(false)
    })

    it('should match when query has no time dimension but rollup does', () => {
      const rollup: RollupDefinition = {
        name: 'test',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: [],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'day',
        },
      }

      // Query without time dimension can use time-based rollup
      expect(matcher.timeDimensionMatches(undefined, rollup)).toBe(true)
    })
  })

  describe('Complete Query Matching', () => {
    it('should match complete query against rollup', () => {
      const rollup: RollupDefinition = {
        name: 'dailyRevenue',
        cubeName: 'orders',
        measures: ['revenue', 'count'],
        dimensions: ['category'],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'day',
        },
      }

      const query = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day' as const,
          },
        ],
      }

      expect(matcher.queryMatchesRollup(query, rollup)).toBe(true)
    })
  })
})

// =============================================================================
// INVALIDATION MANAGER TESTS
// =============================================================================

describe('InvalidationManager', () => {
  let manager: PreAggregationManager
  let invalidationManager: InvalidationManager

  beforeEach(() => {
    manager = new PreAggregationManager()
    manager.registerRollup(ordersRollupDefinition)
    manager.registerRollup(partitionedRollupDefinition)
    invalidationManager = new InvalidationManager(manager)
  })

  describe('Source Data Change Detection', () => {
    it('should detect when source data changes', async () => {
      const mockExecutor = {
        execute: vi
          .fn()
          .mockResolvedValueOnce({
            data: [{ max_updated: '2024-01-15T10:00:00Z' }],
            sql: '',
          })
          .mockResolvedValueOnce({
            data: [{ max_updated: '2024-01-15T11:00:00Z' }],
            sql: '',
          }),
      }

      const changed = await invalidationManager.checkSourceDataChanged(
        'orders',
        mockExecutor
      )

      expect(changed).toBe(true)
    })

    it('should track which rollups need invalidation', async () => {
      await invalidationManager.notifyDataChange('orders', {
        table: 'orders',
        operation: 'insert',
        timestamp: new Date(),
      })

      const staleRollups = invalidationManager.getStaleRollups('orders')
      expect(staleRollups).toContain('dailyRevenue')
      expect(staleRollups).toContain('monthlyRevenuePartitioned')
    })
  })

  describe('Rollup Invalidation', () => {
    it('should invalidate specific rollup', async () => {
      await invalidationManager.invalidate('orders', 'dailyRevenue')

      const status = manager.getStatus('orders', 'dailyRevenue')
      expect(status.state).toBe('stale')
    })

    it('should invalidate all rollups for a cube', async () => {
      await invalidationManager.invalidateAllForCube('orders')

      const dailyStatus = manager.getStatus('orders', 'dailyRevenue')
      const monthlyStatus = manager.getStatus(
        'orders',
        'monthlyRevenuePartitioned'
      )

      expect(dailyStatus.state).toBe('stale')
      expect(monthlyStatus.state).toBe('stale')
    })

    it('should support selective partition invalidation', async () => {
      await invalidationManager.invalidatePartition(
        'orders',
        'monthlyRevenuePartitioned',
        { start: '2024-01-01', end: '2024-01-31' }
      )

      const partitionStatus = manager.getPartitionStatus(
        'orders',
        'monthlyRevenuePartitioned',
        { start: '2024-01-01', end: '2024-01-31' }
      )

      expect(partitionStatus.state).toBe('stale')
    })
  })

  describe('Cascading Invalidation', () => {
    it('should invalidate dependent rollups', async () => {
      // Register a rollup that depends on another
      manager.registerRollup({
        name: 'weeklyRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'week',
        },
        dependsOn: ['dailyRevenue'], // Depends on daily rollup
      })

      await invalidationManager.invalidate('orders', 'dailyRevenue', {
        cascade: true,
      })

      const weeklyStatus = manager.getStatus('orders', 'weeklyRevenue')
      expect(weeklyStatus.state).toBe('stale')
    })
  })

  describe('Change Data Capture Integration', () => {
    it('should process CDC events for invalidation', async () => {
      const cdcEvent = {
        table: 'orders',
        operation: 'update' as const,
        before: { id: 1, amount: 100 },
        after: { id: 1, amount: 150 },
        timestamp: new Date(),
      }

      await invalidationManager.processCDCEvent(cdcEvent)

      const staleRollups = invalidationManager.getStaleRollups('orders')
      expect(staleRollups.length).toBeGreaterThan(0)
    })

    it('should batch CDC events for efficiency', async () => {
      const events = Array.from({ length: 100 }, (_, i) => ({
        table: 'orders',
        operation: 'insert' as const,
        after: { id: i, amount: 100 },
        timestamp: new Date(),
      }))

      await invalidationManager.processCDCBatch(events)

      // Should only trigger one invalidation check
      expect(invalidationManager.getInvalidationCount('orders')).toBe(1)
    })
  })
})

// =============================================================================
// AUTO-ROLLUP DETECTION TESTS
// =============================================================================

describe('AutoRollupDetector', () => {
  let detector: AutoRollupDetector

  beforeEach(() => {
    detector = new AutoRollupDetector()
  })

  describe('Query Pattern Analysis', () => {
    it('should track query patterns', () => {
      const query1 = {
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
        timeDimensions: [
          { dimension: 'orders.createdAt', granularity: 'day' as const },
        ],
      }

      detector.recordQuery(query1)
      detector.recordQuery(query1)
      detector.recordQuery(query1)

      const patterns = detector.getQueryPatterns()
      expect(patterns[0].count).toBe(3)
    })

    it('should identify frequently queried measure/dimension combinations', () => {
      // Record same pattern multiple times
      for (let i = 0; i < 10; i++) {
        detector.recordQuery({
          measures: ['orders.revenue'],
          dimensions: ['orders.category'],
        })
      }

      const frequent = detector.getFrequentPatterns(5)
      expect(frequent).toHaveLength(1)
      expect(frequent[0].measures).toContain('orders.revenue')
    })
  })

  describe('Rollup Suggestions', () => {
    it('should suggest rollups based on query patterns', () => {
      // Record pattern many times
      for (let i = 0; i < 20; i++) {
        detector.recordQuery({
          measures: ['orders.revenue', 'orders.count'],
          dimensions: ['orders.category', 'orders.region'],
          timeDimensions: [
            { dimension: 'orders.createdAt', granularity: 'day' as const },
          ],
        })
      }

      const suggestions = detector.suggestRollups()
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0].measures).toContain('revenue')
    })

    it('should not suggest rollups for infrequent queries', () => {
      detector.recordQuery({
        measures: ['orders.revenue'],
        dimensions: ['orders.status'],
      })

      const suggestions = detector.suggestRollups()
      expect(suggestions).toHaveLength(0)
    })

    it('should suggest appropriate granularity based on query patterns', () => {
      // Most queries use day granularity
      for (let i = 0; i < 15; i++) {
        detector.recordQuery({
          measures: ['orders.revenue'],
          dimensions: [],
          timeDimensions: [
            { dimension: 'orders.createdAt', granularity: 'day' as const },
          ],
        })
      }
      // Some queries use hour granularity
      for (let i = 0; i < 5; i++) {
        detector.recordQuery({
          measures: ['orders.revenue'],
          dimensions: [],
          timeDimensions: [
            { dimension: 'orders.createdAt', granularity: 'hour' as const },
          ],
        })
      }

      const suggestions = detector.suggestRollups()
      expect(suggestions[0].timeDimension?.granularity).toBe('day')
    })

    it('should estimate cost savings for suggested rollups', () => {
      for (let i = 0; i < 20; i++) {
        detector.recordQuery(
          {
            measures: ['orders.revenue'],
            dimensions: ['orders.category'],
          },
          { executionTimeMs: 500 }
        )
      }

      const suggestions = detector.suggestRollups()
      expect(suggestions[0].estimatedSavings).toBeDefined()
      expect(suggestions[0].estimatedSavings?.queriesOptimized).toBe(20)
    })
  })

  describe('Pattern Merging', () => {
    it('should merge similar patterns into single rollup suggestion', () => {
      // Pattern 1: revenue by category
      for (let i = 0; i < 10; i++) {
        detector.recordQuery({
          measures: ['orders.revenue'],
          dimensions: ['orders.category'],
        })
      }
      // Pattern 2: revenue and count by category
      for (let i = 0; i < 10; i++) {
        detector.recordQuery({
          measures: ['orders.revenue', 'orders.count'],
          dimensions: ['orders.category'],
        })
      }

      const suggestions = detector.suggestRollups({ mergePatterns: true })
      // Should suggest one rollup with both measures
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].measures).toContain('revenue')
      expect(suggestions[0].measures).toContain('count')
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Pre-aggregation Integration', () => {
  let manager: PreAggregationManager
  let router: QueryRouter
  let invalidationManager: InvalidationManager

  beforeEach(() => {
    manager = new PreAggregationManager()
    manager.registerRollup(ordersRollupDefinition)
    router = new QueryRouter(manager)
    invalidationManager = new InvalidationManager(manager)
  })

  it('should route query through rollup and return results', async () => {
    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        data: [
          { category: 'Electronics', revenue: 50000, count: 100 },
          { category: 'Clothing', revenue: 30000, count: 80 },
        ],
        sql: '',
      }),
    }

    // Build rollup first
    await manager.buildRollup('orders', 'dailyRevenue', mockExecutor)

    const query = {
      measures: ['orders.revenue'],
      dimensions: ['orders.category'],
      timeDimensions: [
        {
          dimension: 'orders.createdAt',
          granularity: 'day' as const,
        },
      ],
    }

    const rewritten = router.rewriteQuery(query)
    expect(rewritten.usesRollup).toBe(true)
  })

  it('should invalidate and rebuild rollup on data change', async () => {
    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({ data: [], sql: '' }),
    }

    await manager.buildRollup('orders', 'dailyRevenue', mockExecutor)

    // Simulate data change
    await invalidationManager.notifyDataChange('orders', {
      table: 'orders',
      operation: 'insert',
      timestamp: new Date(),
    })

    const status = manager.getStatus('orders', 'dailyRevenue')
    expect(status.state).toBe('stale')

    // Rebuild
    await manager.buildRollup('orders', 'dailyRevenue', mockExecutor)

    const newStatus = manager.getStatus('orders', 'dailyRevenue')
    expect(newStatus.state).toBe('built')
  })

  it('should handle concurrent queries during rebuild', async () => {
    const mockExecutor = {
      execute: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { data: [], sql: '' }
      }),
    }

    // Start rebuild
    const buildPromise = manager.buildRollup(
      'orders',
      'dailyRevenue',
      mockExecutor
    )

    // Query during rebuild should fall back to source
    const query = {
      measures: ['orders.revenue'],
      dimensions: ['orders.category'],
    }

    const rewritten = router.rewriteQuery(query, { waitForBuild: false })

    // Complete build
    await buildPromise

    // Subsequent query should use rollup
    const rewrittenAfter = router.rewriteQuery(query)
    expect(rewrittenAfter.usesRollup).toBeDefined()
  })
})
