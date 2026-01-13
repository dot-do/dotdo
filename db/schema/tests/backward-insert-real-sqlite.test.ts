/**
 * Backward Insert (<-) Operator Tests with Real SQLite
 *
 * TDD RED Phase: Failing tests for BackwardCascadeResolver SQLite persistence.
 *
 * Issue: dotdo-1mc8e
 *
 * These tests verify that the BackwardCascadeResolver correctly persists
 * entities and relationships to real SQLite. The tests are designed to FAIL
 * until the resolver is properly integrated with SQLite storage.
 *
 * Key behaviors being tested:
 * - Generated entities are stored in SQLite things table
 * - Relationships are stored with correct direction (from=target, to=this)
 * - Verb derivation is correctly applied and stored
 * - Backref fields are set on generated entities
 * - Array backward inserts create multiple entities and relationships
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 *
 * These tests will FAIL because:
 * 1. The resolver doesn't have a built-in SQLite storage mechanism
 * 2. The store/createRelationship callbacks need to be wired to SQLite
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  BackwardCascadeResolver,
  resolveBackwardInsert,
  deriveReverseVerb,
  type BackwardResolutionContext,
} from '../resolvers/backward'

// ============================================================================
// Test Types
// ============================================================================

interface ThingRow {
  id: string
  type_name: string
  data: string
  created_at: number
  updated_at: number
}

interface RelationshipRow {
  id: string
  verb: string
  from: string
  to: string
  data: string | null
  created_at: number
}

// ============================================================================
// Helper: Create SQLite storage callbacks for the resolver
// ============================================================================

function createSQLiteStorageCallbacks(sqlite: import('better-sqlite3').Database) {
  return {
    /**
     * Store an entity to the things table.
     * This is a simple implementation that should work once wired up.
     */
    store: async (entity: { $id: string; $type: string; [key: string]: unknown }) => {
      const now = Date.now()
      const { $id, $type, ...rest } = entity
      const data = JSON.stringify(rest)

      sqlite
        .prepare(
          `INSERT INTO things (id, type_name, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
        )
        .run($id, $type, data, now, now)

      return entity
    },

    /**
     * Create a relationship in the relationships table.
     */
    createRelationship: async (rel: { id: string; verb: string; from: string; to: string; data?: Record<string, unknown> }) => {
      const now = Date.now()
      const data = rel.data ? JSON.stringify(rel.data) : null

      sqlite
        .prepare(
          `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(rel.id, rel.verb, rel.from, rel.to, data, now)

      return rel
    },
  }
}

// ============================================================================
// 1. Basic Backward Insert (<-) with SQLite Storage
// ============================================================================

