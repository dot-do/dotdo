/**
 * Simple Worker Unit Tests
 *
 * Tests for HATEOAS envelope stripping functionality.
 *
 * @module workers/simple.test
 */

import { describe, it, expect } from 'vitest'
import { stripEnvelope } from './simple'

// =============================================================================
// stripEnvelope - Basic Types
// =============================================================================

describe('stripEnvelope - Basic Types', () => {
  it('returns null for null input', () => {
    expect(stripEnvelope(null)).toBeNull()
  })

  it('returns undefined for undefined input', () => {
    expect(stripEnvelope(undefined)).toBeUndefined()
  })

  it('returns primitive string unchanged', () => {
    expect(stripEnvelope('hello')).toBe('hello')
  })

  it('returns primitive number unchanged', () => {
    expect(stripEnvelope(42)).toBe(42)
  })

  it('returns primitive boolean unchanged', () => {
    expect(stripEnvelope(true)).toBe(true)
  })

  it('returns array unchanged (not HATEOAS envelope)', () => {
    const arr = [1, 2, 3]
    expect(stripEnvelope(arr)).toEqual(arr)
  })
})

// =============================================================================
// stripEnvelope - Non-HATEOAS Objects
// =============================================================================

describe('stripEnvelope - Non-HATEOAS Objects', () => {
  it('returns plain object unchanged', () => {
    const obj = { name: 'Test', value: 42 }
    expect(stripEnvelope(obj)).toEqual(obj)
  })

  it('returns object with $type and $id unchanged', () => {
    const obj = { $type: 'User', $id: '123', name: 'Alice' }
    expect(stripEnvelope(obj)).toEqual(obj)
  })

  it('returns object without data property unchanged', () => {
    const obj = { api: { $type: 'User' }, links: {} }
    expect(stripEnvelope(obj)).toEqual(obj)
  })

  it('returns object with only data property unchanged (no api/links)', () => {
    const obj = { data: { name: 'Test' } }
    expect(stripEnvelope(obj)).toEqual(obj)
  })
})

// =============================================================================
// stripEnvelope - HATEOAS Single Resource
// =============================================================================

