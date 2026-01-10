/**
 * $ Proxy Tests (RED Phase)
 *
 * Tests for the unified $ proxy that provides schema access.
 * The $ proxy replaces $introspect as the primary way to access DO schema.
 *
 * Design: $ IS the schema, accessed via Proxy
 * - $                 → DOSchema
 * - $.classes         → DOClassSchema[]
 * - $.Users           → Class proxy for Users DO
 * - $.Users('id')     → Get specific instance
 * - $.Users.where({}) → Query builder
 * - $.fsx             → Filesystem client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DOSchema, DOClassSchema, StorageCapabilities } from '../../../../types/introspect'
import {
  createDOProxy,
  __setMockFetch,
  __setMockRPC,
  __setMockStorage,
  __clearCache,
  type DOSchemaProxy,
} from '../index'

// ============================================================================
// MOCK SCHEMA FOR TESTING
// ============================================================================

const mockSchema: DOSchema = {
  ns: 'test.example.com',
  permissions: {
    role: 'admin',
    scopes: ['read', 'write', 'admin'],
  },
  classes: [
    {
      name: 'Users',
      type: 'collection',
      pattern: '/users/:id',
      visibility: 'user',
      tools: [],
      endpoints: [
        { method: 'GET', path: '/users', description: 'List users' },
        { method: 'GET', path: '/users/:id', description: 'Get user' },
        { method: 'POST', path: '/users', description: 'Create user' },
      ],
      properties: [
        { name: 'id', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
        { name: 'role', type: "'user' | 'admin'", required: true },
      ],
      actions: [
        { name: 'activate', visibility: 'admin' },
        { name: 'deactivate', visibility: 'admin' },
      ],
    },
    {
      name: 'Customers',
      type: 'collection',
      pattern: '/customers/:id',
      visibility: 'user',
      tools: [],
      endpoints: [],
      properties: [],
      actions: [],
    },
  ],
  nouns: [
    { noun: 'User', plural: 'Users', doClass: 'Users' },
    { noun: 'Customer', plural: 'Customers', doClass: 'Customers' },
  ],
  verbs: [
    { verb: 'create', category: 'crud' },
    { verb: 'update', category: 'crud' },
  ],
  stores: [
    { name: 'things', type: 'things', visibility: 'user' },
    { name: 'relationships', type: 'relationships', visibility: 'user' },
    { name: 'events', type: 'events', visibility: 'admin' },
  ],
  storage: {
    fsx: true,
    gitx: true,
    bashx: false, // Disabled for non-admin
    r2: { enabled: true, buckets: ['uploads'] },
    sql: { enabled: true, tables: ['users', 'customers'] },
    iceberg: false,
    edgevec: false,
  },
}

// ============================================================================
// createDOProxy() FACTORY TESTS
// ============================================================================

describe('createDOProxy()', () => {
  beforeEach(() => {
    __clearCache()
  })

  it('should be a function', () => {
    expect(typeof createDOProxy).toBe('function')
  })

  it('should return a proxy object', async () => {
    __setMockFetch(vi.fn().mockResolvedValue(mockSchema))
    const $ = await createDOProxy('test.example.com', 'test-token')

    expect($).toBeDefined()
    // Proxy over function returns 'function' for typeof, but behaves like object
    expect(typeof $).toBe('function')
  })

  it('should fetch schema on creation', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockSchema)
    __setMockFetch(mockFetch)

    await createDOProxy('test.example.com', 'test-token')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('test.example.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })

  it('should cache schema for subsequent accesses', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockSchema)
    __setMockFetch(mockFetch)

    const $ = await createDOProxy('test.example.com', 'test-token')

    // Access multiple properties
    void $.ns
    void $.classes
    void $.stores

    // Should only fetch once
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('should support cache: false option to bypass cache', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockSchema)
    __setMockFetch(mockFetch)

    await createDOProxy('test.example.com', 'test-token')
    await createDOProxy('test.example.com', 'test-token', { cache: false })

    // Should fetch twice when cache disabled
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ============================================================================
// SCHEMA PROPERTY ACCESS TESTS
// ============================================================================

describe('Schema Property Access', () => {
  let $: DOSchemaProxy

  beforeEach(async () => {
    __clearCache()
    __setMockFetch(vi.fn().mockResolvedValue(mockSchema))
    $ = await createDOProxy('test.example.com', 'test-token')
  })

  it('$.schema should return the full DOSchema', () => {
    expect($.schema).toEqual(mockSchema)
  })

  it('$.ns should return namespace string', () => {
    expect($.ns).toBe('test.example.com')
  })

  it('$.permissions should return role and scopes', () => {
    expect($.permissions).toEqual({
      role: 'admin',
      scopes: ['read', 'write', 'admin'],
    })
  })

  it('$.classes should return array of DOClassSchema', () => {
    const classes = $.classes
    expect(Array.isArray(classes)).toBe(true)
    expect(classes.length).toBe(2)
    expect(classes[0].name).toBe('Users')
    expect(classes[1].name).toBe('Customers')
  })

  it('$.stores should return array of StoreSchema', () => {
    const stores = $.stores
    expect(Array.isArray(stores)).toBe(true)
    expect(stores.length).toBe(3)
    expect(stores.map((s) => s.name)).toContain('things')
  })

  it('$.storage should return StorageCapabilities', () => {
    const storage = $.storage
    expect(storage.fsx).toBe(true)
    expect(storage.gitx).toBe(true)
    expect(storage.bashx).toBe(false)
    expect(storage.r2.enabled).toBe(true)
  })

  it('$.nouns should return array of NounSchema', () => {
    const nouns = $.nouns
    expect(Array.isArray(nouns)).toBe(true)
    expect(nouns.length).toBe(2)
    expect(nouns[0].noun).toBe('User')
  })

  it('$.verbs should return array of VerbSchema', () => {
    const verbs = $.verbs
    expect(Array.isArray(verbs)).toBe(true)
    expect(verbs.length).toBe(2)
    expect(verbs[0].verb).toBe('create')
  })
})

// ============================================================================
// DO CLASS ACCESS TESTS
// ============================================================================

describe('DO Class Access', () => {
  let $: DOSchemaProxy

  beforeEach(async () => {
    __clearCache()
    __setMockFetch(vi.fn().mockResolvedValue(mockSchema))
    __setMockRPC(
      vi.fn().mockImplementation(async (method: string, args: unknown[]) => {
        if (method === 'list') return [{ id: 'usr-1', email: 'alice@test.com', role: 'admin' }]
        if (method === 'get') return { id: args[0], email: 'alice@test.com', role: 'admin' }
        if (method === 'where') return [{ id: 'usr-1', email: 'alice@test.com', role: 'admin' }]
        if (method === 'count') return 1
        if (method === 'create') return { id: 'usr-new', ...(args[0] as object) }
        return null
      })
    )
    $ = await createDOProxy('test.example.com', 'test-token')
  })

  it('$.Users should return a class proxy (function)', () => {
    const Users = $.Users
    expect(typeof Users).toBe('function')
  })

  it('$.NonExistent should return undefined for unknown classes', () => {
    const Unknown = ($ as Record<string, unknown>).NonExistent
    expect(Unknown).toBeUndefined()
  })

  it('await $.Users() should list all instances', async () => {
    const Users = $.Users as () => Promise<unknown[]>
    const users = await Users()

    expect(Array.isArray(users)).toBe(true)
    expect(users.length).toBeGreaterThan(0)
    expect(users[0]).toHaveProperty('id')
    expect(users[0]).toHaveProperty('email')
  })

  it("await $.Users('id') should get specific instance", async () => {
    const Users = $.Users as (id: string) => Promise<Record<string, unknown>>
    const user = await Users('usr-1')

    expect(user).toHaveProperty('id', 'usr-1')
    expect(user).toHaveProperty('email')
  })

  it('$.Users.where({ role: "admin" }) should return query builder result', async () => {
    const Users = $.Users as { where: (filter: object) => Promise<Array<Record<string, unknown>>> }
    const admins = await Users.where({ role: 'admin' })

    expect(Array.isArray(admins)).toBe(true)
    expect(admins[0]).toHaveProperty('role', 'admin')
  })

  it('$.Users.count() should return count', async () => {
    const Users = $.Users as { count: () => Promise<number> }
    const count = await Users.count()

    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(0)
  })

  it('$.Users.count({ role: "admin" }) should return filtered count', async () => {
    const Users = $.Users as { count: (filter?: object) => Promise<number> }
    const count = await Users.count({ role: 'admin' })

    expect(typeof count).toBe('number')
  })

  it('$.Users.create(data) should create new instance', async () => {
    const Users = $.Users as { create: (data: object) => Promise<Record<string, unknown>> }
    const newUser = await Users.create({ email: 'new@test.com', role: 'user' })

    expect(newUser).toHaveProperty('id')
    expect(newUser).toHaveProperty('email', 'new@test.com')
  })

  it('$.Customers should also work for other classes', () => {
    const Customers = $.Customers
    expect(typeof Customers).toBe('function')
  })
})

// ============================================================================
// STORAGE ACCESS TESTS
// ============================================================================

describe('Storage Access', () => {
  let $: DOSchemaProxy

  beforeEach(async () => {
    __clearCache()
    __setMockFetch(vi.fn().mockResolvedValue(mockSchema))
    __setMockStorage({
      fsx: {
        ls: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
        read: vi.fn().mockResolvedValue('file content'),
        write: vi.fn().mockResolvedValue(undefined),
      },
      gitx: {
        status: vi.fn().mockResolvedValue({ modified: [], staged: [] }),
        log: vi.fn().mockResolvedValue([]),
      },
      bashx: {
        exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      },
    })
    $ = await createDOProxy('test.example.com', 'test-token')
  })

  it('$.fsx should return FSX client when storage.fsx is true', () => {
    const fsx = $.fsx
    expect(fsx).toBeDefined()
    expect(typeof fsx).toBe('object')
    expect(fsx).toHaveProperty('ls')
    expect(fsx).toHaveProperty('read')
    expect(fsx).toHaveProperty('write')
  })

  it('$.fsx.ls() should list files', async () => {
    const fsx = $.fsx!
    const files = await fsx.ls('/')

    expect(Array.isArray(files)).toBe(true)
  })

  it('$.gitx should return GitX client when storage.gitx is true', () => {
    const gitx = $.gitx
    expect(gitx).toBeDefined()
    expect(typeof gitx).toBe('object')
    expect(gitx).toHaveProperty('status')
    expect(gitx).toHaveProperty('log')
  })

  it('$.bashx should return undefined when storage.bashx is false', () => {
    // In our mock, bashx is disabled
    const bashx = $.bashx
    expect(bashx).toBeUndefined()
  })

  describe('with bashx enabled', () => {
    beforeEach(async () => {
      __clearCache()
      const schemaWithBashx = {
        ...mockSchema,
        storage: { ...mockSchema.storage, bashx: true },
      }
      __setMockFetch(vi.fn().mockResolvedValue(schemaWithBashx))
      __setMockStorage({
        fsx: { ls: vi.fn(), read: vi.fn(), write: vi.fn() },
        gitx: { status: vi.fn(), log: vi.fn() },
        bashx: { exec: vi.fn().mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 }) },
      })
      $ = await createDOProxy('test.example.com', 'test-token')
    })

    it('$.bashx should return BashX client when storage.bashx is true', () => {
      const bashx = $.bashx
      expect(bashx).toBeDefined()
      expect(typeof bashx).toBe('object')
      expect(bashx).toHaveProperty('exec')
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    __clearCache()
  })

  it('should propagate network errors', async () => {
    __setMockFetch(vi.fn().mockRejectedValue(new Error('Network error')))

    await expect(createDOProxy('test.example.com', 'test-token')).rejects.toThrow('Network error')
  })

  it('should handle auth errors gracefully', async () => {
    __setMockFetch(
      vi.fn().mockRejectedValue(
        Object.assign(new Error('Unauthorized'), {
          status: 401,
          code: 'UNAUTHORIZED',
        })
      )
    )

    await expect(createDOProxy('test.example.com', 'invalid-token')).rejects.toThrow('Unauthorized')
  })

  it('should handle invalid schema response', async () => {
    __setMockFetch(vi.fn().mockResolvedValue({ invalid: 'schema' }))

    await expect(createDOProxy('test.example.com', 'test-token')).rejects.toThrow()
  })
})

// ============================================================================
// PROXY CALLABLE TESTS
// ============================================================================

describe('Proxy Callable', () => {
  let $: DOSchemaProxy

  beforeEach(async () => {
    __clearCache()
    __setMockFetch(vi.fn().mockResolvedValue(mockSchema))
    $ = await createDOProxy('test.example.com', 'test-token')
  })

  it('$() should return the raw schema', () => {
    const schema = ($ as unknown as () => DOSchema)()
    expect(schema).toEqual(mockSchema)
  })

  it('$ should be inspectable and show schema properties', () => {
    // When inspected (e.g., console.log), should show schema-like structure
    const keys = Object.keys($)

    // Should expose schema properties
    expect(keys).toContain('ns')
    expect(keys).toContain('permissions')
    expect(keys).toContain('classes')
    expect(keys).toContain('stores')
    expect(keys).toContain('storage')
  })
})

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('Type Safety', () => {
  it('should export createDOProxy function', () => {
    expect(typeof createDOProxy).toBe('function')
  })

  it('should export type helpers', () => {
    // Types are checked at compile time
    // This test just verifies the module structure
    expect(typeof __setMockFetch).toBe('function')
    expect(typeof __setMockRPC).toBe('function')
    expect(typeof __setMockStorage).toBe('function')
  })
})
