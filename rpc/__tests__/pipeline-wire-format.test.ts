/**
 * Pipeline Wire Format Tests (RED Phase)
 *
 * These tests define the contract for serializing and deserializing
 * Cap'n Web pipeline operations into a wire format suitable for RPC transport.
 *
 * Wire Format Specification:
 * ```typescript
 * interface SerializedPipeline {
 *   target: [noun: string, id: string]
 *   pipeline: PipelineStep[]
 * }
 *
 * type PipelineStep =
 *   | { type: 'property', name: string }
 *   | { type: 'method', name: string, args: unknown[] }
 * ```
 *
 * All tests are expected to FAIL until pipeline-serialization.ts is implemented.
 *
 * @see do-wvv: RED: Pipeline wire format tests
 */

import { describe, it, expect } from 'vitest'
import {
  serializePipeline,
  deserializePipeline,
  SerializedPipeline,
  PipelineStep,
} from '../pipeline-serialization'

// ============================================================================
// TYPE DEFINITIONS FOR TESTS
// ============================================================================

/**
 * Mock stub chain for testing - simulates the proxy pattern
 * used by Cap'n Web pipelining
 */
interface MockStubChain {
  $noun: string
  $id: string
  $steps: PipelineStep[]
}

/**
 * Mock RpcPromise interface for testing promise substitution
 */
interface MockRpcPromise<T = unknown> {
  $isRpcPromise: true
  $placeholder: string
  then<R>(fn: (value: T) => R): MockRpcPromise<R>
}

// Helper to create mock stub chains for testing
function createMockStub(noun: string, id: string): MockStubChain {
  return {
    $noun: noun,
    $id: id,
    $steps: [],
  }
}

// Helper to add a property step
function addPropertyStep(stub: MockStubChain, name: string): MockStubChain {
  return {
    ...stub,
    $steps: [...stub.$steps, { type: 'property' as const, name }],
  }
}

// Helper to add a method step
function addMethodStep(stub: MockStubChain, name: string, args: unknown[]): MockStubChain {
  return {
    ...stub,
    $steps: [...stub.$steps, { type: 'method' as const, name, args }],
  }
}

// Helper to create mock RpcPromise
function createMockRpcPromise<T>(placeholder: string): MockRpcPromise<T> {
  return {
    $isRpcPromise: true,
    $placeholder: placeholder,
    then: () => createMockRpcPromise(placeholder),
  }
}

// ============================================================================
// 1. SERIALIZATION TESTS
// ============================================================================

