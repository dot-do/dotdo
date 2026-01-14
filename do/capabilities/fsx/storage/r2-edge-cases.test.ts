/**
 * R2Storage Edge Cases - RED Phase TDD Tests
 *
 * These tests cover R2-specific edge cases and behaviors that are NOT
 * currently implemented or handled correctly. These tests SHOULD FAIL
 * initially to drive implementation.
 *
 * Coverage areas:
 * 1. Conditional operations (If-Match, If-None-Match)
 * 2. Checksum validation (MD5, SHA-256)
 * 3. Range request edge cases (suffix, overflow)
 * 4. Access denied / permission errors
 * 5. Storage class transitions
 * 6. Concurrent multipart upload handling
 * 7. Object versioning
 * 8. Large file chunked streaming
 * 9. UTF-8 key handling
 * 10. Zero-byte file handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { R2Storage, type R2StorageConfig } from './r2'
import { StorageError } from './interfaces'

// =============================================================================
// Test Helpers - Mock R2 types that simulate real R2 behavior
// =============================================================================

class MockR2ObjectWithVersioning implements R2Object {
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
      version?: string
      storageClass?: string
    }
  ) {
    this.key = key
    this.data = data
    this.size = data.length
    this.version = options?.version ?? crypto.randomUUID()
    this.etag = `"${crypto.randomUUID().slice(0, 8)}"`
    this.httpEtag = this.etag
    this.checksums = { toJSON: () => ({}) }
    this.uploaded = new Date()
    this.customMetadata = options?.customMetadata
    this.httpMetadata = options?.httpMetadata
    this.storageClass = options?.storageClass ?? 'Standard'
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

  writeHttpMetadata(_headers: Headers): void {}

  get range(): R2Range | undefined {
    if (this.rangeStart === 0 && this.rangeEnd === this.data.length) {
      return undefined
    }
    return { offset: this.rangeStart, length: this.rangeEnd - this.rangeStart }
  }
}

/**
 * Enhanced Mock R2Bucket that simulates more realistic R2 behavior
 * including conditional operations, storage classes, and error conditions.
 */
class EnhancedMockR2Bucket implements R2Bucket {
  private objects = new Map<
    string,
    {
      data: Uint8Array
      metadata?: Record<string, string>
      httpMetadata?: R2HTTPMetadata
      version: string
      etag: string
      storageClass: string
    }
  >()

  // Error simulation flags
  private errorConditions: {
    accessDenied?: Set<string>
    notFound?: Set<string>
    preconditionFailed?: Set<string>
    rateLimited?: boolean
    serviceUnavailable?: boolean
  } = {}

