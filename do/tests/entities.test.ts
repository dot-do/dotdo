import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO } from '../DO'
import type { Thing } from '../../db'

// Mock DurableObjectState
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('Entity Management (do-7rf.6.5)', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  describe('Things Store Integration', () => {
    it('should have this.things accessor', () => {
      expect((doInstance as any).things).toBeDefined()
      expect(typeof (doInstance as any).things.create).toBe('function')
      expect(typeof (doInstance as any).things.get).toBe('function')
      expect(typeof (doInstance as any).things.update).toBe('function')
      expect(typeof (doInstance as any).things.delete).toBe('function')
      expect(typeof (doInstance as any).things.list).toBe('function')
    })

    it('should create a thing via RPC', async () => {
      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice' }]
        })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)

      const thing = await response.json() as Thing
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    it('should get a thing via RPC', async () => {
      // First create
      const createReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Bob' }]
        })
      })
      const createRes = await doInstance.fetch(createReq)
      const created = await createRes.json() as Thing

      // Then get
      const getReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })

      const response = await doInstance.fetch(getReq)
      expect(response.status).toBe(200)

      const thing = await response.json() as Thing
      expect(thing.$id).toBe(created.$id)
      expect(thing.name).toBe('Bob')
    })

    it('should update a thing via RPC', async () => {
      // Create
      const createReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Charlie' }]
        })
      })
      const createRes = await doInstance.fetch(createReq)
      const created = await createRes.json() as Thing

      // Update
      const updateReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.update',
          args: [created.$id, { name: 'Charles' }]
        })
      })

      const response = await doInstance.fetch(updateReq)
      expect(response.status).toBe(200)

      const updated = await response.json() as Thing
      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Charles')
    })

    it('should delete a thing via RPC', async () => {
      // Create
      const createReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Diana' }]
        })
      })
      const createRes = await doInstance.fetch(createReq)
      const created = await createRes.json() as Thing

      // Delete
      const deleteReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.delete',
          args: [created.$id]
        })
      })

      const response = await doInstance.fetch(deleteReq)
      expect(response.status).toBe(200)

      // Verify deleted
      const getReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })
      const getRes = await doInstance.fetch(getReq)
      const result = await getRes.json()
      expect(result).toBeNull()
    })

    it('should list things via RPC', async () => {
      // Create multiple
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice' }]
        })
      }))
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Order', total: 100 }]
        })
      }))

      // List all
      const listReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.list',
          args: [{}]
        })
      })

      const response = await doInstance.fetch(listReq)
      expect(response.status).toBe(200)

      const things = await response.json() as Thing[]
      expect(things.length).toBe(2)
    })
  })

  describe('Events Store Integration', () => {
    it('should have this.events accessor', () => {
      expect((doInstance as any).events).toBeDefined()
      expect(typeof (doInstance as any).events.emit).toBe('function')
      expect(typeof (doInstance as any).events.get).toBe('function')
      expect(typeof (doInstance as any).events.query).toBe('function')
    })

    it('should emit an event via RPC', async () => {
      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.emit',
          args: [{ type: 'Customer.created', payload: { name: 'Alice' } }]
        })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)

      const event = await response.json()
      expect(event.$id).toBeDefined()
      expect(event.type).toBe('Customer.created')
      expect(event.payload).toEqual({ name: 'Alice' })
    })

    it('should query events via RPC', async () => {
      // Emit some events
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.emit',
          args: [{ type: 'Customer.created', payload: { name: 'Alice' } }]
        })
      }))
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.emit',
          args: [{ type: 'Order.placed', payload: { total: 100 } }]
        })
      }))

      // Query
      const queryReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.query',
          args: [{ type: 'Customer.created' }]
        })
      })

      const response = await doInstance.fetch(queryReq)
      expect(response.status).toBe(200)

      const events = await response.json()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('Customer.created')
    })
  })

  describe('Relationships Store Integration', () => {
    it('should have this.relationships accessor', () => {
      expect((doInstance as any).relationships).toBeDefined()
      expect(typeof (doInstance as any).relationships.add).toBe('function')
      expect(typeof (doInstance as any).relationships.remove).toBe('function')
      expect(typeof (doInstance as any).relationships.find).toBe('function')
    })

    it('should add a relationship via RPC', async () => {
      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.add',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)

      const rel = await response.json()
      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
    })

    it('should find relationships via RPC', async () => {
      // Add relationships
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.add',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      }))
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.add',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-2' }]
        })
      }))

      // Find
      const findReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.find',
          args: [{ subject: 'user-1', predicate: 'owns' }]
        })
      })

      const response = await doInstance.fetch(findReq)
      expect(response.status).toBe(200)

      const rels = await response.json()
      expect(rels.length).toBe(2)
      expect(rels.every((r: any) => r.subject === 'user-1')).toBe(true)
    })

    it('should remove a relationship via RPC', async () => {
      // Add
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.add',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      }))

      // Remove
      const removeReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.remove',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      })

      const response = await doInstance.fetch(removeReq)
      expect(response.status).toBe(200)

      // Verify removed
      const findReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.find',
          args: [{ subject: 'user-1' }]
        })
      })
      const findRes = await doInstance.fetch(findReq)
      const rels = await findRes.json()
      expect(rels.length).toBe(0)
    })
  })

  describe('Query Interface', () => {
    it('should expose query builder via RPC', async () => {
      // Create things
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice', active: true }]
        })
      }))
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Bob', active: false }]
        })
      }))

      // Note: Direct query builder access via RPC requires serialization of the builder pattern
      // This is challenging, so we test via direct method calls in this test
      expect(typeof (doInstance as any).query).toBe('function')

      // The query builder should allow building and executing queries
      const results = await (doInstance as any).query().type('Customer').where('active', true).execute()
      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Alice')
    })
  })

  describe('Event Emission on Entity Changes', () => {
    it('should emit event when thing is created', async () => {
      const events: any[] = []
      const unsubscribe = (doInstance as any).events.subscribe((event: any) => {
        events.push(event)
      })

      await (doInstance as any).things.create({ $type: 'Customer', name: 'Alice' })

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events.length).toBeGreaterThan(0)
      const createEvent = events.find(e => e.type === 'Thing.created')
      expect(createEvent).toBeDefined()
      expect(createEvent.payload.$type).toBe('Customer')

      unsubscribe()
    })

    it('should emit event when thing is updated', async () => {
      const created = await (doInstance as any).things.create({ $type: 'Customer', name: 'Alice' })

      const events: any[] = []
      const unsubscribe = (doInstance as any).events.subscribe((event: any) => {
        events.push(event)
      })

      await (doInstance as any).things.update(created.$id, { name: 'Alicia' })

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events.length).toBeGreaterThan(0)
      const updateEvent = events.find(e => e.type === 'Thing.updated')
      expect(updateEvent).toBeDefined()
      expect(updateEvent.payload.$id).toBe(created.$id)

      unsubscribe()
    })

    it('should emit event when thing is deleted', async () => {
      const created = await (doInstance as any).things.create({ $type: 'Customer', name: 'Alice' })

      const events: any[] = []
      const unsubscribe = (doInstance as any).events.subscribe((event: any) => {
        events.push(event)
      })

      await (doInstance as any).things.delete(created.$id)

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events.length).toBeGreaterThan(0)
      const deleteEvent = events.find(e => e.type === 'Thing.deleted')
      expect(deleteEvent).toBeDefined()
      expect(deleteEvent.payload.$id).toBe(created.$id)

      unsubscribe()
    })

    it('should emit event when relationship is added', async () => {
      const events: any[] = []
      const unsubscribe = (doInstance as any).events.subscribe((event: any) => {
        events.push(event)
      })

      await (doInstance as any).relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events.length).toBeGreaterThan(0)
      const addEvent = events.find(e => e.type === 'Relationship.added')
      expect(addEvent).toBeDefined()
      expect(addEvent.payload.subject).toBe('user-1')

      unsubscribe()
    })

    it('should emit event when relationship is removed', async () => {
      await (doInstance as any).relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      const events: any[] = []
      const unsubscribe = (doInstance as any).events.subscribe((event: any) => {
        events.push(event)
      })

      await (doInstance as any).relationships.remove({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events.length).toBeGreaterThan(0)
      const removeEvent = events.find(e => e.type === 'Relationship.removed')
      expect(removeEvent).toBeDefined()
      expect(removeEvent.payload.subject).toBe('user-1')

      unsubscribe()
    })
  })
})
