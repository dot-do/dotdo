/**
 * State Benchmarks (StatefulOperator)
 *
 * Performance benchmarks for stateful stream processing operators.
 * Tests keyed state, window state, and checkpoint operations.
 *
 * Expected Performance:
 * | Operation | Expected |
 * |-----------|----------|
 * | keyed get | <3ms |
 * | keyed update | <3ms |
 * | aggregate | <5ms |
 * | checkpoint | <20ms |
 *
 * Reference: Flink stateful stream processing
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// KEYED STATE BENCHMARKS
// ============================================================================

describe('State benchmarks (StatefulOperator)', () => {
  describe('keyed state', () => {
    it('keyed state get', async () => {
      const result = await benchmark({
        name: 'state-keyed-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-populate state for get testing
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/state/keyed/update', {
              method: 'POST',
              body: JSON.stringify({
                key: `user:${i}`,
                value: { count: i, lastSeen: Date.now(), data: `data-${i}` },
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request(`/state/keyed/get/user:${i % 100}`, {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== State Keyed Get Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
      expect(result.stats.p99).toBeLessThan(10)
    })

    it('keyed state update', async () => {
      const result = await benchmark({
        name: 'state-keyed-update',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/keyed/update', {
            method: 'POST',
            body: JSON.stringify({
              key: `user:${i % 100}`,
              value: {
                count: i,
                lastSeen: Date.now(),
                data: `updated-data-${i}`,
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== State Keyed Update Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('keyed state delete', async () => {
      const result = await benchmark({
        name: 'state-keyed-delete',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-populate state for delete testing
          for (let i = 0; i < 110; i++) {
            await ctx.do.request('/state/keyed/update', {
              method: 'POST',
              body: JSON.stringify({
                key: `delete-test:${i}`,
                value: { toDelete: true },
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request(`/state/keyed/delete/delete-test:${i + 10}`, {
            method: 'DELETE',
          })
        },
      })
      record(result)

      console.log('\n=== State Keyed Delete Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('keyed state batch get', async () => {
      const result = await benchmark({
        name: 'state-keyed-batch-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const keys = Array.from({ length: 20 }, (_, j) => `user:${(i * 20 + j) % 100}`)
          return ctx.do.request('/state/keyed/batch-get', {
            method: 'POST',
            body: JSON.stringify({ keys }),
          })
        },
      })
      record(result)

      console.log('\n=== State Keyed Batch Get Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('keyed state list keys', async () => {
      const result = await benchmark({
        name: 'state-keyed-list',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/keyed/list', {
            method: 'GET',
            headers: {
              'X-Prefix': 'user:',
              'X-Limit': '50',
              'X-Offset': String(i * 10),
            },
          })
        },
      })
      record(result)

      console.log('\n=== State Keyed List Keys Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // WINDOW STATE BENCHMARKS
  // ============================================================================

  describe('window state', () => {
    it('window state aggregate sum', async () => {
      const result = await benchmark({
        name: 'state-window-aggregate-sum',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/window/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              key: `metric:${i % 10}`,
              windowKey: `window:${Math.floor(i / 10)}`,
              value: Math.random() * 100,
              aggregator: 'sum',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window State Aggregate Sum Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
      expect(result.stats.p99).toBeLessThan(10)
    })

    it('window state aggregate count', async () => {
      const result = await benchmark({
        name: 'state-window-aggregate-count',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/window/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              key: `events:${i % 10}`,
              windowKey: `window:${Math.floor(i / 10)}`,
              value: 1,
              aggregator: 'count',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window State Aggregate Count Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('window state aggregate max', async () => {
      const result = await benchmark({
        name: 'state-window-aggregate-max',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/window/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              key: `peak:${i % 10}`,
              windowKey: `window:${Math.floor(i / 10)}`,
              value: Math.random() * 1000,
              aggregator: 'max',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window State Aggregate Max Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('get window state', async () => {
      const result = await benchmark({
        name: 'state-window-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request(`/state/window/get/metric:${i % 10}/window:${i % 10}`, {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Window State Get Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('clear window state', async () => {
      const result = await benchmark({
        name: 'state-window-clear',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/window/clear', {
            method: 'POST',
            body: JSON.stringify({
              windowKey: `clear-window:${i}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Window State Clear Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // STATE CHECKPOINT BENCHMARKS
  // ============================================================================

  describe('state checkpointing', () => {
    it('checkpoint create', async () => {
      const result = await benchmark({
        name: 'state-checkpoint-create',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Populate state for checkpointing
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/state/keyed/update', {
              method: 'POST',
              body: JSON.stringify({
                key: `checkpoint-key:${i}`,
                value: { index: i, data: 'x'.repeat(50) },
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/state/checkpoint/create', {
            method: 'POST',
            body: JSON.stringify({
              checkpointId: `state-chk-${i}`,
              includeWindowState: true,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== State Checkpoint Create Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(20)
      expect(result.stats.p99).toBeLessThan(50)
    })

    it('checkpoint restore', async () => {
      const result = await benchmark({
        name: 'state-checkpoint-restore',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create checkpoints for restore testing
          for (let i = 0; i < 10; i++) {
            await ctx.do.request('/state/checkpoint/create', {
              method: 'POST',
              body: JSON.stringify({
                checkpointId: `restore-state-chk-${i}`,
                includeWindowState: true,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/state/checkpoint/restore', {
            method: 'POST',
            body: JSON.stringify({
              checkpointId: `restore-state-chk-${i % 10}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== State Checkpoint Restore Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(15)
    })

    it('incremental checkpoint', async () => {
      const result = await benchmark({
        name: 'state-checkpoint-incremental',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          // Update a few keys then create incremental checkpoint
          await ctx.do.request('/state/keyed/update', {
            method: 'POST',
            body: JSON.stringify({
              key: `incremental-key:${i % 10}`,
              value: { iteration: i, timestamp: Date.now() },
            }),
          })

          return ctx.do.request('/state/checkpoint/incremental', {
            method: 'POST',
            body: JSON.stringify({
              baseCheckpointId: `restore-state-chk-0`,
              newCheckpointId: `incremental-chk-${i}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== State Checkpoint Incremental Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('list checkpoints', async () => {
      const result = await benchmark({
        name: 'state-checkpoint-list',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/state/checkpoint/list', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== State Checkpoint List Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })

  // ============================================================================
  // STATE TTL BENCHMARKS
  // ============================================================================

  describe('state TTL', () => {
    it('set state with TTL', async () => {
      const result = await benchmark({
        name: 'state-ttl-set',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/state/keyed/update', {
            method: 'POST',
            body: JSON.stringify({
              key: `ttl-key:${i}`,
              value: { data: `value-${i}` },
              ttl: 60000, // 1 minute TTL
            }),
          })
        },
      })
      record(result)

      console.log('\n=== State TTL Set Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('cleanup expired state', async () => {
      const result = await benchmark({
        name: 'state-ttl-cleanup',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/state/ttl/cleanup', {
            method: 'POST',
            body: JSON.stringify({
              currentTime: Date.now(),
            }),
          })
        },
      })
      record(result)

      console.log('\n=== State TTL Cleanup Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })
  })
})
