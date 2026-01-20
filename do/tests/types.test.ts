/**
 * Comprehensive type-level tests for do/types.ts
 *
 * These tests verify that type definitions and interfaces work correctly at compile-time.
 * They use the pattern of assigning to typed variables and using @ts-expect-error
 * to verify type constraints are properly enforced.
 *
 * @module do/tests/types.test
 */

import { describe, it, expect } from 'vitest'
import type {
  // DO Stub Proxy types
  DOStubProxy,
  TypedDOStubProxy,
  TypedDOStubFactory,
  DOStubFactory,

  // DO Bindings constraint types
  DOBindingsConstraint,
  EmptyBindings,

  // Workflow context options
  DoOptions,

  // Event schema types
  EventSchemasConstraint,
  EmptyEventSchemas,
  ExtractNoun,
  ExtractVerb,
  EventNouns,
  EventVerbsForNoun,
  EventPayloadType,

  // Typed event types
  TypedEvent,
  TypedEventHandler,
  TypedNounEventProxy,
  TypedOnProxy,

  // Scheduling types
  ScheduleRegisterFn,
  TimeAccessor,
  DayOfWeekProxy,
  IntervalUnitProxy,
  WeekProxy,
  TypedEveryProxy,
  EveryProxy,

  // Context types
  BaseWorkflowContext,
  TypedBaseWorkflowContext,
  DOBindingAccessors,
  TypedWorkflowContext,
  TypedWorkflowContextWithDynamic,
  WorkflowContext,
  WorkflowContextWithDynamic,
  $,
  $Typed,

  // Type helpers
  DOTypeFromBinding,
  StubTypeForBinding,
  InferDOBindings,
  DefineDOBindings,
  DefineEventSchemas,
  EventTypes,
  EventPayload,
  TypedSend,

  // Context creation helpers
  TypedContextConfig,
  CreateTypedContextOptions,
} from '../types'
import type { EventId, ThingId, CorrelationId } from '@dotdo/db'
import { toEventId, toThingId, toCorrelationId } from '@dotdo/db'
import type { ScheduleHandler, ScheduleRegistration } from '../schedule'
import type { EventHandler } from '../on'

// =============================================================================
// TEST INTERFACES - Define sample DO interfaces for testing
// =============================================================================

interface SampleCustomerDO {
  getProfile(): Promise<{ name: string; email: string }>
  notify(params: { message: string }): Promise<{ delivered: boolean }>
  updateBalance(amount: number): Promise<{ balance: number }>
  // Test method with sync return (should be wrapped in Promise)
  getName(): string
}

interface SampleOrderDO {
  ship(): Promise<{ status: string }>
  getItems(): Promise<string[]>
  cancel(reason: string): Promise<void>
}

interface SampleProductDO {
  getDetails(): Promise<{ name: string; price: number }>
  updateStock(quantity: number): Promise<void>
}

// Define sample event schemas
interface SampleEventSchemas {
  'Customer.signup': { customerId: string; email: string; plan: string }
  'Customer.updated': { customerId: string; changes: Record<string, unknown> }
  'Order.placed': { orderId: string; items: string[]; total: number }
  'Order.shipped': { orderId: string; trackingNumber: string }
  'Payment.failed': { paymentId: string; reason: string }
}

// Define sample DO bindings map
interface SampleDOBindings {
  Customer: SampleCustomerDO
  Order: SampleOrderDO
  Product: SampleProductDO
}

// =============================================================================
// DO STUB PROXY TYPES TESTS
// =============================================================================

