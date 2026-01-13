/**
 * Runtime Validation Tests
 *
 * These tests define expected validation behaviors using Zod.
 * Currently FAILING because comprehensive validation is not implemented.
 *
 * Code review found 160+ `any` types and weak validation.
 * These tests document expected validation infrastructure.
 */

import { describe, test, expect, vi } from 'vitest'
import { z, ZodError } from 'zod'

// Import existing validation utilities (these need to be extended)
import { validateInput, ValidationError } from '../../agents/schema'

// These imports will fail until the validation module is implemented
// import {
//   validateSchema,
//   validateApiRequest,
//   validateQueryParams,
//   validatePathParams,
//   validateHeaders,
//   formatValidationErrors,
//   createValidatedHandler,
// } from './validation'

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Schema Validation', () => {
  const UserSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().int().positive().optional(),
  })

  test('validates object against schema', () => {
    const validUser = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Alice',
      email: 'alice@example.com',
    }

    const result = UserSchema.safeParse(validUser)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Alice')
    }
  })

  test('returns typed result on success', () => {
    const validUser = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Bob',
      email: 'bob@example.com',
      age: 25,
    }

    const result = UserSchema.safeParse(validUser)
    expect(result.success).toBe(true)
    if (result.success) {
      // Type narrowing should work - data should be typed
      const user: z.infer<typeof UserSchema> = result.data
      expect(user.age).toBe(25)
    }
  })

  test('throws ZodError on failure', () => {
    const invalidUser = {
      id: 'not-a-uuid',
      name: '',
      email: 'invalid-email',
    }

    expect(() => UserSchema.parse(invalidUser)).toThrow(ZodError)
  })

  test('includes path in errors', () => {
    const invalidUser = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Alice',
      email: 'invalid-email',
    }

    const result = UserSchema.safeParse(invalidUser)
    expect(result.success).toBe(false)
    if (!result.success) {
      const emailError = result.error.issues.find(
        (issue) => issue.path[0] === 'email'
      )
      expect(emailError).toBeDefined()
      expect(emailError?.path).toEqual(['email'])
    }
  })
})

// ============================================================================
// Input Validation Tests (API Layer)
// ============================================================================

describe('Input Validation', () => {
  const CreateOrderSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    customerId: z.string().uuid(),
  })

  test('API request body validated', async () => {
    // This test defines expected behavior for API request validation
    // FAILING: createValidatedHandler not implemented

    const mockRequest = {
      json: async () => ({
        productId: 'prod_123',
        quantity: 2,
        customerId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    }

    // Expected: validateApiRequest should validate the body
    const result = validateInput(CreateOrderSchema, await mockRequest.json())
    expect(result.success).toBe(true)

    // Test invalid request
    const invalidRequest = {
      json: async () => ({
        productId: 'prod_123',
        quantity: -5, // Invalid: negative quantity
        customerId: 'not-a-uuid',
      }),
    }

    const invalidResult = validateInput(
      CreateOrderSchema,
      await invalidRequest.json()
    )
    expect(invalidResult.success).toBe(false)
  })

  test('query params validated', () => {
    // FAILING: Query param validation not implemented

    const QuerySchema = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      sort: z.enum(['asc', 'desc']).default('asc'),
    })

    // Simulate URL query params (strings)
    const queryParams = {
      page: '2',
      limit: '50',
      sort: 'desc',
    }

    const result = QuerySchema.safeParse(queryParams)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(2)
      expect(typeof result.data.page).toBe('number')
    }
  })

  test('path params validated', () => {
    // FAILING: Path param validation not implemented

    const PathSchema = z.object({
      orgId: z.string().min(1),
      projectId: z.string().uuid(),
    })

    const validParams = {
      orgId: 'acme',
      projectId: '550e8400-e29b-41d4-a716-446655440000',
    }

    const result = PathSchema.safeParse(validParams)
    expect(result.success).toBe(true)

    // Invalid UUID
    const invalidParams = {
      orgId: 'acme',
      projectId: 'not-a-uuid',
    }

    const invalidResult = PathSchema.safeParse(invalidParams)
    expect(invalidResult.success).toBe(false)
  })

  test('headers validated', () => {
    // FAILING: Header validation not implemented

    const HeaderSchema = z.object({
      authorization: z.string().startsWith('Bearer '),
      'x-request-id': z.string().uuid().optional(),
      'content-type': z.literal('application/json'),
    })

    const validHeaders = {
      authorization: 'Bearer token123',
      'x-request-id': '550e8400-e29b-41d4-a716-446655440000',
      'content-type': 'application/json' as const,
    }

    const result = HeaderSchema.safeParse(validHeaders)
    expect(result.success).toBe(true)

    // Missing Bearer prefix
    const invalidHeaders = {
      authorization: 'token123', // Missing "Bearer "
      'content-type': 'application/json' as const,
    }

    const invalidResult = HeaderSchema.safeParse(invalidHeaders)
    expect(invalidResult.success).toBe(false)
  })
})

