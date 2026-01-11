import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * R2 Object Storage Integration Tests
 *
 * Tests for a unified R2 store integration layer for dotdo that supports:
 * 1. Typed Utility Wrapping R2Bucket
 * 2. Standardized Path Conventions: {tenant}/{type}/{id}/{timestamp}
 * 3. Presigned URL Generation Helpers
 * 4. Streaming Helpers for Large Files
 * 5. Metadata Management
 *
 * Design requirements:
 * - Typed R2 operations
 * - Multi-tenant path isolation
 * - Content-type detection and management
 * - Support for presigned URLs for direct upload/download
 * - Streaming for large file operations
 * - Metadata attachment and retrieval
 */

// Import the module under test (will fail until implemented)
import {
  R2Store,
  createR2Store,
  buildPath,
  parsePath,
  type R2StoreConfig,
  type R2Object,
  type R2ObjectMetadata,
  type R2ListOptions,
  type R2ListResult,
  type PutOptions,
  type GetOptions,
  type PresignedUrlOptions,
  type StreamOptions,
} from '../r2'

// ============================================================================
// Mock R2Bucket Interface
// ============================================================================

interface MockR2Object {
  key: string
  version: string
  size: number
  etag: string
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  uploaded: Date
  body: ReadableStream | null
  bodyUsed: boolean
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T>(): Promise<T>
  blob(): Promise<Blob>
  writeHttpMetadata(headers: Headers): void
}

interface R2HTTPMetadata {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

interface MockR2ObjectBody extends MockR2Object {
  body: ReadableStream
}

function createMockR2Bucket() {
  const store = new Map<string, {
    data: ArrayBuffer
    httpMetadata?: R2HTTPMetadata
    customMetadata?: Record<string, string>
    uploaded: Date
    etag: string
    version: string
  }>()

  const createR2Object = (key: string, entry: typeof store extends Map<string, infer V> ? V : never): MockR2Object => ({
    key,
    version: entry.version,
    size: entry.data.byteLength,
    etag: entry.etag,
    httpMetadata: entry.httpMetadata,
    customMetadata: entry.customMetadata,
    uploaded: entry.uploaded,
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(async () => entry.data),
    text: vi.fn(async () => new TextDecoder().decode(entry.data)),
    json: vi.fn(async <T>() => JSON.parse(new TextDecoder().decode(entry.data)) as T),
    blob: vi.fn(async () => new Blob([entry.data])),
    writeHttpMetadata: vi.fn((headers: Headers) => {
      if (entry.httpMetadata?.contentType) {
        headers.set('content-type', entry.httpMetadata.contentType)
      }
    }),
  })

  const createR2ObjectWithBody = (key: string, entry: typeof store extends Map<string, infer V> ? V : never): MockR2ObjectBody => {
    const obj = createR2Object(key, entry) as MockR2ObjectBody
    obj.body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(entry.data))
        controller.close()
      },
    })
    return obj
  }

  return {
    put: vi.fn(async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
      options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }
    ): Promise<MockR2Object> => {
      let data: ArrayBuffer
      if (typeof value === 'string') {
        data = new TextEncoder().encode(value).buffer as ArrayBuffer
      } else if (value instanceof ArrayBuffer) {
        data = value
      } else if (ArrayBuffer.isView(value)) {
        data = value.buffer as ArrayBuffer
      } else if (value instanceof Blob) {
        data = await value.arrayBuffer()
      } else {
        // ReadableStream
        const reader = value.getReader()
        const chunks: Uint8Array[] = []
        let done = false
        while (!done) {
          const result = await reader.read()
          done = result.done
          if (result.value) {
            chunks.push(result.value)
          }
        }
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        data = combined.buffer as ArrayBuffer
      }

      const entry = {
        data,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        uploaded: new Date(),
        etag: `"${crypto.randomUUID()}"`,
        version: crypto.randomUUID(),
      }
      store.set(key, entry)
      return createR2Object(key, entry)
    }),

    get: vi.fn(async (key: string): Promise<MockR2ObjectBody | null> => {
      const entry = store.get(key)
      if (!entry) return null
      return createR2ObjectWithBody(key, entry)
    }),

    head: vi.fn(async (key: string): Promise<MockR2Object | null> => {
      const entry = store.get(key)
      if (!entry) return null
      return createR2Object(key, entry)
    }),

    delete: vi.fn(async (keys: string | string[]): Promise<void> => {
      const keysArray = Array.isArray(keys) ? keys : [keys]
      for (const key of keysArray) {
        store.delete(key)
      }
    }),

    list: vi.fn(async (options?: {
      prefix?: string
      limit?: number
      cursor?: string
      delimiter?: string
      include?: ('httpMetadata' | 'customMetadata')[]
    }): Promise<{
      objects: MockR2Object[]
      truncated: boolean
      cursor?: string
      delimitedPrefixes: string[]
    }> => {
      const objects: MockR2Object[] = []
      const prefixes = new Set<string>()

      for (const [key, entry] of store) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue

        if (options?.delimiter) {
          const remainder = key.slice(options.prefix?.length ?? 0)
          const delimiterIndex = remainder.indexOf(options.delimiter)
          if (delimiterIndex !== -1) {
            prefixes.add((options.prefix ?? '') + remainder.slice(0, delimiterIndex + 1))
            continue
          }
        }

        objects.push(createR2Object(key, entry))
      }

      const limit = options?.limit ?? 1000
      const truncated = objects.length > limit

      return {
        objects: objects.slice(0, limit),
        truncated,
        cursor: truncated ? 'next-cursor' : undefined,
        delimitedPrefixes: Array.from(prefixes),
      }
    }),

    // For testing presigned URL generation (simulated)
    createMultipartUpload: vi.fn(async (key: string): Promise<{ uploadId: string; key: string }> => ({
      uploadId: crypto.randomUUID(),
      key,
    })),

    // Internal helper for tests
    _store: store,
  }
}

