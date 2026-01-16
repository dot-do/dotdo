import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createCapabilityToken, CapabilityPayload } from '../../rpc/capability-token'

/**
 * Capability Verification Security Tests
 *
 * SECURITY ISSUE (do-zy3f): The capability verification was bypassed when capabilitySecret
 * is null, returning wildcard admin access. This is a critical security vulnerability.
 *
 * Fix: When a capability token IS provided but no secret is configured:
 * - MUST throw an error - cannot verify without a secret
 * - The old behavior of returning wildcard admin access is INSECURE
 *
 * The fix distinguishes between:
 * 1. No token provided (capability === undefined) - OK in dev, method is callable
 * 2. Token provided but no secret - MUST FAIL, cannot verify
 */

// Helper to get a fresh DOCore instance
function getCore(name = 'security-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// Test secret for capability verification
const TEST_SECRET = 'test-capability-secret-32-bytes!'

// Helper to create a test capability token
async function createTestCapability(
  options: Partial<CapabilityPayload> = {}
): Promise<string> {
  const payload: CapabilityPayload = {
    target: options.target ?? '*',
    methods: options.methods ?? ['*'],
    scope: options.scope ?? 'admin',
    exp: options.exp ?? Date.now() + 3600000, // 1 hour from now
    sub: options.sub ?? 'test-user',
  }
  return createCapabilityToken(payload, TEST_SECRET)
}

describe('Capability Verification Security', () => {
  describe('Production environment protection', () => {
    it('should reject capability token when secret is not configured', async () => {
      const core = getCore('security-production-reject-1')

      // SECURITY: When a capability token is provided but no secret is configured,
      // verification MUST fail. We cannot verify the token's authenticity.
      const fakeToken = 'some.fake.token'

      // This MUST throw - providing a token without a secret to verify it is an error
      await expect(core.rpcCall('ping', [], fakeToken)).rejects.toThrow(
        /capability secret.*required/i
      )
    })

    it('should reject valid-looking tokens when secret is not configured', async () => {
      const core = getCore('security-production-valid-looking-1')

      // Even a "valid" token created with some secret cannot be verified
      // if the DO doesn't have a secret configured
      const validToken = await createTestCapability({ methods: ['ping'] })

      await expect(core.rpcCall('ping', [], validToken)).rejects.toThrow(
        /capability secret.*required/i
      )
    })
  })

  describe('Allowed operation modes', () => {
    it('should allow rpcCall WITHOUT capability token (dev/testing mode)', async () => {
      const core = getCore('security-no-token-1')

      // When NO capability token is provided, rpcCall should work
      // This is the development/testing mode where capability verification is skipped
      const result = await core.rpcCall('ping', [])
      expect(result).toBe('pong')
    })

    it('should work with valid capability when secret is properly set', async () => {
      const core = getCore('security-valid-cap-1')

      // Set the capability secret first
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create a valid capability
      const capability = await createTestCapability({
        methods: ['ping', 'add'],
        scope: 'read',
      })

      // Should succeed with valid capability and matching secret
      const result = await core.rpcCall('ping', [], capability)
      expect(result).toBe('pong')
    })

    it('should reject invalid tokens when secret IS configured', async () => {
      const core = getCore('security-invalid-with-secret-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Invalid token should be rejected
      const invalidToken = 'invalid.token.here'
      await expect(core.rpcCall('ping', [], invalidToken)).rejects.toThrow()
    })
  })

  describe('No implicit admin access', () => {
    it('should never grant wildcard admin access to unverified tokens', async () => {
      const core = getCore('security-no-wildcard-1')

      // The old code returned { target: '*', methods: ['*'], scope: 'admin' }
      // when secret was null but token was provided. This is WRONG.
      const maliciousToken = 'attacker.crafted.token'

      // Must reject - attacker cannot get admin access just by providing any token
      await expect(core.rpcCall('ping', [], maliciousToken)).rejects.toThrow()
    })

    it('should reject tampered capability tokens', async () => {
      const core = getCore('security-tampered-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create a valid token then tamper with it
      const validToken = await createTestCapability({ methods: ['ping'] })
      const tamperedToken = validToken.slice(0, -5) + 'XXXXX'

      await expect(core.rpcCall('ping', [], tamperedToken)).rejects.toThrow()
    })

    it('should reject capabilities signed with wrong secret', async () => {
      const core = getCore('security-wrong-secret-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create a token with a different secret
      const wrongSecretToken = await createCapabilityToken(
        {
          target: '*',
          methods: ['ping'],
          scope: 'admin',
          exp: Date.now() + 3600000,
        },
        'wrong-secret-completely-different!'
      )

      await expect(core.rpcCall('ping', [], wrongSecretToken)).rejects.toThrow()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string token as invalid', async () => {
      const core = getCore('security-empty-token-1')

      // Empty string is a provided token, must be rejected
      await expect(core.rpcCall('ping', [], '')).rejects.toThrow()
    })

    it('should handle malformed JWT-like tokens', async () => {
      const core = getCore('security-malformed-1')

      // Set secret to enable verification
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Various malformed token formats
      await expect(core.rpcCall('ping', [], 'not.a.valid.jwt.token')).rejects.toThrow()
      await expect(core.rpcCall('ping', [], '..')).rejects.toThrow()
      await expect(core.rpcCall('ping', [], 'singlepart')).rejects.toThrow()
    })
  })
})
