/**
 * Clerk-compatible Authentication API
 *
 * A complete Clerk Backend API implementation on Cloudflare Workers
 * using Durable Objects for distributed, edge-native authentication.
 *
 * Components:
 * - ClerkDO: Main API coordinator (user/session/org management, webhooks)
 * - UserDO: Per-user storage (profile, MFA, external accounts)
 * - OrgDO: Per-organization storage (memberships, invitations, RBAC)
 * - SessionDO: Per-session storage (tokens, activity, rate limiting)
 *
 * @see https://clerk.com/docs/reference/backend-api
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { bearerAuth } from 'hono/bearer-auth'
import { ClerkDO } from './ClerkDO'
import { UserDO } from './UserDO'
import { OrgDO } from './OrgDO'
import { SessionDO } from './SessionDO'

// Re-export DO classes for wrangler
export { ClerkDO, UserDO, OrgDO, SessionDO }

// Re-export types
export type { User, EmailAddress, PhoneNumber, ExternalAccount, SamlAccount, Web3Wallet, TotpFactor, Passkey, PasskeyRegistrationOptions, PasskeyAuthenticationOptions, AuthenticatorTransport } from './UserDO'
export type { Organization, OrganizationMembership, OrganizationInvitation, OrganizationRole, OrganizationPermission, PublicUserData } from './OrgDO'
export type { Session, SessionToken, SessionActor, ClientInfo, SessionActivity } from './SessionDO'
export type { JwtTemplate, WebhookEndpoint, ClerkError, SignIn, SignUp, SignInFactor, FactorVerification, SignUpVerifications, EmailTemplate, SmsTemplate, EmailTemplateSlug, SmsTemplateSlug } from './ClerkDO'
export type { JWK, JWKS, JWTPayload, KeyPair } from './jwt'

// Re-export JWT utilities
export {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  importPublicKeyFromJwk,
  signJwt,
  verifyJwt,
  verifyJwtWithJwks,
  decodeJwt,
  createSessionToken,
  verifySessionToken,
  generateToken,
  generateClerkId,
  generateOtpCode,
} from './jwt'

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

// ============================================================================
// ERROR HANDLING
// ============================================================================

interface ClerkAPIError {
  errors: Array<{
    message: string
    long_message: string
    code: string
    meta?: Record<string, unknown>
  }>
}

function createError(code: string, message: string, longMessage?: string): ClerkAPIError {
  return {
    errors: [
      {
        message,
        long_message: longMessage ?? message,
        code,
      },
    ],
  }
}

// ============================================================================
// API ROUTES
// ============================================================================

const app = new Hono<{ Bindings: Env; Variables: { clerkDO: DurableObjectStub } }>()

// Middleware
app.use('*', logger())
app.use('*', cors())

// API key authentication for /v1 routes (optional based on secret key config)
app.use('/v1/*', async (c, next) => {
  const secretKey = c.env.CLERK_SECRET_KEY
  if (!secretKey) {
    // No secret key configured, allow all requests (dev mode)
    return next()
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(createError('authentication_required', 'Missing bearer token'), 401)
  }

  const token = authHeader.slice(7)
  if (token !== secretKey) {
    return c.json(createError('authentication_invalid', 'Invalid API key'), 401)
  }

  return next()
})

// Get ClerkDO stub
app.use('/v1/*', async (c, next) => {
  // Use a singleton ClerkDO for the instance
  const id = c.env.CLERK_DO.idFromName('singleton')
  const stub = c.env.CLERK_DO.get(id)
  c.set('clerkDO', stub)
  return next()
})

// ============================================================================
// HEALTH & DISCOVERY
// ============================================================================

app.get('/health', (c) => c.json({ status: 'ok', service: 'clerk-compat' }))

app.get('/', (c) =>
  c.json({
    name: 'Clerk-compatible Authentication API',
    version: '1.0.0',
    endpoints: {
      jwks: '/.well-known/jwks.json',
      users: '/v1/users',
      sessions: '/v1/sessions',
      organizations: '/v1/organizations',
      jwt_templates: '/v1/jwt_templates',
      webhooks: '/v1/webhook_endpoints',
      oauth: '/v1/oauth',
    },
  })
)

// JWKS endpoint (public)
app.get('/.well-known/jwks.json', async (c) => {
  const id = c.env.CLERK_DO.idFromName('singleton')
  const stub = c.env.CLERK_DO.get(id)
  return stub.fetch(new Request('http://internal/.well-known/jwks.json'))
})

// ============================================================================
// USERS API
// ============================================================================

// List users
app.get('/v1/users', async (c) => {
  const stub = c.get('clerkDO')
  const query = c.req.query()

  // Parse query params
  const params: Record<string, unknown> = {}
  if (query.limit) params.limit = parseInt(query.limit)
  if (query.offset) params.offset = parseInt(query.offset)
  if (query.email_address) params.email_address = query.email_address.split(',')
  if (query.phone_number) params.phone_number = query.phone_number.split(',')
  if (query.user_id) params.user_id = query.user_id.split(',')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listUsers',
        params: [params],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Create user
app.post('/v1/users', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createUser',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown; error?: { message: string } }
  if (result.error) {
    return c.json(createError('user_creation_failed', result.error.message), 400)
  }
  return c.json(result.result, 201)
})

// Get user
app.get('/v1/users/:user_id', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getUser',
        params: [userId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('user_not_found', 'User not found'), 404)
  }
  return c.json(result.result)
})

// Update user
app.patch('/v1/users/:user_id', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateUser',
        params: [userId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('user_not_found', 'User not found'), 404)
  }
  return c.json(result.result)
})

// Delete user
app.delete('/v1/users/:user_id', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteUser',
        params: [userId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// Ban user
app.post('/v1/users/:user_id/ban', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'banUser',
        params: [userId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('user_not_found', 'User not found'), 404)
  }
  return c.json(result.result)
})

// Unban user
app.post('/v1/users/:user_id/unban', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'unbanUser',
        params: [userId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('user_not_found', 'User not found'), 404)
  }
  return c.json(result.result)
})

// Lock user
app.post('/v1/users/:user_id/lock', async (c) => {
  const userId = c.req.param('user_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'lockUser',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('user_not_found', 'User not found'), 404)
  }
  return c.json(result.result)
})

// Unlock user
app.post('/v1/users/:user_id/unlock', async (c) => {
  const userId = c.req.param('user_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'unlockUser',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('user_not_found', 'User not found'), 404)
  }
  return c.json(result.result)
})

// Verify user password
app.post('/v1/users/:user_id/verify_password', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')
  const body = (await c.req.json()) as { password: string }

  if (!body.password) {
    return c.json(createError('missing_password', 'Password is required'), 400)
  }

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'verifyPassword',
        params: [userId, body.password],
      }),
    })
  )

  const result = (await response.json()) as { result: { valid: boolean } }
  return c.json(result.result)
})

// Get user organization memberships
app.get('/v1/users/:user_id/organization_memberships', async (c) => {
  const userId = c.req.param('user_id')
  // TODO: Query all orgs for this user's memberships
  return c.json({ data: [], total_count: 0 })
})

// Get user sessions
app.get('/v1/users/:user_id/sessions', async (c) => {
  const stub = c.get('clerkDO')
  const userId = c.req.param('user_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listUserSessions',
        params: [userId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// ============================================================================
// USER EMAIL ADDRESSES
// ============================================================================

// Create email address
app.post('/v1/users/:user_id/email_addresses', async (c) => {
  const userId = c.req.param('user_id')
  const body = (await c.req.json()) as { email_address: string }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'addEmailAddress',
        params: [body.email_address],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('email_creation_failed', 'Failed to add email address'), 400)
  }
  return c.json(result.result, 201)
})

// Delete email address
app.delete('/v1/users/:user_id/email_addresses/:email_id', async (c) => {
  const userId = c.req.param('user_id')
  const emailId = c.req.param('email_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'removeEmailAddress',
        params: [emailId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// Prepare email verification
app.post('/v1/users/:user_id/email_addresses/:email_id/prepare_verification', async (c) => {
  const userId = c.req.param('user_id')
  const emailId = c.req.param('email_id')
  const body = (await c.req.json().catch(() => ({}))) as { strategy?: 'email_code' | 'email_link' }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prepareEmailVerification',
        params: [emailId, body.strategy ?? 'email_code'],
      }),
    })
  )

  const result = (await response.json()) as { result: { token: string } | null }
  if (!result.result) {
    return c.json(createError('verification_failed', 'Failed to prepare verification'), 400)
  }

  // In production, send email with token. For now, return token for testing.
  return c.json({
    object: 'email_address',
    id: emailId,
    verification: {
      status: 'unverified',
      strategy: body.strategy ?? 'email_code',
      // Note: In production, don't return the token - send it via email
      _dev_token: result.result.token,
    },
  })
})

// Attempt email verification
app.post('/v1/users/:user_id/email_addresses/:email_id/attempt_verification', async (c) => {
  const userId = c.req.param('user_id')
  const emailId = c.req.param('email_id')
  const body = (await c.req.json()) as { code: string }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'attemptEmailVerification',
        params: [emailId, body.code],
      }),
    })
  )

  const result = (await response.json()) as { result: { verified: boolean } }
  if (!result.result.verified) {
    return c.json(createError('verification_failed', 'Invalid or expired verification code'), 400)
  }

  return c.json({
    object: 'email_address',
    id: emailId,
    verification: {
      status: 'verified',
    },
  })
})

// ============================================================================
// USER PHONE NUMBERS
// ============================================================================

// Create phone number
app.post('/v1/users/:user_id/phone_numbers', async (c) => {
  const userId = c.req.param('user_id')
  const body = (await c.req.json()) as { phone_number: string }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'addPhoneNumber',
        params: [body.phone_number],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('phone_creation_failed', 'Failed to add phone number'), 400)
  }
  return c.json(result.result, 201)
})

// Delete phone number
app.delete('/v1/users/:user_id/phone_numbers/:phone_id', async (c) => {
  const userId = c.req.param('user_id')
  const phoneId = c.req.param('phone_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'removePhoneNumber',
        params: [phoneId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// ============================================================================
// USER MFA/TOTP
// ============================================================================

// Enroll TOTP
app.post('/v1/users/:user_id/totp', async (c) => {
  const userId = c.req.param('user_id')
  const body = (await c.req.json().catch(() => ({}))) as { friendly_name?: string }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'enrollTotp',
        params: [body.friendly_name],
      }),
    })
  )

  const result = (await response.json()) as { result: { id: string; secret: string; uri: string } | null }
  if (!result.result) {
    return c.json(createError('totp_enrollment_failed', 'Failed to enroll TOTP'), 400)
  }
  return c.json(result.result, 201)
})

// Verify TOTP
app.post('/v1/users/:user_id/totp/:totp_id/attempt_verification', async (c) => {
  const userId = c.req.param('user_id')
  const totpId = c.req.param('totp_id')
  const body = (await c.req.json()) as { code: string }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'verifyTotp',
        params: [totpId, body.code],
      }),
    })
  )

  const result = (await response.json()) as { result: { verified: boolean } }
  if (!result.result.verified) {
    return c.json(createError('totp_verification_failed', 'Invalid TOTP code'), 400)
  }
  return c.json({ verified: true })
})

// Delete TOTP
app.delete('/v1/users/:user_id/totp/:totp_id', async (c) => {
  const userId = c.req.param('user_id')
  const totpId = c.req.param('totp_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteTotp',
        params: [totpId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// Generate backup codes
app.post('/v1/users/:user_id/backup_codes', async (c) => {
  const userId = c.req.param('user_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'generateBackupCodes',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: { codes: string[] } | null }
  if (!result.result) {
    return c.json(createError('backup_codes_failed', 'Failed to generate backup codes'), 400)
  }
  return c.json(result.result, 201)
})

// ============================================================================
// USER PASSKEYS (WebAuthn)
// ============================================================================

// List passkeys
app.get('/v1/users/:user_id/passkeys', async (c) => {
  const userId = c.req.param('user_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listPasskeys',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown[] }
  return c.json({ data: result.result, total_count: result.result.length })
})

// Start passkey registration
app.post('/v1/users/:user_id/passkeys/registration/start', async (c) => {
  const userId = c.req.param('user_id')
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'discouraged' | 'preferred' | 'required'
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'startPasskeyRegistration',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('passkey_registration_failed', 'Failed to start passkey registration'), 400)
  }
  return c.json(result.result)
})

// Complete passkey registration
app.post('/v1/users/:user_id/passkeys/registration/complete', async (c) => {
  const userId = c.req.param('user_id')
  const body = await c.req.json()
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'completePasskeyRegistration',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('passkey_registration_failed', 'Failed to complete passkey registration'), 400)
  }
  return c.json(result.result, 201)
})

// Start passkey authentication
app.post('/v1/users/:user_id/passkeys/authentication/start', async (c) => {
  const userId = c.req.param('user_id')
  const body = (await c.req.json().catch(() => ({}))) as {
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'startPasskeyAuthentication',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('passkey_auth_failed', 'Failed to start passkey authentication'), 400)
  }
  return c.json(result.result)
})

// Verify passkey authentication
app.post('/v1/users/:user_id/passkeys/authentication/verify', async (c) => {
  const userId = c.req.param('user_id')
  const body = await c.req.json()
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'verifyPasskeyAuthentication',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: { verified: boolean } }
  return c.json(result.result)
})

// Update passkey
app.patch('/v1/users/:user_id/passkeys/:passkey_id', async (c) => {
  const userId = c.req.param('user_id')
  const passkeyId = c.req.param('passkey_id')
  const body = await c.req.json()
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updatePasskey',
        params: [passkeyId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('passkey_not_found', 'Passkey not found'), 404)
  }
  return c.json(result.result)
})

// Delete passkey
app.delete('/v1/users/:user_id/passkeys/:passkey_id', async (c) => {
  const userId = c.req.param('user_id')
  const passkeyId = c.req.param('passkey_id')
  const userDO = c.env.USER_DO.get(c.env.USER_DO.idFromName(userId))

  const response = await userDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deletePasskey',
        params: [passkeyId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// ============================================================================
// SESSIONS API
// ============================================================================

// Create session
app.post('/v1/sessions', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createSession',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result, 201)
})

// Get session
app.get('/v1/sessions/:session_id', async (c) => {
  const stub = c.get('clerkDO')
  const sessionId = c.req.param('session_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSession',
        params: [sessionId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('session_not_found', 'Session not found'), 404)
  }
  return c.json(result.result)
})

// Revoke session
app.post('/v1/sessions/:session_id/revoke', async (c) => {
  const stub = c.get('clerkDO')
  const sessionId = c.req.param('session_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'revokeSession',
        params: [sessionId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('session_not_found', 'Session not found'), 404)
  }
  return c.json(result.result)
})

// Create session token
app.post('/v1/sessions/:session_id/tokens', async (c) => {
  const stub = c.get('clerkDO')
  const sessionId = c.req.param('session_id')
  const body = (await c.req.json().catch(() => ({}))) as { template?: string }

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createSessionToken',
        params: [sessionId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('token_creation_failed', 'Failed to create token'), 400)
  }
  return c.json(result.result)
})

// Verify token
app.post('/v1/tokens/verify', async (c) => {
  const stub = c.get('clerkDO')
  const body = (await c.req.json()) as { token: string }

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'verifyToken',
        params: [body.token],
      }),
    })
  )

  const result = (await response.json()) as { result: { valid: boolean; claims?: unknown } }
  return c.json(result.result)
})

// ============================================================================
// ORGANIZATIONS API
// ============================================================================

// Create organization
app.post('/v1/organizations', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createOrganization',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result, 201)
})

// Get organization
app.get('/v1/organizations/:org_id', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getOrganization',
        params: [orgId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('organization_not_found', 'Organization not found'), 404)
  }
  return c.json(result.result)
})

// Update organization
app.patch('/v1/organizations/:org_id', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateOrganization',
        params: [orgId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('organization_not_found', 'Organization not found'), 404)
  }
  return c.json(result.result)
})

// Delete organization
app.delete('/v1/organizations/:org_id', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteOrganization',
        params: [orgId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// ============================================================================
// ORGANIZATION MEMBERSHIPS
// ============================================================================

// List organization memberships
app.get('/v1/organizations/:org_id/memberships', async (c) => {
  const orgId = c.req.param('org_id')
  const orgDO = c.env.ORG_DO.get(c.env.ORG_DO.idFromName(orgId))

  const response = await orgDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listMemberships',
        params: [{}],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Create organization membership
app.post('/v1/organizations/:org_id/memberships', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createOrganizationMembership',
        params: [orgId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('membership_creation_failed', 'Failed to create membership'), 400)
  }
  return c.json(result.result, 201)
})

// Update organization membership
app.patch('/v1/organizations/:org_id/memberships/:membership_id', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')
  const membershipId = c.req.param('membership_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateOrganizationMembership',
        params: [orgId, membershipId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('membership_not_found', 'Membership not found'), 404)
  }
  return c.json(result.result)
})

// Delete organization membership
app.delete('/v1/organizations/:org_id/memberships/:membership_id', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')
  const membershipId = c.req.param('membership_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteOrganizationMembership',
        params: [orgId, membershipId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// ============================================================================
// ORGANIZATION INVITATIONS
// ============================================================================

// List organization invitations
app.get('/v1/organizations/:org_id/invitations', async (c) => {
  const orgId = c.req.param('org_id')
  const orgDO = c.env.ORG_DO.get(c.env.ORG_DO.idFromName(orgId))

  const response = await orgDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listInvitations',
        params: [{}],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Create organization invitation
app.post('/v1/organizations/:org_id/invitations', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createInvitation',
        params: [orgId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('invitation_creation_failed', 'Failed to create invitation'), 400)
  }
  return c.json(result.result, 201)
})

// Revoke organization invitation
app.post('/v1/organizations/:org_id/invitations/:invitation_id/revoke', async (c) => {
  const stub = c.get('clerkDO')
  const orgId = c.req.param('org_id')
  const invitationId = c.req.param('invitation_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'revokeInvitation',
        params: [orgId, invitationId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('invitation_not_found', 'Invitation not found'), 404)
  }
  return c.json(result.result)
})

// ============================================================================
// ORGANIZATION ROLES
// ============================================================================

// List roles
app.get('/v1/organizations/:org_id/roles', async (c) => {
  const orgId = c.req.param('org_id')
  const orgDO = c.env.ORG_DO.get(c.env.ORG_DO.idFromName(orgId))

  const response = await orgDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listRoles',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Create role
app.post('/v1/organizations/:org_id/roles', async (c) => {
  const orgId = c.req.param('org_id')
  const body = await c.req.json()
  const orgDO = c.env.ORG_DO.get(c.env.ORG_DO.idFromName(orgId))

  const response = await orgDO.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createRole',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('role_creation_failed', 'Failed to create role'), 400)
  }
  return c.json(result.result, 201)
})

// ============================================================================
// JWT TEMPLATES
// ============================================================================

// List JWT templates
app.get('/v1/jwt_templates', async (c) => {
  const stub = c.get('clerkDO')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listJwtTemplates',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Create JWT template
app.post('/v1/jwt_templates', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createJwtTemplate',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result, 201)
})

// Delete JWT template
app.delete('/v1/jwt_templates/:template_id', async (c) => {
  const stub = c.get('clerkDO')
  const templateId = c.req.param('template_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteJwtTemplate',
        params: [templateId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

// List email templates
app.get('/v1/email_templates', async (c) => {
  const stub = c.get('clerkDO')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listEmailTemplates',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Get email template
app.get('/v1/email_templates/:slug', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getEmailTemplate',
        params: [slug],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'Email template not found'), 404)
  }
  return c.json(result.result)
})

// Update email template
app.patch('/v1/email_templates/:slug', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateEmailTemplate',
        params: [slug, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'Email template not found'), 404)
  }
  return c.json(result.result)
})

// Reset email template to default
app.post('/v1/email_templates/:slug/revert', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resetEmailTemplate',
        params: [slug],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'Email template not found'), 404)
  }
  return c.json(result.result)
})

// Preview email template
app.post('/v1/email_templates/:slug/preview', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')
  const body = (await c.req.json()) as { variables?: Record<string, string> }

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'renderEmailTemplate',
        params: [slug, body.variables ?? {}],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'Email template not found'), 404)
  }
  return c.json(result.result)
})

// ============================================================================
// SMS TEMPLATES
// ============================================================================

// List SMS templates
app.get('/v1/sms_templates', async (c) => {
  const stub = c.get('clerkDO')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listSmsTemplates',
        params: [],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result)
})

// Get SMS template
app.get('/v1/sms_templates/:slug', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSmsTemplate',
        params: [slug],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'SMS template not found'), 404)
  }
  return c.json(result.result)
})

// Update SMS template
app.patch('/v1/sms_templates/:slug', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateSmsTemplate',
        params: [slug, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'SMS template not found'), 404)
  }
  return c.json(result.result)
})

// Reset SMS template to default
app.post('/v1/sms_templates/:slug/revert', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resetSmsTemplate',
        params: [slug],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'SMS template not found'), 404)
  }
  return c.json(result.result)
})

// Preview SMS template
app.post('/v1/sms_templates/:slug/preview', async (c) => {
  const stub = c.get('clerkDO')
  const slug = c.req.param('slug')
  const body = (await c.req.json()) as { variables?: Record<string, string> }

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'renderSmsTemplate',
        params: [slug, body.variables ?? {}],
      }),
    })
  )

  const result = (await response.json()) as { result: string | null }
  if (!result.result) {
    return c.json(createError('template_not_found', 'SMS template not found'), 404)
  }
  return c.json({ message: result.result })
})

// ============================================================================
// WEBHOOKS
// ============================================================================

// Create webhook endpoint
app.post('/v1/webhook_endpoints', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createWebhookEndpoint',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result, 201)
})

// Delete webhook endpoint
app.delete('/v1/webhook_endpoints/:endpoint_id', async (c) => {
  const stub = c.get('clerkDO')
  const endpointId = c.req.param('endpoint_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deleteWebhookEndpoint',
        params: [endpointId],
      }),
    })
  )

  const result = (await response.json()) as { result: { deleted: boolean } }
  return c.json(result.result)
})

// ============================================================================
// OAUTH
// ============================================================================

// Start OAuth flow
app.post('/v1/oauth/start', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'startOAuth',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: { url: string } | null; error?: { message: string } }
  if (result.error) {
    return c.json(createError('oauth_failed', result.error.message), 400)
  }
  return c.json(result.result)
})

// Complete OAuth flow
app.post('/v1/oauth/complete', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'completeOAuth',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('oauth_failed', 'OAuth completion failed'), 400)
  }
  return c.json(result.result)
})

// OAuth callback (GET for browser redirect)
app.get('/v1/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.json(createError('oauth_error', error), 400)
  }

  if (!code || !state) {
    return c.json(createError('oauth_invalid', 'Missing code or state'), 400)
  }

  const stub = c.get('clerkDO')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'completeOAuth',
        params: [{ code, state }],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('oauth_failed', 'OAuth completion failed'), 400)
  }

  // In production, redirect to frontend with session token
  return c.json(result.result)
})

// ============================================================================
// SIGN-IN
// ============================================================================

// Create sign-in
app.post('/v1/client/sign_ins', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createSignIn',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result, 200)
})

// Get sign-in
app.get('/v1/client/sign_ins/:sign_in_id', async (c) => {
  const stub = c.get('clerkDO')
  const signInId = c.req.param('sign_in_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignIn',
        params: [signInId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_in_not_found', 'Sign-in not found'), 404)
  }
  return c.json(result.result)
})

// Prepare first factor
app.post('/v1/client/sign_ins/:sign_in_id/prepare_first_factor', async (c) => {
  const stub = c.get('clerkDO')
  const signInId = c.req.param('sign_in_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prepareFirstFactor',
        params: [signInId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_in_not_found', 'Sign-in not found'), 404)
  }
  return c.json(result.result)
})

// Attempt first factor
app.post('/v1/client/sign_ins/:sign_in_id/attempt_first_factor', async (c) => {
  const stub = c.get('clerkDO')
  const signInId = c.req.param('sign_in_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'attemptFirstFactor',
        params: [signInId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_in_not_found', 'Sign-in not found'), 404)
  }
  return c.json(result.result)
})

// Attempt second factor
app.post('/v1/client/sign_ins/:sign_in_id/attempt_second_factor', async (c) => {
  const stub = c.get('clerkDO')
  const signInId = c.req.param('sign_in_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'attemptSecondFactor',
        params: [signInId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_in_not_found', 'Sign-in not found'), 404)
  }
  return c.json(result.result)
})

// ============================================================================
// SIGN-UP
// ============================================================================

// Create sign-up
app.post('/v1/client/sign_ups', async (c) => {
  const stub = c.get('clerkDO')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'createSignUp',
        params: [body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown }
  return c.json(result.result, 200)
})

// Get sign-up
app.get('/v1/client/sign_ups/:sign_up_id', async (c) => {
  const stub = c.get('clerkDO')
  const signUpId = c.req.param('sign_up_id')

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignUp',
        params: [signUpId],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_up_not_found', 'Sign-up not found'), 404)
  }
  return c.json(result.result)
})

// Update sign-up
app.patch('/v1/client/sign_ups/:sign_up_id', async (c) => {
  const stub = c.get('clerkDO')
  const signUpId = c.req.param('sign_up_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateSignUp',
        params: [signUpId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_up_not_found', 'Sign-up not found'), 404)
  }
  return c.json(result.result)
})

// Prepare sign-up verification
app.post('/v1/client/sign_ups/:sign_up_id/prepare_verification', async (c) => {
  const stub = c.get('clerkDO')
  const signUpId = c.req.param('sign_up_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prepareSignUpVerification',
        params: [signUpId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_up_not_found', 'Sign-up not found'), 404)
  }
  return c.json(result.result)
})

// Attempt sign-up verification
app.post('/v1/client/sign_ups/:sign_up_id/attempt_verification', async (c) => {
  const stub = c.get('clerkDO')
  const signUpId = c.req.param('sign_up_id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/rpc', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'attemptSignUpVerification',
        params: [signUpId, body],
      }),
    })
  )

  const result = (await response.json()) as { result: unknown | null }
  if (!result.result) {
    return c.json(createError('sign_up_not_found', 'Sign-up not found'), 404)
  }
  return c.json(result.result)
})

// ============================================================================
// EXPORT
// ============================================================================

export default app
