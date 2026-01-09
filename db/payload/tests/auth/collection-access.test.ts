/**
 * Collection Access Control Tests (RED Phase)
 *
 * These tests define the contract for collection-level access control generation.
 * The collection access system bridges Better Auth roles and permissions to
 * Payload CMS access control functions.
 *
 * The createCollectionAccess function should:
 * - Generate access functions (create, read, update, delete) for collections
 * - Return boolean or query filter (Where clause) from access functions
 * - Support role-based access with admin, user, and custom roles
 * - Support field-level access restrictions by role
 * - Support organization scoping via activeOrganizationId
 * - Support document ownership via createdBy field matching
 * - Support custom permission configurations
 *
 * Reference: dotdo-xxx - Collection Access Control RED Tests
 */

import { describe, it, expect, vi } from 'vitest'

// ============================================================================
// Type definitions for the collection access module (to be implemented)
// ============================================================================

/**
 * PayloadRequest type for access control functions.
 * Contains user information and request context.
 */
export interface PayloadRequest {
  user?: {
    id: string
    role?: 'admin' | 'user' | string | null
    collection: string
    activeOrganizationId?: string | null
    organizationRole?: {
      organizationId: string
      role: 'member' | 'admin' | 'owner'
    } | null
    isSuperAdmin?: boolean
  } | null
}

/**
 * Where clause for filtering documents.
 * Used to restrict access to specific documents.
 */
export interface Where {
  [field: string]: {
    equals?: string | number | boolean
    not_equals?: string | number | boolean
    in?: (string | number)[]
    not_in?: (string | number)[]
    exists?: boolean
  } | Where
  and?: Where[]
  or?: Where[]
}

/**
 * Access function result type.
 * Returns true for full access, false for no access, or Where for filtered access.
 */
export type AccessResult = boolean | Where

/**
 * Access function signature for Payload CMS.
 */
export type AccessFunction = (args: {
  req: PayloadRequest
  id?: string
  data?: Record<string, unknown>
}) => AccessResult | Promise<AccessResult>

/**
 * Generated access control object for a collection.
 */
export interface CollectionAccessFunctions {
  create: AccessFunction
  read: AccessFunction
  update: AccessFunction
  delete: AccessFunction
}

/**
 * Permission level for an operation.
 * - true: Full access
 * - false: No access
 * - 'own': Access to own documents only (createdBy match)
 * - 'org': Access to documents in same organization
 */
export type PermissionLevel = boolean | 'own' | 'org'

/**
 * Role-based permission configuration.
 */
export interface RolePermissions {
  create?: PermissionLevel
  read?: PermissionLevel
  update?: PermissionLevel
  delete?: PermissionLevel
}

/**
 * Field-level access configuration.
 */
export interface FieldAccess {
  /** Roles that can read this field */
  read?: string[]
  /** Roles that can update this field */
  update?: string[]
  /** Hide field entirely from non-allowed roles */
  hidden?: boolean
}

/**
 * Collection access configuration.
 */
export interface CollectionAccessConfig {
  /** Collection slug */
  collection: string
  /** Role-based permissions */
  roles?: Record<string, RolePermissions>
  /** Field-level access restrictions */
  fields?: Record<string, FieldAccess>
  /** Field that identifies document owner (default: 'createdBy') */
  ownerField?: string
  /** Field that identifies document organization (default: 'organizationId') */
  orgField?: string
  /** Allow super-admins to bypass all restrictions */
  superAdminBypass?: boolean
  /** Custom access function that overrides role-based logic */
  customAccess?: AccessFunction
}

/**
 * Result from generateAccessFunctions.
 */
export interface GeneratedAccessFunctions extends CollectionAccessFunctions {
  /** Field-level access functions */
  fields?: Record<string, {
    read: AccessFunction
    update: AccessFunction
  }>
}

// ============================================================================
// Functions to be implemented (stubs for type checking)
// ============================================================================

/**
 * Creates Payload-compatible access control functions for a collection.
 */
declare function createCollectionAccess(
  config: CollectionAccessConfig
): CollectionAccessFunctions

/**
 * Generates access functions with field-level controls.
 */
declare function generateAccessFunctions(
  config: CollectionAccessConfig
): GeneratedAccessFunctions

/**
 * Checks if user has a specific permission level.
 */
declare function checkPermission(
  user: PayloadRequest['user'],
  permission: PermissionLevel,
  context: {
    documentOwnerId?: string
    documentOrgId?: string
  }
): boolean | Where

