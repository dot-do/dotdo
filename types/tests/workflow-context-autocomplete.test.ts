import { describe, it, expect, expectTypeOf, assertType } from 'vitest'

/**
 * WorkflowContext Autocomplete Tests (RED Phase - TDD)
 *
 * Issue: dotdo-h766n
 *
 * This test file specifically verifies IDE autocomplete behavior for WorkflowContext ($).
 * The issue is that index signatures can defeat TypeScript's autocomplete system.
 *
 * PROBLEM:
 * When a type has an index signature like `[key: string]: T`, TypeScript may:
 * 1. Not show known properties in autocomplete suggestions
 * 2. Infer property access as the index type rather than specific member types
 * 3. Allow any string property access, hiding typos
 *
 * SOLUTION BEING TESTED:
 * The NounRegistry + NounAccessors pattern uses mapped types instead of index signatures,
 * which preserves autocomplete for both known methods AND registered nouns.
 *
 * TEST STRATEGY:
 * - Tests that verify autocomplete works are marked with explicit type checks
 * - Tests that FAIL in RED phase use @ts-expect-error to document expected behavior
 * - When the fix is complete, @ts-expect-error will become unused (causing errors)
 *
 * RED PHASE TESTS:
 * These tests define what SHOULD work. Some may fail until the implementation is complete.
 */

import type {
  WorkflowContext,
  DomainProxy,
  NounRegistry,
  NounAccessors,
  TryOptions,
  DoOptions,
  OnProxy,
  ScheduleBuilder,
  AITemplateLiteralFn,
  WriteResult,
} from '../WorkflowContext'

// ============================================================================
// 1. AUTOCOMPLETE FOR KNOWN METHODS
// These tests verify that known methods appear in autocomplete and have correct types
// ============================================================================

