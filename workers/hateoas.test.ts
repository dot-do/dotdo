/**
 * HATEOAS Response Wrapper Tests
 *
 * Tests for the api/hateoas.ts response wrapper functions.
 * Tests the createRootResponse, createCollectionResponse, and createInstanceResponse
 * functions that provide discoverable REST APIs.
 *
 * @module workers/hateoas.test
 */

import { describe, it, expect } from 'vitest'
import {
  createRootResponse,
  createCollectionResponse,
  createInstanceResponse,
} from '../api/hateoas'

// =============================================================================
// createRootResponse Tests
// =============================================================================

describe('createRootResponse', () => {
  it('creates root response with api metadata', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '2.0.0',
    })

    expect(response.api.$context).toBe('https://api.example.com/tenant')
    expect(response.api.name).toBe('My API')
    expect(response.api.version).toBe('2.0.0')
  })

  it('includes collections when nouns are provided', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      nouns: ['users', 'posts', 'comments'],
    })

    expect(response.collections).toBeDefined()
    expect(response.collections!.users).toBe('/users/')
    expect(response.collections!.posts).toBe('/posts/')
    expect(response.collections!.comments).toBe('/comments/')
  })

  it('includes schema when schemaTables are provided', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      schemaTables: ['user', 'session', 'account'],
    })

    expect(response.schema).toBeDefined()
    expect(response.schema!.user).toBe('/user/')
    expect(response.schema!.session).toBe('/session/')
    expect(response.schema!.account).toBe('/account/')
  })

  it('includes self link', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
    })

    expect(response.links).toBeDefined()
    expect(response.links.self).toBe('/')
    expect(response.links.home).toBe('/')
  })

  it('includes discover section with built-in collections', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'API',
      version: '1.0.0',
    })

    expect(response.discover).toBeDefined()
    expect(response.discover!.things).toBe('/things/')
    expect(response.discover!.actions).toBe('/actions/')
    expect(response.discover!.events).toBe('/events/')
  })

  it('includes actions for RPC, MCP, and sync', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'API',
      version: '1.0.0',
    })

    expect(response.actions).toBeDefined()
    expect(response.actions!.rpc).toEqual({ method: 'POST', href: '/rpc' })
    expect(response.actions!.mcp).toEqual({ method: 'POST', href: '/mcp' })
    expect(response.actions!.sync).toEqual({ method: 'GET', href: '/sync', protocol: 'websocket' })
  })

  it('does not include collections when nouns is undefined', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
    })

    expect(response.collections).toBeUndefined()
  })

  it('does not include collections when nouns is empty', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'My API',
      version: '1.0.0',
      nouns: [],
    })

    expect(response.collections).toBeUndefined()
  })

  it('data is null for root response', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com/tenant',
      name: 'API',
      version: '1.0.0',
    })

    expect(response.data).toBeNull()
  })

  it('throws if $context is missing', () => {
    expect(() => {
      createRootResponse({
        $context: '',
        name: 'API',
        version: '1.0.0',
      })
    }).toThrow('$context is required')
  })

  it('throws if $context is not a valid URL', () => {
    expect(() => {
      createRootResponse({
        $context: 'not-a-url',
        name: 'API',
        version: '1.0.0',
      })
    }).toThrow('$context must be a valid URL')
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

    expect(response.api.$context).toBe('https://api.example.com/tenant')
    expect(response.api.$type).toBe('users')
    expect(response.data).toEqual(items)
  })

  it('adds self link for collection', () => {
    const response = createCollectionResponse([{ $id: '1' }], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.links).toBeDefined()
    expect(response.links.self).toBe('/users/')
    expect(response.links.home).toBe('/')
  })

  it('generates discover section with item links', () => {
    const items = [
      { $id: 'user-1', name: 'Alice' },
      { $id: 'user-2', name: 'Bob' },
    ]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.discover).toBeDefined()
    expect(response.discover!['user-1']).toBe('/users/user-1')
    expect(response.discover!['user-2']).toBe('/users/user-2')
  })

  it('includes verbs when provided', () => {
    const response = createCollectionResponse([{ $id: '1' }], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      verbs: ['create', 'list', 'search'],
    })

    expect(response.verbs).toEqual(['create', 'list', 'search'])
  })

  it('includes create and search actions', () => {
    const response = createCollectionResponse([], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.actions).toBeDefined()
    expect(response.actions!.create).toBeDefined()
    expect(response.actions!.create.method).toBe('POST')
    expect(response.actions!.search).toBeDefined()
    expect(response.actions!.search.templated).toBe(true)
  })

  it('handles empty items array', () => {
    const response = createCollectionResponse([], {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.data).toEqual([])
    expect(response.discover).toEqual({})
  })

  it('preserves all item properties', () => {
    const items = [
      { $id: 'user-1', name: 'Alice', email: 'alice@example.com', age: 30 },
    ]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
    })

    expect(response.data[0]).toEqual(items[0])
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

    expect(response.api.$context).toBe('https://api.example.com/tenant')
    expect(response.api.$type).toBe('users')
    expect(response.api.$id).toBe('user-1')
    expect(response.data).toEqual(item)
  })

  it('adds self and collection links', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links).toBeDefined()
    expect(response.links.self).toBe('/users/user-1')
    expect(response.links.collection).toBe('/users/')
    expect(response.links.home).toBe('/')
  })

  it('includes update and delete actions', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.actions).toBeDefined()
    expect(response.actions!.update).toEqual({ method: 'PUT', href: './' })
    expect(response.actions!.delete).toEqual({ method: 'DELETE', href: './' })
  })

  it('generates verb actions when verbs provided', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
      verbs: ['archive', 'notify'],
    })

    expect(response.actions).toBeDefined()
    expect(response.actions!.archive).toEqual({ method: 'POST', href: './archive' })
    expect(response.actions!.notify).toEqual({ method: 'POST', href: './notify' })
  })

  it('includes relationships when provided', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
      relationships: {
        posts: '/users/user-1/posts',
        comments: '/users/user-1/comments',
      },
    })

    expect(response.relationships).toEqual({
      posts: '/users/user-1/posts',
      comments: '/users/user-1/comments',
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

    expect(response.data).toEqual(item)
  })

  it('handles empty item object', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com/tenant',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.api.$id).toBe('user-1')
    expect(response.api.$type).toBe('users')
    expect(response.data).toEqual({})
  })
})

