/**
 * Window Benchmarks
 *
 * Performance benchmarks for streaming window primitives supporting the Kafka compat layer.
 * Tests tumbling, sliding, and session window operations.
 *
 * Expected Performance:
 * | Operation | Expected |
 * |-----------|----------|
 * | add event | <5ms |
 * | trigger   | <10ms |
 * | slide     | <10ms |
 *
 * Reference: Apache Kafka Streams windowing semantics
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// TUMBLING WINDOW BENCHMARKS
// ============================================================================

describe('Window benchmarks', () => {
  describe('tumbling windows', () => {
    it('add event to 1-minute window', async () => {
      const result = await benchmark({
        name: 'window-tumbling-add',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/tumbling/1m/add', {
            method: 'POST',
            body: JSON.stringify({
              key: `user:${i % 10}`,
              value: Math.random(),
              timestamp: Date.now(),
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Tumbling Window Add Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
      expect(result.stats.p99).toBeLessThan(10)
    })

    it('trigger window evaluation', async () => {
      const result = await benchmark({
        name: 'window-tumbling-trigger',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/tumbling/1m/trigger', {
            method: 'POST',
            body: JSON.stringify({
              currentTime: Date.now() + i * 60000, // Advance time by 1 minute each iteration
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Tumbling Window Trigger Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
      expect(result.stats.p99).toBeLessThan(20)
    })

    it('get window contents', async () => {
      const result = await benchmark({
        name: 'window-tumbling-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request(`/windows/tumbling/1m/user:${i % 10}`, {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Tumbling Window Get Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // SLIDING WINDOW BENCHMARKS
  // ============================================================================

  describe('sliding windows', () => {
    it('add event to sliding window', async () => {
      const result = await benchmark({
        name: 'window-sliding-add',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/sliding/add', {
            method: 'POST',
            body: JSON.stringify({
              key: `sensor:${i % 5}`,
              value: Math.random() * 100,
              timestamp: Date.now() + i * 100, // 100ms apart
              windowSize: 60000, // 1 minute window
              slideInterval: 10000, // 10 second slide
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Sliding Window Add Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('slide window forward', async () => {
      const result = await benchmark({
        name: 'window-sliding-slide',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/sliding/slide', {
            method: 'POST',
            body: JSON.stringify({
              currentTime: Date.now() + i * 10000, // Slide by 10 seconds each iteration
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Sliding Window Slide Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('get current sliding window values', async () => {
      const result = await benchmark({
        name: 'window-sliding-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request(`/windows/sliding/sensor:${i % 5}`, {
            method: 'GET',
            headers: {
              'X-Current-Time': String(Date.now()),
            },
          })
        },
      })
      record(result)

      console.log('\n=== Sliding Window Get Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // SESSION WINDOW BENCHMARKS
  // ============================================================================

  describe('session windows', () => {
    it('add event extending session', async () => {
      const result = await benchmark({
        name: 'window-session-add',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          // Events within gap will extend session, beyond gap creates new session
          const gap = i % 5 === 0 ? 60000 : 1000 // Every 5th event has a larger gap
          return ctx.do.request('/windows/session/add', {
            method: 'POST',
            body: JSON.stringify({
              key: `user:${i % 10}`,
              value: { action: 'click', page: `/page/${i}` },
              timestamp: Date.now() + i * gap,
              gapDuration: 30000, // 30 second session gap
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Session Window Add Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('close expired sessions', async () => {
      const result = await benchmark({
        name: 'window-session-close',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/session/close', {
            method: 'POST',
            body: JSON.stringify({
              currentTime: Date.now() + i * 60000, // Advance by 1 minute each iteration
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Session Window Close Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('get active session count', async () => {
      const result = await benchmark({
        name: 'window-session-count',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/windows/session/count', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Session Window Count Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })

  // ============================================================================
  // AGGREGATE WINDOW BENCHMARKS
  // ============================================================================

  describe('window aggregations', () => {
    it('compute window sum aggregate', async () => {
      const result = await benchmark({
        name: 'window-aggregate-sum',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/aggregate/sum', {
            method: 'POST',
            body: JSON.stringify({
              windowKey: `tumbling:${Math.floor(i / 10)}`,
              key: `metric:${i % 5}`,
              value: Math.random() * 100,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window Aggregate Sum Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('compute window count aggregate', async () => {
      const result = await benchmark({
        name: 'window-aggregate-count',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/aggregate/count', {
            method: 'POST',
            body: JSON.stringify({
              windowKey: `tumbling:${Math.floor(i / 10)}`,
              key: `events:${i % 5}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window Aggregate Count Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('compute window average aggregate', async () => {
      const result = await benchmark({
        name: 'window-aggregate-avg',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/windows/aggregate/avg', {
            method: 'POST',
            body: JSON.stringify({
              windowKey: `tumbling:${Math.floor(i / 10)}`,
              key: `latency:${i % 5}`,
              value: Math.random() * 50 + 10, // 10-60ms latency values
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window Aggregate Avg Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })
})
