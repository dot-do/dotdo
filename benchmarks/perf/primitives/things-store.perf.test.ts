/**
 * ThingsStore Performance Benchmarks
 *
 * Tests core CRUD operations for the ThingsStore:
 * - create: Single thing creation
 * - get: Get thing by ID
 * - list: List with filtering and pagination
 * - update: Update thing (creates new version)
 * - versions: Get version history
 *
 * Target: All operations should be sub-10ms for simple operations
 *
 * @see db/stores.ts for ThingsStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('ThingsStore benchmarks', () => {
  describe('create operations', () => {
    it('create single thing', async () => {
      const result = await benchmark({
        name: 'things-create',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              $type: 'User',
              name: `user-${i}`,
              data: { email: `user${i}@test.com`, active: true },
            }),
          })
        },
      })

      record(result)

      // Verify benchmark completed
      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for simple create
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('create with nested data', async () => {
      const result = await benchmark({
        name: 'things-create-nested',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              $type: 'Order',
              name: `order-${i}`,
              data: {
                customer: { id: `cust-${i}`, name: 'Test Customer' },
                items: [
                  { sku: 'SKU-001', qty: 2, price: 29.99 },
                  { sku: 'SKU-002', qty: 1, price: 49.99 },
                ],
                totals: { subtotal: 109.97, tax: 8.80, total: 118.77 },
                metadata: { source: 'api', version: 1 },
              },
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Nested data may be slightly slower but still sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('get operations', () => {
    it('get by ID', async () => {
      let createdIds: string[] = []

      const result = await benchmark({
        name: 'things-get',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Seed 100 things for lookup
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.create<{ $id: string }>('/things', {
              $type: 'User',
              name: `seed-user-${i}`,
              data: { index: i },
            })
            createdIds.push(response.$id)
          }
        },
        run: async (ctx, i) => {
          const id = createdIds[i % createdIds.length]
          return ctx.do.get(`/things/${id}`)
        },
        teardown: async (ctx) => {
          // Clean up seeded data
          for (const id of createdIds) {
            await ctx.do.delete(`/things/${id}`)
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Get by ID should be very fast (sub-5ms)
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('get non-existent thing', async () => {
      const result = await benchmark({
        name: 'things-get-missing',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          try {
            await ctx.do.get(`/things/non-existent-${i}`)
          } catch {
            // Expected to fail, just measuring latency
          }
          return null
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Missing lookups should still be fast
      expect(result.stats.p50).toBeLessThan(5)
    })
  })

  describe('list operations', () => {
    it('list with filtering', async () => {
      const result = await benchmark({
        name: 'things-list-filter',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed various types
          for (let i = 0; i < 50; i++) {
            await ctx.do.create('/things', {
              $type: i % 2 === 0 ? 'Customer' : 'Lead',
              name: `contact-${i}`,
              data: { score: i * 10 },
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/things?type=Customer&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Filtered list should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('list with pagination', async () => {
      const result = await benchmark({
        name: 'things-list-paginated',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const offset = (i % 10) * 10
          return ctx.do.list(`/things?limit=10&offset=${offset}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Paginated list should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list with orderBy', async () => {
      const result = await benchmark({
        name: 'things-list-ordered',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/things?orderBy=name&order=asc&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Ordered list may be slightly slower but still sub-25ms
      expect(result.stats.p50).toBeLessThan(25)
    })
  })

  describe('update operations', () => {
    it('update (new version)', async () => {
      let thingId: string

      const result = await benchmark({
        name: 'things-update',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const response = await ctx.do.create<{ $id: string }>('/things', {
            $type: 'Counter',
            name: 'update-target',
            data: { count: 0 },
          })
          thingId = response.$id
        },
        run: async (ctx, i) => {
          return ctx.do.request(`/things/${thingId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              data: { count: i + 1, updatedAt: Date.now() },
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Update should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('update with merge', async () => {
      let thingId: string

      const result = await benchmark({
        name: 'things-update-merge',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const response = await ctx.do.create<{ $id: string }>('/things', {
            $type: 'Profile',
            name: 'merge-target',
            data: { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
          })
          thingId = response.$id
        },
        run: async (ctx, i) => {
          return ctx.do.request(`/things/${thingId}?merge=true`, {
            method: 'PATCH',
            body: JSON.stringify({
              data: { loginCount: i + 1 },
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Merge update should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('versions operations', () => {
    it('get versions history', async () => {
      let thingId: string

      const result = await benchmark({
        name: 'things-versions',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create thing with multiple versions
          const response = await ctx.do.create<{ $id: string }>('/things', {
            $type: 'Document',
            name: 'versioned-doc',
            data: { content: 'v1' },
          })
          thingId = response.$id

          // Create 10 versions
          for (let v = 2; v <= 10; v++) {
            await ctx.do.request(`/things/${thingId}`, {
              method: 'PATCH',
              body: JSON.stringify({ data: { content: `v${v}` } }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/things/${thingId}/versions`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Versions query should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('get specific version', async () => {
      let thingId: string

      const result = await benchmark({
        name: 'things-version-specific',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const response = await ctx.do.create<{ $id: string }>('/things', {
            $type: 'Document',
            name: 'versioned-doc-2',
            data: { content: 'v1' },
          })
          thingId = response.$id

          for (let v = 2; v <= 5; v++) {
            await ctx.do.request(`/things/${thingId}`, {
              method: 'PATCH',
              body: JSON.stringify({ data: { content: `v${v}` } }),
            })
          }
        },
        run: async (ctx, i) => {
          const version = (i % 5) + 1
          return ctx.do.get(`/things/${thingId}?version=${version}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Specific version lookup should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('batch operations', () => {
    it('bulk create throughput', async () => {
      const batchSize = 10

      const result = await benchmark({
        name: 'things-bulk-create',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          const batch = Array.from({ length: batchSize }, (_, j) => ({
            $type: 'BatchItem',
            name: `batch-${i}-${j}`,
            data: { batch: i, index: j },
          }))

          return ctx.do.request('/things/batch', {
            method: 'POST',
            body: JSON.stringify(batch),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)

      // Calculate throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs // items per second

      // Should achieve at least 100 items/sec
      expect(throughput).toBeGreaterThan(100)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent creates', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `things-concurrent-create-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              return ctx.do.request('/things', {
                method: 'POST',
                body: JSON.stringify({
                  $type: 'ConcurrentItem',
                  name: `worker-${workerIndex}-item-${i}`,
                  data: { worker: workerIndex, index: i },
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
  })
})
