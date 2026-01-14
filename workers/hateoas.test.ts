/**
 * HATEOAS Worker Unit Tests
 *
 * Tests for the HATEOAS response wrapper that provides discoverable REST APIs.
 * Tests helper functions and response formatting without requiring real DOs.
 *
 * @module workers/hateoas.test
 */

import { describe, it, expect } from 'vitest'
import {
  createRootResponse,
  createCollectionResponse,
  createInstanceResponse,
  type HATEOASResponse,
} from '../api/hateoas'

// =============================================================================
// createRootResponse Tests
// =============================================================================

describe('createRootResponse', () => {
  it('creates root response with name and version', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '2.0.0',
    })

    expect(response.$context).toBe('https://api.example.com/tenant')
    expect(response.name).toBe('My API')
    expect(response.version).toBe('2.0.0')
  })

  it('includes nouns when provided', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      nouns: ['users', 'posts', 'comments'],
    })

    expect(response.nouns).toEqual(['users', 'posts', 'comments'])
  })

  it('includes schemaTables when provided', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      schemaTables: ['user', 'session', 'account'],
    })

    expect(response.schemaTables).toEqual(['user', 'session', 'account'])
  })

  it('includes links for discovery', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      nouns: ['users'],
    })

    expect(response.links).toBeDefined()
    expect(response.links!.self).toBe('https://api.example.com/tenant/')
  })

  it('builds collection links from nouns', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      nouns: ['users', 'posts'],
    })

    expect(response.collections).toBeDefined()
    expect(response.collections!.users).toBe('https://api.example.com/tenant/users/')
    expect(response.collections!.posts).toBe('https://api.example.com/tenant/posts/')
  })

  it('handles empty nouns array', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      nouns: [],
    })

    expect(response.nouns).toEqual([])
    expect(response.collections).toEqual({})
  })

  it('handles undefined nouns', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
    })

    expect(response.nouns).toBeUndefined()
  })
})

// =============================================================================
// createCollectionResponse Tests
// =============================================================================

describe('createCollectionResponse', () => {
  it('wraps items array with collection metadata', () => {
    const items = [
      { $id: 'user-1', name: 'Alice' },
      { $id: 'user-2', name: 'Bob' },
    ]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.$context).toBe('https://api.example.com/tenant')
    expect(response.$type).toBe('users')
    expect(response.items).toEqual(items)
    expect(response.count).toBe(2)
  })

  it('adds self link for collection', () => {
    const response = createCollectionResponse([{ $id: '1' }], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.links).toBeDefined()
    expect(response.links!.self).toBe('https://api.example.com/tenant/users/')
  })

  it('adds instance links to each item', () => {
    const items = [
      { $id: 'user-1', name: 'Alice' },
      { $id: 'user-2', name: 'Bob' },
    ]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    const responseItems = response.items as Array<{ $id: string; links?: { self?: string } }>
    expect(responseItems[0].links?.self).toBe('https://api.example.com/tenant/users/user-1')
    expect(responseItems[1].links?.self).toBe('https://api.example.com/tenant/users/user-2')
  })

  it('includes verbs when provided', () => {
    const response = createCollectionResponse([{ $id: '1' }], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      verbs: ['create', 'list', 'search'],
    })

    expect(response.verbs).toEqual(['create', 'list', 'search'])
  })

  it('handles empty items array', () => {
    const response = createCollectionResponse([], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.items).toEqual([])
    expect(response.count).toBe(0)
  })

  it('preserves all item properties', () => {
    const items = [
      { $id: 'user-1', name: 'Alice', email: 'alice@example.com', age: 30 },
    ]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    const item = response.items[0] as Record<string, unknown>
    expect(item.name).toBe('Alice')
    expect(item.email).toBe('alice@example.com')
    expect(item.age).toBe(30)
  })
})

// =============================================================================
// createInstanceResponse Tests
// =============================================================================

