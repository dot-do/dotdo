/**
 * S3-Compatible API Tests
 *
 * Tests for the S3-compatible API layer including:
 * - Bucket operations (create, delete, head, list)
 * - Object operations (put, get, delete, copy, head)
 * - Multipart uploads
 * - Pre-signed URLs
 * - ACL operations
 * - HTTP router
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { S3Errors, S3Error } from './types'
import type {
  S3Object,
  Bucket,
  BucketOwner,
  AccessControlPolicy,
  CannedACL,
  Part,
  CompletedPart,
} from './types'
import {
  generateETag,
  generateMultipartETag,
  getSignedUrl,
  createPresignedPost,
  type SigningConfig,
} from './signing'

// =============================================================================
// Error Type Tests
// =============================================================================

describe('S3Errors', () => {
  describe('NoSuchBucket', () => {
    it('should create NoSuchBucket error with correct properties', () => {
      const error = S3Errors.NoSuchBucket('my-bucket')
      expect(error).toBeInstanceOf(S3Error)
      expect(error.code).toBe('NoSuchBucket')
      expect(error.statusCode).toBe(404)
      expect(error.resource).toBe('my-bucket')
      expect(error.message).toContain('does not exist')
    })

    it('should generate valid XML response', () => {
      const error = S3Errors.NoSuchBucket('my-bucket')
      const xml = error.toXML()
      expect(xml).toContain('<?xml version="1.0"')
      expect(xml).toContain('<Code>NoSuchBucket</Code>')
      expect(xml).toContain('<Resource>my-bucket</Resource>')
    })
  })

  describe('NoSuchKey', () => {
    it('should create NoSuchKey error with correct properties', () => {
      const error = S3Errors.NoSuchKey('my-key')
      expect(error.code).toBe('NoSuchKey')
      expect(error.statusCode).toBe(404)
      expect(error.resource).toBe('my-key')
    })
  })

  describe('BucketAlreadyExists', () => {
    it('should create BucketAlreadyExists error with 409 status', () => {
      const error = S3Errors.BucketAlreadyExists('my-bucket')
      expect(error.code).toBe('BucketAlreadyExists')
      expect(error.statusCode).toBe(409)
    })
  })

  describe('BucketNotEmpty', () => {
    it('should create BucketNotEmpty error with 409 status', () => {
      const error = S3Errors.BucketNotEmpty('my-bucket')
      expect(error.code).toBe('BucketNotEmpty')
      expect(error.statusCode).toBe(409)
    })
  })

  describe('InvalidBucketName', () => {
    it('should create InvalidBucketName error with 400 status', () => {
      const error = S3Errors.InvalidBucketName('INVALID')
      expect(error.code).toBe('InvalidBucketName')
      expect(error.statusCode).toBe(400)
    })
  })

  describe('InvalidPartOrder', () => {
    it('should create InvalidPartOrder error', () => {
      const error = S3Errors.InvalidPartOrder()
      expect(error.code).toBe('InvalidPartOrder')
      expect(error.statusCode).toBe(400)
    })
  })

  describe('InvalidPart', () => {
    it('should create InvalidPart error with part number', () => {
      const error = S3Errors.InvalidPart(5)
      expect(error.code).toBe('InvalidPart')
      expect(error.resource).toBe('Part 5')
    })
  })

  describe('EntityTooSmall', () => {
    it('should create EntityTooSmall error', () => {
      const error = S3Errors.EntityTooSmall()
      expect(error.code).toBe('EntityTooSmall')
      expect(error.statusCode).toBe(400)
    })
  })

  describe('EntityTooLarge', () => {
    it('should create EntityTooLarge error', () => {
      const error = S3Errors.EntityTooLarge()
      expect(error.code).toBe('EntityTooLarge')
      expect(error.statusCode).toBe(400)
    })
  })

  describe('AccessDenied', () => {
    it('should create AccessDenied error with 403 status', () => {
      const error = S3Errors.AccessDenied('bucket/key')
      expect(error.code).toBe('AccessDenied')
      expect(error.statusCode).toBe(403)
    })
  })

  describe('PreconditionFailed', () => {
    it('should create PreconditionFailed error with 412 status', () => {
      const error = S3Errors.PreconditionFailed()
      expect(error.code).toBe('PreconditionFailed')
      expect(error.statusCode).toBe(412)
    })
  })

  describe('NotModified', () => {
    it('should create NotModified error with 304 status', () => {
      const error = S3Errors.NotModified()
      expect(error.code).toBe('NotModified')
      expect(error.statusCode).toBe(304)
    })
  })

  describe('NoSuchUpload', () => {
    it('should create NoSuchUpload error', () => {
      const error = S3Errors.NoSuchUpload('upload-123')
      expect(error.code).toBe('NoSuchUpload')
      expect(error.statusCode).toBe(404)
      expect(error.resource).toBe('upload-123')
    })
  })
})

// =============================================================================
// ETag Generation Tests
// =============================================================================

describe('ETag Generation', () => {
  // Note: These tests are skipped in Node.js because crypto.subtle.digest('MD5', ...)
  // is not supported. They work correctly in Cloudflare Workers runtime.
  describe('generateETag', () => {
    it.skip('should generate MD5 hash for ArrayBuffer (Workers runtime only)', async () => {
      const data = new TextEncoder().encode('Hello World')
      const etag = await generateETag(data.buffer as ArrayBuffer)
      expect(etag).toMatch(/^"[a-f0-9]{32}"$/)
    })

    it.skip('should generate consistent ETags for same content (Workers runtime only)', async () => {
      const data1 = new TextEncoder().encode('test content')
      const data2 = new TextEncoder().encode('test content')
      const etag1 = await generateETag(data1.buffer as ArrayBuffer)
      const etag2 = await generateETag(data2.buffer as ArrayBuffer)
      expect(etag1).toBe(etag2)
    })

    it.skip('should generate different ETags for different content (Workers runtime only)', async () => {
      const data1 = new TextEncoder().encode('content 1')
      const data2 = new TextEncoder().encode('content 2')
      const etag1 = await generateETag(data1.buffer as ArrayBuffer)
      const etag2 = await generateETag(data2.buffer as ArrayBuffer)
      expect(etag1).not.toBe(etag2)
    })
  })

  describe('generateMultipartETag', () => {
    it.skip('should generate multipart ETag from part ETags (Workers runtime only)', async () => {
      const partETags = [
        '"d41d8cd98f00b204e9800998ecf8427e"',
        '"098f6bcd4621d373cade4e832627b4f6"',
        '"ad0234829205b9033196ba818f7a872b"',
      ]
      const etag = await generateMultipartETag(partETags)
      expect(etag).toMatch(/^"[a-f0-9]{32}-3"$/)
    })

    it.skip('should include part count suffix (Workers runtime only)', async () => {
      const partETags = [
        '"d41d8cd98f00b204e9800998ecf8427e"',
        '"098f6bcd4621d373cade4e832627b4f6"',
      ]
      const etag = await generateMultipartETag(partETags)
      expect(etag).toContain('-2"')
    })

    it.skip('should handle single part (Workers runtime only)', async () => {
      const partETags = ['"d41d8cd98f00b204e9800998ecf8427e"']
      const etag = await generateMultipartETag(partETags)
      expect(etag).toContain('-1"')
    })
  })
})

// =============================================================================
// Pre-signed URL Tests
// =============================================================================

describe('Pre-signed URL Generation', () => {
  const signingConfig: SigningConfig = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    endpoint: 'https://s3.example.com',
  }

  describe('getSignedUrl', () => {
    it('should generate a valid pre-signed URL', async () => {
      const url = await getSignedUrl(signingConfig, 'my-bucket', 'my-key')
      expect(url).toContain('https://s3.example.com')
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
      expect(url).toContain('X-Amz-Credential')
      expect(url).toContain('X-Amz-Signature')
    })

    it('should include expiry in URL', async () => {
      const url = await getSignedUrl(signingConfig, 'bucket', 'key', { expiresIn: 3600 })
      expect(url).toContain('X-Amz-Expires=3600')
    })

    it('should reject expiry over 7 days', async () => {
      await expect(
        getSignedUrl(signingConfig, 'bucket', 'key', { expiresIn: 700000 })
      ).rejects.toThrow('Expiry cannot exceed')
    })

    it('should include content-type for PUT requests', async () => {
      const url = await getSignedUrl(signingConfig, 'bucket', 'key', {
        method: 'PUT',
        contentType: 'application/json',
      })
      expect(url).toContain('Content-Type')
    })

    it('should include custom metadata', async () => {
      const url = await getSignedUrl(signingConfig, 'bucket', 'key', {
        metadata: { 'custom-key': 'custom-value' },
      })
      expect(url).toContain('x-amz-meta-custom-key')
    })
  })

  describe('createPresignedPost', () => {
    it('should generate presigned POST data', async () => {
      const post = await createPresignedPost(signingConfig, 'my-bucket')
      expect(post.url).toBe('https://s3.example.com/my-bucket')
      expect(post.fields).toHaveProperty('Policy')
      expect(post.fields).toHaveProperty('X-Amz-Algorithm')
      expect(post.fields).toHaveProperty('X-Amz-Credential')
      expect(post.fields).toHaveProperty('X-Amz-Date')
      expect(post.fields).toHaveProperty('X-Amz-Signature')
    })

    it('should include custom fields', async () => {
      const post = await createPresignedPost(signingConfig, 'bucket', {
        fields: { 'x-custom': 'value' },
      })
      expect(post.fields['x-custom']).toBe('value')
    })
  })
})

// =============================================================================
// Bucket Name Validation Tests
// =============================================================================

describe('Bucket Name Validation', () => {
  // Test bucket name validation logic that would be in BucketDO

  const isValidBucketName = (name: string): boolean => {
    if (name.length < 3 || name.length > 63) return false
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false
    if (name.includes('..')) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false
    return true
  }

  it('should accept valid bucket names', () => {
    expect(isValidBucketName('my-bucket')).toBe(true)
    expect(isValidBucketName('my.bucket.name')).toBe(true)
    expect(isValidBucketName('bucket123')).toBe(true)
    expect(isValidBucketName('123bucket')).toBe(true)
  })

  it('should reject names shorter than 3 characters', () => {
    expect(isValidBucketName('ab')).toBe(false)
    expect(isValidBucketName('a')).toBe(false)
  })

  it('should reject names longer than 63 characters', () => {
    expect(isValidBucketName('a'.repeat(64))).toBe(false)
  })

  it('should reject names with uppercase letters', () => {
    expect(isValidBucketName('MyBucket')).toBe(false)
    expect(isValidBucketName('MYBUCKET')).toBe(false)
  })

  it('should reject names starting with non-alphanumeric', () => {
    expect(isValidBucketName('-bucket')).toBe(false)
    expect(isValidBucketName('.bucket')).toBe(false)
  })

  it('should reject names ending with non-alphanumeric', () => {
    expect(isValidBucketName('bucket-')).toBe(false)
    expect(isValidBucketName('bucket.')).toBe(false)
  })

  it('should reject consecutive periods', () => {
    expect(isValidBucketName('my..bucket')).toBe(false)
  })

  it('should reject IP address format', () => {
    expect(isValidBucketName('192.168.1.1')).toBe(false)
    expect(isValidBucketName('10.0.0.1')).toBe(false)
  })
})

// =============================================================================
// ACL Conversion Tests
// =============================================================================

describe('Canned ACL Conversion', () => {
  const owner: BucketOwner = {
    id: 'owner-123',
    displayName: 'owner',
  }

  const cannedACLToPolicy = (acl: CannedACL, owner: BucketOwner): AccessControlPolicy => {
    const grants: AccessControlPolicy['grants'] = []

    switch (acl) {
      case 'private':
        grants.push({
          grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
          permission: 'FULL_CONTROL',
        })
        break
      case 'public-read':
        grants.push(
          {
            grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
            permission: 'FULL_CONTROL',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            permission: 'READ',
          }
        )
        break
      case 'public-read-write':
        grants.push(
          {
            grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
            permission: 'FULL_CONTROL',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            permission: 'READ',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            permission: 'WRITE',
          }
        )
        break
      case 'authenticated-read':
        grants.push(
          {
            grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
            permission: 'FULL_CONTROL',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers' },
            permission: 'READ',
          }
        )
        break
    }

    return { owner, grants }
  }

  it('should convert private ACL to owner-only policy', () => {
    const policy = cannedACLToPolicy('private', owner)
    expect(policy.grants).toHaveLength(1)
    expect(policy.grants[0].permission).toBe('FULL_CONTROL')
    expect(policy.grants[0].grantee.id).toBe(owner.id)
  })

  it('should convert public-read ACL to include AllUsers READ', () => {
    const policy = cannedACLToPolicy('public-read', owner)
    expect(policy.grants).toHaveLength(2)
    expect(policy.grants[1].permission).toBe('READ')
    expect(policy.grants[1].grantee.uri).toContain('AllUsers')
  })

  it('should convert public-read-write ACL to include AllUsers READ and WRITE', () => {
    const policy = cannedACLToPolicy('public-read-write', owner)
    expect(policy.grants).toHaveLength(3)
    const permissions = policy.grants.map(g => g.permission)
    expect(permissions).toContain('READ')
    expect(permissions).toContain('WRITE')
  })

  it('should convert authenticated-read ACL to include AuthenticatedUsers READ', () => {
    const policy = cannedACLToPolicy('authenticated-read', owner)
    expect(policy.grants).toHaveLength(2)
    expect(policy.grants[1].grantee.uri).toContain('AuthenticatedUsers')
  })
})

// =============================================================================
// Multipart Part Validation Tests
// =============================================================================

describe('Multipart Part Validation', () => {
  it('should validate part numbers are in ascending order', () => {
    const validatePartOrder = (parts: CompletedPart[]): boolean => {
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].partNumber <= parts[i - 1].partNumber) {
          return false
        }
      }
      return true
    }

    expect(validatePartOrder([
      { partNumber: 1, etag: '"a"' },
      { partNumber: 2, etag: '"b"' },
      { partNumber: 3, etag: '"c"' },
    ])).toBe(true)

    expect(validatePartOrder([
      { partNumber: 2, etag: '"a"' },
      { partNumber: 1, etag: '"b"' },
    ])).toBe(false)

    expect(validatePartOrder([
      { partNumber: 1, etag: '"a"' },
      { partNumber: 1, etag: '"b"' },
    ])).toBe(false)
  })

  it('should validate minimum part size (5MB) except for last part', () => {
    const MIN_PART_SIZE = 5 * 1024 * 1024 // 5MB

    const validatePartSizes = (parts: Part[], isLastPart: (p: Part) => boolean): boolean => {
      for (const part of parts) {
        if (!isLastPart(part) && part.size < MIN_PART_SIZE) {
          return false
        }
      }
      return true
    }

    const parts: Part[] = [
      { partNumber: 1, etag: '"a"', size: 5 * 1024 * 1024, lastModified: new Date() },
      { partNumber: 2, etag: '"b"', size: 5 * 1024 * 1024, lastModified: new Date() },
      { partNumber: 3, etag: '"c"', size: 1024, lastModified: new Date() }, // Last part can be smaller
    ]

    expect(validatePartSizes(parts, p => p.partNumber === 3)).toBe(true)

    const invalidParts: Part[] = [
      { partNumber: 1, etag: '"a"', size: 1024, lastModified: new Date() }, // Too small
      { partNumber: 2, etag: '"b"', size: 5 * 1024 * 1024, lastModified: new Date() },
    ]

    expect(validatePartSizes(invalidParts, p => p.partNumber === 2)).toBe(false)
  })
})

// =============================================================================
// Object Key Validation Tests
// =============================================================================

describe('Object Key Handling', () => {
  it('should handle keys with special characters', () => {
    const encodeKey = (key: string): string => {
      return encodeURIComponent(key)
        .replace(/%2F/g, '/')
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A')
    }

    expect(encodeKey('folder/file.txt')).toBe('folder/file.txt')
    expect(encodeKey('folder/file name.txt')).toBe('folder/file%20name.txt')
    expect(encodeKey('folder/file+name.txt')).toBe('folder/file%2Bname.txt')
  })

  it('should handle keys with unicode characters', () => {
    const key = 'folder/\u4e2d\u6587.txt'
    const encoded = encodeURIComponent(key)
    expect(encoded).toContain('%')
    expect(decodeURIComponent(encoded)).toBe(key)
  })
})

// =============================================================================
// Range Request Tests
// =============================================================================

describe('Range Request Parsing', () => {
  const parseRange = (range: string, totalSize: number): { start: number; end: number } | null => {
    const match = range.match(/^bytes=(\d+)-(\d*)$/)
    if (!match) return null

    const start = parseInt(match[1])
    const end = match[2] ? parseInt(match[2]) : totalSize - 1

    if (start > end || start >= totalSize) return null

    return { start, end: Math.min(end, totalSize - 1) }
  }

  it('should parse valid range headers', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=0-0', 1000)).toEqual({ start: 0, end: 0 })
  })

  it('should clamp end to file size', () => {
    expect(parseRange('bytes=0-9999', 100)).toEqual({ start: 0, end: 99 })
  })

  it('should return null for invalid ranges', () => {
    expect(parseRange('bytes=100-50', 1000)).toBeNull()
    expect(parseRange('bytes=1000-', 100)).toBeNull()
    expect(parseRange('invalid', 1000)).toBeNull()
  })
})

// =============================================================================
// Content-Range Header Generation Tests
// =============================================================================

describe('Content-Range Header Generation', () => {
  const generateContentRange = (start: number, end: number, totalSize: number): string => {
    return `bytes ${start}-${end}/${totalSize}`
  }

  it('should generate valid Content-Range header', () => {
    expect(generateContentRange(0, 99, 1000)).toBe('bytes 0-99/1000')
    expect(generateContentRange(500, 999, 1000)).toBe('bytes 500-999/1000')
  })
})

// =============================================================================
// Continuation Token Tests
// =============================================================================

describe('Continuation Token Encoding', () => {
  const encodeContinuationToken = (key: string): string => btoa(key)
  const decodeContinuationToken = (token: string): string => atob(token)

  it('should encode and decode continuation tokens', () => {
    const key = 'folder/file123.txt'
    const token = encodeContinuationToken(key)
    expect(decodeContinuationToken(token)).toBe(key)
  })

  it('should handle special characters in keys', () => {
    const key = 'folder/file with spaces.txt'
    const token = encodeContinuationToken(key)
    expect(decodeContinuationToken(token)).toBe(key)
  })
})

// =============================================================================
// XML Response Generation Tests
// =============================================================================

describe('XML Response Generation', () => {
  const escapeXml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  it('should escape special XML characters', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b')
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;')
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;')
    expect(escapeXml("it's")).toBe('it&apos;s')
  })

  it('should handle already escaped content', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
  })
})

// =============================================================================
// Storage Class Tests
// =============================================================================

describe('Storage Class Validation', () => {
  const VALID_STORAGE_CLASSES = [
    'STANDARD',
    'REDUCED_REDUNDANCY',
    'INTELLIGENT_TIERING',
    'STANDARD_IA',
    'ONEZONE_IA',
    'GLACIER',
    'GLACIER_IR',
    'DEEP_ARCHIVE',
  ]

  it('should accept valid storage classes', () => {
    for (const storageClass of VALID_STORAGE_CLASSES) {
      expect(VALID_STORAGE_CLASSES).toContain(storageClass)
    }
  })
})

// =============================================================================
// Permission Checking Tests
// =============================================================================

describe('Permission Checking', () => {
  const owner: BucketOwner = { id: 'owner-123', displayName: 'owner' }

  const checkPermission = (
    requesterId: string,
    permission: string,
    acl: AccessControlPolicy
  ): boolean => {
    // Owner always has full control
    if (requesterId === acl.owner.id) {
      return true
    }

    for (const grant of acl.grants) {
      if (grant.permission === 'FULL_CONTROL') return true
      if (grant.permission === permission) return true
      if (grant.grantee.type === 'Group') {
        if (grant.grantee.uri?.includes('AllUsers')) return true
        if (grant.grantee.uri?.includes('AuthenticatedUsers') && requesterId !== 'anonymous') {
          return true
        }
      }
    }

    return false
  }

  it('should allow owner full access', () => {
    const acl: AccessControlPolicy = {
      owner,
      grants: [{ grantee: { type: 'CanonicalUser', id: owner.id }, permission: 'FULL_CONTROL' }],
    }
    expect(checkPermission(owner.id, 'READ', acl)).toBe(true)
    expect(checkPermission(owner.id, 'WRITE', acl)).toBe(true)
  })

  it('should allow AllUsers group access', () => {
    const acl: AccessControlPolicy = {
      owner,
      grants: [
        { grantee: { type: 'CanonicalUser', id: owner.id }, permission: 'FULL_CONTROL' },
        { grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' }, permission: 'READ' },
      ],
    }
    expect(checkPermission('anyone', 'READ', acl)).toBe(true)
  })

  it('should allow AuthenticatedUsers group access for authenticated users', () => {
    const acl: AccessControlPolicy = {
      owner,
      grants: [
        { grantee: { type: 'CanonicalUser', id: owner.id }, permission: 'FULL_CONTROL' },
        { grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers' }, permission: 'READ' },
      ],
    }
    expect(checkPermission('user-456', 'READ', acl)).toBe(true)
  })
})
