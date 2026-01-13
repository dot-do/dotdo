/**
 * Organization as Thing: Graph Storage Tests with memberOf Relationship
 *
 * TDD RED Phase: Failing tests for Organization modeled as a first-class Thing in the graph.
 * Organizations are Things with the 'memberOf' relationship connecting Users to Organizations.
 *
 * Domain Model:
 * - Organization (Thing): A company, team, or group with properties
 * - User (Thing): A human user with identity
 * - Agent (Thing): An AI agent that can be part of organizations
 *
 * Relationships:
 * - User -[memberOf]-> Organization: User belongs to organization
 * - Agent -[memberOf]-> Organization: Agent belongs to organization
 * - Organization -[childOf]-> Organization: Organization hierarchy (parent-child)
 * - Organization -[partnersWith]-> Organization: Partner organizations
 *
 * Uses real GraphEngine, NO MOCKS - per project testing philosophy.
 *
 * RED PHASE TESTS: The following tests are designed to FAIL until implementation exists:
 * - OrganizationStore class with domain-specific methods
 * - Slug uniqueness validation
 * - Member count enforcement against maxMembers limit
 * - Type-safe Organization queries
 *
 * @see dotdo-93idt - [RED] Organization as Thing: Graph storage tests with memberOf Relationship
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'

// ============================================================================
// RED PHASE: These imports will fail until OrganizationStore is implemented
// ============================================================================

// This import WILL FAIL - OrganizationStore does not exist yet
// import { OrganizationStore, type Organization, type Membership } from '../organization'

// ============================================================================
// Types for Organization as Thing Model
// ============================================================================

/**
 * Organization properties when stored as a Thing
 */
interface OrganizationProperties {
  name: string
  slug: string
  description?: string
  type: 'company' | 'team' | 'department' | 'community' | 'partner'
  plan?: 'free' | 'starter' | 'pro' | 'enterprise'
  status: 'active' | 'inactive' | 'suspended' | 'archived'
  settings?: {
    allowPublicProjects?: boolean
    defaultRole?: string
    ssoEnabled?: boolean
    domain?: string
  }
  metadata?: Record<string, unknown>
  createdBy?: string
  maxMembers?: number
}

/**
 * User properties
 */
