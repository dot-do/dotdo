/**
 * CDC Contract Integration Tests
 *
 * Tests for DataContract validation integration with CDC streams.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CDCContractStream,
  createCDCContractStream,
  withContract,
  createValidator,
  validateChangeEvent as validateEventAgainstContract,
  detectSchemaDrift,
  type ValidatedChangeEvent,
  type DeadLetterEvent,
  type SchemaDriftReport,
  type CDCContractConfig,
} from '../contract-integration'
import { ChangeOperation, type ChangeEvent } from '../change-event'
import { type DataContract, createRegistry } from '../../data-contract'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const userContract: DataContract = {
  name: 'User',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0 },
      active: { type: 'boolean' },
      metadata: {
        type: 'object',
        properties: {
          createdAt: { type: 'number' },
        },
      },
    },
    required: ['id', 'email', 'name'],
    additionalProperties: false,
  },
}

const productContract: DataContract = {
  name: 'Product',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      name: { type: 'string' },
      price: { type: 'number', minimum: 0 },
      tags: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10,
      },
    },
    required: ['sku', 'name', 'price'],
  },
}

interface User {
  id: string
  email: string
  name: string
  age?: number
  active?: boolean
  metadata?: { createdAt: number }
}

interface Product {
  sku: string
  name: string
  price: number
  tags?: string[]
}

function createUserInsertEvent(user: User): ChangeEvent<User> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operation: ChangeOperation.INSERT,
    table: 'users',
    before: null,
    after: user,
    timestamp: Date.now(),
  }
}

function createUserUpdateEvent(before: User, after: User): ChangeEvent<User> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operation: ChangeOperation.UPDATE,
    table: 'users',
    before,
    after,
    timestamp: Date.now(),
  }
}

function createUserDeleteEvent(user: User): ChangeEvent<User> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operation: ChangeOperation.DELETE,
    table: 'users',
    before: user,
    after: null,
    timestamp: Date.now(),
  }
}

// ============================================================================
// TESTS: validateChangeEvent
// ============================================================================

describe('validateChangeEvent', () => {
  it('validates a valid INSERT event', () => {
    const user: User = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      age: 25,
      active: true,
    }
    const event = createUserInsertEvent(user)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(true)
    expect(result.afterValidation?.valid).toBe(true)
    expect(result.contractName).toBe('User')
    expect(result.contractVersion).toBe('1.0.0')
  })

  it('validates a valid UPDATE event with before and after', () => {
    const before: User = {
      id: 'user-1',
      email: 'old@example.com',
      name: 'Old Name',
    }
    const after: User = {
      id: 'user-1',
      email: 'new@example.com',
      name: 'New Name',
    }
    const event = createUserUpdateEvent(before, after)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(true)
    expect(result.beforeValidation?.valid).toBe(true)
    expect(result.afterValidation?.valid).toBe(true)
  })

  it('validates a valid DELETE event', () => {
    const user: User = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    }
    const event = createUserDeleteEvent(user)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(true)
    expect(result.beforeValidation?.valid).toBe(true)
  })

  it('rejects event with missing required fields', () => {
    const invalidUser = { id: 'user-1' } as User // Missing email and name
    const event = createUserInsertEvent(invalidUser)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(false)
    expect(result.afterValidation?.valid).toBe(false)
    expect(result.afterValidation?.errors).toHaveLength(2)
    expect(result.afterValidation?.errors.some((e) => e.path === 'email')).toBe(true)
    expect(result.afterValidation?.errors.some((e) => e.path === 'name')).toBe(true)
  })

  it('rejects event with wrong field types', () => {
    const invalidUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      age: 'twenty-five' as unknown as number, // Should be number
    }
    const event = createUserInsertEvent(invalidUser)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(false)
    expect(result.afterValidation?.errors.some((e) => e.path === 'age')).toBe(true)
  })

  it('rejects event with additional properties when not allowed', () => {
    const invalidUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      extraField: 'not allowed',
    } as User
    const event = createUserInsertEvent(invalidUser)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(false)
    expect(result.afterValidation?.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true)
  })

  it('validates number constraints (minimum)', () => {
    const invalidUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      age: -5, // Must be >= 0
    }
    const event = createUserInsertEvent(invalidUser)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(false)
    expect(result.afterValidation?.errors.some((e) => e.keyword === 'minimum')).toBe(true)
  })

  it('validates string constraints (minLength)', () => {
    const invalidUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: '', // Must have at least 1 character
    }
    const event = createUserInsertEvent(invalidUser)
    const result = validateEventAgainstContract(event, userContract)

    expect(result.isValid).toBe(false)
    expect(result.afterValidation?.errors.some((e) => e.keyword === 'minLength')).toBe(true)
  })

  it('can skip before validation', () => {
    const before = { id: 'user-1' } as User // Invalid (missing required)
    const after: User = { id: 'user-1', email: 'test@example.com', name: 'Test' }
    const event = createUserUpdateEvent(before, after)

    const result = validateEventAgainstContract(event, userContract, {
      validateBefore: false,
      validateAfter: true,
    })

    expect(result.isValid).toBe(true)
    expect(result.beforeValidation).toBeUndefined()
    expect(result.afterValidation?.valid).toBe(true)
  })

  it('can skip after validation', () => {
    const before: User = { id: 'user-1', email: 'test@example.com', name: 'Test' }
    const after = { id: 'user-1' } as User // Invalid (missing required)
    const event = createUserUpdateEvent(before, after)

    const result = validateEventAgainstContract(event, userContract, {
      validateBefore: true,
      validateAfter: false,
    })

    expect(result.isValid).toBe(true)
    expect(result.beforeValidation?.valid).toBe(true)
    expect(result.afterValidation).toBeUndefined()
  })

  it('uses warn-only mode to pass invalid events with warnings', () => {
    const invalidUser = { id: 'user-1' } as User
    const event = createUserInsertEvent(invalidUser)

    const result = validateEventAgainstContract(event, userContract, {
      mode: 'warn-only',
    })

    expect(result.isValid).toBe(true) // Passes despite errors
    expect(result.afterValidation?.valid).toBe(false) // But validation shows errors
  })
})

// ============================================================================
// TESTS: detectSchemaDrift
// ============================================================================

describe('detectSchemaDrift', () => {
  it('detects no drift for valid events', () => {
    const events: ChangeEvent<User>[] = [
      createUserInsertEvent({ id: '1', email: 'a@b.com', name: 'A' }),
      createUserInsertEvent({ id: '2', email: 'c@d.com', name: 'B' }),
    ]

    const report = detectSchemaDrift(events, userContract)

    expect(report.hasDrift).toBe(false)
    expect(report.unexpectedFields).toHaveLength(0)
    expect(report.missingRequiredFields).toHaveLength(0)
    expect(report.typeMismatches).toHaveLength(0)
    expect(report.sampleCount).toBe(2)
  })

  it('detects unexpected fields', () => {
    const events: ChangeEvent<User & { extraField?: string }>[] = [
      createUserInsertEvent({
        id: '1',
        email: 'a@b.com',
        name: 'A',
        extraField: 'unexpected',
      } as User & { extraField?: string }),
    ]

    const report = detectSchemaDrift(events, userContract)

    expect(report.hasDrift).toBe(true)
    expect(report.unexpectedFields).toContain('extraField')
  })

  it('detects missing required fields', () => {
    const events: ChangeEvent<Partial<User>>[] = [
      {
        id: 'evt-1',
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: { id: '1' }, // Missing email and name
        timestamp: Date.now(),
      },
    ]

    const report = detectSchemaDrift(events as ChangeEvent<User>[], userContract)

    expect(report.hasDrift).toBe(true)
    expect(report.missingRequiredFields).toContain('email')
    expect(report.missingRequiredFields).toContain('name')
  })

  it('detects type mismatches', () => {
    const events: ChangeEvent<Record<string, unknown>>[] = [
      {
        id: 'evt-1',
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: {
          id: '1',
          email: 'test@example.com',
          name: 'Test',
          age: 'twenty-five', // Should be integer
        },
        timestamp: Date.now(),
      },
    ]

    const report = detectSchemaDrift(events, userContract)

    expect(report.hasDrift).toBe(true)
    expect(report.typeMismatches).toHaveLength(1)
    expect(report.typeMismatches[0]?.field).toBe('age')
    expect(report.typeMismatches[0]?.expectedType).toBe('integer')
    expect(report.typeMismatches[0]?.actualType).toBe('string')
  })

  it('analyzes both before and after states', () => {
    const events: ChangeEvent<User & { newField?: string }>[] = [
      {
        id: 'evt-1',
        operation: ChangeOperation.UPDATE,
        table: 'users',
        before: {
          id: '1',
          email: 'test@example.com',
          name: 'Test',
          oldField: 'should be detected',
        } as User & { oldField?: string },
        after: {
          id: '1',
          email: 'test@example.com',
          name: 'Test',
          newField: 'also detected',
        },
        timestamp: Date.now(),
      },
    ]

    const report = detectSchemaDrift(events, userContract)

    expect(report.hasDrift).toBe(true)
    expect(report.unexpectedFields).toContain('oldField')
    expect(report.unexpectedFields).toContain('newField')
  })
})

// ============================================================================
// TESTS: CDCContractStream
// ============================================================================

describe('CDCContractStream', () => {
  let stream: CDCContractStream<User>
  let validHandler: ReturnType<typeof vi.fn>
  let deadLetterHandler: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    validHandler = vi.fn()
    deadLetterHandler = vi.fn()

    stream = createCDCContractStream<User>({
      config: {
        contract: userContract,
        onSchemaViolation: 'dead-letter',
      },
      onValid: validHandler,
      onDeadLetter: deadLetterHandler,
    })

    await stream.initialize()
  })

  it('processes valid events and calls onValid handler', async () => {
    const user: User = { id: '1', email: 'test@example.com', name: 'Test' }
    const event = createUserInsertEvent(user)

    const result = await stream.processEvent(event)

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true)
    expect(validHandler).toHaveBeenCalledWith(expect.objectContaining({ isValid: true }))
    expect(deadLetterHandler).not.toHaveBeenCalled()
  })

  it('sends invalid events to dead letter queue', async () => {
    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)

    const result = await stream.processEvent(event)

    expect(result).toBeNull()
    expect(validHandler).not.toHaveBeenCalled()
    expect(deadLetterHandler).toHaveBeenCalled()

    const dlq = stream.getDeadLetterQueue()
    expect(dlq).toHaveLength(1)
    expect(dlq[0]?.reason).toBe('validation_failed')
    expect(dlq[0]?.errors.length).toBeGreaterThan(0)
  })

  it('skips invalid events when configured', async () => {
    stream = createCDCContractStream<User>({
      config: {
        contract: userContract,
        onSchemaViolation: 'skip',
      },
      onValid: validHandler,
    })
    await stream.initialize()

    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)

    const result = await stream.processEvent(event)

    expect(result).toBeNull()
    expect(validHandler).not.toHaveBeenCalled()
    expect(stream.getDeadLetterQueue()).toHaveLength(0)
    expect(stream.getMetrics().skippedEvents).toBe(1)
  })

  it('passes through invalid events when configured', async () => {
    stream = createCDCContractStream<User>({
      config: {
        contract: userContract,
        onSchemaViolation: 'pass-through',
      },
      onValid: validHandler,
    })
    await stream.initialize()

    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)

    const result = await stream.processEvent(event)

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(false)
    expect(validHandler).toHaveBeenCalledWith(expect.objectContaining({ isValid: false }))
  })

  it('transforms invalid events when configured', async () => {
    stream = createCDCContractStream<User>({
      config: {
        contract: userContract,
        onSchemaViolation: 'transform',
        transformOnFailure: (event) => ({
          ...event,
          after: {
            ...event.after!,
            email: 'default@example.com',
            name: 'Default User',
          },
        }),
      },
      onValid: validHandler,
    })
    await stream.initialize()

    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)

    const result = await stream.processEvent(event)

    expect(result).not.toBeNull()
    expect(result?.isValid).toBe(true)
    expect(result?.transformations).toContain('Applied custom transformation')
    expect(stream.getMetrics().transformedEvents).toBe(1)
  })

  it('processes multiple events', async () => {
    const events: ChangeEvent<User>[] = [
      createUserInsertEvent({ id: '1', email: 'a@b.com', name: 'A' }),
      createUserInsertEvent({ id: '2' } as User), // Invalid
      createUserInsertEvent({ id: '3', email: 'c@d.com', name: 'C' }),
    ]

    const results = await stream.processEvents(events)

    expect(results).toHaveLength(2) // Only valid events
    expect(stream.getDeadLetterQueue()).toHaveLength(1)
    expect(stream.getMetrics().totalEvents).toBe(3)
    expect(stream.getMetrics().validEvents).toBe(2)
    expect(stream.getMetrics().invalidEvents).toBe(1)
  })

  it('detects schema drift when enabled', async () => {
    const driftHandler = vi.fn()

    stream = createCDCContractStream<User>({
      config: { contract: userContract },
      onValid: validHandler,
      onSchemaDrift: driftHandler,
      detectSchemaDrift: true,
      driftSampleSize: 2,
    })
    await stream.initialize()

    const events: ChangeEvent<User & { unexpectedField?: string }>[] = [
      createUserInsertEvent({
        id: '1',
        email: 'a@b.com',
        name: 'A',
        unexpectedField: 'drift',
      } as User & { unexpectedField: string }),
      createUserInsertEvent({
        id: '2',
        email: 'c@d.com',
        name: 'B',
        unexpectedField: 'drift',
      } as User & { unexpectedField: string }),
    ]

    await stream.processEvents(events)

    expect(driftHandler).toHaveBeenCalled()
    const report: SchemaDriftReport = driftHandler.mock.calls[0][0]
    expect(report.hasDrift).toBe(true)
    expect(report.unexpectedFields).toContain('unexpectedField')
  })

  it('tracks metrics correctly', async () => {
    const events: ChangeEvent<User>[] = [
      createUserInsertEvent({ id: '1', email: 'a@b.com', name: 'A' }),
      createUserInsertEvent({ id: '2' } as User), // Invalid - missing required
      createUserInsertEvent({ id: '3', email: 'c@d.com', name: 'C', age: -1 }), // Invalid - negative age
    ]

    await stream.processEvents(events)

    const metrics = stream.getMetrics()
    expect(metrics.totalEvents).toBe(3)
    expect(metrics.validEvents).toBe(1)
    expect(metrics.invalidEvents).toBe(2)
    expect(metrics.deadLetteredEvents).toBe(2)
    expect(metrics.errorsByType['required']).toBeGreaterThan(0)
    expect(metrics.lastValidationAt).not.toBeNull()
    expect(metrics.avgValidationTimeMs).toBeGreaterThan(0)
  })

  it('can clear dead letter queue', async () => {
    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)

    await stream.processEvent(event)
    expect(stream.getDeadLetterQueue()).toHaveLength(1)

    const cleared = stream.clearDeadLetterQueue()
    expect(cleared).toHaveLength(1)
    expect(stream.getDeadLetterQueue()).toHaveLength(0)
  })

  it('can retry dead-lettered events', async () => {
    // First, send an invalid event
    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)
    await stream.processEvent(event)

    // Update the contract to be more lenient
    await stream.updateContract({
      ...userContract,
      schema: {
        ...userContract.schema,
        required: ['id'], // Only require id
      },
    })

    // Retry
    const retried = await stream.retryDeadLetteredEvents()
    expect(retried).toHaveLength(1)
    expect(stream.getDeadLetterQueue()).toHaveLength(0)
  })

  it('enforces max dead letter queue size', async () => {
    stream = createCDCContractStream<User>({
      config: { contract: userContract },
      maxDeadLetterQueueSize: 2,
    })
    await stream.initialize()

    // Send 3 invalid events
    for (let i = 0; i < 3; i++) {
      const event = createUserInsertEvent({ id: `${i}` } as User)
      await stream.processEvent(event)
    }

    const dlq = stream.getDeadLetterQueue()
    expect(dlq).toHaveLength(2)
    // Should have kept the last 2, not the first one
    expect(dlq[0]?.originalEvent.after?.id).toBe('1')
    expect(dlq[1]?.originalEvent.after?.id).toBe('2')
  })

  it('can reset metrics', async () => {
    const event = createUserInsertEvent({ id: '1', email: 'a@b.com', name: 'A' })
    await stream.processEvent(event)

    expect(stream.getMetrics().totalEvents).toBe(1)

    stream.resetMetrics()

    expect(stream.getMetrics().totalEvents).toBe(0)
    expect(stream.getMetrics().validEvents).toBe(0)
  })

  it('calls custom error handler', async () => {
    const errorHandler = vi.fn()

    stream = createCDCContractStream<User>({
      config: {
        contract: userContract,
        onError: errorHandler,
      },
    })
    await stream.initialize()

    const invalidUser = { id: '1' } as User
    const event = createUserInsertEvent(invalidUser)
    await stream.processEvent(event)

    expect(errorHandler).toHaveBeenCalled()
    const [eventArg, errorsArg] = errorHandler.mock.calls[0]
    expect(eventArg.id).toBe(event.id)
    expect(errorsArg.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// TESTS: withContract
// ============================================================================

describe('withContract', () => {
  it('creates a CDCContractStream with simplified API', async () => {
    const stream = withContract<User>({
      contract: userContract,
      mode: 'strict',
    })

    await stream.initialize()

    const user: User = { id: '1', email: 'test@example.com', name: 'Test' }
    const event = createUserInsertEvent(user)
    const result = await stream.processEvent(event)

    expect(result?.isValid).toBe(true)
  })
})

// ============================================================================
// TESTS: createValidator
// ============================================================================

describe('createValidator', () => {
  it('creates a reusable validation function', () => {
    const validate = createValidator<User>(userContract)

    const validUser: User = { id: '1', email: 'test@example.com', name: 'Test' }
    const validEvent = createUserInsertEvent(validUser)
    const validResult = validate(validEvent)
    expect(validResult.isValid).toBe(true)

    const invalidUser = { id: '1' } as User
    const invalidEvent = createUserInsertEvent(invalidUser)
    const invalidResult = validate(invalidEvent)
    expect(invalidResult.isValid).toBe(false)
  })

  it('respects validation options', () => {
    const validate = createValidator<User>(userContract, {
      validateBefore: false,
      validateAfter: true,
      mode: 'lenient',
    })

    const before = { id: '1' } as User // Invalid
    const after: User = { id: '1', email: 'test@example.com', name: 'Test' }
    const event = createUserUpdateEvent(before, after)

    const result = validate(event)
    expect(result.isValid).toBe(true)
    expect(result.beforeValidation).toBeUndefined()
  })
})

// ============================================================================
// TESTS: Contract Registry Integration
// ============================================================================

describe('Contract Registry Integration', () => {
  it('loads contract from registry by name', async () => {
    const registry = createRegistry()
    await registry.register({
      name: 'User',
      version: '1.0.0',
      schema: userContract.schema,
    })

    const stream = createCDCContractStream<User>({
      config: {
        contract: 'User',
        registry,
      },
    })

    await stream.initialize()

    const user: User = { id: '1', email: 'test@example.com', name: 'Test' }
    const event = createUserInsertEvent(user)
    const result = await stream.processEvent(event)

    expect(result?.isValid).toBe(true)
    expect(result?.contractName).toBe('User')
  })

  it('loads specific version from registry', async () => {
    const registry = createRegistry()
    await registry.register({
      name: 'User',
      version: '1.0.0',
      schema: userContract.schema,
    })
    await registry.register({
      name: 'User',
      version: '2.0.0',
      schema: {
        ...userContract.schema,
        required: ['id', 'email', 'name', 'age'], // age now required
      },
    })

    // Use version 1.0.0
    const stream = createCDCContractStream<User>({
      config: {
        contract: 'User',
        registry,
        schemaVersion: '1.0.0',
      },
    })

    await stream.initialize()

    // User without age is valid in v1
    const user: User = { id: '1', email: 'test@example.com', name: 'Test' }
    const event = createUserInsertEvent(user)
    const result = await stream.processEvent(event)

    expect(result?.isValid).toBe(true)
    expect(result?.contractVersion).toBe('1.0.0')
  })

  it('can update contract dynamically', async () => {
    const registry = createRegistry()
    await registry.register({
      name: 'User',
      version: '1.0.0',
      schema: userContract.schema,
    })
    await registry.register({
      name: 'User',
      version: '2.0.0',
      schema: {
        ...userContract.schema,
        required: ['id'], // Relaxed requirements
      },
    })

    const stream = createCDCContractStream<User>({
      config: {
        contract: 'User',
        registry,
        schemaVersion: '1.0.0',
      },
    })

    await stream.initialize()

    // Invalid in v1
    const invalidUser = { id: '1' } as User
    const event1 = createUserInsertEvent(invalidUser)
    const result1 = await stream.processEvent(event1)
    expect(result1).toBeNull()

    // Update to v2
    await stream.updateContract('User')

    // Now valid in v2
    const event2 = createUserInsertEvent(invalidUser)
    const result2 = await stream.processEvent(event2)
    expect(result2?.isValid).toBe(true)
  })
})

// ============================================================================
// TESTS: Array Validation
// ============================================================================

describe('Array Validation', () => {
  it('validates array items', async () => {
    const stream = createCDCContractStream<Product>({
      config: { contract: productContract },
    })
    await stream.initialize()

    const validProduct: Product = {
      sku: 'ABC123',
      name: 'Test Product',
      price: 19.99,
      tags: ['electronics', 'gadgets'],
    }

    const event: ChangeEvent<Product> = {
      id: 'evt-1',
      operation: ChangeOperation.INSERT,
      table: 'products',
      before: null,
      after: validProduct,
      timestamp: Date.now(),
    }

    const result = await stream.processEvent(event)
    expect(result?.isValid).toBe(true)
  })

  it('validates maxItems constraint', async () => {
    const stream = createCDCContractStream<Product>({
      config: { contract: productContract },
    })
    await stream.initialize()

    const invalidProduct: Product = {
      sku: 'ABC123',
      name: 'Test Product',
      price: 19.99,
      tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'], // > 10
    }

    const event: ChangeEvent<Product> = {
      id: 'evt-1',
      operation: ChangeOperation.INSERT,
      table: 'products',
      before: null,
      after: invalidProduct,
      timestamp: Date.now(),
    }

    const result = await stream.processEvent(event)
    expect(result).toBeNull()

    const dlq = stream.getDeadLetterQueue()
    expect(dlq[0]?.errors.some((e) => e.keyword === 'maxItems')).toBe(true)
  })

  it('validates array item types', async () => {
    const stream = createCDCContractStream<Product>({
      config: { contract: productContract },
    })
    await stream.initialize()

    const invalidProduct = {
      sku: 'ABC123',
      name: 'Test Product',
      price: 19.99,
      tags: [123, 456], // Should be strings
    } as unknown as Product

    const event: ChangeEvent<Product> = {
      id: 'evt-1',
      operation: ChangeOperation.INSERT,
      table: 'products',
      before: null,
      after: invalidProduct,
      timestamp: Date.now(),
    }

    const result = await stream.processEvent(event)
    expect(result).toBeNull()

    const dlq = stream.getDeadLetterQueue()
    expect(dlq[0]?.errors.some((e) => e.path?.includes('[0]'))).toBe(true)
  })
})

// ============================================================================
// TESTS: Nested Object Validation
// ============================================================================

describe('Nested Object Validation', () => {
  it('validates nested objects', async () => {
    const stream = createCDCContractStream<User>({
      config: { contract: userContract },
    })
    await stream.initialize()

    const user: User = {
      id: '1',
      email: 'test@example.com',
      name: 'Test',
      metadata: {
        createdAt: Date.now(),
      },
    }

    const event = createUserInsertEvent(user)
    const result = await stream.processEvent(event)

    // Debug: check dead letter queue if validation failed
    if (!result) {
      const dlq = stream.getDeadLetterQueue()
      console.log('DLQ Errors:', JSON.stringify(dlq[0]?.errors, null, 2))
    }

    expect(result?.isValid).toBe(true)
  })

  it('validates nested object field types', async () => {
    const stream = createCDCContractStream<User>({
      config: { contract: userContract },
    })
    await stream.initialize()

    const user = {
      id: '1',
      email: 'test@example.com',
      name: 'Test',
      metadata: {
        createdAt: 'not-a-number', // Should be number
      },
    } as unknown as User

    const event = createUserInsertEvent(user)
    const result = await stream.processEvent(event)
    expect(result).toBeNull()

    const dlq = stream.getDeadLetterQueue()
    expect(dlq[0]?.errors.some((e) => e.path === 'metadata.createdAt')).toBe(true)
  })
})

// ============================================================================
// TESTS: Performance
// ============================================================================

describe('Performance', () => {
  it('validates events efficiently', async () => {
    const stream = createCDCContractStream<User>({
      config: { contract: userContract },
      collectMetrics: true,
    })
    await stream.initialize()

    const events: ChangeEvent<User>[] = []
    for (let i = 0; i < 100; i++) {
      events.push(
        createUserInsertEvent({
          id: `user-${i}`,
          email: `user${i}@example.com`,
          name: `User ${i}`,
          age: 20 + (i % 50),
          active: i % 2 === 0,
        })
      )
    }

    const startTime = performance.now()
    await stream.processEvents(events)
    const totalTime = performance.now() - startTime

    const metrics = stream.getMetrics()
    expect(metrics.totalEvents).toBe(100)
    expect(metrics.validEvents).toBe(100)
    // Should complete in reasonable time (< 5ms per event on average)
    expect(metrics.avgValidationTimeMs).toBeLessThan(5)
    // Total processing should be under 500ms
    expect(totalTime).toBeLessThan(500)
  })
})
