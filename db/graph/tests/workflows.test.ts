/**
 * Workflows as Graph Things - Comprehensive Tests
 *
 * Tests for Workflows as Things in the Graph model with state tracking via verb forms.
 *
 * Key concepts tested:
 * 1. **Workflow Templates**: Define workflow structure as a Thing
 * 2. **Workflow Instances**: Running instances with state
 * 3. **Verb Forms**: Use verb conjugations for state (started, running, completed, failed)
 * 4. **Step Relationships**: CONTAINS, FOLLOWS, BRANCHES_TO
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import {
  // Types
  WORKFLOW_TEMPLATE_TYPE_ID,
  WORKFLOW_TEMPLATE_TYPE_NAME,
  WORKFLOW_INSTANCE_TYPE_ID,
  WORKFLOW_INSTANCE_TYPE_NAME,
  WORKFLOW_STEP_TYPE_ID,
  WORKFLOW_STEP_TYPE_NAME,
  WORKFLOW_VERBS,
  type InstanceState,
  type StepExecutionState,
  // Template operations
  createWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplates,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
  createWorkflowStep,
  getWorkflowStep,
  getTemplateSteps,
  createStepFollowsRelationship,
  createStepBranchRelationship,
  getFollowingSteps,
  getBranchTargets,
  WorkflowTemplateBuilder,
  createWorkflowTemplateBuilder,
  // Instance operations
  createWorkflowInstance,
  getWorkflowInstance,
  getWorkflowInstanceState,
  queryWorkflowInstances,
  queryInstancesByState,
  startWorkflowInstance,
  completeWorkflowInstance,
  pauseWorkflowInstance,
  resumeWorkflowInstance,
  failWorkflowInstance,
  cancelWorkflowInstance,
  updateInstanceCurrentStep,
  verbFormToInstanceState,
  instanceStateToVerbForms,
  getInstanceTemplateId,
  getTemplateInstances,
  recordInstanceTrigger,
  getInstanceTrigger,
  // Step execution
  StepExecutionStore,
  createStepExecutionStore,
  verbFormToStepState,
  stepStateToVerbForms,
  // WorkflowCore bridge
  GraphWorkflowRuntime,
  createGraphWorkflowRuntime,
} from '../workflows'

// ============================================================================
// TEST SUITE: Workflow Templates
// ============================================================================

describe('Workflow Templates', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Template CRUD', () => {
    it('creates a workflow template', async () => {
      const template = await createWorkflowTemplate(store, {
        name: 'expense-approval',
        description: 'Approve expense requests',
        version: '1.0.0',
        tags: ['finance', 'approval'],
      })

      expect(template.id).toBeDefined()
      expect(template.typeId).toBe(WORKFLOW_TEMPLATE_TYPE_ID)
      expect(template.typeName).toBe(WORKFLOW_TEMPLATE_TYPE_NAME)
      expect(template.data?.name).toBe('expense-approval')
      expect(template.data?.version).toBe('1.0.0')
      expect(template.data?.tags).toEqual(['finance', 'approval'])
    })

    it('creates a template with custom ID', async () => {
      const template = await createWorkflowTemplate(store, {
        id: 'template:my-workflow',
        name: 'my-workflow',
        version: '1.0.0',
      })

      expect(template.id).toBe('template:my-workflow')
    })

    it('gets a workflow template by ID', async () => {
      const created = await createWorkflowTemplate(store, {
        name: 'test-workflow',
        version: '1.0.0',
      })

      const retrieved = await getWorkflowTemplate(store, created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.data?.name).toBe('test-workflow')
    })

    it('returns null for non-existent template', async () => {
      const retrieved = await getWorkflowTemplate(store, 'non-existent')
      expect(retrieved).toBeNull()
    })

    it('lists workflow templates', async () => {
      await createWorkflowTemplate(store, { name: 'workflow-1', version: '1.0.0' })
      await createWorkflowTemplate(store, { name: 'workflow-2', version: '1.0.0' })
      await createWorkflowTemplate(store, { name: 'workflow-3', version: '1.0.0' })

      const templates = await listWorkflowTemplates(store)

      expect(templates).toHaveLength(3)
    })

    it('filters templates by tag', async () => {
      await createWorkflowTemplate(store, { name: 'wf-1', version: '1.0.0', tags: ['finance'] })
      await createWorkflowTemplate(store, { name: 'wf-2', version: '1.0.0', tags: ['hr'] })
      await createWorkflowTemplate(store, { name: 'wf-3', version: '1.0.0', tags: ['finance', 'hr'] })

      const financeTemplates = await listWorkflowTemplates(store, { tag: 'finance' })

      expect(financeTemplates).toHaveLength(2)
    })

    it('updates a workflow template', async () => {
      const created = await createWorkflowTemplate(store, {
        name: 'test-workflow',
        version: '1.0.0',
      })

      const updated = await updateWorkflowTemplate(store, created.id, {
        description: 'Updated description',
        version: '1.1.0',
      })

      expect(updated).not.toBeNull()
      expect(updated!.data?.description).toBe('Updated description')
      expect(updated!.data?.version).toBe('1.1.0')
      expect(updated!.data?.name).toBe('test-workflow') // Original field preserved
    })

    it('soft deletes a workflow template', async () => {
      const created = await createWorkflowTemplate(store, {
        name: 'to-delete',
        version: '1.0.0',
      })

      const deleted = await deleteWorkflowTemplate(store, created.id)

      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()

      // Should not appear in normal listings
      const templates = await listWorkflowTemplates(store)
      expect(templates).toHaveLength(0)

      // Should appear with includeDeleted
      const allTemplates = await listWorkflowTemplates(store, { includeDeleted: true })
      expect(allTemplates).toHaveLength(1)
    })
  })

  describe('Workflow Steps', () => {
    let templateId: string

    beforeEach(async () => {
      const template = await createWorkflowTemplate(store, {
        name: 'step-test-workflow',
        version: '1.0.0',
      })
      templateId = template.id
    })

    it('creates a workflow step', async () => {
      const step = await createWorkflowStep(store, {
        templateId,
        name: 'validate',
        type: 'action',
        index: 0,
        description: 'Validate input data',
      })

      expect(step.id).toBeDefined()
      expect(step.typeId).toBe(WORKFLOW_STEP_TYPE_ID)
      expect(step.typeName).toBe(WORKFLOW_STEP_TYPE_NAME)
      expect(step.data?.name).toBe('validate')
      expect(step.data?.type).toBe('action')
      expect(step.data?.index).toBe(0)
    })

    it('creates CONTAINS relationship to template', async () => {
      const step = await createWorkflowStep(store, {
        templateId,
        name: 'step-1',
        type: 'action',
        index: 0,
      })

      const containsRels = await store.queryRelationshipsFrom(templateId, {
        verb: WORKFLOW_VERBS.CONTAINS,
      })

      expect(containsRels).toHaveLength(1)
      expect(containsRels[0]!.to).toBe(step.id)
    })

    it('gets all steps for a template', async () => {
      await createWorkflowStep(store, { templateId, name: 'step-1', type: 'action', index: 0 })
      await createWorkflowStep(store, { templateId, name: 'step-2', type: 'action', index: 1 })
      await createWorkflowStep(store, { templateId, name: 'step-3', type: 'action', index: 2 })

      const steps = await getTemplateSteps(store, templateId)

      expect(steps).toHaveLength(3)
      expect(steps[0]!.data?.name).toBe('step-1')
      expect(steps[1]!.data?.name).toBe('step-2')
      expect(steps[2]!.data?.name).toBe('step-3')
    })

    it('orders steps by index', async () => {
      // Create steps out of order
      await createWorkflowStep(store, { templateId, name: 'step-3', type: 'action', index: 2 })
      await createWorkflowStep(store, { templateId, name: 'step-1', type: 'action', index: 0 })
      await createWorkflowStep(store, { templateId, name: 'step-2', type: 'action', index: 1 })

      const steps = await getTemplateSteps(store, templateId)

      expect(steps[0]!.data?.index).toBe(0)
      expect(steps[1]!.data?.index).toBe(1)
      expect(steps[2]!.data?.index).toBe(2)
    })
  })

  describe('Step Relationships: FOLLOWS', () => {
    let templateId: string

    beforeEach(async () => {
      const template = await createWorkflowTemplate(store, {
        name: 'follows-test',
        version: '1.0.0',
      })
      templateId = template.id
    })

    it('creates FOLLOWS relationship between steps', async () => {
      const step1 = await createWorkflowStep(store, { templateId, name: 'step-1', type: 'action', index: 0 })
      const step2 = await createWorkflowStep(store, { templateId, name: 'step-2', type: 'action', index: 1 })

      await createStepFollowsRelationship(store, step1.id, step2.id)

      const followsRels = await store.queryRelationshipsFrom(step1.id, {
        verb: WORKFLOW_VERBS.FOLLOWS,
      })

      expect(followsRels).toHaveLength(1)
      expect(followsRels[0]!.to).toBe(step2.id)
    })

    it('gets following steps', async () => {
      const step1 = await createWorkflowStep(store, { templateId, name: 'step-1', type: 'action', index: 0 })
      const step2 = await createWorkflowStep(store, { templateId, name: 'step-2', type: 'action', index: 1 })
      const step3 = await createWorkflowStep(store, { templateId, name: 'step-3', type: 'action', index: 2 })

      await createStepFollowsRelationship(store, step1.id, step2.id)
      await createStepFollowsRelationship(store, step2.id, step3.id)

      const followingStep1 = await getFollowingSteps(store, step1.id)
      const followingStep2 = await getFollowingSteps(store, step2.id)

      expect(followingStep1).toHaveLength(1)
      expect(followingStep1[0]!.id).toBe(step2.id)

      expect(followingStep2).toHaveLength(1)
      expect(followingStep2[0]!.id).toBe(step3.id)
    })
  })

  describe('Step Relationships: BRANCHES_TO', () => {
    let templateId: string

    beforeEach(async () => {
      const template = await createWorkflowTemplate(store, {
        name: 'branch-test',
        version: '1.0.0',
      })
      templateId = template.id
    })

    it('creates BRANCHES_TO relationship with condition', async () => {
      const decision = await createWorkflowStep(store, { templateId, name: 'decide', type: 'decision', index: 0 })
      const approve = await createWorkflowStep(store, { templateId, name: 'approve', type: 'action', index: 1 })
      const reject = await createWorkflowStep(store, { templateId, name: 'reject', type: 'action', index: 2 })

      await createStepBranchRelationship(store, decision.id, approve.id, 'amount < 1000')
      await createStepBranchRelationship(store, decision.id, reject.id, 'amount >= 1000')

      const branchRels = await store.queryRelationshipsFrom(decision.id, {
        verb: WORKFLOW_VERBS.BRANCHES_TO,
      })

      expect(branchRels).toHaveLength(2)
    })

    it('gets branch targets with conditions', async () => {
      const decision = await createWorkflowStep(store, { templateId, name: 'decide', type: 'decision', index: 0 })
      const approve = await createWorkflowStep(store, { templateId, name: 'approve', type: 'action', index: 1 })
      const reject = await createWorkflowStep(store, { templateId, name: 'reject', type: 'action', index: 2 })

      await createStepBranchRelationship(store, decision.id, approve.id, 'amount < 1000')
      await createStepBranchRelationship(store, decision.id, reject.id, 'amount >= 1000')

      const targets = await getBranchTargets(store, decision.id)

      expect(targets).toHaveLength(2)
      expect(targets.some(t => t.condition === 'amount < 1000')).toBe(true)
      expect(targets.some(t => t.condition === 'amount >= 1000')).toBe(true)
    })
  })

  describe('WorkflowTemplateBuilder', () => {
    it('builds a complete workflow with steps and relationships', async () => {
      const builder = createWorkflowTemplateBuilder(store)

      // Must await createTemplate before chaining addStep
      const readyBuilder = await builder.createTemplate({
        name: 'expense-approval',
        version: '1.0.0',
      })

      const { template, steps } = await readyBuilder
        .addStep({ name: 'validate', type: 'action', index: 0 })
        .addStep({ name: 'route', type: 'action', index: 1 }, { follows: 'validate' })
        .addStep({ name: 'approve', type: 'human', index: 2 }, { follows: 'route' })
        .addStep({ name: 'process', type: 'action', index: 3 }, { follows: 'approve' })
        .build()

      expect(template.data?.name).toBe('expense-approval')
      expect(steps).toHaveLength(4)

      // Verify FOLLOWS relationships
      const validateFollows = await getFollowingSteps(store, steps[0]!.id)
      expect(validateFollows).toHaveLength(1)
      expect(validateFollows[0]!.data?.name).toBe('route')
    })
  })
})

// ============================================================================
// TEST SUITE: Workflow Instances
// ============================================================================

describe('Workflow Instances', () => {
  let store: SQLiteGraphStore
  let templateId: string

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    const template = await createWorkflowTemplate(store, {
      name: 'test-workflow',
      version: '1.0.0',
    })
    templateId = template.id
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Instance CRUD', () => {
    it('creates a workflow instance in pending state', async () => {
      const instance = await createWorkflowInstance(store, {
        templateId,
        input: { amount: 1500 },
      })

      expect(instance.id).toBeDefined()
      expect(instance.typeId).toBe(WORKFLOW_INSTANCE_TYPE_ID)
      expect(instance.typeName).toBe(WORKFLOW_INSTANCE_TYPE_NAME)
      expect(instance.data?.templateId).toBe(templateId)
      expect(instance.data?.stateVerb).toBe('start') // pending state
      expect(instance.data?.input).toEqual({ amount: 1500 })
    })

    it('creates instanceOf relationship to template', async () => {
      const instance = await createWorkflowInstance(store, {
        templateId,
        input: {},
      })

      const instanceOfRels = await store.queryRelationshipsFrom(instance.id, {
        verb: WORKFLOW_VERBS.INSTANCE_OF,
      })

      expect(instanceOfRels).toHaveLength(1)
      expect(instanceOfRels[0]!.to).toBe(templateId)
    })

    it('gets a workflow instance by ID', async () => {
      const created = await createWorkflowInstance(store, {
        templateId,
        input: { test: true },
      })

      const retrieved = await getWorkflowInstance(store, created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
    })

    it('queries instances by template', async () => {
      // Create another template
      const template2 = await createWorkflowTemplate(store, { name: 'other', version: '1.0.0' })

      await createWorkflowInstance(store, { templateId, input: {} })
      await createWorkflowInstance(store, { templateId, input: {} })
      await createWorkflowInstance(store, { templateId: template2.id, input: {} })

      const instances = await queryWorkflowInstances(store, { templateId })

      expect(instances).toHaveLength(2)
    })
  })

  describe('Verb Form State Encoding', () => {
    it('maps verb forms to semantic states', () => {
      expect(verbFormToInstanceState('start')).toBe('pending')
      expect(verbFormToInstanceState('starting')).toBe('running')
      expect(verbFormToInstanceState('started')).toBe('completed')
      expect(verbFormToInstanceState('paused')).toBe('paused')
      expect(verbFormToInstanceState('failed')).toBe('failed')
      expect(verbFormToInstanceState('cancelled')).toBe('cancelled')
    })

    it('maps semantic states to verb forms', () => {
      expect(instanceStateToVerbForms('pending')).toEqual(['start'])
      expect(instanceStateToVerbForms('running')).toEqual(['starting'])
      expect(instanceStateToVerbForms('completed')).toEqual(['started'])
      expect(instanceStateToVerbForms('paused')).toEqual(['paused'])
      expect(instanceStateToVerbForms('failed')).toEqual(['failed'])
      expect(instanceStateToVerbForms('cancelled')).toEqual(['cancelled'])
    })

    it('gets instance state from verb form', async () => {
      const instance = await createWorkflowInstance(store, {
        templateId,
        input: {},
      })

      const state = await getWorkflowInstanceState(store, instance.id)

      expect(state).toBe('pending')
    })
  })

  describe('State Transitions', () => {
    it('starts instance: pending -> running', async () => {
      const instance = await createWorkflowInstance(store, {
        templateId,
        input: {},
      })

      const started = await startWorkflowInstance(store, instance.id)

      expect(started.data?.stateVerb).toBe('starting')
      expect(started.data?.startedAt).toBeDefined()

      const state = await getWorkflowInstanceState(store, instance.id)
      expect(state).toBe('running')
    })

    it('completes instance: running -> completed', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, instance.id)

      const completed = await completeWorkflowInstance(store, instance.id, { result: 'success' })

      expect(completed.data?.stateVerb).toBe('started')
      expect(completed.data?.output).toEqual({ result: 'success' })
      expect(completed.data?.endedAt).toBeDefined()

      const state = await getWorkflowInstanceState(store, instance.id)
      expect(state).toBe('completed')
    })

    it('pauses instance: running -> paused', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, instance.id)

      const paused = await pauseWorkflowInstance(store, instance.id)

      expect(paused.data?.stateVerb).toBe('paused')

      const state = await getWorkflowInstanceState(store, instance.id)
      expect(state).toBe('paused')
    })

    it('resumes instance: paused -> running', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, instance.id)
      await pauseWorkflowInstance(store, instance.id)

      const resumed = await resumeWorkflowInstance(store, instance.id)

      expect(resumed.data?.stateVerb).toBe('starting')

      const state = await getWorkflowInstanceState(store, instance.id)
      expect(state).toBe('running')
    })

    it('fails instance: running -> failed', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, instance.id)

      const failed = await failWorkflowInstance(store, instance.id, new Error('Something went wrong'))

      expect(failed.data?.stateVerb).toBe('failed')
      expect(failed.data?.error).toBe('Something went wrong')
      expect(failed.data?.endedAt).toBeDefined()

      const state = await getWorkflowInstanceState(store, instance.id)
      expect(state).toBe('failed')
    })

    it('cancels instance: any state -> cancelled', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, instance.id)

      const cancelled = await cancelWorkflowInstance(store, instance.id, 'User cancelled')

      expect(cancelled.data?.stateVerb).toBe('cancelled')
      expect(cancelled.data?.error).toBe('User cancelled')

      const state = await getWorkflowInstanceState(store, instance.id)
      expect(state).toBe('cancelled')
    })

    it('rejects invalid state transitions', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })

      // Cannot complete from pending
      await expect(
        completeWorkflowInstance(store, instance.id, {})
      ).rejects.toThrow('Invalid transition')

      // Cannot pause from pending
      await expect(
        pauseWorkflowInstance(store, instance.id)
      ).rejects.toThrow('Invalid transition')

      // Cannot resume from pending
      await expect(
        resumeWorkflowInstance(store, instance.id)
      ).rejects.toThrow('Invalid transition')
    })
  })

  describe('Query by State', () => {
    it('queries instances by state', async () => {
      // Create instances in different states
      const pending = await createWorkflowInstance(store, { templateId, input: {} })

      const running = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, running.id)

      const completed = await createWorkflowInstance(store, { templateId, input: {} })
      await startWorkflowInstance(store, completed.id)
      await completeWorkflowInstance(store, completed.id, {})

      // Query each state
      const pendingInstances = await queryInstancesByState(store, 'pending')
      const runningInstances = await queryInstancesByState(store, 'running')
      const completedInstances = await queryInstancesByState(store, 'completed')

      expect(pendingInstances).toHaveLength(1)
      expect(runningInstances).toHaveLength(1)
      expect(completedInstances).toHaveLength(1)
    })
  })

  describe('Instance Triggers', () => {
    it('records what triggered an instance', async () => {
      const instance = await createWorkflowInstance(store, { templateId, input: {} })

      await recordInstanceTrigger(store, instance.id, 'schedule:daily-report', {
        scheduledAt: Date.now(),
      })

      const trigger = await getInstanceTrigger(store, instance.id)

      expect(trigger).not.toBeNull()
      expect(trigger!.triggerId).toBe('schedule:daily-report')
      expect(trigger!.data?.scheduledAt).toBeDefined()
    })

    it('gets template instances', async () => {
      await createWorkflowInstance(store, { templateId, input: {} })
      await createWorkflowInstance(store, { templateId, input: {} })

      const instances = await getTemplateInstances(store, templateId)

      expect(instances).toHaveLength(2)
    })
  })
})

// ============================================================================
// TEST SUITE: Step Execution
// ============================================================================

describe('Step Execution', () => {
  let store: SQLiteGraphStore
  let stepStore: StepExecutionStore
  let templateId: string
  let instanceId: string

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    stepStore = createStepExecutionStore(store)

    const template = await createWorkflowTemplate(store, {
      name: 'step-test',
      version: '1.0.0',
    })
    templateId = template.id

    await createWorkflowStep(store, { templateId, name: 'step-1', type: 'action', index: 0 })
    await createWorkflowStep(store, { templateId, name: 'step-2', type: 'action', index: 1 })
    await createWorkflowStep(store, { templateId, name: 'step-3', type: 'action', index: 2 })

    const instance = await createWorkflowInstance(store, {
      templateId,
      input: { test: true },
    })
    instanceId = instance.id
    await startWorkflowInstance(store, instanceId)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Verb Form State Encoding', () => {
    it('maps verb forms to step states', () => {
      expect(verbFormToStepState('execute')).toBe('pending')
      expect(verbFormToStepState('executing')).toBe('running')
      expect(verbFormToStepState('executed')).toBe('completed')
      expect(verbFormToStepState('skipped')).toBe('skipped')
    })

    it('maps step states to verb forms', () => {
      expect(stepStateToVerbForms('pending')).toEqual(['execute'])
      expect(stepStateToVerbForms('running')).toEqual(['executing'])
      expect(stepStateToVerbForms('completed')).toEqual(['executed'])
      expect(stepStateToVerbForms('skipped')).toEqual(['skipped'])
    })
  })

  describe('Step Execution Lifecycle', () => {
    it('creates step execution in pending state', async () => {
      const execution = await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })

      expect(execution.verb).toBe('execute')
      expect(execution.from).toBe(instanceId)
      expect(execution.data?.stepName).toBe('step-1')
      expect(execution.data?.stepIndex).toBe(0)
    })

    it('starts step execution: pending -> running', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })

      const executing = await stepStore.startStepExecution(instanceId, 'step-1')

      expect(executing.verb).toBe('executing')
      expect(executing.data?.startedAt).toBeDefined()
    })

    it('completes step execution: running -> completed', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })
      await stepStore.startStepExecution(instanceId, 'step-1')

      const result = await stepStore.createStepResult(instanceId, 'step-1', { output: 'test' })

      const executed = await stepStore.completeStepExecution(instanceId, 'step-1', {
        resultTo: result.id,
        duration: 150,
      })

      expect(executed.verb).toBe('executed')
      expect(executed.to).toBe(result.id)
      expect(executed.data?.duration).toBe(150)
      expect(executed.data?.completedAt).toBeDefined()
    })

    it('fails step execution: running -> failed', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })
      await stepStore.startStepExecution(instanceId, 'step-1')

      const failed = await stepStore.failStepExecution(instanceId, 'step-1', {
        error: new Error('Step failed'),
        duration: 5000,
      })

      expect(failed.verb).toBe('executed')
      expect(failed.data?.error).toBe('Step failed')
      expect(failed.data?.duration).toBe(5000)
    })

    it('skips step execution', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-3',
        stepName: 'step-3',
        stepIndex: 2,
      })

      const skipped = await stepStore.skipStepExecution(instanceId, 'step-3')

      expect(skipped.verb).toBe('skipped')
      expect(skipped.data?.completedAt).toBeDefined()
    })
  })

  describe('Step State Queries', () => {
    it('gets step execution state', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })

      let state = await stepStore.getStepExecutionState(instanceId, 'step-1')
      expect(state).toBe('pending')

      await stepStore.startStepExecution(instanceId, 'step-1')
      state = await stepStore.getStepExecutionState(instanceId, 'step-1')
      expect(state).toBe('running')
    })

    it('returns failed state for executed with error', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })
      await stepStore.startStepExecution(instanceId, 'step-1')
      await stepStore.failStepExecution(instanceId, 'step-1', {
        error: new Error('Failed'),
        duration: 100,
      })

      const state = await stepStore.getStepExecutionState(instanceId, 'step-1')
      expect(state).toBe('failed')
    })

    it('queries steps by state', async () => {
      // Create steps in different states
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })
      await stepStore.startStepExecution(instanceId, 'step-1')
      const result = await stepStore.createStepResult(instanceId, 'step-1', {})
      await stepStore.completeStepExecution(instanceId, 'step-1', {
        resultTo: result.id,
        duration: 100,
      })

      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-2',
        stepName: 'step-2',
        stepIndex: 1,
      })
      await stepStore.startStepExecution(instanceId, 'step-2')

      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-3',
        stepName: 'step-3',
        stepIndex: 2,
      })

      // Query by state
      const completed = await stepStore.queryStepsByState('completed', { instanceId })
      const running = await stepStore.queryStepsByState('running', { instanceId })
      const pending = await stepStore.queryStepsByState('pending', { instanceId })

      expect(completed).toHaveLength(1)
      expect(running).toHaveLength(1)
      expect(pending).toHaveLength(1)
    })

    it('queries all steps for instance', async () => {
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-1',
        stepName: 'step-1',
        stepIndex: 0,
      })
      await stepStore.createStepExecution({
        instanceId,
        stepId: 'step:step-2',
        stepName: 'step-2',
        stepIndex: 1,
      })

      const allSteps = await stepStore.queryStepsByInstance(instanceId)

      expect(allSteps).toHaveLength(2)
      // Should be sorted by index
      expect(allSteps[0]!.data?.stepIndex).toBe(0)
      expect(allSteps[1]!.data?.stepIndex).toBe(1)
    })
  })

  describe('Step Results', () => {
    it('creates and retrieves step result', async () => {
      const result = await stepStore.createStepResult(instanceId, 'step-1', {
        processed: true,
        count: 42,
      })

      expect(result.id).toBeDefined()
      expect(result.data?.stepName).toBe('step-1')
      expect(result.data?.output).toEqual({ processed: true, count: 42 })

      const retrieved = await stepStore.getStepResult(instanceId, 'step-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.data?.output).toEqual({ processed: true, count: 42 })
    })
  })
})

// ============================================================================
// TEST SUITE: GraphWorkflowRuntime (WorkflowCore Bridge)
// ============================================================================

describe('GraphWorkflowRuntime', () => {
  let store: SQLiteGraphStore
  let templateId: string

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    const template = await createWorkflowTemplate(store, {
      name: 'runtime-test',
      version: '1.0.0',
    })
    templateId = template.id
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Runtime Lifecycle', () => {
    it('initializes a new workflow', async () => {
      const runtime = createGraphWorkflowRuntime(store)

      const instance = await runtime.initialize({
        templateId,
        input: { test: true },
      })

      expect(instance.id).toBeDefined()
      expect(instance.data?.templateId).toBe(templateId)

      const state = await runtime.getState()
      expect(state).toBe('pending')
    })

    it('loads an existing workflow', async () => {
      const instance = await createWorkflowInstance(store, {
        templateId,
        input: { loaded: true },
      })

      const runtime = createGraphWorkflowRuntime(store)
      const loaded = await runtime.load(instance.id)

      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe(instance.id)
    })

    it('runs through full lifecycle', async () => {
      const runtime = createGraphWorkflowRuntime(store)

      await runtime.initialize({ templateId, input: {} })

      let state = await runtime.getState()
      expect(state).toBe('pending')

      await runtime.start()
      state = await runtime.getState()
      expect(state).toBe('running')

      await runtime.complete({ result: 'done' })
      state = await runtime.getState()
      expect(state).toBe('completed')
    })

    it('handles pause and resume', async () => {
      const runtime = createGraphWorkflowRuntime(store)

      await runtime.initialize({ templateId, input: {} })
      await runtime.start()
      await runtime.pause()

      let state = await runtime.getState()
      expect(state).toBe('paused')

      await runtime.resume()
      state = await runtime.getState()
      expect(state).toBe('running')
    })
  })

  describe('Step Execution', () => {
    it('executes a step with caching', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      await runtime.initialize({ templateId, input: {} })
      await runtime.start()

      let callCount = 0
      const result1 = await runtime.executeStep('step-1', 0, async () => {
        callCount++
        return { processed: true }
      })

      expect(result1).toEqual({ processed: true })
      expect(callCount).toBe(1)

      // Second call should use cache
      const result2 = await runtime.executeStep('step-1', 0, async () => {
        callCount++
        return { different: 'value' }
      })

      expect(result2).toEqual({ processed: true }) // Same as first
      expect(callCount).toBe(1) // Not called again
    })

    it('tracks step completion', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      await runtime.initialize({ templateId, input: {} })
      await runtime.start()

      expect(await runtime.isStepCompleted('step-1')).toBe(false)

      await runtime.executeStep('step-1', 0, () => 'done')

      expect(await runtime.isStepCompleted('step-1')).toBe(true)
    })

    it('handles step errors', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      await runtime.initialize({ templateId, input: {} })
      await runtime.start()

      await expect(
        runtime.executeStep('failing-step', 0, () => {
          throw new Error('Step failed')
        })
      ).rejects.toThrow('Step failed')

      expect(await runtime.isStepCompleted('failing-step')).toBe(true)

      // Subsequent calls should also throw cached error
      await expect(
        runtime.executeStep('failing-step', 0, () => 'should not run')
      ).rejects.toThrow('Step failed')
    })

    it('skips steps', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      await runtime.initialize({ templateId, input: {} })
      await runtime.start()

      await runtime.skipStep('optional-step')

      expect(await runtime.isStepCompleted('optional-step')).toBe(true)
    })
  })

  describe('Checkpointing', () => {
    it('creates a checkpoint', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      const instance = await runtime.initialize({ templateId, input: { x: 1 } })
      await runtime.start()

      await runtime.executeStep('step-1', 0, () => 'result-1')
      await runtime.executeStep('step-2', 1, () => 'result-2')

      const checkpoint = await runtime.checkpoint()

      expect(checkpoint.instanceId).toBe(instance.id)
      expect(checkpoint.templateId).toBe(templateId)
      expect(checkpoint.stateVerb).toBe('starting')
      expect(checkpoint.completedSteps).toContain('step-1')
      expect(checkpoint.completedSteps).toContain('step-2')
      expect(checkpoint.input).toEqual({ x: 1 })
    })

    it('restores from a checkpoint', async () => {
      const runtime1 = createGraphWorkflowRuntime(store)
      const instance = await runtime1.initialize({ templateId, input: {} })
      await runtime1.start()
      await runtime1.executeStep('step-1', 0, () => 'saved-result')
      const checkpoint = await runtime1.checkpoint()

      // Create new runtime and restore
      const runtime2 = createGraphWorkflowRuntime(store)
      await runtime2.restore(checkpoint)

      // Step should be considered completed
      expect(await runtime2.isStepCompleted('step-1')).toBe(true)

      // State should be restored
      const state = await runtime2.getState()
      expect(state).toBe('running')
    })
  })

  describe('Step Result Retrieval', () => {
    it('retrieves step results', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      await runtime.initialize({ templateId, input: {} })
      await runtime.start()

      await runtime.executeStep('step-1', 0, () => ({ computed: 42 }))

      const result = await runtime.getStepResult<{ computed: number }>('step-1')
      expect(result).toEqual({ computed: 42 })
    })

    it('gets all step executions', async () => {
      const runtime = createGraphWorkflowRuntime(store)
      await runtime.initialize({ templateId, input: {} })
      await runtime.start()

      await runtime.executeStep('step-1', 0, () => 'a')
      await runtime.executeStep('step-2', 1, () => 'b')

      const executions = await runtime.getStepExecutions()
      expect(executions).toHaveLength(2)
    })
  })
})

// ============================================================================
// TEST SUITE: Integration Tests
// ============================================================================

describe('Integration: Complete Workflow Execution', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  it('executes a complete expense approval workflow', async () => {
    // 1. Create template with steps
    const builder = createWorkflowTemplateBuilder(store)
    const readyBuilder = await builder.createTemplate({
      name: 'expense-approval',
      version: '1.0.0',
    })
    const { template, steps } = await readyBuilder
      .addStep({ name: 'validate', type: 'action', index: 0 })
      .addStep({ name: 'route', type: 'action', index: 1 }, { follows: 'validate' })
      .addStep({ name: 'approve', type: 'human', index: 2 }, { follows: 'route' })
      .addStep({ name: 'process', type: 'action', index: 3 }, { follows: 'approve' })
      .build()

    // 2. Create and run instance
    const runtime = createGraphWorkflowRuntime(store)
    const instance = await runtime.initialize({
      templateId: template.id,
      input: { amount: 500, description: 'Office supplies' },
    })

    await runtime.start()

    // 3. Execute steps
    const validation = await runtime.executeStep('validate', 0, async () => {
      return { valid: true, amount: 500 }
    })
    expect(validation.valid).toBe(true)

    const routing = await runtime.executeStep('route', 1, async () => {
      return { managerId: 'manager-1' }
    })
    expect(routing.managerId).toBe('manager-1')

    const approval = await runtime.executeStep('approve', 2, async () => {
      return { approved: true, approvedBy: 'manager-1' }
    })
    expect(approval.approved).toBe(true)

    const processing = await runtime.executeStep('process', 3, async () => {
      return { processed: true, transactionId: 'tx-123' }
    })
    expect(processing.transactionId).toBe('tx-123')

    // 4. Complete workflow
    await runtime.complete({
      transactionId: 'tx-123',
      status: 'approved',
    })

    // 5. Verify final state
    const finalState = await getWorkflowInstanceState(store, instance.id)
    expect(finalState).toBe('completed')

    // 6. Verify step executions
    const executions = await runtime.getStepExecutions()
    expect(executions).toHaveLength(4)
    expect(executions.every(e => e.verb === 'executed')).toBe(true)
  })

  it('handles workflow failure gracefully', async () => {
    const template = await createWorkflowTemplate(store, {
      name: 'failing-workflow',
      version: '1.0.0',
    })

    const runtime = createGraphWorkflowRuntime(store)
    const instance = await runtime.initialize({
      templateId: template.id,
      input: {},
    })

    await runtime.start()

    // First step succeeds
    await runtime.executeStep('step-1', 0, () => 'ok')

    // Second step fails
    await expect(
      runtime.executeStep('step-2', 1, () => {
        throw new Error('External service unavailable')
      })
    ).rejects.toThrow('External service unavailable')

    // Fail the workflow
    await runtime.fail(new Error('Workflow failed due to step error'))

    // Verify state
    const finalState = await getWorkflowInstanceState(store, instance.id)
    expect(finalState).toBe('failed')

    const finalInstance = await getWorkflowInstance(store, instance.id)
    expect(finalInstance?.data?.error).toBe('Workflow failed due to step error')
  })

  it('supports pause/resume during execution', async () => {
    const template = await createWorkflowTemplate(store, {
      name: 'pausable-workflow',
      version: '1.0.0',
    })

    const runtime = createGraphWorkflowRuntime(store)
    await runtime.initialize({ templateId: template.id, input: {} })
    await runtime.start()

    // Execute first step
    await runtime.executeStep('step-1', 0, () => 'done')

    // Pause workflow (e.g., waiting for human approval)
    await runtime.pause()
    expect(await runtime.getState()).toBe('paused')

    // Simulate some time passing...

    // Resume and continue
    await runtime.resume()
    expect(await runtime.getState()).toBe('running')

    // Execute remaining steps
    await runtime.executeStep('step-2', 1, () => 'done')

    await runtime.complete({})
    expect(await runtime.getState()).toBe('completed')
  })
})
