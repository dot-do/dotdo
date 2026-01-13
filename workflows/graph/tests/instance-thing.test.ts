/**
 * WorkflowInstance as Thing - Verb Form State Tests
 *
 * TDD RED Phase: Failing tests for WorkflowInstance with verb form state encoding.
 *
 * Key Insight: Status is NOT a column - the verb form IS the state.
 *
 * State is encoded through Relationships with verb forms:
 * - Action form (start, pause, fail) = pending/intent
 * - Activity form (starting, pausing, failing) = in-progress
 * - Event form (started, paused, failed) = completed
 *
 * Expected Relationships:
 * - Instance creation: { verb: 'instanceOf', from: 'instance:123', to: 'workflow:expense-approval' }
 * - State as verb form: { verb: 'start', from: 'instance:123', to: null } // pending
 *                       { verb: 'starting', from: 'instance:123', to: null } // in-progress
 *                       { verb: 'started', from: 'instance:123', to: 'result:456' } // completed
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-bfm62 - [RED] WorkflowInstance as Thing - verb form state tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import type { GraphThing, GraphRelationship } from '../../../db/graph/types'

// ============================================================================
// EXPECTED API - WorkflowInstanceStore (NOT YET IMPLEMENTED)
// The tests in the [RED] section below will fail until this is implemented
// ============================================================================

/**
 * Expected WorkflowInstanceStore interface (to be implemented)
 * This class encapsulates the verb form state encoding pattern.
 */
interface WorkflowInstanceStore {
  create(options: CreateInstanceOptions): Promise<WorkflowInstance>
  get(id: string): Promise<WorkflowInstance | null>
  start(id: string): Promise<WorkflowInstance>
  complete(id: string, output: Record<string, unknown>): Promise<WorkflowInstance>
  pause(id: string, reason?: string): Promise<WorkflowInstance>
  resume(id: string): Promise<WorkflowInstance>
  fail(id: string, error: Error): Promise<WorkflowInstance>
  setCurrentStep(id: string, step: string | number): Promise<void>
  queryByState(state: InstanceState, options?: InstanceStateQuery): Promise<WorkflowInstance[]>
}

interface CreateInstanceOptions {
  id?: string
  workflowId: string
  input: Record<string, unknown>
}

interface WorkflowInstance {
  id: string
  workflowId: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  state: InstanceState
  currentStep?: string | number
  error?: string
}

type InstanceState = 'pending' | 'running' | 'completed' | 'paused' | 'failed'

interface InstanceStateQuery {
  workflowId?: string
  limit?: number
}

/**
 * Factory function to create WorkflowInstanceStore.
 * This will fail until the implementation exists.
 */