describe('createInstanceResponse', () => {
  it('wraps item with instance metadata', () => {
    const item = { name: 'Alice', email: 'alice@example.com' }

    const response = createInstanceResponse(item, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.$context).toBe('https://api.example.com/tenant')
    expect(response.$type).toBe('users')
    expect(response.$id).toBe('user-1')
    expect(response.name).toBe('Alice')
    expect(response.email).toBe('alice@example.com')
  })

  it('adds self link for instance', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links).toBeDefined()
    expect(response.links!.self).toBe('https://api.example.com/tenant/users/user-1')
  })

  it('adds collection link', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links!.collection).toBe('https://api.example.com/tenant/users/')
  })

  it('includes verbs when provided', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
      verbs: ['update', 'delete', 'archive'],
    })

    expect(response.verbs).toEqual(['update', 'delete', 'archive'])
  })

  it('includes relationships when provided', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
      relationships: {
        posts: 'https://api.example.com/tenant/users/user-1/posts',
        comments: 'https://api.example.com/tenant/users/user-1/comments',
      },
    })

    expect(response.relationships).toEqual({
      posts: 'https://api.example.com/tenant/users/user-1/posts',
      comments: 'https://api.example.com/tenant/users/user-1/comments',
    })
  })

  it('handles complex nested data', () => {
    const item = {
      name: 'Alice',
      profile: {
        bio: 'Developer',
        links: ['github.com/alice', 'linkedin.com/alice'],
      },
      settings: {
        notifications: {
          email: true,
          push: false,
        },
      },
    }

    const response = createInstanceResponse(item, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.name).toBe('Alice')
    expect(response.profile).toEqual({
      bio: 'Developer',
      links: ['github.com/alice', 'linkedin.com/alice'],
    })
    expect(response.settings).toEqual({
      notifications: {
        email: true,
        push: false,
      },
    })
  })

  it('handles empty item object', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.$id).toBe('user-1')
    expect(response.$type).toBe('users')
    expect(response.links).toBeDefined()
  })

  it('handles special characters in id', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-with-special_chars.123',
    })

    expect(response.$id).toBe('user-with-special_chars.123')
    expect(response.links!.self).toContain('user-with-special_chars.123')
  })
})

// =============================================================================
// HATEOAS Link Structure Tests
// =============================================================================

describe('HATEOAS Link Structure', () => {
  it('root response links are properly formatted', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'Test API',
      version: '1.0.0',
      nouns: ['users', 'posts'],
    })

    // Self link ends with /
    expect(response.links!.self).toMatch(/\/$/)

    // Collection links end with /
    Object.values(response.collections || {}).forEach((link) => {
      expect(link).toMatch(/\/$/)
    })
  })

  it('collection response self link ends with /', () => {
    const response = createCollectionResponse([{ $id: '1' }], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.links!.self).toMatch(/\/$/)
  })

  it('instance response self link does not end with /', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links!.self).not.toMatch(/\/$/)
  })

  it('instance collection link ends with /', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links!.collection).toMatch(/\/$/)
  })
})

// =============================================================================
// Context URL Handling Tests
// =============================================================================

describe('Context URL Handling', () => {
  it('handles context without trailing slash', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'API',
      version: '1.0.0',
    })

    expect(response.$context).toBe('https://api.example.com/tenant')
    expect(response.links!.self).toBe('https://api.example.com/tenant/')
  })

  it('handles context with trailing slash', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant/',
      name: 'API',
      version: '1.0.0',
    })

    // Implementation may normalize this
    expect(response.$context).toContain('https://api.example.com/tenant')
  })

  it('handles deeply nested context path', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/v1/tenant/nested',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links!.self).toBe('https://api.example.com/v1/tenant/nested/users/user-1')
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('response has correct structure types', () => {
    const rootResponse = createRootResponse({
      $context: 'https://api.example.com',
      name: 'API',
      version: '1.0.0',
    })

    // Type checks (these would fail at compile time if wrong)
    const _context: string = rootResponse.$context
    const _name: string = rootResponse.name
    const _version: string = rootResponse.version

    expect(typeof _context).toBe('string')
    expect(typeof _name).toBe('string')
    expect(typeof _version).toBe('string')
  })

  it('collection response items are properly typed', () => {
    type User = { $id: string; name: string }
    const items: User[] = [{ $id: '1', name: 'Alice' }]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com',
      $type: 'users',
    })

    expect(Array.isArray(response.items)).toBe(true)
    expect(response.items.length).toBe(1)
  })

  it('instance response preserves item properties', () => {
    const item = { customField: 'value', numericField: 42 }

    const response = createInstanceResponse(item, {
      $context: 'https://api.example.com',
      $type: 'items',
      $id: 'item-1',
    })

    expect((response as Record<string, unknown>).customField).toBe('value')
    expect((response as Record<string, unknown>).numericField).toBe(42)
  })
})
