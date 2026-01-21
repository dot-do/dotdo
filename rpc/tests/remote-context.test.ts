/**
 * Remote Context Tests via FetchTransport
 *
 * Tests verifying the $ (WorkflowContext) works correctly when accessed
 * remotely via FetchTransport. These tests run against real miniflare
 * DO instances - NO MOCKS.
 *
 * Test scenarios:
 * 1. createClient with FetchTransport
 * 2. $.things.create() via HTTP
 * 3. $.things.list() via HTTP
 * 4. $.Customer(id).method() entity proxy via HTTP
 * 5. $.send(), $.try(), $.do() via HTTP
 * 6. Error propagation from server to client
 *
 * @module rpc/tests/remote-context
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  createClientWithTransport,
  FetchTransport,
  createServer,
  NotFoundError,
  ValidationError,
  deserializeError,
  RPCError,
  RPCErrorCode,
  CORRELATION_ID_HEADER,
} from '../index'

// Re-export DO classes for vitest-pool-workers
export { ContextDO, EntityDO } from './context-test-dos'

// Type interface for env
interface Env {
  CONTEXT_DO: DurableObjectNamespace
  ENTITY_DO: DurableObjectNamespace
}

// ============================================================================
// Test Interface Types
// ============================================================================

/**
 * Interface for the remote context DO API
 */
interface ContextDOAPI {
  // Things operations
  'things.create': (data: { $type: string; name: string; [key: string]: unknown }) => Promise<{ $id: string; $type: string; [key: string]: unknown }>
  'things.list': (opts?: { $type?: string; limit?: number }) => Promise<Array<{ $id: string; $type: string; [key: string]: unknown }>>
  'things.get': (id: string) => Promise<{ $id: string; $type: string; [key: string]: unknown } | null>
  'things.update': (id: string, data: Record<string, unknown>) => Promise<{ $id: string; $type: string; [key: string]: unknown }>
  'things.delete': (id: string) => Promise<boolean>

  // Durability operations
  sendEvent: (type: string, payload?: unknown) => Promise<{ success: true }>
  tryAction: <T>(action: string) => Promise<T>
  doAction: <T>(action: string, options?: { retries?: number; timeout?: number }) => Promise<T>

  // Context state accessors
  getEventCount: () => Promise<number>
  getScheduleCount: () => Promise<number>
  hasHandler: (eventType: string) => Promise<boolean>

  // Cross-DO operations
  callRemoteDO: (doId: string, method: string, args: unknown[]) => Promise<unknown>
}

/**
 * Interface for entity DO API (used for cross-DO tests)
 */
interface EntityDOAPI {
  greet: (name: string) => Promise<string>
  getBalance: () => Promise<number>
  charge: (amount: number) => Promise<{ success: boolean; balance: number }>
  throwNotFound: (id: string) => Promise<never>
  throwValidation: (field: string) => Promise<never>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a FetchTransport-based client for a DO instance
 */
function createContextClient(stub: DurableObjectStub): ContextDOAPI & { $transport: FetchTransport } {
  // Create a custom fetch that routes to the DO stub
  const stubFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    return stub.fetch(request)
  }

  const transport = new FetchTransport({
    url: 'https://context-do',
    fetch: stubFetch,
    timeout: 10000,
  })

  return createClientWithTransport<ContextDOAPI>({ transport })
}

/**
 * Get a unique DO instance for testing
 */
function getContextDO(name: string): DurableObjectStub {
  const id = (env as Env).CONTEXT_DO.idFromName(name)
  return (env as Env).CONTEXT_DO.get(id)
}

