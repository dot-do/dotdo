/**
 * Workflow Definition as Thing - Graph Schema Tests
 *
 * TDD RED Phase: Failing tests for storing Workflow definitions as Things
 * in the DO Graph model using real SQLite (NO MOCKS per CLAUDE.md).
 *
 * Workflows are first-class Things with:
 * - Type: 'Workflow' (typeId: 100, typeName: 'Workflow')
 * - Data: WorkflowConfig containing name, description, steps[], triggers[], version
 * - Timestamps: createdAt, updatedAt, deletedAt (soft delete)
 *
 * @see dotdo-1oy0j - [RED] Workflow definition as Thing - schema tests
 * @see db/graph/stores/sqlite.ts for SQLiteGraphStore implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import type { GraphThing } from '../../../db/graph/things'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Expected Workflow Thing schema.
 * Workflows are stored as Things with specific structure.
 */
interface WorkflowThingExpected {
  /** Unique identifier, e.g., 'workflow:expense-approval' */
  id: string
  /** Type ID for Workflow noun (expected: 100) */
  typeId: number
  /** Type name (expected: 'Workflow') */
  typeName: 'Workflow'
  /** Workflow configuration data */
  data: WorkflowConfigData | null
  /** Unix timestamp (ms) when created */
  createdAt: number
  /** Unix timestamp (ms) when last updated */
  updatedAt: number
  /** Unix timestamp (ms) when soft deleted, null if active */
  deletedAt: number | null
}

/**
 * Workflow configuration stored in the data field.
 */
