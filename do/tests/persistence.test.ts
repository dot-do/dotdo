/**
 * DO Entity Persistence Tests - RED Phase TDD
 *
 * These tests SHOULD FAIL against the current implementation.
 *
 * Problem: The DO class uses EntityManager which creates in-memory stores
 * (Map/Array) that lose all data when the DO is restarted/evacuated.
 *
 * This is the RED phase - we're proving the bug exists before fixing it.
 *
 * Expected failures:
 * 1. Things created do not persist across DO evacuation
 * 2. Events logged do not persist across DO evacuation
 * 3. Relationships created do not persist across DO evacuation
 * 4. The entire entity graph is lost on restart
 *
 * The fix will require replacing the in-memory stores with SQLite-backed
 * stores that use DurableObjectState.storage.sql.
 *
 * @module do/tests/persistence.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Miniflare } from 'miniflare'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Thing {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

interface Event {
  $id: string
  type: string
  payload: unknown
  $timestamp: number
  source?: string
  correlationId?: string
}

interface Relationship {
  subject: string
  predicate: string
  object: string
  $createdAt: number
}

// ============================================================================
// TEST DO SCRIPT - Uses actual DO entity stores pattern
// ============================================================================

/**
 * This DO mimics the actual DO class entity store pattern.
 * It creates in-memory Maps for things/events/relationships
 * just like the real EntityManager does.
 *
 * These tests prove that in-memory stores lose data on restart.
 */
const ENTITY_DO_SCRIPT = `
// Simulates EntityManager with in-memory stores
// This is how the actual DO class works (the bug we're exposing)

function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function generateEventId() {
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export class EntityDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
    this.instanceId = crypto.randomUUID()

    // IN-MEMORY STORES - This is the bug!
    // These will be lost when the DO restarts
    this.things = new Map()
    this.events = []
    this.relationships = []
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // ==== INSTANCE IDENTITY ====
      if (path === '/instance-id') {
        return Response.json({ instanceId: this.instanceId })
      }

      // ==== THINGS CRUD ====
      if (path === '/things' && method === 'POST') {
        const data = await request.json()
        if (!data.$type) {
          return Response.json({ error: '$type is required' }, { status: 400 })
        }

        const now = Date.now()
        const thing = {
          ...data,
          $id: generateId(),
          $createdAt: now,
          $updatedAt: now,
        }

        this.things.set(thing.$id, thing)
        return Response.json(thing)
      }

      if (path.startsWith('/things/') && method === 'GET') {
        const id = path.slice('/things/'.length)
        const thing = this.things.get(id)
        if (!thing) {
          return Response.json({ error: 'Thing not found' }, { status: 404 })
        }
        return Response.json(thing)
      }

      if (path === '/things' && method === 'GET') {
        const type = url.searchParams.get('$type')
        let results = Array.from(this.things.values())
        if (type) {
          results = results.filter(t => t.$type === type)
        }
        return Response.json(results)
      }

      if (path.startsWith('/things/') && method === 'DELETE') {
        const id = path.slice('/things/'.length)
        if (!this.things.has(id)) {
          return Response.json({ error: 'Thing not found' }, { status: 404 })
        }
        this.things.delete(id)
        return Response.json({ deleted: true })
      }

      // ==== EVENTS ====
      if (path === '/events' && method === 'POST') {
        const data = await request.json()
        const event = {
          ...data,
          $id: generateEventId(),
          $timestamp: Date.now()
        }
        this.events.push(event)
        return Response.json(event)
      }

      if (path === '/events' && method === 'GET') {
        const type = url.searchParams.get('type')
        const source = url.searchParams.get('source')
        let results = [...this.events]

        if (type) {
          results = results.filter(e => e.type === type)
        }
        if (source) {
          results = results.filter(e => e.source === source)
        }

        // Sort newest first
        results.sort((a, b) => b.$timestamp - a.$timestamp)
        return Response.json(results)
      }

      // ==== RELATIONSHIPS ====
      if (path === '/relationships' && method === 'POST') {
        const { subject, predicate, object } = await request.json()

        // Check for duplicate
        const exists = this.relationships.some(
          r => r.subject === subject && r.predicate === predicate && r.object === object
        )
        if (exists) {
          return Response.json({ error: 'Relationship already exists' }, { status: 409 })
        }

        const relationship = {
          subject,
          predicate,
          object,
          $createdAt: Date.now()
        }
        this.relationships.push(relationship)
        return Response.json(relationship)
      }

      if (path === '/relationships' && method === 'GET') {
        const subject = url.searchParams.get('subject')
        const predicate = url.searchParams.get('predicate')
        const object = url.searchParams.get('object')

        let results = [...this.relationships]
        if (subject) results = results.filter(r => r.subject === subject)
        if (predicate) results = results.filter(r => r.predicate === predicate)
        if (object) results = results.filter(r => r.object === object)

        return Response.json(results)
      }

      // ==== COUNTS ====
      if (path === '/counts') {
        return Response.json({
          things: this.things.size,
          events: this.events.length,
          relationships: this.relationships.length
        })
      }

      // ==== HEALTH ====
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          id: this.state.id.toString(),
          instanceId: this.instanceId
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.ENTITY_DO.idFromName(doName)
    const stub = env.ENTITY_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

let tempDir: string

function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `do-persistence-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function getMiniflareConfig(persistDir: string) {
  return {
    modules: true,
    script: ENTITY_DO_SCRIPT,
    durableObjects: {
      ENTITY_DO: 'EntityDO',
    },
    // Enable persistence - the DO storage would persist, but in-memory Maps won't
    durableObjectsPersist: persistDir,
  }
}

