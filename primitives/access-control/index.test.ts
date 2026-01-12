import { describe, test, expect, beforeEach } from 'vitest'
import { AccessControl } from './index'
import type { Principal, Resource, Action, Policy, Permission } from './types'

describe('AccessControl', () => {
  let ac: AccessControl

  beforeEach(() => {
    ac = new AccessControl()
  })

  describe('simple allow/deny', () => {
    test('denies access by default when no permissions exist', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const action: Action = { name: 'read' }
      const resource: Resource = { type: 'document', id: 'doc-1' }

      const decision = ac.check(principal, action, resource)

      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('No matching policy found')
    })

    test('allows access when permission is granted', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const action: Action = { name: 'read' }
      const resource: Resource = { type: 'document', id: 'doc-1' }

      const permission: Permission = {
        effect: 'allow',
        resources: ['document:doc-1'],
        actions: ['read'],
      }

      ac.grant(principal, permission)
      const decision = ac.check(principal, action, resource)

      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('Permission granted')
    })

    test('denies access when permission is explicitly denied', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const action: Action = { name: 'read' }
      const resource: Resource = { type: 'document', id: 'doc-1' }

      const permission: Permission = {
        effect: 'deny',
        resources: ['document:doc-1'],
        actions: ['read'],
      }

      ac.grant(principal, permission)
      const decision = ac.check(principal, action, resource)

      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('Permission explicitly denied')
    })

    test('revoke removes a previously granted permission', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const action: Action = { name: 'read' }
      const resource: Resource = { type: 'document', id: 'doc-1' }

      const permission: Permission = {
        effect: 'allow',
        resources: ['document:doc-1'],
        actions: ['read'],
      }

      ac.grant(principal, permission)
      expect(ac.check(principal, action, resource).allowed).toBe(true)

      ac.revoke(principal, permission)
      expect(ac.check(principal, action, resource).allowed).toBe(false)
    })
  })

  describe('resource pattern matching', () => {
    test('wildcard * matches any resource of type', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-999' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'folder', id: 'folder-1' }).allowed).toBe(false)
    })

    test('global wildcard * matches all resources', () => {
      const principal: Principal = { id: 'admin', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['*'],
        actions: ['read'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'folder', id: 'folder-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'project', id: 'proj-1' }).allowed).toBe(true)
    })

    test('prefix wildcard matches resources starting with pattern', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:project-a/*'],
        actions: ['read'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'project-a/doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'project-a/subdir/doc-2' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'project-b/doc-1' }).allowed).toBe(false)
    })

    test('multiple resource patterns', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:doc-1', 'document:doc-2', 'folder:*'],
        actions: ['read'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-2' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-3' }).allowed).toBe(false)
      expect(ac.check(principal, { name: 'read' }, { type: 'folder', id: 'any-folder' }).allowed).toBe(true)
    })
  })

  describe('action matching', () => {
    test('wildcard * matches any action', () => {
      const principal: Principal = { id: 'admin', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:doc-1'],
        actions: ['*'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'write' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'delete' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
    })

    test('action prefix matching with wildcard', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read:*'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read:content' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'read:metadata' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'write:content' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })

    test('multiple actions in permission', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read', 'write'],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'write' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(principal, { name: 'delete' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })
  })

  describe('condition evaluation', () => {
    test('equals condition on resource attribute', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
        conditions: [
          { type: 'resource', field: 'attributes.status', operator: 'equals', value: 'published' },
        ],
      }

      ac.grant(principal, permission)

      // Published document - should be allowed
      expect(
        ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1', attributes: { status: 'published' } })
          .allowed
      ).toBe(true)

      // Draft document - should be denied
      expect(
        ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-2', attributes: { status: 'draft' } }).allowed
      ).toBe(false)
    })

    test('in condition for array membership', () => {
      const principal: Principal = { id: 'user-1', type: 'user', attributes: { department: 'engineering' } }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
        conditions: [
          { type: 'principal', field: 'attributes.department', operator: 'in', value: ['engineering', 'product'] },
        ],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)

      const salesUser: Principal = { id: 'user-2', type: 'user', attributes: { department: 'sales' } }
      ac.grant(salesUser, permission)
      expect(ac.check(salesUser, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })

    test('greaterThan condition for numeric comparison', () => {
      const principal: Principal = { id: 'user-1', type: 'user', attributes: { level: 5 } }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['delete'],
        conditions: [{ type: 'principal', field: 'attributes.level', operator: 'greaterThan', value: 3 }],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'delete' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)

      const lowLevelUser: Principal = { id: 'user-2', type: 'user', attributes: { level: 2 } }
      ac.grant(lowLevelUser, permission)
      expect(ac.check(lowLevelUser, { name: 'delete' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })

    test('owner condition - user owns resource', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['write'],
        conditions: [{ type: 'resource', field: 'owner', operator: 'equals', value: '${principal.id}' }],
      }

      ac.grant(principal, permission)

      // User owns the document
      expect(
        ac.check(principal, { name: 'write' }, { type: 'document', id: 'doc-1', owner: 'user-1' }).allowed
      ).toBe(true)

      // User doesn't own the document
      expect(
        ac.check(principal, { name: 'write' }, { type: 'document', id: 'doc-2', owner: 'user-2' }).allowed
      ).toBe(false)
    })

    test('multiple conditions (AND logic)', () => {
      const principal: Principal = { id: 'user-1', type: 'user', attributes: { level: 5, verified: true } }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['admin'],
        conditions: [
          { type: 'principal', field: 'attributes.level', operator: 'greaterThanOrEqual', value: 5 },
          { type: 'principal', field: 'attributes.verified', operator: 'equals', value: true },
        ],
      }

      ac.grant(principal, permission)

      // Both conditions met
      expect(ac.check(principal, { name: 'admin' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)

      // Level met but not verified
      const unverifiedUser: Principal = { id: 'user-2', type: 'user', attributes: { level: 5, verified: false } }
      ac.grant(unverifiedUser, permission)
      expect(ac.check(unverifiedUser, { name: 'admin' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })

    test('exists condition checks field presence', () => {
      const principal: Principal = { id: 'user-1', type: 'user', attributes: { apiKey: 'secret-key' } }
      const permission: Permission = {
        effect: 'allow',
        resources: ['api:*'],
        actions: ['call'],
        conditions: [{ type: 'principal', field: 'attributes.apiKey', operator: 'exists', value: true }],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'call' }, { type: 'api', id: 'endpoint-1' }).allowed).toBe(true)

      const noKeyUser: Principal = { id: 'user-2', type: 'user', attributes: {} }
      ac.grant(noKeyUser, permission)
      expect(ac.check(noKeyUser, { name: 'call' }, { type: 'api', id: 'endpoint-1' }).allowed).toBe(false)
    })

    test('matches condition for regex patterns', () => {
      const principal: Principal = { id: 'user-1', type: 'user', attributes: { email: 'user@example.com' } }
      const permission: Permission = {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
        conditions: [{ type: 'principal', field: 'attributes.email', operator: 'matches', value: '.*@example\\.com$' }],
      }

      ac.grant(principal, permission)

      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)

      const otherUser: Principal = { id: 'user-2', type: 'user', attributes: { email: 'user@other.com' } }
      ac.grant(otherUser, permission)
      expect(ac.check(otherUser, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })
  })

  describe('policy priority and deny overrides', () => {
    test('deny policy overrides allow policy regardless of order', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }
      const resource: Resource = { type: 'document', id: 'secret-doc' }

      // Grant allow first
      ac.grant(principal, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // Then deny - should override allow
      ac.grant(principal, {
        effect: 'deny',
        resources: ['document:secret-doc'],
        actions: ['read'],
      })

      expect(ac.check(principal, { name: 'read' }, resource).allowed).toBe(false)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'normal-doc' }).allowed).toBe(true)
    })

    test('addPolicy with priority controls evaluation order', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }

      // Add policy with low priority (evaluated last)
      ac.addPolicy({
        id: 'allow-all',
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
        priority: 1,
      })

      // Add policy with high priority (evaluated first)
      ac.addPolicy({
        id: 'deny-secret',
        effect: 'deny',
        resources: ['document:secret-*'],
        actions: ['read'],
        priority: 10,
      })

      // Secret docs should be denied due to high priority deny policy
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'secret-file' }).allowed).toBe(false)

      // Normal docs should be allowed
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'normal-file' }).allowed).toBe(true)
    })

    test('higher priority policy takes precedence', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }

      // Low priority allow
      ac.addPolicy({
        id: 'allow-read',
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
        priority: 1,
      })

      // High priority allow with condition
      ac.addPolicy({
        id: 'allow-admin',
        effect: 'allow',
        resources: ['document:*'],
        actions: ['*'],
        priority: 100,
        principals: ['user:admin'],
      })

      // Medium priority deny
      ac.addPolicy({
        id: 'deny-write',
        effect: 'deny',
        resources: ['document:*'],
        actions: ['write'],
        priority: 50,
      })

      // Regular user can read (low priority allow)
      expect(ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)

      // Regular user cannot write (medium priority deny)
      expect(ac.check(principal, { name: 'write' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)

      // Admin can do everything (high priority allow overrides deny)
      const admin: Principal = { id: 'admin', type: 'user' }
      expect(ac.check(admin, { name: 'write' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
    })

    test('matchedPolicies shows which policies were evaluated', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }

      ac.addPolicy({
        id: 'base-allow',
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
        priority: 1,
      })

      const decision = ac.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })

      expect(decision.allowed).toBe(true)
      expect(decision.matchedPolicies).toContain('base-allow')
    })
  })

  describe('principal hierarchy', () => {
    test('user inherits permissions from assigned roles', () => {
      const user: Principal = { id: 'user-1', type: 'user', roles: ['editor'] }
      const editorRole: Principal = { id: 'editor', type: 'role' }

      // Grant permission to the role
      ac.grant(editorRole, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read', 'write'],
      })

      // User should inherit role permissions
      expect(ac.check(user, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(user, { name: 'write' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(user, { name: 'delete' }, { type: 'document', id: 'doc-1' }).allowed).toBe(false)
    })

    test('user inherits permissions from multiple roles', () => {
      const user: Principal = { id: 'user-1', type: 'user', roles: ['viewer', 'commenter'] }

      ac.grant({ id: 'viewer', type: 'role' }, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      ac.grant({ id: 'commenter', type: 'role' }, {
        effect: 'allow',
        resources: ['comment:*'],
        actions: ['create'],
      })

      expect(ac.check(user, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(user, { name: 'create' }, { type: 'comment', id: 'new' }).allowed).toBe(true)
    })

    test('user inherits permissions from groups', () => {
      const user: Principal = { id: 'user-1', type: 'user', groups: ['engineering'] }
      const group: Principal = { id: 'engineering', type: 'group' }

      ac.grant(group, {
        effect: 'allow',
        resources: ['repo:*'],
        actions: ['read', 'write'],
      })

      expect(ac.check(user, { name: 'read' }, { type: 'repo', id: 'backend' }).allowed).toBe(true)
      expect(ac.check(user, { name: 'write' }, { type: 'repo', id: 'backend' }).allowed).toBe(true)
    })

    test('direct user permissions override inherited permissions', () => {
      const user: Principal = { id: 'user-1', type: 'user', roles: ['viewer'] }

      // Role allows read
      ac.grant({ id: 'viewer', type: 'role' }, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // User has explicit deny on specific document
      ac.grant(user, {
        effect: 'deny',
        resources: ['document:secret'],
        actions: ['read'],
      })

      // Can read normal docs through role
      expect(ac.check(user, { name: 'read' }, { type: 'document', id: 'normal' }).allowed).toBe(true)

      // Cannot read secret doc due to direct deny
      expect(ac.check(user, { name: 'read' }, { type: 'document', id: 'secret' }).allowed).toBe(false)
    })

    test('registerHierarchy sets up role inheritance', () => {
      ac.registerHierarchy('admin', 'editor')
      ac.registerHierarchy('editor', 'viewer')

      // Grant viewer permission
      ac.grant({ id: 'viewer', type: 'role' }, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // Grant editor permission
      ac.grant({ id: 'editor', type: 'role' }, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['write'],
      })

      // Admin should inherit both viewer and editor permissions
      const admin: Principal = { id: 'user-1', type: 'user', roles: ['admin'] }
      expect(ac.check(admin, { name: 'read' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
      expect(ac.check(admin, { name: 'write' }, { type: 'document', id: 'doc-1' }).allowed).toBe(true)
    })
  })

  describe('scope enforcement', () => {
    test('tenant scope restricts access to tenant resources', () => {
      const acWithScope = new AccessControl({ scope: { tenant: 'acme' } })
      const principal: Principal = { id: 'user-1', type: 'user' }

      acWithScope.grant(principal, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // Within scope - should be allowed
      expect(
        acWithScope.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }, { scope: { tenant: 'acme' } })
          .allowed
      ).toBe(true)

      // Outside scope - should be denied
      expect(
        acWithScope.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' }, { scope: { tenant: 'other' } })
          .allowed
      ).toBe(false)
    })

    test('organization scope narrows access', () => {
      const acWithScope = new AccessControl({ scope: { tenant: 'acme', organization: 'engineering' } })
      const principal: Principal = { id: 'user-1', type: 'user' }

      acWithScope.grant(principal, {
        effect: 'allow',
        resources: ['project:*'],
        actions: ['read'],
      })

      // Same org - allowed
      expect(
        acWithScope.check(
          principal,
          { name: 'read' },
          { type: 'project', id: 'proj-1' },
          { scope: { tenant: 'acme', organization: 'engineering' } }
        ).allowed
      ).toBe(true)

      // Different org - denied
      expect(
        acWithScope.check(
          principal,
          { name: 'read' },
          { type: 'project', id: 'proj-1' },
          { scope: { tenant: 'acme', organization: 'sales' } }
        ).allowed
      ).toBe(false)
    })

    test('team scope is most restrictive', () => {
      const acWithScope = new AccessControl({ scope: { tenant: 'acme', organization: 'eng', team: 'backend' } })
      const principal: Principal = { id: 'user-1', type: 'user' }

      acWithScope.grant(principal, {
        effect: 'allow',
        resources: ['repo:*'],
        actions: ['push'],
      })

      // Same team - allowed
      expect(
        acWithScope.check(
          principal,
          { name: 'push' },
          { type: 'repo', id: 'api' },
          { scope: { tenant: 'acme', organization: 'eng', team: 'backend' } }
        ).allowed
      ).toBe(true)

      // Different team - denied
      expect(
        acWithScope.check(
          principal,
          { name: 'push' },
          { type: 'repo', id: 'api' },
          { scope: { tenant: 'acme', organization: 'eng', team: 'frontend' } }
        ).allowed
      ).toBe(false)
    })
  })

  describe('batch checking', () => {
    test('checkBatch evaluates multiple requests at once', () => {
      const principal: Principal = { id: 'user-1', type: 'user' }

      ac.grant(principal, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      ac.grant(principal, {
        effect: 'deny',
        resources: ['document:secret'],
        actions: ['read'],
      })

      const results = ac.checkBatch({
        requests: [
          { principal, action: { name: 'read' }, resource: { type: 'document', id: 'doc-1' } },
          { principal, action: { name: 'read' }, resource: { type: 'document', id: 'secret' } },
          { principal, action: { name: 'write' }, resource: { type: 'document', id: 'doc-1' } },
        ],
      })

      expect(results.results.length).toBe(3)
      expect(results.results[0].allowed).toBe(true)
      expect(results.results[1].allowed).toBe(false)
      expect(results.results[2].allowed).toBe(false)
    })

    test('checkBatch handles different principals', () => {
      const user1: Principal = { id: 'user-1', type: 'user' }
      const user2: Principal = { id: 'user-2', type: 'user' }

      ac.grant(user1, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read', 'write'],
      })

      ac.grant(user2, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      const results = ac.checkBatch({
        requests: [
          { principal: user1, action: { name: 'write' }, resource: { type: 'document', id: 'doc-1' } },
          { principal: user2, action: { name: 'write' }, resource: { type: 'document', id: 'doc-1' } },
        ],
      })

      expect(results.results[0].allowed).toBe(true)
      expect(results.results[1].allowed).toBe(false)
    })
  })

  describe('getEffectivePermissions', () => {
    test('returns all direct and inherited permissions', () => {
      const user: Principal = { id: 'user-1', type: 'user', roles: ['editor'], groups: ['team-a'] }

      // Direct permission
      ac.grant(user, {
        effect: 'allow',
        resources: ['document:owned-*'],
        actions: ['*'],
      })

      // Role permission
      ac.grant({ id: 'editor', type: 'role' }, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read', 'write'],
      })

      // Group permission
      ac.grant({ id: 'team-a', type: 'group' }, {
        effect: 'allow',
        resources: ['project:team-a-*'],
        actions: ['read'],
      })

      const effective = ac.getEffectivePermissions(user)

      expect(effective.principal.id).toBe('user-1')
      expect(effective.permissions.length).toBeGreaterThan(0)
      expect(effective.inheritedFrom.length).toBe(2) // role and group
    })
  })

  describe('decision caching', () => {
    test('caches access decisions when enabled', () => {
      const cachedAc = new AccessControl({
        cache: { enabled: true, ttlMs: 1000, maxSize: 100 },
      })

      const principal: Principal = { id: 'user-1', type: 'user' }

      cachedAc.grant(principal, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // First check
      const decision1 = cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      expect(decision1.allowed).toBe(true)
      expect(decision1.cached).toBeUndefined()

      // Second check should be cached
      const decision2 = cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      expect(decision2.allowed).toBe(true)
      expect(decision2.cached).toBe(true)
    })

    test('cache respects TTL', async () => {
      const cachedAc = new AccessControl({
        cache: { enabled: true, ttlMs: 50, maxSize: 100 },
      })

      const principal: Principal = { id: 'user-1', type: 'user' }

      cachedAc.grant(principal, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // First check
      const decision1 = cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      expect(decision1.cached).toBeUndefined()

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Should not be cached after TTL
      const decision2 = cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      expect(decision2.cached).toBeUndefined()
    })

    test('clearCache removes cached decisions', () => {
      const cachedAc = new AccessControl({
        cache: { enabled: true, ttlMs: 10000, maxSize: 100 },
      })

      const principal: Principal = { id: 'user-1', type: 'user' }

      cachedAc.grant(principal, {
        effect: 'allow',
        resources: ['document:*'],
        actions: ['read'],
      })

      // Populate cache
      cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      const cached = cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      expect(cached.cached).toBe(true)

      // Clear cache
      cachedAc.clearCache()

      // Should not be cached after clear
      const notCached = cachedAc.check(principal, { name: 'read' }, { type: 'document', id: 'doc-1' })
      expect(notCached.cached).toBeUndefined()
    })
  })
})
