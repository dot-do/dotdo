/**
 * @dotdo/salesforce - Salesforce Compatibility Layer Tests
 *
 * Tests for the Salesforce API compatibility layer including:
 * - Connection and authentication
 * - SObject CRUD operations
 * - SOQL queries
 * - Bulk API
 * - Describe/metadata operations
 * - Analytics/Reports
 * - OAuth flows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import jsforce, {
  Connection,
  SalesforceError,
  type SObject,
  type QueryResult,
  type SaveResult,
  type UpsertResult,
  type DescribeSObjectResult,
  type DescribeGlobalResult,
  type BulkJob,
  type BulkBatch,
  type Report,
  type ReportResult,
  type UserInfo,
  type ConnectionConfig,
} from '../src/index'

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

    // Determine content type based on body type
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

function mockAccount(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: '001xx000003DGxYAAW',
    Name: 'Acme Inc',
    Industry: 'Technology',
    Type: 'Customer',
    Website: 'https://acme.com',
    attributes: { type: 'Account', url: '/services/data/v59.0/sobjects/Account/001xx000003DGxYAAW' },
    ...overrides,
  }
}

function mockContact(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: '003xx000004TmiQAAS',
    FirstName: 'John',
    LastName: 'Doe',
    Email: 'john@acme.com',
    AccountId: '001xx000003DGxYAAW',
    attributes: { type: 'Contact', url: '/services/data/v59.0/sobjects/Contact/003xx000004TmiQAAS' },
    ...overrides,
  }
}

function mockOpportunity(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: '006xx000001Sv6tAAC',
    Name: 'Acme - Enterprise Deal',
    StageName: 'Prospecting',
    Amount: 100000,
    CloseDate: '2024-12-31',
    AccountId: '001xx000003DGxYAAW',
    attributes: { type: 'Opportunity', url: '/services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC' },
    ...overrides,
  }
}

// =============================================================================
// Connection Tests
// =============================================================================

describe('@dotdo/salesforce - Connection', () => {
  describe('initialization', () => {
    it('should create a Connection instance with config', () => {
      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
      })
      expect(conn).toBeDefined()
      expect(conn.loginUrl).toBe('https://login.salesforce.com')
    })

    it('should accept sandbox login URL', () => {
      const conn = new Connection({
        loginUrl: 'https://test.salesforce.com',
      })
      expect(conn.loginUrl).toBe('https://test.salesforce.com')
    })

    it('should accept instance URL for already authenticated sessions', () => {
      const conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'existing_token',
      })
      expect(conn.instanceUrl).toBe('https://na1.salesforce.com')
      expect(conn.accessToken).toBe('existing_token')
    })

    it('should use default API version if not specified', () => {
      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
      })
      expect(conn.version).toBe('59.0')
    })

    it('should allow custom API version', () => {
      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        version: '58.0',
      })
      expect(conn.version).toBe('58.0')
    })
  })

  describe('login', () => {
    it('should authenticate with username and password', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/oauth2/token',
            {
              status: 200,
              body: {
                access_token: 'test_access_token',
                instance_url: 'https://na1.salesforce.com',
                id: 'https://login.salesforce.com/id/00Dxx0000001gER/005xx000001Sv6tAAC',
                issued_at: '1234567890',
                token_type: 'Bearer',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        fetch: mockFetch,
      })

      const userInfo = await conn.login('user@example.com', 'password+securitytoken')

      expect(conn.accessToken).toBe('test_access_token')
      expect(conn.instanceUrl).toBe('https://na1.salesforce.com')
      expect(userInfo.id).toBe('005xx000001Sv6tAAC')
      expect(userInfo.organizationId).toBe('00Dxx0000001gER')
    })

    it('should throw error on invalid credentials', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/oauth2/token',
            {
              status: 400,
              body: {
                error: 'invalid_grant',
                error_description: 'authentication failure',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        fetch: mockFetch,
      })

      await expect(conn.login('user@example.com', 'wrongpassword')).rejects.toThrow(SalesforceError)
    })
  })

  describe('logout', () => {
    it('should revoke access token on logout', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['POST /services/oauth2/revoke', { status: 200, body: {} }],
        ])
      )

      const conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await conn.logout()

      expect(conn.accessToken).toBeNull()
    })
  })

  describe('identity', () => {
    it('should retrieve user identity information', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/oauth2/userinfo',
            {
              status: 200,
              body: {
                sub: '005xx000001Sv6tAAC',
                organization_id: '00Dxx0000001gER',
                preferred_username: 'user@example.com',
                name: 'John Doe',
                email: 'user@example.com',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const identity = await conn.identity()

      expect(identity.user_id).toBe('005xx000001Sv6tAAC')
      expect(identity.organization_id).toBe('00Dxx0000001gER')
    })
  })
})

// =============================================================================
// SObject Operations Tests
// =============================================================================

describe('@dotdo/salesforce - SObject CRUD', () => {
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

  describe('create', () => {
    it('should create a single record', async () => {
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

      const result = await conn.sobject('Account').create({
        Name: 'Acme Inc',
        Industry: 'Technology',
      })

      expect(result.id).toBe('001xx000003DGxYAAW')
      expect(result.success).toBe(true)
    })

    it('should create multiple records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/composite/sobjects',
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

      const results = await conn.sobject('Account').create([
        { Name: 'Acme Inc' },
        { Name: 'Globex Corp' },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('001xx000003DGxYAAW')
      expect(results[1].id).toBe('001xx000003DGxZAAW')
    })

    it('should return error on invalid field', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/sobjects/Account',
            {
              status: 400,
              body: [
                {
                  errorCode: 'INVALID_FIELD',
                  message: "No such column 'InvalidField__c' on sobject of type Account",
                  fields: ['InvalidField__c'],
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
        conn.sobject('Account').create({ InvalidField__c: 'value' })
      ).rejects.toThrow(SalesforceError)
    })
  })

  describe('retrieve (get)', () => {
    it('should retrieve a record by ID', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            {
              status: 200,
              body: mockAccount(),
            },
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
      expect(account.Name).toBe('Acme Inc')
    })

    it('should retrieve with specific fields', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            {
              status: 200,
              body: { Id: '001xx000003DGxYAAW', Name: 'Acme Inc' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const account = await conn.sobject('Account').retrieve('001xx000003DGxYAAW', ['Id', 'Name'])

      expect(account.Id).toBe('001xx000003DGxYAAW')
      expect(account.Name).toBe('Acme Inc')
    })

    it('should retrieve multiple records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/composite/sobjects/Account',
            {
              status: 200,
              body: [mockAccount(), mockAccount({ Id: '001xx000003DGxZAAW', Name: 'Globex Corp' })],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const accounts = await conn
        .sobject('Account')
        .retrieve(['001xx000003DGxYAAW', '001xx000003DGxZAAW'])

      expect(accounts).toHaveLength(2)
    })

    it('should throw error for non-existent record', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/001xx000003NONEX',
            {
              status: 404,
              body: [{ errorCode: 'NOT_FOUND', message: 'Provided external ID field does not exist or is not accessible' }],
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
  })

  describe('update', () => {
    it('should update a single record', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            {
              status: 204,
              body: null,
            },
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
        Website: 'https://acme.com',
      })

      expect(result.id).toBe('001xx000003DGxYAAW')
      expect(result.success).toBe(true)
    })

    it('should update multiple records', async () => {
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
        { Id: '001xx000003DGxYAAW', Website: 'https://acme.com' },
        { Id: '001xx000003DGxZAAW', Website: 'https://globex.com' },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete a single record', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /services/data/v59.0/sobjects/Account/001xx000003DGxYAAW',
            {
              status: 204,
              body: null,
            },
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

    it('should delete multiple records', async () => {
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

      const results = await conn
        .sobject('Account')
        .destroy(['001xx000003DGxYAAW', '001xx000003DGxZAAW'])

      expect(results).toHaveLength(2)
    })
  })

  describe('upsert', () => {
    it('should upsert a record (insert)', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Account/External_ID__c/EXT-001',
            {
              status: 201,
              body: { id: '001xx000003DGxYAAW', success: true, created: true, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Account').upsert(
        { External_ID__c: 'EXT-001', Name: 'New Account' },
        'External_ID__c'
      )

      expect(result.id).toBe('001xx000003DGxYAAW')
      expect(result.success).toBe(true)
      expect(result.created).toBe(true)
    })

    it('should upsert a record (update)', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/sobjects/Account/External_ID__c/EXT-001',
            {
              status: 200,
              body: { id: '001xx000003DGxYAAW', success: true, created: false, errors: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn.sobject('Account').upsert(
        { External_ID__c: 'EXT-001', Name: 'Updated Account' },
        'External_ID__c'
      )

      expect(result.success).toBe(true)
      expect(result.created).toBe(false)
    })

    it('should upsert multiple records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'PATCH /services/data/v59.0/composite/sobjects/Account/External_ID__c',
            {
              status: 200,
              body: [
                { id: '001xx000003DGxYAAW', success: true, created: true, errors: [] },
                { id: '001xx000003DGxZAAW', success: true, created: false, errors: [] },
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

      const results = await conn.sobject('Account').upsert(
        [
          { External_ID__c: 'EXT-001', Name: 'Account 1' },
          { External_ID__c: 'EXT-002', Name: 'Account 2' },
        ],
        'External_ID__c'
      )

      expect(results).toHaveLength(2)
    })
  })
})

// =============================================================================
// SOQL Query Tests
// =============================================================================

describe('@dotdo/salesforce - SOQL Query', () => {
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

  describe('query', () => {
    it('should execute a SOQL query', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 2,
                done: true,
                records: [mockAccount(), mockAccount({ Id: '001xx000003DGxZAAW', Name: 'Globex Corp' })],
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

      const result = await conn.query("SELECT Id, Name, Industry FROM Account WHERE Industry = 'Technology'")

      expect(result.totalSize).toBe(2)
      expect(result.done).toBe(true)
      expect(result.records).toHaveLength(2)
      expect(result.records[0].Name).toBe('Acme Inc')
    })

    it('should handle paginated results', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 3000,
                done: false,
                nextRecordsUrl: '/services/data/v59.0/query/01gxx0000004567-2000',
                records: Array(2000).fill(mockAccount()),
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

      const result = await conn.query('SELECT Id, Name FROM Account')

      expect(result.done).toBe(false)
      expect(result.nextRecordsUrl).toBeDefined()
    })

    it('should fetch more records with queryMore', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query/01gxx0000004567-2000',
            {
              status: 200,
              body: {
                totalSize: 3000,
                done: true,
                records: Array(1000).fill(mockAccount()),
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

      const result = await conn.queryMore('/services/data/v59.0/query/01gxx0000004567-2000')

      expect(result.done).toBe(true)
      expect(result.records).toHaveLength(1000)
    })

    it('should support queryAll for deleted/archived records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/queryAll',
            {
              status: 200,
              body: {
                totalSize: 5,
                done: true,
                records: Array(5).fill(mockAccount()),
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

      const result = await conn.queryAll('SELECT Id, Name FROM Account')

      expect(result.totalSize).toBe(5)
    })

    it('should throw error on invalid SOQL', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 400,
              body: [
                {
                  errorCode: 'MALFORMED_QUERY',
                  message: "unexpected token: 'INVALID'",
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

      await expect(conn.query('SELECT INVALID')).rejects.toThrow(SalesforceError)
    })
  })

  describe('query builder', () => {
    it('should build query with find()', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: {
                totalSize: 1,
                done: true,
                records: [mockAccount()],
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

      const result = await conn
        .sobject('Account')
        .find({ Industry: 'Technology' })
        .select(['Id', 'Name', 'Industry'])
        .limit(10)
        .execute()

      expect(result.records).toHaveLength(1)
    })

    it('should support where conditions', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: { totalSize: 1, done: true, records: [mockAccount()] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn
        .sobject('Account')
        .find()
        .where({ Industry: 'Technology', Type: 'Customer' })
        .execute()

      expect(result.records).toHaveLength(1)
    })

    it('should support orderBy', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: { totalSize: 2, done: true, records: [mockAccount(), mockAccount()] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn
        .sobject('Account')
        .find()
        .orderBy('Name', 'ASC')
        .execute()

      expect(result.records).toHaveLength(2)
    })

    it('should support offset', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/query',
            {
              status: 200,
              body: { totalSize: 2, done: true, records: [mockAccount()] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await conn
        .sobject('Account')
        .find()
        .offset(10)
        .limit(10)
        .execute()

      expect(result.records).toHaveLength(1)
    })
  })
})

// =============================================================================
// Bulk API Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API', () => {
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

  describe('createJob', () => {
    it('should create a bulk insert job', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'insert',
                object: 'Account',
                state: 'Open',
                createdDate: '2024-01-15T10:00:00.000Z',
                contentType: 'CSV',
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

      const job = conn.bulk.createJob('Account', 'insert')

      expect(job.object).toBe('Account')
      expect(job.operation).toBe('insert')
    })

    it('should create a bulk update job', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'update',
                object: 'Account',
                state: 'Open',
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

      const job = conn.bulk.createJob('Account', 'update')

      expect(job.operation).toBe('update')
    })

    it('should create a bulk upsert job with external ID', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'upsert',
                object: 'Account',
                externalIdFieldName: 'External_ID__c',
                state: 'Open',
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

      const job = conn.bulk.createJob('Account', 'upsert', { externalIdFieldName: 'External_ID__c' })

      expect(job.operation).toBe('upsert')
    })

    it('should create a bulk delete job', async () => {
      const job = conn.bulk.createJob('Account', 'delete')
      expect(job.operation).toBe('delete')
    })
  })

  describe('batch operations', () => {
    it('should create a batch and add records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'Open' },
            },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            {
              status: 201,
              body: null,
            },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'UploadComplete' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      const records = [{ Name: 'Account 1' }, { Name: 'Account 2' }]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })

    it('should emit response event with results', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'Open' },
            },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'UploadComplete' },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'JobComplete' },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA/successfulResults',
            {
              status: 200,
              body: 'sf__Id,sf__Created,Name\n001xx000003DGxYAAW,true,Account 1\n',
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      batch.execute([{ Name: 'Account 1' }])

      // Wait for the batch to be queued first
      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))

      const results = await batch.poll()
      expect(results).toBeDefined()
    })

    it('should emit error event on failure', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'Open' },
            },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            {
              status: 400,
              body: [{ errorCode: 'INVALID_FIELD', message: 'Invalid field' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      batch.execute([{ InvalidField__c: 'value' }])

      await new Promise<void>((resolve) =>
        batch.on('error', () => resolve())
      )
    })
  })

  describe('bulk query', () => {
    it('should create a bulk query job', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'query',
                object: 'Account',
                state: 'UploadComplete',
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

      const job = await conn.bulk.query('SELECT Id, Name FROM Account')

      expect(job.operation).toBe('query')
    })

    it('should poll for bulk query results', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'UploadComplete' },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA',
            {
              status: 200,
              body: { id: '750xx0000004567AAA', state: 'JobComplete' },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA/results',
            {
              status: 200,
              body: '"Id","Name"\n"001xx000003DGxYAAW","Acme Inc"\n',
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = await conn.bulk.query('SELECT Id, Name FROM Account')
      const results = await job.poll()

      expect(results).toBeDefined()
    })
  })
})

// =============================================================================
// Describe/Metadata Tests
// =============================================================================

describe('@dotdo/salesforce - Describe/Metadata', () => {
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

  describe('describeGlobal', () => {
    it('should describe all objects', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects',
            {
              status: 200,
              body: {
                encoding: 'UTF-8',
                maxBatchSize: 200,
                sobjects: [
                  { name: 'Account', label: 'Account', queryable: true, createable: true },
                  { name: 'Contact', label: 'Contact', queryable: true, createable: true },
                  { name: 'Opportunity', label: 'Opportunity', queryable: true, createable: true },
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

      const result = await conn.describeGlobal()

      expect(result.sobjects).toHaveLength(3)
      expect(result.sobjects[0].name).toBe('Account')
    })
  })

  describe('describe', () => {
    it('should describe a specific object', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/describe',
            {
              status: 200,
              body: {
                name: 'Account',
                label: 'Account',
                labelPlural: 'Accounts',
                queryable: true,
                createable: true,
                updateable: true,
                deletable: true,
                fields: [
                  { name: 'Id', type: 'id', label: 'Account ID', length: 18 },
                  { name: 'Name', type: 'string', label: 'Account Name', length: 255 },
                  { name: 'Industry', type: 'picklist', label: 'Industry' },
                  { name: 'Website', type: 'url', label: 'Website', length: 255 },
                ],
                recordTypeInfos: [],
                childRelationships: [
                  { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts' },
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

      const result = await conn.sobject('Account').describe()

      expect(result.name).toBe('Account')
      expect(result.fields).toHaveLength(4)
      expect(result.fields[0].name).toBe('Id')
    })

    it('should cache describe results', async () => {
      const describeResponse = {
        status: 200,
        body: {
          name: 'Account',
          label: 'Account',
          fields: [],
        },
      }

      mockFetch = createMockFetch(
        new Map([['GET /services/data/v59.0/sobjects/Account/describe', describeResponse]])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      // Use the same SObject instance for caching to work
      const accountSObject = conn.sobject('Account')
      await accountSObject.describe()
      await accountSObject.describe()

      // Should only call once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should bypass cache with refresh option', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/sobjects/Account/describe',
            {
              status: 200,
              body: { name: 'Account', fields: [] },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      await conn.sobject('Account').describe()
      await conn.sobject('Account').describe({ refresh: true })

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('metadata API', () => {
    it('should read metadata for objects', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/Soap/m/59.0',
            {
              status: 200,
              body: {
                result: [
                  {
                    fullName: 'Account',
                    fields: [
                      { fullName: 'Industry', type: 'Picklist' },
                    ],
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

      const metadata = await conn.metadata.read('CustomObject', 'Account')

      expect(metadata.fullName).toBe('Account')
    })

    it('should list metadata types', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/Soap/m/59.0',
            {
              status: 200,
              body: {
                result: [
                  { fullName: 'Account', type: 'CustomObject' },
                  { fullName: 'Contact', type: 'CustomObject' },
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

      const result = await conn.metadata.list([{ type: 'CustomObject' }])

      expect(result).toHaveLength(2)
    })
  })
})

// =============================================================================
// Analytics/Reports Tests
// =============================================================================

describe('@dotdo/salesforce - Analytics/Reports', () => {
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

  describe('report', () => {
    it('should get a report by ID', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/analytics/reports/00Oxx0000004567AAA',
            {
              status: 200,
              body: {
                attributes: {
                  reportId: '00Oxx0000004567AAA',
                  reportName: 'Account Revenue Report',
                  type: 'Report',
                },
                reportMetadata: {
                  name: 'Account Revenue Report',
                  reportFormat: 'SUMMARY',
                },
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

      const report = await conn.analytics.report('00Oxx0000004567AAA')

      expect(report.id).toBe('00Oxx0000004567AAA')
    })

    it('should execute a report', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/analytics/reports/00Oxx0000004567AAA',
            {
              status: 200,
              body: {
                attributes: { reportId: '00Oxx0000004567AAA' },
              },
            },
          ],
          [
            'POST /services/data/v59.0/analytics/reports/00Oxx0000004567AAA',
            {
              status: 200,
              body: {
                factMap: {
                  'T!T': {
                    aggregates: [{ label: '$150,000', value: 150000 }],
                    rows: [
                      { dataCells: [{ label: 'Acme Inc', value: 'Acme Inc' }] },
                    ],
                  },
                },
                hasDetailRows: true,
                reportMetadata: { name: 'Account Revenue Report' },
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

      const report = await conn.analytics.report('00Oxx0000004567AAA')
      const result = await report.execute()

      expect(result.factMap).toBeDefined()
      expect(result.hasDetailRows).toBe(true)
    })

    it('should execute a report with filters', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/analytics/reports/00Oxx0000004567AAA',
            { status: 200, body: { attributes: { reportId: '00Oxx0000004567AAA' } } },
          ],
          [
            'POST /services/data/v59.0/analytics/reports/00Oxx0000004567AAA',
            {
              status: 200,
              body: {
                factMap: {},
                hasDetailRows: true,
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

      const report = await conn.analytics.report('00Oxx0000004567AAA')
      const result = await report.execute({ details: true })

      expect(result).toBeDefined()
    })

    it('should get report results asynchronously', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/analytics/reports/00Oxx0000004567AAA',
            { status: 200, body: { attributes: { reportId: '00Oxx0000004567AAA' } } },
          ],
          [
            'POST /services/data/v59.0/analytics/reports/00Oxx0000004567AAA/instances',
            {
              status: 200,
              body: { id: '0LGxx0000004567AAA', status: 'Running' },
            },
          ],
          [
            'GET /services/data/v59.0/analytics/reports/00Oxx0000004567AAA/instances/0LGxx0000004567AAA',
            {
              status: 200,
              body: {
                id: '0LGxx0000004567AAA',
                status: 'Success',
                factMap: {},
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

      const report = await conn.analytics.report('00Oxx0000004567AAA')
      const instance = await report.executeAsync()

      expect(instance.id).toBe('0LGxx0000004567AAA')
    })
  })

  describe('dashboard', () => {
    it('should list dashboards', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'GET /services/data/v59.0/analytics/dashboards',
            {
              status: 200,
              body: {
                dashboards: [
                  { id: '01Zxx0000004567AAA', name: 'Sales Dashboard' },
                  { id: '01Zxx0000004568AAA', name: 'Marketing Dashboard' },
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

      const dashboards = await conn.analytics.dashboards()

      expect(dashboards.dashboards).toHaveLength(2)
    })
  })
})

// =============================================================================
// OAuth Tests
// =============================================================================

describe('@dotdo/salesforce - OAuth', () => {
  describe('JWT Bearer Flow', () => {
    it('should authenticate using JWT bearer token', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/oauth2/token',
            {
              status: 200,
              body: {
                access_token: 'jwt_access_token',
                instance_url: 'https://na1.salesforce.com',
                id: 'https://login.salesforce.com/id/00Dxx0000001gER/005xx000001Sv6t',
                token_type: 'Bearer',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        fetch: mockFetch,
      })

      await conn.authorize({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiIxMjM0NTY3ODkwIn0.signature',
      })

      expect(conn.accessToken).toBe('jwt_access_token')
    })
  })

  describe('Web Server Flow', () => {
    it('should generate authorization URL', () => {
      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        oauth2: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          redirectUri: 'https://myapp.com/callback',
        },
      })

      const authUrl = conn.oauth2.getAuthorizationUrl({
        scope: 'api refresh_token',
        state: 'state123',
      })

      expect(authUrl).toContain('https://login.salesforce.com/services/oauth2/authorize')
      expect(authUrl).toContain('client_id=test_client_id')
      expect(authUrl).toContain('redirect_uri=')
      expect(authUrl).toContain('response_type=code')
      expect(authUrl).toContain('scope=api+refresh_token')
      expect(authUrl).toContain('state=state123')
    })

    it('should exchange authorization code for tokens', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/oauth2/token',
            {
              status: 200,
              body: {
                access_token: 'web_server_access_token',
                refresh_token: 'web_server_refresh_token',
                instance_url: 'https://na1.salesforce.com',
                id: 'https://login.salesforce.com/id/00Dxx0000001gER/005xx000001Sv6t',
                token_type: 'Bearer',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        oauth2: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          redirectUri: 'https://myapp.com/callback',
        },
        fetch: mockFetch,
      })

      await conn.authorize({
        code: 'authorization_code_from_callback',
      })

      expect(conn.accessToken).toBe('web_server_access_token')
      expect(conn.refreshToken).toBe('web_server_refresh_token')
    })

    it('should refresh access token', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/oauth2/token',
            {
              status: 200,
              body: {
                access_token: 'new_access_token',
                instance_url: 'https://na1.salesforce.com',
                token_type: 'Bearer',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'old_access_token',
        refreshToken: 'refresh_token',
        oauth2: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          redirectUri: 'https://myapp.com/callback',
        },
        fetch: mockFetch,
      })

      await conn.oauth2.refreshToken()

      expect(conn.accessToken).toBe('new_access_token')
    })
  })

  describe('Client Credentials Flow', () => {
    it('should authenticate using client credentials', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/oauth2/token',
            {
              status: 200,
              body: {
                access_token: 'client_credentials_access_token',
                instance_url: 'https://na1.salesforce.com',
                token_type: 'Bearer',
              },
            },
          ],
        ])
      )

      const conn = new Connection({
        loginUrl: 'https://login.salesforce.com',
        oauth2: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
        },
        fetch: mockFetch,
      })

      await conn.authorize({
        grant_type: 'client_credentials',
      })

      expect(conn.accessToken).toBe('client_credentials_access_token')
    })
  })
})

// =============================================================================
// Default Export Tests
// =============================================================================

describe('@dotdo/salesforce - Default Export', () => {
  it('should have Connection on default export', () => {
    expect(jsforce.Connection).toBe(Connection)
  })

  it('should match jsforce interface', () => {
    // Verify the API matches jsforce
    const conn = new jsforce.Connection({
      loginUrl: 'https://login.salesforce.com',
    })

    // These methods should exist to match jsforce
    expect(typeof conn.login).toBe('function')
    expect(typeof conn.logout).toBe('function')
    expect(typeof conn.query).toBe('function')
    expect(typeof conn.queryAll).toBe('function')
    expect(typeof conn.queryMore).toBe('function')
    expect(typeof conn.sobject).toBe('function')
    expect(typeof conn.describeGlobal).toBe('function')
    expect(conn.bulk).toBeDefined()
    expect(conn.analytics).toBeDefined()
    expect(conn.metadata).toBeDefined()
    expect(conn.oauth2).toBeDefined()
  })
})
