/**
 * @dotdo/s3/backend - Storage Backend Abstraction
 *
 * Provides pluggable storage backends for the S3 compat layer:
 * - MemoryBackend: In-memory storage for testing
 * - R2Backend: Cloudflare R2 for production
 *
 * @example
 * ```typescript
 * // Use in-memory backend for testing
 * const client = new S3Client({ useMemoryStorage: true })
 *
 * // Use R2 backend for production
 * const client = new S3Client({ r2Bucket: env.MY_BUCKET })
 * ```
 */

import type {
  InternalBucket,
  InternalObject,
  InternalMultipartUpload,
  InternalPart,
  StorageClass,
} from './types'

// =============================================================================
// Storage Backend Interface
// =============================================================================

export interface StorageBackend {
  // Bucket operations
  createBucket(name: string, region?: string): Promise<void>
  deleteBucket(name: string): Promise<void>
  headBucket(name: string): Promise<InternalBucket>
  listBuckets(): Promise<InternalBucket[]>
  bucketExists(name: string): Promise<boolean>
  bucketIsEmpty(name: string): Promise<boolean>

  // Object operations
  putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    options?: PutObjectOptions
  ): Promise<{ etag: string }>
  getObject(
    bucket: string,
    key: string,
    options?: GetObjectOptions
  ): Promise<InternalObject | null>
  headObject(bucket: string, key: string): Promise<InternalObject | null>
  deleteObject(bucket: string, key: string): Promise<void>
  listObjects(
    bucket: string,
    options?: ListObjectsOptions
  ): Promise<ListObjectsResult>

  // Multipart operations
  createMultipartUpload(
    bucket: string,
    key: string,
    options?: CreateMultipartOptions
  ): Promise<string>
  uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array
  ): Promise<{ etag: string }>
  completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ etag: string }>
  abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string
  ): Promise<void>
  listParts(
    bucket: string,
    key: string,
    uploadId: string,
    options?: ListPartsOptions
  ): Promise<ListPartsResult>
  listMultipartUploads(
    bucket: string,
    options?: ListMultipartUploadsOptions
  ): Promise<ListMultipartUploadsResult>

  // Utility
  clear(): void
}

// =============================================================================
// Backend Option Types
// =============================================================================

export interface PutObjectOptions {
  contentType?: string
  contentEncoding?: string
  cacheControl?: string
  contentDisposition?: string
  contentLanguage?: string
  metadata?: Record<string, string>
  storageClass?: StorageClass
}

export interface GetObjectOptions {
  range?: { start: number; end: number }
}

export interface ListObjectsOptions {
  prefix?: string
  delimiter?: string
  maxKeys?: number
  startAfter?: string
  continuationToken?: string
}

export interface ListObjectsResult {
  objects: InternalObject[]
  commonPrefixes: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}

export interface CreateMultipartOptions {
  contentType?: string
  metadata?: Record<string, string>
}

export interface ListPartsOptions {
  maxParts?: number
  partNumberMarker?: number
}

export interface ListPartsResult {
  parts: InternalPart[]
  isTruncated: boolean
  nextPartNumberMarker?: number
}

export interface ListMultipartUploadsOptions {
  prefix?: string
  delimiter?: string
  maxUploads?: number
  keyMarker?: string
  uploadIdMarker?: string
}

export interface ListMultipartUploadsResult {
  uploads: Array<{
    key: string
    uploadId: string
    initiated: Date
  }>
  commonPrefixes: string[]
  isTruncated: boolean
  nextKeyMarker?: string
  nextUploadIdMarker?: string
}

// =============================================================================
// Memory Backend Implementation
// =============================================================================

/**
 * In-memory storage backend for testing
 */
export class MemoryBackend implements StorageBackend {
  private buckets: Map<string, InternalBucket> = new Map()
  private objects: Map<string, Map<string, InternalObject>> = new Map()
  private multipartUploads: Map<string, InternalMultipartUpload> = new Map()

  // --------------------------------------------------------------------------
  // Bucket Operations
  // --------------------------------------------------------------------------

  async createBucket(name: string, region?: string): Promise<void> {
    this.buckets.set(name, {
      name,
      creationDate: new Date(),
      region,
    })
    this.objects.set(name, new Map())
  }

  async deleteBucket(name: string): Promise<void> {
    this.buckets.delete(name)
    this.objects.delete(name)
  }