function createWorkflowInstanceStore(graphStore: SQLiteGraphStore): WorkflowInstanceStore {
  // This will throw an error - the implementation doesn't exist yet (RED phase)
  throw new Error('WorkflowInstanceStore not yet implemented - this is the RED phase')
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * WorkflowInstance Thing expected schema.
 * Instances are stored as Things with 'WorkflowInstance' type.
 */
interface WorkflowInstanceThingExpected {
  /** Unique identifier, e.g., 'instance:abc123' */
  id: string
  /** Type ID for WorkflowInstance noun */
  typeId: number
  /** Type name (expected: 'WorkflowInstance') */
  typeName: 'WorkflowInstance'
  /** Instance data */
  data: WorkflowInstanceData | null
  /** Unix timestamp (ms) when created */
  createdAt: number
  /** Unix timestamp (ms) when last updated */
  updatedAt: number
  /** Unix timestamp (ms) when soft deleted, null if active */
  deletedAt: number | null
}

/**
 * WorkflowInstance data payload.
 * Note: Does NOT include status column - state is encoded via verb form relationships.
 */
interface WorkflowInstanceData {
  /** ID of the workflow definition this instance belongs to */
  workflowId: string
  /** Input data provided when creating the instance */
  input: Record<string, unknown>
  /** Current step name/index (for tracking progress) */
  currentStep?: string | number
  /** Output data (set when completed) */
  output?: Record<string, unknown>
}

/**
 * Expected relationship for state encoding.
 * The verb form encodes the state:
 * - 'start' = pending
 * - 'starting' = in-progress
 * - 'started' = completed
 */
interface StateRelationship {
  id: string
  verb: string
  from: string
  to: string | null
  data?: Record<string, unknown> | null
  createdAt: Date
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for WorkflowInstance Things */
const WORKFLOW_INSTANCE_TYPE_ID = 101

/** Type name for WorkflowInstance Things */
const WORKFLOW_INSTANCE_TYPE_NAME = 'WorkflowInstance'

/** Type ID for Workflow Things (for reference) */
const WORKFLOW_TYPE_ID = 100

// ============================================================================
// TEST FIXTURES
// ============================================================================

const expenseApprovalWorkflow = {
  id: 'workflow:expense-approval',
  typeId: WORKFLOW_TYPE_ID,
  typeName: 'Workflow',
  data: {
    name: 'expense-approval',
    description: 'Approve expense requests with manager review',
    version: '1.0.0',
  },
}

const orderProcessingWorkflow = {
  id: 'workflow:order-processing',
  typeId: WORKFLOW_TYPE_ID,
  typeName: 'Workflow',
  data: {
    name: 'order-processing',
    description: 'Process customer orders',
    version: '1.0.0',
  },
}

// ============================================================================
// TEST SUITE: WorkflowInstance as Thing with Verb Form State
// ============================================================================

describe('WorkflowInstance as Thing with Verb Form State', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    // Create fresh in-memory SQLite store for each test
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // Seed workflow definitions
    await store.createThing({
      id: expenseApprovalWorkflow.id,
      typeId: expenseApprovalWorkflow.typeId,
      typeName: expenseApprovalWorkflow.typeName,
      data: expenseApprovalWorkflow.data,
    })

    await store.createThing({
      id: orderProcessingWorkflow.id,
      typeId: orderProcessingWorkflow.typeId,
      typeName: orderProcessingWorkflow.typeName,
      data: orderProcessingWorkflow.data,
    })
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Create WorkflowInstance Thing with type='WorkflowInstance'
  // ==========================================================================

  describe('WorkflowInstance Thing creation', () => {
    it('creates WorkflowInstance Thing with correct type', async () => {
      // Create a WorkflowInstance Thing
      const instanceId = 'instance:exp-001'
      const instanceData: WorkflowInstanceData = {
        workflowId: 'workflow:expense-approval',
        input: { amount: 1500, description: 'Conference travel' },
      }

      const instance = await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: instanceData,
      })

      // Verify Thing was created with correct type
      expect(instance.id).toBe(instanceId)
      expect(instance.typeId).toBe(WORKFLOW_INSTANCE_TYPE_ID)
      expect(instance.typeName).toBe(WORKFLOW_INSTANCE_TYPE_NAME)
      expect(instance.data).toEqual(instanceData)
      expect(instance.createdAt).toBeDefined()
      expect(instance.updatedAt).toBeDefined()
      expect(instance.deletedAt).toBeNull()
    })

    it('stores input data in WorkflowInstance', async () => {
      const instanceData: WorkflowInstanceData = {
        workflowId: 'workflow:order-processing',
        input: {
          orderId: 'ORD-12345',
          items: ['item-1', 'item-2'],
          total: 99.99,
        },
      }

      const instance = await store.createThing({
        id: 'instance:ord-001',
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: instanceData,
      })

      // Verify input data is preserved
      const data = instance.data as WorkflowInstanceData
      expect(data.workflowId).toBe('workflow:order-processing')
      expect(data.input.orderId).toBe('ORD-12345')
      expect(data.input.items).toEqual(['item-1', 'item-2'])
      expect(data.input.total).toBe(99.99)
    })

    it('does NOT store status as a column - state is via verb form relationships', async () => {
      const instanceData: WorkflowInstanceData = {
        workflowId: 'workflow:expense-approval',
        input: { amount: 500 },
      }

      const instance = await store.createThing({
        id: 'instance:no-status',
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: instanceData,
      })

      // Verify NO status/state field in data
      const data = instance.data as Record<string, unknown>
      expect(data).not.toHaveProperty('status')
      expect(data).not.toHaveProperty('state')
      expect(data).not.toHaveProperty('stateVerb')
    })
  })

  // ==========================================================================
  // 2. Instance has relationship to Workflow: 'instanceOf' verb
  // ==========================================================================

  describe('instanceOf relationship to Workflow', () => {
    it('creates instanceOf relationship linking instance to workflow', async () => {
      // Create instance
      const instanceId = 'instance:exp-002'
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: { amount: 2000 },
        },
      })

      // Create instanceOf relationship
      const relationship = await store.createRelationship({
        id: 'rel:instanceOf:exp-002',
        verb: 'instanceOf',
        from: instanceId,
        to: 'workflow:expense-approval',
      })

      expect(relationship.verb).toBe('instanceOf')
      expect(relationship.from).toBe(instanceId)
      expect(relationship.to).toBe('workflow:expense-approval')
    })

    it('can query instances of a specific workflow', async () => {
      // Create multiple instances of different workflows
      const instances = [
        { id: 'instance:exp-a', workflowId: 'workflow:expense-approval' },
        { id: 'instance:exp-b', workflowId: 'workflow:expense-approval' },
        { id: 'instance:ord-a', workflowId: 'workflow:order-processing' },
      ]

      for (const inst of instances) {
        await store.createThing({
          id: inst.id,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: inst.workflowId, input: {} },
        })

        await store.createRelationship({
          id: `rel:instanceOf:${inst.id}`,
          verb: 'instanceOf',
          from: inst.id,
          to: inst.workflowId,
        })
      }

      // Query instances of expense-approval workflow (backward traversal)
      const expenseInstances = await store.queryRelationshipsTo(
        'workflow:expense-approval',
        { verb: 'instanceOf' }
      )

      expect(expenseInstances).toHaveLength(2)
      expect(expenseInstances.map((r) => r.from).sort()).toEqual([
        'instance:exp-a',
        'instance:exp-b',
      ])
    })

    it('can traverse from instance to its workflow definition', async () => {
      const instanceId = 'instance:traversal-test'
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: { workflowId: 'workflow:expense-approval', input: {} },
      })

      await store.createRelationship({
        id: 'rel:instanceOf:traversal',
        verb: 'instanceOf',
        from: instanceId,
        to: 'workflow:expense-approval',
      })

      // Forward traversal: instance -> workflow
      const workflowRels = await store.queryRelationshipsFrom(instanceId, { verb: 'instanceOf' })

      expect(workflowRels).toHaveLength(1)
      expect(workflowRels[0]!.to).toBe('workflow:expense-approval')

      // Verify the workflow Thing exists
      const workflow = await store.getThing('workflow:expense-approval')
      expect(workflow).not.toBeNull()
      expect(workflow!.typeName).toBe('Workflow')
    })
  })

  // ==========================================================================
  // 3. State via verb form relationships
  // ==========================================================================

  describe('State via verb form relationships', () => {
    describe('start -> starting -> started lifecycle', () => {
      it('creates start relationship for pending state (action form)', async () => {
        const instanceId = 'instance:state-pending'
        await store.createThing({
          id: instanceId,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: 'workflow:expense-approval', input: { amount: 100 } },
        })

        // Create 'start' relationship = pending state (action form)
        const stateRel = await store.createRelationship({
          id: 'rel:start:pending',
          verb: 'start',
          from: instanceId,
          to: instanceId, // Self-referencing for state
        })

        expect(stateRel.verb).toBe('start')
        expect(stateRel.from).toBe(instanceId)
        // 'to' points to self or can be null for pending state
      })

      it('transitions to starting relationship for in-progress state (activity form)', async () => {
        const instanceId = 'instance:state-running'
        await store.createThing({
          id: instanceId,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: 'workflow:expense-approval', input: {} },
        })

        // Create 'starting' relationship = in-progress state (activity form)
        const stateRel = await store.createRelationship({
          id: 'rel:starting:running',
          verb: 'starting',
          from: instanceId,
          to: instanceId, // to is typically null/self during activity
        })

        expect(stateRel.verb).toBe('starting')
        expect(stateRel.from).toBe(instanceId)
      })

      it('transitions to started relationship for completed state (event form)', async () => {
        const instanceId = 'instance:state-completed'
        const resultId = 'result:456'

        await store.createThing({
          id: instanceId,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: 'workflow:expense-approval', input: { amount: 500 } },
        })

        // Create result Thing (output of the workflow)
        await store.createThing({
          id: resultId,
          typeId: 102, // Result type
          typeName: 'Result',
          data: { approved: true, processedAt: Date.now() },
        })

        // Create 'started' relationship = completed state (event form)
        // 'to' points to the result
        const stateRel = await store.createRelationship({
          id: 'rel:started:completed',
          verb: 'started',
          from: instanceId,
          to: resultId,
        })

        expect(stateRel.verb).toBe('started')
        expect(stateRel.from).toBe(instanceId)
        expect(stateRel.to).toBe(resultId)
      })
    })

    describe('pause -> paused lifecycle', () => {
      it('creates paused relationship for paused state', async () => {
        const instanceId = 'instance:state-paused'
        await store.createThing({
          id: instanceId,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: 'workflow:expense-approval', input: {} },
        })

        // Create 'paused' relationship = paused state (event form of pause)
        const stateRel = await store.createRelationship({
          id: 'rel:paused:state',
          verb: 'paused',
          from: instanceId,
          to: instanceId,
          data: { reason: 'awaiting_approval', pausedAt: Date.now() },
        })

        expect(stateRel.verb).toBe('paused')
        expect(stateRel.from).toBe(instanceId)
      })
    })

    describe('fail -> failed lifecycle', () => {
      it('creates failed relationship for failed state', async () => {
        const instanceId = 'instance:state-failed'
        await store.createThing({
          id: instanceId,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: 'workflow:expense-approval', input: {} },
        })

        // Create 'failed' relationship = failed state (event form of fail)
        const stateRel = await store.createRelationship({
          id: 'rel:failed:state',
          verb: 'failed',
          from: instanceId,
          to: instanceId,
          data: { error: 'Payment processor unavailable', failedAt: Date.now() },
        })

        expect(stateRel.verb).toBe('failed')
        expect(stateRel.from).toBe(instanceId)
        expect(stateRel.data).toBeDefined()
        expect((stateRel.data as Record<string, unknown>).error).toBe('Payment processor unavailable')
      })
    })
  })

  // ==========================================================================
  // 4. Query instances by verb form state
  // ==========================================================================

  describe('Query instances by verb form state', () => {
    beforeEach(async () => {
      // Create instances in different states
      const states = [
        { id: 'instance:q-pending-1', verb: 'start' },
        { id: 'instance:q-pending-2', verb: 'start' },
        { id: 'instance:q-running-1', verb: 'starting' },
        { id: 'instance:q-running-2', verb: 'starting' },
        { id: 'instance:q-running-3', verb: 'starting' },
        { id: 'instance:q-completed-1', verb: 'started' },
        { id: 'instance:q-paused-1', verb: 'paused' },
        { id: 'instance:q-failed-1', verb: 'failed' },
      ]

      for (const state of states) {
        await store.createThing({
          id: state.id,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: 'workflow:expense-approval', input: {} },
        })

        await store.createRelationship({
          id: `rel:state:${state.id}`,
          verb: state.verb,
          from: state.id,
          to: state.id,
        })
      }
    })

    it('queries instances in pending state (action form: start)', async () => {
      const pendingRels = await store.queryRelationshipsByVerb('start')

      expect(pendingRels).toHaveLength(2)
      expect(pendingRels.map((r) => r.from).sort()).toEqual([
        'instance:q-pending-1',
        'instance:q-pending-2',
      ])
    })

    it('queries instances in running state (activity form: starting)', async () => {
      const runningRels = await store.queryRelationshipsByVerb('starting')

      expect(runningRels).toHaveLength(3)
      expect(runningRels.map((r) => r.from).sort()).toEqual([
        'instance:q-running-1',
        'instance:q-running-2',
        'instance:q-running-3',
      ])
    })

    it('queries instances in completed state (event form: started)', async () => {
      const completedRels = await store.queryRelationshipsByVerb('started')

      expect(completedRels).toHaveLength(1)
      expect(completedRels[0]!.from).toBe('instance:q-completed-1')
    })

    it('queries instances in paused state', async () => {
      const pausedRels = await store.queryRelationshipsByVerb('paused')

      expect(pausedRels).toHaveLength(1)
      expect(pausedRels[0]!.from).toBe('instance:q-paused-1')
    })

    it('queries instances in failed state', async () => {
      const failedRels = await store.queryRelationshipsByVerb('failed')

      expect(failedRels).toHaveLength(1)
      expect(failedRels[0]!.from).toBe('instance:q-failed-1')
    })

    it('combines state query with workflow filter', async () => {
      // Create another instance of a different workflow
      await store.createThing({
        id: 'instance:other-wf',
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: { workflowId: 'workflow:order-processing', input: {} },
      })

      await store.createRelationship({
        id: 'rel:state:other-wf',
        verb: 'starting',
        from: 'instance:other-wf',
        to: 'instance:other-wf',
      })

      await store.createRelationship({
        id: 'rel:instanceOf:other-wf',
        verb: 'instanceOf',
        from: 'instance:other-wf',
        to: 'workflow:order-processing',
      })

      // Query running instances
      const runningRels = await store.queryRelationshipsByVerb('starting')

      // Should now have 4 running instances
      expect(runningRels).toHaveLength(4)

      // Filter to only order-processing instances (would need a join query)
      // This demonstrates the pattern - actual implementation might need a helper
      const runningInstanceIds = runningRels.map((r) => r.from)

      // Get instanceOf relationships for order-processing
      const orderInstanceRels = await store.queryRelationshipsTo(
        'workflow:order-processing',
        { verb: 'instanceOf' }
      )
      const orderInstanceIds = new Set(orderInstanceRels.map((r) => r.from))

      // Filter running instances to only order-processing
      const runningOrderInstances = runningInstanceIds.filter((id) => orderInstanceIds.has(id))

      expect(runningOrderInstances).toHaveLength(1)
      expect(runningOrderInstances[0]).toBe('instance:other-wf')
    })
  })

  // ==========================================================================
  // 5. Instance data contains required fields
  // ==========================================================================

  describe('Instance data structure', () => {
    it('contains workflowId referencing the workflow definition', async () => {
      const instanceId = 'instance:data-wfid'
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: {},
        },
      })

      const instance = await store.getThing(instanceId)
      const data = instance!.data as WorkflowInstanceData

      expect(data.workflowId).toBe('workflow:expense-approval')
    })

    it('contains input data provided at creation', async () => {
      const inputData = {
        expenseId: 'EXP-001',
        amount: 2500,
        category: 'travel',
        receipts: ['receipt1.pdf', 'receipt2.pdf'],
      }

      const instanceId = 'instance:data-input'
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: inputData,
        },
      })

      const instance = await store.getThing(instanceId)
      const data = instance!.data as WorkflowInstanceData

      expect(data.input).toEqual(inputData)
    })

    it('contains currentStep for tracking progress', async () => {
      const instanceId = 'instance:data-step'
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: {},
          currentStep: 'validateExpense',
        },
      })

      const instance = await store.getThing(instanceId)
      const data = instance!.data as WorkflowInstanceData

      expect(data.currentStep).toBe('validateExpense')
    })

    it('contains output data when workflow completes', async () => {
      const instanceId = 'instance:data-output'
      const outputData = {
        approved: true,
        approvedBy: 'manager-jane',
        approvedAt: Date.now(),
        comments: 'Approved for Q1 budget',
      }

      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: { amount: 1000 },
          output: outputData,
        },
      })

      const instance = await store.getThing(instanceId)
      const data = instance!.data as WorkflowInstanceData

      expect(data.output).toEqual(outputData)
    })

    it('can update currentStep as workflow progresses', async () => {
      const instanceId = 'instance:data-progress'
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: { amount: 500 },
          currentStep: 'validateExpense',
        },
      })

      // Update to next step
      const updated = await store.updateThing(instanceId, {
        data: {
          workflowId: 'workflow:expense-approval',
          input: { amount: 500 },
          currentStep: 'routeToManager',
        },
      })

      const data = updated!.data as WorkflowInstanceData
      expect(data.currentStep).toBe('routeToManager')
    })
  })

  // ==========================================================================
  // 6. Complete lifecycle with relationships
  // ==========================================================================

  describe('Complete lifecycle with relationships', () => {
    it('demonstrates full instance lifecycle: create -> start -> complete', async () => {
      const instanceId = 'instance:lifecycle-full'
      const workflowId = 'workflow:expense-approval'

      // 1. Create instance Thing
      const instance = await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId,
          input: { amount: 750, description: 'Team dinner' },
        },
      })

      // 2. Create instanceOf relationship
      await store.createRelationship({
        id: `rel:instanceOf:${instanceId}`,
        verb: 'instanceOf',
        from: instanceId,
        to: workflowId,
      })

      // 3. Create initial 'start' state (pending)
      await store.createRelationship({
        id: `rel:state:${instanceId}:start`,
        verb: 'start',
        from: instanceId,
        to: instanceId,
      })

      // Verify pending state
      const pendingRels = await store.queryRelationshipsFrom(instanceId, { verb: 'start' })
      expect(pendingRels).toHaveLength(1)

      // 4. Transition to 'starting' (running)
      await store.deleteRelationship(`rel:state:${instanceId}:start`)
      await store.createRelationship({
        id: `rel:state:${instanceId}:starting`,
        verb: 'starting',
        from: instanceId,
        to: instanceId,
      })

      // Verify running state
      const runningRels = await store.queryRelationshipsFrom(instanceId, { verb: 'starting' })
      expect(runningRels).toHaveLength(1)

      // 5. Create result and transition to 'started' (completed)
      const resultId = `result:${instanceId}`
      await store.createThing({
        id: resultId,
        typeId: 102,
        typeName: 'Result',
        data: { approved: true, processedAt: Date.now() },
      })

      await store.deleteRelationship(`rel:state:${instanceId}:starting`)
      await store.createRelationship({
        id: `rel:state:${instanceId}:started`,
        verb: 'started',
        from: instanceId,
        to: resultId,
      })

      // Verify completed state
      const completedRels = await store.queryRelationshipsFrom(instanceId, { verb: 'started' })
      expect(completedRels).toHaveLength(1)
      expect(completedRels[0]!.to).toBe(resultId)

      // 6. Verify result can be retrieved
      const result = await store.getThing(resultId)
      expect(result).not.toBeNull()
      expect((result!.data as Record<string, unknown>).approved).toBe(true)
    })

    it('demonstrates pause/resume lifecycle', async () => {
      const instanceId = 'instance:lifecycle-pause'

      // Create instance in running state
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: { amount: 5000 },
          currentStep: 'waitForApproval',
        },
      })

      await store.createRelationship({
        id: `rel:state:${instanceId}:starting`,
        verb: 'starting',
        from: instanceId,
        to: instanceId,
      })

      // Pause the instance
      await store.deleteRelationship(`rel:state:${instanceId}:starting`)
      await store.createRelationship({
        id: `rel:state:${instanceId}:paused`,
        verb: 'paused',
        from: instanceId,
        to: instanceId,
        data: { reason: 'awaiting_manager_approval', pausedAt: Date.now() },
      })

      // Verify paused state
      const pausedRels = await store.queryRelationshipsFrom(instanceId, { verb: 'paused' })
      expect(pausedRels).toHaveLength(1)

      // Resume the instance (back to starting/running)
      await store.deleteRelationship(`rel:state:${instanceId}:paused`)
      await store.createRelationship({
        id: `rel:state:${instanceId}:starting:resumed`,
        verb: 'starting',
        from: instanceId,
        to: instanceId,
      })

      // Verify resumed/running state
      const resumedRels = await store.queryRelationshipsFrom(instanceId, { verb: 'starting' })
      expect(resumedRels).toHaveLength(1)
    })

    it('demonstrates failure lifecycle', async () => {
      const instanceId = 'instance:lifecycle-fail'

      // Create instance in running state
      await store.createThing({
        id: instanceId,
        typeId: WORKFLOW_INSTANCE_TYPE_ID,
        typeName: WORKFLOW_INSTANCE_TYPE_NAME,
        data: {
          workflowId: 'workflow:expense-approval',
          input: { amount: 100000 }, // Very large amount
          currentStep: 'processPayment',
        },
      })

      await store.createRelationship({
        id: `rel:state:${instanceId}:starting`,
        verb: 'starting',
        from: instanceId,
        to: instanceId,
      })

      // Fail the instance
      await store.deleteRelationship(`rel:state:${instanceId}:starting`)
      await store.createRelationship({
        id: `rel:state:${instanceId}:failed`,
        verb: 'failed',
        from: instanceId,
        to: instanceId,
        data: {
          error: 'Payment rejected: amount exceeds limit',
          failedAt: Date.now(),
          failedStep: 'processPayment',
        },
      })

      // Verify failed state with error details
      const failedRels = await store.queryRelationshipsFrom(instanceId, { verb: 'failed' })
      expect(failedRels).toHaveLength(1)
      expect(failedRels[0]!.data).toBeDefined()
      expect((failedRels[0]!.data as Record<string, unknown>).error).toBe(
        'Payment rejected: amount exceeds limit'
      )
    })
  })
})