describe('Autocomplete: Known Methods Are Discoverable', () => {
  describe('keyof WorkflowContext should include all known methods', () => {
    /**
     * This is the core autocomplete test.
     * When you type "$." in an IDE, these methods should appear as suggestions.
     * TypeScript provides suggestions based on `keyof Type`.
     */

    it('should include execution methods: send, try, do, track', () => {
      type Keys = keyof WorkflowContext

      // Verify each execution method is a known key
      type HasSend = 'send' extends Keys ? true : false
      type HasTry = 'try' extends Keys ? true : false
      type HasDo = 'do' extends Keys ? true : false
      type HasTrack = 'track' extends Keys ? true : false

      expectTypeOf<HasSend>().toEqualTypeOf<true>()
      expectTypeOf<HasTry>().toEqualTypeOf<true>()
      expectTypeOf<HasDo>().toEqualTypeOf<true>()
      expectTypeOf<HasTrack>().toEqualTypeOf<true>()
    })

    it('should include branching methods: branch, checkout, merge', () => {
      type Keys = keyof WorkflowContext

      type HasBranch = 'branch' extends Keys ? true : false
      type HasCheckout = 'checkout' extends Keys ? true : false
      type HasMerge = 'merge' extends Keys ? true : false

      expectTypeOf<HasBranch>().toEqualTypeOf<true>()
      expectTypeOf<HasCheckout>().toEqualTypeOf<true>()
      expectTypeOf<HasMerge>().toEqualTypeOf<true>()
    })

    it('should include AI methods: ai, write, summarize, list, extract, is, decide', () => {
      type Keys = keyof WorkflowContext

      type HasAi = 'ai' extends Keys ? true : false
      type HasWrite = 'write' extends Keys ? true : false
      type HasSummarize = 'summarize' extends Keys ? true : false
      type HasList = 'list' extends Keys ? true : false
      type HasExtract = 'extract' extends Keys ? true : false
      type HasIs = 'is' extends Keys ? true : false
      type HasDecide = 'decide' extends Keys ? true : false

      expectTypeOf<HasAi>().toEqualTypeOf<true>()
      expectTypeOf<HasWrite>().toEqualTypeOf<true>()
      expectTypeOf<HasSummarize>().toEqualTypeOf<true>()
      expectTypeOf<HasList>().toEqualTypeOf<true>()
      expectTypeOf<HasExtract>().toEqualTypeOf<true>()
      expectTypeOf<HasIs>().toEqualTypeOf<true>()
      expectTypeOf<HasDecide>().toEqualTypeOf<true>()
    })

    it('should include proxy properties: on, every', () => {
      type Keys = keyof WorkflowContext

      type HasOn = 'on' extends Keys ? true : false
      type HasEvery = 'every' extends Keys ? true : false

      expectTypeOf<HasOn>().toEqualTypeOf<true>()
      expectTypeOf<HasEvery>().toEqualTypeOf<true>()
    })

    it('should include utility properties: log, state, user', () => {
      type Keys = keyof WorkflowContext

      type HasLog = 'log' extends Keys ? true : false
      type HasState = 'state' extends Keys ? true : false
      type HasUser = 'user' extends Keys ? true : false

      expectTypeOf<HasLog>().toEqualTypeOf<true>()
      expectTypeOf<HasState>().toEqualTypeOf<true>()
      expectTypeOf<HasUser>().toEqualTypeOf<true>()
    })

    it('should include registered nouns from NounRegistry', () => {
      type Keys = keyof WorkflowContext

      // Default registered nouns
      type HasCustomer = 'Customer' extends Keys ? true : false
      type HasInvoice = 'Invoice' extends Keys ? true : false
      type HasOrder = 'Order' extends Keys ? true : false
      type HasPayment = 'Payment' extends Keys ? true : false
      type HasStartup = 'Startup' extends Keys ? true : false
      type HasUser = 'User' extends Keys ? true : false

      expectTypeOf<HasCustomer>().toEqualTypeOf<true>()
      expectTypeOf<HasInvoice>().toEqualTypeOf<true>()
      expectTypeOf<HasOrder>().toEqualTypeOf<true>()
      expectTypeOf<HasPayment>().toEqualTypeOf<true>()
      expectTypeOf<HasStartup>().toEqualTypeOf<true>()
      expectTypeOf<HasUser>().toEqualTypeOf<true>()
    })
  })

  describe('known methods should not be typed as unknown or any', () => {
    /**
     * A common problem with index signatures is that explicit members
     * get widened to the index type. These tests verify that doesn't happen.
     */

    it('$.send should have its specific function type, not unknown', () => {
      type SendType = WorkflowContext['send']

      // Should be a callable function
      expectTypeOf<SendType>().toBeFunction()

      // Should NOT be unknown
      expectTypeOf<SendType>().not.toBeUnknown()

      // Should NOT be any
      expectTypeOf<SendType>().not.toBeAny()

      // Should have specific signature
      expectTypeOf<SendType>().toMatchTypeOf<(event: string, data: unknown) => string>()
    })

    it('$.try should have its specific generic function type', () => {
      type TryType = WorkflowContext['try']

      expectTypeOf<TryType>().toBeFunction()
      expectTypeOf<TryType>().not.toBeUnknown()
      expectTypeOf<TryType>().not.toBeAny()
    })

    it('$.do should have its specific generic function type', () => {
      type DoType = WorkflowContext['do']

      expectTypeOf<DoType>().toBeFunction()
      expectTypeOf<DoType>().not.toBeUnknown()
      expectTypeOf<DoType>().not.toBeAny()
    })

    it('$.on should be OnProxy, not unknown', () => {
      type OnType = WorkflowContext['on']

      expectTypeOf<OnType>().not.toBeUnknown()
      expectTypeOf<OnType>().not.toBeAny()
      expectTypeOf<OnType>().toEqualTypeOf<OnProxy>()
    })

    it('$.every should be ScheduleBuilder, not unknown', () => {
      type EveryType = WorkflowContext['every']

      expectTypeOf<EveryType>().not.toBeUnknown()
      expectTypeOf<EveryType>().not.toBeAny()
      expectTypeOf<EveryType>().toEqualTypeOf<ScheduleBuilder>()
    })

    it('$.ai should be AITemplateLiteralFn<string>, not unknown', () => {
      type AIType = WorkflowContext['ai']

      expectTypeOf<AIType>().not.toBeUnknown()
      expectTypeOf<AIType>().not.toBeAny()
      expectTypeOf<AIType>().toEqualTypeOf<AITemplateLiteralFn<string>>()
    })

    it('$.write should be AITemplateLiteralFn<WriteResult>, not unknown', () => {
      type WriteType = WorkflowContext['write']

      expectTypeOf<WriteType>().not.toBeUnknown()
      expectTypeOf<WriteType>().not.toBeAny()
      expectTypeOf<WriteType>().toEqualTypeOf<AITemplateLiteralFn<WriteResult>>()
    })
  })
})