  async headBucket(name: string): Promise<InternalBucket> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    return bucket
  }

  async listBuckets(): Promise<InternalBucket[]> {
    return Array.from(this.buckets.values())
  }

  async bucketExists(name: string): Promise<boolean> {
    return this.buckets.has(name)
  }

  async bucketIsEmpty(name: string): Promise<boolean> {
    const bucketObjects = this.objects.get(name)
    return !bucketObjects || bucketObjects.size === 0
  }

  // --------------------------------------------------------------------------
  // Object Operations
  // --------------------------------------------------------------------------

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    options: PutObjectOptions = {}
  ): Promise<{ etag: string }> {
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      throw new Error('NoSuchBucket')
    }

    const etag = generateETag(body)
    const obj: InternalObject = {
      key,
      body,
      contentType: options.contentType,
      contentEncoding: options.contentEncoding,
      cacheControl: options.cacheControl,
      contentDisposition: options.contentDisposition,
      contentLanguage: options.contentLanguage,
      metadata: options.metadata,
      etag,
      lastModified: new Date(),
      size: body.length,
      storageClass: options.storageClass,
    }

    bucketObjects.set(key, obj)
    return { etag }
  }

  async getObject(
    bucket: string,
    key: string,
    options: GetObjectOptions = {}
  ): Promise<InternalObject | null> {
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      throw new Error('NoSuchBucket')
    }

    const obj = bucketObjects.get(key)
    if (!obj) {
      return null
    }

    // Handle range request
    if (options.range) {
      const { start, end } = options.range
      const slicedBody = obj.body.slice(start, end + 1)
      return {
        ...obj,
        body: slicedBody,
        size: slicedBody.length,
      }
    }

    return obj
  }

  async headObject(bucket: string, key: string): Promise<InternalObject | null> {
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      throw new Error('NoSuchBucket')
    }

    return bucketObjects.get(key) || null
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      throw new Error('NoSuchBucket')
    }

    bucketObjects.delete(key)
  }

  async listObjects(
    bucket: string,
    options: ListObjectsOptions = {}
  ): Promise<ListObjectsResult> {
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      throw new Error('NoSuchBucket')
    }

    const { prefix = '', delimiter, maxKeys = 1000, startAfter, continuationToken } = options

    // Get all objects sorted by key
    let allObjects = Array.from(bucketObjects.values())
      .filter((o) => o.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key))

    // Filter by StartAfter or ContinuationToken
    const startKey = continuationToken ? atob(continuationToken) : startAfter
    if (startKey) {
      allObjects = allObjects.filter((o) => o.key > startKey)
    }

    // Handle delimiter (common prefixes)
    const commonPrefixes: Set<string> = new Set()
    let filteredObjects = allObjects

    if (delimiter) {
      filteredObjects = allObjects.filter((o) => {
        const keyAfterPrefix = o.key.slice(prefix.length)
        const delimiterIndex = keyAfterPrefix.indexOf(delimiter)

        if (delimiterIndex >= 0) {
          const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
          commonPrefixes.add(commonPrefix)
          return false
        }
        return true
      })
    }

    // Paginate
    const isTruncated = filteredObjects.length > maxKeys
    const resultObjects = filteredObjects.slice(0, maxKeys)
    const nextContinuationToken = isTruncated
      ? btoa(resultObjects[resultObjects.length - 1].key)
      : undefined

    return {
      objects: resultObjects,
      commonPrefixes: Array.from(commonPrefixes).sort(),
      isTruncated,
      nextContinuationToken,
    }
  }

  // --------------------------------------------------------------------------
  // Multipart Operations
  // --------------------------------------------------------------------------

  async createMultipartUpload(
    bucket: string,
    key: string,
    options: CreateMultipartOptions = {}
  ): Promise<string> {
    if (!this.buckets.has(bucket)) {
      throw new Error('NoSuchBucket')
    }

    const uploadId = crypto.randomUUID()
    this.multipartUploads.set(uploadId, {
      uploadId,
      bucket,
      key,
      initiated: new Date(),
      parts: new Map(),
      contentType: options.contentType,
      metadata: options.metadata,
    })

    return uploadId
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array
  ): Promise<{ etag: string }> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new Error('NoSuchUpload')
    }

    const etag = generateETag(body)
    upload.parts.set(partNumber, {
      partNumber,
      body,
      etag,
      size: body.length,
      lastModified: new Date(),
    })

    return { etag }
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ etag: string }> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new Error('NoSuchUpload')
    }

    // Sort parts and combine
    const sortedParts = parts.slice().sort((a, b) => a.partNumber - b.partNumber)
    const chunks: Uint8Array[] = []

    for (const part of sortedParts) {
      const uploadedPart = upload.parts.get(part.partNumber)
      if (uploadedPart) {
        chunks.push(uploadedPart.body)
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combinedBody = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combinedBody.set(chunk, offset)
      offset += chunk.length
    }

    const etag = `"${generateETag(combinedBody).slice(1, -1)}-${sortedParts.length}"`

    // Store the combined object
    await this.putObject(bucket, key, combinedBody, {
      contentType: upload.contentType,
      metadata: upload.metadata,
    })

    // Update the etag
    const bucketObjects = this.objects.get(bucket)
    if (bucketObjects) {
      const obj = bucketObjects.get(key)
      if (obj) {
        obj.etag = etag
      }
    }

    // Clean up upload
    this.multipartUploads.delete(uploadId)

    return { etag }
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string
  ): Promise<void> {
    if (!this.multipartUploads.has(uploadId)) {
      throw new Error('NoSuchUpload')
    }

    this.multipartUploads.delete(uploadId)
  }

  async listParts(
    bucket: string,
    key: string,
    uploadId: string,
    options: ListPartsOptions = {}
  ): Promise<ListPartsResult> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new Error('NoSuchUpload')
    }

    const { maxParts = 1000, partNumberMarker = 0 } = options

    const allParts = Array.from(upload.parts.values())
      .filter((p) => p.partNumber > partNumberMarker)
      .sort((a, b) => a.partNumber - b.partNumber)

    const isTruncated = allParts.length > maxParts
    const resultParts = allParts.slice(0, maxParts)

    return {
      parts: resultParts,
      isTruncated,
      nextPartNumberMarker: isTruncated
        ? resultParts[resultParts.length - 1].partNumber
        : undefined,
    }
  }

  async listMultipartUploads(
    bucket: string,
    options: ListMultipartUploadsOptions = {}
  ): Promise<ListMultipartUploadsResult> {
    if (!this.buckets.has(bucket)) {
      throw new Error('NoSuchBucket')
    }

    const {
      prefix = '',
      delimiter,
      maxUploads = 1000,
      keyMarker = '',
      uploadIdMarker = '',
    } = options

    // Filter uploads for this bucket
    let uploads = Array.from(this.multipartUploads.values())
      .filter((u) => u.bucket === bucket)
      .filter((u) => !prefix || u.key.startsWith(prefix))
      .filter((u) => {
        if (!keyMarker) return true
        if (u.key > keyMarker) return true
        if (u.key === keyMarker && u.uploadId > uploadIdMarker) return true
        return false
      })
      .sort((a, b) => {
        const keyCompare = a.key.localeCompare(b.key)
        if (keyCompare !== 0) return keyCompare
        return a.uploadId.localeCompare(b.uploadId)
      })

    // Handle delimiter
    const commonPrefixes: Set<string> = new Set()

    if (delimiter) {
      uploads = uploads.filter((u) => {
        const keyAfterPrefix = u.key.slice(prefix.length)
        const delimiterIndex = keyAfterPrefix.indexOf(delimiter)

        if (delimiterIndex >= 0) {
          const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
          commonPrefixes.add(commonPrefix)
          return false
        }
        return true
      })
    }

    const isTruncated = uploads.length > maxUploads
    const resultUploads = uploads.slice(0, maxUploads)

    return {
      uploads: resultUploads.map((u) => ({
        key: u.key,
        uploadId: u.uploadId,
        initiated: u.initiated,
      })),
      commonPrefixes: Array.from(commonPrefixes).sort(),
      isTruncated,
      nextKeyMarker: isTruncated ? resultUploads[resultUploads.length - 1]?.key : undefined,
      nextUploadIdMarker: isTruncated
        ? resultUploads[resultUploads.length - 1]?.uploadId
        : undefined,
    }
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  clear(): void {
    this.buckets.clear()
    this.objects.clear()
    this.multipartUploads.clear()
  }
}

