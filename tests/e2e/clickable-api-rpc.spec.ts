import { test, expect } from '@playwright/test'

/**
 * E2E Tests for RPC Endpoint with Linked Data
 *
 * TDD RED Phase - These tests verify that RPC responses include JSON-LD style
 * linked data properties ($context, $type, $id) consistent with REST endpoints.
 *
 * All tests are expected to FAIL until the linked data implementation is complete.
 *
 * Test categories:
 * 1. RPC response includes linked data shape
 * 2. Compare RPC response shape to REST response shape
 * 3. RPC list methods return items with $id URLs
 * 4. Cap'n Web RPC JSON-RPC format validation
 *
 * Issue: dotdo-4w44b - Create RED E2E tests for RPC endpoint with linked data
 */

// =============================================================================
// Types
// =============================================================================

interface JSONRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id: string | number
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JSONRPCError
  id: string | number | null
}

interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

interface CapnwebRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: CapnwebCall[]
}

interface CapnwebCall {
  promiseId: string
  target: { type: 'root' } | { type: 'promise'; promiseId: string }
  method: string
  args: Array<{ type: 'value'; value: unknown } | { type: 'promise'; promiseId: string }>
}

interface CapnwebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: CapnwebResult[]
  error?: { code: string; message: string }
}

interface CapnwebResult {
  promiseId: string
  type: 'value' | 'promise' | 'error'
  value?: unknown
  error?: { code: string; message: string }
}

/**
 * Linked data response shape
 */
interface LinkedDataResponse {
  $context: string
  $type: string
  $id: string
  [key: string]: unknown
}

/**
 * Collection response shape with linked data
 */
interface LinkedDataCollection {
  $context: string
  $type: string
  $id: string
  items?: Array<LinkedDataResponse>
  count?: number
}

// =============================================================================
// 1. RPC Response Includes Linked Data Shape
// =============================================================================

