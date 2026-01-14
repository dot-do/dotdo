/**
 * Graph Algorithms Tests
 *
 * Tests for graph traversal algorithms:
 * - shortestPath / allShortestPaths
 * - PageRank
 * - Connected Components
 * - Degree Centrality
 * - Betweenness Centrality
 * - BFS / DFS traversal
 *
 * @see https://neo4j.com/docs/graph-data-science/current/algorithms/
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Driver, Session, Node } from '../types'
import { auth, int } from '../types'
import { driver as createDriver, clearStorage } from '../neo4j'
import {
  GraphAlgorithms,
  type GraphNode,
  type GraphEdge,
  type PageRankResult,
  type CentralityResult,
  type ComponentResult,
  type PathResult,
} from '../algorithms'

// ============================================================================
// TEST DATA SETUP
// ============================================================================

/**
 * Creates a simple test graph:
 *
 *     Alice --KNOWS--> Bob --KNOWS--> Charlie --KNOWS--> Diana
 *       |               |
 *       +---KNOWS-------+----KNOWS-----> Eve
 *
 */
async function createSocialGraph(session: Session): Promise<void> {
  await session.run('CREATE (n:Person {name: $name})', { name: 'Alice' })
  await session.run('CREATE (n:Person {name: $name})', { name: 'Bob' })
  await session.run('CREATE (n:Person {name: $name})', { name: 'Charlie' })
  await session.run('CREATE (n:Person {name: $name})', { name: 'Diana' })
  await session.run('CREATE (n:Person {name: $name})', { name: 'Eve' })

  // Create relationships
  await session.run(
    'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)',
    { a: 'Alice', b: 'Bob' }
  )
  await session.run(
    'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)',
    { a: 'Bob', b: 'Charlie' }
  )
  await session.run(
    'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)',
    { a: 'Charlie', b: 'Diana' }
  )
  await session.run(
    'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)',
    { a: 'Alice', b: 'Eve' }
  )
  await session.run(
    'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)',
    { a: 'Bob', b: 'Eve' }
  )
}

/**
 * Creates a disconnected graph with two components:
 *
 * Component 1: A ---> B ---> C
 * Component 2: X ---> Y
 */
async function createDisconnectedGraph(session: Session): Promise<void> {
  // Component 1
  await session.run('CREATE (n:Node {name: $name})', { name: 'A' })
  await session.run('CREATE (n:Node {name: $name})', { name: 'B' })
  await session.run('CREATE (n:Node {name: $name})', { name: 'C' })
  await session.run(
    'MATCH (a:Node {name: $a}), (b:Node {name: $b}) CREATE (a)-[:LINKED]->(b)',
    { a: 'A', b: 'B' }
  )
  await session.run(
    'MATCH (a:Node {name: $a}), (b:Node {name: $b}) CREATE (a)-[:LINKED]->(b)',
    { a: 'B', b: 'C' }
  )

  // Component 2 (disconnected)
  await session.run('CREATE (n:Node {name: $name})', { name: 'X' })
  await session.run('CREATE (n:Node {name: $name})', { name: 'Y' })
  await session.run(
    'MATCH (a:Node {name: $a}), (b:Node {name: $b}) CREATE (a)-[:LINKED]->(b)',
    { a: 'X', b: 'Y' }
  )
}

/**
 * Creates a graph for PageRank testing (web-like structure):
 *
 *     Page1 --LINKS_TO--> Page2
 *       |                   |
 *       v                   v
 *     Page3 <--------------+
 *       |
 *       v
 *     Page4
 */
