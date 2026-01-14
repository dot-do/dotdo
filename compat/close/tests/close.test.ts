/**
 * @dotdo/close - Close CRM Compatibility Layer Tests
 *
 * TDD RED phase: Write failing tests first, then implement.
 * Close uses a Lead-centric model where Leads contain Contacts and Opportunities.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CloseClient,
  CloseError,
  type Lead,
  type Contact,
  type Opportunity,
  type Activity,
  type Task,
  type CustomActivity,
  type User,
  type Status,
  type OpportunityStatus,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockStorage(): Map<string, unknown> {
  return new Map()
}

// =============================================================================
// Client Initialization Tests
// =============================================================================

describe('@dotdo/close - Client', () => {
  describe('initialization', () => {
    it('should create a Close client instance', () => {
      const storage = createMockStorage()
      const client = new CloseClient({ storage })

      expect(client).toBeDefined()
      expect(client.leads).toBeDefined()
      expect(client.contacts).toBeDefined()
      expect(client.opportunities).toBeDefined()
      expect(client.activities).toBeDefined()
      expect(client.tasks).toBeDefined()
      expect(client.statuses).toBeDefined()
    })
  })
})

// =============================================================================
// Leads Tests
// =============================================================================

describe('@dotdo/close - Leads', () => {
  let client: CloseClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
  })

  describe('create', () => {
    it('should create a lead with required fields', async () => {
      const lead = await client.leads.create({
        name: 'Acme Corporation',
      })

      expect(lead.id).toBeDefined()
      expect(lead.id).toMatch(/^lead_/)
      expect(lead.name).toBe('Acme Corporation')
      expect(lead.status_id).toBeDefined()
      expect(lead.date_created).toBeDefined()
      expect(lead.date_updated).toBeDefined()
    })

    it('should create a lead with all fields', async () => {
      const lead = await client.leads.create({
        name: 'Tech Startup',
        description: 'A promising tech company',
        url: 'https://techstartup.com',
        addresses: [
          {
            address_1: '123 Tech Lane',
            city: 'San Francisco',
            state: 'CA',
            zipcode: '94105',
            country: 'US',
          },
        ],
        contacts: [
          {
            name: 'John CEO',
            title: 'CEO',
            emails: [{ email: 'john@techstartup.com', type: 'office' }],
            phones: [{ phone: '+1234567890', type: 'mobile' }],
          },
        ],
      })

      expect(lead.name).toBe('Tech Startup')
      expect(lead.description).toBe('A promising tech company')
      expect(lead.url).toBe('https://techstartup.com')
      expect(lead.addresses).toHaveLength(1)
      expect(lead.contacts).toHaveLength(1)
    })

    it('should auto-generate ID for new lead', async () => {
      const lead1 = await client.leads.create({ name: 'Lead 1' })
      const lead2 = await client.leads.create({ name: 'Lead 2' })

      expect(lead1.id).not.toBe(lead2.id)
      expect(lead1.id).toMatch(/^lead_/)
      expect(lead2.id).toMatch(/^lead_/)
    })
  })

  describe('get', () => {
    it('should get a lead by ID', async () => {
      const created = await client.leads.create({ name: 'Acme Corp' })
      const retrieved = await client.leads.get(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('Acme Corp')
    })

    it('should return null for non-existent lead', async () => {
      const lead = await client.leads.get('lead_nonexistent')
      expect(lead).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a lead', async () => {
      const created = await client.leads.create({ name: 'Acme Corp' })
      const updated = await client.leads.update(created.id, {
        name: 'Acme Corporation',
        description: 'Updated description',
      })

      expect(updated.name).toBe('Acme Corporation')
      expect(updated.description).toBe('Updated description')
    })

    it('should throw error for non-existent lead', async () => {
      await expect(
        client.leads.update('lead_nonexistent', { name: 'Test' })
      ).rejects.toThrow(CloseError)
    })
  })

  describe('delete', () => {
    it('should delete a lead', async () => {
      const created = await client.leads.create({ name: 'Acme Corp' })
      await client.leads.delete(created.id)

      const lead = await client.leads.get(created.id)
      expect(lead).toBeNull()
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await client.leads.create({ name: 'Acme Corp' })
      await client.leads.create({ name: 'Tech Solutions' })
      await client.leads.create({ name: 'Acme Industries' })
    })

    it('should search leads by query', async () => {
      const result = await client.leads.search({ query: 'Acme' })
      expect(result.data.length).toBe(2)
    })

    it('should return empty for no matches', async () => {
      const result = await client.leads.search({ query: 'Nonexistent' })
      expect(result.data).toHaveLength(0)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await client.leads.create({ name: `Lead ${i}` })
      }
    })

    it('should list all leads', async () => {
      const result = await client.leads.list()
      expect(result.data).toHaveLength(5)
    })

    it('should support pagination with _skip and _limit', async () => {
      const result = await client.leads.list({ _skip: 0, _limit: 2 })
      expect(result.data).toHaveLength(2)
      expect(result.has_more).toBe(true)
    })

    it('should support field selection', async () => {
      const result = await client.leads.list({ _fields: ['id', 'name'] })
      expect(result.data[0].id).toBeDefined()
      expect(result.data[0].name).toBeDefined()
    })
  })
})

// =============================================================================
// Contacts Tests
// =============================================================================

describe('@dotdo/close - Contacts', () => {
  let client: CloseClient
  let storage: Map<string, unknown>
  let testLead: Lead

  beforeEach(async () => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
    testLead = await client.leads.create({ name: 'Test Lead' })
  })

  describe('create', () => {
    it('should create a contact for a lead', async () => {
      const contact = await client.contacts.create({
        lead_id: testLead.id,
        name: 'John Doe',
      })

      expect(contact.id).toBeDefined()
      expect(contact.id).toMatch(/^cont_/)
      expect(contact.name).toBe('John Doe')
      expect(contact.lead_id).toBe(testLead.id)
    })

    it('should create a contact with all fields', async () => {
      const contact = await client.contacts.create({
        lead_id: testLead.id,
        name: 'Jane Smith',
        title: 'VP of Sales',
        emails: [
          { email: 'jane@example.com', type: 'office' },
          { email: 'jane.personal@email.com', type: 'home' },
        ],
        phones: [
          { phone: '+1234567890', type: 'office' },
          { phone: '+0987654321', type: 'mobile' },
        ],
        urls: [{ url: 'https://linkedin.com/in/janesmith', type: 'linkedin' }],
      })

      expect(contact.name).toBe('Jane Smith')
      expect(contact.title).toBe('VP of Sales')
      expect(contact.emails).toHaveLength(2)
      expect(contact.phones).toHaveLength(2)
      expect(contact.urls).toHaveLength(1)
    })
  })

  describe('get', () => {
    it('should get a contact by ID', async () => {
      const created = await client.contacts.create({
        lead_id: testLead.id,
        name: 'John Doe',
      })
      const retrieved = await client.contacts.get(created.id)

      expect(retrieved?.name).toBe('John Doe')
    })

    it('should return null for non-existent contact', async () => {
      const contact = await client.contacts.get('cont_nonexistent')
      expect(contact).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a contact', async () => {
      const created = await client.contacts.create({
        lead_id: testLead.id,
        name: 'John Doe',
        title: 'Engineer',
      })
      const updated = await client.contacts.update(created.id, {
        name: 'John Smith',
        title: 'Senior Engineer',
      })

      expect(updated.name).toBe('John Smith')
      expect(updated.title).toBe('Senior Engineer')
    })
  })

  describe('delete', () => {
    it('should delete a contact', async () => {
      const created = await client.contacts.create({
        lead_id: testLead.id,
        name: 'John Doe',
      })
      await client.contacts.delete(created.id)

      const contact = await client.contacts.get(created.id)
      expect(contact).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await client.contacts.create({
          lead_id: testLead.id,
          name: `Contact ${i}`,
        })
      }
    })

    it('should list all contacts', async () => {
      const result = await client.contacts.list()
      expect(result.data).toHaveLength(3)
    })

    it('should filter contacts by lead', async () => {
      const otherLead = await client.leads.create({ name: 'Other Lead' })
      await client.contacts.create({
        lead_id: otherLead.id,
        name: 'Other Contact',
      })

      const result = await client.contacts.list({ lead_id: testLead.id })
      expect(result.data).toHaveLength(3)
      expect(result.data.every((c) => c.lead_id === testLead.id)).toBe(true)
    })
  })
})

// =============================================================================
// Opportunities Tests
// =============================================================================

describe('@dotdo/close - Opportunities', () => {
  let client: CloseClient
  let storage: Map<string, unknown>
  let testLead: Lead

  beforeEach(async () => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
    testLead = await client.leads.create({ name: 'Test Lead' })
  })

  describe('create', () => {
    it('should create an opportunity for a lead', async () => {
      const opp = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Enterprise deal',
      })

      expect(opp.id).toBeDefined()
      expect(opp.id).toMatch(/^oppo_/)
      expect(opp.lead_id).toBe(testLead.id)
      expect(opp.note).toBe('Enterprise deal')
    })

    it('should create an opportunity with all fields', async () => {
      const opp = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Big opportunity',
        value: 50000,
        value_period: 'one_time',
        value_currency: 'USD',
        confidence: 75,
        date_won: null,
        date_lost: null,
        expected_value: 37500,
      })

      expect(opp.value).toBe(50000)
      expect(opp.value_currency).toBe('USD')
      expect(opp.confidence).toBe(75)
      expect(opp.expected_value).toBe(37500)
    })
  })

  describe('get', () => {
    it('should get an opportunity by ID', async () => {
      const created = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Test opportunity',
      })
      const retrieved = await client.opportunities.get(created.id)

      expect(retrieved?.note).toBe('Test opportunity')
    })
  })

  describe('update', () => {
    it('should update an opportunity', async () => {
      const created = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Original',
        value: 10000,
      })
      const updated = await client.opportunities.update(created.id, {
        note: 'Updated',
        value: 25000,
      })

      expect(updated.note).toBe('Updated')
      expect(updated.value).toBe(25000)
    })

    it('should mark opportunity as won', async () => {
      const created = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Deal',
      })
      const updated = await client.opportunities.update(created.id, {
        status_id: 'stat_won',
        date_won: new Date().toISOString(),
      })

      expect(updated.status_id).toBe('stat_won')
      expect(updated.date_won).toBeDefined()
    })

    it('should mark opportunity as lost', async () => {
      const created = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Deal',
      })
      const updated = await client.opportunities.update(created.id, {
        status_id: 'stat_lost',
        date_lost: new Date().toISOString(),
      })

      expect(updated.status_id).toBe('stat_lost')
      expect(updated.date_lost).toBeDefined()
    })
  })

  describe('delete', () => {
    it('should delete an opportunity', async () => {
      const created = await client.opportunities.create({
        lead_id: testLead.id,
        note: 'Test',
      })
      await client.opportunities.delete(created.id)

      const opp = await client.opportunities.get(created.id)
      expect(opp).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await client.opportunities.create({ lead_id: testLead.id, note: 'Opp 1', value: 10000 })
      await client.opportunities.create({ lead_id: testLead.id, note: 'Opp 2', value: 20000 })
      await client.opportunities.create({ lead_id: testLead.id, note: 'Opp 3', value: 30000 })
    })

    it('should list all opportunities', async () => {
      const result = await client.opportunities.list()
      expect(result.data).toHaveLength(3)
    })

    it('should filter by lead_id', async () => {
      const otherLead = await client.leads.create({ name: 'Other Lead' })
      await client.opportunities.create({ lead_id: otherLead.id, note: 'Other Opp' })

      const result = await client.opportunities.list({ lead_id: testLead.id })
      expect(result.data).toHaveLength(3)
    })
  })
})

// =============================================================================
// Activities Tests
// =============================================================================

describe('@dotdo/close - Activities', () => {
  let client: CloseClient
  let storage: Map<string, unknown>
  let testLead: Lead
  let testContact: Contact

  beforeEach(async () => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
    testLead = await client.leads.create({ name: 'Test Lead' })
    testContact = await client.contacts.create({
      lead_id: testLead.id,
      name: 'Test Contact',
    })
  })

  describe('Email', () => {
    it('should create an email activity', async () => {
      const email = await client.activities.createEmail({
        lead_id: testLead.id,
        contact_id: testContact.id,
        subject: 'Introduction',
        body_text: 'Hello, this is an introduction email.',
        direction: 'outgoing',
        status: 'sent',
      })

      expect(email.id).toBeDefined()
      expect(email._type).toBe('Email')
      expect(email.subject).toBe('Introduction')
      expect(email.direction).toBe('outgoing')
    })

    it('should list email activities', async () => {
      await client.activities.createEmail({
        lead_id: testLead.id,
        subject: 'Email 1',
        body_text: 'Content 1',
        direction: 'outgoing',
        status: 'sent',
      })
      await client.activities.createEmail({
        lead_id: testLead.id,
        subject: 'Email 2',
        body_text: 'Content 2',
        direction: 'incoming',
        status: 'inbox',
      })

      const result = await client.activities.listEmails()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Call', () => {
    it('should create a call activity', async () => {
      const call = await client.activities.createCall({
        lead_id: testLead.id,
        contact_id: testContact.id,
        direction: 'outbound',
        duration: 300,
        note: 'Discussed pricing options',
      })

      expect(call.id).toBeDefined()
      expect(call._type).toBe('Call')
      expect(call.direction).toBe('outbound')
      expect(call.duration).toBe(300)
    })

    it('should list call activities', async () => {
      await client.activities.createCall({
        lead_id: testLead.id,
        direction: 'outbound',
        duration: 300,
      })

      const result = await client.activities.listCalls()
      expect(result.data.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('SMS', () => {
    it('should create an SMS activity', async () => {
      const sms = await client.activities.createSMS({
        lead_id: testLead.id,
        contact_id: testContact.id,
        direction: 'outbound',
        text: 'Thanks for your time today!',
        status: 'sent',
      })

      expect(sms.id).toBeDefined()
      expect(sms._type).toBe('SMS')
      expect(sms.text).toBe('Thanks for your time today!')
    })
  })

  describe('Note', () => {
    it('should create a note activity', async () => {
      const note = await client.activities.createNote({
        lead_id: testLead.id,
        note: 'Important client notes from the meeting',
      })

      expect(note.id).toBeDefined()
      expect(note._type).toBe('Note')
      expect(note.note).toBe('Important client notes from the meeting')
    })

    it('should list note activities', async () => {
      await client.activities.createNote({
        lead_id: testLead.id,
        note: 'Note 1',
      })
      await client.activities.createNote({
        lead_id: testLead.id,
        note: 'Note 2',
      })

      const result = await client.activities.listNotes()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Meeting', () => {
    it('should create a meeting activity', async () => {
      const meeting = await client.activities.createMeeting({
        lead_id: testLead.id,
        contact_id: testContact.id,
        title: 'Product Demo',
        starts_at: '2024-03-20T14:00:00Z',
        ends_at: '2024-03-20T15:00:00Z',
        note: 'Demo the enterprise features',
      })

      expect(meeting.id).toBeDefined()
      expect(meeting._type).toBe('Meeting')
      expect(meeting.title).toBe('Product Demo')
    })
  })

  describe('list all activities', () => {
    beforeEach(async () => {
      await client.activities.createEmail({
        lead_id: testLead.id,
        subject: 'Test Email',
        body_text: 'Content',
        direction: 'outgoing',
        status: 'sent',
      })
      await client.activities.createCall({
        lead_id: testLead.id,
        direction: 'outbound',
        duration: 100,
      })
      await client.activities.createNote({
        lead_id: testLead.id,
        note: 'Test Note',
      })
    })

    it('should list all activities for a lead', async () => {
      const result = await client.activities.list({ lead_id: testLead.id })
      expect(result.data.length).toBeGreaterThanOrEqual(3)
    })
  })
})

// =============================================================================
// Tasks Tests
// =============================================================================

describe('@dotdo/close - Tasks', () => {
  let client: CloseClient
  let storage: Map<string, unknown>
  let testLead: Lead

  beforeEach(async () => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
    testLead = await client.leads.create({ name: 'Test Lead' })
  })

  describe('create', () => {
    it('should create a task', async () => {
      const task = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Follow up on proposal',
        date: '2024-03-20',
      })

      expect(task.id).toBeDefined()
      expect(task.id).toMatch(/^task_/)
      expect(task.text).toBe('Follow up on proposal')
      expect(task.date).toBe('2024-03-20')
      expect(task.is_complete).toBe(false)
    })

    it('should create a task with all fields', async () => {
      const task = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Important follow up',
        date: '2024-03-20',
        assigned_to: 'user_123',
        is_dateless: false,
      })

      expect(task.text).toBe('Important follow up')
      expect(task.assigned_to).toBe('user_123')
    })
  })

  describe('get', () => {
    it('should get a task by ID', async () => {
      const created = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Test task',
        date: '2024-03-20',
      })
      const retrieved = await client.tasks.get(created.id)

      expect(retrieved?.text).toBe('Test task')
    })
  })

  describe('update', () => {
    it('should update a task', async () => {
      const created = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Original task',
        date: '2024-03-20',
      })
      const updated = await client.tasks.update(created.id, {
        text: 'Updated task',
        date: '2024-03-25',
      })

      expect(updated.text).toBe('Updated task')
      expect(updated.date).toBe('2024-03-25')
    })

    it('should mark task as complete', async () => {
      const created = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Task to complete',
        date: '2024-03-20',
      })
      const updated = await client.tasks.update(created.id, {
        is_complete: true,
      })

      expect(updated.is_complete).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete a task', async () => {
      const created = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Task to delete',
        date: '2024-03-20',
      })
      await client.tasks.delete(created.id)

      const task = await client.tasks.get(created.id)
      expect(task).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await client.tasks.create({
          lead_id: testLead.id,
          text: `Task ${i}`,
          date: '2024-03-20',
        })
      }
    })

    it('should list all tasks', async () => {
      const result = await client.tasks.list()
      expect(result.data).toHaveLength(3)
    })

    it('should filter by lead_id', async () => {
      const otherLead = await client.leads.create({ name: 'Other Lead' })
      await client.tasks.create({
        lead_id: otherLead.id,
        text: 'Other Task',
        date: '2024-03-20',
      })

      const result = await client.tasks.list({ lead_id: testLead.id })
      expect(result.data).toHaveLength(3)
    })

    it('should filter by completion status', async () => {
      const taskToComplete = await client.tasks.create({
        lead_id: testLead.id,
        text: 'Complete this',
        date: '2024-03-20',
      })
      await client.tasks.update(taskToComplete.id, { is_complete: true })

      const incomplete = await client.tasks.list({ is_complete: false })
      expect(incomplete.data.every((t) => !t.is_complete)).toBe(true)
    })
  })
})

// =============================================================================
// Statuses Tests
// =============================================================================

describe('@dotdo/close - Statuses', () => {
  let client: CloseClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
  })

  describe('Lead Statuses', () => {
    it('should list lead statuses', async () => {
      const result = await client.statuses.listLeadStatuses()

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
    })

    it('should have default lead statuses', async () => {
      const result = await client.statuses.listLeadStatuses()
      const labels = result.data.map((s) => s.label)

      expect(labels).toContain('Potential')
      expect(labels).toContain('Bad Fit')
      expect(labels).toContain('Qualified')
    })

    it('should create a lead status', async () => {
      const status = await client.statuses.createLeadStatus({
        label: 'Hot Lead',
      })

      expect(status.id).toBeDefined()
      expect(status.id).toMatch(/^stat_/)
      expect(status.label).toBe('Hot Lead')
    })
  })

  describe('Opportunity Statuses', () => {
    it('should list opportunity statuses', async () => {
      const result = await client.statuses.listOpportunityStatuses()

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('should have default opportunity statuses', async () => {
      const result = await client.statuses.listOpportunityStatuses()
      const labels = result.data.map((s) => s.label)

      expect(labels).toContain('Active')
      expect(labels).toContain('Won')
      expect(labels).toContain('Lost')
    })

    it('should create an opportunity status', async () => {
      const status = await client.statuses.createOpportunityStatus({
        label: 'Pending Contract',
        type: 'active',
      })

      expect(status.id).toBeDefined()
      expect(status.label).toBe('Pending Contract')
    })
  })
})

// =============================================================================
// Smart Views Tests
// =============================================================================

describe('@dotdo/close - Smart Views', () => {
  let client: CloseClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
  })

  describe('create', () => {
    it('should create a smart view', async () => {
      const view = await client.smartViews.create({
        name: 'High Value Leads',
        type: 'lead',
        query: 'opportunities.value > 10000',
      })

      expect(view.id).toBeDefined()
      expect(view.id).toMatch(/^save_/)
      expect(view.name).toBe('High Value Leads')
    })
  })

  describe('list', () => {
    it('should list smart views', async () => {
      await client.smartViews.create({
        name: 'View 1',
        type: 'lead',
        query: 'status:Potential',
      })
      await client.smartViews.create({
        name: 'View 2',
        type: 'lead',
        query: 'status:Qualified',
      })

      const result = await client.smartViews.list()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('delete', () => {
    it('should delete a smart view', async () => {
      const created = await client.smartViews.create({
        name: 'Temporary View',
        type: 'lead',
        query: 'test',
      })
      await client.smartViews.delete(created.id)

      const view = await client.smartViews.get(created.id)
      expect(view).toBeNull()
    })
  })
})

// =============================================================================
// Custom Fields Tests
// =============================================================================

describe('@dotdo/close - Custom Fields', () => {
  let client: CloseClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
  })

  describe('create', () => {
    it('should create a custom field', async () => {
      const field = await client.customFields.create({
        name: 'Industry',
        type: 'text',
        object_type: 'lead',
      })

      expect(field.id).toBeDefined()
      expect(field.id).toMatch(/^cf_/)
      expect(field.name).toBe('Industry')
      expect(field.type).toBe('text')
    })

    it('should create a choices field', async () => {
      const field = await client.customFields.create({
        name: 'Priority',
        type: 'choices',
        object_type: 'lead',
        choices: ['Low', 'Medium', 'High'],
      })

      expect(field.type).toBe('choices')
      expect(field.choices).toContain('High')
    })
  })

  describe('list', () => {
    it('should list custom fields', async () => {
      await client.customFields.create({
        name: 'Field 1',
        type: 'text',
        object_type: 'lead',
      })
      await client.customFields.create({
        name: 'Field 2',
        type: 'number',
        object_type: 'lead',
      })

      const result = await client.customFields.list()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/close - Error Handling', () => {
  let client: CloseClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
  })

  describe('CloseError', () => {
    it('should throw CloseError for not found', async () => {
      try {
        await client.leads.update('lead_nonexistent', { name: 'Test' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(CloseError)
        expect((error as CloseError).errorCode).toBe('NOT_FOUND')
      }
    })

    it('should include error details', async () => {
      try {
        await client.opportunities.update('oppo_nonexistent', { note: 'Test' })
        expect.fail('Should have thrown')
      } catch (error) {
        const closeError = error as CloseError
        expect(closeError.message).toBeDefined()
        expect(closeError.errorCode).toBeDefined()
      }
    })
  })
})

// =============================================================================
// Bulk Operations Tests
// =============================================================================

describe('@dotdo/close - Bulk Operations', () => {
  let client: CloseClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new CloseClient({ storage })
  })

  describe('bulkUpdate', () => {
    it('should bulk update leads', async () => {
      const lead1 = await client.leads.create({ name: 'Lead 1' })
      const lead2 = await client.leads.create({ name: 'Lead 2' })

      const result = await client.leads.bulkUpdate([
        { id: lead1.id, description: 'Updated 1' },
        { id: lead2.id, description: 'Updated 2' },
      ])

      expect(result.updated).toBe(2)
      expect(result.errors).toHaveLength(0)

      const updated1 = await client.leads.get(lead1.id)
      expect(updated1?.description).toBe('Updated 1')
    })
  })

  describe('bulkDelete', () => {
    it('should bulk delete leads', async () => {
      const lead1 = await client.leads.create({ name: 'Lead 1' })
      const lead2 = await client.leads.create({ name: 'Lead 2' })

      await client.leads.bulkDelete([lead1.id, lead2.id])

      const deleted1 = await client.leads.get(lead1.id)
      const deleted2 = await client.leads.get(lead2.id)
      expect(deleted1).toBeNull()
      expect(deleted2).toBeNull()
    })
  })
})
