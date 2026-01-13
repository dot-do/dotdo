/**
 * Cross-DO Graph Performance Benchmarks
 *
 * Tests graph operations spanning multiple Durable Objects:
 * - Graph spanning multiple DOs (sharded by type/namespace)
 * - Federated traversal across shards
 * - Cross-DO RPC for relationship resolution
 * - Consistency and latency of distributed graph queries
 *
 * In dotdo, the standards.org.ai graph is sharded:
 * - occupations.standards.perf.do
 * - tasks.standards.perf.do
 * - skills.standards.perf.do
 * - tools.standards.perf.do
 * - industries.standards.perf.do (NAICS)
 * - products.standards.perf.do (UNSPSC)
 * - processes.standards.perf.do (APQC)
 *
 * Target endpoints: graph.perf.do, *.standards.perf.do
 *
 * @see db/stores.ts for RelationshipsStore implementation
 * @see dotdo-zas1m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Cross-DO Graph Benchmarks', () => {
  describe('graph spanning multiple DOs', () => {
    it('traversal from occupations DO to tasks DO', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-occupation-to-tasks',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create cross-DO relationships
          // Occupations live in one DO, tasks in another
          // The relationship connects them
          const occupationId = 'Occupation/15-1252.00'
          for (let i = 0; i < 10; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'performs',
                from: occupationId,
                to: `Task/cross-do-task-${i}`,
                data: {
                  sourceDO: 'occupations.standards.perf.do',
                  targetDO: 'tasks.standards.perf.do',
                },
              }),
            })
          }
        },
        run: async (ctx) => {
          // Traverse from occupation to tasks
          const edges = await ctx.do.list<{ to: string; data: Record<string, unknown> }>(
            '/relationships/from/Occupation%2F15-1252.00?verb=performs'
          )
          return { taskCount: edges.length, tasks: edges.map((e) => e.to) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Cross-DO traversal should be efficient (metadata only)
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('multi-hop traversal across 3 DOs', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-3-hop',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create chain: Occupation -> Task -> Skill
          // Each entity type is in a different DO
          const occupation = 'Occupation/cross-3-hop'
          const task = 'Task/cross-3-task'
          const skill = 'Skill/cross-3-skill'

          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'performs',
              from: occupation,
              to: task,
              data: { crossDO: true },
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'requires',
              from: task,
              to: skill,
              data: { crossDO: true },
            }),
          })
        },
        run: async (ctx) => {
          // Hop 1: Occupation -> Tasks
          const tasks = await ctx.do.list<{ to: string }>(
            '/relationships/from/Occupation%2Fcross-3-hop?verb=performs'
          )
          if (tasks.length === 0) return { path: [], found: false }

          // Hop 2: Task -> Skills
          const skills = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(tasks[0]!.to)}?verb=requires`
          )

          return {
            path: ['Occupation/cross-3-hop', tasks[0]!.to, skills[0]?.to],
            found: skills.length > 0,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // 3-hop cross-DO should still be reasonable
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('fan-out to multiple DOs in parallel', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-parallel-fanout',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Occupation connects to entities in different DOs
          const occupation = 'Occupation/parallel-fanout'

          // Tasks (tasks DO)
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'performs',
                from: occupation,
                to: `Task/fanout-task-${i}`,
              }),
            })
          }

          // Tools (tools DO)
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occupation,
                to: `Tool/fanout-tool-${i}`,
              }),
            })
          }

          // Industries (industries DO)
          for (let i = 0; i < 3; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'employedIn',
                from: occupation,
                to: `Industry/fanout-naics-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Parallel queries to different DOs
          const occupation = 'Occupation/parallel-fanout'
          const [tasks, tools, industries] = await Promise.all([
            ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(occupation)}?verb=performs`
            ),
            ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(occupation)}?verb=uses`
            ),
            ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(occupation)}?verb=employedIn`
            ),
          ])

          return {
            tasks: tasks.map((t) => t.to),
            tools: tools.map((t) => t.to),
            industries: industries.map((t) => t.to),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Parallel fanout should be efficient
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('federated traversal across shards', () => {
    it('aggregate results from multiple shards', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-federated-aggregate',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create data across multiple "shards" (simulated via different prefixes)
          const shards = ['shard-a', 'shard-b', 'shard-c']
          for (const shard of shards) {
            for (let i = 0; i < 10; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'contains',
                  from: `${shard}/root`,
                  to: `${shard}/item-${i}`,
                  data: { shard },
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // Query all shards in parallel
          const shards = ['shard-a', 'shard-b', 'shard-c']
          const results = await Promise.all(
            shards.map((shard) =>
              ctx.do.list<{ to: string }>(`/relationships/from/${encodeURIComponent(`${shard}/root`)}`)
            )
          )

          // Aggregate results
          const allItems = results.flat().map((r) => r.to)
          return { totalItems: allItems.length, shardCounts: results.map((r) => r.length) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Federated aggregation should be efficient with parallel queries
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('find entity across shards', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-shard-search',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create entities in different shards
          const shards = ['alpha', 'beta', 'gamma', 'delta']
          for (const shard of shards) {
            for (let i = 0; i < 20; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'hosts',
                  from: `Shard/${shard}`,
                  to: `Entity/${shard}-entity-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // Search for a specific entity across all shards
          const targetEntity = 'Entity/gamma-entity-15'
          const shards = ['alpha', 'beta', 'gamma', 'delta']

          // Parallel search across shards
          const searchPromises = shards.map(async (shard) => {
            const entities = await ctx.do.list<{ to: string }>(
              `/relationships/from/Shard%2F${shard}?verb=hosts`
            )
            const found = entities.find((e) => e.to === targetEntity)
            return found ? { shard, entity: found.to } : null
          })

          const results = await Promise.all(searchPromises)
          const found = results.find((r) => r !== null)

          return { found: !!found, location: found }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Shard search should be parallel and efficient
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('scatter-gather pattern', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-scatter-gather',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create distributed data
          const regions = ['us-east', 'us-west', 'eu-west', 'ap-south']
          for (const region of regions) {
            for (let i = 0; i < 25; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'locatedIn',
                  from: `Entity/scatter-${region}-${i}`,
                  to: `Region/${region}`,
                  data: { region, index: i },
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // Scatter: Query each region in parallel
          const regions = ['us-east', 'us-west', 'eu-west', 'ap-south']

          const scatterResults = await Promise.all(
            regions.map(async (region) => {
              const entities = await ctx.do.list<{ from: string }>(
                `/relationships/to/Region%2F${region}?verb=locatedIn`
              )
              return { region, count: entities.length, entities: entities.map((e) => e.from) }
            })
          )

          // Gather: Aggregate results
          const totalEntities = scatterResults.reduce((sum, r) => sum + r.count, 0)
          const regionBreakdown = Object.fromEntries(
            scatterResults.map((r) => [r.region, r.count])
          )

          return { totalEntities, regionBreakdown }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Scatter-gather should be efficient with parallel execution
      expect(result.stats.p50).toBeLessThan(80)
    })
  })

  describe('cross-DO RPC for relationship resolution', () => {
    it('resolve entity details from source DO', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-entity-resolution',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create relationships with entity references
          const occupation = 'Occupation/resolve-test'
          for (let i = 0; i < 10; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occupation,
                to: `Tool/resolve-tool-${i}`,
                data: {
                  // In practice, would include DO stub ID for resolution
                  entityDO: `tools.standards.perf.do`,
                  entityId: `resolve-tool-${i}`,
                },
              }),
            })
          }
        },
        run: async (ctx) => {
          // Get relationships
          const edges = await ctx.do.list<{ to: string; data: Record<string, unknown> }>(
            '/relationships/from/Occupation%2Fresolve-test?verb=uses'
          )

          // In a real scenario, would make RPC calls to resolve entities
          // Here we're measuring the relationship lookup overhead
          return {
            edgeCount: edges.length,
            entities: edges.map((e) => ({
              id: e.to,
              targetDO: e.data?.entityDO,
            })),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('batch entity resolution simulation', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-batch-resolution',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create multiple relationships requiring resolution
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'references',
                from: 'Doc/batch-source',
                to: `Entity/batch-target-${i}`,
                data: { requiresResolution: true },
              }),
            })
          }
        },
        run: async (ctx) => {
          // Get all relationships
          const edges = await ctx.do.list<{ to: string }>(
            '/relationships/from/Doc%2Fbatch-source?verb=references'
          )

          // Simulate batch resolution by grouping targets
          // In practice, would batch RPC calls to target DOs
          const targetGroups = new Map<string, string[]>()
          for (const edge of edges) {
            const [type] = edge.to.split('/')
            const group = targetGroups.get(type!) || []
            group.push(edge.to)
            targetGroups.set(type!, group)
          }

          return {
            edgeCount: edges.length,
            groups: Object.fromEntries(targetGroups),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('consistency and latency of distributed graph queries', () => {
    it('read-after-write consistency across DOs', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-read-after-write',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, iteration) => {
          // Write a new relationship
          const sourceId = `Consistency/source-${iteration}`
          const targetId = `Consistency/target-${iteration}`

          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'links',
              from: sourceId,
              to: targetId,
            }),
          })

          // Immediately read it back
          const edges = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(sourceId)}?verb=links`
          )

          // Verify consistency
          const found = edges.some((e) => e.to === targetId)
          return { consistent: found, edgeCount: edges.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Should have no consistency errors
      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('latency variance across DO boundaries', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-latency-variance',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create relationships to different "DOs" (simulated)
          const sources = ['DO-A', 'DO-B', 'DO-C', 'DO-D', 'DO-E']
          for (const source of sources) {
            for (let i = 0; i < 10; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'connects',
                  from: `${source}/root`,
                  to: `${source}/node-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const sources = ['DO-A', 'DO-B', 'DO-C', 'DO-D', 'DO-E']
          const source = sources[iteration % sources.length]

          return ctx.do.list(`/relationships/from/${encodeURIComponent(`${source}/root`)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)

      // Check latency consistency across DOs
      // Standard deviation should be reasonable
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 1.5)

      // p99 should not be too far from p50
      expect(result.stats.p99).toBeLessThan(result.stats.p50 * 5)
    })

    it('concurrent cross-DO operations', async () => {
      const concurrency = 5

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIdx) =>
          benchmark({
            name: `graph-cross-do-concurrent-${workerIdx}`,
            target: 'graph.perf.do',
            iterations: 20,
            warmup: 2,
            setup: async (ctx) => {
              const sourceId = `Concurrent/worker-${workerIdx}`
              for (let i = 0; i < 10; i++) {
                await ctx.do.request('/relationships', {
                  method: 'POST',
                  body: JSON.stringify({
                    verb: 'owns',
                    from: sourceId,
                    to: `Concurrent/worker-${workerIdx}-item-${i}`,
                  }),
                })
              }
            },
            run: async (ctx) => {
              return ctx.do.list(
                `/relationships/from/Concurrent%2Fworker-${workerIdx}?verb=owns`
              )
            },
          })
        )
      )

      record(results)

      // All workers should complete without excessive errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(5)
      }

      // Check for fairness
      const p50s = results.map((r) => r.stats.p50)
      const meanP50 = p50s.reduce((a, b) => a + b, 0) / p50s.length
      const maxP50 = Math.max(...p50s)

      // No worker should be severely disadvantaged
      expect(maxP50).toBeLessThan(meanP50 * 2)
    })
  })

  describe('cross-DO graph joins', () => {
    it('join entities from two DOs', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-join',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create occupation -> skill relationships
          const occupations = ['occ-1', 'occ-2', 'occ-3']
          const skills = ['skill-a', 'skill-b', 'skill-c']

          for (const occ of occupations) {
            for (const skill of skills) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'requires',
                  from: `Occupation/join-${occ}`,
                  to: `Skill/join-${skill}`,
                }),
              })
            }
          }

          // Create skill -> tool relationships
          for (const skill of skills) {
            for (let i = 0; i < 2; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'developedWith',
                  from: `Skill/join-${skill}`,
                  to: `Tool/join-tool-${skill}-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // Join: Find all tools for occupation-1 via skills
          const skills = await ctx.do.list<{ to: string }>(
            '/relationships/from/Occupation%2Fjoin-occ-1?verb=requires'
          )

          // Parallel lookup of tools for each skill
          const toolPromises = skills.map((s) =>
            ctx.do.list<{ from: string; to: string }>(
              `/relationships/from/${encodeURIComponent(s.to)}?verb=developedWith`
            )
          )
          const toolResults = await Promise.all(toolPromises)

          // Flatten and dedupe tools
          const allTools = [...new Set(toolResults.flat().map((t) => t.to))]

          return {
            occupation: 'Occupation/join-occ-1',
            skillCount: skills.length,
            toolCount: allTools.length,
            tools: allTools,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Join should complete in reasonable time
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('three-way join across DOs', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-three-way-join',
        target: 'graph.perf.do',
        iterations: 15,
        warmup: 2,
        setup: async (ctx) => {
          // Job Title -> Occupation -> Industry -> Company (simulated)
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'mapsTo',
              from: 'JobTitle/three-way-title',
              to: 'Occupation/three-way-occ',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'employedIn',
              from: 'Occupation/three-way-occ',
              to: 'Industry/three-way-naics',
            }),
          })
          // Multiple companies in industry
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'operatesIn',
                from: `Company/three-way-co-${i}`,
                to: 'Industry/three-way-naics',
              }),
            })
          }
        },
        run: async (ctx) => {
          // Hop 1: Job Title -> Occupation
          const occupations = await ctx.do.list<{ to: string }>(
            '/relationships/from/JobTitle%2Fthree-way-title?verb=mapsTo'
          )
          if (occupations.length === 0) return { companies: [], found: false }

          // Hop 2: Occupation -> Industry
          const industries = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(occupations[0]!.to)}?verb=employedIn`
          )
          if (industries.length === 0) return { companies: [], found: false }

          // Hop 3: Industry <- Companies
          const companies = await ctx.do.list<{ from: string }>(
            `/relationships/to/${encodeURIComponent(industries[0]!.to)}?verb=operatesIn`
          )

          return {
            jobTitle: 'JobTitle/three-way-title',
            occupation: occupations[0]!.to,
            industry: industries[0]!.to,
            companies: companies.map((c) => c.from),
            found: true,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(15)
      // Three-way join should still be reasonable
      expect(result.stats.p50).toBeLessThan(150)
    })
  })

  describe('distributed graph algorithms', () => {
    it('distributed BFS across shards', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-distributed-bfs',
        target: 'graph.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create graph that spans shards
          // Shard boundaries at every 10 nodes
          const nodeCount = 50
          for (let i = 0; i < nodeCount - 1; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'next',
                from: `Distributed/node-${i}`,
                to: `Distributed/node-${i + 1}`,
                data: {
                  sourceShard: Math.floor(i / 10),
                  targetShard: Math.floor((i + 1) / 10),
                },
              }),
            })
          }
        },
        run: async (ctx) => {
          // BFS from node-0 to find all reachable nodes
          const visited = new Set<string>()
          const queue: string[] = ['Distributed/node-0']
          let hops = 0

          while (queue.length > 0 && visited.size < 50) {
            const current = queue.shift()!
            if (visited.has(current)) continue
            visited.add(current)

            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(current)}?verb=next`
            )

            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                queue.push(edge.to)
              }
            }
            hops++
          }

          return {
            reachable: visited.size,
            hops,
            crossShardHops: Math.floor(visited.size / 10),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // Distributed BFS is expensive but should complete
      expect(result.stats.p50).toBeLessThan(5000)
    })

    it('distributed connected component', async () => {
      const result = await benchmark({
        name: 'graph-cross-do-distributed-component',
        target: 'graph.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create a component spanning 3 shards
          const edges = [
            { from: 'Comp/shard0-a', to: 'Comp/shard0-b' },
            { from: 'Comp/shard0-b', to: 'Comp/shard1-a' }, // Cross-shard
            { from: 'Comp/shard1-a', to: 'Comp/shard1-b' },
            { from: 'Comp/shard1-b', to: 'Comp/shard2-a' }, // Cross-shard
            { from: 'Comp/shard2-a', to: 'Comp/shard2-b' },
            { from: 'Comp/shard2-b', to: 'Comp/shard0-a' }, // Cycle back
          ]

          for (const edge of edges) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'connected',
                from: edge.from,
                to: edge.to,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Find connected component starting from shard0-a
          const component = new Set<string>()
          const queue: string[] = ['Comp/shard0-a']

          while (queue.length > 0) {
            const current = queue.shift()!
            if (component.has(current)) continue
            component.add(current)

            // Get outbound
            const outbound = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(current)}?verb=connected`
            )
            for (const edge of outbound) {
              if (!component.has(edge.to)) queue.push(edge.to)
            }

            // Get inbound
            const inbound = await ctx.do.list<{ from: string }>(
              `/relationships/to/${encodeURIComponent(current)}?verb=connected`
            )
            for (const edge of inbound) {
              if (!component.has(edge.from)) queue.push(edge.from)
            }
          }

          // Count shards
          const shards = new Set(Array.from(component).map((n) => n.split('-')[0]))

          return {
            componentSize: component.size,
            shardCount: shards.size,
            nodes: Array.from(component),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(500)
    })
  })
})
