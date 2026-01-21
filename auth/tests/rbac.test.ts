import { describe, it, expect, beforeEach } from 'vitest'
import { Hono, type Context, type Next } from 'hono'
import {
  PolicyEngine,
  DEFAULT_ROLES,
  rbacMiddleware,
  requirePermission,
  requireResourceOwner,
  requireTenantMatch,
  permission,
  parsePermission,
  matchesPermission,
  type UserContext,
  type ResourceContext,
  type RoleDefinition,
  type Permission
} from '../rbac'

// Helper to set user on context
const setUser = (user: { id: string; roles?: string[]; scopes?: string[] }) =>
  async (c: Context, next: Next) => {
    c.set('user', user)
    return next()
  }

describe('RBAC - PolicyEngine', () => {
  let engine: PolicyEngine

  beforeEach(() => {
    engine = new PolicyEngine()
  })

  describe('Default Roles', () => {
    it('should have all built-in roles', () => {
      expect(engine.getRole('super_admin')).toBeDefined()
      expect(engine.getRole('admin')).toBeDefined()
      expect(engine.getRole('owner')).toBeDefined()
      expect(engine.getRole('editor')).toBeDefined()
      expect(engine.getRole('viewer')).toBeDefined()
      expect(engine.getRole('guest')).toBeDefined()
      expect(engine.getRole('api')).toBeDefined()
    })

    it('super_admin should have wildcard permissions', () => {
      const role = engine.getRole('super_admin')
      expect(role?.permissions).toContainEqual({ resource: '*', action: '*' })
    })

    it('viewer should only have read permissions', () => {
      const role = engine.getRole('viewer')
      expect(role?.permissions.every(p => p.action === 'read' || p.action === 'list')).toBe(true)
    })
  })

  describe('Permission Checking', () => {
    it('super_admin can do anything', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['super_admin']
      }

      const resource: ResourceContext = {
        type: 'thing',
        id: 'thing-1',
        tenantId: 'tenant-1'
      }

      expect(engine.check(user, 'create', resource).allowed).toBe(true)
      expect(engine.check(user, 'read', resource).allowed).toBe(true)
      expect(engine.check(user, 'update', resource).allowed).toBe(true)
      expect(engine.check(user, 'delete', resource).allowed).toBe(true)
      expect(engine.check(user, 'execute', resource).allowed).toBe(true)
    })

    it('guest can only read public resources', () => {
      const user: UserContext = {
        id: 'guest-1',
        roles: ['guest']
      }

      // Public resource
      const publicResource: ResourceContext = {
        type: 'thing',
        id: 'thing-1',
        attributes: { public: true }
      }

      // Private resource
      const privateResource: ResourceContext = {
        type: 'thing',
        id: 'thing-2',
        attributes: { public: false }
      }

      expect(engine.check(user, 'read', publicResource).allowed).toBe(true)
      expect(engine.check(user, 'read', privateResource).allowed).toBe(false)
      expect(engine.check(user, 'create', publicResource).allowed).toBe(false)
    })

    it('editor can create things', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['editor']
      }

      const resource: ResourceContext = {
        type: 'thing'
      }

      expect(engine.check(user, 'create', resource).allowed).toBe(true)
      expect(engine.check(user, 'read', resource).allowed).toBe(true)
    })

    it('api role can read any resource', () => {
      const user: UserContext = {
        id: 'api-key-1',
        roles: ['api']
      }

      const resource: ResourceContext = {
        type: 'thing',
        id: 'thing-1'
      }

      expect(engine.check(user, 'read', resource).allowed).toBe(true)
      expect(engine.check(user, 'list', resource).allowed).toBe(true)
    })
  })

  describe('Condition Evaluation', () => {
    it('owner condition should match user id to ownerId', () => {
      const user: UserContext = {
        id: 'user-123',
        roles: ['owner']
      }

      const ownedResource: ResourceContext = {
        type: 'thing',
        id: 'thing-1',
        ownerId: 'user-123'
      }

      const notOwnedResource: ResourceContext = {
        type: 'thing',
        id: 'thing-2',
        ownerId: 'user-456'
      }

      expect(engine.check(user, 'update', ownedResource).allowed).toBe(true)
      expect(engine.check(user, 'update', notOwnedResource).allowed).toBe(false)
    })

    it('admin condition should match tenant', () => {
      const user: UserContext = {
        id: 'admin-1',
        roles: ['admin'],
        tenantId: 'tenant-abc'
      }

      const sameTenanResource: ResourceContext = {
        type: 'user',
        id: 'user-1',
        tenantId: 'tenant-abc'
      }

      const differentTenantResource: ResourceContext = {
        type: 'user',
        id: 'user-2',
        tenantId: 'tenant-xyz'
      }

      expect(engine.check(user, 'update', sameTenanResource).allowed).toBe(true)
      expect(engine.check(user, 'update', differentTenantResource).allowed).toBe(false)
    })
  })

  describe('Tenant Isolation', () => {
    it('super_admin bypasses tenant isolation', () => {
      const user: UserContext = {
        id: 'super-admin-1',
        roles: ['super_admin'],
        tenantId: 'tenant-a'
      }

      const resource: ResourceContext = {
        type: 'thing',
        tenantId: 'tenant-b'
      }

      expect(engine.checkTenantIsolation(user, resource).allowed).toBe(true)
    })

    it('regular user cannot access other tenant resources', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['editor'],
        tenantId: 'tenant-a'
      }

      const resource: ResourceContext = {
        type: 'thing',
        tenantId: 'tenant-b'
      }

      expect(engine.checkTenantIsolation(user, resource).allowed).toBe(false)
    })

    it('user can access same tenant resources', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['editor'],
        tenantId: 'tenant-a'
      }

      const resource: ResourceContext = {
        type: 'thing',
        tenantId: 'tenant-a'
      }

      expect(engine.checkTenantIsolation(user, resource).allowed).toBe(true)
    })

    it('resources without tenant restriction are accessible', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['editor'],
        tenantId: 'tenant-a'
      }

      const resource: ResourceContext = {
        type: 'thing'
        // No tenantId
      }

      expect(engine.checkTenantIsolation(user, resource).allowed).toBe(true)
    })
  })

  describe('Full Authorization', () => {
    it('authorize checks both tenant and permissions', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['editor'],
        tenantId: 'tenant-a'
      }

      // Same tenant - allowed
      const sameTenan: ResourceContext = {
        type: 'thing',
        tenantId: 'tenant-a'
      }

      // Different tenant - denied by isolation
      const differentTenant: ResourceContext = {
        type: 'thing',
        tenantId: 'tenant-b'
      }

      expect(engine.authorize(user, 'create', sameTenan).allowed).toBe(true)
      expect(engine.authorize(user, 'create', differentTenant).allowed).toBe(false)
    })
  })

  describe('Custom Roles', () => {
    it('should allow adding custom roles', () => {
      const customRole: RoleDefinition = {
        name: 'analyst',
        description: 'Data analyst role',
        permissions: [
          { resource: 'analytics', action: '*' },
          { resource: 'thing', action: 'read' }
        ]
      }

      engine.addRole(customRole)

      const user: UserContext = {
        id: 'analyst-1',
        roles: ['analyst']
      }

      const analyticsResource: ResourceContext = { type: 'analytics' }
      const thingResource: ResourceContext = { type: 'thing' }

      expect(engine.check(user, 'read', analyticsResource).allowed).toBe(true)
      expect(engine.check(user, 'create', analyticsResource).allowed).toBe(true)
      expect(engine.check(user, 'read', thingResource).allowed).toBe(true)
      expect(engine.check(user, 'create', thingResource).allowed).toBe(false)
    })

    it('should not allow overriding system roles', () => {
      const fakeAdmin: RoleDefinition = {
        name: 'super_admin',
        description: 'Fake admin',
        permissions: []
      }

      expect(() => engine.addRole(fakeAdmin)).toThrow('Cannot override system role')
    })

    it('should allow removing custom roles', () => {
      const customRole: RoleDefinition = {
        name: 'temp_role',
        description: 'Temporary role',
        permissions: [{ resource: 'thing', action: 'read' }]
      }

      engine.addRole(customRole)
      expect(engine.getRole('temp_role')).toBeDefined()

      engine.removeRole('temp_role')
      expect(engine.getRole('temp_role')).toBeUndefined()
    })

    it('should not allow removing system roles', () => {
      expect(() => engine.removeRole('admin')).toThrow('Cannot remove system role')
    })
  })

  describe('Direct Permissions (Scopes)', () => {
    it('should respect direct permissions from scopes', () => {
      const user: UserContext = {
        id: 'user-1',
        roles: ['guest'],
        permissions: ['thing:create', 'thing:update']
      }

      const resource: ResourceContext = { type: 'thing' }

      // From direct permissions
      expect(engine.check(user, 'create', resource).allowed).toBe(true)
      expect(engine.check(user, 'update', resource).allowed).toBe(true)

      // Not granted
      expect(engine.check(user, 'delete', resource).allowed).toBe(false)
    })
  })

  describe('Role Inheritance', () => {
    it('should support role inheritance', () => {
      const engineWithInheritance = new PolicyEngine({
        manager: {
          name: 'manager',
          description: 'Manager role',
          permissions: [
            { resource: 'team', action: 'manage' }
          ],
          inherits: ['editor']
        }
      })

      const user: UserContext = {
        id: 'manager-1',
        roles: ['manager']
      }

      // From manager role
      const teamResource: ResourceContext = { type: 'team' }
      expect(engineWithInheritance.check(user, 'create', teamResource).allowed).toBe(true)

      // Inherited from editor
      const thingResource: ResourceContext = { type: 'thing' }
      expect(engineWithInheritance.check(user, 'create', thingResource).allowed).toBe(true)
    })
  })
})

