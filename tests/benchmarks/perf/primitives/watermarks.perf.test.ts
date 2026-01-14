/**
 * Watermark Benchmarks
 *
 * Performance benchmarks for watermark management in streaming primitives.
 * Watermarks track event-time progress and enable late arrival detection.
 *
 * Expected Performance:
 * | Operation | Expected |
 * |-----------|----------|
 * | advance   | <2ms |
 * | check late| <1ms |
 * | get       | <1ms |
 *
 * Reference: Apache Flink watermark semantics
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// WATERMARK BENCHMARKS
// ============================================================================

describe('Watermark benchmarks', () => {
  describe('watermark advance', () => {
    it('advance watermark for single source', async () => {
      const result = await benchmark({
        name: 'watermark-advance-single',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/watermarks/advance', {
            method: 'POST',
            body: JSON.stringify({
              sourceId: 'source-1',
              timestamp: Date.now() + i * 1000,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Advance Single Source Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
      expect(result.stats.p99).toBeLessThan(5)
    })

    it('advance watermark for multiple sources', async () => {
      const result = await benchmark({
        name: 'watermark-advance-multi',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/watermarks/advance', {
            method: 'POST',
            body: JSON.stringify({
              sourceId: `source-${i % 10}`,
              timestamp: Date.now() + i * 100,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Advance Multi Source Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('advance watermark with event batch', async () => {
      const result = await benchmark({
        name: 'watermark-advance-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const advances = Array.from({ length: 10 }, (_, j) => ({
            sourceId: `source-${j}`,
            timestamp: Date.now() + i * 1000 + j * 100,
          }))
          return ctx.do.request('/watermarks/advance/batch', {
            method: 'POST',
            body: JSON.stringify({ advances }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Advance Batch Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // LATE ARRIVAL CHECK BENCHMARKS
  // ============================================================================

  describe('late arrival check', () => {
    it('check if event is late', async () => {
      const result = await benchmark({
        name: 'watermark-check-late',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          // Mix of late and on-time events
          const offset = i % 2 === 0 ? -5000 : 5000 // Alternating late/early
          return ctx.do.request('/watermarks/check-late', {
            method: 'POST',
            body: JSON.stringify({
              eventTime: Date.now() + offset,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Check Late Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
      expect(result.stats.p99).toBeLessThan(2)
    })

    it('check batch of events for lateness', async () => {
      const result = await benchmark({
        name: 'watermark-check-late-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const events = Array.from({ length: 50 }, (_, j) => ({
            eventId: `event-${i}-${j}`,
            eventTime: Date.now() + (j % 2 === 0 ? -10000 : 1000),
          }))
          return ctx.do.request('/watermarks/check-late/batch', {
            method: 'POST',
            body: JSON.stringify({ events }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Check Late Batch Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('check late with allowed lateness', async () => {
      const result = await benchmark({
        name: 'watermark-check-late-allowed',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/watermarks/check-late', {
            method: 'POST',
            body: JSON.stringify({
              eventTime: Date.now() - 3000, // 3 seconds late
              allowedLateness: 5000, // 5 second allowed lateness
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Check Late with Allowed Lateness Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })
  })

  // ============================================================================
  // GET WATERMARK BENCHMARKS
  // ============================================================================

  describe('get watermark', () => {
    it('get current global watermark', async () => {
      const result = await benchmark({
        name: 'watermark-get-global',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/watermarks/current', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Get Global Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
      expect(result.stats.p99).toBeLessThan(2)
    })

    it('get watermark for specific source', async () => {
      const result = await benchmark({
        name: 'watermark-get-source',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request(`/watermarks/source/${`source-${i % 10}`}`, {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Get Source Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })

    it('get all source watermarks', async () => {
      const result = await benchmark({
        name: 'watermark-get-all',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/watermarks/all', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Get All Sources Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })
  })

  // ============================================================================
  // WATERMARK ALIGNMENT BENCHMARKS
  // ============================================================================

  describe('watermark alignment', () => {
    it('align watermarks across partitions', async () => {
      const result = await benchmark({
        name: 'watermark-align-partitions',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/watermarks/align', {
            method: 'POST',
            body: JSON.stringify({
              partitions: Array.from({ length: 8 }, (_, j) => ({
                partitionId: j,
                watermark: Date.now() + (i * 1000) - (j * 100),
              })),
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Align Partitions Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('compute minimum watermark', async () => {
      const result = await benchmark({
        name: 'watermark-compute-min',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/watermarks/min', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Compute Min Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })

    it('emit watermark downstream', async () => {
      const result = await benchmark({
        name: 'watermark-emit',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/watermarks/emit', {
            method: 'POST',
            body: JSON.stringify({
              timestamp: Date.now() + i * 1000,
              downstream: ['operator-1', 'operator-2', 'operator-3'],
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Watermark Emit Downstream Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })
})