// =============================================================================
// R2 Backend Implementation
// =============================================================================

/**
 * Cloudflare R2 storage backend for production
 *
 * Note: R2 doesn't have the concept of buckets - each R2 binding IS a bucket.
 * This backend simulates multiple buckets using key prefixes within a single R2 bucket.
 */
export class R2Backend implements StorageBackend {
  private r2: R2Bucket
  private bucketMeta: Map<string, InternalBucket> = new Map()
  private multipartUploads: Map<string, InternalMultipartUpload> = new Map()

  constructor(r2Bucket: R2Bucket) {
    this.r2 = r2Bucket
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  private getR2Key(bucket: string, key: string): string {
    return `${bucket}/${key}`
  }

  private parseR2Key(r2Key: string): { bucket: string; key: string } | null {
    const slashIndex = r2Key.indexOf('/')
    if (slashIndex === -1) return null
    return {
      bucket: r2Key.slice(0, slashIndex),
      key: r2Key.slice(slashIndex + 1),
    }
  }

  private async getBucketMetaKey(bucket: string): Promise<string> {
    return `__bucket_meta__/${bucket}`
  }

  // --------------------------------------------------------------------------
  // Bucket Operations
  // --------------------------------------------------------------------------

  async createBucket(name: string, region?: string): Promise<void> {
    const metaKey = await this.getBucketMetaKey(name)
    const existing = await this.r2.head(metaKey)

    if (existing) {
      throw new Error('BucketAlreadyExists')
    }

    const bucketMeta: InternalBucket = {
      name,
      creationDate: new Date(),
      region,
    }

    await this.r2.put(metaKey, JSON.stringify(bucketMeta))
    this.bucketMeta.set(name, bucketMeta)
  }

  async deleteBucket(name: string): Promise<void> {
    // Check if bucket is empty
    const isEmpty = await this.bucketIsEmpty(name)
    if (!isEmpty) {
      throw new Error('BucketNotEmpty')
    }

    const metaKey = await this.getBucketMetaKey(name)
    await this.r2.delete(metaKey)
    this.bucketMeta.delete(name)
  }

  async headBucket(name: string): Promise<InternalBucket> {
    // Check cache first
    if (this.bucketMeta.has(name)) {
      return this.bucketMeta.get(name)!
    }

    const metaKey = await this.getBucketMetaKey(name)
    const obj = await this.r2.get(metaKey)

    if (!obj) {
      throw new Error('NoSuchBucket')
    }

    const bucketMeta = JSON.parse(await obj.text()) as InternalBucket
    bucketMeta.creationDate = new Date(bucketMeta.creationDate)
    this.bucketMeta.set(name, bucketMeta)

    return bucketMeta
  }

  async listBuckets(): Promise<InternalBucket[]> {
    const listed = await this.r2.list({ prefix: '__bucket_meta__/' })
    const buckets: InternalBucket[] = []

    for (const obj of listed.objects) {
      const content = await this.r2.get(obj.key)
      if (content) {
        const meta = JSON.parse(await content.text()) as InternalBucket
        meta.creationDate = new Date(meta.creationDate)
        buckets.push(meta)
      }
    }

    return buckets
  }

  async bucketExists(name: string): Promise<boolean> {
    try {
      await this.headBucket(name)
      return true
    } catch {
      return false
    }
  }

  async bucketIsEmpty(name: string): Promise<boolean> {
    const prefix = `${name}/`
    const listed = await this.r2.list({ prefix, limit: 1 })
    return listed.objects.length === 0
  }

  // --------------------------------------------------------------------------
  // Object Operations
  // --------------------------------------------------------------------------

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    options: PutObjectOptions = {}
  ): Promise<{ etag: string }> {
    // Verify bucket exists
    await this.headBucket(bucket)

    const r2Key = this.getR2Key(bucket, key)
    const r2Options: R2PutOptions = {
      httpMetadata: {
        contentType: options.contentType,
        contentEncoding: options.contentEncoding,
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentLanguage: options.contentLanguage,
      },
      customMetadata: options.metadata,
    }

    const result = await this.r2.put(r2Key, body, r2Options)
    return { etag: `"${result.etag}"` }
  }

