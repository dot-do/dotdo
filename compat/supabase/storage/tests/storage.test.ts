/**
 * @dotdo/supabase/storage - Comprehensive Test Suite
 *
 * Tests for Supabase Storage compat layer with NO MOCKS.
 * Uses in-memory backend for fast, reliable testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  StorageClient,
  StorageFileApi,
  _clearAll,
  createTestClient,
  MemoryBackend,
  getDefaultBackend,
  setDefaultBackend,
  resetToMemoryBackend,
  BucketNotFoundError,
  BucketAlreadyExistsError,
  BucketNotEmptyError,
  FileNotFoundError,
  FileAlreadyExistsError,
  InvalidFileTypeError,
  FileTooLargeError,
  InvalidPathError,
  InvalidBucketNameError,
  validateBucketName,
  validatePath,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('Supabase Storage Compat', () => {
  let client: StorageClient

  beforeEach(() => {
    resetToMemoryBackend()
    client = createTestClient()
  })

  afterEach(() => {
    _clearAll()
  })

  // ===========================================================================
  // Bucket Operations
  // ===========================================================================

  describe('Bucket Operations', () => {
    describe('createBucket', () => {
      it('should create a bucket with default options', async () => {
        const { data, error } = await client.createBucket('test-bucket')

        expect(error).toBeNull()
        expect(data).toEqual({ name: 'test-bucket' })
      })

      it('should create a public bucket', async () => {
        const { data, error } = await client.createBucket('public-bucket', { public: true })

        expect(error).toBeNull()
        expect(data).toEqual({ name: 'public-bucket' })

        const { data: bucket } = await client.getBucket('public-bucket')
        expect(bucket?.public).toBe(true)
      })

      it('should create a bucket with allowed MIME types', async () => {
        const allowedMimeTypes = ['image/png', 'image/jpeg']
        const { data, error } = await client.createBucket('images', { allowedMimeTypes })

        expect(error).toBeNull()
        expect(data).toEqual({ name: 'images' })

        const { data: bucket } = await client.getBucket('images')
        expect(bucket?.allowed_mime_types).toEqual(allowedMimeTypes)
      })

      it('should create a bucket with file size limit', async () => {
        const fileSizeLimit = 5 * 1024 * 1024 // 5MB
        const { data, error } = await client.createBucket('limited', { fileSizeLimit })

        expect(error).toBeNull()
        const { data: bucket } = await client.getBucket('limited')
        expect(bucket?.file_size_limit).toBe(fileSizeLimit)
      })

      it('should return error for duplicate bucket name', async () => {
        await client.createBucket('duplicate')
        const { data, error } = await client.createBucket('duplicate')

        expect(data).toBeNull()
        expect(error?.message).toContain('already exists')
      })

      it('should reject invalid bucket names - too short', async () => {
        const { error } = await client.createBucket('ab')

        expect(error?.message).toContain('Invalid bucket name')
      })

      it('should reject invalid bucket names - invalid characters', async () => {
        const { error } = await client.createBucket('Test_Bucket!')

        expect(error?.message).toContain('Invalid bucket name')
      })

      it('should reject bucket names starting with hyphen', async () => {
        const { error } = await client.createBucket('-invalid')

        expect(error?.message).toContain('Invalid bucket name')
      })

      it('should reject bucket names with consecutive hyphens', async () => {
        const { error } = await client.createBucket('test--bucket')

        expect(error?.message).toContain('Invalid bucket name')
      })
    })

    describe('getBucket', () => {
      it('should get an existing bucket', async () => {
        await client.createBucket('my-bucket', { public: true })
        const { data, error } = await client.getBucket('my-bucket')

        expect(error).toBeNull()
        expect(data?.name).toBe('my-bucket')
        expect(data?.public).toBe(true)
        expect(data?.created_at).toBeDefined()
        expect(data?.updated_at).toBeDefined()
      })

      it('should return error for non-existent bucket', async () => {
        const { data, error } = await client.getBucket('nonexistent')

        expect(data).toBeNull()
        expect(error?.message).toContain('not found')
      })
    })

    describe('listBuckets', () => {
      it('should list all buckets', async () => {
        await client.createBucket('bucket-1')
        await client.createBucket('bucket-2')
        await client.createBucket('bucket-3')

        const { data, error } = await client.listBuckets()

        expect(error).toBeNull()
        expect(data?.length).toBe(3)
        expect(data?.map((b) => b.name).sort()).toEqual(['bucket-1', 'bucket-2', 'bucket-3'])
      })

      it('should return empty array when no buckets exist', async () => {
        const { data, error } = await client.listBuckets()

        expect(error).toBeNull()
        expect(data).toEqual([])
      })
    })

    describe('updateBucket', () => {
      it('should update bucket public setting', async () => {
        await client.createBucket('private-bucket', { public: false })
        const { error } = await client.updateBucket('private-bucket', { public: true })

        expect(error).toBeNull()
        const { data } = await client.getBucket('private-bucket')
        expect(data?.public).toBe(true)
      })

      it('should update allowed MIME types', async () => {
        await client.createBucket('images')
        const newTypes = ['image/webp', 'image/avif']
        await client.updateBucket('images', { allowedMimeTypes: newTypes })

        const { data } = await client.getBucket('images')
        expect(data?.allowed_mime_types).toEqual(newTypes)
      })

      it('should update file size limit', async () => {
        await client.createBucket('limited')
        const newLimit = 10 * 1024 * 1024
        await client.updateBucket('limited', { fileSizeLimit: newLimit })

        const { data } = await client.getBucket('limited')
        expect(data?.file_size_limit).toBe(newLimit)
      })

      it('should return error for non-existent bucket', async () => {
        const { error } = await client.updateBucket('nonexistent', { public: true })

        expect(error?.message).toContain('not found')
      })
    })

    describe('deleteBucket', () => {
      it('should delete an empty bucket', async () => {
        await client.createBucket('to-delete')
        const { error } = await client.deleteBucket('to-delete')

        expect(error).toBeNull()
        const { data } = await client.getBucket('to-delete')
        expect(data).toBeNull()
      })

      it('should return error when deleting non-existent bucket', async () => {
        const { error } = await client.deleteBucket('nonexistent')

        expect(error?.message).toContain('not found')
      })

      it('should return error when deleting non-empty bucket', async () => {
        await client.createBucket('non-empty')
        const file = client.from('non-empty')
        await file.upload('test.txt', 'content')

        const { error } = await client.deleteBucket('non-empty')

        expect(error?.message).toContain('not empty')
      })
    })

    describe('emptyBucket', () => {
      it('should empty a bucket with files', async () => {
        await client.createBucket('to-empty')
        const file = client.from('to-empty')
        await file.upload('file1.txt', 'content1')
        await file.upload('file2.txt', 'content2')

        const { error } = await client.emptyBucket('to-empty')
        expect(error).toBeNull()

        const { data: files } = await file.list()
        expect(files?.length).toBe(0)
      })

      it('should return error for non-existent bucket', async () => {
        const { error } = await client.emptyBucket('nonexistent')

        expect(error?.message).toContain('not found')
      })
    })
  })

  // ===========================================================================
  // File Upload Operations
  // ===========================================================================

  describe('File Upload Operations', () => {
    beforeEach(async () => {
      await client.createBucket('files')
    })

    describe('upload', () => {
      it('should upload a string', async () => {
        const file = client.from('files')
        const { data, error } = await file.upload('hello.txt', 'Hello World')

        expect(error).toBeNull()
        expect(data?.path).toBe('hello.txt')
        expect(data?.fullPath).toBe('files/hello.txt')
      })

      it('should upload a Uint8Array', async () => {
        const file = client.from('files')
        const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
        const { data, error } = await file.upload('binary.bin', bytes)

        expect(error).toBeNull()
        expect(data?.path).toBe('binary.bin')
      })

      it('should upload with custom content type', async () => {
        const file = client.from('files')
        const { error } = await file.upload('data.json', '{"key": "value"}', {
          contentType: 'application/json',
        })

        expect(error).toBeNull()
      })

      it('should upload with cache control', async () => {
        const file = client.from('files')
        const { error } = await file.upload('cached.txt', 'content', {
          cacheControl: 'max-age=86400',
        })

        expect(error).toBeNull()
      })

      it('should upload with metadata', async () => {
        const file = client.from('files')
        const { error } = await file.upload('with-meta.txt', 'content', {
          metadata: { author: 'test', version: '1.0' },
        })

        expect(error).toBeNull()
      })

      it('should return error when file exists without upsert', async () => {
        const file = client.from('files')
        await file.upload('existing.txt', 'original')
        const { error } = await file.upload('existing.txt', 'new content')

        expect(error?.message).toContain('already exists')
      })

      it('should overwrite with upsert option', async () => {
        const file = client.from('files')
        await file.upload('existing.txt', 'original')
        const { data, error } = await file.upload('existing.txt', 'new content', { upsert: true })

        expect(error).toBeNull()
        expect(data?.path).toBe('existing.txt')

        const { data: blob } = await file.download('existing.txt')
        const text = await blob?.text()
        expect(text).toBe('new content')
      })

      it('should upload to nested path', async () => {
        const file = client.from('files')
        const { data, error } = await file.upload('folder/subfolder/deep.txt', 'content')

        expect(error).toBeNull()
        expect(data?.path).toBe('folder/subfolder/deep.txt')
      })

      it('should reject invalid paths - starting with slash', async () => {
        const file = client.from('files')
        const { error } = await file.upload('/invalid/path.txt', 'content')

        expect(error?.message).toContain('Invalid path')
      })

      it('should reject paths with double dots', async () => {
        const file = client.from('files')
        const { error } = await file.upload('../escape.txt', 'content')

        expect(error?.message).toContain('Invalid path')
      })

      it('should detect content type from extension', async () => {
        const file = client.from('files')
        await file.upload('image.png', new Uint8Array([1, 2, 3]))

        const { data } = await file.download('image.png')
        expect(data?.type).toBe('image/png')
      })
    })

    describe('upload with MIME type validation', () => {
      beforeEach(async () => {
        await client.createBucket('images-only', {
          allowedMimeTypes: ['image/png', 'image/jpeg'],
        })
      })

      it('should allow valid MIME types', async () => {
        const file = client.from('images-only')
        const { error } = await file.upload('photo.png', new Uint8Array([1, 2, 3]), {
          contentType: 'image/png',
        })

        expect(error).toBeNull()
      })

      it('should reject invalid MIME types', async () => {
        const file = client.from('images-only')
        const { error } = await file.upload('doc.pdf', 'content', {
          contentType: 'application/pdf',
        })

        expect(error?.message).toContain('Invalid file type')
      })
    })

    describe('upload with file size limit', () => {
      beforeEach(async () => {
        await client.createBucket('limited', {
          fileSizeLimit: 100, // 100 bytes
        })
      })

      it('should allow files within limit', async () => {
        const file = client.from('limited')
        const { error } = await file.upload('small.txt', 'Hello')

        expect(error).toBeNull()
      })

      it('should reject files exceeding limit', async () => {
        const file = client.from('limited')
        const largeContent = 'x'.repeat(200)
        const { error } = await file.upload('large.txt', largeContent)

        expect(error?.message).toContain('exceeds limit')
      })
    })

    describe('update', () => {
      it('should update an existing file', async () => {
        const file = client.from('files')
        await file.upload('update-me.txt', 'original')
        const { error } = await file.update('update-me.txt', 'updated')

        expect(error).toBeNull()
        const { data } = await file.download('update-me.txt')
        expect(await data?.text()).toBe('updated')
      })
    })
  })

  // ===========================================================================
  // File Download Operations
  // ===========================================================================

  describe('File Download Operations', () => {
    beforeEach(async () => {
      await client.createBucket('downloads')
      const file = client.from('downloads')
      await file.upload('test.txt', 'Test content')
      await file.upload('binary.bin', new Uint8Array([0x00, 0x01, 0x02, 0x03]))
    })

    describe('download', () => {
      it('should download a text file', async () => {
        const file = client.from('downloads')
        const { data, error } = await file.download('test.txt')

        expect(error).toBeNull()
        expect(data).toBeInstanceOf(Blob)
        expect(await data?.text()).toBe('Test content')
      })

      it('should download a binary file', async () => {
        const file = client.from('downloads')
        const { data, error } = await file.download('binary.bin')

        expect(error).toBeNull()
        const arrayBuffer = await data?.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer!)
        expect(bytes).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03]))
      })

      it('should return error for non-existent file', async () => {
        const file = client.from('downloads')
        const { error } = await file.download('nonexistent.txt')

        expect(error?.message).toContain('not found')
      })

      it('should return error for non-existent bucket', async () => {
        const file = client.from('nonexistent-bucket')
        const { error } = await file.download('file.txt')

        expect(error?.message).toContain('not found')
      })
    })
  })

  // ===========================================================================
  // URL Operations
  // ===========================================================================

  describe('URL Operations', () => {
    beforeEach(async () => {
      await client.createBucket('urls', { public: true })
      const file = client.from('urls')
      await file.upload('public.txt', 'public content')
    })

    describe('getPublicUrl', () => {
      it('should return public URL', () => {
        const file = client.from('urls')
        const { data } = file.getPublicUrl('public.txt')

        expect(data.publicUrl).toContain('urls/public.txt')
      })

      it('should include download parameter', () => {
        const file = client.from('urls')
        const { data } = file.getPublicUrl('public.txt', { download: true })

        expect(data.publicUrl).toContain('download=')
      })

      it('should include custom download filename', () => {
        const file = client.from('urls')
        const { data } = file.getPublicUrl('public.txt', { download: 'custom-name.txt' })

        expect(data.publicUrl).toContain('download=custom-name.txt')
      })

      it('should include transform parameters', () => {
        const file = client.from('urls')
        const { data } = file.getPublicUrl('image.png', {
          transform: { width: 100, height: 100, resize: 'cover' },
        })

        expect(data.publicUrl).toContain('width=100')
        expect(data.publicUrl).toContain('height=100')
        expect(data.publicUrl).toContain('resize=cover')
      })
    })

    describe('createSignedUrl', () => {
      it('should create a signed URL', async () => {
        const file = client.from('urls')
        const { data, error } = await file.createSignedUrl('public.txt', 3600)

        expect(error).toBeNull()
        expect(data?.signedUrl).toContain('token=')
        expect(data?.signedUrl).toContain('expires=')
        expect(data?.path).toBe('public.txt')
      })

      it('should include download option in signed URL', async () => {
        const file = client.from('urls')
        const { data } = await file.createSignedUrl('public.txt', 3600, { download: true })

        expect(data?.signedUrl).toContain('download=')
      })

      it('should include transform options in signed URL', async () => {
        const file = client.from('urls')
        const { data } = await file.createSignedUrl('public.txt', 3600, {
          transform: { width: 200, quality: 80 },
        })

        expect(data?.signedUrl).toContain('width=200')
        expect(data?.signedUrl).toContain('quality=80')
      })

      it('should return error for non-existent file', async () => {
        const file = client.from('urls')
        const { error } = await file.createSignedUrl('nonexistent.txt', 3600)

        expect(error?.message).toContain('not found')
      })
    })

    describe('createSignedUrls', () => {
      beforeEach(async () => {
        const file = client.from('urls')
        await file.upload('file1.txt', 'content1')
        await file.upload('file2.txt', 'content2')
      })

      it('should create multiple signed URLs', async () => {
        const file = client.from('urls')
        const { data, error } = await file.createSignedUrls(
          ['public.txt', 'file1.txt', 'file2.txt'],
          3600
        )

        expect(error).toBeNull()
        expect(data?.length).toBe(3)
        expect(data?.[0].signedUrl).toContain('token=')
        expect(data?.[1].signedUrl).toContain('token=')
        expect(data?.[2].signedUrl).toContain('token=')
      })

      it('should include error for non-existent files in batch', async () => {
        const file = client.from('urls')
        const { data } = await file.createSignedUrls(['public.txt', 'nonexistent.txt'], 3600)

        expect(data?.length).toBe(2)
        expect(data?.[0].error).toBeNull()
        expect(data?.[1].error).toContain('not found')
      })
    })

    describe('createSignedUploadUrl', () => {
      it('should create a signed upload URL', async () => {
        const file = client.from('urls')
        const { data, error } = await file.createSignedUploadUrl('new-file.txt')

        expect(error).toBeNull()
        expect(data?.signedUrl).toContain('token=')
        expect(data?.token).toBeDefined()
        expect(data?.path).toBe('new-file.txt')
      })
    })
  })

  // ===========================================================================
  // List Operations
  // ===========================================================================

  describe('List Operations', () => {
    beforeEach(async () => {
      await client.createBucket('listing')
      const file = client.from('listing')
      await file.upload('file1.txt', 'content1')
      await file.upload('file2.txt', 'content2')
      await file.upload('folder/nested1.txt', 'nested1')
      await file.upload('folder/nested2.txt', 'nested2')
      await file.upload('folder/deep/file.txt', 'deep')
    })

    describe('list', () => {
      it('should list all files at root', async () => {
        const file = client.from('listing')
        const { data, error } = await file.list()

        expect(error).toBeNull()
        expect(data?.length).toBe(2)
        const names = data?.map((f) => f.name)
        expect(names).toContain('file1.txt')
        expect(names).toContain('file2.txt')
      })

      it('should list files in a folder', async () => {
        const file = client.from('listing')
        const { data, error } = await file.list('folder')

        expect(error).toBeNull()
        expect(data?.length).toBe(2)
        const names = data?.map((f) => f.name)
        expect(names).toContain('nested1.txt')
        expect(names).toContain('nested2.txt')
      })

      it('should return empty array for empty folder', async () => {
        const file = client.from('listing')
        const { data, error } = await file.list('nonexistent')

        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('should support limit option', async () => {
        const file = client.from('listing')
        const { data } = await file.list('', { limit: 1 })

        expect(data?.length).toBe(1)
      })

      it('should support offset option', async () => {
        const file = client.from('listing')
        const { data: all } = await file.list()
        const { data: offset } = await file.list('', { offset: 1 })

        expect(offset?.length).toBe(all!.length - 1)
      })

      it('should support sorting by name ascending', async () => {
        const file = client.from('listing')
        const { data } = await file.list('', {
          sortBy: { column: 'name', order: 'asc' },
        })

        expect(data?.[0].name).toBe('file1.txt')
        expect(data?.[1].name).toBe('file2.txt')
      })

      it('should support sorting by name descending', async () => {
        const file = client.from('listing')
        const { data } = await file.list('', {
          sortBy: { column: 'name', order: 'desc' },
        })

        expect(data?.[0].name).toBe('file2.txt')
        expect(data?.[1].name).toBe('file1.txt')
      })

      it('should support search filter', async () => {
        const file = client.from('listing')
        const { data } = await file.list('', { search: 'file1' })

        expect(data?.length).toBe(1)
        expect(data?.[0].name).toBe('file1.txt')
      })

      it('should return error for non-existent bucket', async () => {
        const file = client.from('nonexistent')
        const { error } = await file.list()

        expect(error?.message).toContain('not found')
      })
    })
  })

  // ===========================================================================
  // File Operations (Copy, Move, Remove)
  // ===========================================================================

  describe('File Operations', () => {
    beforeEach(async () => {
      await client.createBucket('operations')
      const file = client.from('operations')
      await file.upload('source.txt', 'source content')
    })

    describe('copy', () => {
      it('should copy a file', async () => {
        const file = client.from('operations')
        const { data, error } = await file.copy('source.txt', 'destination.txt')

        expect(error).toBeNull()
        expect(data?.path).toBe('destination.txt')

        // Both files should exist
        const { data: src } = await file.download('source.txt')
        const { data: dst } = await file.download('destination.txt')
        expect(await src?.text()).toBe('source content')
        expect(await dst?.text()).toBe('source content')
      })

      it('should copy to nested path', async () => {
        const file = client.from('operations')
        const { data, error } = await file.copy('source.txt', 'folder/copied.txt')

        expect(error).toBeNull()
        expect(data?.path).toBe('folder/copied.txt')
      })

      it('should return error for non-existent source', async () => {
        const file = client.from('operations')
        const { error } = await file.copy('nonexistent.txt', 'destination.txt')

        expect(error?.message).toContain('not found')
      })
    })

    describe('move', () => {
      it('should move a file', async () => {
        const file = client.from('operations')
        const { data, error } = await file.move('source.txt', 'moved.txt')

        expect(error).toBeNull()
        expect(data?.message).toContain('moved')

        // Source should not exist
        const { error: srcError } = await file.download('source.txt')
        expect(srcError?.message).toContain('not found')

        // Destination should exist
        const { data: dst } = await file.download('moved.txt')
        expect(await dst?.text()).toBe('source content')
      })

      it('should move to nested path', async () => {
        const file = client.from('operations')
        const { error } = await file.move('source.txt', 'folder/moved.txt')

        expect(error).toBeNull()
        const { data } = await file.download('folder/moved.txt')
        expect(await data?.text()).toBe('source content')
      })

      it('should return error for non-existent source', async () => {
        const file = client.from('operations')
        const { error } = await file.move('nonexistent.txt', 'destination.txt')

        expect(error?.message).toContain('not found')
      })
    })

    describe('remove', () => {
      it('should remove a single file', async () => {
        const file = client.from('operations')
        const { data, error } = await file.remove(['source.txt'])

        expect(error).toBeNull()
        expect(data?.length).toBe(1)
        expect(data?.[0].name).toBe('source.txt')

        const { error: downloadError } = await file.download('source.txt')
        expect(downloadError?.message).toContain('not found')
      })

      it('should remove multiple files', async () => {
        const file = client.from('operations')
        await file.upload('file1.txt', 'content1')
        await file.upload('file2.txt', 'content2')

        const { data, error } = await file.remove(['source.txt', 'file1.txt', 'file2.txt'])

        expect(error).toBeNull()
        expect(data?.length).toBe(3)
      })

      it('should handle non-existent files gracefully', async () => {
        const file = client.from('operations')
        const { data, error } = await file.remove(['nonexistent.txt'])

        expect(error).toBeNull()
        expect(data?.length).toBe(0) // Nothing was actually removed
      })

      it('should handle mix of existing and non-existing files', async () => {
        const file = client.from('operations')
        const { data, error } = await file.remove(['source.txt', 'nonexistent.txt'])

        expect(error).toBeNull()
        expect(data?.length).toBe(1) // Only source.txt was removed
      })
    })
  })

  // ===========================================================================
  // Error Classes
  // ===========================================================================

  describe('Error Classes', () => {
    it('should create BucketNotFoundError', () => {
      const error = new BucketNotFoundError('test-bucket')
      expect(error.message).toContain('test-bucket')
      expect(error.statusCode).toBe('404')
    })

    it('should create BucketAlreadyExistsError', () => {
      const error = new BucketAlreadyExistsError('test-bucket')
      expect(error.message).toContain('already exists')
      expect(error.statusCode).toBe('409')
    })

    it('should create FileNotFoundError', () => {
      const error = new FileNotFoundError('path/to/file.txt')
      expect(error.message).toContain('path/to/file.txt')
      expect(error.statusCode).toBe('404')
    })

    it('should create InvalidFileTypeError', () => {
      const error = new InvalidFileTypeError('application/pdf', ['image/png', 'image/jpeg'])
      expect(error.message).toContain('application/pdf')
      expect(error.message).toContain('image/png')
      expect(error.statusCode).toBe('415')
    })

    it('should create FileTooLargeError', () => {
      const error = new FileTooLargeError(1000000, 500000)
      expect(error.message).toContain('1000000')
      expect(error.message).toContain('500000')
      expect(error.statusCode).toBe('413')
    })
  })

  // ===========================================================================
  // Validation Functions
  // ===========================================================================

  describe('Validation Functions', () => {
    describe('validateBucketName', () => {
      it('should accept valid bucket names', () => {
        expect(() => validateBucketName('test')).not.toThrow()
        expect(() => validateBucketName('my-bucket')).not.toThrow()
        expect(() => validateBucketName('bucket123')).not.toThrow()
        expect(() => validateBucketName('a1b')).not.toThrow()
      })

      it('should reject empty names', () => {
        expect(() => validateBucketName('')).toThrow(InvalidBucketNameError)
      })

      it('should reject names shorter than 3 characters', () => {
        expect(() => validateBucketName('ab')).toThrow(InvalidBucketNameError)
      })

      it('should reject names longer than 63 characters', () => {
        expect(() => validateBucketName('a'.repeat(64))).toThrow(InvalidBucketNameError)
      })

      it('should reject names with uppercase letters', () => {
        expect(() => validateBucketName('MyBucket')).toThrow(InvalidBucketNameError)
      })

      it('should reject names starting with hyphen', () => {
        expect(() => validateBucketName('-bucket')).toThrow(InvalidBucketNameError)
      })

      it('should reject names ending with hyphen', () => {
        expect(() => validateBucketName('bucket-')).toThrow(InvalidBucketNameError)
      })

      it('should reject names with consecutive hyphens', () => {
        expect(() => validateBucketName('my--bucket')).toThrow(InvalidBucketNameError)
      })
    })

    describe('validatePath', () => {
      it('should accept valid paths', () => {
        expect(() => validatePath('file.txt')).not.toThrow()
        expect(() => validatePath('folder/file.txt')).not.toThrow()
        expect(() => validatePath('folder/sub/file.txt')).not.toThrow()
      })

      it('should reject empty paths', () => {
        expect(() => validatePath('')).toThrow(InvalidPathError)
      })

      it('should reject paths starting with slash', () => {
        expect(() => validatePath('/file.txt')).toThrow(InvalidPathError)
      })

      it('should reject paths with double dots', () => {
        expect(() => validatePath('../file.txt')).toThrow(InvalidPathError)
        expect(() => validatePath('folder/../file.txt')).toThrow(InvalidPathError)
      })
    })
  })

  // ===========================================================================
  // Backend Management
  // ===========================================================================

  describe('Backend Management', () => {
    it('should get default backend', () => {
      const backend = getDefaultBackend()
      expect(backend).toBeDefined()
    })

    it('should set custom backend', () => {
      const customBackend = new MemoryBackend()
      setDefaultBackend(customBackend)

      const current = getDefaultBackend()
      expect(current).toBe(customBackend)
    })

    it('should reset to memory backend', () => {
      const customBackend = new MemoryBackend()
      setDefaultBackend(customBackend)
      resetToMemoryBackend()

      const current = getDefaultBackend()
      expect(current).not.toBe(customBackend)
    })

    it('should create test client with memory storage', () => {
      const testClient = createTestClient('http://test.local/storage/v1')
      expect(testClient.url).toBe('http://test.local/storage/v1')
    })
  })

  // ===========================================================================
  // Content Type Detection
  // ===========================================================================

  describe('Content Type Detection', () => {
    beforeEach(async () => {
      await client.createBucket('content-types')
    })

    it('should detect image content types', async () => {
      const file = client.from('content-types')

      await file.upload('photo.jpg', new Uint8Array([1, 2, 3]))
      let result = await file.download('photo.jpg')
      expect(result.data?.type).toBe('image/jpeg')

      await file.upload('image.png', new Uint8Array([1, 2, 3]))
      result = await file.download('image.png')
      expect(result.data?.type).toBe('image/png')

      await file.upload('animation.gif', new Uint8Array([1, 2, 3]))
      result = await file.download('animation.gif')
      expect(result.data?.type).toBe('image/gif')

      await file.upload('photo.webp', new Uint8Array([1, 2, 3]))
      result = await file.download('photo.webp')
      expect(result.data?.type).toBe('image/webp')
    })

    it('should detect document content types', async () => {
      const file = client.from('content-types')

      await file.upload('doc.pdf', new Uint8Array([1, 2, 3]))
      let result = await file.download('doc.pdf')
      expect(result.data?.type).toBe('application/pdf')

      await file.upload('data.json', '{}')
      result = await file.download('data.json')
      expect(result.data?.type).toBe('application/json')

      await file.upload('file.txt', 'text')
      result = await file.download('file.txt')
      expect(result.data?.type).toBe('text/plain')
    })

    it('should default to octet-stream for unknown types', async () => {
      const file = client.from('content-types')

      await file.upload('unknown.xyz', new Uint8Array([1, 2, 3]))
      const result = await file.download('unknown.xyz')
      expect(result.data?.type).toBe('application/octet-stream')
    })
  })
})