// ============================================================================
// TEST SUITE: WorkflowInstanceStore API (RED PHASE - NOT YET IMPLEMENTED)
// ============================================================================

describe('WorkflowInstanceStore API [RED]', () => {
  let graphStore: SQLiteGraphStore
  let instanceStore: WorkflowInstanceStore

  beforeEach(async () => {
    // Create fresh in-memory SQLite store for each test
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    // Create WorkflowInstanceStore wrapping the graph store
    // This API does not exist yet - tests will fail
    instanceStore = new WorkflowInstanceStore(graphStore)

    // Seed workflow definitions
    await graphStore.createThing({
      id: 'workflow:expense-approval',
      typeId: WORKFLOW_TYPE_ID,
      typeName: 'Workflow',
      data: { name: 'expense-approval', version: '1.0.0' },
    })
  })

  afterEach(async () => {
    await graphStore.close()
  })

  // ==========================================================================
  // WorkflowInstanceStore.create() - Creates instance with initial state
  // ==========================================================================

  describe('WorkflowInstanceStore.create()', () => {
    it('creates instance Thing AND initial start relationship in one call', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: { amount: 1500, description: 'Conference travel' },
      })

      // Should return a WorkflowInstance with id, state, and data
      expect(instance.id).toBeDefined()
      expect(instance.id).toMatch(/^instance:/)
      expect(instance.state).toBe('pending')
      expect(instance.workflowId).toBe('workflow:expense-approval')
      expect(instance.input).toEqual({ amount: 1500, description: 'Conference travel' })
    })

    it('creates instanceOf relationship automatically', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: { amount: 500 },
      })

      // Query the instanceOf relationship
      const rels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'instanceOf' })
      expect(rels).toHaveLength(1)
      expect(rels[0]!.to).toBe('workflow:expense-approval')
    })

    it('creates start relationship for pending state', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })

      // Query the start state relationship
      const rels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'start' })
      expect(rels).toHaveLength(1)
    })

    it('allows custom instance ID', async () => {
      const instance = await instanceStore.create({
        id: 'instance:custom-id-123',
        workflowId: 'workflow:expense-approval',
        input: {},
      })

      expect(instance.id).toBe('instance:custom-id-123')
    })
  })

  // ==========================================================================
  // State transitions
  // ==========================================================================

  describe('State transitions', () => {
    it('start() transitions from pending to running', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      expect(instance.state).toBe('pending')

      const running = await instanceStore.start(instance.id)

      expect(running.state).toBe('running')
      // Verify relationship changed from 'start' to 'starting'
      const startRels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'start' })
      const startingRels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'starting' })
      expect(startRels).toHaveLength(0)
      expect(startingRels).toHaveLength(1)
    })

    it('complete() transitions from running to completed with output', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: { amount: 1000 },
      })
      await instanceStore.start(instance.id)

      const completed = await instanceStore.complete(instance.id, {
        approved: true,
        approvedBy: 'manager',
      })

      expect(completed.state).toBe('completed')
      expect(completed.output).toEqual({ approved: true, approvedBy: 'manager' })
      // Verify 'started' relationship points to result
      const startedRels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'started' })
      expect(startedRels).toHaveLength(1)
      expect(startedRels[0]!.to).toContain('result:')
    })

    it('pause() transitions from running to paused', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      await instanceStore.start(instance.id)

      const paused = await instanceStore.pause(instance.id, 'awaiting_approval')

      expect(paused.state).toBe('paused')
      const pausedRels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'paused' })
      expect(pausedRels).toHaveLength(1)
      expect((pausedRels[0]!.data as Record<string, unknown>).reason).toBe('awaiting_approval')
    })

    it('resume() transitions from paused to running', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      await instanceStore.start(instance.id)
      await instanceStore.pause(instance.id)

      const resumed = await instanceStore.resume(instance.id)

      expect(resumed.state).toBe('running')
    })

    it('fail() transitions from running to failed with error', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      await instanceStore.start(instance.id)

      const failed = await instanceStore.fail(instance.id, new Error('Payment failed'))

      expect(failed.state).toBe('failed')
      expect(failed.error).toBe('Payment failed')
      const failedRels = await graphStore.queryRelationshipsFrom(instance.id, { verb: 'failed' })
      expect(failedRels).toHaveLength(1)
    })

    it('throws on invalid state transition', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })

      // Cannot complete a pending instance (must start first)
      await expect(instanceStore.complete(instance.id, {})).rejects.toThrow(/invalid transition/i)
    })
  })

  // ==========================================================================
  // Query by state
  // ==========================================================================

  describe('Query by state', () => {
    beforeEach(async () => {
      // Create instances in different states
      const inst1 = await instanceStore.create({ workflowId: 'workflow:expense-approval', input: {} })
      const inst2 = await instanceStore.create({ workflowId: 'workflow:expense-approval', input: {} })
      const inst3 = await instanceStore.create({ workflowId: 'workflow:expense-approval', input: {} })
      const inst4 = await instanceStore.create({ workflowId: 'workflow:expense-approval', input: {} })

      // inst1 stays pending
      // inst2 -> running
      await instanceStore.start(inst2.id)
      // inst3 -> running -> completed
      await instanceStore.start(inst3.id)
      await instanceStore.complete(inst3.id, { done: true })
      // inst4 -> running -> failed
      await instanceStore.start(inst4.id)
      await instanceStore.fail(inst4.id, new Error('Test error'))
    })

    it('queryByState("pending") returns pending instances', async () => {
      const pending = await instanceStore.queryByState('pending')

      expect(pending).toHaveLength(1)
      expect(pending[0]!.state).toBe('pending')
    })

    it('queryByState("running") returns running instances', async () => {
      const running = await instanceStore.queryByState('running')

      // inst2 is running (inst3 and inst4 transitioned out)
      expect(running).toHaveLength(0) // All running instances transitioned
    })

    it('queryByState("completed") returns completed instances', async () => {
      const completed = await instanceStore.queryByState('completed')

      expect(completed).toHaveLength(1)
      expect(completed[0]!.state).toBe('completed')
    })

    it('queryByState("failed") returns failed instances', async () => {
      const failed = await instanceStore.queryByState('failed')

      expect(failed).toHaveLength(1)
      expect(failed[0]!.state).toBe('failed')
    })

    it('filters by workflowId', async () => {
      // Create instance of different workflow
      await graphStore.createThing({
        id: 'workflow:other',
        typeId: WORKFLOW_TYPE_ID,
        typeName: 'Workflow',
        data: { name: 'other' },
      })
      await instanceStore.create({ workflowId: 'workflow:other', input: {} })

      const expenseInstances = await instanceStore.queryByState('pending', {
        workflowId: 'workflow:expense-approval',
      })

      // Should only return the expense-approval instance, not the 'other' one
      expect(expenseInstances.every((i) => i.workflowId === 'workflow:expense-approval')).toBe(true)
    })
  })

  // ==========================================================================
  // Get instance by ID
  // ==========================================================================

  describe('Get instance', () => {
    it('get() returns instance with current state', async () => {
      const created = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: { amount: 1000 },
      })

      const instance = await instanceStore.get(created.id)

      expect(instance).not.toBeNull()
      expect(instance!.id).toBe(created.id)
      expect(instance!.state).toBe('pending')
      expect(instance!.workflowId).toBe('workflow:expense-approval')
      expect(instance!.input).toEqual({ amount: 1000 })
    })

    it('get() returns updated state after transitions', async () => {
      const created = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      await instanceStore.start(created.id)

      const instance = await instanceStore.get(created.id)

      expect(instance!.state).toBe('running')
    })

    it('get() returns null for non-existent instance', async () => {
      const instance = await instanceStore.get('instance:does-not-exist')
      expect(instance).toBeNull()
    })
  })

  // ==========================================================================
  // Update currentStep
  // ==========================================================================

  describe('Update progress', () => {
    it('setCurrentStep() updates the current step', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      await instanceStore.start(instance.id)

      await instanceStore.setCurrentStep(instance.id, 'validateExpense')

      const updated = await instanceStore.get(instance.id)
      expect(updated!.currentStep).toBe('validateExpense')
    })

    it('setCurrentStep() can track step index', async () => {
      const instance = await instanceStore.create({
        workflowId: 'workflow:expense-approval',
        input: {},
      })
      await instanceStore.start(instance.id)

      await instanceStore.setCurrentStep(instance.id, 2)

      const updated = await instanceStore.get(instance.id)
      expect(updated!.currentStep).toBe(2)
    })
  })
})