type MockR2Bucket = ReturnType<typeof createMockR2Bucket>

// ============================================================================
// R2Store Factory Function Tests
// ============================================================================

describe('createR2Store()', () => {
  it('exports createR2Store factory function', () => {
    expect(typeof createR2Store).toBe('function')
  })

  it('creates an R2Store instance from R2Bucket binding', () => {
    const mockR2 = createMockR2Bucket()
    const store = createR2Store(mockR2 as unknown as R2Bucket)

    expect(store).toBeInstanceOf(R2Store)
  })

  it('accepts optional tenant configuration', () => {
    const mockR2 = createMockR2Bucket()
    const store = createR2Store(mockR2 as unknown as R2Bucket, { tenant: 'tenant-123' })

    expect(store).toBeInstanceOf(R2Store)
  })

  it('accepts optional default content type configuration', () => {
    const mockR2 = createMockR2Bucket()
    const store = createR2Store(mockR2 as unknown as R2Bucket, { defaultContentType: 'application/octet-stream' })

    expect(store).toBeInstanceOf(R2Store)
  })
})

// ============================================================================
// Path Convention Tests: {tenant}/{type}/{id}/{timestamp}
// ============================================================================

describe('Path conventions', () => {
  describe('buildPath()', () => {
    it('builds path with all components', () => {
      const path = buildPath({
        tenant: 'tenant-123',
        type: 'documents',
        id: 'doc-456',
        timestamp: '2024-01-15T10:30:00Z',
      })

      expect(path).toBe('tenant-123/documents/doc-456/2024-01-15T10:30:00Z')
    })

    it('builds path without timestamp', () => {
      const path = buildPath({
        tenant: 'tenant-123',
        type: 'avatars',
        id: 'user-789',
      })

      expect(path).toBe('tenant-123/avatars/user-789')
    })

    it('builds path with filename', () => {
      const path = buildPath({
        tenant: 'tenant-123',
        type: 'documents',
        id: 'doc-456',
        filename: 'report.pdf',
      })

      expect(path).toBe('tenant-123/documents/doc-456/report.pdf')
    })

    it('builds path with timestamp and filename', () => {
      const path = buildPath({
        tenant: 'tenant-123',
        type: 'backups',
        id: 'db-001',
        timestamp: '2024-01-15T10:30:00Z',
        filename: 'snapshot.sql',
      })

      expect(path).toBe('tenant-123/backups/db-001/2024-01-15T10:30:00Z/snapshot.sql')
    })

    it('encodes special characters in path components', () => {
      const path = buildPath({
        tenant: 'tenant/special',
        type: 'files',
        id: 'file with spaces',
      })

      // Should handle special characters appropriately
      expect(path).toContain('tenant')
      expect(path).toContain('files')
    })
  })

  describe('parsePath()', () => {
    it('parses path with all components', () => {
      const parsed = parsePath('tenant-123/documents/doc-456/2024-01-15T10:30:00Z')

      expect(parsed).toEqual({
        tenant: 'tenant-123',
        type: 'documents',
        id: 'doc-456',
        timestamp: '2024-01-15T10:30:00Z',
        filename: undefined,
      })
    })

    it('parses path without timestamp', () => {
      const parsed = parsePath('tenant-123/avatars/user-789')

      expect(parsed).toEqual({
        tenant: 'tenant-123',
        type: 'avatars',
        id: 'user-789',
        timestamp: undefined,
        filename: undefined,
      })
    })

    it('parses path with filename', () => {
      const parsed = parsePath('tenant-123/documents/doc-456/report.pdf')

      expect(parsed).toEqual({
        tenant: 'tenant-123',
        type: 'documents',
        id: 'doc-456',
        timestamp: undefined,
        filename: 'report.pdf',
      })
    })

    it('parses path with timestamp and filename', () => {
      const parsed = parsePath('tenant-123/backups/db-001/2024-01-15T10:30:00Z/snapshot.sql')

      expect(parsed).toEqual({
        tenant: 'tenant-123',
        type: 'backups',
        id: 'db-001',
        timestamp: '2024-01-15T10:30:00Z',
        filename: 'snapshot.sql',
      })
    })

    it('returns null for invalid paths', () => {
      const parsed = parsePath('invalid')

      expect(parsed).toBeNull()
    })
  })
})

