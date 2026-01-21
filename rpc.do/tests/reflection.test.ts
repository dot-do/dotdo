// $ Proxy Reflection API Tests - TDD for rpc.do
// Tests reflection capabilities: _types(), _schema(), .md, and Symbol handlers

import { describe, it, expect, vi } from 'vitest'
import type { Transport } from '../src/transport/types'
import type { RPCMessage, RPCResponse } from '../src/types'

// ============================================================================
// Helper: Create a mock transport for testing
// ============================================================================

interface MockTransport extends Transport {
  send: ReturnType<typeof vi.fn>
}

function createMockTransport(
  sendImpl?: (message: RPCMessage) => Promise<RPCResponse>
): MockTransport {
  return {
    send: vi.fn(sendImpl ?? (() => Promise.resolve({ result: {} }))),
  }
}

// Type alias for the dynamic proxy returned by createClient
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicProxy = any

// ============================================================================
// $._types() - TypeScript type definitions
// ============================================================================

describe('$._types() reflection', () => {
  it('$._types() returns Promise<string> (TypeScript .d.ts interface)', async () => {
    const typesDef = `export interface $ {
  things: { create(data: any): Promise<Thing> }
  Customer: (id: string) => CustomerEntity
}`
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_types') {
        return Promise.resolve({ result: typesDef })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $._types()
    expect(typeof result).toBe('string')
    expect(result).toContain('interface')
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: '_types',
      args: [],
    })
  })

  it('$._types() result includes entity definitions', async () => {
    const typesDef = `export interface $ {
  Customer: (id: string) => CustomerEntity
  Order: (id: string) => OrderEntity
}

export interface CustomerEntity {
  getProfile(): Promise<Profile>
  update(data: Partial<Customer>): Promise<Customer>
}

export interface OrderEntity {
  getStatus(): Promise<OrderStatus>
  ship(): Promise<void>
}`
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_types') {
        return Promise.resolve({ result: typesDef })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $._types()
    expect(result).toContain('CustomerEntity')
    expect(result).toContain('OrderEntity')
  })
})

// ============================================================================
// $._schema() - JSON schema object
// ============================================================================

describe('$._schema() reflection', () => {
  it('$._schema() returns Promise<DOSchema> (JSON schema object)', async () => {
    const schema = {
      $version: '1.0.0',
      entities: {
        Customer: {
          methods: ['getProfile', 'update', 'delete'],
          events: ['created', 'updated', 'deleted'],
        },
        Order: {
          methods: ['getStatus', 'ship', 'cancel'],
          events: ['placed', 'shipped', 'delivered'],
        },
      },
      methods: {
        'things.create': { params: ['data'], returns: 'Thing' },
        'things.list': { params: [], returns: 'Thing[]' },
      },
    }
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_schema') {
        return Promise.resolve({ result: schema })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $._schema()
    expect(typeof result).toBe('object')
    expect(result.$version).toBe('1.0.0')
    expect(result.entities).toBeDefined()
    expect(result.entities.Customer).toBeDefined()
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: '_schema',
      args: [],
    })
  })

  it('$._schema() includes method signatures', async () => {
    const schema = {
      methods: {
        'things.create': {
          params: [{ name: 'data', type: 'CreateData' }],
          returns: 'Thing',
          description: 'Create a new thing',
        },
      },
    }
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_schema') {
        return Promise.resolve({ result: schema })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $._schema()
    expect(result.methods['things.create']).toBeDefined()
    expect(result.methods['things.create'].params).toHaveLength(1)
  })
})

// ============================================================================
// $.md - Markdown documentation
// ============================================================================

describe('$.md reflection', () => {
  it('$.md returns Promise<string> (markdown documentation)', async () => {
    const markdown = `# API Documentation

## Entities

### Customer
- \`getProfile()\` - Get customer profile
- \`update(data)\` - Update customer

## Events
- \`Customer.created\` - Fired when customer created
`
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === 'md') {
        return Promise.resolve({ result: markdown })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $.md()
    expect(typeof result).toBe('string')
    expect(result).toContain('# API Documentation')
    expect(result).toContain('## Entities')
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'md',
      args: [],
    })
  })

  it('$.md includes method descriptions', async () => {
    const markdown = `# API Documentation

## Methods

### things.create(data)
Create a new thing with the provided data.

**Parameters:**
- \`data\` (CreateData) - The data for the new thing

**Returns:** Thing
`
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === 'md') {
        return Promise.resolve({ result: markdown })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $.md()
    expect(result).toContain('things.create')
    expect(result).toContain('Parameters')
    expect(result).toContain('Returns')
  })
})

