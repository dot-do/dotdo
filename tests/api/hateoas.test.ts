/**
 * RED Phase Tests for HATEOAS Response Wrapper
 *
 * These tests verify the apis.vin-style response wrapper for self-documenting,
 * clickable REST APIs. They are expected to FAIL until the implementation is complete.
 *
 * Related issues:
 * - dotdo-b5u1z: [RED] HATEOAS response wrapper tests
 * - dotdo-59eni: HATEOAS API Redesign: apis.vin-style clickable REST
 *
 * Implementation requirements:
 * - Create HATEOASResponse wrapper type
 * - Implement wrapResponse() function
 * - Auto-generate links from API structure
 * - Support discover, actions, and collections sections
 * - Include $context, $type, $id naming convention
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Types (Expected)
// ============================================================================

/**
 * API metadata section
 */
interface APIInfo {
  /** Name of the API or DO instance */
  name?: string
  /** API version */
  version?: string
  /** Fully qualified URL of the DO namespace */
  $context: string
  /** Collection name (simple string, NOT a URL) */
  $type?: string
  /** Instance identifier */
  $id?: string
}

/**
 * Action descriptor for mutating operations
 */
interface ActionDescriptor {
  /** HTTP method for this action */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Endpoint URL (relative or absolute) */
  href: string
  /** Form fields for POST/PUT actions */
  fields?: Array<{ name: string; type: string; required?: boolean }>
  /** Whether the URL is a template (e.g., has {query} placeholders) */
  templated?: boolean
  /** Protocol hint for non-HTTP actions */
  protocol?: 'websocket' | 'sse'
}

/**
 * User/request context
 */
interface UserContext {
  /** Whether the user is authenticated */
  authenticated: boolean
  /** User ID if authenticated */
  id?: string
  /** User email if authenticated */
  email?: string
  /** User roles/permissions */
  roles?: string[]
  /** Client IP address */
  ip?: string
  /** Request latency in ms */
  latency?: number
}

/**
 * Full HATEOAS response structure (apis.vin-style)
 */
interface HATEOASResponse<T = unknown> {
  /** API metadata */
  api: APIInfo
  /** Navigation links */
  links: Record<string, string>
  /** Discoverable endpoints (built-in collections, dynamic nouns, schema) */
  discover?: Record<string, string>
  /** Dynamic noun collections from registered $types */
  collections?: Record<string, string>
  /** Schema tables (better-auth, drizzle) */
  schema?: Record<string, string>
  /** Available actions on this resource */
  actions?: Record<string, ActionDescriptor>
  /** Relationship navigation (for instance responses) */
  relationships?: Record<string, string>
  /** Available verbs for this noun type */
  verbs?: string[]
  /** The actual response data */
  data: T
  /** User/request context */
  user?: UserContext
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let HATEOASResponseSchema: unknown
let wrapResponse: (<T>(data: T, options: WrapOptions) => HATEOASResponse<T>) | undefined
let createRootResponse: ((options: RootOptions) => HATEOASResponse<null>) | undefined
let createCollectionResponse: (<T>(items: T[], options: CollectionOptions) => HATEOASResponse<T[]>) | undefined
let createInstanceResponse: (<T>(item: T, options: InstanceOptions) => HATEOASResponse<T>) | undefined

interface WrapOptions {
  $context: string
  $type?: string
  $id?: string
  request?: Request
}

interface RootOptions {
  $context: string
  name?: string
  version?: string
  nouns?: string[]
  schemaTables?: string[]
  request?: Request
}

interface CollectionOptions {
  $context: string
  $type: string
  verbs?: string[]
  request?: Request
}

interface InstanceOptions {
  $context: string
  $type: string
  $id: string
  verbs?: string[]
  relationships?: Record<string, string>
  request?: Request
}

// Try to import - will be undefined until implemented
try {
  // @ts-expect-error - Module not yet implemented
  const module = await import('../../api/hateoas')
  HATEOASResponseSchema = module.HATEOASResponseSchema
  wrapResponse = module.wrapResponse
  createRootResponse = module.createRootResponse
  createCollectionResponse = module.createCollectionResponse
  createInstanceResponse = module.createInstanceResponse
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
  HATEOASResponseSchema = undefined
  wrapResponse = undefined
  createRootResponse = undefined
  createCollectionResponse = undefined
  createInstanceResponse = undefined
}

// ============================================================================
// 1. Module Export Tests
// ============================================================================

describe('HATEOAS Module Exports', () => {
  it('exports HATEOASResponseSchema', () => {
    expect(HATEOASResponseSchema).toBeDefined()
  })

  it('exports wrapResponse function', () => {
    expect(wrapResponse).toBeDefined()
    expect(typeof wrapResponse).toBe('function')
  })

  it('exports createRootResponse function', () => {
    expect(createRootResponse).toBeDefined()
    expect(typeof createRootResponse).toBe('function')
  })

  it('exports createCollectionResponse function', () => {
    expect(createCollectionResponse).toBeDefined()
    expect(typeof createCollectionResponse).toBe('function')
  })

  it('exports createInstanceResponse function', () => {
    expect(createInstanceResponse).toBeDefined()
    expect(typeof createInstanceResponse).toBe('function')
  })
})

// ============================================================================
// 2. HATEOASResponse Basic Structure Tests
// ============================================================================

describe('HATEOASResponse', () => {
  it('wraps data with api, links, discover, actions sections', () => {
    const data = { name: 'Test Item' }
    const response = wrapResponse!(data, {
      $context: 'https://startups.studio',
    })

    expect(response).toHaveProperty('api')
    expect(response).toHaveProperty('links')
    expect(response).toHaveProperty('data')
    expect(response.data).toEqual(data)
  })

  it('includes $context from DO namespace URL', () => {
    const response = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
    })

    expect(response.api.$context).toBe('https://startups.studio')
  })

