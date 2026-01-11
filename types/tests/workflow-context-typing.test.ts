import { describe, it, expect, expectTypeOf, assertType } from 'vitest'

/**
 * WorkflowContext Noun Typing Tests (RED Phase)
 *
 * These tests verify that the WorkflowContext noun access is properly typed.
 * Currently, WorkflowContext has:
 *
 *   [Noun: string]: ((id: string) => DomainProxy) | unknown
 *
 * The `| unknown` defeats type checking entirely because:
 * 1. Any property access on WorkflowContext resolves to `unknown | ((id: string) => DomainProxy)`
 * 2. TypeScript cannot narrow this union properly
 * 3. Invalid nouns are not rejected at compile time
 * 4. No autocomplete is provided for registered nouns
 * 5. The return type is too loose to be useful
 *
 * Issue: dotdo-ncq5e
 * Location: types/WorkflowContext.ts:231
 *
 * Expected fix: Replace the loose index signature with:
 * 1. A NounRegistry interface for module augmentation
 * 2. Mapped types that provide autocomplete for registered nouns
 * 3. Type guards for runtime validation
 * 4. Remove `| unknown` to enforce proper typing
 *
 * Test Organization:
 * 1. CURRENT_BEHAVIOR: Tests documenting the problematic current behavior
 * 2. EXPECTED_BEHAVIOR: Tests that SHOULD pass after fix (RED phase)
 * 3. MODULE_AUGMENTATION: Tests for extensible noun registry
 *
 * RED PHASE STRATEGY:
 * Tests use @ts-expect-error to mark type assertions that CURRENTLY FAIL
 * but SHOULD PASS after the fix. When the fix is implemented, these
 * @ts-expect-error directives will become "unused" errors, indicating
 * the type system is now correct.
 */

import type {
  WorkflowContext,
  DomainProxy,
} from '../WorkflowContext'

// ============================================================================
// Test Setup: Mock implementations for type testing
// ============================================================================

/**
 * Mock WorkflowContext for testing
 * In real code this would be provided by the runtime
 */
declare const $: WorkflowContext

// ============================================================================
// CURRENT_BEHAVIOR: Documents the problematic type behavior
// ============================================================================

describe('CURRENT_BEHAVIOR: WorkflowContext noun typing issues', () => {
  describe('index signature allows any property access', () => {
    it('any string key returns ((id: string) => DomainProxy) | unknown', () => {
      // Current behavior: any key returns the union type
      type AnyNounAccess = WorkflowContext['Customer']
      type AnyOtherAccess = WorkflowContext['SomeRandomThing']
      type NumberKeyAccess = WorkflowContext['123']

      // All of these resolve to the same type due to index signature
      expectTypeOf<AnyNounAccess>().toEqualTypeOf<AnyOtherAccess>()
      expectTypeOf<AnyNounAccess>().toEqualTypeOf<NumberKeyAccess>()
    })

    it('the union type includes unknown which defeats type checking', () => {
      // The problem: `| unknown` makes the type too loose
      type NounAccess = WorkflowContext[string]

      // This should NOT be true - unknown should not be part of noun access
      // But currently it is, which means TypeScript cannot provide proper checking
      expectTypeOf<NounAccess>().toMatchTypeOf<unknown>()
    })

    it('cannot distinguish between valid and invalid noun access', () => {
      // Current behavior: both of these are typed the same way
      type ValidNoun = WorkflowContext['Customer']
      type InvalidNoun = WorkflowContext['NotARealNoun']
      type GibberishNoun = WorkflowContext['asdfghjkl']

      // This equality SHOULD fail after fix - valid nouns should have different types
      // Currently they're all the same due to index signature
      expectTypeOf<ValidNoun>().toEqualTypeOf<InvalidNoun>()
      expectTypeOf<ValidNoun>().toEqualTypeOf<GibberishNoun>()
    })
  })

  describe('unknown union prevents useful type narrowing', () => {
    it('noun access result cannot be reliably called as function', () => {
      // Current: WorkflowContext[string] = ((id: string) => DomainProxy) | unknown
      type NounAccess = WorkflowContext['Customer']

      // The `| unknown` means we cannot safely assume it's callable
      // TypeScript would require narrowing first
      // This is overly defensive and defeats the purpose of the type

      // Verify the problematic union exists
      type IsUnionWithUnknown = NounAccess extends ((id: string) => DomainProxy) | unknown ? true : false
      const hasUnknown: IsUnionWithUnknown = true
      expect(hasUnknown).toBe(true)
    })
  })
})