interface UserProperties {
  email: string
  name: string
  status: 'active' | 'inactive' | 'suspended'
  avatarUrl?: string
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
 * Membership properties on the memberOf relationship
 */
interface MembershipProperties {
  role: 'owner' | 'admin' | 'member' | 'guest' | 'billing'
  joinedAt: number
  invitedBy?: string
  status: 'active' | 'pending' | 'suspended'
  permissions?: string[]
  title?: string
  department?: string
}

// ============================================================================
// 1. Organization Thing CRUD Tests
// ============================================================================

describe('Organization Thing CRUD', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('Create Organization Thing', () => {
    it('creates an Organization as a Thing with required properties', async () => {
      const org = await graph.createNode('Organization', {
        name: 'Acme Corp',
        slug: 'acme-corp',
        type: 'company',
        status: 'active',
      } satisfies OrganizationProperties)

      expect(org).toBeDefined()
      expect(org.id).toBeDefined()
      expect(org.label).toBe('Organization')
      expect(org.properties.name).toBe('Acme Corp')
      expect(org.properties.slug).toBe('acme-corp')
      expect(org.properties.type).toBe('company')
      expect(org.properties.status).toBe('active')
    })

    it('creates Organization with custom ID', async () => {
      const org = await graph.createNode(
        'Organization',
        {
          name: 'StartupX',
          slug: 'startupx',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-startupx' }
      )

      expect(org.id).toBe('org-startupx')
      expect(org.properties.name).toBe('StartupX')
    })

    it('creates Organization with plan and settings', async () => {
      const org = await graph.createNode('Organization', {
        name: 'Enterprise Inc',
        slug: 'enterprise-inc',
        type: 'company',
        status: 'active',
        plan: 'enterprise',
        settings: {
          allowPublicProjects: false,
          defaultRole: 'member',
          ssoEnabled: true,
          domain: 'enterprise-inc.com',
        },
      } satisfies OrganizationProperties)

      expect(org.properties.plan).toBe('enterprise')
      expect((org.properties.settings as OrganizationProperties['settings'])?.ssoEnabled).toBe(true)
      expect((org.properties.settings as OrganizationProperties['settings'])?.domain).toBe('enterprise-inc.com')
    })

    it('creates team-type Organization', async () => {
      const team = await graph.createNode('Organization', {
        name: 'Platform Team',
        slug: 'platform-team',
        type: 'team',
        status: 'active',
        description: 'Core platform engineering team',
      } satisfies OrganizationProperties)

      expect(team.properties.type).toBe('team')
      expect(team.properties.description).toBe('Core platform engineering team')
    })

    it('creates department-type Organization', async () => {
      const dept = await graph.createNode('Organization', {
        name: 'Engineering',
        slug: 'engineering',
        type: 'department',
        status: 'active',
      } satisfies OrganizationProperties)

      expect(dept.properties.type).toBe('department')
    })

    it('creates Organization with metadata', async () => {
      const metadata = {
        industry: 'technology',
        region: 'north-america',
        headcount: 150,
        foundedYear: 2020,
      }

      const org = await graph.createNode('Organization', {
        name: 'Tech Startup',
        slug: 'tech-startup',
        type: 'company',
        status: 'active',
        metadata,
      } satisfies OrganizationProperties)

      expect(org.properties.metadata).toEqual(metadata)
    })

    it('auto-generates timestamps on Organization creation', async () => {
      const before = Date.now()

      const org = await graph.createNode('Organization', {
        name: 'New Org',
        slug: 'new-org',
        type: 'company',
        status: 'active',
      } satisfies OrganizationProperties)

      const after = Date.now()

      expect(org.createdAt).toBeGreaterThanOrEqual(before)
      expect(org.createdAt).toBeLessThanOrEqual(after)
      expect(org.updatedAt).toBeGreaterThanOrEqual(before)
      expect(org.updatedAt).toBeLessThanOrEqual(after)
    })

    it('rejects duplicate Organization IDs', async () => {
      await graph.createNode(
        'Organization',
        {
          name: 'Unique Org',
          slug: 'unique-org',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-unique' }
      )

      await expect(
        graph.createNode(
          'Organization',
          {
            name: 'Another Org',
            slug: 'another-org',
            type: 'company',
            status: 'active',
          } satisfies OrganizationProperties,
          { id: 'org-unique' }
        )
      ).rejects.toThrow()
    })

    it('creates Organization with maxMembers limit', async () => {
      const org = await graph.createNode('Organization', {
        name: 'Free Tier Org',
        slug: 'free-tier-org',
        type: 'company',
        status: 'active',
        plan: 'free',
        maxMembers: 5,
      } satisfies OrganizationProperties)

      expect(org.properties.maxMembers).toBe(5)
    })
  })

  describe('Read Organization Thing', () => {
    it('retrieves an Organization by ID', async () => {
      await graph.createNode(
        'Organization',
        {
          name: 'Acme Corp',
          slug: 'acme-corp',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-acme' }
      )

      const org = await graph.getNode('org-acme')

      expect(org).toBeDefined()
      expect(org?.id).toBe('org-acme')
      expect(org?.label).toBe('Organization')
      expect(org?.properties.name).toBe('Acme Corp')
    })

    it('returns null for non-existent Organization', async () => {
      const org = await graph.getNode('non-existent-org')
      expect(org).toBeNull()
    })

    it('queries all Organizations by label', async () => {
      await graph.createNode('Organization', { name: 'Org A', slug: 'org-a', type: 'company', status: 'active' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Org B', slug: 'org-b', type: 'team', status: 'active' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Org C', slug: 'org-c', type: 'department', status: 'active' } satisfies OrganizationProperties)
      await graph.createNode('User', { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties)

      const orgs = await graph.queryNodes({ label: 'Organization' })

      expect(orgs).toHaveLength(3)
      expect(orgs.every((o) => o.label === 'Organization')).toBe(true)
    })

    it('queries Organizations with property filter by type', async () => {
      await graph.createNode('Organization', { name: 'Company A', slug: 'company-a', type: 'company', status: 'active' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Team B', slug: 'team-b', type: 'team', status: 'active' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Company C', slug: 'company-c', type: 'company', status: 'active' } satisfies OrganizationProperties)

      const companies = await graph.queryNodes({
        label: 'Organization',
        where: { type: 'company' },
      })

      expect(companies).toHaveLength(2)
      expect(companies.every((c) => c.properties.type === 'company')).toBe(true)
    })

    it('queries Organizations by status', async () => {
      await graph.createNode('Organization', { name: 'Active Org', slug: 'active-org', type: 'company', status: 'active' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Inactive Org', slug: 'inactive-org', type: 'company', status: 'inactive' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Suspended Org', slug: 'suspended-org', type: 'company', status: 'suspended' } satisfies OrganizationProperties)

      const activeOrgs = await graph.queryNodes({
        label: 'Organization',
        where: { status: 'active' },
      })

      expect(activeOrgs).toHaveLength(1)
      expect(activeOrgs[0]!.properties.name).toBe('Active Org')
    })

    it('queries Organizations by plan', async () => {
      await graph.createNode('Organization', { name: 'Free Org', slug: 'free-org', type: 'company', status: 'active', plan: 'free' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Enterprise Org', slug: 'enterprise-org', type: 'company', status: 'active', plan: 'enterprise' } satisfies OrganizationProperties)
      await graph.createNode('Organization', { name: 'Pro Org', slug: 'pro-org', type: 'company', status: 'active', plan: 'pro' } satisfies OrganizationProperties)

      const enterpriseOrgs = await graph.queryNodes({
        label: 'Organization',
        where: { plan: 'enterprise' },
      })

      expect(enterpriseOrgs).toHaveLength(1)
      expect(enterpriseOrgs[0]!.properties.name).toBe('Enterprise Org')
    })

    it('queries Organizations with pagination', async () => {
      for (let i = 1; i <= 10; i++) {
        await graph.createNode('Organization', {
          name: `Org ${i}`,
          slug: `org-${i}`,
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties)
      }

      const firstPage = await graph.queryNodes({
        label: 'Organization',
        limit: 3,
      })

      const secondPage = await graph.queryNodes({
        label: 'Organization',
        limit: 3,
        offset: 3,
      })

      expect(firstPage).toHaveLength(3)
      expect(secondPage).toHaveLength(3)
      expect(firstPage[0]!.id).not.toBe(secondPage[0]!.id)
    })
  })

  describe('Update Organization Thing', () => {
    it('updates Organization properties', async () => {
      await graph.createNode(
        'Organization',
        {
          name: 'Old Name',
          slug: 'old-name',
          type: 'company',
          status: 'active',
          plan: 'free',
        } satisfies OrganizationProperties,
        { id: 'org-update' }
      )

      const updated = await graph.updateNode('org-update', {
        name: 'New Name',
        plan: 'pro',
        description: 'Updated description',
      })

      expect(updated.properties.name).toBe('New Name')
      expect(updated.properties.plan).toBe('pro')
      expect(updated.properties.description).toBe('Updated description')
      expect(updated.properties.slug).toBe('old-name') // Unchanged
    })

    it('updates updatedAt timestamp on update', async () => {
      await graph.createNode(
        'Organization',
        {
          name: 'Org',
          slug: 'org',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-ts' }
      )

      const original = await graph.getNode('org-ts')
      const originalUpdatedAt = original!.updatedAt

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await graph.updateNode('org-ts', { plan: 'enterprise' })

      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('throws error when updating non-existent Organization', async () => {
      await expect(
        graph.updateNode('non-existent-org', { plan: 'pro' })
      ).rejects.toThrow()
    })

    it('updates Organization status', async () => {
      await graph.createNode(
        'Organization',
        {
          name: 'Org to Suspend',
          slug: 'org-to-suspend',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-suspend' }
      )

      const updated = await graph.updateNode('org-suspend', { status: 'suspended' })

      expect(updated.properties.status).toBe('suspended')
    })
  })

  describe('Delete Organization Thing', () => {
    it('deletes an Organization by ID', async () => {
      await graph.createNode(
        'Organization',
        {
          name: 'Temp Org',
          slug: 'temp-org',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-temp' }
      )

      const deleted = await graph.deleteNode('org-temp')

      expect(deleted).toBe(true)

      const org = await graph.getNode('org-temp')
      expect(org).toBeNull()
    })

    it('returns false when deleting non-existent Organization', async () => {
      const deleted = await graph.deleteNode('non-existent-org')
      expect(deleted).toBe(false)
    })

    it('deletes Organization and its connected membership edges', async () => {
      // Create Organization and User with memberOf relationship
      await graph.createNode(
        'Organization',
        {
          name: 'Org to Delete',
          slug: 'org-to-delete',
          type: 'company',
          status: 'active',
        } satisfies OrganizationProperties,
        { id: 'org-del' }
      )
      await graph.createNode(
        'User',
        { name: 'Alice', email: 'alice@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-alice' }
      )
      await graph.createEdge('user-alice', 'memberOf', 'org-del', {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      // Verify edge exists
      const edgesBefore = await graph.queryEdges({ to: 'org-del', type: 'memberOf' })
      expect(edgesBefore).toHaveLength(1)

      // Delete Organization
      await graph.deleteNode('org-del')

      // Verify edge is also deleted
      const edgesAfter = await graph.queryEdges({ to: 'org-del', type: 'memberOf' })
      expect(edgesAfter).toHaveLength(0)
    })
  })
})

// ============================================================================
// 2. memberOf Relationship between User and Organization
// ============================================================================

describe('memberOf Relationship: User to Organization', () => {
  let graph: GraphEngine
  let acmeOrg: Node
  let startupOrg: Node
  let freelanceOrg: Node
  let userAlice: Node
  let userBob: Node
  let userCharlie: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create Organizations
    acmeOrg = await graph.createNode(
      'Organization',
      { name: 'Acme Corp', slug: 'acme-corp', type: 'company', status: 'active', plan: 'enterprise' } satisfies OrganizationProperties,
      { id: 'org-acme' }
    )
    startupOrg = await graph.createNode(
      'Organization',
      { name: 'StartupX', slug: 'startupx', type: 'company', status: 'active', plan: 'pro' } satisfies OrganizationProperties,
      { id: 'org-startup' }
    )
    freelanceOrg = await graph.createNode(
      'Organization',
      { name: 'Freelance Network', slug: 'freelance-network', type: 'community', status: 'active', plan: 'free' } satisfies OrganizationProperties,
      { id: 'org-freelance' }
    )

    // Create Users
    userAlice = await graph.createNode(
      'User',
      { name: 'Alice', email: 'alice@acme.com', status: 'active' } satisfies UserProperties,
      { id: 'user-alice' }
    )
    userBob = await graph.createNode(
      'User',
      { name: 'Bob', email: 'bob@startup.com', status: 'active' } satisfies UserProperties,
      { id: 'user-bob' }
    )
    userCharlie = await graph.createNode(
      'User',
      { name: 'Charlie', email: 'charlie@freelance.com', status: 'active' } satisfies UserProperties,
      { id: 'user-charlie' }
    )
  })

  describe('Create memberOf Relationship', () => {
    it('creates memberOf relationship between User and Organization', async () => {
      const edge = await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('memberOf')
      expect(edge.from).toBe(userAlice.id)
      expect(edge.to).toBe(acmeOrg.id)
    })

    it('creates memberOf with role properties (owner, admin, member)', async () => {
      const ownerEdge = await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'owner',
        joinedAt: Date.now(),
        status: 'active',
        invitedBy: 'system',
      } satisfies MembershipProperties)

      expect(ownerEdge.properties.role).toBe('owner')
      expect(ownerEdge.properties.invitedBy).toBe('system')
    })

    it('creates memberOf with permissions list', async () => {
      const edge = await graph.createEdge(userBob.id, 'memberOf', startupOrg.id, {
        role: 'admin',
        joinedAt: Date.now(),
        status: 'active',
        permissions: ['users.manage', 'billing.view', 'projects.create', 'settings.edit'],
      } satisfies MembershipProperties)

      expect(edge.properties.permissions).toEqual(['users.manage', 'billing.view', 'projects.create', 'settings.edit'])
    })

    it('creates memberOf with title and department', async () => {
      const edge = await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
        title: 'Senior Engineer',
        department: 'Engineering',
      } satisfies MembershipProperties)

      expect(edge.properties.title).toBe('Senior Engineer')
      expect(edge.properties.department).toBe('Engineering')
    })

    it('supports pending membership status', async () => {
      const edge = await graph.createEdge(userCharlie.id, 'memberOf', acmeOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'pending',
        invitedBy: 'user-alice',
      } satisfies MembershipProperties)

      expect(edge.properties.status).toBe('pending')
      expect(edge.properties.invitedBy).toBe('user-alice')
    })
  })

  describe('Multi-org Membership', () => {
    it('supports User belonging to multiple Organizations', async () => {
      await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'owner',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userAlice.id, 'memberOf', freelanceOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const memberships = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })

      expect(memberships).toHaveLength(2)
      expect(memberships.map((e) => e.to)).toContain(acmeOrg.id)
      expect(memberships.map((e) => e.to)).toContain(freelanceOrg.id)
    })

    it('supports different roles in different Organizations', async () => {
      await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'owner',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userAlice.id, 'memberOf', startupOrg.id, {
        role: 'guest',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const memberships = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })

      const acmeMembership = memberships.find((e) => e.to === acmeOrg.id)
      const startupMembership = memberships.find((e) => e.to === startupOrg.id)

      expect(acmeMembership?.properties.role).toBe('owner')
      expect(startupMembership?.properties.role).toBe('guest')
    })

    it('supports same Organization for multiple Users', async () => {
      await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'owner',
        joinedAt: Date.now() - 86400000, // 1 day ago
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userBob.id, 'memberOf', acmeOrg.id, {
        role: 'admin',
        joinedAt: Date.now() - 3600000, // 1 hour ago
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userCharlie.id, 'memberOf', acmeOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const members = await graph.queryEdges({ to: acmeOrg.id, type: 'memberOf' })

      expect(members).toHaveLength(3)
      expect(members.map((e) => e.from)).toContain(userAlice.id)
      expect(members.map((e) => e.from)).toContain(userBob.id)
      expect(members.map((e) => e.from)).toContain(userCharlie.id)
    })
  })

  describe('Query Organization Members', () => {
    beforeEach(async () => {
      await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'owner',
        joinedAt: Date.now() - 86400000,
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userBob.id, 'memberOf', acmeOrg.id, {
        role: 'admin',
        joinedAt: Date.now() - 3600000,
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userCharlie.id, 'memberOf', acmeOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userAlice.id, 'memberOf', startupOrg.id, {
        role: 'guest',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)
    })

    it('gets all members of an Organization', async () => {
      const memberEdges = await graph.queryEdges({ to: acmeOrg.id, type: 'memberOf' })

      expect(memberEdges).toHaveLength(3)

      const memberIds = memberEdges.map((e) => e.from)
      expect(memberIds).toContain(userAlice.id)
      expect(memberIds).toContain(userBob.id)
      expect(memberIds).toContain(userCharlie.id)
    })

    it('gets member User nodes for an Organization (with traversal)', async () => {
      const memberEdges = await graph.queryEdges({ to: acmeOrg.id, type: 'memberOf' })
      const memberNodes = await Promise.all(memberEdges.map((e) => graph.getNode(e.from)))

      expect(memberNodes).toHaveLength(3)
      expect(memberNodes.map((m) => m?.properties.name)).toContain('Alice')
      expect(memberNodes.map((m) => m?.properties.name)).toContain('Bob')
      expect(memberNodes.map((m) => m?.properties.name)).toContain('Charlie')
    })

    it('gets all Organizations a User belongs to', async () => {
      const membershipEdges = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })

      expect(membershipEdges).toHaveLength(2)
      expect(membershipEdges.map((e) => e.to)).toContain(acmeOrg.id)
      expect(membershipEdges.map((e) => e.to)).toContain(startupOrg.id)
    })

    it('checks if User is member of specific Organization', async () => {
      const isMember = await graph.queryEdges({
        from: userAlice.id,
        to: acmeOrg.id,
        type: 'memberOf',
      })

      expect(isMember).toHaveLength(1)

      const isNotMember = await graph.queryEdges({
        from: userAlice.id,
        to: freelanceOrg.id,
        type: 'memberOf',
      })

      expect(isNotMember).toHaveLength(0)
    })

    it('gets owners of an Organization', async () => {
      const memberEdges = await graph.queryEdges({ to: acmeOrg.id, type: 'memberOf' })
      const owners = memberEdges.filter((e) => e.properties.role === 'owner')

      expect(owners).toHaveLength(1)
      expect(owners[0]!.from).toBe(userAlice.id)
    })

    it('gets admins of an Organization', async () => {
      const memberEdges = await graph.queryEdges({ to: acmeOrg.id, type: 'memberOf' })
      const admins = memberEdges.filter((e) => e.properties.role === 'admin' || e.properties.role === 'owner')

      expect(admins).toHaveLength(2)
      expect(admins.map((a) => a.from)).toContain(userAlice.id)
      expect(admins.map((a) => a.from)).toContain(userBob.id)
    })
  })

  describe('Remove Organization Membership', () => {
    it('removes memberOf relationship', async () => {
      const edge = await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.deleteEdge(edge.id)

      const memberships = await graph.queryEdges({ from: userAlice.id, to: acmeOrg.id, type: 'memberOf' })
      expect(memberships).toHaveLength(0)
    })

    it('removes specific Organization membership from User with multiple memberships', async () => {
      await graph.createEdge(userAlice.id, 'memberOf', acmeOrg.id, {
        role: 'owner',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const startupMembership = await graph.createEdge(userAlice.id, 'memberOf', startupOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(userAlice.id, 'memberOf', freelanceOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.deleteEdge(startupMembership.id)

      const memberships = await graph.queryEdges({ from: userAlice.id, type: 'memberOf' })
      expect(memberships).toHaveLength(2)
      expect(memberships.map((e) => e.to)).not.toContain(startupOrg.id)
    })
  })
})

// ============================================================================
// 3. Organization Hierarchy Queries
// ============================================================================

describe('Organization Hierarchy Queries', () => {
  let graph: GraphEngine
  let parentOrg: Node
  let childOrg1: Node
  let childOrg2: Node
  let grandchildOrg: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create organization hierarchy: parentOrg -> childOrg1, childOrg2 -> grandchildOrg
    parentOrg = await graph.createNode(
      'Organization',
      { name: 'Parent Corp', slug: 'parent-corp', type: 'company', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-parent' }
    )

    childOrg1 = await graph.createNode(
      'Organization',
      { name: 'Child Division 1', slug: 'child-div-1', type: 'department', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-child-1' }
    )

    childOrg2 = await graph.createNode(
      'Organization',
      { name: 'Child Division 2', slug: 'child-div-2', type: 'department', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-child-2' }
    )

    grandchildOrg = await graph.createNode(
      'Organization',
      { name: 'Grandchild Team', slug: 'grandchild-team', type: 'team', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-grandchild' }
    )

    // Create hierarchy relationships
    await graph.createEdge(childOrg1.id, 'childOf', parentOrg.id)
    await graph.createEdge(childOrg2.id, 'childOf', parentOrg.id)
    await graph.createEdge(grandchildOrg.id, 'childOf', childOrg1.id)
  })

  describe('Parent-Child Relationships', () => {
    it('finds direct parent Organization', async () => {
      const parentEdges = await graph.queryEdges({ from: childOrg1.id, type: 'childOf' })

      expect(parentEdges).toHaveLength(1)
      expect(parentEdges[0]!.to).toBe(parentOrg.id)
    })

    it('finds direct child Organizations', async () => {
      const childEdges = await graph.queryEdges({ to: parentOrg.id, type: 'childOf' })

      expect(childEdges).toHaveLength(2)
      expect(childEdges.map((e) => e.from)).toContain(childOrg1.id)
      expect(childEdges.map((e) => e.from)).toContain(childOrg2.id)
    })

    it('finds all ancestor Organizations recursively', async () => {
      // Recursive function to get all ancestors
      const getAncestors = async (orgId: string): Promise<string[]> => {
        const ancestors: string[] = []
        const edges = await graph.queryEdges({ from: orgId, type: 'childOf' })

        for (const edge of edges) {
          ancestors.push(edge.to)
          const parentAncestors = await getAncestors(edge.to)
          ancestors.push(...parentAncestors)
        }

        return ancestors
      }

      const grandchildAncestors = await getAncestors(grandchildOrg.id)

      expect(grandchildAncestors).toHaveLength(2)
      expect(grandchildAncestors).toContain(childOrg1.id)
      expect(grandchildAncestors).toContain(parentOrg.id)
    })

    it('finds all descendant Organizations recursively', async () => {
      // Recursive function to get all descendants
      const getDescendants = async (orgId: string): Promise<string[]> => {
        const descendants: string[] = []
        const edges = await graph.queryEdges({ to: orgId, type: 'childOf' })

        for (const edge of edges) {
          descendants.push(edge.from)
          const childDescendants = await getDescendants(edge.from)
          descendants.push(...childDescendants)
        }

        return descendants
      }

      const parentDescendants = await getDescendants(parentOrg.id)

      expect(parentDescendants).toHaveLength(3)
      expect(parentDescendants).toContain(childOrg1.id)
      expect(parentDescendants).toContain(childOrg2.id)
      expect(parentDescendants).toContain(grandchildOrg.id)
    })

    it('finds root Organizations (no parents)', async () => {
      const allOrgs = await graph.queryNodes({ label: 'Organization' })
      const rootOrgs: Node[] = []

      for (const org of allOrgs) {
        const parents = await graph.queryEdges({ from: org.id, type: 'childOf' })
        if (parents.length === 0) {
          rootOrgs.push(org)
        }
      }

      expect(rootOrgs).toHaveLength(1)
      expect(rootOrgs[0]!.properties.name).toBe('Parent Corp')
    })

    it('finds leaf Organizations (no children)', async () => {
      const allOrgs = await graph.queryNodes({ label: 'Organization' })
      const leafOrgs: Node[] = []

      for (const org of allOrgs) {
        const children = await graph.queryEdges({ to: org.id, type: 'childOf' })
        if (children.length === 0) {
          leafOrgs.push(org)
        }
      }

      expect(leafOrgs).toHaveLength(2)
      expect(leafOrgs.map((o) => o.properties.name)).toContain('Child Division 2')
      expect(leafOrgs.map((o) => o.properties.name)).toContain('Grandchild Team')
    })
  })

  describe('Hierarchy Depth Queries', () => {
    it('calculates depth of Organization in hierarchy', async () => {
      // Calculate depth by counting ancestors
      const getDepth = async (orgId: string): Promise<number> => {
        const parents = await graph.queryEdges({ from: orgId, type: 'childOf' })
        if (parents.length === 0) return 0

        const parentDepths = await Promise.all(
          parents.map((e) => getDepth(e.to))
        )
        return 1 + Math.max(...parentDepths)
      }

      expect(await getDepth(parentOrg.id)).toBe(0)
      expect(await getDepth(childOrg1.id)).toBe(1)
      expect(await getDepth(grandchildOrg.id)).toBe(2)
    })

    it('finds Organizations at specific depth level', async () => {
      const getDepth = async (orgId: string): Promise<number> => {
        const parents = await graph.queryEdges({ from: orgId, type: 'childOf' })
        if (parents.length === 0) return 0
        const parentDepths = await Promise.all(parents.map((e) => getDepth(e.to)))
        return 1 + Math.max(...parentDepths)
      }

      const allOrgs = await graph.queryNodes({ label: 'Organization' })
      const level1Orgs: Node[] = []

      for (const org of allOrgs) {
        if (await getDepth(org.id) === 1) {
          level1Orgs.push(org)
        }
      }

      expect(level1Orgs).toHaveLength(2)
      expect(level1Orgs.map((o) => o.properties.name)).toContain('Child Division 1')
      expect(level1Orgs.map((o) => o.properties.name)).toContain('Child Division 2')
    })
  })

  describe('Member Inheritance in Hierarchy', () => {
    it('propagates membership check up the hierarchy', async () => {
      // Create a user who is member of grandchild team
      const user = await graph.createNode(
        'User',
        { name: 'Team Member', email: 'team@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-team' }
      )

      await graph.createEdge(user.id, 'memberOf', grandchildOrg.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      // Helper to check if user is member of org or any ancestor
      const isMemberOrAncestor = async (userId: string, targetOrgId: string): Promise<boolean> => {
        // Direct membership check
        const directMembership = await graph.queryEdges({
          from: userId,
          to: targetOrgId,
          type: 'memberOf',
        })
        if (directMembership.length > 0) return true

        // Check if user is member of any child org
        const childEdges = await graph.queryEdges({ to: targetOrgId, type: 'childOf' })
        for (const childEdge of childEdges) {
          if (await isMemberOrAncestor(userId, childEdge.from)) return true
        }

        return false
      }

      // User should be found in grandchild directly
      expect(await isMemberOrAncestor(user.id, grandchildOrg.id)).toBe(true)

      // User should be found in child1 through descendant
      expect(await isMemberOrAncestor(user.id, childOrg1.id)).toBe(true)

      // User should be found in parent through descendant chain
      expect(await isMemberOrAncestor(user.id, parentOrg.id)).toBe(true)

      // User should not be found in child2 (different branch)
      expect(await isMemberOrAncestor(user.id, childOrg2.id)).toBe(false)
    })
  })
})

// ============================================================================
// 4. Admin/Member Roles
// ============================================================================

describe('Organization Admin/Member Roles', () => {
  let graph: GraphEngine
  let org: Node
  let owner: Node
  let admin: Node
  let member: Node
  let guest: Node
  let billing: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    org = await graph.createNode(
      'Organization',
      { name: 'Role Test Org', slug: 'role-test-org', type: 'company', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-roles' }
    )

    owner = await graph.createNode(
      'User',
      { name: 'Owner User', email: 'owner@example.com', status: 'active' } satisfies UserProperties,
      { id: 'user-owner' }
    )

    admin = await graph.createNode(
      'User',
      { name: 'Admin User', email: 'admin@example.com', status: 'active' } satisfies UserProperties,
      { id: 'user-admin' }
    )

    member = await graph.createNode(
      'User',
      { name: 'Member User', email: 'member@example.com', status: 'active' } satisfies UserProperties,
      { id: 'user-member' }
    )

    guest = await graph.createNode(
      'User',
      { name: 'Guest User', email: 'guest@example.com', status: 'active' } satisfies UserProperties,
      { id: 'user-guest' }
    )

    billing = await graph.createNode(
      'User',
      { name: 'Billing User', email: 'billing@example.com', status: 'active' } satisfies UserProperties,
      { id: 'user-billing' }
    )

    // Assign roles
    await graph.createEdge(owner.id, 'memberOf', org.id, {
      role: 'owner',
      joinedAt: Date.now() - 86400000 * 365, // 1 year ago
      status: 'active',
      permissions: ['*'], // All permissions
    } satisfies MembershipProperties)

    await graph.createEdge(admin.id, 'memberOf', org.id, {
      role: 'admin',
      joinedAt: Date.now() - 86400000 * 30, // 30 days ago
      status: 'active',
      permissions: ['users.manage', 'projects.manage', 'settings.edit'],
    } satisfies MembershipProperties)

    await graph.createEdge(member.id, 'memberOf', org.id, {
      role: 'member',
      joinedAt: Date.now() - 86400000 * 7, // 7 days ago
      status: 'active',
      permissions: ['projects.view', 'projects.edit'],
    } satisfies MembershipProperties)

    await graph.createEdge(guest.id, 'memberOf', org.id, {
      role: 'guest',
      joinedAt: Date.now(),
      status: 'active',
      permissions: ['projects.view'],
    } satisfies MembershipProperties)

    await graph.createEdge(billing.id, 'memberOf', org.id, {
      role: 'billing',
      joinedAt: Date.now() - 86400000 * 60, // 60 days ago
      status: 'active',
      permissions: ['billing.view', 'billing.manage'],
    } satisfies MembershipProperties)
  })

  describe('Role-Based Queries', () => {
    it('gets all users with owner role', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const owners = memberEdges.filter((e) => e.properties.role === 'owner')

      expect(owners).toHaveLength(1)
      expect(owners[0]!.from).toBe(owner.id)
    })

    it('gets all users with admin or higher role', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const adminsAndAbove = memberEdges.filter((e) => {
        const role = e.properties.role as string
        return role === 'owner' || role === 'admin'
      })

      expect(adminsAndAbove).toHaveLength(2)
      expect(adminsAndAbove.map((e) => e.from)).toContain(owner.id)
      expect(adminsAndAbove.map((e) => e.from)).toContain(admin.id)
    })

    it('gets all users with member or higher role', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const membersAndAbove = memberEdges.filter((e) => {
        const role = e.properties.role as string
        return role === 'owner' || role === 'admin' || role === 'member'
      })

      expect(membersAndAbove).toHaveLength(3)
    })

    it('gets all guest users', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const guests = memberEdges.filter((e) => e.properties.role === 'guest')

      expect(guests).toHaveLength(1)
      expect(guests[0]!.from).toBe(guest.id)
    })

    it('gets all billing users', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const billingUsers = memberEdges.filter((e) => e.properties.role === 'billing')

      expect(billingUsers).toHaveLength(1)
      expect(billingUsers[0]!.from).toBe(billing.id)
    })
  })

  describe('Permission Checks', () => {
    it('checks if user has specific permission', async () => {
      const membershipEdges = await graph.queryEdges({ from: admin.id, to: org.id, type: 'memberOf' })
      const membership = membershipEdges[0]
      const permissions = membership?.properties.permissions as string[]

      expect(permissions).toContain('users.manage')
      expect(permissions).not.toContain('billing.manage')
    })

    it('owner has wildcard permission (*)', async () => {
      const membershipEdges = await graph.queryEdges({ from: owner.id, to: org.id, type: 'memberOf' })
      const membership = membershipEdges[0]
      const permissions = membership?.properties.permissions as string[]

      expect(permissions).toContain('*')
    })

    it('gets all users with specific permission', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const usersWithProjectsView = memberEdges.filter((e) => {
        const permissions = e.properties.permissions as string[]
        return permissions?.includes('projects.view') || permissions?.includes('*')
      })

      expect(usersWithProjectsView).toHaveLength(3) // owner (*), member, guest
    })
  })

  describe('Role Hierarchy Checks', () => {
    it('determines if user can manage other users', async () => {
      const canManageUsers = async (userId: string, orgId: string): Promise<boolean> => {
        const membershipEdges = await graph.queryEdges({ from: userId, to: orgId, type: 'memberOf' })
        if (membershipEdges.length === 0) return false

        const membership = membershipEdges[0]!
        const role = membership.properties.role as string
        const permissions = membership.properties.permissions as string[]

        // Check role-based access
        if (role === 'owner' || role === 'admin') return true

        // Check permission-based access
        return permissions?.includes('users.manage') || permissions?.includes('*')
      }

      expect(await canManageUsers(owner.id, org.id)).toBe(true)
      expect(await canManageUsers(admin.id, org.id)).toBe(true)
      expect(await canManageUsers(member.id, org.id)).toBe(false)
      expect(await canManageUsers(guest.id, org.id)).toBe(false)
    })

    it('counts members by role type', async () => {
      const memberEdges = await graph.queryEdges({ to: org.id, type: 'memberOf' })

      const roleCounts: Record<string, number> = {}
      for (const edge of memberEdges) {
        const role = edge.properties.role as string
        roleCounts[role] = (roleCounts[role] ?? 0) + 1
      }

      expect(roleCounts['owner']).toBe(1)
      expect(roleCounts['admin']).toBe(1)
      expect(roleCounts['member']).toBe(1)
      expect(roleCounts['guest']).toBe(1)
      expect(roleCounts['billing']).toBe(1)
    })
  })
})

// ============================================================================
// 5. Agent Membership in Organizations
// ============================================================================

describe('Agent Membership in Organizations', () => {
  let graph: GraphEngine
  let org: Node
  let agentRalph: Node
  let agentPriya: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    org = await graph.createNode(
      'Organization',
      { name: 'AI Org', slug: 'ai-org', type: 'company', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-ai' }
    )

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

  describe('Create Agent Membership', () => {
    it('creates memberOf relationship between Agent and Organization', async () => {
      const edge = await graph.createEdge(agentRalph.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      expect(edge).toBeDefined()
      expect(edge.type).toBe('memberOf')
      expect(edge.from).toBe(agentRalph.id)
      expect(edge.to).toBe(org.id)
    })

    it('supports agent-specific membership properties', async () => {
      const edge = await graph.createEdge(agentRalph.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
        permissions: ['code.execute', 'files.read', 'files.write'],
      } satisfies MembershipProperties)

      expect(edge.properties.permissions).toContain('code.execute')
    })
  })

  describe('Mixed User and Agent Membership', () => {
    it('Organization can have both User and Agent members', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Human User', email: 'human@example.com', status: 'active' } satisfies UserProperties,
        { id: 'user-human' }
      )

      await graph.createEdge(user.id, 'memberOf', org.id, {
        role: 'owner',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(agentRalph.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(agentPriya.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const allMembers = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      expect(allMembers).toHaveLength(3)

      // Get member nodes and verify types
      const memberNodes = await Promise.all(allMembers.map((e) => graph.getNode(e.from)))
      const labels = memberNodes.map((n) => n?.label)

      expect(labels).toContain('User')
      expect(labels).toContain('Agent')
      expect(labels.filter((l) => l === 'Agent')).toHaveLength(2)
    })

    it('queries only User members', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Human', email: 'human@example.com', status: 'active' } satisfies UserProperties
      )

      await graph.createEdge(user.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(agentRalph.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const allMembers = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const memberNodes = await Promise.all(allMembers.map((e) => graph.getNode(e.from)))
      const userMembers = memberNodes.filter((n) => n?.label === 'User')

      expect(userMembers).toHaveLength(1)
      expect(userMembers[0]?.properties.name).toBe('Human')
    })

    it('queries only Agent members', async () => {
      const user = await graph.createNode(
        'User',
        { name: 'Human', email: 'human@example.com', status: 'active' } satisfies UserProperties
      )

      await graph.createEdge(user.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(agentRalph.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      await graph.createEdge(agentPriya.id, 'memberOf', org.id, {
        role: 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)

      const allMembers = await graph.queryEdges({ to: org.id, type: 'memberOf' })
      const memberNodes = await Promise.all(allMembers.map((e) => graph.getNode(e.from)))
      const agentMembers = memberNodes.filter((n) => n?.label === 'Agent')

      expect(agentMembers).toHaveLength(2)
      expect(agentMembers.map((a) => a?.properties.name)).toContain('ralph')
      expect(agentMembers.map((a) => a?.properties.name)).toContain('priya')
    })
  })
})

// ============================================================================
// 6. Organization Graph Statistics
// ============================================================================

describe('Organization Graph Statistics', () => {
  let graph: GraphEngine

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create Organizations
    const acme = await graph.createNode('Organization', {
      name: 'Acme',
      slug: 'acme',
      type: 'company',
      status: 'active',
    } satisfies OrganizationProperties)

    const startup = await graph.createNode('Organization', {
      name: 'Startup',
      slug: 'startup',
      type: 'company',
      status: 'active',
    } satisfies OrganizationProperties)

    // Create hierarchy
    const team1 = await graph.createNode('Organization', {
      name: 'Team 1',
      slug: 'team-1',
      type: 'team',
      status: 'active',
    } satisfies OrganizationProperties)

    await graph.createEdge(team1.id, 'childOf', acme.id)

    // Create Users with memberships
    for (let i = 1; i <= 5; i++) {
      const user = await graph.createNode('User', {
        name: `User ${i}`,
        email: `user${i}@example.com`,
        status: 'active',
      } satisfies UserProperties)

      await graph.createEdge(user.id, 'memberOf', acme.id, {
        role: i === 1 ? 'owner' : 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)
    }

    for (let i = 6; i <= 8; i++) {
      const user = await graph.createNode('User', {
        name: `User ${i}`,
        email: `user${i}@example.com`,
        status: 'active',
      } satisfies UserProperties)

      await graph.createEdge(user.id, 'memberOf', startup.id, {
        role: i === 6 ? 'owner' : 'member',
        joinedAt: Date.now(),
        status: 'active',
      } satisfies MembershipProperties)
    }

    // Add an agent
    const agent = await graph.createNode('Agent', {
      name: 'ralph',
      type: 'internal',
    } satisfies AgentProperties)

    await graph.createEdge(agent.id, 'memberOf', acme.id, {
      role: 'member',
      joinedAt: Date.now(),
      status: 'active',
    } satisfies MembershipProperties)
  })

  it('gets graph statistics including Organization counts', async () => {
    const stats = await graph.stats()

    expect(stats.nodeCount).toBe(12) // 3 orgs + 8 users + 1 agent
    expect(stats.labelCounts['Organization']).toBe(3)
    expect(stats.labelCounts['User']).toBe(8)
    expect(stats.labelCounts['Agent']).toBe(1)
    expect(stats.typeCounts['memberOf']).toBe(9) // 5 acme + 3 startup + 1 agent
    expect(stats.typeCounts['childOf']).toBe(1)
  })

  it('calculates Organization member count (degree)', async () => {
    const orgs = await graph.queryNodes({ label: 'Organization' })
    const acmeOrg = orgs.find((o) => o.properties.name === 'Acme')!
    const startupOrg = orgs.find((o) => o.properties.name === 'Startup')!

    const acmeDegree = await graph.degree(acmeOrg.id, 'INCOMING')
    const startupDegree = await graph.degree(startupOrg.id, 'INCOMING')

    // Acme has 5 user members + 1 agent + 1 childOf from team = 7
    expect(acmeDegree).toBe(7)

    // Startup has 3 user members
    expect(startupDegree).toBe(3)
  })

  it('counts total members across all Organizations', async () => {
    const memberOfEdges = await graph.queryEdges({ type: 'memberOf' })
    expect(memberOfEdges).toHaveLength(9)
  })
})

// ============================================================================
// 7. Organization Partner Relationships
// ============================================================================

describe('Organization Partner Relationships', () => {
  let graph: GraphEngine
  let acme: Node
  let partner1: Node
  let partner2: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    acme = await graph.createNode(
      'Organization',
      { name: 'Acme Corp', slug: 'acme-corp', type: 'company', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-acme' }
    )

    partner1 = await graph.createNode(
      'Organization',
      { name: 'Partner One', slug: 'partner-one', type: 'partner', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-partner-1' }
    )

    partner2 = await graph.createNode(
      'Organization',
      { name: 'Partner Two', slug: 'partner-two', type: 'partner', status: 'active' } satisfies OrganizationProperties,
      { id: 'org-partner-2' }
    )
  })

  describe('Partner Relationship CRUD', () => {
    it('creates partnersWith relationship between Organizations', async () => {
      const edge = await graph.createEdge(acme.id, 'partnersWith', partner1.id, {
        since: Date.now(),
        level: 'gold',
        contract: 'contract-123',
      })

      expect(edge).toBeDefined()
      expect(edge.type).toBe('partnersWith')
      expect(edge.from).toBe(acme.id)
      expect(edge.to).toBe(partner1.id)
      expect(edge.properties.level).toBe('gold')
    })

    it('supports bidirectional partner relationships', async () => {
      await graph.createEdge(acme.id, 'partnersWith', partner1.id, {
        since: Date.now(),
        level: 'gold',
      })

      await graph.createEdge(partner1.id, 'partnersWith', acme.id, {
        since: Date.now(),
        level: 'gold',
      })

      const acmePartners = await graph.queryEdges({ from: acme.id, type: 'partnersWith' })
      const partner1Partners = await graph.queryEdges({ from: partner1.id, type: 'partnersWith' })

      expect(acmePartners).toHaveLength(1)
      expect(partner1Partners).toHaveLength(1)
      expect(acmePartners[0]!.to).toBe(partner1.id)
      expect(partner1Partners[0]!.to).toBe(acme.id)
    })

    it('queries all partners of an Organization', async () => {
      await graph.createEdge(acme.id, 'partnersWith', partner1.id)
      await graph.createEdge(acme.id, 'partnersWith', partner2.id)

      const partners = await graph.queryEdges({ from: acme.id, type: 'partnersWith' })

      expect(partners).toHaveLength(2)
      expect(partners.map((e) => e.to)).toContain(partner1.id)
      expect(partners.map((e) => e.to)).toContain(partner2.id)
    })

    it('finds Organizations that partner with a specific Organization', async () => {
      await graph.createEdge(acme.id, 'partnersWith', partner1.id)

      const orgsPartneringWith = await graph.queryEdges({ to: partner1.id, type: 'partnersWith' })

      expect(orgsPartneringWith).toHaveLength(1)
      expect(orgsPartneringWith[0]!.from).toBe(acme.id)
    })
  })
})

// ============================================================================
// 8. RED PHASE: OrganizationStore Tests (WILL FAIL - Not Yet Implemented)
// ============================================================================

describe('OrganizationStore (RED - Not Yet Implemented)', () => {
  /**
   * These tests are designed to FAIL because OrganizationStore does not exist yet.
   * This is the TDD RED phase - write failing tests first, then implement.
   */

  it('exports OrganizationStore class from db/graph/organization', async () => {
    // This will FAIL - module does not exist
    const orgModule = await import('../organization').catch(() => null)

    expect(orgModule).not.toBeNull()
    expect(orgModule?.OrganizationStore).toBeDefined()
  })

  it('exports Organization type from db/graph/organization', async () => {
    const orgModule = await import('../organization').catch(() => null)

    expect(orgModule).not.toBeNull()
    // Type should be exported (runtime check for module existence)
  })

  it('exports Membership type from db/graph/organization', async () => {
    const orgModule = await import('../organization').catch(() => null)

    expect(orgModule).not.toBeNull()
    // Type should be exported
  })

  it('exports createOrganizationStore factory function', async () => {
    const orgModule = await import('../organization').catch(() => null)

    expect(orgModule).not.toBeNull()
    expect(orgModule?.createOrganizationStore).toBeDefined()
    expect(typeof orgModule?.createOrganizationStore).toBe('function')
  })
})

describe('OrganizationStore CRUD Operations (RED - Not Yet Implemented)', () => {
  it('OrganizationStore.create validates required fields', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented - waiting for db/graph/organization.ts')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    // Should throw when required fields are missing
    await expect(
      store.create({
        name: 'Test Org',
        // Missing: slug, type, status
      })
    ).rejects.toThrow()
  })

  it('OrganizationStore.create enforces unique slugs', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    await store.create({
      name: 'First Org',
      slug: 'unique-slug',
      type: 'company',
      status: 'active',
    })

    // Should throw for duplicate slug
    await expect(
      store.create({
        name: 'Second Org',
        slug: 'unique-slug', // Same slug - should fail
        type: 'company',
        status: 'active',
      })
    ).rejects.toThrow(/slug.*already exists/i)
  })

  it('OrganizationStore.findBySlug returns Organization by slug', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const org = await store.findBySlug('test-org')

    expect(org).toBeDefined()
    expect(org?.name).toBe('Test Org')
    expect(org?.slug).toBe('test-org')
  })

  it('OrganizationStore.findBySlug returns null for non-existent slug', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    const org = await store.findBySlug('non-existent')
    expect(org).toBeNull()
  })

  it('OrganizationStore.getMembers returns typed member list', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    // Add a user as member
    const user = await graph.createNode('User', {
      name: 'Alice',
      email: 'alice@example.com',
      status: 'active',
    })

    await store.addMember(org.id, user.id, {
      role: 'member',
      status: 'active',
    })

    const members = await store.getMembers(org.id)

    expect(members).toHaveLength(1)
    expect(members[0]!.userId).toBe(user.id)
    expect(members[0]!.role).toBe('member')
  })

  it('OrganizationStore.addMember enforces maxMembers limit', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Limited Org',
      slug: 'limited-org',
      type: 'company',
      status: 'active',
      plan: 'free',
      maxMembers: 2, // Only 2 members allowed
    })

    // Add first member
    const user1 = await graph.createNode('User', { name: 'User 1', email: 'u1@example.com', status: 'active' })
    await store.addMember(org.id, user1.id, { role: 'owner', status: 'active' })

    // Add second member
    const user2 = await graph.createNode('User', { name: 'User 2', email: 'u2@example.com', status: 'active' })
    await store.addMember(org.id, user2.id, { role: 'member', status: 'active' })

    // Third member should fail
    const user3 = await graph.createNode('User', { name: 'User 3', email: 'u3@example.com', status: 'active' })

    await expect(
      store.addMember(org.id, user3.id, { role: 'member', status: 'active' })
    ).rejects.toThrow(/member limit.*exceeded/i)
  })

  it('OrganizationStore.removeMember removes membership', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const user = await graph.createNode('User', { name: 'Alice', email: 'alice@example.com', status: 'active' })
    await store.addMember(org.id, user.id, { role: 'member', status: 'active' })

    // Remove member
    await store.removeMember(org.id, user.id)

    const members = await store.getMembers(org.id)
    expect(members).toHaveLength(0)
  })

  it('OrganizationStore.removeMember prevents removing last owner', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const owner = await graph.createNode('User', { name: 'Owner', email: 'owner@example.com', status: 'active' })
    await store.addMember(org.id, owner.id, { role: 'owner', status: 'active' })

    // Should fail - cannot remove last owner
    await expect(
      store.removeMember(org.id, owner.id)
    ).rejects.toThrow(/cannot remove.*last owner/i)
  })
})

