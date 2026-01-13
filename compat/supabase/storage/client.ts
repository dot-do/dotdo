/**
 * @dotdo/supabase/storage/client - Supabase Storage Client
 *
 * Drop-in replacement for @supabase/storage-js that runs on Cloudflare Workers
 * with in-memory storage (for testing) or R2 backend (for production).
 *
 * @example
 * ```typescript
 * import { StorageClient } from '@dotdo/supabase/storage'
 *
 * const storage = new StorageClient('https://project.supabase.co/storage/v1', {
 *   apikey: 'your-api-key',
 * })
 *
 * // Create a bucket
 * await storage.createBucket('avatars', { public: true })
 *
 * // Upload a file
 * const file = storage.from('avatars')
 * await file.upload('user/avatar.png', imageData, {
 *   contentType: 'image/png',
 * })
 *
 * // Get public URL
 * const { data } = file.getPublicUrl('user/avatar.png')
 * console.log(data.publicUrl)
 *
 * // Download a file
 * const { data: blob } = await file.download('user/avatar.png')
 * ```
 */

import type {
  Bucket,
  CreateBucketOptions,
  UpdateBucketOptions,
  FileObject,
  FileObjectV2,
  FileMetadata,
  FileOptions,
  UploadOptions,
  DownloadOptions,
  TransformOptions,
  CreateSignedUrlOptions,
  SignedUrl,
  SignedUploadUrl,
  SearchOptions,
  ListOptions,
  StorageApiResponse,
  UploadResponse,
  CopyResponse,
  MoveResponse,
  RemoveResponse,
  InternalBucket,
  InternalFile,
} from './types'

import {
  StorageBackend,
  MemoryBackend,
  R2Backend,
  getDefaultBackend,
} from './backend'

import {
  StorageApiError,
  BucketNotFoundError,
  BucketAlreadyExistsError,
  BucketNotEmptyError,
  FileNotFoundError,
  FileAlreadyExistsError,
  InvalidFileTypeError,
  FileTooLargeError,
  InvalidPathError,
  validateBucketName,
  validatePath,
  toStorageError,
} from './errors'

// =============================================================================
// Client Configuration
// =============================================================================

export interface StorageClientOptions {
  /** API key for authentication */
  apikey?: string
  /** Authorization header value */
  Authorization?: string
  /** R2 bucket binding for production */
  r2Bucket?: R2Bucket
  /** Use in-memory storage (for testing) */
  useMemoryStorage?: boolean
}

// =============================================================================
// Storage Client
// =============================================================================

/**
 * Supabase Storage compatible client
 */
export class StorageClient {
  readonly url: string
  private backend: StorageBackend
  private headers: Record<string, string>

  constructor(url: string, headers: StorageClientOptions = {}) {
    this.url = url
    this.headers = {
      ...(headers.apikey ? { apikey: headers.apikey } : {}),
      ...(headers.Authorization ? { Authorization: headers.Authorization } : {}),
    }

    // Choose backend based on options
    if (headers.r2Bucket) {
      this.backend = new R2Backend(headers.r2Bucket)
    } else if (headers.useMemoryStorage) {
      this.backend = new MemoryBackend()
    } else {
      this.backend = getDefaultBackend()
    }
  }

  /**
   * Get a StorageFileApi instance for a bucket
   */
  from(bucketId: string): StorageFileApi {
    return new StorageFileApi(this.url, this.backend, bucketId)
  }

  // ===========================================================================
  // Bucket Operations
  // ===========================================================================

