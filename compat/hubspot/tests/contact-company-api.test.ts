/**
 * @dotdo/hubspot - Contact/Company API Tests (RED Phase)
 *
 * TDD RED phase tests for HubSpot Contact and Company API operations.
 * These tests cover the HubSpot SDK-compatible API patterns including:
 *
 * 1. Contact CRUD via basicApi
 * 2. Contact Search via searchApi
 * 3. Contact Batch operations via batchApi
 * 4. Company CRUD via basicApi
 * 5. Company Search via searchApi
 * 6. Company Batch operations via batchApi
 * 7. Contact-Company Associations
 * 8. Properties and Property Groups
 *
 * Tests are designed to FAIL until full implementation is complete.
 *
 * @module @dotdo/hubspot/tests/contact-company-api
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Client, HubSpotError } from '../../../packages/hubspot/src/client'
import type {
  Contact,
  Company,
  SearchRequest,
  SearchResult,
  BatchResult,
  ListResult,
  AssociationType,
} from '../../../packages/hubspot/src/types'

// =============================================================================
// Mock Fetch Setup
// =============================================================================

function createMockFetch(responses: Map<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const key = `${method}:${url}`

    // Check for exact match first, then pattern match
    let response = responses.get(key)

    if (!response) {
      // Try pattern matching for dynamic IDs
      for (const [pattern, value] of responses.entries()) {
        if (key.match(new RegExp(pattern.replace(/\[id\]/g, '[^/]+')))) {
          response = value
          break
        }
      }
    }

    if (!response) {
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ message: 'Not Found', category: 'NOT_FOUND' }),
      }
    }

    if (typeof response === 'object' && 'error' in (response as Record<string, unknown>)) {
      const errorData = response as { error: { status: number; message: string; category: string } }
      return {
        ok: false,
        status: errorData.error.status,
        headers: new Headers(),
        json: async () => ({
          message: errorData.error.message,
          category: errorData.error.category,
        }),
      }
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => response,
    }
  })
}

// =============================================================================
// Contact API Tests (RED Phase)
// =============================================================================

describe('@dotdo/hubspot - Contact API', () => {
  let client: Client
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    client = new Client({
      accessToken: 'test-token',
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  // ===========================================================================
  // Contact Basic API
  // ===========================================================================

  describe('contacts.basicApi', () => {
    describe('create', () => {
      it('should create a contact with required properties', async () => {
        const contactData: Contact = {
          id: 'contact_123',
          properties: {
            email: 'test@example.com',
            firstname: 'John',
            lastname: 'Doe',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts', contactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.create({
          properties: {
            email: 'test@example.com',
            firstname: 'John',
            lastname: 'Doe',
          },
        })

        expect(result.id).toBe('contact_123')
        expect(result.properties.email).toBe('test@example.com')
        expect(result.properties.firstname).toBe('John')
        expect(result.properties.lastname).toBe('Doe')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.hubapi.com/crm/v3/objects/contacts',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Authorization: 'Bearer test-token',
            }),
          })
        )
      })

      it('should create a contact with all standard HubSpot properties', async () => {
        const fullContactData: Contact = {
          id: 'contact_456',
          properties: {
            email: 'full@example.com',
            firstname: 'Jane',
            lastname: 'Smith',
            phone: '+1-555-0123',
            company: 'Acme Corp',
            website: 'https://janesmith.com',
            address: '123 Main St',
            city: 'San Francisco',
            state: 'CA',
            zip: '94102',
            country: 'USA',
            jobtitle: 'CTO',
            lifecyclestage: 'lead',
            hs_lead_status: 'NEW',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts', fullContactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.create({
          properties: fullContactData.properties as Record<string, string>,
        })

        expect(result.properties.phone).toBe('+1-555-0123')
        expect(result.properties.jobtitle).toBe('CTO')
        expect(result.properties.lifecyclestage).toBe('lead')
      })

      it('should create a contact with custom properties', async () => {
        const customContactData: Contact = {
          id: 'contact_789',
          properties: {
            email: 'custom@example.com',
            custom_field_1: 'value1',
            custom_field_2: '12345',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts', customContactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.create({
          properties: {
            email: 'custom@example.com',
            custom_field_1: 'value1',
            custom_field_2: '12345',
          },
        })

        expect(result.properties.custom_field_1).toBe('value1')
        expect(result.properties.custom_field_2).toBe('12345')
      })

      it('should throw HubSpotError for duplicate email', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST:https://api.hubapi.com/crm/v3/objects/contacts',
              {
                error: {
                  status: 409,
                  message: 'Contact already exists with email: duplicate@example.com',
                  category: 'CONFLICT',
                },
              },
            ],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await expect(
          client.crm.contacts.basicApi.create({
            properties: { email: 'duplicate@example.com' },
          })
        ).rejects.toThrow(HubSpotError)
      })

      it('should throw HubSpotError for invalid properties', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST:https://api.hubapi.com/crm/v3/objects/contacts',
              {
                error: {
                  status: 400,
                  message: 'Property "invalid_prop" does not exist',
                  category: 'VALIDATION_ERROR',
                },
              },
            ],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await expect(
          client.crm.contacts.basicApi.create({
            properties: { invalid_prop: 'value' },
          })
        ).rejects.toThrow(HubSpotError)
      })
    })

    describe('getById', () => {
      it('should get a contact by ID', async () => {
        const contactData: Contact = {
          id: 'contact_123',
          properties: {
            email: 'get@example.com',
            firstname: 'Get',
            lastname: 'Test',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/contacts/contact_123', contactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.getById('contact_123')

        expect(result.id).toBe('contact_123')
        expect(result.properties.email).toBe('get@example.com')
      })

      it('should get a contact with specific properties', async () => {
        const contactData: Contact = {
          id: 'contact_123',
          properties: {
            email: 'specific@example.com',
            firstname: 'Specific',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/contacts/contact_123?properties=email&properties=firstname', contactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.getById('contact_123', ['email', 'firstname'])

        expect(result.properties.email).toBe('specific@example.com')
        expect(result.properties.firstname).toBe('Specific')
      })

      it('should throw HubSpotError for non-existent contact', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET:https://api.hubapi.com/crm/v3/objects/contacts/nonexistent',
              {
                error: {
                  status: 404,
                  message: 'Contact not found: nonexistent',
                  category: 'OBJECT_NOT_FOUND',
                },
              },
            ],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await expect(
          client.crm.contacts.basicApi.getById('nonexistent')
        ).rejects.toThrow(HubSpotError)
      })

      it('should include associations when requested', async () => {
        const contactData: Contact = {
          id: 'contact_123',
          properties: { email: 'assoc@example.com' },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
          associations: {
            companies: {
              results: [
                { toObjectId: 456, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1 }] },
              ],
            },
          },
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/contacts/contact_123?associations=companies', contactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        // Note: This test expects getById to support associations parameter
        // which may not be implemented yet (RED phase)
        const result = await (client.crm.contacts.basicApi as any).getById('contact_123', [], ['companies'])

        expect(result.associations?.companies?.results).toHaveLength(1)
      })
    })

    describe('update', () => {
      it('should update contact properties', async () => {
        const updatedContactData: Contact = {
          id: 'contact_123',
          properties: {
            email: 'update@example.com',
            firstname: 'Updated',
            lastname: 'Name',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T11:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['PATCH:https://api.hubapi.com/crm/v3/objects/contacts/contact_123', updatedContactData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.update('contact_123', {
          properties: { firstname: 'Updated' },
        })

        expect(result.properties.firstname).toBe('Updated')
      })

      it('should throw HubSpotError for invalid update', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'PATCH:https://api.hubapi.com/crm/v3/objects/contacts/contact_123',
              {
                error: {
                  status: 400,
                  message: 'Invalid property value',
                  category: 'VALIDATION_ERROR',
                },
              },
            ],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await expect(
          client.crm.contacts.basicApi.update('contact_123', {
            properties: { invalid: 'value' },
          })
        ).rejects.toThrow(HubSpotError)
      })
    })

    describe('archive', () => {
      it('should archive a contact', async () => {
        mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          headers: new Headers(),
          json: async () => undefined,
        })
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await client.crm.contacts.basicApi.archive('contact_123')

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.hubapi.com/crm/v3/objects/contacts/contact_123',
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })

    describe('getPage', () => {
      it('should list contacts with pagination', async () => {
        const listResult: ListResult<Contact> = {
          results: [
            {
              id: 'contact_1',
              properties: { email: 'user1@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'user2@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
          paging: {
            next: { after: 'contact_2' },
          },
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/contacts', listResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.getPage()

        expect(result.results).toHaveLength(2)
        expect(result.paging?.next?.after).toBe('contact_2')
      })

      it('should list contacts with limit and after cursor', async () => {
        const listResult: ListResult<Contact> = {
          results: [
            {
              id: 'contact_3',
              properties: { email: 'user3@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/contacts?limit=10&after=contact_2', listResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.basicApi.getPage({ limit: 10, after: 'contact_2' })

        expect(result.results).toHaveLength(1)
      })
    })
  })

  // ===========================================================================
  // Contact Search API
  // ===========================================================================

  describe('contacts.searchApi', () => {
    describe('doSearch', () => {
      it('should search contacts by query string', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 1,
          results: [
            {
              id: 'contact_123',
              properties: { email: 'john@example.com', firstname: 'John' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          query: 'john',
        })

        expect(result.total).toBe(1)
        expect(result.results[0].properties.firstname).toBe('John')
      })

      it('should search contacts with filter groups', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 2,
          results: [
            {
              id: 'contact_1',
              properties: { email: 'lead1@example.com', lifecyclestage: 'lead' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'lead2@example.com', lifecyclestage: 'lead' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                { propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' },
              ],
            },
          ],
        })

        expect(result.total).toBe(2)
        expect(result.results.every((c) => c.properties.lifecyclestage === 'lead')).toBe(true)
      })

      it('should search contacts with multiple filter groups (OR logic)', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 3,
          results: [
            {
              id: 'contact_1',
              properties: { email: 'lead@example.com', lifecyclestage: 'lead' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'customer@example.com', lifecyclestage: 'customer' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          filterGroups: [
            { filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' }] },
            { filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] },
          ],
        })

        expect(result.results.length).toBeGreaterThanOrEqual(2)
      })

      it('should search contacts with CONTAINS_TOKEN operator', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 2,
          results: [
            {
              id: 'contact_1',
              properties: { email: 'user1@acme.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'user2@acme.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                { propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '@acme.com' },
              ],
            },
          ],
        })

        expect(result.total).toBe(2)
      })

      it('should search contacts with IN operator', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 2,
          results: [
            {
              id: 'contact_1',
              properties: { firstname: 'John' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { firstname: 'Jane' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                { propertyName: 'firstname', operator: 'IN', values: ['John', 'Jane'] },
              ],
            },
          ],
        })

        expect(result.total).toBe(2)
      })

      it('should search contacts with sorting', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 3,
          results: [
            { id: '1', properties: { firstname: 'Alice' }, createdAt: '', updatedAt: '', archived: false },
            { id: '2', properties: { firstname: 'Bob' }, createdAt: '', updatedAt: '', archived: false },
            { id: '3', properties: { firstname: 'Charlie' }, createdAt: '', updatedAt: '', archived: false },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          sorts: [{ propertyName: 'firstname', direction: 'ASCENDING' }],
        })

        const names = result.results.map((c) => c.properties.firstname)
        expect(names).toEqual(['Alice', 'Bob', 'Charlie'])
      })

      it('should search contacts with specific properties', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 1,
          results: [
            {
              id: 'contact_1',
              properties: { email: 'test@example.com', firstname: 'Test' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          properties: ['email', 'firstname'],
          query: 'test',
        })

        expect(Object.keys(result.results[0].properties)).toContain('email')
        expect(Object.keys(result.results[0].properties)).toContain('firstname')
      })

      it('should search contacts with pagination', async () => {
        const searchResult: SearchResult<Contact> = {
          total: 100,
          results: [
            { id: '11', properties: { email: 'page2@example.com' }, createdAt: '', updatedAt: '', archived: false },
          ],
          paging: {
            next: { after: '20' },
          },
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.searchApi.doSearch({
          limit: 10,
          after: '10',
        })

        expect(result.paging?.next?.after).toBe('20')
      })
    })
  })

  // ===========================================================================
  // Contact Batch API
  // ===========================================================================

  describe('contacts.batchApi', () => {
    describe('create', () => {
      it('should batch create multiple contacts', async () => {
        const batchResult: BatchResult<Contact> = {
          status: 'COMPLETE',
          results: [
            {
              id: 'contact_1',
              properties: { email: 'batch1@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'batch2@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
          errors: [],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/batch/create', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.batchApi.create({
          inputs: [
            { properties: { email: 'batch1@example.com' } },
            { properties: { email: 'batch2@example.com' } },
          ],
        })

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })

      it('should handle partial batch create failures', async () => {
        const batchResult: BatchResult<Contact> = {
          status: 'COMPLETE',
          results: [
            {
              id: 'contact_1',
              properties: { email: 'success@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
          errors: [
            {
              status: 'error',
              category: 'CONFLICT',
              message: 'Contact already exists with email: duplicate@example.com',
              correlationId: 'correlation_123',
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/batch/create', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.batchApi.create({
          inputs: [
            { properties: { email: 'success@example.com' } },
            { properties: { email: 'duplicate@example.com' } },
          ],
        })

        expect(result.results).toHaveLength(1)
        expect(result.errors).toHaveLength(1)
      })
    })

    describe('read', () => {
      it('should batch read multiple contacts', async () => {
        const batchResult: BatchResult<Contact> = {
          status: 'COMPLETE',
          results: [
            {
              id: 'contact_1',
              properties: { email: 'read1@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'read2@example.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
          errors: [],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/batch/read', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.batchApi.read({
          inputs: [{ id: 'contact_1' }, { id: 'contact_2' }],
          properties: ['email'],
        })

        expect(result.results).toHaveLength(2)
      })
    })

    describe('update', () => {
      it('should batch update multiple contacts', async () => {
        const batchResult: BatchResult<Contact> = {
          status: 'COMPLETE',
          results: [
            {
              id: 'contact_1',
              properties: { email: 'updated1@example.com', firstname: 'Updated1' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T11:00:00Z',
              archived: false,
            },
            {
              id: 'contact_2',
              properties: { email: 'updated2@example.com', firstname: 'Updated2' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T11:00:00Z',
              archived: false,
            },
          ],
          errors: [],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/contacts/batch/update', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.contacts.batchApi.update({
          inputs: [
            { id: 'contact_1', properties: { firstname: 'Updated1' } },
            { id: 'contact_2', properties: { firstname: 'Updated2' } },
          ],
        })

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })
    })

    describe('archive', () => {
      it('should batch archive multiple contacts', async () => {
        mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          headers: new Headers(),
          json: async () => undefined,
        })
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await client.crm.contacts.batchApi.archive({
          inputs: [{ id: 'contact_1' }, { id: 'contact_2' }],
        })

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.hubapi.com/crm/v3/objects/contacts/batch/archive',
          expect.objectContaining({ method: 'POST' })
        )
      })
    })
  })
})

// =============================================================================
// Company API Tests (RED Phase)
// =============================================================================

describe('@dotdo/hubspot - Company API', () => {
  let client: Client
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    client = new Client({
      accessToken: 'test-token',
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  // ===========================================================================
  // Company Basic API
  // ===========================================================================

  describe('companies.basicApi', () => {
    describe('create', () => {
      it('should create a company with required properties', async () => {
        const companyData: Company = {
          id: 'company_123',
          properties: {
            name: 'Acme Corp',
            domain: 'acme.com',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies', companyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.create({
          properties: {
            name: 'Acme Corp',
            domain: 'acme.com',
          },
        })

        expect(result.id).toBe('company_123')
        expect(result.properties.name).toBe('Acme Corp')
        expect(result.properties.domain).toBe('acme.com')
      })

      it('should create a company with all standard HubSpot properties', async () => {
        const fullCompanyData: Company = {
          id: 'company_456',
          properties: {
            name: 'Full Corp',
            domain: 'fullcorp.com',
            industry: 'Technology',
            description: 'A technology company',
            phone: '+1-555-0123',
            address: '456 Tech Blvd',
            city: 'San Jose',
            state: 'CA',
            zip: '95110',
            country: 'USA',
            website: 'https://fullcorp.com',
            numberofemployees: '500',
            annualrevenue: '10000000',
            type: 'PROSPECT',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies', fullCompanyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.create({
          properties: fullCompanyData.properties as Record<string, string>,
        })

        expect(result.properties.industry).toBe('Technology')
        expect(result.properties.numberofemployees).toBe('500')
        expect(result.properties.annualrevenue).toBe('10000000')
      })

      it('should create a company with custom properties', async () => {
        const customCompanyData: Company = {
          id: 'company_789',
          properties: {
            name: 'Custom Corp',
            custom_industry_code: 'TECH-001',
            custom_region: 'APAC',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies', customCompanyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.create({
          properties: {
            name: 'Custom Corp',
            custom_industry_code: 'TECH-001',
            custom_region: 'APAC',
          },
        })

        expect(result.properties.custom_industry_code).toBe('TECH-001')
        expect(result.properties.custom_region).toBe('APAC')
      })

      it('should throw HubSpotError for duplicate domain', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST:https://api.hubapi.com/crm/v3/objects/companies',
              {
                error: {
                  status: 409,
                  message: 'Company already exists with domain: duplicate.com',
                  category: 'CONFLICT',
                },
              },
            ],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await expect(
          client.crm.companies.basicApi.create({
            properties: { name: 'Duplicate Corp', domain: 'duplicate.com' },
          })
        ).rejects.toThrow(HubSpotError)
      })
    })

    describe('getById', () => {
      it('should get a company by ID', async () => {
        const companyData: Company = {
          id: 'company_123',
          properties: {
            name: 'Get Corp',
            domain: 'getcorp.com',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/companies/company_123', companyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.getById('company_123')

        expect(result.id).toBe('company_123')
        expect(result.properties.name).toBe('Get Corp')
      })

      it('should get a company with specific properties', async () => {
        const companyData: Company = {
          id: 'company_123',
          properties: {
            name: 'Specific Corp',
            industry: 'Technology',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/companies/company_123?properties=name&properties=industry', companyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.getById('company_123', ['name', 'industry'])

        expect(result.properties.name).toBe('Specific Corp')
        expect(result.properties.industry).toBe('Technology')
      })

      it('should throw HubSpotError for non-existent company', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET:https://api.hubapi.com/crm/v3/objects/companies/nonexistent',
              {
                error: {
                  status: 404,
                  message: 'Company not found: nonexistent',
                  category: 'OBJECT_NOT_FOUND',
                },
              },
            ],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await expect(
          client.crm.companies.basicApi.getById('nonexistent')
        ).rejects.toThrow(HubSpotError)
      })

      it('should include associated contacts when requested', async () => {
        const companyData: Company = {
          id: 'company_123',
          properties: { name: 'Assoc Corp' },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          archived: false,
          associations: {
            contacts: {
              results: [
                { toObjectId: 789, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1 }] },
              ],
            },
          },
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/companies/company_123?associations=contacts', companyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        // Note: This test expects getById to support associations parameter (RED phase)
        const result = await (client.crm.companies.basicApi as any).getById('company_123', [], ['contacts'])

        expect(result.associations?.contacts?.results).toHaveLength(1)
      })
    })

    describe('update', () => {
      it('should update company properties', async () => {
        const updatedCompanyData: Company = {
          id: 'company_123',
          properties: {
            name: 'Updated Corp',
            industry: 'Finance',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T11:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['PATCH:https://api.hubapi.com/crm/v3/objects/companies/company_123', updatedCompanyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.update('company_123', {
          properties: { industry: 'Finance' },
        })

        expect(result.properties.industry).toBe('Finance')
      })

      it('should update employee count and revenue', async () => {
        const updatedCompanyData: Company = {
          id: 'company_123',
          properties: {
            name: 'Growing Corp',
            numberofemployees: '1000',
            annualrevenue: '50000000',
          },
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T11:00:00Z',
          archived: false,
        }

        mockFetch = createMockFetch(
          new Map([
            ['PATCH:https://api.hubapi.com/crm/v3/objects/companies/company_123', updatedCompanyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.update('company_123', {
          properties: {
            numberofemployees: '1000',
            annualrevenue: '50000000',
          },
        })

        expect(result.properties.numberofemployees).toBe('1000')
        expect(result.properties.annualrevenue).toBe('50000000')
      })
    })

    describe('archive', () => {
      it('should archive a company', async () => {
        mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          headers: new Headers(),
          json: async () => undefined,
        })
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await client.crm.companies.basicApi.archive('company_123')

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.hubapi.com/crm/v3/objects/companies/company_123',
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })

    describe('getPage', () => {
      it('should list companies with pagination', async () => {
        const listResult: ListResult<Company> = {
          results: [
            {
              id: 'company_1',
              properties: { name: 'Company 1' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'company_2',
              properties: { name: 'Company 2' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
          paging: {
            next: { after: 'company_2' },
          },
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/objects/companies', listResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.basicApi.getPage()

        expect(result.results).toHaveLength(2)
        expect(result.paging?.next?.after).toBe('company_2')
      })
    })
  })

  // ===========================================================================
  // Company Search API
  // ===========================================================================

  describe('companies.searchApi', () => {
    describe('doSearch', () => {
      it('should search companies by query string', async () => {
        const searchResult: SearchResult<Company> = {
          total: 1,
          results: [
            {
              id: 'company_123',
              properties: { name: 'Acme Corp', domain: 'acme.com' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.searchApi.doSearch({
          query: 'acme',
        })

        expect(result.total).toBe(1)
        expect(result.results[0].properties.name).toBe('Acme Corp')
      })

      it('should search companies by industry', async () => {
        const searchResult: SearchResult<Company> = {
          total: 3,
          results: [
            { id: '1', properties: { name: 'Tech 1', industry: 'Technology' }, createdAt: '', updatedAt: '', archived: false },
            { id: '2', properties: { name: 'Tech 2', industry: 'Technology' }, createdAt: '', updatedAt: '', archived: false },
            { id: '3', properties: { name: 'Tech 3', industry: 'Technology' }, createdAt: '', updatedAt: '', archived: false },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                { propertyName: 'industry', operator: 'EQ', value: 'Technology' },
              ],
            },
          ],
        })

        expect(result.total).toBe(3)
        expect(result.results.every((c) => c.properties.industry === 'Technology')).toBe(true)
      })

      it('should search companies by employee count range', async () => {
        const searchResult: SearchResult<Company> = {
          total: 2,
          results: [
            { id: '1', properties: { name: 'Medium Corp', numberofemployees: '150' }, createdAt: '', updatedAt: '', archived: false },
            { id: '2', properties: { name: 'Large Corp', numberofemployees: '400' }, createdAt: '', updatedAt: '', archived: false },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                { propertyName: 'numberofemployees', operator: 'GTE', value: '100' },
                { propertyName: 'numberofemployees', operator: 'LTE', value: '500' },
              ],
            },
          ],
        })

        expect(result.total).toBe(2)
      })

      it('should search companies by annual revenue', async () => {
        const searchResult: SearchResult<Company> = {
          total: 1,
          results: [
            {
              id: '1',
              properties: { name: 'Enterprise Corp', annualrevenue: '100000000' },
              createdAt: '',
              updatedAt: '',
              archived: false,
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                { propertyName: 'annualrevenue', operator: 'GTE', value: '50000000' },
              ],
            },
          ],
        })

        expect(result.total).toBe(1)
        expect(Number(result.results[0].properties.annualrevenue)).toBeGreaterThanOrEqual(50000000)
      })

      it('should search companies with sorting by name', async () => {
        const searchResult: SearchResult<Company> = {
          total: 3,
          results: [
            { id: '1', properties: { name: 'Alpha Corp' }, createdAt: '', updatedAt: '', archived: false },
            { id: '2', properties: { name: 'Beta Corp' }, createdAt: '', updatedAt: '', archived: false },
            { id: '3', properties: { name: 'Gamma Corp' }, createdAt: '', updatedAt: '', archived: false },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/search', searchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.searchApi.doSearch({
          sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
        })

        const names = result.results.map((c) => c.properties.name)
        expect(names).toEqual(['Alpha Corp', 'Beta Corp', 'Gamma Corp'])
      })
    })
  })

  // ===========================================================================
  // Company Batch API
  // ===========================================================================

  describe('companies.batchApi', () => {
    describe('create', () => {
      it('should batch create multiple companies', async () => {
        const batchResult: BatchResult<Company> = {
          status: 'COMPLETE',
          results: [
            {
              id: 'company_1',
              properties: { name: 'Batch Corp 1' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
            {
              id: 'company_2',
              properties: { name: 'Batch Corp 2' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T10:00:00Z',
              archived: false,
            },
          ],
          errors: [],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/batch/create', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.batchApi.create({
          inputs: [
            { properties: { name: 'Batch Corp 1' } },
            { properties: { name: 'Batch Corp 2' } },
          ],
        })

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })
    })

    describe('update', () => {
      it('should batch update multiple companies', async () => {
        const batchResult: BatchResult<Company> = {
          status: 'COMPLETE',
          results: [
            {
              id: 'company_1',
              properties: { name: 'Updated Corp 1', industry: 'Tech' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T11:00:00Z',
              archived: false,
            },
            {
              id: 'company_2',
              properties: { name: 'Updated Corp 2', industry: 'Finance' },
              createdAt: '2024-01-15T10:00:00Z',
              updatedAt: '2024-01-15T11:00:00Z',
              archived: false,
            },
          ],
          errors: [],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/objects/companies/batch/update', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.companies.batchApi.update({
          inputs: [
            { id: 'company_1', properties: { industry: 'Tech' } },
            { id: 'company_2', properties: { industry: 'Finance' } },
          ],
        })

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })
    })
  })
})

// =============================================================================
// Contact-Company Association Tests (RED Phase)
// =============================================================================

describe('@dotdo/hubspot - Contact-Company Associations', () => {
  let client: Client
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    client = new Client({
      accessToken: 'test-token',
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  describe('associations.v4.basicApi', () => {
    describe('create', () => {
      it('should create association between contact and company', async () => {
        const associationData = {
          from: { id: 'contact_123' },
          to: { id: 'company_456' },
          type: 'contact_to_company',
        }

        mockFetch = createMockFetch(
          new Map([
            ['PUT:https://api.hubapi.com/crm/v4/objects/contacts/contact_123/associations/companies/company_456', associationData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const associationTypes: AssociationType[] = [
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 },
        ]

        const result = await client.crm.associations.v4.basicApi.create(
          'contacts',
          'contact_123',
          'companies',
          'company_456',
          associationTypes
        )

        expect(result).toBeDefined()
      })

      it('should create labeled association between contact and company', async () => {
        const associationData = {
          from: { id: 'contact_123' },
          to: { id: 'company_456' },
          labels: ['Primary Contact'],
        }

        mockFetch = createMockFetch(
          new Map([
            ['PUT:https://api.hubapi.com/crm/v4/objects/contacts/contact_123/associations/companies/company_456', associationData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const associationTypes: AssociationType[] = [
          { associationCategory: 'USER_DEFINED', associationTypeId: 100, label: 'Primary Contact' },
        ]

        const result = await client.crm.associations.v4.basicApi.create(
          'contacts',
          'contact_123',
          'companies',
          'company_456',
          associationTypes
        )

        expect(result).toBeDefined()
      })
    })

    describe('getPage', () => {
      it('should list associations for a contact', async () => {
        const listResult = {
          results: [
            {
              toObjectId: 'company_456',
              associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1 }],
            },
            {
              toObjectId: 'company_789',
              associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1 }],
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v4/objects/contacts/contact_123/associations/companies', listResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.associations.v4.basicApi.getPage(
          'contacts',
          'contact_123',
          'companies'
        )

        expect(result.results).toHaveLength(2)
      })

      it('should list associations for a company', async () => {
        const listResult = {
          results: [
            {
              toObjectId: 'contact_123',
              associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 2 }],
            },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v4/objects/companies/company_456/associations/contacts', listResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.associations.v4.basicApi.getPage(
          'companies',
          'company_456',
          'contacts'
        )

        expect(result.results).toHaveLength(1)
      })
    })

    describe('archive', () => {
      it('should delete association between contact and company', async () => {
        mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          headers: new Headers(),
          json: async () => undefined,
        })
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        await client.crm.associations.v4.basicApi.archive(
          'contacts',
          'contact_123',
          'companies',
          'company_456'
        )

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.hubapi.com/crm/v4/objects/contacts/contact_123/associations/companies/company_456',
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })
  })

  describe('associations.v4.batchApi', () => {
    describe('create', () => {
      it('should batch create associations', async () => {
        const batchResult = {
          status: 'COMPLETE',
          results: [
            { from: { id: 'contact_1' }, to: { id: 'company_1' }, type: 'contact_to_company' },
            { from: { id: 'contact_2' }, to: { id: 'company_1' }, type: 'contact_to_company' },
          ],
          errors: [],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v4/associations/contacts/companies/batch/create', batchResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const associationTypes: AssociationType[] = [
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 },
        ]

        const result = await client.crm.associations.v4.batchApi.create(
          'contacts',
          'companies',
          {
            inputs: [
              { from: { id: 'contact_1' }, to: { id: 'company_1' }, types: associationTypes },
              { from: { id: 'contact_2' }, to: { id: 'company_1' }, types: associationTypes },
            ],
          }
        )

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })
    })
  })
})

// =============================================================================
// Properties API Tests (RED Phase)
// =============================================================================

describe('@dotdo/hubspot - Properties API for Contacts and Companies', () => {
  let client: Client
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    client = new Client({
      accessToken: 'test-token',
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  describe('properties.coreApi', () => {
    describe('getAll', () => {
      it('should list all contact properties', async () => {
        const propertiesResult = {
          results: [
            { name: 'email', label: 'Email', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
            { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
            { name: 'lastname', label: 'Last Name', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/properties/contacts', propertiesResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.properties.coreApi.getAll('contacts')

        expect(result.results).toHaveLength(3)
        expect(result.results.find((p) => p.name === 'email')).toBeDefined()
      })

      it('should list all company properties', async () => {
        const propertiesResult = {
          results: [
            { name: 'name', label: 'Company Name', type: 'string', fieldType: 'text', groupName: 'companyinformation' },
            { name: 'domain', label: 'Company Domain', type: 'string', fieldType: 'text', groupName: 'companyinformation' },
            { name: 'industry', label: 'Industry', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation' },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/properties/companies', propertiesResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.properties.coreApi.getAll('companies')

        expect(result.results).toHaveLength(3)
        expect(result.results.find((p) => p.name === 'name')).toBeDefined()
      })
    })

    describe('getByName', () => {
      it('should get a specific contact property', async () => {
        const propertyData = {
          name: 'email',
          label: 'Email',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          hasUniqueValue: true,
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/properties/contacts/email', propertyData],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.properties.coreApi.getByName('contacts', 'email')

        expect(result.name).toBe('email')
        expect(result.hasUniqueValue).toBe(true)
      })
    })

    describe('create', () => {
      it('should create a custom contact property', async () => {
        const createdProperty = {
          name: 'custom_contact_field',
          label: 'Custom Contact Field',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/properties/contacts', createdProperty],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.properties.coreApi.create('contacts', {
          name: 'custom_contact_field',
          label: 'Custom Contact Field',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
        })

        expect(result.name).toBe('custom_contact_field')
      })

      it('should create a custom company property with options', async () => {
        const createdProperty = {
          name: 'company_tier',
          label: 'Company Tier',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'companyinformation',
          options: [
            { label: 'Enterprise', value: 'enterprise', displayOrder: 0 },
            { label: 'Mid-Market', value: 'midmarket', displayOrder: 1 },
            { label: 'SMB', value: 'smb', displayOrder: 2 },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['POST:https://api.hubapi.com/crm/v3/properties/companies', createdProperty],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.properties.coreApi.create('companies', {
          name: 'company_tier',
          label: 'Company Tier',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'companyinformation',
          options: [
            { label: 'Enterprise', value: 'enterprise', displayOrder: 0 },
            { label: 'Mid-Market', value: 'midmarket', displayOrder: 1 },
            { label: 'SMB', value: 'smb', displayOrder: 2 },
          ],
        })

        expect(result.options).toHaveLength(3)
      })
    })
  })

  describe('properties.groupsApi', () => {
    describe('getAll', () => {
      it('should list contact property groups', async () => {
        const groupsResult = {
          results: [
            { name: 'contactinformation', label: 'Contact Information', displayOrder: 0 },
            { name: 'socialmedianformation', label: 'Social Media Information', displayOrder: 1 },
          ],
        }

        mockFetch = createMockFetch(
          new Map([
            ['GET:https://api.hubapi.com/crm/v3/properties/contacts/groups', groupsResult],
          ])
        )
        client = new Client({ accessToken: 'test-token', fetch: mockFetch as unknown as typeof fetch })

        const result = await client.crm.properties.groupsApi.getAll('contacts')

        expect(result.results).toHaveLength(2)
      })
    })
  })
})
