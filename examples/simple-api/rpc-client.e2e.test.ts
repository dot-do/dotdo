/**
 * RPC Client E2E Tests
 *
 * Tests the RPC client against a running simple-api worker.
 *
 * Run with:
 *   1. Start the dev server: npm run dev
 *   2. In another terminal: npm test
 *
 * Or against deployed:
 *   TEST_URL=https://simple-api.your-domain.workers.dev npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Test configuration
const TEST_URL = process.env.TEST_URL || 'http://localhost:8787'

describe('RPC Client E2E Tests', () => {
  describe('Basic CRUD via HTTP', () => {
    const testId = `test-${Date.now()}`

    it('should create a thing via POST', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          $id: testId,
          name: 'Alice',
          email: 'alice@example.com',
        }),
      })

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.$id).toBe(testId)
      expect(data.name).toBe('Alice')
    })

    it('should read the created thing via GET', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.$id).toBe(testId)
      expect(data.name).toBe('Alice')
    })

    it('should list things by type', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer`)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.some((c: { $id: string }) => c.$id === testId)).toBe(true)
    })

    it('should update the thing via PATCH', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice Updated' }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.name).toBe('Alice Updated')
      expect(data.email).toBe('alice@example.com') // Should preserve existing fields
    })

    it('should delete the thing via DELETE', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.deleted).toBe(true)
    })

    it('should return 404 for deleted thing', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`)
      expect(response.status).toBe(404)
    })
  })

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await fetch(`${TEST_URL}/health`)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.status).toBe('ok')
    })
  })

  describe('RPC Pipeline Endpoint', () => {
    it('should accept pipeline requests', async () => {
      const response = await fetch(`${TEST_URL}/rpc/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: ['Customer', 'test-123'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.executed).toBe(true)
    })
  })
})

describe('RPC Client with @dotdo/core', () => {
  // These tests require the @dotdo/core package to be built
  // Skip if running without the package available

  it.skip('should create a typed RPC client', async () => {
    // This would use the actual RPC client:
    // import { createRPCClient } from '@dotdo/core'
    //
    // interface SimpleAPI {
    //   things: {
    //     list(type: string): Promise<any[]>
    //     get(type: string, id: string): Promise<any>
    //     create(type: string, data: any): Promise<any>
    //   }
    // }
    //
    // const client = createRPCClient<SimpleAPI>({ target: TEST_URL })
    // const customers = await client.things.list('Customer')
    // expect(Array.isArray(customers)).toBe(true)
  })

  it.skip('should support promise pipelining', async () => {
    // This would test the pipeline API:
    // import { createRPCClient, pipeline } from '@dotdo/core'
    //
    // const client = createRPCClient({ target: TEST_URL })
    // const result = await pipeline(client)
    //   .then('things')
    //   .then('list', 'Customer')
    //   .execute()
  })
})
