/**
 * Graph Algorithms Performance Benchmarks
 *
 * Tests graph algorithm operations using RelationshipsStore:
 * - Shortest path between nodes
 * - Connected components
 * - Cycle detection
 * - Subgraph extraction
 *
 * These algorithms are implemented client-side using the RelationshipsStore traversal
 * primitives, measuring the overhead of multi-hop graph operations.
 *
 * Target endpoints: graph.perf.do, standards.perf.do
 *
 * @see db/stores.ts for RelationshipsStore implementation
 * @see dotdo-zas1m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Graph Algorithms Benchmarks', () => {
  describe('shortest path', () => {
    it('shortest path in small graph (BFS)', async () => {
      const result = await benchmark({
        name: 'graph-algo-shortest-path-small',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create a small connected graph
          // A -> B -> C -> D
          //      |    |
          //      v    v
          //      E -> F
          const edges = [
            { from: 'Node/A', to: 'Node/B' },
            { from: 'Node/B', to: 'Node/C' },
            { from: 'Node/C', to: 'Node/D' },
            { from: 'Node/B', to: 'Node/E' },
            { from: 'Node/C', to: 'Node/F' },
            { from: 'Node/E', to: 'Node/F' },
          ]

          for (const edge of edges) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'connects',
                from: edge.from,
                to: edge.to,
              }),
            })
          }
        },
        run: async (ctx) => {
          // BFS from A to D
          const start = 'Node/A'
          const target = 'Node/D'
          const visited = new Set<string>([start])
          const queue: { node: string; path: string[] }[] = [{ node: start, path: [start] }]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current.node === target) {
              return current.path
            }

            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(current.node)}?verb=connects`
            )

            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                visited.add(edge.to)
                queue.push({ node: edge.to, path: [...current.path, edge.to] })
              }
            }
          }

          return null // No path found
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // BFS on small graph should complete quickly
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('shortest path in occupation graph (occupation -> skills)', async () => {
      const result = await benchmark({
        name: 'graph-algo-shortest-path-occupation',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Graph: Occupation -> Task -> Skill
          // Multiple paths exist, find shortest

          // Occupation -> Tasks
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'performs',
              from: 'Occupation/dev',
              to: 'Task/coding',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'performs',
              from: 'Occupation/dev',
              to: 'Task/reviewing',
            }),
          })

          // Tasks -> Skills (direct path)
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'requires',
              from: 'Task/coding',
              to: 'Skill/programming',
            }),
          })

          // Longer path through reviewing
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'requires',
              from: 'Task/reviewing',
              to: 'Skill/communication',
            }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'enhances',
              from: 'Skill/communication',
              to: 'Skill/programming',
            }),
          })
        },
        run: async (ctx) => {
          // Find shortest path from Occupation/dev to Skill/programming
          const start = 'Occupation/dev'
          const target = 'Skill/programming'
          const visited = new Set<string>([start])
          const queue: { node: string; path: string[]; depth: number }[] = [
            { node: start, path: [start], depth: 0 },
          ]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current.node === target) {
              return { path: current.path, depth: current.depth }
            }

            // Get all outbound edges (any verb)
            const edges = await ctx.do.list<{ to: string }>(`/relationships/from/${encodeURIComponent(current.node)}`)

            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                visited.add(edge.to)
                queue.push({
                  node: edge.to,
                  path: [...current.path, edge.to],
                  depth: current.depth + 1,
                })
              }
            }
          }

          return null
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(150)
    })

    it('shortest path with depth limit', async () => {
      const result = await benchmark({
        name: 'graph-algo-shortest-path-depth-limit',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Deep chain: A -> B -> C -> D -> E -> F -> G
          const nodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
          for (let i = 0; i < nodes.length - 1; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'next',
                from: `DeepNode/${nodes[i]}`,
                to: `DeepNode/${nodes[i + 1]}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          const maxDepth = 3
          const start = 'DeepNode/A'
          const target = 'DeepNode/G'
          const visited = new Set<string>([start])
          const queue: { node: string; path: string[]; depth: number }[] = [
            { node: start, path: [start], depth: 0 },
          ]

          while (queue.length > 0) {
            const current = queue.shift()!

            if (current.node === target) {
              return current.path
            }

            if (current.depth >= maxDepth) {
              continue // Depth limit reached
            }

            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(current.node)}?verb=next`
            )

            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                visited.add(edge.to)
                queue.push({
                  node: edge.to,
                  path: [...current.path, edge.to],
                  depth: current.depth + 1,
                })
              }
            }
          }

          return null // Not found within depth limit
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Depth-limited search should be faster
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('connected components', () => {
    it('find connected component from starting node', async () => {
      const result = await benchmark({
        name: 'graph-algo-connected-component',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Component 1: A-B-C (connected)
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'related', from: 'Comp/A', to: 'Comp/B' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'related', from: 'Comp/B', to: 'Comp/C' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'related', from: 'Comp/C', to: 'Comp/A' }),
          })

          // Component 2: D-E (separate)
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'related', from: 'Comp/D', to: 'Comp/E' }),
          })
        },
        run: async (ctx) => {
          // Find all nodes connected to Comp/A (bidirectional)
          const component = new Set<string>()
          const queue: string[] = ['Comp/A']

          while (queue.length > 0) {
            const current = queue.shift()!
            if (component.has(current)) continue
            component.add(current)

            // Get outbound edges
            const outbound = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(current)}?verb=related`
            )
            for (const edge of outbound) {
              if (!component.has(edge.to)) {
                queue.push(edge.to)
              }
            }

            // Get inbound edges
            const inbound = await ctx.do.list<{ from: string }>(
              `/relationships/to/${encodeURIComponent(current)}?verb=related`
            )
            for (const edge of inbound) {
              if (!component.has(edge.from)) {
                queue.push(edge.from)
              }
            }
          }

          return Array.from(component)
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Connected component discovery should be reasonable
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('count component size (APQC process tree)', async () => {
      const result = await benchmark({
        name: 'graph-algo-component-size-apqc',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // APQC-like hierarchy
          // Level 0: Root
          // Level 1: 3 categories
          // Level 2: 2 processes each
          const root = 'Process/root'
          for (let i = 1; i <= 3; i++) {
            const category = `Process/cat-${i}`
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'contains', from: root, to: category }),
            })
            for (let j = 1; j <= 2; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'contains',
                  from: category,
                  to: `Process/cat-${i}-proc-${j}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // Count all nodes in the tree rooted at Process/root
          const nodes = new Set<string>()
          const queue: string[] = ['Process/root']

          while (queue.length > 0) {
            const current = queue.shift()!
            if (nodes.has(current)) continue
            nodes.add(current)

            const children = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(current)}?verb=contains`
            )
            for (const child of children) {
              queue.push(child.to)
            }
          }

          return { size: nodes.size, nodes: Array.from(nodes) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(150)
    })
  })

  describe('cycle detection', () => {
    it('detect cycle in directed graph (DFS)', async () => {
      const result = await benchmark({
        name: 'graph-algo-cycle-detection',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Graph with cycle: A -> B -> C -> A
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'follows', from: 'Cycle/A', to: 'Cycle/B' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'follows', from: 'Cycle/B', to: 'Cycle/C' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'follows', from: 'Cycle/C', to: 'Cycle/A' }),
          })
        },
        run: async (ctx) => {
          // DFS-based cycle detection
          const visited = new Set<string>()
          const recursionStack = new Set<string>()

          const hasCycle = async (node: string): Promise<boolean> => {
            if (recursionStack.has(node)) return true // Cycle found
            if (visited.has(node)) return false

            visited.add(node)
            recursionStack.add(node)

            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(node)}?verb=follows`
            )

            for (const edge of edges) {
              if (await hasCycle(edge.to)) return true
            }

            recursionStack.delete(node)
            return false
          }

          return hasCycle('Cycle/A')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('detect no cycle in DAG', async () => {
      const result = await benchmark({
        name: 'graph-algo-no-cycle-dag',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // DAG (no cycle): A -> B -> D
          //                      |    ^
          //                      v    |
          //                      C ---+
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'depends', from: 'DAG/A', to: 'DAG/B' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'depends', from: 'DAG/B', to: 'DAG/C' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'depends', from: 'DAG/B', to: 'DAG/D' }),
          })
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'depends', from: 'DAG/C', to: 'DAG/D' }),
          })
        },
        run: async (ctx) => {
          const visited = new Set<string>()
          const recursionStack = new Set<string>()

          const hasCycle = async (node: string): Promise<boolean> => {
            if (recursionStack.has(node)) return true
            if (visited.has(node)) return false

            visited.add(node)
            recursionStack.add(node)

            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(node)}?verb=depends`
            )

            for (const edge of edges) {
              if (await hasCycle(edge.to)) return true
            }

            recursionStack.delete(node)
            return false
          }

          return hasCycle('DAG/A')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('detect self-loop', async () => {
      const result = await benchmark({
        name: 'graph-algo-self-loop',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Self-loop: A -> A
          await ctx.do.request('/relationships', {
            method: 'POST',
            body: JSON.stringify({ verb: 'references', from: 'SelfLoop/A', to: 'SelfLoop/A' }),
          })
        },
        run: async (ctx) => {
          // Simple self-loop check
          const edges = await ctx.do.list<{ from: string; to: string }>(
            '/relationships/from/SelfLoop%2FA?verb=references'
          )
          return edges.some((e) => e.from === e.to || e.to === 'SelfLoop/A')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Self-loop detection is a single query
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('subgraph extraction', () => {
    it('extract N-hop subgraph from node', async () => {
      const result = await benchmark({
        name: 'graph-algo-subgraph-extraction',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create a star topology with center node
          const center = 'Sub/center'
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'links', from: center, to: `Sub/spoke-${i}` }),
            })
            // Each spoke has 2 leaves
            for (let j = 0; j < 2; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'links',
                  from: `Sub/spoke-${i}`,
                  to: `Sub/leaf-${i}-${j}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          const maxHops = 2
          const nodes = new Set<string>()
          const edges: Array<{ from: string; to: string; verb: string }> = []
          const queue: { node: string; depth: number }[] = [{ node: 'Sub/center', depth: 0 }]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (nodes.has(current.node)) continue
            nodes.add(current.node)

            if (current.depth < maxHops) {
              const outEdges = await ctx.do.list<{ from: string; to: string; verb: string }>(
                `/relationships/from/${encodeURIComponent(current.node)}?verb=links`
              )

              for (const edge of outEdges) {
                edges.push({ from: current.node, to: edge.to, verb: 'links' })
                if (!nodes.has(edge.to)) {
                  queue.push({ node: edge.to, depth: current.depth + 1 })
                }
              }
            }
          }

          return { nodeCount: nodes.size, edgeCount: edges.length, nodes: Array.from(nodes) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // 2-hop subgraph extraction should be reasonable
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('extract occupation subgraph (occupation + tasks + skills)', async () => {
      const result = await benchmark({
        name: 'graph-algo-occupation-subgraph',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          const occupation = 'Occupation/15-1252.00'

          // Occupation -> Tasks
          for (let i = 0; i < 5; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'requires',
                from: occupation,
                to: `Task/sub-task-${i}`,
              }),
            })
            // Tasks -> Skills
            for (let j = 0; j < 3; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'uses',
                  from: `Task/sub-task-${i}`,
                  to: `Skill/sub-skill-${i}-${j}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          const occupation = 'Occupation/15-1252.00'
          const subgraph = {
            root: occupation,
            tasks: [] as string[],
            skills: [] as string[],
            edges: [] as Array<{ from: string; to: string; verb: string }>,
          }

          // Get tasks
          const taskEdges = await ctx.do.list<{ to: string }>(
            `/relationships/from/${encodeURIComponent(occupation)}?verb=requires`
          )
          subgraph.tasks = taskEdges.map((e) => e.to)
          for (const edge of taskEdges) {
            subgraph.edges.push({ from: occupation, to: edge.to, verb: 'requires' })
          }

          // Get skills for each task (parallel)
          const skillPromises = taskEdges.map((task) =>
            ctx.do.list<{ from: string; to: string }>(
              `/relationships/from/${encodeURIComponent(task.to)}?verb=uses`
            )
          )
          const skillResults = await Promise.all(skillPromises)

          for (const skills of skillResults) {
            for (const skill of skills) {
              if (!subgraph.skills.includes(skill.to)) {
                subgraph.skills.push(skill.to)
              }
              subgraph.edges.push({ from: skill.from, to: skill.to, verb: 'uses' })
            }
          }

          return subgraph
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('extract subgraph by edge type filter', async () => {
      const result = await benchmark({
        name: 'graph-algo-subgraph-by-verb',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const root = 'Filter/root'
          const verbs = ['uses', 'requires', 'produces']

          for (let i = 0; i < 15; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: verbs[i % verbs.length],
                from: root,
                to: `Filter/target-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Extract only 'uses' edges
          const usesEdges = await ctx.do.list<{ from: string; to: string }>(
            '/relationships/from/Filter%2Froot?verb=uses'
          )

          return {
            verb: 'uses',
            edgeCount: usesEdges.length,
            targets: usesEdges.map((e) => e.to),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('topological sort', () => {
    it('topological sort of dependency graph', async () => {
      const result = await benchmark({
        name: 'graph-algo-topological-sort',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Build order: E, D, C, B, A (A depends on B, B on C, etc.)
          const deps = [
            { from: 'Topo/A', to: 'Topo/B' },
            { from: 'Topo/A', to: 'Topo/C' },
            { from: 'Topo/B', to: 'Topo/D' },
            { from: 'Topo/C', to: 'Topo/D' },
            { from: 'Topo/D', to: 'Topo/E' },
          ]

          for (const dep of deps) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({ verb: 'dependsOn', from: dep.from, to: dep.to }),
            })
          }
        },
        run: async (ctx) => {
          // Kahn's algorithm for topological sort
          const inDegree = new Map<string, number>()
          const graph = new Map<string, string[]>()
          const allNodes = new Set<string>()

          // Build graph from known nodes
          const nodes = ['Topo/A', 'Topo/B', 'Topo/C', 'Topo/D', 'Topo/E']

          for (const node of nodes) {
            allNodes.add(node)
            inDegree.set(node, 0)
            graph.set(node, [])
          }

          // Get all edges
          for (const node of nodes) {
            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(node)}?verb=dependsOn`
            )
            for (const edge of edges) {
              graph.get(node)!.push(edge.to)
              inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1)
            }
          }

          // Find nodes with no incoming edges
          const queue: string[] = []
          for (const [node, degree] of inDegree) {
            if (degree === 0) queue.push(node)
          }

          const sorted: string[] = []
          while (queue.length > 0) {
            const node = queue.shift()!
            sorted.push(node)

            for (const neighbor of graph.get(node) || []) {
              const newDegree = inDegree.get(neighbor)! - 1
              inDegree.set(neighbor, newDegree)
              if (newDegree === 0) queue.push(neighbor)
            }
          }

          return sorted.reverse() // Reverse for build order
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(200)
    })
  })
})
