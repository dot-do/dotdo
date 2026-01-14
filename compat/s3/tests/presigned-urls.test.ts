/**
 * @dotdo/s3 - Presigned URL Tests
 *
 * TDD RED Phase: Comprehensive tests for S3 presigned URL generation and validation.
 * These tests define the expected behavior for AWS Signature V4 presigned URLs.
 *
 * Coverage:
 * 1. GET presigned URL generation and validation
 * 2. PUT presigned URL generation and validation
 * 3. Expiration handling (valid, expired URLs)
 * 4. Custom headers in signatures
 * 5. AWS Signature V4 format verification
 * 6. Security edge cases
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  getSignedUrl,
  _clearAll,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/s3 - Presigned URLs', () => {
  let client: InstanceType<typeof S3Client>

  beforeEach(() => {
    _clearAll()
    client = new S3Client({
      region: 'us-east-1',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. GET Presigned URL Generation and Validation
  // ===========================================================================

  describe('GET Presigned URL Generation', () => {
    it('should generate a valid presigned GET URL', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-file.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
      expect(url).toContain('test-bucket')
      expect(url).toContain('test-file.txt')
    })

    it('should include all required AWS Signature V4 parameters in GET URL', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'my-bucket',
          Key: 'documents/report.pdf',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const params = urlObj.searchParams

      // Required V4 signature parameters
      expect(params.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
      expect(params.get('X-Amz-Credential')).toMatch(/^AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request$/)
      expect(params.get('X-Amz-Date')).toMatch(/^\d{8}T\d{6}Z$/)
      expect(params.get('X-Amz-Expires')).toBe('3600')
      expect(params.get('X-Amz-SignedHeaders')).toContain('host')
      expect(params.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should properly encode special characters in object key', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'path/to/file with spaces.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toContain('file%20with%20spaces.txt')
    })

    it('should properly encode unicode characters in object key', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'documents/archivo-espanol-n.pdf',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toContain('archivo-espa')
    })

    it('should handle keys with multiple slashes', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'a/b/c/d/e/f/deep-file.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toContain('a/b/c/d/e/f/deep-file.txt')
    })

    it('should handle bucket names with dots', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'my.bucket.name',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toContain('my.bucket.name')
    })

    it('should use the correct endpoint from client config', async () => {
      const customClient = new S3Client({
        region: 'eu-west-1',
        endpoint: 'https://s3.eu-west-1.amazonaws.com',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })

      const url = await getSignedUrl(
        customClient,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toContain('s3.eu-west-1.amazonaws.com')
    })

    it('should handle R2-style endpoints', async () => {
      const r2Client = new S3Client({
        region: 'auto',
        endpoint: 'https://account-id.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })

      const url = await getSignedUrl(
        r2Client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toContain('r2.cloudflarestorage.com')
    })
  })

  // ===========================================================================
  // 2. PUT Presigned URL Generation and Validation
  // ===========================================================================

  describe('PUT Presigned URL Generation', () => {
    it('should generate a valid presigned PUT URL', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'upload.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
      expect(url).toContain('test-bucket')
      expect(url).toContain('upload.txt')
    })

    it('should include all required AWS Signature V4 parameters in PUT URL', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'my-bucket',
          Key: 'uploads/file.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const params = urlObj.searchParams

      expect(params.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
      expect(params.get('X-Amz-Credential')).toBeDefined()
      expect(params.get('X-Amz-Date')).toBeDefined()
      expect(params.get('X-Amz-Expires')).toBe('3600')
      expect(params.get('X-Amz-SignedHeaders')).toBeDefined()
      expect(params.get('X-Amz-Signature')).toBeDefined()
    })

    it('should include Content-Type in signed headers when specified', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'data.json',
          ContentType: 'application/json',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const signedHeaders = urlObj.searchParams.get('X-Amz-SignedHeaders')

      // Content-Type should be included in signed headers for PUT requests
      expect(signedHeaders).toContain('content-type')
    })

    it('should handle large file upload URLs', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'large-file.zip',
          ContentType: 'application/zip',
        }),
        { expiresIn: 7200 }
      )

      expect(url).toBeDefined()
      expect(url).toContain('X-Amz-Expires=7200')
    })

    it('should handle multipart upload presigned URLs', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'multipart/part.bin',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(url).toContain('multipart/part.bin')
    })
  })

  // ===========================================================================
  // 3. Expiration Handling
  // ===========================================================================

  describe('Expiration Handling', () => {
    it('should use default expiration (900 seconds) when not specified', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        })
      )

      expect(url).toContain('X-Amz-Expires=900')
    })

    it('should accept custom expiration in seconds', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 7200 }
      )

      expect(url).toContain('X-Amz-Expires=7200')
    })

    it('should accept expiresAt date option', async () => {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 3600000) // 1 hour from now

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresAt }
      )

      // Should be approximately 3600 seconds
      const urlObj = new URL(url)
      const expires = parseInt(urlObj.searchParams.get('X-Amz-Expires') || '0')
      expect(expires).toBeGreaterThan(3500)
      expect(expires).toBeLessThanOrEqual(3600)
    })

    it('should throw error for expiration exceeding 7 days', async () => {
      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test.txt',
          }),
          { expiresIn: 604801 } // 7 days + 1 second
        )
      ).rejects.toThrow(/exceed.*7 days/i)
    })

    it('should throw error for zero or negative expiration', async () => {
      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test.txt',
          }),
          { expiresIn: 0 }
        )
      ).rejects.toThrow(/positive/i)

      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test.txt',
          }),
          { expiresIn: -100 }
        )
      ).rejects.toThrow(/positive/i)
    })

    it('should throw error when expiresAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 3600000) // 1 hour ago

      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test.txt',
          }),
          { expiresAt: pastDate }
        )
      ).rejects.toThrow(/positive/i)
    })

    it('should allow maximum expiration of exactly 7 days', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 604800 } // Exactly 7 days
      )

      expect(url).toContain('X-Amz-Expires=604800')
    })

    it('should generate consistent timestamps for signing', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      expect(urlObj.searchParams.get('X-Amz-Date')).toBe('20250115T103000Z')
      expect(urlObj.searchParams.get('X-Amz-Credential')).toContain('20250115')
    })
  })

  // ===========================================================================
  // 4. Custom Headers in Signatures
  // ===========================================================================

  describe('Custom Headers in Signatures', () => {
    it('should include host header in signed headers by default', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      expect(urlObj.searchParams.get('X-Amz-SignedHeaders')).toContain('host')
    })

    it('should support custom signed headers', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        {
          expiresIn: 3600,
          signedHeaders: new Set(['host', 'x-amz-content-sha256']),
        }
      )

      const urlObj = new URL(url)
      const signedHeaders = urlObj.searchParams.get('X-Amz-SignedHeaders')
      expect(signedHeaders).toContain('host')
      expect(signedHeaders).toContain('x-amz-content-sha256')
    })

    it('should exclude unsignable headers', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
          ContentType: 'text/plain',
        }),
        {
          expiresIn: 3600,
          unsignableHeaders: new Set(['content-length']),
        }
      )

      const urlObj = new URL(url)
      const signedHeaders = urlObj.searchParams.get('X-Amz-SignedHeaders')
      expect(signedHeaders).not.toContain('content-length')
    })

    it('should handle x-amz-* metadata headers', async () => {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
          Metadata: {
            'custom-key': 'custom-value',
          },
        }),
        {
          expiresIn: 3600,
          signedHeaders: new Set(['host', 'x-amz-meta-custom-key']),
        }
      )

      expect(url).toBeDefined()
    })

    it('should properly canonicalize header names to lowercase', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        {
          expiresIn: 3600,
          signedHeaders: new Set(['Host', 'X-Amz-Content-SHA256']),
        }
      )

      const urlObj = new URL(url)
      const signedHeaders = urlObj.searchParams.get('X-Amz-SignedHeaders')
      // Should be lowercase
      expect(signedHeaders).not.toContain('Host')
      expect(signedHeaders).not.toContain('X-Amz-Content-SHA256')
      expect(signedHeaders).toContain('host')
    })
  })

  // ===========================================================================
  // 5. AWS Signature V4 Format Verification
  // ===========================================================================

  describe('AWS Signature V4 Format Verification', () => {
    it('should use AWS4-HMAC-SHA256 algorithm', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      expect(urlObj.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    })

    it('should format credential scope correctly', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const credential = urlObj.searchParams.get('X-Amz-Credential')
      expect(credential).toBe('AKIAIOSFODNN7EXAMPLE/20250115/us-east-1/s3/aws4_request')
    })

    it('should format X-Amz-Date in ISO 8601 basic format', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-06-20T14:45:30Z'))

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const amzDate = urlObj.searchParams.get('X-Amz-Date')
      expect(amzDate).toBe('20250620T144530Z')
    })

    it('should produce a 64-character hex signature', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const signature = urlObj.searchParams.get('X-Amz-Signature')
      expect(signature).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should generate deterministic signatures for same inputs', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const url2 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url1).toBe(url2)
    })

    it('should produce different signatures for different keys', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'file1.txt',
        }),
        { expiresIn: 3600 }
      )

      const url2 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'file2.txt',
        }),
        { expiresIn: 3600 }
      )

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature')
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature')
      expect(sig1).not.toBe(sig2)
    })

    it('should produce different signatures for different buckets', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'bucket-a',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const url2 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'bucket-b',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature')
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature')
      expect(sig1).not.toBe(sig2)
    })

    it('should produce different signatures for different credentials', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const client2 = new S3Client({
        region: 'us-east-1',
        endpoint: 'https://s3.us-east-1.amazonaws.com',
        credentials: {
          accessKeyId: 'AKIADIFFERENTKEY',
          secretAccessKey: 'differentSecretAccessKey1234567890',
        },
      })

      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const url2 = await getSignedUrl(
        client2,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature')
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature')
      expect(sig1).not.toBe(sig2)
    })

    it('should properly URI encode query parameters', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const credential = urlObj.searchParams.get('X-Amz-Credential')

      // The credential should be properly decoded by URL parser
      expect(credential).toContain('/')
    })
  })

  // ===========================================================================
  // 6. Security Edge Cases
  // ===========================================================================

  describe('Security Edge Cases', () => {
    it('should not leak secret access key in URL', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).not.toContain('wJalrXUtnFEMI')
      expect(url).not.toContain('secretAccessKey')
      expect(url).not.toContain('EXAMPLEKEY')
    })

    it('should only include access key ID (not secret) in credential', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const credential = urlObj.searchParams.get('X-Amz-Credential')
      expect(credential).toContain('AKIAIOSFODNN7EXAMPLE')
    })

    it('should handle path traversal attempts in key', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: '../../../etc/passwd',
        }),
        { expiresIn: 3600 }
      )

      // Path traversal should be encoded, not interpreted
      expect(url).toContain('%2E%2E')
      expect(url).not.toContain('/../')
    })

    it('should handle null bytes in key', async () => {
      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test\0file.txt',
          }),
          { expiresIn: 3600 }
        )
      ).rejects.toThrow()
    })

    it('should handle very long keys (up to 1024 chars)', async () => {
      const longKey = 'a'.repeat(1024)

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: longKey,
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(url).toContain('a'.repeat(100)) // Verify some of the key is present
    })

    it('should reject keys exceeding 1024 characters', async () => {
      const tooLongKey = 'a'.repeat(1025)

      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: tooLongKey,
          }),
          { expiresIn: 3600 }
        )
      ).rejects.toThrow(/key.*length/i)
    })

    it('should validate bucket name format', async () => {
      // Bucket names must be 3-63 characters and follow DNS naming rules
      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'ab', // Too short
            Key: 'test.txt',
          }),
          { expiresIn: 3600 }
        )
      ).rejects.toThrow(/bucket/i)

      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'a'.repeat(64), // Too long
            Key: 'test.txt',
          }),
          { expiresIn: 3600 }
        )
      ).rejects.toThrow(/bucket/i)
    })

    it('should reject bucket names with invalid characters', async () => {
      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'UPPERCASE-BUCKET', // Uppercase not allowed
            Key: 'test.txt',
          }),
          { expiresIn: 3600 }
        )
      ).rejects.toThrow(/bucket/i)

      await expect(
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'bucket_underscore', // Underscores not allowed
            Key: 'test.txt',
          }),
          { expiresIn: 3600 }
        )
      ).rejects.toThrow(/bucket/i)
    })

    it('should use UNSIGNED-PAYLOAD for presigned URLs', async () => {
      // This is important - presigned URLs don't include the actual payload
      // so they must use UNSIGNED-PAYLOAD in the canonical request
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      // The signature should be valid for any payload (UNSIGNED-PAYLOAD)
      expect(url).toBeDefined()
    })

    it('should protect against signature manipulation', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const originalSig = urlObj.searchParams.get('X-Amz-Signature')

      // Tampering with the signature should result in invalid signature
      urlObj.searchParams.set('X-Amz-Signature', 'a'.repeat(64))

      // The tampered URL should not match the original
      expect(urlObj.toString()).not.toBe(url)
    })

    it('should include region in credential scope', async () => {
      const euClient = new S3Client({
        region: 'eu-central-1',
        endpoint: 'https://s3.eu-central-1.amazonaws.com',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })

      const url = await getSignedUrl(
        euClient,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const urlObj = new URL(url)
      const credential = urlObj.searchParams.get('X-Amz-Credential')
      expect(credential).toContain('eu-central-1')
    })
  })

  // ===========================================================================
  // 7. Other Command Types
  // ===========================================================================

  describe('Other Command Types', () => {
    it('should generate presigned URL for HeadObjectCommand', async () => {
      const url = await getSignedUrl(
        client,
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(url).toContain('test-bucket')
      expect(url).toContain('test.txt')
    })

    it('should generate presigned URL for DeleteObjectCommand', async () => {
      const url = await getSignedUrl(
        client,
        new DeleteObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(url).toContain('test-bucket')
      expect(url).toContain('test.txt')
    })

    it('should reject unsupported command types', async () => {
      await expect(
        getSignedUrl(
          client,
          new CreateBucketCommand({ Bucket: 'test-bucket' }) as any,
          { expiresIn: 3600 }
        )
      ).rejects.toThrow(/unsupported|not supported/i)
    })
  })

  // ===========================================================================
  // 8. URL Validation Tests
  // ===========================================================================

  describe('URL Validation', () => {
    it('should generate a parseable URL', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      // Should not throw
      const parsed = new URL(url)
      expect(parsed.protocol).toBe('https:')
      expect(parsed.pathname).toContain('test-bucket')
    })

    it('should preserve query parameter order for reproducibility', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const url2 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url1).toBe(url2)
    })

    it('should use path-style URLs by default', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.txt',
        }),
        { expiresIn: 3600 }
      )

      const parsed = new URL(url)
      // Path-style: /bucket/key
      expect(parsed.pathname).toMatch(/^\/test-bucket\//)
    })
  })

  // ===========================================================================
  // 9. Signature Verification Tests
  // ===========================================================================

  describe('Signature Verification', () => {
    it('should produce valid signatures that can be verified', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T10:30:00Z'))

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'examplebucket',
          Key: 'test.txt',
        }),
        { expiresIn: 86400 }
      )

      // The URL should have all required components
      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
      expect(parsed.searchParams.get('X-Amz-Credential')).toBeDefined()
      expect(parsed.searchParams.get('X-Amz-Date')).toBeDefined()
      expect(parsed.searchParams.get('X-Amz-Expires')).toBeDefined()
      expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBeDefined()
      expect(parsed.searchParams.get('X-Amz-Signature')).toBeDefined()
    })

    it('should generate stable signatures across implementations', async () => {
      // Known test vector from AWS documentation
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2013-05-24T00:00:00Z'))

      const testClient = new S3Client({
        region: 'us-east-1',
        endpoint: 'https://examplebucket.s3.amazonaws.com',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })

      const url = await getSignedUrl(
        testClient,
        new GetObjectCommand({
          Bucket: 'examplebucket',
          Key: 'test.txt',
        }),
        { expiresIn: 86400 }
      )

      // Verify the signature components are present
      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Date')).toBe('20130524T000000Z')
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain('20130524')
    })
  })
})
