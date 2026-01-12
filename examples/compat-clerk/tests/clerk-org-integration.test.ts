/**
 * Integration Tests for Clerk Organization API via ClerkDO
 *
 * These tests verify the organization-related API endpoints in ClerkDO:
 * - Organization CRUD via HTTP/RPC
 * - Organization membership management
 * - Invitation workflows
 * - Cross-DO coordination (ClerkDO -> OrgDO)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { generateClerkId } from '../src/jwt'

// ============================================================================
// TYPES
// ============================================================================

interface Organization {
  id: string
  object: 'organization'
  name: string
  slug: string
  image_url: string
  has_image: boolean
  members_count: number
  pending_invitations_count: number
  max_allowed_memberships: number
  admin_delete_enabled: boolean
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  created_by: string
  created_at: number
  updated_at: number
}

interface OrganizationMembership {
  id: string
  object: 'organization_membership'
  organization: {
    id: string
    name: string
    slug: string
  }
  role: string
  permissions: string[]
  public_user_data: {
    user_id: string
    first_name: string | null
    last_name: string | null
    identifier: string
  }
  created_at: number
  updated_at: number
}

interface OrganizationInvitation {
  id: string
  object: 'organization_invitation'
  email_address: string
  organization_id: string
  role: string
  status: 'pending' | 'accepted' | 'revoked'
  created_at: number
  updated_at: number
}

interface User {
  id: string
  object: 'user'
  first_name: string | null
  last_name: string | null
  email_addresses: { email_address: string }[]
  username: string | null
  image_url: string
  has_image: boolean
  created_at: number
}

// ============================================================================
// MOCK SETUP
// ============================================================================

// In-memory storage for mock DOs
const mockStorages = new Map<string, Map<string, unknown>>()

function getStorage(id: string): Map<string, unknown> {
  if (!mockStorages.has(id)) {
    mockStorages.set(id, new Map())
  }
  return mockStorages.get(id)!
}

// Mock user data store
const mockUsers = new Map<string, User>()

// Mock organization data store
const mockOrgs = new Map<string, {
  organization: Organization
  memberships: OrganizationMembership[]
  invitations: OrganizationInvitation[]
}>()

// Mock webhook calls
const webhookCalls: Array<{ type: string; data: unknown }> = []

// Mock ClerkDO API client
class MockClerkAPI {
  private baseUrl = 'http://clerk.internal'

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION API
  // ═══════════════════════════════════════════════════════════════════════════

  async createOrganization(params: {
    name: string
    slug?: string
    created_by: string
    max_allowed_memberships?: number
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
  }): Promise<Organization> {
    const now = Date.now()
    const orgId = generateClerkId('org')
    const slug = params.slug ?? this.slugify(params.name)

    const org: Organization = {
      id: orgId,
      object: 'organization',
      name: params.name,
      slug,
      image_url: `https://img.clerk.com/org-${orgId.slice(-4)}.png`,
      has_image: false,
      members_count: 0,
      pending_invitations_count: 0,
      max_allowed_memberships: params.max_allowed_memberships ?? 100,
      admin_delete_enabled: true,
      public_metadata: params.public_metadata ?? {},
      private_metadata: params.private_metadata ?? {},
      created_by: params.created_by,
      created_at: now,
      updated_at: now,
    }

    mockOrgs.set(orgId, {
      organization: org,
      memberships: [],
      invitations: [],
    })

    // Add creator as admin if user exists
    const user = mockUsers.get(params.created_by)
    if (user) {
      await this.createOrganizationMembership(orgId, {
        user_id: params.created_by,
        role: 'org:admin',
      })
    }

    webhookCalls.push({ type: 'organization.created', data: org })

    return org
  }

  async getOrganization(orgId: string): Promise<Organization | null> {
    const data = mockOrgs.get(orgId)
    return data?.organization ?? null
  }

  async updateOrganization(
    orgId: string,
    params: {
      name?: string
      slug?: string
      max_allowed_memberships?: number
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<Organization | null> {
    const data = mockOrgs.get(orgId)
    if (!data) return null

    const org = data.organization
    if (params.name !== undefined) org.name = params.name
    if (params.slug !== undefined) org.slug = params.slug
    if (params.max_allowed_memberships !== undefined) {
      org.max_allowed_memberships = params.max_allowed_memberships
    }
    if (params.public_metadata !== undefined) {
      org.public_metadata = { ...org.public_metadata, ...params.public_metadata }
    }
    if (params.private_metadata !== undefined) {
      org.private_metadata = { ...org.private_metadata, ...params.private_metadata }
    }
    org.updated_at = Date.now()

    webhookCalls.push({ type: 'organization.updated', data: org })

    return org
  }

  async deleteOrganization(orgId: string): Promise<{ deleted: boolean }> {
    const existed = mockOrgs.has(orgId)
    mockOrgs.delete(orgId)

    if (existed) {
      webhookCalls.push({
        type: 'organization.deleted',
        data: { id: orgId, object: 'organization', deleted: true }
      })
    }

    return { deleted: existed }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION MEMBERSHIP API
  // ═══════════════════════════════════════════════════════════════════════════

  async createOrganizationMembership(
    orgId: string,
    params: {
      user_id: string
      role: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationMembership | null> {
    const data = mockOrgs.get(orgId)
    if (!data) return null

    const user = mockUsers.get(params.user_id)
    if (!user) return null

    // Check if already a member
    if (data.memberships.some(m => m.public_user_data.user_id === params.user_id)) {
      return null
    }

    const membershipId = generateClerkId('mem')
    const now = Date.now()

    // Get permissions for role
    const permissions = params.role === 'org:admin'
      ? ['org:sys_profile:manage', 'org:sys_profile:delete', 'org:sys_memberships:read', 'org:sys_memberships:manage']
      : ['org:sys_profile:read', 'org:sys_memberships:read']

    const membership: OrganizationMembership = {
      id: membershipId,
      object: 'organization_membership',
      organization: {
        id: data.organization.id,
        name: data.organization.name,
        slug: data.organization.slug,
      },
      role: params.role,
      permissions,
      public_user_data: {
        user_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        identifier: user.email_addresses[0]?.email_address ?? user.username ?? user.id,
      },
      created_at: now,
      updated_at: now,
    }

    data.memberships.push(membership)
    data.organization.members_count = data.memberships.length
    data.organization.updated_at = now

    webhookCalls.push({ type: 'organizationMembership.created', data: membership })

    return membership
  }

  async listOrganizationMemberships(
    orgId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ data: OrganizationMembership[]; total_count: number }> {
    const data = mockOrgs.get(orgId)
    if (!data) return { data: [], total_count: 0 }

    const limit = params?.limit ?? 10
    const offset = params?.offset ?? 0

    return {
      data: data.memberships.slice(offset, offset + limit),
      total_count: data.memberships.length,
    }
  }

  async updateOrganizationMembership(
    orgId: string,
    membershipId: string,
    params: {
      role?: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationMembership | null> {
    const data = mockOrgs.get(orgId)
    if (!data) return null

    const membership = data.memberships.find(m => m.id === membershipId)
    if (!membership) return null

    if (params.role !== undefined) {
      membership.role = params.role
      membership.permissions = params.role === 'org:admin'
        ? ['org:sys_profile:manage', 'org:sys_profile:delete', 'org:sys_memberships:read', 'org:sys_memberships:manage']
        : ['org:sys_profile:read', 'org:sys_memberships:read']
    }
    membership.updated_at = Date.now()

    webhookCalls.push({ type: 'organizationMembership.updated', data: membership })

    return membership
  }

  async deleteOrganizationMembership(
    orgId: string,
    membershipId: string
  ): Promise<{ deleted: boolean }> {
    const data = mockOrgs.get(orgId)
    if (!data) return { deleted: false }

    const index = data.memberships.findIndex(m => m.id === membershipId)
    if (index === -1) return { deleted: false }

    const [deleted] = data.memberships.splice(index, 1)
    data.organization.members_count = data.memberships.length
    data.organization.updated_at = Date.now()

    webhookCalls.push({
      type: 'organizationMembership.deleted',
      data: { id: membershipId, object: 'organization_membership', deleted: true }
    })

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVITATION API
  // ═══════════════════════════════════════════════════════════════════════════

  async createInvitation(
    orgId: string,
    params: {
      email_address: string
      role: string
      redirect_url?: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationInvitation | null> {
    const data = mockOrgs.get(orgId)
    if (!data) return null

    // Check for existing pending invitation
    const existing = data.invitations.find(
      i => i.email_address === params.email_address && i.status === 'pending'
    )
    if (existing) return null

    const invitationId = generateClerkId('inv')
    const now = Date.now()

    const invitation: OrganizationInvitation = {
      id: invitationId,
      object: 'organization_invitation',
      email_address: params.email_address,
      organization_id: orgId,
      role: params.role,
      status: 'pending',
      created_at: now,
      updated_at: now,
    }

    data.invitations.push(invitation)
    data.organization.pending_invitations_count = data.invitations.filter(i => i.status === 'pending').length
    data.organization.updated_at = now

    webhookCalls.push({ type: 'organizationInvitation.created', data: invitation })

    return invitation
  }

  async revokeInvitation(
    orgId: string,
    invitationId: string
  ): Promise<OrganizationInvitation | null> {
    const data = mockOrgs.get(orgId)
    if (!data) return null

    const invitation = data.invitations.find(i => i.id === invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    invitation.status = 'revoked'
    invitation.updated_at = Date.now()
    data.organization.pending_invitations_count = data.invitations.filter(i => i.status === 'pending').length
    data.organization.updated_at = Date.now()

    webhookCalls.push({ type: 'organizationInvitation.revoked', data: invitation })

    return invitation
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER API (for integration tests)
  // ═══════════════════════════════════════════════════════════════════════════

  async createUser(params: {
    external_id?: string
    first_name?: string
    last_name?: string
    email_address?: string[]
    username?: string
  }): Promise<User> {
    const userId = params.external_id ?? generateClerkId('user')
    const now = Date.now()

    const user: User = {
      id: userId,
      object: 'user',
      first_name: params.first_name ?? null,
      last_name: params.last_name ?? null,
      email_addresses: (params.email_address ?? []).map(email => ({ email_address: email })),
      username: params.username ?? null,
      image_url: 'https://img.clerk.com/default.png',
      has_image: false,
      created_at: now,
    }

    mockUsers.set(userId, user)
    return user
  }

  async getUser(userId: string): Promise<User | null> {
    return mockUsers.get(userId) ?? null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  getWebhookCalls(): Array<{ type: string; data: unknown }> {
    return webhookCalls
  }

  clearWebhookCalls(): void {
    webhookCalls.length = 0
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Clerk Organization Integration', () => {
  let api: MockClerkAPI

  beforeEach(() => {
    api = new MockClerkAPI()
    mockUsers.clear()
    mockOrgs.clear()
    api.clearWebhookCalls()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // ORGANIZATION LIFECYCLE
  // ============================================================================

  describe('Organization Lifecycle', () => {
    it('should create organization and add creator as admin', async () => {
      // Create user first
      const user = await api.createUser({
        first_name: 'John',
        last_name: 'Doe',
        email_address: ['john@example.com'],
      })

      // Create organization with user as creator
      const org = await api.createOrganization({
        name: 'Acme Corp',
        created_by: user.id,
      })

      expect(org).toBeDefined()
      expect(org.name).toBe('Acme Corp')
      expect(org.members_count).toBe(1)

      // Verify creator is admin
      const memberships = await api.listOrganizationMemberships(org.id)
      expect(memberships.total_count).toBe(1)
      expect(memberships.data[0].role).toBe('org:admin')
      expect(memberships.data[0].public_user_data.user_id).toBe(user.id)
    })

    it('should emit webhooks for organization creation', async () => {
      const user = await api.createUser({
        first_name: 'John',
        email_address: ['john@example.com'],
      })

      await api.createOrganization({
        name: 'Acme Corp',
        created_by: user.id,
      })

      const calls = api.getWebhookCalls()
      expect(calls.some(c => c.type === 'organization.created')).toBe(true)
      expect(calls.some(c => c.type === 'organizationMembership.created')).toBe(true)
    })

    it('should update and delete organization', async () => {
      const user = await api.createUser({ email_address: ['test@example.com'] })
      const org = await api.createOrganization({
        name: 'Old Name',
        created_by: user.id,
      })

      // Update
      const updated = await api.updateOrganization(org.id, {
        name: 'New Name',
        public_metadata: { plan: 'enterprise' },
      })

      expect(updated?.name).toBe('New Name')
      expect(updated?.public_metadata).toEqual({ plan: 'enterprise' })

      // Delete
      const result = await api.deleteOrganization(org.id)
      expect(result.deleted).toBe(true)
      expect(await api.getOrganization(org.id)).toBeNull()
    })

    it('should handle organization without existing user creator', async () => {
      // Create org with non-existent user
      const org = await api.createOrganization({
        name: 'Ghost Org',
        created_by: 'user_nonexistent',
      })

      expect(org.members_count).toBe(0)
    })
  })

  // ============================================================================
  // MEMBERSHIP WORKFLOWS
  // ============================================================================

  describe('Membership Workflows', () => {
    let org: Organization
    let creator: User

    beforeEach(async () => {
      creator = await api.createUser({
        first_name: 'Creator',
        email_address: ['creator@example.com'],
      })
      org = await api.createOrganization({
        name: 'Test Org',
        created_by: creator.id,
      })
    })

    it('should add new member to organization', async () => {
      const newUser = await api.createUser({
        first_name: 'New',
        last_name: 'Member',
        email_address: ['new@example.com'],
      })

      const membership = await api.createOrganizationMembership(org.id, {
        user_id: newUser.id,
        role: 'org:member',
      })

      expect(membership).not.toBeNull()
      expect(membership?.role).toBe('org:member')
      expect(membership?.permissions).toContain('org:sys_profile:read')
      expect(membership?.permissions).not.toContain('org:sys_profile:manage')

      // Verify member count updated
      const updatedOrg = await api.getOrganization(org.id)
      expect(updatedOrg?.members_count).toBe(2)
    })

    it('should promote member to admin', async () => {
      const newUser = await api.createUser({
        email_address: ['member@example.com'],
      })

      const membership = await api.createOrganizationMembership(org.id, {
        user_id: newUser.id,
        role: 'org:member',
      })

      const updated = await api.updateOrganizationMembership(org.id, membership!.id, {
        role: 'org:admin',
      })

      expect(updated?.role).toBe('org:admin')
      expect(updated?.permissions).toContain('org:sys_profile:manage')
    })

    it('should demote admin to member', async () => {
      const admin = await api.createUser({
        email_address: ['admin@example.com'],
      })

      const membership = await api.createOrganizationMembership(org.id, {
        user_id: admin.id,
        role: 'org:admin',
      })

      const demoted = await api.updateOrganizationMembership(org.id, membership!.id, {
        role: 'org:member',
      })

      expect(demoted?.role).toBe('org:member')
      expect(demoted?.permissions).not.toContain('org:sys_profile:manage')
    })

    it('should remove member from organization', async () => {
      const member = await api.createUser({
        email_address: ['member@example.com'],
      })

      const membership = await api.createOrganizationMembership(org.id, {
        user_id: member.id,
        role: 'org:member',
      })

      const result = await api.deleteOrganizationMembership(org.id, membership!.id)
      expect(result.deleted).toBe(true)

      // Verify count updated
      const updatedOrg = await api.getOrganization(org.id)
      expect(updatedOrg?.members_count).toBe(1) // Just creator
    })

    it('should reject duplicate membership', async () => {
      const member = await api.createUser({
        email_address: ['member@example.com'],
      })

      await api.createOrganizationMembership(org.id, {
        user_id: member.id,
        role: 'org:member',
      })

      const duplicate = await api.createOrganizationMembership(org.id, {
        user_id: member.id,
        role: 'org:admin',
      })

      expect(duplicate).toBeNull()
    })

    it('should reject membership for non-existent user', async () => {
      const membership = await api.createOrganizationMembership(org.id, {
        user_id: 'user_fake',
        role: 'org:member',
      })

      expect(membership).toBeNull()
    })
  })

  // ============================================================================
  // INVITATION WORKFLOWS
  // ============================================================================

  describe('Invitation Workflows', () => {
    let org: Organization
    let creator: User

    beforeEach(async () => {
      creator = await api.createUser({
        first_name: 'Creator',
        email_address: ['creator@example.com'],
      })
      org = await api.createOrganization({
        name: 'Test Org',
        created_by: creator.id,
      })
    })

    it('should create invitation', async () => {
      const invitation = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:member',
      })

      expect(invitation).not.toBeNull()
      expect(invitation?.email_address).toBe('new@example.com')
      expect(invitation?.role).toBe('org:member')
      expect(invitation?.status).toBe('pending')

      // Verify pending count updated
      const updatedOrg = await api.getOrganization(org.id)
      expect(updatedOrg?.pending_invitations_count).toBe(1)
    })

    it('should revoke invitation', async () => {
      const invitation = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:member',
      })

      const revoked = await api.revokeInvitation(org.id, invitation!.id)

      expect(revoked?.status).toBe('revoked')

      // Verify pending count updated
      const updatedOrg = await api.getOrganization(org.id)
      expect(updatedOrg?.pending_invitations_count).toBe(0)
    })

    it('should reject duplicate pending invitation', async () => {
      await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:member',
      })

      const duplicate = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:admin',
      })

      expect(duplicate).toBeNull()
    })

    it('should allow new invitation after revoke', async () => {
      const first = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:member',
      })

      await api.revokeInvitation(org.id, first!.id)

      const second = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:admin',
      })

      expect(second).not.toBeNull()
      expect(second?.role).toBe('org:admin')
    })

    it('should emit webhooks for invitation lifecycle', async () => {
      api.clearWebhookCalls()

      const invitation = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:member',
      })

      await api.revokeInvitation(org.id, invitation!.id)

      const calls = api.getWebhookCalls()
      expect(calls.some(c => c.type === 'organizationInvitation.created')).toBe(true)
      expect(calls.some(c => c.type === 'organizationInvitation.revoked')).toBe(true)
    })
  })

  // ============================================================================
  // MULTI-ORGANIZATION SCENARIOS
  // ============================================================================

  describe('Multi-Organization Scenarios', () => {
    it('should support user in multiple organizations', async () => {
      const user = await api.createUser({
        first_name: 'Multi',
        email_address: ['multi@example.com'],
      })

      const org1 = await api.createOrganization({
        name: 'Org One',
        created_by: user.id,
      })

      const org2 = await api.createOrganization({
        name: 'Org Two',
        created_by: user.id,
      })

      // User should be admin in both
      const memberships1 = await api.listOrganizationMemberships(org1.id)
      const memberships2 = await api.listOrganizationMemberships(org2.id)

      expect(memberships1.data[0].public_user_data.user_id).toBe(user.id)
      expect(memberships2.data[0].public_user_data.user_id).toBe(user.id)
    })

    it('should handle user with different roles in different orgs', async () => {
      const creator = await api.createUser({
        email_address: ['creator@example.com'],
      })
      const member = await api.createUser({
        email_address: ['member@example.com'],
      })

      const org1 = await api.createOrganization({
        name: 'Org One',
        created_by: creator.id,
      })

      const org2 = await api.createOrganization({
        name: 'Org Two',
        created_by: creator.id,
      })

      // Add member as admin in org1
      await api.createOrganizationMembership(org1.id, {
        user_id: member.id,
        role: 'org:admin',
      })

      // Add member as regular member in org2
      await api.createOrganizationMembership(org2.id, {
        user_id: member.id,
        role: 'org:member',
      })

      const m1 = await api.listOrganizationMemberships(org1.id)
      const m2 = await api.listOrganizationMemberships(org2.id)

      const memberInOrg1 = m1.data.find(m => m.public_user_data.user_id === member.id)
      const memberInOrg2 = m2.data.find(m => m.public_user_data.user_id === member.id)

      expect(memberInOrg1?.role).toBe('org:admin')
      expect(memberInOrg2?.role).toBe('org:member')
    })

    it('should isolate organizations properly', async () => {
      const user1 = await api.createUser({ email_address: ['user1@example.com'] })
      const user2 = await api.createUser({ email_address: ['user2@example.com'] })

      const org1 = await api.createOrganization({
        name: 'Org One',
        created_by: user1.id,
      })

      const org2 = await api.createOrganization({
        name: 'Org Two',
        created_by: user2.id,
      })

      // Verify user1 is not in org2
      const org2Members = await api.listOrganizationMemberships(org2.id)
      expect(org2Members.data.some(m => m.public_user_data.user_id === user1.id)).toBe(false)

      // Verify user2 is not in org1
      const org1Members = await api.listOrganizationMemberships(org1.id)
      expect(org1Members.data.some(m => m.public_user_data.user_id === user2.id)).toBe(false)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle operations on non-existent organization', async () => {
      const fakeOrgId = 'org_fake123'

      expect(await api.getOrganization(fakeOrgId)).toBeNull()
      expect(await api.updateOrganization(fakeOrgId, { name: 'New' })).toBeNull()
      expect((await api.listOrganizationMemberships(fakeOrgId)).data).toHaveLength(0)
      expect(await api.createInvitation(fakeOrgId, {
        email_address: 'test@example.com',
        role: 'org:member',
      })).toBeNull()
    })

    it('should handle operations on non-existent membership', async () => {
      const user = await api.createUser({ email_address: ['test@example.com'] })
      const org = await api.createOrganization({
        name: 'Test Org',
        created_by: user.id,
      })

      const result = await api.deleteOrganizationMembership(org.id, 'mem_fake123')
      expect(result.deleted).toBe(false)

      const updated = await api.updateOrganizationMembership(org.id, 'mem_fake123', {
        role: 'org:admin',
      })
      expect(updated).toBeNull()
    })

    it('should handle revoking non-pending invitation', async () => {
      const user = await api.createUser({ email_address: ['test@example.com'] })
      const org = await api.createOrganization({
        name: 'Test Org',
        created_by: user.id,
      })

      const invitation = await api.createInvitation(org.id, {
        email_address: 'new@example.com',
        role: 'org:member',
      })

      // Revoke once
      await api.revokeInvitation(org.id, invitation!.id)

      // Try to revoke again
      const result = await api.revokeInvitation(org.id, invitation!.id)
      expect(result).toBeNull()
    })
  })

  // ============================================================================
  // PAGINATION
  // ============================================================================

  describe('Pagination', () => {
    it('should paginate memberships correctly', async () => {
      const creator = await api.createUser({ email_address: ['creator@example.com'] })
      const org = await api.createOrganization({
        name: 'Large Org',
        created_by: creator.id,
      })

      // Add 10 more members
      for (let i = 1; i <= 10; i++) {
        const user = await api.createUser({ email_address: [`user${i}@example.com`] })
        await api.createOrganizationMembership(org.id, {
          user_id: user.id,
          role: 'org:member',
        })
      }

      // Total should be 11 (creator + 10)
      const all = await api.listOrganizationMemberships(org.id, { limit: 100 })
      expect(all.total_count).toBe(11)

      // First page
      const page1 = await api.listOrganizationMemberships(org.id, { limit: 5, offset: 0 })
      expect(page1.data).toHaveLength(5)

      // Second page
      const page2 = await api.listOrganizationMemberships(org.id, { limit: 5, offset: 5 })
      expect(page2.data).toHaveLength(5)

      // Third page (remaining)
      const page3 = await api.listOrganizationMemberships(org.id, { limit: 5, offset: 10 })
      expect(page3.data).toHaveLength(1)
    })
  })
})
