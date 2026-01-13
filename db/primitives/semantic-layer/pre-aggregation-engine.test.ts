/**
 * Pre-aggregation Engine Tests (RED Phase)
 *
 * Tests for the Cube.js-style pre-aggregation engine with:
 * - Refresh scheduling and job management
 * - Materialization strategies (eager, lazy, lambda)
 * - Cost-based pre-aggregation selection
 * - Lambda architecture (real-time + batch)
 * - Multi-tenant isolation
 * - Rollup dependencies and cascading refresh
 * - External pre-aggregation storage
 *
 * @see dotdo-dxds1
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { QueryExecutor, QueryResult, Granularity } from './index'

// =============================================================================
// TYPE DEFINITIONS FOR NEW ENGINE FEATURES
// =============================================================================

/**
 * Pre-aggregation job status
 */
interface PreAggregationJob {
  id: string
  cubeName: string
  preAggregationName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  scheduledAt: Date
  startedAt?: Date
  completedAt?: Date
  partitions?: { start: string; end: string }[]
  error?: string
  rowsProcessed?: number
  bytesWritten?: number
}

/**
 * Refresh schedule configuration
 */
interface RefreshScheduleConfig {
  every: string
  timezone?: string
  concurrency?: number
  waitForJobsToComplete?: boolean
}

/**
 * Materialization strategy
 */
type MaterializationStrategy = 'eager' | 'lazy' | 'lambda' | 'streaming'

/**
 * Pre-aggregation with strategy configuration
 */
interface StrategicPreAggregation {
  name: string
  cubeName: string
  measures: string[]
  dimensions: string[]
  timeDimension?: {
    dimension: string
    granularity: Granularity
  }
  strategy: MaterializationStrategy
  refreshKey?: {
    every?: string
    sql?: string
    incremental?: boolean
    updateWindow?: string
  }
  lambdaConfig?: {
    batchWindow: string
    realTimeThreshold: string
    mergeStrategy: 'union' | 'dedupe'
  }
  externalStorage?: {
    type: 'iceberg' | 'delta' | 'parquet'
    location: string
    partitioning?: string[]
  }
}

/**
 * Cost estimate for pre-aggregation selection
 */
interface CostEstimate {
  scanCost: number
  networkCost: number
  computeCost: number
  totalCost: number
  estimatedRowsScanned: number
  estimatedBytesScanned: number
  usesPreAggregation: boolean
  preAggregationName?: string
}

/**
 * Tenant isolation configuration
 */
interface TenantIsolationConfig {
  mode: 'shared' | 'dedicated' | 'hybrid'
  tenantColumn?: string
  dedicatedTenants?: string[]
}

// =============================================================================
// STUB CLASSES - These need to be implemented
// =============================================================================

/**
 * PreAggregationScheduler - Manages refresh jobs
 */
class PreAggregationScheduler {
  scheduleRefresh(_cubeName: string, _preAggName: string, _config: RefreshScheduleConfig): string {
    throw new Error('Not implemented')
  }

  cancelJob(_jobId: string): boolean {
    throw new Error('Not implemented')
  }

  getJobStatus(_jobId: string): PreAggregationJob | undefined {
    throw new Error('Not implemented')
  }

  listPendingJobs(): PreAggregationJob[] {
    throw new Error('Not implemented')
  }

  listRunningJobs(): PreAggregationJob[] {
    throw new Error('Not implemented')
  }

  async waitForJob(_jobId: string, _timeoutMs?: number): Promise<PreAggregationJob> {
    throw new Error('Not implemented')
  }

  pauseScheduler(): void {
    throw new Error('Not implemented')
  }

  resumeScheduler(): void {
    throw new Error('Not implemented')
  }

  isPaused(): boolean {
    throw new Error('Not implemented')
  }
}

/**
 * PreAggregationEngine - Main engine for pre-aggregation management
 */
class PreAggregationEngine {
  private scheduler: PreAggregationScheduler

  constructor(_config?: { executor?: QueryExecutor; tenantConfig?: TenantIsolationConfig }) {
    this.scheduler = new PreAggregationScheduler()
  }

