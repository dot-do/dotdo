/**
 * @dotdo/gcs/backend - Storage Backend Abstraction
 *
 * Provides a unified storage interface that can be backed by:
 * - In-memory storage (for testing)
 * - Cloudflare R2 (for production)
 *
 * @example
 * ```typescript
 * import { MemoryBackend, R2Backend } from '@dotdo/gcs/backend'
 *
 * // For testing
 * const memoryBackend = new MemoryBackend()
 *
 * // For production
 * const r2Backend = new R2Backend(env.MY_BUCKET)
 * ```
 */

import type {
  InternalBucket,
  InternalFile,
  InternalFileVersion,
  InternalResumableUpload,
  BucketMetadata,
  FileMetadata,
  NotificationMetadata,
  StorageClass,
  LifecycleRule,
} from './types'

// =============================================================================
// Storage Backend Interface
// =============================================================================

export interface StorageBackend {
  // Bucket operations
  createBucket(name: string, metadata: BucketMetadata): Promise<void>
  getBucket(name: string): Promise<InternalBucket | null>
  deleteBucket(name: string): Promise<void>
  listBuckets(): Promise<InternalBucket[]>
  bucketExists(name: string): Promise<boolean>
  updateBucketMetadata(name: string, metadata: Partial<BucketMetadata>): Promise<void>

  // File operations
  putFile(bucket: string, key: string, body: Uint8Array, metadata: FileMetadata): Promise<void>
  getFile(bucket: string, key: string): Promise<InternalFile | null>
  deleteFile(bucket: string, key: string): Promise<void>
  listFiles(bucket: string, options?: ListFilesOptions): Promise<ListFilesResult>
  fileExists(bucket: string, key: string): Promise<boolean>
  updateFileMetadata(bucket: string, key: string, metadata: Partial<FileMetadata>): Promise<void>

  // Versioning operations
  getFileVersion(bucket: string, key: string, generation: string): Promise<InternalFileVersion | null>
  listFileVersions(bucket: string, key: string): Promise<InternalFileVersion[]>
  deleteFileVersion(bucket: string, key: string, generation: string): Promise<void>

  // Resumable upload operations
  createResumableUpload(upload: InternalResumableUpload): Promise<void>
  getResumableUpload(uri: string): Promise<InternalResumableUpload | null>
  updateResumableUpload(uri: string, update: Partial<InternalResumableUpload>): Promise<void>
  deleteResumableUpload(uri: string): Promise<void>

  // Notification operations
  createNotification(bucket: string, notification: NotificationMetadata): Promise<void>
  getNotification(bucket: string, id: string): Promise<NotificationMetadata | null>
  deleteNotification(bucket: string, id: string): Promise<void>
  listNotifications(bucket: string): Promise<NotificationMetadata[]>

  // Utility
  clear(): void
}

export interface ListFilesOptions {
  prefix?: string
  delimiter?: string
  maxResults?: number
  pageToken?: string
  versions?: boolean
  startOffset?: string
  endOffset?: string
}

export interface ListFilesResult {
  files: InternalFile[]
  prefixes: string[]
  nextPageToken?: string
}

// =============================================================================
// Memory Backend
// =============================================================================

/**
 * In-memory storage backend for testing
 */
export class MemoryBackend implements StorageBackend {
  private buckets: Map<string, InternalBucket> = new Map()
  private resumableUploads: Map<string, InternalResumableUpload> = new Map()

  // ---------------------------------------------------------------------------
  // Bucket Operations
  // ---------------------------------------------------------------------------

  async createBucket(name: string, metadata: BucketMetadata): Promise<void> {
    const bucket: InternalBucket = {
      name,
      metadata,
      files: new Map(),
      notifications: new Map(),
    }
    this.buckets.set(name, bucket)
  }

  async getBucket(name: string): Promise<InternalBucket | null> {
    return this.buckets.get(name) || null
  }

