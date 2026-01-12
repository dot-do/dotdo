/**
 * @dotdo/clerk - Backend API
 *
 * Clerk Backend API compatible implementation.
 * Provides users, sessions, organizations, and JWT template management.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import { createUserManager, type UserManager } from '../shared/users'
import { createSessionManager, type SessionManager } from '../shared/sessions'
import { createMFAManager, type MFAManager } from '../shared/mfa'
import { createJWT, verifyJWT, decodeJWT } from '../shared/jwt'
import type {
  ClerkUser,
  ClerkEmailAddress,
  ClerkPhoneNumber,
  ClerkSession,
  ClerkOrganization,
  ClerkOrganizationMembership,
  ClerkOrganizationInvitation,
  ClerkJWTTemplate,
  ClerkPaginatedList,
  ClerkDeletedObject,
  CreateUserParams,
  UpdateUserParams,
  CreateOrganizationParams,
  UpdateOrganizationParams,
  CreateInvitationParams,
  CreateJWTTemplateParams,
} from './types'
import { ClerkAPIError } from './types'

// ============================================================================
// CLERK CLIENT OPTIONS
// ============================================================================

/**
 * Clerk client configuration
 */
export interface ClerkClientOptions {
  /** Secret key from Clerk dashboard */
  secretKey: string
  /** Publishable key from Clerk dashboard */
  publishableKey?: string
  /** API version */
  apiVersion?: string
  /** JWT signing key */
  jwtKey?: string
}

// ============================================================================
// CLERK CLIENT
// ============================================================================

/**
 * Clerk Backend API client
 */
export class Clerk {
  private options: ClerkClientOptions
  private userManager: UserManager
  private sessionManager: SessionManager
  private mfaManager: MFAManager
  private organizationStore: TemporalStore<ClerkOrganization>
  private membershipStore: TemporalStore<ClerkOrganizationMembership>
  private invitationStore: TemporalStore<ClerkOrganizationInvitation>
  private jwtTemplateStore: TemporalStore<ClerkJWTTemplate>
  private userOrgStore: TemporalStore<string[]> // user_id -> org_ids
  private orgMemberStore: TemporalStore<string[]> // org_id -> membership_ids

  constructor(options: ClerkClientOptions) {
    this.options = options

    // Extract signing key from secret key or use provided jwtKey
    const jwtSecret = options.jwtKey ?? options.secretKey

    this.userManager = createUserManager()
    this.sessionManager = createSessionManager({
      jwtSecret,
      issuer: 'https://clerk.com',
    })
    this.mfaManager = createMFAManager({ totpIssuer: 'Clerk' })
    this.organizationStore = createTemporalStore<ClerkOrganization>()
    this.membershipStore = createTemporalStore<ClerkOrganizationMembership>()
    this.invitationStore = createTemporalStore<ClerkOrganizationInvitation>()
    this.jwtTemplateStore = createTemporalStore<ClerkJWTTemplate>()
    this.userOrgStore = createTemporalStore<string[]>()
    this.orgMemberStore = createTemporalStore<string[]>()
  }

  // ============================================================================
  // USERS API
  // ============================================================================

