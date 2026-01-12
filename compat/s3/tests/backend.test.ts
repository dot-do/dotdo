/**
 * @dotdo/s3 - Storage Backend Tests
 *
 * Tests for the pluggable storage backend system.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  MemoryBackend,
  R2Backend,
  defaultMemoryBackend,
  type StorageBackend,
} from '../backend'

// =============================================================================
// Memory Backend Tests
// =============================================================================

describe('MemoryBackend', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = new MemoryBackend()
  })

  describe('Bucket Operations', () => {
    it('should create a bucket', async () => {
      await backend.createBucket('test-bucket', 'us-east-1')
      expect(await backend.bucketExists('test-bucket')).toBe(true)
    })

    it('should delete a bucket', async () => {
      await backend.createBucket('delete-me', 'us-east-1')
      await backend.deleteBucket('delete-me')
      expect(await backend.bucketExists('delete-me')).toBe(false)
    })

    it('should head a bucket', async () => {
      await backend.createBucket('head-bucket', 'eu-west-1')
      const bucket = await backend.headBucket('head-bucket')
      expect(bucket.name).toBe('head-bucket')
      expect(bucket.region).toBe('eu-west-1')
      expect(bucket.creationDate).toBeInstanceOf(Date)
    })

    it('should throw NoSuchBucket for missing bucket', async () => {
      await expect(backend.headBucket('non-existent')).rejects.toThrow('NoSuchBucket')
    })

    it('should list all buckets', async () => {
      await backend.createBucket('bucket-1', 'us-east-1')
      await backend.createBucket('bucket-2', 'eu-west-1')
      await backend.createBucket('bucket-3', 'ap-south-1')

      const buckets = await backend.listBuckets()
      expect(buckets).toHaveLength(3)
      expect(buckets.map((b) => b.name)).toContain('bucket-1')
      expect(buckets.map((b) => b.name)).toContain('bucket-2')
      expect(buckets.map((b) => b.name)).toContain('bucket-3')
    })

    it('should return empty list when no buckets exist', async () => {
      const buckets = await backend.listBuckets()
      expect(buckets).toEqual([])
    })

    it('should check if bucket is empty', async () => {
      await backend.createBucket('empty-bucket', 'us-east-1')
      expect(await backend.bucketIsEmpty('empty-bucket')).toBe(true)

      await backend.putObject('empty-bucket', 'test.txt', new Uint8Array([1, 2, 3]))
      expect(await backend.bucketIsEmpty('empty-bucket')).toBe(false)
    })
  })

  describe('Object Operations', () => {
    beforeEach(async () => {
      await backend.createBucket('test-bucket', 'us-east-1')
    })

    it('should put an object', async () => {
      const body = new TextEncoder().encode('Hello World')
      const result = await backend.putObject('test-bucket', 'hello.txt', body, {
        contentType: 'text/plain',
      })
      expect(result.etag).toBeDefined()
    })

    it('should get an object', async () => {
      const body = new TextEncoder().encode('Hello World')
      await backend.putObject('test-bucket', 'hello.txt', body, {
        contentType: 'text/plain',
        metadata: { author: 'test' },
      })

      const obj = await backend.getObject('test-bucket', 'hello.txt')
      expect(obj).not.toBeNull()
      expect(obj!.key).toBe('hello.txt')
      expect(obj!.contentType).toBe('text/plain')
      expect(obj!.metadata).toEqual({ author: 'test' })
      expect(new TextDecoder().decode(obj!.body)).toBe('Hello World')
    })

    it('should return null for non-existent object', async () => {
      const obj = await backend.getObject('test-bucket', 'non-existent.txt')
      expect(obj).toBeNull()
    })

    it('should handle range requests', async () => {
      const body = new TextEncoder().encode('0123456789')
      await backend.putObject('test-bucket', 'range.txt', body)

      const obj = await backend.getObject('test-bucket', 'range.txt', {
        range: { start: 2, end: 5 },
      })
      expect(obj).not.toBeNull()
      expect(new TextDecoder().decode(obj!.body)).toBe('2345')
      expect(obj!.size).toBe(4)
    })

    it('should head an object', async () => {
      const body = new TextEncoder().encode('Test content')
      await backend.putObject('test-bucket', 'head.txt', body, {
        contentType: 'text/plain',
        cacheControl: 'max-age=3600',
      })

      const obj = await backend.headObject('test-bucket', 'head.txt')
      expect(obj).not.toBeNull()
      expect(obj!.size).toBe(12)
      expect(obj!.contentType).toBe('text/plain')
      expect(obj!.cacheControl).toBe('max-age=3600')
    })

    it('should delete an object', async () => {
      const body = new TextEncoder().encode('Delete me')
      await backend.putObject('test-bucket', 'delete.txt', body)

      await backend.deleteObject('test-bucket', 'delete.txt')
      const obj = await backend.getObject('test-bucket', 'delete.txt')
      expect(obj).toBeNull()
    })

    it('should list objects', async () => {
      await backend.putObject('test-bucket', 'folder1/a.txt', new Uint8Array([1]))
      await backend.putObject('test-bucket', 'folder1/b.txt', new Uint8Array([2]))
      await backend.putObject('test-bucket', 'folder2/c.txt', new Uint8Array([3]))
      await backend.putObject('test-bucket', 'root.txt', new Uint8Array([4]))

      const result = await backend.listObjects('test-bucket')
      expect(result.objects).toHaveLength(4)
      expect(result.isTruncated).toBe(false)
    })

    it('should filter by prefix', async () => {
      await backend.putObject('test-bucket', 'folder1/a.txt', new Uint8Array([1]))
      await backend.putObject('test-bucket', 'folder1/b.txt', new Uint8Array([2]))
      await backend.putObject('test-bucket', 'folder2/c.txt', new Uint8Array([3]))

      const result = await backend.listObjects('test-bucket', { prefix: 'folder1/' })
      expect(result.objects).toHaveLength(2)
      expect(result.objects.every((o) => o.key.startsWith('folder1/'))).toBe(true)
    })

    it('should use delimiter for folder simulation', async () => {
      await backend.putObject('test-bucket', 'folder1/a.txt', new Uint8Array([1]))
      await backend.putObject('test-bucket', 'folder1/b.txt', new Uint8Array([2]))
      await backend.putObject('test-bucket', 'folder2/c.txt', new Uint8Array([3]))
      await backend.putObject('test-bucket', 'root.txt', new Uint8Array([4]))

      const result = await backend.listObjects('test-bucket', { delimiter: '/' })
      expect(result.objects).toHaveLength(1) // root.txt only
      expect(result.commonPrefixes).toHaveLength(2) // folder1/, folder2/
      expect(result.commonPrefixes).toContain('folder1/')
      expect(result.commonPrefixes).toContain('folder2/')
    })

    it('should paginate with maxKeys', async () => {
      for (let i = 0; i < 5; i++) {
        await backend.putObject('test-bucket', `file${i}.txt`, new Uint8Array([i]))
      }

      const result1 = await backend.listObjects('test-bucket', { maxKeys: 2 })
      expect(result1.objects).toHaveLength(2)
      expect(result1.isTruncated).toBe(true)
      expect(result1.nextContinuationToken).toBeDefined()

      const result2 = await backend.listObjects('test-bucket', {
        maxKeys: 2,
        continuationToken: result1.nextContinuationToken,
      })
      expect(result2.objects).toHaveLength(2)
      expect(result2.isTruncated).toBe(true)
    })
  })

  describe('Multipart Operations', () => {
    beforeEach(async () => {
      await backend.createBucket('multipart-bucket', 'us-east-1')
    })

    it('should create a multipart upload', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'large.bin', {
        contentType: 'application/octet-stream',
      })
      expect(uploadId).toBeDefined()
      expect(typeof uploadId).toBe('string')
    })

    it('should upload parts', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'large.bin')

      const part1 = new Uint8Array(1024).fill(65)
      const result1 = await backend.uploadPart('multipart-bucket', 'large.bin', uploadId, 1, part1)
      expect(result1.etag).toBeDefined()

      const part2 = new Uint8Array(512).fill(66)
      const result2 = await backend.uploadPart('multipart-bucket', 'large.bin', uploadId, 2, part2)
      expect(result2.etag).toBeDefined()
      expect(result1.etag).not.toBe(result2.etag)
    })

    it('should complete a multipart upload', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'complete.bin')

      const part1 = new Uint8Array(1024).fill(65)
      const result1 = await backend.uploadPart('multipart-bucket', 'complete.bin', uploadId, 1, part1)

      const part2 = new Uint8Array(512).fill(66)
      const result2 = await backend.uploadPart('multipart-bucket', 'complete.bin', uploadId, 2, part2)

      const result = await backend.completeMultipartUpload(
        'multipart-bucket',
        'complete.bin',
        uploadId,
        [
          { partNumber: 1, etag: result1.etag },
          { partNumber: 2, etag: result2.etag },
        ]
      )
      expect(result.etag).toBeDefined()

      // Verify the combined object
      const obj = await backend.headObject('multipart-bucket', 'complete.bin')
      expect(obj).not.toBeNull()
      expect(obj!.size).toBe(1536) // 1024 + 512
    })

    it('should abort a multipart upload', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'abort.bin')

      const part1 = new Uint8Array(1024).fill(65)
      await backend.uploadPart('multipart-bucket', 'abort.bin', uploadId, 1, part1)

      await backend.abortMultipartUpload('multipart-bucket', 'abort.bin', uploadId)

      // Should throw NoSuchUpload
      await expect(
        backend.uploadPart('multipart-bucket', 'abort.bin', uploadId, 2, new Uint8Array(512))
      ).rejects.toThrow('NoSuchUpload')
    })

    it('should list parts', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'parts.bin')

      for (let i = 1; i <= 3; i++) {
        await backend.uploadPart(
          'multipart-bucket',
          'parts.bin',
          uploadId,
          i,
          new Uint8Array(1024).fill(64 + i)
        )
      }

      const result = await backend.listParts('multipart-bucket', 'parts.bin', uploadId)
      expect(result.parts).toHaveLength(3)
      expect(result.parts[0].partNumber).toBe(1)
      expect(result.parts[1].partNumber).toBe(2)
      expect(result.parts[2].partNumber).toBe(3)
    })

    it('should list multipart uploads', async () => {
      await backend.createMultipartUpload('multipart-bucket', 'upload1.bin')
      await backend.createMultipartUpload('multipart-bucket', 'upload2.bin')
      await backend.createMultipartUpload('multipart-bucket', 'other/upload3.bin')

      const result = await backend.listMultipartUploads('multipart-bucket')
      expect(result.uploads).toHaveLength(3)
    })

    it('should filter uploads by prefix', async () => {
      await backend.createMultipartUpload('multipart-bucket', 'folder/upload1.bin')
      await backend.createMultipartUpload('multipart-bucket', 'folder/upload2.bin')
      await backend.createMultipartUpload('multipart-bucket', 'other/upload3.bin')

      const result = await backend.listMultipartUploads('multipart-bucket', { prefix: 'folder/' })
      expect(result.uploads).toHaveLength(2)
      expect(result.uploads.every((u) => u.key.startsWith('folder/'))).toBe(true)
    })
  })

  describe('Utility', () => {
    it('should clear all data', async () => {
      await backend.createBucket('bucket1', 'us-east-1')
      await backend.createBucket('bucket2', 'eu-west-1')
      await backend.putObject('bucket1', 'test.txt', new Uint8Array([1, 2, 3]))

      backend.clear()

      expect(await backend.bucketExists('bucket1')).toBe(false)
      expect(await backend.bucketExists('bucket2')).toBe(false)
    })
  })
})

// =============================================================================
// Default Memory Backend Tests
// =============================================================================

describe('defaultMemoryBackend', () => {
  beforeEach(() => {
    defaultMemoryBackend.clear()
  })

  it('should be a shared instance', () => {
    expect(defaultMemoryBackend).toBeInstanceOf(MemoryBackend)
  })

  it('should persist data across operations', async () => {
    await defaultMemoryBackend.createBucket('shared-bucket', 'us-east-1')
    expect(await defaultMemoryBackend.bucketExists('shared-bucket')).toBe(true)

    // Clear for other tests
    defaultMemoryBackend.clear()
  })
})

// =============================================================================
// R2 Backend Mock Tests
// =============================================================================

describe('R2Backend', () => {
  let backend: R2Backend
  let mockR2: R2Bucket

  beforeEach(() => {
    // Create a mock R2 bucket
    const storage = new Map<string, { data: ArrayBuffer; metadata: R2Object }>()
    const multipartUploads = new Map<string, { parts: Map<number, ArrayBuffer> }>()

    mockR2 = {
      put: vi.fn(async (key: string, data: ArrayBuffer | ReadableStream, options?: R2PutOptions) => {
        const arrayBuffer = data instanceof ArrayBuffer
          ? data
          : await new Response(data as ReadableStream).arrayBuffer()

        const etag = `mock-etag-${Date.now()}`
        const metadata: R2Object = {
          key,
          size: arrayBuffer.byteLength,
          etag,
          uploaded: new Date(),
          httpMetadata: options?.httpMetadata || {},
          customMetadata: options?.customMetadata || {},
          version: 'v1',
          httpEtag: `"${etag}"`,
          checksums: { toJSON: () => ({}) },
          writeHttpMetadata: () => {},
          storageClass: 'Standard',
        }
        storage.set(key, { data: arrayBuffer, metadata })
        return metadata
      }),
      get: vi.fn(async (key: string) => {
        const item = storage.get(key)
        if (!item) return null
        return {
          ...item.metadata,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(item.data))
              controller.close()
            },
          }),
          bodyUsed: false,
          arrayBuffer: async () => item.data,
          text: async () => new TextDecoder().decode(item.data),
          json: async () => JSON.parse(new TextDecoder().decode(item.data)),
          blob: async () => new Blob([item.data]),
        }
      }),
      head: vi.fn(async (key: string) => {
        const item = storage.get(key)
        return item?.metadata || null
      }),
      delete: vi.fn(async (key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key]
        for (const k of keys) {
          storage.delete(k)
        }
      }),
      list: vi.fn(async (options?: R2ListOptions) => {
        const prefix = options?.prefix || ''
        const limit = options?.limit || 1000

        const objects: R2Object[] = []
        const delimitedPrefixes: string[] = []

        for (const [key, item] of storage) {
          if (key.startsWith(prefix) && !key.startsWith('__bucket_meta__/')) {
            if (options?.delimiter) {
              const keyAfterPrefix = key.slice(prefix.length)
              const delimiterIndex = keyAfterPrefix.indexOf(options.delimiter)
              if (delimiterIndex >= 0) {
                const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
                if (!delimitedPrefixes.includes(commonPrefix)) {
                  delimitedPrefixes.push(commonPrefix)
                }
                continue
              }
            }
            objects.push(item.metadata)
          }
        }

        return {
          objects: objects.slice(0, limit),
          truncated: objects.length > limit,
          cursor: objects.length > limit ? 'next-cursor' : undefined,
          delimitedPrefixes,
        }
      }),
      createMultipartUpload: vi.fn(async (key: string, options?: R2MultipartOptions) => {
        const uploadId = `upload-${Date.now()}`
        multipartUploads.set(uploadId, { parts: new Map() })
        return {
          key,
          uploadId,
          uploadPart: vi.fn(async (partNumber: number, data: ArrayBuffer | ReadableStream) => {
            const arrayBuffer = data instanceof ArrayBuffer
              ? data
              : await new Response(data as ReadableStream).arrayBuffer()
            multipartUploads.get(uploadId)!.parts.set(partNumber, arrayBuffer)
            return { partNumber, etag: `part-etag-${partNumber}` }
          }),
          abort: vi.fn(async () => {
            multipartUploads.delete(uploadId)
          }),
          complete: vi.fn(async (parts: R2UploadedPart[]) => {
            const upload = multipartUploads.get(uploadId)!
            const sortedParts = parts.sort((a, b) => a.partNumber - b.partNumber)
            let totalSize = 0
            for (const part of sortedParts) {
              totalSize += upload.parts.get(part.partNumber)!.byteLength
            }
            const combined = new Uint8Array(totalSize)
            let offset = 0
            for (const part of sortedParts) {
              const partData = new Uint8Array(upload.parts.get(part.partNumber)!)
              combined.set(partData, offset)
              offset += partData.length
            }
            // Store the combined object
            await mockR2.put(key, combined.buffer, options)
            multipartUploads.delete(uploadId)
            return { etag: `complete-etag-${Date.now()}` }
          }),
        }
      }),
      resumeMultipartUpload: vi.fn((key: string, uploadId: string) => {
        const upload = multipartUploads.get(uploadId)
        if (!upload) throw new Error('NoSuchUpload')
        return {
          key,
          uploadId,
          uploadPart: vi.fn(async (partNumber: number, data: ArrayBuffer | ReadableStream) => {
            const arrayBuffer = data instanceof ArrayBuffer
              ? data
              : await new Response(data as ReadableStream).arrayBuffer()
            upload.parts.set(partNumber, arrayBuffer)
            return { partNumber, etag: `part-etag-${partNumber}` }
          }),
          abort: vi.fn(async () => {
            multipartUploads.delete(uploadId)
          }),
          complete: vi.fn(async (parts: R2UploadedPart[]) => {
            multipartUploads.delete(uploadId)
            return { etag: `complete-etag-${Date.now()}` }
          }),
        }
      }),
    } as unknown as R2Bucket

    backend = new R2Backend(mockR2)
  })

  describe('Bucket Operations', () => {
    it('should create a bucket', async () => {
      await backend.createBucket('test-bucket', 'us-east-1')
      expect(mockR2.put).toHaveBeenCalledWith(
        '__bucket_meta__/test-bucket',
        expect.any(String)
      )
    })

    it('should check if bucket exists', async () => {
      await backend.createBucket('existing-bucket', 'us-east-1')
      expect(await backend.bucketExists('existing-bucket')).toBe(true)
    })

    it('should throw BucketAlreadyExists for duplicate bucket', async () => {
      await backend.createBucket('duplicate-bucket', 'us-east-1')
      await expect(backend.createBucket('duplicate-bucket', 'us-east-1')).rejects.toThrow('BucketAlreadyExists')
    })
  })

  describe('Object Operations', () => {
    beforeEach(async () => {
      await backend.createBucket('test-bucket', 'us-east-1')
    })

    it('should put an object', async () => {
      const body = new TextEncoder().encode('Hello R2')
      const result = await backend.putObject('test-bucket', 'hello.txt', body, {
        contentType: 'text/plain',
      })
      expect(result.etag).toBeDefined()
      expect(mockR2.put).toHaveBeenCalledWith(
        'test-bucket/hello.txt',
        body,
        expect.objectContaining({
          httpMetadata: expect.objectContaining({ contentType: 'text/plain' }),
        })
      )
    })

    it('should get an object', async () => {
      const body = new TextEncoder().encode('Hello R2')
      await backend.putObject('test-bucket', 'hello.txt', body)

      const obj = await backend.getObject('test-bucket', 'hello.txt')
      expect(obj).not.toBeNull()
      expect(obj!.key).toBe('hello.txt')
    })

    it('should delete an object', async () => {
      const body = new TextEncoder().encode('Delete me')
      await backend.putObject('test-bucket', 'delete.txt', body)

      await backend.deleteObject('test-bucket', 'delete.txt')
      expect(mockR2.delete).toHaveBeenCalledWith('test-bucket/delete.txt')
    })

    it('should list objects', async () => {
      await backend.putObject('test-bucket', 'file1.txt', new Uint8Array([1]))
      await backend.putObject('test-bucket', 'file2.txt', new Uint8Array([2]))

      const result = await backend.listObjects('test-bucket')
      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: 'test-bucket/' })
      )
    })
  })

  describe('Multipart Operations', () => {
    beforeEach(async () => {
      await backend.createBucket('multipart-bucket', 'us-east-1')
    })

    it('should create a multipart upload', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'large.bin')
      expect(uploadId).toBeDefined()
      expect(mockR2.createMultipartUpload).toHaveBeenCalledWith(
        'multipart-bucket/large.bin',
        expect.any(Object)
      )
    })

    it('should upload a part', async () => {
      const uploadId = await backend.createMultipartUpload('multipart-bucket', 'large.bin')
      const part = new Uint8Array(1024).fill(65)
      const result = await backend.uploadPart('multipart-bucket', 'large.bin', uploadId, 1, part)
      expect(result.etag).toBeDefined()
    })
  })
})