describe('stripEnvelope - HATEOAS Single Resource', () => {
  it('strips envelope and returns data with injected $type and $id', () => {
    const envelope = {
      api: {
        $context: 'https://api.example.com.ai/tenant',
        $type: 'Startup',
        $id: 'headless.ly',
        name: 'Tenant API',
        version: '1.0.0',
      },
      links: {
        self: '/startups/headless.ly',
      },
      data: {
        name: 'Headless.ly',
        stage: 'seed',
        founded: '2024-01-01',
      },
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual({
      $type: 'Startup',
      $id: 'headless.ly',
      name: 'Headless.ly',
      stage: 'seed',
      founded: '2024-01-01',
    })
  })

  it('preserves existing $type in data', () => {
    const envelope = {
      api: { $type: 'Override' },
      links: {},
      data: {
        $type: 'Original',
        name: 'Test',
      },
    }

    const result = stripEnvelope(envelope) as Record<string, unknown>
    expect(result.$type).toBe('Original')
  })

  it('preserves existing $id in data', () => {
    const envelope = {
      api: { $id: 'override-id' },
      links: {},
      data: {
        $id: 'original-id',
        name: 'Test',
      },
    }

    const result = stripEnvelope(envelope) as Record<string, unknown>
    expect(result.$id).toBe('original-id')
  })

  it('handles envelope with null data', () => {
    const envelope = {
      api: { $type: 'User' },
      links: {},
      data: null,
    }

    expect(stripEnvelope(envelope)).toBeNull()
  })

  it('handles envelope with undefined data', () => {
    const envelope = {
      api: { $type: 'User' },
      links: {},
      data: undefined,
    }

    expect(stripEnvelope(envelope)).toBeUndefined()
  })

  it('handles envelope with primitive data', () => {
    const envelope = {
      api: {},
      links: {},
      data: 'primitive-value',
    }

    expect(stripEnvelope(envelope)).toBe('primitive-value')
  })
})

// =============================================================================
// stripEnvelope - HATEOAS Collection Response
// =============================================================================

describe('stripEnvelope - HATEOAS Collection Response', () => {
  it('strips envelope and injects $type into each item', () => {
    const envelope = {
      api: {
        $context: 'https://api.example.com.ai/tenant',
        $type: 'Startup',
        name: 'Tenant API',
      },
      links: {
        self: '/startups/',
      },
      data: [
        { $id: 'headless.ly', name: 'Headless.ly', stage: 'seed' },
        { $id: 'agents.do', name: 'Agents.do', stage: 'growth' },
      ],
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual([
      { $type: 'Startup', $id: 'headless.ly', name: 'Headless.ly', stage: 'seed' },
      { $type: 'Startup', $id: 'agents.do', name: 'Agents.do', stage: 'growth' },
    ])
  })

  it('preserves existing $type in array items', () => {
    const envelope = {
      api: { $type: 'DefaultType' },
      links: {},
      data: [
        { $type: 'CustomType', name: 'Item1' },
        { name: 'Item2' },
      ],
    }

    const result = stripEnvelope(envelope) as Array<Record<string, unknown>>
    expect(result[0].$type).toBe('CustomType')
    expect(result[1].$type).toBe('DefaultType')
  })

  it('handles empty array data', () => {
    const envelope = {
      api: { $type: 'Startup' },
      links: {},
      data: [],
    }

    expect(stripEnvelope(envelope)).toEqual([])
  })

  it('handles array with primitive items', () => {
    const envelope = {
      api: { $type: 'Value' },
      links: {},
      data: [1, 2, 'three', null],
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual([1, 2, 'three', null])
  })

  it('handles mixed array items (objects and primitives)', () => {
    const envelope = {
      api: { $type: 'Mixed' },
      links: {},
      data: [
        { name: 'Object' },
        42,
        null,
        { other: 'Item' },
      ],
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual([
      { $type: 'Mixed', name: 'Object' },
      42,
      null,
      { $type: 'Mixed', other: 'Item' },
    ])
  })
})

// =============================================================================
// stripEnvelope - Complex HATEOAS Envelopes
// =============================================================================

describe('stripEnvelope - Complex HATEOAS Envelopes', () => {
  it('handles full HATEOAS envelope with all properties', () => {
    const envelope = {
      api: {
        $context: 'https://api.dotdo.dev/tenant',
        $type: 'Customer',
        $id: 'cust-123',
        name: 'Tenant API',
        version: '1.0.0',
      },
      links: {
        self: '/customers/cust-123',
        collection: '/customers/',
      },
      discover: {
        docs: '/docs',
        openapi: '/openapi.json',
      },
      collections: {
        customers: '/customers/',
        orders: '/orders/',
      },
      schema: {
        Customer: '/schema/Customer',
      },
      actions: {
        notify: { method: 'POST', href: '/customers/cust-123/notify' },
      },
      relationships: {
        orders: '/customers/cust-123/orders',
      },
      verbs: ['notify', 'archive'],
      user: { id: 'user-1', name: 'Admin' },
      data: {
        name: 'Acme Corp',
        email: 'contact@acme.com',
        status: 'active',
      },
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual({
      $type: 'Customer',
      $id: 'cust-123',
      name: 'Acme Corp',
      email: 'contact@acme.com',
      status: 'active',
    })
  })

  it('handles envelope with only api and data', () => {
    const envelope = {
      api: { $type: 'Simple' },
      data: { value: 42 },
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual({
      $type: 'Simple',
      value: 42,
    })
  })

  it('handles envelope with only links and data', () => {
    const envelope = {
      links: { self: '/path' },
      data: { name: 'Test' },
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual({ name: 'Test' })
  })

  it('handles nested objects in data', () => {
    const envelope = {
      api: { $type: 'Order', $id: 'order-1' },
      links: {},
      data: {
        total: 100,
        items: [
          { product: 'Widget', qty: 2 },
          { product: 'Gadget', qty: 1 },
        ],
        shipping: {
          address: '123 Main St',
          city: 'Springfield',
        },
      },
    }

    const result = stripEnvelope(envelope) as Record<string, unknown>
    expect(result.$type).toBe('Order')
    expect(result.$id).toBe('order-1')
    expect(result.total).toBe(100)
    expect(result.items).toEqual([
      { product: 'Widget', qty: 2 },
      { product: 'Gadget', qty: 1 },
    ])
    expect(result.shipping).toEqual({
      address: '123 Main St',
      city: 'Springfield',
    })
  })
})

// =============================================================================
// stripEnvelope - Edge Cases
// =============================================================================

describe('stripEnvelope - Edge Cases', () => {
  it('handles empty api object', () => {
    const envelope = {
      api: {},
      links: {},
      data: { name: 'Test' },
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual({ name: 'Test' })
  })

  it('handles api without $type or $id', () => {
    const envelope = {
      api: { name: 'API', version: '1.0' },
      links: {},
      data: { value: 42 },
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual({ value: 42 })
  })

  it('handles data with special characters in keys', () => {
    const envelope = {
      api: { $type: 'Special' },
      links: {},
      data: {
        'key-with-dash': 'value1',
        'key.with.dot': 'value2',
        'key with space': 'value3',
      },
    }

    const result = stripEnvelope(envelope) as Record<string, unknown>
    expect(result['key-with-dash']).toBe('value1')
    expect(result['key.with.dot']).toBe('value2')
    expect(result['key with space']).toBe('value3')
    expect(result.$type).toBe('Special')
  })

  it('handles deeply nested envelope (data containing HATEOAS-like structure)', () => {
    const envelope = {
      api: { $type: 'Container', $id: 'container-1' },
      links: {},
      data: {
        nested: {
          api: { $type: 'Nested' },
          links: {},
          data: { inner: 'value' },
        },
      },
    }

    // The nested structure is NOT stripped - only top-level envelope is processed
    const result = stripEnvelope(envelope) as Record<string, unknown>
    expect(result.$type).toBe('Container')
    expect(result.$id).toBe('container-1')
    expect((result.nested as Record<string, unknown>).api).toBeDefined()
  })

  it('handles array data with null items', () => {
    const envelope = {
      api: { $type: 'Item' },
      links: {},
      data: [
        { name: 'First' },
        null,
        { name: 'Third' },
      ],
    }

    const result = stripEnvelope(envelope)
    expect(result).toEqual([
      { $type: 'Item', name: 'First' },
      null,
      { $type: 'Item', name: 'Third' },
    ])
  })

  it('does not modify original envelope object', () => {
    const envelope = {
      api: { $type: 'Test', $id: 'test-1' },
      links: {},
      data: { name: 'Original' },
    }

    const originalApiType = envelope.api.$type
    const originalDataName = envelope.data.name

    stripEnvelope(envelope)

    expect(envelope.api.$type).toBe(originalApiType)
    expect(envelope.data.name).toBe(originalDataName)
  })
})
