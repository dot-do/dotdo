import { describe, it, expectTypeOf } from 'vitest'
import type { PipelinePromise } from '../../workflows/pipeline-promise'

/**
 * PipelinePromise Type Safety Tests (RED Phase)
 *
 * These tests verify that PipelinePromise preserves generic type safety.
 * Currently, the interface has `[key: string]: any` which breaks type safety
 * by allowing arbitrary property access.
 *
 * This is RED phase TDD - these tests define expected type behavior.
 * The tests should FAIL until the type is fixed.
 */

// ============================================================================
// 1. Generic Type Preservation Tests
// ============================================================================

describe('PipelinePromise Generic Type Preservation', () => {
  describe('basic generic types', () => {
    it('should preserve string generic type', () => {
      // PipelinePromise<string> should be assignable to PromiseLike<string>
      expectTypeOf<PipelinePromise<string>>().toMatchTypeOf<PromiseLike<string>>()
    })

    it('should preserve number generic type', () => {
      expectTypeOf<PipelinePromise<number>>().toMatchTypeOf<PromiseLike<number>>()
    })

    it('should preserve boolean generic type', () => {
      expectTypeOf<PipelinePromise<boolean>>().toMatchTypeOf<PromiseLike<boolean>>()
    })

    it('should preserve object generic type', () => {
      type User = { name: string; age: number }
      expectTypeOf<PipelinePromise<User>>().toMatchTypeOf<PromiseLike<User>>()
    })

    it('should preserve array generic type', () => {
      expectTypeOf<PipelinePromise<string[]>>().toMatchTypeOf<PromiseLike<string[]>>()
    })

    it('should preserve complex nested type', () => {
      type ComplexType = {
        users: Array<{ id: string; metadata: Record<string, unknown> }>
        count: number
      }
      expectTypeOf<PipelinePromise<ComplexType>>().toMatchTypeOf<PromiseLike<ComplexType>>()
    })
  })
})

// ============================================================================
// 2. Internal Property Access Tests
// ============================================================================

describe('PipelinePromise Internal Properties', () => {
  describe('__isPipelinePromise marker', () => {
    it('should have __isPipelinePromise property', () => {
      expectTypeOf<PipelinePromise<string>>().toHaveProperty('__isPipelinePromise')
    })

    it('should be readonly true', () => {
      expectTypeOf<PipelinePromise<string>['__isPipelinePromise']>().toEqualTypeOf<true>()
    })
  })

  describe('__expr property', () => {
    it('should have __expr property', () => {
      expectTypeOf<PipelinePromise<string>>().toHaveProperty('__expr')
    })
  })
})

// ============================================================================
// 3. Arbitrary Property Access Tests - These Should FAIL Currently
// ============================================================================

describe('PipelinePromise Type Safety - Arbitrary Property Access', () => {
  describe('disallow arbitrary property access', () => {
    it('should NOT allow arbitrary string property access', () => {
      // This test verifies the type safety hole
      // Currently: [key: string]: any allows this
      // Expected: arbitrary property access should error

      // We test by checking if accessing a non-existent property returns 'any'
      // If it returns 'any', type safety is broken
      type ArbitraryAccess = PipelinePromise<string>['nonExistentProperty']

      // This SHOULD fail - arbitrary access should not be 'any'
      // Currently this will PASS because of [key: string]: any
      expectTypeOf<ArbitraryAccess>().not.toBeAny()
    })

    it('should NOT allow random method call results to be any', () => {
      // Accessing a non-existent property should not return any
      type RandomProp = PipelinePromise<{ name: string }>['randomThing']

      // This should NOT be 'any' - should either error or be typed
      expectTypeOf<RandomProp>().not.toBeAny()
    })

    it('should preserve generic type when accessing then()', () => {
      // Verify then() returns correctly typed promise
      type ThenReturn = ReturnType<PipelinePromise<string>['then']>
      expectTypeOf<ThenReturn>().toMatchTypeOf<PromiseLike<unknown>>()
    })
  })

  describe('type narrowing should work', () => {
    it('should distinguish between different generic types', () => {
      // PipelinePromise<string> should not be assignable to PipelinePromise<number>
      // This verifies generic covariance works correctly
      expectTypeOf<PipelinePromise<string>>().not.toMatchTypeOf<PipelinePromise<number>>()
    })

    it('should not collapse object types due to index signature', () => {
      type UserPromise = PipelinePromise<{ name: string; age: number }>
      type PostPromise = PipelinePromise<{ title: string; body: string }>

      // These should be distinguishable types
      expectTypeOf<UserPromise>().not.toMatchTypeOf<PostPromise>()
    })
  })
})

// ============================================================================
// 4. PromiseLike Conformance Tests
// ============================================================================

describe('PipelinePromise PromiseLike Conformance', () => {
  it('should extend PromiseLike', () => {
    expectTypeOf<PipelinePromise<string>>().toMatchTypeOf<PromiseLike<string>>()
  })

  it('should have then method', () => {
    expectTypeOf<PipelinePromise<string>>().toHaveProperty('then')
  })

  it('should have correct then signature', () => {
    type ThenMethod = PipelinePromise<string>['then']
    expectTypeOf<ThenMethod>().toBeFunction()
  })
})

// ============================================================================
// 5. @ts-expect-error Tests - Compile Time Checks
// ============================================================================

describe('@ts-expect-error Type Tests', () => {
  it('documents the current type safety hole', () => {
    // This section documents the bug being fixed

    // Due to [key: string]: any, these assertions would compile:
    // declare const p: PipelinePromise<string>
    // const x: number = p.anything  // Currently compiles (BAD)
    // const y: string = p.whatever  // Currently compiles (BAD)

    // After fixing, arbitrary property access should cause type errors
    // @ts-expect-error - after fix, this should error
    type _shouldError = PipelinePromise<string>['notAProperty'] extends any ? 'broken' : 'fixed'

    // This test passes either way - it's documentation
    // The real verification is in the 'not.toBeAny()' tests above
  })
})

// ============================================================================
// 6. Export Verification
// ============================================================================

describe('PipelinePromise Export Verification', () => {
  it('should export PipelinePromise type', () => {
    // Type exists and is usable
    expectTypeOf<PipelinePromise<unknown>>().toBeObject()
  })

  it('should be generic', () => {
    // Verify different instantiations are different types
    type A = PipelinePromise<string>
    type B = PipelinePromise<number>

    // These types should be different
    expectTypeOf<A>().not.toEqualTypeOf<B>()
  })
})
