/**
 * Backward Insert (<-) Operator Tests with Real SQLite
 *
 * TDD RED PHASE: Comprehensive tests for the Backward Insert operator in the Graph Model.
 *
 * @see dotdo-1mc8e - [RED] Backward Insert (<-) operator tests with real SQLite
 *
 * The Graph Model has cascade relationship operators:
 * - `->` Forward insert (parent to child)
 * - `<-` Backward insert (child to parent)
 * - `<->` Bidirectional
 * - `~>` Soft link
 *
 * The Backward Insert (`<-`) operator creates relationships where the child
 * references the parent. This is the inverse of forward insert and is used
 * when the child entity needs to know about its parent.
 *
 * Example semantic: Order `<-` LineItem (LineItem references its Order)
 *
 * NO MOCKS - Uses real Miniflare/SQLite runtime per CLAUDE.md testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphThing, GraphRelationship } from '../types'

// ============================================================================
// TYPES FOR BACKWARD INSERT OPERATIONS
// ============================================================================

/**
 * Direction indicators for cascade operations
 */
type CascadeDirection = 'forward' | 'backward' | 'bidirectional' | 'soft'

/**
 * Cascade operator symbols
 */
const OPERATORS = {
  forward: '->',
  backward: '<-',
  bidirectional: '<->',
  soft: '~>',
} as const

/**
 * Backward insert relationship data structure
 */
interface BackwardInsertData {
  /** Direction indicator */
  direction: 'backward'
  /** Whether cascade deletes should propagate */
  cascadeDelete?: boolean
  /** Whether cascade updates should propagate */
  cascadeUpdate?: boolean
  /** Optional constraint (e.g., 'required', 'optional') */
  constraint?: 'required' | 'optional'
  /** Metadata about the relationship */
  metadata?: Record<string, unknown>
}

/**
 * Relationship verbs used for backward insert
 */
const BACKWARD_INSERT_VERBS = {
  belongsTo: 'belongsTo',       // Child belongs to parent
  referencedBy: 'referencedBy', // Parent is referenced by child
  ownedBy: 'ownedBy',           // Child owned by parent
  partOf: 'partOf',             // Child is part of parent
  memberOf: 'memberOf',         // Child is member of parent
  childOf: 'childOf',           // Child of parent
  createdBy: 'createdBy',       // Created by (attribution)
  managedBy: 'managedBy',       // Managed by parent entity
} as const

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate unique test IDs
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Create a Thing for testing
 */
async function createThing(
  store: SQLiteGraphStore,
  typeName: string,
  data: Record<string, unknown>,
  options?: { id?: string }
): Promise<GraphThing> {
  const typeIdMap: Record<string, number> = {
    Order: 200,
    LineItem: 201,
    Customer: 202,
    Product: 203,
    Category: 204,
    Organization: 205,
    User: 206,
    Team: 207,
    Project: 208,
    Task: 209,
    Comment: 210,
    Document: 211,
    Folder: 212,
    Invoice: 213,
    Payment: 214,
    Subscription: 215,
    Employee: 216,
    Department: 217,
    Permission: 218,
    Role: 219,
  }

  const id = options?.id ?? generateId(typeName.toLowerCase())
  const typeId = typeIdMap[typeName] ?? 999

  return store.createThing({
    id,
    typeId,
    typeName,
    data,
  })
}

/**
 * Create a backward insert relationship
 */
async function createBackwardInsert(
  store: SQLiteGraphStore,
  childId: string,
  parentId: string,
  verb: string,
  options?: {
    cascadeDelete?: boolean
    cascadeUpdate?: boolean
    constraint?: 'required' | 'optional'
    metadata?: Record<string, unknown>
  }
): Promise<GraphRelationship> {
  const relationshipData: BackwardInsertData = {
    direction: 'backward',
    cascadeDelete: options?.cascadeDelete,
    cascadeUpdate: options?.cascadeUpdate,
    constraint: options?.constraint,
    metadata: options?.metadata,
  }

  const relId = generateId('rel')

  return store.createRelationship({
    id: relId,
    verb,
    from: `do://things/${childId}`,
    to: `do://things/${parentId}`,
    data: relationshipData,
  })
}

/**
 * Helper to extract ID from Thing URL
 */
function extractId(url: string): string | null {
  const match = url.match(/do:\/\/things\/(.+)$/)
  return match?.[1] ?? null
}