  registerPreAggregation(_preAgg: StrategicPreAggregation): void {
    throw new Error('Not implemented')
  }

  getPreAggregation(_cubeName: string, _name: string): StrategicPreAggregation | undefined {
    throw new Error('Not implemented')
  }

  listPreAggregations(_cubeName?: string): StrategicPreAggregation[] {
    throw new Error('Not implemented')
  }

  estimateCost(_query: { measures: string[]; dimensions?: string[] }): CostEstimate {
    throw new Error('Not implemented')
  }

  selectOptimalPreAggregation(_query: { measures: string[]; dimensions?: string[] }): StrategicPreAggregation | null {
    throw new Error('Not implemented')
  }

  async buildPreAggregation(
    _cubeName: string,
    _name: string,
    _options?: { force?: boolean; partitions?: { start: string; end: string }[] }
  ): Promise<{ success: boolean; rowsProcessed?: number; error?: string }> {
    throw new Error('Not implemented')
  }

  async refreshLambdaLayer(
    _cubeName: string,
    _name: string
  ): Promise<{ batchRowCount: number; realTimeRowCount: number; merged: boolean }> {
    throw new Error('Not implemented')
  }

  getScheduler(): PreAggregationScheduler {
    return this.scheduler
  }

  setTenantContext(_tenantId: string): void {
    throw new Error('Not implemented')
  }

  clearTenantContext(): void {
    throw new Error('Not implemented')
  }

  getDependencyGraph(_cubeName: string): Map<string, string[]> {
    throw new Error('Not implemented')
  }

  async cascadeRefresh(
    _cubeName: string,
    _name: string
  ): Promise<{ refreshed: string[]; errors: { name: string; error: string }[] }> {
    throw new Error('Not implemented')
  }
}

// =============================================================================
// REFRESH SCHEDULING TESTS
// =============================================================================

