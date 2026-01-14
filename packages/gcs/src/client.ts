/**
 * @dotdo/gcs/client - GCS Storage Client
 *
 * Google Cloud Storage compatible client for storage operations.
 * Drop-in replacement for @google-cloud/storage.
 *
 * @example
 * ```typescript
 * import { Storage } from '@dotdo/gcs'
 *
 * const storage = new Storage({ projectId: 'my-project' })
 *
 * // Create a bucket
 * const [bucket] = await storage.createBucket('my-bucket')
 *
 * // Upload a file
 * const file = bucket.file('hello.txt')
 * await file.save('Hello World')
 *
 * // Download a file
 * const [content] = await file.download()
 * console.log(content.toString())
 * ```
 */

import type {
  StorageOptions,
  ExtendedStorageOptions,
  CreateBucketOptions,
  GetBucketsOptions,
  BucketMetadata,
  FileMetadata,
  GetFilesOptions,
  GetFilesResponse,
  SaveOptions,
  SetMetadataOptions,
  CopyOptions,
  DownloadOptions,
  SignedUrlConfig,
  CreateResumableUploadOptions,
  ResumableUploadOptions,
  PredefinedBucketAcl,
  PredefinedObjectAcl,
  GetMetadataResponse,
  Policy,
  AddAclOptions,
  BucketAccessControl,
  ObjectAccessControl,
  NotificationConfig,
  NotificationMetadata,
  LifecycleRule,
  CorsConfiguration,
  InternalResumableUpload,
  StorageClass,
  GcsBuffer,
} from './types'

import {
  StorageBackend,
  MemoryBackend,
  R2Backend,
  getDefaultBackend,
  setDefaultBackend,
} from './backend'

import {
  ApiError,
  BucketNotFoundError,
  BucketAlreadyExistsError,
  BucketNotEmptyError,
  FileNotFoundError,
  BadRequestError,
  InvalidArgumentError,
  validateBucketName,
  ResumableUploadNotFoundError,
  NotificationNotFoundError,
} from './errors'

import { generateSignedUrl } from './signed-url'

// =============================================================================
// Storage Class
// =============================================================================

/**
 * Google Cloud Storage compatible client
 */
export class Storage {
  readonly projectId?: string
  private backend: StorageBackend
  private options: ExtendedStorageOptions

  constructor(options: ExtendedStorageOptions = {}) {
    this.options = options
    this.projectId = options.projectId

    // Choose backend based on options
    if (options.r2Bucket) {
      this.backend = new R2Backend(options.r2Bucket)
    } else if (options.useMemoryStorage) {
      this.backend = new MemoryBackend()
    } else {
      this.backend = getDefaultBackend()
    }
  }

  /**
   * Get a reference to a bucket
   */
  bucket(name: string): Bucket {
    return new Bucket(this, name)
  }

  /**
   * Create a new bucket
   */
  async createBucket(
    name: string,
    options: CreateBucketOptions = {}
  ): Promise<[Bucket, BucketMetadata]> {
    // Validate bucket name
    validateBucketName(name)

    // Check if bucket already exists
    if (await this.backend.bucketExists(name)) {
      throw new BucketAlreadyExistsError(name)
    }

    const now = new Date().toISOString()
    const metadata: BucketMetadata = {
      id: name,
      name,
      selfLink: `https://storage.googleapis.com/storage/v1/b/${name}`,
      projectNumber: this.projectId,
      location: options.location || 'US',
      locationType: options.location?.includes('-') ? 'region' : 'multi-region',
      storageClass: options.storageClass || 'STANDARD',
      timeCreated: now,
      updated: now,
      etag: this.generateEtag(),
      metageneration: '1',
      versioning: options.versioning,
      labels: options.labels,
      cors: options.cors,
      lifecycle: options.lifecycle ? { rule: options.lifecycle } : undefined,
      website: options.website,
      logging: options.logging,
      iamConfiguration: options.iamConfiguration,
      retentionPolicy: options.retentionPolicy,
      rpo: options.rpo,
    }

    await this.backend.createBucket(name, metadata)

    return [new Bucket(this, name), metadata]
  }

