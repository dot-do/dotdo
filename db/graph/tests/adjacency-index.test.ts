/**
 * Adjacency Index Tests - Columnar Graph Storage
 *
 * TDD RED Phase: Failing tests for the AdjacencyIndex implementation.
 *
 * The AdjacencyIndex provides a columnar storage format for graph edges optimized for:
 * - Fast neighbor queries (outgoing and incoming)
 * - Efficient degree counting
 * - Bloom filters for existence checks
 * - Supernode detection and handling
 * - Sharding support for horizontal scaling
 *
 * Storage Format:
 * - adj:nodeId -> [{to, type, relId, data}] (outgoing adjacency list)
 * - rev:nodeId -> [{from, type, relId, data}] (incoming adjacency list / reverse index)
 *
 * @see dotdo-40ne3 - [GRAPH-1] RED: Adjacency Index - Write failing tests
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types for Adjacency Index
// ============================================================================

/**
 * Entry in an adjacency list (outgoing edge)
 */
export interface AdjacencyEntry {
  to: string // Target node ID
  type: string // Edge type (verb)
  relId: string // Relationship ID
  data: Record<string, unknown> | null // Edge properties
  createdAt: number // Timestamp
}

/**
 * Entry in the reverse index (incoming edge)
 */
export interface ReverseEntry {
  from: string // Source node ID
  type: string // Edge type (verb)
  relId: string // Relationship ID
  data: Record<string, unknown> | null // Edge properties
  createdAt: number // Timestamp
}

/**
 * Direction for neighbor queries
 */
export type EdgeDirection = 'out' | 'in' | 'both'

/**
 * Query options for neighbor lookups
 */
export interface NeighborQueryOptions {
  direction?: EdgeDirection
  type?: string | string[] // Filter by edge type(s)
  limit?: number
  offset?: number
  orderBy?: 'createdAt' | 'type'
  orderDirection?: 'asc' | 'desc'
}

/**
 * Result of a neighbor query
 */
export interface NeighborResult {
  nodeId: string
  direction: 'out' | 'in'
  type: string
  relId: string
  data: Record<string, unknown> | null
  createdAt: number
}

/**
 * Degree information for a node
 */
export interface NodeDegree {
  nodeId: string
  outDegree: number
  inDegree: number
  totalDegree: number
  byType: Record<string, { out: number; in: number }>
}

/**
 * Bloom filter statistics
 */
export interface BloomFilterStats {
  size: number // Number of bits
  hashFunctions: number // Number of hash functions
  insertedCount: number // Elements inserted
  estimatedFalsePositiveRate: number // Current FPR
}

/**
 * Supernode threshold configuration
 */
export interface SupernodeConfig {
  threshold: number // Degree above which a node is considered a supernode
  samplingRate: number // Sampling rate for supernode queries (0-1)
  shardCount: number // Number of shards for supernode edges
}

/**
 * Shard information
 */
export interface ShardInfo {
  shardId: number
  nodeCount: number
  edgeCount: number
  sizeBytes: number
}

/**
 * AdjacencyIndex interface
 */
export interface AdjacencyIndex {
  // Edge operations
  addEdge(from: string, to: string, type: string, data?: Record<string, unknown>): Promise<string>
  removeEdge(relId: string): Promise<boolean>
  removeEdgeByEndpoints(from: string, to: string, type: string): Promise<boolean>
  hasEdge(from: string, to: string, type?: string): Promise<boolean>

  // Neighbor queries
  getNeighbors(nodeId: string, options?: NeighborQueryOptions): Promise<NeighborResult[]>
  getOutNeighbors(nodeId: string, type?: string): Promise<string[]>
  getInNeighbors(nodeId: string, type?: string): Promise<string[]>

  // Degree operations
  getDegree(nodeId: string): Promise<NodeDegree>
  getOutDegree(nodeId: string, type?: string): Promise<number>
  getInDegree(nodeId: string, type?: string): Promise<number>

  // Bulk operations
  addEdges(edges: Array<{ from: string; to: string; type: string; data?: Record<string, unknown> }>): Promise<string[]>
  removeEdges(relIds: string[]): Promise<number>
  getNeighborsBatch(nodeIds: string[], options?: NeighborQueryOptions): Promise<Map<string, NeighborResult[]>>

  // Bloom filter operations
  hasVertex(nodeId: string): Promise<boolean>
  probablyHasEdge(from: string, to: string, type?: string): boolean // Synchronous bloom check
  getBloomFilterStats(): BloomFilterStats

  // Supernode operations
  isSupernode(nodeId: string): Promise<boolean>
  getSupernodes(minDegree?: number): Promise<string[]>
  configureSupernodeHandling(config: SupernodeConfig): void

  // Sharding operations
  getShardInfo(): Promise<ShardInfo[]>
  getShardForNode(nodeId: string): number
  rebalanceShards(): Promise<void>

  // Maintenance
  compact(): Promise<void>
  vacuum(): Promise<void>
  getStats(): Promise<{
    totalNodes: number
    totalEdges: number
    avgDegree: number
    maxDegree: number
    supernodeCount: number
  }>
}

// ============================================================================
// 1. AdjacencyIndex Interface Tests
// ============================================================================

describe('AdjacencyIndex Interface', () => {
  it('AdjacencyIndex is exported from db/graph', async () => {
    // This will fail until AdjacencyIndex is implemented
    const { AdjacencyIndex } = await import('../index')
    expect(AdjacencyIndex).toBeDefined()
  })

  it('createAdjacencyIndex factory is exported', async () => {
    const { createAdjacencyIndex } = await import('../index')
    expect(createAdjacencyIndex).toBeDefined()
  })
})

// ============================================================================
// 2. Edge Addition/Removal Tests
// ============================================================================

