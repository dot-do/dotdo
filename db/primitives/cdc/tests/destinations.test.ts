/**
 * CDC Destination Adapters Tests
 *
 * RED phase: These tests define the expected behavior of destination adapters
 * for popular SaaS platforms (Salesforce, HubSpot).
 *
 * Destination adapters provide:
 * - Object mapping from CDC changes to destination schema
 * - Bulk API batching for efficient writes
 * - Rate limiting to comply with API limits
 * - Exponential backoff for error handling
 * - Association/relationship handling
 *
 * @module db/primitives/cdc/tests/destinations.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // Salesforce Destination
  SalesforceDestination,
  createSalesforceDestination,
  type SalesforceDestinationConfig,
  type SalesforceObjectMapping,
  type SalesforceUpsertResult,
  type SalesforceAuth,
  // HubSpot Destination
  HubSpotDestination,
  createHubSpotDestination,
  type HubSpotDestinationConfig,
  type HubSpotObjectMapping,
  type HubSpotUpsertResult,
  type HubSpotAssociation,
  // Common types
  type Destination,
  type DestinationRecord,
  type DestinationUpsertOptions,
} from '../destinations'
import { ChangeType, type ChangeEvent } from '../stream'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestContact {
  id: string
  email: string
  firstName: string
  lastName: string
  company: string
  phone?: string
  createdAt: Date
  updatedAt: Date
}

interface TestDeal {
  id: string
  name: string
  amount: number
  stage: string
  contactId: string
  closeDate: Date
}

function createTestChange<T>(data: Partial<ChangeEvent<T>> & { after: T }): ChangeEvent<T> {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    type: ChangeType.INSERT,
    before: null,
    timestamp: Date.now(),
    position: { sequence: 1, timestamp: Date.now() },
    isBackfill: false,
    ...data,
  }
}

function createTestContact(overrides: Partial<TestContact> = {}): TestContact {
  return {
    id: `contact-${Math.random().toString(36).slice(2)}`,
    email: `test-${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'John',
    lastName: 'Doe',
    company: 'Acme Inc',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createTestDeal(overrides: Partial<TestDeal> = {}): TestDeal {
  return {
    id: `deal-${Math.random().toString(36).slice(2)}`,
    name: 'Test Deal',
    amount: 10000,
    stage: 'negotiation',
    contactId: 'contact-1',
    closeDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// SALESFORCE DESTINATION
// ============================================================================

describe('SalesforceDestination', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('authentication', () => {
    it('should authenticate with OAuth2 credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-access-token',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
        }),
      })

      const destination = createSalesforceDestination({
        auth: {
          type: 'oauth2',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          username: 'test@example.com',
          password: 'password123',
          securityToken: 'token123',
        },
        instanceUrl: 'https://test.salesforce.com',
      })

      await destination.connect()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/services/oauth2/token'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(destination.isConnected()).toBe(true)
    })

    it('should refresh token when expired', async () => {
      // Initial auth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'initial-token',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
        }),
      })

      // First request fails with 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      // Token refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-token',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
        }),
      })

      // Retry succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ id: '001xx', success: true }]),
      })

      const destination = createSalesforceDestination({
        auth: {
          type: 'oauth2',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          refreshToken: 'test-refresh-token',
        },
        instanceUrl: 'https://test.salesforce.com',
      })

      await destination.connect()

      const contact = createTestContact()
      await destination.upsert([{ data: contact }], { objectType: 'Contact' })

      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })

  describe('object mapping', () => {
    it('should map source fields to Salesforce fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ id: '001xx', success: true }]),
      })

      const mapping: SalesforceObjectMapping = {
        sourceType: 'Contact',
        targetObject: 'Contact',
        fieldMappings: {
          email: 'Email',
          firstName: 'FirstName',
          lastName: 'LastName',
          company: 'Company',
          phone: 'Phone',
        },
        externalIdField: 'External_Id__c',
      }

      const destination = createSalesforceDestination({
        auth: {
          type: 'oauth2',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          username: 'test@example.com',
          password: 'password123',
        },
        instanceUrl: 'https://test.salesforce.com',
        mappings: [mapping],
      })

      await destination.connect()

      const contact = createTestContact({
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
      })

      await destination.upsert([{ data: contact, externalId: contact.id }], {
        objectType: 'Contact',
      })

      // Verify the mapped payload
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)
      expect(body.records[0]).toMatchObject({
        Email: 'john@example.com',
        FirstName: 'John',
        LastName: 'Doe',
        External_Id__c: contact.id,
      })
    })

    it('should apply field transformations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ id: '001xx', success: true }]),
      })

      const mapping: SalesforceObjectMapping = {
        sourceType: 'Contact',
        targetObject: 'Contact',
        fieldMappings: {
          email: 'Email',
          firstName: 'FirstName',
          lastName: 'LastName',
        },
        transforms: {
          email: (value) => String(value).toLowerCase(),
          firstName: (value) => String(value).trim(),
        },
      }

      const destination = createSalesforceDestination({
        auth: {
          type: 'oauth2',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
        instanceUrl: 'https://test.salesforce.com',
        mappings: [mapping],
      })

      await destination.connect()

      const contact = createTestContact({
        email: 'JOHN@EXAMPLE.COM',
        firstName: '  John  ',
      })

      await destination.upsert([{ data: contact }], { objectType: 'Contact' })

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)
      expect(body.records[0].Email).toBe('john@example.com')
      expect(body.records[0].FirstName).toBe('John')
    })

    it('should handle custom objects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ id: 'a01xx', success: true }]),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        mappings: [{
          sourceType: 'CustomRecord',
          targetObject: 'Custom_Object__c',
          fieldMappings: {
            name: 'Name',
            value: 'Value__c',
          },
          externalIdField: 'External_Key__c',
        }],
      })

      await destination.connect()

      await destination.upsert([{
        data: { id: '123', name: 'Test', value: 100 },
        externalId: '123',
      }], { objectType: 'CustomRecord' })

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[0]).toContain('Custom_Object__c')
    })
  })

  describe('bulk API batching', () => {
    it('should batch records up to configured size', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      // Should make 2 batch calls for 250 records with batch size 200
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => Array(200).fill({ success: true }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => Array(50).fill({ success: true }),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        batchSize: 200,
      })

      await destination.connect()

      const records = Array(250).fill(null).map(() => ({
        data: createTestContact(),
      }))

      const result = await destination.upsert(records, { objectType: 'Contact' })

      // Auth call + 2 batch calls
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result.successCount).toBe(250)
    })

    it('should use Bulk API 2.0 for large batches', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      // Create job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'job-123',
          state: 'Open',
        }),
      })

      // Upload data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'job-123' }),
      })

      // Close job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'job-123',
          state: 'UploadComplete',
        }),
      })

      // Poll for completion
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'job-123',
          state: 'JobComplete',
          numberRecordsProcessed: 10000,
          numberRecordsFailed: 0,
        }),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        useBulkApi: true,
        bulkApiThreshold: 1000,
      })

      await destination.connect()

      const records = Array(10000).fill(null).map(() => ({
        data: createTestContact(),
      }))

      const result = await destination.upsert(records, { objectType: 'Contact' })

      // Verify Bulk API 2.0 endpoint was called
      const jobCall = mockFetch.mock.calls[1]
      expect(jobCall[0]).toContain('/jobs/ingest')
      expect(result.successCount).toBe(10000)
    })

    it('should handle partial batch failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: '001xx1', success: true },
          { success: false, errors: [{ message: 'DUPLICATE_VALUE', statusCode: 'DUPLICATE_VALUE' }] },
          { id: '001xx3', success: true },
        ]),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
      })

      await destination.connect()

      const records = [
        { data: createTestContact({ email: 'a@example.com' }) },
        { data: createTestContact({ email: 'b@example.com' }) },
        { data: createTestContact({ email: 'c@example.com' }) },
      ]

      const result = await destination.upsert(records, { objectType: 'Contact' })

      expect(result.successCount).toBe(2)
      expect(result.failureCount).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].code).toBe('DUPLICATE_VALUE')
    })
  })

  describe('rate limiting', () => {
    it('should respect API rate limits', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      // All batch calls succeed
      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ([{ success: true }]),
        })
      }

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        rateLimit: {
          requestsPerSecond: 5,
          burstSize: 5,
        },
      })

      await destination.connect()

      const startTime = Date.now()

      // Make 10 calls which should take at least 1 second due to rate limit
      for (let i = 0; i < 10; i++) {
        await destination.upsert([{ data: createTestContact() }], { objectType: 'Contact' })
      }

      const elapsed = Date.now() - startTime

      // Should have taken at least 1000ms due to rate limiting
      expect(elapsed).toBeGreaterThanOrEqual(1000)
    })

    it('should handle rate limit exceeded (429) with retry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      // First call returns 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '1' }, // Retry-After: 1 second
      })

      // Retry succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ success: true }]),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
      })

      await destination.connect()

      const result = await destination.upsert([{ data: createTestContact() }], { objectType: 'Contact' })

      expect(result.successCount).toBe(1)
      expect(mockFetch).toHaveBeenCalledTimes(3) // auth + 429 + success
    })

    it('should use exponential backoff on server errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      const timestamps: number[] = []

      // First two calls fail with 503
      mockFetch.mockImplementationOnce(async () => {
        timestamps.push(Date.now())
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        }
      })

      mockFetch.mockImplementationOnce(async () => {
        timestamps.push(Date.now())
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        }
      })

      // Third call succeeds
      mockFetch.mockImplementationOnce(async () => {
        timestamps.push(Date.now())
        return {
          ok: true,
          json: async () => ([{ success: true }]),
        }
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
      })

      await destination.connect()

      await destination.upsert([{ data: createTestContact() }], { objectType: 'Contact' })

      // Verify exponential backoff: delay1 < delay2
      const delay1 = timestamps[1] - timestamps[0]
      const delay2 = timestamps[2] - timestamps[1]
      expect(delay2).toBeGreaterThan(delay1)
    })
  })

  describe('error handling', () => {
    it('should collect and report all errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { success: false, errors: [{ message: 'Required field missing', statusCode: 'REQUIRED_FIELD_MISSING', fields: ['Email'] }] },
          { success: false, errors: [{ message: 'Invalid email format', statusCode: 'INVALID_EMAIL_ADDRESS' }] },
        ]),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
      })

      await destination.connect()

      const result = await destination.upsert([
        { data: createTestContact({ email: '' }) },
        { data: createTestContact({ email: 'invalid' }) },
      ], { objectType: 'Contact' })

      expect(result.errors).toHaveLength(2)
      expect(result.errors[0].code).toBe('REQUIRED_FIELD_MISSING')
      expect(result.errors[1].code).toBe('INVALID_EMAIL_ADDRESS')
    })

    it('should fail after max retry attempts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      // All calls fail
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
      }

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        },
      })

      await destination.connect()

      await expect(
        destination.upsert([{ data: createTestContact() }], { objectType: 'Contact' })
      ).rejects.toThrow(/failed after 3 attempts/i)
    })
  })

  describe('delete operations', () => {
    it('should delete records by external ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          instance_url: 'https://test.salesforce.com',
        }),
      })

      // Query for record IDs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [
            { Id: '001xx1' },
            { Id: '001xx2' },
          ],
        }),
      })

      // Delete
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: '001xx1', success: true },
          { id: '001xx2', success: true },
        ]),
      })

      const destination = createSalesforceDestination({
        auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
        instanceUrl: 'https://test.salesforce.com',
        mappings: [{
          sourceType: 'Contact',
          targetObject: 'Contact',
          fieldMappings: {},
          externalIdField: 'External_Id__c',
        }],
      })

      await destination.connect()

      const result = await destination.delete(['ext-1', 'ext-2'], { objectType: 'Contact' })

      expect(result.successCount).toBe(2)
    })
  })
})

// ============================================================================
// HUBSPOT DESTINATION
// ============================================================================

describe('HubSpotDestination', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('authentication', () => {
    it('should authenticate with API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ portalId: 12345 }),
      })

      const destination = createHubSpotDestination({
        auth: {
          type: 'apiKey',
          apiKey: 'test-api-key',
        },
      })

      await destination.connect()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('hapikey=test-api-key'),
        expect.any(Object)
      )
      expect(destination.isConnected()).toBe(true)
    })

    it('should authenticate with OAuth2 access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: 'test-user',
          hub_id: 12345,
        }),
      })

      const destination = createHubSpotDestination({
        auth: {
          type: 'oauth2',
          accessToken: 'test-access-token',
        },
      })

      await destination.connect()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token',
          }),
        })
      )
      expect(destination.isConnected()).toBe(true)
    })

    it('should refresh OAuth token when expired', async () => {
      // Initial auth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // First request fails with 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      // Token refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      })

      // Retry succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-1' }],
        }),
      })

      const destination = createHubSpotDestination({
        auth: {
          type: 'oauth2',
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      })

      await destination.connect()

      await destination.upsert([{ data: createTestContact() }], { objectType: 'contacts' })

      // auth + first request + refresh + retry
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })

  describe('contact/deal mapping', () => {
    it('should map source fields to HubSpot contact properties', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-1' }],
        }),
      })

      const mapping: HubSpotObjectMapping = {
        sourceType: 'Contact',
        targetObject: 'contacts',
        propertyMappings: {
          email: 'email',
          firstName: 'firstname',
          lastName: 'lastname',
          company: 'company',
          phone: 'phone',
        },
        idProperty: 'email',
      }

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        mappings: [mapping],
      })

      await destination.connect()

      const contact = createTestContact({
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        company: 'Acme Inc',
      })

      await destination.upsert([{ data: contact }], { objectType: 'contacts' })

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)

      expect(body.inputs[0].properties).toMatchObject({
        email: 'john@example.com',
        firstname: 'John',
        lastname: 'Doe',
        company: 'Acme Inc',
      })
    })

    it('should map deals with pipeline stages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'deal-1' }],
        }),
      })

      const mapping: HubSpotObjectMapping = {
        sourceType: 'Deal',
        targetObject: 'deals',
        propertyMappings: {
          name: 'dealname',
          amount: 'amount',
          stage: 'dealstage',
          closeDate: 'closedate',
        },
        stageMapping: {
          prospecting: 'appointmentscheduled',
          negotiation: 'qualifiedtobuy',
          closed_won: 'closedwon',
          closed_lost: 'closedlost',
        },
      }

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        mappings: [mapping],
      })

      await destination.connect()

      const deal = createTestDeal({
        name: 'Big Deal',
        amount: 50000,
        stage: 'negotiation',
      })

      await destination.upsert([{ data: deal }], { objectType: 'deals' })

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)

      expect(body.inputs[0].properties).toMatchObject({
        dealname: 'Big Deal',
        amount: 50000,
        dealstage: 'qualifiedtobuy', // Mapped from 'negotiation'
      })
    })

    it('should handle custom object mapping', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'obj-1' }],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        mappings: [{
          sourceType: 'Ticket',
          targetObject: 'tickets',
          propertyMappings: {
            subject: 'subject',
            description: 'content',
            priority: 'hs_ticket_priority',
          },
          idProperty: 'hs_object_id',
        }],
      })

      await destination.connect()

      await destination.upsert([{
        data: { id: '123', subject: 'Help', description: 'Need help', priority: 'HIGH' },
      }], { objectType: 'tickets' })

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[0]).toContain('/crm/v3/objects/tickets')
    })
  })

  describe('association handling', () => {
    it('should create associations between contacts and companies', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // Create contact
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-123' }],
        }),
      })

      // Create association
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'contact-123' }] }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const contact = createTestContact()

      await destination.upsert([{
        data: contact,
        associations: [{
          toObjectType: 'companies',
          toObjectId: 'company-456',
          associationType: 'contact_to_company',
        }],
      }], { objectType: 'contacts' })

      // Verify association API was called
      const assocCall = mockFetch.mock.calls[2]
      expect(assocCall[0]).toContain('/associations')
    })

    it('should create deal-to-contact associations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // Create deal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'deal-123' }],
        }),
      })

      // Create association
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'deal-123' }] }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const deal = createTestDeal({ contactId: 'contact-789' })

      await destination.upsert([{
        data: deal,
        associations: [{
          toObjectType: 'contacts',
          toObjectId: 'contact-789',
          associationType: 'deal_to_contact',
        }],
      }], { objectType: 'deals' })

      const assocCall = mockFetch.mock.calls[2]
      expect(assocCall[0]).toContain('/associations')
      const body = JSON.parse(assocCall[1].body)
      expect(body.inputs[0].to.id).toBe('contact-789')
    })

    it('should batch multiple associations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // Create contacts
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: 'contact-1' },
            { id: 'contact-2' },
            { id: 'contact-3' },
          ],
        }),
      })

      // Create associations (batched)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { id: 'contact-1' },
            { id: 'contact-2' },
            { id: 'contact-3' },
          ],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const records = [
        { data: createTestContact(), associations: [{ toObjectType: 'companies', toObjectId: 'company-1', associationType: 'contact_to_company' }] },
        { data: createTestContact(), associations: [{ toObjectType: 'companies', toObjectId: 'company-1', associationType: 'contact_to_company' }] },
        { data: createTestContact(), associations: [{ toObjectType: 'companies', toObjectId: 'company-2', associationType: 'contact_to_company' }] },
      ]

      await destination.upsert(records, { objectType: 'contacts' })

      // Should batch associations in a single call
      expect(mockFetch).toHaveBeenCalledTimes(3) // auth + upsert + associations
    })

    it('should handle association failures gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // Create contact succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-123' }],
        }),
      })

      // Association fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Company not found',
          category: 'OBJECT_NOT_FOUND',
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const result = await destination.upsert([{
        data: createTestContact(),
        associations: [{
          toObjectType: 'companies',
          toObjectId: 'nonexistent-company',
          associationType: 'contact_to_company',
        }],
      }], { objectType: 'contacts' })

      // Record should be created but association should fail
      expect(result.successCount).toBe(1)
      expect(result.associationErrors).toHaveLength(1)
    })
  })

  describe('batching and rate limiting', () => {
    it('should batch records up to configured size', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // Should make 2 batch calls for 150 records with batch size 100
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: Array(100).fill({ id: 'contact-1' }),
        }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: Array(50).fill({ id: 'contact-2' }),
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        batchSize: 100,
      })

      await destination.connect()

      const records = Array(150).fill(null).map(() => ({
        data: createTestContact(),
      }))

      const result = await destination.upsert(records, { objectType: 'contacts' })

      expect(mockFetch).toHaveBeenCalledTimes(3) // auth + 2 batches
      expect(result.successCount).toBe(150)
    })

    it('should respect HubSpot API rate limits', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'COMPLETE',
            results: [{ id: `contact-${i}` }],
          }),
        })
      }

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        rateLimit: {
          requestsPerSecond: 5,
        },
      })

      await destination.connect()

      const startTime = Date.now()

      for (let i = 0; i < 10; i++) {
        await destination.upsert([{ data: createTestContact() }], { objectType: 'contacts' })
      }

      const elapsed = Date.now() - startTime

      // Should take at least 1 second due to rate limiting
      expect(elapsed).toBeGreaterThanOrEqual(1000)
    })

    it('should handle 429 rate limit response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // First call returns 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => name === 'Retry-After' ? '1' : null,
        },
      })

      // Retry succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-1' }],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 100,
        },
      })

      await destination.connect()

      const result = await destination.upsert([{ data: createTestContact() }], { objectType: 'contacts' })

      expect(result.successCount).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should report validation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: 'contact-1', status: 'CREATED' },
          ],
          errors: [
            {
              status: 'error',
              category: 'VALIDATION_ERROR',
              message: 'Property "email" is required',
              context: { propertyName: 'email' },
            },
          ],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const result = await destination.upsert([
        { data: createTestContact() },
        { data: createTestContact({ email: '' }) },
      ], { objectType: 'contacts' })

      expect(result.successCount).toBe(1)
      expect(result.failureCount).toBe(1)
      expect(result.errors[0].category).toBe('VALIDATION_ERROR')
    })

    it('should handle network errors with retry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      // Network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      // Retry succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-1' }],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 10,
        },
      })

      await destination.connect()

      const result = await destination.upsert([{ data: createTestContact() }], { objectType: 'contacts' })

      expect(result.successCount).toBe(1)
    })
  })

  describe('delete operations', () => {
    it('should delete contacts by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-1' }, { id: 'contact-2' }],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const result = await destination.delete(['contact-1', 'contact-2'], { objectType: 'contacts' })

      expect(result.successCount).toBe(2)

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[0]).toContain('/batch/archive')
    })

    it('should handle delete failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: 'test-user', hub_id: 12345 }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [{ id: 'contact-1' }],
          errors: [{
            status: 'error',
            category: 'OBJECT_NOT_FOUND',
            message: 'Object not found',
            id: 'contact-2',
          }],
        }),
      })

      const destination = createHubSpotDestination({
        auth: { type: 'apiKey', apiKey: 'test-key' },
      })

      await destination.connect()

      const result = await destination.delete(['contact-1', 'contact-2'], { objectType: 'contacts' })

      expect(result.successCount).toBe(1)
      expect(result.failureCount).toBe(1)
    })
  })
})

// ============================================================================
// DESTINATION INTERFACE TESTS
// ============================================================================

describe('Destination interface', () => {
  it('should implement common Destination interface for Salesforce', async () => {
    const destination: Destination = createSalesforceDestination({
      auth: { type: 'oauth2', clientId: 'id', clientSecret: 'secret' },
      instanceUrl: 'https://test.salesforce.com',
    })

    expect(typeof destination.connect).toBe('function')
    expect(typeof destination.disconnect).toBe('function')
    expect(typeof destination.isConnected).toBe('function')
    expect(typeof destination.upsert).toBe('function')
    expect(typeof destination.delete).toBe('function')
    expect(destination.name).toBe('salesforce')
  })

  it('should implement common Destination interface for HubSpot', async () => {
    const destination: Destination = createHubSpotDestination({
      auth: { type: 'apiKey', apiKey: 'test-key' },
    })

    expect(typeof destination.connect).toBe('function')
    expect(typeof destination.disconnect).toBe('function')
    expect(typeof destination.isConnected).toBe('function')
    expect(typeof destination.upsert).toBe('function')
    expect(typeof destination.delete).toBe('function')
    expect(destination.name).toBe('hubspot')
  })
})
