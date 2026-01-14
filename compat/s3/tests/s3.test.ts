/**
 * @dotdo/s3 - AWS S3 SDK Compat Layer Tests
 *
 * Comprehensive tests for @aws-sdk/client-s3 compatible API
 * Tests follow TDD approach: write failing tests first, then implement
 */
import { describe, it, expect, beforeEach } from 'vitest'

// These imports will fail until we implement them
import {
  // Client
  S3Client,

  // Bucket Commands
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,

  // Object Commands
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,

  // Multipart Commands
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,

  // Errors
  S3ServiceException,
  NoSuchBucket,
  NoSuchKey,
  BucketAlreadyExists,
  BucketNotEmpty,
  NoSuchUpload,

  // Test utilities
  _clearAll,
  _getBuckets,
} from '../index'

import type {
  S3ClientConfig,
  CreateBucketCommandOutput,
  PutObjectCommandOutput,
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/s3 - S3 SDK Compat Layer', () => {
  let client: InstanceType<typeof S3Client>

  beforeEach(() => {
    _clearAll()
    client = new S3Client({ region: 'us-east-1' })
  })

  // ===========================================================================
  // Client Tests
  // ===========================================================================

  describe('S3Client', () => {
    it('should export S3Client', () => {
      expect(S3Client).toBeDefined()
      expect(typeof S3Client).toBe('function')
    })

    it('should create client instance with default config', () => {
      const client = new S3Client({})
      expect(client).toBeInstanceOf(S3Client)
    })

    it('should create client instance with custom region', () => {
      const client = new S3Client({ region: 'eu-west-1' })
      expect(client).toBeInstanceOf(S3Client)
    })

    it('should create client instance with credentials', () => {
      const client = new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })
      expect(client).toBeInstanceOf(S3Client)
    })

    it('should create client instance with endpoint', () => {
      const client = new S3Client({
        region: 'auto',
        endpoint: 'https://s3.example.com',
      })
      expect(client).toBeInstanceOf(S3Client)
    })
  })

  // ===========================================================================
  // Bucket Operations Tests
  // ===========================================================================

  describe('Bucket Operations', () => {
    describe('CreateBucketCommand', () => {
      it('should create a new bucket', async () => {
        const result = await client.send(
          new CreateBucketCommand({ Bucket: 'my-test-bucket' })
        )
        expect(result.Location).toBeDefined()
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should throw BucketAlreadyExists for duplicate bucket', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'existing-bucket' }))

        await expect(
          client.send(new CreateBucketCommand({ Bucket: 'existing-bucket' }))
        ).rejects.toThrow(BucketAlreadyExists)
      })

      it('should accept location constraint', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'regional-bucket',
            CreateBucketConfiguration: {
              LocationConstraint: 'eu-west-1',
            },
          })
        )
        expect(result.Location).toBeDefined()
      })
    })

    describe('DeleteBucketCommand', () => {
      it('should delete an empty bucket', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'bucket-to-delete' }))

        const result = await client.send(
          new DeleteBucketCommand({ Bucket: 'bucket-to-delete' })
        )
        expect(result.$metadata.httpStatusCode).toBe(204)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(new DeleteBucketCommand({ Bucket: 'non-existent' }))
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should throw BucketNotEmpty for non-empty bucket', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'non-empty-bucket' }))
        await client.send(
          new PutObjectCommand({
            Bucket: 'non-empty-bucket',
            Key: 'test.txt',
            Body: 'Hello',
          })
        )

        await expect(
          client.send(new DeleteBucketCommand({ Bucket: 'non-empty-bucket' }))
        ).rejects.toThrow(BucketNotEmpty)
      })
    })

    describe('HeadBucketCommand', () => {
      it('should return metadata for existing bucket', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'head-test-bucket' }))

        const result = await client.send(
          new HeadBucketCommand({ Bucket: 'head-test-bucket' })
        )
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(new HeadBucketCommand({ Bucket: 'non-existent' }))
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('ListBucketsCommand', () => {
      it('should list all buckets', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'bucket-1' }))
        await client.send(new CreateBucketCommand({ Bucket: 'bucket-2' }))
        await client.send(new CreateBucketCommand({ Bucket: 'bucket-3' }))

        const result = await client.send(new ListBucketsCommand({}))
        expect(result.Buckets).toBeDefined()
        expect(result.Buckets).toHaveLength(3)
        expect(result.Owner).toBeDefined()
      })

      it('should return empty array when no buckets exist', async () => {
        const result = await client.send(new ListBucketsCommand({}))
        expect(result.Buckets).toEqual([])
      })
    })
  })

  // ===========================================================================
  // Object Operations Tests
  // ===========================================================================

  describe('Object Operations', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
    })

    describe('PutObjectCommand', () => {
      it('should put a string object', async () => {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'hello.txt',
            Body: 'Hello World',
          })
        )
        expect(result.ETag).toBeDefined()
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should put a Uint8Array object', async () => {
        const data = new TextEncoder().encode('Binary data')
        const result = await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'binary.bin',
            Body: data,
          })
        )
        expect(result.ETag).toBeDefined()
      })

      it('should put an ArrayBuffer object', async () => {
        const data = new TextEncoder().encode('Buffer data').buffer
        const result = await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'buffer.bin',
            Body: new Uint8Array(data),
          })
        )
        expect(result.ETag).toBeDefined()
      })

      it('should store content type', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'data.json',
            Body: '{"key": "value"}',
            ContentType: 'application/json',
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'data.json',
          })
        )
        expect(headResult.ContentType).toBe('application/json')
      })

      it('should store custom metadata', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'metadata.txt',
            Body: 'test',
            Metadata: { 'custom-key': 'custom-value' },
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'metadata.txt',
          })
        )
        expect(headResult.Metadata).toEqual({ 'custom-key': 'custom-value' })
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new PutObjectCommand({
              Bucket: 'non-existent',
              Key: 'test.txt',
              Body: 'test',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('GetObjectCommand', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'get-test.txt',
            Body: 'Hello World',
            ContentType: 'text/plain',
          })
        )
      })

      it('should get an object', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'get-test.txt',
          })
        )
        expect(result.Body).toBeDefined()
        expect(result.ContentLength).toBe(11)
        expect(result.ContentType).toBe('text/plain')
        expect(result.ETag).toBeDefined()
      })

      it('should read body as text', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'get-test.txt',
          })
        )
        const text = await result.Body!.transformToString()
        expect(text).toBe('Hello World')
      })

      it('should throw NoSuchKey for non-existent key', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: 'test-bucket',
              Key: 'non-existent.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: 'non-existent',
              Key: 'test.txt',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should support range requests', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'range-test.txt',
            Body: '0123456789',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'range-test.txt',
            Range: 'bytes=0-4',
          })
        )
        expect(result.ContentLength).toBe(5)
        expect(result.ContentRange).toBe('bytes 0-4/10')
        const text = await result.Body!.transformToString()
        expect(text).toBe('01234')
      })
    })

    describe('HeadObjectCommand', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'head-test.txt',
            Body: 'Test content',
            ContentType: 'text/plain',
            Metadata: { key: 'value' },
          })
        )
      })

      it('should return object metadata', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'head-test.txt',
          })
        )
        expect(result.ContentLength).toBe(12)
        expect(result.ContentType).toBe('text/plain')
        expect(result.ETag).toBeDefined()
        expect(result.LastModified).toBeInstanceOf(Date)
        expect(result.Metadata).toEqual({ key: 'value' })
      })

      it('should throw NoSuchKey for non-existent key', async () => {
        await expect(
          client.send(
            new HeadObjectCommand({
              Bucket: 'test-bucket',
              Key: 'non-existent.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })
    })

    describe('DeleteObjectCommand', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'delete-test.txt',
            Body: 'To be deleted',
          })
        )
      })

      it('should delete an object', async () => {
        const result = await client.send(
          new DeleteObjectCommand({
            Bucket: 'test-bucket',
            Key: 'delete-test.txt',
          })
        )
        expect(result.$metadata.httpStatusCode).toBe(204)

        // Verify object is deleted
        await expect(
          client.send(
            new HeadObjectCommand({
              Bucket: 'test-bucket',
              Key: 'delete-test.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })

      it('should succeed for non-existent key (idempotent)', async () => {
        const result = await client.send(
          new DeleteObjectCommand({
            Bucket: 'test-bucket',
            Key: 'non-existent.txt',
          })
        )
        expect(result.$metadata.httpStatusCode).toBe(204)
      })
    })

    describe('DeleteObjectsCommand', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'file1.txt', Body: '1' })
        )
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'file2.txt', Body: '2' })
        )
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'file3.txt', Body: '3' })
        )
      })

      it('should delete multiple objects', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: 'test-bucket',
            Delete: {
              Objects: [
                { Key: 'file1.txt' },
                { Key: 'file2.txt' },
                { Key: 'file3.txt' },
              ],
            },
          })
        )
        expect(result.Deleted).toHaveLength(3)
        expect(result.Errors).toHaveLength(0)
      })

      it('should handle partial failures gracefully', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: 'test-bucket',
            Delete: {
              Objects: [
                { Key: 'file1.txt' },
                { Key: 'non-existent.txt' },
              ],
            },
          })
        )
        // Non-existent keys should still be reported as deleted (S3 behavior)
        expect(result.Deleted).toHaveLength(2)
      })
    })

    describe('CopyObjectCommand', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'source.txt',
            Body: 'Source content',
            ContentType: 'text/plain',
            Metadata: { original: 'true' },
          })
        )
      })

      it('should copy an object within same bucket', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: 'test-bucket',
            Key: 'destination.txt',
            CopySource: 'test-bucket/source.txt',
          })
        )
        expect(result.CopyObjectResult?.ETag).toBeDefined()
        expect(result.CopyObjectResult?.LastModified).toBeDefined()

        // Verify destination exists
        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'destination.txt',
          })
        )
        expect(headResult.ContentLength).toBe(14)
      })

      it('should copy an object between buckets', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'dest-bucket' }))

        const result = await client.send(
          new CopyObjectCommand({
            Bucket: 'dest-bucket',
            Key: 'copied.txt',
            CopySource: 'test-bucket/source.txt',
          })
        )
        expect(result.CopyObjectResult?.ETag).toBeDefined()
      })

      it('should copy metadata with COPY directive', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: 'test-bucket',
            Key: 'copy-meta.txt',
            CopySource: 'test-bucket/source.txt',
            MetadataDirective: 'COPY',
          })
        )
        expect(result.CopyObjectResult?.ETag).toBeDefined()

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'copy-meta.txt',
          })
        )
        expect(headResult.Metadata).toEqual({ original: 'true' })
      })

      it('should replace metadata with REPLACE directive', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: 'test-bucket',
            Key: 'replace-meta.txt',
            CopySource: 'test-bucket/source.txt',
            MetadataDirective: 'REPLACE',
            Metadata: { new: 'metadata' },
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'replace-meta.txt',
          })
        )
        expect(headResult.Metadata).toEqual({ new: 'metadata' })
      })

      it('should throw NoSuchKey for non-existent source', async () => {
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: 'test-bucket',
              Key: 'dest.txt',
              CopySource: 'test-bucket/non-existent.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })
    })

    describe('ListObjectsV2Command', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'folder1/file1.txt', Body: '1' })
        )
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'folder1/file2.txt', Body: '2' })
        )
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'folder2/file1.txt', Body: '3' })
        )
        await client.send(
          new PutObjectCommand({ Bucket: 'test-bucket', Key: 'root.txt', Body: '4' })
        )
      })

      it('should list all objects', async () => {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: 'test-bucket',
          })
        )
        expect(result.Contents).toHaveLength(4)
        expect(result.KeyCount).toBe(4)
        expect(result.IsTruncated).toBe(false)
      })

      it('should filter by prefix', async () => {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: 'test-bucket',
            Prefix: 'folder1/',
          })
        )
        expect(result.Contents).toHaveLength(2)
        expect(result.Contents![0].Key).toContain('folder1/')
      })

      it('should use delimiter for folder simulation', async () => {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: 'test-bucket',
            Delimiter: '/',
          })
        )
        expect(result.Contents).toHaveLength(1) // root.txt only
        expect(result.CommonPrefixes).toHaveLength(2) // folder1/, folder2/
        expect(result.CommonPrefixes!.map(p => p.Prefix)).toContain('folder1/')
        expect(result.CommonPrefixes!.map(p => p.Prefix)).toContain('folder2/')
      })

      it('should paginate with MaxKeys', async () => {
        const result1 = await client.send(
          new ListObjectsV2Command({
            Bucket: 'test-bucket',
            MaxKeys: 2,
          })
        )
        expect(result1.Contents).toHaveLength(2)
        expect(result1.IsTruncated).toBe(true)
        expect(result1.NextContinuationToken).toBeDefined()

        const result2 = await client.send(
          new ListObjectsV2Command({
            Bucket: 'test-bucket',
            MaxKeys: 2,
            ContinuationToken: result1.NextContinuationToken,
          })
        )
        expect(result2.Contents).toHaveLength(2)
      })

      it('should support StartAfter', async () => {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: 'test-bucket',
            StartAfter: 'folder1/file2.txt',
          })
        )
        expect(result.Contents!.every(c => c.Key! > 'folder1/file2.txt')).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Multipart Upload Tests
  // ===========================================================================

  describe('Multipart Upload Operations', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'multipart-bucket' }))
    })

    describe('CreateMultipartUploadCommand', () => {
      it('should initiate a multipart upload', async () => {
        const result = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'large-file.bin',
          })
        )
        expect(result.UploadId).toBeDefined()
        expect(result.Bucket).toBe('multipart-bucket')
        expect(result.Key).toBe('large-file.bin')
      })

      it('should accept content type', async () => {
        const result = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'data.json',
            ContentType: 'application/json',
          })
        )
        expect(result.UploadId).toBeDefined()
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new CreateMultipartUploadCommand({
              Bucket: 'non-existent',
              Key: 'test.bin',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('UploadPartCommand', () => {
      let uploadId: string

      beforeEach(async () => {
        const result = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'large-file.bin',
          })
        )
        uploadId = result.UploadId!
      })

      it('should upload a part', async () => {
        const partData = new Uint8Array(1024).fill(65) // 1KB of 'A'
        const result = await client.send(
          new UploadPartCommand({
            Bucket: 'multipart-bucket',
            Key: 'large-file.bin',
            UploadId: uploadId,
            PartNumber: 1,
            Body: partData,
          })
        )
        expect(result.ETag).toBeDefined()
      })

      it('should upload multiple parts', async () => {
        const part1 = new Uint8Array(1024).fill(65)
        const part2 = new Uint8Array(1024).fill(66)

        const result1 = await client.send(
          new UploadPartCommand({
            Bucket: 'multipart-bucket',
            Key: 'large-file.bin',
            UploadId: uploadId,
            PartNumber: 1,
            Body: part1,
          })
        )

        const result2 = await client.send(
          new UploadPartCommand({
            Bucket: 'multipart-bucket',
            Key: 'large-file.bin',
            UploadId: uploadId,
            PartNumber: 2,
            Body: part2,
          })
        )

        expect(result1.ETag).toBeDefined()
        expect(result2.ETag).toBeDefined()
        expect(result1.ETag).not.toBe(result2.ETag)
      })

      it('should throw NoSuchUpload for invalid upload ID', async () => {
        await expect(
          client.send(
            new UploadPartCommand({
              Bucket: 'multipart-bucket',
              Key: 'large-file.bin',
              UploadId: 'invalid-upload-id',
              PartNumber: 1,
              Body: new Uint8Array(1024),
            })
          )
        ).rejects.toThrow(NoSuchUpload)
      })
    })

    describe('CompleteMultipartUploadCommand', () => {
      let uploadId: string
      let etag1: string
      let etag2: string

      beforeEach(async () => {
        const createResult = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'complete-test.bin',
          })
        )
        uploadId = createResult.UploadId!

        const part1Result = await client.send(
          new UploadPartCommand({
            Bucket: 'multipart-bucket',
            Key: 'complete-test.bin',
            UploadId: uploadId,
            PartNumber: 1,
            Body: new Uint8Array(1024).fill(65),
          })
        )
        etag1 = part1Result.ETag!

        const part2Result = await client.send(
          new UploadPartCommand({
            Bucket: 'multipart-bucket',
            Key: 'complete-test.bin',
            UploadId: uploadId,
            PartNumber: 2,
            Body: new Uint8Array(512).fill(66),
          })
        )
        etag2 = part2Result.ETag!
      })

      it('should complete a multipart upload', async () => {
        const result = await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'complete-test.bin',
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [
                { PartNumber: 1, ETag: etag1 },
                { PartNumber: 2, ETag: etag2 },
              ],
            },
          })
        )
        expect(result.ETag).toBeDefined()
        expect(result.Location).toBeDefined()
        expect(result.Bucket).toBe('multipart-bucket')
        expect(result.Key).toBe('complete-test.bin')

        // Verify object exists with correct size
        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: 'multipart-bucket',
            Key: 'complete-test.bin',
          })
        )
        expect(headResult.ContentLength).toBe(1536) // 1024 + 512
      })

      it('should throw NoSuchUpload for invalid upload ID', async () => {
        await expect(
          client.send(
            new CompleteMultipartUploadCommand({
              Bucket: 'multipart-bucket',
              Key: 'complete-test.bin',
              UploadId: 'invalid-id',
              MultipartUpload: { Parts: [] },
            })
          )
        ).rejects.toThrow(NoSuchUpload)
      })
    })

    describe('AbortMultipartUploadCommand', () => {
      it('should abort a multipart upload', async () => {
        const createResult = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'abort-test.bin',
          })
        )

        await client.send(
          new UploadPartCommand({
            Bucket: 'multipart-bucket',
            Key: 'abort-test.bin',
            UploadId: createResult.UploadId!,
            PartNumber: 1,
            Body: new Uint8Array(1024),
          })
        )

        const result = await client.send(
          new AbortMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'abort-test.bin',
            UploadId: createResult.UploadId!,
          })
        )
        expect(result.$metadata.httpStatusCode).toBe(204)

        // Verify upload is aborted
        await expect(
          client.send(
            new UploadPartCommand({
              Bucket: 'multipart-bucket',
              Key: 'abort-test.bin',
              UploadId: createResult.UploadId!,
              PartNumber: 2,
              Body: new Uint8Array(1024),
            })
          )
        ).rejects.toThrow(NoSuchUpload)
      })

      it('should throw NoSuchUpload for invalid upload ID', async () => {
        await expect(
          client.send(
            new AbortMultipartUploadCommand({
              Bucket: 'multipart-bucket',
              Key: 'test.bin',
              UploadId: 'invalid-id',
            })
          )
        ).rejects.toThrow(NoSuchUpload)
      })
    })

    describe('ListPartsCommand', () => {
      let uploadId: string

      beforeEach(async () => {
        const createResult = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'list-parts-test.bin',
          })
        )
        uploadId = createResult.UploadId!

        // Upload 3 parts
        for (let i = 1; i <= 3; i++) {
          await client.send(
            new UploadPartCommand({
              Bucket: 'multipart-bucket',
              Key: 'list-parts-test.bin',
              UploadId: uploadId,
              PartNumber: i,
              Body: new Uint8Array(1024).fill(64 + i),
            })
          )
        }
      })

      it('should list uploaded parts', async () => {
        const result = await client.send(
          new ListPartsCommand({
            Bucket: 'multipart-bucket',
            Key: 'list-parts-test.bin',
            UploadId: uploadId,
          })
        )
        expect(result.Parts).toHaveLength(3)
        expect(result.Parts![0].PartNumber).toBe(1)
        expect(result.Parts![0].Size).toBe(1024)
        expect(result.Parts![0].ETag).toBeDefined()
      })

      it('should paginate with MaxParts', async () => {
        const result = await client.send(
          new ListPartsCommand({
            Bucket: 'multipart-bucket',
            Key: 'list-parts-test.bin',
            UploadId: uploadId,
            MaxParts: 2,
          })
        )
        expect(result.Parts).toHaveLength(2)
        expect(result.IsTruncated).toBe(true)
        expect(result.NextPartNumberMarker).toBeDefined()
      })

      it('should throw NoSuchUpload for invalid upload ID', async () => {
        await expect(
          client.send(
            new ListPartsCommand({
              Bucket: 'multipart-bucket',
              Key: 'list-parts-test.bin',
              UploadId: 'invalid-id',
            })
          )
        ).rejects.toThrow(NoSuchUpload)
      })
    })

    describe('ListMultipartUploadsCommand', () => {
      beforeEach(async () => {
        // Create multiple uploads
        await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'folder1/upload1.bin',
          })
        )
        await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'folder1/upload2.bin',
          })
        )
        await client.send(
          new CreateMultipartUploadCommand({
            Bucket: 'multipart-bucket',
            Key: 'folder2/upload1.bin',
          })
        )
      })

      it('should list all multipart uploads', async () => {
        const result = await client.send(
          new ListMultipartUploadsCommand({
            Bucket: 'multipart-bucket',
          })
        )
        expect(result.Uploads).toHaveLength(3)
      })

      it('should filter by prefix', async () => {
        const result = await client.send(
          new ListMultipartUploadsCommand({
            Bucket: 'multipart-bucket',
            Prefix: 'folder1/',
          })
        )
        expect(result.Uploads).toHaveLength(2)
      })

      it('should use delimiter for folder simulation', async () => {
        const result = await client.send(
          new ListMultipartUploadsCommand({
            Bucket: 'multipart-bucket',
            Delimiter: '/',
          })
        )
        expect(result.Uploads).toHaveLength(0)
        expect(result.CommonPrefixes).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Streaming Tests
  // ===========================================================================

  describe('Streaming Support', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'stream-bucket' }))
    })

    it('should support streaming upload via ReadableStream', async () => {
      // Create a ReadableStream
      const chunks = ['Hello ', 'World ', 'Stream']
      let index = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(new TextEncoder().encode(chunks[index++]))
          } else {
            controller.close()
          }
        },
      })

      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'stream-bucket',
          Key: 'stream-upload.txt',
          Body: stream,
        })
      )
      expect(result.ETag).toBeDefined()

      // Verify content
      const getResult = await client.send(
        new GetObjectCommand({
          Bucket: 'stream-bucket',
          Key: 'stream-upload.txt',
        })
      )
      const text = await getResult.Body!.transformToString()
      expect(text).toBe('Hello World Stream')
    })

    it('should support streaming download via Body.transformToByteArray', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'stream-bucket',
          Key: 'download-stream.txt',
          Body: 'Binary content for streaming',
        })
      )

      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'stream-bucket',
          Key: 'download-stream.txt',
        })
      )

      const bytes = await result.Body!.transformToByteArray()
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(bytes)).toBe('Binary content for streaming')
    })
  })

  // ===========================================================================
  // Error Tests
  // ===========================================================================

  describe('Error Classes', () => {
    it('should export S3ServiceException', () => {
      expect(S3ServiceException).toBeDefined()
      const error = new S3ServiceException({ message: 'test' })
      expect(error.name).toBe('S3ServiceException')
    })

    it('should export NoSuchBucket', () => {
      expect(NoSuchBucket).toBeDefined()
      const error = new NoSuchBucket({ message: 'test' })
      expect(error.name).toBe('NoSuchBucket')
    })

    it('should export NoSuchKey', () => {
      expect(NoSuchKey).toBeDefined()
      const error = new NoSuchKey({ message: 'test' })
      expect(error.name).toBe('NoSuchKey')
    })

    it('should export BucketAlreadyExists', () => {
      expect(BucketAlreadyExists).toBeDefined()
      const error = new BucketAlreadyExists({ message: 'test' })
      expect(error.name).toBe('BucketAlreadyExists')
    })

    it('should export BucketNotEmpty', () => {
      expect(BucketNotEmpty).toBeDefined()
      const error = new BucketNotEmpty({ message: 'test' })
      expect(error.name).toBe('BucketNotEmpty')
    })

    it('should export NoSuchUpload', () => {
      expect(NoSuchUpload).toBeDefined()
      const error = new NoSuchUpload({ message: 'test' })
      expect(error.name).toBe('NoSuchUpload')
    })
  })

  // ===========================================================================
  // Presigned URL Tests
  // ===========================================================================

  describe('Presigned URLs', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'presign-bucket' }))
      await client.send(
        new PutObjectCommand({
          Bucket: 'presign-bucket',
          Key: 'test-file.txt',
          Body: 'Hello World',
          ContentType: 'text/plain',
        })
      )
    })

    it('should export getSignedUrl function', async () => {
      const { getSignedUrl } = await import('../presigner')
      expect(getSignedUrl).toBeDefined()
      expect(typeof getSignedUrl).toBe('function')
    })

    it('should export getSignedUrl from main index', async () => {
      const { getSignedUrl } = await import('../index')
      expect(getSignedUrl).toBeDefined()
      expect(typeof getSignedUrl).toBe('function')
    })

    it('should generate a presigned GET URL', async () => {
      const { getSignedUrl } = await import('../presigner')
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'presign-bucket',
          Key: 'test-file.txt',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
      expect(url).toContain('presign-bucket')
      expect(url).toContain('test-file.txt')
      expect(url).toContain('X-Amz-Expires')
    })

    it('should generate a presigned PUT URL', async () => {
      const { getSignedUrl } = await import('../presigner')
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'presign-bucket',
          Key: 'new-file.txt',
          ContentType: 'text/plain',
        }),
        { expiresIn: 3600 }
      )

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
      expect(url).toContain('presign-bucket')
      expect(url).toContain('new-file.txt')
    })

    it('should include expiration time in URL', async () => {
      const { getSignedUrl } = await import('../presigner')
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'presign-bucket',
          Key: 'test-file.txt',
        }),
        { expiresIn: 7200 }
      )

      expect(url).toContain('X-Amz-Expires=7200')
    })

    it('should use default expiration if not specified', async () => {
      const { getSignedUrl } = await import('../presigner')
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'presign-bucket',
          Key: 'test-file.txt',
        })
      )

      // Default is 900 seconds (15 minutes) per AWS SDK
      expect(url).toContain('X-Amz-Expires=900')
    })

    it('should generate URL with signature components', async () => {
      const { getSignedUrl } = await import('../presigner')
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'presign-bucket',
          Key: 'test-file.txt',
        })
      )

      expect(url).toContain('X-Amz-Algorithm')
      expect(url).toContain('X-Amz-Credential')
      expect(url).toContain('X-Amz-Date')
      expect(url).toContain('X-Amz-SignedHeaders')
      expect(url).toContain('X-Amz-Signature')
    })
  })

  // ===========================================================================
  // Test Utilities
  // ===========================================================================

  describe('Test Utilities', () => {
    it('should export _clearAll', () => {
      expect(_clearAll).toBeDefined()
      expect(typeof _clearAll).toBe('function')
    })

    it('should export _getBuckets', () => {
      expect(_getBuckets).toBeDefined()
      expect(typeof _getBuckets).toBe('function')
    })

    it('should clear all data', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'bucket-1' }))
      await client.send(new CreateBucketCommand({ Bucket: 'bucket-2' }))

      _clearAll()

      const result = await client.send(new ListBucketsCommand({}))
      expect(result.Buckets).toHaveLength(0)
    })
  })
})
