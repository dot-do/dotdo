/**
 * @dotdo/clerk - Organizations API
 *
 * Clerk Organizations Backend API compatible implementation.
 * Provides organization CRUD, membership management, invitations,
 * roles/permissions, and domain management.
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Organizations
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import type { UserManager } from '../shared/users'
import { ClerkAPIError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Clerk organization object
 */
export interface ClerkOrganization {
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
  created_by?: string
  created_at: number
  updated_at: number
}

/**
 * Organization membership
 */
export interface ClerkOrganizationMembership {
  id: string
  object: 'organization_membership'
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  role: string
  role_name?: string
  permissions: string[]
  created_at: number
  updated_at: number
  organization: ClerkOrganization
  public_user_data: ClerkPublicUserData
}

/**
 * Public user data in membership
 */
export interface ClerkPublicUserData {
  user_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  identifier: string
}

/**
 * Organization invitation
 */
export interface ClerkOrganizationInvitation {
  id: string
  object: 'organization_invitation'
  email_address: string
  role: string
  role_name?: string
  organization_id: string
  inviter_user_id?: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  expires_at?: number
  created_at: number
  updated_at: number
}

/**
 * Organization role
 */
export interface ClerkOrganizationRole {
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

/**
 * Organization permission
 */
export interface ClerkOrganizationPermission {
  id: string
  object: 'permission'
  name: string
  key: string
  description: string
  type: 'system' | 'custom'
  created_at: number
  updated_at: number
}

/**
 * Organization domain
 */
export interface ClerkOrganizationDomain {
  id: string
  object: 'organization_domain'
  organization_id: string
  name: string
  enrollment_mode: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
  affiliation_email_address?: string
  total_pending_invitations: number
  total_pending_suggestions: number
  verification: ClerkDomainVerification | null
  created_at: number
  updated_at: number
}

/**
 * Domain verification status
 */
export interface ClerkDomainVerification {
  status: 'unverified' | 'verified'
  strategy: 'email_code' | 'dns_record'
  attempts: number
  expires_at: number | null
}

/**
 * Paginated list response
 */
export interface ClerkPaginatedList<T> {
  data: T[]
  total_count: number
}

/**
 * Deleted object response
 */
export interface ClerkDeletedObject {
  id: string
  object: string
  deleted: boolean
}

// ============================================================================
// PARAM TYPES
// ============================================================================

/**
 * Create organization parameters
 */
export interface CreateOrganizationParams {
  name: string
  slug?: string
  created_by: string
  max_allowed_memberships?: number
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Update organization parameters
 */
export interface UpdateOrganizationParams {
  name?: string
  slug?: string
  max_allowed_memberships?: number
  admin_delete_enabled?: boolean
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Create membership parameters
 */
export interface CreateMembershipParams {
  organizationId: string
  userId: string
  role: string
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Update membership parameters
 */
export interface UpdateMembershipParams {
  organizationId: string
  userId: string
  role: string
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Create invitation parameters
 */
export interface CreateInvitationParams {
  email_address: string
  role: string
  inviter_user_id?: string
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
  redirect_url?: string
  expires_in_days?: number
}

/**
 * Create role parameters
 */
export interface CreateRoleParams {
  name: string
  key: string
  description?: string
  permissions?: string[]
}

/**
 * Update role parameters
 */
export interface UpdateRoleParams {
  name?: string
  description?: string
  permissions?: string[]
}

/**
 * Create permission parameters
 */
export interface CreatePermissionParams {
  name: string
  key: string
  description?: string
}

/**
 * Create domain parameters
 */
export interface CreateDomainParams {
  name: string
  enrollment_mode?: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
  verified?: boolean
}

/**
 * Update domain parameters
 */
export interface UpdateDomainParams {
  enrollment_mode?: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
}

// ============================================================================
// INTERNAL STORAGE TYPES
// ============================================================================

interface StoredOrganization extends Omit<ClerkOrganization, 'object'> {
  membershipIds: string[]
  invitationIds: string[]
  domainIds: string[]
}

interface StoredMembership {
  id: string
  organization_id: string
  user_id: string
  role: string
  permissions: string[]
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  public_user_data: ClerkPublicUserData
  created_at: number
  updated_at: number
}

interface StoredInvitation extends Omit<ClerkOrganizationInvitation, 'object'> {}

interface StoredDomain extends Omit<ClerkOrganizationDomain, 'object'> {}

// ============================================================================
// DEFAULT SYSTEM ROLES AND PERMISSIONS
// ============================================================================

const SYSTEM_PERMISSIONS: ClerkOrganizationPermission[] = [
  {
    id: 'perm_sys_profile_read',
    object: 'permission',
    name: 'Read profile',
    key: 'org:sys_profile:read',
    description: 'Read organization profile',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'perm_sys_profile_manage',
    object: 'permission',
    name: 'Manage profile',
    key: 'org:sys_profile:manage',
    description: 'Update organization profile and settings',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'perm_sys_profile_delete',
    object: 'permission',
    name: 'Delete profile',
    key: 'org:sys_profile:delete',
    description: 'Delete organization',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'perm_sys_memberships_read',
    object: 'permission',
    name: 'Read memberships',
    key: 'org:sys_memberships:read',
    description: 'View organization members',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'perm_sys_memberships_manage',
    object: 'permission',
    name: 'Manage memberships',
    key: 'org:sys_memberships:manage',
    description: 'Invite, remove, and update organization members',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'perm_sys_domains_read',
    object: 'permission',
    name: 'Read domains',
    key: 'org:sys_domains:read',
    description: 'View organization domains',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'perm_sys_domains_manage',
    object: 'permission',
    name: 'Manage domains',
    key: 'org:sys_domains:manage',
    description: 'Add, remove, and verify organization domains',
    type: 'system',
    created_at: 0,
    updated_at: 0,
  },
]

const DEFAULT_ROLES: ClerkOrganizationRole[] = [
  {
    id: 'role_admin',
    object: 'role',
    name: 'Admin',
    key: 'org:admin',
    description: 'Full administrative access to the organization',
    permissions: [
      'org:sys_profile:read',
      'org:sys_profile:manage',
      'org:sys_profile:delete',
      'org:sys_memberships:read',
      'org:sys_memberships:manage',
      'org:sys_domains:read',
      'org:sys_domains:manage',
    ],
    is_creator_eligible: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'role_member',
    object: 'role',
    name: 'Member',
    key: 'org:member',
    description: 'Basic organization member with read access',
    permissions: ['org:sys_profile:read', 'org:sys_memberships:read'],
    is_creator_eligible: false,
    created_at: 0,
    updated_at: 0,
  },
]

// ============================================================================
// ORGANIZATIONS API
// ============================================================================

/**
 * Organizations API manager
 */
export interface OrganizationsAPI {
  // Organization CRUD
  getOrganization(organizationId: string): Promise<ClerkOrganization>
  getOrganizationBySlug(slug: string): Promise<ClerkOrganization>
  getOrganizationList(params?: {
    limit?: number
    offset?: number
    include_members_count?: boolean
    query?: string
    user_id?: string[]
    order_by?: string
  }): Promise<ClerkPaginatedList<ClerkOrganization>>
  createOrganization(params: CreateOrganizationParams): Promise<ClerkOrganization>
  updateOrganization(organizationId: string, params: UpdateOrganizationParams): Promise<ClerkOrganization>
  deleteOrganization(organizationId: string): Promise<ClerkDeletedObject>
  updateOrganizationLogo(organizationId: string, file: { url: string }): Promise<ClerkOrganization>
  deleteOrganizationLogo(organizationId: string): Promise<ClerkOrganization>
  updateOrganizationMetadata(
    organizationId: string,
    params: { public_metadata?: Record<string, unknown>; private_metadata?: Record<string, unknown> }
  ): Promise<ClerkOrganization>

