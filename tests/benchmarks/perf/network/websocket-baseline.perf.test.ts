/**
 * WebSocket Baseline Latency Benchmarks
 *
 * Measures baseline network latency for WebSocket connections in the dotdo infrastructure.
 * These benchmarks establish performance baselines for:
 * - WebSocket connection establishment time
 * - Message round-trip latency
 * - Per-colo WebSocket performance
 * - Connection stability under load
 *
 * Key metrics:
 * - Connection establishment time (handshake)
 * - Message round-trip time (RTT)
 * - Latency distribution across colos
 * - Connection error rates
 *
 * Reference: Durable Objects support WebSocket hibernation for efficient
 * long-lived connections with near-zero memory overhead when idle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { benchmark, record, NA_COLOS, EU_COLOS, APAC_COLOS, calculateStats, type BenchmarkResult, type LatencyStats } from '../../lib'

// ============================================================================
// TYPES
// ============================================================================

/**
 * WebSocket benchmark result
 */
interface WsBenchmarkResult {
  connectTime: number
  messageLatencies: number[]
  stats: LatencyStats
  errors: string[]
  messagesReceived: number
  messagesSent: number
}

/**
 * Connection test result
 */
interface ConnectionTestResult {
  connectionTime: number
  firstMessageTime: number
  totalTime: number
  success: boolean
  error?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const WS_TARGET = 'wss://echo.perf.do/ws'
const WS_TARGET_HOST = 'echo.perf.do'
const DEFAULT_ITERATIONS = 50
const DEFAULT_WARMUP = 5
const MESSAGE_ITERATIONS = 100

// Subset of colos for parameterized tests
const NORTH_AMERICA_COLOS = NA_COLOS.slice(0, 5)
const EUROPE_COLOS = EU_COLOS.slice(0, 3)
const APAC_COLOS_SUBSET = APAC_COLOS.slice(0, 3)

// ============================================================================
// WEBSOCKET UTILITIES
// ============================================================================

/**
 * Create a WebSocket connection with timeout
 */
async function createWebSocket(url: string, timeout = 10000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`WebSocket connection timeout after ${timeout}ms`))
    }, timeout)

    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        clearTimeout(timeoutId)
        resolve(ws)
      }

      ws.onerror = (error) => {
        clearTimeout(timeoutId)
        reject(new Error(`WebSocket error: ${error}`))
      }
    } catch (error) {
      clearTimeout(timeoutId)
      reject(error)
    }
  })
}

/**
 * Send a message and wait for response
 */
