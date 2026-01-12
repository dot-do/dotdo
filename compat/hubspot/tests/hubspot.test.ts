/**
 * @dotdo/hubspot - HubSpot CRM Compatibility Layer Tests
 *
 * Tests for the HubSpot API compatibility layer including:
 * - Client initialization
 * - Contacts (create, get, update, delete, search, batch)
 * - Companies (create, get, update, delete, search)
 * - Deals (create, get, update, delete, search, pipeline stages)
 * - Tickets (create, get, update, search)
 * - Associations (create, get between objects)
 * - Engagements (notes, emails, calls, meetings)
 *
 * Following @hubspot/api-client interface patterns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  HubSpotError,
  type Contact,
  type Company,
  type Deal,
  type Ticket,
  type Engagement,
  type Association,
  type BatchResult,
  type SearchResult,
  type Pipeline,
  type PipelineStage,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          status: 'error',
          message: `No mock for ${key}`,
          correlationId: 'mock-correlation-id',
          category: 'OBJECT_NOT_FOUND',
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'x-request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: '123',
    properties: {
      email: 'user@example.com',
      firstname: 'John',
      lastname: 'Doe',
      phone: '+1234567890',
      createdate: new Date().toISOString(),
      lastmodifieddate: new Date().toISOString(),
      hs_object_id: '123',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    ...overrides,
  }
}

function mockCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: '456',
    properties: {
      name: 'Acme Inc',
      domain: 'acme.com',
      industry: 'Technology',
      createdate: new Date().toISOString(),
      lastmodifieddate: new Date().toISOString(),
      hs_object_id: '456',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    ...overrides,
  }
}

function mockDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: '789',
    properties: {
      dealname: 'New Deal',
      amount: '10000',
      dealstage: 'appointmentscheduled',
      pipeline: 'default',
      closedate: new Date().toISOString(),
      createdate: new Date().toISOString(),
      lastmodifieddate: new Date().toISOString(),
      hs_object_id: '789',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    ...overrides,
  }
}

function mockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '101',
    properties: {
      subject: 'Support Request',
      content: 'I need help with my account',
      hs_pipeline: 'default',
      hs_pipeline_stage: 'new',
      hs_ticket_priority: 'MEDIUM',
      createdate: new Date().toISOString(),
      lastmodifieddate: new Date().toISOString(),
      hs_object_id: '101',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    ...overrides,
  }
}

function mockEngagement(overrides: Partial<Engagement> = {}): Engagement {
  return {
    id: '202',
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_engagement_type: 'NOTE',
      hs_body_preview: 'This is a note',
      createdate: new Date().toISOString(),
      lastmodifieddate: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    ...overrides,
  }
}

// =============================================================================
// Client Tests
// =============================================================================

describe('@dotdo/hubspot - Client', () => {
  describe('initialization', () => {
    it('should create a client with access token', () => {
      const hubspot = new Client({ accessToken: 'pat-xxx' })
      expect(hubspot).toBeDefined()
      expect(hubspot.crm).toBeDefined()
      expect(hubspot.crm.contacts).toBeDefined()
      expect(hubspot.crm.companies).toBeDefined()
      expect(hubspot.crm.deals).toBeDefined()
      expect(hubspot.crm.tickets).toBeDefined()
      expect(hubspot.crm.associations).toBeDefined()
    })

    it('should throw error without authentication', () => {
      expect(() => new Client({} as any)).toThrow('Access token is required')
    })

    it('should accept configuration options', () => {
      const hubspot = new Client({
        accessToken: 'pat-xxx',
        basePath: 'https://api.hubapi.com',
      })
      expect(hubspot).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw HubSpotError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/objects/contacts/nonexistent',
            {
              status: 404,
              body: {
                status: 'error',
                message: 'Contact not found',
                correlationId: 'abc123',
                category: 'OBJECT_NOT_FOUND',
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })

      await expect(hubspot.crm.contacts.basicApi.getById('nonexistent')).rejects.toThrow(HubSpotError)

      try {
        await hubspot.crm.contacts.basicApi.getById('nonexistent')
      } catch (error) {
        expect(error).toBeInstanceOf(HubSpotError)
        const hsError = error as HubSpotError
        expect(hsError.category).toBe('OBJECT_NOT_FOUND')
        expect(hsError.statusCode).toBe(404)
      }
    })
  })
})

// =============================================================================
// Contacts Tests
// =============================================================================

describe('@dotdo/hubspot - Contacts', () => {
  describe('basicApi.create', () => {
    it('should create a contact with properties', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['POST /crm/v3/objects/contacts', { status: 201, body: expectedContact }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: {
          email: 'user@example.com',
          firstname: 'John',
          lastname: 'Doe',
          phone: '+1234567890',
        },
      })

      expect(contact.id).toBe('123')
      expect(contact.properties.email).toBe('user@example.com')
      expect(contact.properties.firstname).toBe('John')
    })
  })

  describe('basicApi.getById', () => {
    it('should get a contact by ID', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['GET /crm/v3/objects/contacts/123', { status: 200, body: expectedContact }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const contact = await hubspot.crm.contacts.basicApi.getById('123')

      expect(contact.id).toBe('123')
      expect(contact.properties.email).toBe('user@example.com')
    })

    it('should get a contact with specific properties', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['GET /crm/v3/objects/contacts/123', { status: 200, body: expectedContact }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const contact = await hubspot.crm.contacts.basicApi.getById('123', ['email', 'firstname'])

      expect(contact.id).toBe('123')
    })
  })

  describe('basicApi.update', () => {
    it('should update a contact', async () => {
      const updatedContact = mockContact({ properties: { ...mockContact().properties, firstname: 'Jane' } })
      const mockFetch = createMockFetch(
        new Map([['PATCH /crm/v3/objects/contacts/123', { status: 200, body: updatedContact }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const contact = await hubspot.crm.contacts.basicApi.update('123', {
        properties: { firstname: 'Jane' },
      })

      expect(contact.properties.firstname).toBe('Jane')
    })
  })

  describe('basicApi.archive', () => {
    it('should archive a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /crm/v3/objects/contacts/123', { status: 204, body: null }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      await hubspot.crm.contacts.basicApi.archive('123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/crm/v3/objects/contacts/123'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('searchApi.doSearch', () => {
    it('should search contacts by email', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/contacts/search',
            {
              status: 200,
              body: {
                total: 1,
                results: [mockContact()],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '@example.com' },
            ],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].properties.email).toBe('user@example.com')
    })

    it('should search with multiple filter groups (OR)', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/contacts/search',
            {
              status: 200,
              body: {
                total: 2,
                results: [mockContact(), mockContact({ id: '124' })],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [
          { filters: [{ propertyName: 'email', operator: 'EQ', value: 'user1@example.com' }] },
          { filters: [{ propertyName: 'email', operator: 'EQ', value: 'user2@example.com' }] },
        ],
      })

      expect(result.total).toBe(2)
    })
  })

  describe('batchApi.create', () => {
    it('should batch create contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/contacts/batch/create',
            {
              status: 201,
              body: {
                status: 'COMPLETE',
                results: [mockContact(), mockContact({ id: '124' })],
                errors: [],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.contacts.batchApi.create({
        inputs: [
          { properties: { email: 'user1@example.com', firstname: 'User', lastname: 'One' } },
          { properties: { email: 'user2@example.com', firstname: 'User', lastname: 'Two' } },
        ],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(2)
    })
  })

  describe('batchApi.read', () => {
    it('should batch read contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/contacts/batch/read',
            {
              status: 200,
              body: {
                status: 'COMPLETE',
                results: [mockContact(), mockContact({ id: '124' })],
                errors: [],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.contacts.batchApi.read({
        inputs: [{ id: '123' }, { id: '124' }],
        properties: ['email', 'firstname'],
      })

      expect(result.results).toHaveLength(2)
    })
  })

  describe('batchApi.update', () => {
    it('should batch update contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/contacts/batch/update',
            {
              status: 200,
              body: {
                status: 'COMPLETE',
                results: [
                  mockContact({ properties: { ...mockContact().properties, firstname: 'Updated1' } }),
                  mockContact({ id: '124', properties: { ...mockContact().properties, firstname: 'Updated2' } }),
                ],
                errors: [],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.contacts.batchApi.update({
        inputs: [
          { id: '123', properties: { firstname: 'Updated1' } },
          { id: '124', properties: { firstname: 'Updated2' } },
        ],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(2)
    })
  })

  describe('batchApi.archive', () => {
    it('should batch archive contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/contacts/batch/archive',
            { status: 204, body: null },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      await hubspot.crm.contacts.batchApi.archive({
        inputs: [{ id: '123' }, { id: '124' }],
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Companies Tests
// =============================================================================

describe('@dotdo/hubspot - Companies', () => {
  describe('basicApi.create', () => {
    it('should create a company', async () => {
      const expectedCompany = mockCompany()
      const mockFetch = createMockFetch(
        new Map([['POST /crm/v3/objects/companies', { status: 201, body: expectedCompany }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const company = await hubspot.crm.companies.basicApi.create({
        properties: {
          name: 'Acme Inc',
          domain: 'acme.com',
          industry: 'Technology',
        },
      })

      expect(company.id).toBe('456')
      expect(company.properties.name).toBe('Acme Inc')
      expect(company.properties.domain).toBe('acme.com')
    })
  })

  describe('basicApi.getById', () => {
    it('should get a company by ID', async () => {
      const expectedCompany = mockCompany()
      const mockFetch = createMockFetch(
        new Map([['GET /crm/v3/objects/companies/456', { status: 200, body: expectedCompany }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const company = await hubspot.crm.companies.basicApi.getById('456')

      expect(company.id).toBe('456')
      expect(company.properties.name).toBe('Acme Inc')
    })
  })

  describe('basicApi.update', () => {
    it('should update a company', async () => {
      const updatedCompany = mockCompany({ properties: { ...mockCompany().properties, name: 'Acme Corp' } })
      const mockFetch = createMockFetch(
        new Map([['PATCH /crm/v3/objects/companies/456', { status: 200, body: updatedCompany }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const company = await hubspot.crm.companies.basicApi.update('456', {
        properties: { name: 'Acme Corp' },
      })

      expect(company.properties.name).toBe('Acme Corp')
    })
  })

  describe('basicApi.archive', () => {
    it('should archive a company', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /crm/v3/objects/companies/456', { status: 204, body: null }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      await hubspot.crm.companies.basicApi.archive('456')

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('searchApi.doSearch', () => {
    it('should search companies by domain', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/companies/search',
            {
              status: 200,
              body: {
                total: 1,
                results: [mockCompany()],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.companies.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'domain', operator: 'EQ', value: 'acme.com' }],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.domain).toBe('acme.com')
    })
  })
})

// =============================================================================
// Deals Tests
// =============================================================================

describe('@dotdo/hubspot - Deals', () => {
  describe('basicApi.create', () => {
    it('should create a deal', async () => {
      const expectedDeal = mockDeal()
      const mockFetch = createMockFetch(
        new Map([['POST /crm/v3/objects/deals', { status: 201, body: expectedDeal }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'New Deal',
          amount: '10000',
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
        },
      })

      expect(deal.id).toBe('789')
      expect(deal.properties.dealname).toBe('New Deal')
      expect(deal.properties.amount).toBe('10000')
    })
  })

  describe('basicApi.getById', () => {
    it('should get a deal by ID', async () => {
      const expectedDeal = mockDeal()
      const mockFetch = createMockFetch(
        new Map([['GET /crm/v3/objects/deals/789', { status: 200, body: expectedDeal }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const deal = await hubspot.crm.deals.basicApi.getById('789')

      expect(deal.id).toBe('789')
      expect(deal.properties.dealname).toBe('New Deal')
    })
  })

  describe('basicApi.update', () => {
    it('should update a deal stage', async () => {
      const updatedDeal = mockDeal({ properties: { ...mockDeal().properties, dealstage: 'closedwon' } })
      const mockFetch = createMockFetch(
        new Map([['PATCH /crm/v3/objects/deals/789', { status: 200, body: updatedDeal }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const deal = await hubspot.crm.deals.basicApi.update('789', {
        properties: { dealstage: 'closedwon' },
      })

      expect(deal.properties.dealstage).toBe('closedwon')
    })
  })

  describe('basicApi.archive', () => {
    it('should archive a deal', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /crm/v3/objects/deals/789', { status: 204, body: null }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      await hubspot.crm.deals.basicApi.archive('789')

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('searchApi.doSearch', () => {
    it('should search deals by pipeline', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/deals/search',
            {
              status: 200,
              body: {
                total: 1,
                results: [mockDeal()],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'pipeline', operator: 'EQ', value: 'default' }],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.pipeline).toBe('default')
    })
  })
})

// =============================================================================
// Pipelines Tests
// =============================================================================

describe('@dotdo/hubspot - Pipelines', () => {
  describe('pipelinesApi.getAll', () => {
    it('should get all pipelines for deals', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/pipelines/deals',
            {
              status: 200,
              body: {
                results: [
                  {
                    id: 'default',
                    label: 'Sales Pipeline',
                    displayOrder: 0,
                    stages: [
                      { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0 },
                      { id: 'qualifiedtobuy', label: 'Qualified to Buy', displayOrder: 1 },
                      { id: 'closedwon', label: 'Closed Won', displayOrder: 2 },
                      { id: 'closedlost', label: 'Closed Lost', displayOrder: 3 },
                    ],
                  },
                ],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const pipelines = await hubspot.crm.pipelines.pipelinesApi.getAll('deals')

      expect(pipelines.results).toHaveLength(1)
      expect(pipelines.results[0].label).toBe('Sales Pipeline')
      expect(pipelines.results[0].stages).toHaveLength(4)
    })
  })

  describe('pipelineStagesApi.getAll', () => {
    it('should get stages for a pipeline', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/pipelines/deals/default/stages',
            {
              status: 200,
              body: {
                results: [
                  { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0 },
                  { id: 'qualifiedtobuy', label: 'Qualified to Buy', displayOrder: 1 },
                ],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const stages = await hubspot.crm.pipelines.pipelineStagesApi.getAll('deals', 'default')

      expect(stages.results).toHaveLength(2)
      expect(stages.results[0].label).toBe('Appointment Scheduled')
    })
  })
})

// =============================================================================
// Tickets Tests
// =============================================================================

describe('@dotdo/hubspot - Tickets', () => {
  describe('basicApi.create', () => {
    it('should create a ticket', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['POST /crm/v3/objects/tickets', { status: 201, body: expectedTicket }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const ticket = await hubspot.crm.tickets.basicApi.create({
        properties: {
          subject: 'Support Request',
          content: 'I need help with my account',
          hs_pipeline: 'default',
          hs_pipeline_stage: 'new',
          hs_ticket_priority: 'MEDIUM',
        },
      })

      expect(ticket.id).toBe('101')
      expect(ticket.properties.subject).toBe('Support Request')
    })
  })

  describe('basicApi.getById', () => {
    it('should get a ticket by ID', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['GET /crm/v3/objects/tickets/101', { status: 200, body: expectedTicket }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const ticket = await hubspot.crm.tickets.basicApi.getById('101')

      expect(ticket.id).toBe('101')
      expect(ticket.properties.subject).toBe('Support Request')
    })
  })

  describe('basicApi.update', () => {
    it('should update a ticket', async () => {
      const updatedTicket = mockTicket({
        properties: { ...mockTicket().properties, hs_pipeline_stage: 'resolved' },
      })
      const mockFetch = createMockFetch(
        new Map([['PATCH /crm/v3/objects/tickets/101', { status: 200, body: updatedTicket }]])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const ticket = await hubspot.crm.tickets.basicApi.update('101', {
        properties: { hs_pipeline_stage: 'resolved' },
      })

      expect(ticket.properties.hs_pipeline_stage).toBe('resolved')
    })
  })

  describe('searchApi.doSearch', () => {
    it('should search tickets by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/tickets/search',
            {
              status: 200,
              body: {
                total: 1,
                results: [mockTicket()],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.tickets.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'hs_pipeline_stage', operator: 'EQ', value: 'new' }],
          },
        ],
      })

      expect(result.total).toBe(1)
    })
  })
})

// =============================================================================
// Associations Tests
// =============================================================================

describe('@dotdo/hubspot - Associations', () => {
  describe('v4.basicApi.create', () => {
    it('should create an association between contact and company', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'PUT /crm/v4/objects/contacts/123/associations/companies/456',
            {
              status: 200,
              body: {
                fromObjectTypeId: '0-1',
                fromObjectId: 123,
                toObjectTypeId: '0-2',
                toObjectId: 456,
                labels: [],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.associations.v4.basicApi.create(
        'contacts',
        '123',
        'companies',
        '456',
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
      )

      expect(result.fromObjectId).toBe(123)
      expect(result.toObjectId).toBe(456)
    })
  })

  describe('v4.basicApi.getPage', () => {
    it('should get associations for an object', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v4/objects/contacts/123/associations/companies',
            {
              status: 200,
              body: {
                results: [
                  {
                    toObjectId: 456,
                    associationTypes: [
                      { category: 'HUBSPOT_DEFINED', typeId: 1, label: 'Primary' },
                    ],
                  },
                ],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.associations.v4.basicApi.getPage('contacts', '123', 'companies')

      expect(result.results).toHaveLength(1)
      expect(result.results[0].toObjectId).toBe(456)
    })
  })

  describe('v4.batchApi.create', () => {
    it('should batch create associations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v4/associations/contacts/companies/batch/create',
            {
              status: 200,
              body: {
                status: 'COMPLETE',
                results: [
                  { from: { id: '123' }, to: { id: '456' }, type: 'contact_to_company' },
                ],
                errors: [],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.associations.v4.batchApi.create('contacts', 'companies', {
        inputs: [
          {
            from: { id: '123' },
            to: { id: '456' },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }],
          },
        ],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(1)
    })
  })
})

// =============================================================================
// Engagements Tests (Notes, Emails, Calls, Meetings)
// =============================================================================

describe('@dotdo/hubspot - Engagements', () => {
  describe('notes.basicApi.create', () => {
    it('should create a note', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/notes',
            {
              status: 201,
              body: {
                id: '202',
                properties: {
                  hs_timestamp: new Date().toISOString(),
                  hs_note_body: 'This is a note about the contact',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const note = await hubspot.crm.objects.notes.basicApi.create({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: 'This is a note about the contact',
        },
      })

      expect(note.id).toBe('202')
      expect(note.properties.hs_note_body).toBe('This is a note about the contact')
    })
  })

  describe('emails.basicApi.create', () => {
    it('should create an email engagement', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/emails',
            {
              status: 201,
              body: {
                id: '303',
                properties: {
                  hs_timestamp: new Date().toISOString(),
                  hs_email_subject: 'Follow up',
                  hs_email_text: 'Thanks for your time today!',
                  hs_email_direction: 'OUTBOUND',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const email = await hubspot.crm.objects.emails.basicApi.create({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_email_subject: 'Follow up',
          hs_email_text: 'Thanks for your time today!',
          hs_email_direction: 'OUTBOUND',
        },
      })

      expect(email.id).toBe('303')
      expect(email.properties.hs_email_subject).toBe('Follow up')
    })
  })

  describe('calls.basicApi.create', () => {
    it('should create a call engagement', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/calls',
            {
              status: 201,
              body: {
                id: '404',
                properties: {
                  hs_timestamp: new Date().toISOString(),
                  hs_call_title: 'Discovery Call',
                  hs_call_body: 'Discussed project requirements',
                  hs_call_duration: '1800000',
                  hs_call_direction: 'OUTBOUND',
                  hs_call_status: 'COMPLETED',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const call = await hubspot.crm.objects.calls.basicApi.create({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_call_title: 'Discovery Call',
          hs_call_body: 'Discussed project requirements',
          hs_call_duration: '1800000',
          hs_call_direction: 'OUTBOUND',
          hs_call_status: 'COMPLETED',
        },
      })

      expect(call.id).toBe('404')
      expect(call.properties.hs_call_title).toBe('Discovery Call')
    })
  })

  describe('meetings.basicApi.create', () => {
    it('should create a meeting engagement', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/meetings',
            {
              status: 201,
              body: {
                id: '505',
                properties: {
                  hs_timestamp: new Date().toISOString(),
                  hs_meeting_title: 'Product Demo',
                  hs_meeting_body: 'Showing new features',
                  hs_meeting_start_time: new Date().toISOString(),
                  hs_meeting_end_time: new Date(Date.now() + 3600000).toISOString(),
                  hs_meeting_outcome: 'SCHEDULED',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const meeting = await hubspot.crm.objects.meetings.basicApi.create({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_meeting_title: 'Product Demo',
          hs_meeting_body: 'Showing new features',
          hs_meeting_start_time: new Date().toISOString(),
          hs_meeting_end_time: new Date(Date.now() + 3600000).toISOString(),
          hs_meeting_outcome: 'SCHEDULED',
        },
      })

      expect(meeting.id).toBe('505')
      expect(meeting.properties.hs_meeting_title).toBe('Product Demo')
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/hubspot - Request Options', () => {
  it('should pass authorization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockContact(),
    })

    const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
    await hubspot.crm.contacts.basicApi.getById('123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer pat-xxx',
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('should support custom base path', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockContact(),
    })

    const hubspot = new Client({
      accessToken: 'pat-xxx',
      basePath: 'https://custom.hubapi.com',
      fetch: mockFetch,
    })
    await hubspot.crm.contacts.basicApi.getById('123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://custom.hubapi.com'),
      expect.anything()
    )
  })
})

// =============================================================================
// Line Items Tests
// =============================================================================

describe('@dotdo/hubspot - Line Items', () => {
  describe('basicApi.create', () => {
    it('should create a line item', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/line_items',
            {
              status: 201,
              body: {
                id: '601',
                properties: {
                  name: 'Enterprise License',
                  hs_product_id: 'prod-123',
                  quantity: '5',
                  price: '1000',
                  amount: '5000',
                  createdate: new Date().toISOString(),
                  lastmodifieddate: new Date().toISOString(),
                  hs_object_id: '601',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const lineItem = await hubspot.crm.lineItems.basicApi.create({
        properties: {
          name: 'Enterprise License',
          hs_product_id: 'prod-123',
          quantity: '5',
          price: '1000',
        },
      })

      expect(lineItem.id).toBe('601')
      expect(lineItem.properties.name).toBe('Enterprise License')
      expect(lineItem.properties.quantity).toBe('5')
    })
  })

  describe('basicApi.getById', () => {
    it('should get a line item by ID', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/objects/line_items/601',
            {
              status: 200,
              body: {
                id: '601',
                properties: {
                  name: 'Enterprise License',
                  quantity: '5',
                  price: '1000',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const lineItem = await hubspot.crm.lineItems.basicApi.getById('601')

      expect(lineItem.id).toBe('601')
      expect(lineItem.properties.name).toBe('Enterprise License')
    })
  })
})

// =============================================================================
// Products Tests
// =============================================================================

describe('@dotdo/hubspot - Products', () => {
  describe('basicApi.create', () => {
    it('should create a product', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/products',
            {
              status: 201,
              body: {
                id: '701',
                properties: {
                  name: 'Enterprise Plan',
                  description: 'Full-featured enterprise solution',
                  price: '5000',
                  hs_recurring_billing_period: 'monthly',
                  createdate: new Date().toISOString(),
                  lastmodifieddate: new Date().toISOString(),
                  hs_object_id: '701',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const product = await hubspot.crm.products.basicApi.create({
        properties: {
          name: 'Enterprise Plan',
          description: 'Full-featured enterprise solution',
          price: '5000',
          hs_recurring_billing_period: 'monthly',
        },
      })

      expect(product.id).toBe('701')
      expect(product.properties.name).toBe('Enterprise Plan')
      expect(product.properties.price).toBe('5000')
    })
  })

  describe('searchApi.doSearch', () => {
    it('should search products by name', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/products/search',
            {
              status: 200,
              body: {
                total: 1,
                results: [
                  {
                    id: '701',
                    properties: {
                      name: 'Enterprise Plan',
                      price: '5000',
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    archived: false,
                  },
                ],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.products.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: 'Enterprise' }],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.name).toBe('Enterprise Plan')
    })
  })
})

// =============================================================================
// Quotes Tests
// =============================================================================

describe('@dotdo/hubspot - Quotes', () => {
  describe('basicApi.create', () => {
    it('should create a quote', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/objects/quotes',
            {
              status: 201,
              body: {
                id: '801',
                properties: {
                  hs_title: 'Q4 Enterprise Deal',
                  hs_expiration_date: '2025-03-31',
                  hs_status: 'DRAFT',
                  hs_quote_amount: '50000',
                  hs_currency: 'USD',
                  createdate: new Date().toISOString(),
                  lastmodifieddate: new Date().toISOString(),
                  hs_object_id: '801',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const quote = await hubspot.crm.quotes.basicApi.create({
        properties: {
          hs_title: 'Q4 Enterprise Deal',
          hs_expiration_date: '2025-03-31',
          hs_quote_amount: '50000',
          hs_currency: 'USD',
        },
      })

      expect(quote.id).toBe('801')
      expect(quote.properties.hs_title).toBe('Q4 Enterprise Deal')
      expect(quote.properties.hs_status).toBe('DRAFT')
    })
  })

  describe('basicApi.update', () => {
    it('should update quote status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /crm/v3/objects/quotes/801',
            {
              status: 200,
              body: {
                id: '801',
                properties: {
                  hs_title: 'Q4 Enterprise Deal',
                  hs_status: 'APPROVED',
                  hs_quote_amount: '50000',
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const quote = await hubspot.crm.quotes.basicApi.update('801', {
        properties: { hs_status: 'APPROVED' },
      })

      expect(quote.properties.hs_status).toBe('APPROVED')
    })
  })
})

// =============================================================================
// Owners Tests
// =============================================================================

describe('@dotdo/hubspot - Owners', () => {
  describe('getPage', () => {
    it('should get all owners', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/owners',
            {
              status: 200,
              body: {
                results: [
                  {
                    id: 'owner-123',
                    email: 'sales@example.com',
                    firstName: 'John',
                    lastName: 'Sales',
                    userId: 12345,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    archived: false,
                  },
                  {
                    id: 'owner-456',
                    email: 'manager@example.com',
                    firstName: 'Jane',
                    lastName: 'Manager',
                    userId: 12346,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    archived: false,
                  },
                ],
                paging: null,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.owners.getPage()

      expect(result.results).toHaveLength(2)
      expect(result.results[0].email).toBe('sales@example.com')
    })
  })

  describe('getById', () => {
    it('should get an owner by ID', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/owners/owner-123',
            {
              status: 200,
              body: {
                id: 'owner-123',
                email: 'sales@example.com',
                firstName: 'John',
                lastName: 'Sales',
                userId: 12345,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
                teams: [{ id: 'team-1', name: 'Sales Team', primary: true }],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const owner = await hubspot.crm.owners.getById('owner-123')

      expect(owner.id).toBe('owner-123')
      expect(owner.email).toBe('sales@example.com')
      expect(owner.teams).toHaveLength(1)
    })
  })
})

// =============================================================================
// Properties Tests
// =============================================================================

describe('@dotdo/hubspot - Properties', () => {
  describe('coreApi.getAll', () => {
    it('should get all properties for contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/properties/contacts',
            {
              status: 200,
              body: {
                results: [
                  {
                    name: 'email',
                    label: 'Email',
                    type: 'string',
                    fieldType: 'text',
                    groupName: 'contactinformation',
                    hasUniqueValue: true,
                    hubspotDefined: true,
                  },
                  {
                    name: 'firstname',
                    label: 'First Name',
                    type: 'string',
                    fieldType: 'text',
                    groupName: 'contactinformation',
                    hubspotDefined: true,
                  },
                ],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.properties.coreApi.getAll('contacts')

      expect(result.results).toHaveLength(2)
      expect(result.results[0].name).toBe('email')
    })
  })

  describe('coreApi.create', () => {
    it('should create a custom property', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/properties/contacts',
            {
              status: 201,
              body: {
                name: 'custom_score',
                label: 'Custom Score',
                type: 'number',
                fieldType: 'number',
                groupName: 'contactinformation',
                description: 'Custom engagement score',
                hasUniqueValue: false,
                hidden: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const property = await hubspot.crm.properties.coreApi.create('contacts', {
        name: 'custom_score',
        label: 'Custom Score',
        type: 'number',
        fieldType: 'number',
        groupName: 'contactinformation',
        description: 'Custom engagement score',
      })

      expect(property.name).toBe('custom_score')
      expect(property.type).toBe('number')
    })
  })

  describe('groupsApi.getAll', () => {
    it('should get all property groups', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/properties/contacts/groups',
            {
              status: 200,
              body: {
                results: [
                  {
                    name: 'contactinformation',
                    label: 'Contact Information',
                    displayOrder: 0,
                  },
                  {
                    name: 'companyinformation',
                    label: 'Company Information',
                    displayOrder: 1,
                  },
                ],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.properties.groupsApi.getAll('contacts')

      expect(result.results).toHaveLength(2)
      expect(result.results[0].name).toBe('contactinformation')
    })
  })
})

// =============================================================================
// Schemas Tests (Custom Objects)
// =============================================================================

describe('@dotdo/hubspot - Schemas', () => {
  describe('coreApi.getAll', () => {
    it('should get all schemas', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/schemas',
            {
              status: 200,
              body: {
                results: [
                  {
                    id: 'p123456_projects',
                    name: 'projects',
                    labels: { singular: 'Project', plural: 'Projects' },
                    fullyQualifiedName: 'p123456_projects',
                    primaryDisplayProperty: 'project_name',
                    properties: [
                      {
                        name: 'project_name',
                        label: 'Project Name',
                        type: 'string',
                        fieldType: 'text',
                        groupName: 'project_information',
                      },
                    ],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    archived: false,
                  },
                ],
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const result = await hubspot.crm.schemas.coreApi.getAll()

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('projects')
      expect(result.results[0].labels.singular).toBe('Project')
    })
  })

  describe('coreApi.create', () => {
    it('should create a custom object schema', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /crm/v3/schemas',
            {
              status: 201,
              body: {
                id: 'p123456_projects',
                name: 'projects',
                labels: { singular: 'Project', plural: 'Projects' },
                fullyQualifiedName: 'p123456_projects',
                primaryDisplayProperty: 'project_name',
                properties: [
                  {
                    name: 'project_name',
                    label: 'Project Name',
                    type: 'string',
                    fieldType: 'text',
                    groupName: 'project_information',
                  },
                ],
                associatedObjects: ['contacts', 'companies'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const schema = await hubspot.crm.schemas.coreApi.create({
        name: 'projects',
        labels: { singular: 'Project', plural: 'Projects' },
        primaryDisplayProperty: 'project_name',
        properties: [
          {
            name: 'project_name',
            label: 'Project Name',
            type: 'string',
            fieldType: 'text',
            groupName: 'project_information',
          },
        ],
        associatedObjects: ['contacts', 'companies'],
      })

      expect(schema.name).toBe('projects')
      expect(schema.labels.singular).toBe('Project')
      expect(schema.associatedObjects).toContain('contacts')
    })
  })

  describe('coreApi.getById', () => {
    it('should get a schema by object type', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /crm/v3/schemas/p123456_projects',
            {
              status: 200,
              body: {
                id: 'p123456_projects',
                name: 'projects',
                labels: { singular: 'Project', plural: 'Projects' },
                fullyQualifiedName: 'p123456_projects',
                primaryDisplayProperty: 'project_name',
                properties: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archived: false,
              },
            },
          ],
        ])
      )

      const hubspot = new Client({ accessToken: 'pat-xxx', fetch: mockFetch })
      const schema = await hubspot.crm.schemas.coreApi.getById('p123456_projects')

      expect(schema.name).toBe('projects')
    })
  })
})
