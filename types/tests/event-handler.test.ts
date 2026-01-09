import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * EventHandler Type System Tests (RED Phase)
 *
 * These tests verify that event handlers receive typed payloads based on Noun and Verb.
 * Currently workflows/on.ts uses `any` for event payloads. This should be replaced with
 * properly typed `EventHandler<TPayload>` generics.
 *
 * Issue: dotdo-1oyt - Type the event handler system
 *
 * Implementation requirements:
 * 1. Create EventHandler<TPayload> generic type
 * 2. Create EventPayload<Noun, Verb> type that extracts payload type
 * 3. Create TypedDomainEvent<TPayload> interface
 * 4. Remove `any` from workflows/on.ts handler signatures
 *
 * Reference: workflows/on.ts:33
 */

// These imports should work after implementing the types
import type {
  EventHandler,
  DomainEvent,
} from '../WorkflowContext'

// These new types need to be created
import type {
  TypedEventHandler,
  TypedDomainEvent,
  EventPayload,
  InferEventPayload,
} from '../EventHandler'

// ============================================================================
// Sample domain types for testing
// ============================================================================

// Customer domain
interface CustomerCreatedPayload {
  customerId: string
  name: string
  email: string
  createdAt: Date
}

interface CustomerUpdatedPayload {
  customerId: string
  changes: Record<string, unknown>
  updatedAt: Date
}

interface CustomerDeletedPayload {
  customerId: string
  deletedAt: Date
  reason?: string
}

// Order domain
interface OrderCreatedPayload {
  orderId: string
  customerId: string
  items: Array<{ productId: string; quantity: number; price: number }>
  total: number
}

interface OrderShippedPayload {
  orderId: string
  trackingNumber: string
  carrier: string
  shippedAt: Date
}

interface OrderFailedPayload {
  orderId: string
  error: string
  failedAt: Date
}

// Payment domain
interface PaymentProcessedPayload {
  paymentId: string
  orderId: string
  amount: number
  currency: string
  method: 'card' | 'bank' | 'crypto'
}

interface PaymentFailedPayload {
  paymentId: string
  orderId: string
  error: string
  code: string
}

// ============================================================================
// 1. TypedEventHandler<TPayload> Type Tests
// ============================================================================

describe('TypedEventHandler<TPayload>', () => {
  describe('basic signature', () => {
    it('should be a function type', () => {
      expectTypeOf<TypedEventHandler<CustomerCreatedPayload>>().toBeFunction()
    })

    it('should return Promise<void>', () => {
      expectTypeOf<TypedEventHandler<CustomerCreatedPayload>>().returns.toEqualTypeOf<Promise<void>>()
    })

    it('should accept TypedDomainEvent<TPayload> as parameter', () => {
      type Handler = TypedEventHandler<CustomerCreatedPayload>
      type Param = Parameters<Handler>[0]
      expectTypeOf<Param>().toMatchTypeOf<TypedDomainEvent<CustomerCreatedPayload>>()
    })
  })

  describe('generic payload typing', () => {
    it('should type the payload for CustomerCreated', () => {
      type Handler = TypedEventHandler<CustomerCreatedPayload>
      type EventParam = Parameters<Handler>[0]
      type PayloadType = EventParam['data']

      // The data field should be typed as CustomerCreatedPayload
      expectTypeOf<PayloadType>().toEqualTypeOf<CustomerCreatedPayload>()
    })

    it('should type the payload for OrderShipped', () => {
      type Handler = TypedEventHandler<OrderShippedPayload>
      type EventParam = Parameters<Handler>[0]
      type PayloadType = EventParam['data']

      expectTypeOf<PayloadType>().toEqualTypeOf<OrderShippedPayload>()
    })

    it('should type the payload for PaymentFailed', () => {
      type Handler = TypedEventHandler<PaymentFailedPayload>
      type EventParam = Parameters<Handler>[0]
      type PayloadType = EventParam['data']

      expectTypeOf<PayloadType>().toEqualTypeOf<PaymentFailedPayload>()
    })
  })

  describe('handler implementation typing', () => {
    it('should allow accessing typed payload properties', () => {
      // This verifies that in a handler, you can access payload.customerId etc.
      const handler: TypedEventHandler<CustomerCreatedPayload> = async (event) => {
        // These should all type-check without errors
        const customerId: string = event.data.customerId
        const name: string = event.data.name
        const email: string = event.data.email
        const createdAt: Date = event.data.createdAt

        // Should also have standard event properties
        const eventId: string = event.id
        const verb: string = event.verb
        const source: string = event.source
        const timestamp: Date = event.timestamp
      }

      expect(handler).toBeDefined()
    })

    it('should prevent accessing non-existent payload properties', () => {
      const handler: TypedEventHandler<CustomerCreatedPayload> = async (event) => {
        // @ts-expect-error - nonExistent is not on CustomerCreatedPayload
        const bad = event.data.nonExistent
      }

      expect(handler).toBeDefined()
    })
  })
})

