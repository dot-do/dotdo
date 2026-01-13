/**
 * @dotdo/freshdesk - Freshdesk API Compatibility Layer Tests
 *
 * Tests for the Freshdesk API compatibility layer including:
 * - Client initialization
 * - Tickets (create, get, update, delete, list, search)
 * - Contacts (create, get, update, list, search)
 * - Companies (create, get, update, list)
 * - Agents (list, get)
 * - Groups (list, get)
 * - Conversations (create reply, create note, list)
 * - Canned Responses (list, get)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  FreshdeskError,
  type Ticket,
  type Contact,
  type Company,
  type Agent,
  type Group,
  type Conversation,
  type CannedResponse,
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
          description: 'Resource not found',
          errors: [{ message: `No mock for ${key}`, code: 'not_found' }],
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

function mockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    subject: 'Sample Ticket',
    description: '<p>This is a sample ticket</p>',
    description_text: 'This is a sample ticket',
    status: 2,
    priority: 2,
    source: 2,
    type: 'Question',
    requester_id: 1001,
    responder_id: 2001,
    company_id: null,
    group_id: 1,
    product_id: null,
    email_config_id: null,
    to_emails: null,
    cc_emails: [],
    fwd_emails: [],
    reply_cc_emails: [],
    fr_escalated: false,
    spam: false,
    is_escalated: false,
    due_by: new Date(Date.now() + 86400000).toISOString(),
    fr_due_by: new Date(Date.now() + 3600000).toISOString(),
    tags: ['sample'],
    attachments: [],
    custom_fields: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 1001,
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    mobile: null,
    twitter_id: null,
    unique_external_id: null,
    description: null,
    address: null,
    job_title: null,
    language: 'en',
    time_zone: 'America/New_York',
    company_id: null,
    view_all_tickets: false,
    tags: [],
    custom_fields: {},
    active: true,
    deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 3001,
    name: 'Acme Corp',
    description: 'A sample company',
    note: null,
    domains: ['acme.com'],
    health_score: 'happy',
    account_tier: 'enterprise',
    renewal_date: null,
    industry: 'Technology',
    custom_fields: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 2001,
    contact: {
      id: 2001,
      name: 'Support Agent',
      email: 'agent@company.com',
      mobile: null,
      phone: null,
      job_title: 'Support Specialist',
      active: true,
    },
    type: 'support_agent',
    available: true,
    occasional: false,
    signature: null,
    group_ids: [1],
    role_ids: [1],
    skill_ids: [],
    ticket_scope: 1,
    focus_mode: false,
    available_since: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Support Team',
    description: 'Main support team',
    escalate_to: null,
    unassigned_for: null,
    business_hour_id: null,
    group_type: 'support_agent_group',
    agent_ids: [2001],
    auto_ticket_assign: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 5001,
    ticket_id: 1,
    user_id: 2001,
    body: '<p>Reply to the ticket</p>',
    body_text: 'Reply to the ticket',
    incoming: false,
    private: false,
    source: 2,
    source_additional_info: null,
    attachments: [],
    to_emails: ['john@example.com'],
    from_email: 'support@company.freshdesk.com',
    cc_emails: [],
    bcc_emails: [],
    support_email: 'support@company.freshdesk.com',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockCannedResponse(overrides: Partial<CannedResponse> = {}): CannedResponse {
  return {
    id: 6001,
    title: 'Greeting',
    content: 'Thank you for contacting us.',
    content_html: '<p>Thank you for contacting us.</p>',
    folder_id: 1,
    visibility: 0,
    attachments: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// =============================================================================
// Client Tests
// =============================================================================

describe('@dotdo/freshdesk - Client', () => {
  describe('initialization', () => {
    it('should create a client with domain and API key', () => {
      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
      })
      expect(client).toBeDefined()
      expect(client.tickets).toBeDefined()
      expect(client.contacts).toBeDefined()
      expect(client.companies).toBeDefined()
      expect(client.agents).toBeDefined()
      expect(client.groups).toBeDefined()
      expect(client.conversations).toBeDefined()
      expect(client.cannedResponses).toBeDefined()
    })

    it('should throw error without domain', () => {
      expect(() => new Client({ apiKey: 'test_api_key' } as any)).toThrow(
        'Domain is required'
      )
    })

    it('should throw error without API key', () => {
      expect(() => new Client({ domain: 'mycompany' } as any)).toThrow(
        'API key is required'
      )
    })
  })

  describe('error handling', () => {
    it('should throw FreshdeskError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets/999999',
            {
              status: 404,
              body: {
                description: 'Ticket not found',
                errors: [{ message: 'Ticket not found', code: 'not_found' }],
              },
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await expect(client.tickets.get(999999)).rejects.toThrow(FreshdeskError)

      try {
        await client.tickets.get(999999)
      } catch (error) {
        expect(error).toBeInstanceOf(FreshdeskError)
        const freshdeskError = error as FreshdeskError
        expect(freshdeskError.code).toBe('not_found')
        expect(freshdeskError.statusCode).toBe(404)
      }
    })
  })
})

// =============================================================================
// Tickets Tests
// =============================================================================

describe('@dotdo/freshdesk - Tickets', () => {
  describe('create', () => {
    it('should create a ticket', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Sample Ticket',
        description: 'This is a sample ticket',
        email: 'john@example.com',
        priority: 2,
        status: 2,
      })

      expect(ticket.id).toBe(1)
      expect(ticket.subject).toBe('Sample Ticket')
      expect(ticket.priority).toBe(2)
    })

    it('should create a ticket with custom fields', async () => {
      const expectedTicket = mockTicket({
        custom_fields: { cf_category: 'billing' },
      })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Billing Question',
        description: 'Question about billing',
        email: 'john@example.com',
        custom_fields: { cf_category: 'billing' },
      })

      expect(ticket.custom_fields.cf_category).toBe('billing')
    })

    it('should create a ticket with tags', async () => {
      const expectedTicket = mockTicket({ tags: ['urgent', 'billing'] })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Urgent billing issue',
        description: 'Please help',
        email: 'john@example.com',
        tags: ['urgent', 'billing'],
      })

      expect(ticket.tags).toContain('urgent')
      expect(ticket.tags).toContain('billing')
    })
  })

  describe('get', () => {
    it('should get a ticket by ID', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/tickets/1', { status: 200, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.get(1)

      expect(ticket.id).toBe(1)
      expect(ticket.subject).toBe('Sample Ticket')
    })
  })

  describe('update', () => {
    it('should update a ticket status', async () => {
      const updatedTicket = mockTicket({ status: 3 })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/1', { status: 200, body: updatedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.update(1, {
        status: 3,
      })

      expect(ticket.status).toBe(3)
    })

    it('should update ticket priority', async () => {
      const updatedTicket = mockTicket({ priority: 4 })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/1', { status: 200, body: updatedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.update(1, {
        priority: 4,
      })

      expect(ticket.priority).toBe(4)
    })

    it('should assign a ticket to an agent', async () => {
      const updatedTicket = mockTicket({ responder_id: 2001 })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/1', { status: 200, body: updatedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.update(1, {
        responder_id: 2001,
      })

      expect(ticket.responder_id).toBe(2001)
    })
  })

  describe('delete', () => {
    it('should delete a ticket', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/tickets/1', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.tickets.delete(1)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/tickets/1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('list', () => {
    it('should list tickets', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets',
            {
              status: 200,
              body: [mockTicket({ id: 1 }), mockTicket({ id: 2 })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const tickets = await client.tickets.list()

      expect(tickets).toHaveLength(2)
      expect(tickets[0].id).toBe(1)
      expect(tickets[1].id).toBe(2)
    })

    it('should filter tickets by email', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets',
            {
              status: 200,
              body: [mockTicket()],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const tickets = await client.tickets.list({ email: 'john@example.com' })

      expect(tickets).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('email=john'),
        expect.anything()
      )
    })
  })

  describe('search', () => {
    it('should search tickets by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/search/tickets',
            {
              status: 200,
              body: { results: [mockTicket()], total: 1 },
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const result = await client.tickets.search({ query: '"status:2"' })

      expect(result.results).toHaveLength(1)
      expect(result.total).toBe(1)
    })
  })
})

// =============================================================================
// Contacts Tests
// =============================================================================

describe('@dotdo/freshdesk - Contacts', () => {
  describe('create', () => {
    it('should create a contact', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/contacts', { status: 201, body: expectedContact }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const contact = await client.contacts.create({
        name: 'John Doe',
        email: 'john@example.com',
      })

      expect(contact.id).toBe(1001)
      expect(contact.name).toBe('John Doe')
      expect(contact.email).toBe('john@example.com')
    })
  })

  describe('get', () => {
    it('should get a contact by ID', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/contacts/1001', { status: 200, body: expectedContact }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const contact = await client.contacts.get(1001)

      expect(contact.id).toBe(1001)
      expect(contact.name).toBe('John Doe')
    })
  })

  describe('update', () => {
    it('should update a contact', async () => {
      const updatedContact = mockContact({ name: 'Jane Doe' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/contacts/1001', { status: 200, body: updatedContact }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const contact = await client.contacts.update(1001, {
        name: 'Jane Doe',
      })

      expect(contact.name).toBe('Jane Doe')
    })
  })

  describe('delete', () => {
    it('should delete a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/contacts/1001', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.contacts.delete(1001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/contacts/1001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('list', () => {
    it('should list contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/contacts',
            {
              status: 200,
              body: [mockContact({ id: 1001 }), mockContact({ id: 1002, name: 'Jane Doe' })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const contacts = await client.contacts.list()

      expect(contacts).toHaveLength(2)
    })
  })

  describe('search', () => {
    it('should search contacts by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/search/contacts',
            {
              status: 200,
              body: { results: [mockContact()], total: 1 },
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const result = await client.contacts.search({ query: '"email:john@example.com"' })

      expect(result.results).toHaveLength(1)
    })
  })
})

// =============================================================================
// Companies Tests
// =============================================================================

describe('@dotdo/freshdesk - Companies', () => {
  describe('create', () => {
    it('should create a company', async () => {
      const expectedCompany = mockCompany()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/companies', { status: 201, body: expectedCompany }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const company = await client.companies.create({
        name: 'Acme Corp',
        domains: ['acme.com'],
      })

      expect(company.id).toBe(3001)
      expect(company.name).toBe('Acme Corp')
    })
  })

  describe('get', () => {
    it('should get a company by ID', async () => {
      const expectedCompany = mockCompany()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/companies/3001', { status: 200, body: expectedCompany }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const company = await client.companies.get(3001)

      expect(company.id).toBe(3001)
      expect(company.name).toBe('Acme Corp')
    })
  })

  describe('update', () => {
    it('should update a company', async () => {
      const updatedCompany = mockCompany({ name: 'Acme Corporation' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/companies/3001', { status: 200, body: updatedCompany }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const company = await client.companies.update(3001, {
        name: 'Acme Corporation',
      })

      expect(company.name).toBe('Acme Corporation')
    })
  })

  describe('delete', () => {
    it('should delete a company', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/companies/3001', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.companies.delete(3001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/companies/3001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('list', () => {
    it('should list companies', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/companies',
            {
              status: 200,
              body: [mockCompany({ id: 3001 }), mockCompany({ id: 3002, name: 'Beta Inc' })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const companies = await client.companies.list()

      expect(companies).toHaveLength(2)
    })
  })
})

// =============================================================================
// Agents Tests
// =============================================================================

describe('@dotdo/freshdesk - Agents', () => {
  describe('list', () => {
    it('should list agents', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/agents',
            {
              status: 200,
              body: [mockAgent({ id: 2001 }), mockAgent({ id: 2002 })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const agents = await client.agents.list()

      expect(agents).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get an agent by ID', async () => {
      const expectedAgent = mockAgent()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/agents/2001', { status: 200, body: expectedAgent }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const agent = await client.agents.get(2001)

      expect(agent.id).toBe(2001)
      expect(agent.contact.name).toBe('Support Agent')
    })
  })
})

// =============================================================================
// Groups Tests
// =============================================================================

describe('@dotdo/freshdesk - Groups', () => {
  describe('list', () => {
    it('should list groups', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/groups',
            {
              status: 200,
              body: [mockGroup({ id: 1 }), mockGroup({ id: 2, name: 'Sales Team' })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const groups = await client.groups.list()

      expect(groups).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get a group by ID', async () => {
      const expectedGroup = mockGroup()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/groups/1', { status: 200, body: expectedGroup }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const group = await client.groups.get(1)

      expect(group.id).toBe(1)
      expect(group.name).toBe('Support Team')
    })
  })

  describe('create', () => {
    it('should create a group', async () => {
      const expectedGroup = mockGroup()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/groups', { status: 201, body: expectedGroup }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const group = await client.groups.create({
        name: 'Support Team',
        description: 'Main support team',
      })

      expect(group.id).toBe(1)
      expect(group.name).toBe('Support Team')
    })
  })
})

// =============================================================================
// Conversations Tests
// =============================================================================

describe('@dotdo/freshdesk - Conversations', () => {
  describe('list', () => {
    it('should list conversations for a ticket', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets/1/conversations',
            {
              status: 200,
              body: [mockConversation({ id: 5001 }), mockConversation({ id: 5002 })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const conversations = await client.conversations.list(1)

      expect(conversations).toHaveLength(2)
    })
  })

  describe('createReply', () => {
    it('should create a reply to a ticket', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets/1/reply', { status: 201, body: expectedConversation }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const conversation = await client.conversations.createReply(1, {
        body: 'Reply to the ticket',
      })

      expect(conversation.id).toBe(5001)
      expect(conversation.body_text).toBe('Reply to the ticket')
    })
  })

  describe('createNote', () => {
    it('should create a private note on a ticket', async () => {
      const expectedConversation = mockConversation({ private: true })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets/1/notes', { status: 201, body: expectedConversation }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const conversation = await client.conversations.createNote(1, {
        body: 'Internal note',
        private: true,
      })

      expect(conversation.private).toBe(true)
    })
  })
})

// =============================================================================
// Canned Responses Tests
// =============================================================================

describe('@dotdo/freshdesk - Canned Responses', () => {
  describe('list', () => {
    it('should list canned responses', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/canned_responses',
            {
              status: 200,
              body: [mockCannedResponse({ id: 6001 }), mockCannedResponse({ id: 6002 })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const responses = await client.cannedResponses.list()

      expect(responses).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get a canned response by ID', async () => {
      const expectedResponse = mockCannedResponse()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/canned_responses/6001', { status: 200, body: expectedResponse }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const response = await client.cannedResponses.get(6001)

      expect(response.id).toBe(6001)
      expect(response.title).toBe('Greeting')
    })
  })

  describe('listInFolder', () => {
    it('should list canned responses in a folder', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/canned_response_folders/1/responses',
            {
              status: 200,
              body: [mockCannedResponse({ id: 6001, folder_id: 1 })],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const responses = await client.cannedResponses.listInFolder(1)

      expect(responses).toHaveLength(1)
      expect(responses[0].folder_id).toBe(1)
    })
  })

  describe('listFolders', () => {
    it('should list canned response folders', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/canned_response_folders',
            {
              status: 200,
              body: [
                { id: 1, name: 'General', responses_count: 5 },
                { id: 2, name: 'Technical', responses_count: 3 },
              ],
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const folders = await client.cannedResponses.listFolders()

      expect(folders).toHaveLength(2)
      expect(folders[0].name).toBe('General')
    })
  })
})

// =============================================================================
// Additional Tickets Tests
// =============================================================================

describe('@dotdo/freshdesk - Tickets (Extended)', () => {
  describe('restore', () => {
    it('should restore a deleted ticket', async () => {
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/1/restore', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.tickets.restore(1)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/tickets/1/restore'),
        expect.objectContaining({ method: 'PUT' })
      )
    })
  })

  describe('ticket priorities', () => {
    it('should create a low priority ticket', async () => {
      const expectedTicket = mockTicket({ priority: 1 })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Low priority issue',
        description: 'Not urgent',
        email: 'john@example.com',
        priority: 1,
      })

      expect(ticket.priority).toBe(1)
    })

    it('should create an urgent priority ticket', async () => {
      const expectedTicket = mockTicket({ priority: 4 })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Urgent issue',
        description: 'Critical problem',
        email: 'john@example.com',
        priority: 4,
      })

      expect(ticket.priority).toBe(4)
    })
  })

  describe('ticket sources', () => {
    it('should create a ticket from email source', async () => {
      const expectedTicket = mockTicket({ source: 1 })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Email ticket',
        description: 'From email',
        email: 'john@example.com',
        source: 1,
      })

      expect(ticket.source).toBe(1)
    })

    it('should create a ticket from chat source', async () => {
      const expectedTicket = mockTicket({ source: 7 })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: expectedTicket }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Chat ticket',
        description: 'From live chat',
        email: 'john@example.com',
        source: 7,
      })

      expect(ticket.source).toBe(7)
    })
  })
})

// =============================================================================
// Additional Contacts Tests
// =============================================================================

describe('@dotdo/freshdesk - Contacts (Extended)', () => {
  describe('hardDelete', () => {
    it('should permanently delete a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/contacts/1001/hard_delete', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.contacts.hardDelete(1001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/contacts/1001/hard_delete'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('restore', () => {
    it('should restore a soft-deleted contact', async () => {
      const restoredContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/contacts/1001/restore', { status: 200, body: restoredContact }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const contact = await client.contacts.restore(1001)

      expect(contact.id).toBe(1001)
    })
  })

  describe('makeAgent', () => {
    it('should convert a contact to an agent', async () => {
      const newAgent = mockAgent()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/contacts/1001/make_agent', { status: 200, body: newAgent }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const agent = await client.contacts.makeAgent(1001)

      expect(agent.id).toBe(2001)
      expect(agent.type).toBe('support_agent')
    })
  })

  describe('merge', () => {
    it('should merge two contacts', async () => {
      const mergedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/contacts/1001/merge', { status: 200, body: mergedContact }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const contact = await client.contacts.merge(1001, 1002)

      expect(contact.id).toBe(1001)
    })
  })
})

// =============================================================================
// Additional Agents Tests
// =============================================================================

describe('@dotdo/freshdesk - Agents (Extended)', () => {
  describe('create', () => {
    it('should create an agent', async () => {
      const expectedAgent = mockAgent()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/agents', { status: 201, body: expectedAgent }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const agent = await client.agents.create({
        email: 'newagent@company.com',
        name: 'New Agent',
      })

      expect(agent.id).toBe(2001)
    })
  })

  describe('update', () => {
    it('should update an agent', async () => {
      const updatedAgent = mockAgent({ signature: 'Best regards, Support' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/agents/2001', { status: 200, body: updatedAgent }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const agent = await client.agents.update(2001, {
        signature: 'Best regards, Support',
      })

      expect(agent.signature).toBe('Best regards, Support')
    })
  })

  describe('delete', () => {
    it('should delete an agent', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/agents/2001', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.agents.delete(2001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/agents/2001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('me', () => {
    it('should get the current agent', async () => {
      const expectedAgent = mockAgent()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/agents/me', { status: 200, body: expectedAgent }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const agent = await client.agents.me()

      expect(agent.id).toBe(2001)
    })
  })
})

// =============================================================================
// Additional Groups Tests
// =============================================================================

describe('@dotdo/freshdesk - Groups (Extended)', () => {
  describe('update', () => {
    it('should update a group', async () => {
      const updatedGroup = mockGroup({ name: 'Updated Support Team' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/groups/1', { status: 200, body: updatedGroup }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const group = await client.groups.update(1, {
        name: 'Updated Support Team',
      })

      expect(group.name).toBe('Updated Support Team')
    })
  })

  describe('delete', () => {
    it('should delete a group', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/groups/1', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.groups.delete(1)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/groups/1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Additional Conversations Tests
// =============================================================================

describe('@dotdo/freshdesk - Conversations (Extended)', () => {
  describe('update', () => {
    it('should update a conversation note', async () => {
      const updatedConversation = mockConversation({ body: 'Updated note content' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/conversations/5001', { status: 200, body: updatedConversation }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const conversation = await client.conversations.update(5001, {
        body: 'Updated note content',
      })

      expect(conversation.body).toContain('Updated note content')
    })
  })

  describe('delete', () => {
    it('should delete a conversation', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/conversations/5001', { status: 204, body: {} }]])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      await client.conversations.delete(5001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/conversations/5001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Companies Search Tests
// =============================================================================

describe('@dotdo/freshdesk - Companies (Extended)', () => {
  describe('search', () => {
    it('should search companies by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/search/companies',
            {
              status: 200,
              body: { results: [mockCompany()], total: 1 },
            },
          ],
        ])
      )

      const client = new Client({
        domain: 'mycompany',
        apiKey: 'test_api_key',
        fetch: mockFetch,
      })

      const result = await client.companies.search({ query: '"name:Acme"' })

      expect(result.results).toHaveLength(1)
      expect(result.total).toBe(1)
    })
  })
})
