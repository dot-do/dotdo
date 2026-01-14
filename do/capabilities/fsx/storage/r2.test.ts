/**
 * Tests for R2Storage - R2-backed blob storage
 *
 * These tests cover:
 * 1. Basic operations: get, put, delete, list
 * 2. Error handling (not found, network errors)
 * 3. Large file handling
 * 4. Byte range reads
 * 5. Metadata preservation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { R2Storage, type R2StorageConfig } from './r2'

/**
 * Mock R2Object implementation for testing
 */
class MockR2Object implements R2Object {
  key: string
  version: string
  size: number
  etag: string
  httpEtag: string
  checksums: R2Checksums
  uploaded: Date
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  storageClass: string
  private data: Uint8Array
  private rangeStart: number
  private rangeEnd: number

  constructor(
    key: string,
    data: Uint8Array,
    options?: {
      customMetadata?: Record<string, string>
      httpMetadata?: R2HTTPMetadata
      rangeStart?: number
      rangeEnd?: number
    }
  ) {
    this.key = key
    this.data = data
    this.size = data.length
    this.version = '1'
    this.etag = `"${Math.random().toString(36).substring(7)}"`
    this.httpEtag = this.etag
    this.checksums = { toJSON: () => ({}) }
    this.uploaded = new Date()
    this.customMetadata = options?.customMetadata
    this.httpMetadata = options?.httpMetadata
    this.storageClass = 'Standard'
    this.rangeStart = options?.rangeStart ?? 0
    this.rangeEnd = options?.rangeEnd ?? data.length
  }

  get body(): ReadableStream<Uint8Array> {
    const slicedData = this.data.slice(this.rangeStart, this.rangeEnd)
    return new ReadableStream({
      start(controller) {
        controller.enqueue(slicedData)
        controller.close()
      },
    })
  }

  get bodyUsed(): boolean {
    return false
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const slicedData = this.data.slice(this.rangeStart, this.rangeEnd)
    return slicedData.buffer.slice(slicedData.byteOffset, slicedData.byteOffset + slicedData.byteLength)
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data.slice(this.rangeStart, this.rangeEnd))
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text())
  }

  async blob(): Promise<Blob> {
    return new Blob([this.data.slice(this.rangeStart, this.rangeEnd)])
  }

  writeHttpMetadata(_headers: Headers): void {
    // no-op
  }

  get range(): R2Range | undefined {
    if (this.rangeStart === 0 && this.rangeEnd === this.data.length) {
      return undefined
    }
    return { offset: this.rangeStart, length: this.rangeEnd - this.rangeStart }
  }
}

/**
 * Mock R2Bucket implementation for testing
 */
class MockR2Bucket implements R2Bucket {
  private objects = new Map<string, { data: Uint8Array; metadata?: Record<string, string>; httpMetadata?: R2HTTPMetadata }>()
  private shouldThrowNetworkError = false

  async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object> {
    if (this.shouldThrowNetworkError) {
      throw new Error('Network error: connection refused')
    }

    let data: Uint8Array

    if (value === null) {
      data = new Uint8Array(0)
    } else if (value instanceof ReadableStream) {
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        if (result.value) chunks.push(result.value)
        done = result.done
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      data = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.length
      }
    } else if (value instanceof ArrayBuffer) {
      data = new Uint8Array(value)
    } else if (ArrayBuffer.isView(value)) {
      data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    } else if (typeof value === 'string') {
      data = new TextEncoder().encode(value)
    } else if (value instanceof Blob) {
      data = new Uint8Array(await value.arrayBuffer())
    } else {
      data = new Uint8Array(0)
    }

    this.objects.set(key, {
      data,
      metadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
    })

    return new MockR2Object(key, data, {
      customMetadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
    })
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    if (this.shouldThrowNetworkError) {
      throw new Error('Network error: connection refused')
    }

    const obj = this.objects.get(key)
    if (!obj) return null

    let rangeStart = 0
    let rangeEnd = obj.data.length

    // Handle range requests
    if (options?.range) {
      const range = options.range as { offset?: number; length?: number; suffix?: number }
      if (range.offset !== undefined) {
        rangeStart = range.offset
        if (range.length !== undefined) {
          rangeEnd = rangeStart + range.length
        }
      } else if (range.suffix !== undefined) {
        rangeStart = Math.max(0, obj.data.length - range.suffix)
      }
    }