describe('RBAC - Middleware', () => {
  describe('rbacMiddleware', () => {
    it('should initialize policy engine in context', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['editor'] }))
      app.use('/*', rbacMiddleware())
      app.get('/', (c) => {
        const policyEngine = c.var.policyEngine
        const userContext = c.var.userContext
        return c.json({
          hasPolicyEngine: !!policyEngine,
          userId: userContext?.id,
          roles: userContext?.roles
        })
      })

      const res = await app.request('/')
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.hasPolicyEngine).toBe(true)
      expect(json.userId).toBe('user-1')
      expect(json.roles).toContain('editor')
    })

    it('should use guest role for unauthenticated users', async () => {
      const app = new Hono()
      app.use('/*', rbacMiddleware())
      app.get('/', (c) => {
        const userContext = c.var.userContext
        return c.json({
          userId: userContext?.id,
          roles: userContext?.roles
        })
      })

      const res = await app.request('/')
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.userId).toBe('anonymous')
      expect(json.roles).toContain('guest')
    })

    it('should extract tenant from header', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['editor'] }))
      app.use('/*', rbacMiddleware())
      app.get('/', (c) => {
        const userContext = c.var.userContext
        return c.json({ tenantId: userContext?.tenantId })
      })

      const res = await app.request('/', {
        headers: { 'X-Tenant-ID': 'tenant-abc' }
      })
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.tenantId).toBe('tenant-abc')
    })

    it('should use custom getTenantId function', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['editor'] }))
      app.use('/*', rbacMiddleware({
        getTenantId: (c) => c.req.header('X-Custom-Tenant')
      }))
      app.get('/', (c) => {
        const userContext = c.var.userContext
        return c.json({ tenantId: userContext?.tenantId })
      })

      const res = await app.request('/', {
        headers: { 'X-Custom-Tenant': 'custom-tenant' }
      })
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.tenantId).toBe('custom-tenant')
    })
  })

  describe('requirePermission', () => {
    it('should allow when user has permission', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['editor'] }))
      app.use('/*', rbacMiddleware())
      app.get('/things', requirePermission('thing', 'list'), (c) => {
        return c.json({ things: [] })
      })

      const res = await app.request('/things')
      expect(res.status).toBe(200)
    })

    it('should deny when user lacks permission', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['viewer'] }))
      app.use('/*', rbacMiddleware())
      app.post('/things', requirePermission('thing', 'create'), (c) => {
        return c.json({ created: true })
      })

      const res = await app.request('/things', { method: 'POST' })
      expect(res.status).toBe(403)
    })

    it('should allow super_admin for any permission', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'admin-1', roles: ['super_admin'] }))
      app.use('/*', rbacMiddleware())
      app.delete('/nuclear', requirePermission('nuclear', 'launch'), (c) => {
        return c.json({ launched: true })
      })

      const res = await app.request('/nuclear', { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('should use custom resource context', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['owner'] }))
      app.use('/*', rbacMiddleware())
      app.get('/things/:id', requirePermission('thing', 'read', (c) => ({
        type: 'thing',
        id: c.req.param('id'),
        ownerId: 'user-1'  // Simulated lookup
      })), (c) => {
        return c.json({ thing: { id: c.req.param('id') } })
      })

      const res = await app.request('/things/thing-123')
      expect(res.status).toBe(200)
    })

    it('should fail without rbacMiddleware', async () => {
      const app = new Hono()
      app.get('/things', requirePermission('thing', 'list'), (c) => {
        return c.json({ things: [] })
      })

      const res = await app.request('/things')
      expect(res.status).toBe(500)
    })
  })

  describe('requireResourceOwner', () => {
    it('should allow owner', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-123', roles: ['editor'] }))
      app.use('/*', rbacMiddleware())
      app.delete('/things/:id', requireResourceOwner(() => 'user-123'), (c) => {
        return c.json({ deleted: true })
      })

      const res = await app.request('/things/thing-1', { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('should deny non-owner', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-456', roles: ['editor'] }))
      app.use('/*', rbacMiddleware())
      app.delete('/things/:id', requireResourceOwner(() => 'user-123'), (c) => {
        return c.json({ deleted: true })
      })

      const res = await app.request('/things/thing-1', { method: 'DELETE' })
      expect(res.status).toBe(403)
    })

    it('should allow admin even if not owner', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'admin-1', roles: ['admin'] }))
      app.use('/*', rbacMiddleware())
      app.delete('/things/:id', requireResourceOwner(() => 'user-123'), (c) => {
        return c.json({ deleted: true })
      })

      const res = await app.request('/things/thing-1', { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('should return 404 if resource not found', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-123', roles: ['editor'] }))
      app.use('/*', rbacMiddleware())
      app.delete('/things/:id', requireResourceOwner(() => undefined), (c) => {
        return c.json({ deleted: true })
      })

      const res = await app.request('/things/thing-1', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('requireTenantMatch', () => {
    it('should allow same tenant', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['editor'] }))
      app.use('/*', rbacMiddleware({
        getTenantId: () => 'tenant-abc'
      }))
      app.get('/data', requireTenantMatch(() => 'tenant-abc'), (c) => {
        return c.json({ data: [] })
      })

      const res = await app.request('/data')
      expect(res.status).toBe(200)
    })

    it('should deny different tenant', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-1', roles: ['editor'] }))
      app.use('/*', rbacMiddleware({
        getTenantId: () => 'tenant-abc'
      }))
      app.get('/data', requireTenantMatch(() => 'tenant-xyz'), (c) => {
        return c.json({ data: [] })
      })

      const res = await app.request('/data')
      expect(res.status).toBe(403)
    })

    it('should allow super_admin across tenants', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'super-1', roles: ['super_admin'] }))
      app.use('/*', rbacMiddleware({
        getTenantId: () => 'tenant-abc'
      }))
      app.get('/data', requireTenantMatch(() => 'tenant-xyz'), (c) => {
        return c.json({ data: [] })
      })

      const res = await app.request('/data')
      expect(res.status).toBe(200)
    })
  })
})