  async deleteBucket(name: string): Promise<void> {
    this.buckets.delete(name)
  }

  async listBuckets(): Promise<InternalBucket[]> {
    return Array.from(this.buckets.values())
  }

  async bucketExists(name: string): Promise<boolean> {
    return this.buckets.has(name)
  }

  async updateBucketMetadata(name: string, metadata: Partial<BucketMetadata>): Promise<void> {
    const bucket = this.buckets.get(name)
    if (bucket) {
      bucket.metadata = { ...bucket.metadata, ...metadata }
    }
  }

  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------

  async putFile(bucketName: string, key: string, body: Uint8Array, metadata: FileMetadata): Promise<void> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return

    const existing = bucket.files.get(key)
    const isVersioned = bucket.metadata.versioning?.enabled

    // If versioning is enabled, save the current version
    if (isVersioned && existing) {
      if (!existing.versions) {
        existing.versions = []
      }
      existing.versions.push({
        generation: existing.metadata.generation || '1',
        body: existing.body,
        metadata: existing.metadata,
        isLive: false,
      })
    }

    // Generate new generation number
    const generation = Date.now().toString()

    const file: InternalFile = {
      name: key,
      bucket: bucketName,
      body,
      metadata: {
        ...metadata,
        generation,
        metageneration: '1',
        updated: new Date().toISOString(),
      },
      versions: isVersioned && existing?.versions ? existing.versions : undefined,
    }

