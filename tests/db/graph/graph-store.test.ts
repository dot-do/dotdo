/**
 * GraphStore Tests (RED - Failing Tests)
 *
 * These tests define the expected API for GraphStore based on the README specification.
 * The implementation doesn't exist yet, so all tests should FAIL.
 *
 * Tests cover:
 * 1. Edge CRUD (source, target, type, properties)
 * 2. Bidirectional lookups (outgoing, incoming)
 * 3. Traversal queries (BFS/DFS)
 * 4. Cycle detection
 * 5. Shortest path
 * 6. CDC event emission
 *
 * @see db/graph/README.md for the full API specification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GraphStore } from '../../../db/graph'

describe('GraphStore', () => {
  let graph: GraphStore

  // Mock database - in real implementation this would be SQLite
  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Create new GraphStore instance - this will fail because the class doesn't exist
    graph = new GraphStore(mockDb as unknown)
  })

  // ==========================================================================
  // EDGE CRUD OPERATIONS
  // ==========================================================================

  describe('Edge CRUD', () => {
    describe('relate()', () => {
      it('creates a relationship between two nodes', async () => {
        const result = await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
        })

        expect(result).toBeDefined()
        expect(result.from).toBe('User/alice')
        expect(result.to).toBe('Team/engineering')
        expect(result.type).toBe('memberOf')
        expect(result.$id).toBeDefined()
        expect(result.$createdAt).toBeDefined()
      })

      it('creates a relationship with optional data payload', async () => {
        const result = await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
          data: { role: 'lead', since: '2024-01-01' },
        })

        expect(result.data).toEqual({ role: 'lead', since: '2024-01-01' })
      })

      it('throws on duplicate relationship', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
        })

        await expect(
          graph.relate({
            from: 'User/alice',
            to: 'Team/engineering',
            type: 'memberOf',
          }),
        ).rejects.toThrow(/unique|duplicate|already exists/i)
      })

      it('allows same nodes with different relationship types', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'User/bob',
          type: 'follows',
        })

        const result = await graph.relate({
          from: 'User/alice',
          to: 'User/bob',
          type: 'friendOf',
        })

        expect(result).toBeDefined()
        expect(result.type).toBe('friendOf')
      })

      it('extracts from_type and to_type from node IDs', async () => {
        const result = await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
        })

        expect(result.from_type).toBe('User')
        expect(result.to_type).toBe('Team')
      })
    })

    describe('unrelate()', () => {
      it('deletes an existing relationship', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
        })

        const deleted = await graph.unrelate('User/alice', 'Team/engineering', 'memberOf')

        expect(deleted).toBe(true)
      })

      it('returns false when relationship does not exist', async () => {
        const deleted = await graph.unrelate('User/nonexistent', 'Team/missing', 'memberOf')

        expect(deleted).toBe(false)
      })

      it('only deletes the specified relationship type', async () => {
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'friendOf' })

        await graph.unrelate('User/alice', 'User/bob', 'follows')

        const stillExists = await graph.exists('User/alice', 'User/bob', 'friendOf')
        expect(stillExists).toBe(true)
      })
    })

    describe('exists()', () => {
      it('returns true for existing relationship', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
        })

        const exists = await graph.exists('User/alice', 'Team/engineering', 'memberOf')

        expect(exists).toBe(true)
      })

      it('returns false for non-existing relationship', async () => {
        const exists = await graph.exists('User/alice', 'Team/engineering', 'memberOf')

        expect(exists).toBe(false)
      })

      it('returns false for wrong relationship type', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'User/bob',
          type: 'follows',
        })

        const exists = await graph.exists('User/alice', 'User/bob', 'friendOf')

        expect(exists).toBe(false)
      })
    })
  })

  // ==========================================================================
  // BIDIRECTIONAL LOOKUPS
  // ==========================================================================

  describe('Bidirectional Lookups', () => {
    describe('outgoing()', () => {
      it('returns all outgoing edges from a node', async () => {
        await graph.relate({ from: 'User/alice', to: 'Team/engineering', type: 'memberOf' })
        await graph.relate({ from: 'User/alice', to: 'Team/platform', type: 'memberOf' })

        const teams = await graph.outgoing('User/alice')

        expect(teams).toHaveLength(2)
        expect(teams.map((t) => t.to)).toContain('Team/engineering')
        expect(teams.map((t) => t.to)).toContain('Team/platform')
      })

      it('filters by relationship type', async () => {
        await graph.relate({ from: 'User/alice', to: 'Team/engineering', type: 'memberOf' })
        await graph.relate({ from: 'User/alice', to: 'Team/platform', type: 'leads' })

        const teams = await graph.outgoing('User/alice', { type: 'memberOf' })

        expect(teams).toHaveLength(1)
        expect(teams[0].to).toBe('Team/engineering')
      })

      it('returns empty array when no outgoing edges', async () => {
        const edges = await graph.outgoing('User/nobody')

        expect(edges).toEqual([])
      })

      it('includes edge data in results', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
          data: { role: 'lead' },
        })

        const teams = await graph.outgoing('User/alice')

        expect(teams[0].data).toEqual({ role: 'lead' })
      })
    })

    describe('incoming()', () => {
      it('returns all incoming edges to a node', async () => {
        await graph.relate({ from: 'User/alice', to: 'Team/engineering', type: 'memberOf' })
        await graph.relate({ from: 'User/bob', to: 'Team/engineering', type: 'memberOf' })

        const members = await graph.incoming('Team/engineering')

        expect(members).toHaveLength(2)
        expect(members.map((m) => m.from)).toContain('User/alice')
        expect(members.map((m) => m.from)).toContain('User/bob')
      })

      it('filters by relationship type', async () => {
        await graph.relate({ from: 'User/alice', to: 'Team/engineering', type: 'memberOf' })
        await graph.relate({ from: 'User/bob', to: 'Team/engineering', type: 'leads' })

        const members = await graph.incoming('Team/engineering', { type: 'memberOf' })

        expect(members).toHaveLength(1)
        expect(members[0].from).toBe('User/alice')
      })

      it('returns empty array when no incoming edges', async () => {
        const edges = await graph.incoming('Team/orphan')

        expect(edges).toEqual([])
      })
    })

    describe('outgoingBatch()', () => {
      it('batches multiple outgoing queries to prevent N+1', async () => {
        await graph.relate({ from: 'User/alice', to: 'Team/engineering', type: 'memberOf' })
        await graph.relate({ from: 'User/bob', to: 'Team/platform', type: 'memberOf' })
        await graph.relate({ from: 'User/carol', to: 'Team/engineering', type: 'memberOf' })

        const teamsByUser = await graph.outgoingBatch(
          ['User/alice', 'User/bob', 'User/carol'],
          { type: 'memberOf' },
        )

        expect(teamsByUser.get('User/alice')).toHaveLength(1)
        expect(teamsByUser.get('User/bob')).toHaveLength(1)
        expect(teamsByUser.get('User/carol')).toHaveLength(1)
      })

      it('returns empty arrays for nodes with no edges', async () => {
        await graph.relate({ from: 'User/alice', to: 'Team/engineering', type: 'memberOf' })

        const teamsByUser = await graph.outgoingBatch(
          ['User/alice', 'User/nobody'],
          { type: 'memberOf' },
        )

        expect(teamsByUser.get('User/alice')).toHaveLength(1)
        expect(teamsByUser.get('User/nobody')).toEqual([])
      })
    })
  })

  // ==========================================================================
  // TRAVERSAL QUERIES
  // ==========================================================================

  describe('Traversal Queries', () => {
    describe('traverse() BFS', () => {
      beforeEach(async () => {
        // Create a graph: alice -> bob -> carol -> dave
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
        await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'follows' })
        await graph.relate({ from: 'User/carol', to: 'User/dave', type: 'follows' })
      })

      it('traverses graph using BFS by default', async () => {
        const result = await graph.traverse({
          start: 'User/alice',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 3,
        })

        expect(result.nodes).toHaveLength(3)
        expect(result.nodes.map((n) => n.id)).toContain('User/bob')
        expect(result.nodes.map((n) => n.id)).toContain('User/carol')
        expect(result.nodes.map((n) => n.id)).toContain('User/dave')
      })

      it('explicitly uses BFS algorithm', async () => {
        const result = await graph.traverse({
          start: 'User/alice',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 3,
          algorithm: 'bfs',
        })

        // BFS returns nodes in order of distance from start
        expect(result.nodes[0].id).toBe('User/bob')
        expect(result.nodes[1].id).toBe('User/carol')
        expect(result.nodes[2].id).toBe('User/dave')
      })

      it('respects maxDepth limit', async () => {
        const result = await graph.traverse({
          start: 'User/alice',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 1,
        })

        expect(result.nodes).toHaveLength(1)
        expect(result.nodes[0].id).toBe('User/bob')
      })

      it('handles incoming direction', async () => {
        const result = await graph.traverse({
          start: 'User/dave',
          direction: 'incoming',
          types: ['follows'],
          maxDepth: 3,
        })

        expect(result.nodes).toHaveLength(3)
        expect(result.nodes.map((n) => n.id)).toContain('User/carol')
        expect(result.nodes.map((n) => n.id)).toContain('User/bob')
        expect(result.nodes.map((n) => n.id)).toContain('User/alice')
      })

      it('filters by relationship types', async () => {
        await graph.relate({ from: 'User/alice', to: 'User/eve', type: 'blocks' })

        const result = await graph.traverse({
          start: 'User/alice',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 3,
        })

        // Should not include User/eve (blocked, not followed)
        expect(result.nodes.map((n) => n.id)).not.toContain('User/eve')
      })

      it('returns empty result for isolated node', async () => {
        const result = await graph.traverse({
          start: 'User/isolated',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 3,
        })

        expect(result.nodes).toHaveLength(0)
      })
    })

    describe('traverse() DFS', () => {
      beforeEach(async () => {
        // Create a branching graph:
        //   alice -> bob -> dave
        //   alice -> carol -> dave
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
        await graph.relate({ from: 'User/alice', to: 'User/carol', type: 'follows' })
        await graph.relate({ from: 'User/bob', to: 'User/dave', type: 'follows' })
        await graph.relate({ from: 'User/carol', to: 'User/dave', type: 'follows' })
      })

      it('uses DFS algorithm when specified', async () => {
        const result = await graph.traverse({
          start: 'User/alice',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 5,
          algorithm: 'dfs',
        })

        // DFS explores depth-first, so should reach dave before backtracking
        expect(result.nodes.map((n) => n.id)).toContain('User/dave')
      })

      it('DFS respects maxDepth', async () => {
        const result = await graph.traverse({
          start: 'User/alice',
          direction: 'outgoing',
          types: ['follows'],
          maxDepth: 1,
          algorithm: 'dfs',
        })

        expect(result.nodes).toHaveLength(2) // bob and carol only
        expect(result.nodes.map((n) => n.id)).not.toContain('User/dave')
      })
    })
  })

  // ==========================================================================
  // CYCLE DETECTION
  // ==========================================================================

  describe('Cycle Detection', () => {
    describe('detectCycle()', () => {
      it('detects simple cycle', async () => {
        // alice -> bob -> alice (cycle)
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'reportsTo' })
        await graph.relate({ from: 'User/bob', to: 'User/alice', type: 'reportsTo' })

        const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')

        expect(hasCycle).toBe(true)
      })

      it('detects transitive cycle', async () => {
        // alice -> bob -> carol -> alice (cycle)
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'reportsTo' })
        await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'reportsTo' })
        await graph.relate({ from: 'User/carol', to: 'User/alice', type: 'reportsTo' })

        const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')

        expect(hasCycle).toBe(true)
      })

      it('returns false for acyclic graph', async () => {
        // alice -> bob -> carol (no cycle)
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'reportsTo' })
        await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'reportsTo' })

        const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')

        expect(hasCycle).toBe(false)
      })

      it('only considers the specified relationship type', async () => {
        // alice -> bob (reportsTo), bob -> alice (follows) - not a cycle in reportsTo
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'reportsTo' })
        await graph.relate({ from: 'User/bob', to: 'User/alice', type: 'follows' })

        const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')

        expect(hasCycle).toBe(false)
      })

      it('detects self-loop', async () => {
        await graph.relate({ from: 'User/alice', to: 'User/alice', type: 'reportsTo' })

        const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')

        expect(hasCycle).toBe(true)
      })

      it('returns false for isolated node', async () => {
        const hasCycle = await graph.detectCycle('User/isolated', 'reportsTo')

        expect(hasCycle).toBe(false)
      })
    })
  })

  // ==========================================================================
  // SHORTEST PATH
  // ==========================================================================

  describe('Shortest Path', () => {
    describe('findPath()', () => {
      beforeEach(async () => {
        // Create an org hierarchy:
        // alice -> bob -> carol -> ceo
        //       -> dave -------/
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'reportsTo' })
        await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'reportsTo' })
        await graph.relate({ from: 'User/carol', to: 'User/ceo', type: 'reportsTo' })
        await graph.relate({ from: 'User/alice', to: 'User/dave', type: 'reportsTo' })
        await graph.relate({ from: 'User/dave', to: 'User/ceo', type: 'reportsTo' })
      })

      it('finds a path between two nodes', async () => {
        const path = await graph.findPath({
          from: 'User/alice',
          to: 'User/ceo',
          types: ['reportsTo'],
        })

        expect(path).toBeDefined()
        expect(path!.length).toBeGreaterThan(0)
        expect(path![0]).toBe('User/alice')
        expect(path![path!.length - 1]).toBe('User/ceo')
      })

      it('returns null when no path exists', async () => {
        const path = await graph.findPath({
          from: 'User/alice',
          to: 'User/isolated',
          types: ['reportsTo'],
        })

        expect(path).toBeNull()
      })
    })

    describe('shortestPath()', () => {
      beforeEach(async () => {
        // Create a social network with multiple paths:
        // alice -> bob -> carol -> dave (length 3)
        // alice -> eve -> dave (length 2)
        await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
        await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'follows' })
        await graph.relate({ from: 'User/carol', to: 'User/dave', type: 'follows' })
        await graph.relate({ from: 'User/alice', to: 'User/eve', type: 'follows' })
        await graph.relate({ from: 'User/eve', to: 'User/dave', type: 'follows' })
      })

      it('finds the shortest path between two nodes', async () => {
        const path = await graph.shortestPath({
          from: 'User/alice',
          to: 'User/dave',
          types: ['follows'],
        })

        // Shortest path is alice -> eve -> dave
        expect(path).toEqual(['User/alice', 'User/eve', 'User/dave'])
      })

      it('returns path of length 1 for adjacent nodes', async () => {
        const path = await graph.shortestPath({
          from: 'User/alice',
          to: 'User/bob',
          types: ['follows'],
        })

        expect(path).toEqual(['User/alice', 'User/bob'])
      })

      it('returns null when no path exists', async () => {
        const path = await graph.shortestPath({
          from: 'User/alice',
          to: 'User/isolated',
          types: ['follows'],
        })

        expect(path).toBeNull()
      })

      it('respects maxDepth limit', async () => {
        const path = await graph.shortestPath({
          from: 'User/alice',
          to: 'User/dave',
          types: ['follows'],
          maxDepth: 1,
        })

        // Cannot reach dave in 1 hop
        expect(path).toBeNull()
      })

      it('supports multiple relationship types', async () => {
        await graph.relate({ from: 'User/alice', to: 'User/dave', type: 'friendOf' })

        const path = await graph.shortestPath({
          from: 'User/alice',
          to: 'User/dave',
          types: ['follows', 'friendOf'],
        })

        // Direct friendOf relationship is shortest
        expect(path).toEqual(['User/alice', 'User/dave'])
      })

      it('returns same node for start == end', async () => {
        const path = await graph.shortestPath({
          from: 'User/alice',
          to: 'User/alice',
          types: ['follows'],
        })

        expect(path).toEqual(['User/alice'])
      })
    })
  })

  // ==========================================================================
  // CDC EVENT EMISSION
  // ==========================================================================

  describe('CDC Event Emission', () => {
    let cdcEvents: unknown[]

    beforeEach(() => {
      cdcEvents = []
      // Subscribe to CDC events
      graph.onCDC((event) => {
        cdcEvents.push(event)
      })
    })

    describe('on relate()', () => {
      it('emits cdc.insert event when creating relationship', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
          data: { role: 'lead' },
        })

        expect(cdcEvents).toHaveLength(1)
        expect(cdcEvents[0]).toMatchObject({
          type: 'cdc.insert',
          op: 'c',
          store: 'graph',
          table: 'relationships',
          after: {
            from: 'User/alice',
            to: 'Team/engineering',
            type: 'memberOf',
            data: { role: 'lead' },
          },
        })
        expect(cdcEvents[0]).toHaveProperty('key')
      })
    })

    describe('on unrelate()', () => {
      it('emits cdc.delete event when deleting relationship', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
        })

        cdcEvents = [] // Clear the insert event

        await graph.unrelate('User/alice', 'Team/engineering', 'memberOf')

        expect(cdcEvents).toHaveLength(1)
        expect(cdcEvents[0]).toMatchObject({
          type: 'cdc.delete',
          op: 'd',
          store: 'graph',
          table: 'relationships',
          before: {
            from: 'User/alice',
            to: 'Team/engineering',
            type: 'memberOf',
          },
        })
      })

      it('does not emit event when relationship does not exist', async () => {
        await graph.unrelate('User/nonexistent', 'Team/missing', 'memberOf')

        expect(cdcEvents).toHaveLength(0)
      })
    })

    describe('on update()', () => {
      it('emits cdc.update event when updating relationship data', async () => {
        await graph.relate({
          from: 'User/alice',
          to: 'Team/engineering',
          type: 'memberOf',
          data: { role: 'member' },
        })

        cdcEvents = [] // Clear the insert event

        await graph.updateRelationship('User/alice', 'Team/engineering', 'memberOf', {
          data: { role: 'lead' },
        })

        expect(cdcEvents).toHaveLength(1)
        expect(cdcEvents[0]).toMatchObject({
          type: 'cdc.update',
          op: 'u',
          store: 'graph',
          table: 'relationships',
          before: {
            data: { role: 'member' },
          },
          after: {
            data: { role: 'lead' },
          },
        })
      })
    })
  })

  // ==========================================================================
  // SCHEMA VERIFICATION
  // ==========================================================================

  describe('Schema', () => {
    it('creates relationships table with correct schema', async () => {
      // This test verifies the schema from the README
      const schema = await graph.getSchema()

      expect(schema.tables).toContain('relationships')
      expect(schema.columns.relationships).toContain('$id')
      expect(schema.columns.relationships).toContain('from_id')
      expect(schema.columns.relationships).toContain('from_type')
      expect(schema.columns.relationships).toContain('to_id')
      expect(schema.columns.relationships).toContain('to_type')
      expect(schema.columns.relationships).toContain('type')
      expect(schema.columns.relationships).toContain('data')
      expect(schema.columns.relationships).toContain('$createdAt')
      expect(schema.columns.relationships).toContain('$updatedAt')
    })

    it('has unique constraint on (from_id, to_id, type)', async () => {
      const constraints = await graph.getConstraints()

      expect(constraints).toContainEqual({
        table: 'relationships',
        type: 'unique',
        columns: ['from_id', 'to_id', 'type'],
      })
    })

    it('has adjacency indexes for fast traversal', async () => {
      const indexes = await graph.getIndexes()

      expect(indexes).toContainEqual({
        table: 'relationships',
        name: 'idx_rel_from',
        columns: ['from_id', 'type'],
      })

      expect(indexes).toContainEqual({
        table: 'relationships',
        name: 'idx_rel_to',
        columns: ['to_id', 'type'],
      })
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles special characters in node IDs', async () => {
      await graph.relate({
        from: 'User/alice+special',
        to: 'Team/engineering-123',
        type: 'member_of',
      })

      const exists = await graph.exists('User/alice+special', 'Team/engineering-123', 'member_of')

      expect(exists).toBe(true)
    })

    it('handles empty data payload', async () => {
      const result = await graph.relate({
        from: 'User/alice',
        to: 'Team/engineering',
        type: 'memberOf',
        data: {},
      })

      expect(result.data).toEqual({})
    })

    it('handles null data payload', async () => {
      const result = await graph.relate({
        from: 'User/alice',
        to: 'Team/engineering',
        type: 'memberOf',
      })

      expect(result.data).toBeNull()
    })

    it('handles deeply nested data payload', async () => {
      const nestedData = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
        array: [1, 2, { nested: true }],
      }

      const result = await graph.relate({
        from: 'User/alice',
        to: 'Team/engineering',
        type: 'memberOf',
        data: nestedData,
      })

      expect(result.data).toEqual(nestedData)
    })

    it('handles very long relationship type names', async () => {
      const longType = 'a'.repeat(255)

      await graph.relate({
        from: 'User/alice',
        to: 'Team/engineering',
        type: longType,
      })

      const exists = await graph.exists('User/alice', 'Team/engineering', longType)

      expect(exists).toBe(true)
    })

    it('handles concurrent relate operations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        graph.relate({
          from: 'User/alice',
          to: `Team/team-${i}`,
          type: 'memberOf',
        }),
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      expect(new Set(results.map((r) => r.$id)).size).toBe(10) // All unique IDs
    })
  })
})