  it('$type is simple string, not URL', () => {
    const response = wrapResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    // $type should be a simple string like "Startup", not a URL
    expect(response.api.$type).toBe('Startup')
    expect(response.api.$type).not.toContain('http')
    expect(response.api.$type).not.toContain('/')
  })

  it('$id is instance identifier only', () => {
    const response = wrapResponse!({ name: 'Headless.ly' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'headless.ly',
    })

    // $id should be just the identifier, not a path
    expect(response.api.$id).toBe('headless.ly')
    expect(response.api.$id).not.toContain('/')
  })

  it('includes self link in links section', () => {
    const response = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
    })

    expect(response.links).toHaveProperty('self')
  })

  it('includes home link in links section', () => {
    const response = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
    })

    expect(response.links).toHaveProperty('home')
  })
})

// ============================================================================
// 3. Root Response Tests (GET /)
// ============================================================================

describe('Root Response', () => {
  it('creates root response with api metadata', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
      name: 'startups.studio',
      version: '1.0.0',
    })

    expect(response.api.name).toBe('startups.studio')
    expect(response.api.version).toBe('1.0.0')
    expect(response.api.$context).toBe('https://startups.studio')
  })

  it('includes all built-in collections in discover section', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    expect(response.discover).toBeDefined()
    // Built-in collections that should always be present
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

  it('built-in collection links are relative paths', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    expect(response.discover!.things).toBe('/things/')
    expect(response.discover!.events).toBe('/events/')
    expect(response.discover!.agents).toBe('/agents/')
  })

  it('includes dynamic Noun collections from registered $types', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
      nouns: ['Startup', 'Investor', 'Pitch'],
    })

    expect(response.collections).toBeDefined()
    expect(response.collections).toHaveProperty('Startup')
    expect(response.collections).toHaveProperty('Investor')
    expect(response.collections).toHaveProperty('Pitch')
  })

  it('noun collection links use proper path format', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
      nouns: ['Startup', 'Investor'],
    })

    expect(response.collections!.Startup).toBe('/Startup/')
    expect(response.collections!.Investor).toBe('/Investor/')
  })

  it('includes schema tables from better-auth', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
      schemaTables: ['users', 'sessions', 'accounts'],
    })

    expect(response.schema).toBeDefined()
    expect(response.schema).toHaveProperty('users')
    expect(response.schema).toHaveProperty('sessions')
    expect(response.schema).toHaveProperty('accounts')
  })

  it('schema table links use proper path format', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
      schemaTables: ['users', 'sessions'],
    })

    expect(response.schema!.users).toBe('/users/')
    expect(response.schema!.sessions).toBe('/sessions/')
  })

  it('includes available HTTP actions', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    expect(response.actions).toBeDefined()
    expect(response.actions).toHaveProperty('rpc')
    expect(response.actions!.rpc).toEqual({
      method: 'POST',
      href: '/rpc',
    })
  })

  it('includes MCP endpoint action', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    expect(response.actions).toHaveProperty('mcp')
    expect(response.actions!.mcp).toEqual({
      method: 'POST',
      href: '/mcp',
    })
  })

  it('includes sync websocket action', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    expect(response.actions).toHaveProperty('sync')
    expect(response.actions!.sync).toEqual({
      method: 'GET',
      href: '/sync',
      protocol: 'websocket',
    })
  })

  it('data is null for root response', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    expect(response.data).toBeNull()
  })
})