    bucket.files.set(key, file)
  }

  async getFile(bucketName: string, key: string): Promise<InternalFile | null> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return null
    return bucket.files.get(key) || null
  }

  async deleteFile(bucketName: string, key: string): Promise<void> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return

    const isVersioned = bucket.metadata.versioning?.enabled
    const file = bucket.files.get(key)

    if (isVersioned && file) {
      // Add a delete marker
      if (!file.versions) {
        file.versions = []
      }
      file.versions.push({
        generation: file.metadata.generation || '1',
        body: file.body,
        metadata: file.metadata,
        isLive: false,
        deletedTime: new Date(),
      })
      bucket.files.delete(key)
    } else {
      bucket.files.delete(key)
    }
  }

  async listFiles(bucketName: string, options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return { files: [], prefixes: [] }

    let files = Array.from(bucket.files.values())
    const prefixes: Set<string> = new Set()

    // Apply prefix filter
    if (options.prefix) {
      files = files.filter((f) => f.name.startsWith(options.prefix!))
    }

    // Apply start/end offset
    if (options.startOffset) {
      files = files.filter((f) => f.name >= options.startOffset!)
    }
    if (options.endOffset) {
      files = files.filter((f) => f.name < options.endOffset!)
    }

    // Sort by name
    files.sort((a, b) => a.name.localeCompare(b.name))

    // Apply delimiter for "folder" simulation
    if (options.delimiter) {
      const basePrefix = options.prefix || ''
      const filteredFiles: InternalFile[] = []

      for (const file of files) {
        const relativePath = file.name.slice(basePrefix.length)
        const delimiterIndex = relativePath.indexOf(options.delimiter)

        if (delimiterIndex >= 0) {
          // This is a "subfolder" - add to prefixes
          const prefix = basePrefix + relativePath.slice(0, delimiterIndex + 1)
          prefixes.add(prefix)
        } else {
          // This is a direct file
          filteredFiles.push(file)
        }
      }

      files = filteredFiles
    }

    // Apply pagination
    let startIndex = 0
    if (options.pageToken) {
      const decodedToken = JSON.parse(atob(options.pageToken)) as { lastKey: string }
      startIndex = files.findIndex((f) => f.name > decodedToken.lastKey)
      if (startIndex < 0) startIndex = files.length
    }

    const maxResults = options.maxResults || 1000
    const pageFiles = files.slice(startIndex, startIndex + maxResults)
    const hasMore = startIndex + maxResults < files.length

    let nextPageToken: string | undefined
    if (hasMore && pageFiles.length > 0) {
      nextPageToken = btoa(JSON.stringify({ lastKey: pageFiles[pageFiles.length - 1].name }))
    }

    return {
      files: pageFiles,
      prefixes: Array.from(prefixes).sort(),
      nextPageToken,
    }
  }

  async fileExists(bucketName: string, key: string): Promise<boolean> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return false
    return bucket.files.has(key)
  }

  async updateFileMetadata(
    bucketName: string,
    key: string,
    metadata: Partial<FileMetadata>
  ): Promise<void> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return

    const file = bucket.files.get(key)
    if (file) {
      file.metadata = {
        ...file.metadata,
        ...metadata,
        metageneration: String(parseInt(file.metadata.metageneration || '0') + 1),
        updated: new Date().toISOString(),
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Versioning Operations
  // ---------------------------------------------------------------------------

  async getFileVersion(
    bucketName: string,
    key: string,
    generation: string
  ): Promise<InternalFileVersion | null> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return null

    const file = bucket.files.get(key)
    if (!file) return null

    // Check if current version matches
    if (file.metadata.generation === generation) {
      return {
        generation,
        body: file.body,
        metadata: file.metadata,
        isLive: true,
      }
    }

    // Check historical versions
    return file.versions?.find((v) => v.generation === generation) || null
  }

  async listFileVersions(bucketName: string, key: string): Promise<InternalFileVersion[]> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return []

    const file = bucket.files.get(key)
    if (!file) return []

    const versions: InternalFileVersion[] = []

    // Add current version
    versions.push({
      generation: file.metadata.generation || '1',
      body: file.body,
      metadata: file.metadata,
      isLive: true,
    })

    // Add historical versions
    if (file.versions) {
      versions.push(...file.versions)
    }

    // Sort by generation descending (newest first)
    versions.sort((a, b) => parseInt(b.generation) - parseInt(a.generation))

    return versions
  }

  async deleteFileVersion(bucketName: string, key: string, generation: string): Promise<void> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return

    const file = bucket.files.get(key)
    if (!file) return

    // If deleting current version
    if (file.metadata.generation === generation) {
      // Restore previous version if available
      if (file.versions && file.versions.length > 0) {
        const previousVersion = file.versions.pop()!
        file.body = previousVersion.body
        file.metadata = previousVersion.metadata
      } else {
        bucket.files.delete(key)
      }
    } else {
      // Delete from versions
      if (file.versions) {
        file.versions = file.versions.filter((v) => v.generation !== generation)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Resumable Upload Operations
  // ---------------------------------------------------------------------------

  async createResumableUpload(upload: InternalResumableUpload): Promise<void> {
    this.resumableUploads.set(upload.uri, upload)
  }

  async getResumableUpload(uri: string): Promise<InternalResumableUpload | null> {
    return this.resumableUploads.get(uri) || null
  }

  async updateResumableUpload(
    uri: string,
    update: Partial<InternalResumableUpload>
  ): Promise<void> {
    const upload = this.resumableUploads.get(uri)
    if (upload) {
      Object.assign(upload, update)
    }
  }

  async deleteResumableUpload(uri: string): Promise<void> {
    this.resumableUploads.delete(uri)
  }

  // ---------------------------------------------------------------------------
  // Notification Operations
  // ---------------------------------------------------------------------------

  async createNotification(bucketName: string, notification: NotificationMetadata): Promise<void> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return

    bucket.notifications.set(notification.id!, notification)
  }

  async getNotification(bucketName: string, id: string): Promise<NotificationMetadata | null> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return null

    return bucket.notifications.get(id) || null
  }

  async deleteNotification(bucketName: string, id: string): Promise<void> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return

    bucket.notifications.delete(id)
  }

  async listNotifications(bucketName: string): Promise<NotificationMetadata[]> {
    const bucket = this.buckets.get(bucketName)
    if (!bucket) return []

    return Array.from(bucket.notifications.values())
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  clear(): void {
    this.buckets.clear()
    this.resumableUploads.clear()
  }
}

