/**
 * Presigned URL Generator Tests for lib/storage
 *
 * Tests for presigned URL generation with:
 * - AWS Signature V4 compatible signing
 * - Configurable expiration
 * - Read/write permissions
 * - Secure token generation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createPresignedUrlGenerator,
  type PresignedUrlGenerator,
  type PresignedUrlGeneratorConfig,
  getContentTypeFromExtension,
} from '../presigned-urls'

// =============================================================================
// Test Helpers
// =============================================================================

const defaultConfig: PresignedUrlGeneratorConfig = {
  bucket: 'test-bucket',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  endpoint: 'https://account-id.r2.cloudflarestorage.com',
  region: 'auto',
}

function createTestGenerator(config?: Partial<PresignedUrlGeneratorConfig>): PresignedUrlGenerator {
  return createPresignedUrlGenerator({ ...defaultConfig, ...config })
}

// =============================================================================
// Factory Tests
// =============================================================================

describe('createPresignedUrlGenerator', () => {
  describe('factory', () => {
    it('should create a generator with required methods', () => {
      const generator = createTestGenerator()

      expect(generator).toBeDefined()
      expect(typeof generator.generateUploadUrl).toBe('function')
      expect(typeof generator.generateDownloadUrl).toBe('function')
      expect(typeof generator.validateUrl).toBe('function')
    })

    it('should accept custom configuration', () => {
      const generator = createTestGenerator({
        defaultExpiry: 3600,
        maxExpiry: 86400,
        pathPrefix: 'uploads/',
      })

      expect(generator).toBeDefined()
    })

    it('should work with minimal configuration', () => {
      const generator = createPresignedUrlGenerator({
        bucket: 'my-bucket',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secretkey',
      })

      expect(generator).toBeDefined()
    })
  })
})

// =============================================================================
// Upload URL Generation Tests
// =============================================================================

describe('generateUploadUrl', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

    it('should include AWS Signature V4 parameters', async () => {
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

    it('should use configured bucket and endpoint', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
      })

      expect(result.url).toContain('r2.cloudflarestorage.com')
    })

    it('should set expiration timestamp correctly', async () => {
      const result = await generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 3600,
      })

      const expectedExpiry = new Date('2025-01-15T11:00:00Z')
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
    it('should include max content length when specified', async () => {
      const result = await generator.generateUploadUrl({
        key: 'uploads/image.png',
        maxContentLength: 10 * 1024 * 1024,
      })

      expect(result.maxContentLength).toBe(10 * 1024 * 1024)
    })

    it('should reject negative max content length', async () => {
      await expect(
        generator.generateUploadUrl({
          key: 'test.txt',
          maxContentLength: -100,
        })
      ).rejects.toThrow(/positive/i)
    })

    it('should reject max content length exceeding limit', async () => {
      await expect(
        generator.generateUploadUrl({
          key: 'huge.bin',
          maxContentLength: 10 * 1024 * 1024 * 1024 * 1024,
        })
      ).rejects.toThrow(/exceed|limit/i)
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
    it('should include custom metadata in headers', async () => {
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

// =============================================================================
// Download URL Generation Tests
// =============================================================================

describe('generateDownloadUrl', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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
    it('should include response-content-disposition', async () => {
      const result = await generator.generateDownloadUrl({
        key: 'uploads/abc123.pdf',
        responseContentDisposition: 'attachment; filename="report-2025.pdf"',
      })

      const url = new URL(result.url)
      expect(url.searchParams.get('response-content-disposition')).toBe(
        'attachment; filename="report-2025.pdf"'
      )
    })

    it('should include response-content-type', async () => {
      const result = await generator.generateDownloadUrl({
        key: 'data/export.csv',
        responseContentType: 'text/csv; charset=utf-8',
      })

      const url = new URL(result.url)
      expect(url.searchParams.get('response-content-type')).toBe('text/csv; charset=utf-8')
    })

    it('should include response-cache-control', async () => {
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
    it('should properly encode special characters', async () => {
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

    it('should apply path prefix from configuration', async () => {
      const prefixedGen = createTestGenerator({
        pathPrefix: 'media/',
      })

      const result = await prefixedGen.generateDownloadUrl({
        key: 'images/photo.jpg',
      })

      expect(result.url).toContain('media/images/photo.jpg')
    })
  })
})

// =============================================================================
// Expiration Handling Tests
// =============================================================================

describe('expiration handling', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should use default expiration when not specified', async () => {
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
    const expiresAt = new Date('2025-01-15T14:00:00Z')

    const result = await generator.generateUploadUrl({
      key: 'test.txt',
      expiresAt,
    })

    const url = new URL(result.url)
    const expires = parseInt(url.searchParams.get('X-Amz-Expires') || '0')
    expect(expires).toBe(14400)
  })

  it('should throw error for expiration exceeding 7 days', async () => {
    await expect(
      generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 604801,
      })
    ).rejects.toThrow(/exceed.*7 days/i)
  })

  it('should throw error for zero expiration', async () => {
    await expect(
      generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 0,
      })
    ).rejects.toThrow(/positive/i)
  })

  it('should throw error for negative expiration', async () => {
    await expect(
      generator.generateUploadUrl({
        key: 'test.txt',
        expiresIn: -100,
      })
    ).rejects.toThrow(/positive/i)
  })

  it('should throw error when expiresAt is in the past', async () => {
    const pastDate = new Date('2025-01-15T08:00:00Z')

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
      expiresIn: 604800,
    })

    const url = new URL(result.url)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('604800')
  })

  it('should use configured default expiry', async () => {
    const customGen = createTestGenerator({
      defaultExpiry: 3600,
    })

    const result = await customGen.generateUploadUrl({
      key: 'test.txt',
    })

    const url = new URL(result.url)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
  })

  it('should respect configured max expiry', async () => {
    const customGen = createTestGenerator({
      maxExpiry: 3600,
    })

    await expect(
      customGen.generateUploadUrl({
        key: 'test.txt',
        expiresIn: 7200,
      })
    ).rejects.toThrow(/exceed.*max/i)
  })
})

// =============================================================================
// Permission Tests
// =============================================================================

describe('permissions', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should generate read-only URL for downloads', async () => {
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
    ).rejects.toThrow(/permission/i)
  })

  it('should reject write permission for download URL', async () => {
    await expect(
      generator.generateDownloadUrl({
        key: 'file.txt',
        permission: 'write',
      })
    ).rejects.toThrow(/permission/i)
  })
})

// =============================================================================
// URL Validation Tests
// =============================================================================

describe('validateUrl', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should validate a valid presigned URL', async () => {
    const { url } = await generator.generateDownloadUrl({
      key: 'test.txt',
      expiresIn: 3600,
    })

    const result = await generator.validateUrl(url)

    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.key).toBe('test.txt')
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('should reject expired URLs', async () => {
    const { url } = await generator.generateDownloadUrl({
      key: 'test.txt',
      expiresIn: 60,
    })

    vi.advanceTimersByTime(120 * 1000)

    const result = await generator.validateUrl(url)

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/expired/i)
  })

  it('should reject URLs with invalid signatures', async () => {
    const { url } = await generator.generateDownloadUrl({
      key: 'test.txt',
    })

    const tamperedUrl = url.replace(/X-Amz-Signature=[^&]+/, 'X-Amz-Signature=invalid')

    const result = await generator.validateUrl(tamperedUrl)

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/signature|invalid/i)
  })

  it('should reject URLs with tampered parameters', async () => {
    const { url } = await generator.generateDownloadUrl({
      key: 'test.txt',
    })

    const tamperedUrl = url.replace(/X-Amz-Expires=\d+/, 'X-Amz-Expires=999999')

    const result = await generator.validateUrl(tamperedUrl)

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/signature|tampered|invalid/i)
  })

  it('should reject URLs with missing parameters', async () => {
    const { url } = await generator.generateDownloadUrl({
      key: 'test.txt',
    })

    const incompleteUrl = url.replace(/&?X-Amz-Signature=[^&]+/, '')

    const result = await generator.validateUrl(incompleteUrl)

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/missing|signature|invalid/i)
  })

  it('should reject URLs for different bucket', async () => {
    // Use a different endpoint to ensure bucket mismatch is detected
    const otherGen = createTestGenerator({
      bucket: 'other-bucket',
      endpoint: 'https://other-account.r2.cloudflarestorage.com',
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

// =============================================================================
// Security Tests
// =============================================================================

describe('security', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    generator = createTestGenerator()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

// =============================================================================
// Content Type Detection Tests
// =============================================================================

describe('getContentTypeFromExtension', () => {
  it('should detect image content types', () => {
    expect(getContentTypeFromExtension('photo.jpg')).toBe('image/jpeg')
    expect(getContentTypeFromExtension('photo.jpeg')).toBe('image/jpeg')
    expect(getContentTypeFromExtension('logo.png')).toBe('image/png')
    expect(getContentTypeFromExtension('banner.gif')).toBe('image/gif')
    expect(getContentTypeFromExtension('hero.webp')).toBe('image/webp')
    expect(getContentTypeFromExtension('icon.svg')).toBe('image/svg+xml')
    expect(getContentTypeFromExtension('photo.avif')).toBe('image/avif')
  })

  it('should detect video content types', () => {
    expect(getContentTypeFromExtension('video.mp4')).toBe('video/mp4')
    expect(getContentTypeFromExtension('video.webm')).toBe('video/webm')
    expect(getContentTypeFromExtension('video.mov')).toBe('video/quicktime')
    expect(getContentTypeFromExtension('video.avi')).toBe('video/x-msvideo')
    expect(getContentTypeFromExtension('video.mkv')).toBe('video/x-matroska')
  })

  it('should detect audio content types', () => {
    expect(getContentTypeFromExtension('song.mp3')).toBe('audio/mpeg')
    expect(getContentTypeFromExtension('track.wav')).toBe('audio/wav')
    expect(getContentTypeFromExtension('music.ogg')).toBe('audio/ogg')
    expect(getContentTypeFromExtension('podcast.m4a')).toBe('audio/mp4')
    expect(getContentTypeFromExtension('sound.flac')).toBe('audio/flac')
  })

  it('should detect document content types', () => {
    expect(getContentTypeFromExtension('doc.pdf')).toBe('application/pdf')
    expect(getContentTypeFromExtension('doc.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(getContentTypeFromExtension('sheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(getContentTypeFromExtension('slides.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  })

  it('should return octet-stream for unknown extensions', () => {
    expect(getContentTypeFromExtension('file.unknown')).toBe('application/octet-stream')
    expect(getContentTypeFromExtension('file.xyz123')).toBe('application/octet-stream')
    expect(getContentTypeFromExtension('noextension')).toBe('application/octet-stream')
  })
})

// =============================================================================
// Integration with AuthorizedR2Client Pattern Tests
// =============================================================================

describe('integration patterns', () => {
  let generator: PresignedUrlGenerator

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should work with path prefix for tenant isolation', async () => {
    generator = createTestGenerator({
      pathPrefix: 'orgs/org_123/tenants/tenant_456/',
    })

    const result = await generator.generateUploadUrl({
      key: 'uploads/file.pdf',
    })

    expect(result.url).toContain('orgs/org_123/tenants/tenant_456/uploads/file.pdf')
  })

  it('should support complete upload/download workflow', async () => {
    generator = createTestGenerator()

    // Generate upload URL (minimal - without custom headers for validation)
    const uploadResult = await generator.generateUploadUrl({
      key: 'documents/report.pdf',
    })

    expect(uploadResult.method).toBe('PUT')
    expect(uploadResult.headers['Content-Type']).toBe('application/pdf') // Auto-detected

    // Generate upload URL with custom metadata (for checking generation works)
    const uploadWithMetadata = await generator.generateUploadUrl({
      key: 'documents/report2.pdf',
      contentType: 'application/pdf',
      metadata: {
        'uploaded-by': 'user-123',
        'source': 'api',
      },
    })

    expect(uploadWithMetadata.headers['Content-Type']).toBe('application/pdf')
    expect(uploadWithMetadata.headers['x-amz-meta-uploaded-by']).toBe('user-123')

    // Generate download URL
    const downloadResult = await generator.generateDownloadUrl({
      key: 'documents/report.pdf',
      responseContentDisposition: 'attachment; filename="report.pdf"',
    })

    expect(downloadResult.method).toBe('GET')
    expect(new URL(downloadResult.url).searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="report.pdf"'
    )

    // Validate download URL (full validation possible)
    const downloadValidation = await generator.validateUrl(downloadResult.url)
    expect(downloadValidation.valid).toBe(true)

    // Note: Upload URL validation with custom headers requires the header values
    // to be known at validation time. For basic upload URLs (with only content-type),
    // validation works but requires the content-type value to regenerate the signature.
    // This is a limitation of presigned URL validation - the headers are not in the URL.
  })
})