describe('OrganizationStore Hierarchy Operations (RED - Not Yet Implemented)', () => {
  it('OrganizationStore.getParent returns parent Organization', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    const parent = await store.create({
      name: 'Parent Corp',
      slug: 'parent-corp',
      type: 'company',
      status: 'active',
    })

    const child = await store.create({
      name: 'Child Team',
      slug: 'child-team',
      type: 'team',
      status: 'active',
      parentId: parent.id, // Set parent on creation
    })

    const parentOrg = await store.getParent(child.id)

    expect(parentOrg).toBeDefined()
    expect(parentOrg?.id).toBe(parent.id)
  })

  it('OrganizationStore.getChildren returns child Organizations', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    const parent = await store.create({
      name: 'Parent Corp',
      slug: 'parent-corp',
      type: 'company',
      status: 'active',
    })

    await store.create({
      name: 'Child 1',
      slug: 'child-1',
      type: 'team',
      status: 'active',
      parentId: parent.id,
    })

    await store.create({
      name: 'Child 2',
      slug: 'child-2',
      type: 'team',
      status: 'active',
      parentId: parent.id,
    })

    const children = await store.getChildren(parent.id)

    expect(children).toHaveLength(2)
    expect(children.map((c: { name: string }) => c.name)).toContain('Child 1')
    expect(children.map((c: { name: string }) => c.name)).toContain('Child 2')
  })

  it('OrganizationStore.getAncestors returns all ancestors', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    const grandparent = await store.create({
      name: 'Grandparent',
      slug: 'grandparent',
      type: 'company',
      status: 'active',
    })

    const parent = await store.create({
      name: 'Parent',
      slug: 'parent',
      type: 'department',
      status: 'active',
      parentId: grandparent.id,
    })

    const child = await store.create({
      name: 'Child',
      slug: 'child',
      type: 'team',
      status: 'active',
      parentId: parent.id,
    })

    const ancestors = await store.getAncestors(child.id)

    expect(ancestors).toHaveLength(2)
    expect(ancestors.map((a: { id: string }) => a.id)).toContain(parent.id)
    expect(ancestors.map((a: { id: string }) => a.id)).toContain(grandparent.id)
  })

  it('OrganizationStore.getDescendants returns all descendants', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    const grandparent = await store.create({
      name: 'Grandparent',
      slug: 'grandparent',
      type: 'company',
      status: 'active',
    })

    const parent = await store.create({
      name: 'Parent',
      slug: 'parent',
      type: 'department',
      status: 'active',
      parentId: grandparent.id,
    })

    const child = await store.create({
      name: 'Child',
      slug: 'child',
      type: 'team',
      status: 'active',
      parentId: parent.id,
    })

    const descendants = await store.getDescendants(grandparent.id)

    expect(descendants).toHaveLength(2)
    expect(descendants.map((d: { id: string }) => d.id)).toContain(parent.id)
    expect(descendants.map((d: { id: string }) => d.id)).toContain(child.id)
  })
})