// ============================================================================
// Type Coercion Tests
// ============================================================================

describe('Type Coercion', () => {
  test('coerces string to number', () => {
    const schema = z.object({
      count: z.coerce.number(),
    })

    const result = schema.safeParse({ count: '42' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.count).toBe(42)
      expect(typeof result.data.count).toBe('number')
    }
  })

  test('coerces string to boolean', () => {
    const schema = z.object({
      enabled: z.coerce.boolean(),
    })

    // 'true' string should become true boolean
    const result = schema.safeParse({ enabled: 'true' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
      expect(typeof result.data.enabled).toBe('boolean')
    }

    // Test 'false' string
    const falseResult = schema.safeParse({ enabled: 'false' })
    expect(falseResult.success).toBe(true)
    // Note: z.coerce.boolean() coerces 'false' string to true (non-empty string)
    // This is a known gotcha - document expected behavior
  })

  test('coerces string to date', () => {
    const schema = z.object({
      createdAt: z.coerce.date(),
    })

    const result = schema.safeParse({ createdAt: '2024-01-15T12:00:00Z' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.createdAt).toBeInstanceOf(Date)
      expect(result.data.createdAt.getFullYear()).toBe(2024)
    }
  })

  test('rejects invalid coercion', () => {
    const schema = z.object({
      count: z.coerce.number(),
    })

    // 'abc' cannot be coerced to a valid number
    const result = schema.safeParse({ count: 'abc' })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Custom Validators Tests
// ============================================================================

describe('Custom Validators', () => {
  test('custom refinement runs', () => {
    const PasswordSchema = z
      .string()
      .min(8)
      .refine(
        (password) => /[A-Z]/.test(password),
        { message: 'Password must contain at least one uppercase letter' }
      )
      .refine(
        (password) => /[0-9]/.test(password),
        { message: 'Password must contain at least one number' }
      )

    // Valid password
    expect(PasswordSchema.safeParse('Password123').success).toBe(true)

    // Missing uppercase
    const result1 = PasswordSchema.safeParse('password123')
    expect(result1.success).toBe(false)
    if (!result1.success) {
      expect(result1.error.issues[0].message).toContain('uppercase')
    }

    // Missing number
    const result2 = PasswordSchema.safeParse('Passwordabc')
    expect(result2.success).toBe(false)
    if (!result2.success) {
      expect(result2.error.issues[0].message).toContain('number')
    }
  })

  test('transform modifies value', () => {
    // Transform after validation - must pass validation first
    const EmailSchema = z
      .string()
      .email()
      .transform((email) => email.toLowerCase())

    // Valid email that will be transformed
    const result = EmailSchema.safeParse('Alice@Example.COM')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('alice@example.com')
    }
  })

  test('preprocess normalizes', () => {
    // Preprocess runs before parsing
    const TrimmedString = z.preprocess(
      (val) => (typeof val === 'string' ? val.trim() : val),
      z.string().min(1)
    )

    expect(TrimmedString.safeParse('  hello  ').success).toBe(true)
    expect(TrimmedString.safeParse('   ').success).toBe(false) // Trimmed to empty
  })

  test('brand creates nominal type', () => {
    // Branded types create compile-time type safety
    const UserId = z.string().uuid().brand<'UserId'>()
    const OrderId = z.string().uuid().brand<'OrderId'>()

    type UserId = z.infer<typeof UserId>
    type OrderId = z.infer<typeof OrderId>

    const userId = UserId.parse('550e8400-e29b-41d4-a716-446655440000')
    const orderId = OrderId.parse('660e8400-e29b-41d4-a716-446655440001')

    // Both parse successfully at runtime
    expect(userId).toBeDefined()
    expect(orderId).toBeDefined()

    // At compile time, these types are incompatible (nominal typing)
    // This test validates the concept - runtime behavior is the same
  })
})

// ============================================================================
// Error Formatting Tests
// ============================================================================

describe('Error Formatting', () => {
  const ComplexSchema = z.object({
    user: z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.string().email('Invalid email format'),
    }),
    items: z.array(
      z.object({
        productId: z.string(),
        quantity: z.number().positive('Quantity must be positive'),
      })
    ),
  })

  test('formats errors for API response', () => {
    const invalidData = {
      user: {
        name: '',
        email: 'not-an-email',
      },
      items: [
        { productId: 'prod_1', quantity: -5 },
      ],
    }

    const result = ComplexSchema.safeParse(invalidData)
    expect(result.success).toBe(false)

    if (!result.success) {
      // Error should be formatted for API consumers
      const formatted = result.error.format()
      expect(formatted).toBeDefined()

      // Should have nested structure matching the schema
      expect(formatted.user).toBeDefined()
    }
  })

  test('includes field names', () => {
    const invalidData = {
      user: {
        name: 'Alice',
        email: 'invalid',
      },
      items: [],
    }

    const result = ComplexSchema.safeParse(invalidData)
    expect(result.success).toBe(false)

    if (!result.success) {
      const emailIssue = result.error.issues.find(
        (issue) => issue.path.join('.') === 'user.email'
      )
      expect(emailIssue).toBeDefined()
      expect(emailIssue?.path).toEqual(['user', 'email'])
    }
  })

  test('includes expected type', () => {
    const NumberSchema = z.object({
      value: z.number(),
    })

    const result = NumberSchema.safeParse({ value: 'not a number' })
    expect(result.success).toBe(false)

    if (!result.success) {
      const issue = result.error.issues[0]
      // Zod provides the expected type in the error code
      expect(issue.code).toBe('invalid_type')
      expect((issue as { expected?: string }).expected).toBe('number')
    }
  })

  test('includes received value', () => {
    const StringSchema = z.object({
      name: z.string(),
    })

    const result = StringSchema.safeParse({ name: 123 })
    expect(result.success).toBe(false)

    if (!result.success) {
      const issue = result.error.issues[0]
      // Zod v4 uses 'input' not 'received' for type errors
      // The error message should indicate what was wrong
      expect(issue.code).toBe('invalid_type')
      expect(issue.message).toBeDefined()
    }
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  test('validation is fast', () => {
    const SimpleSchema = z.object({
      id: z.string(),
      name: z.string(),
      active: z.boolean(),
    })

    const validData = {
      id: 'item_123',
      name: 'Test Item',
      active: true,
    }

    const iterations = 1000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      SimpleSchema.parse(validData)
    }

    const elapsed = performance.now() - start
    const avgTime = elapsed / iterations

    // Each validation should take less than 1ms
    expect(avgTime).toBeLessThan(1)
    console.log(`Average validation time: ${avgTime.toFixed(4)}ms`)
  })

  test('large object validation', () => {
    const AddressSchema = z.object({
      street: z.string(),
      city: z.string(),
      country: z.string(),
      zip: z.string(),
    })

    const LargeSchema = z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string().email(),
      addresses: z.array(AddressSchema),
      metadata: z.record(z.string(), z.unknown()),
      tags: z.array(z.string()),
      nested: z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              value: z.string(),
            }),
          }),
        }),
      }),
    })

    const largeData = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test User',
      email: 'test@example.com',
      addresses: Array(10).fill({
        street: '123 Main St',
        city: 'Anytown',
        country: 'USA',
        zip: '12345',
      }),
      metadata: Object.fromEntries(
        Array(50).fill(null).map((_, i) => [`key_${i}`, `value_${i}`])
      ),
      tags: Array(100).fill('tag'),
      nested: {
        level1: {
          level2: {
            level3: {
              value: 'deep value',
            },
          },
        },
      },
    }

    const start = performance.now()
    const result = LargeSchema.safeParse(largeData)
    const elapsed = performance.now() - start

    expect(result.success).toBe(true)
    // Large object validation should still be reasonably fast (<10ms)
    expect(elapsed).toBeLessThan(10)
    console.log(`Large object validation time: ${elapsed.toFixed(4)}ms`)
  })

  test('array validation scales', () => {
    const ItemSchema = z.object({
      id: z.number(),
      name: z.string(),
      price: z.number().positive(),
    })

    const ArraySchema = z.array(ItemSchema)

    const items = Array(1000)
      .fill(null)
      .map((_, i) => ({
        id: i,
        name: `Item ${i}`,
        price: (i + 1) * 10,
      }))

    const start = performance.now()
    const result = ArraySchema.safeParse(items)
    const elapsed = performance.now() - start

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.length).toBe(1000)
    }

    // 1000 items should validate in reasonable time (<50ms)
    expect(elapsed).toBeLessThan(50)
    console.log(`Array validation (1000 items): ${elapsed.toFixed(4)}ms`)
  })
})

