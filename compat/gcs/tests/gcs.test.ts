/**
 * @dotdo/gcs - Google Cloud Storage SDK Compat Layer Tests
 *
 * Comprehensive tests for @google-cloud/storage compatible API
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  // Main classes
  Storage,
  Bucket,
  File,

  // Errors
  ApiError,
  BucketNotFoundError,
  BucketAlreadyExistsError,
  BucketNotEmptyError,
  FileNotFoundError,
  validateBucketName,
  InvalidBucketNameError,

  // Backend
  MemoryBackend,
  setDefaultBackend,

  // ACL & IAM
  BucketAcl,
  FileAcl,
  BucketIam,
  ACL_ENTITIES,
  ACL_ROLES,
  parseEntity,
  formatEntity,
  expandPredefinedBucketAcl,

  // Lifecycle
  LifecycleBuilder,
  LifecycleEvaluator,
  LifecycleManager,
  LifecycleTemplates,

  // Notifications
  NotificationBuilder,
  NotificationManager,
  createNotificationEvent,
  createPubSubMessage,
  parsePubSubMessage,

  // Signed URLs
  generateSignedUrl,
  validateSignedUrl,

  // Test utilities
  _clearAll,
  _getBuckets,
} from '../index'

import type {
  StorageOptions,
  CreateBucketOptions,
  GetFilesOptions,
  SignedUrlConfig,
  CreateResumableUploadOptions,
  SaveOptions,
  LifecycleRule,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/gcs - GCS SDK Compat Layer', () => {
  let storage: Storage

  beforeEach(() => {
    // Reset to fresh memory backend
    const backend = new MemoryBackend()
    setDefaultBackend(backend)
    storage = new Storage({ projectId: 'test-project' })
  })

  // ===========================================================================
  // Storage Class Tests
  // ===========================================================================

  describe('Storage', () => {
    it('should export Storage class', () => {
      expect(Storage).toBeDefined()
      expect(typeof Storage).toBe('function')
    })

    it('should create storage instance with default config', () => {
      const storage = new Storage()
      expect(storage).toBeInstanceOf(Storage)
    })

    it('should create storage instance with project ID', () => {
      const storage = new Storage({ projectId: 'my-project' })
      expect(storage).toBeInstanceOf(Storage)
      expect(storage.projectId).toBe('my-project')
    })

    it('should create storage instance with credentials', () => {
      const storage = new Storage({
        projectId: 'my-project',
        credentials: {
          client_email: 'test@project.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
        },
      })
      expect(storage).toBeInstanceOf(Storage)
    })

    it('should create storage instance with keyFilename', () => {
      const storage = new Storage({
        projectId: 'my-project',
        keyFilename: '/path/to/service-account.json',
      })
      expect(storage).toBeInstanceOf(Storage)
    })
  })

  // ===========================================================================
  // Bucket Operations Tests
  // ===========================================================================

  describe('Bucket Operations', () => {
    describe('createBucket', () => {
      it('should create a new bucket', async () => {
        const [bucket, metadata] = await storage.createBucket('my-test-bucket')
        expect(bucket).toBeInstanceOf(Bucket)
        expect(bucket.name).toBe('my-test-bucket')
        expect(metadata).toBeDefined()
      })

      it('should create bucket with location option', async () => {
        const [bucket] = await storage.createBucket('regional-bucket', {
          location: 'US-CENTRAL1',
        })
        expect(bucket.name).toBe('regional-bucket')
      })

      it('should create bucket with storage class', async () => {
        const [bucket, metadata] = await storage.createBucket('nearline-bucket', {
          storageClass: 'NEARLINE',
        })
        expect(bucket.name).toBe('nearline-bucket')
        expect(metadata.storageClass).toBe('NEARLINE')
      })

      it('should throw error for duplicate bucket name', async () => {
        await storage.createBucket('existing-bucket')

        await expect(
          storage.createBucket('existing-bucket')
        ).rejects.toThrow(BucketAlreadyExistsError)
      })

      it('should create bucket with versioning enabled', async () => {
        const [bucket, metadata] = await storage.createBucket('versioned-bucket', {
          versioning: { enabled: true },
        })
        expect(metadata.versioning?.enabled).toBe(true)
      })

      it('should create bucket with labels', async () => {
        const [bucket, metadata] = await storage.createBucket('labeled-bucket', {
          labels: { env: 'test', team: 'platform' },
        })
        expect(metadata.labels?.env).toBe('test')
        expect(metadata.labels?.team).toBe('platform')
      })
    })

    describe('bucket', () => {
      it('should return a Bucket reference', () => {
        const bucket = storage.bucket('my-bucket')
        expect(bucket).toBeInstanceOf(Bucket)
        expect(bucket.name).toBe('my-bucket')
      })

      it('should return same Bucket for same name', () => {
        const bucket1 = storage.bucket('my-bucket')
        const bucket2 = storage.bucket('my-bucket')
        expect(bucket1.name).toBe(bucket2.name)
      })
    })

    describe('getBuckets', () => {
      it('should list all buckets', async () => {
        await storage.createBucket('bucket-1')
        await storage.createBucket('bucket-2')
        await storage.createBucket('bucket-3')

        const [buckets] = await storage.getBuckets()
        expect(buckets).toHaveLength(3)
        expect(buckets[0]).toBeInstanceOf(Bucket)
      })

      it('should return empty array when no buckets exist', async () => {
        const [buckets] = await storage.getBuckets()
        expect(buckets).toEqual([])
      })

      it('should filter buckets by prefix', async () => {
        await storage.createBucket('prod-bucket-1')
        await storage.createBucket('prod-bucket-2')
        await storage.createBucket('dev-bucket')

        const [buckets] = await storage.getBuckets({ prefix: 'prod-' })
        expect(buckets).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Bucket Class Tests
  // ===========================================================================

  describe('Bucket Class', () => {
    let bucket: Bucket

    beforeEach(async () => {
      const [b] = await storage.createBucket('test-bucket')
      bucket = b
    })

    describe('exists', () => {
      it('should return true for existing bucket', async () => {
        const [exists] = await bucket.exists()
        expect(exists).toBe(true)
      })

      it('should return false for non-existing bucket', async () => {
        const nonExistentBucket = storage.bucket('non-existent')
        const [exists] = await nonExistentBucket.exists()
        expect(exists).toBe(false)
      })
    })

    describe('delete', () => {
      it('should delete an empty bucket', async () => {
        await bucket.delete()
        const [exists] = await bucket.exists()
        expect(exists).toBe(false)
      })

      it('should throw error for non-empty bucket', async () => {
        const file = bucket.file('test.txt')
        await file.save('Hello')

        await expect(bucket.delete()).rejects.toThrow(BucketNotEmptyError)
      })
    })

    describe('getMetadata', () => {
      it('should return bucket metadata', async () => {
        const [metadata] = await bucket.getMetadata()
        expect(metadata.name).toBe('test-bucket')
        expect(metadata.id).toBeDefined()
        expect(metadata.timeCreated).toBeDefined()
      })
    })

    describe('file', () => {
      it('should return a File reference', () => {
        const file = bucket.file('my-file.txt')
        expect(file).toBeInstanceOf(File)
        expect(file.name).toBe('my-file.txt')
      })
    })

    describe('getFiles', () => {
      beforeEach(async () => {
        await bucket.file('folder1/file1.txt').save('1')
        await bucket.file('folder1/file2.txt').save('2')
        await bucket.file('folder2/file1.txt').save('3')
        await bucket.file('root.txt').save('4')
      })

      it('should list all files', async () => {
        const [files] = await bucket.getFiles()
        expect(files).toHaveLength(4)
        expect(files[0]).toBeInstanceOf(File)
      })

      it('should filter by prefix', async () => {
        const [files] = await bucket.getFiles({ prefix: 'folder1/' })
        expect(files).toHaveLength(2)
        expect(files.every(f => f.name.startsWith('folder1/'))).toBe(true)
      })

      it('should use delimiter for folder simulation', async () => {
        const [files, , apiResponse] = await bucket.getFiles({ delimiter: '/' })
        expect(files).toHaveLength(1) // root.txt only
        expect(apiResponse.prefixes).toHaveLength(2) // folder1/, folder2/
      })

      it('should paginate with maxResults', async () => {
        const [files, nextQuery] = await bucket.getFiles({ maxResults: 2 })
        expect(files).toHaveLength(2)
        expect(nextQuery).toBeDefined()

        const [moreFiles] = await bucket.getFiles(nextQuery!)
        expect(moreFiles).toHaveLength(2)
      })

      it('should support autoPaginate: false', async () => {
        const [files, nextQuery] = await bucket.getFiles({
          maxResults: 2,
          autoPaginate: false,
        })
        expect(files).toHaveLength(2)
        expect(nextQuery).toBeDefined()
      })
    })

    describe('upload', () => {
      it('should upload a file from path (simulated)', async () => {
        const [file] = await bucket.upload('/path/to/local/file.txt', {
          destination: 'uploaded.txt',
        })
        expect(file).toBeInstanceOf(File)
        expect(file.name).toBe('uploaded.txt')
      })
    })
  })

  // ===========================================================================
  // File Class Tests
  // ===========================================================================

  describe('File Class', () => {
    let bucket: Bucket
    let file: File

    beforeEach(async () => {
      const [b] = await storage.createBucket('file-test-bucket')
      bucket = b
      file = bucket.file('test-file.txt')
    })

    describe('save', () => {
      it('should save string content', async () => {
        await file.save('Hello World')
        const [exists] = await file.exists()
        expect(exists).toBe(true)
      })

      it('should save Buffer content', async () => {
        await file.save(new Uint8Array([72, 101, 108, 108, 111]))
        const [exists] = await file.exists()
        expect(exists).toBe(true)
      })

      it('should save with content type', async () => {
        await file.save('{"key": "value"}', { contentType: 'application/json' })
        const [metadata] = await file.getMetadata()
        expect(metadata.contentType).toBe('application/json')
      })

      it('should save with custom metadata', async () => {
        await file.save('test', {
          metadata: { customKey: 'customValue' },
        })
        const [metadata] = await file.getMetadata()
        expect(metadata.metadata?.customKey).toBe('customValue')
      })
    })

    describe('download', () => {
      beforeEach(async () => {
        await file.save('Hello World', { contentType: 'text/plain' })
      })

      it('should download file content', async () => {
        const [content] = await file.download()
        expect(content.toString()).toBe('Hello World')
      })

      it('should throw error for non-existent file', async () => {
        const nonExistent = bucket.file('non-existent.txt')
        await expect(nonExistent.download()).rejects.toThrow(FileNotFoundError)
      })
    })

    describe('exists', () => {
      it('should return true for existing file', async () => {
        await file.save('test')
        const [exists] = await file.exists()
        expect(exists).toBe(true)
      })

      it('should return false for non-existing file', async () => {
        const [exists] = await file.exists()
        expect(exists).toBe(false)
      })
    })

    describe('delete', () => {
      it('should delete a file', async () => {
        await file.save('test')
        await file.delete()
        const [exists] = await file.exists()
        expect(exists).toBe(false)
      })

      it('should succeed for non-existent file (idempotent)', async () => {
        await expect(file.delete()).resolves.not.toThrow()
      })
    })

    describe('copy', () => {
      beforeEach(async () => {
        await file.save('Source content', { contentType: 'text/plain' })
      })

      it('should copy file within same bucket', async () => {
        const destination = bucket.file('copied.txt')
        const [copiedFile] = await file.copy(destination)
        expect(copiedFile).toBeInstanceOf(File)
        expect(copiedFile.name).toBe('copied.txt')

        const [content] = await copiedFile.download()
        expect(content.toString()).toBe('Source content')
      })

      it('should copy file to different bucket', async () => {
        const [destBucket] = await storage.createBucket('dest-bucket')
        const destination = destBucket.file('copied.txt')
        const [copiedFile] = await file.copy(destination)
        expect(copiedFile.name).toBe('copied.txt')
      })

      it('should copy file using string destination', async () => {
        const [copiedFile] = await file.copy('copied-string.txt')
        expect(copiedFile.name).toBe('copied-string.txt')
      })
    })

    describe('move', () => {
      beforeEach(async () => {
        await file.save('Source content')
      })

      it('should move file within same bucket', async () => {
        const destination = bucket.file('moved.txt')
        const [movedFile] = await file.move(destination)
        expect(movedFile.name).toBe('moved.txt')

        // Original should no longer exist
        const [exists] = await file.exists()
        expect(exists).toBe(false)
      })

      it('should move file using string destination', async () => {
        const [movedFile] = await file.move('moved-string.txt')
        expect(movedFile.name).toBe('moved-string.txt')
      })
    })

    describe('getMetadata', () => {
      beforeEach(async () => {
        await file.save('Test content', {
          contentType: 'text/plain',
          metadata: { customKey: 'customValue' },
        })
      })

      it('should return file metadata', async () => {
        const [metadata] = await file.getMetadata()
        expect(metadata.name).toBe('test-file.txt')
        expect(metadata.size).toBe('12') // 'Test content'.length
        expect(metadata.contentType).toBe('text/plain')
        expect(metadata.timeCreated).toBeDefined()
        expect(metadata.updated).toBeDefined()
      })

      it('should return custom metadata', async () => {
        const [metadata] = await file.getMetadata()
        expect(metadata.metadata?.customKey).toBe('customValue')
      })

      it('should throw error for non-existent file', async () => {
        const nonExistent = bucket.file('non-existent.txt')
        await expect(nonExistent.getMetadata()).rejects.toThrow(FileNotFoundError)
      })
    })

    describe('setMetadata', () => {
      beforeEach(async () => {
        await file.save('test', { contentType: 'text/plain' })
      })

      it('should update metadata', async () => {
        await file.setMetadata({ cacheControl: 'public, max-age=3600' })
        const [metadata] = await file.getMetadata()
        expect(metadata.cacheControl).toBe('public, max-age=3600')
      })

      it('should update custom metadata', async () => {
        await file.setMetadata({ metadata: { newKey: 'newValue' } })
        const [metadata] = await file.getMetadata()
        expect(metadata.metadata?.newKey).toBe('newValue')
      })

      it('should update content type', async () => {
        await file.setMetadata({ contentType: 'application/json' })
        const [metadata] = await file.getMetadata()
        expect(metadata.contentType).toBe('application/json')
      })
    })

    describe('createReadStream', () => {
      beforeEach(async () => {
        await file.save('Streaming content for testing')
      })

      it('should return a ReadableStream', () => {
        const stream = file.createReadStream()
        expect(stream).toBeInstanceOf(ReadableStream)
      })

      it('should stream file content', async () => {
        const stream = file.createReadStream()
        const reader = stream.getReader()
        const chunks: Uint8Array[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }

        const content = new TextDecoder().decode(
          new Uint8Array(chunks.flatMap(c => Array.from(c)))
        )
        expect(content).toBe('Streaming content for testing')
      })
    })

    describe('createWriteStream', () => {
      it('should return a WritableStream', () => {
        const stream = file.createWriteStream()
        expect(stream).toBeInstanceOf(WritableStream)
      })

      it('should write streaming content', async () => {
        const stream = file.createWriteStream({ contentType: 'text/plain' })
        const writer = stream.getWriter()
        await writer.write(new TextEncoder().encode('Hello '))
        await writer.write(new TextEncoder().encode('World'))
        await writer.close()

        const [content] = await file.download()
        expect(content.toString()).toBe('Hello World')
      })
    })
  })

  // ===========================================================================
  // Signed URL Tests
  // ===========================================================================

  describe('Signed URLs', () => {
    let bucket: Bucket
    let file: File

    beforeEach(async () => {
      const [b] = await storage.createBucket('signed-url-bucket')
      bucket = b
      file = bucket.file('test-file.txt')
      await file.save('Hello World', { contentType: 'text/plain' })
    })

    describe('getSignedUrl', () => {
      it('should generate a signed read URL', async () => {
        const [url] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
        })

        expect(url).toBeDefined()
        expect(typeof url).toBe('string')
        expect(url).toContain('signed-url-bucket')
        expect(url).toContain('test-file.txt')
      })

      it('should generate a signed write URL', async () => {
        const [url] = await file.getSignedUrl({
          action: 'write',
          expires: Date.now() + 15 * 60 * 1000,
          contentType: 'text/plain',
        })

        expect(url).toBeDefined()
      })

      it('should generate a signed delete URL', async () => {
        const [url] = await file.getSignedUrl({
          action: 'delete',
          expires: Date.now() + 15 * 60 * 1000,
        })

        expect(url).toBeDefined()
      })

      it('should accept Date object for expires', async () => {
        const expires = new Date(Date.now() + 60 * 60 * 1000)
        const [url] = await file.getSignedUrl({
          action: 'read',
          expires,
        })

        expect(url).toBeDefined()
        expect(url).toContain('X-Goog-Expires')
      })

      it('should accept version: v4', async () => {
        const [url] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
        })

        expect(url).toBeDefined()
        expect(url).toContain('X-Goog-Algorithm')
        expect(url).toContain('X-Goog-Signature')
      })

      it('should include response-content-disposition', async () => {
        const [url] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
          responseDisposition: 'attachment; filename="download.txt"',
        })

        expect(url).toContain('response-content-disposition')
      })

      it('should throw for expired timestamp', async () => {
        await expect(
          file.getSignedUrl({
            action: 'read',
            expires: Date.now() - 1000, // Already expired
          })
        ).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // Resumable Upload Tests
  // ===========================================================================

  describe('Resumable Uploads', () => {
    let bucket: Bucket
    let file: File

    beforeEach(async () => {
      const [b] = await storage.createBucket('resumable-bucket')
      bucket = b
      file = bucket.file('large-file.bin')
    })

    describe('createResumableUpload', () => {
      it('should initiate a resumable upload', async () => {
        const [uri] = await file.createResumableUpload({
          contentType: 'application/octet-stream',
        })

        expect(uri).toBeDefined()
        expect(typeof uri).toBe('string')
        expect(uri).toContain('upload_id')
      })

      it('should accept origin for CORS', async () => {
        const [uri] = await file.createResumableUpload({
          origin: 'https://example.com',
        })

        expect(uri).toBeDefined()
      })

      it('should accept metadata', async () => {
        const [uri] = await file.createResumableUpload({
          metadata: { customKey: 'customValue' },
        })

        expect(uri).toBeDefined()
      })
    })

    describe('resumable upload flow', () => {
      it('should complete a resumable upload', async () => {
        // Step 1: Initiate
        const [uploadUri] = await file.createResumableUpload({
          contentType: 'application/octet-stream',
        })

        // Step 2: Upload chunks
        const chunk1 = new Uint8Array(1024).fill(65) // 1KB of 'A'
        const chunk2 = new Uint8Array(1024).fill(66) // 1KB of 'B'

        await file.resumableUpload(uploadUri, chunk1, { offset: 0, isPartial: true })
        await file.resumableUpload(uploadUri, chunk2, { offset: 1024, isPartial: false })

        // Step 3: Verify
        const [exists] = await file.exists()
        expect(exists).toBe(true)

        const [metadata] = await file.getMetadata()
        expect(parseInt(metadata.size as string)).toBe(2048)
      })

      it('should resume an interrupted upload', async () => {
        const [uploadUri] = await file.createResumableUpload()

        // Upload first chunk
        const chunk1 = new Uint8Array(1024).fill(65)
        await file.resumableUpload(uploadUri, chunk1, { offset: 0, isPartial: true })

        // Check resumable offset
        const offset = await file.getResumableOffset(uploadUri)
        expect(offset).toBe(1024)

        // Resume upload
        const chunk2 = new Uint8Array(512).fill(66)
        await file.resumableUpload(uploadUri, chunk2, { offset: 1024, isPartial: false })

        const [metadata] = await file.getMetadata()
        expect(parseInt(metadata.size as string)).toBe(1536)
      })

      it('should cancel a resumable upload', async () => {
        const [uploadUri] = await file.createResumableUpload()

        await file.cancelResumableUpload(uploadUri)

        // Further uploads should fail
        await expect(
          file.resumableUpload(uploadUri, new Uint8Array(1024), { offset: 0 })
        ).rejects.toThrow(ApiError)
      })
    })
  })

  // ===========================================================================
  // Error Classes Tests
  // ===========================================================================

  describe('Error Classes', () => {
    it('should export ApiError', () => {
      expect(ApiError).toBeDefined()
    })

    it('should create ApiError with code and message', () => {
      const error = new ApiError({ code: 404, message: 'Not Found' })
      expect(error.code).toBe(404)
      expect(error.message).toBe('Not Found')
    })

    it('should create ApiError with errors array', () => {
      const error = new ApiError({
        code: 400,
        message: 'Bad Request',
        errors: [{ reason: 'invalid', message: 'Invalid parameter' }],
      })
      expect(error.errors).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Bucket Name Validation Tests
  // ===========================================================================

  describe('Bucket Name Validation', () => {
    it('should validate correct bucket names', () => {
      expect(validateBucketName('valid-bucket-name')).toBe(true)
      expect(validateBucketName('bucket123')).toBe(true)
      expect(validateBucketName('my.bucket.name')).toBe(true)
    })

    it('should reject bucket names that are too short', () => {
      expect(() => validateBucketName('ab')).toThrow(InvalidBucketNameError)
    })

    it('should reject bucket names that are too long', () => {
      expect(() => validateBucketName('a'.repeat(64))).toThrow(InvalidBucketNameError)
    })

    it('should reject bucket names with consecutive periods', () => {
      expect(() => validateBucketName('bucket..name')).toThrow(InvalidBucketNameError)
    })

    it('should reject bucket names formatted as IP addresses', () => {
      expect(() => validateBucketName('192.168.1.1')).toThrow(InvalidBucketNameError)
    })

    it('should reject bucket names starting with goog', () => {
      expect(() => validateBucketName('googlebucket')).toThrow(InvalidBucketNameError)
    })
  })

  // ===========================================================================
  // Lifecycle Builder Tests
  // ===========================================================================

  describe('Lifecycle Builder', () => {
    it('should build delete rules', () => {
      const rules = new LifecycleBuilder()
        .deleteOlderThan(30)
        .build()

      expect(rules).toHaveLength(1)
      expect(rules[0].action.type).toBe('Delete')
      expect(rules[0].condition.age).toBe(30)
    })

    it('should build transition rules', () => {
      const rules = new LifecycleBuilder()
        .transitionToNearline(7)
        .transitionToColdline(30)
        .transitionToArchive(90)
        .build()

      expect(rules).toHaveLength(3)
      expect(rules[0].action.storageClass).toBe('NEARLINE')
      expect(rules[1].action.storageClass).toBe('COLDLINE')
      expect(rules[2].action.storageClass).toBe('ARCHIVE')
    })

    it('should build prefix-filtered rules', () => {
      const rules = new LifecycleBuilder()
        .deleteByPrefix('logs/', 7)
        .build()

      expect(rules[0].condition.matchesPrefix).toContain('logs/')
    })

    it('should build version cleanup rules', () => {
      const rules = new LifecycleBuilder()
        .keepNewestVersions(3)
        .build()

      expect(rules[0].condition.numNewerVersions).toBe(3)
    })

    it('should use lifecycle templates', () => {
      const rules = LifecycleTemplates.tieredStorage({
        nearlineAfterDays: 7,
        coldlineAfterDays: 30,
      })

      expect(rules.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // Lifecycle Evaluator Tests
  // ===========================================================================

  describe('Lifecycle Evaluator', () => {
    it('should evaluate age condition', () => {
      const rules: LifecycleRule[] = [
        { action: { type: 'Delete' }, condition: { age: 1 } }
      ]
      const evaluator = new LifecycleEvaluator(rules)

      // File created 2 days ago
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const file = {
        name: 'old-file.txt',
        bucket: 'test',
        body: new Uint8Array(0),
        metadata: { timeCreated: oldDate },
      }

      expect(evaluator.shouldDelete(file)).toBe(true)
    })

    it('should evaluate prefix condition', () => {
      const rules: LifecycleRule[] = [
        { action: { type: 'Delete' }, condition: { matchesPrefix: ['logs/'] } }
      ]
      const evaluator = new LifecycleEvaluator(rules)

      const matchingFile = {
        name: 'logs/app.log',
        bucket: 'test',
        body: new Uint8Array(0),
        metadata: {},
      }

      const nonMatchingFile = {
        name: 'data/file.txt',
        bucket: 'test',
        body: new Uint8Array(0),
        metadata: {},
      }

      expect(evaluator.shouldDelete(matchingFile)).toBe(true)
      expect(evaluator.shouldDelete(nonMatchingFile)).toBe(false)
    })
  })

  // ===========================================================================
  // Notification Builder Tests
  // ===========================================================================

  describe('Notification Builder', () => {
    it('should build notification config', () => {
      const config = new NotificationBuilder()
        .topic('projects/my-project/topics/my-topic')
        .onObjectFinalize()
        .onObjectDelete()
        .withPrefix('uploads/')
        .build()

      expect(config.topic).toBe('projects/my-project/topics/my-topic')
      expect(config.eventTypes).toContain('OBJECT_FINALIZE')
      expect(config.eventTypes).toContain('OBJECT_DELETE')
      expect(config.objectNamePrefix).toBe('uploads/')
    })

    it('should build config for all events', () => {
      const config = new NotificationBuilder()
        .topic('projects/my-project/topics/my-topic')
        .onAllEvents()
        .build()

      expect(config.eventTypes).toHaveLength(4)
    })

    it('should throw without topic', () => {
      expect(() => new NotificationBuilder().build()).toThrow()
    })
  })

  // ===========================================================================
  // Notification Event Tests
  // ===========================================================================

  describe('Notification Events', () => {
    it('should create notification event', () => {
      const event = createNotificationEvent(
        'my-bucket',
        'my-file.txt',
        'OBJECT_FINALIZE',
        {
          size: '1024',
          contentType: 'text/plain',
        }
      )

      expect(event.kind).toBe('storage#object')
      expect(event.bucket).toBe('my-bucket')
      expect(event.name).toBe('my-file.txt')
      expect(event.eventType).toBe('OBJECT_FINALIZE')
    })

    it('should create and parse Pub/Sub message', () => {
      const event = createNotificationEvent(
        'my-bucket',
        'my-file.txt',
        'OBJECT_FINALIZE',
        {}
      )

      const notification = {
        id: '123',
        topic: 'projects/my-project/topics/my-topic',
        payloadFormat: 'JSON_API_V1' as const,
      }

      const message = createPubSubMessage(event, notification)
      expect(message.attributes.bucketId).toBe('my-bucket')
      expect(message.attributes.objectId).toBe('my-file.txt')

      const parsed = parsePubSubMessage(message)
      expect(parsed?.bucket).toBe('my-bucket')
      expect(parsed?.name).toBe('my-file.txt')
    })
  })

  // ===========================================================================
  // ACL Tests
  // ===========================================================================

  describe('ACL', () => {
    it('should parse entity strings', () => {
      expect(parseEntity('user-test@example.com')).toEqual({
        type: 'user',
        identifier: 'test@example.com',
      })
      expect(parseEntity('group-team@example.com')).toEqual({
        type: 'group',
        identifier: 'team@example.com',
      })
      expect(parseEntity('allUsers')).toEqual({ type: 'allUsers' })
    })

    it('should format entity strings', () => {
      expect(formatEntity('user', 'test@example.com')).toBe('user-test@example.com')
      expect(formatEntity('allUsers')).toBe('allUsers')
    })

    it('should expand predefined bucket ACL', () => {
      const acl = expandPredefinedBucketAcl('publicRead', 'my-project')
      expect(acl.some(e => e.entity === 'allUsers' && e.role === 'READER')).toBe(true)
    })

    it('should export ACL constants', () => {
      expect(ACL_ENTITIES.ALL_USERS).toBe('allUsers')
      expect(ACL_ROLES.OWNER).toBe('OWNER')
    })
  })

  // ===========================================================================
  // Signed URL Validation Tests
  // ===========================================================================

  describe('Signed URL Validation', () => {
    it('should validate signed URL structure', async () => {
      const [bucket] = await storage.createBucket('validation-bucket')
      const file = bucket.file('test.txt')
      await file.save('test')

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60000,
        version: 'v4',
      })

      const result = validateSignedUrl(url)
      expect(result.valid).toBe(true)
      expect(result.bucket).toBe('validation-bucket')
      expect(result.object).toBe('test.txt')
    })

    it('should detect expired URLs', () => {
      // A manually constructed expired URL
      const expiredUrl = 'https://storage.googleapis.com/bucket/file?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Date=20200101T000000Z&X-Goog-Expires=1&X-Goog-SignedHeaders=host&X-Goog-Signature=abc123'
      const result = validateSignedUrl(expiredUrl)
      expect(result.expired).toBe(true)
    })
  })

  // ===========================================================================
  // Test Utilities Tests
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
      await storage.createBucket('bucket-1')
      await storage.createBucket('bucket-2')

      _clearAll()

      const [buckets] = await storage.getBuckets()
      expect(buckets).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('Integration', () => {
    it('should perform complete file lifecycle', async () => {
      // Create bucket
      const [bucket] = await storage.createBucket('integration-bucket')

      // Upload file
      const file = bucket.file('lifecycle-test.txt')
      await file.save('Initial content', { contentType: 'text/plain' })

      // Read file
      const [content] = await file.download()
      expect(content.toString()).toBe('Initial content')

      // Update metadata
      await file.setMetadata({ cacheControl: 'no-cache' })

      // Copy file
      const [copiedFile] = await file.copy('copied-lifecycle.txt')

      // Delete original
      await file.delete()

      // Verify copy exists and original doesn't
      const [originalExists] = await file.exists()
      const [copyExists] = await copiedFile.exists()
      expect(originalExists).toBe(false)
      expect(copyExists).toBe(true)

      // Clean up
      await copiedFile.delete()
      await bucket.delete()
    })

    it('should handle concurrent operations', async () => {
      const [bucket] = await storage.createBucket('concurrent-bucket')

      // Upload multiple files concurrently
      const uploadPromises = Array.from({ length: 10 }, (_, i) =>
        bucket.file(`file-${i}.txt`).save(`Content ${i}`)
      )
      await Promise.all(uploadPromises)

      // List and verify
      const [files] = await bucket.getFiles()
      expect(files).toHaveLength(10)

      // Delete all concurrently
      const deletePromises = files.map(f => f.delete())
      await Promise.all(deletePromises)

      // Verify empty
      const [remainingFiles] = await bucket.getFiles()
      expect(remainingFiles).toHaveLength(0)
    })

    it('should handle nested folder structures', async () => {
      const [bucket] = await storage.createBucket('nested-bucket')

      // Create nested structure
      await bucket.file('a/b/c/file1.txt').save('1')
      await bucket.file('a/b/c/file2.txt').save('2')
      await bucket.file('a/b/file3.txt').save('3')
      await bucket.file('a/file4.txt').save('4')
      await bucket.file('file5.txt').save('5')

      // List at different levels
      const [rootFiles, , rootResponse] = await bucket.getFiles({ delimiter: '/' })
      expect(rootFiles).toHaveLength(1) // file5.txt
      expect(rootResponse.prefixes).toContain('a/')

      const [aFiles, , aResponse] = await bucket.getFiles({ prefix: 'a/', delimiter: '/' })
      expect(aFiles).toHaveLength(1) // file4.txt
      expect(aResponse.prefixes).toContain('a/b/')

      const [abcFiles] = await bucket.getFiles({ prefix: 'a/b/c/' })
      expect(abcFiles).toHaveLength(2)
    })
  })
})
