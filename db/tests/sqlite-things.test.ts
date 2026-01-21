/**
 * SQLite ThingsStore Tests - Using Real Miniflare Runtime
 *
 * These tests use Miniflare to test against real SQLite storage instead of mocks.
 * This follows the NO MOCKS philosophy from CLAUDE.md.
 *
 * @module db/tests/sqlite-things.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

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

// ============================================================================
// DO SCRIPT FOR TESTING ThingsStore
// ============================================================================

const THINGS_TEST_DO_SCRIPT = `
function generateId() {
  return 'th_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export class ThingsTestDO {
  constructor(state, env) {
    this.state = state
    this.sql = state.storage.sql
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // INITIALIZE
      if (path === '/initialize' && request.method === 'POST') {
        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS things (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
          CREATE INDEX IF NOT EXISTS idx_things_created_at ON things(created_at DESC);
        \`)
        return Response.json({ success: true })
      }

      // CREATE THING
      if (path === '/things' && request.method === 'POST') {
        const data = await request.json()

        if (!data.$type) {
          return Response.json({ error: '$type is required' }, { status: 400 })
        }

        const now = Date.now()
        const id = generateId()

        // Separate metadata from data
        const { $type, ...customData } = data

        const thing = {
          $id: id,
          $type,
          $createdAt: now,
          $updatedAt: now,
          ...customData
        }

        // Store custom data as JSON
        const dataJson = JSON.stringify(customData)

        this.sql.exec(
          'INSERT INTO things (id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          id, $type, dataJson, now, now
        )

        return Response.json(thing, { status: 201 })
      }

      // GET THING
      if (path.startsWith('/things/') && request.method === 'GET') {
        const id = path.split('/')[2]
        const rows = this.sql.exec(
          'SELECT id, type, data, created_at, updated_at FROM things WHERE id = ?',
          id
        ).toArray()

        if (rows.length === 0) {
          return Response.json(null)
        }

        const row = rows[0]
        const customData = JSON.parse(row.data)
        const thing = {
          $id: row.id,
          $type: row.type,
          $createdAt: row.created_at,
          $updatedAt: row.updated_at,
          ...customData
        }

        return Response.json(thing)
      }

      // UPDATE THING
      if (path.startsWith('/things/') && request.method === 'PATCH') {
        const id = path.split('/')[2]
        const updates = await request.json()

        // Get existing thing
        const rows = this.sql.exec(
          'SELECT id, type, data, created_at, updated_at FROM things WHERE id = ?',
          id
        ).toArray()

        if (rows.length === 0) {
          return Response.json({ error: 'Thing not found: ' + id }, { status: 404 })
        }

        const row = rows[0]
        const existingData = JSON.parse(row.data)

        // Merge updates, preserving immutable fields
        const now = Date.now()
        const updated = {
          ...existingData,
          ...updates,
          $id: row.id,
          $type: row.type,
          $createdAt: row.created_at,
          $updatedAt: now
        }

        // Extract custom data
        const { $id, $type, $createdAt, $updatedAt, ...customData } = updated
        const dataJson = JSON.stringify(customData)

        this.sql.exec(
          'UPDATE things SET data = ?, updated_at = ? WHERE id = ?',
          dataJson, now, id
        )

        return Response.json(updated)
      }

      // DELETE THING
      if (path.startsWith('/things/') && request.method === 'DELETE') {
        const id = path.split('/')[2]

        // Check if exists
        const rows = this.sql.exec('SELECT 1 FROM things WHERE id = ?', id).toArray()

        if (rows.length === 0) {
          return Response.json({ error: 'Thing not found: ' + id }, { status: 404 })
        }

        this.sql.exec('DELETE FROM things WHERE id = ?', id)
        return Response.json({ success: true })
      }

      // LIST THINGS
      if (path === '/things' && request.method === 'GET') {
        const type = url.searchParams.get('type')
        const limit = parseInt(url.searchParams.get('limit') || '100')
        const offset = parseInt(url.searchParams.get('offset') || '0')

        let query = 'SELECT id, type, data, created_at, updated_at FROM things'
        const params = []

        if (type) {
          query += ' WHERE type = ?'
          params.push(type)
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        const rows = this.sql.exec(query, ...params).toArray()

        const things = rows.map(row => {
          const customData = JSON.parse(row.data)
          return {
            $id: row.id,
            $type: row.type,
            $createdAt: row.created_at,
            $updatedAt: row.updated_at,
            ...customData
          }
        })

        return Response.json(things)
      }

      if (path === '/health') {
        return Response.json({ status: 'ok' })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.THINGS_DO.idFromName(doName)
    const stub = env.THINGS_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('SQLite ThingsStore', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: THINGS_TEST_DO_SCRIPT,
      durableObjects: {
        THINGS_DO: {
          className: 'ThingsTestDO',
          // Enable SQLite for this DO class - required for state.storage.sql
          useSQLite: true,
        },
      },
      durableObjectsPersist: false,
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  async function getThingsStub(name: string = 'default') {
    const ns = await mf.getDurableObjectNamespace('THINGS_DO')
    const id = ns.idFromName(name)
    return ns.get(id)
  }

  type StubType = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }

  // Helper functions
  async function initialize(stub: StubType): Promise<void> {
    await stub.fetch('http://internal/initialize', { method: 'POST' })
  }

  async function createThing(stub: StubType, data: Record<string, unknown>): Promise<Thing> {
    const response = await stub.fetch('http://internal/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!response.ok) {
      const error = await response.json() as { error: string }
      throw new Error(error.error)
    }
    return response.json() as Promise<Thing>
  }

  async function getThing(stub: StubType, id: string): Promise<Thing | null> {
    const response = await stub.fetch(`http://internal/things/${id}`)
    return response.json() as Promise<Thing | null>
  }

  async function updateThing(stub: StubType, id: string, data: Record<string, unknown>): Promise<Thing> {
    const response = await stub.fetch(`http://internal/things/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!response.ok) {
      const error = await response.json() as { error: string }
      throw new Error(error.error)
    }
    return response.json() as Promise<Thing>
  }

  async function deleteThing(stub: StubType, id: string): Promise<void> {
    const response = await stub.fetch(`http://internal/things/${id}`, {
      method: 'DELETE'
    })
    if (!response.ok) {
      const error = await response.json() as { error: string }
      throw new Error(error.error)
    }
  }

  async function listThings(stub: StubType, options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]> {
    const params = new URLSearchParams()
    if (options?.type) params.set('type', options.type)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))

    const url = params.toString() ? `http://internal/things?${params}` : 'http://internal/things'
    const response = await stub.fetch(url)
    return response.json() as Promise<Thing[]>
  }

  describe('create', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getThingsStub(generateTestId())
      await initialize(stub)
    })

    it('should insert thing into SQLite', async () => {
      const thing = await createThing(stub, { $type: 'Customer', name: 'Alice' })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()
    })

    it('should require $type', async () => {
      await expect(createThing(stub, { name: 'Alice' })).rejects.toThrow('$type is required')
    })

    it('should persist data as JSON', async () => {
      const thing = await createThing(stub, {
        $type: 'Order',
        total: 100,
        items: ['item1', 'item2'],
        metadata: { source: 'web' }
      })

      const retrieved = await getThing(stub, thing.$id)
      expect(retrieved?.total).toBe(100)
      expect(retrieved?.items).toEqual(['item1', 'item2'])
      expect(retrieved?.metadata).toEqual({ source: 'web' })
    })
  })

  describe('get', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getThingsStub(generateTestId())
      await initialize(stub)
    })

    it('should retrieve thing by id', async () => {
      const created = await createThing(stub, { $type: 'Customer', name: 'Alice' })
      const retrieved = await getThing(stub, created.$id)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent id', async () => {
      const result = await getThing(stub, 'non-existent')
      expect(result).toBeNull()
    })

    it('should parse JSON data field', async () => {
      const created = await createThing(stub, {
        $type: 'Product',
        name: 'Widget',
        price: 99.99,
        tags: ['new', 'featured']
      })

      const retrieved = await getThing(stub, created.$id)
      expect(retrieved?.price).toBe(99.99)
      expect(retrieved?.tags).toEqual(['new', 'featured'])
    })
  })

  describe('update', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getThingsStub(generateTestId())
      await initialize(stub)
    })

    it('should update thing in SQLite', async () => {
      const created = await createThing(stub, { $type: 'Customer', name: 'Alice' })

      await new Promise(resolve => setTimeout(resolve, 1))

      const updated = await updateThing(stub, created.$id, { name: 'Bob' })

      expect(updated.name).toBe('Bob')
      expect(updated.$type).toBe('Customer')
      expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$updatedAt)
    })

    it('should throw for non-existent thing', async () => {
      await expect(updateThing(stub, 'non-existent', { name: 'Bob' })).rejects.toThrow('Thing not found')
    })

    it('should preserve $id, $type, and $createdAt', async () => {
      const created = await createThing(stub, { $type: 'Customer', name: 'Alice' })
      const updated = await updateThing(stub, created.$id, {
        $id: 'new-id',
        $type: 'Order',
        $createdAt: 0
      })

      expect(updated.$id).toBe(created.$id)
      expect(updated.$type).toBe('Customer')
      expect(updated.$createdAt).toBe(created.$createdAt)
    })
  })

  describe('delete', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getThingsStub(generateTestId())
      await initialize(stub)
    })

    it('should delete thing from SQLite', async () => {
      const created = await createThing(stub, { $type: 'Customer', name: 'Alice' })
      await deleteThing(stub, created.$id)

      const result = await getThing(stub, created.$id)
      expect(result).toBeNull()
    })

    it('should throw for non-existent thing', async () => {
      await expect(deleteThing(stub, 'non-existent')).rejects.toThrow('Thing not found')
    })
  })

  describe('list', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getThingsStub(generateTestId())
      await initialize(stub)
    })

    it('should list all things', async () => {
      await createThing(stub, { $type: 'Customer', name: 'Alice' })
      await createThing(stub, { $type: 'Order', total: 100 })
      await createThing(stub, { $type: 'Customer', name: 'Bob' })

      const all = await listThings(stub)
      expect(all.length).toBeGreaterThanOrEqual(3)
    })

    it('should filter by type', async () => {
      await createThing(stub, { $type: 'Customer', name: 'Alice' })
      await createThing(stub, { $type: 'Order', total: 100 })
      await createThing(stub, { $type: 'Customer', name: 'Bob' })

      const customers = await listThings(stub, { type: 'Customer' })
      expect(customers).toHaveLength(2)
      expect(customers.every(t => t.$type === 'Customer')).toBe(true)
    })

    it('should support limit', async () => {
      for (let i = 0; i < 5; i++) {
        await createThing(stub, { $type: 'Item', index: i })
      }

      const limited = await listThings(stub, { limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should support offset', async () => {
      for (let i = 0; i < 5; i++) {
        await createThing(stub, { $type: 'Item', index: i })
      }

      const page1 = await listThings(stub, { limit: 2, offset: 0 })
      const page2 = await listThings(stub, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)

      const page1Ids = page1.map(t => t.$id)
      const page2Ids = page2.map(t => t.$id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })

    it('should sort by createdAt descending', async () => {
      await createThing(stub, { $type: 'Item', name: 'first' })
      await new Promise(resolve => setTimeout(resolve, 5))
      await createThing(stub, { $type: 'Item', name: 'second' })
      await new Promise(resolve => setTimeout(resolve, 5))
      await createThing(stub, { $type: 'Item', name: 'third' })

      const items = await listThings(stub, { type: 'Item' })

      // Verify newest is first (may have same timestamp in fast execution)
      expect(items[0].$createdAt).toBeGreaterThanOrEqual(items[1].$createdAt)
      expect(items[1].$createdAt).toBeGreaterThanOrEqual(items[2].$createdAt)
      // Verify we got the right number of items
      expect(items).toHaveLength(3)
    })
  })
})
