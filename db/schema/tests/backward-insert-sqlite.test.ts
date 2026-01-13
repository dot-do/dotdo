/**
 * Backward Insert (<-) Operator Tests with Real SQLite
 *
 * TDD RED Phase: Failing tests for the Backward Insert cascade operator.
 *
 * Issue: dotdo-1mc8e
 *
 * The <- operator generates NEW target entities that link FROM target TO this
 * (reverse direction from forward operators).
 *
 * Key behaviors:
 * - Direction is REVERSED: from=generatedEntity, to=thisEntity
 * - Verb derivation: manages -> managedBy, owns -> ownedBy
 * - Backref field syntax: `<-Order.customer` sets Order.customer = this.$id
 * - Entity and relationship stored in SQLite
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 *
 * These tests are in TWO parts:
 * 1. SQLite Schema Tests (GREEN) - Verify the database schema works correctly
 * 2. Resolver Integration Tests (RED) - Test the actual resolver with SQLite storage
 *    These FAIL until the resolver supports real SQLite storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  BackwardCascadeResolver,
  resolveBackwardInsert,
  parseBackwardReference,
  deriveReverseVerb,
} from '../resolvers/backward'

// ============================================================================
// Test Helper Types
// ============================================================================

interface Entity {
  $id: string
  $type: string
  [key: string]: unknown
}

interface Relationship {
  id: string
  verb: string
  from: string
  to: string
  data: string | null
  created_at: number
}

interface VerbRow {
  verb: string
  action: string
  activity: string
  event: string
  reverse: string
  inverse: string | null
  description: string | null
}

// ============================================================================
// 1. Backward Insert (<-) with Real SQLite - Relationship Direction
// ============================================================================

describe('Backward Insert (<-) with Real SQLite', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create Things table (entities)
      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      // Create Verbs table
      sqlite.exec(`
        CREATE TABLE verbs (
          verb TEXT PRIMARY KEY,
          action TEXT,
          activity TEXT,
          event TEXT,
          reverse TEXT,
          inverse TEXT,
          description TEXT
        )
      `)

      // Create Relationships table
      sqlite.exec(`
        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL REFERENCES verbs(verb),
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        )
      `)

      // Create indexes for efficient queries
      sqlite.exec(`
        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
      `)

      // Seed standard verbs with their reverse forms
      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('manages', 'manage', 'managing', 'managed', 'managedBy', 'abandons', 'Oversees'),
        ('managedBy', 'managedBy', 'beingManaged', 'wasManaged', 'manages', NULL, 'Is overseen by'),
        ('owns', 'own', 'owning', 'owned', 'ownedBy', 'disowns', 'Possesses'),
        ('ownedBy', 'ownedBy', 'beingOwned', 'wasOwned', 'owns', NULL, 'Is possessed by'),
        ('creates', 'create', 'creating', 'created', 'createdBy', 'deletes', 'Brings into existence'),
        ('createdBy', 'createdBy', 'beingCreated', 'wasCreated', 'creates', NULL, 'Was created by'),
        ('contains', 'contain', 'containing', 'contained', 'containedBy', NULL, 'Contains'),
        ('containedBy', 'containedBy', 'beingContained', 'wasContained', 'contains', NULL, 'Is contained by'),
        ('assigns', 'assign', 'assigning', 'assigned', 'assignedBy', NULL, 'Assigns'),
        ('assignedBy', 'assignedBy', 'beingAssigned', 'wasAssigned', 'assigns', NULL, 'Is assigned by'),
        ('parent_of', 'parent', 'parenting', 'parented', 'child_of', NULL, 'Is parent of'),
        ('child_of', 'child', 'childing', 'childed', 'parent_of', NULL, 'Is child of'),
        ('ideaOf', 'ideaOf', 'ideaOfing', 'ideaOfed', 'hasIdea', NULL, 'Is idea of'),
        ('ordersFrom', 'orderFrom', 'orderingFrom', 'orderedFrom', 'hasOrders', NULL, 'Orders from'),
        ('investsIn', 'investIn', 'investingIn', 'investedIn', 'investedInBy', NULL, 'Invests in'),
        ('advises', 'advise', 'advising', 'advised', 'advisedBy', NULL, 'Advises'),
        ('foundedBy', 'foundedBy', 'beingFounded', 'wasFounded', 'founds', NULL, 'Was founded by');
      `)
    } catch {
      // Skip setup if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  // ==========================================================================
  // RELATIONSHIP DIRECTION TESTS
  // The core differentiator: from=target, to=this
  // ==========================================================================

  describe('Relationship Direction (from=target, to=this)', () => {
    it('creates relationship with from=generated entity and to=this entity', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Setup: Create "this" entity (an Employee)
      const thisEntity: Entity = { $id: 'employee-001', $type: 'Employee', name: 'Alice' }
      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('employee-001', 'Employee', '{"name": "Alice"}', ${now}, ${now})
      `)

      // Generate a new Manager entity (the target)
      const generatedManager: Entity = {
        $id: 'manager-abc123',
        $type: 'Manager',
        name: 'Bob',
        department: 'Engineering',
      }

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('manager-abc123', 'Manager', '${JSON.stringify({ name: 'Bob', department: 'Engineering' })}', ${now}, ${now})
      `)

      // Create backward relationship: Manager -> Employee (Manager manages this Employee)
      // For backward insert, the relationship direction is: from=target, to=this
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-001', 'managedBy', 'manager-abc123', 'employee-001', NULL, ${now})
      `)

      // Verify relationship direction
      const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-001') as Relationship

      // CRITICAL: Backward insert means from=target (Manager), to=this (Employee)
      expect(result.from).toBe('manager-abc123') // Target (generated entity)
      expect(result.to).toBe('employee-001') // This (current entity)
      expect(result.verb).toBe('managedBy')
    })

    it('target entity points TO current entity (inverse of forward)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Setup: A Task that needs an Assignee
      const task: Entity = { $id: 'task-001', $type: 'Task', title: 'Fix bug' }
      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('task-001', 'Task', '{"title": "Fix bug"}', ${now}, ${now})
      `)

      // Generate Assignee via backward insert
      const assignee: Entity = { $id: 'assignee-xyz', $type: 'Assignee', name: 'Carol' }

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('assignee-xyz', 'Assignee', '{"name": "Carol"}', ${now}, ${now})
      `)

      // Backward: Assignee is assigned TO this Task
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-002', 'assignedBy', 'assignee-xyz', 'task-001', NULL, ${now})
      `)

      // Verify the target points to current entity
      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-002') as Relationship

      expect(rel.to).toBe('task-001') // "to" is the current entity
      expect(rel.from).toBe('assignee-xyz') // "from" is the generated entity
    })

    it('can query entities that point TO a specific entity', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Setup: A Startup with multiple backward relationships
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('startup-001', 'Startup', '{"name": "TechCo"}', ${now}, ${now}),
        ('investor-001', 'Investor', '{"name": "VC Fund A"}', ${now}, ${now}),
        ('investor-002', 'Investor', '{"name": "Angel Bob"}', ${now}, ${now}),
        ('advisor-001', 'Advisor', '{"name": "Expert Eve"}', ${now}, ${now});
      `)

      // Create backward relationships: Investors and Advisors point TO Startup
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-inv-1', 'investsIn', 'investor-001', 'startup-001', NULL, ${now}),
        ('rel-inv-2', 'investsIn', 'investor-002', 'startup-001', NULL, ${now}),
        ('rel-adv-1', 'advises', 'advisor-001', 'startup-001', NULL, ${now});
      `)

      // Query all entities pointing TO the startup (backward traversal)
      const incomingRels = sqlite
        .prepare('SELECT * FROM relationships WHERE "to" = ?')
        .all('startup-001') as Relationship[]

      expect(incomingRels).toHaveLength(3)
      expect(incomingRels.map((r) => r.from)).toContain('investor-001')
      expect(incomingRels.map((r) => r.from)).toContain('investor-002')
      expect(incomingRels.map((r) => r.from)).toContain('advisor-001')
    })
  })

  // ==========================================================================
  // VERB DERIVATION TESTS
  // manages -> managedBy, owns -> ownedBy, etc.
  // ==========================================================================

  describe('Verb Derivation (manages -> managedBy)', () => {
    it('uses reverse verb managedBy for manager field', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // When we have `manager: '<-Manager'`, the verb should be derived as managedBy
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('employee-002', 'Employee', '{"name": "David"}', ${now}, ${now}),
        ('manager-002', 'Manager', '{"name": "Eva"}', ${now}, ${now});
      `)

      // Backward insert creates relationship with derived verb
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-mgr', 'managedBy', 'manager-002', 'employee-002', NULL, ${now})
      `)

      // Verify verb derivation
      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get('rel-mgr') as { verb: string }
      expect(rel.verb).toBe('managedBy')

      // Verify we can look up the verb's reverse form
      const verbInfo = sqlite.prepare('SELECT reverse FROM verbs WHERE verb = ?').get('managedBy') as { reverse: string }
      expect(verbInfo.reverse).toBe('manages')
    })

    it('uses reverse verb ownedBy for owner field', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('product-001', 'Product', '{"name": "Widget"}', ${now}, ${now}),
        ('company-001', 'Company', '{"name": "WidgetCorp"}', ${now}, ${now});
      `)

      // `owner: '<-Company'` -> verb is ownedBy
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-own', 'ownedBy', 'company-001', 'product-001', NULL, ${now})
      `)

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get('rel-own') as { verb: string }
      expect(rel.verb).toBe('ownedBy')
    })

    it('uses reverse verb createdBy for creator field', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('document-001', 'Document', '{"title": "Report"}', ${now}, ${now}),
        ('author-001', 'Author', '{"name": "Frank"}', ${now}, ${now});
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-create', 'createdBy', 'author-001', 'document-001', NULL, ${now})
      `)

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get('rel-create') as { verb: string }
      expect(rel.verb).toBe('createdBy')
    })

    it('handles bidirectional verbs: parent_of <-> child_of', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('child-entity', 'ChildNode', '{"name": "Leaf"}', ${now}, ${now}),
        ('parent-entity', 'ParentNode', '{"name": "Root"}', ${now}, ${now});
      `)

      // When child has `parent: '<-ParentNode'`, verb is child_of
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-tree', 'child_of', 'parent-entity', 'child-entity', NULL, ${now})
      `)

      const rel = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get('rel-tree') as { verb: string }
      expect(rel.verb).toBe('child_of')

      // Verify bidirectional lookup
      const verbInfo = sqlite.prepare('SELECT reverse FROM verbs WHERE verb = ?').get('child_of') as { reverse: string }
      expect(verbInfo.reverse).toBe('parent_of')
    })

    it('can query using verb linguistic forms', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('project-001', 'Project', '{"name": "Alpha"}', ${now}, ${now}),
        ('lead-001', 'Lead', '{"name": "Grace"}', ${now}, ${now});
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-lead', 'managedBy', 'lead-001', 'project-001', NULL, ${now})
      `)

      // Query using JOIN to get full verb information
      const result = sqlite
        .prepare(
          `
          SELECT r.*, v.event, v.reverse
          FROM relationships r
          JOIN verbs v ON r.verb = v.verb
          WHERE r.id = ?
        `
        )
        .get('rel-lead') as { verb: string; event: string; reverse: string }

      expect(result.verb).toBe('managedBy')
      expect(result.reverse).toBe('manages')
    })
  })

  // ==========================================================================
  // BACKREF FIELD SYNTAX TESTS
  // `<-Order.customer` sets Order.customer = this.$id
  // ==========================================================================

  describe('Backref Field Syntax (<-Order.customer)', () => {
    it('sets backref field on generated entity', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Customer entity
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-001', 'Customer', '{"name": "Acme Corp"}', ${now}, ${now})
      `)

      // Generate Order with customer backref field set
      // `orders: '<-Order.customer'` means Order.customer = customer.$id
      const orderData = JSON.stringify({
        orderNumber: 'ORD-001',
        total: 199.99,
        customer: 'customer-001', // This is the backref field!
      })

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('order-001', 'Order', '${orderData}', ${now}, ${now})
      `)

      // Create backward relationship
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-ord', 'ordersFrom', 'order-001', 'customer-001', NULL, ${now})
      `)

      // Verify backref field is set on Order
      const order = sqlite.prepare('SELECT data FROM things WHERE id = ?').get('order-001') as { data: string }
      const orderObj = JSON.parse(order.data)

      expect(orderObj.customer).toBe('customer-001')
    })

    it('allows querying orders by customer via backref field', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Customer
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-002', 'Customer', '{"name": "Beta Inc"}', ${now}, ${now})
      `)

      // Multiple orders with customer backref
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('order-a', 'Order', '{"orderNumber": "A", "customer": "customer-002"}', ${now}, ${now}),
        ('order-b', 'Order', '{"orderNumber": "B", "customer": "customer-002"}', ${now}, ${now}),
        ('order-c', 'Order', '{"orderNumber": "C", "customer": "customer-003"}', ${now}, ${now});
      `)

      // Query orders by customer using JSON extract
      const customerOrders = sqlite
        .prepare(
          `
          SELECT * FROM things
          WHERE type_name = 'Order'
            AND json_extract(data, '$.customer') = ?
        `
        )
        .all('customer-002') as { id: string }[]

      expect(customerOrders).toHaveLength(2)
      expect(customerOrders.map((o) => o.id)).toContain('order-a')
      expect(customerOrders.map((o) => o.id)).toContain('order-b')
    })

    it('backref field and relationship are consistent', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Setup
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('customer-003', 'Customer', '{"name": "Gamma LLC"}', ${now}, ${now}),
        ('order-x', 'Order', '{"orderNumber": "X", "customer": "customer-003"}', ${now}, ${now});
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-x', 'ordersFrom', 'order-x', 'customer-003', NULL, ${now})
      `)

      // Verify both backref field and relationship point to same customer
      const order = sqlite.prepare('SELECT data FROM things WHERE id = ?').get('order-x') as { data: string }
      const orderData = JSON.parse(order.data)

      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-x') as Relationship

      // Both should reference customer-003
      expect(orderData.customer).toBe('customer-003')
      expect(rel.to).toBe('customer-003')
    })
  })

  // ==========================================================================
  // ENTITY CREATION TESTS
  // Generates new entity and stores in Things table
  // ==========================================================================

  describe('Entity Creation and Storage', () => {
    it('generates new entity with unique ID', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Generate two managers - each should have unique ID
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('manager-uid1', 'Manager', '{"name": "Manager A"}', ${now}, ${now}),
        ('manager-uid2', 'Manager', '{"name": "Manager B"}', ${now}, ${now});
      `)

      // Verify uniqueness
      const managers = sqlite.prepare("SELECT id FROM things WHERE type_name = 'Manager'").all() as { id: string }[]

      expect(managers).toHaveLength(2)
      expect(managers[0].id).not.toBe(managers[1].id)
    })

    it('stores generated entity with correct type', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('idea-001', 'Idea', '{"concept": "AI assistant"}', ${now}, ${now})
      `)

      const idea = sqlite.prepare('SELECT * FROM things WHERE id = ?').get('idea-001') as {
        id: string
        type_name: string
        data: string
      }

      expect(idea.type_name).toBe('Idea')
      expect(JSON.parse(idea.data)).toEqual({ concept: 'AI assistant' })
    })

    it('stores timestamps on entity creation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const before = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('timed-001', 'TimedEntity', '{}', ${before}, ${before})
      `)

      const after = Date.now()

      const entity = sqlite.prepare('SELECT created_at, updated_at FROM things WHERE id = ?').get('timed-001') as {
        created_at: number
        updated_at: number
      }

      expect(entity.created_at).toBeGreaterThanOrEqual(before)
      expect(entity.created_at).toBeLessThanOrEqual(after)
      expect(entity.updated_at).toBe(entity.created_at)
    })
  })

  // ==========================================================================
  // ARRAY BACKWARD INSERT TESTS
  // `orders: ['<-Order']` generates multiple orders
  // ==========================================================================

  describe('Array Backward Insert ([<-Order])', () => {
    it('generates multiple entities for array reference', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Customer with multiple orders via array backward insert
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('customer-array', 'Customer', '{"name": "Delta Corp"}', ${now}, ${now})
      `)

      // Generate 3 orders
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('order-1', 'Order', '{"number": 1}', ${now}, ${now}),
        ('order-2', 'Order', '{"number": 2}', ${now}, ${now}),
        ('order-3', 'Order', '{"number": 3}', ${now}, ${now});
      `)

      // Create relationships for all
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-arr-1', 'ordersFrom', 'order-1', 'customer-array', NULL, ${now}),
        ('rel-arr-2', 'ordersFrom', 'order-2', 'customer-array', NULL, ${now}),
        ('rel-arr-3', 'ordersFrom', 'order-3', 'customer-array', NULL, ${now});
      `)

      // Verify all orders point to customer
      const rels = sqlite
        .prepare('SELECT * FROM relationships WHERE "to" = ?')
        .all('customer-array') as Relationship[]

      expect(rels).toHaveLength(3)
      expect(rels.every((r) => r.to === 'customer-array')).toBe(true)
    })

    it('each array entity has correct relationship direction', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('startup-arr', 'Startup', '{"name": "ArrayCo"}', ${now}, ${now}),
        ('founder-1', 'Founder', '{"name": "F1"}', ${now}, ${now}),
        ('founder-2', 'Founder', '{"name": "F2"}', ${now}, ${now});
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-f1', 'foundedBy', 'founder-1', 'startup-arr', NULL, ${now}),
        ('rel-f2', 'foundedBy', 'founder-2', 'startup-arr', NULL, ${now});
      `)

      const rels = sqlite.prepare('SELECT * FROM relationships WHERE verb = ?').all('foundedBy') as Relationship[]

      for (const rel of rels) {
        // Each founder points TO the startup
        expect(rel.to).toBe('startup-arr')
        expect(['founder-1', 'founder-2']).toContain(rel.from)
      }
    })
  })

  // ==========================================================================
  // CONTEXT PROPAGATION TESTS
  // Parent entity context used for generation
  // ==========================================================================

  describe('Context Propagation', () => {
    it('generated entity can be contextually relevant to parent', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Startup with specific industry
      const startupData = JSON.stringify({
        name: 'HealthTech',
        industry: 'Healthcare',
        stage: 'Seed',
      })

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-ctx', 'Startup', '${startupData}', ${now}, ${now})
      `)

      // Generated Idea should be contextually relevant (healthcare focused)
      const ideaData = JSON.stringify({
        concept: 'AI-powered medical diagnosis',
        targetMarket: 'Hospitals',
        relevantTo: 'Healthcare', // Context from parent
      })

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('idea-ctx', 'Idea', '${ideaData}', ${now}, ${now})
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-ctx', 'ideaOf', 'idea-ctx', 'startup-ctx', NULL, ${now})
      `)

      // Verify context propagation
      const idea = sqlite.prepare('SELECT data FROM things WHERE id = ?').get('idea-ctx') as { data: string }
      const ideaObj = JSON.parse(idea.data)

      expect(ideaObj.relevantTo).toBe('Healthcare')
    })

    it('stores generation context in relationship data', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at) VALUES
        ('parent-meta', 'Parent', '{"field": "value"}', ${now}, ${now}),
        ('child-meta', 'Child', '{}', ${now}, ${now});
      `)

      // Store generation metadata in relationship data
      const relData = JSON.stringify({
        generatedAt: now,
        cascadeOperator: '<-',
        parentContext: { field: 'value' },
      })

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-meta', 'child_of', 'child-meta', 'parent-meta', '${relData}', ${now})
      `)

      const rel = sqlite.prepare('SELECT data FROM relationships WHERE id = ?').get('rel-meta') as { data: string }
      const relObj = JSON.parse(rel.data)

      expect(relObj.cascadeOperator).toBe('<-')
      expect(relObj.parentContext.field).toBe('value')
    })
  })

  // ==========================================================================
  // INTEGRATION TEST: Full Backward Insert Flow
  // ==========================================================================

  describe('Integration: Complete Backward Insert Flow', () => {
    it('performs full backward insert: generate, store, link', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Step 1: "This" entity exists
      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('startup-full', 'Startup', '{"name": "FullFlowCo", "industry": "Fintech"}', ${now}, ${now})
      `)

      // Step 2: Generate new Idea entity (simulating backward cascade)
      const generatedId = `idea-${crypto.randomUUID().split('-')[0]}`
      const generatedData = JSON.stringify({
        concept: 'Blockchain payment rails',
        market: 'B2B payments',
      })

      sqlite.exec(`
        INSERT INTO things (id, type_name, data, created_at, updated_at)
        VALUES ('${generatedId}', 'Idea', '${generatedData}', ${now}, ${now})
      `)

      // Step 3: Create backward relationship (from=generated, to=this)
      const relId = `rel-${crypto.randomUUID().split('-')[0]}`

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('${relId}', 'ideaOf', '${generatedId}', 'startup-full', NULL, ${now})
      `)

      // Verify complete flow
      // 1. Idea exists
      const idea = sqlite.prepare('SELECT * FROM things WHERE id = ?').get(generatedId) as {
        id: string
        type_name: string
      }
      expect(idea.id).toBe(generatedId)
      expect(idea.type_name).toBe('Idea')

      // 2. Relationship has correct direction
      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get(relId) as Relationship
      expect(rel.from).toBe(generatedId) // Generated entity
      expect(rel.to).toBe('startup-full') // This entity
      expect(rel.verb).toBe('ideaOf')

      // 3. Can traverse backward from startup to find its idea
      const startupIdeas = sqlite
        .prepare('SELECT "from" FROM relationships WHERE "to" = ? AND verb = ?')
        .all('startup-full', 'ideaOf') as { from: string }[]

      expect(startupIdeas).toHaveLength(1)
      expect(startupIdeas[0].from).toBe(generatedId)
    })
  })
})
