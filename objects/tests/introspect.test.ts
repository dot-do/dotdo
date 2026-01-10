/**
 * $introspect Endpoint Tests (RED Phase)
 *
 * These tests verify the $introspect RPC endpoint that auto-discovers
 * DO classes, stores, and storage capabilities, filtered by user role.
 *
 * Features tested:
 * 1. DOSchema type structure
 * 2. $introspect RPC handler
 * 3. Role-based filtering (public/user/admin/system see different things)
 * 4. Classes, stores, storage capabilities in response
 * 5. Integration with existing auth context
 *
 * Reference: docs/plans/2026-01-10-do-dashboard-design.md
 *
 * @see {@link DOSchema} for the introspection response type
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import type { AuthContext } from '../transport/auth-layer'

// ============================================================================
// TYPE DEFINITIONS (from design doc)
// ============================================================================

/**
 * DOSchema - The response type for $introspect
 * This is the expected shape from the design doc.
 */
interface DOSchema {
  ns: string

  /** Caller's effective permissions */
  permissions: {
    role: 'public' | 'user' | 'admin' | 'system'
    scopes: string[]
  }

  /** Available DO classes (filtered by role) */
  classes: DOClassSchema[]

  /** Registered Nouns */
  nouns: NounSchema[]

  /** Registered Verbs */
  verbs: VerbSchema[]

  /** Available stores */
  stores: StoreSchema[]

  /** Storage capabilities */
  storage: {
    fsx: boolean
    gitx: boolean
    bashx: boolean
    r2: { enabled: boolean; buckets?: string[] }
    sql: { enabled: boolean; tables?: string[] }
    iceberg: boolean
    edgevec: boolean
  }
}

/**
 * DOClassSchema - Describes a Durable Object class
 */
interface DOClassSchema {
  name: string
  type: 'thing' | 'collection'
  pattern: string // /:type/:id or /:id
  visibility: 'public' | 'user' | 'admin' | 'system'
  tools: MCPToolSchema[]
  endpoints: RESTEndpointSchema[]
  properties: PropertySchema[]
  actions: ActionSchema[]
}

/**
 * MCP Tool schema from static $mcp config
 */
interface MCPToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * REST endpoint schema from static $rest config
 */
interface RESTEndpointSchema {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description?: string
}

/**
 * Property schema for a DO class
 */
interface PropertySchema {
  name: string
  type: string
  required?: boolean
  description?: string
}

/**
 * Action schema for a DO class
 */
interface ActionSchema {
  name: string
  description?: string
  visibility: 'public' | 'user' | 'admin' | 'system'
}

/**
 * Noun schema from the nouns table
 */
interface NounSchema {
  noun: string
  plural: string
  description?: string
  doClass?: string
}

/**
 * Verb schema from the verbs table
 */
interface VerbSchema {
  verb: string
  description?: string
  category?: string
}

/**
 * Store schema describing a data store
 */