// ============================================================================
// 1. BASIC BACKWARD INSERT TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Basic Operations', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Creating Backward Insert Relationships', () => {
    it('creates a backward insert relationship (child -> parent)', async () => {
      // Create parent and child
      const order = await createThing(store, 'Order', { number: 'ORD-001', total: 100 })
      const lineItem = await createThing(store, 'LineItem', { quantity: 2, price: 50 })

      // LineItem belongs to Order (backward insert)
      const rel = await createBackwardInsert(store, lineItem.id, order.id, 'belongsTo')

      expect(rel.verb).toBe('belongsTo')
      expect(rel.from).toBe(`do://things/${lineItem.id}`)
      expect(rel.to).toBe(`do://things/${order.id}`)
      expect((rel.data as BackwardInsertData).direction).toBe('backward')
    })

    it('stores cascade options on backward insert', async () => {
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const user = await createThing(store, 'User', { name: 'Alice' })

      const rel = await createBackwardInsert(store, user.id, org.id, 'memberOf', {
        cascadeDelete: true,
        cascadeUpdate: false,
        constraint: 'required',
      })

      const data = rel.data as BackwardInsertData
      expect(data.cascadeDelete).toBe(true)
      expect(data.cascadeUpdate).toBe(false)
      expect(data.constraint).toBe('required')
    })

    it('creates multiple backward inserts from same child to different parents', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const team1 = await createThing(store, 'Team', { name: 'Engineering' })
      const team2 = await createThing(store, 'Team', { name: 'Product' })

      await createBackwardInsert(store, user.id, team1.id, 'memberOf')
      await createBackwardInsert(store, user.id, team2.id, 'memberOf')

      const rels = await store.queryRelationshipsFrom(`do://things/${user.id}`, { verb: 'memberOf' })

      expect(rels).toHaveLength(2)
      const parentIds = rels.map(r => extractId(r.to))
      expect(parentIds).toContain(team1.id)
      expect(parentIds).toContain(team2.id)
    })

    it('creates backward insert with metadata', async () => {
      const department = await createThing(store, 'Department', { name: 'Sales' })
      const employee = await createThing(store, 'Employee', { name: 'Bob' })

      const rel = await createBackwardInsert(store, employee.id, department.id, 'partOf', {
        metadata: {
          role: 'Manager',
          startDate: '2024-01-15',
          reportingLine: 'direct',
        },
      })

      const data = rel.data as BackwardInsertData
      expect(data.metadata).toEqual({
        role: 'Manager',
        startDate: '2024-01-15',
        reportingLine: 'direct',
      })
    })

    it('supports different backward insert verbs', async () => {
      const project = await createThing(store, 'Project', { name: 'Alpha' })
      const task = await createThing(store, 'Task', { title: 'Setup' })

      // Test various backward insert verbs
      const verbs = ['belongsTo', 'partOf', 'childOf', 'ownedBy']

      for (let i = 0; i < verbs.length; i++) {
        const childThing = await createThing(store, 'Task', { title: `Task ${i}` })
        const rel = await createBackwardInsert(store, childThing.id, project.id, verbs[i]!)
        expect(rel.verb).toBe(verbs[i])
      }
    })
  })

  describe('Querying Backward Insert Relationships', () => {
    it('queries all backward inserts from a child', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const team = await createThing(store, 'Team', { name: 'Engineering' })
      const role = await createThing(store, 'Role', { name: 'Developer' })

      await createBackwardInsert(store, user.id, org.id, 'memberOf')
      await createBackwardInsert(store, user.id, team.id, 'memberOf')
      await createBackwardInsert(store, user.id, role.id, 'belongsTo')

      const allRels = await store.queryRelationshipsFrom(`do://things/${user.id}`)

      expect(allRels).toHaveLength(3)
    })

    it('queries backward inserts filtered by verb', async () => {
      const employee = await createThing(store, 'Employee', { name: 'Bob' })
      const department = await createThing(store, 'Department', { name: 'Sales' })
      const manager = await createThing(store, 'User', { name: 'Carol' })

      await createBackwardInsert(store, employee.id, department.id, 'partOf')
      await createBackwardInsert(store, employee.id, manager.id, 'managedBy')

      const partOfRels = await store.queryRelationshipsFrom(`do://things/${employee.id}`, {
        verb: 'partOf',
      })

      expect(partOfRels).toHaveLength(1)
      expect(extractId(partOfRels[0]!.to)).toBe(department.id)
    })

    it('queries children of a parent (reverse lookup)', async () => {
      const category = await createThing(store, 'Category', { name: 'Electronics' })
      const product1 = await createThing(store, 'Product', { name: 'Phone' })
      const product2 = await createThing(store, 'Product', { name: 'Laptop' })
      const product3 = await createThing(store, 'Product', { name: 'Tablet' })

      await createBackwardInsert(store, product1.id, category.id, 'belongsTo')
      await createBackwardInsert(store, product2.id, category.id, 'belongsTo')
      await createBackwardInsert(store, product3.id, category.id, 'belongsTo')

      // Find all products that belong to this category
      const children = await store.queryRelationshipsTo(`do://things/${category.id}`, {
        verb: 'belongsTo',
      })

      expect(children).toHaveLength(3)
      const childIds = children.map(r => extractId(r.from))
      expect(childIds).toContain(product1.id)
      expect(childIds).toContain(product2.id)
      expect(childIds).toContain(product3.id)
    })

    it('queries by verb across all relationships', async () => {
      // Create various backward insert relationships
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const team = await createThing(store, 'Team', { name: 'Engineering' })
      const user1 = await createThing(store, 'User', { name: 'Alice' })
      const user2 = await createThing(store, 'User', { name: 'Bob' })

      await createBackwardInsert(store, user1.id, org.id, 'memberOf')
      await createBackwardInsert(store, user2.id, org.id, 'memberOf')
      await createBackwardInsert(store, user1.id, team.id, 'memberOf')

      const allMemberOf = await store.queryRelationshipsByVerb('memberOf')

      expect(allMemberOf).toHaveLength(3)
      expect(allMemberOf.every(r => r.verb === 'memberOf')).toBe(true)
    })
  })
})

