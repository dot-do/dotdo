/**
 * RelationshipsStore Performance Benchmarks
 *
 * Tests relationship graph operations:
 * - create edge: Create relationship between things
 * - from() traversal: Get outbound relationships
 * - to() traversal: Get inbound relationships
 * - delete edge: Remove relationship
 *
 * Target: All operations should be sub-10ms for simple operations
 *
 * @see db/stores.ts for RelationshipsStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('RelationshipsStore benchmarks', () => {
  describe('create edge operations', () => {
    it('create edge', async () => {
      const result = await benchmark({
        name: 'relationships-create',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'manages',
              from: `Person/${i}`,
              to: `Project/${i}`,
              data: { role: 'owner', since: Date.now() },
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for edge creation
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('create edge with large data payload', async () => {
      const result = await benchmark({
        name: 'relationships-create-large-data',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'contains',
              from: `Container/${i}`,
              to: `Item/${i}`,
              data: {
                metadata: {
                  tags: Array.from({ length: 20 }, (_, j) => `tag-${j}`),
                  properties: Object.fromEntries(
                    Array.from({ length: 50 }, (_, j) => [`prop-${j}`, `value-${j}`])
                  ),
                },
                timestamps: {
                  created: Date.now(),
                  modified: Date.now(),
                  accessed: Date.now(),
                },
              },
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Larger payloads may be slightly slower but still sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('create multiple edges for same source', async () => {
      const sourceId = 'shared-source'

      const result = await benchmark({
        name: 'relationships-create-fan-out',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'follows',
              from: `User/${sourceId}`,
              to: `User/target-${i}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Should maintain sub-10ms even with many edges from same source
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('from() traversal (outbound)', () => {
    it('traverse outbound edges', async () => {
      let sourceId: string

      const result = await benchmark({
        name: 'relationships-from-traversal',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          sourceId = `Person/traversal-source`
          // Create 20 outbound edges
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'manages',
                from: sourceId,
                to: `Project/proj-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/relationships/from/${encodeURIComponent(sourceId)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Outbound traversal should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse with verb filter', async () => {
      let sourceId: string

      const result = await benchmark({
        name: 'relationships-from-verb-filter',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          sourceId = `Person/multi-verb-source`
          // Create edges with different verbs
          const verbs = ['manages', 'owns', 'follows', 'likes']
          for (let i = 0; i < 40; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: verbs[i % verbs.length],
                from: sourceId,
                to: `Target/target-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(
            `/relationships/from/${encodeURIComponent(sourceId)}?verb=manages`
          )
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Filtered traversal should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse sparse graph (few edges)', async () => {
      const result = await benchmark({
        name: 'relationships-from-sparse',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          // Query random nodes (most will have no edges)
          return ctx.do.list(`/relationships/from/RandomNode/${i}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Empty result should be very fast (sub-5ms)
      expect(result.stats.p50).toBeLessThan(5)
    })
  })

  describe('to() traversal (inbound)', () => {
    it('traverse inbound edges', async () => {
      let targetId: string

      const result = await benchmark({
        name: 'relationships-to-traversal',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          targetId = `Project/popular-project`
          // Create 20 inbound edges (many contributors)
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'contributes',
                from: `Person/contributor-${i}`,
                to: targetId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/relationships/to/${encodeURIComponent(targetId)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Inbound traversal should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse highly connected node', async () => {
      let targetId: string

      const result = await benchmark({
        name: 'relationships-to-high-degree',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          targetId = `Article/viral-article`
          // Create 100 inbound edges (viral content)
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'likes',
                from: `User/user-${i}`,
                to: targetId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/relationships/to/${encodeURIComponent(targetId)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // High-degree nodes may be slower but still sub-50ms
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('graph traversal patterns', () => {
    it('two-hop traversal', async () => {
      let startId: string

      const result = await benchmark({
        name: 'relationships-two-hop',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          startId = `User/start-user`
          // Create first hop: start -> friends
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'friends',
                from: startId,
                to: `User/friend-${i}`,
              }),
            })
            // Create second hop: friends -> their friends
            for (let j = 0; j < 3; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'friends',
                  from: `User/friend-${i}`,
                  to: `User/friend-of-friend-${i}-${j}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // First hop
          const firstHop = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(startId)}?verb=friends`
          )
          // Second hop (parallel)
          const secondHopPromises = firstHop.map((rel) =>
            ctx.do.list(`/relationships/from/${encodeURIComponent(rel.to)}?verb=friends`)
          )
          await Promise.all(secondHopPromises)
          return firstHop
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Two-hop with parallel second hop should be sub-100ms
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('delete operations', () => {
    it('delete edge by ID', async () => {
      let edgeIds: string[] = []

      const result = await benchmark({
        name: 'relationships-delete',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create edges to delete
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'temp',
                from: `Node/a-${i}`,
                to: `Node/b-${i}`,
              }),
            })
            edgeIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < edgeIds.length) {
            return ctx.do.delete(`/relationships/${edgeIds[i]}`)
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Delete should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('list operations', () => {
    it('list all relationships', async () => {
      const result = await benchmark({
        name: 'relationships-list-all',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/relationships?limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // List with limit should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('list by verb', async () => {
      const result = await benchmark({
        name: 'relationships-list-by-verb',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const verbs = ['manages', 'owns', 'follows', 'likes', 'contains']
          return ctx.do.list(`/relationships?verb=${verbs[i % verbs.length]}&limit=20`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Filtered list should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent edge creation', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `relationships-concurrent-create-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              return ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'concurrent',
                  from: `Worker/${workerIndex}`,
                  to: `Target/${workerIndex}-${i}`,
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
