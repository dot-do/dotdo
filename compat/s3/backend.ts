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
  CORSConfiguration,
  LifecycleConfiguration,
  LifecycleFilter,
  LifecycleExpiration,
  LifecycleTransition,
  VersioningStatus,
  MFADeleteStatus,
  InternalBucketExtended,
  InternalObjectVersion,
  InternalVersionedObjects,
} from './types'

// =============================================================================
// Lifecycle Evaluation Types
// =============================================================================

export interface LifecycleEvaluation {
  /** Objects that should be expired based on rules */
  expiredObjects: Array<{ key: string; ruleId: string }>
  /** Objects that should be transitioned to different storage class */
  transitionObjects: Array<{ key: string; ruleId: string; targetStorageClass: StorageClass }>
  /** Multipart uploads that should be aborted */
  abortUploads: Array<{ uploadId: string; key: string; ruleId: string }>
}

export interface LifecycleExecutionResult {
  /** Objects that were deleted due to expiration rules */
  deletedObjects: Array<{ key: string; ruleId: string }>
  /** Objects that were transitioned to different storage class */
  transitionedObjects: Array<{ key: string; ruleId: string; newStorageClass: StorageClass }>
  /** Multipart uploads that were aborted */
  abortedUploads: Array<{ uploadId: string; key: string; ruleId: string }>
}

// =============================================================================
// Storage Backend Interface
// =============================================================================

export interface StorageBackend {
  // Bucket operations
  createBucket(name: string, region?: string, options?: CreateBucketOptions): Promise<void>
  deleteBucket(name: string): Promise<void>
  headBucket(name: string): Promise<InternalBucketExtended>
  listBuckets(options?: ListBucketsOptions): Promise<ListBucketsResult>
  bucketExists(name: string): Promise<boolean>
  bucketIsEmpty(name: string): Promise<boolean>

  // CORS operations
  putBucketCors(name: string, config: CORSConfiguration): Promise<void>
  getBucketCors(name: string): Promise<CORSConfiguration | null>
  deleteBucketCors(name: string): Promise<void>

  // Lifecycle operations
  putBucketLifecycle(name: string, config: LifecycleConfiguration): Promise<void>
  getBucketLifecycle(name: string): Promise<LifecycleConfiguration | null>
  deleteBucketLifecycle(name: string): Promise<void>

  // Versioning operations
  putBucketVersioning(name: string, status: VersioningStatus, mfaDelete?: MFADeleteStatus): Promise<void>
  getBucketVersioning(name: string): Promise<{ status?: VersioningStatus; mfaDelete?: MFADeleteStatus }>

  // Object operations
  putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    options?: PutObjectOptions
  ): Promise<{ etag: string; versionId?: string }>
  getObject(
    bucket: string,
    key: string,
    options?: GetObjectOptions
  ): Promise<(InternalObject & { versionId?: string }) | null>
  headObject(bucket: string, key: string, versionId?: string): Promise<(InternalObject & { versionId?: string }) | null>
  deleteObject(bucket: string, key: string, versionId?: string): Promise<{ deleteMarker?: boolean; versionId?: string }>
  listObjects(
    bucket: string,
    options?: ListObjectsOptions
  ): Promise<ListObjectsResult>

  // Versioning-aware object operations
  listObjectVersions(
    bucket: string,
    options?: ListObjectVersionsOptions
  ): Promise<ListObjectVersionsResult>

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

export interface CreateBucketOptions {
  objectOwnership?: 'BucketOwnerEnforced' | 'BucketOwnerPreferred' | 'ObjectWriter'
  objectLockEnabled?: boolean
}

export interface ListBucketsOptions {
  maxBuckets?: number
  continuationToken?: string
  prefix?: string
  bucketRegion?: string
}

export interface ListBucketsResult {
  buckets: InternalBucketExtended[]
  continuationToken?: string
}

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
  versionId?: string
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

export interface ListObjectVersionsOptions {
  prefix?: string
  delimiter?: string
  maxKeys?: number
  keyMarker?: string
  versionIdMarker?: string
}

export interface ListObjectVersionsResult {
  versions: Array<InternalObjectVersion & { key: string }>
  deleteMarkers: Array<{ key: string; versionId: string; isLatest: boolean; lastModified: Date }>
  commonPrefixes: string[]
  isTruncated: boolean
  nextKeyMarker?: string
  nextVersionIdMarker?: string
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
  private buckets: Map<string, InternalBucketExtended> = new Map()
  private objects: Map<string, Map<string, InternalObject>> = new Map()
  private multipartUploads: Map<string, InternalMultipartUpload> = new Map()
  /** Versioned object storage: bucket -> key -> versioned objects */
  private versionedObjects: Map<string, Map<string, InternalVersionedObjects>> = new Map()
  /** Delete markers: bucket -> key -> array of delete markers */
  private deleteMarkers: Map<string, Map<string, Array<{ versionId: string; created: Date; isLatest: boolean }>>> = new Map()

  // --------------------------------------------------------------------------
  // Bucket Operations
  // --------------------------------------------------------------------------

  async createBucket(name: string, region?: string, options?: CreateBucketOptions): Promise<void> {
    this.buckets.set(name, {
      name,
      creationDate: new Date(),
      region,
      objectOwnership: options?.objectOwnership,
      objectLockEnabled: options?.objectLockEnabled,
    })
    this.objects.set(name, new Map())
  }

  async deleteBucket(name: string): Promise<void> {
    this.buckets.delete(name)
    this.objects.delete(name)
  }

