/**
 * E2E Tests: Cross-DO Graph Operations
 *
 * Tests graph operations that span multiple Durable Objects.
 * In dotdo, the graph can be sharded across DOs by:
 * - Type (e.g., occupations.standards.do, tasks.standards.do)
 * - Namespace (e.g., tenant1.graph.do, tenant2.graph.do)
 * - Region (e.g., us-east.graph.do, eu-west.graph.do)
 *
 * These tests verify that cross-DO relationships and traversals
 * work correctly, maintaining consistency and proper resolution.
 *
 * @module tests/e2e/graph/graph-cross-do.spec
 */

import { test, expect } from '@playwright/test'

/**
 * API endpoint for cross-DO graph operations
 */
const GRAPH_API = '/api/graph'

/**
 * Generate a unique ID for test isolation
 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('Cross-DO Graph - Multi-Type Sharding', () => {
  test.describe('Create Cross-DO Relationships', () => {
    test('creates relationship between Things in different type shards', async ({ request }) => {
      // Create an Occupation (would be in occupations.standards.do)
      const occupationId = uniqueId('Occupation')
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: occupationId,
          type: 'Occupation',
          data: { title: 'Software Developer', code: '15-1252' },
        },
      })

      // Create a Task (would be in tasks.standards.do)
      const taskId = uniqueId('Task')
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: taskId,
          type: 'Task',
          data: { name: 'Write code', complexity: 'high' },
        },
      })

      // Create cross-type relationship
      const response = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: occupationId,
          to: taskId,
          verb: 'performs',
          data: {
            frequency: 'daily',
            importance: 'critical',
          },
        },
      })

      expect(response.status()).toBe(201)
      const rel = await response.json()

      expect(rel.from).toBe(occupationId)
      expect(rel.to).toBe(taskId)
      expect(rel.verb).toBe('performs')
    })

    test('creates multi-hop cross-DO relationships', async ({ request }) => {
      // Create Occupation -> Task -> Skill chain (3 different type shards)
      const occupationId = uniqueId('Occupation')
      const taskId = uniqueId('Task')
      const skillId = uniqueId('Skill')

      await request.post(`${GRAPH_API}/things`, {
        data: { id: occupationId, type: 'Occupation', data: { title: 'Data Scientist' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: taskId, type: 'Task', data: { name: 'Analyze data' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: skillId, type: 'Skill', data: { name: 'Python programming' } },
      })

      // Create chain of relationships
      const rel1 = await request.post(`${GRAPH_API}/relationships`, {
        data: { from: occupationId, to: taskId, verb: 'performs' },
      })
      expect(rel1.status()).toBe(201)

      const rel2 = await request.post(`${GRAPH_API}/relationships`, {
        data: { from: taskId, to: skillId, verb: 'requires' },
      })
      expect(rel2.status()).toBe(201)
    })

    test('handles fan-out relationships to multiple DO shards', async ({ request }) => {
      // One Occupation connecting to multiple types (Tasks, Skills, Tools, Industries)
      const occupationId = uniqueId('Occupation')
      await request.post(`${GRAPH_API}/things`, {
        data: { id: occupationId, type: 'Occupation', data: { title: 'ML Engineer' } },
      })

      const targets = [
        { id: uniqueId('Task'), type: 'Task', verb: 'performs', data: { name: 'Train models' } },
        { id: uniqueId('Skill'), type: 'Skill', verb: 'requires', data: { name: 'TensorFlow' } },
        { id: uniqueId('Tool'), type: 'Tool', verb: 'uses', data: { name: 'GPU Cluster' } },
        { id: uniqueId('Industry'), type: 'Industry', verb: 'employedIn', data: { name: 'Technology' } },
      ]

      // Create all target Things
      for (const target of targets) {
        await request.post(`${GRAPH_API}/things`, {
          data: { id: target.id, type: target.type, data: target.data },
        })
      }

      // Create relationships
      for (const target of targets) {
        const response = await request.post(`${GRAPH_API}/relationships`, {
          data: { from: occupationId, to: target.id, verb: target.verb },
        })
        expect(response.status()).toBe(201)
      }

      // Verify all relationships exist
      const relsResponse = await request.get(`${GRAPH_API}/relationships?from=${occupationId}`)
      expect(relsResponse.ok()).toBe(true)
      const rels = await relsResponse.json()

      expect(rels.items.length).toBe(4)
    })
  })

  test.describe('Query Cross-DO Relationships', () => {
    test('queries outgoing relationships to different type shards', async ({ request }) => {
      const sourceId = uniqueId('CrossDOQuery-Source')
      const target1Id = uniqueId('CrossDOQuery-Target1')
      const target2Id = uniqueId('CrossDOQuery-Target2')

      // Setup
      await request.post(`${GRAPH_API}/things`, {
        data: { id: sourceId, type: 'Organization', data: { name: 'Acme' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: target1Id, type: 'Department', data: { name: 'Engineering' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: target2Id, type: 'Project', data: { name: 'Alpha' } },
      })

      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: sourceId, to: target1Id, verb: 'hasDepartment' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: sourceId, to: target2Id, verb: 'sponsors' },
      })

      // Query all outgoing relationships
      const response = await request.get(`${GRAPH_API}/relationships?from=${sourceId}`)
      expect(response.ok()).toBe(true)

      const result = await response.json()
      expect(result.items.length).toBe(2)

      const verbs = result.items.map((r: { verb: string }) => r.verb).sort()
      expect(verbs).toEqual(['hasDepartment', 'sponsors'])
    })

    test('queries incoming relationships from different type shards', async ({ request }) => {
      const targetId = uniqueId('SharedTarget')
      const source1Id = uniqueId('Source1')
      const source2Id = uniqueId('Source2')

      // Setup - target Thing that multiple types reference
      await request.post(`${GRAPH_API}/things`, {
        data: { id: targetId, type: 'Certification', data: { name: 'AWS Solutions Architect' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: source1Id, type: 'Person', data: { name: 'Alice' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: source2Id, type: 'Role', data: { name: 'Cloud Engineer' } },
      })

      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: source1Id, to: targetId, verb: 'holds' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: source2Id, to: targetId, verb: 'recommends' },
      })

      // Query incoming
      const response = await request.get(`${GRAPH_API}/relationships?to=${targetId}`)
      expect(response.ok()).toBe(true)

      const result = await response.json()
      expect(result.items.length).toBe(2)
    })
  })
})

test.describe('Cross-DO Graph - Traversals', () => {
  test.describe('Multi-Hop Traversals', () => {
    test('traverses path across 3 type shards', async ({ request }) => {
      // Setup: Company -> Department -> Project
      const companyId = uniqueId('Traverse-Company')
      const deptId = uniqueId('Traverse-Department')
      const projectId = uniqueId('Traverse-Project')

      await request.post(`${GRAPH_API}/things`, {
        data: { id: companyId, type: 'Company', data: { name: 'TechCorp' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: deptId, type: 'Department', data: { name: 'R&D' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: projectId, type: 'Project', data: { name: 'AI Research' } },
      })

      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: companyId, to: deptId, verb: 'contains' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: deptId, to: projectId, verb: 'owns' },
      })

      // Traverse from Company to depth 2
      const response = await request.get(`${GRAPH_API}/traverse?start=${companyId}&direction=outgoing&maxDepth=2`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.nodes).toBeDefined()
      expect(result.nodes.length).toBe(2) // Department and Project

      const nodeIds = result.nodes.map((n: { id: string }) => n.id)
      expect(nodeIds).toContain(deptId)
      expect(nodeIds).toContain(projectId)
    })

    test('traverses bidirectional across type shards', async ({ request }) => {
      // Hub-and-spoke: Multiple Things connect to a central Thing
      const hubId = uniqueId('Hub')
      const spoke1Id = uniqueId('Spoke1')
      const spoke2Id = uniqueId('Spoke2')
      const spoke3Id = uniqueId('Spoke3')

      await request.post(`${GRAPH_API}/things`, {
        data: { id: hubId, type: 'Team', data: { name: 'Platform' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: spoke1Id, type: 'Person', data: { name: 'Alice' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: spoke2Id, type: 'Tool', data: { name: 'Kubernetes' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: spoke3Id, type: 'Project', data: { name: 'Infrastructure' } },
      })

      // Spokes connect to hub
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: spoke1Id, to: hubId, verb: 'memberOf' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: hubId, to: spoke2Id, verb: 'uses' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: hubId, to: spoke3Id, verb: 'owns' },
      })

      // Traverse both directions from hub
      const response = await request.get(`${GRAPH_API}/traverse?start=${hubId}&direction=both&maxDepth=1`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.nodes.length).toBe(3) // All three spokes
    })

    test('handles cycles in cross-DO traversal', async ({ request }) => {
      // Create a cycle: A -> B -> C -> A
      const aId = uniqueId('Cycle-A')
      const bId = uniqueId('Cycle-B')
      const cId = uniqueId('Cycle-C')

      await request.post(`${GRAPH_API}/things`, {
        data: { id: aId, type: 'Node', data: { name: 'A' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: bId, type: 'Node', data: { name: 'B' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: cId, type: 'Node', data: { name: 'C' } },
      })

      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: aId, to: bId, verb: 'next' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: bId, to: cId, verb: 'next' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: cId, to: aId, verb: 'next' },
      })

      // Traverse should handle cycle without infinite loop
      const response = await request.get(`${GRAPH_API}/traverse?start=${aId}&direction=outgoing&maxDepth=10`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      // Should visit each node only once
      const nodeIds = result.nodes.map((n: { id: string }) => n.id)
      const uniqueIds = [...new Set(nodeIds)]
      expect(uniqueIds.length).toBe(nodeIds.length)
    })
  })

  test.describe('Path Finding Across Shards', () => {
    test('finds shortest path across type shards', async ({ request }) => {
      // Setup path: Person -> Team -> Project -> Deliverable
      const personId = uniqueId('Path-Person')
      const teamId = uniqueId('Path-Team')
      const projectId = uniqueId('Path-Project')
      const deliverableId = uniqueId('Path-Deliverable')

      await request.post(`${GRAPH_API}/things`, {
        data: { id: personId, type: 'Person', data: { name: 'Alice' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: teamId, type: 'Team', data: { name: 'Platform' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: projectId, type: 'Project', data: { name: 'API Gateway' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: deliverableId, type: 'Deliverable', data: { name: 'v2.0 Release' } },
      })

      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: personId, to: teamId, verb: 'memberOf' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: teamId, to: projectId, verb: 'owns' },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: projectId, to: deliverableId, verb: 'produces' },
      })

      // Find path from Person to Deliverable
      const response = await request.get(`${GRAPH_API}/path?from=${personId}&to=${deliverableId}`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.path).toBeDefined()
      expect(result.path.length).toBe(3) // 3 hops
      expect(result.path[0].from).toBe(personId)
      expect(result.path[result.path.length - 1].to).toBe(deliverableId)
    })

    test('returns null for disconnected nodes across shards', async ({ request }) => {
      const isolatedId1 = uniqueId('Isolated-1')
      const isolatedId2 = uniqueId('Isolated-2')

      await request.post(`${GRAPH_API}/things`, {
        data: { id: isolatedId1, type: 'TypeA', data: { name: 'Isolated1' } },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: isolatedId2, type: 'TypeB', data: { name: 'Isolated2' } },
      })

      // No relationship between them
      const response = await request.get(`${GRAPH_API}/path?from=${isolatedId1}&to=${isolatedId2}`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.path).toBeNull()
    })
  })
})

test.describe('Cross-DO Graph - Parallel Queries', () => {
  test('executes parallel queries to different type shards', async ({ request }) => {
    // Setup data across multiple types
    const prefix = uniqueId('Parallel')

    const types = ['Customer', 'Order', 'Product', 'Supplier']
    for (const type of types) {
      for (let i = 0; i < 3; i++) {
        await request.post(`${GRAPH_API}/things`, {
          data: {
            id: `${prefix}-${type}-${i}`,
            type,
            data: { index: i, category: type },
          },
        })
      }
    }

    // Execute parallel queries
    const [customers, orders, products, suppliers] = await Promise.all([
      request.get(`${GRAPH_API}/things?type=Customer`),
      request.get(`${GRAPH_API}/things?type=Order`),
      request.get(`${GRAPH_API}/things?type=Product`),
      request.get(`${GRAPH_API}/things?type=Supplier`),
    ])

    // All should succeed
    expect(customers.ok()).toBe(true)
    expect(orders.ok()).toBe(true)
    expect(products.ok()).toBe(true)
    expect(suppliers.ok()).toBe(true)
  })

  test('parallel relationship queries across shards', async ({ request }) => {
    const hubId = uniqueId('ParallelHub')
    await request.post(`${GRAPH_API}/things`, {
      data: { id: hubId, type: 'Hub', data: { name: 'Central' } },
    })

    // Create targets in different type shards
    const targets = ['Alpha', 'Beta', 'Gamma', 'Delta']
    for (const name of targets) {
      const targetId = `${hubId}-target-${name}`
      await request.post(`${GRAPH_API}/things`, {
        data: { id: targetId, type: name, data: { name } },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: hubId, to: targetId, verb: 'connects' },
      })
    }

    // Query relationships in parallel
    const queries = targets.map((name) =>
      request.get(`${GRAPH_API}/relationships?from=${hubId}&verb=connects`)
    )

    const responses = await Promise.all(queries)

    // All should return same result (testing consistency)
    const results = await Promise.all(responses.map((r) => r.json()))

    for (const result of results) {
      expect(result.items.length).toBe(4)
    }
  })
})

test.describe('Cross-DO Graph - Aggregations', () => {
  test('counts entities across type shards', async ({ request }) => {
    const prefix = uniqueId('Count')

    // Create entities across types
    await request.post(`${GRAPH_API}/things`, {
      data: { id: `${prefix}-person-1`, type: 'Person', data: {} },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: `${prefix}-person-2`, type: 'Person', data: {} },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: `${prefix}-company-1`, type: 'Company', data: {} },
    })

    // Get counts
    const response = await request.get(`${GRAPH_API}/stats`)

    expect(response.ok()).toBe(true)
    const stats = await response.json()

    expect(stats.thingCount).toBeDefined()
    expect(stats.thingCount).toBeGreaterThanOrEqual(3)
  })

  test('aggregates relationship counts by type', async ({ request }) => {
    const prefix = uniqueId('RelCount')
    const sourceId = `${prefix}-source`

    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'Source', data: {} },
    })

    // Create various relationships
    const verbs = ['owns', 'owns', 'uses', 'references', 'references', 'references']
    for (let i = 0; i < verbs.length; i++) {
      const targetId = `${prefix}-target-${i}`
      await request.post(`${GRAPH_API}/things`, {
        data: { id: targetId, type: 'Target', data: {} },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: { from: sourceId, to: targetId, verb: verbs[i] },
      })
    }

    // Get verb distribution
    const response = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&groupBy=verb`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // Should have counts grouped by verb
    expect(result.groups).toBeDefined()
    expect(result.groups.owns).toBe(2)
    expect(result.groups.uses).toBe(1)
    expect(result.groups.references).toBe(3)
  })
})