  /**
   * List all buckets
   */
  async getBuckets(options: GetBucketsOptions = {}): Promise<[Bucket[], object, BucketMetadata[]]> {
    const internalBuckets = await this.backend.listBuckets()
    let buckets = internalBuckets

    // Apply prefix filter
    if (options.prefix) {
      buckets = buckets.filter((b) => b.name.startsWith(options.prefix!))
    }

    // Apply pagination
    const maxResults = options.maxResults || 1000
    const startIndex = options.pageToken
      ? parseInt(atob(options.pageToken))
      : 0

    const pageData = buckets.slice(startIndex, startIndex + maxResults)
    const hasMore = startIndex + maxResults < buckets.length

    const nextPageToken = hasMore
      ? btoa(String(startIndex + maxResults))
      : undefined

    const bucketObjects = pageData.map((b) => new Bucket(this, b.name))
    const metadata = pageData.map((b) => b.metadata)

    return [
      bucketObjects,
      { nextPageToken },
      metadata,
    ]
  }

  /**
   * Get the underlying storage backend
   */
  getBackend(): StorageBackend {
    return this.backend
  }

  /**
   * Generate an ETag
   */
  private generateEtag(): string {
    return `"${crypto.randomUUID().replace(/-/g, '')}"`
  }
}

// =============================================================================
// Bucket Class
// =============================================================================

/**
 * Represents a GCS bucket
 */
export class Bucket {
  readonly name: string
  private storage: Storage

  constructor(storage: Storage, name: string) {
    this.storage = storage
    this.name = name
  }

  /**
   * Get a reference to a file in this bucket
   */
  file(name: string): File {
    return new File(this, name)
  }

  /**
   * Check if the bucket exists
   */
  async exists(): Promise<[boolean]> {
    const exists = await this.storage.getBackend().bucketExists(this.name)
    return [exists]
  }

  /**
   * Delete this bucket
   */
  async delete(): Promise<void> {
    const backend = this.storage.getBackend()

    // Check if bucket exists
    if (!(await backend.bucketExists(this.name))) {
      throw new BucketNotFoundError(this.name)
    }

    // Check if bucket is empty
    const { files } = await backend.listFiles(this.name, { maxResults: 1 })
    if (files.length > 0) {
      throw new BucketNotEmptyError(this.name)
    }

    await backend.deleteBucket(this.name)
  }

  /**
   * Get bucket metadata
   */
  async getMetadata(): Promise<[BucketMetadata]> {
    const bucket = await this.storage.getBackend().getBucket(this.name)
    if (!bucket) {
      throw new BucketNotFoundError(this.name)
    }
    return [bucket.metadata]
  }

  /**
   * Set bucket metadata
   */
  async setMetadata(metadata: Partial<BucketMetadata>): Promise<[BucketMetadata]> {
    const backend = this.storage.getBackend()

    if (!(await backend.bucketExists(this.name))) {
      throw new BucketNotFoundError(this.name)
    }

    await backend.updateBucketMetadata(this.name, {
      ...metadata,
      updated: new Date().toISOString(),
    })

    const bucket = await backend.getBucket(this.name)
    return [bucket!.metadata]
  }

  /**
   * List files in this bucket
   */
  async getFiles(
    options: GetFilesOptions = {}
  ): Promise<[File[], GetFilesOptions | null, GetFilesResponse]> {
    const backend = this.storage.getBackend()

    if (!(await backend.bucketExists(this.name))) {
      throw new BucketNotFoundError(this.name)
    }

    const result = await backend.listFiles(this.name, {
      prefix: options.prefix,
      delimiter: options.delimiter,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      versions: options.versions,
      startOffset: options.startOffset,
      endOffset: options.endOffset,
    })

    const files = result.files.map((f) => new File(this, f.name))

    const nextQuery = result.nextPageToken
      ? { ...options, pageToken: result.nextPageToken }
      : null

    const response: GetFilesResponse = {
      prefixes: result.prefixes,
      nextPageToken: result.nextPageToken,
    }

    return [files, nextQuery, response]
  }

