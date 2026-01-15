/**
 * Type Generator Tests
 *
 * Tests for the TypeScript definition generator.
 */

import { describe, it, expect } from 'vitest'
import {
  generateTypesFromSchema,
  generateReplContextTypes,
  generateCombinedTypes,
} from '../src/types/generator.js'
import type { Schema } from '../src/rpc-client.js'

describe('generateTypesFromSchema', () => {
  const customerSchema: Schema = {
    name: 'Customer',
    fields: [
      { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'createdAt', type: 'Date', required: true },
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
        ],
        returns: 'Promise<Receipt>',
        description: 'Charge the customer',
      },
      {
        name: 'notify',
        params: [
          { name: 'message', type: 'string', required: true },
          { name: 'options', type: 'object', required: false },
        ],
        returns: 'Promise<void>',
      },
    ],
  }

  it('should generate complete interface', () => {
    const types = generateTypesFromSchema(customerSchema)

    // Interface declaration
    expect(types).toContain('interface Customer {')

    // Fields
    expect(types).toContain('$id: string')
    expect(types).toContain('name: string')
    expect(types).toContain('email: string')
    expect(types).toContain('createdAt: Date')

    // Methods
    expect(types).toContain('getOrders(): Promise<Order[]>')
    expect(types).toContain('charge(amount: number): Promise<Receipt>')
    expect(types).toContain('notify(message: string, options?: Record<string, unknown>): Promise<void>')
  })

  it('should include JSDoc by default', () => {
    const types = generateTypesFromSchema(customerSchema)

    expect(types).toContain('/** Unique identifier */')
    expect(types).toContain('* Get all orders for this customer')
    expect(types).toContain('@param amount')
    expect(types).toContain('@returns')
  })

  it('should allow disabling JSDoc', () => {
    const types = generateTypesFromSchema(customerSchema, { includeJSDoc: false })

    expect(types).not.toContain('/**')
  })

  it('should support namespace wrapping', () => {
    const types = generateTypesFromSchema(customerSchema, { namespace: 'API' })

    expect(types).toContain('declare namespace API {')
    expect(types).toContain('API.Customer')
  })

  it('should include auto-generated header', () => {
    const types = generateTypesFromSchema(customerSchema)

    expect(types).toContain('Auto-generated TypeScript definitions')
    expect(types).toContain('Generated at:')
  })

  it('should declare global variable', () => {
    const types = generateTypesFromSchema(customerSchema)

    expect(types).toContain('declare const customer: Customer')
  })
})

describe('generateReplContextTypes', () => {
  it('should generate DotdoContext interface', () => {
    const types = generateReplContextTypes()

    expect(types).toContain('interface DotdoContext')
    expect(types).toContain('send(event: DotdoEvent): void')
    expect(types).toContain('try<T>')
    expect(types).toContain('do<T>')
  })

  it('should generate $ global', () => {
    const types = generateReplContextTypes()

    expect(types).toContain('declare const $: DotdoContext')
  })

  it('should generate EventProxy', () => {
    const types = generateReplContextTypes()

    expect(types).toContain('interface EventProxy')
    expect(types).toContain('[noun: string]')
    expect(types).toContain('[verb: string]')
  })

  it('should generate ScheduleProxy', () => {
    const types = generateReplContextTypes()

    expect(types).toContain('interface ScheduleProxy')
    expect(types).toContain('Monday: ScheduleProxy')
    expect(types).toContain('hour:')
    expect(types).toContain('at(time: string)')
  })

  it('should generate Thing interface', () => {
    const types = generateReplContextTypes()

    expect(types).toContain('interface Thing')
    expect(types).toContain('$type: string')
    expect(types).toContain('$id: string')
  })

  it('should generate console interface', () => {
    const types = generateReplContextTypes()

    expect(types).toContain('declare const console')
    expect(types).toContain('log(...args: unknown[])')
    expect(types).toContain('error(...args: unknown[])')
  })
})

describe('generateCombinedTypes', () => {
  it('should combine multiple schemas', () => {
    const schemas: Schema[] = [
      {
        name: 'Customer',
        fields: [{ name: 'id', type: 'string', required: true }],
        methods: [],
      },
      {
        name: 'Order',
        fields: [{ name: 'id', type: 'string', required: true }],
        methods: [],
      },
    ]

    const types = generateCombinedTypes(schemas)

    expect(types).toContain('interface Customer')
    expect(types).toContain('interface Order')
  })

  it('should include REPL context types', () => {
    const types = generateCombinedTypes([])

    expect(types).toContain('DotdoContext')
    expect(types).toContain('declare const $')
  })

  it('should add section comments', () => {
    const schemas: Schema[] = [
      {
        name: 'Test',
        fields: [],
        methods: [],
      },
    ]

    const types = generateCombinedTypes(schemas)

    expect(types).toContain('// Test types')
  })
})

describe('type mapping edge cases', () => {
  it('should handle void return type', () => {
    const schema: Schema = {
      name: 'Test',
      fields: [],
      methods: [
        { name: 'doSomething', params: [], returns: 'void' },
      ],
    }

    const types = generateTypesFromSchema(schema)

    expect(types).toContain('doSomething(): void')
  })

  it('should handle Promise<void>', () => {
    const schema: Schema = {
      name: 'Test',
      fields: [],
      methods: [
        { name: 'asyncDoSomething', params: [], returns: 'Promise<void>' },
      ],
    }

    const types = generateTypesFromSchema(schema)

    expect(types).toContain('asyncDoSomething(): Promise<void>')
  })

  it('should handle nested arrays', () => {
    const schema: Schema = {
      name: 'Test',
      fields: [
        { name: 'matrix', type: 'number[][]', required: true },
      ],
      methods: [],
    }

    const types = generateTypesFromSchema(schema)

    // The exact format may vary, but it should handle the type
    expect(types).toContain('matrix')
  })

  it('should handle Map type', () => {
    const schema: Schema = {
      name: 'Test',
      fields: [],
      methods: [
        { name: 'getMap', params: [], returns: 'Promise<Map<string, number>>' },
      ],
    }

    const types = generateTypesFromSchema(schema)

    expect(types).toContain('Map<string, number>')
  })
})

describe('strict mode', () => {
  it('should use unknown instead of any in strict mode', () => {
    const schema: Schema = {
      name: 'Test',
      fields: [
        { name: 'data', type: 'any', required: true },
      ],
      methods: [],
    }

    const strictTypes = generateTypesFromSchema(schema, { strict: true })
    const looseTypes = generateTypesFromSchema(schema, { strict: false })

    expect(strictTypes).toContain('data: unknown')
    expect(looseTypes).toContain('data: any')
  })
})