describe('PreAggregationScheduler', () => {
  let scheduler: PreAggregationScheduler

  beforeEach(() => {
    scheduler = new PreAggregationScheduler()
  })

  describe('Job Scheduling', () => {
    it('should schedule a refresh job and return job ID', () => {
      const config: RefreshScheduleConfig = {
        every: '1 hour',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)

      expect(jobId).toBeDefined()
      expect(typeof jobId).toBe('string')
      expect(jobId.length).toBeGreaterThan(0)
    })

    it('should schedule job with timezone configuration', () => {
      const config: RefreshScheduleConfig = {
        every: '1 day',
        timezone: 'America/New_York',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      const job = scheduler.getJobStatus(jobId)

      expect(job).toBeDefined()
      expect(job?.cubeName).toBe('orders')
      expect(job?.preAggregationName).toBe('dailyRevenue')
    })

    it('should respect concurrency limits', () => {
      const config: RefreshScheduleConfig = {
        every: '30 minutes',
        concurrency: 2,
      }

      // Schedule multiple jobs
      scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      scheduler.scheduleRefresh('orders', 'weeklyRevenue', config)
      scheduler.scheduleRefresh('orders', 'monthlyRevenue', config)

      // Only 2 should be running (concurrency limit)
      const runningJobs = scheduler.listRunningJobs()
      expect(runningJobs.length).toBeLessThanOrEqual(2)
    })

    it('should queue jobs when concurrency limit reached', () => {
      const config: RefreshScheduleConfig = {
        every: '30 minutes',
        concurrency: 1,
      }

      scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      scheduler.scheduleRefresh('orders', 'weeklyRevenue', config)

      const pendingJobs = scheduler.listPendingJobs()
      expect(pendingJobs.length).toBeGreaterThan(0)
    })
  })

  describe('Job Lifecycle', () => {
    it('should track job from pending to completed', async () => {
      const config: RefreshScheduleConfig = {
        every: '1 hour',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)

      // Initially should be pending or running
      let job = scheduler.getJobStatus(jobId)
      expect(['pending', 'running']).toContain(job?.status)

      // Wait for completion
      job = await scheduler.waitForJob(jobId, 5000)
      expect(job.status).toBe('completed')
      expect(job.completedAt).toBeDefined()
    })

    it('should capture job metrics on completion', async () => {
      const config: RefreshScheduleConfig = {
        every: '1 hour',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      const job = await scheduler.waitForJob(jobId, 5000)

      expect(job.rowsProcessed).toBeDefined()
      expect(job.rowsProcessed).toBeGreaterThanOrEqual(0)
      expect(job.bytesWritten).toBeDefined()
    })

    it('should capture error details on failure', async () => {
      const config: RefreshScheduleConfig = {
        every: '1 hour',
      }

      // Simulate a job that will fail
      const jobId = scheduler.scheduleRefresh('nonexistent_cube', 'dailyRevenue', config)
      const job = await scheduler.waitForJob(jobId, 5000)

      expect(job.status).toBe('failed')
      expect(job.error).toBeDefined()
      expect(job.error?.length).toBeGreaterThan(0)
    })
  })

  describe('Job Cancellation', () => {
    it('should cancel a pending job', () => {
      const config: RefreshScheduleConfig = {
        every: '1 hour',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      const cancelled = scheduler.cancelJob(jobId)

      expect(cancelled).toBe(true)

      const job = scheduler.getJobStatus(jobId)
      expect(job?.status).toBe('cancelled')
    })

    it('should return false when cancelling non-existent job', () => {
      const cancelled = scheduler.cancelJob('non-existent-job-id')
      expect(cancelled).toBe(false)
    })

    it('should not cancel already completed job', async () => {
      const config: RefreshScheduleConfig = {
        every: '1 hour',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      await scheduler.waitForJob(jobId, 5000)

      const cancelled = scheduler.cancelJob(jobId)
      expect(cancelled).toBe(false)
    })
  })

  describe('Scheduler Control', () => {
    it('should pause scheduler', () => {
      scheduler.pauseScheduler()
      expect(scheduler.isPaused()).toBe(true)
    })

    it('should resume scheduler', () => {
      scheduler.pauseScheduler()
      scheduler.resumeScheduler()
      expect(scheduler.isPaused()).toBe(false)
    })

    it('should not start new jobs when paused', () => {
      scheduler.pauseScheduler()

      const config: RefreshScheduleConfig = {
        every: '1 minute',
      }

      const jobId = scheduler.scheduleRefresh('orders', 'dailyRevenue', config)
      const job = scheduler.getJobStatus(jobId)

      expect(job?.status).toBe('pending')
      expect(scheduler.listRunningJobs()).toHaveLength(0)
    })
  })
})

// =============================================================================
// MATERIALIZATION STRATEGY TESTS
// =============================================================================

describe('Materialization Strategies', () => {
  let engine: PreAggregationEngine

  beforeEach(() => {
    engine = new PreAggregationEngine()
  })

  describe('Eager Materialization', () => {
    it('should immediately build pre-aggregation on registration', async () => {
      const preAgg: StrategicPreAggregation = {
        name: 'dailyRevenue',
        cubeName: 'orders',
        measures: ['revenue', 'count'],
        dimensions: ['category'],
        strategy: 'eager',
        timeDimension: {
          dimension: 'createdAt',
          granularity: 'day',
        },
      }

      engine.registerPreAggregation(preAgg)

      // Eager strategy should trigger immediate build
      const result = await engine.buildPreAggregation('orders', 'dailyRevenue')
      expect(result.success).toBe(true)
    })

    it('should auto-refresh on schedule for eager strategy', async () => {
      const preAgg: StrategicPreAggregation = {
        name: 'hourlyMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: [],
        strategy: 'eager',
        refreshKey: {
          every: '1 hour',
        },
      }

      engine.registerPreAggregation(preAgg)

      // Check scheduler has job
      const scheduler = engine.getScheduler()
      const runningJobs = scheduler.listRunningJobs()
      const pendingJobs = scheduler.listPendingJobs()

      expect(runningJobs.length + pendingJobs.length).toBeGreaterThan(0)
    })
  })

  describe('Lazy Materialization', () => {
    it('should not build pre-aggregation until first query', () => {
      const preAgg: StrategicPreAggregation = {
        name: 'weeklyStats',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['region'],
        strategy: 'lazy',
      }

      engine.registerPreAggregation(preAgg)

      // Should not be built yet
      const costEstimate = engine.estimateCost({
        measures: ['orders.revenue'],
        dimensions: ['orders.region'],
      })

      // Lazy strategy means pre-agg exists but not materialized
      expect(costEstimate.usesPreAggregation).toBe(true)
      // But actual data is not yet built
    })

    it('should build on first matching query', async () => {
      const preAgg: StrategicPreAggregation = {
        name: 'weeklyStats',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['region'],
        strategy: 'lazy',
      }

      engine.registerPreAggregation(preAgg)

      // Trigger build via cost estimation (simulating query)
      engine.selectOptimalPreAggregation({
        measures: ['orders.revenue'],
        dimensions: ['orders.region'],
      })

      // Now it should be building or built
      const scheduler = engine.getScheduler()
      const jobs = [...scheduler.listRunningJobs(), ...scheduler.listPendingJobs()]
      expect(jobs.some(j => j.preAggregationName === 'weeklyStats')).toBe(true)
    })
  })

  describe('Lambda Architecture', () => {
    it('should maintain separate batch and real-time layers', () => {
      const preAgg: StrategicPreAggregation = {
        name: 'realtimeMetrics',
        cubeName: 'events',
        measures: ['count', 'uniqueUsers'],
        dimensions: ['eventType'],
        strategy: 'lambda',
        lambdaConfig: {
          batchWindow: '1 hour',
          realTimeThreshold: '5 minutes',
          mergeStrategy: 'union',
        },
      }

      engine.registerPreAggregation(preAgg)

      const registeredPreAgg = engine.getPreAggregation('events', 'realtimeMetrics')
      expect(registeredPreAgg?.strategy).toBe('lambda')
      expect(registeredPreAgg?.lambdaConfig).toBeDefined()
    })

    it('should merge batch and real-time layers', async () => {
      const preAgg: StrategicPreAggregation = {
        name: 'realtimeMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: ['eventType'],
        strategy: 'lambda',
        lambdaConfig: {
          batchWindow: '1 hour',
          realTimeThreshold: '5 minutes',
          mergeStrategy: 'union',
        },
      }

      engine.registerPreAggregation(preAgg)

      const result = await engine.refreshLambdaLayer('events', 'realtimeMetrics')

      expect(result.batchRowCount).toBeDefined()
      expect(result.realTimeRowCount).toBeDefined()
      expect(result.merged).toBe(true)
    })

    it('should dedupe overlapping data between layers', async () => {
      const preAgg: StrategicPreAggregation = {
        name: 'dedupeMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: ['eventId'],
        strategy: 'lambda',
        lambdaConfig: {
          batchWindow: '1 hour',
          realTimeThreshold: '5 minutes',
          mergeStrategy: 'dedupe',
        },
      }

      engine.registerPreAggregation(preAgg)

      const result = await engine.refreshLambdaLayer('events', 'dedupeMetrics')

      // Dedupe should result in merged data without duplicates
      expect(result.merged).toBe(true)
    })
  })

  describe('Streaming Materialization', () => {
    it('should support streaming pre-aggregation strategy', () => {
      const preAgg: StrategicPreAggregation = {
        name: 'streamingMetrics',
        cubeName: 'clickstream',
        measures: ['count', 'uniqueVisitors'],
        dimensions: ['pageUrl'],
        strategy: 'streaming',
      }

      engine.registerPreAggregation(preAgg)

      const registeredPreAgg = engine.getPreAggregation('clickstream', 'streamingMetrics')
      expect(registeredPreAgg?.strategy).toBe('streaming')
    })
  })
})

// =============================================================================
// COST-BASED OPTIMIZATION TESTS
// =============================================================================

describe('Cost-Based Optimization', () => {
  let engine: PreAggregationEngine

  beforeEach(() => {
    engine = new PreAggregationEngine()

    // Register multiple pre-aggregations with different characteristics
    engine.registerPreAggregation({
      name: 'dailyByCategory',
      cubeName: 'orders',
      measures: ['revenue', 'count'],
      dimensions: ['category'],
      timeDimension: { dimension: 'createdAt', granularity: 'day' },
      strategy: 'eager',
    })

    engine.registerPreAggregation({
      name: 'hourlyByRegion',
      cubeName: 'orders',
      measures: ['revenue'],
      dimensions: ['region'],
      timeDimension: { dimension: 'createdAt', granularity: 'hour' },
      strategy: 'eager',
    })

    engine.registerPreAggregation({
      name: 'monthlyTotal',
      cubeName: 'orders',
      measures: ['revenue', 'count', 'avgAmount'],
      dimensions: [],
      timeDimension: { dimension: 'createdAt', granularity: 'month' },
      strategy: 'eager',
    })
  })

  describe('Cost Estimation', () => {
    it('should estimate cost for query without pre-aggregation', () => {
      const estimate = engine.estimateCost({
        measures: ['orders.profit'], // Not in any pre-agg
        dimensions: ['orders.status'],
      })

      expect(estimate.usesPreAggregation).toBe(false)
      expect(estimate.totalCost).toBeGreaterThan(0)
      expect(estimate.scanCost).toBeGreaterThan(0)
    })

    it('should estimate lower cost when using pre-aggregation', () => {
      const withoutPreAgg = engine.estimateCost({
        measures: ['orders.revenue'],
        dimensions: ['orders.category', 'orders.status'], // status not in pre-agg
      })

      const withPreAgg = engine.estimateCost({
        measures: ['orders.revenue'],
        dimensions: ['orders.category'], // matches dailyByCategory
      })

      expect(withPreAgg.totalCost).toBeLessThan(withoutPreAgg.totalCost)
      expect(withPreAgg.usesPreAggregation).toBe(true)
      expect(withPreAgg.preAggregationName).toBe('dailyByCategory')
    })

    it('should include network and compute costs in estimate', () => {
      const estimate = engine.estimateCost({
        measures: ['orders.revenue'],
        dimensions: ['orders.category'],
      })

      expect(estimate.scanCost).toBeDefined()
      expect(estimate.networkCost).toBeDefined()
      expect(estimate.computeCost).toBeDefined()
      expect(estimate.totalCost).toBe(
        estimate.scanCost + estimate.networkCost + estimate.computeCost
      )
    })

    it('should estimate row and byte counts', () => {
      const estimate = engine.estimateCost({
        measures: ['orders.revenue', 'orders.count'],
        dimensions: [],
      })

      expect(estimate.estimatedRowsScanned).toBeGreaterThan(0)
      expect(estimate.estimatedBytesScanned).toBeGreaterThan(0)
    })
  })

  describe('Optimal Pre-aggregation Selection', () => {
    it('should select pre-aggregation with lowest cost', () => {
      const selected = engine.selectOptimalPreAggregation({
        measures: ['orders.revenue'],
        dimensions: [], // matches monthlyTotal (smallest)
      })

      expect(selected).not.toBeNull()
      expect(selected?.name).toBe('monthlyTotal')
    })

    it('should return null when no pre-aggregation matches', () => {
      const selected = engine.selectOptimalPreAggregation({
        measures: ['orders.profit'], // Not in any pre-agg
        dimensions: ['orders.customerId'],
      })

      expect(selected).toBeNull()
    })

    it('should prefer smaller pre-aggregation when multiple match', () => {
      const selected = engine.selectOptimalPreAggregation({
        measures: ['orders.revenue'],
        dimensions: [],
      })

      // monthlyTotal has no dimensions, so it's smaller than dailyByCategory
      expect(selected?.name).toBe('monthlyTotal')
    })

    it('should consider granularity compatibility', () => {
      const selected = engine.selectOptimalPreAggregation({
        measures: ['orders.revenue'],
        dimensions: ['orders.region'],
      })

      // hourlyByRegion matches region dimension
      expect(selected?.name).toBe('hourlyByRegion')
    })
  })
})

// =============================================================================
// MULTI-TENANT ISOLATION TESTS
// =============================================================================

describe('Multi-Tenant Isolation', () => {
  let engine: PreAggregationEngine

  describe('Shared Mode', () => {
    beforeEach(() => {
      engine = new PreAggregationEngine({
        tenantConfig: {
          mode: 'shared',
          tenantColumn: 'tenant_id',
        },
      })

      engine.registerPreAggregation({
        name: 'dailyRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        strategy: 'eager',
      })
    })

    it('should filter pre-aggregation data by tenant', () => {
      engine.setTenantContext('tenant-123')

      const preAgg = engine.getPreAggregation('orders', 'dailyRevenue')
      // In shared mode, pre-agg should include tenant filter
      expect(preAgg).toBeDefined()
    })

    it('should share pre-aggregation storage across tenants', () => {
      engine.setTenantContext('tenant-123')
      const preAggs1 = engine.listPreAggregations('orders')

      engine.setTenantContext('tenant-456')
      const preAggs2 = engine.listPreAggregations('orders')

      // Same pre-aggregation definitions shared
      expect(preAggs1.length).toBe(preAggs2.length)
      expect(preAggs1[0].name).toBe(preAggs2[0].name)
    })
  })

  describe('Dedicated Mode', () => {
    beforeEach(() => {
      engine = new PreAggregationEngine({
        tenantConfig: {
          mode: 'dedicated',
        },
      })

      engine.setTenantContext('tenant-123')
      engine.registerPreAggregation({
        name: 'dailyRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        strategy: 'eager',
      })
    })

    it('should isolate pre-aggregations per tenant', () => {
      engine.setTenantContext('tenant-456')
      const preAggs = engine.listPreAggregations('orders')

      // Different tenant should not see other tenant's pre-aggs
      expect(preAggs).toHaveLength(0)
    })

    it('should build separate pre-aggregation tables per tenant', async () => {
      engine.setTenantContext('tenant-123')
      const result1 = await engine.buildPreAggregation('orders', 'dailyRevenue')

      engine.setTenantContext('tenant-456')
      engine.registerPreAggregation({
        name: 'dailyRevenue',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        strategy: 'eager',
      })
      const result2 = await engine.buildPreAggregation('orders', 'dailyRevenue')

      // Both should succeed independently
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
    })
  })

  describe('Hybrid Mode', () => {
    beforeEach(() => {
      engine = new PreAggregationEngine({
        tenantConfig: {
          mode: 'hybrid',
          tenantColumn: 'tenant_id',
          dedicatedTenants: ['enterprise-1', 'enterprise-2'],
        },
      })
    })

    it('should use dedicated storage for specified tenants', () => {
      engine.setTenantContext('enterprise-1')
      engine.registerPreAggregation({
        name: 'premiumStats',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        strategy: 'eager',
      })

      const preAgg = engine.getPreAggregation('orders', 'premiumStats')
      expect(preAgg).toBeDefined()
    })

    it('should use shared storage for non-dedicated tenants', () => {
      engine.setTenantContext('small-tenant')
      engine.registerPreAggregation({
        name: 'basicStats',
        cubeName: 'orders',
        measures: ['count'],
        dimensions: [],
        strategy: 'lazy',
      })

      engine.setTenantContext('another-small-tenant')
      // In shared mode, the pre-agg definition is accessible
      // (though data is filtered by tenant)
    })
  })
})

// =============================================================================
// DEPENDENCY GRAPH AND CASCADE REFRESH TESTS
// =============================================================================

describe('Dependency Graph and Cascade Refresh', () => {
  let engine: PreAggregationEngine

  beforeEach(() => {
    engine = new PreAggregationEngine()

    // Set up pre-aggregations with dependencies
    // hourly -> daily -> weekly -> monthly
    engine.registerPreAggregation({
      name: 'hourlyMetrics',
      cubeName: 'events',
      measures: ['count'],
      dimensions: ['eventType'],
      timeDimension: { dimension: 'timestamp', granularity: 'hour' },
      strategy: 'eager',
    })

    engine.registerPreAggregation({
      name: 'dailyMetrics',
      cubeName: 'events',
      measures: ['count'],
      dimensions: ['eventType'],
      timeDimension: { dimension: 'timestamp', granularity: 'day' },
      strategy: 'eager',
      // Depends on hourlyMetrics for incremental updates
    })

    engine.registerPreAggregation({
      name: 'weeklyMetrics',
      cubeName: 'events',
      measures: ['count'],
      dimensions: ['eventType'],
      timeDimension: { dimension: 'timestamp', granularity: 'week' },
      strategy: 'lazy',
    })
  })

  describe('Dependency Graph', () => {
    it('should build dependency graph from granularity hierarchy', () => {
      const graph = engine.getDependencyGraph('events')

      expect(graph).toBeDefined()
      expect(graph.size).toBeGreaterThan(0)
    })

    it('should identify downstream dependencies', () => {
      const graph = engine.getDependencyGraph('events')

      // hourlyMetrics should have dailyMetrics as dependent
      const hourlyDeps = graph.get('hourlyMetrics')
      expect(hourlyDeps).toContain('dailyMetrics')
    })

    it('should identify transitive dependencies', () => {
      const graph = engine.getDependencyGraph('events')

      // hourlyMetrics -> dailyMetrics -> weeklyMetrics
      const dailyDeps = graph.get('dailyMetrics')
      expect(dailyDeps).toContain('weeklyMetrics')
    })
  })

  describe('Cascade Refresh', () => {
    it('should refresh all downstream pre-aggregations', async () => {
      const result = await engine.cascadeRefresh('events', 'hourlyMetrics')

      expect(result.refreshed).toContain('hourlyMetrics')
      expect(result.refreshed).toContain('dailyMetrics')
      expect(result.refreshed).toContain('weeklyMetrics')
    })

    it('should collect errors from failed cascades', async () => {
      // Register a pre-agg that will fail
      engine.registerPreAggregation({
        name: 'brokenMetrics',
        cubeName: 'events',
        measures: ['nonexistent'],
        dimensions: [],
        strategy: 'eager',
      })

      const result = await engine.cascadeRefresh('events', 'hourlyMetrics')

      expect(result.errors).toBeDefined()
      // Should still succeed for valid pre-aggs
      expect(result.refreshed).toContain('dailyMetrics')
    })

    it('should respect refresh order (dependencies first)', async () => {
      const result = await engine.cascadeRefresh('events', 'hourlyMetrics')

      // hourlyMetrics should be before dailyMetrics in the refreshed list
      const hourlyIdx = result.refreshed.indexOf('hourlyMetrics')
      const dailyIdx = result.refreshed.indexOf('dailyMetrics')

      expect(hourlyIdx).toBeLessThan(dailyIdx)
    })
  })
})

// =============================================================================
// EXTERNAL STORAGE TESTS
// =============================================================================

describe('External Pre-aggregation Storage', () => {
  let engine: PreAggregationEngine

  beforeEach(() => {
    engine = new PreAggregationEngine()
  })

  describe('Iceberg Storage', () => {
    it('should support Iceberg table format', () => {
      const preAgg: StrategicPreAggregation = {
        name: 'archiveMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: ['eventType'],
        strategy: 'eager',
        externalStorage: {
          type: 'iceberg',
          location: 's3://bucket/iceberg/events/',
          partitioning: ['eventType', 'date'],
        },
      }

      engine.registerPreAggregation(preAgg)

      const registered = engine.getPreAggregation('events', 'archiveMetrics')
      expect(registered?.externalStorage?.type).toBe('iceberg')
    })

    it('should build pre-aggregation to Iceberg table', async () => {
      engine.registerPreAggregation({
        name: 'icebergMetrics',
        cubeName: 'orders',
        measures: ['revenue'],
        dimensions: ['category'],
        strategy: 'eager',
        externalStorage: {
          type: 'iceberg',
          location: 's3://bucket/iceberg/orders/',
        },
      })

      const result = await engine.buildPreAggregation('orders', 'icebergMetrics')

      expect(result.success).toBe(true)
    })
  })

  describe('Delta Storage', () => {
    it('should support Delta Lake format', () => {
      const preAgg: StrategicPreAggregation = {
        name: 'deltaMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: ['region'],
        strategy: 'eager',
        externalStorage: {
          type: 'delta',
          location: 's3://bucket/delta/events/',
        },
      }

      engine.registerPreAggregation(preAgg)

      const registered = engine.getPreAggregation('events', 'deltaMetrics')
      expect(registered?.externalStorage?.type).toBe('delta')
    })
  })

  describe('Parquet Storage', () => {
    it('should support Parquet file format', () => {
      const preAgg: StrategicPreAggregation = {
        name: 'parquetMetrics',
        cubeName: 'events',
        measures: ['count'],
        dimensions: ['country'],
        strategy: 'eager',
        externalStorage: {
          type: 'parquet',
          location: 's3://bucket/parquet/events/',
          partitioning: ['country'],
        },
      }

      engine.registerPreAggregation(preAgg)

      const registered = engine.getPreAggregation('events', 'parquetMetrics')
      expect(registered?.externalStorage?.type).toBe('parquet')
      expect(registered?.externalStorage?.partitioning).toContain('country')
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Pre-aggregation Engine Integration', () => {
  let engine: PreAggregationEngine
  let mockExecutor: QueryExecutor

  beforeEach(() => {
    mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        data: [],
        sql: 'SELECT ...',
      }),
    }

    engine = new PreAggregationEngine({ executor: mockExecutor })
  })

  it('should execute full lifecycle: register, build, query, refresh', async () => {
    // 1. Register
    engine.registerPreAggregation({
      name: 'fullLifecycle',
      cubeName: 'orders',
      measures: ['revenue', 'count'],
      dimensions: ['category'],
      strategy: 'eager',
      refreshKey: {
        every: '1 hour',
      },
    })

    // 2. Build
    const buildResult = await engine.buildPreAggregation('orders', 'fullLifecycle')
    expect(buildResult.success).toBe(true)

    // 3. Query (cost estimation)
    const estimate = engine.estimateCost({
      measures: ['orders.revenue'],
      dimensions: ['orders.category'],
    })
    expect(estimate.usesPreAggregation).toBe(true)

    // 4. Refresh
    const scheduler = engine.getScheduler()
    const jobs = scheduler.listPendingJobs()
    expect(jobs.some(j => j.preAggregationName === 'fullLifecycle')).toBe(true)
  })

  it('should handle concurrent operations safely', async () => {
    engine.registerPreAggregation({
      name: 'concurrentTest',
      cubeName: 'orders',
      measures: ['revenue'],
      dimensions: [],
      strategy: 'eager',
    })

    // Run multiple operations concurrently
    const operations = [
      engine.buildPreAggregation('orders', 'concurrentTest'),
      engine.buildPreAggregation('orders', 'concurrentTest', { force: true }),
      engine.estimateCost({ measures: ['orders.revenue'] }),
    ]

    const results = await Promise.allSettled(operations)

    // At least the cost estimation should succeed
    expect(results.some(r => r.status === 'fulfilled')).toBe(true)
  })

  it('should handle partition-aware refresh', async () => {
    engine.registerPreAggregation({
      name: 'partitionedMetrics',
      cubeName: 'events',
      measures: ['count'],
      dimensions: ['eventType'],
      timeDimension: { dimension: 'timestamp', granularity: 'day' },
      strategy: 'eager',
    })

    // Build specific partitions
    const result = await engine.buildPreAggregation('events', 'partitionedMetrics', {
      partitions: [
        { start: '2024-01-01', end: '2024-01-31' },
        { start: '2024-02-01', end: '2024-02-29' },
      ],
    })

    expect(result.success).toBe(true)
  })
})
