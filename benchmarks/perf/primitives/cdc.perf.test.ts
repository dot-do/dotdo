/**
 * CDC Benchmarks (Change Data Capture)
 *
 * Performance benchmarks for Change Data Capture primitives.
 * Tests capture, transform, and sink operations for database change streaming.
 *
 * Expected Performance:
 * | Operation | Expected |
 * |-----------|----------|
 * | capture   | <2ms |
 * | transform | <2ms |
 * | sink      | <5ms |
 *
 * Reference: Debezium CDC patterns
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CDC CAPTURE BENCHMARKS
// ============================================================================

describe('CDC benchmarks (Change Data Capture)', () => {
  describe('capture operations', () => {
    it('capture insert change', async () => {
      const result = await benchmark({
        name: 'cdc-capture-insert',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/capture', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'insert',
              table: 'users',
              before: null,
              after: {
                id: i,
                name: `user-${i}`,
                email: `user${i}@example.com`,
                created_at: new Date().toISOString(),
              },
              timestamp: Date.now(),
              transactionId: `tx-${i}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Capture Insert Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
      expect(result.stats.p99).toBeLessThan(5)
    })

    it('capture update change', async () => {
      const result = await benchmark({
        name: 'cdc-capture-update',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/capture', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'update',
              table: 'users',
              before: {
                id: i % 100,
                name: `user-${i % 100}`,
                email: `user${i % 100}@example.com`,
                updated_at: new Date(Date.now() - 3600000).toISOString(),
              },
              after: {
                id: i % 100,
                name: `user-${i % 100}-updated`,
                email: `user${i % 100}@newdomain.com`,
                updated_at: new Date().toISOString(),
              },
              timestamp: Date.now(),
              transactionId: `tx-update-${i}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Capture Update Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('capture delete change', async () => {
      const result = await benchmark({
        name: 'cdc-capture-delete',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/capture', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'delete',
              table: 'users',
              before: {
                id: i,
                name: `deleted-user-${i}`,
                email: `deleted${i}@example.com`,
              },
              after: null,
              timestamp: Date.now(),
              transactionId: `tx-delete-${i}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Capture Delete Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('capture batch of changes', async () => {
      const result = await benchmark({
        name: 'cdc-capture-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const changes = Array.from({ length: 50 }, (_, j) => ({
            operation: ['insert', 'update', 'delete'][j % 3] as 'insert' | 'update' | 'delete',
            table: ['users', 'orders', 'products'][j % 3],
            before: j % 3 === 0 ? null : { id: j, data: `before-${j}` },
            after: j % 3 === 2 ? null : { id: j, data: `after-${j}` },
            timestamp: Date.now() + j,
            transactionId: `tx-batch-${i}`,
          }))
          return ctx.do.request('/cdc/capture/batch', {
            method: 'POST',
            body: JSON.stringify({ changes }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Capture Batch Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })
  })

  // ============================================================================
  // CDC TRANSFORM BENCHMARKS
  // ============================================================================

  describe('transform operations', () => {
    it('transform single change', async () => {
      const result = await benchmark({
        name: 'cdc-transform-single',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/transform', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'update',
                table: 'orders',
                before: { id: i, status: 'pending', amount: 100.50 },
                after: { id: i, status: 'completed', amount: 100.50 },
                timestamp: Date.now(),
              },
              transformerId: 'order-enricher',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Transform Single Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
      expect(result.stats.p99).toBeLessThan(5)
    })

    it('transform with filter', async () => {
      const result = await benchmark({
        name: 'cdc-transform-filter',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/transform/filter', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: i % 3 === 2 ? 'delete' : 'update',
                table: 'audit_log',
                before: { id: i, action: 'view' },
                after: i % 3 === 2 ? null : { id: i, action: 'edit' },
                timestamp: Date.now(),
              },
              filter: {
                excludeOperations: ['delete'],
                excludeTables: ['audit_log'],
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Transform Filter Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('transform with field mapping', async () => {
      const result = await benchmark({
        name: 'cdc-transform-map',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/transform/map', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'insert',
                table: 'customers',
                before: null,
                after: {
                  customer_id: i,
                  first_name: 'John',
                  last_name: 'Doe',
                  email_address: `john${i}@example.com`,
                  phone_number: '+1234567890',
                },
                timestamp: Date.now(),
              },
              mapping: {
                customer_id: 'id',
                first_name: 'firstName',
                last_name: 'lastName',
                email_address: 'email',
                phone_number: 'phone',
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Transform Map Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('transform batch with pipeline', async () => {
      const result = await benchmark({
        name: 'cdc-transform-pipeline',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const events = Array.from({ length: 20 }, (_, j) => ({
            operation: 'update' as const,
            table: 'products',
            before: { id: j, price: 10.00 + j, stock: 100 },
            after: { id: j, price: 10.00 + j + 0.5, stock: 99 },
            timestamp: Date.now() + j,
          }))
          return ctx.do.request('/cdc/transform/pipeline', {
            method: 'POST',
            body: JSON.stringify({
              events,
              pipeline: ['filter', 'map', 'enrich'],
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Transform Pipeline Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('transform with schema registry lookup', async () => {
      const result = await benchmark({
        name: 'cdc-transform-schema',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/transform/schema', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'insert',
                table: 'events',
                schemaId: `schema-v${i % 5}`,
                payload: { type: 'pageview', url: `/page/${i}`, userId: i % 100 },
                timestamp: Date.now(),
              },
              targetSchemaVersion: 'latest',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Transform Schema Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })

  // ============================================================================
  // CDC SINK BENCHMARKS
  // ============================================================================

  describe('sink operations', () => {
    it('sink to destination', async () => {
      const result = await benchmark({
        name: 'cdc-sink-single',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/sink', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'insert',
                table: 'users',
                after: { id: i, name: `user-${i}`, email: `user${i}@test.com` },
                timestamp: Date.now(),
              },
              sinkId: 'elasticsearch-sink',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Sink Single Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
      expect(result.stats.p99).toBeLessThan(15)
    })

    it('sink batch to destination', async () => {
      const result = await benchmark({
        name: 'cdc-sink-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const events = Array.from({ length: 50 }, (_, j) => ({
            operation: 'insert' as const,
            table: 'logs',
            after: {
              id: i * 50 + j,
              message: `Log entry ${j}`,
              level: ['info', 'warn', 'error'][j % 3],
              timestamp: new Date().toISOString(),
            },
            timestamp: Date.now() + j,
          }))
          return ctx.do.request('/cdc/sink/batch', {
            method: 'POST',
            body: JSON.stringify({
              events,
              sinkId: 'kafka-sink',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Sink Batch Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(15)
    })

    it('sink to multiple destinations', async () => {
      const result = await benchmark({
        name: 'cdc-sink-multi',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/sink/multi', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'update',
                table: 'orders',
                before: { id: i, status: 'pending' },
                after: { id: i, status: 'shipped' },
                timestamp: Date.now(),
              },
              sinkIds: ['elasticsearch-sink', 'kafka-sink', 'redis-sink'],
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Sink Multi-Destination Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(10)
    })

    it('sink with retry logic', async () => {
      const result = await benchmark({
        name: 'cdc-sink-retry',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/sink/with-retry', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'insert',
                table: 'critical_data',
                after: { id: i, important: true, data: `critical-${i}` },
                timestamp: Date.now(),
              },
              sinkId: 'db-sink',
              retryConfig: {
                maxRetries: 3,
                backoffMs: 100,
                exponential: true,
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Sink with Retry Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })
  })

  // ============================================================================
  // CDC BUFFER BENCHMARKS
  // ============================================================================

  describe('buffer operations', () => {
    it('buffer add event', async () => {
      const result = await benchmark({
        name: 'cdc-buffer-add',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/buffer/add', {
            method: 'POST',
            body: JSON.stringify({
              event: {
                operation: 'insert',
                table: 'events',
                after: { id: i, data: `buffered-${i}` },
                timestamp: Date.now(),
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Buffer Add Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('buffer flush', async () => {
      const result = await benchmark({
        name: 'cdc-buffer-flush',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-fill buffer with events
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/cdc/buffer/add', {
              method: 'POST',
              body: JSON.stringify({
                event: {
                  operation: 'insert',
                  table: 'buffered_events',
                  after: { id: i, data: `to-flush-${i}` },
                  timestamp: Date.now(),
                },
              }),
            })
          }
        },
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/buffer/flush', {
            method: 'POST',
            body: JSON.stringify({
              maxBatchSize: 50,
              sinkId: 'batch-sink',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Buffer Flush Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(15)
    })

    it('get buffer size', async () => {
      const result = await benchmark({
        name: 'cdc-buffer-size',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/cdc/buffer/size', {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== CDC Buffer Size Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })
  })

  // ============================================================================
  // CDC OFFSET MANAGEMENT BENCHMARKS
  // ============================================================================

  describe('offset management', () => {
    it('commit offset', async () => {
      const result = await benchmark({
        name: 'cdc-offset-commit',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/offset/commit', {
            method: 'POST',
            body: JSON.stringify({
              source: 'mysql-binlog',
              position: {
                file: `mysql-bin.${String(Math.floor(i / 10)).padStart(6, '0')}`,
                pos: (i % 10) * 1000000 + 12345,
                gtid: `uuid:${i}`,
              },
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Offset Commit Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('get current offset', async () => {
      const result = await benchmark({
        name: 'cdc-offset-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/cdc/offset/current', {
            method: 'GET',
            headers: {
              'X-Source': 'mysql-binlog',
            },
          })
        },
      })
      record(result)

      console.log('\n=== CDC Offset Get Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('reset offset', async () => {
      const result = await benchmark({
        name: 'cdc-offset-reset',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/cdc/offset/reset', {
            method: 'POST',
            body: JSON.stringify({
              source: 'postgres-wal',
              position: i % 2 === 0 ? 'earliest' : 'latest',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== CDC Offset Reset Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })
})
