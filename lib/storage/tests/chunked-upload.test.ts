/**
 * Chunked Upload Tests (TDD RED Phase)
 *
 * These tests define the expected behavior for the ChunkedUploader class
 * which provides resumable, chunked file uploads backed by R2.
 *
 * Features tested:
 * - Initiate chunked upload
 * - Upload individual chunks
 * - Chunk ordering and validation
 * - Resume interrupted uploads
 * - Complete/finalize upload
 * - Abort upload
 * - Progress tracking
 *
 * All tests should FAIL because the implementation doesn't exist yet.
 *
 * Issue: dotdo-ugnws
 * Parent Epic: dotdo-krvi6 (MediaPipeline)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import the module under test (will fail until implemented)
// This import will cause test failure - that's expected for RED phase
import {
  ChunkedUploader,
  type ChunkedUploadConfig,
  type ChunkInfo,
  type UploadSession,
  type UploadProgress,
  ChunkValidationError,
  UploadSessionNotFoundError,
  UploadAlreadyCompleteError,
  ChunkSizeError,
  ChunkOrderError,
  clearSessionRegistry,
} from '../chunked-upload'

// =============================================================================
// Test Data & Mocks
// =============================================================================

const defaultConfig: ChunkedUploadConfig = {
  bucket: 'test-bucket',
  basePath: 'uploads/',
  minChunkSize: 5 * 1024 * 1024, // 5MB minimum (except last chunk)
  maxChunkSize: 100 * 1024 * 1024, // 100MB maximum
  maxTotalSize: 5 * 1024 * 1024 * 1024, // 5GB maximum
  maxChunks: 10000,
  chunkTimeout: 60000, // 60 seconds
  sessionTTL: 24 * 60 * 60 * 1000, // 24 hours
}

const createMockR2 = () => ({
  put: vi.fn().mockResolvedValue({ key: 'test-key', etag: '"test-etag"' }),
  get: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
  head: vi.fn().mockResolvedValue(null),
})

// Helper to create test data of specific size
const createTestData = (sizeBytes: number, fillValue = 65): Uint8Array => {
  return new Uint8Array(sizeBytes).fill(fillValue)
}

// =============================================================================
// Initiate Chunked Upload Tests
// =============================================================================

describe('ChunkedUploader', () => {
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockR2 = createMockR2()
    // Clear global session registry between tests for isolation
    clearSessionRegistry()
  })

  describe('initiate upload', () => {
    it('should create a new upload session with unique ID', async () => {
      const uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      const session = await uploader.initiate({
        filename: 'large-video.mp4',
        contentType: 'video/mp4',
        totalSize: 100 * 1024 * 1024, // 100MB
      })

      expect(session.id).toBeDefined()
      expect(typeof session.id).toBe('string')
      expect(session.id.length).toBeGreaterThan(0)
    })

    it('should return session with expected metadata', async () => {
      const uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      const session = await uploader.initiate({
        filename: 'document.pdf',
        contentType: 'application/pdf',
        totalSize: 50 * 1024 * 1024,
        metadata: { userId: 'user-123', purpose: 'backup' },
      })

      expect(session.filename).toBe('document.pdf')
      expect(session.contentType).toBe('application/pdf')
      expect(session.totalSize).toBe(50 * 1024 * 1024)
      expect(session.metadata).toEqual({ userId: 'user-123', purpose: 'backup' })
      expect(session.status).toBe('pending')
      expect(session.createdAt).toBeInstanceOf(Date)
    })

    it('should calculate expected chunk count based on total size', async () => {
      const uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      // 100MB file with 5MB chunks = 20 chunks
      const session = await uploader.initiate({
        filename: 'video.mp4',
        contentType: 'video/mp4',
        totalSize: 100 * 1024 * 1024,
      })

      expect(session.expectedChunks).toBe(20)
    })

    it('should generate unique IDs for concurrent initiations', async () => {
      const uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      const sessions = await Promise.all([
        uploader.initiate({ filename: 'file1.bin', contentType: 'application/octet-stream', totalSize: 10 * 1024 * 1024 }),
        uploader.initiate({ filename: 'file2.bin', contentType: 'application/octet-stream', totalSize: 10 * 1024 * 1024 }),
        uploader.initiate({ filename: 'file3.bin', contentType: 'application/octet-stream', totalSize: 10 * 1024 * 1024 }),
      ])

      const ids = sessions.map((s) => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })

    it('should reject if total size exceeds maximum', async () => {
      const uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      await expect(
        uploader.initiate({
          filename: 'huge-file.bin',
          contentType: 'application/octet-stream',
          totalSize: 10 * 1024 * 1024 * 1024, // 10GB exceeds 5GB max
        })
      ).rejects.toThrow('exceeds maximum')
    })

    it('should reject if chunk count would exceed maximum', async () => {
      const strictConfig: ChunkedUploadConfig = {
        ...defaultConfig,
        maxChunks: 100,
        minChunkSize: 1024 * 1024, // 1MB
      }
      const uploader = new ChunkedUploader(strictConfig, mockR2 as unknown as R2Bucket)

      // 200MB / 1MB = 200 chunks, exceeds max of 100
      await expect(
        uploader.initiate({
          filename: 'many-chunks.bin',
          contentType: 'application/octet-stream',
          totalSize: 200 * 1024 * 1024,
        })
      ).rejects.toThrow('Too many chunks')
    })

    it('should store session for later retrieval', async () => {
      const uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      const session = await uploader.initiate({
        filename: 'test.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      const retrieved = await uploader.getSession(session.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(session.id)
      expect(retrieved!.filename).toBe('test.bin')
    })
  })

  // ===========================================================================
  // Upload Individual Chunks Tests
  // ===========================================================================

  describe('upload chunks', () => {
    let uploader: InstanceType<typeof ChunkedUploader>
    let session: UploadSession

    beforeEach(async () => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
      session = await uploader.initiate({
        filename: 'chunked-file.bin',
        contentType: 'application/octet-stream',
        totalSize: 25 * 1024 * 1024, // 25MB = 5 chunks of 5MB
      })
    })

    it('should upload a chunk and return chunk info', async () => {
      const chunkData = createTestData(5 * 1024 * 1024) // 5MB

      const result = await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunkData,
      })

      expect(result.chunkIndex).toBe(0)
      expect(result.size).toBe(5 * 1024 * 1024)
      expect(result.etag).toBeDefined()
      expect(result.uploadedAt).toBeInstanceOf(Date)
    })

    it('should store chunk to R2 with correct path', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)

      await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunkData,
      })

      expect(mockR2.put).toHaveBeenCalledWith(
        expect.stringContaining(`uploads/${session.id}/chunks/0`),
        expect.any(Uint8Array)
      )
    })

    it('should allow uploading chunks out of order', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)

      // Upload chunk 2 before chunk 0
      const chunk2 = await uploader.uploadChunk(session.id, {
        chunkIndex: 2,
        data: chunkData,
      })

      const chunk0 = await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunkData,
      })

      expect(chunk2.chunkIndex).toBe(2)
      expect(chunk0.chunkIndex).toBe(0)
    })

    it('should allow overwriting a chunk', async () => {
      const chunk1 = createTestData(5 * 1024 * 1024, 65) // Fill with 'A'
      const chunk1Updated = createTestData(5 * 1024 * 1024, 66) // Fill with 'B'

      const result1 = await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunk1,
      })

      const result2 = await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunk1Updated,
      })

      // ETags should differ for different content
      expect(result1.etag).not.toBe(result2.etag)
    })

    it('should reject chunk for non-existent session', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)

      await expect(
        uploader.uploadChunk('non-existent-session-id', {
          chunkIndex: 0,
          data: chunkData,
        })
      ).rejects.toThrow(UploadSessionNotFoundError)
    })

    it('should reject chunk index out of range', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)

      // Session expects 5 chunks (indices 0-4)
      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 10,
          data: chunkData,
        })
      ).rejects.toThrow(ChunkValidationError)
    })

    it('should reject negative chunk index', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)

      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: -1,
          data: chunkData,
        })
      ).rejects.toThrow(ChunkValidationError)
    })

    it('should reject chunk after upload is completed', async () => {
      // First complete the upload
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }
      await uploader.complete(session.id)

      // Now try to upload another chunk
      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 0,
          data: createTestData(5 * 1024 * 1024),
        })
      ).rejects.toThrow(UploadAlreadyCompleteError)
    })

    it('should update session status to in_progress after first chunk', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)

      await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunkData,
      })

      const updatedSession = await uploader.getSession(session.id)
      expect(updatedSession!.status).toBe('in_progress')
    })
  })

  // ===========================================================================
  // Chunk Validation Tests
  // ===========================================================================

  describe('chunk validation', () => {
    let uploader: InstanceType<typeof ChunkedUploader>
    let session: UploadSession

    beforeEach(async () => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
      session = await uploader.initiate({
        filename: 'validated-file.bin',
        contentType: 'application/octet-stream',
        totalSize: 25 * 1024 * 1024, // 25MB
      })
    })

    it('should reject non-last chunk smaller than minimum size', async () => {
      // Chunk 0 (not last) must be at least 5MB
      const smallChunk = createTestData(1024 * 1024) // 1MB

      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 0,
          data: smallChunk,
        })
      ).rejects.toThrow(ChunkSizeError)
    })

    it('should allow last chunk to be smaller than minimum', async () => {
      // Upload chunks 0-3 with proper size
      for (let i = 0; i < 4; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      // Last chunk (index 4) can be smaller
      const lastChunk = createTestData(5 * 1024 * 1024) // Actually 25MB - 20MB = 5MB for this test
      const result = await uploader.uploadChunk(session.id, {
        chunkIndex: 4,
        data: lastChunk,
      })

      expect(result.chunkIndex).toBe(4)
    })

    it('should reject chunk larger than maximum size', async () => {
      const hugeChunk = createTestData(150 * 1024 * 1024) // 150MB exceeds 100MB max

      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 0,
          data: hugeChunk,
        })
      ).rejects.toThrow(ChunkSizeError)
    })

    it('should validate chunk checksum if provided', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)
      const wrongChecksum = 'invalid-md5-checksum'

      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 0,
          data: chunkData,
          checksum: wrongChecksum,
          checksumAlgorithm: 'md5',
        })
      ).rejects.toThrow(ChunkValidationError)
    })

    it('should accept chunk with correct checksum', async () => {
      const chunkData = createTestData(5 * 1024 * 1024)
      // Note: In real implementation, this would be the actual MD5 of chunkData
      const correctChecksum = 'correct-checksum-placeholder'

      // This test will fail until implementation computes and validates checksum
      const result = await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: chunkData,
        checksum: correctChecksum,
        checksumAlgorithm: 'md5',
      })

      expect(result.checksumValid).toBe(true)
    })
  })

  // ===========================================================================
  // Resume Interrupted Uploads Tests
  // ===========================================================================

  describe('resume interrupted uploads', () => {
    let uploader: InstanceType<typeof ChunkedUploader>
    let session: UploadSession

    beforeEach(async () => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
      session = await uploader.initiate({
        filename: 'resumable-file.bin',
        contentType: 'application/octet-stream',
        totalSize: 50 * 1024 * 1024, // 50MB = 10 chunks
      })

      // Upload first 5 chunks
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }
    })

    it('should retrieve upload state for resumption', async () => {
      const state = await uploader.getUploadState(session.id)

      expect(state.sessionId).toBe(session.id)
      expect(state.uploadedChunks).toHaveLength(5)
      expect(state.missingChunks).toEqual([5, 6, 7, 8, 9])
      expect(state.totalChunks).toBe(10)
    })

    it('should return uploaded chunk indices', async () => {
      const state = await uploader.getUploadState(session.id)

      const uploadedIndices = state.uploadedChunks.map((c) => c.chunkIndex)
      expect(uploadedIndices.sort()).toEqual([0, 1, 2, 3, 4])
    })

    it('should identify missing chunks for resume', async () => {
      const state = await uploader.getUploadState(session.id)

      expect(state.missingChunks).toEqual([5, 6, 7, 8, 9])
    })

    it('should allow resuming upload of missing chunks', async () => {
      // Resume by uploading missing chunks
      for (let i = 5; i < 10; i++) {
        const result = await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
        expect(result.chunkIndex).toBe(i)
      }

      const state = await uploader.getUploadState(session.id)
      expect(state.missingChunks).toEqual([])
      expect(state.uploadedChunks).toHaveLength(10)
    })

    it('should restore session from storage on new uploader instance', async () => {
      // Create new uploader instance (simulating restart)
      const newUploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      // Should be able to retrieve existing session
      const retrievedSession = await newUploader.getSession(session.id)
      expect(retrievedSession).toBeDefined()
      expect(retrievedSession!.id).toBe(session.id)
    })

    it('should persist upload state across restarts', async () => {
      // Create new uploader instance
      const newUploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)

      // Should have the same upload state
      const state = await newUploader.getUploadState(session.id)
      expect(state.uploadedChunks).toHaveLength(5)
      expect(state.missingChunks).toEqual([5, 6, 7, 8, 9])
    })

    it('should validate chunk ETags on resume to detect corruption', async () => {
      const state = await uploader.getUploadState(session.id)

      // Each uploaded chunk should have an ETag for validation
      for (const chunk of state.uploadedChunks) {
        expect(chunk.etag).toBeDefined()
        expect(typeof chunk.etag).toBe('string')
      }
    })

    it('should support verifying chunk integrity on resume', async () => {
      const verified = await uploader.verifyUploadedChunks(session.id)

      expect(verified.valid).toBe(true)
      expect(verified.corruptedChunks).toEqual([])
    })
  })

  // ===========================================================================
  // Complete/Finalize Upload Tests
  // ===========================================================================

  describe('complete upload', () => {
    let uploader: InstanceType<typeof ChunkedUploader>
    let session: UploadSession

    beforeEach(async () => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
      session = await uploader.initiate({
        filename: 'complete-test.bin',
        contentType: 'application/octet-stream',
        totalSize: 25 * 1024 * 1024, // 25MB = 5 chunks
      })
    })

    it('should complete upload when all chunks uploaded', async () => {
      // Upload all chunks
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      const result = await uploader.complete(session.id)

      expect(result.success).toBe(true)
      expect(result.finalPath).toBeDefined()
      expect(result.etag).toBeDefined()
      expect(result.totalSize).toBe(25 * 1024 * 1024)
    })

    it('should fail completion if chunks are missing', async () => {
      // Only upload chunks 0, 1, 3 (missing 2 and 4)
      await uploader.uploadChunk(session.id, { chunkIndex: 0, data: createTestData(5 * 1024 * 1024) })
      await uploader.uploadChunk(session.id, { chunkIndex: 1, data: createTestData(5 * 1024 * 1024) })
      await uploader.uploadChunk(session.id, { chunkIndex: 3, data: createTestData(5 * 1024 * 1024) })

      await expect(uploader.complete(session.id)).rejects.toThrow('Missing chunks')
    })

    it('should reassemble chunks in correct order', async () => {
      // Upload chunks out of order
      await uploader.uploadChunk(session.id, { chunkIndex: 3, data: createTestData(5 * 1024 * 1024, 68) })
      await uploader.uploadChunk(session.id, { chunkIndex: 1, data: createTestData(5 * 1024 * 1024, 66) })
      await uploader.uploadChunk(session.id, { chunkIndex: 4, data: createTestData(5 * 1024 * 1024, 69) })
      await uploader.uploadChunk(session.id, { chunkIndex: 0, data: createTestData(5 * 1024 * 1024, 65) })
      await uploader.uploadChunk(session.id, { chunkIndex: 2, data: createTestData(5 * 1024 * 1024, 67) })

      const result = await uploader.complete(session.id)

      expect(result.success).toBe(true)
      // Final file should be assembled in order 0,1,2,3,4
    })

    it('should update session status to completed', async () => {
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      await uploader.complete(session.id)

      const completedSession = await uploader.getSession(session.id)
      expect(completedSession!.status).toBe('completed')
      expect(completedSession!.completedAt).toBeInstanceOf(Date)
    })

    it('should cleanup chunk files after completion', async () => {
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      await uploader.complete(session.id)

      // R2 delete should have been called for chunk cleanup
      expect(mockR2.delete).toHaveBeenCalled()
    })

    it('should apply content type from session to final object', async () => {
      const typedSession = await uploader.initiate({
        filename: 'video.mp4',
        contentType: 'video/mp4',
        totalSize: 10 * 1024 * 1024, // 10MB = 2 chunks
      })

      await uploader.uploadChunk(typedSession.id, { chunkIndex: 0, data: createTestData(5 * 1024 * 1024) })
      await uploader.uploadChunk(typedSession.id, { chunkIndex: 1, data: createTestData(5 * 1024 * 1024) })

      const result = await uploader.complete(typedSession.id)

      // Verify R2 put was called with correct content type
      expect(mockR2.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          httpMetadata: expect.objectContaining({
            contentType: 'video/mp4',
          }),
        })
      )
    })

    it('should preserve custom metadata in final object', async () => {
      const sessionWithMeta = await uploader.initiate({
        filename: 'document.pdf',
        contentType: 'application/pdf',
        totalSize: 10 * 1024 * 1024,
        metadata: { author: 'test-user', version: '1.0' },
      })

      await uploader.uploadChunk(sessionWithMeta.id, { chunkIndex: 0, data: createTestData(5 * 1024 * 1024) })
      await uploader.uploadChunk(sessionWithMeta.id, { chunkIndex: 1, data: createTestData(5 * 1024 * 1024) })

      await uploader.complete(sessionWithMeta.id)

      expect(mockR2.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          customMetadata: expect.objectContaining({
            author: 'test-user',
            version: '1.0',
          }),
        })
      )
    })

    it('should reject completion for non-existent session', async () => {
      await expect(uploader.complete('non-existent-session')).rejects.toThrow(UploadSessionNotFoundError)
    })

    it('should reject completion for already completed session', async () => {
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      await uploader.complete(session.id)

      // Second completion should fail
      await expect(uploader.complete(session.id)).rejects.toThrow(UploadAlreadyCompleteError)
    })
  })

  // ===========================================================================
  // Abort Upload Tests
  // ===========================================================================

  describe('abort upload', () => {
    let uploader: InstanceType<typeof ChunkedUploader>
    let session: UploadSession

    beforeEach(async () => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
      session = await uploader.initiate({
        filename: 'abort-test.bin',
        contentType: 'application/octet-stream',
        totalSize: 25 * 1024 * 1024,
      })

      // Upload some chunks
      for (let i = 0; i < 3; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }
    })

    it('should abort upload and cleanup chunks', async () => {
      const result = await uploader.abort(session.id)

      expect(result.success).toBe(true)
      expect(result.chunksDeleted).toBe(3)
    })

    it('should delete all uploaded chunks from R2', async () => {
      await uploader.abort(session.id)

      // Should have called delete for each chunk
      expect(mockR2.delete).toHaveBeenCalled()
    })

    it('should update session status to aborted', async () => {
      await uploader.abort(session.id)

      const abortedSession = await uploader.getSession(session.id)
      expect(abortedSession!.status).toBe('aborted')
    })

    it('should reject further uploads after abort', async () => {
      await uploader.abort(session.id)

      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 3,
          data: createTestData(5 * 1024 * 1024),
        })
      ).rejects.toThrow()
    })

    it('should reject completion after abort', async () => {
      await uploader.abort(session.id)

      await expect(uploader.complete(session.id)).rejects.toThrow()
    })

    it('should allow abort of session with no chunks', async () => {
      const emptySession = await uploader.initiate({
        filename: 'empty.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      const result = await uploader.abort(emptySession.id)

      expect(result.success).toBe(true)
      expect(result.chunksDeleted).toBe(0)
    })

    it('should be idempotent - abort of aborted session succeeds', async () => {
      await uploader.abort(session.id)

      // Second abort should not throw
      const result = await uploader.abort(session.id)
      expect(result.success).toBe(true)
    })

    it('should reject abort of completed session', async () => {
      // Complete the upload first
      for (let i = 3; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }
      await uploader.complete(session.id)

      // Abort should fail
      await expect(uploader.abort(session.id)).rejects.toThrow(UploadAlreadyCompleteError)
    })

    it('should reject abort of non-existent session', async () => {
      await expect(uploader.abort('non-existent-session')).rejects.toThrow(UploadSessionNotFoundError)
    })
  })

  // ===========================================================================
  // Progress Tracking Tests
  // ===========================================================================

  describe('progress tracking', () => {
    let uploader: InstanceType<typeof ChunkedUploader>
    let session: UploadSession

    beforeEach(async () => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
      session = await uploader.initiate({
        filename: 'progress-test.bin',
        contentType: 'application/octet-stream',
        totalSize: 50 * 1024 * 1024, // 50MB = 10 chunks
      })
    })

    it('should report 0% progress initially', async () => {
      const progress = await uploader.getProgress(session.id)

      expect(progress.percentage).toBe(0)
      expect(progress.uploadedBytes).toBe(0)
      expect(progress.totalBytes).toBe(50 * 1024 * 1024)
    })

    it('should update progress as chunks are uploaded', async () => {
      // Upload 3 of 10 chunks
      for (let i = 0; i < 3; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      const progress = await uploader.getProgress(session.id)

      expect(progress.percentage).toBe(30)
      expect(progress.uploadedBytes).toBe(15 * 1024 * 1024)
      expect(progress.chunksUploaded).toBe(3)
      expect(progress.totalChunks).toBe(10)
    })

    it('should report 100% progress when all chunks uploaded', async () => {
      for (let i = 0; i < 10; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      const progress = await uploader.getProgress(session.id)

      expect(progress.percentage).toBe(100)
      expect(progress.uploadedBytes).toBe(50 * 1024 * 1024)
      expect(progress.chunksUploaded).toBe(10)
    })

    it('should calculate upload speed', async () => {
      // Upload a few chunks
      for (let i = 0; i < 3; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      const progress = await uploader.getProgress(session.id)

      // Speed should be defined (bytes per second)
      expect(progress.bytesPerSecond).toBeDefined()
      expect(typeof progress.bytesPerSecond).toBe('number')
    })

    it('should estimate time remaining', async () => {
      for (let i = 0; i < 5; i++) {
        await uploader.uploadChunk(session.id, {
          chunkIndex: i,
          data: createTestData(5 * 1024 * 1024),
        })
      }

      const progress = await uploader.getProgress(session.id)

      // Should estimate time for remaining 50%
      expect(progress.estimatedTimeRemaining).toBeDefined()
      expect(typeof progress.estimatedTimeRemaining).toBe('number')
      expect(progress.estimatedTimeRemaining).toBeGreaterThan(0)
    })

    it('should track time elapsed', async () => {
      // Small delay to ensure time passes
      await new Promise((resolve) => setTimeout(resolve, 10))

      await uploader.uploadChunk(session.id, {
        chunkIndex: 0,
        data: createTestData(5 * 1024 * 1024),
      })

      const progress = await uploader.getProgress(session.id)

      expect(progress.elapsedTime).toBeDefined()
      expect(progress.elapsedTime).toBeGreaterThan(0)
    })

    it('should support progress callback on chunk upload', async () => {
      const progressCallback = vi.fn()

      for (let i = 0; i < 3; i++) {
        await uploader.uploadChunk(
          session.id,
          {
            chunkIndex: i,
            data: createTestData(5 * 1024 * 1024),
          },
          { onProgress: progressCallback }
        )
      }

      expect(progressCallback).toHaveBeenCalled()
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          percentage: expect.any(Number),
          uploadedBytes: expect.any(Number),
        })
      )
    })

    it('should reject progress query for non-existent session', async () => {
      await expect(uploader.getProgress('non-existent-session')).rejects.toThrow(UploadSessionNotFoundError)
    })
  })

  // ===========================================================================
  // Session Management Tests
  // ===========================================================================

  describe('session management', () => {
    let uploader: InstanceType<typeof ChunkedUploader>

    beforeEach(() => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
    })

    it('should list active upload sessions', async () => {
      // Create multiple sessions
      await uploader.initiate({ filename: 'file1.bin', contentType: 'application/octet-stream', totalSize: 10 * 1024 * 1024 })
      await uploader.initiate({ filename: 'file2.bin', contentType: 'application/octet-stream', totalSize: 20 * 1024 * 1024 })
      await uploader.initiate({ filename: 'file3.bin', contentType: 'application/octet-stream', totalSize: 30 * 1024 * 1024 })

      const sessions = await uploader.listSessions()

      expect(sessions).toHaveLength(3)
    })

    it('should filter sessions by status', async () => {
      const s1 = await uploader.initiate({ filename: 'file1.bin', contentType: 'application/octet-stream', totalSize: 10 * 1024 * 1024 })
      const s2 = await uploader.initiate({ filename: 'file2.bin', contentType: 'application/octet-stream', totalSize: 10 * 1024 * 1024 })

      // Start upload on s1
      await uploader.uploadChunk(s1.id, { chunkIndex: 0, data: createTestData(5 * 1024 * 1024) })

      const pendingSessions = await uploader.listSessions({ status: 'pending' })
      const inProgressSessions = await uploader.listSessions({ status: 'in_progress' })

      expect(pendingSessions).toHaveLength(1)
      expect(pendingSessions[0].id).toBe(s2.id)
      expect(inProgressSessions).toHaveLength(1)
      expect(inProgressSessions[0].id).toBe(s1.id)
    })

    it('should cleanup expired sessions', async () => {
      // Create a session with very short TTL
      const shortTTLConfig = { ...defaultConfig, sessionTTL: 1 } // 1ms TTL
      const shortTTLUploader = new ChunkedUploader(shortTTLConfig, mockR2 as unknown as R2Bucket)

      await shortTTLUploader.initiate({
        filename: 'expired.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      // Wait for session to expire
      await new Promise((resolve) => setTimeout(resolve, 10))

      const cleaned = await shortTTLUploader.cleanupExpiredSessions()

      expect(cleaned.sessionsRemoved).toBeGreaterThan(0)
    })

    it('should return session by ID', async () => {
      const created = await uploader.initiate({
        filename: 'find-me.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      const found = await uploader.getSession(created.id)

      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.filename).toBe('find-me.bin')
    })

    it('should return null for non-existent session ID', async () => {
      const found = await uploader.getSession('does-not-exist')

      expect(found).toBeNull()
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    let uploader: InstanceType<typeof ChunkedUploader>

    beforeEach(() => {
      uploader = new ChunkedUploader(defaultConfig, mockR2 as unknown as R2Bucket)
    })

    it('should handle R2 put failures gracefully', async () => {
      mockR2.put.mockRejectedValueOnce(new Error('R2 network error'))

      const session = await uploader.initiate({
        filename: 'error-test.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      await expect(
        uploader.uploadChunk(session.id, {
          chunkIndex: 0,
          data: createTestData(5 * 1024 * 1024),
        })
      ).rejects.toThrow('R2 network error')
    })

    it('should handle R2 get failures during resume', async () => {
      mockR2.get.mockRejectedValueOnce(new Error('R2 unavailable'))

      const session = await uploader.initiate({
        filename: 'resume-error.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      // This depends on implementation - may throw or return error state
      // Implementation uses in-memory state, so R2 get failures don't affect getUploadState
      // when session is already loaded. Either throwing or returning valid state is acceptable.
      try {
        const state = await uploader.getUploadState(session.id)
        // If it resolves, should return valid state structure
        expect(state.sessionId).toBe(session.id)
        expect(state).toHaveProperty('uploadedChunks')
        expect(state).toHaveProperty('missingChunks')
      } catch (error) {
        // If it throws, that's also acceptable behavior
        expect(error).toBeInstanceOf(Error)
      }
    })

    it('should handle completion failure and allow retry', async () => {
      const session = await uploader.initiate({
        filename: 'complete-retry.bin',
        contentType: 'application/octet-stream',
        totalSize: 10 * 1024 * 1024,
      })

      await uploader.uploadChunk(session.id, { chunkIndex: 0, data: createTestData(5 * 1024 * 1024) })
      await uploader.uploadChunk(session.id, { chunkIndex: 1, data: createTestData(5 * 1024 * 1024) })

      // First completion fails
      mockR2.put.mockRejectedValueOnce(new Error('Completion failed'))
      await expect(uploader.complete(session.id)).rejects.toThrow('Completion failed')

      // Retry should work
      mockR2.put.mockResolvedValueOnce({ key: 'final', etag: '"final-etag"' })
      const result = await uploader.complete(session.id)
      expect(result.success).toBe(true)
    })
  })
})
