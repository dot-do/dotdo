/**
 * JSON:API Worker Unit Tests
 *
 * Tests for JSON:API transformation functions and query parameter parsing.
 *
 * @module workers/jsonapi.test
 */

import { describe, it, expect } from 'vitest'
import {
  toJsonApiResource,
  toJsonApiCollection,
  toJsonApiError,
  parseFieldsets,
  parseIncludes,
} from './jsonapi'

// =============================================================================
// toJsonApiResource Tests
// =============================================================================

describe('toJsonApiResource', () => {
  it('transforms DO response to JSON:API resource document', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice', email: 'alice@example.com.ai' },
    }

    const result = toJsonApiResource(response, '/api')

    expect(result.jsonapi.version).toBe('1.1')
    expect(result.data).toBeDefined()

    const resource = result.data as { type: string; id: string; attributes: Record<string, unknown> }
    expect(resource.type).toBe('users')
    expect(resource.id).toBe('user-123')
    expect(resource.attributes).toEqual({ name: 'Alice', email: 'alice@example.com.ai' })
  })

  it('includes self link for resource', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice' },
    }

    const result = toJsonApiResource(response, '/api')
    const resource = result.data as { links?: { self?: string } }

    expect(resource.links?.self).toBe('/api/users/user-123')
  })

  it('handles null response', () => {
    const result = toJsonApiResource(null, '/api')

    expect(result.jsonapi.version).toBe('1.1')
    expect(result.data).toBeNull()
  })

  it('transforms relationships to JSON:API format', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice' },
      relationships: {
        posts: [
          { id: 'post-1', type: 'posts' },
          { id: 'post-2', type: 'posts' },
        ],
      },
    }

    const result = toJsonApiResource(response, '/api')
    const resource = result.data as {
      relationships?: {
        posts?: {
          links?: { self?: string; related?: string }
          data?: Array<{ type: string; id: string }>
        }
      }
    }

    expect(resource.relationships?.posts).toBeDefined()
    expect(resource.relationships?.posts?.links?.self).toBe('/api/users/user-123/relationships/posts')
    expect(resource.relationships?.posts?.links?.related).toBe('/api/users/user-123/posts')
    expect(resource.relationships?.posts?.data).toEqual([
      { type: 'posts', id: 'post-1' },
      { type: 'posts', id: 'post-2' },
    ])
  })

  it('includes meta from DO response', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice' },
      meta: { createdAt: '2024-01-01' },
    }

    const result = toJsonApiResource(response, '/api')
    const resource = result.data as { meta?: Record<string, unknown> }

    expect(resource.meta).toEqual({ createdAt: '2024-01-01' })
  })

  it('applies sparse fieldsets', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice', email: 'alice@example.com.ai', age: 30 },
    }

    const result = toJsonApiResource(response, '/api', {
      fieldsets: { users: ['name', 'email'] },
    })
    const resource = result.data as { attributes: Record<string, unknown> }

    expect(resource.attributes).toEqual({ name: 'Alice', email: 'alice@example.com.ai' })
    expect(resource.attributes.age).toBeUndefined()
  })

  it('includes related resources when requested', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice' },
      relationships: {
        posts: [{ id: 'post-1', type: 'posts' }],
      },
    }

    const includedResources = [
      { id: 'post-1', type: 'posts', data: { title: 'Hello World' } },
    ]

    const result = toJsonApiResource(response, '/api', {
      includes: ['posts'],
      includedResources,
    })

    expect(result.included).toBeDefined()
    expect(result.included).toHaveLength(1)
    expect(result.included![0].type).toBe('posts')
    expect(result.included![0].id).toBe('post-1')
  })

  it('deduplicates included resources', () => {
    const response = {
      id: 'user-123',
      type: 'users',
      data: { name: 'Alice' },
    }

    const includedResources = [
      { id: 'post-1', type: 'posts', data: { title: 'Hello' } },
      { id: 'post-1', type: 'posts', data: { title: 'Hello' } }, // Duplicate
      { id: 'post-2', type: 'posts', data: { title: 'World' } },
    ]

    const result = toJsonApiResource(response, '/api', {
      includes: ['posts'],
      includedResources,
    })

    expect(result.included).toHaveLength(2)
  })
})