// =============================================================================
// Validation Tests
// =============================================================================

describe('HATEOAS Validation', () => {
  it('createCollectionResponse throws for invalid $context', () => {
    expect(() => {
      createCollectionResponse([], {
        $context: 'not-valid',
        $type: 'users',
      })
    }).toThrow('$context must be a valid URL')
  })

  it('createInstanceResponse throws for empty $context', () => {
    expect(() => {
      createInstanceResponse({}, {
        $context: '',
        $type: 'users',
        $id: 'user-1',
      })
    }).toThrow('$context is required')
  })
})

// =============================================================================
// Link Structure Tests
// =============================================================================

describe('HATEOAS Link Structure', () => {
  it('root response self link is /', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com',
      name: 'API',
      version: '1.0.0',
    })

    expect(response.links.self).toBe('/')
  })

  it('collection response self link ends with /', () => {
    const response = createCollectionResponse([{ $id: '1' }], {
      $context: 'https://api.example.com',
      $type: 'users',
    })

    expect(response.links.self).toBe('/users/')
  })

  it('instance response self link does not end with /', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links.self).toBe('/users/user-1')
    expect(response.links.self).not.toMatch(/\/$/)
  })

  it('instance collection link ends with /', () => {
    const response = createInstanceResponse({}, {
      $context: 'https://api.example.com',
      $type: 'users',
      $id: 'user-1',
    })

    expect(response.links.collection).toBe('/users/')
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('root response has correct structure types', () => {
    const response = createRootResponse({
      $context: 'https://api.example.com',
      name: 'API',
      version: '1.0.0',
    })

    // Type checks
    expect(typeof response.api.$context).toBe('string')
    expect(typeof response.api.name).toBe('string')
    expect(typeof response.api.version).toBe('string')
    expect(typeof response.links).toBe('object')
    expect(response.data).toBeNull()
  })

  it('collection response items are properly typed', () => {
    type User = { $id: string; name: string }
    const items: User[] = [{ $id: '1', name: 'Alice' }]

    const response = createCollectionResponse(items, {
      $context: 'https://api.example.com',
      $type: 'users',
    })

    expect(Array.isArray(response.data)).toBe(true)
    expect(response.data.length).toBe(1)
    expect(response.data[0].$id).toBe('1')
    expect(response.data[0].name).toBe('Alice')
  })

  it('instance response preserves item properties', () => {
    const item = { customField: 'value', numericField: 42 }

    const response = createInstanceResponse(item, {
      $context: 'https://api.example.com',
      $type: 'items',
      $id: 'item-1',
    })

    expect(response.data.customField).toBe('value')
    expect(response.data.numericField).toBe(42)
  })
})