// ============================================================================
// 2. CASCADE BEHAVIOR TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Cascade Behavior', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Cascade Delete Semantics', () => {
    it('marks relationship for cascade delete', async () => {
      const order = await createThing(store, 'Order', { number: 'ORD-001' })
      const lineItem = await createThing(store, 'LineItem', { quantity: 1 })

      const rel = await createBackwardInsert(store, lineItem.id, order.id, 'belongsTo', {
        cascadeDelete: true,
      })

      const data = rel.data as BackwardInsertData
      expect(data.cascadeDelete).toBe(true)
    })

    it('marks relationship to not cascade delete', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const comment = await createThing(store, 'Comment', { text: 'Hello' })

      const rel = await createBackwardInsert(store, comment.id, user.id, 'createdBy', {
        cascadeDelete: false,
      })

      const data = rel.data as BackwardInsertData
      expect(data.cascadeDelete).toBe(false)
    })

    it('finds all children marked for cascade delete', async () => {
      const order = await createThing(store, 'Order', { number: 'ORD-001' })
      const lineItem1 = await createThing(store, 'LineItem', { quantity: 1 })
      const lineItem2 = await createThing(store, 'LineItem', { quantity: 2 })
      const note = await createThing(store, 'Comment', { text: 'Note' })

      // Line items should cascade delete with order
      await createBackwardInsert(store, lineItem1.id, order.id, 'belongsTo', { cascadeDelete: true })
      await createBackwardInsert(store, lineItem2.id, order.id, 'belongsTo', { cascadeDelete: true })
      // Notes should not cascade delete
      await createBackwardInsert(store, note.id, order.id, 'belongsTo', { cascadeDelete: false })

      const children = await store.queryRelationshipsTo(`do://things/${order.id}`, {
        verb: 'belongsTo',
      })

      const cascadeChildren = children.filter(r => {
        const data = r.data as BackwardInsertData
        return data.cascadeDelete === true
      })

      expect(cascadeChildren).toHaveLength(2)
    })

    it('supports cascade delete in multi-level hierarchy', async () => {
      // Create hierarchy: Organization -> Team -> Employee
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const team = await createThing(store, 'Team', { name: 'Engineering' })
      const employee = await createThing(store, 'Employee', { name: 'Alice' })

      // Team belongs to Org (cascade delete)
      await createBackwardInsert(store, team.id, org.id, 'partOf', { cascadeDelete: true })
      // Employee belongs to Team (cascade delete)
      await createBackwardInsert(store, employee.id, team.id, 'memberOf', { cascadeDelete: true })

      // Verify cascade chain exists
      const teamRels = await store.queryRelationshipsFrom(`do://things/${team.id}`, { verb: 'partOf' })
      const empRels = await store.queryRelationshipsFrom(`do://things/${employee.id}`, { verb: 'memberOf' })

      expect(teamRels).toHaveLength(1)
      expect((teamRels[0]!.data as BackwardInsertData).cascadeDelete).toBe(true)
      expect(empRels).toHaveLength(1)
      expect((empRels[0]!.data as BackwardInsertData).cascadeDelete).toBe(true)
    })
  })

  describe('Cascade Update Semantics', () => {
    it('marks relationship for cascade update', async () => {
      const category = await createThing(store, 'Category', { name: 'Electronics', active: true })
      const product = await createThing(store, 'Product', { name: 'Phone' })

      const rel = await createBackwardInsert(store, product.id, category.id, 'belongsTo', {
        cascadeUpdate: true,
      })

      const data = rel.data as BackwardInsertData
      expect(data.cascadeUpdate).toBe(true)
    })

    it('finds children that should receive update cascades', async () => {
      const subscription = await createThing(store, 'Subscription', { status: 'active' })
      const invoice1 = await createThing(store, 'Invoice', { amount: 100 })
      const invoice2 = await createThing(store, 'Invoice', { amount: 200 })
      const payment = await createThing(store, 'Payment', { amount: 100 })

      // Invoices cascade update with subscription status
      await createBackwardInsert(store, invoice1.id, subscription.id, 'belongsTo', {
        cascadeUpdate: true,
      })
      await createBackwardInsert(store, invoice2.id, subscription.id, 'belongsTo', {
        cascadeUpdate: true,
      })
      // Payments don't cascade update
      await createBackwardInsert(store, payment.id, subscription.id, 'belongsTo', {
        cascadeUpdate: false,
      })

      const children = await store.queryRelationshipsTo(`do://things/${subscription.id}`, {
        verb: 'belongsTo',
      })

      const cascadeUpdateChildren = children.filter(r => {
        const data = r.data as BackwardInsertData
        return data.cascadeUpdate === true
      })

      expect(cascadeUpdateChildren).toHaveLength(2)
    })
  })

  describe('Constraint Semantics', () => {
    it('marks backward insert as required', async () => {
      const order = await createThing(store, 'Order', { number: 'ORD-001' })
      const lineItem = await createThing(store, 'LineItem', { quantity: 1 })

      const rel = await createBackwardInsert(store, lineItem.id, order.id, 'belongsTo', {
        constraint: 'required',
      })

      const data = rel.data as BackwardInsertData
      expect(data.constraint).toBe('required')
    })

    it('marks backward insert as optional', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const team = await createThing(store, 'Team', { name: 'Engineering' })

      const rel = await createBackwardInsert(store, user.id, team.id, 'memberOf', {
        constraint: 'optional',
      })

      const data = rel.data as BackwardInsertData
      expect(data.constraint).toBe('optional')
    })

    it('queries children by constraint type', async () => {
      const project = await createThing(store, 'Project', { name: 'Alpha' })
      const task1 = await createThing(store, 'Task', { title: 'Critical' })
      const task2 = await createThing(store, 'Task', { title: 'Nice to have' })
      const task3 = await createThing(store, 'Task', { title: 'Required' })

      await createBackwardInsert(store, task1.id, project.id, 'partOf', { constraint: 'required' })
      await createBackwardInsert(store, task2.id, project.id, 'partOf', { constraint: 'optional' })
      await createBackwardInsert(store, task3.id, project.id, 'partOf', { constraint: 'required' })

      const children = await store.queryRelationshipsTo(`do://things/${project.id}`, {
        verb: 'partOf',
      })

      const requiredChildren = children.filter(r => {
        const data = r.data as BackwardInsertData
        return data.constraint === 'required'
      })

      expect(requiredChildren).toHaveLength(2)
    })
  })
})

// ============================================================================
// 3. TRAVERSAL AND PATH OPERATIONS
// ============================================================================