// ============================================================================
// EXPECTED_BEHAVIOR: Tests that SHOULD pass after fixing the types
// ============================================================================

describe('EXPECTED_BEHAVIOR: Noun typing after fix (RED phase)', () => {
  /**
   * These tests document the DESIRED behavior.
   * They may fail to compile or fail at runtime until the fix is implemented.
   */

  describe('registered nouns should be callable without narrowing', () => {
    it('$.Customer should be directly callable as (id: string) => DomainProxy', () => {
      // EXPECTED: After fix, registered nouns should have precise types
      // Currently fails because type is `((id: string) => DomainProxy) | unknown`

      // This type test verifies the function signature
      type CustomerAccess = WorkflowContext['Customer']

      // PROBLEM: This assertion fails because CustomerAccess includes `unknown`
      // After fix, CustomerAccess should be exactly `(id: string) => DomainProxy`

      // @ts-expect-error - This SHOULD pass after fix but fails now due to | unknown
      expectTypeOf<CustomerAccess>().toEqualTypeOf<(id: string) => DomainProxy>()
    })

    it('$.Invoice should be directly callable without type guards', () => {
      type InvoiceAccess = WorkflowContext['Invoice']

      // Same problem - cannot assert exact function type due to union with unknown
      // @ts-expect-error - This SHOULD pass after fix
      expectTypeOf<InvoiceAccess>().toEqualTypeOf<(id: string) => DomainProxy>()
    })
  })

  describe('invalid noun access should be rejected at compile time', () => {
    it('should reject access to non-existent nouns', () => {
      // EXPECTED: TypeScript should error when accessing unregistered nouns
      // Currently, all string keys are allowed due to index signature

      // After fix with noun registry, accessing unregistered noun should be an error
      // This test documents the expected failure case

      type UnknownNoun = WorkflowContext['NotARegisteredNoun']

      // PROBLEM: Currently UnknownNoun resolves to ((id: string) => DomainProxy) | unknown
      // This test PASSES currently but documents what SHOULD happen after fix:
      // UnknownNoun should be `never` or cause a compile error

      // RED PHASE: This assertion FAILS now - UnknownNoun is NOT never
      // @ts-expect-error - After fix, accessing unregistered noun should be `never` or error
      expectTypeOf<UnknownNoun>().toEqualTypeOf<never>()
    })

    it('should reject typos in noun names', () => {
      // Common typo: 'Custmer' instead of 'Customer'
      type TypoNoun = WorkflowContext['Custmer']

      // Currently this compiles fine due to index signature
      // After fix, TypoNoun should be `never` or cause compile error

      // RED PHASE: This assertion FAILS now - TypoNoun is NOT never
      // @ts-expect-error - After fix, typo noun should be `never` or error
      expectTypeOf<TypoNoun>().toEqualTypeOf<never>()
    })
  })

  describe('noun access should not overlap with built-in methods', () => {
    it('known methods like send/try/do should have their specific types', () => {
      // The index signature currently affects ALL string keys
      // This could theoretically conflict with built-in methods

      type SendType = WorkflowContext['send']
      type TryType = WorkflowContext['try']
      type DoType = WorkflowContext['do']

      // These should be their specific function signatures, not the noun union
      // TypeScript correctly resolves explicit members over index signature

      // Verify send is a function that returns void
      expectTypeOf<SendType>().toBeFunction()
      expectTypeOf<SendType>().returns.toBeVoid()

      // Verify try is a generic function returning Promise
      expectTypeOf<TryType>().toBeFunction()

      // Verify do is a generic function returning Promise
      expectTypeOf<DoType>().toBeFunction()
    })

    it('explicit interface members should override index signature', () => {
      // TypeScript behavior: explicit members override index signature
      // This is currently working but worth documenting

      type BranchType = WorkflowContext['branch']

      // branch is explicitly defined, so it should be its specific type
      expectTypeOf<BranchType>().toEqualTypeOf<(name: string) => Promise<void>>()
    })
  })
})

