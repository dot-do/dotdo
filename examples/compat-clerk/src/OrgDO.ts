/**
 * OrgDO - Organization Data Durable Object
 *
 * Stores organization data, memberships, and invitations in a dedicated DO.
 * Each organization has its own DO instance for isolation and scalability.
 *
 * Features:
 * - Organization CRUD
 * - Membership management (create, update, delete)
 * - Role-based access control
 * - Invitation management
 * - Organization metadata
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Organizations
 */

import { DurableObject } from 'cloudflare:workers'
import { generateClerkId } from './jwt'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  ORG_DO: DurableObjectNamespace
  USER_DO: DurableObjectNamespace
  CLERK_DO: DurableObjectNamespace
  ENVIRONMENT?: string
}

/** Clerk-compatible Organization object */
export interface Organization {
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

/** Organization Membership */
export interface OrganizationMembership {
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

/** Organization reference (subset of full org) */
export interface OrganizationReference {
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

/** Public user data for membership */
export interface PublicUserData {
  user_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  identifier: string
}

/** Organization Invitation */
export interface OrganizationInvitation {
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

/** Organization Role */
export interface OrganizationRole {
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

/** Organization Permission */
export interface OrganizationPermission {
  id: string
  object: 'permission'
  name: string
  key: string
  description: string
  created_at: number
  updated_at: number
}

/** Stored organization with additional fields */
interface StoredOrganization extends Omit<Organization, 'object'> {
  memberships: StoredMembership[]
  invitations: OrganizationInvitation[]
  roles: OrganizationRole[]
  permissions: OrganizationPermission[]
}

/** Stored membership */
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

// ============================================================================
// DEFAULT ROLES AND PERMISSIONS
// ============================================================================

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
  {
    id: 'perm_profile_delete',
    object: 'permission',
    name: 'Delete profile',
    key: 'org:sys_profile:delete',
    description: 'Delete organization',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'perm_memberships_read',
    object: 'permission',
    name: 'Read memberships',
    key: 'org:sys_memberships:read',
    description: 'View organization members',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'perm_memberships_manage',
    object: 'permission',
    name: 'Manage memberships',
    key: 'org:sys_memberships:manage',
    description: 'Add and remove organization members',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'perm_domains_read',
    object: 'permission',
    name: 'Read domains',
    key: 'org:sys_domains:read',
    description: 'View organization domains',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'perm_domains_manage',
    object: 'permission',
    name: 'Manage domains',
    key: 'org:sys_domains:manage',
    description: 'Add and remove organization domains',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
]

// ============================================================================
// ORG DURABLE OBJECT
// ============================================================================

export class OrgDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get organization data
   */
  async getOrganization(): Promise<Organization | null> {
    const stored = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!stored) return null
    return this.toPublicOrganization(stored)
  }

  /**
   * Create organization
   */
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

    await this.ctx.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  /**
   * Update organization
   */
  async updateOrganization(params: {
    name?: string
    slug?: string
    max_allowed_memberships?: number
    admin_delete_enabled?: boolean
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
  }): Promise<Organization | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
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

    await this.ctx.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  /**
   * Delete organization
   */
  async deleteOrganization(): Promise<{ deleted: boolean }> {
    await this.ctx.storage.deleteAll()
    return { deleted: true }
  }

  /**
   * Update organization logo
   */
  async updateLogo(imageUrl: string): Promise<Organization | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    org.image_url = imageUrl
    org.has_image = true
    org.updated_at = Date.now()

    await this.ctx.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  /**
   * Delete organization logo
   */
  async deleteLogo(): Promise<Organization | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    org.image_url = `https://img.clerk.com/org-${org.id.slice(-4)}.png`
    org.has_image = false
    org.updated_at = Date.now()

    await this.ctx.storage.put('organization', org)

    return this.toPublicOrganization(org)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMBERSHIP MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List memberships
   */
  async listMemberships(params?: {
    limit?: number
    offset?: number
    order_by?: string
  }): Promise<{ data: OrganizationMembership[]; total_count: number }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return { data: [], total_count: 0 }

    const limit = params?.limit ?? 10
    const offset = params?.offset ?? 0

    const memberships = org.memberships.slice(offset, offset + limit).map((m) =>
      this.toPublicMembership(m, org)
    )

    return { data: memberships, total_count: org.memberships.length }
  }

  /**
   * Create membership
   */
  async createMembership(params: {
    user_id: string
    role: string
    public_user_data: PublicUserData
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
  }): Promise<OrganizationMembership | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
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

    await this.ctx.storage.put('organization', org)

    return this.toPublicMembership(membership, org)
  }

  /**
   * Get membership by user ID
   */
  async getMembershipByUserId(userId: string): Promise<OrganizationMembership | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    const membership = org.memberships.find((m) => m.user_id === userId)
    if (!membership) return null

    return this.toPublicMembership(membership, org)
  }