describe('RBAC - Helper Functions', () => {
  describe('permission()', () => {
    it('should create permission string', () => {
      expect(permission('thing', 'read')).toBe('thing:read')
      expect(permission('user', 'create')).toBe('user:create')
      expect(permission('*', '*')).toBe('*:*')
    })
  })

  describe('parsePermission()', () => {
    it('should parse permission string', () => {
      expect(parsePermission('thing:read')).toEqual({ resource: 'thing', action: 'read' })
      expect(parsePermission('user:*')).toEqual({ resource: 'user', action: '*' })
    })

    it('should handle malformed permissions', () => {
      expect(parsePermission('')).toEqual({ resource: '*', action: '*' })
      expect(parsePermission('thing')).toEqual({ resource: 'thing', action: '*' })
    })
  })

  describe('matchesPermission()', () => {
    it('should match exact permissions', () => {
      expect(matchesPermission('thing:read', 'thing', 'read')).toBe(true)
      expect(matchesPermission('thing:read', 'thing', 'write')).toBe(false)
      expect(matchesPermission('thing:read', 'user', 'read')).toBe(false)
    })

    it('should match wildcard actions', () => {
      expect(matchesPermission('thing:*', 'thing', 'read')).toBe(true)
      expect(matchesPermission('thing:*', 'thing', 'write')).toBe(true)
      expect(matchesPermission('thing:*', 'user', 'read')).toBe(false)
    })

    it('should match wildcard resources', () => {
      expect(matchesPermission('*:read', 'thing', 'read')).toBe(true)
      expect(matchesPermission('*:read', 'user', 'read')).toBe(true)
      expect(matchesPermission('*:read', 'thing', 'write')).toBe(false)
    })

    it('should match full wildcard', () => {
      expect(matchesPermission('*:*', 'thing', 'read')).toBe(true)
      expect(matchesPermission('*:*', 'user', 'delete')).toBe(true)
    })
  })
})

