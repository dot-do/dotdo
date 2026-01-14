/**
 * Schema DSL Tests
 *
 * Tests the fluent API for schema definition with support for:
 * - Zod schema generation
 * - JSON Schema generation
 * - Field types, constraints, defaults
 * - Required/optional fields
 * - Nested object support
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  s,
  contract,
  fromZod,
  fromJSONSchema,
  zodToJSONSchema,
  jsonSchemaToZod,
  type ContractMetadata,
} from '../schema-dsl'
import type { JSONSchema } from '../index'

// ============================================================================
// FLUENT API TESTS
// ============================================================================

describe('Schema DSL', () => {
  describe('string fields', () => {
    it('should create a basic string field', () => {
      const field = s.string()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('hello').success).toBe(true)
      expect(zodSchema.safeParse(123).success).toBe(false)
      expect(jsonSchema.type).toBe('string')
    })

    it('should support min/max length constraints', () => {
      const field = s.string().min(3).max(10)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('ab').success).toBe(false)
      expect(zodSchema.safeParse('abc').success).toBe(true)
      expect(zodSchema.safeParse('1234567890').success).toBe(true)
      expect(zodSchema.safeParse('12345678901').success).toBe(false)

      expect(jsonSchema.minLength).toBe(3)
      expect(jsonSchema.maxLength).toBe(10)
    })

    it('should support length helper', () => {
      const field = s.string().length(5, 10)
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.minLength).toBe(5)
      expect(jsonSchema.maxLength).toBe(10)
    })

    it('should support pattern validation', () => {
      const field = s.string().pattern(/^[a-z]+$/)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('abc').success).toBe(true)
      expect(zodSchema.safeParse('ABC').success).toBe(false)
      expect(zodSchema.safeParse('123').success).toBe(false)

      expect(jsonSchema.pattern).toBe('^[a-z]+$')
    })

    it('should support email format', () => {
      const field = s.string().email()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('test@example.com').success).toBe(true)
      expect(zodSchema.safeParse('invalid-email').success).toBe(false)

      expect(jsonSchema.format).toBe('email')
    })

    it('should support url format', () => {
      const field = s.string().url()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('https://example.com').success).toBe(true)
      expect(zodSchema.safeParse('not-a-url').success).toBe(false)

      expect(jsonSchema.format).toBe('uri')
    })

    it('should support uuid format', () => {
      const field = s.string().uuid()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true)
      expect(zodSchema.safeParse('not-a-uuid').success).toBe(false)

      expect(jsonSchema.format).toBe('uuid')
    })

    it('should support datetime format', () => {
      const field = s.string().datetime()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('2024-01-15T10:30:00Z').success).toBe(true)
      expect(zodSchema.safeParse('not-a-datetime').success).toBe(false)

      expect(jsonSchema.format).toBe('date-time')
    })

    it('should support enum values', () => {
      const field = s.string().enum(['pending', 'active', 'closed'] as const)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('pending').success).toBe(true)
      expect(zodSchema.safeParse('invalid').success).toBe(false)

      expect(jsonSchema.enum).toEqual(['pending', 'active', 'closed'])
    })

    it('should support optional strings', () => {
      const field = s.string().optional()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse('hello').success).toBe(true)
      expect(zodSchema.safeParse(undefined).success).toBe(true)
      expect(field.isOptional()).toBe(true)
    })

    it('should support nullable strings', () => {
      const field = s.string().nullable()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse('hello').success).toBe(true)
      expect(zodSchema.safeParse(null).success).toBe(true)

      expect(jsonSchema.type).toEqual(['string', 'null'])
    })

    it('should support default values', () => {
      const field = s.string().default('default-value')
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.parse(undefined)).toBe('default-value')
      expect(jsonSchema.default).toBe('default-value')
    })

    it('should support descriptions', () => {
      const field = s.string().description('A user name')
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.description).toBe('A user name')
    })
  })

  describe('number fields', () => {
    it('should create a basic number field', () => {
      const field = s.number()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse(3.14).success).toBe(true)
      expect(zodSchema.safeParse('42').success).toBe(false)

      expect(jsonSchema.type).toBe('number')
    })

    it('should support integer type', () => {
      const field = s.number().integer()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse(3.14).success).toBe(false)

      expect(jsonSchema.type).toBe('integer')
    })

    it('should support int() shorthand', () => {
      const field = s.int()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse(3.14).success).toBe(false)

      expect(jsonSchema.type).toBe('integer')
    })

    it('should support min/max constraints', () => {
      const field = s.number().min(0).max(100)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(-1).success).toBe(false)
      expect(zodSchema.safeParse(0).success).toBe(true)
      expect(zodSchema.safeParse(100).success).toBe(true)
      expect(zodSchema.safeParse(101).success).toBe(false)

      expect(jsonSchema.minimum).toBe(0)
      expect(jsonSchema.maximum).toBe(100)
    })

    it('should support range helper', () => {
      const field = s.number().range(10, 20)
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.minimum).toBe(10)
      expect(jsonSchema.maximum).toBe(20)
    })

    it('should support exclusive bounds', () => {
      const field = s.number().gt(0).lt(100)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(0).success).toBe(false)
      expect(zodSchema.safeParse(1).success).toBe(true)
      expect(zodSchema.safeParse(99).success).toBe(true)
      expect(zodSchema.safeParse(100).success).toBe(false)

      expect(jsonSchema.minimum).toBe(0)
      expect(jsonSchema.exclusiveMinimum).toBe(true)
      expect(jsonSchema.maximum).toBe(100)
      expect(jsonSchema.exclusiveMaximum).toBe(true)
    })

    it('should support positive() helper', () => {
      const field = s.number().positive()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse(0).success).toBe(false)
      expect(zodSchema.safeParse(1).success).toBe(true)
      expect(zodSchema.safeParse(-1).success).toBe(false)
    })

    it('should support nonnegative() helper', () => {
      const field = s.number().nonnegative()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse(0).success).toBe(true)
      expect(zodSchema.safeParse(1).success).toBe(true)
      expect(zodSchema.safeParse(-1).success).toBe(false)
    })

    it('should support optional numbers', () => {
      const field = s.number().optional()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse(undefined).success).toBe(true)
    })

    it('should support nullable numbers', () => {
      const field = s.number().nullable()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse(null).success).toBe(true)

      expect(jsonSchema.type).toEqual(['number', 'null'])
    })

    it('should support default values', () => {
      const field = s.number().default(0)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.parse(undefined)).toBe(0)
      expect(jsonSchema.default).toBe(0)
    })
  })

  describe('boolean fields', () => {
    it('should create a basic boolean field', () => {
      const field = s.boolean()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(true).success).toBe(true)
      expect(zodSchema.safeParse(false).success).toBe(true)
      expect(zodSchema.safeParse('true').success).toBe(false)

      expect(jsonSchema.type).toBe('boolean')
    })

    it('should support bool() alias', () => {
      const field = s.bool()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse(true).success).toBe(true)
    })

    it('should support optional booleans', () => {
      const field = s.boolean().optional()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse(true).success).toBe(true)
      expect(zodSchema.safeParse(undefined).success).toBe(true)
    })

    it('should support default values', () => {
      const field = s.boolean().default(false)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.parse(undefined)).toBe(false)
      expect(jsonSchema.default).toBe(false)
    })
  })

  describe('array fields', () => {
    it('should create a basic array field', () => {
      const field = s.array(s.string())
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse(['a', 'b', 'c']).success).toBe(true)
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(false)

      expect(jsonSchema.type).toBe('array')
      expect(jsonSchema.items?.type).toBe('string')
    })

    it('should support min/max length', () => {
      const field = s.array(s.number()).min(1).max(5)
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse([]).success).toBe(false)
      expect(zodSchema.safeParse([1]).success).toBe(true)
      expect(zodSchema.safeParse([1, 2, 3, 4, 5]).success).toBe(true)
      expect(zodSchema.safeParse([1, 2, 3, 4, 5, 6]).success).toBe(false)

      expect(jsonSchema.minItems).toBe(1)
      expect(jsonSchema.maxItems).toBe(5)
    })

    it('should support nonempty() helper', () => {
      const field = s.array(s.string()).nonempty()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse([]).success).toBe(false)
      expect(zodSchema.safeParse(['a']).success).toBe(true)

      expect(jsonSchema.minItems).toBe(1)
    })

    it('should support nested object arrays', () => {
      const field = s.array(
        s.object({
          id: s.string(),
          value: s.number(),
        })
      )
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse([{ id: '1', value: 10 }]).success).toBe(true)
      expect(zodSchema.safeParse([{ id: '1' }]).success).toBe(false)

      expect(jsonSchema.items?.type).toBe('object')
      expect(jsonSchema.items?.properties?.id?.type).toBe('string')
    })

    it('should support optional arrays', () => {
      const field = s.array(s.string()).optional()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse(['a']).success).toBe(true)
      expect(zodSchema.safeParse(undefined).success).toBe(true)
    })

    it('should support default values', () => {
      const field = s.array(s.string()).default([])
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.parse(undefined)).toEqual([])
      expect(jsonSchema.default).toEqual([])
    })
  })

  describe('object fields', () => {
    it('should create a basic object field', () => {
      const field = s.object({
        name: s.string(),
        age: s.number(),
      })
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse({ name: 'Alice', age: 30 }).success).toBe(true)
      expect(zodSchema.safeParse({ name: 'Alice' }).success).toBe(false) // age is required

      expect(jsonSchema.type).toBe('object')
      expect(jsonSchema.properties?.name?.type).toBe('string')
      expect(jsonSchema.properties?.age?.type).toBe('number')
      expect(jsonSchema.required).toContain('name')
      expect(jsonSchema.required).toContain('age')
    })

    it('should handle optional fields correctly', () => {
      const field = s.object({
        name: s.string(),
        nickname: s.string().optional(),
      })
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse({ name: 'Alice' }).success).toBe(true)
      expect(zodSchema.safeParse({ name: 'Alice', nickname: 'Ali' }).success).toBe(true)

      expect(jsonSchema.required).toContain('name')
      expect(jsonSchema.required).not.toContain('nickname')
    })

    it('should support nested objects', () => {
      const field = s.object({
        user: s.object({
          name: s.string(),
          email: s.email(),
        }),
        preferences: s.object({
          theme: s.enum(['light', 'dark'] as const),
          notifications: s.boolean().default(true),
        }),
      })
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(
        zodSchema.safeParse({
          user: { name: 'Alice', email: 'alice@example.com' },
          preferences: { theme: 'dark' },
        }).success
      ).toBe(true)

      expect(jsonSchema.properties?.user?.type).toBe('object')
      expect(jsonSchema.properties?.user?.properties?.name?.type).toBe('string')
    })

    it('should support strict mode', () => {
      const field = s
        .object({
          name: s.string(),
        })
        .strict()
      const zodSchema = field.toZod()
      const jsonSchema = field.toJSONSchema()

      expect(zodSchema.safeParse({ name: 'Alice' }).success).toBe(true)
      expect(zodSchema.safeParse({ name: 'Alice', extra: 'field' }).success).toBe(false)

      expect(jsonSchema.additionalProperties).toBe(false)
    })

    it('should support optional objects', () => {
      const field = s
        .object({
          name: s.string(),
        })
        .optional()
      const zodSchema = field.toZod()

      expect(zodSchema.safeParse({ name: 'Alice' }).success).toBe(true)
      expect(zodSchema.safeParse(undefined).success).toBe(true)
    })
  })

  describe('shorthand helpers', () => {
    it('should provide s.email() shorthand', () => {
      const field = s.email()
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.format).toBe('email')
    })

    it('should provide s.url() shorthand', () => {
      const field = s.url()
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.format).toBe('uri')
    })

    it('should provide s.uuid() shorthand', () => {
      const field = s.uuid()
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.format).toBe('uuid')
    })

    it('should provide s.date() shorthand', () => {
      const field = s.date()
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.format).toBe('date')
    })

    it('should provide s.datetime() shorthand', () => {
      const field = s.datetime()
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.format).toBe('date-time')
    })

    it('should provide s.enum() shorthand', () => {
      const field = s.enum(['a', 'b', 'c'] as const)
      const jsonSchema = field.toJSONSchema()

      expect(jsonSchema.enum).toEqual(['a', 'b', 'c'])
    })
  })
})

// ============================================================================
// CONTRACT CREATION TESTS
// ============================================================================

describe('contract()', () => {
  it('should create contract from DSL builder', () => {
    const userContract = contract({
      name: 'user',
      version: '1.0.0',
      schema: s.object({
        id: s.uuid(),
        email: s.email(),
        name: s.string().min(1).max(100),
        age: s.int().min(0).max(150).optional(),
        active: s.boolean().default(true),
      }),
      metadata: {
        description: 'User schema',
        owner: 'identity-team',
        team: 'platform',
        tags: ['user', 'identity'],
      },
    })

    expect(userContract.name).toBe('user')
    expect(userContract.version).toBe('1.0.0')
    expect(userContract.zodSchema).toBeDefined()
    expect(userContract.jsonSchema).toBeDefined()
    expect(userContract.metadata?.owner).toBe('identity-team')
    expect(userContract.metadata?.team).toBe('platform')

    // Validate with Zod
    const validUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'alice@example.com',
      name: 'Alice',
      active: true,
    }
    expect(userContract.zodSchema.safeParse(validUser).success).toBe(true)

    // JSON Schema should have correct structure
    expect(userContract.jsonSchema.type).toBe('object')
    expect(userContract.jsonSchema.properties?.id?.format).toBe('uuid')
    expect(userContract.jsonSchema.properties?.email?.format).toBe('email')
  })

  it('should create contract from Zod schema directly', () => {
    const schema = z.object({
      id: z.string().uuid(),
      name: z.string(),
      count: z.number().int().min(0),
    })

    const orderContract = contract({
      name: 'order',
      version: '1.0.0',
      schema,
    })

    expect(orderContract.name).toBe('order')
    expect(orderContract.zodSchema).toBe(schema)
    expect(orderContract.jsonSchema.type).toBe('object')
    expect(orderContract.jsonSchema.properties?.id?.format).toBe('uuid')
  })

  it('should create contract from JSON Schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
      },
      required: ['id', 'quantity'],
    }

    const itemContract = contract({
      name: 'item',
      version: '1.0.0',
      schema: jsonSchema,
    })

    expect(itemContract.name).toBe('item')
    expect(itemContract.jsonSchema).toBe(jsonSchema)
    expect(itemContract.zodSchema).toBeDefined()

    // Validate with generated Zod schema
    expect(itemContract.zodSchema.safeParse({ id: 'item-1', quantity: 5 }).success).toBe(true)
    expect(itemContract.zodSchema.safeParse({ id: 'item-1', quantity: 0 }).success).toBe(false)
  })

  it('should support SLA metadata', () => {
    const userContract = contract({
      name: 'user',
      version: '1.0.0',
      schema: s.object({
        id: s.string(),
      }),
      metadata: {
        description: 'User schema',
        owner: 'platform-team',
        team: 'identity',
        sla: {
          freshness: '1h',
          availability: 0.999,
          latency: '<100ms',
        },
        tags: ['user', 'core'],
      },
    })

    expect(userContract.metadata?.sla?.freshness).toBe('1h')
    expect(userContract.metadata?.sla?.availability).toBe(0.999)
    expect(userContract.metadata?.sla?.latency).toBe('<100ms')
  })
})

// ============================================================================
// fromZod() TESTS
// ============================================================================

describe('fromZod()', () => {
  it('should create contract from Zod schema', () => {
    const zodSchema = z.object({
      id: z.string(),
      email: z.string().email(),
      age: z.number().int().min(0).optional(),
    })

    const userContract = fromZod(zodSchema, {
      name: 'user',
      version: '1.0.0',
      metadata: {
        description: 'User from Zod',
        owner: 'team-a',
      },
    })

    expect(userContract.name).toBe('user')
    expect(userContract.version).toBe('1.0.0')
    expect(userContract.zodSchema).toBe(zodSchema)
    expect(userContract.jsonSchema.type).toBe('object')
    expect(userContract.jsonSchema.properties?.email?.format).toBe('email')
    expect(userContract.metadata?.owner).toBe('team-a')
  })

  it('should correctly infer TypeScript types', () => {
    const zodSchema = z.object({
      name: z.string(),
      count: z.number(),
    })

    type InferredType = z.infer<typeof zodSchema>

    const contract = fromZod(zodSchema, { name: 'test', version: '1.0.0' })

    // Type-safe access
    const result = contract.zodSchema.parse({ name: 'test', count: 42 })
    expect(result.name).toBe('test')
    expect(result.count).toBe(42)
  })
})

// ============================================================================
// fromJSONSchema() TESTS
// ============================================================================

describe('fromJSONSchema()', () => {
  it('should create contract from JSON Schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1 },
        active: { type: 'boolean', default: true },
      },
      required: ['id', 'name'],
    }

    const userContract = fromJSONSchema(jsonSchema, {
      name: 'user',
      version: '1.0.0',
      metadata: {
        description: 'User from JSON Schema',
      },
    })

    expect(userContract.name).toBe('user')
    expect(userContract.jsonSchema).toBe(jsonSchema)
    expect(userContract.zodSchema).toBeDefined()

    // Validate with generated Zod
    const validData = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      active: true,
    }
    expect(userContract.zodSchema.safeParse(validData).success).toBe(true)

    const invalidData = {
      id: 'not-a-uuid',
      name: '',
    }
    expect(userContract.zodSchema.safeParse(invalidData).success).toBe(false)
  })
})

// ============================================================================
// CONVERSION TESTS
// ============================================================================

describe('zodToJSONSchema()', () => {
  it('should convert string schema', () => {
    const zodSchema = z.string().min(1).max(100).email()
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.minLength).toBe(1)
    expect(jsonSchema.maxLength).toBe(100)
    expect(jsonSchema.format).toBe('email')
  })

  it('should convert number schema', () => {
    const zodSchema = z.number().int().min(0).max(100)
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toBe('integer')
    expect(jsonSchema.minimum).toBe(0)
    expect(jsonSchema.maximum).toBe(100)
  })

  it('should convert boolean schema', () => {
    const zodSchema = z.boolean()
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toBe('boolean')
  })

  it('should convert array schema', () => {
    const zodSchema = z.array(z.string()).min(1).max(10)
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toBe('array')
    expect(jsonSchema.items?.type).toBe('string')
    expect(jsonSchema.minItems).toBe(1)
    expect(jsonSchema.maxItems).toBe(10)
  })

  it('should convert object schema with required fields', () => {
    const zodSchema = z.object({
      id: z.string(),
      name: z.string().optional(),
    })
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties?.id?.type).toBe('string')
    expect(jsonSchema.properties?.name?.type).toBe('string')
    expect(jsonSchema.required).toContain('id')
    expect(jsonSchema.required).not.toContain('name')
  })

  it('should convert strict object schema', () => {
    const zodSchema = z.object({ id: z.string() }).strict()
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.additionalProperties).toBe(false)
  })

  it('should convert enum schema', () => {
    const zodSchema = z.enum(['a', 'b', 'c'])
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.enum).toEqual(['a', 'b', 'c'])
  })

  it('should convert nullable schema', () => {
    const zodSchema = z.string().nullable()
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.type).toEqual(['string', 'null'])
  })

  it('should convert schema with default', () => {
    const zodSchema = z.string().default('hello')
    const jsonSchema = zodToJSONSchema(zodSchema)

    expect(jsonSchema.default).toBe('hello')
  })
})

describe('jsonSchemaToZod()', () => {
  it('should convert string schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      format: 'email',
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse('test@example.com').success).toBe(true)
    expect(zodSchema.safeParse('').success).toBe(false)
    expect(zodSchema.safeParse('invalid-email').success).toBe(false)
  })

  it('should convert number schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'integer',
      minimum: 0,
      maximum: 100,
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse(50).success).toBe(true)
    expect(zodSchema.safeParse(-1).success).toBe(false)
    expect(zodSchema.safeParse(101).success).toBe(false)
    expect(zodSchema.safeParse(3.14).success).toBe(false)
  })

  it('should convert boolean schema', () => {
    const jsonSchema: JSONSchema = { type: 'boolean' }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse(true).success).toBe(true)
    expect(zodSchema.safeParse(false).success).toBe(true)
    expect(zodSchema.safeParse('true').success).toBe(false)
  })

  it('should convert array schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse(['a', 'b']).success).toBe(true)
    expect(zodSchema.safeParse([]).success).toBe(false)
  })

  it('should convert object schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        count: { type: 'integer' },
      },
      required: ['id'],
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse({ id: '1', count: 5 }).success).toBe(true)
    expect(zodSchema.safeParse({ id: '1' }).success).toBe(true)
    expect(zodSchema.safeParse({ count: 5 }).success).toBe(false)
  })

  it('should convert nullable schema', () => {
    const jsonSchema: JSONSchema = {
      type: ['string', 'null'],
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse('hello').success).toBe(true)
    expect(zodSchema.safeParse(null).success).toBe(true)
  })

  it('should convert schema with default', () => {
    const jsonSchema: JSONSchema = {
      type: 'string',
      default: 'default-value',
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.parse(undefined)).toBe('default-value')
  })

  it('should convert enum schema', () => {
    const jsonSchema: JSONSchema = {
      type: 'string',
      enum: ['a', 'b', 'c'],
    }
    const zodSchema = jsonSchemaToZod(jsonSchema)

    expect(zodSchema.safeParse('a').success).toBe(true)
    expect(zodSchema.safeParse('d').success).toBe(false)
  })
})

// ============================================================================
// COMPLEX SCHEMA TESTS
// ============================================================================

describe('complex schemas', () => {
  it('should handle e-commerce order schema', () => {
    const orderContract = contract({
      name: 'order',
      version: '1.0.0',
      schema: s.object({
        id: s.uuid(),
        customerId: s.uuid(),
        status: s.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const),
        items: s
          .array(
            s.object({
              productId: s.uuid(),
              sku: s.string().min(1).max(50),
              name: s.string(),
              quantity: s.int().min(1),
              unitPrice: s.number().positive(),
              totalPrice: s.number().positive(),
            })
          )
          .nonempty(),
        shippingAddress: s.object({
          street: s.string(),
          city: s.string(),
          state: s.string().optional(),
          country: s.string(),
          zipCode: s.string().pattern(/^[0-9]{5}(-[0-9]{4})?$/),
        }),
        subtotal: s.number().nonnegative(),
        tax: s.number().nonnegative(),
        total: s.number().positive(),
        notes: s.string().optional(),
        createdAt: s.datetime(),
        updatedAt: s.datetime(),
      }),
      metadata: {
        description: 'E-commerce order schema',
        owner: 'commerce-team',
        team: 'orders',
        sla: {
          freshness: '5m',
          availability: 0.9999,
        },
        tags: ['commerce', 'orders', 'core'],
      },
    })

    const validOrder = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      customerId: '123e4567-e89b-12d3-a456-426614174001',
      status: 'pending',
      items: [
        {
          productId: '123e4567-e89b-12d3-a456-426614174002',
          sku: 'PROD-001',
          name: 'Test Product',
          quantity: 2,
          unitPrice: 29.99,
          totalPrice: 59.98,
        },
      ],
      shippingAddress: {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        country: 'USA',
        zipCode: '10001',
      },
      subtotal: 59.98,
      tax: 5.4,
      total: 65.38,
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T10:30:00Z',
    }

    expect(orderContract.zodSchema.safeParse(validOrder).success).toBe(true)

    // Test invalid order
    const invalidOrder = { ...validOrder, items: [] }
    expect(orderContract.zodSchema.safeParse(invalidOrder).success).toBe(false)
  })

  it('should handle user profile schema with nested preferences', () => {
    const profileContract = contract({
      name: 'user-profile',
      version: '2.0.0',
      schema: s.object({
        id: s.uuid(),
        email: s.email(),
        username: s.string().min(3).max(30).pattern(/^[a-zA-Z0-9_]+$/),
        profile: s.object({
          displayName: s.string().max(100),
          bio: s.string().max(500).optional(),
          avatarUrl: s.url().optional(),
          location: s
            .object({
              city: s.string(),
              country: s.string(),
              timezone: s.string(),
            })
            .optional(),
        }),
        preferences: s.object({
          theme: s.enum(['light', 'dark', 'system'] as const).default('system'),
          language: s.string().default('en'),
          notifications: s.object({
            email: s.boolean().default(true),
            push: s.boolean().default(true),
            sms: s.boolean().default(false),
          }),
          privacy: s.object({
            profileVisibility: s.enum(['public', 'private', 'friends'] as const).default('public'),
            showOnlineStatus: s.boolean().default(true),
          }),
        }),
        metadata: s.object({
          createdAt: s.datetime(),
          updatedAt: s.datetime(),
          lastLoginAt: s.datetime().optional(),
          loginCount: s.int().nonnegative().default(0),
        }),
      }),
    })

    const validProfile = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'alice@example.com',
      username: 'alice_smith',
      profile: {
        displayName: 'Alice Smith',
        bio: 'Software engineer',
        avatarUrl: 'https://example.com/avatar.jpg',
        location: {
          city: 'San Francisco',
          country: 'USA',
          timezone: 'America/Los_Angeles',
        },
      },
      preferences: {
        theme: 'dark',
        language: 'en',
        notifications: {
          email: true,
          push: true,
          sms: false,
        },
        privacy: {
          profileVisibility: 'public',
          showOnlineStatus: true,
        },
      },
      metadata: {
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T10:30:00Z',
        lastLoginAt: '2024-01-15T09:00:00Z',
        loginCount: 42,
      },
    }

    expect(profileContract.zodSchema.safeParse(validProfile).success).toBe(true)

    // JSON Schema should capture the structure
    expect(profileContract.jsonSchema.properties?.preferences?.properties?.theme?.enum).toEqual(['light', 'dark', 'system'])
    expect(profileContract.jsonSchema.properties?.preferences?.properties?.theme?.default).toBe('system')
  })
})