interface StoreSchema {
  name: string
  type: 'things' | 'relationships' | 'actions' | 'events' | 'search' | 'objects' | 'dlq'
  visibility: 'public' | 'user' | 'admin' | 'system'
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean> => {
      if (Array.isArray(key)) {
        let deleted = false
        for (const k of key) {
          deleted = storage.delete(k) || deleted
        }
        return deleted
      }
      return storage.delete(key)
    }),
    list: vi.fn(async <T>(_options?: { prefix?: string }): Promise<Map<string, T>> => {
      return new Map() as Map<string, T>
    }),
    setAlarm: vi.fn(async (_time: number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockDOState() {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: {
      toString: () => 'test-do-id-12345',
      equals: (other: unknown) => other?.toString?.() === 'test-do-id-12345',
      name: 'test-do',
    },
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

/**
 * Create an auth context with the specified role
 */
function createAuthContext(role: 'public' | 'user' | 'admin' | 'system'): AuthContext {
  if (role === 'public') {
    return {
      authenticated: false,
    }
  }

  const roleScopes: Record<string, string[]> = {
    user: ['read', 'write'],
    admin: ['read', 'write', 'admin', 'storage'],
    system: ['read', 'write', 'admin', 'storage', 'system'],
  }

  return {
    authenticated: true,
    user: {
      id: `${role}-user-123`,
      email: `${role}@example.com`,
      name: role.charAt(0).toUpperCase() + role.slice(1),
      roles: [role],
      permissions: roleScopes[role] || [],
      organizationId: 'org-123',
    },
    token: {
      type: 'jwt',
      issuer: 'https://id.org.ai',
      audience: 'dotdo',
      expiresAt: new Date(Date.now() + 3600000),
    },
  }
}

/**
 * Create a test DO instance
 */
function createTestDO(): DO {
  const state = createMockDOState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all properties
  return new DO(state, env)
}

// ============================================================================
// TEST DO SUBCLASS WITH $mcp AND $rest CONFIGS
// ============================================================================

/**
 * Test DO class with introspection configuration
 */
class IntrospectableTestDO extends DO {
  static override readonly $type = 'IntrospectableTest'

  // MCP tools configuration
  static override $mcp = {
    tools: {
      search: {
        description: 'Search for things',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      adminOnly: {
        description: 'Admin-only operation',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
          },
        },
        visibility: 'admin',
      },
    },
    resources: ['things', 'events'],
  }

  // REST endpoints configuration
  static $rest = {
    endpoints: [
      { method: 'GET', path: '/things', description: 'List things' },
      { method: 'POST', path: '/things', description: 'Create thing' },
      { method: 'GET', path: '/admin/stats', description: 'Get stats', visibility: 'admin' },
    ],
  }

  // Auth configuration for methods
  static $auth = {
    '$introspect': { requireAuth: true },
    'publicMethod': { public: true },
    'userMethod': { requireAuth: true },
    'adminMethod': { roles: ['admin', 'system'] },
    'systemMethod': { roles: ['system'] },
  }
}

function createIntrospectableTestDO(): IntrospectableTestDO {
  const state = createMockDOState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all properties
  return new IntrospectableTestDO(state, env)
}

// ============================================================================
// DOSchema TYPE STRUCTURE TESTS
// ============================================================================

describe('DOSchema Type Structure', () => {
  it('should have ns (namespace) property', async () => {
    const doInstance = createIntrospectableTestDO()

    // The $introspect method should exist and return DOSchema
    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('ns')
    expect(typeof schema.ns).toBe('string')
  })

  it('should have permissions with role and scopes', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('permissions')
    expect(schema.permissions).toHaveProperty('role')
    expect(schema.permissions).toHaveProperty('scopes')
    expect(['public', 'user', 'admin', 'system']).toContain(schema.permissions.role)
    expect(Array.isArray(schema.permissions.scopes)).toBe(true)
  })

  it('should have classes array with DOClassSchema items', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('classes')
    expect(Array.isArray(schema.classes)).toBe(true)

    if (schema.classes.length > 0) {
      const classSchema = schema.classes[0]
      expect(classSchema).toHaveProperty('name')
      expect(classSchema).toHaveProperty('type')
      expect(classSchema).toHaveProperty('visibility')
      expect(['thing', 'collection']).toContain(classSchema.type)
    }
  })

  it('should have nouns array with NounSchema items', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('nouns')
    expect(Array.isArray(schema.nouns)).toBe(true)
  })

  it('should have verbs array with VerbSchema items', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('verbs')
    expect(Array.isArray(schema.verbs)).toBe(true)
  })

  it('should have stores array with StoreSchema items', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('stores')
    expect(Array.isArray(schema.stores)).toBe(true)
  })

  it('should have storage capabilities object', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect()

    expect(schema).toHaveProperty('storage')
    expect(schema.storage).toHaveProperty('fsx')
    expect(schema.storage).toHaveProperty('gitx')
    expect(schema.storage).toHaveProperty('bashx')
    expect(schema.storage).toHaveProperty('r2')
    expect(schema.storage).toHaveProperty('sql')
    expect(schema.storage).toHaveProperty('iceberg')
    expect(schema.storage).toHaveProperty('edgevec')
  })
})

