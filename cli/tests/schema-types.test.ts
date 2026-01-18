/**
 * Schema Types Tests
 *
 * Tests for type generation from DO $meta.schema() introspection.
 * These tests verify that schema information flows correctly from
 * DO introspection through to CLI type definitions.
 *
 * Test coverage:
 * - Type generation from $meta.schema()
 * - Field type mapping (DO types -> TypeScript types)
 * - Method signature extraction
 *
 * @see /rpc/proxy.ts - $meta interface definition
 * @see /rpc/interface.ts - generateInterface()
 * @see /cli/src/types/generator.ts - TypeScript generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Schema, FieldSchema, MethodSchema, ParamSchema } from '../src/rpc-client.js'

// ============================================================================
// Test Schemas - Representative DO schemas for testing
// ============================================================================

/**
 * Customer DO schema - represents a typical business entity
 */
const CustomerSchema: Schema = {
  name: 'CustomerDO',
  fields: [
    { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
    { name: '$type', type: 'string', required: true, description: 'Entity type' },
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'balance', type: 'number', required: true },
    { name: 'tags', type: 'string[]', required: false },
    { name: 'metadata', type: 'object', required: false },
    { name: 'createdAt', type: 'Date', required: true },
    { name: 'updatedAt', type: 'Date', required: false },
  ],
  methods: [
    {
      name: 'getOrders',
      params: [],
      returns: 'Promise<Order[]>',
      description: 'Get all orders for this customer',
    },
    {
      name: 'charge',
      params: [
        { name: 'amount', type: 'number', required: true },
        { name: 'description', type: 'string', required: false },
      ],
      returns: 'Promise<Receipt>',
      description: 'Charge the customer',
    },
    {
      name: 'addTag',
      params: [
        { name: 'tag', type: 'string', required: true },
      ],
      returns: 'Promise<void>',
    },
    {
      name: 'notify',
      params: [
        { name: 'message', type: 'string', required: true },
        { name: 'options', type: 'NotifyOptions', required: false },
      ],
      returns: 'Promise<NotificationResult>',
    },
  ],
}

/**
 * Counter DO schema - represents a stateful primitive
 */
const CounterSchema: Schema = {
  name: 'CounterDO',
  fields: [
    { name: '$id', type: 'string', required: true },
    { name: 'value', type: 'number', required: true },
    { name: 'min', type: 'number', required: false },
    { name: 'max', type: 'number', required: false },
  ],
  methods: [
    { name: 'get', params: [], returns: 'Promise<number>' },
    { name: 'set', params: [{ name: 'value', type: 'number', required: true }], returns: 'Promise<void>' },
    { name: 'increment', params: [{ name: 'by', type: 'number', required: false }], returns: 'Promise<number>' },
    { name: 'decrement', params: [{ name: 'by', type: 'number', required: false }], returns: 'Promise<number>' },
    { name: 'reset', params: [], returns: 'Promise<void>' },
  ],
}

/**
 * Complex DO schema with nested types and generics
 */
const ComplexSchema: Schema = {
  name: 'ComplexDO',
  fields: [
    { name: 'data', type: 'Map<string, unknown>', required: true },
    { name: 'history', type: 'Array<HistoryEntry>', required: true },
    { name: 'config', type: 'Record<string, ConfigValue>', required: false },
  ],
  methods: [
    {
      name: 'query',
      params: [
        { name: 'filter', type: 'QueryFilter', required: true },
        { name: 'options', type: 'QueryOptions', required: false },
      ],
      returns: 'Promise<QueryResult<unknown>>',
    },
    {
      name: 'batch',
      params: [
        { name: 'operations', type: 'BatchOperation[]', required: true },
      ],
      returns: 'Promise<BatchResult[]>',
    },
    {
      name: 'stream',
      params: [
        { name: 'options', type: 'StreamOptions', required: false },
      ],
      returns: 'AsyncIterator<StreamEvent>',
    },
  ],
}

// ============================================================================
// Schema Type Generation Tests
// ============================================================================

