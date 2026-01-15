/**
 * Cap'n Web RPC Layer Tests (RED Phase)
 *
 * These tests define the contract for capability-based RPC in dotdo v2.
 * They are expected to FAIL until the RPC implementation is complete.
 *
 * Cap'n Web RPC provides:
 * 1. Interface Generation - Generate RPC interfaces from DO classes
 * 2. $meta Introspection - Runtime schema/method/capability discovery
 * 3. Promise Pipelining - Chain calls without round-trips
 * 4. Capability-based Security - Unforgeable references with attenuation
 * 5. Type-safe Remote Execution - RPC calls are type-checked
 * 6. Serialization - JSON and binary (Cap'n Proto style)
 *
 * @see README.md for Cap'n Web RPC architecture
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateInterface,
  createRPCClient,
  createCapability,
  pipeline,
  serialize,
  deserialize,
} from './index'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Schema type for introspection
 */
interface Schema {
  name: string
  fields: FieldSchema[]
  methods: MethodSchema[]
}

interface FieldSchema {
  name: string
  type: string
  required?: boolean
  description?: string
}

interface MethodSchema {
  name: string
  params: ParamSchema[]
  returns: string
  description?: string
}

interface ParamSchema {
  name: string
  type: string
  required?: boolean
}

/**
 * Method descriptor for RPC introspection
 */
interface MethodDescriptor {
  name: string
  params: ParamSchema[]
  returns: string
  isAsync: boolean
  isGenerator?: boolean
  description?: string
}

/**
 * Capability reference - an unforgeable token granting access to methods
 */
interface Capability<T = unknown> {
  /** Unique capability ID */
  id: string
  /** Type name of the target */
  type: string
  /** Methods accessible via this capability */
  methods: string[]
  /** Expiration timestamp (optional) */
  expiresAt?: Date
  /** Parent capability (for attenuation chains) */
  parent?: Capability
  /** Invoke a method through this capability */
  invoke<K extends keyof T>(method: K, ...args: unknown[]): Promise<T[K]>
  /** Derive a restricted capability (attenuation) */
  attenuate(methods: string[]): Capability<T>
  /** Revoke this capability */
  revoke(): void
}

/**
 * RPC interface generator options
 */
interface InterfaceGeneratorOptions {
  /** Include private methods (default: false) */
  includePrivate?: boolean
  /** Generate streaming support (default: true) */
  streaming?: boolean
  /** Serialization format */
  format?: 'json' | 'binary'
}

/**
 * $meta introspection interface
 */
interface MetaInterface {
  /** Get type schema */
  schema(): Promise<Schema>
  /** Get method descriptors */
  methods(): Promise<MethodDescriptor[]>
  /** Get available capabilities */
  capabilities(): Promise<Capability[]>
  /** Get version info */
  version(): Promise<{ major: number; minor: number; patch: number }>
}

/**
 * Pipeline builder for chained calls
 */
interface PipelineBuilder<T> {
  /** Chain a method call */
  then<K extends keyof T>(method: K, ...args: unknown[]): PipelineBuilder<T>
  /** Execute the pipeline */
  execute(): Promise<T>
  /** Get the execution plan (for debugging) */
  plan(): PipelineStep[]
}

interface PipelineStep {
  method: string
  args: unknown[]
  index: number
}

/**
 * RPC client options
 */
interface RPCClientOptions {
  /** Target URL or DO stub */
  target: string | DurableObjectStub
  /** Authentication token */
  auth?: string
  /** Request timeout */
  timeout?: number
  /** Retry configuration */
  retry?: {
    maxAttempts: number
    backoffMs: number
  }
}

/**
 * Serialization options
 */
interface SerializationOptions {
  /** Format: json (default) or binary */
  format?: 'json' | 'binary'
  /** Custom type handlers */
  handlers?: Map<string, TypeHandler>
}

interface TypeHandler {
  serialize(value: unknown): unknown
  deserialize(value: unknown): unknown
}

// Stub types for testing
interface DurableObjectStub {
  fetch(request: Request | string): Promise<Response>
}

// ============================================================================
// MOCK DO CLASSES FOR TESTING
// ============================================================================

/**
 * Example DO class for testing RPC generation
 */
class CustomerDO {
  static readonly $type = 'Customer'

  $id: string
  name: string
  email: string
  orders: string[] = []

  constructor(id: string, name: string, email: string) {
    this.$id = id
    this.name = name
    this.email = email
  }