// =============================================================================
// Link Generation Tests
// =============================================================================

describe('Link Generation', () => {
  describe('Absolute vs Relative Links', () => {
    it('generates relative links for navigation within API', () => {
      const response = createInstanceResponse({ name: 'Test' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
        $id: 'user-1',
      })

      // All navigation links should be relative
      expect(response.links.self).toBe('/users/user-1')
      expect(response.links.collection).toBe('/users/')
      expect(response.links.home).toBe('/')
    })

    it('action hrefs use relative paths', () => {
      const response = createInstanceResponse({ name: 'Test' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
        $id: 'user-1',
        verbs: ['activate', 'deactivate'],
      })

      expect(response.actions!.update.href).toBe('./')
      expect(response.actions!.delete.href).toBe('./')
      expect(response.actions!.activate.href).toBe('./activate')
      expect(response.actions!.deactivate.href).toBe('./deactivate')
    })

    it('collection action hrefs are relative to collection', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'products',
      })

      expect(response.actions!.create.href).toBe('./')
      expect(response.actions!.search.href).toBe('./?q={query}')
    })
  })

  describe('Link Path Construction', () => {
    it('constructs correct paths for nested resources', () => {
      const response = createInstanceResponse({ title: 'Post' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'posts',
        $id: 'post-123',
        relationships: {
          comments: '/posts/post-123/comments/',
          author: '/posts/post-123/author',
          likes: '/posts/post-123/likes/',
        },
      })

      expect(response.relationships!.comments).toBe('/posts/post-123/comments/')
      expect(response.relationships!.author).toBe('/posts/post-123/author')
      expect(response.relationships!.likes).toBe('/posts/post-123/likes/')
    })

    it('handles special characters in IDs', () => {
      const response = createInstanceResponse({ name: 'Special' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'items',
        $id: 'item-with.dots_and-dashes',
      })

      expect(response.links.self).toBe('/items/item-with.dots_and-dashes')
      expect(response.api.$id).toBe('item-with.dots_and-dashes')
    })

    it('handles numeric IDs', () => {
      const response = createInstanceResponse({ name: 'Numeric' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'orders',
        $id: '12345',
      })

      expect(response.links.self).toBe('/orders/12345')
    })

    it('handles UUID IDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const response = createInstanceResponse({ name: 'UUID' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'sessions',
        $id: uuid,
      })

      expect(response.links.self).toBe(`/sessions/${uuid}`)
    })
  })

  describe('Discover Link Generation', () => {
    it('generates discover links for all items in collection', () => {
      const items = [
        { $id: 'item-1', name: 'First' },
        { $id: 'item-2', name: 'Second' },
        { $id: 'item-3', name: 'Third' },
      ]

      const response = createCollectionResponse(items, {
        $context: 'https://api.example.com/tenant',
        $type: 'items',
      })

      expect(Object.keys(response.discover!)).toHaveLength(3)
      expect(response.discover!['item-1']).toBe('/items/item-1')
      expect(response.discover!['item-2']).toBe('/items/item-2')
      expect(response.discover!['item-3']).toBe('/items/item-3')
    })

    it('skips items without $id in discover section', () => {
      const items = [
        { $id: 'item-1', name: 'First' },
        { name: 'No ID' }, // Missing $id
        { $id: 'item-3', name: 'Third' },
      ]

      const response = createCollectionResponse(items as Array<{ $id?: string }>, {
        $context: 'https://api.example.com/tenant',
        $type: 'items',
      })

      expect(Object.keys(response.discover!)).toHaveLength(2)
      expect(response.discover!['item-1']).toBeDefined()
      expect(response.discover!['item-3']).toBeDefined()
    })

    it('root discover section includes all built-in collections', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'API',
        version: '1.0.0',
      })

      const expectedCollections = [
        'things',
        'actions',
        'events',
        'functions',
        'workflows',
        'agents',
        'site',
        'app',
        'docs',
      ]

      expectedCollections.forEach((collection) => {
        expect(response.discover![collection]).toBe(`/${collection}/`)
      })
    })
  })
})