  /**
   * Upload a file from a local path (simulated)
   */
  async upload(
    pathString: string,
    options: { destination?: string; metadata?: Record<string, string> } = {}
  ): Promise<[File]> {
    const destination = options.destination || pathString.split('/').pop() || 'file'
    const file = this.file(destination)

    // In a real implementation, this would read from the filesystem
    // For the compat layer, we simulate with an empty file
    await file.save(new Uint8Array(0), {
      metadata: options.metadata,
    })

    return [file]
  }

  /**
   * Delete files in this bucket
   */
  async deleteFiles(options: { prefix?: string; force?: boolean } = {}): Promise<void> {
    const backend = this.storage.getBackend()

    const { files } = await backend.listFiles(this.name, {
      prefix: options.prefix,
    })

    for (const file of files) {
      await backend.deleteFile(this.name, file.name)
    }
  }

  /**
   * Enable versioning
   */
  async enableVersioning(): Promise<void> {
    await this.setMetadata({ versioning: { enabled: true } })
  }

  /**
   * Disable versioning
   */
  async disableVersioning(): Promise<void> {
    await this.setMetadata({ versioning: { enabled: false } })
  }

  /**
   * Set lifecycle rules
   */
  async setLifecycle(rules: LifecycleRule[]): Promise<[BucketMetadata]> {
    return this.setMetadata({ lifecycle: { rule: rules } })
  }

  /**
   * Get lifecycle rules
   */
  async getLifecycle(): Promise<[LifecycleRule[]]> {
    const [metadata] = await this.getMetadata()
    return [metadata.lifecycle?.rule || []]
  }

  /**
   * Set CORS configuration
   */
  async setCorsConfiguration(cors: CorsConfiguration[]): Promise<[BucketMetadata]> {
    return this.setMetadata({ cors })
  }

  /**
   * Get CORS configuration
   */
  async getCorsConfiguration(): Promise<[CorsConfiguration[]]> {
    const [metadata] = await this.getMetadata()
    return [metadata.cors || []]
  }

  /**
   * Create a notification configuration
   */
  async createNotification(config: NotificationConfig): Promise<[NotificationMetadata]> {
    const backend = this.storage.getBackend()

    if (!(await backend.bucketExists(this.name))) {
      throw new BucketNotFoundError(this.name)
    }

    const notification: NotificationMetadata = {
      id: `projects/_/buckets/${this.name}/notificationConfigs/${Date.now()}`,
      topic: config.topic,
      eventTypes: config.eventTypes,
      objectNamePrefix: config.objectNamePrefix,
      customAttributes: config.customAttributes,
      payloadFormat: config.payloadFormat || 'JSON_API_V1',
      etag: crypto.randomUUID(),
      selfLink: `https://storage.googleapis.com/storage/v1/b/${this.name}/notificationConfigs/${Date.now()}`,
    }

    await backend.createNotification(this.name, notification)
    return [notification]
  }

  /**
   * Get notifications
   */
  async getNotifications(): Promise<[NotificationMetadata[]]> {
    const backend = this.storage.getBackend()

    if (!(await backend.bucketExists(this.name))) {
      throw new BucketNotFoundError(this.name)
    }

    const notifications = await backend.listNotifications(this.name)
    return [notifications]
  }

  /**
   * Get IAM policy
   */
  iam: {
    getPolicy(): Promise<[Policy]>
    setPolicy(policy: Policy): Promise<[Policy]>
    testPermissions(permissions: string[]): Promise<[string[]]>
  } = {
    getPolicy: async () => {
      return [{ version: 1, bindings: [] }]
    },
    setPolicy: async (policy: Policy) => {
      return [policy]
    },
    testPermissions: async (permissions: string[]) => {
      return [permissions]
    },
  }
}

// =============================================================================
// File Class
// =============================================================================

/**
 * Represents a GCS file/object
 */
export class File {
  readonly name: string
  readonly bucket: Bucket

  constructor(bucket: Bucket, name: string) {
    this.bucket = bucket
    this.name = name
  }

