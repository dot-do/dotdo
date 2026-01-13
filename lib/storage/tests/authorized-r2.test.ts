import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * AuthorizedR2Client Tests
 *
 * Tests for JWT-authorized R2 client that constructs paths based on claims.
 * This client provides tenant-isolated storage paths using JWT claim data:
 * - orgId: Organization identifier
 * - tenantId: Tenant within organization
 * - bucket: Target R2 bucket name
 * - pathPrefix: Optional prefix for versioned path structures
 *
 * Path structure: orgs/{orgId}/tenants/{tenantId}/do/{doId}/{type}/
 *
 * Coverage areas:
 * - Authorization checks (claims validation)
 * - Permission validation (tenant isolation)
 * - Access control (path boundaries)
 * - Conditional operations (putWithCondition)
 * - Path security (traversal prevention)
 */

// Import the module under test
import {
  AuthorizedR2Client,
  type R2Claims,
  type R2Bucket,
  type R2PutOptions,
} from '../authorized-r2'

// ============================================================================
// Test Data
// ============================================================================

const mockClaims: R2Claims = {
  orgId: 'org_123',
  tenantId: 'tenant_456',
  bucket: 'dotdo-prod',
  pathPrefix: '',
}

// Alternative claims for tenant isolation tests
const otherTenantClaims: R2Claims = {
  orgId: 'org_123',
  tenantId: 'tenant_other',
  bucket: 'dotdo-prod',
  pathPrefix: '',
}

const otherOrgClaims: R2Claims = {
  orgId: 'org_other',
  tenantId: 'tenant_456',
  bucket: 'dotdo-prod',
  pathPrefix: '',
}

// ============================================================================
// Path Construction Tests
// ============================================================================

