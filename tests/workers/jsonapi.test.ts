/**
 * JSON:API Worker Tests (RED Phase)
 *
 * Tests for the JSON:API format transformation worker that converts
 * DO responses to JSON:API spec (jsonapi.org) format.
 *
 * Implementation requirements:
 * - Create workers/jsonapi.ts with Hono app
 * - Routes: /{ns}/{collection}/ for collections, /{ns}/{collection}/{id} for resources
 * - Transform DO responses to JSON:API format
 * - Handle pagination, sparse fieldsets (fields[type]), and includes
 * - Return proper JSON:API error responses
 *
 * @see https://jsonapi.org/format/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// This import should fail until the implementation exists
import {
  createJsonApiHandler,
  toJsonApiResource,
  toJsonApiCollection,
  toJsonApiError,
  parseFieldsets,
  parseIncludes,
  type JsonApiDocument,
  type JsonApiResource,
  type JsonApiError,
} from '../../workers/jsonapi'

// ============================================================================
// Mock DO Response Types
// ============================================================================

interface MockDoResponse {
  id: string
  type: string
  data: Record<string, unknown>
  relationships?: Record<string, { id: string; type: string }[]>
}

// ============================================================================
// Helper Functions for Creating Mock Data
// ============================================================================

function createMockStartup(overrides: Partial<MockDoResponse> = {}): MockDoResponse {
  return {
    id: 'headless.ly',
    type: 'Startup',
    data: { name: 'Headless.ly', stage: 'seed', founded: 2024 },
    relationships: {
      founders: [
        { id: 'nathan', type: 'Human' },
        { id: 'alex', type: 'Human' },
      ],
    },
    ...overrides,
  }
}

function createMockHuman(overrides: Partial<MockDoResponse> = {}): MockDoResponse {
  return {
    id: 'nathan',
    type: 'Human',
    data: { name: 'Nathan Clevenger', role: 'CEO' },
    ...overrides,
  }
}

// ============================================================================
// Test: JSON:API Document Structure
// ============================================================================

describe('JSON:API Document Structure', () => {
  it('should include jsonapi version object', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    expect(document.jsonapi).toBeDefined()
    expect(document.jsonapi.version).toBe('1.1')
  })

  it('should include data as single resource for single resource response', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    expect(document.data).toBeDefined()
    expect(Array.isArray(document.data)).toBe(false)
    expect((document.data as JsonApiResource).type).toBe('Startup')
    expect((document.data as JsonApiResource).id).toBe('headless.ly')
  })

  it('should include data as array for collection response', () => {
    const resources = [createMockStartup(), createMockStartup({ id: 'workers.do' })]
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup')

    expect(document.data).toBeDefined()
    expect(Array.isArray(document.data)).toBe(true)
    expect((document.data as JsonApiResource[]).length).toBe(2)
  })
})

// ============================================================================
// Test: Single Resource Format
// ============================================================================

describe('toJsonApiResource - Single Resource', () => {
  it('should transform DO response to JSON:API resource format', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.type).toBe('Startup')
    expect(data.id).toBe('headless.ly')
    expect(data.attributes).toEqual({ name: 'Headless.ly', stage: 'seed', founded: 2024 })
  })

  it('should include self link in resource', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.links).toBeDefined()
    expect(data.links?.self).toBe('/test-ns/Startup/headless.ly')
  })

  it('should transform relationships to JSON:API format', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.relationships).toBeDefined()
    expect(data.relationships?.founders).toBeDefined()
    expect(data.relationships?.founders?.links?.related).toBe('/test-ns/Startup/headless.ly/founders')
  })

  it('should handle resource without relationships', () => {
    const resource = createMockHuman()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.relationships).toBeUndefined()
  })

  it('should handle null data gracefully', () => {
    const document = toJsonApiResource(null as unknown as MockDoResponse, '/test-ns')

    expect(document.data).toBeNull()
  })
})

// ============================================================================
// Test: Collection Format
// ============================================================================

describe('toJsonApiCollection - Collection Response', () => {
  it('should transform array of DO responses to JSON:API collection', () => {
    const resources = [
      createMockStartup(),
      createMockStartup({ id: 'workers.do', data: { name: 'Workers.do', stage: 'growth' } }),
    ]
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup')

    const data = document.data as JsonApiResource[]
    expect(data).toHaveLength(2)
    expect(data[0].id).toBe('headless.ly')
    expect(data[1].id).toBe('workers.do')
  })

  it('should include self link for collection', () => {
    const resources = [createMockStartup()]
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup')

    expect(document.links).toBeDefined()
    expect(document.links?.self).toBe('/test-ns/Startup')
  })

  it('should handle empty collection', () => {
    const document = toJsonApiCollection([], '/test-ns', 'Startup')

    expect(document.data).toEqual([])
    expect(document.links?.self).toBe('/test-ns/Startup')
  })

  it('should preserve type across all resources in collection', () => {
    const resources = [
      createMockStartup(),
      createMockStartup({ id: 'platform.do' }),
    ]
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup')

    const data = document.data as JsonApiResource[]
    for (const resource of data) {
      expect(resource.type).toBe('Startup')
    }
  })
})

// ============================================================================
// Test: Pagination
// ============================================================================

describe('toJsonApiCollection - Pagination', () => {
  it('should include pagination links when pagination info provided', () => {
    const resources = [createMockStartup()]
    const pagination = {
      pageNumber: 2,
      pageSize: 10,
      totalPages: 5,
      totalItems: 50,
    }
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup', { pagination })

    expect(document.links?.first).toBe('/test-ns/Startup?page[number]=1')
    expect(document.links?.last).toBe('/test-ns/Startup?page[number]=5')
    expect(document.links?.prev).toBe('/test-ns/Startup?page[number]=1')
    expect(document.links?.next).toBe('/test-ns/Startup?page[number]=3')
  })

  it('should have null prev link on first page', () => {
    const resources = [createMockStartup()]
    const pagination = {
      pageNumber: 1,
      pageSize: 10,
      totalPages: 5,
      totalItems: 50,
    }
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup', { pagination })

    expect(document.links?.prev).toBeNull()
    expect(document.links?.next).toBe('/test-ns/Startup?page[number]=2')
  })

  it('should have null next link on last page', () => {
    const resources = [createMockStartup()]
    const pagination = {
      pageNumber: 5,
      pageSize: 10,
      totalPages: 5,
      totalItems: 50,
    }
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup', { pagination })

    expect(document.links?.prev).toBe('/test-ns/Startup?page[number]=4')
    expect(document.links?.next).toBeNull()
  })

  it('should include meta with total count', () => {
    const resources = [createMockStartup()]
    const pagination = {
      pageNumber: 1,
      pageSize: 10,
      totalPages: 5,
      totalItems: 50,
    }
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup', { pagination })

    expect(document.meta).toBeDefined()
    expect(document.meta?.totalItems).toBe(50)
    expect(document.meta?.totalPages).toBe(5)
  })

  it('should not include pagination links when no pagination provided', () => {
    const resources = [createMockStartup()]
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup')

    expect(document.links?.first).toBeUndefined()
    expect(document.links?.last).toBeUndefined()
    expect(document.links?.prev).toBeUndefined()
    expect(document.links?.next).toBeUndefined()
  })
})

// ============================================================================
// Test: Sparse Fieldsets
// ============================================================================

describe('parseFieldsets - Sparse Fieldsets', () => {
  it('should parse fields[type] query parameter', () => {
    const searchParams = new URLSearchParams('fields[Startup]=name,stage')
    const fieldsets = parseFieldsets(searchParams)

    expect(fieldsets.Startup).toEqual(['name', 'stage'])
  })

  it('should parse multiple type fieldsets', () => {
    const searchParams = new URLSearchParams('fields[Startup]=name,stage&fields[Human]=name,role')
    const fieldsets = parseFieldsets(searchParams)

    expect(fieldsets.Startup).toEqual(['name', 'stage'])
    expect(fieldsets.Human).toEqual(['name', 'role'])
  })

  it('should handle empty fields parameter', () => {
    const searchParams = new URLSearchParams('')
    const fieldsets = parseFieldsets(searchParams)

    expect(fieldsets).toEqual({})
  })

  it('should handle single field', () => {
    const searchParams = new URLSearchParams('fields[Startup]=name')
    const fieldsets = parseFieldsets(searchParams)

    expect(fieldsets.Startup).toEqual(['name'])
  })

  it('should trim whitespace from field names', () => {
    const searchParams = new URLSearchParams('fields[Startup]=name , stage')
    const fieldsets = parseFieldsets(searchParams)

    expect(fieldsets.Startup).toEqual(['name', 'stage'])
  })
})

describe('toJsonApiResource - Sparse Fieldsets Applied', () => {
  it('should filter attributes based on fieldsets', () => {
    const resource = createMockStartup()
    const fieldsets = { Startup: ['name'] }
    const document = toJsonApiResource(resource, '/test-ns', { fieldsets })

    const data = document.data as JsonApiResource
    expect(data.attributes).toEqual({ name: 'Headless.ly' })
    expect(data.attributes?.stage).toBeUndefined()
    expect(data.attributes?.founded).toBeUndefined()
  })

  it('should not filter if fieldset not specified for type', () => {
    const resource = createMockStartup()
    const fieldsets = { Human: ['name'] } // Different type
    const document = toJsonApiResource(resource, '/test-ns', { fieldsets })

    const data = document.data as JsonApiResource
    expect(data.attributes).toEqual({ name: 'Headless.ly', stage: 'seed', founded: 2024 })
  })

  it('should handle empty fieldset for type', () => {
    const resource = createMockStartup()
    const fieldsets = { Startup: [] }
    const document = toJsonApiResource(resource, '/test-ns', { fieldsets })

    const data = document.data as JsonApiResource
    expect(data.attributes).toEqual({})
  })
})

// ============================================================================
// Test: Includes (Sideloading Relationships)
// ============================================================================

describe('parseIncludes - Include Parameter', () => {
  it('should parse include query parameter', () => {
    const searchParams = new URLSearchParams('include=founders')
    const includes = parseIncludes(searchParams)

    expect(includes).toEqual(['founders'])
  })

  it('should parse multiple includes', () => {
    const searchParams = new URLSearchParams('include=founders,investors,products')
    const includes = parseIncludes(searchParams)

    expect(includes).toEqual(['founders', 'investors', 'products'])
  })

  it('should handle nested includes', () => {
    const searchParams = new URLSearchParams('include=founders.company,investors')
    const includes = parseIncludes(searchParams)

    expect(includes).toEqual(['founders.company', 'investors'])
  })

  it('should return empty array when no includes', () => {
    const searchParams = new URLSearchParams('')
    const includes = parseIncludes(searchParams)

    expect(includes).toEqual([])
  })
})

describe('toJsonApiResource - Includes Applied', () => {
  it('should include related resources in included array', () => {
    const resource = createMockStartup()
    const includedResources = [
      createMockHuman({ id: 'nathan', data: { name: 'Nathan Clevenger', role: 'CEO' } }),
      createMockHuman({ id: 'alex', data: { name: 'Alex Smith', role: 'CTO' } }),
    ]
    const document = toJsonApiResource(resource, '/test-ns', {
      includes: ['founders'],
      includedResources,
    })

    expect(document.included).toBeDefined()
    expect(document.included).toHaveLength(2)
    expect(document.included?.[0].type).toBe('Human')
    expect(document.included?.[0].id).toBe('nathan')
  })

  it('should format included resources as JSON:API resources', () => {
    const resource = createMockStartup()
    const includedResources = [createMockHuman()]
    const document = toJsonApiResource(resource, '/test-ns', {
      includes: ['founders'],
      includedResources,
    })

    const included = document.included?.[0]
    expect(included?.type).toBe('Human')
    expect(included?.id).toBe('nathan')
    expect(included?.attributes).toEqual({ name: 'Nathan Clevenger', role: 'CEO' })
    expect(included?.links?.self).toBe('/test-ns/Human/nathan')
  })

  it('should not include duplicates in included array', () => {
    const resource = createMockStartup()
    const includedResources = [
      createMockHuman({ id: 'nathan' }),
      createMockHuman({ id: 'nathan' }), // Duplicate
    ]
    const document = toJsonApiResource(resource, '/test-ns', {
      includes: ['founders'],
      includedResources,
    })

    expect(document.included).toHaveLength(1)
  })

  it('should not have included array when no includes requested', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    expect(document.included).toBeUndefined()
  })
})

// ============================================================================
// Test: Error Responses
// ============================================================================

describe('toJsonApiError - Error Responses', () => {
  it('should format error with status, title, and detail', () => {
    const error = toJsonApiError({
      status: '404',
      title: 'Not Found',
      detail: 'Resource not found',
    })

    expect(error.jsonapi.version).toBe('1.1')
    expect(error.errors).toHaveLength(1)
    expect(error.errors[0].status).toBe('404')
    expect(error.errors[0].title).toBe('Not Found')
    expect(error.errors[0].detail).toBe('Resource not found')
  })

  it('should include source pointer when provided', () => {
    const error = toJsonApiError({
      status: '422',
      title: 'Validation Error',
      detail: 'Name is required',
      source: { pointer: '/data/attributes/name' },
    })

    expect(error.errors[0].source?.pointer).toBe('/data/attributes/name')
  })

  it('should include source parameter when provided', () => {
    const error = toJsonApiError({
      status: '400',
      title: 'Bad Request',
      detail: 'Invalid filter value',
      source: { parameter: 'filter[status]' },
    })

    expect(error.errors[0].source?.parameter).toBe('filter[status]')
  })

  it('should support multiple errors', () => {
    const errorDoc: JsonApiDocument = {
      jsonapi: { version: '1.1' },
      errors: [
        { status: '422', title: 'Validation Error', detail: 'Name is required' },
        { status: '422', title: 'Validation Error', detail: 'Email is invalid' },
      ],
    }

    expect(errorDoc.errors).toHaveLength(2)
  })

  it('should include error code when provided', () => {
    const error = toJsonApiError({
      status: '403',
      code: 'FORBIDDEN_RESOURCE',
      title: 'Forbidden',
      detail: 'Access denied',
    })

    expect(error.errors[0].code).toBe('FORBIDDEN_RESOURCE')
  })

  it('should include meta when provided', () => {
    const error = toJsonApiError({
      status: '500',
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred',
      meta: { requestId: 'req-123', timestamp: '2024-01-01T00:00:00Z' },
    })

    expect(error.errors[0].meta?.requestId).toBe('req-123')
    expect(error.errors[0].meta?.timestamp).toBe('2024-01-01T00:00:00Z')
  })
})

// ============================================================================
// Test: HTTP Handler
// ============================================================================

describe('createJsonApiHandler - HTTP Handler', () => {
  const mockEnv = {
    DO: {
      idFromName: vi.fn().mockReturnValue('mock-do-id'),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn(),
      }),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should route collection requests to /{ns}/{collection}/', async () => {
    const handler = createJsonApiHandler()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([createMockStartup()]), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockEnv.DO.get.mockReturnValue({ fetch: mockFetch })

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/')
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
    const body = await response.json() as JsonApiDocument
    expect(body.jsonapi.version).toBe('1.1')
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('should route single resource requests to /{ns}/{collection}/{id}', async () => {
    const handler = createJsonApiHandler()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createMockStartup()), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockEnv.DO.get.mockReturnValue({ fetch: mockFetch })

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/headless.ly')
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
    const body = await response.json() as JsonApiDocument
    expect(body.jsonapi.version).toBe('1.1')
    expect(Array.isArray(body.data)).toBe(false)
    expect((body.data as JsonApiResource).id).toBe('headless.ly')
  })

  it('should return JSON:API error for 404 from DO', async () => {
    const handler = createJsonApiHandler()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })
    )
    mockEnv.DO.get.mockReturnValue({ fetch: mockFetch })

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/nonexistent')
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(404)
    const body = await response.json() as JsonApiDocument
    expect(body.errors).toBeDefined()
    expect(body.errors?.[0].status).toBe('404')
  })

  it('should set correct Content-Type header', async () => {
    const handler = createJsonApiHandler()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([createMockStartup()]), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockEnv.DO.get.mockReturnValue({ fetch: mockFetch })

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/')
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.headers.get('Content-Type')).toBe('application/vnd.api+json')
  })

  it('should pass sparse fieldsets to transformation', async () => {
    const handler = createJsonApiHandler()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createMockStartup()), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockEnv.DO.get.mockReturnValue({ fetch: mockFetch })

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/headless.ly?fields[Startup]=name')
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
    const body = await response.json() as JsonApiDocument
    const data = body.data as JsonApiResource
    expect(data.attributes).toEqual({ name: 'Headless.ly' })
    expect(data.attributes?.stage).toBeUndefined()
  })

  it('should handle include parameter for sideloading', async () => {
    const handler = createJsonApiHandler()
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createMockStartup()), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([createMockHuman()]), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    mockEnv.DO.get.mockReturnValue({ fetch: mockFetch })

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/headless.ly?include=founders')
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
    const body = await response.json() as JsonApiDocument
    expect(body.included).toBeDefined()
  })

  it('should return 400 for invalid JSON:API request', async () => {
    const handler = createJsonApiHandler()

    // Invalid Accept header
    const request = new Request('https://api.dotdo.dev/test-ns/Startup/', {
      headers: { 'Accept': 'application/vnd.api+json; ext=bulk' }, // Extension not supported
    })
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    // Should return 406 Not Acceptable for invalid media type parameters
    expect(response.status).toBe(406)
  })

  it('should handle missing DO binding gracefully', async () => {
    const handler = createJsonApiHandler()
    const envWithoutDO = {}

    const request = new Request('https://api.dotdo.dev/test-ns/Startup/')
    const response = await handler(request, envWithoutDO)

    expect(response.status).toBe(500)
    const body = await response.json() as JsonApiDocument
    expect(body.errors?.[0].title).toBe('Internal Server Error')
  })
})

// ============================================================================
// Test: Content Negotiation
// ============================================================================

describe('Content Negotiation', () => {
  let mockEnv: { DO: { idFromName: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } }

  beforeEach(() => {
    mockEnv = {
      DO: {
        idFromName: vi.fn().mockReturnValue('mock-do-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(
            new Response(JSON.stringify([createMockStartup()]), {
              headers: { 'Content-Type': 'application/json' },
            })
          ),
        }),
      },
    }
  })

  it('should accept application/vnd.api+json', async () => {
    const handler = createJsonApiHandler()
    const request = new Request('https://api.dotdo.dev/test-ns/Startup/', {
      headers: { 'Accept': 'application/vnd.api+json' },
    })
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
  })

  it('should accept application/json', async () => {
    const handler = createJsonApiHandler()
    const request = new Request('https://api.dotdo.dev/test-ns/Startup/', {
      headers: { 'Accept': 'application/json' },
    })
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
  })

  it('should accept */*', async () => {
    const handler = createJsonApiHandler()
    const request = new Request('https://api.dotdo.dev/test-ns/Startup/', {
      headers: { 'Accept': '*/*' },
    })
    const response = await handler(request, mockEnv as unknown as Record<string, unknown>)

    expect(response.status).toBe(200)
  })
})