  /**
   * Check if the file exists
   */
  async exists(): Promise<[boolean]> {
    const backend = this.bucket['storage'].getBackend()
    const exists = await backend.fileExists(this.bucket.name, this.name)
    return [exists]
  }

  /**
   * Save content to the file
   */
  async save(
    data: string | Uint8Array | ReadableStream<Uint8Array>,
    options: SaveOptions = {}
  ): Promise<void> {
    const backend = this.bucket['storage'].getBackend()

    // Check if bucket exists
    if (!(await backend.bucketExists(this.bucket.name))) {
      throw new BucketNotFoundError(this.bucket.name)
    }

    // Convert data to Uint8Array
    let body: Uint8Array
    if (typeof data === 'string') {
      body = new TextEncoder().encode(data)
    } else if (data instanceof ReadableStream) {
      // Consume stream
      const chunks: Uint8Array[] = []
      const reader = data.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      body = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
    } else {
      body = data
    }

    const now = new Date().toISOString()
    const md5Hash = await this.computeMd5(body)
    const crc32c = await this.computeCrc32c(body)

    const metadata: FileMetadata = {
      id: `${this.bucket.name}/${this.name}/${Date.now()}`,
      name: this.name,
      bucket: this.bucket.name,
      generation: String(Date.now()),
      metageneration: '1',
      contentType: options.contentType || this.guessContentType(this.name),
      size: String(body.length),
      md5Hash,
      crc32c,
      etag: `"${crypto.randomUUID().replace(/-/g, '')}"`,
      timeCreated: now,
      updated: now,
      storageClass: 'STANDARD',
      timeStorageClassUpdated: now,
      cacheControl: options.cacheControl,
      contentDisposition: options.contentDisposition,
      contentEncoding: options.contentEncoding,
      contentLanguage: options.contentLanguage,
      metadata: options.metadata,
      mediaLink: `https://storage.googleapis.com/download/storage/v1/b/${this.bucket.name}/o/${encodeURIComponent(this.name)}?alt=media`,
      selfLink: `https://storage.googleapis.com/storage/v1/b/${this.bucket.name}/o/${encodeURIComponent(this.name)}`,
    }

    await backend.putFile(this.bucket.name, this.name, body, metadata)
  }

  /**
   * Download the file content
   */
  async download(options: DownloadOptions = {}): Promise<[GcsBuffer]> {
    const backend = this.bucket['storage'].getBackend()

    // Check if bucket exists
    if (!(await backend.bucketExists(this.bucket.name))) {
      throw new BucketNotFoundError(this.bucket.name)
    }

    const file = await backend.getFile(this.bucket.name, this.name)
    if (!file) {
      throw new FileNotFoundError(this.bucket.name, this.name)
    }

    let data = file.body

    // Handle range request
    if (options.start !== undefined || options.end !== undefined) {
      const start = options.start || 0
      const end = options.end !== undefined ? options.end + 1 : data.length
      data = data.slice(start, end)
    }

    // Return as Buffer-like Uint8Array with toString method
    const buffer = data as GcsBuffer
    // Override toString to decode as text (Uint8Array's default toString returns comma-separated values)
    ;(buffer as any).toString = function (encoding?: string) {
      return new TextDecoder(encoding || 'utf-8').decode(this)
    }

    return [buffer]
  }

  /**
   * Delete the file
   */
  async delete(): Promise<void> {
    const backend = this.bucket['storage'].getBackend()
    await backend.deleteFile(this.bucket.name, this.name)
  }

  /**
   * Copy the file to another location
   */
  async copy(destination: string | File, options: CopyOptions = {}): Promise<[File]> {
    const backend = this.bucket['storage'].getBackend()

    // Get source file
    const sourceFile = await backend.getFile(this.bucket.name, this.name)
    if (!sourceFile) {
      throw new FileNotFoundError(this.bucket.name, this.name)
    }

    // Determine destination
    let destBucket: Bucket
    let destName: string

    if (typeof destination === 'string') {
      destBucket = this.bucket
      destName = destination
    } else {
      destBucket = destination.bucket
      destName = destination.name
    }

    // Create destination file
    const destFile = destBucket.file(destName)

    const metadata: FileMetadata = {
      ...sourceFile.metadata,
      name: destName,
      bucket: destBucket.name,
      generation: String(Date.now()),
      metageneration: '1',
      timeCreated: new Date().toISOString(),
      updated: new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(options.contentType ? { contentType: options.contentType } : {}),
    }

    await backend.putFile(destBucket.name, destName, sourceFile.body, metadata)

    return [destFile]
  }

