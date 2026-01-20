/**
 * DO Instantiation Time Benchmark
 *
 * Measures the time to instantiate Durable Objects including:
 * - Base DO class instantiation
 * - Subclass instantiation
 * - Entity manager initialization
 * - WebSocket manager initialization
 */

import { describe, it, expect, vi } from 'vitest'
import { runBenchmark, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'
import { DO } from '../../do/DO'
import { WebSocketManager } from '../../do/websocket'
import { EntityManager } from '../../do/entities'

// Mock DurableObjectState
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'bench-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  } as unknown as DurableObjectState
}

describe('DO Instantiation Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}

  it('should benchmark base DO class instantiation', async () => {
    const metrics = await runBenchmark(
      'do-base-instantiation',
      () => {
        const state = createMockState()
        new DO(state, {})
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['do-base-instantiation'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
    // Instantiation should be fast - under 10ms typically
    expect(metrics.mean).toBeLessThan(50)
  })

  it('should benchmark DO instantiation with CORS disabled', async () => {
    const metrics = await runBenchmark(
      'do-instantiation-no-cors',
      () => {
        const state = createMockState()
        new DO(state, {}, { cors: false })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['do-instantiation-no-cors'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark WebSocketManager instantiation', async () => {
    const metrics = await runBenchmark(
      'websocket-manager-instantiation',
      () => {
        new WebSocketManager()
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['websocket-manager-instantiation'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    expect(metrics.mean).toBeGreaterThan(0)
    // WebSocketManager should be very fast to instantiate
    expect(metrics.mean).toBeLessThan(5)
  })

  it('should benchmark EntityManager instantiation', async () => {
    const metrics = await runBenchmark(
      'entity-manager-instantiation',
      () => {
        new EntityManager()
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['entity-manager-instantiation'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark subclass DO instantiation', async () => {
    class CustomDO extends DO {
      private customState: Map<string, unknown> = new Map()

      protected routes(app: any): void {
        app.get('/custom', (c: any) => c.json({ custom: true }))
        app.post('/process', async (c: any) => {
          const body = await c.req.json()
          return c.json({ processed: body })
        })
      }

      async customMethod(data: unknown): Promise<unknown> {
        this.customState.set('last', data)
        return { stored: true }
      }
    }

    const metrics = await runBenchmark(
      'do-subclass-instantiation',
      () => {
        const state = createMockState()
        new CustomDO(state, {})
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['do-subclass-instantiation'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark DO with multiple route registrations', async () => {
    class RoutedDO extends DO {
      protected routes(app: any): void {
        // Register many routes
        for (let i = 0; i < 20; i++) {
          app.get(`/route-${i}`, (c: any) => c.json({ route: i }))
          app.post(`/route-${i}`, (c: any) => c.json({ route: i }))
        }
      }
    }

    const metrics = await runBenchmark(
      'do-many-routes-instantiation',
      () => {
        const state = createMockState()
        const doInstance = new RoutedDO(state, {})
        // Trigger route initialization
        doInstance.fetch(new Request('https://do/'))
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['do-many-routes-instantiation'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
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
