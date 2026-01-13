/**
 * ObjectsStore Performance Benchmarks
 *
 * Tests DO registry and resolution operations:
 * - register DO: Register a Durable Object
 * - resolve DO: Look up DO by namespace
 * - list shards: Get all shards for a key
 *
 * Target: All operations should be sub-10ms for simple operations
 *
 * @see db/stores.ts for ObjectsStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('ObjectsStore benchmarks', () => {
  describe('register DO operations', () => {
    it('register DO', async () => {
      const result = await benchmark({
        name: 'objects-register',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns: `tenant-${i}.example.ai`,
              id: `do-${i}`,
              class: 'DO',
              region: 'wnam',
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for DO registration
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('register DO with shard config', async () => {
      const result = await benchmark({
        name: 'objects-register-sharded',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns: `tenant-${Math.floor(i / 8)}-shard-${i % 8}.example.ai`,
              id: `do-shard-${i}`,
              class: 'DO',
              relation: 'shard',
              shardKey: `tenant-${Math.floor(i / 8)}`,
              shardIndex: i % 8,
              region: 'wnam',
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Shard registration should still be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('register DO with all metadata', async () => {
      const result = await benchmark({
        name: 'objects-register-full',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns: `full-${i}.example.ai`,
              id: `do-full-${i}`,
              class: 'DO',
              relation: 'primary',
              shardKey: `full-${i}`,
              shardIndex: 0,
              region: 'wnam',
              colo: 'SJC',
              primary: true,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Full metadata registration should still be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('update DO registration', async () => {
      let ns: string

      const result = await benchmark({
        name: 'objects-update',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          ns = 'update-target.example.ai'
          // Initial registration
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns,
              id: 'do-update-target',
              class: 'DO',
              region: 'wnam',
            }),
          })
        },
        run: async (ctx, i) => {
          return ctx.do.request(`/objects/${encodeURIComponent(ns)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              colo: ['SJC', 'DFW', 'IAD', 'ORD'][i % 4],
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Update should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('resolve DO operations', () => {
    it('resolve DO', async () => {
      let namespaces: string[] = []

      const result = await benchmark({
        name: 'objects-resolve',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Register DOs to resolve
          for (let i = 0; i < 100; i++) {
            const ns = `resolve-${i}.example.ai`
            await ctx.do.request('/objects', {
              method: 'POST',
              body: JSON.stringify({
                ns,
                id: `do-resolve-${i}`,
                class: 'DO',
                region: 'wnam',
              }),
            })
            namespaces.push(ns)
          }
        },
        run: async (ctx, i) => {
          const ns = namespaces[i % namespaces.length]
          return ctx.do.get(`/objects/${encodeURIComponent(ns)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Resolution should be very fast (sub-5ms)
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('resolve non-existent DO', async () => {
      const result = await benchmark({
        name: 'objects-resolve-missing',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          try {
            await ctx.do.get(`/objects/nonexistent-${i}.example.ai`)
          } catch {
            // Expected to fail, measuring latency
          }
          return null
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Missing lookup should still be fast
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('resolve with caching', async () => {
      let ns: string

      const result = await benchmark({
        name: 'objects-resolve-cached',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          ns = 'cached.example.ai'
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns,
              id: 'do-cached',
              class: 'DO',
              region: 'wnam',
            }),
          })
        },
        run: async (ctx) => {
          // Same namespace repeatedly - should benefit from caching
          return ctx.do.get(`/objects/${encodeURIComponent(ns)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Cached resolution should be very fast
      expect(result.stats.p50).toBeLessThan(3)
    })
  })

  describe('list shards operations', () => {
    it('list shards', async () => {
      let shardKey: string

      const result = await benchmark({
        name: 'objects-list-shards',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          shardKey = 'shard-test'
          // Create 8 shards
          for (let i = 0; i < 8; i++) {
            await ctx.do.request('/objects', {
              method: 'POST',
              body: JSON.stringify({
                ns: `${shardKey}-shard-${i}.example.ai`,
                id: `do-shard-${i}`,
                class: 'DO',
                relation: 'shard',
                shardKey,
                shardIndex: i,
                region: 'wnam',
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/objects/shards/${encodeURIComponent(shardKey)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Shard listing should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list shards with varying shard counts', async () => {
      const shardCounts = [2, 4, 8, 16]

      for (const count of shardCounts) {
        const shardKey = `shards-${count}`

        const result = await benchmark({
          name: `objects-list-shards-${count}`,
          target: 'stores.perf.do',
          iterations: 30,
          warmup: 5,
          setup: async (ctx) => {
            for (let i = 0; i < count; i++) {
              await ctx.do.request('/objects', {
                method: 'POST',
                body: JSON.stringify({
                  ns: `${shardKey}-shard-${i}.example.ai`,
                  id: `do-${shardKey}-${i}`,
                  class: 'DO',
                  relation: 'shard',
                  shardKey,
                  shardIndex: i,
                  region: 'wnam',
                }),
              })
            }
          },
          run: async (ctx) => {
            return ctx.do.list(`/objects/shards/${encodeURIComponent(shardKey)}`)
          },
        })

        record(result)

        expect(result.samples.length).toBe(30)
        // Latency should scale reasonably with shard count
        expect(result.stats.p50).toBeLessThan(10 + count * 0.5)
      }
    })
  })

  describe('list operations', () => {
    it('list all DOs', async () => {
      const result = await benchmark({
        name: 'objects-list-all',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/objects?limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // List with limit should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('list by class', async () => {
      const result = await benchmark({
        name: 'objects-list-by-class',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const classes = ['DO', 'Worker', 'Entity']
          return ctx.do.list(`/objects?class=${classes[i % classes.length]}&limit=20`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Class filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list by region', async () => {
      const result = await benchmark({
        name: 'objects-list-by-region',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const regions = ['wnam', 'enam', 'weur', 'eeur', 'apac']
          return ctx.do.list(`/objects?region=${regions[i % regions.length]}&limit=20`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Region filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list by colo', async () => {
      const result = await benchmark({
        name: 'objects-list-by-colo',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const colos = ['SJC', 'DFW', 'IAD', 'ORD', 'SEA']
          return ctx.do.list(`/objects?colo=${colos[i % colos.length]}&limit=20`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Colo filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('delete operations', () => {
    it('delete DO registration', async () => {
      let namespaces: string[] = []

      const result = await benchmark({
        name: 'objects-delete',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Register DOs to delete
          for (let i = 0; i < 100; i++) {
            const ns = `delete-${i}.example.ai`
            await ctx.do.request('/objects', {
              method: 'POST',
              body: JSON.stringify({
                ns,
                id: `do-delete-${i}`,
                class: 'DO',
                region: 'wnam',
              }),
            })
            namespaces.push(ns)
          }
        },
        run: async (ctx, i) => {
          if (i < namespaces.length) {
            return ctx.do.delete(`/objects/${encodeURIComponent(namespaces[i])}`)
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Delete should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('cross-DO resolution', () => {
    it('resolve cross-DO reference', async () => {
      let sourceNs: string
      let targetNs: string

      const result = await benchmark({
        name: 'objects-cross-resolve',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          sourceNs = 'source.example.ai'
          targetNs = 'target.example.ai'

          // Register both DOs
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns: sourceNs,
              id: 'do-source',
              class: 'DO',
              region: 'wnam',
            }),
          })
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns: targetNs,
              id: 'do-target',
              class: 'DO',
              region: 'wnam',
            }),
          })
        },
        run: async (ctx) => {
          // Resolve target from source context
          return ctx.do.get(
            `/objects/${encodeURIComponent(sourceNs)}/resolve/${encodeURIComponent(targetNs)}`
          )
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Cross-DO resolution should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('throughput', () => {
    it('registration throughput', async () => {
      const batchSize = 20

      const result = await benchmark({
        name: 'objects-throughput',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          // Register multiple DOs sequentially
          for (let j = 0; j < batchSize; j++) {
            await ctx.do.request('/objects', {
              method: 'POST',
              body: JSON.stringify({
                ns: `throughput-${i * batchSize + j}.example.ai`,
                id: `do-tp-${i * batchSize + j}`,
                class: 'DO',
                region: 'wnam',
              }),
            })
          }
        },
      })

      record(result)

      // Calculate throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs // registrations per second

      // Should achieve at least 200 registrations/sec
      expect(throughput).toBeGreaterThan(200)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent registrations', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `objects-concurrent-register-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              return ctx.do.request('/objects', {
                method: 'POST',
                body: JSON.stringify({
                  ns: `concurrent-${workerIndex}-${i}.example.ai`,
                  id: `do-concurrent-${workerIndex}-${i}`,
                  class: 'DO',
                  region: 'wnam',
                }),
              })
            },
          })
        )
      )

      record(results)

      // All workers should complete without excessive errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(iterationsPerWorker * 0.1)
      }

      // Calculate overall latency variance
      const allP50s = results.map((r) => r.stats.p50)
      const meanP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      // No worker should be more than 3x slower than average
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })

    it('handles concurrent resolutions', async () => {
      const concurrency = 5
      const iterationsPerWorker = 30
      let namespaces: string[] = []

      // Setup: Register namespaces first
      const setupResult = await benchmark({
        name: 'objects-concurrent-resolve-setup',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 0,
        run: async (ctx, i) => {
          const ns = `resolve-concurrent-${i}.example.ai`
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              ns,
              id: `do-${i}`,
              class: 'DO',
              region: 'wnam',
            }),
          })
          namespaces.push(ns)
        },
      })

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `objects-concurrent-resolve-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              const ns = namespaces[(workerIndex * iterationsPerWorker + i) % namespaces.length]
              return ctx.do.get(`/objects/${encodeURIComponent(ns)}`)
            },
          })
        )
      )

      record(results)

      // Concurrent resolutions should be fast
      for (const result of results) {
        expect(result.stats.p50).toBeLessThan(10)
      }
    })
  })
})