test.describe('RPC Response Includes Linked Data Shape', () => {
  test('POST /rpc with method call - response has $context property', async ({ request }) => {
    // RED: RPC responses don't include $context yet
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataResponse

    expect(result.$context).toBeDefined()
    expect(typeof result.$context).toBe('string')
  })

  test('POST /rpc with method call - response has $type property', async ({ request }) => {
    // RED: RPC responses don't include $type yet
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataResponse

    expect(result.$type).toBeDefined()
    expect(typeof result.$type).toBe('string')
    // $type should be a URL pointing to the type
    expect(result.$type).toMatch(/^https?:\/\//)
  })

  test('POST /rpc with method call - response has $id property', async ({ request }) => {
    // RED: RPC responses don't include $id yet
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 3,
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataResponse

    expect(result.$id).toBeDefined()
    expect(typeof result.$id).toBe('string')
    // $id should be a clickable URL to the resource
    expect(result.$id).toMatch(/^https?:\/\//)
    expect(result.$id).toContain('/customers/')
    expect(result.$id).toContain('alice')
  })

  test('POST /rpc with method call - response has all linked data properties', async ({ request }) => {
    // RED: RPC responses don't include complete linked data shape yet
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 4,
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataResponse

    // All three linked data properties should be present
    expect(result.$context).toBeDefined()
    expect(result.$type).toBeDefined()
    expect(result.$id).toBeDefined()

    // All should be valid URLs
    expect(result.$context).toMatch(/^https?:\/\//)
    expect(result.$type).toMatch(/^https?:\/\//)
    expect(result.$id).toMatch(/^https?:\/\//)
  })
})

// =============================================================================
// 2. Compare RPC Response Shape to REST Response Shape
// =============================================================================

test.describe('RPC Response Shape Matches REST Response Shape', () => {
  test('RPC Customer response $context matches REST /customers/:id $context', async ({ request }) => {
    // RED: RPC and REST responses have different $context values

    // Make RPC call
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'cmp-1',
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    // Make REST call
    const restResponse = await request.get('/api/customers/alice')

    if (rpcResponse.ok() && restResponse.ok()) {
      const rpcJson = (await rpcResponse.json()) as JSONRPCResponse
      const rpcResult = rpcJson.result as LinkedDataResponse
      const restResult = (await restResponse.json()) as LinkedDataResponse

      expect(rpcResult.$context).toBe(restResult.$context)
    } else {
      // If endpoints don't exist yet, test should fail with meaningful message
      expect(rpcResponse.ok()).toBe(true)
      expect(restResponse.ok()).toBe(true)
    }
  })

  test('RPC Customer response $type matches REST /customers/:id $type', async ({ request }) => {
    // RED: RPC and REST responses have different $type values

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'cmp-2',
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    const restResponse = await request.get('/api/customers/alice')

    if (rpcResponse.ok() && restResponse.ok()) {
      const rpcJson = (await rpcResponse.json()) as JSONRPCResponse
      const rpcResult = rpcJson.result as LinkedDataResponse
      const restResult = (await restResponse.json()) as LinkedDataResponse

      expect(rpcResult.$type).toBe(restResult.$type)
    } else {
      expect(rpcResponse.ok()).toBe(true)
      expect(restResponse.ok()).toBe(true)
    }
  })

  test('RPC Customer response $id matches REST /customers/:id $id', async ({ request }) => {
    // RED: RPC and REST responses have different $id values

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'cmp-3',
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    const restResponse = await request.get('/api/customers/alice')

    if (rpcResponse.ok() && restResponse.ok()) {
      const rpcJson = (await rpcResponse.json()) as JSONRPCResponse
      const rpcResult = rpcJson.result as LinkedDataResponse
      const restResult = (await restResponse.json()) as LinkedDataResponse

      expect(rpcResult.$id).toBe(restResult.$id)
    } else {
      expect(rpcResponse.ok()).toBe(true)
      expect(restResponse.ok()).toBe(true)
    }
  })

  test('RPC and REST return identical linked data shape for same resource', async ({ request }) => {
    // RED: Full shape comparison between RPC and REST

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'cmp-4',
        method: 'Customer',
        params: ['bob'],
      } satisfies JSONRPCRequest,
    })

    const restResponse = await request.get('/api/customers/bob')

    if (rpcResponse.ok() && restResponse.ok()) {
      const rpcJson = (await rpcResponse.json()) as JSONRPCResponse
      const rpcResult = rpcJson.result as LinkedDataResponse
      const restResult = (await restResponse.json()) as LinkedDataResponse

      // Compare all three linked data properties
      expect(rpcResult.$context).toBe(restResult.$context)
      expect(rpcResult.$type).toBe(restResult.$type)
      expect(rpcResult.$id).toBe(restResult.$id)
    } else {
      expect(rpcResponse.ok()).toBe(true)
      expect(restResponse.ok()).toBe(true)
    }
  })
})

// =============================================================================
// 3. RPC List Methods Return Items with $id URLs
// =============================================================================

test.describe('RPC List Methods Return Items with $id URLs', () => {
  test('RPC Customers.list returns collection with $context, $type, $id', async ({ request }) => {
    // RED: RPC list responses don't include collection-level linked data

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'list-1',
        method: 'Customers.list',
        params: [],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataCollection

    // Collection should have linked data properties
    expect(result.$context).toBeDefined()
    expect(result.$type).toBeDefined()
    expect(result.$id).toBeDefined()

    // $id should point to the collection URL
    expect(result.$id).toMatch(/\/customers$/)
  })

  test('RPC list returns items array with linked data', async ({ request }) => {
    // RED: RPC list item responses don't include linked data yet

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'list-2',
        method: 'Customers.list',
        params: [],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataCollection

    // Items array should exist
    expect(result.items).toBeDefined()
    expect(Array.isArray(result.items)).toBe(true)
  })

  test('RPC list items each have clickable $id URLs', async ({ request }) => {
    // RED: RPC list items don't have $id URLs yet

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'list-3',
        method: 'Customers.list',
        params: [],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataCollection

    expect(result.items).toBeDefined()
    expect(result.items!.length).toBeGreaterThan(0)

    // Each item should have a clickable $id URL
    for (const item of result.items!) {
      expect(item.$id).toBeDefined()
      expect(item.$id).toMatch(/^https?:\/\//)
      expect(item.$id).toContain('/customers/')
    }
  })

  test('RPC list item $id URLs are unique and resource-specific', async ({ request }) => {
    // RED: Each item should have its own unique $id

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'list-4',
        method: 'Customers.list',
        params: [],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataCollection

    expect(result.items).toBeDefined()
    expect(result.items!.length).toBeGreaterThan(1)

    // Collect all $id values
    const ids = result.items!.map((item) => item.$id)
    const uniqueIds = new Set(ids)

    // All IDs should be unique
    expect(uniqueIds.size).toBe(ids.length)

    // Each ID should include the item's identifier
    for (const item of result.items!) {
      expect(item.$id).toContain('/customers/')
    }
  })

  test('RPC list response count matches items array length', async ({ request }) => {
    // RED: RPC list responses should include count property

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'list-5',
        method: 'Customers.list',
        params: [],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse
    const result = json.result as LinkedDataCollection

    expect(result.count).toBeDefined()
    expect(typeof result.count).toBe('number')
    expect(result.items).toBeDefined()
    expect(result.count).toBe(result.items!.length)
  })
})

// =============================================================================
// 4. Cap'n Web RPC JSON-RPC Format
// =============================================================================

test.describe("Cap'n Web RPC JSON-RPC Format", () => {
  test('Capnweb call format returns linked data in result', async ({ request }) => {
    // RED: Capnweb responses don't include linked data yet

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        id: 'cap-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer',
            args: [{ type: 'value', value: 'alice' }],
          },
        ],
      } satisfies CapnwebRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as CapnwebResponse

    expect(json.results).toBeDefined()
    expect(json.results!.length).toBe(1)

    const result = json.results![0].value as LinkedDataResponse

    expect(result.$context).toBeDefined()
    expect(result.$type).toBeDefined()
    expect(result.$id).toBeDefined()
  })

  test('Capnweb batch call returns linked data for all results', async ({ request }) => {
    // RED: Batch call results don't include linked data yet

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        id: 'cap-batch-1',
        type: 'batch',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer',
            args: [{ type: 'value', value: 'alice' }],
          },
          {
            promiseId: 'p2',
            target: { type: 'root' },
            method: 'Customer',
            args: [{ type: 'value', value: 'bob' }],
          },
        ],
      } satisfies CapnwebRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as CapnwebResponse

    expect(json.results).toBeDefined()
    expect(json.results!.length).toBe(2)

    // Each result should have linked data
    for (const result of json.results!) {
      const value = result.value as LinkedDataResponse
      expect(value.$context).toBeDefined()
      expect(value.$type).toBeDefined()
      expect(value.$id).toBeDefined()
    }
  })

  test('Capnweb promise pipeline results include linked data', async ({ request }) => {
    // RED: Promise pipelining results don't include linked data

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        id: 'cap-pipe-1',
        type: 'batch',
        calls: [
          // First call: get customer
          {
            promiseId: 'customer',
            target: { type: 'root' },
            method: 'Customer',
            args: [{ type: 'value', value: 'alice' }],
          },
          // Second call: get orders for that customer (promise pipelining)
          {
            promiseId: 'orders',
            target: { type: 'promise', promiseId: 'customer' },
            method: 'Orders',
            args: [],
          },
        ],
      } satisfies CapnwebRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as CapnwebResponse

    expect(json.results).toBeDefined()
    expect(json.results!.length).toBe(2)

    // Customer result should have linked data
    const customerResult = json.results!.find((r) => r.promiseId === 'customer')
    expect(customerResult).toBeDefined()
    const customerValue = customerResult!.value as LinkedDataResponse
    expect(customerValue.$context).toBeDefined()
    expect(customerValue.$type).toBeDefined()
    expect(customerValue.$id).toBeDefined()

    // Orders result should also have linked data (as collection)
    const ordersResult = json.results!.find((r) => r.promiseId === 'orders')
    expect(ordersResult).toBeDefined()
    const ordersValue = ordersResult!.value as LinkedDataCollection
    expect(ordersValue.$context).toBeDefined()
    expect(ordersValue.$type).toBeDefined()
    expect(ordersValue.$id).toBeDefined()
  })

  test('JSON-RPC 2.0 format returns proper structure with linked data', async ({ request }) => {
    // RED: JSON-RPC 2.0 format should return proper structure

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'jsonrpc-1',
        method: 'Customer',
        params: ['alice'],
      } satisfies JSONRPCRequest,
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse

    // Verify JSON-RPC 2.0 structure
    expect(json.jsonrpc).toBe('2.0')
    expect(json.id).toBe('jsonrpc-1')
    expect(json.error).toBeUndefined()
    expect(json.result).toBeDefined()

    // Result should have linked data
    const result = json.result as LinkedDataResponse
    expect(result.$context).toBeDefined()
    expect(result.$type).toBeDefined()
    expect(result.$id).toBeDefined()
  })

  test('JSON-RPC 2.0 batch request returns linked data for all results', async ({ request }) => {
    // RED: JSON-RPC batch responses don't include linked data

    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: [
        {
          jsonrpc: '2.0',
          id: 'batch-1',
          method: 'Customer',
          params: ['alice'],
        },
        {
          jsonrpc: '2.0',
          id: 'batch-2',
          method: 'Customer',
          params: ['bob'],
        },
      ] as JSONRPCRequest[],
    })

    expect(rpcResponse.ok()).toBe(true)
    const json = (await rpcResponse.json()) as JSONRPCResponse[]

    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(2)

    // Each response should have linked data
    for (const response of json) {
      expect(response.jsonrpc).toBe('2.0')
      expect(response.result).toBeDefined()

      const result = response.result as LinkedDataResponse
      expect(result.$context).toBeDefined()
      expect(result.$type).toBeDefined()
      expect(result.$id).toBeDefined()
    }
  })
})

