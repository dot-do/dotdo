/**
 * RPC Call Latency Benchmark
 *
 * Measures the latency of RPC calls to real Durable Objects using Miniflare.
 *
 * NO MOCKS: Per CLAUDE.md, this benchmark uses real miniflare DO instances
 * with real SQLite storage, not vi.fn() mocks. This provides accurate latency
 * measurements that reflect production behavior.
 *
 * Benchmark scenarios:
 * - Simple method calls (ping)
 * - Method calls with arguments (echo, createUser)
 * - Large response parsing (listItems)
 * - Concurrent RPC calls
 * - Stateful operations (increment)
 * - Storage operations (complexOperation)
 *
 * @module tests/benchmarks/rpc-latency.bench
 */

import { describe, it, expect, afterAll } from 'vitest'
import { env } from 'cloudflare:test'
import { runBenchmark, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'

// Re-export DO class for vitest-pool-workers
export { BenchDO } from './bench-dos'

// Type interface for env
interface Env {
  DO: DurableObjectNamespace
}

/**
 * Generate a unique test identifier to isolate benchmark data
 */
function generateBenchId(): string {
  return `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

describe('RPC Call Latency Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}

  it('should benchmark simple RPC call latency', async () => {
    const stub = (env as Env).DO.get((env as Env).DO.idFromName(generateBenchId()))

    const metrics = await runBenchmark(
      'rpc-simple-call',
      async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'ping', args: [] }),
        })
        await response.json()
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['rpc-simple-call'] = metrics

    console.log('\n' + formatMetrics(metrics))

    // Verify benchmark ran
    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
    expect(metrics.opsPerSecond).toBeGreaterThan(0)
  })

  it('should benchmark RPC call with complex arguments', async () => {
    const stub = (env as Env).DO.get((env as Env).DO.idFromName(generateBenchId()))

    const complexPayload = {
      user: {
        name: 'Test User',
        email: 'test@example.com',
        roles: ['admin', 'user'],
        metadata: {
          createdAt: new Date().toISOString(),
          preferences: { theme: 'dark', notifications: true },
        },
      },
    }

    const metrics = await runBenchmark(
      'rpc-complex-args',
      async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'createUser',
            args: [complexPayload],
          }),
        })
        await response.json()
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['rpc-complex-args'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark concurrent RPC calls', async () => {
    const stub = (env as Env).DO.get((env as Env).DO.idFromName(generateBenchId()))

    const metrics = await runBenchmark(
      'rpc-concurrent-10',
      async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
          stub.fetch('https://do/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'process', args: [i] }),
          }).then(r => r.json())
        )
        await Promise.all(promises)
      },
      { iterations: 30, warmupIterations: 3 }
    )

    benchmarkResults['rpc-concurrent-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(30)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark RPC call with large response parsing', async () => {
    const stub = (env as Env).DO.get((env as Env).DO.idFromName(generateBenchId()))

    const metrics = await runBenchmark(
      'rpc-large-response',
      async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'listItems', args: [] }),
        })
        const data = await response.json() as { items: unknown[] }
        // Verify we got the large response
        if (!data.items || data.items.length !== 100) {
          throw new Error('Invalid response')
        }
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['rpc-large-response'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark RPC serialization overhead', async () => {
    // This measures pure JSON serialization without network
    const payload = {
      method: 'complexMethod',
      args: [
        { data: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `val-${i}` })) },
        { filters: { active: true, type: 'premium' } },
      ],
    }

    const metrics = await runBenchmark(
      'rpc-serialization',
      () => {
        JSON.stringify(payload)
        JSON.parse(JSON.stringify(payload))
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['rpc-serialization'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark stateful RPC operations', async () => {
    // Use a single DO instance for stateful operations
    const stub = (env as Env).DO.get((env as Env).DO.idFromName(generateBenchId()))

    const metrics = await runBenchmark(
      'rpc-stateful-increment',
      async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'increment', args: [] }),
        })
        await response.json()
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['rpc-stateful-increment'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)

    // Verify state was actually maintained
    const finalResponse = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getCounter', args: [] }),
    })
    const { counter } = await finalResponse.json() as { counter: number }
    // 5 warmup + 50 iterations = 55 increments
    expect(counter).toBe(55)
  })

  it('should benchmark RPC with storage operations', async () => {
    const stub = (env as Env).DO.get((env as Env).DO.idFromName(generateBenchId()))

    const metrics = await runBenchmark(
      'rpc-with-storage',
      async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'complexOperation', args: [] }),
        })
        await response.json()
      },
      { iterations: 30, warmupIterations: 3 }
    )

    benchmarkResults['rpc-with-storage'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(30)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  // Store results for baseline comparison
  afterAll(() => {
    ;(globalThis as unknown as { __benchmarkResults: Record<string, BenchmarkMetrics> }).__benchmarkResults = {
      ...((globalThis as unknown as { __benchmarkResults?: Record<string, BenchmarkMetrics> }).__benchmarkResults || {}),
      ...benchmarkResults,
    }
  })
})