  async headBucket(name: string): Promise<InternalBucketExtended> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    return bucket
  }

  async listBuckets(options?: ListBucketsOptions): Promise<ListBucketsResult> {
    let buckets = Array.from(this.buckets.values())

    // Filter by prefix
    if (options?.prefix) {
      buckets = buckets.filter((b) => b.name.startsWith(options.prefix!))
    }

    // Filter by region
    if (options?.bucketRegion) {
      buckets = buckets.filter((b) => b.region === options.bucketRegion)
    }

    // Sort alphabetically by name
    buckets.sort((a, b) => a.name.localeCompare(b.name))

    // Handle pagination
    let startIndex = 0
    if (options?.continuationToken) {
      try {
        const decodedToken = atob(options.continuationToken)
        const idx = buckets.findIndex((b) => b.name > decodedToken)
        startIndex = idx >= 0 ? idx : buckets.length
      } catch {
        // Invalid token, start from beginning
      }
    }

    const maxBuckets = options?.maxBuckets ?? 1000
    const endIndex = startIndex + maxBuckets
    const resultBuckets = buckets.slice(startIndex, endIndex)

    let continuationToken: string | undefined
    if (endIndex < buckets.length && resultBuckets.length > 0) {
      continuationToken = btoa(resultBuckets[resultBuckets.length - 1].name)
    }

    return {
      buckets: resultBuckets,
      continuationToken,
    }
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
  ): Promise<{ etag: string; versionId?: string }> {
    const bucketData = this.buckets.get(bucket)
    if (!bucketData) {
      throw new Error('NoSuchBucket')
    }

    const etag = generateETag(body)
    const now = new Date()

    // Check versioning status
    const versioningEnabled = bucketData.versioningStatus === 'Enabled'
    const versioningSuspended = bucketData.versioningStatus === 'Suspended'

    if (versioningEnabled) {
      // Generate a unique version ID
      const versionId = this.generateVersionId()

      // Initialize versioned storage for this bucket if needed
      if (!this.versionedObjects.has(bucket)) {
        this.versionedObjects.set(bucket, new Map())
      }

      const bucketVersions = this.versionedObjects.get(bucket)!

      // Get or create versioned objects for this key
      if (!bucketVersions.has(key)) {
        bucketVersions.set(key, { versions: new Map(), currentVersionId: null })
      }

      const keyVersions = bucketVersions.get(key)!

      // Mark previous latest version as not latest
      if (keyVersions.currentVersionId) {
        const prevVersion = keyVersions.versions.get(keyVersions.currentVersionId)
        if (prevVersion) {
          prevVersion.isLatest = false
        }
      }

      // Also clear any latest delete markers
      const deleteMarkerMap = this.deleteMarkers.get(bucket)
      if (deleteMarkerMap?.has(key)) {
        const markers = deleteMarkerMap.get(key)!
        for (const marker of markers) {
          marker.isLatest = false
        }
      }

      // Create new version
      const newVersion: InternalObjectVersion = {
        key,
        body,
        contentType: options.contentType,
        contentEncoding: options.contentEncoding,
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentLanguage: options.contentLanguage,
        metadata: options.metadata,
        etag,
        lastModified: now,
        size: body.length,
        storageClass: options.storageClass,
        versionId,
        isLatest: true,
      }

      keyVersions.versions.set(versionId, newVersion)
      keyVersions.currentVersionId = versionId

      // Also update main objects map for backward compatibility
      if (!this.objects.has(bucket)) {
        this.objects.set(bucket, new Map())
      }
      this.objects.get(bucket)!.set(key, {
        key,
        body,
        contentType: options.contentType,
        contentEncoding: options.contentEncoding,
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentLanguage: options.contentLanguage,
        metadata: options.metadata,
        etag,
        lastModified: now,
        size: body.length,
        storageClass: options.storageClass,
      })

      return { etag, versionId }
    } else if (versioningSuspended) {
      // Versioning suspended: use "null" version ID
      if (!this.versionedObjects.has(bucket)) {
        this.versionedObjects.set(bucket, new Map())
      }

      const bucketVersions = this.versionedObjects.get(bucket)!

      if (!bucketVersions.has(key)) {
        bucketVersions.set(key, { versions: new Map(), currentVersionId: null })
      }

      const keyVersions = bucketVersions.get(key)!

      // Mark previous versions as not latest (but keep them)
      for (const version of keyVersions.versions.values()) {
        version.isLatest = false
      }

      // Clear any latest delete markers
      const deleteMarkerMap = this.deleteMarkers.get(bucket)
      if (deleteMarkerMap?.has(key)) {
        const markers = deleteMarkerMap.get(key)!
        for (const marker of markers) {
          marker.isLatest = false
        }
      }

      // Create/replace the null version
      const nullVersion: InternalObjectVersion = {
        key,
        body,
        contentType: options.contentType,
        contentEncoding: options.contentEncoding,
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentLanguage: options.contentLanguage,
        metadata: options.metadata,
        etag,
        lastModified: now,
        size: body.length,
        storageClass: options.storageClass,
        versionId: 'null',
        isLatest: true,
      }

      keyVersions.versions.set('null', nullVersion)
      keyVersions.currentVersionId = 'null'

      // Update main objects map
      if (!this.objects.has(bucket)) {
        this.objects.set(bucket, new Map())
      }
      this.objects.get(bucket)!.set(key, {
        key,
        body,
        contentType: options.contentType,
        contentEncoding: options.contentEncoding,
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentLanguage: options.contentLanguage,
        metadata: options.metadata,
        etag,
        lastModified: now,
        size: body.length,
        storageClass: options.storageClass,
      })

      return { etag, versionId: 'null' }
    } else {
      // No versioning: standard put
      if (!this.objects.has(bucket)) {
        this.objects.set(bucket, new Map())
      }

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
        lastModified: now,
        size: body.length,
        storageClass: options.storageClass,
      }

      this.objects.get(bucket)!.set(key, obj)
      return { etag }
    }
  }

  async getObject(
    bucket: string,
    key: string,
    options: GetObjectOptions = {}
  ): Promise<(InternalObject & { versionId?: string }) | null> {
    const bucketData = this.buckets.get(bucket)
    if (!bucketData) {
      throw new Error('NoSuchBucket')
    }

    // If a specific version is requested
    if (options.versionId) {
      const bucketVersions = this.versionedObjects.get(bucket)
      if (!bucketVersions?.has(key)) {
        return null
      }

      const keyVersions = bucketVersions.get(key)!
      const version = keyVersions.versions.get(options.versionId)

      if (!version || version.isDeleteMarker) {
        return null
      }

      // Handle range request
      if (options.range) {
        const { start, end } = options.range
        const slicedBody = version.body.slice(start, end + 1)
        return {
          key: version.key,
          body: slicedBody,
          contentType: version.contentType,
          contentEncoding: version.contentEncoding,
          cacheControl: version.cacheControl,
          contentDisposition: version.contentDisposition,
          contentLanguage: version.contentLanguage,
          metadata: version.metadata,
          etag: version.etag,
          lastModified: version.lastModified,
          size: slicedBody.length,
          storageClass: version.storageClass,
          versionId: version.versionId,
        }
      }

      return {
        key: version.key,
        body: version.body,
        contentType: version.contentType,
        contentEncoding: version.contentEncoding,
        cacheControl: version.cacheControl,
        contentDisposition: version.contentDisposition,
        contentLanguage: version.contentLanguage,
        metadata: version.metadata,
        etag: version.etag,
        lastModified: version.lastModified,
        size: version.size,
        storageClass: version.storageClass,
        versionId: version.versionId,
      }
    }

    // Check if there's a delete marker as latest (makes object appear deleted)
    const deleteMarkerMap = this.deleteMarkers.get(bucket)
    if (deleteMarkerMap?.has(key)) {
      const markers = deleteMarkerMap.get(key)!
      const latestMarker = markers.find((m) => m.isLatest)
      if (latestMarker) {
        // Object is "deleted" by a delete marker
        return null
      }
    }

    // Get from versioned storage if versioning is/was enabled
    const bucketVersions = this.versionedObjects.get(bucket)
    if (bucketVersions?.has(key)) {
      const keyVersions = bucketVersions.get(key)!
      if (keyVersions.currentVersionId) {
        const currentVersion = keyVersions.versions.get(keyVersions.currentVersionId)
        if (currentVersion && !currentVersion.isDeleteMarker) {
          // Handle range request
          if (options.range) {
            const { start, end } = options.range
            const slicedBody = currentVersion.body.slice(start, end + 1)
            return {
              key: currentVersion.key,
              body: slicedBody,
              contentType: currentVersion.contentType,
              contentEncoding: currentVersion.contentEncoding,
              cacheControl: currentVersion.cacheControl,
              contentDisposition: currentVersion.contentDisposition,
              contentLanguage: currentVersion.contentLanguage,
              metadata: currentVersion.metadata,
              etag: currentVersion.etag,
              lastModified: currentVersion.lastModified,
              size: slicedBody.length,
              storageClass: currentVersion.storageClass,
              versionId: currentVersion.versionId,
            }
          }

          return {
            key: currentVersion.key,
            body: currentVersion.body,
            contentType: currentVersion.contentType,
            contentEncoding: currentVersion.contentEncoding,
            cacheControl: currentVersion.cacheControl,
            contentDisposition: currentVersion.contentDisposition,
            contentLanguage: currentVersion.contentLanguage,
            metadata: currentVersion.metadata,
            etag: currentVersion.etag,
            lastModified: currentVersion.lastModified,
            size: currentVersion.size,
            storageClass: currentVersion.storageClass,
            versionId: currentVersion.versionId,
          }
        }
      }
    }

    // Fallback to non-versioned storage
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      return null
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

  async headObject(bucket: string, key: string, versionId?: string): Promise<(InternalObject & { versionId?: string }) | null> {
    const bucketData = this.buckets.get(bucket)
    if (!bucketData) {
      throw new Error('NoSuchBucket')
    }

    // If a specific version is requested
    if (versionId) {
      const bucketVersions = this.versionedObjects.get(bucket)
      if (!bucketVersions?.has(key)) {
        return null
      }

      const keyVersions = bucketVersions.get(key)!
      const version = keyVersions.versions.get(versionId)

      if (!version || version.isDeleteMarker) {
        return null
      }

      return {
        key: version.key,
        body: new Uint8Array(0), // Head doesn't return body
        contentType: version.contentType,
        contentEncoding: version.contentEncoding,
        cacheControl: version.cacheControl,
        contentDisposition: version.contentDisposition,
        contentLanguage: version.contentLanguage,
        metadata: version.metadata,
        etag: version.etag,
        lastModified: version.lastModified,
        size: version.size,
        storageClass: version.storageClass,
        versionId: version.versionId,
      }
    }

    // Check if there's a delete marker as latest
    const deleteMarkerMap = this.deleteMarkers.get(bucket)
    if (deleteMarkerMap?.has(key)) {
      const markers = deleteMarkerMap.get(key)!
      const latestMarker = markers.find((m) => m.isLatest)
      if (latestMarker) {
        return null
      }
    }

    // Get from versioned storage if versioning is/was enabled
    const bucketVersions = this.versionedObjects.get(bucket)
    if (bucketVersions?.has(key)) {
      const keyVersions = bucketVersions.get(key)!
      if (keyVersions.currentVersionId) {
        const currentVersion = keyVersions.versions.get(keyVersions.currentVersionId)
        if (currentVersion && !currentVersion.isDeleteMarker) {
          return {
            key: currentVersion.key,
            body: new Uint8Array(0),
            contentType: currentVersion.contentType,
            contentEncoding: currentVersion.contentEncoding,
            cacheControl: currentVersion.cacheControl,
            contentDisposition: currentVersion.contentDisposition,
            contentLanguage: currentVersion.contentLanguage,
            metadata: currentVersion.metadata,
            etag: currentVersion.etag,
            lastModified: currentVersion.lastModified,
            size: currentVersion.size,
            storageClass: currentVersion.storageClass,
            versionId: currentVersion.versionId,
          }
        }
      }
    }

    // Fallback to non-versioned storage
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      return null
    }

    return bucketObjects.get(key) || null
  }

  async deleteObject(bucket: string, key: string, versionId?: string): Promise<{ deleteMarker?: boolean; versionId?: string }> {
    const bucketData = this.buckets.get(bucket)
    if (!bucketData) {
      throw new Error('NoSuchBucket')
    }

    // If deleting a specific version
    if (versionId) {
      // Check delete markers first
      const deleteMarkerMap = this.deleteMarkers.get(bucket)
      if (deleteMarkerMap?.has(key)) {
        const markers = deleteMarkerMap.get(key)!
        const markerIdx = markers.findIndex((m) => m.versionId === versionId)
        if (markerIdx >= 0) {
          const wasLatest = markers[markerIdx].isLatest
          markers.splice(markerIdx, 1)

          // If we removed the latest delete marker, find the new latest
          if (wasLatest) {
            // Find the most recent item (version or delete marker)
            this.updateLatestAfterDeletion(bucket, key)
          }

          return { versionId }
        }
      }

      // Check versioned objects
      const bucketVersions = this.versionedObjects.get(bucket)
      if (bucketVersions?.has(key)) {
        const keyVersions = bucketVersions.get(key)!
        const version = keyVersions.versions.get(versionId)

        if (version) {
          const wasLatest = version.isLatest
          keyVersions.versions.delete(versionId)

          // If we deleted the current version, update pointer
          if (keyVersions.currentVersionId === versionId) {
            keyVersions.currentVersionId = null
          }

          // If we removed the latest version, find the new latest
          if (wasLatest) {
            this.updateLatestAfterDeletion(bucket, key)
          }

          // Also remove from main objects map if it was there
          const bucketObjects = this.objects.get(bucket)
          if (bucketObjects) {
            bucketObjects.delete(key)
          }

          return { versionId }
        }
      }

      // Version not found - in S3 this is idempotent
      return { versionId }
    }

    // Deleting without version ID
    const versioningEnabled = bucketData.versioningStatus === 'Enabled'

    if (versioningEnabled) {
      // Create a delete marker
      const deleteVersionId = this.generateVersionId()

      if (!this.deleteMarkers.has(bucket)) {
        this.deleteMarkers.set(bucket, new Map())
      }

      const deleteMarkerMap = this.deleteMarkers.get(bucket)!

      if (!deleteMarkerMap.has(key)) {
        deleteMarkerMap.set(key, [])
      }

      // Mark previous markers as not latest
      const markers = deleteMarkerMap.get(key)!
      for (const marker of markers) {
        marker.isLatest = false
      }

      // Also mark current version as not latest
      const bucketVersions = this.versionedObjects.get(bucket)
      if (bucketVersions?.has(key)) {
        const keyVersions = bucketVersions.get(key)!
        for (const version of keyVersions.versions.values()) {
          version.isLatest = false
        }
        keyVersions.currentVersionId = null
      }

      markers.push({
        versionId: deleteVersionId,
        created: new Date(),
        isLatest: true,
      })

      // Remove from main objects map
      const bucketObjects = this.objects.get(bucket)
      if (bucketObjects) {
        bucketObjects.delete(key)
      }

      return { deleteMarker: true, versionId: deleteVersionId }
    } else {
      // No versioning: actual delete
      const bucketObjects = this.objects.get(bucket)
      if (bucketObjects) {
        bucketObjects.delete(key)
      }

      // Also clean up versioned storage if suspended
      if (bucketData.versioningStatus === 'Suspended') {
        const bucketVersions = this.versionedObjects.get(bucket)
        if (bucketVersions?.has(key)) {
          bucketVersions.get(key)!.versions.delete('null')
        }
      }

      return {}
    }
  }

  /**
   * Helper to update the latest flag after deleting a version or delete marker
   */
  private updateLatestAfterDeletion(bucket: string, key: string): void {
    // Find the most recent item
    let latestTime = 0
    let latestVersionId: string | null = null
    let isDeleteMarker = false

    // Check versions
    const bucketVersions = this.versionedObjects.get(bucket)
    if (bucketVersions?.has(key)) {
      const keyVersions = bucketVersions.get(key)!
      for (const [id, version] of keyVersions.versions) {
        if (version.lastModified.getTime() > latestTime) {
          latestTime = version.lastModified.getTime()
          latestVersionId = id
          isDeleteMarker = false
        }
      }
    }

    // Check delete markers
    const deleteMarkerMap = this.deleteMarkers.get(bucket)
    if (deleteMarkerMap?.has(key)) {
      const markers = deleteMarkerMap.get(key)!
      for (const marker of markers) {
        if (marker.created.getTime() > latestTime) {
          latestTime = marker.created.getTime()
          latestVersionId = marker.versionId
          isDeleteMarker = true
        }
      }
    }

    // Update the isLatest flag
    if (latestVersionId) {
      if (isDeleteMarker) {
        const markers = deleteMarkerMap!.get(key)!
        const marker = markers.find((m) => m.versionId === latestVersionId)
        if (marker) {
          marker.isLatest = true
        }
      } else {
        const keyVersions = bucketVersions!.get(key)!
        const version = keyVersions.versions.get(latestVersionId)
        if (version) {
          version.isLatest = true
          keyVersions.currentVersionId = latestVersionId
        }

        // Update main objects map
        const bucketObjects = this.objects.get(bucket)
        if (bucketObjects && version) {
          bucketObjects.set(key, {
            key: version.key,
            body: version.body,
            contentType: version.contentType,
            contentEncoding: version.contentEncoding,
            cacheControl: version.cacheControl,
            contentDisposition: version.contentDisposition,
            contentLanguage: version.contentLanguage,
            metadata: version.metadata,
            etag: version.etag,
            lastModified: version.lastModified,
            size: version.size,
            storageClass: version.storageClass,
          })
        }
      }
    }
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

  async listObjectVersions(
    bucket: string,
    options: ListObjectVersionsOptions = {}
  ): Promise<ListObjectVersionsResult> {
    const bucketData = this.buckets.get(bucket)
    if (!bucketData) {
      throw new Error('NoSuchBucket')
    }

    const { prefix = '', delimiter, maxKeys = 1000, keyMarker, versionIdMarker } = options

    const versions: Array<InternalObjectVersion & { key: string }> = []
    const deleteMarkersList: Array<{ key: string; versionId: string; isLatest: boolean; lastModified: Date }> = []
    const commonPrefixes: Set<string> = new Set()

    // Collect versions from versioned storage
    const bucketVersions = this.versionedObjects.get(bucket)
    if (bucketVersions) {
      for (const [key, keyVersions] of bucketVersions) {
        // Prefix filter
        if (!key.startsWith(prefix)) continue

        // Key marker filter
        if (keyMarker && key < keyMarker) continue
        if (keyMarker && key === keyMarker && versionIdMarker) {
          // Skip versions before/at the marker
        }

        // Delimiter handling
        if (delimiter) {
          const keyAfterPrefix = key.slice(prefix.length)
          const delimiterIndex = keyAfterPrefix.indexOf(delimiter)
          if (delimiterIndex >= 0) {
            const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
            commonPrefixes.add(commonPrefix)
            continue
          }
        }

        for (const [versionId, version] of keyVersions.versions) {
          // Skip if before version marker for same key
          if (keyMarker === key && versionIdMarker && versionId <= versionIdMarker) continue

          versions.push({ ...version, key })
        }
      }
    }

    // Also check main objects map for non-versioned objects (null version)
    const bucketObjects = this.objects.get(bucket)
    if (bucketObjects) {
      for (const [key, obj] of bucketObjects) {
        // Skip if already tracked in versioned storage
        if (bucketVersions?.has(key)) continue

        // Prefix filter
        if (!key.startsWith(prefix)) continue

        // Key marker filter
        if (keyMarker && key <= keyMarker) continue

        // Delimiter handling
        if (delimiter) {
          const keyAfterPrefix = key.slice(prefix.length)
          const delimiterIndex = keyAfterPrefix.indexOf(delimiter)
          if (delimiterIndex >= 0) {
            const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
            commonPrefixes.add(commonPrefix)
            continue
          }
        }

        // Add as null version
        versions.push({
          key,
          body: obj.body,
          contentType: obj.contentType,
          contentEncoding: obj.contentEncoding,
          cacheControl: obj.cacheControl,
          contentDisposition: obj.contentDisposition,
          contentLanguage: obj.contentLanguage,
          metadata: obj.metadata,
          etag: obj.etag,
          lastModified: obj.lastModified,
          size: obj.size,
          storageClass: obj.storageClass,
          versionId: 'null',
          isLatest: true,
        })
      }
    }

    // Collect delete markers
    const deleteMarkerMap = this.deleteMarkers.get(bucket)
    if (deleteMarkerMap) {
      for (const [key, markers] of deleteMarkerMap) {
        // Prefix filter
        if (!key.startsWith(prefix)) continue

        // Key marker filter
        if (keyMarker && key < keyMarker) continue

        // Delimiter handling
        if (delimiter) {
          const keyAfterPrefix = key.slice(prefix.length)
          const delimiterIndex = keyAfterPrefix.indexOf(delimiter)
          if (delimiterIndex >= 0) {
            continue // Already added to commonPrefixes if applicable
          }
        }

        for (const marker of markers) {
          if (keyMarker === key && versionIdMarker && marker.versionId <= versionIdMarker) continue

          deleteMarkersList.push({
            key,
            versionId: marker.versionId,
            isLatest: marker.isLatest,
            lastModified: marker.created,
          })
        }
      }
    }

    // Sort versions by key, then by lastModified descending
    versions.sort((a, b) => {
      if (a.key !== b.key) return a.key.localeCompare(b.key)
      return b.lastModified.getTime() - a.lastModified.getTime()
    })

    // Sort delete markers similarly
    deleteMarkersList.sort((a, b) => {
      if (a.key !== b.key) return a.key.localeCompare(b.key)
      return b.lastModified.getTime() - a.lastModified.getTime()
    })

    // Merge and paginate (combine versions and delete markers for accurate count)
    const totalItems = versions.length + deleteMarkersList.length
    const isTruncated = totalItems > maxKeys

    // For simplicity, truncate versions first, then delete markers
    const truncatedVersions = versions.slice(0, maxKeys)
    const remainingSlots = maxKeys - truncatedVersions.length
    const truncatedMarkers = deleteMarkersList.slice(0, remainingSlots)

    let nextKeyMarker: string | undefined
    let nextVersionIdMarker: string | undefined

    if (isTruncated) {
      // Find the last item to set markers
      const lastVersion = truncatedVersions[truncatedVersions.length - 1]
      const lastMarker = truncatedMarkers[truncatedMarkers.length - 1]

      if (lastVersion && lastMarker) {
        // Compare which is "later" in sort order
        if (lastVersion.key > lastMarker.key ||
            (lastVersion.key === lastMarker.key &&
             lastVersion.lastModified.getTime() < lastMarker.lastModified.getTime())) {
          nextKeyMarker = lastVersion.key
          nextVersionIdMarker = lastVersion.versionId
        } else {
          nextKeyMarker = lastMarker.key
          nextVersionIdMarker = lastMarker.versionId
        }
      } else if (lastVersion) {
        nextKeyMarker = lastVersion.key
        nextVersionIdMarker = lastVersion.versionId
      } else if (lastMarker) {
        nextKeyMarker = lastMarker.key
        nextVersionIdMarker = lastMarker.versionId
      }
    }

    return {
      versions: truncatedVersions,
      deleteMarkers: truncatedMarkers,
      commonPrefixes: Array.from(commonPrefixes).sort(),
      isTruncated,
      nextKeyMarker,
      nextVersionIdMarker,
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
  // CORS Operations
  // --------------------------------------------------------------------------

  async putBucketCors(name: string, config: CORSConfiguration): Promise<void> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    bucket.corsConfiguration = config
  }

  async getBucketCors(name: string): Promise<CORSConfiguration | null> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    return bucket.corsConfiguration || null
  }

  async deleteBucketCors(name: string): Promise<void> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    delete bucket.corsConfiguration
  }

  // --------------------------------------------------------------------------
  // Lifecycle Operations
  // --------------------------------------------------------------------------

  async putBucketLifecycle(name: string, config: LifecycleConfiguration): Promise<void> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }

    // Validate lifecycle configuration
    validateLifecycleConfiguration(config)

    bucket.lifecycleConfiguration = config
  }

  async getBucketLifecycle(name: string): Promise<LifecycleConfiguration | null> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    return bucket.lifecycleConfiguration || null
  }

  async deleteBucketLifecycle(name: string): Promise<void> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    delete bucket.lifecycleConfiguration
  }

  /**
   * Evaluate lifecycle rules and return objects that match for expiration/transition
   * This is a helper method for testing lifecycle policy behavior
   */
  async evaluateLifecycleRules(
    name: string,
    now: Date = new Date()
  ): Promise<LifecycleEvaluation> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }

    const config = bucket.lifecycleConfiguration
    if (!config) {
      return { expiredObjects: [], transitionObjects: [], abortUploads: [] }
    }

    const evaluation: LifecycleEvaluation = {
      expiredObjects: [],
      transitionObjects: [],
      abortUploads: [],
    }

    const bucketObjects = this.objects.get(name)
    if (!bucketObjects) {
      return evaluation
    }

    for (const rule of config.Rules) {
      if (rule.Status !== 'Enabled') continue

      // Evaluate each object against the rule
      for (const [key, obj] of bucketObjects) {
        if (!matchesLifecycleFilter(key, obj, rule.Filter)) continue

        // Check expiration
        if (rule.Expiration) {
          const expirationDate = calculateExpirationDate(obj.lastModified, rule.Expiration, now)
          if (expirationDate && now >= expirationDate) {
            evaluation.expiredObjects.push({ key, ruleId: rule.ID || 'default' })
          }
        }

        // Check transitions
        if (rule.Transitions) {
          for (const transition of rule.Transitions) {
            const transitionDate = calculateTransitionDate(obj.lastModified, transition, now)
            if (transitionDate && now >= transitionDate && obj.storageClass !== transition.StorageClass) {
              evaluation.transitionObjects.push({
                key,
                ruleId: rule.ID || 'default',
                targetStorageClass: transition.StorageClass,
              })
            }
          }
        }
      }

      // Check incomplete multipart uploads
      if (rule.AbortIncompleteMultipartUpload) {
        const daysAfter = rule.AbortIncompleteMultipartUpload.DaysAfterInitiation
        for (const [uploadId, upload] of this.multipartUploads) {
          if (upload.bucket !== name) continue
          if (!matchesLifecycleFilter(upload.key, null, rule.Filter)) continue

          const abortDate = new Date(upload.initiated)
          abortDate.setDate(abortDate.getDate() + daysAfter)
          if (now >= abortDate) {
            evaluation.abortUploads.push({ uploadId, key: upload.key, ruleId: rule.ID || 'default' })
          }
        }
      }
    }

    return evaluation
  }

  /**
   * Apply lifecycle rules to the bucket, executing expirations, transitions, and multipart aborts.
   * This method mutates the bucket's objects and multipart uploads according to lifecycle rules.
   * Returns the actions that were taken.
   */
  async applyLifecycleRules(
    name: string,
    now: Date = new Date()
  ): Promise<LifecycleExecutionResult> {
    const evaluation = await this.evaluateLifecycleRules(name, now)
    const result: LifecycleExecutionResult = {
      deletedObjects: [],
      transitionedObjects: [],
      abortedUploads: [],
    }

    const bucketObjects = this.objects.get(name)
    if (!bucketObjects) {
      return result
    }

    // Apply expirations - delete the objects
    for (const expired of evaluation.expiredObjects) {
      if (bucketObjects.has(expired.key)) {
        bucketObjects.delete(expired.key)
        result.deletedObjects.push({
          key: expired.key,
          ruleId: expired.ruleId,
        })
      }
    }

    // Apply transitions - change storage class
    for (const transition of evaluation.transitionObjects) {
      const obj = bucketObjects.get(transition.key)
      if (obj) {
        obj.storageClass = transition.targetStorageClass
        result.transitionedObjects.push({
          key: transition.key,
          ruleId: transition.ruleId,
          newStorageClass: transition.targetStorageClass,
        })
      }
    }

    // Apply multipart upload aborts
    for (const abort of evaluation.abortUploads) {
      if (this.multipartUploads.has(abort.uploadId)) {
        this.multipartUploads.delete(abort.uploadId)
        result.abortedUploads.push({
          uploadId: abort.uploadId,
          key: abort.key,
          ruleId: abort.ruleId,
        })
      }
    }

    return result
  }

  // --------------------------------------------------------------------------
  // Versioning Operations
  // --------------------------------------------------------------------------

  async putBucketVersioning(name: string, status: VersioningStatus, mfaDelete?: MFADeleteStatus): Promise<void> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    bucket.versioningStatus = status
    if (mfaDelete) {
      bucket.mfaDeleteStatus = mfaDelete
    }

    // Initialize versioned storage for this bucket if not already present
    if (status === 'Enabled' && !this.versionedObjects.has(name)) {
      this.versionedObjects.set(name, new Map())
      this.deleteMarkers.set(name, new Map())
    }
  }

  async getBucketVersioning(name: string): Promise<{ status?: VersioningStatus; mfaDelete?: MFADeleteStatus }> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new Error('NoSuchBucket')
    }
    return {
      status: bucket.versioningStatus,
      mfaDelete: bucket.mfaDeleteStatus,
    }
  }

  /**
   * Check if versioning is enabled for a bucket
   */
  isVersioningEnabled(name: string): boolean {
    const bucket = this.buckets.get(name)
    return bucket?.versioningStatus === 'Enabled'
  }

  /**
   * Generate a unique version ID
   */
  generateVersionId(): string {
    // Generate a version ID similar to S3's format (32 character string)
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 15)
    return `${timestamp}${random}`.padEnd(32, '0')
  }

  /**
   * Put an object with versioning support
   * Returns the version ID if versioning is enabled
   */
  async putObjectVersioned(
    bucket: string,
    key: string,
    data: Uint8Array,
    options?: {
      contentType?: string
      metadata?: Record<string, string>
      storageClass?: StorageClass
    }
  ): Promise<{ versionId?: string }> {
    const bucketObj = this.buckets.get(bucket)
    if (!bucketObj) {
      throw new Error('NoSuchBucket')
    }

    const now = new Date()
    const etag = generateETag(data)

    if (bucketObj.versioningStatus === 'Enabled') {
      // Versioning enabled: create new version
      const versionId = this.generateVersionId()

      // Initialize bucket versioned storage if needed
      if (!this.versionedObjects.has(bucket)) {
        this.versionedObjects.set(bucket, new Map())
      }

      const bucketVersions = this.versionedObjects.get(bucket)!

      // Get or create versioned objects for this key
      if (!bucketVersions.has(key)) {
        bucketVersions.set(key, { versions: new Map(), currentVersionId: null })
      }

      const keyVersions = bucketVersions.get(key)!

      // Mark previous latest version as not latest
      if (keyVersions.currentVersionId) {
        const prevVersion = keyVersions.versions.get(keyVersions.currentVersionId)
        if (prevVersion) {
          prevVersion.isLatest = false
        }
      }

      // Also clear any latest delete markers
      const deleteMarkerMap = this.deleteMarkers.get(bucket)
      if (deleteMarkerMap?.has(key)) {
        const markers = deleteMarkerMap.get(key)!
        for (const marker of markers) {
          marker.isLatest = false
        }
      }

      // Create new version
      const newVersion: InternalObjectVersion = {
        data,
        etag,
        lastModified: now,
        size: data.length,
        contentType: options?.contentType || 'application/octet-stream',
        metadata: options?.metadata,
        storageClass: options?.storageClass || 'STANDARD',
        versionId,
        isLatest: true,
      }

      keyVersions.versions.set(versionId, newVersion)
      keyVersions.currentVersionId = versionId

      // Also update the main objects map for backward compatibility
      if (!this.objects.has(bucket)) {
        this.objects.set(bucket, new Map())
      }
      this.objects.get(bucket)!.set(key, {
        data,
        etag,
        lastModified: now,
        size: data.length,
        contentType: options?.contentType || 'application/octet-stream',
        metadata: options?.metadata,
        storageClass: options?.storageClass || 'STANDARD',
      })

      return { versionId }
    } else if (bucketObj.versioningStatus === 'Suspended') {
      // Versioning suspended: use "null" version ID
      // Store with special "null" version ID
      if (!this.versionedObjects.has(bucket)) {
        this.versionedObjects.set(bucket, new Map())
      }

      const bucketVersions = this.versionedObjects.get(bucket)!

      if (!bucketVersions.has(key)) {
        bucketVersions.set(key, { versions: new Map(), currentVersionId: null })
      }

      const keyVersions = bucketVersions.get(key)!

      // Replace any existing null version
      const newVersion: InternalObjectVersion = {
        data,
        etag,
        lastModified: now,
        size: data.length,
        contentType: options?.contentType || 'application/octet-stream',
        metadata: options?.metadata,
        storageClass: options?.storageClass || 'STANDARD',
        versionId: 'null',
        isLatest: true,
      }

      // Mark previous versions as not latest
      for (const version of keyVersions.versions.values()) {
        version.isLatest = false
      }

      keyVersions.versions.set('null', newVersion)
      keyVersions.currentVersionId = 'null'

      // Update main objects map
      if (!this.objects.has(bucket)) {
        this.objects.set(bucket, new Map())
      }
      this.objects.get(bucket)!.set(key, {
        data,
        etag,
        lastModified: now,
        size: data.length,
        contentType: options?.contentType || 'application/octet-stream',
        metadata: options?.metadata,
        storageClass: options?.storageClass || 'STANDARD',
      })

      return { versionId: 'null' }
    } else {
      // No versioning: standard put
      if (!this.objects.has(bucket)) {
        this.objects.set(bucket, new Map())
      }
      this.objects.get(bucket)!.set(key, {
        data,
        etag,
        lastModified: now,
        size: data.length,
        contentType: options?.contentType || 'application/octet-stream',
        metadata: options?.metadata,
        storageClass: options?.storageClass || 'STANDARD',
      })

      return {}
    }
  }

  /**
   * Delete an object with versioning support
   * Returns delete marker info if versioning is enabled
   */
  async deleteObjectVersioned(
    bucket: string,
    key: string,
    versionId?: string
  ): Promise<{ deleteMarker?: boolean; versionId?: string }> {
    const bucketObj = this.buckets.get(bucket)
    if (!bucketObj) {
      throw new Error('NoSuchBucket')
    }

    if (versionId) {
      // Delete specific version (permanent delete)
      const bucketVersions = this.versionedObjects.get(bucket)
      if (bucketVersions?.has(key)) {
        const keyVersions = bucketVersions.get(key)!
        const version = keyVersions.versions.get(versionId)

        if (version) {
          keyVersions.versions.delete(versionId)

          // If we deleted the current version, update current pointer
          if (keyVersions.currentVersionId === versionId) {
            // Find the next latest version
            let latestTime = 0
            let latestId: string | null = null

            for (const [id, v] of keyVersions.versions) {
              if (v.lastModified.getTime() > latestTime) {
                latestTime = v.lastModified.getTime()
                latestId = id
              }
            }

            keyVersions.currentVersionId = latestId
            if (latestId) {
              keyVersions.versions.get(latestId)!.isLatest = true
            }
          }

          // Also check delete markers
          const deleteMarkerMap = this.deleteMarkers.get(bucket)
          if (deleteMarkerMap?.has(key)) {
            const markers = deleteMarkerMap.get(key)!
            const markerIdx = markers.findIndex((m) => m.versionId === versionId)
            if (markerIdx >= 0) {
              markers.splice(markerIdx, 1)
            }
          }

          return { versionId }
        }
      }

      throw new Error('NoSuchKey')
    }

    if (bucketObj.versioningStatus === 'Enabled') {
      // Create a delete marker
      const deleteVersionId = this.generateVersionId()

      if (!this.deleteMarkers.has(bucket)) {
        this.deleteMarkers.set(bucket, new Map())
      }

      const deleteMarkerMap = this.deleteMarkers.get(bucket)!

      if (!deleteMarkerMap.has(key)) {
        deleteMarkerMap.set(key, [])
      }

      // Mark previous markers as not latest
      const markers = deleteMarkerMap.get(key)!
      for (const marker of markers) {
        marker.isLatest = false
      }

      // Also mark current version as not latest
      const bucketVersions = this.versionedObjects.get(bucket)
      if (bucketVersions?.has(key)) {
        const keyVersions = bucketVersions.get(key)!
        if (keyVersions.currentVersionId) {
          const current = keyVersions.versions.get(keyVersions.currentVersionId)
          if (current) {
            current.isLatest = false
          }
        }
        keyVersions.currentVersionId = null
      }

      markers.push({
        versionId: deleteVersionId,
        created: new Date(),
        isLatest: true,
      })

      // Remove from main objects map
      const bucketObjects = this.objects.get(bucket)
      if (bucketObjects) {
        bucketObjects.delete(key)
      }

      return { deleteMarker: true, versionId: deleteVersionId }
    } else {
      // No versioning or suspended: actual delete
      const bucketObjects = this.objects.get(bucket)
      if (bucketObjects) {
        bucketObjects.delete(key)
      }

      // Also clean up versioned storage if suspended
      if (bucketObj.versioningStatus === 'Suspended') {
        const bucketVersions = this.versionedObjects.get(bucket)
        if (bucketVersions?.has(key)) {
          bucketVersions.get(key)!.versions.delete('null')
        }
      }

      return {}
    }
  }

  /**
   * Get a specific version of an object
   */
  async getObjectVersion(bucket: string, key: string, versionId: string): Promise<InternalObjectVersion | null> {
    const bucketVersions = this.versionedObjects.get(bucket)
    if (!bucketVersions?.has(key)) {
      return null
    }

    const keyVersions = bucketVersions.get(key)!
    return keyVersions.versions.get(versionId) || null
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  clear(): void {
    this.buckets.clear()
    this.objects.clear()
    this.multipartUploads.clear()
    this.versionedObjects.clear()
    this.deleteMarkers.clear()
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
  private bucketMeta: Map<string, InternalBucketExtended> = new Map()
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

  async createBucket(name: string, region?: string, options?: CreateBucketOptions): Promise<void> {
    const metaKey = await this.getBucketMetaKey(name)
    const existing = await this.r2.head(metaKey)

    if (existing) {
      throw new Error('BucketAlreadyExists')
    }

    const bucketMeta: InternalBucketExtended = {
      name,
      creationDate: new Date(),
      region,
      objectOwnership: options?.objectOwnership,
      objectLockEnabled: options?.objectLockEnabled,
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

  async headBucket(name: string): Promise<InternalBucketExtended> {
    // Check cache first
    if (this.bucketMeta.has(name)) {
      return this.bucketMeta.get(name)!
    }

    const metaKey = await this.getBucketMetaKey(name)
    const obj = await this.r2.get(metaKey)

    if (!obj) {
      throw new Error('NoSuchBucket')
    }

    const bucketMeta = JSON.parse(await obj.text()) as InternalBucketExtended
    bucketMeta.creationDate = new Date(bucketMeta.creationDate)
    this.bucketMeta.set(name, bucketMeta)

    return bucketMeta
  }

  async listBuckets(options?: ListBucketsOptions): Promise<ListBucketsResult> {
    const listed = await this.r2.list({ prefix: '__bucket_meta__/' })
    let buckets: InternalBucketExtended[] = []

    for (const obj of listed.objects) {
      const content = await this.r2.get(obj.key)
      if (content) {
        const meta = JSON.parse(await content.text()) as InternalBucketExtended
        meta.creationDate = new Date(meta.creationDate)
        buckets.push(meta)
      }
    }

    // Filter by prefix
    if (options?.prefix) {
      buckets = buckets.filter((b) => b.name.startsWith(options.prefix!))
    }

    // Filter by region
    if (options?.bucketRegion) {
      buckets = buckets.filter((b) => b.region === options.bucketRegion)
    }

    // Sort alphabetically by name
    buckets.sort((a, b) => a.name.localeCompare(b.name))

    // Handle pagination
    let startIndex = 0
    if (options?.continuationToken) {
      try {
        const decodedToken = atob(options.continuationToken)
        const idx = buckets.findIndex((b) => b.name > decodedToken)
        startIndex = idx >= 0 ? idx : buckets.length
      } catch {
        // Invalid token, start from beginning
      }
    }

    const maxBuckets = options?.maxBuckets ?? 1000
    const endIndex = startIndex + maxBuckets
    const resultBuckets = buckets.slice(startIndex, endIndex)

    let continuationToken: string | undefined
    if (endIndex < buckets.length && resultBuckets.length > 0) {
      continuationToken = btoa(resultBuckets[resultBuckets.length - 1].name)
    }

    return {
      buckets: resultBuckets,
      continuationToken,
    }
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
  // CORS Operations
  // --------------------------------------------------------------------------

  async putBucketCors(name: string, config: CORSConfiguration): Promise<void> {
    const bucket = await this.headBucket(name)
    bucket.corsConfiguration = config

    // Persist to R2
    const metaKey = await this.getBucketMetaKey(name)
    await this.r2.put(metaKey, JSON.stringify(bucket))
  }

  async getBucketCors(name: string): Promise<CORSConfiguration | null> {
    const bucket = await this.headBucket(name)
    return bucket.corsConfiguration || null
  }

  async deleteBucketCors(name: string): Promise<void> {
    const bucket = await this.headBucket(name)
    delete bucket.corsConfiguration

    // Persist to R2
    const metaKey = await this.getBucketMetaKey(name)
    await this.r2.put(metaKey, JSON.stringify(bucket))
  }

  // --------------------------------------------------------------------------
  // Lifecycle Operations
  // --------------------------------------------------------------------------

  async putBucketLifecycle(name: string, config: LifecycleConfiguration): Promise<void> {
    const bucket = await this.headBucket(name)
    bucket.lifecycleConfiguration = config

    // Persist to R2
    const metaKey = await this.getBucketMetaKey(name)
    await this.r2.put(metaKey, JSON.stringify(bucket))
  }

  async getBucketLifecycle(name: string): Promise<LifecycleConfiguration | null> {
    const bucket = await this.headBucket(name)
    return bucket.lifecycleConfiguration || null
  }

  async deleteBucketLifecycle(name: string): Promise<void> {
    const bucket = await this.headBucket(name)
    delete bucket.lifecycleConfiguration

    // Persist to R2
    const metaKey = await this.getBucketMetaKey(name)
    await this.r2.put(metaKey, JSON.stringify(bucket))
  }

  // --------------------------------------------------------------------------
  // Versioning Operations
  // --------------------------------------------------------------------------

  async putBucketVersioning(name: string, status: VersioningStatus, mfaDelete?: MFADeleteStatus): Promise<void> {
    const bucket = await this.headBucket(name)
    bucket.versioningStatus = status
    if (mfaDelete) {
      bucket.mfaDeleteStatus = mfaDelete
    }

    // Persist to R2
    const metaKey = await this.getBucketMetaKey(name)
    await this.r2.put(metaKey, JSON.stringify(bucket))
  }

  async getBucketVersioning(name: string): Promise<{ status?: VersioningStatus; mfaDelete?: MFADeleteStatus }> {
    const bucket = await this.headBucket(name)
    return {
      status: bucket.versioningStatus,
      mfaDelete: bucket.mfaDeleteStatus,
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
// Lifecycle Validation and Helpers
// =============================================================================

/**
 * Validates a lifecycle configuration
 * @throws Error with descriptive message if validation fails
 */
function validateLifecycleConfiguration(config: LifecycleConfiguration): void {
  if (!config.Rules || config.Rules.length === 0) {
    throw new Error('InvalidRequest: At least one lifecycle rule must be specified')
  }

  if (config.Rules.length > 1000) {
    throw new Error('InvalidRequest: Maximum number of lifecycle rules (1000) exceeded')
  }

  const ruleIds = new Set<string>()

  for (const rule of config.Rules) {
    // Validate rule ID uniqueness
    if (rule.ID) {
      if (rule.ID.length > 255) {
        throw new Error('InvalidRequest: Rule ID must be 255 characters or less')
      }
      if (ruleIds.has(rule.ID)) {
        throw new Error(`InvalidRequest: Duplicate rule ID: ${rule.ID}`)
      }
      ruleIds.add(rule.ID)
    }

    // Validate status
    if (rule.Status !== 'Enabled' && rule.Status !== 'Disabled') {
      throw new Error('InvalidRequest: Rule status must be Enabled or Disabled')
    }

    // Validate that rule has at least one action
    const hasAction =
      rule.Expiration ||
      rule.Transitions ||
      rule.NoncurrentVersionExpiration ||
      rule.NoncurrentVersionTransitions ||
      rule.AbortIncompleteMultipartUpload

    if (!hasAction) {
      throw new Error('InvalidRequest: Rule must specify at least one action')
    }

    // Validate transitions
    if (rule.Transitions) {
      for (const transition of rule.Transitions) {
        if (!transition.StorageClass) {
          throw new Error('InvalidRequest: Transition must specify StorageClass')
        }
        if (transition.Days !== undefined && transition.Days < 0) {
          throw new Error('InvalidRequest: Transition Days must be non-negative')
        }
      }
    }

    // Validate expiration
    if (rule.Expiration) {
      if (rule.Expiration.Days !== undefined && rule.Expiration.Days < 1) {
        throw new Error('InvalidRequest: Expiration Days must be at least 1')
      }
    }

    // Validate abort incomplete multipart upload
    if (rule.AbortIncompleteMultipartUpload) {
      if (rule.AbortIncompleteMultipartUpload.DaysAfterInitiation < 1) {
        throw new Error('InvalidRequest: DaysAfterInitiation must be at least 1')
      }
    }
  }
}

/**
 * Check if an object matches a lifecycle filter
 */
function matchesLifecycleFilter(
  key: string,
  obj: InternalObject | null,
  filter?: LifecycleFilter
): boolean {
  if (!filter) {
    return true // No filter means all objects match
  }

  // Check prefix filter
  if (filter.Prefix !== undefined) {
    if (!key.startsWith(filter.Prefix)) {
      return false
    }
  }

  // Check tag filter (requires object metadata)
  if (filter.Tag && obj) {
    const tagValue = obj.metadata?.[filter.Tag.Key]
    if (tagValue !== filter.Tag.Value) {
      return false
    }
  }

  // Check object size filters
  if (filter.ObjectSizeGreaterThan !== undefined && obj) {
    if (obj.size <= filter.ObjectSizeGreaterThan) {
      return false
    }
  }

  if (filter.ObjectSizeLessThan !== undefined && obj) {
    if (obj.size >= filter.ObjectSizeLessThan) {
      return false
    }
  }

  // Check And filter
  if (filter.And) {
    if (filter.And.Prefix !== undefined) {
      if (!key.startsWith(filter.And.Prefix)) {
        return false
      }
    }

    if (filter.And.Tags && obj) {
      for (const tag of filter.And.Tags) {
        const tagValue = obj.metadata?.[tag.Key]
        if (tagValue !== tag.Value) {
          return false
        }
      }
    }

    if (filter.And.ObjectSizeGreaterThan !== undefined && obj) {
      if (obj.size <= filter.And.ObjectSizeGreaterThan) {
        return false
      }
    }

    if (filter.And.ObjectSizeLessThan !== undefined && obj) {
      if (obj.size >= filter.And.ObjectSizeLessThan) {
        return false
      }
    }
  }

  return true
}

/**
 * Calculate expiration date for an object based on expiration rule
 */
function calculateExpirationDate(
  objectCreated: Date,
  expiration: LifecycleExpiration,
  now: Date
): Date | null {
  if (expiration.Date) {
    return new Date(expiration.Date)
  }

  if (expiration.Days !== undefined) {
    const expirationDate = new Date(objectCreated)
    expirationDate.setDate(expirationDate.getDate() + expiration.Days)
    return expirationDate
  }

  return null
}

/**
 * Calculate transition date for an object based on transition rule
 */
function calculateTransitionDate(
  objectCreated: Date,
  transition: LifecycleTransition,
  now: Date
): Date | null {
  if (transition.Date) {
    return new Date(transition.Date)
  }

  if (transition.Days !== undefined) {
    const transitionDate = new Date(objectCreated)
    transitionDate.setDate(transitionDate.getDate() + transition.Days)
    return transitionDate
  }

  return null
}

// =============================================================================
// Default Backend Instance
// =============================================================================

/** Shared in-memory backend for testing */
export const defaultMemoryBackend = new MemoryBackend()
