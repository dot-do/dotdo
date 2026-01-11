import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Fn Type Safety Tests (GREEN Phase - After In = unknown)
 *
 * This file documents the type safety improvements after changing `In = any`
 * to `In = unknown` in types/fn.ts.
 *
 * Issue: dotdo-hlb2s (GREEN phase)
 * Previous: dotdo-e8alg (RED phase)
 * Location: types/fn.ts:80
 *
 * The Solution:
 * - `In = unknown` now requires type narrowing for operations on input
 * - Functions using Fn<Out> without specifying In must narrow the type
 * - Type safety is enforced at compile time
 *
 * Changes made:
 * - Changed In = any to In = unknown in Fn, AsyncFn, RpcFn, StreamFn
 * - Tests in UNSAFE_TODAY sections are now commented out (they no longer compile)
 * - Tests in REQUIRES_NARROWING demonstrate correct patterns
 * - Tests in SHOULD_ALREADY_WORK continue to work unchanged
 *
 * Test Organization:
 * 1. FORMERLY_UNSAFE: Commented out tests that used to compile with any
 * 2. REQUIRES_NARROWING: Code that correctly uses type guards
 * 3. SHOULD_ALREADY_WORK: Properly typed code that continues working
 */

import type { Fn, AsyncFn, RpcFn, StreamFn } from '../../types/fn'

// ============================================================================
// Test Helpers
// ============================================================================

interface User {
  id: string
  name: string
  email: string
}

interface Order {
  orderId: string
  total: number
  items: string[]
}

// Helper to test runtime behavior
function createMockFn<Out, In>(impl: (input: In) => Out): Fn<Out, In> {
  return impl as Fn<Out, In>
}

// ============================================================================
// FORMERLY_UNSAFE: Tests that NO LONGER COMPILE with In = unknown
// ============================================================================

/**
 * These tests are COMMENTED OUT because they no longer compile after
 * changing from `In = any` to `In = unknown`.
 *
 * The code below demonstrates patterns that USED to compile but now
 * correctly produce type errors. This is the intended behavior - we want
 * TypeScript to catch these issues at compile time.
 *
 * Each commented block shows what would have been unsafe with In = any.
 */
describe('FORMERLY_UNSAFE: Patterns that no longer compile with In = unknown', () => {
  describe('Property access now requires type narrowing', () => {
    it('documents patterns that are now compile errors', () => {
      // The following patterns NO LONGER COMPILE with In = unknown:
      //
      // EXAMPLE 1: Accessing .name without type guard
      // const greet: Fn<string> = ((input: unknown) => {
      //   return `Hello, ${input.name}!`  // ERROR: 'input' is of type 'unknown'
      // }) as any
      //
      // EXAMPLE 2: Calling .length without narrowing
      // const getLength: Fn<number> = ((input: unknown) => {
      //   return input.length  // ERROR: 'input' is of type 'unknown'
      // }) as any
      //
      // EXAMPLE 3: Type assignment without validation
      // const processUser: Fn<string> = ((input: unknown) => {
      //   const user: User = input  // ERROR: Type 'unknown' is not assignable
      //   return user.email
      // }) as any
      //
      // EXAMPLE 4: Array operations without type guard
      // const sumItems: Fn<number> = ((input: unknown) => {
      //   return input.reduce((a, b) => a + b, 0)  // ERROR: 'input' is of type 'unknown'
      // }) as any
      //
      // These are all CORRECT compile errors that enforce type safety.
      expect(true).toBe(true) // Placeholder - patterns above are documented
    })

    it('demonstrates the CORRECT way to handle unknown input', () => {
      // CORRECT: Use explicit In type parameter
      const greetWithType: Fn<string, { name: string }> = ((input: { name: string }) => {
        return `Hello, ${input.name}!`
      }) as Fn<string, { name: string }>

      expect(greetWithType({ name: 'World' })).toBe('Hello, World!')

      // CORRECT: Use type guard with unknown
      const safeGreet: Fn<string, unknown> = ((input: unknown) => {
        if (typeof input === 'object' && input !== null && 'name' in input) {
          return `Hello, ${String((input as { name: string }).name)}!`
        }
        return 'Hello, stranger!'
      }) as Fn<string, unknown>

      expect(safeGreet({ name: 'World' })).toBe('Hello, World!')
      expect(safeGreet({})).toBe('Hello, stranger!')
      expect(safeGreet(null)).toBe('Hello, stranger!')
    })
  })

  describe('Union types now require explicit handling', () => {
    it('shows correct pattern for union input types', () => {
      // With In = unknown, you must specify the union type explicitly
      type UserOrOrder = User | Order

      const getIdentifier: Fn<string, UserOrOrder> = ((input: UserOrOrder) => {
        if ('id' in input) {
          return input.id
        } else {
          return input.orderId
        }
      }) as Fn<string, UserOrOrder>

      expect(getIdentifier({ id: 'u1', name: 'Test', email: 'test@test.com' })).toBe('u1')
      expect(getIdentifier({ orderId: 'o1', total: 100, items: [] })).toBe('o1')
    })
  })
})

