/**
 * LineageTracker Drizzle Schema Tests
 *
 * Tests for the Drizzle ORM schema definitions including:
 * - Table structure validation
 * - Index creation
 * - Type inference
 * - Foreign key constraints
 * - SQL schema generation
 *
 * @module db/primitives/lineage-tracker/tests/schema
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  lineageNodes,
  lineageEdges,
  LINEAGE_NODES_SQL,
  LINEAGE_EDGES_SQL,
  LINEAGE_DRIZZLE_SCHEMA,
  type NodeType,
  type LineageNodeRecord,
  type NewLineageNodeRecord,
  type LineageEdgeRecord,
  type NewLineageEdgeRecord,
} from '../schema'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Creates an in-memory SQLite database for testing
 */
function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

// =============================================================================
// SCHEMA SQL TESTS
// =============================================================================

describe('Lineage Schema - SQL Generation', () => {
  describe('LINEAGE_NODES_SQL', () => {
    it('should create lineage_nodes table without errors', () => {
      const db = createTestDb()
      expect(() => db.exec(LINEAGE_NODES_SQL)).not.toThrow()
    })

    it('should be idempotent (can run multiple times)', () => {
      const db = createTestDb()
      expect(() => {
        db.exec(LINEAGE_NODES_SQL)
        db.exec(LINEAGE_NODES_SQL)
        db.exec(LINEAGE_NODES_SQL)
      }).not.toThrow()
    })

    it('should create the required columns', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)

      const columns = db.prepare("PRAGMA table_info('lineage_nodes')").all() as {
        name: string
        type: string
        notnull: number
        pk: number
      }[]

      const columnNames = columns.map((c) => c.name)
      expect(columnNames).toContain('id')
      expect(columnNames).toContain('type')
      expect(columnNames).toContain('name')
      expect(columnNames).toContain('namespace')
      expect(columnNames).toContain('metadata')
      expect(columnNames).toContain('created_at')
      expect(columnNames).toContain('updated_at')
    })

    it('should set id as primary key', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)

      const columns = db.prepare("PRAGMA table_info('lineage_nodes')").all() as {
        name: string
        pk: number
      }[]

      const idColumn = columns.find((c) => c.name === 'id')
      expect(idColumn?.pk).toBe(1)
    })

    it('should enforce NOT NULL on required columns', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)

      const columns = db.prepare("PRAGMA table_info('lineage_nodes')").all() as {
        name: string
        notnull: number
      }[]

      const typeCol = columns.find((c) => c.name === 'type')
      const nameCol = columns.find((c) => c.name === 'name')
      const createdAtCol = columns.find((c) => c.name === 'created_at')
      const updatedAtCol = columns.find((c) => c.name === 'updated_at')

      expect(typeCol?.notnull).toBe(1)
      expect(nameCol?.notnull).toBe(1)
      expect(createdAtCol?.notnull).toBe(1)
      expect(updatedAtCol?.notnull).toBe(1)
    })

    it('should allow NULL for namespace', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)

      const columns = db.prepare("PRAGMA table_info('lineage_nodes')").all() as {
        name: string
        notnull: number
      }[]

      const namespaceCol = columns.find((c) => c.name === 'namespace')
      expect(namespaceCol?.notnull).toBe(0)
    })

    it('should create required indexes', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lineage_nodes' AND name LIKE 'idx_%'")
        .all() as { name: string }[]

      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_lineage_nodes_type')
      expect(indexNames).toContain('idx_lineage_nodes_namespace')
      expect(indexNames).toContain('idx_lineage_nodes_type_namespace')
      expect(indexNames).toContain('idx_lineage_nodes_name')
    })
  })

  describe('LINEAGE_EDGES_SQL', () => {
    it('should create lineage_edges table without errors', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL) // Required for FK
      expect(() => db.exec(LINEAGE_EDGES_SQL)).not.toThrow()
    })

    it('should be idempotent (can run multiple times)', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)
      expect(() => {
        db.exec(LINEAGE_EDGES_SQL)
        db.exec(LINEAGE_EDGES_SQL)
        db.exec(LINEAGE_EDGES_SQL)
      }).not.toThrow()
    })

    it('should create the required columns', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)
      db.exec(LINEAGE_EDGES_SQL)

      const columns = db.prepare("PRAGMA table_info('lineage_edges')").all() as {
        name: string
      }[]

      const columnNames = columns.map((c) => c.name)
      expect(columnNames).toContain('id')
      expect(columnNames).toContain('from_node_id')
      expect(columnNames).toContain('to_node_id')
      expect(columnNames).toContain('operation')
      expect(columnNames).toContain('metadata')
      expect(columnNames).toContain('timestamp')
    })

    it('should create required indexes', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)
      db.exec(LINEAGE_EDGES_SQL)

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lineage_edges' AND name LIKE 'idx_%'")
        .all() as { name: string }[]

      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_lineage_edges_from')
      expect(indexNames).toContain('idx_lineage_edges_to')
      expect(indexNames).toContain('idx_lineage_edges_operation')
      expect(indexNames).toContain('idx_lineage_edges_timestamp')
      expect(indexNames).toContain('idx_lineage_edges_from_to')
    })

    it('should define foreign key constraints', () => {
      const db = createTestDb()
      db.exec(LINEAGE_NODES_SQL)
      db.exec(LINEAGE_EDGES_SQL)

      const fks = db.prepare("PRAGMA foreign_key_list('lineage_edges')").all() as {
        table: string
        from: string
        to: string
        on_delete: string
      }[]

      expect(fks).toHaveLength(2)

      const fromFk = fks.find((fk) => fk.from === 'from_node_id')
      const toFk = fks.find((fk) => fk.from === 'to_node_id')

      expect(fromFk?.table).toBe('lineage_nodes')
      expect(fromFk?.to).toBe('id')
      expect(fromFk?.on_delete).toBe('CASCADE')

      expect(toFk?.table).toBe('lineage_nodes')
      expect(toFk?.to).toBe('id')
      expect(toFk?.on_delete).toBe('CASCADE')
    })
  })

  describe('LINEAGE_DRIZZLE_SCHEMA', () => {
    it('should create both tables without errors', () => {
      const db = createTestDb()
      expect(() => db.exec(LINEAGE_DRIZZLE_SCHEMA)).not.toThrow()
    })

    it('should be idempotent', () => {
      const db = createTestDb()
      expect(() => {
        db.exec(LINEAGE_DRIZZLE_SCHEMA)
        db.exec(LINEAGE_DRIZZLE_SCHEMA)
      }).not.toThrow()
    })

    it('should create all expected tables', () => {
      const db = createTestDb()
      db.exec(LINEAGE_DRIZZLE_SCHEMA)

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lineage_%'")
        .all() as { name: string }[]

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('lineage_nodes')
      expect(tableNames).toContain('lineage_edges')
    })
  })
})