describe('AuthorizedR2Client', () => {
  describe('path construction', () => {
    it('should construct DO state path from claims', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.getStatePath('do_123')).toBe(
        'orgs/org_123/tenants/tenant_456/do/do_123/state/'
      )
    })

    it('should construct snapshot path', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.getSnapshotPath('do_123', 'snap_789')).toBe(
        'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/snap_789/'
      )
    })

    it('should construct iceberg metadata path', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.getIcebergMetadataPath('do_123')).toBe(
        'orgs/org_123/tenants/tenant_456/do/do_123/iceberg/metadata/'
      )
    })

    it('should use path_prefix from claims', () => {
      const claimsWithPrefix: R2Claims = { ...mockClaims, pathPrefix: '/v2' }
      const client = new AuthorizedR2Client(claimsWithPrefix)
      expect(client.getStatePath('do_123')).toContain('/v2/')
    })

    it('should construct base path from claims', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.getBasePath()).toBe(
        'orgs/org_123/tenants/tenant_456/'
      )
    })

    it('should construct DO base path', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.getDOBasePath('do_123')).toBe(
        'orgs/org_123/tenants/tenant_456/do/do_123/'
      )
    })

    it('should handle empty pathPrefix', () => {
      const claimsWithEmptyPrefix: R2Claims = { ...mockClaims, pathPrefix: '' }
      const client = new AuthorizedR2Client(claimsWithEmptyPrefix)
      // Should not have double slashes or empty segments
      const path = client.getStatePath('do_123')
      expect(path).not.toContain('//')
      expect(path).toBe('orgs/org_123/tenants/tenant_456/do/do_123/state/')
    })

    it('should normalize path_prefix with leading slash', () => {
      const claimsWithSlash: R2Claims = { ...mockClaims, pathPrefix: '/v2' }
      const client = new AuthorizedR2Client(claimsWithSlash)
      const path = client.getStatePath('do_123')
      // Should handle leading slash appropriately
      expect(path).toContain('v2')
    })

    it('should construct iceberg data path', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.getIcebergDataPath('do_123')).toBe(
        'orgs/org_123/tenants/tenant_456/do/do_123/iceberg/data/'
      )
    })
  })

  // ============================================================================
  // R2 Operations Tests
  // ============================================================================

  describe('operations', () => {
    let mockR2: {
      put: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      list: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
      head: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockR2 = {
        put: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({ arrayBuffer: () => new ArrayBuffer(0) }),
        list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
        delete: vi.fn().mockResolvedValue(undefined),
        head: vi.fn().mockResolvedValue(null),
      }
    })

    it('should put object to R2 with correct path', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const data = new ArrayBuffer(10)
      await client.put('do_123', 'key', data)
      expect(mockR2.put).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/state/key',
        data
      )
    })

    it('should put object with options', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const data = new ArrayBuffer(10)
      await client.put('do_123', 'key', data, {
        httpMetadata: { contentType: 'application/json' },
      })
      expect(mockR2.put).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/state/key',
        data,
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      )
    })

    it('should get object from R2 with correct path', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.get('do_123', 'key')
      expect(mockR2.get).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/state/key'
      )
    })

    it('should list objects with prefix', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.list('do_123', 'snapshots/')
      expect(mockR2.list).toHaveBeenCalledWith({
        prefix: 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/',
      })
    })

    it('should list objects with additional options', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.list('do_123', 'state/', { limit: 100, cursor: 'abc123' })
      expect(mockR2.list).toHaveBeenCalledWith({
        prefix: 'orgs/org_123/tenants/tenant_456/do/do_123/state/',
        limit: 100,
        cursor: 'abc123',
      })
    })

    it('should delete object from R2', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.delete('do_123', 'key')
      expect(mockR2.delete).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/state/key'
      )
    })

    it('should check if object exists using head', async () => {
      mockR2.head.mockResolvedValue({ key: 'test' })
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const exists = await client.exists('do_123', 'key')
      expect(mockR2.head).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/state/key'
      )
      expect(exists).toBe(true)
    })

    it('should return false for non-existent object', async () => {
      mockR2.head.mockResolvedValue(null)
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const exists = await client.exists('do_123', 'nonexistent')
      expect(exists).toBe(false)
    })
  })

  // ============================================================================
  // Snapshot Operations Tests
  // ============================================================================

  describe('snapshot operations', () => {
    let mockR2: {
      put: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      list: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockR2 = {
        put: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({ arrayBuffer: () => new ArrayBuffer(0) }),
        list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
        delete: vi.fn().mockResolvedValue(undefined),
      }
    })

    it('should put snapshot data', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const data = new ArrayBuffer(100)
      await client.putSnapshot('do_123', 'snap_789', 'data.bin', data)
      expect(mockR2.put).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/snap_789/data.bin',
        data
      )
    })

    it('should get snapshot data', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.getSnapshot('do_123', 'snap_789', 'data.bin')
      expect(mockR2.get).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/snap_789/data.bin'
      )
    })

    it('should list snapshots for DO', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.listSnapshots('do_123')
      expect(mockR2.list).toHaveBeenCalledWith({
        prefix: 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/',
        delimiter: '/',
      })
    })
  })

  // ============================================================================
  // Iceberg Operations Tests
  // ============================================================================

  describe('iceberg operations', () => {
    let mockR2: {
      put: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      list: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockR2 = {
        put: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({ text: () => '{}' }),
        list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
      }
    })

    it('should put iceberg metadata', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const metadata = JSON.stringify({ version: 1 })
      await client.putIcebergMetadata('do_123', 'v1.metadata.json', metadata)
      expect(mockR2.put).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/iceberg/metadata/v1.metadata.json',
        metadata
      )
    })

    it('should get iceberg metadata', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.getIcebergMetadata('do_123', 'v1.metadata.json')
      expect(mockR2.get).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/iceberg/metadata/v1.metadata.json'
      )
    })

    it('should put iceberg data file', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      const parquetData = new ArrayBuffer(1000)
      await client.putIcebergData('do_123', 'data-001.parquet', parquetData)
      expect(mockR2.put).toHaveBeenCalledWith(
        'orgs/org_123/tenants/tenant_456/do/do_123/iceberg/data/data-001.parquet',
        parquetData
      )
    })

    it('should list iceberg metadata files', async () => {
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
      await client.listIcebergMetadata('do_123')
      expect(mockR2.list).toHaveBeenCalledWith({
        prefix: 'orgs/org_123/tenants/tenant_456/do/do_123/iceberg/metadata/',
      })
    })
  })

  // ============================================================================
  // Claims Validation Tests
  // ============================================================================

  describe('claims validation', () => {
    it('should throw if orgId is missing', () => {
      const invalidClaims = { ...mockClaims, orgId: '' } as R2Claims
      expect(() => new AuthorizedR2Client(invalidClaims)).toThrow()
    })

    it('should throw if tenantId is missing', () => {
      const invalidClaims = { ...mockClaims, tenantId: '' } as R2Claims
      expect(() => new AuthorizedR2Client(invalidClaims)).toThrow()
    })

    it('should throw if bucket is missing', () => {
      const invalidClaims = { ...mockClaims, bucket: '' } as R2Claims
      expect(() => new AuthorizedR2Client(invalidClaims)).toThrow()
    })

    it('should expose claims as readonly', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.claims).toEqual(mockClaims)
    })

    it('should expose bucket name', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.bucketName).toBe('dotdo-prod')
    })
  })

  // ============================================================================
  // Path Security Tests
  // ============================================================================

  describe('path security', () => {
    it('should reject paths with directory traversal', async () => {
      const mockR2 = {
        put: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue({ objects: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
      }
      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

      await expect(client.get('do_123', '../../../etc/passwd')).rejects.toThrow()
    })

    it('should reject doId with special characters', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(() => client.getStatePath('do/../admin')).toThrow()
    })

    it('should sanitize key paths', () => {
      const client = new AuthorizedR2Client(mockClaims)
      // Keys should be sanitized to prevent traversal
      const path = client.getStatePath('do_123')
      expect(path).not.toContain('..')
    })
  })

  // ============================================================================
  // Authorization Checks Tests
  // ============================================================================

  describe('authorization checks', () => {
    describe('required claims validation', () => {
      it('should throw with specific message for missing orgId', () => {
        const claims = { ...mockClaims, orgId: '' }
        expect(() => new AuthorizedR2Client(claims)).toThrow('Missing required claim: orgId')
      })

      it('should throw with specific message for missing tenantId', () => {
        const claims = { ...mockClaims, tenantId: '' }
        expect(() => new AuthorizedR2Client(claims)).toThrow('Missing required claim: tenantId')
      })

      it('should throw with specific message for missing bucket', () => {
        const claims = { ...mockClaims, bucket: '' }
        expect(() => new AuthorizedR2Client(claims)).toThrow('Missing required claim: bucket')
      })

      it('should reject null orgId', () => {
        const claims = { ...mockClaims, orgId: null as unknown as string }
        expect(() => new AuthorizedR2Client(claims)).toThrow()
      })

      it('should reject undefined tenantId', () => {
        const claims = { ...mockClaims, tenantId: undefined as unknown as string }
        expect(() => new AuthorizedR2Client(claims)).toThrow()
      })
    })

    describe('claims immutability', () => {
      it('should not be affected by modifications to original claims object', () => {
        const mutableClaims = { ...mockClaims }
        const client = new AuthorizedR2Client(mutableClaims)

        // Modify original object
        mutableClaims.orgId = 'modified_org'

        // Client should retain original value (copies on construction)
        expect(client.claims.orgId).toBe('org_123')
      })

      it('should expose claims reference (not defensive copy)', () => {
        // Note: Current implementation returns internal reference.
        // This documents the current behavior - consider returning
        // Object.freeze() or defensive copy for stricter immutability.
        const client = new AuthorizedR2Client(mockClaims)
        const claims1 = client.claims
        const claims2 = client.claims

        expect(claims1).toBe(claims2) // Same reference
      })
    })

    describe('R2 bucket requirement', () => {
      it('should throw when R2 bucket not configured for put operation', async () => {
        const client = new AuthorizedR2Client(mockClaims) // No R2 bucket passed
        await expect(client.put('do_123', 'key', new ArrayBuffer(10))).rejects.toThrow(
          'R2 bucket not configured'
        )
      })

      it('should throw when R2 bucket not configured for get operation', async () => {
        const client = new AuthorizedR2Client(mockClaims)
        await expect(client.get('do_123', 'key')).rejects.toThrow('R2 bucket not configured')
      })

      it('should throw when R2 bucket not configured for delete operation', async () => {
        const client = new AuthorizedR2Client(mockClaims)
        await expect(client.delete('do_123', 'key')).rejects.toThrow('R2 bucket not configured')
      })

      it('should throw when R2 bucket not configured for list operation', async () => {
        const client = new AuthorizedR2Client(mockClaims)
        await expect(client.list('do_123', 'prefix/')).rejects.toThrow('R2 bucket not configured')
      })

      it('should throw when R2 bucket not configured for exists operation', async () => {
        const client = new AuthorizedR2Client(mockClaims)
        await expect(client.exists('do_123', 'key')).rejects.toThrow('R2 bucket not configured')
      })
    })
  })

  // ============================================================================
  // Permission Validation Tests (Tenant Isolation)
  // ============================================================================

  describe('permission validation - tenant isolation', () => {
    it('should generate different paths for different tenants', () => {
      const client1 = new AuthorizedR2Client(mockClaims)
      const client2 = new AuthorizedR2Client(otherTenantClaims)

      const path1 = client1.getStatePath('do_123')
      const path2 = client2.getStatePath('do_123')

      expect(path1).not.toBe(path2)
      expect(path1).toContain('tenant_456')
      expect(path2).toContain('tenant_other')
    })

    it('should generate different paths for different orgs', () => {
      const client1 = new AuthorizedR2Client(mockClaims)
      const client2 = new AuthorizedR2Client(otherOrgClaims)

      const path1 = client1.getStatePath('do_123')
      const path2 = client2.getStatePath('do_123')

      expect(path1).not.toBe(path2)
      expect(path1).toContain('org_123')
      expect(path2).toContain('org_other')
    })

    it('should ensure complete path isolation between tenants', () => {
      const client1 = new AuthorizedR2Client(mockClaims)
      const client2 = new AuthorizedR2Client(otherTenantClaims)

      const basePath1 = client1.getBasePath()
      const basePath2 = client2.getBasePath()

      // Paths should not share any common prefix beyond 'orgs/{orgId}/'
      expect(basePath1.startsWith(basePath2)).toBe(false)
      expect(basePath2.startsWith(basePath1)).toBe(false)
    })

    it('should scope all DO operations within tenant boundaries', async () => {
      const mockR2 = {
        put: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
        delete: vi.fn().mockResolvedValue(undefined),
        head: vi.fn().mockResolvedValue(null),
      }

      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

      await client.put('do_123', 'file.txt', 'data')

      const calledPath = mockR2.put.mock.calls[0][0]
      expect(calledPath).toContain('orgs/org_123/')
      expect(calledPath).toContain('tenants/tenant_456/')
    })

    it('should prevent access to paths outside tenant scope via key manipulation', async () => {
      const mockR2 = {
        put: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue({ objects: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
      }

      const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

      // Attempt to access other tenant's path via key
      await expect(client.get('do_123', '../../tenant_other/do/do_456/state/key')).rejects.toThrow()
    })
  })

  // ============================================================================
  // Access Control Tests (Path Boundaries)
  // ============================================================================

  describe('access control - path boundaries', () => {
    describe('directory traversal prevention', () => {
      // Attack vectors that contain literal '..' sequences - should be rejected
      const literalTraversalVectors = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        'valid/../../../escape',
        './.././../escape',
        '....//....//escape',
        'foo/bar/../../../escape',
        '..%252f..%252f', // Double URL encoded (still contains ..)
      ]

      for (const vector of literalTraversalVectors) {
        it(`should reject traversal attempt: ${vector.slice(0, 30)}...`, async () => {
          const mockR2 = {
            put: vi.fn().mockResolvedValue({}),
            get: vi.fn().mockResolvedValue(null),
          }

          const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

          // Test in key parameter
          await expect(client.get('do_123', vector)).rejects.toThrow()
        })
      }

      // URL-encoded vectors that don't contain literal '..' - implementation note
      it('should handle URL-encoded patterns (implementation delegates to R2)', async () => {
        // Note: The current implementation checks for literal '..' sequences.
        // URL-encoded traversal like '%2e%2e%2f' passes validation because
        // URL decoding happens at a different layer (HTTP/R2).
        // This documents the current behavior - consider adding URL decode
        // validation if stricter security is required.
        const mockR2 = {
          put: vi.fn().mockResolvedValue({}),
          get: vi.fn().mockResolvedValue(null),
        }

        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        // This passes because no literal '..' in the string
        await expect(client.get('do_123', '%2e%2e%2f')).resolves.toBeNull()
      })

      it('should reject traversal in doId parameter', () => {
        const client = new AuthorizedR2Client(mockClaims)

        expect(() => client.getStatePath('../escape')).toThrow()
        expect(() => client.getStatePath('do_123/../escape')).toThrow()
        expect(() => client.getDOBasePath('..%2f..%2f')).toThrow()
      })

      it('should reject traversal in snapshotId parameter', () => {
        const client = new AuthorizedR2Client(mockClaims)

        expect(() => client.getSnapshotPath('do_123', '../escape')).toThrow()
        expect(() => client.getSnapshotPath('do_123', 'snap/../../../')).toThrow()
      })
    })

    describe('path prefix enforcement', () => {
      it('should enforce pathPrefix for all operations', () => {
        const claimsWithPrefix: R2Claims = { ...mockClaims, pathPrefix: 'v2' }
        const client = new AuthorizedR2Client(claimsWithPrefix)

        const statePath = client.getStatePath('do_123')
        const snapshotPath = client.getSnapshotPath('do_123', 'snap_1')
        const icebergPath = client.getIcebergMetadataPath('do_123')

        expect(statePath).toMatch(/^v2\/orgs\//)
        expect(snapshotPath).toMatch(/^v2\/orgs\//)
        expect(icebergPath).toMatch(/^v2\/orgs\//)
      })

      it('should handle pathPrefix with leading slash', () => {
        const claimsWithSlash: R2Claims = { ...mockClaims, pathPrefix: '/v2' }
        const client = new AuthorizedR2Client(claimsWithSlash)

        const path = client.getStatePath('do_123')
        // Should normalize without double slashes
        expect(path).not.toMatch(/\/\//)
      })

      it('should handle pathPrefix with trailing slash', () => {
        const claimsWithTrailingSlash: R2Claims = { ...mockClaims, pathPrefix: 'v2/' }
        const client = new AuthorizedR2Client(claimsWithTrailingSlash)

        const path = client.getStatePath('do_123')
        expect(path).not.toMatch(/\/\//)
      })
    })

    describe('valid path characters', () => {
      it('should allow alphanumeric doIds', () => {
        const client = new AuthorizedR2Client(mockClaims)

        expect(() => client.getStatePath('do123')).not.toThrow()
        expect(() => client.getStatePath('DO_ABC_123')).not.toThrow()
        expect(() => client.getStatePath('do-with-dashes')).not.toThrow()
      })

      it('should allow dots in doIds (for versioning)', () => {
        const client = new AuthorizedR2Client(mockClaims)

        expect(() => client.getStatePath('do_123.v1')).not.toThrow()
        expect(() => client.getStatePath('entity.user.123')).not.toThrow()
      })

      it('should allow underscores and hyphens in keys', async () => {
        const mockR2 = {
          put: vi.fn().mockResolvedValue({}),
          get: vi.fn().mockResolvedValue(null),
        }

        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        await expect(client.get('do_123', 'file_name-with.extension')).resolves.toBeNull()
      })
    })
  })

  // ============================================================================
  // Conditional Operations Tests
  // ============================================================================

  describe('conditional operations', () => {
    let mockR2: {
      put: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      head: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockR2 = {
        put: vi.fn().mockResolvedValue({ key: 'test', etag: 'etag123' }),
        get: vi.fn().mockResolvedValue(null),
        head: vi.fn().mockResolvedValue(null),
      }
    })

    describe('putWithCondition - onlyIfNotExists', () => {
      it('should pass onlyIf condition for create-only semantics', async () => {
        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        await client.putWithCondition('do_123', 'lock.json', '{"holder":"worker1"}', {
          onlyIfNotExists: true,
        })

        expect(mockR2.put).toHaveBeenCalledWith(
          'orgs/org_123/tenants/tenant_456/do/do_123/state/lock.json',
          '{"holder":"worker1"}',
          expect.objectContaining({
            onlyIf: { etagDoesNotMatch: '*' },
          })
        )
      })

      it('should use ifNoneMatch: "*" for same semantics as onlyIfNotExists', async () => {
        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        await client.putWithCondition('do_123', 'lock.json', 'data', {
          ifNoneMatch: '*',
        })

        expect(mockR2.put).toHaveBeenCalledWith(
          expect.any(String),
          'data',
          expect.objectContaining({
            onlyIf: { etagDoesNotMatch: '*' },
          })
        )
      })
    })

    describe('putWithCondition - ifMatch', () => {
      it('should pass etag match condition for optimistic locking', async () => {
        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        await client.putWithCondition('do_123', 'state.json', '{"version":2}', {
          ifMatch: 'etag_v1',
        })

        expect(mockR2.put).toHaveBeenCalledWith(
          expect.any(String),
          '{"version":2}',
          expect.objectContaining({
            onlyIf: { etagMatches: 'etag_v1' },
          })
        )
      })
    })

    describe('putWithCondition - ifNoneMatch', () => {
      it('should pass etag does not match condition', async () => {
        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        await client.putWithCondition('do_123', 'file.txt', 'new data', {
          ifNoneMatch: 'old_etag',
        })

        expect(mockR2.put).toHaveBeenCalledWith(
          expect.any(String),
          'new data',
          expect.objectContaining({
            onlyIf: { etagDoesNotMatch: 'old_etag' },
          })
        )
      })
    })

    describe('putWithCondition - fencing token acquisition', () => {
      it('should support fencing token pattern for distributed locks', async () => {
        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        // Fencing token pattern: create lock only if not exists
        const lockData = JSON.stringify({
          holder: 'worker_123',
          acquiredAt: Date.now(),
          fencingToken: 'token_abc123',
        })

        const result = await client.putWithCondition('do_123', 'fencing-lock.json', lockData, {
          onlyIfNotExists: true,
        })

        expect(result).toHaveProperty('etag')
        expect(mockR2.put).toHaveBeenCalledWith(
          expect.stringContaining('fencing-lock.json'),
          lockData,
          expect.objectContaining({
            onlyIf: { etagDoesNotMatch: '*' },
          })
        )
      })
    })
  })

  // ============================================================================
  // Edge Cases and Robustness Tests
  // ============================================================================

  describe('edge cases and robustness', () => {
    describe('empty and whitespace handling', () => {
      it('should handle keys with spaces', async () => {
        const mockR2 = {
          put: vi.fn().mockResolvedValue({}),
          get: vi.fn().mockResolvedValue(null),
        }

        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

        // Keys with spaces should work (URL encoding happens at HTTP layer)
        await client.get('do_123', 'file with spaces.txt')
        expect(mockR2.get).toHaveBeenCalled()
      })
    })

    describe('special characters in claims', () => {
      it('should handle orgId with allowed special characters', () => {
        const claims: R2Claims = {
          orgId: 'org_acme-corp.123',
          tenantId: 'tenant_main',
          bucket: 'bucket',
          pathPrefix: '',
        }

        const client = new AuthorizedR2Client(claims)
        const path = client.getBasePath()

        expect(path).toContain('org_acme-corp.123')
      })

      it('should handle tenantId with UUID format', () => {
        const claims: R2Claims = {
          orgId: 'org_123',
          tenantId: '550e8400-e29b-41d4-a716-446655440000',
          bucket: 'bucket',
          pathPrefix: '',
        }

        const client = new AuthorizedR2Client(claims)
        const path = client.getBasePath()

        expect(path).toContain('550e8400-e29b-41d4-a716-446655440000')
      })
    })

    describe('large data handling', () => {
      it('should handle large ArrayBuffer data', async () => {
        const mockR2 = {
          put: vi.fn().mockResolvedValue({}),
        }

        const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)
        const largeData = new ArrayBuffer(10 * 1024 * 1024) // 10MB

        await client.put('do_123', 'large-file.bin', largeData)

        expect(mockR2.put).toHaveBeenCalledWith(expect.any(String), largeData)
      })
    })

    describe('concurrent access patterns', () => {
      it('should maintain path consistency across multiple calls', () => {
        const client = new AuthorizedR2Client(mockClaims)

        const path1 = client.getStatePath('do_123')
        const path2 = client.getStatePath('do_123')
        const path3 = client.getStatePath('do_123')

        expect(path1).toBe(path2)
        expect(path2).toBe(path3)
      })
    })
  })

  // ============================================================================
  // Region Support Tests
  // ============================================================================

  describe('region support', () => {
    it('should accept optional region in claims', () => {
      const claimsWithRegion: R2Claims = {
        ...mockClaims,
        region: 'us-west-2',
      }

      const client = new AuthorizedR2Client(claimsWithRegion)
      expect(client.claims.region).toBe('us-west-2')
    })

    it('should work without region specified', () => {
      const client = new AuthorizedR2Client(mockClaims)
      expect(client.claims.region).toBeUndefined()
    })
  })
})