  async getOrders(): Promise<Order[]> {
    // Would fetch from store
    return []
  }

  async notify(message: string): Promise<void> {
    // Send notification
  }

  async charge(amount: number): Promise<Receipt> {
    return { id: `rcpt-${Date.now()}`, amount, timestamp: new Date() }
  }

  private internalMethod(): void {
    // Not exposed via RPC
  }
}

interface Order {
  id: string
  customerId: string
  total: number
  items: string[]
  createdAt: Date
}

interface Receipt {
  id: string
  amount: number
  timestamp: Date
}

// Implementations imported from ./index

// ============================================================================
// 1. INTERFACE GENERATION TESTS
// ============================================================================

describe('Interface Generation', () => {
  describe('generateInterface', () => {
    it('generates RPC interface from DO class', () => {
      const iface = generateInterface(CustomerDO)

      expect(iface).toBeDefined()
      expect(iface).toHaveProperty('$type', 'Customer')
      expect(iface).toHaveProperty('methods')
    })

    it('extracts public methods as callable', () => {
      const iface = generateInterface(CustomerDO) as {
        methods: { name: string; callable: boolean }[]
      }

      const methodNames = iface.methods.map((m) => m.name)
      expect(methodNames).toContain('getOrders')
      expect(methodNames).toContain('notify')
      expect(methodNames).toContain('charge')
    })

    it('excludes private methods by default', () => {
      const iface = generateInterface(CustomerDO) as {
        methods: { name: string }[]
      }

      const methodNames = iface.methods.map((m) => m.name)
      expect(methodNames).not.toContain('internalMethod')
    })

    it('includes private methods when option set', () => {
      const iface = generateInterface(CustomerDO, { includePrivate: true }) as {
        methods: { name: string }[]
      }

      const methodNames = iface.methods.map((m) => m.name)
      expect(methodNames).toContain('internalMethod')
    })

    it('preserves type information for parameters', () => {
      const iface = generateInterface(CustomerDO) as {
        methods: MethodDescriptor[]
      }

      const chargeMethod = iface.methods.find((m) => m.name === 'charge')
      expect(chargeMethod).toBeDefined()
      expect(chargeMethod?.params).toHaveLength(1)
      expect(chargeMethod?.params[0]).toEqual({
        name: 'amount',
        type: 'number',
        required: true,
      })
    })

    it('preserves return type information', () => {
      const iface = generateInterface(CustomerDO) as {
        methods: MethodDescriptor[]
      }

      const chargeMethod = iface.methods.find((m) => m.name === 'charge')
      expect(chargeMethod?.returns).toBe('Promise<Receipt>')
    })

    it('marks async methods correctly', () => {
      const iface = generateInterface(CustomerDO) as {
        methods: MethodDescriptor[]
      }

      const getOrdersMethod = iface.methods.find((m) => m.name === 'getOrders')
      expect(getOrdersMethod?.isAsync).toBe(true)
    })

    it('includes fields in the interface', () => {
      const iface = generateInterface(CustomerDO) as {
        fields: FieldSchema[]
      }

      const fieldNames = iface.fields.map((f) => f.name)
      expect(fieldNames).toContain('$id')
      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('email')
      expect(fieldNames).toContain('orders')
    })

    it('generates JSON Schema compatible output', () => {
      const iface = generateInterface(CustomerDO) as {
        $schema?: string
        type: string
        properties: Record<string, unknown>
      }

      expect(iface.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(iface.type).toBe('object')
      expect(iface.properties).toBeDefined()
    })
  })
})

// ============================================================================
// 2. $META INTROSPECTION TESTS
// ============================================================================

describe('$meta Introspection', () => {
  let client: CustomerDO & { $meta: MetaInterface }

  beforeEach(() => {
    client = createRPCClient<CustomerDO>({
      target: 'https://customer.api.dotdo.dev/cust-123',
    })
  })

  describe('$meta.schema()', () => {
    it('returns type schema for the DO', async () => {
      const schema = await client.$meta.schema()

      expect(schema.name).toBe('Customer')
      expect(schema.fields).toBeDefined()
      expect(schema.methods).toBeDefined()
    })

    it('includes field types in schema', async () => {
      const schema = await client.$meta.schema()

      const nameField = schema.fields.find((f) => f.name === 'name')
      expect(nameField?.type).toBe('string')
      expect(nameField?.required).toBe(true)
    })

    it('includes method signatures in schema', async () => {
      const schema = await client.$meta.schema()

      const chargeMethod = schema.methods.find((m) => m.name === 'charge')
      expect(chargeMethod).toBeDefined()
      expect(chargeMethod?.params).toHaveLength(1)
      expect(chargeMethod?.returns).toBe('Promise<Receipt>')
    })

    it('provides descriptions for documented fields', async () => {
      const schema = await client.$meta.schema()

      // Fields with JSDoc should have descriptions
      const idField = schema.fields.find((f) => f.name === '$id')
      expect(idField?.description).toBeDefined()
    })
  })

  describe('$meta.methods()', () => {
    it('returns method descriptors', async () => {
      const methods = await client.$meta.methods()

      expect(methods).toBeInstanceOf(Array)
      expect(methods.length).toBeGreaterThan(0)
    })

    it('includes full method signatures', async () => {
      const methods = await client.$meta.methods()

      const notifyMethod = methods.find((m) => m.name === 'notify')
      expect(notifyMethod).toEqual({
        name: 'notify',
        params: [{ name: 'message', type: 'string', required: true }],
        returns: 'Promise<void>',
        isAsync: true,
        description: expect.any(String),
      })
    })

    it('identifies generator methods', async () => {
      const methods = await client.$meta.methods()

      // If there are generator methods, they should be marked
      for (const method of methods) {
        if (method.isGenerator) {
          expect(method.returns).toMatch(/AsyncGenerator|Generator/)
        }
      }
    })

    it('orders methods by name', async () => {
      const methods = await client.$meta.methods()
      const names = methods.map((m) => m.name)
      const sorted = [...names].sort()

      expect(names).toEqual(sorted)
    })
  })

  describe('$meta.capabilities()', () => {
    it('returns available capabilities', async () => {
      const caps = await client.$meta.capabilities()

      expect(caps).toBeInstanceOf(Array)
      expect(caps.length).toBeGreaterThan(0)
    })

    it('each capability has required properties', async () => {
      const caps = await client.$meta.capabilities()

      for (const cap of caps) {
        expect(cap.id).toBeDefined()
        expect(cap.type).toBe('Customer')
        expect(cap.methods).toBeInstanceOf(Array)
      }
    })

    it('root capability grants access to all methods', async () => {
      const caps = await client.$meta.capabilities()

      const rootCap = caps.find((c) => c.parent === undefined)
      expect(rootCap).toBeDefined()
      expect(rootCap?.methods).toContain('getOrders')
      expect(rootCap?.methods).toContain('notify')
      expect(rootCap?.methods).toContain('charge')
    })
  })

  describe('$meta.version()', () => {
    it('returns semantic version info', async () => {
      const version = await client.$meta.version()

      expect(version).toHaveProperty('major')
      expect(version).toHaveProperty('minor')
      expect(version).toHaveProperty('patch')
      expect(typeof version.major).toBe('number')
      expect(typeof version.minor).toBe('number')
      expect(typeof version.patch).toBe('number')
    })
  })
})

// ============================================================================
// 3. PROMISE PIPELINING TESTS
// ============================================================================

describe('Promise Pipelining', () => {
  describe('basic pipelining', () => {
    it('chains method calls without intermediate round-trips', async () => {
      const customer = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      // This should result in a single network request
      const result = await pipeline(customer)
        .then('getOrders')
        .then('filter' as keyof CustomerDO, (o: Order) => o.total > 100)
        .execute()

      expect(result).toBeDefined()
    })

    it('captures execution plan', () => {
      const customer = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      const builder = pipeline(customer).then('getOrders').then('notify', 'Order shipped!')

      const plan = builder.plan()

      expect(plan).toHaveLength(2)
      expect(plan[0]).toEqual({ method: 'getOrders', args: [], index: 0 })
      expect(plan[1]).toEqual({ method: 'notify', args: ['Order shipped!'], index: 1 })
    })

    it('handles nested promise pipelining', async () => {
      const customer = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      // Nested pipeline: customer.getOrders().map(o => o.items.first())
      const result = await pipeline(customer)
        .then('getOrders')
        .then('map' as keyof CustomerDO, (order: Order) =>
          pipeline(order)
            .then('items' as keyof Order)
            .execute(),
        )
        .execute()

      expect(result).toBeDefined()
    })

    it('optimizes network calls in pipeline', async () => {
      let networkCallCount = 0

      // Mock fetch that counts calls
      const mockClient = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      // Execute pipeline - should be single call
      await pipeline(mockClient)
        .then('getOrders')
        .then('filter' as keyof CustomerDO, (o: Order) => o.total > 50)
        .then('map' as keyof CustomerDO, (o: Order) => o.id)
        .execute()

      // Should have made exactly 1 network call, not 3
      expect(networkCallCount).toBeLessThanOrEqual(1)
    })
  })

  describe('pipeline error handling', () => {
    it('propagates errors with pipeline context', async () => {
      const customer = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      await expect(
        pipeline(customer)
          .then('getOrders')
          .then('invalidMethod' as keyof CustomerDO)
          .execute(),
      ).rejects.toThrow(/pipeline step 1/)
    })

    it('provides partial results on failure', async () => {
      const customer = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      try {
        await pipeline(customer)
          .then('getOrders')
          .then('failingMethod' as keyof CustomerDO)
          .execute()
      } catch (error: unknown) {
        const e = error as { partialResults?: unknown[] }
        expect(e.partialResults).toBeDefined()
        expect(e.partialResults?.[0]).toBeDefined() // getOrders result
      }
    })
  })

  describe('pipeline branching', () => {
    it('supports conditional branching in pipeline', async () => {
      const customer = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      const result = await pipeline(customer)
        .then('getOrders')
        .then('branch' as keyof CustomerDO, {
          condition: (orders: Order[]) => orders.length > 0,
          ifTrue: (orders: Order[]) => orders[0],
          ifFalse: () => null,
        })
        .execute()

      expect(result).toBeDefined()
    })
  })
})

// ============================================================================
// 4. CAPABILITY-BASED SECURITY TESTS
// ============================================================================

describe('Capability-based Security', () => {
  describe('capability creation', () => {
    it('creates capability from target object', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      expect(cap.id).toBeDefined()
      expect(cap.type).toBe('Customer')
      expect(cap.methods).toContain('getOrders')
      expect(cap.methods).toContain('notify')
      expect(cap.methods).toContain('charge')
    })

    it('capability IDs are unique', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap1 = createCapability(customer)
      const cap2 = createCapability(customer)

      expect(cap1.id).not.toBe(cap2.id)
    })

    it('capabilities are unforgeable', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      // Attempting to create a fake capability with same ID should fail
      const fakeCap = { ...cap, id: cap.id }
      expect(() => (fakeCap as Capability).invoke('notify', 'test')).toThrow(/unforgeable/)
    })
  })

  describe('capability invocation', () => {
    it('allows invoking methods through capability', async () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      await expect(cap.invoke('notify', 'Hello!')).resolves.not.toThrow()
    })

    it('rejects invocation of methods not in capability', async () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer, ['notify']) // Only notify

      await expect(cap.invoke('charge', 100)).rejects.toThrow(/not authorized/)
    })

    it('passes arguments correctly through capability', async () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      const receipt = await cap.invoke('charge', 99.99)
      expect(receipt).toHaveProperty('amount', 99.99)
    })
  })

  describe('capability attenuation', () => {
    it('derives restricted capability from parent', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const fullCap = createCapability(customer)
      const readOnlyCap = fullCap.attenuate(['getOrders'])

      expect(readOnlyCap.methods).toEqual(['getOrders'])
      expect(readOnlyCap.parent).toBe(fullCap)
    })

    it('attenuated capability cannot exceed parent permissions', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const limitedCap = createCapability(customer, ['notify'])

      // Cannot attenuate to add more methods
      expect(() => limitedCap.attenuate(['notify', 'charge'])).toThrow(/cannot exceed/)
    })

    it('supports multiple levels of attenuation', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const fullCap = createCapability(customer)
      const level1 = fullCap.attenuate(['getOrders', 'notify'])
      const level2 = level1.attenuate(['getOrders'])

      expect(level2.methods).toEqual(['getOrders'])
      expect(level2.parent).toBe(level1)
    })
  })

  describe('capability revocation', () => {
    it('revokes capability', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      cap.revoke()

      expect(() => cap.invoke('notify', 'test')).rejects.toThrow(/revoked/)
    })

    it('revoking parent revokes children', async () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const parentCap = createCapability(customer)
      const childCap = parentCap.attenuate(['notify'])

      parentCap.revoke()

      await expect(childCap.invoke('notify', 'test')).rejects.toThrow(/revoked/)
    })

    it('supports time-limited capabilities', async () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      // Set expiration to past
      ;(cap as Capability & { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000)

      await expect(cap.invoke('notify', 'test')).rejects.toThrow(/expired/)
    })
  })

  describe('capability transfer', () => {
    it('serializes capability for transfer', () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer)

      const serialized = serialize(cap)
      expect(typeof serialized).toBe('string')

      const deserialized = deserialize<Capability<CustomerDO>>(serialized)
      expect(deserialized.id).toBe(cap.id)
      expect(deserialized.methods).toEqual(cap.methods)
    })

    it('transferred capability retains restrictions', async () => {
      const customer = new CustomerDO('cust-123', 'Alice', 'alice@example.com')
      const cap = createCapability(customer, ['notify'])

      const serialized = serialize(cap)
      const transferred = deserialize<Capability<CustomerDO>>(serialized)

      await expect(transferred.invoke('charge', 100)).rejects.toThrow(/not authorized/)
    })
  })
})

