/**
 * Entity Management Integration Tests - Real Durable Objects with Miniflare
 *
 * This file uses @cloudflare/vitest-pool-workers to test with REAL Durable Objects.
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * @module do/tests/entities.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Thing, Event, Relationship } from '../../db'
import {
  expectValidEntity,
  expectValidEvent,
  expectValidRelationship,
} from '../../test-utils'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ThingWithName extends Thing {
  name?: string
  active?: boolean
  total?: number
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

/**
 * Make an RPC call to the DO
 */
async function rpc<T>(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<T> {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })

  // Handle void responses (delete, remove operations return no content)
  const text = await response.text()
  if (!text) {
    return undefined as unknown as T
  }
  return JSON.parse(text) as T
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Entity Management (do-7rf.6.5)', () => {
  describe('Things Store Integration', () => {
    it('should create a thing via RPC', async () => {
      const stub = getStub()

      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      expectValidEntity(thing)
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    it('should get a thing via RPC', async () => {
      const stub = getStub()

      // First create
      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Bob' }
      ])

      // Then get
      const thing = await rpc<ThingWithName>(stub, 'things.get', [created.$id])

      expect(thing.$id).toBe(created.$id)
      expect(thing.name).toBe('Bob')
    })

    it('should update a thing via RPC', async () => {
      const stub = getStub()

      // Create
      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Charlie' }
      ])

      // Update
      const updated = await rpc<ThingWithName>(stub, 'things.update', [
        created.$id,
        { name: 'Charles' }
      ])

      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Charles')
    })

    it('should delete a thing via RPC', async () => {
      const stub = getStub()

      // Create
      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Diana' }
      ])

      // Delete
      await rpc<void>(stub, 'things.delete', [created.$id])

      // Verify deleted
      const result = await rpc<Thing | null>(stub, 'things.get', [created.$id])
      expect(result).toBeNull()
    })

    it('should list things via RPC', async () => {
      const stub = getStub()

      // Create multiple
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Order', total: 100 }])

      // List all
      const things = await rpc<Thing[]>(stub, 'things.list', [{}])
      expect(things.length).toBe(2)
    })
  })

  describe('Events Store Integration', () => {
    it('should emit an event via RPC', async () => {
      const stub = getStub()

      const event = await rpc<Event>(stub, 'events.emit', [
        { type: 'Customer.created', payload: { name: 'Alice' } }
      ])

      expectValidEvent(event)
      expect(event.type).toBe('Customer.created')
      expect(event.payload).toEqual({ name: 'Alice' })
    })

    it('should query events via RPC', async () => {
      const stub = getStub()

      // Emit some events
      await rpc<Event>(stub, 'events.emit', [
        { type: 'Customer.created', payload: { name: 'Alice' } }
      ])
      await rpc<Event>(stub, 'events.emit', [
        { type: 'Order.placed', payload: { total: 100 } }
      ])

      // Query
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Customer.created' }
      ])

      expect(events.length).toBe(1)
      expect(events[0].type).toBe('Customer.created')
    })
  })

  describe('Relationships Store Integration', () => {
    it('should add a relationship via RPC', async () => {
      const stub = getStub()

      const rel = await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      expectValidRelationship(rel)
      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
    })

    it('should find relationships via RPC', async () => {
      const stub = getStub()

      // Add relationships
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-2' }
      ])

      // Find
      const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
        { subject: 'user-1', predicate: 'owns' }
      ])

      expect(rels.length).toBe(2)
      expect(rels.every((r) => r.subject === 'user-1')).toBe(true)
    })

    it('should remove a relationship via RPC', async () => {
      const stub = getStub()

      // Add
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Remove
      await rpc<void>(stub, 'relationships.remove', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Verify removed
      const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
        { subject: 'user-1' }
      ])
      expect(rels.length).toBe(0)
    })
  })

  describe('Event Emission on Entity Changes', () => {
    it('should emit event when thing is created', async () => {
      const stub = getStub()

      // Create a thing
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      // Query for Thing.created events
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Thing.created' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const createEvent = events.find(e => {
        const payload = e.payload as { $type?: string }
        return payload?.$type === 'Customer'
      })
      expect(createEvent).toBeDefined()
    })

    it('should emit event when thing is updated', async () => {
      const stub = getStub()

      // Create
      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      // Update
      await rpc<Thing>(stub, 'things.update', [created.$id, { name: 'Alicia' }])

      // Query for Thing.updated events
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Thing.updated' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const updateEvent = events.find(e => {
        const payload = e.payload as { $id?: string }
        return payload?.$id === created.$id
      })
      expect(updateEvent).toBeDefined()
    })

    it('should emit event when thing is deleted', async () => {
      const stub = getStub()

      // Create
      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      // Delete
      await rpc<void>(stub, 'things.delete', [created.$id])

      // Query for Thing.deleted events
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Thing.deleted' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const deleteEvent = events.find(e => {
        const payload = e.payload as { $id?: string }
        return payload?.$id === created.$id
      })
      expect(deleteEvent).toBeDefined()
    })

    it('should emit event when relationship is added', async () => {
      const stub = getStub()

      // Add relationship
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Query for Relationship.added events
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Relationship.added' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const addEvent = events.find(e => {
        const payload = e.payload as { subject?: string }
        return payload?.subject === 'user-1'
      })
      expect(addEvent).toBeDefined()
    })

    it('should emit event when relationship is removed', async () => {
      const stub = getStub()

      // Add relationship
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Remove relationship
      await rpc<void>(stub, 'relationships.remove', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Query for Relationship.removed events
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Relationship.removed' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const removeEvent = events.find(e => {
        const payload = e.payload as { subject?: string }
        return payload?.subject === 'user-1'
      })
      expect(removeEvent).toBeDefined()
    })
  })
})
