/**
 * MediaPipeline Presigned URL Tests - TDD RED Phase
 *
 * Tests for presigned URL generation in the MediaPipeline primitive.
 * Provides secure, time-limited URLs for:
 * - File uploads (PUT)
 * - File downloads (GET)
 * - Chunked/resumable uploads
 *
 * These tests define the expected behavior for media file operations with
 * configurable expiration and permission controls.
 *
 * @see https://developers.cloudflare.com/r2/api/s3/presigned-urls/
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// =============================================================================
// Types (to be implemented in presigned-urls.ts)
// =============================================================================

// Types defined here first - implementation file will use these
export type PresignedUrlPermission = 'read' | 'write' | 'read-write'

export interface PresignedUrlOptions {
  /** Object key (path) in the storage bucket */
  key: string
  /** Expiration time in seconds (default: 900, max: 604800) */
  expiresIn?: number
  /** Expiration time as absolute Date */
  expiresAt?: Date
  /** Permission type for the URL */
  permission?: PresignedUrlPermission
  /** Content-Type for upload URLs */
  contentType?: string
  /** Maximum content length for uploads (bytes) */
  maxContentLength?: number
  /** Minimum content length for uploads (bytes) */
  minContentLength?: number
  /** Custom metadata to include */
  metadata?: Record<string, string>
  /** Custom headers to require in the signed request */
  requiredHeaders?: Record<string, string>
  /** Response content disposition for downloads */
  responseContentDisposition?: string
  /** Response content type for downloads */
  responseContentType?: string
  /** Cache control for the response */
  responseCacheControl?: string
}

export interface PresignedUploadUrl {
  /** The presigned URL for PUT request */
  url: string
  /** HTTP method to use */
  method: 'PUT'
  /** Required headers for the upload request */
  headers: Record<string, string>
  /** URL expiration timestamp */
  expiresAt: Date
  /** Maximum file size allowed (if specified) */
  maxContentLength?: number
  /** Object key */
  key: string
}

export interface PresignedDownloadUrl {
  /** The presigned URL for GET request */
  url: string
  /** HTTP method to use */
  method: 'GET'
  /** URL expiration timestamp */
  expiresAt: Date
  /** Object key */
  key: string
}

export interface ChunkedUploadInit {
  /** Upload ID for multipart upload */
  uploadId: string
  /** Object key */
  key: string
  /** Expiration timestamp for the multipart upload */
  expiresAt: Date
}

export interface ChunkedUploadPartUrl {
  /** The presigned URL for uploading this part */
  url: string
  /** Part number (1-indexed) */
  partNumber: number
  /** Required headers for the upload */
  headers: Record<string, string>
  /** Expiration timestamp */
  expiresAt: Date
}

export interface PresignedUrlGenerator {
  /** Generate a presigned URL for file upload */
  generateUploadUrl(options: PresignedUrlOptions): Promise<PresignedUploadUrl>

  /** Generate a presigned URL for file download */
  generateDownloadUrl(options: PresignedUrlOptions): Promise<PresignedDownloadUrl>

  /** Initialize a chunked/multipart upload */
  initChunkedUpload(key: string, options?: Partial<PresignedUrlOptions>): Promise<ChunkedUploadInit>

  /** Generate presigned URL for uploading a specific part */
  generatePartUploadUrl(
    uploadId: string,
    partNumber: number,
    options?: Partial<PresignedUrlOptions>
  ): Promise<ChunkedUploadPartUrl>

  /** Complete a chunked upload */
  completeChunkedUpload(
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ key: string; etag: string }>

  /** Abort a chunked upload */
  abortChunkedUpload(uploadId: string): Promise<void>

  /** Validate a presigned URL (check signature, expiration) */
  validateUrl(url: string): Promise<{ valid: boolean; reason?: string }>
}

export interface PresignedUrlGeneratorConfig {
  /** R2/S3 bucket name */
  bucket: string
  /** Access key ID */
  accessKeyId: string
  /** Secret access key */
  secretAccessKey: string
  /** Optional custom endpoint (for R2 or S3-compatible storage) */
  endpoint?: string
  /** Region (default: 'auto' for R2) */
  region?: string
  /** Default expiration time in seconds */
  defaultExpiry?: number
  /** Maximum allowed expiration time in seconds */
  maxExpiry?: number
  /** Path prefix for all keys */
  pathPrefix?: string
}

