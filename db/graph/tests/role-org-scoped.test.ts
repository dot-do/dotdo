/**
 * Role as Thing: Graph Storage Tests with Org-Scoped hasRole Relationship
 *
 * TDD RED Phase: Failing tests for Role stored as a Thing with hasRole
 * relationships SCOPED TO ORGANIZATIONS. This extends the basic Role model
 * to support per-organization role assignments.
 *
 * Key Concept:
 * The hasRole relationship includes org context in its data property,
 * allowing the same Role definition to be assigned to users within
 * different organizational contexts.
 *
 * Graph Model:
 * ```
 * User Thing ──hasRole──> Role Thing
 *              (data: { orgId: 'org-123' })
 * ```
 *
 * This enables:
 * - User can be admin in Org A but member in Org B (same Role definitions)
 * - Query "what roles does user have in org X?"
 * - Query "who has admin role in org Y?"
 * - Check "does user have 'admin' permission in org Z?"
 *
 * Uses real GraphEngine, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-gdqm6 - [RED] Role as Thing: Graph storage tests with hasRole Relationship
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'

// ============================================================================
// Types for Org-Scoped Role Model
// ============================================================================

/**
 * Role properties when stored as a Thing.
 * Roles are DEFINED once and can be ASSIGNED per-organization.
 */
interface RoleProperties {
  /** Unique role name (e.g., 'owner', 'admin', 'member', 'viewer') */
  name: string
  /** Role description */
  description?: string
  /** Permission strings this role grants (e.g., ['read', 'write', 'delete', 'admin']) */
  permissions: string[]
  /** Whether this is a system-defined role (cannot be deleted) */
  isSystem?: boolean
  /** Whether this role is global (not org-specific) */
  isGlobal?: boolean
}

/**
 * User properties when stored as a Thing
 */
interface UserProperties {
  email: string
  name: string
  status: 'active' | 'inactive' | 'suspended'
}

/**
 * Organization properties when stored as a Thing
 */
interface OrganizationProperties {
  name: string
  slug: string
  status: 'active' | 'inactive'
  plan?: 'free' | 'pro' | 'enterprise'
}

/**
 * hasRole relationship data WITH ORG CONTEXT.
 * This is the key extension - roles are scoped to organizations.
 */
interface OrgScopedRoleData {
  /** Organization ID this role assignment is scoped to */
  orgId: string
  /** When the role was assigned */
  assignedAt: number
  /** Who assigned the role */
  assignedBy?: string
  /** Optional expiration timestamp */
  expiresAt?: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Standard role names following better-auth conventions
 */
const STANDARD_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const

// ============================================================================
// 1. Role Definition Tests (Org-Independent)
// ============================================================================

describe('Role Definition (Org-Independent)', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('Create Standard Roles', () => {
    it('creates owner role with full permissions', async () => {
      const ownerRole = await graph.createNode(
        'Role',
        {
          name: STANDARD_ROLES.OWNER,
          description: 'Organization owner with full access',
          permissions: ['read', 'write', 'delete', 'admin', 'billing', 'invite', 'transfer'],
          isSystem: true,
        } satisfies RoleProperties,
        { id: 'role-owner' }
      )

      expect(ownerRole).toBeDefined()
      expect(ownerRole.id).toBe('role-owner')
      expect(ownerRole.properties.name).toBe('owner')
      expect(ownerRole.properties.permissions).toContain('admin')
      expect(ownerRole.properties.permissions).toContain('transfer')
      expect(ownerRole.properties.isSystem).toBe(true)
    })

    it('creates admin role with management permissions', async () => {
      const adminRole = await graph.createNode(
        'Role',
        {
          name: STANDARD_ROLES.ADMIN,
          description: 'Administrator with management access',
          permissions: ['read', 'write', 'delete', 'admin', 'invite'],
          isSystem: true,
        } satisfies RoleProperties,
        { id: 'role-admin' }
      )

      expect(adminRole.properties.name).toBe('admin')
      expect(adminRole.properties.permissions).toContain('invite')
      expect(adminRole.properties.permissions).not.toContain('transfer')
    })

    it('creates member role with standard permissions', async () => {
      const memberRole = await graph.createNode(
        'Role',
        {
          name: STANDARD_ROLES.MEMBER,
          description: 'Standard member access',
          permissions: ['read', 'write'],
          isSystem: true,
        } satisfies RoleProperties,
        { id: 'role-member' }
      )

      expect(memberRole.properties.name).toBe('member')
      expect(memberRole.properties.permissions).toEqual(['read', 'write'])
    })

    it('creates viewer role with read-only permissions', async () => {
      const viewerRole = await graph.createNode(
        'Role',
        {
          name: STANDARD_ROLES.VIEWER,
          description: 'Read-only access',
          permissions: ['read'],
          isSystem: true,
        } satisfies RoleProperties,
        { id: 'role-viewer' }
      )

      expect(viewerRole.properties.name).toBe('viewer')
      expect(viewerRole.properties.permissions).toEqual(['read'])
    })

    it('creates all standard roles as a set', async () => {
      const roles = await Promise.all([
        graph.createNode('Role', { name: 'owner', permissions: ['*'], isSystem: true } satisfies RoleProperties),
        graph.createNode('Role', { name: 'admin', permissions: ['read', 'write', 'delete', 'admin'], isSystem: true } satisfies RoleProperties),
        graph.createNode('Role', { name: 'member', permissions: ['read', 'write'], isSystem: true } satisfies RoleProperties),
        graph.createNode('Role', { name: 'viewer', permissions: ['read'], isSystem: true } satisfies RoleProperties),
      ])

      expect(roles).toHaveLength(4)

      const allRoles = await graph.queryNodes({ label: 'Role' })
      expect(allRoles).toHaveLength(4)
    })
  })

  describe('Global vs Org-Specific Roles', () => {
    it('marks role as global (applies across all orgs)', async () => {
      const superAdminRole = await graph.createNode(
        'Role',
        {
          name: 'super-admin',
          description: 'Platform-wide super administrator',
          permissions: ['*'],
          isSystem: true,
          isGlobal: true,
        } satisfies RoleProperties,
        { id: 'role-super-admin' }
      )

      expect(superAdminRole.properties.isGlobal).toBe(true)
    })

    it('creates org-specific custom role', async () => {
      const customRole = await graph.createNode(
        'Role',
        {
          name: 'billing-manager',
          description: 'Can manage billing but not users',
          permissions: ['read', 'billing'],
          isSystem: false,
          isGlobal: false,
        } satisfies RoleProperties,
        { id: 'role-billing-manager' }
      )

      expect(customRole.properties.isGlobal).toBe(false)
      expect(customRole.properties.isSystem).toBe(false)
    })
  })
})