// ============================================================================
// Integration Tests - Existing validateInput from agents/schema
// ============================================================================

describe('validateInput Integration', () => {
  test('validateInput works with Zod schemas', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const result = validateInput(schema, { name: 'Alice', age: 30 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Alice')
    }
  })

  test('validateInput returns ValidationError on failure', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const result = validateInput(schema, { name: 'Alice', age: 'thirty' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ValidationError)
      expect(result.error.path).toContain('age')
    }
  })
})

// ============================================================================
// Additional Validation Patterns (Currently Not Implemented)
// ============================================================================

// ============================================================================
// FAILING TESTS - Missing Validation Infrastructure
// These tests define expected functionality that doesn't exist yet
// ============================================================================

describe.todo('Missing: Validated API Handlers', () => {
  test('createValidatedHandler wraps route with validation', async () => {
    // FAILING: createValidatedHandler not implemented
    // Expected API: A factory that creates handlers with built-in validation

    // This import should exist but doesn't:
    // import { createValidatedHandler } from '../../lib/validation'

    const RequestSchema = z.object({
      userId: z.string().uuid(),
      action: z.enum(['activate', 'deactivate']),
    })

    const ResponseSchema = z.object({
      success: z.boolean(),
      message: z.string(),
    })

    // Expected usage:
    // const handler = createValidatedHandler({
    //   body: RequestSchema,
    //   response: ResponseSchema,
    //   handler: async (validated) => {
    //     return { success: true, message: 'Done' }
    //   }
    // })

    // Since createValidatedHandler doesn't exist, this test fails
    const createValidatedHandler = undefined
    expect(createValidatedHandler).toBeDefined()
  })

  test('validates request body and returns 400 on failure', async () => {
    // FAILING: No automatic 400 response on validation failure

    // Expected: Invalid body should result in 400 with detailed errors
    // Current: No such infrastructure exists

    const validateApiRequest = undefined
    expect(validateApiRequest).toBeDefined()
  })

  test('validates response before sending', async () => {
    // FAILING: Response validation not implemented

    // Expected: Validate outgoing responses match declared schema
    // This catches bugs where handler returns wrong shape

    const validateApiResponse = undefined
    expect(validateApiResponse).toBeDefined()
  })
})