describe('OrganizationStore Member Role Operations (RED - Not Yet Implemented)', () => {
  it('OrganizationStore.getMemberRole returns member role', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const user = await graph.createNode('User', { name: 'Alice', email: 'alice@example.com', status: 'active' })
    await store.addMember(org.id, user.id, { role: 'admin', status: 'active' })

    const role = await store.getMemberRole(org.id, user.id)

    expect(role).toBe('admin')
  })

  it('OrganizationStore.updateMemberRole changes member role', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const user = await graph.createNode('User', { name: 'Alice', email: 'alice@example.com', status: 'active' })
    await store.addMember(org.id, user.id, { role: 'member', status: 'active' })

    await store.updateMemberRole(org.id, user.id, 'admin')

    const role = await store.getMemberRole(org.id, user.id)
    expect(role).toBe('admin')
  })

  it('OrganizationStore.isMember returns membership status', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const user1 = await graph.createNode('User', { name: 'Member', email: 'member@example.com', status: 'active' })
    const user2 = await graph.createNode('User', { name: 'NonMember', email: 'nonmember@example.com', status: 'active' })

    await store.addMember(org.id, user1.id, { role: 'member', status: 'active' })

    expect(await store.isMember(org.id, user1.id)).toBe(true)
    expect(await store.isMember(org.id, user2.id)).toBe(false)
  })

  it('OrganizationStore.isOwner returns owner status', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const owner = await graph.createNode('User', { name: 'Owner', email: 'owner@example.com', status: 'active' })
    const member = await graph.createNode('User', { name: 'Member', email: 'member@example.com', status: 'active' })

    await store.addMember(org.id, owner.id, { role: 'owner', status: 'active' })
    await store.addMember(org.id, member.id, { role: 'member', status: 'active' })

    expect(await store.isOwner(org.id, owner.id)).toBe(true)
    expect(await store.isOwner(org.id, member.id)).toBe(false)
  })

  it('OrganizationStore.isAdmin returns admin status', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({
      name: 'Test Org',
      slug: 'test-org',
      type: 'company',
      status: 'active',
    })

    const owner = await graph.createNode('User', { name: 'Owner', email: 'owner@example.com', status: 'active' })
    const admin = await graph.createNode('User', { name: 'Admin', email: 'admin@example.com', status: 'active' })
    const member = await graph.createNode('User', { name: 'Member', email: 'member@example.com', status: 'active' })

    await store.addMember(org.id, owner.id, { role: 'owner', status: 'active' })
    await store.addMember(org.id, admin.id, { role: 'admin', status: 'active' })
    await store.addMember(org.id, member.id, { role: 'member', status: 'active' })

    // Owner should also be considered admin
    expect(await store.isAdmin(org.id, owner.id)).toBe(true)
    expect(await store.isAdmin(org.id, admin.id)).toBe(true)
    expect(await store.isAdmin(org.id, member.id)).toBe(false)
  })
})

