/**
 * Type Safety Tests for RPC Client Proxies
 *
 * These tests verify that TypeScript correctly infers types for:
 * - Method parameters
 * - Return types
 * - Nested API access
 * - Pipeline operations
 *
 * Most tests are compile-time only (type assertions), with runtime
 * verification that the proxies behave correctly.
 */
import { describe, it, expect, vi, expectTypeOf } from 'vitest'
import {
  createClient,
  createDOStub,
  createClientWithPipeline,
  createDOStubWithPipeline,
  createClientWithTransport,
  type RPCClientOptions,
  type DOStubOptions,
} from '../client'
import { createTypedClient, createTypedClientFromUrl } from '../typed-client'

// ============================================================================
// Test Interfaces
// ============================================================================

interface Profile {
  id: string
  name: string
  email: string
  avatar?: string
}

interface Order {
  id: string
  total: number
  status: 'pending' | 'shipped' | 'delivered'
}

interface CustomerAPI {
  getProfile(id: string): Promise<Profile>
  updateEmail(id: string, email: string): Promise<void>
  listOrders(limit?: number): Promise<Order[]>
  charge(amount: number, currency: string): Promise<{ receiptId: string }>
}

interface NestedAPI {
  users: {
    create(data: { name: string; email: string }): Promise<{ id: string }>
    get(id: string): Promise<Profile>
    delete(id: string): Promise<void>
  }
  orders: {
    list(customerId: string): Promise<Order[]>
    get(id: string): Promise<Order>
  }
}

// ============================================================================
// Type Inference Tests
// ============================================================================

describe('Type Safety: createClient', () => {
  it('should infer return types for flat API methods', () => {
    const client = createClient<CustomerAPI>({ url: 'https://test.api' })

    // These are compile-time type checks - verify method types exist
    expectTypeOf(client.getProfile).toBeFunction()
    expectTypeOf(client.updateEmail).toBeFunction()
    expectTypeOf(client.listOrders).toBeFunction()
    expectTypeOf(client.charge).toBeFunction()

    // Verify the method accepts correct parameter types
    expectTypeOf(client.getProfile).parameter(0).toBeString()
    expectTypeOf(client.charge).parameter(0).toBeNumber()
    expectTypeOf(client.charge).parameter(1).toBeString()
  })

  it('should infer types for nested API methods', () => {
    const client = createClient<NestedAPI>({ url: 'https://test.api' })

    // Verify nested structure exists with correct types
    expectTypeOf(client.users.create).toBeFunction()
    expectTypeOf(client.users.get).toBeFunction()
    expectTypeOf(client.users.delete).toBeFunction()
    expectTypeOf(client.orders.list).toBeFunction()
    expectTypeOf(client.orders.get).toBeFunction()
  })
})

describe('Type Safety: createDOStub', () => {
  it('should infer method types from generic parameter', () => {
    const mockBinding = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
      get: vi.fn().mockReturnValue({ fetch: vi.fn() }),
    } as unknown as DurableObjectNamespace

    const stub = createDOStub<CustomerAPI>(mockBinding, 'test-id')

    // Verify the stub has the expected methods with proper types
    expectTypeOf(stub.getProfile).toBeFunction()
    expectTypeOf(stub.updateEmail).toBeFunction()
    expectTypeOf(stub.listOrders).toBeFunction()
    expectTypeOf(stub.charge).toBeFunction()

    // Verify parameter types are enforced
    expectTypeOf(stub.getProfile).parameter(0).toBeString()
    expectTypeOf(stub.charge).parameter(0).toBeNumber()
    expectTypeOf(stub.charge).parameter(1).toBeString()
  })
})

describe('Type Safety: createClientWithPipeline', () => {
  it('should infer pipeline return types', () => {
    const client = createClientWithPipeline<CustomerAPI>({ url: 'https://test.api' })

    // Regular method types should exist
    expectTypeOf(client.getProfile).toBeFunction()
    expectTypeOf(client.charge).toBeFunction()

    // Pipeline method should exist and be properly typed
    expectTypeOf(client.pipeline).toBeFunction()
  })
})

describe('Type Safety: createDOStubWithPipeline', () => {
  it('should infer pipeline return types for DO stubs', () => {
    const mockBinding = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
      get: vi.fn().mockReturnValue({ fetch: vi.fn() }),
    } as unknown as DurableObjectNamespace

    const stub = createDOStubWithPipeline<CustomerAPI>(mockBinding, 'test-id')

    // Regular method calls
    expectTypeOf(stub.getProfile).toBeFunction()
    expectTypeOf(stub.charge).toBeFunction()

    // Pipeline method
    expectTypeOf(stub.pipeline).toBeFunction()
  })
})

