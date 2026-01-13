/**
 * Backward Insert (<-) Operator Tests with Real SQLite
 *
 * TDD RED Phase: Comprehensive failing tests for the Backward Insert cascade operator.
 *
 * Issue: dotdo-1mc8e
 *
 * The backward insert operator (<-) generates NEW target entities that link FROM target TO this
 * (reverse direction from forward operators).
 *
 * Key behaviors tested:
 * 1. Backward relationship creation (A <- B means B points to A)
 * 2. SQLite storage of backward relationships
 * 3. Query traversal in backward direction
 * 4. Integrity with bidirectional relationships
 * 5. Verb derivation: manages -> managedBy, owns -> ownedBy
 * 6. Backref field syntax: `<-Order.customer` sets Order.customer = this.$id
 *
 * These tests FAIL because:
 * - BackwardInsertExecutor doesn't exist yet
 * - The full SQLite integration for persisting backward cascade results isn't implemented
 *
 * NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// These imports will FAIL because the executor doesn't exist
// This is intentional - RED phase of TDD
import { BackwardInsertExecutor } from '../../graph/executors/backward-insert'
import type { ThingStore, RelationshipStore } from '../../graph/stores/types'

// ============================================================================
// Test Types
// ============================================================================

interface Thing {
  id: string
  type: string
  data: Record<string, unknown>
  created_at: number
  updated_at: number
}

interface Relationship {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  created_at: number
}

// ============================================================================
// 1. Backward Relationship Creation (A <- B means B points to A)
// ============================================================================

describe('Backward Insert (<-) Operator - Relationship Direction', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    // Create schema
    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(verb, "from", "to")
      );

      CREATE INDEX idx_rel_from ON relationships("from");
      CREATE INDEX idx_rel_to ON relationships("to");
      CREATE INDEX idx_rel_verb ON relationships(verb);
    `)

    // Initialize executor with SQLite stores
    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('creates relationship with from=generated, to=this (B points to A)', async () => {
    // Setup: Create "this" entity (Employee)
    sqlite.exec(`
      INSERT INTO things (id, type, data)
      VALUES ('emp-001', 'Employee', '{"name": "Alice"}')
    `)

    // Execute backward insert: Employee <- Manager
    // This means: Generate Manager, create relationship FROM Manager TO Employee
    const result = await executor.execute({
      operator: '<-',
      targetType: 'Manager',
      thisEntity: { id: 'emp-001', type: 'Employee' },
    })

    // Verify relationship direction
    expect(result.relationship.from).toBe(result.generated.id) // FROM = generated Manager
    expect(result.relationship.to).toBe('emp-001') // TO = this Employee

    // Verify in SQLite
    const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(result.relationship.id) as Relationship
    expect(rel.from).toBe(result.generated.id)
    expect(rel.to).toBe('emp-001')
  })

  it('generated entity points TO current entity (inverse of forward)', async () => {
    // Setup: A Task entity
    sqlite.exec(`
      INSERT INTO things (id, type, data)
      VALUES ('task-001', 'Task', '{"title": "Implement feature"}')
    `)

    // Backward insert: Task <- Assignee
    // Assignee points TO Task (not Task points to Assignee)
    const result = await executor.execute({
      operator: '<-',
      targetType: 'Assignee',
      thisEntity: { id: 'task-001', type: 'Task' },
    })

    // The relationship FROM Assignee TO Task
    expect(result.relationship.to).toBe('task-001')
    expect(result.relationship.from).not.toBe('task-001')
  })

  it('multiple backward inserts create separate relationships all pointing TO this', async () => {
    // Setup: A Startup entity
    sqlite.exec(`
      INSERT INTO things (id, type, data)
      VALUES ('startup-001', 'Startup', '{"name": "TechCo"}')
    `)

    // Multiple backward inserts
    const r1 = await executor.execute({
      operator: '<-',
      targetType: 'Investor',
      thisEntity: { id: 'startup-001', type: 'Startup' },
    })

    const r2 = await executor.execute({
      operator: '<-',
      targetType: 'Advisor',
      thisEntity: { id: 'startup-001', type: 'Startup' },
    })

    const r3 = await executor.execute({
      operator: '<-',
      targetType: 'Founder',
      thisEntity: { id: 'startup-001', type: 'Startup' },
    })

    // All relationships point TO the startup
    expect(r1.relationship.to).toBe('startup-001')
    expect(r2.relationship.to).toBe('startup-001')
    expect(r3.relationship.to).toBe('startup-001')

    // All FROM different generated entities
    const froms = new Set([r1.relationship.from, r2.relationship.from, r3.relationship.from])
    expect(froms.size).toBe(3)
  })
})

// ============================================================================
// 2. SQLite Storage of Backward Relationships
// ============================================================================

describe('Backward Insert (<-) Operator - SQLite Storage', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(verb, "from", "to")
      );
    `)

    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('persists generated entity to things table', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('emp-002', 'Employee', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Manager',
      thisEntity: { id: 'emp-002', type: 'Employee' },
    })

    // Verify entity stored
    const stored = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(result.generated.id) as Thing
    expect(stored).toBeDefined()
    expect(stored.type).toBe('Manager')
  })

  it('persists relationship to relationships table', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('doc-001', 'Document', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Author',
      thisEntity: { id: 'doc-001', type: 'Document' },
    })

    // Verify relationship stored
    const stored = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(result.relationship.id) as Relationship
    expect(stored).toBeDefined()
    expect(stored.verb).toBeDefined()
    expect(stored.from).toBe(result.generated.id)
    expect(stored.to).toBe('doc-001')
  })

  it('stores entity data as JSON', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('proj-001', 'Project', '{"name": "Alpha"}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'TeamMember',
      thisEntity: { id: 'proj-001', type: 'Project' },
      generateData: { role: 'Developer', skills: ['TypeScript', 'Rust'] },
    })

    const stored = sqlite.prepare('SELECT data FROM things WHERE id = ?').get(result.generated.id) as { data: string }
    const parsed = JSON.parse(stored.data)
    expect(parsed.role).toBe('Developer')
    expect(parsed.skills).toContain('TypeScript')
  })

  it('creates unique IDs for each generated entity', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('team-001', 'Team', '{}')`)

    const results = await Promise.all([
      executor.execute({ operator: '<-', targetType: 'Member', thisEntity: { id: 'team-001', type: 'Team' } }),
      executor.execute({ operator: '<-', targetType: 'Member', thisEntity: { id: 'team-001', type: 'Team' } }),
      executor.execute({ operator: '<-', targetType: 'Member', thisEntity: { id: 'team-001', type: 'Team' } }),
    ])

    const ids = results.map((r) => r.generated.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })

  it('sets timestamps on stored entities', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('order-001', 'Order', '{}')`)

    const before = Date.now()
    const result = await executor.execute({
      operator: '<-',
      targetType: 'Customer',
      thisEntity: { id: 'order-001', type: 'Order' },
    })
    const after = Date.now()

    const stored = sqlite.prepare('SELECT created_at, updated_at FROM things WHERE id = ?').get(result.generated.id) as Thing
    expect(stored.created_at).toBeGreaterThanOrEqual(before)
    expect(stored.created_at).toBeLessThanOrEqual(after)
  })
})

// ============================================================================
// 3. Query Traversal in Backward Direction
// ============================================================================

describe('Backward Insert (<-) Operator - Query Traversal', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(verb, "from", "to")
      );

      CREATE INDEX idx_rel_from ON relationships("from");
      CREATE INDEX idx_rel_to ON relationships("to");
    `)

    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('can find all entities pointing TO a given entity', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('blog-001', 'Blog', '{"title": "Tech Blog"}')`)

    // Create several backward relationships
    await executor.execute({ operator: '<-', targetType: 'Post', thisEntity: { id: 'blog-001', type: 'Blog' } })
    await executor.execute({ operator: '<-', targetType: 'Post', thisEntity: { id: 'blog-001', type: 'Blog' } })
    await executor.execute({ operator: '<-', targetType: 'Author', thisEntity: { id: 'blog-001', type: 'Blog' } })

    // Query all entities pointing TO the blog
    const incoming = sqlite.prepare('SELECT "from", verb FROM relationships WHERE "to" = ?').all('blog-001') as Array<{
      from: string
      verb: string
    }>

    expect(incoming.length).toBe(3)
  })

  it('can traverse backward to find parent entities', async () => {
    sqlite.exec(`
      INSERT INTO things (id, type, data) VALUES
      ('company-001', 'Company', '{"name": "BigCorp"}'),
      ('dept-001', 'Department', '{"name": "Engineering"}')
    `)

    // Company <- Department (Department points TO Company)
    await executor.execute({
      operator: '<-',
      targetType: 'Department',
      thisEntity: { id: 'company-001', type: 'Company' },
      useExisting: 'dept-001',
    })

    // Query: What company does dept-001 belong to?
    const parent = sqlite
      .prepare('SELECT "to" FROM relationships WHERE "from" = ? LIMIT 1')
      .get('dept-001') as { to: string } | undefined

    expect(parent?.to).toBe('company-001')
  })

  it('supports filtering by verb in backward traversal', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('startup-002', 'Startup', '{}')`)

    // Different relationship types
    await executor.execute({ operator: '<-', targetType: 'Investor', thisEntity: { id: 'startup-002', type: 'Startup' }, verb: 'investsIn' })
    await executor.execute({ operator: '<-', targetType: 'Mentor', thisEntity: { id: 'startup-002', type: 'Startup' }, verb: 'mentors' })
    await executor.execute({ operator: '<-', targetType: 'Customer', thisEntity: { id: 'startup-002', type: 'Startup' }, verb: 'buysFrom' })

    // Find only investors (via investedInBy verb - derived from investsIn)
    const investors = sqlite
      .prepare('SELECT "from" FROM relationships WHERE "to" = ? AND verb LIKE ?')
      .all('startup-002', '%invest%') as Array<{ from: string }>

    expect(investors.length).toBe(1)
  })

  it('can count incoming relationships', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('product-001', 'Product', '{}')`)

    // Create multiple reviews
    for (let i = 0; i < 5; i++) {
      await executor.execute({ operator: '<-', targetType: 'Review', thisEntity: { id: 'product-001', type: 'Product' } })
    }

    const count = sqlite.prepare('SELECT COUNT(*) as cnt FROM relationships WHERE "to" = ?').get('product-001') as { cnt: number }
    expect(count.cnt).toBe(5)
  })
})

// ============================================================================
// 4. Integrity with Bidirectional Relationships
// ============================================================================

describe('Backward Insert (<-) Operator - Bidirectional Integrity', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE verbs (
        verb TEXT PRIMARY KEY,
        reverse TEXT,
        inverse TEXT
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(verb, "from", "to")
      );

      -- Seed bidirectional verb pairs
      INSERT INTO verbs (verb, reverse) VALUES
      ('parent_of', 'child_of'),
      ('child_of', 'parent_of'),
      ('manages', 'managedBy'),
      ('managedBy', 'manages'),
      ('owns', 'ownedBy'),
      ('ownedBy', 'owns');
    `)

    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('maintains verb pair integrity: parent_of <-> child_of', async () => {
    sqlite.exec(`
      INSERT INTO things (id, type, data) VALUES
      ('folder-001', 'Folder', '{"name": "Documents"}')
    `)

    // Folder <- File with parent_of relationship
    // This creates: File --child_of--> Folder
    const result = await executor.execute({
      operator: '<-',
      targetType: 'File',
      thisEntity: { id: 'folder-001', type: 'Folder' },
      verb: 'parent_of',
    })

    // The derived verb should be child_of
    const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship.id) as { verb: string }
    expect(rel.verb).toBe('child_of')

    // Verify the reverse lookup works
    const verbInfo = sqlite.prepare('SELECT reverse FROM verbs WHERE verb = ?').get('child_of') as { reverse: string }
    expect(verbInfo.reverse).toBe('parent_of')
  })

  it('maintains verb pair integrity: manages <-> managedBy', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('employee-003', 'Employee', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Manager',
      thisEntity: { id: 'employee-003', type: 'Employee' },
      verb: 'manages',
    })

    const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship.id) as { verb: string }
    expect(rel.verb).toBe('managedBy')
  })

  it('can traverse in both directions using verb pairs', async () => {
    sqlite.exec(`
      INSERT INTO things (id, type, data) VALUES
      ('org-001', 'Organization', '{"name": "Acme"}'),
      ('team-002', 'Team', '{"name": "Engineering"}')
    `)

    // Org <- Team creates Team --belongsTo--> Org
    await executor.execute({
      operator: '<-',
      targetType: 'Team',
      thisEntity: { id: 'org-001', type: 'Organization' },
      useExisting: 'team-002',
      verb: 'contains',
    })

    // Forward query: What does team-002 belong to?
    const belongsTo = sqlite.prepare('SELECT "to" FROM relationships WHERE "from" = ?').get('team-002') as { to: string }
    expect(belongsTo.to).toBe('org-001')

    // Reverse query: What does org-001 contain?
    const contains = sqlite.prepare('SELECT "from" FROM relationships WHERE "to" = ?').get('org-001') as { from: string }
    expect(contains.from).toBe('team-002')
  })

  it('prevents duplicate relationships with same verb/from/to', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('proj-002', 'Project', '{}')`)

    // Create first relationship
    const r1 = await executor.execute({
      operator: '<-',
      targetType: 'Task',
      thisEntity: { id: 'proj-002', type: 'Project' },
    })

    // Try to create duplicate relationship with same generated entity
    // Should either throw or create with different ID
    await expect(async () => {
      await executor.execute({
        operator: '<-',
        targetType: 'Task',
        thisEntity: { id: 'proj-002', type: 'Project' },
        useExisting: r1.generated.id,
      })
    }).rejects.toThrow()
  })
})

// ============================================================================
// 5. Verb Derivation Tests
// ============================================================================

describe('Backward Insert (<-) Operator - Verb Derivation', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `)

    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('derives managedBy from manages', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('emp-100', 'Employee', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Manager',
      thisEntity: { id: 'emp-100', type: 'Employee' },
      verb: 'manages',
    })

    expect(result.relationship.verb).toBe('managedBy')
  })

  it('derives ownedBy from owns', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('asset-001', 'Asset', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Owner',
      thisEntity: { id: 'asset-001', type: 'Asset' },
      verb: 'owns',
    })

    expect(result.relationship.verb).toBe('ownedBy')
  })

  it('derives createdBy from creates', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('doc-002', 'Document', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Author',
      thisEntity: { id: 'doc-002', type: 'Document' },
      verb: 'creates',
    })

    expect(result.relationship.verb).toBe('createdBy')
  })

  it('handles bidirectional verbs: parent_of <-> child_of', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('node-001', 'Node', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'ParentNode',
      thisEntity: { id: 'node-001', type: 'Node' },
      verb: 'parent_of',
    })

    expect(result.relationship.verb).toBe('child_of')
  })

  it('applies default derivation for unknown verbs: customVerb -> customVerbBy', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('thing-001', 'Thing', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'RelatedThing',
      thisEntity: { id: 'thing-001', type: 'Thing' },
      verb: 'customAction',
    })

    // Default derivation adds 'By' suffix
    expect(result.relationship.verb).toBe('customActionBy')
  })

  it('derives verb from field name when verb not specified', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('item-001', 'Item', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Manager',
      thisEntity: { id: 'item-001', type: 'Item' },
      fieldName: 'manager',
    })

    // Field name 'manager' should derive to 'managerOf' for backward direction
    expect(result.relationship.verb).toMatch(/manager/i)
  })
})

// ============================================================================
// 6. Backref Field Syntax Tests
// ============================================================================

describe('Backward Insert (<-) Operator - Backref Field', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `)

    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('sets backref field on generated entity: <-Order.customer', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('customer-001', 'Customer', '{"name": "Acme"}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Order',
      thisEntity: { id: 'customer-001', type: 'Customer' },
      backrefField: 'customer',
    })

    // The generated Order should have customer field set
    expect(result.generated.data.customer).toBe('customer-001')

    // Verify in SQLite
    const stored = sqlite.prepare('SELECT data FROM things WHERE id = ?').get(result.generated.id) as { data: string }
    const parsed = JSON.parse(stored.data)
    expect(parsed.customer).toBe('customer-001')
  })

  it('backref field allows querying via json_extract', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('customer-002', 'Customer', '{}')`)

    // Create multiple orders with customer backref
    await executor.execute({
      operator: '<-',
      targetType: 'Order',
      thisEntity: { id: 'customer-002', type: 'Customer' },
      backrefField: 'customer',
    })
    await executor.execute({
      operator: '<-',
      targetType: 'Order',
      thisEntity: { id: 'customer-002', type: 'Customer' },
      backrefField: 'customer',
    })
    await executor.execute({
      operator: '<-',
      targetType: 'Order',
      thisEntity: { id: 'customer-002', type: 'Customer' },
      backrefField: 'customer',
    })

    // Query orders by customer
    const orders = sqlite
      .prepare(`SELECT * FROM things WHERE type = 'Order' AND json_extract(data, '$.customer') = ?`)
      .all('customer-002')

    expect(orders.length).toBe(3)
  })

  it('backref field and relationship remain consistent', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('blog-002', 'Blog', '{}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Post',
      thisEntity: { id: 'blog-002', type: 'Blog' },
      backrefField: 'blog',
    })

    // Backref field
    expect(result.generated.data.blog).toBe('blog-002')

    // Relationship TO
    expect(result.relationship.to).toBe('blog-002')
  })

  it('supports nested backref fields: <-Comment.post.blog', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('post-001', 'Post', '{"blog": "blog-001"}')`)

    const result = await executor.execute({
      operator: '<-',
      targetType: 'Comment',
      thisEntity: { id: 'post-001', type: 'Post' },
      backrefField: 'post',
    })

    expect(result.generated.data.post).toBe('post-001')
  })
})

// ============================================================================
// 7. Array Backward Insert Tests
// ============================================================================

describe('Backward Insert (<-) Operator - Array Mode', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let executor: BackwardInsertExecutor

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `)

    executor = new BackwardInsertExecutor({
      thingStore: createThingStore(sqlite),
      relationshipStore: createRelationshipStore(sqlite),
    })
  })

  afterEach(() => {
    sqlite?.close()
  })

  it('generates multiple entities for array backward insert', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('customer-arr', 'Customer', '{}')`)

    const results = await executor.executeArray({
      operator: '<-',
      targetType: 'Order',
      thisEntity: { id: 'customer-arr', type: 'Customer' },
      count: 3,
    })

    expect(results.length).toBe(3)
    results.forEach((r) => {
      expect(r.relationship.to).toBe('customer-arr')
    })
  })

  it('each array element has unique ID', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('shop-001', 'Shop', '{}')`)

    const results = await executor.executeArray({
      operator: '<-',
      targetType: 'Product',
      thisEntity: { id: 'shop-001', type: 'Shop' },
      count: 5,
    })

    const ids = results.map((r) => r.generated.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(5)
  })

  it('array items all have correct relationship direction', async () => {
    sqlite.exec(`INSERT INTO things (id, type, data) VALUES ('startup-arr', 'Startup', '{}')`)

    const results = await executor.executeArray({
      operator: '<-',
      targetType: 'Founder',
      thisEntity: { id: 'startup-arr', type: 'Startup' },
      count: 3,
    })

    results.forEach((r) => {
      expect(r.relationship.to).toBe('startup-arr')
      expect(r.relationship.from).toBe(r.generated.id)
    })
  })
})

// ============================================================================
// Helper Functions (these will need to be implemented)
// ============================================================================

function createThingStore(_sqlite: import('better-sqlite3').Database): ThingStore {
  // This will fail because ThingStore type doesn't exist yet
  throw new Error('ThingStore not implemented - RED phase')
}

function createRelationshipStore(_sqlite: import('better-sqlite3').Database): RelationshipStore {
  // This will fail because RelationshipStore type doesn't exist yet
  throw new Error('RelationshipStore not implemented - RED phase')
}