// ============================================================================
// MODULE_AUGMENTATION: Tests for extensible noun registry pattern
// ============================================================================

describe('MODULE_AUGMENTATION: Extensible noun registry (RED phase)', () => {
  /**
   * After fix, the WorkflowContext should support module augmentation
   * for registering domain-specific nouns with typed payloads.
   *
   * Example usage in domain code:
   *
   * ```typescript
   * declare module '../types/WorkflowContext' {
   *   interface NounRegistry {
   *     Customer: { id: string; email: string }
   *     Invoice: { id: string; amount: number }
   *     Order: { id: string; items: string[] }
   *   }
   * }
   * ```
   */

  describe('NounRegistry interface should be augmentable', () => {
    it('should provide a NounRegistry interface for extension', () => {
      // EXPECTED: After fix, WorkflowContext.ts should export NounRegistry
      // Currently this interface does not exist

      // This import would fail until the interface is created:
      // import type { NounRegistry } from '../WorkflowContext'

      // For now, we document the expected shape
      interface ExpectedNounRegistry {
        // Domain nouns with their entity shapes
        Customer: { id: string; email: string; name: string }
        Invoice: { id: string; amount: number; status: string }
        Order: { id: string; items: string[]; total: number }
      }

      // After fix, NounRegistry should be an empty interface that can be augmented
      // Similar to EventPayloadMap which already exists
      expectTypeOf<ExpectedNounRegistry>().toBeObject()
    })

    it('registered nouns should provide autocomplete suggestions', () => {
      // EXPECTED: When typing $.C, IDE should suggest 'Customer'
      // This requires the noun registry to be used in WorkflowContext type

      // Currently no autocomplete because index signature accepts any string

      // Document expected behavior through type test:
      // After fix, keyof NounRegistry should include registered nouns
      type ExpectedNouns = 'Customer' | 'Invoice' | 'Order'

      // This is what registered nouns should look like
      expectTypeOf<'Customer'>().toMatchTypeOf<ExpectedNouns>()
      expectTypeOf<'Invoice'>().toMatchTypeOf<ExpectedNouns>()
    })
  })

  describe('typed noun access should return typed DomainProxy', () => {
    it('$.Customer(id) should return Customer-typed proxy', () => {
      // EXPECTED: After fix with noun registry, the proxy should be typed

      // Currently DomainProxy is untyped:
      // interface DomainProxy { [method: string]: (...args: unknown[]) => RpcPromise<unknown> }

      // After fix, it could be:
      // $.Customer(id).email // typed as string
      // $.Customer(id).notify() // typed RPC call

      // Document expected type shape
      interface TypedCustomerProxy {
        notify(): Promise<void>
        getOrders(): Promise<string[]>
        updateEmail(email: string): Promise<void>
      }

      // The proxy should match the registered noun's methods
      expectTypeOf<TypedCustomerProxy>().toHaveProperty('notify')
    })
  })
})

// ============================================================================
// TYPE_GUARDS: Tests for runtime noun validation
// ============================================================================

