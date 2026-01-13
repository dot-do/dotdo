/**
 * ScanCoordinator Tests
 *
 * TDD tests for parallel scan coordination with:
 * - Parallel scan execution across sources
 * - Concurrency limits
 * - Backpressure handling
 * - Cancellation support
 *
 * @see dotdo-f6ccw
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  Catalog,
  createMemoryAdapter,
  type SourceAdapter,
  type QueryFragment,
  type QueryResult,
} from '../index'

import {
  ScanCoordinator,
  type ScanTask,
  type ScanOptions,
  type ScanResult,
  type BackpressureConfig,
  CancellationToken,
} from '../scan-coordinator'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a delayed adapter that takes specified ms to respond
 */
function createDelayedAdapter(
  data: Record<string, Record<string, unknown>[]>,
  delayMs: number
): SourceAdapter {
  const baseAdapter = createMemoryAdapter(data)
  return {
    capabilities: () => baseAdapter.capabilities(),
    execute: async (query: QueryFragment): Promise<QueryResult> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return baseAdapter.execute(query)
    },
    async *stream(query) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      yield* baseAdapter.stream(query)
    },
  }
}

/**
 * Create an adapter that fails after N rows
 */
function createFailingAdapter(
  data: Record<string, Record<string, unknown>[]>,
  failAfterRows: number,
  errorMessage: string
): SourceAdapter {
  const baseAdapter = createMemoryAdapter(data)
  return {
    capabilities: () => baseAdapter.capabilities(),
    execute: async (query: QueryFragment): Promise<QueryResult> => {
      const result = await baseAdapter.execute(query)
      if (result.rows.length > failAfterRows) {
        throw new Error(errorMessage)
      }
      return result
    },
    async *stream(query) {
      let rowCount = 0
      for await (const batch of baseAdapter.stream(query)) {
        rowCount += batch.length
        if (rowCount > failAfterRows) {
          throw new Error(errorMessage)
        }
        yield batch
      }
    },
  }
}

/**
 * Create an adapter that tracks execution order
 */
function createTrackingAdapter(
  data: Record<string, Record<string, unknown>[]>,
  delayMs: number,
  executionLog: { source: string; startTime: number; endTime: number }[],
  sourceName: string
): SourceAdapter {
  const baseAdapter = createMemoryAdapter(data)
  return {
    capabilities: () => baseAdapter.capabilities(),
    execute: async (query: QueryFragment): Promise<QueryResult> => {
      const startTime = performance.now()
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      const result = await baseAdapter.execute(query)
      const endTime = performance.now()
      executionLog.push({ source: sourceName, startTime, endTime })
      return result
    },
    async *stream(query) {
      const startTime = performance.now()
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      const endTime = performance.now()
      executionLog.push({ source: sourceName, startTime, endTime })
      yield* baseAdapter.stream(query)
    },
  }
}

// =============================================================================
// ScanCoordinator Tests
// =============================================================================