// ============================================================================
// console.log($) - Symbol.for('nodejs.util.inspect.custom')
// ============================================================================

describe('console.log($) inspection', () => {
  it('Symbol.for("nodejs.util.inspect.custom") returns structured output', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    // The proxy should have a custom inspect symbol
    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom')
    const inspectFn = $[inspectSymbol]

    expect(typeof inspectFn).toBe('function')

    // Call the inspect function
    const output = inspectFn()
    expect(typeof output).toBe('string')
    // Should contain useful information about the client
    expect(output).toContain('$')
  })

  it('inspect output shows available namespaces', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom')
    const output = $[inspectSymbol]()

    // Should mention key namespaces
    expect(output).toMatch(/on|every|_types|_schema|md/)
  })

  it('nested proxy inspection shows path', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom')
    const customersInspect = $.customers[inspectSymbol]

    expect(typeof customersInspect).toBe('function')
    const output = customersInspect()
    expect(output).toContain('customers')
  })
})

// ============================================================================
// Object.keys($) - Enumeration of available resources
// ============================================================================

describe('Object.keys($) enumeration', () => {
  it('Object.keys($) returns available top-level resources', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const keys = Object.keys($)

    // Should include built-in namespaces
    expect(keys).toContain('on')
    expect(keys).toContain('every')
    expect(keys).toContain('_types')
    expect(keys).toContain('_schema')
    expect(keys).toContain('md')
  })

  it('Object.keys($) includes action methods', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const keys = Object.keys($)

    // Should include action methods
    expect(keys).toContain('send')
    expect(keys).toContain('try')
    expect(keys).toContain('do')
  })

  it('for...in loop iterates over resources', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const keys: string[] = []
    for (const key in $) {
      keys.push(key)
    }

    expect(keys.length).toBeGreaterThan(0)
    expect(keys).toContain('on')
  })
})

// ============================================================================
// Reflection Caching
// ============================================================================

describe('Reflection caching', () => {
  it('repeated $._schema() calls use cached result', async () => {
    const schema = { $version: '1.0.0', entities: {} }
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_schema') {
        return Promise.resolve({ result: schema })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    // First call
    const result1 = await $._schema()
    // Second call should use cache
    const result2 = await $._schema()

    expect(result1).toEqual(result2)
    // Transport should only be called once due to caching
    expect(mockTransport.send).toHaveBeenCalledTimes(1)
  })

  it('repeated $._types() calls use cached result', async () => {
    const types = 'export interface $ { foo(): void }'
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_types') {
        return Promise.resolve({ result: types })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    // First call
    await $._types()
    // Second call should use cache
    await $._types()

    // Transport should only be called once due to caching
    expect(mockTransport.send).toHaveBeenCalledTimes(1)
  })

  it('$.md() caches markdown documentation', async () => {
    const md = '# Docs'
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === 'md') {
        return Promise.resolve({ result: md })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.md()
    await $.md()

    expect(mockTransport.send).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Reflection edge cases', () => {
  it('$._types() handles server error gracefully', async () => {
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_types') {
        return Promise.resolve({
          error: {
            type: 'NotImplementedError',
            code: 'NOT_IMPLEMENTED',
            message: 'Types endpoint not available',
          },
        })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await expect($._types()).rejects.toThrow('Types endpoint not available')
  })

  it('$._schema() handles server error gracefully', async () => {
    const mockTransport = createMockTransport((msg) => {
      if (msg.method === '_schema') {
        return Promise.resolve({
          error: {
            type: 'InternalError',
            code: 'INTERNAL_ERROR',
            message: 'Schema generation failed',
          },
        })
      }
      return Promise.resolve({ result: {} })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await expect($._schema()).rejects.toThrow('Schema generation failed')
  })

  it('inspect symbol does not trigger RPC call', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom')
    $[inspectSymbol]()

    // Inspect should not trigger any RPC calls
    expect(mockTransport.send).not.toHaveBeenCalled()
  })

  it('Object.keys($) does not trigger RPC calls', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    Object.keys($)

    // Enumeration should not trigger any RPC calls
    expect(mockTransport.send).not.toHaveBeenCalled()
  })
})