// ============================================================================
// $introspect RPC HANDLER TESTS
// ============================================================================

describe('$introspect RPC Handler', () => {
  it('should be callable as an RPC method', async () => {
    const doInstance = createIntrospectableTestDO()

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    expect(typeof doInstance.$introspect).toBe('function')
  })

  it('should accept optional auth context parameter', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('user')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    expect(schema).toBeDefined()
    expect(schema.permissions.role).toBe('user')
  })

  it('should be exposed via /rpc endpoint', async () => {
    const doInstance = createIntrospectableTestDO()

    // Create JWT token for authentication
    const token = createTestJWT('admin')

    const request = new Request('https://example.com/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: '$introspect',
        params: {},
        id: 1,
      }),
    })

    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json() as { result?: DOSchema; error?: unknown }
    expect(body).toHaveProperty('result')
    expect(body.result).toHaveProperty('ns')
  })

  it('should return error for unauthenticated requests when auth is required', async () => {
    const doInstance = createIntrospectableTestDO()

    // Make request without auth token
    const request = new Request('https://example.com/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: '$introspect',
        params: {},
        id: 1,
      }),
    })

    const response = await doInstance.fetch(request)

    // Should fail auth check
    expect([401, 403]).toContain(response.status)
  })

  it('should return namespace from DO instance', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    expect(schema.ns).toBe(doInstance.ns)
  })

  it('should detect static $mcp config from class', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    // Should include the 'search' tool from static $mcp
    const hasSearchTool = schema.classes.some((c: DOClassSchema) =>
      c.tools.some((t) => t.name === 'search')
    )
    expect(hasSearchTool).toBe(true)
  })

  it('should detect static $rest config from class', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    // Should include the GET /things endpoint from static $rest
    const hasThingsEndpoint = schema.classes.some((c: DOClassSchema) =>
      c.endpoints.some((e) => e.path === '/things' && e.method === 'GET')
    )
    expect(hasThingsEndpoint).toBe(true)
  })
})

// ============================================================================
// ROLE-BASED FILTERING TESTS
// ============================================================================