describe('Pipeline Serialization', () => {
  describe('serializePipeline - basic serialization', () => {
    it('serializes a simple property access chain', () => {
      // Simulates: Customer('cust_123').profile.email
      const stub = addPropertyStep(
        addPropertyStep(createMockStub('Customer', 'cust_123'), 'profile'),
        'email',
      )

      const result = serializePipeline(stub)

      expect(result).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'email' },
        ],
      })
    })

    it('serializes a method call with no arguments', () => {
      // Simulates: Customer('cust_123').getOrders()
      const stub = addMethodStep(createMockStub('Customer', 'cust_123'), 'getOrders', [])

      const result = serializePipeline(stub)

      expect(result).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [{ type: 'method', name: 'getOrders', args: [] }],
      })
    })

    it('serializes a method call with primitive arguments', () => {
      // Simulates: Customer('cust_123').charge(99.99)
      const stub = addMethodStep(createMockStub('Customer', 'cust_123'), 'charge', [99.99])

      const result = serializePipeline(stub)

      expect(result).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [{ type: 'method', name: 'charge', args: [99.99] }],
      })
    })

    it('serializes a method call with multiple arguments', () => {
      // Simulates: Order('ord_456').update('shipped', true, 42)
      const stub = addMethodStep(createMockStub('Order', 'ord_456'), 'update', [
        'shipped',
        true,
        42,
      ])

      const result = serializePipeline(stub)

      expect(result).toEqual({
        target: ['Order', 'ord_456'],
        pipeline: [{ type: 'method', name: 'update', args: ['shipped', true, 42] }],
      })
    })

    it('serializes mixed property and method chain', () => {
      // Simulates: Customer('cust_123').profile.update({ status: 'active' }).email
      let stub = createMockStub('Customer', 'cust_123')
      stub = addPropertyStep(stub, 'profile')
      stub = addMethodStep(stub, 'update', [{ status: 'active' }])
      stub = addPropertyStep(stub, 'email')

      const result = serializePipeline(stub)

      expect(result).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'method', name: 'update', args: [{ status: 'active' }] },
          { type: 'property', name: 'email' },
        ],
      })
    })

    it('serializes empty pipeline (just target)', () => {
      // Simulates: Customer('cust_123') - bare stub with no operations
      const stub = createMockStub('Customer', 'cust_123')

      const result = serializePipeline(stub)

      expect(result).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [],
      })
    })

    it('preserves order of pipeline steps', () => {
      // Simulates: Thing('id').a.b().c.d()
      let stub = createMockStub('Thing', 'id')
      stub = addPropertyStep(stub, 'a')
      stub = addMethodStep(stub, 'b', [])
      stub = addPropertyStep(stub, 'c')
      stub = addMethodStep(stub, 'd', [])

      const result = serializePipeline(stub)

      expect(result.pipeline).toHaveLength(4)
      expect(result.pipeline[0]).toEqual({ type: 'property', name: 'a' })
      expect(result.pipeline[1]).toEqual({ type: 'method', name: 'b', args: [] })
      expect(result.pipeline[2]).toEqual({ type: 'property', name: 'c' })
      expect(result.pipeline[3]).toEqual({ type: 'method', name: 'd', args: [] })
    })
  })

  describe('serializePipeline - nested objects in args', () => {
    it('serializes deeply nested object arguments', () => {
      const nestedArg = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      }

      const stub = addMethodStep(createMockStub('Config', 'cfg_1'), 'set', [nestedArg])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'set',
        args: [nestedArg],
      })
    })

    it('serializes array arguments', () => {
      const arrayArg = [1, 2, 3, 'four', { five: 5 }]

      const stub = addMethodStep(createMockStub('List', 'list_1'), 'addAll', [arrayArg])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'addAll',
        args: [arrayArg],
      })
    })

    it('serializes mixed primitive and object arguments', () => {
      const stub = addMethodStep(createMockStub('User', 'user_1'), 'configure', [
        'mode',
        42,
        { options: { deep: true } },
        [1, 2, 3],
      ])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'configure',
        args: ['mode', 42, { options: { deep: true } }, [1, 2, 3]],
      })
    })

    it('handles null and undefined in nested objects', () => {
      const argWithNulls = {
        present: 'value',
        nullField: null,
        nested: {
          alsoNull: null,
        },
      }

      const stub = addMethodStep(createMockStub('Store', 'store_1'), 'save', [argWithNulls])

      const result = serializePipeline(stub)

      // undefined should be stripped, null preserved
      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'save',
        args: [
          {
            present: 'value',
            nullField: null,
            nested: { alsoNull: null },
          },
        ],
      })
    })
  })

  describe('serializePipeline - Date object handling', () => {
    it('serializes Date objects with $type marker', () => {
      const testDate = new Date('2026-01-15T12:00:00.000Z')
      const stub = addMethodStep(createMockStub('Event', 'evt_1'), 'schedule', [testDate])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'schedule',
        args: [
          {
            $type: 'Date',
            value: '2026-01-15T12:00:00.000Z',
          },
        ],
      })
    })

    it('serializes Date in nested objects', () => {
      const objWithDate = {
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
        metadata: {
          updatedAt: new Date('2026-01-15T11:00:00.000Z'),
        },
      }

      const stub = addMethodStep(createMockStub('Record', 'rec_1'), 'create', [objWithDate])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'create',
        args: [
          {
            createdAt: { $type: 'Date', value: '2026-01-15T10:00:00.000Z' },
            metadata: {
              updatedAt: { $type: 'Date', value: '2026-01-15T11:00:00.000Z' },
            },
          },
        ],
      })
    })

    it('serializes Date in arrays', () => {
      const dates = [
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-06-01T00:00:00.000Z'),
        new Date('2026-12-01T00:00:00.000Z'),
      ]

      const stub = addMethodStep(createMockStub('Calendar', 'cal_1'), 'setHolidays', [dates])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'setHolidays',
        args: [
          [
            { $type: 'Date', value: '2026-01-01T00:00:00.000Z' },
            { $type: 'Date', value: '2026-06-01T00:00:00.000Z' },
            { $type: 'Date', value: '2026-12-01T00:00:00.000Z' },
          ],
        ],
      })
    })
  })

  describe('serializePipeline - RpcPromise handling', () => {
    it('substitutes RpcPromise with placeholder marker', () => {
      const promise = createMockRpcPromise('$0')
      const stub = addMethodStep(createMockStub('Order', 'ord_1'), 'linkTo', [promise])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'linkTo',
        args: [
          {
            $type: 'RpcPromise',
            $placeholder: '$0',
          },
        ],
      })
    })

    it('handles multiple RpcPromise args', () => {
      const promise1 = createMockRpcPromise('$0')
      const promise2 = createMockRpcPromise('$1')

      const stub = addMethodStep(createMockStub('Join', 'join_1'), 'merge', [
        promise1,
        'separator',
        promise2,
      ])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'merge',
        args: [
          { $type: 'RpcPromise', $placeholder: '$0' },
          'separator',
          { $type: 'RpcPromise', $placeholder: '$1' },
        ],
      })
    })

    it('handles RpcPromise in nested objects', () => {
      const promise = createMockRpcPromise('$user')
      const argWithPromise = {
        assignee: promise,
        metadata: { createdBy: promise },
      }

      const stub = addMethodStep(createMockStub('Task', 'task_1'), 'assign', [argWithPromise])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'assign',
        args: [
          {
            assignee: { $type: 'RpcPromise', $placeholder: '$user' },
            metadata: {
              createdBy: { $type: 'RpcPromise', $placeholder: '$user' },
            },
          },
        ],
      })
    })
  })

  describe('serializePipeline - circular reference handling', () => {
    it('handles self-referencing objects with $ref marker', () => {
      const circular: Record<string, unknown> = { name: 'root' }
      circular.self = circular

      const stub = addMethodStep(createMockStub('Graph', 'graph_1'), 'addNode', [circular])

      const result = serializePipeline(stub)

      // The circular reference should be replaced with a $ref
      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'addNode',
        args: [
          {
            name: 'root',
            self: { $ref: '#' },
          },
        ],
      })
    })

    it('handles mutually referencing objects', () => {
      const nodeA: Record<string, unknown> = { name: 'A' }
      const nodeB: Record<string, unknown> = { name: 'B' }
      nodeA.next = nodeB
      nodeB.prev = nodeA

      const stub = addMethodStep(createMockStub('LinkedList', 'll_1'), 'setHead', [nodeA])

      const result = serializePipeline(stub)

      // Should use JSON pointer-style refs
      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'setHead',
        args: [
          {
            name: 'A',
            next: {
              name: 'B',
              prev: { $ref: '#' },
            },
          },
        ],
      })
    })

    it('handles deeply nested circular references', () => {
      const root: Record<string, unknown> = {
        level1: {
          level2: {
            level3: {},
          },
        },
      }
      ;(root.level1 as Record<string, unknown>).level2 as Record<string, unknown>
      ;((root.level1 as Record<string, unknown>).level2 as Record<string, unknown>).level3 as Record<
        string,
        unknown
      >
      ;(
        ((root.level1 as Record<string, unknown>).level2 as Record<string, unknown>)
          .level3 as Record<string, unknown>
      ).backToRoot = root

      const stub = addMethodStep(createMockStub('Tree', 'tree_1'), 'setRoot', [root])

      const result = serializePipeline(stub)

      // Deep circular ref should point back to root
      const args = result.pipeline[0] as { type: 'method'; name: string; args: unknown[] }
      const argObj = args.args[0] as Record<string, unknown>
      const level3 = ((argObj.level1 as Record<string, unknown>).level2 as Record<string, unknown>)
        .level3 as Record<string, unknown>

      expect(level3.backToRoot).toEqual({ $ref: '#' })
    })

    it('handles arrays with circular references', () => {
      const arr: unknown[] = [1, 2, 3]
      arr.push(arr) // Array contains itself

      const stub = addMethodStep(createMockStub('Container', 'cont_1'), 'setItems', [arr])

      const result = serializePipeline(stub)

      expect(result.pipeline[0]).toEqual({
        type: 'method',
        name: 'setItems',
        args: [[1, 2, 3, { $ref: '#/args/0' }]],
      })
    })
  })
})