// ============================================================================
// 2. Org-Scoped hasRole Assignment Tests
// ============================================================================

describe('Org-Scoped hasRole Assignment', () => {
  let graph: GraphEngine
  let ownerRole: Node
  let adminRole: Node
  let memberRole: Node
  let viewerRole: Node
  let orgAcme: Node
  let orgStartup: Node
  let userAlice: Node
  let userBob: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create standard roles
    ownerRole = await graph.createNode(
      'Role',
      { name: 'owner', permissions: ['*'], isSystem: true } satisfies RoleProperties,
      { id: 'role-owner' }
    )
    adminRole = await graph.createNode(
      'Role',
      { name: 'admin', permissions: ['read', 'write', 'delete', 'admin'], isSystem: true } satisfies RoleProperties,
      { id: 'role-admin' }
    )
    memberRole = await graph.createNode(
      'Role',
      { name: 'member', permissions: ['read', 'write'], isSystem: true } satisfies RoleProperties,
      { id: 'role-member' }
    )
    viewerRole = await graph.createNode(
      'Role',
      { name: 'viewer', permissions: ['read'], isSystem: true } satisfies RoleProperties,
      { id: 'role-viewer' }
    )

    // Create organizations
    orgAcme = await graph.createNode(
      'Organization',
      { name: 'Acme Corp', slug: 'acme', status: 'active', plan: 'enterprise' } satisfies OrganizationProperties,
      { id: 'org-acme' }
    )
    orgStartup = await graph.createNode(
      'Organization',
      { name: 'Startup Inc', slug: 'startup', status: 'active', plan: 'pro' } satisfies OrganizationProperties,
      { id: 'org-startup' }
    )

    // Create users
    userAlice = await graph.createNode(
      'User',
      { email: 'alice@example.com', name: 'Alice', status: 'active' } satisfies UserProperties,
      { id: 'user-alice' }
    )
    userBob = await graph.createNode(
      'User',
      { email: 'bob@example.com', name: 'Bob', status: 'active' } satisfies UserProperties,
      { id: 'user-bob' }
    )
  })

  describe('Assign Role with Org Context', () => {
    it('creates hasRole with orgId in relationship data', async () => {
      const edge = await graph.createEdge(userAlice.id, 'hasRole', adminRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
        assignedBy: 'system',
      } satisfies OrgScopedRoleData)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('hasRole')
      expect(edge.from).toBe(userAlice.id)
      expect(edge.to).toBe(adminRole.id)
      expect(edge.properties.orgId).toBe(orgAcme.id)
      expect(edge.properties.assignedBy).toBe('system')
    })

    it('same user can have different roles in different orgs', async () => {
      // Alice is owner in Acme
      await graph.createEdge(userAlice.id, 'hasRole', ownerRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      // Alice is just a member in Startup
      await graph.createEdge(userAlice.id, 'hasRole', memberRole.id, {
        orgId: orgStartup.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      const aliceRoles = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })

      expect(aliceRoles).toHaveLength(2)

      const acmeRole = aliceRoles.find((e) => e.properties.orgId === orgAcme.id)
      const startupRole = aliceRoles.find((e) => e.properties.orgId === orgStartup.id)

      expect(acmeRole?.to).toBe(ownerRole.id)
      expect(startupRole?.to).toBe(memberRole.id)
    })

    it('same role can be assigned to different users in same org', async () => {
      // Both Alice and Bob are admins in Acme
      await graph.createEdge(userAlice.id, 'hasRole', adminRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      await graph.createEdge(userBob.id, 'hasRole', adminRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      const adminEdges = await graph.queryEdges({ to: adminRole.id, type: 'hasRole' })
      const acmeAdmins = adminEdges.filter((e) => e.properties.orgId === orgAcme.id)

      expect(acmeAdmins).toHaveLength(2)
      expect(acmeAdmins.map((e) => e.from)).toContain(userAlice.id)
      expect(acmeAdmins.map((e) => e.from)).toContain(userBob.id)
    })

    it('user can have multiple roles in the same org', async () => {
      // Alice is both admin and billing-manager in Acme
      await graph.createEdge(userAlice.id, 'hasRole', adminRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      await graph.createEdge(userAlice.id, 'hasRole', memberRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      const aliceRoles = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })
      const aliceAcmeRoles = aliceRoles.filter((e) => e.properties.orgId === orgAcme.id)

      expect(aliceAcmeRoles).toHaveLength(2)
    })

    it('stores role assignment metadata', async () => {
      const now = Date.now()
      const expiresAt = now + 86400000 // 24 hours

      const edge = await graph.createEdge(userBob.id, 'hasRole', viewerRole.id, {
        orgId: orgAcme.id,
        assignedAt: now,
        assignedBy: userAlice.id,
        expiresAt,
        metadata: {
          reason: 'Trial access',
          ticket: 'SUPPORT-123',
        },
      } satisfies OrgScopedRoleData)

      expect(edge.properties.assignedAt).toBe(now)
      expect(edge.properties.assignedBy).toBe(userAlice.id)
      expect(edge.properties.expiresAt).toBe(expiresAt)
      expect((edge.properties.metadata as Record<string, unknown>).reason).toBe('Trial access')
    })
  })
})