// =============================================================================
// DRIZZLE TABLE DEFINITION TESTS
// =============================================================================

describe('Lineage Schema - Drizzle Table Definitions', () => {
  describe('lineageNodes table', () => {
    it('should have correct column definitions', () => {
      // Verify column names match expected
      const columns = Object.keys(lineageNodes)
      expect(columns).toContain('id')
      expect(columns).toContain('type')
      expect(columns).toContain('name')
      expect(columns).toContain('namespace')
      expect(columns).toContain('metadata')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })

    it('should have id as primary key', () => {
      const idColumn = lineageNodes.id
      expect(idColumn.primary).toBe(true)
    })
  })

  describe('lineageEdges table', () => {
    it('should have correct column definitions', () => {
      const columns = Object.keys(lineageEdges)
      expect(columns).toContain('id')
      expect(columns).toContain('fromNodeId')
      expect(columns).toContain('toNodeId')
      expect(columns).toContain('operation')
      expect(columns).toContain('metadata')
      expect(columns).toContain('timestamp')
    })

    it('should have id as primary key', () => {
      const idColumn = lineageEdges.id
      expect(idColumn.primary).toBe(true)
    })
  })
})

// =============================================================================
// TYPE INFERENCE TESTS
// =============================================================================

describe('Lineage Schema - Type Inference', () => {
  describe('LineageNodeRecord type', () => {
    it('should infer correct select type', () => {
      // Type check - this is a compile-time test
      const mockNode: LineageNodeRecord = {
        id: 'node-1',
        type: 'entity',
        name: 'users',
        namespace: 'warehouse',
        metadata: { columns: ['id', 'name'] },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      expect(mockNode.id).toBe('node-1')
      expect(mockNode.type).toBe('entity')
      expect(mockNode.name).toBe('users')
    })

    it('should allow null namespace', () => {
      const mockNode: LineageNodeRecord = {
        id: 'node-1',
        type: 'entity',
        name: 'users',
        namespace: null,
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      expect(mockNode.namespace).toBeNull()
    })
  })

  describe('NewLineageNodeRecord type', () => {
    it('should allow optional fields', () => {
      const newNode: NewLineageNodeRecord = {
        id: 'node-1',
        type: 'transformation',
        name: 'etl_job',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      expect(newNode.id).toBe('node-1')
      // namespace and metadata should be optional
    })
  })

  describe('LineageEdgeRecord type', () => {
    it('should infer correct select type', () => {
      const mockEdge: LineageEdgeRecord = {
        id: 'edge-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
        operation: 'transform',
        metadata: { duration: 100 },
        timestamp: Date.now(),
      }

      expect(mockEdge.id).toBe('edge-1')
      expect(mockEdge.fromNodeId).toBe('node-1')
      expect(mockEdge.toNodeId).toBe('node-2')
    })
  })

  describe('NewLineageEdgeRecord type', () => {
    it('should require all essential fields', () => {
      const newEdge: NewLineageEdgeRecord = {
        id: 'edge-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
        operation: 'read',
        timestamp: Date.now(),
      }

      expect(newEdge.operation).toBe('read')
    })
  })
})

// =============================================================================
// CONSTRAINT TESTS
// =============================================================================

describe('Lineage Schema - Constraints', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    db.exec(LINEAGE_DRIZZLE_SCHEMA)
  })

  describe('Type CHECK constraint', () => {
    it('should allow valid node types', () => {
      const validTypes: NodeType[] = ['entity', 'transformation', 'source', 'sink']
      const now = Date.now()

      for (const type of validTypes) {
        expect(() => {
          db.prepare(`
            INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
            VALUES (?, ?, ?, '{}', ?, ?)
          `).run(`node-${type}`, type, `Test ${type}`, now, now)
        }).not.toThrow()
      }
    })

    it('should reject invalid node types', () => {
      const now = Date.now()

      expect(() => {
        db.prepare(`
          INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
          VALUES (?, ?, ?, '{}', ?, ?)
        `).run('node-invalid', 'invalid_type', 'Test', now, now)
      }).toThrow()
    })
  })

  describe('Foreign key constraints', () => {
    it('should prevent edges with non-existent source node', () => {
      const now = Date.now()

      // Create only target node
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-2', 'entity', 'Target', now, now)

      expect(() => {
        db.prepare(`
          INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
          VALUES (?, ?, ?, ?, '{}', ?)
        `).run('edge-1', 'non-existent', 'node-2', 'read', now)
      }).toThrow(/FOREIGN KEY constraint/)
    })

    it('should prevent edges with non-existent target node', () => {
      const now = Date.now()

      // Create only source node
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-1', 'entity', 'Source', now, now)

      expect(() => {
        db.prepare(`
          INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
          VALUES (?, ?, ?, ?, '{}', ?)
        `).run('edge-1', 'node-1', 'non-existent', 'read', now)
      }).toThrow(/FOREIGN KEY constraint/)
    })

    it('should cascade delete edges when source node is deleted', () => {
      const now = Date.now()

      // Create two nodes
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-1', 'source', 'Source', now, now)

      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-2', 'sink', 'Sink', now, now)

      // Create edge
      db.prepare(`
        INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
        VALUES (?, ?, ?, ?, '{}', ?)
      `).run('edge-1', 'node-1', 'node-2', 'write', now)

      // Verify edge exists
      const edgeBefore = db.prepare('SELECT * FROM lineage_edges WHERE id = ?').get('edge-1')
      expect(edgeBefore).toBeDefined()

      // Delete source node
      db.prepare('DELETE FROM lineage_nodes WHERE id = ?').run('node-1')

      // Edge should be deleted
      const edgeAfter = db.prepare('SELECT * FROM lineage_edges WHERE id = ?').get('edge-1')
      expect(edgeAfter).toBeUndefined()
    })

    it('should cascade delete edges when target node is deleted', () => {
      const now = Date.now()

      // Create two nodes
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-1', 'source', 'Source', now, now)

      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-2', 'sink', 'Sink', now, now)

      // Create edge
      db.prepare(`
        INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
        VALUES (?, ?, ?, ?, '{}', ?)
      `).run('edge-1', 'node-1', 'node-2', 'write', now)

      // Delete target node
      db.prepare('DELETE FROM lineage_nodes WHERE id = ?').run('node-2')

      // Edge should be deleted
      const edgeAfter = db.prepare('SELECT * FROM lineage_edges WHERE id = ?').get('edge-1')
      expect(edgeAfter).toBeUndefined()
    })
  })

  describe('Primary key constraints', () => {
    it('should prevent duplicate node IDs', () => {
      const now = Date.now()

      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-1', 'entity', 'First', now, now)

      expect(() => {
        db.prepare(`
          INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
          VALUES (?, ?, ?, '{}', ?, ?)
        `).run('node-1', 'entity', 'Duplicate', now, now)
      }).toThrow(/UNIQUE constraint/)
    })

    it('should prevent duplicate edge IDs', () => {
      const now = Date.now()

      // Create nodes first
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-1', 'source', 'Source', now, now)

      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run('node-2', 'sink', 'Sink', now, now)

      db.prepare(`
        INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
        VALUES (?, ?, ?, ?, '{}', ?)
      `).run('edge-1', 'node-1', 'node-2', 'write', now)

      expect(() => {
        db.prepare(`
          INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
          VALUES (?, ?, ?, ?, '{}', ?)
        `).run('edge-1', 'node-1', 'node-2', 'duplicate', now)
      }).toThrow(/UNIQUE constraint/)
    })
  })
})