    return new MockR2Object(key, obj.data, {
      customMetadata: obj.metadata,
      httpMetadata: obj.httpMetadata,
      rangeStart,
      rangeEnd,
    }) as unknown as R2ObjectBody
  }

  async head(key: string): Promise<R2Object | null> {
    if (this.shouldThrowNetworkError) {
      throw new Error('Network error: connection refused')
    }

    const obj = this.objects.get(key)
    if (!obj) return null
    return new MockR2Object(key, obj.data, {
      customMetadata: obj.metadata,
      httpMetadata: obj.httpMetadata,
    })
  }

  async delete(keys: string | string[]): Promise<void> {
    if (this.shouldThrowNetworkError) {
      throw new Error('Network error: connection refused')
    }

    const keysArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keysArray) {
      this.objects.delete(key)
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    if (this.shouldThrowNetworkError) {
      throw new Error('Network error: connection refused')
    }

    const prefix = options?.prefix ?? ''
    const limit = options?.limit ?? 1000
    const cursor = options?.cursor
    const objects: R2Object[] = []

    // Sort keys for consistent cursor-based pagination
    const allKeys = Array.from(this.objects.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()

    // Find starting position based on cursor
    let startIndex = 0
    if (cursor) {
      const cursorIndex = allKeys.findIndex((key) => key > cursor)
      startIndex = cursorIndex >= 0 ? cursorIndex : allKeys.length
    }

    // Get items for this page
    const pageKeys = allKeys.slice(startIndex, startIndex + limit)

    for (const key of pageKeys) {
      const obj = this.objects.get(key)!
      objects.push(
        new MockR2Object(key, obj.data, {
          customMetadata: obj.metadata,
          httpMetadata: obj.httpMetadata,
        })
      )
    }

    const hasMore = startIndex + limit < allKeys.length
    const nextCursor = hasMore ? pageKeys[pageKeys.length - 1] : undefined

    return {
      objects,
      truncated: hasMore,
      cursor: nextCursor,
      delimitedPrefixes: [],
    }
  }

  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    if (this.shouldThrowNetworkError) {
      return Promise.reject(new Error('Network error: connection refused'))
    }

    const uploadId = Math.random().toString(36).substring(7)
    const parts: { partNumber: number; data: Uint8Array }[] = []

    const upload: R2MultipartUpload = {
      key,
      uploadId,
      uploadPart: async (partNumber: number, value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob) => {
        let data: Uint8Array
        if (value instanceof ArrayBuffer) {
          data = new Uint8Array(value)
        } else if (ArrayBuffer.isView(value)) {
          data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        } else if (typeof value === 'string') {
          data = new TextEncoder().encode(value)
        } else if (value instanceof Blob) {
          data = new Uint8Array(await value.arrayBuffer())
        } else if (value instanceof ReadableStream) {
          const reader = value.getReader()
          const chunks: Uint8Array[] = []
          let done = false
          while (!done) {
            const result = await reader.read()
            if (result.value) chunks.push(result.value)
            done = result.done
          }
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
          data = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }
        } else {
          data = new Uint8Array(0)
        }

        parts.push({ partNumber, data })
        return {
          partNumber,
          etag: `"part-${partNumber}"`,
        }
      },
      abort: async () => {
        parts.length = 0
      },
      complete: async (uploadedParts: R2UploadedPart[]) => {
        // Sort by part number and combine
        const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber)
        const totalLength = sortedParts.reduce((acc, p) => acc + p.data.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const part of sortedParts) {
          combined.set(part.data, offset)
          offset += part.data.length
        }

        this.objects.set(key, {
          data: combined,
          metadata: options?.customMetadata,
          httpMetadata: options?.httpMetadata,
        })

        return new MockR2Object(key, combined, {
          customMetadata: options?.customMetadata,
          httpMetadata: options?.httpMetadata,
        })
      },
    }

    return Promise.resolve(upload)
  }

  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload {
    // For testing, just return a mock upload that will fail
    return {
      key,
      uploadId,
      uploadPart: async () => {
        throw new Error('Upload not found')
      },
      abort: async () => {},
      complete: async () => {
        throw new Error('Upload not found')
      },
    }
  }

  // Test helper methods
  setNetworkError(shouldThrow: boolean): void {
    this.shouldThrowNetworkError = shouldThrow
  }

  clear(): void {
    this.objects.clear()
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  getAll(): Map<string, { data: Uint8Array; metadata?: Record<string, string> }> {
    return this.objects
  }
}

