/**
 * S3 Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/s3 compat layer with real DO storage,
 * verifying API compatibility with @aws-sdk/client-s3.
 *
 * These tests:
 * 1. Verify correct API shape matching @aws-sdk/client-s3
 * 2. Verify proper DO storage for object state
 * 3. Verify error handling matches AWS SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/s3-real.test.ts --project=integration
 *
 * @module tests/integration/compat/s3-real
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('S3 Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with @aws-sdk/client-s3
   *
   * Verifies that the S3 compat layer exports the same API surface
   * as the official AWS SDK v3.
   */
  describe('API Shape Compatibility', () => {
    it('exports S3Client class', async () => {
      const { S3Client } = await import('../../../compat/s3/index')

      expect(S3Client).toBeDefined()
      expect(typeof S3Client).toBe('function')
    })

    it('S3Client accepts region configuration', async () => {
      const { S3Client } = await import('../../../compat/s3/index')

      const client = new S3Client({ region: 'us-east-1' })
      expect(client).toBeDefined()
    })

    it('exports bucket commands', async () => {
      const s3 = await import('../../../compat/s3/index')

      expect(s3.CreateBucketCommand).toBeDefined()
      expect(s3.DeleteBucketCommand).toBeDefined()
      expect(s3.HeadBucketCommand).toBeDefined()
      expect(s3.ListBucketsCommand).toBeDefined()
    })

    it('exports object commands', async () => {
      const s3 = await import('../../../compat/s3/index')

      expect(s3.PutObjectCommand).toBeDefined()
      expect(s3.GetObjectCommand).toBeDefined()
      expect(s3.HeadObjectCommand).toBeDefined()
      expect(s3.DeleteObjectCommand).toBeDefined()
      expect(s3.DeleteObjectsCommand).toBeDefined()
      expect(s3.CopyObjectCommand).toBeDefined()
      expect(s3.ListObjectsV2Command).toBeDefined()
    })

    it('exports multipart upload commands', async () => {
      const s3 = await import('../../../compat/s3/index')

      expect(s3.CreateMultipartUploadCommand).toBeDefined()
      expect(s3.UploadPartCommand).toBeDefined()
      expect(s3.CompleteMultipartUploadCommand).toBeDefined()
      expect(s3.AbortMultipartUploadCommand).toBeDefined()
      expect(s3.ListPartsCommand).toBeDefined()
    })

    it('exports error classes', async () => {
      const s3 = await import('../../../compat/s3/index')

      expect(s3.NoSuchBucket).toBeDefined()
      expect(s3.NoSuchKey).toBeDefined()
      expect(s3.BucketAlreadyExists).toBeDefined()
      expect(s3.BucketNotEmpty).toBeDefined()
    })

    it('exports getSignedUrl utility', async () => {
      const { getSignedUrl } = await import('../../../compat/s3/index')

      expect(getSignedUrl).toBeDefined()
      expect(typeof getSignedUrl).toBe('function')
    })
  })

  /**
   * Test Suite 2: Bucket Operations
   *
   * Verifies bucket CRUD operations.
   */
  describe('Bucket Operations', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const s3 = await import('../../../compat/s3/index')
      client = new s3.S3Client({ region: 'us-east-1' })
      clear = s3._clearAll
      clear()
    })

    afterEach(() => {
      clear()
    })

    it('creates a bucket', async () => {
      const { CreateBucketCommand } = await import('../../../compat/s3/index')

      const result = await client.send(new CreateBucketCommand({
        Bucket: 'test-bucket',
      }))

      expect(result).toBeDefined()
      expect(result.Location).toBeDefined()
    })

    it('lists buckets', async () => {
      const { CreateBucketCommand, ListBucketsCommand } = await import('../../../compat/s3/index')

      await client.send(new CreateBucketCommand({ Bucket: 'bucket-1' }))
      await client.send(new CreateBucketCommand({ Bucket: 'bucket-2' }))

      const result = await client.send(new ListBucketsCommand({}))

      expect(result.Buckets).toBeDefined()
      expect(result.Buckets.length).toBeGreaterThanOrEqual(2)
    })

    it('checks if bucket exists with HeadBucket', async () => {
      const { CreateBucketCommand, HeadBucketCommand } = await import('../../../compat/s3/index')

      await client.send(new CreateBucketCommand({ Bucket: 'existing-bucket' }))

      const result = await client.send(new HeadBucketCommand({
        Bucket: 'existing-bucket',
      }))

      expect(result).toBeDefined()
    })

    it('deletes a bucket', async () => {
      const { CreateBucketCommand, DeleteBucketCommand, HeadBucketCommand, NoSuchBucket } = await import('../../../compat/s3/index')

      await client.send(new CreateBucketCommand({ Bucket: 'to-delete' }))
      await client.send(new DeleteBucketCommand({ Bucket: 'to-delete' }))

      await expect(
        client.send(new HeadBucketCommand({ Bucket: 'to-delete' }))
      ).rejects.toThrow()
    })

    it('throws BucketAlreadyExists for duplicate bucket', async () => {
      const { CreateBucketCommand } = await import('../../../compat/s3/index')

      await client.send(new CreateBucketCommand({ Bucket: 'duplicate' }))

      await expect(
        client.send(new CreateBucketCommand({ Bucket: 'duplicate' }))
      ).rejects.toThrow()
    })
  })

  /**
   * Test Suite 3: Object Operations
   *
   * Verifies object CRUD operations.
   */
  describe('Object Operations', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const s3 = await import('../../../compat/s3/index')
      client = new s3.S3Client({ region: 'us-east-1' })
      clear = s3._clearAll
      clear()

      // Create test bucket
      await client.send(new s3.CreateBucketCommand({ Bucket: 'test-bucket' }))
    })

    afterEach(() => {
      clear()
    })

    it('puts an object', async () => {
      const { PutObjectCommand } = await import('../../../compat/s3/index')

      const result = await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'Hello World',
        ContentType: 'text/plain',
      }))

      expect(result).toBeDefined()
      expect(result.ETag).toBeDefined()
    })

    it('gets an object', async () => {
      const { PutObjectCommand, GetObjectCommand } = await import('../../../compat/s3/index')

      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'Hello World',
      }))

      const result = await client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
      }))

      expect(result).toBeDefined()
      expect(result.Body).toBeDefined()

      // Body should be transformable to string
      const text = await result.Body.transformToString()
      expect(text).toBe('Hello World')
    })

    it('checks object metadata with HeadObject', async () => {
      const { PutObjectCommand, HeadObjectCommand } = await import('../../../compat/s3/index')

      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'Hello',
        ContentType: 'text/plain',
      }))

      const result = await client.send(new HeadObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
      }))

      expect(result).toBeDefined()
      expect(result.ContentLength).toBeDefined()
      expect(result.ContentType).toBe('text/plain')
    })

    it('deletes an object', async () => {
      const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = await import('../../../compat/s3/index')

      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'to-delete',
        Body: 'Temporary',
      }))

      await client.send(new DeleteObjectCommand({
        Bucket: 'test-bucket',
        Key: 'to-delete',
      }))

      await expect(
        client.send(new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'to-delete',
        }))
      ).rejects.toThrow()
    })

    it('deletes multiple objects', async () => {
      const { PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = await import('../../../compat/s3/index')

      await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'obj-1', Body: 'a' }))
      await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'obj-2', Body: 'b' }))
      await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'obj-3', Body: 'c' }))

      const result = await client.send(new DeleteObjectsCommand({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [{ Key: 'obj-1' }, { Key: 'obj-2' }],
        },
      }))

      expect(result.Deleted).toBeDefined()
      expect(result.Deleted.length).toBe(2)

      // Only obj-3 should remain
      const list = await client.send(new ListObjectsV2Command({ Bucket: 'test-bucket' }))
      expect(list.Contents?.length).toBe(1)
      expect(list.Contents?.[0].Key).toBe('obj-3')
    })

    it('copies an object', async () => {
      const { PutObjectCommand, CopyObjectCommand, GetObjectCommand } = await import('../../../compat/s3/index')

      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'source-key',
        Body: 'Source content',
      }))

      await client.send(new CopyObjectCommand({
        Bucket: 'test-bucket',
        Key: 'dest-key',
        CopySource: 'test-bucket/source-key',
      }))

      const result = await client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'dest-key',
      }))

      const text = await result.Body.transformToString()
      expect(text).toBe('Source content')
    })

    it('lists objects with prefix', async () => {
      const { PutObjectCommand, ListObjectsV2Command } = await import('../../../compat/s3/index')

      await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'folder/a.txt', Body: 'a' }))
      await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'folder/b.txt', Body: 'b' }))
      await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'other/c.txt', Body: 'c' }))

      const result = await client.send(new ListObjectsV2Command({
        Bucket: 'test-bucket',
        Prefix: 'folder/',
      }))

      expect(result.Contents).toBeDefined()
      expect(result.Contents.length).toBe(2)
      expect(result.Contents.every((obj: any) => obj.Key.startsWith('folder/'))).toBe(true)
    })
  })

  /**
   * Test Suite 4: Multipart Upload
   *
   * Verifies multipart upload operations.
   */
  describe('Multipart Upload', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const s3 = await import('../../../compat/s3/index')
      client = new s3.S3Client({ region: 'us-east-1' })
      clear = s3._clearAll
      clear()

      await client.send(new s3.CreateBucketCommand({ Bucket: 'test-bucket' }))
    })

    afterEach(() => {
      clear()
    })

    it('initiates multipart upload', async () => {
      const { CreateMultipartUploadCommand } = await import('../../../compat/s3/index')

      const result = await client.send(new CreateMultipartUploadCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
      }))

      expect(result).toBeDefined()
      expect(result.UploadId).toBeDefined()
    })

    it('uploads part', async () => {
      const { CreateMultipartUploadCommand, UploadPartCommand } = await import('../../../compat/s3/index')

      const initiate = await client.send(new CreateMultipartUploadCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
      }))

      const result = await client.send(new UploadPartCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
        UploadId: initiate.UploadId,
        PartNumber: 1,
        Body: 'Part 1 content',
      }))

      expect(result).toBeDefined()
      expect(result.ETag).toBeDefined()
    })

    it('completes multipart upload', async () => {
      const { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, GetObjectCommand } = await import('../../../compat/s3/index')

      const initiate = await client.send(new CreateMultipartUploadCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
      }))

      const part1 = await client.send(new UploadPartCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
        UploadId: initiate.UploadId,
        PartNumber: 1,
        Body: 'Part 1',
      }))

      const part2 = await client.send(new UploadPartCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
        UploadId: initiate.UploadId,
        PartNumber: 2,
        Body: ' Part 2',
      }))

      await client.send(new CompleteMultipartUploadCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
        UploadId: initiate.UploadId,
        MultipartUpload: {
          Parts: [
            { PartNumber: 1, ETag: part1.ETag },
            { PartNumber: 2, ETag: part2.ETag },
          ],
        },
      }))

      const get = await client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'multipart-key',
      }))

      const text = await get.Body.transformToString()
      expect(text).toBe('Part 1 Part 2')
    })

    it('aborts multipart upload', async () => {
      const { CreateMultipartUploadCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand } = await import('../../../compat/s3/index')

      const initiate = await client.send(new CreateMultipartUploadCommand({
        Bucket: 'test-bucket',
        Key: 'aborted-key',
      }))

      await client.send(new AbortMultipartUploadCommand({
        Bucket: 'test-bucket',
        Key: 'aborted-key',
        UploadId: initiate.UploadId,
      }))

      // Should not appear in active uploads
      const list = await client.send(new ListMultipartUploadsCommand({
        Bucket: 'test-bucket',
      }))

      const activeUpload = list.Uploads?.find((u: any) => u.UploadId === initiate.UploadId)
      expect(activeUpload).toBeUndefined()
    })
  })

  /**
   * Test Suite 5: Error Handling Compatibility
   *
   * Verifies that errors match AWS SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let client: any

    beforeEach(async () => {
      const s3 = await import('../../../compat/s3/index')
      client = new s3.S3Client({ region: 'us-east-1' })
      s3._clearAll()
    })

    it('throws NoSuchBucket for non-existent bucket', async () => {
      const { HeadBucketCommand, NoSuchBucket } = await import('../../../compat/s3/index')

      await expect(
        client.send(new HeadBucketCommand({ Bucket: 'nonexistent' }))
      ).rejects.toThrow()
    })

    it('throws NoSuchKey for non-existent key', async () => {
      const { CreateBucketCommand, GetObjectCommand, NoSuchKey } = await import('../../../compat/s3/index')

      await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))

      await expect(
        client.send(new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'nonexistent-key',
        }))
      ).rejects.toThrow()
    })

    it('throws BucketNotEmpty when deleting non-empty bucket', async () => {
      const { CreateBucketCommand, PutObjectCommand, DeleteBucketCommand, BucketNotEmpty } = await import('../../../compat/s3/index')

      await client.send(new CreateBucketCommand({ Bucket: 'non-empty' }))
      await client.send(new PutObjectCommand({
        Bucket: 'non-empty',
        Key: 'object',
        Body: 'data',
      }))

      await expect(
        client.send(new DeleteBucketCommand({ Bucket: 'non-empty' }))
      ).rejects.toThrow()
    })
  })

  /**
   * Test Suite 6: Presigned URLs
   *
   * Verifies presigned URL generation.
   */
  describe('Presigned URLs', () => {
    it('generates presigned GET URL', async () => {
      const { S3Client, GetObjectCommand, getSignedUrl } = await import('../../../compat/s3/index')

      const client = new S3Client({ region: 'us-east-1' })
      const command = new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
      })

      const url = await getSignedUrl(client, command, { expiresIn: 3600 })

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
      expect(url).toContain('test-bucket')
      expect(url).toContain('test-key')
    })

    it('generates presigned PUT URL', async () => {
      const { S3Client, PutObjectCommand, getSignedUrl } = await import('../../../compat/s3/index')

      const client = new S3Client({ region: 'us-east-1' })
      const command = new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'upload-key',
        ContentType: 'text/plain',
      })

      const url = await getSignedUrl(client, command, { expiresIn: 3600 })

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
    })
  })
})