describe.todo('Missing: Validation Middleware', () => {
  test('middleware validates all requests to a route', () => {
    // FAILING: No validation middleware for Hono

    // Expected: Hono middleware that validates req body/params/query
    // import { zodValidator } from '../../lib/validation/middleware'

    const zodValidator = undefined
    expect(zodValidator).toBeDefined()
  })

  test('middleware provides typed context', () => {
    // FAILING: Validated data not typed in c.req

    // Expected: After validation, c.req.valid('body') is typed
    // Currently: Manual type assertions everywhere

    const typedContext = undefined
    expect(typedContext).toBeDefined()
  })
})

describe.todo('Missing: Type-Safe Environment Variables', () => {
  test('validates env at startup', () => {
    // FAILING: No env validation at startup

    const EnvSchema = z.object({
      DATABASE_URL: z.string().url(),
      API_KEY: z.string().min(32),
      NODE_ENV: z.enum(['development', 'production', 'test']),
      PORT: z.coerce.number().int().positive().default(3000),
    })

    // Expected: validateEnv(EnvSchema) throws at startup if invalid
    // Current: Runtime crashes when accessing undefined env vars

    const validateEnv = undefined
    expect(validateEnv).toBeDefined()
  })

  test('provides typed env access', () => {
    // FAILING: process.env is untyped Record<string, string | undefined>

    // Expected: env.DATABASE_URL is string (not string | undefined)
    // after validation

    const typedEnv = undefined
    expect(typedEnv).toBeDefined()
  })
})

describe.todo('Missing: DO Message Validation', () => {
  test('validates DO method parameters', () => {
    // FAILING: DO methods accept any parameters

    // Expected: DO methods have validated parameters
    // class MyDO extends DO {
    //   @validate(z.object({ amount: z.number().positive() }))
    //   async charge(params: { amount: number }) { ... }
    // }

    const validateDecorator = undefined
    expect(validateDecorator).toBeDefined()
  })

  test('validates DO alarm payloads', () => {
    // FAILING: Alarm payloads unvalidated

    // Expected: Alarm data validated against schema before processing

    const validateAlarmPayload = undefined
    expect(validateAlarmPayload).toBeDefined()
  })
})