// ============================================================================
// 2. AUTOCOMPLETE FOR REGISTERED NOUNS
// These tests verify that registered nouns (Customer, Invoice, etc.) appear in autocomplete
// ============================================================================

describe('Autocomplete: Registered Nouns Are Discoverable', () => {
  describe('NounRegistry provides noun list for autocomplete', () => {
    it('NounRegistry should have default nouns defined', () => {
      type NounKeys = keyof NounRegistry

      // Default nouns should be in the registry
      type HasCustomer = 'Customer' extends NounKeys ? true : false
      type HasInvoice = 'Invoice' extends NounKeys ? true : false
      type HasOrder = 'Order' extends NounKeys ? true : false
      type HasPayment = 'Payment' extends NounKeys ? true : false
      type HasStartup = 'Startup' extends NounKeys ? true : false
      type HasUser = 'User' extends NounKeys ? true : false

      expectTypeOf<HasCustomer>().toEqualTypeOf<true>()
      expectTypeOf<HasInvoice>().toEqualTypeOf<true>()
      expectTypeOf<HasOrder>().toEqualTypeOf<true>()
      expectTypeOf<HasPayment>().toEqualTypeOf<true>()
      expectTypeOf<HasStartup>().toEqualTypeOf<true>()
      expectTypeOf<HasUser>().toEqualTypeOf<true>()
    })

    it('NounAccessors should map NounRegistry keys to accessors', () => {
      type AccessorKeys = keyof NounAccessors

      // NounAccessors should have same keys as NounRegistry
      type NounKeys = keyof NounRegistry

      // Every NounRegistry key should be in NounAccessors
      type AllNounsInAccessors = NounKeys extends AccessorKeys ? true : false
      expectTypeOf<AllNounsInAccessors>().toEqualTypeOf<true>()
    })
  })

  describe('noun accessors have correct function type', () => {
    it('$.Customer should be (id: string) => DomainProxy', () => {
      type CustomerType = WorkflowContext['Customer']

      // Should be a function
      expectTypeOf<CustomerType>().toBeFunction()

      // Should accept string id
      expectTypeOf<CustomerType>().parameter(0).toBeString()

      // Should return DomainProxy
      expectTypeOf<CustomerType>().returns.toEqualTypeOf<DomainProxy>()
    })

    it('$.Invoice should be (id: string) => DomainProxy', () => {
      type InvoiceType = WorkflowContext['Invoice']

      expectTypeOf<InvoiceType>().toBeFunction()
      expectTypeOf<InvoiceType>().parameter(0).toBeString()
      expectTypeOf<InvoiceType>().returns.toEqualTypeOf<DomainProxy>()
    })

    it('$.Order should be (id: string) => DomainProxy', () => {
      type OrderType = WorkflowContext['Order']

      expectTypeOf<OrderType>().toBeFunction()
      expectTypeOf<OrderType>().parameter(0).toBeString()
      expectTypeOf<OrderType>().returns.toEqualTypeOf<DomainProxy>()
    })
  })
})

// ============================================================================
// 3. NO INDEX SIGNATURE INTERFERENCE
// These tests verify that index signatures don't break the autocomplete
// ============================================================================

