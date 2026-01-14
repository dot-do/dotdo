/**
 * RelationshipsStore Traversal Performance Benchmarks
 *
 * Tests graph traversal operations using RelationshipsStore on the standards.org.ai
 * interconnected graph. Covers single-hop, multi-hop, and bidirectional traversals.
 *
 * Graph structure (standards.org.ai):
 * - Occupations -> Tasks -> Skills
 * - Occupations -> Tools -> UNSPSC products
 * - Job Titles -> Occupations -> Industries (NAICS)
 * - Processes -> Sub-processes (APQC hierarchy)
 *
 * Target endpoints: graph.perf.do, standards.perf.do
 *
 * @see db/stores.ts for RelationshipsStore implementation
 * @see dotdo-zas1m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('RelationshipsStore Traversal Benchmarks', () => {
  describe('from() single-hop outbound edges', () => {
    it('traverse occupation -> tasks (single hop)', async () => {
      const result = await benchmark({
        name: 'graph-from-occupation-tasks',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Seed occupation with linked tasks
          const occupationId = 'Occupation/15-1252.00' // Software Developers
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'requires',
                from: occupationId,
                to: `Task/task-${i}`,
                data: { importance: Math.random() * 100 },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Occupation%2F15-1252.00')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Single-hop outbound should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse occupation -> tools (single hop)', async () => {
      const result = await benchmark({
        name: 'graph-from-occupation-tools',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const occupationId = 'Occupation/15-1252.00'
          for (let i = 0; i < 15; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occupationId,
                to: `Tool/tool-${i}`,
                data: { frequency: 'daily' },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Occupation%2F15-1252.00?verb=uses')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse process -> sub-processes (APQC hierarchy)', async () => {
      const result = await benchmark({
        name: 'graph-from-process-subprocesses',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // APQC process hierarchy: Level 1 -> Level 2
          const processId = 'Process/1.0' // Operating Process
          for (let i = 1; i <= 6; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'contains',
                from: processId,
                to: `Process/1.${i}`,
                data: { level: 2 },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Process%2F1.0?verb=contains')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('from() on node with zero edges', async () => {
      const result = await benchmark({
        name: 'graph-from-empty',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.list(`/relationships/from/NonExistent%2F${i}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Empty results should be very fast (sub-5ms)
      expect(result.stats.p50).toBeLessThan(5)
    })
  })

  describe('to() single-hop inbound edges', () => {
    it('traverse -> occupation (inbound from job titles)', async () => {
      const result = await benchmark({
        name: 'graph-to-occupation-from-titles',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const occupationId = 'Occupation/15-1252.00'
          // Many job titles map to one occupation
          for (let i = 0; i < 30; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'mapsTo',
                from: `JobTitle/title-${i}`,
                to: occupationId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/Occupation%2F15-1252.00')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Inbound traversal should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse -> tool (inbound from occupations)', async () => {
      const result = await benchmark({
        name: 'graph-to-tool-from-occupations',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const toolId = 'Tool/IDE-001' // Popular IDE used by many occupations
          for (let i = 0; i < 25; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: `Occupation/occ-${i}`,
                to: toolId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/Tool%2FIDE-001')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('traverse -> skill (highly connected node)', async () => {
      const result = await benchmark({
        name: 'graph-to-skill-high-degree',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const skillId = 'Skill/programming' // Common skill
          // Create 100 inbound edges
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'requires',
                from: `Task/task-${i}`,
                to: skillId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/Skill%2Fprogramming')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // High-degree nodes may be slower but still sub-50ms
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('multi-hop traversals (A->B->C)', () => {
    it('occupation -> tasks -> skills (two-hop)', async () => {
      const result = await benchmark({
        name: 'graph-two-hop-occupation-tasks-skills',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const occupationId = 'Occupation/15-1252.00'
          // First hop: occupation -> tasks
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'requires',
                from: occupationId,
                to: `Task/hop-task-${i}`,
              }),
            })
            // Second hop: tasks -> skills
            for (let j = 0; j < 3; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'requiresSkill',
                  from: `Task/hop-task-${i}`,
                  to: `Skill/skill-${i}-${j}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // First hop
          const tasks = await ctx.do.list<{ to: string }>(
            '/relationships/from/Occupation%2F15-1252.00?verb=requires'
          )
          // Second hop (parallel)
          const skillPromises = tasks.map((t) =>
            ctx.do.list(`/relationships/from/${encodeURIComponent(t.to)}?verb=requiresSkill`)
          )
          return Promise.all(skillPromises)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Two-hop with parallel second hop should be sub-100ms
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('job title -> occupation -> industry (three-hop with NAICS)', async () => {
      const result = await benchmark({
        name: 'graph-three-hop-title-occupation-industry',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Job Title -> Occupation
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'mapsTo',
              from: 'JobTitle/senior-dev',
              to: 'Occupation/15-1252.00',
            }),
          })
          // Occupation -> Industries (NAICS codes)
          for (let i = 0; i < 3; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'employedIn',
                from: 'Occupation/15-1252.00',
                to: `Industry/NAICS-5112${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Hop 1: Job Title -> Occupation
          const occupations = await ctx.do.list<{ to: string }>(
            '/relationships/from/JobTitle%2Fsenior-dev?verb=mapsTo'
          )
          if (occupations.length === 0) return []

          // Hop 2: Occupation -> Industries
          const industries = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(occupations[0]!.to)}?verb=employedIn`
          )
          return industries
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('tool -> UNSPSC -> parent categories (UNSPSC hierarchy)', async () => {
      const result = await benchmark({
        name: 'graph-unspsc-hierarchy-traversal',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Tool -> UNSPSC product
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'classifiedAs',
              from: 'Tool/laptop',
              to: 'UNSPSC/43211503', // Laptop computers
            }),
          })
          // UNSPSC hierarchy: Product -> Class -> Family -> Segment
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'parentOf',
              from: 'UNSPSC/432115', // Class
              to: 'UNSPSC/43211503',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'parentOf',
              from: 'UNSPSC/4321', // Family
              to: 'UNSPSC/432115',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'parentOf',
              from: 'UNSPSC/43', // Segment
              to: 'UNSPSC/4321',
            }),
          })
        },
        run: async (ctx) => {
          // Get UNSPSC code for tool
          const products = await ctx.do.list<{ to: string }>(
            '/relationships/from/Tool%2Flaptop?verb=classifiedAs'
          )
          if (products.length === 0) return []

          // Traverse up the hierarchy
          const ancestors: string[] = [products[0]!.to]
          let current = products[0]!.to

          for (let depth = 0; depth < 4; depth++) {
            const parents = await ctx.do.list<{ from: string }>(
              `/relationships/to/${encodeURIComponent(current)}?verb=parentOf`
            )
            if (parents.length === 0) break
            current = parents[0]!.from
            ancestors.push(current)
          }

          return ancestors
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Hierarchy traversal (4 hops max) should be sub-150ms
      expect(result.stats.p50).toBeLessThan(150)
    })
  })

  describe('bidirectional traversals', () => {
    it('find common connections between two occupations', async () => {
      const result = await benchmark({
        name: 'graph-bidirectional-common-connections',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Two occupations that share some tools
          const occ1 = 'Occupation/15-1252.00' // Software Developer
          const occ2 = 'Occupation/15-1253.00' // Data Scientist

          // Shared tools
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occ1,
                to: `Tool/shared-${i}`,
              }),
            })
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occ2,
                to: `Tool/shared-${i}`,
              }),
            })
          }

          // Unique tools for occ1
          for (let i = 0; i < 3; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occ1,
                to: `Tool/occ1-unique-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Get tools used by both occupations
          const [tools1, tools2] = await Promise.all([
            ctx.do.list<{ to: string }>('/relationships/from/Occupation%2F15-1252.00?verb=uses'),
            ctx.do.list<{ to: string }>('/relationships/from/Occupation%2F15-1253.00?verb=uses'),
          ])

          // Find intersection
          const set1 = new Set(tools1.map((t) => t.to))
          const shared = tools2.filter((t) => set1.has(t.to))
          return shared
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Bidirectional with intersection should be sub-50ms
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('find path between skill and industry', async () => {
      const result = await benchmark({
        name: 'graph-bidirectional-skill-to-industry',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Skill -> Tasks -> Occupations -> Industries
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'requiredBy',
              from: 'Skill/python',
              to: 'Task/analyze-data',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'performedBy',
              from: 'Task/analyze-data',
              to: 'Occupation/15-1252.00',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'employedIn',
              from: 'Occupation/15-1252.00',
              to: 'Industry/NAICS-51',
            }),
          })
        },
        run: async (ctx) => {
          // Forward from skill
          const tasks = await ctx.do.list<{ to: string }>(
            '/relationships/from/Skill%2Fpython?verb=requiredBy'
          )
          if (tasks.length === 0) return null

          const occupations = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(tasks[0]!.to)}?verb=performedBy`
          )
          if (occupations.length === 0) return null

          const industries = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(occupations[0]!.to)}?verb=employedIn`
          )
          return { skill: 'Skill/python', industries: industries.map((i) => i.to) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('filtered traversals by verb/type', () => {
    it('filter from() by verb', async () => {
      const result = await benchmark({
        name: 'graph-filter-from-by-verb',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const occupationId = 'Occupation/filter-test'
          const verbs = ['uses', 'requires', 'performs', 'supervises']

          for (let i = 0; i < 40; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: verbs[i % verbs.length],
                from: occupationId,
                to: `Target/target-${i}`,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          const verbs = ['uses', 'requires', 'performs', 'supervises']
          const verb = verbs[i % verbs.length]
          return ctx.do.list(`/relationships/from/Occupation%2Ffilter-test?verb=${verb}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Filtered traversal should be efficient (sub-10ms)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('filter to() by verb', async () => {
      const result = await benchmark({
        name: 'graph-filter-to-by-verb',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const targetId = 'Skill/filter-target'
          const verbs = ['requires', 'develops', 'enhances', 'tests']

          for (let i = 0; i < 40; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: verbs[i % verbs.length],
                from: `Source/source-${i}`,
                to: targetId,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          const verbs = ['requires', 'develops', 'enhances', 'tests']
          const verb = verbs[i % verbs.length]
          return ctx.do.list(`/relationships/to/Skill%2Ffilter-target?verb=${verb}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('combined filters (verb + limit)', async () => {
      const result = await benchmark({
        name: 'graph-combined-filters',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const sourceId = 'Occupation/combined-filter'
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: sourceId,
                to: `Tool/combined-${i}`,
                data: { priority: i },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Occupation%2Fcombined-filter?verb=uses&limit=10')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('traversal with edge data', () => {
    it('traverse and access edge metadata', async () => {
      const result = await benchmark({
        name: 'graph-edge-metadata-access',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const occupationId = 'Occupation/metadata-test'
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'requires',
                from: occupationId,
                to: `Task/meta-task-${i}`,
                data: {
                  importance: Math.random() * 100,
                  frequency: ['daily', 'weekly', 'monthly'][i % 3],
                  source: 'ONET',
                  lastUpdated: new Date().toISOString(),
                },
              }),
            })
          }
        },
        run: async (ctx) => {
          const edges = await ctx.do.list<{ to: string; data: Record<string, unknown> }>(
            '/relationships/from/Occupation%2Fmetadata-test?verb=requires'
          )
          // Access edge data
          return edges.map((e) => ({
            target: e.to,
            importance: e.data?.importance,
            frequency: e.data?.frequency,
          }))
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(15)
    })
  })
})
