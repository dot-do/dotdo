/**
 * @dotdo/supabase/storage/backend - Storage Backend Abstraction
 *
 * Provides pluggable storage backends for the Supabase Storage compat layer:
 * - MemoryBackend: In-memory storage for testing
 * - R2Backend: Cloudflare R2 for production
 */

import type {
  InternalBucket,
  InternalFile,
  Bucket,
  FileObject,
  FileObjectV2,
  FileMetadata,
  SearchOptions,
  TransformOptions,
} from './types'

// =============================================================================
// Storage Backend Interface
// =============================================================================

export interface StorageBackend {
  // Bucket operations
  createBucket(bucket: InternalBucket): Promise<void>
  getBucket(id: string): Promise<InternalBucket | null>
  listBuckets(): Promise<InternalBucket[]>
  updateBucket(id: string, updates: Partial<InternalBucket>): Promise<void>
  deleteBucket(id: string): Promise<void>
  bucketExists(id: string): Promise<boolean>
  bucketIsEmpty(id: string): Promise<boolean>

  // File operations
  putFile(bucketId: string, path: string, file: InternalFile): Promise<void>
  getFile(bucketId: string, path: string): Promise<InternalFile | null>
  headFile(bucketId: string, path: string): Promise<Omit<InternalFile, 'body'> | null>
  deleteFile(bucketId: string, path: string): Promise<boolean>
  copyFile(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<void>
  moveFile(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<void>
  listFiles(
    bucketId: string,
    prefix: string,
    options?: SearchOptions
  ): Promise<{ files: InternalFile[]; folders: string[] }>
  fileExists(bucketId: string, path: string): Promise<boolean>

  // Utility
  clear(): void
}

// =============================================================================
// Memory Backend
// =============================================================================

export class MemoryBackend implements StorageBackend {
  private buckets = new Map<string, InternalBucket>()

  async createBucket(bucket: InternalBucket): Promise<void> {
    this.buckets.set(bucket.id, {
      ...bucket,
      files: new Map(),
    })
  }

  async getBucket(id: string): Promise<InternalBucket | null> {
    return this.buckets.get(id) ?? null
  }

  async listBuckets(): Promise<InternalBucket[]> {
    return Array.from(this.buckets.values())
  }

  async updateBucket(id: string, updates: Partial<InternalBucket>): Promise<void> {
    const bucket = this.buckets.get(id)
    if (bucket) {
      Object.assign(bucket, updates, { updatedAt: new Date() })
    }
  }

  async deleteBucket(id: string): Promise<void> {
    this.buckets.delete(id)
  }

  async bucketExists(id: string): Promise<boolean> {
    return this.buckets.has(id)
  }

  async bucketIsEmpty(id: string): Promise<boolean> {
    const bucket = this.buckets.get(id)
    return !bucket || bucket.files.size === 0
  }

  async putFile(bucketId: string, path: string, file: InternalFile): Promise<void> {
    const bucket = this.buckets.get(bucketId)
    if (bucket) {
      bucket.files.set(path, file)
    }
  }

  async getFile(bucketId: string, path: string): Promise<InternalFile | null> {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) return null

    const file = bucket.files.get(path)
    if (!file) return null

    // Update last accessed time
    file.lastAccessedAt = new Date()
    return file
  }

  async headFile(bucketId: string, path: string): Promise<Omit<InternalFile, 'body'> | null> {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) return null

    const file = bucket.files.get(path)
    if (!file) return null

    const { body: _, ...metadata } = file
    return metadata
  }