// ============================================================================
// 4. Collection Response Tests (GET /:noun/)
// ============================================================================

describe('Collection Response', () => {
  it('creates collection response with proper api metadata', () => {
    const items = [
      { $id: 'headless.ly', name: 'Headless.ly' },
      { $id: 'agents.do', name: 'Agents.do' },
    ]

    const response = createCollectionResponse!(items, {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.api.$context).toBe('https://startups.studio')
    expect(response.api.$type).toBe('Startup')
  })

  it('includes self and home links', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.links.self).toBe('/Startup/')
    expect(response.links.home).toBe('/')
  })

  it('includes discover section with collection items', () => {
    const items = [
      { $id: 'headless.ly', name: 'Headless.ly' },
      { $id: 'agents.do', name: 'Agents.do' },
      { $id: 'workers.do', name: 'Workers.do' },
    ]

    const response = createCollectionResponse!(items, {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.discover).toBeDefined()
    expect(response.discover!['headless.ly']).toBe('/Startup/headless.ly')
    expect(response.discover!['agents.do']).toBe('/Startup/agents.do')
    expect(response.discover!['workers.do']).toBe('/Startup/workers.do')
  })

  it('includes create action for collections', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.actions).toHaveProperty('create')
    expect(response.actions!.create).toEqual({
      method: 'POST',
      href: './',
      fields: expect.any(Array),
    })
  })

  it('includes templated search action', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.actions).toHaveProperty('search')
    expect(response.actions!.search).toMatchObject({
      method: 'GET',
      href: './?q={query}',
      templated: true,
    })
  })

  it('includes verbs available for this noun', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://startups.studio',
      $type: 'Startup',
      verbs: ['pitch', 'fund', 'launch', 'pivot'],
    })

    expect(response.verbs).toBeDefined()
    expect(response.verbs).toEqual(['pitch', 'fund', 'launch', 'pivot'])
  })

  it('data contains the collection items', () => {
    const items = [
      { $id: 'headless.ly', name: 'Headless.ly' },
      { $id: 'agents.do', name: 'Agents.do' },
    ]

    const response = createCollectionResponse!(items, {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.data).toEqual(items)
  })

  it('handles empty collection', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://startups.studio',
      $type: 'Startup',
    })

    expect(response.data).toEqual([])
    expect(response.discover).toEqual({})
  })
})

// ============================================================================
// 5. Instance Response Tests (GET /:noun/:id)
// ============================================================================

describe('Instance Response', () => {
  it('creates instance response with full api metadata', () => {
    const item = { name: 'Headless.ly', stage: 'seed' }

    const response = createInstanceResponse!(item, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'headless.ly',
    })

    expect(response.api.$context).toBe('https://startups.studio')
    expect(response.api.$type).toBe('Startup')
    expect(response.api.$id).toBe('headless.ly')
  })

  it('includes self, collection, and home links', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'test-startup',
    })

    expect(response.links.self).toBe('/Startup/test-startup')
    expect(response.links.collection).toBe('/Startup/')
    expect(response.links.home).toBe('/')
  })

  it('includes relationship navigation links', () => {
    const response = createInstanceResponse!({ name: 'Headless.ly' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'headless.ly',
      relationships: {
        founders: '/Startup/headless.ly/founders/',
        investors: '/Startup/headless.ly/investors/',
        pitches: '/Startup/headless.ly/pitches/',
      },
    })

    expect(response.relationships).toBeDefined()
    expect(response.relationships!.founders).toBe('/Startup/headless.ly/founders/')
    expect(response.relationships!.investors).toBe('/Startup/headless.ly/investors/')
    expect(response.relationships!.pitches).toBe('/Startup/headless.ly/pitches/')
  })

  it('includes CRUD actions for instance', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'test',
    })

    expect(response.actions).toHaveProperty('update')
    expect(response.actions!.update).toEqual({
      method: 'PUT',
      href: './',
    })

    expect(response.actions).toHaveProperty('delete')
    expect(response.actions!.delete).toEqual({
      method: 'DELETE',
      href: './',
    })
  })

  it('includes verb actions for this noun type', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'test',
      verbs: ['pitch', 'fund'],
    })

    expect(response.actions).toHaveProperty('pitch')
    expect(response.actions!.pitch).toEqual({
      method: 'POST',
      href: './pitch',
    })

    expect(response.actions).toHaveProperty('fund')
    expect(response.actions!.fund).toEqual({
      method: 'POST',
      href: './fund',
    })
  })

  it('data contains the instance data', () => {
    const item = {
      name: 'Headless.ly',
      stage: 'seed',
      founded: '2024-01-01',
    }

    const response = createInstanceResponse!(item, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'headless.ly',
    })

    expect(response.data).toEqual(item)
  })
})

