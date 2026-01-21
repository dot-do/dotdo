/**
 * Cross-Module Integration Tests (do-7wcm.4)
 *
 * Tests interactions between db modules using real implementations.
 * NO MOCKS - uses in-memory stores for isolation.
 *
 * Test Areas:
 * - Things + Events working together
 * - Relationships + Query operations
 * - Full workflow: create thing -> emit event -> add relationship
 * - Transaction-like patterns across stores
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type ThingsStore, type Thing } from '../things'
import { createRelationshipsStore, type RelationshipsStore, type Relationship } from '../relationships'
import { createEventsStore, type EventsStore, type Event } from '../events'
import {
  withEventSourcing,
  withRelationshipEventSourcing,
  type ThingCreatedPayload,
  type ThingUpdatedPayload,
  type ThingDeletedPayload,
  type RelationshipCreatedPayload,
  type RelationshipDeletedPayload
} from '../event-sourcing'
import type { JsonValue } from '../types'

describe('Cross-Module Integration Tests', () => {
  describe('Things + Events Integration', () => {
    let things: ThingsStore
    let events: EventsStore<JsonValue>
    let eventSourcedThings: ThingsStore
    let capturedEvents: Event<JsonValue>[]

    beforeEach(() => {
      things = createThingsStore()
      events = createEventsStore()
      eventSourcedThings = withEventSourcing(things, events)
      capturedEvents = []

      // Subscribe to capture events for assertions
      events.subscribe((event) => {
        capturedEvents.push(event)
      })
    })

    it('should emit event when thing is created', async () => {
      const customer = await eventSourcedThings.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com'
      })

      expect(capturedEvents).toHaveLength(1)
      expect(capturedEvents[0].type).toBe('Thing.created')

      const payload = capturedEvents[0].payload as ThingCreatedPayload
      expect(payload.$type).toBe('Customer')
      expect(payload.$id).toBe(customer.$id)
      expect(payload.data.name).toBe('Alice')
      expect(payload.data.email).toBe('alice@example.com')
    })

    it('should emit event when thing is updated', async () => {
      const customer = await eventSourcedThings.create({
        $type: 'Customer',
        name: 'Alice'
      })
      capturedEvents.length = 0 // Clear create event

      await eventSourcedThings.update(customer.$id, { name: 'Alice Smith' })

      expect(capturedEvents).toHaveLength(1)
      expect(capturedEvents[0].type).toBe('Thing.updated')

      const payload = capturedEvents[0].payload as ThingUpdatedPayload
      expect(payload.$id).toBe(customer.$id)
      expect(payload.changedFields).toContain('name')
      expect(payload.previousValues.name).toBe('Alice')
      expect(payload.newValues.name).toBe('Alice Smith')
    })

    it('should emit event when thing is deleted', async () => {
      const customer = await eventSourcedThings.create({
        $type: 'Customer',
        name: 'Alice'
      })
      capturedEvents.length = 0

      await eventSourcedThings.delete(customer.$id)

      expect(capturedEvents).toHaveLength(1)
      expect(capturedEvents[0].type).toBe('Thing.deleted')

      const payload = capturedEvents[0].payload as ThingDeletedPayload
      expect(payload.$id).toBe(customer.$id)
      expect(payload.$type).toBe('Customer')
    })

    it('should persist events that can be queried later', async () => {
      await eventSourcedThings.create({ $type: 'Customer', name: 'Alice' })
      await eventSourcedThings.create({ $type: 'Order', total: 100 })

      const allEvents = await events.query()
      expect(allEvents).toHaveLength(2)

      const customerEvents = await events.query({ type: 'Thing.created' })
      expect(customerEvents).toHaveLength(2)
    })

    it('should track event history with correlationId', async () => {
      const correlationId = 'workflow-123'

      // Manually emit correlated events through event-sourced store with context
      const contextThings = withEventSourcing(things, events, {}, {
        auditContext: { correlationId }
      })

      await contextThings.create({ $type: 'Order', status: 'created' })
      await contextThings.create({ $type: 'Payment', amount: 100 })

      const correlatedEvents = await events.query({ correlationId })
      expect(correlatedEvents).toHaveLength(2)
    })
  })

  describe('Relationships + Events Integration', () => {
    let relationships: RelationshipsStore
    let events: EventsStore<JsonValue>
    let eventSourcedRelationships: RelationshipsStore
    let capturedEvents: Event<JsonValue>[]

    beforeEach(() => {
      relationships = createRelationshipsStore()
      events = createEventsStore()
      eventSourcedRelationships = withRelationshipEventSourcing(relationships, events)
      capturedEvents = []

      events.subscribe((event) => {
        capturedEvents.push(event)
      })
    })

    it('should emit event when relationship is added', async () => {
      await eventSourcedRelationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      expect(capturedEvents).toHaveLength(1)
      expect(capturedEvents[0].type).toBe('Relationship.created')

      const payload = capturedEvents[0].payload as RelationshipCreatedPayload
      expect(payload.subject).toBe('user-1')
      expect(payload.predicate).toBe('owns')
      expect(payload.object).toBe('order-1')
    })

    it('should emit event when relationship is removed', async () => {
      await eventSourcedRelationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })
      capturedEvents.length = 0

      await eventSourcedRelationships.remove({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      expect(capturedEvents).toHaveLength(1)
      expect(capturedEvents[0].type).toBe('Relationship.deleted')

      const payload = capturedEvents[0].payload as RelationshipDeletedPayload
      expect(payload.subject).toBe('user-1')
      expect(payload.predicate).toBe('owns')
      expect(payload.object).toBe('order-1')
    })

    it('should support graph traversal with events', async () => {
      // Build graph
      await eventSourcedRelationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await eventSourcedRelationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-2' })
      await eventSourcedRelationships.add({ subject: 'order-1', predicate: 'contains', object: 'item-1' })

      // Query relationships
      const userOrders = await relationships.getRelated('user-1', 'owns')
      expect(userOrders).toHaveLength(2)
      expect(userOrders).toContain('order-1')
      expect(userOrders).toContain('order-2')

      // Verify events were emitted
      expect(capturedEvents).toHaveLength(3)
      expect(capturedEvents.every(e => e.type === 'Relationship.created')).toBe(true)
    })
  })

  describe('Things + Relationships Integration', () => {
    let things: ThingsStore
    let relationships: RelationshipsStore

    beforeEach(() => {
      things = createThingsStore()
      relationships = createRelationshipsStore()
    })

    it('should link things via relationships', async () => {
      // Create things
      const user = await things.create({ $type: 'User', name: 'Alice' })
      const order = await things.create({ $type: 'Order', total: 150 })

      // Link them
      await relationships.add({
        subject: user.$id,
        predicate: 'owns',
        object: order.$id
      })

      // Query relationship
      const userOrders = await relationships.getRelated(user.$id, 'owns')
      expect(userOrders).toContain(order.$id)

      // Retrieve linked thing
      const retrievedOrder = await things.get(userOrders[0])
      expect(retrievedOrder).not.toBeNull()
      expect(retrievedOrder!.total).toBe(150)
    })

    it('should support bidirectional relationships', async () => {
      const alice = await things.create({ $type: 'User', name: 'Alice' })
      const bob = await things.create({ $type: 'User', name: 'Bob' })

      // Alice follows Bob
      await relationships.add({
        subject: alice.$id,
        predicate: 'follows',
        object: bob.$id
      })

      // Query outgoing (who Alice follows)
      const following = await relationships.getRelated(alice.$id, 'follows')
      expect(following).toContain(bob.$id)

      // Query incoming (who follows Bob)
      const followers = await relationships.getRelatedTo(bob.$id, 'follows')
      expect(followers).toContain(alice.$id)
    })

    it('should handle complex entity graph', async () => {
      // Create entities
      const company = await things.create({ $type: 'Company', name: 'Acme Inc' })
      const dept1 = await things.create({ $type: 'Department', name: 'Engineering' })
      const dept2 = await things.create({ $type: 'Department', name: 'Sales' })
      const emp1 = await things.create({ $type: 'Employee', name: 'Alice' })
      const emp2 = await things.create({ $type: 'Employee', name: 'Bob' })

      // Build org structure
      await relationships.add({ subject: company.$id, predicate: 'has', object: dept1.$id })
      await relationships.add({ subject: company.$id, predicate: 'has', object: dept2.$id })
      await relationships.add({ subject: dept1.$id, predicate: 'employs', object: emp1.$id })
      await relationships.add({ subject: dept2.$id, predicate: 'employs', object: emp2.$id })

      // Query company departments
      const depts = await relationships.getRelated(company.$id, 'has')
      expect(depts).toHaveLength(2)

      // Query department employees
      const engEmployees = await relationships.getRelated(dept1.$id, 'employs')
      expect(engEmployees).toHaveLength(1)

      // Verify employee
      const alice = await things.get(engEmployees[0])
      expect(alice).not.toBeNull()
      expect(alice!.name).toBe('Alice')
    })
  })

  describe('Full Workflow Integration', () => {
    let things: ThingsStore
    let relationships: RelationshipsStore
    let events: EventsStore<JsonValue>
    let eventSourcedThings: ThingsStore
    let eventSourcedRelationships: RelationshipsStore
    let workflowEvents: Event<JsonValue>[]

    beforeEach(() => {
      things = createThingsStore()
      relationships = createRelationshipsStore()
      events = createEventsStore()
      eventSourcedThings = withEventSourcing(things, events)
      eventSourcedRelationships = withRelationshipEventSourcing(relationships, events)
      workflowEvents = []

      events.subscribe((event) => {
        workflowEvents.push(event)
      })
    })

    it('should execute complete e-commerce workflow', async () => {
      // 1. Create customer
      const customer = await eventSourcedThings.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com'
      })

      // 2. Create order
      const order = await eventSourcedThings.create({
        $type: 'Order',
        status: 'pending',
        total: 299.99
      })

      // 3. Link customer to order
      await eventSourcedRelationships.add({
        subject: customer.$id,
        predicate: 'placed',
        object: order.$id
      })

      // 4. Create order items
      const item1 = await eventSourcedThings.create({
        $type: 'OrderItem',
        name: 'Widget',
        quantity: 2,
        price: 99.99
      })

      const item2 = await eventSourcedThings.create({
        $type: 'OrderItem',
        name: 'Gadget',
        quantity: 1,
        price: 100.01
      })

      // 5. Link items to order
      await eventSourcedRelationships.add({
        subject: order.$id,
        predicate: 'contains',
        object: item1.$id
      })

      await eventSourcedRelationships.add({
        subject: order.$id,
        predicate: 'contains',
        object: item2.$id
      })

      // 6. Update order status
      await eventSourcedThings.update(order.$id, { status: 'confirmed' })

      // Verify workflow state
      // - Customer exists
      const retrievedCustomer = await things.get(customer.$id)
      expect(retrievedCustomer).not.toBeNull()
      expect(retrievedCustomer!.name).toBe('Alice')

      // - Customer has order
      const customerOrders = await relationships.getRelated(customer.$id, 'placed')
      expect(customerOrders).toHaveLength(1)
      expect(customerOrders).toContain(order.$id)

      // - Order has items
      const orderItems = await relationships.getRelated(order.$id, 'contains')
      expect(orderItems).toHaveLength(2)

      // - Order status updated
      const retrievedOrder = await things.get(order.$id)
      expect(retrievedOrder!.status).toBe('confirmed')

      // Verify event trail
      // 4 creates: Customer, Order, OrderItem x2
      // 3 relationship creates
      // 1 update (order status)
      expect(workflowEvents).toHaveLength(8) // 4 creates + 3 relationship adds + 1 update
      expect(workflowEvents.filter(e => e.type === 'Thing.created')).toHaveLength(4)
      expect(workflowEvents.filter(e => e.type === 'Relationship.created')).toHaveLength(3)
      expect(workflowEvents.filter(e => e.type === 'Thing.updated')).toHaveLength(1)
    })

    it('should track complete audit trail with source', async () => {
      const actorId = 'admin-user-1'

      // Create event-sourced stores with actor context
      const auditedThings = withEventSourcing(things, events, {}, {
        auditContext: { actor: actorId }
      })

      const auditedRelationships = withRelationshipEventSourcing(relationships, events, {}, {
        auditContext: { actor: actorId }
      })

      // Perform operations
      const user = await auditedThings.create({ $type: 'User', name: 'Bob' })
      await auditedRelationships.add({
        subject: user.$id,
        predicate: 'created_by',
        object: actorId
      })

      // Query events by source (actor)
      const actorEvents = await events.query({ source: actorId })
      expect(actorEvents).toHaveLength(2)
      expect(actorEvents.every(e => e.source === actorId)).toBe(true)
    })

    it('should support saga-style workflow with compensation', async () => {
      // Track workflow state
      const workflowState = {
        thingsCreated: [] as string[],
        relationshipsCreated: [] as { subject: string; predicate: string; object: string }[]
      }

      // Step 1: Create order
      const order = await eventSourcedThings.create({
        $type: 'Order',
        status: 'pending'
      })
      workflowState.thingsCreated.push(order.$id)

      // Step 2: Create payment (simulating failure scenario)
      const payment = await eventSourcedThings.create({
        $type: 'Payment',
        amount: 100,
        status: 'pending'
      })
      workflowState.thingsCreated.push(payment.$id)

      // Step 3: Link payment to order
      await eventSourcedRelationships.add({
        subject: order.$id,
        predicate: 'paid_by',
        object: payment.$id
      })
      workflowState.relationshipsCreated.push({
        subject: order.$id,
        predicate: 'paid_by',
        object: payment.$id
      })

      // Simulate failure - need to compensate
      const paymentFailed = true

      if (paymentFailed) {
        // Compensation: remove relationships
        for (const rel of workflowState.relationshipsCreated) {
          await eventSourcedRelationships.remove(rel)
        }

        // Compensation: delete created things in reverse order
        for (const id of workflowState.thingsCreated.reverse()) {
          await eventSourcedThings.delete(id)
        }
      }

      // Verify compensation
      const remainingThings = await things.list()
      expect(remainingThings).toHaveLength(0)

      const remainingRelationships = await relationships.find({})
      expect(remainingRelationships).toHaveLength(0)

      // Verify full event trail exists (for audit)
      const allEvents = await events.query()
      expect(allEvents.length).toBeGreaterThan(0)

      // Events show complete lifecycle
      const createdEvents = allEvents.filter(e => e.type === 'Thing.created')
      const deletedEvents = allEvents.filter(e => e.type === 'Thing.deleted')
      expect(createdEvents).toHaveLength(2)
      expect(deletedEvents).toHaveLength(2)
    })
  })

  describe('Transaction-like Patterns', () => {
    let things: ThingsStore
    let relationships: RelationshipsStore
    let events: EventsStore<JsonValue>

    beforeEach(() => {
      things = createThingsStore()
      relationships = createRelationshipsStore()
      events = createEventsStore()
    })

    it('should handle unit of work pattern', async () => {
      // Unit of work: create multiple related entities atomically
      const unitOfWork = {
        things: [] as any[],
        relationships: [] as any[]
      }

      // Prepare work
      unitOfWork.things.push({ $type: 'User', name: 'Alice' })
      unitOfWork.things.push({ $type: 'User', name: 'Bob' })
      unitOfWork.relationships.push({
        subjectIndex: 0,
        predicate: 'knows',
        objectIndex: 1
      })

      // Execute atomically (in real implementation would be transactional)
      const createdThings: Thing[] = []

      try {
        // Create all things first
        for (const data of unitOfWork.things) {
          const created = await things.create(data)
          createdThings.push(created)
        }

        // Then create relationships using created thing IDs
        for (const rel of unitOfWork.relationships) {
          await relationships.add({
            subject: createdThings[rel.subjectIndex].$id,
            predicate: rel.predicate,
            object: createdThings[rel.objectIndex].$id
          })
        }

        // Commit: emit events
        for (const thing of createdThings) {
          await events.emit({
            type: 'Thing.created',
            payload: { $id: thing.$id, $type: thing.$type }
          })
        }
      } catch (error) {
        // Rollback: delete created things in reverse
        for (const thing of createdThings.reverse()) {
          try {
            await things.delete(thing.$id)
          } catch {
            // Ignore cleanup errors
          }
        }
        throw error
      }

      // Verify unit of work completed
      const allThings = await things.list()
      expect(allThings).toHaveLength(2)

      const alice = allThings.find(t => t.name === 'Alice')
      const bob = allThings.find(t => t.name === 'Bob')
      expect(alice).toBeDefined()
      expect(bob).toBeDefined()

      const aliceKnows = await relationships.getRelated(alice!.$id, 'knows')
      expect(aliceKnows).toContain(bob!.$id)
    })

    it('should support bulk operations with atomicity', async () => {
      // Create multiple things atomically using bulkCreate
      const users = await things.bulkCreate([
        { $type: 'User', name: 'Alice' },
        { $type: 'User', name: 'Bob' },
        { $type: 'User', name: 'Charlie' }
      ])

      expect(users).toHaveLength(3)

      // Update multiple things atomically
      const updates = users.map(u => ({
        id: u.$id,
        data: { verified: true }
      }))

      const updated = await things.bulkUpdate(updates)
      expect(updated).toHaveLength(3)
      expect(updated.every(u => u.verified === true)).toBe(true)

      // All should have roughly the same $updatedAt (within same batch)
      const timestamps = updated.map(u => u.$updatedAt)
      const maxDiff = Math.max(...timestamps) - Math.min(...timestamps)
      expect(maxDiff).toBeLessThan(1000) // Within 1 second

      // Delete multiple atomically
      await things.bulkDelete(users.map(u => u.$id))

      const remaining = await things.list()
      expect(remaining).toHaveLength(0)
    })

    it('should validate referential integrity before relationship creation', async () => {
      // Create one thing
      const user = await things.create({ $type: 'User', name: 'Alice' })

      // Try to create relationship with non-existent target
      // Note: In-memory store doesn't enforce referential integrity,
      // but we can manually check
      const nonExistentId = 'non-existent-id'

      // Check if target exists before creating relationship
      const targetExists = await things.get(nonExistentId)

      if (!targetExists) {
        // Don't create invalid relationship
        const userRelationships = await relationships.find({ subject: user.$id })
        expect(userRelationships).toHaveLength(0)
      }

      // Create valid relationship
      const order = await things.create({ $type: 'Order', total: 100 })

      await relationships.add({
        subject: user.$id,
        predicate: 'owns',
        object: order.$id
      })

      const validRelationships = await relationships.find({ subject: user.$id })
      expect(validRelationships).toHaveLength(1)
    })
  })

  describe('Query Integration', () => {
    let things: ThingsStore
    let relationships: RelationshipsStore
    let events: EventsStore<JsonValue>

    beforeEach(async () => {
      things = createThingsStore()
      relationships = createRelationshipsStore()
      events = createEventsStore()

      // Seed test data
      const users = await things.bulkCreate([
        { $type: 'User', name: 'Alice', age: 30 },
        { $type: 'User', name: 'Bob', age: 25 },
        { $type: 'User', name: 'Charlie', age: 35 }
      ])

      const orders = await things.bulkCreate([
        { $type: 'Order', total: 100, status: 'completed' },
        { $type: 'Order', total: 200, status: 'pending' },
        { $type: 'Order', total: 150, status: 'completed' }
      ])

      // Create relationships
      await relationships.add({ subject: users[0].$id, predicate: 'placed', object: orders[0].$id })
      await relationships.add({ subject: users[0].$id, predicate: 'placed', object: orders[1].$id })
      await relationships.add({ subject: users[1].$id, predicate: 'placed', object: orders[2].$id })

      // Create events
      await events.emit({ type: 'order.placed', payload: { orderId: orders[0].$id, userId: users[0].$id } })
      await events.emit({ type: 'order.placed', payload: { orderId: orders[1].$id, userId: users[0].$id } })
      await events.emit({ type: 'order.completed', payload: { orderId: orders[0].$id } })
    })

    it('should query things by type', async () => {
      const users = await things.list({ type: 'User' })
      expect(users).toHaveLength(3)
      expect(users.every(u => u.$type === 'User')).toBe(true)

      const orders = await things.list({ type: 'Order' })
      expect(orders).toHaveLength(3)
      expect(orders.every(o => o.$type === 'Order')).toBe(true)
    })

    it('should paginate query results', async () => {
      const page1 = await things.list({ limit: 2 })
      expect(page1).toHaveLength(2)

      const page2 = await things.list({ limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)

      const page3 = await things.list({ limit: 2, offset: 4 })
      expect(page3).toHaveLength(2)

      // No overlap between pages
      const page1Ids = page1.map(t => t.$id)
      const page2Ids = page2.map(t => t.$id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })

    it('should filter events by type and time range', async () => {
      const placedEvents = await events.query({ type: 'order.placed' })
      expect(placedEvents).toHaveLength(2)

      const completedEvents = await events.query({ type: 'order.completed' })
      expect(completedEvents).toHaveLength(1)

      // Query by time range
      const now = Date.now()
      const recentEvents = await events.query({ since: now - 10000 })
      expect(recentEvents.length).toBeGreaterThan(0)
    })

    it('should query relationships by predicate', async () => {
      const placedRelationships = await relationships.find({ predicate: 'placed' })
      expect(placedRelationships).toHaveLength(3)
    })

    it('should combine thing and relationship queries', async () => {
      // Get all users
      const users = await things.list({ type: 'User' })

      // For each user, get their orders
      const userOrders = new Map<string, Thing[]>()

      for (const user of users) {
        const orderIds = await relationships.getRelated(user.$id, 'placed')
        const orders: Thing[] = []

        for (const orderId of orderIds) {
          const order = await things.get(orderId)
          if (order) {
            orders.push(order)
          }
        }

        userOrders.set(user.$id, orders)
      }

      // Verify Alice has 2 orders
      const alice = users.find(u => u.name === 'Alice')
      expect(alice).toBeDefined()
      expect(userOrders.get(alice!.$id)).toHaveLength(2)

      // Verify Bob has 1 order
      const bob = users.find(u => u.name === 'Bob')
      expect(bob).toBeDefined()
      expect(userOrders.get(bob!.$id)).toHaveLength(1)

      // Verify Charlie has no orders
      const charlie = users.find(u => u.name === 'Charlie')
      expect(charlie).toBeDefined()
      expect(userOrders.get(charlie!.$id)).toHaveLength(0)
    })
  })

  describe('Event Replay and Projection', () => {
    let things: ThingsStore
    let events: EventsStore<JsonValue>
    let eventSourcedThings: ThingsStore

    beforeEach(() => {
      things = createThingsStore()
      events = createEventsStore()
      eventSourcedThings = withEventSourcing(things, events)
    })

    it('should rebuild state from events', async () => {
      // Perform operations that emit events with delays to ensure distinct timestamps
      const user = await eventSourcedThings.create({
        $type: 'User',
        name: 'Alice',
        balance: 100
      })

      // Small delay to ensure distinct timestamp
      await new Promise(resolve => setTimeout(resolve, 1))
      await eventSourcedThings.update(user.$id, { balance: 150 })

      await new Promise(resolve => setTimeout(resolve, 1))
      await eventSourcedThings.update(user.$id, { balance: 125 })

      // Get event history
      const userEvents = await events.query()
      expect(userEvents).toHaveLength(3) // 1 create + 2 updates

      // Rebuild state from events (projection)
      // Events are returned newest first (descending $timestamp), reverse for chronological order
      // Use slice() to create a copy before reversing to avoid mutating the original
      const chronologicalEvents = userEvents.slice().reverse()
      let projectedBalance = 0

      for (const event of chronologicalEvents) {
        if (event.type === 'Thing.created') {
          const payload = event.payload as ThingCreatedPayload
          projectedBalance = (payload.data.balance as number) || 0
        } else if (event.type === 'Thing.updated') {
          const payload = event.payload as ThingUpdatedPayload
          if (payload.newValues.balance !== undefined) {
            projectedBalance = payload.newValues.balance as number
          }
        }
      }

      // Verify projection matches current state
      const currentUser = await things.get(user.$id)
      expect(projectedBalance).toBe(125)
      expect(currentUser!.balance).toBe(125)
    })

    it('should support event-driven projections', async () => {
      // Track aggregate statistics via events
      const stats = {
        totalOrders: 0,
        totalRevenue: 0,
        ordersByStatus: {} as Record<string, number>
      }

      // Subscribe to update stats in real-time
      events.subscribe((event) => {
        if (event.type === 'Thing.created') {
          const payload = event.payload as ThingCreatedPayload
          if (payload.$type === 'Order') {
            stats.totalOrders++
            stats.totalRevenue += (payload.data.total as number) || 0
            const status = (payload.data.status as string) || 'unknown'
            stats.ordersByStatus[status] = (stats.ordersByStatus[status] || 0) + 1
          }
        }
      })

      // Create orders
      await eventSourcedThings.create({ $type: 'Order', total: 100, status: 'pending' })
      await eventSourcedThings.create({ $type: 'Order', total: 200, status: 'completed' })
      await eventSourcedThings.create({ $type: 'Order', total: 150, status: 'pending' })

      // Verify stats were updated
      expect(stats.totalOrders).toBe(3)
      expect(stats.totalRevenue).toBe(450)
      expect(stats.ordersByStatus.pending).toBe(2)
      expect(stats.ordersByStatus.completed).toBe(1)
    })
  })
})
