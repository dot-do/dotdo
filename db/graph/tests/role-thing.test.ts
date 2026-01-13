/**
 * Role as Thing: Graph Storage Tests with hasRole Relationship
 *
 * TDD RED Phase: Failing tests for Role modeled as a first-class Thing in the graph.
 * Roles are Things with the 'hasRole' relationship connecting Users/Agents to Roles.
 *
 * Domain Model:
 * - Role (Thing): A named collection of permissions/capabilities with properties
 * - User (Thing): A human user with identity
 * - Agent (Thing): An AI agent with identity
 *
 * Relationships:
 * - User -[hasRole]-> Role: User has this role
 * - Agent -[hasRole]-> Role: Agent has this role
 * - Role -[inherits]-> Role: Role inheritance hierarchy
 * - Role -[grants]-> Permission: Role includes this permission
 *
 * Uses real GraphEngine, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-gdqm6 - [RED] Role as Thing: Graph storage tests with hasRole Relationship
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'

// ============================================================================
// Types for Role as Thing Model
// ============================================================================

/**
 * Role properties when stored as a Thing
 */
interface RoleProperties {
  name: string
  description?: string
  level?: number // 0 = lowest, higher = more permissions
  isSystem?: boolean // System roles cannot be deleted
  createdBy?: string
  metadata?: Record<string, unknown>
}

/**
 * User properties
 */
interface UserProperties {
  email: string
  name: string
  status: 'active' | 'inactive' | 'suspended'
}

/**
 * Agent properties
 */
interface AgentProperties {
  name: string
  type: 'internal' | 'external' | 'system'
  description?: string
}

/**
 * Permission properties
 */
interface PermissionProperties {
  name: string
  scope: 'read' | 'write' | 'execute' | 'admin'
  resource: string
  description?: string
}

// ============================================================================
// 1. Role Thing CRUD Tests
// ============================================================================