  /**
   * Get membership by ID
   */
  async getMembership(membershipId: string): Promise<OrganizationMembership | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    const membership = org.memberships.find((m) => m.id === membershipId)
    if (!membership) return null

    return this.toPublicMembership(membership, org)
  }

  /**
   * Update membership
   */
  async updateMembership(
    membershipId: string,
    params: {
      role?: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationMembership | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
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

    await this.ctx.storage.put('organization', org)

    return this.toPublicMembership(membership, org)
  }

  /**
   * Delete membership
   */
  async deleteMembership(membershipId: string): Promise<{ deleted: boolean }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return { deleted: false }

    const index = org.memberships.findIndex((m) => m.id === membershipId)
    if (index === -1) return { deleted: false }

    org.memberships.splice(index, 1)
    org.members_count = org.memberships.length
    org.updated_at = Date.now()

    await this.ctx.storage.put('organization', org)

    return { deleted: true }
  }

  /**
   * Delete membership by user ID
   */
  async deleteMembershipByUserId(userId: string): Promise<{ deleted: boolean }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return { deleted: false }

    const index = org.memberships.findIndex((m) => m.user_id === userId)
    if (index === -1) return { deleted: false }

    org.memberships.splice(index, 1)
    org.members_count = org.memberships.length
    org.updated_at = Date.now()

    await this.ctx.storage.put('organization', org)

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVITATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List invitations
   */
  async listInvitations(params?: {
    status?: 'pending' | 'accepted' | 'revoked'
    limit?: number
    offset?: number
  }): Promise<{ data: OrganizationInvitation[]; total_count: number }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
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

  /**
   * Create invitation
   */
  async createInvitation(params: {
    email_address: string
    role: string
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
    redirect_url?: string
  }): Promise<OrganizationInvitation | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
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

    await this.ctx.storage.put('organization', org)

    return invitation
  }

  /**
   * Get invitation
   */
  async getInvitation(invitationId: string): Promise<OrganizationInvitation | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    return org.invitations.find((i) => i.id === invitationId) ?? null
  }

  /**
   * Revoke invitation
   */
  async revokeInvitation(invitationId: string): Promise<OrganizationInvitation | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    const invitation = org.invitations.find((i) => i.id === invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    invitation.status = 'revoked'
    invitation.updated_at = Date.now()
    org.pending_invitations_count = org.invitations.filter((i) => i.status === 'pending').length
    org.updated_at = Date.now()

    await this.ctx.storage.put('organization', org)

    return invitation
  }

  /**
   * Accept invitation (called when user accepts)
   */
  async acceptInvitation(
    invitationId: string,
    userData: PublicUserData
  ): Promise<OrganizationMembership | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return null

    const invitation = org.invitations.find((i) => i.id === invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    // Mark invitation as accepted
    invitation.status = 'accepted'
    invitation.updated_at = Date.now()
    org.pending_invitations_count = org.invitations.filter((i) => i.status === 'pending').length

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

  /**
   * List roles
   */
  async listRoles(): Promise<{ data: OrganizationRole[]; total_count: number }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return { data: [], total_count: 0 }

    return { data: org.roles, total_count: org.roles.length }
  }

  /**
   * Create custom role
   */
  async createRole(params: {
    name: string
    key: string
    description?: string
    permissions?: string[]
  }): Promise<OrganizationRole | null> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
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

    await this.ctx.storage.put('organization', org)

    return role
  }

  /**
   * Delete role
   */
  async deleteRole(roleId: string): Promise<{ deleted: boolean }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return { deleted: false }

    // Don't allow deleting default roles
    if (roleId === 'role_admin' || roleId === 'role_member') {
      return { deleted: false }
    }

    const index = org.roles.findIndex((r) => r.id === roleId)
    if (index === -1) return { deleted: false }

    org.roles.splice(index, 1)
    org.updated_at = Date.now()

    await this.ctx.storage.put('organization', org)

    return { deleted: true }
  }

  /**
   * List permissions
   */
  async listPermissions(): Promise<{ data: OrganizationPermission[]; total_count: number }> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return { data: [], total_count: 0 }

    return { data: org.permissions, total_count: org.permissions.length }
  }

  /**
   * Check if user has permission
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const org = (await this.ctx.storage.get('organization')) as StoredOrganization | null
    if (!org) return false

    const membership = org.memberships.find((m) => m.user_id === userId)
    if (!membership) return false

    return membership.permissions.includes(permission)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Convert stored organization to public organization
   */
  private toPublicOrganization(stored: StoredOrganization): Organization {
    const { memberships: _, invitations: __, roles: ___, permissions: ____, ...publicOrg } = stored
    return { ...publicOrg, object: 'organization' }
  }

  /**
   * Convert stored membership to public membership
   */
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

  /**
   * Convert name to slug
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'OrgDO' })
    }

    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            { jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          { jsonrpc: '2.0', id: 0, error: { code: -32603, message: String(error) } },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}