// ============================================================================
// Test: Relationship Links
// ============================================================================

describe('Relationship Links', () => {
  it('should generate related links for relationships', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.relationships?.founders?.links?.related).toBe('/test-ns/Startup/headless.ly/founders')
  })

  it('should generate self links for relationships', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.relationships?.founders?.links?.self).toBe('/test-ns/Startup/headless.ly/relationships/founders')
  })

  it('should include relationship data identifiers', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.relationships?.founders?.data).toBeDefined()
    expect(Array.isArray(data.relationships?.founders?.data)).toBe(true)
    expect((data.relationships?.founders?.data as Array<{ type: string; id: string }>)[0]).toEqual({
      type: 'Human',
      id: 'nathan',
    })
  })
})

// ============================================================================
// Test: Meta Information
// ============================================================================

describe('Meta Information', () => {
  it('should support meta at document level', () => {
    const resources = [createMockStartup()]
    const document = toJsonApiCollection(resources, '/test-ns', 'Startup', {
      meta: { generatedAt: '2024-01-01T00:00:00Z', version: '1.0' },
    })

    expect(document.meta?.generatedAt).toBe('2024-01-01T00:00:00Z')
    expect(document.meta?.version).toBe('1.0')
  })

  it('should support meta at resource level', () => {
    const resource = {
      ...createMockStartup(),
      meta: { lastModified: '2024-01-01T00:00:00Z' },
    }
    const document = toJsonApiResource(resource as MockDoResponse & { meta: Record<string, unknown> }, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.meta?.lastModified).toBe('2024-01-01T00:00:00Z')
  })
})