describe('Role-Based Filtering', () => {
  describe('public role', () => {
    it('should only see public classes', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('public')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      expect(schema.permissions.role).toBe('public')

      // All visible classes should be public visibility
      schema.classes.forEach((c: DOClassSchema) => {
        expect(c.visibility).toBe('public')
      })
    })

    it('should not see any stores', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('public')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      // Public role should not see stores
      expect(schema.stores.length).toBe(0)
    })

    it('should not see storage capabilities', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('public')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      // Public role should see all storage as disabled
      expect(schema.storage.fsx).toBe(false)
      expect(schema.storage.gitx).toBe(false)
      expect(schema.storage.bashx).toBe(false)
      expect(schema.storage.r2.enabled).toBe(false)
      expect(schema.storage.sql.enabled).toBe(false)
    })
  })

  describe('user role', () => {
    it('should see public and user-level classes', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('user')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      expect(schema.permissions.role).toBe('user')

      // Should see public and user visibility classes
      schema.classes.forEach((c: DOClassSchema) => {
        expect(['public', 'user']).toContain(c.visibility)
      })
    })

    it('should see fsx and gitx storage', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('user')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      // Users can access fsx and gitx per the design doc
      expect(schema.storage.fsx).toBe(true)
      expect(schema.storage.gitx).toBe(true)
      // But not bashx, R2, or SQL
      expect(schema.storage.bashx).toBe(false)
      expect(schema.storage.r2.enabled).toBe(false)
      expect(schema.storage.sql.enabled).toBe(false)
    })

    it('should see things store but not dlq', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('user')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      const storeNames = schema.stores.map((s: StoreSchema) => s.name)
      expect(storeNames).toContain('things')
      expect(storeNames).not.toContain('dlq')
    })

    it('should not see admin-only tools', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('user')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      // Should not include adminOnly tool
      const allTools = schema.classes.flatMap((c: DOClassSchema) => c.tools)
      const hasAdminTool = allTools.some((t: MCPToolSchema) => t.name === 'adminOnly')
      expect(hasAdminTool).toBe(false)
    })
  })

  describe('admin role', () => {
    it('should see public, user, and admin-level classes', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('admin')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      expect(schema.permissions.role).toBe('admin')

      // Should see public, user, and admin visibility classes
      schema.classes.forEach((c: DOClassSchema) => {
        expect(['public', 'user', 'admin']).toContain(c.visibility)
      })
    })

    it('should see all storage including bashx, R2, and SQL', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('admin')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      expect(schema.storage.fsx).toBe(true)
      expect(schema.storage.gitx).toBe(true)
      expect(schema.storage.bashx).toBe(true)
      expect(schema.storage.r2.enabled).toBe(true)
      expect(schema.storage.sql.enabled).toBe(true)
    })

    it('should see admin-only tools', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('admin')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      // Should include adminOnly tool
      const allTools = schema.classes.flatMap((c: DOClassSchema) => c.tools)
      const hasAdminTool = allTools.some((t: MCPToolSchema) => t.name === 'adminOnly')
      expect(hasAdminTool).toBe(true)
    })

    it('should see actions and events stores', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('admin')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      const storeNames = schema.stores.map((s: StoreSchema) => s.name)
      expect(storeNames).toContain('actions')
      expect(storeNames).toContain('events')
    })

    it('should not see system-only stores like dlq', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('admin')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      const storeNames = schema.stores.map((s: StoreSchema) => s.name)
      expect(storeNames).not.toContain('dlq')
    })
  })

  describe('system role', () => {
    it('should see all classes including system-level', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('system')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      expect(schema.permissions.role).toBe('system')

      // System role should see everything
      const visibilities = schema.classes.map((c: DOClassSchema) => c.visibility)
      // Should include system-level if any exist
      expect(['public', 'user', 'admin', 'system']).toEqual(
        expect.arrayContaining([...new Set(visibilities)])
      )
    })

    it('should see all stores including dlq', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('system')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      const storeNames = schema.stores.map((s: StoreSchema) => s.name)
      expect(storeNames).toContain('things')
      expect(storeNames).toContain('actions')
      expect(storeNames).toContain('events')
      expect(storeNames).toContain('dlq')
      expect(storeNames).toContain('objects')
    })

    it('should see iceberg and edgevec storage', async () => {
      const doInstance = createIntrospectableTestDO()
      const authContext = createAuthContext('system')

      // @ts-expect-error - Method doesn't exist yet (RED phase)
      const schema = await doInstance.$introspect(authContext)

      expect(schema.storage.iceberg).toBe(true)
      expect(schema.storage.edgevec).toBe(true)
    })
  })
})

// ============================================================================
// CLASSES, STORES, STORAGE CAPABILITIES TESTS
// ============================================================================

describe('Classes Discovery', () => {
  it('should include name from static $type', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    const classNames = schema.classes.map((c: DOClassSchema) => c.name)
    expect(classNames).toContain('IntrospectableTest')
  })

  it('should include tools from static $mcp', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    const testClass = schema.classes.find(
      (c: DOClassSchema) => c.name === 'IntrospectableTest'
    )
    expect(testClass).toBeDefined()
    expect(testClass!.tools.length).toBeGreaterThan(0)

    const searchTool = testClass!.tools.find((t: MCPToolSchema) => t.name === 'search')
    expect(searchTool).toBeDefined()
    expect(searchTool!.description).toBe('Search for things')
    expect(searchTool!.inputSchema).toHaveProperty('properties')
  })

  it('should include endpoints from static $rest', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    const testClass = schema.classes.find(
      (c: DOClassSchema) => c.name === 'IntrospectableTest'
    )
    expect(testClass).toBeDefined()
    expect(testClass!.endpoints.length).toBeGreaterThan(0)

    const getThings = testClass!.endpoints.find(
      (e: RESTEndpointSchema) => e.path === '/things' && e.method === 'GET'
    )
    expect(getThings).toBeDefined()
    expect(getThings!.description).toBe('List things')
  })

  it('should set correct type for Thing vs Collection classes', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    // Each class should have a valid type
    schema.classes.forEach((c: DOClassSchema) => {
      expect(['thing', 'collection']).toContain(c.type)
    })
  })

  it('should set correct URL pattern for classes', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    schema.classes.forEach((c: DOClassSchema) => {
      // Pattern should be like /:type/:id or /:id
      expect(c.pattern).toMatch(/^\/:[a-zA-Z]+/)
    })
  })
})

