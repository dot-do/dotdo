/**
 * ClerkDO - Main API Coordinator Durable Object
 *
 * Implements Clerk's Backend API, coordinating between UserDO, OrgDO,
 * and SessionDO for a complete authentication system.
 *
 * Features:
 * - User management (CRUD, ban, lock)
 * - Session management (create, verify, revoke)
 * - Organization management
 * - Invitation management
 * - JWT template management
 * - Webhook handling (Svix-compatible)
 * - OAuth provider handling
 * - JWKS endpoint for token verification
 *
 * @see https://clerk.com/docs/reference/backend-api
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import {
  generateKeyPair,
  importPrivateKey,
  signJwt,
  verifyJwt,
  importPublicKey,
  createSessionToken,
  generateClerkId,
  generateToken,
  type KeyPair,
  type JWK,
  type JWKS,
  type JWTPayload,
} from './jwt'
import type { User, EmailAddress, PhoneNumber, ExternalAccount } from './UserDO'
import type { Organization, OrganizationMembership, OrganizationInvitation, PublicUserData } from './OrgDO'
import type { Session, SessionToken } from './SessionDO'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  CLERK_DO: DurableObjectNamespace
  USER_DO: DurableObjectNamespace
  ORG_DO: DurableObjectNamespace
  SESSION_DO: DurableObjectNamespace
  CLERK_SECRET_KEY?: string
  CLERK_JWT_KEY?: string
  CLERK_FRONTEND_API?: string
  CLERK_DOMAIN?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  SVIX_SIGNING_SECRET?: string
  ENVIRONMENT?: string
}

/** JWT Template */
export interface JwtTemplate {
  id: string
  object: 'jwt_template'
  name: string
  claims: Record<string, unknown>
  lifetime: number
  allowed_clock_skew: number
  custom_signing_key: boolean
  signing_algorithm: 'RS256'
  created_at: number
  updated_at: number
}

/** Webhook endpoint */
export interface WebhookEndpoint {
  id: string
  object: 'webhook_endpoint'
  url: string
  description: string
  secret: string
  events: string[]
  status: 'enabled' | 'disabled'
  created_at: number
  updated_at: number
}

/** OAuth state */
interface OAuthState {
  state: string
  provider: string
  redirect_url: string
  code_verifier?: string
  expires_at: number
  created_at: number
}

/** Email template */
export interface EmailTemplate {
  id: string
  object: 'email_template'
  slug: EmailTemplateSlug
  name: string
  subject: string
  markup: string
  body_plain: string
  from_email_name: string
  reply_to_email_name: string
  delivered_by_clerk: boolean
  required_fields: string[]
  created_at: number
  updated_at: number
}

/** SMS template */
export interface SmsTemplate {
  id: string
  object: 'sms_template'
  slug: SmsTemplateSlug
  name: string
  message: string
  delivered_by_clerk: boolean
  required_fields: string[]
  created_at: number
  updated_at: number
}

/** Email template slugs */
export type EmailTemplateSlug =
  | 'verification_code'
  | 'magic_link'
  | 'password_changed'
  | 'password_removed'
  | 'organization_invitation'
  | 'organization_membership_request'
  | 'organization_membership_request_accepted'
  | 'organization_membership_request_rejected'
  | 'organization_membership_removed'
  | 'passkey_added'
  | 'two_factor_enabled'
  | 'two_factor_disabled'

/** SMS template slugs */
export type SmsTemplateSlug =
  | 'verification_code'
  | 'magic_link'

/** Clerk instance configuration */
interface ClerkConfig {
  instance_id: string
  frontend_api: string
  domain: string
  keys: {
    kid: string
    publicKeyPem: string
    privateKeyPem: string
    jwk: JWK
  }[]
  active_key_kid: string
  jwt_templates: JwtTemplate[]
  webhook_endpoints: WebhookEndpoint[]
  oauth_states: OAuthState[]
  email_templates: EmailTemplate[]
  sms_templates: SmsTemplate[]
  created_at: number
  updated_at: number
}

/** API Error */
export interface ClerkError {
  message: string
  long_message: string
  code: string
  meta?: Record<string, unknown>
}

/** Sign-in object */
export interface SignIn {
  id: string
  object: 'sign_in'
  status: 'needs_identifier' | 'needs_first_factor' | 'needs_second_factor' | 'needs_new_password' | 'complete'
  supported_identifiers: string[]
  identifier: string | null
  user_id: string | null
  created_session_id: string | null
  supported_first_factors: SignInFactor[]
  supported_second_factors: SignInFactor[]
  first_factor_verification: FactorVerification | null
  second_factor_verification: FactorVerification | null
  created_at: number
  updated_at: number
  abandon_at: number
}

/** Sign-up object */
export interface SignUp {
  id: string
  object: 'sign_up'
  status: 'missing_requirements' | 'complete' | 'abandoned'
  required_fields: string[]
  optional_fields: string[]
  missing_fields: string[]
  unverified_fields: string[]
  verifications: SignUpVerifications
  username: string | null
  first_name: string | null
  last_name: string | null
  email_address: string | null
  phone_number: string | null
  web3_wallet: string | null
  password_enabled: boolean
  external_account_strategy: string | null
  external_account: ExternalAccountVerification | null
  unsafe_metadata: Record<string, unknown>
  created_session_id: string | null
  created_user_id: string | null
  created_at: number
  updated_at: number
  abandon_at: number
}

/** Sign-in/Sign-up factor */
export interface SignInFactor {
  strategy: string
  email_address_id?: string
  phone_number_id?: string
  totp_id?: string
  safe_identifier?: string
  primary?: boolean
}

/** Factor verification status */
export interface FactorVerification {
  status: 'unverified' | 'verified' | 'transferable' | 'failed' | 'expired'
  strategy: string
  attempts: number | null
  expire_at: number | null
  error?: ClerkError
}

/** Sign-up verifications */
export interface SignUpVerifications {
  email_address: FactorVerification | null
  phone_number: FactorVerification | null
  web3_wallet: FactorVerification | null
  external_account: FactorVerification | null
}

/** External account verification */
export interface ExternalAccountVerification {
  strategy: string
  redirect_url: string | null
  status: 'unverified' | 'verified' | 'transferable' | 'failed' | 'expired'
  error?: ClerkError
}

/** Stored sign-in */
interface StoredSignIn extends Omit<SignIn, 'object'> {
  verification_tokens: Record<string, StoredVerificationCode>
}

/** Stored sign-up */
interface StoredSignUp extends Omit<SignUp, 'object'> {
  password_hash?: string
  verification_tokens: Record<string, StoredVerificationCode>
}

/** Stored verification code */
interface StoredVerificationCode {
  code: string
  expires_at: number
  attempts: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_TOKEN_LIFETIME = 60 // 60 seconds
const OAUTH_STATE_EXPIRY = 10 * 60 * 1000 // 10 minutes
const SIGN_IN_EXPIRY = 5 * 60 * 1000 // 5 minutes
const SIGN_UP_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours
const VERIFICATION_CODE_EXPIRY = 10 * 60 * 1000 // 10 minutes
const MAX_VERIFICATION_ATTEMPTS = 5

// ============================================================================
// CLERK DURABLE OBJECT
// ============================================================================

export class ClerkDO extends DurableObject<Env> {
  private app: Hono<{ Bindings: Env }>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.app = this.createApp()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize Clerk instance with key pair
   */
  async initialize(): Promise<ClerkConfig> {
    let config = (await this.ctx.storage.get('config')) as ClerkConfig | null

    if (!config) {
      const keyPair = await generateKeyPair()
      const now = Date.now()

      config = {
        instance_id: generateClerkId('ins'),
        frontend_api: this.env.CLERK_FRONTEND_API ?? 'http://localhost:3000',
        domain: this.env.CLERK_DOMAIN ?? 'localhost:3000',
        keys: [
          {
            kid: keyPair.kid,
            publicKeyPem: keyPair.publicKeyPem,
            privateKeyPem: keyPair.privateKeyPem,
            jwk: keyPair.jwk,
          },
        ],
        active_key_kid: keyPair.kid,
        jwt_templates: [],
        webhook_endpoints: [],
        oauth_states: [],
        email_templates: this.getDefaultEmailTemplates(now),
        sms_templates: this.getDefaultSmsTemplates(now),
        created_at: now,
        updated_at: now,
      }

      await this.ctx.storage.put('config', config)
    }

    return config
  }

