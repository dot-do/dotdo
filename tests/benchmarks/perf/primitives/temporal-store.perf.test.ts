/**
 * TemporalStore Primitive Benchmarks
 *
 * Performance benchmarks for the TemporalStore Durable Object primitive:
 * - Put with timestamp operations
 * - Time-range queries
 * - Snapshot creation and restoration
 * - Point-in-time queries
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | put with timestamp | <5ms |
 * | time-range query | <20ms |
 * | snapshot creation | <30ms |
 * | point-in-time get | <10ms |
 *
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('TemporalStore benchmarks', () => {
  describe('write operations', () => {
    it('put with timestamp', async () => {
      const result = await benchmark({
        name: 'temporal-put-timestamp',
        target: 'temporal.perf.do',
        iterations: 1000,
        warmup: 50,
        setup: async (ctx) => {
          await ctx.do.request('/temporal/clear', { method: 'POST' })
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/temporal/put', {
            method: 'POST',
            body: JSON.stringify({
              key: `sensor-${iteration % 100}`,
              value: {
                reading: Math.random() * 100,
                temperature: 20 + Math.random() * 15,
                humidity: 30 + Math.random() * 50,
                pressure: 1000 + Math.random() * 50,
              },
              timestamp: Date.now() - (iteration * 1000), // Spread over time
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/temporal/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- TemporalStore Put with Timestamp Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('batch put (100 entries)', async () => {
      const result = await benchmark({
        name: 'temporal-batch-put-100',
        target: 'temporal.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          const entries = []
          const baseTime = Date.now()
          for (let i = 0; i < 100; i++) {
            entries.push({
              key: `batch-sensor-${iteration}-${i}`,
              value: {
                reading: Math.random() * 100,
                index: i,
              },
              timestamp: baseTime - (i * 60000), // 1 minute apart
            })
          }

          return ctx.do.request('/temporal/batch-put', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })
        },
      })

      record(result)

      console.log('\n--- TemporalStore Batch Put (100 entries) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(15) // <15ms for 100 entries
    })
  })

  describe('query operations', () => {
    it('time-range query', async () => {
      const result = await benchmark({
        name: 'temporal-time-range-query',
        target: 'temporal.perf.do',
        iterations: 500,
        warmup: 25,
        setup: async (ctx) => {
          // Pre-populate with time-series data
          await ctx.do.request('/temporal/clear', { method: 'POST' })

          const baseTime = Date.now() - 86400000 // 24 hours ago
          // Create 100 sensors, each with 100 readings over 24 hours
          for (let sensor = 0; sensor < 100; sensor++) {
            const entries = []
            for (let reading = 0; reading < 100; reading++) {
              entries.push({
                key: `sensor-${sensor}`,
                value: {
                  reading: Math.random() * 100,
                  sensorId: sensor,
                  index: reading,
                },
                timestamp: baseTime + (reading * 864000), // ~14.4 min intervals
              })
            }
            await ctx.do.request('/temporal/batch-put', {
              method: 'POST',
              body: JSON.stringify({ entries }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const baseTime = Date.now() - 86400000
          // Query different time ranges
          const rangeStart = baseTime + ((iteration % 24) * 3600000)
          const rangeEnd = rangeStart + 3600000 // 1 hour range

          return ctx.do.request('/temporal/query', {
            method: 'POST',
            body: JSON.stringify({
              key: `sensor-${iteration % 100}`,
              startTime: rangeStart,
              endTime: rangeEnd,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- TemporalStore Time-Range Query Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms target
    })

    it('point-in-time get', async () => {
      const result = await benchmark({
        name: 'temporal-point-in-time',
        target: 'temporal.perf.do',
        iterations: 1000,
        warmup: 50,
        run: async (ctx, iteration) => {
          const baseTime = Date.now() - 86400000
          // Query specific point in time
          const timestamp = baseTime + ((iteration % 100) * 864000)

          return ctx.do.request('/temporal/get', {
            method: 'POST',
            body: JSON.stringify({
              key: `sensor-${iteration % 100}`,
              timestamp,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- TemporalStore Point-in-Time Get Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('get latest (current value)', async () => {
      const result = await benchmark({
        name: 'temporal-get-latest',
        target: 'temporal.perf.do',
        iterations: 1000,
        warmup: 50,
        run: async (ctx, iteration) => {
          return ctx.do.request(`/temporal/get?key=sensor-${iteration % 100}`)
        },
      })

      record(result)

      console.log('\n--- TemporalStore Get Latest Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('snapshot operations', () => {
    it('snapshot creation', async () => {
      const result = await benchmark({
        name: 'temporal-snapshot-create',
        target: 'temporal.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Ensure we have data to snapshot (1000 keys with history)
          const stats = await ctx.do.request<{ keyCount: number }>('/temporal/stats')
          if (stats.keyCount < 1000) {
            // Pre-populate with more data
            for (let batch = 0; batch < 10; batch++) {
              const entries = []
              for (let i = 0; i < 100; i++) {
                entries.push({
                  key: `snapshot-key-${batch * 100 + i}`,
                  value: { data: `value-${batch}-${i}`, batch, index: i },
                  timestamp: Date.now(),
                })
              }
              await ctx.do.request('/temporal/batch-put', {
                method: 'POST',
                body: JSON.stringify({ entries }),
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/temporal/snapshot', {
            method: 'POST',
            body: JSON.stringify({
              name: `benchmark-snapshot-${Date.now()}`,
              description: 'Performance benchmark snapshot',
            }),
          })
        },
      })

      record(result)

      console.log('\n--- TemporalStore Snapshot Creation Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  (Snapshotting ~1000 keys)`)

      expect(result.stats.p95).toBeLessThan(30) // <30ms target
    })

    it('snapshot restore', async () => {
      let snapshotId: string | undefined

      const result = await benchmark({
        name: 'temporal-snapshot-restore',
        target: 'temporal.perf.do',
        iterations: 20,
        warmup: 2,
        setup: async (ctx) => {
          // Create a snapshot to restore from
          const snapshot = await ctx.do.request<{ id: string }>('/temporal/snapshot', {
            method: 'POST',
            body: JSON.stringify({
              name: 'benchmark-restore-source',
              description: 'Source snapshot for restore benchmark',
            }),
          })
          snapshotId = snapshot.id
        },
        run: async (ctx) => {
          if (!snapshotId) throw new Error('No snapshot ID')
          return ctx.do.request('/temporal/restore', {
            method: 'POST',
            body: JSON.stringify({ snapshotId }),
          })
        },
      })

      record(result)

      console.log('\n--- TemporalStore Snapshot Restore Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms for restore
    })

    it('list snapshots', async () => {
      const result = await benchmark({
        name: 'temporal-snapshot-list',
        target: 'temporal.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/temporal/snapshots')
        },
      })

      record(result)

      console.log('\n--- TemporalStore List Snapshots Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms
    })
  })

  describe('version history', () => {
    it('get version history', async () => {
      const result = await benchmark({
        name: 'temporal-version-history',
        target: 'temporal.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          return ctx.do.request(`/temporal/history?key=sensor-${iteration % 100}`)
        },
      })

      record(result)

      console.log('\n--- TemporalStore Version History Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(15) // <15ms
    })
  })

  describe('summary', () => {
    it('should report temporal store benchmark targets', () => {
      console.log('\n========================================')
      console.log('TEMPORAL STORE BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | put with timestamp | <5ms |')
      console.log('  | batch put (100) | <15ms |')
      console.log('  | time-range query | <20ms |')
      console.log('  | point-in-time get | <10ms |')
      console.log('  | get latest | <5ms |')
      console.log('  | snapshot create | <30ms |')
      console.log('  | snapshot restore | <50ms |')
      console.log('  | version history | <15ms |')
      console.log('')

      console.log('Temporal Operations:')
      console.log('  - put: O(log n) insert into time-ordered index')
      console.log('  - get latest: O(1) lookup')
      console.log('  - get point-in-time: O(log n) binary search')
      console.log('  - time-range: O(log n + m) where m = results')
      console.log('  - snapshot: O(n) where n = total keys')
      console.log('  - restore: O(n) state reconstruction')
      console.log('')

      console.log('Time-Series Features:')
      console.log('  - Versioned storage with full history')
      console.log('  - Point-in-time queries')
      console.log('  - Time-range aggregations')
      console.log('  - Snapshot/restore for backup')
      console.log('  - TTL-based cleanup (optional)')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
