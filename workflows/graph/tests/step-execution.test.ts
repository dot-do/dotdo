/**
 * Step Execution as Relationships - Verb Form Tests
 *
 * TDD RED Phase: Failing tests for step execution tracked as Relationships
 * with verb forms encoding state.
 *
 * Key Insight: Step execution state is encoded via verb forms, not a status column.
 *
 * State Machine (via verb forms):
 * - 'execute' (action) = pending/intent to execute step
 * - 'executing' (activity) = step is currently running
 * - 'executed' (event) = step completed successfully
 *
 * Skip state machine:
 * - 'skip' (action) = intent to skip step
 * - 'skipping' (activity) = step being skipped
 * - 'skipped' (event) = step was skipped
 *
 * Expected Relationships:
 * - Step execution intent:
 *   { verb: 'execute', from: 'instance:123', to: 'step:validate-expense', data: {...} }
 * - Step in-progress:
 *   { verb: 'executing', from: 'instance:123', to: null, data: {...} }
 * - Step completed:
 *   { verb: 'executed', from: 'instance:123', to: 'result:step-output-url', data: {...} }
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-tn7hu - [RED] Step execution as Relationships - verb form tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import type { GraphRelationship } from '../../../db/graph/types'

// ============================================================================
// EXPECTED API - StepExecutionStore (NOT YET IMPLEMENTED)
// The tests below will fail until this is implemented
// ============================================================================

/**
 * Step execution state derived from verb form
 */
type StepExecutionState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/**
 * Step execution relationship data
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

/**
 * Step execution relationship representing a step's execution state
 */
interface StepExecutionRelationship extends GraphRelationship {
  verb: 'execute' | 'executing' | 'executed' | 'skip' | 'skipping' | 'skipped'
  data: StepExecutionData | null
}

/**
 * Options for creating a step execution
 */
interface CreateStepExecutionInput {
  /** Workflow instance ID */
  instanceId: string
  /** Step identifier (e.g., 'step:validate-expense') */
  stepId: string
  /** Step name */
  stepName: string
  /** Step index (0-based) */
  stepIndex: number
}

/**
 * Options for completing a step execution
 */
interface CompleteStepExecutionInput {
  /** Result URL pointing to step output */
  resultTo: string
  /** Duration in milliseconds */
  duration: number
}

/**
 * Options for failing a step execution
 */
interface FailStepExecutionInput {
  /** Error that caused the failure */
  error: Error
  /** Duration in milliseconds */
  duration: number
}

/**
 * Query options for step executions
 */
interface QueryStepExecutionOptions {
  /** Filter by workflow instance ID */
  instanceId?: string
  /** Filter by step name */
  stepName?: string
  /** Limit number of results */
  limit?: number
}

/**
 * StepExecutionStore interface (to be implemented)
 * Encapsulates step execution tracking as relationships with verb forms.
 */
interface StepExecutionStore {
  // Create step execution in pending state ('execute' verb)
  createStepExecution(input: CreateStepExecutionInput): Promise<StepExecutionRelationship>

  // Start step execution (transition to 'executing' verb)
  startStepExecution(instanceId: string, stepName: string): Promise<StepExecutionRelationship>

  // Complete step execution (transition to 'executed' verb)
  completeStepExecution(
    instanceId: string,
    stepName: string,
    input: CompleteStepExecutionInput
  ): Promise<StepExecutionRelationship>

  // Fail step execution (transition to 'executed' verb with error data)
  failStepExecution(
    instanceId: string,
    stepName: string,
    input: FailStepExecutionInput
  ): Promise<StepExecutionRelationship>

  // Skip step execution (transition through skip -> skipping -> skipped)
  skipStepExecution(instanceId: string, stepName: string): Promise<StepExecutionRelationship>

  // Get current step execution state
  getStepExecutionState(instanceId: string, stepName: string): Promise<StepExecutionState | null>

  // Get step execution relationship
  getStepExecution(instanceId: string, stepName: string): Promise<StepExecutionRelationship | null>

  // Query step executions by state
  queryStepsByState(
    state: StepExecutionState,
    options?: QueryStepExecutionOptions
  ): Promise<StepExecutionRelationship[]>

  // Query all step executions for a workflow instance
  queryStepsByInstance(instanceId: string): Promise<StepExecutionRelationship[]>
}

/**
 * Factory function to create StepExecutionStore.
 * This will fail until the implementation exists.
 */