describe('Backward Insert (<-) Operator - Traversal Operations', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Parent Chain Traversal', () => {
    it('traverses from child to parent', async () => {
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const user = await createThing(store, 'User', { name: 'Alice' })

      await createBackwardInsert(store, user.id, org.id, 'memberOf')

      // Start from user, find parent org
      const rels = await store.queryRelationshipsFrom(`do://things/${user.id}`, { verb: 'memberOf' })

      expect(rels).toHaveLength(1)
      expect(extractId(rels[0]!.to)).toBe(org.id)
    })

    it('traverses multi-level parent chain', async () => {
      // Create: Org -> Division -> Team -> Employee
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const division = await createThing(store, 'Department', { name: 'Engineering Div' })
      const team = await createThing(store, 'Team', { name: 'Platform' })
      const employee = await createThing(store, 'Employee', { name: 'Alice' })

      await createBackwardInsert(store, division.id, org.id, 'partOf')
      await createBackwardInsert(store, team.id, division.id, 'partOf')
      await createBackwardInsert(store, employee.id, team.id, 'memberOf')

      // Traverse from employee up to org
      const chain: string[] = [employee.id]
      let currentId = employee.id
      const visited = new Set<string>()

      while (!visited.has(currentId)) {
        visited.add(currentId)

        // Get parent relationships
        const parentRels = await store.queryRelationshipsFrom(`do://things/${currentId}`)
        const partOfOrMemberOf = parentRels.filter(r =>
          r.verb === 'partOf' || r.verb === 'memberOf'
        )

        if (partOfOrMemberOf.length === 0) break

        const parentId = extractId(partOfOrMemberOf[0]!.to)
        if (!parentId) break

        chain.push(parentId)
        currentId = parentId
      }

      expect(chain).toHaveLength(4)
      expect(chain[0]).toBe(employee.id)
      expect(chain[1]).toBe(team.id)
      expect(chain[2]).toBe(division.id)
      expect(chain[3]).toBe(org.id)
    })

    it('handles diamond inheritance pattern', async () => {
      // Diamond: Employee -> (Team1, Team2) -> both report to Division
      const division = await createThing(store, 'Department', { name: 'Engineering' })
      const team1 = await createThing(store, 'Team', { name: 'Frontend' })
      const team2 = await createThing(store, 'Team', { name: 'Backend' })
      const employee = await createThing(store, 'Employee', { name: 'Full Stack Dev' })

      // Teams belong to division
      await createBackwardInsert(store, team1.id, division.id, 'partOf')
      await createBackwardInsert(store, team2.id, division.id, 'partOf')
      // Employee belongs to both teams
      await createBackwardInsert(store, employee.id, team1.id, 'memberOf')
      await createBackwardInsert(store, employee.id, team2.id, 'memberOf')

      // Find all teams for employee
      const teamRels = await store.queryRelationshipsFrom(`do://things/${employee.id}`, {
        verb: 'memberOf',
      })

      expect(teamRels).toHaveLength(2)

      // Both teams should have same division parent
      for (const teamRel of teamRels) {
        const teamId = extractId(teamRel.to)!
        const divisionRels = await store.queryRelationshipsFrom(`do://things/${teamId}`, {
          verb: 'partOf',
        })
        expect(divisionRels).toHaveLength(1)
        expect(extractId(divisionRels[0]!.to)).toBe(division.id)
      }
    })
  })

  describe('Child Collection Traversal', () => {
    it('finds all children of a parent', async () => {
      const folder = await createThing(store, 'Folder', { name: 'Documents' })
      const doc1 = await createThing(store, 'Document', { name: 'Report.pdf' })
      const doc2 = await createThing(store, 'Document', { name: 'Budget.xlsx' })
      const doc3 = await createThing(store, 'Document', { name: 'Presentation.pptx' })

      await createBackwardInsert(store, doc1.id, folder.id, 'partOf')
      await createBackwardInsert(store, doc2.id, folder.id, 'partOf')
      await createBackwardInsert(store, doc3.id, folder.id, 'partOf')

      const children = await store.queryRelationshipsTo(`do://things/${folder.id}`, {
        verb: 'partOf',
      })

      expect(children).toHaveLength(3)
    })

    it('finds children recursively (descendants)', async () => {
      // Folder structure: Root -> (Folder1, Folder2) -> (Doc1, Doc2)
      const root = await createThing(store, 'Folder', { name: 'Root' })
      const folder1 = await createThing(store, 'Folder', { name: 'Folder1' })
      const folder2 = await createThing(store, 'Folder', { name: 'Folder2' })
      const doc1 = await createThing(store, 'Document', { name: 'Doc1' })
      const doc2 = await createThing(store, 'Document', { name: 'Doc2' })

      await createBackwardInsert(store, folder1.id, root.id, 'partOf')
      await createBackwardInsert(store, folder2.id, root.id, 'partOf')
      await createBackwardInsert(store, doc1.id, folder1.id, 'partOf')
      await createBackwardInsert(store, doc2.id, folder2.id, 'partOf')

      // BFS to find all descendants
      const descendants: string[] = []
      const queue = [root.id]
      const visited = new Set<string>()

      while (queue.length > 0) {
        const currentId = queue.shift()!
        if (visited.has(currentId)) continue
        visited.add(currentId)

        if (currentId !== root.id) {
          descendants.push(currentId)
        }

        const children = await store.queryRelationshipsTo(`do://things/${currentId}`, {
          verb: 'partOf',
        })

        for (const child of children) {
          const childId = extractId(child.from)
          if (childId && !visited.has(childId)) {
            queue.push(childId)
          }
        }
      }

      expect(descendants).toHaveLength(4)
      expect(descendants).toContain(folder1.id)
      expect(descendants).toContain(folder2.id)
      expect(descendants).toContain(doc1.id)
      expect(descendants).toContain(doc2.id)
    })

    it('counts children at each level', async () => {
      const root = await createThing(store, 'Folder', { name: 'Root' })
      const folder1 = await createThing(store, 'Folder', { name: 'Folder1' })
      const folder2 = await createThing(store, 'Folder', { name: 'Folder2' })
      const doc1 = await createThing(store, 'Document', { name: 'Doc1' })
      const doc2 = await createThing(store, 'Document', { name: 'Doc2' })
      const doc3 = await createThing(store, 'Document', { name: 'Doc3' })

      await createBackwardInsert(store, folder1.id, root.id, 'partOf')
      await createBackwardInsert(store, folder2.id, root.id, 'partOf')
      await createBackwardInsert(store, doc1.id, folder1.id, 'partOf')
      await createBackwardInsert(store, doc2.id, folder1.id, 'partOf')
      await createBackwardInsert(store, doc3.id, folder2.id, 'partOf')

      // Count at root level
      const rootChildren = await store.queryRelationshipsTo(`do://things/${root.id}`, {
        verb: 'partOf',
      })
      expect(rootChildren).toHaveLength(2)

      // Count at folder1 level
      const folder1Children = await store.queryRelationshipsTo(`do://things/${folder1.id}`, {
        verb: 'partOf',
      })
      expect(folder1Children).toHaveLength(2)

      // Count at folder2 level
      const folder2Children = await store.queryRelationshipsTo(`do://things/${folder2.id}`, {
        verb: 'partOf',
      })
      expect(folder2Children).toHaveLength(1)
    })
  })
})