// ============================================================================
// 2. DESERIALIZATION TESTS
// ============================================================================

describe('Pipeline Deserialization', () => {
  describe('deserializePipeline - basic deserialization', () => {
    it('deserializes property access chain', () => {
      const serialized: SerializedPipeline = {
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'email' },
        ],
      }

      const result = deserializePipeline(serialized)

      expect(result.target.noun).toBe('Customer')
      expect(result.target.id).toBe('cust_123')
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0]).toEqual({ type: 'property', name: 'profile' })
      expect(result.steps[1]).toEqual({ type: 'property', name: 'email' })
    })

    it('deserializes method call with arguments', () => {
      const serialized: SerializedPipeline = {
        target: ['Order', 'ord_456'],
        pipeline: [{ type: 'method', name: 'charge', args: [99.99] }],
      }

      const result = deserializePipeline(serialized)

      expect(result.steps[0]).toEqual({ type: 'method', name: 'charge', args: [99.99] })
    })

    it('deserializes empty pipeline', () => {
      const serialized: SerializedPipeline = {
        target: ['User', 'user_1'],
        pipeline: [],
      }

      const result = deserializePipeline(serialized)

      expect(result.target.noun).toBe('User')
      expect(result.target.id).toBe('user_1')
      expect(result.steps).toHaveLength(0)
    })

    it('deserializes mixed property and method chain', () => {
      const serialized: SerializedPipeline = {
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'method', name: 'update', args: [{ status: 'active' }] },
          { type: 'property', name: 'email' },
        ],
      }

      const result = deserializePipeline(serialized)

      expect(result.steps).toHaveLength(3)
      expect(result.steps[1]).toEqual({
        type: 'method',
        name: 'update',
        args: [{ status: 'active' }],
      })
    })
  })

  describe('deserializePipeline - Date revival', () => {
    it('revives Date objects from $type marker', () => {
      const serialized: SerializedPipeline = {
        target: ['Event', 'evt_1'],
        pipeline: [
          {
            type: 'method',
            name: 'schedule',
            args: [{ $type: 'Date', value: '2026-01-15T12:00:00.000Z' }],
          },
        ],
      }

      const result = deserializePipeline(serialized)

      const methodStep = result.steps[0] as { type: 'method'; name: string; args: unknown[] }
      expect(methodStep.args[0]).toBeInstanceOf(Date)
      expect((methodStep.args[0] as Date).toISOString()).toBe('2026-01-15T12:00:00.000Z')
    })

    it('revives nested Date objects', () => {
      const serialized: SerializedPipeline = {
        target: ['Record', 'rec_1'],
        pipeline: [
          {
            type: 'method',
            name: 'create',
            args: [
              {
                createdAt: { $type: 'Date', value: '2026-01-15T10:00:00.000Z' },
                metadata: {
                  updatedAt: { $type: 'Date', value: '2026-01-15T11:00:00.000Z' },
                },
              },
            ],
          },
        ],
      }

      const result = deserializePipeline(serialized)

      const methodStep = result.steps[0] as { type: 'method'; name: string; args: unknown[] }
      const arg = methodStep.args[0] as Record<string, unknown>

      expect(arg.createdAt).toBeInstanceOf(Date)
      expect((arg.metadata as Record<string, unknown>).updatedAt).toBeInstanceOf(Date)
    })

    it('revives Date objects in arrays', () => {
      const serialized: SerializedPipeline = {
        target: ['Calendar', 'cal_1'],
        pipeline: [
          {
            type: 'method',
            name: 'setHolidays',
            args: [
              [
                { $type: 'Date', value: '2026-01-01T00:00:00.000Z' },
                { $type: 'Date', value: '2026-06-01T00:00:00.000Z' },
              ],
            ],
          },
        ],
      }

      const result = deserializePipeline(serialized)

      const methodStep = result.steps[0] as { type: 'method'; name: string; args: unknown[] }
      const dates = methodStep.args[0] as unknown[]

      expect(dates[0]).toBeInstanceOf(Date)
      expect(dates[1]).toBeInstanceOf(Date)
    })
  })

  describe('deserializePipeline - circular reference resolution', () => {
    it('resolves self-referencing $ref markers', () => {
      const serialized: SerializedPipeline = {
        target: ['Graph', 'graph_1'],
        pipeline: [
          {
            type: 'method',
            name: 'addNode',
            args: [
              {
                name: 'root',
                self: { $ref: '#' },
              },
            ],
          },
        ],
      }

      const result = deserializePipeline(serialized)

      const methodStep = result.steps[0] as { type: 'method'; name: string; args: unknown[] }
      const node = methodStep.args[0] as Record<string, unknown>

      // self should point back to the same object
      expect(node.self).toBe(node)
    })

    it('resolves nested $ref markers', () => {
      const serialized: SerializedPipeline = {
        target: ['LinkedList', 'll_1'],
        pipeline: [
          {
            type: 'method',
            name: 'setHead',
            args: [
              {
                name: 'A',
                next: {
                  name: 'B',
                  prev: { $ref: '#' },
                },
              },
            ],
          },
        ],
      }

      const result = deserializePipeline(serialized)

      const methodStep = result.steps[0] as { type: 'method'; name: string; args: unknown[] }
      const nodeA = methodStep.args[0] as Record<string, unknown>
      const nodeB = nodeA.next as Record<string, unknown>

      expect(nodeB.prev).toBe(nodeA)
    })

    it('resolves array circular references', () => {
      const serialized: SerializedPipeline = {
        target: ['Container', 'cont_1'],
        pipeline: [
          {
            type: 'method',
            name: 'setItems',
            args: [[1, 2, 3, { $ref: '#/args/0' }]],
          },
        ],
      }

      const result = deserializePipeline(serialized)

      const methodStep = result.steps[0] as { type: 'method'; name: string; args: unknown[] }
      const arr = methodStep.args[0] as unknown[]

      // Last element should be the array itself
      expect(arr[3]).toBe(arr)
    })
  })

  describe('deserializePipeline - produces executable form', () => {
    it('returns structure suitable for pipeline execution', () => {
      const serialized: SerializedPipeline = {
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'method', name: 'update', args: [{ status: 'vip' }] },
        ],
      }

      const result = deserializePipeline(serialized)

      // Should have execute method or be directly usable
      expect(result).toHaveProperty('target')
      expect(result).toHaveProperty('steps')
      expect(typeof result.target.noun).toBe('string')
      expect(typeof result.target.id).toBe('string')
      expect(Array.isArray(result.steps)).toBe(true)
    })

    it('steps maintain type discriminator', () => {
      const serialized: SerializedPipeline = {
        target: ['Thing', 'id'],
        pipeline: [
          { type: 'property', name: 'prop' },
          { type: 'method', name: 'method', args: [] },
        ],
      }

      const result = deserializePipeline(serialized)

      expect(result.steps[0].type).toBe('property')
      expect(result.steps[1].type).toBe('method')
    })
  })
})