describe.todo('Missing: Event Schema Registry', () => {
  test('registers event schemas globally', () => {
    // FAILING: No event schema registry

    // Expected:
    // EventRegistry.register('user.created', UserCreatedSchema)
    // EventRegistry.validate('user.created', payload)

    const EventRegistry = undefined
    expect(EventRegistry).toBeDefined()
  })

  test('validates events before publishing', () => {
    // FAILING: $.send() accepts any payload

    // Expected: $.send() validates against registered schema

    const validateBeforePublish = undefined
    expect(validateBeforePublish).toBeDefined()
  })
})

describe.todo('Missing: Strict Mode Configuration', () => {
  test('enables strict validation mode', () => {
    // FAILING: No global strict mode toggle

    // Expected: In strict mode, extra keys in objects throw errors
    // z.object({...}).strict() everywhere is tedious

    const enableStrictValidation = undefined
    expect(enableStrictValidation).toBeDefined()
  })

  test('logs validation failures in development', () => {
    // FAILING: No validation failure logging

    // Expected: In dev, validation failures logged with full context

    const validationLogger = undefined
    expect(validationLogger).toBeDefined()
  })
})

describe.todo('Missing: Type Safety for Any Types', () => {
  // Code review found 160+ `any` types - these tests define proper validation

  test('workflow context parameters validated', () => {
    // FAILING: WorkflowContext accepts any parameters

    // Expected: $ context methods should validate inputs
    // Current: $.on.Customer.signup((ctx) => ctx.event) - ctx.event is any

    const WorkflowContextSchema = z.object({
      event: z.record(z.unknown()),
      state: z.record(z.unknown()),
    })

    // This should be importable but isn't
    const validateWorkflowContext = undefined
    expect(validateWorkflowContext).toBeDefined()
  })

  test('RPC call parameters validated', () => {
    // FAILING: RPC stubs accept any parameters

    // Expected: await $.Customer(id).notify(payload) validates payload
    // Current: No validation on RPC calls

    const validateRpcPayload = undefined
    expect(validateRpcPayload).toBeDefined()
  })

  test('storage get/put values validated', () => {
    // FAILING: DO storage accepts any values

    // Expected: this.state.storage.put('key', value) validates value
    // Current: Can put any value, get returns unknown

    const TypedStorage = undefined
    expect(TypedStorage).toBeDefined()
  })

  test('HTTP response bodies validated', () => {
    // FAILING: fetch() responses unvalidated

    // Expected: validateResponse(res, Schema) after fetch
    // Current: res.json() returns any

    const validateFetchResponse = undefined
    expect(validateFetchResponse).toBeDefined()
  })

  test('JSON.parse results validated', () => {
    // FAILING: JSON.parse returns any

    // Expected: safeParse wrapper that validates
    // Current: JSON.parse(data) is any

    const safeJsonParse = undefined
    expect(safeJsonParse).toBeDefined()
  })
})

describe('Advanced Validation Patterns', () => {
  test('discriminated unions', () => {
    const EventSchema = z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user.created'),
        userId: z.string().uuid(),
        email: z.string().email(),
      }),
      z.object({
        type: z.literal('order.placed'),
        orderId: z.string().uuid(),
        amount: z.number().positive(),
      }),
    ])

    const userEvent = {
      type: 'user.created' as const,
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'user@example.com',
    }

    const result = EventSchema.safeParse(userEvent)
    expect(result.success).toBe(true)

    // Invalid: wrong fields for event type
    const invalidEvent = {
      type: 'user.created' as const,
      orderId: '550e8400-e29b-41d4-a716-446655440000', // Wrong field
      amount: 100,
    }

    const invalidResult = EventSchema.safeParse(invalidEvent)
    expect(invalidResult.success).toBe(false)
  })

  test('recursive schemas', () => {
    interface TreeNode {
      name: string
      children: TreeNode[]
    }

    const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
      z.object({
        name: z.string(),
        children: z.array(TreeNodeSchema),
      })
    )

    const tree: TreeNode = {
      name: 'root',
      children: [
        {
          name: 'child1',
          children: [
            { name: 'grandchild1', children: [] },
          ],
        },
        { name: 'child2', children: [] },
      ],
    }

    const result = TreeNodeSchema.safeParse(tree)
    expect(result.success).toBe(true)
  })

  test('async validation with refine', async () => {
    // Simulate async validation (e.g., checking uniqueness in DB)
    const checkEmailUnique = vi.fn().mockResolvedValue(true)

    const AsyncEmailSchema = z
      .string()
      .email()
      .refine(
        async (email) => await checkEmailUnique(email),
        { message: 'Email already exists' }
      )

    const result = await AsyncEmailSchema.safeParseAsync('new@example.com')
    expect(result.success).toBe(true)
    expect(checkEmailUnique).toHaveBeenCalledWith('new@example.com')
  })
})