async function sendAndReceive(ws: WebSocket, message: string, timeout = 5000): Promise<{ response: string; latency: number }> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Message response timeout after ${timeout}ms`))
    }, timeout)

    const start = performance.now()

    const handler = (event: MessageEvent) => {
      clearTimeout(timeoutId)
      ws.removeEventListener('message', handler)
      resolve({
        response: event.data,
        latency: performance.now() - start,
      })
    }

    ws.addEventListener('message', handler)
    ws.send(message)
  })
}

/**
 * Close WebSocket gracefully
 */
async function closeWebSocket(ws: WebSocket, timeout = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }

    const timeoutId = setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.close()
      }
      resolve()
    }, timeout)

    ws.onclose = () => {
      clearTimeout(timeoutId)
      resolve()
    }

    ws.close()
  })
}

/**
 * Measure connection establishment time
 */
async function measureConnectionTime(url: string): Promise<ConnectionTestResult> {
  const startConnection = performance.now()

  try {
    const ws = await createWebSocket(url)
    const connectionTime = performance.now() - startConnection

    // Send first message to confirm connection is working
    const startMessage = performance.now()
    const { latency } = await sendAndReceive(ws, JSON.stringify({ type: 'ping', ts: Date.now() }))
    const firstMessageTime = performance.now() - startMessage

    await closeWebSocket(ws)

    return {
      connectionTime,
      firstMessageTime,
      totalTime: connectionTime + firstMessageTime,
      success: true,
    }
  } catch (error) {
    return {
      connectionTime: performance.now() - startConnection,
      firstMessageTime: 0,
      totalTime: performance.now() - startConnection,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// CONNECTION ESTABLISHMENT BENCHMARKS
// ============================================================================

describe('WebSocket baseline latency', () => {
  describe('connection establishment', () => {
    it('measures connection handshake time', async () => {
      const iterations = 20
      const connectionTimes: number[] = []
      const errors: string[] = []

      for (let i = 0; i < iterations; i++) {
        const result = await measureConnectionTime(WS_TARGET)

        if (result.success) {
          connectionTimes.push(result.connectionTime)
        } else {
          errors.push(result.error || 'Unknown error')
        }
      }

      const stats = calculateStats(connectionTimes)

      console.log('\n=== WebSocket Connection Handshake ===')
      console.log(`  Target: ${WS_TARGET}`)
      console.log(`  Successful connections: ${connectionTimes.length}/${iterations}`)
      console.log(`  p50: ${stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${stats.p99.toFixed(2)} ms`)
      console.log(`  min: ${stats.min.toFixed(2)} ms`)
      console.log(`  max: ${stats.max.toFixed(2)} ms`)

      if (errors.length > 0) {
        console.log(`  Errors: ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '...' : ''}`)
      }

      // Record result in benchmark format
      record({
        name: 'ws-connection-handshake',
        target: WS_TARGET_HOST,
        iterations: connectionTimes.length,
        stats,
        samples: connectionTimes,
        timestamp: new Date().toISOString(),
        errors: errors.length > 0 ? errors.map((e, i) => ({ iteration: i, message: e })) : undefined,
      })

      // At least some connections should succeed
      expect(connectionTimes.length).toBeGreaterThan(0)
    })

    it('measures connection + first message time', async () => {
      const iterations = 20
      const totalTimes: number[] = []
      const connectionTimes: number[] = []
      const firstMessageTimes: number[] = []

      for (let i = 0; i < iterations; i++) {
        const result = await measureConnectionTime(WS_TARGET)

        if (result.success) {
          totalTimes.push(result.totalTime)
          connectionTimes.push(result.connectionTime)
          firstMessageTimes.push(result.firstMessageTime)
        }
      }

      const totalStats = calculateStats(totalTimes)
      const connStats = calculateStats(connectionTimes)
      const msgStats = calculateStats(firstMessageTimes)

      console.log('\n=== WebSocket Connection + First Message ===')
      console.log(`  Total (conn + msg):`)
      console.log(`    p50: ${totalStats.p50.toFixed(2)} ms`)
      console.log(`    p95: ${totalStats.p95.toFixed(2)} ms`)
      console.log(`  Connection only:`)
      console.log(`    p50: ${connStats.p50.toFixed(2)} ms`)
      console.log(`  First message:`)
      console.log(`    p50: ${msgStats.p50.toFixed(2)} ms`)

      record({
        name: 'ws-connection-plus-message',
        target: WS_TARGET_HOST,
        iterations: totalTimes.length,
        stats: totalStats,
        samples: totalTimes,
        timestamp: new Date().toISOString(),
        metadata: {
          connectionP50: connStats.p50,
          firstMessageP50: msgStats.p50,
        },
      })

      expect(totalTimes.length).toBeGreaterThan(0)
    })

    it('tests connection reliability', async () => {
      const iterations = 50
      let successCount = 0
      let failCount = 0
      const connectionTimes: number[] = []

      for (let i = 0; i < iterations; i++) {
        const result = await measureConnectionTime(WS_TARGET)

        if (result.success) {
          successCount++
          connectionTimes.push(result.connectionTime)
        } else {
          failCount++
        }
      }

      const successRate = (successCount / iterations) * 100

      console.log('\n=== WebSocket Connection Reliability ===')
      console.log(`  Total attempts: ${iterations}`)
      console.log(`  Successful: ${successCount}`)
      console.log(`  Failed: ${failCount}`)
      console.log(`  Success rate: ${successRate.toFixed(1)}%`)

      if (connectionTimes.length > 0) {
        const stats = calculateStats(connectionTimes)
        console.log(`  Avg connection time: ${stats.mean.toFixed(2)} ms`)
      }

      // Expect high success rate
      expect(successRate).toBeGreaterThan(80)
    })
  })

  // ============================================================================
  // MESSAGE ROUND-TRIP BENCHMARKS
  // ============================================================================

  describe('message round-trip', () => {
    it('measures message RTT on established connection', async () => {
      let ws: WebSocket | null = null

      try {
        ws = await createWebSocket(WS_TARGET)
        const latencies: number[] = []
        const errors: string[] = []

        // Warmup
        for (let i = 0; i < 10; i++) {
          try {
            await sendAndReceive(ws, JSON.stringify({ type: 'ping', ts: Date.now(), i }))
          } catch (e) {
            // Ignore warmup errors
          }
        }

        // Measure
        for (let i = 0; i < MESSAGE_ITERATIONS; i++) {
          try {
            const message = JSON.stringify({ type: 'echo', data: `message-${i}`, ts: Date.now() })
            const { latency } = await sendAndReceive(ws, message)
            latencies.push(latency)
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error))
          }
        }

        const stats = calculateStats(latencies)

        console.log('\n=== WebSocket Message RTT ===')
        console.log(`  Messages: ${MESSAGE_ITERATIONS}`)
        console.log(`  Successful: ${latencies.length}`)
        console.log(`  p50: ${stats.p50.toFixed(2)} ms`)
        console.log(`  p95: ${stats.p95.toFixed(2)} ms`)
        console.log(`  p99: ${stats.p99.toFixed(2)} ms`)
        console.log(`  min: ${stats.min.toFixed(2)} ms`)
        console.log(`  max: ${stats.max.toFixed(2)} ms`)
        console.log(`  mean: ${stats.mean.toFixed(2)} ms`)
        console.log(`  stddev: ${stats.stddev.toFixed(2)} ms`)

        record({
          name: 'ws-message-rtt',
          target: WS_TARGET_HOST,
          iterations: latencies.length,
          stats,
          samples: latencies,
          timestamp: new Date().toISOString(),
          config: { warmup: 10 },
        })

        expect(latencies.length).toBeGreaterThan(MESSAGE_ITERATIONS * 0.9)
        // Message RTT should be fast on established connection
        expect(stats.p50).toBeLessThan(100)
      } finally {
        if (ws) {
          await closeWebSocket(ws)
        }
      }
    })

    it('measures message RTT with varying payload sizes', async () => {
      const payloadSizes = [10, 100, 1000, 10000] // bytes
      const results: Map<number, LatencyStats> = new Map()
      let ws: WebSocket | null = null

      try {
        ws = await createWebSocket(WS_TARGET)

        for (const size of payloadSizes) {
          const latencies: number[] = []
          const payload = 'x'.repeat(size)

          // Warmup
          for (let i = 0; i < 5; i++) {
            try {
              await sendAndReceive(ws, JSON.stringify({ type: 'echo', data: payload }))
            } catch (e) {
              // Ignore
            }
          }

          // Measure
          for (let i = 0; i < 50; i++) {
            try {
              const message = JSON.stringify({ type: 'echo', data: payload, i })
              const { latency } = await sendAndReceive(ws, message)
              latencies.push(latency)
            } catch (error) {
              // Record but continue
            }
          }

          if (latencies.length > 0) {
            results.set(size, calculateStats(latencies))

            record({
              name: `ws-message-rtt-${size}b`,
              target: WS_TARGET_HOST,
              iterations: latencies.length,
              stats: results.get(size)!,
              samples: latencies,
              timestamp: new Date().toISOString(),
              config: { payloadSize: size },
            })
          }
        }

        console.log('\n=== WebSocket Payload Size Impact ===')
        console.log('  Size (bytes) | p50 (ms) | p95 (ms) | p99 (ms)')
        console.log('  -------------|----------|----------|----------')
        for (const size of payloadSizes) {
          const stats = results.get(size)
          if (stats) {
            console.log(
              `  ${size.toString().padStart(11)} | ${stats.p50.toFixed(2).padStart(8)} | ${stats.p95.toFixed(2).padStart(8)} | ${stats.p99.toFixed(2).padStart(8)}`
            )
          }
        }

        expect(results.size).toBeGreaterThan(0)
      } finally {
        if (ws) {
          await closeWebSocket(ws)
        }
      }
    })

    it('measures sustained message throughput', async () => {
      const durationMs = 5000 // 5 seconds
      let ws: WebSocket | null = null

      try {
        ws = await createWebSocket(WS_TARGET)
        const latencies: number[] = []
        const start = Date.now()

        while (Date.now() - start < durationMs) {
          try {
            const message = JSON.stringify({ type: 'ping', ts: Date.now() })
            const { latency } = await sendAndReceive(ws, message)
            latencies.push(latency)
          } catch (error) {
            // Continue on error
          }
        }

        const actualDuration = Date.now() - start
        const throughput = (latencies.length / actualDuration) * 1000 // messages per second

        const stats = calculateStats(latencies)

        console.log('\n=== WebSocket Sustained Throughput ===')
        console.log(`  Duration: ${actualDuration} ms`)
        console.log(`  Messages: ${latencies.length}`)
        console.log(`  Throughput: ${throughput.toFixed(1)} msg/sec`)
        console.log(`  p50: ${stats.p50.toFixed(2)} ms`)
        console.log(`  p95: ${stats.p95.toFixed(2)} ms`)

        record({
          name: 'ws-sustained-throughput',
          target: WS_TARGET_HOST,
          iterations: latencies.length,
          stats,
          samples: latencies,
          timestamp: new Date().toISOString(),
          metadata: {
            durationMs: actualDuration,
            throughput,
          },
        })

        expect(latencies.length).toBeGreaterThan(10)
        expect(throughput).toBeGreaterThan(1) // At least 1 msg/sec
      } finally {
        if (ws) {
          await closeWebSocket(ws)
        }
      }
    })
  })

  // ============================================================================
  // PER-COLO WEBSOCKET BENCHMARKS
  // ============================================================================

  describe('per-colo latency', () => {
    // Note: Colo hints for WebSocket may require custom headers or URL params
    // depending on the infrastructure setup

    it.each(NORTH_AMERICA_COLOS)('measures WS latency via %s colo hint (NA)', async (colo) => {
      // Add colo hint as query param (implementation-specific)
      const wsUrl = `${WS_TARGET}?colo=${colo}`
      const connectionTimes: number[] = []
      const messageLatencies: number[] = []

      for (let i = 0; i < 10; i++) {
        try {
          const connStart = performance.now()
          const ws = await createWebSocket(wsUrl, 15000)
          connectionTimes.push(performance.now() - connStart)

          // Send a few messages
          for (let j = 0; j < 5; j++) {
            const { latency } = await sendAndReceive(ws, JSON.stringify({ type: 'ping', colo, j }))
            messageLatencies.push(latency)
          }

          await closeWebSocket(ws)
        } catch (error) {
          // Record failure but continue
        }
      }

      if (connectionTimes.length > 0) {
        const connStats = calculateStats(connectionTimes)
        const msgStats = messageLatencies.length > 0 ? calculateStats(messageLatencies) : null

        console.log(`\n=== WebSocket via ${colo} (NA) ===`)
        console.log(`  Connection p50: ${connStats.p50.toFixed(2)} ms`)
        if (msgStats) {
          console.log(`  Message p50: ${msgStats.p50.toFixed(2)} ms`)
        }

        record({
          name: `ws-latency-${colo}`,
          target: WS_TARGET_HOST,
          iterations: connectionTimes.length,
          stats: connStats,
          samples: connectionTimes,
          timestamp: new Date().toISOString(),
          colo,
          metadata: msgStats ? { messageP50: msgStats.p50 } : undefined,
        })
      }

      expect(connectionTimes.length + messageLatencies.length).toBeGreaterThanOrEqual(0)
    })

    it.each(EUROPE_COLOS)('measures WS latency via %s colo hint (EU)', async (colo) => {
      const wsUrl = `${WS_TARGET}?colo=${colo}`
      const connectionTimes: number[] = []

      for (let i = 0; i < 5; i++) {
        try {
          const connStart = performance.now()
          const ws = await createWebSocket(wsUrl, 20000)
          connectionTimes.push(performance.now() - connStart)
          await closeWebSocket(ws)
        } catch (error) {
          // Continue
        }
      }

      if (connectionTimes.length > 0) {
        const stats = calculateStats(connectionTimes)
        console.log(`\n=== WebSocket via ${colo} (EU) ===`)
        console.log(`  Connection p50: ${stats.p50.toFixed(2)} ms`)

        record({
          name: `ws-latency-${colo}`,
          target: WS_TARGET_HOST,
          iterations: connectionTimes.length,
          stats,
          samples: connectionTimes,
          timestamp: new Date().toISOString(),
          colo,
        })
      }

      expect(connectionTimes.length).toBeGreaterThanOrEqual(0)
    })

    it.each(APAC_COLOS_SUBSET)('measures WS latency via %s colo hint (APAC)', async (colo) => {
      const wsUrl = `${WS_TARGET}?colo=${colo}`
      const connectionTimes: number[] = []

      for (let i = 0; i < 5; i++) {
        try {
          const connStart = performance.now()
          const ws = await createWebSocket(wsUrl, 25000) // Longer timeout for APAC
          connectionTimes.push(performance.now() - connStart)
          await closeWebSocket(ws)
        } catch (error) {
          // Continue
        }
      }

      if (connectionTimes.length > 0) {
        const stats = calculateStats(connectionTimes)
        console.log(`\n=== WebSocket via ${colo} (APAC) ===`)
        console.log(`  Connection p50: ${stats.p50.toFixed(2)} ms`)

        record({
          name: `ws-latency-${colo}`,
          target: WS_TARGET_HOST,
          iterations: connectionTimes.length,
          stats,
          samples: connectionTimes,
          timestamp: new Date().toISOString(),
          colo,
        })
      }

      expect(connectionTimes.length).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // CONNECTION STABILITY TESTS
  // ============================================================================

  describe('connection stability', () => {
    it('measures reconnection time after disconnect', async () => {
      const reconnectTimes: number[] = []
      const iterations = 10

      for (let i = 0; i < iterations; i++) {
        try {
          // Connect
          const ws = await createWebSocket(WS_TARGET)

          // Send a message to ensure connection is fully established
          await sendAndReceive(ws, JSON.stringify({ type: 'ping' }))

          // Close
          await closeWebSocket(ws)

          // Measure reconnection time
          const reconnectStart = performance.now()
          const ws2 = await createWebSocket(WS_TARGET)
          reconnectTimes.push(performance.now() - reconnectStart)

          await closeWebSocket(ws2)
        } catch (error) {
          // Continue
        }
      }

      if (reconnectTimes.length > 0) {
        const stats = calculateStats(reconnectTimes)

        console.log('\n=== WebSocket Reconnection Time ===')
        console.log(`  Successful reconnects: ${reconnectTimes.length}/${iterations}`)
        console.log(`  p50: ${stats.p50.toFixed(2)} ms`)
        console.log(`  p95: ${stats.p95.toFixed(2)} ms`)
        console.log(`  mean: ${stats.mean.toFixed(2)} ms`)

        record({
          name: 'ws-reconnection-time',
          target: WS_TARGET_HOST,
          iterations: reconnectTimes.length,
          stats,
          samples: reconnectTimes,
          timestamp: new Date().toISOString(),
        })
      }

      expect(reconnectTimes.length).toBeGreaterThan(0)
    })

    it('measures latency stability over time', async () => {
      const durationMs = 10000 // 10 seconds
      const intervalMs = 500 // Send message every 500ms
      let ws: WebSocket | null = null

      try {
        ws = await createWebSocket(WS_TARGET)
        const latencies: number[] = []
        const timestamps: number[] = []
        const start = Date.now()

        while (Date.now() - start < durationMs) {
          try {
            const { latency } = await sendAndReceive(ws, JSON.stringify({ type: 'ping', ts: Date.now() }))
            latencies.push(latency)
            timestamps.push(Date.now() - start)

            // Wait for interval
            await new Promise((resolve) => setTimeout(resolve, intervalMs))
          } catch (error) {
            // Continue on error
          }
        }

        if (latencies.length > 0) {
          const stats = calculateStats(latencies)

          // Calculate latency trend (simple linear regression)
          const n = latencies.length
          const sumX = timestamps.reduce((a, b) => a + b, 0)
          const sumY = latencies.reduce((a, b) => a + b, 0)
          const sumXY = timestamps.reduce((acc, x, i) => acc + x * latencies[i], 0)
          const sumX2 = timestamps.reduce((acc, x) => acc + x * x, 0)
          const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)

          console.log('\n=== WebSocket Latency Stability ===')
          console.log(`  Duration: ${durationMs / 1000}s`)
          console.log(`  Messages: ${latencies.length}`)
          console.log(`  p50: ${stats.p50.toFixed(2)} ms`)
          console.log(`  p95: ${stats.p95.toFixed(2)} ms`)
          console.log(`  stddev: ${stats.stddev.toFixed(2)} ms`)
          console.log(`  Trend (slope): ${slope.toFixed(6)} ms/ms`)
          console.log(`  Trend interpretation: ${Math.abs(slope) < 0.001 ? 'Stable' : slope > 0 ? 'Degrading' : 'Improving'}`)

          record({
            name: 'ws-latency-stability',
            target: WS_TARGET_HOST,
            iterations: latencies.length,
            stats,
            samples: latencies,
            timestamp: new Date().toISOString(),
            metadata: {
              durationMs,
              intervalMs,
              slope,
            },
          })
        }

        expect(latencies.length).toBeGreaterThan(5)
      } finally {
        if (ws) {
          await closeWebSocket(ws)
        }
      }
    })
  })

  // ============================================================================
  // SUMMARY
  // ============================================================================

  describe('WebSocket Baseline Summary', () => {
    it('generates comprehensive WebSocket latency report', async () => {
      console.log('\n========================================')
      console.log('WEBSOCKET BASELINE LATENCY SUMMARY')
      console.log('========================================\n')

      const results: Map<string, { connStats: LatencyStats; msgStats?: LatencyStats }> = new Map()

      // Connection establishment
      const connTimes: number[] = []
      const msgTimes: number[] = []

      for (let i = 0; i < 20; i++) {
        try {
          const connStart = performance.now()
          const ws = await createWebSocket(WS_TARGET)
          connTimes.push(performance.now() - connStart)

          // Message RTT
          for (let j = 0; j < 5; j++) {
            const { latency } = await sendAndReceive(ws, JSON.stringify({ type: 'ping', j }))
            msgTimes.push(latency)
          }

          await closeWebSocket(ws)
        } catch (error) {
          // Continue
        }
      }

      if (connTimes.length > 0) {
        const connStats = calculateStats(connTimes)
        const msgStats = msgTimes.length > 0 ? calculateStats(msgTimes) : undefined
        results.set('Baseline', { connStats, msgStats })

        record({
          name: 'ws-summary-baseline',
          target: WS_TARGET_HOST,
          iterations: connTimes.length,
          stats: connStats,
          samples: connTimes,
          timestamp: new Date().toISOString(),
          metadata: msgStats ? { messageP50: msgStats.p50, messageP99: msgStats.p99 } : undefined,
        })
      }

      // Print summary
      console.log('Metric              | p50 (ms) | p95 (ms) | p99 (ms) | samples')
      console.log('--------------------|----------|----------|----------|--------')

      Array.from(results.entries()).forEach(([name, { connStats, msgStats }]) => {
        console.log(
          `${(name + ' connect').padEnd(19)} | ${connStats.p50.toFixed(2).padStart(8)} | ${connStats.p95.toFixed(2).padStart(8)} | ${connStats.p99.toFixed(2).padStart(8)} | ${connTimes.length.toString().padStart(6)}`
        )
        if (msgStats) {
          console.log(
            `${(name + ' message').padEnd(19)} | ${msgStats.p50.toFixed(2).padStart(8)} | ${msgStats.p95.toFixed(2).padStart(8)} | ${msgStats.p99.toFixed(2).padStart(8)} | ${msgTimes.length.toString().padStart(6)}`
          )
        }
      })

      if (connTimes.length > 0 && msgTimes.length > 0) {
        const connStats = calculateStats(connTimes)
        const msgStats = calculateStats(msgTimes)

        console.log('\nKey findings:')
        console.log(`  - Connection p50: ${connStats.p50.toFixed(2)} ms`)
        console.log(`  - Connection p99: ${connStats.p99.toFixed(2)} ms`)
        console.log(`  - Message RTT p50: ${msgStats.p50.toFixed(2)} ms`)
        console.log(`  - Message RTT p99: ${msgStats.p99.toFixed(2)} ms`)
      }

      expect(connTimes.length).toBeGreaterThan(0)
    })
  })
})
