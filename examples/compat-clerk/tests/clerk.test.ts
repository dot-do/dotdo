/**
 * Clerk Compat Layer Tests
 *
 * Comprehensive tests for the Clerk-compatible authentication API.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { env, createExecutionContext } from 'cloudflare:test'

// Import the worker app and DO classes
import app from '../src/index'
import type { User, Session, Organization, OrganizationMembership } from '../src/index'

// ============================================================================
// TEST UTILITIES
// ============================================================================

type TestEnv = {
  CLERK_DO: DurableObjectNamespace
  USER_DO: DurableObjectNamespace
  ORG_DO: DurableObjectNamespace
  SESSION_DO: DurableObjectNamespace
  CLERK_SECRET_KEY?: string
  ENVIRONMENT?: string
}

async function makeRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>
) {
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const ctx = createExecutionContext()
  const response = await app.fetch(request, env as TestEnv, ctx)
  await ctx.waitUntil(Promise.resolve())

  return {
    status: response.status,
    json: async () => response.json(),
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

describe('Health Check', () => {
  it('should return healthy status', async () => {
    const res = await makeRequest('GET', '/health')
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toEqual({ status: 'ok', service: 'clerk-compat' })
  })

  it('should return API info at root', async () => {
    const res = await makeRequest('GET', '/')
    expect(res.status).toBe(200)

    const data = (await res.json()) as { name: string; endpoints: Record<string, string> }
    expect(data.name).toBe('Clerk-compatible Authentication API')
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.users).toBe('/v1/users')
  })
})

// ============================================================================
// JWKS
// ============================================================================

describe('JWKS Endpoint', () => {
  it('should return JWKS with RS256 keys', async () => {
    const res = await makeRequest('GET', '/.well-known/jwks.json')
    expect(res.status).toBe(200)

    const data = (await res.json()) as { keys: Array<{ kty: string; alg: string; use: string }> }
    expect(data.keys).toBeDefined()
    expect(Array.isArray(data.keys)).toBe(true)
    expect(data.keys.length).toBeGreaterThan(0)

    const key = data.keys[0]
    expect(key.kty).toBe('RSA')
    expect(key.alg).toBe('RS256')
    expect(key.use).toBe('sig')
  })
})

// ============================================================================
// USER MANAGEMENT
// ============================================================================

describe('User Management', () => {
  let createdUserId: string

  describe('Create User', () => {
    it('should create a user with email', async () => {
      const res = await makeRequest('POST', '/v1/users', {
        email_address: ['test@example.com'],
        first_name: 'Test',
        last_name: 'User',
        password: 'SecurePass123!',
      })

      expect(res.status).toBe(201)

      const user = (await res.json()) as User
      expect(user.id).toBeDefined()
      expect(user.object).toBe('user')
      expect(user.first_name).toBe('Test')
      expect(user.last_name).toBe('User')
      expect(user.email_addresses).toHaveLength(1)
      expect(user.email_addresses[0].email_address).toBe('test@example.com')
      expect(user.password_enabled).toBe(true)

      createdUserId = user.id
    })

    it('should create a user with username', async () => {
      const res = await makeRequest('POST', '/v1/users', {
        username: 'testuser',
        first_name: 'Username',
        last_name: 'Test',
      })

      expect(res.status).toBe(201)

      const user = (await res.json()) as User
      expect(user.username).toBe('testuser')
    })

    it('should create a user with phone number', async () => {
      const res = await makeRequest('POST', '/v1/users', {
        phone_number: ['+15551234567'],
        first_name: 'Phone',
        last_name: 'User',
      })

      expect(res.status).toBe(201)

      const user = (await res.json()) as User
      expect(user.phone_numbers).toHaveLength(1)
      expect(user.phone_numbers[0].phone_number).toBe('+15551234567')
    })

    it('should create a user with metadata', async () => {
      const res = await makeRequest('POST', '/v1/users', {
        email_address: ['metadata@example.com'],
        public_metadata: { role: 'admin' },
        private_metadata: { internal_id: '12345' },
        unsafe_metadata: { preferences: { theme: 'dark' } },
      })

      expect(res.status).toBe(201)

      const user = (await res.json()) as User
      expect(user.public_metadata).toEqual({ role: 'admin' })
      expect(user.private_metadata).toEqual({ internal_id: '12345' })
      expect(user.unsafe_metadata).toEqual({ preferences: { theme: 'dark' } })
    })
  })

  describe('Get User', () => {
    it('should get a user by ID', async () => {
      const res = await makeRequest('GET', `/v1/users/${createdUserId}`)

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.id).toBe(createdUserId)
      expect(user.first_name).toBe('Test')
    })

    it('should return 404 for non-existent user', async () => {
      const res = await makeRequest('GET', '/v1/users/user_nonexistent')

      expect(res.status).toBe(404)

      const error = (await res.json()) as { errors: Array<{ code: string }> }
      expect(error.errors[0].code).toBe('user_not_found')
    })
  })

  describe('Update User', () => {
    it('should update user name', async () => {
      const res = await makeRequest('PATCH', `/v1/users/${createdUserId}`, {
        first_name: 'Updated',
        last_name: 'Name',
      })

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.first_name).toBe('Updated')
      expect(user.last_name).toBe('Name')
    })

    it('should update user metadata', async () => {
      const res = await makeRequest('PATCH', `/v1/users/${createdUserId}`, {
        public_metadata: { level: 5 },
      })

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.public_metadata).toHaveProperty('level', 5)
    })

    it('should update user password', async () => {
      const res = await makeRequest('PATCH', `/v1/users/${createdUserId}`, {
        password: 'NewSecurePass456!',
      })

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.password_enabled).toBe(true)
    })
  })

  describe('Ban/Unban User', () => {
    it('should ban a user', async () => {
      const res = await makeRequest('POST', `/v1/users/${createdUserId}/ban`)

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.banned).toBe(true)
    })

    it('should unban a user', async () => {
      const res = await makeRequest('POST', `/v1/users/${createdUserId}/unban`)

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.banned).toBe(false)
    })
  })

  describe('Lock/Unlock User', () => {
    it('should lock a user', async () => {
      const res = await makeRequest('POST', `/v1/users/${createdUserId}/lock`)

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.locked).toBe(true)
    })

    it('should unlock a user', async () => {
      const res = await makeRequest('POST', `/v1/users/${createdUserId}/unlock`)

      expect(res.status).toBe(200)

      const user = (await res.json()) as User
      expect(user.locked).toBe(false)
    })
  })

  describe('Password Verification', () => {
    it('should verify correct password', async () => {
      const res = await makeRequest('POST', `/v1/users/${createdUserId}/verify_password`, {
        password: 'NewSecurePass456!',
      })

      expect(res.status).toBe(200)

      const result = (await res.json()) as { valid: boolean }
      expect(result.valid).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const res = await makeRequest('POST', `/v1/users/${createdUserId}/verify_password`, {
        password: 'WrongPassword123',
      })

      expect(res.status).toBe(200)

      const result = (await res.json()) as { valid: boolean }
      expect(result.valid).toBe(false)
    })
  })

  describe('Delete User', () => {
    it('should delete a user', async () => {
      // Create a user to delete
      const createRes = await makeRequest('POST', '/v1/users', {
        email_address: ['todelete@example.com'],
      })
      const user = (await createRes.json()) as User

      const res = await makeRequest('DELETE', `/v1/users/${user.id}`)

      expect(res.status).toBe(200)

      const result = (await res.json()) as { deleted: boolean }
      expect(result.deleted).toBe(true)

      // Verify user is gone
      const getRes = await makeRequest('GET', `/v1/users/${user.id}`)
      expect(getRes.status).toBe(404)
    })
  })
})

// ============================================================================
// EMAIL ADDRESS MANAGEMENT
// ============================================================================

describe('Email Address Management', () => {
  let userId: string
  let emailId: string

  beforeAll(async () => {
    const res = await makeRequest('POST', '/v1/users', {
      email_address: ['primary@example.com'],
      first_name: 'Email',
      last_name: 'Test',
    })
    const user = (await res.json()) as User
    userId = user.id
    emailId = user.email_addresses[0].id
  })

  it('should add a secondary email address', async () => {
    const res = await makeRequest('POST', `/v1/users/${userId}/email_addresses`, {
      email_address: 'secondary@example.com',
    })

    expect(res.status).toBe(201)

    const email = (await res.json()) as { id: string; email_address: string }
    expect(email.id).toBeDefined()
    expect(email.email_address).toBe('secondary@example.com')
  })

  it('should prepare email verification', async () => {
    const res = await makeRequest(
      'POST',
      `/v1/users/${userId}/email_addresses/${emailId}/prepare_verification`,
      { strategy: 'email_code' }
    )

    expect(res.status).toBe(200)

    const result = (await res.json()) as {
      verification: { status: string; _dev_token: string }
    }
    expect(result.verification.status).toBe('unverified')
    expect(result.verification._dev_token).toBeDefined()
  })

  it('should attempt email verification with correct code', async () => {
    // First prepare
    const prepareRes = await makeRequest(
      'POST',
      `/v1/users/${userId}/email_addresses/${emailId}/prepare_verification`
    )
    const prepareData = (await prepareRes.json()) as {
      verification: { _dev_token: string }
    }

    // Then attempt with correct code
    const res = await makeRequest(
      'POST',
      `/v1/users/${userId}/email_addresses/${emailId}/attempt_verification`,
      { code: prepareData.verification._dev_token }
    )

    expect(res.status).toBe(200)

    const result = (await res.json()) as { verification: { status: string } }
    expect(result.verification.status).toBe('verified')
  })

  it('should delete an email address', async () => {
    // Add an email to delete
    const addRes = await makeRequest('POST', `/v1/users/${userId}/email_addresses`, {
      email_address: 'todelete@example.com',
    })
    const email = (await addRes.json()) as { id: string }

    const res = await makeRequest(
      'DELETE',
      `/v1/users/${userId}/email_addresses/${email.id}`
    )

    expect(res.status).toBe(200)

    const result = (await res.json()) as { deleted: boolean }
    expect(result.deleted).toBe(true)
  })
})

// ============================================================================
// TOTP/MFA MANAGEMENT
// ============================================================================

describe('TOTP/MFA Management', () => {
  let userId: string
  let totpId: string

  beforeAll(async () => {
    const res = await makeRequest('POST', '/v1/users', {
      email_address: ['mfa@example.com'],
      first_name: 'MFA',
      last_name: 'Test',
    })
    const user = (await res.json()) as User
    userId = user.id
  })

  it('should enroll TOTP', async () => {
    const res = await makeRequest('POST', `/v1/users/${userId}/totp`, {
      friendly_name: 'My Authenticator',
    })

    expect(res.status).toBe(201)

    const totp = (await res.json()) as { id: string; secret: string; uri: string }
    expect(totp.id).toBeDefined()
    expect(totp.secret).toBeDefined()
    expect(totp.uri).toContain('otpauth://totp/')

    totpId = totp.id
  })

  it('should verify TOTP with 6-digit code', async () => {
    const res = await makeRequest(
      'POST',
      `/v1/users/${userId}/totp/${totpId}/attempt_verification`,
      { code: '123456' }
    )

    expect(res.status).toBe(200)

    const result = (await res.json()) as { verified: boolean }
    expect(result.verified).toBe(true)
  })

  it('should reject invalid TOTP code', async () => {
    // Enroll new TOTP
    const enrollRes = await makeRequest('POST', `/v1/users/${userId}/totp`)
    const totp = (await enrollRes.json()) as { id: string }

    const res = await makeRequest(
      'POST',
      `/v1/users/${userId}/totp/${totp.id}/attempt_verification`,
      { code: '12345' } // Only 5 digits
    )

    expect(res.status).toBe(400)
  })

  it('should generate backup codes', async () => {
    const res = await makeRequest('POST', `/v1/users/${userId}/backup_codes`)

    expect(res.status).toBe(201)

    const result = (await res.json()) as { codes: string[] }
    expect(result.codes).toBeDefined()
    expect(result.codes.length).toBe(10)
    expect(result.codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('should delete TOTP', async () => {
    const res = await makeRequest('DELETE', `/v1/users/${userId}/totp/${totpId}`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { deleted: boolean }
    expect(result.deleted).toBe(true)
  })
})

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

describe('Session Management', () => {
  let userId: string
  let sessionId: string

  beforeAll(async () => {
    const res = await makeRequest('POST', '/v1/users', {
      email_address: ['session@example.com'],
      first_name: 'Session',
      last_name: 'Test',
    })
    const user = (await res.json()) as User
    userId = user.id
  })

  it('should create a session', async () => {
    const res = await makeRequest('POST', '/v1/sessions', {
      user_id: userId,
      user_agent: 'Mozilla/5.0 Test Browser',
      ip_address: '192.168.1.1',
    })

    expect(res.status).toBe(201)

    const session = (await res.json()) as Session
    expect(session.id).toBeDefined()
    expect(session.object).toBe('session')
    expect(session.user_id).toBe(userId)
    expect(session.status).toBe('active')

    sessionId = session.id
  })

  it('should get a session', async () => {
    const res = await makeRequest('GET', `/v1/sessions/${sessionId}`)

    expect(res.status).toBe(200)

    const session = (await res.json()) as Session
    expect(session.id).toBe(sessionId)
    expect(session.status).toBe('active')
  })

  it('should create a session token', async () => {
    const res = await makeRequest('POST', `/v1/sessions/${sessionId}/tokens`)

    expect(res.status).toBe(200)

    const token = (await res.json()) as { jwt: string; expires_at: number }
    expect(token.jwt).toBeDefined()
    expect(token.jwt.split('.').length).toBe(3) // Valid JWT format
    expect(token.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('should verify a valid token', async () => {
    // Create a token
    const tokenRes = await makeRequest('POST', `/v1/sessions/${sessionId}/tokens`)
    const { jwt } = (await tokenRes.json()) as { jwt: string }

    const res = await makeRequest('POST', '/v1/tokens/verify', { token: jwt })

    expect(res.status).toBe(200)

    const result = (await res.json()) as { valid: boolean; claims?: { sub: string; sid: string } }
    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe(userId)
    expect(result.claims?.sid).toBe(sessionId)
  })

  it('should list user sessions', async () => {
    const res = await makeRequest('GET', `/v1/users/${userId}/sessions`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { data: Session[]; total_count: number }
    expect(result.data).toBeDefined()
    expect(result.total_count).toBeGreaterThanOrEqual(1)
  })

  it('should revoke a session', async () => {
    const res = await makeRequest('POST', `/v1/sessions/${sessionId}/revoke`)

    expect(res.status).toBe(200)

    const session = (await res.json()) as Session
    expect(session.status).toBe('revoked')
  })

  it('should not create token for revoked session', async () => {
    const res = await makeRequest('POST', `/v1/sessions/${sessionId}/tokens`)

    expect(res.status).toBe(400)
  })
})

// ============================================================================
// ORGANIZATION MANAGEMENT
// ============================================================================

describe('Organization Management', () => {
  let userId: string
  let orgId: string

  beforeAll(async () => {
    const res = await makeRequest('POST', '/v1/users', {
      email_address: ['org@example.com'],
      first_name: 'Org',
      last_name: 'Admin',
    })
    const user = (await res.json()) as User
    userId = user.id
  })

  describe('Create Organization', () => {
    it('should create an organization', async () => {
      const res = await makeRequest('POST', '/v1/organizations', {
        name: 'Test Organization',
        slug: 'test-org',
        created_by: userId,
      })

      expect(res.status).toBe(201)

      const org = (await res.json()) as Organization
      expect(org.id).toBeDefined()
      expect(org.object).toBe('organization')
      expect(org.name).toBe('Test Organization')
      expect(org.slug).toBe('test-org')

      orgId = org.id
    })

    it('should auto-generate slug from name', async () => {
      const res = await makeRequest('POST', '/v1/organizations', {
        name: 'My Awesome Company',
        created_by: userId,
      })

      expect(res.status).toBe(201)

      const org = (await res.json()) as Organization
      expect(org.slug).toBe('my-awesome-company')
    })
  })

  describe('Get Organization', () => {
    it('should get an organization by ID', async () => {
      const res = await makeRequest('GET', `/v1/organizations/${orgId}`)

      expect(res.status).toBe(200)

      const org = (await res.json()) as Organization
      expect(org.id).toBe(orgId)
      expect(org.name).toBe('Test Organization')
    })

    it('should return 404 for non-existent organization', async () => {
      const res = await makeRequest('GET', '/v1/organizations/org_nonexistent')

      expect(res.status).toBe(404)
    })
  })

  describe('Update Organization', () => {
    it('should update organization name', async () => {
      const res = await makeRequest('PATCH', `/v1/organizations/${orgId}`, {
        name: 'Updated Organization',
      })

      expect(res.status).toBe(200)

      const org = (await res.json()) as Organization
      expect(org.name).toBe('Updated Organization')
    })

    it('should update organization metadata', async () => {
      const res = await makeRequest('PATCH', `/v1/organizations/${orgId}`, {
        public_metadata: { plan: 'enterprise' },
      })

      expect(res.status).toBe(200)

      const org = (await res.json()) as Organization
      expect(org.public_metadata).toHaveProperty('plan', 'enterprise')
    })
  })
})

// ============================================================================
// ORGANIZATION MEMBERSHIPS
// ============================================================================

describe('Organization Memberships', () => {
  let adminUserId: string
  let memberUserId: string
  let orgId: string
  let membershipId: string

  beforeAll(async () => {
    // Create admin user
    const adminRes = await makeRequest('POST', '/v1/users', {
      email_address: ['admin@membership.test'],
      first_name: 'Admin',
      last_name: 'User',
    })
    adminUserId = ((await adminRes.json()) as User).id

    // Create member user
    const memberRes = await makeRequest('POST', '/v1/users', {
      email_address: ['member@membership.test'],
      first_name: 'Member',
      last_name: 'User',
    })
    memberUserId = ((await memberRes.json()) as User).id

    // Create organization
    const orgRes = await makeRequest('POST', '/v1/organizations', {
      name: 'Membership Test Org',
      created_by: adminUserId,
    })
    orgId = ((await orgRes.json()) as Organization).id
  })

  it('should list organization memberships', async () => {
    const res = await makeRequest('GET', `/v1/organizations/${orgId}/memberships`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { data: OrganizationMembership[]; total_count: number }
    expect(result.data).toBeDefined()
    expect(result.total_count).toBeGreaterThanOrEqual(1) // Creator is auto-added as admin
  })

  it('should add a member to organization', async () => {
    const res = await makeRequest('POST', `/v1/organizations/${orgId}/memberships`, {
      user_id: memberUserId,
      role: 'org:member',
    })

    expect(res.status).toBe(201)

    const membership = (await res.json()) as OrganizationMembership
    expect(membership.id).toBeDefined()
    expect(membership.role).toBe('org:member')
    expect(membership.public_user_data.user_id).toBe(memberUserId)

    membershipId = membership.id
  })

  it('should update membership role', async () => {
    const res = await makeRequest(
      'PATCH',
      `/v1/organizations/${orgId}/memberships/${membershipId}`,
      { role: 'org:admin' }
    )

    expect(res.status).toBe(200)

    const membership = (await res.json()) as OrganizationMembership
    expect(membership.role).toBe('org:admin')
  })

  it('should delete membership', async () => {
    const res = await makeRequest(
      'DELETE',
      `/v1/organizations/${orgId}/memberships/${membershipId}`
    )

    expect(res.status).toBe(200)

    const result = (await res.json()) as { deleted: boolean }
    expect(result.deleted).toBe(true)
  })
})

// ============================================================================
// ORGANIZATION INVITATIONS
// ============================================================================

describe('Organization Invitations', () => {
  let userId: string
  let orgId: string
  let invitationId: string

  beforeAll(async () => {
    const userRes = await makeRequest('POST', '/v1/users', {
      email_address: ['inviter@example.com'],
    })
    userId = ((await userRes.json()) as User).id

    const orgRes = await makeRequest('POST', '/v1/organizations', {
      name: 'Invitation Test Org',
      created_by: userId,
    })
    orgId = ((await orgRes.json()) as Organization).id
  })

  it('should create an invitation', async () => {
    const res = await makeRequest('POST', `/v1/organizations/${orgId}/invitations`, {
      email_address: 'invited@example.com',
      role: 'org:member',
    })

    expect(res.status).toBe(201)

    const invitation = (await res.json()) as {
      id: string
      email_address: string
      role: string
      status: string
    }
    expect(invitation.id).toBeDefined()
    expect(invitation.email_address).toBe('invited@example.com')
    expect(invitation.role).toBe('org:member')
    expect(invitation.status).toBe('pending')

    invitationId = invitation.id
  })

  it('should list invitations', async () => {
    const res = await makeRequest('GET', `/v1/organizations/${orgId}/invitations`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { data: Array<{ id: string }>; total_count: number }
    expect(result.data.length).toBeGreaterThanOrEqual(1)
  })

  it('should revoke an invitation', async () => {
    const res = await makeRequest(
      'POST',
      `/v1/organizations/${orgId}/invitations/${invitationId}/revoke`
    )

    expect(res.status).toBe(200)

    const invitation = (await res.json()) as { status: string }
    expect(invitation.status).toBe('revoked')
  })
})

// ============================================================================
// ORGANIZATION ROLES
// ============================================================================

describe('Organization Roles', () => {
  let userId: string
  let orgId: string

  beforeAll(async () => {
    const userRes = await makeRequest('POST', '/v1/users', {
      email_address: ['roles@example.com'],
    })
    userId = ((await userRes.json()) as User).id

    const orgRes = await makeRequest('POST', '/v1/organizations', {
      name: 'Roles Test Org',
      created_by: userId,
    })
    orgId = ((await orgRes.json()) as Organization).id
  })

  it('should list default roles', async () => {
    const res = await makeRequest('GET', `/v1/organizations/${orgId}/roles`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { data: Array<{ key: string }>; total_count: number }
    expect(result.data.length).toBeGreaterThanOrEqual(2)

    const roleKeys = result.data.map((r) => r.key)
    expect(roleKeys).toContain('org:admin')
    expect(roleKeys).toContain('org:member')
  })

  it('should create a custom role', async () => {
    const res = await makeRequest('POST', `/v1/organizations/${orgId}/roles`, {
      name: 'Billing Admin',
      key: 'org:billing_admin',
      description: 'Can manage billing',
      permissions: ['org:billing:read', 'org:billing:manage'],
    })

    expect(res.status).toBe(201)

    const role = (await res.json()) as { name: string; key: string; permissions: string[] }
    expect(role.name).toBe('Billing Admin')
    expect(role.key).toBe('org:billing_admin')
    expect(role.permissions).toContain('org:billing:read')
  })
})

// ============================================================================
// JWT TEMPLATES
// ============================================================================

describe('JWT Templates', () => {
  let templateId: string

  it('should create a JWT template', async () => {
    const res = await makeRequest('POST', '/v1/jwt_templates', {
      name: 'hasura',
      claims: {
        'https://hasura.io/jwt/claims': {
          'x-hasura-user-id': '{{user.id}}',
          'x-hasura-default-role': 'user',
          'x-hasura-allowed-roles': ['user', 'admin'],
        },
      },
      lifetime: 300,
    })

    expect(res.status).toBe(201)

    const template = (await res.json()) as { id: string; name: string; claims: Record<string, unknown> }
    expect(template.id).toBeDefined()
    expect(template.name).toBe('hasura')
    expect(template.claims).toHaveProperty('https://hasura.io/jwt/claims')

    templateId = template.id
  })

  it('should list JWT templates', async () => {
    const res = await makeRequest('GET', '/v1/jwt_templates')

    expect(res.status).toBe(200)

    const result = (await res.json()) as { data: Array<{ id: string }>; total_count: number }
    expect(result.data.length).toBeGreaterThanOrEqual(1)
  })

  it('should delete a JWT template', async () => {
    const res = await makeRequest('DELETE', `/v1/jwt_templates/${templateId}`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { deleted: boolean }
    expect(result.deleted).toBe(true)
  })
})

// ============================================================================
// WEBHOOKS
// ============================================================================

describe('Webhooks', () => {
  let endpointId: string

  it('should create a webhook endpoint', async () => {
    const res = await makeRequest('POST', '/v1/webhook_endpoints', {
      url: 'https://example.com/webhooks',
      description: 'Test webhook',
      events: ['user.created', 'user.updated', 'session.created'],
    })

    expect(res.status).toBe(201)

    const endpoint = (await res.json()) as { id: string; url: string; secret: string; events: string[] }
    expect(endpoint.id).toBeDefined()
    expect(endpoint.url).toBe('https://example.com/webhooks')
    expect(endpoint.secret).toMatch(/^whsec_/)
    expect(endpoint.events).toContain('user.created')

    endpointId = endpoint.id
  })

  it('should delete a webhook endpoint', async () => {
    const res = await makeRequest('DELETE', `/v1/webhook_endpoints/${endpointId}`)

    expect(res.status).toBe(200)

    const result = (await res.json()) as { deleted: boolean }
    expect(result.deleted).toBe(true)
  })
})