// ============================================================================
// 6. Discover Section Tests
// ============================================================================

describe('discover section', () => {
  it('includes all built-in collections (things, actions, events, etc.)', () => {
    const response = createRootResponse!({
      $context: 'https://example.do',
    })

    const expectedBuiltins = [
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

    expectedBuiltins.forEach((collection) => {
      expect(response.discover).toHaveProperty(collection)
    })
  })

  it('includes dynamic Noun collections from registered $types', () => {
    const response = createRootResponse!({
      $context: 'https://crm.do',
      nouns: ['Customer', 'Order', 'Invoice', 'Product'],
    })

    expect(response.collections!.Customer).toBe('/Customer/')
    expect(response.collections!.Order).toBe('/Order/')
    expect(response.collections!.Invoice).toBe('/Invoice/')
    expect(response.collections!.Product).toBe('/Product/')
  })

  it('includes schema tables (users, sessions from better-auth)', () => {
    const response = createRootResponse!({
      $context: 'https://app.do',
      schemaTables: ['users', 'sessions', 'accounts', 'verifications'],
    })

    expect(response.schema!.users).toBe('/users/')
    expect(response.schema!.sessions).toBe('/sessions/')
    expect(response.schema!.accounts).toBe('/accounts/')
    expect(response.schema!.verifications).toBe('/verifications/')
  })

  it('keeps discover, collections, and schema sections separate', () => {
    const response = createRootResponse!({
      $context: 'https://example.do',
      nouns: ['Customer'],
      schemaTables: ['users'],
    })

    // Built-ins go in discover
    expect(response.discover!.things).toBeDefined()
    // Dynamic nouns go in collections
    expect(response.collections!.Customer).toBeDefined()
    // Schema tables go in schema
    expect(response.schema!.users).toBeDefined()

    // They should not cross-pollinate
    expect(response.discover!.Customer).toBeUndefined()
    expect(response.discover!.users).toBeUndefined()
  })
})

// ============================================================================
// 7. Actions Section Tests
// ============================================================================

describe('actions section', () => {
  it('includes available HTTP methods for resource', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://example.do',
      $type: 'Thing',
    })

    // Collections support POST (create) and GET (list/search)
    expect(response.actions!.create.method).toBe('POST')
    expect(response.actions!.search.method).toBe('GET')
  })

  it('includes verb actions for Nouns (e.g., Startup.pitch)', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'test',
      verbs: ['pitch', 'fund', 'launch', 'pivot'],
    })

    expect(response.actions!.pitch).toEqual({
      method: 'POST',
      href: './pitch',
    })
    expect(response.actions!.fund).toEqual({
      method: 'POST',
      href: './fund',
    })
    expect(response.actions!.launch).toEqual({
      method: 'POST',
      href: './launch',
    })
    expect(response.actions!.pivot).toEqual({
      method: 'POST',
      href: './pivot',
    })
  })

  it('includes templated search URLs', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://example.do',
      $type: 'Customer',
    })

    expect(response.actions!.search).toMatchObject({
      method: 'GET',
      href: './?q={query}',
      templated: true,
    })
  })

  it('actions have proper ActionDescriptor shape', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://example.do',
      $type: 'Thing',
    })

    const createAction = response.actions!.create
    expect(createAction).toHaveProperty('method')
    expect(createAction).toHaveProperty('href')
    expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(createAction.method)
  })

  it('POST actions include fields descriptor when applicable', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://example.do',
      $type: 'Customer',
    })

    const createAction = response.actions!.create
    expect(createAction.fields).toBeDefined()
    expect(Array.isArray(createAction.fields)).toBe(true)
  })
})

