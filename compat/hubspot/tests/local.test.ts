/**
 * @dotdo/hubspot/local - Local/DO Implementation Tests
 *
 * Comprehensive tests for the HubSpot Local implementation with DO storage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HubSpotLocal, InMemoryStorage } from '../local'

// =============================================================================
// Local Client Tests
// =============================================================================

describe('@dotdo/hubspot/local - Client', () => {
  let hubspot: HubSpotLocal

  beforeEach(() => {
    hubspot = new HubSpotLocal()
  })

  it('should initialize with all CRM APIs', () => {
    expect(hubspot.crm.contacts).toBeDefined()
    expect(hubspot.crm.companies).toBeDefined()
    expect(hubspot.crm.deals).toBeDefined()
    expect(hubspot.crm.tickets).toBeDefined()
    expect(hubspot.crm.associations).toBeDefined()
    expect(hubspot.crm.properties).toBeDefined()
    expect(hubspot.crm.pipelines).toBeDefined()
    expect(hubspot.crm.owners).toBeDefined()
  })

  it('should initialize with forms and webhooks APIs', () => {
    expect(hubspot.formsApi).toBeDefined()
    expect(hubspot.webhooksApi).toBeDefined()
  })
})

// =============================================================================
// Contacts Tests
// =============================================================================

describe('@dotdo/hubspot/local - Contacts', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  describe('basicApi.create', () => {
    it('should create a contact with properties', async () => {
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: {
          email: 'user@example.com',
          firstname: 'John',
          lastname: 'Doe',
        },
      })

      expect(contact.id).toBeDefined()
      expect(contact.properties.email).toBe('user@example.com')
      expect(contact.properties.firstname).toBe('John')
      expect(contact.properties.lastname).toBe('Doe')
    })

    it('should set default timestamps', async () => {
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'test@example.com' },
      })

      expect(contact.createdAt).toBeDefined()
      expect(contact.updatedAt).toBeDefined()
      expect(contact.properties.createdate).toBeDefined()
    })
  })

  describe('basicApi.getById', () => {
    it('should get a contact by ID', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'get@example.com' },
      })

      const retrieved = await hubspot.crm.contacts.basicApi.getById(created.id)
      expect(retrieved.id).toBe(created.id)
      expect(retrieved.properties.email).toBe('get@example.com')
    })

    it('should throw error for non-existent contact', async () => {
      await expect(hubspot.crm.contacts.basicApi.getById('non-existent')).rejects.toThrow()
    })
  })

  describe('basicApi.update', () => {
    it('should update contact properties', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'update@example.com', firstname: 'Original' },
      })

      const updated = await hubspot.crm.contacts.basicApi.update(created.id, {
        properties: { firstname: 'Updated' },
      })

      expect(updated.properties.firstname).toBe('Updated')
      expect(updated.properties.email).toBe('update@example.com')
    })

    it('should update lastmodifieddate', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'modified@example.com' },
      })

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await hubspot.crm.contacts.basicApi.update(created.id, {
        properties: { firstname: 'Test' },
      })

      expect(updated.properties.lastmodifieddate).not.toBe(created.properties.lastmodifieddate)
    })
  })

  describe('basicApi.archive', () => {
    it('should archive a contact', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'archive@example.com' },
      })

      await hubspot.crm.contacts.basicApi.archive(created.id)

      await expect(hubspot.crm.contacts.basicApi.getById(created.id)).rejects.toThrow()
    })
  })

  describe('basicApi.getPage', () => {
    it('should return paginated contacts', async () => {
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'contact1@example.com' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'contact2@example.com' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'contact3@example.com' } })

      const result = await hubspot.crm.contacts.basicApi.getPage({ limit: 2 })
      expect(result.results).toHaveLength(2)
      expect(result.paging?.next?.after).toBeDefined()
    })
  })

  describe('searchApi.doSearch', () => {
    it('should search contacts with EQ filter', async () => {
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'search1@example.com' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'search2@example.com' } })

      const result = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [
          { filters: [{ propertyName: 'email', operator: 'EQ', value: 'search1@example.com' }] },
        ],
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].properties.email).toBe('search1@example.com')
    })

    it('should search contacts with CONTAINS_TOKEN filter', async () => {
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'john@company.com' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'jane@company.com' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'bob@different.com' } })

      const result = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [
          { filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '@company.com' }] },
        ],
      })

      expect(result.results).toHaveLength(2)
    })

    it('should search with query string', async () => {
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'user@example.com', firstname: 'John' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'test@example.com', firstname: 'Jane' } })

      const result = await hubspot.crm.contacts.searchApi.doSearch({
        query: 'John',
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].properties.firstname).toBe('John')
    })

    it('should sort results', async () => {
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'z@example.com' } })
      await hubspot.crm.contacts.basicApi.create({ properties: { email: 'a@example.com' } })

      const result = await hubspot.crm.contacts.searchApi.doSearch({
        sorts: [{ propertyName: 'email', direction: 'ASCENDING' }],
      })

      expect(result.results[0].properties.email).toBe('a@example.com')
    })
  })

  describe('batchApi', () => {
    it('should batch create contacts', async () => {
      const result = await hubspot.crm.contacts.batchApi.create({
        inputs: [
          { properties: { email: 'batch1@example.com' } },
          { properties: { email: 'batch2@example.com' } },
          { properties: { email: 'batch3@example.com' } },
        ],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(3)
    })

    it('should batch read contacts', async () => {
      const c1 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'read1@example.com' } })
      const c2 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'read2@example.com' } })

      const result = await hubspot.crm.contacts.batchApi.read({
        inputs: [{ id: c1.id }, { id: c2.id }],
      })

      expect(result.results).toHaveLength(2)
    })

    it('should batch update contacts', async () => {
      const c1 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'upd1@example.com', firstname: 'Old1' } })
      const c2 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'upd2@example.com', firstname: 'Old2' } })

      const result = await hubspot.crm.contacts.batchApi.update({
        inputs: [
          { id: c1.id, properties: { firstname: 'New1' } },
          { id: c2.id, properties: { firstname: 'New2' } },
        ],
      })

      expect(result.results).toHaveLength(2)
      expect(result.results[0].properties.firstname).toBe('New1')
    })

    it('should batch archive contacts', async () => {
      const c1 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'del1@example.com' } })
      const c2 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'del2@example.com' } })

      await hubspot.crm.contacts.batchApi.archive({
        inputs: [{ id: c1.id }, { id: c2.id }],
      })

      await expect(hubspot.crm.contacts.basicApi.getById(c1.id)).rejects.toThrow()
      await expect(hubspot.crm.contacts.basicApi.getById(c2.id)).rejects.toThrow()
    })
  })
})

// =============================================================================
// Companies Tests
// =============================================================================

describe('@dotdo/hubspot/local - Companies', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  it('should create a company', async () => {
    const company = await hubspot.crm.companies.basicApi.create({
      properties: {
        name: 'Acme Inc',
        domain: 'acme.com',
        industry: 'Technology',
      },
    })

    expect(company.id).toBeDefined()
    expect(company.properties.name).toBe('Acme Inc')
  })

  it('should search companies by domain', async () => {
    await hubspot.crm.companies.basicApi.create({ properties: { name: 'Acme', domain: 'acme.com' } })
    await hubspot.crm.companies.basicApi.create({ properties: { name: 'Beta', domain: 'beta.com' } })

    const result = await hubspot.crm.companies.searchApi.doSearch({
      filterGroups: [
        { filters: [{ propertyName: 'domain', operator: 'EQ', value: 'acme.com' }] },
      ],
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].properties.name).toBe('Acme')
  })
})

// =============================================================================
// Deals Tests
// =============================================================================

describe('@dotdo/hubspot/local - Deals', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  it('should create a deal', async () => {
    const deal = await hubspot.crm.deals.basicApi.create({
      properties: {
        dealname: 'New Deal',
        amount: '10000',
        dealstage: 'appointmentscheduled',
        pipeline: 'default',
      },
    })

    expect(deal.id).toBeDefined()
    expect(deal.properties.dealname).toBe('New Deal')
    expect(deal.properties.amount).toBe('10000')
  })

  it('should update deal stage', async () => {
    const deal = await hubspot.crm.deals.basicApi.create({
      properties: {
        dealname: 'Stage Deal',
        dealstage: 'appointmentscheduled',
      },
    })

    const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
      properties: { dealstage: 'closedwon' },
    })

    expect(updated.properties.dealstage).toBe('closedwon')
  })

  it('should search deals by amount range', async () => {
    await hubspot.crm.deals.basicApi.create({ properties: { dealname: 'Small', amount: '1000' } })
    await hubspot.crm.deals.basicApi.create({ properties: { dealname: 'Medium', amount: '5000' } })
    await hubspot.crm.deals.basicApi.create({ properties: { dealname: 'Large', amount: '20000' } })

    const result = await hubspot.crm.deals.searchApi.doSearch({
      filterGroups: [
        { filters: [{ propertyName: 'amount', operator: 'GT', value: 3000 }] },
      ],
    })

    expect(result.results).toHaveLength(2)
  })
})

// =============================================================================
// Tickets Tests
// =============================================================================

describe('@dotdo/hubspot/local - Tickets', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  it('should create a ticket', async () => {
    const ticket = await hubspot.crm.tickets.basicApi.create({
      properties: {
        subject: 'Support Request',
        content: 'I need help with my account',
        hs_pipeline: 'default',
        hs_pipeline_stage: 'new',
      },
    })

    expect(ticket.id).toBeDefined()
    expect(ticket.properties.subject).toBe('Support Request')
  })

  it('should update ticket status', async () => {
    const ticket = await hubspot.crm.tickets.basicApi.create({
      properties: {
        subject: 'Status Update Ticket',
        hs_pipeline_stage: 'new',
      },
    })

    const updated = await hubspot.crm.tickets.basicApi.update(ticket.id, {
      properties: { hs_pipeline_stage: 'resolved' },
    })

    expect(updated.properties.hs_pipeline_stage).toBe('resolved')
  })
})

// =============================================================================
// Associations Tests
// =============================================================================

describe('@dotdo/hubspot/local - Associations', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  it('should create an association between contact and company', async () => {
    const contact = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'assoc@example.com' } })
    const company = await hubspot.crm.companies.basicApi.create({ properties: { name: 'Assoc Company' } })

    const result = await hubspot.crm.associations.v4.basicApi.create(
      'contacts',
      contact.id,
      'companies',
      company.id,
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
    )

    expect(result.fromObjectId).toBe(contact.id)
    expect(result.toObjectId).toBe(company.id)
  })

  it('should get associations for an object', async () => {
    const contact = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'get-assoc@example.com' } })
    const company = await hubspot.crm.companies.basicApi.create({ properties: { name: 'Get Assoc Company' } })

    await hubspot.crm.associations.v4.basicApi.create(
      'contacts',
      contact.id,
      'companies',
      company.id,
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
    )

    const result = await hubspot.crm.associations.v4.basicApi.getPage('contacts', contact.id, 'companies')
    expect(result.results).toHaveLength(1)
    expect(result.results[0].toObjectId).toBe(company.id)
  })

  it('should batch create associations', async () => {
    const c1 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'batch1@example.com' } })
    const c2 = await hubspot.crm.contacts.basicApi.create({ properties: { email: 'batch2@example.com' } })
    const company = await hubspot.crm.companies.basicApi.create({ properties: { name: 'Batch Company' } })

    const result = await hubspot.crm.associations.v4.batchApi.create('contacts', 'companies', {
      inputs: [
        { from: { id: c1.id }, to: { id: company.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }] },
        { from: { id: c2.id }, to: { id: company.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }] },
      ],
    })

    expect(result.results).toHaveLength(2)
  })
})

// =============================================================================
// Properties Tests
// =============================================================================

describe('@dotdo/hubspot/local - Properties', () => {
  let hubspot: HubSpotLocal

  beforeEach(() => {
    hubspot = new HubSpotLocal()
  })

  it('should get all properties for contacts', async () => {
    const result = await hubspot.crm.properties.coreApi.getAll('contacts')

    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results.find((p) => p.name === 'email')).toBeDefined()
  })

  it('should get a specific property', async () => {
    const property = await hubspot.crm.properties.coreApi.getByName('contacts', 'email')

    expect(property.name).toBe('email')
    expect(property.type).toBe('string')
  })

  it('should create a custom property', async () => {
    const property = await hubspot.crm.properties.coreApi.create('contacts', {
      name: 'custom_score',
      label: 'Custom Score',
      type: 'number',
      fieldType: 'number',
      groupName: 'contactinformation',
    })

    expect(property.name).toBe('custom_score')
    expect(property.hubspotDefined).toBe(false)
  })

  it('should update a property', async () => {
    await hubspot.crm.properties.coreApi.create('contacts', {
      name: 'updatable_prop',
      label: 'Original Label',
      type: 'string',
      fieldType: 'text',
      groupName: 'contactinformation',
    })

    const updated = await hubspot.crm.properties.coreApi.update('contacts', 'updatable_prop', {
      label: 'Updated Label',
    })

    expect(updated.label).toBe('Updated Label')
  })

  it('should get property groups', async () => {
    const result = await hubspot.crm.properties.groupsApi.getAll('contacts')

    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results.find((g) => g.name === 'contactinformation')).toBeDefined()
  })
})

// =============================================================================
// Pipelines Tests
// =============================================================================

describe('@dotdo/hubspot/local - Pipelines', () => {
  let hubspot: HubSpotLocal

  beforeEach(() => {
    hubspot = new HubSpotLocal()
  })

  it('should get all pipelines for deals', async () => {
    const result = await hubspot.crm.pipelines.pipelinesApi.getAll('deals')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].label).toBe('Sales Pipeline')
  })

  it('should get pipeline by ID', async () => {
    const pipeline = await hubspot.crm.pipelines.pipelinesApi.getById('deals', 'default')

    expect(pipeline.id).toBe('default')
    expect(pipeline.stages.length).toBeGreaterThan(0)
  })

  it('should get pipeline stages', async () => {
    const result = await hubspot.crm.pipelines.pipelineStagesApi.getAll('deals', 'default')

    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results.find((s) => s.id === 'appointmentscheduled')).toBeDefined()
  })

  it('should create a custom pipeline', async () => {
    const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
      label: 'Custom Pipeline',
      displayOrder: 1,
      stages: [
        { id: 'lead', label: 'Lead', displayOrder: 0 },
        { id: 'qualified', label: 'Qualified', displayOrder: 1 },
        { id: 'closed', label: 'Closed', displayOrder: 2 },
      ],
    })

    expect(pipeline.id).toBeDefined()
    expect(pipeline.label).toBe('Custom Pipeline')
    expect(pipeline.stages).toHaveLength(3)
  })

  it('should add a stage to a pipeline', async () => {
    const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
      label: 'New Stage',
      displayOrder: 10,
    })

    expect(stage.id).toBeDefined()
    expect(stage.label).toBe('New Stage')
  })
})

// =============================================================================
// Owners Tests
// =============================================================================

describe('@dotdo/hubspot/local - Owners', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  it('should create an owner', async () => {
    const owner = await hubspot.crm.owners.create({
      email: 'sales@example.com',
      firstName: 'John',
      lastName: 'Sales',
    })

    expect(owner.id).toBeDefined()
    expect(owner.email).toBe('sales@example.com')
  })

  it('should get all owners', async () => {
    await hubspot.crm.owners.create({ email: 'owner1@example.com', firstName: 'Owner', lastName: 'One' })
    await hubspot.crm.owners.create({ email: 'owner2@example.com', firstName: 'Owner', lastName: 'Two' })

    const result = await hubspot.crm.owners.getPage()
    expect(result.results).toHaveLength(2)
  })

  it('should get owner by ID', async () => {
    const created = await hubspot.crm.owners.create({
      email: 'getowner@example.com',
      firstName: 'Get',
      lastName: 'Owner',
    })

    const owner = await hubspot.crm.owners.getById(created.id)
    expect(owner.email).toBe('getowner@example.com')
  })
})

// =============================================================================
// Forms API Tests
// =============================================================================

describe('@dotdo/hubspot/local - Forms API', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal()
    await hubspot.clear()
  })

  it('should create a form', async () => {
    const form = await hubspot.formsApi.createForm({
      name: 'Contact Form',
      fieldGroups: [
        {
          groupType: 'default_group',
          fields: [{ name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false }],
        },
      ],
    })

    expect(form.id).toBeDefined()
    expect(form.name).toBe('Contact Form')
  })

  it('should submit a form', async () => {
    const form = await hubspot.formsApi.createForm({
      name: 'Submission Form',
      fieldGroups: [{ groupType: 'default_group', fields: [] }],
      inlineMessage: 'Thank you!',
    })

    const result = await hubspot.formsApi.submitForm(form.id, {
      fields: [{ name: 'email', value: 'test@example.com' }],
    })

    expect(result.inlineMessage).toBe('Thank you!')
  })

  it('should list forms', async () => {
    await hubspot.formsApi.createForm({ name: 'Form 1', fieldGroups: [{ groupType: 'default_group', fields: [] }] })
    await hubspot.formsApi.createForm({ name: 'Form 2', fieldGroups: [{ groupType: 'default_group', fields: [] }] })

    const result = await hubspot.formsApi.listForms()
    expect(result.results).toHaveLength(2)
  })
})

// =============================================================================
// Webhooks API Tests
// =============================================================================

describe('@dotdo/hubspot/local - Webhooks API', () => {
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    hubspot = new HubSpotLocal({ appId: 'test_app', clientSecret: 'test_secret' })
    await hubspot.clear()
  })

  it('should subscribe to an event', async () => {
    const subscription = await hubspot.webhooksApi.subscribe({
      eventType: 'contact.creation',
      webhookUrl: 'https://example.com/webhook',
    })

    expect(subscription.id).toBeDefined()
    expect(subscription.eventType).toBe('contact.creation')
    expect(subscription.active).toBe(true)
  })

  it('should list subscriptions', async () => {
    await hubspot.webhooksApi.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1' })
    await hubspot.webhooksApi.subscribe({ eventType: 'company.creation', webhookUrl: 'https://example.com/2' })

    const result = await hubspot.webhooksApi.listSubscriptions()
    expect(result.results).toHaveLength(2)
  })

  it('should unsubscribe', async () => {
    const subscription = await hubspot.webhooksApi.subscribe({
      eventType: 'deal.creation',
      webhookUrl: 'https://example.com/webhook',
    })

    await hubspot.webhooksApi.unsubscribe(subscription.id)

    const result = await hubspot.webhooksApi.listSubscriptions()
    expect(result.results).toHaveLength(0)
  })

  it('should get delivery stats', async () => {
    const stats = await hubspot.webhooksApi.getDeliveryStats()

    expect(stats.total).toBe(0)
    expect(stats.success).toBe(0)
    expect(stats.failed).toBe(0)
  })
})

// =============================================================================
// InMemoryStorage Tests
// =============================================================================

describe('@dotdo/hubspot/local - InMemoryStorage', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = new InMemoryStorage()
  })

  it('should store and retrieve values', async () => {
    await storage.put('key1', { value: 'test' })
    const result = await storage.get<{ value: string }>('key1')
    expect(result?.value).toBe('test')
  })

  it('should return undefined for missing keys', async () => {
    const result = await storage.get('missing')
    expect(result).toBeUndefined()
  })

  it('should delete values', async () => {
    await storage.put('key1', 'value')
    const deleted = await storage.delete('key1')
    expect(deleted).toBe(true)

    const result = await storage.get('key1')
    expect(result).toBeUndefined()
  })

  it('should list values with prefix', async () => {
    await storage.put('prefix:1', 'a')
    await storage.put('prefix:2', 'b')
    await storage.put('other:1', 'c')

    const result = await storage.list({ prefix: 'prefix:' })
    expect(result.size).toBe(2)
  })

  it('should clear all values', async () => {
    await storage.put('key1', 'value1')
    await storage.put('key2', 'value2')

    storage.clear()

    const val1 = await storage.get('key1')
    const val2 = await storage.get('key2')
    expect(val1).toBeUndefined()
    expect(val2).toBeUndefined()
  })
})