function getEntityDO(name: string): DurableObjectStub {
  const id = (env as Env).ENTITY_DO.idFromName(name)
  return (env as Env).ENTITY_DO.get(id)
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Remote $ Context via FetchTransport', () => {
  describe('1. createClient with FetchTransport', () => {
    it('should create a client with FetchTransport', () => {
      const stub = getContextDO('test-create-client')
      const client = createContextClient(stub)

      expect(client).toBeDefined()
      expect(client.$transport).toBeInstanceOf(FetchTransport)
    })

    it('should have transport in connected state', () => {
      const stub = getContextDO('test-transport-state')
      const client = createContextClient(stub)

      const state = client.$transport.getState()
      expect(state).toBe('CONNECTED')
    })

    it('should allow transport close (no-op for fetch)', async () => {
      const stub = getContextDO('test-transport-close')
      const client = createContextClient(stub)

      // Should not throw
      await client.$transport.close()

      // State should still be connected (fetch is stateless)
      expect(client.$transport.getState()).toBe('CONNECTED')
    })
  })

  describe('2. $.things.create() via HTTP', () => {
    it('should create a thing via FetchTransport', async () => {
      const stub = getContextDO('test-things-create')
      const client = createContextClient(stub)

      const result = await client['things.create']({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(result.$id).toBeDefined()
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
    })

    it('should assign unique IDs to created things', async () => {
      const stub = getContextDO('test-things-unique-ids')
      const client = createContextClient(stub)

      const result1 = await client['things.create']({ $type: 'Product', name: 'Widget' })
      const result2 = await client['things.create']({ $type: 'Product', name: 'Gadget' })

      expect(result1.$id).not.toBe(result2.$id)
    })

    it('should persist created things', async () => {
      const stub = getContextDO('test-things-persist')
      const client = createContextClient(stub)

      const created = await client['things.create']({
        $type: 'Order',
        name: 'Order-001',
        total: 100,
      })

      // Verify it can be retrieved
      const retrieved = await client['things.get'](created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.name).toBe('Order-001')
      expect(retrieved?.total).toBe(100)
    })
  })

  describe('3. $.things.list() via HTTP', () => {
    it('should list things via FetchTransport', async () => {
      const stub = getContextDO('test-things-list')
      const client = createContextClient(stub)

      // Create some things first
      await client['things.create']({ $type: 'Item', name: 'Item 1' })
      await client['things.create']({ $type: 'Item', name: 'Item 2' })
      await client['things.create']({ $type: 'Item', name: 'Item 3' })

      const items = await client['things.list']({ $type: 'Item' })

      expect(items.length).toBeGreaterThanOrEqual(3)
      expect(items.every((item) => item.$type === 'Item')).toBe(true)
    })

    it('should filter by type', async () => {
      const stub = getContextDO('test-things-filter')
      const client = createContextClient(stub)

      await client['things.create']({ $type: 'TypeA', name: 'A1' })
      await client['things.create']({ $type: 'TypeB', name: 'B1' })
      await client['things.create']({ $type: 'TypeA', name: 'A2' })

      const typeAItems = await client['things.list']({ $type: 'TypeA' })
      const typeBItems = await client['things.list']({ $type: 'TypeB' })

      expect(typeAItems.length).toBeGreaterThanOrEqual(2)
      expect(typeBItems.length).toBeGreaterThanOrEqual(1)
      expect(typeAItems.every((item) => item.$type === 'TypeA')).toBe(true)
      expect(typeBItems.every((item) => item.$type === 'TypeB')).toBe(true)
    })

    it('should support limit option', async () => {
      const stub = getContextDO('test-things-limit')
      const client = createContextClient(stub)

      // Create multiple items
      for (let i = 0; i < 5; i++) {
        await client['things.create']({ $type: 'Limited', name: `Item ${i}` })
      }

      const limited = await client['things.list']({ $type: 'Limited', limit: 2 })

      expect(limited.length).toBe(2)
    })
  })

  describe('4. Entity operations via HTTP', () => {
    it('should update a thing via FetchTransport', async () => {
      const stub = getContextDO('test-things-update')
      const client = createContextClient(stub)

      const created = await client['things.create']({
        $type: 'Profile',
        name: 'Original Name',
        status: 'active',
      })

      const updated = await client['things.update'](created.$id, {
        name: 'Updated Name',
      })

      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Updated Name')
      expect(updated.status).toBe('active') // Unchanged field preserved
    })

    it('should delete a thing via FetchTransport', async () => {
      const stub = getContextDO('test-things-delete')
      const client = createContextClient(stub)

      const created = await client['things.create']({
        $type: 'Deletable',
        name: 'To Be Deleted',
      })

      const deleted = await client['things.delete'](created.$id)
      expect(deleted).toBe(true)

      // Verify deletion
      const retrieved = await client['things.get'](created.$id)
      expect(retrieved).toBeNull()
    })

    it('should return null for non-existent things', async () => {
      const stub = getContextDO('test-things-not-found')
      const client = createContextClient(stub)

      const result = await client['things.get']('non-existent-id-12345')
      expect(result).toBeNull()
    })
  })

  describe('5. $.send(), $.try(), $.do() via HTTP', () => {
    it('should send events fire-and-forget via HTTP', async () => {
      const stub = getContextDO('test-send-event')
      const client = createContextClient(stub)

      // Send an event
      await client.sendEvent('user.created', { userId: 'user-123' })

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 100))

      // Check event was recorded
      const eventCount = await client.getEventCount()
      expect(eventCount).toBeGreaterThanOrEqual(1)
    })

    it('should execute try action via HTTP', async () => {
      const stub = getContextDO('test-try-action')
      const client = createContextClient(stub)

      const result = await client.tryAction<string>('success')
      expect(result).toBe('success')
    })

    it('should execute do action with retries via HTTP', async () => {
      const stub = getContextDO('test-do-action')
      const client = createContextClient(stub)

      const result = await client.doAction<string>('durable-success', { retries: 3 })
      expect(result).toBe('durable-success')
    })

    it('should propagate try errors via HTTP', async () => {
      const stub = getContextDO('test-try-error')
      const client = createContextClient(stub)

      await expect(client.tryAction('error:Test error message')).rejects.toThrow()
    })
  })

  describe('6. Error propagation from server to client', () => {
    it('should propagate NotFoundError correctly', async () => {
      const stub = getEntityDO('test-not-found-error')

      // Make direct fetch call to test error propagation
      const response = await stub.fetch('https://entity-do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'throwNotFound', args: ['item-123'] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)

      const error = (await response.json()) as { type: string; code: string; message: string }
      expect(error.type).toBe('NotFoundError')
      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('item-123')
    })

    it('should propagate ValidationError correctly', async () => {
      const stub = getEntityDO('test-validation-error')

      const response = await stub.fetch('https://entity-do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'throwValidation', args: ['email'] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)

      const error = (await response.json()) as { type: string; code: string; details?: { field: string } }
      expect(error.type).toBe('ValidationError')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.details?.field).toBe('email')
    })

    it('should deserialize errors back to Error instances', async () => {
      const stub = getEntityDO('test-error-deserialize')

      const response = await stub.fetch('https://entity-do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'throwNotFound', args: ['test-resource'] }),
      })

      const serialized = (await response.json()) as {
        type: string
        code: string
        message: string
        details: Record<string, unknown>
      }

      const deserialized = deserializeError(serialized)
      expect(deserialized).toBeInstanceOf(NotFoundError)
      expect(deserialized.message).toContain('test-resource')
    })

    it('should include correlation ID in error responses', async () => {
      const stub = getEntityDO('test-error-correlation')
      const correlationId = 'test-correlation-abc123'

      const response = await stub.fetch('https://entity-do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
        },
        body: JSON.stringify({ method: 'throwValidation', args: ['test'] }),
      })

      expect(response.headers.get(CORRELATION_ID_HEADER)).toBe(correlationId)
    })

    it('should return 404 for unknown methods', async () => {
      const stub = getEntityDO('test-unknown-method')

      const response = await stub.fetch('https://entity-do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'nonExistentMethod', args: [] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })
  })

  describe('7. Cross-DO RPC via FetchTransport', () => {
    it('should call methods on another DO via cross-DO RPC', async () => {
      const contextStub = getContextDO('test-cross-do-rpc')
      const client = createContextClient(contextStub)

      // The ContextDO calls EntityDO internally
      const result = await client.callRemoteDO('entity-target-1', 'greet', ['World'])
      expect(result).toBe('Hello, World!')
    })

    it('should propagate errors across DO boundaries', async () => {
      const contextStub = getContextDO('test-cross-do-error')
      const client = createContextClient(contextStub)

      // The ContextDO calls EntityDO which throws an error
      await expect(client.callRemoteDO('entity-target-2', 'throwNotFound', ['missing-item'])).rejects.toThrow()
    })
  })

  describe('8. Concurrent requests via FetchTransport', () => {
    it('should handle concurrent create operations', async () => {
      const stub = getContextDO('test-concurrent-create')
      const client = createContextClient(stub)

      // Fire off multiple creates concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        client['things.create']({ $type: 'Concurrent', name: `Item ${i}` })
      )

      const results = await Promise.all(promises)

      expect(results.length).toBe(5)
      // All IDs should be unique
      const ids = new Set(results.map((r) => r.$id))
      expect(ids.size).toBe(5)
    })

    it('should handle concurrent read/write operations', async () => {
      const stub = getContextDO('test-concurrent-rw')
      const client = createContextClient(stub)

      // Create some initial data
      const created = await client['things.create']({ $type: 'ReadWrite', name: 'Initial' })

      // Concurrent reads and writes
      const promises = [
        client['things.get'](created.$id),
        client['things.update'](created.$id, { count: 1 }),
        client['things.get'](created.$id),
        client['things.list']({ $type: 'ReadWrite' }),
        client['things.update'](created.$id, { count: 2 }),
      ]

      // All should complete without errors
      const results = await Promise.all(promises)
      expect(results.length).toBe(5)
    })
  })

  describe('9. Transport message validation', () => {
    it('should validate RPC messages when validation is enabled', async () => {
      const stub = getContextDO('test-validation-enabled')

      const stubFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init)
        return stub.fetch(request)
      }

      const transport = new FetchTransport({
        url: 'https://context-do',
        fetch: stubFetch,
        timeout: 10000,
        validateMessages: true,
      })

      const client = createClientWithTransport<ContextDOAPI>({ transport })

      // Valid method call should work
      const result = await client.getEventCount()
      expect(typeof result).toBe('number')
    })
  })
})