  async getObject(
    bucket: string,
    key: string,
    options: GetObjectOptions = {}
  ): Promise<InternalObject | null> {
    // Verify bucket exists
    await this.headBucket(bucket)

    const r2Key = this.getR2Key(bucket, key)

    const r2Options: R2GetOptions = {}
    if (options.range) {
      r2Options.range = {
        offset: options.range.start,
        length: options.range.end - options.range.start + 1,
      }
    }

    const obj = await this.r2.get(r2Key, r2Options)
    if (!obj) {
      return null
    }

    const body = new Uint8Array(await obj.arrayBuffer())

    return {
      key,
      body,
      contentType: obj.httpMetadata?.contentType,
      contentEncoding: obj.httpMetadata?.contentEncoding,
      cacheControl: obj.httpMetadata?.cacheControl,
      contentDisposition: obj.httpMetadata?.contentDisposition,
      contentLanguage: obj.httpMetadata?.contentLanguage,
      metadata: obj.customMetadata,
      etag: `"${obj.etag}"`,
      lastModified: obj.uploaded,
      size: obj.size,
    }
  }

  async headObject(bucket: string, key: string): Promise<InternalObject | null> {
    // Verify bucket exists
    await this.headBucket(bucket)

    const r2Key = this.getR2Key(bucket, key)
    const obj = await this.r2.head(r2Key)

    if (!obj) {
      return null
    }

    return {
      key,
      body: new Uint8Array(0), // Head doesn't return body
      contentType: obj.httpMetadata?.contentType,
      contentEncoding: obj.httpMetadata?.contentEncoding,
      cacheControl: obj.httpMetadata?.cacheControl,
      contentDisposition: obj.httpMetadata?.contentDisposition,
      contentLanguage: obj.httpMetadata?.contentLanguage,
      metadata: obj.customMetadata,
      etag: `"${obj.etag}"`,
      lastModified: obj.uploaded,
      size: obj.size,
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    // Verify bucket exists
    await this.headBucket(bucket)

    const r2Key = this.getR2Key(bucket, key)
    await this.r2.delete(r2Key)
  }

  async listObjects(
    bucket: string,
    options: ListObjectsOptions = {}
  ): Promise<ListObjectsResult> {
    // Verify bucket exists
    await this.headBucket(bucket)

    const prefix = `${bucket}/${options.prefix || ''}`
    const r2Options: R2ListOptions = {
      prefix,
      limit: options.maxKeys || 1000,
      delimiter: options.delimiter,
      cursor: options.continuationToken,
      startAfter: options.startAfter ? `${bucket}/${options.startAfter}` : undefined,
    }

    const listed = await this.r2.list(r2Options)

    const objects: InternalObject[] = listed.objects.map((obj) => {
      const parsed = this.parseR2Key(obj.key)
      return {
        key: parsed?.key || obj.key,
        body: new Uint8Array(0),
        etag: `"${obj.etag}"`,
        lastModified: obj.uploaded,
        size: obj.size,
      }
    })

    const commonPrefixes = (listed.delimitedPrefixes || []).map((p) =>
      p.replace(`${bucket}/`, '')
    )

    return {
      objects,
      commonPrefixes,
      isTruncated: listed.truncated,
      nextContinuationToken: listed.truncated ? listed.cursor : undefined,
    }
  }

  // --------------------------------------------------------------------------
  // Multipart Operations
  // --------------------------------------------------------------------------

  async createMultipartUpload(
    bucket: string,
    key: string,
    options: CreateMultipartOptions = {}
  ): Promise<string> {
    // Verify bucket exists
    await this.headBucket(bucket)

    const r2Key = this.getR2Key(bucket, key)
    const r2Options: R2MultipartOptions = {
      httpMetadata: {
        contentType: options.contentType,
      },
      customMetadata: options.metadata,
    }

    const multipartUpload = await this.r2.createMultipartUpload(r2Key, r2Options)

    // Store upload info locally for tracking
    this.multipartUploads.set(multipartUpload.uploadId, {
      uploadId: multipartUpload.uploadId,
      bucket,
      key,
      initiated: new Date(),
      parts: new Map(),
      contentType: options.contentType,
      metadata: options.metadata,
    })

    return multipartUpload.uploadId
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array
  ): Promise<{ etag: string }> {
    const r2Key = this.getR2Key(bucket, key)
    const multipartUpload = this.r2.resumeMultipartUpload(r2Key, uploadId)
    const uploadedPart = await multipartUpload.uploadPart(partNumber, body)

    // Track part locally
    const upload = this.multipartUploads.get(uploadId)
    if (upload) {
      upload.parts.set(partNumber, {
        partNumber,
        body,
        etag: uploadedPart.etag,
        size: body.length,
        lastModified: new Date(),
      })
    }

    return { etag: uploadedPart.etag }
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ etag: string }> {
    const r2Key = this.getR2Key(bucket, key)
    const multipartUpload = this.r2.resumeMultipartUpload(r2Key, uploadId)

    const r2Parts: R2UploadedPart[] = parts.map((p) => ({
      partNumber: p.partNumber,
      etag: p.etag,
    }))

    const result = await multipartUpload.complete(r2Parts)

    // Clean up local tracking
    this.multipartUploads.delete(uploadId)

    return { etag: `"${result.etag}"` }
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string
  ): Promise<void> {
    const r2Key = this.getR2Key(bucket, key)
    const multipartUpload = this.r2.resumeMultipartUpload(r2Key, uploadId)
    await multipartUpload.abort()

    // Clean up local tracking
    this.multipartUploads.delete(uploadId)
  }

  async listParts(
    bucket: string,
    key: string,
    uploadId: string,
    options: ListPartsOptions = {}
  ): Promise<ListPartsResult> {
    // R2 doesn't have a native listParts API, so we use local tracking
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new Error('NoSuchUpload')
    }

    const { maxParts = 1000, partNumberMarker = 0 } = options

    const allParts = Array.from(upload.parts.values())
      .filter((p) => p.partNumber > partNumberMarker)
      .sort((a, b) => a.partNumber - b.partNumber)

    const isTruncated = allParts.length > maxParts
    const resultParts = allParts.slice(0, maxParts)

    return {
      parts: resultParts,
      isTruncated,
      nextPartNumberMarker: isTruncated
        ? resultParts[resultParts.length - 1].partNumber
        : undefined,
    }
  }