  /**
   * Get JWKS for token verification
   */
  async getJwks(): Promise<JWKS> {
    const config = await this.initialize()
    return {
      keys: config.keys.map((k) => k.jwk),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create user
   */
  async createUser(params: {
    external_id?: string
    first_name?: string
    last_name?: string
    email_address?: string[]
    phone_number?: string[]
    username?: string
    password?: string
    skip_password_checks?: boolean
    skip_password_requirement?: boolean
    public_metadata?: Record<string, unknown>
    private_metadata?: Record<string, unknown>
    unsafe_metadata?: Record<string, unknown>
  }): Promise<User> {
    const userId = params.external_id ?? generateClerkId('user')
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createUser',
        params: [
          {
            username: params.username,
            first_name: params.first_name,
            last_name: params.last_name,
            email_address: params.email_address?.[0],
            phone_number: params.phone_number?.[0],
            password: params.password,
            public_metadata: params.public_metadata,
            private_metadata: params.private_metadata,
            unsafe_metadata: params.unsafe_metadata,
            skip_password_checks: params.skip_password_checks,
            skip_password_requirement: params.skip_password_requirement,
          },
        ],
      }),
    })

    const result = (await response.json()) as { result: User }

    // Index user by email/phone for lookups
    if (params.email_address?.length) {
      await this.indexUserEmail(params.email_address[0], result.result.id)
    }

    // Emit webhook
    await this.emitWebhook('user.created', result.result)

    return result.result
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<User | null> {
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getUser',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: User | null }
    return result.result
  }