describe('Backward Insert (<-) SQLite Persistence - RED Phase', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    // Create schema
    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type_name TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE verbs (
        verb TEXT PRIMARY KEY,
        action TEXT,
        activity TEXT,
        event TEXT,
        reverse TEXT,
        inverse TEXT,
        description TEXT
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(verb, "from", "to")
      );

      CREATE INDEX rel_from_idx ON relationships("from");
      CREATE INDEX rel_to_idx ON relationships("to");
      CREATE INDEX rel_verb_idx ON relationships(verb);
    `)

    // Seed standard verbs
    sqlite.exec(`
      INSERT INTO verbs (verb, action, activity, event, reverse) VALUES
      ('manages', 'manage', 'managing', 'managed', 'managedBy'),
      ('managedBy', 'managedBy', 'beingManaged', 'wasManaged', 'manages'),
      ('owns', 'own', 'owning', 'owned', 'ownedBy'),
      ('ownedBy', 'ownedBy', 'beingOwned', 'wasOwned', 'owns'),
      ('creates', 'create', 'creating', 'created', 'createdBy'),
      ('createdBy', 'createdBy', 'beingCreated', 'wasCreated', 'creates'),
      ('ideaOf', 'ideaOf', 'ideaOfing', 'ideaOfed', 'hasIdea'),
      ('ordersFrom', 'orderFrom', 'orderingFrom', 'orderedFrom', 'hasOrders'),
      ('foundedBy', 'foundedBy', 'beingFounded', 'wasFounded', 'founds'),
      ('managerOf', 'managerOf', 'managerOfing', 'managerOfed', 'hasManager'),
      ('assigneeOf', 'assigneeOf', 'assigneeOfing', 'assigneeOfed', 'hasAssignee'),
      ('reviewOf', 'reviewOf', 'reviewOfing', 'reviewOfed', 'hasReview'),
      ('teamOf', 'teamOf', 'teamOfing', 'teamOfed', 'hasTeam'),
      ('investorOf', 'investorOf', 'investorOfing', 'investorOfed', 'hasInvestor'),
      ('founderOf', 'founderOf', 'founderOfing', 'founderOfed', 'hasFounder');
    `)
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  // ==========================================================================
  // ENTITY STORAGE TESTS
  // These tests verify entities are persisted to SQLite
  // ==========================================================================

  describe('Entity Storage to SQLite', () => {
    it('should persist generated entity to things table after resolve', async () => {
      // Setup: Create "this" entity
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-001', 'Employee', '{"name": "Alice"}', ${now}, ${now})
      `)

      // Create resolver with SQLite callbacks
      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'employee-001', $type: 'Employee', name: 'Alice' },
        namespace: 'https://acme.example.com',
      }

      // Resolve backward insert
      const result = await resolver.resolve({ operator: '<-', targetType: 'Manager', fieldName: 'manager' }, context)

      // RED TEST: Verify entity was stored in SQLite
      // This will FAIL because the resolver doesn't call store() automatically
      const stored = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(result.generated!.$id) as ThingRow | undefined

      expect(stored).toBeDefined()
      expect(stored!.type_name).toBe('Manager')
    })

    it('should persist entity data as JSON in things table', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-001', 'Startup', '{"name": "TechCo"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: `idea-${Date.now()}`,
          $type: ctx.type,
          concept: 'AI code review',
          market: 'Developer tools',
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
        { entity: { $id: 'startup-001', $type: 'Startup' }, namespace: 'https://test.com' }
      )

      // RED TEST: Verify JSON data was stored
      const stored = sqlite.prepare('SELECT data FROM things WHERE id = ?').get(result.generated!.$id) as { data: string } | undefined

      expect(stored).toBeDefined()
      const parsedData = JSON.parse(stored!.data)
      expect(parsedData.concept).toBe('AI code review')
    })

    it('should set timestamps on stored entity', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('project-001', 'Project', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const beforeResolve = Date.now()
      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Team', fieldName: 'team' },
        { entity: { $id: 'project-001', $type: 'Project' }, namespace: 'https://test.com' }
      )
      const afterResolve = Date.now()

      // RED TEST: Verify timestamps
      const stored = sqlite.prepare('SELECT created_at, updated_at FROM things WHERE id = ?').get(result.generated!.$id) as
        | { created_at: number; updated_at: number }
        | undefined

      expect(stored).toBeDefined()
      expect(stored!.created_at).toBeGreaterThanOrEqual(beforeResolve)
      expect(stored!.created_at).toBeLessThanOrEqual(afterResolve)
    })
  })

  // ==========================================================================
  // RELATIONSHIP STORAGE TESTS
  // These tests verify relationships are persisted with correct direction
  // ==========================================================================

  describe('Relationship Storage to SQLite', () => {
    it('should persist relationship to relationships table', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-002', 'Employee', '{"name": "Bob"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager' },
        { entity: { $id: 'employee-002', $type: 'Employee' }, namespace: 'https://hr.com' }
      )

      // RED TEST: Verify relationship was stored
      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(result.relationship!.id) as RelationshipRow | undefined

      expect(rel).toBeDefined()
      expect(rel!.id).toBe(result.relationship!.id)
    })

    it('should store relationship with from=target, to=this direction', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('task-001', 'Task', '{"title": "Fix bug"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Assignee', fieldName: 'assignee' },
        { entity: { $id: 'task-001', $type: 'Task' }, namespace: 'https://tasks.com' }
      )

      // RED TEST: Verify direction is from=target (generated), to=this (current)
      const rel = sqlite.prepare('SELECT "from", "to" FROM relationships WHERE id = ?').get(result.relationship!.id) as
        | { from: string; to: string }
        | undefined

      expect(rel).toBeDefined()
      expect(rel!.from).toBe(result.generated!.$id) // Generated Assignee
      expect(rel!.to).toBe('task-001') // This Task
    })

    it('should store relationship timestamp', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('article-001', 'Article', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const beforeResolve = Date.now()
      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Author', fieldName: 'author' },
        { entity: { $id: 'article-001', $type: 'Article' }, namespace: 'https://blog.com' }
      )
      const afterResolve = Date.now()

      // RED TEST: Verify timestamp
      const rel = sqlite.prepare('SELECT created_at FROM relationships WHERE id = ?').get(result.relationship!.id) as
        | { created_at: number }
        | undefined

      expect(rel).toBeDefined()
      expect(rel!.created_at).toBeGreaterThanOrEqual(beforeResolve)
      expect(rel!.created_at).toBeLessThanOrEqual(afterResolve)
    })
  })

  // ==========================================================================
  // VERB DERIVATION STORAGE TESTS
  // These tests verify correct verb derivation is stored
  // ==========================================================================

  describe('Verb Derivation Storage', () => {
    it('should store derived verb managedBy (from manages)', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-vd1', 'Employee', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager', verb: 'manages' },
        { entity: { $id: 'employee-vd1', $type: 'Employee' }, namespace: 'https://hr.com' }
      )

      // RED TEST: Verify verb was derived and stored correctly
      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string } | undefined

      expect(rel).toBeDefined()
      expect(rel!.verb).toBe('managedBy')
    })

    it('should store derived verb ownedBy (from owns)', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('product-vd1', 'Product', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Company', fieldName: 'owner', verb: 'owns' },
        { entity: { $id: 'product-vd1', $type: 'Product' }, namespace: 'https://shop.com' }
      )

      // RED TEST: Verify verb derivation
      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string } | undefined

      expect(rel).toBeDefined()
      expect(rel!.verb).toBe('ownedBy')
    })

    it('should store derived verb createdBy (from creates)', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('document-vd1', 'Document', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Author', fieldName: 'creator', verb: 'creates' },
        { entity: { $id: 'document-vd1', $type: 'Document' }, namespace: 'https://docs.com' }
      )

      // RED TEST: Verify verb derivation
      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string } | undefined

      expect(rel).toBeDefined()
      expect(rel!.verb).toBe('createdBy')
    })

    it('should store bidirectional verb child_of (from parent_of)', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('child-node', 'ChildNode', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'ParentNode', fieldName: 'parent', verb: 'parent_of' },
        { entity: { $id: 'child-node', $type: 'ChildNode' }, namespace: 'https://tree.com' }
      )

      // RED TEST: Verify bidirectional verb
      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string } | undefined

      expect(rel).toBeDefined()
      expect(rel!.verb).toBe('child_of')
    })

    it('should derive verb from field name when no verb specified', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('project-vd2', 'Project', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      // No explicit verb, should derive from fieldName 'manager'
      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager' },
        { entity: { $id: 'project-vd2', $type: 'Project' }, namespace: 'https://pm.com' }
      )

      // RED TEST: Verify verb was derived from field name
      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string } | undefined

      expect(rel).toBeDefined()
      // Field 'manager' -> verb 'manages' -> reverse 'managedBy'
      expect(rel!.verb).toBe('managedBy')
    })
  })

  // ==========================================================================
  // BACKREF FIELD STORAGE TESTS
  // These tests verify backref field is set on generated entity
  // ==========================================================================

  describe('Backref Field Storage', () => {
    it('should store backref field in generated entity data', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-001', 'Customer', '{"name": "Acme Corp"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: `order-${Date.now()}`,
          $type: ctx.type,
          orderNumber: 'ORD-001',
          total: 199.99,
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' },
        { entity: { $id: 'customer-001', $type: 'Customer' }, namespace: 'https://shop.com' }
      )

      // Verify backref field is set on result
      expect(result.generated!.customer).toBe('customer-001')

      // RED TEST: Verify backref field is persisted to SQLite
      const stored = sqlite.prepare('SELECT data FROM things WHERE id = ?').get(result.generated!.$id) as { data: string } | undefined

      expect(stored).toBeDefined()
      const parsedData = JSON.parse(stored!.data)
      expect(parsedData.customer).toBe('customer-001')
    })

    it('should allow querying by backref field after storage', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-002', 'Customer', '{"name": "Beta Inc"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: `order-${crypto.randomUUID().split('-')[0]}`,
          $type: ctx.type,
          total: Math.random() * 1000,
        }),
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'customer-002', $type: 'Customer' },
        namespace: 'https://shop.com',
      }

      // Generate 3 orders with backref
      await resolver.resolve({ operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' }, context)
      await resolver.resolve({ operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' }, context)
      await resolver.resolve({ operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' }, context)

      // RED TEST: Query orders by customer backref field
      const customerOrders = sqlite
        .prepare(
          `SELECT * FROM things
         WHERE type_name = 'Order'
           AND json_extract(data, '$.customer') = ?`
        )
        .all('customer-002') as ThingRow[]

      expect(customerOrders).toHaveLength(3)
      customerOrders.forEach((order) => {
        const data = JSON.parse(order.data)
        expect(data.customer).toBe('customer-002')
      })
    })

    it('backref field and relationship should be consistent', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-003', 'Customer', '{"name": "Gamma LLC"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: `order-${Date.now()}`,
          $type: ctx.type,
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' },
        { entity: { $id: 'customer-003', $type: 'Customer' }, namespace: 'https://shop.com' }
      )

      // RED TEST: Verify backref and relationship point to same entity
      const stored = sqlite.prepare('SELECT data FROM things WHERE id = ?').get(result.generated!.$id) as { data: string } | undefined
      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(result.relationship!.id) as RelationshipRow | undefined

      expect(stored).toBeDefined()
      expect(rel).toBeDefined()

      const parsedData = JSON.parse(stored!.data)
      expect(parsedData.customer).toBe('customer-003')
      expect(rel!.to).toBe('customer-003')
    })
  })

  // ==========================================================================
  // ARRAY BACKWARD INSERT STORAGE TESTS
  // These tests verify multiple entities/relationships are stored
  // ==========================================================================

  describe('Array Backward Insert Storage', () => {
    it('should persist multiple entities from array backward insert', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-arr', 'Startup', '{"name": "ArrayCo"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const context: BackwardResolutionContext = {
        entity: { $id: 'startup-arr', $type: 'Startup' },
        namespace: 'https://startups.com',
      }

      // Generate 3 founders
      await Promise.all([
        resolver.resolve({ operator: '<-', targetType: 'Founder', fieldName: 'founders' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Founder', fieldName: 'founders' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Founder', fieldName: 'founders' }, context),
      ])

      // RED TEST: Verify all founders stored
      const founders = sqlite.prepare("SELECT * FROM things WHERE type_name = 'Founder'").all() as ThingRow[]
      expect(founders).toHaveLength(3)
    })

    it('should persist all relationships with correct direction', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-rel', 'Startup', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const context: BackwardResolutionContext = {
        entity: { $id: 'startup-rel', $type: 'Startup' },
        namespace: 'https://startups.com',
      }

      // Generate 3 investors
      await Promise.all([
        resolver.resolve({ operator: '<-', targetType: 'Investor', fieldName: 'investors' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Investor', fieldName: 'investors' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Investor', fieldName: 'investors' }, context),
      ])

      // RED TEST: Verify all relationships point TO startup
      const rels = sqlite.prepare('SELECT * FROM relationships WHERE "to" = ?').all('startup-rel') as RelationshipRow[]

      expect(rels).toHaveLength(3)
      rels.forEach((rel) => {
        expect(rel.to).toBe('startup-rel')
      })
    })

    it('should generate unique IDs for all array elements', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('product-arr', 'Product', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const context: BackwardResolutionContext = {
        entity: { $id: 'product-arr', $type: 'Product' },
        namespace: 'https://products.com',
      }

      // Generate 5 reviews
      await Promise.all([
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
      ])

      // RED TEST: Verify unique IDs
      const reviews = sqlite.prepare("SELECT id FROM things WHERE type_name = 'Review'").all() as { id: string }[]
      const uniqueIds = new Set(reviews.map((r) => r.id))
      expect(uniqueIds.size).toBe(5)
    })
  })

  // ==========================================================================
  // COMPLETE INTEGRATION FLOW TESTS
  // These tests verify the full backward insert flow with SQLite
  // ==========================================================================

  describe('Complete Backward Insert Flow with SQLite', () => {
    it('should perform complete flow: generate entity, store entity, create relationship, store relationship', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-full', 'Startup', '{"name": "FullFlowCo", "industry": "Fintech"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: `idea-${crypto.randomUUID().split('-')[0]}`,
          $type: ctx.type,
          concept: 'Blockchain payment rails',
          market: 'B2B payments',
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
        { entity: { $id: 'startup-full', $type: 'Startup', name: 'FullFlowCo' }, namespace: 'https://fintech.com' }
      )

      // Verify result
      expect(result.generated).toBeDefined()
      expect(result.generated!.$type).toBe('Idea')
      expect(result.relationship).toBeDefined()

      // RED TEST: Verify entity stored
      const storedEntity = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(result.generated!.$id) as ThingRow | undefined
      expect(storedEntity).toBeDefined()
      expect(storedEntity!.type_name).toBe('Idea')

      // RED TEST: Verify relationship stored with correct direction
      const storedRel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(result.relationship!.id) as
        | RelationshipRow
        | undefined
      expect(storedRel).toBeDefined()
      expect(storedRel!.from).toBe(result.generated!.$id)
      expect(storedRel!.to).toBe('startup-full')

      // RED TEST: Can traverse backward from startup to find idea
      const startupIdeas = sqlite.prepare('SELECT "from" FROM relationships WHERE "to" = ?').all('startup-full') as { from: string }[]
      expect(startupIdeas).toHaveLength(1)
      expect(startupIdeas[0].from).toBe(result.generated!.$id)
    })

    it('should store context metadata in relationship data when enabled', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-meta', 'Startup', '{"name": "MetaCo"}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)

      // Track if createRelationship was called with metadata
      let capturedRelData: Record<string, unknown> | undefined
      const wrappedCreateRelationship = async (rel: { id: string; verb: string; from: string; to: string; data?: Record<string, unknown> }) => {
        capturedRelData = rel.data
        return createRelationship(rel)
      }

      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship: wrappedCreateRelationship,
      })

      await resolver.resolve(
        { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
        { entity: { $id: 'startup-meta', $type: 'Startup' }, namespace: 'https://meta.com' }
      )

      // This tests whether metadata is passed - may need resolver update to include metadata
      // RED TEST: For now, verify relationship was created
      const rels = sqlite.prepare('SELECT * FROM relationships WHERE "to" = ?').all('startup-meta') as RelationshipRow[]
      expect(rels).toHaveLength(1)
    })
  })

  // ==========================================================================
  // EDGE CASES AND ERROR HANDLING
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty entity data', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('empty-data', 'Empty', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({ store, createRelationship })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Simple', fieldName: 'simple' },
        { entity: { $id: 'empty-data', $type: 'Empty' }, namespace: 'https://test.com' }
      )

      // RED TEST: Verify entity stored even with minimal data
      const stored = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(result.generated!.$id) as ThingRow | undefined
      expect(stored).toBeDefined()
    })

    it('should handle special characters in entity data', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('special-001', 'Special', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: `item-${Date.now()}`,
          $type: ctx.type,
          name: "O'Reilly's \"Book\"",
          description: 'Line1\nLine2\tTabbed',
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Item', fieldName: 'items' },
        { entity: { $id: 'special-001', $type: 'Special' }, namespace: 'https://test.com' }
      )

      // RED TEST: Verify special characters are preserved
      const stored = sqlite.prepare('SELECT data FROM things WHERE id = ?').get(result.generated!.$id) as { data: string } | undefined
      expect(stored).toBeDefined()
      const parsedData = JSON.parse(stored!.data)
      expect(parsedData.name).toBe("O'Reilly's \"Book\"")
      expect(parsedData.description).toContain('\n')
    })

    it('should preserve entity $id and $type exactly', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('preserve-001', 'Preserve', '{}', ${now}, ${now})
      `)

      const { store, createRelationship } = createSQLiteStorageCallbacks(sqlite)
      const specificId = 'my-custom-id-12345'
      const resolver = new BackwardCascadeResolver({
        store,
        createRelationship,
        generator: async (ctx) => ({
          $id: specificId,
          $type: ctx.type,
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Custom', fieldName: 'custom' },
        { entity: { $id: 'preserve-001', $type: 'Preserve' }, namespace: 'https://test.com' }
      )

      // Verify exact ID was used
      expect(result.generated!.$id).toBe(specificId)

      // RED TEST: Verify stored with exact ID
      const stored = sqlite.prepare('SELECT id, type_name FROM things WHERE id = ?').get(specificId) as
        | { id: string; type_name: string }
        | undefined
      expect(stored).toBeDefined()
      expect(stored!.id).toBe(specificId)
      expect(stored!.type_name).toBe('Custom')
    })
  })
})
