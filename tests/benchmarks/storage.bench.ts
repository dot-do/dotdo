/**
 * Storage Read/Write Benchmarks
 *
 * Measures the performance of DO storage operations including:
 * - Single key read/write
 * - Batch read/write
 * - Large value serialization
 * - List operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runBenchmark, runBenchmarkBatch, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'

// Create a mock storage that simulates DO storage behavior
function createMockStorage() {
  const data = new Map<string, unknown>()

  return {
    data,
    get: vi.fn(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        const result = new Map<string, unknown>()
        for (const k of key) {
          if (data.has(k)) {
            result.set(k, data.get(k))
          }
        }
        return result
      }
      return data.get(key)
    }),
    put: vi.fn(async (key: string | Map<string, unknown>, value?: unknown) => {
      if (typeof key === 'string') {
        data.set(key, value)
      } else {
        for (const [k, v] of key.entries()) {
          data.set(k, v)
        }
      }
    }),
    delete: vi.fn(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        let deleted = 0
        for (const k of key) {
          if (data.delete(k)) deleted++
        }
        return deleted
      }
      return data.delete(key)
    }),
    list: vi.fn(async (options?: { prefix?: string; limit?: number }) => {
      const result = new Map<string, unknown>()
      let count = 0
      for (const [k, v] of data.entries()) {
        if (options?.prefix && !k.startsWith(options.prefix)) continue
        if (options?.limit && count >= options.limit) break
        result.set(k, v)
        count++
      }
      return result
    }),
    deleteAll: vi.fn(async () => {
      data.clear()
    }),
  }
}

describe('Storage Read/Write Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('should benchmark single key write', async () => {
    let i = 0
    const metrics = await runBenchmark(
      'storage-single-write',
      async () => {
        await storage.put(`key-${i++}`, { value: 'test data', timestamp: Date.now() })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['storage-single-write'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark single key read', async () => {
    // Pre-populate storage
    for (let i = 0; i < 100; i++) {
      storage.data.set(`read-key-${i}`, { value: i, data: 'some data' })
    }

    let i = 0
    const metrics = await runBenchmark(
      'storage-single-read',
      async () => {
        await storage.get(`read-key-${i++ % 100}`)
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['storage-single-read'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark batch write (10 keys)', async () => {
    let batch = 0
    const metrics = await runBenchmark(
      'storage-batch-write-10',
      async () => {
        const entries = new Map<string, unknown>()
        for (let i = 0; i < 10; i++) {
          entries.set(`batch-${batch}-key-${i}`, { value: i, batch })
        }
        await storage.put(entries)
        batch++
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['storage-batch-write-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark batch read (10 keys)', async () => {
    // Pre-populate storage
    for (let i = 0; i < 100; i++) {
      storage.data.set(`batch-read-${i}`, { value: i })
    }

    const metrics = await runBenchmark(
      'storage-batch-read-10',
      async () => {
        const keys = Array.from({ length: 10 }, (_, i) => `batch-read-${i % 100}`)
        await storage.get(keys)
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['storage-batch-read-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark large value write (10KB)', async () => {
    // Create a ~10KB object
    const largeValue = {
      id: 'large-object',
      data: Array.from({ length: 100 }, (_, i) => ({
        index: i,
        name: `Item ${i}`,
        description: 'A'.repeat(50),
        metadata: { created: new Date().toISOString(), tags: ['tag1', 'tag2'] },
      })),
    }

    let i = 0
    const metrics = await runBenchmark(
      'storage-large-value-write',
      async () => {
        await storage.put(`large-${i++}`, largeValue)
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['storage-large-value-write'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark large value read (10KB)', async () => {
    // Pre-populate with large values
    const largeValue = {
      id: 'large-object',
      data: Array.from({ length: 100 }, (_, i) => ({
        index: i,
        name: `Item ${i}`,
        description: 'A'.repeat(50),
        metadata: { created: new Date().toISOString(), tags: ['tag1', 'tag2'] },
      })),
    }

    for (let i = 0; i < 10; i++) {
      storage.data.set(`large-read-${i}`, largeValue)
    }

    let i = 0
    const metrics = await runBenchmark(
      'storage-large-value-read',
      async () => {
        await storage.get(`large-read-${i++ % 10}`)
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['storage-large-value-read'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark list operation with prefix', async () => {
    // Pre-populate storage with prefixed keys
    for (let i = 0; i < 1000; i++) {
      storage.data.set(`events:user-1:${i}`, { eventId: i })
    }
    for (let i = 0; i < 500; i++) {
      storage.data.set(`events:user-2:${i}`, { eventId: i })
    }

    const metrics = await runBenchmark(
      'storage-list-prefix',
      async () => {
        await storage.list({ prefix: 'events:user-1:', limit: 100 })
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['storage-list-prefix'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark delete operation', async () => {
    // Pre-populate storage
    for (let i = 0; i < 200; i++) {
      storage.data.set(`delete-key-${i}`, { value: i })
    }

    let i = 0
    const metrics = await runBenchmark(
      'storage-delete',
      async () => {
        await storage.delete(`delete-key-${i++ % 200}`)
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['storage-delete'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark JSON serialization overhead', async () => {
    const testObject = {
      id: 'test-id',
      data: Array.from({ length: 50 }, (_, i) => ({
        index: i,
        name: `Item ${i}`,
        nested: { a: 1, b: 2, c: [1, 2, 3] },
      })),
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        version: 1,
      },
    }

    const metrics = await runBenchmark(
      'storage-json-serialization',
      () => {
        const serialized = JSON.stringify(testObject)
        JSON.parse(serialized)
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['storage-json-serialization'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  // Export results for baseline comparison
  afterAll(() => {
    ;(globalThis as any).__benchmarkResults = {
      ...((globalThis as any).__benchmarkResults || {}),
      ...benchmarkResults,
    }
  })
})
