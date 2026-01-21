/**
 * Entity Management Integration Tests (do-7rf.6.5)
 *
 * Tests for Things, Events, and Relationships stores using real SQLite storage
 * via vitest-pool-workers and miniflare. NO MOCKS - all tests run against
 * real Durable Object instances with real SQLite persistence.
 *
 * @module do/tests/entities.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Thing, Event, Relationship } from '../../db'
// Import assertions directly to avoid pulling in miniflare utilities
// which require Node.js modules not available in Workers runtime
import {
  expectValidEntity,
  expectValidEvent,
  expectValidRelationship,
} from '../../test-utils/assertions'

// ============================================================================
// TEST HELPER: Get DO stub with real SQLite storage
// ============================================================================

function getTestDO(name: string = 'entities-test-' + Date.now()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// Helper: Make RPC request to DO
// ============================================================================

async function rpc(stub: DurableObjectStub, method: string, args: unknown[] = []) {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  return response
}

// ============================================================================
// TESTS: Entity Management
// ============================================================================

describe('Entity Management (do-7rf.6.5)', () => {
  describe('Things Store Integration', () => {
    it('should create a thing via RPC', async () => {
      const stub = getTestDO()
      const response = await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])

      expect(response.status).toBe(200)

      const thing = await response.json()
      expectValidEntity(thing)
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    it('should get a thing via RPC', async () => {
      const stub = getTestDO()

      // First create
      const createRes = await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Bob' }])
      const created = await createRes.json() as Thing

      // Then get
      const response = await rpc(stub, 'things.get', [created.$id])
      expect(response.status).toBe(200)

      const thing = await response.json() as Thing
      expect(thing.$id).toBe(created.$id)
      expect(thing.name).toBe('Bob')
    })

    it('should update a thing via RPC', async () => {
      const stub = getTestDO()

      // Create
      const createRes = await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Charlie' }])
      const created = await createRes.json() as Thing

      // Update
      const response = await rpc(stub, 'things.update', [created.$id, { name: 'Charles' }])
      expect(response.status).toBe(200)

      const updated = await response.json() as Thing
      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Charles')
    })

    it('should delete a thing via RPC', async () => {
      const stub = getTestDO()

      // Create
      const createRes = await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Diana' }])
      const created = await createRes.json() as Thing

      // Delete
      const response = await rpc(stub, 'things.delete', [created.$id])
      expect(response.status).toBe(200)

      // Verify deleted
      const getRes = await rpc(stub, 'things.get', [created.$id])
      const result = await getRes.json()
      expect(result).toBeNull()
    })

    it('should list things via RPC', async () => {
      const stub = getTestDO()

      // Create multiple
      await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      await rpc(stub, 'things.create', [{ $type: 'Order', total: 100 }])

      // List all
      const response = await rpc(stub, 'things.list', [{}])
      expect(response.status).toBe(200)

      const things = await response.json() as Thing[]
      expect(things.length).toBe(2)
    })

    it('should persist things across stub accesses (real SQLite)', async () => {
      const doName = `entities-persist-${Date.now()}`

      // First access - create a thing
      const stub1 = getTestDO(doName)
      const createRes = await rpc(stub1, 'things.create', [{ $type: 'Customer', name: 'Persistent' }])
      const created = await createRes.json() as Thing

      // Second access - verify thing persists via SQLite
      const stub2 = getTestDO(doName)
      const getRes = await rpc(stub2, 'things.get', [created.$id])
      const retrieved = await getRes.json() as Thing

      expect(retrieved).not.toBeNull()
      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.name).toBe('Persistent')
    })
  })

  describe('Events Store Integration', () => {
    it('should emit an event via RPC', async () => {
      const stub = getTestDO()
      const response = await rpc(stub, 'events.emit', [{ type: 'Customer.created', payload: { name: 'Alice' } }])

      expect(response.status).toBe(200)

      const event = await response.json()
      expectValidEvent(event)
      expect(event.type).toBe('Customer.created')
      expect(event.payload).toEqual({ name: 'Alice' })
    })

    it('should get an event by ID via RPC', async () => {
      const stub = getTestDO()

      // Emit event
      const emitRes = await rpc(stub, 'events.emit', [{ type: 'Customer.created', payload: { name: 'Alice' } }])
      const emitted = await emitRes.json() as Event

      // Get event
      const response = await rpc(stub, 'events.get', [emitted.$id])
      expect(response.status).toBe(200)

      const event = await response.json() as Event
      expect(event.$id).toBe(emitted.$id)
      expect(event.type).toBe('Customer.created')
    })

    it('should query events via RPC', async () => {
      const stub = getTestDO()

      // Emit some events
      await rpc(stub, 'events.emit', [{ type: 'Customer.created', payload: { name: 'Alice' } }])
      await rpc(stub, 'events.emit', [{ type: 'Order.placed', payload: { total: 100 } }])

      // Query
      const response = await rpc(stub, 'events.query', [{ type: 'Customer.created' }])
      expect(response.status).toBe(200)

      const events = await response.json()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('Customer.created')
    })

    it('should persist events across stub accesses (real SQLite)', async () => {
      const doName = `events-persist-${Date.now()}`

      // First access - emit event
      const stub1 = getTestDO(doName)
      const emitRes = await rpc(stub1, 'events.emit', [{ type: 'Test.event', payload: { persistent: true } }])
      const emitted = await emitRes.json() as Event

      // Second access - verify event persists
      const stub2 = getTestDO(doName)
      const getRes = await rpc(stub2, 'events.get', [emitted.$id])
      const retrieved = await getRes.json() as Event

      expect(retrieved).not.toBeNull()
      expect(retrieved.$id).toBe(emitted.$id)
      expect(retrieved.type).toBe('Test.event')
    })
  })

  describe('Relationships Store Integration', () => {
    it('should add a relationship via RPC', async () => {
      const stub = getTestDO()
      const response = await rpc(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])

      expect(response.status).toBe(200)

      const rel = await response.json()
      expectValidRelationship(rel)
      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
    })

    it('should find relationships via RPC', async () => {
      const stub = getTestDO()

      // Add relationships
      await rpc(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])
      await rpc(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-2' }])

      // Find
      const response = await rpc(stub, 'relationships.find', [{ subject: 'user-1', predicate: 'owns' }])
      expect(response.status).toBe(200)

      const rels = await response.json()
      expect(rels.length).toBe(2)
      expect(rels.every((r: any) => r.subject === 'user-1')).toBe(true)
    })

    it('should remove a relationship via RPC', async () => {
      const stub = getTestDO()

      // Add
      await rpc(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])

      // Remove
      const response = await rpc(stub, 'relationships.remove', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])
      expect(response.status).toBe(200)

      // Verify removed
      const findRes = await rpc(stub, 'relationships.find', [{ subject: 'user-1' }])
      const rels = await findRes.json()
      expect(rels.length).toBe(0)
    })

    it('should persist relationships across stub accesses (real SQLite)', async () => {
      const doName = `rels-persist-${Date.now()}`

      // First access - add relationship
      const stub1 = getTestDO(doName)
      await rpc(stub1, 'relationships.add', [{ subject: 'user-persist', predicate: 'owns', object: 'order-persist' }])

      // Second access - verify relationship persists
      const stub2 = getTestDO(doName)
      const findRes = await rpc(stub2, 'relationships.find', [{ subject: 'user-persist', predicate: 'owns' }])
      const rels = await findRes.json() as Relationship[]

      expect(rels.length).toBe(1)
      expect(rels[0].subject).toBe('user-persist')
      expect(rels[0].object).toBe('order-persist')
    })
  })

  describe('Query Interface', () => {
    it('should filter things by type', async () => {
      const stub = getTestDO()

      // Create things of different types
      await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice', active: true }])
      await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Bob', active: false }])
      await rpc(stub, 'things.create', [{ $type: 'Order', total: 100 }])

      // List only Customers
      const response = await rpc(stub, 'things.list', [{ type: 'Customer' }])
      expect(response.status).toBe(200)

      const things = await response.json() as Thing[]
      expect(things.length).toBe(2)
      expect(things.every((t: any) => t.$type === 'Customer')).toBe(true)
    })
  })

  describe('Event Emission on Entity Changes', () => {
    it('should emit Thing.created event when thing is created', async () => {
      const stub = getTestDO()

      // Create a thing
      await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])

      // Query for the creation event
      const response = await rpc(stub, 'events.query', [{ type: 'Thing.created' }])
      const events = await response.json() as Event[]

      expect(events.length).toBeGreaterThan(0)
      const createEvent = events.find((e: any) => e.payload?.$type === 'Customer')
      expect(createEvent).toBeDefined()
    })

    it('should emit Thing.updated event when thing is updated', async () => {
      const stub = getTestDO()

      // Create and update a thing
      const createRes = await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      const created = await createRes.json() as Thing
      await rpc(stub, 'things.update', [created.$id, { name: 'Alicia' }])

      // Query for the update event
      const response = await rpc(stub, 'events.query', [{ type: 'Thing.updated' }])
      const events = await response.json() as Event[]

      expect(events.length).toBeGreaterThan(0)
      const updateEvent = events.find((e: any) => e.payload?.$id === created.$id)
      expect(updateEvent).toBeDefined()
    })

    it('should emit Thing.deleted event when thing is deleted', async () => {
      const stub = getTestDO()

      // Create and delete a thing
      const createRes = await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      const created = await createRes.json() as Thing
      await rpc(stub, 'things.delete', [created.$id])

      // Query for the delete event
      const response = await rpc(stub, 'events.query', [{ type: 'Thing.deleted' }])
      const events = await response.json() as Event[]

      expect(events.length).toBeGreaterThan(0)
      const deleteEvent = events.find((e: any) => e.payload?.$id === created.$id)
      expect(deleteEvent).toBeDefined()
    })

    it('should emit Relationship.added event when relationship is added', async () => {
      const stub = getTestDO()

      // Add a relationship
      await rpc(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])

      // Query for the relationship added event
      const response = await rpc(stub, 'events.query', [{ type: 'Relationship.added' }])
      const events = await response.json() as Event[]

      expect(events.length).toBeGreaterThan(0)
      const addEvent = events.find((e: any) => e.payload?.subject === 'user-1')
      expect(addEvent).toBeDefined()
    })

    it('should emit Relationship.removed event when relationship is removed', async () => {
      const stub = getTestDO()

      // Add and remove a relationship
      await rpc(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])
      await rpc(stub, 'relationships.remove', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])

      // Query for the relationship removed event
      const response = await rpc(stub, 'events.query', [{ type: 'Relationship.removed' }])
      const events = await response.json() as Event[]

      expect(events.length).toBeGreaterThan(0)
      const removeEvent = events.find((e: any) => e.payload?.subject === 'user-1')
      expect(removeEvent).toBeDefined()
    })
  })
})