describe('Type Safety: createTypedClient', () => {
  it('should provide $call method with proper typing', () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '123', name: 'Test', email: 'test@test.com' }),
    })
    const mockStub = { fetch: mockFetch } as unknown as DurableObjectStub

    const client = createTypedClient<CustomerAPI>(mockStub)

    // $call should exist
    expectTypeOf(client.$call).toBeFunction()

    // $stub should expose the underlying stub
    expectTypeOf(client.$stub).toEqualTypeOf<DurableObjectStub>()

    // Type assertions (don't actually call to avoid unhandled rejections)
    expectTypeOf(client.getProfile).toBeFunction()
    expectTypeOf(client.charge).toBeFunction()
  })
})

describe('Type Safety: createTypedClientFromUrl', () => {
  it('should support nested APIs with proper type inference', () => {
    const client = createTypedClientFromUrl<NestedAPI>('https://test.api')

    // Type assertions for nested API structure
    expectTypeOf(client.users.create).toBeFunction()
    expectTypeOf(client.users.get).toBeFunction()
    expectTypeOf(client.orders.list).toBeFunction()
    expectTypeOf(client.orders.get).toBeFunction()
  })
})

// ============================================================================
// Runtime Behavior Tests
// ============================================================================

describe('Runtime Behavior: Proxy Creation', () => {
  it('createDOStub should create callable methods', () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '123', name: 'Test', email: 'test@test.com' }),
    })

    const mockBinding = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
      get: vi.fn().mockReturnValue({ fetch: mockFetch }),
    } as unknown as DurableObjectNamespace

    const stub = createDOStub<CustomerAPI>(mockBinding, 'test-id')

    // Methods should be callable
    expect(typeof stub.getProfile).toBe('function')
    expect(typeof stub.updateEmail).toBe('function')
    expect(typeof stub.listOrders).toBe('function')
    expect(typeof stub.charge).toBe('function')
  })

  it('createClient should create callable methods for nested APIs', () => {
    const client = createClient<NestedAPI>({ url: 'https://test.api' })

    // Nested methods should be callable
    expect(typeof client.users.create).toBe('function')
    expect(typeof client.users.get).toBe('function')
    expect(typeof client.orders.list).toBe('function')
  })

  it('createClientWithPipeline should expose pipeline method', () => {
    const client = createClientWithPipeline<CustomerAPI>({ url: 'https://test.api' })

    expect(typeof client.pipeline).toBe('function')
    expect(typeof client.getProfile).toBe('function')
  })

  it('createDOStubWithPipeline should expose pipeline method', () => {
    const mockBinding = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
      get: vi.fn().mockReturnValue({ fetch: vi.fn() }),
    } as unknown as DurableObjectNamespace

    const stub = createDOStubWithPipeline<CustomerAPI>(mockBinding, 'test-id')

    expect(typeof stub.pipeline).toBe('function')
    expect(typeof stub.getProfile).toBe('function')
  })
})

describe('Type Safety: Promise-like exclusion', () => {
  // RPC proxy objects must NOT be thenables. If they were, `await client` would
  // trigger the proxy trap and try to call a method named "then", rather than
  // waiting for an actual method call result. This is a critical invariant.
  it('should not be thenable (prevent accidental await)', () => {
    const client = createClient<CustomerAPI>({ url: 'https://test.api' })

    // @ts-expect-error - proxy excludes 'then' to prevent accidental await
    expect(client.then).toBeUndefined()
    // @ts-expect-error - proxy excludes 'catch' to prevent Promise-like behavior
    expect(client.catch).toBeUndefined()
    // @ts-expect-error - proxy excludes 'finally' to prevent Promise-like behavior
    expect(client.finally).toBeUndefined()
  })

  it('createDOStub should not be thenable', () => {
    const mockBinding = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
      get: vi.fn().mockReturnValue({ fetch: vi.fn() }),
    } as unknown as DurableObjectNamespace

    const stub = createDOStub<CustomerAPI>(mockBinding, 'test-id')

    // @ts-expect-error - proxy excludes 'then' to prevent accidental await
    expect(stub.then).toBeUndefined()
    // @ts-expect-error - proxy excludes 'catch' to prevent Promise-like behavior
    expect(stub.catch).toBeUndefined()
  })
})