// ============================================================================
// 3. ROUND-TRIP TESTS
// ============================================================================

describe('Pipeline Round-Trip', () => {
  describe('serialize then deserialize equivalence', () => {
    it('round-trips simple property chain', () => {
      const original = addPropertyStep(
        addPropertyStep(createMockStub('Customer', 'cust_123'), 'profile'),
        'email',
      )

      const serialized = serializePipeline(original)
      const deserialized = deserializePipeline(serialized)

      expect(deserialized.target.noun).toBe('Customer')
      expect(deserialized.target.id).toBe('cust_123')
      expect(deserialized.steps).toHaveLength(2)
      expect(deserialized.steps[0]).toEqual({ type: 'property', name: 'profile' })
      expect(deserialized.steps[1]).toEqual({ type: 'property', name: 'email' })
    })

    it('round-trips method calls with primitive args', () => {
      const original = addMethodStep(createMockStub('Payment', 'pay_1'), 'charge', [
        99.99,
        'USD',
        true,
      ])

      const serialized = serializePipeline(original)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; name: string; args: unknown[] }
      expect(step.type).toBe('method')
      expect(step.name).toBe('charge')
      expect(step.args).toEqual([99.99, 'USD', true])
    })

    it('round-trips nested objects in args', () => {
      const complexArg = {
        user: {
          name: 'Alice',
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
        tags: ['important', 'urgent'],
      }

      const original = addMethodStep(createMockStub('Config', 'cfg_1'), 'apply', [complexArg])

      const serialized = serializePipeline(original)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; name: string; args: unknown[] }
      expect(step.args[0]).toEqual(complexArg)
    })

    it('round-trips Date objects', () => {
      const testDate = new Date('2026-01-15T12:00:00.000Z')
      const original = addMethodStep(createMockStub('Event', 'evt_1'), 'setTime', [testDate])

      const serialized = serializePipeline(original)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; name: string; args: unknown[] }
      expect(step.args[0]).toBeInstanceOf(Date)
      expect((step.args[0] as Date).getTime()).toBe(testDate.getTime())
    })

    it('round-trips circular references', () => {
      const circular: Record<string, unknown> = { name: 'node', value: 42 }
      circular.self = circular

      const original = addMethodStep(createMockStub('Graph', 'g_1'), 'add', [circular])

      const serialized = serializePipeline(original)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; name: string; args: unknown[] }
      const node = step.args[0] as Record<string, unknown>

      expect(node.name).toBe('node')
      expect(node.value).toBe(42)
      expect(node.self).toBe(node)
    })

    it('round-trips mixed pipeline with all special cases', () => {
      const circular: Record<string, unknown> = { id: 'circ' }
      circular.ref = circular

      let original = createMockStub('Complex', 'complex_1')
      original = addPropertyStep(original, 'config')
      original = addMethodStep(original, 'setDate', [new Date('2026-06-15T00:00:00.000Z')])
      original = addMethodStep(original, 'setCircular', [circular])
      original = addPropertyStep(original, 'result')

      const serialized = serializePipeline(original)
      const deserialized = deserializePipeline(serialized)

      expect(deserialized.steps).toHaveLength(4)

      // Check Date was preserved
      const dateStep = deserialized.steps[1] as { type: 'method'; args: unknown[] }
      expect(dateStep.args[0]).toBeInstanceOf(Date)

      // Check circular ref was preserved
      const circStep = deserialized.steps[2] as { type: 'method'; args: unknown[] }
      const circObj = circStep.args[0] as Record<string, unknown>
      expect(circObj.ref).toBe(circObj)
    })
  })

  describe('idempotency', () => {
    it('double serialization produces same result', () => {
      const stub = addMethodStep(
        addPropertyStep(createMockStub('Test', 'test_1'), 'prop'),
        'method',
        [{ nested: true }],
      )

      const first = serializePipeline(stub)
      const second = serializePipeline(stub)

      expect(first).toEqual(second)
    })

    it('double deserialization produces equivalent result', () => {
      const serialized: SerializedPipeline = {
        target: ['Test', 'test_1'],
        pipeline: [
          { type: 'property', name: 'prop' },
          { type: 'method', name: 'method', args: [42] },
        ],
      }

      const first = deserializePipeline(serialized)
      const second = deserializePipeline(serialized)

      expect(first.target).toEqual(second.target)
      expect(first.steps).toEqual(second.steps)
    })
  })
})