  /**
   * users namespace
   */
  users = {
    /**
     * Get a user by ID
     */
    getUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }
      return this.toClerkUser(user)
    },

    /**
     * Get a list of users
     */
    getUserList: async (params?: {
      limit?: number
      offset?: number
      email_address?: string[]
      phone_number?: string[]
      external_id?: string[]
      username?: string[]
      user_id?: string[]
      query?: string
      order_by?: string
    }): Promise<ClerkPaginatedList<ClerkUser>> => {
      // Simplified implementation
      const users: ClerkUser[] = []

      // If specific user IDs are provided, fetch them
      if (params?.user_id) {
        for (const id of params.user_id) {
          const user = await this.userManager.getUser(id)
          if (user) {
            users.push(this.toClerkUser(user))
          }
        }
      }

      // If email addresses are provided, fetch by email
      if (params?.email_address) {
        for (const email of params.email_address) {
          const user = await this.userManager.getUserByEmail(email)
          if (user && !users.find((u) => u.id === user.id)) {
            users.push(this.toClerkUser(user))
          }
        }
      }

      return {
        data: users,
        total_count: users.length,
      }
    },

    /**
     * Create a new user
     */
    createUser: async (params: CreateUserParams): Promise<ClerkUser> => {
      const user = await this.userManager.createUser({
        email: params.email_address?.[0],
        phone: params.phone_number?.[0],
        username: params.username,
        password: params.password,
        first_name: params.first_name ?? undefined,
        last_name: params.last_name ?? undefined,
        metadata: params.public_metadata,
        app_metadata: {
          ...params.private_metadata,
          external_id: params.external_id,
          unsafe_metadata: params.unsafe_metadata,
        },
      })

      // Handle additional email addresses
      if (params.email_address && params.email_address.length > 1) {
        // Would add additional email addresses in production
      }

      // Handle TOTP secret
      if (params.totp_secret) {
        // Would configure TOTP in production
      }

      return this.toClerkUser(user)
    },

    /**
     * Update a user
     */
    updateUser: async (userId: string, params: UpdateUserParams): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        username: params.username,
        password: params.password,
        first_name: params.first_name ?? undefined,
        last_name: params.last_name ?? undefined,
        metadata: params.public_metadata,
        app_metadata: {
          ...params.private_metadata,
          external_id: params.external_id,
          unsafe_metadata: params.unsafe_metadata,
        },
      })

      return this.toClerkUser(user)
    },

    /**
     * Delete a user
     */
    deleteUser: async (userId: string): Promise<ClerkDeletedObject> => {
      await this.userManager.deleteUser(userId)

      return {
        id: userId,
        object: 'user',
        deleted: true,
      }
    },

    /**
     * Ban a user
     */
    banUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { banned: true },
      })
      return this.toClerkUser(user)
    },

    /**
     * Unban a user
     */
    unbanUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { banned: false },
      })
      return this.toClerkUser(user)
    },

    /**
     * Lock a user
     */
    lockUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { locked: true },
      })
      return this.toClerkUser(user)
    },

    /**
     * Unlock a user
     */
    unlockUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { locked: false },
      })
      return this.toClerkUser(user)
    },

    /**
     * Get user's organization memberships
     */
    getOrganizationMembershipList: async (params: {
      userId: string
      limit?: number
      offset?: number
    }): Promise<ClerkPaginatedList<ClerkOrganizationMembership>> => {
      const orgIds = (await this.userOrgStore.get(`user_orgs:${params.userId}`)) ?? []
      const memberships: ClerkOrganizationMembership[] = []

      for (const orgId of orgIds) {
        const membershipIds = (await this.orgMemberStore.get(`org_members:${orgId}`)) ?? []
        for (const membershipId of membershipIds) {
          const membership = await this.membershipStore.get(`membership:${membershipId}`)
          if (membership && membership.public_user_data.user_id === params.userId) {
            memberships.push(membership)
          }
        }
      }

      return {
        data: memberships.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)),
        total_count: memberships.length,
      }
    },

    /**
     * Verify a user's password
     */
    verifyPassword: async (params: { userId: string; password: string }): Promise<{ verified: boolean }> => {
      const user = await this.userManager.getUser(params.userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Get identifier for password verification
      const identifier = user.email ?? user.username ?? user.id
      const result = await this.userManager.verifyPassword(identifier, params.password)

      return { verified: result.valid }
    },

    /**
     * Verify a TOTP code
     */
    verifyTOTP: async (params: { userId: string; code: string }): Promise<{ verified: boolean; code_type: 'totp' }> => {
      const factors = await this.mfaManager.listVerifiedFactors(params.userId)
      const totpFactor = factors.find((f) => f.type === 'totp')

      if (!totpFactor) {
        return { verified: false, code_type: 'totp' }
      }

      const verified = await this.mfaManager.verifyTOTP(totpFactor.id, params.code)

      return { verified, code_type: 'totp' }
    },

    /**
     * Disable user's MFA
     */
    disableMFA: async (userId: string): Promise<ClerkUser> => {
      const factors = await this.mfaManager.listFactors(userId)
      for (const factor of factors) {
        await this.mfaManager.unenrollFactor(factor.id)
      }

      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return this.toClerkUser(user)
    },
  }

  // ============================================================================
  // SESSIONS API
  // ============================================================================

  /**
   * sessions namespace
   */
  sessions = {
    /**
     * Get a session by ID
     */
    getSession: async (sessionId: string): Promise<ClerkSession> => {
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }
      return this.toClerkSession(session)
    },

    /**
     * Get a list of sessions
     */
    getSessionList: async (params?: {
      client_id?: string
      user_id?: string
      status?: string
      limit?: number
      offset?: number
    }): Promise<ClerkPaginatedList<ClerkSession>> => {
      if (!params?.user_id) {
        return { data: [], total_count: 0 }
      }

      const sessions = await this.sessionManager.listUserSessions(params.user_id)
      const clerkSessions = sessions.map((s) => this.toClerkSession(s))

      // Filter by status if provided
      const filtered = params.status ? clerkSessions.filter((s) => s.status === params.status) : clerkSessions

      return {
        data: filtered.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)),
        total_count: filtered.length,
      }
    },

    /**
     * Revoke a session
     */
    revokeSession: async (sessionId: string): Promise<ClerkSession> => {
      await this.sessionManager.revokeSession(sessionId)

      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      return this.toClerkSession(session)
    },

    /**
     * Get session token
     */
    getToken: async (sessionId: string, template?: string): Promise<{ jwt: string }> => {
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      const user = await this.userManager.getUser(session.user_id)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Get template if provided
      let claims: Record<string, unknown> = {}
      let lifetime = 60

      if (template) {
        const jwtTemplate = await this.jwtTemplateStore.get(`jwt_template:${template}`)
        if (jwtTemplate) {
          claims = { ...jwtTemplate.claims }
          lifetime = jwtTemplate.lifetime
        }
      }

      const jwt = await createJWT(
        {
          ...claims,
          sid: session.id,
          email: user.email,
          name: user.name,
        },
        {
          secret: this.options.jwtKey ?? this.options.secretKey,
          issuer: 'https://clerk.com',
          subject: user.id,
          expiresIn: lifetime,
        }
      )

      return { jwt }
    },

    /**
     * Verify a session token
     */
    verifySession: async (
      sessionId: string,
      token: string
    ): Promise<{ session: ClerkSession; user: ClerkUser }> => {
      const result = await verifyJWT(token, {
        secret: this.options.jwtKey ?? this.options.secretKey,
        issuer: 'https://clerk.com',
      })

      if (!result.valid || result.claims?.sid !== sessionId) {
        throw new ClerkAPIError(401, [{ code: 'session_not_found', message: 'Invalid session token' }])
      }

      const session = await this.sessionManager.getSession(sessionId)
      if (!session || session.status !== 'active') {
        throw new ClerkAPIError(401, [{ code: 'session_not_found', message: 'Session not found or inactive' }])
      }

      const user = await this.userManager.getUser(session.user_id)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return {
        session: this.toClerkSession(session),
        user: this.toClerkUser(user),
      }
    },
  }

  // ============================================================================
  // ORGANIZATIONS API
  // ============================================================================

  /**
   * organizations namespace
   */
  organizations = {
    /**
     * Get an organization by ID
     */
    getOrganization: async (organizationId: string): Promise<ClerkOrganization> => {
      const org = await this.organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }
      return org
    },

    /**
     * Get organization list
     */
    getOrganizationList: async (params?: {
      limit?: number
      offset?: number
      include_members_count?: boolean
      query?: string
      user_id?: string[]
      order_by?: string
    }): Promise<ClerkPaginatedList<ClerkOrganization>> => {
      // Simplified - would need proper listing in production
      return { data: [], total_count: 0 }
    },

    /**
     * Create an organization
     */
    createOrganization: async (params: CreateOrganizationParams): Promise<ClerkOrganization> => {
      const orgId = this.generateId('org')
      const now = Date.now()

      const org: ClerkOrganization = {
        id: orgId,
        object: 'organization',
        name: params.name,
        slug: params.slug ?? this.slugify(params.name),
        image_url: '',
        has_image: false,
        members_count: 1,
        pending_invitations_count: 0,
        max_allowed_memberships: params.max_allowed_memberships ?? 5,
        admin_delete_enabled: true,
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        created_at: now,
        updated_at: now,
      }

      await this.organizationStore.put(`org:${orgId}`, org, now)

      // Create membership for creator as admin
      const membershipId = this.generateId('mem')
      const user = await this.userManager.getUser(params.created_by)

      const membership: ClerkOrganizationMembership = {
        id: membershipId,
        object: 'organization_membership',
        public_metadata: {},
        private_metadata: {},
        role: 'admin',
        created_at: now,
        updated_at: now,
        organization: org,
        public_user_data: {
          user_id: params.created_by,
          first_name: user?.first_name ?? null,
          last_name: user?.last_name ?? null,
          image_url: user?.picture ?? '',
          has_image: !!user?.picture,
          identifier: user?.email ?? user?.username ?? params.created_by,
        },
      }

      await this.membershipStore.put(`membership:${membershipId}`, membership, now)
      await this.addUserToOrg(params.created_by, orgId, membershipId)

      return org
    },

    /**
     * Update an organization
     */
    updateOrganization: async (
      organizationId: string,
      params: UpdateOrganizationParams
    ): Promise<ClerkOrganization> => {
      const org = await this.organizations.getOrganization(organizationId)
      const now = Date.now()

      const updated: ClerkOrganization = {
        ...org,
        name: params.name ?? org.name,
        slug: params.slug ?? org.slug,
        max_allowed_memberships: params.max_allowed_memberships ?? org.max_allowed_memberships,
        admin_delete_enabled: params.admin_delete_enabled ?? org.admin_delete_enabled,
        public_metadata: params.public_metadata ?? org.public_metadata,
        private_metadata: params.private_metadata ?? org.private_metadata,
        updated_at: now,
      }

      await this.organizationStore.put(`org:${organizationId}`, updated, now)

      return updated
    },

    /**
     * Delete an organization
     */
    deleteOrganization: async (organizationId: string): Promise<ClerkDeletedObject> => {
      await this.organizationStore.put(`org:${organizationId}`, null as unknown as ClerkOrganization, Date.now())

      return {
        id: organizationId,
        object: 'organization',
        deleted: true,
      }
    },

    /**
     * Get organization membership list
     */
    getOrganizationMembershipList: async (params: {
      organizationId: string
      limit?: number
      offset?: number
      role?: string[]
    }): Promise<ClerkPaginatedList<ClerkOrganizationMembership>> => {
      const membershipIds = (await this.orgMemberStore.get(`org_members:${params.organizationId}`)) ?? []
      const memberships: ClerkOrganizationMembership[] = []

      for (const membershipId of membershipIds) {
        const membership = await this.membershipStore.get(`membership:${membershipId}`)
        if (membership) {
          // Filter by role if provided
          if (!params.role || params.role.includes(membership.role)) {
            memberships.push(membership)
          }
        }
      }

      return {
        data: memberships.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)),
        total_count: memberships.length,
      }
    },

    /**
     * Create organization membership
     */
    createOrganizationMembership: async (params: {
      organizationId: string
      userId: string
      role: string
    }): Promise<ClerkOrganizationMembership> => {
      const org = await this.organizations.getOrganization(params.organizationId)
      const user = await this.userManager.getUser(params.userId)

      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const membershipId = this.generateId('mem')
      const now = Date.now()

      const membership: ClerkOrganizationMembership = {
        id: membershipId,
        object: 'organization_membership',
        public_metadata: {},
        private_metadata: {},
        role: params.role,
        created_at: now,
        updated_at: now,
        organization: org,
        public_user_data: {
          user_id: params.userId,
          first_name: user.first_name ?? null,
          last_name: user.last_name ?? null,
          image_url: user.picture ?? '',
          has_image: !!user.picture,
          identifier: user.email ?? user.username ?? params.userId,
        },
      }

      await this.membershipStore.put(`membership:${membershipId}`, membership, now)
      await this.addUserToOrg(params.userId, params.organizationId, membershipId)

      // Update member count
      org.members_count++
      org.updated_at = now
      await this.organizationStore.put(`org:${params.organizationId}`, org, now)

      return membership
    },

    /**
     * Update organization membership
     */
    updateOrganizationMembership: async (params: {
      organizationId: string
      userId: string
      role: string
    }): Promise<ClerkOrganizationMembership> => {
      const membershipIds = (await this.orgMemberStore.get(`org_members:${params.organizationId}`)) ?? []

      for (const membershipId of membershipIds) {
        const membership = await this.membershipStore.get(`membership:${membershipId}`)
        if (membership && membership.public_user_data.user_id === params.userId) {
          membership.role = params.role
          membership.updated_at = Date.now()
          await this.membershipStore.put(`membership:${membershipId}`, membership, Date.now())
          return membership
        }
      }

      throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
    },

    /**
     * Delete organization membership
     */
    deleteOrganizationMembership: async (params: {
      organizationId: string
      userId: string
    }): Promise<ClerkDeletedObject> => {
      const membershipIds = (await this.orgMemberStore.get(`org_members:${params.organizationId}`)) ?? []

      for (const membershipId of membershipIds) {
        const membership = await this.membershipStore.get(`membership:${membershipId}`)
        if (membership && membership.public_user_data.user_id === params.userId) {
          await this.membershipStore.put(`membership:${membershipId}`, null as unknown as ClerkOrganizationMembership, Date.now())
          await this.removeUserFromOrg(params.userId, params.organizationId, membershipId)

          return {
            id: membershipId,
            object: 'organization_membership',
            deleted: true,
          }
        }
      }

      throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
    },

    /**
     * Create organization invitation
     */
    createOrganizationInvitation: async (
      organizationId: string,
      params: CreateInvitationParams
    ): Promise<ClerkOrganizationInvitation> => {
      const invitationId = this.generateId('inv')
      const now = Date.now()

      const invitation: ClerkOrganizationInvitation = {
        id: invitationId,
        object: 'organization_invitation',
        email_address: params.email_address,
        role: params.role,
        organization_id: organizationId,
        status: 'pending',
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        created_at: now,
        updated_at: now,
      }

      await this.invitationStore.put(`invitation:${invitationId}`, invitation, now)

      // Update pending invitations count
      const org = await this.organizations.getOrganization(organizationId)
      org.pending_invitations_count++
      org.updated_at = now
      await this.organizationStore.put(`org:${organizationId}`, org, now)

      return invitation
    },

    /**
     * Get organization invitation list
     */
    getOrganizationInvitationList: async (params: {
      organizationId: string
      limit?: number
      offset?: number
      status?: string
    }): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>> => {
      // Simplified - would need proper listing in production
      return { data: [], total_count: 0 }
    },

    /**
     * Revoke organization invitation
     */
    revokeOrganizationInvitation: async (params: {
      organizationId: string
      invitationId: string
    }): Promise<ClerkOrganizationInvitation> => {
      const invitation = await this.invitationStore.get(`invitation:${params.invitationId}`)
      if (!invitation || invitation.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Invitation not found' }])
      }

      invitation.status = 'revoked'
      invitation.updated_at = Date.now()
      await this.invitationStore.put(`invitation:${params.invitationId}`, invitation, Date.now())

      // Update pending invitations count
      const org = await this.organizations.getOrganization(params.organizationId)
      org.pending_invitations_count = Math.max(0, org.pending_invitations_count - 1)
      await this.organizationStore.put(`org:${params.organizationId}`, org, Date.now())

      return invitation
    },
  }

  // ============================================================================
  // JWT TEMPLATES API
  // ============================================================================

  /**
   * jwtTemplates namespace
   */
  jwtTemplates = {
    /**
     * Get a JWT template
     */
    getJWTTemplate: async (templateId: string): Promise<ClerkJWTTemplate> => {
      const template = await this.jwtTemplateStore.get(`jwt_template:${templateId}`)
      if (!template) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'JWT template not found' }])
      }
      return template
    },

    /**
     * Get JWT template list
     */
    getJWTTemplateList: async (): Promise<ClerkPaginatedList<ClerkJWTTemplate>> => {
      // Simplified - would need proper listing in production
      return { data: [], total_count: 0 }
    },

    /**
     * Create a JWT template
     */
    createJWTTemplate: async (params: CreateJWTTemplateParams): Promise<ClerkJWTTemplate> => {
      const templateId = this.generateId('jwt')
      const now = Date.now()

      const template: ClerkJWTTemplate = {
        id: templateId,
        object: 'jwt_template',
        name: params.name,
        claims: params.claims,
        lifetime: params.lifetime ?? 60,
        allowed_clock_skew: params.allowed_clock_skew ?? 5,
        custom_signing_key: params.custom_signing_key ?? false,
        signing_algorithm: params.signing_algorithm ?? 'RS256',
        created_at: now,
        updated_at: now,
      }

      await this.jwtTemplateStore.put(`jwt_template:${templateId}`, template, now)

      // Also index by name
      await this.jwtTemplateStore.put(`jwt_template_name:${params.name}`, template, now)

      return template
    },

    /**
     * Update a JWT template
     */
    updateJWTTemplate: async (
      templateId: string,
      params: Partial<CreateJWTTemplateParams>
    ): Promise<ClerkJWTTemplate> => {
      const existing = await this.jwtTemplates.getJWTTemplate(templateId)
      const now = Date.now()

      const template: ClerkJWTTemplate = {
        ...existing,
        name: params.name ?? existing.name,
        claims: params.claims ?? existing.claims,
        lifetime: params.lifetime ?? existing.lifetime,
        allowed_clock_skew: params.allowed_clock_skew ?? existing.allowed_clock_skew,
        custom_signing_key: params.custom_signing_key ?? existing.custom_signing_key,
        signing_algorithm: params.signing_algorithm ?? existing.signing_algorithm,
        updated_at: now,
      }

      await this.jwtTemplateStore.put(`jwt_template:${templateId}`, template, now)

      return template
    },

    /**
     * Delete a JWT template
     */
    deleteJWTTemplate: async (templateId: string): Promise<ClerkDeletedObject> => {
      const template = await this.jwtTemplateStore.get(`jwt_template:${templateId}`)
      if (template) {
        await this.jwtTemplateStore.put(`jwt_template_name:${template.name}`, null as unknown as ClerkJWTTemplate, Date.now())
      }
      await this.jwtTemplateStore.put(`jwt_template:${templateId}`, null as unknown as ClerkJWTTemplate, Date.now())

      return {
        id: templateId,
        object: 'jwt_template',
        deleted: true,
      }
    },
  }

  // ============================================================================
  // TOKEN VERIFICATION
  // ============================================================================

  /**
   * Verify a session token
   */
  async verifyToken(
    token: string,
    options?: { authorizedParties?: string[] }
  ): Promise<{ userId: string; sessionId: string; claims: Record<string, unknown> }> {
    const result = await verifyJWT(token, {
      secret: this.options.jwtKey ?? this.options.secretKey,
      issuer: 'https://clerk.com',
    })

    if (!result.valid || !result.claims) {
      throw new ClerkAPIError(401, [{ code: 'session_token_invalid', message: 'Invalid session token' }])
    }

    // Verify authorized parties if provided
    if (options?.authorizedParties && result.claims.azp) {
      if (!options.authorizedParties.includes(result.claims.azp as string)) {
        throw new ClerkAPIError(401, [{ code: 'session_token_invalid', message: 'Unauthorized party' }])
      }
    }

    return {
      userId: result.claims.sub as string,
      sessionId: result.claims.sid as string,
      claims: result.claims,
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Convert internal user to Clerk user format
   */
  private toClerkUser(user: {
    id: string
    email?: string
    email_verified?: boolean
    phone?: string
    phone_verified?: boolean
    username?: string
    first_name?: string
    last_name?: string
    name?: string
    picture?: string
    created_at: string
    updated_at: string
    last_sign_in_at?: string
    metadata: Record<string, unknown>
    app_metadata: Record<string, unknown>
  }): ClerkUser {
    const now = Date.now()

    const emailAddresses: ClerkEmailAddress[] = user.email
      ? [
          {
            id: `email_${user.id}`,
            object: 'email_address',
            email_address: user.email,
            reserved: false,
            verification: user.email_verified
              ? { status: 'verified', strategy: 'email_code', attempts: null, expire_at: null }
              : null,
            linked_to: [],
            created_at: new Date(user.created_at).getTime(),
            updated_at: new Date(user.updated_at).getTime(),
          },
        ]
      : []

    const phoneNumbers: ClerkPhoneNumber[] = user.phone
      ? [
          {
            id: `phone_${user.id}`,
            object: 'phone_number',
            phone_number: user.phone,
            reserved_for_second_factor: false,
            default_second_factor: false,
            reserved: false,
            verification: user.phone_verified
              ? { status: 'verified', strategy: 'phone_code', attempts: null, expire_at: null }
              : null,
            linked_to: [],
            created_at: new Date(user.created_at).getTime(),
            updated_at: new Date(user.updated_at).getTime(),
          },
        ]
      : []

    return {
      id: user.id,
      object: 'user',
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      image_url: user.picture ?? '',
      has_image: !!user.picture,
      primary_email_address_id: emailAddresses[0]?.id ?? null,
      primary_phone_number_id: phoneNumbers[0]?.id ?? null,
      primary_web3_wallet_id: null,
      password_enabled: true, // Assume password is set
      two_factor_enabled: false,
      totp_enabled: false,
      backup_code_enabled: false,
      email_addresses: emailAddresses,
      phone_numbers: phoneNumbers,
      web3_wallets: [],
      external_accounts: [],
      saml_accounts: [],
      public_metadata: user.metadata,
      private_metadata: (user.app_metadata.private_metadata as Record<string, unknown>) ?? {},
      unsafe_metadata: (user.app_metadata.unsafe_metadata as Record<string, unknown>) ?? {},
      external_id: (user.app_metadata.external_id as string) ?? null,
      last_sign_in_at: user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : null,
      banned: (user.app_metadata.banned as boolean) ?? false,
      locked: (user.app_metadata.locked as boolean) ?? false,
      lockout_expires_in_seconds: null,
      verification_attempts_remaining: null,
      created_at: new Date(user.created_at).getTime(),
      updated_at: new Date(user.updated_at).getTime(),
      delete_self_enabled: true,
      create_organization_enabled: true,
      last_active_at: user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : null,
    }
  }

  /**
   * Convert internal session to Clerk session format
   */
  private toClerkSession(session: {
    id: string
    user_id: string
    client_id?: string
    status: string
    created_at: string
    updated_at: string
    expires_at: string
    last_active_at: string
  }): ClerkSession {
    return {
      id: session.id,
      object: 'session',
      client_id: session.client_id ?? '',
      user_id: session.user_id,
      status: session.status as ClerkSession['status'],
      last_active_at: new Date(session.last_active_at).getTime(),
      last_active_organization_id: null,
      actor: null,
      expire_at: new Date(session.expires_at).getTime(),
      abandon_at: new Date(session.expires_at).getTime() + 86400000, // +1 day
      created_at: new Date(session.created_at).getTime(),
      updated_at: new Date(session.updated_at).getTime(),
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Generate a slug from a name
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /**
   * Add user to organization
   */
  private async addUserToOrg(userId: string, orgId: string, membershipId: string): Promise<void> {
    // Add org to user's list
    const userOrgs = (await this.userOrgStore.get(`user_orgs:${userId}`)) ?? []
    if (!userOrgs.includes(orgId)) {
      userOrgs.push(orgId)
      await this.userOrgStore.put(`user_orgs:${userId}`, userOrgs, Date.now())
    }

    // Add membership to org's list
    const orgMembers = (await this.orgMemberStore.get(`org_members:${orgId}`)) ?? []
    if (!orgMembers.includes(membershipId)) {
      orgMembers.push(membershipId)
      await this.orgMemberStore.put(`org_members:${orgId}`, orgMembers, Date.now())
    }
  }

  /**
   * Remove user from organization
   */
  private async removeUserFromOrg(userId: string, orgId: string, membershipId: string): Promise<void> {
    // Remove org from user's list
    const userOrgs = (await this.userOrgStore.get(`user_orgs:${userId}`)) ?? []
    const orgIndex = userOrgs.indexOf(orgId)
    if (orgIndex !== -1) {
      userOrgs.splice(orgIndex, 1)
      await this.userOrgStore.put(`user_orgs:${userId}`, userOrgs, Date.now())
    }

    // Remove membership from org's list
    const orgMembers = (await this.orgMemberStore.get(`org_members:${orgId}`)) ?? []
    const memberIndex = orgMembers.indexOf(membershipId)
    if (memberIndex !== -1) {
      orgMembers.splice(memberIndex, 1)
      await this.orgMemberStore.put(`org_members:${orgId}`, orgMembers, Date.now())
    }
  }
}

/**
 * Create a Clerk client
 */
export function createClerkClient(options: ClerkClientOptions): Clerk {
  return new Clerk(options)
}