describe('Stores Discovery', () => {
  it('should include things store', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    const thingsStore = schema.stores.find((s: StoreSchema) => s.name === 'things')
    expect(thingsStore).toBeDefined()
    expect(thingsStore!.type).toBe('things')
  })

  it('should include relationships store', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    const relsStore = schema.stores.find((s: StoreSchema) => s.name === 'relationships')
    expect(relsStore).toBeDefined()
    expect(relsStore!.type).toBe('relationships')
  })

  it('should have correct visibility for each store', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('system')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    // Verify store visibility according to design doc
    const thingsStore = schema.stores.find((s: StoreSchema) => s.name === 'things')
    expect(thingsStore?.visibility).toBe('user')

    const actionsStore = schema.stores.find((s: StoreSchema) => s.name === 'actions')
    expect(actionsStore?.visibility).toBe('admin')

    const dlqStore = schema.stores.find((s: StoreSchema) => s.name === 'dlq')
    expect(dlqStore?.visibility).toBe('system')
  })
})

describe('Storage Capabilities', () => {
  it('should return R2 bucket list when enabled', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    if (schema.storage.r2.enabled) {
      expect(schema.storage.r2).toHaveProperty('buckets')
      expect(Array.isArray(schema.storage.r2.buckets)).toBe(true)
    }
  })

  it('should return SQL table list when enabled', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    if (schema.storage.sql.enabled) {
      expect(schema.storage.sql).toHaveProperty('tables')
      expect(Array.isArray(schema.storage.sql.tables)).toBe(true)
    }
  })

  it('should return boolean for fsx, gitx, bashx, iceberg, edgevec', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('system')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    expect(typeof schema.storage.fsx).toBe('boolean')
    expect(typeof schema.storage.gitx).toBe('boolean')
    expect(typeof schema.storage.bashx).toBe('boolean')
    expect(typeof schema.storage.iceberg).toBe('boolean')
    expect(typeof schema.storage.edgevec).toBe('boolean')
  })
})

// ============================================================================
// AUTH CONTEXT INTEGRATION TESTS
// ============================================================================

describe('Auth Context Integration', () => {
  it('should determine role from AuthContext', async () => {
    const doInstance = createIntrospectableTestDO()

    // Test with admin context
    const adminContext = createAuthContext('admin')
    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const adminSchema = await doInstance.$introspect(adminContext)
    expect(adminSchema.permissions.role).toBe('admin')

    // Test with user context
    const userContext = createAuthContext('user')
    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const userSchema = await doInstance.$introspect(userContext)
    expect(userSchema.permissions.role).toBe('user')
  })

  it('should extract scopes from AuthContext permissions', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    // Admin should have admin scope
    expect(schema.permissions.scopes).toContain('admin')
    expect(schema.permissions.scopes).toContain('read')
    expect(schema.permissions.scopes).toContain('write')
  })

  it('should handle AuthContext without roles array', async () => {
    const doInstance = createIntrospectableTestDO()

    // Context with no roles
    const minimalContext: AuthContext = {
      authenticated: true,
      user: {
        id: 'test-user',
        roles: [],
        permissions: ['read'],
      },
    }

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(minimalContext)

    // Should default to 'user' role for authenticated users without specific roles
    expect(schema.permissions.role).toBe('user')
  })

  it('should use public role for unauthenticated context', async () => {
    const doInstance = createIntrospectableTestDO()

    const publicContext: AuthContext = {
      authenticated: false,
    }

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(publicContext)

    expect(schema.permissions.role).toBe('public')
    expect(schema.permissions.scopes).toEqual([])
  })

  it('should prioritize system role over admin', async () => {
    const doInstance = createIntrospectableTestDO()

    const mixedRolesContext: AuthContext = {
      authenticated: true,
      user: {
        id: 'system-user',
        roles: ['admin', 'system', 'user'],
        permissions: ['read', 'write', 'admin', 'system'],
      },
    }

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(mixedRolesContext)

    // System role should take precedence
    expect(schema.permissions.role).toBe('system')
  })

  it('should prioritize admin role over user', async () => {
    const doInstance = createIntrospectableTestDO()

    const mixedRolesContext: AuthContext = {
      authenticated: true,
      user: {
        id: 'admin-user',
        roles: ['user', 'admin'],
        permissions: ['read', 'write', 'admin'],
      },
    }

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(mixedRolesContext)

    // Admin role should take precedence over user
    expect(schema.permissions.role).toBe('admin')
  })
})