  /**
   * List all buckets
   */
  async listBuckets(): Promise<StorageApiResponse<Bucket[]>> {
    try {
      const buckets = await this.backend.listBuckets()
      return {
        data: buckets.map((b) => this.toBucket(b)),
        error: null,
      }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Get a bucket by ID
   */
  async getBucket(id: string): Promise<StorageApiResponse<Bucket>> {
    try {
      const bucket = await this.backend.getBucket(id)
      if (!bucket) {
        throw new BucketNotFoundError(id)
      }
      return { data: this.toBucket(bucket), error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Create a new bucket
   */
  async createBucket(
    id: string,
    options: CreateBucketOptions = {}
  ): Promise<StorageApiResponse<{ name: string }>> {
    try {
      validateBucketName(id)

      const exists = await this.backend.bucketExists(id)
      if (exists) {
        throw new BucketAlreadyExistsError(id)
      }

      const now = new Date()
      const bucket: InternalBucket = {
        id,
        name: id,
        public: options.public ?? false,
        allowedMimeTypes: options.allowedMimeTypes ?? null,
        fileSizeLimit: options.fileSizeLimit ?? null,
        createdAt: now,
        updatedAt: now,
        files: new Map(),
      }

      await this.backend.createBucket(bucket)

      return { data: { name: id }, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Update a bucket
   */
  async updateBucket(
    id: string,
    options: UpdateBucketOptions
  ): Promise<StorageApiResponse<{ message: string }>> {
    try {
      const exists = await this.backend.bucketExists(id)
      if (!exists) {
        throw new BucketNotFoundError(id)
      }

      await this.backend.updateBucket(id, {
        public: options.public,
        allowedMimeTypes: options.allowedMimeTypes ?? null,
        fileSizeLimit: options.fileSizeLimit ?? null,
      })

      return { data: { message: 'Successfully updated' }, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Delete a bucket
   */
  async deleteBucket(id: string): Promise<StorageApiResponse<{ message: string }>> {
    try {
      const exists = await this.backend.bucketExists(id)
      if (!exists) {
        throw new BucketNotFoundError(id)
      }

      const isEmpty = await this.backend.bucketIsEmpty(id)
      if (!isEmpty) {
        throw new BucketNotEmptyError(id)
      }

      await this.backend.deleteBucket(id)

      return { data: { message: 'Successfully deleted' }, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Empty a bucket (delete all files)
   */
  async emptyBucket(id: string): Promise<StorageApiResponse<{ message: string }>> {
    try {
      const exists = await this.backend.bucketExists(id)
      if (!exists) {
        throw new BucketNotFoundError(id)
      }

      // List and delete all files
      const { files } = await this.backend.listFiles(id, '', { limit: 1000 })
      for (const file of files) {
        const fullPath = file.bucketId ? `${file.name}` : file.name
        await this.backend.deleteFile(id, fullPath)
      }

      return { data: { message: 'Successfully emptied' }, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private toBucket(internal: InternalBucket): Bucket {
    return {
      id: internal.id,
      name: internal.name,
      public: internal.public,
      allowed_mime_types: internal.allowedMimeTypes,
      file_size_limit: internal.fileSizeLimit,
      created_at: internal.createdAt.toISOString(),
      updated_at: internal.updatedAt.toISOString(),
    }
  }
}

// =============================================================================
// Storage File API
// =============================================================================

/**
 * File operations for a specific bucket
 */
export class StorageFileApi {
  readonly url: string
  readonly bucketId: string
  private backend: StorageBackend

  constructor(url: string, backend: StorageBackend, bucketId: string) {
    this.url = url
    this.backend = backend
    this.bucketId = bucketId
  }

  // ===========================================================================
  // Upload Operations
  // ===========================================================================

  /**
   * Upload a file to the bucket
   */
  async upload(
    path: string,
    fileBody: ArrayBuffer | ArrayBufferView | Blob | string | ReadableStream,
    options: UploadOptions = {}
  ): Promise<StorageApiResponse<UploadResponse>> {
    try {
      validatePath(path)
      await this.validateBucketAccess()

      // Check if file exists (unless upsert)
      const exists = await this.backend.fileExists(this.bucketId, path)
      if (exists && !options.upsert) {
        throw new FileAlreadyExistsError(path)
      }

      // Convert body to Uint8Array
      const body = await this.toUint8Array(fileBody)

      // Get bucket for validation
      const bucket = await this.backend.getBucket(this.bucketId)
      if (!bucket) throw new BucketNotFoundError(this.bucketId)

      // Validate file size
      if (bucket.fileSizeLimit && body.length > bucket.fileSizeLimit) {
        throw new FileTooLargeError(body.length, bucket.fileSizeLimit)
      }

      // Detect or use provided content type
      const contentType = options.contentType || this.detectContentType(path)

      // Validate MIME type
      if (bucket.allowedMimeTypes && bucket.allowedMimeTypes.length > 0) {
        if (!bucket.allowedMimeTypes.includes(contentType)) {
          throw new InvalidFileTypeError(contentType, bucket.allowedMimeTypes)
        }
      }

      const now = new Date()
      const file: InternalFile = {
        name: path.split('/').pop() || path,
        bucketId: this.bucketId,
        body,
        contentType,
        cacheControl: options.cacheControl || 'max-age=3600',
        metadata: options.metadata || {},
        createdAt: exists ? (await this.backend.headFile(this.bucketId, path))?.createdAt || now : now,
        updatedAt: now,
        lastAccessedAt: now,
      }

      await this.backend.putFile(this.bucketId, path, file)

      return {
        data: {
          path,
          id: crypto.randomUUID(),
          fullPath: `${this.bucketId}/${path}`,
        },
        error: null,
      }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Update an existing file
   */
  async update(
    path: string,
    fileBody: ArrayBuffer | ArrayBufferView | Blob | string | ReadableStream,
    options: FileOptions = {}
  ): Promise<StorageApiResponse<UploadResponse>> {
    return this.upload(path, fileBody, { ...options, upsert: true })
  }

  /**
   * Upload a file to a signed URL
   */
  async uploadToSignedUrl(
    path: string,
    token: string,
    fileBody: ArrayBuffer | ArrayBufferView | Blob | string | ReadableStream,
    options: FileOptions = {}
  ): Promise<StorageApiResponse<UploadResponse>> {
    // For compat layer, we just do a regular upload
    // Token validation would happen on real Supabase server
    return this.upload(path, fileBody, { ...options, upsert: true })
  }

  // ===========================================================================
  // Download Operations
  // ===========================================================================

  /**
   * Download a file from the bucket
   */
  async download(
    path: string,
    options?: DownloadOptions
  ): Promise<StorageApiResponse<Blob>> {
    try {
      validatePath(path)
      await this.validateBucketAccess()

      const file = await this.backend.getFile(this.bucketId, path)
      if (!file) {
        throw new FileNotFoundError(path)
      }

      // Apply transformations if requested
      let body = file.body
      if (options?.transform) {
        body = await this.applyTransform(body, file.contentType, options.transform)
      }

      const blob = new Blob([body], { type: file.contentType })
      return { data: blob, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  // ===========================================================================
  // URL Operations
  // ===========================================================================

  /**
   * Get the public URL for a file
   */
  getPublicUrl(
    path: string,
    options?: { download?: boolean | string; transform?: TransformOptions }
  ): { data: { publicUrl: string } } {
    let url = `${this.url}/object/public/${this.bucketId}/${path}`

    const params = new URLSearchParams()

    if (options?.download) {
      params.set('download', typeof options.download === 'string' ? options.download : '')
    }

    if (options?.transform) {
      if (options.transform.width) params.set('width', String(options.transform.width))
      if (options.transform.height) params.set('height', String(options.transform.height))
      if (options.transform.resize) params.set('resize', options.transform.resize)
      if (options.transform.format) params.set('format', options.transform.format)
      if (options.transform.quality) params.set('quality', String(options.transform.quality))
    }

    const queryString = params.toString()
    if (queryString) {
      url += `?${queryString}`
    }

    return { data: { publicUrl: url } }
  }

  /**
   * Create a signed URL for private access
   */
  async createSignedUrl(
    path: string,
    expiresIn: number,
    options?: CreateSignedUrlOptions
  ): Promise<StorageApiResponse<SignedUrl>> {
    try {
      validatePath(path)
      await this.validateBucketAccess()

      // Check file exists
      const exists = await this.backend.fileExists(this.bucketId, path)
      if (!exists) {
        throw new FileNotFoundError(path)
      }

      // Generate signed URL
      const token = crypto.randomUUID()
      const expires = Date.now() + expiresIn * 1000

      let url = `${this.url}/object/sign/${this.bucketId}/${path}?token=${token}&expires=${expires}`

      if (options?.download) {
        url += `&download=${typeof options.download === 'string' ? options.download : ''}`
      }

      if (options?.transform) {
        const t = options.transform
        if (t.width) url += `&width=${t.width}`
        if (t.height) url += `&height=${t.height}`
        if (t.resize) url += `&resize=${t.resize}`
        if (t.format) url += `&format=${t.format}`
        if (t.quality) url += `&quality=${t.quality}`
      }

      return {
        data: { error: null, path, signedUrl: url },
        error: null,
      }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Create multiple signed URLs
   */
  async createSignedUrls(
    paths: string[],
    expiresIn: number,
    options?: CreateSignedUrlOptions
  ): Promise<StorageApiResponse<SignedUrl[]>> {
    try {
      const results: SignedUrl[] = []

      for (const path of paths) {
        const result = await this.createSignedUrl(path, expiresIn, options)
        if (result.data) {
          results.push(result.data)
        } else {
          results.push({
            error: result.error?.message || 'Unknown error',
            path,
            signedUrl: '',
          })
        }
      }

      return { data: results, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Create a signed URL for upload
   */
  async createSignedUploadUrl(
    path: string
  ): Promise<StorageApiResponse<SignedUploadUrl>> {
    try {
      validatePath(path)
      await this.validateBucketAccess()

      const token = crypto.randomUUID()
      const signedUrl = `${this.url}/object/upload/sign/${this.bucketId}/${path}?token=${token}`

      return {
        data: { signedUrl, token, path },
        error: null,
      }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  // ===========================================================================
  // List Operations
  // ===========================================================================

  /**
   * List files in the bucket
   */
  async list(
    path?: string,
    options?: SearchOptions
  ): Promise<StorageApiResponse<FileObject[]>> {
    try {
      await this.validateBucketAccess()

      const { files } = await this.backend.listFiles(
        this.bucketId,
        path || '',
        options
      )

      const fileObjects: FileObject[] = files.map((f) => ({
        name: f.name,
        bucket_id: this.bucketId,
        id: crypto.randomUUID(),
        created_at: f.createdAt.toISOString(),
        updated_at: f.updatedAt.toISOString(),
        last_accessed_at: f.lastAccessedAt.toISOString(),
        metadata: f.metadata,
      }))

      return { data: fileObjects, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Move a file to a new path
   */
  async move(
    fromPath: string,
    toPath: string
  ): Promise<StorageApiResponse<MoveResponse>> {
    try {
      validatePath(fromPath)
      validatePath(toPath)
      await this.validateBucketAccess()

      const exists = await this.backend.fileExists(this.bucketId, fromPath)
      if (!exists) {
        throw new FileNotFoundError(fromPath)
      }

      await this.backend.moveFile(this.bucketId, fromPath, this.bucketId, toPath)

      return { data: { message: 'Successfully moved' }, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Copy a file to a new path
   */
  async copy(
    fromPath: string,
    toPath: string
  ): Promise<StorageApiResponse<CopyResponse>> {
    try {
      validatePath(fromPath)
      validatePath(toPath)
      await this.validateBucketAccess()

      const exists = await this.backend.fileExists(this.bucketId, fromPath)
      if (!exists) {
        throw new FileNotFoundError(fromPath)
      }

      await this.backend.copyFile(this.bucketId, fromPath, this.bucketId, toPath)

      return { data: { path: toPath }, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  /**
   * Remove files from the bucket
   */
  async remove(paths: string[]): Promise<StorageApiResponse<FileObject[]>> {
    try {
      await this.validateBucketAccess()

      const removed: FileObject[] = []

      for (const path of paths) {
        validatePath(path)

        const file = await this.backend.headFile(this.bucketId, path)
        if (file) {
          await this.backend.deleteFile(this.bucketId, path)
          removed.push({
            name: file.name,
            bucket_id: this.bucketId,
            id: crypto.randomUUID(),
            created_at: file.createdAt.toISOString(),
            updated_at: file.updatedAt.toISOString(),
            last_accessed_at: file.lastAccessedAt.toISOString(),
            metadata: file.metadata,
          })
        }
      }

      return { data: removed, error: null }
    } catch (error) {
      return { data: null, error: toStorageError(error).toJSON() }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async validateBucketAccess(): Promise<void> {
    const exists = await this.backend.bucketExists(this.bucketId)
    if (!exists) {
      throw new BucketNotFoundError(this.bucketId)
    }
  }

  private async toUint8Array(
    input: ArrayBuffer | ArrayBufferView | Blob | string | ReadableStream
  ): Promise<Uint8Array> {
    if (typeof input === 'string') {
      return new TextEncoder().encode(input)
    }

    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input)
    }

    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    }

    if (input instanceof Blob) {
      const buffer = await input.arrayBuffer()
      return new Uint8Array(buffer)
    }

    // ReadableStream
    const reader = input.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  }

  private detectContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const types: Record<string, string> = {
      // Images
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      avif: 'image/avif',
      // Documents
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Text
      txt: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      csv: 'text/csv',
      // Code
      js: 'application/javascript',
      json: 'application/json',
      xml: 'application/xml',
      ts: 'application/typescript',
      // Archives
      zip: 'application/zip',
      gz: 'application/gzip',
      tar: 'application/x-tar',
      rar: 'application/vnd.rar',
      '7z': 'application/x-7z-compressed',
      // Audio
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      // Video
      mp4: 'video/mp4',
      webm: 'video/webm',
      avi: 'video/x-msvideo',
      mov: 'video/quicktime',
      // Fonts
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
    }

    return types[ext || ''] || 'application/octet-stream'
  }

  private async applyTransform(
    body: Uint8Array,
    contentType: string,
    _transform: TransformOptions
  ): Promise<Uint8Array> {
    // Image transformation would require an image processing library
    // For the compat layer, we return the original image
    // In production with Cloudflare, you would use Cloudflare Image Resizing
    if (!contentType.startsWith('image/')) {
      return body
    }

    // Placeholder for actual transformation
    // Real implementation would use sharp, jimp, or Cloudflare Image Resizing
    return body
  }
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Clear all in-memory storage (for testing)
 */
export function _clearAll(): void {
  getDefaultBackend().clear()
}

/**
 * Create a test storage client
 */
export function createTestClient(url = 'http://localhost:54321/storage/v1'): StorageClient {
  return new StorageClient(url, { useMemoryStorage: true })
}
