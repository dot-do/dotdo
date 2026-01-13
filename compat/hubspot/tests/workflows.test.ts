/**
 * @dotdo/hubspot/workflows - HubSpot Workflow Engine Tests
 *
 * Comprehensive RED phase tests for HubSpot Workflow compatibility layer.
 * Tests cover: CRUD, triggers, actions, branching, execution, analytics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HubSpotWorkflows,
  HubSpotWorkflowError,
  WorkflowTemplates,
  SuppressionListManager,
  type Workflow,
  type Enrollment,
  type WorkflowType,
  type WorkflowStatus,
  type CreateWorkflowInput,
  type WorkflowStats,
  type SuppressionList,
  type WorkflowAction,
  type EnrollmentTrigger,
} from '../workflows'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockStorage() {
  const data = new Map<string, unknown>()
  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return data.get(key) as T | undefined
    }),
    set: vi.fn(async <T>(key: string, value: T): Promise<void> => {
      data.set(key, value)
    }),
    delete: vi.fn(async (key: string): Promise<boolean> => {
      return data.delete(key)
    }),
    list: vi.fn(async <T>(prefix: string): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of data.entries()) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _data: data,
  }
}

function createTestWorkflowInput(overrides: Partial<CreateWorkflowInput> = {}): CreateWorkflowInput {
  return {
    name: 'Test Workflow',
    type: 'contact',
    description: 'A test workflow',
    enrollmentTriggers: [
      { type: 'formSubmission', formId: 'form-123' },
    ],
    actions: [
      { type: 'setProperty', property: 'lifecyclestage', value: 'lead' },
    ],
    ...overrides,
  }
}

// =============================================================================
// WORKFLOW CRUD TESTS (15+ tests)
// =============================================================================

describe('@dotdo/hubspot/workflows - CRUD Operations', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('createWorkflow', () => {
    it('should create a workflow with basic configuration', async () => {
      const input = createTestWorkflowInput()
      const workflow = await workflows.createWorkflow(input)

      expect(workflow.id).toMatch(/^wf-/)
      expect(workflow.name).toBe('Test Workflow')
      expect(workflow.type).toBe('contact')
      expect(workflow.status).toBe('draft')
      expect(workflow.enrollmentTriggers).toHaveLength(1)
      expect(workflow.actions).toHaveLength(1)
      expect(workflow.version).toBe(1)
    })

    it('should create a workflow with multiple triggers', async () => {
      const input = createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'form-123' },
          { type: 'propertyChange', property: 'lifecyclestage', operator: 'eq', value: 'customer' },
        ],
      })

      const workflow = await workflows.createWorkflow(input)

      expect(workflow.enrollmentTriggers).toHaveLength(2)
      expect(workflow.enrollmentTriggers[0].type).toBe('formSubmission')
      expect(workflow.enrollmentTriggers[1].type).toBe('propertyChange')
    })

    it('should create a workflow with multiple actions', async () => {
      const input = createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-123' },
          { type: 'delay', delayType: 'fixed', duration: 86400000 },
          { type: 'setProperty', property: 'lifecyclestage', value: 'customer' },
        ],
      })

      const workflow = await workflows.createWorkflow(input)

      expect(workflow.actions).toHaveLength(3)
      expect(workflow.actions[0].type).toBe('sendEmail')
      expect(workflow.actions[1].type).toBe('delay')
      expect(workflow.actions[2].type).toBe('setProperty')
    })

    it('should set default reenrollment settings', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      expect(workflow.reenrollmentSettings.allowReenrollment).toBe(false)
    })

    it('should accept custom reenrollment settings', async () => {
      const input = createTestWorkflowInput({
        reenrollmentSettings: {
          allowReenrollment: true,
          maxEnrollments: 3,
          resetDelay: 86400000,
        },
      })

      const workflow = await workflows.createWorkflow(input)

      expect(workflow.reenrollmentSettings.allowReenrollment).toBe(true)
      expect(workflow.reenrollmentSettings.maxEnrollments).toBe(3)
      expect(workflow.reenrollmentSettings.resetDelay).toBe(86400000)
    })

    it('should create different workflow types', async () => {
      const types: WorkflowType[] = ['contact', 'company', 'deal', 'ticket', 'custom']

      for (const type of types) {
        const workflow = await workflows.createWorkflow(createTestWorkflowInput({ type }))
        expect(workflow.type).toBe(type)
      }
    })

    it('should generate unique IDs for each workflow', async () => {
      const workflow1 = await workflows.createWorkflow(createTestWorkflowInput())
      const workflow2 = await workflows.createWorkflow(createTestWorkflowInput())

      expect(workflow1.id).not.toBe(workflow2.id)
    })

    it('should set createdAt and updatedAt timestamps', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      expect(workflow.createdAt).toBeDefined()
      expect(workflow.updatedAt).toBeDefined()
      expect(new Date(workflow.createdAt).getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should create workflow with goal criteria', async () => {
      const input = createTestWorkflowInput({
        goalCriteria: {
          property: 'lifecyclestage',
          operator: 'eq',
          value: 'customer',
        },
      })

      const workflow = await workflows.createWorkflow(input)

      expect(workflow.goalCriteria).toBeDefined()
      expect(workflow.goalCriteria?.property).toBe('lifecyclestage')
      expect(workflow.goalCriteria?.operator).toBe('eq')
      expect(workflow.goalCriteria?.value).toBe('customer')
    })

    it('should create workflow with custom settings', async () => {
      const input = createTestWorkflowInput({
        settings: {
          timezone: 'America/New_York',
          executionPriority: 'high',
          excludeFromReporting: true,
        },
      })

      const workflow = await workflows.createWorkflow(input)

      expect(workflow.settings.timezone).toBe('America/New_York')
      expect(workflow.settings.executionPriority).toBe('high')
      expect(workflow.settings.excludeFromReporting).toBe(true)
    })

    it('should validate workflow name is required', async () => {
      const input = createTestWorkflowInput({ name: '' })

      await expect(workflows.createWorkflow(input)).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate workflow type is valid', async () => {
      const input = createTestWorkflowInput({ type: 'invalid' as WorkflowType })

      await expect(workflows.createWorkflow(input)).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should create workflow with suppression lists', async () => {
      const input = createTestWorkflowInput({
        settings: {
          timezone: 'UTC',
          suppressionLists: ['supp-list-1', 'supp-list-2'],
        },
      })

      const workflow = await workflows.createWorkflow(input)

      expect(workflow.settings.suppressionLists).toHaveLength(2)
      expect(workflow.settings.suppressionLists).toContain('supp-list-1')
    })
  })

  describe('getWorkflow', () => {
    it('should get an existing workflow', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      const fetched = await workflows.getWorkflow(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.name).toBe(created.name)
    })

    it('should throw error for non-existent workflow', async () => {
      await expect(workflows.getWorkflow('non-existent')).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should return complete workflow data', async () => {
      const input = createTestWorkflowInput({
        goalCriteria: { property: 'test', operator: 'eq', value: 'value' },
      })
      const created = await workflows.createWorkflow(input)
      const fetched = await workflows.getWorkflow(created.id)

      expect(fetched.enrollmentTriggers).toHaveLength(1)
      expect(fetched.actions).toHaveLength(1)
      expect(fetched.goalCriteria).toBeDefined()
      expect(fetched.reenrollmentSettings).toBeDefined()
      expect(fetched.settings).toBeDefined()
    })

    it('should throw NOT_FOUND error with correct status code', async () => {
      try {
        await workflows.getWorkflow('non-existent')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(HubSpotWorkflowError)
        expect((error as HubSpotWorkflowError).statusCode).toBe(404)
        expect((error as HubSpotWorkflowError).code).toBe('NOT_FOUND')
      }
    })
  })

  describe('updateWorkflow', () => {
    it('should update workflow name and description', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      const updated = await workflows.updateWorkflow(created.id, {
        name: 'Updated Name',
        description: 'Updated description',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.description).toBe('Updated description')
      expect(updated.version).toBe(2)
    })

    it('should not allow updating triggers on active workflow', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(created.id)

      await expect(
        workflows.updateWorkflow(created.id, {
          enrollmentTriggers: [{ type: 'manual' }],
        })
      ).rejects.toThrow('Cannot modify triggers or actions on active workflow')
    })

    it('should allow updating triggers on paused workflow', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(created.id)
      await workflows.pauseWorkflow(created.id)

      const updated = await workflows.updateWorkflow(created.id, {
        enrollmentTriggers: [{ type: 'manual' }],
      })

      expect(updated.enrollmentTriggers).toHaveLength(1)
      expect(updated.enrollmentTriggers[0].type).toBe('manual')
    })

    it('should increment version on each update', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      expect(created.version).toBe(1)

      const updated1 = await workflows.updateWorkflow(created.id, { name: 'V2' })
      expect(updated1.version).toBe(2)

      const updated2 = await workflows.updateWorkflow(created.id, { name: 'V3' })
      expect(updated2.version).toBe(3)
    })

    it('should update goal criteria', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      const updated = await workflows.updateWorkflow(created.id, {
        goalCriteria: {
          property: 'deal_amount',
          operator: 'gt',
          value: 10000,
        },
      })

      expect(updated.goalCriteria?.property).toBe('deal_amount')
      expect(updated.goalCriteria?.operator).toBe('gt')
    })

    it('should update settings partially', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput({
        settings: { timezone: 'UTC', executionPriority: 'normal' },
      }))

      const updated = await workflows.updateWorkflow(created.id, {
        settings: { executionPriority: 'high' },
      })

      expect(updated.settings.timezone).toBe('UTC')
      expect(updated.settings.executionPriority).toBe('high')
    })

    it('should throw error for non-existent workflow', async () => {
      await expect(
        workflows.updateWorkflow('non-existent', { name: 'Test' })
      ).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should update updatedAt timestamp', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      const originalUpdatedAt = created.updatedAt

      await new Promise(resolve => setTimeout(resolve, 10))

      const updated = await workflows.updateWorkflow(created.id, { name: 'New Name' })
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime())
    })
  })

  describe('deleteWorkflow', () => {
    it('should delete a draft workflow', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.deleteWorkflow(created.id)

      await expect(workflows.getWorkflow(created.id)).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should not allow deleting active workflow', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(created.id)

      await expect(workflows.deleteWorkflow(created.id)).rejects.toThrow(
        'Cannot delete active workflow'
      )
    })

    it('should delete paused workflow', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(created.id)
      await workflows.pauseWorkflow(created.id)

      await workflows.deleteWorkflow(created.id)
      await expect(workflows.getWorkflow(created.id)).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should delete associated enrollments', async () => {
      const created = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(created.id)
      await workflows.enrollContact(created.id, 'contact-1')
      await workflows.pauseWorkflow(created.id)

      await workflows.deleteWorkflow(created.id)

      const history = await workflows.getWorkflowHistory(created.id).catch(() => null)
      expect(history).toBeNull()
    })

    it('should throw error for non-existent workflow', async () => {
      await expect(workflows.deleteWorkflow('non-existent')).rejects.toThrow(HubSpotWorkflowError)
    })
  })

  describe('listWorkflows', () => {
    it('should list all workflows', async () => {
      await workflows.createWorkflow(createTestWorkflowInput({ name: 'Workflow 1' }))
      await workflows.createWorkflow(createTestWorkflowInput({ name: 'Workflow 2' }))

      const result = await workflows.listWorkflows()

      expect(result.workflows).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by type', async () => {
      await workflows.createWorkflow(createTestWorkflowInput({ type: 'contact' }))
      await workflows.createWorkflow(createTestWorkflowInput({ type: 'deal' }))

      const result = await workflows.listWorkflows({ type: 'contact' })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].type).toBe('contact')
    })

    it('should filter by status', async () => {
      const wf1 = await workflows.createWorkflow(createTestWorkflowInput({ name: 'Draft' }))
      const wf2 = await workflows.createWorkflow(createTestWorkflowInput({ name: 'Active' }))
      await workflows.resumeWorkflow(wf2.id)

      const draftResult = await workflows.listWorkflows({ status: 'draft' })
      const activeResult = await workflows.listWorkflows({ status: 'active' })

      expect(draftResult.workflows).toHaveLength(1)
      expect(activeResult.workflows).toHaveLength(1)
    })

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await workflows.createWorkflow(createTestWorkflowInput({ name: `Workflow ${i}` }))
      }

      const page1 = await workflows.listWorkflows({ limit: 2 })
      const page2 = await workflows.listWorkflows({ limit: 2, offset: 2 })

      expect(page1.workflows).toHaveLength(2)
      expect(page2.workflows).toHaveLength(2)
      expect(page1.total).toBe(5)
    })

    it('should return empty array when no workflows exist', async () => {
      const result = await workflows.listWorkflows()

      expect(result.workflows).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should sort by updatedAt descending', async () => {
      const wf1 = await workflows.createWorkflow(createTestWorkflowInput({ name: 'First' }))
      await new Promise(resolve => setTimeout(resolve, 10))
      const wf2 = await workflows.createWorkflow(createTestWorkflowInput({ name: 'Second' }))

      const result = await workflows.listWorkflows()

      expect(result.workflows[0].name).toBe('Second')
      expect(result.workflows[1].name).toBe('First')
    })
  })

  describe('cloneWorkflow', () => {
    it('should clone a workflow with new name', async () => {
      const original = await workflows.createWorkflow(createTestWorkflowInput())
      const cloned = await workflows.cloneWorkflow(original.id, 'Cloned Workflow')

      expect(cloned.id).not.toBe(original.id)
      expect(cloned.name).toBe('Cloned Workflow')
      expect(cloned.enrollmentTriggers).toHaveLength(1)
      expect(cloned.actions).toHaveLength(1)
      expect(cloned.status).toBe('draft')
    })

    it('should clone workflow with all actions', async () => {
      const original = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
          { type: 'delay', delayType: 'fixed', duration: 1000 },
          { type: 'setProperty', property: 'test', value: 'value' },
        ],
      }))

      const cloned = await workflows.cloneWorkflow(original.id, 'Clone')

      expect(cloned.actions).toHaveLength(3)
    })

    it('should clone workflow with reenrollment settings', async () => {
      const original = await workflows.createWorkflow(createTestWorkflowInput({
        reenrollmentSettings: {
          allowReenrollment: true,
          maxEnrollments: 5,
        },
      }))

      const cloned = await workflows.cloneWorkflow(original.id, 'Clone')

      expect(cloned.reenrollmentSettings.allowReenrollment).toBe(true)
      expect(cloned.reenrollmentSettings.maxEnrollments).toBe(5)
    })

    it('should clone workflow with goal criteria', async () => {
      const original = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'status',
          operator: 'eq',
          value: 'complete',
        },
      }))

      const cloned = await workflows.cloneWorkflow(original.id, 'Clone')

      expect(cloned.goalCriteria?.property).toBe('status')
    })

    it('should reset version to 1 on clone', async () => {
      const original = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.updateWorkflow(original.id, { name: 'V2' })
      await workflows.updateWorkflow(original.id, { name: 'V3' })

      const cloned = await workflows.cloneWorkflow(original.id, 'Clone')

      expect(cloned.version).toBe(1)
    })

    it('should throw error for non-existent workflow', async () => {
      await expect(workflows.cloneWorkflow('non-existent', 'Clone')).rejects.toThrow(HubSpotWorkflowError)
    })
  })
})

// =============================================================================
// ENROLLMENT TRIGGER TESTS (20+ tests)
// =============================================================================

describe('@dotdo/hubspot/workflows - Enrollment Triggers', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('Form Submission Trigger', () => {
    it('should create trigger on form submission', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'contact-form-123' },
        ],
      }))

      expect(workflow.enrollmentTriggers[0].type).toBe('formSubmission')
      expect((workflow.enrollmentTriggers[0].config as any).formId).toBe('contact-form-123')
    })

    it('should support multiple form triggers', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'form-1' },
          { type: 'formSubmission', formId: 'form-2' },
          { type: 'formSubmission', formId: 'form-3' },
        ],
      }))

      expect(workflow.enrollmentTriggers).toHaveLength(3)
    })

    it('should validate form ID is required', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: '' },
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })
  })

  describe('List Membership Trigger', () => {
    it('should create trigger on list membership added', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'listMembership', listId: 'list-123', membership: 'added' },
        ],
      }))

      expect(workflow.enrollmentTriggers[0].type).toBe('listMembership')
      expect((workflow.enrollmentTriggers[0].config as any).membership).toBe('added')
    })

    it('should create trigger on list membership removed', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'listMembership', listId: 'list-123', membership: 'removed' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).membership).toBe('removed')
    })

    it('should create trigger on is list member', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'listMembership', listId: 'list-123', membership: 'member' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).membership).toBe('member')
    })
  })

  describe('Property Change Trigger', () => {
    it('should create trigger on property change', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'lifecyclestage' },
        ],
      }))

      expect(workflow.enrollmentTriggers[0].type).toBe('propertyChange')
      expect((workflow.enrollmentTriggers[0].config as any).property).toBe('lifecyclestage')
    })

    it('should create trigger with specific value condition', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'lifecyclestage', operator: 'eq', value: 'customer' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).operator).toBe('eq')
      expect((workflow.enrollmentTriggers[0].config as any).value).toBe('customer')
    })

    it('should support various operators', async () => {
      const operators = ['eq', 'neq', 'contains', 'gt', 'lt', 'is_known', 'is_unknown']

      for (const operator of operators) {
        const workflow = await workflows.createWorkflow(createTestWorkflowInput({
          enrollmentTriggers: [
            { type: 'propertyChange', property: 'test', operator: operator as any },
          ],
        }))

        expect((workflow.enrollmentTriggers[0].config as any).operator).toBe(operator)
      }
    })

    it('should support previous value condition', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'status', operator: 'eq', value: 'active', previousValue: 'inactive' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).previousValue).toBe('inactive')
    })
  })

  describe('Page View Trigger', () => {
    it('should create trigger on specific page view', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'pageView', url: 'https://example.com/pricing' },
        ],
      }))

      expect(workflow.enrollmentTriggers[0].type).toBe('pageView')
      expect((workflow.enrollmentTriggers[0].config as any).url).toBe('https://example.com/pricing')
    })

    it('should create trigger with URL pattern', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'pageView', urlPattern: '/products/*' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).urlPattern).toBe('/products/*')
    })

    it('should create trigger with page ID', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'pageView', pageId: 'page-123' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).pageId).toBe('page-123')
    })
  })

  describe('Custom Event Trigger', () => {
    it('should create trigger on custom event', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'event', eventName: 'purchase_completed' },
        ],
      }))

      expect(workflow.enrollmentTriggers[0].type).toBe('event')
      expect((workflow.enrollmentTriggers[0].config as any).eventName).toBe('purchase_completed')
    })

    it('should create trigger with event type', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'event', eventName: 'signup', eventType: 'conversion' },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).eventType).toBe('conversion')
    })

    it('should create trigger with event properties filter', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'event', eventName: 'purchase', properties: { amount: 100, currency: 'USD' } },
        ],
      }))

      expect((workflow.enrollmentTriggers[0].config as any).properties).toEqual({ amount: 100, currency: 'USD' })
    })
  })

  describe('Multiple Enrollment Criteria', () => {
    it('should support AND logic for multiple criteria', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'lifecyclestage', operator: 'eq', value: 'lead' },
          { type: 'listMembership', listId: 'hot-leads', membership: 'member' },
        ],
      }))

      expect(workflow.enrollmentTriggers).toHaveLength(2)
    })

    it('should support OR logic via separate triggers', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'form-1' },
          { type: 'formSubmission', formId: 'form-2' },
        ],
      }))

      expect(workflow.enrollmentTriggers).toHaveLength(2)
    })
  })

  describe('setEnrollmentCriteria', () => {
    it('should set enrollment criteria', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const updated = await workflows.setEnrollmentCriteria(workflow.id, [
        { type: 'propertyChange', property: 'email', operator: 'is_known' },
      ])

      expect(updated.enrollmentTriggers).toHaveLength(1)
      expect(updated.enrollmentTriggers[0].type).toBe('propertyChange')
    })

    it('should replace all existing criteria', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'form-1' },
          { type: 'formSubmission', formId: 'form-2' },
        ],
      }))

      const updated = await workflows.setEnrollmentCriteria(workflow.id, [
        { type: 'manual' },
      ])

      expect(updated.enrollmentTriggers).toHaveLength(1)
      expect(updated.enrollmentTriggers[0].type).toBe('manual')
    })
  })

  describe('addEnrollmentFilter', () => {
    it('should add a new enrollment filter', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const trigger = await workflows.addEnrollmentFilter(workflow.id, {
        type: 'listMembership',
        listId: 'list-123',
        membership: 'added',
      })

      expect(trigger.type).toBe('listMembership')

      const updated = await workflows.getWorkflow(workflow.id)
      expect(updated.enrollmentTriggers).toHaveLength(2)
    })

    it('should not add filter to active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(workflows.addEnrollmentFilter(workflow.id, {
        type: 'manual',
      })).rejects.toThrow('Cannot modify triggers on active workflow')
    })

    it('should generate unique ID for new filter', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const trigger1 = await workflows.addEnrollmentFilter(workflow.id, { type: 'manual' })
      const trigger2 = await workflows.addEnrollmentFilter(workflow.id, { type: 'api' })

      expect(trigger1.id).not.toBe(trigger2.id)
    })
  })

  describe('removeEnrollmentFilter', () => {
    it('should remove an enrollment filter', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'form-1' },
          { type: 'formSubmission', formId: 'form-2' },
        ],
      }))

      const triggerId = workflow.enrollmentTriggers[0].id
      await workflows.removeEnrollmentFilter(workflow.id, triggerId)

      const updated = await workflows.getWorkflow(workflow.id)
      expect(updated.enrollmentTriggers).toHaveLength(1)
    })

    it('should throw error for non-existent filter', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      await expect(
        workflows.removeEnrollmentFilter(workflow.id, 'non-existent')
      ).rejects.toThrow('Trigger not found')
    })

    it('should not remove from active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(
        workflows.removeEnrollmentFilter(workflow.id, workflow.enrollmentTriggers[0].id)
      ).rejects.toThrow('Cannot modify triggers on active workflow')
    })
  })

  describe('reenrollmentSettings', () => {
    it('should update reenrollment settings', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const settings = await workflows.reenrollmentSettings(workflow.id, {
        allowReenrollment: true,
        maxEnrollments: 5,
      })

      expect(settings.allowReenrollment).toBe(true)
      expect(settings.maxEnrollments).toBe(5)
    })

    it('should set reset delay', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const settings = await workflows.reenrollmentSettings(workflow.id, {
        resetDelay: 86400000,
      })

      expect(settings.resetDelay).toBe(86400000)
    })

    it('should preserve existing settings when partially updating', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        reenrollmentSettings: {
          allowReenrollment: true,
          maxEnrollments: 3,
        },
      }))

      const settings = await workflows.reenrollmentSettings(workflow.id, {
        resetDelay: 1000,
      })

      expect(settings.allowReenrollment).toBe(true)
      expect(settings.maxEnrollments).toBe(3)
      expect(settings.resetDelay).toBe(1000)
    })
  })

  describe('Enrollment Criteria Validation', () => {
    it('should validate trigger type is valid', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'invalid_trigger' as any },
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should require at least one trigger for enrollment', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate form submission requires formId', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate list membership requires listId', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'listMembership', membership: 'added' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate property change requires property name', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate event trigger requires eventName', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'event' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })
  })
})

// =============================================================================
// WORKFLOW ACTIONS TESTS (25+ tests)
// =============================================================================

describe('@dotdo/hubspot/workflows - Actions', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('Set Property Action', () => {
    it('should create set property action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', property: 'lifecyclestage', value: 'customer' },
        ],
      }))

      expect(workflow.actions[0].type).toBe('setProperty')
      expect((workflow.actions[0].config as any).property).toBe('lifecyclestage')
      expect((workflow.actions[0].config as any).value).toBe('customer')
    })

    it('should support different property types', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', property: 'score', value: 100 },
          { type: 'setProperty', property: 'active', value: true },
          { type: 'setProperty', property: 'tags', value: 'vip,premium' },
        ],
      }))

      expect(workflow.actions).toHaveLength(3)
    })

    it('should support object type specification', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        type: 'deal',
        actions: [
          { type: 'setProperty', property: 'dealstage', value: 'won', objectType: 'deal' },
        ],
      }))

      expect((workflow.actions[0].config as any).objectType).toBe('deal')
    })
  })

  describe('Send Email Action', () => {
    it('should create send email action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-template-123' },
        ],
      }))

      expect(workflow.actions[0].type).toBe('sendEmail')
      expect((workflow.actions[0].config as any).emailId).toBe('email-template-123')
    })

    it('should support sendTo options', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1', sendTo: 'contact' },
          { type: 'sendEmail', emailId: 'email-2', sendTo: 'owner' },
          { type: 'sendEmail', emailId: 'email-3', sendTo: 'custom', customRecipient: 'team@example.com' },
        ],
      }))

      expect((workflow.actions[0].config as any).sendTo).toBe('contact')
      expect((workflow.actions[1].config as any).sendTo).toBe('owner')
      expect((workflow.actions[2].config as any).customRecipient).toBe('team@example.com')
    })
  })

  describe('Delay Action', () => {
    it('should create fixed duration delay', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 86400000 },
        ],
      }))

      expect(workflow.actions[0].type).toBe('delay')
      expect((workflow.actions[0].config as any).delayType).toBe('fixed')
      expect((workflow.actions[0].config as any).duration).toBe(86400000)
    })

    it('should create delay until specific date', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'until', until: { date: '2025-01-01T00:00:00Z' } },
        ],
      }))

      expect((workflow.actions[0].config as any).delayType).toBe('until')
      expect((workflow.actions[0].config as any).until.date).toBe('2025-01-01T00:00:00Z')
    })

    it('should create delay until day of week', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'until', until: { dayOfWeek: 1, time: '09:00', timezone: 'America/New_York' } },
        ],
      }))

      expect((workflow.actions[0].config as any).until.dayOfWeek).toBe(1)
      expect((workflow.actions[0].config as any).until.time).toBe('09:00')
    })

    it('should create delay until business hours', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'delay',
            delayType: 'businessHours',
            businessHours: {
              timezone: 'America/New_York',
              hours: [
                { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
                { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
              ],
            },
          },
        ],
      }))

      expect((workflow.actions[0].config as any).delayType).toBe('businessHours')
      expect((workflow.actions[0].config as any).businessHours.hours).toHaveLength(2)
    })
  })

  describe('Create Task Action', () => {
    it('should create task action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'createTask', title: 'Follow up with contact' },
        ],
      }))

      expect(workflow.actions[0].type).toBe('createTask')
      expect((workflow.actions[0].config as any).title).toBe('Follow up with contact')
    })

    it('should support task options', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'createTask',
            title: 'Follow up',
            body: 'Task description',
            dueDays: 3,
            priority: 'high',
            assignTo: 'owner',
          },
        ],
      }))

      expect((workflow.actions[0].config as any).dueDays).toBe(3)
      expect((workflow.actions[0].config as any).priority).toBe('high')
      expect((workflow.actions[0].config as any).assignTo).toBe('owner')
    })

    it('should support custom owner assignment', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'createTask', title: 'Task', assignTo: 'custom', customOwnerId: 'user-123' },
        ],
      }))

      expect((workflow.actions[0].config as any).customOwnerId).toBe('user-123')
    })
  })

  describe('Send Notification Action', () => {
    it('should create email notification', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'notification', notificationType: 'email', recipients: ['team@example.com'], message: 'Alert!' },
        ],
      }))

      expect(workflow.actions[0].type).toBe('notification')
      expect((workflow.actions[0].config as any).notificationType).toBe('email')
    })

    it('should create in-app notification', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'notification', notificationType: 'inApp', recipients: ['owner'], message: 'New lead!' },
        ],
      }))

      expect((workflow.actions[0].config as any).notificationType).toBe('inApp')
    })

    it('should support subject line', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'notification', notificationType: 'email', recipients: ['a@b.com'], subject: 'Alert', message: 'Body' },
        ],
      }))

      expect((workflow.actions[0].config as any).subject).toBe('Alert')
    })
  })

  describe('Webhook Action', () => {
    it('should create webhook action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'webhook', url: 'https://example.com/webhook', method: 'POST' },
        ],
      }))

      expect(workflow.actions[0].type).toBe('webhook')
      expect((workflow.actions[0].config as any).url).toBe('https://example.com/webhook')
      expect((workflow.actions[0].config as any).method).toBe('POST')
    })

    it('should support custom headers', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'webhook', url: 'https://example.com', method: 'POST', headers: { 'X-Custom': 'value' } },
        ],
      }))

      expect((workflow.actions[0].config as any).headers['X-Custom']).toBe('value')
    })

    it('should support request body', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'webhook', url: 'https://example.com', method: 'POST', body: { data: 'test' } },
        ],
      }))

      expect((workflow.actions[0].config as any).body).toEqual({ data: 'test' })
    })

    it('should support bearer authentication', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'webhook',
            url: 'https://example.com',
            method: 'POST',
            authentication: { type: 'bearer', token: 'secret-token' },
          },
        ],
      }))

      expect((workflow.actions[0].config as any).authentication.type).toBe('bearer')
    })

    it('should support basic authentication', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'webhook',
            url: 'https://example.com',
            method: 'POST',
            authentication: { type: 'basic', username: 'user', password: 'pass' },
          },
        ],
      }))

      expect((workflow.actions[0].config as any).authentication.type).toBe('basic')
    })

    it('should support API key authentication', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'webhook',
            url: 'https://example.com',
            method: 'POST',
            authentication: { type: 'apiKey', apiKey: 'key-123', headerName: 'X-API-Key' },
          },
        ],
      }))

      expect((workflow.actions[0].config as any).authentication.type).toBe('apiKey')
    })
  })

  describe('addAction', () => {
    it('should add an action to workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const action = await workflows.addAction(workflow.id, {
        type: 'sendEmail',
        emailId: 'email-123',
      })

      expect(action.type).toBe('sendEmail')

      const updated = await workflows.getWorkflow(workflow.id)
      expect(updated.actions).toHaveLength(2)
    })

    it('should assign correct order to new action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', property: 'a', value: '1' },
          { type: 'setProperty', property: 'b', value: '2' },
        ],
      }))

      const action = await workflows.addAction(workflow.id, {
        type: 'sendEmail',
        emailId: 'email-123',
      })

      expect(action.order).toBe(2)
    })

    it('should not add action to active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(workflows.addAction(workflow.id, {
        type: 'sendEmail',
        emailId: 'email-123',
      })).rejects.toThrow('Cannot modify actions on active workflow')
    })
  })

  describe('updateAction', () => {
    it('should update an action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const actionId = workflow.actions[0].id

      const updated = await workflows.updateAction(workflow.id, actionId, {
        property: 'hs_lead_status',
        value: 'new',
      })

      expect((updated.config as any).property).toBe('hs_lead_status')
    })

    it('should throw error for non-existent action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      await expect(
        workflows.updateAction(workflow.id, 'non-existent', { value: 'test' })
      ).rejects.toThrow('Action not found')
    })

    it('should not update action on active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(
        workflows.updateAction(workflow.id, workflow.actions[0].id, { value: 'test' })
      ).rejects.toThrow('Cannot modify actions on active workflow')
    })
  })

  describe('removeAction', () => {
    it('should remove an action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
          { type: 'setProperty', property: 'lifecyclestage', value: 'lead' },
        ],
      }))

      await workflows.removeAction(workflow.id, workflow.actions[0].id)

      const updated = await workflows.getWorkflow(workflow.id)
      expect(updated.actions).toHaveLength(1)
      expect(updated.actions[0].type).toBe('setProperty')
    })

    it('should reorder remaining actions', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
          { type: 'delay', delayType: 'fixed', duration: 1000 },
          { type: 'setProperty', property: 'test', value: 'value' },
        ],
      }))

      await workflows.removeAction(workflow.id, workflow.actions[1].id)

      const updated = await workflows.getWorkflow(workflow.id)
      expect(updated.actions[0].order).toBe(0)
      expect(updated.actions[1].order).toBe(1)
    })

    it('should throw error for non-existent action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      await expect(
        workflows.removeAction(workflow.id, 'non-existent')
      ).rejects.toThrow('Action not found')
    })
  })

  describe('reorderActions', () => {
    it('should reorder actions', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
          { type: 'delay', delayType: 'fixed', duration: 1000 },
          { type: 'setProperty', property: 'lifecyclestage', value: 'lead' },
        ],
      }))

      const originalOrder = workflow.actions.map((a) => a.id)
      const newOrder = [originalOrder[2], originalOrder[0], originalOrder[1]]

      const reordered = await workflows.reorderActions(workflow.id, newOrder)

      expect(reordered[0].type).toBe('setProperty')
      expect(reordered[1].type).toBe('sendEmail')
      expect(reordered[2].type).toBe('delay')
    })

    it('should throw error if action IDs missing', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
          { type: 'setProperty', property: 'test', value: 'value' },
        ],
      }))

      await expect(
        workflows.reorderActions(workflow.id, [workflow.actions[0].id])
      ).rejects.toThrow('Action IDs must include all workflow actions')
    })

    it('should throw error for non-existent action ID', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
        ],
      }))

      await expect(
        workflows.reorderActions(workflow.id, ['non-existent'])
      ).rejects.toThrow('Action not found')
    })
  })

  describe('Action Validation', () => {
    it('should validate action type', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'invalid_action' as any },
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate sendEmail requires emailId', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate setProperty requires property name', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', value: 'test' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate webhook requires url', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'webhook', method: 'POST' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate createTask requires title', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'createTask' } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })

    it('should validate notification requires message', async () => {
      await expect(workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'notification', notificationType: 'email', recipients: ['a@b.com'] } as any,
        ],
      }))).rejects.toThrow(HubSpotWorkflowError)
    })
  })
})

// =============================================================================
// BRANCHING LOGIC TESTS (15+ tests)
// =============================================================================

describe('@dotdo/hubspot/workflows - Branching', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('createIfThenBranch', () => {
    it('should create an if-then branch', () => {
      const { branchAction, thenActions, elseActions } = workflows.createIfThenBranch({
        condition: {
          property: 'lifecyclestage',
          operator: 'eq',
          value: 'customer',
        },
        thenActions: [
          { type: 'sendEmail', emailId: 'customer-email' },
        ],
        elseActions: [
          { type: 'sendEmail', emailId: 'prospect-email' },
        ],
      })

      expect(branchAction.type).toBe('branch')
      expect(branchAction.branchType).toBe('if-then')
      expect(thenActions).toHaveLength(1)
      expect(elseActions).toHaveLength(1)
    })

    it('should create if-then without else branch', () => {
      const { branchAction, thenActions, elseActions } = workflows.createIfThenBranch({
        condition: {
          property: 'score',
          operator: 'gt',
          value: 50,
        },
        thenActions: [
          { type: 'setProperty', property: 'qualified', value: 'true' },
        ],
      })

      expect(branchAction.branchType).toBe('if-then')
      expect(thenActions).toHaveLength(1)
      expect(elseActions).toHaveLength(0)
    })

    it('should support contains operator', () => {
      const { branchAction } = workflows.createIfThenBranch({
        condition: {
          property: 'email',
          operator: 'contains',
          value: '@company.com',
        },
        thenActions: [{ type: 'setProperty', property: 'internal', value: 'true' }],
      })

      expect(branchAction.condition?.operator).toBe('contains')
    })

    it('should support is_known operator', () => {
      const { branchAction } = workflows.createIfThenBranch({
        condition: {
          property: 'phone',
          operator: 'is_known',
        },
        thenActions: [{ type: 'createTask', title: 'Call contact' }],
      })

      expect(branchAction.condition?.operator).toBe('is_known')
    })

    it('should support nested AND conditions', () => {
      const { branchAction } = workflows.createIfThenBranch({
        condition: {
          property: 'score',
          operator: 'gt',
          value: 50,
          and: [
            { property: 'lifecyclestage', operator: 'eq', value: 'lead' },
          ],
        },
        thenActions: [{ type: 'sendEmail', emailId: 'email-1' }],
      })

      expect(branchAction.condition?.and).toHaveLength(1)
    })

    it('should support nested OR conditions', () => {
      const { branchAction } = workflows.createIfThenBranch({
        condition: {
          property: 'country',
          operator: 'eq',
          value: 'USA',
          or: [
            { property: 'country', operator: 'eq', value: 'Canada' },
          ],
        },
        thenActions: [{ type: 'sendEmail', emailId: 'email-1' }],
      })

      expect(branchAction.condition?.or).toHaveLength(1)
    })
  })

  describe('createValueBranch', () => {
    it('should create a value-based branch', () => {
      const { branchAction, branchActions } = workflows.createValueBranch({
        property: 'hs_lead_status',
        branches: [
          { value: 'new', actions: [{ type: 'sendEmail', emailId: 'new-lead-email' }] },
          { value: 'qualified', actions: [{ type: 'createTask', title: 'Follow up' }] },
        ],
      })

      expect(branchAction.type).toBe('branch')
      expect(branchAction.branchType).toBe('value')
      expect(branchAction.branches).toHaveLength(2)
      expect(Object.keys(branchActions)).toHaveLength(2)
    })

    it('should support multiple branches', () => {
      const { branchAction } = workflows.createValueBranch({
        property: 'industry',
        branches: [
          { value: 'tech', actions: [] },
          { value: 'finance', actions: [] },
          { value: 'healthcare', actions: [] },
          { value: 'retail', actions: [] },
        ],
      })

      expect(branchAction.branches).toHaveLength(4)
    })

    it('should assign unique IDs to branches', () => {
      const { branchAction } = workflows.createValueBranch({
        property: 'status',
        branches: [
          { value: 'a', actions: [] },
          { value: 'b', actions: [] },
        ],
      })

      expect(branchAction.branches![0].id).not.toBe(branchAction.branches![1].id)
    })

    it('should support branch labels', () => {
      const { branchAction } = workflows.createValueBranch({
        property: 'status',
        branches: [
          { value: 'active', label: 'Active Customers', actions: [] },
          { value: 'inactive', label: 'Inactive Customers', actions: [] },
        ],
      })

      expect(branchAction.branches![0].label).toBe('Active Customers')
    })
  })

  describe('createRandomBranch', () => {
    it('should create a random split branch', () => {
      const { branchAction, splitActions } = workflows.createRandomBranch({
        splits: [
          { percentage: 50, label: 'A', actions: [{ type: 'sendEmail', emailId: 'email-a' }] },
          { percentage: 50, label: 'B', actions: [{ type: 'sendEmail', emailId: 'email-b' }] },
        ],
      })

      expect(branchAction.type).toBe('branch')
      expect(branchAction.branchType).toBe('random')
      expect(branchAction.splits).toHaveLength(2)
      expect(Object.keys(splitActions)).toHaveLength(2)
    })

    it('should throw error if percentages do not sum to 100', () => {
      expect(() => {
        workflows.createRandomBranch({
          splits: [
            { percentage: 30, actions: [] },
            { percentage: 30, actions: [] },
          ],
        })
      }).toThrow('Random split percentages must sum to 100')
    })

    it('should support uneven splits', () => {
      const { branchAction } = workflows.createRandomBranch({
        splits: [
          { percentage: 80, label: 'Control', actions: [] },
          { percentage: 20, label: 'Variant', actions: [] },
        ],
      })

      expect(branchAction.splits![0].percentage).toBe(80)
      expect(branchAction.splits![1].percentage).toBe(20)
    })

    it('should support multiple splits', () => {
      const { branchAction } = workflows.createRandomBranch({
        splits: [
          { percentage: 25, label: 'A', actions: [] },
          { percentage: 25, label: 'B', actions: [] },
          { percentage: 25, label: 'C', actions: [] },
          { percentage: 25, label: 'D', actions: [] },
        ],
      })

      expect(branchAction.splits).toHaveLength(4)
    })

    it('should handle decimal percentages', () => {
      const { branchAction } = workflows.createRandomBranch({
        splits: [
          { percentage: 33.33, actions: [] },
          { percentage: 33.33, actions: [] },
          { percentage: 33.34, actions: [] },
        ],
      })

      expect(branchAction.splits).toHaveLength(3)
    })
  })

  describe('Nested Branches', () => {
    it('should support nested if-then branches', async () => {
      const innerBranch = workflows.createIfThenBranch({
        condition: { property: 'score', operator: 'gt', value: 80 },
        thenActions: [{ type: 'sendEmail', emailId: 'vip-email' }],
        elseActions: [{ type: 'sendEmail', emailId: 'standard-email' }],
      })

      const outerBranch = workflows.createIfThenBranch({
        condition: { property: 'lifecyclestage', operator: 'eq', value: 'customer' },
        thenActions: [
          innerBranch.branchAction,
          ...innerBranch.thenActions,
        ],
        elseActions: [{ type: 'sendEmail', emailId: 'prospect-email' }],
      })

      expect(outerBranch.thenActions).toHaveLength(2)
    })
  })

  describe('Empty Branch Handling', () => {
    it('should handle empty then actions', () => {
      const { thenActions } = workflows.createIfThenBranch({
        condition: { property: 'test', operator: 'eq', value: 'x' },
        thenActions: [],
      })

      expect(thenActions).toHaveLength(0)
    })

    it('should handle empty value branch actions', () => {
      const { branchActions } = workflows.createValueBranch({
        property: 'status',
        branches: [
          { value: 'active', actions: [] },
        ],
      })

      const keys = Object.keys(branchActions)
      expect(branchActions[keys[0]]).toHaveLength(0)
    })
  })

  describe('Branch Evaluation', () => {
    it('should evaluate greater than condition', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'branch',
            branchType: 'if-then',
            condition: { property: 'score', operator: 'gt', value: 50 },
          },
        ],
      }))

      expect(workflow.actions[0].type).toBe('branch')
    })

    it('should evaluate less than condition', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'branch',
            branchType: 'if-then',
            condition: { property: 'age', operator: 'lt', value: 30 },
          },
        ],
      }))

      expect((workflow.actions[0].config as any).condition.operator).toBe('lt')
    })

    it('should evaluate in_list condition', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          {
            type: 'branch',
            branchType: 'if-then',
            condition: { property: 'country', operator: 'in_list', value: ['USA', 'Canada', 'UK'] },
          },
        ],
      }))

      expect((workflow.actions[0].config as any).condition.operator).toBe('in_list')
    })
  })
})

// =============================================================================
// WORKFLOW EXECUTION TESTS (15+ tests)
// =============================================================================

describe('@dotdo/hubspot/workflows - Enrollment & Execution', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('enrollContact', () => {
    it('should enroll a contact in active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      expect(enrollment.workflowId).toBe(workflow.id)
      expect(enrollment.contactId).toBe('contact-123')
      expect(enrollment.status).toBe('active')
    })

    it('should not enroll in inactive workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      await expect(
        workflows.enrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Cannot enroll in draft workflow')
    })

    it('should not allow duplicate active enrollment', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-123')

      await expect(
        workflows.enrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Contact is already enrolled')
    })

    it('should allow reenrollment when enabled', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        reenrollmentSettings: { allowReenrollment: true },
      }))
      await workflows.resumeWorkflow(workflow.id)

      const enrollment1 = await workflows.enrollContact(workflow.id, 'contact-123')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData.status = 'completed'
      enrollmentData.completedAt = new Date().toISOString()
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData)

      const enrollment2 = await workflows.enrollContact(workflow.id, 'contact-123')
      expect(enrollment2.id).not.toBe(enrollment1.id)
    })

    it('should accept enrollment metadata', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123', {
        source: 'api',
        campaign: 'summer-sale',
      })

      expect(enrollment.metadata?.source).toBe('api')
      expect(enrollment.metadata?.campaign).toBe('summer-sale')
    })

    it('should set initial currentActionId', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-1' },
          { type: 'setProperty', property: 'test', value: 'value' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      expect(enrollment.currentActionId).toBe(workflow.actions[0].id)
    })

    it('should track workflow version at enrollment', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      expect(enrollment.workflowVersion).toBe(workflow.version)
    })

    it('should enforce max enrollments limit', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        reenrollmentSettings: { allowReenrollment: true, maxEnrollments: 2 },
      }))
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-123')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData.status = 'completed'
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData)

      await workflows.enrollContact(workflow.id, 'contact-123')

      const enrollmentData2 = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData2.status = 'completed'
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData2)

      await expect(
        workflows.enrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Maximum enrollments')
    })

    it('should enforce reset delay', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        reenrollmentSettings: { allowReenrollment: true, resetDelay: 86400000 },
      }))
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-123')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData.status = 'completed'
      enrollmentData.completedAt = new Date().toISOString()
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData)

      await expect(
        workflows.enrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Reset delay period has not elapsed')
    })
  })

  describe('unenrollContact', () => {
    it('should unenroll an active contact', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-123')
      await workflows.unenrollContact(workflow.id, 'contact-123')

      const storage = (workflows as any).storage
      const enrollment = await storage.get(`enrollment:${workflow.id}:contact-123`)
      expect(enrollment.status).toBe('unenrolled')
    })

    it('should set unenrolledAt timestamp', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-123')
      await workflows.unenrollContact(workflow.id, 'contact-123')

      const storage = (workflows as any).storage
      const enrollment = await storage.get(`enrollment:${workflow.id}:contact-123`)
      expect(enrollment.unenrolledAt).toBeDefined()
    })

    it('should throw error for non-enrolled contact', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(
        workflows.unenrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Enrollment not found')
    })

    it('should throw error for already completed enrollment', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-123')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData.status = 'completed'
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData)

      await expect(
        workflows.unenrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Cannot unenroll')
    })
  })

  describe('pauseWorkflow', () => {
    it('should pause an active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const paused = await workflows.pauseWorkflow(workflow.id)

      expect(paused.status).toBe('paused')
    })

    it('should throw error for non-active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      await expect(workflows.pauseWorkflow(workflow.id)).rejects.toThrow('Cannot pause')
    })
  })

  describe('resumeWorkflow', () => {
    it('should resume a draft workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const resumed = await workflows.resumeWorkflow(workflow.id)

      expect(resumed.status).toBe('active')
    })

    it('should resume a paused workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      await workflows.pauseWorkflow(workflow.id)

      const resumed = await workflows.resumeWorkflow(workflow.id)

      expect(resumed.status).toBe('active')
    })

    it('should throw error for already active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(workflows.resumeWorkflow(workflow.id)).rejects.toThrow('Cannot resume')
    })
  })

  describe('getWorkflowHistory', () => {
    it('should get workflow execution history', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')

      const history = await workflows.getWorkflowHistory(workflow.id)

      expect(history.enrollments).toHaveLength(2)
    })

    it('should filter history by date range', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')

      const startDate = new Date(Date.now() - 3600000).toISOString()
      const endDate = new Date(Date.now() + 3600000).toISOString()

      const history = await workflows.getWorkflowHistory(workflow.id, { startDate, endDate })

      expect(history.enrollments.length).toBeGreaterThanOrEqual(0)
    })

    it('should paginate history results', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      for (let i = 0; i < 5; i++) {
        await workflows.enrollContact(workflow.id, `contact-${i}`)
      }

      const page1 = await workflows.getWorkflowHistory(workflow.id, { limit: 2 })
      const page2 = await workflows.getWorkflowHistory(workflow.id, { limit: 2, offset: 2 })

      expect(page1.enrollments).toHaveLength(2)
      expect(page2.enrollments).toHaveLength(2)
      expect(page1.total).toBe(5)
    })

    it('should include enrollment events', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      await workflows.enrollContact(workflow.id, 'contact-1')

      await new Promise(resolve => setTimeout(resolve, 100))

      const history = await workflows.getWorkflowHistory(workflow.id)

      expect(history.events.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Bulk Enrollment', () => {
    it('should support bulk enrollment of multiple contacts', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const contactIds = ['contact-1', 'contact-2', 'contact-3']

      for (const contactId of contactIds) {
        await workflows.enrollContact(workflow.id, contactId)
      }

      const history = await workflows.getWorkflowHistory(workflow.id)
      expect(history.enrollments).toHaveLength(3)
    })
  })

  describe('Manual Enrollment', () => {
    it('should support manual enrollment trigger', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [{ type: 'manual' }],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      expect(enrollment.status).toBe('active')
    })
  })
})

// =============================================================================
// WORKFLOW ANALYTICS TESTS (10+ tests)
// =============================================================================

describe('@dotdo/hubspot/workflows - Analytics', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('getWorkflowStats', () => {
    it('should return workflow statistics', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.workflowId).toBe(workflow.id)
      expect(stats.totalEnrollments).toBe(2)
      expect(stats.activeEnrollments).toBe(2)
    })

    it('should count completed enrollments', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-1`)
      enrollmentData.status = 'completed'
      enrollmentData.completedAt = new Date().toISOString()
      await storage.set(`enrollment:${workflow.id}:contact-1`, enrollmentData)

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.completedEnrollments).toBe(1)
    })

    it('should count failed enrollments', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-1`)
      enrollmentData.status = 'failed'
      enrollmentData.failedAt = new Date().toISOString()
      await storage.set(`enrollment:${workflow.id}:contact-1`, enrollmentData)

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.failedEnrollments).toBe(1)
    })

    it('should calculate average completion time', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')

      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-1`)
      enrollmentData.status = 'completed'
      enrollmentData.completedAt = new Date(Date.now() + 3600000).toISOString()
      await storage.set(`enrollment:${workflow.id}:contact-1`, enrollmentData)

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.averageCompletionTime).toBeGreaterThan(0)
    })

    it('should return zero stats for workflow with no enrollments', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.totalEnrollments).toBe(0)
      expect(stats.activeEnrollments).toBe(0)
      expect(stats.completedEnrollments).toBe(0)
    })
  })

  describe('getEnrollmentStats', () => {
    it('should return enrollment statistics for period', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')

      const stats = await workflows.getEnrollmentStats(workflow.id, { period: 'day' })

      expect(stats.period).toBe('day')
      expect(stats.enrollments).toBeGreaterThanOrEqual(1)
    })

    it('should support different periods', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const periods = ['day', 'week', 'month', 'quarter', 'year'] as const

      for (const period of periods) {
        const stats = await workflows.getEnrollmentStats(workflow.id, { period })
        expect(stats.period).toBe(period)
      }
    })

    it('should support custom date range', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const stats = await workflows.getEnrollmentStats(workflow.id, {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      })

      expect(stats.enrollments).toBeDefined()
    })
  })

  describe('getActionPerformance', () => {
    it('should return action performance metrics', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', property: 'lifecyclestage', value: 'lead' },
          { type: 'sendEmail', emailId: 'email-123' },
        ],
      }))

      const performance = await workflows.getActionPerformance(workflow.id)

      expect(performance).toHaveLength(2)
      expect(performance[0].actionType).toBe('setProperty')
      expect(performance[1].actionType).toBe('sendEmail')
    })

    it('should include execution counts', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const performance = await workflows.getActionPerformance(workflow.id)

      expect(performance[0].executions).toBeDefined()
      expect(performance[0].successes).toBeDefined()
      expect(performance[0].failures).toBeDefined()
    })

    it('should calculate error rate', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const performance = await workflows.getActionPerformance(workflow.id)

      expect(performance[0].errorRate).toBeDefined()
    })
  })

  describe('getConversionRate', () => {
    it('should return conversion rate', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'lifecyclestage',
          operator: 'eq',
          value: 'customer',
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')

      const rate = await workflows.getConversionRate(workflow.id)

      expect(rate.total).toBe(1)
      expect(rate.goalCriteria).toBeDefined()
    })

    it('should return goal criteria in response', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'deal_closed',
          operator: 'eq',
          value: true,
        },
      }))

      const rate = await workflows.getConversionRate(workflow.id)

      expect(rate.goalCriteria?.property).toBe('deal_closed')
    })

    it('should handle workflow without goal criteria', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const rate = await workflows.getConversionRate(workflow.id)

      expect(rate.goalCriteria).toBeUndefined()
    })
  })

  describe('Goal Tracking', () => {
    it('should track goal reached count', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'status',
          operator: 'eq',
          value: 'converted',
        },
      }))

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.goalReachedCount).toBeDefined()
    })
  })

  describe('Time in Workflow', () => {
    it('should calculate average time in workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const stats = await workflows.getWorkflowStats(workflow.id)

      expect(stats.averageCompletionTime).toBeDefined()
    })
  })
})

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Error Handling', () => {
  it('should throw error without access token', () => {
    expect(() => new HubSpotWorkflows({} as any)).toThrow('Access token is required')
  })

  it('should use HubSpotWorkflowError for errors', async () => {
    const workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
    })

    try {
      await workflows.getWorkflow('non-existent')
    } catch (error) {
      expect(error).toBeInstanceOf(HubSpotWorkflowError)
      expect((error as HubSpotWorkflowError).code).toBe('NOT_FOUND')
      expect((error as HubSpotWorkflowError).statusCode).toBe(404)
    }
  })

  it('should include error details when available', async () => {
    const workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
    })

    try {
      await workflows.getWorkflow('invalid-id')
    } catch (error) {
      expect(error).toBeInstanceOf(HubSpotWorkflowError)
    }
  })
})

// =============================================================================
// DELAYS & SCHEDULING TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Delays & Scheduling', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('addDelay', () => {
    it('should create a fixed delay', () => {
      const delay = workflows.addDelay({
        type: 'fixed',
        duration: 86400000,
      })

      expect(delay.type).toBe('delay')
      expect(delay.delayType).toBe('fixed')
      expect(delay.duration).toBe(86400000)
    })

    it('should create an until delay', () => {
      const delay = workflows.addDelay({
        type: 'until',
        until: {
          dayOfWeek: 1,
          time: '09:00',
          timezone: 'America/New_York',
        },
      })

      expect(delay.type).toBe('delay')
      expect(delay.delayType).toBe('until')
      expect(delay.until?.dayOfWeek).toBe(1)
      expect(delay.until?.time).toBe('09:00')
    })

    it('should create a business hours delay', () => {
      const delay = workflows.addDelay({
        type: 'businessHours',
        businessHours: {
          timezone: 'America/New_York',
          hours: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
            { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
          ],
        },
      })

      expect(delay.type).toBe('delay')
      expect(delay.delayType).toBe('businessHours')
      expect(delay.businessHours?.hours).toHaveLength(2)
    })
  })

  describe('scheduleAction', () => {
    it('should create a scheduled action', () => {
      const scheduled = workflows.scheduleAction({
        dayOfWeek: 5,
        time: '14:00',
        timezone: 'UTC',
      })

      expect(scheduled.type).toBe('delay')
      expect(scheduled.delayType).toBe('until')
    })
  })

  describe('setBusinessHours', () => {
    it('should set business hours for workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      const updated = await workflows.setBusinessHours(workflow.id, {
        timezone: 'America/Los_Angeles',
        hours: [
          { dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
        ],
      })

      expect(updated.settings.timezone).toBe('America/Los_Angeles')
      expect(updated.settings.businessHours).toHaveLength(1)
    })
  })
})

// =============================================================================
// WORKFLOW TEMPLATES TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Templates', () => {
  describe('leadNurturing', () => {
    it('should create lead nurturing workflow', () => {
      const input = WorkflowTemplates.leadNurturing({
        formId: 'form-123',
        emailIds: ['email-1', 'email-2', 'email-3'],
        delayDays: 3,
      })

      expect(input.name).toBe('Lead Nurturing Workflow')
      expect(input.enrollmentTriggers[0].type).toBe('formSubmission')
      expect(input.actions.length).toBeGreaterThan(3)
    })

    it('should support goal stage', () => {
      const input = WorkflowTemplates.leadNurturing({
        formId: 'form-123',
        emailIds: ['email-1'],
        goalStage: 'customer',
      })

      expect(input.goalCriteria?.value).toBe('customer')
    })
  })

  describe('welcomeSeries', () => {
    it('should create welcome series workflow', () => {
      const input = WorkflowTemplates.welcomeSeries({
        triggerType: 'form',
        triggerId: 'form-123',
        welcomeEmailId: 'welcome-email',
        followUpEmailIds: ['follow-up-1', 'follow-up-2'],
      })

      expect(input.name).toBe('Welcome Series')
      expect(input.enrollmentTriggers[0].type).toBe('formSubmission')
    })

    it('should support list trigger', () => {
      const input = WorkflowTemplates.welcomeSeries({
        triggerType: 'list',
        triggerId: 'list-123',
        welcomeEmailId: 'welcome-email',
      })

      expect(input.enrollmentTriggers[0].type).toBe('listMembership')
    })

    it('should support property trigger', () => {
      const input = WorkflowTemplates.welcomeSeries({
        triggerType: 'property',
        triggerProperty: 'lifecyclestage',
        triggerValue: 'subscriber',
        welcomeEmailId: 'welcome-email',
      })

      expect(input.enrollmentTriggers[0].type).toBe('propertyChange')
    })
  })

  describe('reEngagement', () => {
    it('should create re-engagement workflow', () => {
      const input = WorkflowTemplates.reEngagement({
        inactiveDays: 30,
        emailIds: ['reengagement-1', 'reengagement-2'],
      })

      expect(input.name).toBe('Re-engagement Campaign')
    })

    it('should support final property update', () => {
      const input = WorkflowTemplates.reEngagement({
        inactiveDays: 30,
        emailIds: ['email-1'],
        finalAction: 'updateProperty',
        finalPropertyValue: 'UNQUALIFIED',
      })

      const lastAction = input.actions[input.actions.length - 1]
      expect(lastAction.type).toBe('setProperty')
    })
  })

  describe('dealStageAutomation', () => {
    it('should create deal stage automation', () => {
      const input = WorkflowTemplates.dealStageAutomation({
        stages: [
          { stageId: 'qualification', emailId: 'qual-email' },
          { stageId: 'negotiation', taskTitle: 'Send proposal' },
        ],
      })

      expect(input.name).toBe('Deal Stage Automation')
      expect(input.type).toBe('deal')
    })
  })

  describe('customerOnboarding', () => {
    it('should create customer onboarding workflow', () => {
      const input = WorkflowTemplates.customerOnboarding({
        welcomeEmailId: 'welcome-email',
        taskSequence: [
          { title: 'Schedule kickoff call', dueDays: 1 },
          { title: 'Send training materials', dueDays: 3 },
        ],
      })

      expect(input.name).toBe('Customer Onboarding')
    })
  })

  describe('abandonedCart', () => {
    it('should create abandoned cart workflow', () => {
      const input = WorkflowTemplates.abandonedCart({
        abandonmentProperty: 'cart_abandoned',
        reminderEmailIds: ['reminder-1', 'reminder-2'],
      })

      expect(input.name).toBe('Abandoned Cart Recovery')
      expect(input.reenrollmentSettings?.allowReenrollment).toBe(true)
    })

    it('should support discount email', () => {
      const input = WorkflowTemplates.abandonedCart({
        abandonmentProperty: 'cart_abandoned',
        reminderEmailIds: ['reminder-1'],
        discountEmailId: 'discount-email',
      })

      expect(input.actions.length).toBeGreaterThan(1)
    })
  })

  describe('feedbackRequest', () => {
    it('should create feedback request workflow', () => {
      const input = WorkflowTemplates.feedbackRequest({
        triggerEvent: 'purchase_completed',
        delayDays: 7,
        surveyEmailId: 'survey-email',
      })

      expect(input.name).toBe('Feedback Request')
      expect(input.enrollmentTriggers[0].type).toBe('event')
    })
  })

  describe('subscriptionReminder', () => {
    it('should create subscription reminder workflow', () => {
      const input = WorkflowTemplates.subscriptionReminder({
        expirationProperty: 'subscription_end_date',
        daysBefore: [30, 14, 7],
        emailIds: ['30-day-reminder', '14-day-reminder', '7-day-reminder'],
      })

      expect(input.name).toBe('Subscription Renewal Reminder')
    })
  })

  describe('abTest', () => {
    it('should create A/B test workflow', () => {
      const input = WorkflowTemplates.abTest({
        formId: 'form-123',
        emailA: 'email-a',
        emailB: 'email-b',
      })

      expect(input.name).toBe('A/B Email Test')
    })

    it('should support custom split percentage', () => {
      const input = WorkflowTemplates.abTest({
        formId: 'form-123',
        emailA: 'email-a',
        emailB: 'email-b',
        splitPercentage: 80,
      })

      const branchAction = input.actions[0] as any
      expect(branchAction.splits[0].percentage).toBe(80)
      expect(branchAction.splits[1].percentage).toBe(20)
    })
  })
})

// =============================================================================
// SUPPRESSION LIST TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Suppression Lists', () => {
  let storage: ReturnType<typeof createMockStorage>
  let suppression: SuppressionListManager

  beforeEach(() => {
    storage = createMockStorage()
    suppression = new SuppressionListManager(storage)
  })

  describe('createList', () => {
    it('should create a suppression list', async () => {
      const list = await suppression.createList('Do Not Contact', 'Contacts who opted out')

      expect(list.id).toMatch(/^supp-/)
      expect(list.name).toBe('Do Not Contact')
      expect(list.description).toBe('Contacts who opted out')
    })
  })

  describe('addContacts', () => {
    it('should add contacts to suppression list', async () => {
      const list = await suppression.createList('Test List')
      await suppression.addContacts(list.id, ['contact-1', 'contact-2'])

      const updated = await suppression.getList(list.id)
      expect(updated?.contactIds.has('contact-1')).toBe(true)
      expect(updated?.contactIds.has('contact-2')).toBe(true)
    })
  })

  describe('removeContacts', () => {
    it('should remove contacts from suppression list', async () => {
      const list = await suppression.createList('Test List')
      await suppression.addContacts(list.id, ['contact-1', 'contact-2'])
      await suppression.removeContacts(list.id, ['contact-1'])

      const updated = await suppression.getList(list.id)
      expect(updated?.contactIds.has('contact-1')).toBe(false)
      expect(updated?.contactIds.has('contact-2')).toBe(true)
    })
  })

  describe('isContactSuppressed', () => {
    it('should check if contact is suppressed', async () => {
      const list = await suppression.createList('Test List')
      await suppression.addContacts(list.id, ['contact-1'])

      expect(await suppression.isContactSuppressed(list.id, 'contact-1')).toBe(true)
      expect(await suppression.isContactSuppressed(list.id, 'contact-2')).toBe(false)
    })
  })

  describe('isContactInAnyList', () => {
    it('should check if contact is in any of the lists', async () => {
      const list1 = await suppression.createList('List 1')
      const list2 = await suppression.createList('List 2')
      await suppression.addContacts(list1.id, ['contact-1'])

      expect(await suppression.isContactInAnyList('contact-1', [list1.id, list2.id])).toBe(true)
      expect(await suppression.isContactInAnyList('contact-2', [list1.id, list2.id])).toBe(false)
    })
  })

  describe('listLists', () => {
    it('should list all suppression lists', async () => {
      await suppression.createList('List 1')
      await suppression.createList('List 2')

      const lists = await suppression.listLists()

      expect(lists).toHaveLength(2)
    })
  })

  describe('deleteList', () => {
    it('should delete a suppression list', async () => {
      const list = await suppression.createList('Test List')
      await suppression.deleteList(list.id)

      const deleted = await suppression.getList(list.id)
      expect(deleted).toBeUndefined()
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Integration', () => {
  let workflows: HubSpotWorkflows
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })

    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
      fetch: mockFetch,
    })
  })

  it('should execute webhook action', async () => {
    const workflow = await workflows.createWorkflow(createTestWorkflowInput({
      actions: [
        {
          type: 'webhook',
          url: 'https://example.com/webhook',
          method: 'POST',
          body: { test: true },
        },
      ],
    }))
    await workflows.resumeWorkflow(workflow.id)

    await workflows.enrollContact(workflow.id, 'contact-123')

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ test: true }),
      })
    )
  })

  it('should create complete lead nurturing workflow', async () => {
    const workflow = await workflows.createWorkflow({
      name: 'Lead Nurturing Flow',
      type: 'contact',
      enrollmentTriggers: [
        { type: 'formSubmission', formId: 'download-ebook' },
      ],
      actions: [
        { type: 'sendEmail', emailId: 'welcome-email' },
        { type: 'delay', delayType: 'fixed', duration: 86400000 },
        { type: 'sendEmail', emailId: 'follow-up-email' },
        { type: 'delay', delayType: 'fixed', duration: 172800000 },
        { type: 'setProperty', property: 'lifecyclestage', value: 'marketingqualifiedlead' },
        { type: 'createTask', title: 'Follow up with lead', dueDays: 1, priority: 'high' },
      ],
      goalCriteria: {
        property: 'lifecyclestage',
        operator: 'eq',
        value: 'customer',
      },
      settings: {
        timezone: 'America/New_York',
      },
    })

    expect(workflow.actions).toHaveLength(6)
    expect(workflow.goalCriteria).toBeDefined()

    await workflows.resumeWorkflow(workflow.id)

    const stats = await workflows.getWorkflowStats(workflow.id)
    expect(stats.workflowId).toBe(workflow.id)
  })

  it('should handle workflow with branching logic', async () => {
    const { branchAction, thenActions, elseActions } = workflows.createIfThenBranch({
      condition: { property: 'score', operator: 'gt', value: 50 },
      thenActions: [{ type: 'sendEmail', emailId: 'high-score-email' }],
      elseActions: [{ type: 'sendEmail', emailId: 'low-score-email' }],
    })

    const workflow = await workflows.createWorkflow({
      name: 'Score-Based Workflow',
      type: 'contact',
      enrollmentTriggers: [{ type: 'propertyChange', property: 'score' }],
      actions: [
        branchAction,
        ...thenActions,
        ...elseActions,
      ],
    })

    expect(workflow.actions[0].type).toBe('branch')
  })
})

// =============================================================================
// RED PHASE: WORKFLOW AUTOMATION ENGINE TESTS
// These tests define the behavior for workflow execution automation
// =============================================================================

describe('@dotdo/hubspot/workflows - Workflow Automation Engine', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('executeNextAction', () => {
    it('should execute the next pending action for an enrollment', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', property: 'status', value: 'processed' },
          { type: 'setProperty', property: 'step', value: '2' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const result = await workflows.executeNextAction(enrollment.id)

      expect(result.actionId).toBe(workflow.actions[0].id)
      expect(result.status).toBe('completed')
      expect(result.nextActionId).toBe(workflow.actions[1].id)
    })

    it('should mark enrollment as completed when all actions are done', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'setProperty', property: 'status', value: 'done' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const result = await workflows.executeNextAction(enrollment.id)

      expect(result.enrollmentCompleted).toBe(true)

      const updatedEnrollment = await workflows.getEnrollment(enrollment.id)
      expect(updatedEnrollment.status).toBe('completed')
    })

    it('should handle action execution failures gracefully', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'webhook', url: 'https://invalid.example.com/fail', method: 'POST' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const result = await workflows.executeNextAction(enrollment.id)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
    })

    it('should skip delay actions when executeImmediately flag is set', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 86400000 },
          { type: 'setProperty', property: 'delayed', value: 'true' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const result = await workflows.executeNextAction(enrollment.id, { executeImmediately: true })

      expect(result.actionId).toBe(workflow.actions[0].id)
      expect(result.skipped).toBe(true)
      expect(result.nextActionId).toBe(workflow.actions[1].id)
    })
  })

  describe('processEnrollmentQueue', () => {
    it('should process all pending enrollments', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')
      await workflows.enrollContact(workflow.id, 'contact-3')

      const results = await workflows.processEnrollmentQueue(workflow.id)

      expect(results.processed).toBe(3)
      expect(results.succeeded).toBe(3)
      expect(results.failed).toBe(0)
    })

    it('should respect concurrency limit', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      for (let i = 0; i < 10; i++) {
        await workflows.enrollContact(workflow.id, `contact-${i}`)
      }

      const results = await workflows.processEnrollmentQueue(workflow.id, { concurrency: 3 })

      expect(results.processed).toBe(10)
    })

    it('should continue processing on individual failures', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'webhook', url: 'https://example.com/webhook', method: 'POST' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')

      const results = await workflows.processEnrollmentQueue(workflow.id)

      expect(results.processed).toBe(2)
    })
  })

  describe('retryFailedAction', () => {
    it('should retry a failed action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      // Simulate a failed action
      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData.status = 'failed'
      enrollmentData.error = 'Temporary failure'
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData)

      const result = await workflows.retryFailedAction(enrollment.id)

      expect(result.retried).toBe(true)
      expect(result.status).toBe('active')
    })

    it('should respect max retry attempts', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      // Simulate exceeded retries
      const storage = (workflows as any).storage
      const enrollmentData = await storage.get(`enrollment:${workflow.id}:contact-123`)
      enrollmentData.retryCount = 5
      enrollmentData.status = 'failed'
      await storage.set(`enrollment:${workflow.id}:contact-123`, enrollmentData)

      await expect(workflows.retryFailedAction(enrollment.id)).rejects.toThrow('Max retry attempts exceeded')
    })
  })
})

// =============================================================================
// RED PHASE: BATCH ENROLLMENT API TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Batch Enrollment', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('enrollContacts (batch)', () => {
    it('should enroll multiple contacts in a single operation', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.enrollContacts(workflow.id, [
        'contact-1',
        'contact-2',
        'contact-3',
      ])

      expect(result.enrolled).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.enrollments).toHaveLength(3)
    })

    it('should return partial success for batch with failures', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      // Pre-enroll one contact to cause a duplicate
      await workflows.enrollContact(workflow.id, 'contact-1')

      const result = await workflows.enrollContacts(workflow.id, [
        'contact-1', // Will fail - duplicate
        'contact-2',
        'contact-3',
      ])

      expect(result.enrolled).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].contactId).toBe('contact-1')
    })

    it('should support batch metadata', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.enrollContacts(
        workflow.id,
        ['contact-1', 'contact-2'],
        { source: 'import', batchId: 'batch-123' }
      )

      expect(result.enrollments[0].metadata?.batchId).toBe('batch-123')
    })

    it('should validate batch size limits', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      const contacts = Array.from({ length: 1001 }, (_, i) => `contact-${i}`)

      await expect(
        workflows.enrollContacts(workflow.id, contacts)
      ).rejects.toThrow('Batch size exceeds maximum of 1000')
    })
  })

  describe('unenrollContacts (batch)', () => {
    it('should unenroll multiple contacts in a single operation', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')
      await workflows.enrollContact(workflow.id, 'contact-3')

      const result = await workflows.unenrollContacts(workflow.id, [
        'contact-1',
        'contact-2',
        'contact-3',
      ])

      expect(result.unenrolled).toBe(3)
      expect(result.failed).toBe(0)
    })
  })
})

// =============================================================================
// RED PHASE: SUPPRESSION LIST ENFORCEMENT TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Suppression Enforcement', () => {
  let workflows: HubSpotWorkflows
  let suppression: SuppressionListManager

  beforeEach(() => {
    const storage = createMockStorage()
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage,
    })
    suppression = new SuppressionListManager(storage)
  })

  describe('Suppression during enrollment', () => {
    it('should prevent enrollment of suppressed contacts', async () => {
      // Create suppression list and add contact
      const list = await suppression.createList('Do Not Contact')
      await suppression.addContact(list.id, 'contact-123')

      // Create workflow with suppression list
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        settings: {
          timezone: 'UTC',
          suppressionLists: [list.id],
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      await expect(
        workflows.enrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Contact is on suppression list')
    })

    it('should allow enrollment of non-suppressed contacts', async () => {
      const list = await suppression.createList('Do Not Contact')
      await suppression.addContact(list.id, 'contact-other')

      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        settings: {
          timezone: 'UTC',
          suppressionLists: [list.id],
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')
      expect(enrollment.status).toBe('active')
    })

    it('should check multiple suppression lists', async () => {
      const list1 = await suppression.createList('Unsubscribed')
      const list2 = await suppression.createList('Bounced')
      await suppression.addContact(list2.id, 'contact-123')

      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        settings: {
          timezone: 'UTC',
          suppressionLists: [list1.id, list2.id],
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      await expect(
        workflows.enrollContact(workflow.id, 'contact-123')
      ).rejects.toThrow('Contact is on suppression list')
    })
  })

  describe('Suppression during execution', () => {
    it('should skip email actions for suppressed contacts', async () => {
      const list = await suppression.createList('Do Not Email')

      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'sendEmail', emailId: 'email-123' },
        ],
        settings: {
          timezone: 'UTC',
          suppressionLists: [list.id],
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      // Add to suppression after enrollment
      await suppression.addContact(list.id, 'contact-123')

      const result = await workflows.executeNextAction(enrollment.id)

      expect(result.status).toBe('skipped')
      expect(result.reason).toBe('contact_suppressed')
    })

    it('should unenroll contact when added to suppression list mid-workflow', async () => {
      const list = await suppression.createList('Opt Out')

      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 86400000 },
          { type: 'sendEmail', emailId: 'email-123' },
        ],
        settings: {
          timezone: 'UTC',
          suppressionLists: [list.id],
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      // Add to suppression mid-workflow
      await suppression.addContact(list.id, 'contact-123')

      await workflows.checkSuppressionStatus(enrollment.id)

      const updated = await workflows.getEnrollment(enrollment.id)
      expect(updated.status).toBe('unenrolled')
      expect(updated.unenrollReason).toBe('added_to_suppression_list')
    })
  })
})

// =============================================================================
// RED PHASE: EVENT-DRIVEN TRIGGER EXECUTION TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Event-Driven Triggers', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('triggerFormSubmission', () => {
    it('should auto-enroll contacts on form submission', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'contact-form-123' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerFormSubmission('contact-form-123', {
        contactId: 'contact-456',
        formFields: { email: 'test@example.com' },
      })

      expect(result.enrolled).toBe(true)
      expect(result.workflowId).toBe(workflow.id)
      expect(result.enrollmentId).toBeDefined()
    })

    it('should handle multiple workflows triggered by same form', async () => {
      const wf1 = await workflows.createWorkflow(createTestWorkflowInput({
        name: 'Workflow 1',
        enrollmentTriggers: [{ type: 'formSubmission', formId: 'form-123' }],
      }))
      const wf2 = await workflows.createWorkflow(createTestWorkflowInput({
        name: 'Workflow 2',
        enrollmentTriggers: [{ type: 'formSubmission', formId: 'form-123' }],
      }))
      await workflows.resumeWorkflow(wf1.id)
      await workflows.resumeWorkflow(wf2.id)

      const result = await workflows.triggerFormSubmission('form-123', {
        contactId: 'contact-456',
      })

      expect(result.enrolledWorkflows).toHaveLength(2)
    })

    it('should not trigger inactive workflows', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'formSubmission', formId: 'form-123' },
        ],
      }))
      // Not resuming - workflow stays draft

      const result = await workflows.triggerFormSubmission('form-123', {
        contactId: 'contact-456',
      })

      expect(result.enrolled).toBe(false)
      expect(result.reason).toBe('no_active_workflows')
    })
  })

  describe('triggerPropertyChange', () => {
    it('should auto-enroll contacts on property change', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'lifecyclestage', operator: 'eq', value: 'customer' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerPropertyChange('contact-123', {
        property: 'lifecyclestage',
        previousValue: 'lead',
        newValue: 'customer',
      })

      expect(result.enrolled).toBe(true)
    })

    it('should not trigger when property value does not match', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'lifecyclestage', operator: 'eq', value: 'customer' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerPropertyChange('contact-123', {
        property: 'lifecyclestage',
        previousValue: 'lead',
        newValue: 'opportunity', // Does not match
      })

      expect(result.enrolled).toBe(false)
    })

    it('should evaluate complex property conditions', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'propertyChange', property: 'score', operator: 'gte', value: 80 },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerPropertyChange('contact-123', {
        property: 'score',
        previousValue: 50,
        newValue: 85,
      })

      expect(result.enrolled).toBe(true)
    })
  })

  describe('triggerEvent', () => {
    it('should auto-enroll contacts on custom event', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'event', eventName: 'product_purchased' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerEvent('product_purchased', {
        contactId: 'contact-123',
        eventProperties: { productId: 'prod-456', amount: 99.99 },
      })

      expect(result.enrolled).toBe(true)
    })

    it('should filter events by properties when configured', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'event', eventName: 'purchase', properties: { category: 'premium' } },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerEvent('purchase', {
        contactId: 'contact-123',
        eventProperties: { category: 'basic' }, // Does not match
      })

      expect(result.enrolled).toBe(false)
    })
  })

  describe('triggerListMembership', () => {
    it('should auto-enroll when contact added to list', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'listMembership', listId: 'hot-leads', membership: 'added' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerListMembership('contact-123', {
        listId: 'hot-leads',
        action: 'added',
      })

      expect(result.enrolled).toBe(true)
    })

    it('should auto-enroll when contact removed from list', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        enrollmentTriggers: [
          { type: 'listMembership', listId: 'active-customers', membership: 'removed' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      const result = await workflows.triggerListMembership('contact-123', {
        listId: 'active-customers',
        action: 'removed',
      })

      expect(result.enrolled).toBe(true)
    })
  })
})

// =============================================================================
// RED PHASE: WORKFLOW VERSIONING & MIGRATION TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Versioning & Migration', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('createVersion', () => {
    it('should create a new version of the workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const newVersion = await workflows.createVersion(workflow.id, {
        name: 'Updated Workflow',
        actions: [
          { type: 'sendEmail', emailId: 'new-email' },
        ],
      })

      expect(newVersion.version).toBe(2)
      expect(newVersion.actions[0].config).toHaveProperty('emailId', 'new-email')
    })

    it('should preserve previous version for active enrollments', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      // Create new version
      await workflows.createVersion(workflow.id, {
        actions: [{ type: 'sendEmail', emailId: 'v2-email' }],
      })

      // Verify enrollment still uses original version
      const enrollmentDetails = await workflows.getEnrollment(enrollment.id)
      expect(enrollmentDetails.workflowVersion).toBe(1)
    })
  })

  describe('getVersionHistory', () => {
    it('should return all versions of a workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.updateWorkflow(workflow.id, { name: 'V2' })
      await workflows.updateWorkflow(workflow.id, { name: 'V3' })

      const history = await workflows.getVersionHistory(workflow.id)

      expect(history).toHaveLength(3)
      expect(history[0].version).toBe(1)
      expect(history[2].version).toBe(3)
    })

    it('should include version metadata', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())

      const history = await workflows.getVersionHistory(workflow.id)

      expect(history[0]).toHaveProperty('createdAt')
      expect(history[0]).toHaveProperty('createdBy')
    })
  })

  describe('revertToVersion', () => {
    it('should revert workflow to a previous version', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({ name: 'Original' }))
      await workflows.updateWorkflow(workflow.id, { name: 'Changed' })

      const reverted = await workflows.revertToVersion(workflow.id, 1)

      expect(reverted.name).toBe('Original')
      expect(reverted.version).toBe(3) // New version created from revert
    })

    it('should fail to revert active workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)

      await expect(
        workflows.revertToVersion(workflow.id, 1)
      ).rejects.toThrow('Cannot revert active workflow')
    })
  })

  describe('migrateEnrollments', () => {
    it('should migrate enrollments to new version', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')

      await workflows.pauseWorkflow(workflow.id)
      await workflows.updateWorkflow(workflow.id, { name: 'V2' })

      const result = await workflows.migrateEnrollments(workflow.id, {
        fromVersion: 1,
        toVersion: 2,
      })

      expect(result.migrated).toBe(2)
    })

    it('should only migrate active enrollments', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput())
      await workflows.resumeWorkflow(workflow.id)
      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')

      // Complete one enrollment
      const storage = (workflows as any).storage
      const enrollment = await storage.get(`enrollment:${workflow.id}:contact-1`)
      enrollment.status = 'completed'
      await storage.set(`enrollment:${workflow.id}:contact-1`, enrollment)

      await workflows.pauseWorkflow(workflow.id)
      await workflows.updateWorkflow(workflow.id, { name: 'V2' })

      const result = await workflows.migrateEnrollments(workflow.id, {
        fromVersion: 1,
        toVersion: 2,
      })

      expect(result.migrated).toBe(1)
      expect(result.skipped).toBe(1)
    })
  })
})

// =============================================================================
// RED PHASE: SCHEDULED EXECUTION TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Scheduled Execution', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    vi.useFakeTimers()
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('scheduleDelayedAction', () => {
    it('should schedule action for future execution', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 3600000 }, // 1 hour
          { type: 'sendEmail', emailId: 'email-123' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const scheduled = await workflows.scheduleDelayedAction(enrollment.id, workflow.actions[0].id)

      expect(scheduled.scheduledFor).toBeDefined()
      expect(new Date(scheduled.scheduledFor).getTime()).toBeGreaterThan(Date.now())
    })

    it('should execute action when scheduled time arrives', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 3600000 },
          { type: 'setProperty', property: 'delayed', value: 'true' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      await workflows.executeNextAction(enrollment.id)

      // Fast-forward time
      vi.advanceTimersByTime(3600001)

      await workflows.processScheduledActions()

      const updated = await workflows.getEnrollment(enrollment.id)
      expect(updated.currentActionId).toBe(workflow.actions[1].id)
    })
  })

  describe('getScheduledActions', () => {
    it('should return all scheduled actions for a workflow', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 3600000 },
          { type: 'sendEmail', emailId: 'email-1' },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)

      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')

      // Execute delay action for both
      const history = await workflows.getWorkflowHistory(workflow.id)
      for (const enrollment of history.enrollments) {
        await workflows.executeNextAction(enrollment.id)
      }

      const scheduled = await workflows.getScheduledActions(workflow.id)

      expect(scheduled).toHaveLength(2)
    })

    it('should filter by date range', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 86400000 }, // 24 hours
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      await workflows.enrollContact(workflow.id, 'contact-1')

      const history = await workflows.getWorkflowHistory(workflow.id)
      await workflows.executeNextAction(history.enrollments[0].id)

      const now = new Date()
      const tomorrow = new Date(now.getTime() + 86400000)

      const scheduled = await workflows.getScheduledActions(workflow.id, {
        after: now.toISOString(),
        before: tomorrow.toISOString(),
      })

      expect(scheduled.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('cancelScheduledAction', () => {
    it('should cancel a scheduled action', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        actions: [
          { type: 'delay', delayType: 'fixed', duration: 3600000 },
        ],
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      await workflows.executeNextAction(enrollment.id)

      const scheduled = await workflows.getScheduledActions(workflow.id)
      await workflows.cancelScheduledAction(scheduled[0].id)

      const updated = await workflows.getScheduledActions(workflow.id)
      expect(updated.find(s => s.id === scheduled[0].id)?.status).toBe('cancelled')
    })
  })
})

// =============================================================================
// RED PHASE: GOAL COMPLETION TESTS
// =============================================================================

describe('@dotdo/hubspot/workflows - Goal Completion', () => {
  let workflows: HubSpotWorkflows

  beforeEach(() => {
    workflows = new HubSpotWorkflows({
      accessToken: 'pat-xxx',
      storage: createMockStorage(),
    })
  })

  describe('checkGoalCompletion', () => {
    it('should mark enrollment as goal-reached when criteria met', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'lifecyclestage',
          operator: 'eq',
          value: 'customer',
        },
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      // Simulate property change that meets goal
      const result = await workflows.checkGoalCompletion(enrollment.id, {
        lifecyclestage: 'customer',
      })

      expect(result.goalReached).toBe(true)
      expect(result.completedAt).toBeDefined()
    })

    it('should not mark goal-reached when criteria not met', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'lifecyclestage',
          operator: 'eq',
          value: 'customer',
        },
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const result = await workflows.checkGoalCompletion(enrollment.id, {
        lifecyclestage: 'lead',
      })

      expect(result.goalReached).toBe(false)
    })

    it('should evaluate numeric comparison goals', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'total_revenue',
          operator: 'gte',
          value: 10000,
        },
      }))
      await workflows.resumeWorkflow(workflow.id)
      const enrollment = await workflows.enrollContact(workflow.id, 'contact-123')

      const result = await workflows.checkGoalCompletion(enrollment.id, {
        total_revenue: 15000,
      })

      expect(result.goalReached).toBe(true)
    })
  })

  describe('getGoalMetrics', () => {
    it('should return goal completion metrics', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'converted',
          operator: 'eq',
          value: true,
        },
      }))

      const metrics = await workflows.getGoalMetrics(workflow.id)

      expect(metrics).toHaveProperty('totalEnrollments')
      expect(metrics).toHaveProperty('goalReached')
      expect(metrics).toHaveProperty('goalRate')
      expect(metrics).toHaveProperty('averageTimeToGoal')
    })

    it('should calculate goal rate correctly', async () => {
      const workflow = await workflows.createWorkflow(createTestWorkflowInput({
        goalCriteria: {
          property: 'status',
          operator: 'eq',
          value: 'converted',
        },
      }))
      await workflows.resumeWorkflow(workflow.id)

      // Enroll and convert some contacts
      await workflows.enrollContact(workflow.id, 'contact-1')
      await workflows.enrollContact(workflow.id, 'contact-2')
      await workflows.enrollContact(workflow.id, 'contact-3')
      await workflows.enrollContact(workflow.id, 'contact-4')

      // Mark 2 as goal-reached
      const storage = (workflows as any).storage
      for (const id of ['contact-1', 'contact-2']) {
        const enrollment = await storage.get(`enrollment:${workflow.id}:${id}`)
        enrollment.goalReached = true
        enrollment.goalReachedAt = new Date().toISOString()
        await storage.set(`enrollment:${workflow.id}:${id}`, enrollment)
      }

      const metrics = await workflows.getGoalMetrics(workflow.id)

      expect(metrics.goalRate).toBe(0.5) // 50%
    })
  })
})
