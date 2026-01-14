/**
 * @dotdo/close/sequences - Sales Sequences Tests
 *
 * Tests for multi-step sales outreach sequences with email, call, LinkedIn steps.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SequenceClient,
  SequenceError,
  type SequenceTemplate,
  type SequenceEnrollment,
  type EmailStep,
  type CallStep,
  type LinkedInStep,
  type SMSStep,
  type TaskStep,
} from '../sequences'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockStorage(): Map<string, unknown> {
  return new Map()
}

// =============================================================================
// Client Initialization Tests
// =============================================================================

describe('@dotdo/close/sequences - Client', () => {
  describe('initialization', () => {
    it('should create a SequenceClient instance', () => {
      const storage = createMockStorage()
      const client = new SequenceClient({ storage })

      expect(client).toBeDefined()
      expect(client.templates).toBeDefined()
      expect(client.enrollments).toBeDefined()
    })
  })
})

// =============================================================================
// Templates Tests
// =============================================================================

describe('@dotdo/close/sequences - Templates', () => {
  let client: SequenceClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new SequenceClient({ storage })
  })

  describe('create', () => {
    it('should create a sequence template with email steps', async () => {
      const template = await client.templates.create({
        name: 'Cold Outreach',
        steps: [
          { type: 'email', delay: 0, subject: 'Quick question', body: 'Hi {{name}}...' },
          { type: 'email', delay: 3, subject: 'Following up', body: 'Just checking in...' },
        ],
      })

      expect(template.id).toBeDefined()
      expect(template.id).toMatch(/^seqt_/)
      expect(template.name).toBe('Cold Outreach')
      expect(template.steps).toHaveLength(2)
      expect(template.steps[0].step).toBe(1)
      expect(template.steps[1].step).toBe(2)
      expect(template.active).toBe(true)
    })

    it('should create a multi-channel sequence template', async () => {
      const template = await client.templates.create({
        name: 'Enterprise Outreach',
        description: 'Multi-touch enterprise sales sequence',
        steps: [
          { type: 'email', delay: 0, subject: 'Introduction', body: 'Hi {{name}}...' },
          { type: 'linkedin', delay: 2, action: 'connect', message: 'Hi {{name}}...' },
          { type: 'call', delay: 5, note: 'Discovery call attempt' },
          { type: 'email', delay: 7, subject: 'Follow up', body: 'Following up...' },
          { type: 'sms', delay: 10, text: 'Hi {{name}}, quick note...' },
        ],
        tags: ['enterprise', 'multi-channel'],
        exitConditions: [
          { type: 'reply' },
          { type: 'meeting_booked' },
        ],
      })

      expect(template.steps).toHaveLength(5)
      expect(template.steps[0].type).toBe('email')
      expect(template.steps[1].type).toBe('linkedin')
      expect(template.steps[2].type).toBe('call')
      expect(template.steps[3].type).toBe('email')
      expect(template.steps[4].type).toBe('sms')
      expect(template.tags).toContain('enterprise')
      expect(template.exitConditions).toHaveLength(2)
    })

    it('should create a sequence with default variables', async () => {
      const template = await client.templates.create({
        name: 'Personalized Outreach',
        steps: [
          { type: 'email', delay: 0, subject: 'From {{sender_name}}', body: 'Hi {{name}}...' },
        ],
        defaultVariables: {
          sender_name: 'John',
          company_name: 'Acme Corp',
        },
      })

      expect(template.defaultVariables).toBeDefined()
      expect(template.defaultVariables?.sender_name).toBe('John')
    })

    it('should auto-number steps', async () => {
      const template = await client.templates.create({
        name: 'Test Sequence',
        steps: [
          { type: 'email', delay: 0, subject: 'Step 1', body: 'First...' },
          { type: 'call', delay: 2, note: 'Step 2' },
          { type: 'email', delay: 4, subject: 'Step 3', body: 'Third...' },
        ],
      })

      expect(template.steps[0].step).toBe(1)
      expect(template.steps[1].step).toBe(2)
      expect(template.steps[2].step).toBe(3)
    })

    it('should initialize stats', async () => {
      const template = await client.templates.create({
        name: 'Stats Test',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
      })

      expect(template.stats).toBeDefined()
      expect(template.stats?.totalEnrolled).toBe(0)
      expect(template.stats?.activeEnrollments).toBe(0)
      expect(template.stats?.emailsSent).toBe(0)
    })
  })

  describe('get', () => {
    it('should get a template by ID', async () => {
      const created = await client.templates.create({
        name: 'Test Sequence',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
      })

      const retrieved = await client.templates.get(created.id)
      expect(retrieved?.name).toBe('Test Sequence')
    })

    it('should return null for non-existent template', async () => {
      const template = await client.templates.get('seqt_nonexistent')
      expect(template).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a template name', async () => {
      const created = await client.templates.create({
        name: 'Original Name',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
      })

      const updated = await client.templates.update(created.id, {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
    })

    it('should update steps and renumber them', async () => {
      const created = await client.templates.create({
        name: 'Test',
        steps: [
          { type: 'email', delay: 0, subject: 'A', body: 'A...' },
          { type: 'email', delay: 3, subject: 'B', body: 'B...' },
        ],
      })

      const updated = await client.templates.update(created.id, {
        steps: [
          { type: 'email', delay: 0, subject: 'X', body: 'X...' },
          { type: 'call', delay: 2, note: 'Y' },
          { type: 'email', delay: 5, subject: 'Z', body: 'Z...' },
        ],
      })

      expect(updated.steps).toHaveLength(3)
      expect(updated.steps[0].step).toBe(1)
      expect(updated.steps[1].step).toBe(2)
      expect(updated.steps[2].step).toBe(3)
    })

    it('should deactivate a template', async () => {
      const created = await client.templates.create({
        name: 'Active Template',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
      })

      const updated = await client.templates.update(created.id, { active: false })
      expect(updated.active).toBe(false)
    })

    it('should throw for non-existent template', async () => {
      await expect(
        client.templates.update('seqt_nonexistent', { name: 'Test' })
      ).rejects.toThrow(SequenceError)
    })
  })

  describe('delete', () => {
    it('should delete a template', async () => {
      const created = await client.templates.create({
        name: 'To Delete',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
      })

      await client.templates.delete(created.id)
      const deleted = await client.templates.get(created.id)
      expect(deleted).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await client.templates.create({
        name: 'Template 1',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
        active: true,
        tags: ['sales'],
      })
      await client.templates.create({
        name: 'Template 2',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
        active: false,
        tags: ['marketing'],
      })
      await client.templates.create({
        name: 'Template 3',
        steps: [{ type: 'email', delay: 0, subject: 'Test', body: 'Test...' }],
        active: true,
        tags: ['sales', 'enterprise'],
      })
    })

    it('should list all templates', async () => {
      const result = await client.templates.list()
      expect(result.data).toHaveLength(3)
    })

    it('should filter by active status', async () => {
      const activeResult = await client.templates.list({ active: true })
      expect(activeResult.data).toHaveLength(2)
      expect(activeResult.data.every(t => t.active)).toBe(true)

      const inactiveResult = await client.templates.list({ active: false })
      expect(inactiveResult.data).toHaveLength(1)
    })

    it('should filter by tags', async () => {
      const salesResult = await client.templates.list({ tags: ['sales'] })
      expect(salesResult.data).toHaveLength(2)
    })

    it('should support pagination', async () => {
      const result = await client.templates.list({ _skip: 0, _limit: 2 })
      expect(result.data).toHaveLength(2)
      expect(result.has_more).toBe(true)
    })
  })

  describe('duplicate', () => {
    it('should duplicate a template', async () => {
      const original = await client.templates.create({
        name: 'Original',
        steps: [
          { type: 'email', delay: 0, subject: 'Test', body: 'Test...' },
          { type: 'call', delay: 3, note: 'Call' },
        ],
        tags: ['test'],
      })

      const copy = await client.templates.duplicate(original.id, 'Copy of Original')

      expect(copy.id).not.toBe(original.id)
      expect(copy.name).toBe('Copy of Original')
      expect(copy.steps).toHaveLength(2)
      expect(copy.active).toBe(false) // Copies start inactive
    })
  })
})

// =============================================================================
// Enrollments Tests
// =============================================================================

describe('@dotdo/close/sequences - Enrollments', () => {
  let client: SequenceClient
  let storage: Map<string, unknown>
  let template: SequenceTemplate

  beforeEach(async () => {
    storage = createMockStorage()
    client = new SequenceClient({ storage })

    // Create a test template
    template = await client.templates.create({
      name: 'Test Sequence',
      steps: [
        { type: 'email', delay: 0, subject: 'Hi {{name}}', body: 'Hello {{name}} from {{company}}...' },
        { type: 'call', delay: 3, note: 'Follow-up call' },
        { type: 'email', delay: 5, subject: 'Following up', body: 'Just checking in...' },
      ],
      defaultVariables: {
        company: 'Acme Corp',
      },
    })
  })

  describe('create', () => {
    it('should enroll a contact in a sequence', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
        variables: { name: 'John' },
      })

      expect(enrollment.id).toBeDefined()
      expect(enrollment.id).toMatch(/^seqe_/)
      expect(enrollment.templateId).toBe(template.id)
      expect(enrollment.templateName).toBe('Test Sequence')
      expect(enrollment.contactId).toBe('cont_abc123')
      expect(enrollment.leadId).toBe('lead_xyz456')
      expect(enrollment.currentStep).toBe(1)
      expect(enrollment.status).toBe('active')
      expect(enrollment.variables.name).toBe('John')
      expect(enrollment.variables.company).toBe('Acme Corp') // From defaults
      expect(enrollment.nextStepAt).toBeDefined()
    })

    it('should prevent duplicate active enrollments', async () => {
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      try {
        await client.enrollments.create({
          templateId: template.id,
          contactId: 'cont_abc123',
          leadId: 'lead_xyz456',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SequenceError)
        expect((error as SequenceError).errorCode).toBe('ALREADY_ENROLLED')
      }
    })

    it('should throw for non-existent template', async () => {
      try {
        await client.enrollments.create({
          templateId: 'seqt_nonexistent',
          contactId: 'cont_abc123',
          leadId: 'lead_xyz456',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SequenceError)
        expect((error as SequenceError).errorCode).toBe('TEMPLATE_NOT_FOUND')
      }
    })

    it('should throw for inactive template', async () => {
      await client.templates.update(template.id, { active: false })

      try {
        await client.enrollments.create({
          templateId: template.id,
          contactId: 'cont_abc123',
          leadId: 'lead_xyz456',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SequenceError)
        expect((error as SequenceError).errorCode).toBe('TEMPLATE_INACTIVE')
      }
    })

    it('should update template stats on enrollment', async () => {
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const updated = await client.templates.get(template.id)
      expect(updated?.stats?.totalEnrolled).toBe(1)
      expect(updated?.stats?.activeEnrollments).toBe(1)
    })
  })

  describe('get', () => {
    it('should get an enrollment by ID', async () => {
      const created = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const retrieved = await client.enrollments.get(created.id)
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent enrollment', async () => {
      const enrollment = await client.enrollments.get('seqe_nonexistent')
      expect(enrollment).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_1',
        leadId: 'lead_1',
      })
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_2',
        leadId: 'lead_1',
      })
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_3',
        leadId: 'lead_2',
      })
    })

    it('should list all enrollments', async () => {
      const result = await client.enrollments.list()
      expect(result.data).toHaveLength(3)
    })

    it('should filter by template', async () => {
      const result = await client.enrollments.list({ templateId: template.id })
      expect(result.data).toHaveLength(3)
    })

    it('should filter by lead', async () => {
      const result = await client.enrollments.list({ leadId: 'lead_1' })
      expect(result.data).toHaveLength(2)
    })

    it('should filter by status', async () => {
      const result = await client.enrollments.list({ status: 'active' })
      expect(result.data).toHaveLength(3)
    })
  })

  describe('bulkEnroll', () => {
    it('should enroll multiple contacts', async () => {
      const enrollments = await client.enrollments.bulkEnroll({
        templateId: template.id,
        contacts: [
          { contactId: 'cont_1', leadId: 'lead_1', variables: { name: 'Alice' } },
          { contactId: 'cont_2', leadId: 'lead_2', variables: { name: 'Bob' } },
          { contactId: 'cont_3', leadId: 'lead_3', variables: { name: 'Carol' } },
        ],
      })

      expect(enrollments).toHaveLength(3)
    })

    it('should skip already enrolled contacts', async () => {
      // Enroll one first
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_1',
        leadId: 'lead_1',
      })

      // Bulk enroll including the existing one
      const enrollments = await client.enrollments.bulkEnroll({
        templateId: template.id,
        contacts: [
          { contactId: 'cont_1', leadId: 'lead_1' }, // Already enrolled
          { contactId: 'cont_2', leadId: 'lead_2' },
        ],
      })

      expect(enrollments).toHaveLength(1)
      expect(enrollments[0].contactId).toBe('cont_2')
    })
  })

  describe('pause and resume', () => {
    it('should pause an enrollment', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const paused = await client.enrollments.pause(enrollment.id, 'Out of office')

      expect(paused.status).toBe('paused')
      expect(paused.pauseReason).toBe('Out of office')
    })

    it('should resume a paused enrollment', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      await client.enrollments.pause(enrollment.id)
      const resumed = await client.enrollments.resume(enrollment.id)

      expect(resumed.status).toBe('active')
      expect(resumed.pauseReason).toBeUndefined()
      expect(resumed.nextStepAt).toBeDefined()
    })

    it('should throw when resuming non-paused enrollment', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      try {
        await client.enrollments.resume(enrollment.id)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SequenceError)
        expect((error as SequenceError).errorCode).toBe('INVALID_STATUS')
      }
    })
  })

  describe('stop', () => {
    it('should stop an enrollment', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const stopped = await client.enrollments.stop(enrollment.id)

      expect(stopped.status).toBe('stopped')
      expect(stopped.completedAt).toBeDefined()
    })
  })

  describe('exit conditions', () => {
    it('should mark enrollment as replied', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const replied = await client.enrollments.markReplied(enrollment.id)

      expect(replied.status).toBe('replied')
      expect(replied.completedAt).toBeDefined()

      // Check template stats
      const updated = await client.templates.get(template.id)
      expect(updated?.stats?.repliedCount).toBe(1)
      expect(updated?.stats?.activeEnrollments).toBe(0)
    })

    it('should mark enrollment as bounced', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const bounced = await client.enrollments.markBounced(enrollment.id)

      expect(bounced.status).toBe('bounced')

      const updated = await client.templates.get(template.id)
      expect(updated?.stats?.bouncedCount).toBe(1)
    })

    it('should mark enrollment as unsubscribed', async () => {
      const enrollment = await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_abc123',
        leadId: 'lead_xyz456',
      })

      const unsub = await client.enrollments.markUnsubscribed(enrollment.id)
      expect(unsub.status).toBe('unsubscribed')
    })
  })
})

// =============================================================================
// Step Execution Tests
// =============================================================================

describe('@dotdo/close/sequences - Step Execution', () => {
  let client: SequenceClient
  let storage: Map<string, unknown>
  let template: SequenceTemplate
  let enrollment: SequenceEnrollment

  beforeEach(async () => {
    storage = createMockStorage()
    client = new SequenceClient({ storage })

    template = await client.templates.create({
      name: 'Execution Test',
      steps: [
        { type: 'email', delay: 0, subject: 'Hi {{name}}', body: 'Hello {{name}}!' },
        { type: 'call', delay: 2, note: 'Follow-up call for {{name}}' },
        { type: 'linkedin', delay: 3, action: 'connect', message: 'Hi {{name}}' },
        { type: 'sms', delay: 4, text: 'Quick note {{name}}' },
        { type: 'task', delay: 5, text: 'Review {{name}} profile' },
      ],
    })

    enrollment = await client.enrollments.create({
      templateId: template.id,
      contactId: 'cont_abc123',
      leadId: 'lead_xyz456',
      variables: { name: 'John' },
    })
  })

  describe('executeNextStep', () => {
    it('should execute email step and create activity', async () => {
      const result = await client.enrollments.executeNextStep(enrollment.id)

      expect(result.step.type).toBe('email')
      expect(result.step.status).toBe('completed')
      expect(result.step.executedAt).toBeDefined()
      expect(result.activityId).toBeDefined()
      expect(result.enrollment.currentStep).toBe(2)
      expect(result.nextStepAt).toBeDefined()

      // Check activity was created
      const emailActivity = storage.get(`close:email:${result.activityId}`)
      expect(emailActivity).toBeDefined()
    })

    it('should execute call step', async () => {
      // Execute first step
      await client.enrollments.executeNextStep(enrollment.id)

      // Execute second step (call)
      const result = await client.enrollments.executeNextStep(enrollment.id)

      expect(result.step.type).toBe('call')
      expect(result.step.status).toBe('completed')
      expect(result.activityId).toBeDefined()

      // Check activity was created
      const callActivity = storage.get(`close:call:${result.activityId}`)
      expect(callActivity).toBeDefined()
    })

    it('should execute linkedin step', async () => {
      // Execute first two steps
      await client.enrollments.executeNextStep(enrollment.id)
      await client.enrollments.executeNextStep(enrollment.id)

      // Execute third step (linkedin)
      const result = await client.enrollments.executeNextStep(enrollment.id)

      expect(result.step.type).toBe('linkedin')
      expect(result.step.status).toBe('completed')

      const linkedinActivity = storage.get(`close:linkedin:${result.activityId}`)
      expect(linkedinActivity).toBeDefined()
    })

    it('should execute sms step', async () => {
      // Execute first three steps
      await client.enrollments.executeNextStep(enrollment.id)
      await client.enrollments.executeNextStep(enrollment.id)
      await client.enrollments.executeNextStep(enrollment.id)

      // Execute fourth step (sms)
      const result = await client.enrollments.executeNextStep(enrollment.id)

      expect(result.step.type).toBe('sms')
      expect(result.step.status).toBe('completed')

      const smsActivity = storage.get(`close:sms:${result.activityId}`)
      expect(smsActivity).toBeDefined()
    })

    it('should execute task step', async () => {
      // Execute first four steps
      for (let i = 0; i < 4; i++) {
        await client.enrollments.executeNextStep(enrollment.id)
      }

      // Execute fifth step (task)
      const result = await client.enrollments.executeNextStep(enrollment.id)

      expect(result.step.type).toBe('task')
      expect(result.step.status).toBe('completed')

      const task = storage.get(`close:task:${result.activityId}`)
      expect(task).toBeDefined()
    })

    it('should complete enrollment after last step', async () => {
      // Execute all 5 steps
      let result
      for (let i = 0; i < 5; i++) {
        result = await client.enrollments.executeNextStep(enrollment.id)
      }

      // After the 5th step, enrollment should be completed
      expect(result!.enrollment.status).toBe('completed')
      expect(result!.enrollment.completedAt).toBeDefined()
      expect(result!.enrollment.nextStepAt).toBeUndefined()

      // Check template stats
      const updated = await client.templates.get(template.id)
      expect(updated?.stats?.completedEnrollments).toBe(1)
      expect(updated?.stats?.activeEnrollments).toBe(0)
    })

    it('should track step history', async () => {
      await client.enrollments.executeNextStep(enrollment.id)
      await client.enrollments.executeNextStep(enrollment.id)

      const updated = await client.enrollments.get(enrollment.id)
      expect(updated?.stepHistory).toHaveLength(2)
      expect(updated?.stepHistory[0].type).toBe('email')
      expect(updated?.stepHistory[1].type).toBe('call')
    })

    it('should update template stats on step execution', async () => {
      await client.enrollments.executeNextStep(enrollment.id) // email
      await client.enrollments.executeNextStep(enrollment.id) // call
      await client.enrollments.executeNextStep(enrollment.id) // linkedin
      await client.enrollments.executeNextStep(enrollment.id) // sms

      const updated = await client.templates.get(template.id)
      expect(updated?.stats?.emailsSent).toBe(1)
      expect(updated?.stats?.callsMade).toBe(1)
      expect(updated?.stats?.linkedInActions).toBe(1)
      expect(updated?.stats?.smsSent).toBe(1)
    })

    it('should throw for non-active enrollment', async () => {
      await client.enrollments.pause(enrollment.id)

      try {
        await client.enrollments.executeNextStep(enrollment.id)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SequenceError)
        expect((error as SequenceError).errorCode).toBe('INVALID_STATUS')
      }
    })

    it('should interpolate variables in step content', async () => {
      const result = await client.enrollments.executeNextStep(enrollment.id)

      const emailActivity = storage.get(`close:email:${result.activityId}`) as any
      expect(emailActivity.subject).toBe('Hi John')
      expect(emailActivity.body_text).toBe('Hello John!')
    })
  })

  describe('getDueEnrollments', () => {
    it('should return enrollments that are due', async () => {
      // Note: beforeEach already creates one enrollment
      // Create additional enrollments with immediate execution
      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_1',
        leadId: 'lead_1',
      })

      await client.enrollments.create({
        templateId: template.id,
        contactId: 'cont_2',
        leadId: 'lead_2',
      })

      // Get due enrollments (all 3 should be due with delay=0: original + 2 new)
      const due = await client.enrollments.getDueEnrollments()
      expect(due).toHaveLength(3)
    })

    it('should not return paused enrollments', async () => {
      // Pause the enrollment created in beforeEach
      await client.enrollments.pause(enrollment.id)

      const due = await client.enrollments.getDueEnrollments()
      expect(due).toHaveLength(0)
    })
  })
})

// =============================================================================
// Variable Interpolation Tests
// =============================================================================

describe('@dotdo/close/sequences - Variable Interpolation', () => {
  let client: SequenceClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new SequenceClient({ storage })
  })

  it('should interpolate multiple variables', async () => {
    const template = await client.templates.create({
      name: 'Variable Test',
      steps: [
        {
          type: 'email',
          delay: 0,
          subject: '{{greeting}} {{name}}',
          body: 'Hi {{name}}, {{company}} is reaching out about {{product}}.',
        },
      ],
    })

    const enrollment = await client.enrollments.create({
      templateId: template.id,
      contactId: 'cont_1',
      leadId: 'lead_1',
      variables: {
        greeting: 'Hello',
        name: 'John',
        company: 'Acme',
        product: 'widgets',
      },
    })

    const result = await client.enrollments.executeNextStep(enrollment.id)
    const activity = storage.get(`close:email:${result.activityId}`) as any

    expect(activity.subject).toBe('Hello John')
    expect(activity.body_text).toBe('Hi John, Acme is reaching out about widgets.')
  })

  it('should preserve unmatched variables', async () => {
    const template = await client.templates.create({
      name: 'Unmatched Test',
      steps: [
        {
          type: 'email',
          delay: 0,
          subject: 'Hi {{name}}',
          body: 'This {{undefined_var}} should stay.',
        },
      ],
    })

    const enrollment = await client.enrollments.create({
      templateId: template.id,
      contactId: 'cont_1',
      leadId: 'lead_1',
      variables: { name: 'John' },
    })

    const result = await client.enrollments.executeNextStep(enrollment.id)
    const activity = storage.get(`close:email:${result.activityId}`) as any

    expect(activity.body_text).toBe('This {{undefined_var}} should stay.')
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/close/sequences - Error Handling', () => {
  let client: SequenceClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new SequenceClient({ storage })
  })

  it('should throw SequenceError with proper fields', async () => {
    try {
      await client.templates.get('seqt_nonexistent')
      await client.templates.update('seqt_nonexistent', { name: 'Test' })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SequenceError)
      expect((error as SequenceError).errorCode).toBe('NOT_FOUND')
      expect((error as SequenceError).httpStatus).toBe(404)
    }
  })

  it('should handle enrollment creation errors gracefully', async () => {
    // Try to create enrollment for non-existent template
    try {
      await client.enrollments.create({
        templateId: 'seqt_nonexistent',
        contactId: 'cont_1',
        leadId: 'lead_1',
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SequenceError)
      expect((error as SequenceError).errorCode).toBe('TEMPLATE_NOT_FOUND')
    }
  })
})
