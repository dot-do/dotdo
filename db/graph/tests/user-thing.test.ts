/**
 * User as Thing: Graph Storage Tests
 *
 * Tests for User modeled as a first-class Thing in the graph.
 * Users are Things with relationships like hasRole, memberOf, follows, etc.
 *
 * Uses real GraphEngine, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-g5upr - [GREEN] User as Thing: Implementation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'

// ============================================================================
// Types for User as Thing Model
// ============================================================================

interface UserProperties {
  email: string
  name?: string | null
  displayName?: string | null
  status: 'active' | 'inactive' | 'suspended' | 'pending' | 'deleted'
  emailVerified?: boolean
  avatarUrl?: string | null
  bio?: string | null
  lastSignInAt?: number | null
  lastActiveAt?: number | null
  metadata?: Record<string, unknown>
}

interface RoleProperties {
  name: string
  description?: string
  level?: number
  isSystem?: boolean
}

interface OrganizationProperties {
  name: string
  slug?: string
  description?: string
  status: 'active' | 'inactive'
}

interface ProfileProperties {
  title?: string | null
  company?: string | null
  location?: string | null
  website?: string | null
  social?: Record<string, string | null>
}

// ============================================================================
// 1. User Thing CRUD Tests
// ============================================================================

describe('User Thing CRUD', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('Create User Thing', () => {
    it('creates a User as a Thing with required properties', async () => {
      const user = await graph.createNode('User', {
        email: 'alice@example.com',
        name: 'Alice',
        status: 'active',
      } satisfies UserProperties)

      expect(user).toBeDefined()
      expect(user.id).toBeDefined()
      expect(user.label).toBe('User')
      expect(user.properties.email).toBe('alice@example.com')
      expect(user.properties.name).toBe('Alice')
      expect(user.properties.status).toBe('active')
    })

    it('creates User with custom ID', async () => {
      const user = await graph.createNode(
        'User',
        {
          email: 'bob@example.com',
          name: 'Bob',
          status: 'active',
        } satisfies UserProperties,
        { id: 'user-bob' }
      )

      expect(user.id).toBe('user-bob')
      expect(user.properties.email).toBe('bob@example.com')
    })

    it('creates User with optional profile fields', async () => {
      const user = await graph.createNode('User', {
        email: 'charlie@example.com',
        name: 'Charlie',
        displayName: 'Charlie Smith',
        status: 'active',
        emailVerified: true,
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Software engineer',
      } satisfies UserProperties)

      expect(user.properties.displayName).toBe('Charlie Smith')
      expect(user.properties.emailVerified).toBe(true)
      expect(user.properties.avatarUrl).toBe('https://example.com/avatar.png')
      expect(user.properties.bio).toBe('Software engineer')
    })

    it('creates User with metadata', async () => {
      const metadata = {
        signupSource: 'organic',
        referrer: 'google',
        campaign: 'q4-2024',
      }

      const user = await graph.createNode('User', {
        email: 'dave@example.com',
        name: 'Dave',
        status: 'active',
        metadata,
      } satisfies UserProperties)

      expect(user.properties.metadata).toEqual(metadata)
    })

    it('auto-generates timestamps on User creation', async () => {
      const before = Date.now()

      const user = await graph.createNode('User', {
        email: 'eve@example.com',
        status: 'pending',
      } satisfies UserProperties)

      const after = Date.now()

      expect(user.createdAt).toBeGreaterThanOrEqual(before)
      expect(user.createdAt).toBeLessThanOrEqual(after)
      expect(user.updatedAt).toBeGreaterThanOrEqual(before)
      expect(user.updatedAt).toBeLessThanOrEqual(after)
    })

    it('rejects duplicate User IDs', async () => {
      await graph.createNode(
        'User',
        { email: 'unique@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-unique' }
      )

      await expect(
        graph.createNode(
          'User',
          { email: 'another@example.com', status: 'active' } satisfies UserProperties,
          { id: 'user-unique' }
        )
      ).rejects.toThrow()
    })
  })

  describe('Read User Thing', () => {
    it('retrieves a User by ID', async () => {
      await graph.createNode(
        'User',
        {
          email: 'alice@example.com',
          name: 'Alice',
          status: 'active',
        } satisfies UserProperties,
        { id: 'user-alice' }
      )

      const user = await graph.getNode('user-alice')

      expect(user).toBeDefined()
      expect(user?.id).toBe('user-alice')
      expect(user?.label).toBe('User')
      expect(user?.properties.email).toBe('alice@example.com')
    })

    it('returns null for non-existent User', async () => {
      const user = await graph.getNode('non-existent-user')
      expect(user).toBeNull()
    })

    it('queries all Users by label', async () => {
      await graph.createNode('User', { email: 'a@example.com', name: 'Alice', status: 'active' } satisfies UserProperties)
      await graph.createNode('User', { email: 'b@example.com', name: 'Bob', status: 'active' } satisfies UserProperties)
      await graph.createNode('User', { email: 'c@example.com', name: 'Charlie', status: 'inactive' } satisfies UserProperties)
      await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties)

      const users = await graph.queryNodes({ label: 'User' })

      expect(users).toHaveLength(3)
      expect(users.every((u) => u.label === 'User')).toBe(true)
    })

    it('queries Users with status filter', async () => {
      await graph.createNode('User', { email: 'a@example.com', name: 'Alice', status: 'active' } satisfies UserProperties)
      await graph.createNode('User', { email: 'b@example.com', name: 'Bob', status: 'active' } satisfies UserProperties)
      await graph.createNode('User', { email: 'c@example.com', name: 'Charlie', status: 'inactive' } satisfies UserProperties)
      await graph.createNode('User', { email: 'd@example.com', name: 'Dave', status: 'suspended' } satisfies UserProperties)

      const activeUsers = await graph.queryNodes({
        label: 'User',
        where: { status: 'active' },
      })

      expect(activeUsers).toHaveLength(2)
      expect(activeUsers.map((u) => u.properties.name)).toContain('Alice')
      expect(activeUsers.map((u) => u.properties.name)).toContain('Bob')
    })

    it('queries Users ordered by createdAt', async () => {
      await graph.createNode('User', { email: 'a@example.com', name: 'Alice', status: 'active' } satisfies UserProperties)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await graph.createNode('User', { email: 'b@example.com', name: 'Bob', status: 'active' } satisfies UserProperties)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await graph.createNode('User', { email: 'c@example.com', name: 'Charlie', status: 'active' } satisfies UserProperties)

      const users = await graph.queryNodes({
        label: 'User',
        orderBy: { createdAt: 'desc' },
      })

      expect(users[0]!.properties.name).toBe('Charlie')
      expect(users[2]!.properties.name).toBe('Alice')
    })

    it('queries Users with pagination', async () => {
      for (let i = 1; i <= 10; i++) {
        await graph.createNode('User', {
          email: `user${i}@example.com`,
          name: `User${i}`,
          status: 'active',
        } satisfies UserProperties)
      }

      const firstPage = await graph.queryNodes({
        label: 'User',
        limit: 3,
      })

      const secondPage = await graph.queryNodes({
        label: 'User',
        limit: 3,
        offset: 3,
      })

      expect(firstPage).toHaveLength(3)
      expect(secondPage).toHaveLength(3)
      expect(firstPage[0]!.id).not.toBe(secondPage[0]!.id)
    })
  })

  describe('Update User Thing', () => {
    it('updates User properties', async () => {
      await graph.createNode(
        'User',
        {
          email: 'alice@example.com',
          name: 'Alice',
          status: 'pending',
        } satisfies UserProperties,
        { id: 'user-alice' }
      )

      const updated = await graph.updateNode('user-alice', {
        status: 'active',
        emailVerified: true,
      })

      expect(updated.properties.status).toBe('active')
      expect(updated.properties.emailVerified).toBe(true)
      expect(updated.properties.name).toBe('Alice') // Unchanged
    })

    it('updates updatedAt timestamp on update', async () => {
      await graph.createNode(
        'User',
        { email: 'alice@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-alice' }
      )

      const original = await graph.getNode('user-alice')
      const originalUpdatedAt = original!.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await graph.updateNode('user-alice', { name: 'Alice Updated' })

      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('throws error when updating non-existent User', async () => {
      await expect(
        graph.updateNode('non-existent-user', { status: 'active' })
      ).rejects.toThrow()
    })

    it('updates User lastSignInAt', async () => {
      await graph.createNode(
        'User',
        { email: 'alice@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-alice' }
      )

      const now = Date.now()
      const updated = await graph.updateNode('user-alice', { lastSignInAt: now })

      expect(updated.properties.lastSignInAt).toBe(now)
    })
  })

  describe('Delete User Thing', () => {
    it('deletes a User by ID', async () => {
      await graph.createNode(
        'User',
        { email: 'temp@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-temp' }
      )

      const deleted = await graph.deleteNode('user-temp')

      expect(deleted).toBe(true)

      const user = await graph.getNode('user-temp')
      expect(user).toBeNull()
    })

    it('returns false when deleting non-existent User', async () => {
      const deleted = await graph.deleteNode('non-existent-user')
      expect(deleted).toBe(false)
    })

    it('deletes User and its connected edges', async () => {
      // Create User and Role with hasRole relationship
      await graph.createNode(
        'User',
        { email: 'alice@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-alice' }
      )
      await graph.createNode(
        'Role',
        { name: 'admin', level: 100 } satisfies RoleProperties,
        { id: 'role-admin' }
      )
      await graph.createEdge('user-alice', 'hasRole', 'role-admin')

      // Verify edge exists
      const edgesBefore = await graph.queryEdges({ from: 'user-alice', type: 'hasRole' })
      expect(edgesBefore).toHaveLength(1)

      // Delete User
      await graph.deleteNode('user-alice')

      // Verify edge is also deleted
      const edgesAfter = await graph.queryEdges({ from: 'user-alice', type: 'hasRole' })
      expect(edgesAfter).toHaveLength(0)
    })
  })
})

// ============================================================================
// 2. hasRole Relationship between User and Role
// ============================================================================

describe('hasRole Relationship: User to Role', () => {
  let graph: GraphEngine
  let adminRole: Node
  let developerRole: Node
  let viewerRole: Node
  let userAlice: Node
  let userBob: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create Roles
    adminRole = await graph.createNode(
      'Role',
      { name: 'admin', level: 100 } satisfies RoleProperties,
      { id: 'role-admin' }
    )
    developerRole = await graph.createNode(
      'Role',
      { name: 'developer', level: 50 } satisfies RoleProperties,
      { id: 'role-developer' }
    )
    viewerRole = await graph.createNode(
      'Role',
      { name: 'viewer', level: 10 } satisfies RoleProperties,
      { id: 'role-viewer' }
    )

    // Create Users
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

  describe('Create hasRole Relationship', () => {
    it('creates hasRole relationship between User and Role', async () => {
      const edge = await graph.createEdge(userAlice.id, 'hasRole', adminRole.id)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('hasRole')
      expect(edge.from).toBe(userAlice.id)
      expect(edge.to).toBe(adminRole.id)
    })

    it('creates hasRole with properties (assignedAt, assignedBy)', async () => {
      const edge = await graph.createEdge(userAlice.id, 'hasRole', developerRole.id, {
        assignedAt: Date.now(),
        assignedBy: 'system',
        reason: 'Onboarding',
      })

      expect(edge.properties.assignedBy).toBe('system')
      expect(edge.properties.reason).toBe('Onboarding')
    })

    it('supports multiple Roles per User', async () => {
      await graph.createEdge(userAlice.id, 'hasRole', developerRole.id)
      await graph.createEdge(userAlice.id, 'hasRole', viewerRole.id)

      const roles = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })

      expect(roles).toHaveLength(2)
      expect(roles.map((e) => e.to)).toContain(developerRole.id)
      expect(roles.map((e) => e.to)).toContain(viewerRole.id)
    })

    it('supports same Role for multiple Users', async () => {
      await graph.createEdge(userAlice.id, 'hasRole', developerRole.id)
      await graph.createEdge(userBob.id, 'hasRole', developerRole.id)

      const usersWithRole = await graph.queryEdges({ to: developerRole.id, type: 'hasRole' })

      expect(usersWithRole).toHaveLength(2)
      expect(usersWithRole.map((e) => e.from)).toContain(userAlice.id)
      expect(usersWithRole.map((e) => e.from)).toContain(userBob.id)
    })
  })

  describe('Query User Roles', () => {
    beforeEach(async () => {
      await graph.createEdge(userAlice.id, 'hasRole', adminRole.id)
      await graph.createEdge(userAlice.id, 'hasRole', developerRole.id)
      await graph.createEdge(userBob.id, 'hasRole', viewerRole.id)
    })

    it('gets all Roles for a User', async () => {
      const roleEdges = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })

      expect(roleEdges).toHaveLength(2)

      const roleIds = roleEdges.map((e) => e.to)
      expect(roleIds).toContain(adminRole.id)
      expect(roleIds).toContain(developerRole.id)
    })

    it('gets Role nodes for a User (with traversal)', async () => {
      const roleEdges = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })
      const roleNodes = await Promise.all(roleEdges.map((e) => graph.getNode(e.to)))

      expect(roleNodes).toHaveLength(2)
      expect(roleNodes.map((r) => r?.properties.name)).toContain('admin')
      expect(roleNodes.map((r) => r?.properties.name)).toContain('developer')
    })

    it('checks if User has specific Role', async () => {
      const hasAdminRole = await graph.queryEdges({
        from: userAlice.id,
        to: adminRole.id,
        type: 'hasRole',
      })

      expect(hasAdminRole).toHaveLength(1)

      const hasViewerRole = await graph.queryEdges({
        from: userAlice.id,
        to: viewerRole.id,
        type: 'hasRole',
      })

      expect(hasViewerRole).toHaveLength(0)
    })

    it('gets all Users with a specific Role', async () => {
      // Add another user with admin role
      const userCharlie = await graph.createNode(
        'User',
        { email: 'charlie@example.com', name: 'Charlie', status: 'active' } satisfies UserProperties,
        { id: 'user-charlie' }
      )
      await graph.createEdge(userCharlie.id, 'hasRole', adminRole.id)

      const adminUsers = await graph.queryEdges({ to: adminRole.id, type: 'hasRole' })

      expect(adminUsers).toHaveLength(2)
      expect(adminUsers.map((e) => e.from)).toContain(userAlice.id)
      expect(adminUsers.map((e) => e.from)).toContain(userCharlie.id)
    })
  })

  describe('Remove User Role', () => {
    it('removes hasRole relationship', async () => {
      const edge = await graph.createEdge(userAlice.id, 'hasRole', adminRole.id)

      await graph.deleteEdge(edge.id)

      const roles = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })
      expect(roles).toHaveLength(0)
    })

    it('removes specific Role from User with multiple Roles', async () => {
      await graph.createEdge(userAlice.id, 'hasRole', adminRole.id)
      const devEdge = await graph.createEdge(userAlice.id, 'hasRole', developerRole.id)
      await graph.createEdge(userAlice.id, 'hasRole', viewerRole.id)

      await graph.deleteEdge(devEdge.id)

      const roles = await graph.queryEdges({ from: userAlice.id, type: 'hasRole' })
      expect(roles).toHaveLength(2)
      expect(roles.map((e) => e.to)).not.toContain(developerRole.id)
    })
  })
})

// ============================================================================
// 3. memberOf Relationship: User to Organization
// ============================================================================

describe('memberOf Relationship: User to Organization', () => {
  let graph: GraphEngine
  let orgAcme: Node
  let orgWidgets: Node
  let userAlice: Node
  let userBob: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create Organizations
    orgAcme = await graph.createNode(
      'Organization',
      { name: 'Acme Corp', slug: 'acme', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-acme' }
    )
    orgWidgets = await graph.createNode(
      'Organization',
      { name: 'Widgets Inc', slug: 'widgets', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-widgets' }
    )

    // Create Users
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

  describe('Create memberOf Relationship', () => {
    it('creates memberOf relationship between User and Organization', async () => {
      const edge = await graph.createEdge(userAlice.id, 'memberOf', orgAcme.id)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('memberOf')
      expect(edge.from).toBe(userAlice.id)
      expect(edge.to).toBe(orgAcme.id)
    })

    it('creates memberOf with membership properties', async () => {
      const edge = await graph.createEdge(userAlice.id, 'memberOf', orgAcme.id, {
        role: 'owner',
        joinedAt: Date.now(),
        invitedBy: 'system',
      })

      expect(edge.properties.role).toBe('owner')
      expect(edge.properties.invitedBy).toBe('system')
    })

    it('supports User in multiple Organizations', async () => {
      await graph.createEdge(userAlice.id, 'memberOf', orgAcme.id, { role: 'member' })
      await graph.createEdge(userAlice.id, 'memberOf', orgWidgets.id, { role: 'admin' })

      const memberships = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })

      expect(memberships).toHaveLength(2)
      expect(memberships.map((e) => e.to)).toContain(orgAcme.id)
      expect(memberships.map((e) => e.to)).toContain(orgWidgets.id)
    })

    it('supports multiple Users in same Organization', async () => {
      await graph.createEdge(userAlice.id, 'memberOf', orgAcme.id)
      await graph.createEdge(userBob.id, 'memberOf', orgAcme.id)

      const members = await graph.queryEdges({ to: orgAcme.id, type: 'memberOf' })

      expect(members).toHaveLength(2)
      expect(members.map((e) => e.from)).toContain(userAlice.id)
      expect(members.map((e) => e.from)).toContain(userBob.id)
    })
  })

  describe('Query User Organizations', () => {
    beforeEach(async () => {
      await graph.createEdge(userAlice.id, 'memberOf', orgAcme.id, { role: 'owner' })
      await graph.createEdge(userAlice.id, 'memberOf', orgWidgets.id, { role: 'member' })
      await graph.createEdge(userBob.id, 'memberOf', orgAcme.id, { role: 'member' })
    })

    it('gets all Organizations for a User', async () => {
      const orgEdges = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })

      expect(orgEdges).toHaveLength(2)
      expect(orgEdges.map((e) => e.to)).toContain(orgAcme.id)
      expect(orgEdges.map((e) => e.to)).toContain(orgWidgets.id)
    })

    it('gets Organization nodes for a User', async () => {
      const orgEdges = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })
      const orgNodes = await Promise.all(orgEdges.map((e) => graph.getNode(e.to)))

      expect(orgNodes).toHaveLength(2)
      expect(orgNodes.map((o) => o?.properties.name)).toContain('Acme Corp')
      expect(orgNodes.map((o) => o?.properties.name)).toContain('Widgets Inc')
    })

    it('checks if User is member of Organization', async () => {
      const isMember = await graph.queryEdges({
        from: userAlice.id,
        to: orgAcme.id,
        type: 'memberOf',
      })

      expect(isMember).toHaveLength(1)
    })

    it('gets all Users in an Organization', async () => {
      const members = await graph.queryEdges({ to: orgAcme.id, type: 'memberOf' })

      expect(members).toHaveLength(2)
      expect(members.map((e) => e.from)).toContain(userAlice.id)
      expect(members.map((e) => e.from)).toContain(userBob.id)
    })

    it('filters Organization members by role', async () => {
      const owners = (await graph.queryEdges({ to: orgAcme.id, type: 'memberOf' }))
        .filter((e) => e.properties.role === 'owner')

      expect(owners).toHaveLength(1)
      expect(owners[0]!.from).toBe(userAlice.id)
    })
  })

  describe('Organization Role Management', () => {
    it('updates user role in organization', async () => {
      const edge = await graph.createEdge(userBob.id, 'memberOf', orgAcme.id, { role: 'member' })

      const updated = await graph.updateEdge(edge.id, { role: 'admin' })

      expect(updated.properties.role).toBe('admin')
    })

    it('removes User from Organization', async () => {
      const edge = await graph.createEdge(userBob.id, 'memberOf', orgAcme.id)

      await graph.deleteEdge(edge.id)

      const membership = await graph.queryEdges({
        from: userBob.id,
        to: orgAcme.id,
        type: 'memberOf',
      })

      expect(membership).toHaveLength(0)
    })
  })
})

// ============================================================================
// 4. follows Relationship: User to User
// ============================================================================

describe('follows Relationship: User to User', () => {
  let graph: GraphEngine
  let userAlice: Node
  let userBob: Node
  let userCharlie: Node

  beforeEach(async () => {
    graph = new GraphEngine()

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
    userCharlie = await graph.createNode(
      'User',
      { email: 'charlie@example.com', name: 'Charlie', status: 'active' } satisfies UserProperties,
      { id: 'user-charlie' }
    )
  })

  describe('Create follows Relationship', () => {
    it('creates follows relationship between Users', async () => {
      const edge = await graph.createEdge(userAlice.id, 'follows', userBob.id)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('follows')
      expect(edge.from).toBe(userAlice.id)
      expect(edge.to).toBe(userBob.id)
    })

    it('creates follows with timestamp', async () => {
      const now = Date.now()
      const edge = await graph.createEdge(userAlice.id, 'follows', userBob.id, {
        followedAt: now,
      })

      expect(edge.properties.followedAt).toBe(now)
    })

    it('supports following multiple Users', async () => {
      await graph.createEdge(userAlice.id, 'follows', userBob.id)
      await graph.createEdge(userAlice.id, 'follows', userCharlie.id)

      const following = await graph.queryEdges({ from: userAlice.id, type: 'follows' })

      expect(following).toHaveLength(2)
      expect(following.map((e) => e.to)).toContain(userBob.id)
      expect(following.map((e) => e.to)).toContain(userCharlie.id)
    })

    it('supports having multiple followers', async () => {
      await graph.createEdge(userAlice.id, 'follows', userCharlie.id)
      await graph.createEdge(userBob.id, 'follows', userCharlie.id)

      const followers = await graph.queryEdges({ to: userCharlie.id, type: 'follows' })

      expect(followers).toHaveLength(2)
      expect(followers.map((e) => e.from)).toContain(userAlice.id)
      expect(followers.map((e) => e.from)).toContain(userBob.id)
    })
  })

  describe('Query Following/Followers', () => {
    beforeEach(async () => {
      // Alice follows Bob and Charlie
      await graph.createEdge(userAlice.id, 'follows', userBob.id)
      await graph.createEdge(userAlice.id, 'follows', userCharlie.id)
      // Bob follows Charlie
      await graph.createEdge(userBob.id, 'follows', userCharlie.id)
    })

    it('gets all Users a User is following', async () => {
      const following = await graph.queryEdges({ from: userAlice.id, type: 'follows' })
      const followingUsers = await Promise.all(following.map((e) => graph.getNode(e.to)))

      expect(followingUsers).toHaveLength(2)
      expect(followingUsers.map((u) => u?.properties.name)).toContain('Bob')
      expect(followingUsers.map((u) => u?.properties.name)).toContain('Charlie')
    })

    it('gets all followers of a User', async () => {
      const followers = await graph.queryEdges({ to: userCharlie.id, type: 'follows' })
      const followerUsers = await Promise.all(followers.map((e) => graph.getNode(e.from)))

      expect(followerUsers).toHaveLength(2)
      expect(followerUsers.map((u) => u?.properties.name)).toContain('Alice')
      expect(followerUsers.map((u) => u?.properties.name)).toContain('Bob')
    })

    it('checks if User is following another User', async () => {
      const isFollowing = await graph.queryEdges({
        from: userAlice.id,
        to: userBob.id,
        type: 'follows',
      })

      expect(isFollowing).toHaveLength(1)

      const isNotFollowing = await graph.queryEdges({
        from: userBob.id,
        to: userAlice.id,
        type: 'follows',
      })

      expect(isNotFollowing).toHaveLength(0)
    })

    it('calculates following count', async () => {
      const following = await graph.queryEdges({ from: userAlice.id, type: 'follows' })
      expect(following.length).toBe(2)
    })

    it('calculates followers count', async () => {
      const followers = await graph.queryEdges({ to: userCharlie.id, type: 'follows' })
      expect(followers.length).toBe(2)
    })
  })

  describe('Unfollow', () => {
    it('unfollows a User', async () => {
      const edge = await graph.createEdge(userAlice.id, 'follows', userBob.id)

      await graph.deleteEdge(edge.id)

      const isFollowing = await graph.queryEdges({
        from: userAlice.id,
        to: userBob.id,
        type: 'follows',
      })

      expect(isFollowing).toHaveLength(0)
    })
  })
})

// ============================================================================
// 5. User Profile Data
// ============================================================================

describe('User Profile Data', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('stores extended profile data', async () => {
    const user = await graph.createNode('User', {
      email: 'alice@example.com',
      name: 'Alice Smith',
      status: 'active',
      bio: 'Software engineer',
      metadata: {
        profile: {
          title: 'Senior Engineer',
          company: 'Acme Corp',
          location: 'San Francisco, CA',
          website: 'https://alice.dev',
          social: {
            twitter: '@alice',
            github: 'alice',
            linkedin: 'alice-smith',
          },
        },
      },
    } satisfies UserProperties)

    expect(user.properties.metadata).toBeDefined()
    const profile = (user.properties.metadata as { profile: ProfileProperties }).profile
    expect(profile.title).toBe('Senior Engineer')
    expect(profile.company).toBe('Acme Corp')
    expect(profile.social?.twitter).toBe('@alice')
  })

  it('updates profile data', async () => {
    const user = await graph.createNode(
      'User',
      {
        email: 'bob@example.com',
        status: 'active',
        metadata: {
          profile: { title: 'Engineer' },
        },
      } satisfies UserProperties,
      { id: 'user-bob' }
    )

    const updated = await graph.updateNode('user-bob', {
      metadata: {
        profile: {
          title: 'Senior Engineer',
          company: 'New Company',
        },
      },
    })

    const profile = (updated.properties.metadata as { profile: ProfileProperties }).profile
    expect(profile.title).toBe('Senior Engineer')
    expect(profile.company).toBe('New Company')
  })
})

// ============================================================================
// 6. User Statistics and Aggregations
// ============================================================================

describe('User Statistics', () => {
  let graph: GraphEngine

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create users with roles and organizations
    const adminRole = await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties, { id: 'role-admin' })
    const devRole = await graph.createNode('Role', { name: 'developer', level: 50 } satisfies RoleProperties, { id: 'role-dev' })
    const org = await graph.createNode('Organization', { name: 'Acme', status: 'active' } satisfies OrganizationProperties, { id: 'org-acme' })

    for (let i = 1; i <= 5; i++) {
      const user = await graph.createNode(
        'User',
        { email: `user${i}@example.com`, name: `User${i}`, status: 'active' } satisfies UserProperties,
        { id: `user-${i}` }
      )
      await graph.createEdge(user.id, 'hasRole', i === 1 ? adminRole.id : devRole.id)
      await graph.createEdge(user.id, 'memberOf', org.id)
    }

    // Add follow relationships
    await graph.createEdge('user-2', 'follows', 'user-1')
    await graph.createEdge('user-3', 'follows', 'user-1')
    await graph.createEdge('user-4', 'follows', 'user-1')
    await graph.createEdge('user-1', 'follows', 'user-2')
  })

  it('gets graph statistics including User counts', async () => {
    const stats = await graph.stats()

    expect(stats.nodeCount).toBe(8) // 5 users + 2 roles + 1 org
    expect(stats.labelCounts['User']).toBe(5)
    expect(stats.labelCounts['Role']).toBe(2)
    expect(stats.labelCounts['Organization']).toBe(1)
    expect(stats.typeCounts['hasRole']).toBe(5)
    expect(stats.typeCounts['memberOf']).toBe(5)
    expect(stats.typeCounts['follows']).toBe(4)
  })

  it('calculates User follower count', async () => {
    const followers = await graph.queryEdges({ to: 'user-1', type: 'follows' })
    expect(followers.length).toBe(3)
  })

  it('calculates User following count', async () => {
    const following = await graph.queryEdges({ from: 'user-1', type: 'follows' })
    expect(following.length).toBe(1)
  })

  it('calculates degree centrality for Users', async () => {
    // User-1 has the most connections (3 followers + 1 following + 1 role + 1 org = 6)
    const degree = await graph.degree('user-1')
    expect(degree).toBe(6)
  })
})

// ============================================================================
// 7. User Auth Integration
// ============================================================================

describe('User Auth Integration', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('tracks user sign-in activity', async () => {
    const user = await graph.createNode(
      'User',
      {
        email: 'alice@example.com',
        status: 'active',
        lastSignInAt: null,
        lastActiveAt: null,
      } satisfies UserProperties,
      { id: 'user-alice' }
    )

    const now = Date.now()
    const updated = await graph.updateNode('user-alice', {
      lastSignInAt: now,
      lastActiveAt: now,
    })

    expect(updated.properties.lastSignInAt).toBe(now)
    expect(updated.properties.lastActiveAt).toBe(now)
  })

  it('stores external provider info', async () => {
    const user = await graph.createNode('User', {
      email: 'oauth@example.com',
      status: 'active',
      metadata: {
        externalId: '12345',
        externalProvider: 'google',
        oauthScopes: ['email', 'profile'],
      },
    } satisfies UserProperties)

    const metadata = user.properties.metadata as Record<string, unknown>
    expect(metadata.externalId).toBe('12345')
    expect(metadata.externalProvider).toBe('google')
  })

  it('handles email verification flow', async () => {
    const user = await graph.createNode(
      'User',
      {
        email: 'unverified@example.com',
        status: 'pending',
        emailVerified: false,
      } satisfies UserProperties,
      { id: 'user-unverified' }
    )

    expect(user.properties.emailVerified).toBe(false)

    // Simulate email verification
    const verified = await graph.updateNode('user-unverified', {
      emailVerified: true,
      status: 'active',
    })

    expect(verified.properties.emailVerified).toBe(true)
    expect(verified.properties.status).toBe('active')
  })

  it('handles user suspension', async () => {
    const user = await graph.createNode(
      'User',
      {
        email: 'active@example.com',
        status: 'active',
      } satisfies UserProperties,
      { id: 'user-active' }
    )

    const suspended = await graph.updateNode('user-active', {
      status: 'suspended',
      metadata: {
        suspendedAt: Date.now(),
        suspendedReason: 'Terms violation',
      },
    })

    expect(suspended.properties.status).toBe('suspended')
    expect((suspended.properties.metadata as Record<string, unknown>).suspendedReason).toBe('Terms violation')
  })
})
