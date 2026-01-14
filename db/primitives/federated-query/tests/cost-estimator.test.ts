/**
 * Cost-Based Source Selection Tests
 *
 * TDD tests for cost-based optimization when selecting sources:
 * - CostEstimator: Estimates query cost per source
 * - SourceSelector: Selects optimal source when data is replicated
 * - PerformanceTracker: Tracks historical performance for cost estimation
 *
 * @see dotdo-70jpo
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  CostEstimator,
  SourceSelector,
  PerformanceTracker,
  type CostEstimate,
  type SourceCostConfig,
  type PerformanceMetrics,
  type SourceHealth,
} from '../cost-estimator'

import {
  Catalog,
  createMemoryAdapter,
  type DataSource,
  type SourceStatistics,
  type TableStats,
  type QueryFragment,
} from '../index'

// =============================================================================
// CostEstimator Tests
// =============================================================================

describe('CostEstimator', () => {
  let catalog: Catalog
  let estimator: CostEstimator

  beforeEach(() => {
    catalog = new Catalog()

    // Register multiple sources
    catalog.registerSource({ name: 'local_db', type: 'sqlite', config: {} })
    catalog.registerSource({ name: 'remote_db', type: 'postgres', config: {} })
    catalog.registerSource({ name: 'edge_cache', type: 'memory', config: {} })

    // Register statistics
    catalog.registerStatistics('local_db', {
      tables: {
        users: { rowCount: 10000, sizeBytes: 5_000_000 },
        orders: { rowCount: 100000, sizeBytes: 50_000_000 },
      },
    })

    catalog.registerStatistics('remote_db', {
      tables: {
        users: { rowCount: 10000, sizeBytes: 5_000_000 },
        orders: { rowCount: 100000, sizeBytes: 50_000_000 },
      },
    })

    catalog.registerStatistics('edge_cache', {
      tables: {
        users: { rowCount: 10000, sizeBytes: 5_000_000 },
      },
    })

    estimator = new CostEstimator(catalog)
  })

  describe('basic cost estimation', () => {
    it('should estimate query cost for a source', () => {
      const query: QueryFragment = {
        table: 'users',
        columns: ['id', 'name'],
      }

      const cost = estimator.estimate('local_db', query)

      expect(cost).toBeDefined()
      expect(cost.totalCost).toBeGreaterThan(0)
      expect(cost.scanCost).toBeGreaterThan(0)
      expect(cost.networkCost).toBeGreaterThanOrEqual(0)
      expect(cost.estimatedRows).toBe(10000)
      expect(cost.estimatedBytes).toBeGreaterThan(0)
    })

    it('should factor in predicate selectivity', () => {
      const fullScan: QueryFragment = {
        table: 'users',
      }

      const filteredQuery: QueryFragment = {
        table: 'users',
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const fullCost = estimator.estimate('local_db', fullScan)
      const filteredCost = estimator.estimate('local_db', filteredQuery)

      // Filtered query should have lower cost due to selectivity
      expect(filteredCost.estimatedRows).toBeLessThan(fullCost.estimatedRows)
      expect(filteredCost.totalCost).toBeLessThan(fullCost.totalCost)
    })

    it('should apply different selectivity for different operators', () => {
      const equalityQuery: QueryFragment = {
        table: 'users',
        predicates: [{ column: 'id', op: '=', value: 1 }],
      }

      const rangeQuery: QueryFragment = {
        table: 'users',
        predicates: [{ column: 'age', op: '>', value: 21 }],
      }

      const equalityCost = estimator.estimate('local_db', equalityQuery)
      const rangeCost = estimator.estimate('local_db', rangeQuery)

      // Equality predicate should be more selective than range
      expect(equalityCost.estimatedRows).toBeLessThan(rangeCost.estimatedRows)
    })

    it('should consider projection for byte estimation', () => {
      const allColumns: QueryFragment = {
        table: 'users',
      }

      const fewColumns: QueryFragment = {
        table: 'users',
        columns: ['id'],
      }

      const allCost = estimator.estimate('local_db', allColumns)
      const fewCost = estimator.estimate('local_db', fewColumns)

      expect(fewCost.estimatedBytes).toBeLessThan(allCost.estimatedBytes)
    })
  })

  describe('network cost estimation', () => {
    it('should add network cost for remote sources', () => {
      estimator.configure('remote_db', {
        latencyMs: 50,
        bandwidthMBps: 100,
        isLocal: false,
      })

      estimator.configure('local_db', {
        latencyMs: 1,
        bandwidthMBps: 1000,
        isLocal: true,
      })

      const query: QueryFragment = {
        table: 'users',
      }

      const remoteCost = estimator.estimate('remote_db', query)
      const localCost = estimator.estimate('local_db', query)

      expect(remoteCost.networkCost).toBeGreaterThan(localCost.networkCost)
      expect(remoteCost.latencyMs).toBeGreaterThan(localCost.latencyMs)
    })

    it('should calculate transfer time based on data size', () => {
      estimator.configure('remote_db', {
        latencyMs: 10,
        bandwidthMBps: 10, // 10 MB/s
        isLocal: false,
      })

      const query: QueryFragment = {
        table: 'orders', // 50MB table
      }

      const cost = estimator.estimate('remote_db', query)

      // 50MB at 10MB/s = 5 seconds = 5000ms transfer time
      expect(cost.transferTimeMs).toBeGreaterThanOrEqual(4000)
      expect(cost.transferTimeMs).toBeLessThanOrEqual(6000)
    })
  })

  describe('throughput estimation', () => {
    it('should estimate throughput based on source type', () => {
      const query: QueryFragment = {
        table: 'users',
      }

      estimator.configure('local_db', { throughputRowsPerSec: 1_000_000 })
      estimator.configure('remote_db', { throughputRowsPerSec: 100_000 })

      const localCost = estimator.estimate('local_db', query)
      const remoteCost = estimator.estimate('remote_db', query)

      expect(localCost.scanTimeMs).toBeLessThan(remoteCost.scanTimeMs)
    })
  })

  describe('cost with limit', () => {
    it('should reduce cost when limit is specified', () => {
      const fullQuery: QueryFragment = {
        table: 'users',
      }

      const limitedQuery: QueryFragment = {
        table: 'users',
        limit: 100,
      }

      const fullCost = estimator.estimate('local_db', fullQuery)
      const limitedCost = estimator.estimate('local_db', limitedQuery)

      expect(limitedCost.estimatedRows).toBe(100)
      expect(limitedCost.totalCost).toBeLessThan(fullCost.totalCost)
    })
  })

  describe('missing statistics handling', () => {
    it('should use defaults when statistics are missing', () => {
      catalog.registerSource({ name: 'unknown_db', type: 'memory', config: {} })
      catalog.attachAdapter('unknown_db', createMemoryAdapter({}))

      const query: QueryFragment = {
        table: 'missing_table',
      }

      const cost = estimator.estimate('unknown_db', query)

      // Should return a reasonable default estimate
      expect(cost).toBeDefined()
      expect(cost.estimatedRows).toBeGreaterThan(0)
      expect(cost.totalCost).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// SourceSelector Tests
// =============================================================================

describe('SourceSelector', () => {
  let catalog: Catalog
  let estimator: CostEstimator
  let selector: SourceSelector

  beforeEach(() => {
    catalog = new Catalog()

    // Create replicated data scenario: users table in 3 sources
    catalog.registerSource({ name: 'primary_db', type: 'postgres', config: {} })
    catalog.registerSource({ name: 'replica_db', type: 'postgres', config: {} })
    catalog.registerSource({ name: 'edge_cache', type: 'memory', config: {} })

    // Same data, different performance characteristics
    const usersStats: TableStats = { rowCount: 10000, sizeBytes: 5_000_000 }

    catalog.registerStatistics('primary_db', { tables: { users: usersStats } })
    catalog.registerStatistics('replica_db', { tables: { users: usersStats } })
    catalog.registerStatistics('edge_cache', { tables: { users: usersStats } })

    estimator = new CostEstimator(catalog)
    selector = new SourceSelector(catalog, estimator)
  })

  describe('optimal source selection', () => {
    it('should select source with lowest cost', () => {
      // Configure different costs
      estimator.configure('primary_db', {
        latencyMs: 50,
        bandwidthMBps: 100,
        isLocal: false,
        throughputRowsPerSec: 500_000,
      })

      estimator.configure('replica_db', {
        latencyMs: 20,
        bandwidthMBps: 200,
        isLocal: false,
        throughputRowsPerSec: 500_000,
      })

      estimator.configure('edge_cache', {
        latencyMs: 1,
        bandwidthMBps: 1000,
        isLocal: true,
        throughputRowsPerSec: 2_000_000,
      })

      const query: QueryFragment = {
        table: 'users',
      }

      const selected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      expect(selected.source).toBe('edge_cache')
      expect(selected.cost).toBeDefined()
      expect(selected.alternatives).toHaveLength(2)
    })

    it('should rank alternatives by cost', () => {
      estimator.configure('primary_db', { latencyMs: 100 })
      estimator.configure('replica_db', { latencyMs: 50 })
      estimator.configure('edge_cache', { latencyMs: 10 })

      const query: QueryFragment = { table: 'users' }

      const selected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      // Alternatives should be sorted by cost ascending
      expect(selected.alternatives[0]?.source).toBe('replica_db')
      expect(selected.alternatives[1]?.source).toBe('primary_db')
    })
  })

  describe('source health awareness', () => {
    it('should skip unhealthy sources', () => {
      selector.setSourceHealth('edge_cache', {
        healthy: false,
        lastError: 'Connection refused',
        lastErrorTime: Date.now(),
      })

      const query: QueryFragment = { table: 'users' }

      const selected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      // Should not select unhealthy source even if it would be cheapest
      expect(selected.source).not.toBe('edge_cache')
    })

    it('should track source health status', () => {
      selector.setSourceHealth('primary_db', {
        healthy: true,
        consecutiveSuccesses: 10,
        avgResponseTimeMs: 45,
      })

      const health = selector.getSourceHealth('primary_db')

      expect(health.healthy).toBe(true)
      expect(health.consecutiveSuccesses).toBe(10)
    })

    it('should consider degraded sources with penalty', () => {
      // Primary has better latency
      estimator.configure('primary_db', { latencyMs: 10, isLocal: true })
      estimator.configure('replica_db', { latencyMs: 50, isLocal: false })

      // But primary is degraded (high error rate)
      selector.setSourceHealth('primary_db', {
        healthy: true,
        degraded: true,
        errorRate: 0.1, // 10% error rate
      })

      selector.setSourceHealth('replica_db', {
        healthy: true,
        degraded: false,
        errorRate: 0,
      })

      const query: QueryFragment = { table: 'users' }

      const selected = selector.selectSource(['primary_db', 'replica_db'], query)

      // Degraded penalty should make replica preferred
      expect(selected.source).toBe('replica_db')
    })
  })

  describe('load balancing', () => {
    it('should distribute load when costs are similar', () => {
      // Configure similar costs
      estimator.configure('primary_db', { latencyMs: 10 })
      estimator.configure('replica_db', { latencyMs: 11 }) // 10% difference

      const query: QueryFragment = { table: 'users' }

      // Enable load balancing with threshold
      selector.enableLoadBalancing({ costDifferenceThreshold: 0.2 })

      const selections: string[] = []
      for (let i = 0; i < 100; i++) {
        const selected = selector.selectSource(['primary_db', 'replica_db'], query)
        selections.push(selected.source)
      }

      const primaryCount = selections.filter((s) => s === 'primary_db').length
      const replicaCount = selections.filter((s) => s === 'replica_db').length

      // Should distribute load somewhat evenly (not all to one source)
      expect(primaryCount).toBeGreaterThan(20)
      expect(replicaCount).toBeGreaterThan(20)
    })

    it('should prefer lower cost when difference exceeds threshold', () => {
      // Configure significantly different costs
      estimator.configure('primary_db', { latencyMs: 10 })
      estimator.configure('replica_db', { latencyMs: 100 }) // 10x difference

      const query: QueryFragment = { table: 'users' }

      selector.enableLoadBalancing({ costDifferenceThreshold: 0.2 })

      const selections: string[] = []
      for (let i = 0; i < 100; i++) {
        const selected = selector.selectSource(['primary_db', 'replica_db'], query)
        selections.push(selected.source)
      }

      // Should almost always select lower cost source
      const primaryCount = selections.filter((s) => s === 'primary_db').length
      expect(primaryCount).toBeGreaterThan(90)
    })
  })

  describe('failover behavior', () => {
    it('should return alternatives for failover', () => {
      const query: QueryFragment = { table: 'users' }

      const selected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      expect(selected.alternatives).toBeDefined()
      expect(selected.alternatives.length).toBe(2)
    })

    it('should suggest failover source when primary fails', () => {
      const query: QueryFragment = { table: 'users' }

      const selected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      // Simulate primary failure
      selector.recordFailure(selected.source)

      // Get new selection
      const newSelected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      // Should prefer different source after failure
      expect(newSelected.source).not.toBe(selected.source)
    })
  })

  describe('table availability', () => {
    it('should only consider sources that have the table', () => {
      // edge_cache doesn't have orders table
      catalog.registerStatistics('primary_db', {
        tables: {
          users: { rowCount: 10000, sizeBytes: 5_000_000 },
          orders: { rowCount: 100000, sizeBytes: 50_000_000 },
        },
      })

      const query: QueryFragment = { table: 'orders' }

      const selected = selector.selectSource(
        ['primary_db', 'replica_db', 'edge_cache'],
        query
      )

      // Should only consider sources with the orders table
      expect(['primary_db', 'replica_db']).toContain(selected.source)
    })

    it('should throw when no sources have the table', () => {
      const query: QueryFragment = { table: 'nonexistent' }

      expect(() =>
        selector.selectSource(['primary_db', 'replica_db'], query)
      ).toThrow('No available sources for table: nonexistent')
    })
  })
})

// =============================================================================
// PerformanceTracker Tests
// =============================================================================

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker

  beforeEach(() => {
    tracker = new PerformanceTracker()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('recording metrics', () => {
    it('should record query execution metrics', () => {
      tracker.recordExecution('primary_db', 'users', {
        durationMs: 45,
        rowsReturned: 100,
        bytesTransferred: 50000,
        success: true,
      })

      const metrics = tracker.getMetrics('primary_db', 'users')

      expect(metrics).toBeDefined()
      expect(metrics.totalExecutions).toBe(1)
      expect(metrics.avgDurationMs).toBe(45)
      expect(metrics.successRate).toBe(1)
    })

    it('should compute rolling averages', () => {
      // Record multiple executions
      tracker.recordExecution('primary_db', 'users', { durationMs: 40, success: true })
      tracker.recordExecution('primary_db', 'users', { durationMs: 50, success: true })
      tracker.recordExecution('primary_db', 'users', { durationMs: 60, success: true })

      const metrics = tracker.getMetrics('primary_db', 'users')

      expect(metrics.avgDurationMs).toBe(50) // (40+50+60)/3
      expect(metrics.totalExecutions).toBe(3)
    })

    it('should track success rate', () => {
      tracker.recordExecution('primary_db', 'users', { durationMs: 40, success: true })
      tracker.recordExecution('primary_db', 'users', { durationMs: 50, success: false })
      tracker.recordExecution('primary_db', 'users', { durationMs: 60, success: true })
      tracker.recordExecution('primary_db', 'users', { durationMs: 70, success: true })

      const metrics = tracker.getMetrics('primary_db', 'users')

      expect(metrics.successRate).toBe(0.75) // 3/4
    })

    it('should track percentiles', () => {
      // Record varying response times
      for (let i = 1; i <= 100; i++) {
        tracker.recordExecution('primary_db', 'users', {
          durationMs: i * 10,
          success: true,
        })
      }

      const metrics = tracker.getMetrics('primary_db', 'users')

      expect(metrics.p50DurationMs).toBeCloseTo(500, -1) // 50th percentile
      expect(metrics.p95DurationMs).toBeCloseTo(950, -1) // 95th percentile
      expect(metrics.p99DurationMs).toBeCloseTo(990, -1) // 99th percentile
    })
  })

  describe('time-based metrics', () => {
    it('should weight recent data more heavily', () => {
      // Old data
      tracker.recordExecution('primary_db', 'users', { durationMs: 100, success: true })

      // Advance time
      vi.advanceTimersByTime(60 * 60 * 1000) // 1 hour

      // Recent data with better performance
      tracker.recordExecution('primary_db', 'users', { durationMs: 20, success: true })

      const metrics = tracker.getMetrics('primary_db', 'users', {
        recentBias: true,
        windowMs: 30 * 60 * 1000, // 30 min window
      })

      // Recent data should dominate
      expect(metrics.avgDurationMs).toBeLessThan(50)
    })

    it('should expire old data', () => {
      tracker.recordExecution('primary_db', 'users', { durationMs: 100, success: true })

      // Advance past retention period
      vi.advanceTimersByTime(25 * 60 * 60 * 1000) // 25 hours

      tracker.pruneOldData(24 * 60 * 60 * 1000) // 24 hour retention

      const metrics = tracker.getMetrics('primary_db', 'users')

      expect(metrics.totalExecutions).toBe(0)
    })
  })

  describe('trend detection', () => {
    it('should detect performance degradation', () => {
      // Good performance initially
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('primary_db', 'users', { durationMs: 50, success: true })
      }

      vi.advanceTimersByTime(60 * 1000) // 1 minute

      // Performance degrades
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('primary_db', 'users', { durationMs: 200, success: true })
      }

      const trend = tracker.getTrend('primary_db', 'users')

      expect(trend.direction).toBe('degrading')
      expect(trend.percentChange).toBeGreaterThan(100) // >100% increase
    })

    it('should detect performance improvement', () => {
      // Poor performance initially
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('primary_db', 'users', { durationMs: 200, success: true })
      }

      vi.advanceTimersByTime(60 * 1000)

      // Performance improves
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('primary_db', 'users', { durationMs: 50, success: true })
      }

      const trend = tracker.getTrend('primary_db', 'users')

      expect(trend.direction).toBe('improving')
    })

    it('should detect stable performance', () => {
      for (let i = 0; i < 20; i++) {
        tracker.recordExecution('primary_db', 'users', {
          durationMs: 50 + (Math.random() - 0.5) * 10, // 45-55ms
          success: true,
        })
      }

      const trend = tracker.getTrend('primary_db', 'users')

      expect(trend.direction).toBe('stable')
    })
  })

  describe('source comparison', () => {
    it('should compare performance across sources', () => {
      // Primary is faster
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('primary_db', 'users', { durationMs: 30, success: true })
      }

      // Replica is slower
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('replica_db', 'users', { durationMs: 60, success: true })
      }

      const comparison = tracker.comparePerformance('users', [
        'primary_db',
        'replica_db',
      ])

      expect(comparison.fastest).toBe('primary_db')
      expect(comparison.ranking).toEqual(['primary_db', 'replica_db'])
      expect(comparison.speedupRatio).toBeCloseTo(2, 1) // 2x faster
    })

    it('should factor in reliability for comparison', () => {
      // Primary is faster but unreliable
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('primary_db', 'users', {
          durationMs: 30,
          success: i % 2 === 0, // 50% success rate
        })
      }

      // Replica is slower but reliable
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution('replica_db', 'users', {
          durationMs: 60,
          success: true,
        })
      }

      const comparison = tracker.comparePerformance('users', ['primary_db', 'replica_db'], {
        includeReliability: true,
      })

      // Replica should rank higher when reliability is considered
      expect(comparison.ranking[0]).toBe('replica_db')
    })
  })

  describe('anomaly detection', () => {
    it('should detect sudden latency spikes', () => {
      // Normal behavior
      for (let i = 0; i < 50; i++) {
        tracker.recordExecution('primary_db', 'users', { durationMs: 50, success: true })
      }

      // Sudden spike
      tracker.recordExecution('primary_db', 'users', { durationMs: 500, success: true })

      const anomaly = tracker.detectAnomaly('primary_db', 'users', 500)

      expect(anomaly.isAnomaly).toBe(true)
      expect(anomaly.type).toBe('latency_spike')
      expect(anomaly.deviationsFromMean).toBeGreaterThan(3)
    })

    it('should not flag normal variation as anomaly', () => {
      for (let i = 0; i < 50; i++) {
        tracker.recordExecution('primary_db', 'users', {
          durationMs: 50 + (Math.random() - 0.5) * 20,
          success: true,
        })
      }

      const anomaly = tracker.detectAnomaly('primary_db', 'users', 55)

      expect(anomaly.isAnomaly).toBe(false)
    })
  })

  describe('persistence', () => {
    it('should export metrics for storage', () => {
      tracker.recordExecution('primary_db', 'users', { durationMs: 50, success: true })
      tracker.recordExecution('replica_db', 'orders', { durationMs: 100, success: true })

      const exported = tracker.export()

      expect(exported).toHaveProperty('primary_db')
      expect(exported).toHaveProperty('replica_db')
      expect(exported.primary_db.users).toBeDefined()
    })

    it('should import metrics from storage', () => {
      const data = {
        primary_db: {
          users: {
            samples: [{ durationMs: 50, success: true, timestamp: Date.now() }],
          },
        },
      }

      tracker.import(data)

      const metrics = tracker.getMetrics('primary_db', 'users')

      expect(metrics.totalExecutions).toBe(1)
      expect(metrics.avgDurationMs).toBe(50)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Cost-Based Source Selection Integration', () => {
  let catalog: Catalog
  let estimator: CostEstimator
  let selector: SourceSelector
  let tracker: PerformanceTracker

  beforeEach(() => {
    catalog = new Catalog()
    tracker = new PerformanceTracker()

    // Setup replicated data across multiple sources
    catalog.registerSource({ name: 'us_west', type: 'postgres', config: { region: 'us-west-2' } })
    catalog.registerSource({ name: 'us_east', type: 'postgres', config: { region: 'us-east-1' } })
    catalog.registerSource({ name: 'eu_west', type: 'postgres', config: { region: 'eu-west-1' } })

    const usersStats: TableStats = { rowCount: 100000, sizeBytes: 50_000_000 }

    catalog.registerStatistics('us_west', { tables: { users: usersStats } })
    catalog.registerStatistics('us_east', { tables: { users: usersStats } })
    catalog.registerStatistics('eu_west', { tables: { users: usersStats } })

    estimator = new CostEstimator(catalog, { performanceTracker: tracker })
    selector = new SourceSelector(catalog, estimator)

    // Configure source costs based on "distance"
    estimator.configure('us_west', {
      latencyMs: 10,
      bandwidthMBps: 500,
      isLocal: true,
    })

    estimator.configure('us_east', {
      latencyMs: 40,
      bandwidthMBps: 200,
      isLocal: false,
    })

    estimator.configure('eu_west', {
      latencyMs: 100,
      bandwidthMBps: 100,
      isLocal: false,
    })
  })

  it('should select closest region for user query', () => {
    const query: QueryFragment = {
      table: 'users',
      predicates: [{ column: 'status', op: '=', value: 'active' }],
    }

    const selected = selector.selectSource(['us_west', 'us_east', 'eu_west'], query)

    expect(selected.source).toBe('us_west')
  })

  it('should adapt selection based on historical performance', () => {
    // Record that us_west is actually slow despite low configured latency
    for (let i = 0; i < 20; i++) {
      tracker.recordExecution('us_west', 'users', { durationMs: 200, success: true })
    }

    for (let i = 0; i < 20; i++) {
      tracker.recordExecution('us_east', 'users', { durationMs: 45, success: true })
    }

    const query: QueryFragment = { table: 'users' }

    // Re-create estimator to pick up tracker data
    const adaptiveEstimator = new CostEstimator(catalog, {
      performanceTracker: tracker,
      useHistoricalData: true,
    })
    const adaptiveSelector = new SourceSelector(catalog, adaptiveEstimator)

    const selected = adaptiveSelector.selectSource(['us_west', 'us_east', 'eu_west'], query)

    // Should adapt based on actual observed performance
    expect(selected.source).toBe('us_east')
  })

  it('should handle source failure with automatic failover', () => {
    const query: QueryFragment = { table: 'users' }

    // Get initial selection
    const initial = selector.selectSource(['us_west', 'us_east', 'eu_west'], query)
    expect(initial.source).toBe('us_west')

    // Simulate failures
    selector.recordFailure('us_west')
    selector.recordFailure('us_west')
    selector.recordFailure('us_west')

    // Should failover to next best source
    const afterFailures = selector.selectSource(['us_west', 'us_east', 'eu_west'], query)
    expect(afterFailures.source).toBe('us_east')
  })

  it('should provide full cost breakdown for monitoring', () => {
    const query: QueryFragment = {
      table: 'users',
      predicates: [{ column: 'status', op: '=', value: 'active' }],
      limit: 1000,
    }

    const selected = selector.selectSource(['us_west', 'us_east', 'eu_west'], query)

    expect(selected.cost.breakdown).toBeDefined()
    expect(selected.cost.breakdown.scanCost).toBeGreaterThan(0)
    expect(selected.cost.breakdown.networkCost).toBeGreaterThanOrEqual(0)
    expect(selected.cost.breakdown.latencyMs).toBeDefined()
    expect(selected.cost.breakdown.estimatedDurationMs).toBeDefined()
  })
})