// ============================================================================
// 3. Query User Roles in Organization
// ============================================================================

describe('Query User Roles in Organization', () => {
  let graph: GraphEngine
  let ownerRole: Node
  let adminRole: Node
  let memberRole: Node
  let orgAcme: Node
  let orgStartup: Node
  let userAlice: Node
  let userBob: Node
  let userCharlie: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Setup roles
    ownerRole = await graph.createNode('Role', { name: 'owner', permissions: ['*'] } satisfies RoleProperties, { id: 'role-owner' })
    adminRole = await graph.createNode('Role', { name: 'admin', permissions: ['read', 'write', 'delete', 'admin'] } satisfies RoleProperties, { id: 'role-admin' })
    memberRole = await graph.createNode('Role', { name: 'member', permissions: ['read', 'write'] } satisfies RoleProperties, { id: 'role-member' })

    // Setup orgs
    orgAcme = await graph.createNode('Organization', { name: 'Acme Corp', slug: 'acme', status: 'active' } satisfies OrganizationProperties, { id: 'org-acme' })
    orgStartup = await graph.createNode('Organization', { name: 'Startup Inc', slug: 'startup', status: 'active' } satisfies OrganizationProperties, { id: 'org-startup' })

    // Setup users
    userAlice = await graph.createNode('User', { email: 'alice@example.com', name: 'Alice', status: 'active' } satisfies UserProperties, { id: 'user-alice' })
    userBob = await graph.createNode('User', { email: 'bob@example.com', name: 'Bob', status: 'active' } satisfies UserProperties, { id: 'user-bob' })
    userCharlie = await graph.createNode('User', { email: 'charlie@example.com', name: 'Charlie', status: 'active' } satisfies UserProperties, { id: 'user-charlie' })

    // Setup role assignments
    // Alice: owner@acme, member@startup
    await graph.createEdge(userAlice.id, 'hasRole', ownerRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userAlice.id, 'hasRole', memberRole.id, { orgId: orgStartup.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)

    // Bob: admin@acme, admin@startup
    await graph.createEdge(userBob.id, 'hasRole', adminRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userBob.id, 'hasRole', adminRole.id, { orgId: orgStartup.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)

    // Charlie: member@acme only
    await graph.createEdge(userCharlie.id, 'hasRole', memberRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
  })

  describe('getUserRolesInOrg', () => {
    it('gets all roles for a user in a specific org', async () => {
      // Helper function to get user roles in an org
      const getUserRolesInOrg = async (userId: string, orgId: string): Promise<Node[]> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
        const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)
        const roleNodes = await Promise.all(orgRoleEdges.map((e) => graph.getNode(e.to)))
        return roleNodes.filter((r): r is Node => r !== null)
      }

      const aliceAcmeRoles = await getUserRolesInOrg(userAlice.id, orgAcme.id)

      expect(aliceAcmeRoles).toHaveLength(1)
      expect(aliceAcmeRoles[0]!.properties.name).toBe('owner')
    })

    it('returns empty array if user has no roles in org', async () => {
      const getUserRolesInOrg = async (userId: string, orgId: string): Promise<Node[]> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
        const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)
        const roleNodes = await Promise.all(orgRoleEdges.map((e) => graph.getNode(e.to)))
        return roleNodes.filter((r): r is Node => r !== null)
      }

      const charlieStartupRoles = await getUserRolesInOrg(userCharlie.id, orgStartup.id)

      expect(charlieStartupRoles).toHaveLength(0)
    })

    it('gets role names for user in org', async () => {
      const getUserRoleNamesInOrg = async (userId: string, orgId: string): Promise<string[]> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
        const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)
        const roleNodes = await Promise.all(orgRoleEdges.map((e) => graph.getNode(e.to)))
        return roleNodes
          .filter((r): r is Node => r !== null)
          .map((r) => r.properties.name as string)
      }

      const bobAcmeRoleNames = await getUserRoleNamesInOrg(userBob.id, orgAcme.id)

      expect(bobAcmeRoleNames).toContain('admin')
    })
  })

  describe('getUsersWithRoleInOrg', () => {
    it('gets all users with a specific role in an org', async () => {
      const getUsersWithRoleInOrg = async (roleId: string, orgId: string): Promise<Node[]> => {
        const roleEdges = await graph.queryEdges({ to: roleId, type: 'hasRole' })
        const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)
        const userNodes = await Promise.all(orgRoleEdges.map((e) => graph.getNode(e.from)))
        return userNodes.filter((u): u is Node => u !== null && u.label === 'User')
      }

      const acmeAdmins = await getUsersWithRoleInOrg(adminRole.id, orgAcme.id)

      expect(acmeAdmins).toHaveLength(1)
      expect(acmeAdmins[0]!.properties.name).toBe('Bob')
    })

    it('gets all members of an org regardless of role', async () => {
      const getOrgMembers = async (orgId: string): Promise<Node[]> => {
        const allRoleEdges = await graph.queryEdges({ type: 'hasRole' })
        const orgRoleEdges = allRoleEdges.filter((e) => e.properties.orgId === orgId)
        const uniqueUserIds = [...new Set(orgRoleEdges.map((e) => e.from))]
        const userNodes = await Promise.all(uniqueUserIds.map((id) => graph.getNode(id)))
        return userNodes.filter((u): u is Node => u !== null && u.label === 'User')
      }

      const acmeMembers = await getOrgMembers(orgAcme.id)

      expect(acmeMembers).toHaveLength(3) // Alice, Bob, Charlie
    })
  })

  describe('userHasRoleInOrg', () => {
    it('checks if user has specific role in org', async () => {
      const userHasRoleInOrg = async (userId: string, roleId: string, orgId: string): Promise<boolean> => {
        const roleEdges = await graph.queryEdges({ from: userId, to: roleId, type: 'hasRole' })
        return roleEdges.some((e) => e.properties.orgId === orgId)
      }

      expect(await userHasRoleInOrg(userAlice.id, ownerRole.id, orgAcme.id)).toBe(true)
      expect(await userHasRoleInOrg(userAlice.id, ownerRole.id, orgStartup.id)).toBe(false)
      expect(await userHasRoleInOrg(userBob.id, adminRole.id, orgAcme.id)).toBe(true)
      expect(await userHasRoleInOrg(userBob.id, ownerRole.id, orgAcme.id)).toBe(false)
    })

    it('checks if user has role by name in org', async () => {
      const userHasRoleNameInOrg = async (userId: string, roleName: string, orgId: string): Promise<boolean> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
        const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)

        for (const edge of orgRoleEdges) {
          const role = await graph.getNode(edge.to)
          if (role?.properties.name === roleName) return true
        }
        return false
      }

      expect(await userHasRoleNameInOrg(userAlice.id, 'owner', orgAcme.id)).toBe(true)
      expect(await userHasRoleNameInOrg(userAlice.id, 'admin', orgAcme.id)).toBe(false)
      expect(await userHasRoleNameInOrg(userBob.id, 'admin', orgStartup.id)).toBe(true)
    })
  })
})

