/**
 * Backward Insert (<-) Operator Integration Tests with Real SQLite
 *
 * TDD RED Phase: Failing tests for BackwardCascadeResolver with SQLite storage.
 *
 * Issue: dotdo-1mc8e
 *
 * These tests verify that the BackwardCascadeResolver correctly persists
 * entities and relationships to real SQLite when configured with SQLite
 * storage adapters.
 *
 * Key behaviors to test:
 * - Resolver persists generated entities to SQLite things table
 * - Resolver persists relationships to SQLite relationships table
 * - Relationship direction: from=generatedEntity, to=thisEntity
 * - Verb derivation stored correctly in database
 * - Backref field set on generated entity before storage
 *
 * These tests FAIL because SQLiteStorageAdapter doesn't exist yet.
 * This is intentional - RED phase of TDD.
 *
 * NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// This import will FAIL because SQLiteStorageAdapter doesn't exist
import { SQLiteStorageAdapter } from '../storage/sqlite-adapter'
import {
  BackwardCascadeResolver,
  resolveBackwardInsert,
  parseBackwardReference,
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
// 1. BackwardCascadeResolver with SQLiteStorageAdapter - Entity Persistence
// ============================================================================

describe('BackwardCascadeResolver with SQLite Storage', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let storageAdapter: SQLiteStorageAdapter

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
        verb TEXT NOT NULL REFERENCES verbs(verb),
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
      ('foundedBy', 'foundedBy', 'beingFounded', 'wasFounded', 'founds');
    `)

    // Create storage adapter - THIS WILL FAIL (SQLiteStorageAdapter doesn't exist)
    storageAdapter = new SQLiteStorageAdapter(sqlite)
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  // ==========================================================================
  // ENTITY PERSISTENCE TESTS
  // ==========================================================================

  describe('Entity Persistence to SQLite', () => {
    it('should persist generated entity to things table', async () => {
      // Create "this" entity first
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-001', 'Employee', '{"name": "Alice"}', ${now}, ${now})
      `)

      // Configure resolver with SQLite storage
      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'employee-001', $type: 'Employee', name: 'Alice' },
        namespace: 'https://acme.example.com',
      }

      // Resolve backward insert - should generate Manager and store to SQLite
      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager' },
        context
      )

      // Verify entity was stored in SQLite
      const stored = sqlite
        .prepare('SELECT * FROM things WHERE id = ?')
        .get(result.generated!.$id) as ThingRow | undefined

      expect(stored).toBeDefined()
      expect(stored!.type_name).toBe('Manager')
      expect(stored!.id).toBe(result.generated!.$id)
    })

    it('should persist entity data as JSON in things table', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-001', 'Startup', '{"name": "TechCo", "industry": "AI"}', ${now}, ${now})
      `)

      // Custom generator that creates entity with data
      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
        generator: async (ctx) => ({
          $id: `idea-${Date.now()}`,
          $type: ctx.type,
          concept: 'AI-powered code review',
          market: 'Developer tools',
        }),
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'startup-001', $type: 'Startup', name: 'TechCo', industry: 'AI' },
        namespace: 'https://startups.example.com',
      }

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
        context
      )

      // Verify JSON data was stored
      const stored = sqlite
        .prepare('SELECT data FROM things WHERE id = ?')
        .get(result.generated!.$id) as { data: string } | undefined

      expect(stored).toBeDefined()
      const parsedData = JSON.parse(stored!.data)
      expect(parsedData.concept).toBe('AI-powered code review')
      expect(parsedData.market).toBe('Developer tools')
    })

    it('should set timestamps on stored entity', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('project-001', 'Project', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const beforeResolve = Date.now()

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Team', fieldName: 'team' },
        { entity: { $id: 'project-001', $type: 'Project' }, namespace: 'https://example.com' }
      )

      const afterResolve = Date.now()

      const stored = sqlite
        .prepare('SELECT created_at, updated_at FROM things WHERE id = ?')
        .get(result.generated!.$id) as { created_at: number; updated_at: number } | undefined

      expect(stored).toBeDefined()
      expect(stored!.created_at).toBeGreaterThanOrEqual(beforeResolve)
      expect(stored!.created_at).toBeLessThanOrEqual(afterResolve)
      expect(stored!.updated_at).toBe(stored!.created_at)
    })
  })

  // ==========================================================================
  // RELATIONSHIP PERSISTENCE TESTS
  // ==========================================================================

  describe('Relationship Persistence to SQLite', () => {
    it('should persist relationship to relationships table', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-002', 'Employee', '{"name": "Bob"}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager' },
        { entity: { $id: 'employee-002', $type: 'Employee', name: 'Bob' }, namespace: 'https://acme.com' }
      )

      // Verify relationship was stored
      const rel = sqlite
        .prepare('SELECT * FROM relationships WHERE id = ?')
        .get(result.relationship!.id) as RelationshipRow | undefined

      expect(rel).toBeDefined()
      expect(rel!.id).toBe(result.relationship!.id)
    })

    it('should store relationship with from=target, to=this direction', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('task-001', 'Task', '{"title": "Fix bug"}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Assignee', fieldName: 'assignee' },
        { entity: { $id: 'task-001', $type: 'Task' }, namespace: 'https://tasks.com' }
      )

      const rel = sqlite
        .prepare('SELECT "from", "to" FROM relationships WHERE id = ?')
        .get(result.relationship!.id) as { from: string; to: string } | undefined

      expect(rel).toBeDefined()
      // CRITICAL: Backward direction - from=generated (target), to=this (current)
      expect(rel!.from).toBe(result.generated!.$id) // Generated Assignee
      expect(rel!.to).toBe('task-001') // This Task
    })

    it('should store derived verb (managedBy) in relationship', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-003', 'Employee', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager', verb: 'manages' },
        { entity: { $id: 'employee-003', $type: 'Employee' }, namespace: 'https://hr.com' }
      )

      const rel = sqlite
        .prepare('SELECT verb FROM relationships WHERE id = ?')
        .get(result.relationship!.id) as { verb: string } | undefined

      expect(rel).toBeDefined()
      expect(rel!.verb).toBe('managedBy') // Derived reverse verb
    })

    it('should store relationship timestamp', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('article-001', 'Article', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const beforeResolve = Date.now()

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Author', fieldName: 'author' },
        { entity: { $id: 'article-001', $type: 'Article' }, namespace: 'https://blog.com' }
      )

      const afterResolve = Date.now()

      const rel = sqlite
        .prepare('SELECT created_at FROM relationships WHERE id = ?')
        .get(result.relationship!.id) as { created_at: number } | undefined

      expect(rel).toBeDefined()
      expect(rel!.created_at).toBeGreaterThanOrEqual(beforeResolve)
      expect(rel!.created_at).toBeLessThanOrEqual(afterResolve)
    })
  })

  // ==========================================================================
  // BACKREF FIELD WITH STORAGE TESTS
  // ==========================================================================

  describe('Backref Field Storage', () => {
    it('should store backref field in entity data before persistence', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-001', 'Customer', '{"name": "Acme Corp"}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
        generator: async (ctx) => ({
          $id: `order-${Date.now()}`,
          $type: ctx.type,
          orderNumber: 'ORD-001',
          total: 199.99,
        }),
      })

      const result = await resolver.resolve(
        {
          operator: '<-',
          targetType: 'Order',
          fieldName: 'orders',
          backrefField: 'customer',
        },
        { entity: { $id: 'customer-001', $type: 'Customer', name: 'Acme Corp' }, namespace: 'https://shop.com' }
      )

      // Verify backref field is set on generated entity
      expect(result.generated!.customer).toBe('customer-001')

      // Verify backref field is stored in SQLite
      const stored = sqlite
        .prepare('SELECT data FROM things WHERE id = ?')
        .get(result.generated!.$id) as { data: string } | undefined

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

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
        generator: async (ctx) => ({
          $id: `order-${crypto.randomUUID().split('-')[0]}`,
          $type: ctx.type,
          total: Math.random() * 1000,
        }),
      })

      // Generate multiple orders via backward insert
      const context: BackwardResolutionContext = {
        entity: { $id: 'customer-002', $type: 'Customer', name: 'Beta Inc' },
        namespace: 'https://shop.com',
      }

      await resolver.resolve({ operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' }, context)
      await resolver.resolve({ operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' }, context)
      await resolver.resolve({ operator: '<-', targetType: 'Order', fieldName: 'orders', backrefField: 'customer' }, context)

      // Query orders by customer using JSON extract
      const customerOrders = sqlite
        .prepare(`
          SELECT * FROM things
          WHERE type_name = 'Order'
            AND json_extract(data, '$.customer') = ?
        `)
        .all('customer-002') as ThingRow[]

      expect(customerOrders).toHaveLength(3)
      customerOrders.forEach((order) => {
        const data = JSON.parse(order.data)
        expect(data.customer).toBe('customer-002')
      })
    })
  })

  // ==========================================================================
  // VERB DERIVATION WITH STORAGE TESTS
  // ==========================================================================

  describe('Verb Derivation in Stored Relationships', () => {
    it('should store manages -> managedBy derivation', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-vd1', 'Employee', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Manager', fieldName: 'manager', verb: 'manages' },
        { entity: { $id: 'employee-vd1', $type: 'Employee' }, namespace: 'https://hr.com' }
      )

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string }
      expect(rel.verb).toBe('managedBy')
    })

    it('should store owns -> ownedBy derivation', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('product-vd1', 'Product', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Company', fieldName: 'owner', verb: 'owns' },
        { entity: { $id: 'product-vd1', $type: 'Product' }, namespace: 'https://products.com' }
      )

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string }
      expect(rel.verb).toBe('ownedBy')
    })

    it('should store creates -> createdBy derivation', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('document-vd1', 'Document', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Author', fieldName: 'creator', verb: 'creates' },
        { entity: { $id: 'document-vd1', $type: 'Document' }, namespace: 'https://docs.com' }
      )

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string }
      expect(rel.verb).toBe('createdBy')
    })

    it('should store bidirectional parent_of -> child_of derivation', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('child-node', 'ChildNode', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'ParentNode', fieldName: 'parent', verb: 'parent_of' },
        { entity: { $id: 'child-node', $type: 'ChildNode' }, namespace: 'https://tree.com' }
      )

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(result.relationship!.id) as { verb: string }
      expect(rel.verb).toBe('child_of')
    })
  })

  // ==========================================================================
  // ARRAY BACKWARD INSERT WITH STORAGE TESTS
  // ==========================================================================

  describe('Array Backward Insert Storage', () => {
    it('should persist multiple entities from array backward insert', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-arr', 'Startup', '{"name": "ArrayCo"}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'startup-arr', $type: 'Startup', name: 'ArrayCo' },
        namespace: 'https://startups.com',
      }

      // Generate 3 founders
      const results = await Promise.all([
        resolver.resolve({ operator: '<-', targetType: 'Founder', fieldName: 'founders' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Founder', fieldName: 'founders' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Founder', fieldName: 'founders' }, context),
      ])

      // Verify all founders stored
      const founders = sqlite.prepare("SELECT * FROM things WHERE type_name = 'Founder'").all() as ThingRow[]
      expect(founders).toHaveLength(3)

      // Verify all relationships stored with correct direction
      const rels = sqlite.prepare('SELECT * FROM relationships WHERE "to" = ?').all('startup-arr') as RelationshipRow[]
      expect(rels).toHaveLength(3)
      rels.forEach((rel) => {
        expect(rel.to).toBe('startup-arr') // All point TO startup
      })
    })

    it('should persist array relationships with unique IDs', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('product-arr', 'Product', '{}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'product-arr', $type: 'Product' },
        namespace: 'https://products.com',
      }

      // Generate multiple reviews
      const results = await Promise.all([
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
        resolver.resolve({ operator: '<-', targetType: 'Review', fieldName: 'reviews' }, context),
      ])

      // Verify unique relationship IDs
      const rels = sqlite.prepare('SELECT id FROM relationships WHERE "to" = ?').all('product-arr') as { id: string }[]
      const uniqueIds = new Set(rels.map((r) => r.id))
      expect(uniqueIds.size).toBe(2)
    })
  })

  // ==========================================================================
  // CONTEXT PROPAGATION WITH STORAGE TESTS
  // ==========================================================================

  describe('Context Propagation and Storage', () => {
    it('should store context metadata in relationship data', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-ctx', 'Startup', '{"name": "ContextCo", "industry": "AI"}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
        includeMetadata: true,
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
        {
          entity: { $id: 'startup-ctx', $type: 'Startup', name: 'ContextCo', industry: 'AI' },
          namespace: 'https://startups.com',
        }
      )

      const rel = sqlite.prepare('SELECT data FROM relationships WHERE id = ?').get(result.relationship!.id) as { data: string | null }

      expect(rel.data).not.toBeNull()
      const relData = JSON.parse(rel.data!)
      expect(relData.cascadeOperator).toBe('<-')
      expect(relData.generatedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // FULL INTEGRATION FLOW TESTS
  // ==========================================================================

  describe('Complete Backward Insert Integration Flow', () => {
    it('should perform complete backward cascade: generate, store entity, store relationship', async () => {
      const now = Date.now()

      // Setup: Create startup entity
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-full', 'Startup', '{"name": "FullFlowCo", "industry": "Fintech"}', ${now}, ${now})
      `)

      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
        generator: async (ctx) => ({
          $id: `idea-${crypto.randomUUID().split('-')[0]}`,
          $type: ctx.type,
          concept: 'Blockchain payment rails',
          market: 'B2B payments',
        }),
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
        {
          entity: { $id: 'startup-full', $type: 'Startup', name: 'FullFlowCo', industry: 'Fintech' },
          namespace: 'https://fintech.com',
        }
      )

      // Verify complete flow
      // 1. Generated entity returned
      expect(result.generated).toBeDefined()
      expect(result.generated!.$type).toBe('Idea')

      // 2. Entity stored in SQLite
      const storedEntity = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(result.generated!.$id) as ThingRow | undefined
      expect(storedEntity).toBeDefined()
      expect(storedEntity!.type_name).toBe('Idea')

      // 3. Relationship returned
      expect(result.relationship).toBeDefined()
      expect(result.relationship!.from).toBe(result.generated!.$id)
      expect(result.relationship!.to).toBe('startup-full')

      // 4. Relationship stored in SQLite
      const storedRel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(result.relationship!.id) as RelationshipRow | undefined
      expect(storedRel).toBeDefined()
      expect(storedRel!.from).toBe(result.generated!.$id)
      expect(storedRel!.to).toBe('startup-full')

      // 5. Can traverse backward from startup to find its idea
      const startupIdeas = sqlite
        .prepare('SELECT "from" FROM relationships WHERE "to" = ?')
        .all('startup-full') as { from: string }[]
      expect(startupIdeas).toHaveLength(1)
      expect(startupIdeas[0].from).toBe(result.generated!.$id)
    })

    it('should handle transaction rollback on failure', async () => {
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-fail', 'Startup', '{}', ${now}, ${now})
      `)

      // Resolver with failing storage
      const resolver = new BackwardCascadeResolver({
        store: storageAdapter.storeEntity.bind(storageAdapter),
        createRelationship: async () => {
          throw new Error('Relationship storage failed')
        },
      })

      // Should throw and not leave orphan entity
      await expect(
        resolver.resolve(
          { operator: '<-', targetType: 'Idea', fieldName: 'idea' },
          { entity: { $id: 'startup-fail', $type: 'Startup' }, namespace: 'https://fail.com' }
        )
      ).rejects.toThrow('Relationship storage failed')

      // Verify no orphan entities created
      const orphans = sqlite.prepare("SELECT * FROM things WHERE type_name = 'Idea'").all()
      expect(orphans).toHaveLength(0)
    })
  })
})

// ============================================================================
// 2. resolveBackwardInsert Helper with SQLite Storage
// ============================================================================

describe('resolveBackwardInsert with SQLite Storage', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database
  let storageAdapter: SQLiteStorageAdapter

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY,
        type_name TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL
      );
    `)

    storageAdapter = new SQLiteStorageAdapter(sqlite)
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('should use storage adapter when passed to helper', async () => {
    const now = Date.now()
    sqlite.exec(`
      INSERT INTO things (id, type_name, data, created_at, updated_at)
      VALUES ('test-entity', 'Test', '{}', ${now}, ${now})
    `)

    const resolver = new BackwardCascadeResolver({
      store: storageAdapter.storeEntity.bind(storageAdapter),
      createRelationship: storageAdapter.createRelationship.bind(storageAdapter),
    })

    const result = await resolveBackwardInsert(
      { targetType: 'Related', fieldName: 'related' },
      { entity: { $id: 'test-entity', $type: 'Test' }, namespace: 'https://test.com' },
      resolver
    )

    // Verify stored in SQLite
    const stored = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(result.generated!.$id)
    expect(stored).toBeDefined()
  })
})

// ============================================================================
// 3. parseBackwardReference with SQLite Schema Validation
// ============================================================================

describe('parseBackwardReference Schema Validation', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')

    // Create type registry table
    sqlite.exec(`
      CREATE TABLE type_registry (
        type_name TEXT PRIMARY KEY,
        schema_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)

    // Register valid types
    sqlite.exec(`
      INSERT INTO type_registry (type_name, schema_json, created_at) VALUES
      ('Manager', '{"fields": {"name": "string", "department": "string"}}', ${Date.now()}),
      ('Order', '{"fields": {"customer": "string", "total": "number"}}', ${Date.now()}),
      ('Idea', '{"fields": {"concept": "string", "market": "string"}}', ${Date.now()});
    `)
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('should validate targetType exists in type registry', () => {
    const parsed = parseBackwardReference('<-Manager')

    // Verify type is registered
    const registered = sqlite.prepare('SELECT * FROM type_registry WHERE type_name = ?').get(parsed.targetType)
    expect(registered).toBeDefined()
  })

  it('should handle unregistered types gracefully', () => {
    const parsed = parseBackwardReference('<-UnknownType')

    // Type should parse but not be in registry
    expect(parsed.targetType).toBe('UnknownType')
    const registered = sqlite.prepare('SELECT * FROM type_registry WHERE type_name = ?').get(parsed.targetType)
    expect(registered).toBeUndefined()
  })

  it('should parse <-Order.customer with backref field', () => {
    const parsed = parseBackwardReference('<-Order.customer')

    expect(parsed.targetType).toBe('Order')
    expect(parsed.backrefField).toBe('customer')

    // Verify backref field exists in Order schema
    const orderType = sqlite.prepare('SELECT schema_json FROM type_registry WHERE type_name = ?').get('Order') as { schema_json: string }
    const schema = JSON.parse(orderType.schema_json)
    expect(schema.fields.customer).toBeDefined()
  })
})
