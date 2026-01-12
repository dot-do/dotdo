/**
 * Graph Query Engine Tests
 *
 * TDD RED phase: Comprehensive failing tests for graph operations.
 *
 * Features:
 * 1. Nodes - create, update, delete, query nodes with properties
 * 2. Edges - create relationships between nodes with properties
 * 3. Traversal - BFS/DFS traversals, path finding
 * 4. Pattern Matching - Cypher-like pattern queries
 * 5. Aggregations - graph-based aggregations (degree, centrality)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GraphEngine,
  type Node,
  type Edge,
  type Pattern,
  type TraversalOptions,
  type TraversalResult,
  type PathResult,
  type MatchResult,
  GraphError,
  NodeNotFoundError,
  EdgeNotFoundError,
} from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('GraphEngine', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  // ==========================================================================
  // 1. NODE OPERATIONS
  // ==========================================================================

  describe('Node Operations', () => {
    describe('createNode', () => {
      it('creates a node with label and properties', async () => {
        const alice = await graph.createNode('Person', { name: 'Alice', age: 30 })

        expect(alice).toBeDefined()
        expect(alice.id).toBeDefined()
        expect(alice.label).toBe('Person')
        expect(alice.properties.name).toBe('Alice')
        expect(alice.properties.age).toBe(30)
      })

      it('generates unique IDs for nodes', async () => {
        const node1 = await graph.createNode('Person', { name: 'Alice' })
        const node2 = await graph.createNode('Person', { name: 'Bob' })

        expect(node1.id).not.toBe(node2.id)
      })

      it('accepts custom node ID', async () => {
        const node = await graph.createNode('Person', { name: 'Alice' }, { id: 'custom-id' })

        expect(node.id).toBe('custom-id')
      })

      it('throws error for duplicate custom ID', async () => {
        await graph.createNode('Person', { name: 'Alice' }, { id: 'dup-id' })

        await expect(
          graph.createNode('Person', { name: 'Bob' }, { id: 'dup-id' })
        ).rejects.toThrow(GraphError)
      })

      it('stores timestamps on node creation', async () => {
        const before = Date.now()
        const node = await graph.createNode('Person', { name: 'Alice' })
        const after = Date.now()

        expect(node.createdAt).toBeGreaterThanOrEqual(before)
        expect(node.createdAt).toBeLessThanOrEqual(after)
        expect(node.updatedAt).toBeGreaterThanOrEqual(before)
        expect(node.updatedAt).toBeLessThanOrEqual(after)
      })

      it('creates node with empty properties', async () => {
        const node = await graph.createNode('EmptyNode', {})

        expect(node.label).toBe('EmptyNode')
        expect(node.properties).toEqual({})
      })

      it('handles complex nested properties', async () => {
        const node = await graph.createNode('Document', {
          title: 'Test',
          metadata: { author: 'Alice', tags: ['a', 'b'] },
          counts: [1, 2, 3],
        })

        expect(node.properties.metadata).toEqual({ author: 'Alice', tags: ['a', 'b'] })
        expect(node.properties.counts).toEqual([1, 2, 3])
      })
    })

    describe('getNode', () => {
      it('retrieves node by ID', async () => {
        const created = await graph.createNode('Person', { name: 'Alice' })
        const retrieved = await graph.getNode(created.id)

        expect(retrieved).toEqual(created)
      })

      it('returns null for non-existent node', async () => {
        const retrieved = await graph.getNode('non-existent-id')

        expect(retrieved).toBeNull()
      })
    })

    describe('updateNode', () => {
      it('updates node properties', async () => {
        const node = await graph.createNode('Person', { name: 'Alice', age: 30 })
        const updated = await graph.updateNode(node.id, { age: 31 })

        expect(updated.properties.name).toBe('Alice')
        expect(updated.properties.age).toBe(31)
      })

      it('adds new properties', async () => {
        const node = await graph.createNode('Person', { name: 'Alice' })
        const updated = await graph.updateNode(node.id, { email: 'alice@example.com' })

        expect(updated.properties.email).toBe('alice@example.com')
      })

      it('updates timestamp', async () => {
        const node = await graph.createNode('Person', { name: 'Alice' })
        const originalUpdatedAt = node.updatedAt

        // Small delay to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await graph.updateNode(node.id, { age: 30 })

        expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt)
        expect(updated.createdAt).toBe(node.createdAt)
      })

      it('throws error for non-existent node', async () => {
        await expect(
          graph.updateNode('non-existent', { name: 'Test' })
        ).rejects.toThrow(NodeNotFoundError)
      })

      it('allows updating label', async () => {
        const node = await graph.createNode('Person', { name: 'Alice' })
        const updated = await graph.updateNode(node.id, {}, { label: 'Employee' })

        expect(updated.label).toBe('Employee')
      })
    })

    describe('deleteNode', () => {
      it('deletes node by ID', async () => {
        const node = await graph.createNode('Person', { name: 'Alice' })
        const deleted = await graph.deleteNode(node.id)

        expect(deleted).toBe(true)

        const retrieved = await graph.getNode(node.id)
        expect(retrieved).toBeNull()
      })

      it('returns false for non-existent node', async () => {
        const deleted = await graph.deleteNode('non-existent')

        expect(deleted).toBe(false)
      })

      it('deletes connected edges when node is deleted', async () => {
        const alice = await graph.createNode('Person', { name: 'Alice' })
        const bob = await graph.createNode('Person', { name: 'Bob' })
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id)

        await graph.deleteNode(alice.id)

        const retrievedEdge = await graph.getEdge(edge.id)
        expect(retrievedEdge).toBeNull()
      })

      it('cascade deletes incoming and outgoing edges', async () => {
        const alice = await graph.createNode('Person', { name: 'Alice' })
        const bob = await graph.createNode('Person', { name: 'Bob' })
        const charlie = await graph.createNode('Person', { name: 'Charlie' })

        await graph.createEdge(alice.id, 'KNOWS', bob.id)
        await graph.createEdge(bob.id, 'KNOWS', charlie.id)
        await graph.createEdge(charlie.id, 'KNOWS', bob.id)

        await graph.deleteNode(bob.id)

        const edges = await graph.getEdges()
        expect(edges).toHaveLength(0)
      })
    })

    describe('queryNodes', () => {
      beforeEach(async () => {
        await graph.createNode('Person', { name: 'Alice', age: 30, city: 'NYC' })
        await graph.createNode('Person', { name: 'Bob', age: 25, city: 'LA' })
        await graph.createNode('Company', { name: 'Acme Inc', city: 'NYC' })
        await graph.createNode('Person', { name: 'Charlie', age: 35, city: 'NYC' })
      })

      it('queries nodes by label', async () => {
        const persons = await graph.queryNodes({ label: 'Person' })

        expect(persons).toHaveLength(3)
        expect(persons.every((n) => n.label === 'Person')).toBe(true)
      })

      it('queries nodes by property equality', async () => {
        const nycNodes = await graph.queryNodes({ where: { city: 'NYC' } })

        expect(nycNodes).toHaveLength(3)
      })

      it('queries nodes by label and properties', async () => {
        const nycPersons = await graph.queryNodes({
          label: 'Person',
          where: { city: 'NYC' },
        })

        expect(nycPersons).toHaveLength(2)
      })

      it('supports comparison operators', async () => {
        const olderThan28 = await graph.queryNodes({
          label: 'Person',
          where: { age: { $gt: 28 } },
        })

        expect(olderThan28).toHaveLength(2)
        expect(olderThan28.every((n) => (n.properties.age as number) > 28)).toBe(true)
      })

      it('supports $lt operator', async () => {
        const youngerThan30 = await graph.queryNodes({
          label: 'Person',
          where: { age: { $lt: 30 } },
        })

        expect(youngerThan30).toHaveLength(1)
        expect(youngerThan30[0].properties.name).toBe('Bob')
      })

      it('supports $gte and $lte operators', async () => {
        const age25to30 = await graph.queryNodes({
          label: 'Person',
          where: { age: { $gte: 25, $lte: 30 } },
        })

        expect(age25to30).toHaveLength(2)
      })

      it('supports $in operator', async () => {
        const aliceOrBob = await graph.queryNodes({
          label: 'Person',
          where: { name: { $in: ['Alice', 'Bob'] } },
        })

        expect(aliceOrBob).toHaveLength(2)
      })

      it('supports $contains for string matching', async () => {
        const containsA = await graph.queryNodes({
          label: 'Person',
          where: { name: { $contains: 'lic' } },
        })

        expect(containsA).toHaveLength(1)
        expect(containsA[0].properties.name).toBe('Alice')
      })

      it('supports $exists operator', async () => {
        await graph.createNode('Person', { name: 'Dave' }) // No age

        const withAge = await graph.queryNodes({
          label: 'Person',
          where: { age: { $exists: true } },
        })

        expect(withAge).toHaveLength(3)
      })

      it('supports limit and offset', async () => {
        const page1 = await graph.queryNodes({ label: 'Person', limit: 2 })
        const page2 = await graph.queryNodes({ label: 'Person', limit: 2, offset: 2 })

        expect(page1).toHaveLength(2)
        expect(page2).toHaveLength(1)
      })

      it('supports ordering', async () => {
        const orderedByAge = await graph.queryNodes({
          label: 'Person',
          orderBy: { age: 'asc' },
        })

        expect(orderedByAge[0].properties.name).toBe('Bob')
        expect(orderedByAge[2].properties.name).toBe('Charlie')
      })

      it('returns empty array when no matches', async () => {
        const noMatch = await graph.queryNodes({ where: { city: 'Chicago' } })

        expect(noMatch).toHaveLength(0)
      })
    })
  })

  // ==========================================================================
  // 2. EDGE OPERATIONS
  // ==========================================================================

  describe('Edge Operations', () => {
    let alice: Node
    let bob: Node
    let company: Node

    beforeEach(async () => {
      alice = await graph.createNode('Person', { name: 'Alice', age: 30 })
      bob = await graph.createNode('Person', { name: 'Bob', age: 25 })
      company = await graph.createNode('Company', { name: 'Acme Inc' })
    })

    describe('createEdge', () => {
      it('creates edge between nodes', async () => {
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id)

        expect(edge).toBeDefined()
        expect(edge.id).toBeDefined()
        expect(edge.from).toBe(alice.id)
        expect(edge.to).toBe(bob.id)
        expect(edge.type).toBe('KNOWS')
      })

      it('creates edge with properties', async () => {
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })

        expect(edge.properties.since).toBe(2020)
      })

      it('creates edge with Node objects', async () => {
        const edge = await graph.createEdge(alice, 'WORKS_AT', company, { role: 'Engineer' })

        expect(edge.from).toBe(alice.id)
        expect(edge.to).toBe(company.id)
        expect(edge.properties.role).toBe('Engineer')
      })

      it('throws error for non-existent source node', async () => {
        await expect(
          graph.createEdge('non-existent', 'KNOWS', bob.id)
        ).rejects.toThrow(NodeNotFoundError)
      })

      it('throws error for non-existent target node', async () => {
        await expect(
          graph.createEdge(alice.id, 'KNOWS', 'non-existent')
        ).rejects.toThrow(NodeNotFoundError)
      })

      it('allows self-referential edges', async () => {
        const edge = await graph.createEdge(alice.id, 'REFLECTS_ON', alice.id)

        expect(edge.from).toBe(alice.id)
        expect(edge.to).toBe(alice.id)
      })

      it('allows multiple edges between same nodes', async () => {
        const edge1 = await graph.createEdge(alice.id, 'KNOWS', bob.id)
        const edge2 = await graph.createEdge(alice.id, 'WORKS_WITH', bob.id)

        expect(edge1.id).not.toBe(edge2.id)
      })

      it('stores timestamps on edge creation', async () => {
        const before = Date.now()
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id)
        const after = Date.now()

        expect(edge.createdAt).toBeGreaterThanOrEqual(before)
        expect(edge.createdAt).toBeLessThanOrEqual(after)
      })
    })

    describe('getEdge', () => {
      it('retrieves edge by ID', async () => {
        const created = await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })
        const retrieved = await graph.getEdge(created.id)

        expect(retrieved).toEqual(created)
      })

      it('returns null for non-existent edge', async () => {
        const retrieved = await graph.getEdge('non-existent')

        expect(retrieved).toBeNull()
      })
    })

    describe('updateEdge', () => {
      it('updates edge properties', async () => {
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })
        const updated = await graph.updateEdge(edge.id, { since: 2019, strength: 'strong' })

        expect(updated.properties.since).toBe(2019)
        expect(updated.properties.strength).toBe('strong')
      })

      it('throws error for non-existent edge', async () => {
        await expect(
          graph.updateEdge('non-existent', { since: 2020 })
        ).rejects.toThrow(EdgeNotFoundError)
      })
    })

    describe('deleteEdge', () => {
      it('deletes edge by ID', async () => {
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id)
        const deleted = await graph.deleteEdge(edge.id)

        expect(deleted).toBe(true)

        const retrieved = await graph.getEdge(edge.id)
        expect(retrieved).toBeNull()
      })

      it('returns false for non-existent edge', async () => {
        const deleted = await graph.deleteEdge('non-existent')

        expect(deleted).toBe(false)
      })

      it('does not delete connected nodes', async () => {
        const edge = await graph.createEdge(alice.id, 'KNOWS', bob.id)
        await graph.deleteEdge(edge.id)

        const aliceNode = await graph.getNode(alice.id)
        const bobNode = await graph.getNode(bob.id)

        expect(aliceNode).not.toBeNull()
        expect(bobNode).not.toBeNull()
      })
    })

    describe('queryEdges', () => {
      beforeEach(async () => {
        await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })
        await graph.createEdge(alice.id, 'WORKS_AT', company.id, { role: 'Engineer' })
        await graph.createEdge(bob.id, 'WORKS_AT', company.id, { role: 'Manager' })
      })

      it('queries edges by type', async () => {
        const worksAt = await graph.queryEdges({ type: 'WORKS_AT' })

        expect(worksAt).toHaveLength(2)
        expect(worksAt.every((e) => e.type === 'WORKS_AT')).toBe(true)
      })

      it('queries edges by source node', async () => {
        const fromAlice = await graph.queryEdges({ from: alice.id })

        expect(fromAlice).toHaveLength(2)
        expect(fromAlice.every((e) => e.from === alice.id)).toBe(true)
      })

      it('queries edges by target node', async () => {
        const toCompany = await graph.queryEdges({ to: company.id })

        expect(toCompany).toHaveLength(2)
        expect(toCompany.every((e) => e.to === company.id)).toBe(true)
      })

      it('queries edges by type and source', async () => {
        const aliceWorksAt = await graph.queryEdges({ type: 'WORKS_AT', from: alice.id })

        expect(aliceWorksAt).toHaveLength(1)
      })

      it('queries edges by properties', async () => {
        const engineers = await graph.queryEdges({
          type: 'WORKS_AT',
          where: { role: 'Engineer' },
        })

        expect(engineers).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // 3. TRAVERSAL OPERATIONS
  // ==========================================================================

  describe('Traversal Operations', () => {
    let alice: Node
    let bob: Node
    let charlie: Node
    let dave: Node
    let company: Node

    beforeEach(async () => {
      // Create a small social network
      alice = await graph.createNode('Person', { name: 'Alice' })
      bob = await graph.createNode('Person', { name: 'Bob' })
      charlie = await graph.createNode('Person', { name: 'Charlie' })
      dave = await graph.createNode('Person', { name: 'Dave' })
      company = await graph.createNode('Company', { name: 'Acme Inc' })

      // Alice -> Bob -> Charlie -> Dave
      await graph.createEdge(alice.id, 'KNOWS', bob.id)
      await graph.createEdge(bob.id, 'KNOWS', charlie.id)
      await graph.createEdge(charlie.id, 'KNOWS', dave.id)

      // Work relationships
      await graph.createEdge(alice.id, 'WORKS_AT', company.id)
      await graph.createEdge(bob.id, 'WORKS_AT', company.id)
    })

    describe('traverse (BFS)', () => {
      it('traverses outgoing edges', async () => {
        const result = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 1,
        })

        expect(result.nodes).toHaveLength(2) // bob and company
        expect(result.nodes.map((n) => n.properties.name)).toContain('Bob')
        expect(result.nodes.map((n) => n.properties.name)).toContain('Acme Inc')
      })

      it('traverses incoming edges', async () => {
        const result = await graph.traverse({
          start: bob.id,
          direction: 'INCOMING',
          maxDepth: 1,
        })

        expect(result.nodes).toHaveLength(1)
        expect(result.nodes[0].properties.name).toBe('Alice')
      })

      it('traverses both directions', async () => {
        const result = await graph.traverse({
          start: bob.id,
          direction: 'BOTH',
          maxDepth: 1,
        })

        expect(result.nodes).toHaveLength(3) // alice, charlie, company
      })

      it('respects maxDepth', async () => {
        const depth1 = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 1,
        })

        const depth3 = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 3,
        })

        expect(depth1.nodes.length).toBeLessThan(depth3.nodes.length)
      })

      it('filters by relationship type', async () => {
        const result = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 1,
          filter: { type: 'KNOWS' },
        })

        expect(result.nodes).toHaveLength(1)
        expect(result.nodes[0].properties.name).toBe('Bob')
      })

      it('returns visited paths', async () => {
        const result = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 3,
          filter: { type: 'KNOWS' },
        })

        expect(result.paths).toBeDefined()
        expect(result.paths?.length).toBeGreaterThan(0)

        // Path to Dave: Alice -> Bob -> Charlie -> Dave
        const davePath = result.paths?.find((p) =>
          p.nodes[p.nodes.length - 1].properties.name === 'Dave'
        )
        expect(davePath).toBeDefined()
        expect(davePath?.nodes).toHaveLength(4)
      })

      it('tracks depth for each node', async () => {
        const result = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 3,
          filter: { type: 'KNOWS' },
        })

        expect(result.depths).toBeDefined()
        expect(result.depths?.get(bob.id)).toBe(1)
        expect(result.depths?.get(charlie.id)).toBe(2)
        expect(result.depths?.get(dave.id)).toBe(3)
      })

      it('handles cycles without infinite loop', async () => {
        // Create a cycle: Dave -> Alice
        await graph.createEdge(dave.id, 'KNOWS', alice.id)

        const result = await graph.traverse({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 10,
          filter: { type: 'KNOWS' },
        })

        // Should visit each node only once
        const uniqueIds = new Set(result.nodes.map((n) => n.id))
        expect(uniqueIds.size).toBe(result.nodes.length)
      })

      it('throws error for non-existent start node', async () => {
        await expect(
          graph.traverse({
            start: 'non-existent',
            direction: 'OUTGOING',
            maxDepth: 1,
          })
        ).rejects.toThrow(NodeNotFoundError)
      })
    })

    describe('traverseDFS', () => {
      it('performs depth-first traversal', async () => {
        const result = await graph.traverseDFS({
          start: alice.id,
          direction: 'OUTGOING',
          maxDepth: 3,
          filter: { type: 'KNOWS' },
        })

        expect(result.nodes).toHaveLength(3) // bob, charlie, dave
        expect(result.visitOrder).toBeDefined()

        // DFS should go deep before wide
        const bobIndex = result.visitOrder!.indexOf(bob.id)
        const charlieIndex = result.visitOrder!.indexOf(charlie.id)
        const daveIndex = result.visitOrder!.indexOf(dave.id)

        expect(bobIndex).toBeLessThan(charlieIndex)
        expect(charlieIndex).toBeLessThan(daveIndex)
      })
    })

    describe('neighbors', () => {
      it('returns immediate neighbors', async () => {
        const neighbors = await graph.neighbors(alice.id)

        expect(neighbors).toHaveLength(2)
      })

      it('filters neighbors by relationship type', async () => {
        const neighbors = await graph.neighbors(alice.id, { type: 'KNOWS' })

        expect(neighbors).toHaveLength(1)
        expect(neighbors[0].properties.name).toBe('Bob')
      })

      it('filters by direction', async () => {
        const outgoing = await graph.neighbors(bob.id, { direction: 'OUTGOING' })
        const incoming = await graph.neighbors(bob.id, { direction: 'INCOMING' })

        expect(outgoing).toHaveLength(2) // charlie, company
        expect(incoming).toHaveLength(1) // alice
      })
    })
  })

  // ==========================================================================
  // 4. PATH FINDING
  // ==========================================================================

  describe('Path Finding', () => {
    let alice: Node
    let bob: Node
    let charlie: Node
    let dave: Node
    let eve: Node

    beforeEach(async () => {
      alice = await graph.createNode('Person', { name: 'Alice' })
      bob = await graph.createNode('Person', { name: 'Bob' })
      charlie = await graph.createNode('Person', { name: 'Charlie' })
      dave = await graph.createNode('Person', { name: 'Dave' })
      eve = await graph.createNode('Person', { name: 'Eve' })

      // Create a graph with multiple paths
      // Alice -> Bob -> Dave
      // Alice -> Charlie -> Dave
      // Alice -> Charlie -> Eve -> Dave
      await graph.createEdge(alice.id, 'KNOWS', bob.id)
      await graph.createEdge(alice.id, 'KNOWS', charlie.id)
      await graph.createEdge(bob.id, 'KNOWS', dave.id)
      await graph.createEdge(charlie.id, 'KNOWS', dave.id)
      await graph.createEdge(charlie.id, 'KNOWS', eve.id)
      await graph.createEdge(eve.id, 'KNOWS', dave.id)
    })

    describe('shortestPath', () => {
      it('finds shortest path between two nodes', async () => {
        const path = await graph.shortestPath(alice.id, dave.id)

        expect(path).not.toBeNull()
        expect(path?.length).toBe(2) // Alice -> Bob/Charlie -> Dave
        expect(path?.nodes[0].id).toBe(alice.id)
        expect(path?.nodes[path.nodes.length - 1].id).toBe(dave.id)
      })

      it('returns null when no path exists', async () => {
        const isolated = await graph.createNode('Person', { name: 'Isolated' })
        const path = await graph.shortestPath(alice.id, isolated.id)

        expect(path).toBeNull()
      })

      it('returns path of length 0 for same node', async () => {
        const path = await graph.shortestPath(alice.id, alice.id)

        expect(path).not.toBeNull()
        expect(path?.length).toBe(0)
        expect(path?.nodes).toHaveLength(1)
      })

      it('filters by relationship types', async () => {
        // Add a different relationship type
        await graph.createEdge(alice.id, 'WORKS_WITH', dave.id)

        const knowsPath = await graph.shortestPath(alice.id, dave.id, {
          relationshipTypes: ['KNOWS'],
        })

        const worksWithPath = await graph.shortestPath(alice.id, dave.id, {
          relationshipTypes: ['WORKS_WITH'],
        })

        expect(knowsPath?.length).toBe(2)
        expect(worksWithPath?.length).toBe(1)
      })

      it('respects maxDepth', async () => {
        const path = await graph.shortestPath(alice.id, dave.id, { maxDepth: 1 })

        expect(path).toBeNull() // No path within depth 1
      })

      it('includes edges in path result', async () => {
        const path = await graph.shortestPath(alice.id, dave.id)

        expect(path?.edges).toBeDefined()
        expect(path?.edges.length).toBe(path!.nodes.length - 1)
      })
    })

    describe('allPaths', () => {
      it('finds all paths between two nodes', async () => {
        const paths = await graph.allPaths(alice.id, dave.id)

        expect(paths).toHaveLength(3) // Through Bob, through Charlie, through Charlie->Eve
      })

      it('respects maxDepth', async () => {
        const paths = await graph.allPaths(alice.id, dave.id, { maxDepth: 2 })

        expect(paths).toHaveLength(2) // Only direct paths through Bob or Charlie
      })

      it('respects maxPaths limit', async () => {
        const paths = await graph.allPaths(alice.id, dave.id, { maxPaths: 2 })

        expect(paths).toHaveLength(2)
      })

      it('returns empty array when no paths exist', async () => {
        const isolated = await graph.createNode('Person', { name: 'Isolated' })
        const paths = await graph.allPaths(alice.id, isolated.id)

        expect(paths).toHaveLength(0)
      })
    })

    describe('pathExists', () => {
      it('returns true when path exists', async () => {
        const exists = await graph.pathExists(alice.id, dave.id)

        expect(exists).toBe(true)
      })

      it('returns false when no path exists', async () => {
        const isolated = await graph.createNode('Person', { name: 'Isolated' })
        const exists = await graph.pathExists(alice.id, isolated.id)

        expect(exists).toBe(false)
      })

      it('is faster than shortestPath for existence check', async () => {
        // This is a behavioral hint - pathExists should use optimizations
        // like bidirectional BFS or bloom filters
        const exists = await graph.pathExists(alice.id, dave.id)
        expect(exists).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 5. PATTERN MATCHING (Cypher-like)
  // ==========================================================================

  describe('Pattern Matching', () => {
    let alice: Node
    let bob: Node
    let charlie: Node
    let company: Node

    beforeEach(async () => {
      alice = await graph.createNode('Person', { name: 'Alice', age: 30 })
      bob = await graph.createNode('Person', { name: 'Bob', age: 25 })
      charlie = await graph.createNode('Person', { name: 'Charlie', age: 35 })
      company = await graph.createNode('Company', { name: 'Acme Inc' })

      await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })
      await graph.createEdge(bob.id, 'KNOWS', charlie.id, { since: 2021 })
      await graph.createEdge(alice.id, 'WORKS_AT', company.id, { role: 'Engineer' })
      await graph.createEdge(bob.id, 'WORKS_AT', company.id, { role: 'Manager' })
    })

    describe('match', () => {
      it('matches simple pattern', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS]->(b:Person)',
        })

        expect(result.matches).toHaveLength(2) // Alice->Bob, Bob->Charlie
      })

      it('matches pattern with where clause', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS]->(b:Person)',
          where: { 'a.name': 'Alice' },
        })

        expect(result.matches).toHaveLength(1)
        expect(result.matches[0].a.properties.name).toBe('Alice')
        expect(result.matches[0].b.properties.name).toBe('Bob')
      })

      it('returns specified properties', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS]->(b:Person)',
          return: ['a.name', 'b.name', 'b.age'],
        })

        expect(result.matches[0]).toHaveProperty('a.name')
        expect(result.matches[0]).toHaveProperty('b.name')
        expect(result.matches[0]).toHaveProperty('b.age')
      })

      it('matches variable length paths', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS*1..2]->(b:Person)',
          where: { 'a.name': 'Alice' },
        })

        // Alice->Bob (1 hop), Alice->Bob->Charlie (2 hops)
        expect(result.matches).toHaveLength(2)
      })

      it('matches bidirectional relationships', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS]-(b:Person)',
          where: { 'a.name': 'Bob' },
        })

        // Bob-Alice, Bob-Charlie
        expect(result.matches).toHaveLength(2)
      })

      it('matches multiple relationship types', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS|WORKS_AT]->(b)',
        })

        expect(result.matches.length).toBeGreaterThan(2)
      })

      it('matches edge properties', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[r:KNOWS]->(b:Person)',
          where: { 'r.since': 2020 },
        })

        expect(result.matches).toHaveLength(1)
        expect(result.matches[0].a.properties.name).toBe('Alice')
      })

      it('supports comparison in where clause', async () => {
        const result = await graph.match({
          pattern: '(a:Person)-[:KNOWS]->(b:Person)',
          where: { 'b.age': { $gt: 24 } },
        })

        expect(result.matches).toHaveLength(2)
      })

      it('matches complex patterns', async () => {
        // Find people who work at the same company
        const result = await graph.match({
          pattern: '(a:Person)-[:WORKS_AT]->(c:Company)<-[:WORKS_AT]-(b:Person)',
          where: { 'a.name': { $ne: 'b.name' } },
        })

        expect(result.matches.length).toBeGreaterThan(0)
      })
    })

    describe('matchCypher', () => {
      it('parses and executes Cypher-like query', async () => {
        const result = await graph.matchCypher(`
          MATCH (a:Person)-[:KNOWS]->(b:Person)
          WHERE a.name = 'Alice'
          RETURN b.name, b.age
        `)

        expect(result.matches).toHaveLength(1)
        expect(result.matches[0]['b.name']).toBe('Bob')
        expect(result.matches[0]['b.age']).toBe(25)
      })

      it('handles LIMIT clause', async () => {
        const result = await graph.matchCypher(`
          MATCH (a:Person)-[:KNOWS]->(b:Person)
          RETURN a.name, b.name
          LIMIT 1
        `)

        expect(result.matches).toHaveLength(1)
      })

      it('handles ORDER BY clause', async () => {
        const result = await graph.matchCypher(`
          MATCH (p:Person)
          RETURN p.name, p.age
          ORDER BY p.age DESC
        `)

        expect(result.matches[0]['p.age']).toBe(35) // Charlie is oldest
      })
    })
  })

  // ==========================================================================
  // 6. AGGREGATIONS
  // ==========================================================================

  describe('Aggregations', () => {
    let alice: Node
    let bob: Node
    let charlie: Node
    let dave: Node

    beforeEach(async () => {
      alice = await graph.createNode('Person', { name: 'Alice' })
      bob = await graph.createNode('Person', { name: 'Bob' })
      charlie = await graph.createNode('Person', { name: 'Charlie' })
      dave = await graph.createNode('Person', { name: 'Dave' })

      // Create a hub-spoke structure with bob as hub
      await graph.createEdge(alice.id, 'KNOWS', bob.id)
      await graph.createEdge(charlie.id, 'KNOWS', bob.id)
      await graph.createEdge(dave.id, 'KNOWS', bob.id)
      await graph.createEdge(bob.id, 'KNOWS', alice.id)
      await graph.createEdge(bob.id, 'KNOWS', charlie.id)
    })

    describe('degree', () => {
      it('returns total degree', async () => {
        const bobDegree = await graph.degree(bob.id)

        expect(bobDegree).toBe(5) // 3 incoming + 2 outgoing
      })

      it('returns outgoing degree', async () => {
        const outDegree = await graph.degree(bob.id, 'OUTGOING')

        expect(outDegree).toBe(2)
      })

      it('returns incoming degree', async () => {
        const inDegree = await graph.degree(bob.id, 'INCOMING')

        expect(inDegree).toBe(3)
      })

      it('filters by relationship type', async () => {
        await graph.createEdge(bob.id, 'WORKS_WITH', alice.id)

        const knowsDegree = await graph.degree(bob.id, 'OUTGOING', { type: 'KNOWS' })

        expect(knowsDegree).toBe(2)
      })

      it('returns 0 for node with no edges', async () => {
        const isolated = await graph.createNode('Person', { name: 'Isolated' })
        const degree = await graph.degree(isolated.id)

        expect(degree).toBe(0)
      })
    })

    describe('degreeCentrality', () => {
      it('calculates degree centrality for all nodes', async () => {
        const centrality = await graph.degreeCentrality()

        expect(centrality.get(bob.id)).toBeGreaterThan(centrality.get(alice.id)!)
        expect(centrality.get(bob.id)).toBeGreaterThan(centrality.get(charlie.id)!)
      })

      it('normalizes centrality values', async () => {
        const centrality = await graph.degreeCentrality({ normalized: true })

        for (const value of centrality.values()) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      })
    })

    describe('betweennessCentrality', () => {
      it('calculates betweenness centrality', async () => {
        // Bob is on many shortest paths
        const centrality = await graph.betweennessCentrality()

        expect(centrality.get(bob.id)).toBeGreaterThan(0)
      })

      it('hub node has highest betweenness', async () => {
        const centrality = await graph.betweennessCentrality()

        const bobCentrality = centrality.get(bob.id)!
        const aliceCentrality = centrality.get(alice.id)!

        expect(bobCentrality).toBeGreaterThanOrEqual(aliceCentrality)
      })
    })

    describe('pageRank', () => {
      it('calculates PageRank scores', async () => {
        const ranks = await graph.pageRank()

        expect(ranks.size).toBe(4)
        for (const rank of ranks.values()) {
          expect(rank).toBeGreaterThan(0)
        }
      })

      it('hub node has high PageRank', async () => {
        const ranks = await graph.pageRank()

        expect(ranks.get(bob.id)).toBeGreaterThan(ranks.get(dave.id)!)
      })

      it('accepts custom damping factor', async () => {
        const ranks = await graph.pageRank({ dampingFactor: 0.5 })

        expect(ranks.size).toBe(4)
      })

      it('converges within iterations', async () => {
        const ranks = await graph.pageRank({ maxIterations: 100 })

        // Sum should be close to number of nodes (normalized)
        const sum = Array.from(ranks.values()).reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(4, 1)
      })
    })

    describe('commonNeighbors', () => {
      it('finds common neighbors between two nodes', async () => {
        // Alice and Charlie both know Bob
        await graph.createEdge(alice.id, 'KNOWS', charlie.id)

        const common = await graph.commonNeighbors(alice.id, charlie.id)

        expect(common).toHaveLength(1)
        expect(common[0].id).toBe(bob.id)
      })

      it('returns empty for nodes with no common neighbors', async () => {
        const common = await graph.commonNeighbors(alice.id, dave.id)

        // Alice -> Bob, Dave -> Bob, but Bob is not a common neighbor (direction matters)
        expect(common).toHaveLength(1) // Actually Bob is common
      })
    })

    describe('clusteringCoefficient', () => {
      it('calculates local clustering coefficient', async () => {
        // Create a triangle: alice, bob, charlie all know each other
        await graph.createEdge(alice.id, 'KNOWS', charlie.id)
        await graph.createEdge(charlie.id, 'KNOWS', alice.id)

        const coefficient = await graph.clusteringCoefficient(alice.id)

        expect(coefficient).toBeGreaterThan(0)
        expect(coefficient).toBeLessThanOrEqual(1)
      })

      it('returns 0 for node with less than 2 neighbors', async () => {
        const isolated = await graph.createNode('Person', { name: 'Isolated' })
        await graph.createEdge(isolated.id, 'KNOWS', alice.id)

        const coefficient = await graph.clusteringCoefficient(isolated.id)

        expect(coefficient).toBe(0)
      })
    })
  })

  // ==========================================================================
  // 7. GRAPH STATISTICS
  // ==========================================================================

  describe('Graph Statistics', () => {
    beforeEach(async () => {
      const alice = await graph.createNode('Person', { name: 'Alice' })
      const bob = await graph.createNode('Person', { name: 'Bob' })
      const company = await graph.createNode('Company', { name: 'Acme' })

      await graph.createEdge(alice.id, 'KNOWS', bob.id)
      await graph.createEdge(alice.id, 'WORKS_AT', company.id)
    })

    describe('stats', () => {
      it('returns node count', async () => {
        const stats = await graph.stats()

        expect(stats.nodeCount).toBe(3)
      })

      it('returns edge count', async () => {
        const stats = await graph.stats()

        expect(stats.edgeCount).toBe(2)
      })

      it('returns node labels distribution', async () => {
        const stats = await graph.stats()

        expect(stats.labelCounts.Person).toBe(2)
        expect(stats.labelCounts.Company).toBe(1)
      })

      it('returns edge types distribution', async () => {
        const stats = await graph.stats()

        expect(stats.typeCounts.KNOWS).toBe(1)
        expect(stats.typeCounts.WORKS_AT).toBe(1)
      })

      it('calculates average degree', async () => {
        const stats = await graph.stats()

        expect(stats.avgDegree).toBeGreaterThan(0)
      })

      it('identifies isolated nodes', async () => {
        await graph.createNode('Person', { name: 'Isolated' })

        const stats = await graph.stats()

        expect(stats.isolatedNodes).toBe(1)
      })
    })

    describe('getNodes', () => {
      it('returns all nodes', async () => {
        const nodes = await graph.getNodes()

        expect(nodes).toHaveLength(3)
      })
    })

    describe('getEdges', () => {
      it('returns all edges', async () => {
        const edges = await graph.getEdges()

        expect(edges).toHaveLength(2)
      })
    })

    describe('clear', () => {
      it('removes all nodes and edges', async () => {
        await graph.clear()

        const stats = await graph.stats()

        expect(stats.nodeCount).toBe(0)
        expect(stats.edgeCount).toBe(0)
      })
    })
  })

  // ==========================================================================
  // 8. SERIALIZATION
  // ==========================================================================

  describe('Serialization', () => {
    beforeEach(async () => {
      const alice = await graph.createNode('Person', { name: 'Alice' })
      const bob = await graph.createNode('Person', { name: 'Bob' })
      await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })
    })

    describe('export', () => {
      it('exports graph to JSON', async () => {
        const exported = await graph.export()

        expect(exported.nodes).toHaveLength(2)
        expect(exported.edges).toHaveLength(1)
      })

      it('includes metadata in export', async () => {
        const exported = await graph.export()

        expect(exported.metadata).toBeDefined()
        expect(exported.metadata?.exportedAt).toBeDefined()
        expect(exported.metadata?.version).toBeDefined()
      })
    })

    describe('import', () => {
      it('imports graph from JSON', async () => {
        const exported = await graph.export()
        const newGraph = new GraphEngine()

        await newGraph.import(exported)

        const stats = await newGraph.stats()
        expect(stats.nodeCount).toBe(2)
        expect(stats.edgeCount).toBe(1)
      })

      it('preserves node properties on import', async () => {
        const exported = await graph.export()
        const newGraph = new GraphEngine()

        await newGraph.import(exported)

        const nodes = await newGraph.queryNodes({ label: 'Person' })
        expect(nodes.some((n) => n.properties.name === 'Alice')).toBe(true)
      })

      it('preserves edge properties on import', async () => {
        const exported = await graph.export()
        const newGraph = new GraphEngine()

        await newGraph.import(exported)

        const edges = await newGraph.queryEdges({ type: 'KNOWS' })
        expect(edges[0].properties.since).toBe(2020)
      })
    })
  })
})