// ============================================================================
// Basic Put/Get Operations Tests
// ============================================================================

describe('R2Store basic operations', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  describe('put()', () => {
    it('stores a string value', async () => {
      const result = await store.put('test-key', 'hello world')

      expect(mockR2.put).toHaveBeenCalledWith(
        'test-key',
        expect.any(String),
        expect.any(Object)
      )
      expect(result.key).toBe('test-key')
    })

    it('stores an ArrayBuffer value', async () => {
      const data = new TextEncoder().encode('binary data').buffer
      const result = await store.put('binary-key', data)

      expect(mockR2.put).toHaveBeenCalled()
      expect(result.key).toBe('binary-key')
    })

    it('stores with custom metadata', async () => {
      await store.put('with-metadata', 'content', {
        customMetadata: { userId: 'user-123', version: '1' },
      })

      expect(mockR2.put).toHaveBeenCalledWith(
        'with-metadata',
        expect.anything(),
        expect.objectContaining({
          customMetadata: { userId: 'user-123', version: '1' },
        })
      )
    })

    it('stores with content type', async () => {
      await store.put('image.png', new ArrayBuffer(10), {
        contentType: 'image/png',
      })

      expect(mockR2.put).toHaveBeenCalledWith(
        'image.png',
        expect.anything(),
        expect.objectContaining({
          httpMetadata: expect.objectContaining({
            contentType: 'image/png',
          }),
        })
      )
    })

    it('auto-detects content type from filename', async () => {
      await store.put('document.pdf', new ArrayBuffer(10))

      expect(mockR2.put).toHaveBeenCalledWith(
        'document.pdf',
        expect.anything(),
        expect.objectContaining({
          httpMetadata: expect.objectContaining({
            contentType: 'application/pdf',
          }),
        })
      )
    })

    it('returns R2Object with metadata', async () => {
      const result = await store.put('test-key', 'content')

      expect(result.key).toBe('test-key')
      expect(result.size).toBeGreaterThan(0)
      expect(result.etag).toBeDefined()
      expect(result.uploaded).toBeInstanceOf(Date)
    })
  })

  describe('get()', () => {
    it('retrieves stored value as text', async () => {
      await store.put('text-key', 'hello world')

      const result = await store.get('text-key')

      expect(result).not.toBeNull()
      expect(await result!.text()).toBe('hello world')
    })

    it('retrieves stored value as ArrayBuffer', async () => {
      const original = new TextEncoder().encode('binary content').buffer
      await store.put('binary-key', original)

      const result = await store.get('binary-key')
      const retrieved = await result!.arrayBuffer()

      expect(new Uint8Array(retrieved)).toEqual(new Uint8Array(original))
    })

    it('retrieves stored value as JSON', async () => {
      const data = { name: 'Test', value: 42 }
      await store.put('json-key', JSON.stringify(data), {
        contentType: 'application/json',
      })

      const result = await store.get('json-key')
      const parsed = await result!.json<typeof data>()

      expect(parsed).toEqual(data)
    })

    it('returns null for non-existent key', async () => {
      const result = await store.get('non-existent')

      expect(result).toBeNull()
    })

    it('includes body as ReadableStream', async () => {
      await store.put('stream-key', 'streaming content')

      const result = await store.get('stream-key')

      expect(result!.body).toBeInstanceOf(ReadableStream)
    })
  })

  describe('head()', () => {
    it('retrieves object metadata without body', async () => {
      await store.put('meta-key', 'content', {
        customMetadata: { version: '1.0' },
      })

      const result = await store.head('meta-key')

      expect(result).not.toBeNull()
      expect(result!.key).toBe('meta-key')
      expect(result!.customMetadata).toEqual({ version: '1.0' })
      expect(result!.body).toBeNull()
    })

    it('returns null for non-existent key', async () => {
      const result = await store.head('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('delete()', () => {
    it('deletes a single object', async () => {
      await store.put('delete-me', 'content')
      await store.delete('delete-me')

      expect(mockR2.delete).toHaveBeenCalledWith('delete-me')
    })

    it('deletes multiple objects', async () => {
      await store.put('key1', 'content1')
      await store.put('key2', 'content2')

      await store.delete(['key1', 'key2'])

      expect(mockR2.delete).toHaveBeenCalledWith(['key1', 'key2'])
    })

    it('does not throw for non-existent key', async () => {
      await expect(store.delete('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('exists()', () => {
    it('returns true for existing object', async () => {
      await store.put('exists-key', 'content')

      const result = await store.exists('exists-key')

      expect(result).toBe(true)
    })

    it('returns false for non-existent object', async () => {
      const result = await store.exists('non-existent')

      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// Tenant-Scoped Operations Tests
// ============================================================================

describe('R2Store tenant operations', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket, { tenant: 'tenant-123' })
  })

  describe('putForTenant()', () => {
    it('stores object with tenant prefix', async () => {
      await store.putForTenant({
        type: 'documents',
        id: 'doc-456',
        data: 'document content',
      })

      expect(mockR2.put).toHaveBeenCalledWith(
        expect.stringContaining('tenant-123/documents/doc-456'),
        expect.anything(),
        expect.any(Object)
      )
    })

    it('stores object with timestamp', async () => {
      const timestamp = '2024-01-15T10:30:00Z'
      await store.putForTenant({
        type: 'backups',
        id: 'backup-001',
        data: 'backup data',
        timestamp,
      })

      expect(mockR2.put).toHaveBeenCalledWith(
        `tenant-123/backups/backup-001/${timestamp}`,
        expect.anything(),
        expect.any(Object)
      )
    })

    it('stores object with filename', async () => {
      await store.putForTenant({
        type: 'uploads',
        id: 'upload-789',
        data: new ArrayBuffer(10),
        filename: 'photo.jpg',
      })

      expect(mockR2.put).toHaveBeenCalledWith(
        'tenant-123/uploads/upload-789/photo.jpg',
        expect.anything(),
        expect.any(Object)
      )
    })
  })

  describe('getForTenant()', () => {
    it('retrieves object with tenant prefix', async () => {
      await store.putForTenant({
        type: 'documents',
        id: 'doc-456',
        data: 'document content',
      })

      const result = await store.getForTenant({
        type: 'documents',
        id: 'doc-456',
      })

      expect(result).not.toBeNull()
      expect(await result!.text()).toBe('document content')
    })

    it('returns null for object in different tenant', async () => {
      // Store directly without tenant prefix
      await mockR2.put('other-tenant/documents/doc-456', 'other content')

      const result = await store.getForTenant({
        type: 'documents',
        id: 'doc-456',
      })

      expect(result).toBeNull()
    })
  })

  describe('listForTenant()', () => {
    it('lists objects for tenant and type', async () => {
      await store.putForTenant({ type: 'documents', id: 'doc-1', data: 'content1' })
      await store.putForTenant({ type: 'documents', id: 'doc-2', data: 'content2' })
      await store.putForTenant({ type: 'images', id: 'img-1', data: 'image data' })

      const result = await store.listForTenant({ type: 'documents' })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: 'tenant-123/documents/',
        })
      )
    })

    it('lists objects for specific id', async () => {
      await store.putForTenant({ type: 'backups', id: 'db-001', data: 'backup1', timestamp: '2024-01-01' })
      await store.putForTenant({ type: 'backups', id: 'db-001', data: 'backup2', timestamp: '2024-01-02' })

      const result = await store.listForTenant({ type: 'backups', id: 'db-001' })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: 'tenant-123/backups/db-001/',
        })
      )
    })

    it('supports pagination', async () => {
      const result = await store.listForTenant({
        type: 'documents',
        limit: 10,
        cursor: 'abc123',
      })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          cursor: 'abc123',
        })
      )
    })
  })

  describe('deleteForTenant()', () => {
    it('deletes object with tenant prefix', async () => {
      await store.putForTenant({ type: 'documents', id: 'doc-456', data: 'content' })

      await store.deleteForTenant({ type: 'documents', id: 'doc-456' })

      expect(mockR2.delete).toHaveBeenCalledWith('tenant-123/documents/doc-456')
    })

    it('deletes object with timestamp', async () => {
      const timestamp = '2024-01-15T10:30:00Z'
      await store.putForTenant({
        type: 'backups',
        id: 'backup-001',
        data: 'backup',
        timestamp,
      })

      await store.deleteForTenant({
        type: 'backups',
        id: 'backup-001',
        timestamp,
      })

      expect(mockR2.delete).toHaveBeenCalledWith(`tenant-123/backups/backup-001/${timestamp}`)
    })
  })
})