  async deleteFile(bucketId: string, path: string): Promise<boolean> {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) return false
    return bucket.files.delete(path)
  }

  async copyFile(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<void> {
    const source = this.buckets.get(sourceBucket)
    const dest = this.buckets.get(destBucket)

    if (!source || !dest) return

    const file = source.files.get(sourcePath)
    if (!file) return

    const now = new Date()
    dest.files.set(destPath, {
      ...file,
      name: destPath.split('/').pop() || destPath,
      bucketId: destBucket,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    })
  }

  async moveFile(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<void> {
    await this.copyFile(sourceBucket, sourcePath, destBucket, destPath)
    await this.deleteFile(sourceBucket, sourcePath)
  }

  async listFiles(
    bucketId: string,
    prefix: string,
    options?: SearchOptions
  ): Promise<{ files: InternalFile[]; folders: string[] }> {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) return { files: [], folders: [] }

    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix ? `${prefix}/` : ''
    const foldersSet = new Set<string>()
    const files: InternalFile[] = []

    for (const [path, file] of bucket.files) {
      // Check if file matches prefix
      if (!path.startsWith(normalizedPrefix) && prefix !== '') continue
      if (prefix === '' && !path.startsWith(normalizedPrefix)) {
        // Root level listing
      }

      const relativePath = prefix ? path.slice(normalizedPrefix.length) : path

      // Check if it's in a subfolder
      const slashIndex = relativePath.indexOf('/')
      if (slashIndex !== -1) {
        // It's in a subfolder
        const folderName = relativePath.slice(0, slashIndex)
        foldersSet.add(normalizedPrefix + folderName)
      } else if (relativePath) {
        // It's a file at this level
        files.push(file)
      }
    }

    // Apply search filter
    let filteredFiles = files
    if (options?.search) {
      const search = options.search.toLowerCase()
      filteredFiles = files.filter((f) =>
        f.name.toLowerCase().includes(search)
      )
    }

    // Apply sorting
    if (options?.sortBy) {
      const { column, order } = options.sortBy
      filteredFiles.sort((a, b) => {
        let aVal: string | Date
        let bVal: string | Date

        switch (column) {
          case 'name':
            aVal = a.name
            bVal = b.name
            break
          case 'updated_at':
            aVal = a.updatedAt
            bVal = b.updatedAt
            break
          case 'created_at':
            aVal = a.createdAt
            bVal = b.createdAt
            break
          case 'last_accessed_at':
            aVal = a.lastAccessedAt
            bVal = b.lastAccessedAt
            break
          default:
            return 0
        }

        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return order === 'desc' ? -comparison : comparison
      })
    }

    // Apply pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 100
    const paginatedFiles = filteredFiles.slice(offset, offset + limit)

    return {
      files: paginatedFiles,
      folders: Array.from(foldersSet),
    }
  }

  async fileExists(bucketId: string, path: string): Promise<boolean> {
    const bucket = this.buckets.get(bucketId)
    return bucket?.files.has(path) ?? false
  }

  clear(): void {
    this.buckets.clear()
  }
}

// =============================================================================
// R2 Backend
// =============================================================================

export class R2Backend implements StorageBackend {
  private r2: R2Bucket
  private metadataPrefix = '__metadata__/'

  constructor(r2Bucket: R2Bucket) {
    this.r2 = r2Bucket
  }

  private bucketMetadataKey(id: string): string {
    return `${this.metadataPrefix}buckets/${id}`
  }

  private fileKey(bucketId: string, path: string): string {
    return `${bucketId}/${path}`
  }

  async createBucket(bucket: InternalBucket): Promise<void> {
    const metadata = {
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      allowedMimeTypes: bucket.allowedMimeTypes,
      fileSizeLimit: bucket.fileSizeLimit,
      createdAt: bucket.createdAt.toISOString(),
      updatedAt: bucket.updatedAt.toISOString(),
    }

    await this.r2.put(
      this.bucketMetadataKey(bucket.id),
      JSON.stringify(metadata),
      { customMetadata: { type: 'bucket' } }
    )
  }

