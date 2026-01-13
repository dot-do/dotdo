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
 */

// Import the module under test (will fail until implemented)
import {
  AuthorizedR2Client,
  type R2Claims,
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
})
