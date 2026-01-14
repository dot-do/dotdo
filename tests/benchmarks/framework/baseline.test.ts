import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { BaselineManager } from './baseline'
import type { Baseline, Delta } from './baseline-types'
import type { BenchmarkResult } from './types'
import * as fs from 'fs/promises'

describe('BaselineManager', () => {
  const mockResult = (name: string, p50: number): BenchmarkResult => ({
    name,
    samples: [p50],
    metrics: {
      latency: {
        p50,
        p95: p50 * 1.5,
        p99: p50 * 2,
        min: p50 * 0.5,
        max: p50 * 2.5,
        avg: p50,
        stdDev: 1
      },
      throughput: { opsPerSecond: 1000 / p50, bytesPerSecond: 0 },
      cost: {
        rowWrites: 1,
        rowReads: 0,
        storageBytes: 0,
        storageGb: 0,
        estimatedCost: 0.000001,
        breakdown: { writeCost: 0.000001, readCost: 0, storageCost: 0 }
      },
      resources: { peakMemoryMb: 10, storageBytesUsed: 1024 }
    },
    context: {
      name,
      store: 'document',
      operation: 'create',
      datasetSize: 100,
      iterations: 10,
      environment: 'local'
    }
  })

  let manager: BaselineManager
  const testBasePath = '/tmp/test-baseline.json'

  beforeEach(() => {
    manager = new BaselineManager({ path: testBasePath })
  })

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testBasePath)
    } catch {
      // File may not exist
    }
  })

  describe('Saving Results', () => {
    test('saves benchmark results to file', async () => {
      const results = [mockResult('test1', 5), mockResult('test2', 10)]

      await manager.save(results)

      // Should write to file
      const content = await fs.readFile(testBasePath, 'utf-8')
      const baseline = JSON.parse(content) as Baseline

      expect(baseline.results).toHaveLength(2)
      expect(baseline.timestamp).toBeDefined()
    })

    test('includes metadata in baseline', async () => {
      const results = [mockResult('test', 5)]

      await manager.save(results, {
        commit: 'abc123',
        branch: 'main'
      })

      const content = await fs.readFile(testBasePath, 'utf-8')
      const baseline = JSON.parse(content) as Baseline

      expect(baseline.metadata?.commit).toBe('abc123')
      expect(baseline.metadata?.branch).toBe('main')
    })

    test('overwrites existing baseline', async () => {
      const results1 = [mockResult('first', 5)]
      const results2 = [mockResult('second', 10)]

      await manager.save(results1)
      await manager.save(results2)

      const content = await fs.readFile(testBasePath, 'utf-8')
      const baseline = JSON.parse(content) as Baseline

      expect(baseline.results).toHaveLength(1)
      expect(baseline.results[0].name).toBe('second')
    })
  })

  describe('Loading Previous Results', () => {
    test('loads existing baseline from file', async () => {
      // Create baseline file
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [mockResult('test', 5)],
        metadata: {}
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const loaded = await manager.load()

      expect(loaded).not.toBeNull()
      expect(loaded?.results).toHaveLength(1)
    })

    test('returns null when no baseline exists', async () => {
      manager = new BaselineManager({ path: '/tmp/nonexistent-baseline.json' })

      const loaded = await manager.load()

      expect(loaded).toBeNull()
    })

    test('preserves all result fields on load', async () => {
      const original = mockResult('test', 5)
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [original],
        metadata: { commit: 'xyz789' }
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const loaded = await manager.load()

      expect(loaded?.results[0].metrics.latency.p50).toBe(5)
      expect(loaded?.results[0].context.store).toBe('document')
      expect(loaded?.metadata?.commit).toBe('xyz789')
    })
  })

  describe('Delta Calculation', () => {
    test('calculates delta between current and baseline', async () => {
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [mockResult('test', 5)],
        metadata: {}
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const current = [mockResult('test', 10)] // 2x slower

      const delta = await manager.calculateDelta(current)

      expect(delta).not.toBeNull()
      expect(delta?.['test'].baselineP50).toBe(5)
      expect(delta?.['test'].currentP50).toBe(10)
      expect(delta?.['test'].change).toBe(1.0) // +100%
    })

    test('handles new benchmarks not in baseline', async () => {
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [mockResult('old', 5)],
        metadata: {}
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const current = [mockResult('old', 5), mockResult('new', 10)]

      const delta = await manager.calculateDelta(current)

      expect(delta?.['new']).toBeUndefined() // New benchmark, no baseline
      expect(delta?.['old']).toBeDefined()
    })

    test('handles removed benchmarks', async () => {
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [mockResult('removed', 5), mockResult('kept', 5)],
        metadata: {}
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const current = [mockResult('kept', 5)]

      const delta = await manager.calculateDelta(current)

      expect(delta?.['removed']).toBeUndefined() // Removed, not in current
      expect(delta?.['kept']).toBeDefined()
    })

    test('returns null when no baseline exists', async () => {
      manager = new BaselineManager({ path: '/tmp/nonexistent-baseline.json' })

      const current = [mockResult('test', 5)]
      const delta = await manager.calculateDelta(current)

      expect(delta).toBeNull()
    })

    test('calculates negative delta for improvements', async () => {
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [mockResult('test', 10)],
        metadata: {}
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const current = [mockResult('test', 5)] // 50% faster

      const delta = await manager.calculateDelta(current)

      expect(delta?.['test'].change).toBe(-0.5) // -50%
    })

    test('calculates correct delta for multiple benchmarks', async () => {
      const baseline: Baseline = {
        timestamp: new Date().toISOString(),
        results: [
          mockResult('fast', 5),
          mockResult('slow', 10),
          mockResult('same', 20)
        ],
        metadata: {}
      }
      await fs.writeFile(testBasePath, JSON.stringify(baseline))

      const current = [
        mockResult('fast', 2.5), // 50% faster
        mockResult('slow', 20), // 100% slower
        mockResult('same', 20) // unchanged
      ]

      const delta = await manager.calculateDelta(current)

      expect(delta?.['fast'].change).toBe(-0.5)
      expect(delta?.['slow'].change).toBe(1.0)
      expect(delta?.['same'].change).toBe(0)
    })
  })
})