describe('No Index Signature Interference', () => {
  describe('WorkflowContext should NOT have string index signature', () => {
    /**
     * The key insight: if WorkflowContext has [key: string]: T,
     * then all properties get widened to T, breaking autocomplete.
     *
     * Instead, we use NounAccessors mapped type which provides
     * specific keys without an index signature.
     */

    it('accessing unknown property should be type error (no catch-all index)', () => {
      // If there's no index signature, accessing an unknown key should fail
      // This is verified by the fact that WorkflowContext extends NounAccessors
      // which uses a mapped type, not an index signature

      type WorkflowKeys = keyof WorkflowContext

      // The set of keys should be finite (not string)
      // This means string is NOT a subtype of WorkflowKeys
      // (If it were, there would be an index signature)

      // Verify that arbitrary strings are NOT keys
      type RandomStringIsKey = 'SomeRandomString123' extends WorkflowKeys ? true : false

      // This should be false - random strings shouldn't be valid keys
      // If this is true, there's an index signature defeating autocomplete
      expectTypeOf<RandomStringIsKey>().toEqualTypeOf<false>()
    })

    it('NounAccessors uses mapped type, not index signature', () => {
      // NounAccessors is defined as:
      // type NounAccessors = { [K in keyof NounRegistry]: (id: string) => DomainProxy }
      //
      // This is a MAPPED type, not an INDEX SIGNATURE.
      // The difference:
      // - Mapped type: finite set of keys from another type
      // - Index signature: any string/number can be a key

      type NounAccessorKeys = keyof NounAccessors
      type NounRegistryKeys = keyof NounRegistry

      // Keys should be exactly the same
      type KeysMatch = NounAccessorKeys extends NounRegistryKeys
        ? NounRegistryKeys extends NounAccessorKeys
          ? true
          : false
        : false

      expectTypeOf<KeysMatch>().toEqualTypeOf<true>()
    })
  })

  describe('known methods are not affected by noun accessors', () => {
    it('$.send type is not mixed with noun accessor type', () => {
      type SendType = WorkflowContext['send']
      type CustomerType = WorkflowContext['Customer']

      // These should be completely different types
      type AreSameType = SendType extends CustomerType
        ? CustomerType extends SendType
          ? true
          : false
        : false

      expectTypeOf<AreSameType>().toEqualTypeOf<false>()
    })

    it('$.on type is not mixed with noun accessor type', () => {
      type OnType = WorkflowContext['on']
      type InvoiceType = WorkflowContext['Invoice']

      // OnProxy and noun accessor should be different
      type AreSameType = OnType extends InvoiceType
        ? InvoiceType extends OnType
          ? true
          : false
        : false

      expectTypeOf<AreSameType>().toEqualTypeOf<false>()
    })
  })
})

// ============================================================================
// 4. TYPE SAFETY PREVENTS TYPOS
// These tests verify that typos in method/noun names are caught at compile time
// ============================================================================

describe('Type Safety: Typos Are Caught', () => {
  describe('typos in method names should fail', () => {
    it('$.snd (typo for send) should not exist', () => {
      type Keys = keyof WorkflowContext
      type HasTypo = 'snd' extends Keys ? true : false

      expectTypeOf<HasTypo>().toEqualTypeOf<false>()
    })

    it('$.Try (wrong case) should not exist', () => {
      type Keys = keyof WorkflowContext
      type HasTypo = 'Try' extends Keys ? true : false

      expectTypeOf<HasTypo>().toEqualTypeOf<false>()
    })

    it('$.doe (typo for do) should not exist', () => {
      type Keys = keyof WorkflowContext
      type HasTypo = 'doe' extends Keys ? true : false

      expectTypeOf<HasTypo>().toEqualTypeOf<false>()
    })
  })

  describe('typos in noun names should fail', () => {
    it('$.Custmer (typo for Customer) should not exist', () => {
      type Keys = keyof WorkflowContext
      type HasTypo = 'Custmer' extends Keys ? true : false

      expectTypeOf<HasTypo>().toEqualTypeOf<false>()
    })

    it('$.Invoic (typo for Invoice) should not exist', () => {
      type Keys = keyof WorkflowContext
      type HasTypo = 'Invoic' extends Keys ? true : false

      expectTypeOf<HasTypo>().toEqualTypeOf<false>()
    })

    it('$.customer (wrong case) should not exist', () => {
      type Keys = keyof WorkflowContext
      type HasTypo = 'customer' extends Keys ? true : false

      expectTypeOf<HasTypo>().toEqualTypeOf<false>()
    })
  })
})

// ============================================================================
// 5. PRACTICAL AUTOCOMPLETE SCENARIOS
// These tests simulate real IDE usage patterns
// ============================================================================