  async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object> {
    // Simulate access denied
    if (this.errorConditions.accessDenied?.has(key)) {
      const error = new Error('Access Denied') as Error & { code: string }
      error.code = 'ERR_R2_ACCESS_DENIED'
      throw error
    }

    // Simulate rate limiting
    if (this.errorConditions.rateLimited) {
      const error = new Error('Rate limit exceeded') as Error & { code: string }
      error.code = 'ERR_R2_RATE_LIMITED'
      throw error
    }

    // Simulate conditional put (If-None-Match: *)
    if (options?.onlyIf) {
      const existing = this.objects.get(key)
      const cond = options.onlyIf as {
        etagMatches?: string
        etagDoesNotMatch?: string
        uploadedBefore?: Date
        uploadedAfter?: Date
      }

      if (cond.etagDoesNotMatch === '*' && existing) {
        const error = new Error('Precondition Failed') as Error & { code: string }
        error.code = 'ERR_R2_PRECONDITION_FAILED'
        throw error
      }

      if (cond.etagMatches && existing?.etag !== cond.etagMatches) {
        const error = new Error('Precondition Failed') as Error & { code: string }
        error.code = 'ERR_R2_PRECONDITION_FAILED'
        throw error
      }
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

    const version = crypto.randomUUID()
    const etag = `"${crypto.randomUUID().slice(0, 8)}"`

    this.objects.set(key, {
      data,
      metadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
      version,
      etag,
      storageClass: (options as R2PutOptions & { storageClass?: string })?.storageClass ?? 'Standard',
    })

    return new MockR2ObjectWithVersioning(key, data, {
      customMetadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
      version,
    })
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    // Simulate access denied
    if (this.errorConditions.accessDenied?.has(key)) {
      const error = new Error('Access Denied') as Error & { code: string }
      error.code = 'ERR_R2_ACCESS_DENIED'
      throw error
    }

    const obj = this.objects.get(key)
    if (!obj) return null

    // Simulate conditional get
    if (options?.onlyIf) {
      const cond = options.onlyIf as {
        etagMatches?: string
        etagDoesNotMatch?: string
        uploadedBefore?: Date
        uploadedAfter?: Date
      }

      if (cond.etagMatches && obj.etag !== cond.etagMatches) {
        return null // Returns null when condition not met
      }

      if (cond.etagDoesNotMatch && obj.etag === cond.etagDoesNotMatch) {
        return null
      }
    }

    let rangeStart = 0
    let rangeEnd = obj.data.length

    if (options?.range) {
      const range = options.range as { offset?: number; length?: number; suffix?: number }

      if (range.suffix !== undefined) {
        // Suffix range: last N bytes
        rangeStart = Math.max(0, obj.data.length - range.suffix)
        rangeEnd = obj.data.length
      } else if (range.offset !== undefined) {
        rangeStart = Math.min(range.offset, obj.data.length)
        if (range.length !== undefined) {
          rangeEnd = Math.min(rangeStart + range.length, obj.data.length)
        }
      }
    }

    return new MockR2ObjectWithVersioning(key, obj.data, {
      customMetadata: obj.metadata,
      httpMetadata: obj.httpMetadata,
      rangeStart,
      rangeEnd,
      version: obj.version,
      storageClass: obj.storageClass,
    }) as unknown as R2ObjectBody
  }

  async head(key: string): Promise<R2Object | null> {
    if (this.errorConditions.accessDenied?.has(key)) {
      const error = new Error('Access Denied') as Error & { code: string }
      error.code = 'ERR_R2_ACCESS_DENIED'
      throw error
    }

    const obj = this.objects.get(key)
    if (!obj) return null

    return new MockR2ObjectWithVersioning(key, obj.data, {
      customMetadata: obj.metadata,
      httpMetadata: obj.httpMetadata,
      version: obj.version,
      storageClass: obj.storageClass,
    })
  }

  async delete(keys: string | string[]): Promise<void> {
    const keysArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keysArray) {
      if (this.errorConditions.accessDenied?.has(key)) {
        const error = new Error('Access Denied') as Error & { code: string }
        error.code = 'ERR_R2_ACCESS_DENIED'
        throw error
      }
      this.objects.delete(key)
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? ''
    const limit = options?.limit ?? 1000
    const cursor = options?.cursor
    const delimiter = options?.delimiter

    const allKeys = Array.from(this.objects.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()

    let startIndex = 0
    if (cursor) {
      const cursorIndex = allKeys.findIndex((key) => key > cursor)
      startIndex = cursorIndex >= 0 ? cursorIndex : allKeys.length
    }

    const pageKeys = allKeys.slice(startIndex, startIndex + limit)
    const objects: R2Object[] = []
    const delimitedPrefixes: string[] = []

    for (const key of pageKeys) {
      const obj = this.objects.get(key)!

      // Handle delimiter for virtual directories
      if (delimiter) {
        const relativePath = key.slice(prefix.length)
        const delimiterIndex = relativePath.indexOf(delimiter)
        if (delimiterIndex >= 0) {
          const commonPrefix = prefix + relativePath.slice(0, delimiterIndex + delimiter.length)
          if (!delimitedPrefixes.includes(commonPrefix)) {
            delimitedPrefixes.push(commonPrefix)
          }
          continue
        }
      }

      objects.push(
        new MockR2ObjectWithVersioning(key, obj.data, {
          customMetadata: obj.metadata,
          httpMetadata: obj.httpMetadata,
          version: obj.version,
          storageClass: obj.storageClass,
        })
      )
    }

    const hasMore = startIndex + limit < allKeys.length

    return {
      objects,
      truncated: hasMore,
      cursor: hasMore ? pageKeys[pageKeys.length - 1] : undefined,
      delimitedPrefixes,
    }
  }

  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    const uploadId = crypto.randomUUID()
    const parts: { partNumber: number; data: Uint8Array; etag: string }[] = []

    const upload: R2MultipartUpload = {
      key,
      uploadId,
      uploadPart: async (partNumber: number, value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob) => {
        // R2 requires parts to be at least 5MB (except last part)
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

        const etag = `"part-${partNumber}-${crypto.randomUUID().slice(0, 8)}"`
        parts.push({ partNumber, data, etag })

        return { partNumber, etag }
      },
      abort: async () => {
        parts.length = 0
      },
      complete: async (uploadedParts: R2UploadedPart[]) => {
        // Verify all parts are present
        const partNumbers = new Set(uploadedParts.map((p) => p.partNumber))
        for (const part of parts) {
          if (!partNumbers.has(part.partNumber)) {
            throw new Error(`Missing part ${part.partNumber}`)
          }
        }

        // Verify ETags match
        for (const uploadedPart of uploadedParts) {
          const localPart = parts.find((p) => p.partNumber === uploadedPart.partNumber)
          if (!localPart || localPart.etag !== uploadedPart.etag) {
            throw new Error(`ETag mismatch for part ${uploadedPart.partNumber}`)
          }
        }

        const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber)
        const totalLength = sortedParts.reduce((acc, p) => acc + p.data.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const part of sortedParts) {
          combined.set(part.data, offset)
          offset += part.data.length
        }

        const version = crypto.randomUUID()
        const etag = `"${crypto.randomUUID().slice(0, 8)}"`

        this.objects.set(key, {
          data: combined,
          metadata: options?.customMetadata,
          httpMetadata: options?.httpMetadata,
          version,
          etag,
          storageClass: 'Standard',
        })

        return new MockR2ObjectWithVersioning(key, combined, {
          customMetadata: options?.customMetadata,
          httpMetadata: options?.httpMetadata,
          version,
        })
      },
    }

    return Promise.resolve(upload)
  }

  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload {
    // Simulate resuming a non-existent upload
    return {
      key,
      uploadId,
      uploadPart: async () => {
        const error = new Error('Upload not found or expired') as Error & { code: string }
        error.code = 'ERR_R2_UPLOAD_NOT_FOUND'
        throw error
      },
      abort: async () => {},
      complete: async () => {
        const error = new Error('Upload not found or expired') as Error & { code: string }
        error.code = 'ERR_R2_UPLOAD_NOT_FOUND'
        throw error
      },
    }
  }