// ============================================================================
// 2. TypedDomainEvent<TPayload> Type Tests
// ============================================================================

describe('TypedDomainEvent<TPayload>', () => {
  describe('extends DomainEvent structure', () => {
    it('should have id property as string', () => {
      expectTypeOf<TypedDomainEvent<unknown>['id']>().toBeString()
    })

    it('should have verb property as string', () => {
      expectTypeOf<TypedDomainEvent<unknown>['verb']>().toBeString()
    })

    it('should have source property as string', () => {
      expectTypeOf<TypedDomainEvent<unknown>['source']>().toBeString()
    })

    it('should have timestamp property as Date', () => {
      expectTypeOf<TypedDomainEvent<unknown>['timestamp']>().toEqualTypeOf<Date>()
    })

    it('should have optional actionId property', () => {
      expectTypeOf<TypedDomainEvent<unknown>['actionId']>().toEqualTypeOf<string | undefined>()
    })
  })

  describe('typed data property', () => {
    it('should have typed data instead of unknown', () => {
      type Event = TypedDomainEvent<OrderCreatedPayload>
      expectTypeOf<Event['data']>().toEqualTypeOf<OrderCreatedPayload>()
    })

    it('should narrow data type for each payload type', () => {
      type CustomerEvent = TypedDomainEvent<CustomerCreatedPayload>
      type OrderEvent = TypedDomainEvent<OrderShippedPayload>
      type PaymentEvent = TypedDomainEvent<PaymentProcessedPayload>

      expectTypeOf<CustomerEvent['data']>().toEqualTypeOf<CustomerCreatedPayload>()
      expectTypeOf<OrderEvent['data']>().toEqualTypeOf<OrderShippedPayload>()
      expectTypeOf<PaymentEvent['data']>().toEqualTypeOf<PaymentProcessedPayload>()
    })
  })

  describe('compatibility with untyped DomainEvent', () => {
    it('should be assignable to DomainEvent', () => {
      // TypedDomainEvent<T> should be usable where DomainEvent is expected
      // (contravariance for handler parameters)
      type Typed = TypedDomainEvent<CustomerCreatedPayload>

      // A TypedDomainEvent should be structurally compatible with DomainEvent
      // since data: T is narrower than data: unknown
      expectTypeOf<Typed>().toMatchTypeOf<DomainEvent>()
    })
  })
})

// ============================================================================
// 3. EventPayload<Noun, Verb> Type Tests
// ============================================================================

