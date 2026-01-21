/**
 * Tests for SDK Testing Helpers
 *
 * Tests the mock client, fixtures, and assertion utilities.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MockDotdoClient,
  createMockClient,
  createMockDataStore,
  createTestFixture,
  generateTestId,
  generateMockId,
  assertThing,
  assertEvent,
  assertRelationship,
  createLocalClient,
  createResourceTracker,
  type TestFixture,
} from '../testing'

describe('MockDotdoClient', () => {
  let mockClient: MockDotdoClient

  beforeEach(() => {
    mockClient = createMockClient()
  })

  describe('things operations', () => {
    it('should create a thing', async () => {
      const thing = await mockClient.things.create({
        $type: 'Customer',
        name: 'Alice',
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$createdAt).toBeDefined()
    })

    it('should get a thing by ID', async () => {
      const created = await mockClient.things.create({
        $type: 'Customer',
        name: 'Bob',
      })

      const retrieved = await mockClient.things.get(created.$id)

      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.name).toBe('Bob')
    })

    it('should throw when getting non-existent thing', async () => {
      await expect(mockClient.things.get('nonexistent')).rejects.toThrow('Thing not found')
    })

    it('should update a thing', async () => {
      const created = await mockClient.things.create({
        $type: 'Customer',
        name: 'Charlie',
      })

      const updated = await mockClient.things.update(created.$id, {
        name: 'Charlie Updated',
      })

      expect(updated.name).toBe('Charlie Updated')
      expect(updated.$updatedAt).toBeDefined()
    })

    it('should delete a thing', async () => {
      const created = await mockClient.things.create({
        $type: 'Customer',
        name: 'Delete Me',
      })

      await mockClient.things.delete(created.$id)

      await expect(mockClient.things.get(created.$id)).rejects.toThrow()
    })

    it('should list things', async () => {
      await mockClient.things.create({ $type: 'Customer', name: 'A' })
      await mockClient.things.create({ $type: 'Customer', name: 'B' })
      await mockClient.things.create({ $type: 'Order', name: 'O1' })

      const result = await mockClient.things.list()

      expect(result.data).toHaveLength(3)
    })

    it('should list things filtered by type', async () => {
      await mockClient.things.create({ $type: 'Customer', name: 'A' })
      await mockClient.things.create({ $type: 'Customer', name: 'B' })
      await mockClient.things.create({ $type: 'Order', name: 'O1' })

      const result = await mockClient.things.list({ $type: 'Customer' })

      expect(result.data).toHaveLength(2)
      expect(result.data.every((t) => t.$type === 'Customer')).toBe(true)
    })

    it('should bulk create things', async () => {
      const things = await mockClient.things.bulkCreate([
        { $type: 'Customer', name: 'A' },
        { $type: 'Customer', name: 'B' },
        { $type: 'Customer', name: 'C' },
      ])

      expect(things).toHaveLength(3)
      expect(things.every((t) => t.$id)).toBe(true)
    })

    it('should bulk update things', async () => {
      const created = await mockClient.things.bulkCreate([
        { $type: 'Customer', name: 'A' },
        { $type: 'Customer', name: 'B' },
      ])

      const updated = await mockClient.things.bulkUpdate([
        { id: created[0].$id, data: { name: 'A Updated' } },
        { id: created[1].$id, data: { name: 'B Updated' } },
      ])

      expect(updated[0].name).toBe('A Updated')
      expect(updated[1].name).toBe('B Updated')
    })

    it('should bulk delete things', async () => {
      const created = await mockClient.things.bulkCreate([
        { $type: 'Customer', name: 'A' },
        { $type: 'Customer', name: 'B' },
      ])

      await mockClient.things.bulkDelete(created.map((t) => t.$id))

      const result = await mockClient.things.list()
      expect(result.data).toHaveLength(0)
    })
  })

  describe('events operations', () => {
    it('should emit an event', async () => {
      const event = await mockClient.events.emit({
        type: 'Customer.signup',
        payload: { customerId: 'cust_1' },
      })

      expect(event.$id).toBeDefined()
      expect(event.type).toBe('Customer.signup')
      expect(event.payload).toEqual({ customerId: 'cust_1' })
    })

    it('should list events', async () => {
      await mockClient.events.emit({ type: 'Customer.signup' })
      await mockClient.events.emit({ type: 'Order.placed' })

      const result = await mockClient.events.list()

      expect(result.data).toHaveLength(2)
    })

    it('should list events filtered by type', async () => {
      await mockClient.events.emit({ type: 'Customer.signup' })
      await mockClient.events.emit({ type: 'Customer.signup' })
      await mockClient.events.emit({ type: 'Order.placed' })

      const result = await mockClient.events.list({ type: 'Customer.signup' })

      expect(result.data).toHaveLength(2)
    })

    it('should get event by ID', async () => {
      const emitted = await mockClient.events.emit({
        type: 'Test.event',
        payload: { test: true },
      })

      const retrieved = await mockClient.events.get(emitted.$id)

      expect(retrieved.$id).toBe(emitted.$id)
      expect(retrieved.type).toBe('Test.event')
    })
  })

  describe('relationships operations', () => {
    it('should add a relationship', async () => {
      const rel = await mockClient.relationships.add({
        subject: 'cust_1',
        predicate: 'hasOrder',
        object: 'order_1',
      })

      expect(rel.$id).toBeDefined()
      expect(rel.subject).toBe('cust_1')
      expect(rel.predicate).toBe('hasOrder')
      expect(rel.object).toBe('order_1')
    })

    it('should find relationships', async () => {
      await mockClient.relationships.add({
        subject: 'cust_1',
        predicate: 'hasOrder',
        object: 'order_1',
      })
      await mockClient.relationships.add({
        subject: 'cust_1',
        predicate: 'hasOrder',
        object: 'order_2',
      })
      await mockClient.relationships.add({
        subject: 'cust_2',
        predicate: 'hasOrder',
        object: 'order_3',
      })

      const result = await mockClient.relationships.find({
        subject: 'cust_1',
        predicate: 'hasOrder',
      })

      expect(result).toHaveLength(2)
    })

    it('should remove a relationship', async () => {
      await mockClient.relationships.add({
        subject: 'cust_1',
        predicate: 'hasOrder',
        object: 'order_1',
      })

      await mockClient.relationships.remove({
        subject: 'cust_1',
        predicate: 'hasOrder',
        object: 'order_1',
      })

      const result = await mockClient.relationships.find({
        subject: 'cust_1',
      })

      expect(result).toHaveLength(0)
    })
  })

  describe('RPC', () => {
    it('should handle things.list RPC method', async () => {
      await mockClient.things.create({ $type: 'Customer', name: 'A' })

      const result = await mockClient.rpc<unknown[]>('things.list')

      expect(Array.isArray(result)).toBe(true)
    })

    it('should throw for unknown RPC methods', async () => {
      await expect(mockClient.rpc('unknown.method')).rejects.toThrow('Unknown RPC method')
    })
  })

  describe('health and root', () => {
    it('should return health status', async () => {
      const health = await mockClient.health()

      expect(health.status).toBe('ok')
      expect(health.version).toBe('1.0.0-mock')
    })

    it('should return root with links', async () => {
      const root = await mockClient.root()

      expect(root.name).toBe('dotdo-mock')
      expect(root._links).toBeDefined()
      expect(root._links.things).toBeDefined()
    })
  })

  describe('test utilities', () => {
    it('should provide access to store', () => {
      const store = mockClient.getStore()

      expect(store.things).toBeInstanceOf(Map)
      expect(store.events).toBeInstanceOf(Map)
      expect(store.relationships).toBeInstanceOf(Map)
    })

    it('should reset store', async () => {
      await mockClient.things.create({ $type: 'Customer', name: 'A' })
      await mockClient.events.emit({ type: 'Test' })

      mockClient.reset()

      const things = await mockClient.things.list()
      const events = await mockClient.events.list()

      expect(things.data).toHaveLength(0)
      expect(events.data).toHaveLength(0)
    })

    it('should seed store', async () => {
      mockClient.seed({
        things: [
          { $id: 'cust_1', $type: 'Customer', name: 'Alice' } as any,
          { $id: 'cust_2', $type: 'Customer', name: 'Bob' } as any,
        ],
      })

      const result = await mockClient.things.list()

      expect(result.data).toHaveLength(2)
    })
  })
})

describe('MockClient with options', () => {
  it('should simulate latency', async () => {
    const client = createMockClient({ latency: 50 })

    const start = Date.now()
    await client.things.create({ $type: 'Customer', name: 'Test' })
    const duration = Date.now() - start

    expect(duration).toBeGreaterThanOrEqual(40) // Allow some tolerance
  })

  it('should use initial data', async () => {
    const client = createMockClient({
      initialData: {
        things: [{ $id: 'cust_1', $type: 'Customer', name: 'Alice' } as any],
      },
    })

    const result = await client.things.list()

    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('Alice')
  })

  it('should use custom ID generator', async () => {
    let counter = 0
    const client = createMockClient({
      idGenerator: () => `custom_${++counter}`,
    })

    const thing1 = await client.things.create({ $type: 'Customer', name: 'A' })
    const thing2 = await client.things.create({ $type: 'Customer', name: 'B' })

    expect(thing1.$id).toBe('custom_1')
    expect(thing2.$id).toBe('custom_2')
  })
})

describe('Test fixtures', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = createTestFixture()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('should provide pre-populated data', () => {
    expect(fixture.data.customers).toHaveLength(2)
    expect(fixture.data.orders).toHaveLength(3)
    expect(fixture.data.events).toHaveLength(2)
    expect(fixture.data.relationships).toHaveLength(3)
  })

  it('should have working client with data', async () => {
    const customers = await fixture.client.things.list({ $type: 'Customer' })

    expect(customers.data).toHaveLength(2)
    expect(customers.data.map((c) => c.name)).toContain('Alice')
    expect(customers.data.map((c) => c.name)).toContain('Bob')
  })

  it('should find pre-populated relationships', async () => {
    const aliceOrders = await fixture.client.relationships.find({
      subject: 'cust_alice',
      predicate: 'hasOrder',
    })

    expect(aliceOrders).toHaveLength(2)
  })

  it('cleanup should reset data', async () => {
    fixture.cleanup()

    const things = await fixture.client.things.list()
    expect(things.data).toHaveLength(0)
  })
})

describe('ID generation utilities', () => {
  it('generateTestId should create unique IDs', () => {
    const id1 = generateTestId()
    const id2 = generateTestId()

    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^test_/)
  })

  it('generateTestId should accept custom prefix', () => {
    const id = generateTestId('custom')

    expect(id).toMatch(/^custom_/)
  })

  it('generateMockId should create unique IDs', () => {
    const id1 = generateMockId()
    const id2 = generateMockId()

    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^mock_/)
  })
})

describe('Assertion helpers', () => {
  it('assertThing should pass for matching thing', () => {
    const thing = {
      $id: 'thing_1',
      $type: 'Customer',
      name: 'Alice',
    }

    // Should not throw
    assertThing(thing as any, { $type: 'Customer', name: 'Alice' })
  })

  it('assertThing should throw for mismatched property', () => {
    const thing = {
      $id: 'thing_1',
      $type: 'Customer',
      name: 'Alice',
    }

    expect(() => assertThing(thing as any, { name: 'Bob' })).toThrow()
  })

  it('assertEvent should pass for matching event', () => {
    const event = {
      $id: 'evt_1',
      type: 'Customer.signup',
      payload: { customerId: 'cust_1' },
    }

    // Should not throw
    assertEvent(event as any, { type: 'Customer.signup' })
  })

  it('assertRelationship should pass for matching relationship', () => {
    const rel = {
      $id: 'rel_1',
      subject: 'cust_1',
      predicate: 'hasOrder',
      object: 'order_1',
    }

    // Should not throw
    assertRelationship(rel as any, { predicate: 'hasOrder' })
  })
})

describe('Local client', () => {
  it('should create client with default port', () => {
    const client = createLocalClient()

    // The client should be configured for localhost
    expect(client).toBeDefined()
  })

  it('should create client with custom port', () => {
    const client = createLocalClient({ port: 8788 })

    expect(client).toBeDefined()
  })

  it('should create client with custom host', () => {
    const client = createLocalClient({ host: '127.0.0.1', port: 8787 })

    expect(client).toBeDefined()
  })
})

describe('Resource tracker', () => {
  it('should track created resources', () => {
    const tracker = createResourceTracker()

    tracker.track('thing', 'thing_1')
    tracker.track('thing', 'thing_2')
    tracker.track('event', 'evt_1')

    const tracked = tracker.getTracked()

    expect(tracked.things).toEqual(['thing_1', 'thing_2'])
    expect(tracked.events).toEqual(['evt_1'])
    expect(tracked.relationships).toEqual([])
  })

  it('should cleanup tracked resources', async () => {
    const mockClient = createMockClient()
    const tracker = createResourceTracker()

    const thing1 = await mockClient.things.create({ $type: 'Customer', name: 'A' })
    const thing2 = await mockClient.things.create({ $type: 'Customer', name: 'B' })

    tracker.track('thing', thing1.$id)
    tracker.track('thing', thing2.$id)

    await tracker.cleanup(mockClient)

    const result = await mockClient.things.list()
    expect(result.data).toHaveLength(0)
  })

  it('should clear tracking without cleanup', () => {
    const tracker = createResourceTracker()

    tracker.track('thing', 'thing_1')
    tracker.track('thing', 'thing_2')

    tracker.clear()

    const tracked = tracker.getTracked()
    expect(tracked.things).toEqual([])
  })
})

describe('createMockDataStore', () => {
  it('should create empty store', () => {
    const store = createMockDataStore()

    expect(store.things).toBeInstanceOf(Map)
    expect(store.events).toBeInstanceOf(Map)
    expect(store.relationships).toBeInstanceOf(Map)
    expect(store.things.size).toBe(0)
  })
})