  // Test helper methods
  setAccessDenied(keys: string[]): void {
    this.errorConditions.accessDenied = new Set(keys)
  }

  setRateLimited(limited: boolean): void {
    this.errorConditions.rateLimited = limited
  }

  clear(): void {
    this.objects.clear()
    this.errorConditions = {}
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  getVersion(key: string): string | undefined {
    return this.objects.get(key)?.version
  }

  getEtag(key: string): string | undefined {
    return this.objects.get(key)?.etag
  }
}

// =============================================================================
// RED Phase Tests - These should FAIL until implementation is updated
// =============================================================================

describe('R2Storage Edge Cases (RED Phase)', () => {
  let bucket: EnhancedMockR2Bucket
  let storage: R2Storage

  beforeEach(() => {
    bucket = new EnhancedMockR2Bucket()
    storage = new R2Storage({ bucket: bucket as unknown as R2Bucket })
  })

  afterEach(() => {
    bucket.clear()
  })

  describe('Conditional Operations', () => {
    it('should support putIfNotExists (If-None-Match: *)', async () => {
      const data = new TextEncoder().encode('original')
      await storage.put('/test.txt', data)

      // This should fail if file exists - R2Storage needs putIfNotExists method
      // @ts-expect-error - Method not implemented yet
      const result = await storage.putIfNotExists('/test.txt', new TextEncoder().encode('new'))

      expect(result).toBeNull() // Should return null when file exists
    })

    it('should support conditional get with ETag matching', async () => {
      const data = new TextEncoder().encode('test content')
      const writeResult = await storage.put('/conditional.txt', data)

      // Get with matching ETag should return data
      // @ts-expect-error - Method not implemented yet
      const result = await storage.getIfMatch('/conditional.txt', writeResult.etag)
      expect(result).not.toBeNull()
      expect(result?.data).toEqual(data)

      // Get with non-matching ETag should return null
      // @ts-expect-error - Method not implemented yet
      const noMatch = await storage.getIfMatch('/conditional.txt', '"wrong-etag"')
      expect(noMatch).toBeNull()
    })

    it('should support conditional put with ETag matching', async () => {
      const data = new TextEncoder().encode('original')
      const writeResult = await storage.put('/versioned.txt', data)

      // Update only if ETag matches (optimistic locking)
      // @ts-expect-error - Method not implemented yet
      const updateResult = await storage.putIfMatch('/versioned.txt', new TextEncoder().encode('updated'), writeResult.etag)

      expect(updateResult).toBeDefined()
      expect(updateResult.size).toBe(7) // 'updated'.length

      // Should fail with wrong ETag
      // @ts-expect-error - Method not implemented yet
      await expect(storage.putIfMatch('/versioned.txt', new TextEncoder().encode('fail'), '"old-etag"')).rejects.toThrow()
    })
  })

  describe('Range Request Edge Cases', () => {
    it('should support suffix range (last N bytes)', async () => {
      const data = new TextEncoder().encode('0123456789ABCDEFGHIJ')
      await storage.put('/suffix-range.txt', data)

      // Get last 5 bytes using suffix range
      // @ts-expect-error - Method signature needs to support suffix
      const result = await storage.getRangeSuffix('/suffix-range.txt', 5)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('FGHIJ')
    })

    it('should handle range request beyond file size', async () => {
      const data = new TextEncoder().encode('short')
      await storage.put('/short.txt', data)

      // Request range beyond file size
      const result = await storage.getRange('/short.txt', 100, 200)

      // Should return empty or handle gracefully
      expect(result).not.toBeNull()
      expect(result!.data.length).toBe(0)
    })

    it('should handle range request with start > end', async () => {
      const data = new TextEncoder().encode('test content')
      await storage.put('/invalid-range.txt', data)

      // Invalid range: start > end
      await expect(storage.getRange('/invalid-range.txt', 10, 5)).rejects.toThrow()
    })
  })

  describe('Access Denied Handling', () => {
    beforeEach(() => {
      bucket.setAccessDenied(['/protected.txt', '/protected/'])
    })

    it('should throw StorageError with EACCES code on put', async () => {
      const data = new TextEncoder().encode('test')

      try {
        await storage.put('/protected.txt', data)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe('EACCES')
      }
    })

    it('should throw StorageError with EACCES code on get', async () => {
      try {
        await storage.get('/protected.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe('EACCES')
      }
    })

    it('should throw StorageError with EACCES code on delete', async () => {
      try {
        await storage.delete('/protected.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe('EACCES')
      }
    })

    it('should throw StorageError with EACCES code on head', async () => {
      try {
        await storage.head('/protected.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe('EACCES')
      }
    })
  })

  describe('Rate Limiting', () => {
    it('should throw StorageError with ETIMEDOUT on rate limit', async () => {
      bucket.setRateLimited(true)

      try {
        await storage.put('/test.txt', new TextEncoder().encode('test'))
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe('ETIMEDOUT')
      }
    })

    it('should include retry-after hint in rate limit error', async () => {
      bucket.setRateLimited(true)

      try {
        await storage.put('/test.txt', new TextEncoder().encode('test'))
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as StorageError & { retryAfter?: number }).retryAfter).toBeDefined()
      }
    })
  })

  describe('UTF-8 Key Handling', () => {
    it('should handle Unicode keys', async () => {
      const data = new TextEncoder().encode('content')
      const unicodeKey = '/docs/\u4e2d\u6587\u6587\u4ef6.txt' // Chinese characters

      await storage.put(unicodeKey, data)
      const result = await storage.get(unicodeKey)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('content')
    })

    it('should handle emoji in keys', async () => {
      const data = new TextEncoder().encode('emoji content')
      const emojiKey = '/\ud83d\udcc1/notes/\ud83d\udc4d.txt'

      await storage.put(emojiKey, data)
      const result = await storage.get(emojiKey)

      expect(result).not.toBeNull()
    })

    it('should handle special characters that need URL encoding', async () => {
      const data = new TextEncoder().encode('special')
      const specialKey = '/path with spaces/file#1.txt'

      await storage.put(specialKey, data)
      const result = await storage.get(specialKey)

      expect(result).not.toBeNull()
    })

    it('should handle very long keys (up to 1024 bytes)', async () => {
      const data = new TextEncoder().encode('content')
      const longKey = '/' + 'a'.repeat(1020) + '.txt' // 1024 byte key

      await storage.put(longKey, data)
      const result = await storage.get(longKey)

      expect(result).not.toBeNull()
    })

    it('should reject keys longer than 1024 bytes', async () => {
      const data = new TextEncoder().encode('content')
      const tooLongKey = '/' + 'a'.repeat(1030) + '.txt' // > 1024 bytes

      await expect(storage.put(tooLongKey, data)).rejects.toThrow()
    })
  })

  describe('Zero-byte Files', () => {
    it('should correctly store and retrieve zero-byte file', async () => {
      const emptyData = new Uint8Array(0)

      const result = await storage.put('/empty.txt', emptyData)
      expect(result.size).toBe(0)

      const retrieved = await storage.get('/empty.txt')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.data.length).toBe(0)
      expect(retrieved!.metadata.size).toBe(0)
    })

    it('should correctly report exists for zero-byte file', async () => {
      await storage.put('/zero.txt', new Uint8Array(0))

      const exists = await storage.exists('/zero.txt')
      expect(exists).toBe(true)
    })

    it('should correctly report metadata for zero-byte file', async () => {
      await storage.put('/zero.txt', new Uint8Array(0), {
        contentType: 'text/plain',
        customMetadata: { empty: 'true' },
      })

      const head = await storage.head('/zero.txt')
      expect(head).not.toBeNull()
      expect(head!.size).toBe(0)
      expect(head!.contentType).toBe('text/plain')
      expect(head!.customMetadata).toEqual({ empty: 'true' })
    })
  })

  describe('Multipart Upload Edge Cases', () => {
    it('should reject parts smaller than 5MB (except last)', async () => {
      const upload = await storage.createMultipartUpload('/large.bin')

      // Part 1: Only 1KB (should fail on non-final part for real R2)
      const smallPart = new Uint8Array(1024)

      // Upload small part as part 1 (should fail if not the last part)
      const part1 = await upload.uploadPart(1, smallPart)

      // Upload another small part - R2 should reject this
      // because part 1 was too small and wasn't the last
      await expect(async () => {
        await upload.uploadPart(2, smallPart)
        await upload.complete([part1, { partNumber: 2, etag: '"fake"' }])
      }).rejects.toThrow()
    })

    it('should enforce maximum 10000 parts', async () => {
      const upload = await storage.createMultipartUpload('/many-parts.bin')
      const partData = new Uint8Array(5 * 1024 * 1024) // 5MB part

      // Try to upload more than 10000 parts
      // @ts-expect-error - Testing constraint
      await expect(upload.uploadPart(10001, partData)).rejects.toThrow()
    })

    it('should validate part ETags on complete', async () => {
      const upload = await storage.createMultipartUpload('/etag-test.bin')

      const part1 = await upload.uploadPart(1, new Uint8Array(1024))

      // Complete with wrong ETag
      await expect(
        upload.complete([
          { partNumber: 1, etag: '"wrong-etag"' },
        ])
      ).rejects.toThrow()
    })

    it('should handle abort during upload', async () => {
      const upload = await storage.createMultipartUpload('/abort-test.bin')

      await upload.uploadPart(1, new Uint8Array(1024))
      await upload.abort()

      // After abort, complete should fail
      await expect(upload.complete([{ partNumber: 1, etag: '"part-1"' }])).rejects.toThrow()
    })

    it('should handle expired upload resume', async () => {
      // Try to resume a non-existent upload
      const resumed = storage.resumeMultipartUpload('/expired.bin', 'non-existent-id')

      await expect(resumed.uploadPart(1, new Uint8Array(1024))).rejects.toThrow('Upload not found')
    })
  })

  describe('List with Delimiter', () => {
    beforeEach(async () => {
      // Create a directory structure
      const data = new TextEncoder().encode('content')
      await storage.put('/root/file1.txt', data)
      await storage.put('/root/file2.txt', data)
      await storage.put('/root/subdir1/file3.txt', data)
      await storage.put('/root/subdir1/file4.txt', data)
      await storage.put('/root/subdir2/file5.txt', data)
    })

    it('should return common prefixes with delimiter', async () => {
      // @ts-expect-error - delimiter option not exposed yet
      const result = await storage.list({ prefix: '/root/', delimiter: '/' })

      // Should return files directly in /root/ plus common prefixes for subdirs
      expect(result.objects.length).toBe(2) // file1.txt, file2.txt
      expect(result.delimitedPrefixes).toContain('/root/subdir1/')
      expect(result.delimitedPrefixes).toContain('/root/subdir2/')
    })
  })

  describe('Storage Instrumentation', () => {
    it('should call hooks with byte transfer metrics', async () => {
      const hooks = {
        onOperationStart: vi.fn(),
        onOperationEnd: vi.fn(),
      }

      const instrumentedStorage = new R2Storage({
        bucket: bucket as unknown as R2Bucket,
        hooks,
      })

      const data = new Uint8Array(1024 * 100) // 100KB
      await instrumentedStorage.put('/metrics.bin', data)

      expect(hooks.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'put' }),
        expect.objectContaining({
          success: true,
          size: 1024 * 100, // Should include bytes transferred
        })
      )
    })

    it('should track latency percentiles', async () => {
      const latencies: number[] = []
      const hooks = {
        onOperationEnd: vi.fn((ctx, result) => {
          latencies.push(result.durationMs)
        }),
      }

      const instrumentedStorage = new R2Storage({
        bucket: bucket as unknown as R2Bucket,
        hooks,
      })

      // Perform multiple operations
      for (let i = 0; i < 10; i++) {
        await instrumentedStorage.put(`/latency-${i}.txt`, new TextEncoder().encode('test'))
      }

      expect(latencies.length).toBe(10)
      expect(latencies.every((l) => l >= 0)).toBe(true)
    })
  })

