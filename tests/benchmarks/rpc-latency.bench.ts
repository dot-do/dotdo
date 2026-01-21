/**
 * RPC Call Latency Benchmark
 *
 * Measures the latency of RPC calls to Durable Objects including:
 * - Simple method calls
 * - Method calls with arguments
 * - Nested method calls
 * - Concurrent RPC calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runBenchmark, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'

// Mock fetch for testing
const mockFetch = vi.fn()
const originalFetch = globalThis.fetch

describe('RPC Call Latency Benchmarks', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const benchmarkResults: Record<string, BenchmarkMetrics> = {}

  it('should benchmark simple RPC call latency', async () => {
    // Mock a fast response
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
      })
    )

    const metrics = await runBenchmark(
      'rpc-simple-call',
      async () => {
        await fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'ping', args: [] }),
        })
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
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: '123' }),
      })
    )

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
        await fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'createUser',
            args: [complexPayload],
          }),
        })
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['rpc-complex-args'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark concurrent RPC calls', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
      })
    )

    const metrics = await runBenchmark(
      'rpc-concurrent-10',
      async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
          fetch('https://do/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'process', args: [i] }),
          })
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
    // Generate a large response
    const largeResponse = {
      items: Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        name: `Item ${i}`,
        data: { nested: { deeply: { value: i } } },
      })),
    }

    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(largeResponse),
      })
    )

    const metrics = await runBenchmark(
      'rpc-large-response',
      async () => {
        const response = await fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'listItems', args: [] }),
        })
        await response.json()
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

  // Export results for baseline comparison
  afterEach(() => {
    // Store results for report generation
    ;(globalThis as any).__benchmarkResults = {
      ...((globalThis as any).__benchmarkResults || {}),
      ...benchmarkResults,
    }
  })
})
