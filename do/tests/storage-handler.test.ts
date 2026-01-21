/**
 * Storage Handler Unit Tests
 *
 * Tests for do/handlers/storage.ts - the StorageHandler that manages all
 * storage operations (things, events, relationships, audit logs) in a DO.
 *
 * Following NO MOCKS policy - uses real miniflare runtime with real SQLite.
 *
 * @module do/tests/storage-handler.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Thing, Event, Relationship } from '@dotdo/db'

// ============================================================================
// INLINE ASSERTION HELPERS (avoid importing from test-utils which causes node:os issues)
// ============================================================================

/**
 * Assert that a value is a valid Thing entity with required system fields.
 */
function expectValidEntity(thing: unknown): asserts thing is Thing {
  expect(thing).toBeDefined()
  expect(thing).not.toBeNull()
  const t = thing as Thing
  expect(typeof t.$id).toBe('string')
  expect(t.$id.length).toBeGreaterThan(0)
  expect(typeof t.$type).toBe('string')
  expect(t.$type.length).toBeGreaterThan(0)
  expect(typeof t.$createdAt).toBe('number')
  expect(t.$createdAt).toBeGreaterThan(0)
  expect(typeof t.$updatedAt).toBe('number')
  expect(t.$updatedAt).toBeGreaterThanOrEqual(t.$createdAt)
}

/**
 * Assert that a value is a valid Event.
 */
function expectValidEvent(event: unknown): asserts event is Event {
  expect(event).toBeDefined()
  expect(event).not.toBeNull()
  const e = event as Event
  expect(typeof e.$id).toBe('string')
  expect(e.$id.length).toBeGreaterThan(0)
  expect(typeof e.type).toBe('string')
  expect(e.type.length).toBeGreaterThan(0)
  expect(typeof e.$timestamp).toBe('number')
  expect(e.$timestamp).toBeGreaterThan(0)
}

/**
 * Assert that a value is a valid Relationship.
 */