// ============================================================================
// 4. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Backward Insert (<-) Operator - Edge Cases', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Self-References', () => {
    it('allows self-referential backward insert', async () => {
      const folder = await createThing(store, 'Folder', { name: 'Self-Ref' })

      // Folder references itself (edge case, but valid)
      const rel = await createBackwardInsert(store, folder.id, folder.id, 'partOf')

      expect(rel.from).toBe(`do://things/${folder.id}`)
      expect(rel.to).toBe(`do://things/${folder.id}`)
    })

    it('handles cycle detection', async () => {
      const a = await createThing(store, 'Folder', { name: 'A' })
      const b = await createThing(store, 'Folder', { name: 'B' })
      const c = await createThing(store, 'Folder', { name: 'C' })

      // Create cycle: A -> B -> C -> A
      await createBackwardInsert(store, a.id, b.id, 'partOf')
      await createBackwardInsert(store, b.id, c.id, 'partOf')
      await createBackwardInsert(store, c.id, a.id, 'partOf')

      // Cycle detection via visited set
      const detectCycle = async (startId: string): Promise<boolean> => {
        const visited = new Set<string>()
        let currentId: string | null = startId

        while (currentId) {
          if (visited.has(currentId)) return true
          visited.add(currentId)

          const rels = await store.queryRelationshipsFrom(`do://things/${currentId}`, {
            verb: 'partOf',
          })
          if (rels.length === 0) break

          currentId = extractId(rels[0]!.to)
        }

        return false
      }

      const hasCycle = await detectCycle(a.id)
      expect(hasCycle).toBe(true)
    })
  })

  describe('Unique Constraints', () => {
    it('rejects duplicate backward insert (same verb, from, to)', async () => {
      const order = await createThing(store, 'Order', { number: 'ORD-001' })
      const lineItem = await createThing(store, 'LineItem', { quantity: 1 })

      await store.createRelationship({
        id: 'rel-1',
        verb: 'belongsTo',
        from: `do://things/${lineItem.id}`,
        to: `do://things/${order.id}`,
        data: { direction: 'backward' },
      })

      // Second identical relationship should fail
      await expect(
        store.createRelationship({
          id: 'rel-2',
          verb: 'belongsTo',
          from: `do://things/${lineItem.id}`,
          to: `do://things/${order.id}`,
          data: { direction: 'backward' },
        })
      ).rejects.toThrow()
    })

    it('allows same from/to with different verbs', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const org = await createThing(store, 'Organization', { name: 'Acme' })

      // User can have multiple relationships to same org
      const rel1 = await createBackwardInsert(store, user.id, org.id, 'memberOf')
      const rel2 = await createBackwardInsert(store, user.id, org.id, 'ownedBy')

      expect(rel1.id).not.toBe(rel2.id)

      const rels = await store.queryRelationshipsFrom(`do://things/${user.id}`)
      expect(rels).toHaveLength(2)
    })
  })

  describe('Orphan Detection', () => {
    it('finds children with no parent (orphans)', async () => {
      const folder = await createThing(store, 'Folder', { name: 'Orphan' })
      const orphan = await createThing(store, 'Document', { name: 'Orphan Doc' })
      const attached = await createThing(store, 'Document', { name: 'Attached Doc' })

      // Only attached has parent
      await createBackwardInsert(store, attached.id, folder.id, 'partOf')

      // Query orphan's parent relationships
      const orphanParents = await store.queryRelationshipsFrom(`do://things/${orphan.id}`, {
        verb: 'partOf',
      })

      expect(orphanParents).toHaveLength(0)
    })

    it('finds parents with no children (childless)', async () => {
      const folder = await createThing(store, 'Folder', { name: 'Empty' })

      const children = await store.queryRelationshipsTo(`do://things/${folder.id}`, {
        verb: 'partOf',
      })

      expect(children).toHaveLength(0)
    })
  })

  describe('Deleted Entity Handling', () => {
    it('relationship persists after parent soft delete', async () => {
      const folder = await createThing(store, 'Folder', { name: 'ToDelete' })
      const doc = await createThing(store, 'Document', { name: 'Child' })

      await createBackwardInsert(store, doc.id, folder.id, 'partOf')

      // Soft delete parent
      await store.deleteThing(folder.id)

      // Relationship should still exist
      const rels = await store.queryRelationshipsFrom(`do://things/${doc.id}`, { verb: 'partOf' })
      expect(rels).toHaveLength(1)
      expect(extractId(rels[0]!.to)).toBe(folder.id)

      // But parent is soft deleted
      const parent = await store.getThing(folder.id)
      expect(parent).toBeNull()
    })

    it('relationship persists after child soft delete', async () => {
      const folder = await createThing(store, 'Folder', { name: 'Parent' })
      const doc = await createThing(store, 'Document', { name: 'ToDelete' })

      await createBackwardInsert(store, doc.id, folder.id, 'partOf')

      // Soft delete child
      await store.deleteThing(doc.id)

      // Query from parent side
      const children = await store.queryRelationshipsTo(`do://things/${folder.id}`, {
        verb: 'partOf',
      })

      // Relationship still exists (referential integrity not enforced at graph level)
      expect(children).toHaveLength(1)
    })
  })

  describe('Empty and Null Handling', () => {
    it('handles empty metadata', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })
      const child = await createThing(store, 'Document', { name: 'Child' })

      const rel = await createBackwardInsert(store, child.id, parent.id, 'partOf', {
        metadata: {},
      })

      const data = rel.data as BackwardInsertData
      expect(data.metadata).toEqual({})
    })

    it('handles null cascade options', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })
      const child = await createThing(store, 'Document', { name: 'Child' })

      const rel = await createBackwardInsert(store, child.id, parent.id, 'partOf')

      const data = rel.data as BackwardInsertData
      expect(data.cascadeDelete).toBeUndefined()
      expect(data.cascadeUpdate).toBeUndefined()
    })
  })
})