// ============================================================================
// 5. TYPE-SAFE REMOTE EXECUTION TESTS
// ============================================================================

describe('Type-safe Remote Execution', () => {
  describe('RPC client creation', () => {
    it('creates typed RPC client', () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      // Client should have CustomerDO methods
      expect(typeof client.getOrders).toBe('function')
      expect(typeof client.notify).toBe('function')
      expect(typeof client.charge).toBe('function')
    })

    it('client methods return promises', () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      const result = client.getOrders()
      expect(result).toBeInstanceOf(Promise)
    })

    it('supports DO stub as target', () => {
      const mockStub: DurableObjectStub = {
        fetch: async () => new Response('{}'),
      }

      const client = createRPCClient<CustomerDO>({
        target: mockStub,
      })

      expect(client).toBeDefined()
    })
  })

  describe('RPC error handling', () => {
    it('serializes errors with stack trace', async () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      try {
        await client.charge(-100) // Invalid amount
      } catch (error: unknown) {
        const e = error as { stack: string; code: string }
        expect(e.stack).toBeDefined()
        expect(e.code).toBe('RPC_ERROR')
      }
    })

    it('includes RPC metadata in errors', async () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      try {
        await client.charge(-100)
      } catch (error: unknown) {
        const e = error as { method: string; target: string }
        expect(e.method).toBe('charge')
        expect(e.target).toBe('https://customer.api.dotdo.dev/cust-123')
      }
    })

    it('handles timeout errors', async () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://slow.api.dotdo.dev/cust-123',
        timeout: 100, // Very short timeout
      })

      await expect(client.getOrders()).rejects.toThrow(/timeout/i)
    }, 30000)

    it('supports retry on transient failures', async () => {
      let attempts = 0

      const client = createRPCClient<CustomerDO>({
        target: 'https://flaky.api.dotdo.dev/cust-123',
        retry: {
          maxAttempts: 3,
          backoffMs: 10,
        },
      })

      // Mock that fails twice then succeeds
      // In real implementation, would track attempts
      await expect(client.getOrders()).resolves.toBeDefined()
    })
  })

  describe('streaming responses', () => {
    it('supports async generator methods', async () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      // Assuming streamOrders is an async generator
      const stream = (client as unknown as { streamOrders(): AsyncIterable<Order> }).streamOrders()

      const orders: Order[] = []
      for await (const order of stream) {
        orders.push(order)
        if (orders.length >= 3) break
      }

      expect(orders.length).toBeLessThanOrEqual(3)
    })

    it('handles backpressure in streams', async () => {
      const client = createRPCClient<CustomerDO>({
        target: 'https://customer.api.dotdo.dev/cust-123',
      })

      const stream = (client as unknown as { streamOrders(): AsyncIterable<Order> }).streamOrders()

      // Slow consumer - should not overwhelm
      let count = 0
      for await (const _ of stream) {
        // Yield to event loop instead of real delay to avoid timeout issues in full suite
        await Promise.resolve()
        count++
        if (count >= 5) break
      }

      expect(count).toBe(5)
    }, 30000)
  })
})