describe('R2Storage', () => {
  let bucket: MockR2Bucket
  let storage: R2Storage

  beforeEach(() => {
    bucket = new MockR2Bucket()
    storage = new R2Storage({ bucket: bucket as unknown as R2Bucket })
  })

  describe('Basic Operations', () => {
    describe('put', () => {
      it('should store a blob and return etag and size', async () => {
        const data = new TextEncoder().encode('hello world')
        const result = await storage.put('/test.txt', data)

        expect(result.etag).toBeDefined()
        expect(result.etag).toMatch(/^".*"$/) // ETag format
        expect(result.size).toBe(data.length)
        expect(bucket.has('/test.txt')).toBe(true)
      })

      it('should store empty data', async () => {
        const data = new Uint8Array(0)
        const result = await storage.put('/empty.txt', data)

        expect(result.size).toBe(0)
        expect(bucket.has('/empty.txt')).toBe(true)
      })

      it('should store data with content type', async () => {
        const data = new TextEncoder().encode('{"key": "value"}')
        const result = await storage.put('/data.json', data, {
          contentType: 'application/json',
        })

        expect(result.size).toBe(data.length)

        const obj = await bucket.head('/data.json')
        expect(obj?.httpMetadata?.contentType).toBe('application/json')
      })

      it('should store data with custom metadata', async () => {
        const data = new TextEncoder().encode('test content')
        const metadata = { author: 'test', version: '1.0' }
        await storage.put('/meta.txt', data, { customMetadata: metadata })

        const obj = await bucket.head('/meta.txt')
        expect(obj?.customMetadata).toEqual(metadata)
      })

      it('should overwrite existing data', async () => {
        const data1 = new TextEncoder().encode('original')
        const data2 = new TextEncoder().encode('updated content')

        await storage.put('/file.txt', data1)
        const result = await storage.put('/file.txt', data2)

        expect(result.size).toBe(data2.length)

        const retrieved = await storage.get('/file.txt')
        expect(new TextDecoder().decode(retrieved!.data)).toBe('updated content')
      })

      it('should store ReadableStream data', async () => {
        const data = new TextEncoder().encode('streamed content')
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        })

        const result = await storage.put('/streamed.txt', stream)

        expect(result.size).toBe(data.length)
        const retrieved = await storage.get('/streamed.txt')
        expect(new TextDecoder().decode(retrieved!.data)).toBe('streamed content')
      })
    })

    describe('get', () => {
      it('should retrieve stored data', async () => {
        const data = new TextEncoder().encode('hello world')
        await storage.put('/test.txt', data)

        const result = await storage.get('/test.txt')

        expect(result).not.toBeNull()
        expect(result!.data).toEqual(data)
        expect(result!.metadata).toBeDefined()
        expect(result!.metadata.size).toBe(data.length)
      })

      it('should return null for non-existent key', async () => {
        const result = await storage.get('/nonexistent.txt')

        expect(result).toBeNull()
      })

      it('should preserve metadata on retrieval', async () => {
        const data = new TextEncoder().encode('test')
        const metadata = { custom: 'value' }
        await storage.put('/meta.txt', data, { customMetadata: metadata })

        const result = await storage.get('/meta.txt')

        expect(result!.metadata.customMetadata).toEqual(metadata)
      })

      it('should preserve content type on retrieval', async () => {
        const data = new TextEncoder().encode('{}')
        await storage.put('/data.json', data, { contentType: 'application/json' })

        const result = await storage.get('/data.json')

        expect(result!.metadata.httpMetadata?.contentType).toBe('application/json')
      })
    })

    describe('getStream', () => {
      it('should retrieve data as a stream', async () => {
        const data = new TextEncoder().encode('streamed data')
        await storage.put('/stream.txt', data)

        const result = await storage.getStream('/stream.txt')

        expect(result).not.toBeNull()
        expect(result!.stream).toBeInstanceOf(ReadableStream)

        // Read the stream
        const reader = result!.stream.getReader()
        const chunks: Uint8Array[] = []
        let done = false
        while (!done) {
          const readResult = await reader.read()
          if (readResult.value) chunks.push(readResult.value)
          done = readResult.done
        }

        const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }

        expect(new TextDecoder().decode(combined)).toBe('streamed data')
      })

      it('should return null for non-existent key', async () => {
        const result = await storage.getStream('/nonexistent.txt')
        expect(result).toBeNull()
      })
    })

    describe('delete', () => {
      it('should delete an existing blob', async () => {
        const data = new TextEncoder().encode('to delete')
        await storage.put('/delete.txt', data)

        expect(bucket.has('/delete.txt')).toBe(true)
        await storage.delete('/delete.txt')
        expect(bucket.has('/delete.txt')).toBe(false)
      })

      it('should not throw when deleting non-existent key', async () => {
        await expect(storage.delete('/nonexistent.txt')).resolves.toBeUndefined()
      })
    })

    describe('deleteMany', () => {
      it('should delete multiple blobs', async () => {
        const data = new TextEncoder().encode('test')
        await storage.put('/file1.txt', data)
        await storage.put('/file2.txt', data)
        await storage.put('/file3.txt', data)

        await storage.deleteMany(['/file1.txt', '/file2.txt'])

        expect(bucket.has('/file1.txt')).toBe(false)
        expect(bucket.has('/file2.txt')).toBe(false)
        expect(bucket.has('/file3.txt')).toBe(true)
      })

      it('should handle empty array', async () => {
        await expect(storage.deleteMany([])).resolves.toBeUndefined()
      })
    })

    describe('exists', () => {
      it('should return true for existing blob', async () => {
        await storage.put('/exists.txt', new TextEncoder().encode('test'))

        const result = await storage.exists('/exists.txt')

        expect(result).toBe(true)
      })

      it('should return false for non-existent blob', async () => {
        const result = await storage.exists('/nonexistent.txt')

        expect(result).toBe(false)
      })
    })

    describe('head', () => {
      it('should return metadata without downloading content', async () => {
        const data = new TextEncoder().encode('head test content')
        await storage.put('/head.txt', data, {
          contentType: 'text/plain',
          customMetadata: { key: 'value' },
        })

        const result = await storage.head('/head.txt')

        expect(result).not.toBeNull()
        expect(result!.size).toBe(data.length)
        expect(result!.httpMetadata?.contentType).toBe('text/plain')
        expect(result!.customMetadata).toEqual({ key: 'value' })
      })

      it('should return null for non-existent blob', async () => {
        const result = await storage.head('/nonexistent.txt')
        expect(result).toBeNull()
      })
    })

    describe('list', () => {
      beforeEach(async () => {
        // Create test files
        const data = new TextEncoder().encode('test')
        await storage.put('/docs/file1.txt', data)
        await storage.put('/docs/file2.txt', data)
        await storage.put('/docs/subdir/file3.txt', data)
        await storage.put('/images/photo.jpg', data)
        await storage.put('/readme.txt', data)
      })

      it('should list all objects', async () => {
        const result = await storage.list()

        expect(result.objects.length).toBe(5)
        expect(result.truncated).toBe(false)
      })

      it('should list objects with prefix', async () => {
        const result = await storage.list({ prefix: '/docs/' })

        expect(result.objects.length).toBe(3)
        expect(result.objects.every((o) => o.key.startsWith('/docs/'))).toBe(true)
      })

      it('should limit results', async () => {
        const result = await storage.list({ limit: 2 })

        expect(result.objects.length).toBe(2)
        expect(result.truncated).toBe(true)
        expect(result.cursor).toBeDefined()
      })

      it('should paginate with cursor', async () => {
        const page1 = await storage.list({ limit: 2 })
        const page2 = await storage.list({ limit: 2, cursor: page1.cursor })

        expect(page1.objects.length).toBe(2)
        expect(page2.objects.length).toBe(2)

        // Verify no overlap
        const page1Keys = page1.objects.map((o) => o.key)
        const page2Keys = page2.objects.map((o) => o.key)
        expect(page1Keys.some((k) => page2Keys.includes(k))).toBe(false)
      })

      it('should return empty array for non-matching prefix', async () => {
        const result = await storage.list({ prefix: '/nonexistent/' })

        expect(result.objects.length).toBe(0)
        expect(result.truncated).toBe(false)
      })
    })

    describe('copy', () => {
      it('should copy a blob to a new location', async () => {
        const data = new TextEncoder().encode('content to copy')
        await storage.put('/source.txt', data, {
          contentType: 'text/plain',
          customMetadata: { original: 'true' },
        })

        const result = await storage.copy('/source.txt', '/destination.txt')

        expect(result.size).toBe(data.length)

        // Verify destination exists with same content
        const dest = await storage.get('/destination.txt')
        expect(dest).not.toBeNull()
        expect(new TextDecoder().decode(dest!.data)).toBe('content to copy')

        // Verify source still exists
        const source = await storage.get('/source.txt')
        expect(source).not.toBeNull()
      })

      it('should preserve metadata when copying', async () => {
        const data = new TextEncoder().encode('metadata copy')
        await storage.put('/source.txt', data, {
          contentType: 'application/octet-stream',
          customMetadata: { key: 'value', another: 'meta' },
        })

        await storage.copy('/source.txt', '/dest.txt')

        const dest = await storage.get('/dest.txt')
        expect(dest!.metadata.httpMetadata?.contentType).toBe('application/octet-stream')
        expect(dest!.metadata.customMetadata).toEqual({ key: 'value', another: 'meta' })
      })

      it('should throw when source does not exist', async () => {
        await expect(storage.copy('/nonexistent.txt', '/dest.txt')).rejects.toThrow('Source not found')
      })
    })
  })

  describe('Prefix Handling', () => {
    let prefixedStorage: R2Storage

    beforeEach(() => {
      prefixedStorage = new R2Storage({
        bucket: bucket as unknown as R2Bucket,
        prefix: 'tenant1/',
      })
    })

    it('should add prefix to put keys', async () => {
      const data = new TextEncoder().encode('prefixed')
      await prefixedStorage.put('/test.txt', data)

      expect(bucket.has('tenant1//test.txt')).toBe(true)
    })

    it('should add prefix to get keys', async () => {
      // Store with full key directly
      await bucket.put('tenant1//test.txt', new TextEncoder().encode('prefixed content'))

      const result = await prefixedStorage.get('/test.txt')

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('prefixed content')
    })

    it('should add prefix to list operations', async () => {
      await bucket.put('tenant1/docs/file1.txt', new TextEncoder().encode('1'))
      await bucket.put('tenant1/docs/file2.txt', new TextEncoder().encode('2'))
      await bucket.put('tenant2/docs/file3.txt', new TextEncoder().encode('3'))

      const result = await prefixedStorage.list({ prefix: 'docs/' })

      expect(result.objects.length).toBe(2)
      expect(result.objects.every((o) => o.key.startsWith('tenant1/docs/'))).toBe(true)
    })

    it('should add prefix to delete keys', async () => {
      await bucket.put('tenant1//delete.txt', new TextEncoder().encode('to delete'))

      await prefixedStorage.delete('/delete.txt')

      expect(bucket.has('tenant1//delete.txt')).toBe(false)
    })

    it('should add prefix to copy operations', async () => {
      await bucket.put('tenant1//source.txt', new TextEncoder().encode('copy me'))

      await prefixedStorage.copy('/source.txt', '/dest.txt')

      expect(bucket.has('tenant1//dest.txt')).toBe(true)
    })
  })

  describe('Error Handling', () => {
    describe('network errors', () => {
      beforeEach(() => {
        bucket.setNetworkError(true)
      })

      afterEach(() => {
        bucket.setNetworkError(false)
      })

      it('should propagate network error on put', async () => {
        const data = new TextEncoder().encode('test')

        await expect(storage.put('/test.txt', data)).rejects.toThrow('Network error')
      })

      it('should propagate network error on get', async () => {
        await expect(storage.get('/test.txt')).rejects.toThrow('Network error')
      })

      it('should propagate network error on delete', async () => {
        await expect(storage.delete('/test.txt')).rejects.toThrow('Network error')
      })

      it('should propagate network error on list', async () => {
        await expect(storage.list()).rejects.toThrow('Network error')
      })

      it('should propagate network error on head', async () => {
        await expect(storage.head('/test.txt')).rejects.toThrow('Network error')
      })

      it('should propagate network error on exists', async () => {
        await expect(storage.exists('/test.txt')).rejects.toThrow('Network error')
      })
    })

    describe('copy error handling', () => {
      it('should throw descriptive error when source not found', async () => {
        const error = await storage.copy('/missing.txt', '/dest.txt').catch((e) => e)

        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain('Source not found')
        expect(error.message).toContain('/missing.txt')
      })
    })
  })

  describe('Large File Handling', () => {
    it('should handle 1MB file', async () => {
      const size = 1024 * 1024 // 1MB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      const result = await storage.put('/large.bin', data)
      expect(result.size).toBe(size)

      const retrieved = await storage.get('/large.bin')
      expect(retrieved!.data.length).toBe(size)
      expect(retrieved!.data).toEqual(data)
    })

    it('should handle 10MB file', async () => {
      const size = 10 * 1024 * 1024 // 10MB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      const result = await storage.put('/large10mb.bin', data)
      expect(result.size).toBe(size)

      const retrieved = await storage.get('/large10mb.bin')
      expect(retrieved!.data.length).toBe(size)

      // Verify data integrity
      let matches = true
      for (let i = 0; i < size && matches; i += 10000) {
        if (retrieved!.data[i] !== data[i]) {
          matches = false
        }
      }
      expect(matches).toBe(true)
    })

    it('should stream large file without loading entirely in memory', async () => {
      const size = 5 * 1024 * 1024 // 5MB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      await storage.put('/streamed-large.bin', data)

      const result = await storage.getStream('/streamed-large.bin')
      expect(result).not.toBeNull()

      // Read stream in chunks
      const reader = result!.stream.getReader()
      let totalRead = 0
      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (value) {
          totalRead += value.length
        }
        done = isDone
      }

      expect(totalRead).toBe(size)
    })
  })

  describe('Byte Range Reads', () => {
    const testData = new TextEncoder().encode('0123456789ABCDEFGHIJ')

    beforeEach(async () => {
      await storage.put('/range.txt', testData)
    })

    it('should read from offset to end', async () => {
      const result = await storage.getRange('/range.txt', 10)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('ABCDEFGHIJ')
    })

    it('should read specific range', async () => {
      const result = await storage.getRange('/range.txt', 5, 9)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('56789')
    })

    it('should read from start', async () => {
      const result = await storage.getRange('/range.txt', 0, 4)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('01234')
    })

    it('should return null for non-existent key', async () => {
      const result = await storage.getRange('/nonexistent.txt', 0, 10)

      expect(result).toBeNull()
    })

    it('should handle range at end of file', async () => {
      const result = await storage.getRange('/range.txt', 15)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('FGHIJ')
    })

    it('should include metadata with range read', async () => {
      await storage.put('/meta-range.txt', testData, {
        customMetadata: { type: 'test' },
      })

      const result = await storage.getRange('/meta-range.txt', 0, 5)

      expect(result!.metadata.customMetadata).toEqual({ type: 'test' })
    })

    it('should handle single byte range', async () => {
      const result = await storage.getRange('/range.txt', 5, 5)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('5')
    })

    it('should handle large file range reads', async () => {
      const largeData = new Uint8Array(1024 * 1024) // 1MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      await storage.put('/large-range.bin', largeData)

      // Read 1KB from the middle
      const result = await storage.getRange('/large-range.bin', 512 * 1024, 512 * 1024 + 1023)

      expect(result).not.toBeNull()
      expect(result!.data.length).toBe(1024)
      // Verify content
      for (let i = 0; i < 1024; i++) {
        expect(result!.data[i]).toBe((512 * 1024 + i) % 256)
      }
    })
  })

  describe('Metadata Preservation', () => {
    it('should preserve custom metadata through put/get cycle', async () => {
      const data = new TextEncoder().encode('test')
      const customMetadata = {
        author: 'test-user',
        version: '1.0.0',
        tags: 'important,reviewed',
        timestamp: '2024-01-01T00:00:00Z',
      }

      await storage.put('/meta.txt', data, { customMetadata })
      const result = await storage.get('/meta.txt')

      expect(result!.metadata.customMetadata).toEqual(customMetadata)
    })

    it('should preserve HTTP metadata through put/get cycle', async () => {
      const data = new TextEncoder().encode('{}')

      await storage.put('/data.json', data, {
        contentType: 'application/json',
      })

      const result = await storage.get('/data.json')

      expect(result!.metadata.httpMetadata?.contentType).toBe('application/json')
    })

    it('should preserve both custom and HTTP metadata', async () => {
      const data = new TextEncoder().encode('<html></html>')
      const customMetadata = { cached: 'true' }

      await storage.put('/page.html', data, {
        contentType: 'text/html',
        customMetadata,
      })

      const result = await storage.get('/page.html')

      expect(result!.metadata.httpMetadata?.contentType).toBe('text/html')
      expect(result!.metadata.customMetadata).toEqual(customMetadata)
    })

    it('should preserve etag on retrieval', async () => {
      const data = new TextEncoder().encode('test')
      await storage.put('/etag.txt', data)

      const getResult = await storage.get('/etag.txt')

      // ETag should be present and in proper format
      expect(getResult!.metadata.etag).toBeDefined()
      expect(getResult!.metadata.etag).toMatch(/^".*"$/)
    })

    it('should preserve size in metadata', async () => {
      const content = 'exactly 20 bytes!!!' // 19 bytes
      const data = new TextEncoder().encode(content)

      await storage.put('/sized.txt', data)
      const result = await storage.get('/sized.txt')

      expect(result!.metadata.size).toBe(content.length) // Verify size matches actual content length
    })

    it('should preserve metadata through copy operation', async () => {
      const data = new TextEncoder().encode('copy metadata')
      const customMetadata = {
        origin: 'test',
        created: 'now',
      }

      await storage.put('/original.txt', data, {
        contentType: 'text/plain',
        customMetadata,
      })

      await storage.copy('/original.txt', '/copied.txt')

      const copied = await storage.get('/copied.txt')
      expect(copied!.metadata.httpMetadata?.contentType).toBe('text/plain')
      expect(copied!.metadata.customMetadata).toEqual(customMetadata)
    })
  })

  describe('Multipart Upload', () => {
    it('should create multipart upload', async () => {
      const upload = await storage.createMultipartUpload('/multipart.bin', {
        contentType: 'application/octet-stream',
      })

      expect(upload).toBeDefined()
      expect(upload.key).toContain('multipart.bin')
      expect(upload.uploadId).toBeDefined()
    })

    it('should complete multipart upload with parts', async () => {
      const upload = await storage.createMultipartUpload('/assembled.bin')

      const part1 = await upload.uploadPart(1, new TextEncoder().encode('Part1'))
      const part2 = await upload.uploadPart(2, new TextEncoder().encode('Part2'))
      const part3 = await upload.uploadPart(3, new TextEncoder().encode('Part3'))

      const result = await upload.complete([part1, part2, part3])

      expect(result.size).toBe(15) // Part1 + Part2 + Part3

      const retrieved = await storage.get('/assembled.bin')
      expect(new TextDecoder().decode(retrieved!.data)).toBe('Part1Part2Part3')
    })

    it('should abort multipart upload', async () => {
      const upload = await storage.createMultipartUpload('/aborted.bin')

      await upload.uploadPart(1, new TextEncoder().encode('Part1'))
      await upload.abort()

      const result = await storage.get('/aborted.bin')
      expect(result).toBeNull()
    })

    it('should resume multipart upload', async () => {
      const upload = await storage.createMultipartUpload('/resume.bin')
      const uploadId = upload.uploadId

      // Simulate resuming (in our mock this will fail, but tests the API)
      const resumed = storage.resumeMultipartUpload('/resume.bin', uploadId)

      expect(resumed.uploadId).toBe(uploadId)
    })

    it('should preserve metadata on completed multipart upload', async () => {
      const customMetadata = { uploaded: 'multipart' }
      const upload = await storage.createMultipartUpload('/meta-multipart.bin', {
        contentType: 'application/octet-stream',
        customMetadata,
      })

      const part1 = await upload.uploadPart(1, new TextEncoder().encode('content'))
      await upload.complete([part1])

      const result = await storage.get('/meta-multipart.bin')
      expect(result!.metadata.httpMetadata?.contentType).toBe('application/octet-stream')
      expect(result!.metadata.customMetadata).toEqual(customMetadata)
    })
  })
})
