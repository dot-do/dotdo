/**
 * Salesforce Destination Adapter Tests
 *
 * Tests for the Salesforce destination connector including:
 * - OAuth authentication
 * - Contact/Lead/Account/Opportunity upsert operations
 * - Field mapping and validation
 * - API rate limit handling
 * - Batch operations
 *
 * @module db/primitives/connector-framework/destinations/salesforce.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createSalesforceDestination,
  salesforceDestinationDef,
  SalesforceDestinationClient,
  mapRecordToSalesforce,
  validateRecord,
  getFieldMappings,
  CONTACT_FIELD_MAPPINGS,
  LEAD_FIELD_MAPPINGS,
  ACCOUNT_FIELD_MAPPINGS,
  OPPORTUNITY_FIELD_MAPPINGS,
  type SalesforceDestinationConfig,
  type SalesforceFieldMapping,
} from './salesforce'

// =============================================================================
// Field Mapping Tests
// =============================================================================

describe('Salesforce Field Mapping', () => {
  describe('mapRecordToSalesforce', () => {
    it('should map source fields to Salesforce fields', () => {
      const record = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '555-1234',
      }

      const result = mapRecordToSalesforce(record, CONTACT_FIELD_MAPPINGS)

      expect(result.Email).toBe('test@example.com')
      expect(result.FirstName).toBe('John')
      expect(result.LastName).toBe('Doe')
      expect(result.Phone).toBe('555-1234')
    })

    it('should handle snake_case source fields', () => {
      const record = {
        first_name: 'Jane',
        last_name: 'Smith',
        mobile_phone: '555-5678',
      }

      const result = mapRecordToSalesforce(record, CONTACT_FIELD_MAPPINGS)

      expect(result.FirstName).toBe('Jane')
      expect(result.LastName).toBe('Smith')
      expect(result.MobilePhone).toBe('555-5678')
    })

    it('should skip undefined and null values', () => {
      const record = {
        email: 'test@example.com',
        firstName: null,
        lastName: undefined,
        phone: 'valid',
      }

      const result = mapRecordToSalesforce(record, CONTACT_FIELD_MAPPINGS)

      expect(result.Email).toBe('test@example.com')
      expect(result.Phone).toBe('valid')
      expect(result).not.toHaveProperty('FirstName')
      expect(result).not.toHaveProperty('LastName')
    })

    it('should apply custom transformations', () => {
      const customMappings: SalesforceFieldMapping[] = [
        {
          source: 'amount',
          destination: 'Amount',
          transform: (value) => Number(value) * 100, // Convert dollars to cents
        },
      ]

      const record = { amount: '50.00' }
      const result = mapRecordToSalesforce(record, [], customMappings)

      expect(result.Amount).toBe(5000)
    })

    it('should use default values when source is missing', () => {
      const customMappings: SalesforceFieldMapping[] = [
        {
          source: 'status',
          destination: 'Status',
          defaultValue: 'New',
        },
      ]

      const record = {} // No status field
      const result = mapRecordToSalesforce(record, [], customMappings)

      expect(result.Status).toBe('New')
    })

    it('should pass through PascalCase fields directly', () => {
      const record = {
        CustomField__c: 'custom value',
        StandardPascalField: 'standard value',
      }

      const result = mapRecordToSalesforce(record, CONTACT_FIELD_MAPPINGS)

      expect(result.CustomField__c).toBe('custom value')
      expect(result.StandardPascalField).toBe('standard value')
    })
  })

  describe('validateRecord', () => {
    it('should pass validation when required fields are present', () => {
      const record = {
        Email: 'test@example.com',
        LastName: 'Doe',
      }

      const result = validateRecord(record, CONTACT_FIELD_MAPPINGS)

      expect(result.valid).toBe(true)
      expect(result.missingFields).toHaveLength(0)
    })

    it('should fail validation when required fields are missing', () => {
      const record = {
        Email: 'test@example.com',
        // Missing LastName
      }

      const result = validateRecord(record, CONTACT_FIELD_MAPPINGS)

      expect(result.valid).toBe(false)
      expect(result.missingFields).toContain('LastName')
    })

    it('should fail validation when required fields are empty', () => {
      const record = {
        Email: 'test@example.com',
        LastName: '',
      }

      const result = validateRecord(record, CONTACT_FIELD_MAPPINGS)

      expect(result.valid).toBe(false)
      expect(result.missingFields).toContain('LastName')
    })
  })

  describe('getFieldMappings', () => {
    it('should return Contact mappings', () => {
      const mappings = getFieldMappings('Contact')
      expect(mappings).toBe(CONTACT_FIELD_MAPPINGS)
    })

    it('should return Lead mappings', () => {
      const mappings = getFieldMappings('Lead')
      expect(mappings).toBe(LEAD_FIELD_MAPPINGS)
    })

    it('should return Account mappings', () => {
      const mappings = getFieldMappings('Account')
      expect(mappings).toBe(ACCOUNT_FIELD_MAPPINGS)
    })

    it('should return Opportunity mappings', () => {
      const mappings = getFieldMappings('Opportunity')
      expect(mappings).toBe(OPPORTUNITY_FIELD_MAPPINGS)
    })
  })
})

// =============================================================================
// Object-Specific Mapping Tests
// =============================================================================

describe('Salesforce Object Mappings', () => {
  describe('Contact mappings', () => {
    it('should include common contact fields', () => {
      const fields = CONTACT_FIELD_MAPPINGS.map(m => m.destination)

      expect(fields).toContain('Email')
      expect(fields).toContain('FirstName')
      expect(fields).toContain('LastName')
      expect(fields).toContain('Phone')
      expect(fields).toContain('Title')
      expect(fields).toContain('AccountId')
    })

    it('should mark Email and LastName as required', () => {
      const emailMapping = CONTACT_FIELD_MAPPINGS.find(m => m.destination === 'Email')
      const lastNameMapping = CONTACT_FIELD_MAPPINGS.find(m => m.destination === 'LastName')

      expect(emailMapping?.required).toBe(true)
      expect(lastNameMapping?.required).toBe(true)
    })
  })

  describe('Lead mappings', () => {
    it('should include common lead fields', () => {
      const fields = LEAD_FIELD_MAPPINGS.map(m => m.destination)

      expect(fields).toContain('Email')
      expect(fields).toContain('FirstName')
      expect(fields).toContain('LastName')
      expect(fields).toContain('Company')
      expect(fields).toContain('Status')
      expect(fields).toContain('LeadSource')
    })

    it('should mark LastName and Company as required', () => {
      const lastNameMapping = LEAD_FIELD_MAPPINGS.find(m => m.destination === 'LastName')
      const companyMapping = LEAD_FIELD_MAPPINGS.find(m => m.destination === 'Company')

      expect(lastNameMapping?.required).toBe(true)
      expect(companyMapping?.required).toBe(true)
    })
  })

  describe('Account mappings', () => {
    it('should include common account fields', () => {
      const fields = ACCOUNT_FIELD_MAPPINGS.map(m => m.destination)

      expect(fields).toContain('Name')
      expect(fields).toContain('Industry')
      expect(fields).toContain('Phone')
      expect(fields).toContain('Website')
      expect(fields).toContain('BillingCity')
      expect(fields).toContain('AnnualRevenue')
    })

    it('should mark Name as required', () => {
      const nameMapping = ACCOUNT_FIELD_MAPPINGS.find(m => m.destination === 'Name')
      expect(nameMapping?.required).toBe(true)
    })
  })

  describe('Opportunity mappings', () => {
    it('should include common opportunity fields', () => {
      const fields = OPPORTUNITY_FIELD_MAPPINGS.map(m => m.destination)

      expect(fields).toContain('Name')
      expect(fields).toContain('Amount')
      expect(fields).toContain('CloseDate')
      expect(fields).toContain('StageName')
      expect(fields).toContain('AccountId')
      expect(fields).toContain('Probability')
    })

    it('should mark Name, CloseDate, and StageName as required', () => {
      const nameMapping = OPPORTUNITY_FIELD_MAPPINGS.find(m => m.destination === 'Name')
      const closeDateMapping = OPPORTUNITY_FIELD_MAPPINGS.find(m => m.destination === 'CloseDate')
      const stageNameMapping = OPPORTUNITY_FIELD_MAPPINGS.find(m => m.destination === 'StageName')

      expect(nameMapping?.required).toBe(true)
      expect(closeDateMapping?.required).toBe(true)
      expect(stageNameMapping?.required).toBe(true)
    })
  })
})

// =============================================================================
// SalesforceDestinationClient Tests
// =============================================================================

describe('SalesforceDestinationClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let client: SalesforceDestinationClient

  beforeEach(() => {
    mockFetch = vi.fn()
    client = new SalesforceDestinationClient({
      instanceUrl: 'https://test.salesforce.com',
      accessToken: 'test-token',
      apiVersion: '59.0',
      fetch: mockFetch,
    })
  })

  describe('checkConnection', () => {
    it('should return success when connection is valid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ DailyApiRequests: { Max: 100000, Remaining: 99000 } }),
      })

      const result = await client.checkConnection()

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.salesforce.com/services/data/v59.0/limits',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })

    it('should return failure with message when authentication fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Invalid access token' }),
      })

      const result = await client.checkConnection()

      expect(result.success).toBe(false)
      expect(result.message).toBe('Invalid access token')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await client.checkConnection()

      expect(result.success).toBe(false)
      expect(result.message).toBe('Network error')
    })
  })

  describe('create', () => {
    it('should create a record successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '003xxxxxxxxxxxx', success: true }),
      })

      const result = await client.create('Contact', {
        Email: 'test@example.com',
        LastName: 'Doe',
      })

      expect(result.success).toBe(true)
      expect(result.id).toBe('003xxxxxxxxxxxx')
      expect(result.created).toBe(true)
    })

    it('should return errors when creation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => [{ errorCode: 'REQUIRED_FIELD_MISSING', message: 'Required fields are missing' }],
      })

      const result = await client.create('Contact', { Email: 'test@example.com' })

      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].statusCode).toBe('REQUIRED_FIELD_MISSING')
    })
  })

  describe('update', () => {
    it('should update a record successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      const result = await client.update('Contact', '003xxxxxxxxxxxx', { Phone: '555-1234' })

      expect(result.success).toBe(true)
      expect(result.id).toBe('003xxxxxxxxxxxx')
    })

    it('should return errors when update fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => [{ errorCode: 'INVALID_FIELD', message: 'Invalid field' }],
      })

      const result = await client.update('Contact', '003xxxxxxxxxxxx', { InvalidField: 'value' })

      expect(result.success).toBe(false)
      expect(result.errors[0].statusCode).toBe('INVALID_FIELD')
    })
  })

  describe('upsert', () => {
    it('should create a new record on upsert (201)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: '003xxxxxxxxxxxx' }),
      })

      const result = await client.upsert('Contact', 'External_Id__c', 'ext-123', {
        Email: 'test@example.com',
        LastName: 'Doe',
      })

      expect(result.success).toBe(true)
      expect(result.created).toBe(true)
      expect(result.id).toBe('003xxxxxxxxxxxx')
    })

    it('should update an existing record on upsert (204)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      const result = await client.upsert('Contact', 'External_Id__c', 'ext-123', {
        Phone: '555-1234',
      })

      expect(result.success).toBe(true)
      expect(result.created).toBe(false)
    })

    it('should properly encode external ID values in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      await client.upsert('Contact', 'External_Id__c', 'value with spaces', { Phone: '555-1234' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('value%20with%20spaces'),
        expect.any(Object)
      )
    })
  })

  describe('createBatch', () => {
    it('should create multiple records in a batch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: '003xxxxx1', success: true },
          { id: '003xxxxx2', success: true },
        ],
      })

      const records = [
        { Email: 'test1@example.com', LastName: 'One' },
        { Email: 'test2@example.com', LastName: 'Two' },
      ]

      const results = await client.createBatch('Contact', records)

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].id).toBe('003xxxxx1')
      expect(results[1].success).toBe(true)
      expect(results[1].id).toBe('003xxxxx2')
    })

    it('should handle mixed success and failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: '003xxxxx1', success: true },
          { success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING', message: 'Missing field' }] },
        ],
      })

      const records = [
        { Email: 'test1@example.com', LastName: 'One' },
        { Email: 'test2@example.com' }, // Missing LastName
      ]

      const results = await client.createBatch('Contact', records)

      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
    })

    it('should return empty array for empty input', async () => {
      const results = await client.createBatch('Contact', [])

      expect(results).toHaveLength(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('upsertBatch', () => {
    it('should upsert multiple records in a batch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: '003xxxxx1', success: true, created: true },
          { id: '003xxxxx2', success: true, created: false },
        ],
      })

      const records = [
        { External_Id__c: 'ext-1', Email: 'test1@example.com' },
        { External_Id__c: 'ext-2', Email: 'test2@example.com' },
      ]

      const results = await client.upsertBatch('Contact', 'External_Id__c', records)

      expect(results).toHaveLength(2)
      expect(results[0].created).toBe(true)
      expect(results[1].created).toBe(false)
    })
  })
})

// =============================================================================
// Destination Connector Tests
// =============================================================================

describe('Salesforce Destination Connector', () => {
  describe('spec', () => {
    it('should return connector specification', async () => {
      const spec = await salesforceDestinationDef.spec()

      expect(spec.name).toBe('Salesforce Destination')
      expect(spec.version).toBe('1.0.0')
      expect(spec.configSpec.required).toContain('instanceUrl')
      expect(spec.configSpec.required).toContain('accessToken')
      expect(spec.supportedSyncModes).toContain('append')
      expect(spec.supportedSyncModes).toContain('append_dedup')
    })

    it('should mark accessToken as secret', async () => {
      const spec = await salesforceDestinationDef.spec()

      expect(spec.configSpec.properties.accessToken?.secret).toBe(true)
    })
  })

  describe('check', () => {
    it('should return SUCCEEDED for valid credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ DailyApiRequests: { Max: 100000, Remaining: 99000 } }),
      })

      const status = await salesforceDestinationDef.check({
        instanceUrl: 'https://test.salesforce.com',
        accessToken: 'valid-token',
        fetch: mockFetch,
      })

      expect(status.status).toBe('SUCCEEDED')
    })

    it('should return FAILED for invalid credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Invalid token' }),
      })

      const status = await salesforceDestinationDef.check({
        instanceUrl: 'https://test.salesforce.com',
        accessToken: 'invalid-token',
        fetch: mockFetch,
      })

      expect(status.status).toBe('FAILED')
      expect(status.message).toBe('Invalid token')
    })
  })

  describe('write', () => {
    it('should process record messages and create records', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: '003xxxxx', success: true }],
      })

      const config: SalesforceDestinationConfig = {
        instanceUrl: 'https://test.salesforce.com',
        accessToken: 'test-token',
        batchSize: 1, // Process immediately for testing
        fetch: mockFetch,
      }

      const messages: AsyncIterable<any> = (async function* () {
        yield {
          type: 'RECORD',
          record: {
            stream: 'contacts',
            data: {
              email: 'test@example.com',
              lastName: 'Doe',
            },
          },
        }
        yield { type: 'STATE', state: { data: { cursor: '2024-01-01' } } }
      })()

      const results: any[] = []
      for await (const msg of salesforceDestinationDef.write(config, { streams: [] }, messages)) {
        results.push(msg)
      }

      // Should have LOG messages and STATE message
      const logMessages = results.filter(r => r.type === 'LOG')
      const stateMessages = results.filter(r => r.type === 'STATE')

      expect(logMessages.length).toBeGreaterThan(0)
      expect(stateMessages).toHaveLength(1)
    })

    it('should skip records with missing required fields', async () => {
      const mockFetch = vi.fn()

      const config: SalesforceDestinationConfig = {
        instanceUrl: 'https://test.salesforce.com',
        accessToken: 'test-token',
        objectType: 'Contact',
        batchSize: 10,
        fetch: mockFetch,
      } as any

      const messages: AsyncIterable<any> = (async function* () {
        yield {
          type: 'RECORD',
          record: {
            stream: 'contacts',
            data: {
              email: 'test@example.com',
              // Missing lastName which is required
            },
          },
        }
      })()

      const results: any[] = []
      for await (const msg of salesforceDestinationDef.write(config, { streams: [] }, messages)) {
        results.push(msg)
      }

      // Should have a warning log about skipped record
      const warnLogs = results.filter(r => r.type === 'LOG' && r.log.level === 'WARN')
      expect(warnLogs.length).toBeGreaterThan(0)
      expect(warnLogs[0].log.message).toContain('missing required fields')
    })
  })

  describe('createSalesforceDestination', () => {
    it('should create a destination connector instance', () => {
      const connector = createSalesforceDestination()

      expect(connector).toBeDefined()
      expect(typeof connector.spec).toBe('function')
      expect(typeof connector.check).toBe('function')
      expect(typeof connector.write).toBe('function')
    })
  })
})
