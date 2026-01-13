import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'

/**
 * JWT Storage Claims Extraction Tests
 *
 * These tests verify the extraction of storage-related claims from oauth.do JWTs.
 * They are expected to FAIL until lib/auth/jwt-storage-claims.ts is implemented.
 *
 * Implementation requirements:
 * - Create lib/auth/jwt-storage-claims.ts with extractStorageClaims()
 * - Extract org_id, tenant_id from JWT claims
 * - Extract storage.bucket and storage.path_prefix from nested claims
 * - Validate required claims (org_id)
 * - Handle JWT expiration and invalid signature errors
 *
 * JWT structure from oauth.do:
 * {
 *   sub: string,
 *   org_id: string,        // Required - organization identifier
 *   tenant_id?: string,    // Optional - tenant identifier
 *   storage?: {
 *     bucket?: string,     // R2 bucket name
 *     path_prefix?: string // Storage path prefix
 *   },
 *   iat: number,
 *   exp: number
 * }
 */

// Import the module under test (will fail until implemented)
import { extractStorageClaims } from '../jwt-storage-claims'

// ============================================================================
// Test Helpers
// ============================================================================

// Test secret for signing JWTs
const TEST_SECRET = new TextEncoder().encode('test-secret-key-for-jwt-signing-32bytes!')

/**
 * Create a test JWT with the given payload claims
 */
async function createTestJwt(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({
    sub: 'user_123',
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(TEST_SECRET)
}

/**
 * Create an expired test JWT
 */
async function createExpiredJwt(): Promise<string> {
  return new SignJWT({
    sub: 'user_123',
    org_id: 'org_expired',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago (expired)
    .sign(TEST_SECRET)
}

// ============================================================================
// extractStorageClaims() Tests
// ============================================================================

describe('JwtStorageClaims', () => {
  describe('org_id extraction', () => {
    it('should extract org_id from JWT', async () => {
      const jwt = await createTestJwt({ org_id: 'org_123' })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.orgId).toBe('org_123')
    })

    it('should extract org_id with prefix variations', async () => {
      const jwt = await createTestJwt({ org_id: 'organization_acme_corp' })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.orgId).toBe('organization_acme_corp')
    })
  })

  describe('tenant_id extraction', () => {
    it('should extract tenant_id from JWT', async () => {
      const jwt = await createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.tenantId).toBe('tenant_456')
    })

    it('should return undefined for missing tenant_id', async () => {
      const jwt = await createTestJwt({ org_id: 'org_123' })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.tenantId).toBeUndefined()
    })
  })

  describe('storage.bucket extraction', () => {
    it('should extract storage bucket from JWT', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { bucket: 'dotdo-prod' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBe('dotdo-prod')
    })

    it('should return undefined for missing storage bucket', async () => {
      const jwt = await createTestJwt({ org_id: 'org_123' })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBeUndefined()
    })

    it('should handle storage object without bucket', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: '/v1' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBeUndefined()
    })
  })

  describe('storage.path_prefix extraction', () => {
    it('should extract storage path_prefix from JWT', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: '/v1' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBe('/v1')
    })

    it('should extract path_prefix with nested paths', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: '/api/v2/data' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBe('/api/v2/data')
    })

    it('should return undefined for missing path_prefix', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { bucket: 'dotdo-prod' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBeUndefined()
    })
  })

  describe('full storage claims extraction', () => {
    it('should extract all storage claims together', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        tenant_id: 'tenant_456',
        storage: {
          bucket: 'dotdo-prod',
          path_prefix: '/v1',
        },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)

      expect(claims.orgId).toBe('org_123')
      expect(claims.tenantId).toBe('tenant_456')
      expect(claims.bucket).toBe('dotdo-prod')
      expect(claims.pathPrefix).toBe('/v1')
    })
  })

  describe('error handling - missing required claims', () => {
    it('should throw on missing org_id', async () => {
      const jwt = await createTestJwt({})
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Missing org_id')
    })

    it('should throw on empty org_id', async () => {
      const jwt = await createTestJwt({ org_id: '' })
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Missing org_id')
    })

    it('should throw on null org_id', async () => {
      const jwt = await createTestJwt({ org_id: null })
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Missing org_id')
    })
  })

  describe('error handling - JWT validation', () => {
    it('should throw on expired JWT', async () => {
      const jwt = await createExpiredJwt()
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('JWT expired')
    })

    it('should throw on invalid JWT signature', async () => {
      const jwt = 'invalid.jwt.token'
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Invalid JWT')
    })

    it('should throw on malformed JWT', async () => {
      const jwt = 'not-a-jwt-at-all'
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Invalid JWT')
    })

    it('should throw on JWT with wrong signature', async () => {
      // Create JWT with a different secret
      const wrongSecret = new TextEncoder().encode('wrong-secret-key-for-testing-32bytes!!')
      const jwt = await new SignJWT({ sub: 'user_123', org_id: 'org_123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(wrongSecret)

      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Invalid JWT')
    })

    it('should throw on empty JWT string', async () => {
      await expect(extractStorageClaims('', TEST_SECRET)).rejects.toThrow('Invalid JWT')
    })
  })

  describe('subject (sub) claim extraction', () => {
    it('should extract subject from JWT', async () => {
      const jwt = await createTestJwt({ org_id: 'org_123' })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.subject).toBe('user_123')
    })

    it('should extract custom subject', async () => {
      const jwt = await new SignJWT({ org_id: 'org_123' })
        .setSubject('custom_user_456')
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(TEST_SECRET)

      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.subject).toBe('custom_user_456')
    })
  })
})

// ============================================================================
// StorageClaims Interface Tests
// ============================================================================

describe('StorageClaims interface', () => {
  it('should return StorageClaims type with correct shape', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      tenant_id: 'tenant_456',
      storage: {
        bucket: 'dotdo-prod',
        path_prefix: '/v1',
      },
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)

    // Type assertions - verifying the shape of the returned object
    expect(claims).toHaveProperty('orgId')
    expect(claims).toHaveProperty('subject')
    expect(typeof claims.orgId).toBe('string')
    expect(typeof claims.subject).toBe('string')

    // Optional properties should be string or undefined
    if (claims.tenantId !== undefined) {
      expect(typeof claims.tenantId).toBe('string')
    }
    if (claims.bucket !== undefined) {
      expect(typeof claims.bucket).toBe('string')
    }
    if (claims.pathPrefix !== undefined) {
      expect(typeof claims.pathPrefix).toBe('string')
    }
  })
})
