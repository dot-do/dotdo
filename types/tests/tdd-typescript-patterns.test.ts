/**
 * TDD TypeScript Patterns Tests
 *
 * RED-GREEN-REFACTOR cycle for TypeScript improvements:
 * - Eliminating any usage
 * - Improving generic type inference
 * - Adding runtime validation at boundaries
 * - Type guards and narrowing
 *
 * @module types/tests/tdd-typescript-patterns
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'

// ============================================================================
// 1. GENERIC TYPE INFERENCE TESTS
// ============================================================================

describe('Generic Type Inference', () => {
  describe('function return type inference', () => {
    it('should infer return type from implementation', () => {
      // Define a generic identity function
      function identity<T>(value: T): T {
        return value
      }

      const stringResult = identity('hello')
      const numberResult = identity(42)
      const objectResult = identity({ name: 'test' })

      expectTypeOf(stringResult).toEqualTypeOf<string>()
      expectTypeOf(numberResult).toEqualTypeOf<number>()
      expectTypeOf(objectResult).toEqualTypeOf<{ name: string }>()
    })

    it('should preserve literal types through generics', () => {
      function preserveLiteral<T extends string>(value: T): T {
        return value
      }

      const literal = preserveLiteral('specific-value')
      expectTypeOf(literal).toEqualTypeOf<'specific-value'>()
    })

    it('should infer array element types', () => {
      function first<T>(arr: T[]): T | undefined {
        return arr[0]
      }

      const numbers = [1, 2, 3]
      const result = first(numbers)
      expectTypeOf(result).toEqualTypeOf<number | undefined>()
    })

    it('should infer tuple types correctly', () => {
      function tuple<A, B>(a: A, b: B): [A, B] {
        return [a, b]
      }

      const result = tuple('hello', 42)
      expectTypeOf(result).toEqualTypeOf<[string, number]>()
    })
  })

  describe('constrained generics', () => {
    it('should enforce extends constraint', () => {
      interface HasId {
        id: string
      }

      function getId<T extends HasId>(obj: T): string {
        return obj.id
      }

      const user = { id: 'user-1', name: 'Alice' }
      const result = getId(user)
      expectTypeOf(result).toEqualTypeOf<string>()
    })

    it('should enforce keyof constraint', () => {
      function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
        return obj[key]
      }

      const user = { name: 'Alice', age: 30 }
      const name = getProperty(user, 'name')
      const age = getProperty(user, 'age')

      expectTypeOf(name).toEqualTypeOf<string>()
      expectTypeOf(age).toEqualTypeOf<number>()
    })

    it('should support multiple constraints', () => {
      interface Named {
        name: string
      }

      interface Aged {
        age: number
      }

      function describe<T extends Named & Aged>(entity: T): string {
        return `${entity.name} is ${entity.age}`
      }

      const person = { name: 'Bob', age: 25, role: 'admin' }
      const result = describe(person)
      expectTypeOf(result).toEqualTypeOf<string>()
      expect(result).toBe('Bob is 25')
    })
  })

  describe('mapped types', () => {
    it('should transform object types', () => {
      type Readonly<T> = { readonly [K in keyof T]: T[K] }

      type User = { name: string; age: number }
      type ReadonlyUser = Readonly<User>

      const user: ReadonlyUser = { name: 'Alice', age: 30 }
      expectTypeOf(user.name).toEqualTypeOf<string>()

      // Type test: readonly properties
      type NameIsReadonly = ReadonlyUser['name']
      expectTypeOf<NameIsReadonly>().toEqualTypeOf<string>()
    })

    it('should support optional mapping', () => {
      type Partial<T> = { [K in keyof T]?: T[K] }

      type User = { name: string; age: number }
      type PartialUser = Partial<User>

      const partial: PartialUser = { name: 'Bob' }
      expectTypeOf(partial).toMatchTypeOf<{ name?: string; age?: number }>()
    })

    it('should support key filtering', () => {
      type PickByType<T, U> = {
        [K in keyof T as T[K] extends U ? K : never]: T[K]
      }

      type User = { name: string; age: number; active: boolean }
      type StringProps = PickByType<User, string>

      const stringOnly: StringProps = { name: 'Test' }
      expectTypeOf(stringOnly).toEqualTypeOf<{ name: string }>()
    })
  })

  describe('conditional types', () => {
    it('should distribute over unions', () => {
      type NonNullable<T> = T extends null | undefined ? never : T

      type MaybeString = string | null | undefined
      type DefiniteString = NonNullable<MaybeString>

      const value: DefiniteString = 'hello'
      expectTypeOf(value).toEqualTypeOf<string>()
    })

    it('should extract array element type', () => {
      type ElementOf<T> = T extends (infer E)[] ? E : never

      type NumberArray = number[]
      type Element = ElementOf<NumberArray>

      const element: Element = 42
      expectTypeOf(element).toEqualTypeOf<number>()
    })

    it('should extract promise resolved type', () => {
      type Awaited<T> = T extends Promise<infer U> ? U : T

      type PromisedString = Promise<string>
      type ResolvedString = Awaited<PromisedString>

      const resolved: ResolvedString = 'resolved'
      expectTypeOf(resolved).toEqualTypeOf<string>()
    })

    it('should extract function return type', () => {
      type ReturnTypeOf<T> = T extends (...args: unknown[]) => infer R ? R : never

      type Fn = (x: number) => { value: string }
      type FnReturn = ReturnTypeOf<Fn>

      const result: FnReturn = { value: 'test' }
      expectTypeOf(result).toEqualTypeOf<{ value: string }>()
    })
  })
})

// ============================================================================
// 2. TYPE GUARD TESTS
// ============================================================================

describe('Type Guards', () => {
  describe('primitive type guards', () => {
    it('should narrow string type', () => {
      function isString(value: unknown): value is string {
        return typeof value === 'string'
      }

      const value: unknown = 'hello'
      if (isString(value)) {
        expectTypeOf(value).toEqualTypeOf<string>()
        expect(value.toUpperCase()).toBe('HELLO')
      }
    })

    it('should narrow number type', () => {
      function isNumber(value: unknown): value is number {
        return typeof value === 'number' && !Number.isNaN(value)
      }

      const value: unknown = 42
      if (isNumber(value)) {
        expectTypeOf(value).toEqualTypeOf<number>()
        expect(value.toFixed(2)).toBe('42.00')
      }
    })

    it('should narrow boolean type', () => {
      function isBoolean(value: unknown): value is boolean {
        return typeof value === 'boolean'
      }

      const value: unknown = true
      if (isBoolean(value)) {
        expectTypeOf(value).toEqualTypeOf<boolean>()
      }
    })

    it('should narrow array type', () => {
      function isArray<T>(value: unknown): value is T[] {
        return Array.isArray(value)
      }

      const value: unknown = [1, 2, 3]
      if (isArray<number>(value)) {
        expectTypeOf(value).toEqualTypeOf<number[]>()
        expect(value.length).toBe(3)
      }
    })
  })

  describe('object type guards', () => {
    interface User {
      $type: 'User'
      name: string
      email: string
    }

    interface Admin {
      $type: 'Admin'
      name: string
      permissions: string[]
    }

    it('should narrow union types with discriminant', () => {
      function isUser(entity: User | Admin): entity is User {
        return entity.$type === 'User'
      }

      const entity: User | Admin = { $type: 'User', name: 'Alice', email: 'alice@test.com' }

      if (isUser(entity)) {
        expectTypeOf(entity).toEqualTypeOf<User>()
        expect(entity.email).toBe('alice@test.com')
      }
    })

    it('should narrow with in operator', () => {
      function hasEmail(obj: User | Admin): obj is User {
        return 'email' in obj
      }

      const entity: User | Admin = { $type: 'User', name: 'Bob', email: 'bob@test.com' }

      if (hasEmail(entity)) {
        expectTypeOf(entity).toEqualTypeOf<User>()
      }
    })

    it('should narrow with property check', () => {
      interface Success<T> {
        success: true
        data: T
      }

      interface Failure {
        success: false
        error: string
      }

      type Result<T> = Success<T> | Failure

      function isSuccess<T>(result: Result<T>): result is Success<T> {
        return result.success === true
      }

      const result: Result<string> = { success: true, data: 'hello' }

      if (isSuccess(result)) {
        expectTypeOf(result.data).toEqualTypeOf<string>()
        expect(result.data).toBe('hello')
      }
    })
  })

  describe('assertion functions', () => {
    it('should assert value is defined', () => {
      function assertDefined<T>(value: T | undefined | null): asserts value is T {
        if (value === undefined || value === null) {
          throw new Error('Value is not defined')
        }
      }

      let value: string | undefined = 'hello'
      assertDefined(value)
      // After assertion, value is narrowed to string
      expectTypeOf(value).toEqualTypeOf<string>()
    })

    it('should assert condition', () => {
      function assert(condition: boolean, message: string): asserts condition {
        if (!condition) {
          throw new Error(message)
        }
      }

      const value: unknown = 42
      assert(typeof value === 'number', 'Expected number')
      // After assertion, value is still unknown (condition doesn't provide type info)
      expectTypeOf(value).toEqualTypeOf<unknown>()
    })
  })

  describe('exhaustive checks', () => {
    it('should ensure exhaustive switch statements', () => {
      type Status = 'pending' | 'active' | 'completed'

      function assertNever(value: never): never {
        throw new Error(`Unexpected value: ${value}`)
      }

      function handleStatus(status: Status): string {
        switch (status) {
          case 'pending':
            return 'Waiting...'
          case 'active':
            return 'In progress...'
          case 'completed':
            return 'Done!'
          default:
            // If all cases are handled, this is unreachable
            return assertNever(status)
        }
      }

      expect(handleStatus('pending')).toBe('Waiting...')
      expect(handleStatus('active')).toBe('In progress...')
      expect(handleStatus('completed')).toBe('Done!')
    })
  })
})

// ============================================================================
// 3. RUNTIME VALIDATION WITH ZOD
// ============================================================================

describe('Runtime Validation with Zod', () => {
  describe('basic schema validation', () => {
    it('should validate string schema', () => {
      const schema = z.string()

      const result = schema.safeParse('hello')
      expect(result.success).toBe(true)
      if (result.success) {
        expectTypeOf(result.data).toEqualTypeOf<string>()
      }
    })

    it('should validate number schema', () => {
      const schema = z.number().min(0).max(100)

      const validResult = schema.safeParse(50)
      expect(validResult.success).toBe(true)

      const invalidResult = schema.safeParse(150)
      expect(invalidResult.success).toBe(false)
    })

    it('should validate object schema', () => {
      const userSchema = z.object({
        name: z.string().min(1),
        age: z.number().int().positive(),
        email: z.string().email(),
      })

      type User = z.infer<typeof userSchema>

      const validUser = {
        name: 'Alice',
        age: 30,
        email: 'alice@example.com',
      }

      const result = userSchema.safeParse(validUser)
      expect(result.success).toBe(true)
      if (result.success) {
        expectTypeOf(result.data).toEqualTypeOf<User>()
      }
    })

    it('should validate array schema', () => {
      const schema = z.array(z.string()).min(1).max(10)

      const validResult = schema.safeParse(['a', 'b', 'c'])
      expect(validResult.success).toBe(true)

      const emptyResult = schema.safeParse([])
      expect(emptyResult.success).toBe(false)
    })
  })

  describe('discriminated unions', () => {
    it('should validate discriminated union', () => {
      const successSchema = z.object({
        status: z.literal('success'),
        data: z.unknown(),
      })

      const errorSchema = z.object({
        status: z.literal('error'),
        message: z.string(),
      })

      const resultSchema = z.discriminatedUnion('status', [successSchema, errorSchema])

      type Result = z.infer<typeof resultSchema>

      const successResult = resultSchema.safeParse({ status: 'success', data: 'hello' })
      expect(successResult.success).toBe(true)

      const errorResult = resultSchema.safeParse({ status: 'error', message: 'Failed' })
      expect(errorResult.success).toBe(true)

      if (successResult.success) {
        expectTypeOf(successResult.data).toMatchTypeOf<Result>()
      }
    })
  })

  describe('type coercion', () => {
    it('should coerce string to number', () => {
      const schema = z.coerce.number()

      const result = schema.safeParse('42')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(42)
        expectTypeOf(result.data).toEqualTypeOf<number>()
      }
    })

    it('should coerce string to boolean', () => {
      const schema = z.coerce.boolean()

      const trueResult = schema.safeParse('true')
      expect(trueResult.success).toBe(true)
      if (trueResult.success) {
        expect(trueResult.data).toBe(true)
      }
    })

    it('should coerce string to date', () => {
      const schema = z.coerce.date()

      const result = schema.safeParse('2025-01-01')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date)
        expectTypeOf(result.data).toEqualTypeOf<Date>()
      }
    })
  })

  describe('transformations', () => {
    it('should transform input to output', () => {
      const schema = z.string().transform((val) => val.toUpperCase())

      const result = schema.safeParse('hello')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('HELLO')
        expectTypeOf(result.data).toEqualTypeOf<string>()
      }
    })

    it('should transform with type change', () => {
      const schema = z.string().transform((val) => parseInt(val, 10))

      type Output = z.output<typeof schema>

      const result = schema.safeParse('42')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(42)
        expectTypeOf(result.data).toEqualTypeOf<Output>()
      }
    })

    it('should refine with custom validation', () => {
      const schema = z.string().refine(
        (val) => val.startsWith('user_'),
        { message: 'Must start with user_' }
      )

      const validResult = schema.safeParse('user_123')
      expect(validResult.success).toBe(true)

      const invalidResult = schema.safeParse('admin_123')
      expect(invalidResult.success).toBe(false)
    })
  })

  describe('API boundary validation', () => {
    it('should validate request body', () => {
      const createUserSchema = z.object({
        name: z.string().min(1, 'Name is required'),
        email: z.string().email('Invalid email format'),
        age: z.number().int().positive().optional(),
      })

      type CreateUserInput = z.infer<typeof createUserSchema>

      function validateCreateUser(input: unknown): CreateUserInput {
        return createUserSchema.parse(input)
      }

      const validInput = { name: 'Alice', email: 'alice@test.com', age: 30 }
      const result = validateCreateUser(validInput)
      expectTypeOf(result).toEqualTypeOf<CreateUserInput>()
      expect(result.name).toBe('Alice')
    })

    it('should validate query params', () => {
      const paginationSchema = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
        sort: z.enum(['asc', 'desc']).default('asc'),
      })

      type PaginationParams = z.infer<typeof paginationSchema>

      function validatePagination(params: Record<string, string>): PaginationParams {
        return paginationSchema.parse(params)
      }

      const result = validatePagination({ limit: '50', offset: '10', sort: 'desc' })
      expect(result.limit).toBe(50)
      expect(result.offset).toBe(10)
      expect(result.sort).toBe('desc')
    })

    it('should validate environment variables', () => {
      const envSchema = z.object({
        DATABASE_URL: z.string().url(),
        API_KEY: z.string().min(32),
        PORT: z.coerce.number().int().default(3000),
        DEBUG: z.coerce.boolean().default(false),
      })

      type Env = z.infer<typeof envSchema>

      const mockEnv = {
        DATABASE_URL: 'postgres://localhost:5432/db',
        API_KEY: 'sk_test_1234567890123456789012345678901234567890',
        PORT: '8080',
        DEBUG: 'true',
      }

      const result = envSchema.safeParse(mockEnv)
      expect(result.success).toBe(true)
      if (result.success) {
        expectTypeOf(result.data).toEqualTypeOf<Env>()
        expect(result.data.PORT).toBe(8080)
        expect(result.data.DEBUG).toBe(true)
      }
    })
  })
})

// ============================================================================
// 4. AVOIDING ANY - SAFER PATTERNS
// ============================================================================

describe('Avoiding Any - Safer Patterns', () => {
  describe('use unknown instead of any', () => {
    it('should require type narrowing for unknown', () => {
      function processUnknown(value: unknown): string {
        // Must narrow type before use
        if (typeof value === 'string') {
          return value.toUpperCase()
        }
        if (typeof value === 'number') {
          return value.toString()
        }
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value)
        }
        return String(value)
      }

      expect(processUnknown('hello')).toBe('HELLO')
      expect(processUnknown(42)).toBe('42')
      expect(processUnknown({ a: 1 })).toBe('{"a":1}')
    })

    it('should preserve type safety with generic unknown handler', () => {
      type Handler<T> = (value: T) => string

      const handlers: Record<string, Handler<unknown>> = {
        string: (v) => (v as string).toUpperCase(),
        number: (v) => (v as number).toFixed(2),
      }

      function handle(type: string, value: unknown): string {
        const handler = handlers[type]
        if (!handler) {
          return String(value)
        }
        return handler(value)
      }

      expect(handle('string', 'hello')).toBe('HELLO')
      expect(handle('number', 3.14159)).toBe('3.14')
    })
  })

  describe('use generics instead of any', () => {
    it('should use generic for container types', () => {
      class Container<T> {
        constructor(private value: T) {}

        get(): T {
          return this.value
        }

        map<U>(fn: (value: T) => U): Container<U> {
          return new Container(fn(this.value))
        }
      }

      const stringContainer = new Container('hello')
      const lengthContainer = stringContainer.map((s) => s.length)

      expectTypeOf(stringContainer.get()).toEqualTypeOf<string>()
      expectTypeOf(lengthContainer.get()).toEqualTypeOf<number>()
      expect(lengthContainer.get()).toBe(5)
    })

    it('should use generic for factory functions', () => {
      function createStore<T>(initial: T): {
        get: () => T
        set: (value: T) => void
      } {
        let value = initial
        return {
          get: () => value,
          set: (newValue: T) => {
            value = newValue
          },
        }
      }

      const numberStore = createStore(0)
      numberStore.set(42)
      expectTypeOf(numberStore.get()).toEqualTypeOf<number>()
      expect(numberStore.get()).toBe(42)

      const stringStore = createStore('initial')
      stringStore.set('updated')
      expectTypeOf(stringStore.get()).toEqualTypeOf<string>()
      expect(stringStore.get()).toBe('updated')
    })
  })

  describe('use Record instead of object with any', () => {
    it('should use Record for dynamic keys', () => {
      const cache: Record<string, unknown> = {}

      cache['user:1'] = { name: 'Alice' }
      cache['count'] = 42

      // Must narrow type when retrieving
      const user = cache['user:1']
      if (typeof user === 'object' && user !== null && 'name' in user) {
        expectTypeOf((user as { name: string }).name).toEqualTypeOf<string>()
      }
    })

    it('should use Map for type-safe dynamic storage', () => {
      const store = new Map<string, { id: string; data: unknown }>()

      store.set('item1', { id: '1', data: 'hello' })
      store.set('item2', { id: '2', data: 42 })

      const item = store.get('item1')
      if (item) {
        expectTypeOf(item.id).toEqualTypeOf<string>()
        expectTypeOf(item.data).toEqualTypeOf<unknown>()
      }
    })
  })

  describe('use template literal types', () => {
    it('should enforce string patterns with template literals', () => {
      type UserId = `user_${string}`
      type AdminId = `admin_${string}`
      type EntityId = UserId | AdminId

      function processEntity(id: EntityId): string {
        if (id.startsWith('user_')) {
          return `Processing user: ${id}`
        }
        return `Processing admin: ${id}`
      }

      const userId: UserId = 'user_123'
      const adminId: AdminId = 'admin_456'

      expect(processEntity(userId)).toBe('Processing user: user_123')
      expect(processEntity(adminId)).toBe('Processing admin: admin_456')
    })

    it('should infer from template literal patterns', () => {
      type EventName<T extends string> = `on${Capitalize<T>}`

      type ClickEvent = EventName<'click'>
      type SubmitEvent = EventName<'submit'>

      const onClick: ClickEvent = 'onClick'
      const onSubmit: SubmitEvent = 'onSubmit'

      expectTypeOf(onClick).toEqualTypeOf<'onClick'>()
      expectTypeOf(onSubmit).toEqualTypeOf<'onSubmit'>()
    })
  })
})

// ============================================================================
// 5. BRANDED TYPES FOR TYPE SAFETY
// ============================================================================

describe('Branded Types', () => {
  // Branded type pattern
  type Brand<T, B extends string> = T & { readonly __brand: B }

  type UserId = Brand<string, 'UserId'>
  type PostId = Brand<string, 'PostId'>
  type Timestamp = Brand<number, 'Timestamp'>

  describe('creating branded types', () => {
    it('should create branded string types', () => {
      function createUserId(id: string): UserId {
        return id as UserId
      }

      function createPostId(id: string): PostId {
        return id as PostId
      }

      const userId = createUserId('user_123')
      const postId = createPostId('post_456')

      expectTypeOf(userId).toMatchTypeOf<UserId>()
      expectTypeOf(postId).toMatchTypeOf<PostId>()

      // TYPE TEST: These are not interchangeable
      // const wrongAssignment: UserId = postId // Should error
    })

    it('should create branded number types', () => {
      function createTimestamp(ms: number): Timestamp {
        return ms as Timestamp
      }

      const timestamp = createTimestamp(Date.now())
      expectTypeOf(timestamp).toMatchTypeOf<Timestamp>()
    })
  })

  describe('using branded types in functions', () => {
    it('should enforce branded type parameters', () => {
      function getUserById(id: UserId): { id: UserId; name: string } {
        return { id, name: 'User' }
      }

      function getPostById(id: PostId): { id: PostId; title: string } {
        return { id, title: 'Post' }
      }

      const userId = 'user_123' as UserId
      const postId = 'post_456' as PostId

      const user = getUserById(userId)
      const post = getPostById(postId)

      expect(user.id).toBe('user_123')
      expect(post.id).toBe('post_456')

      // TYPE TEST: Cannot pass wrong branded type
      // getUserById(postId) // Should error
      // getPostById(userId) // Should error
    })
  })

  describe('validating branded types', () => {
    it('should validate before branding', () => {
      function validateAndCreateUserId(input: string): UserId | null {
        if (!input.startsWith('user_')) {
          return null
        }
        return input as UserId
      }

      const validId = validateAndCreateUserId('user_123')
      const invalidId = validateAndCreateUserId('admin_456')

      expect(validId).toBe('user_123')
      expect(invalidId).toBeNull()
    })

    it('should use zod with branded types', () => {
      const userIdSchema = z.string()
        .refine((val): val is UserId => val.startsWith('user_'), {
          message: 'User ID must start with user_',
        })

      const result = userIdSchema.safeParse('user_123')
      expect(result.success).toBe(true)

      const invalidResult = userIdSchema.safeParse('admin_456')
      expect(invalidResult.success).toBe(false)
    })
  })
})

// ============================================================================
// 6. UTILITY TYPE PATTERNS
// ============================================================================

describe('Utility Type Patterns', () => {
  describe('DeepPartial and DeepRequired', () => {
    type DeepPartial<T> = {
      [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
    }

    type DeepRequired<T> = {
      [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P]
    }

    it('should make all nested properties optional', () => {
      interface Config {
        database: {
          host: string
          port: number
          options: {
            ssl: boolean
            timeout: number
          }
        }
      }

      type PartialConfig = DeepPartial<Config>

      const config: PartialConfig = {
        database: {
          host: 'localhost',
          // port and options can be omitted
        },
      }

      expect(config.database?.host).toBe('localhost')
    })
  })

  describe('Pick and Omit extensions', () => {
    it('should pick nested properties', () => {
      type PickNested<T, K extends string> =
        K extends `${infer First}.${infer Rest}`
          ? First extends keyof T
            ? { [P in First]: PickNested<T[First], Rest> }
            : never
          : K extends keyof T
            ? Pick<T, K>
            : never

      interface User {
        profile: {
          name: string
          age: number
          address: {
            city: string
            country: string
          }
        }
      }

      // This is a simplified example - full nested pick is complex
      type UserName = Pick<User['profile'], 'name'>

      const userName: UserName = { name: 'Alice' }
      expectTypeOf(userName.name).toEqualTypeOf<string>()
    })
  })

  describe('Type-safe event emitter', () => {
    it('should enforce event types', () => {
      type EventMap = {
        'user:created': { userId: string; name: string }
        'user:updated': { userId: string; changes: string[] }
        'user:deleted': { userId: string }
      }

      type EventName = keyof EventMap

      class TypedEmitter {
        private handlers: Map<string, Set<(data: unknown) => void>> = new Map()

        on<K extends EventName>(event: K, handler: (data: EventMap[K]) => void): void {
          if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set())
          }
          this.handlers.get(event)!.add(handler as (data: unknown) => void)
        }

        emit<K extends EventName>(event: K, data: EventMap[K]): void {
          const handlers = this.handlers.get(event)
          if (handlers) {
            handlers.forEach((handler) => handler(data))
          }
        }
      }

      const emitter = new TypedEmitter()
      let receivedData: EventMap['user:created'] | null = null

      emitter.on('user:created', (data) => {
        // TypeScript knows data is { userId: string; name: string }
        receivedData = data
      })

      emitter.emit('user:created', { userId: '123', name: 'Alice' })

      expect(receivedData).toEqual({ userId: '123', name: 'Alice' })
    })
  })
})

// ============================================================================
// 7. SAFE TYPE ASSERTIONS
// ============================================================================

describe('Safe Type Assertions', () => {
  describe('replacing as unknown as with type guards', () => {
    it('should use type guard instead of double assertion', () => {
      // BAD: const value = input as unknown as TargetType

      // GOOD: Use type guard
      interface Response {
        status: number
        data: unknown
      }

      interface UserResponse {
        status: number
        data: { user: { id: string; name: string } }
      }

      function isUserResponse(response: Response): response is UserResponse {
        if (response.status !== 200) return false
        if (typeof response.data !== 'object' || response.data === null) return false
        const data = response.data as Record<string, unknown>
        if (!data.user || typeof data.user !== 'object') return false
        const user = data.user as Record<string, unknown>
        return typeof user.id === 'string' && typeof user.name === 'string'
      }

      const response: Response = {
        status: 200,
        data: { user: { id: '123', name: 'Alice' } },
      }

      if (isUserResponse(response)) {
        expectTypeOf(response.data.user.name).toEqualTypeOf<string>()
        expect(response.data.user.name).toBe('Alice')
      }
    })

    it('should use zod parse instead of assertion', () => {
      // BAD: const user = apiResponse as unknown as User

      // GOOD: Use zod schema validation
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      })

      type User = z.infer<typeof userSchema>

      function parseUser(data: unknown): User {
        return userSchema.parse(data)
      }

      const apiResponse = { id: '123', name: 'Alice', email: 'alice@test.com' }
      const user = parseUser(apiResponse)

      expectTypeOf(user).toEqualTypeOf<User>()
      expect(user.name).toBe('Alice')
    })
  })

  describe('satisfies operator for type checking', () => {
    it('should use satisfies for type-safe object literals', () => {
      interface RouteConfig {
        path: string
        handler: string
        methods?: ('GET' | 'POST' | 'PUT' | 'DELETE')[]
      }

      const routes = {
        home: { path: '/', handler: 'HomeController.index' },
        users: { path: '/users', handler: 'UserController.list', methods: ['GET', 'POST'] },
        user: { path: '/users/:id', handler: 'UserController.show', methods: ['GET'] },
      } satisfies Record<string, RouteConfig>

      // Type is preserved as literal, not widened
      expectTypeOf(routes.home.path).toEqualTypeOf<string>()
      expect(routes.users.methods).toContain('GET')
    })

    it('should use satisfies with const assertion', () => {
      const config = {
        environment: 'production',
        debug: false,
        features: ['auth', 'analytics'] as const,
      } satisfies {
        environment: string
        debug: boolean
        features: readonly string[]
      }

      // Literal types are preserved
      expectTypeOf(config.features).toEqualTypeOf<readonly ['auth', 'analytics']>()
    })
  })
})