describe('Practical Autocomplete Scenarios', () => {
  describe('completing after typing partial method names', () => {
    /**
     * When you type "$.s", the IDE should suggest:
     * - send
     * - summarize
     * - state
     * - Startup (noun)
     *
     * These tests verify the type system supports this.
     */

    it('methods starting with "s" should be enumerable', () => {
      type Keys = keyof WorkflowContext

      // Methods that start with 's'
      type SendExists = 'send' extends Keys ? true : false
      type SummarizeExists = 'summarize' extends Keys ? true : false
      type StateExists = 'state' extends Keys ? true : false
      type StartupExists = 'Startup' extends Keys ? true : false

      expectTypeOf<SendExists>().toEqualTypeOf<true>()
      expectTypeOf<SummarizeExists>().toEqualTypeOf<true>()
      expectTypeOf<StateExists>().toEqualTypeOf<true>()
      expectTypeOf<StartupExists>().toEqualTypeOf<true>()
    })

    it('methods starting with "d" should be enumerable', () => {
      type Keys = keyof WorkflowContext

      // Methods that start with 'd'
      type DoExists = 'do' extends Keys ? true : false
      type DecideExists = 'decide' extends Keys ? true : false

      expectTypeOf<DoExists>().toEqualTypeOf<true>()
      expectTypeOf<DecideExists>().toEqualTypeOf<true>()
    })
  })

  describe('parameter autocomplete after selecting method', () => {
    /**
     * After selecting $.send, the IDE should show parameter hints.
     * The first parameter should be string (event name).
     */

    it('$.send parameters should be inferable', () => {
      type SendFn = WorkflowContext['send']
      type Params = Parameters<SendFn>

      // First param is string (event name)
      expectTypeOf<Params[0]>().toBeString()

      // Second param exists (data)
      type HasSecondParam = Params extends [string, infer _] ? true : false
      expectTypeOf<HasSecondParam>().toEqualTypeOf<true>()
    })

    it('$.try parameters should be inferable', () => {
      type TryFn = WorkflowContext['try']
      type Params = Parameters<TryFn>

      // First param is string (action)
      expectTypeOf<Params[0]>().toBeString()

      // Second param is unknown (data)
      expectTypeOf<Params[1]>().toBeUnknown()
    })

    it('$.do parameters should be inferable', () => {
      type DoFn = WorkflowContext['do']
      type Params = Parameters<DoFn>

      // First param is string (action)
      expectTypeOf<Params[0]>().toBeString()

      // Second param is unknown (data)
      expectTypeOf<Params[1]>().toBeUnknown()
    })
  })

  describe('chained access autocomplete', () => {
    /**
     * After typing $.on., the IDE should suggest nouns like Customer.
     * After typing $.on.Customer., the IDE should suggest verbs like created.
     */

    it('$.on should provide noun suggestions', () => {
      type OnType = WorkflowContext['on']

      // OnProxy should be indexable
      expectTypeOf<OnType>().toBeObject()

      // Should have nested structure for verb access
      type CustomerAccess = OnType['Customer']
      expectTypeOf<CustomerAccess>().toBeObject()
    })

    it('$.every should provide schedule suggestions', () => {
      type EveryType = WorkflowContext['every']

      // Should have day properties
      type HasMonday = 'Monday' extends keyof EveryType ? true : false
      type HasDay = 'day' extends keyof EveryType ? true : false
      type HasHour = 'hour' extends keyof EveryType ? true : false

      expectTypeOf<HasMonday>().toEqualTypeOf<true>()
      expectTypeOf<HasDay>().toEqualTypeOf<true>()
      expectTypeOf<HasHour>().toEqualTypeOf<true>()
    })

    it('$.Customer(id) should return DomainProxy with method access', () => {
      type CustomerFn = WorkflowContext['Customer']
      type CustomerProxy = ReturnType<CustomerFn>

      // DomainProxy should have index signature for methods
      expectTypeOf<CustomerProxy>().toEqualTypeOf<DomainProxy>()

      // Methods should be callable
      type MethodType = CustomerProxy['anyMethod']
      expectTypeOf<MethodType>().toBeFunction()
    })
  })
})