  // Membership management
  getOrganizationMembershipList(params: {
    organizationId: string
    limit?: number
    offset?: number
    role?: string[]
    order_by?: string
  }): Promise<ClerkPaginatedList<ClerkOrganizationMembership>>
  createOrganizationMembership(params: CreateMembershipParams): Promise<ClerkOrganizationMembership>
  updateOrganizationMembership(params: UpdateMembershipParams): Promise<ClerkOrganizationMembership>
  updateOrganizationMembershipMetadata(params: {
    organizationId: string
    userId: string
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
  }): Promise<ClerkOrganizationMembership>
  deleteOrganizationMembership(params: { organizationId: string; userId: string }): Promise<ClerkDeletedObject>

  // Invitation management
  getOrganizationInvitationList(params: {
    organizationId: string
    limit?: number
    offset?: number
    status?: 'pending' | 'accepted' | 'revoked' | 'expired'
  }): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>>
  getOrganizationInvitation(params: {
    organizationId: string
    invitationId: string
  }): Promise<ClerkOrganizationInvitation>
  createOrganizationInvitation(organizationId: string, params: CreateInvitationParams): Promise<ClerkOrganizationInvitation>
  createBulkOrganizationInvitations(
    organizationId: string,
    invitations: CreateInvitationParams[]
  ): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>>
  revokeOrganizationInvitation(params: {
    organizationId: string
    invitationId: string
    requesting_user_id?: string
  }): Promise<ClerkOrganizationInvitation>
  getPendingOrganizationInvitationList(params: {
    limit?: number
    offset?: number
    user_email_address?: string
  }): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>>

  // Roles management
  getOrganizationRoleList(params?: {
    limit?: number
    offset?: number
  }): Promise<ClerkPaginatedList<ClerkOrganizationRole>>
  getOrganizationRole(roleId: string): Promise<ClerkOrganizationRole>
  createOrganizationRole(params: CreateRoleParams): Promise<ClerkOrganizationRole>
  updateOrganizationRole(roleId: string, params: UpdateRoleParams): Promise<ClerkOrganizationRole>
  deleteOrganizationRole(roleId: string): Promise<ClerkDeletedObject>
  assignPermissionToRole(roleId: string, permissionId: string): Promise<ClerkOrganizationRole>
  removePermissionFromRole(roleId: string, permissionId: string): Promise<ClerkOrganizationRole>

  // Permissions management
  getOrganizationPermissionList(params?: {
    limit?: number
    offset?: number
  }): Promise<ClerkPaginatedList<ClerkOrganizationPermission>>
  getOrganizationPermission(permissionId: string): Promise<ClerkOrganizationPermission>
  createOrganizationPermission(params: CreatePermissionParams): Promise<ClerkOrganizationPermission>
  updateOrganizationPermission(
    permissionId: string,
    params: { name?: string; description?: string }
  ): Promise<ClerkOrganizationPermission>
  deleteOrganizationPermission(permissionId: string): Promise<ClerkDeletedObject>