describe('OrganizationStore Query Operations (RED - Not Yet Implemented)', () => {
  it('OrganizationStore.findByType returns Organizations of specific type', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    await store.create({ name: 'Company 1', slug: 'company-1', type: 'company', status: 'active' })
    await store.create({ name: 'Company 2', slug: 'company-2', type: 'company', status: 'active' })
    await store.create({ name: 'Team 1', slug: 'team-1', type: 'team', status: 'active' })

    const companies = await store.findByType('company')

    expect(companies).toHaveLength(2)
    expect(companies.every((c: { type: string }) => c.type === 'company')).toBe(true)
  })

  it('OrganizationStore.findByPlan returns Organizations on specific plan', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    await store.create({ name: 'Free Org', slug: 'free-org', type: 'company', status: 'active', plan: 'free' })
    await store.create({ name: 'Enterprise Org', slug: 'enterprise-org', type: 'company', status: 'active', plan: 'enterprise' })
    await store.create({ name: 'Pro Org', slug: 'pro-org', type: 'company', status: 'active', plan: 'pro' })

    const enterpriseOrgs = await store.findByPlan('enterprise')

    expect(enterpriseOrgs).toHaveLength(1)
    expect(enterpriseOrgs[0]!.name).toBe('Enterprise Org')
  })

  it('OrganizationStore.findByStatus returns Organizations with specific status', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const store = orgModule.createOrganizationStore(new GraphEngine())

    await store.create({ name: 'Active Org', slug: 'active-org', type: 'company', status: 'active' })
    await store.create({ name: 'Suspended Org', slug: 'suspended-org', type: 'company', status: 'suspended' })
    await store.create({ name: 'Archived Org', slug: 'archived-org', type: 'company', status: 'archived' })

    const activeOrgs = await store.findByStatus('active')

    expect(activeOrgs).toHaveLength(1)
    expect(activeOrgs[0]!.name).toBe('Active Org')
  })

  it('OrganizationStore.getUserOrganizations returns all organizations for a user', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org1 = await store.create({ name: 'Org 1', slug: 'org-1', type: 'company', status: 'active' })
    const org2 = await store.create({ name: 'Org 2', slug: 'org-2', type: 'company', status: 'active' })
    await store.create({ name: 'Org 3', slug: 'org-3', type: 'company', status: 'active' }) // User not member

    const user = await graph.createNode('User', { name: 'Alice', email: 'alice@example.com', status: 'active' })

    await store.addMember(org1.id, user.id, { role: 'owner', status: 'active' })
    await store.addMember(org2.id, user.id, { role: 'member', status: 'active' })

    const userOrgs = await store.getUserOrganizations(user.id)

    expect(userOrgs).toHaveLength(2)
    expect(userOrgs.map((o: { id: string }) => o.id)).toContain(org1.id)
    expect(userOrgs.map((o: { id: string }) => o.id)).toContain(org2.id)
  })

  it('OrganizationStore.countMembers returns member count', async () => {
    const orgModule = await import('../organization').catch(() => null)
    if (!orgModule?.createOrganizationStore) {
      throw new Error('OrganizationStore not implemented')
    }

    const graph = new GraphEngine()
    const store = orgModule.createOrganizationStore(graph)

    const org = await store.create({ name: 'Test Org', slug: 'test-org', type: 'company', status: 'active' })

    for (let i = 1; i <= 5; i++) {
      const user = await graph.createNode('User', { name: `User ${i}`, email: `user${i}@example.com`, status: 'active' })
      await store.addMember(org.id, user.id, { role: i === 1 ? 'owner' : 'member', status: 'active' })
    }

    const count = await store.countMembers(org.id)
    expect(count).toBe(5)
  })
})
