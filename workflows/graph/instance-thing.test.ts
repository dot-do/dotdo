/**
 * WorkflowInstance Thing Tests
 *
 * TDD GREEN Phase: Tests for WorkflowInstance as a Thing with verb form state encoding.
 *
 * The key insight: verb form IS the state, no separate status column needed.
 *
 * Workflow Instance States (via verb forms):
 * - 'start' (action form) = pending, instance created but not yet started
 * - 'starting' (activity form) = running, instance is executing
 * - 'started' (event form) = completed, instance finished successfully
 *
 * Additional states:
 * - 'pause' -> 'pausing' -> 'paused' for paused workflows
 * - 'fail' -> 'failing' -> 'failed' for failed workflows
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInstance,
  startInstance,
  completeInstance,
  pauseInstance,
  resumeInstance,
  failInstance,
  getInstance,
  getInstanceState,
  queryInstancesByState,
  type WorkflowInstanceThing,
  type CreateInstanceInput,
} from './instance-thing'

// ============================================================================
// TEST SUITE: WorkflowInstance Thing
// ============================================================================

describe('WorkflowInstance Thing with Verb Form State', () => {
  // In-memory store for testing (per test isolation)
  let db: object

  beforeEach(() => {
    // Create a fresh in-memory store for each test
    db = { _testId: Math.random().toString(36).slice(2) }
  })

  // ==========================================================================
  // 1. Instance Creation
  // ==========================================================================

  describe('createInstance', () => {
    it('creates a WorkflowInstance Thing with pending state', async () => {
      const input: CreateInstanceInput = {
        workflowId: 'workflow-order-processing',
        input: { orderId: 'order-123', amount: 99.99 },
      }

      const instance = await createInstance(db, input)

      // Should have an auto-generated ID
      expect(instance.id).toBeDefined()
      expect(instance.id).toContain('instance-')

      // Should be typed as WorkflowInstance
      expect(instance.typeName).toBe('WorkflowInstance')

      // Should have workflowId in data
      expect(instance.data?.workflowId).toBe('workflow-order-processing')

      // Should have input in data
      expect(instance.data?.input).toEqual({ orderId: 'order-123', amount: 99.99 })

      // Should have the pending state (via start action)
      expect(instance.data?.stateVerb).toBe('start')
    })

    it('creates instance with custom ID', async () => {
      const input: CreateInstanceInput = {
        id: 'my-custom-instance-id',
        workflowId: 'workflow-test',
        input: {},
      }

      const instance = await createInstance(db, input)

      expect(instance.id).toBe('my-custom-instance-id')
    })

    it('stores initial state as action verb form (pending)', async () => {
      const instance = await createInstance(db, {
        workflowId: 'workflow-test',
        input: { data: 'test' },
      })

      // The state verb should be in action form (pending)
      const state = await getInstanceState(db, instance.id)
      expect(state).toBe('pending')
    })
  })

  // ==========================================================================
  // 2. State Transitions via Verb Forms
  // ==========================================================================

  describe('State Transitions', () => {
    describe('startInstance', () => {
      it('transitions from pending (start) to running (starting)', async () => {
        // Create instance in pending state
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        expect(await getInstanceState(db, instance.id)).toBe('pending')

        // Start the instance
        const started = await startInstance(db, instance.id)

        // Should now be in running state (activity form)
        expect(started.data?.stateVerb).toBe('starting')
        expect(await getInstanceState(db, started.id)).toBe('running')
      })

      it('throws error if instance not found', async () => {
        await expect(startInstance(db, 'non-existent')).rejects.toThrow('Instance not found')
      })

      it('throws error if instance not in pending state', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        await startInstance(db, instance.id) // Now in running state

        // Try to start again - should fail
        await expect(startInstance(db, instance.id)).rejects.toThrow('Invalid transition')
      })
    })

    describe('completeInstance', () => {
      it('transitions from running (starting) to completed (started)', async () => {
        // Create and start instance
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: { value: 42 },
        })
        await startInstance(db, instance.id)
        expect(await getInstanceState(db, instance.id)).toBe('running')

        // Complete the instance with output
        const completed = await completeInstance(db, instance.id, { result: 'success', computed: 84 })

        // Should now be in completed state (event form)
        expect(completed.data?.stateVerb).toBe('started')
        expect(completed.data?.output).toEqual({ result: 'success', computed: 84 })
        expect(await getInstanceState(db, completed.id)).toBe('completed')
      })

      it('throws error if instance not in running state', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        // Instance is in pending state, not running

        await expect(completeInstance(db, instance.id, {})).rejects.toThrow('Invalid transition')
      })
    })

    describe('pauseInstance', () => {
      it('transitions from running to paused', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        await startInstance(db, instance.id)
        expect(await getInstanceState(db, instance.id)).toBe('running')

        // Pause the instance
        const paused = await pauseInstance(db, instance.id)

        expect(paused.data?.stateVerb).toBe('paused')
        expect(await getInstanceState(db, paused.id)).toBe('paused')
      })

      it('throws error if instance not in running state', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        // Instance is in pending state, not running

        await expect(pauseInstance(db, instance.id)).rejects.toThrow('Invalid transition')
      })
    })

    describe('resumeInstance', () => {
      it('transitions from paused back to running', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        await startInstance(db, instance.id)
        await pauseInstance(db, instance.id)
        expect(await getInstanceState(db, instance.id)).toBe('paused')

        // Resume the instance
        const resumed = await resumeInstance(db, instance.id)

        expect(resumed.data?.stateVerb).toBe('starting')
        expect(await getInstanceState(db, resumed.id)).toBe('running')
      })

      it('throws error if instance not in paused state', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        await startInstance(db, instance.id)
        // Instance is in running state, not paused

        await expect(resumeInstance(db, instance.id)).rejects.toThrow('Invalid transition')
      })
    })

    describe('failInstance', () => {
      it('transitions from running to failed with error', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        await startInstance(db, instance.id)

        // Fail the instance
        const failed = await failInstance(db, instance.id, new Error('Something went wrong'))

        expect(failed.data?.stateVerb).toBe('failed')
        expect(failed.data?.error).toBe('Something went wrong')
        expect(await getInstanceState(db, failed.id)).toBe('failed')
      })

      it('throws error if instance not in running state', async () => {
        const instance = await createInstance(db, {
          workflowId: 'workflow-test',
          input: {},
        })
        // Instance is in pending state, not running

        await expect(failInstance(db, instance.id, new Error('Test'))).rejects.toThrow('Invalid transition')
      })
    })
  })

  // ==========================================================================
  // 3. Query by State
  // ==========================================================================

  describe('queryInstancesByState', () => {
    it('queries instances in pending state', async () => {
      // Create multiple instances in different states
      const inst1 = await createInstance(db, { workflowId: 'wf1', input: {} })
      const inst2 = await createInstance(db, { workflowId: 'wf2', input: {} })
      const inst3 = await createInstance(db, { workflowId: 'wf3', input: {} })
      await startInstance(db, inst3.id) // Move to running

      // Query pending instances
      const pending = await queryInstancesByState(db, 'pending')

      expect(pending).toHaveLength(2)
      expect(pending.map((i) => i.id).sort()).toEqual([inst1.id, inst2.id].sort())
    })

    it('queries instances in running state', async () => {
      const inst1 = await createInstance(db, { workflowId: 'wf1', input: {} })
      const inst2 = await createInstance(db, { workflowId: 'wf2', input: {} })
      await startInstance(db, inst1.id)
      await startInstance(db, inst2.id)
      await completeInstance(db, inst2.id, {}) // Move to completed

      // Query running instances
      const running = await queryInstancesByState(db, 'running')

      expect(running).toHaveLength(1)
      expect(running[0]!.id).toBe(inst1.id)
    })

    it('queries instances in completed state', async () => {
      const inst1 = await createInstance(db, { workflowId: 'wf1', input: {} })
      const inst2 = await createInstance(db, { workflowId: 'wf2', input: {} })
      await startInstance(db, inst1.id)
      await completeInstance(db, inst1.id, { result: 'done' })
      await startInstance(db, inst2.id)
      await completeInstance(db, inst2.id, { result: 'also done' })

      // Query completed instances
      const completed = await queryInstancesByState(db, 'completed')

      expect(completed).toHaveLength(2)
    })

    it('queries instances in paused state', async () => {
      const inst1 = await createInstance(db, { workflowId: 'wf1', input: {} })
      const inst2 = await createInstance(db, { workflowId: 'wf2', input: {} })
      await startInstance(db, inst1.id)
      await pauseInstance(db, inst1.id)
      await startInstance(db, inst2.id)

      // Query paused instances
      const paused = await queryInstancesByState(db, 'paused')

      expect(paused).toHaveLength(1)
      expect(paused[0]!.id).toBe(inst1.id)
    })

    it('queries instances in failed state', async () => {
      const inst1 = await createInstance(db, { workflowId: 'wf1', input: {} })
      const inst2 = await createInstance(db, { workflowId: 'wf2', input: {} })
      await startInstance(db, inst1.id)
      await failInstance(db, inst1.id, new Error('Failed'))
      await startInstance(db, inst2.id)
      await completeInstance(db, inst2.id, {})

      // Query failed instances
      const failed = await queryInstancesByState(db, 'failed')

      expect(failed).toHaveLength(1)
      expect(failed[0]!.id).toBe(inst1.id)
    })

    it('filters by workflowId', async () => {
      const inst1 = await createInstance(db, { workflowId: 'wf-a', input: {} })
      const inst2 = await createInstance(db, { workflowId: 'wf-b', input: {} })
      const inst3 = await createInstance(db, { workflowId: 'wf-a', input: {} })

      // Query pending instances for wf-a only
      const pending = await queryInstancesByState(db, 'pending', { workflowId: 'wf-a' })

      expect(pending).toHaveLength(2)
      expect(pending.every((i) => i.data?.workflowId === 'wf-a')).toBe(true)
    })
  })

  // ==========================================================================
  // 4. getInstance
  // ==========================================================================

  describe('getInstance', () => {
    it('retrieves instance by ID', async () => {
      const created = await createInstance(db, {
        id: 'test-get-instance',
        workflowId: 'wf-test',
        input: { key: 'value' },
      })

      const retrieved = await getInstance(db, 'test-get-instance')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('test-get-instance')
      expect(retrieved!.data?.workflowId).toBe('wf-test')
      expect(retrieved!.data?.input).toEqual({ key: 'value' })
    })

    it('returns null for non-existent instance', async () => {
      const retrieved = await getInstance(db, 'does-not-exist')
      expect(retrieved).toBeNull()
    })
  })

  // ==========================================================================
  // 5. Complete Workflow Lifecycle
  // ==========================================================================

  describe('Complete Workflow Lifecycle', () => {
    it('demonstrates full lifecycle: pending -> running -> completed', async () => {
      // 1. Create instance (pending)
      const instance = await createInstance(db, {
        workflowId: 'order-processing',
        input: { orderId: 'ORD-001', items: ['item1', 'item2'] },
      })
      expect(instance.data?.stateVerb).toBe('start')
      expect(await getInstanceState(db, instance.id)).toBe('pending')

      // 2. Start instance (running)
      const running = await startInstance(db, instance.id)
      expect(running.data?.stateVerb).toBe('starting')
      expect(await getInstanceState(db, running.id)).toBe('running')

      // 3. Complete instance (completed)
      const completed = await completeInstance(db, instance.id, {
        processedAt: Date.now(),
        status: 'shipped',
      })
      expect(completed.data?.stateVerb).toBe('started')
      expect(completed.data?.output).toEqual({
        processedAt: expect.any(Number),
        status: 'shipped',
      })
      expect(await getInstanceState(db, completed.id)).toBe('completed')
    })

    it('demonstrates lifecycle with pause: pending -> running -> paused -> running -> completed', async () => {
      const instance = await createInstance(db, {
        workflowId: 'long-running-task',
        input: { taskId: 'TASK-001' },
      })

      // Start
      await startInstance(db, instance.id)
      expect(await getInstanceState(db, instance.id)).toBe('running')

      // Pause
      await pauseInstance(db, instance.id)
      expect(await getInstanceState(db, instance.id)).toBe('paused')

      // Resume
      await resumeInstance(db, instance.id)
      expect(await getInstanceState(db, instance.id)).toBe('running')

      // Complete
      await completeInstance(db, instance.id, { result: 'done' })
      expect(await getInstanceState(db, instance.id)).toBe('completed')
    })

    it('demonstrates lifecycle with failure: pending -> running -> failed', async () => {
      const instance = await createInstance(db, {
        workflowId: 'risky-operation',
        input: { operation: 'dangerous' },
      })

      // Start
      await startInstance(db, instance.id)
      expect(await getInstanceState(db, instance.id)).toBe('running')

      // Fail
      await failInstance(db, instance.id, new Error('Operation failed: insufficient permissions'))
      expect(await getInstanceState(db, instance.id)).toBe('failed')

      // Verify error is stored
      const failed = await getInstance(db, instance.id)
      expect(failed?.data?.error).toBe('Operation failed: insufficient permissions')
    })
  })
})