  // Domain management
  getOrganizationDomainList(params: {
    organizationId: string
    limit?: number
    offset?: number
    verified?: boolean
    enrollment_mode?: string
  }): Promise<ClerkPaginatedList<ClerkOrganizationDomain>>
  getOrganizationDomain(params: { organizationId: string; domainId: string }): Promise<ClerkOrganizationDomain>
  createOrganizationDomain(organizationId: string, params: CreateDomainParams): Promise<ClerkOrganizationDomain>
  updateOrganizationDomain(params: {
    organizationId: string
    domainId: string
    enrollment_mode?: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
  }): Promise<ClerkOrganizationDomain>
  deleteOrganizationDomain(params: { organizationId: string; domainId: string }): Promise<ClerkDeletedObject>
  verifyOrganizationDomain(params: { organizationId: string; domainId: string }): Promise<ClerkOrganizationDomain>
  prepareOrganizationDomainVerification(params: {
    organizationId: string
    domainId: string
    strategy: 'email_code' | 'dns_record'
    affiliation_email_address?: string
  }): Promise<ClerkOrganizationDomain>
}

/**
 * Create Organizations API manager
 */
export function createOrganizationsManager(options: {
  userManager: UserManager
}): OrganizationsAPI {
  const { userManager } = options

  // Storage for organizations and related data
  const organizationStore = createTemporalStore<StoredOrganization>()
  const membershipStore = createTemporalStore<StoredMembership>()
  const invitationStore = createTemporalStore<StoredInvitation>()
  const domainStore = createTemporalStore<StoredDomain>()
  const roleStore = createTemporalStore<ClerkOrganizationRole>()
  const permissionStore = createTemporalStore<ClerkOrganizationPermission>()

  // Index stores for lookups
  const slugToOrgStore = createTemporalStore<string>() // slug -> org_id
  const userOrgStore = createTemporalStore<string[]>() // user_id -> org_ids
  const emailInvitationStore = createTemporalStore<string[]>() // email -> invitation_ids
  const domainOrgStore = createTemporalStore<string>() // domain_name -> org_id

  // Initialize default roles and permissions
  const initializeDefaults = async (): Promise<void> => {
    const now = Date.now()
    for (const permission of SYSTEM_PERMISSIONS) {
      const existing = await permissionStore.get(`permission:${permission.id}`)
      if (!existing) {
        await permissionStore.put(`permission:${permission.id}`, { ...permission, created_at: now, updated_at: now }, now)
        await permissionStore.put(`permission_key:${permission.key}`, { ...permission, created_at: now, updated_at: now }, now)
      }
    }
    for (const role of DEFAULT_ROLES) {
      const existing = await roleStore.get(`role:${role.id}`)
      if (!existing) {
        await roleStore.put(`role:${role.id}`, { ...role, created_at: now, updated_at: now }, now)
        await roleStore.put(`role_key:${role.key}`, { ...role, created_at: now, updated_at: now }, now)
      }
    }
  }

  // Run initialization
  initializeDefaults().catch(() => {})

  // Helper functions
  const generateId = (prefix: string): string => {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  const slugify = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  const toPublicOrganization = (stored: StoredOrganization): ClerkOrganization => {
    const { membershipIds: _, invitationIds: __, domainIds: ___, ...rest } = stored
    return { ...rest, object: 'organization' }
  }

  const toPublicMembership = async (
    stored: StoredMembership,
    org: StoredOrganization
  ): Promise<ClerkOrganizationMembership> => {
    const role = await roleStore.get(`role_key:${stored.role}`)
    return {
      id: stored.id,
      object: 'organization_membership',
      public_metadata: stored.public_metadata,
      private_metadata: stored.private_metadata,
      role: stored.role,
      role_name: role?.name,
      permissions: stored.permissions,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
      organization: toPublicOrganization(org),
      public_user_data: stored.public_user_data,
    }
  }

  const toPublicInvitation = (stored: StoredInvitation): ClerkOrganizationInvitation => {
    return { ...stored, object: 'organization_invitation' }
  }

  const toPublicDomain = (stored: StoredDomain): ClerkOrganizationDomain => {
    return { ...stored, object: 'organization_domain' }
  }

  const getRolePermissions = async (roleKey: string): Promise<string[]> => {
    const role = await roleStore.get(`role_key:${roleKey}`)
    return role?.permissions ?? []
  }

  const addUserToOrgIndex = async (userId: string, orgId: string): Promise<void> => {
    const userOrgs = (await userOrgStore.get(`user_orgs:${userId}`)) ?? []
    if (!userOrgs.includes(orgId)) {
      userOrgs.push(orgId)
      await userOrgStore.put(`user_orgs:${userId}`, userOrgs, Date.now())
    }
  }

  const removeUserFromOrgIndex = async (userId: string, orgId: string): Promise<void> => {
    const userOrgs = (await userOrgStore.get(`user_orgs:${userId}`)) ?? []
    const index = userOrgs.indexOf(orgId)
    if (index !== -1) {
      userOrgs.splice(index, 1)
      await userOrgStore.put(`user_orgs:${userId}`, userOrgs, Date.now())
    }
  }

  return {
    // ═══════════════════════════════════════════════════════════════════════════
    // ORGANIZATION CRUD
    // ═══════════════════════════════════════════════════════════════════════════

    async getOrganization(organizationId: string): Promise<ClerkOrganization> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }
      return toPublicOrganization(org)
    },

    async getOrganizationBySlug(slug: string): Promise<ClerkOrganization> {
      const orgId = await slugToOrgStore.get(`slug:${slug}`)
      if (!orgId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }
      const org = await organizationStore.get(`org:${orgId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }
      return toPublicOrganization(org)
    },

    async getOrganizationList(params?: {
      limit?: number
      offset?: number
      include_members_count?: boolean
      query?: string
      user_id?: string[]
      order_by?: string
    }): Promise<ClerkPaginatedList<ClerkOrganization>> {
      const orgs: ClerkOrganization[] = []

      if (params?.user_id) {
        for (const userId of params.user_id) {
          const userOrgs = (await userOrgStore.get(`user_orgs:${userId}`)) ?? []
          for (const orgId of userOrgs) {
            const org = await organizationStore.get(`org:${orgId}`)
            if (org && !orgs.find((o) => o.id === org.id)) {
              orgs.push(toPublicOrganization(org))
            }
          }
        }
      }

      const limit = params?.limit ?? 10
      const offset = params?.offset ?? 0

      return {
        data: orgs.slice(offset, offset + limit),
        total_count: orgs.length,
      }
    },

    async createOrganization(params: CreateOrganizationParams): Promise<ClerkOrganization> {
      const now = Date.now()
      const orgId = generateId('org')
      const slug = params.slug ?? slugify(params.name)

      // Check slug uniqueness
      const existingSlug = await slugToOrgStore.get(`slug:${slug}`)
      if (existingSlug) {
        throw new ClerkAPIError(422, [
          { code: 'form_identifier_exists', message: 'An organization with this slug already exists' },
        ])
      }

      const user = await userManager.getUser(params.created_by)

      const org: StoredOrganization = {
        id: orgId,
        name: params.name,
        slug,
        image_url: '',
        has_image: false,
        members_count: 1,
        pending_invitations_count: 0,
        max_allowed_memberships: params.max_allowed_memberships ?? 5,
        admin_delete_enabled: true,
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        created_by: params.created_by,
        created_at: now,
        updated_at: now,
        membershipIds: [],
        invitationIds: [],
        domainIds: [],
      }

      // Create membership for creator as admin
      const membershipId = generateId('mem')
      const adminPermissions = await getRolePermissions('org:admin')

      const membership: StoredMembership = {
        id: membershipId,
        organization_id: orgId,
        user_id: params.created_by,
        role: 'org:admin',
        permissions: adminPermissions,
        public_metadata: {},
        private_metadata: {},
        public_user_data: {
          user_id: params.created_by,
          first_name: user?.first_name ?? null,
          last_name: user?.last_name ?? null,
          image_url: user?.picture ?? '',
          has_image: !!user?.picture,
          identifier: user?.email ?? user?.username ?? params.created_by,
        },
        created_at: now,
        updated_at: now,
      }

      org.membershipIds.push(membershipId)

      await organizationStore.put(`org:${orgId}`, org, now)
      await slugToOrgStore.put(`slug:${slug}`, orgId, now)
      await membershipStore.put(`membership:${membershipId}`, membership, now)
      await addUserToOrgIndex(params.created_by, orgId)

      return toPublicOrganization(org)
    },

    async updateOrganization(organizationId: string, params: UpdateOrganizationParams): Promise<ClerkOrganization> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const now = Date.now()
      const oldSlug = org.slug

      if (params.name !== undefined) org.name = params.name
      if (params.slug !== undefined && params.slug !== oldSlug) {
        const existingSlug = await slugToOrgStore.get(`slug:${params.slug}`)
        if (existingSlug && existingSlug !== organizationId) {
          throw new ClerkAPIError(422, [
            { code: 'form_identifier_exists', message: 'An organization with this slug already exists' },
          ])
        }
        await slugToOrgStore.put(`slug:${oldSlug}`, null as unknown as string, now)
        await slugToOrgStore.put(`slug:${params.slug}`, organizationId, now)
        org.slug = params.slug
      }
      if (params.max_allowed_memberships !== undefined) org.max_allowed_memberships = params.max_allowed_memberships
      if (params.admin_delete_enabled !== undefined) org.admin_delete_enabled = params.admin_delete_enabled
      if (params.public_metadata !== undefined) org.public_metadata = { ...org.public_metadata, ...params.public_metadata }
      if (params.private_metadata !== undefined) org.private_metadata = { ...org.private_metadata, ...params.private_metadata }

      org.updated_at = now
      await organizationStore.put(`org:${organizationId}`, org, now)

      return toPublicOrganization(org)
    },

    async deleteOrganization(organizationId: string): Promise<ClerkDeletedObject> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const now = Date.now()

      // Remove all memberships
      for (const membershipId of org.membershipIds) {
        const membership = await membershipStore.get(`membership:${membershipId}`)
        if (membership) {
          await removeUserFromOrgIndex(membership.user_id, organizationId)
          await membershipStore.put(`membership:${membershipId}`, null as unknown as StoredMembership, now)
        }
      }

      // Remove all invitations
      for (const invitationId of org.invitationIds) {
        await invitationStore.put(`invitation:${invitationId}`, null as unknown as StoredInvitation, now)
      }

      // Remove all domains
      for (const domainId of org.domainIds) {
        const domain = await domainStore.get(`domain:${domainId}`)
        if (domain) {
          await domainOrgStore.put(`domain_name:${domain.name}`, null as unknown as string, now)
          await domainStore.put(`domain:${domainId}`, null as unknown as StoredDomain, now)
        }
      }

      // Remove slug index
      await slugToOrgStore.put(`slug:${org.slug}`, null as unknown as string, now)

      // Remove organization
      await organizationStore.put(`org:${organizationId}`, null as unknown as StoredOrganization, now)

      return {
        id: organizationId,
        object: 'organization',
        deleted: true,
      }
    },

    async updateOrganizationLogo(organizationId: string, file: { url: string }): Promise<ClerkOrganization> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const now = Date.now()
      org.image_url = file.url
      org.has_image = true
      org.updated_at = now

      await organizationStore.put(`org:${organizationId}`, org, now)

      return toPublicOrganization(org)
    },

    async deleteOrganizationLogo(organizationId: string): Promise<ClerkOrganization> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const now = Date.now()
      org.image_url = ''
      org.has_image = false
      org.updated_at = now

      await organizationStore.put(`org:${organizationId}`, org, now)

      return toPublicOrganization(org)
    },

    async updateOrganizationMetadata(
      organizationId: string,
      params: { public_metadata?: Record<string, unknown>; private_metadata?: Record<string, unknown> }
    ): Promise<ClerkOrganization> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const now = Date.now()
      if (params.public_metadata !== undefined) {
        org.public_metadata = params.public_metadata
      }
      if (params.private_metadata !== undefined) {
        org.private_metadata = params.private_metadata
      }
      org.updated_at = now

      await organizationStore.put(`org:${organizationId}`, org, now)

      return toPublicOrganization(org)
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // MEMBERSHIP MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async getOrganizationMembershipList(params: {
      organizationId: string
      limit?: number
      offset?: number
      role?: string[]
      order_by?: string
    }): Promise<ClerkPaginatedList<ClerkOrganizationMembership>> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const memberships: ClerkOrganizationMembership[] = []
      for (const membershipId of org.membershipIds) {
        const membership = await membershipStore.get(`membership:${membershipId}`)
        if (membership) {
          if (!params.role || params.role.includes(membership.role)) {
            memberships.push(await toPublicMembership(membership, org))
          }
        }
      }

      const limit = params.limit ?? 10
      const offset = params.offset ?? 0

      return {
        data: memberships.slice(offset, offset + limit),
        total_count: memberships.length,
      }
    },

    async createOrganizationMembership(params: CreateMembershipParams): Promise<ClerkOrganizationMembership> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      // Check if user is already a member
      for (const membershipId of org.membershipIds) {
        const existing = await membershipStore.get(`membership:${membershipId}`)
        if (existing && existing.user_id === params.userId) {
          throw new ClerkAPIError(422, [
            { code: 'duplicate_record', message: 'User is already a member of this organization' },
          ])
        }
      }

      // Check max memberships
      if (org.membershipIds.length >= org.max_allowed_memberships) {
        throw new ClerkAPIError(403, [
          { code: 'organization_membership_quota_exceeded', message: 'Organization membership limit reached' },
        ])
      }

      const user = await userManager.getUser(params.userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()
      const membershipId = generateId('mem')
      const permissions = await getRolePermissions(params.role)

      const membership: StoredMembership = {
        id: membershipId,
        organization_id: params.organizationId,
        user_id: params.userId,
        role: params.role,
        permissions,
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        public_user_data: {
          user_id: params.userId,
          first_name: user.first_name ?? null,
          last_name: user.last_name ?? null,
          image_url: user.picture ?? '',
          has_image: !!user.picture,
          identifier: user.email ?? user.username ?? params.userId,
        },
        created_at: now,
        updated_at: now,
      }

      org.membershipIds.push(membershipId)
      org.members_count = org.membershipIds.length
      org.updated_at = now

      await membershipStore.put(`membership:${membershipId}`, membership, now)
      await organizationStore.put(`org:${params.organizationId}`, org, now)
      await addUserToOrgIndex(params.userId, params.organizationId)

      return toPublicMembership(membership, org)
    },

    async updateOrganizationMembership(params: UpdateMembershipParams): Promise<ClerkOrganizationMembership> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      let membership: StoredMembership | null = null
      for (const membershipId of org.membershipIds) {
        const m = await membershipStore.get(`membership:${membershipId}`)
        if (m && m.user_id === params.userId) {
          membership = m
          break
        }
      }

      if (!membership) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
      }

      const now = Date.now()
      membership.role = params.role
      membership.permissions = await getRolePermissions(params.role)
      if (params.public_metadata !== undefined) {
        membership.public_metadata = { ...membership.public_metadata, ...params.public_metadata }
      }
      if (params.private_metadata !== undefined) {
        membership.private_metadata = { ...membership.private_metadata, ...params.private_metadata }
      }
      membership.updated_at = now

      await membershipStore.put(`membership:${membership.id}`, membership, now)

      return toPublicMembership(membership, org)
    },

    async updateOrganizationMembershipMetadata(params: {
      organizationId: string
      userId: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }): Promise<ClerkOrganizationMembership> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      let membership: StoredMembership | null = null
      for (const membershipId of org.membershipIds) {
        const m = await membershipStore.get(`membership:${membershipId}`)
        if (m && m.user_id === params.userId) {
          membership = m
          break
        }
      }

      if (!membership) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
      }

      const now = Date.now()
      if (params.public_metadata !== undefined) {
        membership.public_metadata = params.public_metadata
      }
      if (params.private_metadata !== undefined) {
        membership.private_metadata = params.private_metadata
      }
      membership.updated_at = now

      await membershipStore.put(`membership:${membership.id}`, membership, now)

      return toPublicMembership(membership, org)
    },

    async deleteOrganizationMembership(params: {
      organizationId: string
      userId: string
    }): Promise<ClerkDeletedObject> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      let membershipId: string | null = null
      for (const id of org.membershipIds) {
        const m = await membershipStore.get(`membership:${id}`)
        if (m && m.user_id === params.userId) {
          membershipId = id
          break
        }
      }

      if (!membershipId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
      }

      const now = Date.now()
      const index = org.membershipIds.indexOf(membershipId)
      if (index !== -1) {
        org.membershipIds.splice(index, 1)
      }
      org.members_count = org.membershipIds.length
      org.updated_at = now

      await membershipStore.put(`membership:${membershipId}`, null as unknown as StoredMembership, now)
      await organizationStore.put(`org:${params.organizationId}`, org, now)
      await removeUserFromOrgIndex(params.userId, params.organizationId)

      return {
        id: membershipId,
        object: 'organization_membership',
        deleted: true,
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // INVITATION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async getOrganizationInvitationList(params: {
      organizationId: string
      limit?: number
      offset?: number
      status?: 'pending' | 'accepted' | 'revoked' | 'expired'
    }): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const invitations: ClerkOrganizationInvitation[] = []
      for (const invitationId of org.invitationIds) {
        const invitation = await invitationStore.get(`invitation:${invitationId}`)
        if (invitation) {
          // Check expiration
          if (invitation.status === 'pending' && invitation.expires_at && invitation.expires_at < Date.now()) {
            invitation.status = 'expired'
            await invitationStore.put(`invitation:${invitationId}`, invitation, Date.now())
          }
          if (!params.status || invitation.status === params.status) {
            invitations.push(toPublicInvitation(invitation))
          }
        }
      }

      const limit = params.limit ?? 10
      const offset = params.offset ?? 0

      return {
        data: invitations.slice(offset, offset + limit),
        total_count: invitations.length,
      }
    },

    async getOrganizationInvitation(params: {
      organizationId: string
      invitationId: string
    }): Promise<ClerkOrganizationInvitation> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const invitation = await invitationStore.get(`invitation:${params.invitationId}`)
      if (!invitation || invitation.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Invitation not found' }])
      }

      return toPublicInvitation(invitation)
    },

    async createOrganizationInvitation(
      organizationId: string,
      params: CreateInvitationParams
    ): Promise<ClerkOrganizationInvitation> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      // Check for existing pending invitation
      for (const invitationId of org.invitationIds) {
        const existing = await invitationStore.get(`invitation:${invitationId}`)
        if (existing && existing.email_address === params.email_address && existing.status === 'pending') {
          throw new ClerkAPIError(422, [
            { code: 'duplicate_record', message: 'A pending invitation already exists for this email' },
          ])
        }
      }

      const now = Date.now()
      const invitationId = generateId('inv')
      const expiresInDays = params.expires_in_days ?? 14
      const expiresAt = now + expiresInDays * 24 * 60 * 60 * 1000

      const role = await roleStore.get(`role_key:${params.role}`)

      const invitation: StoredInvitation = {
        id: invitationId,
        email_address: params.email_address,
        role: params.role,
        role_name: role?.name,
        organization_id: organizationId,
        inviter_user_id: params.inviter_user_id,
        status: 'pending',
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      }

      org.invitationIds.push(invitationId)
      org.pending_invitations_count = org.invitationIds.filter(
        (id) => invitationStore.get(`invitation:${id}`).then((inv) => inv?.status === 'pending')
      ).length

      // Update pending count
      let pendingCount = 0
      for (const id of org.invitationIds) {
        const inv = await invitationStore.get(`invitation:${id}`)
        if (inv?.status === 'pending') pendingCount++
      }
      org.pending_invitations_count = pendingCount + 1
      org.updated_at = now

      await invitationStore.put(`invitation:${invitationId}`, invitation, now)
      await organizationStore.put(`org:${organizationId}`, org, now)

      // Add to email index
      const emailInvitations = (await emailInvitationStore.get(`email:${params.email_address}`)) ?? []
      emailInvitations.push(invitationId)
      await emailInvitationStore.put(`email:${params.email_address}`, emailInvitations, now)

      return toPublicInvitation(invitation)
    },

    async createBulkOrganizationInvitations(
      organizationId: string,
      invitations: CreateInvitationParams[]
    ): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>> {
      const results: ClerkOrganizationInvitation[] = []
      for (const params of invitations) {
        try {
          const invitation = await this.createOrganizationInvitation(organizationId, params)
          results.push(invitation)
        } catch {
          // Skip failed invitations in bulk mode
        }
      }
      return { data: results, total_count: results.length }
    },

    async revokeOrganizationInvitation(params: {
      organizationId: string
      invitationId: string
      requesting_user_id?: string
    }): Promise<ClerkOrganizationInvitation> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const invitation = await invitationStore.get(`invitation:${params.invitationId}`)
      if (!invitation || invitation.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Invitation not found' }])
      }

      if (invitation.status !== 'pending') {
        throw new ClerkAPIError(422, [{ code: 'invalid_state', message: 'Invitation cannot be revoked' }])
      }

      const now = Date.now()
      invitation.status = 'revoked'
      invitation.updated_at = now

      // Update pending count
      let pendingCount = 0
      for (const id of org.invitationIds) {
        const inv = await invitationStore.get(`invitation:${id}`)
        if (inv?.status === 'pending' && inv.id !== params.invitationId) pendingCount++
      }
      org.pending_invitations_count = pendingCount
      org.updated_at = now

      await invitationStore.put(`invitation:${params.invitationId}`, invitation, now)
      await organizationStore.put(`org:${params.organizationId}`, org, now)

      return toPublicInvitation(invitation)
    },

    async getPendingOrganizationInvitationList(params: {
      limit?: number
      offset?: number
      user_email_address?: string
    }): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>> {
      if (!params.user_email_address) {
        return { data: [], total_count: 0 }
      }

      const invitationIds = (await emailInvitationStore.get(`email:${params.user_email_address}`)) ?? []
      const invitations: ClerkOrganizationInvitation[] = []

      for (const invitationId of invitationIds) {
        const invitation = await invitationStore.get(`invitation:${invitationId}`)
        if (invitation && invitation.status === 'pending') {
          // Check expiration
          if (invitation.expires_at && invitation.expires_at < Date.now()) {
            invitation.status = 'expired'
            await invitationStore.put(`invitation:${invitationId}`, invitation, Date.now())
          } else {
            invitations.push(toPublicInvitation(invitation))
          }
        }
      }

      const limit = params.limit ?? 10
      const offset = params.offset ?? 0

      return {
        data: invitations.slice(offset, offset + limit),
        total_count: invitations.length,
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ROLES MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async getOrganizationRoleList(params?: {
      limit?: number
      offset?: number
    }): Promise<ClerkPaginatedList<ClerkOrganizationRole>> {
      // Return default roles plus any custom roles
      const roles: ClerkOrganizationRole[] = []

      for (const defaultRole of DEFAULT_ROLES) {
        const role = await roleStore.get(`role:${defaultRole.id}`)
        if (role) roles.push(role)
      }

      // Note: Custom roles would be tracked separately in production

      const limit = params?.limit ?? 10
      const offset = params?.offset ?? 0

      return {
        data: roles.slice(offset, offset + limit),
        total_count: roles.length,
      }
    },

    async getOrganizationRole(roleId: string): Promise<ClerkOrganizationRole> {
      const role = await roleStore.get(`role:${roleId}`)
      if (!role) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Role not found' }])
      }
      return role
    },

    async createOrganizationRole(params: CreateRoleParams): Promise<ClerkOrganizationRole> {
      // Check if key already exists
      const existing = await roleStore.get(`role_key:${params.key}`)
      if (existing) {
        throw new ClerkAPIError(422, [
          { code: 'duplicate_record', message: 'A role with this key already exists' },
        ])
      }

      const now = Date.now()
      const roleId = generateId('role')

      const role: ClerkOrganizationRole = {
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

      await roleStore.put(`role:${roleId}`, role, now)
      await roleStore.put(`role_key:${params.key}`, role, now)

      return role
    },

    async updateOrganizationRole(roleId: string, params: UpdateRoleParams): Promise<ClerkOrganizationRole> {
      const role = await roleStore.get(`role:${roleId}`)
      if (!role) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Role not found' }])
      }

      // Don't allow modifying system roles
      if (roleId === 'role_admin' || roleId === 'role_member') {
        throw new ClerkAPIError(403, [{ code: 'forbidden', message: 'Cannot modify system roles' }])
      }

      const now = Date.now()
      if (params.name !== undefined) role.name = params.name
      if (params.description !== undefined) role.description = params.description
      if (params.permissions !== undefined) role.permissions = params.permissions
      role.updated_at = now

      await roleStore.put(`role:${roleId}`, role, now)
      await roleStore.put(`role_key:${role.key}`, role, now)

      return role
    },

    async deleteOrganizationRole(roleId: string): Promise<ClerkDeletedObject> {
      const role = await roleStore.get(`role:${roleId}`)
      if (!role) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Role not found' }])
      }

      // Don't allow deleting system roles
      if (roleId === 'role_admin' || roleId === 'role_member') {
        throw new ClerkAPIError(403, [{ code: 'forbidden', message: 'Cannot delete system roles' }])
      }

      const now = Date.now()
      await roleStore.put(`role:${roleId}`, null as unknown as ClerkOrganizationRole, now)
      await roleStore.put(`role_key:${role.key}`, null as unknown as ClerkOrganizationRole, now)

      return {
        id: roleId,
        object: 'role',
        deleted: true,
      }
    },

    async assignPermissionToRole(roleId: string, permissionId: string): Promise<ClerkOrganizationRole> {
      const role = await roleStore.get(`role:${roleId}`)
      if (!role) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Role not found' }])
      }

      const permission = await permissionStore.get(`permission:${permissionId}`)
      if (!permission) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Permission not found' }])
      }

      if (!role.permissions.includes(permission.key)) {
        role.permissions.push(permission.key)
        role.updated_at = Date.now()
        await roleStore.put(`role:${roleId}`, role, Date.now())
        await roleStore.put(`role_key:${role.key}`, role, Date.now())
      }

      return role
    },

    async removePermissionFromRole(roleId: string, permissionId: string): Promise<ClerkOrganizationRole> {
      const role = await roleStore.get(`role:${roleId}`)
      if (!role) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Role not found' }])
      }

      const permission = await permissionStore.get(`permission:${permissionId}`)
      if (!permission) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Permission not found' }])
      }

      const index = role.permissions.indexOf(permission.key)
      if (index !== -1) {
        role.permissions.splice(index, 1)
        role.updated_at = Date.now()
        await roleStore.put(`role:${roleId}`, role, Date.now())
        await roleStore.put(`role_key:${role.key}`, role, Date.now())
      }

      return role
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSIONS MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async getOrganizationPermissionList(params?: {
      limit?: number
      offset?: number
    }): Promise<ClerkPaginatedList<ClerkOrganizationPermission>> {
      const permissions: ClerkOrganizationPermission[] = []

      for (const systemPerm of SYSTEM_PERMISSIONS) {
        const perm = await permissionStore.get(`permission:${systemPerm.id}`)
        if (perm) permissions.push(perm)
      }

      // Note: Custom permissions would be tracked separately in production

      const limit = params?.limit ?? 20
      const offset = params?.offset ?? 0

      return {
        data: permissions.slice(offset, offset + limit),
        total_count: permissions.length,
      }
    },

    async getOrganizationPermission(permissionId: string): Promise<ClerkOrganizationPermission> {
      const permission = await permissionStore.get(`permission:${permissionId}`)
      if (!permission) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Permission not found' }])
      }
      return permission
    },

    async createOrganizationPermission(params: CreatePermissionParams): Promise<ClerkOrganizationPermission> {
      // Check if key already exists
      const existing = await permissionStore.get(`permission_key:${params.key}`)
      if (existing) {
        throw new ClerkAPIError(422, [
          { code: 'duplicate_record', message: 'A permission with this key already exists' },
        ])
      }

      const now = Date.now()
      const permissionId = generateId('perm')

      const permission: ClerkOrganizationPermission = {
        id: permissionId,
        object: 'permission',
        name: params.name,
        key: params.key,
        description: params.description ?? '',
        type: 'custom',
        created_at: now,
        updated_at: now,
      }

      await permissionStore.put(`permission:${permissionId}`, permission, now)
      await permissionStore.put(`permission_key:${params.key}`, permission, now)

      return permission
    },

    async updateOrganizationPermission(
      permissionId: string,
      params: { name?: string; description?: string }
    ): Promise<ClerkOrganizationPermission> {
      const permission = await permissionStore.get(`permission:${permissionId}`)
      if (!permission) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Permission not found' }])
      }

      // Don't allow modifying system permissions
      if (permission.type === 'system') {
        throw new ClerkAPIError(403, [{ code: 'forbidden', message: 'Cannot modify system permissions' }])
      }

      const now = Date.now()
      if (params.name !== undefined) permission.name = params.name
      if (params.description !== undefined) permission.description = params.description
      permission.updated_at = now

      await permissionStore.put(`permission:${permissionId}`, permission, now)
      await permissionStore.put(`permission_key:${permission.key}`, permission, now)

      return permission
    },

    async deleteOrganizationPermission(permissionId: string): Promise<ClerkDeletedObject> {
      const permission = await permissionStore.get(`permission:${permissionId}`)
      if (!permission) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Permission not found' }])
      }

      // Don't allow deleting system permissions
      if (permission.type === 'system') {
        throw new ClerkAPIError(403, [{ code: 'forbidden', message: 'Cannot delete system permissions' }])
      }

      const now = Date.now()
      await permissionStore.put(`permission:${permissionId}`, null as unknown as ClerkOrganizationPermission, now)
      await permissionStore.put(`permission_key:${permission.key}`, null as unknown as ClerkOrganizationPermission, now)

      return {
        id: permissionId,
        object: 'permission',
        deleted: true,
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // DOMAIN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async getOrganizationDomainList(params: {
      organizationId: string
      limit?: number
      offset?: number
      verified?: boolean
      enrollment_mode?: string
    }): Promise<ClerkPaginatedList<ClerkOrganizationDomain>> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const domains: ClerkOrganizationDomain[] = []
      for (const domainId of org.domainIds) {
        const domain = await domainStore.get(`domain:${domainId}`)
        if (domain) {
          const isVerified = domain.verification?.status === 'verified'
          if (params.verified !== undefined && isVerified !== params.verified) continue
          if (params.enrollment_mode && domain.enrollment_mode !== params.enrollment_mode) continue
          domains.push(toPublicDomain(domain))
        }
      }

      const limit = params.limit ?? 10
      const offset = params.offset ?? 0

      return {
        data: domains.slice(offset, offset + limit),
        total_count: domains.length,
      }
    },

    async getOrganizationDomain(params: {
      organizationId: string
      domainId: string
    }): Promise<ClerkOrganizationDomain> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const domain = await domainStore.get(`domain:${params.domainId}`)
      if (!domain || domain.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Domain not found' }])
      }

      return toPublicDomain(domain)
    },

    async createOrganizationDomain(
      organizationId: string,
      params: CreateDomainParams
    ): Promise<ClerkOrganizationDomain> {
      const org = await organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      // Check if domain is already used
      const existingOrgId = await domainOrgStore.get(`domain_name:${params.name}`)
      if (existingOrgId) {
        throw new ClerkAPIError(422, [
          { code: 'duplicate_record', message: 'This domain is already claimed by another organization' },
        ])
      }

      const now = Date.now()
      const domainId = generateId('dom')

      const domain: StoredDomain = {
        id: domainId,
        organization_id: organizationId,
        name: params.name,
        enrollment_mode: params.enrollment_mode ?? 'manual_invitation',
        total_pending_invitations: 0,
        total_pending_suggestions: 0,
        verification: params.verified
          ? { status: 'verified', strategy: 'email_code', attempts: 0, expires_at: null }
          : null,
        created_at: now,
        updated_at: now,
      }

      org.domainIds.push(domainId)
      org.updated_at = now

      await domainStore.put(`domain:${domainId}`, domain, now)
      await domainOrgStore.put(`domain_name:${params.name}`, organizationId, now)
      await organizationStore.put(`org:${organizationId}`, org, now)

      return toPublicDomain(domain)
    },

    async updateOrganizationDomain(params: {
      organizationId: string
      domainId: string
      enrollment_mode?: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
    }): Promise<ClerkOrganizationDomain> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const domain = await domainStore.get(`domain:${params.domainId}`)
      if (!domain || domain.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Domain not found' }])
      }

      const now = Date.now()
      if (params.enrollment_mode !== undefined) {
        domain.enrollment_mode = params.enrollment_mode
      }
      domain.updated_at = now

      await domainStore.put(`domain:${params.domainId}`, domain, now)

      return toPublicDomain(domain)
    },

    async deleteOrganizationDomain(params: {
      organizationId: string
      domainId: string
    }): Promise<ClerkDeletedObject> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const domain = await domainStore.get(`domain:${params.domainId}`)
      if (!domain || domain.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Domain not found' }])
      }

      const now = Date.now()
      const index = org.domainIds.indexOf(params.domainId)
      if (index !== -1) {
        org.domainIds.splice(index, 1)
      }
      org.updated_at = now

      await domainStore.put(`domain:${params.domainId}`, null as unknown as StoredDomain, now)
      await domainOrgStore.put(`domain_name:${domain.name}`, null as unknown as string, now)
      await organizationStore.put(`org:${params.organizationId}`, org, now)

      return {
        id: params.domainId,
        object: 'organization_domain',
        deleted: true,
      }
    },

    async verifyOrganizationDomain(params: {
      organizationId: string
      domainId: string
    }): Promise<ClerkOrganizationDomain> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const domain = await domainStore.get(`domain:${params.domainId}`)
      if (!domain || domain.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Domain not found' }])
      }

      if (!domain.verification) {
        throw new ClerkAPIError(422, [
          { code: 'invalid_state', message: 'Domain verification has not been prepared' },
        ])
      }

      const now = Date.now()
      domain.verification.status = 'verified'
      domain.updated_at = now

      await domainStore.put(`domain:${params.domainId}`, domain, now)

      return toPublicDomain(domain)
    },

    async prepareOrganizationDomainVerification(params: {
      organizationId: string
      domainId: string
      strategy: 'email_code' | 'dns_record'
      affiliation_email_address?: string
    }): Promise<ClerkOrganizationDomain> {
      const org = await organizationStore.get(`org:${params.organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }

      const domain = await domainStore.get(`domain:${params.domainId}`)
      if (!domain || domain.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Domain not found' }])
      }

      const now = Date.now()
      const expiresAt = now + 24 * 60 * 60 * 1000 // 24 hours

      domain.verification = {
        status: 'unverified',
        strategy: params.strategy,
        attempts: 0,
        expires_at: expiresAt,
      }

      if (params.affiliation_email_address) {
        domain.affiliation_email_address = params.affiliation_email_address
      }

      domain.updated_at = now

      await domainStore.put(`domain:${params.domainId}`, domain, now)

      return toPublicDomain(domain)
    },
  }
}
