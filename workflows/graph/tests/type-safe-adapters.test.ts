/**
 * Type-Safe Workflow Adapters Tests
 *
 * TDD RED Phase: Tests for replacing unsafe 'as unknown as T' casts
 * in workflow adapters with proper type guards.
 *
 * The goal is to eliminate runtime type safety gaps where:
 * 1. instance-thing.ts casts GraphThing.data to WorkflowInstanceDataForStore
 * 2. step-execution-store.ts casts relationship.data to StepExecutionData
 *
 * These tests verify that:
 * 1. Type guards properly validate data structures
 * 2. Invalid data is rejected with clear errors
 * 3. Valid data passes type narrowing
 * 4. Edge cases are handled (null, undefined, wrong types)
 *
 * @see dotdo-ziocd - [RED] Replace unsafe as unknown as T in workflow adapters
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import {
  isWorkflowInstanceDataForStore,
  isStepExecutionData,
  assertWorkflowInstanceDataForStore,
  assertStepExecutionData,
  WorkflowInstanceDataForStoreValidationError,
  StepExecutionDataValidationError,
} from '../type-guards'

// ============================================================================
// TYPE DEFINITIONS (matching the actual types in instance-thing.ts)
// ============================================================================

/**
 * WorkflowInstance data structure (without state - state is in relationships).
 * This mirrors the interface in instance-thing.ts.
 */
interface WorkflowInstanceDataForStore {
  workflowId: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  currentStep?: string | number
  error?: string
}

/**
 * Step execution relationship data.
 * This mirrors the interface in step-execution-store.ts.
 */
interface StepExecutionData {
  /** Name of the step being executed */
  stepName: string
  /** Index of the step in the workflow (0-based) */
  stepIndex: number
  /** Duration in milliseconds (only for completed/failed steps) */
  duration?: number
  /** Error message (only for failed steps) */
  error?: string
  /** Timestamp when step started */
  startedAt?: number
  /** Timestamp when step completed */
  completedAt?: number
}

// ============================================================================
// 1. isWorkflowInstanceDataForStore TYPE GUARD TESTS
// ============================================================================