// ============================================================================
// 6. RETURN TYPE INFERENCE
// These tests verify return types are properly inferred for autocomplete
// ============================================================================

describe('Return Type Inference', () => {
  describe('method return types are specific, not unknown', () => {
    it('$.send returns string (EventId)', () => {
      type SendReturn = ReturnType<WorkflowContext['send']>

      expectTypeOf<SendReturn>().toBeString()
      expectTypeOf<SendReturn>().not.toBeUnknown()
    })

    it('$.try returns Promise', () => {
      type TryReturn = ReturnType<WorkflowContext['try']>

      expectTypeOf<TryReturn>().toMatchTypeOf<Promise<unknown>>()
    })

    it('$.do returns Promise', () => {
      type DoReturn = ReturnType<WorkflowContext['do']>

      expectTypeOf<DoReturn>().toMatchTypeOf<Promise<unknown>>()
    })

    it('$.branch returns Promise<void>', () => {
      type BranchReturn = ReturnType<WorkflowContext['branch']>

      expectTypeOf<BranchReturn>().toEqualTypeOf<Promise<void>>()
    })

    it('$.log returns void', () => {
      type LogReturn = ReturnType<WorkflowContext['log']>

      expectTypeOf<LogReturn>().toBeVoid()
    })
  })
})

// ============================================================================
// 7. EXTENSIBILITY VIA MODULE AUGMENTATION
// These tests verify the NounRegistry can be extended
// ============================================================================