describe('EventPayload<Noun, Verb>', () => {
  describe('payload type extraction', () => {
    it('should extract CustomerCreatedPayload for Customer.created', () => {
      // This type would be used to look up the payload type from a registry
      // EventPayload<'Customer', 'created'> should resolve to CustomerCreatedPayload
      type Payload = EventPayload<'Customer', 'created'>

      // Initially this would be unknown until a registry is implemented
      // The test documents the expected behavior
      expectTypeOf<Payload>().not.toBeNever()
    })

    it('should extract OrderShippedPayload for Order.shipped', () => {
      type Payload = EventPayload<'Order', 'shipped'>
      expectTypeOf<Payload>().not.toBeNever()
    })

    it('should extract PaymentFailedPayload for Payment.failed', () => {
      type Payload = EventPayload<'Payment', 'failed'>
      expectTypeOf<Payload>().not.toBeNever()
    })
  })

  describe('fallback behavior', () => {
    it('should fallback to unknown for unregistered events', () => {
      // For events not in the registry, should fallback gracefully
      type Payload = EventPayload<'Unknown', 'something'>
      expectTypeOf<Payload>().toBeUnknown()
    })
  })
})

// ============================================================================
// 4. InferEventPayload<T> Type Tests
// ============================================================================

describe('InferEventPayload<T>', () => {
  describe('inference from handler function', () => {
    it('should infer payload type from handler parameter', () => {
      // Given a handler function, extract what payload type it expects
      type SampleHandler = (event: TypedDomainEvent<CustomerCreatedPayload>) => Promise<void>
      type Inferred = InferEventPayload<SampleHandler>

      expectTypeOf<Inferred>().toEqualTypeOf<CustomerCreatedPayload>()
    })

    it('should infer unknown from untyped handler', () => {
      type UntypedHandler = (event: DomainEvent) => Promise<void>
      type Inferred = InferEventPayload<UntypedHandler>

      expectTypeOf<Inferred>().toBeUnknown()
    })
  })
})

// ============================================================================
// 5. Type Safety Tests - Compile Time Checks
// ============================================================================

describe('Type Safety', () => {
  describe('handler type constraints', () => {
    it('should reject handlers with wrong payload type', () => {
      // A handler expecting OrderCreatedPayload should not accept CustomerCreatedPayload
      type OrderHandler = TypedEventHandler<OrderCreatedPayload>
      type CustomerEvent = TypedDomainEvent<CustomerCreatedPayload>

      // The event types should be incompatible
      // @ts-expect-error - Cannot use CustomerEvent where OrderEvent is expected
      type BadAssignment = CustomerEvent extends Parameters<OrderHandler>[0] ? true : false
    })

    it('should allow handlers with compatible payload types', () => {
      type OrderHandler = TypedEventHandler<OrderCreatedPayload>
      type OrderEvent = TypedDomainEvent<OrderCreatedPayload>

      type GoodAssignment = OrderEvent extends Parameters<OrderHandler>[0] ? true : false
      const check: GoodAssignment = true
      expect(check).toBe(true)
    })
  })

  describe('payload property access', () => {
    it('should allow accessing valid properties', () => {
      const processOrder = async (event: TypedDomainEvent<OrderCreatedPayload>) => {
        // All these should type-check
        expect(event.data.orderId).toBeDefined()
        expect(event.data.customerId).toBeDefined()
        expect(event.data.items).toBeDefined()
        expect(event.data.total).toBeDefined()
      }
    })

    it('should error on invalid property access', () => {
      const processOrder = async (event: TypedDomainEvent<OrderCreatedPayload>) => {
        // @ts-expect-error - trackingNumber is not on OrderCreatedPayload
        const tracking = event.data.trackingNumber
      }
    })
  })
})

// ============================================================================
// 6. Integration with $.on Proxy
// ============================================================================

describe('Integration with $.on Proxy', () => {
  describe('typed on proxy', () => {
    it('should type handlers registered via $.on.Customer.created', () => {
      // This test documents the expected behavior of the on proxy
      // $.on.Customer.created((event) => { event.data.customerId })
      // The handler should receive TypedDomainEvent<CustomerCreatedPayload>

      // For now we just verify the types exist
      type Handler = TypedEventHandler<CustomerCreatedPayload>
      expectTypeOf<Handler>().toBeFunction()
    })
  })
})