describe('RBAC - Condition Operators', () => {
  let engine: PolicyEngine

  beforeEach(() => {
    engine = new PolicyEngine()
  })

  it('should handle eq operator', () => {
    const user: UserContext = { id: 'user-1', roles: [], tenantId: 'tenant-a' }
    const resource: ResourceContext = { type: 'thing', tenantId: 'tenant-a' }

    const result = engine.evaluateCondition(
      { field: 'tenantId', operator: 'eq', value: '$user.tenantId' },
      resource,
      user
    )
    expect(result).toBe(true)
  })

  it('should handle ne operator', () => {
    const user: UserContext = { id: 'user-1', roles: [], tenantId: 'tenant-a' }
    const resource: ResourceContext = { type: 'thing', tenantId: 'tenant-b' }

    const result = engine.evaluateCondition(
      { field: 'tenantId', operator: 'ne', value: '$user.tenantId' },
      resource,
      user
    )
    expect(result).toBe(true)
  })

  it('should handle in operator', () => {
    const user: UserContext = { id: 'user-1', roles: [] }
    const resource: ResourceContext = {
      type: 'thing',
      attributes: { status: 'active' }
    }

    const result = engine.evaluateCondition(
      { field: 'status', operator: 'in', value: ['active', 'pending'] },
      resource,
      user
    )
    expect(result).toBe(true)
  })

  it('should handle nin operator', () => {
    const user: UserContext = { id: 'user-1', roles: [] }
    const resource: ResourceContext = {
      type: 'thing',
      attributes: { status: 'draft' }
    }

    const result = engine.evaluateCondition(
      { field: 'status', operator: 'nin', value: ['active', 'archived'] },
      resource,
      user
    )
    expect(result).toBe(true)
  })

  it('should handle exists operator', () => {
    const user: UserContext = { id: 'user-1', roles: [] }
    const resourceWithAttr: ResourceContext = {
      type: 'thing',
      attributes: { deletedAt: '2024-01-01' }
    }
    const resourceWithoutAttr: ResourceContext = {
      type: 'thing',
      attributes: {}
    }

    expect(engine.evaluateCondition(
      { field: 'deletedAt', operator: 'exists', value: true },
      resourceWithAttr,
      user
    )).toBe(true)

    expect(engine.evaluateCondition(
      { field: 'deletedAt', operator: 'exists', value: false },
      resourceWithoutAttr,
      user
    )).toBe(true)
  })

  it('should handle match operator', () => {
    const user: UserContext = { id: 'user-1', roles: [] }
    const resource: ResourceContext = {
      type: 'thing',
      attributes: { email: 'user@example.com' }
    }

    expect(engine.evaluateCondition(
      { field: 'email', operator: 'match', value: '^.*@example\\.com$' },
      resource,
      user
    )).toBe(true)

    expect(engine.evaluateCondition(
      { field: 'email', operator: 'match', value: '^.*@other\\.com$' },
      resource,
      user
    )).toBe(false)
  })
})