async function createWebGraph(session: Session): Promise<void> {
  await session.run('CREATE (n:Page {url: $url})', { url: 'page1.com' })
  await session.run('CREATE (n:Page {url: $url})', { url: 'page2.com' })
  await session.run('CREATE (n:Page {url: $url})', { url: 'page3.com' })
  await session.run('CREATE (n:Page {url: $url})', { url: 'page4.com' })

  await session.run(
    'MATCH (a:Page {url: $a}), (b:Page {url: $b}) CREATE (a)-[:LINKS_TO]->(b)',
    { a: 'page1.com', b: 'page2.com' }
  )
  await session.run(
    'MATCH (a:Page {url: $a}), (b:Page {url: $b}) CREATE (a)-[:LINKS_TO]->(b)',
    { a: 'page1.com', b: 'page3.com' }
  )
  await session.run(
    'MATCH (a:Page {url: $a}), (b:Page {url: $b}) CREATE (a)-[:LINKS_TO]->(b)',
    { a: 'page2.com', b: 'page3.com' }
  )
  await session.run(
    'MATCH (a:Page {url: $a}), (b:Page {url: $b}) CREATE (a)-[:LINKS_TO]->(b)',
    { a: 'page3.com', b: 'page4.com' }
  )
}

// ============================================================================
// SHORTEST PATH TESTS
// ============================================================================

describe('Shortest Path Algorithms', () => {
  let d: Driver
  let session: Session
  let algo: GraphAlgorithms

  beforeEach(async () => {
    clearStorage()
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    await createSocialGraph(session)
    algo = new GraphAlgorithms(session)
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should find shortest path between two nodes', async () => {
    const path = await algo.shortestPath('Alice', 'Diana', {
      nodeLabel: 'Person',
      nodeProperty: 'name',
      relationshipType: 'KNOWS',
    })

    expect(path).not.toBeNull()
    expect(path!.length).toBe(3) // Alice -> Bob -> Charlie -> Diana
    expect(path!.nodes[0].properties.name).toBe('Alice')
    expect(path!.nodes[path!.nodes.length - 1].properties.name).toBe('Diana')
  })

  it('should return null when no path exists', async () => {
    // Create an isolated node
    await session.run('CREATE (n:Person {name: $name})', { name: 'Isolated' })

    const path = await algo.shortestPath('Alice', 'Isolated', {
      nodeLabel: 'Person',
      nodeProperty: 'name',
      relationshipType: 'KNOWS',
    })

    expect(path).toBeNull()
  })

  it('should find path to direct neighbor', async () => {
    const path = await algo.shortestPath('Alice', 'Bob', {
      nodeLabel: 'Person',
      nodeProperty: 'name',
      relationshipType: 'KNOWS',
    })

    expect(path).not.toBeNull()
    expect(path!.length).toBe(1)
  })

  it('should find all shortest paths', async () => {
    const paths = await algo.allShortestPaths('Alice', 'Eve', {
      nodeLabel: 'Person',
      nodeProperty: 'name',
      relationshipType: 'KNOWS',
    })

    // Alice -> Eve (direct) and Alice -> Bob -> Eve (length 2)
    // Shortest is length 1 (direct), so should return just that one
    expect(paths.length).toBeGreaterThanOrEqual(1)
    const shortestLength = Math.min(...paths.map((p) => p.length))
    expect(shortestLength).toBe(1)
  })

  it('should respect max depth limit', async () => {
    const path = await algo.shortestPath('Alice', 'Diana', {
      nodeLabel: 'Person',
      nodeProperty: 'name',
      relationshipType: 'KNOWS',
      maxDepth: 2,
    })

    // Alice -> Diana requires 3 hops, but max is 2
    expect(path).toBeNull()
  })

  it('should handle bidirectional search', async () => {
    const path = await algo.shortestPath('Bob', 'Alice', {
      nodeLabel: 'Person',
      nodeProperty: 'name',
      relationshipType: 'KNOWS',
      direction: 'BOTH',
    })

    expect(path).not.toBeNull()
    expect(path!.length).toBe(1)
  })
})

// ============================================================================
// PAGERANK TESTS
// ============================================================================

