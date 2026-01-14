/**
 * @dotdo/hubspot - Local Mock Backend Tests
 *
 * Tests for the in-memory HubSpot mock backend that enables
 * local development and testing without hitting the real HubSpot API.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LocalHubSpot } from '../src/local'

describe('@dotdo/hubspot - Local Mock Backend', () => {
  let hubspot: LocalHubSpot

  beforeEach(() => {
    hubspot = new LocalHubSpot()
  })

  describe('Contacts', () => {
    it('should create a contact', async () => {
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: {
          email: 'test@example.com',
          firstname: 'Test',
          lastname: 'User',
        },
      })

      expect(contact.id).toBeDefined()
      expect(contact.properties.email).toBe('test@example.com')
      expect(contact.properties.firstname).toBe('Test')
      expect(contact.createdAt).toBeDefined()
      expect(contact.archived).toBe(false)
    })

    it('should get a contact by ID', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'get@example.com' },
      })

      const contact = await hubspot.crm.contacts.basicApi.getById(created.id)

      expect(contact.id).toBe(created.id)
      expect(contact.properties.email).toBe('get@example.com')
    })

    it('should update a contact', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'update@example.com', firstname: 'Original' },
      })

      const updated = await hubspot.crm.contacts.basicApi.update(created.id, {
        properties: { firstname: 'Updated' },
      })

      expect(updated.properties.firstname).toBe('Updated')
      expect(updated.properties.email).toBe('update@example.com')
    })

    it('should archive a contact', async () => {
      const created = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'archive@example.com' },
      })

      await hubspot.crm.contacts.basicApi.archive(created.id)

      await expect(
        hubspot.crm.contacts.basicApi.getById(created.id)
      ).rejects.toThrow()
    })

    it('should search contacts', async () => {
      await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'search1@acme.com', firstname: 'Alice' },
      })
      await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'search2@acme.com', firstname: 'Bob' },
      })
      await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'other@example.com', firstname: 'Charlie' },
      })

      const result = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: 'email', operator: 'CONTAINS_TOKEN', value: 'acme.com' },
            ],
          },
        ],
      })

      expect(result.total).toBe(2)
      expect(result.results.map(r => r.properties.firstname)).toContain('Alice')
      expect(result.results.map(r => r.properties.firstname)).toContain('Bob')
    })

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
  })

  describe('Companies', () => {
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
      expect(company.properties.domain).toBe('acme.com')
    })

    it('should get a company by ID', async () => {
      const created = await hubspot.crm.companies.basicApi.create({
        properties: { name: 'Test Corp', domain: 'test.com' },
      })

      const company = await hubspot.crm.companies.basicApi.getById(created.id)

      expect(company.properties.name).toBe('Test Corp')
    })

    it('should search companies by domain', async () => {
      await hubspot.crm.companies.basicApi.create({
        properties: { name: 'Acme Inc', domain: 'acme.com' },
      })
      await hubspot.crm.companies.basicApi.create({
        properties: { name: 'Test Corp', domain: 'test.com' },
      })

      const result = await hubspot.crm.companies.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: 'domain', operator: 'EQ', value: 'acme.com' },
            ],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.name).toBe('Acme Inc')
    })
  })

  describe('Deals', () => {
    it('should create a deal', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Big Deal',
          amount: '50000',
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
        },
      })

      expect(deal.id).toBeDefined()
      expect(deal.properties.dealname).toBe('Big Deal')
      expect(deal.properties.amount).toBe('50000')
    })

    it('should update deal stage', async () => {
      const created = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Stage Deal',
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
        },
      })

      const updated = await hubspot.crm.deals.basicApi.update(created.id, {
        properties: { dealstage: 'closedwon' },
      })

      expect(updated.properties.dealstage).toBe('closedwon')
    })

    it('should search deals by pipeline', async () => {
      await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal 1', pipeline: 'sales', dealstage: 'new' },
      })
      await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal 2', pipeline: 'default', dealstage: 'new' },
      })

      const result = await hubspot.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: 'pipeline', operator: 'EQ', value: 'sales' },
            ],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.dealname).toBe('Deal 1')
    })
  })

  describe('Tickets', () => {
    it('should create a ticket', async () => {
      const ticket = await hubspot.crm.tickets.basicApi.create({
        properties: {
          subject: 'Need Help',
          content: 'I have a problem',
          hs_pipeline: 'support',
          hs_pipeline_stage: 'new',
          hs_ticket_priority: 'HIGH',
        },
      })

      expect(ticket.id).toBeDefined()
      expect(ticket.properties.subject).toBe('Need Help')
      expect(ticket.properties.hs_ticket_priority).toBe('HIGH')
    })

    it('should search tickets by priority', async () => {
      await hubspot.crm.tickets.basicApi.create({
        properties: { subject: 'High', hs_ticket_priority: 'HIGH' },
      })
      await hubspot.crm.tickets.basicApi.create({
        properties: { subject: 'Low', hs_ticket_priority: 'LOW' },
      })

      const result = await hubspot.crm.tickets.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_ticket_priority', operator: 'EQ', value: 'HIGH' },
            ],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.subject).toBe('High')
    })
  })

  describe('Associations', () => {
    it('should create an association between contact and company', async () => {
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'assoc@example.com' },
      })
      const company = await hubspot.crm.companies.basicApi.create({
        properties: { name: 'Assoc Corp' },
      })

      const association = await hubspot.crm.associations.v4.basicApi.create(
        'contacts',
        contact.id,
        'companies',
        company.id,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
      )

      expect(association.fromObjectId).toBe(Number(contact.id))
      expect(association.toObjectId).toBe(Number(company.id))
    })

    it('should get associations for an object', async () => {
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'getassoc@example.com' },
      })
      const company = await hubspot.crm.companies.basicApi.create({
        properties: { name: 'GetAssoc Corp' },
      })

      await hubspot.crm.associations.v4.basicApi.create(
        'contacts',
        contact.id,
        'companies',
        company.id,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
      )

      const result = await hubspot.crm.associations.v4.basicApi.getPage(
        'contacts',
        contact.id,
        'companies'
      )

      expect(result.results).toHaveLength(1)
      expect(result.results[0].toObjectId).toBe(Number(company.id))
    })
  })

  describe('Notes', () => {
    it('should create a note', async () => {
      const note = await hubspot.crm.objects.notes.basicApi.create({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: 'Important meeting notes',
        },
      })

      expect(note.id).toBeDefined()
      expect(note.properties.hs_note_body).toBe('Important meeting notes')
    })
  })

  describe('Pipelines', () => {
    it('should get deal pipelines', async () => {
      const result = await hubspot.crm.pipelines.pipelinesApi.getAll('deals')

      expect(result.results).toBeDefined()
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0].stages).toBeDefined()
    })
  })

  describe('Properties', () => {
    it('should get properties for contacts', async () => {
      const result = await hubspot.crm.properties.coreApi.getAll('contacts')

      expect(result.results).toBeDefined()
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results.find(p => p.name === 'email')).toBeDefined()
    })
  })

  describe('Clear/Reset', () => {
    it('should clear all data', async () => {
      await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'clear@example.com' },
      })
      await hubspot.crm.companies.basicApi.create({
        properties: { name: 'Clear Corp' },
      })

      hubspot.clear()

      const contacts = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [],
      })
      const companies = await hubspot.crm.companies.searchApi.doSearch({
        filterGroups: [],
      })

      expect(contacts.total).toBe(0)
      expect(companies.total).toBe(0)
    })
  })
})