  /**
   * Move the file to another location
   */
  async move(destination: string | File, options: CopyOptions = {}): Promise<[File]> {
    const [copiedFile] = await this.copy(destination, options)
    await this.delete()
    return [copiedFile]
  }

  /**
   * Get file metadata
   */
  async getMetadata(): Promise<[FileMetadata]> {
    const backend = this.bucket['storage'].getBackend()

    // Check if bucket exists
    if (!(await backend.bucketExists(this.bucket.name))) {
      throw new BucketNotFoundError(this.bucket.name)
    }

    const file = await backend.getFile(this.bucket.name, this.name)
    if (!file) {
      throw new FileNotFoundError(this.bucket.name, this.name)
    }

    return [file.metadata]
  }

  /**
   * Set file metadata
   */
  async setMetadata(metadata: SetMetadataOptions): Promise<[FileMetadata]> {
    const backend = this.bucket['storage'].getBackend()

    // Check if bucket exists
    if (!(await backend.bucketExists(this.bucket.name))) {
      throw new BucketNotFoundError(this.bucket.name)
    }

    // Check if file exists
    if (!(await backend.fileExists(this.bucket.name, this.name))) {
      throw new FileNotFoundError(this.bucket.name, this.name)
    }

    await backend.updateFileMetadata(this.bucket.name, this.name, {
      contentType: metadata.contentType,
      cacheControl: metadata.cacheControl,
      contentDisposition: metadata.contentDisposition,
      contentEncoding: metadata.contentEncoding,
      contentLanguage: metadata.contentLanguage,
      metadata: metadata.metadata,
      customTime: metadata.customTime instanceof Date
        ? metadata.customTime.toISOString()
        : metadata.customTime,
      eventBasedHold: metadata.eventBasedHold,
      temporaryHold: metadata.temporaryHold,
    })

    const file = await backend.getFile(this.bucket.name, this.name)
    return [file!.metadata]
  }