interface WorkflowConfigData {
  /** Workflow name (required) */
  name: string
  /** Human-readable description */
  description?: string
  /** Semantic version string */
  version?: string
  /** Workflow step definitions */
  steps?: WorkflowStep[]
  /** Trigger definitions */
  triggers?: WorkflowTrigger[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Workflow step definition.
 */
interface WorkflowStep {
  /** Step name/identifier */
  name: string
  /** Step type: 'do' (durable action), 'sleep', 'waitForEvent' */
  type: 'do' | 'sleep' | 'waitForEvent'
  /** Timeout in milliseconds */
  timeout?: number
  /** Number of retry attempts */
  retries?: number
  /** Sleep duration for 'sleep' type */
  duration?: number
  /** Event name for 'waitForEvent' type */
  event?: string
  /** Handler function or reference */
  handler?: string
}

/**
 * Workflow trigger definition.
 */
interface WorkflowTrigger {
  /** Trigger type */
  type: 'event' | 'cron' | 'webhook' | 'manual'
  /** Trigger configuration */
  config: Record<string, unknown>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Workflow Things */
const WORKFLOW_TYPE_ID = 100

/** Type name for Workflow Things */
const WORKFLOW_TYPE_NAME = 'Workflow'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const expenseApprovalWorkflow: WorkflowConfigData = {
  name: 'expense-approval',
  description: 'Approve expense requests with manager review',
  version: '1.0.0',
  steps: [
    { name: 'validateExpense', type: 'do', timeout: 5000 },
    { name: 'routeToManager', type: 'do', timeout: 3000 },
    { name: 'waitForApproval', type: 'waitForEvent', event: 'expense.approved', timeout: 86400000 },
    { name: 'processPayment', type: 'do', timeout: 10000 },
  ],
  triggers: [
    { type: 'event', config: { event: 'expense.submitted' } },
    { type: 'webhook', config: { path: '/webhooks/expense', method: 'POST' } },
  ],
}

const orderProcessingWorkflow: WorkflowConfigData = {
  name: 'order-processing',
  description: 'Process customer orders from submission to fulfillment',
  version: '2.1.0',
  steps: [
    { name: 'validateOrder', type: 'do', retries: 3 },
    { name: 'chargePayment', type: 'do', timeout: 15000 },
    { name: 'notifyWarehouse', type: 'do' },
    { name: 'waitForShipment', type: 'waitForEvent', event: 'order.shipped' },
    { name: 'sendConfirmation', type: 'do' },
  ],
  triggers: [
    { type: 'event', config: { events: ['order.created', 'order.updated'] } },
  ],
}

const scheduledReportWorkflow: WorkflowConfigData = {
  name: 'scheduled-report',
  description: 'Generate and send daily reports',
  version: '1.0.0',
  steps: [
    { name: 'generateReport', type: 'do' },
    { name: 'sendEmail', type: 'do' },
  ],
  triggers: [
    { type: 'cron', config: { schedule: '0 9 * * *', timezone: 'UTC' } },
  ],
}

// ============================================================================
// TEST SUITE: Workflow Thing Schema Tests
// ============================================================================

describe('Workflow Thing Schema Tests (RED Phase)', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    // Create real SQLite store in memory - NO MOCKS
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // --------------------------------------------------------------------------
  // 1. Create a Workflow Thing with type='Workflow' and config data
  // --------------------------------------------------------------------------

  describe('1. Create Workflow Thing with type=Workflow and config data', () => {
    it('creates a Workflow Thing with correct type ID and name', async () => {
      const workflow = await store.createThing({
        id: 'workflow:expense-approval',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      expect(workflow).toBeDefined()
      expect(workflow.id).toBe('workflow:expense-approval')
      expect(workflow.typeId).toBe(WORKFLOW_TYPE_ID)
      expect(workflow.typeName).toBe(WORKFLOW_TYPE_NAME)
    })

    it('stores workflow configuration in data field', async () => {
      const workflow = await store.createThing({
        id: 'workflow:expense-approval',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      const data = workflow.data as WorkflowConfigData
      expect(data).toBeDefined()
      expect(data.name).toBe('expense-approval')
      expect(data.description).toBe('Approve expense requests with manager review')
      expect(data.version).toBe('1.0.0')
    })

    it('persists workflow steps array correctly', async () => {
      const workflow = await store.createThing({
        id: 'workflow:expense-approval',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.steps).toBeDefined()
      expect(Array.isArray(data.steps)).toBe(true)
      expect(data.steps).toHaveLength(4)
      expect(data.steps![0]).toEqual({ name: 'validateExpense', type: 'do', timeout: 5000 })
      expect(data.steps![2]).toEqual({
        name: 'waitForApproval',
        type: 'waitForEvent',
        event: 'expense.approved',
        timeout: 86400000,
      })
    })

    it('persists workflow triggers array correctly', async () => {
      const workflow = await store.createThing({
        id: 'workflow:expense-approval',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.triggers).toBeDefined()
      expect(Array.isArray(data.triggers)).toBe(true)
      expect(data.triggers).toHaveLength(2)
      expect(data.triggers![0]).toEqual({ type: 'event', config: { event: 'expense.submitted' } })
      expect(data.triggers![1]).toEqual({
        type: 'webhook',
        config: { path: '/webhooks/expense', method: 'POST' },
      })
    })

    it('retrieves created Workflow Thing by ID', async () => {
      await store.createThing({
        id: 'workflow:expense-approval',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      const retrieved = await store.getThing('workflow:expense-approval')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('workflow:expense-approval')
      expect(retrieved!.typeId).toBe(WORKFLOW_TYPE_ID)
      expect(retrieved!.typeName).toBe(WORKFLOW_TYPE_NAME)

      const data = retrieved!.data as WorkflowConfigData
      expect(data.name).toBe('expense-approval')
      expect(data.steps).toHaveLength(4)
      expect(data.triggers).toHaveLength(2)
    })

    it('rejects duplicate Workflow IDs', async () => {
      await store.createThing({
        id: 'workflow:unique-id',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'first-workflow' },
      })

      await expect(
        store.createThing({
          id: 'workflow:unique-id',
          typeId: WORKFLOW_TYPE_ID,
          typeName: WORKFLOW_TYPE_NAME,
          data: { name: 'second-workflow' },
        })
      ).rejects.toThrow()
    })

    it('creates Workflow with minimal required fields', async () => {
      const workflow = await store.createThing({
        id: 'workflow:minimal',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'minimal-workflow' },
      })

      expect(workflow.id).toBe('workflow:minimal')
      const data = workflow.data as WorkflowConfigData
      expect(data.name).toBe('minimal-workflow')
      expect(data.description).toBeUndefined()
      expect(data.steps).toBeUndefined()
      expect(data.triggers).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // 2. Query Workflows by type
  // --------------------------------------------------------------------------

  describe('2. Query Workflows by type', () => {
    beforeEach(async () => {
      // Create multiple workflows
      await store.createThing({
        id: 'workflow:expense-approval',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })
      await store.createThing({
        id: 'workflow:order-processing',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: orderProcessingWorkflow,
      })
      await store.createThing({
        id: 'workflow:scheduled-report',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: scheduledReportWorkflow,
      })

      // Create a non-Workflow thing to ensure type filtering works
      await store.createThing({
        id: 'customer:alice',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice' },
      })
    })

    it('queries all Workflows by typeId', async () => {
      const workflows = await store.getThingsByType({ typeId: WORKFLOW_TYPE_ID })

      expect(workflows).toHaveLength(3)
      expect(workflows.every((w) => w.typeId === WORKFLOW_TYPE_ID)).toBe(true)
    })

    it('queries all Workflows by typeName', async () => {
      const workflows = await store.getThingsByType({ typeName: WORKFLOW_TYPE_NAME })

      expect(workflows).toHaveLength(3)
      expect(workflows.every((w) => w.typeName === WORKFLOW_TYPE_NAME)).toBe(true)
    })

    it('excludes non-Workflow Things from query', async () => {
      const workflows = await store.getThingsByType({ typeId: WORKFLOW_TYPE_ID })

      const customerIds = workflows.filter((w) => w.id.startsWith('customer:'))
      expect(customerIds).toHaveLength(0)
    })

    it('supports limit parameter for workflow queries', async () => {
      const workflows = await store.getThingsByType({
        typeId: WORKFLOW_TYPE_ID,
        limit: 2,
      })

      expect(workflows.length).toBeLessThanOrEqual(2)
    })

    it('supports offset parameter for workflow queries', async () => {
      const allWorkflows = await store.getThingsByType({ typeId: WORKFLOW_TYPE_ID })
      const offsetWorkflows = await store.getThingsByType({
        typeId: WORKFLOW_TYPE_ID,
        offset: 1,
      })

      expect(offsetWorkflows.length).toBe(allWorkflows.length - 1)
    })

    it('orders workflows by createdAt descending by default', async () => {
      const workflows = await store.getThingsByType({ typeId: WORKFLOW_TYPE_ID })

      for (let i = 1; i < workflows.length; i++) {
        expect(workflows[i - 1]!.createdAt).toBeGreaterThanOrEqual(workflows[i]!.createdAt)
      }
    })

    it('returns empty array when no Workflows exist', async () => {
      // Create a fresh store with no workflows
      const freshStore = new SQLiteGraphStore(':memory:')
      await freshStore.initialize()

      const workflows = await freshStore.getThingsByType({ typeId: WORKFLOW_TYPE_ID })

      expect(workflows).toEqual([])

      await freshStore.close()
    })
  })

  // --------------------------------------------------------------------------
  // 3. Workflow Thing has expected fields
  // --------------------------------------------------------------------------

  describe('3. Workflow Thing has expected fields: name, description, steps[], triggers[], version', () => {
    it('stores and retrieves name field', async () => {
      const workflow = await store.createThing({
        id: 'workflow:test-name',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'test-workflow-name' },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.name).toBe('test-workflow-name')

      // Verify persistence
      const retrieved = await store.getThing('workflow:test-name')
      const retrievedData = retrieved!.data as WorkflowConfigData
      expect(retrievedData.name).toBe('test-workflow-name')
    })

    it('stores and retrieves description field', async () => {
      const workflow = await store.createThing({
        id: 'workflow:test-desc',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: {
          name: 'test-workflow',
          description: 'A detailed description of the workflow purpose and behavior',
        },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.description).toBe('A detailed description of the workflow purpose and behavior')
    })

    it('stores and retrieves steps[] array with all step properties', async () => {
      const complexSteps: WorkflowStep[] = [
        { name: 'step1', type: 'do', timeout: 5000, retries: 3, handler: 'validateInput' },
        { name: 'step2', type: 'sleep', duration: 10000 },
        { name: 'step3', type: 'waitForEvent', event: 'user.confirmed', timeout: 3600000 },
        { name: 'step4', type: 'do' },
      ]

      const workflow = await store.createThing({
        id: 'workflow:test-steps',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'steps-test', steps: complexSteps },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.steps).toHaveLength(4)
      expect(data.steps![0]).toEqual({
        name: 'step1',
        type: 'do',
        timeout: 5000,
        retries: 3,
        handler: 'validateInput',
      })
      expect(data.steps![1]).toEqual({ name: 'step2', type: 'sleep', duration: 10000 })
      expect(data.steps![2]).toEqual({
        name: 'step3',
        type: 'waitForEvent',
        event: 'user.confirmed',
        timeout: 3600000,
      })
    })

    it('stores and retrieves triggers[] array with all trigger types', async () => {
      const triggers: WorkflowTrigger[] = [
        { type: 'event', config: { event: 'order.created', filter: { status: 'pending' } } },
        { type: 'cron', config: { schedule: '0 0 * * *', timezone: 'America/New_York' } },
        { type: 'webhook', config: { path: '/api/trigger', method: 'POST', auth: 'bearer' } },
        { type: 'manual', config: { requiredRole: 'admin' } },
      ]

      const workflow = await store.createThing({
        id: 'workflow:test-triggers',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'triggers-test', triggers },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.triggers).toHaveLength(4)
      expect(data.triggers![0]!.type).toBe('event')
      expect(data.triggers![1]!.type).toBe('cron')
      expect(data.triggers![2]!.type).toBe('webhook')
      expect(data.triggers![3]!.type).toBe('manual')
    })

    it('stores and retrieves version field', async () => {
      const workflow = await store.createThing({
        id: 'workflow:test-version',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'versioned-workflow', version: '2.3.1' },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.version).toBe('2.3.1')
    })

    it('stores all expected fields together', async () => {
      const workflow = await store.createThing({
        id: 'workflow:complete',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      const data = workflow.data as WorkflowConfigData

      // Verify all expected fields are present
      expect(data.name).toBe('expense-approval')
      expect(data.description).toBe('Approve expense requests with manager review')
      expect(data.version).toBe('1.0.0')
      expect(Array.isArray(data.steps)).toBe(true)
      expect(data.steps!.length).toBeGreaterThan(0)
      expect(Array.isArray(data.triggers)).toBe(true)
      expect(data.triggers!.length).toBeGreaterThan(0)
    })

    it('handles optional metadata field', async () => {
      const workflowWithMetadata: WorkflowConfigData = {
        name: 'metadata-test',
        version: '1.0.0',
        metadata: {
          author: 'system',
          environment: 'production',
          tags: ['critical', 'finance'],
          config: { maxRetries: 5, alertOnFailure: true },
        },
      }

      const workflow = await store.createThing({
        id: 'workflow:metadata-test',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: workflowWithMetadata,
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.metadata).toBeDefined()
      expect(data.metadata!.author).toBe('system')
      expect(data.metadata!.tags).toEqual(['critical', 'finance'])
    })
  })

  // --------------------------------------------------------------------------
  // 4. Workflow Thing can be soft-deleted
  // --------------------------------------------------------------------------

  describe('4. Workflow Thing can be soft-deleted', () => {
    it('soft deletes a Workflow by setting deletedAt timestamp', async () => {
      await store.createThing({
        id: 'workflow:to-delete',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'delete-me' },
      })

      const deleted = await store.deleteThing('workflow:to-delete')

      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()
      expect(typeof deleted!.deletedAt).toBe('number')
    })

    it('soft deleted Workflow is still retrievable by ID', async () => {
      await store.createThing({
        id: 'workflow:soft-deleted',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'soft-deleted-workflow' },
      })

      await store.deleteThing('workflow:soft-deleted')

      const retrieved = await store.getThing('workflow:soft-deleted')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('workflow:soft-deleted')
      expect(retrieved!.deletedAt).not.toBeNull()
    })

    it('soft deleted Workflow preserves all data', async () => {
      await store.createThing({
        id: 'workflow:preserve-data',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: expenseApprovalWorkflow,
      })

      const deleted = await store.deleteThing('workflow:preserve-data')

      const data = deleted!.data as WorkflowConfigData
      expect(data.name).toBe('expense-approval')
      expect(data.description).toBe('Approve expense requests with manager review')
      expect(data.steps).toHaveLength(4)
      expect(data.triggers).toHaveLength(2)
    })

    it('excludes soft deleted Workflows from type queries by default', async () => {
      await store.createThing({
        id: 'workflow:active',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'active-workflow' },
      })
      await store.createThing({
        id: 'workflow:deleted',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'deleted-workflow' },
      })

      await store.deleteThing('workflow:deleted')

      const workflows = await store.getThingsByType({ typeId: WORKFLOW_TYPE_ID })

      expect(workflows).toHaveLength(1)
      expect(workflows[0]!.id).toBe('workflow:active')
    })

    it('includes soft deleted Workflows when includeDeleted is true', async () => {
      await store.createThing({
        id: 'workflow:active-2',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'active-workflow' },
      })
      await store.createThing({
        id: 'workflow:deleted-2',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'deleted-workflow' },
      })

      await store.deleteThing('workflow:deleted-2')

      const workflows = await store.getThingsByType({
        typeId: WORKFLOW_TYPE_ID,
        includeDeleted: true,
      })

      expect(workflows).toHaveLength(2)
      const deletedWorkflow = workflows.find((w) => w.id === 'workflow:deleted-2')
      expect(deletedWorkflow).toBeDefined()
      expect(deletedWorkflow!.deletedAt).not.toBeNull()
    })

    it('returns null when deleting non-existent Workflow', async () => {
      const result = await store.deleteThing('workflow:non-existent')

      expect(result).toBeNull()
    })

    it('deletedAt is null for active Workflows', async () => {
      const workflow = await store.createThing({
        id: 'workflow:active-check',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'active-workflow' },
      })

      expect(workflow.deletedAt).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // 5. Workflow Thing has createdAt/updatedAt timestamps
  // --------------------------------------------------------------------------

  describe('5. Workflow Thing has createdAt/updatedAt timestamps', () => {
    it('auto-generates createdAt timestamp on creation', async () => {
      const before = Date.now()

      const workflow = await store.createThing({
        id: 'workflow:timestamp-create',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'timestamp-test' },
      })

      const after = Date.now()

      expect(workflow.createdAt).toBeGreaterThanOrEqual(before)
      expect(workflow.createdAt).toBeLessThanOrEqual(after)
    })

    it('auto-generates updatedAt timestamp on creation', async () => {
      const before = Date.now()

      const workflow = await store.createThing({
        id: 'workflow:timestamp-updated',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'timestamp-test' },
      })

      const after = Date.now()

      expect(workflow.updatedAt).toBeGreaterThanOrEqual(before)
      expect(workflow.updatedAt).toBeLessThanOrEqual(after)
    })

    it('createdAt equals updatedAt on initial creation', async () => {
      const workflow = await store.createThing({
        id: 'workflow:timestamp-equal',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'timestamp-test' },
      })

      expect(workflow.createdAt).toBe(workflow.updatedAt)
    })

    it('updates updatedAt timestamp on update', async () => {
      await store.createThing({
        id: 'workflow:timestamp-update-check',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'original-name', version: '1.0.0' },
      })

      const original = await store.getThing('workflow:timestamp-update-check')
      const originalUpdatedAt = original!.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await store.updateThing('workflow:timestamp-update-check', {
        data: { name: 'updated-name', version: '2.0.0' },
      })

      expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('preserves createdAt timestamp on update', async () => {
      await store.createThing({
        id: 'workflow:timestamp-preserve',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'original-name' },
      })

      const original = await store.getThing('workflow:timestamp-preserve')
      const originalCreatedAt = original!.createdAt

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await store.updateThing('workflow:timestamp-preserve', {
        data: { name: 'updated-name' },
      })

      expect(updated!.createdAt).toBe(originalCreatedAt)
    })

    it('timestamps are Unix milliseconds (not seconds)', async () => {
      const workflow = await store.createThing({
        id: 'workflow:timestamp-format',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'timestamp-format-test' },
      })

      // Unix milliseconds should be in the billions (e.g., 1700000000000)
      // Unix seconds would be in the 1.7 billions (e.g., 1700000000)
      expect(workflow.createdAt).toBeGreaterThan(1000000000000)
      expect(workflow.updatedAt).toBeGreaterThan(1000000000000)
    })

    it('timestamps persist across retrieval', async () => {
      const workflow = await store.createThing({
        id: 'workflow:timestamp-persist',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'timestamp-persist-test' },
      })

      const retrieved = await store.getThing('workflow:timestamp-persist')

      expect(retrieved!.createdAt).toBe(workflow.createdAt)
      expect(retrieved!.updatedAt).toBe(workflow.updatedAt)
    })
  })

  // --------------------------------------------------------------------------
  // Additional Schema Validation Tests
  // --------------------------------------------------------------------------

  describe('Additional Schema Validation', () => {
    it('handles empty steps array', async () => {
      const workflow = await store.createThing({
        id: 'workflow:empty-steps',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'empty-steps', steps: [] },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.steps).toEqual([])
    })

    it('handles empty triggers array', async () => {
      const workflow = await store.createThing({
        id: 'workflow:empty-triggers',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'empty-triggers', triggers: [] },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.triggers).toEqual([])
    })

    it('handles deeply nested config in triggers', async () => {
      const workflow = await store.createThing({
        id: 'workflow:nested-config',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: {
          name: 'nested-config',
          triggers: [
            {
              type: 'event',
              config: {
                filter: {
                  and: [
                    { field: 'status', operator: 'eq', value: 'active' },
                    { field: 'priority', operator: 'gt', value: 5 },
                  ],
                },
                transform: {
                  mapping: { 'source.id': 'target.entityId' },
                },
              },
            },
          ],
        },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.triggers![0]!.config.filter).toBeDefined()
      expect(data.triggers![0]!.config.transform).toBeDefined()
    })

    it('handles special characters in workflow name', async () => {
      const workflow = await store.createThing({
        id: 'workflow:special-chars',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: "workflow-with-special_chars.and'quotes" },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.name).toBe("workflow-with-special_chars.and'quotes")
    })

    it('handles Unicode in description', async () => {
      const workflow = await store.createThing({
        id: 'workflow:unicode',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: {
          name: 'unicode-workflow',
          description: 'Workflow for international orders in several languages',
        },
      })

      const data = workflow.data as WorkflowConfigData
      expect(data.description).toBe('Workflow for international orders in several languages')
    })

    it('uses workflow: ID prefix convention', async () => {
      const workflow = await store.createThing({
        id: 'workflow:expense-approval-v2',
        typeId: WORKFLOW_TYPE_ID,
        typeName: WORKFLOW_TYPE_NAME,
        data: { name: 'expense-approval' },
      })

      expect(workflow.id).toMatch(/^workflow:/)
    })
  })

  // --------------------------------------------------------------------------
  // RED PHASE: Tests for WorkflowThingStore API (not yet implemented)
  // These tests define the expected specialized Workflow API
  // --------------------------------------------------------------------------

  describe('RED: WorkflowThingStore Specialized API', () => {
    /**
     * These tests are expected to FAIL until WorkflowThingStore is implemented.
     * They define the specialized API for workflow-specific operations.
     */

    it('should export WorkflowThingStore class', async () => {
      // This test will fail until WorkflowThingStore is implemented
      const workflowModule = await import('../workflow-thing-store').catch(() => null)

      expect(workflowModule).not.toBeNull()
      expect(workflowModule?.WorkflowThingStore).toBeDefined()
    })

    it('WorkflowThingStore.create() validates required name field', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented - waiting for workflows/graph/workflow-thing-store.ts')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Should throw when name is missing
      await expect(
        workflowStore.create({
          id: 'workflow:no-name',
          // name is required but missing
          description: 'Workflow without name',
        })
      ).rejects.toThrow(/name.*required/i)
    })

    it('WorkflowThingStore.create() validates steps array structure', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Should throw when step is missing required 'name' field
      await expect(
        workflowStore.create({
          id: 'workflow:invalid-steps',
          name: 'invalid-steps',
          steps: [
            { type: 'do' }, // missing 'name'
          ],
        })
      ).rejects.toThrow(/step.*name.*required/i)
    })

    it('WorkflowThingStore.create() validates step type values', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Should throw when step has invalid type
      await expect(
        workflowStore.create({
          id: 'workflow:invalid-step-type',
          name: 'invalid-step-type',
          steps: [
            { name: 'step1', type: 'invalid' as 'do' }, // invalid type
          ],
        })
      ).rejects.toThrow(/step.*type.*must be/i)
    })

    it('WorkflowThingStore.create() validates trigger type values', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Should throw when trigger has invalid type
      await expect(
        workflowStore.create({
          id: 'workflow:invalid-trigger',
          name: 'invalid-trigger',
          triggers: [
            { type: 'invalid' as 'event', config: {} }, // invalid type
          ],
        })
      ).rejects.toThrow(/trigger.*type.*must be/i)
    })

    it('WorkflowThingStore.getByName() finds workflow by name field', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create a workflow first
      await workflowStore.create({
        id: 'workflow:find-by-name',
        name: 'unique-workflow-name',
      })

      // Find by name
      const found = await workflowStore.getByName('unique-workflow-name')

      expect(found).not.toBeNull()
      expect(found?.id).toBe('workflow:find-by-name')
    })

    it('WorkflowThingStore.listByTriggerType() finds workflows with specific trigger', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create workflows with different triggers
      await workflowStore.create({
        id: 'workflow:cron-trigger',
        name: 'cron-workflow',
        triggers: [{ type: 'cron', config: { schedule: '0 * * * *' } }],
      })

      await workflowStore.create({
        id: 'workflow:event-trigger',
        name: 'event-workflow',
        triggers: [{ type: 'event', config: { event: 'order.created' } }],
      })

      // Find workflows with cron triggers
      const cronWorkflows = await workflowStore.listByTriggerType('cron')

      expect(cronWorkflows).toHaveLength(1)
      expect(cronWorkflows[0]?.id).toBe('workflow:cron-trigger')
    })

    it('WorkflowThingStore.validate() returns validation errors', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      const validationResult = await workflowStore.validate({
        name: '', // empty name should fail
        steps: [
          { name: '', type: 'do' }, // empty step name should fail
        ],
      })

      expect(validationResult.valid).toBe(false)
      // Check that at least one error contains the pattern (toContain with stringMatching doesn't work in Vitest)
      expect(validationResult.errors.some(e => /name.*required/i.test(e))).toBe(true)
    })

    it('WorkflowThingStore.clone() creates a copy with new ID', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create original workflow
      await workflowStore.create({
        id: 'workflow:original',
        name: 'original-workflow',
        version: '1.0.0',
        steps: [{ name: 'step1', type: 'do' }],
      })

      // Clone it
      const cloned = await workflowStore.clone('workflow:original', 'workflow:cloned')

      expect(cloned.id).toBe('workflow:cloned')
      expect((cloned.data as WorkflowConfigData).name).toBe('original-workflow')
      expect((cloned.data as WorkflowConfigData).steps).toHaveLength(1)
    })

    it('WorkflowThingStore.bumpVersion() increments version string', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      await workflowStore.create({
        id: 'workflow:versioned',
        name: 'versioned-workflow',
        version: '1.2.3',
      })

      const bumped = await workflowStore.bumpVersion('workflow:versioned', 'minor')

      expect((bumped.data as WorkflowConfigData).version).toBe('1.3.0')
    })
  })

  // --------------------------------------------------------------------------
  // RED PHASE: Tests for Workflow Noun registration
  // --------------------------------------------------------------------------

  describe('RED: Workflow Noun Registration', () => {
    it('should have Workflow registered as a Noun with rowid=100', async () => {
      // This test will fail until Workflow Noun is properly registered
      // The Noun table should have an entry for Workflow with rowid=100

      const nounModule = await import('../../../db/graph/nouns').catch(() => null)
      if (!nounModule) {
        throw new Error('Noun module not implemented - waiting for db/graph/nouns.ts')
      }

      const workflowNoun = await nounModule.getNoun(store, 'Workflow')

      expect(workflowNoun).not.toBeNull()
      expect(workflowNoun?.rowid).toBe(WORKFLOW_TYPE_ID) // 100
      expect(workflowNoun?.name).toBe('Workflow')
    })

    it('should enforce typeId foreign key constraint', async () => {
      // This test verifies that typeId must reference a valid Noun
      // Will fail until FK constraints are implemented

      await expect(
        store.createThing({
          id: 'workflow:invalid-type',
          typeId: 99999, // Non-existent type
          typeName: 'NonExistentType',
          data: { name: 'invalid' },
        })
      ).rejects.toThrow(/foreign key/i)
    })
  })

  // --------------------------------------------------------------------------
  // RED PHASE: Tests for Workflow Relationships to Functions and Triggers
  // These tests define the expected API for linking Workflows to other Things
  // --------------------------------------------------------------------------

  describe('RED: Workflow Relationships to Functions and Triggers', () => {
    /**
     * Workflow definitions can reference Functions (handlers for steps)
     * and be linked to Trigger Things for event-driven invocation.
     *
     * These tests define the expected relationship API that will be
     * implemented in the GREEN phase.
     */

    // Function relationship type ID
    const FUNCTION_TYPE_ID = 101
    const FUNCTION_TYPE_NAME = 'GenerativeFunction'

    // Trigger relationship type ID (Schedule)
    const SCHEDULE_TYPE_ID = 401
    const SCHEDULE_TYPE_NAME = 'Schedule'

    it('WorkflowThingStore.linkFunction() creates relationship to a Function Thing', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create a workflow
      await workflowStore.create({
        id: 'workflow:with-function',
        name: 'with-function',
        steps: [{ name: 'process', type: 'do', handler: 'function:process-handler' }],
      })

      // Create a function Thing
      await store.createThing({
        id: 'function:process-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'processHandler', code: 'async (ctx) => { return ctx.input }' },
      })

      // Link workflow step to function - this method should exist
      if (typeof workflowStore.linkFunction !== 'function') {
        throw new Error('WorkflowThingStore.linkFunction() not implemented - waiting for relationship API')
      }

      await workflowStore.linkFunction('workflow:with-function', 'process', 'function:process-handler')

      // Verify relationship was created
      const functions = await workflowStore.getLinkedFunctions('workflow:with-function')

      expect(functions).toHaveLength(1)
      expect(functions[0]!.id).toBe('function:process-handler')
    })

    it('WorkflowThingStore.getLinkedFunctions() returns all linked Function Things', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create a workflow with multiple steps
      await workflowStore.create({
        id: 'workflow:multi-function',
        name: 'multi-function',
        steps: [
          { name: 'validate', type: 'do', handler: 'function:validate-handler' },
          { name: 'transform', type: 'do', handler: 'function:transform-handler' },
          { name: 'persist', type: 'do', handler: 'function:persist-handler' },
        ],
      })

      // Create function Things
      await store.createThing({
        id: 'function:validate-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'validateHandler' },
      })
      await store.createThing({
        id: 'function:transform-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'transformHandler' },
      })
      await store.createThing({
        id: 'function:persist-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'persistHandler' },
      })

      // Link functions to workflow steps
      if (typeof workflowStore.linkFunction !== 'function') {
        throw new Error('WorkflowThingStore.linkFunction() not implemented')
      }

      await workflowStore.linkFunction('workflow:multi-function', 'validate', 'function:validate-handler')
      await workflowStore.linkFunction('workflow:multi-function', 'transform', 'function:transform-handler')
      await workflowStore.linkFunction('workflow:multi-function', 'persist', 'function:persist-handler')

      // Get all linked functions
      const functions = await workflowStore.getLinkedFunctions('workflow:multi-function')

      expect(functions).toHaveLength(3)
      expect(functions.map((f) => f.id)).toContain('function:validate-handler')
      expect(functions.map((f) => f.id)).toContain('function:transform-handler')
      expect(functions.map((f) => f.id)).toContain('function:persist-handler')
    })

    it('WorkflowThingStore.linkTrigger() creates relationship to a Schedule Thing', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create a workflow
      await workflowStore.create({
        id: 'workflow:scheduled',
        name: 'scheduled-workflow',
        triggers: [{ type: 'cron', config: { schedule: '0 9 * * *' } }],
      })

      // Create a schedule Thing
      await store.createThing({
        id: 'schedule:daily-9am',
        typeId: SCHEDULE_TYPE_ID,
        typeName: SCHEDULE_TYPE_NAME,
        data: { cron: '0 9 * * *', timezone: 'UTC', enabled: true },
      })

      // Link workflow to schedule trigger
      if (typeof workflowStore.linkTrigger !== 'function') {
        throw new Error('WorkflowThingStore.linkTrigger() not implemented - waiting for relationship API')
      }

      await workflowStore.linkTrigger('workflow:scheduled', 'schedule:daily-9am')

      // Verify relationship was created
      const triggers = await workflowStore.getLinkedTriggers('workflow:scheduled')

      expect(triggers).toHaveLength(1)
      expect(triggers[0]!.id).toBe('schedule:daily-9am')
    })

