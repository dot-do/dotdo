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

// ============================================================================
// Storage Permission Claims Tests
// ============================================================================

describe('Storage permission claims', () => {
  describe('bucket access permissions', () => {
    it('should extract bucket for read access', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { bucket: 'read-bucket' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBe('read-bucket')
    })

    it('should handle bucket names with special characters', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { bucket: 'dotdo-prod-us-west-2' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBe('dotdo-prod-us-west-2')
    })

    it('should handle bucket names with numbers', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { bucket: 'bucket123' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBe('bucket123')
    })
  })

  describe('path prefix permissions', () => {
    it('should extract path prefix for scoped access', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: '/users/user_123/' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBe('/users/user_123/')
    })

    it('should handle deeply nested path prefixes', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: '/org/123/tenant/456/data/assets/' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBe('/org/123/tenant/456/data/assets/')
    })

    it('should handle path prefix without leading slash', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: 'data/files' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBe('data/files')
    })

    it('should handle root path prefix', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: { path_prefix: '/' },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.pathPrefix).toBe('/')
    })
  })

  describe('combined bucket and path permissions', () => {
    it('should extract both bucket and path prefix for scoped access', async () => {
      const jwt = await createTestJwt({
        org_id: 'org_123',
        storage: {
          bucket: 'dotdo-assets',
          path_prefix: '/org_123/uploads/',
        },
      })
      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.bucket).toBe('dotdo-assets')
      expect(claims.pathPrefix).toBe('/org_123/uploads/')
    })
  })
})

// ============================================================================
// Custom Claims Tests
// ============================================================================

describe('Custom claims handling', () => {
  it('should ignore unknown top-level claims', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      custom_claim: 'custom_value',
      another_claim: { nested: true },
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
    // Custom claims should not appear in the result
    expect(claims).not.toHaveProperty('custom_claim')
    expect(claims).not.toHaveProperty('another_claim')
  })

  it('should ignore unknown storage claims', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      storage: {
        bucket: 'dotdo-prod',
        path_prefix: '/v1',
        unknown_field: 'should_be_ignored',
        permissions: ['read', 'write'],
      },
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.bucket).toBe('dotdo-prod')
    expect(claims.pathPrefix).toBe('/v1')
    expect(claims).not.toHaveProperty('unknown_field')
    expect(claims).not.toHaveProperty('permissions')
  })

  it('should handle JWT with standard claims (iss, aud, jti)', async () => {
    const jwt = await new SignJWT({
      org_id: 'org_123',
      iss: 'https://oauth.dotdo.dev',
      aud: 'dotdo-api',
      jti: 'unique-token-id',
    })
      .setSubject('user_123')
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(TEST_SECRET)

    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
    expect(claims.subject).toBe('user_123')
    // Standard claims should not pollute the result
    expect(claims).not.toHaveProperty('iss')
    expect(claims).not.toHaveProperty('aud')
    expect(claims).not.toHaveProperty('jti')
  })

  it('should handle non-string storage values gracefully', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      storage: {
        bucket: 123, // Invalid type - should be string
        path_prefix: true, // Invalid type
      },
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    // Implementation may coerce or return as-is
    expect(claims.orgId).toBe('org_123')
  })
})

// ============================================================================
// Claim Validation Tests
// ============================================================================

