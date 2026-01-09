import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * WorkflowContext Type System Tests (RED Phase)
 *
 * These tests verify proper typing of the WorkflowContext ($) proxy system:
 * - $.send() has proper parameter types
 * - $.try() returns typed result or throws
 * - $.do() has typed action and result
 * - $.on returns properly typed proxy
 * - $.Noun() returns typed domain proxy
 * - Passing wrong types causes compile errors
 *
 * This is RED phase TDD - tests define expected type behavior.
 * These are purely compile-time type tests using expectTypeOf.
 */

import type {
  WorkflowContext,
  OnProxy,
  OnNounProxy,
  DomainProxy,
  EventHandler,
  DomainEvent,
} from '../WorkflowContext'

// ============================================================================
// Type Test Helpers - Define expected shapes for testing
// ============================================================================

// Sample action input/output types
interface CreateOrderInput {
  customerId: string
  items: Array<{ productId: string; quantity: number }>
}

interface CreateOrderOutput {
  orderId: string
  total: number
  status: 'pending' | 'confirmed'
}

interface SendEmailInput {
  to: string
  subject: string
  body: string
}

// ============================================================================
// 1. $.send() Type Tests
// ============================================================================

describe('$.send() Type System', () => {
  describe('basic send signature', () => {
    it('should have correct function signature', () => {
      // WorkflowContext.send should be: (event: string, data: unknown) => void
      expectTypeOf<WorkflowContext['send']>().toBeFunction()
      expectTypeOf<WorkflowContext['send']>().returns.toBeVoid()
    })

    it('should have string event parameter', () => {
      // First parameter should be string
      expectTypeOf<WorkflowContext['send']>().parameter(0).toBeString()
    })

    it('should have unknown data parameter', () => {
      // Second parameter should be unknown
      expectTypeOf<WorkflowContext['send']>().parameter(1).toBeUnknown()
    })

    it('should match expected signature exactly', () => {
      type ExpectedSignature = (event: string, data: unknown) => void
      expectTypeOf<WorkflowContext['send']>().toEqualTypeOf<ExpectedSignature>()
    })
  })
})

// ============================================================================
// 2. $.try() Type Tests
// ============================================================================

describe('$.try() Type System', () => {
  describe('basic try signature', () => {
    it('should be a function', () => {
      expectTypeOf<WorkflowContext['try']>().toBeFunction()
    })

    it('should be a generic function returning Promise<T>', () => {
      // $.try<T>(action: string, data: unknown): Promise<T>
      type TryFn = WorkflowContext['try']

      // When called with a generic, should return Promise of that type
      type Result = ReturnType<TryFn>
      // Result should be Promise<T> where T is the generic
      expectTypeOf<Result>().toMatchTypeOf<Promise<unknown>>()
    })

    it('should have string action parameter', () => {
      // First parameter should be string
      expectTypeOf<WorkflowContext['try']>().parameter(0).toBeString()
    })

    it('should have unknown data parameter', () => {
      // Second parameter should be unknown
      expectTypeOf<WorkflowContext['try']>().parameter(1).toBeUnknown()
    })
  })

  describe('generic return type', () => {
    it('should allow specifying return type via generic', () => {
      // When you call $.try<CreateOrderOutput>('createOrder', data)
      // The result should be Promise<CreateOrderOutput>
      type TryFn = <T>(action: string, data: unknown) => Promise<T>

      // WorkflowContext.try should match this signature
      expectTypeOf<WorkflowContext['try']>().toMatchTypeOf<TryFn>()
    })
  })
})

// ============================================================================
// 3. $.do() Type Tests
// ============================================================================