describe('isWorkflowInstanceDataForStore type guard', () => {
  describe('valid WorkflowInstanceDataForStore', () => {
    it('returns true for minimal valid data', () => {
      const data = {
        workflowId: 'workflow:expense-approval',
        input: {},
      }
      expect(isWorkflowInstanceDataForStore(data)).toBe(true)
    })

    it('returns true for complete data with all optional fields', () => {
      const data: WorkflowInstanceDataForStore = {
        workflowId: 'workflow:expense-approval',
        input: { amount: 1500, description: 'Conference travel' },
        output: { approved: true, approvedBy: 'manager' },
        currentStep: 'validateExpense',
        error: undefined,
      }
      expect(isWorkflowInstanceDataForStore(data)).toBe(true)
    })

    it('returns true with numeric currentStep', () => {
      const data = {
        workflowId: 'workflow:order-processing',
        input: { orderId: 'ORD-123' },
        currentStep: 3,
      }
      expect(isWorkflowInstanceDataForStore(data)).toBe(true)
    })

    it('returns true with string currentStep', () => {
      const data = {
        workflowId: 'workflow:order-processing',
        input: {},
        currentStep: 'finalizeOrder',
      }
      expect(isWorkflowInstanceDataForStore(data)).toBe(true)
    })

    it('returns true with error field set', () => {
      const data = {
        workflowId: 'workflow:payment',
        input: { amount: 100 },
        error: 'Payment gateway timeout',
      }
      expect(isWorkflowInstanceDataForStore(data)).toBe(true)
    })

    it('returns true with complex nested input', () => {
      const data = {
        workflowId: 'workflow:complex',
        input: {
          user: { name: 'John', roles: ['admin', 'user'] },
          items: [{ id: 1, qty: 2 }, { id: 2, qty: 1 }],
          metadata: { timestamp: Date.now(), source: 'api' },
        },
      }
      expect(isWorkflowInstanceDataForStore(data)).toBe(true)
    })
  })

  describe('invalid WorkflowInstanceDataForStore', () => {
    it('returns false for null', () => {
      expect(isWorkflowInstanceDataForStore(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isWorkflowInstanceDataForStore(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isWorkflowInstanceDataForStore({})).toBe(false)
    })

    it('returns false for string', () => {
      expect(isWorkflowInstanceDataForStore('not an object')).toBe(false)
    })

    it('returns false for number', () => {
      expect(isWorkflowInstanceDataForStore(42)).toBe(false)
    })

    it('returns false for array', () => {
      expect(isWorkflowInstanceDataForStore([{ workflowId: 'x', input: {} }])).toBe(false)
    })

    it('returns false when workflowId is missing', () => {
      expect(isWorkflowInstanceDataForStore({ input: {} })).toBe(false)
    })

    it('returns false when input is missing', () => {
      expect(isWorkflowInstanceDataForStore({ workflowId: 'workflow:test' })).toBe(false)
    })

    it('returns false when workflowId is not a string', () => {
      expect(isWorkflowInstanceDataForStore({ workflowId: 123, input: {} })).toBe(false)
    })

    it('returns false when workflowId is null', () => {
      expect(isWorkflowInstanceDataForStore({ workflowId: null, input: {} })).toBe(false)
    })

    it('returns false when input is not an object', () => {
      expect(isWorkflowInstanceDataForStore({ workflowId: 'workflow:test', input: 'string' })).toBe(false)
    })

    it('returns false when input is an array', () => {
      expect(isWorkflowInstanceDataForStore({ workflowId: 'workflow:test', input: [] })).toBe(false)
    })

    it('returns false when input is null', () => {
      expect(isWorkflowInstanceDataForStore({ workflowId: 'workflow:test', input: null })).toBe(false)
    })

    it('returns false when currentStep is not a string or number', () => {
      expect(isWorkflowInstanceDataForStore({
        workflowId: 'workflow:test',
        input: {},
        currentStep: { name: 'step1' },
      })).toBe(false)
    })

    it('returns false when error is not a string', () => {
      expect(isWorkflowInstanceDataForStore({
        workflowId: 'workflow:test',
        input: {},
        error: { message: 'error' },
      })).toBe(false)
    })

    it('returns false when output is not an object', () => {
      expect(isWorkflowInstanceDataForStore({
        workflowId: 'workflow:test',
        input: {},
        output: 'not an object',
      })).toBe(false)
    })

    it('returns false when output is an array', () => {
      expect(isWorkflowInstanceDataForStore({
        workflowId: 'workflow:test',
        input: {},
        output: [1, 2, 3],
      })).toBe(false)
    })
  })
})

// ============================================================================
// 2. isStepExecutionData TYPE GUARD TESTS
// ============================================================================

describe('isStepExecutionData type guard', () => {
  describe('valid StepExecutionData', () => {
    it('returns true for minimal valid data', () => {
      const data = {
        stepName: 'validateExpense',
        stepIndex: 0,
      }
      expect(isStepExecutionData(data)).toBe(true)
    })

    it('returns true for complete data with all optional fields', () => {
      const data: StepExecutionData = {
        stepName: 'processPayment',
        stepIndex: 2,
        duration: 1500,
        error: undefined,
        startedAt: Date.now() - 1500,
        completedAt: Date.now(),
      }
      expect(isStepExecutionData(data)).toBe(true)
    })

    it('returns true with error field set', () => {
      const data = {
        stepName: 'failingStep',
        stepIndex: 1,
        error: 'Connection timeout',
        duration: 30000,
      }
      expect(isStepExecutionData(data)).toBe(true)
    })

    it('returns true with zero stepIndex', () => {
      const data = {
        stepName: 'firstStep',
        stepIndex: 0,
      }
      expect(isStepExecutionData(data)).toBe(true)
    })

    it('returns true with large stepIndex', () => {
      const data = {
        stepName: 'lastStep',
        stepIndex: 100,
      }
      expect(isStepExecutionData(data)).toBe(true)
    })

    it('returns true with zero duration', () => {
      const data = {
        stepName: 'fastStep',
        stepIndex: 0,
        duration: 0,
      }
      expect(isStepExecutionData(data)).toBe(true)
    })
  })

  describe('invalid StepExecutionData', () => {
    it('returns false for null', () => {
      expect(isStepExecutionData(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isStepExecutionData(undefined)).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(isStepExecutionData({})).toBe(false)
    })

    it('returns false for string', () => {
      expect(isStepExecutionData('not an object')).toBe(false)
    })

    it('returns false for array', () => {
      expect(isStepExecutionData([{ stepName: 'step', stepIndex: 0 }])).toBe(false)
    })

    it('returns false when stepName is missing', () => {
      expect(isStepExecutionData({ stepIndex: 0 })).toBe(false)
    })

    it('returns false when stepIndex is missing', () => {
      expect(isStepExecutionData({ stepName: 'step' })).toBe(false)
    })

    it('returns false when stepName is not a string', () => {
      expect(isStepExecutionData({ stepName: 123, stepIndex: 0 })).toBe(false)
    })

    it('returns false when stepName is null', () => {
      expect(isStepExecutionData({ stepName: null, stepIndex: 0 })).toBe(false)
    })

    it('returns false when stepIndex is not a number', () => {
      expect(isStepExecutionData({ stepName: 'step', stepIndex: '0' })).toBe(false)
    })

    it('returns false when stepIndex is NaN', () => {
      expect(isStepExecutionData({ stepName: 'step', stepIndex: NaN })).toBe(false)
    })

    it('returns false when stepIndex is negative', () => {
      expect(isStepExecutionData({ stepName: 'step', stepIndex: -1 })).toBe(false)
    })

    it('returns false when duration is not a number', () => {
      expect(isStepExecutionData({
        stepName: 'step',
        stepIndex: 0,
        duration: '1500',
      })).toBe(false)
    })

    it('returns false when duration is negative', () => {
      expect(isStepExecutionData({
        stepName: 'step',
        stepIndex: 0,
        duration: -100,
      })).toBe(false)
    })

    it('returns false when error is not a string', () => {
      expect(isStepExecutionData({
        stepName: 'step',
        stepIndex: 0,
        error: { message: 'error' },
      })).toBe(false)
    })

    it('returns false when startedAt is not a number', () => {
      expect(isStepExecutionData({
        stepName: 'step',
        stepIndex: 0,
        startedAt: '2024-01-01',
      })).toBe(false)
    })

    it('returns false when completedAt is not a number', () => {
      expect(isStepExecutionData({
        stepName: 'step',
        stepIndex: 0,
        completedAt: new Date(),
      })).toBe(false)
    })
  })
})

// ============================================================================
// 3. ASSERTION FUNCTION TESTS (throw on invalid data)
// ============================================================================

describe('assertWorkflowInstanceDataForStore', () => {
  it('does not throw for valid data', () => {
    const data = {
      workflowId: 'workflow:test',
      input: { key: 'value' },
    }
    expect(() => assertWorkflowInstanceDataForStore(data)).not.toThrow()
  })

  it('throws WorkflowInstanceDataForStoreValidationError for invalid data', () => {
    const data = { workflowId: 123, input: {} }
    expect(() => assertWorkflowInstanceDataForStore(data)).toThrow(WorkflowInstanceDataForStoreValidationError)
  })

  it('throws with descriptive message for missing workflowId', () => {
    const data = { input: {} }
    expect(() => assertWorkflowInstanceDataForStore(data)).toThrow(/workflowId.*required|missing.*workflowId/i)
  })

  it('throws with descriptive message for missing input', () => {
    const data = { workflowId: 'workflow:test' }
    expect(() => assertWorkflowInstanceDataForStore(data)).toThrow(/input.*required|missing.*input/i)
  })

  it('throws with descriptive message for wrong workflowId type', () => {
    const data = { workflowId: 123, input: {} }
    expect(() => assertWorkflowInstanceDataForStore(data)).toThrow(/workflowId.*string/i)
  })

  it('returns the data typed correctly when valid', () => {
    const data = {
      workflowId: 'workflow:test',
      input: { amount: 100 },
      output: { result: 'success' },
    }
    const validated = assertWorkflowInstanceDataForStore(data)
    expect(validated.workflowId).toBe('workflow:test')
    expect(validated.input).toEqual({ amount: 100 })
    expect(validated.output).toEqual({ result: 'success' })
  })
})

describe('assertStepExecutionData', () => {
  it('does not throw for valid data', () => {
    const data = {
      stepName: 'processOrder',
      stepIndex: 0,
    }
    expect(() => assertStepExecutionData(data)).not.toThrow()
  })

  it('throws StepExecutionDataValidationError for invalid data', () => {
    const data = { stepName: 123, stepIndex: 0 }
    expect(() => assertStepExecutionData(data)).toThrow(StepExecutionDataValidationError)
  })

  it('throws with descriptive message for missing stepName', () => {
    const data = { stepIndex: 0 }
    expect(() => assertStepExecutionData(data)).toThrow(/stepName.*required|missing.*stepName/i)
  })

  it('throws with descriptive message for missing stepIndex', () => {
    const data = { stepName: 'step' }
    expect(() => assertStepExecutionData(data)).toThrow(/stepIndex.*required|missing.*stepIndex/i)
  })

  it('throws with descriptive message for negative stepIndex', () => {
    const data = { stepName: 'step', stepIndex: -1 }
    expect(() => assertStepExecutionData(data)).toThrow(/stepIndex.*negative|non-negative/i)
  })

  it('returns the data typed correctly when valid', () => {
    const data = {
      stepName: 'finalStep',
      stepIndex: 5,
      duration: 1000,
      startedAt: 1704067200000,
      completedAt: 1704067201000,
    }
    const validated = assertStepExecutionData(data)
    expect(validated.stepName).toBe('finalStep')
    expect(validated.stepIndex).toBe(5)
    expect(validated.duration).toBe(1000)
  })
})

// ============================================================================
// 4. TYPE NARROWING TESTS (TypeScript compile-time verification)
// ============================================================================

describe('Type narrowing works correctly', () => {
  it('narrows WorkflowInstanceDataForStore correctly in conditionals', () => {
    const data: unknown = {
      workflowId: 'workflow:test',
      input: { amount: 100 },
      currentStep: 'step1',
    }

    if (isWorkflowInstanceDataForStore(data)) {
      // TypeScript should allow accessing properties here
      const _workflowId: string = data.workflowId
      const _input: Record<string, unknown> = data.input
      const _currentStep: string | number | undefined = data.currentStep

      expect(_workflowId).toBe('workflow:test')
      expect(_input).toEqual({ amount: 100 })
      expect(_currentStep).toBe('step1')
    } else {
      expect.fail('isWorkflowInstanceDataForStore should return true')
    }
  })

  it('narrows StepExecutionData correctly in conditionals', () => {
    const data: unknown = {
      stepName: 'validateExpense',
      stepIndex: 2,
      duration: 500,
    }

    if (isStepExecutionData(data)) {
      // TypeScript should allow accessing properties here
      const _stepName: string = data.stepName
      const _stepIndex: number = data.stepIndex
      const _duration: number | undefined = data.duration

      expect(_stepName).toBe('validateExpense')
      expect(_stepIndex).toBe(2)
      expect(_duration).toBe(500)
    } else {
      expect.fail('isStepExecutionData should return true')
    }
  })
})

// ============================================================================
// 5. INTEGRATION TESTS WITH SQLiteGraphStore
// ============================================================================

describe('Integration with SQLiteGraphStore', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('WorkflowInstance Thing data validation', () => {
    it('validates data retrieved from store as WorkflowInstanceDataForStore', async () => {
      // Create a Thing with valid instance data
      const instanceData = {
        workflowId: 'workflow:expense-approval',
        input: { amount: 1500 },
      }

      const thing = await store.createThing({
        id: 'instance:test-1',
        typeId: 101,
        typeName: 'WorkflowInstance',
        data: instanceData,
      })

      // Retrieve and validate
      const retrieved = await store.getThing('instance:test-1')
      expect(retrieved).not.toBeNull()

      // The data should pass the type guard
      expect(isWorkflowInstanceDataForStore(retrieved!.data)).toBe(true)

      // After type guard, we can safely access properties
      if (isWorkflowInstanceDataForStore(retrieved!.data)) {
        expect(retrieved!.data.workflowId).toBe('workflow:expense-approval')
        expect(retrieved!.data.input).toEqual({ amount: 1500 })
      }
    })

    it('detects corrupted/invalid instance data from store', async () => {
      // Create a Thing with corrupted data (missing required field)
      const corruptedData = {
        // workflowId is missing!
        input: { amount: 1500 },
      }

      await store.createThing({
        id: 'instance:corrupted',
        typeId: 101,
        typeName: 'WorkflowInstance',
        data: corruptedData as Record<string, unknown>,
      })

      const retrieved = await store.getThing('instance:corrupted')

      // The type guard should catch the invalid data
      expect(isWorkflowInstanceDataForStore(retrieved!.data)).toBe(false)
    })

    it('detects wrong type in instance data from store', async () => {
      // Create a Thing with wrong types
      const wrongTypeData = {
        workflowId: 12345, // Should be string
        input: 'not an object', // Should be object
      }

      await store.createThing({
        id: 'instance:wrong-types',
        typeId: 101,
        typeName: 'WorkflowInstance',
        data: wrongTypeData as Record<string, unknown>,
      })

      const retrieved = await store.getThing('instance:wrong-types')

      // The type guard should catch the wrong types
      expect(isWorkflowInstanceDataForStore(retrieved!.data)).toBe(false)
    })
  })

  describe('StepExecution Relationship data validation', () => {
    it('validates relationship data as StepExecutionData', async () => {
      // Create a Thing for the instance
      await store.createThing({
        id: 'instance:step-test',
        typeId: 101,
        typeName: 'WorkflowInstance',
        data: { workflowId: 'workflow:test', input: {} },
      })

      // Create a relationship with step execution data
      const stepData = {
        stepName: 'validateExpense',
        stepIndex: 0,
        startedAt: Date.now(),
      }

      await store.createRelationship({
        id: 'rel:execute:instance:step-test:validateExpense',
        verb: 'executing',
        from: 'instance:step-test',
        to: 'step:validateExpense',
        data: stepData,
      })

      // Query and validate
      const rels = await store.queryRelationshipsFrom('instance:step-test', { verb: 'executing' })
      expect(rels).toHaveLength(1)

      // The data should pass the type guard
      expect(isStepExecutionData(rels[0]!.data)).toBe(true)

      if (isStepExecutionData(rels[0]!.data)) {
        expect(rels[0]!.data.stepName).toBe('validateExpense')
        expect(rels[0]!.data.stepIndex).toBe(0)
      }
    })

    it('detects corrupted step execution data from store', async () => {
      await store.createThing({
        id: 'instance:step-corrupted',
        typeId: 101,
        typeName: 'WorkflowInstance',
        data: { workflowId: 'workflow:test', input: {} },
      })

      // Create relationship with corrupted data (missing stepIndex)
      const corruptedData = {
        stepName: 'validateExpense',
        // stepIndex is missing!
      }

      await store.createRelationship({
        id: 'rel:execute:instance:step-corrupted:validateExpense',
        verb: 'executing',
        from: 'instance:step-corrupted',
        to: 'step:validateExpense',
        data: corruptedData as Record<string, unknown>,
      })

      const rels = await store.queryRelationshipsFrom('instance:step-corrupted', { verb: 'executing' })

      // The type guard should catch the invalid data
      expect(isStepExecutionData(rels[0]!.data)).toBe(false)
    })
  })
})

// ============================================================================
// 6. ERROR CLASS TESTS
// ============================================================================

describe('Custom Error Classes', () => {
  describe('WorkflowInstanceDataForStoreValidationError', () => {
    it('is an instance of Error', () => {
      const error = new WorkflowInstanceDataForStoreValidationError('test error')
      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const error = new WorkflowInstanceDataForStoreValidationError('test error')
      expect(error.name).toBe('WorkflowInstanceDataForStoreValidationError')
    })

    it('preserves message', () => {
      const error = new WorkflowInstanceDataForStoreValidationError('Missing workflowId field')
      expect(error.message).toBe('Missing workflowId field')
    })

    it('can include invalid data in error', () => {
      const invalidData = { input: {} }
      const error = new WorkflowInstanceDataForStoreValidationError(
        'Missing workflowId field',
        invalidData
      )
      expect(error.invalidData).toBe(invalidData)
    })
  })

  describe('StepExecutionDataValidationError', () => {
    it('is an instance of Error', () => {
      const error = new StepExecutionDataValidationError('test error')
      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const error = new StepExecutionDataValidationError('test error')
      expect(error.name).toBe('StepExecutionDataValidationError')
    })

    it('preserves message', () => {
      const error = new StepExecutionDataValidationError('Missing stepName field')
      expect(error.message).toBe('Missing stepName field')
    })

    it('can include invalid data in error', () => {
      const invalidData = { stepIndex: 0 }
      const error = new StepExecutionDataValidationError('Missing stepName field', invalidData)
      expect(error.invalidData).toBe(invalidData)
    })
  })
})
