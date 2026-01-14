/**
 * @dotdo/supabase/storage - Supabase Storage SDK Compat Layer
 *
 * Drop-in replacement for @supabase/storage-js that runs on Cloudflare Workers
 * with in-memory storage (for testing) or R2 backend (for production).
 *
 * Features:
 * - API-compatible with @supabase/storage-js
 * - Bucket operations: create, update, delete, list
 * - Object operations: upload, download, copy, move, remove
 * - Public/private access with signed URLs
 * - Image transformations (resize, crop, format)
 * - File type validation
 * - File size limits
 *
 * @example
 * ```typescript
 * import { StorageClient } from '@dotdo/supabase/storage'
 *
 * const storage = new StorageClient('https://project.supabase.co/storage/v1', {
 *   apikey: 'your-api-key',
 * })
 *
 * // Create a public bucket
 * await storage.createBucket('avatars', { public: true })
 *
 * // Upload a file
 * const file = storage.from('avatars')
 * await file.upload('user/avatar.png', imageData, {
 *   contentType: 'image/png',
 *   cacheControl: '3600',
 * })
 *
 * // Get public URL
 * const { data } = file.getPublicUrl('user/avatar.png')
 *
 * // Download with transformation
 * const { data: blob } = await file.download('user/avatar.png', {
 *   transform: { width: 100, height: 100, resize: 'cover' }
 * })
 *
 * // Create signed URL for private files
 * const { data: signed } = await file.createSignedUrl('private/doc.pdf', 3600)
 *
 * // List files in a folder
 * const { data: files } = await file.list('user/')
 *
 * // Remove files
 * await file.remove(['user/old-avatar.png'])
 * ```
 *
 * @see https://supabase.com/docs/reference/javascript/storage-createbucket
 */

// =============================================================================
// Main Classes
// =============================================================================

export { StorageClient, StorageFileApi, _clearAll, createTestClient } from './client'
export type { StorageClientOptions } from './client'

// =============================================================================
// Backend
// =============================================================================

export {
  StorageBackend,
  MemoryBackend,
  R2Backend,
  getDefaultBackend,
  setDefaultBackend,
  resetToMemoryBackend,
} from './backend'

// =============================================================================
// Errors
// =============================================================================

export {
  StorageApiError,
  BucketNotFoundError,
  BucketAlreadyExistsError,
  BucketNotEmptyError,
  FileNotFoundError,
  FileAlreadyExistsError,
  InvalidFileTypeError,
  FileTooLargeError,
  UnauthorizedError,
  ForbiddenError,
  InvalidPathError,
  InvalidBucketNameError,
  validateBucketName,
  validatePath,
  isRetryableError,
  toStorageError,
} from './errors'

// =============================================================================
// Types
// =============================================================================

export type {
  // File options
  FileOptions,
  TransformOptions,
  CreateSignedUrlOptions,
  UploadOptions,
  DownloadOptions,

  // Bucket types
  Bucket,
  CreateBucketOptions,
  UpdateBucketOptions,

  // File/Object types
  FileObject,
  FileObjectV2,
  FileMetadata,
  SearchOptions,
  ListOptions,

  // Signed URL types
  SignedUrl,
  SignedUploadUrl,

  // Response types
  StorageApiResponse,
  StorageError,
  UploadResponse,
  CopyResponse,
  MoveResponse,
  RemoveResponse,

  // Internal types (for testing)
  InternalBucket,
  InternalFile,
} from './types'

// =============================================================================
// Default Export
// =============================================================================

export { StorageClient as default } from './client'