function createStepExecutionStore(graphStore: SQLiteGraphStore): StepExecutionStore {
  // This will throw an error - the implementation doesn't exist yet (RED phase)
  throw new Error('StepExecutionStore not yet implemented - this is the RED phase')
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for WorkflowInstance Things */
const WORKFLOW_INSTANCE_TYPE_ID = 101

/** Type name for WorkflowInstance Things */
const WORKFLOW_INSTANCE_TYPE_NAME = 'WorkflowInstance'

/** Type ID for Step Things */
const STEP_TYPE_ID = 103

/** Type name for Step Things */
const STEP_TYPE_NAME = 'Step'

/** Type ID for Result Things */
const RESULT_TYPE_ID = 102

/** Type name for Result Things */
const RESULT_TYPE_NAME = 'Result'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const testWorkflowId = 'workflow:expense-approval'
const testInstanceId = 'instance:exp-001'

const testSteps = [
  { id: 'step:validate-expense', name: 'validateExpense', index: 0 },
  { id: 'step:route-to-manager', name: 'routeToManager', index: 1 },
  { id: 'step:await-approval', name: 'awaitApproval', index: 2 },
  { id: 'step:process-payment', name: 'processPayment', index: 3 },
  { id: 'step:send-confirmation', name: 'sendConfirmation', index: 4 },
]

// ============================================================================
// TEST SUITE: Step Execution as Relationships
// ============================================================================

describe('Step Execution as Relationships with Verb Forms', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    // Create fresh in-memory SQLite store for each test
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // Seed workflow instance
    await store.createThing({
      id: testInstanceId,
      typeId: WORKFLOW_INSTANCE_TYPE_ID,
      typeName: WORKFLOW_INSTANCE_TYPE_NAME,
      data: {
        workflowId: testWorkflowId,
        input: { amount: 1500, description: 'Conference travel' },
        stateVerb: 'starting', // Instance is running
      },
    })

    // Seed step definitions
    for (const step of testSteps) {
      await store.createThing({
        id: step.id,
        typeId: STEP_TYPE_ID,
        typeName: STEP_TYPE_NAME,
        data: { name: step.name, index: step.index },
      })
    }
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // Test Case 1: Step execution creates 'execute' action relationship
  // ==========================================================================

  describe('Step execution creates execute action relationship', () => {
    it('creates execute relationship for step in pending state (action form)', async () => {
      // Create 'execute' relationship = intent to execute step
      const executeRel = await store.createRelationship({
        id: `rel:execute:${testInstanceId}:${testSteps[0]!.name}`,
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[0]!.id,
        data: {
          stepName: testSteps[0]!.name,
          stepIndex: testSteps[0]!.index,
        },
      })

      expect(executeRel.verb).toBe('execute')
      expect(executeRel.from).toBe(testInstanceId)
      expect(executeRel.to).toBe(testSteps[0]!.id)
      expect(executeRel.data).toEqual({
        stepName: 'validateExpense',
        stepIndex: 0,
      })
    })

    it('from field is the workflow instance ID', async () => {
      const executeRel = await store.createRelationship({
        id: 'rel:execute:test-from',
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[0]!.id,
        data: { stepName: testSteps[0]!.name, stepIndex: 0 },
      })

      expect(executeRel.from).toBe(testInstanceId)
      expect(executeRel.from).toMatch(/^instance:/)
    })

    it('to field points to the step definition', async () => {
      const executeRel = await store.createRelationship({
        id: 'rel:execute:test-to',
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[1]!.id,
        data: { stepName: testSteps[1]!.name, stepIndex: 1 },
      })

      expect(executeRel.to).toBe(testSteps[1]!.id)
      expect(executeRel.to).toMatch(/^step:/)
    })

    it('data contains stepName and stepIndex', async () => {
      const stepData = {
        stepName: 'processPayment',
        stepIndex: 3,
      }

      const executeRel = await store.createRelationship({
        id: 'rel:execute:test-data',
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[3]!.id,
        data: stepData,
      })

      expect(executeRel.data).toBeDefined()
      const data = executeRel.data as StepExecutionData
      expect(data.stepName).toBe('processPayment')
      expect(data.stepIndex).toBe(3)
    })
  })

  // ==========================================================================
  // Test Case 2: execute -> executing -> executed state transitions
  // ==========================================================================

  describe('execute -> executing -> executed state transitions', () => {
    it('transitions from execute (pending) to executing (in-progress)', async () => {
      // Create initial 'execute' relationship (pending)
      await store.createRelationship({
        id: 'rel:execute:transition-1',
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[0]!.id,
        data: { stepName: testSteps[0]!.name, stepIndex: 0 },
      })

      // Delete execute and create executing (in-progress)
      await store.deleteRelationship('rel:execute:transition-1')
      const executingRel = await store.createRelationship({
        id: 'rel:executing:transition-1',
        verb: 'executing',
        from: testInstanceId,
        to: testSteps[0]!.id, // to can be the step during execution
        data: {
          stepName: testSteps[0]!.name,
          stepIndex: 0,
          startedAt: Date.now(),
        },
      })

      expect(executingRel.verb).toBe('executing')
      expect(executingRel.from).toBe(testInstanceId)
    })

    it('transitions from executing (in-progress) to executed (completed)', async () => {
      const startTime = Date.now()

      // Create executing relationship
      await store.createRelationship({
        id: 'rel:executing:transition-2',
        verb: 'executing',
        from: testInstanceId,
        to: testSteps[0]!.id,
        data: { stepName: testSteps[0]!.name, stepIndex: 0, startedAt: startTime },
      })

      // Create result Thing
      const resultId = `result:${testInstanceId}:${testSteps[0]!.name}`
      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { validated: true, amount: 1500 },
      })

      // Delete executing and create executed (completed)
      await store.deleteRelationship('rel:executing:transition-2')
      const endTime = Date.now()
      const executedRel = await store.createRelationship({
        id: 'rel:executed:transition-2',
        verb: 'executed',
        from: testInstanceId,
        to: resultId, // Points to the result
        data: {
          stepName: testSteps[0]!.name,
          stepIndex: 0,
          duration: endTime - startTime,
          completedAt: endTime,
        },
      })

      expect(executedRel.verb).toBe('executed')
      expect(executedRel.to).toBe(resultId)
      expect(executedRel.to).toMatch(/^result:/)
    })

    it('full lifecycle: execute -> executing -> executed', async () => {
      const stepName = testSteps[0]!.name
      const stepId = testSteps[0]!.id

      // 1. Create execute (pending)
      await store.createRelationship({
        id: `rel:execute:lifecycle:${stepName}`,
        verb: 'execute',
        from: testInstanceId,
        to: stepId,
        data: { stepName, stepIndex: 0 },
      })

      // Verify pending state
      const pendingRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'execute' })
      expect(pendingRels).toHaveLength(1)

      // 2. Transition to executing (running)
      await store.deleteRelationship(`rel:execute:lifecycle:${stepName}`)
      const startTime = Date.now()
      await store.createRelationship({
        id: `rel:executing:lifecycle:${stepName}`,
        verb: 'executing',
        from: testInstanceId,
        to: stepId,
        data: { stepName, stepIndex: 0, startedAt: startTime },
      })

      // Verify running state
      const runningRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executing' })
      expect(runningRels).toHaveLength(1)

      // 3. Create result and transition to executed (completed)
      const resultId = `result:${testInstanceId}:${stepName}`
      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { success: true },
      })

      await store.deleteRelationship(`rel:executing:lifecycle:${stepName}`)
      const endTime = Date.now()
      await store.createRelationship({
        id: `rel:executed:lifecycle:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: resultId,
        data: {
          stepName,
          stepIndex: 0,
          duration: endTime - startTime,
          completedAt: endTime,
        },
      })

      // Verify completed state
      const completedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executed' })
      expect(completedRels).toHaveLength(1)
      expect(completedRels[0]!.to).toBe(resultId)
    })
  })

  // ==========================================================================
  // Test Case 3: Step output stored in executed relationship's to field
  // ==========================================================================

  describe('Step output stored in executed relationship to field', () => {
    it('executed relationship to field points to result Thing', async () => {
      const stepName = testSteps[0]!.name
      const resultId = `result:${testInstanceId}:${stepName}`

      // Create result Thing with step output
      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: {
          validated: true,
          validatedAmount: 1500,
          validationTimestamp: Date.now(),
        },
      })

      // Create executed relationship pointing to result
      const executedRel = await store.createRelationship({
        id: `rel:executed:output:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: resultId,
        data: { stepName, stepIndex: 0, duration: 150 },
      })

      expect(executedRel.to).toBe(resultId)

      // Verify result can be retrieved
      const result = await store.getThing(resultId)
      expect(result).not.toBeNull()
      expect(result!.data).toEqual({
        validated: true,
        validatedAmount: 1500,
        validationTimestamp: expect.any(Number),
      })
    })

    it('can traverse from instance to step output via executed relationship', async () => {
      const stepName = testSteps[1]!.name
      const resultId = `result:${testInstanceId}:${stepName}`

      // Create result
      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { managerId: 'manager-jane', routedAt: Date.now() },
      })

      // Create executed relationship
      await store.createRelationship({
        id: `rel:executed:traverse:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: resultId,
        data: { stepName, stepIndex: 1, duration: 50 },
      })

      // Traverse: instance -> executed relationships -> results
      const executedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executed' })
      expect(executedRels).toHaveLength(1)

      const resultUrl = executedRels[0]!.to
      const result = await store.getThing(resultUrl)
      expect(result).not.toBeNull()
      expect((result!.data as Record<string, unknown>).managerId).toBe('manager-jane')
    })

    it('multiple steps have separate result references', async () => {
      // Execute and complete multiple steps
      for (let i = 0; i < 3; i++) {
        const step = testSteps[i]!
        const resultId = `result:${testInstanceId}:${step.name}`

        await store.createThing({
          id: resultId,
          typeId: RESULT_TYPE_ID,
          typeName: RESULT_TYPE_NAME,
          data: { stepOutput: `output-${i}`, index: i },
        })

        await store.createRelationship({
          id: `rel:executed:multi:${step.name}`,
          verb: 'executed',
          from: testInstanceId,
          to: resultId,
          data: { stepName: step.name, stepIndex: i, duration: 100 + i * 10 },
        })
      }

      // Verify all executed relationships
      const executedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executed' })
      expect(executedRels).toHaveLength(3)

      // Each points to different result
      const resultUrls = executedRels.map((r) => r.to)
      const uniqueUrls = new Set(resultUrls)
      expect(uniqueUrls.size).toBe(3)
    })
  })

  // ==========================================================================
  // Test Case 4: Query steps by verb form state for a workflow instance
  // ==========================================================================

  describe('Query steps by verb form state for workflow instance', () => {
    beforeEach(async () => {
      // Create steps in different states for the test instance
      // Step 0: executed (completed)
      const result0 = `result:${testInstanceId}:${testSteps[0]!.name}`
      await store.createThing({
        id: result0,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { done: true },
      })
      await store.createRelationship({
        id: `rel:executed:q:${testSteps[0]!.name}`,
        verb: 'executed',
        from: testInstanceId,
        to: result0,
        data: { stepName: testSteps[0]!.name, stepIndex: 0, duration: 100 },
      })

      // Step 1: executed (completed)
      const result1 = `result:${testInstanceId}:${testSteps[1]!.name}`
      await store.createThing({
        id: result1,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { done: true },
      })
      await store.createRelationship({
        id: `rel:executed:q:${testSteps[1]!.name}`,
        verb: 'executed',
        from: testInstanceId,
        to: result1,
        data: { stepName: testSteps[1]!.name, stepIndex: 1, duration: 50 },
      })

      // Step 2: executing (in-progress)
      await store.createRelationship({
        id: `rel:executing:q:${testSteps[2]!.name}`,
        verb: 'executing',
        from: testInstanceId,
        to: testSteps[2]!.id,
        data: { stepName: testSteps[2]!.name, stepIndex: 2, startedAt: Date.now() },
      })

      // Step 3: execute (pending)
      await store.createRelationship({
        id: `rel:execute:q:${testSteps[3]!.name}`,
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[3]!.id,
        data: { stepName: testSteps[3]!.name, stepIndex: 3 },
      })

      // Step 4: execute (pending)
      await store.createRelationship({
        id: `rel:execute:q:${testSteps[4]!.name}`,
        verb: 'execute',
        from: testInstanceId,
        to: testSteps[4]!.id,
        data: { stepName: testSteps[4]!.name, stepIndex: 4 },
      })
    })

    it('queries pending steps (execute verb - action form)', async () => {
      const pendingRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'execute' })

      expect(pendingRels).toHaveLength(2)
      const stepNames = pendingRels.map((r) => (r.data as StepExecutionData).stepName).sort()
      expect(stepNames).toEqual(['processPayment', 'sendConfirmation'])
    })

    it('queries running steps (executing verb - activity form)', async () => {
      const runningRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executing' })

      expect(runningRels).toHaveLength(1)
      expect((runningRels[0]!.data as StepExecutionData).stepName).toBe('awaitApproval')
    })

    it('queries completed steps (executed verb - event form)', async () => {
      const completedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executed' })

      expect(completedRels).toHaveLength(2)
      const stepNames = completedRels.map((r) => (r.data as StepExecutionData).stepName).sort()
      expect(stepNames).toEqual(['routeToManager', 'validateExpense'])
    })

    it('can filter steps by instance and state', async () => {
      // Create another instance with different step states
      const otherInstanceId = 'instance:other-001'
      await store.createThing({
        id: otherInstanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: { workflowId: testWorkflowId, input: {}, stateVerb: 'starting' },
      })

      // Other instance has 1 executing step
      await store.createRelationship({
        id: 'rel:executing:other',
        verb: 'executing',
        from: otherInstanceId,
        to: testSteps[0]!.id,
        data: { stepName: testSteps[0]!.name, stepIndex: 0 },
      })

      // Query running steps for testInstanceId only
      const testInstanceRunning = await store.queryRelationshipsFrom(testInstanceId, {
        verb: 'executing',
      })
      expect(testInstanceRunning).toHaveLength(1)

      // Query running steps for otherInstanceId
      const otherInstanceRunning = await store.queryRelationshipsFrom(otherInstanceId, {
        verb: 'executing',
      })
      expect(otherInstanceRunning).toHaveLength(1)

      // Global query for all executing steps
      const allRunning = await store.queryRelationshipsByVerb('executing')
      expect(allRunning).toHaveLength(2)
    })

    it('returns ordered steps by stepIndex', async () => {
      const completedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executed' })

      // Sort by stepIndex from data
      const sortedByIndex = [...completedRels].sort((a, b) => {
        const aIndex = (a.data as StepExecutionData).stepIndex
        const bIndex = (b.data as StepExecutionData).stepIndex
        return aIndex - bIndex
      })

      expect((sortedByIndex[0]!.data as StepExecutionData).stepName).toBe('validateExpense')
      expect((sortedByIndex[1]!.data as StepExecutionData).stepName).toBe('routeToManager')
    })
  })

  // ==========================================================================
  // Test Case 5: Step has executedBy (instance) and executedAt (timestamp)
  // ==========================================================================

  describe('Step has executedBy and executedAt relationships', () => {
    it('executed relationship from field identifies the executing instance (executedBy)', async () => {
      const stepName = testSteps[0]!.name
      const resultId = `result:${testInstanceId}:${stepName}`

      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { output: 'test' },
      })

      const executedRel = await store.createRelationship({
        id: `rel:executed:by:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: resultId,
        data: {
          stepName,
          stepIndex: 0,
          duration: 100,
          completedAt: Date.now(),
        },
      })

      // from field = executedBy (the workflow instance)
      expect(executedRel.from).toBe(testInstanceId)

      // Verify we can query back to the instance
      const instance = await store.getThing(executedRel.from)
      expect(instance).not.toBeNull()
      expect(instance!.typeName).toBe(WORKFLOW_INSTANCE_TYPE_NAME)
    })

    it('step execution data contains executedAt timestamp', async () => {
      const stepName = testSteps[0]!.name
      const resultId = `result:${testInstanceId}:${stepName}`
      const executedAt = Date.now()

      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { output: 'test' },
      })

      const executedRel = await store.createRelationship({
        id: `rel:executed:at:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: resultId,
        data: {
          stepName,
          stepIndex: 0,
          duration: 100,
          completedAt: executedAt,
        },
      })

      const data = executedRel.data as StepExecutionData
      expect(data.completedAt).toBe(executedAt)
    })

    it('can query which instance executed a step (backward traversal)', async () => {
      const stepName = testSteps[0]!.name
      const resultId = `result:${testInstanceId}:${stepName}`

      await store.createThing({
        id: resultId,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { output: 'test' },
      })

      await store.createRelationship({
        id: `rel:executed:backward:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: resultId,
        data: { stepName, stepIndex: 0, duration: 100 },
      })

      // Query: who executed this result?
      const executedByRels = await store.queryRelationshipsTo(resultId, { verb: 'executed' })
      expect(executedByRels).toHaveLength(1)
      expect(executedByRels[0]!.from).toBe(testInstanceId)
    })

    it('startedAt timestamp stored in executing relationship data', async () => {
      const stepName = testSteps[0]!.name
      const startedAt = Date.now()

      const executingRel = await store.createRelationship({
        id: `rel:executing:startedAt:${stepName}`,
        verb: 'executing',
        from: testInstanceId,
        to: testSteps[0]!.id,
        data: {
          stepName,
          stepIndex: 0,
          startedAt,
        },
      })

      const data = executingRel.data as StepExecutionData
      expect(data.startedAt).toBe(startedAt)
    })
  })

  // ==========================================================================
  // Test Case 6: Failed step - execute -> executing -> error relationship
  // ==========================================================================

  describe('Failed step lifecycle', () => {
    it('failed step has executed relationship with error data', async () => {
      const stepName = testSteps[3]!.name // processPayment
      const startTime = Date.now()

      // Start executing
      await store.createRelationship({
        id: `rel:executing:fail:${stepName}`,
        verb: 'executing',
        from: testInstanceId,
        to: testSteps[3]!.id,
        data: { stepName, stepIndex: 3, startedAt: startTime },
      })

      // Simulate failure
      await store.deleteRelationship(`rel:executing:fail:${stepName}`)
      const endTime = Date.now()

      // Create executed relationship with error (still 'executed' verb, but with error data)
      const failedRel = await store.createRelationship({
        id: `rel:executed:fail:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: testInstanceId, // Failed steps may point back to instance or have special error URL
        data: {
          stepName,
          stepIndex: 3,
          duration: endTime - startTime,
          completedAt: endTime,
          error: 'Payment processor unavailable',
        },
      })

      const data = failedRel.data as StepExecutionData
      expect(data.error).toBe('Payment processor unavailable')
      expect(data.duration).toBeDefined()
      expect(data.completedAt).toBeDefined()
    })

    it('error message stored in relationship data', async () => {
      const stepName = testSteps[3]!.name
      const errorMessage = 'Connection timeout: payment gateway did not respond'

      const failedRel = await store.createRelationship({
        id: `rel:executed:errormsg:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: testInstanceId,
        data: {
          stepName,
          stepIndex: 3,
          duration: 5000,
          error: errorMessage,
        },
      })

      expect((failedRel.data as StepExecutionData).error).toBe(errorMessage)
    })

    it('can query failed steps by checking error field in executed relationships', async () => {
      // Create successful execution
      const successResult = `result:${testInstanceId}:success`
      await store.createThing({
        id: successResult,
        typeId: RESULT_TYPE_ID,
        typeName: RESULT_TYPE_NAME,
        data: { success: true },
      })
      await store.createRelationship({
        id: 'rel:executed:success',
        verb: 'executed',
        from: testInstanceId,
        to: successResult,
        data: { stepName: 'successStep', stepIndex: 0, duration: 100 },
      })

      // Create failed execution
      await store.createRelationship({
        id: 'rel:executed:failure',
        verb: 'executed',
        from: testInstanceId,
        to: testInstanceId,
        data: {
          stepName: 'failedStep',
          stepIndex: 1,
          duration: 5000,
          error: 'Something went wrong',
        },
      })

      // Query all executed relationships and filter for errors
      const allExecuted = await store.queryRelationshipsFrom(testInstanceId, { verb: 'executed' })
      const failedSteps = allExecuted.filter((r) => (r.data as StepExecutionData).error)
      const successfulSteps = allExecuted.filter((r) => !(r.data as StepExecutionData).error)

      expect(failedSteps).toHaveLength(1)
      expect(successfulSteps).toHaveLength(1)
      expect((failedSteps[0]!.data as StepExecutionData).stepName).toBe('failedStep')
    })

    it('failed step execution preserves startedAt and completedAt', async () => {
      const stepName = testSteps[3]!.name
      const startedAt = Date.now()
      const completedAt = startedAt + 5000 // 5 seconds later

      const failedRel = await store.createRelationship({
        id: `rel:executed:timestamps:${stepName}`,
        verb: 'executed',
        from: testInstanceId,
        to: testInstanceId,
        data: {
          stepName,
          stepIndex: 3,
          duration: 5000,
          startedAt,
          completedAt,
          error: 'Timeout error',
        },
      })

      const data = failedRel.data as StepExecutionData & { startedAt: number }
      expect(data.startedAt).toBe(startedAt)
      expect(data.completedAt).toBe(completedAt)
      expect(data.duration).toBe(5000)
    })
  })

  // ==========================================================================
  // Test Case 7: Skipped step - skip -> skipping -> skipped
  // ==========================================================================

  describe('Skipped step lifecycle', () => {
    it('creates skip relationship for step to be skipped (action form)', async () => {
      const stepName = testSteps[4]!.name // sendConfirmation

      const skipRel = await store.createRelationship({
        id: `rel:skip:${stepName}`,
        verb: 'skip',
        from: testInstanceId,
        to: testSteps[4]!.id,
        data: { stepName, stepIndex: 4 },
      })

      expect(skipRel.verb).toBe('skip')
      expect(skipRel.from).toBe(testInstanceId)
      expect(skipRel.to).toBe(testSteps[4]!.id)
    })

    it('transitions to skipping (activity form)', async () => {
      const stepName = testSteps[4]!.name

      await store.createRelationship({
        id: `rel:skip:trans:${stepName}`,
        verb: 'skip',
        from: testInstanceId,
        to: testSteps[4]!.id,
        data: { stepName, stepIndex: 4 },
      })

      // Transition to skipping
      await store.deleteRelationship(`rel:skip:trans:${stepName}`)
      const skippingRel = await store.createRelationship({
        id: `rel:skipping:trans:${stepName}`,
        verb: 'skipping',
        from: testInstanceId,
        to: testSteps[4]!.id,
        data: { stepName, stepIndex: 4, startedAt: Date.now() },
      })

      expect(skippingRel.verb).toBe('skipping')
    })

    it('transitions to skipped (event form)', async () => {
      const stepName = testSteps[4]!.name

      // Final skipped state
      const skippedRel = await store.createRelationship({
        id: `rel:skipped:${stepName}`,
        verb: 'skipped',
        from: testInstanceId,
        to: testSteps[4]!.id,
        data: {
          stepName,
          stepIndex: 4,
          completedAt: Date.now(),
        },
      })

      expect(skippedRel.verb).toBe('skipped')
    })

    it('full skip lifecycle: skip -> skipping -> skipped', async () => {
      const stepName = testSteps[4]!.name
      const stepId = testSteps[4]!.id

      // 1. Create skip (intent)
      await store.createRelationship({
        id: `rel:skip:lifecycle:${stepName}`,
        verb: 'skip',
        from: testInstanceId,
        to: stepId,
        data: { stepName, stepIndex: 4 },
      })

      // Verify pending skip
      let skipRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'skip' })
      expect(skipRels).toHaveLength(1)

      // 2. Transition to skipping
      await store.deleteRelationship(`rel:skip:lifecycle:${stepName}`)
      await store.createRelationship({
        id: `rel:skipping:lifecycle:${stepName}`,
        verb: 'skipping',
        from: testInstanceId,
        to: stepId,
        data: { stepName, stepIndex: 4 },
      })

      // Verify skipping
      const skippingRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'skipping' })
      expect(skippingRels).toHaveLength(1)

      // 3. Transition to skipped
      await store.deleteRelationship(`rel:skipping:lifecycle:${stepName}`)
      await store.createRelationship({
        id: `rel:skipped:lifecycle:${stepName}`,
        verb: 'skipped',
        from: testInstanceId,
        to: stepId,
        data: { stepName, stepIndex: 4, completedAt: Date.now() },
      })

      // Verify skipped
      const skippedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'skipped' })
      expect(skippedRels).toHaveLength(1)
    })

    it('can query all skipped steps for an instance', async () => {
      // Skip multiple steps
      for (const step of [testSteps[3], testSteps[4]]) {
        await store.createRelationship({
          id: `rel:skipped:query:${step!.name}`,
          verb: 'skipped',
          from: testInstanceId,
          to: step!.id,
          data: { stepName: step!.name, stepIndex: step!.index },
        })
      }

      const skippedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'skipped' })
      expect(skippedRels).toHaveLength(2)

      const stepNames = skippedRels.map((r) => (r.data as StepExecutionData).stepName).sort()
      expect(stepNames).toEqual(['processPayment', 'sendConfirmation'])
    })
  })

  // ==========================================================================
  // Test Case 8: StepExecutionStore API (RED Phase - NOT YET IMPLEMENTED)
  // ==========================================================================

  describe('StepExecutionStore API [RED]', () => {
    it('createStepExecutionStore throws - not yet implemented', () => {
      expect(() => createStepExecutionStore(store)).toThrow(
        'StepExecutionStore not yet implemented - this is the RED phase'
      )
    })

    // These tests will fail until StepExecutionStore is implemented
    describe('StepExecutionStore.createStepExecution()', () => {
      it.fails('creates execute relationship with proper structure', async () => {
        const stepStore = createStepExecutionStore(store)

        const execution = await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })

        expect(execution.verb).toBe('execute')
        expect(execution.from).toBe(testInstanceId)
        expect(execution.to).toBe(testSteps[0]!.id)
      })
    })

    describe('StepExecutionStore.startStepExecution()', () => {
      it.fails('transitions from execute to executing', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })

        const executing = await stepStore.startStepExecution(testInstanceId, testSteps[0]!.name)

        expect(executing.verb).toBe('executing')
        expect(executing.data!.startedAt).toBeDefined()
      })
    })

    describe('StepExecutionStore.completeStepExecution()', () => {
      it.fails('transitions from executing to executed with result', async () => {
        const stepStore = createStepExecutionStore(store)
        const resultId = `result:${testInstanceId}:${testSteps[0]!.name}`

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })
        await stepStore.startStepExecution(testInstanceId, testSteps[0]!.name)

        const executed = await stepStore.completeStepExecution(testInstanceId, testSteps[0]!.name, {
          resultTo: resultId,
          duration: 150,
        })

        expect(executed.verb).toBe('executed')
        expect(executed.to).toBe(resultId)
        expect(executed.data!.duration).toBe(150)
      })
    })

    describe('StepExecutionStore.failStepExecution()', () => {
      it.fails('transitions from executing to executed with error', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })
        await stepStore.startStepExecution(testInstanceId, testSteps[0]!.name)

        const failed = await stepStore.failStepExecution(testInstanceId, testSteps[0]!.name, {
          error: new Error('Connection failed'),
          duration: 5000,
        })

        expect(failed.verb).toBe('executed')
        expect(failed.data!.error).toBe('Connection failed')
      })
    })

    describe('StepExecutionStore.skipStepExecution()', () => {
      it.fails('transitions through skip -> skipping -> skipped', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[4]!.id,
          stepName: testSteps[4]!.name,
          stepIndex: 4,
        })

        const skipped = await stepStore.skipStepExecution(testInstanceId, testSteps[4]!.name)

        expect(skipped.verb).toBe('skipped')
      })
    })

    describe('StepExecutionStore.getStepExecutionState()', () => {
      it.fails('returns pending for execute verb', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })

        const state = await stepStore.getStepExecutionState(testInstanceId, testSteps[0]!.name)
        expect(state).toBe('pending')
      })

      it.fails('returns running for executing verb', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })
        await stepStore.startStepExecution(testInstanceId, testSteps[0]!.name)

        const state = await stepStore.getStepExecutionState(testInstanceId, testSteps[0]!.name)
        expect(state).toBe('running')
      })

      it.fails('returns completed for executed verb without error', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })
        await stepStore.startStepExecution(testInstanceId, testSteps[0]!.name)
        await stepStore.completeStepExecution(testInstanceId, testSteps[0]!.name, {
          resultTo: 'result:test',
          duration: 100,
        })

        const state = await stepStore.getStepExecutionState(testInstanceId, testSteps[0]!.name)
        expect(state).toBe('completed')
      })

      it.fails('returns failed for executed verb with error', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })
        await stepStore.startStepExecution(testInstanceId, testSteps[0]!.name)
        await stepStore.failStepExecution(testInstanceId, testSteps[0]!.name, {
          error: new Error('Test error'),
          duration: 100,
        })

        const state = await stepStore.getStepExecutionState(testInstanceId, testSteps[0]!.name)
        expect(state).toBe('failed')
      })

      it.fails('returns skipped for skipped verb', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[4]!.id,
          stepName: testSteps[4]!.name,
          stepIndex: 4,
        })
        await stepStore.skipStepExecution(testInstanceId, testSteps[4]!.name)

        const state = await stepStore.getStepExecutionState(testInstanceId, testSteps[4]!.name)
        expect(state).toBe('skipped')
      })
    })

    describe('StepExecutionStore.queryStepsByState()', () => {
      it.fails('returns steps in pending state', async () => {
        const stepStore = createStepExecutionStore(store)

        await stepStore.createStepExecution({
          instanceId: testInstanceId,
          stepId: testSteps[0]!.id,
          stepName: testSteps[0]!.name,
          stepIndex: 0,
        })

        const pending = await stepStore.queryStepsByState('pending', {
          instanceId: testInstanceId,
        })

        expect(pending).toHaveLength(1)
        expect(pending[0]!.verb).toBe('execute')
      })
    })

    describe('StepExecutionStore.queryStepsByInstance()', () => {
      it.fails('returns all step executions for an instance', async () => {
        const stepStore = createStepExecutionStore(store)

        // Create multiple step executions
        for (let i = 0; i < 3; i++) {
          await stepStore.createStepExecution({
            instanceId: testInstanceId,
            stepId: testSteps[i]!.id,
            stepName: testSteps[i]!.name,
            stepIndex: i,
          })
        }

        const allSteps = await stepStore.queryStepsByInstance(testInstanceId)

        expect(allSteps).toHaveLength(3)
      })
    })
  })
})