// Stub implementation for TDD RED phase
export function createPresignedUrlGenerator(
  _config: PresignedUrlGeneratorConfig
): PresignedUrlGenerator {
  return {
    async generateUploadUrl(_options: PresignedUrlOptions): Promise<PresignedUploadUrl> {
      throw new Error('Not implemented: generateUploadUrl')
    },
    async generateDownloadUrl(_options: PresignedUrlOptions): Promise<PresignedDownloadUrl> {
      throw new Error('Not implemented: generateDownloadUrl')
    },
    async initChunkedUpload(
      _key: string,
      _options?: Partial<PresignedUrlOptions>
    ): Promise<ChunkedUploadInit> {
      throw new Error('Not implemented: initChunkedUpload')
    },
    async generatePartUploadUrl(
      _uploadId: string,
      _partNumber: number,
      _options?: Partial<PresignedUrlOptions>
    ): Promise<ChunkedUploadPartUrl> {
      throw new Error('Not implemented: generatePartUploadUrl')
    },
    async completeChunkedUpload(
      _uploadId: string,
      _parts: Array<{ partNumber: number; etag: string }>
    ): Promise<{ key: string; etag: string }> {
      throw new Error('Not implemented: completeChunkedUpload')
    },
    async abortChunkedUpload(_uploadId: string): Promise<void> {
      throw new Error('Not implemented: abortChunkedUpload')
    },
    async validateUrl(_url: string): Promise<{ valid: boolean; reason?: string }> {
      throw new Error('Not implemented: validateUrl')
    },
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestGenerator(): PresignedUrlGenerator {
  return createPresignedUrlGenerator({
    bucket: 'test-media-bucket',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    region: 'auto',
  })
}

// =============================================================================
// Presigned URL Generator Factory Tests
// =============================================================================

describe('MediaPipeline Presigned URLs', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // Factory Tests
  // ===========================================================================

  describe('factory', () => {
    it('should create a presigned URL generator instance', () => {
      const gen = createPresignedUrlGenerator({
        bucket: 'my-bucket',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secretkey',
      })

      expect(gen).toBeDefined()
      expect(typeof gen.generateUploadUrl).toBe('function')
      expect(typeof gen.generateDownloadUrl).toBe('function')
      expect(typeof gen.initChunkedUpload).toBe('function')
      expect(typeof gen.validateUrl).toBe('function')
    })

    it('should accept configuration options', () => {
      const gen = createPresignedUrlGenerator({
        bucket: 'my-bucket',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secretkey',
        endpoint: 'https://custom-endpoint.example.com',
        region: 'us-east-1',
        defaultExpiry: 3600,
        maxExpiry: 86400,
        pathPrefix: 'uploads/',
      })

      expect(gen).toBeDefined()
    })

    it('should use R2-compatible defaults for Cloudflare R2', () => {
      const gen = createPresignedUrlGenerator({
        bucket: 'my-bucket',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secretkey',
        endpoint: 'https://account.r2.cloudflarestorage.com',
      })

      expect(gen).toBeDefined()
    })
  })

  // ===========================================================================
  // Upload URL Generation Tests
  // ===========================================================================

  describe('upload URL generation', () => {
    describe('basic upload URLs', () => {
      it('should generate a valid presigned upload URL', async () => {
        const result = await generator.generateUploadUrl({
          key: 'images/photo.jpg',
        })

        expect(result).toBeDefined()
        expect(result.url).toContain('images/photo.jpg')
        expect(result.method).toBe('PUT')
        expect(result.key).toBe('images/photo.jpg')
      })

      it('should include required AWS Signature V4 parameters', async () => {
        const result = await generator.generateUploadUrl({
          key: 'documents/file.pdf',
          expiresIn: 3600,
        })

        const url = new URL(result.url)
        expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
        expect(url.searchParams.get('X-Amz-Credential')).toBeDefined()
        expect(url.searchParams.get('X-Amz-Date')).toBeDefined()
        expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
        expect(url.searchParams.get('X-Amz-SignedHeaders')).toBeDefined()
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
      })

      it('should use the configured bucket and endpoint', async () => {
        const result = await generator.generateUploadUrl({
          key: 'test.txt',
        })

        expect(result.url).toContain('r2.cloudflarestorage.com')
        expect(result.url).toContain('test-media-bucket')
      })

      it('should set expiration timestamp correctly', async () => {
        const result = await generator.generateUploadUrl({
          key: 'test.txt',
          expiresIn: 3600,
        })

        const expectedExpiry = new Date('2025-01-15T11:00:00Z') // 1 hour later
        expect(result.expiresAt.getTime()).toBe(expectedExpiry.getTime())
      })
    })

    describe('content type handling', () => {
      it('should include Content-Type header for uploads', async () => {
        const result = await generator.generateUploadUrl({
          key: 'images/photo.jpg',
          contentType: 'image/jpeg',
        })

        expect(result.headers['Content-Type']).toBe('image/jpeg')
      })

      it('should include Content-Type in signed headers', async () => {
        const result = await generator.generateUploadUrl({
          key: 'data.json',
          contentType: 'application/json',
        })

        const url = new URL(result.url)
        const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')
        expect(signedHeaders).toContain('content-type')
      })

      it('should auto-detect content type from file extension', async () => {
        const result = await generator.generateUploadUrl({
          key: 'video/clip.mp4',
        })

        expect(result.headers['Content-Type']).toBe('video/mp4')
      })

      it('should allow overriding auto-detected content type', async () => {
        const result = await generator.generateUploadUrl({
          key: 'video/clip.mp4',
          contentType: 'application/octet-stream',
        })

        expect(result.headers['Content-Type']).toBe('application/octet-stream')
      })
    })

    describe('content length restrictions', () => {
      it('should include max content length in headers when specified', async () => {
        const result = await generator.generateUploadUrl({
          key: 'uploads/image.png',
          maxContentLength: 10 * 1024 * 1024, // 10 MB
        })

        expect(result.maxContentLength).toBe(10 * 1024 * 1024)
      })

      it('should validate max content length is positive', async () => {
        await expect(
          generator.generateUploadUrl({
            key: 'test.txt',
            maxContentLength: -100,
          })
        ).rejects.toThrow(/positive|invalid/i)
      })

      it('should validate max content length does not exceed bucket limit', async () => {
        await expect(
          generator.generateUploadUrl({
            key: 'huge.bin',
            maxContentLength: 10 * 1024 * 1024 * 1024 * 1024, // 10 TB - too large
          })
        ).rejects.toThrow(/exceed|limit|too large/i)
      })

      it('should support min content length for validation', async () => {
        const result = await generator.generateUploadUrl({
          key: 'data.bin',
          minContentLength: 1024,
          maxContentLength: 1024 * 1024,
        })

        expect(result).toBeDefined()
        // Min content length should be enforced during upload
      })

      it('should reject min > max content length', async () => {
        await expect(
          generator.generateUploadUrl({
            key: 'test.txt',
            minContentLength: 1000,
            maxContentLength: 500,
          })
        ).rejects.toThrow(/min.*max|invalid range/i)
      })
    })

    describe('metadata handling', () => {
      it('should include custom metadata in signed headers', async () => {
        const result = await generator.generateUploadUrl({
          key: 'user-uploads/file.pdf',
          metadata: {
            'user-id': 'user-123',
            'upload-source': 'web-app',
          },
        })

        expect(result.headers['x-amz-meta-user-id']).toBe('user-123')
        expect(result.headers['x-amz-meta-upload-source']).toBe('web-app')
      })

      it('should normalize metadata keys to lowercase', async () => {
        const result = await generator.generateUploadUrl({
          key: 'test.txt',
          metadata: {
            'User-Name': 'John',
          },
        })

        expect(result.headers['x-amz-meta-user-name']).toBe('John')
        expect(result.headers['x-amz-meta-User-Name']).toBeUndefined()
      })

      it('should validate metadata key format', async () => {
        await expect(
          generator.generateUploadUrl({
            key: 'test.txt',
            metadata: {
              'invalid key with spaces': 'value',
            },
          })
        ).rejects.toThrow(/metadata.*key|invalid/i)
      })

      it('should enforce metadata size limits', async () => {
        const largeValue = 'x'.repeat(10000)

        await expect(
          generator.generateUploadUrl({
            key: 'test.txt',
            metadata: {
              'large-value': largeValue,
            },
          })
        ).rejects.toThrow(/metadata.*size|too large/i)
      })
    })

    describe('required headers', () => {
      it('should include required headers in the signature', async () => {
        const result = await generator.generateUploadUrl({
          key: 'secure/file.bin',
          requiredHeaders: {
            'x-amz-checksum-sha256': 'required',
          },
        })

        const url = new URL(result.url)
        const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')
        expect(signedHeaders).toContain('x-amz-checksum-sha256')
      })

      it('should include cache control in required headers', async () => {
        const result = await generator.generateUploadUrl({
          key: 'assets/logo.png',
          requiredHeaders: {
            'Cache-Control': 'max-age=31536000',
          },
        })

        expect(result.headers['Cache-Control']).toBe('max-age=31536000')
      })
    })
  })

  // ===========================================================================
  // Download URL Generation Tests
  // ===========================================================================

  describe('download URL generation', () => {
    describe('basic download URLs', () => {
      it('should generate a valid presigned download URL', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'images/photo.jpg',
        })

        expect(result).toBeDefined()
        expect(result.url).toContain('images/photo.jpg')
        expect(result.method).toBe('GET')
        expect(result.key).toBe('images/photo.jpg')
      })

      it('should include all AWS Signature V4 parameters', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'documents/report.pdf',
          expiresIn: 7200,
        })

        const url = new URL(result.url)
        expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
        expect(url.searchParams.get('X-Amz-Credential')).toBeDefined()
        expect(url.searchParams.get('X-Amz-Date')).toBe('20250115T100000Z')
        expect(url.searchParams.get('X-Amz-Expires')).toBe('7200')
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
      })

      it('should set expiration timestamp correctly', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'test.txt',
          expiresIn: 1800,
        })

        const expectedExpiry = new Date('2025-01-15T10:30:00Z')
        expect(result.expiresAt.getTime()).toBe(expectedExpiry.getTime())
      })
    })

    describe('response header overrides', () => {
      it('should include response-content-disposition for download filename', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'uploads/abc123.pdf',
          responseContentDisposition: 'attachment; filename="report-2025.pdf"',
        })

        const url = new URL(result.url)
        expect(url.searchParams.get('response-content-disposition')).toBe(
          'attachment; filename="report-2025.pdf"'
        )
      })

      it('should include response-content-type for custom MIME type', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'data/export.csv',
          responseContentType: 'text/csv; charset=utf-8',
        })

        const url = new URL(result.url)
        expect(url.searchParams.get('response-content-type')).toBe('text/csv; charset=utf-8')
      })

      it('should include response-cache-control for caching hints', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'assets/image.png',
          responseCacheControl: 'public, max-age=3600',
        })

        const url = new URL(result.url)
        expect(url.searchParams.get('response-cache-control')).toBe('public, max-age=3600')
      })

      it('should support inline content disposition', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'documents/preview.pdf',
          responseContentDisposition: 'inline',
        })

        const url = new URL(result.url)
        expect(url.searchParams.get('response-content-disposition')).toBe('inline')
      })
    })

    describe('path handling', () => {
      it('should properly encode special characters in key', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'uploads/file with spaces.txt',
        })

        expect(result.url).toContain('file%20with%20spaces.txt')
      })

      it('should handle deeply nested paths', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'a/b/c/d/e/f/deep-file.txt',
        })

        expect(result.url).toContain('a/b/c/d/e/f/deep-file.txt')
      })

      it('should handle unicode characters in key', async () => {
        const result = await generator.generateDownloadUrl({
          key: 'uploads/documento-espanol.pdf',
        })

        expect(result.url).toContain('documento-espa')
      })

      it('should apply path prefix from configuration', async () => {
        const prefixedGen = createPresignedUrlGenerator({
          bucket: 'my-bucket',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: 'secretkey',
          pathPrefix: 'media/',
        })

        const result = await prefixedGen.generateDownloadUrl({
          key: 'images/photo.jpg',
        })

        expect(result.url).toContain('media/images/photo.jpg')
      })
    })
  })

  // ===========================================================================
  // Expiration Handling Tests
  // ===========================================================================

  describe('expiration handling', () => {
    it('should use default expiration (900 seconds) when not specified', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
      })

      const url = new URL(result.url)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    })

    it('should accept custom expiration in seconds', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 7200,
      })

      const url = new URL(result.url)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('7200')
    })

    it('should accept expiresAt date option', async () => {
      const expiresAt = new Date('2025-01-15T14:00:00Z') // 4 hours from now

      const result = await generator.generateUploadUrl({
        key: 'test.txt',
        expiresAt,
      })

      const url = new URL(result.url)
      const expires = parseInt(url.searchParams.get('X-Amz-Expires') || '0')
      expect(expires).toBe(14400) // 4 hours in seconds
    })

    it('should throw error for expiration exceeding 7 days', async () => {
      await expect(
        generator.generateUploadUrl({
          key: 'test.txt',
          expiresIn: 604801, // 7 days + 1 second
        })
      ).rejects.toThrow(/exceed.*7 days/i)
    })

    it('should throw error for zero or negative expiration', async () => {
      await expect(
        generator.generateUploadUrl({
          key: 'test.txt',
          expiresIn: 0,
        })
      ).rejects.toThrow(/positive/i)

      await expect(
        generator.generateUploadUrl({
          key: 'test.txt',
          expiresIn: -100,
        })
      ).rejects.toThrow(/positive/i)
    })

    it('should throw error when expiresAt is in the past', async () => {
      const pastDate = new Date('2025-01-15T08:00:00Z') // 2 hours ago

      await expect(
        generator.generateUploadUrl({
          key: 'test.txt',
          expiresAt: pastDate,
        })
      ).rejects.toThrow(/past|expired|positive/i)
    })

    it('should allow maximum expiration of exactly 7 days', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 604800, // exactly 7 days
      })

      const url = new URL(result.url)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('604800')
    })

    it('should use configured default expiry', async () => {
      const customGen = createPresignedUrlGenerator({
        bucket: 'my-bucket',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secretkey',
        defaultExpiry: 3600,
      })

      const result = await customGen.generateUploadUrl({
        key: 'test.txt',
      })

      const url = new URL(result.url)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    })

    it('should respect configured max expiry', async () => {
      const customGen = createPresignedUrlGenerator({
        bucket: 'my-bucket',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secretkey',
        maxExpiry: 3600, // 1 hour max
      })

      await expect(
        customGen.generateUploadUrl({
          key: 'test.txt',
          expiresIn: 7200, // 2 hours - exceeds max
        })
      ).rejects.toThrow(/exceed.*max/i)
    })
  })

  // ===========================================================================
  // Chunked/Multipart Upload Tests
  // ===========================================================================

  describe('chunked upload', () => {
    describe('initialization', () => {
      it('should initialize a chunked upload', async () => {
        const result = await generator.initChunkedUpload('large-video/movie.mp4', {
          contentType: 'video/mp4',
        })

        expect(result).toBeDefined()
        expect(result.uploadId).toBeDefined()
        expect(typeof result.uploadId).toBe('string')
        expect(result.uploadId.length).toBeGreaterThan(0)
        expect(result.key).toBe('large-video/movie.mp4')
        expect(result.expiresAt).toBeInstanceOf(Date)
      })

      it('should generate unique upload IDs', async () => {
        const result1 = await generator.initChunkedUpload('file1.mp4')
        const result2 = await generator.initChunkedUpload('file2.mp4')

        expect(result1.uploadId).not.toBe(result2.uploadId)
      })

      it('should include content type in upload initialization', async () => {
        const result = await generator.initChunkedUpload('video.mp4', {
          contentType: 'video/mp4',
        })

        expect(result).toBeDefined()
        expect(result.uploadId).toBeDefined()
      })

      it('should include metadata in upload initialization', async () => {
        const result = await generator.initChunkedUpload('document.pdf', {
          metadata: {
            'user-id': 'user-123',
            'source': 'upload-api',
          },
        })

        expect(result).toBeDefined()
        expect(result.uploadId).toBeDefined()
      })
    })

    describe('part upload URLs', () => {
      it('should generate presigned URL for part upload', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')
        const partUrl = await generator.generatePartUploadUrl(init.uploadId, 1)

        expect(partUrl).toBeDefined()
        expect(partUrl.url).toBeDefined()
        expect(partUrl.partNumber).toBe(1)
        expect(partUrl.headers).toBeDefined()
        expect(partUrl.expiresAt).toBeInstanceOf(Date)
      })

      it('should include part number in URL', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')
        const partUrl = await generator.generatePartUploadUrl(init.uploadId, 5)

        const url = new URL(partUrl.url)
        expect(url.searchParams.get('partNumber')).toBe('5')
        expect(url.searchParams.get('uploadId')).toBe(init.uploadId)
      })

      it('should generate different URLs for different parts', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        const part1 = await generator.generatePartUploadUrl(init.uploadId, 1)
        const part2 = await generator.generatePartUploadUrl(init.uploadId, 2)

        expect(part1.url).not.toBe(part2.url)
      })

      it('should support part numbers 1-10000', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        // Part 1
        const part1 = await generator.generatePartUploadUrl(init.uploadId, 1)
        expect(part1.partNumber).toBe(1)

        // Part 10000 (maximum)
        const part10000 = await generator.generatePartUploadUrl(init.uploadId, 10000)
        expect(part10000.partNumber).toBe(10000)
      })

      it('should reject invalid part numbers', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        // Part 0 - invalid
        await expect(generator.generatePartUploadUrl(init.uploadId, 0)).rejects.toThrow(
          /part.*number|invalid/i
        )

        // Part 10001 - exceeds maximum
        await expect(generator.generatePartUploadUrl(init.uploadId, 10001)).rejects.toThrow(
          /part.*number|maximum|exceed/i
        )

        // Negative part number
        await expect(generator.generatePartUploadUrl(init.uploadId, -1)).rejects.toThrow(
          /part.*number|invalid/i
        )
      })

      it('should reject invalid upload ID', async () => {
        await expect(
          generator.generatePartUploadUrl('invalid-upload-id', 1)
        ).rejects.toThrow(/upload.*id|not found|invalid/i)
      })
    })

    describe('completing uploads', () => {
      it('should complete a chunked upload with parts', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        const result = await generator.completeChunkedUpload(init.uploadId, [
          { partNumber: 1, etag: '"abc123"' },
          { partNumber: 2, etag: '"def456"' },
          { partNumber: 3, etag: '"ghi789"' },
        ])

        expect(result).toBeDefined()
        expect(result.key).toBe('large-file.bin')
        expect(result.etag).toBeDefined()
      })

      it('should require parts in order', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        await expect(
          generator.completeChunkedUpload(init.uploadId, [
            { partNumber: 2, etag: '"abc"' },
            { partNumber: 1, etag: '"def"' },
          ])
        ).rejects.toThrow(/order|sequence/i)
      })

      it('should reject completion with no parts', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        await expect(generator.completeChunkedUpload(init.uploadId, [])).rejects.toThrow(
          /part|empty/i
        )
      })

      it('should reject invalid upload ID on completion', async () => {
        await expect(
          generator.completeChunkedUpload('invalid-id', [{ partNumber: 1, etag: '"abc"' }])
        ).rejects.toThrow(/upload.*id|not found|invalid/i)
      })
    })

    describe('aborting uploads', () => {
      it('should abort a chunked upload', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')

        await expect(generator.abortChunkedUpload(init.uploadId)).resolves.toBeUndefined()
      })

      it('should reject invalid upload ID on abort', async () => {
        await expect(generator.abortChunkedUpload('invalid-id')).rejects.toThrow(
          /upload.*id|not found|invalid/i
        )
      })

      it('should prevent part uploads after abort', async () => {
        const init = await generator.initChunkedUpload('large-file.bin')
        await generator.abortChunkedUpload(init.uploadId)

        await expect(generator.generatePartUploadUrl(init.uploadId, 1)).rejects.toThrow(
          /aborted|not found|invalid/i
        )
      })
    })
  })

  // ===========================================================================
  // Permission Tests
  // ===========================================================================

  describe('permissions', () => {
    it('should generate read-only URL by default for downloads', async () => {
      const result = await generator.generateDownloadUrl({
        key: 'file.txt',
      })

      expect(result.method).toBe('GET')
    })

    it('should generate write-only URL for uploads', async () => {
      const result = await generator.generateUploadUrl({
        key: 'file.txt',
      })

      expect(result.method).toBe('PUT')
    })

    it('should support explicit read permission', async () => {
      const result = await generator.generateDownloadUrl({
        key: 'file.txt',
        permission: 'read',
      })

      expect(result.method).toBe('GET')
    })

    it('should support explicit write permission', async () => {
      const result = await generator.generateUploadUrl({
        key: 'file.txt',
        permission: 'write',
      })

      expect(result.method).toBe('PUT')
    })

    it('should reject read permission for upload URL', async () => {
      await expect(
        generator.generateUploadUrl({
          key: 'file.txt',
          permission: 'read',
        })
      ).rejects.toThrow(/permission|invalid/i)
    })

    it('should reject write permission for download URL', async () => {
      await expect(
        generator.generateDownloadUrl({
          key: 'file.txt',
          permission: 'write',
        })
      ).rejects.toThrow(/permission|invalid/i)
    })
  })

  // ===========================================================================
  // URL Validation Tests
  // ===========================================================================

  describe('URL validation', () => {
    it('should validate a valid presigned URL', async () => {
      const { url } = await generator.generateDownloadUrl({
        key: 'test.txt',
        expiresIn: 3600,
      })

      const result = await generator.validateUrl(url)

      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should reject expired URLs', async () => {
      const { url } = await generator.generateDownloadUrl({
        key: 'test.txt',
        expiresIn: 60,
      })

      // Advance time past expiration
      vi.advanceTimersByTime(120 * 1000) // 2 minutes

      const result = await generator.validateUrl(url)

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/expired/i)
    })

    it('should reject URLs with invalid signatures', async () => {
      const { url } = await generator.generateDownloadUrl({
        key: 'test.txt',
      })

      // Tamper with the signature
      const tamperedUrl = url.replace(/X-Amz-Signature=[^&]+/, 'X-Amz-Signature=invalid')

      const result = await generator.validateUrl(tamperedUrl)

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/signature|invalid/i)
    })

    it('should reject URLs with tampered parameters', async () => {
      const { url } = await generator.generateDownloadUrl({
        key: 'test.txt',
      })

      // Tamper with the expiration
      const tamperedUrl = url.replace(/X-Amz-Expires=\d+/, 'X-Amz-Expires=999999')

      const result = await generator.validateUrl(tamperedUrl)

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/signature|tampered|invalid/i)
    })

    it('should reject URLs with missing parameters', async () => {
      const { url } = await generator.generateDownloadUrl({
        key: 'test.txt',
      })

      // Remove signature
      const incompleteUrl = url.replace(/&?X-Amz-Signature=[^&]+/, '')

      const result = await generator.validateUrl(incompleteUrl)

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/missing|signature|invalid/i)
    })

    it('should reject URLs for different bucket', async () => {
      // Generate URL with different bucket
      const otherGen = createPresignedUrlGenerator({
        bucket: 'other-bucket',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })

      const { url } = await otherGen.generateDownloadUrl({
        key: 'test.txt',
      })

      const result = await generator.validateUrl(url)

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/bucket|invalid/i)
    })

    it('should handle malformed URLs gracefully', async () => {
      const result = await generator.validateUrl('not-a-valid-url')

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/malformed|invalid|parse/i)
    })

    it('should handle URLs without query parameters', async () => {
      const result = await generator.validateUrl('https://example.com/file.txt')

      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/missing|parameter|invalid/i)
    })
  })

  // ===========================================================================
  // Security Tests
  // ===========================================================================

  describe('security', () => {
    it('should not leak secret access key in URL', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
      })

      expect(result.url).not.toContain('wJalrXUtnFEMI')
      expect(result.url).not.toContain('secretAccessKey')
    })

    it('should only include access key ID in credential', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
      })

      const url = new URL(result.url)
      const credential = url.searchParams.get('X-Amz-Credential')
      expect(credential).toContain('AKIAIOSFODNN7EXAMPLE')
    })

    it('should encode path traversal attempts', async () => {
      const result = await generator.generateUploadUrl({
        key: '../../../etc/passwd',
      })

      // Path traversal should be encoded, not interpreted
      expect(result.url).not.toContain('/../')
    })

    it('should reject null bytes in key', async () => {
      await expect(
        generator.generateUploadUrl({
          key: 'test\0file.txt',
        })
      ).rejects.toThrow(/null|invalid/i)
    })

    it('should reject keys exceeding maximum length', async () => {
      const longKey = 'a'.repeat(1025)

      await expect(
        generator.generateUploadUrl({
          key: longKey,
        })
      ).rejects.toThrow(/key.*length|too long/i)
    })

    it('should produce different signatures for different keys', async () => {
      const result1 = await generator.generateUploadUrl({ key: 'file1.txt' })
      const result2 = await generator.generateUploadUrl({ key: 'file2.txt' })

      const sig1 = new URL(result1.url).searchParams.get('X-Amz-Signature')
      const sig2 = new URL(result2.url).searchParams.get('X-Amz-Signature')

      expect(sig1).not.toBe(sig2)
    })

    it('should produce deterministic signatures for same inputs', async () => {
      const result1 = await generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 3600,
      })

      const result2 = await generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 3600,
      })

      expect(result1.url).toBe(result2.url)
    })
  })

  // ===========================================================================
  // Media-Specific Tests
  // ===========================================================================

  describe('media-specific features', () => {
    it('should auto-detect content type for common image formats', async () => {
      const formats: Record<string, string> = {
        'photo.jpg': 'image/jpeg',
        'photo.jpeg': 'image/jpeg',
        'logo.png': 'image/png',
        'banner.gif': 'image/gif',
        'hero.webp': 'image/webp',
        'icon.svg': 'image/svg+xml',
        'photo.avif': 'image/avif',
      }

      for (const [filename, expectedType] of Object.entries(formats)) {
        const result = await generator.generateUploadUrl({
          key: `images/${filename}`,
        })
        expect(result.headers['Content-Type']).toBe(expectedType)
      }
    })

    it('should auto-detect content type for common video formats', async () => {
      const formats: Record<string, string> = {
        'video.mp4': 'video/mp4',
        'video.webm': 'video/webm',
        'video.mov': 'video/quicktime',
        'video.avi': 'video/x-msvideo',
        'video.mkv': 'video/x-matroska',
      }

      for (const [filename, expectedType] of Object.entries(formats)) {
        const result = await generator.generateUploadUrl({
          key: `videos/${filename}`,
        })
        expect(result.headers['Content-Type']).toBe(expectedType)
      }
    })

    it('should auto-detect content type for common audio formats', async () => {
      const formats: Record<string, string> = {
        'song.mp3': 'audio/mpeg',
        'track.wav': 'audio/wav',
        'music.ogg': 'audio/ogg',
        'podcast.m4a': 'audio/mp4',
        'sound.flac': 'audio/flac',
      }

      for (const [filename, expectedType] of Object.entries(formats)) {
        const result = await generator.generateUploadUrl({
          key: `audio/${filename}`,
        })
        expect(result.headers['Content-Type']).toBe(expectedType)
      }
    })

    it('should auto-detect content type for common document formats', async () => {
      const formats: Record<string, string> = {
        'doc.pdf': 'application/pdf',
        'doc.docx':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'sheet.xlsx':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'slides.pptx':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }

      for (const [filename, expectedType] of Object.entries(formats)) {
        const result = await generator.generateUploadUrl({
          key: `documents/${filename}`,
        })
        expect(result.headers['Content-Type']).toBe(expectedType)
      }
    })

    it('should fall back to application/octet-stream for unknown extensions', async () => {
      const result = await generator.generateUploadUrl({
        key: 'file.unknown',
      })

      expect(result.headers['Content-Type']).toBe('application/octet-stream')
    })

    it('should support presigned URLs for thumbnail generation workflow', async () => {
      // Upload original
      const uploadUrl = await generator.generateUploadUrl({
        key: 'images/original/photo-123.jpg',
        contentType: 'image/jpeg',
        metadata: {
          'original-filename': 'vacation.jpg',
          'user-id': 'user-456',
        },
      })

      expect(uploadUrl).toBeDefined()

      // Download for processing
      const downloadUrl = await generator.generateDownloadUrl({
        key: 'images/original/photo-123.jpg',
      })

      expect(downloadUrl).toBeDefined()

      // Upload thumbnail
      const thumbnailUrl = await generator.generateUploadUrl({
        key: 'images/thumbs/photo-123-200x200.jpg',
        contentType: 'image/jpeg',
        metadata: {
          'source-key': 'images/original/photo-123.jpg',
          'dimensions': '200x200',
        },
      })

      expect(thumbnailUrl).toBeDefined()
    })
  })
})