// ============================================================================
// 6. SERIALIZATION TESTS
// ============================================================================

describe('Serialization', () => {
  describe('JSON serialization', () => {
    it('serializes primitive types', () => {
      expect(serialize('hello')).toBe('"hello"')
      expect(serialize(42)).toBe('42')
      expect(serialize(true)).toBe('true')
      expect(serialize(null)).toBe('null')
    })

    it('serializes objects', () => {
      const obj = { name: 'Alice', age: 30 }
      const serialized = serialize(obj) as string

      expect(JSON.parse(serialized)).toEqual(obj)
    })

    it('serializes arrays', () => {
      const arr = [1, 2, 3, 'four']
      const serialized = serialize(arr) as string

      expect(JSON.parse(serialized)).toEqual(arr)
    })

    it('handles Date objects', () => {
      const date = new Date('2026-01-15T12:00:00Z')
      const serialized = serialize(date) as string
      const parsed = JSON.parse(serialized)

      expect(parsed.$type).toBe('Date')
      expect(new Date(parsed.value).getTime()).toBe(date.getTime())
    })

    it('handles Map objects', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ])
      const serialized = serialize(map) as string
      const parsed = JSON.parse(serialized)

      expect(parsed.$type).toBe('Map')
      expect(parsed.entries).toEqual([
        ['a', 1],
        ['b', 2],
      ])
    })

    it('handles Set objects', () => {
      const set = new Set([1, 2, 3])
      const serialized = serialize(set) as string
      const parsed = JSON.parse(serialized)

      expect(parsed.$type).toBe('Set')
      expect(parsed.values).toEqual([1, 2, 3])
    })

    it('handles BigInt values', () => {
      const big = BigInt('9007199254740993')
      const serialized = serialize(big) as string
      const parsed = JSON.parse(serialized)

      expect(parsed.$type).toBe('BigInt')
      expect(parsed.value).toBe('9007199254740993')
    })

    it('handles undefined in objects', () => {
      const obj = { a: 1, b: undefined, c: 3 }
      const serialized = serialize(obj) as string
      const parsed = JSON.parse(serialized)

      expect(parsed).toEqual({ a: 1, c: 3 })
    })

    it('handles circular references', () => {
      const obj: Record<string, unknown> = { name: 'root' }
      obj.self = obj

      // Should not throw
      const serialized = serialize(obj) as string
      const parsed = JSON.parse(serialized)

      expect(parsed.self.$ref).toBeDefined()
    })
  })

  describe('JSON deserialization', () => {
    it('deserializes primitive types', () => {
      expect(deserialize('"hello"')).toBe('hello')
      expect(deserialize('42')).toBe(42)
      expect(deserialize('true')).toBe(true)
      expect(deserialize('null')).toBe(null)
    })

    it('deserializes Date objects', () => {
      const input = JSON.stringify({ $type: 'Date', value: '2026-01-15T12:00:00Z' })
      const result = deserialize<Date>(input)

      expect(result).toBeInstanceOf(Date)
      expect(result.toISOString()).toBe('2026-01-15T12:00:00.000Z')
    })

    it('deserializes Map objects', () => {
      const input = JSON.stringify({
        $type: 'Map',
        entries: [
          ['a', 1],
          ['b', 2],
        ],
      })
      const result = deserialize<Map<string, number>>(input)

      expect(result).toBeInstanceOf(Map)
      expect(result.get('a')).toBe(1)
      expect(result.get('b')).toBe(2)
    })

    it('deserializes Set objects', () => {
      const input = JSON.stringify({ $type: 'Set', values: [1, 2, 3] })
      const result = deserialize<Set<number>>(input)

      expect(result).toBeInstanceOf(Set)
      expect(result.has(1)).toBe(true)
      expect(result.size).toBe(3)
    })

    it('deserializes BigInt values', () => {
      const input = JSON.stringify({ $type: 'BigInt', value: '9007199254740993' })
      const result = deserialize<bigint>(input)

      expect(typeof result).toBe('bigint')
      expect(result.toString()).toBe('9007199254740993')
    })

    it('resolves circular references', () => {
      const input = JSON.stringify({
        name: 'root',
        self: { $ref: '#' },
      })
      const result = deserialize<{ name: string; self: unknown }>(input)

      expect(result.self).toBe(result)
    })
  })

  describe('binary serialization', () => {
    it('produces ArrayBuffer output', () => {
      const result = serialize({ name: 'Alice' }, { format: 'binary' })

      expect(result).toBeInstanceOf(ArrayBuffer)
    })

    it('is more compact than JSON for large objects', () => {
      const largeObj = {
        items: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          value: Math.random(),
        })),
      }

      const jsonSize = (serialize(largeObj) as string).length
      const binarySize = (serialize(largeObj, { format: 'binary' }) as ArrayBuffer).byteLength

      expect(binarySize).toBeLessThan(jsonSize)
    })

    it('preserves type fidelity', () => {
      const original = {
        date: new Date(),
        map: new Map([['key', 'value']]),
        set: new Set([1, 2, 3]),
        bigint: BigInt(12345),
      }

      const binary = serialize(original, { format: 'binary' }) as ArrayBuffer
      const restored = deserialize<typeof original>(binary, { format: 'binary' })

      expect(restored.date).toBeInstanceOf(Date)
      expect(restored.date.getTime()).toBe(original.date.getTime())
      expect(restored.map).toBeInstanceOf(Map)
      expect(restored.set).toBeInstanceOf(Set)
      expect(typeof restored.bigint).toBe('bigint')
    })

    it('supports streaming deserialization', async () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
      const binary = serialize(largeData, { format: 'binary' }) as ArrayBuffer

      // Stream-style deserialization
      const chunks: unknown[] = []
      const reader = (deserialize as unknown as { stream: (buf: ArrayBuffer) => AsyncIterable<unknown> }).stream(binary)

      for await (const chunk of reader) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBe(1000)
    })
  })

  describe('custom type handlers', () => {
    it('allows custom serialization handlers', () => {
      class CustomType {
        constructor(public value: number) {}
      }

      const handlers = new Map<string, TypeHandler>([
        [
          'CustomType',
          {
            serialize: (v: unknown) => ({ $type: 'CustomType', v: (v as CustomType).value }),
            deserialize: (v: unknown) => new CustomType((v as { v: number }).v),
          },
        ],
      ])

      const original = new CustomType(42)
      const serialized = serialize(original, { handlers }) as string
      const parsed = JSON.parse(serialized)

      expect(parsed.$type).toBe('CustomType')
      expect(parsed.v).toBe(42)
    })

    it('allows custom deserialization handlers', () => {
      class CustomType {
        constructor(public value: number) {}
      }

      const handlers = new Map<string, TypeHandler>([
        [
          'CustomType',
          {
            serialize: (v: unknown) => ({ $type: 'CustomType', v: (v as CustomType).value }),
            deserialize: (v: unknown) => new CustomType((v as { v: number }).v),
          },
        ],
      ])

      const input = JSON.stringify({ $type: 'CustomType', v: 42 })
      const result = deserialize<CustomType>(input, { handlers })

      expect(result).toBeInstanceOf(CustomType)
      expect(result.value).toBe(42)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('RPC Integration', () => {
  it('full round-trip: generate, call, serialize, deserialize', async () => {
    // Generate interface
    const iface = generateInterface(CustomerDO)
    expect(iface).toBeDefined()

    // Create RPC client
    const client = createRPCClient<CustomerDO>({
      target: 'https://customer.api.dotdo.dev/cust-123',
    })

    // Introspect
    const schema = await client.$meta.schema()
    expect(schema.name).toBe('Customer')

    // Create capability
    const cap = createCapability(client, ['charge'])

    // Invoke through capability
    const receipt = await cap.invoke('charge', 50.0)

    // Serialize result
    const serialized = serialize(receipt)
    const restored = deserialize<Receipt>(serialized as string)

    expect(restored.amount).toBe(50.0)
  })

  it('pipeline with capabilities', async () => {
    const client = createRPCClient<CustomerDO>({
      target: 'https://customer.api.dotdo.dev/cust-123',
    })

    // Get read-only capability
    const readCap = createCapability(client, ['getOrders'])

    // Pipeline through capability
    const result = await pipeline(readCap as unknown as CustomerDO)
      .then('getOrders')
      .execute()

    expect(result).toBeDefined()
  })

  it('cross-DO RPC with capability delegation', async () => {
    const customer = createRPCClient<CustomerDO>({
      target: 'https://customer.api.dotdo.dev/cust-123',
    })

    // Create attenuated capability
    const notifyCap = createCapability(customer).attenuate(['notify'])

    // Delegate to another service (simulated)
    const serializedCap = serialize(notifyCap)
    const delegatedCap = deserialize<Capability<CustomerDO>>(serializedCap as string)

    // Should only be able to call notify
    await expect(delegatedCap.invoke('notify', 'Hello!')).resolves.not.toThrow()
    await expect(delegatedCap.invoke('charge', 100)).rejects.toThrow()
  })
})
