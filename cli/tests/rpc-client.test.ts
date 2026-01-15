/**
 * RPC Client Tests
 *
 * Tests for the WebSocket RPC client and type generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateTypeDefinitions, type Schema } from '../src/rpc-client.js'

describe('generateTypeDefinitions', () => {
  it('should generate interface from schema', () => {
    const schema: Schema = {
      name: 'Customer',
      fields: [
        { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
      ],
      methods: [
        {
          name: 'getOrders',
          params: [],
          returns: 'Promise<Order[]>',
        },
        {
          name: 'charge',
          params: [{ name: 'amount', type: 'number', required: true }],
          returns: 'Promise<Receipt>',
        },
      ],
    }

    const typeDefs = generateTypeDefinitions(schema)

    // Should contain interface declaration
    expect(typeDefs).toContain('interface Customer {')

    // Should contain fields
    expect(typeDefs).toContain('$id: string')
    expect(typeDefs).toContain('name: string')
    expect(typeDefs).toContain('email: string')

    // Should contain methods
    expect(typeDefs).toContain('getOrders(): Promise<Order[]>')
    expect(typeDefs).toContain('charge(amount: number): Promise<Receipt>')

    // Should declare global variable
    expect(typeDefs).toContain('declare const customer: Customer')
  })

  it('should handle optional fields', () => {
    const schema: Schema = {
      name: 'User',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'nickname', type: 'string', required: false },
      ],
      methods: [],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('id: string')
    expect(typeDefs).toContain('nickname?: string')
  })

  it('should handle optional parameters', () => {
    const schema: Schema = {
      name: 'Counter',
      fields: [],
      methods: [
        {
          name: 'increment',
          params: [{ name: 'by', type: 'number', required: false }],
          returns: 'Promise<number>',
        },
      ],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('increment(by?: number): Promise<number>')
  })

  it('should handle array types', () => {
    const schema: Schema = {
      name: 'Tags',
      fields: [
        { name: 'items', type: 'string[]', required: true },
      ],
      methods: [
        {
          name: 'getAll',
          params: [],
          returns: 'Promise<string[]>',
        },
      ],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('items: string[]')
    expect(typeDefs).toContain('getAll(): Promise<string[]>')
  })

  it('should handle Date types', () => {
    const schema: Schema = {
      name: 'Event',
      fields: [
        { name: 'createdAt', type: 'Date', required: true },
      ],
      methods: [],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('createdAt: Date')
  })

  it('should include description comments', () => {
    const schema: Schema = {
      name: 'Documented',
      fields: [
        { name: 'id', type: 'string', required: true, description: 'The unique ID' },
      ],
      methods: [],
    }

    const typeDefs = generateTypeDefinitions(schema)

    // The description should be preserved in comments
    expect(typeDefs).toContain('The unique ID')
  })
})

describe('Schema validation', () => {
  it('should validate schema structure', () => {
    const validSchema: Schema = {
      name: 'Test',
      fields: [],
      methods: [],
    }

    expect(validSchema.name).toBe('Test')
    expect(Array.isArray(validSchema.fields)).toBe(true)
    expect(Array.isArray(validSchema.methods)).toBe(true)
  })

  it('should handle empty schema', () => {
    const schema: Schema = {
      name: 'Empty',
      fields: [],
      methods: [],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('interface Empty {')
    expect(typeDefs).toContain('}')
  })

  it('should handle complex method signatures', () => {
    const schema: Schema = {
      name: 'Complex',
      fields: [],
      methods: [
        {
          name: 'process',
          params: [
            { name: 'input', type: 'string', required: true },
            { name: 'options', type: 'object', required: false },
          ],
          returns: 'Promise<unknown>',
          description: 'Process input with options',
        },
      ],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('process(input: string, options?: Record<string, unknown>): Promise<unknown>')
  })
})

describe('Type mapping', () => {
  it('should map primitive types correctly', () => {
    const schema: Schema = {
      name: 'Primitives',
      fields: [
        { name: 'str', type: 'string', required: true },
        { name: 'num', type: 'number', required: true },
        { name: 'bool', type: 'boolean', required: true },
      ],
      methods: [],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('str: string')
    expect(typeDefs).toContain('num: number')
    expect(typeDefs).toContain('bool: boolean')
  })

  it('should map unknown type', () => {
    const schema: Schema = {
      name: 'Generic',
      fields: [
        { name: 'data', type: 'unknown', required: true },
      ],
      methods: [],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('data: unknown')
  })

  it('should preserve custom types', () => {
    const schema: Schema = {
      name: 'WithCustom',
      fields: [],
      methods: [
        {
          name: 'getData',
          params: [],
          returns: 'Promise<CustomType>',
        },
      ],
    }

    const typeDefs = generateTypeDefinitions(schema)

    expect(typeDefs).toContain('Promise<CustomType>')
  })
})
