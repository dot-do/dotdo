/**
 * @dotdo/hubspot - HubSpot API Compatibility Layer Tests
 *
 * Tests for the HubSpot API compatibility layer including:
 * - Client initialization
 * - Contacts (create, get, update, delete, search, batch)
 * - Companies (create, get, update, delete, search)
 * - Deals (create, get, update, delete, search)
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
} from '../src'

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
})

// =============================================================================
// Engagements Tests
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
