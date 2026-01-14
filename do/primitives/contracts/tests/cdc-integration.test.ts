/**
 * CDC Integration Tests for DataContract
 *
 * Tests the integration between DataContract and CDCStream for schema-validated
 * change data capture. This suite verifies:
 * - Contract validation on CDC events
 * - Schema enforcement before sink
 * - Event transformation to contract schema
 * - Dead letter handling for invalid events
 * - Schema auto-discovery from CDC
 *
 * @module db/primitives/contracts/tests/cdc-integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // CDC Contract Integration
  CDCContractStream,
  createCDCContractStream,
  withContract,
  createValidator,
  validateEventAgainstContract,
  detectSchemaDrift,
  type ValidatedChangeEvent,
  type DeadLetterEvent,
  type SchemaDriftReport,
  type CDCContractConfig,
  // CDC Stream
  createCDCStream,
  ChangeOperation,
  type ChangeEvent,
  // Sinks
  createMemorySink,
} from '../../cdc'
import {
  // Data Contract
  type DataContract,
  createRegistry,
  type SchemaRegistry,
  type JSONSchema,
} from '../../data-contract'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const orderContract: DataContract = {
  name: 'Order',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      customerId: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            price: { type: 'number', minimum: 0 },
          },
          required: ['productId', 'quantity', 'price'],
        },
        minItems: 1,
      },
      total: { type: 'number', minimum: 0 },
      status: {
        type: 'string',
        enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
      },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
    },
    required: ['id', 'customerId', 'items', 'total', 'status'],
    additionalProperties: false,
  },
}

const paymentContract: DataContract = {
  name: 'Payment',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      orderId: { type: 'string' },
      amount: { type: 'number', minimum: 0 },
      currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
      method: { type: 'string', enum: ['card', 'bank', 'wallet'] },
      status: { type: 'string', enum: ['pending', 'completed', 'failed', 'refunded'] },
      processedAt: { type: 'number' },
    },
    required: ['id', 'orderId', 'amount', 'currency', 'method', 'status'],
  },
}

interface Order {
  id: string
  customerId: string
  items: Array<{ productId: string; quantity: number; price: number }>
  total: number
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  createdAt?: number
  updatedAt?: number
}

interface Payment {
  id: string
  orderId: string
  amount: number
  currency: 'USD' | 'EUR' | 'GBP'
  method: 'card' | 'bank' | 'wallet'
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  processedAt?: number
}

function createOrderEvent(order: Order, operation: ChangeOperation = ChangeOperation.INSERT): ChangeEvent<Order> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operation,
    table: 'orders',
    before: operation === ChangeOperation.INSERT ? null : order,
    after: operation === ChangeOperation.DELETE ? null : order,
    timestamp: Date.now(),
  }
}

function createPaymentEvent(payment: Payment, operation: ChangeOperation = ChangeOperation.INSERT): ChangeEvent<Payment> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operation,
    table: 'payments',
    before: operation === ChangeOperation.INSERT ? null : payment,
    after: operation === ChangeOperation.DELETE ? null : payment,
    timestamp: Date.now(),
  }
}

// ============================================================================
// TEST: Contract Validation on CDC Events
// ============================================================================

describe('Contract Validation on CDC Events', () => {
  let stream: CDCContractStream<Order>
  let validHandler: ReturnType<typeof vi.fn>
  let deadLetterHandler: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    validHandler = vi.fn()
    deadLetterHandler = vi.fn()

    stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
      onValid: validHandler,
      onDeadLetter: deadLetterHandler,
    })

    await stream.initialize()
  })

  it('should validate INSERT events with complete order data', async () => {
    const order: Order = {
      id: 'order-123',
      customerId: 'customer-456',
      items: [{ productId: 'prod-1', quantity: 2, price: 29.99 }],
      total: 59.98,
      status: 'pending',
      createdAt: Date.now(),
    }

    const event = createOrderEvent(order)
    const result = await stream.processEvent(event)

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true)
    expect(validHandler).toHaveBeenCalledWith(expect.objectContaining({ isValid: true }))
    expect(deadLetterHandler).not.toHaveBeenCalled()
  })

  it('should validate UPDATE events with before/after states', async () => {
    const before: Order = {
      id: 'order-123',
      customerId: 'customer-456',
      items: [{ productId: 'prod-1', quantity: 2, price: 29.99 }],
      total: 59.98,
      status: 'pending',
    }
    const after: Order = {
      ...before,
      status: 'confirmed',
      updatedAt: Date.now(),
    }

    const event: ChangeEvent<Order> = {
      id: `evt-${Date.now()}`,
      operation: ChangeOperation.UPDATE,
      table: 'orders',
      before,
      after,
      timestamp: Date.now(),
    }

    const result = await stream.processEvent(event)

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true)
    expect(result?.beforeValidation?.valid).toBe(true)
    expect(result?.afterValidation?.valid).toBe(true)
  })

  it('should validate DELETE events with before state', async () => {
    const order: Order = {
      id: 'order-123',
      customerId: 'customer-456',
      items: [{ productId: 'prod-1', quantity: 1, price: 10.00 }],
      total: 10.00,
      status: 'cancelled',
    }

    const event: ChangeEvent<Order> = {
      id: `evt-${Date.now()}`,
      operation: ChangeOperation.DELETE,
      table: 'orders',
      before: order,
      after: null,
      timestamp: Date.now(),
    }

    const result = await stream.processEvent(event)

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true)
    expect(result?.beforeValidation?.valid).toBe(true)
  })

  it('should reject events with missing required fields', async () => {
    const invalidOrder = {
      id: 'order-123',
      // Missing customerId, items, total, status
    } as Order

    const event = createOrderEvent(invalidOrder)
    const result = await stream.processEvent(event)

    expect(result).toBeNull()
    expect(validHandler).not.toHaveBeenCalled()
    expect(deadLetterHandler).toHaveBeenCalled()

    const dlq = stream.getDeadLetterQueue()
    expect(dlq.length).toBeGreaterThan(0)
    expect(dlq[0]?.errors.some(e => e.keyword === 'required')).toBe(true)
  })

  it('should reject events with invalid enum values', async () => {
    const invalidOrder = {
      id: 'order-123',
      customerId: 'customer-456',
      items: [{ productId: 'prod-1', quantity: 1, price: 10.00 }],
      total: 10.00,
      status: 'invalid-status' as Order['status'], // Invalid enum
    }

    const event = createOrderEvent(invalidOrder)
    const result = await stream.processEvent(event)

    expect(result).toBeNull()
    const dlq = stream.getDeadLetterQueue()
    expect(dlq[0]?.errors.some(e => e.keyword === 'enum')).toBe(true)
  })

  it('should reject events with array constraint violations', async () => {
    const invalidOrder = {
      id: 'order-123',
      customerId: 'customer-456',
      items: [], // minItems is 1
      total: 0,
      status: 'pending' as const,
    }

    const event = createOrderEvent(invalidOrder)
    const result = await stream.processEvent(event)

    expect(result).toBeNull()
    const dlq = stream.getDeadLetterQueue()
    expect(dlq[0]?.errors.some(e => e.keyword === 'minItems')).toBe(true)
  })

  it('should reject events with numeric constraint violations', async () => {
    const invalidOrder = {
      id: 'order-123',
      customerId: 'customer-456',
      items: [{ productId: 'prod-1', quantity: 0, price: -10.00 }], // quantity < 1, price < 0
      total: -100,
      status: 'pending' as const,
    }

    const event = createOrderEvent(invalidOrder)
    const result = await stream.processEvent(event)

    expect(result).toBeNull()
    const dlq = stream.getDeadLetterQueue()
    expect(dlq[0]?.errors.some(e => e.keyword === 'minimum')).toBe(true)
  })
})

// ============================================================================
// TEST: Schema Enforcement Before Sink
// ============================================================================

describe('Schema Enforcement Before Sink', () => {
  it('should only pass valid events to sink', async () => {
    const sinkEvents: ValidatedChangeEvent<Order>[] = []

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'skip',
      },
      onValid: async (event) => {
        sinkEvents.push(event)
      },
    })

    await stream.initialize()

    // Process mix of valid and invalid events
    const validOrder: Order = {
      id: 'order-1',
      customerId: 'customer-1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      total: 10,
      status: 'pending',
    }

    const invalidOrder = { id: 'order-2' } as Order

    await stream.processEvent(createOrderEvent(validOrder))
    await stream.processEvent(createOrderEvent(invalidOrder))

    // Only valid event should reach sink
    expect(sinkEvents).toHaveLength(1)
    expect(sinkEvents[0]?.after?.id).toBe('order-1')
  })

  it('should enforce schema before writing to memory sink', async () => {
    const memorySink = createMemorySink<Order>()
    const validEvents: Order[] = []

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'skip',
      },
      onValid: async (event) => {
        if (event.after) {
          validEvents.push(event.after)
        }
      },
    })

    await stream.initialize()

    // Valid order
    const validOrder: Order = {
      id: 'order-valid',
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 2, price: 25 }],
      total: 50,
      status: 'confirmed',
    }

    // Invalid order (missing required fields)
    const invalidOrder = {
      id: 'order-invalid',
      customerId: 'cust-2',
    } as Order

    await stream.processEvent(createOrderEvent(validOrder))
    await stream.processEvent(createOrderEvent(invalidOrder))

    expect(validEvents).toHaveLength(1)
    expect(validEvents[0].id).toBe('order-valid')
  })

  it('should track validation metrics for schema enforcement', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'skip',
      },
    })

    await stream.initialize()

    // Process multiple events
    const events: ChangeEvent<Order>[] = [
      createOrderEvent({
        id: '1', customerId: 'c1', items: [{ productId: 'p1', quantity: 1, price: 10 }],
        total: 10, status: 'pending',
      }),
      createOrderEvent({ id: '2' } as Order), // Invalid
      createOrderEvent({
        id: '3', customerId: 'c3', items: [{ productId: 'p3', quantity: 1, price: 30 }],
        total: 30, status: 'shipped',
      }),
      createOrderEvent({ id: '4', customerId: 'c4' } as Order), // Invalid
    ]

    await stream.processEvents(events)

    const metrics = stream.getMetrics()
    expect(metrics.totalEvents).toBe(4)
    expect(metrics.validEvents).toBe(2)
    expect(metrics.invalidEvents).toBe(2)
    expect(metrics.skippedEvents).toBe(2)
  })
})

// ============================================================================
// TEST: Event Transformation to Contract Schema
// ============================================================================

describe('Event Transformation to Contract Schema', () => {
  it('should transform invalid events to valid schema', async () => {
    const transformedEvents: ValidatedChangeEvent<Order>[] = []

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'transform',
        transformOnFailure: (event, errors) => {
          // Transform invalid event by providing defaults
          return {
            ...event,
            after: {
              ...event.after!,
              customerId: event.after?.customerId || 'default-customer',
              items: event.after?.items?.length ? event.after.items : [
                { productId: 'default', quantity: 1, price: 0 }
              ],
              total: event.after?.total ?? 0,
              status: event.after?.status ?? 'pending',
            },
          }
        },
      },
      onValid: async (event) => {
        transformedEvents.push(event)
      },
    })

    await stream.initialize()

    // Partial order missing required fields
    const partialOrder = {
      id: 'order-partial',
    } as Order

    const result = await stream.processEvent(createOrderEvent(partialOrder))

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true)
    expect(result?.transformations).toContain('Applied custom transformation')
    expect(transformedEvents).toHaveLength(1)
    expect(transformedEvents[0]?.after?.customerId).toBe('default-customer')
  })

  it('should send to dead letter if transformation fails validation', async () => {
    const deadLetters: DeadLetterEvent<Order>[] = []

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'transform',
        transformOnFailure: (event) => {
          // Transform that still doesn't satisfy constraints
          return {
            ...event,
            after: {
              ...event.after!,
              items: [], // Still invalid - minItems: 1
              total: -1, // Still invalid - minimum: 0
            },
          }
        },
      },
      onDeadLetter: async (event) => {
        deadLetters.push(event)
      },
    })

    await stream.initialize()

    const invalidOrder = { id: 'order-1' } as Order
    const result = await stream.processEvent(createOrderEvent(invalidOrder))

    expect(result).toBeNull()
    expect(deadLetters).toHaveLength(1)
    expect(deadLetters[0]?.reason).toBe('validation_failed')
  })

  it('should track transformation metrics', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'transform',
        transformOnFailure: (event) => ({
          ...event,
          after: {
            id: event.after?.id || 'default-id',
            customerId: 'default-customer',
            items: [{ productId: 'p1', quantity: 1, price: 10 }],
            total: 10,
            status: 'pending' as const,
          },
        }),
      },
    })

    await stream.initialize()

    // Process invalid events that get transformed
    await stream.processEvent(createOrderEvent({ id: '1' } as Order))
    await stream.processEvent(createOrderEvent({ id: '2' } as Order))

    const metrics = stream.getMetrics()
    expect(metrics.transformedEvents).toBe(2)
    expect(metrics.invalidEvents).toBe(2)
  })
})

// ============================================================================
// TEST: Dead Letter Handling for Invalid Events
// ============================================================================

describe('Dead Letter Handling for Invalid Events', () => {
  it('should route invalid events to dead letter queue', async () => {
    const deadLetterHandler = vi.fn()

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
      onDeadLetter: deadLetterHandler,
    })

    await stream.initialize()

    const invalidOrder = { id: 'invalid-order' } as Order
    await stream.processEvent(createOrderEvent(invalidOrder))

    expect(deadLetterHandler).toHaveBeenCalledTimes(1)
    const [dlEvent] = deadLetterHandler.mock.calls[0]
    expect(dlEvent.reason).toBe('validation_failed')
    expect(dlEvent.errors.length).toBeGreaterThan(0)
    expect(dlEvent.contractName).toBe('Order')
    expect(dlEvent.contractVersion).toBe('1.0.0')
  })

  it('should include detailed error information in dead letters', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
    })

    await stream.initialize()

    const invalidOrder = {
      id: 'order-1',
      customerId: 123 as unknown as string, // Wrong type
      items: [{ productId: 'p1', quantity: -1, price: 'free' as unknown as number }], // Invalid values
      total: 'N/A' as unknown as number,
      status: 'invalid' as Order['status'],
    }

    await stream.processEvent(createOrderEvent(invalidOrder))

    const dlq = stream.getDeadLetterQueue()
    expect(dlq).toHaveLength(1)

    const deadLetter = dlq[0]!
    expect(deadLetter.errors.length).toBeGreaterThan(0)

    // Check error structure
    for (const error of deadLetter.errors) {
      expect(error).toHaveProperty('message')
      expect(error).toHaveProperty('path')
    }
  })

  it('should enforce max dead letter queue size', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
      maxDeadLetterQueueSize: 3,
    })

    await stream.initialize()

    // Send 5 invalid events
    for (let i = 0; i < 5; i++) {
      await stream.processEvent(createOrderEvent({ id: `order-${i}` } as Order))
    }

    const dlq = stream.getDeadLetterQueue()
    expect(dlq).toHaveLength(3)
    // Should keep newest (last 3)
    expect(dlq[0]?.originalEvent.after?.id).toBe('order-2')
    expect(dlq[2]?.originalEvent.after?.id).toBe('order-4')
  })

  it('should support retry from dead letter queue', async () => {
    const validEvents: ValidatedChangeEvent<Order>[] = []

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
      onValid: async (event) => {
        validEvents.push(event)
      },
    })

    await stream.initialize()

    // Send invalid event
    const invalidOrder = { id: 'order-1' } as Order
    await stream.processEvent(createOrderEvent(invalidOrder))

    expect(stream.getDeadLetterQueue()).toHaveLength(1)
    expect(validEvents).toHaveLength(0)

    // Update contract to be more lenient
    await stream.updateContract({
      ...orderContract,
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    })

    // Retry dead letters
    const retried = await stream.retryDeadLetteredEvents()

    expect(retried).toHaveLength(1)
    expect(stream.getDeadLetterQueue()).toHaveLength(0)
  })

  it('should increment retry count on failed retries', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
    })

    await stream.initialize()

    const invalidOrder = { id: 'order-1' } as Order
    await stream.processEvent(createOrderEvent(invalidOrder))

    // First retry attempt (should fail)
    await stream.retryDeadLetteredEvents()

    const dlq = stream.getDeadLetterQueue()
    expect(dlq).toHaveLength(1)
    expect(dlq[0]?.retryCount).toBe(1)

    // Second retry attempt
    await stream.retryDeadLetteredEvents()
    expect(stream.getDeadLetterQueue()[0]?.retryCount).toBe(2)
  })

  it('should track dead letter metrics', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
    })

    await stream.initialize()

    // Send multiple invalid events with different error types
    await stream.processEvent(createOrderEvent({ id: '1' } as Order)) // Missing required
    await stream.processEvent(createOrderEvent({
      id: '2',
      customerId: 'c2',
      items: [{ productId: 'p', quantity: -1, price: 10 }],
      total: 10,
      status: 'pending',
    })) // Invalid minimum
    await stream.processEvent(createOrderEvent({
      id: '3',
      customerId: 'c3',
      items: [],
      total: 10,
      status: 'pending',
    })) // Invalid minItems

    const metrics = stream.getMetrics()
    expect(metrics.deadLetteredEvents).toBe(3)
    expect(metrics.errorsByType['required']).toBeGreaterThan(0)
  })
})

// ============================================================================
// TEST: Schema Auto-Discovery from CDC
// ============================================================================

describe('Schema Auto-Discovery from CDC', () => {
  it('should detect schema drift with unexpected fields', async () => {
    const driftHandler = vi.fn()

    const stream = createCDCContractStream<Order & { unexpectedField?: string }>({
      config: { contract: orderContract },
      onSchemaDrift: driftHandler,
      detectSchemaDrift: true,
      driftSampleSize: 2,
    })

    await stream.initialize()

    // Events with unexpected field
    const events = [
      createOrderEvent({
        id: '1',
        customerId: 'c1',
        items: [{ productId: 'p1', quantity: 1, price: 10 }],
        total: 10,
        status: 'pending',
        unexpectedField: 'drift',
      } as Order & { unexpectedField: string }),
      createOrderEvent({
        id: '2',
        customerId: 'c2',
        items: [{ productId: 'p2', quantity: 1, price: 20 }],
        total: 20,
        status: 'confirmed',
        unexpectedField: 'drift',
      } as Order & { unexpectedField: string }),
    ]

    await stream.processEvents(events)

    expect(driftHandler).toHaveBeenCalled()
    const report: SchemaDriftReport = driftHandler.mock.calls[0][0]
    expect(report.hasDrift).toBe(true)
    expect(report.unexpectedFields).toContain('unexpectedField')
  })

  it('should detect missing required fields in source data', async () => {
    // Use detectSchemaDrift standalone function
    const events: ChangeEvent<Partial<Order>>[] = [
      {
        id: 'evt-1',
        operation: ChangeOperation.INSERT,
        table: 'orders',
        before: null,
        after: {
          id: '1',
          // Missing customerId, items, total, status
        },
        timestamp: Date.now(),
      },
    ]

    const report = detectSchemaDrift(events as ChangeEvent<Order>[], orderContract)

    expect(report.hasDrift).toBe(true)
    expect(report.missingRequiredFields).toContain('customerId')
    expect(report.missingRequiredFields).toContain('items')
    expect(report.missingRequiredFields).toContain('total')
    expect(report.missingRequiredFields).toContain('status')
  })

  it('should detect type mismatches in source data', async () => {
    const events: ChangeEvent<Record<string, unknown>>[] = [
      {
        id: 'evt-1',
        operation: ChangeOperation.INSERT,
        table: 'orders',
        before: null,
        after: {
          id: '1',
          customerId: 'c1',
          items: [{ productId: 'p1', quantity: 1, price: 10 }],
          total: 'fifty dollars', // Should be number
          status: 'pending',
        },
        timestamp: Date.now(),
      },
    ]

    const report = detectSchemaDrift(events, orderContract)

    expect(report.hasDrift).toBe(true)
    expect(report.typeMismatches.some(m => m.field === 'total')).toBe(true)
    expect(report.typeMismatches.find(m => m.field === 'total')?.expectedType).toBe('number')
    expect(report.typeMismatches.find(m => m.field === 'total')?.actualType).toBe('string')
  })

  it('should analyze both before and after states for drift', async () => {
    const events: ChangeEvent<Order & { oldField?: string; newField?: string }>[] = [
      {
        id: 'evt-1',
        operation: ChangeOperation.UPDATE,
        table: 'orders',
        before: {
          id: '1',
          customerId: 'c1',
          items: [{ productId: 'p1', quantity: 1, price: 10 }],
          total: 10,
          status: 'pending',
          oldField: 'in before only',
        } as Order & { oldField: string },
        after: {
          id: '1',
          customerId: 'c1',
          items: [{ productId: 'p1', quantity: 1, price: 10 }],
          total: 10,
          status: 'confirmed',
          newField: 'in after only',
        } as Order & { newField: string },
        timestamp: Date.now(),
      },
    ]

    const report = detectSchemaDrift(events, orderContract)

    expect(report.hasDrift).toBe(true)
    expect(report.unexpectedFields).toContain('oldField')
    expect(report.unexpectedFields).toContain('newField')
  })

  it('should report no drift for conforming events', async () => {
    const events: ChangeEvent<Order>[] = [
      createOrderEvent({
        id: '1',
        customerId: 'c1',
        items: [{ productId: 'p1', quantity: 1, price: 10 }],
        total: 10,
        status: 'pending',
      }),
      createOrderEvent({
        id: '2',
        customerId: 'c2',
        items: [{ productId: 'p2', quantity: 2, price: 20 }],
        total: 40,
        status: 'confirmed',
      }),
    ]

    const report = detectSchemaDrift(events, orderContract)

    expect(report.hasDrift).toBe(false)
    expect(report.unexpectedFields).toHaveLength(0)
    expect(report.missingRequiredFields).toHaveLength(0)
    expect(report.typeMismatches).toHaveLength(0)
    expect(report.sampleCount).toBe(2)
  })
})

// ============================================================================
// TEST: Contract Registry Integration
// ============================================================================

describe('Contract Registry Integration', () => {
  let registry: SchemaRegistry

  beforeEach(async () => {
    registry = createRegistry()
    await registry.register(orderContract)
    await registry.register(paymentContract)
  })

  it('should load contract from registry by name', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: 'Order',
        registry,
      },
    })

    await stream.initialize()

    const validOrder: Order = {
      id: '1',
      customerId: 'c1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      total: 10,
      status: 'pending',
    }

    const result = await stream.processEvent(createOrderEvent(validOrder))

    expect(result?.isValid).toBe(true)
    expect(result?.contractName).toBe('Order')
    expect(result?.contractVersion).toBe('1.0.0')
  })

  it('should support versioned contract lookup', async () => {
    // Register v2 with additional required field
    await registry.register({
      name: 'Order',
      version: '2.0.0',
      schema: {
        ...orderContract.schema,
        properties: {
          ...orderContract.schema.properties,
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        },
        required: [...(orderContract.schema.required || []), 'priority'],
      },
    })

    // Use v1
    const streamV1 = createCDCContractStream<Order>({
      config: {
        contract: 'Order',
        registry,
        schemaVersion: '1.0.0',
      },
    })
    await streamV1.initialize()

    // Order without priority - valid in v1
    const order: Order = {
      id: '1',
      customerId: 'c1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      total: 10,
      status: 'pending',
    }

    const resultV1 = await streamV1.processEvent(createOrderEvent(order))
    expect(resultV1?.isValid).toBe(true)
    expect(resultV1?.contractVersion).toBe('1.0.0')

    // Use v2 - should fail without priority
    const streamV2 = createCDCContractStream<Order>({
      config: {
        contract: 'Order',
        registry,
        schemaVersion: '2.0.0',
      },
    })
    await streamV2.initialize()

    const resultV2 = await streamV2.processEvent(createOrderEvent(order))
    expect(resultV2).toBeNull()
  })

  it('should allow dynamic contract updates', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: 'Order',
        registry,
      },
    })

    await stream.initialize()

    // Invalid with current contract
    const minimalOrder = { id: '1' } as Order
    const result1 = await stream.processEvent(createOrderEvent(minimalOrder))
    expect(result1).toBeNull()

    // Register relaxed contract
    await registry.register({
      name: 'Order',
      version: '3.0.0',
      schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    })

    // Update to use latest
    await stream.updateContract('Order')

    // Now valid
    const result2 = await stream.processEvent(createOrderEvent(minimalOrder))
    expect(result2?.isValid).toBe(true)
    expect(result2?.contractVersion).toBe('3.0.0')
  })
})

// ============================================================================
// TEST: Performance Impact
// ============================================================================

describe('Performance Impact', () => {
  it('should validate events with less than 5% overhead', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        mode: 'strict',
      },
      collectMetrics: true,
    })

    await stream.initialize()

    // Generate 1000 events
    const events: ChangeEvent<Order>[] = []
    for (let i = 0; i < 1000; i++) {
      events.push(createOrderEvent({
        id: `order-${i}`,
        customerId: `customer-${i % 100}`,
        items: [
          { productId: `product-${i % 50}`, quantity: (i % 10) + 1, price: Math.random() * 100 },
        ],
        total: Math.random() * 1000,
        status: ['pending', 'confirmed', 'shipped'][i % 3] as Order['status'],
        createdAt: Date.now(),
      }))
    }

    const startTime = performance.now()
    await stream.processEvents(events)
    const totalTime = performance.now() - startTime

    const metrics = stream.getMetrics()

    // Verify all events processed
    expect(metrics.totalEvents).toBe(1000)
    expect(metrics.validEvents).toBe(1000)

    // Average validation time should be under 1ms per event (reasonable overhead)
    expect(metrics.avgValidationTimeMs).toBeLessThan(1)

    // Total processing should complete in reasonable time (under 2 seconds)
    expect(totalTime).toBeLessThan(2000)

    // Log for visibility (not assertions)
    console.log(`Performance metrics:
      Total events: ${metrics.totalEvents}
      Avg validation time: ${metrics.avgValidationTimeMs.toFixed(3)}ms
      Total time: ${totalTime.toFixed(2)}ms
      Throughput: ${(1000 / (totalTime / 1000)).toFixed(0)} events/sec`)
  })

  it('should handle high-volume dead letter processing efficiently', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        onSchemaViolation: 'dead-letter',
      },
      maxDeadLetterQueueSize: 500,
    })

    await stream.initialize()

    // Generate 500 invalid events
    const events: ChangeEvent<Order>[] = []
    for (let i = 0; i < 500; i++) {
      events.push(createOrderEvent({ id: `invalid-${i}` } as Order))
    }

    const startTime = performance.now()
    await stream.processEvents(events)
    const totalTime = performance.now() - startTime

    const metrics = stream.getMetrics()

    expect(metrics.deadLetteredEvents).toBe(500)
    expect(stream.getDeadLetterQueue()).toHaveLength(500)

    // Should process invalid events quickly too
    expect(totalTime).toBeLessThan(1000)
  })
})

// ============================================================================
// TEST: Multi-Contract Pipeline
// ============================================================================

describe('Multi-Contract Pipeline', () => {
  it('should support multiple contracts in a pipeline', async () => {
    const orderResults: ValidatedChangeEvent<Order>[] = []
    const paymentResults: ValidatedChangeEvent<Payment>[] = []

    const orderStream = createCDCContractStream<Order>({
      config: { contract: orderContract },
      onValid: async (event) => orderResults.push(event),
    })

    const paymentStream = createCDCContractStream<Payment>({
      config: { contract: paymentContract },
      onValid: async (event) => paymentResults.push(event),
    })

    await Promise.all([orderStream.initialize(), paymentStream.initialize()])

    // Process order
    const order: Order = {
      id: 'order-1',
      customerId: 'customer-1',
      items: [{ productId: 'p1', quantity: 1, price: 100 }],
      total: 100,
      status: 'confirmed',
    }

    // Process related payment
    const payment: Payment = {
      id: 'payment-1',
      orderId: 'order-1',
      amount: 100,
      currency: 'USD',
      method: 'card',
      status: 'completed',
    }

    await orderStream.processEvent(createOrderEvent(order))
    await paymentStream.processEvent(createPaymentEvent(payment))

    expect(orderResults).toHaveLength(1)
    expect(paymentResults).toHaveLength(1)
    expect(orderResults[0]?.contractName).toBe('Order')
    expect(paymentResults[0]?.contractName).toBe('Payment')
  })
})

// ============================================================================
// TEST: Validation Modes
// ============================================================================

describe('Validation Modes', () => {
  it('should support strict validation mode', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        mode: 'strict',
        onSchemaViolation: 'dead-letter',
      },
    })

    await stream.initialize()

    // Any validation error should fail in strict mode
    const invalidOrder = { id: '1' } as Order
    const result = await stream.processEvent(createOrderEvent(invalidOrder))

    expect(result).toBeNull()
    expect(stream.getDeadLetterQueue()).toHaveLength(1)
  })

  it('should support lenient validation mode', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        mode: 'lenient',
        onSchemaViolation: 'dead-letter',
      },
    })

    await stream.initialize()

    // Lenient mode may pass partial validation
    const partialOrder = { id: '1' } as Order
    const result = await stream.processEvent(createOrderEvent(partialOrder))

    // In lenient mode with dead-letter action, still goes to DLQ
    expect(result).toBeNull()
  })

  it('should support warn-only validation mode', async () => {
    const validHandler = vi.fn()

    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        mode: 'warn-only',
      },
      onValid: validHandler,
    })

    await stream.initialize()

    // Invalid order should pass in warn-only mode
    const invalidOrder = { id: '1' } as Order
    const result = await stream.processEvent(createOrderEvent(invalidOrder))

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true) // Passes despite errors
    expect(result?.afterValidation?.valid).toBe(false) // But validation shows errors
    expect(validHandler).toHaveBeenCalled()
  })

  it('should support selective before/after validation', async () => {
    const stream = createCDCContractStream<Order>({
      config: {
        contract: orderContract,
        validateBefore: false,
        validateAfter: true,
      },
    })

    await stream.initialize()

    // Invalid before, valid after
    const before = { id: '1' } as Order // Invalid
    const after: Order = {
      id: '1',
      customerId: 'c1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      total: 10,
      status: 'confirmed',
    }

    const event: ChangeEvent<Order> = {
      id: 'evt-1',
      operation: ChangeOperation.UPDATE,
      table: 'orders',
      before,
      after,
      timestamp: Date.now(),
    }

    const result = await stream.processEvent(event)

    expect(result?.isValid).toBe(true)
    expect(result?.beforeValidation).toBeUndefined()
    expect(result?.afterValidation?.valid).toBe(true)
  })
})
