/**
 * @dotdo/pipedrive - Pipedrive API Compatibility Layer Tests
 *
 * TDD RED phase: Write failing tests first, then implement.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PipedriveClient,
  PipedriveError,
  type Person,
  type Organization,
  type Deal,
  type Activity,
  type Note,
  type Pipeline,
  type Stage,
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

describe('@dotdo/pipedrive - Client', () => {
  describe('initialization', () => {
    it('should create a Pipedrive client instance', () => {
      const storage = createMockStorage()
      const client = new PipedriveClient({ storage })

      expect(client).toBeDefined()
      expect(client.persons).toBeDefined()
      expect(client.organizations).toBeDefined()
      expect(client.deals).toBeDefined()
      expect(client.activities).toBeDefined()
      expect(client.notes).toBeDefined()
      expect(client.pipelines).toBeDefined()
    })
  })
})

// =============================================================================
// Persons (Contacts) Tests
// =============================================================================

describe('@dotdo/pipedrive - Persons', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create a person with required fields', async () => {
      const person = await client.persons.create({
        name: 'John Doe',
      })

      expect(person.id).toBeDefined()
      expect(person.name).toBe('John Doe')
      expect(person.add_time).toBeDefined()
      expect(person.update_time).toBeDefined()
      expect(person.active_flag).toBe(true)
    })

    it('should create a person with all fields', async () => {
      const person = await client.persons.create({
        name: 'Jane Smith',
        email: [{ value: 'jane@example.com', primary: true }],
        phone: [{ value: '+1234567890', primary: true }],
        org_id: 123,
        owner_id: 456,
        label: 7,
      })

      expect(person.name).toBe('Jane Smith')
      expect(person.email).toHaveLength(1)
      expect(person.email?.[0].value).toBe('jane@example.com')
      expect(person.phone).toHaveLength(1)
      expect(person.phone?.[0].value).toBe('+1234567890')
    })

    it('should auto-generate ID for new person', async () => {
      const person1 = await client.persons.create({ name: 'Person 1' })
      const person2 = await client.persons.create({ name: 'Person 2' })

      expect(person1.id).not.toBe(person2.id)
    })
  })

  describe('get', () => {
    it('should get a person by ID', async () => {
      const created = await client.persons.create({ name: 'John Doe' })
      const retrieved = await client.persons.get(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('John Doe')
    })

    it('should return null for non-existent person', async () => {
      const person = await client.persons.get(999999)
      expect(person).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a person', async () => {
      const created = await client.persons.create({ name: 'John Doe' })
      const updated = await client.persons.update(created.id, {
        name: 'John Smith',
        email: [{ value: 'john.smith@example.com', primary: true }],
      })

      expect(updated.name).toBe('John Smith')
      expect(updated.email?.[0].value).toBe('john.smith@example.com')
      // update_time should be set (may be same ms if very fast)
      expect(updated.update_time).toBeDefined()
    })

    it('should throw error for non-existent person', async () => {
      await expect(
        client.persons.update(999999, { name: 'Test' })
      ).rejects.toThrow(PipedriveError)
    })
  })

  describe('delete', () => {
    it('should delete a person', async () => {
      const created = await client.persons.create({ name: 'John Doe' })
      await client.persons.delete(created.id)

      const person = await client.persons.get(created.id)
      expect(person).toBeNull()
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await client.persons.create({
        name: 'John Doe',
        email: [{ value: 'john@example.com', primary: true }],
      })
      await client.persons.create({
        name: 'Jane Smith',
        email: [{ value: 'jane@example.com', primary: true }],
      })
      await client.persons.create({
        name: 'Bob Johnson',
        email: [{ value: 'bob@company.com', primary: true }],
      })
    })

    it('should search persons by name', async () => {
      const result = await client.persons.search('John')
      expect(result.data.items.length).toBeGreaterThanOrEqual(1)
    })

    it('should search persons by email', async () => {
      const result = await client.persons.search('example.com')
      expect(result.data.items.length).toBe(2)
    })

    it('should return empty for no matches', async () => {
      const result = await client.persons.search('nonexistent')
      expect(result.data.items).toHaveLength(0)
    })

    it('should support pagination', async () => {
      const result = await client.persons.search('', { start: 0, limit: 2 })
      expect(result.data.items.length).toBeLessThanOrEqual(2)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await client.persons.create({ name: `Person ${i}` })
      }
    })

    it('should list all persons', async () => {
      const result = await client.persons.list()
      expect(result.data).toHaveLength(5)
    })

    it('should support pagination', async () => {
      const result = await client.persons.list({ start: 0, limit: 2 })
      expect(result.data).toHaveLength(2)
      expect(result.additional_data?.pagination?.more_items_in_collection).toBe(true)
    })

    it('should support sorting', async () => {
      const result = await client.persons.list({ sort: 'name ASC' })
      expect(result.data[0].name).toBe('Person 0')
    })
  })
})

// =============================================================================
// Organizations Tests
// =============================================================================

describe('@dotdo/pipedrive - Organizations', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create an organization', async () => {
      const org = await client.organizations.create({
        name: 'Acme Corp',
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('Acme Corp')
      expect(org.active_flag).toBe(true)
    })

    it('should create organization with all fields', async () => {
      const org = await client.organizations.create({
        name: 'Tech Company',
        address: '123 Main St',
        owner_id: 456,
        label: 8,
      })

      expect(org.name).toBe('Tech Company')
      expect(org.address).toBe('123 Main St')
    })
  })

  describe('get', () => {
    it('should get an organization by ID', async () => {
      const created = await client.organizations.create({ name: 'Acme Corp' })
      const retrieved = await client.organizations.get(created.id)

      expect(retrieved?.name).toBe('Acme Corp')
    })

    it('should return null for non-existent organization', async () => {
      const org = await client.organizations.get(999999)
      expect(org).toBeNull()
    })
  })

  describe('update', () => {
    it('should update an organization', async () => {
      const created = await client.organizations.create({ name: 'Acme Corp' })
      const updated = await client.organizations.update(created.id, {
        name: 'Acme Corporation',
        address: '456 Oak Ave',
      })

      expect(updated.name).toBe('Acme Corporation')
      expect(updated.address).toBe('456 Oak Ave')
    })
  })

  describe('delete', () => {
    it('should delete an organization', async () => {
      const created = await client.organizations.create({ name: 'Acme Corp' })
      await client.organizations.delete(created.id)

      const org = await client.organizations.get(created.id)
      expect(org).toBeNull()
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await client.organizations.create({ name: 'Acme Corp' })
      await client.organizations.create({ name: 'Tech Inc' })
      await client.organizations.create({ name: 'Acme Solutions' })
    })

    it('should search organizations by name', async () => {
      const result = await client.organizations.search('Acme')
      expect(result.data.items.length).toBe(2)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await client.organizations.create({ name: `Org ${i}` })
      }
    })

    it('should list all organizations', async () => {
      const result = await client.organizations.list()
      expect(result.data).toHaveLength(5)
    })
  })

  describe('getPersons', () => {
    it('should get persons belonging to an organization', async () => {
      const org = await client.organizations.create({ name: 'Acme Corp' })
      await client.persons.create({ name: 'John Doe', org_id: org.id })
      await client.persons.create({ name: 'Jane Smith', org_id: org.id })

      const persons = await client.organizations.getPersons(org.id)
      expect(persons.data).toHaveLength(2)
    })
  })
})

// =============================================================================
// Deals Tests
// =============================================================================

describe('@dotdo/pipedrive - Deals', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(async () => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create a deal with required fields', async () => {
      const deal = await client.deals.create({
        title: 'Big Enterprise Deal',
      })

      expect(deal.id).toBeDefined()
      expect(deal.title).toBe('Big Enterprise Deal')
      expect(deal.status).toBe('open')
      expect(deal.add_time).toBeDefined()
    })

    it('should create a deal with all fields', async () => {
      const deal = await client.deals.create({
        title: 'Sales Opportunity',
        value: 50000,
        currency: 'USD',
        person_id: 123,
        org_id: 456,
        stage_id: 1,
        expected_close_date: '2024-12-31',
        probability: 75,
      })

      expect(deal.title).toBe('Sales Opportunity')
      expect(deal.value).toBe(50000)
      expect(deal.currency).toBe('USD')
      expect(deal.probability).toBe(75)
    })
  })

  describe('get', () => {
    it('should get a deal by ID', async () => {
      const created = await client.deals.create({ title: 'Test Deal' })
      const retrieved = await client.deals.get(created.id)

      expect(retrieved?.title).toBe('Test Deal')
    })

    it('should return null for non-existent deal', async () => {
      const deal = await client.deals.get(999999)
      expect(deal).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a deal', async () => {
      const created = await client.deals.create({ title: 'Test Deal', value: 1000 })
      const updated = await client.deals.update(created.id, {
        title: 'Updated Deal',
        value: 5000,
      })

      expect(updated.title).toBe('Updated Deal')
      expect(updated.value).toBe(5000)
    })

    it('should update deal stage', async () => {
      const created = await client.deals.create({ title: 'Test Deal', stage_id: 1 })
      const updated = await client.deals.update(created.id, { stage_id: 2 })

      expect(updated.stage_id).toBe(2)
    })

    it('should mark deal as won', async () => {
      const created = await client.deals.create({ title: 'Test Deal' })
      const updated = await client.deals.update(created.id, {
        status: 'won',
        won_time: new Date().toISOString(),
      })

      expect(updated.status).toBe('won')
      expect(updated.won_time).toBeDefined()
    })

    it('should mark deal as lost', async () => {
      const created = await client.deals.create({ title: 'Test Deal' })
      const updated = await client.deals.update(created.id, {
        status: 'lost',
        lost_reason: 'Budget constraints',
        lost_time: new Date().toISOString(),
      })

      expect(updated.status).toBe('lost')
      expect(updated.lost_reason).toBe('Budget constraints')
    })
  })

  describe('delete', () => {
    it('should delete a deal', async () => {
      const created = await client.deals.create({ title: 'Test Deal' })
      await client.deals.delete(created.id)

      const deal = await client.deals.get(created.id)
      expect(deal).toBeNull()
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await client.deals.create({ title: 'Enterprise Deal', value: 100000 })
      await client.deals.create({ title: 'Startup Deal', value: 10000 })
      await client.deals.create({ title: 'Enterprise Expansion', value: 50000 })
    })

    it('should search deals by title', async () => {
      const result = await client.deals.search('Enterprise')
      expect(result.data.items.length).toBe(2)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await client.deals.create({ title: `Deal ${i}`, value: i * 1000 })
      }
    })

    it('should list all deals', async () => {
      const result = await client.deals.list()
      expect(result.data).toHaveLength(5)
    })

    it('should filter by status', async () => {
      await client.deals.create({ title: 'Won Deal' })
      await client.deals.update(
        (await client.deals.list()).data[0].id,
        { status: 'won' }
      )

      const result = await client.deals.list({ status: 'open' })
      expect(result.data.every((d) => d.status === 'open')).toBe(true)
    })
  })

  describe('summary', () => {
    beforeEach(async () => {
      await client.deals.create({ title: 'Deal 1', value: 10000, status: 'open' })
      await client.deals.create({ title: 'Deal 2', value: 20000, status: 'open' })
      const wonDeal = await client.deals.create({ title: 'Deal 3', value: 30000 })
      await client.deals.update(wonDeal.id, { status: 'won' })
    })

    it('should get deals summary', async () => {
      const summary = await client.deals.getSummary()

      expect(summary.data).toBeDefined()
      expect(summary.data.total_count).toBeGreaterThanOrEqual(3)
      expect(summary.data.values_total?.USD).toBeDefined()
    })
  })
})

// =============================================================================
// Activities Tests
// =============================================================================

describe('@dotdo/pipedrive - Activities', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create an activity', async () => {
      const activity = await client.activities.create({
        subject: 'Follow up call',
        type: 'call',
        due_date: '2024-03-15',
      })

      expect(activity.id).toBeDefined()
      expect(activity.subject).toBe('Follow up call')
      expect(activity.type).toBe('call')
      expect(activity.done).toBe(false)
    })

    it('should create activity with all fields', async () => {
      const activity = await client.activities.create({
        subject: 'Sales Meeting',
        type: 'meeting',
        due_date: '2024-03-20',
        due_time: '14:00',
        duration: '01:00',
        person_id: 123,
        org_id: 456,
        deal_id: 789,
        note: 'Discuss contract terms',
      })

      expect(activity.subject).toBe('Sales Meeting')
      expect(activity.type).toBe('meeting')
      expect(activity.duration).toBe('01:00')
      expect(activity.note).toBe('Discuss contract terms')
    })
  })

  describe('get', () => {
    it('should get an activity by ID', async () => {
      const created = await client.activities.create({
        subject: 'Test Activity',
        type: 'task',
        due_date: '2024-03-15',
      })
      const retrieved = await client.activities.get(created.id)

      expect(retrieved?.subject).toBe('Test Activity')
    })
  })

  describe('update', () => {
    it('should update an activity', async () => {
      const created = await client.activities.create({
        subject: 'Test Activity',
        type: 'task',
        due_date: '2024-03-15',
      })
      const updated = await client.activities.update(created.id, {
        subject: 'Updated Activity',
        due_date: '2024-03-20',
      })

      expect(updated.subject).toBe('Updated Activity')
      expect(updated.due_date).toBe('2024-03-20')
    })

    it('should mark activity as done', async () => {
      const created = await client.activities.create({
        subject: 'Test Activity',
        type: 'task',
        due_date: '2024-03-15',
      })
      const updated = await client.activities.update(created.id, { done: true })

      expect(updated.done).toBe(true)
      expect(updated.marked_as_done_time).toBeDefined()
    })
  })

  describe('delete', () => {
    it('should delete an activity', async () => {
      const created = await client.activities.create({
        subject: 'Test Activity',
        type: 'task',
        due_date: '2024-03-15',
      })
      await client.activities.delete(created.id)

      const activity = await client.activities.get(created.id)
      expect(activity).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await client.activities.create({
        subject: 'Activity 1',
        type: 'call',
        due_date: '2024-03-15',
      })
      await client.activities.create({
        subject: 'Activity 2',
        type: 'meeting',
        due_date: '2024-03-16',
      })
      await client.activities.create({
        subject: 'Activity 3',
        type: 'task',
        due_date: '2024-03-17',
        done: true,
      })
    })

    it('should list all activities', async () => {
      const result = await client.activities.list()
      expect(result.data).toHaveLength(3)
    })

    it('should filter by type', async () => {
      const result = await client.activities.list({ type: 'call' })
      expect(result.data.every((a) => a.type === 'call')).toBe(true)
    })

    it('should filter by done status', async () => {
      const result = await client.activities.list({ done: false })
      expect(result.data.every((a) => !a.done)).toBe(true)
    })
  })

  describe('getTypes', () => {
    it('should get activity types', async () => {
      const types = await client.activities.getTypes()

      expect(types.data).toBeDefined()
      expect(Array.isArray(types.data)).toBe(true)
      expect(types.data.some((t) => t.key_string === 'call')).toBe(true)
      expect(types.data.some((t) => t.key_string === 'meeting')).toBe(true)
      expect(types.data.some((t) => t.key_string === 'task')).toBe(true)
    })
  })
})

// =============================================================================
// Notes Tests
// =============================================================================

describe('@dotdo/pipedrive - Notes', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create a note', async () => {
      const note = await client.notes.create({
        content: 'Important note about the client',
      })

      expect(note.id).toBeDefined()
      expect(note.content).toBe('Important note about the client')
      expect(note.add_time).toBeDefined()
    })

    it('should create note attached to a deal', async () => {
      const deal = await client.deals.create({ title: 'Test Deal' })
      const note = await client.notes.create({
        content: 'Deal note',
        deal_id: deal.id,
      })

      expect(note.deal_id).toBe(deal.id)
    })

    it('should create note attached to a person', async () => {
      const person = await client.persons.create({ name: 'John Doe' })
      const note = await client.notes.create({
        content: 'Person note',
        person_id: person.id,
      })

      expect(note.person_id).toBe(person.id)
    })
  })

  describe('get', () => {
    it('should get a note by ID', async () => {
      const created = await client.notes.create({ content: 'Test note' })
      const retrieved = await client.notes.get(created.id)

      expect(retrieved?.content).toBe('Test note')
    })
  })

  describe('update', () => {
    it('should update a note', async () => {
      const created = await client.notes.create({ content: 'Original content' })
      const updated = await client.notes.update(created.id, {
        content: 'Updated content',
      })

      expect(updated.content).toBe('Updated content')
    })
  })

  describe('delete', () => {
    it('should delete a note', async () => {
      const created = await client.notes.create({ content: 'Test note' })
      await client.notes.delete(created.id)

      const note = await client.notes.get(created.id)
      expect(note).toBeNull()
    })
  })

  describe('list', () => {
    it('should list notes for a deal', async () => {
      const deal = await client.deals.create({ title: 'Test Deal' })
      await client.notes.create({ content: 'Note 1', deal_id: deal.id })
      await client.notes.create({ content: 'Note 2', deal_id: deal.id })

      const result = await client.notes.list({ deal_id: deal.id })
      expect(result.data).toHaveLength(2)
    })

    it('should list notes for a person', async () => {
      const person = await client.persons.create({ name: 'John Doe' })
      await client.notes.create({ content: 'Note 1', person_id: person.id })

      const result = await client.notes.list({ person_id: person.id })
      expect(result.data).toHaveLength(1)
    })
  })
})

// =============================================================================
// Pipelines Tests
// =============================================================================

describe('@dotdo/pipedrive - Pipelines', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('list', () => {
    it('should list pipelines', async () => {
      const result = await client.pipelines.list()

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('should have a default pipeline', async () => {
      const result = await client.pipelines.list()
      const defaultPipeline = result.data.find((p) => p.id === 1)

      expect(defaultPipeline).toBeDefined()
    })
  })

  describe('get', () => {
    it('should get a pipeline by ID', async () => {
      const pipeline = await client.pipelines.get(1)

      expect(pipeline?.name).toBeDefined()
    })
  })

  describe('create', () => {
    it('should create a pipeline', async () => {
      const pipeline = await client.pipelines.create({
        name: 'Enterprise Sales',
      })

      expect(pipeline.id).toBeDefined()
      expect(pipeline.name).toBe('Enterprise Sales')
      expect(pipeline.active).toBe(true)
    })
  })

  describe('update', () => {
    it('should update a pipeline', async () => {
      const created = await client.pipelines.create({ name: 'Test Pipeline' })
      const updated = await client.pipelines.update(created.id, {
        name: 'Updated Pipeline',
      })

      expect(updated.name).toBe('Updated Pipeline')
    })
  })

  describe('delete', () => {
    it('should delete a pipeline', async () => {
      const created = await client.pipelines.create({ name: 'Test Pipeline' })
      await client.pipelines.delete(created.id)

      const pipeline = await client.pipelines.get(created.id)
      expect(pipeline).toBeNull()
    })
  })

  describe('getDeals', () => {
    it('should get deals in a pipeline', async () => {
      // Create deals in default pipeline
      await client.deals.create({ title: 'Deal 1', pipeline_id: 1 })
      await client.deals.create({ title: 'Deal 2', pipeline_id: 1 })

      const result = await client.pipelines.getDeals(1)
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// =============================================================================
// Stages Tests
// =============================================================================

describe('@dotdo/pipedrive - Stages', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('list', () => {
    it('should list stages for a pipeline', async () => {
      const result = await client.stages.list({ pipeline_id: 1 })

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('get', () => {
    it('should get a stage by ID', async () => {
      const stage = await client.stages.get(1)

      expect(stage?.name).toBeDefined()
      expect(stage?.pipeline_id).toBeDefined()
    })
  })

  describe('create', () => {
    it('should create a stage', async () => {
      const stage = await client.stages.create({
        name: 'Qualification',
        pipeline_id: 1,
      })

      expect(stage.id).toBeDefined()
      expect(stage.name).toBe('Qualification')
      expect(stage.pipeline_id).toBe(1)
    })
  })

  describe('update', () => {
    it('should update a stage', async () => {
      const created = await client.stages.create({
        name: 'Test Stage',
        pipeline_id: 1,
      })
      const updated = await client.stages.update(created.id, {
        name: 'Updated Stage',
        rotten_days: 30,
      })

      expect(updated.name).toBe('Updated Stage')
      expect(updated.rotten_days).toBe(30)
    })
  })

  describe('delete', () => {
    it('should delete a stage', async () => {
      const created = await client.stages.create({
        name: 'Test Stage',
        pipeline_id: 1,
      })
      await client.stages.delete(created.id)

      const stage = await client.stages.get(created.id)
      expect(stage).toBeNull()
    })
  })

  describe('getDeals', () => {
    it('should get deals in a stage', async () => {
      const stage = await client.stages.create({
        name: 'Test Stage',
        pipeline_id: 1,
      })
      await client.deals.create({ title: 'Deal 1', stage_id: stage.id })
      await client.deals.create({ title: 'Deal 2', stage_id: stage.id })

      const result = await client.stages.getDeals(stage.id)
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/pipedrive - Error Handling', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('PipedriveError', () => {
    it('should throw PipedriveError for not found', async () => {
      try {
        await client.persons.update(999999, { name: 'Test' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(PipedriveError)
        expect((error as PipedriveError).errorCode).toBe('NOT_FOUND')
      }
    })

    it('should include error details', async () => {
      try {
        await client.deals.update(999999, { title: 'Test' })
        expect.fail('Should have thrown')
      } catch (error) {
        const pipedriveError = error as PipedriveError
        expect(pipedriveError.message).toBeDefined()
        expect(pipedriveError.errorCode).toBeDefined()
      }
    })
  })
})

// =============================================================================
// Filters Tests
// =============================================================================

describe('@dotdo/pipedrive - Filters', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create a filter', async () => {
      const filter = await client.filters.create({
        name: 'High Value Deals',
        type: 'deals',
        conditions: {
          glue: 'and',
          conditions: [
            { glue: 'and', conditions: [{ object: 'deal', field_id: 'value', operator: '>', value: 10000 }] },
          ],
        },
      })

      expect(filter.id).toBeDefined()
      expect(filter.name).toBe('High Value Deals')
      expect(filter.type).toBe('deals')
    })
  })

  describe('list', () => {
    it('should list filters', async () => {
      await client.filters.create({
        name: 'Test Filter',
        type: 'deals',
        conditions: { glue: 'and', conditions: [] },
      })

      const result = await client.filters.list()
      expect(result.data.length).toBeGreaterThanOrEqual(1)
    })

    it('should filter by type', async () => {
      await client.filters.create({
        name: 'Person Filter',
        type: 'person',
        conditions: { glue: 'and', conditions: [] },
      })
      await client.filters.create({
        name: 'Deal Filter',
        type: 'deals',
        conditions: { glue: 'and', conditions: [] },
      })

      const result = await client.filters.list({ type: 'deals' })
      expect(result.data.every((f) => f.type === 'deals')).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete a filter', async () => {
      const created = await client.filters.create({
        name: 'Test Filter',
        type: 'deals',
        conditions: { glue: 'and', conditions: [] },
      })
      await client.filters.delete(created.id)

      const filter = await client.filters.get(created.id)
      expect(filter).toBeNull()
    })
  })
})

// =============================================================================
// Products Tests
// =============================================================================

describe('@dotdo/pipedrive - Products', () => {
  let client: PipedriveClient
  let storage: Map<string, unknown>

  beforeEach(() => {
    storage = createMockStorage()
    client = new PipedriveClient({ storage })
  })

  describe('create', () => {
    it('should create a product', async () => {
      const product = await client.products.create({
        name: 'Enterprise License',
        unit_price: 1000,
        currency: 'USD',
      })

      expect(product.id).toBeDefined()
      expect(product.name).toBe('Enterprise License')
      expect(product.unit_price).toBe(1000)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await client.products.create({ name: 'Product 1', unit_price: 100 })
      await client.products.create({ name: 'Product 2', unit_price: 200 })
    })

    it('should list all products', async () => {
      const result = await client.products.list()
      expect(result.data).toHaveLength(2)
    })
  })

  describe('attachToDeal', () => {
    it('should attach product to deal', async () => {
      const product = await client.products.create({ name: 'Test Product', unit_price: 100 })
      const deal = await client.deals.create({ title: 'Test Deal' })

      const attachment = await client.products.attachToDeal(deal.id, product.id, {
        quantity: 5,
        item_price: 100,
      })

      expect(attachment.product_id).toBe(product.id)
      expect(attachment.deal_id).toBe(deal.id)
      expect(attachment.quantity).toBe(5)
    })
  })
})