// ============================================================================
// NOUNS AND VERBS DISCOVERY TESTS
// ============================================================================

describe('Nouns Discovery', () => {
  it('should return registered nouns from database', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    expect(Array.isArray(schema.nouns)).toBe(true)
    // In real implementation, this would query the nouns table
  })

  it('should include noun, plural, and description', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    if (schema.nouns.length > 0) {
      const noun = schema.nouns[0]
      expect(noun).toHaveProperty('noun')
      expect(noun).toHaveProperty('plural')
      expect(typeof noun.noun).toBe('string')
      expect(typeof noun.plural).toBe('string')
    }
  })

  it('should include doClass reference when available', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    // If any nouns have doClass, it should be a string
    schema.nouns.forEach((noun: NounSchema) => {
      if (noun.doClass !== undefined) {
        expect(typeof noun.doClass).toBe('string')
      }
    })
  })
})

describe('Verbs Discovery', () => {
  it('should return registered verbs from database', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    expect(Array.isArray(schema.verbs)).toBe(true)
  })

  it('should include verb and optional description', async () => {
    const doInstance = createIntrospectableTestDO()
    const authContext = createAuthContext('admin')

    // @ts-expect-error - Method doesn't exist yet (RED phase)
    const schema = await doInstance.$introspect(authContext)

    if (schema.verbs.length > 0) {
      const verb = schema.verbs[0]
      expect(verb).toHaveProperty('verb')
      expect(typeof verb.verb).toBe('string')
    }
  })
})

// ============================================================================
// HTTP ROUTE TESTS
// ============================================================================

describe('$introspect HTTP Route', () => {
  it('should respond to GET /$introspect', async () => {
    const doInstance = createIntrospectableTestDO()

    // Create a JWT token for authentication
    const token = createTestJWT('admin')

    const request = new Request('https://example.com/$introspect', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)
    const schema = await response.json() as DOSchema
    expect(schema).toHaveProperty('ns')
    expect(schema).toHaveProperty('permissions')
    expect(schema).toHaveProperty('classes')
  })

  it('should accept Authorization header for auth context', async () => {
    const doInstance = createIntrospectableTestDO()

    const token = createTestJWT('admin')

    const request = new Request('https://example.com/$introspect', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)
    const schema = await response.json() as DOSchema
    expect(schema.permissions.role).toBe('admin')
  })

  it('should return 401 without authentication', async () => {
    const doInstance = createIntrospectableTestDO()

    const request = new Request('https://example.com/$introspect', {
      method: 'GET',
    })

    const response = await doInstance.fetch(request)

    expect(response.status).toBe(401)
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a test JWT token with the specified role
 */
function createTestJWT(role: 'public' | 'user' | 'admin' | 'system'): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const payload = {
    sub: `${role}-user-123`,
    email: `${role}@example.com`,
    name: role.charAt(0).toUpperCase() + role.slice(1),
    roles: [role],
    permissions: role === 'public' ? [] : ['read', 'write'],
    iss: 'https://id.org.ai',
    aud: 'dotdo',
    iat: now,
    exp: now + 3600,
  }

  // For testing, we use a simple base64 encoding
  // In production, this would be properly signed
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  // Mock signature (in tests, signature validation may be skipped)
  const signature = 'test-signature'

  return `${encodedHeader}.${encodedPayload}.${signature}`
}