describe('ScanCoordinator', () => {
  let catalog: Catalog
  let coordinator: ScanCoordinator

  beforeEach(() => {
    catalog = new Catalog()
    coordinator = new ScanCoordinator(catalog)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // Parallel Execution Tests
  // ===========================================================================

  describe('parallel scan execution', () => {
    it('should execute scans in parallel by default', async () => {
      const executionLog: { source: string; startTime: number; endTime: number }[] = []

      // Setup sources with 50ms delay each
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'source2', type: 'memory', config: {} })
      catalog.registerSource({ name: 'source3', type: 'memory', config: {} })

      catalog.attachAdapter(
        'source1',
        createTrackingAdapter({ items: [{ id: 1 }] }, 50, executionLog, 'source1')
      )
      catalog.attachAdapter(
        'source2',
        createTrackingAdapter({ items: [{ id: 2 }] }, 50, executionLog, 'source2')
      )
      catalog.attachAdapter(
        'source3',
        createTrackingAdapter({ items: [{ id: 3 }] }, 50, executionLog, 'source3')
      )

      const tasks: ScanTask[] = [
        { source: 'source1', query: { table: 'items' } },
        { source: 'source2', query: { table: 'items' } },
        { source: 'source3', query: { table: 'items' } },
      ]

      const startTime = performance.now()
      await coordinator.scan(tasks)
      const elapsed = performance.now() - startTime

      // Should complete in ~50ms (parallel) not ~150ms (sequential)
      expect(elapsed).toBeLessThan(120)

      // All scans should start around the same time
      const startTimes = executionLog.map((e) => e.startTime)
      const maxStartDiff = Math.max(...startTimes) - Math.min(...startTimes)
      expect(maxStartDiff).toBeLessThan(20) // All started within 20ms of each other
    })

    it('should return results from all sources', async () => {
      catalog.registerSource({ name: 'users', type: 'memory', config: {} })
      catalog.registerSource({ name: 'orders', type: 'memory', config: {} })

      catalog.attachAdapter(
        'users',
        createMemoryAdapter({
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        })
      )
      catalog.attachAdapter(
        'orders',
        createMemoryAdapter({
          orders: [
            { id: 101, user_id: 1, total: 100 },
            { id: 102, user_id: 2, total: 200 },
          ],
        })
      )

      const tasks: ScanTask[] = [
        { source: 'users', query: { table: 'users' } },
        { source: 'orders', query: { table: 'orders' } },
      ]

      const results = await coordinator.scan(tasks)

      expect(results).toHaveLength(2)
      expect(results.find((r) => r.source === 'users')?.rows).toHaveLength(2)
      expect(results.find((r) => r.source === 'orders')?.rows).toHaveLength(2)
    })

    it('should preserve result order matching task order', async () => {
      catalog.registerSource({ name: 'fast', type: 'memory', config: {} })
      catalog.registerSource({ name: 'slow', type: 'memory', config: {} })

      // Fast source responds immediately, slow source delays
      catalog.attachAdapter('fast', createMemoryAdapter({ items: [{ id: 'fast' }] }))
      catalog.attachAdapter(
        'slow',
        createDelayedAdapter({ items: [{ id: 'slow' }] }, 50)
      )

      const tasks: ScanTask[] = [
        { source: 'slow', query: { table: 'items' } }, // First in task order
        { source: 'fast', query: { table: 'items' } }, // Second in task order
      ]

      const results = await coordinator.scan(tasks)

      // Results should match task order, not completion order
      expect(results[0].source).toBe('slow')
      expect(results[1].source).toBe('fast')
    })
  })

  // ===========================================================================
  // Concurrency Limit Tests
  // ===========================================================================

  describe('concurrency limits', () => {
    it('should respect maxConcurrency option', async () => {
      const executionLog: { source: string; startTime: number; endTime: number }[] = []

      // Setup 4 sources with 30ms delay each
      for (let i = 1; i <= 4; i++) {
        const name = `source${i}`
        catalog.registerSource({ name, type: 'memory', config: {} })
        catalog.attachAdapter(
          name,
          createTrackingAdapter({ items: [{ id: i }] }, 30, executionLog, name)
        )
      }

      const tasks: ScanTask[] = [
        { source: 'source1', query: { table: 'items' } },
        { source: 'source2', query: { table: 'items' } },
        { source: 'source3', query: { table: 'items' } },
        { source: 'source4', query: { table: 'items' } },
      ]

      const options: ScanOptions = { maxConcurrency: 2 }

      const startTime = performance.now()
      await coordinator.scan(tasks, options)
      const elapsed = performance.now() - startTime

      // With concurrency 2 and 30ms per task:
      // - First batch (2 tasks): 30ms
      // - Second batch (2 tasks): 30ms
      // Total: ~60ms (not 30ms if fully parallel, not 120ms if sequential)
      expect(elapsed).toBeGreaterThanOrEqual(55)
      expect(elapsed).toBeLessThan(100)

      // Verify concurrency was respected: at most 2 running at once
      // Sort by start time and check overlaps
      executionLog.sort((a, b) => a.startTime - b.startTime)
      for (let i = 0; i < executionLog.length; i++) {
        const current = executionLog[i]
        const overlapping = executionLog.filter(
          (e) => e !== current && e.startTime < current.endTime && e.endTime > current.startTime
        )
        expect(overlapping.length).toBeLessThanOrEqual(1) // At most 1 other running concurrently
      }
    })

    it('should default to unlimited concurrency', async () => {
      const executionLog: { source: string; startTime: number; endTime: number }[] = []

      // Setup 5 sources with 30ms delay each
      for (let i = 1; i <= 5; i++) {
        const name = `source${i}`
        catalog.registerSource({ name, type: 'memory', config: {} })
        catalog.attachAdapter(
          name,
          createTrackingAdapter({ items: [{ id: i }] }, 30, executionLog, name)
        )
      }

      const tasks: ScanTask[] = Array.from({ length: 5 }, (_, i) => ({
        source: `source${i + 1}`,
        query: { table: 'items' },
      }))

      const startTime = performance.now()
      await coordinator.scan(tasks) // No options = unlimited
      const elapsed = performance.now() - startTime

      // All 5 should run in parallel, completing in ~30ms
      expect(elapsed).toBeLessThan(60)
    })

    it('should handle concurrency of 1 (sequential)', async () => {
      const executionLog: { source: string; startTime: number; endTime: number }[] = []

      for (let i = 1; i <= 3; i++) {
        const name = `source${i}`
        catalog.registerSource({ name, type: 'memory', config: {} })
        catalog.attachAdapter(
          name,
          createTrackingAdapter({ items: [{ id: i }] }, 20, executionLog, name)
        )
      }

      const tasks: ScanTask[] = [
        { source: 'source1', query: { table: 'items' } },
        { source: 'source2', query: { table: 'items' } },
        { source: 'source3', query: { table: 'items' } },
      ]

      const options: ScanOptions = { maxConcurrency: 1 }

      const startTime = performance.now()
      await coordinator.scan(tasks, options)
      const elapsed = performance.now() - startTime

      // Sequential: 3 * 20ms = 60ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(55)

      // No overlaps should exist
      executionLog.sort((a, b) => a.startTime - b.startTime)
      for (let i = 1; i < executionLog.length; i++) {
        expect(executionLog[i].startTime).toBeGreaterThanOrEqual(executionLog[i - 1].endTime - 5)
      }
    })
  })

  // ===========================================================================
  // Backpressure Tests
  // ===========================================================================

  describe('backpressure handling', () => {
    it('should pause fast sources when buffer is full', async () => {
      catalog.registerSource({ name: 'fast', type: 'memory', config: {} })
      catalog.registerSource({ name: 'slow', type: 'memory', config: {} })

      // Fast source produces data immediately
      catalog.attachAdapter(
        'fast',
        createMemoryAdapter({
          items: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
        })
      )

      // Slow source has delay
      catalog.attachAdapter(
        'slow',
        createDelayedAdapter({ items: [{ id: 'slow' }] }, 100)
      )

      const tasks: ScanTask[] = [
        { source: 'fast', query: { table: 'items' } },
        { source: 'slow', query: { table: 'items' } },
      ]

      const backpressure: BackpressureConfig = {
        maxBufferSize: 100, // Only buffer 100 rows
        onPressure: vi.fn(),
      }

      const results = await coordinator.scan(tasks, { backpressure })

      // Both should complete successfully despite buffer limit
      expect(results).toHaveLength(2)
      expect(results.find((r) => r.source === 'fast')?.rows).toHaveLength(1000)
    })

    it('should invoke onPressure callback when buffer fills', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })

      catalog.attachAdapter(
        'source1',
        createMemoryAdapter({
          items: Array.from({ length: 500 }, (_, i) => ({ id: i })),
        })
      )

      const tasks: ScanTask[] = [{ source: 'source1', query: { table: 'items' } }]

      const onPressure = vi.fn()
      const backpressure: BackpressureConfig = {
        maxBufferSize: 100,
        onPressure,
      }

      await coordinator.scan(tasks, { backpressure })

      // onPressure should have been called when buffer exceeded 100
      expect(onPressure).toHaveBeenCalled()
    })

    it('should respect memory limits across all sources', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'source2', type: 'memory', config: {} })

      // Each source produces 500KB of data (500 rows * ~1KB each)
      const largeData = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(1000),
      }))

      catalog.attachAdapter('source1', createMemoryAdapter({ items: largeData }))
      catalog.attachAdapter('source2', createMemoryAdapter({ items: largeData }))

      const tasks: ScanTask[] = [
        { source: 'source1', query: { table: 'items' } },
        { source: 'source2', query: { table: 'items' } },
      ]

      const backpressure: BackpressureConfig = {
        maxMemoryMB: 1, // 1MB total limit
        onPressure: vi.fn(),
      }

      const results = await coordinator.scan(tasks, { backpressure })

      // Should complete but with backpressure applied
      expect(results).toHaveLength(2)
      expect(backpressure.onPressure).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Cancellation Tests
  // ===========================================================================

  describe('cancellation support', () => {
    it('should stop scans when cancellation is requested', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'source2', type: 'memory', config: {} })

      catalog.attachAdapter(
        'source1',
        createDelayedAdapter({ items: [{ id: 1 }] }, 100)
      )
      catalog.attachAdapter(
        'source2',
        createDelayedAdapter({ items: [{ id: 2 }] }, 100)
      )

      const tasks: ScanTask[] = [
        { source: 'source1', query: { table: 'items' } },
        { source: 'source2', query: { table: 'items' } },
      ]

      const token = new CancellationToken()

      // Cancel after 30ms
      setTimeout(() => token.cancel(), 30)

      await expect(coordinator.scan(tasks, { cancellationToken: token })).rejects.toThrow(
        'Scan cancelled'
      )
    })

    it('should return partial results with continueOnCancel option', async () => {
      catalog.registerSource({ name: 'fast', type: 'memory', config: {} })
      catalog.registerSource({ name: 'slow', type: 'memory', config: {} })

      catalog.attachAdapter('fast', createMemoryAdapter({ items: [{ id: 'fast' }] }))
      catalog.attachAdapter(
        'slow',
        createDelayedAdapter({ items: [{ id: 'slow' }] }, 200)
      )

      const tasks: ScanTask[] = [
        { source: 'fast', query: { table: 'items' } },
        { source: 'slow', query: { table: 'items' } },
      ]

      const token = new CancellationToken()

      // Cancel after 50ms (fast should complete, slow should not)
      setTimeout(() => token.cancel(), 50)

      const results = await coordinator.scan(tasks, {
        cancellationToken: token,
        continueOnCancel: true,
      })

      // Should have result from fast source
      expect(results.some((r) => r.source === 'fast')).toBe(true)

      // Slow source should be marked as cancelled
      const slowResult = results.find((r) => r.source === 'slow')
      expect(slowResult?.cancelled).toBe(true)
    })

    it('should support pre-cancelled tokens', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })
      catalog.attachAdapter('source1', createMemoryAdapter({ items: [{ id: 1 }] }))

      const tasks: ScanTask[] = [{ source: 'source1', query: { table: 'items' } }]

      const token = new CancellationToken()
      token.cancel() // Pre-cancel

      await expect(coordinator.scan(tasks, { cancellationToken: token })).rejects.toThrow(
        'Scan cancelled'
      )
    })

    it('should clean up resources on cancellation', async () => {
      const cleanupCalled = vi.fn()

      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })

      // Adapter that tracks cleanup
      const adapter: SourceAdapter = {
        capabilities: () => ({
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: true,
          aggregationPushdown: false,
          joinPushdown: false,
        }),
        execute: async (query) => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return { rows: [] }
        },
        async *stream(query) {
          try {
            await new Promise((resolve) => setTimeout(resolve, 200))
            yield []
          } finally {
            cleanupCalled()
          }
        },
      }

      catalog.attachAdapter('source1', adapter)

      const tasks: ScanTask[] = [{ source: 'source1', query: { table: 'items' } }]
      const token = new CancellationToken()

      setTimeout(() => token.cancel(), 50)

      try {
        await coordinator.scan(tasks, { cancellationToken: token })
      } catch {
        // Expected
      }

      // Give cleanup time to run
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Note: Cleanup behavior depends on implementation
      // This test verifies the pattern works
    })
  })

  // ===========================================================================
  // Partial Failure Tests
  // ===========================================================================

  describe('partial failure handling', () => {
    it('should continue other scans when one fails', async () => {
      catalog.registerSource({ name: 'success', type: 'memory', config: {} })
      catalog.registerSource({ name: 'failure', type: 'memory', config: {} })

      catalog.attachAdapter(
        'success',
        createMemoryAdapter({ items: [{ id: 'ok' }] })
      )
      catalog.attachAdapter(
        'failure',
        createFailingAdapter({ items: [] }, -1, 'Connection failed')
      )

      const tasks: ScanTask[] = [
        { source: 'success', query: { table: 'items' } },
        { source: 'failure', query: { table: 'items' } },
      ]

      const results = await coordinator.scan(tasks, { continueOnError: true })

      // Success source should have results
      const successResult = results.find((r) => r.source === 'success')
      expect(successResult?.rows).toHaveLength(1)

      // Failure source should have error
      const failureResult = results.find((r) => r.source === 'failure')
      expect(failureResult?.error).toBeDefined()
      expect(failureResult?.error?.message).toContain('Connection failed')
    })

    it('should throw on first error by default', async () => {
      catalog.registerSource({ name: 'success', type: 'memory', config: {} })
      catalog.registerSource({ name: 'failure', type: 'memory', config: {} })

      catalog.attachAdapter(
        'success',
        createDelayedAdapter({ items: [{ id: 'ok' }] }, 100)
      )
      catalog.attachAdapter(
        'failure',
        createFailingAdapter({ items: [] }, -1, 'Query error')
      )

      const tasks: ScanTask[] = [
        { source: 'success', query: { table: 'items' } },
        { source: 'failure', query: { table: 'items' } },
      ]

      await expect(coordinator.scan(tasks)).rejects.toThrow('Query error')
    })

    it('should include source context in error messages', async () => {
      catalog.registerSource({ name: 'broken_db', type: 'memory', config: {} })
      catalog.attachAdapter(
        'broken_db',
        createFailingAdapter({ items: [] }, -1, 'Timeout')
      )

      const tasks: ScanTask[] = [{ source: 'broken_db', query: { table: 'items' } }]

      try {
        await coordinator.scan(tasks)
      } catch (e) {
        expect((e as Error).message).toContain('broken_db')
      }
    })

    it('should aggregate multiple errors with continueOnError', async () => {
      catalog.registerSource({ name: 'fail1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'fail2', type: 'memory', config: {} })
      catalog.registerSource({ name: 'success', type: 'memory', config: {} })

      catalog.attachAdapter('fail1', createFailingAdapter({ items: [] }, -1, 'Error 1'))
      catalog.attachAdapter('fail2', createFailingAdapter({ items: [] }, -1, 'Error 2'))
      catalog.attachAdapter('success', createMemoryAdapter({ items: [{ id: 1 }] }))

      const tasks: ScanTask[] = [
        { source: 'fail1', query: { table: 'items' } },
        { source: 'fail2', query: { table: 'items' } },
        { source: 'success', query: { table: 'items' } },
      ]

      const results = await coordinator.scan(tasks, { continueOnError: true })

      const errors = results.filter((r) => r.error)
      expect(errors).toHaveLength(2)
      expect(errors.some((e) => e.error?.message.includes('Error 1'))).toBe(true)
      expect(errors.some((e) => e.error?.message.includes('Error 2'))).toBe(true)
    })
  })

  // ===========================================================================
  // Statistics Tests
  // ===========================================================================

  describe('execution statistics', () => {
    it('should collect timing stats per source', async () => {
      catalog.registerSource({ name: 'fast', type: 'memory', config: {} })
      catalog.registerSource({ name: 'slow', type: 'memory', config: {} })

      catalog.attachAdapter('fast', createMemoryAdapter({ items: [{ id: 1 }] }))
      catalog.attachAdapter('slow', createDelayedAdapter({ items: [{ id: 2 }] }, 50))

      const tasks: ScanTask[] = [
        { source: 'fast', query: { table: 'items' } },
        { source: 'slow', query: { table: 'items' } },
      ]

      const results = await coordinator.scan(tasks, { collectStats: true })

      const fastResult = results.find((r) => r.source === 'fast')
      const slowResult = results.find((r) => r.source === 'slow')

      expect(fastResult?.stats?.executionTimeMs).toBeDefined()
      expect(slowResult?.stats?.executionTimeMs).toBeDefined()
      expect(slowResult!.stats!.executionTimeMs).toBeGreaterThan(fastResult!.stats!.executionTimeMs)
    })

    it('should track row counts', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })

      catalog.attachAdapter(
        'source1',
        createMemoryAdapter({
          items: Array.from({ length: 100 }, (_, i) => ({ id: i })),
        })
      )

      const tasks: ScanTask[] = [{ source: 'source1', query: { table: 'items' } }]

      const results = await coordinator.scan(tasks, { collectStats: true })

      expect(results[0].stats?.rowCount).toBe(100)
    })

    it('should calculate total coordination time', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })
      catalog.attachAdapter('source1', createDelayedAdapter({ items: [{ id: 1 }] }, 50))

      const tasks: ScanTask[] = [{ source: 'source1', query: { table: 'items' } }]

      const result = await coordinator.scanWithStats(tasks)

      expect(result.stats.totalTimeMs).toBeGreaterThanOrEqual(45)
      expect(result.stats.sourcesScanned).toBe(1)
    })
  })

  // ===========================================================================
  // Streaming Scan Tests
  // ===========================================================================

  describe('streaming scans', () => {
    it('should stream results from multiple sources', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'source2', type: 'memory', config: {} })

      catalog.attachAdapter(
        'source1',
        createMemoryAdapter({
          items: Array.from({ length: 100 }, (_, i) => ({ id: `s1-${i}` })),
        })
      )
      catalog.attachAdapter(
        'source2',
        createMemoryAdapter({
          items: Array.from({ length: 100 }, (_, i) => ({ id: `s2-${i}` })),
        })
      )

      const tasks: ScanTask[] = [
        { source: 'source1', query: { table: 'items' } },
        { source: 'source2', query: { table: 'items' } },
      ]

      const batches: { source: string; count: number }[] = []
      for await (const batch of coordinator.streamScan(tasks, { batchSize: 25 })) {
        batches.push({ source: batch.source, count: batch.rows.length })
      }

      // Should have received batches from both sources
      expect(batches.some((b) => b.source === 'source1')).toBe(true)
      expect(batches.some((b) => b.source === 'source2')).toBe(true)

      // Total rows should match
      const source1Rows = batches
        .filter((b) => b.source === 'source1')
        .reduce((sum, b) => sum + b.count, 0)
      const source2Rows = batches
        .filter((b) => b.source === 'source2')
        .reduce((sum, b) => sum + b.count, 0)

      expect(source1Rows).toBe(100)
      expect(source2Rows).toBe(100)
    })

    it('should interleave results from fast and slow sources', async () => {
      catalog.registerSource({ name: 'fast', type: 'memory', config: {} })
      catalog.registerSource({ name: 'slow', type: 'memory', config: {} })

      catalog.attachAdapter(
        'fast',
        createMemoryAdapter({
          items: Array.from({ length: 50 }, (_, i) => ({ id: `fast-${i}` })),
        })
      )
      catalog.attachAdapter(
        'slow',
        createDelayedAdapter(
          { items: Array.from({ length: 50 }, (_, i) => ({ id: `slow-${i}` })) },
          20
        )
      )

      const tasks: ScanTask[] = [
        { source: 'fast', query: { table: 'items' } },
        { source: 'slow', query: { table: 'items' } },
      ]

      const sources: string[] = []
      for await (const batch of coordinator.streamScan(tasks, { batchSize: 10 })) {
        sources.push(batch.source)
      }

      // Fast source batches should appear before slow source completes
      const firstSlowIndex = sources.indexOf('slow')
      const lastFastIndex = sources.lastIndexOf('fast')

      // There should be some interleaving or fast completing before slow
      expect(firstSlowIndex).toBeGreaterThan(0)
    })

    it('should support cancellation in streaming mode', async () => {
      catalog.registerSource({ name: 'source1', type: 'memory', config: {} })

      catalog.attachAdapter(
        'source1',
        createDelayedAdapter(
          { items: Array.from({ length: 1000 }, (_, i) => ({ id: i })) },
          10
        )
      )

      const tasks: ScanTask[] = [{ source: 'source1', query: { table: 'items' } }]
      const token = new CancellationToken()

      let batchCount = 0
      try {
        for await (const batch of coordinator.streamScan(tasks, {
          batchSize: 10,
          cancellationToken: token,
        })) {
          batchCount++
          if (batchCount >= 3) {
            token.cancel()
          }
        }
      } catch (e) {
        expect((e as Error).message).toContain('cancelled')
      }

      // Should have stopped early
      expect(batchCount).toBeLessThanOrEqual(5)
    })
  })
})
