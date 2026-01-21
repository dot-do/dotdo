// Tests for Zod-based RPC Input Validation
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  validateZodArgs,
  defineZodMethodSchema,
  createZodSchemaRegistry,
  getZodMethodSchema,
  isZodMethodSchema,
  formatZodErrors,
  validateZodArg,
  ZodArgSchemas,
  type ZodMethodSchema,
  type ZodArgSchema,
} from '../validation'
import { ValidationError } from '../errors'
import { createServer } from '../server'

describe('Zod Input Validation', () => {
  describe('validateZodArgs', () => {
    it('should pass validation for correct arguments', () => {
      const schema = defineZodMethodSchema([
        { name: 'name', schema: z.string() },
        { name: 'age', schema: z.number() },
      ])

      expect(() => validateZodArgs(['Alice', 25], schema)).not.toThrow()
    })

    it('should throw ValidationError for missing required argument', () => {
      const schema = defineZodMethodSchema([
        { name: 'name', schema: z.string() },
        { name: 'age', schema: z.number() },
      ])

      expect(() => validateZodArgs(['Alice'], schema)).toThrow(ValidationError)

      try {
        validateZodArgs(['Alice'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('age')
      }
    })

    it('should throw ValidationError for wrong type', () => {
      const schema = defineZodMethodSchema([
        { name: 'name', schema: z.string() },
        { name: 'age', schema: z.number() },
      ])

      expect(() => validateZodArgs(['Alice', 'not-a-number'], schema)).toThrow(ValidationError)

      try {
        validateZodArgs(['Alice', 'not-a-number'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('age')
        expect(ve.message).toContain('expected number')
      }
    })

    it('should allow optional arguments to be undefined', () => {
      const schema = defineZodMethodSchema([
        { name: 'name', schema: z.string() },
        { name: 'nickname', schema: z.string().optional() },
      ])

      expect(() => validateZodArgs(['Alice'], schema)).not.toThrow()
      expect(() => validateZodArgs(['Alice', undefined], schema)).not.toThrow()
    })

    it('should validate number min/max constraints', () => {
      const schema = defineZodMethodSchema([
        { name: 'age', schema: z.number().min(0).max(150) },
      ])

      expect(() => validateZodArgs([25], schema)).not.toThrow()
      expect(() => validateZodArgs([-1], schema)).toThrow(ValidationError)
      expect(() => validateZodArgs([200], schema)).toThrow(ValidationError)

      try {
        validateZodArgs([-5], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        // Zod may use different messages - just verify it mentions the constraint
        expect(ve.message).toMatch(/minimum|at least|too small/i)
      }
    })

    it('should validate string length constraints', () => {
      const schema = defineZodMethodSchema([
        { name: 'username', schema: z.string().min(3).max(20) },
      ])

      expect(() => validateZodArgs(['alice'], schema)).not.toThrow()
      expect(() => validateZodArgs(['ab'], schema)).toThrow(ValidationError)
      expect(() => validateZodArgs(['a'.repeat(25)], schema)).toThrow(ValidationError)
    })

    it('should validate email format', () => {
      const schema = defineZodMethodSchema([
        { name: 'email', schema: z.string().email() },
      ])

      expect(() => validateZodArgs(['user@example.com'], schema)).not.toThrow()
      expect(() => validateZodArgs(['invalid-email'], schema)).toThrow(ValidationError)

      try {
        validateZodArgs(['not-an-email'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.message).toContain('email')
      }
    })

    it('should validate URL format', () => {
      const schema = defineZodMethodSchema([
        { name: 'website', schema: z.string().url() },
      ])

      expect(() => validateZodArgs(['https://example.com'], schema)).not.toThrow()
      expect(() => validateZodArgs(['not-a-url'], schema)).toThrow(ValidationError)
    })

    it('should validate UUID format', () => {
      const schema = defineZodMethodSchema([
        { name: 'id', schema: z.string().uuid() },
      ])

      expect(() => validateZodArgs(['550e8400-e29b-41d4-a716-446655440000'], schema)).not.toThrow()
      expect(() => validateZodArgs(['not-a-uuid'], schema)).toThrow(ValidationError)
    })

    it('should validate array length constraints', () => {
      const schema = defineZodMethodSchema([
        { name: 'tags', schema: z.array(z.string()).min(1).max(5) },
      ])

      expect(() => validateZodArgs([['tag1', 'tag2']], schema)).not.toThrow()
      expect(() => validateZodArgs([[]], schema)).toThrow(ValidationError)
      expect(() => validateZodArgs([['1', '2', '3', '4', '5', '6']], schema)).toThrow(ValidationError)
    })

    it('should validate nested object schemas', () => {
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
        age: z.number().optional(),
      })

      const schema = defineZodMethodSchema([
        { name: 'user', schema: userSchema },
      ])

      expect(() => validateZodArgs([{ name: 'Alice', email: 'alice@example.com' }], schema)).not.toThrow()
      expect(() => validateZodArgs([{ name: 'Alice' }], schema)).toThrow(ValidationError) // missing email
      expect(() => validateZodArgs([{ name: 'Alice', email: 'invalid' }], schema)).toThrow(ValidationError)
    })

    it('should support union types', () => {
      const schema = defineZodMethodSchema([
        { name: 'id', schema: z.union([z.string(), z.number()]) },
      ])

      expect(() => validateZodArgs(['abc'], schema)).not.toThrow()
      expect(() => validateZodArgs([123], schema)).not.toThrow()
      expect(() => validateZodArgs([true], schema)).toThrow(ValidationError)
    })

    it('should support enum types', () => {
      const schema = defineZodMethodSchema([
        { name: 'status', schema: z.enum(['pending', 'active', 'inactive']) },
      ])

      expect(() => validateZodArgs(['active'], schema)).not.toThrow()
      expect(() => validateZodArgs(['unknown'], schema)).toThrow(ValidationError)

      try {
        validateZodArgs(['invalid'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        // Zod uses "Invalid option" message for enum errors
        expect(ve.message).toMatch(/must be one of|Invalid option|expected one of/i)
      }
    })

    it('should support literal types', () => {
      const schema = defineZodMethodSchema([
        { name: 'version', schema: z.literal('v1') },
      ])

      expect(() => validateZodArgs(['v1'], schema)).not.toThrow()
      expect(() => validateZodArgs(['v2'], schema)).toThrow(ValidationError)
    })

    it('should report multiple validation errors', () => {
      const schema = defineZodMethodSchema([
        { name: 'name', schema: z.string() },
        { name: 'age', schema: z.number() },
        { name: 'email', schema: z.string().email() },
      ])

      try {
        validateZodArgs([123, 'not-a-number', 'invalid-email'], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        // Should report errors for all three arguments
        expect(ve.message).toContain('name')
        expect(ve.message).toContain('age')
        expect(ve.message).toContain('email')
      }
    })

    it('should reject non-finite numbers with z.number().finite()', () => {
      const schema = defineZodMethodSchema([
        { name: 'value', schema: z.number().finite() },
      ])

      expect(() => validateZodArgs([42], schema)).not.toThrow()
      expect(() => validateZodArgs([Infinity], schema)).toThrow(ValidationError)
      expect(() => validateZodArgs([NaN], schema)).toThrow(ValidationError)
      expect(() => validateZodArgs([-Infinity], schema)).toThrow(ValidationError)
    })

    it('should validate integers with z.number().int()', () => {
      const schema = defineZodMethodSchema([
        { name: 'count', schema: z.number().int() },
      ])

      expect(() => validateZodArgs([5], schema)).not.toThrow()
      expect(() => validateZodArgs([5.5], schema)).toThrow(ValidationError)
    })

    it('should handle nullable types', () => {
      const schema = defineZodMethodSchema([
        { name: 'value', schema: z.string().nullable() },
      ])

      expect(() => validateZodArgs(['test'], schema)).not.toThrow()
      expect(() => validateZodArgs([null], schema)).not.toThrow()
      expect(() => validateZodArgs([123], schema)).toThrow(ValidationError)
    })

    it('should handle arrays with typed items', () => {
      const schema = defineZodMethodSchema([
        { name: 'numbers', schema: z.array(z.number()) },
      ])

      expect(() => validateZodArgs([[1, 2, 3]], schema)).not.toThrow()
      expect(() => validateZodArgs([[1, 'two', 3]], schema)).toThrow(ValidationError)
    })

    it('should validate nested paths in error messages', () => {
      const schema = defineZodMethodSchema([
        {
          name: 'user',
          schema: z.object({
            profile: z.object({
              email: z.string().email(),
            }),
          }),
        },
      ])

      try {
        validateZodArgs([{ profile: { email: 'invalid' } }], schema)
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        // Should include nested path in error
        expect(ve.message).toContain('profile')
        expect(ve.message).toContain('email')
      }
    })
  })

  describe('ZodArgSchemas helpers', () => {
    it('should create string schema', () => {
      const schema = ZodArgSchemas.string('name')
      expect(schema.name).toBe('name')
      expect(() => validateZodArgs(['test'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([123], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create nonEmptyString schema', () => {
      const schema = ZodArgSchemas.nonEmptyString('name')
      expect(() => validateZodArgs(['test'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([''], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create number schema', () => {
      const schema = ZodArgSchemas.number('age')
      expect(() => validateZodArgs([25], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['25'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create finiteNumber schema', () => {
      const schema = ZodArgSchemas.finiteNumber('value')
      expect(() => validateZodArgs([42], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([Infinity], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create integer schema', () => {
      const schema = ZodArgSchemas.integer('count')
      expect(() => validateZodArgs([5], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([5.5], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create positiveInt schema', () => {
      const schema = ZodArgSchemas.positiveInt('id')
      expect(() => validateZodArgs([1], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([0], defineZodMethodSchema([schema]))).toThrow()
      expect(() => validateZodArgs([-1], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create nonNegativeInt schema', () => {
      const schema = ZodArgSchemas.nonNegativeInt('count')
      expect(() => validateZodArgs([0], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([1], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([-1], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create boolean schema', () => {
      const schema = ZodArgSchemas.boolean('active')
      expect(() => validateZodArgs([true], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([false], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['true'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create object schema', () => {
      const schema = ZodArgSchemas.object('data')
      expect(() => validateZodArgs([{ key: 'value' }], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['not-an-object'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create array schema', () => {
      const schema = ZodArgSchemas.array('items')
      expect(() => validateZodArgs([[1, 2, 3]], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['not-an-array'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create optional schemas', () => {
      const schema = ZodArgSchemas.optionalString('nickname')
      expect(() => validateZodArgs(['test'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([undefined], defineZodMethodSchema([schema]))).not.toThrow()
    })

    it('should create id schema', () => {
      const schema = ZodArgSchemas.id()
      expect(schema.name).toBe('id')
      expect(() => validateZodArgs(['abc123'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([''], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create email schema', () => {
      const schema = ZodArgSchemas.email()
      expect(schema.name).toBe('email')
      expect(() => validateZodArgs(['user@example.com'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['invalid'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create url schema', () => {
      const schema = ZodArgSchemas.url()
      expect(() => validateZodArgs(['https://example.com'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['not-a-url'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create uuid schema', () => {
      const schema = ZodArgSchemas.uuid()
      expect(() => validateZodArgs(['550e8400-e29b-41d4-a716-446655440000'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs(['not-a-uuid'], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create custom schema', () => {
      const customSchema = z.object({ name: z.string(), value: z.number() })
      const schema = ZodArgSchemas.custom('data', customSchema)
      expect(() => validateZodArgs([{ name: 'test', value: 42 }], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([{ name: 'test' }], defineZodMethodSchema([schema]))).toThrow()
    })

    it('should create nullable schema', () => {
      const schema = ZodArgSchemas.nullable('value', z.string())
      expect(() => validateZodArgs(['test'], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([null], defineZodMethodSchema([schema]))).not.toThrow()
      expect(() => validateZodArgs([123], defineZodMethodSchema([schema]))).toThrow()
    })
  })

  describe('isZodMethodSchema', () => {
    it('should return true for Zod schemas', () => {
      const zodSchema = defineZodMethodSchema([
        { name: 'name', schema: z.string() },
      ])
      expect(isZodMethodSchema(zodSchema)).toBe(true)
    })

    it('should return false for custom schemas', () => {
      const customSchema = {
        args: [{ name: 'name', type: 'string' as const }],
      }
      expect(isZodMethodSchema(customSchema)).toBe(false)
    })

    it('should return false for empty schemas', () => {
      expect(isZodMethodSchema({ args: [] })).toBe(false)
    })
  })

  describe('Zod Schema Registry', () => {
    it('should create and lookup Zod schemas', () => {
      const registry = createZodSchemaRegistry({
        'users.create': {
          args: [ZodArgSchemas.custom('data', z.object({ name: z.string() }))],
        },
        'users.get': {
          args: [ZodArgSchemas.id()],
        },
      })

      const createSchema = getZodMethodSchema(registry, 'users.create')
      expect(createSchema).toBeDefined()
      expect(createSchema?.args[0].name).toBe('data')

      const getSchema = getZodMethodSchema(registry, 'users.get')
      expect(getSchema).toBeDefined()
      expect(getSchema?.args[0].name).toBe('id')

      const unknownSchema = getZodMethodSchema(registry, 'users.unknown')
      expect(unknownSchema).toBeUndefined()
    })
  })

  describe('Server Integration with Zod', () => {
    const testTarget = {
      greet: (name: string) => `Hello, ${name}!`,
      add: (a: number, b: number) => a + b,
      users: {
        create: (data: { name: string; email: string }) => ({ id: '1', ...data }),
        get: (id: string) => ({ id, name: 'Test User' }),
      },
    }

    it('should validate arguments with Zod schema', async () => {
      const schemas = createZodSchemaRegistry({
        greet: {
          args: [ZodArgSchemas.nonEmptyString('name')],
        },
        add: {
          args: [
            ZodArgSchemas.number('a'),
            ZodArgSchemas.number('b'),
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

    it('should validate nested method arguments with Zod', async () => {
      const userSchema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
      })

      const schemas = createZodSchemaRegistry({
        'users.create': {
          args: [ZodArgSchemas.custom('data', userSchema)],
        },
      })

      const app = createServer({ target: testTarget, schemas })

      // Valid call
      const validRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob', email: 'bob@example.com' }] }),
      })
      expect(validRes.status).toBe(200)

      // Invalid call - missing email
      const invalidRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob' }] }),
      })
      expect(invalidRes.status).toBe(400)
      const errorJson = await invalidRes.json()
      expect(errorJson.code).toBe('VALIDATION_ERROR')
      expect(errorJson.message).toContain('email')

      // Invalid call - invalid email format
      const invalidEmailRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob', email: 'invalid' }] }),
      })
      expect(invalidEmailRes.status).toBe(400)
      const emailErrorJson = await invalidEmailRes.json()
      expect(emailErrorJson.code).toBe('VALIDATION_ERROR')
    })

    it('should skip validation for methods without schemas', async () => {
      const schemas = createZodSchemaRegistry({
        greet: {
          args: [ZodArgSchemas.string('name')],
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

    it('should allow updating Zod schemas at runtime', async () => {
      const app = createServer({ target: testTarget })

      // Initially no validation
      let res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: [123] }),
      })
      expect(res.status).toBe(200)

      // Add Zod schemas
      app.updateSchemas(
        createZodSchemaRegistry({
          greet: {
            args: [ZodArgSchemas.string('name')],
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

    it('should validate missing required arguments with Zod', async () => {
      const schemas = createZodSchemaRegistry({
        add: {
          args: [
            ZodArgSchemas.number('a'),
            ZodArgSchemas.number('b'),
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
    })

    it('should work with complex Zod schemas', async () => {
      const complexTarget = {
        createUser: (data: {
          name: string
          email: string
          age?: number
          roles: string[]
        }) => ({ id: '1', ...data }),
      }

      const userInputSchema = z.object({
        name: z.string().min(1).max(100),
        email: z.string().email(),
        age: z.number().int().min(0).max(150).optional(),
        roles: z.array(z.enum(['admin', 'user', 'guest'])).min(1),
      })

      const schemas = createZodSchemaRegistry({
        createUser: {
          args: [ZodArgSchemas.custom('data', userInputSchema)],
        },
      })

      const app = createServer({ target: complexTarget, schemas })

      // Valid call
      const validRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'createUser',
          args: [{ name: 'Alice', email: 'alice@example.com', age: 30, roles: ['admin', 'user'] }],
        }),
      })
      expect(validRes.status).toBe(200)

      // Invalid role
      const invalidRoleRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'createUser',
          args: [{ name: 'Alice', email: 'alice@example.com', roles: ['superuser'] }],
        }),
      })
      expect(invalidRoleRes.status).toBe(400)
      const roleErrorJson = await invalidRoleRes.json()
      expect(roleErrorJson.code).toBe('VALIDATION_ERROR')

      // Invalid age (negative)
      const invalidAgeRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'createUser',
          args: [{ name: 'Alice', email: 'alice@example.com', age: -5, roles: ['user'] }],
        }),
      })
      expect(invalidAgeRes.status).toBe(400)

      // Empty roles array
      const emptyRolesRes = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'createUser',
          args: [{ name: 'Alice', email: 'alice@example.com', roles: [] }],
        }),
      })
      expect(emptyRolesRes.status).toBe(400)
    })
  })

  describe('formatZodErrors', () => {
    it('should format type errors correctly', () => {
      const schema = z.string()
      const result = schema.safeParse(123)
      expect(result.success).toBe(false)
      if (!result.success) {
        const errors = formatZodErrors(result.error, 'name', 0)
        expect(errors).toHaveLength(1)
        expect(errors[0].field).toBe('args[0] (name)')
        expect(errors[0].message).toContain('expected')
        expect(errors[0].message).toContain('string')
      }
    })

    it('should format nested path errors correctly', () => {
      const schema = z.object({ profile: z.object({ email: z.string().email() }) })
      const result = schema.safeParse({ profile: { email: 'invalid' } })
      expect(result.success).toBe(false)
      if (!result.success) {
        const errors = formatZodErrors(result.error, 'user', 0)
        expect(errors).toHaveLength(1)
        expect(errors[0].field).toBe('args[0] (user.profile.email)')
      }
    })

    it('should format enum errors correctly', () => {
      const schema = z.enum(['a', 'b', 'c'])
      const result = schema.safeParse('d')
      expect(result.success).toBe(false)
      if (!result.success) {
        const errors = formatZodErrors(result.error, 'value', 0)
        expect(errors).toHaveLength(1)
        // Zod uses "Invalid option" for enum errors
        expect(errors[0].message).toMatch(/must be one of|Invalid option|expected one of/i)
      }
    })
  })

  describe('validateZodArg', () => {
    it('should return empty array for valid input', () => {
      const errors = validateZodArg('test', z.string(), 'name', 0)
      expect(errors).toHaveLength(0)
    })

    it('should return errors for invalid input', () => {
      const errors = validateZodArg(123, z.string(), 'name', 0)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].field).toBe('args[0] (name)')
    })
  })
})