// ============================================================================
// 4. Permission Checking via Org-Scoped Roles
// ============================================================================

describe('Permission Checking via Org-Scoped Roles', () => {
  let graph: GraphEngine
  let ownerRole: Node
  let adminRole: Node
  let memberRole: Node
  let viewerRole: Node
  let orgAcme: Node
  let userAlice: Node
  let userBob: Node
  let userCharlie: Node
  let userDave: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Setup roles with explicit permissions
    ownerRole = await graph.createNode('Role', {
      name: 'owner',
      permissions: ['read', 'write', 'delete', 'admin', 'billing', 'invite', 'transfer'],
    } satisfies RoleProperties, { id: 'role-owner' })

    adminRole = await graph.createNode('Role', {
      name: 'admin',
      permissions: ['read', 'write', 'delete', 'admin', 'invite'],
    } satisfies RoleProperties, { id: 'role-admin' })

    memberRole = await graph.createNode('Role', {
      name: 'member',
      permissions: ['read', 'write'],
    } satisfies RoleProperties, { id: 'role-member' })

    viewerRole = await graph.createNode('Role', {
      name: 'viewer',
      permissions: ['read'],
    } satisfies RoleProperties, { id: 'role-viewer' })

    // Setup org
    orgAcme = await graph.createNode('Organization', {
      name: 'Acme Corp',
      slug: 'acme',
      status: 'active',
    } satisfies OrganizationProperties, { id: 'org-acme' })

    // Setup users
    userAlice = await graph.createNode('User', { email: 'alice@example.com', name: 'Alice', status: 'active' } satisfies UserProperties, { id: 'user-alice' })
    userBob = await graph.createNode('User', { email: 'bob@example.com', name: 'Bob', status: 'active' } satisfies UserProperties, { id: 'user-bob' })
    userCharlie = await graph.createNode('User', { email: 'charlie@example.com', name: 'Charlie', status: 'active' } satisfies UserProperties, { id: 'user-charlie' })
    userDave = await graph.createNode('User', { email: 'dave@example.com', name: 'Dave', status: 'active' } satisfies UserProperties, { id: 'user-dave' })

    // Assign roles in Acme
    await graph.createEdge(userAlice.id, 'hasRole', ownerRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userBob.id, 'hasRole', adminRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userCharlie.id, 'hasRole', memberRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userDave.id, 'hasRole', viewerRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
  })

  describe('userHasPermission', () => {
    /**
     * Helper to check if user has a permission in an org via graph traversal.
     */
    const userHasPermission = async (
      graph: GraphEngine,
      userId: string,
      orgId: string,
      permission: string
    ): Promise<boolean> => {
      // Get user's roles in the org
      const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
      const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)

      // Check each role for the permission
      for (const edge of orgRoleEdges) {
        const role = await graph.getNode(edge.to)
        if (!role) continue

        const permissions = role.properties.permissions as string[]
        if (permissions.includes(permission)) {
          return true
        }
      }

      return false
    }

    it('owner has admin permission', async () => {
      const canAdmin = await userHasPermission(graph, userAlice.id, orgAcme.id, 'admin')
      expect(canAdmin).toBe(true)
    })

    it('owner has transfer permission', async () => {
      const canTransfer = await userHasPermission(graph, userAlice.id, orgAcme.id, 'transfer')
      expect(canTransfer).toBe(true)
    })

    it('admin has admin permission', async () => {
      const canAdmin = await userHasPermission(graph, userBob.id, orgAcme.id, 'admin')
      expect(canAdmin).toBe(true)
    })

    it('admin does NOT have transfer permission', async () => {
      const canTransfer = await userHasPermission(graph, userBob.id, orgAcme.id, 'transfer')
      expect(canTransfer).toBe(false)
    })

    it('member has write permission', async () => {
      const canWrite = await userHasPermission(graph, userCharlie.id, orgAcme.id, 'write')
      expect(canWrite).toBe(true)
    })

    it('member does NOT have admin permission', async () => {
      const canAdmin = await userHasPermission(graph, userCharlie.id, orgAcme.id, 'admin')
      expect(canAdmin).toBe(false)
    })

    it('viewer has read permission', async () => {
      const canRead = await userHasPermission(graph, userDave.id, orgAcme.id, 'read')
      expect(canRead).toBe(true)
    })

    it('viewer does NOT have write permission', async () => {
      const canWrite = await userHasPermission(graph, userDave.id, orgAcme.id, 'write')
      expect(canWrite).toBe(false)
    })
  })

  describe('getEffectivePermissions', () => {
    /**
     * Get all effective permissions for a user in an org
     */
    const getEffectivePermissions = async (
      graph: GraphEngine,
      userId: string,
      orgId: string
    ): Promise<string[]> => {
      const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
      const orgRoleEdges = roleEdges.filter((e) => e.properties.orgId === orgId)

      const allPermissions = new Set<string>()

      for (const edge of orgRoleEdges) {
        const role = await graph.getNode(edge.to)
        if (!role) continue

        const permissions = role.properties.permissions as string[]
        for (const perm of permissions) {
          allPermissions.add(perm)
        }
      }

      return [...allPermissions].sort()
    }

    it('returns all permissions for owner', async () => {
      const perms = await getEffectivePermissions(graph, userAlice.id, orgAcme.id)

      expect(perms).toContain('read')
      expect(perms).toContain('write')
      expect(perms).toContain('delete')
      expect(perms).toContain('admin')
      expect(perms).toContain('billing')
      expect(perms).toContain('invite')
      expect(perms).toContain('transfer')
    })

    it('returns limited permissions for viewer', async () => {
      const perms = await getEffectivePermissions(graph, userDave.id, orgAcme.id)

      expect(perms).toEqual(['read'])
    })

    it('merges permissions when user has multiple roles', async () => {
      // Give Charlie both member and viewer roles
      await graph.createEdge(userCharlie.id, 'hasRole', viewerRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      const perms = await getEffectivePermissions(graph, userCharlie.id, orgAcme.id)

      // Should have both member (read, write) and viewer (read) permissions
      expect(perms).toContain('read')
      expect(perms).toContain('write')
    })
  })
})

