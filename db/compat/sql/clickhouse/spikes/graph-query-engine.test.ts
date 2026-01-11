/**
 * Tests for Graph Query Engine Spike
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  AdjacencyIndex,
  GraphTraversalEngine,
  CypherParser,
  MongoGraphLookup,
  generateSocialGraph,
  graphCostAnalysis,
  type Relationship,
} from './graph-query-engine'

describe('Graph Query Engine', () => {
  // ============================================================================
  // Adjacency Index Tests
  // ============================================================================
  describe('AdjacencyIndex', () => {
    let index: AdjacencyIndex

    beforeEach(() => {
      index = new AdjacencyIndex(1000, 10000)
    })

    it('should add and retrieve edges', () => {
      index.addEdge({
        id: 'rel-1',
        type: 'FOLLOWS',
        from: 'alice',
        to: 'bob',
        createdAt: Date.now(),
      })

      const outgoing = index.getOutgoing('alice')
      expect(outgoing).toHaveLength(1)
      expect(outgoing[0].to).toBe('bob')
      expect(outgoing[0].type).toBe('FOLLOWS')
    })

    it('should track incoming edges', () => {
      index.addEdge({
        id: 'rel-1',
        type: 'FOLLOWS',
        from: 'alice',
        to: 'bob',
        createdAt: Date.now(),
      })

      const incoming = index.getIncoming('bob')
      expect(incoming).toHaveLength(1)
      expect(incoming[0].from).toBe('alice')
    })

    it('should filter by edge type', () => {
      index.addEdge({ id: 'r1', type: 'FOLLOWS', from: 'a', to: 'b', createdAt: Date.now() })
      index.addEdge({ id: 'r2', type: 'LIKES', from: 'a', to: 'c', createdAt: Date.now() })
      index.addEdge({ id: 'r3', type: 'FOLLOWS', from: 'a', to: 'd', createdAt: Date.now() })

      const follows = index.getOutgoing('a', ['FOLLOWS'])
      expect(follows).toHaveLength(2)
      expect(follows.map(e => e.to).sort()).toEqual(['b', 'd'])
    })

    it('should get neighbors in both directions', () => {
      index.addEdge({ id: 'r1', type: 'FOLLOWS', from: 'a', to: 'b', createdAt: Date.now() })
      index.addEdge({ id: 'r2', type: 'FOLLOWS', from: 'c', to: 'a', createdAt: Date.now() })

      const outNeighbors = index.getNeighbors('a', 'out')
      expect(outNeighbors).toEqual(['b'])

      const inNeighbors = index.getNeighbors('a', 'in')
      expect(inNeighbors).toEqual(['c'])

      const bothNeighbors = index.getNeighbors('a', 'both')
      expect(bothNeighbors.sort()).toEqual(['b', 'c'])
    })

    it('should track vertex and edge counts', () => {
      index.addEdge({ id: 'r1', type: 'FOLLOWS', from: 'a', to: 'b', createdAt: Date.now() })
      index.addEdge({ id: 'r2', type: 'FOLLOWS', from: 'b', to: 'c', createdAt: Date.now() })

      const stats = index.getStats()
      expect(stats.edges).toBe(2)
      expect(stats.vertices).toBeGreaterThanOrEqual(2)
    })

    it('should use bloom filter for existence checks', () => {
      index.addEdge({ id: 'r1', type: 'FOLLOWS', from: 'alice', to: 'bob', createdAt: Date.now() })

      expect(index.mightExist('alice')).toBe(true)
      expect(index.mightExist('bob')).toBe(true)
      expect(index.mightHaveEdge('alice', 'bob')).toBe(true)
    })

    it('should track degree correctly', () => {
      index.addEdge({ id: 'r1', type: 'FOLLOWS', from: 'a', to: 'b', createdAt: Date.now() })
      index.addEdge({ id: 'r2', type: 'FOLLOWS', from: 'a', to: 'c', createdAt: Date.now() })
      index.addEdge({ id: 'r3', type: 'FOLLOWS', from: 'd', to: 'a', createdAt: Date.now() })

      const deg = index.getDegree('a')
      expect(deg.out).toBe(2)
      expect(deg.in).toBe(1)
      expect(deg.total).toBe(3)
    })

    it('should identify high-degree vertices', () => {
      for (let i = 0; i < 100; i++) {
        index.addEdge({ id: 'r' + i, type: 'FOLLOWS', from: 'hub', to: 'user' + i, createdAt: Date.now() })
      }

      expect(index.isHighDegree('hub', 50)).toBe(true)
      expect(index.isHighDegree('hub', 150)).toBe(false)
    })
  })

  // ============================================================================
  // Graph Traversal Engine Tests
  // ============================================================================
  describe('GraphTraversalEngine', () => {
    let index: AdjacencyIndex
    let engine: GraphTraversalEngine

    beforeEach(() => {
      index = new AdjacencyIndex(1000, 10000)
      
      // Build a test graph:
      // alice -> bob -> carol -> dave
      //       -> eve -> frank
      const edges: Relationship[] = [
        { id: 'r1', type: 'FOLLOWS', from: 'alice', to: 'bob', createdAt: Date.now() },
        { id: 'r2', type: 'FOLLOWS', from: 'bob', to: 'carol', createdAt: Date.now() },
        { id: 'r3', type: 'FOLLOWS', from: 'carol', to: 'dave', createdAt: Date.now() },
        { id: 'r4', type: 'FOLLOWS', from: 'alice', to: 'eve', createdAt: Date.now() },
        { id: 'r5', type: 'FOLLOWS', from: 'eve', to: 'frank', createdAt: Date.now() },
        { id: 'r6', type: 'LIKES', from: 'bob', to: 'eve', createdAt: Date.now() },
      ]
      
      for (const edge of edges) {
        index.addEdge(edge)
      }

      engine = new GraphTraversalEngine(index)
    })

    describe('BFS Traversal', () => {
      it('should find 1-hop neighbors', () => {
        const result = engine.bfs(['alice'], {
          direction: 'out',
          minHops: 1,
          maxHops: 1,
        })

        expect(result.vertices.sort()).toEqual(['bob', 'eve'])
      })

      it('should find 2-hop neighbors', () => {
        const result = engine.bfs(['alice'], {
          direction: 'out',
          minHops: 2,
          maxHops: 2,
        })

        expect(result.vertices.sort()).toEqual(['carol', 'frank'])
      })

      it('should find neighbors within hop range', () => {
        const result = engine.bfs(['alice'], {
          direction: 'out',
          minHops: 1,
          maxHops: 3,
        })

        expect(result.vertices.sort()).toEqual(['bob', 'carol', 'dave', 'eve', 'frank'])
      })

      it('should filter by edge type', () => {
        const result = engine.bfs(['alice'], {
          direction: 'out',
          edgeTypes: ['FOLLOWS'],
          minHops: 1,
          maxHops: 2,
        })

        // bob->eve is LIKES, not FOLLOWS, so eve shouldn't appear via that path
        expect(result.vertices).toContain('bob')
        expect(result.vertices).toContain('eve')
        expect(result.vertices).toContain('carol')
      })

      it('should respect limit', () => {
        const result = engine.bfs(['alice'], {
          direction: 'out',
          minHops: 1,
          maxHops: 3,
          limit: 2,
        })

        expect(result.vertices).toHaveLength(2)
      })

      it('should return paths', () => {
        const result = engine.bfs(['alice'], {
          direction: 'out',
          minHops: 1,
          maxHops: 2,
        })

        const bobPath = result.paths.find(p => p.vertices[p.vertices.length - 1] === 'bob')
        expect(bobPath?.vertices).toEqual(['alice', 'bob'])
        expect(bobPath?.length).toBe(1)
      })
    })

    describe('Path Finding', () => {
      it('should find if path exists', () => {
        expect(engine.pathExists('alice', 'dave')).toBe(true)
        expect(engine.pathExists('alice', 'frank')).toBe(true)
        expect(engine.pathExists('dave', 'alice')).toBe(false)
      })

      it('should respect max depth', () => {
        expect(engine.pathExists('alice', 'dave', 2)).toBe(false)
        expect(engine.pathExists('alice', 'dave', 3)).toBe(true)
      })

      it('should find shortest path', () => {
        const path = engine.shortestPath('alice', 'dave')
        
        expect(path).not.toBeNull()
        expect(path?.vertices).toEqual(['alice', 'bob', 'carol', 'dave'])
        expect(path?.length).toBe(3)
      })

      it('should return null when no path exists', () => {
        const path = engine.shortestPath('dave', 'alice')
        expect(path).toBeNull()
      })

      it('should find all paths', () => {
        // Add another path: alice -> bob -> eve -> frank
        index.addEdge({ id: 'r7', type: 'FOLLOWS', from: 'bob', to: 'frank', createdAt: Date.now() })
        
        const paths = engine.allPaths('alice', 'frank', 5)
        
        expect(paths.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('N-Hop Neighbors', () => {
      it('should find n-hop neighbors with distances', () => {
        const neighbors = engine.nHopNeighbors('alice', 3)
        
        expect(neighbors.get('bob')).toBe(1)
        expect(neighbors.get('eve')).toBe(1)
        expect(neighbors.get('carol')).toBe(2)
        expect(neighbors.get('frank')).toBe(2)
        expect(neighbors.get('dave')).toBe(3)
      })
    })

    describe('Common Neighbors', () => {
      it('should find common neighbors', () => {
        // alice and bob both have outgoing to eve (alice->eve, bob->eve via LIKES)
        // Actually bob->eve is LIKES, let's check the structure
        
        // Add a common friend
        index.addEdge({ id: 'r7', type: 'FOLLOWS', from: 'carol', to: 'eve', createdAt: Date.now() })
        
        const common = engine.commonNeighbors('alice', 'carol', 'out')
        // alice->bob, alice->eve; carol->dave, carol->eve
        expect(common).toContain('eve')
      })
    })
  })

  // ============================================================================
  // Cypher Parser Tests
  // ============================================================================
  describe('CypherParser', () => {
    let parser: CypherParser

    beforeEach(() => {
      parser = new CypherParser()
    })

    it('should parse simple pattern', () => {
      const query = parser.parse('MATCH (a:User)-[:FOLLOWS]->(b:User) RETURN b')

      expect(query.startVertices).toEqual({ types: ['User'] })
      expect(query.traversals).toHaveLength(1)
      expect(query.traversals[0].edgeTypes).toEqual(['FOLLOWS'])
      expect(query.traversals[0].minHops).toBe(1)
      expect(query.traversals[0].maxHops).toBe(1)
    })

    it('should parse variable-length pattern', () => {
      const query = parser.parse('MATCH (a)-[:FOLLOWS*1..3]->(b) RETURN b')

      expect(query.traversals[0].minHops).toBe(1)
      expect(query.traversals[0].maxHops).toBe(3)
    })

    it('should parse LIMIT', () => {
      const query = parser.parse('MATCH (a)-[:FOLLOWS]->(b) RETURN b LIMIT 10')

      expect(query.limit).toBe(10)
    })

    it('should parse node properties', () => {
      const query = parser.parse("MATCH (a:User {id: 'alice'})-[:FOLLOWS]->(b) RETURN b")

      const filter = query.startVertices as { types?: string[]; predicates?: unknown[] }
      expect(filter.types).toEqual(['User'])
      expect(filter.predicates).toBeDefined()
      expect(filter.predicates).toHaveLength(1)
    })
  })

  // ============================================================================
  // MongoDB $graphLookup Tests
  // ============================================================================
  describe('MongoGraphLookup', () => {
    let index: AdjacencyIndex
    let engine: GraphTraversalEngine
    let lookup: MongoGraphLookup

    beforeEach(() => {
      index = new AdjacencyIndex(100, 1000)
      
      // Simple chain: a -> b -> c -> d
      index.addEdge({ id: 'r1', type: 'FOLLOWS', from: 'a', to: 'b', createdAt: Date.now() })
      index.addEdge({ id: 'r2', type: 'FOLLOWS', from: 'b', to: 'c', createdAt: Date.now() })
      index.addEdge({ id: 'r3', type: 'FOLLOWS', from: 'c', to: 'd', createdAt: Date.now() })

      engine = new GraphTraversalEngine(index)
      lookup = new MongoGraphLookup(engine)
    })

    it('should execute $graphLookup', () => {
      const docs = [{ _id: 'doc1', startNode: 'a' }]
      
      const result = lookup.execute(docs, {
        from: 'relationships',
        startWith: '$startNode',
        connectFromField: 'from',
        connectToField: 'to',
        as: 'connections',
        maxDepth: 3,
      })

      expect(result[0].connections).toBeDefined()
      const connections = result[0].connections as { _id: string }[]
      expect(connections.map(c => c._id).sort()).toEqual(['b', 'c', 'd'])
    })

    it('should include depth field', () => {
      const docs = [{ _id: 'doc1', startNode: 'a' }]
      
      const result = lookup.execute(docs, {
        from: 'relationships',
        startWith: '$startNode',
        connectFromField: 'from',
        connectToField: 'to',
        as: 'connections',
        maxDepth: 3,
        depthField: 'depth',
      })

      const connections = result[0].connections as { _id: string; depth: number }[]
      const bConn = connections.find(c => c._id === 'b')
      const cConn = connections.find(c => c._id === 'c')
      const dConn = connections.find(c => c._id === 'd')
      
      expect(bConn?.depth).toBe(1)
      expect(cConn?.depth).toBe(2)
      expect(dConn?.depth).toBe(3)
    })
  })

  // ============================================================================
  // Test Data Generation
  // ============================================================================
  describe('Test Data Generation', () => {
    it('should generate social graph', () => {
      const { things, relationships } = generateSocialGraph(100, 5)

      expect(things).toHaveLength(100)
      expect(relationships.length).toBeGreaterThan(0)
      
      // All relationships should reference existing users
      const userIds = new Set(things.map(t => t.id))
      for (const rel of relationships) {
        expect(userIds.has(rel.from)).toBe(true)
        expect(userIds.has(rel.to)).toBe(true)
      }
    })
  })

  // ============================================================================
  // Cost Analysis
  // ============================================================================
  describe('Cost Analysis', () => {
    it('should show savings for graph queries', () => {
      const analysis = graphCostAnalysis(10000, 100000, 10)

      for (const entry of analysis) {
        expect(entry.withIndex.operations).toBeLessThan(entry.withoutIndex.operations)
        expect(entry.savings).not.toBe('0%')
      }
    })

    it('should show massive savings for 1-hop', () => {
      const analysis = graphCostAnalysis(10000, 100000, 10)
      const oneHop = analysis.find(a => a.query === '1-hop neighbors')

      expect(oneHop).toBeDefined()
      expect(oneHop!.withIndex.operations).toBe(10) // avg degree
      expect(oneHop!.withoutIndex.operations).toBe(100000) // all edges
    })
  })

  // ============================================================================
  // Performance Tests
  // ============================================================================
  describe('Performance', () => {
    it('should handle large graphs efficiently', () => {
      const { relationships } = generateSocialGraph(1000, 10)
      const index = new AdjacencyIndex(1000, 20000)
      
      for (const rel of relationships) {
        index.addEdge(rel)
      }

      const engine = new GraphTraversalEngine(index)
      
      const start = performance.now()
      // Use user-999 since edges go from higher to lower user IDs
      const result = engine.bfs(['user-999'], {
        direction: 'out',
        minHops: 1,
        maxHops: 3,
      })
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100) // Should complete in < 100ms
      // user-999 follows ~10 users, each follows ~10, etc.
      expect(result.vertices.length).toBeGreaterThan(0)
    })

    it('should find paths quickly with bidirectional BFS', () => {
      const { relationships } = generateSocialGraph(1000, 10)
      const index = new AdjacencyIndex(1000, 20000)
      
      for (const rel of relationships) {
        index.addEdge(rel)
      }

      const engine = new GraphTraversalEngine(index)
      
      const start = performance.now()
      const exists = engine.pathExists('user-999', 'user-0', 6)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(50) // Bidirectional should be fast
      // May or may not exist depending on random graph
      expect(typeof exists).toBe('boolean')
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================
  describe('Integration', () => {
    it('should support full query workflow', () => {
      // 1. Generate graph
      const { relationships } = generateSocialGraph(100, 5)
      
      // 2. Build index
      const index = new AdjacencyIndex(100, 1000)
      for (const rel of relationships) {
        index.addEdge(rel)
      }

      // 3. Parse Cypher query
      const parser = new CypherParser()
      const query = parser.parse(
        "MATCH (a:User)-[:FOLLOWS*1..2]->(b:User) RETURN b LIMIT 10"
      )

      // 4. Execute traversal
      const engine = new GraphTraversalEngine(index)
      const result = engine.bfs(['user-50'], {
        direction: query.traversals[0].direction,
        edgeTypes: query.traversals[0].edgeTypes,
        minHops: query.traversals[0].minHops,
        maxHops: query.traversals[0].maxHops,
        limit: query.limit,
      })

      // 5. Verify results
      expect(result.vertices.length).toBeLessThanOrEqual(10)
      expect(result.paths.length).toBe(result.vertices.length)
    })
  })
})