// =============================================================================
// Resource Navigation Tests
// =============================================================================

describe('Resource Navigation', () => {
  describe('Collection to Instance Navigation', () => {
    it('collection discover section provides links to each instance', () => {
      const items = [
        { $id: 'user-alice', name: 'Alice' },
        { $id: 'user-bob', name: 'Bob' },
      ]

      const response = createCollectionResponse(items, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
      })

      // Each item in discover should point to its instance endpoint
      expect(response.discover!['user-alice']).toBe('/users/user-alice')
      expect(response.discover!['user-bob']).toBe('/users/user-bob')
    })

    it('instance has back-reference to collection', () => {
      const response = createInstanceResponse({ name: 'Alice' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
        $id: 'user-alice',
      })

      expect(response.links.collection).toBe('/users/')
    })
  })

  describe('Instance to Related Resources Navigation', () => {
    it('relationships provide links to related collections', () => {
      const response = createInstanceResponse({ name: 'Alice' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
        $id: 'user-alice',
        relationships: {
          posts: '/users/user-alice/posts/',
          followers: '/users/user-alice/followers/',
          following: '/users/user-alice/following/',
        },
      })

      expect(response.relationships).toBeDefined()
      expect(response.relationships!.posts).toBe('/users/user-alice/posts/')
      expect(response.relationships!.followers).toBe('/users/user-alice/followers/')
      expect(response.relationships!.following).toBe('/users/user-alice/following/')
    })

    it('relationships can point to single resources', () => {
      const response = createInstanceResponse({ title: 'My Post' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'posts',
        $id: 'post-123',
        relationships: {
          author: '/users/user-alice',
          category: '/categories/tech',
        },
      })

      expect(response.relationships!.author).toBe('/users/user-alice')
      expect(response.relationships!.category).toBe('/categories/tech')
    })
  })

  describe('Root to Collection Navigation', () => {
    it('root collections section provides links to all noun collections', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'API',
        version: '1.0.0',
        nouns: ['users', 'posts', 'comments', 'tags'],
      })

      expect(response.collections!.users).toBe('/users/')
      expect(response.collections!.posts).toBe('/posts/')
      expect(response.collections!.comments).toBe('/comments/')
      expect(response.collections!.tags).toBe('/tags/')
    })

    it('root schema section provides links to schema tables', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'API',
        version: '1.0.0',
        schemaTables: ['user', 'session', 'account', 'verification'],
      })

      expect(response.schema!.user).toBe('/user/')
      expect(response.schema!.session).toBe('/session/')
      expect(response.schema!.account).toBe('/account/')
      expect(response.schema!.verification).toBe('/verification/')
    })
  })

  describe('Home Navigation', () => {
    it('all response types include home link', () => {
      const rootResponse = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
      })

      const collectionResponse = createCollectionResponse([], {
        $context: 'https://api.example.com',
        $type: 'users',
      })

      const instanceResponse = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'users',
        $id: 'user-1',
      })

      expect(rootResponse.links.home).toBe('/')
      expect(collectionResponse.links.home).toBe('/')
      expect(instanceResponse.links.home).toBe('/')
    })
  })
})