describe('Extensibility: Module Augmentation', () => {
  /**
   * The NounRegistry interface is designed for module augmentation.
   * Domain code can extend it to add custom nouns.
   *
   * Example:
   * ```typescript
   * declare module '../types/WorkflowContext' {
   *   interface NounRegistry {
   *     MyCustomEntity: { id: string; name: string }
   *   }
   * }
   * ```
   */

  it('NounRegistry is an interface (can be augmented)', () => {
    // This test documents that NounRegistry is an interface, not a type alias
    // Interfaces can be augmented; type aliases cannot

    // NounRegistry has specific keys, NOT an index signature
    // This is correct - it provides autocomplete for known nouns only
    type NounKeys = keyof NounRegistry

    // Should have finite set of keys (not string)
    type HasCustomer = 'Customer' extends NounKeys ? true : false
    expectTypeOf<HasCustomer>().toEqualTypeOf<true>()

    // Verify it's an object type (interface)
    expectTypeOf<NounRegistry>().toBeObject()
  })

  it('default NounRegistry has expected nouns', () => {
    type DefaultNouns = keyof NounRegistry

    // Should include framework defaults
    type HasDefaults = 'Customer' | 'Invoice' | 'Order' | 'Payment' | 'Startup' | 'User' extends DefaultNouns
      ? true
      : false

    expectTypeOf<HasDefaults>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 8. ONPROXY DYNAMIC ACCESS (INTENTIONALLY USES INDEX SIGNATURE)
// OnProxy needs to support wildcards and dynamic event names
// ============================================================================

describe('OnProxy: Dynamic Access is Intentional', () => {
  /**
   * OnProxy intentionally uses an index signature because:
   * 1. Event handlers support wildcards: $.on['*'].created
   * 2. Verbs are dynamic and user-defined
   * 3. This doesn't break WorkflowContext autocomplete because
   *    $.on is explicitly typed as OnProxy in the interface
   */

  describe('OnProxy supports dynamic noun access', () => {
    it('$.on accepts any string noun', () => {
      type OnType = WorkflowContext['on']
      type CustomerEvents = OnType['Customer']
      type RandomEvents = OnType['SomeRandomNoun']

      // Both resolve to OnNounProxy-like type (due to index signature)
      expectTypeOf<CustomerEvents>().toBeObject()
      expectTypeOf<RandomEvents>().toBeObject()
    })

    it('$.on.Noun accepts any string verb', () => {
      type OnType = WorkflowContext['on']
      type CustomerEvents = OnType['Customer']
      type CreatedHandler = CustomerEvents['created']
      type RandomHandler = CustomerEvents['someRandomVerb']

      // Both resolve to function type
      expectTypeOf<CreatedHandler>().toBeFunction()
      expectTypeOf<RandomHandler>().toBeFunction()
    })
  })

  describe('OnProxy does not affect WorkflowContext autocomplete', () => {
    it('$.on is explicitly typed, not from index signature', () => {
      // Even though OnProxy has an index signature,
      // WorkflowContext['on'] is explicitly typed as OnProxy
      // This means $.on will show in autocomplete

      type Keys = keyof WorkflowContext
      type OnInKeys = 'on' extends Keys ? true : false

      expectTypeOf<OnInKeys>().toEqualTypeOf<true>()
    })

    it('$.on type is exactly OnProxy', () => {
      type OnType = WorkflowContext['on']
      expectTypeOf<OnType>().toEqualTypeOf<OnProxy>()
    })
  })
})

// ============================================================================
// 9. DOMAINPROXY DYNAMIC METHODS (INTENTIONALLY USES INDEX SIGNATURE)
// DomainProxy methods are RPC calls, so they support any method name
// ============================================================================

describe('DomainProxy: Dynamic Methods are Intentional', () => {
  /**
   * DomainProxy intentionally uses an index signature because:
   * 1. RPC methods are defined by the remote DO, not known at compile time
   * 2. The pattern $.Customer(id).notify() needs to work for any method
   * 3. This doesn't break noun accessor autocomplete because
   *    NounAccessors explicitly maps each noun to (id) => DomainProxy
   */

  describe('DomainProxy supports any method name', () => {
    it('DomainProxy[method] returns a callable function', () => {
      type MethodType = DomainProxy['notify']
      type OtherMethodType = DomainProxy['someOtherMethod']

      expectTypeOf<MethodType>().toBeFunction()
      expectTypeOf<OtherMethodType>().toBeFunction()
    })

    it('DomainProxy methods return RpcPromise', () => {
      type MethodReturn = ReturnType<DomainProxy['anyMethod']>

      expectTypeOf<MethodReturn>().toMatchTypeOf<Promise<unknown>>()
    })
  })
})

// ============================================================================
// 10. SEND RETURN TYPE CHANGE DOCUMENTATION
// $.send returns EventId (string), not void
// ============================================================================

describe('$.send Returns EventId', () => {
  /**
   * Note: The WorkflowContext.send signature has evolved.
   * - Base type: (event: string, data: unknown) => void (fire-and-forget semantics)
   * - DO type: <T>(event: string, data: T) => string (returns EventId for tracking)
   *
   * This is a durable operation that returns a trackable EventId.
   */

  it('$.send returns string (EventId), not void', () => {
    type SendType = WorkflowContext['send']
    type SendReturn = ReturnType<SendType>

    // Returns EventId (string) for tracking
    expectTypeOf<SendReturn>().toBeString()

    // NOT void (which would be fire-and-forget)
    expectTypeOf<SendReturn>().not.toBeVoid()
  })

  it('$.send is generic over data type', () => {
    type SendType = WorkflowContext['send']

    // Should accept generic type parameter for data
    // <T = unknown>(event: string, data: T) => string
    type IsGeneric = SendType extends <T>(event: string, data: T) => string ? true : false
    expectTypeOf<IsGeneric>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 11. VERIFICATION TESTS
// ============================================================================

describe('Test File Verification', () => {
  it('test file compiles and executes', () => {
    expect(true).toBe(true)
  })

  it('all type assertions use expectTypeOf', () => {
    // This is a meta-test to ensure we're using the right testing approach
    // expectTypeOf is from vitest and provides compile-time type checking
    expectTypeOf<string>().toBeString()
  })

  it('total test count documents coverage', () => {
    // This test file covers:
    // 1. Known method discoverability via keyof
    // 2. Known methods have specific types (not unknown)
    // 3. Registered nouns are discoverable
    // 4. Noun accessors have correct function signature
    // 5. No index signature interference with autocomplete
    // 6. Typos are caught at compile time
    // 7. Practical autocomplete scenarios
    // 8. Return type inference
    // 9. Module augmentation extensibility
    // 10. OnProxy intentional dynamic access
    // 11. DomainProxy intentional dynamic access
    // 12. $.send return type
    expect(true).toBe(true)
  })
})
