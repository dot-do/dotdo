// AWS S3 Integration Tests
// TDD tests for AWS S3 storage integration (do-h3in)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  S3Integration,
  createS3Integration,
  type S3Config,
  type PutObjectRequest,
} from '../s3'

describe('S3Integration', () => {
  let s3: S3Integration

  beforeEach(() => {
    s3 = createS3Integration()
  })

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(s3.name).toBe('aws-s3')
      expect(s3.version).toBe('1.0.0')
    })

    it('should have correct metadata', () => {
      expect(s3.metadata.displayName).toBe('AWS S3')
      expect(s3.metadata.category).toBe('storage')
      expect(s3.metadata.requiredConfig).toContain('accessKeyId')
      expect(s3.metadata.requiredConfig).toContain('secretAccessKey')
      expect(s3.metadata.requiredConfig).toContain('region')
    })

    it('should start uninitialized', () => {
      expect(s3.status).toBe('uninitialized')
    })
  })

  describe('init', () => {
    it('should initialize with valid config', async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      }

      await s3.init(config)
      expect(s3.status).toBe('ready')
    })

    it('should reject missing accessKeyId', async () => {
      const config = {
        secretAccessKey: 'secret',
        region: 'us-east-1',
      } as S3Config

      await expect(s3.init(config)).rejects.toThrow('Access Key ID is required')
    })

    it('should reject missing secretAccessKey', async () => {
      const config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        region: 'us-east-1',
      } as S3Config

      await expect(s3.init(config)).rejects.toThrow('Secret Access Key is required')
    })

    it('should reject missing region', async () => {
      const config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
      } as S3Config

      await expect(s3.init(config)).rejects.toThrow('Region is required')
    })

    it('should accept custom endpoint for S3-compatible services', async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'auto',
        endpoint: 'https://my-r2-bucket.r2.cloudflarestorage.com',
      }

      await s3.init(config)
      expect(s3.status).toBe('ready')
    })

    it('should set status to error on init failure', async () => {
      const config = { accessKeyId: 'test' } as S3Config

      try {
        await s3.init(config)
      } catch {
        // Expected
      }

      expect(s3.status).toBe('error')
    })
  })

  describe('shutdown', () => {
    it('should reset to uninitialized state', async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }

      await s3.init(config)
      expect(s3.status).toBe('ready')

      await s3.shutdown()
      expect(s3.status).toBe('uninitialized')
    })
  })

  describe('healthCheck', () => {
    it('should return false when not initialized', async () => {
      const result = await s3.healthCheck()
      expect(result).toBe(false)
    })

    it('should return true when initialized', async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }

      await s3.init(config)
      const result = await s3.healthCheck()
      expect(result).toBe(true)
    })
  })

  describe('methods.putObject', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should upload an object successfully', async () => {
      const request: PutObjectRequest = {
        bucket: 'my-bucket',
        key: 'test-file.txt',
        body: 'Hello, World!',
        contentType: 'text/plain',
      }

      const result = await s3.methods.putObject(request)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.etag).toBeDefined()
        expect(result.data.key).toBe('test-file.txt')
      }
    })

    it('should upload binary data', async () => {
      const request: PutObjectRequest = {
        bucket: 'my-bucket',
        key: 'test-image.png',
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
      }

      const result = await s3.methods.putObject(request)
      expect(result.success).toBe(true)
    })

    it('should fail with missing bucket', async () => {
      const request = {
        key: 'test-file.txt',
        body: 'Hello',
      } as PutObjectRequest

      const result = await s3.methods.putObject(request)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
      }
    })

    it('should fail with missing key', async () => {
      const request = {
        bucket: 'my-bucket',
        body: 'Hello',
      } as PutObjectRequest

      const result = await s3.methods.putObject(request)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
      }
    })

    it('should fail when not initialized', async () => {
      const uninitS3 = createS3Integration()
      const result = await uninitS3.methods.putObject({
        bucket: 'my-bucket',
        key: 'test.txt',
        body: 'Hello',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('methods.getObject', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should retrieve an object', async () => {
      const result = await s3.methods.getObject('my-bucket', 'test-file.txt')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.body).toBeDefined()
        expect(result.data.contentType).toBeDefined()
        expect(result.data.contentLength).toBeGreaterThan(0)
      }
    })

    it('should include metadata', async () => {
      const result = await s3.methods.getObject('my-bucket', 'test-file.txt')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.etag).toBeDefined()
        expect(result.data.lastModified).toBeInstanceOf(Date)
      }
    })
  })

  describe('methods.deleteObject', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should delete an object', async () => {
      const result = await s3.methods.deleteObject('my-bucket', 'test-file.txt')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(true)
      }
    })
  })

  describe('methods.listObjects', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should list objects in a bucket', async () => {
      const result = await s3.methods.listObjects('my-bucket', {})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data.objects)).toBe(true)
        expect(typeof result.data.isTruncated).toBe('boolean')
      }
    })

    it('should support prefix filtering', async () => {
      const result = await s3.methods.listObjects('my-bucket', { prefix: 'images/' })
      expect(result.success).toBe(true)
    })

    it('should support pagination', async () => {
      const result = await s3.methods.listObjects('my-bucket', { maxKeys: 10 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.objects.length).toBeLessThanOrEqual(10)
      }
    })

    it('should support continuation token', async () => {
      const result = await s3.methods.listObjects('my-bucket', {
        continuationToken: 'test-token',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('methods.headObject', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should get object metadata without body', async () => {
      const result = await s3.methods.headObject('my-bucket', 'test-file.txt')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.contentLength).toBeGreaterThan(0)
        expect(result.data.contentType).toBeDefined()
        expect(result.data.etag).toBeDefined()
        expect(result.data.lastModified).toBeInstanceOf(Date)
      }
    })
  })

  describe('methods.copyObject', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should copy object within same bucket', async () => {
      const result = await s3.methods.copyObject(
        'my-bucket',
        'source.txt',
        'my-bucket',
        'destination.txt'
      )
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.etag).toBeDefined()
      }
    })

    it('should copy object to different bucket', async () => {
      const result = await s3.methods.copyObject(
        'source-bucket',
        'file.txt',
        'dest-bucket',
        'file.txt'
      )
      expect(result.success).toBe(true)
    })
  })

  describe('methods.getSignedUrl', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should generate a signed URL for GET', async () => {
      const result = await s3.methods.getSignedUrl('my-bucket', 'test-file.txt', 'get', 3600)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toMatch(/^https:\/\//)
        expect(result.data).toContain('X-Amz-Signature')
      }
    })

    it('should generate a signed URL for PUT', async () => {
      const result = await s3.methods.getSignedUrl('my-bucket', 'upload.txt', 'put', 3600)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toMatch(/^https:\/\//)
      }
    })
  })

  describe('methods.listBuckets', () => {
    beforeEach(async () => {
      const config: S3Config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }
      await s3.init(config)
    })

    it('should list all buckets', async () => {
      const result = await s3.methods.listBuckets()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true)
        const buckets = result.data
        if (buckets.length > 0) {
          expect(buckets[0]!.name).toBeDefined()
          expect(buckets[0]!.creationDate).toBeInstanceOf(Date)
        }
      }
    })
  })
})

describe('createS3Integration', () => {
  it('should create a new S3Integration instance', () => {
    const s3 = createS3Integration()
    expect(s3).toBeInstanceOf(S3Integration)
    expect(s3.name).toBe('aws-s3')
  })
})
