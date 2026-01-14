/**
 * IntrospectionManager Module Tests
 *
 * Tests for the extracted IntrospectionManager module that handles
 * schema introspection with role-based filtering.
 */

import { describe, it, expect } from 'vitest'
import {
  IntrospectionManager,
  createIntrospectionManager,
  type IntrospectionManagerDeps,
} from '../core/IntrospectionManager'
import type { AuthContext } from '../transport/auth-layer'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockDeps(overrides: Partial<IntrospectionManagerDeps> = {}): IntrospectionManagerDeps {
  return {
    ns: 'test-namespace',
    getClassMetadata: () => ({
      name: 'TestDO',
      $type: 'Test',
      $mcp: {
        tools: {
          search: {
            description: 'Search for things',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
          adminTool: {
            description: 'Admin only tool',
            inputSchema: { type: 'object' },
            visibility: 'admin',
          },
        },
        resources: ['things'],
      },
      $rest: {
        endpoints: [
          { method: 'GET', path: '/things', description: 'List things' },
          { method: 'POST', path: '/admin/action', description: 'Admin action', visibility: 'admin' },
        ],
      },
    }),
    getJwtSecret: () => undefined,
    ...overrides,
  }
}

function createAuthContext(role: 'public' | 'user' | 'admin' | 'system'): AuthContext {
  if (role === 'public') {
    return { authenticated: false }
  }
  return {
    authenticated: true,
    user: {
      id: `${role}-user`,
      roles: [role],
      permissions: [],
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('IntrospectionManager', () => {
  describe('instantiation', () => {
    it('should create instance with factory function', () => {
      const deps = createMockDeps()
      const manager = createIntrospectionManager(deps)
      expect(manager).toBeInstanceOf(IntrospectionManager)
    })

    it('should create instance with constructor', () => {
      const deps = createMockDeps()
      const manager = new IntrospectionManager(deps)
      expect(manager).toBeInstanceOf(IntrospectionManager)
    })
  })

  describe('introspect()', () => {
    it('should return DOSchema with ns from deps', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect()

      expect(schema.ns).toBe('test-namespace')
    })

    it('should return permissions with role and scopes', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const authContext = createAuthContext('user')
      const schema = await manager.introspect(authContext)

      expect(schema.permissions.role).toBe('user')
      expect(schema.permissions.scopes).toEqual([])
    })

    it('should return public role for unauthenticated context', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('public'))

      expect(schema.permissions.role).toBe('public')
    })

    it('should return classes array', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('admin'))

      expect(Array.isArray(schema.classes)).toBe(true)
      expect(schema.classes.length).toBeGreaterThan(0)
    })

    it('should return stores array', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('admin'))

      expect(Array.isArray(schema.stores)).toBe(true)
    })

    it('should return storage capabilities', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('admin'))

      expect(schema.storage).toHaveProperty('fsx')
      expect(schema.storage).toHaveProperty('gitx')
      expect(schema.storage).toHaveProperty('bashx')
      expect(schema.storage).toHaveProperty('r2')
      expect(schema.storage).toHaveProperty('sql')
      expect(schema.storage).toHaveProperty('iceberg')
      expect(schema.storage).toHaveProperty('edgevec')
    })
  })

  describe('role-based filtering', () => {
    it('should filter storage for public role', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('public'))

      expect(schema.storage.fsx).toBe(false)
      expect(schema.storage.gitx).toBe(false)
      expect(schema.storage.bashx).toBe(false)
    })

    it('should show fsx/gitx for user role', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('user'))

      expect(schema.storage.fsx).toBe(true)
      expect(schema.storage.gitx).toBe(true)
      expect(schema.storage.bashx).toBe(false)
    })

    it('should show bashx for admin role', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('admin'))

      expect(schema.storage.bashx).toBe(true)
      expect(schema.storage.r2.enabled).toBe(true)
      expect(schema.storage.sql.enabled).toBe(true)
    })

    it('should show iceberg/edgevec for system role', async () => {
      const manager = createIntrospectionManager(createMockDeps())
      const schema = await manager.introspect(createAuthContext('system'))

      expect(schema.storage.iceberg).toBe(true)
      expect(schema.storage.edgevec).toBe(true)
    })

    it('should filter stores by role', async () => {
      const manager = createIntrospectionManager(createMockDeps())

      // Public sees no stores
      const publicSchema = await manager.introspect(createAuthContext('public'))
      expect(publicSchema.stores.length).toBe(0)

      // User sees things, relationships, search
      const userSchema = await manager.introspect(createAuthContext('user'))
      const userStoreNames = userSchema.stores.map(s => s.name)
      expect(userStoreNames).toContain('things')
      expect(userStoreNames).not.toContain('dlq')

      // System sees everything
      const systemSchema = await manager.introspect(createAuthContext('system'))
      const systemStoreNames = systemSchema.stores.map(s => s.name)
      expect(systemStoreNames).toContain('dlq')
      expect(systemStoreNames).toContain('objects')
    })

    it('should filter tools by visibility', async () => {
      const manager = createIntrospectionManager(createMockDeps())

      // User should see search but not adminTool
      const userSchema = await manager.introspect(createAuthContext('user'))
      const userClass = userSchema.classes[0]
      expect(userClass).toBeDefined()
      const userToolNames = userClass!.tools.map(t => t.name)
      expect(userToolNames).toContain('search')
      expect(userToolNames).not.toContain('adminTool')

      // Admin should see both
      const adminSchema = await manager.introspect(createAuthContext('admin'))
      const adminClass = adminSchema.classes[0]
      expect(adminClass).toBeDefined()
      const adminToolNames = adminClass!.tools.map(t => t.name)
      expect(adminToolNames).toContain('search')
      expect(adminToolNames).toContain('adminTool')
    })

    it('should filter endpoints by visibility', async () => {
      const manager = createIntrospectionManager(createMockDeps())

      // User should see /things but not /admin/action
      const userSchema = await manager.introspect(createAuthContext('user'))
      const userClass = userSchema.classes[0]
      expect(userClass).toBeDefined()
      const userPaths = userClass!.endpoints.map(e => e.path)
      expect(userPaths).toContain('/things')
      expect(userPaths).not.toContain('/admin/action')

      // Admin should see both
      const adminSchema = await manager.introspect(createAuthContext('admin'))
      const adminClass = adminSchema.classes[0]
      expect(adminClass).toBeDefined()
      const adminPaths = adminClass!.endpoints.map(e => e.path)
      expect(adminPaths).toContain('/things')
      expect(adminPaths).toContain('/admin/action')
    })
  })

  describe('role determination', () => {
    it('should use highest role when multiple roles present', async () => {
      const manager = createIntrospectionManager(createMockDeps())

      const mixedContext: AuthContext = {
        authenticated: true,
        user: {
          id: 'multi-role-user',
          roles: ['user', 'admin'],
          permissions: [],
        },
      }

      const schema = await manager.introspect(mixedContext)
      expect(schema.permissions.role).toBe('admin')
    })

    it('should prioritize system over admin', async () => {
      const manager = createIntrospectionManager(createMockDeps())

      const mixedContext: AuthContext = {
        authenticated: true,
        user: {
          id: 'system-user',
          roles: ['admin', 'system'],
          permissions: [],
        },
      }

      const schema = await manager.introspect(mixedContext)
      expect(schema.permissions.role).toBe('system')
    })

    it('should default to user role for authenticated with no roles', async () => {
      const manager = createIntrospectionManager(createMockDeps())

      const noRoleContext: AuthContext = {
        authenticated: true,
        user: {
          id: 'no-role-user',
          roles: [],
          permissions: [],
        },
      }

      const schema = await manager.introspect(noRoleContext)
      expect(schema.permissions.role).toBe('user')
    })
  })

  describe('custom noun/verb queries', () => {
    it('should use queryNouns when provided', async () => {
      const manager = createIntrospectionManager(createMockDeps({
        queryNouns: async () => [
          { noun: 'Customer', plural: 'Customers', description: 'Customer entity' },
        ],
      }))

      const schema = await manager.introspect(createAuthContext('admin'))
      expect(schema.nouns).toHaveLength(1)
      expect(schema.nouns[0]!.noun).toBe('Customer')
    })

    it('should use queryVerbs when provided', async () => {
      const manager = createIntrospectionManager(createMockDeps({
        queryVerbs: async () => [
          { verb: 'create', description: 'Create a resource', category: 'crud' },
        ],
      }))

      const schema = await manager.introspect(createAuthContext('admin'))
      expect(schema.verbs).toHaveLength(1)
      expect(schema.verbs[0]!.verb).toBe('create')
    })
  })
})