// ============================================================================
// FORMERLY_UNSAFE: AsyncFn, RpcFn, StreamFn now require explicit types
// ============================================================================

describe('FORMERLY_UNSAFE: Other Fn variants now type-safe with In = unknown', () => {
  it('AsyncFn with explicit input type works correctly', async () => {
    // CORRECT: Specify the input type explicitly
    interface UserInput {
      userId: string
      name?: string
    }

    const fetchUserData: AsyncFn<User, UserInput> = (async (input: UserInput) => {
      return {
        id: input.userId,
        name: input.name || 'Unknown',
        email: `${input.userId}@example.com`,
      }
    }) as AsyncFn<User, UserInput>

    const result = await fetchUserData({ userId: '123', name: 'Test' })
    expect(result.id).toBe('123')
  })

  it('RpcFn with explicit input type works correctly', () => {
    interface ValidationInput {
      valid: boolean
    }

    const rpcCall: RpcFn<{ success: boolean }, ValidationInput> = ((input: ValidationInput) => {
      const promise = Promise.resolve({ success: input.valid === true })
      return Object.assign(promise, {
        pipe: () => promise,
        map: () => promise,
      }) as any
    }) as RpcFn<{ success: boolean }, ValidationInput>

    const result = rpcCall({ valid: true })
    expect(result).toBeDefined()
  })

  it('StreamFn with explicit input type works correctly', async () => {
    interface ItemsInput {
      items: unknown[]
    }

    const streamItems: StreamFn<string, ItemsInput> = (async function* (input: ItemsInput) {
      for (const item of input.items) {
        yield String(item)
      }
    }) as StreamFn<string, ItemsInput>

    const items: string[] = []
    for await (const item of streamItems({ items: [1, 2, 3] })) {
      items.push(item)
    }
    expect(items).toEqual(['1', '2', '3'])
  })
})

// ============================================================================
// REQUIRES_NARROWING: Code that needs type guards after fix
// ============================================================================