// =============================================================================
// 5. Edge Cases and Error Handling
// =============================================================================

test.describe('RPC Linked Data - Edge Cases', () => {
  test('RPC method not found still returns proper JSON-RPC error', async ({ request }) => {
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'err-1',
        method: 'NonExistentMethod',
        params: [],
      } satisfies JSONRPCRequest,
    })

    const json = (await rpcResponse.json()) as JSONRPCResponse

    expect(json.jsonrpc).toBe('2.0')
    expect(json.id).toBe('err-1')
    expect(json.error).toBeDefined()
    expect(json.error!.code).toBe(-32601) // Method not found
  })

  test('RPC resource not found returns error without linked data', async ({ request }) => {
    // Resource doesn't exist, so no linked data should be returned
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'err-2',
        method: 'Customer',
        params: ['nonexistent-customer-xyz'],
      } satisfies JSONRPCRequest,
    })

    const json = (await rpcResponse.json()) as JSONRPCResponse

    expect(json.jsonrpc).toBe('2.0')
    expect(json.id).toBe('err-2')
    // Should either have error or null result for not found
    if (json.error) {
      expect(json.error.code).toBeDefined()
    } else {
      expect(json.result).toBeNull()
    }
  })

  test('RPC empty list returns collection with linked data and empty items', async ({ request }) => {
    // Empty collection should still have proper linked data shape
    const rpcResponse = await request.post('/rpc', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'empty-1',
        method: 'EmptyCollection.list',
        params: [],
      } satisfies JSONRPCRequest,
    })

    // If method exists, check the response
    if (rpcResponse.ok()) {
      const json = (await rpcResponse.json()) as JSONRPCResponse

      if (json.result) {
        const result = json.result as LinkedDataCollection

        // Even empty collections should have linked data
        expect(result.$context).toBeDefined()
        expect(result.$type).toBeDefined()
        expect(result.$id).toBeDefined()
        expect(result.items).toBeDefined()
        expect(result.items!.length).toBe(0)
        expect(result.count).toBe(0)
      }
    }
  })
})