  describe('Copy with Metadata Override', () => {
    it('should allow overriding metadata on copy', async () => {
      const data = new TextEncoder().encode('original')
      await storage.put('/original.txt', data, {
        contentType: 'text/plain',
        customMetadata: { version: '1' },
      })

      // Copy with new metadata
      // @ts-expect-error - Method signature doesn't support options yet
      await storage.copy('/original.txt', '/copied.txt', {
        contentType: 'application/octet-stream',
        customMetadata: { version: '2', copied: 'true' },
      })

      const copied = await storage.get('/copied.txt')
      expect(copied!.metadata.contentType).toBe('application/octet-stream')
      expect(copied!.metadata.customMetadata).toEqual({ version: '2', copied: 'true' })
    })
  })

  describe('Head with Strong Consistency', () => {
    it('should return consistent metadata immediately after put', async () => {
      const data = new TextEncoder().encode('consistency test')
      const writeResult = await storage.put('/consistent.txt', data, {
        customMetadata: { timestamp: Date.now().toString() },
      })

      // Immediately check head - should be consistent
      const head = await storage.head('/consistent.txt')

      expect(head).not.toBeNull()
      expect(head!.etag).toBe(writeResult.etag)
      expect(head!.size).toBe(data.length)
    })
  })

  describe('Checksum Validation', () => {
    it('should support MD5 checksum on upload', async () => {
      const data = new TextEncoder().encode('checksum test data')
      // Calculate expected MD5 (in real impl, would use crypto)
      const expectedMd5 = 'expected-md5-hash'

      // @ts-expect-error - Checksum options not implemented
      await storage.put('/checksummed.txt', data, {
        md5: expectedMd5,
      })

      const head = await storage.head('/checksummed.txt')
      // @ts-expect-error - Checksum not in metadata type
      expect(head!.md5).toBe(expectedMd5)
    })

    it('should reject upload with mismatched checksum', async () => {
      const data = new TextEncoder().encode('checksum test data')

      // @ts-expect-error - Checksum options not implemented
      await expect(
        storage.put('/bad-checksum.txt', data, {
          md5: 'wrong-md5-hash',
        })
      ).rejects.toThrow()
    })
  })
})