// =============================================================================
// State Transition Tests
// =============================================================================

describe('State Transitions', () => {
  describe('CRUD Actions', () => {
    it('collection provides create action for new resources', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
      })

      expect(response.actions!.create).toEqual({
        method: 'POST',
        href: './',
        fields: ['name', 'data'],
      })
    })

    it('instance provides update action', () => {
      const response = createInstanceResponse({ name: 'Alice' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
        $id: 'user-1',
      })

      expect(response.actions!.update).toEqual({
        method: 'PUT',
        href: './',
      })
    })

    it('instance provides delete action', () => {
      const response = createInstanceResponse({ name: 'Alice' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
        $id: 'user-1',
      })

      expect(response.actions!.delete).toEqual({
        method: 'DELETE',
        href: './',
      })
    })
  })

  describe('Custom Verb Actions', () => {
    it('generates actions for custom verbs', () => {
      const response = createInstanceResponse({ name: 'Order' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'orders',
        $id: 'order-123',
        verbs: ['ship', 'cancel', 'refund'],
      })

      expect(response.actions!.ship).toEqual({ method: 'POST', href: './ship' })
      expect(response.actions!.cancel).toEqual({ method: 'POST', href: './cancel' })
      expect(response.actions!.refund).toEqual({ method: 'POST', href: './refund' })
    })

    it('verb actions are all POST methods', () => {
      const verbs = ['approve', 'reject', 'escalate', 'complete']
      const response = createInstanceResponse({ status: 'pending' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'tasks',
        $id: 'task-1',
        verbs,
      })

      verbs.forEach((verb) => {
        expect(response.actions![verb].method).toBe('POST')
      })
    })

    it('verbs with special characters are preserved', () => {
      const response = createInstanceResponse({ name: 'Test' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'items',
        $id: 'item-1',
        verbs: ['send-notification', 'mark_as_read', 'doSomething'],
      })

      expect(response.actions!['send-notification'].href).toBe('./send-notification')
      expect(response.actions!['mark_as_read'].href).toBe('./mark_as_read')
      expect(response.actions!['doSomething'].href).toBe('./doSomething')
    })
  })

  describe('Search Actions', () => {
    it('collection provides templated search action', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'products',
      })

      expect(response.actions!.search).toEqual({
        method: 'GET',
        href: './?q={query}',
        templated: true,
      })
    })

    it('search action is templated', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'articles',
      })

      expect(response.actions!.search.templated).toBe(true)
    })
  })

  describe('Protocol Actions', () => {
    it('root provides RPC action endpoint', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'API',
        version: '1.0.0',
      })

      expect(response.actions!.rpc).toEqual({
        method: 'POST',
        href: '/rpc',
      })
    })

    it('root provides MCP action endpoint', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'API',
        version: '1.0.0',
      })

      expect(response.actions!.mcp).toEqual({
        method: 'POST',
        href: '/mcp',
      })
    })

    it('root provides sync websocket action', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'API',
        version: '1.0.0',
      })

      expect(response.actions!.sync).toEqual({
        method: 'GET',
        href: '/sync',
        protocol: 'websocket',
      })
    })
  })
})

// =============================================================================
// Self-Describing API Tests
// =============================================================================

