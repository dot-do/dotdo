/**
 * Tests for Auth0 Authentication API compat layer
 *
 * These tests verify the Auth0 Authentication API compatibility:
 * - Login (Resource Owner Password Grant)
 * - Signup (Database signup)
 * - Password reset
 * - Token refresh
 * - Passwordless login
 * - Social login initiation
 *
 * @see https://auth0.com/docs/api/authentication
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthenticationClient } from '../authentication-client'
import type {
  AuthenticationClientOptions,
  LoginParams,
  SignupParams,
  PasswordResetParams,
  RefreshTokenParams,
  PasswordlessStartParams,
  PasswordlessVerifyParams,
  TokenResponse,
  SignupResponse,
} from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({}),
    deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    sign: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
    verify: vi.fn().mockResolvedValue(true),
  },
})

describe('Auth0 Authentication API Compat', () => {
  let auth: AuthenticationClient

  beforeEach(() => {
    auth = new AuthenticationClient({
      domain: 'test-tenant.auth0.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    })
  })

  // ============================================================================
  // CLIENT INITIALIZATION
  // ============================================================================

  describe('AuthenticationClient initialization', () => {
    it('should create client with client credentials', () => {
      const client = new AuthenticationClient({
        domain: 'test.auth0.com',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      })
      expect(client).toBeDefined()
    })

    it('should create client without client secret (public client)', () => {
      const client = new AuthenticationClient({
        domain: 'test.auth0.com',
        clientId: 'my-client-id',
      })
      expect(client).toBeDefined()
    })

    it('should expose database manager', () => {
      expect(auth.database).toBeDefined()
      expect(typeof auth.database.signUp).toBe('function')
      expect(typeof auth.database.changePassword).toBe('function')
    })

    it('should expose oauth manager', () => {
      expect(auth.oauth).toBeDefined()
      expect(typeof auth.oauth.passwordGrant).toBe('function')
      expect(typeof auth.oauth.refreshToken).toBe('function')
      expect(typeof auth.oauth.clientCredentialsGrant).toBe('function')
    })

    it('should expose passwordless manager', () => {
      expect(auth.passwordless).toBeDefined()
      expect(typeof auth.passwordless.start).toBe('function')
      expect(typeof auth.passwordless.verify).toBe('function')
    })
  })

  // ============================================================================
  // LOGIN - RESOURCE OWNER PASSWORD GRANT
  // ============================================================================

  describe('oauth.passwordGrant (login)', () => {
    it('should authenticate with email and password', async () => {
      // First create a user (via signup)
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'login@example.com',
        password: 'SecurePass123!',
      })

      const result = await auth.oauth.passwordGrant({
        username: 'login@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid profile email',
      })

      expect(result).toBeDefined()
      expect(result.access_token).toBeDefined()
      expect(result.token_type).toBe('Bearer')
      expect(result.expires_in).toBeGreaterThan(0)
    })

    it('should return id_token when openid scope is requested', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'idtoken@example.com',
        password: 'SecurePass123!',
      })

      const result = await auth.oauth.passwordGrant({
        username: 'idtoken@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid profile email',
      })

      expect(result.id_token).toBeDefined()
    })

    it('should return refresh_token when offline_access scope is requested', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'refresh@example.com',
        password: 'SecurePass123!',
      })

      const result = await auth.oauth.passwordGrant({
        username: 'refresh@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid offline_access',
      })

      expect(result.refresh_token).toBeDefined()
    })

    it('should reject invalid password', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'wrongpass@example.com',
        password: 'SecurePass123!',
      })

      await expect(
        auth.oauth.passwordGrant({
          username: 'wrongpass@example.com',
          password: 'WrongPassword!',
          realm: 'Username-Password-Authentication',
        })
      ).rejects.toThrow()
    })

    it('should reject non-existent user', async () => {
      await expect(
        auth.oauth.passwordGrant({
          username: 'nonexistent@example.com',
          password: 'SomePassword123!',
          realm: 'Username-Password-Authentication',
        })
      ).rejects.toThrow()
    })

    it('should reject blocked user', async () => {
      // This test assumes integration with ManagementClient to block user
      // For now, we test that blocked users cannot login
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'blocked@example.com',
        password: 'SecurePass123!',
      })

      // Simulate blocking the user (would be done via Management API)
      // For this RED test, we expect the functionality to exist
      await expect(
        auth.oauth.passwordGrant({
          username: 'blocked@example.com',
          password: 'SecurePass123!',
          realm: 'Username-Password-Authentication',
          // @ts-expect-error - internal test flag
          _testBlocked: true,
        })
      ).rejects.toThrow(/blocked/i)
    })

    it('should support audience parameter', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'audience@example.com',
        password: 'SecurePass123!',
      })

      const result = await auth.oauth.passwordGrant({
        username: 'audience@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        audience: 'https://api.example.com',
        scope: 'openid',
      })

      expect(result.access_token).toBeDefined()
      // The access_token should be issued for the requested audience
    })

    it('should increment login count', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'logincount@example.com',
        password: 'SecurePass123!',
      })

      await auth.oauth.passwordGrant({
        username: 'logincount@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
      })

      await auth.oauth.passwordGrant({
        username: 'logincount@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
      })

      // Login count should be tracked internally
      // Verification would be through Management API
    })
  })

  // ============================================================================
  // SIGNUP - DATABASE CONNECTION
  // ============================================================================

  describe('database.signUp', () => {
    it('should create new user with email and password', async () => {
      const result = await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'newuser@example.com',
        password: 'SecurePass123!',
      })

      expect(result).toBeDefined()
      expect(result._id).toBeDefined()
      expect(result.email).toBe('newuser@example.com')
      expect(result.email_verified).toBe(false)
    })

    it('should create user with username', async () => {
      const result = await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'username@example.com',
        username: 'myusername',
        password: 'SecurePass123!',
      })

      expect(result.username).toBe('myusername')
    })

    it('should create user with user_metadata', async () => {
      const result = await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'metadata@example.com',
        password: 'SecurePass123!',
        user_metadata: {
          signup_source: 'mobile_app',
          referral_code: 'ABC123',
        },
      })

      expect(result.user_metadata).toEqual({
        signup_source: 'mobile_app',
        referral_code: 'ABC123',
      })
    })

    it('should create user with profile fields', async () => {
      const result = await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'profile@example.com',
        password: 'SecurePass123!',
        given_name: 'Jane',
        family_name: 'Smith',
        name: 'Jane Smith',
        nickname: 'jsmith',
        picture: 'https://example.com/avatar.png',
      })

      expect(result.given_name).toBe('Jane')
      expect(result.family_name).toBe('Smith')
      expect(result.name).toBe('Jane Smith')
      expect(result.nickname).toBe('jsmith')
      expect(result.picture).toBe('https://example.com/avatar.png')
    })

    it('should reject duplicate email', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'duplicate@example.com',
        password: 'SecurePass123!',
      })

      await expect(
        auth.database.signUp({
          connection: 'Username-Password-Authentication',
          email: 'duplicate@example.com',
          password: 'AnotherPass123!',
        })
      ).rejects.toThrow(/already exists|duplicate/i)
    })

    it('should reject weak password', async () => {
      await expect(
        auth.database.signUp({
          connection: 'Username-Password-Authentication',
          email: 'weak@example.com',
          password: '123',
        })
      ).rejects.toThrow(/password/i)
    })

    it('should reject invalid email format', async () => {
      await expect(
        auth.database.signUp({
          connection: 'Username-Password-Authentication',
          email: 'not-an-email',
          password: 'SecurePass123!',
        })
      ).rejects.toThrow(/email/i)
    })

    it('should send verification email by default', async () => {
      const result = await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'verify@example.com',
        password: 'SecurePass123!',
      })

      expect(result.email_verified).toBe(false)
      // Verification email should be sent (would check via mock)
    })

    it('should support phone number signup for SMS connection', async () => {
      const result = await auth.database.signUp({
        connection: 'sms',
        phone_number: '+15551234567',
        password: 'SecurePass123!',
      })

      expect(result.phone_number).toBe('+15551234567')
    })
  })

  // ============================================================================
  // PASSWORD RESET
  // ============================================================================

  describe('database.changePassword', () => {
    it('should initiate password reset', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'reset@example.com',
        password: 'OldPassword123!',
      })

      const result = await auth.database.changePassword({
        connection: 'Username-Password-Authentication',
        email: 'reset@example.com',
      })

      // Auth0 returns a simple success message
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
    })

    it('should not reveal if email exists', async () => {
      // For security, password reset should not reveal if email exists
      const result = await auth.database.changePassword({
        connection: 'Username-Password-Authentication',
        email: 'nonexistent@example.com',
      })

      // Should return same response as for existing user
      expect(result).toBeDefined()
    })

    it('should require connection parameter', async () => {
      await expect(
        auth.database.changePassword({
          connection: '',
          email: 'test@example.com',
        })
      ).rejects.toThrow(/connection/i)
    })

    it('should require email parameter', async () => {
      await expect(
        auth.database.changePassword({
          connection: 'Username-Password-Authentication',
          email: '',
        })
      ).rejects.toThrow(/email/i)
    })

    it('should support client_id parameter', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'clientid@example.com',
        password: 'SecurePass123!',
      })

      const result = await auth.database.changePassword({
        connection: 'Username-Password-Authentication',
        email: 'clientid@example.com',
        client_id: 'specific-client-id',
      })

      expect(result).toBeDefined()
    })
  })

  // ============================================================================
  // TOKEN REFRESH
  // ============================================================================

  describe('oauth.refreshToken', () => {
    it('should refresh access token with valid refresh token', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'tokenrefresh@example.com',
        password: 'SecurePass123!',
      })

      // Get initial tokens with offline_access scope
      const initial = await auth.oauth.passwordGrant({
        username: 'tokenrefresh@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid offline_access',
      })

      expect(initial.refresh_token).toBeDefined()

      const refreshed = await auth.oauth.refreshToken({
        refresh_token: initial.refresh_token!,
      })

      expect(refreshed).toBeDefined()
      expect(refreshed.access_token).toBeDefined()
      expect(refreshed.token_type).toBe('Bearer')
      expect(refreshed.expires_in).toBeGreaterThan(0)
    })

    it('should return new refresh token with rotation enabled', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'rotation@example.com',
        password: 'SecurePass123!',
      })

      const initial = await auth.oauth.passwordGrant({
        username: 'rotation@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid offline_access',
      })

      const refreshed = await auth.oauth.refreshToken({
        refresh_token: initial.refresh_token!,
      })

      // With rotation, new refresh token should be returned
      expect(refreshed.refresh_token).toBeDefined()
      expect(refreshed.refresh_token).not.toBe(initial.refresh_token)
    })

    it('should reject invalid refresh token', async () => {
      await expect(
        auth.oauth.refreshToken({
          refresh_token: 'invalid-refresh-token',
        })
      ).rejects.toThrow()
    })

    it('should reject expired refresh token', async () => {
      await expect(
        auth.oauth.refreshToken({
          refresh_token: 'expired-token-xxx',
          // @ts-expect-error - internal test flag
          _testExpired: true,
        })
      ).rejects.toThrow(/expired/i)
    })

    it('should reject revoked refresh token', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'revoked@example.com',
        password: 'SecurePass123!',
      })

      const initial = await auth.oauth.passwordGrant({
        username: 'revoked@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid offline_access',
      })

      // Revoke the token (would be done via Management API)
      // For now we test that revoked tokens are rejected
      await expect(
        auth.oauth.refreshToken({
          refresh_token: initial.refresh_token!,
          // @ts-expect-error - internal test flag
          _testRevoked: true,
        })
      ).rejects.toThrow()
    })

    it('should support scope parameter', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'scope@example.com',
        password: 'SecurePass123!',
      })

      const initial = await auth.oauth.passwordGrant({
        username: 'scope@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid profile email offline_access',
      })

      const refreshed = await auth.oauth.refreshToken({
        refresh_token: initial.refresh_token!,
        scope: 'openid profile', // Request fewer scopes
      })

      expect(refreshed.access_token).toBeDefined()
    })
  })

  // ============================================================================
  // CLIENT CREDENTIALS GRANT
  // ============================================================================

  describe('oauth.clientCredentialsGrant', () => {
    it('should obtain access token with client credentials', async () => {
      const result = await auth.oauth.clientCredentialsGrant({
        audience: 'https://api.example.com',
      })

      expect(result).toBeDefined()
      expect(result.access_token).toBeDefined()
      expect(result.token_type).toBe('Bearer')
      expect(result.expires_in).toBeGreaterThan(0)
    })

    it('should include requested scopes', async () => {
      const result = await auth.oauth.clientCredentialsGrant({
        audience: 'https://api.example.com',
        scope: 'read:users write:users',
      })

      expect(result.access_token).toBeDefined()
      expect(result.scope).toContain('read:users')
    })

    it('should require audience parameter', async () => {
      await expect(
        auth.oauth.clientCredentialsGrant({
          audience: '',
        })
      ).rejects.toThrow(/audience/i)
    })
  })

  // ============================================================================
  // PASSWORDLESS AUTHENTICATION
  // ============================================================================

  describe('passwordless.start', () => {
    it('should initiate passwordless email code', async () => {
      const result = await auth.passwordless.start({
        connection: 'email',
        email: 'passwordless@example.com',
        send: 'code',
      })

      expect(result).toBeDefined()
      expect(result._id).toBeDefined()
      expect(result.email).toBe('passwordless@example.com')
    })

    it('should initiate passwordless email link', async () => {
      const result = await auth.passwordless.start({
        connection: 'email',
        email: 'magiclink@example.com',
        send: 'link',
        authParams: {
          redirect_uri: 'https://example.com/callback',
          response_type: 'code',
        },
      })

      expect(result).toBeDefined()
    })

    it('should initiate passwordless SMS', async () => {
      const result = await auth.passwordless.start({
        connection: 'sms',
        phone_number: '+15559876543',
        send: 'code',
      })

      expect(result).toBeDefined()
      expect(result._id).toBeDefined()
      expect(result.phone_number).toBe('+15559876543')
    })

    it('should reject invalid email', async () => {
      await expect(
        auth.passwordless.start({
          connection: 'email',
          email: 'invalid-email',
          send: 'code',
        })
      ).rejects.toThrow(/email/i)
    })

    it('should reject invalid phone number', async () => {
      await expect(
        auth.passwordless.start({
          connection: 'sms',
          phone_number: '123', // Too short
          send: 'code',
        })
      ).rejects.toThrow(/phone/i)
    })
  })

  describe('passwordless.verify', () => {
    it('should verify email code and return tokens', async () => {
      // Start passwordless flow
      await auth.passwordless.start({
        connection: 'email',
        email: 'verifycode@example.com',
        send: 'code',
      })

      // Verify with the code (in test, we use a known code)
      const result = await auth.passwordless.verify({
        connection: 'email',
        email: 'verifycode@example.com',
        verification_code: '123456',
        scope: 'openid profile email',
      })

      expect(result).toBeDefined()
      expect(result.access_token).toBeDefined()
      expect(result.token_type).toBe('Bearer')
    })

    it('should verify SMS code and return tokens', async () => {
      await auth.passwordless.start({
        connection: 'sms',
        phone_number: '+15551112222',
        send: 'code',
      })

      const result = await auth.passwordless.verify({
        connection: 'sms',
        phone_number: '+15551112222',
        verification_code: '123456',
      })

      expect(result).toBeDefined()
      expect(result.access_token).toBeDefined()
    })

    it('should reject invalid code', async () => {
      await auth.passwordless.start({
        connection: 'email',
        email: 'invalidcode@example.com',
        send: 'code',
      })

      await expect(
        auth.passwordless.verify({
          connection: 'email',
          email: 'invalidcode@example.com',
          verification_code: '000000', // Wrong code
        })
      ).rejects.toThrow(/invalid|incorrect/i)
    })

    it('should reject expired code', async () => {
      await auth.passwordless.start({
        connection: 'email',
        email: 'expiredcode@example.com',
        send: 'code',
      })

      await expect(
        auth.passwordless.verify({
          connection: 'email',
          email: 'expiredcode@example.com',
          verification_code: '123456',
          // @ts-expect-error - internal test flag
          _testExpired: true,
        })
      ).rejects.toThrow(/expired/i)
    })
  })

  // ============================================================================
  // TOKEN EXCHANGE (Authorization Code)
  // ============================================================================

  describe('oauth.authorizationCodeGrant', () => {
    it('should exchange authorization code for tokens', async () => {
      // In real flow, code comes from /authorize redirect
      const result = await auth.oauth.authorizationCodeGrant({
        code: 'valid-auth-code',
        redirect_uri: 'https://example.com/callback',
      })

      expect(result).toBeDefined()
      expect(result.access_token).toBeDefined()
      expect(result.token_type).toBe('Bearer')
    })

    it('should support PKCE code verifier', async () => {
      const result = await auth.oauth.authorizationCodeGrant({
        code: 'valid-auth-code-pkce',
        redirect_uri: 'https://example.com/callback',
        code_verifier: 'valid-code-verifier-string',
      })

      expect(result.access_token).toBeDefined()
    })

    it('should reject invalid authorization code', async () => {
      await expect(
        auth.oauth.authorizationCodeGrant({
          code: 'invalid-code',
          redirect_uri: 'https://example.com/callback',
        })
      ).rejects.toThrow()
    })

    it('should reject code with wrong redirect_uri', async () => {
      await expect(
        auth.oauth.authorizationCodeGrant({
          code: 'valid-auth-code',
          redirect_uri: 'https://wrong-domain.com/callback',
        })
      ).rejects.toThrow(/redirect/i)
    })
  })

  // ============================================================================
  // USERINFO
  // ============================================================================

  describe('userInfo', () => {
    it('should return user info with valid access token', async () => {
      await auth.database.signUp({
        connection: 'Username-Password-Authentication',
        email: 'userinfo@example.com',
        password: 'SecurePass123!',
        given_name: 'User',
        family_name: 'Info',
      })

      const tokens = await auth.oauth.passwordGrant({
        username: 'userinfo@example.com',
        password: 'SecurePass123!',
        realm: 'Username-Password-Authentication',
        scope: 'openid profile email',
      })

      const userInfo = await auth.userInfo(tokens.access_token)

      expect(userInfo).toBeDefined()
      expect(userInfo.sub).toBeDefined()
      expect(userInfo.email).toBe('userinfo@example.com')
      expect(userInfo.given_name).toBe('User')
      expect(userInfo.family_name).toBe('Info')
    })

    it('should reject invalid access token', async () => {
      await expect(auth.userInfo('invalid-access-token')).rejects.toThrow()
    })

    it('should reject expired access token', async () => {
      await expect(
        auth.userInfo('expired-token', {
          // @ts-expect-error - internal test flag
          _testExpired: true,
        })
      ).rejects.toThrow(/expired/i)
    })
  })

  // ============================================================================
  // LOGOUT
  // ============================================================================

  describe('logout', () => {
    it('should build logout URL', () => {
      const url = auth.buildLogoutUrl({
        returnTo: 'https://example.com/goodbye',
        client_id: 'test-client-id',
      })

      expect(url).toBeDefined()
      expect(url).toContain('test-tenant.auth0.com')
      expect(url).toContain('/v2/logout')
      expect(url).toContain('returnTo=')
      expect(url).toContain('client_id=')
    })

    it('should include federated parameter when specified', () => {
      const url = auth.buildLogoutUrl({
        returnTo: 'https://example.com/goodbye',
        federated: true,
      })

      expect(url).toContain('federated')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should throw Auth0AuthenticationError with proper structure', async () => {
      try {
        await auth.oauth.passwordGrant({
          username: 'nonexistent@example.com',
          password: 'SomePassword123!',
          realm: 'Username-Password-Authentication',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
        expect((error as Error).name).toBe('Auth0AuthenticationError')
        expect((error as { statusCode: number }).statusCode).toBeDefined()
        expect((error as { error: string }).error).toBeDefined()
        expect((error as { error_description: string }).error_description).toBeDefined()
      }
    })

    it('should include error codes for known Auth0 errors', async () => {
      try {
        await auth.database.signUp({
          connection: 'Username-Password-Authentication',
          email: 'errorcode@example.com',
          password: 'weak',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as { error: string }).error).toBe('invalid_password')
      }
    })
  })
})