// ============================================================================
// 5. Role Hierarchy (Role Inherits from Role)
// ============================================================================

describe('Role Hierarchy (inherits relationship)', () => {
  let graph: GraphEngine
  let ownerRole: Node
  let adminRole: Node
  let memberRole: Node
  let viewerRole: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create role hierarchy: owner -> admin -> member -> viewer
    viewerRole = await graph.createNode('Role', {
      name: 'viewer',
      permissions: ['read'],
    } satisfies RoleProperties, { id: 'role-viewer' })

    memberRole = await graph.createNode('Role', {
      name: 'member',
      permissions: ['write'], // Only adds write, inherits read from viewer
    } satisfies RoleProperties, { id: 'role-member' })

    adminRole = await graph.createNode('Role', {
      name: 'admin',
      permissions: ['delete', 'admin', 'invite'], // Adds these, inherits from member
    } satisfies RoleProperties, { id: 'role-admin' })

    ownerRole = await graph.createNode('Role', {
      name: 'owner',
      permissions: ['billing', 'transfer'], // Adds these, inherits from admin
    } satisfies RoleProperties, { id: 'role-owner' })

    // Create inheritance hierarchy
    // member inherits from viewer
    await graph.createEdge(memberRole.id, 'inherits', viewerRole.id)
    // admin inherits from member
    await graph.createEdge(adminRole.id, 'inherits', memberRole.id)
    // owner inherits from admin
    await graph.createEdge(ownerRole.id, 'inherits', adminRole.id)
  })

  describe('Resolve Inherited Permissions', () => {
    /**
     * Get all permissions for a role including inherited ones
     */
    const getInheritedPermissions = async (
      graph: GraphEngine,
      roleId: string
    ): Promise<string[]> => {
      const permissions = new Set<string>()

      const collectPermissions = async (currentRoleId: string): Promise<void> => {
        const role = await graph.getNode(currentRoleId)
        if (!role) return

        // Add direct permissions
        const directPerms = role.properties.permissions as string[]
        for (const perm of directPerms) {
          permissions.add(perm)
        }

        // Follow inheritance chain
        const inheritsEdges = await graph.queryEdges({ from: currentRoleId, type: 'inherits' })
        for (const edge of inheritsEdges) {
          await collectPermissions(edge.to)
        }
      }

      await collectPermissions(roleId)
      return [...permissions].sort()
    }

    it('viewer has only read permission', async () => {
      const perms = await getInheritedPermissions(graph, viewerRole.id)
      expect(perms).toEqual(['read'])
    })

    it('member inherits read from viewer and has write', async () => {
      const perms = await getInheritedPermissions(graph, memberRole.id)
      expect(perms).toContain('read')
      expect(perms).toContain('write')
    })

    it('admin inherits from member chain and has admin permissions', async () => {
      const perms = await getInheritedPermissions(graph, adminRole.id)
      expect(perms).toContain('read') // from viewer
      expect(perms).toContain('write') // from member
      expect(perms).toContain('delete') // direct
      expect(perms).toContain('admin') // direct
      expect(perms).toContain('invite') // direct
    })

    it('owner inherits everything and has billing/transfer', async () => {
      const perms = await getInheritedPermissions(graph, ownerRole.id)
      expect(perms).toContain('read')
      expect(perms).toContain('write')
      expect(perms).toContain('delete')
      expect(perms).toContain('admin')
      expect(perms).toContain('invite')
      expect(perms).toContain('billing')
      expect(perms).toContain('transfer')
    })
  })

  describe('Check Inherited Role Access', () => {
    /**
     * Check if a role effectively "includes" another role through inheritance
     */
    const roleIncludesRole = async (
      graph: GraphEngine,
      sourceRoleId: string,
      targetRoleId: string
    ): Promise<boolean> => {
      if (sourceRoleId === targetRoleId) return true

      const inheritsEdges = await graph.queryEdges({ from: sourceRoleId, type: 'inherits' })

      for (const edge of inheritsEdges) {
        if (edge.to === targetRoleId) return true
        if (await roleIncludesRole(graph, edge.to, targetRoleId)) return true
      }

      return false
    }

    it('owner includes admin', async () => {
      expect(await roleIncludesRole(graph, ownerRole.id, adminRole.id)).toBe(true)
    })

    it('owner includes viewer', async () => {
      expect(await roleIncludesRole(graph, ownerRole.id, viewerRole.id)).toBe(true)
    })

    it('admin includes member', async () => {
      expect(await roleIncludesRole(graph, adminRole.id, memberRole.id)).toBe(true)
    })

    it('member does NOT include admin', async () => {
      expect(await roleIncludesRole(graph, memberRole.id, adminRole.id)).toBe(false)
    })

    it('viewer does NOT include owner', async () => {
      expect(await roleIncludesRole(graph, viewerRole.id, ownerRole.id)).toBe(false)
    })
  })
})