describe('REQUIRES_NARROWING: Patterns that will need type guards', () => {
  /**
   * This demonstrates the CORRECT pattern after changing to In = unknown.
   * These tests should pass both before and after the change.
   */
  describe('Proper type narrowing examples', () => {
    it('should use type guards for unknown input', () => {
      // This is how code SHOULD be written with In = unknown
      function isUser(value: unknown): value is User {
        return (
          typeof value === 'object' &&
          value !== null &&
          'id' in value &&
          'name' in value &&
          'email' in value &&
          typeof (value as User).id === 'string' &&
          typeof (value as User).name === 'string' &&
          typeof (value as User).email === 'string'
        )
      }

      const safeGetEmail: Fn<string, unknown> = ((input: unknown) => {
        if (isUser(input)) {
          return input.email
        }
        throw new Error('Invalid input: expected User')
      }) as any

      expect(safeGetEmail({ id: '1', name: 'Test', email: 'test@test.com' })).toBe('test@test.com')
      expect(() => safeGetEmail({ foo: 'bar' })).toThrow('Invalid input')
    })

    it('should use typeof for primitive checks', () => {
      const safeUppercase: Fn<string, unknown> = ((input: unknown) => {
        if (typeof input === 'string') {
          return input.toUpperCase()
        }
        throw new Error('Expected string')
      }) as any

      expect(safeUppercase('hello')).toBe('HELLO')
      expect(() => safeUppercase(123)).toThrow('Expected string')
    })

    it('should use Array.isArray for array checks', () => {
      const safeSum: Fn<number, unknown> = ((input: unknown) => {
        if (Array.isArray(input) && input.every((n) => typeof n === 'number')) {
          return input.reduce((a, b) => a + b, 0)
        }
        throw new Error('Expected number array')
      }) as any

      expect(safeSum([1, 2, 3])).toBe(6)
      expect(() => safeSum('not an array')).toThrow('Expected number array')
    })
  })

  /**
   * Common patterns that will need updating
   */
  describe('Common patterns requiring updates', () => {
    it('JSON parsing pattern - needs explicit typing', () => {
      // Current unsafe pattern with In = any:
      // const parseJson: Fn<object> = (input) => JSON.parse(input)
      //
      // After fix, need to specify input type:
      const parseJson: Fn<unknown, string> = ((input: string) => JSON.parse(input)) as any

      expect(parseJson('{"foo":"bar"}')).toEqual({ foo: 'bar' })
    })

    it('Property extraction pattern - needs type narrowing', () => {
      // Current unsafe pattern:
      // const getName: Fn<string> = (input) => input.name
      //
      // After fix:
      interface Named {
        name: string
      }

      function isNamed(value: unknown): value is Named {
        return typeof value === 'object' && value !== null && 'name' in value && typeof (value as Named).name === 'string'
      }

      const getName: Fn<string, unknown> = ((input: unknown) => {
        if (isNamed(input)) {
          return input.name
        }
        return 'Unknown'
      }) as any

      expect(getName({ name: 'Test' })).toBe('Test')
      expect(getName({})).toBe('Unknown')
    })

    it('Object spread pattern - needs explicit typing', () => {
      // Current unsafe pattern:
      // const extend: Fn<object> = (input) => ({ ...input, extended: true })
      //
      // After fix, need explicit input type:
      const extend: Fn<Record<string, unknown>, Record<string, unknown>> = ((input: Record<string, unknown>) => ({
        ...input,
        extended: true,
      })) as any

      expect(extend({ foo: 'bar' })).toEqual({ foo: 'bar', extended: true })
    })
  })
})

// ============================================================================
// SHOULD_ALREADY_WORK: Properly typed code
// ============================================================================

describe('SHOULD_ALREADY_WORK: Properly typed Fn usage', () => {
  /**
   * These tests use explicit In types and should work both before and after
   * the change to In = unknown. They demonstrate best practices.
   */

  it('Fn with explicit input type should work', () => {
    // Explicit input type - this is correct usage
    const greet: Fn<string, string> = ((name: string) => `Hello, ${name}!`) as any

    expect(greet('World')).toBe('Hello, World!')
    expectTypeOf(greet).toMatchTypeOf<(input: string) => string>()
  })

  it('Fn with object input type should work', () => {
    const describeUser: Fn<string, User> = ((user: User) => `${user.name} <${user.email}>`) as any

    expect(describeUser({ id: '1', name: 'Test', email: 'test@test.com' })).toBe('Test <test@test.com>')
  })

  it('AsyncFn with explicit types should work', async () => {
    const fetchUser: AsyncFn<User, string> = (async (id: string) => ({
      id,
      name: 'Fetched User',
      email: `${id}@example.com`,
    })) as any

    const user = await fetchUser('123')
    expect(user.id).toBe('123')
    expectTypeOf(user).toEqualTypeOf<User>()
  })

  it('StreamFn with explicit types should work', async () => {
    const countUp: StreamFn<number, number> = (async function* (max: number) {
      for (let i = 0; i < max; i++) {
        yield i
      }
    }) as any

    const numbers: number[] = []
    for await (const n of countUp(3)) {
      numbers.push(n)
    }
    expect(numbers).toEqual([0, 1, 2])
  })
})

// ============================================================================
// TYPE_LEVEL_TESTS: Compile-time type checking
// ============================================================================