  async getBucket(id: string): Promise<InternalBucket | null> {
    const obj = await this.r2.get(this.bucketMetadataKey(id))
    if (!obj) return null

    const data = JSON.parse(await obj.text())
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      files: new Map(), // Files are stored separately
    }
  }

  async listBuckets(): Promise<InternalBucket[]> {
    const list = await this.r2.list({ prefix: `${this.metadataPrefix}buckets/` })
    const buckets: InternalBucket[] = []

    for (const obj of list.objects) {
      const data = await this.r2.get(obj.key)
      if (data) {
        const parsed = JSON.parse(await data.text())
        buckets.push({
          ...parsed,
          createdAt: new Date(parsed.createdAt),
          updatedAt: new Date(parsed.updatedAt),
          files: new Map(),
        })
      }
    }

    return buckets
  }

  async updateBucket(id: string, updates: Partial<InternalBucket>): Promise<void> {
    const bucket = await this.getBucket(id)
    if (!bucket) return

    const updated = {
      ...bucket,
      ...updates,
      updatedAt: new Date(),
      files: undefined, // Don't store files in metadata
    }

    await this.r2.put(
      this.bucketMetadataKey(id),
      JSON.stringify({
        ...updated,
        createdAt: bucket.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      }),
      { customMetadata: { type: 'bucket' } }
    )
  }

  async deleteBucket(id: string): Promise<void> {
    // Delete bucket metadata
    await this.r2.delete(this.bucketMetadataKey(id))

    // Delete all files in bucket
    const list = await this.r2.list({ prefix: `${id}/` })
    for (const obj of list.objects) {
      await this.r2.delete(obj.key)
    }
  }

  async bucketExists(id: string): Promise<boolean> {
    const obj = await this.r2.head(this.bucketMetadataKey(id))
    return obj !== null
  }

  async bucketIsEmpty(id: string): Promise<boolean> {
    const list = await this.r2.list({ prefix: `${id}/`, limit: 1 })
    return list.objects.length === 0
  }

  async putFile(bucketId: string, path: string, file: InternalFile): Promise<void> {
    const key = this.fileKey(bucketId, path)
    await this.r2.put(key, file.body, {
      httpMetadata: {
        contentType: file.contentType,
        cacheControl: file.cacheControl,
      },
      customMetadata: {
        ...file.metadata,
        name: file.name,
        bucketId: file.bucketId,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
        lastAccessedAt: file.lastAccessedAt.toISOString(),
      },
    })
  }

  async getFile(bucketId: string, path: string): Promise<InternalFile | null> {
    const key = this.fileKey(bucketId, path)
    const obj = await this.r2.get(key)
    if (!obj) return null

    const body = new Uint8Array(await obj.arrayBuffer())
    const meta = obj.customMetadata || {}

    return {
      name: meta.name || path.split('/').pop() || path,
      bucketId,
      body,
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      cacheControl: obj.httpMetadata?.cacheControl || 'max-age=3600',
      metadata: Object.fromEntries(
        Object.entries(meta).filter(([k]) =>
          !['name', 'bucketId', 'createdAt', 'updatedAt', 'lastAccessedAt'].includes(k)
        )
      ),
      createdAt: meta.createdAt ? new Date(meta.createdAt) : new Date(),
      updatedAt: meta.updatedAt ? new Date(meta.updatedAt) : new Date(),
      lastAccessedAt: new Date(),
    }
  }

  async headFile(bucketId: string, path: string): Promise<Omit<InternalFile, 'body'> | null> {
    const key = this.fileKey(bucketId, path)
    const obj = await this.r2.head(key)
    if (!obj) return null

    const meta = obj.customMetadata || {}

    return {
      name: meta.name || path.split('/').pop() || path,
      bucketId,
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      cacheControl: obj.httpMetadata?.cacheControl || 'max-age=3600',
      metadata: Object.fromEntries(
        Object.entries(meta).filter(([k]) =>
          !['name', 'bucketId', 'createdAt', 'updatedAt', 'lastAccessedAt'].includes(k)
        )
      ),
      createdAt: meta.createdAt ? new Date(meta.createdAt) : new Date(),
      updatedAt: meta.updatedAt ? new Date(meta.updatedAt) : new Date(),
      lastAccessedAt: new Date(),
    }
  }

  async deleteFile(bucketId: string, path: string): Promise<boolean> {
    const key = this.fileKey(bucketId, path)
    const exists = await this.r2.head(key)
    if (!exists) return false

    await this.r2.delete(key)
    return true
  }

  async copyFile(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<void> {
    const source = await this.getFile(sourceBucket, sourcePath)
    if (!source) return

    const now = new Date()
    await this.putFile(destBucket, destPath, {
      ...source,
      name: destPath.split('/').pop() || destPath,
      bucketId: destBucket,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    })
  }

  async moveFile(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<void> {
    await this.copyFile(sourceBucket, sourcePath, destBucket, destPath)
    await this.deleteFile(sourceBucket, sourcePath)
  }

  async listFiles(
    bucketId: string,
    prefix: string,
    options?: SearchOptions
  ): Promise<{ files: InternalFile[]; folders: string[] }> {
    const normalizedPrefix = prefix ? `${bucketId}/${prefix}` : `${bucketId}/`
    const list = await this.r2.list({
      prefix: normalizedPrefix,
      limit: 1000,
    })

    const foldersSet = new Set<string>()
    const files: InternalFile[] = []
    const baseLen = `${bucketId}/`.length

    for (const obj of list.objects) {
      const relativePath = obj.key.slice(baseLen)
      const afterPrefix = prefix ? relativePath.slice(prefix.length + 1) : relativePath

      const slashIndex = afterPrefix.indexOf('/')
      if (slashIndex !== -1) {
        const folderName = afterPrefix.slice(0, slashIndex)
        foldersSet.add(prefix ? `${prefix}/${folderName}` : folderName)
      } else if (afterPrefix) {
        const file = await this.getFile(bucketId, relativePath)
        if (file) files.push(file)
      }
    }

    // Apply search filter
    let filteredFiles = files
    if (options?.search) {
      const search = options.search.toLowerCase()
      filteredFiles = files.filter((f) =>
        f.name.toLowerCase().includes(search)
      )
    }

    // Apply sorting
    if (options?.sortBy) {
      const { column, order } = options.sortBy
      filteredFiles.sort((a, b) => {
        let aVal: string | Date
        let bVal: string | Date

        switch (column) {
          case 'name':
            aVal = a.name
            bVal = b.name
            break
          case 'updated_at':
            aVal = a.updatedAt
            bVal = b.updatedAt
            break
          case 'created_at':
            aVal = a.createdAt
            bVal = b.createdAt
            break
          case 'last_accessed_at':
            aVal = a.lastAccessedAt
            bVal = b.lastAccessedAt
            break
          default:
            return 0
        }

        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return order === 'desc' ? -comparison : comparison
      })
    }

    // Apply pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 100
    const paginatedFiles = filteredFiles.slice(offset, offset + limit)

    return {
      files: paginatedFiles,
      folders: Array.from(foldersSet),
    }
  }

  async fileExists(bucketId: string, path: string): Promise<boolean> {
    const key = this.fileKey(bucketId, path)
    const obj = await this.r2.head(key)
    return obj !== null
  }

  clear(): void {
    // R2 doesn't support clearing all objects easily
    // This would require listing and deleting all objects
    console.warn('R2Backend.clear() is not implemented')
  }
}

// =============================================================================
// Default Backend Management
// =============================================================================

let defaultBackend: StorageBackend = new MemoryBackend()

export function getDefaultBackend(): StorageBackend {
  return defaultBackend
}

export function setDefaultBackend(backend: StorageBackend): void {
  defaultBackend = backend
}

export function resetToMemoryBackend(): void {
  defaultBackend = new MemoryBackend()
}