// ============================================================================
// Presigned URL Generation Tests
// ============================================================================

describe('R2Store presigned URLs', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket, {
      tenant: 'tenant-123',
      publicUrl: 'https://r2.example.com.ai',
    })
  })

  describe('getSignedUrl()', () => {
    it('generates signed URL for download', async () => {
      await store.put('file.pdf', new ArrayBuffer(10))

      const url = await store.getSignedUrl('file.pdf', {
        expiresIn: 3600,
        action: 'get',
      })

      expect(url).toContain('https://r2.example.com.ai')
      expect(url).toContain('file.pdf')
    })

    it('includes expiration parameter', async () => {
      await store.put('file.pdf', new ArrayBuffer(10))

      const url = await store.getSignedUrl('file.pdf', {
        expiresIn: 3600,
      })

      // URL should contain expiration information
      expect(url).toBeDefined()
    })

    it('supports content-disposition for downloads', async () => {
      await store.put('report.pdf', new ArrayBuffer(10))

      const url = await store.getSignedUrl('report.pdf', {
        expiresIn: 3600,
        contentDisposition: 'attachment; filename="report.pdf"',
      })

      expect(url).toBeDefined()
    })
  })

  describe('getUploadUrl()', () => {
    it('generates signed URL for upload', async () => {
      const url = await store.getUploadUrl('new-file.pdf', {
        expiresIn: 3600,
        contentType: 'application/pdf',
        maxSize: 10 * 1024 * 1024, // 10MB
      })

      expect(url).toContain('https://r2.example.com.ai')
    })

    it('includes content type restriction', async () => {
      const url = await store.getUploadUrl('image.png', {
        expiresIn: 3600,
        contentType: 'image/png',
      })

      expect(url).toBeDefined()
    })
  })

  describe('getSignedUrlForTenant()', () => {
    it('generates signed URL with tenant path', async () => {
      await store.putForTenant({
        type: 'documents',
        id: 'doc-123',
        data: 'content',
      })

      const url = await store.getSignedUrlForTenant({
        type: 'documents',
        id: 'doc-123',
        expiresIn: 3600,
      })

      expect(url).toContain('tenant-123')
      expect(url).toContain('documents')
      expect(url).toContain('doc-123')
    })
  })
})

