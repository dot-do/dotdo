/**
 * Auth0 Authentication API Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { AuthenticationClient, createAuthenticationClient, Auth0APIError } from '../index'

describe('Auth0 Authentication API', () => {
  let auth: AuthenticationClient

  beforeEach(() => {
    auth = createAuthenticationClient({
      domain: 'test.auth0.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      jwtSecret: 'test-jwt-secret-at-least-32-characters',
    })
  })

  describe('database', () => {
    it('should sign up a user', async () => {
      const result = await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'signup@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      expect(result).toBeDefined()
      expect(result.user_id).toBeDefined()
      expect(result.email).toBe('signup@example.com')
    })

    it('should sign up with username', async () => {
      const result = await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'signup2@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
        username: 'testuser',
      })

      // Username is stored in the user but may not be returned in signUp response
      expect(result).toBeDefined()
      expect(result.email).toBe('signup2@example.com')
    })

    it('should sign up with metadata', async () => {
      const result = await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'signup-meta@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
        user_metadata: { onboarded: false },
      })

      expect(result.user_metadata).toEqual({ onboarded: false })
    })

    it('should change password', async () => {
      // Create user first via signup
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'change-password@example.com',
        password: 'OldPassword123!',
        connection: 'Username-Password-Authentication',
      })

      const result = await auth.database.changePassword({
        client_id: 'test-client-id',
        email: 'change-password@example.com',
        connection: 'Username-Password-Authentication',
      })

      // Message format may vary
      expect(result).toContain('password')
    })
  })

  describe('oauth', () => {
    it('should get token with password grant', async () => {
      // Create user first via signup
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'oauth@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const tokens = await auth.oauth.token({
        grant_type: 'password',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        username: 'oauth@example.com',
        password: 'Test123!@#',
      })

      expect(tokens).toBeDefined()
      expect(tokens.access_token).toBeDefined()
      expect(tokens.id_token).toBeDefined()
      expect(tokens.token_type).toBe('Bearer')
      expect(tokens.expires_in).toBeDefined()
    })

    it('should get token with client credentials', async () => {
      const tokens = await auth.oauth.token({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        audience: 'https://api.example.com',
      })

      expect(tokens).toBeDefined()
      expect(tokens.access_token).toBeDefined()
      expect(tokens.token_type).toBe('Bearer')
    })

    it('should get token with refresh token', async () => {
      // Create user via signup
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'refresh@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const initial = await auth.oauth.token({
        grant_type: 'password',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        username: 'refresh@example.com',
        password: 'Test123!@#',
        scope: 'offline_access',
      })

      // Use refresh token
      const refreshed = await auth.oauth.token({
        grant_type: 'refresh_token',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        refresh_token: initial.refresh_token!,
      })

      expect(refreshed).toBeDefined()
      expect(refreshed.access_token).toBeDefined()
      expect(refreshed.access_token).not.toBe(initial.access_token)
    })

    it('should fail with invalid credentials', async () => {
      await expect(
        auth.oauth.token({
          grant_type: 'password',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          username: 'nonexistent@example.com',
          password: 'WrongPassword',
        })
      ).rejects.toThrow(Auth0APIError)
    })

    it('should revoke token', async () => {
      // Create user via signup
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'revoke@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const tokens = await auth.oauth.token({
        grant_type: 'password',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        username: 'revoke@example.com',
        password: 'Test123!@#',
        scope: 'offline_access',
      })

      // Revoke refresh token
      await auth.oauth.revoke({
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        token: tokens.refresh_token!,
      })

      // Refresh should fail
      await expect(
        auth.oauth.token({
          grant_type: 'refresh_token',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          refresh_token: tokens.refresh_token!,
        })
      ).rejects.toThrow(Auth0APIError)
    })

    it('should get authorization URL', () => {
      const url = auth.oauth.authorizationUrl({
        client_id: 'test-client-id',
        redirect_uri: 'https://app.example.com/callback',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'random-state',
      })

      expect(url).toContain('https://test.auth0.com/authorize')
      expect(url).toContain('client_id=test-client-id')
      expect(url).toContain('redirect_uri=')
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
      expect(url).toContain('state=random-state')
    })

    it('should get user info', async () => {
      // Create user via signup
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'userinfo@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const tokens = await auth.oauth.token({
        grant_type: 'password',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        username: 'userinfo@example.com',
        password: 'Test123!@#',
        scope: 'openid profile email',
      })

      const userInfo = await auth.oauth.userInfo(tokens.access_token)

      expect(userInfo).toBeDefined()
      expect(userInfo.sub).toBeDefined()
      expect(userInfo.email).toBe('userinfo@example.com')
    })
  })

  describe('passwordless', () => {
    it('should start passwordless email flow', async () => {
      const result = await auth.passwordless.start({
        client_id: 'test-client-id',
        connection: 'email',
        email: 'passwordless@example.com',
        send: 'code',
      })

      expect(result).toBeDefined()
      expect(result._id).toBeDefined()
      expect(result.email).toBe('passwordless@example.com')
    })

    it('should start passwordless SMS flow', async () => {
      const result = await auth.passwordless.start({
        client_id: 'test-client-id',
        connection: 'sms',
        phone_number: '+15551234567',
        send: 'code',
      })

      expect(result).toBeDefined()
      expect(result._id).toBeDefined()
      expect(result.phone_number).toBe('+15551234567')
    })
  })

  describe('mfa', () => {
    it('should associate TOTP authenticator', async () => {
      // Create user via signup
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'mfa@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const tokens = await auth.oauth.token({
        grant_type: 'password',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        username: 'mfa@example.com',
        password: 'Test123!@#',
      })

      const enrollment = await auth.mfa.associate({
        client_id: 'test-client-id',
        access_token: tokens.access_token,
        authenticator_types: ['otp'],
      })

      expect(enrollment).toBeDefined()
      expect(enrollment.authenticator_type).toBe('otp')
      expect(enrollment.secret).toBeDefined()
      expect(enrollment.barcode_uri).toBeDefined()
      expect(enrollment.barcode_uri).toContain('otpauth://totp/')
    })

    it('should challenge MFA after confirming enrollment', async () => {
      // Create user and get initial token
      await auth.database.signUp({
        client_id: 'test-client-id',
        email: 'mfa-challenge@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const tokens = await auth.oauth.token({
        grant_type: 'password',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        username: 'mfa-challenge@example.com',
        password: 'Test123!@#',
      })

      // Enroll TOTP - get the factor_id and secret
      const enrollment = await auth.mfa.associate({
        client_id: 'test-client-id',
        access_token: tokens.access_token,
        authenticator_types: ['otp'],
      })

      expect(enrollment.factor_id).toBeDefined()
      expect(enrollment.secret).toBeDefined()

      // Generate a valid TOTP code using the secret
      // Using the same algorithm as the MFA manager
      const generateTOTP = async (secret: string): Promise<string> => {
        const time = Math.floor(Date.now() / 1000)
        const counter = BigInt(Math.floor(time / 30))

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

        // Generate HOTP
        const counterBuffer = new ArrayBuffer(8)
        const counterView = new DataView(counterBuffer)
        counterView.setBigUint64(0, counter, false)

        const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
        const signature = await crypto.subtle.sign('HMAC', key, counterBuffer)
        const hash = new Uint8Array(signature)

        const offset = hash[hash.length - 1] & 0x0f
        const binary =
          ((hash[offset] & 0x7f) << 24) |
          ((hash[offset + 1] & 0xff) << 16) |
          ((hash[offset + 2] & 0xff) << 8) |
          (hash[offset + 3] & 0xff)

        const otp = binary % 1000000
        return otp.toString().padStart(6, '0')
      }

      const otpCode = await generateTOTP(enrollment.secret)

      // Confirm the enrollment with the OTP code
      const confirmResult = await auth.mfa.confirmAssociation({
        client_id: 'test-client-id',
        access_token: tokens.access_token,
        factor_id: enrollment.factor_id,
        otp: otpCode,
      })

      expect(confirmResult.status).toBe('verified')

      // Now we can challenge MFA
      const challenge = await auth.mfa.challenge({
        client_id: 'test-client-id',
        mfa_token: tokens.access_token,
        challenge_type: 'otp',
      })

      expect(challenge).toBeDefined()
      expect(challenge.challenge_type).toBe('otp')
    })
  })
})