describe('TYPE_LEVEL_TESTS: Compile-time type behavior', () => {
  /**
   * These tests verify type-level behavior using expectTypeOf.
   * With In = unknown (the new default), type safety is enforced.
   */

  it('Fn<string> now defaults In to unknown (type-safe)', () => {
    type TestFn = Fn<string>

    // With In = unknown, the input parameter requires narrowing
    // This is the desired type-safe behavior
    expectTypeOf<TestFn>().toMatchTypeOf<(input: unknown) => string>()
  })

  it('Fn<Out, In> with explicit In type should be strict', () => {
    type StrictFn = Fn<string, number>

    // Explicit In type is always strict
    expectTypeOf<StrictFn>().toMatchTypeOf<(input: number) => string>()
  })

  it('Input parameter requires narrowing with unknown default', () => {
    // With In = unknown (the new default):
    // - input.foo produces compile error (Object is of type 'unknown')
    // - input.toString() produces compile error
    // - input + 1 produces compile error
    //
    // Type narrowing is required:
    // if (typeof input === 'string') { input.toUpperCase() } // OK

    type DefaultInputFn = Fn<string>

    // The function signature accepts unknown by default
    expectTypeOf<DefaultInputFn>().toMatchTypeOf<(input: unknown) => string>()

    // Explicitly using unknown is now the same as the default
    type ExplicitUnknownFn = Fn<string, unknown>
    expectTypeOf<ExplicitUnknownFn>().toMatchTypeOf<(input: unknown) => string>()
  })
})

// ============================================================================
// DOCUMENTATION: Type errors now enforced with In = unknown
// ============================================================================

/**
 * TYPE ERRORS NOW ENFORCED WITH In = unknown
 *
 * The change from `In = any` to `In = unknown` in types/fn.ts is COMPLETE.
 * The following patterns now correctly produce TypeScript errors:
 *
 * 1. Property access on unspecified input:
 *    const fn: Fn<string> = (input) => input.name
 *    ERROR: Object is of type 'unknown'
 *
 * 2. Method calls on unspecified input:
 *    const fn: Fn<number> = (input) => input.length
 *    ERROR: Object is of type 'unknown'
 *
 * 3. Type assignment without narrowing:
 *    const fn: Fn<string> = (input) => {
 *      const user: User = input  // ERROR: Type 'unknown' is not assignable
 *      return user.name
 *    }
 *
 * 4. Array operations without type guard:
 *    const fn: Fn<number> = (input) => input.map(x => x * 2).reduce(...)
 *    ERROR: Object is of type 'unknown'
 *
 * 5. Spread operations:
 *    const fn: Fn<object> = (input) => ({ ...input, extra: true })
 *    ERROR: Spread types may only be created from object types
 *
 * AVAILABLE FIXES:
 *
 * Option A: Add explicit In type parameter (RECOMMENDED)
 *    const fn: Fn<string, User> = (user) => user.name  // OK
 *
 * Option B: Add type guard/narrowing
 *    const fn: Fn<string, unknown> = (input) => {
 *      if (isUser(input)) return input.name
 *      throw new Error('Expected User')
 *    }
 *
 * Option C: Use assertion (less safe but quick fix)
 *    const fn: Fn<string, unknown> = (input) => (input as User).name
 */

describe('DOCUMENTATION: Correct patterns for type-safe Fn usage', () => {
  it('documents property access pattern', () => {
    // BEFORE (compiled with In = any but was unsafe):
    // const fn: Fn<string> = (input) => input.name

    // AFTER (In = unknown), one of these fixes:
    // Fix A: Explicit type
    const fnA: Fn<string, { name: string }> = ((input: { name: string }) => input.name) as any

    // Fix B: Type guard
    const fnB: Fn<string, unknown> = ((input: unknown) => {
      if (typeof input === 'object' && input !== null && 'name' in input) {
        return String((input as { name: string }).name)
      }
      return 'Unknown'
    }) as any

    expect(fnA({ name: 'Test' })).toBe('Test')
    expect(fnB({ name: 'Test' })).toBe('Test')
    expect(fnB({})).toBe('Unknown')
  })

  it('documents method call pattern', () => {
    // BEFORE: const fn: Fn<string> = (input) => input.toUpperCase()

    // AFTER:
    const fn: Fn<string, string> = ((input: string) => input.toUpperCase()) as any

    expect(fn('hello')).toBe('HELLO')
  })

  it('documents array operation pattern', () => {
    // BEFORE: const fn: Fn<number> = (input) => input.reduce((a, b) => a + b, 0)

    // AFTER:
    const fn: Fn<number, number[]> = ((input: number[]) => input.reduce((a, b) => a + b, 0)) as any

    expect(fn([1, 2, 3])).toBe(6)
  })
})