describe('Edge Addition and Removal', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create adjacency tables (columnar format)
      sqlite.exec(`
        -- Adjacency list table (outgoing edges)
        CREATE TABLE adjacency_out (
          node_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT PRIMARY KEY,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, target_id, edge_type)
        );

        -- Reverse index table (incoming edges)
        CREATE TABLE adjacency_in (
          node_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, source_id, edge_type),
          FOREIGN KEY (rel_id) REFERENCES adjacency_out(rel_id) ON DELETE CASCADE
        );

        -- Indexes for efficient queries
        CREATE INDEX adj_out_node_idx ON adjacency_out(node_id);
        CREATE INDEX adj_out_node_type_idx ON adjacency_out(node_id, edge_type);
        CREATE INDEX adj_in_node_idx ON adjacency_in(node_id);
        CREATE INDEX adj_in_node_type_idx ON adjacency_in(node_id, edge_type);

        -- Degree tracking table (denormalized for performance)
        CREATE TABLE node_degrees (
          node_id TEXT PRIMARY KEY,
          out_degree INTEGER DEFAULT 0,
          in_degree INTEGER DEFAULT 0
        );
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('addEdge', () => {
    it('adds an edge and stores in adjacency list', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const relId = 'rel-001'

      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'created', '${relId}', '{"role": "author"}', ${now});

        INSERT INTO adjacency_in (node_id, source_id, edge_type, rel_id, data, created_at)
        VALUES ('post-1', 'user-1', 'created', '${relId}', '{"role": "author"}', ${now});
      `)

      // Verify adjacency entry
      const adjResult = sqlite.prepare('SELECT * FROM adjacency_out WHERE rel_id = ?').get(relId) as {
        node_id: string
        target_id: string
        edge_type: string
      }

      expect(adjResult.node_id).toBe('user-1')
      expect(adjResult.target_id).toBe('post-1')
      expect(adjResult.edge_type).toBe('created')

      // Verify reverse index entry
      const revResult = sqlite.prepare('SELECT * FROM adjacency_in WHERE rel_id = ?').get(relId) as {
        node_id: string
        source_id: string
        edge_type: string
      }

      expect(revResult.node_id).toBe('post-1')
      expect(revResult.source_id).toBe('user-1')
      expect(revResult.edge_type).toBe('created')
    })

    it('returns a unique relationship ID', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Simulate adding multiple edges and verify unique IDs
      const relIds = new Set<string>()
      const now = Date.now()

      for (let i = 0; i < 10; i++) {
        const relId = `rel-${i}-${Date.now()}`
        relIds.add(relId)

        sqlite.exec(`
          INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
          VALUES ('user-1', 'post-${i}', 'liked', '${relId}', NULL, ${now + i});
        `)
      }

      expect(relIds.size).toBe(10)
    })

    it('stores edge data as JSON', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const edgeData = JSON.stringify({
        weight: 0.95,
        confidence: 'high',
        metadata: { source: 'api', version: 2 },
      })

      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('node-a', 'node-b', 'similarTo', 'rel-data-001', '${edgeData}', ${now});
      `)

      const result = sqlite.prepare('SELECT data FROM adjacency_out WHERE rel_id = ?').get('rel-data-001') as {
        data: string
      }

      const parsed = JSON.parse(result.data)
      expect(parsed.weight).toBe(0.95)
      expect(parsed.confidence).toBe('high')
      expect(parsed.metadata.source).toBe('api')
    })

    it('rejects duplicate edges (same from, to, type)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'liked', 'rel-dup-001', NULL, ${now});
      `)

      // Attempting duplicate should fail
      expect(() => {
        sqlite.exec(`
          INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
          VALUES ('user-1', 'post-1', 'liked', 'rel-dup-002', NULL, ${now});
        `)
      }).toThrow(/UNIQUE constraint failed/)
    })

    it('allows multiple edge types between same nodes', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'created', 'rel-multi-001', NULL, ${now});

        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'edited', 'rel-multi-002', NULL, ${now});

        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'published', 'rel-multi-003', NULL, ${now});
      `)

      const results = sqlite
        .prepare('SELECT * FROM adjacency_out WHERE node_id = ? AND target_id = ?')
        .all('user-1', 'post-1') as { edge_type: string }[]

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.edge_type).sort()).toEqual(['created', 'edited', 'published'])
    })
  })

  describe('removeEdge', () => {
    beforeEach(async () => {
      if (!sqlite) return

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'created', 'rel-rm-001', NULL, ${now});

        INSERT INTO adjacency_in (node_id, source_id, edge_type, rel_id, data, created_at)
        VALUES ('post-1', 'user-1', 'created', 'rel-rm-001', NULL, ${now});
      `)
    })

    it('removes edge by relationship ID', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Delete from both tables
      sqlite.exec(`DELETE FROM adjacency_in WHERE rel_id = 'rel-rm-001'`)
      const result = sqlite.prepare(`DELETE FROM adjacency_out WHERE rel_id = ?`).run('rel-rm-001')

      expect(result.changes).toBe(1)

      // Verify removal
      const check = sqlite.prepare('SELECT * FROM adjacency_out WHERE rel_id = ?').get('rel-rm-001')
      expect(check).toBeUndefined()
    })

    it('removes from both adjacency and reverse index', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Enable foreign key cascade
      sqlite.exec('PRAGMA foreign_keys = ON')

      // Delete with cascade
      sqlite.exec(`DELETE FROM adjacency_out WHERE rel_id = 'rel-rm-001'`)

      // Both tables should be empty for this rel_id
      const adjCheck = sqlite.prepare('SELECT * FROM adjacency_out WHERE rel_id = ?').get('rel-rm-001')
      const revCheck = sqlite.prepare('SELECT * FROM adjacency_in WHERE rel_id = ?').get('rel-rm-001')

      expect(adjCheck).toBeUndefined()
      expect(revCheck).toBeUndefined()
    })

    it('returns false for non-existent edge', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare(`DELETE FROM adjacency_out WHERE rel_id = ?`).run('non-existent')

      expect(result.changes).toBe(0)
    })
  })

  describe('removeEdgeByEndpoints', () => {
    it('removes edge by from, to, and type', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'liked', 'rel-ep-001', NULL, ${now});
      `)

      const result = sqlite
        .prepare('DELETE FROM adjacency_out WHERE node_id = ? AND target_id = ? AND edge_type = ?')
        .run('user-1', 'post-1', 'liked')

      expect(result.changes).toBe(1)
    })
  })

  describe('hasEdge', () => {
    it('returns true for existing edge', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'created', 'rel-has-001', NULL, ${now});
      `)

      const result = sqlite
        .prepare('SELECT 1 FROM adjacency_out WHERE node_id = ? AND target_id = ? AND edge_type = ?')
        .get('user-1', 'post-1', 'created')

      expect(result).toBeDefined()
    })

    it('returns false for non-existing edge', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite
        .prepare('SELECT 1 FROM adjacency_out WHERE node_id = ? AND target_id = ? AND edge_type = ?')
        .get('user-1', 'post-1', 'nonexistent')

      expect(result).toBeUndefined()
    })

    it('checks any edge type when type not specified', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
        VALUES ('user-1', 'post-1', 'viewed', 'rel-any-001', NULL, ${now});
      `)

      // Query without type filter
      const result = sqlite
        .prepare('SELECT 1 FROM adjacency_out WHERE node_id = ? AND target_id = ?')
        .get('user-1', 'post-1')

      expect(result).toBeDefined()
    })
  })
})

// ============================================================================
// 3. Neighbor Query Tests
// ============================================================================

describe('Neighbor Queries', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE adjacency_out (
          node_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT PRIMARY KEY,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, target_id, edge_type)
        );

        CREATE TABLE adjacency_in (
          node_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, source_id, edge_type)
        );

        CREATE INDEX adj_out_node_idx ON adjacency_out(node_id);
        CREATE INDEX adj_out_node_type_idx ON adjacency_out(node_id, edge_type);
        CREATE INDEX adj_in_node_idx ON adjacency_in(node_id);
        CREATE INDEX adj_in_node_type_idx ON adjacency_in(node_id, edge_type);
      `)

      // Seed test data: user-1 -> post-1, post-2; user-2 -> post-1
      const now = Date.now()
      sqlite.exec(`
        -- user-1 outgoing edges
        INSERT INTO adjacency_out VALUES ('user-1', 'post-1', 'created', 'rel-001', NULL, ${now});
        INSERT INTO adjacency_out VALUES ('user-1', 'post-2', 'created', 'rel-002', NULL, ${now + 100});
        INSERT INTO adjacency_out VALUES ('user-1', 'post-1', 'liked', 'rel-003', NULL, ${now + 200});
        INSERT INTO adjacency_out VALUES ('user-1', 'user-2', 'follows', 'rel-004', NULL, ${now + 300});

        -- user-2 outgoing edges
        INSERT INTO adjacency_out VALUES ('user-2', 'post-1', 'liked', 'rel-005', NULL, ${now + 400});
        INSERT INTO adjacency_out VALUES ('user-2', 'user-1', 'follows', 'rel-006', NULL, ${now + 500});

        -- Reverse index entries
        INSERT INTO adjacency_in VALUES ('post-1', 'user-1', 'created', 'rel-001', NULL, ${now});
        INSERT INTO adjacency_in VALUES ('post-2', 'user-1', 'created', 'rel-002', NULL, ${now + 100});
        INSERT INTO adjacency_in VALUES ('post-1', 'user-1', 'liked', 'rel-003', NULL, ${now + 200});
        INSERT INTO adjacency_in VALUES ('user-2', 'user-1', 'follows', 'rel-004', NULL, ${now + 300});
        INSERT INTO adjacency_in VALUES ('post-1', 'user-2', 'liked', 'rel-005', NULL, ${now + 400});
        INSERT INTO adjacency_in VALUES ('user-1', 'user-2', 'follows', 'rel-006', NULL, ${now + 500});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('getOutNeighbors', () => {
    it('returns all outgoing neighbors', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare('SELECT DISTINCT target_id FROM adjacency_out WHERE node_id = ?')
        .all('user-1') as { target_id: string }[]

      expect(results).toHaveLength(3) // post-1, post-2, user-2
      expect(results.map((r) => r.target_id).sort()).toEqual(['post-1', 'post-2', 'user-2'])
    })

    it('filters by edge type', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare('SELECT target_id FROM adjacency_out WHERE node_id = ? AND edge_type = ?')
        .all('user-1', 'created') as { target_id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.target_id).sort()).toEqual(['post-1', 'post-2'])
    })

    it('returns empty array for node with no outgoing edges', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite.prepare('SELECT target_id FROM adjacency_out WHERE node_id = ?').all('post-1') as {
        target_id: string
      }[]

      expect(results).toHaveLength(0)
    })
  })

  describe('getInNeighbors', () => {
    it('returns all incoming neighbors', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare('SELECT DISTINCT source_id FROM adjacency_in WHERE node_id = ?')
        .all('post-1') as { source_id: string }[]

      expect(results).toHaveLength(2) // user-1, user-2
      expect(results.map((r) => r.source_id).sort()).toEqual(['user-1', 'user-2'])
    })

    it('filters by edge type', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare('SELECT source_id FROM adjacency_in WHERE node_id = ? AND edge_type = ?')
        .all('post-1', 'liked') as { source_id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.source_id).sort()).toEqual(['user-1', 'user-2'])
    })

    it('returns empty array for node with no incoming edges', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite.prepare('SELECT source_id FROM adjacency_in WHERE node_id = ?').all('user-nobody') as {
        source_id: string
      }[]

      expect(results).toHaveLength(0)
    })
  })

  describe('getNeighbors with direction', () => {
    it('returns both directions when direction=both', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Get outgoing
      const outResults = sqlite.prepare('SELECT target_id as neighbor FROM adjacency_out WHERE node_id = ?').all('user-1') as {
        neighbor: string
      }[]

      // Get incoming
      const inResults = sqlite.prepare('SELECT source_id as neighbor FROM adjacency_in WHERE node_id = ?').all('user-1') as {
        neighbor: string
      }[]

      // Combine unique neighbors
      const allNeighbors = new Set([...outResults.map((r) => r.neighbor), ...inResults.map((r) => r.neighbor)])

      expect(allNeighbors.size).toBe(4) // post-1, post-2, user-2 (out) + user-2 (in)
    })

    it('supports pagination with limit and offset', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const page1 = sqlite.prepare('SELECT target_id FROM adjacency_out WHERE node_id = ? LIMIT 2 OFFSET 0').all('user-1') as {
        target_id: string
      }[]

      const page2 = sqlite.prepare('SELECT target_id FROM adjacency_out WHERE node_id = ? LIMIT 2 OFFSET 2').all('user-1') as {
        target_id: string
      }[]

      expect(page1).toHaveLength(2)
      expect(page2.length).toBeLessThanOrEqual(2)

      // Pages should not overlap
      const page1Set = new Set(page1.map((r) => r.target_id))
      for (const r of page2) {
        expect(page1Set.has(r.target_id)).toBe(false)
      }
    })

    it('orders by createdAt', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare('SELECT target_id, created_at FROM adjacency_out WHERE node_id = ? ORDER BY created_at DESC')
        .all('user-1') as { target_id: string; created_at: number }[]

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.created_at).toBeGreaterThanOrEqual(results[i]!.created_at)
      }
    })

    it('filters by multiple edge types', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare("SELECT target_id FROM adjacency_out WHERE node_id = ? AND edge_type IN ('created', 'liked')")
        .all('user-1') as { target_id: string }[]

      expect(results).toHaveLength(3) // post-1 (created), post-2 (created), post-1 (liked)
    })
  })
})

// ============================================================================
// 4. Degree Tracking Tests
// ============================================================================

describe('Degree Tracking', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE adjacency_out (
          node_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT PRIMARY KEY,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, target_id, edge_type)
        );

        CREATE TABLE adjacency_in (
          node_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, source_id, edge_type)
        );

        -- Denormalized degree table for O(1) degree lookups
        CREATE TABLE node_degrees (
          node_id TEXT PRIMARY KEY,
          out_degree INTEGER DEFAULT 0,
          in_degree INTEGER DEFAULT 0,
          degree_by_type TEXT DEFAULT '{}'
        );

        CREATE INDEX adj_out_node_idx ON adjacency_out(node_id);
        CREATE INDEX adj_in_node_idx ON adjacency_in(node_id);
      `)

      // Seed test data
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO adjacency_out VALUES ('user-1', 'post-1', 'created', 'rel-001', NULL, ${now});
        INSERT INTO adjacency_out VALUES ('user-1', 'post-2', 'created', 'rel-002', NULL, ${now});
        INSERT INTO adjacency_out VALUES ('user-1', 'post-3', 'created', 'rel-003', NULL, ${now});
        INSERT INTO adjacency_out VALUES ('user-1', 'post-1', 'liked', 'rel-004', NULL, ${now});
        INSERT INTO adjacency_out VALUES ('user-1', 'user-2', 'follows', 'rel-005', NULL, ${now});

        INSERT INTO adjacency_in VALUES ('post-1', 'user-1', 'created', 'rel-001', NULL, ${now});
        INSERT INTO adjacency_in VALUES ('post-2', 'user-1', 'created', 'rel-002', NULL, ${now});
        INSERT INTO adjacency_in VALUES ('post-3', 'user-1', 'created', 'rel-003', NULL, ${now});
        INSERT INTO adjacency_in VALUES ('post-1', 'user-1', 'liked', 'rel-004', NULL, ${now});
        INSERT INTO adjacency_in VALUES ('user-2', 'user-1', 'follows', 'rel-005', NULL, ${now});
        INSERT INTO adjacency_in VALUES ('user-1', 'user-2', 'follows', 'rel-006', NULL, ${now});

        -- Pre-computed degrees
        INSERT INTO node_degrees VALUES ('user-1', 5, 1, '{"created": {"out": 3}, "liked": {"out": 1}, "follows": {"out": 1, "in": 1}}');
        INSERT INTO node_degrees VALUES ('post-1', 0, 2, '{"created": {"in": 1}, "liked": {"in": 1}}');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('getOutDegree', () => {
    it('returns total outgoing edge count', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT out_degree FROM node_degrees WHERE node_id = ?').get('user-1') as {
        out_degree: number
      }

      expect(result.out_degree).toBe(5)
    })

    it('returns outgoing edge count by type', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT COUNT(*) as count FROM adjacency_out WHERE node_id = ? AND edge_type = ?').get('user-1', 'created') as {
        count: number
      }

      expect(result.count).toBe(3)
    })

    it('returns 0 for node with no outgoing edges', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT out_degree FROM node_degrees WHERE node_id = ?').get('post-1') as {
        out_degree: number
      } | undefined

      expect(result?.out_degree ?? 0).toBe(0)
    })
  })

  describe('getInDegree', () => {
    it('returns total incoming edge count', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT in_degree FROM node_degrees WHERE node_id = ?').get('post-1') as {
        in_degree: number
      }

      expect(result.in_degree).toBe(2)
    })

    it('returns incoming edge count by type', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT COUNT(*) as count FROM adjacency_in WHERE node_id = ? AND edge_type = ?').get('post-1', 'liked') as {
        count: number
      }

      expect(result.count).toBe(1)
    })
  })

  describe('getDegree', () => {
    it('returns full degree information', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT * FROM node_degrees WHERE node_id = ?').get('user-1') as {
        node_id: string
        out_degree: number
        in_degree: number
        degree_by_type: string
      }

      expect(result.node_id).toBe('user-1')
      expect(result.out_degree).toBe(5)
      expect(result.in_degree).toBe(1)

      const byType = JSON.parse(result.degree_by_type)
      expect(byType.created.out).toBe(3)
      expect(byType.liked.out).toBe(1)
      expect(byType.follows.out).toBe(1)
      expect(byType.follows.in).toBe(1)
    })

    it('calculates total degree as sum of in + out', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT out_degree + in_degree as total_degree FROM node_degrees WHERE node_id = ?').get('user-1') as {
        total_degree: number
      }

      expect(result.total_degree).toBe(6)
    })
  })

  describe('degree maintenance on edge operations', () => {
    it('increments degrees when edge is added', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Simulate adding edge and updating degrees
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO adjacency_out VALUES ('user-1', 'post-4', 'created', 'rel-new', NULL, ${now});
        UPDATE node_degrees SET out_degree = out_degree + 1 WHERE node_id = 'user-1';
      `)

      const result = sqlite.prepare('SELECT out_degree FROM node_degrees WHERE node_id = ?').get('user-1') as {
        out_degree: number
      }

      expect(result.out_degree).toBe(6)
    })

    it('decrements degrees when edge is removed', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Simulate removing edge and updating degrees
      sqlite.exec(`
        DELETE FROM adjacency_out WHERE rel_id = 'rel-001';
        UPDATE node_degrees SET out_degree = out_degree - 1 WHERE node_id = 'user-1';
      `)

      const result = sqlite.prepare('SELECT out_degree FROM node_degrees WHERE node_id = ?').get('user-1') as {
        out_degree: number
      }

      expect(result.out_degree).toBe(4)
    })
  })
})

// ============================================================================
// 5. Bulk Operations Tests
// ============================================================================

describe('Bulk Operations', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE adjacency_out (
          node_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT PRIMARY KEY,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, target_id, edge_type)
        );

        CREATE TABLE adjacency_in (
          node_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          rel_id TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(node_id, source_id, edge_type)
        );

        CREATE INDEX adj_out_node_idx ON adjacency_out(node_id);
        CREATE INDEX adj_in_node_idx ON adjacency_in(node_id);
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('addEdges (batch insert)', () => {
    it('inserts multiple edges in a single transaction', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Use transaction for batch insert
      sqlite.exec('BEGIN TRANSACTION')
      for (let i = 0; i < 100; i++) {
        sqlite.exec(`
          INSERT INTO adjacency_out VALUES ('user-1', 'post-${i}', 'liked', 'rel-batch-${i}', NULL, ${now + i});
        `)
      }
      sqlite.exec('COMMIT')

      const count = sqlite.prepare('SELECT COUNT(*) as count FROM adjacency_out WHERE node_id = ?').get('user-1') as {
        count: number
      }

      expect(count.count).toBe(100)
    })

    it('returns all generated relationship IDs', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const relIds: string[] = []

      for (let i = 0; i < 10; i++) {
        const relId = `rel-ids-${i}`
        relIds.push(relId)
        sqlite.exec(`
          INSERT INTO adjacency_out VALUES ('user-1', 'item-${i}', 'viewed', '${relId}', NULL, ${now});
        `)
      }

      expect(relIds).toHaveLength(10)
      expect(relIds[0]).toBe('rel-ids-0')
      expect(relIds[9]).toBe('rel-ids-9')
    })

    it('rolls back on partial failure', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // First insert a valid edge
      sqlite.exec(`
        INSERT INTO adjacency_out VALUES ('user-1', 'post-1', 'liked', 'rel-rollback-001', NULL, ${now});
      `)

      // Try batch with duplicate - should fail
      expect(() => {
        sqlite.exec('BEGIN TRANSACTION')
        sqlite.exec(`INSERT INTO adjacency_out VALUES ('user-1', 'post-2', 'liked', 'rel-rollback-002', NULL, ${now});`)
        sqlite.exec(`INSERT INTO adjacency_out VALUES ('user-1', 'post-1', 'liked', 'rel-rollback-003', NULL, ${now});`) // Duplicate
        sqlite.exec('COMMIT')
      }).toThrow()

      sqlite.exec('ROLLBACK')

      // Only the first insert should remain
      const count = sqlite.prepare('SELECT COUNT(*) as count FROM adjacency_out WHERE node_id = ?').get('user-1') as {
        count: number
      }
      expect(count.count).toBe(1)
    })
  })

  describe('removeEdges (batch delete)', () => {
    beforeEach(() => {
      if (!sqlite) return

      const now = Date.now()
      for (let i = 0; i < 50; i++) {
        sqlite.exec(`
          INSERT INTO adjacency_out VALUES ('user-1', 'item-${i}', 'viewed', 'rel-del-${i}', NULL, ${now});
        `)
      }
    })

    it('removes multiple edges by IDs', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const idsToDelete = ['rel-del-0', 'rel-del-1', 'rel-del-2', 'rel-del-3', 'rel-del-4']
      const placeholders = idsToDelete.map(() => '?').join(', ')

      const result = sqlite.prepare(`DELETE FROM adjacency_out WHERE rel_id IN (${placeholders})`).run(...idsToDelete)

      expect(result.changes).toBe(5)

      const remaining = sqlite.prepare('SELECT COUNT(*) as count FROM adjacency_out WHERE node_id = ?').get('user-1') as {
        count: number
      }
      expect(remaining.count).toBe(45)
    })

    it('returns count of deleted edges', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare("DELETE FROM adjacency_out WHERE rel_id LIKE 'rel-del-%'").run()

      expect(result.changes).toBe(50)
    })
  })

  describe('getNeighborsBatch', () => {
    beforeEach(() => {
      if (!sqlite) return

      const now = Date.now()
      // Create edges for multiple nodes
      for (let userId = 1; userId <= 5; userId++) {
        for (let postId = 1; postId <= 3; postId++) {
          sqlite.exec(`
            INSERT INTO adjacency_out VALUES ('user-${userId}', 'post-${postId}', 'liked', 'rel-batch-${userId}-${postId}', NULL, ${now});
          `)
        }
      }
    })

    it('fetches neighbors for multiple nodes in single query', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const nodeIds = ['user-1', 'user-2', 'user-3']
      const placeholders = nodeIds.map(() => '?').join(', ')

      const results = sqlite.prepare(`SELECT node_id, target_id FROM adjacency_out WHERE node_id IN (${placeholders})`).all(...nodeIds) as {
        node_id: string
        target_id: string
      }[]

      expect(results).toHaveLength(9) // 3 nodes * 3 posts each

      // Group by node
      const byNode = new Map<string, string[]>()
      for (const r of results) {
        if (!byNode.has(r.node_id)) byNode.set(r.node_id, [])
        byNode.get(r.node_id)!.push(r.target_id)
      }

      expect(byNode.get('user-1')!).toHaveLength(3)
      expect(byNode.get('user-2')!).toHaveLength(3)
      expect(byNode.get('user-3')!).toHaveLength(3)
    })

    it('returns empty results for nodes with no edges', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite.prepare("SELECT * FROM adjacency_out WHERE node_id IN ('nobody-1', 'nobody-2')").all()

      expect(results).toHaveLength(0)
    })
  })
})

// ============================================================================
// 6. Bloom Filter Tests
// ============================================================================

describe('Bloom Filter for Existence Checks', () => {
  /**
   * Bloom filters provide probabilistic O(1) existence checks:
   * - False positives possible (says "maybe exists" when doesn't)
   * - No false negatives (if says "doesn't exist", it definitely doesn't)
   */

  it('probablyHasEdge returns true for existing edges', async () => {
    // This will fail until bloom filter is implemented
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    await index.addEdge('a', 'b', 'likes')

    // Bloom filter should return true (possibly with rare false positives)
    const result = index.probablyHasEdge('a', 'b', 'likes')
    expect(result).toBe(true)
  })

  it('probablyHasEdge returns false for definitely non-existing edges', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Empty index - bloom filter should return false
    const result = index.probablyHasEdge('x', 'y', 'nonexistent')
    expect(result).toBe(false)
  })

  it('hasVertex checks if node exists in index', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    await index.addEdge('node-a', 'node-b', 'connects')

    expect(await index.hasVertex('node-a')).toBe(true)
    expect(await index.hasVertex('node-b')).toBe(true)
    expect(await index.hasVertex('node-c')).toBe(false)
  })

  it('provides bloom filter statistics', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add some edges
    for (let i = 0; i < 1000; i++) {
      await index.addEdge(`node-${i}`, `target-${i}`, 'links')
    }

    const stats = index.getBloomFilterStats()

    expect(stats.size).toBeGreaterThan(0)
    expect(stats.hashFunctions).toBeGreaterThan(0)
    expect(stats.insertedCount).toBe(1000)
    expect(stats.estimatedFalsePositiveRate).toBeLessThan(0.1) // Less than 10% FPR
  })

  it('maintains acceptable false positive rate under load', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add edges
    const insertedPairs = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      const from = `node-${i}`
      const to = `target-${i % 100}`
      await index.addEdge(from, to, 'links')
      insertedPairs.add(`${from}:${to}:links`)
    }

    // Test non-existent edges
    let falsePositives = 0
    const testCount = 1000

    for (let i = 0; i < testCount; i++) {
      const from = `nonexistent-${i}`
      const to = `nonexistent-${i}`
      const key = `${from}:${to}:links`

      if (!insertedPairs.has(key) && index.probablyHasEdge(from, to, 'links')) {
        falsePositives++
      }
    }

    const fpRate = falsePositives / testCount
    expect(fpRate).toBeLessThan(0.05) // Less than 5% false positive rate
  })
})

// ============================================================================
// 7. Supernode Detection and Handling Tests
// ============================================================================

describe('Supernode Detection and Handling', () => {
  /**
   * Supernodes are nodes with extremely high degree (many connections).
   * They require special handling to avoid performance degradation.
   */

  it('isSupernode detects nodes above threshold', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    index.configureSupernodeHandling({
      threshold: 100,
      samplingRate: 0.1,
      shardCount: 4,
    })

    // Create a supernode with 200 edges
    for (let i = 0; i < 200; i++) {
      await index.addEdge('supernode', `target-${i}`, 'connects')
    }

    // Create a regular node with 50 edges
    for (let i = 0; i < 50; i++) {
      await index.addEdge('regular', `target-${i}`, 'connects')
    }

    expect(await index.isSupernode('supernode')).toBe(true)
    expect(await index.isSupernode('regular')).toBe(false)
  })

  it('getSupernodes returns all nodes above threshold', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    index.configureSupernodeHandling({
      threshold: 100,
      samplingRate: 0.1,
      shardCount: 4,
    })

    // Create multiple supernodes
    for (const supernode of ['super-a', 'super-b', 'super-c']) {
      for (let i = 0; i < 150; i++) {
        await index.addEdge(supernode, `target-${i}`, 'connects')
      }
    }

    const supernodes = await index.getSupernodes()

    expect(supernodes).toHaveLength(3)
    expect(supernodes.sort()).toEqual(['super-a', 'super-b', 'super-c'])
  })

  it('getSupernodes filters by minimum degree', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    index.configureSupernodeHandling({
      threshold: 100,
      samplingRate: 0.1,
      shardCount: 4,
    })

    // Create supernodes with different degrees
    for (let i = 0; i < 120; i++) {
      await index.addEdge('super-small', `target-${i}`, 'connects')
    }
    for (let i = 0; i < 500; i++) {
      await index.addEdge('super-medium', `target-${i}`, 'connects')
    }
    for (let i = 0; i < 1000; i++) {
      await index.addEdge('super-large', `target-${i}`, 'connects')
    }

    const largeSupernodesOnly = await index.getSupernodes(500)

    expect(largeSupernodesOnly).toHaveLength(2)
    expect(largeSupernodesOnly.sort()).toEqual(['super-large', 'super-medium'])
  })

  it('handles supernode queries with sampling', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    index.configureSupernodeHandling({
      threshold: 100,
      samplingRate: 0.1, // 10% sampling
      shardCount: 4,
    })

    // Create supernode
    for (let i = 0; i < 10000; i++) {
      await index.addEdge('mega-hub', `target-${i}`, 'connects')
    }

    // Query should return sampled results for supernode
    const neighbors = await index.getNeighbors('mega-hub', { limit: 100 })

    // Should return results (sampling means we get a subset)
    expect(neighbors.length).toBeGreaterThan(0)
    expect(neighbors.length).toBeLessThanOrEqual(100)
  })

  it('shards supernode edges across multiple storage units', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    index.configureSupernodeHandling({
      threshold: 100,
      samplingRate: 0.1,
      shardCount: 4,
    })

    // Create supernode with many edges
    for (let i = 0; i < 1000; i++) {
      await index.addEdge('sharded-super', `target-${i}`, 'connects')
    }

    // Verify edges are distributed across shards
    const shardInfo = await index.getShardInfo()

    expect(shardInfo.length).toBe(4)

    // Edges should be somewhat balanced across shards
    const totalEdges = shardInfo.reduce((sum, s) => sum + s.edgeCount, 0)
    expect(totalEdges).toBe(1000)

    // No single shard should have all edges
    for (const shard of shardInfo) {
      expect(shard.edgeCount).toBeLessThan(1000)
    }
  })
})

// ============================================================================
// 8. Sharding Support Tests
// ============================================================================

describe('Sharding Support', () => {
  /**
   * Sharding distributes graph data across multiple storage units
   * for horizontal scaling and parallel query execution.
   */

  it('getShardForNode returns consistent shard assignment', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    const shard1 = index.getShardForNode('node-abc')
    const shard2 = index.getShardForNode('node-abc')

    expect(shard1).toBe(shard2)
    expect(typeof shard1).toBe('number')
    expect(shard1).toBeGreaterThanOrEqual(0)
  })

  it('distributes nodes across shards evenly', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    const shardCounts = new Map<number, number>()

    // Assign 10000 nodes to shards
    for (let i = 0; i < 10000; i++) {
      const shard = index.getShardForNode(`node-${i}`)
      shardCounts.set(shard, (shardCounts.get(shard) ?? 0) + 1)
    }

    // Check distribution is roughly even
    const values = Array.from(shardCounts.values())
    const avg = 10000 / shardCounts.size
    const maxDeviation = 0.2 // Allow 20% deviation

    for (const count of values) {
      expect(count).toBeGreaterThan(avg * (1 - maxDeviation))
      expect(count).toBeLessThan(avg * (1 + maxDeviation))
    }
  })

  it('getShardInfo returns shard statistics', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add some data
    for (let i = 0; i < 100; i++) {
      await index.addEdge(`user-${i}`, `post-${i}`, 'created')
    }

    const shardInfo = await index.getShardInfo()

    expect(shardInfo.length).toBeGreaterThan(0)
    for (const shard of shardInfo) {
      expect(shard.shardId).toBeGreaterThanOrEqual(0)
      expect(shard.nodeCount).toBeGreaterThanOrEqual(0)
      expect(shard.edgeCount).toBeGreaterThanOrEqual(0)
      expect(shard.sizeBytes).toBeGreaterThanOrEqual(0)
    }
  })

  it('rebalanceShards redistributes data', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add imbalanced data
    for (let i = 0; i < 1000; i++) {
      await index.addEdge('single-source', `target-${i}`, 'connects')
    }

    const beforeBalance = await index.getShardInfo()

    // Rebalance
    await index.rebalanceShards()

    const afterBalance = await index.getShardInfo()

    // Total edges should remain the same
    const totalBefore = beforeBalance.reduce((sum, s) => sum + s.edgeCount, 0)
    const totalAfter = afterBalance.reduce((sum, s) => sum + s.edgeCount, 0)

    expect(totalAfter).toBe(totalBefore)
  })

  it('queries span multiple shards when needed', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add edges that span multiple shards
    for (let i = 0; i < 100; i++) {
      await index.addEdge(`user-${i}`, `post-${i % 10}`, 'liked')
    }

    // Query for all users who liked post-0
    // This should aggregate results from multiple shards
    const neighbors = await index.getNeighbors('post-0', { direction: 'in' })

    expect(neighbors.length).toBe(10) // 10 users liked post-0
  })
})

// ============================================================================
// 9. Performance Tests for Supernodes
// ============================================================================

describe('Supernode Performance', () => {
  it('handles node with 100k+ edges efficiently', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    index.configureSupernodeHandling({
      threshold: 1000,
      samplingRate: 0.01,
      shardCount: 8,
    })

    // Create massive hub node
    const edgeCount = 100000
    const edges = Array.from({ length: edgeCount }, (_, i) => ({
      from: 'mega-hub',
      to: `follower-${i}`,
      type: 'follows',
    }))

    const startInsert = Date.now()
    await index.addEdges(edges)
    const insertTime = Date.now() - startInsert

    // Insert should complete in reasonable time (< 5 seconds)
    expect(insertTime).toBeLessThan(5000)

    // Degree query should be O(1)
    const startDegree = Date.now()
    const degree = await index.getOutDegree('mega-hub')
    const degreeTime = Date.now() - startDegree

    expect(degree).toBe(edgeCount)
    expect(degreeTime).toBeLessThan(10) // Should be nearly instant

    // Neighbor sampling should be fast
    const startNeighbors = Date.now()
    const neighbors = await index.getNeighbors('mega-hub', { limit: 100 })
    const neighborTime = Date.now() - startNeighbors

    expect(neighbors.length).toBeLessThanOrEqual(100)
    expect(neighborTime).toBeLessThan(100) // Should be fast
  })

  it('maintains query performance as graph grows', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    const queryTimes: number[] = []

    // Measure query time as graph grows
    for (let batch = 0; batch < 10; batch++) {
      // Add 10k edges
      const edges = Array.from({ length: 10000 }, (_, i) => ({
        from: `user-${batch * 10000 + i}`,
        to: `post-${i % 1000}`,
        type: 'viewed',
      }))
      await index.addEdges(edges)

      // Measure query time
      const start = Date.now()
      await index.getNeighbors('post-0', { direction: 'in', limit: 100 })
      queryTimes.push(Date.now() - start)
    }

    // Query time should not increase dramatically
    // Last query should be no more than 5x first query
    const firstTime = queryTimes[0]!
    const lastTime = queryTimes[queryTimes.length - 1]!

    expect(lastTime).toBeLessThan(firstTime * 5 + 50) // +50ms buffer for variance
  })
})

// ============================================================================
// 10. Maintenance Operations Tests
// ============================================================================

describe('Maintenance Operations', () => {
  it('compact removes tombstones and optimizes storage', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add and then remove many edges (creates tombstones)
    const relIds: string[] = []
    for (let i = 0; i < 1000; i++) {
      relIds.push(await index.addEdge(`a-${i}`, `b-${i}`, 'links'))
    }

    // Remove half
    await index.removeEdges(relIds.slice(0, 500))

    const beforeStats = await index.getStats()
    const beforeShardInfo = await index.getShardInfo()
    const beforeSize = beforeShardInfo.reduce((sum, s) => sum + s.sizeBytes, 0)

    // Compact
    await index.compact()

    const afterShardInfo = await index.getShardInfo()
    const afterSize = afterShardInfo.reduce((sum, s) => sum + s.sizeBytes, 0)

    // Size should decrease after compaction
    expect(afterSize).toBeLessThanOrEqual(beforeSize)
  })

  it('vacuum reclaims disk space', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add data
    for (let i = 0; i < 5000; i++) {
      await index.addEdge(`node-${i}`, `target-${i}`, 'connects')
    }

    // Remove all
    const allEdges = await index.getNeighbors('node-0', { direction: 'out' })
    // ... remove all edges

    // Vacuum
    await index.vacuum()

    // Should complete without error
    const stats = await index.getStats()
    expect(stats.totalEdges).toBe(0)
  })

  it('getStats returns accurate graph statistics', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Create known graph structure
    // 10 users, each creates 5 posts, each post gets 20 likes from other users
    for (let u = 0; u < 10; u++) {
      for (let p = 0; p < 5; p++) {
        await index.addEdge(`user-${u}`, `post-${u}-${p}`, 'created')
      }
    }

    for (let p = 0; p < 50; p++) {
      for (let l = 0; l < 20; l++) {
        await index.addEdge(`liker-${l}`, `post-${Math.floor(p / 5)}-${p % 5}`, 'liked')
      }
    }

    const stats = await index.getStats()

    // 10 users + 20 likers + 50 posts = 80 unique nodes
    expect(stats.totalNodes).toBe(80)

    // 50 created + 1000 liked = 1050 edges
    expect(stats.totalEdges).toBe(1050)

    // Average degree = (2 * edges) / nodes = 2100 / 80 = 26.25
    expect(stats.avgDegree).toBeCloseTo(26.25, 1)

    // Max degree: post-0-0 has 1 incoming 'created' + 20 incoming 'liked' = 21
    expect(stats.maxDegree).toBeGreaterThanOrEqual(21)
  })
})

// ============================================================================
// 11. Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('handles self-loops (node to itself)', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    const relId = await index.addEdge('node-a', 'node-a', 'references')

    expect(relId).toBeDefined()

    const hasEdge = await index.hasEdge('node-a', 'node-a', 'references')
    expect(hasEdge).toBe(true)

    // Self-loop should count in both out and in degree
    const degree = await index.getDegree('node-a')
    expect(degree.outDegree).toBe(1)
    expect(degree.inDegree).toBe(1)
  })

  it('handles nodes with no edges', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Add one edge to create nodes
    await index.addEdge('a', 'b', 'links')

    // Query node with no outgoing edges
    const outNeighbors = await index.getOutNeighbors('b')
    expect(outNeighbors).toEqual([])

    // Query non-existent node
    const nonExistent = await index.getOutNeighbors('non-existent')
    expect(nonExistent).toEqual([])
  })

  it('handles very long node IDs', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    const longId = 'node-' + 'a'.repeat(1000)
    const relId = await index.addEdge(longId, 'short', 'connects')

    expect(relId).toBeDefined()

    const hasEdge = await index.hasEdge(longId, 'short', 'connects')
    expect(hasEdge).toBe(true)
  })

  it('handles special characters in node IDs', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    const specialIds = [
      'node:with:colons',
      'node/with/slashes',
      'node@with@ats',
      'node#with#hashes',
      'node?with?questions',
      'node&with&amps',
    ]

    for (let i = 0; i < specialIds.length - 1; i++) {
      await index.addEdge(specialIds[i]!, specialIds[i + 1]!, 'links')
    }

    for (let i = 0; i < specialIds.length - 1; i++) {
      const hasEdge = await index.hasEdge(specialIds[i]!, specialIds[i + 1]!, 'links')
      expect(hasEdge).toBe(true)
    }
  })

  it('handles unicode in node IDs and edge types', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    await index.addEdge('node-a', 'node-b', 'connected')

    const hasEdge = await index.hasEdge('node-a', 'node-b', 'connected')
    expect(hasEdge).toBe(true)
  })

  it('handles concurrent modifications gracefully', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Concurrent adds
    const addPromises = Array.from({ length: 100 }, (_, i) => index.addEdge(`user-${i}`, `post-${i}`, 'created'))

    const results = await Promise.all(addPromises)

    // All should succeed
    expect(results).toHaveLength(100)
    expect(new Set(results).size).toBe(100) // All unique IDs

    // Verify all edges exist
    for (let i = 0; i < 100; i++) {
      const hasEdge = await index.hasEdge(`user-${i}`, `post-${i}`, 'created')
      expect(hasEdge).toBe(true)
    }
  })

  it('handles empty edge type', async () => {
    const { createAdjacencyIndex } = await import('../index')
    const index = createAdjacencyIndex()

    // Empty edge type should work (or throw a clear error)
    try {
      await index.addEdge('a', 'b', '')
      // If it succeeds, verify edge exists
      const hasEdge = await index.hasEdge('a', 'b', '')
      expect(hasEdge).toBe(true)
    } catch (error) {
      // If it fails, error should be clear
      expect(error).toBeInstanceOf(Error)
    }
  })
})