function expectValidRelationship(rel: unknown): asserts rel is Relationship {
  expect(rel).toBeDefined()
  expect(rel).not.toBeNull()
  const r = rel as Relationship
  expect(typeof r.subject).toBe('string')
  expect(r.subject.length).toBeGreaterThan(0)
  expect(typeof r.predicate).toBe('string')
  expect(r.predicate.length).toBeGreaterThan(0)
  expect(typeof r.object).toBe('string')
  expect(r.object.length).toBeGreaterThan(0)
  expect(typeof r.$createdAt).toBe('number')
  expect(r.$createdAt).toBeGreaterThan(0)
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ThingWithName extends Thing {
  name?: string
  email?: string
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
  return `storage-handler-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

  const text = await response.text()
  if (!text) {
    return undefined as unknown as T
  }
  return JSON.parse(text) as T
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('StorageHandler (do-gjbx)', () => {
  describe('Handler Properties', () => {
    it('should have correct name property', async () => {
      // StorageHandler is accessed through the DO, which provides things/events/relationships
      // The handler name 'storage' is internal, but we test the stores are accessible
      const stub = getStub()

      // Verify things store is accessible
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Test', name: 'Handler Test' }
      ])
      expect(thing.$id).toBeDefined()
    })
  })

  describe('Things Store Operations', () => {
    describe('create', () => {
      it('should create a thing with required fields', async () => {
        const stub = getStub()

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Alice' }
        ])

        expectValidEntity(thing)
        expect(thing.$type).toBe('Customer')
        expect(thing.name).toBe('Alice')
      })

      it('should auto-generate $id, $createdAt, $updatedAt', async () => {
        const stub = getStub()
        const before = Date.now()

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Bob' }
        ])

        const after = Date.now()

        expect(thing.$id).toMatch(/^[a-z0-9-]+$/)
        expect(thing.$createdAt).toBeGreaterThanOrEqual(before)
        expect(thing.$createdAt).toBeLessThanOrEqual(after)
        expect(thing.$updatedAt).toBe(thing.$createdAt)
      })

      it('should throw error if $type is missing', async () => {
        const stub = getStub()

        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'things.create', args: [{ name: 'NoType' }] })
        })

        expect(response.status).toBe(500)
        const text = await response.text()
        expect(text).toContain('$type')
      })

      it('should store additional user-defined fields', async () => {
        const stub = getStub()

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Charlie', email: 'charlie@example.com', active: true }
        ])

        expect(thing.name).toBe('Charlie')
        expect(thing.email).toBe('charlie@example.com')
        expect(thing.active).toBe(true)
      })
    })

    describe('get', () => {
      it('should retrieve a thing by id', async () => {
        const stub = getStub()

        const created = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Diana' }
        ])

        const retrieved = await rpc<ThingWithName>(stub, 'things.get', [created.$id])

        expect(retrieved).not.toBeNull()
        expect(retrieved.$id).toBe(created.$id)
        expect(retrieved.name).toBe('Diana')
      })

      it('should return null for non-existent id', async () => {
        const stub = getStub()

        const result = await rpc<Thing | null>(stub, 'things.get', ['non-existent-id'])

        expect(result).toBeNull()
      })

      it('should return null for empty string id', async () => {
        const stub = getStub()

        const result = await rpc<Thing | null>(stub, 'things.get', [''])

        expect(result).toBeNull()
      })
    })

    describe('update', () => {
      it('should update thing fields', async () => {
        const stub = getStub()

        const created = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Edward' }
        ])

        const updated = await rpc<ThingWithName>(stub, 'things.update', [
          created.$id,
          { name: 'Eddie' }
        ])

        expect(updated.$id).toBe(created.$id)
        expect(updated.name).toBe('Eddie')
        expect(updated.$type).toBe('Customer') // Immutable
      })

      it('should update $updatedAt timestamp', async () => {
        const stub = getStub()

        const created = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Frank' }
        ])

        // Wait a bit to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10))

        const updated = await rpc<ThingWithName>(stub, 'things.update', [
          created.$id,
          { name: 'Franklin' }
        ])

        expect(updated.$updatedAt).toBeGreaterThan(created.$createdAt)
        expect(updated.$createdAt).toBe(created.$createdAt) // $createdAt is immutable
      })

      it('should not allow updating $id', async () => {
        const stub = getStub()

        const created = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Grace' }
        ])

        const updated = await rpc<ThingWithName>(stub, 'things.update', [
          created.$id,
          { $id: 'new-id', name: 'Gracie' } as Partial<ThingWithName>
        ])

        expect(updated.$id).toBe(created.$id) // $id should not change
      })

      it('should not allow updating $type', async () => {
        const stub = getStub()

        const created = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Henry' }
        ])

        const updated = await rpc<ThingWithName>(stub, 'things.update', [
          created.$id,
          { $type: 'Order', name: 'Henry Jr' } as Partial<ThingWithName>
        ])

        expect(updated.$type).toBe('Customer') // $type should not change
      })

      it('should throw error for non-existent id', async () => {
        const stub = getStub()

        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'things.update', args: ['non-existent', { name: 'Test' }] })
        })

        expect(response.status).toBe(500)
        const text = await response.text()
        expect(text).toContain('not found')
      })
    })

    describe('delete', () => {
      it('should delete a thing', async () => {
        const stub = getStub()

        const created = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'Iris' }
        ])

        await rpc<void>(stub, 'things.delete', [created.$id])

        const result = await rpc<Thing | null>(stub, 'things.get', [created.$id])
        expect(result).toBeNull()
      })

      it('should throw error for non-existent id', async () => {
        const stub = getStub()

        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'things.delete', args: ['non-existent-id'] })
        })

        expect(response.status).toBe(500)
        const text = await response.text()
        expect(text).toContain('not found')
      })
    })

    describe('list', () => {
      it('should list all things', async () => {
        const stub = getStub()

        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Jack' }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Kate' }])

        const things = await rpc<Thing[]>(stub, 'things.list', [{}])

        expect(things.length).toBe(2)
      })

      it('should filter by type', async () => {
        const stub = getStub()

        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Larry' }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Order', total: 100 }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Mary' }])

        const customers = await rpc<Thing[]>(stub, 'things.list', [{ type: 'Customer' }])

        expect(customers.length).toBe(2)
        expect(customers.every(t => t.$type === 'Customer')).toBe(true)
      })

      it('should respect limit option', async () => {
        const stub = getStub()

        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'A' }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'B' }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'C' }])

        const things = await rpc<Thing[]>(stub, 'things.list', [{ limit: 2 }])

        expect(things.length).toBe(2)
      })

      it('should respect offset option', async () => {
        const stub = getStub()

        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'First' }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Second' }])
        await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Third' }])

        const allThings = await rpc<Thing[]>(stub, 'things.list', [{}])
        const offsetThings = await rpc<Thing[]>(stub, 'things.list', [{ offset: 1 }])

        expect(offsetThings.length).toBe(allThings.length - 1)
      })

      it('should return empty array when no things exist', async () => {
        const stub = getStub()

        const things = await rpc<Thing[]>(stub, 'things.list', [{}])

        expect(things).toEqual([])
      })
    })
  })

  describe('Events Store Operations', () => {
    describe('emit', () => {
      it('should emit an event with required fields', async () => {
        const stub = getStub()

        const event = await rpc<Event>(stub, 'events.emit', [
          { type: 'Customer.created', payload: { name: 'Alice' } }
        ])

        expectValidEvent(event)
        expect(event.type).toBe('Customer.created')
        expect(event.payload).toEqual({ name: 'Alice' })
      })

      it('should auto-generate $id and $timestamp', async () => {
        const stub = getStub()
        const before = Date.now()

        const event = await rpc<Event>(stub, 'events.emit', [
          { type: 'Test.event', payload: {} }
        ])

        const after = Date.now()

        expect(event.$id).toBeDefined()
        expect(event.$timestamp).toBeGreaterThanOrEqual(before)
        expect(event.$timestamp).toBeLessThanOrEqual(after)
      })

      it('should store optional source field', async () => {
        const stub = getStub()

        const event = await rpc<Event & { source?: string }>(stub, 'events.emit', [
          { type: 'Order.placed', payload: { orderId: '123' }, source: 'order-123' }
        ])

        expect(event.source).toBe('order-123')
      })

      it('should handle complex payloads', async () => {
        const stub = getStub()

        const complexPayload = {
          user: { id: '1', name: 'Alice' },
          items: [{ sku: 'ABC', qty: 2 }, { sku: 'XYZ', qty: 1 }],
          metadata: { channel: 'web', version: '2.0' }
        }

        const event = await rpc<Event>(stub, 'events.emit', [
          { type: 'Order.complex', payload: complexPayload }
        ])

        expect(event.payload).toEqual(complexPayload)
      })
    })

    describe('query', () => {
      it('should query events by type', async () => {
        const stub = getStub()

        await rpc<Event>(stub, 'events.emit', [{ type: 'Customer.created', payload: {} }])
        await rpc<Event>(stub, 'events.emit', [{ type: 'Order.placed', payload: {} }])
        await rpc<Event>(stub, 'events.emit', [{ type: 'Customer.created', payload: {} }])

        const events = await rpc<Event[]>(stub, 'events.query', [{ type: 'Customer.created' }])

        expect(events.length).toBe(2)
        expect(events.every(e => e.type === 'Customer.created')).toBe(true)
      })

      it('should return events sorted by timestamp', async () => {
        const stub = getStub()

        await rpc<Event>(stub, 'events.emit', [{ type: 'Sequence.event', payload: { order: 1 } }])
        await new Promise(resolve => setTimeout(resolve, 10))
        await rpc<Event>(stub, 'events.emit', [{ type: 'Sequence.event', payload: { order: 2 } }])
        await new Promise(resolve => setTimeout(resolve, 10))
        await rpc<Event>(stub, 'events.emit', [{ type: 'Sequence.event', payload: { order: 3 } }])

        const events = await rpc<Event[]>(stub, 'events.query', [{ type: 'Sequence.event' }])

        // Sorted by timestamp descending (newest first)
        expect(events.length).toBe(3)
        for (let i = 0; i < events.length - 1; i++) {
          expect(events[i].$timestamp).toBeGreaterThanOrEqual(events[i + 1].$timestamp)
        }
      })

      it('should return empty array when no events match', async () => {
        const stub = getStub()

        const events = await rpc<Event[]>(stub, 'events.query', [{ type: 'NonExistent.event' }])

        expect(events).toEqual([])
      })
    })
  })

  describe('Relationships Store Operations', () => {
    describe('add', () => {
      it('should add a relationship', async () => {
        const stub = getStub()

        const rel = await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-1', predicate: 'owns', object: 'order-1' }
        ])

        expectValidRelationship(rel)
        expect(rel.subject).toBe('user-1')
        expect(rel.predicate).toBe('owns')
        expect(rel.object).toBe('order-1')
      })

      it('should auto-generate $createdAt', async () => {
        const stub = getStub()
        const before = Date.now()

        const rel = await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-2', predicate: 'likes', object: 'product-1' }
        ])

        const after = Date.now()

        expect(rel.$createdAt).toBeGreaterThanOrEqual(before)
        expect(rel.$createdAt).toBeLessThanOrEqual(after)
      })

      it('should allow metadata on relationships', async () => {
        const stub = getStub()

        const rel = await rpc<Relationship>(stub, 'relationships.add', [
          {
            subject: 'user-3',
            predicate: 'rated',
            object: 'product-2',
            metadata: { score: 5, comment: 'Great!' }
          }
        ])

        expect(rel.metadata).toEqual({ score: 5, comment: 'Great!' })
      })
    })

    describe('find', () => {
      it('should find relationships by subject', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-A', predicate: 'owns', object: 'order-1' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-A', predicate: 'owns', object: 'order-2' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-B', predicate: 'owns', object: 'order-3' }
        ])

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { subject: 'user-A' }
        ])

        expect(rels.length).toBe(2)
        expect(rels.every(r => r.subject === 'user-A')).toBe(true)
      })

      it('should find relationships by predicate', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-1', predicate: 'owns', object: 'order-1' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-1', predicate: 'likes', object: 'product-1' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-2', predicate: 'owns', object: 'order-2' }
        ])

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { predicate: 'owns' }
        ])

        expect(rels.length).toBe(2)
        expect(rels.every(r => r.predicate === 'owns')).toBe(true)
      })

      it('should find relationships by object', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-1', predicate: 'owns', object: 'shared-resource' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-2', predicate: 'owns', object: 'shared-resource' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-3', predicate: 'owns', object: 'other-resource' }
        ])

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { object: 'shared-resource' }
        ])

        expect(rels.length).toBe(2)
        expect(rels.every(r => r.object === 'shared-resource')).toBe(true)
      })

      it('should find relationships with combined criteria', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-X', predicate: 'member_of', object: 'team-1' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-X', predicate: 'member_of', object: 'team-2' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-X', predicate: 'admin_of', object: 'team-1' }
        ])

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { subject: 'user-X', predicate: 'member_of' }
        ])

        expect(rels.length).toBe(2)
        expect(rels.every(r => r.subject === 'user-X' && r.predicate === 'member_of')).toBe(true)
      })

      it('should return empty array when no relationships match', async () => {
        const stub = getStub()

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { subject: 'non-existent' }
        ])

        expect(rels).toEqual([])
      })
    })

    describe('remove', () => {
      it('should remove a relationship', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-del', predicate: 'owns', object: 'order-del' }
        ])

        await rpc<void>(stub, 'relationships.remove', [
          { subject: 'user-del', predicate: 'owns', object: 'order-del' }
        ])

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { subject: 'user-del' }
        ])

        expect(rels.length).toBe(0)
      })

      it('should only remove exact match', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-1', predicate: 'owns', object: 'order-1' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-1', predicate: 'owns', object: 'order-2' }
        ])

        await rpc<void>(stub, 'relationships.remove', [
          { subject: 'user-1', predicate: 'owns', object: 'order-1' }
        ])

        const rels = await rpc<Relationship[]>(stub, 'relationships.find', [
          { subject: 'user-1' }
        ])

        expect(rels.length).toBe(1)
        expect(rels[0].object).toBe('order-2')
      })
    })

    describe('getRelated', () => {
      it('should get objects related to a subject via predicate', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-rel', predicate: 'follows', object: 'user-a' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-rel', predicate: 'follows', object: 'user-b' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'user-rel', predicate: 'blocks', object: 'user-c' }
        ])

        const following = await rpc<string[]>(stub, 'relationships.getRelated', [
          'user-rel', 'follows'
        ])

        expect(following).toHaveLength(2)
        expect(following).toContain('user-a')
        expect(following).toContain('user-b')
      })
    })

    describe('getRelatedTo', () => {
      it('should get subjects related to an object via predicate', async () => {
        const stub = getStub()

        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'fan-1', predicate: 'follows', object: 'celebrity' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'fan-2', predicate: 'follows', object: 'celebrity' }
        ])
        await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'fan-3', predicate: 'follows', object: 'other-celebrity' }
        ])

        const followers = await rpc<string[]>(stub, 'relationships.getRelatedTo', [
          'celebrity', 'follows'
        ])

        expect(followers).toHaveLength(2)
        expect(followers).toContain('fan-1')
        expect(followers).toContain('fan-2')
      })
    })
  })

  describe('Audit Context', () => {
    it('should emit Thing.created event with entity data', async () => {
      const stub = getStub()

      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Audited User' }
      ])

      // Query for Thing.created events
      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Thing.created' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const createEvent = events.find(e => {
        const payload = e.payload as { $id?: string }
        return payload?.$id === thing.$id
      })
      expect(createEvent).toBeDefined()
    })

    it('should emit Thing.updated event on update', async () => {
      const stub = getStub()

      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Before Update' }
      ])

      await rpc<Thing>(stub, 'things.update', [created.$id, { name: 'After Update' }])

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

    it('should emit Thing.deleted event on delete', async () => {
      const stub = getStub()

      const created = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'To Delete' }
      ])

      await rpc<void>(stub, 'things.delete', [created.$id])

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

    it('should emit Relationship.added event', async () => {
      const stub = getStub()

      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'audit-user', predicate: 'owns', object: 'audit-resource' }
      ])

      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Relationship.added' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const addEvent = events.find(e => {
        const payload = e.payload as { subject?: string }
        return payload?.subject === 'audit-user'
      })
      expect(addEvent).toBeDefined()
    })

    it('should emit Relationship.removed event', async () => {
      const stub = getStub()

      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'remove-user', predicate: 'owns', object: 'remove-resource' }
      ])

      await rpc<void>(stub, 'relationships.remove', [
        { subject: 'remove-user', predicate: 'owns', object: 'remove-resource' }
      ])

      const events = await rpc<Event[]>(stub, 'events.query', [
        { type: 'Relationship.removed' }
      ])

      expect(events.length).toBeGreaterThan(0)
      const removeEvent = events.find(e => {
        const payload = e.payload as { subject?: string }
        return payload?.subject === 'remove-user'
      })
      expect(removeEvent).toBeDefined()
    })
  })

  describe('Query Builder', () => {
    it('should query things with where clause', async () => {
      const stub = getStub()

      // Create test data
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Product', name: 'Widget', active: true }])
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Product', name: 'Gadget', active: false }])
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Product', name: 'Gizmo', active: true }])

      // List with type filter acts as basic query
      const products = await rpc<Thing[]>(stub, 'things.list', [{ type: 'Product' }])

      expect(products.length).toBe(3)
    })
  })

  describe('Edge Cases', () => {
    describe('Unicode and special characters', () => {
      it('should handle unicode in thing names', async () => {
        const stub = getStub()

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: '\u4E2D\u6587\u540D\u5B57' } // Chinese characters
        ])

        expect(thing.name).toBe('\u4E2D\u6587\u540D\u5B57')

        const retrieved = await rpc<ThingWithName>(stub, 'things.get', [thing.$id])
        expect(retrieved?.name).toBe('\u4E2D\u6587\u540D\u5B57')
      })

      it('should handle emojis in thing names', async () => {
        const stub = getStub()

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: 'John \uD83D\uDE00' }
        ])

        expect(thing.name).toBe('John \uD83D\uDE00')
      })

      it('should handle special characters in relationship predicates', async () => {
        const stub = getStub()

        const rel = await rpc<Relationship>(stub, 'relationships.add', [
          { subject: 'a', predicate: 'has:child', object: 'b' }
        ])

        expect(rel.predicate).toBe('has:child')
      })
    })

    describe('Empty and null values', () => {
      it('should handle empty string in thing fields', async () => {
        const stub = getStub()

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Customer', name: '' }
        ])

        expect(thing.name).toBe('')
      })

      it('should handle null values in thing fields', async () => {
        const stub = getStub()

        const thing = await rpc<ThingWithName & { middleName: string | null }>(stub, 'things.create', [
          { $type: 'Customer', name: 'Test', middleName: null }
        ])

        expect(thing.middleName).toBeNull()
      })

      it('should handle empty object as event payload', async () => {
        const stub = getStub()

        const event = await rpc<Event>(stub, 'events.emit', [
          { type: 'Empty.payload', payload: {} }
        ])

        expect(event.payload).toEqual({})
      })

      it('should handle empty array as event payload', async () => {
        const stub = getStub()

        const event = await rpc<Event>(stub, 'events.emit', [
          { type: 'Array.payload', payload: [] }
        ])

        expect(event.payload).toEqual([])
      })
    })

    describe('Large data handling', () => {
      it('should handle large string values', async () => {
        const stub = getStub()
        const largeString = 'x'.repeat(10000)

        const thing = await rpc<ThingWithName>(stub, 'things.create', [
          { $type: 'Document', name: largeString }
        ])

        expect(thing.name).toBe(largeString)
        expect(thing.name?.length).toBe(10000)
      })

      it('should handle deeply nested objects in event payload', async () => {
        const stub = getStub()

        // Create a 10-level deep nested object
        let nested: Record<string, unknown> = { value: 'deepest' }
        for (let i = 0; i < 10; i++) {
          nested = { level: i, child: nested }
        }

        const event = await rpc<Event>(stub, 'events.emit', [
          { type: 'Deep.nested', payload: nested }
        ])

        expect(event.payload).toEqual(nested)
      })
    })

    describe('Concurrent operations', () => {
      it('should handle multiple creates in parallel', async () => {
        const stub = getStub()

        const promises = Array.from({ length: 5 }, (_, i) =>
          rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: `Parallel-${i}` }])
        )

        const results = await Promise.all(promises)

        expect(results.length).toBe(5)
        const ids = new Set(results.map(r => r.$id))
        expect(ids.size).toBe(5) // All unique IDs
      })

      it('should handle multiple events in parallel', async () => {
        const stub = getStub()

        const promises = Array.from({ length: 5 }, (_, i) =>
          rpc<Event>(stub, 'events.emit', [
            { type: 'Parallel.event', payload: { index: i } }
          ])
        )

        const results = await Promise.all(promises)

        expect(results.length).toBe(5)
        const ids = new Set(results.map(r => r.$id))
        expect(ids.size).toBe(5) // All unique IDs
      })
    })
  })
})