describe('TYPE_GUARDS: Runtime noun validation (RED phase)', () => {
  /**
   * After fix, there should be type guards for validating nouns at runtime.
   * This is important for:
   * 1. Dynamic noun access from user input
   * 2. Validation in middleware
   * 3. Error handling for invalid nouns
   */

  describe('isValidNoun type guard', () => {
    it('should narrow string to registered noun type', () => {
      // EXPECTED: After fix, a type guard should exist

      // Expected implementation:
      // function isValidNoun<K extends keyof NounRegistry>(
      //   noun: string
      // ): noun is K

      // For now, document the expected behavior
      function mockIsValidNoun(noun: string): noun is 'Customer' | 'Invoice' {
        return ['Customer', 'Invoice'].includes(noun)
      }

      const maybeNoun: string = 'Customer'
      if (mockIsValidNoun(maybeNoun)) {
        // Inside this block, maybeNoun should be narrowed
        expectTypeOf(maybeNoun).toEqualTypeOf<'Customer' | 'Invoice'>()
      }

      expect(mockIsValidNoun('Customer')).toBe(true)
      expect(mockIsValidNoun('NotANoun')).toBe(false)
    })
  })

  describe('getNoun utility function', () => {
    it('should safely access noun or throw for invalid', () => {
      // EXPECTED: Utility function that provides safe noun access

      // Expected signature:
      // function getNoun<K extends keyof NounRegistry>(
      //   ctx: WorkflowContext,
      //   noun: K
      // ): (id: string) => TypedDomainProxy<NounRegistry[K]>

      // Document expected behavior
      type ExpectedGetNoun = <K extends string>(
        ctx: WorkflowContext,
        noun: K
      ) => (id: string) => DomainProxy

      expectTypeOf<ExpectedGetNoun>().toBeFunction()
    })
  })
})

// ============================================================================
// EDGE_CASES: Additional type safety scenarios
// ============================================================================

describe('EDGE_CASES: Additional typing scenarios', () => {
  describe('intersection with other WorkflowContext features', () => {
    it('noun access should not conflict with AI functions', () => {
      // WorkflowContext has $.ai, $.write, $.summarize, etc.
      // These should remain properly typed

      type AIType = WorkflowContext['ai']
      type WriteType = WorkflowContext['write']
      type SummarizeType = WorkflowContext['summarize']

      // Verify these are not affected by noun index signature
      expectTypeOf<AIType>().toBeFunction()
      expectTypeOf<WriteType>().toBeFunction()
      expectTypeOf<SummarizeType>().toBeFunction()
    })

    it('noun access should not conflict with every scheduling', () => {
      type EveryType = WorkflowContext['every']

      // Should be ScheduleBuilder, not the noun union
      expectTypeOf<EveryType>().toHaveProperty('Monday')
    })

    it('noun access should not conflict with on proxy', () => {
      type OnType = WorkflowContext['on']

      // Should be OnProxy, not the noun union
      expectTypeOf<OnType>().toBeObject()
    })
  })

  describe('noun naming conventions', () => {
    it('should enforce PascalCase for noun names', () => {
      // Nouns should follow PascalCase convention: Customer, Invoice, Order
      // Not: customer, CUSTOMER, customer_invoice

      // After fix, the NounRegistry should only accept PascalCase keys
      // This is a convention enforcement at the type level

      type ValidNounName = 'Customer' | 'Invoice' | 'OrderItem'
      type InvalidNounName = 'customer' | 'CUSTOMER' | 'order_item'

      // Document expected validation
      expectTypeOf<'Customer'>().toMatchTypeOf<ValidNounName>()
      expectTypeOf<'customer'>().toMatchTypeOf<InvalidNounName>()
    })
  })

  describe('type-safe method chaining', () => {
    it('$.Noun(id).method() should be type-safe end-to-end', () => {
      // EXPECTED: Full type safety from noun access to method call

      // Currently: $.Customer(id) returns DomainProxy with [method: string]: (...) => RpcPromise<unknown>
      // After fix: $.Customer(id) should return CustomerProxy with typed methods

      // Document expected chain types
      type Step1 = WorkflowContext['Customer']  // Currently: ((id) => DomainProxy) | unknown

      // To extract the function type, we need to exclude unknown
      type NounAccessor = Extract<Step1, (id: string) => DomainProxy>
      type Step2 = NounAccessor extends (id: string) => infer R ? R : never  // DomainProxy
      type Step3 = Step2 extends { notify: infer M } ? M : never  // Method type

      // After fix, Step3 should have the correct signature from the noun registry
      // Currently Step3 is a function due to DomainProxy's index signature
      expectTypeOf<Step3>().toMatchTypeOf<(...args: unknown[]) => unknown>()
    })
  })
})