// ============================================================================
// 6. Role Assignment and Removal in Org Context
// ============================================================================

describe('Role Assignment and Removal in Org Context', () => {
  let graph: GraphEngine
  let adminRole: Node
  let memberRole: Node
  let orgAcme: Node
  let userAlice: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    adminRole = await graph.createNode('Role', { name: 'admin', permissions: ['admin'] } satisfies RoleProperties, { id: 'role-admin' })
    memberRole = await graph.createNode('Role', { name: 'member', permissions: ['read', 'write'] } satisfies RoleProperties, { id: 'role-member' })
    orgAcme = await graph.createNode('Organization', { name: 'Acme', slug: 'acme', status: 'active' } satisfies OrganizationProperties, { id: 'org-acme' })
    userAlice = await graph.createNode('User', { email: 'alice@example.com', name: 'Alice', status: 'active' } satisfies UserProperties, { id: 'user-alice' })
  })

  describe('assignRoleInOrg', () => {
    /**
     * Assign a role to a user in an org context
     */
    const assignRoleInOrg = async (
      graph: GraphEngine,
      userId: string,
      roleId: string,
      orgId: string,
      assignedBy?: string
    ): Promise<Edge> => {
      return graph.createEdge(userId, 'hasRole', roleId, {
        orgId,
        assignedAt: Date.now(),
        assignedBy,
      } satisfies OrgScopedRoleData)
    }

    it('assigns role and returns edge with org context', async () => {
      const edge = await assignRoleInOrg(graph, userAlice.id, adminRole.id, orgAcme.id, 'system')

      expect(edge.type).toBe('hasRole')
      expect(edge.from).toBe(userAlice.id)
      expect(edge.to).toBe(adminRole.id)
      expect(edge.properties.orgId).toBe(orgAcme.id)
      expect(edge.properties.assignedBy).toBe('system')
    })
  })

  describe('removeRoleFromOrg', () => {
    /**
     * Remove a role from a user in a specific org
     */
    const removeRoleFromOrg = async (
      graph: GraphEngine,
      userId: string,
      roleId: string,
      orgId: string
    ): Promise<boolean> => {
      const edges = await graph.queryEdges({ from: userId, to: roleId, type: 'hasRole' })
      const orgEdge = edges.find((e) => e.properties.orgId === orgId)

      if (!orgEdge) return false

      return graph.deleteEdge(orgEdge.id)
    }

    beforeEach(async () => {
      // Setup: Alice has admin in Acme
      await graph.createEdge(userAlice.id, 'hasRole', adminRole.id, {
        orgId: orgAcme.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)
    })

    it('removes role from user in specific org', async () => {
      const removed = await removeRoleFromOrg(graph, userAlice.id, adminRole.id, orgAcme.id)
      expect(removed).toBe(true)

      const edges = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })
      expect(edges).toHaveLength(0)
    })

    it('returns false if role not found in org', async () => {
      const removed = await removeRoleFromOrg(graph, userAlice.id, memberRole.id, orgAcme.id)
      expect(removed).toBe(false)
    })

    it('does not remove role in other orgs', async () => {
      const orgStartup = await graph.createNode('Organization', {
        name: 'Startup',
        slug: 'startup',
        status: 'active',
      } satisfies OrganizationProperties, { id: 'org-startup' })

      // Alice also has admin in Startup
      await graph.createEdge(userAlice.id, 'hasRole', adminRole.id, {
        orgId: orgStartup.id,
        assignedAt: Date.now(),
      } satisfies OrgScopedRoleData)

      // Remove from Acme only
      await removeRoleFromOrg(graph, userAlice.id, adminRole.id, orgAcme.id)

      // Should still have role in Startup
      const edges = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })
      expect(edges).toHaveLength(1)
      expect(edges[0]!.properties.orgId).toBe(orgStartup.id)
    })
  })
})