async function getEntityDOStub(mf: Miniflare, name: string = 'default') {
  const ns = await mf.getDurableObjectNamespace('ENTITY_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITES - Entity Persistence Across DO Restarts
// ============================================================================

describe('DO Entity Persistence - RED Tests (Expected to FAIL)', () => {
  /**
   * These tests expose that the DO's entity stores (things, events, relationships)
   * use in-memory data structures that are lost when the DO restarts.
   *
   * ALL OF THESE TESTS SHOULD FAIL against the current implementation.
   */

  // ==========================================================================
  // 1. THINGS DO NOT PERSIST ACROSS DO EVACUATION
  // ==========================================================================

  describe('1. Things should persist across DO evacuation (WILL FAIL)', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist a single Thing across DO restart', async () => {
      const doName = generateTestId()

      // First Miniflare instance - create a Thing
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let createdThing: Thing
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        const createResponse = await stub1.fetch('http://fake/things', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ $type: 'Customer', name: 'Alice', email: 'alice@example.com' }),
        })
        expect(createResponse.status).toBe(200)
        createdThing = await createResponse.json() as Thing

        // Verify it exists in this instance
        const getResponse = await stub1.fetch(`http://fake/things/${createdThing.$id}`)
        expect(getResponse.status).toBe(200)
      } finally {
        await mf1.dispose()
      }

      // Second Miniflare instance - simulate DO restart
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS SHOULD PASS if storage is persistent
        // THIS WILL FAIL because Things are stored in-memory
        const getResponse = await stub2.fetch(`http://fake/things/${createdThing!.$id}`)
        expect(getResponse.status).toBe(200) // Will be 404

        const thing = await getResponse.json() as Thing
        expect(thing.$id).toBe(createdThing!.$id)
        expect(thing.name).toBe('Alice')
        expect(thing.email).toBe('alice@example.com')
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist Things list across DO restart', async () => {
      const doName = generateTestId()

      // First instance - create multiple Things
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        for (let i = 0; i < 5; i++) {
          await stub1.fetch('http://fake/things', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ $type: 'Customer', name: `Customer ${i}` }),
          })
        }

        // Verify count
        const listResponse = await stub1.fetch('http://fake/things?$type=Customer')
        const things = await listResponse.json() as Thing[]
        expect(things).toHaveLength(5)
      } finally {
        await mf1.dispose()
      }

      // Second instance - should see same Things
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - list will be empty
        const listResponse = await stub2.fetch('http://fake/things?$type=Customer')
        const things = await listResponse.json() as Thing[]
        expect(things).toHaveLength(5) // Will be 0
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve Thing $createdAt and $updatedAt across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let originalThing: Thing
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/things', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ $type: 'Task', title: 'Important task' }),
        })
        originalThing = await response.json() as Thing
      } finally {
        await mf1.dispose()
      }

      // Wait a moment to ensure timestamps would differ if recreated
      await new Promise(resolve => setTimeout(resolve, 50))

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - Thing won't exist
        const response = await stub2.fetch(`http://fake/things/${originalThing!.$id}`)
        expect(response.status).toBe(200)

        const thing = await response.json() as Thing
        // Timestamps should be preserved, not recreated
        expect(thing.$createdAt).toBe(originalThing!.$createdAt)
        expect(thing.$updatedAt).toBe(originalThing!.$updatedAt)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 2. EVENTS DO NOT PERSIST ACROSS DO EVACUATION
  // ==========================================================================

  describe('2. Events should persist across DO evacuation (WILL FAIL)', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist event log across DO restart', async () => {
      const doName = generateTestId()

      // First instance - emit events
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        // Emit several events
        for (let i = 0; i < 10; i++) {
          await stub1.fetch('http://fake/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'Customer.created',
              payload: { customerId: `cust-${i}` },
              source: 'test'
            }),
          })
        }

        // Verify events exist
        const eventsResponse = await stub1.fetch('http://fake/events')
        const events = await eventsResponse.json() as Event[]
        expect(events).toHaveLength(10)
      } finally {
        await mf1.dispose()
      }

      // Second instance - event log should persist
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - events array will be empty
        const eventsResponse = await stub2.fetch('http://fake/events')
        const events = await eventsResponse.json() as Event[]
        expect(events).toHaveLength(10) // Will be 0
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve event timestamps across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let originalEvent: Event
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'Order.placed',
            payload: { orderId: 'order-123', amount: 99.99 }
          }),
        })
        originalEvent = await response.json() as Event
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - event won't exist
        const eventsResponse = await stub2.fetch('http://fake/events?type=Order.placed')
        const events = await eventsResponse.json() as Event[]

        expect(events).toHaveLength(1)
        expect(events[0].$id).toBe(originalEvent!.$id)
        expect(events[0].$timestamp).toBe(originalEvent!.$timestamp)
      } finally {
        await mf2.dispose()
      }
    })

    it('should allow querying historical events after restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        // Emit events of different types
        await stub1.fetch('http://fake/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'User.signup', payload: { userId: 'u1' }, source: 'auth' }),
        })
        await stub1.fetch('http://fake/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'User.login', payload: { userId: 'u1' }, source: 'auth' }),
        })
        await stub1.fetch('http://fake/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'Order.placed', payload: { orderId: 'o1' }, source: 'shop' }),
        })
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - no events will be found
        const authEvents = await (await stub2.fetch('http://fake/events?source=auth')).json() as Event[]
        expect(authEvents).toHaveLength(2) // Will be 0

        const shopEvents = await (await stub2.fetch('http://fake/events?source=shop')).json() as Event[]
        expect(shopEvents).toHaveLength(1) // Will be 0
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 3. RELATIONSHIPS DO NOT PERSIST ACROSS DO EVACUATION
  // ==========================================================================

  describe('3. Relationships should persist across DO evacuation (WILL FAIL)', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist relationship graph across DO restart', async () => {
      const doName = generateTestId()

      // First instance - create relationships
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        // Create a graph: user-1 owns task-1, task-2
        await stub1.fetch('http://fake/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'user-1', predicate: 'owns', object: 'task-1' }),
        })
        await stub1.fetch('http://fake/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'user-1', predicate: 'owns', object: 'task-2' }),
        })
        await stub1.fetch('http://fake/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'task-1', predicate: 'dependsOn', object: 'task-2' }),
        })

        // Verify relationships
        const relsResponse = await stub1.fetch('http://fake/relationships?subject=user-1')
        const rels = await relsResponse.json() as Relationship[]
        expect(rels).toHaveLength(2)
      } finally {
        await mf1.dispose()
      }

      // Second instance - relationships should persist
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - relationships array will be empty
        const relsResponse = await stub2.fetch('http://fake/relationships?subject=user-1')
        const rels = await relsResponse.json() as Relationship[]
        expect(rels).toHaveLength(2) // Will be 0
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve relationship $createdAt across restart', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let originalRel: Relationship
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'org-1', predicate: 'hasMember', object: 'user-1' }),
        })
        originalRel = await response.json() as Relationship
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - relationship won't exist
        const relsResponse = await stub2.fetch('http://fake/relationships?subject=org-1&predicate=hasMember')
        const rels = await relsResponse.json() as Relationship[]

        expect(rels).toHaveLength(1)
        expect(rels[0].$createdAt).toBe(originalRel!.$createdAt)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 4. ENTIRE ENTITY GRAPH LOST ON RESTART
  // ==========================================================================

  describe('4. Complete entity graph should survive restart (WILL FAIL)', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should preserve complete entity graph with things, relationships, and events', async () => {
      const doName = generateTestId()

      // First instance - create a complete entity graph
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let customerIds: string[] = []
      let orderIds: string[] = []

      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        // Create customers
        for (let i = 0; i < 3; i++) {
          const response = await stub1.fetch('http://fake/things', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ $type: 'Customer', name: `Customer ${i}` }),
          })
          const customer = await response.json() as Thing
          customerIds.push(customer.$id)
        }

        // Create orders
        for (let i = 0; i < 5; i++) {
          const response = await stub1.fetch('http://fake/things', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ $type: 'Order', total: 100 + i * 10 }),
          })
          const order = await response.json() as Thing
          orderIds.push(order.$id)
        }

        // Create relationships (customer owns orders)
        for (let i = 0; i < orderIds.length; i++) {
          const customerId = customerIds[i % customerIds.length]
          await stub1.fetch('http://fake/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: customerId, predicate: 'placed', object: orderIds[i] }),
          })
        }

        // Emit events
        for (const orderId of orderIds) {
          await stub1.fetch('http://fake/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'Order.created', payload: { orderId }, source: orderId }),
          })
        }

        // Verify counts
        const countsResponse = await stub1.fetch('http://fake/counts')
        const counts = await countsResponse.json() as { things: number; events: number; relationships: number }
        expect(counts.things).toBe(8) // 3 customers + 5 orders
        expect(counts.events).toBe(5)
        expect(counts.relationships).toBe(5)
      } finally {
        await mf1.dispose()
      }

      // Second instance - entire graph should be intact
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - all counts will be 0
        const countsResponse = await stub2.fetch('http://fake/counts')
        const counts = await countsResponse.json() as { things: number; events: number; relationships: number }

        expect(counts.things).toBe(8) // Will be 0
        expect(counts.events).toBe(5) // Will be 0
        expect(counts.relationships).toBe(5) // Will be 0

        // Verify specific entities exist
        const customersResponse = await stub2.fetch('http://fake/things?$type=Customer')
        const customers = await customersResponse.json() as Thing[]
        expect(customers).toHaveLength(3) // Will be 0

        const ordersResponse = await stub2.fetch('http://fake/things?$type=Order')
        const orders = await ordersResponse.json() as Thing[]
        expect(orders).toHaveLength(5) // Will be 0

        // Verify relationships
        const relsResponse = await stub2.fetch('http://fake/relationships?predicate=placed')
        const rels = await relsResponse.json() as Relationship[]
        expect(rels).toHaveLength(5) // Will be 0

        // Verify events
        const eventsResponse = await stub2.fetch('http://fake/events?type=Order.created')
        const events = await eventsResponse.json() as Event[]
        expect(events).toHaveLength(5) // Will be 0
      } finally {
        await mf2.dispose()
      }
    })

    it('should survive multiple restarts without data loss', async () => {
      const doName = generateTestId()

      // First instance - create initial data
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        await stub1.fetch('http://fake/things', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ $type: 'Project', name: 'Project 1' }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance - add more data
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        await stub2.fetch('http://fake/things', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ $type: 'Project', name: 'Project 2' }),
        })

        // THIS WILL FAIL - only Project 2 will exist
        const projects = await (await stub2.fetch('http://fake/things?$type=Project')).json() as Thing[]
        expect(projects).toHaveLength(2) // Will be 1
      } finally {
        await mf2.dispose()
      }

      // Third instance - verify cumulative data
      let mf3 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub3 = await getEntityDOStub(mf3, doName)

        await stub3.fetch('http://fake/things', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ $type: 'Project', name: 'Project 3' }),
        })

        // THIS WILL FAIL - only Project 3 will exist
        const projects = await (await stub3.fetch('http://fake/things?$type=Project')).json() as Thing[]
        expect(projects).toHaveLength(3) // Will be 1
      } finally {
        await mf3.dispose()
      }
    })
  })

  // ==========================================================================
  // 5. VERIFY INSTANCE CHANGES ON RESTART (sanity check)
  // ==========================================================================

  describe('5. Instance identity changes on restart (sanity check)', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should get different instanceId after restart (proving restart happened)', async () => {
      const doName = generateTestId()

      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let instanceId1: string
      try {
        const stub1 = await getEntityDOStub(mf1, doName)
        const response = await stub1.fetch('http://fake/instance-id')
        const json = await response.json() as { instanceId: string }
        instanceId1 = json.instanceId
      } finally {
        await mf1.dispose()
      }

      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)
        const response = await stub2.fetch('http://fake/instance-id')
        const json = await response.json() as { instanceId: string }

        // THIS SHOULD PASS - proves we got a new instance
        expect(json.instanceId).not.toBe(instanceId1)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 6. STORAGE SIZE LIMITS (approaching 10GB)
  // ==========================================================================

  describe('6. Storage should handle large datasets (future concern)', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should handle thousands of Things without data loss', async () => {
      const doName = generateTestId()
      const numThings = 1000

      // First instance - create many Things
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getEntityDOStub(mf1, doName)

        // Batch create for performance
        for (let i = 0; i < numThings; i++) {
          await stub1.fetch('http://fake/things', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              $type: 'Item',
              index: i,
              data: `Data for item ${i}`.repeat(10), // Some bulk
            }),
          })
        }

        const countsResponse = await stub1.fetch('http://fake/counts')
        const counts = await countsResponse.json() as { things: number }
        expect(counts.things).toBe(numThings)
      } finally {
        await mf1.dispose()
      }

      // Second instance - all data should persist
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getEntityDOStub(mf2, doName)

        // THIS WILL FAIL - count will be 0
        const countsResponse = await stub2.fetch('http://fake/counts')
        const counts = await countsResponse.json() as { things: number }
        expect(counts.things).toBe(numThings) // Will be 0
      } finally {
        await mf2.dispose()
      }
    })
  })
})
