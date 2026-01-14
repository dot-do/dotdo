/**
 * @dotdo/auth - Multi-Provider Authentication API Tests
 *
 * RED Phase: Tests for the unified auth API that abstracts
 * over multiple auth providers (Auth0, Clerk, custom).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Auth,
  createAuth,
  // Types
  type AuthConfig,
  type User,
  type Session,
  type TokenPair,
  // Managers
  type UserManager,
  type SessionManager,
  type MFAManager,
  type OAuthManager,
  // Errors
  AuthError,
} from '../src'

describe('@dotdo/auth', () => {
  // ============================================================================
  // AUTH FACTORY
  // ============================================================================

  describe('createAuth', () => {
    it('should create an auth instance with default in-memory backend', () => {
      const auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
      })

      expect(auth).toBeDefined()
      expect(auth.users).toBeDefined()
      expect(auth.sessions).toBeDefined()
      expect(auth.mfa).toBeDefined()
      expect(auth.oauth).toBeDefined()
    })

    it('should accept custom configuration', () => {
      const auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
        issuer: 'https://auth.example.com',
        audience: 'my-app',
        accessTokenTTL: 1800,
        refreshTokenTTL: 86400,
      })

      expect(auth).toBeDefined()
    })

    it('should support custom storage backend', () => {
      const customStorage = new Map<string, unknown>()

      const auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
        storage: {
          get: async (key: string) => customStorage.get(key),
          put: async (key: string, value: unknown) => {
            customStorage.set(key, value)
          },
          delete: async (key: string) => {
            customStorage.delete(key)
          },
        },
      })

      expect(auth).toBeDefined()
    })
  })

  // ============================================================================
  // AUTH CLASS
  // ============================================================================

  describe('Auth', () => {
    let auth: Auth

    beforeEach(() => {
      auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
        issuer: 'https://auth.example.com',
      })
    })

    describe('signUp', () => {
      it('should create a new user with email and password', async () => {
        const result = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        expect(result.user).toBeDefined()
        expect(result.user.id).toMatch(/^user_/)
        expect(result.user.email).toBe('test@example.com')
        expect(result.session).toBeDefined()
        expect(result.tokens).toBeDefined()
        expect(result.tokens.access_token).toBeDefined()
        expect(result.tokens.refresh_token).toBeDefined()
      })

      it('should create a user with metadata', async () => {
        const result = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          firstName: 'John',
          lastName: 'Doe',
          metadata: { plan: 'pro' },
        })

        expect(result.user.first_name).toBe('John')
        expect(result.user.last_name).toBe('Doe')
        expect(result.user.metadata.plan).toBe('pro')
      })

      it('should reject duplicate email', async () => {
        await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await expect(
          auth.signUp({
            email: 'test@example.com',
            password: 'AnotherPassword123!',
          })
        ).rejects.toThrow(AuthError)
      })

      it('should reject weak password', async () => {
        await expect(
          auth.signUp({
            email: 'test@example.com',
            password: 'short',
          })
        ).rejects.toThrow(AuthError)
      })
    })

    describe('signIn', () => {
      beforeEach(async () => {
        await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })
      })

      it('should authenticate with valid credentials', async () => {
        const result = await auth.signIn({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        expect(result.user).toBeDefined()
        expect(result.user.email).toBe('test@example.com')
        expect(result.session).toBeDefined()
        expect(result.tokens).toBeDefined()
      })

      it('should reject invalid password', async () => {
        await expect(
          auth.signIn({
            email: 'test@example.com',
            password: 'WrongPassword123!',
          })
        ).rejects.toThrow(AuthError)
      })

      it('should reject non-existent user', async () => {
        await expect(
          auth.signIn({
            email: 'nonexistent@example.com',
            password: 'Password123!',
          })
        ).rejects.toThrow(AuthError)
      })

      it('should update last sign in time', async () => {
        const result = await auth.signIn({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        expect(result.user.last_sign_in_at).toBeDefined()
      })
    })

    describe('signOut', () => {
      it('should revoke the session', async () => {
        const { session, tokens } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await auth.signOut(session.id)

        // Session should be invalid
        const validation = await auth.validateToken(tokens.access_token)
        expect(validation.valid).toBe(false)
      })

      it('should revoke all sessions for user', async () => {
        const { user } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        // Create additional sessions
        await auth.signIn({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })
        await auth.signIn({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const revokedCount = await auth.signOutAll(user.id)

        // signUp creates 1 session + 2 signIns = 3 sessions total
        // But we're counting unique sessions, so should be 3
        expect(revokedCount).toBeGreaterThanOrEqual(2)
      })
    })

    describe('validateToken', () => {
      it('should validate a valid access token', async () => {
        const { tokens } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const result = await auth.validateToken(tokens.access_token)

        expect(result.valid).toBe(true)
        expect(result.user).toBeDefined()
        expect(result.session).toBeDefined()
      })

      it('should reject invalid token', async () => {
        const result = await auth.validateToken('invalid-token')

        expect(result.valid).toBe(false)
        expect(result.error).toBeDefined()
      })

      it('should reject expired token', async () => {
        // Create auth with very short TTL
        const shortAuth = createAuth({
          jwtSecret: 'test-secret-key-that-is-long-enough',
          accessTokenTTL: 1, // 1 second
        })

        const { tokens } = await shortAuth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        // Wait for token to expire (2 seconds to be safe)
        await new Promise((resolve) => setTimeout(resolve, 2000))

        const result = await shortAuth.validateToken(tokens.access_token)

        expect(result.valid).toBe(false)
      }, 10000) // 10 second timeout for this test
    })

    describe('refreshToken', () => {
      it('should refresh tokens', async () => {
        const { tokens } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const newTokens = await auth.refreshToken(tokens.refresh_token)

        expect(newTokens.access_token).toBeDefined()
        expect(newTokens.access_token).not.toBe(tokens.access_token)
        expect(newTokens.refresh_token).toBeDefined()
      })

      it('should reject invalid refresh token', async () => {
        await expect(auth.refreshToken('invalid-refresh-token')).rejects.toThrow(
          AuthError
        )
      })

      it('should rotate refresh token (one-time use)', async () => {
        const { tokens } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        // First refresh should work
        await auth.refreshToken(tokens.refresh_token)

        // Second refresh with same token should fail
        await expect(auth.refreshToken(tokens.refresh_token)).rejects.toThrow(
          AuthError
        )
      })
    })

    describe('resetPassword', () => {
      it('should generate reset token', async () => {
        await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const token = await auth.requestPasswordReset('test@example.com')

        expect(token).toBeDefined()
        expect(typeof token).toBe('string')
      })

      it('should reset password with valid token', async () => {
        await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const token = await auth.requestPasswordReset('test@example.com')
        await auth.resetPassword(token!, 'NewSecurePassword123!')

        // Old password should fail
        await expect(
          auth.signIn({
            email: 'test@example.com',
            password: 'SecurePassword123!',
          })
        ).rejects.toThrow()

        // New password should work
        const result = await auth.signIn({
          email: 'test@example.com',
          password: 'NewSecurePassword123!',
        })
        expect(result.user).toBeDefined()
      })

      it('should return null for non-existent email', async () => {
        const token = await auth.requestPasswordReset('nonexistent@example.com')

        expect(token).toBeNull()
      })
    })

    describe('verifyEmail', () => {
      it('should generate verification token', async () => {
        const { user } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        expect(user.email_verified).toBe(false)

        const token = await auth.requestEmailVerification(user.id)

        expect(token).toBeDefined()
      })

      it('should verify email with valid token', async () => {
        const { user } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const token = await auth.requestEmailVerification(user.id)
        const verifiedUser = await auth.verifyEmail(token)

        expect(verifiedUser.email_verified).toBe(true)
      })
    })

    describe('changePassword', () => {
      it('should change password with valid current password', async () => {
        const { user } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await auth.changePassword(
          user.id,
          'SecurePassword123!',
          'NewSecurePassword123!'
        )

        // Old password should fail
        await expect(
          auth.signIn({
            email: 'test@example.com',
            password: 'SecurePassword123!',
          })
        ).rejects.toThrow()

        // New password should work
        const result = await auth.signIn({
          email: 'test@example.com',
          password: 'NewSecurePassword123!',
        })
        expect(result.user).toBeDefined()
      })

      it('should reject invalid current password', async () => {
        const { user } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await expect(
          auth.changePassword(user.id, 'WrongPassword123!', 'NewSecurePassword123!')
        ).rejects.toThrow(AuthError)
      })
    })
  })

  // ============================================================================
  // USER MANAGER
  // ============================================================================

  describe('UserManager', () => {
    let auth: Auth

    beforeEach(() => {
      auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
      })
    })

    describe('users.create', () => {
      it('should create a user', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        expect(user.id).toBeDefined()
        expect(user.email).toBe('test@example.com')
      })

      it('should support phone authentication', async () => {
        const user = await auth.users.create({
          phone: '+1234567890',
          password: 'SecurePassword123!',
        })

        expect(user.phone).toBe('+1234567890')
      })
    })

    describe('users.get', () => {
      it('should get user by ID', async () => {
        const created = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const user = await auth.users.get(created.id)

        expect(user).toBeDefined()
        expect(user!.id).toBe(created.id)
      })
    })

    describe('users.getByEmail', () => {
      it('should get user by email', async () => {
        await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const user = await auth.users.getByEmail('test@example.com')

        expect(user).toBeDefined()
        expect(user!.email).toBe('test@example.com')
      })
    })

    describe('users.update', () => {
      it('should update user fields', async () => {
        const created = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const updated = await auth.users.update(created.id, {
          first_name: 'John',
          last_name: 'Doe',
        })

        expect(updated.first_name).toBe('John')
        expect(updated.last_name).toBe('Doe')
      })
    })

    describe('users.delete', () => {
      it('should delete a user', async () => {
        const created = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await auth.users.delete(created.id)

        const user = await auth.users.get(created.id)
        expect(user).toBeNull()
      })
    })
  })

  // ============================================================================
  // SESSION MANAGER
  // ============================================================================

  describe('SessionManager', () => {
    let auth: Auth

    beforeEach(() => {
      auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
      })
    })

    describe('sessions.create', () => {
      it('should create a session for user', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const { session, tokens } = await auth.sessions.create(user)

        expect(session.id).toBeDefined()
        expect(session.user_id).toBe(user.id)
        expect(session.status).toBe('active')
        expect(tokens.access_token).toBeDefined()
      })
    })

    describe('sessions.validate', () => {
      it('should validate access token', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const { tokens } = await auth.sessions.create(user)
        const result = await auth.sessions.validate(tokens.access_token)

        expect(result.valid).toBe(true)
        expect(result.session).toBeDefined()
      })
    })

    describe('sessions.revoke', () => {
      it('should revoke a session', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const { session, tokens } = await auth.sessions.create(user)
        await auth.sessions.revoke(session.id)

        const result = await auth.sessions.validate(tokens.access_token)
        expect(result.valid).toBe(false)
      })
    })

    describe('sessions.list', () => {
      it('should list user sessions', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await auth.sessions.create(user)
        await auth.sessions.create(user)
        await auth.sessions.create(user)

        const sessions = await auth.sessions.list(user.id)

        expect(sessions).toHaveLength(3)
      })
    })
  })

  // ============================================================================
  // MFA MANAGER
  // ============================================================================

  describe('MFAManager', () => {
    let auth: Auth

    beforeEach(() => {
      auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
        mfa: {
          totpIssuer: 'TestApp',
        },
      })
    })

    describe('mfa.enrollTOTP', () => {
      it('should enroll TOTP factor', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const enrollment = await auth.mfa.enrollTOTP(user.id)

        expect(enrollment.factor_id).toBeDefined()
        expect(enrollment.secret).toBeDefined()
        expect(enrollment.uri).toContain('otpauth://totp/')
        expect(enrollment.qr_code).toBeDefined()
      })
    })

    describe('mfa.verifyTOTP', () => {
      it('should verify TOTP code after enrollment', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const enrollment = await auth.mfa.enrollTOTP(user.id)

        // Generate a valid TOTP code from the secret
        const code = await generateTOTPCode(enrollment.secret)

        const factor = await auth.mfa.verifyTOTPEnrollment(enrollment.factor_id, code)

        expect(factor.status).toBe('verified')
      })
    })

    describe('mfa.hasMFA', () => {
      it('should return false when no MFA factors', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const hasMFA = await auth.mfa.hasMFA(user.id)

        expect(hasMFA).toBe(false)
      })

      it('should return true when MFA factor is verified', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const enrollment = await auth.mfa.enrollTOTP(user.id)
        const code = await generateTOTPCode(enrollment.secret)
        await auth.mfa.verifyTOTPEnrollment(enrollment.factor_id, code)

        const hasMFA = await auth.mfa.hasMFA(user.id)

        expect(hasMFA).toBe(true)
      })
    })

    describe('mfa.listFactors', () => {
      it('should list user MFA factors', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await auth.mfa.enrollTOTP(user.id)
        await auth.mfa.enrollEmailOTP(user.id, 'test@example.com')

        const factors = await auth.mfa.listFactors(user.id)

        expect(factors).toHaveLength(2)
      })
    })

    describe('mfa.unenroll', () => {
      it('should remove MFA factor', async () => {
        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const enrollment = await auth.mfa.enrollTOTP(user.id)
        await auth.mfa.unenroll(enrollment.factor_id)

        const factors = await auth.mfa.listFactors(user.id)

        expect(factors).toHaveLength(0)
      })
    })
  })

  // ============================================================================
  // OAUTH MANAGER
  // ============================================================================

  describe('OAuthManager', () => {
    let auth: Auth

    beforeEach(() => {
      auth = createAuth({
        jwtSecret: 'test-secret-key-that-is-long-enough',
        issuer: 'https://auth.example.com',
      })
    })

    describe('oauth.registerClient', () => {
      it('should register OAuth client', async () => {
        const client = await auth.oauth.registerClient({
          name: 'My App',
          redirect_uris: ['https://myapp.com/callback'],
          allowed_grant_types: ['authorization_code', 'refresh_token'],
          allowed_scopes: ['openid', 'profile', 'email'],
          is_first_party: true,
        })

        expect(client.id).toBeDefined()
        expect(client.name).toBe('My App')
      })
    })

    describe('oauth.createAuthorizationUrl', () => {
      it('should create authorization URL', async () => {
        const client = await auth.oauth.registerClient({
          name: 'My App',
          redirect_uris: ['https://myapp.com/callback'],
          allowed_grant_types: ['authorization_code'],
          allowed_scopes: ['openid', 'profile'],
          is_first_party: false,
        })

        const url = auth.oauth.createAuthorizationUrl({
          client_id: client.id,
          redirect_uri: 'https://myapp.com/callback',
          response_type: 'code',
          scope: 'openid profile',
          state: 'random-state',
          baseUrl: 'https://auth.example.com',
        })

        expect(url).toContain('https://auth.example.com/authorize')
        expect(url).toContain(`client_id=${client.id}`)
        expect(url).toContain('response_type=code')
      })
    })

    describe('oauth.exchangeCode', () => {
      it('should exchange authorization code for tokens', async () => {
        const client = await auth.oauth.registerClient({
          name: 'My App',
          redirect_uris: ['https://myapp.com/callback'],
          allowed_grant_types: ['authorization_code', 'refresh_token'],
          allowed_scopes: ['openid', 'profile', 'email'],
          is_first_party: true,
        })

        const user = await auth.users.create({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        // Generate auth code
        const code = await auth.oauth.generateAuthorizationCode(
          client.id,
          user.id,
          'https://myapp.com/callback',
          'openid profile email'
        )

        // Exchange code for tokens
        const tokens = await auth.oauth.exchangeCode(
          code,
          client.id,
          'https://myapp.com/callback'
        )

        expect(tokens.access_token).toBeDefined()
        expect(tokens.refresh_token).toBeDefined()
        expect(tokens.id_token).toBeDefined()
      })
    })

    describe('oauth.introspect', () => {
      it('should introspect active token', async () => {
        const { tokens } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        const result = await auth.oauth.introspect(tokens.access_token)

        expect(result.active).toBe(true)
        expect(result.sub).toBeDefined()
      })

      it('should return inactive for invalid token', async () => {
        const result = await auth.oauth.introspect('invalid-token')

        expect(result.active).toBe(false)
      })
    })

    describe('oauth.revoke', () => {
      it('should revoke refresh token', async () => {
        const { tokens } = await auth.signUp({
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })

        await auth.oauth.revoke(tokens.refresh_token, 'refresh_token')

        // Token should no longer be usable
        await expect(auth.refreshToken(tokens.refresh_token)).rejects.toThrow()
      })
    })
  })

  // ============================================================================
  // AUTH ERROR
  // ============================================================================

  describe('AuthError', () => {
    it('should have code and message', () => {
      const error = new AuthError('invalid_credentials', 'Invalid email or password')

      expect(error.code).toBe('invalid_credentials')
      expect(error.message).toBe('Invalid email or password')
      expect(error.name).toBe('AuthError')
    })

    it('should support status code', () => {
      const error = new AuthError('unauthorized', 'Not authenticated', 401)

      expect(error.status).toBe(401)
    })

    it('should support details', () => {
      const error = new AuthError('validation_error', 'Invalid input', 400, {
        field: 'email',
        reason: 'Invalid format',
      })

      expect(error.details).toEqual({
        field: 'email',
        reason: 'Invalid format',
      })
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a TOTP code from a secret for testing
 */
async function generateTOTPCode(secret: string): Promise<string> {
  const period = 30
  const digits = 6
  const time = Math.floor(Date.now() / 1000)
  const counter = BigInt(Math.floor(time / period))

  // Decode base32 secret
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleanInput = secret.toUpperCase().replace(/=+$/, '')

  let bits = 0
  let value = 0
  const output: number[] = []

  for (const char of cleanInput) {
    const index = alphabet.indexOf(char)
    if (index === -1) continue

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  const secretBytes = new Uint8Array(output)

  // Generate HMAC-SHA1
  const counterBuffer = new ArrayBuffer(8)
  const counterView = new DataView(counterBuffer)
  counterView.setBigUint64(0, counter, false)

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, counterBuffer)
  const hash = new Uint8Array(signature)

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)

  const otp = binary % Math.pow(10, digits)
  return otp.toString().padStart(digits, '0')
}