// ============================================================================
// Import the functions under test (will fail until implemented)
// ============================================================================

import {
  createCollectionAccess,
  generateAccessFunctions,
  checkPermission,
} from '../../auth/collection-access'

// ============================================================================
// Mock helpers
// ============================================================================

function createMockRequest(
  userOverrides: Partial<NonNullable<PayloadRequest['user']>> = {}
): PayloadRequest {
  return {
    user: {
      id: 'user-001',
      role: 'user',
      collection: 'users',
      activeOrganizationId: null,
      organizationRole: null,
      isSuperAdmin: false,
      ...userOverrides,
    },
  }
}

function createAdminRequest(
  overrides: Partial<NonNullable<PayloadRequest['user']>> = {}
): PayloadRequest {
  return createMockRequest({
    id: 'admin-001',
    role: 'admin',
    ...overrides,
  })
}

function createSuperAdminRequest(
  overrides: Partial<NonNullable<PayloadRequest['user']>> = {}
): PayloadRequest {
  return createMockRequest({
    id: 'superadmin-001',
    role: 'admin',
    isSuperAdmin: true,
    ...overrides,
  })
}

function createOrgUserRequest(
  orgId: string,
  orgRole: 'member' | 'admin' | 'owner' = 'member',
  overrides: Partial<NonNullable<PayloadRequest['user']>> = {}
): PayloadRequest {
  return createMockRequest({
    activeOrganizationId: orgId,
    organizationRole: {
      organizationId: orgId,
      role: orgRole,
    },
    ...overrides,
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('Collection Access', () => {
  describe('createCollectionAccess', () => {
    it('should return object with create, read, update, delete functions', () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          admin: { create: true, read: true, update: true, delete: true },
          user: { create: true, read: true, update: 'own', delete: false },
        },
      })

      expect(access).toBeDefined()
      expect(typeof access.create).toBe('function')
      expect(typeof access.read).toBe('function')
      expect(typeof access.update).toBe('function')
      expect(typeof access.delete).toBe('function')
    })

    it('should grant full access to admin role', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          admin: { create: true, read: true, update: true, delete: true },
          user: { create: true, read: 'own', update: 'own', delete: false },
        },
      })

      const adminReq = createAdminRequest()

      expect(await access.create({ req: adminReq })).toBe(true)
      expect(await access.read({ req: adminReq })).toBe(true)
      expect(await access.update({ req: adminReq })).toBe(true)
      expect(await access.delete({ req: adminReq })).toBe(true)
    })

    it('should restrict user to own documents', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          user: { read: 'own', update: 'own' },
        },
      })

      const userReq = createMockRequest({ id: 'user-1', role: 'user' })

      const readResult = await access.read({ req: userReq })

      // Should return where filter for own documents
      expect(readResult).toEqual({
        createdBy: { equals: 'user-1' },
      })
    })

    it('should deny access when user has no permission', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          admin: { delete: true },
          user: { delete: false },
        },
      })

      const userReq = createMockRequest({ role: 'user' })

      expect(await access.delete({ req: userReq })).toBe(false)
    })

    it('should deny access when no user in request', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          user: { read: true },
        },
      })

      const emptyReq: PayloadRequest = { user: null }

      expect(await access.read({ req: emptyReq })).toBe(false)
      expect(await access.create({ req: emptyReq })).toBe(false)
      expect(await access.update({ req: emptyReq })).toBe(false)
      expect(await access.delete({ req: emptyReq })).toBe(false)
    })

    it('should use default owner field (createdBy)', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          user: { read: 'own' },
        },
      })

      const userReq = createMockRequest({ id: 'user-123' })
      const result = await access.read({ req: userReq })

      expect(result).toEqual({
        createdBy: { equals: 'user-123' },
      })
    })

    it('should use custom owner field when specified', async () => {
      const access = createCollectionAccess({
        collection: 'articles',
        ownerField: 'author',
        roles: {
          user: { read: 'own' },
        },
      })

      const userReq = createMockRequest({ id: 'user-456' })
      const result = await access.read({ req: userReq })

      expect(result).toEqual({
        author: { equals: 'user-456' },
      })
    })
  })

  describe('Role-based access', () => {
    it('should handle multiple roles with different permissions', async () => {
      const access = createCollectionAccess({
        collection: 'documents',
        roles: {
          admin: { create: true, read: true, update: true, delete: true },
          editor: { create: true, read: true, update: true, delete: false },
          viewer: { create: false, read: true, update: false, delete: false },
        },
      })

      const editorReq = createMockRequest({ role: 'editor' })
      const viewerReq = createMockRequest({ role: 'viewer' })

      // Editor can create, read, update but not delete
      expect(await access.create({ req: editorReq })).toBe(true)
      expect(await access.read({ req: editorReq })).toBe(true)
      expect(await access.update({ req: editorReq })).toBe(true)
      expect(await access.delete({ req: editorReq })).toBe(false)

      // Viewer can only read
      expect(await access.create({ req: viewerReq })).toBe(false)
      expect(await access.read({ req: viewerReq })).toBe(true)
      expect(await access.update({ req: viewerReq })).toBe(false)
      expect(await access.delete({ req: viewerReq })).toBe(false)
    })

    it('should deny access for unknown roles', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          admin: { read: true },
          user: { read: true },
        },
      })

      const unknownRoleReq = createMockRequest({ role: 'guest' })

      expect(await access.read({ req: unknownRoleReq })).toBe(false)
    })

    it('should handle null role as unauthenticated', async () => {
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          user: { read: true },
        },
      })

      const nullRoleReq = createMockRequest({ role: null })

      expect(await access.read({ req: nullRoleReq })).toBe(false)
    })

    it('should support custom role names', async () => {
      const access = createCollectionAccess({
        collection: 'content',
        roles: {
          'content-manager': { create: true, read: true, update: true, delete: true },
          'content-writer': { create: true, read: true, update: 'own', delete: false },
          'content-reviewer': { create: false, read: true, update: false, delete: false },
        },
      })

      const managerReq = createMockRequest({ role: 'content-manager' })
      const writerReq = createMockRequest({ role: 'content-writer', id: 'writer-1' })

      expect(await access.delete({ req: managerReq })).toBe(true)
      expect(await access.delete({ req: writerReq })).toBe(false)

      const updateResult = await access.update({ req: writerReq })
      expect(updateResult).toEqual({
        createdBy: { equals: 'writer-1' },
      })
    })
  })

  describe('Field-level access', () => {
    it('should restrict specific fields by role', async () => {
      const access = generateAccessFunctions({
        collection: 'users',
        roles: {
          admin: { read: true, update: true },
          user: { read: true, update: 'own' },
        },
        fields: {
          salary: {
            read: ['admin', 'hr'],
            update: ['admin'],
          },
          email: {
            read: ['admin', 'user'],
            update: ['admin', 'user'],
          },
        },
      })

      expect(access.fields).toBeDefined()
      expect(access.fields?.salary).toBeDefined()
      expect(typeof access.fields?.salary.read).toBe('function')
      expect(typeof access.fields?.salary.update).toBe('function')
    })

    it('should hide sensitive fields from non-admins', async () => {
      const access = generateAccessFunctions({
        collection: 'users',
        roles: {
          admin: { read: true },
          user: { read: true },
        },
        fields: {
          ssn: {
            read: ['admin'],
            hidden: true,
          },
          password: {
            read: [],
            hidden: true,
          },
        },
      })

      const adminReq = createAdminRequest()
      const userReq = createMockRequest({ role: 'user' })

      // Admin can read SSN field
      expect(await access.fields?.ssn.read({ req: adminReq })).toBe(true)

      // User cannot read SSN field
      expect(await access.fields?.ssn.read({ req: userReq })).toBe(false)

      // No one can read password field
      expect(await access.fields?.password.read({ req: adminReq })).toBe(false)
      expect(await access.fields?.password.read({ req: userReq })).toBe(false)
    })

    it('should allow field read but restrict update', async () => {
      const access = generateAccessFunctions({
        collection: 'profiles',
        roles: {
          admin: { read: true, update: true },
          user: { read: true, update: 'own' },
        },
        fields: {
          verificationStatus: {
            read: ['admin', 'user'],
            update: ['admin'],
          },
        },
      })

      const userReq = createMockRequest({ role: 'user' })
      const adminReq = createAdminRequest()

      // User can read verificationStatus
      expect(await access.fields?.verificationStatus.read({ req: userReq })).toBe(true)

      // User cannot update verificationStatus
      expect(await access.fields?.verificationStatus.update({ req: userReq })).toBe(false)

      // Admin can update verificationStatus
      expect(await access.fields?.verificationStatus.update({ req: adminReq })).toBe(true)
    })
  })

  describe('Organization scoping', () => {
    it('should filter by activeOrganizationId', async () => {
      const access = createCollectionAccess({
        collection: 'projects',
        roles: {
          user: { read: 'org', update: 'org' },
        },
      })

      const orgUserReq = createOrgUserRequest('org-123')
      const result = await access.read({ req: orgUserReq })

      expect(result).toEqual({
        organizationId: { equals: 'org-123' },
      })
    })

    it('should use custom org field when specified', async () => {
      const access = createCollectionAccess({
        collection: 'workspaces',
        orgField: 'workspaceId',
        roles: {
          user: { read: 'org' },
        },
      })

      const orgUserReq = createOrgUserRequest('workspace-abc')
      const result = await access.read({ req: orgUserReq })

      expect(result).toEqual({
        workspaceId: { equals: 'workspace-abc' },
      })
    })

    it('should allow cross-org access for super-admins', async () => {
      const access = createCollectionAccess({
        collection: 'projects',
        superAdminBypass: true,
        roles: {
          admin: { read: 'org' },
          user: { read: 'org' },
        },
      })

      const superAdminReq = createSuperAdminRequest()
      const result = await access.read({ req: superAdminReq })

      // Super-admin should get full access (true), not filtered by org
      expect(result).toBe(true)
    })

    it('should combine org filter with own filter', async () => {
      const access = createCollectionAccess({
        collection: 'tasks',
        roles: {
          user: { read: 'org', update: 'own' },
        },
      })

      const userReq = createOrgUserRequest('org-456', 'member', { id: 'user-789' })

      // Read should filter by org
      const readResult = await access.read({ req: userReq })
      expect(readResult).toEqual({
        organizationId: { equals: 'org-456' },
      })

      // Update should filter by owner AND org
      const updateResult = await access.update({ req: userReq })
      expect(updateResult).toEqual({
        and: [
          { createdBy: { equals: 'user-789' } },
          { organizationId: { equals: 'org-456' } },
        ],
      })
    })

    it('should deny access when org permission but no active org', async () => {
      const access = createCollectionAccess({
        collection: 'projects',
        roles: {
          user: { read: 'org' },
        },
      })

      // User without active organization
      const noOrgReq = createMockRequest({
        role: 'user',
        activeOrganizationId: null,
      })

      const result = await access.read({ req: noOrgReq })
      expect(result).toBe(false)
    })

    it('should respect org admin role vs member', async () => {
      const access = createCollectionAccess({
        collection: 'org-settings',
        roles: {
          admin: { read: true, update: true },
          user: { read: 'org', update: false },
        },
      })

      const orgAdminReq = createOrgUserRequest('org-001', 'admin')
      const orgMemberReq = createOrgUserRequest('org-001', 'member')

      // Org admin with admin role should have full access
      const adminUpdateResult = await access.update({
        req: createMockRequest({
          ...orgAdminReq.user,
          role: 'admin',
        }),
      })
      expect(adminUpdateResult).toBe(true)

      // Org member with user role should have limited access
      expect(await access.update({ req: orgMemberReq })).toBe(false)
    })
  })

  describe('Document ownership', () => {
    it('should match createdBy field for own documents', async () => {
      const access = createCollectionAccess({
        collection: 'notes',
        roles: {
          user: { read: 'own', update: 'own', delete: 'own' },
        },
      })

      const userReq = createMockRequest({ id: 'user-own-001' })

      const readResult = await access.read({ req: userReq })
      expect(readResult).toEqual({
        createdBy: { equals: 'user-own-001' },
      })

      const updateResult = await access.update({ req: userReq })
      expect(updateResult).toEqual({
        createdBy: { equals: 'user-own-001' },
      })

      const deleteResult = await access.delete({ req: userReq })
      expect(deleteResult).toEqual({
        createdBy: { equals: 'user-own-001' },
      })
    })

    it('should allow admin to access any document', async () => {
      const access = createCollectionAccess({
        collection: 'notes',
        roles: {
          admin: { read: true, update: true, delete: true },
          user: { read: 'own', update: 'own', delete: 'own' },
        },
      })

      const adminReq = createAdminRequest()

      // Admin gets true (full access), not a where clause
      expect(await access.read({ req: adminReq })).toBe(true)
      expect(await access.update({ req: adminReq })).toBe(true)
      expect(await access.delete({ req: adminReq })).toBe(true)
    })

    it('should use custom owner field for matching', async () => {
      const access = createCollectionAccess({
        collection: 'blog-posts',
        ownerField: 'authorId',
        roles: {
          user: { update: 'own' },
        },
      })

      const userReq = createMockRequest({ id: 'author-xyz' })
      const result = await access.update({ req: userReq })

      expect(result).toEqual({
        authorId: { equals: 'author-xyz' },
      })
    })
  })

  describe('Access function signatures', () => {
    it('read should return boolean or Where', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {
          admin: { read: true },
          user: { read: 'own' },
        },
      })

      const adminResult = await access.read({ req: createAdminRequest() })
      const userResult = await access.read({
        req: createMockRequest({ id: 'u1', role: 'user' }),
      })

      // Admin gets boolean
      expect(typeof adminResult).toBe('boolean')
      expect(adminResult).toBe(true)

      // User gets Where clause
      expect(typeof userResult).toBe('object')
      expect(userResult).toHaveProperty('createdBy')
    })

    it('create should return boolean only', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {
          admin: { create: true },
          user: { create: true },
          guest: { create: false },
        },
      })

      const adminResult = await access.create({ req: createAdminRequest() })
      const userResult = await access.create({
        req: createMockRequest({ role: 'user' }),
      })
      const guestResult = await access.create({
        req: createMockRequest({ role: 'guest' }),
      })

      // Create always returns boolean (can't filter non-existent documents)
      expect(adminResult).toBe(true)
      expect(userResult).toBe(true)
      expect(guestResult).toBe(false)
    })

    it('update should return boolean or Where', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {
          admin: { update: true },
          user: { update: 'own' },
          viewer: { update: false },
        },
      })

      expect(await access.update({ req: createAdminRequest() })).toBe(true)
      expect(
        await access.update({ req: createMockRequest({ role: 'viewer' }) })
      ).toBe(false)

      const ownResult = await access.update({
        req: createMockRequest({ id: 'u1', role: 'user' }),
      })
      expect(ownResult).toEqual({ createdBy: { equals: 'u1' } })
    })

    it('delete should return boolean or Where', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {
          admin: { delete: true },
          user: { delete: 'own' },
          viewer: { delete: false },
        },
      })

      expect(await access.delete({ req: createAdminRequest() })).toBe(true)
      expect(
        await access.delete({ req: createMockRequest({ role: 'viewer' }) })
      ).toBe(false)

      const ownResult = await access.delete({
        req: createMockRequest({ id: 'u1', role: 'user' }),
      })
      expect(ownResult).toEqual({ createdBy: { equals: 'u1' } })
    })

    it('should receive id and data in access function args', async () => {
      const customAccess = vi.fn(() => true)
      const access = createCollectionAccess({
        collection: 'items',
        customAccess,
        roles: {},
      })

      await access.update({
        req: createAdminRequest(),
        id: 'doc-123',
        data: { title: 'Updated Title' },
      })

      expect(customAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'doc-123',
          data: { title: 'Updated Title' },
        })
      )
    })
  })

  describe('checkPermission helper', () => {
    it('should return true for boolean true permission', () => {
      const user = createMockRequest({ id: 'user-1', role: 'admin' }).user

      const result = checkPermission(user, true, {})

      expect(result).toBe(true)
    })

    it('should return false for boolean false permission', () => {
      const user = createMockRequest({ id: 'user-1', role: 'user' }).user

      const result = checkPermission(user, false, {})

      expect(result).toBe(false)
    })

    it('should return Where for own permission', () => {
      const user = createMockRequest({ id: 'user-abc' }).user

      const result = checkPermission(user, 'own', {})

      expect(result).toEqual({
        createdBy: { equals: 'user-abc' },
      })
    })

    it('should return Where for org permission', () => {
      const user = createOrgUserRequest('org-xyz').user

      const result = checkPermission(user, 'org', {})

      expect(result).toEqual({
        organizationId: { equals: 'org-xyz' },
      })
    })

    it('should return false for org permission without active org', () => {
      const user = createMockRequest({ activeOrganizationId: null }).user

      const result = checkPermission(user, 'org', {})

      expect(result).toBe(false)
    })
  })

  describe('generateAccessFunctions', () => {
    it('should generate collection-level access functions', () => {
      const access = generateAccessFunctions({
        collection: 'posts',
        roles: {
          admin: { create: true, read: true, update: true, delete: true },
        },
      })

      expect(access.create).toBeDefined()
      expect(access.read).toBeDefined()
      expect(access.update).toBeDefined()
      expect(access.delete).toBeDefined()
    })

    it('should generate field-level access functions', () => {
      const access = generateAccessFunctions({
        collection: 'users',
        roles: {
          admin: { read: true },
        },
        fields: {
          email: { read: ['admin', 'user'], update: ['admin'] },
          role: { read: ['admin'], update: ['admin'] },
        },
      })

      expect(access.fields).toBeDefined()
      expect(access.fields?.email).toBeDefined()
      expect(access.fields?.role).toBeDefined()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty roles configuration', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {},
      })

      const userReq = createMockRequest({ role: 'user' })

      // With no roles defined, should deny all access
      expect(await access.read({ req: userReq })).toBe(false)
      expect(await access.create({ req: userReq })).toBe(false)
    })

    it('should handle missing permission in role config', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {
          user: { read: true }, // Only read is defined
        },
      })

      const userReq = createMockRequest({ role: 'user' })

      expect(await access.read({ req: userReq })).toBe(true)
      // Undefined permissions should default to false
      expect(await access.create({ req: userReq })).toBe(false)
      expect(await access.update({ req: userReq })).toBe(false)
      expect(await access.delete({ req: userReq })).toBe(false)
    })

    it('should handle undefined user gracefully', async () => {
      const access = createCollectionAccess({
        collection: 'items',
        roles: {
          user: { read: true },
        },
      })

      const undefinedUserReq: PayloadRequest = { user: undefined }

      expect(await access.read({ req: undefinedUserReq })).toBe(false)
    })

    it('should handle custom access function override', async () => {
      const customAccess = vi.fn(({ req }) => {
        // Custom logic: only allow access during business hours
        return req.user?.role === 'admin'
      })

      const access = createCollectionAccess({
        collection: 'items',
        customAccess,
        roles: {
          user: { read: true }, // This would normally allow access
        },
      })

      const userReq = createMockRequest({ role: 'user' })

      // Custom access overrides role-based access
      expect(await access.read({ req: userReq })).toBe(false)
      expect(customAccess).toHaveBeenCalled()
    })

    it('should support async custom access functions', async () => {
      const customAccess = vi.fn(async ({ req }) => {
        // Simulate async check (e.g., external API call)
        await new Promise((resolve) => setTimeout(resolve, 1))
        return req.user?.role === 'admin'
      })

      const access = createCollectionAccess({
        collection: 'items',
        customAccess,
        roles: {},
      })

      const adminReq = createAdminRequest()
      const userReq = createMockRequest({ role: 'user' })

      expect(await access.read({ req: adminReq })).toBe(true)
      expect(await access.read({ req: userReq })).toBe(false)
    })

    it('should handle super-admin bypass correctly', async () => {
      const access = createCollectionAccess({
        collection: 'restricted-data',
        superAdminBypass: true,
        roles: {
          admin: { read: 'org', update: 'org' },
          user: { read: false, update: false },
        },
      })

      const superAdminReq = createSuperAdminRequest()
      const regularAdminReq = createAdminRequest({ isSuperAdmin: false })
      const orgAdminReq = createOrgUserRequest('org-1', 'admin', { role: 'admin' })

      // Super-admin bypasses all restrictions
      expect(await access.read({ req: superAdminReq })).toBe(true)
      expect(await access.update({ req: superAdminReq })).toBe(true)

      // Regular admin without org gets denied (because read: 'org')
      expect(await access.read({ req: regularAdminReq })).toBe(false)

      // Org admin gets filtered access
      const orgResult = await access.read({ req: orgAdminReq })
      expect(orgResult).toEqual({
        organizationId: { equals: 'org-1' },
      })
    })

    it('should handle combined own and org permissions correctly', async () => {
      const access = createCollectionAccess({
        collection: 'shared-docs',
        roles: {
          user: {
            read: 'org', // Can read all docs in org
            update: 'own', // Can only update own docs
            delete: false, // Cannot delete
          },
        },
      })

      const userReq = createOrgUserRequest('org-shared', 'member', {
        id: 'user-shared-001',
        role: 'user',
      })

      // Read filters by org
      expect(await access.read({ req: userReq })).toEqual({
        organizationId: { equals: 'org-shared' },
      })

      // Update filters by own AND org
      expect(await access.update({ req: userReq })).toEqual({
        and: [
          { createdBy: { equals: 'user-shared-001' } },
          { organizationId: { equals: 'org-shared' } },
        ],
      })

      // Delete denied
      expect(await access.delete({ req: userReq })).toBe(false)
    })
  })
})