// ============================================================================
// Test: Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle special characters in IDs', () => {
    const resource = createMockStartup({ id: 'startup-with-dash' })
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.id).toBe('startup-with-dash')
    expect(data.links?.self).toBe('/test-ns/Startup/startup-with-dash')
  })

  it('should handle URL-encoded IDs', () => {
    const resource = createMockStartup({ id: 'startup%20with%20spaces' })
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.id).toBe('startup%20with%20spaces')
  })

  it('should handle empty attributes', () => {
    const resource = { id: 'empty', type: 'Empty', data: {} }
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.attributes).toEqual({})
  })

  it('should handle nested data in attributes', () => {
    const resource = createMockStartup({
      data: {
        name: 'Headless.ly',
        settings: { theme: 'dark', notifications: true },
      },
    })
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.attributes?.settings).toEqual({ theme: 'dark', notifications: true })
  })

  it('should handle arrays in attributes', () => {
    const resource = createMockStartup({
      data: {
        name: 'Headless.ly',
        tags: ['saas', 'ai', 'startup'],
      },
    })
    const document = toJsonApiResource(resource, '/test-ns')

    const data = document.data as JsonApiResource
    expect(data.attributes?.tags).toEqual(['saas', 'ai', 'startup'])
  })
})

// ============================================================================
// Type Validation
// ============================================================================

describe('Type Validation', () => {
  it('should produce valid JsonApiDocument type', () => {
    const resource = createMockStartup()
    const document: JsonApiDocument = toJsonApiResource(resource, '/test-ns')

    expect(document.jsonapi).toBeDefined()
    expect(document.data).toBeDefined()
  })

  it('should produce valid JsonApiResource type', () => {
    const resource = createMockStartup()
    const document = toJsonApiResource(resource, '/test-ns')
    const data = document.data as JsonApiResource

    expect(typeof data.type).toBe('string')
    expect(typeof data.id).toBe('string')
    expect(typeof data.attributes).toBe('object')
  })

  it('should produce valid JsonApiError type', () => {
    const errorDoc = toJsonApiError({
      status: '404',
      title: 'Not Found',
      detail: 'Resource not found',
    })

    const error: JsonApiError = errorDoc.errors![0]
    expect(typeof error.status).toBe('string')
    expect(typeof error.title).toBe('string')
    expect(typeof error.detail).toBe('string')
  })
})