// ============================================================================
// 8. User Context Tests
// ============================================================================

describe('User Context', () => {
  it('includes user context when request has authentication', () => {
    const request = new Request('https://startups.studio/', {
      headers: {
        'Authorization': 'Bearer token123',
      },
    })

    const response = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
      request,
    })

    expect(response.user).toBeDefined()
  })

  it('includes client IP when available', () => {
    const request = new Request('https://startups.studio/', {
      headers: {
        'CF-Connecting-IP': '192.168.1.1',
      },
    })

    const response = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
      request,
    })

    expect(response.user?.ip).toBeDefined()
  })

  it('includes latency when measurable', () => {
    const response = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
    })

    // Latency should be included if timing is available
    if (response.user) {
      expect(typeof response.user.latency).toBe('number')
    }
  })

  it('authenticated field reflects auth state', () => {
    // Unauthenticated request
    const unauthRequest = new Request('https://startups.studio/')
    const unauthResponse = wrapResponse!({ test: true }, {
      $context: 'https://startups.studio',
      request: unauthRequest,
    })

    expect(unauthResponse.user?.authenticated).toBe(false)
  })
})

// ============================================================================
// 9. Edge Cases and Validation Tests
// ============================================================================

describe('Edge Cases and Validation', () => {
  it('handles empty $context gracefully', () => {
    expect(() => wrapResponse!({ test: true }, {
      $context: '',
    })).toThrow()
  })

  it('validates $context is a valid URL', () => {
    expect(() => wrapResponse!({ test: true }, {
      $context: 'not-a-url',
    })).toThrow()
  })

  it('handles special characters in $id', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://example.do',
      $type: 'Thing',
      $id: 'thing-with-special.chars_123',
    })

    expect(response.api.$id).toBe('thing-with-special.chars_123')
  })

  it('handles unicode in noun names', () => {
    const response = createCollectionResponse!([], {
      $context: 'https://example.do',
      $type: 'Kundenauftrag', // German for customer order
    })

    expect(response.api.$type).toBe('Kundenauftrag')
  })

  it('handles null data', () => {
    const response = wrapResponse!(null, {
      $context: 'https://example.do',
    })

    expect(response.data).toBeNull()
  })

  it('handles undefined data', () => {
    const response = wrapResponse!(undefined, {
      $context: 'https://example.do',
    })

    expect(response.data).toBeUndefined()
  })

  it('handles complex nested data', () => {
    const complexData = {
      startup: {
        name: 'Headless.ly',
        founders: [
          { name: 'Alice', role: 'CEO' },
          { name: 'Bob', role: 'CTO' },
        ],
        metrics: {
          mrr: 50000,
          customers: 100,
        },
      },
    }

    const response = wrapResponse!(complexData, {
      $context: 'https://startups.studio',
    })

    expect(response.data).toEqual(complexData)
  })

  it('preserves data types (dates, numbers, booleans)', () => {
    const typedData = {
      count: 42,
      active: true,
      created: '2024-01-01T00:00:00Z',
      price: 99.99,
    }

    const response = wrapResponse!(typedData, {
      $context: 'https://example.do',
    })

    expect(response.data.count).toBe(42)
    expect(response.data.active).toBe(true)
    expect(response.data.price).toBe(99.99)
  })
})

// ============================================================================
// 10. Integration Tests - Full Response Shape
// ============================================================================