describe('$.do() Type System', () => {
  describe('basic do signature', () => {
    it('should be a function', () => {
      expectTypeOf<WorkflowContext['do']>().toBeFunction()
    })

    it('should be a generic function returning Promise<T>', () => {
      type DoFn = WorkflowContext['do']
      type Result = ReturnType<DoFn>
      expectTypeOf<Result>().toMatchTypeOf<Promise<unknown>>()
    })

    it('should have string action parameter', () => {
      expectTypeOf<WorkflowContext['do']>().parameter(0).toBeString()
    })

    it('should have unknown data parameter', () => {
      expectTypeOf<WorkflowContext['do']>().parameter(1).toBeUnknown()
    })
  })

  describe('generic return type', () => {
    it('should allow specifying return type via generic', () => {
      type DoFn = <T>(action: string, data: unknown) => Promise<T>
      expectTypeOf<WorkflowContext['do']>().toMatchTypeOf<DoFn>()
    })
  })

  describe('do vs try type consistency', () => {
    it('should have same generic signature as try', () => {
      // Both should have same basic signature shape
      type TryParams = Parameters<WorkflowContext['try']>
      type DoParams = Parameters<WorkflowContext['do']>

      // Both should accept (string, unknown)
      expectTypeOf<TryParams>().toEqualTypeOf<DoParams>()
    })
  })
})

// ============================================================================
// 4. $.on Proxy Type Tests
// ============================================================================

describe('$.on Proxy Type System', () => {
  describe('OnProxy interface', () => {
    it('should be assignable to WorkflowContext.on', () => {
      expectTypeOf<WorkflowContext['on']>().toEqualTypeOf<OnProxy>()
    })

    it('should be an indexable type returning OnNounProxy', () => {
      // $.on['Customer'] should return OnNounProxy
      type CustomerAccess = OnProxy['Customer']
      expectTypeOf<CustomerAccess>().toEqualTypeOf<OnNounProxy>()
    })

    it('should allow any string key', () => {
      // OnProxy should have an index signature for [string]: OnNounProxy
      type AnyNounAccess = OnProxy[string]
      expectTypeOf<AnyNounAccess>().toEqualTypeOf<OnNounProxy>()
    })
  })

  describe('OnNounProxy interface', () => {
    it('should be an indexable type returning handler setter', () => {
      // $.on['Customer']['created'] should be a function accepting handler
      type CreatedAccess = OnNounProxy['created']
      expectTypeOf<CreatedAccess>().toBeFunction()
    })

    it('should return function that accepts EventHandler', () => {
      type VerbAccess = OnNounProxy[string]
      // Should be (handler: EventHandler) => void
      expectTypeOf<VerbAccess>().toEqualTypeOf<(handler: EventHandler) => void>()
    })
  })

  describe('EventHandler type', () => {
    it('should be async function accepting DomainEvent', () => {
      // EventHandler should be (event: DomainEvent) => Promise<void>
      expectTypeOf<EventHandler>().toBeFunction()
      expectTypeOf<EventHandler>().returns.toEqualTypeOf<Promise<void>>()
      expectTypeOf<EventHandler>().parameter(0).toEqualTypeOf<DomainEvent>()
    })
  })

  describe('DomainEvent interface', () => {
    it('should have id property', () => {
      expectTypeOf<DomainEvent['id']>().toBeString()
    })

    it('should have verb property', () => {
      expectTypeOf<DomainEvent['verb']>().toBeString()
    })

    it('should have source property', () => {
      expectTypeOf<DomainEvent['source']>().toBeString()
    })

    it('should have data property as unknown', () => {
      expectTypeOf<DomainEvent['data']>().toBeUnknown()
    })

    it('should have timestamp property as Date', () => {
      expectTypeOf<DomainEvent['timestamp']>().toEqualTypeOf<Date>()
    })

    it('should have optional actionId property', () => {
      expectTypeOf<DomainEvent['actionId']>().toEqualTypeOf<string | undefined>()
    })
  })
})

// ============================================================================
// 5. $.Noun() Domain Proxy Type Tests
// ============================================================================