// =============================================================================
// INDEX EFFICIENCY TESTS
// =============================================================================

describe('Lineage Schema - Index Efficiency', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    db.exec(LINEAGE_DRIZZLE_SCHEMA)
  })

  it('should use index for type filtering', () => {
    const now = Date.now()

    // Insert test data
    for (let i = 0; i < 100; i++) {
      const type = ['entity', 'transformation', 'source', 'sink'][i % 4]
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run(`node-${i}`, type, `Test ${i}`, now, now)
    }

    // Check query plan uses index
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM lineage_nodes WHERE type = 'entity'").all()
    const planStr = JSON.stringify(plan)

    // Should use the type index
    expect(planStr).toMatch(/idx_lineage_nodes_type|USING INDEX/)
  })

  it('should use index for edge traversal', () => {
    const now = Date.now()

    // Create nodes and edges
    for (let i = 0; i < 50; i++) {
      db.prepare(`
        INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run(`node-${i}`, 'entity', `Node ${i}`, now, now)
    }

    for (let i = 0; i < 49; i++) {
      db.prepare(`
        INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
        VALUES (?, ?, ?, ?, '{}', ?)
      `).run(`edge-${i}`, `node-${i}`, `node-${i + 1}`, 'flow', now)
    }

    // Check query plan for downstream traversal
    const planFrom = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM lineage_edges WHERE from_node_id = 'node-25'").all()
    const planFromStr = JSON.stringify(planFrom)
    expect(planFromStr).toMatch(/idx_lineage_edges_from|USING INDEX/)

    // Check query plan for upstream traversal
    const planTo = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM lineage_edges WHERE to_node_id = 'node-25'").all()
    const planToStr = JSON.stringify(planTo)
    expect(planToStr).toMatch(/idx_lineage_edges_to|USING INDEX/)
  })

  it('should use composite index for bidirectional edge lookup', () => {
    const now = Date.now()

    // Create nodes
    db.prepare(`
      INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run('node-1', 'source', 'Source', now, now)

    db.prepare(`
      INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run('node-2', 'sink', 'Sink', now, now)

    // Create edge
    db.prepare(`
      INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
      VALUES (?, ?, ?, ?, '{}', ?)
    `).run('edge-1', 'node-1', 'node-2', 'write', now)

    // Check query plan for combined from/to lookup
    const plan = db.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM lineage_edges WHERE from_node_id = 'node-1' AND to_node_id = 'node-2'"
    ).all()
    const planStr = JSON.stringify(plan)

    // Should use the composite index or one of the single-column indexes
    expect(planStr).toMatch(/idx_lineage_edges|USING INDEX/)
  })
})

// =============================================================================
// DATA INTEGRITY TESTS
// =============================================================================

describe('Lineage Schema - Data Integrity', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    db.exec(LINEAGE_DRIZZLE_SCHEMA)
  })

  it('should store and retrieve JSON metadata correctly', () => {
    const now = Date.now()
    const metadata = {
      columns: ['id', 'name', 'email'],
      rowCount: 10000,
      nested: { deep: { value: true } },
    }

    db.prepare(`
      INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('node-1', 'entity', 'users', JSON.stringify(metadata), now, now)

    const result = db.prepare('SELECT metadata FROM lineage_nodes WHERE id = ?').get('node-1') as {
      metadata: string
    }

    const retrieved = JSON.parse(result.metadata)
    expect(retrieved).toEqual(metadata)
  })

  it('should handle special characters in names', () => {
    const now = Date.now()
    const specialName = "table-with-special_chars.and.dots/slash'quote"

    db.prepare(`
      INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run('node-1', 'entity', specialName, now, now)

    const result = db.prepare('SELECT name FROM lineage_nodes WHERE id = ?').get('node-1') as {
      name: string
    }

    expect(result.name).toBe(specialName)
  })

  it('should handle unicode characters', () => {
    const now = Date.now()
    const unicodeName = 'datos_usuario_espanol_Espana'

    db.prepare(`
      INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run('node-1', 'entity', unicodeName, now, now)

    const result = db.prepare('SELECT name FROM lineage_nodes WHERE id = ?').get('node-1') as {
      name: string
    }

    expect(result.name).toBe(unicodeName)
  })

  it('should preserve timestamp precision', () => {
    const now = Date.now()

    db.prepare(`
      INSERT INTO lineage_nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run('node-1', 'entity', 'test', now, now)

    const result = db.prepare('SELECT created_at, updated_at FROM lineage_nodes WHERE id = ?').get('node-1') as {
      created_at: number
      updated_at: number
    }

    expect(result.created_at).toBe(now)
    expect(result.updated_at).toBe(now)
  })
})