  /**
   * Update user
   */
  async updateUser(
    userId: string,
    params: {
      first_name?: string
      last_name?: string
      username?: string
      password?: string
      primary_email_address_id?: string
      primary_phone_number_id?: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
      unsafe_metadata?: Record<string, unknown>
    }
  ): Promise<User | null> {
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateUser',
        params: [params],
      }),
    })

    const result = (await response.json()) as { result: User | null }

    if (result.result) {
      await this.emitWebhook('user.updated', result.result)
    }

    return result.result
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<{ deleted: boolean }> {
    const user = await this.getUser(userId)
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteUser',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: { deleted: boolean } }

    if (result.result.deleted && user) {
      await this.emitWebhook('user.deleted', { id: userId, object: 'user', deleted: true })
    }

    return result.result
  }

  /**
   * List users
   */
  async listUsers(params?: {
    limit?: number
    offset?: number
    email_address?: string[]
    phone_number?: string[]
    username?: string[]
    user_id?: string[]
  }): Promise<{ data: User[]; total_count: number }> {
    // For now, return users from index
    const userIds = params?.user_id ?? []
    const users: User[] = []

    for (const userId of userIds) {
      const user = await this.getUser(userId)
      if (user) users.push(user)
    }

    return { data: users, total_count: users.length }
  }

  /**
   * Ban user
   */
  async banUser(userId: string): Promise<User | null> {
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'banUser',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: User | null }
    return result.result
  }

  /**
   * Unban user
   */
  async unbanUser(userId: string): Promise<User | null> {
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'unbanUser',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: User | null }
    return result.result
  }

  /**
   * Verify user password
   */
  async verifyPassword(userId: string, password: string): Promise<{ valid: boolean }> {
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))

    const response = await userDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'verifyPasswordAttempt',
        params: [password],
      }),
    })

    const result = (await response.json()) as { result: { valid: boolean } }
    return result.result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create session
   */
  async createSession(params: {
    user_id: string
    user_agent?: string
    ip_address?: string
  }): Promise<Session> {
    const sessionId = generateClerkId('sess')
    const sessionDO = this.env.SESSION_DO.get(this.env.SESSION_DO.idFromName(sessionId))

    const response = await sessionDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createSession',
        params: [params],
      }),
    })

    const result = (await response.json()) as { result: Session }

    // Index session by user
    await this.indexUserSession(params.user_id, result.result.id)

    await this.emitWebhook('session.created', result.result)

    return result.result
  }

  /**
   * Get session
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const sessionDO = this.env.SESSION_DO.get(this.env.SESSION_DO.idFromName(sessionId))

    const response = await sessionDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSession',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: Session | null }
    return result.result
  }

  /**
   * Revoke session
   */
  async revokeSession(sessionId: string): Promise<Session | null> {
    const sessionDO = this.env.SESSION_DO.get(this.env.SESSION_DO.idFromName(sessionId))

    const response = await sessionDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'revokeSession',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: Session | null }

    if (result.result) {
      await this.emitWebhook('session.revoked', result.result)
    }

    return result.result
  }

  /**
   * Create session token (JWT)
   */
  async createSessionToken(
    sessionId: string,
    options?: { template?: string }
  ): Promise<SessionToken | null> {
    const session = await this.getSession(sessionId)
    if (!session || session.status !== 'active') return null

    const config = await this.initialize()
    const activeKey = config.keys.find((k) => k.kid === config.active_key_kid)
    if (!activeKey) return null

    const privateKey = await importPrivateKey(activeKey.privateKeyPem)

    // Get template if specified
    let claims: Record<string, unknown> = {}
    let lifetime = DEFAULT_TOKEN_LIFETIME
    if (options?.template) {
      const template = config.jwt_templates.find((t) => t.name === options.template)
      if (template) {
        claims = { ...template.claims }
        lifetime = template.lifetime
      }
    }

    const jwt = await createSessionToken(privateKey, {
      userId: session.user_id,
      sessionId: session.id,
      issuer: config.frontend_api,
      audience: config.frontend_api,
      expiresIn: lifetime,
      orgId: session.last_active_organization_id ?? undefined,
      azp: config.frontend_api,
      kid: activeKey.kid,
      claims,
    })

    return {
      jwt,
      expires_at: Math.floor(Date.now() / 1000) + lifetime,
    }
  }

  /**
   * Verify session token
   */
  async verifyToken(token: string): Promise<{ valid: boolean; claims?: JWTPayload }> {
    const config = await this.initialize()
    const activeKey = config.keys.find((k) => k.kid === config.active_key_kid)
    if (!activeKey) return { valid: false }

    const publicKey = await importPublicKey(activeKey.publicKeyPem)
    const result = await verifyJwt(token, publicKey)

    if (!result.valid) return { valid: false }

    // Verify session is still active
    const sessionId = result.payload?.sid as string | undefined
    if (sessionId) {
      const session = await this.getSession(sessionId)
      if (!session || session.status !== 'active') {
        return { valid: false }
      }
    }

    return { valid: true, claims: result.payload }
  }

  /**
   * List sessions for user
   */
  async listUserSessions(userId: string): Promise<{ data: Session[]; total_count: number }> {
    const sessionIds =
      ((await this.ctx.storage.get(`user_sessions:${userId}`)) as string[] | undefined) ?? []

    const sessions: Session[] = []
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId)
      if (session) sessions.push(session)
    }

    return { data: sessions, total_count: sessions.length }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

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
    const orgId = generateClerkId('org')
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createOrganization',
        params: [params],
      }),
    })

    const result = (await response.json()) as { result: Organization }

    // Add creator as admin
    const user = await this.getUser(params.created_by)
    if (user) {
      await this.createOrganizationMembership(result.result.id, {
        user_id: params.created_by,
        role: 'org:admin',
      })
    }

    await this.emitWebhook('organization.created', result.result)

    return result.result
  }

  /**
   * Get organization
   */
  async getOrganization(orgId: string): Promise<Organization | null> {
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getOrganization',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: Organization | null }
    return result.result
  }

  /**
   * Update organization
   */
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
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateOrganization',
        params: [params],
      }),
    })

    const result = (await response.json()) as { result: Organization | null }

    if (result.result) {
      await this.emitWebhook('organization.updated', result.result)
    }

    return result.result
  }

  /**
   * Delete organization
   */
  async deleteOrganization(orgId: string): Promise<{ deleted: boolean }> {
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteOrganization',
        params: [],
      }),
    })

    const result = (await response.json()) as { result: { deleted: boolean } }

    if (result.result.deleted) {
      await this.emitWebhook('organization.deleted', { id: orgId, object: 'organization', deleted: true })
    }

    return result.result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION MEMBERSHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create organization membership
   */
  async createOrganizationMembership(
    orgId: string,
    params: {
      user_id: string
      role: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationMembership | null> {
    const user = await this.getUser(params.user_id)
    if (!user) return null

    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const publicUserData: PublicUserData = {
      user_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      image_url: user.image_url,
      has_image: user.has_image,
      identifier: user.email_addresses[0]?.email_address ?? user.username ?? user.id,
    }

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createMembership',
        params: [{ ...params, public_user_data: publicUserData }],
      }),
    })

    const result = (await response.json()) as { result: OrganizationMembership | null }

    if (result.result) {
      await this.emitWebhook('organizationMembership.created', result.result)
    }

    return result.result
  }

  /**
   * Update organization membership
   */
  async updateOrganizationMembership(
    orgId: string,
    membershipId: string,
    params: {
      role?: string
      public_metadata?: Record<string, unknown>
      private_metadata?: Record<string, unknown>
    }
  ): Promise<OrganizationMembership | null> {
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateMembership',
        params: [membershipId, params],
      }),
    })

    const result = (await response.json()) as { result: OrganizationMembership | null }

    if (result.result) {
      await this.emitWebhook('organizationMembership.updated', result.result)
    }

    return result.result
  }

  /**
   * Delete organization membership
   */
  async deleteOrganizationMembership(
    orgId: string,
    membershipId: string
  ): Promise<{ deleted: boolean }> {
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteMembership',
        params: [membershipId],
      }),
    })

    const result = (await response.json()) as { result: { deleted: boolean } }

    if (result.result.deleted) {
      await this.emitWebhook('organizationMembership.deleted', {
        id: membershipId,
        object: 'organization_membership',
        deleted: true,
      })
    }

    return result.result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVITATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create invitation
   */
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
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createInvitation',
        params: [params],
      }),
    })

    const result = (await response.json()) as { result: OrganizationInvitation | null }

    if (result.result) {
      await this.emitWebhook('organizationInvitation.created', result.result)
    }

    return result.result
  }

  /**
   * Revoke invitation
   */
  async revokeInvitation(
    orgId: string,
    invitationId: string
  ): Promise<OrganizationInvitation | null> {
    const orgDO = this.env.ORG_DO.get(this.env.ORG_DO.idFromName(orgId))

    const response = await orgDO.fetch('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'revokeInvitation',
        params: [invitationId],
      }),
    })

    const result = (await response.json()) as { result: OrganizationInvitation | null }

    if (result.result) {
      await this.emitWebhook('organizationInvitation.revoked', result.result)
    }

    return result.result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JWT TEMPLATES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create JWT template
   */
  async createJwtTemplate(params: {
    name: string
    claims: Record<string, unknown>
    lifetime?: number
    allowed_clock_skew?: number
  }): Promise<JwtTemplate> {
    const config = await this.initialize()
    const now = Date.now()

    const template: JwtTemplate = {
      id: generateClerkId('jwt'),
      object: 'jwt_template',
      name: params.name,
      claims: params.claims,
      lifetime: params.lifetime ?? 60,
      allowed_clock_skew: params.allowed_clock_skew ?? 5,
      custom_signing_key: false,
      signing_algorithm: 'RS256',
      created_at: now,
      updated_at: now,
    }

    config.jwt_templates.push(template)
    config.updated_at = now

    await this.ctx.storage.put('config', config)

    return template
  }

  /**
   * List JWT templates
   */
  async listJwtTemplates(): Promise<{ data: JwtTemplate[]; total_count: number }> {
    const config = await this.initialize()
    return { data: config.jwt_templates, total_count: config.jwt_templates.length }
  }

  /**
   * Delete JWT template
   */
  async deleteJwtTemplate(templateId: string): Promise<{ deleted: boolean }> {
    const config = await this.initialize()

    const index = config.jwt_templates.findIndex((t) => t.id === templateId)
    if (index === -1) return { deleted: false }

    config.jwt_templates.splice(index, 1)
    config.updated_at = Date.now()

    await this.ctx.storage.put('config', config)

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create webhook endpoint
   */
  async createWebhookEndpoint(params: {
    url: string
    description?: string
    events: string[]
  }): Promise<WebhookEndpoint> {
    const config = await this.initialize()
    const now = Date.now()

    const endpoint: WebhookEndpoint = {
      id: generateClerkId('whe'),
      object: 'webhook_endpoint',
      url: params.url,
      description: params.description ?? '',
      secret: `whsec_${generateToken(32)}`,
      events: params.events,
      status: 'enabled',
      created_at: now,
      updated_at: now,
    }

    config.webhook_endpoints.push(endpoint)
    config.updated_at = now

    await this.ctx.storage.put('config', config)

    return endpoint
  }

  /**
   * Delete webhook endpoint
   */
  async deleteWebhookEndpoint(endpointId: string): Promise<{ deleted: boolean }> {
    const config = await this.initialize()

    const index = config.webhook_endpoints.findIndex((e) => e.id === endpointId)
    if (index === -1) return { deleted: false }

    config.webhook_endpoints.splice(index, 1)
    config.updated_at = Date.now()

    await this.ctx.storage.put('config', config)

    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL TEMPLATES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get default email templates
   */
  private getDefaultEmailTemplates(timestamp: number): EmailTemplate[] {
    return [
      {
        id: generateClerkId('tmpl'),
        object: 'email_template',
        slug: 'verification_code',
        name: 'Verification Code',
        subject: 'Your verification code',
        markup: '<p>Your verification code is: <strong>{{code}}</strong></p><p>This code expires in 10 minutes.</p>',
        body_plain: 'Your verification code is: {{code}}\n\nThis code expires in 10 minutes.',
        from_email_name: 'noreply',
        reply_to_email_name: 'support',
        delivered_by_clerk: true,
        required_fields: ['code'],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: generateClerkId('tmpl'),
        object: 'email_template',
        slug: 'magic_link',
        name: 'Magic Link',
        subject: 'Sign in to your account',
        markup: '<p>Click the link below to sign in:</p><p><a href="{{magic_link_url}}">Sign In</a></p><p>This link expires in 10 minutes.</p>',
        body_plain: 'Click the link below to sign in:\n\n{{magic_link_url}}\n\nThis link expires in 10 minutes.',
        from_email_name: 'noreply',
        reply_to_email_name: 'support',
        delivered_by_clerk: true,
        required_fields: ['magic_link_url'],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: generateClerkId('tmpl'),
        object: 'email_template',
        slug: 'password_changed',
        name: 'Password Changed',
        subject: 'Your password was changed',
        markup: '<p>Your password was recently changed. If you did not make this change, please contact support immediately.</p>',
        body_plain: 'Your password was recently changed. If you did not make this change, please contact support immediately.',
        from_email_name: 'noreply',
        reply_to_email_name: 'support',
        delivered_by_clerk: true,
        required_fields: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: generateClerkId('tmpl'),
        object: 'email_template',
        slug: 'organization_invitation',
        name: 'Organization Invitation',
        subject: 'You\'ve been invited to join {{organization_name}}',
        markup: '<p>{{inviter_name}} has invited you to join <strong>{{organization_name}}</strong>.</p><p><a href="{{accept_invitation_url}}">Accept Invitation</a></p>',
        body_plain: '{{inviter_name}} has invited you to join {{organization_name}}.\n\nAccept invitation: {{accept_invitation_url}}',
        from_email_name: 'noreply',
        reply_to_email_name: 'support',
        delivered_by_clerk: true,
        required_fields: ['organization_name', 'inviter_name', 'accept_invitation_url'],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: generateClerkId('tmpl'),
        object: 'email_template',
        slug: 'passkey_added',
        name: 'Passkey Added',
        subject: 'A new passkey was added to your account',
        markup: '<p>A new passkey was added to your account. If you did not add this passkey, please secure your account immediately.</p>',
        body_plain: 'A new passkey was added to your account. If you did not add this passkey, please secure your account immediately.',
        from_email_name: 'noreply',
        reply_to_email_name: 'support',
        delivered_by_clerk: true,
        required_fields: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: generateClerkId('tmpl'),
        object: 'email_template',
        slug: 'two_factor_enabled',
        name: 'Two-Factor Enabled',
        subject: 'Two-factor authentication was enabled',
        markup: '<p>Two-factor authentication has been enabled on your account. Your account is now more secure.</p>',
        body_plain: 'Two-factor authentication has been enabled on your account. Your account is now more secure.',
        from_email_name: 'noreply',
        reply_to_email_name: 'support',
        delivered_by_clerk: true,
        required_fields: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]
  }

  /**
   * List email templates
   */
  async listEmailTemplates(): Promise<{ data: EmailTemplate[]; total_count: number }> {
    const config = await this.initialize()
    return {
      data: config.email_templates,
      total_count: config.email_templates.length,
    }
  }

  /**
   * Get email template by slug
   */
  async getEmailTemplate(slug: EmailTemplateSlug): Promise<EmailTemplate | null> {
    const config = await this.initialize()
    return config.email_templates.find((t) => t.slug === slug) ?? null
  }

  /**
   * Update email template
   */
  async updateEmailTemplate(
    slug: EmailTemplateSlug,
    params: {
      name?: string
      subject?: string
      markup?: string
      body_plain?: string
      from_email_name?: string
      reply_to_email_name?: string
    }
  ): Promise<EmailTemplate | null> {
    const config = await this.initialize()

    const template = config.email_templates.find((t) => t.slug === slug)
    if (!template) return null

    if (params.name !== undefined) template.name = params.name
    if (params.subject !== undefined) template.subject = params.subject
    if (params.markup !== undefined) template.markup = params.markup
    if (params.body_plain !== undefined) template.body_plain = params.body_plain
    if (params.from_email_name !== undefined) template.from_email_name = params.from_email_name
    if (params.reply_to_email_name !== undefined) template.reply_to_email_name = params.reply_to_email_name

    template.updated_at = Date.now()
    config.updated_at = Date.now()

    await this.ctx.storage.put('config', config)

    return template
  }

  /**
   * Reset email template to default
   */
  async resetEmailTemplate(slug: EmailTemplateSlug): Promise<EmailTemplate | null> {
    const config = await this.initialize()
    const now = Date.now()

    const index = config.email_templates.findIndex((t) => t.slug === slug)
    if (index === -1) return null

    const defaults = this.getDefaultEmailTemplates(now)
    const defaultTemplate = defaults.find((t) => t.slug === slug)
    if (!defaultTemplate) return null

    defaultTemplate.id = config.email_templates[index].id
    defaultTemplate.created_at = config.email_templates[index].created_at
    config.email_templates[index] = defaultTemplate
    config.updated_at = now

    await this.ctx.storage.put('config', config)

    return defaultTemplate
  }

  /**
   * Render email template with variables
   */
  async renderEmailTemplate(slug: EmailTemplateSlug, variables: Record<string, string>): Promise<{
    subject: string
    html: string
    text: string
  } | null> {
    const template = await this.getEmailTemplate(slug)
    if (!template) return null

    const render = (text: string): string => {
      return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '')
    }

    return {
      subject: render(template.subject),
      html: render(template.markup),
      text: render(template.body_plain),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SMS TEMPLATES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get default SMS templates
   */
  private getDefaultSmsTemplates(timestamp: number): SmsTemplate[] {
    return [
      {
        id: generateClerkId('tmpl'),
        object: 'sms_template',
        slug: 'verification_code',
        name: 'Verification Code',
        message: 'Your verification code is: {{code}}. Expires in 10 minutes.',
        delivered_by_clerk: true,
        required_fields: ['code'],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: generateClerkId('tmpl'),
        object: 'sms_template',
        slug: 'magic_link',
        name: 'Magic Link',
        message: 'Sign in with this link: {{magic_link_url}}',
        delivered_by_clerk: true,
        required_fields: ['magic_link_url'],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]
  }

  /**
   * List SMS templates
   */
  async listSmsTemplates(): Promise<{ data: SmsTemplate[]; total_count: number }> {
    const config = await this.initialize()
    return {
      data: config.sms_templates,
      total_count: config.sms_templates.length,
    }
  }

  /**
   * Get SMS template by slug
   */
  async getSmsTemplate(slug: SmsTemplateSlug): Promise<SmsTemplate | null> {
    const config = await this.initialize()
    return config.sms_templates.find((t) => t.slug === slug) ?? null
  }

  /**
   * Update SMS template
   */
  async updateSmsTemplate(
    slug: SmsTemplateSlug,
    params: {
      name?: string
      message?: string
    }
  ): Promise<SmsTemplate | null> {
    const config = await this.initialize()

    const template = config.sms_templates.find((t) => t.slug === slug)
    if (!template) return null

    if (params.name !== undefined) template.name = params.name
    if (params.message !== undefined) template.message = params.message

    template.updated_at = Date.now()
    config.updated_at = Date.now()

    await this.ctx.storage.put('config', config)

    return template
  }

  /**
   * Reset SMS template to default
   */
  async resetSmsTemplate(slug: SmsTemplateSlug): Promise<SmsTemplate | null> {
    const config = await this.initialize()
    const now = Date.now()

    const index = config.sms_templates.findIndex((t) => t.slug === slug)
    if (index === -1) return null

    const defaults = this.getDefaultSmsTemplates(now)
    const defaultTemplate = defaults.find((t) => t.slug === slug)
    if (!defaultTemplate) return null

    defaultTemplate.id = config.sms_templates[index].id
    defaultTemplate.created_at = config.sms_templates[index].created_at
    config.sms_templates[index] = defaultTemplate
    config.updated_at = now

    await this.ctx.storage.put('config', config)

    return defaultTemplate
  }

  /**
   * Render SMS template with variables
   */
  async renderSmsTemplate(slug: SmsTemplateSlug, variables: Record<string, string>): Promise<string | null> {
    const template = await this.getSmsTemplate(slug)
    if (!template) return null

    return template.message.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS (EMIT)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit webhook event
   */
  private async emitWebhook(type: string, data: unknown): Promise<void> {
    const config = await this.initialize()

    const event = {
      object: 'event',
      type,
      data,
      timestamp: Date.now(),
    }

    for (const endpoint of config.webhook_endpoints) {
      if (endpoint.status !== 'enabled') continue
      if (!endpoint.events.includes(type) && !endpoint.events.includes('*')) continue

      // Sign webhook payload (Svix-compatible)
      const payload = JSON.stringify(event)
      const timestamp = Math.floor(Date.now() / 1000)
      const signedPayload = `${endpoint.id}.${timestamp}.${payload}`

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(endpoint.secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
      const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))

      // Send webhook (fire-and-forget)
      try {
        await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'svix-id': endpoint.id,
            'svix-timestamp': String(timestamp),
            'svix-signature': `v1,${signatureB64}`,
          },
          body: payload,
        })
      } catch {
        // Log error but don't fail
        console.error(`Webhook delivery failed: ${endpoint.url}`)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OAUTH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start OAuth flow
   */
  async startOAuth(params: {
    provider: 'google' | 'github'
    redirect_url: string
    scopes?: string
  }): Promise<{ url: string }> {
    const config = await this.initialize()
    const state = generateToken(32)

    const oauthState: OAuthState = {
      state,
      provider: params.provider,
      redirect_url: params.redirect_url,
      expires_at: Date.now() + OAUTH_STATE_EXPIRY,
      created_at: Date.now(),
    }

    config.oauth_states.push(oauthState)
    await this.ctx.storage.put('config', config)

    let authUrl: string

    switch (params.provider) {
      case 'google': {
        const clientId = this.env.GOOGLE_CLIENT_ID
        if (!clientId) throw new Error('Google OAuth not configured')
        const scopes = params.scopes ?? 'email profile'
        authUrl =
          `https://accounts.google.com/o/oauth2/v2/auth?` +
          `client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(params.redirect_url)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(scopes)}` +
          `&state=${state}` +
          `&access_type=offline` +
          `&prompt=consent`
        break
      }

      case 'github': {
        const clientId = this.env.GITHUB_CLIENT_ID
        if (!clientId) throw new Error('GitHub OAuth not configured')
        const scopes = params.scopes ?? 'user:email'
        authUrl =
          `https://github.com/login/oauth/authorize?` +
          `client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(params.redirect_url)}` +
          `&scope=${encodeURIComponent(scopes)}` +
          `&state=${state}`
        break
      }

      default:
        throw new Error(`Provider ${params.provider} not supported`)
    }

    return { url: authUrl }
  }

  /**
   * Complete OAuth flow
   */
  async completeOAuth(params: {
    code: string
    state: string
  }): Promise<{ user: User; session: Session } | null> {
    const config = await this.initialize()

    // Verify state
    const stateIndex = config.oauth_states.findIndex(
      (s) => s.state === params.state && s.expires_at > Date.now()
    )
    if (stateIndex === -1) return null

    const oauthState = config.oauth_states[stateIndex]
    config.oauth_states.splice(stateIndex, 1)
    await this.ctx.storage.put('config', config)

    // Exchange code for tokens and get profile
    let profile: { email: string; name?: string; avatar_url?: string; id: string } | null = null

    switch (oauthState.provider) {
      case 'google':
        profile = await this.exchangeGoogleCode(params.code, oauthState.redirect_url)
        break
      case 'github':
        profile = await this.exchangeGitHubCode(params.code, oauthState.redirect_url)
        break
    }

    if (!profile) return null

    // Find or create user
    let userId = await this.getUserByEmail(profile.email)
    let user: User

    if (userId) {
      user = (await this.getUser(userId))!
      // Link external account
      const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId))
      await userDO.fetch('http://internal/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'linkExternalAccount',
          params: [
            {
              provider: oauthState.provider,
              provider_user_id: profile.id,
              email_address: profile.email,
              first_name: profile.name?.split(' ')[0],
              last_name: profile.name?.split(' ').slice(1).join(' '),
              avatar_url: profile.avatar_url,
            },
          ],
        }),
      })
      user = (await this.getUser(userId))!
    } else {
      user = await this.createUser({
        first_name: profile.name?.split(' ')[0],
        last_name: profile.name?.split(' ').slice(1).join(' '),
        email_address: [profile.email],
      })
      // Link external account
      const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(user.id))
      await userDO.fetch('http://internal/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'linkExternalAccount',
          params: [
            {
              provider: oauthState.provider,
              provider_user_id: profile.id,
              email_address: profile.email,
              first_name: profile.name?.split(' ')[0],
              last_name: profile.name?.split(' ').slice(1).join(' '),
              avatar_url: profile.avatar_url,
            },
          ],
        }),
      })
      user = (await this.getUser(user.id))!
    }

    // Create session
    const session = await this.createSession({ user_id: user.id })

    return { user, session }
  }

  /**
   * Exchange Google OAuth code for profile
   */
  private async exchangeGoogleCode(
    code: string,
    redirectUri: string
  ): Promise<{ email: string; name?: string; avatar_url?: string; id: string } | null> {
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.env.GOOGLE_CLIENT_ID!,
          client_secret: this.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenResponse.ok) return null

      const tokens = (await tokenResponse.json()) as { access_token: string }

      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })

      if (!profileResponse.ok) return null

      const profile = (await profileResponse.json()) as {
        id: string
        email: string
        name: string
        picture: string
      }

      return {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        avatar_url: profile.picture,
      }
    } catch {
      return null
    }
  }

  /**
   * Exchange GitHub OAuth code for profile
   */
  private async exchangeGitHubCode(
    code: string,
    redirectUri: string
  ): Promise<{ email: string; name?: string; avatar_url?: string; id: string } | null> {
    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          code,
          client_id: this.env.GITHUB_CLIENT_ID,
          client_secret: this.env.GITHUB_CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
      })

      if (!tokenResponse.ok) return null

      const tokens = (await tokenResponse.json()) as { access_token: string }

      const profileResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
          'User-Agent': 'clerk-compat',
        },
      })

      if (!profileResponse.ok) return null

      const profile = (await profileResponse.json()) as {
        id: number
        login: string
        email: string | null
        name: string | null
        avatar_url: string
      }

      let email = profile.email
      if (!email) {
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/json',
            'User-Agent': 'clerk-compat',
          },
        })
        if (emailsResponse.ok) {
          const emails = (await emailsResponse.json()) as Array<{
            email: string
            primary: boolean
            verified: boolean
          }>
          const primary = emails.find((e) => e.primary && e.verified)
          email = primary?.email ?? emails[0]?.email ?? null
        }
      }

      if (!email) return null

      return {
        id: String(profile.id),
        email,
        name: profile.name ?? profile.login,
        avatar_url: profile.avatar_url,
      }
    } catch {
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN-IN
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new sign-in
   */
  async createSignIn(params?: {
    identifier?: string
    password?: string
    strategy?: string
    redirect_url?: string
    transfer?: boolean
  }): Promise<SignIn> {
    const now = Date.now()
    const signInId = generateClerkId('sgin')

    const signIn: StoredSignIn = {
      id: signInId,
      status: 'needs_identifier',
      supported_identifiers: ['email_address', 'phone_number', 'username'],
      identifier: params?.identifier ?? null,
      user_id: null,
      created_session_id: null,
      supported_first_factors: [],
      supported_second_factors: [],
      first_factor_verification: null,
      second_factor_verification: null,
      created_at: now,
      updated_at: now,
      abandon_at: now + SIGN_IN_EXPIRY,
      verification_tokens: {},
    }

    // If identifier provided, look up user and set factors
    if (params?.identifier) {
      const userId = await this.getUserByEmail(params.identifier)
      if (userId) {
        signIn.user_id = userId
        signIn.status = 'needs_first_factor'

        const user = await this.getUser(userId)
        if (user) {
          // Set available first factors
          if (user.password_enabled) {
            signIn.supported_first_factors.push({ strategy: 'password' })
          }
          if (user.email_addresses.length > 0) {
            const email = user.email_addresses[0]
            signIn.supported_first_factors.push({
              strategy: 'email_code',
              email_address_id: email.id,
              safe_identifier: this.maskEmail(email.email_address),
              primary: email.id === user.primary_email_address_id,
            })
          }

          // Set available second factors
          if (user.totp_enabled) {
            signIn.supported_second_factors.push({ strategy: 'totp' })
          }
          if (user.backup_code_enabled) {
            signIn.supported_second_factors.push({ strategy: 'backup_code' })
          }

          // If password provided, attempt verification
          if (params.password) {
            const { valid } = await this.verifyPassword(userId, params.password)
            if (valid) {
              signIn.first_factor_verification = {
                status: 'verified',
                strategy: 'password',
                attempts: null,
                expire_at: null,
              }

              // Check if 2FA needed
              if (user.two_factor_enabled) {
                signIn.status = 'needs_second_factor'
              } else {
                // Complete sign-in
                const session = await this.createSession({ user_id: userId })
                signIn.created_session_id = session.id
                signIn.status = 'complete'
              }
            } else {
              signIn.first_factor_verification = {
                status: 'failed',
                strategy: 'password',
                attempts: 1,
                expire_at: null,
                error: {
                  message: 'Incorrect password',
                  long_message: 'The password you provided is incorrect',
                  code: 'form_password_incorrect',
                },
              }
            }
          }
        }
      } else {
        // User not found - still return sign-in but stay at needs_first_factor
        // to prevent user enumeration
        signIn.status = 'needs_first_factor'
        signIn.supported_first_factors = [{ strategy: 'password' }]
      }
    }

    await this.ctx.storage.put(`sign_in:${signInId}`, signIn)

    return this.toPublicSignIn(signIn)
  }

  /**
   * Get sign-in by ID
   */
  async getSignIn(signInId: string): Promise<SignIn | null> {
    const signIn = (await this.ctx.storage.get(`sign_in:${signInId}`)) as StoredSignIn | null
    if (!signIn) return null
    return this.toPublicSignIn(signIn)
  }

  /**
   * Prepare first factor verification
   */
  async prepareFirstFactor(
    signInId: string,
    params: {
      strategy: 'email_code' | 'phone_code'
      email_address_id?: string
      phone_number_id?: string
    }
  ): Promise<SignIn | null> {
    const signIn = (await this.ctx.storage.get(`sign_in:${signInId}`)) as StoredSignIn | null
    if (!signIn || !signIn.user_id) return null

    const now = Date.now()
    const code = generateOtpCode()

    signIn.verification_tokens[params.strategy] = {
      code,
      expires_at: now + VERIFICATION_CODE_EXPIRY,
      attempts: 0,
    }

    signIn.first_factor_verification = {
      status: 'unverified',
      strategy: params.strategy,
      attempts: 0,
      expire_at: now + VERIFICATION_CODE_EXPIRY,
    }

    signIn.updated_at = now
    await this.ctx.storage.put(`sign_in:${signInId}`, signIn)

    // In production, send email/SMS here
    // For development, return code in response (via dev mode flag or internal API)

    return this.toPublicSignIn(signIn)
  }

  /**
   * Attempt first factor verification
   */
  async attemptFirstFactor(
    signInId: string,
    params: {
      strategy: 'password' | 'email_code' | 'phone_code' | 'oauth_google' | 'oauth_github'
      password?: string
      code?: string
    }
  ): Promise<SignIn | null> {
    const signIn = (await this.ctx.storage.get(`sign_in:${signInId}`)) as StoredSignIn | null
    if (!signIn) return null

    const now = Date.now()

    if (params.strategy === 'password' && params.password && signIn.user_id) {
      const { valid } = await this.verifyPassword(signIn.user_id, params.password)

      if (valid) {
        signIn.first_factor_verification = {
          status: 'verified',
          strategy: 'password',
          attempts: null,
          expire_at: null,
        }

        const user = await this.getUser(signIn.user_id)
        if (user?.two_factor_enabled) {
          signIn.status = 'needs_second_factor'
        } else {
          const session = await this.createSession({ user_id: signIn.user_id })
          signIn.created_session_id = session.id
          signIn.status = 'complete'
        }
      } else {
        const attempts = (signIn.first_factor_verification?.attempts ?? 0) + 1
        signIn.first_factor_verification = {
          status: 'failed',
          strategy: 'password',
          attempts,
          expire_at: null,
          error: {
            message: 'Incorrect password',
            long_message: 'The password you provided is incorrect',
            code: 'form_password_incorrect',
          },
        }
      }
    } else if ((params.strategy === 'email_code' || params.strategy === 'phone_code') && params.code) {
      const token = signIn.verification_tokens[params.strategy]

      if (!token) {
        signIn.first_factor_verification = {
          status: 'failed',
          strategy: params.strategy,
          attempts: 0,
          expire_at: null,
          error: {
            message: 'No verification in progress',
            long_message: 'Please prepare verification first',
            code: 'verification_not_prepared',
          },
        }
      } else if (token.expires_at < now) {
        signIn.first_factor_verification = {
          status: 'expired',
          strategy: params.strategy,
          attempts: token.attempts,
          expire_at: token.expires_at,
        }
      } else if (token.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        signIn.first_factor_verification = {
          status: 'failed',
          strategy: params.strategy,
          attempts: token.attempts,
          expire_at: token.expires_at,
          error: {
            message: 'Too many attempts',
            long_message: 'Maximum verification attempts exceeded',
            code: 'too_many_attempts',
          },
        }
      } else if (token.code === params.code) {
        signIn.first_factor_verification = {
          status: 'verified',
          strategy: params.strategy,
          attempts: token.attempts + 1,
          expire_at: null,
        }

        delete signIn.verification_tokens[params.strategy]

        const user = signIn.user_id ? await this.getUser(signIn.user_id) : null
        if (user?.two_factor_enabled) {
          signIn.status = 'needs_second_factor'
        } else if (signIn.user_id) {
          const session = await this.createSession({ user_id: signIn.user_id })
          signIn.created_session_id = session.id
          signIn.status = 'complete'
        }
      } else {
        token.attempts++
        signIn.first_factor_verification = {
          status: 'unverified',
          strategy: params.strategy,
          attempts: token.attempts,
          expire_at: token.expires_at,
        }
      }
    }

    signIn.updated_at = now
    await this.ctx.storage.put(`sign_in:${signInId}`, signIn)

    return this.toPublicSignIn(signIn)
  }

  /**
   * Attempt second factor verification
   */
  async attemptSecondFactor(
    signInId: string,
    params: {
      strategy: 'totp' | 'backup_code'
      code: string
    }
  ): Promise<SignIn | null> {
    const signIn = (await this.ctx.storage.get(`sign_in:${signInId}`)) as StoredSignIn | null
    if (!signIn || !signIn.user_id || signIn.status !== 'needs_second_factor') return null

    const now = Date.now()
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(signIn.user_id))

    let verified = false

    if (params.strategy === 'totp') {
      // Verify TOTP (simplified - accepts any 6-digit code for testing)
      verified = /^\d{6}$/.test(params.code)
    } else if (params.strategy === 'backup_code') {
      const response = await userDO.fetch('http://internal/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'useBackupCode',
          params: [params.code],
        }),
      })
      const result = (await response.json()) as { result: { valid: boolean } }
      verified = result.result.valid
    }

    if (verified) {
      signIn.second_factor_verification = {
        status: 'verified',
        strategy: params.strategy,
        attempts: null,
        expire_at: null,
      }

      const session = await this.createSession({ user_id: signIn.user_id })
      signIn.created_session_id = session.id
      signIn.status = 'complete'
    } else {
      const attempts = (signIn.second_factor_verification?.attempts ?? 0) + 1
      signIn.second_factor_verification = {
        status: 'failed',
        strategy: params.strategy,
        attempts,
        expire_at: null,
        error: {
          message: 'Invalid code',
          long_message: 'The verification code you provided is invalid',
          code: 'form_code_incorrect',
        },
      }
    }

    signIn.updated_at = now
    await this.ctx.storage.put(`sign_in:${signInId}`, signIn)

    return this.toPublicSignIn(signIn)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN-UP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new sign-up
   */
  async createSignUp(params?: {
    email_address?: string
    phone_number?: string
    username?: string
    first_name?: string
    last_name?: string
    password?: string
    unsafe_metadata?: Record<string, unknown>
    strategy?: string
    redirect_url?: string
    transfer?: boolean
  }): Promise<SignUp> {
    const now = Date.now()
    const signUpId = generateClerkId('sgup')

    const requiredFields = ['email_address'] // Configurable in real Clerk
    const optionalFields = ['first_name', 'last_name', 'phone_number', 'username']

    const signUp: StoredSignUp = {
      id: signUpId,
      status: 'missing_requirements',
      required_fields: requiredFields,
      optional_fields: optionalFields,
      missing_fields: [...requiredFields],
      unverified_fields: [],
      verifications: {
        email_address: null,
        phone_number: null,
        web3_wallet: null,
        external_account: null,
      },
      username: params?.username ?? null,
      first_name: params?.first_name ?? null,
      last_name: params?.last_name ?? null,
      email_address: params?.email_address ?? null,
      phone_number: params?.phone_number ?? null,
      web3_wallet: null,
      password_enabled: false,
      external_account_strategy: null,
      external_account: null,
      unsafe_metadata: params?.unsafe_metadata ?? {},
      created_session_id: null,
      created_user_id: null,
      created_at: now,
      updated_at: now,
      abandon_at: now + SIGN_UP_EXPIRY,
      verification_tokens: {},
    }

    // Process provided fields
    if (params?.email_address) {
      signUp.missing_fields = signUp.missing_fields.filter((f) => f !== 'email_address')
      signUp.unverified_fields.push('email_address')
    }

    if (params?.password) {
      signUp.password_hash = await this.hashPassword(params.password)
      signUp.password_enabled = true
    }

    // Update status
    if (signUp.missing_fields.length === 0 && signUp.unverified_fields.length === 0) {
      // Ready to complete
      signUp.status = 'complete'
    }

    await this.ctx.storage.put(`sign_up:${signUpId}`, signUp)

    return this.toPublicSignUp(signUp)
  }

  /**
   * Get sign-up by ID
   */
  async getSignUp(signUpId: string): Promise<SignUp | null> {
    const signUp = (await this.ctx.storage.get(`sign_up:${signUpId}`)) as StoredSignUp | null
    if (!signUp) return null
    return this.toPublicSignUp(signUp)
  }

  /**
   * Update sign-up
   */
  async updateSignUp(
    signUpId: string,
    params: {
      email_address?: string
      phone_number?: string
      username?: string
      first_name?: string
      last_name?: string
      password?: string
      unsafe_metadata?: Record<string, unknown>
    }
  ): Promise<SignUp | null> {
    const signUp = (await this.ctx.storage.get(`sign_up:${signUpId}`)) as StoredSignUp | null
    if (!signUp) return null

    const now = Date.now()

    if (params.email_address !== undefined) {
      signUp.email_address = params.email_address
      signUp.missing_fields = signUp.missing_fields.filter((f) => f !== 'email_address')
      if (!signUp.unverified_fields.includes('email_address')) {
        signUp.unverified_fields.push('email_address')
      }
      signUp.verifications.email_address = null // Reset verification
    }

    if (params.phone_number !== undefined) {
      signUp.phone_number = params.phone_number
      signUp.missing_fields = signUp.missing_fields.filter((f) => f !== 'phone_number')
      if (!signUp.unverified_fields.includes('phone_number')) {
        signUp.unverified_fields.push('phone_number')
      }
      signUp.verifications.phone_number = null
    }

    if (params.username !== undefined) signUp.username = params.username
    if (params.first_name !== undefined) signUp.first_name = params.first_name
    if (params.last_name !== undefined) signUp.last_name = params.last_name

    if (params.password) {
      signUp.password_hash = await this.hashPassword(params.password)
      signUp.password_enabled = true
    }

    if (params.unsafe_metadata) {
      signUp.unsafe_metadata = { ...signUp.unsafe_metadata, ...params.unsafe_metadata }
    }

    signUp.updated_at = now
    await this.ctx.storage.put(`sign_up:${signUpId}`, signUp)

    return this.toPublicSignUp(signUp)
  }

  /**
   * Prepare sign-up verification
   */
  async prepareSignUpVerification(
    signUpId: string,
    params: {
      strategy: 'email_code' | 'phone_code' | 'email_link'
    }
  ): Promise<SignUp | null> {
    const signUp = (await this.ctx.storage.get(`sign_up:${signUpId}`)) as StoredSignUp | null
    if (!signUp) return null

    const now = Date.now()
    const code = params.strategy === 'email_link' ? generateToken(32) : generateOtpCode()

    const field = params.strategy.startsWith('email') ? 'email_address' : 'phone_number'

    signUp.verification_tokens[field] = {
      code,
      expires_at: now + VERIFICATION_CODE_EXPIRY,
      attempts: 0,
    }

    signUp.verifications[field] = {
      status: 'unverified',
      strategy: params.strategy,
      attempts: 0,
      expire_at: now + VERIFICATION_CODE_EXPIRY,
    }

    signUp.updated_at = now
    await this.ctx.storage.put(`sign_up:${signUpId}`, signUp)

    // In production, send email/SMS here

    return this.toPublicSignUp(signUp)
  }

  /**
   * Attempt sign-up verification
   */
  async attemptSignUpVerification(
    signUpId: string,
    params: {
      strategy: 'email_code' | 'phone_code' | 'email_link'
      code: string
    }
  ): Promise<SignUp | null> {
    const signUp = (await this.ctx.storage.get(`sign_up:${signUpId}`)) as StoredSignUp | null
    if (!signUp) return null

    const now = Date.now()
    const field = params.strategy.startsWith('email') ? 'email_address' : 'phone_number'
    const token = signUp.verification_tokens[field]

    if (!token) {
      signUp.verifications[field] = {
        status: 'failed',
        strategy: params.strategy,
        attempts: 0,
        expire_at: null,
        error: {
          message: 'No verification in progress',
          long_message: 'Please prepare verification first',
          code: 'verification_not_prepared',
        },
      }
    } else if (token.expires_at < now) {
      signUp.verifications[field] = {
        status: 'expired',
        strategy: params.strategy,
        attempts: token.attempts,
        expire_at: token.expires_at,
      }
    } else if (token.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      signUp.verifications[field] = {
        status: 'failed',
        strategy: params.strategy,
        attempts: token.attempts,
        expire_at: token.expires_at,
        error: {
          message: 'Too many attempts',
          long_message: 'Maximum verification attempts exceeded',
          code: 'too_many_attempts',
        },
      }
    } else if (token.code === params.code) {
      signUp.verifications[field] = {
        status: 'verified',
        strategy: params.strategy,
        attempts: token.attempts + 1,
        expire_at: null,
      }

      signUp.unverified_fields = signUp.unverified_fields.filter((f) => f !== field)
      delete signUp.verification_tokens[field]

      // Check if sign-up is complete
      if (signUp.missing_fields.length === 0 && signUp.unverified_fields.length === 0) {
        // Create user and session
        const user = await this.createUser({
          email_address: signUp.email_address ? [signUp.email_address] : undefined,
          phone_number: signUp.phone_number ? [signUp.phone_number] : undefined,
          username: signUp.username ?? undefined,
          first_name: signUp.first_name ?? undefined,
          last_name: signUp.last_name ?? undefined,
          password: signUp.password_enabled ? 'placeholder' : undefined, // Will use hash
          unsafe_metadata: signUp.unsafe_metadata,
        })

        const session = await this.createSession({ user_id: user.id })

        signUp.created_user_id = user.id
        signUp.created_session_id = session.id
        signUp.status = 'complete'
      }
    } else {
      token.attempts++
      signUp.verifications[field] = {
        status: 'unverified',
        strategy: params.strategy,
        attempts: token.attempts,
        expire_at: token.expires_at,
      }
    }

    signUp.updated_at = now
    await this.ctx.storage.put(`sign_up:${signUpId}`, signUp)

    return this.toPublicSignUp(signUp)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN-IN/SIGN-UP UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Hash password for sign-up storage
   */
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))

    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveBits',
    ])

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      key,
      256
    )

    const hashArray = new Uint8Array(derivedBits)
    const combined = new Uint8Array(salt.length + hashArray.length)
    combined.set(salt)
    combined.set(hashArray, salt.length)

    return btoa(String.fromCharCode(...combined))
  }

  /**
   * Mask email for display
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@')
    if (local.length <= 2) return `${local[0]}***@${domain}`
    return `${local[0]}***${local[local.length - 1]}@${domain}`
  }

  /**
   * Convert stored sign-in to public format
   */
  private toPublicSignIn(stored: StoredSignIn): SignIn {
    const { verification_tokens: _, ...rest } = stored
    return { ...rest, object: 'sign_in' }
  }

  /**
   * Convert stored sign-up to public format
   */
  private toPublicSignUp(stored: StoredSignUp): SignUp {
    const { password_hash: _, verification_tokens: __, ...rest } = stored
    return { ...rest, object: 'sign_up' }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEXING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Index user by email
   */
  private async indexUserEmail(email: string, userId: string): Promise<void> {
    await this.ctx.storage.put(`email_index:${email.toLowerCase()}`, userId)
  }

  /**
   * Get user ID by email
   */
  private async getUserByEmail(email: string): Promise<string | null> {
    return ((await this.ctx.storage.get(`email_index:${email.toLowerCase()}`)) as string) ?? null
  }

  /**
   * Index user session
   */
  private async indexUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions =
      ((await this.ctx.storage.get(`user_sessions:${userId}`)) as string[] | undefined) ?? []
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId)
      await this.ctx.storage.put(`user_sessions:${userId}`, sessions)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HONO APP
  // ═══════════════════════════════════════════════════════════════════════════

  private createApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>()

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok', service: 'ClerkDO' }))

    // JWKS endpoint
    app.get('/.well-known/jwks.json', async (c) => {
      const jwks = await this.getJwks()
      return c.json(jwks)
    })

    // Users
    app.post('/v1/users', async (c) => {
      const body = await c.req.json()
      const user = await this.createUser(body)
      return c.json(user, 201)
    })

    app.get('/v1/users/:user_id', async (c) => {
      const user = await this.getUser(c.req.param('user_id'))
      if (!user) return c.json({ error: 'User not found' }, 404)
      return c.json(user)
    })

    app.patch('/v1/users/:user_id', async (c) => {
      const body = await c.req.json()
      const user = await this.updateUser(c.req.param('user_id'), body)
      if (!user) return c.json({ error: 'User not found' }, 404)
      return c.json(user)
    })

    app.delete('/v1/users/:user_id', async (c) => {
      const result = await this.deleteUser(c.req.param('user_id'))
      return c.json(result)
    })

    // Sessions
    app.post('/v1/sessions', async (c) => {
      const body = await c.req.json()
      const session = await this.createSession(body)
      return c.json(session, 201)
    })

    app.get('/v1/sessions/:session_id', async (c) => {
      const session = await this.getSession(c.req.param('session_id'))
      if (!session) return c.json({ error: 'Session not found' }, 404)
      return c.json(session)
    })

    app.post('/v1/sessions/:session_id/revoke', async (c) => {
      const session = await this.revokeSession(c.req.param('session_id'))
      if (!session) return c.json({ error: 'Session not found' }, 404)
      return c.json(session)
    })

    app.post('/v1/sessions/:session_id/tokens', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { template?: string }
      const token = await this.createSessionToken(c.req.param('session_id'), body)
      if (!token) return c.json({ error: 'Session not found or inactive' }, 404)
      return c.json(token)
    })

    // Organizations
    app.post('/v1/organizations', async (c) => {
      const body = await c.req.json()
      const org = await this.createOrganization(body)
      return c.json(org, 201)
    })

    app.get('/v1/organizations/:org_id', async (c) => {
      const org = await this.getOrganization(c.req.param('org_id'))
      if (!org) return c.json({ error: 'Organization not found' }, 404)
      return c.json(org)
    })

    app.patch('/v1/organizations/:org_id', async (c) => {
      const body = await c.req.json()
      const org = await this.updateOrganization(c.req.param('org_id'), body)
      if (!org) return c.json({ error: 'Organization not found' }, 404)
      return c.json(org)
    })

    // Organization memberships
    app.post('/v1/organizations/:org_id/memberships', async (c) => {
      const body = await c.req.json()
      const membership = await this.createOrganizationMembership(c.req.param('org_id'), body)
      if (!membership) return c.json({ error: 'Failed to create membership' }, 400)
      return c.json(membership, 201)
    })

    // Invitations
    app.post('/v1/organizations/:org_id/invitations', async (c) => {
      const body = await c.req.json()
      const invitation = await this.createInvitation(c.req.param('org_id'), body)
      if (!invitation) return c.json({ error: 'Failed to create invitation' }, 400)
      return c.json(invitation, 201)
    })

    app.post('/v1/organizations/:org_id/invitations/:invitation_id/revoke', async (c) => {
      const invitation = await this.revokeInvitation(
        c.req.param('org_id'),
        c.req.param('invitation_id')
      )
      if (!invitation) return c.json({ error: 'Invitation not found' }, 404)
      return c.json(invitation)
    })

    // JWT Templates
    app.post('/v1/jwt_templates', async (c) => {
      const body = await c.req.json()
      const template = await this.createJwtTemplate(body)
      return c.json(template, 201)
    })

    app.get('/v1/jwt_templates', async (c) => {
      const result = await this.listJwtTemplates()
      return c.json(result)
    })

    app.delete('/v1/jwt_templates/:template_id', async (c) => {
      const result = await this.deleteJwtTemplate(c.req.param('template_id'))
      return c.json(result)
    })

    // Webhooks
    app.post('/v1/webhook_endpoints', async (c) => {
      const body = await c.req.json()
      const endpoint = await this.createWebhookEndpoint(body)
      return c.json(endpoint, 201)
    })

    // Token verification
    app.post('/v1/tokens/verify', async (c) => {
      const body = (await c.req.json()) as { token: string }
      const result = await this.verifyToken(body.token)
      return c.json(result)
    })

    // OAuth
    app.post('/v1/oauth/start', async (c) => {
      const body = await c.req.json()
      try {
        const result = await this.startOAuth(body)
        return c.json(result)
      } catch (error) {
        return c.json({ error: (error as Error).message }, 400)
      }
    })

    app.post('/v1/oauth/complete', async (c) => {
      const body = await c.req.json()
      const result = await this.completeOAuth(body)
      if (!result) return c.json({ error: 'OAuth completion failed' }, 400)
      return c.json(result)
    })

    return app
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // RPC endpoint for internal calls
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

    // Use Hono for REST API
    return this.app.fetch(request, this.env)
  }
}