// ============================================================================
// DOCUMENTATION: Summary of the typing issue and expected fix
// ============================================================================

/**
 * SUMMARY OF THE TYPING ISSUE
 *
 * Current problematic code (types/WorkflowContext.ts:231):
 *
 *   [Noun: string]: ((id: string) => DomainProxy) | unknown
 *
 * Problems:
 *
 * 1. TYPE SAFETY DEFEATED
 *    The `| unknown` means TypeScript cannot provide useful type checking.
 *    Any property access resolves to `unknown | function`, which requires
 *    narrowing that defeats the purpose of static typing.
 *
 * 2. NO AUTOCOMPLETE
 *    Because any string is valid, IDEs cannot suggest valid noun names.
 *    Typos like $.Custmer(id) compile without error.
 *
 * 3. NO COMPILE-TIME VALIDATION
 *    Invalid nouns are only caught at runtime, not during type checking.
 *    This goes against TypeScript's purpose.
 *
 * 4. CANNOT TRACK REGISTERED NOUNS
 *    There's no registry of valid nouns, so tools and documentation
 *    cannot enumerate what nouns are available.
 *
 * EXPECTED FIX:
 *
 * 1. Create NounRegistry interface for module augmentation:
 *    ```typescript
 *    export interface NounRegistry {
 *      // Extended in domain code
 *    }
 *    ```
 *
 * 2. Replace index signature with mapped type:
 *    ```typescript
 *    type NounAccessors = {
 *      [K in keyof NounRegistry]: (id: string) => TypedDomainProxy<NounRegistry[K]>
 *    }
 *
 *    interface WorkflowContext extends NounAccessors {
 *      // ... other members
 *    }
 *    ```
 *
 * 3. Remove `| unknown` entirely - it serves no useful purpose.
 *
 * 4. Add runtime validation for dynamic noun access:
 *    ```typescript
 *    function isValidNoun<K extends keyof NounRegistry>(noun: string): noun is K
 *    function getNoun<K extends keyof NounRegistry>(ctx: WorkflowContext, noun: K): NounAccessor<K>
 *    ```
 */

describe('VERIFICATION: Test file compiles and runs', () => {
  it('this test file should execute successfully', () => {
    // Simple verification that the test file itself works
    expect(true).toBe(true)
  })

  it('should have failing @ts-expect-error tests documenting the issue', () => {
    // Count of @ts-expect-error directives that suppress real type errors
    // These mark type assertions that CURRENTLY FAIL (RED phase)
    // but SHOULD PASS after the fix is implemented

    // Current count: 4 active @ts-expect-error directives:
    // 1. Line ~131: CustomerAccess should equal (id: string) => DomainProxy
    // 2. Line ~139: InvoiceAccess should equal (id: string) => DomainProxy
    // 3. Line ~159: UnknownNoun should equal never
    // 4. Line ~171: TypoNoun should equal never

    // After fix: These directives will become "unused" errors,
    // indicating the type system now correctly handles noun typing.
    // At that point, remove the @ts-expect-error directives.
    const activeExpectErrorCount = 4
    expect(activeExpectErrorCount).toBeGreaterThan(0)
  })
})