// ============================================================================
// 7. Backward Compatibility Tests
// ============================================================================

describe('Backward Compatibility', () => {
  describe('untyped EventHandler', () => {
    it('should still work for untyped handlers', () => {
      // The original EventHandler type should still work
      const untypedHandler: EventHandler = async (event) => {
        // data is unknown, so you need to narrow
        const data = event.data as { id: string }
        expect(data.id).toBeDefined()
      }

      expect(untypedHandler).toBeDefined()
    })

    it('should allow typed handler where untyped is expected', () => {
      // TypedEventHandler should be assignable to EventHandler
      // (since it's more specific)
      type Assignable = TypedEventHandler<CustomerCreatedPayload> extends EventHandler ? true : false

      // This should be true - typed handlers are valid untyped handlers
      const check: Assignable = true
      expect(check).toBe(true)
    })
  })
})

// ============================================================================
// 8. Export Verification Tests
// ============================================================================

describe('Export Verification', () => {
  it('should export TypedEventHandler', () => {
    type TEH = TypedEventHandler<unknown>
    expectTypeOf<TEH>().toBeFunction()
  })

  it('should export TypedDomainEvent', () => {
    type TDE = TypedDomainEvent<unknown>
    expectTypeOf<TDE>().toBeObject()
  })

  it('should export EventPayload', () => {
    type EP = EventPayload<string, string>
    // Should be a type that resolves (not never)
    expectTypeOf<EP>().not.toBeNever()
  })

  it('should export InferEventPayload', () => {
    type IEP = InferEventPayload<EventHandler>
    expectTypeOf<IEP>().not.toBeNever()
  })
})

// ============================================================================
// 9. Usage Examples (Documentation Tests)
// ============================================================================

describe('Usage Examples', () => {
  it('should demonstrate typed event handler usage', () => {
    // Example: Handling customer creation with full type safety
    const handleCustomerCreated: TypedEventHandler<CustomerCreatedPayload> = async (event) => {
      // Full IntelliSense and type checking on event.data
      console.log(`Customer ${event.data.name} (${event.data.email}) created at ${event.data.createdAt}`)

      // Standard event metadata is also available
      console.log(`Event ${event.id} from ${event.source} at ${event.timestamp}`)
    }

    expect(handleCustomerCreated).toBeDefined()
  })

  it('should demonstrate order workflow with typed events', () => {
    // Example: Order lifecycle handlers
    const handleOrderCreated: TypedEventHandler<OrderCreatedPayload> = async (event) => {
      const { orderId, customerId, items, total } = event.data
      console.log(`Order ${orderId} for customer ${customerId}: ${items.length} items, total $${total}`)
    }

    const handleOrderShipped: TypedEventHandler<OrderShippedPayload> = async (event) => {
      const { orderId, trackingNumber, carrier } = event.data
      console.log(`Order ${orderId} shipped via ${carrier}: ${trackingNumber}`)
    }

    const handleOrderFailed: TypedEventHandler<OrderFailedPayload> = async (event) => {
      const { orderId, error } = event.data
      console.error(`Order ${orderId} failed: ${error}`)
    }

    expect(handleOrderCreated).toBeDefined()
    expect(handleOrderShipped).toBeDefined()
    expect(handleOrderFailed).toBeDefined()
  })

  it('should demonstrate payment processing with typed events', () => {
    const handlePaymentProcessed: TypedEventHandler<PaymentProcessedPayload> = async (event) => {
      const { paymentId, amount, currency, method } = event.data
      console.log(`Payment ${paymentId}: ${amount} ${currency} via ${method}`)
    }

    const handlePaymentFailed: TypedEventHandler<PaymentFailedPayload> = async (event) => {
      const { paymentId, error, code } = event.data
      console.error(`Payment ${paymentId} failed with code ${code}: ${error}`)
    }

    expect(handlePaymentProcessed).toBeDefined()
    expect(handlePaymentFailed).toBeDefined()
  })
})
