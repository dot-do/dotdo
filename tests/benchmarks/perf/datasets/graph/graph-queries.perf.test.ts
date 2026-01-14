/**
 * Graph Query Patterns Performance Benchmarks
 *
 * Tests real-world query patterns on the standards.org.ai interconnected graph:
 * - "Find all tools used by occupation X"
 * - "Find all occupations using tool Y"
 * - "Find common tools between occupations A and B"
 * - "Traverse APQC process hierarchy to depth N"
 * - "Find job titles for occupation with skill Z"
 *
 * These patterns represent common graph queries that customers will run.
 *
 * Target endpoints: graph.perf.do, standards.perf.do
 *
 * @see db/stores.ts for RelationshipsStore implementation
 * @see dotdo-zas1m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Graph Query Pattern Benchmarks', () => {
  describe('tool queries', () => {
    it('find all tools used by occupation X', async () => {
      const result = await benchmark({
        name: 'graph-query-tools-by-occupation',
        target: 'standards.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const occupationId = 'Occupation/15-1252.00' // Software Developer
          // Simulate ONET tools data
          const tools = [
            'Tool/IDE-VSCode',
            'Tool/IDE-IntelliJ',
            'Tool/Git',
            'Tool/Docker',
            'Tool/Kubernetes',
            'Tool/AWS-CLI',
            'Tool/Postman',
            'Tool/Jira',
            'Tool/Slack',
            'Tool/GitHub',
          ]

          for (const tool of tools) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occupationId,
                to: tool,
                data: { frequency: 'daily', source: 'ONET' },
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
      // Simple outbound query should be fast
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('find all tools with UNSPSC classification', async () => {
      const result = await benchmark({
        name: 'graph-query-tools-with-unspsc',
        target: 'standards.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const tools = [
            { tool: 'Tool/laptop', unspsc: 'UNSPSC/43211503' },
            { tool: 'Tool/monitor', unspsc: 'UNSPSC/43211508' },
            { tool: 'Tool/keyboard', unspsc: 'UNSPSC/43211706' },
            { tool: 'Tool/mouse', unspsc: 'UNSPSC/43211708' },
          ]

          for (const { tool, unspsc } of tools) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'classifiedAs',
                from: tool,
                to: unspsc,
                data: { standard: 'UNSPSC v24' },
              }),
            })
          }
        },
        run: async (ctx) => {
          // Get tools and their UNSPSC classifications
          const tools = ['Tool/laptop', 'Tool/monitor', 'Tool/keyboard', 'Tool/mouse']
          const results = await Promise.all(
            tools.map((tool) =>
              ctx.do.list<{ to: string; data: Record<string, unknown> }>(
                `/relationships/from/${encodeURIComponent(tool)}?verb=classifiedAs`
              )
            )
          )
          return results.flat()
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('occupation queries', () => {
    it('find all occupations using tool Y', async () => {
      const result = await benchmark({
        name: 'graph-query-occupations-by-tool',
        target: 'standards.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const toolId = 'Tool/Git'
          // Many occupations use Git
          const occupations = [
            'Occupation/15-1252.00', // Software Dev
            'Occupation/15-1253.00', // Data Scientist
            'Occupation/15-1254.00', // Web Dev
            'Occupation/15-1255.00', // DevOps
            'Occupation/15-1256.00', // SRE
          ]

          for (const occ of occupations) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'uses',
                from: occ,
                to: toolId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/Tool%2FGit?verb=uses')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Inbound query should be fast with proper indexing
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('find occupations in industry (NAICS)', async () => {
      const result = await benchmark({
        name: 'graph-query-occupations-by-naics',
        target: 'standards.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const naicsCode = 'NAICS/5112' // Software Publishers
          const occupations = [
            'Occupation/15-1252.00',
            'Occupation/15-1253.00',
            'Occupation/15-1254.00',
            'Occupation/15-1255.00',
            'Occupation/15-1256.00',
            'Occupation/11-3021.00', // Computer and IS Managers
            'Occupation/13-1111.00', // Management Analysts
          ]

          for (const occ of occupations) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'employedIn',
                from: occ,
                to: naicsCode,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/NAICS%2F5112?verb=employedIn')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('find occupations with specific skill', async () => {
      const result = await benchmark({
        name: 'graph-query-occupations-by-skill',
        target: 'standards.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const skill = 'Skill/python-programming'
          const occupations = [
            'Occupation/15-1252.00',
            'Occupation/15-1253.00',
            'Occupation/15-2051.00', // Data Scientists
            'Occupation/15-2031.00', // Operations Research
          ]

          for (const occ of occupations) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'requires',
                from: occ,
                to: skill,
                data: { level: 'advanced', importance: 4.5 },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/Skill%2Fpython-programming?verb=requires')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('common entity queries', () => {
    it('find common tools between occupations A and B', async () => {
      const result = await benchmark({
        name: 'graph-query-common-tools',
        target: 'standards.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const occ1 = 'Occupation/15-1252.00' // Software Dev
          const occ2 = 'Occupation/15-1253.00' // Data Scientist

          // Shared tools
          const sharedTools = ['Tool/Git', 'Tool/Python', 'Tool/VSCode', 'Tool/Docker']
          for (const tool of sharedTools) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'uses', from: occ1, to: tool }),
            })
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'uses', from: occ2, to: tool }),
            })
          }

          // Unique to occ1
          const occ1Only = ['Tool/React', 'Tool/TypeScript']
          for (const tool of occ1Only) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'uses', from: occ1, to: tool }),
            })
          }

          // Unique to occ2
          const occ2Only = ['Tool/Jupyter', 'Tool/TensorFlow', 'Tool/Pandas']
          for (const tool of occ2Only) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'uses', from: occ2, to: tool }),
            })
          }
        },
        run: async (ctx) => {
          // Get tools for both occupations in parallel
          const [tools1, tools2] = await Promise.all([
            ctx.do.list<{ to: string }>('/relationships/from/Occupation%2F15-1252.00?verb=uses'),
            ctx.do.list<{ to: string }>('/relationships/from/Occupation%2F15-1253.00?verb=uses'),
          ])

          // Find intersection
          const set1 = new Set(tools1.map((t) => t.to))
          const common = tools2.filter((t) => set1.has(t.to)).map((t) => t.to)

          return { common, count: common.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Parallel queries + intersection should be fast
      expect(result.stats.p50).toBeLessThan(30)
    })

    it('find common skills between tasks', async () => {
      const result = await benchmark({
        name: 'graph-query-common-skills',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const task1 = 'Task/code-review'
          const task2 = 'Task/debugging'

          const sharedSkills = ['Skill/reading-comprehension', 'Skill/critical-thinking', 'Skill/programming']
          for (const skill of sharedSkills) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'requires', from: task1, to: skill }),
            })
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'requires', from: task2, to: skill }),
            })
          }

          // Unique skills
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'requires', from: task1, to: 'Skill/communication' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'requires', from: task2, to: 'Skill/troubleshooting' }),
          })
        },
        run: async (ctx) => {
          const [skills1, skills2] = await Promise.all([
            ctx.do.list<{ to: string }>('/relationships/from/Task%2Fcode-review?verb=requires'),
            ctx.do.list<{ to: string }>('/relationships/from/Task%2Fdebugging?verb=requires'),
          ])

          const set1 = new Set(skills1.map((s) => s.to))
          const common = skills2.filter((s) => set1.has(s.to)).map((s) => s.to)

          return { common, count: common.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(30)
    })
  })

  describe('hierarchy queries (APQC)', () => {
    it('traverse APQC process hierarchy to depth N', async () => {
      const result = await benchmark({
        name: 'graph-query-apqc-hierarchy',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // APQC Cross-Industry Framework structure:
          // Level 0: Category (e.g., 1.0 Develop Vision & Strategy)
          // Level 1: Process Group (e.g., 1.1 Define business concept)
          // Level 2: Process (e.g., 1.1.1 Assess environment)
          // Level 3: Activity (e.g., 1.1.1.1 Analyze external environment)

          const hierarchy = [
            { parent: 'APQC/1.0', child: 'APQC/1.1' },
            { parent: 'APQC/1.0', child: 'APQC/1.2' },
            { parent: 'APQC/1.0', child: 'APQC/1.3' },
            { parent: 'APQC/1.1', child: 'APQC/1.1.1' },
            { parent: 'APQC/1.1', child: 'APQC/1.1.2' },
            { parent: 'APQC/1.1.1', child: 'APQC/1.1.1.1' },
            { parent: 'APQC/1.1.1', child: 'APQC/1.1.1.2' },
            { parent: 'APQC/1.2', child: 'APQC/1.2.1' },
            { parent: 'APQC/1.2.1', child: 'APQC/1.2.1.1' },
          ]

          for (const { parent, child } of hierarchy) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'contains', from: parent, to: child }),
            })
          }
        },
        run: async (ctx) => {
          const maxDepth = 3
          const traverse = async (
            node: string,
            depth: number
          ): Promise<{ id: string; children: unknown[] }> => {
            const result = { id: node, children: [] as unknown[] }

            if (depth >= maxDepth) return result

            const children = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(node)}?verb=contains`
            )

            for (const child of children) {
              const childTree = await traverse(child.to, depth + 1)
              result.children.push(childTree)
            }

            return result
          }

          return traverse('APQC/1.0', 0)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Hierarchy traversal is O(n) queries where n = nodes visited
      expect(result.stats.p50).toBeLessThan(300)
    })

    it('find leaf processes (no children)', async () => {
      const result = await benchmark({
        name: 'graph-query-apqc-leaves',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Same hierarchy as above
          const hierarchy = [
            { parent: 'APQC/2.0', child: 'APQC/2.1' },
            { parent: 'APQC/2.1', child: 'APQC/2.1.1' },
            { parent: 'APQC/2.1', child: 'APQC/2.1.2' },
            // 2.1.1 and 2.1.2 are leaves (no children)
          ]

          for (const { parent, child } of hierarchy) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'contains', from: parent, to: child }),
            })
          }
        },
        run: async (ctx) => {
          // Get all descendants of 2.0
          const allNodes = new Set<string>()
          const queue: string[] = ['APQC/2.0']

          while (queue.length > 0) {
            const node = queue.shift()!
            if (allNodes.has(node)) continue
            allNodes.add(node)

            const children = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(node)}?verb=contains`
            )
            for (const child of children) {
              queue.push(child.to)
            }
          }

          // Find leaves (nodes with no children)
          const leaves: string[] = []
          for (const node of allNodes) {
            const children = await ctx.do.list(
              `/relationships/from/${encodeURIComponent(node)}?verb=contains`
            )
            if (children.length === 0) {
              leaves.push(node)
            }
          }

          return { leaves, count: leaves.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('find path from root to specific process', async () => {
      const result = await benchmark({
        name: 'graph-query-apqc-path',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create path: 3.0 -> 3.1 -> 3.1.2 -> 3.1.2.3
          const path = [
            { parent: 'APQC/3.0', child: 'APQC/3.1' },
            { parent: 'APQC/3.0', child: 'APQC/3.2' },
            { parent: 'APQC/3.1', child: 'APQC/3.1.1' },
            { parent: 'APQC/3.1', child: 'APQC/3.1.2' },
            { parent: 'APQC/3.1.2', child: 'APQC/3.1.2.1' },
            { parent: 'APQC/3.1.2', child: 'APQC/3.1.2.2' },
            { parent: 'APQC/3.1.2', child: 'APQC/3.1.2.3' },
          ]

          for (const { parent, child } of path) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'contains', from: parent, to: child }),
            })
          }
        },
        run: async (ctx) => {
          // Find path from target up to root
          const target = 'APQC/3.1.2.3'
          const path: string[] = [target]
          let current = target

          while (true) {
            const parents = await ctx.do.list<{ from: string }>(
              `/relationships/to/${encodeURIComponent(current)}?verb=contains`
            )
            if (parents.length === 0) break
            current = parents[0]!.from
            path.unshift(current)
          }

          return { path, depth: path.length - 1 }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(150)
    })
  })

  describe('job title queries', () => {
    it('find job titles for occupation with skill Z', async () => {
      const result = await benchmark({
        name: 'graph-query-titles-by-skill',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Skill -> Occupation (reverse lookup)
          const skill = 'Skill/machine-learning'
          const occupations = ['Occupation/15-1253.00', 'Occupation/15-2051.00']

          for (const occ of occupations) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'requires', from: occ, to: skill }),
            })
          }

          // Job Titles -> Occupations
          const titles = [
            { title: 'JobTitle/data-scientist', occ: 'Occupation/15-2051.00' },
            { title: 'JobTitle/ml-engineer', occ: 'Occupation/15-2051.00' },
            { title: 'JobTitle/ai-researcher', occ: 'Occupation/15-2051.00' },
            { title: 'JobTitle/software-engineer-ml', occ: 'Occupation/15-1253.00' },
          ]

          for (const { title, occ } of titles) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'mapsTo', from: title, to: occ }),
            })
          }
        },
        run: async (ctx) => {
          // Step 1: Find occupations requiring the skill
          const occupations = await ctx.do.list<{ from: string }>(
            '/relationships/to/Skill%2Fmachine-learning?verb=requires'
          )

          // Step 2: Find job titles for each occupation (parallel)
          const titlePromises = occupations.map((occ) =>
            ctx.do.list<{ from: string }>(
              `/relationships/to/${encodeURIComponent(occ.from)}?verb=mapsTo`
            )
          )
          const titleResults = await Promise.all(titlePromises)

          // Flatten and dedupe
          const titles = [...new Set(titleResults.flat().map((t) => t.from))]

          return { skill: 'Skill/machine-learning', titles, count: titles.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('find job titles in industry (via NAICS)', async () => {
      const result = await benchmark({
        name: 'graph-query-titles-by-industry',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const industry = 'NAICS/5112' // Software Publishers
          const occupations = ['Occupation/15-1252.00', 'Occupation/15-1253.00']

          for (const occ of occupations) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'employedIn', from: occ, to: industry }),
            })
          }

          // Job titles for these occupations
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'mapsTo',
              from: 'JobTitle/software-developer',
              to: 'Occupation/15-1252.00',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'mapsTo',
              from: 'JobTitle/full-stack-developer',
              to: 'Occupation/15-1252.00',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'mapsTo',
              from: 'JobTitle/data-analyst',
              to: 'Occupation/15-1253.00',
            }),
          })
        },
        run: async (ctx) => {
          // Step 1: Find occupations in industry
          const occupations = await ctx.do.list<{ from: string }>(
            '/relationships/to/NAICS%2F5112?verb=employedIn'
          )

          // Step 2: Find job titles for each occupation
          const titlePromises = occupations.map((occ) =>
            ctx.do.list<{ from: string }>(
              `/relationships/to/${encodeURIComponent(occ.from)}?verb=mapsTo`
            )
          )
          const titleResults = await Promise.all(titlePromises)

          const titles = [...new Set(titleResults.flat().map((t) => t.from))]

          return { industry: 'NAICS/5112', titles, count: titles.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('aggregation queries', () => {
    it('count tools by occupation type', async () => {
      const result = await benchmark({
        name: 'graph-query-tool-count-by-occupation',
        target: 'standards.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const occupations = [
            { id: 'Occupation/15-1252.00', toolCount: 10 },
            { id: 'Occupation/15-1253.00', toolCount: 8 },
            { id: 'Occupation/15-1254.00', toolCount: 12 },
          ]

          for (const occ of occupations) {
            for (let i = 0; i < occ.toolCount; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'uses',
                  from: occ.id,
                  to: `Tool/${occ.id.split('/')[1]}-tool-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          const occupations = ['Occupation/15-1252.00', 'Occupation/15-1253.00', 'Occupation/15-1254.00']

          const counts = await Promise.all(
            occupations.map(async (occ) => {
              const tools = await ctx.do.list(`/relationships/from/${encodeURIComponent(occ)}?verb=uses`)
              return { occupation: occ, toolCount: tools.length }
            })
          )

          return counts
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('find most connected skill (highest in-degree)', async () => {
      const result = await benchmark({
        name: 'graph-query-most-connected-skill',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create skills with varying connection counts
          const skills = [
            { id: 'Skill/communication', connections: 15 },
            { id: 'Skill/programming', connections: 20 },
            { id: 'Skill/critical-thinking', connections: 25 },
            { id: 'Skill/writing', connections: 10 },
          ]

          for (const skill of skills) {
            for (let i = 0; i < skill.connections; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'requires',
                  from: `Task/task-${skill.id}-${i}`,
                  to: skill.id,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          const skills = [
            'Skill/communication',
            'Skill/programming',
            'Skill/critical-thinking',
            'Skill/writing',
          ]

          const degrees = await Promise.all(
            skills.map(async (skill) => {
              const inbound = await ctx.do.list(`/relationships/to/${encodeURIComponent(skill)}?verb=requires`)
              return { skill, inDegree: inbound.length }
            })
          )

          // Find max
          const sorted = degrees.sort((a, b) => b.inDegree - a.inDegree)
          return { mostConnected: sorted[0], all: sorted }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('cross-reference queries', () => {
    it('find occupations sharing multiple attributes', async () => {
      const result = await benchmark({
        name: 'graph-query-multi-attribute-match',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Occupation with skill AND industry AND tool
          const occ1 = 'Occupation/15-1252.00'
          const occ2 = 'Occupation/15-1253.00'
          const occ3 = 'Occupation/11-3021.00' // Different industry

          // Shared skill
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'requires', from: occ1, to: 'Skill/analysis' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'requires', from: occ2, to: 'Skill/analysis' }),
          })

          // Shared industry
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'employedIn', from: occ1, to: 'NAICS/5112' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'employedIn', from: occ2, to: 'NAICS/5112' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'employedIn', from: occ3, to: 'NAICS/5413' }),
          })

          // Shared tool
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'uses', from: occ1, to: 'Tool/Python' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'uses', from: occ2, to: 'Tool/Python' }),
          })
        },
        run: async (ctx) => {
          // Find occupations with all three: skill, industry, tool
          const skill = 'Skill/analysis'
          const industry = 'NAICS/5112'
          const tool = 'Tool/Python'

          // Get occupations for each attribute
          const [bySkill, byIndustry, byTool] = await Promise.all([
            ctx.do.list<{ from: string }>(`/relationships/to/${encodeURIComponent(skill)}?verb=requires`),
            ctx.do.list<{ from: string }>(`/relationships/to/${encodeURIComponent(industry)}?verb=employedIn`),
            ctx.do.list<{ from: string }>(`/relationships/to/${encodeURIComponent(tool)}?verb=uses`),
          ])

          // Find intersection
          const skillSet = new Set(bySkill.map((o) => o.from))
          const industrySet = new Set(byIndustry.map((o) => o.from))
          const matches = byTool.filter((o) => skillSet.has(o.from) && industrySet.has(o.from))

          return { matches: matches.map((m) => m.from), count: matches.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(60)
    })
  })
})