// ============================================================================
// Streaming Operations Tests
// ============================================================================

describe('R2Store streaming operations', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  describe('putStream()', () => {
    it('stores data from ReadableStream', async () => {
      const chunks = ['chunk1', 'chunk2', 'chunk3']
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
          controller.close()
        },
      })

      const result = await store.putStream('stream-key', stream)

      expect(result.key).toBe('stream-key')
    })

    it('supports content length hint for large files', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024))
          controller.close()
        },
      })

      await store.putStream('large-file', stream, {
        contentLength: 1024 * 1024 * 100, // 100MB hint
        contentType: 'application/octet-stream',
      })

      expect(mockR2.put).toHaveBeenCalled()
    })
  })

  describe('getStream()', () => {
    it('returns ReadableStream for large file', async () => {
      await store.put('large-file', 'large content here')

      const stream = await store.getStream('large-file')

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('returns null for non-existent key', async () => {
      const stream = await store.getStream('non-existent')

      expect(stream).toBeNull()
    })

    it('supports range requests', async () => {
      await store.put('range-file', 'abcdefghijklmnopqrstuvwxyz')

      // This tests the interface, actual range implementation depends on R2
      const stream = await store.getStream('range-file', {
        range: { offset: 0, length: 10 },
      })

      expect(stream).toBeInstanceOf(ReadableStream)
    })
  })

  describe('copyStream()', () => {
    it('copies object from source to destination', async () => {
      await store.put('source-key', 'original content')

      await store.copy('source-key', 'dest-key')

      const result = await store.get('dest-key')
      expect(await result!.text()).toBe('original content')
    })

    it('preserves metadata during copy', async () => {
      await store.put('source-key', 'content', {
        customMetadata: { version: '1.0' },
      })

      await store.copy('source-key', 'dest-key')

      const result = await store.head('dest-key')
      expect(result!.customMetadata).toEqual({ version: '1.0' })
    })
  })
})