// ============================================================================
// 5. MULTI-VERB AND COMPLEX RELATIONSHIPS
// ============================================================================

describe('Backward Insert (<-) Operator - Multi-Verb Relationships', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Different Verb Semantics', () => {
    it('uses belongsTo for ownership without deletion', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const comment = await createThing(store, 'Comment', { text: 'Hello' })

      const rel = await createBackwardInsert(store, comment.id, user.id, 'createdBy', {
        cascadeDelete: false,
      })

      expect(rel.verb).toBe('createdBy')
      const data = rel.data as BackwardInsertData
      expect(data.cascadeDelete).toBe(false)
    })

    it('uses partOf for composition with cascade delete', async () => {
      const order = await createThing(store, 'Order', { number: 'ORD-001' })
      const lineItem = await createThing(store, 'LineItem', { quantity: 1 })

      const rel = await createBackwardInsert(store, lineItem.id, order.id, 'partOf', {
        cascadeDelete: true,
      })

      expect(rel.verb).toBe('partOf')
      const data = rel.data as BackwardInsertData
      expect(data.cascadeDelete).toBe(true)
    })

    it('uses memberOf for association', async () => {
      const team = await createThing(store, 'Team', { name: 'Engineering' })
      const user = await createThing(store, 'User', { name: 'Alice' })

      const rel = await createBackwardInsert(store, user.id, team.id, 'memberOf', {
        cascadeDelete: false,
        metadata: { role: 'member' },
      })

      expect(rel.verb).toBe('memberOf')
    })

    it('uses ownedBy for exclusive ownership', async () => {
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const project = await createThing(store, 'Project', { name: 'Alpha' })

      const rel = await createBackwardInsert(store, project.id, org.id, 'ownedBy', {
        cascadeDelete: true,
        constraint: 'required',
      })

      expect(rel.verb).toBe('ownedBy')
    })

    it('uses managedBy for hierarchical management', async () => {
      const manager = await createThing(store, 'User', { name: 'Carol' })
      const employee = await createThing(store, 'Employee', { name: 'Bob' })

      const rel = await createBackwardInsert(store, employee.id, manager.id, 'managedBy', {
        metadata: { reportingType: 'direct' },
      })

      expect(rel.verb).toBe('managedBy')
    })
  })

  describe('Multi-Verb Queries', () => {
    it('queries all backward inserts across different verbs', async () => {
      const user = await createThing(store, 'User', { name: 'Alice' })
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const team = await createThing(store, 'Team', { name: 'Engineering' })
      const manager = await createThing(store, 'User', { name: 'Bob' })

      await createBackwardInsert(store, user.id, org.id, 'memberOf')
      await createBackwardInsert(store, user.id, team.id, 'memberOf')
      await createBackwardInsert(store, user.id, manager.id, 'managedBy')

      const allRels = await store.queryRelationshipsFrom(`do://things/${user.id}`)

      expect(allRels).toHaveLength(3)

      const verbs = allRels.map(r => r.verb)
      expect(verbs.filter(v => v === 'memberOf')).toHaveLength(2)
      expect(verbs.filter(v => v === 'managedBy')).toHaveLength(1)
    })

    it('aggregates children by verb type', async () => {
      const project = await createThing(store, 'Project', { name: 'Alpha' })
      const task1 = await createThing(store, 'Task', { title: 'Task 1' })
      const task2 = await createThing(store, 'Task', { title: 'Task 2' })
      const user1 = await createThing(store, 'User', { name: 'Alice' })
      const user2 = await createThing(store, 'User', { name: 'Bob' })
      const doc = await createThing(store, 'Document', { name: 'Spec' })

      await createBackwardInsert(store, task1.id, project.id, 'partOf')
      await createBackwardInsert(store, task2.id, project.id, 'partOf')
      await createBackwardInsert(store, user1.id, project.id, 'memberOf')
      await createBackwardInsert(store, user2.id, project.id, 'memberOf')
      await createBackwardInsert(store, doc.id, project.id, 'belongsTo')

      // Aggregate by verb
      const allChildren = await store.queryRelationshipsTo(`do://things/${project.id}`)

      const byVerb: Record<string, number> = {}
      for (const rel of allChildren) {
        byVerb[rel.verb] = (byVerb[rel.verb] ?? 0) + 1
      }

      expect(byVerb['partOf']).toBe(2)
      expect(byVerb['memberOf']).toBe(2)
      expect(byVerb['belongsTo']).toBe(1)
    })
  })
})