    it('WorkflowThingStore.getLinkedTriggers() returns all linked Trigger Things', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create a workflow with multiple triggers
      await workflowStore.create({
        id: 'workflow:multi-trigger',
        name: 'multi-trigger',
        triggers: [
          { type: 'cron', config: { schedule: '0 9 * * *' } },
          { type: 'event', config: { event: 'order.created' } },
        ],
      })

      // Create trigger Things (both use Schedule type for simplicity in testing)
      await store.createThing({
        id: 'schedule:morning',
        typeId: SCHEDULE_TYPE_ID,
        typeName: SCHEDULE_TYPE_NAME,
        data: { cron: '0 9 * * *' },
      })
      await store.createThing({
        id: 'trigger:order-created',
        typeId: SCHEDULE_TYPE_ID, // Using Schedule type for event-based trigger
        typeName: SCHEDULE_TYPE_NAME,
        data: { event: 'order.created', triggerType: 'event' },
      })

      // Link triggers to workflow
      if (typeof workflowStore.linkTrigger !== 'function') {
        throw new Error('WorkflowThingStore.linkTrigger() not implemented')
      }

      await workflowStore.linkTrigger('workflow:multi-trigger', 'schedule:morning')
      await workflowStore.linkTrigger('workflow:multi-trigger', 'trigger:order-created')

      // Get all linked triggers
      const triggers = await workflowStore.getLinkedTriggers('workflow:multi-trigger')

      expect(triggers).toHaveLength(2)
    })

    it('WorkflowThingStore.unlinkFunction() removes function relationship', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create workflow and function
      await workflowStore.create({
        id: 'workflow:unlink-function',
        name: 'unlink-function',
        steps: [{ name: 'process', type: 'do' }],
      })
      await store.createThing({
        id: 'function:to-unlink',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'toUnlink' },
      })

      if (typeof workflowStore.linkFunction !== 'function' || typeof workflowStore.unlinkFunction !== 'function') {
        throw new Error('WorkflowThingStore.unlinkFunction() not implemented')
      }

      // Link and then unlink
      await workflowStore.linkFunction('workflow:unlink-function', 'process', 'function:to-unlink')
      await workflowStore.unlinkFunction('workflow:unlink-function', 'process', 'function:to-unlink')

      // Verify function is no longer linked
      const functions = await workflowStore.getLinkedFunctions('workflow:unlink-function')
      expect(functions).toHaveLength(0)
    })

    it('WorkflowThingStore.unlinkTrigger() removes trigger relationship', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create workflow and trigger
      await workflowStore.create({
        id: 'workflow:unlink-trigger',
        name: 'unlink-trigger',
        triggers: [{ type: 'cron', config: { schedule: '0 * * * *' } }],
      })
      await store.createThing({
        id: 'schedule:to-unlink',
        typeId: SCHEDULE_TYPE_ID,
        typeName: SCHEDULE_TYPE_NAME,
        data: { cron: '0 * * * *' },
      })

      if (typeof workflowStore.linkTrigger !== 'function' || typeof workflowStore.unlinkTrigger !== 'function') {
        throw new Error('WorkflowThingStore.unlinkTrigger() not implemented')
      }

      // Link and then unlink
      await workflowStore.linkTrigger('workflow:unlink-trigger', 'schedule:to-unlink')
      await workflowStore.unlinkTrigger('workflow:unlink-trigger', 'schedule:to-unlink')

      // Verify trigger is no longer linked
      const triggers = await workflowStore.getLinkedTriggers('workflow:unlink-trigger')
      expect(triggers).toHaveLength(0)
    })

    it('WorkflowThingStore.getFunctionForStep() returns function linked to specific step', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create workflow with steps
      await workflowStore.create({
        id: 'workflow:step-function',
        name: 'step-function',
        steps: [
          { name: 'step1', type: 'do' },
          { name: 'step2', type: 'do' },
        ],
      })

      // Create and link functions to specific steps
      await store.createThing({
        id: 'function:step1-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'step1Handler' },
      })
      await store.createThing({
        id: 'function:step2-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'step2Handler' },
      })

      if (typeof workflowStore.linkFunction !== 'function' || typeof workflowStore.getFunctionForStep !== 'function') {
        throw new Error('WorkflowThingStore.getFunctionForStep() not implemented')
      }

      await workflowStore.linkFunction('workflow:step-function', 'step1', 'function:step1-handler')
      await workflowStore.linkFunction('workflow:step-function', 'step2', 'function:step2-handler')

      // Get function for specific step
      const step1Function = await workflowStore.getFunctionForStep('workflow:step-function', 'step1')
      const step2Function = await workflowStore.getFunctionForStep('workflow:step-function', 'step2')

      expect(step1Function?.id).toBe('function:step1-handler')
      expect(step2Function?.id).toBe('function:step2-handler')
    })

    it('relationship uses correct verb for function linking (usesFunction)', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create workflow and function
      await workflowStore.create({
        id: 'workflow:verb-test-function',
        name: 'verb-test',
        steps: [{ name: 'step', type: 'do' }],
      })
      await store.createThing({
        id: 'function:verb-test-handler',
        typeId: FUNCTION_TYPE_ID,
        typeName: FUNCTION_TYPE_NAME,
        data: { name: 'verbTestHandler' },
      })

      if (typeof workflowStore.linkFunction !== 'function') {
        throw new Error('WorkflowThingStore.linkFunction() not implemented')
      }

      await workflowStore.linkFunction('workflow:verb-test-function', 'step', 'function:verb-test-handler')

      // Verify the relationship uses 'usesFunction' verb
      // This requires access to the underlying relationships store
      if (typeof workflowStore.getRelationships !== 'function') {
        throw new Error('WorkflowThingStore.getRelationships() not implemented')
      }

      const relationships = await workflowStore.getRelationships('workflow:verb-test-function')
      const functionRel = relationships.find((r) => r.to === 'function:verb-test-handler')

      expect(functionRel).toBeDefined()
      expect(functionRel?.verb).toBe('usesFunction')
    })

    it('relationship uses correct verb for trigger linking (triggeredBy)', async () => {
      const workflowModule = await import('../workflow-thing-store').catch(() => null)
      if (!workflowModule?.WorkflowThingStore) {
        throw new Error('WorkflowThingStore not implemented')
      }

      const workflowStore = new workflowModule.WorkflowThingStore(store)

      // Create workflow and trigger
      await workflowStore.create({
        id: 'workflow:verb-test-trigger',
        name: 'verb-test-trigger',
        triggers: [{ type: 'cron', config: { schedule: '0 * * * *' } }],
      })
      await store.createThing({
        id: 'schedule:verb-test',
        typeId: SCHEDULE_TYPE_ID,
        typeName: SCHEDULE_TYPE_NAME,
        data: { cron: '0 * * * *' },
      })

      if (typeof workflowStore.linkTrigger !== 'function') {
        throw new Error('WorkflowThingStore.linkTrigger() not implemented')
      }

      await workflowStore.linkTrigger('workflow:verb-test-trigger', 'schedule:verb-test')

      // Verify the relationship uses 'triggeredBy' verb
      if (typeof workflowStore.getRelationships !== 'function') {
        throw new Error('WorkflowThingStore.getRelationships() not implemented')
      }

      const relationships = await workflowStore.getRelationships('workflow:verb-test-trigger')
      const triggerRel = relationships.find((r) => r.to === 'schedule:verb-test')

      expect(triggerRel).toBeDefined()
      expect(triggerRel?.verb).toBe('triggeredBy')
    })
  })
})