// =============================================================================
// toJsonApiCollection Tests
// =============================================================================

describe('toJsonApiCollection', () => {
  it('transforms array of DO responses to JSON:API collection', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
      { id: 'user-2', type: 'users', data: { name: 'Bob' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users')

    expect(result.jsonapi.version).toBe('1.1')
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  it('includes self link for collection', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users')

    expect(result.links?.self).toBe('/api/users')
  })

  it('handles empty array', () => {
    const result = toJsonApiCollection([], '/api', 'users')

    expect(result.data).toEqual([])
    expect(result.links?.self).toBe('/api/users')
  })

  it('adds pagination links when provided', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      pagination: {
        pageNumber: 2,
        pageSize: 10,
        totalPages: 5,
        totalItems: 50,
      },
    })

    expect(result.links?.first).toBe('/api/users?page[number]=1')
    expect(result.links?.last).toBe('/api/users?page[number]=5')
    expect(result.links?.prev).toBe('/api/users?page[number]=1')
    expect(result.links?.next).toBe('/api/users?page[number]=3')
  })

  it('sets prev to null on first page', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      pagination: {
        pageNumber: 1,
        pageSize: 10,
        totalPages: 5,
        totalItems: 50,
      },
    })

    expect(result.links?.prev).toBeNull()
    expect(result.links?.next).toBe('/api/users?page[number]=2')
  })

  it('sets next to null on last page', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      pagination: {
        pageNumber: 5,
        pageSize: 10,
        totalPages: 5,
        totalItems: 50,
      },
    })

    expect(result.links?.prev).toBe('/api/users?page[number]=4')
    expect(result.links?.next).toBeNull()
  })

  it('includes totalItems and totalPages in meta', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      pagination: {
        pageNumber: 1,
        pageSize: 10,
        totalPages: 5,
        totalItems: 50,
      },
    })

    expect(result.meta?.totalItems).toBe(50)
    expect(result.meta?.totalPages).toBe(5)
  })

  it('includes custom meta without pagination', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      meta: { customField: 'customValue' },
    })

    expect(result.meta?.customField).toBe('customValue')
  })

  it('applies sparse fieldsets to collection items', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice', email: 'a@example.com.ai', age: 30 } },
      { id: 'user-2', type: 'users', data: { name: 'Bob', email: 'b@example.com.ai', age: 25 } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      fieldsets: { users: ['name'] },
    })

    const items = result.data as Array<{ attributes: Record<string, unknown> }>
    expect(items[0].attributes).toEqual({ name: 'Alice' })
    expect(items[1].attributes).toEqual({ name: 'Bob' })
  })

  it('includes related resources in collection', () => {
    const responses = [
      { id: 'user-1', type: 'users', data: { name: 'Alice' } },
    ]

    const includedResources = [
      { id: 'post-1', type: 'posts', data: { title: 'Hello' } },
    ]

    const result = toJsonApiCollection(responses, '/api', 'users', {
      includes: ['posts'],
      includedResources,
    })

    expect(result.included).toHaveLength(1)
  })
})

// =============================================================================
// toJsonApiError Tests
// =============================================================================