describe('Role Thing CRUD', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('Create Role Thing', () => {
    it('creates a Role as a Thing with required properties', async () => {
      const role = await graph.createNode('Role', {
        name: 'admin',
        description: 'Administrator with full system access',
        level: 100,
      } satisfies RoleProperties)

      expect(role).toBeDefined()
      expect(role.id).toBeDefined()
      expect(role.label).toBe('Role')
      expect(role.properties.name).toBe('admin')
      expect(role.properties.description).toBe('Administrator with full system access')
      expect(role.properties.level).toBe(100)
    })

    it('creates Role with custom ID', async () => {
      const role = await graph.createNode(
        'Role',
        {
          name: 'developer',
          description: 'Software developer role',
          level: 50,
        } satisfies RoleProperties,
        { id: 'role-developer' }
      )

      expect(role.id).toBe('role-developer')
      expect(role.properties.name).toBe('developer')
    })

    it('creates system Role with isSystem flag', async () => {
      const role = await graph.createNode('Role', {
        name: 'super_admin',
        description: 'Super administrator - cannot be deleted',
        level: 999,
        isSystem: true,
      } satisfies RoleProperties)

      expect(role.properties.isSystem).toBe(true)
    })

    it('creates Role with metadata', async () => {
      const metadata = {
        department: 'engineering',
        team: 'platform',
        createdVia: 'api',
      }

      const role = await graph.createNode('Role', {
        name: 'platform-engineer',
        metadata,
      } satisfies RoleProperties)

      expect(role.properties.metadata).toEqual(metadata)
    })

    it('auto-generates timestamps on Role creation', async () => {
      const before = Date.now()

      const role = await graph.createNode('Role', {
        name: 'viewer',
      } satisfies RoleProperties)

      const after = Date.now()

      expect(role.createdAt).toBeGreaterThanOrEqual(before)
      expect(role.createdAt).toBeLessThanOrEqual(after)
      expect(role.updatedAt).toBeGreaterThanOrEqual(before)
      expect(role.updatedAt).toBeLessThanOrEqual(after)
    })

    it('rejects duplicate Role IDs', async () => {
      await graph.createNode(
        'Role',
        { name: 'unique-role' } satisfies RoleProperties,
        { id: 'role-unique' }
      )

      await expect(
        graph.createNode(
          'Role',
          { name: 'another-role' } satisfies RoleProperties,
          { id: 'role-unique' }
        )
      ).rejects.toThrow()
    })
  })

  describe('Read Role Thing', () => {
    it('retrieves a Role by ID', async () => {
      await graph.createNode(
        'Role',
        {
          name: 'developer',
          description: 'Development role',
          level: 50,
        } satisfies RoleProperties,
        { id: 'role-dev' }
      )

      const role = await graph.getNode('role-dev')

      expect(role).toBeDefined()
      expect(role?.id).toBe('role-dev')
      expect(role?.label).toBe('Role')
      expect(role?.properties.name).toBe('developer')
    })

    it('returns null for non-existent Role', async () => {
      const role = await graph.getNode('non-existent-role')
      expect(role).toBeNull()
    })

    it('queries all Roles by label', async () => {
      await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties)
      await graph.createNode('Role', { name: 'developer', level: 50 } satisfies RoleProperties)
      await graph.createNode('Role', { name: 'viewer', level: 10 } satisfies RoleProperties)
      await graph.createNode('User', { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties)

      const roles = await graph.queryNodes({ label: 'Role' })

      expect(roles).toHaveLength(3)
      expect(roles.every((r) => r.label === 'Role')).toBe(true)
    })

    it('queries Roles with property filter', async () => {
      await graph.createNode('Role', { name: 'admin', level: 100, isSystem: true } satisfies RoleProperties)
      await graph.createNode('Role', { name: 'developer', level: 50, isSystem: false } satisfies RoleProperties)
      await graph.createNode('Role', { name: 'viewer', level: 10, isSystem: false } satisfies RoleProperties)

      const systemRoles = await graph.queryNodes({
        label: 'Role',
        where: { isSystem: true },
      })

      expect(systemRoles).toHaveLength(1)
      expect(systemRoles[0]!.properties.name).toBe('admin')
    })

    it('queries Roles ordered by level', async () => {
      await graph.createNode('Role', { name: 'viewer', level: 10 } satisfies RoleProperties)
      await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties)
      await graph.createNode('Role', { name: 'developer', level: 50 } satisfies RoleProperties)

      const roles = await graph.queryNodes({
        label: 'Role',
        orderBy: { level: 'desc' },
      })

      expect(roles[0]!.properties.name).toBe('admin')
      expect(roles[1]!.properties.name).toBe('developer')
      expect(roles[2]!.properties.name).toBe('viewer')
    })

    it('queries Roles with pagination', async () => {
      for (let i = 1; i <= 10; i++) {
        await graph.createNode('Role', { name: `role-${i}`, level: i * 10 } satisfies RoleProperties)
      }

      const firstPage = await graph.queryNodes({
        label: 'Role',
        limit: 3,
      })

      const secondPage = await graph.queryNodes({
        label: 'Role',
        limit: 3,
        offset: 3,
      })

      expect(firstPage).toHaveLength(3)
      expect(secondPage).toHaveLength(3)
      expect(firstPage[0]!.id).not.toBe(secondPage[0]!.id)
    })
  })

  describe('Update Role Thing', () => {
    it('updates Role properties', async () => {
      await graph.createNode(
        'Role',
        {
          name: 'developer',
          description: 'Original description',
          level: 50,
        } satisfies RoleProperties,
        { id: 'role-dev' }
      )

      const updated = await graph.updateNode('role-dev', {
        description: 'Updated description',
        level: 60,
      })

      expect(updated.properties.description).toBe('Updated description')
      expect(updated.properties.level).toBe(60)
      expect(updated.properties.name).toBe('developer') // Unchanged
    })

    it('updates updatedAt timestamp on update', async () => {
      await graph.createNode(
        'Role',
        { name: 'developer' } satisfies RoleProperties,
        { id: 'role-dev' }
      )

      const original = await graph.getNode('role-dev')
      const originalUpdatedAt = original!.updatedAt

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await graph.updateNode('role-dev', { level: 55 })

      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('throws error when updating non-existent Role', async () => {
      await expect(
        graph.updateNode('non-existent-role', { level: 50 })
      ).rejects.toThrow()
    })
  })

  describe('Delete Role Thing', () => {
    it('deletes a Role by ID', async () => {
      await graph.createNode(
        'Role',
        { name: 'temp-role' } satisfies RoleProperties,
        { id: 'role-temp' }
      )

      const deleted = await graph.deleteNode('role-temp')

      expect(deleted).toBe(true)

      const role = await graph.getNode('role-temp')
      expect(role).toBeNull()
    })

    it('returns false when deleting non-existent Role', async () => {
      const deleted = await graph.deleteNode('non-existent-role')
      expect(deleted).toBe(false)
    })

    it('deletes Role and its connected edges', async () => {
      // Create Role and User with hasRole relationship
      await graph.createNode(
        'Role',
        { name: 'developer' } satisfies RoleProperties,
        { id: 'role-dev' }
      )
      await graph.createNode(
        'User',
        { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-alice' }
      )
      await graph.createEdge('user-alice', 'hasRole', 'role-dev')

      // Verify edge exists
      const edgesBefore = await graph.queryEdges({ to: 'role-dev', type: 'hasRole' })
      expect(edgesBefore).toHaveLength(1)

      // Delete Role
      await graph.deleteNode('role-dev')

      // Verify edge is also deleted
      const edgesAfter = await graph.queryEdges({ to: 'role-dev', type: 'hasRole' })
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
      { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties,
      { id: 'user-alice' }
    )
    userBob = await graph.createNode(
      'User',
      { name: 'Bob', email: 'bob@example.com', status: 'active' } satisfies UserProperties,
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
        { name: 'Charlie', email: 'charlie@example.com', status: 'active' } satisfies UserProperties,
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
// 3. hasRole Relationship between Agent and Role
// ============================================================================

describe('hasRole Relationship: Agent to Role', () => {
  let graph: GraphEngine
  let adminRole: Node
  let developerRole: Node
  let toolAccessRole: Node
  let agentRalph: Node
  let agentPriya: Node

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
    toolAccessRole = await graph.createNode(
      'Role',
      { name: 'tool-access', level: 30, description: 'Can use tools' } satisfies RoleProperties,
      { id: 'role-tool-access' }
    )

    // Create Agents (named agents from the domain)
    agentRalph = await graph.createNode(
      'Agent',
      { name: 'ralph', type: 'internal', description: 'Engineering agent' } satisfies AgentProperties,
      { id: 'agent-ralph' }
    )
    agentPriya = await graph.createNode(
      'Agent',
      { name: 'priya', type: 'internal', description: 'Product agent' } satisfies AgentProperties,
      { id: 'agent-priya' }
    )
  })

  describe('Create hasRole for Agent', () => {
    it('creates hasRole relationship between Agent and Role', async () => {
      const edge = await graph.createEdge(agentRalph.id, 'hasRole', developerRole.id)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('hasRole')
      expect(edge.from).toBe(agentRalph.id)
      expect(edge.to).toBe(developerRole.id)
    })

    it('creates hasRole with agent-specific properties', async () => {
      const edge = await graph.createEdge(agentRalph.id, 'hasRole', toolAccessRole.id, {
        grantedBy: 'system',
        capabilities: ['file_read', 'file_write', 'shell_execute'],
        restrictions: { maxConcurrentTools: 5 },
      })

      expect(edge.properties.capabilities).toEqual(['file_read', 'file_write', 'shell_execute'])
      expect((edge.properties.restrictions as { maxConcurrentTools: number }).maxConcurrentTools).toBe(5)
    })

    it('supports multiple Roles per Agent', async () => {
      await graph.createEdge(agentRalph.id, 'hasRole', developerRole.id)
      await graph.createEdge(agentRalph.id, 'hasRole', toolAccessRole.id)

      const roles = await graph.queryEdges({ from: agentRalph.id, type: 'hasRole' })

      expect(roles).toHaveLength(2)
    })
  })

  describe('Query Agent Roles', () => {
    beforeEach(async () => {
      await graph.createEdge(agentRalph.id, 'hasRole', developerRole.id)
      await graph.createEdge(agentRalph.id, 'hasRole', toolAccessRole.id)
      await graph.createEdge(agentPriya.id, 'hasRole', toolAccessRole.id)
    })

    it('gets all Roles for an Agent', async () => {
      const roleEdges = await graph.queryEdges({ from: agentRalph.id, type: 'hasRole' })

      expect(roleEdges).toHaveLength(2)
    })

    it('gets all Agents with a specific Role', async () => {
      const agentsWithToolAccess = await graph.queryEdges({ to: toolAccessRole.id, type: 'hasRole' })

      expect(agentsWithToolAccess).toHaveLength(2)
      expect(agentsWithToolAccess.map((e) => e.from)).toContain(agentRalph.id)
      expect(agentsWithToolAccess.map((e) => e.from)).toContain(agentPriya.id)
    })

    it('checks if Agent has specific Role', async () => {
      const hasDevRole = await graph.queryEdges({
        from: agentRalph.id,
        to: developerRole.id,
        type: 'hasRole',
      })

      expect(hasDevRole).toHaveLength(1)

      const hasAdminRole = await graph.queryEdges({
        from: agentRalph.id,
        to: adminRole.id,
        type: 'hasRole',
      })

      expect(hasAdminRole).toHaveLength(0)
    })
  })

  describe('Mixed User and Agent Role Assignment', () => {
    it('same Role can be assigned to both Users and Agents', async () => {
      const userAlice = await graph.createNode(
        'User',
        { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-alice' }
      )

      await graph.createEdge(userAlice.id, 'hasRole', developerRole.id)
      await graph.createEdge(agentRalph.id, 'hasRole', developerRole.id)

      const allWithRole = await graph.queryEdges({ to: developerRole.id, type: 'hasRole' })

      expect(allWithRole).toHaveLength(2)

      // Get the nodes to verify types
      const subjects = await Promise.all(allWithRole.map((e) => graph.getNode(e.from)))
      const labels = subjects.map((s) => s?.label)

      expect(labels).toContain('User')
      expect(labels).toContain('Agent')
    })
  })
})

// ============================================================================
// 4. Role Hierarchy Queries
// ============================================================================

describe('Role Hierarchy Queries', () => {
  let graph: GraphEngine
  let superAdminRole: Node
  let adminRole: Node
  let developerRole: Node
  let viewerRole: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create role hierarchy: super_admin -> admin -> developer -> viewer
    viewerRole = await graph.createNode(
      'Role',
      { name: 'viewer', level: 10 } satisfies RoleProperties,
      { id: 'role-viewer' }
    )
    developerRole = await graph.createNode(
      'Role',
      { name: 'developer', level: 50 } satisfies RoleProperties,
      { id: 'role-developer' }
    )
    adminRole = await graph.createNode(
      'Role',
      { name: 'admin', level: 100 } satisfies RoleProperties,
      { id: 'role-admin' }
    )
    superAdminRole = await graph.createNode(
      'Role',
      { name: 'super_admin', level: 999 } satisfies RoleProperties,
      { id: 'role-super-admin' }
    )

    // Create inheritance hierarchy
    await graph.createEdge(developerRole.id, 'inherits', viewerRole.id)
    await graph.createEdge(adminRole.id, 'inherits', developerRole.id)
    await graph.createEdge(superAdminRole.id, 'inherits', adminRole.id)
  })

  describe('Role Inheritance Chain', () => {
    it('finds direct parent Role', async () => {
      const parentEdges = await graph.queryEdges({ from: developerRole.id, type: 'inherits' })

      expect(parentEdges).toHaveLength(1)
      expect(parentEdges[0]!.to).toBe(viewerRole.id)
    })

    it('finds all ancestor Roles recursively', async () => {
      // Recursive function to get all ancestors
      const getAncestors = async (roleId: string): Promise<string[]> => {
        const ancestors: string[] = []
        const edges = await graph.queryEdges({ from: roleId, type: 'inherits' })

        for (const edge of edges) {
          ancestors.push(edge.to)
          const parentAncestors = await getAncestors(edge.to)
          ancestors.push(...parentAncestors)
        }

        return ancestors
      }

      const superAdminAncestors = await getAncestors(superAdminRole.id)

      expect(superAdminAncestors).toHaveLength(3)
      expect(superAdminAncestors).toContain(adminRole.id)
      expect(superAdminAncestors).toContain(developerRole.id)
      expect(superAdminAncestors).toContain(viewerRole.id)
    })

    it('finds direct child Roles', async () => {
      const childEdges = await graph.queryEdges({ to: developerRole.id, type: 'inherits' })

      expect(childEdges).toHaveLength(1)
      expect(childEdges[0]!.from).toBe(adminRole.id)
    })

    it('finds all descendant Roles recursively', async () => {
      // Recursive function to get all descendants
      const getDescendants = async (roleId: string): Promise<string[]> => {
        const descendants: string[] = []
        const edges = await graph.queryEdges({ to: roleId, type: 'inherits' })

        for (const edge of edges) {
          descendants.push(edge.from)
          const childDescendants = await getDescendants(edge.from)
          descendants.push(...childDescendants)
        }

        return descendants
      }

      const viewerDescendants = await getDescendants(viewerRole.id)

      expect(viewerDescendants).toHaveLength(3)
      expect(viewerDescendants).toContain(developerRole.id)
      expect(viewerDescendants).toContain(adminRole.id)
      expect(viewerDescendants).toContain(superAdminRole.id)
    })

    it('finds root Roles (no parents)', async () => {
      const allRoles = await graph.queryNodes({ label: 'Role' })
      const rootRoles: Node[] = []

      for (const role of allRoles) {
        const parents = await graph.queryEdges({ from: role.id, type: 'inherits' })
        if (parents.length === 0) {
          rootRoles.push(role)
        }
      }

      expect(rootRoles).toHaveLength(1)
      expect(rootRoles[0]!.properties.name).toBe('viewer')
    })

    it('finds leaf Roles (no children)', async () => {
      const allRoles = await graph.queryNodes({ label: 'Role' })
      const leafRoles: Node[] = []

      for (const role of allRoles) {
        const children = await graph.queryEdges({ to: role.id, type: 'inherits' })
        if (children.length === 0) {
          leafRoles.push(role)
        }
      }

      expect(leafRoles).toHaveLength(1)
      expect(leafRoles[0]!.properties.name).toBe('super_admin')
    })
  })

  describe('Role Level Queries', () => {
    it('queries Roles by minimum level', async () => {
      const highLevelRoles = await graph.queryNodes({
        label: 'Role',
        where: { level: { $gte: 50 } },
      })

      expect(highLevelRoles).toHaveLength(3) // developer, admin, super_admin
    })

    it('queries Roles by level range', async () => {
      const midLevelRoles = await graph.queryNodes({
        label: 'Role',
        where: {
          level: { $gte: 50, $lte: 100 },
        },
      })

      expect(midLevelRoles).toHaveLength(2) // developer, admin
    })
  })

  describe('Multiple Inheritance', () => {
    it('supports Role inheriting from multiple parent Roles', async () => {
      // Create additional Role for multiple inheritance
      const auditRole = await graph.createNode(
        'Role',
        { name: 'audit', level: 40 } satisfies RoleProperties,
        { id: 'role-audit' }
      )

      // Compliance role inherits from both developer and audit
      const complianceRole = await graph.createNode(
        'Role',
        { name: 'compliance', level: 60 } satisfies RoleProperties,
        { id: 'role-compliance' }
      )

      await graph.createEdge(complianceRole.id, 'inherits', developerRole.id)
      await graph.createEdge(complianceRole.id, 'inherits', auditRole.id)

      const parents = await graph.queryEdges({ from: complianceRole.id, type: 'inherits' })

      expect(parents).toHaveLength(2)
      expect(parents.map((e) => e.to)).toContain(developerRole.id)
      expect(parents.map((e) => e.to)).toContain(auditRole.id)
    })
  })
})

// ============================================================================
// 5. Permission Inheritance through Roles
// ============================================================================

describe('Permission Inheritance through Roles', () => {
  let graph: GraphEngine
  let adminRole: Node
  let developerRole: Node
  let viewerRole: Node
  let readPermission: Node
  let writePermission: Node
  let executePermission: Node
  let adminPermission: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create Roles with hierarchy
    viewerRole = await graph.createNode('Role', { name: 'viewer', level: 10 } satisfies RoleProperties)
    developerRole = await graph.createNode('Role', { name: 'developer', level: 50 } satisfies RoleProperties)
    adminRole = await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties)

    // Role hierarchy
    await graph.createEdge(developerRole.id, 'inherits', viewerRole.id)
    await graph.createEdge(adminRole.id, 'inherits', developerRole.id)

    // Create Permissions
    readPermission = await graph.createNode('Permission', {
      name: 'data.read',
      scope: 'read',
      resource: 'data',
    } satisfies PermissionProperties)

    writePermission = await graph.createNode('Permission', {
      name: 'data.write',
      scope: 'write',
      resource: 'data',
    } satisfies PermissionProperties)

    executePermission = await graph.createNode('Permission', {
      name: 'shell.execute',
      scope: 'execute',
      resource: 'shell',
    } satisfies PermissionProperties)

    adminPermission = await graph.createNode('Permission', {
      name: 'system.admin',
      scope: 'admin',
      resource: 'system',
    } satisfies PermissionProperties)

    // Assign permissions to Roles
    await graph.createEdge(viewerRole.id, 'grants', readPermission.id)
    await graph.createEdge(developerRole.id, 'grants', writePermission.id)
    await graph.createEdge(developerRole.id, 'grants', executePermission.id)
    await graph.createEdge(adminRole.id, 'grants', adminPermission.id)
  })

  describe('Direct Permission Grants', () => {
    it('finds Permissions directly granted to a Role', async () => {
      const devPermissions = await graph.queryEdges({ from: developerRole.id, type: 'grants' })

      expect(devPermissions).toHaveLength(2)
      expect(devPermissions.map((e) => e.to)).toContain(writePermission.id)
      expect(devPermissions.map((e) => e.to)).toContain(executePermission.id)
    })
  })

  describe('Inherited Permission Resolution', () => {
    it('resolves all Permissions for a Role including inherited', async () => {
      // Helper to get all permissions including inherited
      const getAllPermissions = async (roleId: string): Promise<string[]> => {
        const permissions: string[] = []

        // Get direct grants
        const directGrants = await graph.queryEdges({ from: roleId, type: 'grants' })
        permissions.push(...directGrants.map((e) => e.to))

        // Get inherited roles
        const inheritsEdges = await graph.queryEdges({ from: roleId, type: 'inherits' })
        for (const edge of inheritsEdges) {
          const inherited = await getAllPermissions(edge.to)
          permissions.push(...inherited)
        }

        return [...new Set(permissions)] // Dedupe
      }

      // Developer has write + execute (direct) + read (from viewer)
      const devPerms = await getAllPermissions(developerRole.id)
      expect(devPerms).toHaveLength(3)
      expect(devPerms).toContain(writePermission.id)
      expect(devPerms).toContain(executePermission.id)
      expect(devPerms).toContain(readPermission.id)

      // Admin has admin (direct) + write + execute + read (inherited)
      const adminPerms = await getAllPermissions(adminRole.id)
      expect(adminPerms).toHaveLength(4)
      expect(adminPerms).toContain(adminPermission.id)
      expect(adminPerms).toContain(writePermission.id)
      expect(adminPerms).toContain(executePermission.id)
      expect(adminPerms).toContain(readPermission.id)
    })
  })

  describe('User Permission Resolution via Roles', () => {
    it('resolves all Permissions for a User through their Roles', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties
      )

      // User has developer role
      await graph.createEdge(user.id, 'hasRole', developerRole.id)

      // Helper to get all user permissions
      const getUserPermissions = async (userId: string): Promise<string[]> => {
        const permissions: string[] = []

        // Get user's roles
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })

        for (const roleEdge of roleEdges) {
          // Get role's permissions (including inherited)
          const rolePerms = await getRolePermissions(roleEdge.to)
          permissions.push(...rolePerms)
        }

        return [...new Set(permissions)]
      }

      const getRolePermissions = async (roleId: string): Promise<string[]> => {
        const permissions: string[] = []

        const directGrants = await graph.queryEdges({ from: roleId, type: 'grants' })
        permissions.push(...directGrants.map((e) => e.to))

        const inheritsEdges = await graph.queryEdges({ from: roleId, type: 'inherits' })
        for (const edge of inheritsEdges) {
          const inherited = await getRolePermissions(edge.to)
          permissions.push(...inherited)
        }

        return permissions
      }

      const userPerms = await getUserPermissions(user.id)

      expect(userPerms).toHaveLength(3) // read, write, execute
      expect(userPerms).toContain(readPermission.id)
      expect(userPerms).toContain(writePermission.id)
      expect(userPerms).toContain(executePermission.id)
    })
  })
})