describe('Self-Describing APIs', () => {
  describe('API Metadata', () => {
    it('root response includes API name and version', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com/tenant',
        name: 'My Awesome API',
        version: '2.5.0',
      })

      expect(response.api.name).toBe('My Awesome API')
      expect(response.api.version).toBe('2.5.0')
    })

    it('$context provides namespace identity', () => {
      const response = createRootResponse({
        $context: 'https://tenant123.api.dotdo.dev',
        name: 'Tenant API',
        version: '1.0.0',
      })

      expect(response.api.$context).toBe('https://tenant123.api.dotdo.dev')
    })

    it('$type identifies the resource type', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'customers',
      })

      expect(response.api.$type).toBe('customers')
    })

    it('$id identifies the specific instance', () => {
      const response = createInstanceResponse({ name: 'Alice' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'customers',
        $id: 'cust-12345',
      })

      expect(response.api.$id).toBe('cust-12345')
    })
  })

  describe('Discoverable Endpoints', () => {
    it('root exposes all built-in collections', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
      })

      expect(response.discover).toHaveProperty('things')
      expect(response.discover).toHaveProperty('actions')
      expect(response.discover).toHaveProperty('events')
      expect(response.discover).toHaveProperty('functions')
      expect(response.discover).toHaveProperty('workflows')
      expect(response.discover).toHaveProperty('agents')
      expect(response.discover).toHaveProperty('site')
      expect(response.discover).toHaveProperty('app')
      expect(response.discover).toHaveProperty('docs')
    })

    it('root exposes registered noun collections', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
        nouns: ['Product', 'Order', 'Customer', 'Invoice'],
      })

      expect(response.collections).toBeDefined()
      expect(Object.keys(response.collections!)).toHaveLength(4)
      expect(response.collections).toHaveProperty('Product')
      expect(response.collections).toHaveProperty('Order')
      expect(response.collections).toHaveProperty('Customer')
      expect(response.collections).toHaveProperty('Invoice')
    })

    it('root exposes schema tables separately', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
        schemaTables: ['user', 'session', 'account'],
      })

      expect(response.schema).toBeDefined()
      expect(response.schema).not.toEqual(response.discover)
      expect(response.schema).not.toEqual(response.collections)
    })
  })

  describe('Available Verbs', () => {
    it('collection can declare available verbs', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'orders',
        verbs: ['create', 'list', 'search', 'bulkCreate', 'export'],
      })

      expect(response.verbs).toEqual(['create', 'list', 'search', 'bulkCreate', 'export'])
    })

    it('instance generates actions from verbs', () => {
      const response = createInstanceResponse({ status: 'pending' }, {
        $context: 'https://api.example.com/tenant',
        $type: 'orders',
        $id: 'order-123',
        verbs: ['confirm', 'ship', 'deliver', 'return'],
      })

      expect(response.actions!.confirm).toBeDefined()
      expect(response.actions!.ship).toBeDefined()
      expect(response.actions!.deliver).toBeDefined()
      expect(response.actions!.return).toBeDefined()
    })
  })

  describe('Action Descriptors', () => {
    it('create action includes fields hint', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'users',
      })

      expect(response.actions!.create.fields).toBeDefined()
      expect(Array.isArray(response.actions!.create.fields)).toBe(true)
    })

    it('search action is marked as templated', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com/tenant',
        $type: 'products',
      })

      expect(response.actions!.search.templated).toBe(true)
    })

    it('sync action specifies websocket protocol', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
      })

      expect(response.actions!.sync.protocol).toBe('websocket')
    })
  })

  describe('Response Structure Consistency', () => {
    it('all responses have api section', () => {
      const root = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
      })
      const collection = createCollectionResponse([], {
        $context: 'https://api.example.com',
        $type: 'items',
      })
      const instance = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(root.api).toBeDefined()
      expect(collection.api).toBeDefined()
      expect(instance.api).toBeDefined()
    })

    it('all responses have links section', () => {
      const root = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
      })
      const collection = createCollectionResponse([], {
        $context: 'https://api.example.com',
        $type: 'items',
      })
      const instance = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(root.links).toBeDefined()
      expect(collection.links).toBeDefined()
      expect(instance.links).toBeDefined()
    })

    it('all responses have data section', () => {
      const root = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
      })
      const collection = createCollectionResponse([{ $id: '1' }], {
        $context: 'https://api.example.com',
        $type: 'items',
      })
      const instance = createInstanceResponse({ name: 'Test' }, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(root).toHaveProperty('data')
      expect(collection).toHaveProperty('data')
      expect(instance).toHaveProperty('data')
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases', () => {
  describe('Empty Collections', () => {
    it('handles empty nouns array', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
        nouns: [],
      })

      expect(response.collections).toBeUndefined()
    })

    it('handles empty schemaTables array', () => {
      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
        schemaTables: [],
      })

      expect(response.schema).toBeUndefined()
    })

    it('handles empty items array in collection', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com',
        $type: 'items',
      })

      expect(response.data).toEqual([])
      expect(response.discover).toEqual({})
    })

    it('handles empty verbs array', () => {
      const response = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
        verbs: [],
      })

      // Should only have CRUD actions, no verb actions
      expect(response.actions!.update).toBeDefined()
      expect(response.actions!.delete).toBeDefined()
      // No extra verb actions beyond CRUD
      expect(Object.keys(response.actions!)).toHaveLength(2)
    })
  })

  describe('Large Data Sets', () => {
    it('handles collection with many items', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        $id: `item-${i}`,
        name: `Item ${i}`,
      }))

      const response = createCollectionResponse(items, {
        $context: 'https://api.example.com',
        $type: 'items',
      })

      expect(response.data).toHaveLength(100)
      expect(Object.keys(response.discover!)).toHaveLength(100)
    })

    it('handles collection with many nouns', () => {
      const nouns = Array.from({ length: 50 }, (_, i) => `noun${i}`)

      const response = createRootResponse({
        $context: 'https://api.example.com',
        name: 'API',
        version: '1.0.0',
        nouns,
      })

      expect(Object.keys(response.collections!)).toHaveLength(50)
    })

    it('handles instance with many verbs', () => {
      const verbs = Array.from({ length: 20 }, (_, i) => `action${i}`)

      const response = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
        verbs,
      })

      // 2 CRUD actions + 20 verb actions
      expect(Object.keys(response.actions!)).toHaveLength(22)
    })

    it('handles instance with many relationships', () => {
      const relationships: Record<string, string> = {}
      for (let i = 0; i < 15; i++) {
        relationships[`relation${i}`] = `/items/item-1/relation${i}/`
      }

      const response = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
        relationships,
      })

      expect(Object.keys(response.relationships!)).toHaveLength(15)
    })
  })

  describe('Special Values', () => {
    it('handles null data in instance', () => {
      const response = createInstanceResponse(null as unknown as object, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(response.data).toBeNull()
    })

    it('handles deeply nested data', () => {
      const deepData = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      }

      const response = createInstanceResponse(deepData, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(response.data).toEqual(deepData)
    })

    it('handles data with arrays', () => {
      const arrayData = {
        tags: ['tag1', 'tag2', 'tag3'],
        items: [{ id: 1 }, { id: 2 }],
        matrix: [[1, 2], [3, 4]],
      }

      const response = createInstanceResponse(arrayData, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(response.data).toEqual(arrayData)
    })

    it('preserves data types correctly', () => {
      const typedData = {
        string: 'text',
        number: 42,
        float: 3.14,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { key: 'value' },
      }

      const response = createInstanceResponse(typedData, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(response.data.string).toBe('text')
      expect(response.data.number).toBe(42)
      expect(response.data.float).toBe(3.14)
      expect(response.data.boolean).toBe(true)
      expect(response.data.null).toBeNull()
      expect(response.data.array).toEqual([1, 2, 3])
      expect(response.data.object).toEqual({ key: 'value' })
    })
  })

  describe('Unicode and Internationalization', () => {
    it('handles unicode in $type', () => {
      const response = createCollectionResponse([], {
        $context: 'https://api.example.com',
        $type: 'Benutzer', // German for 'users'
      })

      expect(response.api.$type).toBe('Benutzer')
      expect(response.links.self).toBe('/Benutzer/')
    })

    it('handles unicode in $id', () => {
      const response = createInstanceResponse({}, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-caf\u00e9', // cafe with accent
      })

      expect(response.api.$id).toBe('item-caf\u00e9')
    })

    it('handles unicode in data', () => {
      const unicodeData = {
        japanese: '\u3053\u3093\u306b\u3061\u306f',
        emoji: 'Hello World',
        arabic: '\u0645\u0631\u062d\u0628\u0627',
      }

      const response = createInstanceResponse(unicodeData, {
        $context: 'https://api.example.com',
        $type: 'items',
        $id: 'item-1',
      })

      expect(response.data).toEqual(unicodeData)
    })
  })
})

