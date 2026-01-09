/**
 * @dotdo/s3 - S3 SDK compat tests
 *
 * Tests for @aws-sdk/client-s3 API compatibility backed by DO storage:
 * - Client creation and configuration
 * - Bucket operations (create, delete, list, head)
 * - Object operations (put, get, delete, head, copy)
 * - List objects with pagination
 * - Batch delete
 * - Presigned URLs
 * - Error handling
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  getSignedUrl,
  clearAllBuckets,
  NoSuchBucket,
  NoSuchKey,
  BucketAlreadyExists,
  BucketNotEmpty,
  NotModified,
  PreconditionFailed,
} from './index'
import type {
  S3ClientConfig,
  ExtendedS3ClientConfig,
} from './types'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('S3Client', () => {
  beforeEach(() => {
    clearAllBuckets()
  })

  it('should create client with no options', () => {
    const client = new S3Client()
    expect(client).toBeDefined()
  })

  it('should create client with region', () => {
    const client = new S3Client({ region: 'us-west-2' })
    expect(client).toBeDefined()
  })

  it('should create client with credentials', () => {
    const client = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
    expect(client).toBeDefined()
  })

  it('should create client with endpoint', () => {
    const client = new S3Client({
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
    })
    expect(client).toBeDefined()
  })

  it('should accept extended DO config', () => {
    const client = new S3Client({
      doNamespace: {} as DurableObjectNamespace,
      shard: { algorithm: 'consistent', count: 4 },
      replica: { readPreference: 'nearest' },
    } as ExtendedS3ClientConfig)
    expect(client).toBeDefined()
  })

  it('should destroy client', () => {
    const client = new S3Client()
    client.destroy()
    // After destroy, operations should fail
  })
})

// ============================================================================
// BUCKET OPERATION TESTS
// ============================================================================

describe('Bucket operations', () => {
  let client: S3Client

  beforeEach(() => {
    clearAllBuckets()
    client = new S3Client({ region: 'us-east-1' })
  })

  afterEach(() => {
    client.destroy()
  })

  describe('CreateBucketCommand', () => {
    it('should create a bucket', async () => {
      const result = await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.Location).toBe('/test-bucket')
    })

    it('should create bucket with region', async () => {
      const result = await client.send(
        new CreateBucketCommand({
          Bucket: 'regional-bucket',
          CreateBucketConfiguration: {
            LocationConstraint: 'eu-west-1',
          },
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(200)
    })

    it('should throw BucketAlreadyExists for duplicate bucket', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))

      await expect(
        client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
      ).rejects.toThrow(BucketAlreadyExists)
    })
  })

  describe('DeleteBucketCommand', () => {
    it('should delete an empty bucket', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
      const result = await client.send(new DeleteBucketCommand({ Bucket: 'test-bucket' }))

      expect(result.$metadata.httpStatusCode).toBe(204)
    })

    it('should throw NoSuchBucket for non-existent bucket', async () => {
      await expect(
        client.send(new DeleteBucketCommand({ Bucket: 'nonexistent' }))
      ).rejects.toThrow(NoSuchBucket)
    })

    it('should throw BucketNotEmpty for non-empty bucket', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
          Body: 'test',
        })
      )

      await expect(
        client.send(new DeleteBucketCommand({ Bucket: 'test-bucket' }))
      ).rejects.toThrow(BucketNotEmpty)
    })
  })

  describe('ListBucketsCommand', () => {
    it('should list all buckets', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'bucket-1' }))
      await client.send(new CreateBucketCommand({ Bucket: 'bucket-2' }))
      await client.send(new CreateBucketCommand({ Bucket: 'bucket-3' }))

      const result = await client.send(new ListBucketsCommand({}))

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.Buckets).toHaveLength(3)
      expect(result.Buckets?.map((b) => b.Name).sort()).toEqual(['bucket-1', 'bucket-2', 'bucket-3'])
      expect(result.Owner).toBeDefined()
    })

    it('should return empty list when no buckets', async () => {
      const result = await client.send(new ListBucketsCommand({}))

      expect(result.Buckets).toHaveLength(0)
    })

    it('should include CreationDate', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'dated-bucket' }))

      const result = await client.send(new ListBucketsCommand({}))

      expect(result.Buckets?.[0].CreationDate).toBeInstanceOf(Date)
    })
  })

  describe('HeadBucketCommand', () => {
    it('should return bucket info', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))

      const result = await client.send(new HeadBucketCommand({ Bucket: 'test-bucket' }))

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.BucketRegion).toBe('us-east-1')
    })

    it('should throw NoSuchBucket for non-existent bucket', async () => {
      await expect(
        client.send(new HeadBucketCommand({ Bucket: 'nonexistent' }))
      ).rejects.toThrow(NoSuchBucket)
    })
  })
})

// ============================================================================
// OBJECT OPERATION TESTS
// ============================================================================

describe('Object operations', () => {
  let client: S3Client

  beforeEach(async () => {
    clearAllBuckets()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
  })

  afterEach(() => {
    client.destroy()
  })

  describe('PutObjectCommand', () => {
    it('should put a string object', async () => {
      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
          Body: 'Hello, World!',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.ETag).toBeDefined()
    })

    it('should put a Uint8Array object', async () => {
      const body = new Uint8Array([1, 2, 3, 4, 5])
      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'binary-key',
          Body: body,
        })
      )

      expect(result.ETag).toBeDefined()
    })

    it('should put object with content type', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.json',
          Body: '{"foo":"bar"}',
          ContentType: 'application/json',
        })
      )

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test.json',
        })
      )

      expect(head.ContentType).toBe('application/json')
    })

    it('should put object with metadata', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'meta-key',
          Body: 'test',
          Metadata: {
            'x-custom-header': 'custom-value',
            'another-header': 'another-value',
          },
        })
      )

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'meta-key',
        })
      )

      expect(head.Metadata).toEqual({
        'x-custom-header': 'custom-value',
        'another-header': 'another-value',
      })
    })

    it('should put object with cache control', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'cached-key',
          Body: 'test',
          CacheControl: 'max-age=3600',
        })
      )

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'cached-key',
        })
      )

      expect(head.CacheControl).toBe('max-age=3600')
    })

    it('should throw NoSuchBucket for non-existent bucket', async () => {
      await expect(
        client.send(
          new PutObjectCommand({
            Bucket: 'nonexistent',
            Key: 'test-key',
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
          Key: 'test-key',
          Body: 'Hello, World!',
          ContentType: 'text/plain',
        })
      )
    })

    it('should get an object', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.ContentType).toBe('text/plain')
      expect(result.ContentLength).toBe(13)
      expect(result.ETag).toBeDefined()
      expect(result.LastModified).toBeInstanceOf(Date)
    })

    it('should get object body as string', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const body = await result.Body?.transformToString()
      expect(body).toBe('Hello, World!')
    })

    it('should get object body as bytes', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const bytes = await result.Body?.transformToByteArray()
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes?.length).toBe(13)
    })

    it('should get object body as stream', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const stream = result.Body?.transformToWebStream()
      expect(stream).toBeInstanceOf(ReadableStream)

      const reader = stream?.getReader()
      const { value, done } = (await reader?.read()) ?? {}
      expect(done).toBe(false)
      expect(value).toBeInstanceOf(Uint8Array)
    })

    it('should throw NoSuchKey for non-existent key', async () => {
      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'nonexistent',
          })
        )
      ).rejects.toThrow(NoSuchKey)
    })

    it('should throw NoSuchBucket for non-existent bucket', async () => {
      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'nonexistent',
            Key: 'test-key',
          })
        )
      ).rejects.toThrow(NoSuchBucket)
    })

    it('should handle range requests', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
          Range: 'bytes=0-4',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(206)
      expect(result.ContentRange).toBe('bytes 0-4/13')
      const body = await result.Body?.transformToString()
      expect(body).toBe('Hello')
    })

    it('should handle If-None-Match (ETag match)', async () => {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test-key',
            IfNoneMatch: head.ETag,
          })
        )
      ).rejects.toThrow(NotModified)
    })

    it('should handle If-Match (ETag mismatch)', async () => {
      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test-key',
            IfMatch: '"wrong-etag"',
          })
        )
      ).rejects.toThrow(PreconditionFailed)
    })

    it('should override response headers', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
          ResponseContentType: 'application/octet-stream',
          ResponseContentDisposition: 'attachment; filename="download.txt"',
        })
      )

      expect(result.ContentType).toBe('application/octet-stream')
      expect(result.ContentDisposition).toBe('attachment; filename="download.txt"')
    })
  })

  describe('DeleteObjectCommand', () => {
    it('should delete an object', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'to-delete',
          Body: 'test',
        })
      )

      const result = await client.send(
        new DeleteObjectCommand({
          Bucket: 'test-bucket',
          Key: 'to-delete',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(204)

      // Verify deletion
      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'to-delete',
          })
        )
      ).rejects.toThrow(NoSuchKey)
    })

    it('should be idempotent (no error for non-existent key)', async () => {
      const result = await client.send(
        new DeleteObjectCommand({
          Bucket: 'test-bucket',
          Key: 'nonexistent',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(204)
    })

    it('should throw NoSuchBucket for non-existent bucket', async () => {
      await expect(
        client.send(
          new DeleteObjectCommand({
            Bucket: 'nonexistent',
            Key: 'test-key',
          })
        )
      ).rejects.toThrow(NoSuchBucket)
    })
  })

  describe('HeadObjectCommand', () => {
    beforeEach(async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
          Body: 'Hello, World!',
          ContentType: 'text/plain',
          Metadata: { 'x-custom': 'value' },
        })
      )
    })

    it('should get object metadata', async () => {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.ContentType).toBe('text/plain')
      expect(result.ContentLength).toBe(13)
      expect(result.ETag).toBeDefined()
      expect(result.LastModified).toBeInstanceOf(Date)
      expect(result.Metadata).toEqual({ 'x-custom': 'value' })
      expect(result.AcceptRanges).toBe('bytes')
    })

    it('should throw NoSuchKey for non-existent key', async () => {
      await expect(
        client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'nonexistent',
          })
        )
      ).rejects.toThrow(NoSuchKey)
    })

    it('should handle conditional requests', async () => {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      await expect(
        client.send(
          new HeadObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test-key',
            IfNoneMatch: head.ETag,
          })
        )
      ).rejects.toThrow(NotModified)
    })
  })

  describe('CopyObjectCommand', () => {
    beforeEach(async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'source-key',
          Body: 'Source content',
          ContentType: 'text/plain',
          Metadata: { original: 'true' },
        })
      )
    })

    it('should copy object within same bucket', async () => {
      const result = await client.send(
        new CopyObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
          CopySource: 'test-bucket/source-key',
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(result.CopyObjectResult?.ETag).toBeDefined()
      expect(result.CopyObjectResult?.LastModified).toBeInstanceOf(Date)

      // Verify copy
      const copied = await client.send(
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
        })
      )
      const body = await copied.Body?.transformToString()
      expect(body).toBe('Source content')
    })

    it('should copy object between buckets', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'dest-bucket' }))

      const result = await client.send(
        new CopyObjectCommand({
          Bucket: 'dest-bucket',
          Key: 'copied-key',
          CopySource: 'test-bucket/source-key',
        })
      )

      expect(result.CopyObjectResult?.ETag).toBeDefined()

      // Verify copy in dest bucket
      const copied = await client.send(
        new GetObjectCommand({
          Bucket: 'dest-bucket',
          Key: 'copied-key',
        })
      )
      const body = await copied.Body?.transformToString()
      expect(body).toBe('Source content')
    })

    it('should copy with COPY metadata directive', async () => {
      const result = await client.send(
        new CopyObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
          CopySource: 'test-bucket/source-key',
          MetadataDirective: 'COPY',
        })
      )

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
        })
      )

      expect(head.Metadata).toEqual({ original: 'true' })
    })

    it('should copy with REPLACE metadata directive', async () => {
      const result = await client.send(
        new CopyObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
          CopySource: 'test-bucket/source-key',
          MetadataDirective: 'REPLACE',
          Metadata: { replaced: 'true' },
        })
      )

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
        })
      )

      expect(head.Metadata).toEqual({ replaced: 'true' })
    })

    it('should throw NoSuchBucket for non-existent source bucket', async () => {
      await expect(
        client.send(
          new CopyObjectCommand({
            Bucket: 'test-bucket',
            Key: 'dest-key',
            CopySource: 'nonexistent/source-key',
          })
        )
      ).rejects.toThrow(NoSuchBucket)
    })

    it('should throw NoSuchKey for non-existent source key', async () => {
      await expect(
        client.send(
          new CopyObjectCommand({
            Bucket: 'test-bucket',
            Key: 'dest-key',
            CopySource: 'test-bucket/nonexistent',
          })
        )
      ).rejects.toThrow(NoSuchKey)
    })

    it('should handle copy source with leading slash', async () => {
      const result = await client.send(
        new CopyObjectCommand({
          Bucket: 'test-bucket',
          Key: 'dest-key',
          CopySource: '/test-bucket/source-key',
        })
      )

      expect(result.CopyObjectResult?.ETag).toBeDefined()
    })
  })
})

// ============================================================================
// LIST OBJECTS TESTS
// ============================================================================

describe('ListObjectsV2Command', () => {
  let client: S3Client

  beforeEach(async () => {
    clearAllBuckets()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))

    // Add test objects
    const objects = [
      'file1.txt',
      'file2.txt',
      'folder1/file1.txt',
      'folder1/file2.txt',
      'folder1/subfolder/file1.txt',
      'folder2/file1.txt',
    ]

    for (const key of objects) {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: key,
          Body: `Content of ${key}`,
        })
      )
    }
  })

  afterEach(() => {
    client.destroy()
  })

  it('should list all objects', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
      })
    )

    expect(result.$metadata.httpStatusCode).toBe(200)
    expect(result.Contents).toHaveLength(6)
    expect(result.Name).toBe('test-bucket')
    expect(result.KeyCount).toBe(6)
    expect(result.IsTruncated).toBe(false)
  })

  it('should list objects with prefix', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        Prefix: 'folder1/',
      })
    )

    expect(result.Contents).toHaveLength(3)
    expect(result.Contents?.every((obj) => obj.Key?.startsWith('folder1/'))).toBe(true)
  })

  it('should list objects with delimiter', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        Delimiter: '/',
      })
    )

    expect(result.Contents).toHaveLength(2) // file1.txt, file2.txt
    expect(result.CommonPrefixes).toHaveLength(2) // folder1/, folder2/
    expect(result.CommonPrefixes?.map((p) => p.Prefix).sort()).toEqual(['folder1/', 'folder2/'])
  })

  it('should list objects with prefix and delimiter', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        Prefix: 'folder1/',
        Delimiter: '/',
      })
    )

    expect(result.Contents).toHaveLength(2) // folder1/file1.txt, folder1/file2.txt
    expect(result.CommonPrefixes).toHaveLength(1) // folder1/subfolder/
    expect(result.CommonPrefixes?.[0].Prefix).toBe('folder1/subfolder/')
  })

  it('should paginate results with MaxKeys', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        MaxKeys: 2,
      })
    )

    expect(result.Contents).toHaveLength(2)
    expect(result.IsTruncated).toBe(true)
    expect(result.NextContinuationToken).toBeDefined()
    expect(result.MaxKeys).toBe(2)
  })

  it('should continue pagination with ContinuationToken', async () => {
    const first = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        MaxKeys: 2,
      })
    )

    const second = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        MaxKeys: 2,
        ContinuationToken: first.NextContinuationToken,
      })
    )

    expect(second.Contents).toHaveLength(2)
    expect(second.ContinuationToken).toBe(first.NextContinuationToken)

    // Keys should be different
    const firstKeys = first.Contents?.map((o) => o.Key) ?? []
    const secondKeys = second.Contents?.map((o) => o.Key) ?? []
    expect(firstKeys.some((k) => secondKeys.includes(k))).toBe(false)
  })

  it('should filter with StartAfter', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        StartAfter: 'folder1/file1.txt',
      })
    )

    // Should not include keys <= 'folder1/file1.txt'
    expect(result.Contents?.every((obj) => obj.Key! > 'folder1/file1.txt')).toBe(true)
  })

  it('should include object metadata', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        MaxKeys: 1,
      })
    )

    const obj = result.Contents?.[0]
    expect(obj?.Key).toBeDefined()
    expect(obj?.LastModified).toBeInstanceOf(Date)
    expect(obj?.ETag).toBeDefined()
    expect(obj?.Size).toBeGreaterThan(0)
    expect(obj?.StorageClass).toBe('STANDARD')
  })

  it('should include owner with FetchOwner', async () => {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
        FetchOwner: true,
        MaxKeys: 1,
      })
    )

    const obj = result.Contents?.[0]
    expect(obj?.Owner).toBeDefined()
    expect(obj?.Owner?.DisplayName).toBeDefined()
  })

  it('should throw NoSuchBucket for non-existent bucket', async () => {
    await expect(
      client.send(
        new ListObjectsV2Command({
          Bucket: 'nonexistent',
        })
      )
    ).rejects.toThrow(NoSuchBucket)
  })
})

// ============================================================================
// BATCH DELETE TESTS
// ============================================================================

describe('DeleteObjectsCommand', () => {
  let client: S3Client

  beforeEach(async () => {
    clearAllBuckets()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))

    for (let i = 1; i <= 5; i++) {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: `file${i}.txt`,
          Body: `Content ${i}`,
        })
      )
    }
  })

  afterEach(() => {
    client.destroy()
  })

  it('should delete multiple objects', async () => {
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [{ Key: 'file1.txt' }, { Key: 'file2.txt' }, { Key: 'file3.txt' }],
        },
      })
    )

    expect(result.$metadata.httpStatusCode).toBe(200)
    expect(result.Deleted).toHaveLength(3)
    expect(result.Deleted?.map((d) => d.Key).sort()).toEqual(['file1.txt', 'file2.txt', 'file3.txt'])

    // Verify remaining objects
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: 'test-bucket',
      })
    )
    expect(list.Contents).toHaveLength(2)
  })

  it('should handle Quiet mode', async () => {
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [{ Key: 'file1.txt' }, { Key: 'file2.txt' }],
          Quiet: true,
        },
      })
    )

    expect(result.Deleted).toHaveLength(0) // Quiet mode doesn't return deleted keys
  })

  it('should delete non-existent keys without error', async () => {
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [{ Key: 'nonexistent1.txt' }, { Key: 'nonexistent2.txt' }],
        },
      })
    )

    expect(result.Deleted).toHaveLength(2)
    expect(result.Errors).toBeUndefined()
  })

  it('should throw NoSuchBucket for non-existent bucket', async () => {
    await expect(
      client.send(
        new DeleteObjectsCommand({
          Bucket: 'nonexistent',
          Delete: {
            Objects: [{ Key: 'file1.txt' }],
          },
        })
      )
    ).rejects.toThrow(NoSuchBucket)
  })
})

// ============================================================================
// PRESIGNED URL TESTS
// ============================================================================

describe('getSignedUrl', () => {
  let client: S3Client

  beforeEach(async () => {
    clearAllBuckets()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
    await client.send(
      new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test',
      })
    )
  })

  afterEach(() => {
    client.destroy()
  })

  it('should generate presigned URL for GetObject', async () => {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
      })
    )

    expect(url).toContain('test-bucket')
    expect(url).toContain('test-key')
    expect(url).toContain('X-Amz-Algorithm')
    expect(url).toContain('X-Amz-Expires')
    expect(url).toContain('X-Amz-Signature')
  })

  it('should generate presigned URL for PutObject', async () => {
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'new-key',
      })
    )

    expect(url).toContain('test-bucket')
    expect(url).toContain('new-key')
    expect(url).toContain('X-Amz-Signature')
  })

  it('should respect expiresIn option', async () => {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
      }),
      { expiresIn: 7200 }
    )

    expect(url).toContain('X-Amz-Expires=7200')
  })
})

// ============================================================================
// AWS SIGNATURE V4 FORMAT VALIDATION TESTS
// ============================================================================

describe('getSignedUrl - AWS Signature V4 format', () => {
  let client: S3Client

  beforeEach(async () => {
    clearAllBuckets()
    client = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
    await client.send(new CreateBucketCommand({ Bucket: 'test-bucket' }))
    await client.send(
      new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test content',
      })
    )
  })

  afterEach(() => {
    client.destroy()
  })

  describe('presigned URL structure', () => {
    it('should include X-Amz-Credential in correct format', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      const credential = parsed.searchParams.get('X-Amz-Credential')

      expect(credential).not.toBeNull()
      // Format: <accessKeyId>/<date>/<region>/s3/aws4_request
      const credentialParts = credential!.split('/')
      expect(credentialParts).toHaveLength(5)
      expect(credentialParts[0]).toBe('AKIAIOSFODNN7EXAMPLE')
      expect(credentialParts[1]).toMatch(/^\d{8}$/) // YYYYMMDD
      expect(credentialParts[2]).toBe('us-east-1')
      expect(credentialParts[3]).toBe('s3')
      expect(credentialParts[4]).toBe('aws4_request')
    })

    it('should include X-Amz-Date in ISO8601 basic format', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      const amzDate = parsed.searchParams.get('X-Amz-Date')

      expect(amzDate).not.toBeNull()
      // Format: YYYYMMDDTHHMMSSZ
      expect(amzDate).toMatch(/^\d{8}T\d{6}Z$/)
    })

    it('should have X-Amz-Signature as 64-char lowercase hex', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      const signature = parsed.searchParams.get('X-Amz-Signature')

      expect(signature).not.toBeNull()
      // AWS Signature V4 produces a 64-character lowercase hex string (SHA256)
      expect(signature).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should include X-Amz-Algorithm as AWS4-HMAC-SHA256', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    })

    it('should include X-Amz-SignedHeaders containing host', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      const signedHeaders = parsed.searchParams.get('X-Amz-SignedHeaders')

      expect(signedHeaders).not.toBeNull()
      expect(signedHeaders).toContain('host')
    })
  })

  describe('signature verification', () => {
    it('should produce consistent signatures for same inputs', async () => {
      // Mock the current time to ensure consistent signatures
      const fixedDate = new Date('2024-01-15T10:30:00.000Z')
      vi.useFakeTimers()
      vi.setSystemTime(fixedDate)

      try {
        const url1 = await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test-key',
          }),
          { expiresIn: 3600 }
        )

        const url2 = await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: 'test-bucket',
            Key: 'test-key',
          }),
          { expiresIn: 3600 }
        )

        const parsed1 = new URL(url1)
        const parsed2 = new URL(url2)

        expect(parsed1.searchParams.get('X-Amz-Signature')).toBe(
          parsed2.searchParams.get('X-Amz-Signature')
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('should produce different signatures for different keys', async () => {
      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'other-key',
          Body: 'other content',
        })
      )

      const url2 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'other-key',
        })
      )

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature')
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature')

      expect(sig1).not.toBe(sig2)
    })

    it('should produce different signatures for different operations', async () => {
      const getUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const putUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const getSig = new URL(getUrl).searchParams.get('X-Amz-Signature')
      const putSig = new URL(putUrl).searchParams.get('X-Amz-Signature')

      expect(getSig).not.toBe(putSig)
    })

    it('should produce different signatures with different credentials', async () => {
      const url1 = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const client2 = new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'differentSecretKey1234567890ABCDEF',
        },
      })

      const url2 = await getSignedUrl(
        client2,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      client2.destroy()

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature')
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature')

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('expiration handling', () => {
    it('should include correct X-Amz-Expires value', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        }),
        { expiresIn: 900 }
      )

      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900')
    })

    it('should default to 3600 seconds expiration', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('3600')
    })
  })

  describe('URL structure', () => {
    it('should use virtual-hosted style URL by default', async () => {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      const parsed = new URL(url)
      expect(parsed.hostname).toBe('test-bucket.s3.us-east-1.amazonaws.com')
      expect(parsed.pathname).toBe('/test-key')
    })

    it('should properly encode special characters in keys', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'path/to/file with spaces.txt',
          Body: 'test',
        })
      )

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'path/to/file with spaces.txt',
        })
      )

      const parsed = new URL(url)
      // URL should be properly encoded
      expect(parsed.pathname).toContain('path/to/')
      expect(url).toContain('file%20with%20spaces.txt')
    })

    it('should use path-style URL when forcePathStyle is set', async () => {
      const pathStyleClient = new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
        forcePathStyle: true,
      })

      const url = await getSignedUrl(
        pathStyleClient,
        new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-key',
        })
      )

      pathStyleClient.destroy()

      const parsed = new URL(url)
      expect(parsed.hostname).toBe('s3.us-east-1.amazonaws.com')
      expect(parsed.pathname).toBe('/test-bucket/test-key')
    })
  })

  describe('region handling', () => {
    it('should include region in credential scope', async () => {
      const euClient = new S3Client({
        region: 'eu-west-1',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })

      await euClient.send(new CreateBucketCommand({ Bucket: 'eu-bucket' }))

      const url = await getSignedUrl(
        euClient,
        new GetObjectCommand({
          Bucket: 'eu-bucket',
          Key: 'test-key',
        })
      )

      euClient.destroy()

      const parsed = new URL(url)
      const credential = parsed.searchParams.get('X-Amz-Credential')

      expect(credential).toContain('/eu-west-1/s3/')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let client: S3Client

  beforeEach(() => {
    clearAllBuckets()
    client = new S3Client({ region: 'us-east-1' })
  })

  afterEach(() => {
    client.destroy()
  })

  it('should work with file upload workflow', async () => {
    // Create bucket
    await client.send(new CreateBucketCommand({ Bucket: 'uploads' }))

    // Upload file
    const fileContent = 'File content here'
    await client.send(
      new PutObjectCommand({
        Bucket: 'uploads',
        Key: 'documents/report.pdf',
        Body: fileContent,
        ContentType: 'application/pdf',
        Metadata: {
          'uploaded-by': 'user-123',
          'original-name': 'Q4 Report.pdf',
        },
      })
    )

    // Get file info
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: 'uploads',
        Key: 'documents/report.pdf',
      })
    )
    expect(head.ContentType).toBe('application/pdf')
    expect(head.Metadata?.['uploaded-by']).toBe('user-123')

    // Download file
    const get = await client.send(
      new GetObjectCommand({
        Bucket: 'uploads',
        Key: 'documents/report.pdf',
      })
    )
    const body = await get.Body?.transformToString()
    expect(body).toBe(fileContent)
  })

  it('should work with folder listing pattern', async () => {
    await client.send(new CreateBucketCommand({ Bucket: 'files' }))

    // Create folder structure
    const files = [
      'users/user1/profile.jpg',
      'users/user1/avatar.png',
      'users/user2/profile.jpg',
      'public/logo.svg',
      'public/banner.png',
    ]

    for (const key of files) {
      await client.send(
        new PutObjectCommand({
          Bucket: 'files',
          Key: key,
          Body: `Content of ${key}`,
        })
      )
    }

    // List root folders
    const root = await client.send(
      new ListObjectsV2Command({
        Bucket: 'files',
        Delimiter: '/',
      })
    )
    expect(root.CommonPrefixes?.map((p) => p.Prefix).sort()).toEqual(['public/', 'users/'])

    // List user1's files
    const user1 = await client.send(
      new ListObjectsV2Command({
        Bucket: 'files',
        Prefix: 'users/user1/',
      })
    )
    expect(user1.Contents?.map((o) => o.Key).sort()).toEqual([
      'users/user1/avatar.png',
      'users/user1/profile.jpg',
    ])
  })

  it('should work with versioned copy pattern', async () => {
    await client.send(new CreateBucketCommand({ Bucket: 'content' }))

    // Original version
    await client.send(
      new PutObjectCommand({
        Bucket: 'content',
        Key: 'article.txt',
        Body: 'Version 1',
      })
    )

    // Create backup before update
    await client.send(
      new CopyObjectCommand({
        Bucket: 'content',
        Key: 'backups/article.v1.txt',
        CopySource: 'content/article.txt',
      })
    )

    // Update original
    await client.send(
      new PutObjectCommand({
        Bucket: 'content',
        Key: 'article.txt',
        Body: 'Version 2',
      })
    )

    // Verify versions
    const current = await client.send(
      new GetObjectCommand({
        Bucket: 'content',
        Key: 'article.txt',
      })
    )
    expect(await current.Body?.transformToString()).toBe('Version 2')

    const backup = await client.send(
      new GetObjectCommand({
        Bucket: 'content',
        Key: 'backups/article.v1.txt',
      })
    )
    expect(await backup.Body?.transformToString()).toBe('Version 1')
  })

  it('should work with cleanup workflow', async () => {
    await client.send(new CreateBucketCommand({ Bucket: 'temp' }))

    // Create temporary files
    for (let i = 0; i < 10; i++) {
      await client.send(
        new PutObjectCommand({
          Bucket: 'temp',
          Key: `temp-${i}.tmp`,
          Body: `Temp ${i}`,
        })
      )
    }

    // List and batch delete
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: 'temp',
      })
    )

    const keysToDelete = list.Contents?.map((o) => ({ Key: o.Key! })) ?? []
    await client.send(
      new DeleteObjectsCommand({
        Bucket: 'temp',
        Delete: {
          Objects: keysToDelete,
        },
      })
    )

    // Verify empty
    const after = await client.send(
      new ListObjectsV2Command({
        Bucket: 'temp',
      })
    )
    expect(after.Contents).toHaveLength(0)

    // Delete bucket
    await client.send(new DeleteBucketCommand({ Bucket: 'temp' }))

    // Verify bucket gone
    await expect(
      client.send(new HeadBucketCommand({ Bucket: 'temp' }))
    ).rejects.toThrow(NoSuchBucket)
  })

  it('should work with conditional requests for caching', async () => {
    await client.send(new CreateBucketCommand({ Bucket: 'cache' }))

    await client.send(
      new PutObjectCommand({
        Bucket: 'cache',
        Key: 'resource.json',
        Body: '{"data": "value"}',
        ContentType: 'application/json',
      })
    )

    // First request - get ETag
    const first = await client.send(
      new GetObjectCommand({
        Bucket: 'cache',
        Key: 'resource.json',
      })
    )
    const etag = first.ETag

    // Conditional request - should get 304
    await expect(
      client.send(
        new GetObjectCommand({
          Bucket: 'cache',
          Key: 'resource.json',
          IfNoneMatch: etag,
        })
      )
    ).rejects.toThrow(NotModified)

    // Update resource
    await client.send(
      new PutObjectCommand({
        Bucket: 'cache',
        Key: 'resource.json',
        Body: '{"data": "updated"}',
        ContentType: 'application/json',
      })
    )

    // Same conditional request - should now succeed
    const updated = await client.send(
      new GetObjectCommand({
        Bucket: 'cache',
        Key: 'resource.json',
        IfNoneMatch: etag,
      })
    )
    const body = await updated.Body?.transformToString()
    expect(body).toBe('{"data": "updated"}')
  })
})