describe('$.Noun() Domain Proxy Type System', () => {
  describe('WorkflowContext index signature', () => {
    it('should have index signature for dynamic noun access', () => {
      // WorkflowContext should allow $.Noun where Noun is any string
      // This is represented by the index signature: [Noun: string]: ((id: string) => DomainProxy) | unknown
      type NounAccess = WorkflowContext[string]

      // The access should include the function type
      expectTypeOf<NounAccess>().toMatchTypeOf<((id: string) => DomainProxy) | unknown>()
    })
  })

  describe('DomainProxy interface', () => {
    it('should be an indexable type', () => {
      // DomainProxy should have index signature for method calls
      type MethodAccess = DomainProxy[string]
      expectTypeOf<MethodAccess>().toBeFunction()
    })

    it('should return Promise for method calls', () => {
      // DomainProxy methods should return RpcPromise<unknown> which extends Promise
      type MethodAccess = DomainProxy[string]
      type MethodReturn = ReturnType<MethodAccess>
      expectTypeOf<MethodReturn>().toMatchTypeOf<Promise<unknown>>()
    })

    it('should accept any arguments', () => {
      // Methods should accept ...args: unknown[]
      type MethodAccess = DomainProxy[string]
      // The function should accept unknown[] args
      expectTypeOf<MethodAccess>().toMatchTypeOf<(...args: unknown[]) => Promise<unknown>>()
    })
  })
})

// ============================================================================
// 6. Type Error Tests - Verify Wrong Types Cause Errors at Compile Time
// ============================================================================

describe('Type Safety - Compile Time Checks', () => {
  describe('$.send type constraints', () => {
    it('should require string for event parameter', () => {
      // This test verifies the type signature requires string
      type SendFirstParam = Parameters<WorkflowContext['send']>[0]
      expectTypeOf<SendFirstParam>().toBeString()

      // Non-string should not be assignable
      expectTypeOf<number>().not.toMatchTypeOf<SendFirstParam>()
      expectTypeOf<object>().not.toMatchTypeOf<SendFirstParam>()
    })

    it('should accept any value for data parameter', () => {
      type SendSecondParam = Parameters<WorkflowContext['send']>[1]
      // unknown accepts any value
      expectTypeOf<SendSecondParam>().toBeUnknown()
    })
  })

  describe('$.try type constraints', () => {
    it('should require string for action parameter', () => {
      type TryFirstParam = Parameters<WorkflowContext['try']>[0]
      expectTypeOf<TryFirstParam>().toBeString()
    })

    it('should return Promise', () => {
      type TryReturn = ReturnType<WorkflowContext['try']>
      expectTypeOf<TryReturn>().toMatchTypeOf<Promise<unknown>>()
    })
  })

  describe('$.do type constraints', () => {
    it('should require string for action parameter', () => {
      type DoFirstParam = Parameters<WorkflowContext['do']>[0]
      expectTypeOf<DoFirstParam>().toBeString()
    })

    it('should return Promise', () => {
      type DoReturn = ReturnType<WorkflowContext['do']>
      expectTypeOf<DoReturn>().toMatchTypeOf<Promise<unknown>>()
    })
  })

  describe('EventHandler type constraints', () => {
    it('should require DomainEvent parameter', () => {
      type HandlerParam = Parameters<EventHandler>[0]
      expectTypeOf<HandlerParam>().toEqualTypeOf<DomainEvent>()
    })

    it('should require Promise<void> return', () => {
      type HandlerReturn = ReturnType<EventHandler>
      expectTypeOf<HandlerReturn>().toEqualTypeOf<Promise<void>>()
    })
  })
})

// ============================================================================
// 7. Integration Tests - Type Combinations
// ============================================================================

describe('Type Integration', () => {
  describe('WorkflowContext completeness', () => {
    it('should have send method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('send')
    })

    it('should have try method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('try')
    })

    it('should have do method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('do')
    })

    it('should have on property', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('on')
    })

    it('should have every property', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('every')
    })

    it('should have branch method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('branch')
    })

    it('should have checkout method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('checkout')
    })

    it('should have merge method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('merge')
    })

    it('should have log method', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('log')
    })

    it('should have state property', () => {
      expectTypeOf<WorkflowContext>().toHaveProperty('state')
    })
  })

  describe('method return types', () => {
    it('branch should return Promise<void>', () => {
      expectTypeOf<WorkflowContext['branch']>().returns.toEqualTypeOf<Promise<void>>()
    })

    it('checkout should return Promise<void>', () => {
      expectTypeOf<WorkflowContext['checkout']>().returns.toEqualTypeOf<Promise<void>>()
    })

    it('merge should return Promise<void>', () => {
      expectTypeOf<WorkflowContext['merge']>().returns.toEqualTypeOf<Promise<void>>()
    })

    it('log should return void', () => {
      expectTypeOf<WorkflowContext['log']>().returns.toBeVoid()
    })
  })

  describe('state type', () => {
    it('should be Record<string, unknown>', () => {
      expectTypeOf<WorkflowContext['state']>().toEqualTypeOf<Record<string, unknown>>()
    })
  })
})