// ============================================================================
// 6. Role-Based Access Control Queries
// ============================================================================

describe('Role-Based Access Control Queries', () => {
  let graph: GraphEngine
  let adminRole: Node
  let developerRole: Node
  let viewerRole: Node
  let projectAlpha: Node
  let projectBeta: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create Roles
    adminRole = await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties)
    developerRole = await graph.createNode('Role', { name: 'developer', level: 50 } satisfies RoleProperties)
    viewerRole = await graph.createNode('Role', { name: 'viewer', level: 10 } satisfies RoleProperties)

    // Create hierarchy
    await graph.createEdge(developerRole.id, 'inherits', viewerRole.id)
    await graph.createEdge(adminRole.id, 'inherits', developerRole.id)

    // Create Projects (resources)
    projectAlpha = await graph.createNode('Project', { name: 'Alpha', status: 'active' })
    projectBeta = await graph.createNode('Project', { name: 'Beta', status: 'active' })
  })

  describe('Access Check Queries', () => {
    it('checks if User has required Role level for resource access', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties
      )
      await graph.createEdge(user.id, 'hasRole', developerRole.id)

      // Get user's highest role level
      const getUserMaxRoleLevel = async (userId: string): Promise<number> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })
        let maxLevel = 0

        for (const edge of roleEdges) {
          const role = await graph.getNode(edge.to)
          const level = (role?.properties.level as number) || 0
          if (level > maxLevel) maxLevel = level
        }

        return maxLevel
      }

      const userLevel = await getUserMaxRoleLevel(user.id)
      const requiredLevel = 50 // Developer level required

      expect(userLevel).toBeGreaterThanOrEqual(requiredLevel)
    })

    it('checks if User has specific named Role', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Bob', email: 'bob@example.com', status: 'active' } satisfies UserProperties
      )
      await graph.createEdge(user.id, 'hasRole', viewerRole.id)

      // Helper to check if user has role by name
      const userHasRole = async (userId: string, roleName: string): Promise<boolean> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })

        for (const edge of roleEdges) {
          const role = await graph.getNode(edge.to)
          if (role?.properties.name === roleName) return true
        }

        return false
      }

      expect(await userHasRole(user.id, 'viewer')).toBe(true)
      expect(await userHasRole(user.id, 'developer')).toBe(false)
      expect(await userHasRole(user.id, 'admin')).toBe(false)
    })

    it('checks inherited Role access', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Charlie', email: 'charlie@example.com', status: 'active' } satisfies UserProperties
      )
      await graph.createEdge(user.id, 'hasRole', adminRole.id)

      // Helper to check if user has role (including inherited)
      const userHasRoleOrAncestor = async (userId: string, targetRoleId: string): Promise<boolean> => {
        const roleEdges = await graph.queryEdges({ from: userId, type: 'hasRole' })

        for (const edge of roleEdges) {
          if (edge.to === targetRoleId) return true

          // Check if user's role inherits from target role
          if (await roleInheritsFrom(edge.to, targetRoleId)) return true
        }

        return false
      }

      const roleInheritsFrom = async (roleId: string, ancestorId: string): Promise<boolean> => {
        const inheritEdges = await graph.queryEdges({ from: roleId, type: 'inherits' })

        for (const edge of inheritEdges) {
          if (edge.to === ancestorId) return true
          if (await roleInheritsFrom(edge.to, ancestorId)) return true
        }

        return false
      }

      // Admin inherits from developer which inherits from viewer
      expect(await userHasRoleOrAncestor(user.id, adminRole.id)).toBe(true)
      expect(await userHasRoleOrAncestor(user.id, developerRole.id)).toBe(true) // Inherited
      expect(await userHasRoleOrAncestor(user.id, viewerRole.id)).toBe(true) // Inherited
    })
  })

  describe('Resource Access via Role', () => {
    it('assigns Role to resource and queries Users with access', async () => {
      // Create project-specific role
      const alphaAdminRole = await graph.createNode('Role', {
        name: 'alpha-admin',
        level: 80,
        metadata: { project: 'alpha' },
      } satisfies RoleProperties)

      // Link role to project
      await graph.createEdge(alphaAdminRole.id, 'appliesTo', projectAlpha.id)

      // Assign users
      const alice = await graph.createNode(
        'User',
        { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties
      )
      await graph.createEdge(alice.id, 'hasRole', alphaAdminRole.id)

      // Query: Find all users with access to projectAlpha
      const roleEdges = await graph.queryEdges({ to: projectAlpha.id, type: 'appliesTo' })
      const roleIds = roleEdges.map((e) => e.from)

      const usersWithAccess: Node[] = []
      for (const roleId of roleIds) {
        const userEdges = await graph.queryEdges({ to: roleId, type: 'hasRole' })
        for (const userEdge of userEdges) {
          const user = await graph.getNode(userEdge.from)
          if (user && user.label === 'User') {
            usersWithAccess.push(user)
          }
        }
      }

      expect(usersWithAccess).toHaveLength(1)
      expect(usersWithAccess[0]!.properties.name).toBe('Alice')
    })

    it('counts Users per Role', async () => {
      const alice = await graph.createNode('User', { name: 'Alice', email: 'a@example.com', status: 'active' } satisfies UserProperties)
      const bob = await graph.createNode('User', { name: 'Bob', email: 'b@example.com', status: 'active' } satisfies UserProperties)
      const charlie = await graph.createNode('User', { name: 'Charlie', email: 'c@example.com', status: 'active' } satisfies UserProperties)

      await graph.createEdge(alice.id, 'hasRole', adminRole.id)
      await graph.createEdge(bob.id, 'hasRole', developerRole.id)
      await graph.createEdge(charlie.id, 'hasRole', developerRole.id)

      // Count users per role
      const getRoleUserCount = async (roleId: string): Promise<number> => {
        const edges = await graph.queryEdges({ to: roleId, type: 'hasRole' })
        return edges.length
      }

      expect(await getRoleUserCount(adminRole.id)).toBe(1)
      expect(await getRoleUserCount(developerRole.id)).toBe(2)
      expect(await getRoleUserCount(viewerRole.id)).toBe(0)
    })
  })

  describe('Role Audit Queries', () => {
    it('tracks Role assignment history via edge properties', async () => {
      const user = await graph.createNode('User', {
        name: 'Alice',
        email: 'alice@example.com',
        status: 'active',
      } satisfies UserProperties)

      const edge = await graph.createEdge(user.id, 'hasRole', adminRole.id, {
        assignedAt: Date.now(),
        assignedBy: 'system-admin',
        reason: 'Promoted to admin',
        previousRole: 'developer',
      })

      expect(edge.properties.assignedBy).toBe('system-admin')
      expect(edge.properties.reason).toBe('Promoted to admin')
      expect(edge.properties.previousRole).toBe('developer')
    })

    it('queries recent Role assignments', async () => {
      const alice = await graph.createNode('User', { name: 'Alice', email: 'a@example.com', status: 'active' } satisfies UserProperties)
      const bob = await graph.createNode('User', { name: 'Bob', email: 'b@example.com', status: 'active' } satisfies UserProperties)

      const oneDayAgo = Date.now() - 86400000

      await graph.createEdge(alice.id, 'hasRole', adminRole.id, {
        assignedAt: oneDayAgo,
      })

      await graph.createEdge(bob.id, 'hasRole', developerRole.id, {
        assignedAt: Date.now(),
      })

      // Query recent assignments (last hour)
      const oneHourAgo = Date.now() - 3600000
      const allAssignments = await graph.queryEdges({ type: 'hasRole' })
      const recentAssignments = allAssignments.filter(
        (e) => (e.properties.assignedAt as number) > oneHourAgo
      )

      expect(recentAssignments).toHaveLength(1)
      expect(recentAssignments[0]!.from).toBe(bob.id)
    })
  })
})

