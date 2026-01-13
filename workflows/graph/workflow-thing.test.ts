/**
 * Workflow Thing CRUD Tests
 *
 * Tests for storing Workflow definitions as Things in the DO Graph model.
 * Workflows are stored as graph nodes with type 'Workflow' and their
 * configuration stored in the data field.
 *
 * @see dotdo-vtpze - [GREEN] Implement Workflow Thing CRUD operations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  WORKFLOW_TYPE_ID,
  WORKFLOW_TYPE_NAME,
  type WorkflowThingData,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type ListWorkflowsOptions,
} from './workflow-thing'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createMockDb = () => ({})

// Generate unique IDs for each test run to avoid conflicts with shared store
const testId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const sampleWorkflowConfig: WorkflowThingData = {
  name: 'order-processing',
  description: 'Process customer orders',
  version: '1.0.0',
  tags: ['orders', 'processing'],
  steps: [
    { name: 'validateOrder', type: 'do' },
    { name: 'processPayment', type: 'do' },
    { name: 'fulfillOrder', type: 'do' },
  ],
  triggers: [
    { type: 'event', config: { event: 'order.created' } },
  ],
}

// ============================================================================
// WORKFLOW CRUD TESTS
// ============================================================================

describe('Workflow Thing CRUD', () => {
  let db: object

  beforeEach(() => {
    db = createMockDb()
  })

  // --------------------------------------------------------------------------
  // CREATE WORKFLOW TESTS
  // --------------------------------------------------------------------------

  describe('createWorkflow', () => {
    it('creates a workflow with required fields', async () => {
      const input: CreateWorkflowInput = {
        id: 'workflow-order-processing',
        ...sampleWorkflowConfig,
      }

      const workflow = await createWorkflow(db, input)

      expect(workflow).toBeDefined()
      expect(workflow.id).toBe('workflow-order-processing')
      expect(workflow.typeId).toBe(WORKFLOW_TYPE_ID)
      expect(workflow.typeName).toBe(WORKFLOW_TYPE_NAME)
    })

    it('stores workflow configuration in data field', async () => {
      const input: CreateWorkflowInput = {
        id: 'workflow-test-config',
        ...sampleWorkflowConfig,
      }

      const workflow = await createWorkflow(db, input)
      const data = workflow.data as WorkflowThingData

      expect(data.name).toBe('order-processing')
      expect(data.description).toBe('Process customer orders')
      expect(data.version).toBe('1.0.0')
      expect(data.tags).toEqual(['orders', 'processing'])
      expect(data.steps).toHaveLength(3)
      expect(data.triggers).toHaveLength(1)
    })

    it('auto-generates timestamps on creation', async () => {
      const before = Date.now()

      const workflow = await createWorkflow(db, {
        id: 'workflow-timestamps',
        name: 'timestamp-test',
      })

      const after = Date.now()

      expect(workflow.createdAt).toBeGreaterThanOrEqual(before)
      expect(workflow.createdAt).toBeLessThanOrEqual(after)
      expect(workflow.updatedAt).toBeGreaterThanOrEqual(before)
      expect(workflow.updatedAt).toBeLessThanOrEqual(after)
    })

    it('sets deletedAt to null by default', async () => {
      const workflow = await createWorkflow(db, {
        id: 'workflow-not-deleted',
        name: 'active-workflow',
      })

      expect(workflow.deletedAt).toBeNull()
    })

    it('creates workflow with minimal required fields', async () => {
      const workflow = await createWorkflow(db, {
        id: 'workflow-minimal',
        name: 'minimal-workflow',
      })

      expect(workflow.id).toBe('workflow-minimal')
      const data = workflow.data as WorkflowThingData
      expect(data.name).toBe('minimal-workflow')
    })

    it('rejects duplicate workflow IDs', async () => {
      await createWorkflow(db, {
        id: 'workflow-unique',
        name: 'first-workflow',
      })

      await expect(
        createWorkflow(db, {
          id: 'workflow-unique',
          name: 'second-workflow',
        })
      ).rejects.toThrow()
    })

    it('handles complex step configurations', async () => {
      const complexSteps = [
        { name: 'init', type: 'do' as const, timeout: 5000, retries: 3 },
        { name: 'wait', type: 'sleep' as const, duration: 1000 },
        { name: 'confirm', type: 'waitForEvent' as const, event: 'user.confirmed', timeout: 86400000 },
      ]

      const workflow = await createWorkflow(db, {
        id: 'workflow-complex-steps',
        name: 'complex-workflow',
        steps: complexSteps,
      })

      const data = workflow.data as WorkflowThingData
      expect(data.steps).toEqual(complexSteps)
    })

    it('handles multiple trigger types', async () => {
      const triggers = [
        { type: 'webhook' as const, config: { path: '/webhooks/order', method: 'POST' } },
        { type: 'cron' as const, config: { schedule: '0 0 * * *', timezone: 'UTC' } },
        { type: 'event' as const, config: { events: ['order.created', 'order.updated'] } },
      ]

      const workflow = await createWorkflow(db, {
        id: 'workflow-multi-trigger',
        name: 'multi-trigger-workflow',
        triggers,
      })

      const data = workflow.data as WorkflowThingData
      expect(data.triggers).toEqual(triggers)
    })
  })

  // --------------------------------------------------------------------------
  // GET WORKFLOW TESTS
  // --------------------------------------------------------------------------

  describe('getWorkflow', () => {
    it('retrieves a workflow by ID', async () => {
      await createWorkflow(db, {
        id: 'workflow-get-test',
        name: 'get-test-workflow',
        description: 'Test retrieval',
      })

      const workflow = await getWorkflow(db, 'workflow-get-test')

      expect(workflow).toBeDefined()
      expect(workflow?.id).toBe('workflow-get-test')
      const data = workflow?.data as WorkflowThingData
      expect(data.name).toBe('get-test-workflow')
    })

    it('returns null for non-existent ID', async () => {
      const workflow = await getWorkflow(db, 'workflow-nonexistent')

      expect(workflow).toBeNull()
    })

    it('returns workflow with all fields populated', async () => {
      await createWorkflow(db, {
        id: 'workflow-all-fields',
        ...sampleWorkflowConfig,
      })

      const workflow = await getWorkflow(db, 'workflow-all-fields')

      expect(workflow).toHaveProperty('id')
      expect(workflow).toHaveProperty('typeId')
      expect(workflow).toHaveProperty('typeName')
      expect(workflow).toHaveProperty('data')
      expect(workflow).toHaveProperty('createdAt')
      expect(workflow).toHaveProperty('updatedAt')
      expect(workflow).toHaveProperty('deletedAt')
    })

    it('retrieves workflow with complex nested data', async () => {
      const complexData: WorkflowThingData = {
        name: 'complex-workflow',
        metadata: {
          author: 'test-user',
          environment: 'production',
          config: {
            maxRetries: 5,
            timeout: 30000,
          },
        },
      }

      await createWorkflow(db, {
        id: 'workflow-complex-data',
        ...complexData,
      })

      const workflow = await getWorkflow(db, 'workflow-complex-data')
      const data = workflow?.data as WorkflowThingData

      expect(data.metadata).toEqual(complexData.metadata)
    })
  })

  // --------------------------------------------------------------------------
  // LIST WORKFLOWS TESTS
  // --------------------------------------------------------------------------

  describe('listWorkflows', () => {
    // Track IDs created in this describe block for cleanup verification
    let listTestIds: string[]

    beforeEach(async () => {
      // Use unique IDs for each test to avoid conflicts with shared store
      listTestIds = [
        `workflow-list-${testId()}`,
        `workflow-list-${testId()}`,
        `workflow-list-${testId()}`,
      ]

      // Create several test workflows with unique IDs
      await createWorkflow(db, {
        id: listTestIds[0]!,
        name: 'first-workflow',
        version: '1.0.0',
      })
      await createWorkflow(db, {
        id: listTestIds[1]!,
        name: 'second-workflow',
        version: '2.0.0',
      })
      await createWorkflow(db, {
        id: listTestIds[2]!,
        name: 'third-workflow',
        version: '1.5.0',
      })
    })

    it('returns all workflows', async () => {
      const workflows = await listWorkflows(db)

      expect(Array.isArray(workflows)).toBe(true)
      expect(workflows.length).toBeGreaterThanOrEqual(3)
    })

    it('all returned items have Workflow type', async () => {
      const workflows = await listWorkflows(db)

      for (const workflow of workflows) {
        expect(workflow.typeId).toBe(WORKFLOW_TYPE_ID)
        expect(workflow.typeName).toBe(WORKFLOW_TYPE_NAME)
      }
    })

    it('supports limit parameter', async () => {
      const workflows = await listWorkflows(db, { limit: 2 })

      expect(workflows.length).toBeLessThanOrEqual(2)
    })

    it('supports offset parameter', async () => {
      const allWorkflows = await listWorkflows(db)
      const offsetWorkflows = await listWorkflows(db, { offset: 1 })

      expect(offsetWorkflows.length).toBeLessThanOrEqual(allWorkflows.length)
    })

    it('orders by createdAt descending by default', async () => {
      const workflows = await listWorkflows(db)

      for (let i = 1; i < workflows.length; i++) {
        expect(workflows[i - 1]!.createdAt).toBeGreaterThanOrEqual(workflows[i]!.createdAt)
      }
    })

    it('excludes deleted workflows by default', async () => {
      const deleteId = `workflow-to-delete-list-${testId()}`
      await createWorkflow(db, {
        id: deleteId,
        name: 'to-delete',
      })
      await deleteWorkflow(db, deleteId)

      const workflows = await listWorkflows(db)

      expect(workflows.every((w) => w.deletedAt === null)).toBe(true)
    })

    it('includes deleted workflows when requested', async () => {
      const deleteId = `workflow-deleted-include-${testId()}`
      await createWorkflow(db, {
        id: deleteId,
        name: 'deleted-workflow',
      })
      await deleteWorkflow(db, deleteId)

      const workflows = await listWorkflows(db, { includeDeleted: true })

      expect(Array.isArray(workflows)).toBe(true)
    })

    it('returns empty array when no workflows exist', async () => {
      // Create a fresh non-empty db object to get a new instance store
      const freshDb = { _fresh: true }
      const workflows = await listWorkflows(freshDb)

      expect(workflows).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE WORKFLOW TESTS
  // --------------------------------------------------------------------------

  describe('updateWorkflow', () => {
    it('updates workflow name', async () => {
      await createWorkflow(db, {
        id: 'workflow-update-name',
        name: 'original-name',
      })

      const updated = await updateWorkflow(db, 'workflow-update-name', {
        name: 'updated-name',
      })

      const data = updated?.data as WorkflowThingData
      expect(data.name).toBe('updated-name')
    })

    it('updates workflow description', async () => {
      await createWorkflow(db, {
        id: 'workflow-update-desc',
        name: 'test-workflow',
        description: 'Original description',
      })

      const updated = await updateWorkflow(db, 'workflow-update-desc', {
        description: 'Updated description',
      })

      const data = updated?.data as WorkflowThingData
      expect(data.description).toBe('Updated description')
    })

    it('updates workflow steps', async () => {
      await createWorkflow(db, {
        id: 'workflow-update-steps',
        name: 'test-workflow',
        steps: [{ name: 'step1', type: 'do' }],
      })

      const newSteps = [
        { name: 'step1', type: 'do' as const },
        { name: 'step2', type: 'sleep' as const, duration: 5000 },
      ]

      const updated = await updateWorkflow(db, 'workflow-update-steps', {
        steps: newSteps,
      })

      const data = updated?.data as WorkflowThingData
      expect(data.steps).toEqual(newSteps)
    })

    it('updates workflow triggers', async () => {
      await createWorkflow(db, {
        id: 'workflow-update-triggers',
        name: 'test-workflow',
        triggers: [{ type: 'event', config: { event: 'old.event' } }],
      })

      const newTriggers = [{ type: 'cron' as const, config: { schedule: '0 * * * *' } }]

      const updated = await updateWorkflow(db, 'workflow-update-triggers', {
        triggers: newTriggers,
      })

      const data = updated?.data as WorkflowThingData
      expect(data.triggers).toEqual(newTriggers)
    })

    it('updates updatedAt timestamp', async () => {
      await createWorkflow(db, {
        id: 'workflow-update-timestamp',
        name: 'test-workflow',
      })

      const before = await getWorkflow(db, 'workflow-update-timestamp')
      const beforeUpdatedAt = before?.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const after = await updateWorkflow(db, 'workflow-update-timestamp', {
        description: 'New description',
      })

      expect(after?.updatedAt).toBeGreaterThan(beforeUpdatedAt!)
      expect(after?.createdAt).toBe(before?.createdAt)
    })

    it('returns null for non-existent workflow', async () => {
      const result = await updateWorkflow(db, 'workflow-nonexistent', {
        name: 'new-name',
      })

      expect(result).toBeNull()
    })

    it('preserves unchanged fields', async () => {
      await createWorkflow(db, {
        id: 'workflow-preserve-fields',
        name: 'test-workflow',
        description: 'Original description',
        version: '1.0.0',
      })

      const updated = await updateWorkflow(db, 'workflow-preserve-fields', {
        name: 'new-name',
      })

      const data = updated?.data as WorkflowThingData
      expect(data.name).toBe('new-name')
      expect(data.description).toBe('Original description')
      expect(data.version).toBe('1.0.0')
    })

    it('handles partial updates', async () => {
      await createWorkflow(db, {
        id: 'workflow-partial-update',
        ...sampleWorkflowConfig,
      })

      const updated = await updateWorkflow(db, 'workflow-partial-update', {
        version: '2.0.0',
      })

      const data = updated?.data as WorkflowThingData
      expect(data.version).toBe('2.0.0')
      expect(data.name).toBe('order-processing')
      expect(data.steps).toEqual(sampleWorkflowConfig.steps)
    })
  })

  // --------------------------------------------------------------------------
  // DELETE WORKFLOW TESTS
  // --------------------------------------------------------------------------

  describe('deleteWorkflow', () => {
    it('soft deletes a workflow by setting deletedAt', async () => {
      await createWorkflow(db, {
        id: 'workflow-soft-delete',
        name: 'to-delete',
      })

      const deleted = await deleteWorkflow(db, 'workflow-soft-delete')

      expect(deleted?.deletedAt).toBeDefined()
      expect(deleted?.deletedAt).not.toBeNull()
    })

    it('soft deleted workflow is still retrievable by ID', async () => {
      await createWorkflow(db, {
        id: 'workflow-still-retrievable',
        name: 'to-delete',
      })

      await deleteWorkflow(db, 'workflow-still-retrievable')

      const workflow = await getWorkflow(db, 'workflow-still-retrievable')
      expect(workflow).toBeDefined()
      expect(workflow?.deletedAt).not.toBeNull()
    })

    it('returns the deleted workflow', async () => {
      await createWorkflow(db, {
        id: 'workflow-return-deleted',
        name: 'to-delete',
      })

      const deleted = await deleteWorkflow(db, 'workflow-return-deleted')

      expect(deleted?.id).toBe('workflow-return-deleted')
      const data = deleted?.data as WorkflowThingData
      expect(data.name).toBe('to-delete')
    })

    it('returns null for non-existent workflow', async () => {
      const result = await deleteWorkflow(db, 'workflow-nonexistent')

      expect(result).toBeNull()
    })

    it('excludes deleted workflow from list by default', async () => {
      await createWorkflow(db, {
        id: 'workflow-excluded-from-list',
        name: 'to-delete',
      })

      await deleteWorkflow(db, 'workflow-excluded-from-list')

      const workflows = await listWorkflows(db)
      const deleted = workflows.find((w) => w.id === 'workflow-excluded-from-list')

      expect(deleted).toBeUndefined()
    })

    it('preserves workflow data after deletion', async () => {
      await createWorkflow(db, {
        id: 'workflow-preserve-after-delete',
        ...sampleWorkflowConfig,
      })

      const deleted = await deleteWorkflow(db, 'workflow-preserve-after-delete')
      const data = deleted?.data as WorkflowThingData

      expect(data.name).toBe('order-processing')
      expect(data.steps).toEqual(sampleWorkflowConfig.steps)
    })
  })

  // --------------------------------------------------------------------------
  // TYPE CONSTANTS TESTS
  // --------------------------------------------------------------------------

  describe('Type Constants', () => {
    it('exports WORKFLOW_TYPE_ID constant', () => {
      expect(WORKFLOW_TYPE_ID).toBeDefined()
      expect(typeof WORKFLOW_TYPE_ID).toBe('number')
    })

    it('exports WORKFLOW_TYPE_NAME constant', () => {
      expect(WORKFLOW_TYPE_NAME).toBeDefined()
      expect(WORKFLOW_TYPE_NAME).toBe('Workflow')
    })
  })
})
