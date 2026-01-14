import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RemoteRunner } from './remote'
import type { BenchmarkRequest, BenchmarkResponse } from './remote-types'

describe('RemoteRunner', () => {
  let runner: RemoteRunner
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    runner = new RemoteRunner({
      endpoint: 'https://benchmark.workers.dev',
      apiKey: 'test-api-key'
    })
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Request Handling', () => {
    test('sends benchmark request with correct format', async () => {
      const request: BenchmarkRequest = {
        store: 'document',
        operation: 'create',
        dataset: { size: 100, seed: 42 },
        iterations: 10,
        warmup: 3
      }

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ metrics: {}, raw: [] }))
      )

      await runner.run(request)

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://benchmark.workers.dev/benchmark',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify(request)
        })
      )
    })

    test('includes timeout in request via AbortController', async () => {
      const runnerWithTimeout = new RemoteRunner({
        endpoint: 'https://benchmark.workers.dev',
        apiKey: 'test-key',
        timeout: 30000
      })

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ metrics: {}, raw: [] }))
      )

      await runnerWithTimeout.run({
        store: 'document',
        operation: 'create',
        iterations: 5
      })

      // Verify fetch was called with signal from AbortController
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
    })

    test('builds correct endpoint URL', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ metrics: {}, raw: [] }))
      )

      await runner.run({
        store: 'things',
        operation: 'query',
        iterations: 5
      })

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://benchmark.workers.dev/benchmark',
        expect.any(Object)
      )
    })
  })

  describe('Response Handling', () => {
    test('parses benchmark response correctly', async () => {
      const mockResponse: BenchmarkResponse = {
        metrics: {
          latency: {
            p50: 5,
            p95: 10,
            p99: 15,
            min: 1,
            max: 20,
            avg: 6,
            stdDev: 3
          },
          throughput: { opsPerSecond: 200, bytesPerSecond: 0 },
          cost: {
            rowWrites: 100,
            rowReads: 0,
            storageBytes: 0,
            storageGb: 0,
            estimatedCost: 0.0001,
            breakdown: { writeCost: 0.0001, readCost: 0, storageCost: 0 }
          },
          resources: { peakMemoryMb: 10, storageBytesUsed: 1024 }
        },
        raw: [3, 4, 5, 6, 7, 8, 5, 4, 6, 5],
        environment: 'production'
      }

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse)))

      const result = await runner.run({
        store: 'document',
        operation: 'create',
        iterations: 10
      })

      expect(result.metrics.latency.p50).toBe(5)
      expect(result.environment).toBe('production')
      expect(result.raw).toHaveLength(10)
    })

    test('handles error response with message', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Benchmark failed' }), {
          status: 500
        })
      )

      await expect(
        runner.run({ store: 'document', operation: 'create', iterations: 5 })
      ).rejects.toThrow(/Benchmark failed/)
    })

    test('handles error response without message', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      )

      await expect(
        runner.run({ store: 'document', operation: 'create', iterations: 5 })
      ).rejects.toThrow(/500/)
    })

    test('handles network error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'))

      await expect(
        runner.run({ store: 'document', operation: 'create', iterations: 5 })
      ).rejects.toThrow(/Network error/)
    })
  })

  describe('Timeout Handling', () => {
    test('throws on timeout', async () => {
      const runnerWithShortTimeout = new RemoteRunner({
        endpoint: 'https://benchmark.workers.dev',
        apiKey: 'test-key',
        timeout: 100
      })

      fetchSpy.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(new Response(JSON.stringify({ metrics: {}, raw: [] }))),
              200
            )
          )
      )

      await expect(
        runnerWithShortTimeout.run({
          store: 'document',
          operation: 'create',
          iterations: 5
        })
      ).rejects.toThrow(/timeout/i)
    })

    test('completes before timeout', async () => {
      const runnerWithLongTimeout = new RemoteRunner({
        endpoint: 'https://benchmark.workers.dev',
        apiKey: 'test-key',
        timeout: 5000
      })

      const mockResponse: BenchmarkResponse = {
        metrics: {
          latency: { p50: 5, p95: 10, p99: 15, min: 1, max: 20, avg: 6, stdDev: 3 },
          throughput: { opsPerSecond: 100, bytesPerSecond: 0 },
          cost: {
            rowWrites: 1,
            rowReads: 0,
            storageBytes: 0,
            storageGb: 0,
            estimatedCost: 0,
            breakdown: { writeCost: 0, readCost: 0, storageCost: 0 }
          },
          resources: { peakMemoryMb: 10, storageBytesUsed: 0 }
        },
        raw: [5],
        environment: 'production'
      }

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse)))

      const result = await runnerWithLongTimeout.run({
        store: 'document',
        operation: 'create',
        iterations: 1
      })

      expect(result.metrics.latency.p50).toBe(5)
    })
  })

  describe('Result Aggregation', () => {
    test('aggregates multiple run results', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            metrics: {
              latency: { p50: 5, p95: 10, p99: 15, min: 1, max: 20, avg: 6, stdDev: 3 },
              throughput: { opsPerSecond: 100, bytesPerSecond: 0 },
              cost: {
                rowWrites: 1,
                rowReads: 0,
                storageBytes: 0,
                storageGb: 0,
                estimatedCost: 0,
                breakdown: { writeCost: 0, readCost: 0, storageCost: 0 }
              },
              resources: { peakMemoryMb: 10, storageBytesUsed: 0 }
            },
            raw: [5, 5, 5, 5, 5],
            environment: 'production'
          })
        )
      )

      const results = await runner.runMultiple(
        { store: 'document', operation: 'create', iterations: 5 },
        3 // Run 3 times
      )

      expect(results.runs).toHaveLength(3)
      expect(results.aggregated.latency.avg).toBeDefined()
    })

    test('calculates min/max across runs', async () => {
      let callCount = 0
      fetchSpy.mockImplementation(() => {
        callCount++
        const p50 = callCount * 2 // 2, 4, 6 for three calls
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metrics: {
                latency: {
                  p50,
                  p95: p50 + 5,
                  p99: p50 + 10,
                  min: p50 - 1,
                  max: p50 + 15,
                  avg: p50,
                  stdDev: 1
                },
                throughput: { opsPerSecond: 100, bytesPerSecond: 0 },
                cost: {
                  rowWrites: 1,
                  rowReads: 0,
                  storageBytes: 0,
                  storageGb: 0,
                  estimatedCost: 0,
                  breakdown: { writeCost: 0, readCost: 0, storageCost: 0 }
                },
                resources: { peakMemoryMb: 10, storageBytesUsed: 0 }
              },
              raw: [p50],
              environment: 'production'
            })
          )
        )
      })

      const results = await runner.runMultiple(
        { store: 'document', operation: 'create', iterations: 1 },
        3
      )

      expect(results.aggregated.latency.min).toBe(1) // min p50 - 1 = 2 - 1 = 1
      expect(results.aggregated.latency.max).toBe(21) // max p50 + 15 = 6 + 15 = 21
    })
  })

  describe('Authentication', () => {
    test('includes API key in Authorization header', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ metrics: {}, raw: [] }))
      )

      await runner.run({ store: 'test', operation: 'test', iterations: 1 })

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key'
          })
        })
      )
    })

    test('handles 401 unauthorized', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      )

      await expect(
        runner.run({ store: 'test', operation: 'test', iterations: 1 })
      ).rejects.toThrow(/Unauthorized|401/)
    })
  })
})