// =============================================================================
// R2 Backend
// =============================================================================

/**
 * Cloudflare R2 storage backend for production use
 */
export class R2Backend implements StorageBackend {
  private r2: R2Bucket
  private metadataPrefix = '__gcs_metadata__/'
  private bucketsKey = '__gcs_buckets__'
  private uploadsKey = '__gcs_uploads__'

  constructor(r2Bucket: R2Bucket) {
    this.r2 = r2Bucket
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private bucketMetaKey(name: string): string {
    return `${this.metadataPrefix}buckets/${name}/metadata.json`
  }

  private fileMetaKey(bucket: string, key: string): string {
    return `${this.metadataPrefix}buckets/${bucket}/files/${key}/metadata.json`
  }

  private fileVersionsKey(bucket: string, key: string): string {
    return `${this.metadataPrefix}buckets/${bucket}/files/${key}/versions.json`
  }

  private notificationsKey(bucket: string): string {
    return `${this.metadataPrefix}buckets/${bucket}/notifications.json`
  }

  private uploadsMetaKey(): string {
    return `${this.metadataPrefix}uploads.json`
  }

  private objectKey(bucket: string, key: string): string {
    return `${bucket}/${key}`
  }

  private async readJson<T>(key: string): Promise<T | null> {
    const obj = await this.r2.get(key)
    if (!obj) return null
    return (await obj.json()) as T
  }

  private async writeJson<T>(key: string, data: T): Promise<void> {
    await this.r2.put(key, JSON.stringify(data))
  }

  // ---------------------------------------------------------------------------
  // Bucket Operations
  // ---------------------------------------------------------------------------

  async createBucket(name: string, metadata: BucketMetadata): Promise<void> {
    await this.writeJson(this.bucketMetaKey(name), metadata)
    await this.writeJson(this.notificationsKey(name), {})
  }

  async getBucket(name: string): Promise<InternalBucket | null> {
    const metadata = await this.readJson<BucketMetadata>(this.bucketMetaKey(name))
    if (!metadata) return null

    return {
      name,
      metadata,
      files: new Map(), // Files are fetched separately
      notifications: new Map(),
    }
  }

  async deleteBucket(name: string): Promise<void> {
    await this.r2.delete(this.bucketMetaKey(name))
    await this.r2.delete(this.notificationsKey(name))
  }

  async listBuckets(): Promise<InternalBucket[]> {
    const list = await this.r2.list({
      prefix: `${this.metadataPrefix}buckets/`,
      delimiter: '/',
    })

    const buckets: InternalBucket[] = []

    for (const prefix of list.delimitedPrefixes || []) {
      const bucketName = prefix.replace(`${this.metadataPrefix}buckets/`, '').replace('/', '')
      const bucket = await this.getBucket(bucketName)
      if (bucket) buckets.push(bucket)
    }

    return buckets
  }

  async bucketExists(name: string): Promise<boolean> {
    const obj = await this.r2.head(this.bucketMetaKey(name))
    return obj !== null
  }

  async updateBucketMetadata(name: string, metadata: Partial<BucketMetadata>): Promise<void> {
    const existing = await this.readJson<BucketMetadata>(this.bucketMetaKey(name))
    if (existing) {
      await this.writeJson(this.bucketMetaKey(name), { ...existing, ...metadata })
    }
  }

  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------

  async putFile(
    bucketName: string,
    key: string,
    body: Uint8Array,
    metadata: FileMetadata
  ): Promise<void> {
    const objKey = this.objectKey(bucketName, key)

    // Store object body in R2
    await this.r2.put(objKey, body, {
      customMetadata: {
        contentType: metadata.contentType || 'application/octet-stream',
        ...(metadata.metadata || {}),
      },
      httpMetadata: {
        contentType: metadata.contentType || 'application/octet-stream',
        cacheControl: metadata.cacheControl,
        contentDisposition: metadata.contentDisposition,
        contentEncoding: metadata.contentEncoding,
        contentLanguage: metadata.contentLanguage,
      },
    })

    // Store metadata separately
    await this.writeJson(this.fileMetaKey(bucketName, key), metadata)
  }

  async getFile(bucketName: string, key: string): Promise<InternalFile | null> {
    const objKey = this.objectKey(bucketName, key)
    const obj = await this.r2.get(objKey)
    if (!obj) return null

    const metadata = await this.readJson<FileMetadata>(this.fileMetaKey(bucketName, key))
    const body = new Uint8Array(await obj.arrayBuffer())

    return {
      name: key,
      bucket: bucketName,
      body,
      metadata: metadata || {
        name: key,
        bucket: bucketName,
        size: String(body.length),
        contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
        timeCreated: obj.uploaded?.toISOString(),
        updated: obj.uploaded?.toISOString(),
      },
    }
  }

  async deleteFile(bucketName: string, key: string): Promise<void> {
    const objKey = this.objectKey(bucketName, key)
    await this.r2.delete(objKey)
    await this.r2.delete(this.fileMetaKey(bucketName, key))
  }

  async listFiles(bucketName: string, options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const prefix = options.prefix ? `${bucketName}/${options.prefix}` : `${bucketName}/`

    const listOptions: R2ListOptions = {
      prefix,
      delimiter: options.delimiter,
      limit: options.maxResults || 1000,
      cursor: options.pageToken,
      startAfter: options.startOffset ? `${bucketName}/${options.startOffset}` : undefined,
    }

    const list = await this.r2.list(listOptions)

    const files: InternalFile[] = []
    for (const obj of list.objects) {
      const key = obj.key.slice(bucketName.length + 1) // Remove bucket prefix
      const metadata = await this.readJson<FileMetadata>(this.fileMetaKey(bucketName, key))

      files.push({
        name: key,
        bucket: bucketName,
        body: new Uint8Array(0), // Don't load body for list operations
        metadata: metadata || {
          name: key,
          bucket: bucketName,
          size: String(obj.size),
          etag: obj.etag,
          timeCreated: obj.uploaded?.toISOString(),
          updated: obj.uploaded?.toISOString(),
        },
      })
    }

    const prefixes = (list.delimitedPrefixes || []).map((p) =>
      p.slice(bucketName.length + 1)
    )

    return {
      files,
      prefixes,
      nextPageToken: list.truncated ? list.cursor : undefined,
    }
  }

  async fileExists(bucketName: string, key: string): Promise<boolean> {
    const objKey = this.objectKey(bucketName, key)
    const obj = await this.r2.head(objKey)
    return obj !== null
  }

  async updateFileMetadata(
    bucketName: string,
    key: string,
    metadata: Partial<FileMetadata>
  ): Promise<void> {
    const existing = await this.readJson<FileMetadata>(this.fileMetaKey(bucketName, key))
    if (existing) {
      await this.writeJson(this.fileMetaKey(bucketName, key), { ...existing, ...metadata })
    }
  }

  // ---------------------------------------------------------------------------
  // Versioning Operations
  // ---------------------------------------------------------------------------

  async getFileVersion(
    bucketName: string,
    key: string,
    generation: string
  ): Promise<InternalFileVersion | null> {
    const versions = await this.readJson<InternalFileVersion[]>(
      this.fileVersionsKey(bucketName, key)
    )
    return versions?.find((v) => v.generation === generation) || null
  }

  async listFileVersions(bucketName: string, key: string): Promise<InternalFileVersion[]> {
    const versions = await this.readJson<InternalFileVersion[]>(
      this.fileVersionsKey(bucketName, key)
    )
    return versions || []
  }

  async deleteFileVersion(bucketName: string, key: string, generation: string): Promise<void> {
    const versions = await this.readJson<InternalFileVersion[]>(
      this.fileVersionsKey(bucketName, key)
    )
    if (versions) {
      const filtered = versions.filter((v) => v.generation !== generation)
      await this.writeJson(this.fileVersionsKey(bucketName, key), filtered)
    }
  }

  // ---------------------------------------------------------------------------
  // Resumable Upload Operations
  // ---------------------------------------------------------------------------

  async createResumableUpload(upload: InternalResumableUpload): Promise<void> {
    const uploads = (await this.readJson<Record<string, InternalResumableUpload>>(
      this.uploadsMetaKey()
    )) || {}
    uploads[upload.uri] = upload
    await this.writeJson(this.uploadsMetaKey(), uploads)
  }

  async getResumableUpload(uri: string): Promise<InternalResumableUpload | null> {
    const uploads = await this.readJson<Record<string, InternalResumableUpload>>(
      this.uploadsMetaKey()
    )
    return uploads?.[uri] || null
  }

  async updateResumableUpload(
    uri: string,
    update: Partial<InternalResumableUpload>
  ): Promise<void> {
    const uploads = (await this.readJson<Record<string, InternalResumableUpload>>(
      this.uploadsMetaKey()
    )) || {}
    if (uploads[uri]) {
      uploads[uri] = { ...uploads[uri], ...update }
      await this.writeJson(this.uploadsMetaKey(), uploads)
    }
  }

  async deleteResumableUpload(uri: string): Promise<void> {
    const uploads = (await this.readJson<Record<string, InternalResumableUpload>>(
      this.uploadsMetaKey()
    )) || {}
    delete uploads[uri]
    await this.writeJson(this.uploadsMetaKey(), uploads)
  }

  // ---------------------------------------------------------------------------
  // Notification Operations
  // ---------------------------------------------------------------------------

  async createNotification(
    bucketName: string,
    notification: NotificationMetadata
  ): Promise<void> {
    const notifications = (await this.readJson<Record<string, NotificationMetadata>>(
      this.notificationsKey(bucketName)
    )) || {}
    notifications[notification.id!] = notification
    await this.writeJson(this.notificationsKey(bucketName), notifications)
  }

  async getNotification(bucketName: string, id: string): Promise<NotificationMetadata | null> {
    const notifications = await this.readJson<Record<string, NotificationMetadata>>(
      this.notificationsKey(bucketName)
    )
    return notifications?.[id] || null
  }

  async deleteNotification(bucketName: string, id: string): Promise<void> {
    const notifications = (await this.readJson<Record<string, NotificationMetadata>>(
      this.notificationsKey(bucketName)
    )) || {}
    delete notifications[id]
    await this.writeJson(this.notificationsKey(bucketName), notifications)
  }

  async listNotifications(bucketName: string): Promise<NotificationMetadata[]> {
    const notifications = await this.readJson<Record<string, NotificationMetadata>>(
      this.notificationsKey(bucketName)
    )
    return notifications ? Object.values(notifications) : []
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  clear(): void {
    // R2 doesn't support bulk delete, so this is a no-op in production
    // For testing, use the MemoryBackend instead
    console.warn('R2Backend.clear() is a no-op in production')
  }
}

// =============================================================================
// Default Backend Instance
// =============================================================================

let defaultBackend: StorageBackend = new MemoryBackend()

/**
 * Get the default storage backend
 */
export function getDefaultBackend(): StorageBackend {
  return defaultBackend
}

/**
 * Set the default storage backend
 */
export function setDefaultBackend(backend: StorageBackend): void {
  defaultBackend = backend
}

/**
 * Reset to memory backend (for testing)
 */
export function resetToMemoryBackend(): void {
  defaultBackend = new MemoryBackend()
}