describe('Schema Type Generation from $meta.schema()', () => {
  /**
   * These tests verify that the SchemaTypeGenerator can convert
   * DO schemas (as returned by $meta.schema()) into TypeScript definitions.
   */

  describe('SchemaTypeGenerator', () => {
    it('should generate interface declaration from schema', () => {
      // Import the generator module - this will fail until implemented
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaTypeGenerator } = require('../src/types/schema-generator.js')

      const generator = new SchemaTypeGenerator()
      const result = generator.generateFromSchema(CustomerSchema)

      // Should produce valid TypeScript interface
      expect(result.typescript).toContain('interface CustomerDO')
      expect(result.typescript).toContain('$id: string')
      expect(result.typescript).toContain('charge(amount: number, description?: string): Promise<Receipt>')
    })

    it('should preserve required vs optional fields', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaTypeGenerator } = require('../src/types/schema-generator.js')

      const generator = new SchemaTypeGenerator()
      const result = generator.generateFromSchema(CustomerSchema)

      // Required fields should not have ?
      expect(result.typescript).toContain('$id: string;')
      expect(result.typescript).toContain('name: string;')

      // Optional fields should have ?
      expect(result.typescript).toContain('tags?: string[];')
      expect(result.typescript).toContain('metadata?: Record<string, unknown>;')
    })

    it('should generate JSDoc from field descriptions', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaTypeGenerator } = require('../src/types/schema-generator.js')

      const generator = new SchemaTypeGenerator({ includeJSDoc: true })
      const result = generator.generateFromSchema(CustomerSchema)

      expect(result.typescript).toContain('/** Unique identifier */')
      expect(result.typescript).toContain('* @param amount')
    })

    it('should extract related types from method signatures', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaTypeGenerator } = require('../src/types/schema-generator.js')

      const generator = new SchemaTypeGenerator()
      const result = generator.generateFromSchema(CustomerSchema)

      // Should declare referenced types
      expect(result.relatedTypes).toContain('Order')
      expect(result.relatedTypes).toContain('Receipt')
      expect(result.relatedTypes).toContain('NotifyOptions')
      expect(result.relatedTypes).toContain('NotificationResult')
    })

    it('should handle multiple schemas', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaTypeGenerator } = require('../src/types/schema-generator.js')

      const generator = new SchemaTypeGenerator()
      const result = generator.generateFromSchemas([CustomerSchema, CounterSchema])

      expect(result.typescript).toContain('interface CustomerDO')
      expect(result.typescript).toContain('interface CounterDO')
    })
  })
})

// ============================================================================
// Field Type Mapping Tests
// ============================================================================

describe('Field Type Mapping', () => {
  /**
   * These tests verify correct mapping from DO schema types
   * to TypeScript types for all supported type variants.
   */

  describe('mapFieldType', () => {
    it('should map primitive types correctly', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('string')).toBe('string')
      expect(mapFieldType('number')).toBe('number')
      expect(mapFieldType('boolean')).toBe('boolean')
      expect(mapFieldType('null')).toBe('null')
      expect(mapFieldType('undefined')).toBe('undefined')
    })

    it('should map Date type', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('Date')).toBe('Date')
    })

    it('should map array types', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('string[]')).toBe('string[]')
      expect(mapFieldType('number[]')).toBe('number[]')
      expect(mapFieldType('Order[]')).toBe('Order[]')
      expect(mapFieldType('Array<string>')).toBe('string[]')
    })

    it('should map object type to Record', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('object')).toBe('Record<string, unknown>')
    })

    it('should map Map types', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('Map<string, number>')).toBe('Map<string, number>')
      expect(mapFieldType('Map<string, unknown>')).toBe('Map<string, unknown>')
    })

    it('should map Record types', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('Record<string, ConfigValue>')).toBe('Record<string, ConfigValue>')
    })

    it('should preserve Promise wrapper', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('Promise<void>')).toBe('Promise<void>')
      expect(mapFieldType('Promise<number>')).toBe('Promise<number>')
      expect(mapFieldType('Promise<Order[]>')).toBe('Promise<Order[]>')
    })

    it('should handle nested generics', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('Promise<QueryResult<unknown>>')).toBe('Promise<QueryResult<unknown>>')
      expect(mapFieldType('Array<Map<string, number>>')).toBe('Map<string, number>[]')
    })

    it('should handle AsyncIterator', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('AsyncIterator<StreamEvent>')).toBe('AsyncIterator<StreamEvent>')
    })

    it('should map any to unknown in strict mode', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapFieldType } = require('../src/types/schema-generator.js')

      expect(mapFieldType('any', { strict: true })).toBe('unknown')
      expect(mapFieldType('any', { strict: false })).toBe('any')
    })
  })
})

