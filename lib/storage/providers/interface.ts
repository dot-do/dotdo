/**
 * Storage Provider Interface
 *
 * Defines the contract for external storage providers in Provider Mode.
 * Allows dotdo to use external storage services (AWS S3, Google Cloud Storage,
 * Supabase Storage, Backblaze B2) as storage backends.
 *
 * This is different from the "compat" layer:
 * - Compat Mode: dotdo provides S3/GCS-compatible APIs for migration FROM services
 * - Provider Mode: dotdo uses external services AS backends (this interface)
 *
 * @module lib/storage/providers
 */

// =============================================================================
// Storage Provider Types
// =============================================================================

/**
 * Supported storage provider types.
 */
export type StorageProviderType = 's3' | 'gcs' | 'supabase' | 'b2' | 'r2'

/**
 * Storage provider error codes.
 */
export type StorageProviderErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'ACCESS_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN'

/**
 * Error thrown by storage providers.
 */
export class StorageProviderError extends Error {
  readonly code: StorageProviderErrorCode
  readonly provider: StorageProviderType
  readonly path?: string
  readonly cause?: Error

  constructor(
    code: StorageProviderErrorCode,
    message: string,
    options?: {
      provider: StorageProviderType
      path?: string
      cause?: Error
    }
  ) {
    super(message)
    this.name = 'StorageProviderError'
    this.code = code
    this.provider = options?.provider ?? 's3'
    this.path = options?.path
    this.cause = options?.cause

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageProviderError)
    }
  }

  static notFound(path: string, provider: StorageProviderType): StorageProviderError {
    return new StorageProviderError('NOT_FOUND', `Object not found: ${path}`, { provider, path })
  }

  static accessDenied(path: string, provider: StorageProviderType): StorageProviderError {
    return new StorageProviderError('ACCESS_DENIED', `Access denied: ${path}`, { provider, path })
  }
}

// =============================================================================
// Object Metadata
// =============================================================================

/**
 * Metadata for a stored object.
 */
export interface ObjectMetadata {
  /** Object key/path */
  key: string

  /** Size in bytes */
  size: number

  /** ETag for cache validation */
  etag: string

  /** MIME content type */
  contentType?: string

  /** Last modified timestamp */
  lastModified?: Date

  /** Custom user metadata */
  customMetadata?: Record<string, string>

  /** Provider-specific storage class */
  storageClass?: string

  /** Provider-specific metadata (raw) */
  providerMetadata?: Record<string, unknown>
}

/**
 * Options for writing objects.
 */
export interface WriteOptions {
  /** MIME content type */
  contentType?: string

  /** Custom user metadata */
  customMetadata?: Record<string, string>

  /** Cache-Control header */
  cacheControl?: string

  /** Content-Disposition header */
  contentDisposition?: string

  /** Storage class (provider-specific) */
  storageClass?: string

  /** ACL (provider-specific, e.g., 'public-read') */
  acl?: string
}

/**
 * Options for reading objects.
 */
export interface ReadOptions {
  /** If-None-Match header (ETag for conditional GET) */
  ifNoneMatch?: string

  /** If-Modified-Since header */
  ifModifiedSince?: Date

  /** Byte range start (inclusive) */
  rangeStart?: number

  /** Byte range end (inclusive) */
  rangeEnd?: number
}

/**
 * Result of a write operation.
 */
export interface WriteResult {
  /** ETag of the stored object */
  etag: string

  /** Size in bytes */
  size: number

  /** Version ID (if versioning enabled) */
  versionId?: string
}

/**
 * Result of a read operation.
 */
export interface ReadResult {
  /** Object data */
  data: Uint8Array

  /** Object metadata */
  metadata: ObjectMetadata

  /** HTTP status code (e.g., 304 for Not Modified) */
  status?: number
}

/**
 * Options for listing objects.
 */
export interface ListOptions {
  /** Key prefix filter */
  prefix?: string

  /** Delimiter for directory-like listing */
  delimiter?: string

  /** Maximum results */
  maxKeys?: number

  /** Continuation token */
  continuationToken?: string

  /** Start after this key */
  startAfter?: string
}

/**
 * Result of a list operation.
 */
export interface ListResult {
  /** Object metadata entries */
  objects: ObjectMetadata[]

  /** Common prefixes (directories) */
  prefixes: string[]

  /** Whether results are truncated */
  isTruncated: boolean

  /** Token for next page */
  nextContinuationToken?: string

  /** Number of keys returned */
  keyCount: number
}

/**
 * Options for copying objects.
 */
export interface CopyOptions {
  /** Destination content type (overrides source) */
  contentType?: string

  /** Custom metadata for destination */
  customMetadata?: string

  /** Destination storage class */
  storageClass?: string

  /** Destination ACL */
  acl?: string
}

/**
 * Options for generating signed URLs.
 */
export interface SignedUrlOptions {
  /** URL expiry in seconds */
  expiresIn: number

  /** HTTP method (GET, PUT, DELETE) */
  method?: 'GET' | 'PUT' | 'DELETE'

  /** Content type for PUT */
  contentType?: string

  /** Custom query parameters */
  queryParams?: Record<string, string>
}

// =============================================================================
// Multipart Upload
// =============================================================================