// ============================================================================
// Metadata Management Tests
// ============================================================================

describe('R2Store metadata management', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  describe('updateMetadata()', () => {
    it('updates custom metadata on existing object', async () => {
      await store.put('meta-key', 'content', {
        customMetadata: { version: '1.0' },
      })

      await store.updateMetadata('meta-key', {
        customMetadata: { version: '2.0', updatedBy: 'user-123' },
      })

      const result = await store.head('meta-key')
      expect(result!.customMetadata).toEqual({
        version: '2.0',
        updatedBy: 'user-123',
      })
    })

    it('updates HTTP metadata', async () => {
      await store.put('http-meta-key', 'content')

      await store.updateMetadata('http-meta-key', {
        contentType: 'text/plain',
        cacheControl: 'max-age=3600',
      })

      const result = await store.head('http-meta-key')
      expect(result!.httpMetadata?.contentType).toBe('text/plain')
      expect(result!.httpMetadata?.cacheControl).toBe('max-age=3600')
    })
  })

  describe('getMetadata()', () => {
    it('retrieves only metadata without body', async () => {
      await store.put('data-key', 'large content here', {
        customMetadata: { size: 'large' },
        contentType: 'text/plain',
      })

      const metadata = await store.getMetadata('data-key')

      expect(metadata).not.toBeNull()
      expect(metadata!.customMetadata).toEqual({ size: 'large' })
      expect(metadata!.httpMetadata?.contentType).toBe('text/plain')
      expect(metadata!.size).toBeGreaterThan(0)
    })

    it('returns null for non-existent object', async () => {
      const metadata = await store.getMetadata('non-existent')

      expect(metadata).toBeNull()
    })
  })
})

// ============================================================================
// List Operations Tests
// ============================================================================

describe('R2Store list operations', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  describe('list()', () => {
    it('lists objects with prefix', async () => {
      await store.put('docs/file1.txt', 'content1')
      await store.put('docs/file2.txt', 'content2')
      await store.put('images/photo.jpg', 'image')

      const result = await store.list({ prefix: 'docs/' })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: 'docs/' })
      )
    })

    it('supports delimiter for directory-like listing', async () => {
      await store.put('a/b/c/file.txt', 'content')
      await store.put('a/b/d/file.txt', 'content')

      const result = await store.list({
        prefix: 'a/b/',
        delimiter: '/',
      })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: 'a/b/',
          delimiter: '/',
        })
      )
    })

    it('supports pagination with limit and cursor', async () => {
      const result = await store.list({
        prefix: 'files/',
        limit: 100,
        cursor: 'previous-cursor',
      })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
          cursor: 'previous-cursor',
        })
      )
    })

    it('returns truncated flag and cursor for pagination', async () => {
      // Add many items to trigger pagination
      for (let i = 0; i < 5; i++) {
        await store.put(`files/file${i}.txt`, `content${i}`)
      }

      const result = await store.list({ prefix: 'files/', limit: 2 })

      expect(result.objects).toBeDefined()
      expect(result.truncated).toBeDefined()
    })

    it('includes httpMetadata when requested', async () => {
      await store.put('file.txt', 'content', {
        contentType: 'text/plain',
      })

      const result = await store.list({
        include: ['httpMetadata'],
      })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          include: ['httpMetadata'],
        })
      )
    })

    it('includes customMetadata when requested', async () => {
      await store.put('file.txt', 'content', {
        customMetadata: { version: '1.0' },
      })

      const result = await store.list({
        include: ['customMetadata'],
      })

      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          include: ['customMetadata'],
        })
      )
    })
  })

  describe('listAll()', () => {
    it('iterates through all pages', async () => {
      for (let i = 0; i < 10; i++) {
        await store.put(`all-files/file${i}.txt`, `content${i}`)
      }

      const allObjects: R2Object[] = []
      for await (const obj of store.listAll({ prefix: 'all-files/' })) {
        allObjects.push(obj)
      }

      expect(allObjects.length).toBe(10)
    })
  })
})

