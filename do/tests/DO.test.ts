import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

/**
 * DO Class Tests - Using Real Miniflare Runtime
 *
 * These tests use @cloudflare/vitest-pool-workers to test against
 * real Durable Objects instead of mocks. This ensures:
 * - Real storage persistence
 * - Real SQLite operations
 * - Real concurrency handling (blockConcurrencyWhile)
 * - Real WebSocket hibernation
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

describe('DO Class', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  describe('health check', () => {
    it('should respond to GET /', async () => {
      const stub = getDoStub(testId)
      const response = await stub.fetch('https://do/')

      expect(response.status).toBe(200)
      const json = await response.json() as { status: string; id: string }
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
      expect(typeof json.id).toBe('string')
    })
  })

  describe('RPC endpoint', () => {
    it('should return 404 for unknown methods', async () => {
      const stub = getDoStub(testId)
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'unknownMethod', args: [] })
      })

      expect(response.status).toBe(404)
    })

    it('should call things.create via RPC', async () => {
      const stub = getDoStub(testId)
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice' }]
        })
      })

      expect(response.status).toBe(200)
      const json = await response.json() as { $id: string; $type: string; name: string }
      expect(json.$id).toBeDefined()
      expect(json.$type).toBe('Customer')
      expect(json.name).toBe('Alice')
    })

    it('should handle nested methods via dot notation', async () => {
      const stub = getDoStub(testId)

      // First create a thing
      const createResponse = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Order', total: 100 }]
        })
      })
      expect(createResponse.status).toBe(200)
      const created = await createResponse.json() as { $id: string }

      // Then get it back
      const getResponse = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })
      expect(getResponse.status).toBe(200)
      const retrieved = await getResponse.json() as { $id: string; total: number }
      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.total).toBe(100)
    })
  })

  describe('info endpoint', () => {
    it('should return storage info at /info', async () => {
      const stub = getDoStub(testId)
      const response = await stub.fetch('https://do/info')

      expect(response.status).toBe(200)
      const json = await response.json() as { id: string; keys: number }
      expect(json.id).toBeDefined()
      expect(typeof json.keys).toBe('number')
    })
  })

  // Note: Subclassing tests require static class registration in wrangler config
  // For now, test the base DO behavior which is what we can test with env.DO
  describe('base functionality', () => {
    it('should handle concurrent requests to same instance', async () => {
      const stub = getDoStub(testId)

      // Make multiple concurrent requests
      const requests = Array.from({ length: 5 }, (_, i) =>
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'things.create',
            args: [{ $type: 'Item', index: i }]
          })
        })
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // Verify all items were created
      const listResponse = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.list',
          args: [{ $type: 'Item' }]
        })
      })
      expect(listResponse.status).toBe(200)
      const items = await listResponse.json() as Array<{ $type: string }>
      expect(items.length).toBe(5)
    })

    it('should persist data within same instance', async () => {
      const stub = getDoStub(testId)

      // Create a thing
      const createResponse = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'User', email: 'test@example.com' }]
        })
      })
      const created = await createResponse.json() as { $id: string }

      // Get it back immediately
      const getResponse = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })
      const retrieved = await getResponse.json() as { $id: string; email: string }
      expect(retrieved.email).toBe('test@example.com')
    })
  })

  describe('CORS', () => {
    it('should include CORS headers on preflight requests', async () => {
      const stub = getDoStub(testId)
      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      })
      // CORS headers should be present
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })
  })
})