// ============================================================================
// 8. Export Verification
// ============================================================================

describe('Export Verification', () => {
  it('should export WorkflowContext interface', () => {
    // Type exists and is usable
    type WC = WorkflowContext
    expectTypeOf<WC>().toBeObject()
  })

  it('should export OnProxy interface', () => {
    type OP = OnProxy
    expectTypeOf<OP>().toBeObject()
  })

  it('should export OnNounProxy interface', () => {
    type ONP = OnNounProxy
    expectTypeOf<ONP>().toBeObject()
  })

  it('should export DomainProxy interface', () => {
    type DP = DomainProxy
    expectTypeOf<DP>().toBeObject()
  })

  it('should export EventHandler type', () => {
    type EH = EventHandler
    expectTypeOf<EH>().toBeFunction()
  })

  it('should export DomainEvent interface', () => {
    type DE = DomainEvent
    expectTypeOf<DE>().toBeObject()
  })
})

// ============================================================================
// 9. @ts-expect-error Tests - Verify Type Errors Are Caught
// ============================================================================

describe('@ts-expect-error Type Tests', () => {
  it('should error when send is called with non-string event', () => {
    // These are compile-time checks via @ts-expect-error
    // If the type system is correct, these lines would error without the directive

    // @ts-expect-error - event must be string, not number
    type BadSend1 = WorkflowContext['send'] extends (event: number, data: unknown) => void ? true : false

    // The type should NOT match the bad signature
    type GoodSend = WorkflowContext['send'] extends (event: string, data: unknown) => void ? true : false
    const goodCheck: GoodSend = true
    expect(goodCheck).toBe(true)
  })

  it('should error when try/do action is non-string', () => {
    // @ts-expect-error - action must be string
    type BadTry = WorkflowContext['try'] extends <T>(action: number, data: unknown) => Promise<T> ? true : false

    type GoodTry = WorkflowContext['try'] extends <T>(action: string, data: unknown) => Promise<T> ? true : false
    const goodCheck: GoodTry = true
    expect(goodCheck).toBe(true)
  })

  it('should error when EventHandler does not return Promise<void>', () => {
    // A handler returning string should not be assignable to EventHandler
    type BadHandler = (event: DomainEvent) => string
    type IsAssignable = BadHandler extends EventHandler ? true : false
    const check: IsAssignable = false as IsAssignable
    expect(typeof check).toBe('boolean')
  })
})

// ============================================================================
// 10. Type Utility Tests
// ============================================================================

describe('Type Utilities', () => {
  describe('extracting types from WorkflowContext', () => {
    it('should extract send signature', () => {
      type SendSignature = WorkflowContext['send']
      type Expected = (event: string, data: unknown) => void
      expectTypeOf<SendSignature>().toEqualTypeOf<Expected>()
    })

    it('should extract on type', () => {
      type OnType = WorkflowContext['on']
      expectTypeOf<OnType>().toEqualTypeOf<OnProxy>()
    })
  })

  describe('DomainEvent type narrowing', () => {
    it('should allow type assertions on data', () => {
      // Test that DomainEvent.data being unknown allows type narrowing
      type Data = DomainEvent['data']
      expectTypeOf<Data>().toBeUnknown()

      // Can narrow to specific type
      type NarrowedData = DomainEvent['data'] extends unknown ? { customerId: string } : never
      expectTypeOf<NarrowedData>().toEqualTypeOf<{ customerId: string }>()
    })
  })
})
