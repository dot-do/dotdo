/**
 * HubSpot Destination Adapter Tests
 *
 * Tests for the HubSpot destination connector including:
 * - API key authentication
 * - Contact/Company/Deal upsert operations
 * - Property mapping and validation
 * - Batch operations
 *
 * @module db/primitives/connector-framework/destinations/hubspot.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createHubSpotDestination,
  hubspotDestinationDef,
  HubSpotDestinationClient,
  mapRecordToHubSpot,
  validateRecord,
  getPropertyMappings,
  CONTACT_PROPERTY_MAPPINGS,
  COMPANY_PROPERTY_MAPPINGS,
  DEAL_PROPERTY_MAPPINGS,
  type HubSpotDestinationConfig,
  type HubSpotPropertyMapping,
} from './hubspot'

// =============================================================================
// Property Mapping Tests
// =============================================================================

describe('HubSpot Property Mapping', () => {
  describe('mapRecordToHubSpot', () => {
    it('should map source fields to HubSpot properties', () => {
      const record = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '555-1234',
      }

      const result = mapRecordToHubSpot(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.email).toBe('test@example.com')
      expect(result.firstname).toBe('John')
      expect(result.lastname).toBe('Doe')
      expect(result.phone).toBe('555-1234')
    })

    it('should handle snake_case source fields', () => {
      const record = {
        first_name: 'Jane',
        last_name: 'Smith',
        mobile_phone: '555-5678',
      }

      const result = mapRecordToHubSpot(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.firstname).toBe('Jane')
      expect(result.lastname).toBe('Smith')
      expect(result.mobilephone).toBe('555-5678')
    })

    it('should convert values to strings', () => {
      const record = {
        email: 'test@example.com',
        numEmployees: 100,
        annualRevenue: 5000000.50,
      }

      const result = mapRecordToHubSpot(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.email).toBe('test@example.com')
      expect(result.numemployees).toBe('100')
      expect(result.annualrevenue).toBe('5000000.5')
    })

    it('should handle Date objects (convert to epoch ms)', () => {
      const date = new Date('2024-06-15T10:30:00Z')
      const customMappings: HubSpotPropertyMapping[] = [
        { source: 'closeDate', destination: 'closedate' },
      ]

      const record = { closeDate: date }
      const result = mapRecordToHubSpot(record, [], customMappings)

      expect(result.closedate).toBe(date.getTime().toString())
    })

    it('should skip undefined and null values', () => {
      const record = {
        email: 'test@example.com',
        firstName: null,
        lastName: undefined,
        phone: 'valid',
      }

      const result = mapRecordToHubSpot(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.email).toBe('test@example.com')
      expect(result.phone).toBe('valid')
      expect(result).not.toHaveProperty('firstname')
      expect(result).not.toHaveProperty('lastname')
    })

    it('should apply custom transformations', () => {
      const customMappings: HubSpotPropertyMapping[] = [
        {
          source: 'amount',
          destination: 'amount',
          transform: (value) => (Number(value) * 100).toString(),
        },
      ]

      const record = { amount: '50.00' }
      const result = mapRecordToHubSpot(record, [], customMappings)

      expect(result.amount).toBe('5000')
    })

    it('should use default values when source is missing', () => {
      const customMappings: HubSpotPropertyMapping[] = [
        {
          source: 'status',
          destination: 'lifecyclestage',
          defaultValue: 'lead',
        },
      ]

      const record = {} // No status field
      const result = mapRecordToHubSpot(record, [], customMappings)

      expect(result.lifecyclestage).toBe('lead')
    })

    it('should pass through lowercase property names directly', () => {
      const record = {
        custom_property: 'custom value',
        hs_custom_field: 'hs value',
      }

      const result = mapRecordToHubSpot(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.custom_property).toBe('custom value')
      expect(result.hs_custom_field).toBe('hs value')
    })

    it('should JSON stringify object values', () => {
      const record = {
        metadata: { key: 'value', nested: { a: 1 } },
      }

      const result = mapRecordToHubSpot(record, [], [
        { source: 'metadata', destination: 'metadata' },
      ])

      expect(result.metadata).toBe('{"key":"value","nested":{"a":1}}')
    })
  })

  describe('validateRecord', () => {
    it('should pass validation when required fields are present', () => {
      const record = {
        email: 'test@example.com',
      }

      const result = validateRecord(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.valid).toBe(true)
      expect(result.missingFields).toHaveLength(0)
    })

    it('should fail validation when required fields are missing', () => {
      const record = {
        firstname: 'John',
        // Missing email which is required for contacts
      }

      const result = validateRecord(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.valid).toBe(false)
      expect(result.missingFields).toContain('email')
    })

    it('should fail validation when required fields are empty', () => {
      const record = {
        email: '',
      }

      const result = validateRecord(record, CONTACT_PROPERTY_MAPPINGS)

      expect(result.valid).toBe(false)
      expect(result.missingFields).toContain('email')
    })
  })

  describe('getPropertyMappings', () => {
    it('should return Contact mappings', () => {
      const mappings = getPropertyMappings('contacts')
      expect(mappings).toBe(CONTACT_PROPERTY_MAPPINGS)
    })

    it('should return Company mappings', () => {
      const mappings = getPropertyMappings('companies')
      expect(mappings).toBe(COMPANY_PROPERTY_MAPPINGS)
    })

    it('should return Deal mappings', () => {
      const mappings = getPropertyMappings('deals')
      expect(mappings).toBe(DEAL_PROPERTY_MAPPINGS)
    })
  })
})

// =============================================================================
// Object-Specific Mapping Tests
// =============================================================================

describe('HubSpot Object Mappings', () => {
  describe('Contact mappings', () => {
    it('should include common contact properties', () => {
      const properties = CONTACT_PROPERTY_MAPPINGS.map(m => m.destination)

      expect(properties).toContain('email')
      expect(properties).toContain('firstname')
      expect(properties).toContain('lastname')
      expect(properties).toContain('phone')
      expect(properties).toContain('jobtitle')
      expect(properties).toContain('lifecyclestage')
    })

    it('should mark email as required', () => {
      const emailMapping = CONTACT_PROPERTY_MAPPINGS.find(m => m.destination === 'email')
      expect(emailMapping?.required).toBe(true)
    })
  })

  describe('Company mappings', () => {
    it('should include common company properties', () => {
      const properties = COMPANY_PROPERTY_MAPPINGS.map(m => m.destination)

      expect(properties).toContain('name')
      expect(properties).toContain('domain')
      expect(properties).toContain('industry')
      expect(properties).toContain('phone')
      expect(properties).toContain('website')
      expect(properties).toContain('numberofemployees')
      expect(properties).toContain('annualrevenue')
    })

    it('should mark name as required', () => {
      const nameMapping = COMPANY_PROPERTY_MAPPINGS.find(m => m.destination === 'name')
      expect(nameMapping?.required).toBe(true)
    })
  })

  describe('Deal mappings', () => {
    it('should include common deal properties', () => {
      const properties = DEAL_PROPERTY_MAPPINGS.map(m => m.destination)

      expect(properties).toContain('dealname')
      expect(properties).toContain('amount')
      expect(properties).toContain('dealstage')
      expect(properties).toContain('pipeline')
      expect(properties).toContain('closedate')
      expect(properties).toContain('hubspot_owner_id')
    })

    it('should mark dealname as required', () => {
      const nameMapping = DEAL_PROPERTY_MAPPINGS.find(m => m.destination === 'dealname')
      expect(nameMapping?.required).toBe(true)
    })
  })
})

// =============================================================================
// HubSpotDestinationClient Tests
// =============================================================================

describe('HubSpotDestinationClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let client: HubSpotDestinationClient

  beforeEach(() => {
    mockFetch = vi.fn()
    client = new HubSpotDestinationClient({
      accessToken: 'test-token',
      basePath: 'https://api.hubapi.com',
      fetch: mockFetch,
    })
  })

  describe('checkConnection', () => {
    it('should return success when connection is valid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })

      const result = await client.checkConnection()

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.hubapi.com/crm/v3/objects/contacts?limit=1',
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
        json: async () => ({ message: 'Invalid API key' }),
      })

      const result = await client.checkConnection()

      expect(result.success).toBe(false)
      expect(result.message).toBe('Invalid API key')
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
        json: async () => ({
          id: '12345',
          properties: { email: 'test@example.com' },
        }),
      })

      const result = await client.create('contacts', {
        email: 'test@example.com',
        firstname: 'John',
      })

      expect(result.success).toBe(true)
      expect(result.id).toBe('12345')
    })

    it('should return errors when creation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          status: 'error',
          category: 'VALIDATION_ERROR',
          message: 'Property values are invalid',
        }),
      })

      const result = await client.create('contacts', { email: 'invalid' })

      expect(result.success).toBe(false)
      expect(result.error?.category).toBe('VALIDATION_ERROR')
    })
  })

  describe('update', () => {
    it('should update a record successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '12345',
          properties: { phone: '555-1234' },
        }),
      })

      const result = await client.update('contacts', '12345', { phone: '555-1234' })

      expect(result.success).toBe(true)
      expect(result.id).toBe('12345')
    })

    it('should return errors when update fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          status: 'error',
          category: 'OBJECT_NOT_FOUND',
          message: 'Contact not found',
        }),
      })

      const result = await client.update('contacts', '99999', { phone: '555-1234' })

      expect(result.success).toBe(false)
      expect(result.error?.category).toBe('OBJECT_NOT_FOUND')
    })
  })

  describe('createBatch', () => {
    it('should create multiple records in a batch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: '1', properties: {}, createdAt: '', updatedAt: '', archived: false },
            { id: '2', properties: {}, createdAt: '', updatedAt: '', archived: false },
          ],
          errors: [],
        }),
      })

      const records = [
        { properties: { email: 'test1@example.com' } },
        { properties: { email: 'test2@example.com' } },
      ]

      const result = await client.createBatch('contacts', records)

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(2)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle mixed success and failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: '1', properties: {}, createdAt: '', updatedAt: '', archived: false },
          ],
          errors: [
            { status: 'error', category: 'VALIDATION_ERROR', message: 'Invalid email', correlationId: '123' },
          ],
        }),
      })

      const records = [
        { properties: { email: 'valid@example.com' } },
        { properties: { email: 'invalid' } },
      ]

      const result = await client.createBatch('contacts', records)

      expect(result.results).toHaveLength(1)
      expect(result.errors).toHaveLength(1)
    })

    it('should return empty result for empty input', async () => {
      const result = await client.createBatch('contacts', [])

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('updateBatch', () => {
    it('should update multiple records in a batch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: '1', properties: {}, createdAt: '', updatedAt: '', archived: false },
            { id: '2', properties: {}, createdAt: '', updatedAt: '', archived: false },
          ],
          errors: [],
        }),
      })

      const records = [
        { id: '1', properties: { phone: '555-1111' } },
        { id: '2', properties: { phone: '555-2222' } },
      ]

      const result = await client.updateBatch('contacts', records)

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(2)
    })
  })

  describe('upsertBatch', () => {
    it('should search and create new records', async () => {
      // First call: search returns no results
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })
      // Second call: create batch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: '1', properties: {}, createdAt: '', updatedAt: '', archived: false },
          ],
          errors: [],
        }),
      })

      const records = [{ properties: { email: 'new@example.com' } }]
      const result = await client.upsertBatch('contacts', 'email', records)

      expect(result.results).toHaveLength(1)
    })

    it('should search and update existing records', async () => {
      // First call: search returns existing record
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: '123' }] }),
      })
      // Second call: update batch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETE',
          results: [
            { id: '123', properties: {}, createdAt: '', updatedAt: '', archived: false },
          ],
          errors: [],
        }),
      })

      const records = [{ properties: { email: 'existing@example.com', phone: '555-new' } }]
      const result = await client.upsertBatch('contacts', 'email', records)

      expect(result.results).toHaveLength(1)
      expect(result.results[0].id).toBe('123')
    })
  })
})

// =============================================================================
// Destination Connector Tests
// =============================================================================

describe('HubSpot Destination Connector', () => {
  describe('spec', () => {
    it('should return connector specification', async () => {
      const spec = await hubspotDestinationDef.spec()

      expect(spec.name).toBe('HubSpot Destination')
      expect(spec.version).toBe('1.0.0')
      expect(spec.configSpec.required).toContain('accessToken')
      expect(spec.supportedSyncModes).toContain('append')
      expect(spec.supportedSyncModes).toContain('append_dedup')
    })

    it('should mark accessToken as secret', async () => {
      const spec = await hubspotDestinationDef.spec()

      expect(spec.configSpec.properties.accessToken?.secret).toBe(true)
    })
  })

  describe('check', () => {
    it('should return SUCCEEDED for valid credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      })

      const status = await hubspotDestinationDef.check({
        accessToken: 'valid-token',
        fetch: mockFetch,
      })

      expect(status.status).toBe('SUCCEEDED')
    })

    it('should return FAILED for invalid credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Invalid API key' }),
      })

      const status = await hubspotDestinationDef.check({
        accessToken: 'invalid-token',
        fetch: mockFetch,
      })

      expect(status.status).toBe('FAILED')
      expect(status.message).toBe('Invalid API key')
    })
  })

  describe('write', () => {
    it('should process record messages and create records', async () => {
      // Mock search (returns no results) and create batch
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'COMPLETE',
            results: [{ id: '1', properties: {}, createdAt: '', updatedAt: '', archived: false }],
            errors: [],
          }),
        })

      const config: HubSpotDestinationConfig = {
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
              firstName: 'John',
            },
          },
        }
        yield { type: 'STATE', state: { data: { cursor: '2024-01-01' } } }
      })()

      const results: any[] = []
      for await (const msg of hubspotDestinationDef.write(config, { streams: [] }, messages)) {
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

      const config: HubSpotDestinationConfig = {
        accessToken: 'test-token',
        objectType: 'contacts',
        batchSize: 10,
        fetch: mockFetch,
      } as any

      const messages: AsyncIterable<any> = (async function* () {
        yield {
          type: 'RECORD',
          record: {
            stream: 'contacts',
            data: {
              firstName: 'John',
              // Missing email which is required
            },
          },
        }
      })()

      const results: any[] = []
      for await (const msg of hubspotDestinationDef.write(config, { streams: [] }, messages)) {
        results.push(msg)
      }

      // Should have a warning log about skipped record
      const warnLogs = results.filter(r => r.type === 'LOG' && r.log.level === 'WARN')
      expect(warnLogs.length).toBeGreaterThan(0)
      expect(warnLogs[0].log.message).toContain('missing required properties')
    })

    it('should infer object type from stream name', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            status: 'COMPLETE',
            results: [{ id: '1', properties: {}, createdAt: '', updatedAt: '', archived: false }],
            errors: [],
          }),
        })

      const config: HubSpotDestinationConfig = {
        accessToken: 'test-token',
        batchSize: 1,
        fetch: mockFetch,
      }

      const messages: AsyncIterable<any> = (async function* () {
        yield {
          type: 'RECORD',
          record: {
            stream: 'companies', // Should infer 'companies' object type
            data: {
              name: 'Acme Corp', // Required field for companies
            },
          },
        }
        // Add a STATE message to trigger the flush
        yield { type: 'STATE', state: { data: {} } }
      })()

      const results: any[] = []
      for await (const msg of hubspotDestinationDef.write(config, { streams: [] }, messages)) {
        results.push(msg)
      }

      // Check that the batch create was called for companies (or search for upsert)
      expect(mockFetch).toHaveBeenCalled()
      // The first call should be to search for existing companies (upsert uses domain as unique key)
      const searchCall = mockFetch.mock.calls.find((call: [string, unknown]) =>
        call[0].includes('/companies/search')
      )
      const createCall = mockFetch.mock.calls.find((call: [string, unknown]) =>
        call[0].includes('/companies/batch/create')
      )
      // Should have made at least one companies API call
      expect(searchCall || createCall).toBeTruthy()
    })
  })

  describe('createHubSpotDestination', () => {
    it('should create a destination connector instance', () => {
      const connector = createHubSpotDestination()

      expect(connector).toBeDefined()
      expect(typeof connector.spec).toBe('function')
      expect(typeof connector.check).toBe('function')
      expect(typeof connector.write).toBe('function')
    })
  })
})
