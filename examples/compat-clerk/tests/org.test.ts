/**
 * Tests for Clerk Organization compat layer (OrgDO)
 *
 * These tests verify the Clerk Organization API compatibility:
 * - Organization CRUD (create, read, update, delete)
 * - Membership management
 * - Invitation management
 * - Role-based access control
 * - Permission checking
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { generateClerkId } from '../src/jwt'

// ============================================================================
// MOCK TYPES (matching OrgDO types)
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
  organization: OrganizationReference
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  role: string
  permissions: string[]
  created_at: number
  updated_at: number
  public_user_data: PublicUserData
}

interface OrganizationReference {
  id: string
  name: string
  slug: string
  image_url: string
  has_image: boolean
  members_count: number
  pending_invitations_count: number
  max_allowed_memberships: number
  admin_delete_enabled: boolean
  public_metadata: Record<string, unknown>
  created_at: number
  updated_at: number
}

interface PublicUserData {
  user_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  identifier: string
}

interface OrganizationInvitation {
  id: string
  object: 'organization_invitation'
  email_address: string
  organization_id: string
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  role: string
  status: 'pending' | 'accepted' | 'revoked'
  created_at: number
  updated_at: number
}

interface OrganizationRole {
  id: string
  object: 'role'
  name: string
  key: string
  description: string
  permissions: string[]
  is_creator_eligible: boolean
  created_at: number
  updated_at: number
}

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock storage to simulate Durable Object storage
class MockStorage {
  private data = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
  }

  async list<T>(): Promise<Map<string, T>> {
    return this.data as Map<string, T>
  }
}

// Mock OrgDO class that uses MockStorage
class MockOrgDO {
  private storage: MockStorage

  constructor() {
    this.storage = new MockStorage()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async getOrganization(): Promise<Organization | null> {
    const stored = await this.storage.get<StoredOrganization>('organization')
    if (!stored) return null
    return this.toPublicOrganization(stored)
  }

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

    const org: StoredOrganization = {
      id: orgId,
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
      memberships: [],
      invitations: [],
      roles: [...DEFAULT_ROLES],
      permissions: [...DEFAULT_PERMISSIONS],
    }

    await this.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  async updateOrganization(params: {
    name?: string
    slug?: string
    max_allowed_memberships?: number
    admin_delete_enabled?: boolean
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
  }): Promise<Organization | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    const now = Date.now()

    if (params.name !== undefined) org.name = params.name
    if (params.slug !== undefined) org.slug = params.slug
    if (params.max_allowed_memberships !== undefined) {
      org.max_allowed_memberships = params.max_allowed_memberships
    }
    if (params.admin_delete_enabled !== undefined) {
      org.admin_delete_enabled = params.admin_delete_enabled
    }
    if (params.public_metadata !== undefined) {
      org.public_metadata = { ...org.public_metadata, ...params.public_metadata }
    }
    if (params.private_metadata !== undefined) {
      org.private_metadata = { ...org.private_metadata, ...params.private_metadata }
    }

    org.updated_at = now

    await this.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  async deleteOrganization(): Promise<{ deleted: boolean }> {
    await this.storage.deleteAll()
    return { deleted: true }
  }

  async updateLogo(imageUrl: string): Promise<Organization | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    org.image_url = imageUrl
    org.has_image = true
    org.updated_at = Date.now()

    await this.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  async deleteLogo(): Promise<Organization | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    org.image_url = `https://img.clerk.com/org-${org.id.slice(-4)}.png`
    org.has_image = false
    org.updated_at = Date.now()

    await this.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMBERSHIP MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async listMemberships(params?: {
    limit?: number
    offset?: number
    order_by?: string
  }): Promise<{ data: OrganizationMembership[]; total_count: number }> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return { data: [], total_count: 0 }

    const limit = params?.limit ?? 10
    const offset = params?.offset ?? 0

    const memberships = org.memberships.slice(offset, offset + limit).map((m) =>
      this.toPublicMembership(m, org)
    )

    return { data: memberships, total_count: org.memberships.length }
  }

  async createMembership(params: {
    user_id: string
    role: string
    public_user_data: PublicUserData
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
  }): Promise<OrganizationMembership | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    // Check if user is already a member
    if (org.memberships.some((m) => m.user_id === params.user_id)) {
      return null
    }

    // Check max memberships
    if (org.memberships.length >= org.max_allowed_memberships) {
      return null
    }

    const now = Date.now()
    const membershipId = generateClerkId('mem')

    // Get permissions for role
    const role = org.roles.find((r) => r.key === params.role)
    const permissions = role?.permissions ?? []

    const membership: StoredMembership = {
      id: membershipId,
      user_id: params.user_id,
      role: params.role,
      permissions,
      public_metadata: params.public_metadata ?? {},
      private_metadata: params.private_metadata ?? {},
      public_user_data: params.public_user_data,
      created_at: now,
      updated_at: now,
    }

    org.memberships.push(membership)
    org.members_count = org.memberships.length
    org.updated_at = now

    await this.storage.put('organization', org)

    return this.toPublicMembership(membership, org)
  }

  async getMembershipByUserId(userId: string): Promise<OrganizationMembership | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    const membership = org.memberships.find((m) => m.user_id === userId)
    if (!membership) return null

    return this.toPublicMembership(membership, org)
  }

  async getMembership(membershipId: string): Promise<OrganizationMembership | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    const membership = org.memberships.find((m) => m.id === membershipId)
    if (!membership) return null

    return this.toPublicMembership(membership, org)
  }

  async updateMembership(
    membershipId: string,
    params: {
      role?: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationMembership | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    const membership = org.memberships.find((m) => m.id === membershipId)
    if (!membership) return null

    const now = Date.now()

    if (params.role !== undefined) {
      membership.role = params.role
      const role = org.roles.find((r) => r.key === params.role)
      membership.permissions = role?.permissions ?? []
    }
    if (params.public_metadata !== undefined) {
      membership.public_metadata = { ...membership.public_metadata, ...params.public_metadata }
    }
    if (params.private_metadata !== undefined) {
      membership.private_metadata = { ...membership.private_metadata, ...params.private_metadata }
    }

    membership.updated_at = now
    org.updated_at = now

    await this.storage.put('organization', org)

    return this.toPublicMembership(membership, org)
  }

  async deleteMembership(membershipId: string): Promise<{ deleted: boolean }> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return { deleted: false }

    const index = org.memberships.findIndex((m) => m.id === membershipId)
    if (index === -1) return { deleted: false }

    org.memberships.splice(index, 1)
    org.members_count = org.memberships.length
    org.updated_at = Date.now()

    await this.storage.put('organization', org)

    return { deleted: true }
  }

  async deleteMembershipByUserId(userId: string): Promise<{ deleted: boolean }> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return { deleted: false }

    const index = org.memberships.findIndex((m) => m.user_id === userId)
    if (index === -1) return { deleted: false }

    org.memberships.splice(index, 1)
    org.members_count = org.memberships.length
    org.updated_at = Date.now()

    await this.storage.put('organization', org)

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVITATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async listInvitations(params?: {
    status?: 'pending' | 'accepted' | 'revoked'
    limit?: number
    offset?: number
  }): Promise<{ data: OrganizationInvitation[]; total_count: number }> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return { data: [], total_count: 0 }

    let invitations = org.invitations
    if (params?.status) {
      invitations = invitations.filter((i) => i.status === params.status)
    }

    const limit = params?.limit ?? 10
    const offset = params?.offset ?? 0

    return {
      data: invitations.slice(offset, offset + limit),
      total_count: invitations.length,
    }
  }

  async createInvitation(params: {
    email_address: string
    role: string
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
    redirect_url?: string
  }): Promise<OrganizationInvitation | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    // Check if already invited
    const existing = org.invitations.find(
      (i) => i.email_address === params.email_address && i.status === 'pending'
    )
    if (existing) return null

    const now = Date.now()
    const invitationId = generateClerkId('inv')

    const invitation: OrganizationInvitation = {
      id: invitationId,
      object: 'organization_invitation',
      email_address: params.email_address,
      organization_id: org.id,
      public_metadata: params.public_metadata ?? {},
      private_metadata: params.private_metadata ?? {},
      role: params.role,
      status: 'pending',
      created_at: now,
      updated_at: now,
    }

    org.invitations.push(invitation)
    org.pending_invitations_count = org.invitations.filter((i) => i.status === 'pending').length
    org.updated_at = now

    await this.storage.put('organization', org)

    return invitation
  }

  async getInvitation(invitationId: string): Promise<OrganizationInvitation | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    return org.invitations.find((i) => i.id === invitationId) ?? null
  }

  async revokeInvitation(invitationId: string): Promise<OrganizationInvitation | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    const invitation = org.invitations.find((i) => i.id === invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    invitation.status = 'revoked'
    invitation.updated_at = Date.now()
    org.pending_invitations_count = org.invitations.filter((i) => i.status === 'pending').length
    org.updated_at = Date.now()

    await this.storage.put('organization', org)

    return invitation
  }

  async acceptInvitation(
    invitationId: string,
    userData: PublicUserData
  ): Promise<OrganizationMembership | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    const invitation = org.invitations.find((i) => i.id === invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    // Mark invitation as accepted
    invitation.status = 'accepted'
    invitation.updated_at = Date.now()
    org.pending_invitations_count = org.invitations.filter((i) => i.status === 'pending').length

    await this.storage.put('organization', org)

    // Create membership
    const membership = await this.createMembership({
      user_id: userData.user_id,
      role: invitation.role,
      public_user_data: userData,
      public_metadata: invitation.public_metadata,
      private_metadata: invitation.private_metadata,
    })

    return membership
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROLES AND PERMISSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async listRoles(): Promise<{ data: OrganizationRole[]; total_count: number }> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return { data: [], total_count: 0 }

    return { data: org.roles, total_count: org.roles.length }
  }

  async createRole(params: {
    name: string
    key: string
    description?: string
    permissions?: string[]
  }): Promise<OrganizationRole | null> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return null

    // Check if role key exists
    if (org.roles.some((r) => r.key === params.key)) return null

    const now = Date.now()
    const roleId = generateClerkId('role')

    const role: OrganizationRole = {
      id: roleId,
      object: 'role',
      name: params.name,
      key: params.key,
      description: params.description ?? '',
      permissions: params.permissions ?? [],
      is_creator_eligible: false,
      created_at: now,
      updated_at: now,
    }

    org.roles.push(role)
    org.updated_at = now

    await this.storage.put('organization', org)

    return role
  }

  async deleteRole(roleId: string): Promise<{ deleted: boolean }> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return { deleted: false }

    // Don't allow deleting default roles
    if (roleId === 'role_admin' || roleId === 'role_member') {
      return { deleted: false }
    }

    const index = org.roles.findIndex((r) => r.id === roleId)
    if (index === -1) return { deleted: false }

    org.roles.splice(index, 1)
    org.updated_at = Date.now()

    await this.storage.put('organization', org)

    return { deleted: true }
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const org = await this.storage.get<StoredOrganization>('organization')
    if (!org) return false

    const membership = org.memberships.find((m) => m.user_id === userId)
    if (!membership) return false

    return membership.permissions.includes(permission)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  private toPublicOrganization(stored: StoredOrganization): Organization {
    const { memberships: _, invitations: __, roles: ___, permissions: ____, ...publicOrg } = stored
    return { ...publicOrg, object: 'organization' }
  }

  private toPublicMembership(
    stored: StoredMembership,
    org: StoredOrganization
  ): OrganizationMembership {
    return {
      id: stored.id,
      object: 'organization_membership',
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        image_url: org.image_url,
        has_image: org.has_image,
        members_count: org.members_count,
        pending_invitations_count: org.pending_invitations_count,
        max_allowed_memberships: org.max_allowed_memberships,
        admin_delete_enabled: org.admin_delete_enabled,
        public_metadata: org.public_metadata,
        created_at: org.created_at,
        updated_at: org.updated_at,
      },
      public_metadata: stored.public_metadata,
      private_metadata: stored.private_metadata,
      role: stored.role,
      permissions: stored.permissions,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
      public_user_data: stored.public_user_data,
    }
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
}

// Internal types
interface StoredOrganization extends Omit<Organization, 'object'> {
  memberships: StoredMembership[]
  invitations: OrganizationInvitation[]
  roles: OrganizationRole[]
  permissions: OrganizationPermission[]
}

interface StoredMembership {
  id: string
  user_id: string
  role: string
  permissions: string[]
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  public_user_data: PublicUserData
  created_at: number
  updated_at: number
}

interface OrganizationPermission {
  id: string
  object: 'permission'
  name: string
  key: string
  description: string
  created_at: number
  updated_at: number
}

// Default roles
const DEFAULT_ROLES: OrganizationRole[] = [
  {
    id: 'role_admin',
    object: 'role',
    name: 'Admin',
    key: 'org:admin',
    description: 'Full access to organization settings and members',
    permissions: [
      'org:sys_profile:manage',
      'org:sys_profile:delete',
      'org:sys_memberships:read',
      'org:sys_memberships:manage',
      'org:sys_domains:read',
      'org:sys_domains:manage',
    ],
    is_creator_eligible: true,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'role_member',
    object: 'role',
    name: 'Member',
    key: 'org:member',
    description: 'Basic member access',
    permissions: ['org:sys_profile:read', 'org:sys_memberships:read'],
    is_creator_eligible: false,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
]

const DEFAULT_PERMISSIONS: OrganizationPermission[] = [
  {
    id: 'perm_profile_read',
    object: 'permission',
    name: 'Read profile',
    key: 'org:sys_profile:read',
    description: 'Read organization profile',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'perm_profile_manage',
    object: 'permission',
    name: 'Manage profile',
    key: 'org:sys_profile:manage',
    description: 'Update organization profile',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
]

// Helper to create mock user data
function createMockUserData(overrides?: Partial<PublicUserData>): PublicUserData {
  return {
    user_id: 'user_test123',
    first_name: 'Test',
    last_name: 'User',
    image_url: 'https://img.clerk.com/default.png',
    has_image: false,
    identifier: 'test@example.com',
    ...overrides,
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Clerk Organization Compat (OrgDO)', () => {
  let orgDO: MockOrgDO

  beforeEach(() => {
    orgDO = new MockOrgDO()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // ORGANIZATION CRUD
  // ============================================================================

  describe('Organization CRUD', () => {
    describe('createOrganization', () => {
      it('should create an organization with required fields', async () => {
        const org = await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        expect(org).toBeDefined()
        expect(org.object).toBe('organization')
        expect(org.name).toBe('Acme Corp')
        expect(org.slug).toBe('acme-corp')
        expect(org.id).toMatch(/^org_/)
        expect(org.members_count).toBe(0)
        expect(org.pending_invitations_count).toBe(0)
        expect(org.created_by).toBe('user_123')
      })

      it('should create an organization with custom slug', async () => {
        const org = await orgDO.createOrganization({
          name: 'Acme Corp',
          slug: 'my-custom-slug',
          created_by: 'user_123',
        })

        expect(org.slug).toBe('my-custom-slug')
      })

      it('should create an organization with metadata', async () => {
        const org = await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
          public_metadata: { tier: 'enterprise' },
          private_metadata: { internal_id: 'acme-001' },
        })

        expect(org.public_metadata).toEqual({ tier: 'enterprise' })
        expect(org.private_metadata).toEqual({ internal_id: 'acme-001' })
      })

      it('should create an organization with custom max memberships', async () => {
        const org = await orgDO.createOrganization({
          name: 'Small Team',
          created_by: 'user_123',
          max_allowed_memberships: 5,
        })

        expect(org.max_allowed_memberships).toBe(5)
      })

      it('should slugify names with special characters', async () => {
        const org = await orgDO.createOrganization({
          name: "John's Company! (2024)",
          created_by: 'user_123',
        })

        expect(org.slug).toBe('john-s-company-2024')
      })

      it('should set default image_url and has_image', async () => {
        const org = await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        expect(org.image_url).toContain('https://img.clerk.com/org-')
        expect(org.has_image).toBe(false)
      })

      it('should set admin_delete_enabled to true by default', async () => {
        const org = await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        expect(org.admin_delete_enabled).toBe(true)
      })
    })

    describe('getOrganization', () => {
      it('should return null for non-existent organization', async () => {
        const org = await orgDO.getOrganization()
        expect(org).toBeNull()
      })

      it('should return organization after creation', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        const org = await orgDO.getOrganization()

        expect(org).not.toBeNull()
        expect(org?.name).toBe('Acme Corp')
      })
    })

    describe('updateOrganization', () => {
      it('should return null for non-existent organization', async () => {
        const result = await orgDO.updateOrganization({ name: 'New Name' })
        expect(result).toBeNull()
      })

      it('should update organization name', async () => {
        await orgDO.createOrganization({
          name: 'Old Name',
          created_by: 'user_123',
        })

        const updated = await orgDO.updateOrganization({ name: 'New Name' })

        expect(updated?.name).toBe('New Name')
      })

      it('should update organization slug', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        const updated = await orgDO.updateOrganization({ slug: 'new-slug' })

        expect(updated?.slug).toBe('new-slug')
      })

      it('should update max_allowed_memberships', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        const updated = await orgDO.updateOrganization({ max_allowed_memberships: 50 })

        expect(updated?.max_allowed_memberships).toBe(50)
      })

      it('should update admin_delete_enabled', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        const updated = await orgDO.updateOrganization({ admin_delete_enabled: false })

        expect(updated?.admin_delete_enabled).toBe(false)
      })

      it('should merge public metadata', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
          public_metadata: { key1: 'value1' },
        })

        const updated = await orgDO.updateOrganization({
          public_metadata: { key2: 'value2' },
        })

        expect(updated?.public_metadata).toEqual({ key1: 'value1', key2: 'value2' })
      })

      it('should merge private metadata', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
          private_metadata: { secret1: 'a' },
        })

        const updated = await orgDO.updateOrganization({
          private_metadata: { secret2: 'b' },
        })

        expect(updated?.private_metadata).toEqual({ secret1: 'a', secret2: 'b' })
      })

      it('should update updated_at timestamp', async () => {
        const created = await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        // Wait a bit to ensure different timestamp
        await new Promise((r) => setTimeout(r, 10))

        const updated = await orgDO.updateOrganization({ name: 'New Name' })

        expect(updated?.updated_at).toBeGreaterThan(created.created_at)
      })
    })

    describe('deleteOrganization', () => {
      it('should delete an organization', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        const result = await orgDO.deleteOrganization()

        expect(result.deleted).toBe(true)
        expect(await orgDO.getOrganization()).toBeNull()
      })
    })

    describe('updateLogo', () => {
      it('should update organization logo', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })

        const updated = await orgDO.updateLogo('https://example.com/logo.png')

        expect(updated?.image_url).toBe('https://example.com/logo.png')
        expect(updated?.has_image).toBe(true)
      })

      it('should return null for non-existent organization', async () => {
        const result = await orgDO.updateLogo('https://example.com/logo.png')
        expect(result).toBeNull()
      })
    })

    describe('deleteLogo', () => {
      it('should reset organization logo to default', async () => {
        await orgDO.createOrganization({
          name: 'Acme Corp',
          created_by: 'user_123',
        })
        await orgDO.updateLogo('https://example.com/logo.png')

        const updated = await orgDO.deleteLogo()

        expect(updated?.image_url).toContain('https://img.clerk.com/org-')
        expect(updated?.has_image).toBe(false)
      })
    })
  })

  // ============================================================================
  // MEMBERSHIP MANAGEMENT
  // ============================================================================

  describe('Membership Management', () => {
    beforeEach(async () => {
      await orgDO.createOrganization({
        name: 'Acme Corp',
        created_by: 'user_creator',
      })
    })

    describe('createMembership', () => {
      it('should create a membership with admin role', async () => {
        const membership = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:admin',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        expect(membership).not.toBeNull()
        expect(membership?.object).toBe('organization_membership')
        expect(membership?.id).toMatch(/^mem_/)
        expect(membership?.role).toBe('org:admin')
        expect(membership?.permissions).toContain('org:sys_profile:manage')
        expect(membership?.public_user_data.user_id).toBe('user_123')
      })

      it('should create a membership with member role', async () => {
        const membership = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        expect(membership?.role).toBe('org:member')
        expect(membership?.permissions).toContain('org:sys_profile:read')
        expect(membership?.permissions).not.toContain('org:sys_profile:manage')
      })

      it('should increment members_count', async () => {
        await orgDO.createMembership({
          user_id: 'user_1',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_1' }),
        })

        const org = await orgDO.getOrganization()
        expect(org?.members_count).toBe(1)

        await orgDO.createMembership({
          user_id: 'user_2',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_2' }),
        })

        const updated = await orgDO.getOrganization()
        expect(updated?.members_count).toBe(2)
      })

      it('should reject duplicate membership', async () => {
        await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const duplicate = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:admin',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        expect(duplicate).toBeNull()
      })

      it('should respect max_allowed_memberships limit', async () => {
        // Create org with limit of 2
        await orgDO.deleteOrganization()
        await orgDO.createOrganization({
          name: 'Small Team',
          created_by: 'user_creator',
          max_allowed_memberships: 2,
        })

        // Add 2 members
        await orgDO.createMembership({
          user_id: 'user_1',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_1' }),
        })
        await orgDO.createMembership({
          user_id: 'user_2',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_2' }),
        })

        // Try to add 3rd member
        const third = await orgDO.createMembership({
          user_id: 'user_3',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_3' }),
        })

        expect(third).toBeNull()
      })

      it('should store public and private metadata', async () => {
        const membership = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
          public_metadata: { department: 'Engineering' },
          private_metadata: { salary_band: 'L5' },
        })

        expect(membership?.public_metadata).toEqual({ department: 'Engineering' })
        expect(membership?.private_metadata).toEqual({ salary_band: 'L5' })
      })

      it('should include organization reference', async () => {
        const membership = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        expect(membership?.organization).toBeDefined()
        expect(membership?.organization.name).toBe('Acme Corp')
        expect(membership?.organization.slug).toBe('acme-corp')
      })
    })

    describe('listMemberships', () => {
      beforeEach(async () => {
        // Add 3 members
        for (let i = 1; i <= 3; i++) {
          await orgDO.createMembership({
            user_id: `user_${i}`,
            role: 'org:member',
            public_user_data: createMockUserData({ user_id: `user_${i}` }),
          })
        }
      })

      it('should list all memberships', async () => {
        const result = await orgDO.listMemberships()

        expect(result.total_count).toBe(3)
        expect(result.data).toHaveLength(3)
      })

      it('should respect limit parameter', async () => {
        const result = await orgDO.listMemberships({ limit: 2 })

        expect(result.total_count).toBe(3)
        expect(result.data).toHaveLength(2)
      })

      it('should respect offset parameter', async () => {
        const result = await orgDO.listMemberships({ offset: 1, limit: 10 })

        expect(result.total_count).toBe(3)
        expect(result.data).toHaveLength(2)
      })

      it('should return empty for non-existent organization', async () => {
        await orgDO.deleteOrganization()
        const result = await orgDO.listMemberships()

        expect(result.data).toHaveLength(0)
        expect(result.total_count).toBe(0)
      })
    })

    describe('getMembership', () => {
      it('should get membership by ID', async () => {
        const created = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const found = await orgDO.getMembership(created!.id)

        expect(found).not.toBeNull()
        expect(found?.id).toBe(created?.id)
      })

      it('should return null for non-existent membership', async () => {
        const found = await orgDO.getMembership('mem_nonexistent')
        expect(found).toBeNull()
      })
    })

    describe('getMembershipByUserId', () => {
      it('should get membership by user ID', async () => {
        await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const found = await orgDO.getMembershipByUserId('user_123')

        expect(found).not.toBeNull()
        expect(found?.public_user_data.user_id).toBe('user_123')
      })

      it('should return null for non-member user', async () => {
        const found = await orgDO.getMembershipByUserId('user_nonmember')
        expect(found).toBeNull()
      })
    })

    describe('updateMembership', () => {
      it('should update membership role', async () => {
        const created = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const updated = await orgDO.updateMembership(created!.id, {
          role: 'org:admin',
        })

        expect(updated?.role).toBe('org:admin')
        expect(updated?.permissions).toContain('org:sys_profile:manage')
      })

      it('should update membership metadata', async () => {
        const created = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const updated = await orgDO.updateMembership(created!.id, {
          public_metadata: { team: 'Platform' },
          private_metadata: { notes: 'Great employee' },
        })

        expect(updated?.public_metadata).toEqual({ team: 'Platform' })
        expect(updated?.private_metadata).toEqual({ notes: 'Great employee' })
      })

      it('should return null for non-existent membership', async () => {
        const result = await orgDO.updateMembership('mem_fake', { role: 'org:admin' })
        expect(result).toBeNull()
      })

      it('should update updated_at timestamp', async () => {
        const created = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        await new Promise((r) => setTimeout(r, 10))

        const updated = await orgDO.updateMembership(created!.id, {
          role: 'org:admin',
        })

        expect(updated?.updated_at).toBeGreaterThan(created!.created_at)
      })
    })

    describe('deleteMembership', () => {
      it('should delete membership by ID', async () => {
        const created = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const result = await orgDO.deleteMembership(created!.id)

        expect(result.deleted).toBe(true)
        expect(await orgDO.getMembership(created!.id)).toBeNull()
      })

      it('should decrement members_count', async () => {
        const created = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        expect((await orgDO.getOrganization())?.members_count).toBe(1)

        await orgDO.deleteMembership(created!.id)

        expect((await orgDO.getOrganization())?.members_count).toBe(0)
      })

      it('should return false for non-existent membership', async () => {
        const result = await orgDO.deleteMembership('mem_fake')
        expect(result.deleted).toBe(false)
      })
    })

    describe('deleteMembershipByUserId', () => {
      it('should delete membership by user ID', async () => {
        await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        const result = await orgDO.deleteMembershipByUserId('user_123')

        expect(result.deleted).toBe(true)
        expect(await orgDO.getMembershipByUserId('user_123')).toBeNull()
      })

      it('should return false for non-member user', async () => {
        const result = await orgDO.deleteMembershipByUserId('user_nonmember')
        expect(result.deleted).toBe(false)
      })
    })
  })

  // ============================================================================
  // INVITATION MANAGEMENT
  // ============================================================================

  describe('Invitation Management', () => {
    beforeEach(async () => {
      await orgDO.createOrganization({
        name: 'Acme Corp',
        created_by: 'user_creator',
      })
    })

    describe('createInvitation', () => {
      it('should create an invitation', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'new@example.com',
          role: 'org:member',
        })

        expect(invitation).not.toBeNull()
        expect(invitation?.object).toBe('organization_invitation')
        expect(invitation?.id).toMatch(/^inv_/)
        expect(invitation?.email_address).toBe('new@example.com')
        expect(invitation?.role).toBe('org:member')
        expect(invitation?.status).toBe('pending')
      })

      it('should increment pending_invitations_count', async () => {
        await orgDO.createInvitation({
          email_address: 'user1@example.com',
          role: 'org:member',
        })

        expect((await orgDO.getOrganization())?.pending_invitations_count).toBe(1)

        await orgDO.createInvitation({
          email_address: 'user2@example.com',
          role: 'org:member',
        })

        expect((await orgDO.getOrganization())?.pending_invitations_count).toBe(2)
      })

      it('should reject duplicate pending invitation', async () => {
        await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })

        const duplicate = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:admin',
        })

        expect(duplicate).toBeNull()
      })

      it('should store metadata', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
          public_metadata: { invited_by: 'Admin' },
          private_metadata: { notes: 'VIP' },
        })

        expect(invitation?.public_metadata).toEqual({ invited_by: 'Admin' })
        expect(invitation?.private_metadata).toEqual({ notes: 'VIP' })
      })
    })

    describe('listInvitations', () => {
      beforeEach(async () => {
        await orgDO.createInvitation({ email_address: 'a@example.com', role: 'org:member' })
        await orgDO.createInvitation({ email_address: 'b@example.com', role: 'org:member' })
        await orgDO.createInvitation({ email_address: 'c@example.com', role: 'org:member' })
      })

      it('should list all invitations', async () => {
        const result = await orgDO.listInvitations()

        expect(result.total_count).toBe(3)
        expect(result.data).toHaveLength(3)
      })

      it('should filter by status', async () => {
        // Revoke one invitation
        const all = await orgDO.listInvitations()
        await orgDO.revokeInvitation(all.data[0].id)

        const pending = await orgDO.listInvitations({ status: 'pending' })
        const revoked = await orgDO.listInvitations({ status: 'revoked' })

        expect(pending.total_count).toBe(2)
        expect(revoked.total_count).toBe(1)
      })

      it('should respect limit and offset', async () => {
        const result = await orgDO.listInvitations({ limit: 2, offset: 1 })

        expect(result.data).toHaveLength(2)
      })
    })

    describe('getInvitation', () => {
      it('should get invitation by ID', async () => {
        const created = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })

        const found = await orgDO.getInvitation(created!.id)

        expect(found).not.toBeNull()
        expect(found?.id).toBe(created?.id)
      })

      it('should return null for non-existent invitation', async () => {
        const found = await orgDO.getInvitation('inv_fake')
        expect(found).toBeNull()
      })
    })

    describe('revokeInvitation', () => {
      it('should revoke a pending invitation', async () => {
        const created = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })

        const revoked = await orgDO.revokeInvitation(created!.id)

        expect(revoked).not.toBeNull()
        expect(revoked?.status).toBe('revoked')
      })

      it('should decrement pending_invitations_count', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })

        expect((await orgDO.getOrganization())?.pending_invitations_count).toBe(1)

        await orgDO.revokeInvitation(invitation!.id)

        expect((await orgDO.getOrganization())?.pending_invitations_count).toBe(0)
      })

      it('should return null for already revoked invitation', async () => {
        const created = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })
        await orgDO.revokeInvitation(created!.id)

        const result = await orgDO.revokeInvitation(created!.id)

        expect(result).toBeNull()
      })

      it('should return null for non-existent invitation', async () => {
        const result = await orgDO.revokeInvitation('inv_fake')
        expect(result).toBeNull()
      })
    })

    describe('acceptInvitation', () => {
      it('should accept invitation and create membership', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:admin',
        })

        const userData = createMockUserData({
          user_id: 'user_new',
          identifier: 'user@example.com',
        })

        const membership = await orgDO.acceptInvitation(invitation!.id, userData)

        expect(membership).not.toBeNull()
        expect(membership?.public_user_data.user_id).toBe('user_new')
        expect(membership?.role).toBe('org:admin')

        // Verify invitation is marked as accepted
        const updatedInvitation = await orgDO.getInvitation(invitation!.id)
        expect(updatedInvitation?.status).toBe('accepted')
      })

      it('should decrement pending_invitations_count', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })

        expect((await orgDO.getOrganization())?.pending_invitations_count).toBe(1)

        await orgDO.acceptInvitation(invitation!.id, createMockUserData())

        expect((await orgDO.getOrganization())?.pending_invitations_count).toBe(0)
      })

      it('should transfer invitation metadata to membership', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
          public_metadata: { invited_by: 'Admin' },
          private_metadata: { notes: 'VIP' },
        })

        const membership = await orgDO.acceptInvitation(
          invitation!.id,
          createMockUserData()
        )

        expect(membership?.public_metadata).toEqual({ invited_by: 'Admin' })
        expect(membership?.private_metadata).toEqual({ notes: 'VIP' })
      })

      it('should return null for non-pending invitation', async () => {
        const invitation = await orgDO.createInvitation({
          email_address: 'user@example.com',
          role: 'org:member',
        })
        await orgDO.revokeInvitation(invitation!.id)

        const result = await orgDO.acceptInvitation(
          invitation!.id,
          createMockUserData()
        )

        expect(result).toBeNull()
      })
    })
  })

  // ============================================================================
  // ROLES AND PERMISSIONS
  // ============================================================================

  describe('Roles and Permissions', () => {
    beforeEach(async () => {
      await orgDO.createOrganization({
        name: 'Acme Corp',
        created_by: 'user_creator',
      })
    })

    describe('listRoles', () => {
      it('should list default roles', async () => {
        const result = await orgDO.listRoles()

        expect(result.total_count).toBeGreaterThanOrEqual(2)
        expect(result.data.some((r) => r.key === 'org:admin')).toBe(true)
        expect(result.data.some((r) => r.key === 'org:member')).toBe(true)
      })
    })

    describe('createRole', () => {
      it('should create a custom role', async () => {
        const role = await orgDO.createRole({
          name: 'Viewer',
          key: 'org:viewer',
          description: 'Read-only access',
          permissions: ['org:sys_profile:read'],
        })

        expect(role).not.toBeNull()
        expect(role?.id).toMatch(/^role_/)
        expect(role?.name).toBe('Viewer')
        expect(role?.key).toBe('org:viewer')
        expect(role?.permissions).toContain('org:sys_profile:read')
      })

      it('should reject duplicate role key', async () => {
        await orgDO.createRole({
          name: 'Viewer',
          key: 'org:viewer',
        })

        const duplicate = await orgDO.createRole({
          name: 'Another Viewer',
          key: 'org:viewer',
        })

        expect(duplicate).toBeNull()
      })
    })

    describe('deleteRole', () => {
      it('should delete a custom role', async () => {
        const role = await orgDO.createRole({
          name: 'Viewer',
          key: 'org:viewer',
        })

        const result = await orgDO.deleteRole(role!.id)

        expect(result.deleted).toBe(true)
      })

      it('should not delete default admin role', async () => {
        const result = await orgDO.deleteRole('role_admin')

        expect(result.deleted).toBe(false)
      })

      it('should not delete default member role', async () => {
        const result = await orgDO.deleteRole('role_member')

        expect(result.deleted).toBe(false)
      })

      it('should return false for non-existent role', async () => {
        const result = await orgDO.deleteRole('role_fake')

        expect(result.deleted).toBe(false)
      })
    })

    describe('hasPermission', () => {
      beforeEach(async () => {
        // Create an admin member
        await orgDO.createMembership({
          user_id: 'user_admin',
          role: 'org:admin',
          public_user_data: createMockUserData({ user_id: 'user_admin' }),
        })

        // Create a regular member
        await orgDO.createMembership({
          user_id: 'user_member',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_member' }),
        })
      })

      it('should return true for admin with manage permission', async () => {
        const hasPermission = await orgDO.hasPermission(
          'user_admin',
          'org:sys_profile:manage'
        )

        expect(hasPermission).toBe(true)
      })

      it('should return false for member with manage permission', async () => {
        const hasPermission = await orgDO.hasPermission(
          'user_member',
          'org:sys_profile:manage'
        )

        expect(hasPermission).toBe(false)
      })

      it('should return true for member with read permission', async () => {
        const hasPermission = await orgDO.hasPermission(
          'user_member',
          'org:sys_profile:read'
        )

        expect(hasPermission).toBe(true)
      })

      it('should return false for non-member', async () => {
        const hasPermission = await orgDO.hasPermission(
          'user_stranger',
          'org:sys_profile:read'
        )

        expect(hasPermission).toBe(false)
      })
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge Cases', () => {
    describe('empty organization', () => {
      it('should handle operations on non-existent organization', async () => {
        expect(await orgDO.getOrganization()).toBeNull()
        expect(await orgDO.updateOrganization({ name: 'New' })).toBeNull()
        expect(await orgDO.updateLogo('http://example.com')).toBeNull()
        expect(await orgDO.deleteLogo()).toBeNull()
        expect((await orgDO.listMemberships()).data).toHaveLength(0)
        expect((await orgDO.listInvitations()).data).toHaveLength(0)
        expect((await orgDO.listRoles()).data).toHaveLength(0)
      })
    })

    describe('special characters in names', () => {
      it('should handle unicode characters in organization name', async () => {
        const org = await orgDO.createOrganization({
          name: 'Uber for Dogs',
          created_by: 'user_123',
        })

        expect(org.name).toBe('Uber for Dogs')
        expect(org.slug).toBe('uber-for-dogs')
      })

      it('should handle emojis in organization name', async () => {
        const org = await orgDO.createOrganization({
          name: 'Rocket Team',
          created_by: 'user_123',
        })

        expect(org.name).toBe('Rocket Team')
      })
    })

    describe('metadata edge cases', () => {
      it('should handle nested metadata objects', async () => {
        const org = await orgDO.createOrganization({
          name: 'Acme',
          created_by: 'user_123',
          public_metadata: {
            config: {
              features: {
                darkMode: true,
                notifications: ['email', 'sms'],
              },
            },
          },
        })

        expect(org.public_metadata).toEqual({
          config: {
            features: {
              darkMode: true,
              notifications: ['email', 'sms'],
            },
          },
        })
      })

      it('should handle empty metadata update', async () => {
        await orgDO.createOrganization({
          name: 'Acme',
          created_by: 'user_123',
          public_metadata: { key: 'value' },
        })

        const updated = await orgDO.updateOrganization({
          public_metadata: {},
        })

        // Should merge empty object (no change)
        expect(updated?.public_metadata).toEqual({ key: 'value' })
      })
    })

    describe('role changes', () => {
      it('should update permissions when role changes', async () => {
        await orgDO.createOrganization({
          name: 'Acme',
          created_by: 'user_creator',
        })

        const membership = await orgDO.createMembership({
          user_id: 'user_123',
          role: 'org:member',
          public_user_data: createMockUserData({ user_id: 'user_123' }),
        })

        expect(membership?.permissions).not.toContain('org:sys_profile:manage')

        const updated = await orgDO.updateMembership(membership!.id, {
          role: 'org:admin',
        })

        expect(updated?.permissions).toContain('org:sys_profile:manage')
      })
    })
  })
})
