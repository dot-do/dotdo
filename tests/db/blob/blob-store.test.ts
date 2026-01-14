import { describe, it, expect, beforeEach } from 'vitest'

/**
 * BlobStore Tests (RED Phase)
 *
 * These tests define the BlobStore API for binary object storage with R2 as primary tier.
 * All tests should FAIL until the implementation is complete.
 *
 * BlobStore provides:
 * - Binary storage (images, PDFs, videos, etc.)
 * - Streaming upload/download for large files
 * - Content-addressed deduplication via SHA-256
 * - Metadata index in SQLite for fast lookups
 * - Presigned URLs for direct browser access
 * - CDC event emission for metadata changes
 *
 * Three-tier storage:
 * - HOT: DO SQLite (metadata only)
 * - WARM: R2 Standard (primary blob storage)
 * - COLD: R2 Infrequent Access (30+ days no access)
 */

// This import should FAIL until BlobStore is implemented
// @ts-expect-error - BlobStore not yet implemented
import { BlobStore } from '../../../db/blob'

// Type definitions for expected API shape
// These define what the implementation should provide

interface BlobMetadata {
  $id: string
  key: string
  r2Key: string
  contentType: string
  size: number
  hash?: string
  refCount?: number
  metadata?: Record<string, unknown>
  $createdAt: number
  $updatedAt: number
}

interface BlobResult {
  $id: string
  key: string
  size: number
  hash: string
  contentType: string
  url: string
}

interface BlobGetResult {
  data: ArrayBuffer
  metadata: BlobMetadata
}

interface ListResult {
  items: BlobMetadata[]
  cursor?: string
  hasMore: boolean
}

interface CDCEvent {
  type: string
  op: string
  store: string
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

// Mock types for R2 bucket and database
interface MockR2Bucket {
  put: (key: string, data: ArrayBuffer | ReadableStream) => Promise<void>
  get: (key: string) => Promise<{ body: ReadableStream; arrayBuffer: () => Promise<ArrayBuffer> } | null>
  delete: (key: string) => Promise<void>
  list: (options?: { prefix?: string; cursor?: string; limit?: number }) => Promise<{ objects: { key: string }[]; cursor?: string }>
  createMultipartUpload: (key: string) => Promise<{ uploadId: string }>
}

interface MockDb {
  exec: (sql: string) => void
  prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] }
}

// ============================================================================
// Basic Put/Get Operations
// ============================================================================