// ============================================================================
// Method Signature Extraction Tests
// ============================================================================

describe('Method Signature Extraction', () => {
  /**
   * These tests verify that method signatures are correctly extracted
   * and formatted from DO schema method definitions.
   */

  describe('extractMethodSignature', () => {
    it('should extract method with no parameters', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'getValue',
        params: [],
        returns: 'Promise<number>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('getValue(): Promise<number>')
    })

    it('should extract method with required parameters', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'charge',
        params: [
          { name: 'amount', type: 'number', required: true },
        ],
        returns: 'Promise<Receipt>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('charge(amount: number): Promise<Receipt>')
    })

    it('should extract method with optional parameters', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'increment',
        params: [
          { name: 'by', type: 'number', required: false },
        ],
        returns: 'Promise<number>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('increment(by?: number): Promise<number>')
    })

    it('should extract method with mixed required/optional parameters', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'notify',
        params: [
          { name: 'message', type: 'string', required: true },
          { name: 'options', type: 'NotifyOptions', required: false },
        ],
        returns: 'Promise<NotificationResult>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('notify(message: string, options?: NotifyOptions): Promise<NotificationResult>')
    })

    it('should extract method with array parameters', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'batch',
        params: [
          { name: 'operations', type: 'BatchOperation[]', required: true },
        ],
        returns: 'Promise<BatchResult[]>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('batch(operations: BatchOperation[]): Promise<BatchResult[]>')
    })

    it('should extract method returning void', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'reset',
        params: [],
        returns: 'Promise<void>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('reset(): Promise<void>')
    })

    it('should extract streaming method', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractMethodSignature } = require('../src/types/schema-generator.js')

      const method: MethodSchema = {
        name: 'stream',
        params: [
          { name: 'options', type: 'StreamOptions', required: false },
        ],
        returns: 'AsyncIterator<StreamEvent>',
      }

      const sig = extractMethodSignature(method)
      expect(sig).toBe('stream(options?: StreamOptions): AsyncIterator<StreamEvent>')
    })
  })

  describe('extractAllMethodSignatures', () => {
    it('should extract all methods from schema', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractAllMethodSignatures } = require('../src/types/schema-generator.js')

      const signatures = extractAllMethodSignatures(CounterSchema)

      expect(signatures).toHaveLength(5)
      expect(signatures).toContain('get(): Promise<number>')
      expect(signatures).toContain('set(value: number): Promise<void>')
      expect(signatures).toContain('increment(by?: number): Promise<number>')
      expect(signatures).toContain('decrement(by?: number): Promise<number>')
      expect(signatures).toContain('reset(): Promise<void>')
    })

    it('should sort methods alphabetically', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { extractAllMethodSignatures } = require('../src/types/schema-generator.js')

      const signatures = extractAllMethodSignatures(CounterSchema)

      // Alphabetically: decrement, get, increment, reset, set
      expect(signatures[0]).toContain('decrement')
      expect(signatures[1]).toContain('get')
      expect(signatures[4]).toContain('set')
    })
  })
})

// ============================================================================
// Integration: $meta.schema() to CLI Types
// ============================================================================

