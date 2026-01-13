/**
 * @dotdo/salesforce - Standard Object CRUD Tests (RED Phase)
 *
 * TDD Red phase tests for Salesforce standard object CRUD operations.
 * Tests cover create, read, update, delete for:
 * - Account
 * - Contact
 * - Opportunity
 *
 * These tests define the expected behavior for the Salesforce compatibility layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Connection, SalesforceError } from '../index'
import type { SObject, SaveResult, QueryResult } from '../types'
import type { Account, Contact, Opportunity } from '../objects'

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
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [{ errorCode: 'NOT_FOUND', message: `No mock for ${key}` }],
        text: async () => JSON.stringify([{ errorCode: 'NOT_FOUND', message: `No mock for ${key}` }]),
      }
    }

    const isTextBody = typeof mockResponse.body === 'string'
    const contentType = isTextBody ? 'text/csv' : 'application/json'

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'content-type': contentType }),
      json: async () => mockResponse.body,
      text: async () => typeof mockResponse.body === 'string' ? mockResponse.body : JSON.stringify(mockResponse.body),
    }
  })
}

// =============================================================================
// Account CRUD Tests
// =============================================================================

describe('@dotdo/salesforce - Account CRUD Operations', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('Create Account', () => {
    it('should create an Account with required fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Account',
            {
              status: 201,
              body: { id: '001xx000003DGxYAAW', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const account: Partial<Account> = {
        Name: 'Test Account',
      }

      const result = await conn.sobject('Account').create(account)

      expect(result.id).toBe('001xx000003DGxYAAW')
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should create an Account with all standard fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Account',
            {
              status: 201,
              body: { id: '001xx000003DGxYAAW', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const account: Partial<Account> = {
        Name: 'Acme Corporation',
        Type: 'Customer - Direct',
        Industry: 'Technology',
        Phone: '(555) 123-4567',
        Website: 'https://acme.com',
        BillingStreet: '123 Main St',
        BillingCity: 'San Francisco',
        BillingState: 'CA',
        BillingPostalCode: '94102',
        BillingCountry: 'USA',
        Description: 'A leading technology company',
        NumberOfEmployees: 1000,
        AnnualRevenue: 50000000,
        Rating: 'Hot',
      }

      const result = await conn.sobject('Account').create(account)

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sobjects/Account'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Acme Corporation'),
        })
      )
    })

    it('should fail to create Account without Name', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Account',
            {
              status: 400,
              body: [
                {
                  errorCode: 'REQUIRED_FIELD_MISSING',
                  message: 'Required fields are missing: [Name]',
                  fields: ['Name'],
                },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(conn.sobject('Account').create({ Industry: 'Technology' })).rejects.toThrow(SalesforceError)
    })

    it('should create multiple Accounts in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '001xx000003DGxYAAW', success: true, errors: [] },
                { id: '001xx000003DGxZAAW', success: true, errors: [] },
                { id: '001xx000003DGx0AAW', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const accounts = [
        { Name: 'Account 1' },
        { Name: 'Account 2' },
        { Name: 'Account 3' },
      ]

      const results = await conn.sobject('Account').create(accounts)

      expect(results).toHaveLength(3)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
      expect(results[2].success).toBe(true)
    })
  })

  describe('Read Account', () => {
    it('should retrieve an Account by Id', async () => {
      const accountData: Account = {
        Id: '001xx000003DGxYAAW',
        Name: 'Test Account',
        Type: 'Customer - Direct',
        Industry: 'Technology',
        Phone: '(555) 123-4567',
        Website: 'https://test.com',
        attributes: { type: 'Account', url: '/services/data/v59.0/sobjects/Account/001xx000003DGxYAAW' },
      }

      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            { status: 200, body: accountData },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const account = await conn.sobject('Account').retrieve('001xx000003DGxYAAW')

      expect(account.Id).toBe('001xx000003DGxYAAW')
      expect(account.Name).toBe('Test Account')
      expect(account.Type).toBe('Customer - Direct')
      expect(account.Industry).toBe('Technology')
    })

    it('should retrieve an Account with specific fields only', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            {
              status: 200,
              body: { Id: '001xx000003DGxYAAW', Name: 'Test Account', Industry: 'Technology' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const account = await conn.sobject('Account').retrieve('001xx000003DGxYAAW', ['Id', 'Name', 'Industry'])

      expect(account.Id).toBe('001xx000003DGxYAAW')
      expect(account.Name).toBe('Test Account')
      expect(account.Industry).toBe('Technology')
    })

    it('should return 404 for non-existent Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/001xx000003NONEX',
            {
              status: 404,
              body: [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(conn.sobject('Account').retrieve('001xx000003NONEX')).rejects.toThrow(SalesforceError)
    })

    it('should query Accounts with SOQL', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 2,
                done: true,
                records: [
                  { Id: '001xx000003DGxYAAW', Name: 'Acme Inc', Industry: 'Technology' },
                  { Id: '001xx000003DGxZAAW', Name: 'Globex Corp', Industry: 'Technology' },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query<Account>("SELECT Id, Name, Industry FROM Account WHERE Industry = 'Technology'")

      expect(result.totalSize).toBe(2)
      expect(result.done).toBe(true)
      expect(result.records).toHaveLength(2)
      expect(result.records[0].Name).toBe('Acme Inc')
    })

    it('should retrieve multiple Accounts by Ids', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/composite/sobjects/Account',
            {
              status: 200,
              body: [
                { Id: '001xx000003DGxYAAW', Name: 'Account 1' },
                { Id: '001xx000003DGxZAAW', Name: 'Account 2' },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const accounts = await conn.sobject('Account').retrieve(['001xx000003DGxYAAW', '001xx000003DGxZAAW'])

      expect(accounts).toHaveLength(2)
      expect(accounts[0].Name).toBe('Account 1')
      expect(accounts[1].Name).toBe('Account 2')
    })
  })

  describe('Update Account', () => {
    it('should update an Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Account').update({
        Id: '001xx000003DGxYAAW',
        Name: 'Updated Account Name',
        Industry: 'Healthcare',
      })

      expect(result.id).toBe('001xx000003DGxYAAW')
      expect(result.success).toBe(true)
    })

    it('should fail to update non-existent Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Account/001xx000003NONEX',
            {
              status: 404,
              body: [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(
        conn.sobject('Account').update({ Id: '001xx000003NONEX', Name: 'Updated' })
      ).rejects.toThrow(SalesforceError)
    })

    it('should update multiple Accounts in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '001xx000003DGxYAAW', success: true, errors: [] },
                { id: '001xx000003DGxZAAW', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const results = await conn.sobject('Account').update([
        { Id: '001xx000003DGxYAAW', Rating: 'Hot' },
        { Id: '001xx000003DGxZAAW', Rating: 'Warm' },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })

  describe('Delete Account', () => {
    it('should delete an Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Account').destroy('001xx000003DGxYAAW')

      expect(result.id).toBe('001xx000003DGxYAAW')
      expect(result.success).toBe(true)
    })

    it('should fail to delete non-existent Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/sobjects/Account/001xx000003NONEX',
            {
              status: 404,
              body: [{ errorCode: 'ENTITY_IS_DELETED', message: 'entity is deleted' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(conn.sobject('Account').destroy('001xx000003NONEX')).rejects.toThrow(SalesforceError)
    })

    it('should delete multiple Accounts in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '001xx000003DGxYAAW', success: true, errors: [] },
                { id: '001xx000003DGxZAAW', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const results = await conn.sobject('Account').destroy(['001xx000003DGxYAAW', '001xx000003DGxZAAW'])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })
})

// =============================================================================
// Contact CRUD Tests
// =============================================================================

describe('@dotdo/salesforce - Contact CRUD Operations', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('Create Contact', () => {
    it('should create a Contact with required fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Contact',
            {
              status: 201,
              body: { id: '003xx000004TmiQAAS', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const contact: Partial<Contact> = {
        LastName: 'Doe',
      }

      const result = await conn.sobject('Contact').create(contact)

      expect(result.id).toBe('003xx000004TmiQAAS')
      expect(result.success).toBe(true)
    })

    it('should create a Contact with all standard fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Contact',
            {
              status: 201,
              body: { id: '003xx000004TmiQAAS', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const contact: Partial<Contact> = {
        FirstName: 'John',
        LastName: 'Doe',
        Salutation: 'Mr.',
        Email: 'john.doe@example.com',
        Phone: '(555) 123-4567',
        MobilePhone: '(555) 987-6543',
        Title: 'VP of Engineering',
        Department: 'Engineering',
        AccountId: '001xx000003DGxYAAW',
        MailingStreet: '456 Oak Ave',
        MailingCity: 'Palo Alto',
        MailingState: 'CA',
        MailingPostalCode: '94301',
        MailingCountry: 'USA',
        Birthdate: '1985-06-15',
        Description: 'Key decision maker',
        LeadSource: 'Web',
      }

      const result = await conn.sobject('Contact').create(contact)

      expect(result.success).toBe(true)
    })

    it('should fail to create Contact without LastName', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Contact',
            {
              status: 400,
              body: [
                {
                  errorCode: 'REQUIRED_FIELD_MISSING',
                  message: 'Required fields are missing: [LastName]',
                  fields: ['LastName'],
                },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(conn.sobject('Contact').create({ FirstName: 'John' })).rejects.toThrow(SalesforceError)
    })

    it('should create Contact associated with an Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Contact',
            {
              status: 201,
              body: { id: '003xx000004TmiQAAS', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const contact: Partial<Contact> = {
        FirstName: 'Jane',
        LastName: 'Smith',
        AccountId: '001xx000003DGxYAAW',
        Email: 'jane.smith@acme.com',
      }

      const result = await conn.sobject('Contact').create(contact)

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sobjects/Contact'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('001xx000003DGxYAAW'),
        })
      )
    })

    it('should create multiple Contacts in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '003xx000004TmiQAAS', success: true, errors: [] },
                { id: '003xx000004TmiRAAS', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const contacts = [
        { FirstName: 'John', LastName: 'Doe' },
        { FirstName: 'Jane', LastName: 'Smith' },
      ]

      const results = await conn.sobject('Contact').create(contacts)

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })

  describe('Read Contact', () => {
    it('should retrieve a Contact by Id', async () => {
      const contactData: Contact = {
        Id: '003xx000004TmiQAAS',
        FirstName: 'John',
        LastName: 'Doe',
        Email: 'john.doe@example.com',
        AccountId: '001xx000003DGxYAAW',
        attributes: { type: 'Contact', url: '/services/data/v59.0/sobjects/Contact/003xx000004TmiQAAS' },
      }

      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Contact/003xx000004TmiQAAS',
            { status: 200, body: contactData },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const contact = await conn.sobject('Contact').retrieve('003xx000004TmiQAAS')

      expect(contact.Id).toBe('003xx000004TmiQAAS')
      expect(contact.FirstName).toBe('John')
      expect(contact.LastName).toBe('Doe')
      expect(contact.Email).toBe('john.doe@example.com')
    })

    it('should query Contacts by AccountId', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 2,
                done: true,
                records: [
                  { Id: '003xx000004TmiQAAS', FirstName: 'John', LastName: 'Doe', AccountId: '001xx000003DGxYAAW' },
                  { Id: '003xx000004TmiRAAS', FirstName: 'Jane', LastName: 'Smith', AccountId: '001xx000003DGxYAAW' },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query<Contact>("SELECT Id, FirstName, LastName, AccountId FROM Contact WHERE AccountId = '001xx000003DGxYAAW'")

      expect(result.totalSize).toBe(2)
      expect(result.records).toHaveLength(2)
    })

    it('should query Contacts with related Account data', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 1,
                done: true,
                records: [
                  {
                    Id: '003xx000004TmiQAAS',
                    FirstName: 'John',
                    LastName: 'Doe',
                    Account: {
                      Id: '001xx000003DGxYAAW',
                      Name: 'Acme Inc',
                    },
                  },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query<Contact & { Account: Account }>('SELECT Id, FirstName, LastName, Account.Id, Account.Name FROM Contact')

      expect(result.records[0].Account.Name).toBe('Acme Inc')
    })
  })

  describe('Update Contact', () => {
    it('should update a Contact', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Contact/003xx000004TmiQAAS',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Contact').update({
        Id: '003xx000004TmiQAAS',
        Title: 'Senior VP of Engineering',
        Phone: '(555) 999-8888',
      })

      expect(result.id).toBe('003xx000004TmiQAAS')
      expect(result.success).toBe(true)
    })

    it('should update Contact email opt-out preferences', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Contact/003xx000004TmiQAAS',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Contact').update({
        Id: '003xx000004TmiQAAS',
        HasOptedOutOfEmail: true,
        DoNotCall: true,
      })

      expect(result.success).toBe(true)
    })

    it('should update multiple Contacts in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '003xx000004TmiQAAS', success: true, errors: [] },
                { id: '003xx000004TmiRAAS', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const results = await conn.sobject('Contact').update([
        { Id: '003xx000004TmiQAAS', Department: 'Sales' },
        { Id: '003xx000004TmiRAAS', Department: 'Marketing' },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })

  describe('Delete Contact', () => {
    it('should delete a Contact', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/sobjects/Contact/003xx000004TmiQAAS',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Contact').destroy('003xx000004TmiQAAS')

      expect(result.id).toBe('003xx000004TmiQAAS')
      expect(result.success).toBe(true)
    })

    it('should delete multiple Contacts in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '003xx000004TmiQAAS', success: true, errors: [] },
                { id: '003xx000004TmiRAAS', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const results = await conn.sobject('Contact').destroy(['003xx000004TmiQAAS', '003xx000004TmiRAAS'])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })
})

// =============================================================================
// Opportunity CRUD Tests
// =============================================================================

describe('@dotdo/salesforce - Opportunity CRUD Operations', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('Create Opportunity', () => {
    it('should create an Opportunity with required fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Opportunity',
            {
              status: 201,
              body: { id: '006xx000001Sv6tAAC', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const opportunity: Partial<Opportunity> = {
        Name: 'New Enterprise Deal',
        StageName: 'Prospecting',
        CloseDate: '2026-03-31',
      }

      const result = await conn.sobject('Opportunity').create(opportunity)

      expect(result.id).toBe('006xx000001Sv6tAAC')
      expect(result.success).toBe(true)
    })

    it('should create an Opportunity with all standard fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Opportunity',
            {
              status: 201,
              body: { id: '006xx000001Sv6tAAC', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const opportunity: Partial<Opportunity> = {
        Name: 'Acme - Enterprise Platform',
        StageName: 'Qualification',
        CloseDate: '2026-06-30',
        AccountId: '001xx000003DGxYAAW',
        Amount: 500000,
        Probability: 25,
        Type: 'New Customer',
        LeadSource: 'Partner Referral',
        NextStep: 'Schedule technical demo',
        Description: 'Large enterprise platform deployment',
        ForecastCategory: 'Pipeline',
      }

      const result = await conn.sobject('Opportunity').create(opportunity)

      expect(result.success).toBe(true)
    })

    it('should fail to create Opportunity without required fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Opportunity',
            {
              status: 400,
              body: [
                {
                  errorCode: 'REQUIRED_FIELD_MISSING',
                  message: 'Required fields are missing: [Name, StageName, CloseDate]',
                  fields: ['Name', 'StageName', 'CloseDate'],
                },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(conn.sobject('Opportunity').create({ Amount: 100000 })).rejects.toThrow(SalesforceError)
    })

    it('should create Opportunity associated with Account and Contact', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Opportunity',
            {
              status: 201,
              body: { id: '006xx000001Sv6tAAC', success: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const opportunity: Partial<Opportunity> = {
        Name: 'Enterprise Deal',
        StageName: 'Prospecting',
        CloseDate: '2026-03-31',
        AccountId: '001xx000003DGxYAAW',
        ContactId: '003xx000004TmiQAAS',
      }

      const result = await conn.sobject('Opportunity').create(opportunity)

      expect(result.success).toBe(true)
    })

    it('should create multiple Opportunities in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '006xx000001Sv6tAAC', success: true, errors: [] },
                { id: '006xx000001Sv6uAAC', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const opportunities = [
        { Name: 'Deal 1', StageName: 'Prospecting', CloseDate: '2026-03-31' },
        { Name: 'Deal 2', StageName: 'Qualification', CloseDate: '2026-06-30' },
      ]

      const results = await conn.sobject('Opportunity').create(opportunities)

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })

  describe('Read Opportunity', () => {
    it('should retrieve an Opportunity by Id', async () => {
      const opportunityData: Opportunity = {
        Id: '006xx000001Sv6tAAC',
        Name: 'Enterprise Deal',
        StageName: 'Negotiation/Review',
        CloseDate: '2026-03-31',
        Amount: 250000,
        Probability: 75,
        AccountId: '001xx000003DGxYAAW',
        attributes: { type: 'Opportunity', url: '/services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC' },
      }

      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC',
            { status: 200, body: opportunityData },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const opportunity = await conn.sobject('Opportunity').retrieve('006xx000001Sv6tAAC')

      expect(opportunity.Id).toBe('006xx000001Sv6tAAC')
      expect(opportunity.Name).toBe('Enterprise Deal')
      expect(opportunity.StageName).toBe('Negotiation/Review')
      expect(opportunity.Amount).toBe(250000)
    })

    it('should query Opportunities by StageName', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 3,
                done: true,
                records: [
                  { Id: '006xx000001Sv6tAAC', Name: 'Deal 1', StageName: 'Closed Won', Amount: 100000 },
                  { Id: '006xx000001Sv6uAAC', Name: 'Deal 2', StageName: 'Closed Won', Amount: 200000 },
                  { Id: '006xx000001Sv6vAAC', Name: 'Deal 3', StageName: 'Closed Won', Amount: 150000 },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query<Opportunity>("SELECT Id, Name, StageName, Amount FROM Opportunity WHERE StageName = 'Closed Won'")

      expect(result.totalSize).toBe(3)
      expect(result.records).toHaveLength(3)
      expect(result.records.every((opp) => opp.StageName === 'Closed Won')).toBe(true)
    })

    it('should query Opportunities with related Account', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 1,
                done: true,
                records: [
                  {
                    Id: '006xx000001Sv6tAAC',
                    Name: 'Enterprise Deal',
                    Amount: 250000,
                    Account: {
                      Id: '001xx000003DGxYAAW',
                      Name: 'Acme Corporation',
                      Industry: 'Technology',
                    },
                  },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query<Opportunity & { Account: Account }>('SELECT Id, Name, Amount, Account.Id, Account.Name, Account.Industry FROM Opportunity')

      expect(result.records[0].Account.Name).toBe('Acme Corporation')
    })

    it('should query Opportunities closing this quarter', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 5,
                done: true,
                records: [
                  { Id: '006xx000001Sv6tAAC', Name: 'Q1 Deal 1', CloseDate: '2026-03-15', Amount: 50000 },
                  { Id: '006xx000001Sv6uAAC', Name: 'Q1 Deal 2', CloseDate: '2026-03-20', Amount: 75000 },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query<Opportunity>("SELECT Id, Name, CloseDate, Amount FROM Opportunity WHERE CloseDate = THIS_QUARTER")

      expect(result.totalSize).toBe(5)
    })

    it('should calculate total pipeline value', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 1,
                done: true,
                records: [
                  { expr0: 1500000 },
                ],
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.query("SELECT SUM(Amount) FROM Opportunity WHERE IsClosed = false")

      expect(result.records[0].expr0).toBe(1500000)
    })
  })

  describe('Update Opportunity', () => {
    it('should update an Opportunity stage', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Opportunity').update({
        Id: '006xx000001Sv6tAAC',
        StageName: 'Closed Won',
        Probability: 100,
      })

      expect(result.id).toBe('006xx000001Sv6tAAC')
      expect(result.success).toBe(true)
    })

    it('should update Opportunity amount and close date', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Opportunity').update({
        Id: '006xx000001Sv6tAAC',
        Amount: 350000,
        CloseDate: '2026-04-15',
        NextStep: 'Final contract review',
      })

      expect(result.success).toBe(true)
    })

    it('should update multiple Opportunities in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '006xx000001Sv6tAAC', success: true, errors: [] },
                { id: '006xx000001Sv6uAAC', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const results = await conn.sobject('Opportunity').update([
        { Id: '006xx000001Sv6tAAC', StageName: 'Closed Won' },
        { Id: '006xx000001Sv6uAAC', StageName: 'Closed Lost' },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })

    it('should fail to update with invalid stage', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC',
            {
              status: 400,
              body: [
                {
                  errorCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST',
                  message: 'Stage Name: bad value for restricted picklist field: Invalid Stage',
                  fields: ['StageName'],
                },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(
        conn.sobject('Opportunity').update({ Id: '006xx000001Sv6tAAC', StageName: 'Invalid Stage' })
      ).rejects.toThrow(SalesforceError)
    })
  })

  describe('Delete Opportunity', () => {
    it('should delete an Opportunity', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC',
            { status: 204, body: null },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Opportunity').destroy('006xx000001Sv6tAAC')

      expect(result.id).toBe('006xx000001Sv6tAAC')
      expect(result.success).toBe(true)
    })

    it('should delete multiple Opportunities in batch', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/composite/sobjects',
            {
              status: 200,
              body: [
                { id: '006xx000001Sv6tAAC', success: true, errors: [] },
                { id: '006xx000001Sv6uAAC', success: true, errors: [] },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const results = await conn.sobject('Opportunity').destroy(['006xx000001Sv6tAAC', '006xx000001Sv6uAAC'])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })

    it('should fail to delete closed won Opportunity (business rule)', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC',
            {
              status: 400,
              body: [
                {
                  errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION',
                  message: 'Cannot delete Closed Won opportunities',
                },
              ],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await expect(conn.sobject('Opportunity').destroy('006xx000001Sv6tAAC')).rejects.toThrow(SalesforceError)
    })
  })
})

// =============================================================================
// Cross-Object Relationship Tests
// =============================================================================

describe('@dotdo/salesforce - Cross-Object Relationships', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  it('should query Account with child Contacts', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'GET /services/data/v59.0/query',
          {
            status: 200,
            body: {
              totalSize: 1,
              done: true,
              records: [
                {
                  Id: '001xx000003DGxYAAW',
                  Name: 'Acme Corporation',
                  Contacts: {
                    totalSize: 2,
                    done: true,
                    records: [
                      { Id: '003xx000004TmiQAAS', FirstName: 'John', LastName: 'Doe' },
                      { Id: '003xx000004TmiRAAS', FirstName: 'Jane', LastName: 'Smith' },
                    ],
                  },
                },
              ],
            },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })

    const result = await conn.query<Account & { Contacts: QueryResult<Contact> }>('SELECT Id, Name, (SELECT Id, FirstName, LastName FROM Contacts) FROM Account')

    expect(result.records[0].Contacts.totalSize).toBe(2)
    expect(result.records[0].Contacts.records[0].FirstName).toBe('John')
  })

  it('should query Account with child Opportunities', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'GET /services/data/v59.0/query',
          {
            status: 200,
            body: {
              totalSize: 1,
              done: true,
              records: [
                {
                  Id: '001xx000003DGxYAAW',
                  Name: 'Acme Corporation',
                  Opportunities: {
                    totalSize: 3,
                    done: true,
                    records: [
                      { Id: '006xx000001Sv6tAAC', Name: 'Deal 1', Amount: 100000, StageName: 'Closed Won' },
                      { Id: '006xx000001Sv6uAAC', Name: 'Deal 2', Amount: 200000, StageName: 'Negotiation/Review' },
                      { Id: '006xx000001Sv6vAAC', Name: 'Deal 3', Amount: 150000, StageName: 'Prospecting' },
                    ],
                  },
                },
              ],
            },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })

    const result = await conn.query<Account & { Opportunities: QueryResult<Opportunity> }>('SELECT Id, Name, (SELECT Id, Name, Amount, StageName FROM Opportunities) FROM Account')

    expect(result.records[0].Opportunities.totalSize).toBe(3)
  })

  it('should query Opportunity with related Account and Contact', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'GET /services/data/v59.0/query',
          {
            status: 200,
            body: {
              totalSize: 1,
              done: true,
              records: [
                {
                  Id: '006xx000001Sv6tAAC',
                  Name: 'Enterprise Deal',
                  Amount: 250000,
                  Account: {
                    Id: '001xx000003DGxYAAW',
                    Name: 'Acme Corporation',
                  },
                  Contact: {
                    Id: '003xx000004TmiQAAS',
                    FirstName: 'John',
                    LastName: 'Doe',
                  },
                },
              ],
            },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })

    const result = await conn.query<Opportunity & { Account: Account; Contact: Contact }>(
      'SELECT Id, Name, Amount, Account.Id, Account.Name, Contact.Id, Contact.FirstName, Contact.LastName FROM Opportunity'
    )

    expect(result.records[0].Account.Name).toBe('Acme Corporation')
    expect(result.records[0].Contact.FirstName).toBe('John')
  })
})
