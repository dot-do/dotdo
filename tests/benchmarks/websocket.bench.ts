/**
 * WebSocket Message Throughput Benchmark
 *
 * Measures the performance of WebSocket operations including:
 * - Message serialization/deserialization
 * - Message handler routing
 * - Broadcast to multiple connections
 * - Connection tracking overhead
 */

import { describe, it, expect, vi } from 'vitest'
import { runBenchmark, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'
import { WebSocketManager } from '../../do/websocket'

// Mock WebSocket
function createMockWebSocket(id: string): WebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as WebSocket
}

// Mock DurableObjectState for WebSocket operations
function createMockState(
  websockets: WebSocket[] = []
): DurableObjectState {
  return {
    id: { toString: () => 'ws-bench-id' } as DurableObjectId,
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn((tag?: string) => {
      return websockets
    }),
    storage: {} as any,
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('WebSocket Throughput Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}

  it('should benchmark message serialization', async () => {
    const message = {
      type: 'chat.message',
      data: {
        userId: 'user-123',
        content: 'Hello, this is a test message with some content.',
        timestamp: Date.now(),
        metadata: { room: 'general', edited: false },
      },
    }

    const metrics = await runBenchmark(
      'ws-message-serialization',
      () => {
        JSON.stringify(message)
      },
      { iterations: 500, warmupIterations: 50 }
    )

    benchmarkResults['ws-message-serialization'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(500)
    expect(metrics.mean).toBeGreaterThan(0)
    // Serialization should be very fast
    expect(metrics.mean).toBeLessThan(1)
  })

  it('should benchmark message deserialization', async () => {
    const serialized = JSON.stringify({
      type: 'chat.message',
      data: {
        userId: 'user-123',
        content: 'Hello, this is a test message with some content.',
        timestamp: Date.now(),
        metadata: { room: 'general', edited: false },
      },
    })

    const metrics = await runBenchmark(
      'ws-message-deserialization',
      () => {
        JSON.parse(serialized)
      },
      { iterations: 500, warmupIterations: 50 }
    )

    benchmarkResults['ws-message-deserialization'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(500)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark message handler registration', async () => {
    const metrics = await runBenchmark(
      'ws-handler-registration',
      () => {
        const manager = new WebSocketManager()
        for (let i = 0; i < 10; i++) {
          manager.on(`event.type.${i}`, (ws, data) => {
            // Handler logic
          })
        }
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['ws-handler-registration'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark message routing to handlers', async () => {
    const manager = new WebSocketManager()
    const ws = createMockWebSocket('test')

    // Register handlers
    manager.on('chat.message', async (ws, data) => {
      // Simulate handler processing
    })
    manager.on('*', async (ws, data) => {
      // Wildcard handler
    })

    const message = JSON.stringify({
      type: 'chat.message',
      data: { content: 'test' },
    })

    const metrics = await runBenchmark(
      'ws-message-routing',
      async () => {
        await manager.handleMessage(ws, message)
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['ws-message-routing'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark broadcast to 10 connections', async () => {
    const manager = new WebSocketManager()
    const websockets = Array.from({ length: 10 }, (_, i) =>
      createMockWebSocket(`ws-${i}`)
    )
    const state = createMockState(websockets)

    const message = {
      type: 'broadcast',
      data: { content: 'Hello everyone!', timestamp: Date.now() },
    }

    const metrics = await runBenchmark(
      'ws-broadcast-10',
      () => {
        manager.broadcastAll(state, message)
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['ws-broadcast-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark broadcast to 100 connections', async () => {
    const manager = new WebSocketManager()
    const websockets = Array.from({ length: 100 }, (_, i) =>
      createMockWebSocket(`ws-${i}`)
    )
    const state = createMockState(websockets)

    const message = {
      type: 'broadcast',
      data: { content: 'Hello everyone!', timestamp: Date.now() },
    }

    const metrics = await runBenchmark(
      'ws-broadcast-100',
      () => {
        manager.broadcastAll(state, message)
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['ws-broadcast-100'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark send to single connection', async () => {
    const manager = new WebSocketManager()
    const ws = createMockWebSocket('single')

    const message = {
      type: 'private',
      data: { content: 'Hello!', userId: 'user-123' },
    }

    const metrics = await runBenchmark(
      'ws-send-single',
      () => {
        manager.send(ws, message)
      },
      { iterations: 500, warmupIterations: 50 }
    )

    benchmarkResults['ws-send-single'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(500)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark connection tracking', async () => {
    const metrics = await runBenchmark(
      'ws-connection-tracking',
      () => {
        const manager = new WebSocketManager()
        const websockets: WebSocket[] = []

        // Simulate connection lifecycle
        for (let i = 0; i < 10; i++) {
          const ws = createMockWebSocket(`track-${i}`)
          websockets.push(ws)
        }

        // Clean up
        for (const ws of websockets) {
          manager.cleanupWebSocket(ws)
        }
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['ws-connection-tracking'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark large message broadcast', async () => {
    const manager = new WebSocketManager()
    const websockets = Array.from({ length: 50 }, (_, i) =>
      createMockWebSocket(`ws-${i}`)
    )
    const state = createMockState(websockets)

    // Large message (~5KB)
    const message = {
      type: 'data.sync',
      data: {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item-${i}`,
          name: `Item ${i}`,
          description: 'A'.repeat(50),
          metadata: { version: 1, updated: Date.now() },
        })),
      },
    }

    const metrics = await runBenchmark(
      'ws-broadcast-large-message',
      () => {
        manager.broadcastAll(state, message)
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['ws-broadcast-large-message'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThan(0)
  })

  it('should benchmark ping/pong handling', async () => {
    const manager = new WebSocketManager()
    const ws = createMockWebSocket('ping-test')

    // Initialize pong time
    manager.setLastPong(ws, Date.now())

    const metrics = await runBenchmark(
      'ws-ping-pong',
      () => {
        manager.sendPing(ws)
        manager.getLastPong(ws)
        manager.isStale(ws, 30000)
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['ws-ping-pong'] = metrics

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