// ============================================================================
// 7. Role-Based Access Control Queries
// ============================================================================

describe('Role-Based Access Control Queries', () => {
  let graph: GraphEngine
  let ownerRole: Node
  let adminRole: Node
  let memberRole: Node
  let orgAcme: Node
  let orgStartup: Node
  let userAlice: Node
  let userBob: Node
  let userCharlie: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Setup roles
    ownerRole = await graph.createNode('Role', { name: 'owner', permissions: ['*'] } satisfies RoleProperties, { id: 'role-owner' })
    adminRole = await graph.createNode('Role', { name: 'admin', permissions: ['admin'] } satisfies RoleProperties, { id: 'role-admin' })
    memberRole = await graph.createNode('Role', { name: 'member', permissions: ['read', 'write'] } satisfies RoleProperties, { id: 'role-member' })

    // Setup orgs
    orgAcme = await graph.createNode('Organization', { name: 'Acme', slug: 'acme', status: 'active' } satisfies OrganizationProperties, { id: 'org-acme' })
    orgStartup = await graph.createNode('Organization', { name: 'Startup', slug: 'startup', status: 'active' } satisfies OrganizationProperties, { id: 'org-startup' })

    // Setup users
    userAlice = await graph.createNode('User', { email: 'alice@example.com', name: 'Alice', status: 'active' } satisfies UserProperties, { id: 'user-alice' })
    userBob = await graph.createNode('User', { email: 'bob@example.com', name: 'Bob', status: 'active' } satisfies UserProperties, { id: 'user-bob' })
    userCharlie = await graph.createNode('User', { email: 'charlie@example.com', name: 'Charlie', status: 'active' } satisfies UserProperties, { id: 'user-charlie' })

    // Role assignments
    await graph.createEdge(userAlice.id, 'hasRole', ownerRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userAlice.id, 'hasRole', memberRole.id, { orgId: orgStartup.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userBob.id, 'hasRole', adminRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userBob.id, 'hasRole', adminRole.id, { orgId: orgStartup.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
    await graph.createEdge(userCharlie.id, 'hasRole', memberRole.id, { orgId: orgAcme.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
  })

  describe('getOrgOwners', () => {
    it('returns all owners of an org', async () => {
      const getOrgOwners = async (orgId: string): Promise<Node[]> => {
        const ownerEdges = await graph.queryEdges({ to: ownerRole.id, type: 'hasRole' })
        const orgOwnerEdges = ownerEdges.filter((e) => e.properties.orgId === orgId)
        const owners = await Promise.all(orgOwnerEdges.map((e) => graph.getNode(e.from)))
        return owners.filter((o): o is Node => o !== null)
      }

      const acmeOwners = await getOrgOwners(orgAcme.id)

      expect(acmeOwners).toHaveLength(1)
      expect(acmeOwners[0]!.properties.name).toBe('Alice')
    })
  })

  describe('getOrgAdmins', () => {
    it('returns all admins of an org (including owners)', async () => {
      const getOrgAdmins = async (orgId: string): Promise<Node[]> => {
        // Get users with owner or admin role
        const ownerEdges = await graph.queryEdges({ to: ownerRole.id, type: 'hasRole' })
        const adminEdges = await graph.queryEdges({ to: adminRole.id, type: 'hasRole' })

        const allAdminEdges = [...ownerEdges, ...adminEdges].filter(
          (e) => e.properties.orgId === orgId
        )

        const uniqueUserIds = [...new Set(allAdminEdges.map((e) => e.from))]
        const admins = await Promise.all(uniqueUserIds.map((id) => graph.getNode(id)))
        return admins.filter((a): a is Node => a !== null)
      }

      const acmeAdmins = await getOrgAdmins(orgAcme.id)

      expect(acmeAdmins).toHaveLength(2) // Alice (owner) and Bob (admin)
      expect(acmeAdmins.map((a) => a.properties.name)).toContain('Alice')
      expect(acmeAdmins.map((a) => a.properties.name)).toContain('Bob')
    })
  })

  describe('getUserOrgsWithRole', () => {
    it('returns all orgs where user has a specific role', async () => {
      const getUserOrgsWithRole = async (userId: string, roleId: string): Promise<Node[]> => {
        const roleEdges = await graph.queryEdges({ from: userId, to: roleId, type: 'hasRole' })
        const orgIds = roleEdges.map((e) => e.properties.orgId as string)
        const orgs = await Promise.all(orgIds.map((id) => graph.getNode(id)))
        return orgs.filter((o): o is Node => o !== null)
      }

      const bobAdminOrgs = await getUserOrgsWithRole(userBob.id, adminRole.id)

      expect(bobAdminOrgs).toHaveLength(2)
      expect(bobAdminOrgs.map((o) => o.properties.name)).toContain('Acme')
      expect(bobAdminOrgs.map((o) => o.properties.name)).toContain('Startup')
    })
  })

  describe('countMembersByRole', () => {
    it('counts members by role in an org', async () => {
      const countMembersByRoleInOrg = async (orgId: string): Promise<Record<string, number>> => {
        const allRoleEdges = await graph.queryEdges({ type: 'hasRole' })
        const orgRoleEdges = allRoleEdges.filter((e) => e.properties.orgId === orgId)

        const counts: Record<string, number> = {}

        for (const edge of orgRoleEdges) {
          const role = await graph.getNode(edge.to)
          if (role) {
            const roleName = role.properties.name as string
            counts[roleName] = (counts[roleName] ?? 0) + 1
          }
        }

        return counts
      }

      const acmeCounts = await countMembersByRoleInOrg(orgAcme.id)

      expect(acmeCounts['owner']).toBe(1)
      expect(acmeCounts['admin']).toBe(1)
      expect(acmeCounts['member']).toBe(1)
    })
  })
})

// ============================================================================
// 8. Graph Statistics for Org-Scoped Roles
// ============================================================================

describe('Graph Statistics for Org-Scoped Roles', () => {
  let graph: GraphEngine

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create roles
    const ownerRole = await graph.createNode('Role', { name: 'owner', permissions: ['*'] } satisfies RoleProperties)
    const adminRole = await graph.createNode('Role', { name: 'admin', permissions: ['admin'] } satisfies RoleProperties)
    const memberRole = await graph.createNode('Role', { name: 'member', permissions: ['read', 'write'] } satisfies RoleProperties)

    // Create orgs
    const org1 = await graph.createNode('Organization', { name: 'Org1', slug: 'org1', status: 'active' } satisfies OrganizationProperties)
    const org2 = await graph.createNode('Organization', { name: 'Org2', slug: 'org2', status: 'active' } satisfies OrganizationProperties)

    // Create users and assign roles
    for (let i = 1; i <= 10; i++) {
      const user = await graph.createNode('User', {
        email: `user${i}@example.com`,
        name: `User${i}`,
        status: 'active',
      } satisfies UserProperties)

      // Distribute users across orgs and roles
      if (i === 1) {
        await graph.createEdge(user.id, 'hasRole', ownerRole.id, { orgId: org1.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
      } else if (i <= 3) {
        await graph.createEdge(user.id, 'hasRole', adminRole.id, { orgId: org1.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
      } else if (i <= 7) {
        await graph.createEdge(user.id, 'hasRole', memberRole.id, { orgId: org1.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
      }

      if (i <= 5) {
        await graph.createEdge(user.id, 'hasRole', memberRole.id, { orgId: org2.id, assignedAt: Date.now() } satisfies OrgScopedRoleData)
      }
    }
  })

  it('counts nodes by type', async () => {
    const stats = await graph.stats()

    expect(stats.labelCounts['Role']).toBe(3)
    expect(stats.labelCounts['Organization']).toBe(2)
    expect(stats.labelCounts['User']).toBe(10)
  })

  it('counts hasRole edges', async () => {
    const stats = await graph.stats()

    // 1 owner + 2 admins + 4 members in org1 = 7
    // 5 members in org2 = 5
    // Total = 12
    expect(stats.typeCounts['hasRole']).toBe(12)
  })

  it('calculates total node count', async () => {
    const stats = await graph.stats()

    // 3 roles + 2 orgs + 10 users = 15
    expect(stats.nodeCount).toBe(15)
  })
})