// ============================================================================
// 4. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Pipeline Wire Format Edge Cases', () => {
  describe('special values', () => {
    it('handles null arguments', () => {
      const stub = addMethodStep(createMockStub('Store', 's_1'), 'set', [null])

      const serialized = serializePipeline(stub)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; args: unknown[] }
      expect(step.args[0]).toBe(null)
    })

    it('handles undefined by omitting from serialization', () => {
      const argWithUndefined = { a: 1, b: undefined, c: 3 }
      const stub = addMethodStep(createMockStub('Store', 's_1'), 'set', [argWithUndefined])

      const serialized = serializePipeline(stub)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; args: unknown[] }
      const arg = step.args[0] as Record<string, unknown>

      expect(arg).toEqual({ a: 1, c: 3 })
      expect('b' in arg).toBe(false)
    })

    it('handles empty string arguments', () => {
      const stub = addMethodStep(createMockStub('Text', 't_1'), 'set', [''])

      const serialized = serializePipeline(stub)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; args: unknown[] }
      expect(step.args[0]).toBe('')
    })

    it('handles zero and negative numbers', () => {
      const stub = addMethodStep(createMockStub('Math', 'm_1'), 'calc', [0, -1, -0.5])

      const serialized = serializePipeline(stub)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; args: unknown[] }
      expect(step.args).toEqual([0, -1, -0.5])
    })

    it('handles very large numbers', () => {
      const stub = addMethodStep(createMockStub('Big', 'b_1'), 'set', [Number.MAX_SAFE_INTEGER])

      const serialized = serializePipeline(stub)
      const deserialized = deserializePipeline(serialized)

      const step = deserialized.steps[0] as { type: 'method'; args: unknown[] }
      expect(step.args[0]).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('handles NaN and Infinity', () => {
      const stub = addMethodStep(createMockStub('Special', 'sp_1'), 'set', [
        NaN,
        Infinity,
        -Infinity,
      ])

      const serialized = serializePipeline(stub)

      // NaN and Infinity should be serialized with $type markers
      expect(serialized.pipeline[0]).toEqual({
        type: 'method',
        name: 'set',
        args: [
          { $type: 'NaN' },
          { $type: 'Infinity' },
          { $type: '-Infinity' },
        ],
      })
    })
  })

  describe('special property names', () => {
    it('handles property names with special characters', () => {
      let stub = createMockStub('Special', 's_1')
      stub = addPropertyStep(stub, 'some-prop')
      stub = addPropertyStep(stub, '$internal')
      stub = addPropertyStep(stub, '__proto__')

      const serialized = serializePipeline(stub)

      expect(serialized.pipeline).toEqual([
        { type: 'property', name: 'some-prop' },
        { type: 'property', name: '$internal' },
        { type: 'property', name: '__proto__' },
      ])
    })

    it('handles empty property name', () => {
      const stub = addPropertyStep(createMockStub('Test', 't_1'), '')

      const serialized = serializePipeline(stub)

      expect(serialized.pipeline[0]).toEqual({ type: 'property', name: '' })
    })
  })

  describe('argument edge cases', () => {
    it('handles function arguments by throwing', () => {
      const stub = addMethodStep(createMockStub('Callback', 'cb_1'), 'on', [() => {}])

      expect(() => serializePipeline(stub)).toThrow(/cannot serialize function/)
    })

    it('handles Symbol arguments by throwing', () => {
      const stub = addMethodStep(createMockStub('Sym', 'sym_1'), 'set', [Symbol('test')])

      expect(() => serializePipeline(stub)).toThrow(/cannot serialize symbol/)
    })

    it('handles BigInt arguments', () => {
      const stub = addMethodStep(createMockStub('Big', 'big_1'), 'set', [BigInt('12345678901234567890')])

      const serialized = serializePipeline(stub)

      expect(serialized.pipeline[0]).toEqual({
        type: 'method',
        name: 'set',
        args: [{ $type: 'BigInt', value: '12345678901234567890' }],
      })
    })

    it('handles RegExp arguments', () => {
      const stub = addMethodStep(createMockStub('Pattern', 'p_1'), 'match', [/test-\d+/gi])

      const serialized = serializePipeline(stub)

      expect(serialized.pipeline[0]).toEqual({
        type: 'method',
        name: 'match',
        args: [{ $type: 'RegExp', source: 'test-\\d+', flags: 'gi' }],
      })
    })
  })

  describe('target edge cases', () => {
    it('handles empty target id', () => {
      const stub = createMockStub('Singleton', '')

      const serialized = serializePipeline(stub)

      expect(serialized.target).toEqual(['Singleton', ''])
    })

    it('handles target id with special characters', () => {
      const stub = createMockStub('Resource', 'path/to/resource?query=1&other=2')

      const serialized = serializePipeline(stub)

      expect(serialized.target).toEqual(['Resource', 'path/to/resource?query=1&other=2'])
    })
  })
})

