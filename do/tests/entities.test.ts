import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import type { Thing } from '../../db'

/**
 * Entity Management Tests - Using Real Miniflare Runtime
 *
 * These tests use @cloudflare/vitest-pool-workers to test against
 * real Durable Objects instead of mocks. This ensures:
 * - Real storage persistence
 * - Real SQLite operations
 * - Real entity lifecycle events
 *
 * NO MOCKS for DO storage/state per CLAUDE.md philosophy.
 */

// Helper to generate unique test IDs for isolation
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Helper to get DO stub
function getDoStub(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// Helper for RPC calls
async function rpcCall(stub: DurableObjectStub, method: string, args: unknown[] = []) {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  return response
}

describe('Entity Management (do-7rf.6.5)', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  describe('Things Store Integration', () => {
    it('should create a thing via RPC', async () => {
      const stub = getDoStub(testId)
      const response = await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])

      expect(response.status).toBe(200)

      const thing = await response.json() as Thing
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()
    })

    it('should get a thing via RPC', async () => {
      const stub = getDoStub(testId)

      // First create
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Bob' }])
      const created = await createRes.json() as Thing

      // Then get
      const response = await rpcCall(stub, 'things.get', [created.$id])
      expect(response.status).toBe(200)

      const thing = await response.json() as Thing
      expect(thing.$id).toBe(created.$id)
      expect(thing.name).toBe('Bob')
    })

    it('should update a thing via RPC', async () => {
      const stub = getDoStub(testId)

      // Create
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Charlie' }])
      const created = await createRes.json() as Thing

      // Update
      const response = await rpcCall(stub, 'things.update', [created.$id, { name: 'Charles' }])
      expect(response.status).toBe(200)

      const updated = await response.json() as Thing
      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Charles')
    })

    it('should delete a thing via RPC', async () => {
      const stub = getDoStub(testId)

      // Create
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Diana' }])
      const created = await createRes.json() as Thing

      // Delete
      const response = await rpcCall(stub, 'things.delete', [created.$id])
      expect(response.status).toBe(200)

      // Verify deleted
      const getRes = await rpcCall(stub, 'things.get', [created.$id])
      const result = await getRes.json()
      expect(result).toBeNull()
    })

    it('should list things via RPC', async () => {
      const stub = getDoStub(testId)

      // Create multiple
      await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      await rpcCall(stub, 'things.create', [{ $type: 'Order', total: 100 }])

      // List all
      const response = await rpcCall(stub, 'things.list', [{}])
      expect(response.status).toBe(200)

      const things = await response.json() as Thing[]
      expect(things.length).toBe(2)
    })

    it('should list things by type via RPC', async () => {
      const stub = getDoStub(testId)

      // Create multiple of different types
      await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Bob' }])
      await rpcCall(stub, 'things.create', [{ $type: 'Order', total: 100 }])

      // List only Customers
      const response = await rpcCall(stub, 'things.list', [{ $type: 'Customer' }])
      expect(response.status).toBe(200)

      const things = await response.json() as Thing[]
      expect(things.length).toBe(2)
      expect(things.every(t => t.$type === 'Customer')).toBe(true)
    })
  })

  describe('Events Store Integration', () => {
    it('should emit an event via RPC', async () => {
      const stub = getDoStub(testId)
      const response = await rpcCall(stub, 'events.emit', [{ type: 'Customer.created', payload: { name: 'Alice' } }])

      expect(response.status).toBe(200)

      const event = await response.json() as { $id: string; type: string; payload: unknown; $timestamp: number }
      expect(event.$id).toBeDefined()
      expect(event.type).toBe('Customer.created')
      expect(event.payload).toEqual({ name: 'Alice' })
      expect(event.$timestamp).toBeDefined()
    })

    it('should query events via RPC', async () => {
      const stub = getDoStub(testId)

      // Emit some events
      await rpcCall(stub, 'events.emit', [{ type: 'Customer.created', payload: { name: 'Alice' } }])
      await rpcCall(stub, 'events.emit', [{ type: 'Order.placed', payload: { total: 100 } }])

      // Query
      const response = await rpcCall(stub, 'events.query', [{ type: 'Customer.created' }])
      expect(response.status).toBe(200)

      const events = await response.json() as Array<{ type: string }>
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('Customer.created')
    })

    it('should query all events via RPC', async () => {
      const stub = getDoStub(testId)

      // Emit some events
      await rpcCall(stub, 'events.emit', [{ type: 'Customer.created', payload: { name: 'Alice' } }])
      await rpcCall(stub, 'events.emit', [{ type: 'Order.placed', payload: { total: 100 } }])
      await rpcCall(stub, 'events.emit', [{ type: 'Customer.updated', payload: { name: 'Alicia' } }])

      // Query all
      const response = await rpcCall(stub, 'events.query', [{}])
      expect(response.status).toBe(200)

      const events = await response.json() as Array<{ type: string }>
      expect(events.length).toBe(3)
    })
  })

  describe('Relationships Store Integration', () => {
    it('should add a relationship via RPC', async () => {
      const stub = getDoStub(testId)
      const response = await rpcCall(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])

      expect(response.status).toBe(200)

      const rel = await response.json() as { subject: string; predicate: string; object: string; $createdAt: number }
      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
      expect(rel.$createdAt).toBeDefined()
    })

    it('should find relationships via RPC', async () => {
      const stub = getDoStub(testId)

      // Add relationships
      await rpcCall(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])
      await rpcCall(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-2' }])

      // Find
      const response = await rpcCall(stub, 'relationships.find', [{ subject: 'user-1', predicate: 'owns' }])
      expect(response.status).toBe(200)

      const rels = await response.json() as Array<{ subject: string }>
      expect(rels.length).toBe(2)
      expect(rels.every((r) => r.subject === 'user-1')).toBe(true)
    })

    it('should remove a relationship via RPC', async () => {
      const stub = getDoStub(testId)

      // Add
      await rpcCall(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])

      // Remove
      const response = await rpcCall(stub, 'relationships.remove', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])
      expect(response.status).toBe(200)

      // Verify removed
      const findRes = await rpcCall(stub, 'relationships.find', [{ subject: 'user-1' }])
      const rels = await findRes.json() as Array<unknown>
      expect(rels.length).toBe(0)
    })

    it('should find relationships by predicate via RPC', async () => {
      const stub = getDoStub(testId)

      // Add relationships with different predicates
      await rpcCall(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }])
      await rpcCall(stub, 'relationships.add', [{ subject: 'user-1', predicate: 'created', object: 'order-1' }])
      await rpcCall(stub, 'relationships.add', [{ subject: 'user-2', predicate: 'owns', object: 'order-2' }])

      // Find by predicate
      const response = await rpcCall(stub, 'relationships.find', [{ predicate: 'owns' }])
      expect(response.status).toBe(200)

      const rels = await response.json() as Array<{ predicate: string }>
      expect(rels.length).toBe(2)
      expect(rels.every((r) => r.predicate === 'owns')).toBe(true)
    })
  })

  describe('Complex Entity Operations', () => {
    it('should handle concurrent entity creation', async () => {
      const stub = getDoStub(testId)

      // Create multiple things concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        rpcCall(stub, 'things.create', [{ $type: 'Item', index: i }])
      )

      const responses = await Promise.all(promises)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // Verify all created
      const listRes = await rpcCall(stub, 'things.list', [{ $type: 'Item' }])
      const things = await listRes.json() as Thing[]
      expect(things.length).toBe(10)
    })

    it('should maintain entity integrity after multiple operations', async () => {
      const stub = getDoStub(testId)

      // Create
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Counter', value: 0 }])
      const created = await createRes.json() as Thing & { value: number }

      // Update multiple times
      for (let i = 1; i <= 5; i++) {
        await rpcCall(stub, 'things.update', [created.$id, { value: i }])
      }

      // Verify final state
      const getRes = await rpcCall(stub, 'things.get', [created.$id])
      const final = await getRes.json() as Thing & { value: number }
      expect(final.value).toBe(5)
    })

    it('should support entity-relationship graphs', async () => {
      const stub = getDoStub(testId)

      // Create user
      const userRes = await rpcCall(stub, 'things.create', [{ $type: 'User', name: 'Alice' }])
      const user = await userRes.json() as Thing

      // Create orders
      const order1Res = await rpcCall(stub, 'things.create', [{ $type: 'Order', total: 50 }])
      const order1 = await order1Res.json() as Thing
      const order2Res = await rpcCall(stub, 'things.create', [{ $type: 'Order', total: 100 }])
      const order2 = await order2Res.json() as Thing

      // Add relationships
      await rpcCall(stub, 'relationships.add', [{ subject: user.$id, predicate: 'placed', object: order1.$id }])
      await rpcCall(stub, 'relationships.add', [{ subject: user.$id, predicate: 'placed', object: order2.$id }])

      // Find user's orders
      const relsRes = await rpcCall(stub, 'relationships.find', [{ subject: user.$id, predicate: 'placed' }])
      const rels = await relsRes.json() as Array<{ object: string }>
      expect(rels.length).toBe(2)

      // Get the actual order entities
      const orderIds = rels.map(r => r.object)
      expect(orderIds).toContain(order1.$id)
      expect(orderIds).toContain(order2.$id)
    })
  })
})
