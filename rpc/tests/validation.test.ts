// Tests for RPC Input Validation
import { describe, it, expect } from 'vitest'
import {
  validateArgs,
  defineMethodSchema,
  createSchemaRegistry,
  getMethodSchema,
  isValidRPCMethod,
  ArgSchemas,
  type ArgSchema,
  type MethodSchema,
} from '../validation'
import { ValidationError } from '../errors'
import { createServer } from '../server'

describe('RPC Input Validation', () => {
  describe('isValidRPCMethod', () => {
    it('should accept valid simple method names', () => {
      expect(isValidRPCMethod('greet')).toBe(true)
      expect(isValidRPCMethod('getUser')).toBe(true)
      expect(isValidRPCMethod('createOrder')).toBe(true)
    })

    it('should accept valid nested method names with dots', () => {
      expect(isValidRPCMethod('users.create')).toBe(true)
      expect(isValidRPCMethod('users.admin.promote')).toBe(true)
      expect(isValidRPCMethod('v2.api.list')).toBe(true)
    })

    it('should accept method names with numbers', () => {
      expect(isValidRPCMethod('v2')).toBe(true)
      expect(isValidRPCMethod('getUser2')).toBe(true)
      expect(isValidRPCMethod('api.v3.users')).toBe(true)
    })

    it('should reject empty string', () => {
      expect(isValidRPCMethod('')).toBe(false)
    })

    it('should reject non-string values', () => {
      expect(isValidRPCMethod(null)).toBe(false)
      expect(isValidRPCMethod(undefined)).toBe(false)
      expect(isValidRPCMethod(123)).toBe(false)
      expect(isValidRPCMethod({})).toBe(false)
      expect(isValidRPCMethod([])).toBe(false)
      expect(isValidRPCMethod(true)).toBe(false)
    })

    it('should reject method names starting with underscore', () => {
      expect(isValidRPCMethod('_private')).toBe(false)
      expect(isValidRPCMethod('_internalMethod')).toBe(false)
    })

    it('should reject method names starting with numbers', () => {
      expect(isValidRPCMethod('123method')).toBe(false)
      expect(isValidRPCMethod('2users')).toBe(false)
    })

    it('should reject method names with spaces', () => {
      expect(isValidRPCMethod('has space')).toBe(false)
      expect(isValidRPCMethod('get user')).toBe(false)
    })

    it('should reject method names with special characters', () => {
      expect(isValidRPCMethod('user$name')).toBe(false)
      expect(isValidRPCMethod('get-user')).toBe(false)
      expect(isValidRPCMethod('user/name')).toBe(false)
      expect(isValidRPCMethod('user\\name')).toBe(false)
      expect(isValidRPCMethod('user[0]')).toBe(false)
      expect(isValidRPCMethod('user()')).toBe(false)
    })

    it('should reject method names with underscores (except at start)', () => {
      // Note: the regex ^[a-zA-Z][a-zA-Z0-9.]*$ does not allow underscores
      expect(isValidRPCMethod('get_user')).toBe(false)
      expect(isValidRPCMethod('user_service')).toBe(false)
    })

    it('should work as a type guard narrowing unknown to string', () => {
      const method: unknown = 'users.create'
      if (isValidRPCMethod(method)) {
        // TypeScript should now know method is a string
        const uppercased: string = method.toUpperCase()
        expect(uppercased).toBe('USERS.CREATE')
      }
    })
  })

  describe('validateArgs', () => {
    it('should pass validation for correct arguments', () => {
      const schema = defineMethodSchema([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
      ])

      expect(() => validateArgs(['Alice', 25], schema)).not.toThrow()
    })

    it('should throw ValidationError for missing required argument', () => {
      const schema = defineMethodSchema([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
      ])

      expect(() => validateArgs(['Alice'], schema)).toThrow(ValidationError)

      try {
        validateArgs(['Alice'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('age')
        expect(ve.message).toContain('required')
      }
    })

    it('should throw ValidationError for wrong type', () => {
      const schema = defineMethodSchema([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
      ])

      expect(() => validateArgs(['Alice', 'not-a-number'], schema)).toThrow(ValidationError)

      try {
        validateArgs(['Alice', 'not-a-number'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('age')
        expect(ve.message).toContain('expected number')
        expect(ve.message).toContain('got string')
      }
    })

    it('should allow optional arguments to be undefined', () => {
      const schema = defineMethodSchema([
        { name: 'name', type: 'string' },
        { name: 'nickname', type: 'string', required: false },
      ])

      expect(() => validateArgs(['Alice'], schema)).not.toThrow()
      expect(() => validateArgs(['Alice', undefined], schema)).not.toThrow()
    })

    it('should validate number min/max constraints', () => {
      const schema = defineMethodSchema([
        { name: 'age', type: 'number', min: 0, max: 150 },
      ])

      expect(() => validateArgs([25], schema)).not.toThrow()
      expect(() => validateArgs([-1], schema)).toThrow(ValidationError)
      expect(() => validateArgs([200], schema)).toThrow(ValidationError)

      try {
        validateArgs([-5], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('must be at least 0')
      }
    })

    it('should validate string length constraints', () => {
      const schema = defineMethodSchema([
        { name: 'username', type: 'string', minLength: 3, maxLength: 20 },
      ])

      expect(() => validateArgs(['alice'], schema)).not.toThrow()
      expect(() => validateArgs(['ab'], schema)).toThrow(ValidationError)
      expect(() => validateArgs(['a'.repeat(25)], schema)).toThrow(ValidationError)
    })

    it('should validate string pattern', () => {
      const schema = defineMethodSchema([
        { name: 'email', type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      ])

      expect(() => validateArgs(['user@example.com'], schema)).not.toThrow()
      expect(() => validateArgs(['invalid-email'], schema)).toThrow(ValidationError)

      try {
        validateArgs(['not-an-email'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('pattern')
      }
    })

    it('should validate array length constraints', () => {
      const schema = defineMethodSchema([
        { name: 'tags', type: 'array', minLength: 1, maxLength: 5 },
      ])

      expect(() => validateArgs([['tag1', 'tag2']], schema)).not.toThrow()
      expect(() => validateArgs([[]], schema)).toThrow(ValidationError)
      expect(() => validateArgs([[1, 2, 3, 4, 5, 6]], schema)).toThrow(ValidationError)
    })

    it('should support custom validation functions', () => {
      const schema = defineMethodSchema([
        {
          name: 'value',
          type: 'number',
          validate: (v) => (v as number) % 2 === 0 || 'must be even'
        },
      ])

      expect(() => validateArgs([4], schema)).not.toThrow()
      expect(() => validateArgs([3], schema)).toThrow(ValidationError)

      try {
        validateArgs([5], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('must be even')
      }
    })

    it('should support union types', () => {
      const schema = defineMethodSchema([
        { name: 'id', type: ['string', 'number'] },
      ])

      expect(() => validateArgs(['abc'], schema)).not.toThrow()
      expect(() => validateArgs([123], schema)).not.toThrow()
      expect(() => validateArgs([true], schema)).toThrow(ValidationError)
    })

    it('should report multiple validation errors', () => {
      const schema = defineMethodSchema([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'email', type: 'string' },
      ])

      try {
        validateArgs([123, 'not-a-number'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        // Should report errors for both name and age
        expect(ve.message).toContain('name')
        expect(ve.message).toContain('age')
        expect(ve.message).toContain('email')
      }
    })

    it('should reject non-finite numbers', () => {
      const schema = defineMethodSchema([
        { name: 'value', type: 'number' },
      ])

      expect(() => validateArgs([Infinity], schema)).toThrow(ValidationError)
      expect(() => validateArgs([NaN], schema)).toThrow(ValidationError)
      expect(() => validateArgs([-Infinity], schema)).toThrow(ValidationError)
    })

    it('should handle null type', () => {
      const schema = defineMethodSchema([
        { name: 'value', type: ['string', 'null'] },
      ])

      expect(() => validateArgs(['test'], schema)).not.toThrow()
      expect(() => validateArgs([null], schema)).not.toThrow()
      expect(() => validateArgs([123], schema)).toThrow(ValidationError)
    })

    it('should validate object type', () => {
      const schema = defineMethodSchema([
        { name: 'data', type: 'object' },
      ])

      expect(() => validateArgs([{ key: 'value' }], schema)).not.toThrow()
      expect(() => validateArgs(['not-an-object'], schema)).toThrow(ValidationError)
      expect(() => validateArgs([[1, 2, 3]], schema)).toThrow(ValidationError) // Arrays are not objects
    })
  })

  describe('ArgSchemas helpers', () => {
    it('should create string schema', () => {
      const schema = ArgSchemas.string('name')
      expect(schema.name).toBe('name')
      expect(schema.type).toBe('string')
      expect(schema.required).toBe(true)
    })

    it('should create number schema', () => {
      const schema = ArgSchemas.number('age', { min: 0 })
      expect(schema.name).toBe('age')
      expect(schema.type).toBe('number')
      expect(schema.min).toBe(0)
    })

    it('should create optional schemas', () => {
      const schema = ArgSchemas.optionalString('nickname')
      expect(schema.required).toBe(false)
    })

    it('should create id schema', () => {
      const schema = ArgSchemas.id()
      expect(schema.name).toBe('id')
      expect(schema.type).toBe('string')
      expect(schema.minLength).toBe(1)
    })

    it('should create email schema', () => {
      const schema = ArgSchemas.email()
      expect(schema.name).toBe('email')
      expect(schema.pattern).toBeDefined()
    })

    it('should create integer schema', () => {
      const schema = ArgSchemas.integer('count')
      expect(schema.validate).toBeDefined()

      const methodSchema = defineMethodSchema([schema])
      expect(() => validateArgs([5], methodSchema)).not.toThrow()
      expect(() => validateArgs([5.5], methodSchema)).toThrow(ValidationError)
    })
  })

  describe('Schema Registry', () => {
    it('should create and lookup schemas', () => {
      const registry = createSchemaRegistry({
        'users.create': {
          args: [ArgSchemas.object('data')],
        },
        'users.get': {
          args: [ArgSchemas.id()],
        },
      })

      const createSchema = getMethodSchema(registry, 'users.create')
      expect(createSchema).toBeDefined()
      expect(createSchema?.args[0].name).toBe('data')

      const getSchema = getMethodSchema(registry, 'users.get')
      expect(getSchema).toBeDefined()
      expect(getSchema?.args[0].name).toBe('id')

      const unknownSchema = getMethodSchema(registry, 'users.unknown')
      expect(unknownSchema).toBeUndefined()
    })
  })

  describe('Server Integration', () => {
    const testTarget = {
      greet: (name: string) => `Hello, ${name}!`,
      add: (a: number, b: number) => a + b,
      users: {
        create: (data: { name: string }) => ({ id: '1', ...data }),
      },
    }

    it('should validate arguments when schema is provided', async () => {
      const schemas = createSchemaRegistry({
        greet: {
          args: [ArgSchemas.string('name', { minLength: 1 })],
        },
        add: {
          args: [
            ArgSchemas.number('a'),
            ArgSchemas.number('b'),
          ],
        },
      })

      const app = createServer({ target: testTarget, schemas })

      // Valid call should succeed
      const validRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] }),
      })
      expect(validRes.status).toBe(200)
      expect(await validRes.json()).toBe('Hello, World!')

      // Invalid call should fail with validation error
      const invalidRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: [123] }),
      })
      expect(invalidRes.status).toBe(400)
      const errorJson = await invalidRes.json()
      expect(errorJson.code).toBe('VALIDATION_ERROR')
      expect(errorJson.message).toContain('name')
    })

    it('should validate nested method arguments', async () => {
      const schemas = createSchemaRegistry({
        'users.create': {
          args: [ArgSchemas.object('data')],
        },
      })

      const app = createServer({ target: testTarget, schemas })

      // Valid call
      const validRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob' }] }),
      })
      expect(validRes.status).toBe(200)

      // Invalid call - string instead of object
      const invalidRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: ['not-an-object'] }),
      })
      expect(invalidRes.status).toBe(400)
      const errorJson = await invalidRes.json()
      expect(errorJson.code).toBe('VALIDATION_ERROR')
    })

    it('should skip validation for methods without schemas', async () => {
      const schemas = createSchemaRegistry({
        greet: {
          args: [ArgSchemas.string('name')],
        },
        // No schema for 'add'
      })

      const app = createServer({ target: testTarget, schemas })

      // 'add' should work without validation
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'add', args: [2, 3] }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toBe(5)
    })

    it('should work without any schemas', async () => {
      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] }),
      })
      expect(res.status).toBe(200)
    })

    it('should allow updating schemas at runtime', async () => {
      const app = createServer({ target: testTarget })

      // Initially no validation
      let res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: [123] }),
      })
      expect(res.status).toBe(200)

      // Add schemas
      app.updateSchemas(
        createSchemaRegistry({
          greet: {
            args: [ArgSchemas.string('name')],
          },
        })
      )

      // Now validation is enforced
      res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: [123] }),
      })
      expect(res.status).toBe(400)
    })

    it('should validate missing required arguments', async () => {
      const schemas = createSchemaRegistry({
        add: {
          args: [
            ArgSchemas.number('a'),
            ArgSchemas.number('b'),
          ],
        },
      })

      const app = createServer({ target: testTarget, schemas })

      // Missing second argument
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'add', args: [5] }),
      })
      expect(res.status).toBe(400)
      const errorJson = await res.json()
      expect(errorJson.code).toBe('VALIDATION_ERROR')
      expect(errorJson.message).toContain('b')
      expect(errorJson.message).toContain('required')
    })
  })
})