// ============================================================================
// 5. TYPE SAFETY TESTS
// ============================================================================

describe('Pipeline Type Safety', () => {
  it('SerializedPipeline has correct structure', () => {
    const pipeline: SerializedPipeline = {
      target: ['Noun', 'id'],
      pipeline: [
        { type: 'property', name: 'prop' },
        { type: 'method', name: 'method', args: [1, 2, 3] },
      ],
    }

    // Type checks - these compile if types are correct
    const [noun, id] = pipeline.target
    expect(typeof noun).toBe('string')
    expect(typeof id).toBe('string')

    for (const step of pipeline.pipeline) {
      expect(['property', 'method']).toContain(step.type)
      expect(typeof step.name).toBe('string')

      if (step.type === 'method') {
        expect(Array.isArray(step.args)).toBe(true)
      }
    }
  })

  it('PipelineStep discriminated union works correctly', () => {
    const propStep: PipelineStep = { type: 'property', name: 'test' }
    const methodStep: PipelineStep = { type: 'method', name: 'test', args: [] }

    // Type narrowing should work
    if (propStep.type === 'property') {
      expect(propStep.name).toBeDefined()
      // @ts-expect-error - property steps don't have args
      expect(propStep.args).toBeUndefined()
    }

    if (methodStep.type === 'method') {
      expect(methodStep.name).toBeDefined()
      expect(methodStep.args).toBeDefined()
    }
  })
})