/**
 * A part in a multipart upload.
 */
export interface UploadPart {
  /** Part number (1-10000) */
  partNumber: number

  /** ETag of the uploaded part */
  etag: string

  /** Size in bytes */
  size: number
}

/**
 * Handle for an in-progress multipart upload.
 */
export interface MultipartUpload {
  /** Unique upload ID */
  uploadId: string

  /** Object key */
  key: string

  /** Upload a part */
  uploadPart(partNumber: number, data: Uint8Array): Promise<UploadPart>

  /** Complete the upload */
  complete(parts: UploadPart[]): Promise<WriteResult>

  /** Abort the upload */
  abort(): Promise<void>
}

// =============================================================================
// Storage Provider Interface
// =============================================================================

/**
 * Storage provider interface.
 *
 * All external storage providers must implement this interface.
 * Provides a unified API for interacting with different storage backends.
 */
export interface StorageProvider {
  /** Provider type identifier */
  readonly type: StorageProviderType

  /** Provider name (for logging) */
  readonly name: string

  // -------------------------------------------------------------------------
  // Basic Operations
  // -------------------------------------------------------------------------

  /**
   * Write an object to storage.
   *
   * @param key - Object key/path
   * @param data - Object data
   * @param options - Write options
   */
  put(key: string, data: Uint8Array | ReadableStream, options?: WriteOptions): Promise<WriteResult>

  /**
   * Read an object from storage.
   *
   * @param key - Object key/path
   * @param options - Read options
   * @returns Object data and metadata, or null if not found
   */
  get(key: string, options?: ReadOptions): Promise<ReadResult | null>

  /**
   * Delete an object.
   *
   * @param key - Object key/path
   */
  delete(key: string): Promise<void>

  /**
   * Check if an object exists.
   *
   * @param key - Object key/path
   */
  exists(key: string): Promise<boolean>

  /**
   * Get object metadata without downloading content.
   *
   * @param key - Object key/path
   */
  head(key: string): Promise<ObjectMetadata | null>

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  /**
   * List objects with optional filtering.
   *
   * @param options - List options
   */
  list(options?: ListOptions): Promise<ListResult>

  // -------------------------------------------------------------------------
  // Batch Operations
  // -------------------------------------------------------------------------

  /**
   * Delete multiple objects.
   *
   * @param keys - Object keys to delete
   * @returns List of keys that failed to delete
   */
  deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: Error }> }>

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------

  /**
   * Copy an object.
   *
   * @param sourceKey - Source object key
   * @param destKey - Destination object key
   * @param options - Copy options
   */
  copy(sourceKey: string, destKey: string, options?: CopyOptions): Promise<WriteResult>

  // -------------------------------------------------------------------------
  // Signed URLs
  // -------------------------------------------------------------------------

  /**
   * Generate a signed URL for direct access.
   *
   * @param key - Object key
   * @param options - Signing options
   */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>

  // -------------------------------------------------------------------------
  // Multipart Upload
  // -------------------------------------------------------------------------

  /**
   * Create a multipart upload.
   *
   * @param key - Object key
   * @param options - Write options
   */
  createMultipartUpload(key: string, options?: WriteOptions): Promise<MultipartUpload>
}

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Base configuration for storage providers.
 */
export interface StorageProviderConfig {
  /** Provider type */
  type: StorageProviderType

  /** Region (if applicable) */
  region?: string

  /** Endpoint URL (for custom endpoints) */
  endpoint?: string
}

/**
 * AWS S3 provider configuration.
 */
export interface S3ProviderConfig extends StorageProviderConfig {
  type: 's3'

  /** AWS access key ID */
  accessKeyId: string

  /** AWS secret access key */
  secretAccessKey: string

  /** S3 bucket name */
  bucket: string

  /** AWS region */
  region: string

  /** Custom endpoint (for S3-compatible services) */
  endpoint?: string

  /** Use path-style URLs */
  forcePathStyle?: boolean
}

/**
 * Google Cloud Storage provider configuration.
 */
export interface GCSProviderConfig extends StorageProviderConfig {
  type: 'gcs'

  /** GCS bucket name */
  bucket: string

  /** Service account key JSON */
  credentials: string | Record<string, unknown>

  /** Project ID */
  projectId?: string
}

/**
 * Supabase Storage provider configuration.
 */
export interface SupabaseStorageProviderConfig extends StorageProviderConfig {
  type: 'supabase'

  /** Supabase project URL */
  url: string

  /** Supabase anon/service key */
  key: string

  /** Storage bucket name */
  bucket: string
}

/**
 * Backblaze B2 provider configuration.
 */
export interface B2ProviderConfig extends StorageProviderConfig {
  type: 'b2'

  /** Application key ID */
  applicationKeyId: string

  /** Application key */
  applicationKey: string

  /** B2 bucket name */
  bucket: string

  /** B2 bucket ID */
  bucketId: string
}

/**
 * Union of all provider configurations.
 */
export type AnyStorageProviderConfig =
  | S3ProviderConfig
  | GCSProviderConfig
  | SupabaseStorageProviderConfig
  | B2ProviderConfig

// Factory function is exported from ./index.ts to avoid circular imports