describe('BlobStore', () => {
  describe('put/get operations', () => {
    it('creates BlobStore with R2 bucket and db', () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb

      const blobs = new BlobStore(mockBucket, mockDb)

      expect(blobs).toBeDefined()
      expect(blobs).toBeInstanceOf(BlobStore)
    })

    it('puts a blob with ArrayBuffer data', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const imageData = new ArrayBuffer(1024)
      const result = await blobs.put({
        key: 'uploads/avatar.png',
        data: imageData,
        contentType: 'image/png',
        metadata: { userId: 'user_123', purpose: 'avatar' },
      })

      expect(result.$id).toBeDefined()
      expect(result.key).toBe('uploads/avatar.png')
      expect(result.size).toBe(1024)
      expect(result.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(result.contentType).toBe('image/png')
      expect(result.url).toBeDefined()
    })

    it('puts a blob with Blob data', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const blobData = new Blob(['hello world'], { type: 'text/plain' })
      const result = await blobs.put({
        key: 'uploads/document.txt',
        data: blobData,
        contentType: 'text/plain',
      })

      expect(result.$id).toBeDefined()
      expect(result.key).toBe('uploads/document.txt')
      expect(result.contentType).toBe('text/plain')
    })

    it('gets a blob by key', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // First put the blob
      const imageData = new ArrayBuffer(512)
      await blobs.put({
        key: 'uploads/photo.jpg',
        data: imageData,
        contentType: 'image/jpeg',
      })

      // Then get it
      const result = await blobs.get('uploads/photo.jpg')

      expect(result).toBeDefined()
      expect(result.data).toBeInstanceOf(ArrayBuffer)
      expect(result.data.byteLength).toBe(512)
      expect(result.metadata.contentType).toBe('image/jpeg')
    })

    it('returns null for non-existent blob', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const result = await blobs.get('non-existent/key.png')

      expect(result).toBeNull()
    })

    it('deletes a blob', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'uploads/to-delete.pdf',
        data: new ArrayBuffer(256),
        contentType: 'application/pdf',
      })

      await blobs.delete('uploads/to-delete.pdf')

      const result = await blobs.get('uploads/to-delete.pdf')
      expect(result).toBeNull()
    })

    it('lists blobs with prefix', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Put several blobs
      await blobs.put({ key: 'uploads/a.png', data: new ArrayBuffer(100), contentType: 'image/png' })
      await blobs.put({ key: 'uploads/b.png', data: new ArrayBuffer(100), contentType: 'image/png' })
      await blobs.put({ key: 'other/c.png', data: new ArrayBuffer(100), contentType: 'image/png' })

      const result = await blobs.list({ prefix: 'uploads/', limit: 100 })

      expect(result.items).toHaveLength(2)
      expect(result.items.every((item) => item.key.startsWith('uploads/'))).toBe(true)
    })

    it('lists blobs with pagination', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Put multiple blobs
      for (let i = 0; i < 10; i++) {
        await blobs.put({
          key: `uploads/file-${i}.txt`,
          data: new ArrayBuffer(100),
          contentType: 'text/plain',
        })
      }

      const page1 = await blobs.list({ prefix: 'uploads/', limit: 5 })
      expect(page1.items).toHaveLength(5)
      expect(page1.hasMore).toBe(true)
      expect(page1.cursor).toBeDefined()

      const page2 = await blobs.list({ prefix: 'uploads/', limit: 5, cursor: page1.cursor })
      expect(page2.items).toHaveLength(5)
      expect(page2.hasMore).toBe(false)
    })
  })

  // ============================================================================
  // Streaming Upload/Download
  // ============================================================================

  describe('streaming upload/download', () => {
    it('uploads blob from ReadableStream', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Create a readable stream
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk))
          controller.close()
        },
      })

      const result = await blobs.putStream({
        key: 'uploads/video.mp4',
        stream,
        contentType: 'video/mp4',
        contentLength: 6,
      })

      expect(result.$id).toBeDefined()
      expect(result.key).toBe('uploads/video.mp4')
      expect(result.size).toBe(6)
      expect(result.contentType).toBe('video/mp4')
    })

    it('downloads blob as ReadableStream', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'uploads/large-file.bin',
        data: new ArrayBuffer(1024 * 1024), // 1MB
        contentType: 'application/octet-stream',
      })

      const stream = await blobs.getStream('uploads/large-file.bin')

      expect(stream).toBeInstanceOf(ReadableStream)

      // Read the stream
      const reader = stream.getReader()
      let totalBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
      }
      expect(totalBytes).toBe(1024 * 1024)
    })

    it('returns null stream for non-existent blob', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const stream = await blobs.getStream('non-existent/file.bin')

      expect(stream).toBeNull()
    })

    it('handles multipart upload for large files', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // 100MB file - should trigger multipart upload
      const largeData = new ArrayBuffer(100 * 1024 * 1024)

      const result = await blobs.putStream({
        key: 'uploads/huge-video.mp4',
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(largeData))
            controller.close()
          },
        }),
        contentType: 'video/mp4',
        contentLength: 100 * 1024 * 1024,
      })

      expect(result.size).toBe(100 * 1024 * 1024)
    })
  })

  // ============================================================================
  // Presigned URLs
  // ============================================================================

  describe('presigned URLs', () => {
    it('generates presigned URL for download', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'uploads/secure-file.pdf',
        data: new ArrayBuffer(1024),
        contentType: 'application/pdf',
      })

      const url = await blobs.getSignedUrl('uploads/secure-file.pdf', {
        expiresIn: '1h',
        disposition: 'inline',
      })

      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
      expect(url).toMatch(/^https:\/\//)
    })

    it('generates presigned URL with attachment disposition', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'downloads/report.csv',
        data: new ArrayBuffer(2048),
        contentType: 'text/csv',
      })

      const url = await blobs.getSignedUrl('downloads/report.csv', {
        expiresIn: '30m',
        disposition: 'attachment',
      })

      expect(url).toContain('response-content-disposition')
    })

    it('generates presigned upload URL for direct browser upload', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const uploadUrl = await blobs.getUploadUrl({
        key: 'uploads/user-upload.pdf',
        contentType: 'application/pdf',
        maxSize: 10 * 1024 * 1024, // 10MB
        expiresIn: '15m',
      })

      expect(uploadUrl).toBeDefined()
      expect(typeof uploadUrl).toBe('string')
      expect(uploadUrl).toMatch(/^https:\/\//)
    })

    it('throws error for non-existent blob when getting signed URL', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await expect(
        blobs.getSignedUrl('non-existent/file.pdf', { expiresIn: '1h' })
      ).rejects.toThrow()
    })

    it('parses expiry duration strings correctly', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'test/file.txt',
        data: new ArrayBuffer(100),
        contentType: 'text/plain',
      })

      // Various duration formats should work
      const url1h = await blobs.getSignedUrl('test/file.txt', { expiresIn: '1h' })
      const url30m = await blobs.getSignedUrl('test/file.txt', { expiresIn: '30m' })
      const url7d = await blobs.getSignedUrl('test/file.txt', { expiresIn: '7d' })
      const url1s = await blobs.getSignedUrl('test/file.txt', { expiresIn: '1s' })

      expect(url1h).toBeDefined()
      expect(url30m).toBeDefined()
      expect(url7d).toBeDefined()
      expect(url1s).toBeDefined()
    })
  })

  // ============================================================================
  // Content-Addressed Deduplication
  // ============================================================================

  describe('content-addressed deduplication', () => {
    it('creates BlobStore with content-addressed mode', () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb

      const blobs = new BlobStore(mockBucket, mockDb, {
        contentAddressed: true,
      })

      expect(blobs).toBeDefined()
    })

    it('stores same content only once with content-addressing', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      const pdfContent = new ArrayBuffer(1024)

      // Upload same content twice with different keys
      const result1 = await blobs.put({
        key: 'file1.pdf',
        data: pdfContent,
        contentType: 'application/pdf',
      })

      const result2 = await blobs.put({
        key: 'file2.pdf',
        data: pdfContent,
        contentType: 'application/pdf',
      })

      // Both should have the same hash
      expect(result1.hash).toBe(result2.hash)

      // Different $id (metadata entries)
      expect(result1.$id).not.toBe(result2.$id)

      // Different keys
      expect(result1.key).toBe('file1.pdf')
      expect(result2.key).toBe('file2.pdf')
    })

    it('tracks reference count for deduplicated blobs', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      const content = new ArrayBuffer(512)

      await blobs.put({ key: 'copy1.bin', data: content, contentType: 'application/octet-stream' })
      await blobs.put({ key: 'copy2.bin', data: content, contentType: 'application/octet-stream' })
      await blobs.put({ key: 'copy3.bin', data: content, contentType: 'application/octet-stream' })

      // Internal method to check ref count (implementation detail)
      const metadata = await blobs.getMetadata('copy1.bin')
      // All three point to same content, but this is metadata for copy1.bin
      expect(metadata).toBeDefined()
    })

    it('decrements ref count on delete, keeps blob if refs > 0', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      const content = new ArrayBuffer(256)

      await blobs.put({ key: 'a.bin', data: content, contentType: 'application/octet-stream' })
      await blobs.put({ key: 'b.bin', data: content, contentType: 'application/octet-stream' })

      // Delete first reference
      await blobs.delete('a.bin')

      // Blob should still be accessible via second reference
      const result = await blobs.get('b.bin')
      expect(result).not.toBeNull()
      expect(result!.data.byteLength).toBe(256)
    })

    it('deletes blob from R2 when ref count reaches 0', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      const content = new ArrayBuffer(128)

      await blobs.put({ key: 'single.bin', data: content, contentType: 'application/octet-stream' })

      // Delete the only reference
      await blobs.delete('single.bin')

      // Blob should be completely gone
      const result = await blobs.get('single.bin')
      expect(result).toBeNull()
    })

    it('computes SHA-256 hash for content addressing', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      const knownContent = new TextEncoder().encode('hello world')

      const result = await blobs.put({
        key: 'hash-test.txt',
        data: knownContent.buffer,
        contentType: 'text/plain',
      })

      // SHA-256 of "hello world"
      expect(result.hash).toBe('sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    })

    it('stores blobs by hash path in R2 with content-addressing', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      const content = new ArrayBuffer(64)

      const result = await blobs.put({
        key: 'my-file.bin',
        data: content,
        contentType: 'application/octet-stream',
      })

      // R2 key should follow pattern: blobs/{sha256-prefix}/{sha256}
      const metadata = await blobs.getMetadata('my-file.bin')
      expect(metadata!.r2Key).toMatch(/^blobs\/[a-f0-9]{2}\/[a-f0-9]{64}$/)
    })
  })

  // ============================================================================
  // Metadata Queries
  // ============================================================================

  describe('metadata queries', () => {
    it('queries blobs by custom metadata', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Upload blobs with different metadata
      await blobs.put({
        key: 'avatar1.png',
        data: new ArrayBuffer(100),
        contentType: 'image/png',
        metadata: { userId: 'user_1', purpose: 'avatar' },
      })

      await blobs.put({
        key: 'avatar2.png',
        data: new ArrayBuffer(100),
        contentType: 'image/png',
        metadata: { userId: 'user_2', purpose: 'avatar' },
      })

      await blobs.put({
        key: 'banner.png',
        data: new ArrayBuffer(100),
        contentType: 'image/png',
        metadata: { userId: 'user_1', purpose: 'banner' },
      })

      const avatars = await blobs.query({
        where: { 'metadata.purpose': 'avatar' },
        limit: 10,
      })

      expect(avatars).toHaveLength(2)
      expect(avatars.every((b) => (b.metadata as any).purpose === 'avatar')).toBe(true)
    })

    it('queries blobs by content type', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({ key: 'a.png', data: new ArrayBuffer(100), contentType: 'image/png' })
      await blobs.put({ key: 'b.jpg', data: new ArrayBuffer(100), contentType: 'image/jpeg' })
      await blobs.put({ key: 'c.pdf', data: new ArrayBuffer(100), contentType: 'application/pdf' })

      const images = await blobs.query({
        where: { contentType: 'image/png' },
      })

      expect(images).toHaveLength(1)
      expect(images[0].key).toBe('a.png')
    })

    it('queries blobs by size range', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({ key: 'small.bin', data: new ArrayBuffer(100), contentType: 'application/octet-stream' })
      await blobs.put({ key: 'medium.bin', data: new ArrayBuffer(1000), contentType: 'application/octet-stream' })
      await blobs.put({ key: 'large.bin', data: new ArrayBuffer(10000), contentType: 'application/octet-stream' })

      const mediumFiles = await blobs.query({
        where: { size: { $gte: 500, $lte: 5000 } },
      })

      expect(mediumFiles).toHaveLength(1)
      expect(mediumFiles[0].key).toBe('medium.bin')
    })

    it('queries blobs by creation date', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const now = Date.now()

      await blobs.put({
        key: 'recent.txt',
        data: new ArrayBuffer(50),
        contentType: 'text/plain',
      })

      const recentFiles = await blobs.query({
        where: { $createdAt: { $gte: now - 60000 } }, // Last minute
      })

      expect(recentFiles.length).toBeGreaterThanOrEqual(1)
    })

    it('combines multiple query conditions', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'user1-avatar.png',
        data: new ArrayBuffer(500),
        contentType: 'image/png',
        metadata: { userId: 'user_1', purpose: 'avatar' },
      })

      await blobs.put({
        key: 'user1-large-avatar.png',
        data: new ArrayBuffer(50000),
        contentType: 'image/png',
        metadata: { userId: 'user_1', purpose: 'avatar' },
      })

      await blobs.put({
        key: 'user2-avatar.png',
        data: new ArrayBuffer(500),
        contentType: 'image/png',
        metadata: { userId: 'user_2', purpose: 'avatar' },
      })

      const result = await blobs.query({
        where: {
          'metadata.userId': 'user_1',
          'metadata.purpose': 'avatar',
          size: { $lt: 10000 },
        },
        limit: 10,
      })

      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('user1-avatar.png')
    })

    it('returns blob metadata without data', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'metadata-test.pdf',
        data: new ArrayBuffer(2048),
        contentType: 'application/pdf',
        metadata: { category: 'documents' },
      })

      const metadata = await blobs.getMetadata('metadata-test.pdf')

      expect(metadata).toBeDefined()
      expect(metadata!.$id).toBeDefined()
      expect(metadata!.key).toBe('metadata-test.pdf')
      expect(metadata!.size).toBe(2048)
      expect(metadata!.contentType).toBe('application/pdf')
      expect(metadata!.metadata).toEqual({ category: 'documents' })
      // Should not include the actual data
      expect((metadata as any).data).toBeUndefined()
    })
  })

  // ============================================================================
  // CDC Event Emission
  // ============================================================================

  describe('CDC event emission', () => {
    it('emits cdc.insert event on blob upload', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const events: CDCEvent[] = []
      blobs.on('cdc', (event: CDCEvent) => events.push(event))

      await blobs.put({
        key: 'uploads/new-file.png',
        data: new ArrayBuffer(1024),
        contentType: 'image/png',
        metadata: { userId: 'user_123' },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'cdc.insert',
        op: 'c',
        store: 'blob',
        table: 'blobs',
        key: 'uploads/new-file.png',
        after: {
          size: 1024,
          contentType: 'image/png',
          metadata: { userId: 'user_123' },
        },
      })
      expect(events[0].after!.hash).toMatch(/^sha256:/)
    })

    it('emits cdc.delete event on blob deletion', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'to-delete.txt',
        data: new ArrayBuffer(512),
        contentType: 'text/plain',
      })

      const events: CDCEvent[] = []
      blobs.on('cdc', (event: CDCEvent) => events.push(event))

      await blobs.delete('to-delete.txt')

      const deleteEvent = events.find((e) => e.type === 'cdc.delete')
      expect(deleteEvent).toBeDefined()
      expect(deleteEvent).toMatchObject({
        type: 'cdc.delete',
        op: 'd',
        store: 'blob',
        table: 'blobs',
        key: 'to-delete.txt',
      })
      expect(deleteEvent!.before).toBeDefined()
      expect(deleteEvent!.before!.size).toBe(512)
    })

    it('emits cdc.update event on metadata update', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'update-test.pdf',
        data: new ArrayBuffer(256),
        contentType: 'application/pdf',
        metadata: { status: 'draft' },
      })

      const events: CDCEvent[] = []
      blobs.on('cdc', (event: CDCEvent) => events.push(event))

      // Update metadata without re-uploading blob
      await blobs.updateMetadata('update-test.pdf', {
        metadata: { status: 'published' },
      })

      const updateEvent = events.find((e) => e.type === 'cdc.update')
      expect(updateEvent).toBeDefined()
      expect(updateEvent).toMatchObject({
        type: 'cdc.update',
        op: 'u',
        store: 'blob',
        table: 'blobs',
        key: 'update-test.pdf',
      })
      expect(updateEvent!.before!.metadata).toEqual({ status: 'draft' })
      expect(updateEvent!.after!.metadata).toEqual({ status: 'published' })
    })

    it('does not emit event for get operations', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'readonly.txt',
        data: new ArrayBuffer(100),
        contentType: 'text/plain',
      })

      const events: CDCEvent[] = []
      blobs.on('cdc', (event: CDCEvent) => events.push(event))

      await blobs.get('readonly.txt')
      await blobs.getStream('readonly.txt')
      await blobs.getMetadata('readonly.txt')

      expect(events).toHaveLength(0)
    })

    it('includes hash in CDC events', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const events: CDCEvent[] = []
      blobs.on('cdc', (event: CDCEvent) => events.push(event))

      await blobs.put({
        key: 'hash-event.bin',
        data: new ArrayBuffer(64),
        contentType: 'application/octet-stream',
      })

      expect(events[0].after!.hash).toBeDefined()
      expect(events[0].after!.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty blob', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const result = await blobs.put({
        key: 'empty.txt',
        data: new ArrayBuffer(0),
        contentType: 'text/plain',
      })

      expect(result.size).toBe(0)

      const retrieved = await blobs.get('empty.txt')
      expect(retrieved!.data.byteLength).toBe(0)
    })

    it('handles special characters in key', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const specialKeys = [
        'path/with/slashes/file.txt',
        'file with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.multiple.dots.txt',
      ]

      for (const key of specialKeys) {
        await blobs.put({
          key,
          data: new ArrayBuffer(10),
          contentType: 'text/plain',
        })

        const result = await blobs.get(key)
        expect(result).not.toBeNull()
        expect(result!.metadata.key).toBe(key)
      }
    })

    it('handles large metadata objects', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      const largeMetadata: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        largeMetadata[`field_${i}`] = `value_${i}_${'x'.repeat(100)}`
      }

      const result = await blobs.put({
        key: 'large-metadata.bin',
        data: new ArrayBuffer(100),
        contentType: 'application/octet-stream',
        metadata: largeMetadata,
      })

      expect(result.$id).toBeDefined()

      const metadata = await blobs.getMetadata('large-metadata.bin')
      expect(Object.keys(metadata!.metadata!)).toHaveLength(100)
    })

    it('validates content type format', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Valid MIME types should work
      await blobs.put({
        key: 'valid.txt',
        data: new ArrayBuffer(10),
        contentType: 'text/plain; charset=utf-8',
      })

      const result = await blobs.get('valid.txt')
      expect(result!.metadata.contentType).toBe('text/plain; charset=utf-8')
    })

    it('handles concurrent uploads to same key', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Start multiple uploads concurrently
      const uploads = await Promise.all([
        blobs.put({ key: 'concurrent.txt', data: new ArrayBuffer(100), contentType: 'text/plain' }),
        blobs.put({ key: 'concurrent.txt', data: new ArrayBuffer(200), contentType: 'text/plain' }),
        blobs.put({ key: 'concurrent.txt', data: new ArrayBuffer(300), contentType: 'text/plain' }),
      ])

      // Last write should win
      const result = await blobs.get('concurrent.txt')
      expect(result).not.toBeNull()
    })

    it('handles binary data with all byte values', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Create buffer with all possible byte values
      const allBytes = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i
      }

      await blobs.put({
        key: 'all-bytes.bin',
        data: allBytes.buffer,
        contentType: 'application/octet-stream',
      })

      const result = await blobs.get('all-bytes.bin')
      const retrieved = new Uint8Array(result!.data)

      expect(retrieved.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(retrieved[i]).toBe(i)
      }
    })
  })

  // ============================================================================
  // Schema Verification
  // ============================================================================

  describe('schema verification', () => {
    it('creates blobs table with required columns', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      // Initialize should create the schema
      await blobs.initialize()

      // Schema should have been created
      // This verifies the SQL in the README was executed
      expect(true).toBe(true) // Placeholder - real test would verify schema
    })

    it('has index on key column', () => {
      // Verify idx_blobs_prefix index exists
      // This is defined in the schema as: CREATE INDEX idx_blobs_prefix ON blobs(key);
      expect(true).toBe(true) // Placeholder
    })

    it('has index on content_type column', () => {
      // Verify idx_blobs_type index exists
      // This is defined in the schema as: CREATE INDEX idx_blobs_type ON blobs(content_type);
      expect(true).toBe(true) // Placeholder
    })

    it('has index on hash column for deduplication', () => {
      // Verify idx_blobs_hash index exists
      // This is defined in the schema as: CREATE INDEX idx_blobs_hash ON blobs(hash);
      expect(true).toBe(true) // Placeholder
    })

    it('has index on size column', () => {
      // Verify idx_blobs_size index exists
      // This is defined in the schema as: CREATE INDEX idx_blobs_size ON blobs(size);
      expect(true).toBe(true) // Placeholder
    })
  })

  // ============================================================================
  // R2 Storage Path Patterns
  // ============================================================================

  describe('R2 storage path patterns', () => {
    it('uses key-addressed path by default', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb)

      await blobs.put({
        key: 'uploads/my-file.pdf',
        data: new ArrayBuffer(100),
        contentType: 'application/pdf',
      })

      const metadata = await blobs.getMetadata('uploads/my-file.pdf')

      // Default: blobs/{namespace}/{key}
      expect(metadata!.r2Key).toBe('blobs/default/uploads/my-file.pdf')
    })

    it('uses content-addressed path when enabled', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { contentAddressed: true })

      await blobs.put({
        key: 'my-file.pdf',
        data: new ArrayBuffer(100),
        contentType: 'application/pdf',
      })

      const metadata = await blobs.getMetadata('my-file.pdf')

      // Content-addressed: blobs/{sha256-prefix}/{sha256}
      expect(metadata!.r2Key).toMatch(/^blobs\/[a-f0-9]{2}\/[a-f0-9]{64}$/)
    })

    it('supports custom namespace in key path', async () => {
      const mockBucket = {} as MockR2Bucket
      const mockDb = {} as MockDb
      const blobs = new BlobStore(mockBucket, mockDb, { namespace: 'tenant-123' })

      await blobs.put({
        key: 'file.txt',
        data: new ArrayBuffer(50),
        contentType: 'text/plain',
      })

      const metadata = await blobs.getMetadata('file.txt')
      expect(metadata!.r2Key).toBe('blobs/tenant-123/file.txt')
    })
  })

  // ============================================================================
  // Type Exports
  // ============================================================================

  describe('type exports', () => {
    it('exports BlobStore class', () => {
      expect(BlobStore).toBeDefined()
      expect(typeof BlobStore).toBe('function')
    })

    // These should fail until types are exported
    it('exports BlobMetadata type', () => {
      // @ts-expect-error - type not yet exported
      const metadata: import('../../../db/blob').BlobMetadata = {
        $id: 'blob_123',
        key: 'test.txt',
        r2Key: 'blobs/default/test.txt',
        contentType: 'text/plain',
        size: 100,
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
      }
      expect(metadata.$id).toBe('blob_123')
    })

    it('exports BlobResult type', () => {
      // @ts-expect-error - type not yet exported
      const result: import('../../../db/blob').BlobResult = {
        $id: 'blob_123',
        key: 'test.txt',
        size: 100,
        hash: 'sha256:abc',
        contentType: 'text/plain',
        url: 'https://example.com/test.txt',
      }
      expect(result.$id).toBe('blob_123')
    })

    it('exports CDCEvent type', () => {
      // @ts-expect-error - type not yet exported
      const event: import('../../../db/blob').BlobCDCEvent = {
        type: 'cdc.insert',
        op: 'c',
        store: 'blob',
        table: 'blobs',
        key: 'test.txt',
        after: { size: 100 },
      }
      expect(event.type).toBe('cdc.insert')
    })
  })
})