// ============================================================================
// 7. Graph Statistics for Roles
// ============================================================================

describe('Role Graph Statistics', () => {
  let graph: GraphEngine

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create role hierarchy
    const viewer = await graph.createNode('Role', { name: 'viewer', level: 10 } satisfies RoleProperties)
    const dev = await graph.createNode('Role', { name: 'developer', level: 50 } satisfies RoleProperties)
    const admin = await graph.createNode('Role', { name: 'admin', level: 100 } satisfies RoleProperties)

    await graph.createEdge(dev.id, 'inherits', viewer.id)
    await graph.createEdge(admin.id, 'inherits', dev.id)

    // Create users with roles
    for (let i = 1; i <= 5; i++) {
      const user = await graph.createNode('User', {
        name: `User${i}`,
        email: `user${i}@example.com`,
        status: 'active',
      } satisfies UserProperties)
      await graph.createEdge(user.id, 'hasRole', viewer.id)
    }

    for (let i = 6; i <= 8; i++) {
      const user = await graph.createNode('User', {
        name: `User${i}`,
        email: `user${i}@example.com`,
        status: 'active',
      } satisfies UserProperties)
      await graph.createEdge(user.id, 'hasRole', dev.id)
    }

    const adminUser = await graph.createNode('User', {
      name: 'AdminUser',
      email: 'admin@example.com',
      status: 'active',
    } satisfies UserProperties)
    await graph.createEdge(adminUser.id, 'hasRole', admin.id)
  })

  it('gets graph statistics including Role counts', async () => {
    const stats = await graph.stats()

    expect(stats.nodeCount).toBe(12) // 3 roles + 9 users
    expect(stats.labelCounts['Role']).toBe(3)
    expect(stats.labelCounts['User']).toBe(9)
    expect(stats.typeCounts['hasRole']).toBe(9)
    expect(stats.typeCounts['inherits']).toBe(2)
  })

  it('calculates Role degree (number of users)', async () => {
    const roles = await graph.queryNodes({ label: 'Role' })
    const viewerRole = roles.find((r) => r.properties.name === 'viewer')!
    const devRole = roles.find((r) => r.properties.name === 'developer')!
    const adminRole = roles.find((r) => r.properties.name === 'admin')!

    const viewerDegree = await graph.degree(viewerRole.id, 'INCOMING')
    const devDegree = await graph.degree(devRole.id, 'INCOMING')
    const adminDegree = await graph.degree(adminRole.id, 'INCOMING')

    expect(viewerDegree).toBe(6) // 5 users + 1 inherits from developer
    expect(devDegree).toBe(4) // 3 users + 1 inherits from admin
    expect(adminDegree).toBe(1) // 1 admin user
  })
})
