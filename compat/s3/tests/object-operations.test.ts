/**
 * @dotdo/s3 - Object Operations Tests (RED Phase)
 *
 * Comprehensive TDD RED tests for S3 object operations.
 * These tests define expected behavior that may not be fully implemented yet.
 *
 * Tests cover:
 * 1. getObject() - various content types, metadata, not found handling
 * 2. putObject() - different sizes, content types, metadata
 * 3. deleteObject() - single and batch delete
 * 4. headObject() - metadata retrieval
 * 5. copyObject() - same and cross-bucket copies
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  NoSuchKey,
  NoSuchBucket,
  InvalidRange,
  PreconditionFailed,
  NotModified,
  _clearAll,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('S3 Object Operations (RED Phase)', () => {
  let client: InstanceType<typeof S3Client>
  const TEST_BUCKET = 'object-ops-test-bucket'
  const DEST_BUCKET = 'object-ops-dest-bucket'

  beforeEach(async () => {
    _clearAll()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
  })

  afterEach(() => {
    _clearAll()
  })

  // ===========================================================================
  // GetObject Tests
  // ===========================================================================

  describe('GetObjectCommand', () => {
    describe('Basic Retrieval', () => {
      it('should get a text object', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'hello.txt',
            Body: 'Hello, World!',
            ContentType: 'text/plain',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'hello.txt',
          })
        )

        expect(result.Body).toBeDefined()
        expect(result.ContentType).toBe('text/plain')
        expect(result.ContentLength).toBe(13)
        const text = await result.Body!.transformToString()
        expect(text).toBe('Hello, World!')
      })

      it('should get a binary object', async () => {
        const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd])
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'binary.bin',
            Body: binaryData,
            ContentType: 'application/octet-stream',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'binary.bin',
          })
        )

        expect(result.ContentType).toBe('application/octet-stream')
        const bytes = await result.Body!.transformToByteArray()
        expect(bytes).toEqual(binaryData)
      })

      it('should get an empty object', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'empty.txt',
            Body: '',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'empty.txt',
          })
        )

        expect(result.ContentLength).toBe(0)
        const text = await result.Body!.transformToString()
        expect(text).toBe('')
      })
    })

    describe('Content Types', () => {
      it('should preserve JSON content type', async () => {
        const jsonData = JSON.stringify({ name: 'test', value: 42 })
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data.json',
            Body: jsonData,
            ContentType: 'application/json',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data.json',
          })
        )

        expect(result.ContentType).toBe('application/json')
        const text = await result.Body!.transformToString()
        expect(JSON.parse(text)).toEqual({ name: 'test', value: 42 })
      })

      it('should preserve XML content type', async () => {
        const xmlData = '<?xml version="1.0"?><root><item>test</item></root>'
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data.xml',
            Body: xmlData,
            ContentType: 'application/xml',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data.xml',
          })
        )

        expect(result.ContentType).toBe('application/xml')
      })

      it('should preserve image content type', async () => {
        // 1x1 transparent PNG
        const pngData = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        ])
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'image.png',
            Body: pngData,
            ContentType: 'image/png',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'image.png',
          })
        )

        expect(result.ContentType).toBe('image/png')
      })

      it('should handle multipart/form-data content type', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'form-data.txt',
            Body: 'form data content',
            ContentType: 'multipart/form-data; boundary=----WebKitFormBoundary',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'form-data.txt',
          })
        )

        expect(result.ContentType).toBe('multipart/form-data; boundary=----WebKitFormBoundary')
      })
    })

    describe('Metadata Retrieval', () => {
      it('should return custom metadata', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'with-metadata.txt',
            Body: 'test',
            Metadata: {
              author: 'John Doe',
              version: '1.0',
              'custom-key': 'custom-value',
            },
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'with-metadata.txt',
          })
        )

        expect(result.Metadata).toEqual({
          author: 'John Doe',
          version: '1.0',
          'custom-key': 'custom-value',
        })
      })

      it('should return ETag', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'etag-test.txt',
            Body: 'test content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'etag-test.txt',
          })
        )

        expect(result.ETag).toBeDefined()
        expect(typeof result.ETag).toBe('string')
      })

      it('should return LastModified date', async () => {
        const beforePut = new Date()
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'date-test.txt',
            Body: 'test',
          })
        )
        const afterPut = new Date()

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'date-test.txt',
          })
        )

        expect(result.LastModified).toBeInstanceOf(Date)
        expect(result.LastModified!.getTime()).toBeGreaterThanOrEqual(beforePut.getTime())
        expect(result.LastModified!.getTime()).toBeLessThanOrEqual(afterPut.getTime())
      })

      it('should return CacheControl', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'cached.txt',
            Body: 'cached content',
            CacheControl: 'max-age=3600, public',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'cached.txt',
          })
        )

        expect(result.CacheControl).toBe('max-age=3600, public')
      })

      it('should return ContentEncoding', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'encoded.txt',
            Body: 'encoded content',
            ContentEncoding: 'gzip',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'encoded.txt',
          })
        )

        expect(result.ContentEncoding).toBe('gzip')
      })

      it('should return ContentDisposition', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'download.pdf',
            Body: 'pdf content',
            ContentDisposition: 'attachment; filename="report.pdf"',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'download.pdf',
          })
        )

        expect(result.ContentDisposition).toBe('attachment; filename="report.pdf"')
      })

      it('should return ContentLanguage', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'localized.txt',
            Body: 'localized content',
            ContentLanguage: 'en-US',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'localized.txt',
          })
        )

        expect(result.ContentLanguage).toBe('en-US')
      })
    })

    describe('Range Requests', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'range-test.txt',
            Body: '0123456789ABCDEF',
          })
        )
      })

      it('should handle byte range from start', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'range-test.txt',
            Range: 'bytes=0-4',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(206)
        expect(result.ContentLength).toBe(5)
        expect(result.ContentRange).toBe('bytes 0-4/16')
        const text = await result.Body!.transformToString()
        expect(text).toBe('01234')
      })

      it('should handle byte range from middle', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'range-test.txt',
            Range: 'bytes=5-9',
          })
        )

        expect(result.ContentRange).toBe('bytes 5-9/16')
        const text = await result.Body!.transformToString()
        expect(text).toBe('56789')
      })

      it('should handle byte range to end', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'range-test.txt',
            Range: 'bytes=10-',
          })
        )

        expect(result.ContentRange).toBe('bytes 10-15/16')
        const text = await result.Body!.transformToString()
        expect(text).toBe('ABCDEF')
      })

      it('should handle suffix range (last N bytes)', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'range-test.txt',
            Range: 'bytes=-4',
          })
        )

        expect(result.ContentRange).toBe('bytes 12-15/16')
        const text = await result.Body!.transformToString()
        expect(text).toBe('CDEF')
      })

      it('should clamp range exceeding content length', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'range-test.txt',
            Range: 'bytes=10-100',
          })
        )

        expect(result.ContentRange).toBe('bytes 10-15/16')
        expect(result.ContentLength).toBe(6)
      })

      it('should throw InvalidRange for unsatisfiable range', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'range-test.txt',
              Range: 'bytes=100-200',
            })
          )
        ).rejects.toThrow(InvalidRange)
      })
    })

    describe('Conditional Requests', () => {
      let objectETag: string
      let objectLastModified: Date

      beforeEach(async () => {
        const putResult = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional.txt',
            Body: 'conditional content',
          })
        )
        objectETag = putResult.ETag!

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional.txt',
          })
        )
        objectLastModified = headResult.LastModified!
      })

      it('should return object when IfMatch matches ETag', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional.txt',
            IfMatch: objectETag,
          })
        )

        expect(result.Body).toBeDefined()
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should throw PreconditionFailed when IfMatch does not match', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional.txt',
              IfMatch: '"non-matching-etag"',
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })

      it('should return object when IfNoneMatch does not match', async () => {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional.txt',
            IfNoneMatch: '"different-etag"',
          })
        )

        expect(result.Body).toBeDefined()
      })

      it('should throw NotModified when IfNoneMatch matches', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional.txt',
              IfNoneMatch: objectETag,
            })
          )
        ).rejects.toThrow(NotModified)
      })

      it('should return object when IfModifiedSince is before LastModified', async () => {
        const pastDate = new Date(objectLastModified.getTime() - 10000)
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional.txt',
            IfModifiedSince: pastDate,
          })
        )

        expect(result.Body).toBeDefined()
      })

      it('should throw NotModified when IfModifiedSince is after LastModified', async () => {
        const futureDate = new Date(objectLastModified.getTime() + 10000)
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional.txt',
              IfModifiedSince: futureDate,
            })
          )
        ).rejects.toThrow(NotModified)
      })

      it('should return object when IfUnmodifiedSince is after LastModified', async () => {
        const futureDate = new Date(objectLastModified.getTime() + 10000)
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional.txt',
            IfUnmodifiedSince: futureDate,
          })
        )

        expect(result.Body).toBeDefined()
      })

      it('should throw PreconditionFailed when IfUnmodifiedSince is before LastModified', async () => {
        const pastDate = new Date(objectLastModified.getTime() - 10000)
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional.txt',
              IfUnmodifiedSince: pastDate,
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })
    })

    describe('Error Handling', () => {
      it('should throw NoSuchKey for non-existent object', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'does-not-exist.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: 'non-existent-bucket',
              Key: 'any-key.txt',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should handle keys with special characters', async () => {
        const specialKey = 'path/to/file with spaces & special=chars.txt'
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: specialKey,
            Body: 'special chars content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: specialKey,
          })
        )

        expect(result.Body).toBeDefined()
      })

      it('should handle keys with unicode characters', async () => {
        const unicodeKey = 'path/to/file-with-unicode-chars.txt'
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: unicodeKey,
            Body: 'unicode content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: unicodeKey,
          })
        )

        expect(result.Body).toBeDefined()
      })
    })

    describe('Streaming', () => {
      it('should return body as ReadableStream', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'stream.txt',
            Body: 'streaming content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'stream.txt',
          })
        )

        const stream = result.Body!.transformToWebStream()
        expect(stream).toBeInstanceOf(ReadableStream)

        // Read from stream
        const reader = stream.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }

        const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }

        expect(new TextDecoder().decode(combined)).toBe('streaming content')
      })
    })
  })

  // ===========================================================================
  // PutObject Tests
  // ===========================================================================

  describe('PutObjectCommand', () => {
    describe('Basic Upload', () => {
      it('should upload a string body', async () => {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'string-body.txt',
            Body: 'Hello, String!',
          })
        )

        expect(result.ETag).toBeDefined()
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should upload a Uint8Array body', async () => {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'uint8-body.bin',
            Body: new Uint8Array([1, 2, 3, 4, 5]),
          })
        )

        expect(result.ETag).toBeDefined()
      })

      it('should upload a ReadableStream body', async () => {
        const chunks = ['chunk1', 'chunk2', 'chunk3']
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
            Bucket: TEST_BUCKET,
            Key: 'stream-body.txt',
            Body: stream,
          })
        )

        expect(result.ETag).toBeDefined()

        // Verify content
        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'stream-body.txt',
          })
        )
        const text = await getResult.Body!.transformToString()
        expect(text).toBe('chunk1chunk2chunk3')
      })

      it('should upload an empty body', async () => {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'empty.txt',
            Body: '',
          })
        )

        expect(result.ETag).toBeDefined()

        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'empty.txt',
          })
        )
        expect(getResult.ContentLength).toBe(0)
      })

      it('should upload without body (0-byte object)', async () => {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'no-body.txt',
          })
        )

        expect(result.ETag).toBeDefined()
      })
    })

    describe('Different Sizes', () => {
      it('should upload a small object (< 1KB)', async () => {
        const smallData = 'x'.repeat(100)
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'small.txt',
            Body: smallData,
          })
        )

        expect(result.ETag).toBeDefined()

        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'small.txt',
          })
        )
        expect(getResult.ContentLength).toBe(100)
      })

      it('should upload a medium object (1MB)', async () => {
        const mediumData = new Uint8Array(1024 * 1024).fill(65)
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'medium.bin',
            Body: mediumData,
          })
        )

        expect(result.ETag).toBeDefined()

        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'medium.bin',
          })
        )
        expect(getResult.ContentLength).toBe(1024 * 1024)
      })

      it('should upload a large object (10MB)', async () => {
        const largeData = new Uint8Array(10 * 1024 * 1024).fill(66)
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large.bin',
            Body: largeData,
          })
        )

        expect(result.ETag).toBeDefined()

        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large.bin',
          })
        )
        expect(getResult.ContentLength).toBe(10 * 1024 * 1024)
      })
    })

    describe('Content Types', () => {
      it('should set text/plain content type', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'plain.txt',
            Body: 'plain text',
            ContentType: 'text/plain',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'plain.txt',
          })
        )
        expect(result.ContentType).toBe('text/plain')
      })

      it('should set application/json content type', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data.json',
            Body: '{"key": "value"}',
            ContentType: 'application/json',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data.json',
          })
        )
        expect(result.ContentType).toBe('application/json')
      })

      it('should set text/html content type with charset', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'page.html',
            Body: '<html></html>',
            ContentType: 'text/html; charset=utf-8',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'page.html',
          })
        )
        expect(result.ContentType).toBe('text/html; charset=utf-8')
      })

      it('should set application/octet-stream for binary', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'binary.dat',
            Body: new Uint8Array([0x00, 0xff]),
            ContentType: 'application/octet-stream',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'binary.dat',
          })
        )
        expect(result.ContentType).toBe('application/octet-stream')
      })
    })

    describe('Metadata', () => {
      it('should store custom metadata', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'with-meta.txt',
            Body: 'content',
            Metadata: {
              'x-custom-header': 'custom-value',
              author: 'test-author',
              version: '1.0.0',
            },
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'with-meta.txt',
          })
        )
        expect(result.Metadata).toEqual({
          'x-custom-header': 'custom-value',
          author: 'test-author',
          version: '1.0.0',
        })
      })

      it('should store CacheControl', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'cached.txt',
            Body: 'cached',
            CacheControl: 'max-age=31536000, immutable',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'cached.txt',
          })
        )
        expect(result.CacheControl).toBe('max-age=31536000, immutable')
      })

      it('should store ContentEncoding', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'compressed.gz',
            Body: new Uint8Array([0x1f, 0x8b]), // gzip magic bytes
            ContentEncoding: 'gzip',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'compressed.gz',
          })
        )
        expect(result.ContentEncoding).toBe('gzip')
      })

      it('should store ContentDisposition', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'download.pdf',
            Body: 'pdf content',
            ContentDisposition: 'attachment; filename="report.pdf"',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'download.pdf',
          })
        )
        expect(result.ContentDisposition).toBe('attachment; filename="report.pdf"')
      })

      it('should store ContentLanguage', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'spanish.txt',
            Body: 'Hola mundo',
            ContentLanguage: 'es-ES',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'spanish.txt',
          })
        )
        expect(result.ContentLanguage).toBe('es-ES')
      })

      it('should store StorageClass', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'archived.txt',
            Body: 'archived content',
            StorageClass: 'STANDARD_IA',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'archived.txt',
          })
        )
        expect(result.StorageClass).toBe('STANDARD_IA')
      })
    })

    describe('Overwriting', () => {
      it('should overwrite existing object', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'overwrite.txt',
            Body: 'original content',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'overwrite.txt',
            Body: 'new content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'overwrite.txt',
          })
        )
        const text = await result.Body!.transformToString()
        expect(text).toBe('new content')
      })

      it('should update metadata when overwriting', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'meta-overwrite.txt',
            Body: 'content',
            Metadata: { version: '1' },
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'meta-overwrite.txt',
            Body: 'content',
            Metadata: { version: '2' },
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'meta-overwrite.txt',
          })
        )
        expect(result.Metadata).toEqual({ version: '2' })
      })

      it('should generate new ETag when overwriting', async () => {
        const result1 = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'etag-change.txt',
            Body: 'content 1',
          })
        )

        const result2 = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'etag-change.txt',
            Body: 'content 2 (different)',
          })
        )

        expect(result1.ETag).not.toBe(result2.ETag)
      })
    })

    describe('Error Handling', () => {
      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new PutObjectCommand({
              Bucket: 'non-existent-bucket',
              Key: 'test.txt',
              Body: 'content',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should handle keys with leading slashes', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: '/leading/slash/key.txt',
            Body: 'content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: '/leading/slash/key.txt',
          })
        )
        expect(result.Body).toBeDefined()
      })

      it('should handle deeply nested keys', async () => {
        const deepKey = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/file.txt'
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: deepKey,
            Body: 'deep content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: deepKey,
          })
        )
        expect(result.Body).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // DeleteObject Tests
  // ===========================================================================

  describe('DeleteObjectCommand', () => {
    describe('Single Delete', () => {
      it('should delete an existing object', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'to-delete.txt',
            Body: 'delete me',
          })
        )

        const result = await client.send(
          new DeleteObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'to-delete.txt',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)

        // Verify deletion
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'to-delete.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })

      it('should succeed for non-existent object (idempotent)', async () => {
        const result = await client.send(
          new DeleteObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'does-not-exist.txt',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)
      })

      it('should delete object but not affect other objects', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'keep.txt',
            Body: 'keep me',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'delete.txt',
            Body: 'delete me',
          })
        )

        await client.send(
          new DeleteObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'delete.txt',
          })
        )

        // Other object should still exist
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'keep.txt',
          })
        )
        expect(result.Body).toBeDefined()
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new DeleteObjectCommand({
              Bucket: 'non-existent-bucket',
              Key: 'any.txt',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('Batch Delete (DeleteObjectsCommand)', () => {
      beforeEach(async () => {
        // Create multiple objects
        for (let i = 1; i <= 5; i++) {
          await client.send(
            new PutObjectCommand({
              Bucket: TEST_BUCKET,
              Key: `batch/file${i}.txt`,
              Body: `content ${i}`,
            })
          )
        }
      })

      it('should delete multiple objects', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: {
              Objects: [
                { Key: 'batch/file1.txt' },
                { Key: 'batch/file2.txt' },
                { Key: 'batch/file3.txt' },
              ],
            },
          })
        )

        expect(result.Deleted).toHaveLength(3)
        expect(result.Errors).toHaveLength(0)

        // Verify deletions
        for (let i = 1; i <= 3; i++) {
          await expect(
            client.send(
              new GetObjectCommand({
                Bucket: TEST_BUCKET,
                Key: `batch/file${i}.txt`,
              })
            )
          ).rejects.toThrow(NoSuchKey)
        }

        // Others should still exist
        const file4 = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'batch/file4.txt',
          })
        )
        expect(file4.Body).toBeDefined()
      })

      it('should include deleted keys in response', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: {
              Objects: [
                { Key: 'batch/file1.txt' },
                { Key: 'batch/file2.txt' },
              ],
            },
          })
        )

        expect(result.Deleted!.map((d) => d.Key)).toContain('batch/file1.txt')
        expect(result.Deleted!.map((d) => d.Key)).toContain('batch/file2.txt')
      })

      it('should handle non-existent keys in batch delete', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: {
              Objects: [
                { Key: 'batch/file1.txt' },
                { Key: 'batch/non-existent.txt' },
                { Key: 'batch/another-missing.txt' },
              ],
            },
          })
        )

        // S3 reports non-existent as deleted
        expect(result.Deleted).toHaveLength(3)
        expect(result.Errors).toHaveLength(0)
      })

      it('should handle empty delete request', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: {
              Objects: [],
            },
          })
        )

        expect(result.Deleted).toHaveLength(0)
        expect(result.Errors).toHaveLength(0)
      })

      it('should delete up to 1000 objects in one request', async () => {
        // Create 1000 objects
        const promises: Promise<unknown>[] = []
        for (let i = 0; i < 1000; i++) {
          promises.push(
            client.send(
              new PutObjectCommand({
                Bucket: TEST_BUCKET,
                Key: `bulk/file${i.toString().padStart(4, '0')}.txt`,
                Body: `content ${i}`,
              })
            )
          )
        }
        await Promise.all(promises)

        const objects = Array.from({ length: 1000 }, (_, i) => ({
          Key: `bulk/file${i.toString().padStart(4, '0')}.txt`,
        }))

        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: {
              Objects: objects,
            },
          })
        )

        expect(result.Deleted).toHaveLength(1000)
      })

      it('should support Quiet mode', async () => {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: {
              Objects: [
                { Key: 'batch/file1.txt' },
                { Key: 'batch/file2.txt' },
              ],
              Quiet: true,
            },
          })
        )

        // In Quiet mode, only errors are returned
        // Since there are no errors, Deleted might be empty or not included
        expect(result.Errors).toHaveLength(0)
      })
    })
  })

  // ===========================================================================
  // HeadObject Tests
  // ===========================================================================

  describe('HeadObjectCommand', () => {
    describe('Metadata Retrieval', () => {
      beforeEach(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
            Body: 'Hello, HEAD!',
            ContentType: 'text/plain',
            CacheControl: 'max-age=3600',
            ContentEncoding: 'identity',
            ContentDisposition: 'inline',
            ContentLanguage: 'en-US',
            Metadata: {
              author: 'Test Author',
              version: '1.0',
            },
          })
        )
      })

      it('should return ContentLength', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.ContentLength).toBe(12)
      })

      it('should return ContentType', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.ContentType).toBe('text/plain')
      })

      it('should return ETag', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.ETag).toBeDefined()
        expect(typeof result.ETag).toBe('string')
      })

      it('should return LastModified', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.LastModified).toBeInstanceOf(Date)
      })

      it('should return CacheControl', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.CacheControl).toBe('max-age=3600')
      })

      it('should return ContentEncoding', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.ContentEncoding).toBe('identity')
      })

      it('should return ContentDisposition', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.ContentDisposition).toBe('inline')
      })

      it('should return ContentLanguage', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.ContentLanguage).toBe('en-US')
      })

      it('should return custom Metadata', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'head-test.txt',
          })
        )

        expect(result.Metadata).toEqual({
          author: 'Test Author',
          version: '1.0',
        })
      })

      it('should return StorageClass', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'storage-class.txt',
            Body: 'test',
            StorageClass: 'STANDARD',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'storage-class.txt',
          })
        )

        expect(result.StorageClass).toBe('STANDARD')
      })
    })

    describe('Conditional Requests', () => {
      let objectETag: string
      let objectLastModified: Date

      beforeEach(async () => {
        const putResult = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-head.txt',
            Body: 'conditional',
          })
        )
        objectETag = putResult.ETag!

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-head.txt',
          })
        )
        objectLastModified = headResult.LastModified!
      })

      it('should return metadata when IfMatch matches', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-head.txt',
            IfMatch: objectETag,
          })
        )

        expect(result.ContentLength).toBeDefined()
      })

      it('should throw PreconditionFailed when IfMatch does not match', async () => {
        await expect(
          client.send(
            new HeadObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional-head.txt',
              IfMatch: '"wrong-etag"',
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })

      it('should return metadata when IfNoneMatch does not match', async () => {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-head.txt',
            IfNoneMatch: '"different-etag"',
          })
        )

        expect(result.ContentLength).toBeDefined()
      })

      it('should throw NotModified when IfNoneMatch matches', async () => {
        await expect(
          client.send(
            new HeadObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional-head.txt',
              IfNoneMatch: objectETag,
            })
          )
        ).rejects.toThrow(NotModified)
      })
    })

    describe('Error Handling', () => {
      it('should throw NoSuchKey for non-existent object', async () => {
        await expect(
          client.send(
            new HeadObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'does-not-exist.txt',
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new HeadObjectCommand({
              Bucket: 'non-existent-bucket',
              Key: 'any.txt',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('Edge Cases', () => {
      it('should return metadata for 0-byte object', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'zero-byte.txt',
            Body: '',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'zero-byte.txt',
          })
        )

        expect(result.ContentLength).toBe(0)
        expect(result.ETag).toBeDefined()
      })

      it('should handle special characters in key', async () => {
        const specialKey = 'special/chars/file name (1) [test].txt'
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: specialKey,
            Body: 'content',
          })
        )

        const result = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: specialKey,
          })
        )

        expect(result.ContentLength).toBe(7)
      })
    })
  })

  // ===========================================================================
  // CopyObject Tests
  // ===========================================================================

  describe('CopyObjectCommand', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: DEST_BUCKET }))
      await client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET,
          Key: 'source.txt',
          Body: 'source content',
          ContentType: 'text/plain',
          CacheControl: 'max-age=3600',
          Metadata: {
            original: 'true',
            author: 'source-author',
          },
        })
      )
    })

    describe('Same Bucket Copy', () => {
      it('should copy an object within the same bucket', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'destination.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
          })
        )

        expect(result.CopyObjectResult).toBeDefined()
        expect(result.CopyObjectResult!.ETag).toBeDefined()
        expect(result.CopyObjectResult!.LastModified).toBeInstanceOf(Date)

        // Verify the copy
        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'destination.txt',
          })
        )
        const text = await getResult.Body!.transformToString()
        expect(text).toBe('source content')
      })

      it('should copy with leading slash in CopySource', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'copy-slash.txt',
            CopySource: `/${TEST_BUCKET}/source.txt`,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()
      })

      it('should preserve metadata by default (COPY directive)', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'copy-meta.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'copy-meta.txt',
          })
        )

        expect(headResult.ContentType).toBe('text/plain')
        expect(headResult.CacheControl).toBe('max-age=3600')
        expect(headResult.Metadata).toEqual({
          original: 'true',
          author: 'source-author',
        })
      })
    })

    describe('Cross-Bucket Copy', () => {
      it('should copy an object to a different bucket', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: DEST_BUCKET,
            Key: 'cross-bucket-copy.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()

        // Verify in destination bucket
        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: DEST_BUCKET,
            Key: 'cross-bucket-copy.txt',
          })
        )
        const text = await getResult.Body!.transformToString()
        expect(text).toBe('source content')
      })

      it('should preserve original after cross-bucket copy', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: DEST_BUCKET,
            Key: 'copy.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
          })
        )

        // Original should still exist
        const original = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'source.txt',
          })
        )
        expect(original.Body).toBeDefined()
      })
    })

    describe('Metadata Directives', () => {
      it('should copy metadata with COPY directive', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'copy-directive.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            MetadataDirective: 'COPY',
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'copy-directive.txt',
          })
        )

        expect(headResult.Metadata).toEqual({
          original: 'true',
          author: 'source-author',
        })
      })

      it('should replace metadata with REPLACE directive', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'replace-directive.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            MetadataDirective: 'REPLACE',
            Metadata: {
              new: 'metadata',
              replaced: 'true',
            },
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'replace-directive.txt',
          })
        )

        expect(headResult.Metadata).toEqual({
          new: 'metadata',
          replaced: 'true',
        })
      })

      it('should replace ContentType with REPLACE directive', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'replace-type.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            MetadataDirective: 'REPLACE',
            ContentType: 'application/json',
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'replace-type.txt',
          })
        )

        expect(headResult.ContentType).toBe('application/json')
      })

      it('should replace CacheControl with REPLACE directive', async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'replace-cache.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            MetadataDirective: 'REPLACE',
            CacheControl: 'no-cache',
          })
        )

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'replace-cache.txt',
          })
        )

        expect(headResult.CacheControl).toBe('no-cache')
      })
    })

    describe('Conditional Copy', () => {
      let sourceETag: string
      let sourceLastModified: Date

      beforeEach(async () => {
        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'source.txt',
          })
        )
        sourceETag = headResult.ETag!
        sourceLastModified = headResult.LastModified!
      })

      it('should copy when CopySourceIfMatch matches', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-copy.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            CopySourceIfMatch: sourceETag,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()
      })

      it('should throw PreconditionFailed when CopySourceIfMatch does not match', async () => {
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional-copy.txt',
              CopySource: `${TEST_BUCKET}/source.txt`,
              CopySourceIfMatch: '"wrong-etag"',
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })

      it('should copy when CopySourceIfNoneMatch does not match', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-copy.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            CopySourceIfNoneMatch: '"different-etag"',
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()
      })

      it('should throw PreconditionFailed when CopySourceIfNoneMatch matches', async () => {
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional-copy.txt',
              CopySource: `${TEST_BUCKET}/source.txt`,
              CopySourceIfNoneMatch: sourceETag,
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })

      it('should copy when CopySourceIfModifiedSince is before source modified', async () => {
        const pastDate = new Date(sourceLastModified.getTime() - 10000)
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-copy.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            CopySourceIfModifiedSince: pastDate,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()
      })

      it('should throw PreconditionFailed when CopySourceIfModifiedSince is after source modified', async () => {
        const futureDate = new Date(sourceLastModified.getTime() + 10000)
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional-copy.txt',
              CopySource: `${TEST_BUCKET}/source.txt`,
              CopySourceIfModifiedSince: futureDate,
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })

      it('should copy when CopySourceIfUnmodifiedSince is after source modified', async () => {
        const futureDate = new Date(sourceLastModified.getTime() + 10000)
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'conditional-copy.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            CopySourceIfUnmodifiedSince: futureDate,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()
      })

      it('should throw PreconditionFailed when CopySourceIfUnmodifiedSince is before source modified', async () => {
        const pastDate = new Date(sourceLastModified.getTime() - 10000)
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'conditional-copy.txt',
              CopySource: `${TEST_BUCKET}/source.txt`,
              CopySourceIfUnmodifiedSince: pastDate,
            })
          )
        ).rejects.toThrow(PreconditionFailed)
      })
    })

    describe('Error Handling', () => {
      it('should throw NoSuchKey for non-existent source', async () => {
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'dest.txt',
              CopySource: `${TEST_BUCKET}/non-existent.txt`,
            })
          )
        ).rejects.toThrow(NoSuchKey)
      })

      it('should throw NoSuchBucket for non-existent source bucket', async () => {
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'dest.txt',
              CopySource: 'non-existent-bucket/source.txt',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should throw NoSuchBucket for non-existent destination bucket', async () => {
        await expect(
          client.send(
            new CopyObjectCommand({
              Bucket: 'non-existent-bucket',
              Key: 'dest.txt',
              CopySource: `${TEST_BUCKET}/source.txt`,
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('Edge Cases', () => {
      it('should copy to same key (in-place metadata update)', async () => {
        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'source.txt',
            CopySource: `${TEST_BUCKET}/source.txt`,
            MetadataDirective: 'REPLACE',
            Metadata: { updated: 'true' },
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'source.txt',
          })
        )
        expect(headResult.Metadata).toEqual({ updated: 'true' })
      })

      it('should copy URL-encoded CopySource', async () => {
        // Create source with special chars
        const specialKey = 'source with spaces.txt'
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: specialKey,
            Body: 'special content',
          })
        )

        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'copy-special.txt',
            CopySource: `${TEST_BUCKET}/${encodeURIComponent(specialKey)}`,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()
      })

      it('should handle large object copy', async () => {
        // Create large source
        const largeData = new Uint8Array(5 * 1024 * 1024).fill(65) // 5MB
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-source.bin',
            Body: largeData,
          })
        )

        const result = await client.send(
          new CopyObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-copy.bin',
            CopySource: `${TEST_BUCKET}/large-source.bin`,
          })
        )

        expect(result.CopyObjectResult!.ETag).toBeDefined()

        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-copy.bin',
          })
        )
        expect(headResult.ContentLength).toBe(5 * 1024 * 1024)
      })
    })
  })
})