  /**
   * Create a read stream
   */
  createReadStream(options?: DownloadOptions): ReadableStream<Uint8Array> {
    const self = this

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const [content] = await self.download(options)
          controller.enqueue(content)
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    })
  }

  /**
   * Create a write stream
   */
  createWriteStream(options: SaveOptions = {}): WritableStream<Uint8Array> {
    const chunks: Uint8Array[] = []
    const self = this

    return new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
      async close() {
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
        const body = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          body.set(chunk, offset)
          offset += chunk.length
        }
        await self.save(body, options)
      },
    })
  }

  /**
   * Generate a signed URL
   */
  async getSignedUrl(config: SignedUrlConfig): Promise<[string]> {
    const url = await generateSignedUrl(
      this.bucket.name,
      this.name,
      config,
      this.bucket['storage']
    )
    return [url]
  }

  /**
   * Create a resumable upload
   */
  async createResumableUpload(
    options: CreateResumableUploadOptions = {}
  ): Promise<[string]> {
    const backend = this.bucket['storage'].getBackend()

    // Check if bucket exists
    if (!(await backend.bucketExists(this.bucket.name))) {
      throw new BucketNotFoundError(this.bucket.name)
    }

    const uploadUri = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket.name}/o?uploadType=resumable&name=${encodeURIComponent(this.name)}&upload_id=${crypto.randomUUID()}`

    const upload: InternalResumableUpload = {
      uri: uploadUri,
      bucket: this.bucket.name,
      key: this.name,
      contentType: options.contentType,
      customMetadata: options.metadata,
      chunks: [],
      totalSize: 0,
      cancelled: false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    }

    await backend.createResumableUpload(upload)

    return [uploadUri]
  }

  /**
   * Resume an upload
   */
  async resumableUpload(
    uploadUri: string,
    data: Uint8Array,
    options: ResumableUploadOptions = {}
  ): Promise<void> {
    const backend = this.bucket['storage'].getBackend()

    const upload = await backend.getResumableUpload(uploadUri)
    if (!upload) {
      throw new ResumableUploadNotFoundError(uploadUri)
    }

    if (upload.cancelled) {
      throw new ApiError({
        code: 410,
        message: 'Upload has been cancelled',
      })
    }

    // Add chunk
    upload.chunks.push(data)
    upload.totalSize += data.length

    await backend.updateResumableUpload(uploadUri, {
      chunks: upload.chunks,
      totalSize: upload.totalSize,
    })

    // If not partial, finalize the upload
    if (!options.isPartial) {
      // Combine all chunks
      const totalLength = upload.chunks.reduce((acc, c) => acc + c.length, 0)
      const body = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of upload.chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }

      // Save the file
      await this.save(body, {
        contentType: upload.contentType,
        metadata: upload.customMetadata,
      })

      // Clean up upload
      await backend.deleteResumableUpload(uploadUri)
    }
  }

  /**
   * Get the current offset of a resumable upload
   */
  async getResumableOffset(uploadUri: string): Promise<number> {
    const backend = this.bucket['storage'].getBackend()

    const upload = await backend.getResumableUpload(uploadUri)
    if (!upload) {
      throw new ResumableUploadNotFoundError(uploadUri)
    }

    return upload.totalSize
  }

  /**
   * Cancel a resumable upload
   */
  async cancelResumableUpload(uploadUri: string): Promise<void> {
    const backend = this.bucket['storage'].getBackend()

    const upload = await backend.getResumableUpload(uploadUri)
    if (!upload) {
      throw new ResumableUploadNotFoundError(uploadUri)
    }

    await backend.updateResumableUpload(uploadUri, { cancelled: true })
  }

  /**
   * Make the file public
   */
  async makePublic(): Promise<void> {
    // In a real implementation, this would set ACLs
    // For the compat layer, we just update metadata
    await this.setMetadata({
      metadata: { ...(await this.getMetadata())[0].metadata, public: 'true' },
    })
  }

  /**
   * Make the file private
   */
  async makePrivate(): Promise<void> {
    await this.setMetadata({
      metadata: { ...(await this.getMetadata())[0].metadata, public: 'false' },
    })
  }

  /**
   * Get the public URL for this file
   */
  publicUrl(): string {
    return `https://storage.googleapis.com/${this.bucket.name}/${encodeURIComponent(this.name)}`
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private guessContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase()
    const contentTypes: Record<string, string> = {
      txt: 'text/plain',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      xml: 'application/xml',
      pdf: 'application/pdf',
      zip: 'application/zip',
      gzip: 'application/gzip',
      gz: 'application/gzip',
      tar: 'application/x-tar',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      mp4: 'video/mp4',
      webm: 'video/webm',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
    }
    return contentTypes[ext || ''] || 'application/octet-stream'
  }

  private async computeMd5(data: Uint8Array): Promise<string> {
    // Use a simple hash for the compat layer
    // In production, use crypto.subtle.digest or a proper MD5 library
    const hash = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(hash).slice(0, 16)))
  }

  private async computeCrc32c(data: Uint8Array): Promise<string> {
    // Simplified CRC32C implementation
    // In production, use a proper CRC32C library
    let crc = 0xffffffff
    for (const byte of data) {
      crc = (crc >>> 8) ^ byte
    }
    crc = crc ^ 0xffffffff
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, crc, true)
    return btoa(String.fromCharCode(...bytes))
  }
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Clear all data (for testing)
 */
export function _clearAll(): void {
  getDefaultBackend().clear()
}

/**
 * Get all buckets (for testing)
 */
export async function _getBuckets(): Promise<string[]> {
  const buckets = await getDefaultBackend().listBuckets()
  return buckets.map((b) => b.name)
}
