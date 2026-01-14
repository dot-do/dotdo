/**
 * @dotdo/supabase/storage/types - Supabase Storage Type Definitions
 *
 * Type definitions matching the official @supabase/storage-js API.
 *
 * @see https://supabase.com/docs/reference/javascript/storage-createbucket
 */

// =============================================================================
// File Options
// =============================================================================

export interface FileOptions {
  /** Cache-Control header value */
  cacheControl?: string
  /** Content-Type header value (auto-detected if not provided) */
  contentType?: string
  /** Whether to upsert (overwrite) existing file */
  upsert?: boolean
  /** Duplex option for streaming uploads */
  duplex?: string
}

export interface TransformOptions {
  /** Width to resize to (1-2560px) */
  width?: number
  /** Height to resize to (1-2560px) */
  height?: number
  /** Resize mode */
  resize?: 'cover' | 'contain' | 'fill'
  /** Output format */
  format?: 'origin' | 'avif' | 'webp'
  /** Quality (1-100) */
  quality?: number
}

export interface CreateSignedUrlOptions {
  /** Download instead of display */
  download?: boolean | string
  /** Image transformation options */
  transform?: TransformOptions
}

export interface UploadOptions extends FileOptions {
  /** Additional metadata */
  metadata?: Record<string, string>
}

export interface DownloadOptions {
  /** Image transformation options */
  transform?: TransformOptions
}

// =============================================================================
// Bucket Types
// =============================================================================

export interface Bucket {
  /** Bucket unique ID */
  id: string
  /** Bucket name */
  name: string
  /** Owner ID */
  owner?: string
  /** Creation timestamp */
  created_at?: string
  /** Last update timestamp */
  updated_at?: string
  /** Whether the bucket is public */
  public: boolean
  /** Allowed MIME types (null = all types allowed) */
  allowed_mime_types?: string[] | null
  /** Maximum file size in bytes */
  file_size_limit?: number | null
}

export interface CreateBucketOptions {
  /** Whether the bucket is public (default: false) */
  public?: boolean
  /** Allowed MIME types (default: all types) */
  allowedMimeTypes?: string[]
  /** Maximum file size in bytes (default: unlimited) */
  fileSizeLimit?: number
}

export interface UpdateBucketOptions {
  /** Whether the bucket is public */
  public?: boolean
  /** Allowed MIME types */
  allowedMimeTypes?: string[]
  /** Maximum file size in bytes */
  fileSizeLimit?: number
}

// =============================================================================
// File/Object Types
// =============================================================================

export interface FileObject {
  /** File name */
  name: string
  /** Bucket ID */
  bucket_id?: string
  /** Owner ID */
  owner?: string
  /** File ID */
  id?: string
  /** Last update timestamp */
  updated_at?: string
  /** Creation timestamp */
  created_at?: string
  /** Last access timestamp */
  last_accessed_at?: string
  /** File metadata */
  metadata?: Record<string, unknown>
}

export interface FileObjectV2 {
  /** File name */
  name: string
  /** File ID */
  id: string
  /** Last update timestamp */
  updated_at: string
  /** Creation timestamp */
  created_at: string
  /** Last access timestamp */
  last_accessed_at: string
  /** File metadata */
  metadata: FileMetadata
}

export interface FileMetadata {
  /** ETag */
  eTag?: string
  /** File size in bytes */
  size: number
  /** MIME type */
  mimetype: string
  /** Cache-Control header */
  cacheControl?: string
  /** Last modified timestamp */
  lastModified?: string
  /** Content length */
  contentLength?: number
  /** HTTP status code */
  httpStatusCode?: number
}

export interface SearchOptions {
  /** Maximum results to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Sort by column */
  sortBy?: {
    column: 'name' | 'updated_at' | 'created_at' | 'last_accessed_at'
    order: 'asc' | 'desc'
  }
  /** Search term (for name prefix matching) */
  search?: string
}

export interface ListOptions extends SearchOptions {
  /** Whether to return only folders */
  foldersOnly?: boolean
}

// =============================================================================
// Signed URL Types
// =============================================================================

export interface SignedUrl {
  /** Error if any */
  error: string | null
  /** File path */
  path: string | null
  /** Signed URL */
  signedUrl: string
}

export interface SignedUploadUrl {
  /** Signed URL for upload */
  signedUrl: string
  /** Token for upload */
  token: string
  /** Path */
  path: string
}

// =============================================================================
// Response Types
// =============================================================================

export interface StorageApiResponse<T> {
  data: T | null
  error: StorageError | null
}

export interface StorageError {
  /** Error message */
  message: string
  /** HTTP status code */
  statusCode?: string
  /** Error code */
  error?: string
}

export interface UploadResponse {
  /** File path including bucket */
  path: string
  /** File ID */
  id: string
  /** Full path */
  fullPath: string
}

export interface CopyResponse {
  /** New file path */
  path: string
}

export interface MoveResponse {
  /** Error message */
  message: string
}

export interface RemoveResponse {
  /** Error message */
  message: string
}

// =============================================================================
// Internal Types
// =============================================================================

export interface InternalBucket {
  id: string
  name: string
  public: boolean
  allowedMimeTypes: string[] | null
  fileSizeLimit: number | null
  createdAt: Date
  updatedAt: Date
  files: Map<string, InternalFile>
}

export interface InternalFile {
  name: string
  bucketId: string
  body: Uint8Array
  contentType: string
  cacheControl: string
  metadata: Record<string, string>
  createdAt: Date
  updatedAt: Date
  lastAccessedAt: Date
}