// ============================================================================
// 6. PERFORMANCE AND SCALE TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Scale Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Large Child Collections', () => {
    it('handles parent with 100 children', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Big Folder' })

      // Create 100 children
      for (let i = 0; i < 100; i++) {
        const child = await createThing(store, 'Document', { name: `Doc ${i}` })
        await createBackwardInsert(store, child.id, parent.id, 'partOf')
      }

      const children = await store.queryRelationshipsTo(`do://things/${parent.id}`, {
        verb: 'partOf',
      })

      expect(children).toHaveLength(100)
    })

    it('handles deep hierarchy (10 levels)', async () => {
      // Create 10-level deep hierarchy
      const things: GraphThing[] = []

      for (let i = 0; i < 10; i++) {
        const thing = await createThing(store, 'Folder', { name: `Level ${i}` })
        things.push(thing)

        if (i > 0) {
          await createBackwardInsert(store, thing.id, things[i - 1]!.id, 'partOf')
        }
      }

      // Traverse from bottom to top
      let currentId = things[9]!.id
      let depth = 0
      const visited = new Set<string>()

      while (!visited.has(currentId)) {
        visited.add(currentId)
        depth++

        const parentRels = await store.queryRelationshipsFrom(`do://things/${currentId}`, {
          verb: 'partOf',
        })

        if (parentRels.length === 0) break
        const parentId = extractId(parentRels[0]!.to)
        if (!parentId) break
        currentId = parentId
      }

      expect(depth).toBe(10)
    })

    it('handles wide tree (10 children per node, 3 levels)', async () => {
      const root = await createThing(store, 'Folder', { name: 'Root' })
      let totalNodes = 1

      // Level 1: 10 children
      const level1: GraphThing[] = []
      for (let i = 0; i < 10; i++) {
        const child = await createThing(store, 'Folder', { name: `L1-${i}` })
        await createBackwardInsert(store, child.id, root.id, 'partOf')
        level1.push(child)
        totalNodes++
      }

      // Level 2: 10 children per L1 node = 100 children
      const level2: GraphThing[] = []
      for (const l1 of level1) {
        for (let i = 0; i < 10; i++) {
          const child = await createThing(store, 'Document', { name: `L2-${i}` })
          await createBackwardInsert(store, child.id, l1.id, 'partOf')
          level2.push(child)
          totalNodes++
        }
      }

      expect(totalNodes).toBe(111) // 1 + 10 + 100

      // Verify root children
      const rootChildren = await store.queryRelationshipsTo(`do://things/${root.id}`, {
        verb: 'partOf',
      })
      expect(rootChildren).toHaveLength(10)

      // Verify L1 children (should each have 10)
      for (const l1 of level1) {
        const l1Children = await store.queryRelationshipsTo(`do://things/${l1.id}`, {
          verb: 'partOf',
        })
        expect(l1Children).toHaveLength(10)
      }
    })
  })

  describe('Concurrent Operations', () => {
    it('handles concurrent backward insert creation', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })

      // Create 20 children concurrently
      const promises = Array.from({ length: 20 }, async (_, i) => {
        const child = await createThing(store, 'Document', { name: `Doc ${i}` })
        return createBackwardInsert(store, child.id, parent.id, 'partOf')
      })

      await Promise.all(promises)

      const children = await store.queryRelationshipsTo(`do://things/${parent.id}`, {
        verb: 'partOf',
      })

      expect(children).toHaveLength(20)
    })

    it('handles concurrent parent and child queries', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })

      for (let i = 0; i < 10; i++) {
        const child = await createThing(store, 'Document', { name: `Doc ${i}` })
        await createBackwardInsert(store, child.id, parent.id, 'partOf')
      }

      // Run parent and child queries concurrently
      const [children, parentRelsPromises] = await Promise.all([
        store.queryRelationshipsTo(`do://things/${parent.id}`, { verb: 'partOf' }),
        Promise.all(
          Array.from({ length: 5 }, () =>
            store.queryRelationshipsTo(`do://things/${parent.id}`, { verb: 'partOf' })
          )
        ),
      ])

      expect(children).toHaveLength(10)
      for (const rels of parentRelsPromises) {
        expect(rels).toHaveLength(10)
      }
    })
  })
})

// ============================================================================
// 7. RELATIONSHIP DELETION TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Deletion', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Relationship Deletion', () => {
    it('deletes a backward insert relationship', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })
      const child = await createThing(store, 'Document', { name: 'Child' })

      const rel = await createBackwardInsert(store, child.id, parent.id, 'partOf')

      // Verify exists
      let rels = await store.queryRelationshipsFrom(`do://things/${child.id}`, { verb: 'partOf' })
      expect(rels).toHaveLength(1)

      // Delete
      const deleted = await store.deleteRelationship(rel.id)
      expect(deleted).toBe(true)

      // Verify gone
      rels = await store.queryRelationshipsFrom(`do://things/${child.id}`, { verb: 'partOf' })
      expect(rels).toHaveLength(0)
    })

    it('deletes one relationship but keeps others', async () => {
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const team = await createThing(store, 'Team', { name: 'Engineering' })
      const user = await createThing(store, 'User', { name: 'Alice' })

      const orgRel = await createBackwardInsert(store, user.id, org.id, 'memberOf')
      const teamRel = await createBackwardInsert(store, user.id, team.id, 'memberOf')

      // Delete org membership
      await store.deleteRelationship(orgRel.id)

      // Team membership should remain
      const rels = await store.queryRelationshipsFrom(`do://things/${user.id}`, { verb: 'memberOf' })
      expect(rels).toHaveLength(1)
      expect(extractId(rels[0]!.to)).toBe(team.id)
    })

    it('handles deletion of non-existent relationship', async () => {
      const deleted = await store.deleteRelationship('non-existent-id')
      expect(deleted).toBe(false)
    })
  })
})

// ============================================================================
// 8. BIDIRECTIONAL QUERY TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Bidirectional Queries', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('From Child Perspective', () => {
    it('queries parent from child', async () => {
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const user = await createThing(store, 'User', { name: 'Alice' })

      await createBackwardInsert(store, user.id, org.id, 'memberOf')

      const parentRels = await store.queryRelationshipsFrom(`do://things/${user.id}`, {
        verb: 'memberOf',
      })

      expect(parentRels).toHaveLength(1)
      expect(extractId(parentRels[0]!.to)).toBe(org.id)
    })

    it('queries multiple parents from child', async () => {
      const team1 = await createThing(store, 'Team', { name: 'Frontend' })
      const team2 = await createThing(store, 'Team', { name: 'Backend' })
      const user = await createThing(store, 'User', { name: 'Full Stack' })

      await createBackwardInsert(store, user.id, team1.id, 'memberOf')
      await createBackwardInsert(store, user.id, team2.id, 'memberOf')

      const parentRels = await store.queryRelationshipsFrom(`do://things/${user.id}`, {
        verb: 'memberOf',
      })

      expect(parentRels).toHaveLength(2)
      const parentIds = parentRels.map(r => extractId(r.to))
      expect(parentIds).toContain(team1.id)
      expect(parentIds).toContain(team2.id)
    })
  })

  describe('From Parent Perspective', () => {
    it('queries children from parent', async () => {
      const org = await createThing(store, 'Organization', { name: 'Acme' })
      const user1 = await createThing(store, 'User', { name: 'Alice' })
      const user2 = await createThing(store, 'User', { name: 'Bob' })

      await createBackwardInsert(store, user1.id, org.id, 'memberOf')
      await createBackwardInsert(store, user2.id, org.id, 'memberOf')

      const childRels = await store.queryRelationshipsTo(`do://things/${org.id}`, {
        verb: 'memberOf',
      })

      expect(childRels).toHaveLength(2)
      const childIds = childRels.map(r => extractId(r.from))
      expect(childIds).toContain(user1.id)
      expect(childIds).toContain(user2.id)
    })

    it('queries children filtered by verb', async () => {
      const project = await createThing(store, 'Project', { name: 'Alpha' })
      const task = await createThing(store, 'Task', { title: 'Task 1' })
      const user = await createThing(store, 'User', { name: 'Alice' })
      const doc = await createThing(store, 'Document', { name: 'Spec' })

      await createBackwardInsert(store, task.id, project.id, 'partOf')
      await createBackwardInsert(store, user.id, project.id, 'memberOf')
      await createBackwardInsert(store, doc.id, project.id, 'belongsTo')

      const partOfChildren = await store.queryRelationshipsTo(`do://things/${project.id}`, {
        verb: 'partOf',
      })

      expect(partOfChildren).toHaveLength(1)
      expect(extractId(partOfChildren[0]!.from)).toBe(task.id)
    })
  })
})

