/**
 * Instance Endpoint Tests
 *
 * Tests for the /DO/:id/* endpoints that provide direct access to
 * Durable Object instances and their state, methods, and lifecycle.
 *
 * These tests verify:
 * - Instance creation and access
 * - State management (get, set, delete)
 * - RPC method invocation on instances
 * - Instance metadata and health
 * - WebSocket connections to instances
 * - Instance lifecycle (hibernation, wake)
 * - Cross-instance communication
 * - Error handling and edge cases
 *
 * These tests are expected to FAIL until the instance endpoint is fully implemented.
 *
 * Note: These tests run in the 'api-discovery' workspace (Node environment).
 * For full Workers integration tests, see api/tests/routes/*.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// Import the Hono app for testing
let app: { request: (path: string | Request, options?: RequestInit) => Promise<Response> }

beforeAll(async () => {
  const { createTestApp } = await import('./setup')
  app = await createTestApp()
})

// ============================================================================
// Types
// ============================================================================

interface InstanceInfo {
  id: string
  ns: string
  class: string
  status: 'active' | 'hibernated' | 'error'
  createdAt?: string
  lastActiveAt?: string
  memoryUsage?: number
}

interface InstanceState {
  [key: string]: unknown
}

interface ErrorResponse {
  error: {
    code: string
    message: string
    context?: Record<string, unknown>
  }
}

interface HealthResponse {
  status: 'ok' | 'error'
  ns: string
  uptime?: number
  storageUsed?: number
}

interface RpcResult {
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function generateInstanceId(): string {
  return `test-instance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function createInstance(
  doClass: string = 'DO',
  id?: string
): Promise<{ id: string; response: Response }> {
  const instanceId = id || generateInstanceId()
  const response = await app.request(`http://localhost/${doClass}/${instanceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'init' }),
  })
  return { id: instanceId, response }
}

// ============================================================================
// 1. Instance Access Tests
// ============================================================================

describe('Instance Access - GET /:doClass/:id', () => {
  describe('basic access', () => {
    it('should access an existing instance', async () => {
      const instanceId = generateInstanceId()

      // First, create/initialize the instance
      await app.request(`http://localhost/DO/${instanceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init' }),
      })

      // Then access it
      const response = await app.request(`http://localhost/DO/${instanceId}`)

      expect(response.status).toBe(200)
    })

    it('should return instance info on GET request', async () => {
      const instanceId = generateInstanceId()
      await createInstance('DO', instanceId)

      const response = await app.request(`http://localhost/DO/${instanceId}`)
      const body = (await response.json()) as InstanceInfo

      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('ns')
      expect(body).toHaveProperty('status')
    })

    it('should return JSON content-type', async () => {
      const instanceId = generateInstanceId()
      await createInstance('DO', instanceId)

      const response = await app.request(`http://localhost/DO/${instanceId}`)

      expect(response.headers.get('content-type')).toContain('application/json')
    })

    it('should create instance on first access (lazy initialization)', async () => {
      const instanceId = generateInstanceId()

      // Access an instance that doesn't exist yet
      const response = await app.request(`http://localhost/DO/${instanceId}`)

      // Should succeed (lazy create) or return specific "new instance" indicator
      expect([200, 201]).toContain(response.status)
    })

    it('should handle URL-encoded instance IDs', async () => {
      const instanceId = 'user:alice@example.com'
      const encodedId = encodeURIComponent(instanceId)

      const response = await app.request(`http://localhost/DO/${encodedId}`)

      // Should handle special characters in ID
      expect([200, 201, 404]).toContain(response.status)
    })

    it('should handle UUID-format instance IDs', async () => {
      const instanceId = crypto.randomUUID()

      const response = await app.request(`http://localhost/DO/${instanceId}`)

      expect([200, 201]).toContain(response.status)
    })
  })

  describe('error handling', () => {
    it('should return 404 for unknown DO class', async () => {
      const response = await app.request(`http://localhost/UnknownDOClass/test-id`)

      expect(response.status).toBe(404)

      const body = (await response.json()) as ErrorResponse
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toContain('Unknown DO class')
    })

    it('should return proper error format for invalid requests', async () => {
      const response = await app.request(`http://localhost/InvalidClass/test-id`)
      const body = (await response.json()) as ErrorResponse

      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
    })
  })
})

// ============================================================================
// 2. Instance Health Endpoint Tests
// ============================================================================

describe('Instance Health - GET /:doClass/:id/health', () => {
  it('should return health status for instance', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/health`)

    expect(response.status).toBe(200)

    const body = (await response.json()) as HealthResponse
    expect(body).toHaveProperty('status')
    expect(body.status).toBe('ok')
  })

  it('should include namespace in health response', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/health`)
    const body = (await response.json()) as HealthResponse

    expect(body).toHaveProperty('ns')
    expect(body.ns).toContain(instanceId)
  })

  it('should include uptime in health response', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/health`)
    const body = (await response.json()) as HealthResponse

    expect(body).toHaveProperty('uptime')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })

  it('should include storage usage in health response', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/health`)
    const body = (await response.json()) as HealthResponse

    expect(body).toHaveProperty('storageUsed')
    expect(typeof body.storageUsed).toBe('number')
  })
})

// ============================================================================
// 3. Instance State Management Tests
// ============================================================================

describe('Instance State - /:doClass/:id/state', () => {
  describe('GET /state - retrieve state', () => {
    it('should return empty state for new instance', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/state`)

      expect(response.status).toBe(200)

      const body = (await response.json()) as InstanceState
      expect(body).toEqual({})
    })

    it('should return stored state after PUT', async () => {
      const instanceId = generateInstanceId()
      const testState = { counter: 42, name: 'test' }

      // Store state
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testState),
      })

      // Retrieve state
      const response = await app.request(`http://localhost/DO/${instanceId}/state`)
      const body = (await response.json()) as InstanceState

      expect(body).toEqual(testState)
    })

    it('should support retrieving specific state key', async () => {
      const instanceId = generateInstanceId()
      const testState = { counter: 42, name: 'test', nested: { value: 'deep' } }

      // Store state
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testState),
      })

      // Retrieve specific key
      const response = await app.request(`http://localhost/DO/${instanceId}/state/counter`)
      const body = (await response.json()) as { value: unknown }

      expect(body.value).toBe(42)
    })
  })

  describe('PUT /state - update state', () => {
    it('should store state and return 200', async () => {
      const instanceId = generateInstanceId()
      const testState = { key: 'value' }

      const response = await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testState),
      })

      expect(response.status).toBe(200)
    })

    it('should merge partial state updates', async () => {
      const instanceId = generateInstanceId()

      // Initial state
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 1, b: 2 }),
      })

      // Partial update
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b: 3, c: 4 }),
      })

      // Verify merged state
      const response = await app.request(`http://localhost/DO/${instanceId}/state`)
      const body = (await response.json()) as InstanceState

      expect(body).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('should replace entire state on PUT', async () => {
      const instanceId = generateInstanceId()

      // Initial state
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 1, b: 2 }),
      })

      // Replace with PUT
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: 3 }),
      })

      // Verify replaced state
      const response = await app.request(`http://localhost/DO/${instanceId}/state`)
      const body = (await response.json()) as InstanceState

      expect(body).toEqual({ c: 3 })
      expect(body).not.toHaveProperty('a')
      expect(body).not.toHaveProperty('b')
    })

    it('should return 400 for invalid JSON body', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      })

      expect(response.status).toBe(400)
    })

    it('should handle large state payloads', async () => {
      const instanceId = generateInstanceId()
      const largeState = {
        data: 'x'.repeat(10000),
        array: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })),
      }

      const response = await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(largeState),
      })

      expect(response.status).toBe(200)

      // Verify it was stored correctly
      const getResponse = await app.request(`http://localhost/DO/${instanceId}/state`)
      const body = (await getResponse.json()) as InstanceState

      expect(body).toEqual(largeState)
    })
  })

  describe('DELETE /state - clear state', () => {
    it('should clear all state and return 204', async () => {
      const instanceId = generateInstanceId()

      // Store some state
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' }),
      })

      // Delete all state
      const response = await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(204)

      // Verify state is empty
      const getResponse = await app.request(`http://localhost/DO/${instanceId}/state`)
      const body = (await getResponse.json()) as InstanceState

      expect(body).toEqual({})
    })

    it('should delete specific state key', async () => {
      const instanceId = generateInstanceId()

      // Store state
      await app.request(`http://localhost/DO/${instanceId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 1, b: 2, c: 3 }),
      })

      // Delete specific key
      const response = await app.request(`http://localhost/DO/${instanceId}/state/b`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(204)

      // Verify only that key is deleted
      const getResponse = await app.request(`http://localhost/DO/${instanceId}/state`)
      const body = (await getResponse.json()) as InstanceState

      expect(body).toEqual({ a: 1, c: 3 })
    })
  })
})

// ============================================================================
// 4. Instance RPC Tests
// ============================================================================

describe('Instance RPC - POST /:doClass/:id/rpc/:method', () => {
  describe('method invocation', () => {
    it('should invoke method on instance', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as RpcResult
      expect(body).toHaveProperty('result')
    })

    it('should pass arguments to method', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: ['hello', 'world'] }),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as RpcResult
      expect(body.result).toEqual(['hello', 'world'])
    })

    it('should return method result', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: [5, 3] }),
      })

      const body = (await response.json()) as RpcResult
      expect(body.result).toBe(8)
    })

    it('should handle async methods', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/asyncOperation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: [{ delay: 100 }] }),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as RpcResult
      expect(body).toHaveProperty('result')
    })

    it('should handle methods with object arguments', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/processData`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          args: [{ name: 'test', value: 123, nested: { deep: true } }],
        }),
      })

      expect(response.status).toBe(200)
    })
  })

  describe('error handling', () => {
    it('should return error for unknown method', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/nonExistentMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const body = (await response.json()) as RpcResult
      expect(body).toHaveProperty('error')
      expect(body.error?.code).toBe('METHOD_NOT_FOUND')
    })

    it('should return error when method throws', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/throwError`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const body = (await response.json()) as RpcResult
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
    })

    it('should return 400 for invalid request body', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      expect(response.status).toBe(400)
    })

    it('should not expose private methods', async () => {
      const instanceId = generateInstanceId()

      // Methods starting with underscore should not be callable
      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/_privateMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const body = (await response.json()) as RpcResult
      expect(body).toHaveProperty('error')
      expect(body.error?.code).toBe('METHOD_NOT_FOUND')
    })

    it('should timeout on long-running methods', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/rpc/slowOperation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: [{ duration: 60000 }] }),
      })

      // Should return 504 for timeout
      expect(response.status).toBe(504)

      const body = (await response.json()) as ErrorResponse
      expect(body.error.code).toBe('DO_FETCH_TIMEOUT')
    })
  })
})

// ============================================================================
// 5. Instance Things Collection Tests
// ============================================================================

describe('Instance Things - /:doClass/:id/things', () => {
  describe('GET /things - list things', () => {
    it('should return empty array for new instance', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/things`)

      expect(response.status).toBe(200)

      const body = await response.json() as unknown[]
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(0)
    })

    it('should return things after creation', async () => {
      const instanceId = generateInstanceId()

      // Create a thing
      await app.request(`http://localhost/DO/${instanceId}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Thing', $type: 'TestType' }),
      })

      // List things
      const response = await app.request(`http://localhost/DO/${instanceId}/things`)
      const body = await response.json() as unknown[]

      expect(body).toHaveLength(1)
    })

    it('should support pagination', async () => {
      const instanceId = generateInstanceId()

      // Create multiple things
      for (let i = 0; i < 10; i++) {
        await app.request(`http://localhost/DO/${instanceId}/things`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Thing ${i}`, $type: 'TestType' }),
        })
      }

      // List with limit
      const response = await app.request(`http://localhost/DO/${instanceId}/things?limit=5`)
      const body = await response.json() as unknown[]

      expect(body.length).toBeLessThanOrEqual(5)
    })
  })

  describe('POST /things - create thing', () => {
    it('should create thing and return 201', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Thing', $type: 'TestType' }),
      })

      expect(response.status).toBe(201)

      const body = await response.json() as { id: string; $id: string; name: string }
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('$id')
      expect(body.name).toBe('New Thing')
    })
  })

  describe('GET /things/:id - get specific thing', () => {
    it('should return thing by ID', async () => {
      const instanceId = generateInstanceId()

      // Create a thing
      const createResponse = await app.request(`http://localhost/DO/${instanceId}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Specific Thing', $type: 'TestType' }),
      })
      const created = await createResponse.json() as { id: string }

      // Get the thing
      const response = await app.request(`http://localhost/DO/${instanceId}/things/${created.id}`)

      expect(response.status).toBe(200)

      const body = await response.json() as { id: string; name: string }
      expect(body.id).toBe(created.id)
      expect(body.name).toBe('Specific Thing')
    })

    it('should return 404 for non-existent thing', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/things/non-existent-id`)

      expect(response.status).toBe(404)
    })
  })
})

// ============================================================================
// 6. Instance Events Tests
// ============================================================================

describe('Instance Events - /:doClass/:id/events', () => {
  describe('GET /events - list events', () => {
    it('should return events from instance', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/events`)

      expect(response.status).toBe(200)

      const body = await response.json() as unknown[]
      expect(Array.isArray(body)).toBe(true)
    })

    it('should support filtering by verb', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/events?verb=created`)

      expect(response.status).toBe(200)
    })

    it('should support filtering by time range', async () => {
      const instanceId = generateInstanceId()
      const since = new Date(Date.now() - 3600000).toISOString()

      const response = await app.request(`http://localhost/DO/${instanceId}/events?since=${since}`)

      expect(response.status).toBe(200)
    })
  })

  describe('POST /events - emit event', () => {
    it('should emit event and return 201', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verb: 'test.event', data: { key: 'value' } }),
      })

      expect(response.status).toBe(201)

      const body = await response.json() as { id: string; verb: string }
      expect(body).toHaveProperty('id')
      expect(body.verb).toBe('test.event')
    })
  })
})

// ============================================================================
// 7. Instance Actions Tests
// ============================================================================

describe('Instance Actions - /:doClass/:id/actions', () => {
  describe('GET /actions - list actions', () => {
    it('should return actions from instance', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/actions`)

      expect(response.status).toBe(200)

      const body = await response.json() as unknown[]
      expect(Array.isArray(body)).toBe(true)
    })

    it('should support filtering by status', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/actions?status=pending`)

      expect(response.status).toBe(200)
    })
  })

  describe('POST /actions - trigger action', () => {
    it('should trigger action and return action record', async () => {
      const instanceId = generateInstanceId()

      const response = await app.request(`http://localhost/DO/${instanceId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verb: 'processOrder',
          durability: 'do',
          input: { orderId: '12345' },
        }),
      })

      expect([200, 201, 202]).toContain(response.status)

      const body = await response.json() as { id: string; status: string }
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('status')
    })
  })
})

// ============================================================================
// 8. Instance WebSocket Tests
// ============================================================================

describe('Instance WebSocket - /:doClass/:id/rpc (WebSocket)', () => {
  it('should accept WebSocket upgrade', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/rpc`, {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
  })

  it('should return 426 without proper upgrade headers', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/rpc`, {
      method: 'GET',
    })

    // Should indicate WebSocket upgrade required or return RPC info
    expect([200, 426]).toContain(response.status)
  })
})

// ============================================================================
// 9. Instance Sync WebSocket Tests
// ============================================================================

describe('Instance Sync - /:doClass/:id/sync (WebSocket)', () => {
  it('should accept WebSocket upgrade for sync', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/sync`, {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
  })

  it('should return 426 for non-WebSocket sync request', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/sync`, {
      method: 'GET',
    })

    expect(response.status).toBe(426)
  })
})

// ============================================================================
// 10. Instance MCP Endpoint Tests
// ============================================================================

describe('Instance MCP - /:doClass/:id/mcp', () => {
  it('should accept MCP requests', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 1,
      }),
    })

    expect(response.status).toBe(200)
  })

  it('should return JSON-RPC formatted response', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2,
      }),
    })

    const body = await response.json() as { jsonrpc: string; id: number }
    expect(body).toHaveProperty('jsonrpc')
    expect(body.jsonrpc).toBe('2.0')
    expect(body).toHaveProperty('id')
  })
})

// ============================================================================
// 11. Cross-Instance Communication Tests
// ============================================================================

describe('Cross-Instance Communication', () => {
  it('should invoke method on another instance', async () => {
    const sourceId = generateInstanceId()
    const targetId = generateInstanceId()

    // Initialize target instance
    await createInstance('DO', targetId)

    // Call method on source that invokes target
    const response = await app.request(`http://localhost/DO/${sourceId}/rpc/invokeRemote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: [{ targetNs: `DO/${targetId}`, method: 'ping' }],
      }),
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as RpcResult
    expect(body).toHaveProperty('result')
  })

  it('should handle cross-instance errors gracefully', async () => {
    const sourceId = generateInstanceId()

    // Try to call non-existent instance
    const response = await app.request(`http://localhost/DO/${sourceId}/rpc/invokeRemote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        args: [{ targetNs: 'DO/non-existent-instance', method: 'ping' }],
      }),
    })

    const body = (await response.json()) as RpcResult
    // Should return error, not crash
    expect(body).toBeDefined()
  })
})

// ============================================================================
// 12. Instance Metadata Tests
// ============================================================================

describe('Instance Metadata - /:doClass/:id/meta', () => {
  it('should return instance metadata', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/meta`)

    expect(response.status).toBe(200)

    const body = await response.json() as InstanceInfo
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('class')
    expect(body).toHaveProperty('status')
  })

  it('should include creation timestamp', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/meta`)
    const body = await response.json() as InstanceInfo

    expect(body).toHaveProperty('createdAt')
    expect(new Date(body.createdAt!).getTime()).toBeGreaterThan(0)
  })

  it('should include last active timestamp', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    const response = await app.request(`http://localhost/DO/${instanceId}/meta`)
    const body = await response.json() as InstanceInfo

    expect(body).toHaveProperty('lastActiveAt')
  })
})

// ============================================================================
// 13. Instance Resolve Endpoint Tests
// ============================================================================

describe('Instance Resolve - /:doClass/:id/resolve', () => {
  it('should resolve local thing by path', async () => {
    const instanceId = generateInstanceId()

    // Create a thing first
    const createResponse = await app.request(`http://localhost/DO/${instanceId}/things`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Resolvable Thing', $type: 'TestType' }),
    })
    const created = await createResponse.json() as { id: string }

    // Resolve it
    const response = await app.request(
      `http://localhost/DO/${instanceId}/resolve?path=TestType/${created.id}`
    )

    expect(response.status).toBe(200)

    const body = await response.json() as { $id: string; $type: string }
    expect(body).toHaveProperty('$id')
    expect(body).toHaveProperty('$type')
  })

  it('should return 404 for non-existent path', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(
      `http://localhost/DO/${instanceId}/resolve?path=TestType/non-existent`
    )

    expect(response.status).toBe(404)
  })

  it('should require path parameter', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/resolve`)

    expect(response.status).toBe(400)

    const body = await response.json() as ErrorResponse
    expect(body.error.message).toContain('path')
  })
})

// ============================================================================
// 14. Multiple DO Class Tests
// ============================================================================

describe('Multiple DO Classes', () => {
  it('should route to TEST_DO namespace', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/TEST_DO/${instanceId}/health`)

    expect([200, 404]).toContain(response.status)
  })

  it('should route to BROWSER_DO namespace', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/BROWSER_DO/${instanceId}/health`)

    expect([200, 404]).toContain(response.status)
  })

  it('should route to SANDBOX_DO namespace', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/SANDBOX_DO/${instanceId}/health`)

    expect([200, 404]).toContain(response.status)
  })

  it('should isolate state between DO classes', async () => {
    const instanceId = 'shared-id-test'

    // Set state on DO
    await app.request(`http://localhost/DO/${instanceId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class: 'DO' }),
    })

    // Set different state on TEST_DO with same instance ID
    await app.request(`http://localhost/TEST_DO/${instanceId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class: 'TEST_DO' }),
    })

    // Verify they are isolated
    const doResponse = await app.request(`http://localhost/DO/${instanceId}/state`)
    const doState = await doResponse.json() as InstanceState

    const testDoResponse = await app.request(`http://localhost/TEST_DO/${instanceId}/state`)
    const testDoState = await testDoResponse.json() as InstanceState

    expect(doState.class).toBe('DO')
    expect(testDoState.class).toBe('TEST_DO')
  })
})

// ============================================================================
// 15. Headers and CORS Tests
// ============================================================================

describe('Headers and CORS', () => {
  it('should include CORS headers in response', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/health`)

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined()
  })

  it('should handle OPTIONS preflight', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/rpc/ping`, {
      method: 'OPTIONS',
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined()
  })

  it('should echo X-Request-ID header', async () => {
    const instanceId = generateInstanceId()
    const requestId = `test-${Date.now()}`

    const response = await app.request(`http://localhost/DO/${instanceId}/health`, {
      headers: { 'X-Request-ID': requestId },
    })

    expect(response.headers.get('X-Request-ID')).toBe(requestId)
  })

  it('should forward custom headers to DO', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/rpc/echoHeaders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)
  })
})

// ============================================================================
// 16. Error Scenarios Tests
// ============================================================================

describe('Error Scenarios', () => {
  it('should handle DO fetch timeout gracefully', async () => {
    const instanceId = generateInstanceId()

    // This should trigger a timeout scenario
    const response = await app.request(`http://localhost/DO/${instanceId}/rpc/hang`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(504)

    const body = await response.json() as ErrorResponse
    expect(body.error.code).toBe('DO_FETCH_TIMEOUT')
  })

  it('should handle DO internal errors', async () => {
    const instanceId = generateInstanceId()

    const response = await app.request(`http://localhost/DO/${instanceId}/rpc/causeInternalError`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect([500, 502]).toContain(response.status)

    const body = await response.json() as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('should include request context in error responses', async () => {
    const instanceId = generateInstanceId()
    const requestId = `error-test-${Date.now()}`

    const response = await app.request(`http://localhost/DO/${instanceId}/rpc/throwError`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
      },
      body: JSON.stringify({}),
    })

    const body = await response.json() as ErrorResponse

    if (body.error?.context) {
      expect(body.error.context).toHaveProperty('requestId')
    }
  })

  it('should handle malformed path gracefully', async () => {
    const response = await app.request('http://localhost/DO/../../../etc/passwd')

    expect([400, 404]).toContain(response.status)
  })

  it('should handle empty instance ID', async () => {
    const response = await app.request('http://localhost/DO//')

    expect([400, 404]).toContain(response.status)
  })
})

// ============================================================================
// 17. Rate Limiting Tests (Future)
// ============================================================================

describe('Rate Limiting', () => {
  it.skip('should enforce rate limits per instance', async () => {
    const instanceId = generateInstanceId()

    // Make many rapid requests
    const requests = Array.from({ length: 100 }, () =>
      app.request(`http://localhost/DO/${instanceId}/health`)
    )

    const responses = await Promise.all(requests)
    const rateLimited = responses.filter(r => r.status === 429)

    // Should have some rate-limited responses
    expect(rateLimited.length).toBeGreaterThan(0)
  })

  it.skip('should include Retry-After header when rate limited', async () => {
    const instanceId = generateInstanceId()

    // Trigger rate limit
    const requests = Array.from({ length: 1000 }, () =>
      app.request(`http://localhost/DO/${instanceId}/health`)
    )

    const responses = await Promise.all(requests)
    const rateLimited = responses.find(r => r.status === 429)

    if (rateLimited) {
      expect(rateLimited.headers.get('Retry-After')).toBeDefined()
    }
  })
})

// ============================================================================
// 18. Instance Lifecycle Tests (Future)
// ============================================================================

describe('Instance Lifecycle', () => {
  it.skip('should report hibernated status', async () => {
    const instanceId = generateInstanceId()
    await createInstance('DO', instanceId)

    // Wait for hibernation (in real scenarios)
    // This would require time-based testing

    const response = await app.request(`http://localhost/DO/${instanceId}/meta`)
    const body = await response.json() as InstanceInfo

    expect(['active', 'hibernated']).toContain(body.status)
  })

  it.skip('should wake from hibernation on request', async () => {
    const instanceId = generateInstanceId()

    // Access hibernated instance
    const response = await app.request(`http://localhost/DO/${instanceId}/health`)

    expect(response.status).toBe(200)
  })
})