describe('PageRank Algorithm', () => {
  let d: Driver
  let session: Session
  let algo: GraphAlgorithms

  beforeEach(async () => {
    clearStorage()
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    await createWebGraph(session)
    algo = new GraphAlgorithms(session)
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should compute PageRank for all nodes', async () => {
    const results = await algo.pageRank({
      nodeLabel: 'Page',
      relationshipType: 'LINKS_TO',
      dampingFactor: 0.85,
      maxIterations: 20,
      tolerance: 0.0001,
    })

    expect(results.length).toBe(4)

    // All scores should be between 0 and 1
    for (const result of results) {
      expect(result.score).toBeGreaterThan(0)
      expect(result.score).toBeLessThanOrEqual(1)
    }
  })

  it('should rank page3 higher (receives most links)', async () => {
    const results = await algo.pageRank({
      nodeLabel: 'Page',
      relationshipType: 'LINKS_TO',
      dampingFactor: 0.85,
      maxIterations: 20,
    })

    // page3 receives links from page1 and page2, should have high rank
    const page3 = results.find((r) => r.nodeId.includes('page3'))
    const page1 = results.find((r) => r.nodeId.includes('page1'))

    expect(page3).toBeDefined()
    expect(page1).toBeDefined()
    expect(page3!.score).toBeGreaterThan(page1!.score)
  })

  it('should handle damping factor parameter', async () => {
    const results1 = await algo.pageRank({
      nodeLabel: 'Page',
      relationshipType: 'LINKS_TO',
      dampingFactor: 0.5,
    })

    const results2 = await algo.pageRank({
      nodeLabel: 'Page',
      relationshipType: 'LINKS_TO',
      dampingFactor: 0.99,
    })

    // Different damping factors should produce different scores
    const page3Score1 = results1.find((r) => r.nodeId.includes('page3'))!.score
    const page3Score2 = results2.find((r) => r.nodeId.includes('page3'))!.score

    expect(page3Score1).not.toBe(page3Score2)
  })

  it('should converge with tolerance', async () => {
    const results = await algo.pageRank({
      nodeLabel: 'Page',
      relationshipType: 'LINKS_TO',
      tolerance: 0.001,
      maxIterations: 100,
    })

    // Should return valid results
    expect(results.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// CONNECTED COMPONENTS TESTS
// ============================================================================

describe('Connected Components Algorithm', () => {
  let d: Driver
  let session: Session
  let algo: GraphAlgorithms

  beforeEach(async () => {
    clearStorage()
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    await createDisconnectedGraph(session)
    algo = new GraphAlgorithms(session)
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should find connected components', async () => {
    const components = await algo.connectedComponents({
      nodeLabel: 'Node',
      relationshipType: 'LINKED',
    })

    expect(components.componentCount).toBe(2)
    expect(components.nodes.length).toBe(5)
  })

  it('should assign same component ID to connected nodes', async () => {
    const components = await algo.connectedComponents({
      nodeLabel: 'Node',
      relationshipType: 'LINKED',
    })

    const nodeA = components.nodes.find((n) => n.nodeId.includes('A'))
    const nodeB = components.nodes.find((n) => n.nodeId.includes('B'))
    const nodeC = components.nodes.find((n) => n.nodeId.includes('C'))

    expect(nodeA!.componentId).toBe(nodeB!.componentId)
    expect(nodeB!.componentId).toBe(nodeC!.componentId)
  })

  it('should assign different component IDs to disconnected nodes', async () => {
    const components = await algo.connectedComponents({
      nodeLabel: 'Node',
      relationshipType: 'LINKED',
    })

    const nodeA = components.nodes.find((n) => n.nodeId.includes('A'))
    const nodeX = components.nodes.find((n) => n.nodeId.includes('X'))

    expect(nodeA!.componentId).not.toBe(nodeX!.componentId)
  })

  it('should handle weakly connected components (ignoring direction)', async () => {
    const components = await algo.weaklyConnectedComponents({
      nodeLabel: 'Node',
      relationshipType: 'LINKED',
    })

    expect(components.componentCount).toBe(2)
  })

  it('should return component sizes', async () => {
    const components = await algo.connectedComponents({
      nodeLabel: 'Node',
      relationshipType: 'LINKED',
    })

    // Component 1 has 3 nodes (A, B, C), Component 2 has 2 nodes (X, Y)
    const sizes = components.componentSizes
    expect(sizes).toContain(3)
    expect(sizes).toContain(2)
  })
})

// ============================================================================
// CENTRALITY TESTS
// ============================================================================

describe('Centrality Algorithms', () => {
  let d: Driver
  let session: Session
  let algo: GraphAlgorithms

  beforeEach(async () => {
    clearStorage()
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    await createSocialGraph(session)
    algo = new GraphAlgorithms(session)
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  describe('Degree Centrality', () => {
    it('should compute in-degree centrality', async () => {
      const results = await algo.degreeCentrality({
        nodeLabel: 'Person',
        relationshipType: 'KNOWS',
        direction: 'IN',
      })

      expect(results.length).toBe(5)

      // Eve has 2 incoming edges (from Alice and Bob)
      const eve = results.find((r) => r.nodeId.includes('Eve'))
      expect(eve!.score).toBe(2)
    })

    it('should compute out-degree centrality', async () => {
      const results = await algo.degreeCentrality({
        nodeLabel: 'Person',
        relationshipType: 'KNOWS',
        direction: 'OUT',
      })

      // Alice has 2 outgoing edges (to Bob and Eve)
      const alice = results.find((r) => r.nodeId.includes('Alice'))
      expect(alice!.score).toBe(2)
    })

    it('should compute total degree centrality', async () => {
      const results = await algo.degreeCentrality({
        nodeLabel: 'Person',
        relationshipType: 'KNOWS',
        direction: 'BOTH',
      })

      // Bob has 1 in + 2 out = 3 total
      const bob = results.find((r) => r.nodeId.includes('Bob'))
      expect(bob!.score).toBe(3)
    })
  })

  describe('Betweenness Centrality', () => {
    it('should compute betweenness centrality', async () => {
      const results = await algo.betweennessCentrality({
        nodeLabel: 'Person',
        relationshipType: 'KNOWS',
      })

      expect(results.length).toBe(5)

      // Bob and Charlie should have higher betweenness (they're on paths)
      const bob = results.find((r) => r.nodeId.includes('Bob'))
      const diana = results.find((r) => r.nodeId.includes('Diana'))

      // Bob should have higher betweenness than Diana (Diana is an endpoint)
      expect(bob!.score).toBeGreaterThanOrEqual(diana!.score)
    })

    it('should handle normalized betweenness', async () => {
      const results = await algo.betweennessCentrality({
        nodeLabel: 'Person',
        relationshipType: 'KNOWS',
        normalized: true,
      })

      // Normalized scores should be between 0 and 1
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('Closeness Centrality', () => {
    it('should compute closeness centrality', async () => {
      const results = await algo.closenessCentrality({
        nodeLabel: 'Person',
        relationshipType: 'KNOWS',
      })

      expect(results.length).toBe(5)

      // All scores should be positive
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
      }
    })
  })
})

// ============================================================================
// TRAVERSAL TESTS
// ============================================================================

describe('Graph Traversal', () => {
  let d: Driver
  let session: Session
  let algo: GraphAlgorithms

  beforeEach(async () => {
    clearStorage()
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    await createSocialGraph(session)
    algo = new GraphAlgorithms(session)
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  describe('BFS (Breadth-First Search)', () => {
    it('should traverse in BFS order', async () => {
      const visited: string[] = []

      await algo.bfs('Alice', {
        nodeLabel: 'Person',
        nodeProperty: 'name',
        relationshipType: 'KNOWS',
        onVisit: (node) => {
          visited.push(node.properties.name as string)
        },
      })

      // BFS from Alice: Alice first, then Bob & Eve (level 1), then Charlie (level 2), Diana (level 3)
      expect(visited[0]).toBe('Alice')
      // Level 1 nodes should come before level 2 nodes
      expect(visited.indexOf('Bob')).toBeLessThan(visited.indexOf('Charlie'))
      expect(visited.indexOf('Eve')).toBeLessThan(visited.indexOf('Diana'))
    })

    it('should respect max depth in BFS', async () => {
      const visited: string[] = []

      await algo.bfs('Alice', {
        nodeLabel: 'Person',
        nodeProperty: 'name',
        relationshipType: 'KNOWS',
        maxDepth: 1,
        onVisit: (node) => {
          visited.push(node.properties.name as string)
        },
      })

      // Should only visit Alice, Bob, and Eve (depth 0 and 1)
      expect(visited).toContain('Alice')
      expect(visited).toContain('Bob')
      expect(visited).toContain('Eve')
      expect(visited).not.toContain('Charlie')
      expect(visited).not.toContain('Diana')
    })
  })

  describe('DFS (Depth-First Search)', () => {
    it('should traverse in DFS order', async () => {
      const visited: string[] = []

      await algo.dfs('Alice', {
        nodeLabel: 'Person',
        nodeProperty: 'name',
        relationshipType: 'KNOWS',
        onVisit: (node) => {
          visited.push(node.properties.name as string)
        },
      })

      // DFS should go deep first
      expect(visited[0]).toBe('Alice')
      // Charlie should appear after Bob (following Alice -> Bob -> Charlie path)
      const bobIndex = visited.indexOf('Bob')
      if (bobIndex >= 0) {
        const charlieIndex = visited.indexOf('Charlie')
        if (charlieIndex >= 0 && bobIndex < visited.length - 1) {
          // If we went through Bob, Charlie might follow
          expect(charlieIndex).toBeGreaterThan(bobIndex)
        }
      }
    })

    it('should not revisit nodes', async () => {
      const visited: string[] = []

      await algo.dfs('Alice', {
        nodeLabel: 'Person',
        nodeProperty: 'name',
        relationshipType: 'KNOWS',
        onVisit: (node) => {
          visited.push(node.properties.name as string)
        },
      })

      // Each node should appear exactly once
      const uniqueVisited = new Set(visited)
      expect(visited.length).toBe(uniqueVisited.size)
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let d: Driver
  let session: Session
  let algo: GraphAlgorithms

  beforeEach(async () => {
    clearStorage()
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    algo = new GraphAlgorithms(session)
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should handle empty graph', async () => {
    const results = await algo.pageRank({
      nodeLabel: 'NonExistent',
      relationshipType: 'UNKNOWN',
    })

    expect(results).toEqual([])
  })

  it('should handle single node graph', async () => {
    await session.run('CREATE (n:Solo {name: $name})', { name: 'Alone' })

    const components = await algo.connectedComponents({
      nodeLabel: 'Solo',
      relationshipType: 'KNOWS',
    })

    expect(components.componentCount).toBe(1)
    expect(components.nodes.length).toBe(1)
  })

  it('should handle self-loops', async () => {
    await session.run('CREATE (n:Node {name: $name})', { name: 'Self' })
    await session.run(
      'MATCH (n:Node {name: $name}) CREATE (n)-[:LOOPS]->(n)',
      { name: 'Self' }
    )

    const results = await algo.degreeCentrality({
      nodeLabel: 'Node',
      relationshipType: 'LOOPS',
      direction: 'BOTH',
    })

    expect(results.length).toBe(1)
    // Self-loop counts as both in and out
    expect(results[0].score).toBeGreaterThanOrEqual(1)
  })

  it('should handle cycles', async () => {
    // Create a cycle: A -> B -> C -> A
    await session.run('CREATE (n:Cycle {name: $name})', { name: 'A' })
    await session.run('CREATE (n:Cycle {name: $name})', { name: 'B' })
    await session.run('CREATE (n:Cycle {name: $name})', { name: 'C' })
    await session.run(
      'MATCH (a:Cycle {name: $a}), (b:Cycle {name: $b}) CREATE (a)-[:NEXT]->(b)',
      { a: 'A', b: 'B' }
    )
    await session.run(
      'MATCH (a:Cycle {name: $a}), (b:Cycle {name: $b}) CREATE (a)-[:NEXT]->(b)',
      { a: 'B', b: 'C' }
    )
    await session.run(
      'MATCH (a:Cycle {name: $a}), (b:Cycle {name: $b}) CREATE (a)-[:NEXT]->(b)',
      { a: 'C', b: 'A' }
    )

    // PageRank should converge even with cycles
    const results = await algo.pageRank({
      nodeLabel: 'Cycle',
      relationshipType: 'NEXT',
    })

    expect(results.length).toBe(3)
    // In a simple cycle, all nodes should have similar PageRank
    const scores = results.map((r) => r.score)
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
    for (const score of scores) {
      expect(Math.abs(score - avgScore)).toBeLessThan(0.1)
    }
  })
})