describe('Integration: $meta.schema() to CLI Types', () => {
  /**
   * These tests verify the full flow from $meta.schema() response
   * through type generation to CLI type safety.
   */

  describe('SchemaIntrospector', () => {
    it('should introspect schema via RPC client', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaIntrospector } = require('../src/types/schema-generator.js')

      // Mock RPC client
      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const introspector = new SchemaIntrospector(mockClient)
      const schema = await introspector.getSchema()

      expect(schema).toEqual(CustomerSchema)
      expect(mockClient.$meta.schema).toHaveBeenCalled()
    })

    it('should cache schema after first introspection', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaIntrospector } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const introspector = new SchemaIntrospector(mockClient)

      // First call
      await introspector.getSchema()
      // Second call
      await introspector.getSchema()

      // Should only call RPC once
      expect(mockClient.$meta.schema).toHaveBeenCalledTimes(1)
    })

    it('should invalidate cache on request', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaIntrospector } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const introspector = new SchemaIntrospector(mockClient)

      await introspector.getSchema()
      introspector.invalidateCache()
      await introspector.getSchema()

      expect(mockClient.$meta.schema).toHaveBeenCalledTimes(2)
    })

    it('should generate types from introspected schema', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SchemaIntrospector } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const introspector = new SchemaIntrospector(mockClient)
      const types = await introspector.generateTypes()

      expect(types).toContain('interface CustomerDO')
      expect(types).toContain('charge(amount: number')
    })
  })

  describe('CLI Type Provider', () => {
    it('should provide types to CLI completions', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CLITypeProvider } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const provider = new CLITypeProvider(mockClient)
      await provider.initialize()

      // Should expose method names for autocomplete
      const methods = provider.getMethodNames()
      expect(methods).toContain('getOrders')
      expect(methods).toContain('charge')
      expect(methods).toContain('addTag')
      expect(methods).toContain('notify')
    })

    it('should provide method signatures for hover info', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CLITypeProvider } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const provider = new CLITypeProvider(mockClient)
      await provider.initialize()

      const sig = provider.getMethodSignature('charge')
      expect(sig).toBe('charge(amount: number, description?: string): Promise<Receipt>')
    })

    it('should provide field types for dot completion', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CLITypeProvider } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const provider = new CLITypeProvider(mockClient)
      await provider.initialize()

      const fields = provider.getFieldNames()
      expect(fields).toContain('$id')
      expect(fields).toContain('name')
      expect(fields).toContain('email')
      expect(fields).toContain('balance')
    })

    it('should return field type for type checking', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CLITypeProvider } = require('../src/types/schema-generator.js')

      const mockClient = {
        $meta: {
          schema: vi.fn().mockResolvedValue(CustomerSchema),
        },
      }

      const provider = new CLITypeProvider(mockClient)
      await provider.initialize()

      expect(provider.getFieldType('balance')).toBe('number')
      expect(provider.getFieldType('tags')).toBe('string[]')
      expect(provider.getFieldType('createdAt')).toBe('Date')
    })
  })
})

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Schema Validation', () => {
  /**
   * These tests verify that invalid schemas are properly rejected
   * before type generation.
   */

  describe('validateSchema', () => {
    it('should accept valid schema', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      expect(() => validateSchema(CustomerSchema)).not.toThrow()
    })

    it('should reject schema without name', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid = { fields: [], methods: [] }
      expect(() => validateSchema(invalid)).toThrow(/name.*required/i)
    })

    it('should reject schema without fields array', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid = { name: 'Test', methods: [] }
      expect(() => validateSchema(invalid)).toThrow(/fields.*required/i)
    })

    it('should reject schema without methods array', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid = { name: 'Test', fields: [] }
      expect(() => validateSchema(invalid)).toThrow(/methods.*required/i)
    })

    it('should reject field without name', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid: Schema = {
        name: 'Test',
        fields: [{ type: 'string', required: true } as FieldSchema],
        methods: [],
      }
      expect(() => validateSchema(invalid)).toThrow(/field.*name/i)
    })

    it('should reject field without type', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid: Schema = {
        name: 'Test',
        fields: [{ name: 'test', required: true } as FieldSchema],
        methods: [],
      }
      expect(() => validateSchema(invalid)).toThrow(/field.*type/i)
    })

    it('should reject method without name', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid: Schema = {
        name: 'Test',
        fields: [],
        methods: [{ params: [], returns: 'void' } as MethodSchema],
      }
      expect(() => validateSchema(invalid)).toThrow(/method.*name/i)
    })

    it('should reject method without returns', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateSchema } = require('../src/types/schema-generator.js')

      const invalid: Schema = {
        name: 'Test',
        fields: [],
        methods: [{ name: 'test', params: [] } as MethodSchema],
      }
      expect(() => validateSchema(invalid)).toThrow(/method.*returns/i)
    })
  })
})