describe('Full Response Shape Integration', () => {
  it('root response matches apis.vin-style structure', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
      name: 'startups.studio',
      version: '1.0.0',
      nouns: ['Startup', 'Investor', 'Pitch'],
      schemaTables: ['users', 'sessions', 'accounts'],
    })

    // Verify full structure
    expect(response).toMatchObject({
      api: {
        name: 'startups.studio',
        version: '1.0.0',
        $context: 'https://startups.studio',
      },
      links: {
        home: expect.any(String),
        self: expect.any(String),
      },
      discover: {
        things: '/things/',
        actions: '/actions/',
        events: '/events/',
        functions: '/functions/',
        workflows: '/workflows/',
        agents: '/agents/',
        site: '/site/',
        app: '/app/',
        docs: '/docs/',
      },
      collections: {
        Startup: '/Startup/',
        Investor: '/Investor/',
        Pitch: '/Pitch/',
      },
      schema: {
        users: '/users/',
        sessions: '/sessions/',
        accounts: '/accounts/',
      },
      actions: {
        rpc: { method: 'POST', href: '/rpc' },
        mcp: { method: 'POST', href: '/mcp' },
        sync: { method: 'GET', href: '/sync', protocol: 'websocket' },
      },
      data: null,
    })
  })

  it('collection response matches apis.vin-style structure', () => {
    const items = [
      { $id: 'headless.ly', name: 'Headless.ly' },
      { $id: 'agents.do', name: 'Agents.do' },
    ]

    const response = createCollectionResponse!(items, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      verbs: ['pitch', 'fund', 'launch', 'pivot'],
    })

    expect(response).toMatchObject({
      api: {
        $context: 'https://startups.studio',
        $type: 'Startup',
      },
      links: {
        self: '/Startup/',
        home: '/',
      },
      discover: {
        'headless.ly': '/Startup/headless.ly',
        'agents.do': '/Startup/agents.do',
      },
      actions: {
        create: { method: 'POST', href: './', fields: expect.any(Array) },
        search: { method: 'GET', href: './?q={query}', templated: true },
      },
      verbs: ['pitch', 'fund', 'launch', 'pivot'],
      data: items,
    })
  })

  it('instance response matches apis.vin-style structure', () => {
    const item = {
      name: 'Headless.ly',
      stage: 'seed',
      founded: '2024-01-01',
    }

    const response = createInstanceResponse!(item, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'headless.ly',
      verbs: ['pitch', 'fund'],
      relationships: {
        founders: '/Startup/headless.ly/founders/',
        investors: '/Startup/headless.ly/investors/',
      },
    })

    expect(response).toMatchObject({
      api: {
        $context: 'https://startups.studio',
        $type: 'Startup',
        $id: 'headless.ly',
      },
      links: {
        self: '/Startup/headless.ly',
        collection: '/Startup/',
        home: '/',
      },
      relationships: {
        founders: '/Startup/headless.ly/founders/',
        investors: '/Startup/headless.ly/investors/',
      },
      actions: {
        update: { method: 'PUT', href: './' },
        delete: { method: 'DELETE', href: './' },
        pitch: { method: 'POST', href: './pitch' },
        fund: { method: 'POST', href: './fund' },
      },
      data: item,
    })
  })
})

// ============================================================================
// 11. Named Agent Discovery Tests
// ============================================================================

describe('Named Agent Discovery', () => {
  it('agents collection includes named agents', () => {
    const response = createRootResponse!({
      $context: 'https://startups.studio',
    })

    // The /agents/ endpoint should be discoverable
    expect(response.discover!.agents).toBe('/agents/')
  })

  it('agent instances have proper structure', () => {
    const agentData = {
      name: 'priya',
      role: 'Product Manager',
      capabilities: ['specs', 'roadmaps', 'requirements'],
    }

    const response = createInstanceResponse!(agentData, {
      $context: 'https://startups.studio',
      $type: 'Agent',
      $id: 'priya',
      verbs: ['define', 'specify', 'prioritize'],
    })

    expect(response.api.$type).toBe('Agent')
    expect(response.api.$id).toBe('priya')
    expect(response.actions!.define).toBeDefined()
    expect(response.actions!.specify).toBeDefined()
  })
})

// ============================================================================
// 12. Verb Action Generation Tests
// ============================================================================

describe('Verb Action Generation', () => {
  it('generates POST actions for each verb', () => {
    const verbs = ['pitch', 'fund', 'launch', 'pivot', 'acquire']

    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'test',
      verbs,
    })

    verbs.forEach((verb) => {
      expect(response.actions![verb]).toEqual({
        method: 'POST',
        href: `./${verb}`,
      })
    })
  })

  it('verb actions are relative to instance', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'headless.ly',
      verbs: ['pitch'],
    })

    // The href should be relative (./verb) not absolute
    expect(response.actions!.pitch.href).toBe('./pitch')
    expect(response.actions!.pitch.href).not.toContain('headless.ly')
  })

  it('handles verbs with special naming', () => {
    const response = createInstanceResponse!({ name: 'Test' }, {
      $context: 'https://startups.studio',
      $type: 'Startup',
      $id: 'test',
      verbs: ['send-update', 'requestFunding', 'close_round'],
    })

    expect(response.actions!['send-update']).toBeDefined()
    expect(response.actions!['requestFunding']).toBeDefined()
    expect(response.actions!['close_round']).toBeDefined()
  })
})
