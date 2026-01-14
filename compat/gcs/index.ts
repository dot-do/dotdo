/**
 * @dotdo/gcs - Google Cloud Storage SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @google-cloud/storage that runs on Cloudflare Workers
 * with in-memory storage (for testing) or R2 backend (for production).
 *
 * Features:
 * - API-compatible with @google-cloud/storage
 * - Bucket operations: create, delete, list, exists
 * - Object operations: save, download, delete, copy, move
 * - Signed URLs: v2 and v4 signature generation
 * - Resumable uploads: initiate, resume, complete
 * - Streaming: createReadStream, createWriteStream
 * - Metadata: get, set, update
 * - Object versioning
 * - ACLs and IAM-style permissions
 * - Object lifecycle policies
 * - Notifications/Pub-Sub integration
 *
 * @example
 * ```typescript
 * import { Storage } from '@dotdo/gcs'
 *
 * const storage = new Storage({
 *   projectId: 'my-project',
 *   credentials: { client_email: '...', private_key: '...' },
 * })
 *
 * // Bucket operations
 * const [bucket] = await storage.createBucket('my-bucket', {
 *   location: 'US',
 *   storageClass: 'STANDARD',
 * })
 *
 * const [buckets] = await storage.getBuckets()
 *
 * // File operations
 * const file = bucket.file('my-file.txt')
 * await file.save('Hello World', { contentType: 'text/plain' })
 *
 * const [content] = await file.download()
 * console.log(content.toString())
 *
 * // Streaming upload
 * const writeStream = file.createWriteStream({ contentType: 'text/plain' })
 * // ... pipe data to writeStream
 *
 * // Streaming download
 * const readStream = file.createReadStream()
 * // ... pipe readStream to destination
 *
 * // Copy/Move
 * await file.copy(bucket.file('copied.txt'))
 * await file.move(bucket.file('moved.txt'))
 *
 * // Signed URLs
 * const [url] = await file.getSignedUrl({
 *   action: 'read',
 *   expires: Date.now() + 15 * 60 * 1000,
 * })
 *
 * // Metadata
 * const [metadata] = await file.getMetadata()
 * await file.setMetadata({ cacheControl: 'public, max-age=3600' })
 *
 * // List files
 * const [files] = await bucket.getFiles({ prefix: 'folder/' })
 *
 * // Lifecycle management
 * await bucket.setLifecycle([
 *   { action: { type: 'Delete' }, condition: { age: 30 } },
 *   { action: { type: 'SetStorageClass', storageClass: 'NEARLINE' }, condition: { age: 7 } },
 * ])
 *
 * // Notifications
 * const [notification] = await bucket.createNotification({
 *   topic: 'projects/my-project/topics/my-topic',
 *   eventTypes: ['OBJECT_FINALIZE'],
 * })
 * ```
 *
 * @see https://cloud.google.com/nodejs/docs/reference/storage/latest
 */

// =============================================================================
// Main Classes
// =============================================================================

export { Storage, Bucket, File, _clearAll, _getBuckets } from './client'

// =============================================================================
// Error Classes
// =============================================================================

export {
  ApiError,
  NotFoundError,
  BucketNotFoundError,
  FileNotFoundError,
  ConflictError,
  BucketAlreadyExistsError,
  BucketNotEmptyError,
  PreconditionFailedError,
  GenerationMismatchError,
  BadRequestError,
  InvalidBucketNameError,
  InvalidArgumentError,
  UnauthorizedError,
  ForbiddenError,
  BucketAccessDeniedError,
  ObjectAccessDeniedError,
  RequestTimeoutError,
  GoneError,
  ResumableUploadExpiredError,
  RangeNotSatisfiableError,
  TooManyRequestsError,
  InternalError,
  ServiceUnavailableError,
  ChecksumMismatchError,
  NotificationNotFoundError,
  ResumableUploadNotFoundError,
  AclNotFoundError,
  validateBucketName,
  isRetryableError,
  isNotFoundError,
  isConflictError,
} from './errors'

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

export type { ListFilesOptions, ListFilesResult } from './backend'

// =============================================================================
// ACL & IAM
// =============================================================================

export {
  Acl,
  BucketAcl,
  DefaultObjectAcl,
  FileAcl,
  BucketIam,
  ACL_ENTITIES,
  ACL_ROLES,
  IAM_ROLES,
  parseEntity,
  formatEntity,
  expandPredefinedBucketAcl,
  expandPredefinedObjectAcl,
  formatIamMember,
  parseIamMember,
} from './acl'

// =============================================================================
// Lifecycle
// =============================================================================

export {
  LifecycleBuilder,
  LifecycleEvaluator,
  LifecycleManager,
  LifecycleTemplates,
} from './lifecycle'

export type { LifecycleConditionOptions, LifecycleEvaluationResult } from './lifecycle'

// =============================================================================
// Notifications
// =============================================================================

export {
  NotificationBuilder,
  NotificationManager,
  NotificationEmitter,
  createNotificationEvent,
  createPubSubMessage,
  parsePubSubMessage,
  globalNotificationEmitter,
} from './notifications'

export type {
  NotificationEvent,
  PubSubMessage,
  NotificationHandler,
} from './notifications'

// =============================================================================
// Signed URLs
// =============================================================================

export {
  generateSignedUrl,
  generateSignedPostPolicyV4,
  generateResumableUploadUrl,
  validateSignedUrl,
} from './signed-url'

// =============================================================================
// Types
// =============================================================================

export type {
  // Storage options
  StorageOptions,
  ExtendedStorageOptions,
  StorageClass,

  // Bucket types
  CreateBucketOptions,
  GetBucketsOptions,
  BucketMetadata,

  // File types
  GetFilesOptions,
  GetFilesResponse,
  FileMetadata,
  SaveOptions,
  SetMetadataOptions,
  CopyOptions,
  DownloadOptions,
  GetMetadataResponse,

  // Signed URL types
  SignedUrlConfig,
  GenerateSignedPostPolicyV4Options,
  SignedPostPolicyV4,
  PostPolicyCondition,

  // Resumable upload types
  CreateResumableUploadOptions,
  ResumableUploadOptions,

  // ACL types
  PredefinedBucketAcl,
  PredefinedObjectAcl,
  BucketAccessControl,
  ObjectAccessControl,
  AddAclOptions,

  // IAM types
  Policy,
  PolicyBinding,
  PolicyCondition,
  TestIamPermissionsOptions,

  // CORS types
  CorsConfiguration,

  // Lifecycle types
  LifecycleRule,
  LifecycleAction,
  LifecycleCondition,

  // Notification types
  NotificationConfig,
  NotificationMetadata,
  NotificationEventType,

  // HMAC key types
  HmacKeyMetadata,
  CreateHmacKeyOptions,

  // Internal types (for testing)
  InternalBucket,
  InternalFile,
  InternalFileVersion,
  InternalResumableUpload,

  // Make public response
  MakeFilePublicResponse,
} from './types'

// =============================================================================
// Default Export
// =============================================================================

import { Storage } from './client'
export default Storage
