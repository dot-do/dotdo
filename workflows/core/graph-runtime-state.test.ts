/**
 * GraphRuntimeState Tests
 *
 * Tests for the graph-based state management for WorkflowRuntime.
 * Verifies that workflow state is properly stored as Things and
 * step execution is tracked via Relationships.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  GraphRuntimeState,
  InMemoryGraphStorage,
  createInMemoryGraphRuntimeState,
  type WorkflowRunThing,
  type WorkflowStepThing,
} from './graph-runtime-state'

// ============================================================================
// TESTS
// ============================================================================

describe('GraphRuntimeState', () => {
  let storage: InMemoryGraphStorage
  let state: GraphRuntimeState

  beforeEach(() => {
    storage = new InMemoryGraphStorage()
    state = new GraphRuntimeState(storage, {
      name: 'test-workflow',
      version: '1.0.0',
    })
  })

  // ==========================================================================
  // 1. WORKFLOW INITIALIZATION
  // ==========================================================================

  describe('Workflow Initialization', () => {
    it('creates a workflow run Thing on initialization', async () => {
      const workflow = await state.initialize({ input: 'test' })

      expect(workflow).toBeDefined()
      expect(workflow.$type).toBe('WorkflowRun')
      expect(workflow.data.name).toBe('test-workflow')
      expect(workflow.data.version).toBe('1.0.0')
      expect(workflow.data.status).toBe('pending')
      expect(workflow.data.input).toEqual({ input: 'test' })
    })

    it('generates a unique instance ID', async () => {
      const workflow1 = await state.initialize()
      const state2 = new GraphRuntimeState(storage, { name: 'workflow-2' })
      const workflow2 = await state2.initialize()

      expect(workflow1.data.instanceId).not.toBe(workflow2.data.instanceId)
    })

    it('uses provided instance ID when given', async () => {
      const customState = new GraphRuntimeState(storage, {
        name: 'custom-workflow',
        instanceId: 'custom-id-123',
      })
      const workflow = await customState.initialize()

      expect(workflow.data.instanceId).toBe('custom-id-123')
      expect(workflow.$id).toBe('workflow:custom-id-123')
    })

    it('stores workflow with proper timestamps', async () => {
      const before = Date.now()
      const workflow = await state.initialize()
      const after = Date.now()

      expect(workflow.createdAt).toBeGreaterThanOrEqual(before)
      expect(workflow.createdAt).toBeLessThanOrEqual(after)
      expect(workflow.updatedAt).toBeGreaterThanOrEqual(before)
      expect(workflow.updatedAt).toBeLessThanOrEqual(after)
    })
  })

  // ==========================================================================
  // 2. WORKFLOW STATUS TRANSITIONS
  // ==========================================================================

  describe('Workflow Status Transitions', () => {
    beforeEach(async () => {
      await state.initialize({ data: 'input' })
    })

    it('transitions to running on start', async () => {
      await state.start({ data: 'input' })
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.status).toBe('running')
      expect(workflow?.data.startedAt).toBeDefined()
    })

    it('transitions to completed with output', async () => {
      await state.start({ data: 'input' })
      await state.complete({ result: 'success' })
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.status).toBe('completed')
      expect(workflow?.data.output).toEqual({ result: 'success' })
      expect(workflow?.data.completedAt).toBeDefined()
    })

    it('transitions to failed with error', async () => {
      await state.start({ data: 'input' })
      await state.fail(new Error('Test error'))
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.status).toBe('failed')
      expect(workflow?.data.error?.message).toBe('Test error')
      expect(workflow?.data.completedAt).toBeDefined()
    })

    it('transitions to paused with pending events', async () => {
      await state.start({ data: 'input' })
      await state.pause(['approval-event', 'review-event'])
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.status).toBe('paused')
      expect(workflow?.data.pendingEvents).toEqual(['approval-event', 'review-event'])
    })

    it('resumes from paused state', async () => {
      await state.start({ data: 'input' })
      await state.pause(['approval-event'])
      await state.resume()
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.status).toBe('running')
      expect(workflow?.data.pendingEvents).toEqual([])
    })
  })

  // ==========================================================================
  // 3. STEP CREATION AS THINGS
  // ==========================================================================

  describe('Step Creation as Things', () => {
    beforeEach(async () => {
      await state.initialize()
    })

    it('creates a step as a Thing with correct structure', async () => {
      const step = await state.createStep(0, 'validate-input')

      expect(step).toBeDefined()
      expect(step.$type).toBe('WorkflowStep')
      expect(step.data.name).toBe('validate-input')
      expect(step.data.index).toBe(0)
      expect(step.data.status).toBe('pending')
    })

    it('creates executes relationship from workflow to step', async () => {
      await state.createStep(0, 'step-1')
      const relationships = await storage.getRelationshipsFrom(state.id, 'executes')

      expect(relationships).toHaveLength(1)
      expect(relationships[0]?.verb).toBe('executes')
      expect(relationships[0]?.data?.order).toBe(0)
    })

    it('creates follows relationship between sequential steps', async () => {
      const step1 = await state.createStep(0, 'step-1')
      const step2 = await state.createStep(1, 'step-2')

      const followsRels = await storage.getRelationshipsTo(step2.$id, 'follows')
      expect(followsRels).toHaveLength(1)
      expect(followsRels[0]?.from).toBe(step1.$id)
    })

    it('stores parallel step flag correctly', async () => {
      const step = await state.createStep(0, 'parallel-step', true)

      expect(step.data.isParallel).toBe(true)
    })
  })

  // ==========================================================================
  // 4. STEP EXECUTION TRACKING VIA RELATIONSHIPS
  // ==========================================================================

  describe('Step Execution Tracking', () => {
    beforeEach(async () => {
      await state.initialize()
      await state.createStep(0, 'step-1')
      await state.createStep(1, 'step-2')
      await state.createStep(2, 'step-3')
    })

    it('tracks step started status', async () => {
      await state.stepStarted(0)
      const step = await state.getStep(0)

      expect(step?.data.status).toBe('running')
      expect(step?.data.startedAt).toBeDefined()
    })

    it('tracks step completed with output and duration', async () => {
      await state.stepStarted(0)
      await state.stepCompleted(0, { result: 'done' }, 150)
      const step = await state.getStep(0)

      expect(step?.data.status).toBe('completed')
      expect(step?.data.output).toEqual({ result: 'done' })
      expect(step?.data.duration).toBe(150)
      expect(step?.data.completedAt).toBeDefined()
    })

    it('tracks step failed with error and retry count', async () => {
      await state.stepStarted(0)
      await state.stepFailed(0, new Error('Step failed'), 2)
      const step = await state.getStep(0)

      expect(step?.data.status).toBe('failed')
      expect(step?.data.error?.message).toBe('Step failed')
      expect(step?.data.retryCount).toBe(2)
    })

    it('retrieves all steps in order', async () => {
      const steps = await state.getSteps()

      expect(steps).toHaveLength(3)
      expect(steps[0]?.data.name).toBe('step-1')
      expect(steps[1]?.data.name).toBe('step-2')
      expect(steps[2]?.data.name).toBe('step-3')
    })
  })

  // ==========================================================================
  // 5. GRAPH QUERIES
  // ==========================================================================

  describe('Graph Queries', () => {
    beforeEach(async () => {
      await state.initialize()
      await state.createStep(0, 'step-1')
      await state.createStep(1, 'step-2')
      await state.createStep(2, 'step-3')
    })

    it('gets execution chain in order', async () => {
      const chain = await state.getExecutionChain()

      expect(chain).toHaveLength(3)
      expect(chain[0]?.data.index).toBe(0)
      expect(chain[1]?.data.index).toBe(1)
      expect(chain[2]?.data.index).toBe(2)
    })

    it('gets following steps via relationship', async () => {
      const step1 = await state.getStep(0)
      const following = await state.getFollowingSteps(step1!.$id)

      expect(following).toHaveLength(1)
      expect(following[0]?.data.name).toBe('step-2')
    })

    it('gets preceding step via relationship', async () => {
      const step2 = await state.getStep(1)
      const preceding = await state.getPrecedingStep(step2!.$id)

      expect(preceding).toBeDefined()
      expect(preceding?.data.name).toBe('step-1')
    })

    it('returns null for first step having no predecessor', async () => {
      const step1 = await state.getStep(0)
      const preceding = await state.getPrecedingStep(step1!.$id)

      expect(preceding).toBeNull()
    })

    it('counts completed steps', async () => {
      await state.stepStarted(0)
      await state.stepCompleted(0, { result: 1 }, 100)
      await state.stepStarted(1)
      await state.stepCompleted(1, { result: 2 }, 100)

      const count = await state.getCompletedStepsCount()
      expect(count).toBe(2)
    })

    it('counts failed steps', async () => {
      await state.stepStarted(0)
      await state.stepFailed(0, new Error('Error 1'))
      await state.stepStarted(1)
      await state.stepFailed(1, new Error('Error 2'))

      const count = await state.getFailedStepsCount()
      expect(count).toBe(2)
    })
  })

  // ==========================================================================
  // 6. PARALLEL STEP RESULTS
  // ==========================================================================

  describe('Parallel Step Results', () => {
    beforeEach(async () => {
      await state.initialize()
      await state.createStep(0, 'parallel-group', true)
    })

    it('stores parallel step results', async () => {
      const parallelResults = {
        'check-inventory': {
          name: 'check-inventory',
          status: 'completed' as const,
          output: { available: true },
          duration: 50,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        'check-payment': {
          name: 'check-payment',
          status: 'completed' as const,
          output: { valid: true },
          duration: 75,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      }

      await state.updateParallelResults(0, parallelResults)
      const step = await state.getStep(0)

      expect(step?.data.parallelResults).toBeDefined()
      expect(step?.data.parallelResults?.['check-inventory']?.output).toEqual({ available: true })
      expect(step?.data.parallelResults?.['check-payment']?.output).toEqual({ valid: true })
    })
  })

  // ==========================================================================
  // 7. EXECUTION HISTORY PRESERVATION
  // ==========================================================================

  describe('Execution History Preservation', () => {
    beforeEach(async () => {
      await state.initialize({ input: 'test' })
      await state.start({ input: 'test' })
      await state.createStep(0, 'step-1')
      await state.stepStarted(0)
      await state.stepCompleted(0, { result: 'step-1-done' }, 100)
      await state.createStep(1, 'step-2')
      await state.stepStarted(1)
      await state.stepCompleted(1, { result: 'step-2-done' }, 150)
      await state.complete({ final: 'output' })
    })

    it('retrieves full execution history', async () => {
      const history = await state.getExecutionHistory()

      expect(history.workflow).toBeDefined()
      expect(history.workflow?.data.status).toBe('completed')
      expect(history.steps).toHaveLength(2)
      expect(history.relationships.length).toBeGreaterThan(0)
    })

    it('exports state for persistence', async () => {
      const exported = await state.exportState()

      expect(exported.workflow).toBeDefined()
      expect(exported.workflow?.data.name).toBe('test-workflow')
      expect(exported.steps).toHaveLength(2)
    })

    it('imports state for recovery', async () => {
      const exported = await state.exportState()

      // Create new storage and state
      const newStorage = new InMemoryGraphStorage()
      const recoveredState = new GraphRuntimeState(newStorage, {
        name: 'test-workflow',
        instanceId: state.instance,
      })

      await recoveredState.importState({
        workflow: exported.workflow!,
        steps: exported.steps,
      })

      const recoveredWorkflow = await recoveredState.getWorkflowRun()
      const recoveredSteps = await recoveredState.getSteps()

      expect(recoveredWorkflow?.data.status).toBe('completed')
      expect(recoveredSteps).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 8. CURRENT STEP INDEX TRACKING
  // ==========================================================================

  describe('Current Step Index Tracking', () => {
    beforeEach(async () => {
      await state.initialize()
    })

    it('updates current step index', async () => {
      await state.setCurrentStepIndex(2)
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.currentStepIndex).toBe(2)
    })

    it('starts with currentStepIndex at 0', async () => {
      const workflow = await state.getWorkflowRun()

      expect(workflow?.data.currentStepIndex).toBe(0)
    })
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('Factory Functions', () => {
  it('createInMemoryGraphRuntimeState creates functional state', async () => {
    const state = createInMemoryGraphRuntimeState({
      name: 'factory-test',
      version: '2.0.0',
    })

    const workflow = await state.initialize({ test: true })

    expect(workflow.data.name).toBe('factory-test')
    expect(workflow.data.version).toBe('2.0.0')
  })
})

// ============================================================================
// IN-MEMORY STORAGE TESTS
// ============================================================================

describe('InMemoryGraphStorage', () => {
  let storage: InMemoryGraphStorage

  beforeEach(() => {
    storage = new InMemoryGraphStorage()
  })

  it('stores and retrieves things', async () => {
    const thing: WorkflowRunThing = {
      $id: 'test-thing',
      $type: 'WorkflowRun',
      data: {
        name: 'test',
        status: 'pending',
        instanceId: 'test-id',
        currentStepIndex: 0,
        pendingEvents: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.createThing(thing)
    const retrieved = await storage.getThing<WorkflowRunThing>('test-thing')

    expect(retrieved).toEqual(thing)
  })

  it('updates things', async () => {
    const thing: WorkflowRunThing = {
      $id: 'update-test',
      $type: 'WorkflowRun',
      data: {
        name: 'test',
        status: 'pending',
        instanceId: 'test-id',
        currentStepIndex: 0,
        pendingEvents: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.createThing(thing)
    await storage.updateThing('update-test', { status: 'running' })

    const updated = await storage.getThing<WorkflowRunThing>('update-test')
    expect(updated?.data.status).toBe('running')
  })

  it('lists things with filters', async () => {
    const workflowThing: WorkflowRunThing = {
      $id: 'workflow:1',
      $type: 'WorkflowRun',
      data: {
        name: 'test',
        status: 'pending',
        instanceId: '1',
        currentStepIndex: 0,
        pendingEvents: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const stepThing: WorkflowStepThing = {
      $id: 'workflow:1:step:0',
      $type: 'WorkflowStep',
      data: {
        name: 'step-1',
        index: 0,
        status: 'pending',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await storage.createThing(workflowThing)
    await storage.createThing(stepThing)

    const workflows = await storage.listThings({ type: 'WorkflowRun' })
    expect(workflows).toHaveLength(1)

    const steps = await storage.listThings({ type: 'WorkflowStep' })
    expect(steps).toHaveLength(1)
  })

  it('creates and queries relationships', async () => {
    const rel = await storage.createRelationship({
      verb: 'executes',
      from: 'workflow:1',
      to: 'workflow:1:step:0',
      data: { order: 0 },
    })

    expect(rel.id).toBeDefined()

    const fromRels = await storage.getRelationshipsFrom('workflow:1', 'executes')
    expect(fromRels).toHaveLength(1)

    const toRels = await storage.getRelationshipsTo('workflow:1:step:0', 'executes')
    expect(toRels).toHaveLength(1)
  })

  it('deletes relationships', async () => {
    const rel = await storage.createRelationship({
      verb: 'executes',
      from: 'workflow:1',
      to: 'workflow:1:step:0',
    })

    await storage.deleteRelationship(rel.id)

    const rels = await storage.getRelationshipsFrom('workflow:1')
    expect(rels).toHaveLength(0)
  })

  it('clears all data', async () => {
    await storage.createThing({
      $id: 'test',
      $type: 'WorkflowRun',
      data: {
        name: 'test',
        status: 'pending',
        instanceId: 'test',
        currentStepIndex: 0,
        pendingEvents: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as WorkflowRunThing)

    storage.clear()

    const thing = await storage.getThing('test')
    expect(thing).toBeNull()
  })
})