  async listMultipartUploads(
    bucket: string,
    options: ListMultipartUploadsOptions = {}
  ): Promise<ListMultipartUploadsResult> {
    // Verify bucket exists
    await this.headBucket(bucket)

    // R2 doesn't have a native listMultipartUploads API, so we use local tracking
    const {
      prefix = '',
      delimiter,
      maxUploads = 1000,
      keyMarker = '',
      uploadIdMarker = '',
    } = options

    let uploads = Array.from(this.multipartUploads.values())
      .filter((u) => u.bucket === bucket)
      .filter((u) => !prefix || u.key.startsWith(prefix))
      .filter((u) => {
        if (!keyMarker) return true
        if (u.key > keyMarker) return true
        if (u.key === keyMarker && u.uploadId > uploadIdMarker) return true
        return false
      })
      .sort((a, b) => {
        const keyCompare = a.key.localeCompare(b.key)
        if (keyCompare !== 0) return keyCompare
        return a.uploadId.localeCompare(b.uploadId)
      })

    const commonPrefixes: Set<string> = new Set()

    if (delimiter) {
      uploads = uploads.filter((u) => {
        const keyAfterPrefix = u.key.slice(prefix.length)
        const delimiterIndex = keyAfterPrefix.indexOf(delimiter)

        if (delimiterIndex >= 0) {
          const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
          commonPrefixes.add(commonPrefix)
          return false
        }
        return true
      })
    }

    const isTruncated = uploads.length > maxUploads
    const resultUploads = uploads.slice(0, maxUploads)

    return {
      uploads: resultUploads.map((u) => ({
        key: u.key,
        uploadId: u.uploadId,
        initiated: u.initiated,
      })),
      commonPrefixes: Array.from(commonPrefixes).sort(),
      isTruncated,
      nextKeyMarker: isTruncated ? resultUploads[resultUploads.length - 1]?.key : undefined,
      nextUploadIdMarker: isTruncated
        ? resultUploads[resultUploads.length - 1]?.uploadId
        : undefined,
    }
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  clear(): void {
    this.bucketMeta.clear()
    this.multipartUploads.clear()
    // Note: This doesn't clear R2 data, only local cache
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a simple ETag for content (not cryptographically secure)
 */
function generateETag(data: Uint8Array): string {
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i]
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(32, '0')
  return `"${hex}"`
}

// =============================================================================
// Default Backend Instance
// =============================================================================

/** Shared in-memory backend for testing */
export const defaultMemoryBackend = new MemoryBackend()