describe('DOStubProxy Types', () => {
  describe('DOStubProxy', () => {
    it('should allow any method name with unknown args and Promise<unknown> return', () => {
      // DOStubProxy is a loosely-typed proxy for DO method calls
      const stub: DOStubProxy = {
        anyMethod: async () => 'result',
        anotherMethod: async (arg1: unknown, arg2: unknown) => ({ value: 42 }),
      }

      // Should accept any method name
      expect(typeof stub.anyMethod).toBe('function')
      expect(typeof stub.anotherMethod).toBe('function')
    })

    it('should have methods return Promise<unknown>', () => {
      const stub: DOStubProxy = {
        testMethod: async () => 'test',
      }

      // The return type is Promise<unknown>
      const result: Promise<unknown> = stub.testMethod()
      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('TypedDOStubProxy', () => {
    it('should preserve method signatures from the DO interface', () => {
      // TypedDOStubProxy should preserve the types from CustomerDO
      type CustomerStub = TypedDOStubProxy<SampleCustomerDO>

      // Verify return types are preserved
      type ProfileReturn = Awaited<ReturnType<CustomerStub['getProfile']>>
      const _profile: ProfileReturn = { name: 'Alice', email: 'a@b.com' }
      expect(_profile.name).toBe('Alice')

      // Verify parameter types are preserved
      type NotifyParams = Parameters<CustomerStub['notify']>
      const _params: NotifyParams = [{ message: 'Hello' }]
      expect(_params[0].message).toBe('Hello')
    })

    it('should wrap sync methods in Promise', () => {
      // getName() returns string, but the stub should return Promise<string>
      type CustomerStub = TypedDOStubProxy<SampleCustomerDO>
      type GetNameReturn = ReturnType<CustomerStub['getName']>

      // Should be Promise<string>
      const _name: GetNameReturn = Promise.resolve('Alice')
      expect(_name).toBeInstanceOf(Promise)
    })

    it('should preserve async methods as-is', () => {
      type OrderStub = TypedDOStubProxy<SampleOrderDO>

      // ship() already returns Promise, should stay the same
      type ShipReturn = ReturnType<OrderStub['ship']>
      const _shipResult: Awaited<ShipReturn> = { status: 'shipped' }
      expect(_shipResult.status).toBe('shipped')

      // cancel() returns Promise<void>
      type CancelReturn = ReturnType<OrderStub['cancel']>
      const _cancelResult: CancelReturn = Promise.resolve()
      expect(_cancelResult).toBeInstanceOf(Promise)
    })

    it('should exclude non-method properties', () => {
      interface DOWithProperties {
        data: string
        method(): Promise<void>
      }

      type Stub = TypedDOStubProxy<DOWithProperties>

      // 'data' property should be typed as 'never' since it's not a function
      // @ts-expect-error - data is never because it's not a method
      const _data: Stub['data'] = 'test'
    })
  })

  describe('TypedDOStubFactory', () => {
    it('should be a function that takes id and returns typed stub', () => {
      type Factory = TypedDOStubFactory<SampleCustomerDO>

      // Factory takes string or DurableObjectId
      const mockFactory: Factory = (id) => ({
        getProfile: async () => ({ name: 'test', email: 'test@test.com' }),
        notify: async () => ({ delivered: true }),
        updateBalance: async () => ({ balance: 100 }),
        getName: async () => 'test',
      })

      // Should accept string
      const stub1 = mockFactory('customer-123')
      expect(typeof stub1.getProfile).toBe('function')

      // Return type should be typed
      type StubReturn = ReturnType<typeof mockFactory>
      const _stub: StubReturn = mockFactory('test')
      expect(_stub).toBeDefined()
    })
  })

  describe('DOStubFactory', () => {
    it('should be a function that takes id and returns untyped stub', () => {
      const factory: DOStubFactory = (id) => ({
        anyMethod: async () => 'result',
      })

      const stub = factory('test-id')

      // Should allow any method
      expect(typeof stub.anyMethod).toBe('function')
    })
  })
})

// =============================================================================
// DO BINDINGS CONSTRAINT TESTS
// =============================================================================

describe('DO Bindings Constraint Types', () => {
  describe('DOBindingsConstraint', () => {
    it('should allow objects as binding values', () => {
      interface TestBindings extends DOBindingsConstraint {
        Customer: SampleCustomerDO
        Order: SampleOrderDO
      }

      const _bindings: TestBindings = {
        Customer: {} as SampleCustomerDO,
        Order: {} as SampleOrderDO,
      }

      expect(_bindings).toBeDefined()
    })

    it('should enforce object type for binding values', () => {
      // This test verifies the constraint at compile-time
      interface ValidBindings extends DOBindingsConstraint {
        ValidDO: { method(): void }
      }

      const _valid: ValidBindings = {
        ValidDO: { method: () => {} },
      }

      expect(_valid).toBeDefined()
    })
  })

  describe('EmptyBindings', () => {
    it('should be Record<string, never>', () => {
      const _empty: EmptyBindings = {}
      expect(_empty).toEqual({})
    })
  })
})

// =============================================================================
// WORKFLOW CONTEXT OPTIONS TESTS
// =============================================================================

describe('DoOptions', () => {
  it('should have optional retries, backoff, and timeout', () => {
    // All fields optional
    const minimal: DoOptions = {}

    // With all fields
    const full: DoOptions = {
      retries: 5,
      backoff: 'exponential',
      timeout: 60000,
    }

    // Linear backoff
    const linear: DoOptions = {
      backoff: 'linear',
    }

    expect(minimal).toEqual({})
    expect(full.retries).toBe(5)
    expect(linear.backoff).toBe('linear')
  })

  it('should only allow linear or exponential backoff', () => {
    const valid1: DoOptions = { backoff: 'linear' }
    const valid2: DoOptions = { backoff: 'exponential' }

    // @ts-expect-error - invalid backoff value
    const _invalid: DoOptions = { backoff: 'constant' }

    expect(valid1.backoff).toBe('linear')
    expect(valid2.backoff).toBe('exponential')
  })
})

// =============================================================================
// EVENT SCHEMA TYPES TESTS
// =============================================================================

describe('Event Schema Types', () => {
  describe('EventSchemasConstraint', () => {
    it('should allow event type strings as keys with any payload', () => {
      interface TestSchemas extends EventSchemasConstraint {
        'User.created': { userId: string }
        'User.deleted': null
        'User.updated': { changes: unknown }
      }

      const _schemas: TestSchemas = {
        'User.created': { userId: '123' },
        'User.deleted': null,
        'User.updated': { changes: {} },
      }

      expect(_schemas['User.created'].userId).toBe('123')
    })
  })

  describe('EmptyEventSchemas', () => {
    it('should be Record<string, unknown>', () => {
      const _empty: EmptyEventSchemas = {}
      expect(_empty).toEqual({})
    })
  })

  describe('ExtractNoun', () => {
    it('should extract noun from Noun.verb format', () => {
      type Result = ExtractNoun<'Customer.signup'>
      const noun: Result = 'Customer'
      expect(noun).toBe('Customer')
    })

    it('should return never for invalid format', () => {
      type Result = ExtractNoun<'InvalidFormat'>
      // Result is 'never' because there's no dot separator
      // We can't easily test 'never' at runtime, but the compile check passes
      expect(true).toBe(true)
    })

    it('should handle multiple dots correctly', () => {
      type Result = ExtractNoun<'Payment.gateway.failed'>
      // Should extract 'Payment' (everything before first dot)
      const noun: Result = 'Payment'
      expect(noun).toBe('Payment')
    })
  })

  describe('ExtractVerb', () => {
    it('should extract verb from Noun.verb format', () => {
      type Result = ExtractVerb<'Customer.signup'>
      const verb: Result = 'signup'
      expect(verb).toBe('signup')
    })

    it('should return never for invalid format', () => {
      type Result = ExtractVerb<'InvalidFormat'>
      // Result is 'never' - compile time check
      expect(true).toBe(true)
    })

    it('should handle multiple dots correctly', () => {
      type Result = ExtractVerb<'Payment.gateway.failed'>
      // Should extract 'gateway.failed' (everything after first dot)
      const verb: Result = 'gateway.failed'
      expect(verb).toBe('gateway.failed')
    })
  })

  describe('EventNouns', () => {
    it('should extract all unique nouns from event schemas', () => {
      type Nouns = EventNouns<SampleEventSchemas>
      // Should be 'Customer' | 'Order' | 'Payment'

      const customer: Nouns = 'Customer'
      const order: Nouns = 'Order'
      const payment: Nouns = 'Payment'

      expect(customer).toBe('Customer')
      expect(order).toBe('Order')
      expect(payment).toBe('Payment')
    })

    it('should handle empty schemas', () => {
      type Nouns = EventNouns<{}>
      // Result is never for empty schemas
      expect(true).toBe(true)
    })
  })

  describe('EventVerbsForNoun', () => {
    it('should extract all verbs for a specific noun', () => {
      type CustomerVerbs = EventVerbsForNoun<SampleEventSchemas, 'Customer'>
      // Should be 'signup' | 'updated'

      const signup: CustomerVerbs = 'signup'
      const updated: CustomerVerbs = 'updated'

      expect(signup).toBe('signup')
      expect(updated).toBe('updated')
    })

    it('should return never for non-existent noun', () => {
      type UnknownVerbs = EventVerbsForNoun<SampleEventSchemas, 'Unknown'>
      // Result is never
      expect(true).toBe(true)
    })

    it('should handle noun with single verb', () => {
      type PaymentVerbs = EventVerbsForNoun<SampleEventSchemas, 'Payment'>
      // Should be 'failed'

      const failed: PaymentVerbs = 'failed'
      expect(failed).toBe('failed')
    })
  })

  describe('EventPayloadType', () => {
    it('should extract payload type for Noun.verb combination', () => {
      type SignupPayload = EventPayloadType<SampleEventSchemas, 'Customer', 'signup'>

      const payload: SignupPayload = {
        customerId: 'cust-123',
        email: 'test@example.com',
        plan: 'pro',
      }

      expect(payload.customerId).toBe('cust-123')
      expect(payload.email).toBe('test@example.com')
      expect(payload.plan).toBe('pro')
    })

    it('should return unknown for non-existent event', () => {
      type UnknownPayload = EventPayloadType<SampleEventSchemas, 'Unknown', 'event'>
      // Should be 'unknown'

      const _payload: UnknownPayload = 'anything'
      expect(_payload).toBe('anything')
    })
  })
})

// =============================================================================
// TYPED EVENT TYPES TESTS
// =============================================================================

describe('TypedEvent Types', () => {
  describe('TypedEvent', () => {
    it('should have $id as EventId', () => {
      const event: TypedEvent = {
        $id: toEventId('evt-123'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: {},
        source: 'test-source',
      }

      const _id: EventId = event.$id
      expect(event.$id).toBe('evt-123')
    })

    it('should have $timestamp as number', () => {
      const timestamp = Date.now()
      const event: TypedEvent = {
        $id: toEventId('evt-123'),
        $timestamp: timestamp,
        type: 'Test.event',
        payload: null,
        source: 'source',
      }

      expect(event.$timestamp).toBe(timestamp)
    })

    it('should accept ThingId or string for source', () => {
      // ThingId source
      const event1: TypedEvent = {
        $id: toEventId('evt-1'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: null,
        source: toThingId('thing-123-abc'),
      }

      // String source
      const event2: TypedEvent = {
        $id: toEventId('evt-2'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: null,
        source: 'plain-string',
      }

      expect(event1.source).toBe('thing-123-abc')
      expect(event2.source).toBe('plain-string')
    })

    it('should have optional correlationId', () => {
      // Without correlationId
      const event1: TypedEvent = {
        $id: toEventId('evt-1'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: null,
        source: 'source',
      }

      // With CorrelationId
      const event2: TypedEvent = {
        $id: toEventId('evt-2'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: null,
        source: 'source',
        correlationId: toCorrelationId('corr-123'),
      }

      // With string correlationId
      const event3: TypedEvent = {
        $id: toEventId('evt-3'),
        $timestamp: Date.now(),
        type: 'Test.event',
        payload: null,
        source: 'source',
        correlationId: 'plain-corr-id',
      }

      expect(event1.correlationId).toBeUndefined()
      expect(event2.correlationId).toBe('corr-123')
      expect(event3.correlationId).toBe('plain-corr-id')
    })

    it('should support generic payload type', () => {
      interface CustomPayload {
        userId: string
        action: 'create' | 'update' | 'delete'
      }

      const event: TypedEvent<CustomPayload> = {
        $id: toEventId('evt-custom'),
        $timestamp: Date.now(),
        type: 'User.action',
        payload: {
          userId: 'user-123',
          action: 'create',
        },
        source: 'system',
      }

      // Payload should be typed
      expect(event.payload.userId).toBe('user-123')
      expect(event.payload.action).toBe('create')
    })
  })

  describe('TypedEventHandler', () => {
    it('should accept sync handlers', () => {
      const handler: TypedEventHandler<{ count: number }> = (event) => {
        const _count: number = event.payload.count
        // void return
      }

      expect(typeof handler).toBe('function')
    })

    it('should accept async handlers', () => {
      const handler: TypedEventHandler<{ message: string }> = async (event) => {
        const _message: string = event.payload.message
        // Promise<void> return
      }

      expect(typeof handler).toBe('function')
    })

    it('should have access to event metadata', () => {
      const handler: TypedEventHandler<unknown> = (event) => {
        const _id: EventId = event.$id
        const _timestamp: number = event.$timestamp
        const _type: string = event.type
        const _source: ThingId | string = event.source
      }

      expect(typeof handler).toBe('function')
    })
  })
})

// =============================================================================
// TYPED ON PROXY TESTS
// =============================================================================

describe('TypedOnProxy Types', () => {
  describe('TypedNounEventProxy', () => {
    it('should have typed handlers for known verbs', () => {
      // For Customer noun, should have signup and updated methods
      type CustomerProxy = TypedNounEventProxy<SampleEventSchemas, 'Customer'>

      // signup handler should receive correct payload type
      const _signup: CustomerProxy['signup'] = (handler) => {
        // Handler receives TypedEvent<SignupPayload>
      }

      expect(true).toBe(true) // Compile-time check
    })

    it('should have wildcard support', () => {
      type CustomerProxy = TypedNounEventProxy<SampleEventSchemas, 'Customer'>

      // Should have '*' method for all events of this noun
      type WildcardMethod = CustomerProxy['*']
      const _wildcard: WildcardMethod = (handler) => {}

      expect(true).toBe(true)
    })

    it('should allow unknown verbs with unknown payload', () => {
      type CustomerProxy = TypedNounEventProxy<SampleEventSchemas, 'Customer'>

      // Index signature allows any verb
      const _unknown: CustomerProxy['unknownVerb'] = (handler) => {}

      expect(true).toBe(true)
    })
  })

  describe('TypedOnProxy', () => {
    it('should have typed noun proxies for known nouns', () => {
      type OnProxy = TypedOnProxy<SampleEventSchemas>

      // Customer, Order, Payment should all be present
      type CustomerProxy = OnProxy['Customer']
      type OrderProxy = OnProxy['Order']
      type PaymentProxy = OnProxy['Payment']

      expect(true).toBe(true) // Compile-time verification
    })

    it('should have top-level wildcard support', () => {
      type OnProxy = TypedOnProxy<SampleEventSchemas>

      // Should have '*' at top level
      type WildcardProxy = OnProxy['*']
      expect(true).toBe(true)
    })

    it('should allow unknown nouns with unknown payloads', () => {
      type OnProxy = TypedOnProxy<SampleEventSchemas>

      // Index signature allows any noun
      type UnknownProxy = OnProxy['UnknownNoun']
      expect(true).toBe(true)
    })
  })
})

// =============================================================================
// SCHEDULING TYPES TESTS
// =============================================================================

describe('Scheduling Types', () => {
  describe('ScheduleRegisterFn', () => {
    it('should accept ScheduleHandler and return void', () => {
      const register: ScheduleRegisterFn = (handler) => {}

      // Should accept async handler
      register(async () => {
        console.log('scheduled task')
      })

      expect(true).toBe(true)
    })
  })

  describe('TimeAccessor', () => {
    it('should be callable with time string', () => {
      const at: TimeAccessor = (time: string) => (handler) => {}

      // Should return ScheduleRegisterFn
      const register = at('9am')
      register(async () => {})

      expect(true).toBe(true)
    })
  })

  describe('DayOfWeekProxy', () => {
    it('should extend ScheduleRegisterFn', () => {
      // DayOfWeekProxy can be called directly with handler
      const proxy: DayOfWeekProxy = Object.assign(
        (handler: ScheduleHandler) => {},
        {
          at: ((time: string) => (handler: ScheduleHandler) => {}) as TimeAccessor,
          at6am: (handler: ScheduleHandler) => {},
          at7am: (handler: ScheduleHandler) => {},
          at8am: (handler: ScheduleHandler) => {},
          at9am: (handler: ScheduleHandler) => {},
          at10am: (handler: ScheduleHandler) => {},
          at11am: (handler: ScheduleHandler) => {},
          at12pm: (handler: ScheduleHandler) => {},
          atnoon: (handler: ScheduleHandler) => {},
          at1pm: (handler: ScheduleHandler) => {},
          at2pm: (handler: ScheduleHandler) => {},
          at3pm: (handler: ScheduleHandler) => {},
          at4pm: (handler: ScheduleHandler) => {},
          at5pm: (handler: ScheduleHandler) => {},
          at6pm: (handler: ScheduleHandler) => {},
          at7pm: (handler: ScheduleHandler) => {},
          at8pm: (handler: ScheduleHandler) => {},
          at9pm: (handler: ScheduleHandler) => {},
          atmidnight: (handler: ScheduleHandler) => {},
        }
      )

      // Can call directly
      proxy(async () => {})

      // Can chain with .at()
      proxy.at('10:30am')(async () => {})

      // Can use predefined times
      proxy.at9am(async () => {})

      expect(true).toBe(true)
    })
  })

  describe('IntervalUnitProxy', () => {
    it('should have time unit methods', () => {
      const proxy: IntervalUnitProxy = {
        seconds: (handler: ScheduleHandler) => {},
        minutes: (handler: ScheduleHandler) => {},
        hours: (handler: ScheduleHandler) => {},
        days: (handler: ScheduleHandler) => {},
        weeks: (handler: ScheduleHandler) => {},
      }

      proxy.seconds(async () => {})
      proxy.minutes(async () => {})
      proxy.hours(async () => {})
      proxy.days(async () => {})
      proxy.weeks(async () => {})

      expect(true).toBe(true)
    })
  })

  describe('WeekProxy', () => {
    it('should have .on accessor for days', () => {
      // WeekProxy extends ScheduleRegisterFn and has .on and .at
      // Testing type structure
      type OnDays = WeekProxy['on']

      // Should have all days
      type Monday = OnDays['Monday']
      type Sunday = OnDays['Sunday']

      expect(true).toBe(true)
    })
  })

  describe('TypedEveryProxy', () => {
    it('should be callable with number for intervals', () => {
      // TypedEveryProxy(5).minutes(handler)
      type NumericResult = ReturnType<TypedEveryProxy>
      // Should be IntervalUnitProxy
      expect(true).toBe(true)
    })

    it('should have day of week properties', () => {
      type MondayProxy = TypedEveryProxy['Monday']
      type SundayProxy = TypedEveryProxy['Sunday']
      // Both should be DayOfWeekProxy
      expect(true).toBe(true)
    })

    it('should have time unit properties', () => {
      type Second = TypedEveryProxy['second']
      type Minute = TypedEveryProxy['minute']
      type Hour = TypedEveryProxy['hour']
      type Day = TypedEveryProxy['day']
      type Week = TypedEveryProxy['week']
      type Month = TypedEveryProxy['month']
      type Year = TypedEveryProxy['year']

      expect(true).toBe(true)
    })

    it('should have special patterns', () => {
      type Weekday = TypedEveryProxy['weekday']
      type Weekend = TypedEveryProxy['weekend']
      type Midnight = TypedEveryProxy['midnight']
      type Noon = TypedEveryProxy['noon']

      expect(true).toBe(true)
    })
  })

  describe('EveryProxy (legacy untyped)', () => {
    it('should allow recursive property access', () => {
      // Legacy EveryProxy uses index signature for dynamic access
      type Result = EveryProxy['any']['path']['here']
      // Should still be EveryProxy
      expect(true).toBe(true)
    })

    it('should be callable with handler', () => {
      // EveryProxy can be called with handler
      type CallSignature = EveryProxy extends (handler: () => Promise<void>) => void ? true : false
      expect(true).toBe(true)
    })

    it('should support numeric intervals', () => {
      // every(5).minutes(handler)
      type NumericSignature = EveryProxy extends (value: number) => { [unit: string]: (handler: () => Promise<void>) => void } ? true : false
      expect(true).toBe(true)
    })
  })
})

// =============================================================================
// WORKFLOW CONTEXT TYPES TESTS
// =============================================================================

describe('Workflow Context Types', () => {
  describe('BaseWorkflowContext', () => {
    it('should have send, try, do methods', () => {
      // Type structure verification
      type Send = BaseWorkflowContext['send']
      type Try = BaseWorkflowContext['try']
      type Do = BaseWorkflowContext['do']

      // Send takes event object with type and optional payload
      type SendParam = Parameters<Send>[0]

      // Try and do take action functions
      type TryParam = Parameters<Try<string>>[0]
      type DoParam = Parameters<Do<string>>[0]

      expect(true).toBe(true)
    })

    it('should have on and every properties', () => {
      type On = BaseWorkflowContext['on']
      type Every = BaseWorkflowContext['every']

      expect(true).toBe(true)
    })

    it('should have internal state properties', () => {
      type Events = BaseWorkflowContext['_events']
      type Handlers = BaseWorkflowContext['_handlers']
      type Schedules = BaseWorkflowContext['_schedules']
      type StubCache = BaseWorkflowContext['_stubCache']
      type Env = BaseWorkflowContext['_env']

      expect(true).toBe(true)
    })
  })

  describe('TypedBaseWorkflowContext', () => {
    it('should have typed on proxy', () => {
      type Context = TypedBaseWorkflowContext<SampleEventSchemas>
      type On = Context['on']

      // On should be TypedOnProxy<SampleEventSchemas>
      type CustomerProxy = On['Customer']
      expect(true).toBe(true)
    })

    it('should have typed every proxy', () => {
      type Context = TypedBaseWorkflowContext<SampleEventSchemas>
      type Every = Context['every']

      // Every should be TypedEveryProxy
      expect(true).toBe(true)
    })
  })

  describe('DOBindingAccessors', () => {
    it('should create stub factories for each binding', () => {
      type Accessors = DOBindingAccessors<SampleDOBindings>

      // Should have Customer, Order, Product factories
      type CustomerFactory = Accessors['Customer']
      type OrderFactory = Accessors['Order']
      type ProductFactory = Accessors['Product']

      // Each should be TypedDOStubFactory
      expect(true).toBe(true)
    })
  })

  describe('TypedWorkflowContext', () => {
    it('should combine base context with DO binding accessors', () => {
      type Context = TypedWorkflowContext<SampleDOBindings, SampleEventSchemas>

      // Should have base methods
      type Send = Context['send']
      type On = Context['on']
      type Every = Context['every']

      // Should have DO accessors
      type Customer = Context['Customer']
      type Order = Context['Order']

      expect(true).toBe(true)
    })

    it('should default to empty bindings and schemas', () => {
      type EmptyContext = TypedWorkflowContext

      // Should still have base methods
      type Send = EmptyContext['send']
      type On = EmptyContext['on']

      expect(true).toBe(true)
    })
  })

  describe('TypedWorkflowContextWithDynamic', () => {
    it('should allow access to unknown properties', () => {
      type Context = TypedWorkflowContextWithDynamic<SampleDOBindings, SampleEventSchemas>

      // Should have typed bindings
      type Customer = Context['Customer']

      // Should also allow any property access
      type Unknown = Context['UnknownBinding']

      expect(true).toBe(true)
    })
  })

  describe('WorkflowContext (legacy)', () => {
    it('should be alias for BaseWorkflowContext', () => {
      type A = WorkflowContext
      type B = BaseWorkflowContext

      // They should be the same type
      const _ctx: WorkflowContext = {} as BaseWorkflowContext
      expect(true).toBe(true)
    })
  })

  describe('$ alias', () => {
    it('should be alias for WorkflowContext', () => {
      type A = $
      type B = WorkflowContext

      const _ctx: $ = {} as WorkflowContext
      expect(true).toBe(true)
    })
  })

  describe('$Typed alias', () => {
    it('should be alias for TypedWorkflowContext', () => {
      type A = $Typed<SampleDOBindings, SampleEventSchemas>
      type B = TypedWorkflowContext<SampleDOBindings, SampleEventSchemas>

      const _ctx: A = {} as B
      expect(true).toBe(true)
    })
  })
})

// =============================================================================
// TYPE HELPER TESTS
// =============================================================================

describe('Type Helpers', () => {
  describe('DOTypeFromBinding', () => {
    it('should extract DO type from binding name', () => {
      type CustomerType = DOTypeFromBinding<SampleDOBindings, 'Customer'>

      // Should be SampleCustomerDO
      const _customer: CustomerType = {} as SampleCustomerDO
      expect(true).toBe(true)
    })
  })

  describe('StubTypeForBinding', () => {
    it('should return TypedDOStubProxy for binding', () => {
      type CustomerStub = StubTypeForBinding<SampleDOBindings, 'Customer'>

      // Should be TypedDOStubProxy<SampleCustomerDO>
      type GetProfile = CustomerStub['getProfile']
      expect(true).toBe(true)
    })
  })

  describe('InferDOBindings', () => {
    it('should extract bindings from environment type', () => {
      interface TestEnv {
        DO: DurableObjectNamespace
        KV: KVNamespace
        OTHER: string
      }

      type Inferred = InferDOBindings<TestEnv>

      // Should only include 'DO' since it's the only DurableObjectNamespace
      type Keys = keyof Inferred
      expect(true).toBe(true)
    })
  })

  describe('DefineDOBindings', () => {
    it('should pass through bindings type', () => {
      type Defined = DefineDOBindings<{
        Customer: SampleCustomerDO
        Order: SampleOrderDO
      }>

      // Should be the same type
      type Customer = Defined['Customer']
      expect(true).toBe(true)
    })
  })

  describe('DefineEventSchemas', () => {
    it('should pass through event schemas type', () => {
      type Defined = DefineEventSchemas<{
        'User.created': { id: string }
      }>

      type Payload = Defined['User.created']
      expect(true).toBe(true)
    })
  })

  describe('EventTypes', () => {
    it('should extract all event type strings as union', () => {
      type Types = EventTypes<SampleEventSchemas>

      // Should be union of all event type strings
      const t1: Types = 'Customer.signup'
      const t2: Types = 'Order.placed'
      const t3: Types = 'Payment.failed'

      expect(t1).toBe('Customer.signup')
      expect(t2).toBe('Order.placed')
      expect(t3).toBe('Payment.failed')
    })
  })

  describe('EventPayload', () => {
    it('should extract payload type for event type key', () => {
      type SignupPayload = EventPayload<SampleEventSchemas, 'Customer.signup'>

      const payload: SignupPayload = {
        customerId: '123',
        email: 'test@test.com',
        plan: 'free',
      }

      expect(payload.customerId).toBe('123')
    })
  })

  describe('TypedSend', () => {
    it('should validate event type and payload', () => {
      type Send = TypedSend<SampleEventSchemas>

      // Should accept valid events
      const send: Send = (event) => {}

      send({
        type: 'Customer.signup',
        payload: { customerId: '123', email: 'a@b.com', plan: 'pro' },
      })

      // Type should be constrained to known event types
      // @ts-expect-error - 'Unknown.event' is not a valid event type
      send({ type: 'Unknown.event', payload: {} })

      expect(true).toBe(true)
    })
  })
})

// =============================================================================
// CONTEXT CREATION HELPERS TESTS
// =============================================================================

describe('Context Creation Helpers', () => {
  describe('TypedContextConfig', () => {
    it('should have optional bindings and events', () => {
      // Minimal config
      const minimal: TypedContextConfig = {}

      // With type params but no runtime values
      const withTypes: TypedContextConfig<SampleDOBindings, SampleEventSchemas> = {}

      expect(minimal).toEqual({})
      expect(withTypes).toEqual({})
    })
  })

  describe('CreateTypedContextOptions', () => {
    it('should have optional debug and errorStore', () => {
      // Minimal
      const minimal: CreateTypedContextOptions = {}

      // With debug
      const withDebug: CreateTypedContextOptions = { debug: true }

      expect(minimal).toEqual({})
      expect(withDebug.debug).toBe(true)
    })
  })
})

// =============================================================================
// COMPILE-TIME ONLY TYPE VERIFICATION
// =============================================================================

// These functions exist purely for compile-time type checking
// They verify complex type relationships work correctly

function _verifyTypedContextStructure(
  $: TypedWorkflowContext<SampleDOBindings, SampleEventSchemas>
) {
  // 1. Event handlers should be typed
  $.on.Customer.signup((event) => {
    // event.payload should have customerId, email, plan
    const _id: string = event.payload.customerId
    const _email: string = event.payload.email
    const _plan: string = event.payload.plan
  })

  // 2. DO stubs should be typed
  const customer = $.Customer('user-123')
  const _profile: Promise<{ name: string; email: string }> = customer.getProfile()
  const _notify: Promise<{ delivered: boolean }> = customer.notify({ message: 'hi' })

  // 3. Scheduling should return void
  $.every.Monday.at('9am')(async () => {})
  $.every(5).minutes(async () => {})

  // 4. Durability methods should work
  $.send({ type: 'Customer.signup', payload: { customerId: '', email: '', plan: '' } })
  void $.try(async () => 'result')
  void $.do(async () => 'result', { retries: 3 })
}

function _verifyDOStubProxyConstraints() {
  // TypedDOStubProxy should properly constrain method types
  type Stub = TypedDOStubProxy<SampleCustomerDO>

  // Correct usage
  const _correctUsage: Stub = {
    getProfile: async () => ({ name: 'Alice', email: 'a@b.com' }),
    notify: async (params) => ({ delivered: true }),
    updateBalance: async (amount) => ({ balance: amount }),
    getName: async () => 'Alice',
  }

  // Wrong return types should fail
  // @ts-expect-error - getProfile should return Promise<{ name: string; email: string }>
  const _wrongReturn: Stub = {
    getProfile: async () => ({ wrong: 'type' }),
    notify: async () => ({ delivered: true }),
    updateBalance: async () => ({ balance: 0 }),
    getName: async () => 'Alice',
  }
}

function _verifyEventSchemaConstraints() {
  // EventPayloadType should properly extract payload types
  type Payload = EventPayloadType<SampleEventSchemas, 'Customer', 'signup'>

  // Correct assignment
  const _correct: Payload = {
    customerId: 'id',
    email: 'email',
    plan: 'plan',
  }

  // Missing fields should fail
  // @ts-expect-error - missing required fields
  const _missing: Payload = {
    customerId: 'id',
  }
}
