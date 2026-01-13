/**
 * Transaction Benchmarks (ExactlyOnce)
 *
 * Performance benchmarks for exactly-once transaction processing.
 * Tests transaction lifecycle, deduplication, and checkpoint barriers.
 *
 * Expected Performance:
 * | Operation | Expected |
 * |-----------|----------|
 * | begin     | <2ms |
 * | commit    | <10ms |
 * | dedup     | <3ms |
 * | checkpoint| <20ms |
 *
 * Reference: Kafka exactly-once semantics (EOS)
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// TRANSACTION LIFECYCLE BENCHMARKS
// ============================================================================

describe('Transaction benchmarks (ExactlyOnce)', () => {
  describe('transaction lifecycle', () => {
    it('begin transaction', async () => {
      const result = await benchmark({
        name: 'transaction-begin',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/begin', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: `tx-${Date.now()}-${i}`,
              producerId: `producer-${i % 5}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Begin Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
      expect(result.stats.p99).toBeLessThan(5)
    })

    it('commit transaction', async () => {
      const result = await benchmark({
        name: 'transaction-commit',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-create transactions for commit testing
          for (let i = 0; i < 120; i++) {
            await ctx.do.request('/transactions/begin', {
              method: 'POST',
              body: JSON.stringify({
                transactionId: `commit-test-tx-${i}`,
                producerId: `producer-${i % 5}`,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/commit', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: `commit-test-tx-${i + 10}`, // Skip warmup transactions
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Commit Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
      expect(result.stats.p99).toBeLessThan(20)
    })

    it('abort transaction', async () => {
      const result = await benchmark({
        name: 'transaction-abort',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-create transactions for abort testing
          for (let i = 0; i < 120; i++) {
            await ctx.do.request('/transactions/begin', {
              method: 'POST',
              body: JSON.stringify({
                transactionId: `abort-test-tx-${i}`,
                producerId: `producer-${i % 5}`,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/abort', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: `abort-test-tx-${i + 10}`,
              reason: 'benchmark-test',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Abort Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('add records to transaction', async () => {
      const result = await benchmark({
        name: 'transaction-add-record',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create a transaction for adding records
          await ctx.do.request('/transactions/begin', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: 'add-records-tx',
              producerId: 'producer-bench',
            }),
          })
        },
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/add-record', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: 'add-records-tx',
              record: {
                id: `record-${i}`,
                key: `key-${i % 10}`,
                value: { data: `value-${i}`, timestamp: Date.now() },
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Add Record Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })

  // ============================================================================
  // DEDUPLICATION BENCHMARKS
  // ============================================================================

  describe('deduplication', () => {
    it('process with deduplication', async () => {
      const result = await benchmark({
        name: 'transaction-dedup-process',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/dedup/process', {
            method: 'POST',
            body: JSON.stringify({
              recordId: `record-${i}`,
              payload: { action: 'process', value: i },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Dedup Process Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
      expect(result.stats.p99).toBeLessThan(10)
    })

    it('check if record processed', async () => {
      const result = await benchmark({
        name: 'transaction-dedup-check',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request(`/transactions/dedup/check/${`record-${i % 50}`}`, {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Dedup Check Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })

    it('process with idempotency key', async () => {
      const result = await benchmark({
        name: 'transaction-dedup-idempotent',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          // Intentionally use same key half the time to test dedup
          const idempotencyKey = `key-${i % 50}`
          return ctx.do.request('/transactions/dedup/idempotent', {
            method: 'POST',
            headers: {
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              action: 'create-order',
              orderId: `order-${i}`,
              amount: Math.random() * 1000,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Dedup Idempotent Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('batch deduplication check', async () => {
      const result = await benchmark({
        name: 'transaction-dedup-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const recordIds = Array.from({ length: 20 }, (_, j) => `batch-record-${i * 20 + j}`)
          return ctx.do.request('/transactions/dedup/batch-check', {
            method: 'POST',
            body: JSON.stringify({ recordIds }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Dedup Batch Check Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // CHECKPOINT BARRIER BENCHMARKS
  // ============================================================================

  describe('checkpoint barrier', () => {
    it('create checkpoint', async () => {
      const result = await benchmark({
        name: 'transaction-checkpoint-create',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const state = Object.fromEntries(
            Array.from({ length: 50 }, (_, j) => [`key-${j}`, { value: j, data: 'x'.repeat(50) }])
          )
          const offsets = Object.fromEntries(
            Array.from({ length: 8 }, (_, j) => [`partition-${j}`, i * 1000 + j * 100])
          )
          return ctx.do.request('/transactions/checkpoint/create', {
            method: 'POST',
            body: JSON.stringify({
              checkpointId: `chk-${i}`,
              state,
              offsets,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Checkpoint Create Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(20)
      expect(result.stats.p99).toBeLessThan(50)
    })

    it('restore from checkpoint', async () => {
      const result = await benchmark({
        name: 'transaction-checkpoint-restore',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create checkpoints for restore testing
          for (let i = 0; i < 10; i++) {
            const state = Object.fromEntries(
              Array.from({ length: 50 }, (_, j) => [`key-${j}`, { value: j, data: 'x'.repeat(50) }])
            )
            const offsets = Object.fromEntries(
              Array.from({ length: 8 }, (_, j) => [`partition-${j}`, i * 1000 + j * 100])
            )
            await ctx.do.request('/transactions/checkpoint/create', {
              method: 'POST',
              body: JSON.stringify({
                checkpointId: `restore-chk-${i}`,
                state,
                offsets,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/checkpoint/restore', {
            method: 'POST',
            body: JSON.stringify({
              checkpointId: `restore-chk-${i % 10}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Checkpoint Restore Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('get latest checkpoint', async () => {
      const result = await benchmark({
        name: 'transaction-checkpoint-latest',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/transactions/checkpoint/latest', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Checkpoint Latest Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('checkpoint barrier propagation', async () => {
      const result = await benchmark({
        name: 'transaction-checkpoint-barrier',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/checkpoint/barrier', {
            method: 'POST',
            body: JSON.stringify({
              barrierId: `barrier-${i}`,
              sourceOperator: 'source-1',
              targetOperators: ['map-1', 'filter-1', 'sink-1'],
              timestamp: Date.now(),
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction Checkpoint Barrier Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // TWO-PHASE COMMIT BENCHMARKS
  // ============================================================================

  describe('two-phase commit', () => {
    it('prepare phase', async () => {
      const result = await benchmark({
        name: 'transaction-2pc-prepare',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/2pc/prepare', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: `2pc-tx-${i}`,
              participants: ['kafka-sink', 'db-sink', 'cache-sink'],
              records: Array.from({ length: 10 }, (_, j) => ({
                id: `record-${i}-${j}`,
                value: j,
              })),
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction 2PC Prepare Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('commit phase', async () => {
      const result = await benchmark({
        name: 'transaction-2pc-commit',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Prepare transactions for commit
          for (let i = 0; i < 120; i++) {
            await ctx.do.request('/transactions/2pc/prepare', {
              method: 'POST',
              body: JSON.stringify({
                transactionId: `2pc-commit-tx-${i}`,
                participants: ['kafka-sink', 'db-sink'],
                records: [{ id: `record-${i}`, value: i }],
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/transactions/2pc/commit', {
            method: 'POST',
            body: JSON.stringify({
              transactionId: `2pc-commit-tx-${i + 10}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Transaction 2PC Commit Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(15)
    })
  })
})
