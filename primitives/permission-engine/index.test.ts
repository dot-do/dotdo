import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PermissionEngine,
  RoleManager,
  PolicyEvaluator,
  ConditionEvaluator,
  InheritanceResolver,
  PermissionCache,
  AuditLogger,
} from './index'
import type {
  Permission,
  Role,
  Policy,
  Subject,
  Resource,
  Action,
  Condition,
  AuthorizationResult,
  AuditLogEntry,
} from './types'

describe('PermissionEngine', () => {
  describe('Simple Permission Check', () => {
    it('should allow access when subject has matching permission', () => {
      const roles: Role[] = [
        {
          name: 'reader',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['reader'],
        attributes: {},
      }
      const resource: Resource = {
        type: 'document',
        id: 'doc-1',
        attributes: {},
      }

      const result = engine.check(subject, 'read', resource)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('ALLOWED_BY_PERMISSION')
    })

    it('should deny access when subject lacks permission', () => {
      const roles: Role[] = [
        {
          name: 'reader',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['reader'],
        attributes: {},
      }
      const resource: Resource = {
        type: 'document',
        id: 'doc-1',
        attributes: {},
      }

      const result = engine.check(subject, 'delete', resource)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('DENIED_NO_PERMISSION')
    })

    it('should deny access when subject has no roles', () => {
      const engine = new PermissionEngine({ roles: [] })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: [],
        attributes: {},
      }
      const resource: Resource = {
        type: 'document',
        id: 'doc-1',
        attributes: {},
      }

      const result = engine.check(subject, 'read', resource)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('DENIED_BY_DEFAULT')
    })
  })

  describe('Role-Based Access Control (RBAC)', () => {
    it('should grant access based on role permissions', () => {
      const roles: Role[] = [
        {
          name: 'editor',
          permissions: [
            { resource: 'document', actions: ['read', 'update'] },
            { resource: 'comment', actions: ['create', 'read'] },
          ],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['editor'],
        attributes: {},
      }

      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'update', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'delete', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(false)
      expect(engine.check(subject, 'create', { type: 'comment', id: 'c1', attributes: {} }).allowed).toBe(true)
    })

    it('should combine permissions from multiple roles', () => {
      const roles: Role[] = [
        {
          name: 'reader',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
        {
          name: 'commenter',
          permissions: [{ resource: 'comment', actions: ['create', 'read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['reader', 'commenter'],
        attributes: {},
      }

      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'create', { type: 'comment', id: 'c1', attributes: {} }).allowed).toBe(true)
    })

    it('should return matched role in result', () => {
      const roles: Role[] = [
        {
          name: 'admin',
          permissions: [{ resource: 'document', actions: ['manage'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'admin-1',
        type: 'user',
        roles: ['admin'],
        attributes: {},
      }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      const result = engine.check(subject, 'manage', resource)

      expect(result.allowed).toBe(true)
      expect(result.matchedRole).toBe('admin')
    })
  })

  describe('Role Inheritance', () => {
    it('should inherit permissions from parent roles', () => {
      const roles: Role[] = [
        {
          name: 'viewer',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
        {
          name: 'editor',
          permissions: [{ resource: 'document', actions: ['update'] }],
          inherits: ['viewer'],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['editor'],
        attributes: {},
      }

      // Should have both editor's update and inherited viewer's read
      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'update', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
    })

    it('should support multi-level inheritance', () => {
      const roles: Role[] = [
        {
          name: 'viewer',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
        {
          name: 'editor',
          permissions: [{ resource: 'document', actions: ['update'] }],
          inherits: ['viewer'],
        },
        {
          name: 'admin',
          permissions: [{ resource: 'document', actions: ['delete'] }],
          inherits: ['editor'],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'admin-1',
        type: 'user',
        roles: ['admin'],
        attributes: {},
      }

      // Admin should have all permissions through inheritance chain
      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'update', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'delete', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
    })

    it('should handle diamond inheritance (multiple inheritance paths)', () => {
      const roles: Role[] = [
        {
          name: 'base',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
        {
          name: 'branch-a',
          permissions: [{ resource: 'document', actions: ['update'] }],
          inherits: ['base'],
        },
        {
          name: 'branch-b',
          permissions: [{ resource: 'document', actions: ['delete'] }],
          inherits: ['base'],
        },
        {
          name: 'merged',
          permissions: [{ resource: 'document', actions: ['create'] }],
          inherits: ['branch-a', 'branch-b'],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['merged'],
        attributes: {},
      }

      // Should have all permissions without duplication issues
      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'update', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'delete', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'create', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
    })
  })

  describe('Attribute-Based Access Control (ABAC)', () => {
    it('should evaluate policy conditions', () => {
      const policies: Policy[] = [
        {
          id: 'premium-access',
          effect: 'allow',
          resources: ['premium-content'],
          actions: ['read'],
          conditions: [{ field: 'subject.attributes.plan', operator: 'eq', value: 'premium' }],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const premiumUser: Subject = {
        id: 'user-1',
        type: 'user',
        roles: [],
        attributes: { plan: 'premium' },
      }
      const freeUser: Subject = {
        id: 'user-2',
        type: 'user',
        roles: [],
        attributes: { plan: 'free' },
      }
      const resource: Resource = { type: 'premium-content', id: 'pc1', attributes: {} }

      expect(engine.check(premiumUser, 'read', resource).allowed).toBe(true)
      expect(engine.check(freeUser, 'read', resource).allowed).toBe(false)
    })

    it('should support resource attribute conditions', () => {
      const policies: Policy[] = [
        {
          id: 'department-access',
          effect: 'allow',
          resources: ['document'],
          actions: ['read'],
          conditions: [
            { field: 'resource.attributes.department', operator: 'eq', value: '${subject.attributes.department}' },
          ],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const salesUser: Subject = {
        id: 'user-1',
        type: 'user',
        roles: [],
        attributes: { department: 'sales' },
      }
      const salesDoc: Resource = {
        type: 'document',
        id: 'd1',
        attributes: { department: 'sales' },
      }
      const engineeringDoc: Resource = {
        type: 'document',
        id: 'd2',
        attributes: { department: 'engineering' },
      }

      expect(engine.check(salesUser, 'read', salesDoc).allowed).toBe(true)
      expect(engine.check(salesUser, 'read', engineeringDoc).allowed).toBe(false)
    })

    it('should return matched policy in result', () => {
      const policies: Policy[] = [
        {
          id: 'public-read',
          name: 'Public Read Access',
          effect: 'allow',
          resources: ['public-document'],
          actions: ['read'],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
      const resource: Resource = { type: 'public-document', id: 'pd1', attributes: {} }

      const result = engine.check(subject, 'read', resource)

      expect(result.allowed).toBe(true)
      expect(result.matchedPolicy?.id).toBe('public-read')
    })
  })

  describe('Resource Ownership', () => {
    it('should allow owner full access to their resources', () => {
      const roles: Role[] = [
        {
          name: 'user',
          permissions: [
            {
              resource: 'document',
              actions: ['read', 'update', 'delete'],
              conditions: [{ field: 'resource.owner', operator: 'isOwner', value: null }],
            },
          ],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const owner: Subject = { id: 'user-1', type: 'user', roles: ['user'], attributes: {} }
      const ownedResource: Resource = { type: 'document', id: 'd1', owner: 'user-1', attributes: {} }
      const otherResource: Resource = { type: 'document', id: 'd2', owner: 'user-2', attributes: {} }

      expect(engine.check(owner, 'update', ownedResource).allowed).toBe(true)
      expect(engine.check(owner, 'delete', ownedResource).allowed).toBe(true)
      expect(engine.check(owner, 'update', otherResource).allowed).toBe(false)
    })

    it('should return ownership reason when owner accesses resource', () => {
      const roles: Role[] = [
        {
          name: 'user',
          permissions: [
            {
              resource: 'document',
              actions: ['*'],
              conditions: [{ field: 'resource.owner', operator: 'isOwner', value: null }],
            },
          ],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const owner: Subject = { id: 'user-1', type: 'user', roles: ['user'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', owner: 'user-1', attributes: {} }

      const result = engine.check(owner, 'manage', resource)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('ALLOWED_BY_OWNERSHIP')
    })
  })

  describe('Wildcard Permissions', () => {
    it('should match wildcard resource type', () => {
      const roles: Role[] = [
        {
          name: 'super-admin',
          permissions: [{ resource: '*', actions: ['*'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'admin-1', type: 'user', roles: ['super-admin'], attributes: {} }

      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'delete', { type: 'project', id: 'p1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'manage', { type: 'user', id: 'u1', attributes: {} }).allowed).toBe(true)
    })

    it('should match wildcard action', () => {
      const roles: Role[] = [
        {
          name: 'document-admin',
          permissions: [{ resource: 'document', actions: ['*'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['document-admin'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      expect(engine.check(subject, 'create', resource).allowed).toBe(true)
      expect(engine.check(subject, 'read', resource).allowed).toBe(true)
      expect(engine.check(subject, 'update', resource).allowed).toBe(true)
      expect(engine.check(subject, 'delete', resource).allowed).toBe(true)
      expect(engine.check(subject, 'manage', resource).allowed).toBe(true)
    })

    it('should return wildcard reason for wildcard matches', () => {
      const roles: Role[] = [
        {
          name: 'admin',
          permissions: [{ resource: '*', actions: ['*'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'admin-1', type: 'user', roles: ['admin'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      const result = engine.check(subject, 'read', resource)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('ALLOWED_BY_WILDCARD')
    })
  })

  describe('Deny Overrides Allow', () => {
    it('should deny access when explicit deny policy exists', () => {
      const roles: Role[] = [
        {
          name: 'editor',
          permissions: [{ resource: 'document', actions: ['read', 'update', 'delete'] }],
        },
      ]
      const policies: Policy[] = [
        {
          id: 'no-delete-archived',
          effect: 'deny',
          resources: ['document'],
          actions: ['delete'],
          conditions: [{ field: 'resource.attributes.archived', operator: 'eq', value: true }],
          priority: 0, // Higher priority (lower number)
        },
      ]
      const engine = new PermissionEngine({ roles, policies })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['editor'], attributes: {} }
      const archivedDoc: Resource = { type: 'document', id: 'd1', attributes: { archived: true } }
      const activeDoc: Resource = { type: 'document', id: 'd2', attributes: { archived: false } }

      expect(engine.check(subject, 'delete', archivedDoc).allowed).toBe(false)
      expect(engine.check(subject, 'delete', archivedDoc).reason).toBe('DENIED_BY_POLICY')
      expect(engine.check(subject, 'delete', activeDoc).allowed).toBe(true)
    })

    it('should deny overriding wildcard allow', () => {
      const roles: Role[] = [
        {
          name: 'admin',
          permissions: [{ resource: '*', actions: ['*'] }],
        },
      ]
      const policies: Policy[] = [
        {
          id: 'protect-system-users',
          effect: 'deny',
          resources: ['user'],
          actions: ['delete'],
          conditions: [{ field: 'resource.attributes.system', operator: 'eq', value: true }],
        },
      ]
      const engine = new PermissionEngine({ roles, policies })

      const admin: Subject = { id: 'admin-1', type: 'user', roles: ['admin'], attributes: {} }
      const systemUser: Resource = { type: 'user', id: 'system-1', attributes: { system: true } }
      const regularUser: Resource = { type: 'user', id: 'user-1', attributes: { system: false } }

      expect(engine.check(admin, 'delete', systemUser).allowed).toBe(false)
      expect(engine.check(admin, 'delete', regularUser).allowed).toBe(true)
    })
  })

  describe('Condition Evaluation', () => {
    it('should evaluate equals condition', () => {
      const policies: Policy[] = [
        {
          id: 'status-check',
          effect: 'allow',
          resources: ['document'],
          actions: ['read'],
          conditions: [{ field: 'resource.attributes.status', operator: 'eq', value: 'published' }],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }

      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: { status: 'published' } }).allowed).toBe(true)
      expect(engine.check(subject, 'read', { type: 'document', id: 'd2', attributes: { status: 'draft' } }).allowed).toBe(false)
    })

    it('should evaluate greater than condition', () => {
      const policies: Policy[] = [
        {
          id: 'high-value-access',
          effect: 'allow',
          resources: ['premium-feature'],
          actions: ['*'],
          conditions: [{ field: 'subject.attributes.accountValue', operator: 'gt', value: 1000 }],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const highValue: Subject = { id: 'user-1', type: 'user', roles: [], attributes: { accountValue: 5000 } }
      const lowValue: Subject = { id: 'user-2', type: 'user', roles: [], attributes: { accountValue: 500 } }
      const resource: Resource = { type: 'premium-feature', id: 'pf1', attributes: {} }

      expect(engine.check(highValue, 'read', resource).allowed).toBe(true)
      expect(engine.check(lowValue, 'read', resource).allowed).toBe(false)
    })

    it('should evaluate in condition', () => {
      const policies: Policy[] = [
        {
          id: 'region-access',
          effect: 'allow',
          resources: ['content'],
          actions: ['read'],
          conditions: [{ field: 'subject.attributes.region', operator: 'in', value: ['US', 'CA', 'UK'] }],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const usUser: Subject = { id: 'user-1', type: 'user', roles: [], attributes: { region: 'US' } }
      const euUser: Subject = { id: 'user-2', type: 'user', roles: [], attributes: { region: 'DE' } }
      const resource: Resource = { type: 'content', id: 'c1', attributes: {} }

      expect(engine.check(usUser, 'read', resource).allowed).toBe(true)
      expect(engine.check(euUser, 'read', resource).allowed).toBe(false)
    })

    it('should evaluate contains condition', () => {
      const policies: Policy[] = [
        {
          id: 'email-domain-access',
          effect: 'allow',
          resources: ['internal-doc'],
          actions: ['read'],
          conditions: [{ field: 'subject.attributes.email', operator: 'contains', value: '@company.com' }],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const internal: Subject = { id: 'user-1', type: 'user', roles: [], attributes: { email: 'john@company.com' } }
      const external: Subject = { id: 'user-2', type: 'user', roles: [], attributes: { email: 'john@gmail.com' } }
      const resource: Resource = { type: 'internal-doc', id: 'id1', attributes: {} }

      expect(engine.check(internal, 'read', resource).allowed).toBe(true)
      expect(engine.check(external, 'read', resource).allowed).toBe(false)
    })

    it('should evaluate multiple conditions with AND logic', () => {
      const policies: Policy[] = [
        {
          id: 'multi-condition',
          effect: 'allow',
          resources: ['sensitive-data'],
          actions: ['read'],
          conditions: [
            { field: 'subject.attributes.clearanceLevel', operator: 'gte', value: 3 },
            { field: 'subject.attributes.department', operator: 'eq', value: 'security' },
          ],
        },
      ]
      const engine = new PermissionEngine({ policies })

      const cleared: Subject = { id: 'user-1', type: 'user', roles: [], attributes: { clearanceLevel: 5, department: 'security' } }
      const lowClearance: Subject = { id: 'user-2', type: 'user', roles: [], attributes: { clearanceLevel: 2, department: 'security' } }
      const wrongDept: Subject = { id: 'user-3', type: 'user', roles: [], attributes: { clearanceLevel: 5, department: 'engineering' } }
      const resource: Resource = { type: 'sensitive-data', id: 'sd1', attributes: {} }

      expect(engine.check(cleared, 'read', resource).allowed).toBe(true)
      expect(engine.check(lowClearance, 'read', resource).allowed).toBe(false)
      expect(engine.check(wrongDept, 'read', resource).allowed).toBe(false)
    })
  })

  describe('Multiple Roles', () => {
    it('should combine permissions from all assigned roles', () => {
      const roles: Role[] = [
        {
          name: 'document-reader',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
        {
          name: 'comment-writer',
          permissions: [{ resource: 'comment', actions: ['create', 'read'] }],
        },
        {
          name: 'project-viewer',
          permissions: [{ resource: 'project', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        roles: ['document-reader', 'comment-writer', 'project-viewer'],
        attributes: {},
      }

      expect(engine.check(subject, 'read', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'create', { type: 'comment', id: 'c1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'read', { type: 'project', id: 'p1', attributes: {} }).allowed).toBe(true)
      expect(engine.check(subject, 'delete', { type: 'document', id: 'd1', attributes: {} }).allowed).toBe(false)
    })
  })

  describe('Check All Actions', () => {
    it('should check multiple actions at once', () => {
      const roles: Role[] = [
        {
          name: 'editor',
          permissions: [{ resource: 'document', actions: ['read', 'update'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['editor'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      const result = engine.checkAll(subject, ['read', 'update'], resource)
      expect(result.allowed).toBe(true)

      const partialResult = engine.checkAll(subject, ['read', 'delete'], resource)
      expect(partialResult.allowed).toBe(false)
    })

    it('should return all failed actions in result', () => {
      const roles: Role[] = [
        {
          name: 'viewer',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['viewer'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      const result = engine.checkAll(subject, ['read', 'update', 'delete'], resource)

      expect(result.allowed).toBe(false)
      expect(result.context?.failedActions).toContain('update')
      expect(result.context?.failedActions).toContain('delete')
      expect(result.context?.failedActions).not.toContain('read')
    })
  })

  describe('Grant and Revoke Permissions', () => {
    it('should grant permission to role dynamically', () => {
      const roles: Role[] = [
        {
          name: 'user',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['user'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      expect(engine.check(subject, 'update', resource).allowed).toBe(false)

      engine.grant('user', { resource: 'document', actions: ['update'] })

      expect(engine.check(subject, 'update', resource).allowed).toBe(true)
    })

    it('should revoke permission from role', () => {
      const roles: Role[] = [
        {
          name: 'editor',
          permissions: [{ resource: 'document', actions: ['read', 'update', 'delete'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['editor'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      expect(engine.check(subject, 'delete', resource).allowed).toBe(true)

      engine.revoke('editor', { resource: 'document', actions: ['delete'] })

      expect(engine.check(subject, 'delete', resource).allowed).toBe(false)
      expect(engine.check(subject, 'read', resource).allowed).toBe(true)
      expect(engine.check(subject, 'update', resource).allowed).toBe(true)
    })
  })

  describe('Assign and Remove Roles', () => {
    it('should assign role to subject', () => {
      const roles: Role[] = [
        {
          name: 'admin',
          permissions: [{ resource: '*', actions: ['*'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      expect(engine.check(subject, 'delete', resource).allowed).toBe(false)

      const updatedSubject = engine.assignRole(subject, 'admin')

      expect(engine.check(updatedSubject, 'delete', resource).allowed).toBe(true)
      expect(updatedSubject.roles).toContain('admin')
    })

    it('should remove role from subject', () => {
      const roles: Role[] = [
        {
          name: 'admin',
          permissions: [{ resource: '*', actions: ['*'] }],
        },
      ]
      const engine = new PermissionEngine({ roles })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['admin'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      expect(engine.check(subject, 'delete', resource).allowed).toBe(true)

      const updatedSubject = engine.removeRole(subject, 'admin')

      expect(engine.check(updatedSubject, 'delete', resource).allowed).toBe(false)
      expect(updatedSubject.roles).not.toContain('admin')
    })

    it('should not duplicate roles when assigning', () => {
      const engine = new PermissionEngine({ roles: [] })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['editor'], attributes: {} }

      const updated = engine.assignRole(subject, 'editor')

      expect(updated.roles.filter((r) => r === 'editor')).toHaveLength(1)
    })
  })

  describe('Permission Caching', () => {
    it('should cache permission decisions', () => {
      const roles: Role[] = [
        {
          name: 'reader',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles, enableCache: true, cacheTtl: 60000 })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['reader'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      // First check
      const result1 = engine.check(subject, 'read', resource)
      // Second check should hit cache
      const result2 = engine.check(subject, 'read', resource)

      expect(result1.allowed).toBe(result2.allowed)
      expect(engine.getCacheStats().hits).toBeGreaterThan(0)
    })

    it('should invalidate cache when permissions change', () => {
      const roles: Role[] = [
        {
          name: 'user',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles, enableCache: true })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['user'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      // Populate cache
      engine.check(subject, 'update', resource)
      expect(engine.check(subject, 'update', resource).allowed).toBe(false)

      // Grant new permission (should invalidate cache)
      engine.grant('user', { resource: 'document', actions: ['update'] })

      // Should reflect new permission
      expect(engine.check(subject, 'update', resource).allowed).toBe(true)
    })
  })

  describe('Authorization Audit', () => {
    it('should log authorization decisions', () => {
      const logEntries: AuditLogEntry[] = []
      const mockLogger = {
        log: (entry: AuditLogEntry) => logEntries.push(entry),
      }

      const roles: Role[] = [
        {
          name: 'reader',
          permissions: [{ resource: 'document', actions: ['read'] }],
        },
      ]
      const engine = new PermissionEngine({ roles, enableAudit: true, auditLogger: mockLogger })

      const subject: Subject = { id: 'user-1', type: 'user', roles: ['reader'], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      engine.check(subject, 'read', resource)

      expect(logEntries).toHaveLength(1)
      expect(logEntries[0].subject.id).toBe('user-1')
      expect(logEntries[0].action).toBe('read')
      expect(logEntries[0].resource.id).toBe('d1')
      expect(logEntries[0].result.allowed).toBe(true)
    })

    it('should include timestamp in audit log', () => {
      const logEntries: AuditLogEntry[] = []
      const mockLogger = {
        log: (entry: AuditLogEntry) => logEntries.push(entry),
      }

      const engine = new PermissionEngine({ enableAudit: true, auditLogger: mockLogger })

      const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      const beforeCheck = new Date().toISOString()
      engine.check(subject, 'read', resource)
      const afterCheck = new Date().toISOString()

      expect(logEntries[0].timestamp).toBeDefined()
      expect(logEntries[0].timestamp >= beforeCheck).toBe(true)
      expect(logEntries[0].timestamp <= afterCheck).toBe(true)
    })

    it('should log denied attempts', () => {
      const logEntries: AuditLogEntry[] = []
      const mockLogger = {
        log: (entry: AuditLogEntry) => logEntries.push(entry),
      }

      const engine = new PermissionEngine({ enableAudit: true, auditLogger: mockLogger })

      const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
      const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

      engine.check(subject, 'delete', resource)

      expect(logEntries[0].result.allowed).toBe(false)
      expect(logEntries[0].result.reason).toBe('DENIED_BY_DEFAULT')
    })
  })
})

describe('RoleManager', () => {
  it('should store and retrieve roles', () => {
    const manager = new RoleManager()
    const role: Role = {
      name: 'editor',
      permissions: [{ resource: 'document', actions: ['read', 'update'] }],
    }

    manager.addRole(role)

    expect(manager.getRole('editor')).toEqual(role)
  })

  it('should list all roles', () => {
    const manager = new RoleManager()
    manager.addRole({ name: 'admin', permissions: [] })
    manager.addRole({ name: 'editor', permissions: [] })
    manager.addRole({ name: 'viewer', permissions: [] })

    const roles = manager.getAllRoles()

    expect(roles).toHaveLength(3)
    expect(roles.map((r) => r.name)).toContain('admin')
    expect(roles.map((r) => r.name)).toContain('editor')
    expect(roles.map((r) => r.name)).toContain('viewer')
  })

  it('should delete roles', () => {
    const manager = new RoleManager()
    manager.addRole({ name: 'temp-role', permissions: [] })

    expect(manager.getRole('temp-role')).toBeDefined()

    manager.deleteRole('temp-role')

    expect(manager.getRole('temp-role')).toBeUndefined()
  })

  it('should update existing role', () => {
    const manager = new RoleManager()
    manager.addRole({ name: 'editor', permissions: [{ resource: 'document', actions: ['read'] }] })

    manager.updateRole('editor', { permissions: [{ resource: 'document', actions: ['read', 'update'] }] })

    const role = manager.getRole('editor')
    expect(role?.permissions[0].actions).toContain('update')
  })
})

describe('PolicyEvaluator', () => {
  it('should evaluate allow policy', () => {
    const evaluator = new PolicyEvaluator()
    const policy: Policy = {
      id: 'allow-read',
      effect: 'allow',
      resources: ['document'],
      actions: ['read'],
    }

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

    const result = evaluator.evaluate(policy, subject, 'read', resource)

    expect(result.matches).toBe(true)
    expect(result.effect).toBe('allow')
  })

  it('should evaluate deny policy', () => {
    const evaluator = new PolicyEvaluator()
    const policy: Policy = {
      id: 'deny-delete',
      effect: 'deny',
      resources: ['document'],
      actions: ['delete'],
    }

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

    const result = evaluator.evaluate(policy, subject, 'delete', resource)

    expect(result.matches).toBe(true)
    expect(result.effect).toBe('deny')
  })

  it('should not match when resource type differs', () => {
    const evaluator = new PolicyEvaluator()
    const policy: Policy = {
      id: 'document-policy',
      effect: 'allow',
      resources: ['document'],
      actions: ['read'],
    }

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'project', id: 'p1', attributes: {} }

    const result = evaluator.evaluate(policy, subject, 'read', resource)

    expect(result.matches).toBe(false)
  })

  it('should not match when action differs', () => {
    const evaluator = new PolicyEvaluator()
    const policy: Policy = {
      id: 'read-only',
      effect: 'allow',
      resources: ['document'],
      actions: ['read'],
    }

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

    const result = evaluator.evaluate(policy, subject, 'delete', resource)

    expect(result.matches).toBe(false)
  })

  it('should skip disabled policies', () => {
    const evaluator = new PolicyEvaluator()
    const policy: Policy = {
      id: 'disabled-policy',
      effect: 'allow',
      resources: ['document'],
      actions: ['read'],
      enabled: false,
    }

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }

    const result = evaluator.evaluate(policy, subject, 'read', resource)

    expect(result.matches).toBe(false)
  })
})

describe('ConditionEvaluator', () => {
  let evaluator: ConditionEvaluator

  beforeEach(() => {
    evaluator = new ConditionEvaluator()
  })

  describe('Operators', () => {
    it('should evaluate eq operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'eq', value: 1 }, { a: 1 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'eq', value: 1 }, { a: 2 })).toBe(false)
    })

    it('should evaluate neq operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'neq', value: 1 }, { a: 2 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'neq', value: 1 }, { a: 1 })).toBe(false)
    })

    it('should evaluate gt operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'gt', value: 5 }, { a: 10 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'gt', value: 5 }, { a: 3 })).toBe(false)
    })

    it('should evaluate gte operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'gte', value: 5 }, { a: 5 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'gte', value: 5 }, { a: 4 })).toBe(false)
    })

    it('should evaluate lt operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'lt', value: 5 }, { a: 3 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'lt', value: 5 }, { a: 10 })).toBe(false)
    })

    it('should evaluate lte operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'lte', value: 5 }, { a: 5 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'lte', value: 5 }, { a: 6 })).toBe(false)
    })

    it('should evaluate in operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'in', value: [1, 2, 3] }, { a: 2 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'in', value: [1, 2, 3] }, { a: 5 })).toBe(false)
    })

    it('should evaluate nin operator', () => {
      expect(evaluator.evaluate({ field: 'a', operator: 'nin', value: [1, 2, 3] }, { a: 5 })).toBe(true)
      expect(evaluator.evaluate({ field: 'a', operator: 'nin', value: [1, 2, 3] }, { a: 2 })).toBe(false)
    })

    it('should evaluate contains operator for strings', () => {
      expect(evaluator.evaluate({ field: 'email', operator: 'contains', value: '@test.com' }, { email: 'user@test.com' })).toBe(true)
      expect(evaluator.evaluate({ field: 'email', operator: 'contains', value: '@test.com' }, { email: 'user@other.com' })).toBe(false)
    })

    it('should evaluate contains operator for arrays', () => {
      expect(evaluator.evaluate({ field: 'tags', operator: 'contains', value: 'important' }, { tags: ['urgent', 'important'] })).toBe(true)
      expect(evaluator.evaluate({ field: 'tags', operator: 'contains', value: 'important' }, { tags: ['normal'] })).toBe(false)
    })

    it('should evaluate startsWith operator', () => {
      expect(evaluator.evaluate({ field: 'name', operator: 'startsWith', value: 'John' }, { name: 'John Doe' })).toBe(true)
      expect(evaluator.evaluate({ field: 'name', operator: 'startsWith', value: 'John' }, { name: 'Jane Doe' })).toBe(false)
    })

    it('should evaluate endsWith operator', () => {
      expect(evaluator.evaluate({ field: 'file', operator: 'endsWith', value: '.txt' }, { file: 'document.txt' })).toBe(true)
      expect(evaluator.evaluate({ field: 'file', operator: 'endsWith', value: '.txt' }, { file: 'document.pdf' })).toBe(false)
    })

    it('should evaluate matches operator (regex)', () => {
      expect(evaluator.evaluate({ field: 'code', operator: 'matches', value: '^[A-Z]{3}$' }, { code: 'ABC' })).toBe(true)
      expect(evaluator.evaluate({ field: 'code', operator: 'matches', value: '^[A-Z]{3}$' }, { code: 'abcd' })).toBe(false)
    })

    it('should evaluate exists operator', () => {
      expect(evaluator.evaluate({ field: 'optional', operator: 'exists', value: true }, { optional: 'value' })).toBe(true)
      expect(evaluator.evaluate({ field: 'optional', operator: 'exists', value: true }, {})).toBe(false)
      expect(evaluator.evaluate({ field: 'optional', operator: 'exists', value: false }, {})).toBe(true)
    })
  })

  describe('Nested Fields', () => {
    it('should access nested fields with dot notation', () => {
      const context = {
        user: {
          profile: {
            age: 25,
          },
        },
      }

      expect(evaluator.evaluate({ field: 'user.profile.age', operator: 'gte', value: 18 }, context)).toBe(true)
    })

    it('should return false for missing nested fields', () => {
      expect(evaluator.evaluate({ field: 'user.profile.age', operator: 'eq', value: 25 }, { user: {} })).toBe(false)
    })
  })
})

describe('InheritanceResolver', () => {
  it('should resolve single level inheritance', () => {
    const roles: Role[] = [
      { name: 'base', permissions: [{ resource: 'a', actions: ['read'] }] },
      { name: 'child', permissions: [{ resource: 'b', actions: ['read'] }], inherits: ['base'] },
    ]
    const resolver = new InheritanceResolver(roles)

    const resolved = resolver.resolvePermissions('child')

    expect(resolved).toHaveLength(2)
    expect(resolved.some((p) => p.resource === 'a')).toBe(true)
    expect(resolved.some((p) => p.resource === 'b')).toBe(true)
  })

  it('should resolve multi-level inheritance', () => {
    const roles: Role[] = [
      { name: 'level0', permissions: [{ resource: 'a', actions: ['read'] }] },
      { name: 'level1', permissions: [{ resource: 'b', actions: ['read'] }], inherits: ['level0'] },
      { name: 'level2', permissions: [{ resource: 'c', actions: ['read'] }], inherits: ['level1'] },
    ]
    const resolver = new InheritanceResolver(roles)

    const resolved = resolver.resolvePermissions('level2')

    expect(resolved).toHaveLength(3)
  })

  it('should handle circular inheritance gracefully', () => {
    const roles: Role[] = [
      { name: 'a', permissions: [{ resource: 'x', actions: ['read'] }], inherits: ['b'] },
      { name: 'b', permissions: [{ resource: 'y', actions: ['read'] }], inherits: ['a'] },
    ]
    const resolver = new InheritanceResolver(roles)

    // Should not infinite loop
    const resolved = resolver.resolvePermissions('a')

    expect(resolved.length).toBeGreaterThan(0)
  })

  it('should return empty for non-existent role', () => {
    const resolver = new InheritanceResolver([])

    const resolved = resolver.resolvePermissions('non-existent')

    expect(resolved).toHaveLength(0)
  })
})

describe('PermissionCache', () => {
  it('should store and retrieve cached decisions', () => {
    const cache = new PermissionCache({ ttl: 60000 })

    const result: AuthorizationResult = { allowed: true, reason: 'ALLOWED_BY_PERMISSION' }
    cache.set('user-1', 'read', 'document:d1', result)

    expect(cache.get('user-1', 'read', 'document:d1')).toEqual(result)
  })

  it('should return undefined for cache miss', () => {
    const cache = new PermissionCache({ ttl: 60000 })

    expect(cache.get('user-1', 'read', 'document:d1')).toBeUndefined()
  })

  it('should expire entries after TTL', async () => {
    const cache = new PermissionCache({ ttl: 50 }) // 50ms TTL

    const result: AuthorizationResult = { allowed: true, reason: 'ALLOWED_BY_PERMISSION' }
    cache.set('user-1', 'read', 'document:d1', result)

    expect(cache.get('user-1', 'read', 'document:d1')).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(cache.get('user-1', 'read', 'document:d1')).toBeUndefined()
  })

  it('should clear all entries', () => {
    const cache = new PermissionCache({ ttl: 60000 })

    cache.set('user-1', 'read', 'doc:d1', { allowed: true, reason: 'ALLOWED_BY_PERMISSION' })
    cache.set('user-2', 'write', 'doc:d2', { allowed: false, reason: 'DENIED_NO_PERMISSION' })

    cache.clear()

    expect(cache.get('user-1', 'read', 'doc:d1')).toBeUndefined()
    expect(cache.get('user-2', 'write', 'doc:d2')).toBeUndefined()
  })

  it('should track cache statistics', () => {
    const cache = new PermissionCache({ ttl: 60000 })

    cache.set('user-1', 'read', 'doc:d1', { allowed: true, reason: 'ALLOWED_BY_PERMISSION' })

    cache.get('user-1', 'read', 'doc:d1') // hit
    cache.get('user-1', 'read', 'doc:d1') // hit
    cache.get('user-2', 'read', 'doc:d1') // miss

    const stats = cache.getStats()

    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
  })
})

describe('AuditLogger', () => {
  it('should create audit log entries', () => {
    const entries: AuditLogEntry[] = []
    const logger = new AuditLogger({
      handler: (entry) => entries.push(entry),
    })

    const subject: Subject = { id: 'user-1', type: 'user', roles: ['admin'], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }
    const result: AuthorizationResult = { allowed: true, reason: 'ALLOWED_BY_PERMISSION' }

    logger.log(subject, 'read', resource, result)

    expect(entries).toHaveLength(1)
    expect(entries[0].subject).toEqual(subject)
    expect(entries[0].action).toBe('read')
    expect(entries[0].resource).toEqual(resource)
    expect(entries[0].result).toEqual(result)
    expect(entries[0].timestamp).toBeDefined()
    expect(entries[0].id).toBeDefined()
  })

  it('should generate unique IDs for each entry', () => {
    const entries: AuditLogEntry[] = []
    const logger = new AuditLogger({
      handler: (entry) => entries.push(entry),
    })

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }
    const result: AuthorizationResult = { allowed: true, reason: 'ALLOWED_BY_PERMISSION' }

    logger.log(subject, 'read', resource, result)
    logger.log(subject, 'read', resource, result)
    logger.log(subject, 'read', resource, result)

    const ids = entries.map((e) => e.id)
    const uniqueIds = new Set(ids)

    expect(uniqueIds.size).toBe(3)
  })

  it('should support async handlers', async () => {
    const entries: AuditLogEntry[] = []
    const logger = new AuditLogger({
      handler: async (entry) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        entries.push(entry)
      },
    })

    const subject: Subject = { id: 'user-1', type: 'user', roles: [], attributes: {} }
    const resource: Resource = { type: 'document', id: 'd1', attributes: {} }
    const result: AuthorizationResult = { allowed: true, reason: 'ALLOWED_BY_PERMISSION' }

    await logger.log(subject, 'read', resource, result)

    expect(entries).toHaveLength(1)
  })
})
