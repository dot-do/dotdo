/**
 * Type inference tests for TypedWorkflowContext (do-ebio)
 *
 * These tests verify that:
 * - $.on.Customer.signup(handler) infers the event type
 * - $.Customer(id).method() infers available methods
 * - $.every.day.at('9am') has proper return types
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createTypedContext,
  type TypedWorkflowContext,
  type TypedDOStubProxy,
  type TypedOnProxy,
  type TypedEveryProxy,
  type TypedEvent,
  type EventPayloadType,
  type ExtractNoun,
  type ExtractVerb,
  type EventNouns,
  type EventVerbsForNoun,
  type EventSchemasConstraint,
  type DOBindingsConstraint,
} from '../index'

// =============================================================================
// TEST INTERFACES
// =============================================================================

// Define DO interfaces for testing
interface CustomerDO {
  getProfile(): Promise<{ name: string; email: string }>
  notify(params: { message: string }): Promise<{ delivered: boolean }>
  updateBalance(amount: number): Promise<{ balance: number }>
}

interface OrderDO {
  ship(): Promise<{ status: string }>
  getItems(): Promise<string[]>
  cancel(reason: string): Promise<void>
}

interface ProductDO {
  getDetails(): Promise<{ name: string; price: number }>
  updateStock(quantity: number): Promise<void>
}

// Define event schemas for testing - extends constraint for index signature compatibility
interface EventSchemas extends EventSchemasConstraint {
  'Customer.signup': { customerId: string; email: string; plan: string }
  'Customer.updated': { customerId: string; changes: Record<string, unknown> }
  'Order.placed': { orderId: string; items: string[]; total: number }
  'Order.shipped': { orderId: string; trackingNumber: string }
  'Payment.failed': { paymentId: string; reason: string }
}

// Define DO bindings map - extends constraint for index signature compatibility
interface DOBindings extends DOBindingsConstraint {
  Customer: CustomerDO
  Order: OrderDO
  Product: ProductDO
}

// =============================================================================
// TYPE HELPER TESTS
// =============================================================================

describe('Type Helper Tests', () => {
  // These are compile-time type tests
  // If this file compiles, the type helpers work correctly

  it('ExtractNoun extracts noun from event type', () => {
    type Noun = ExtractNoun<'Customer.signup'>
    // @ts-expect-error - should be 'Customer', not 'Order'
    const _wrongNoun: Noun = 'Order'
    const _correctNoun: Noun = 'Customer'
    expect(_correctNoun).toBe('Customer')
  })

  it('ExtractVerb extracts verb from event type', () => {
    type Verb = ExtractVerb<'Customer.signup'>
    // @ts-expect-error - should be 'signup', not 'created'
    const _wrongVerb: Verb = 'created'
    const _correctVerb: Verb = 'signup'
    expect(_correctVerb).toBe('signup')
  })

  it('EventNouns extracts all nouns from schemas', () => {
    type Nouns = EventNouns<EventSchemas>
    // Should be 'Customer' | 'Order' | 'Payment'
    const customer: Nouns = 'Customer'
    const order: Nouns = 'Order'
    const payment: Nouns = 'Payment'
    expect(customer).toBe('Customer')
    expect(order).toBe('Order')
    expect(payment).toBe('Payment')
  })

  it('EventVerbsForNoun extracts verbs for a specific noun', () => {
    type CustomerVerbs = EventVerbsForNoun<EventSchemas, 'Customer'>
    // Should be 'signup' | 'updated'
    const signup: CustomerVerbs = 'signup'
    const updated: CustomerVerbs = 'updated'
    expect(signup).toBe('signup')
    expect(updated).toBe('updated')
  })

  it('EventPayloadType extracts payload type for event', () => {
    type SignupPayload = EventPayloadType<EventSchemas, 'Customer', 'signup'>
    // Should be { customerId: string; email: string; plan: string }
    const payload: SignupPayload = {
      customerId: 'cust-123',
      email: 'test@example.com',
      plan: 'pro',
    }
    expect(payload.customerId).toBe('cust-123')
    expect(payload.email).toBe('test@example.com')
    expect(payload.plan).toBe('pro')
  })
})

// =============================================================================
// TYPED DO STUB TESTS
// =============================================================================

describe('TypedDOStubProxy Tests', () => {
  it('preserves DO method signatures', () => {
    // This is a compile-time type test
    type CustomerStub = TypedDOStubProxy<CustomerDO>

    // These type assertions verify the stub has correct method types
    // If this compiles, the types are correct
    type GetProfileReturn = ReturnType<CustomerStub['getProfile']>
    type NotifyParam = Parameters<CustomerStub['notify']>[0]
    type UpdateBalanceParam = Parameters<CustomerStub['updateBalance']>[0]

    // Runtime verification
    const _returnType: Awaited<GetProfileReturn> = { name: 'Alice', email: 'a@b.com' }
    const _notifyParam: NotifyParam = { message: 'Hello' }
    const _balanceParam: UpdateBalanceParam = 100

    expect(_returnType.name).toBe('Alice')
    expect(_notifyParam.message).toBe('Hello')
    expect(_balanceParam).toBe(100)
  })
})

// =============================================================================
// TYPED CONTEXT CREATION TESTS
// =============================================================================

describe('createTypedContext', () => {
  // Mock DurableObjectState
  const mockState = {
    id: { toString: () => 'test-id' },
    storage: {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(() => Promise.resolve(new Map())),
    },
  } as unknown as DurableObjectState

  // Mock environment with DO bindings
  const mockEnv = {
    Customer: {
      get: vi.fn(() => ({
        fetch: vi.fn(() => Promise.resolve(new Response(JSON.stringify({ name: 'Alice' }))))
      })),
      idFromName: vi.fn((name) => ({ toString: () => name })),
    },
    Order: {
      get: vi.fn(() => ({
        fetch: vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'shipped' }))))
      })),
      idFromName: vi.fn((name) => ({ toString: () => name })),
    },
  }

  let $: TypedWorkflowContext<DOBindings, EventSchemas>

  beforeEach(() => {
    $ = createTypedContext<DOBindings, EventSchemas>(mockState, mockEnv)
  })

  describe('typed event handlers ($.on)', () => {
    it('should accept handlers with correct event types', () => {
      // This should compile without errors
      $.on.Customer.signup((event) => {
        // TypeScript should infer event.payload as { customerId: string; email: string; plan: string }
        // We can't test actual type inference at runtime, but if this compiles, types work
        const _customerId: string = (event as TypedEvent<EventSchemas['Customer.signup']>).payload.customerId
        const _email: string = (event as TypedEvent<EventSchemas['Customer.signup']>).payload.email
        const _plan: string = (event as TypedEvent<EventSchemas['Customer.signup']>).payload.plan
      })

      // Verify handler was registered
      expect($._handlers.get('Customer.signup')).toHaveLength(1)
    })

    it('should support multiple event types', () => {
      $.on.Order.placed((event) => {
        // Should infer payload type
        const typed = event as TypedEvent<EventSchemas['Order.placed']>
        expect(typed.type).toBe('Order.placed')
      })

      $.on.Payment.failed((event) => {
        const typed = event as TypedEvent<EventSchemas['Payment.failed']>
        expect(typed.type).toBe('Payment.failed')
      })

      expect($._handlers.get('Order.placed')).toHaveLength(1)
      expect($._handlers.get('Payment.failed')).toHaveLength(1)
    })

    it('should support wildcard handlers', () => {
      $.on['*']['*']((event) => {
        // Wildcard handlers receive unknown payload
        expect(event).toBeDefined()
      })

      expect($._handlers.get('*.*')).toHaveLength(1)
    })
  })

  describe('typed scheduling ($.every)', () => {
    it('should have proper return types for scheduling', () => {
      // These should all compile without errors and return void
      $.every.Monday.at('9am')(async () => {
        // Handler
      })

      $.every.day.at('6pm')(async () => {
        // Handler
      })

      $.every.hour(async () => {
        // Handler
      })

      // Verify schedules were registered
      expect($._schedules.size).toBe(3)
    })

    it('should support numeric intervals', () => {
      $.every(5).minutes(async () => {
        // Handler
      })

      expect($._schedules.size).toBe(1)
    })
  })

  describe('typed cross-DO RPC ($.Customer)', () => {
    it('should create typed stubs from bindings', () => {
      // $.Customer should be a function that returns TypedDOStubProxy<CustomerDO>
      const customerStub = $.Customer('user-123')

      // This should compile - getProfile exists on CustomerDO
      expect(typeof customerStub.getProfile).toBe('function')

      // This should also compile - notify exists on CustomerDO
      expect(typeof customerStub.notify).toBe('function')
    })

    it('should cache stubs for same ID', () => {
      const stub1 = $.Customer('user-123')
      const stub2 = $.Customer('user-123')

      // Should return cached stub
      expect(stub1).toBe(stub2)
    })

    it('should create different stubs for different IDs', () => {
      const stub1 = $.Customer('user-123')
      const stub2 = $.Customer('user-456')

      // Should be different stubs
      expect(stub1).not.toBe(stub2)
    })

    it('should support multiple DO types', () => {
      const customer = $.Customer('cust-1')
      const order = $.Order('order-1')

      // Both should have their respective methods
      expect(typeof customer.getProfile).toBe('function')
      expect(typeof order.ship).toBe('function')
    })
  })

  describe('durability methods', () => {
    it('send() should be available', () => {
      expect(typeof $.send).toBe('function')
    })

    it('try() should be available', async () => {
      expect(typeof $.try).toBe('function')
      const result = await $.try(async () => 'success')
      expect(result).toBe('success')
    })

    it('do() should be available', async () => {
      expect(typeof $.do).toBe('function')
      const result = await $.do(async () => 'success')
      expect(result).toBe('success')
    })
  })
})

// =============================================================================
// COMPILE-TIME TYPE TESTS
// =============================================================================

// These are compile-time only tests that verify type inference
// They don't need to run, just need to compile

// Test 1: Event handler payload inference
function _testEventHandlerTypes($: TypedWorkflowContext<DOBindings, EventSchemas>) {
  // This should work with correct types
  $.on.Customer.signup((event) => {
    // If types work, event.payload should be typed
    type Expected = TypedEvent<{ customerId: string; email: string; plan: string }>
    const _typed: Expected = event as Expected
  })

  // This should also work
  $.on.Order.placed((event) => {
    type Expected = TypedEvent<{ orderId: string; items: string[]; total: number }>
    const _typed: Expected = event as Expected
  })
}

// Test 2: DO stub method inference
function _testDOStubTypes($: TypedWorkflowContext<DOBindings, EventSchemas>) {
  const customer = $.Customer('user-123')

  // These should all be valid
  const _profile: Promise<{ name: string; email: string }> = customer.getProfile()
  const _notify: Promise<{ delivered: boolean }> = customer.notify({ message: 'Hi' })
  const _balance: Promise<{ balance: number }> = customer.updateBalance(100)

  const order = $.Order('order-456')

  // These should all be valid
  const _ship: Promise<{ status: string }> = order.ship()
  const _items: Promise<string[]> = order.getItems()
  const _cancel: Promise<void> = order.cancel('changed mind')
}

// Test 3: Every proxy types
function _testEveryTypes($: TypedWorkflowContext<DOBindings, EventSchemas>) {
  // All these should return void (no type errors)
  $.every.Monday.at9am(async () => {})
  $.every.day.at('6pm')(async () => {})
  $.every.hour(async () => {})
  $.every(5).minutes(async () => {})
  $.every.week.on.Friday.at('3pm')(async () => {})
}