// =============================================================================
// Integration Tests - Complete API Navigation Flow
// =============================================================================

describe('Complete API Navigation Flow', () => {
  it('simulates discovery from root to instance', () => {
    // Step 1: Hit root to discover collections
    const rootResponse = createRootResponse({
      $context: 'https://api.example.com',
      name: 'My API',
      version: '1.0.0',
      nouns: ['users', 'posts'],
    })

    expect(rootResponse.collections!.users).toBe('/users/')
    expect(rootResponse.collections!.posts).toBe('/posts/')

    // Step 2: Navigate to users collection
    const usersCollection = createCollectionResponse(
      [
        { $id: 'user-1', name: 'Alice' },
        { $id: 'user-2', name: 'Bob' },
      ],
      {
        $context: 'https://api.example.com',
        $type: 'users',
        verbs: ['invite', 'suspend'],
      }
    )

    expect(usersCollection.links.self).toBe('/users/')
    expect(usersCollection.discover!['user-1']).toBe('/users/user-1')

    // Step 3: Navigate to specific user instance
    const userInstance = createInstanceResponse(
      { name: 'Alice', email: 'alice@example.com' },
      {
        $context: 'https://api.example.com',
        $type: 'users',
        $id: 'user-1',
        verbs: ['invite', 'suspend'],
        relationships: {
          posts: '/users/user-1/posts/',
        },
      }
    )

    expect(userInstance.links.self).toBe('/users/user-1')
    expect(userInstance.links.collection).toBe('/users/')
    expect(userInstance.actions!.invite.href).toBe('./invite')
    expect(userInstance.relationships!.posts).toBe('/users/user-1/posts/')
  })

  it('provides bidirectional navigation', () => {
    // From instance, can navigate back to collection
    const instance = createInstanceResponse({}, {
      $context: 'https://api.example.com',
      $type: 'items',
      $id: 'item-1',
    })

    expect(instance.links.collection).toBe('/items/')
    expect(instance.links.home).toBe('/')

    // From collection, can navigate to instances
    const collection = createCollectionResponse([{ $id: 'item-1' }], {
      $context: 'https://api.example.com',
      $type: 'items',
    })

    expect(collection.discover!['item-1']).toBe('/items/item-1')
    expect(collection.links.home).toBe('/')
  })

  it('supports workflow state machine transitions', () => {
    // Order in pending state
    const pendingOrder = createInstanceResponse(
      { status: 'pending', total: 100.00 },
      {
        $context: 'https://api.example.com',
        $type: 'orders',
        $id: 'order-123',
        verbs: ['confirm', 'cancel'],
      }
    )

    expect(pendingOrder.actions!.confirm).toBeDefined()
    expect(pendingOrder.actions!.cancel).toBeDefined()

    // Order in confirmed state
    const confirmedOrder = createInstanceResponse(
      { status: 'confirmed', total: 100.00 },
      {
        $context: 'https://api.example.com',
        $type: 'orders',
        $id: 'order-123',
        verbs: ['ship', 'cancel'],
      }
    )

    expect(confirmedOrder.actions!.ship).toBeDefined()
    expect(confirmedOrder.actions!.cancel).toBeDefined()
    expect(confirmedOrder.actions!.confirm).toBeUndefined()

    // Order in shipped state
    const shippedOrder = createInstanceResponse(
      { status: 'shipped', total: 100.00 },
      {
        $context: 'https://api.example.com',
        $type: 'orders',
        $id: 'order-123',
        verbs: ['deliver', 'return'],
      }
    )

    expect(shippedOrder.actions!.deliver).toBeDefined()
    expect(shippedOrder.actions!.return).toBeDefined()
    expect(shippedOrder.actions!.ship).toBeUndefined()
    expect(shippedOrder.actions!.cancel).toBeUndefined()
  })
})
