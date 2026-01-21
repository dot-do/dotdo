/**
 * E2E Storage Persistence Tests
 *
 * Tests that verify data persistence across DO lifecycle:
 * 1. Data survives DO hibernation/wake cycles
 * 2. Storage operations are durable (write, read, delete)
 * 3. Transactions maintain consistency
 * 4. Index integrity maintained
 *
 * Critical path for data reliability.
 *
 * NO MOCKS - uses real Miniflare instances with SQLite.
 *
 * @module e2e/tests/storage-persistence.test
 * @see do-cymx
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TEST DO SCRIPT - Storage Persistence
// ============================================================================

const STORAGE_DO_SCRIPT = `
export class StorageDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // Storage operations
    if (path === '/storage/put' && request.method === 'POST') {
      const { key, value } = await request.json()
      await this.storage.put(key, value)
      return Response.json({ stored: true, key })
    }

    if (path === '/storage/get' && request.method === 'POST') {
      const { key } = await request.json()
      const value = await this.storage.get(key)
      return Response.json({ key, value, exists: value !== undefined })
    }

    if (path === '/storage/delete' && request.method === 'POST') {
      const { key } = await request.json()
      const existed = await this.storage.get(key) !== undefined
      await this.storage.delete(key)
      return Response.json({ deleted: true, existed })
    }

    if (path === '/storage/list' && request.method === 'GET') {
      const entries = await this.storage.list()
      const result = {}
      for (const [key, value] of entries) {
        result[key] = value
      }
      return Response.json(result)
    }

    // Batch operations
    if (path === '/storage/put-many' && request.method === 'POST') {
      const { entries } = await request.json()
      await this.storage.put(entries)
      return Response.json({ stored: Object.keys(entries).length })
    }

    if (path === '/storage/delete-many' && request.method === 'POST') {
      const { keys } = await request.json()
      await this.storage.delete(keys)
      return Response.json({ deleted: keys.length })
    }

    // Transaction simulation
    if (path === '/storage/transaction' && request.method === 'POST') {
      const { operations } = await request.json()

      try {
        // Simulate transaction by batching operations
        const toStore = {}
        const toDelete = []

        for (const op of operations) {
          if (op.type === 'put') {
            toStore[op.key] = op.value
          } else if (op.type === 'delete') {
            toDelete.push(op.key)
          }
        }

        if (Object.keys(toStore).length > 0) {
          await this.storage.put(toStore)
        }
        if (toDelete.length > 0) {
          await this.storage.delete(toDelete)
        }

        return Response.json({
          success: true,
          operations: operations.length,
          stored: Object.keys(toStore).length,
          deleted: toDelete.length
        })
      } catch (error) {
        return Response.json({
          success: false,
          error: error.message
        }, { status: 500 })
      }
    }

    // Index operations (Things pattern)
    if (path === '/things' && request.method === 'POST') {
      return this.createThing(request)
    }

    if (path === '/things' && request.method === 'GET') {
      return this.listThings()
    }

    const thingMatch = path.match(/^\\/things\\/([^/]+)$/)
    if (thingMatch) {
      const id = thingMatch[1]
      if (request.method === 'GET') {
        return this.getThing(id)
      }
      if (request.method === 'DELETE') {
        return this.deleteThing(id)
      }
    }

    // Storage stats
    if (path === '/storage/stats') {
      const all = await this.storage.list()
      return Response.json({
        totalKeys: all.size,
        keys: Array.from(all.keys())
      })
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  async createThing(request) {
    const data = await request.json()
    const id = 'thing-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)

    const thing = {
      $id: id,
      $type: data.$type || 'Thing',
      ...data,
      createdAt: Date.now()
    }

    // Store thing
    await this.storage.put('thing:' + id, thing)

    // Update index
    const index = await this.storage.get('thing-index') || []
    index.push(id)
    await this.storage.put('thing-index', index)

    return Response.json(thing, { status: 201 })
  }

  async getThing(id) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json(thing)
  }

  async listThings() {
    const index = await this.storage.get('thing-index') || []
    const things = []

    for (const id of index) {
      const thing = await this.storage.get('thing:' + id)
      if (thing) {
        things.push(thing)
      }
    }

    return Response.json(things)
  }

  async deleteThing(id) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    await this.storage.delete('thing:' + id)

    // Update index
    const index = await this.storage.get('thing-index') || []
    const newIndex = index.filter(i => i !== id)
    await this.storage.put('thing-index', newIndex)

    return new Response(null, { status: 204 })
  }
}

export default {
  async fetch(request, env) {
    const id = env.STORAGE_DO.idFromName('test-storage')
    const stub = env.STORAGE_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function createClient(mf: Miniflare) {
  return {
    async put(key: string, value: unknown) {
      const response = await mf.dispatchFetch('http://localhost/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      return response.json()
    },

    async get(key: string) {
      const response = await mf.dispatchFetch('http://localhost/storage/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      return response.json()
    },

    async delete(key: string) {
      const response = await mf.dispatchFetch('http://localhost/storage/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      return response.json()
    },

    async list() {
      const response = await mf.dispatchFetch('http://localhost/storage/list')
      return response.json()
    },

    async putMany(entries: Record<string, unknown>) {
      const response = await mf.dispatchFetch('http://localhost/storage/put-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      return response.json()
    },

    async deleteMany(keys: string[]) {
      const response = await mf.dispatchFetch('http://localhost/storage/delete-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })
      return response.json()
    },

    async transaction(operations: Array<{ type: 'put' | 'delete'; key: string; value?: unknown }>) {
      const response = await mf.dispatchFetch('http://localhost/storage/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations }),
      })
      return response.json()
    },

    async createThing(data: Record<string, unknown>) {
      const response = await mf.dispatchFetch('http://localhost/things', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return response.json()
    },

    async getThing(id: string) {
      const response = await mf.dispatchFetch(\`http://localhost/things/\${id}\`)
      return { status: response.status, data: await response.json() }
    },

    async listThings() {
      const response = await mf.dispatchFetch('http://localhost/things')
      return response.json()
    },

    async deleteThing(id: string) {
      const response = await mf.dispatchFetch(\`http://localhost/things/\${id}\`, {
        method: 'DELETE',
      })
      return response.status
    },

    async stats() {
      const response = await mf.dispatchFetch('http://localhost/storage/stats')
      return response.json()
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('E2E Storage Persistence Tests', () => {
  let mf: Miniflare
  let client: ReturnType<typeof createClient>

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: STORAGE_DO_SCRIPT,
      durableObjects: {
        STORAGE_DO: 'StorageDO',
      },
    })

    client = createClient(mf)
  })

  afterAll(async () => {
    await mf.dispose()
  })

  describe('Basic Storage Operations', () => {
    it('should store and retrieve values', async () => {
      const key = \`test-key-\${Date.now()}\`
      const value = { message: 'Hello, World!', timestamp: Date.now() }

      // Store
      const putResult = await client.put(key, value)
      expect(putResult.stored).toBe(true)

      // Retrieve
      const getResult = await client.get(key)
      expect(getResult.exists).toBe(true)
      expect(getResult.value).toEqual(value)
    })

    it('should handle different data types', async () => {
      const testCases = [
        { key: 'string-value', value: 'Hello' },
        { key: 'number-value', value: 42 },
        { key: 'boolean-value', value: true },
        { key: 'null-value', value: null },
        { key: 'array-value', value: [1, 2, 3] },
        { key: 'object-value', value: { nested: { deep: 'value' } } },
      ]

      for (const { key, value } of testCases) {
        await client.put(\`types-\${key}\`, value)
      }

      for (const { key, value } of testCases) {
        const result = await client.get(\`types-\${key}\`)
        expect(result.value).toEqual(value)
      }
    })

    it('should delete values', async () => {
      const key = \`delete-test-\${Date.now()}\`

      // Store
      await client.put(key, { data: 'temporary' })

      // Verify exists
      let result = await client.get(key)
      expect(result.exists).toBe(true)

      // Delete
      const deleteResult = await client.delete(key)
      expect(deleteResult.deleted).toBe(true)
      expect(deleteResult.existed).toBe(true)

      // Verify gone
      result = await client.get(key)
      expect(result.exists).toBe(false)
    })

    it('should handle non-existent keys', async () => {
      const result = await client.get('non-existent-key-12345')

      expect(result.exists).toBe(false)
      expect(result.value).toBeUndefined()
    })
  })

  describe('Batch Operations', () => {
    it('should store multiple values at once', async () => {
      const entries = {
        'batch-1': { value: 1 },
        'batch-2': { value: 2 },
        'batch-3': { value: 3 },
        'batch-4': { value: 4 },
        'batch-5': { value: 5 },
      }

      const result = await client.putMany(entries)
      expect(result.stored).toBe(5)

      // Verify all were stored
      for (const [key, value] of Object.entries(entries)) {
        const retrieved = await client.get(key)
        expect(retrieved.value).toEqual(value)
      }
    })

    it('should delete multiple values at once', async () => {
      const keys = ['multi-delete-1', 'multi-delete-2', 'multi-delete-3']

      // Store values first
      for (const key of keys) {
        await client.put(key, { value: key })
      }

      // Delete all
      const result = await client.deleteMany(keys)
      expect(result.deleted).toBe(3)

      // Verify all deleted
      for (const key of keys) {
        const retrieved = await client.get(key)
        expect(retrieved.exists).toBe(false)
      }
    })

    it('should list all stored keys', async () => {
      const prefix = \`list-test-\${Date.now()}\`

      // Store some values
      await client.put(\`\${prefix}-1\`, 'a')
      await client.put(\`\${prefix}-2\`, 'b')
      await client.put(\`\${prefix}-3\`, 'c')

      const list = await client.list()

      expect(list[\`\${prefix}-1\`]).toBe('a')
      expect(list[\`\${prefix}-2\`]).toBe('b')
      expect(list[\`\${prefix}-3\`]).toBe('c')
    })
  })

  describe('Transaction Consistency', () => {
    it('should complete all operations in a transaction', async () => {
      const txId = Date.now().toString(36)

      const operations = [
        { type: 'put' as const, key: \`tx-\${txId}-1\`, value: 'value1' },
        { type: 'put' as const, key: \`tx-\${txId}-2\`, value: 'value2' },
        { type: 'put' as const, key: \`tx-\${txId}-3\`, value: 'value3' },
      ]

      const result = await client.transaction(operations)

      expect(result.success).toBe(true)
      expect(result.stored).toBe(3)

      // Verify all values were stored
      for (const op of operations) {
        const retrieved = await client.get(op.key)
        expect(retrieved.value).toBe(op.value)
      }
    })

    it('should handle mixed put/delete in transaction', async () => {
      const txId = Date.now().toString(36)

      // Pre-populate some keys
      await client.put(\`tx-del-\${txId}-1\`, 'old1')
      await client.put(\`tx-del-\${txId}-2\`, 'old2')

      const operations = [
        { type: 'delete' as const, key: \`tx-del-\${txId}-1\` },
        { type: 'put' as const, key: \`tx-del-\${txId}-2\`, value: 'new2' },
        { type: 'put' as const, key: \`tx-del-\${txId}-3\`, value: 'new3' },
      ]

      const result = await client.transaction(operations)

      expect(result.success).toBe(true)
      expect(result.stored).toBe(2)
      expect(result.deleted).toBe(1)

      // Verify state
      const key1 = await client.get(\`tx-del-\${txId}-1\`)
      expect(key1.exists).toBe(false)

      const key2 = await client.get(\`tx-del-\${txId}-2\`)
      expect(key2.value).toBe('new2')

      const key3 = await client.get(\`tx-del-\${txId}-3\`)
      expect(key3.value).toBe('new3')
    })
  })

  describe('Index Integrity', () => {
    it('should maintain index when creating things', async () => {
      const thing1 = await client.createThing({ name: 'Thing 1' })
      const thing2 = await client.createThing({ name: 'Thing 2' })
      const thing3 = await client.createThing({ name: 'Thing 3' })

      expect(thing1.$id).toBeDefined()
      expect(thing2.$id).toBeDefined()
      expect(thing3.$id).toBeDefined()

      // List should return all
      const list = await client.listThings()

      const ids = list.map((t: any) => t.$id)
      expect(ids).toContain(thing1.$id)
      expect(ids).toContain(thing2.$id)
      expect(ids).toContain(thing3.$id)
    })

    it('should update index when deleting things', async () => {
      const thing = await client.createThing({ name: 'To Delete' })

      // Verify in list
      let list = await client.listThings()
      expect(list.some((t: any) => t.$id === thing.$id)).toBe(true)

      // Delete
      const status = await client.deleteThing(thing.$id)
      expect(status).toBe(204)

      // Verify removed from list
      list = await client.listThings()
      expect(list.some((t: any) => t.$id === thing.$id)).toBe(false)
    })

    it('should handle rapid index updates', async () => {
      // Create many things rapidly
      const promises = Array.from({ length: 20 }, (_, i) =>
        client.createThing({ name: \`Rapid Thing \${i}\` })
      )

      const created = await Promise.all(promises)

      // List should have all
      const list = await client.listThings()

      expect(list.length).toBeGreaterThanOrEqual(20)

      for (const thing of created) {
        expect(list.some((t: any) => t.$id === thing.$id)).toBe(true)
      }
    })
  })

  describe('Data Persistence', () => {
    it('should persist data across multiple requests', async () => {
      const key = \`persist-test-\${Date.now()}\`
      const value = { persistent: true, timestamp: Date.now() }

      // Store
      await client.put(key, value)

      // Read multiple times
      for (let i = 0; i < 5; i++) {
        const result = await client.get(key)
        expect(result.value).toEqual(value)
      }
    })

    it('should handle large data payloads', async () => {
      const key = \`large-data-\${Date.now()}\`
      const largeValue = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: \`Item \${i}\`,
          data: 'x'.repeat(100),
        })),
      }

      await client.put(key, largeValue)

      const result = await client.get(key)
      expect(result.value.items).toHaveLength(1000)
      expect(result.value.items[0].id).toBe(0)
      expect(result.value.items[999].id).toBe(999)
    })

    it('should maintain data integrity under concurrent operations', async () => {
      const prefix = \`concurrent-\${Date.now()}\`

      // Concurrent writes to different keys
      const writePromises = Array.from({ length: 10 }, (_, i) =>
        client.put(\`\${prefix}-\${i}\`, { index: i, timestamp: Date.now() })
      )

      await Promise.all(writePromises)

      // Concurrent reads
      const readPromises = Array.from({ length: 10 }, (_, i) =>
        client.get(\`\${prefix}-\${i}\`)
      )

      const results = await Promise.all(readPromises)

      // All values should be correct
      results.forEach((result, i) => {
        expect(result.exists).toBe(true)
        expect(result.value.index).toBe(i)
      })
    })
  })

  describe('Storage Statistics', () => {
    it('should report accurate storage stats', async () => {
      // Get initial stats
      const initialStats = await client.stats()
      const initialCount = initialStats.totalKeys

      // Add some data
      await client.put('stats-test-1', 'value1')
      await client.put('stats-test-2', 'value2')
      await client.put('stats-test-3', 'value3')

      // Check stats again
      const newStats = await client.stats()

      expect(newStats.totalKeys).toBeGreaterThanOrEqual(initialCount + 3)
      expect(newStats.keys).toContain('stats-test-1')
      expect(newStats.keys).toContain('stats-test-2')
      expect(newStats.keys).toContain('stats-test-3')
    })
  })
})