describe('Claim validation', () => {
  describe('org_id validation', () => {
    it('should accept org_id with various valid formats', async () => {
      const validOrgIds = [
        'org_123',
        'organization_acme',
        'ORG_UPPERCASE',
        'org-with-dashes',
        'org.with.dots',
        '12345',
        'a',
      ]

      for (const orgId of validOrgIds) {
        const jwt = await createTestJwt({ org_id: orgId })
        const claims = await extractStorageClaims(jwt, TEST_SECRET)
        expect(claims.orgId).toBe(orgId)
      }
    })

    it('should reject undefined org_id', async () => {
      const jwt = await createTestJwt({ org_id: undefined })
      await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('Missing org_id')
    })
  })

  describe('subject validation', () => {
    it('should handle missing subject gracefully', async () => {
      const jwt = await new SignJWT({ org_id: 'org_123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(TEST_SECRET)

      const claims = await extractStorageClaims(jwt, TEST_SECRET)
      expect(claims.orgId).toBe('org_123')
      expect(claims.subject).toBeUndefined()
    })

    it('should accept various subject formats', async () => {
      const subjects = [
        'user_123',
        'service_account_api',
        'machine_client',
        'email@example.com',
        'uuid-1234-5678',
      ]

      for (const sub of subjects) {
        const jwt = await new SignJWT({ org_id: 'org_123' })
          .setSubject(sub)
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(TEST_SECRET)

        const claims = await extractStorageClaims(jwt, TEST_SECRET)
        expect(claims.subject).toBe(sub)
      }
    })
  })

  describe('tenant_id validation', () => {
    it('should accept various tenant_id formats', async () => {
      const tenantIds = ['tenant_123', 'TENANT_UPPER', 'tenant-with-dashes', 'tenant.with.dots']

      for (const tenantId of tenantIds) {
        const jwt = await createTestJwt({ org_id: 'org_123', tenant_id: tenantId })
        const claims = await extractStorageClaims(jwt, TEST_SECRET)
        expect(claims.tenantId).toBe(tenantId)
      }
    })
  })
})

// ============================================================================
// Expiration Handling Tests
// ============================================================================

describe('Expiration handling', () => {
  it('should reject expired JWT with clear error message', async () => {
    const jwt = await createExpiredJwt()
    await expect(extractStorageClaims(jwt, TEST_SECRET)).rejects.toThrow('JWT expired')
  })

  it('should accept JWT that expires far in the future', async () => {
    const jwt = await new SignJWT({ org_id: 'org_123' })
      .setSubject('user_123')
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('365d') // 1 year from now
      .sign(TEST_SECRET)

    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
  })

  it('should accept JWT that expires in 1 second', async () => {
    const jwt = await new SignJWT({ org_id: 'org_123' })
      .setSubject('user_123')
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10s') // Expires soon but still valid
      .sign(TEST_SECRET)

    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
  })

  it('should handle JWT with past iat but valid exp', async () => {
    const jwt = await new SignJWT({ org_id: 'org_123' })
      .setSubject('user_123')
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 86400) // Issued 24 hours ago
      .setExpirationTime('48h') // But expires 48 hours from issue = 24h from now
      .sign(TEST_SECRET)

    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
  })
})

// ============================================================================
// Edge Cases and Security Tests
// ============================================================================

describe('Edge cases and security', () => {
  it('should handle JWT with very long claims', async () => {
    const longOrgId = 'org_' + 'a'.repeat(1000)
    const jwt = await createTestJwt({ org_id: longOrgId })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe(longOrgId)
  })

  it('should handle JWT with unicode in claims', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_unicode_test',
      storage: { path_prefix: '/data/emoji-\u2764/files' },
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.pathPrefix).toBe('/data/emoji-\u2764/files')
  })

  it('should handle JWT with special characters in path_prefix', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      storage: { path_prefix: '/path/with spaces/and+plus/file%20encoded' },
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.pathPrefix).toBe('/path/with spaces/and+plus/file%20encoded')
  })

  it('should reject JWT signed with none algorithm attack', async () => {
    // Manually crafted JWT with "none" algorithm - should be rejected
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ org_id: 'org_123', sub: 'attacker' })).toString(
      'base64url'
    )
    const fakeJwt = `${header}.${payload}.`

    await expect(extractStorageClaims(fakeJwt, TEST_SECRET)).rejects.toThrow('Invalid JWT')
  })

  it('should handle empty storage object', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      storage: {},
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
    expect(claims.bucket).toBeUndefined()
    expect(claims.pathPrefix).toBeUndefined()
  })

  it('should handle null storage object', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      storage: null,
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
    expect(claims.bucket).toBeUndefined()
    expect(claims.pathPrefix).toBeUndefined()
  })

  it('should handle storage as non-object type', async () => {
    const jwt = await createTestJwt({
      org_id: 'org_123',
      storage: 'not-an-object',
    })
    const claims = await extractStorageClaims(jwt, TEST_SECRET)
    expect(claims.orgId).toBe('org_123')
    expect(claims.bucket).toBeUndefined()
    expect(claims.pathPrefix).toBeUndefined()
  })
})