// ============================================================================
// Content Type Detection Tests
// ============================================================================

describe('R2Store content type detection', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  it.each([
    ['file.json', 'application/json'],
    ['file.html', 'text/html'],
    ['file.css', 'text/css'],
    ['file.js', 'application/javascript'],
    ['file.png', 'image/png'],
    ['file.jpg', 'image/jpeg'],
    ['file.jpeg', 'image/jpeg'],
    ['file.gif', 'image/gif'],
    ['file.svg', 'image/svg+xml'],
    ['file.webp', 'image/webp'],
    ['file.pdf', 'application/pdf'],
    ['file.zip', 'application/zip'],
    ['file.txt', 'text/plain'],
    ['file.md', 'text/markdown'],
    ['file.xml', 'application/xml'],
    ['file.csv', 'text/csv'],
  ])('detects content type for %s as %s', async (filename, expectedType) => {
    await store.put(filename, 'content')

    expect(mockR2.put).toHaveBeenCalledWith(
      filename,
      expect.anything(),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: expectedType,
        }),
      })
    )
  })

  it('uses default content type for unknown extensions', async () => {
    await store.put('file.unknown', 'content')

    expect(mockR2.put).toHaveBeenCalledWith(
      'file.unknown',
      expect.anything(),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: 'application/octet-stream',
        }),
      })
    )
  })

  it('respects explicit content type over auto-detection', async () => {
    await store.put('file.txt', 'content', {
      contentType: 'custom/type',
    })

    expect(mockR2.put).toHaveBeenCalledWith(
      'file.txt',
      expect.anything(),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: 'custom/type',
        }),
      })
    )
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('R2Store error handling', () => {
  let store: R2Store

  beforeEach(() => {
    const mockR2 = {
      put: vi.fn().mockRejectedValue(new Error('R2 put failed')),
      get: vi.fn().mockRejectedValue(new Error('R2 get failed')),
      head: vi.fn().mockRejectedValue(new Error('R2 head failed')),
      delete: vi.fn().mockRejectedValue(new Error('R2 delete failed')),
      list: vi.fn().mockRejectedValue(new Error('R2 list failed')),
    }
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  it('propagates put errors', async () => {
    await expect(store.put('key', 'value')).rejects.toThrow('R2 put failed')
  })

  it('propagates get errors', async () => {
    await expect(store.get('key')).rejects.toThrow('R2 get failed')
  })

  it('propagates head errors', async () => {
    await expect(store.head('key')).rejects.toThrow('R2 head failed')
  })

  it('propagates delete errors', async () => {
    await expect(store.delete('key')).rejects.toThrow('R2 delete failed')
  })

  it('propagates list errors', async () => {
    await expect(store.list({})).rejects.toThrow('R2 list failed')
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('R2Store type safety', () => {
  let mockR2: MockR2Bucket
  let store: R2Store

  beforeEach(() => {
    mockR2 = createMockR2Bucket()
    store = createR2Store(mockR2 as unknown as R2Bucket)
  })

  it('preserves typed JSON through put/get cycle', async () => {
    interface Config {
      version: number
      settings: {
        enabled: boolean
        threshold: number
      }
    }

    const config: Config = {
      version: 1,
      settings: { enabled: true, threshold: 100 },
    }

    await store.put('config.json', JSON.stringify(config), {
      contentType: 'application/json',
    })

    const result = await store.get('config.json')
    const parsed = await result!.json<Config>()

    expect(parsed.version).toBe(1)
    expect(parsed.settings.enabled).toBe(true)
    expect(parsed.settings.threshold).toBe(100)
  })
})