describe('toJsonApiError', () => {
  it('creates JSON:API error document', () => {
    const result = toJsonApiError({
      status: '404',
      title: 'Not Found',
      detail: 'The requested resource was not found',
    })

    expect(result.jsonapi.version).toBe('1.1')
    expect(result.errors).toBeDefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors![0].status).toBe('404')
    expect(result.errors![0].title).toBe('Not Found')
    expect(result.errors![0].detail).toBe('The requested resource was not found')
  })

  it('includes error code when provided', () => {
    const result = toJsonApiError({
      status: '400',
      code: 'VALIDATION_ERROR',
      title: 'Validation Error',
      detail: 'Invalid email format',
    })

    expect(result.errors![0].code).toBe('VALIDATION_ERROR')
  })

  it('includes source when provided', () => {
    const result = toJsonApiError({
      status: '400',
      title: 'Validation Error',
      detail: 'Invalid email format',
      source: { pointer: '/data/attributes/email' },
    })

    expect(result.errors![0].source).toEqual({ pointer: '/data/attributes/email' })
  })

  it('includes source parameter when provided', () => {
    const result = toJsonApiError({
      status: '400',
      title: 'Invalid Parameter',
      detail: 'Page number must be positive',
      source: { parameter: 'page[number]' },
    })

    expect(result.errors![0].source).toEqual({ parameter: 'page[number]' })
  })

  it('includes meta when provided', () => {
    const result = toJsonApiError({
      status: '500',
      title: 'Internal Error',
      detail: 'An unexpected error occurred',
      meta: { requestId: 'req-123', timestamp: '2024-01-01T00:00:00Z' },
    })

    expect(result.errors![0].meta).toEqual({
      requestId: 'req-123',
      timestamp: '2024-01-01T00:00:00Z',
    })
  })
})

// =============================================================================
// parseFieldsets Tests
// =============================================================================

describe('parseFieldsets', () => {
  it('parses single fieldset', () => {
    const params = new URLSearchParams('fields[users]=name,email')
    const result = parseFieldsets(params)

    expect(result).toEqual({ users: ['name', 'email'] })
  })

  it('parses multiple fieldsets', () => {
    const params = new URLSearchParams('fields[users]=name,email&fields[posts]=title,body')
    const result = parseFieldsets(params)

    expect(result).toEqual({
      users: ['name', 'email'],
      posts: ['title', 'body'],
    })
  })

  it('returns empty object for no fieldsets', () => {
    const params = new URLSearchParams('page=1&limit=10')
    const result = parseFieldsets(params)

    expect(result).toEqual({})
  })

  it('trims whitespace from field names', () => {
    const params = new URLSearchParams('fields[users]= name , email ')
    const result = parseFieldsets(params)

    expect(result).toEqual({ users: ['name', 'email'] })
  })

  it('handles single field', () => {
    const params = new URLSearchParams('fields[users]=name')
    const result = parseFieldsets(params)

    expect(result).toEqual({ users: ['name'] })
  })

  it('handles empty value', () => {
    const params = new URLSearchParams('fields[users]=')
    const result = parseFieldsets(params)

    expect(result).toEqual({ users: [''] })
  })
})

// =============================================================================
// parseIncludes Tests
// =============================================================================

describe('parseIncludes', () => {
  it('parses single include', () => {
    const params = new URLSearchParams('include=posts')
    const result = parseIncludes(params)

    expect(result).toEqual(['posts'])
  })

  it('parses multiple includes', () => {
    const params = new URLSearchParams('include=posts,comments,author')
    const result = parseIncludes(params)

    expect(result).toEqual(['posts', 'comments', 'author'])
  })

  it('returns empty array when no includes', () => {
    const params = new URLSearchParams('page=1&limit=10')
    const result = parseIncludes(params)

    expect(result).toEqual([])
  })

  it('trims whitespace from include names', () => {
    const params = new URLSearchParams('include= posts , comments ')
    const result = parseIncludes(params)

    expect(result).toEqual(['posts', 'comments'])
  })

  it('handles nested includes', () => {
    const params = new URLSearchParams('include=posts.author,posts.comments')
    const result = parseIncludes(params)

    expect(result).toEqual(['posts.author', 'posts.comments'])
  })

  it('handles empty include value', () => {
    const params = new URLSearchParams('include=')
    const result = parseIncludes(params)

    // Empty string split results in [''], which gets trimmed to ['']
    expect(result).toEqual([''])
  })
})