// ============================================================================
// 9. INTEGRATION WITH FORWARD INSERT TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Integration with Forward Insert', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Mixed Direction Relationships', () => {
    it('supports both backward and forward references between same entities', async () => {
      const order = await createThing(store, 'Order', { number: 'ORD-001' })
      const customer = await createThing(store, 'Customer', { name: 'Alice' })

      // Order references customer (forward from Order perspective)
      await store.createRelationship({
        id: 'rel-forward',
        verb: 'placedBy',
        from: `do://things/${order.id}`,
        to: `do://things/${customer.id}`,
        data: { direction: 'forward' },
      })

      // Order is referenced by customer (backward from Order perspective)
      // Customer "owns" the order
      await store.createRelationship({
        id: 'rel-backward',
        verb: 'placedFor',
        from: `do://things/${order.id}`,
        to: `do://things/${customer.id}`,
        data: { direction: 'backward' },
      })

      // Query from order
      const orderRels = await store.queryRelationshipsFrom(`do://things/${order.id}`)
      expect(orderRels).toHaveLength(2)

      // Query to customer
      const customerRels = await store.queryRelationshipsTo(`do://things/${customer.id}`)
      expect(customerRels).toHaveLength(2)
    })

    it('models many-to-many with backward inserts', async () => {
      // Tags <-> Documents (many-to-many)
      const tag1 = await createThing(store, 'Category', { name: 'Important' })
      const tag2 = await createThing(store, 'Category', { name: 'Review' })
      const doc1 = await createThing(store, 'Document', { name: 'Report' })
      const doc2 = await createThing(store, 'Document', { name: 'Proposal' })

      // Documents belong to tags (backward insert from doc perspective)
      await createBackwardInsert(store, doc1.id, tag1.id, 'belongsTo')
      await createBackwardInsert(store, doc1.id, tag2.id, 'belongsTo')
      await createBackwardInsert(store, doc2.id, tag1.id, 'belongsTo')

      // Query docs for tag1
      const tag1Docs = await store.queryRelationshipsTo(`do://things/${tag1.id}`, {
        verb: 'belongsTo',
      })
      expect(tag1Docs).toHaveLength(2)

      // Query tags for doc1
      const doc1Tags = await store.queryRelationshipsFrom(`do://things/${doc1.id}`, {
        verb: 'belongsTo',
      })
      expect(doc1Tags).toHaveLength(2)
    })
  })
})

// ============================================================================
// 10. TIMESTAMP AND AUDIT TESTS
// ============================================================================

describe('Backward Insert (<-) Operator - Timestamps and Audit', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Relationship Timestamps', () => {
    it('stores creation timestamp on backward insert', async () => {
      const before = Date.now()

      const parent = await createThing(store, 'Folder', { name: 'Parent' })
      const child = await createThing(store, 'Document', { name: 'Child' })

      const rel = await createBackwardInsert(store, child.id, parent.id, 'partOf')

      const after = Date.now()

      expect(rel.createdAt).toBeInstanceOf(Date)
      expect(rel.createdAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(rel.createdAt.getTime()).toBeLessThanOrEqual(after)
    })

    it('queries relationships by time range', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })

      // Create first batch
      for (let i = 0; i < 3; i++) {
        const child = await createThing(store, 'Document', { name: `Early ${i}` })
        await createBackwardInsert(store, child.id, parent.id, 'partOf')
      }

      const midpoint = Date.now()

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))

      // Create second batch
      for (let i = 0; i < 2; i++) {
        const child = await createThing(store, 'Document', { name: `Late ${i}` })
        await createBackwardInsert(store, child.id, parent.id, 'partOf')
      }

      const allChildren = await store.queryRelationshipsTo(`do://things/${parent.id}`, {
        verb: 'partOf',
      })

      // Filter by timestamp (created after midpoint)
      const lateChildren = allChildren.filter(r => r.createdAt.getTime() >= midpoint)

      expect(allChildren).toHaveLength(5)
      expect(lateChildren).toHaveLength(2)
    })
  })

  describe('Audit Trail', () => {
    it('stores audit metadata on backward insert', async () => {
      const parent = await createThing(store, 'Folder', { name: 'Parent' })
      const child = await createThing(store, 'Document', { name: 'Child' })

      const rel = await createBackwardInsert(store, child.id, parent.id, 'partOf', {
        metadata: {
          createdBy: 'user-123',
          reason: 'Document organization',
          source: 'api',
        },
      })

      const data = rel.data as BackwardInsertData
      expect(data.metadata?.createdBy).toBe('user-123')
      expect(data.metadata?.reason).toBe('Document organization')
      expect(data.metadata?.source).toBe('api')
    })
  })
})
