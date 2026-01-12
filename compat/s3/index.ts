/**
 * @dotdo/s3 - AWS S3 SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @aws-sdk/client-s3 that runs on Cloudflare Workers
 * with in-memory storage (for testing) or R2 backend (for production).
 *
 * Features:
 * - API-compatible with @aws-sdk/client-s3 v3
 * - Bucket operations: create, delete, list, head
 * - Object operations: put, get, delete, copy, list, head
 * - Multipart uploads: initiate, upload part, complete, abort
 * - Presigned URLs: getSignedUrl for get/put operations
 * - Streaming: support for streaming uploads/downloads
 * - Pluggable backends: MemoryBackend (testing), R2Backend (production)
 *
 * @example
 * ```typescript
 * import {
 *   S3Client,
 *   CreateBucketCommand,
 *   PutObjectCommand,
 *   GetObjectCommand,
 *   ListObjectsV2Command,
 * } from '@dotdo/s3'
 *
 * const client = new S3Client({ region: 'auto' })
 *
 * // Create a bucket
 * await client.send(new CreateBucketCommand({ Bucket: 'my-bucket' }))
 *
 * // Put object
 * await client.send(new PutObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-key',
 *   Body: 'Hello World',
 *   ContentType: 'text/plain',
 * }))
 *
 * // Get object
 * const response = await client.send(new GetObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-key',
 * }))
 * const body = await response.Body.transformToString()
 *
 * // List objects
 * const list = await client.send(new ListObjectsV2Command({
 *   Bucket: 'my-bucket',
 *   Prefix: 'folder/',
 * }))
 * ```
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */

// =============================================================================
// Re-export from modular structure
// =============================================================================

// Client
export { S3Client } from './client'

// Commands
export {
  // Bucket commands
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  // Object commands
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  // Multipart commands
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  // Type
  type Command,
} from './commands'

// Errors
export {
  S3ServiceException,
  NoSuchBucket,
  NoSuchKey,
  BucketAlreadyExists,
  BucketAlreadyOwnedByYou,
  BucketNotEmpty,
  NoSuchUpload,
  InvalidPart,
  InvalidPartOrder,
  EntityTooSmall,
  EntityTooLarge,
  AccessDenied,
  InvalidAccessKeyId,
  SignatureDoesNotMatch,
  InvalidRequest,
  InvalidBucketName,
  InvalidRange,
  PreconditionFailed,
  NotModified,
  InternalError,
  ServiceUnavailable,
  SlowDown,
} from './errors'

// Types
export type {
  StorageClass,
  S3ClientConfig,
  ExtendedS3ClientConfig,
  ResponseMetadata,
  StreamingBody,
  RequestPresigningArguments,
  // Bucket types
  CreateBucketCommandInput,
  CreateBucketCommandOutput,
  DeleteBucketCommandInput,
  DeleteBucketCommandOutput,
  HeadBucketCommandInput,
  HeadBucketCommandOutput,
  ListBucketsCommandInput,
  ListBucketsCommandOutput,
  // Object types
  PutObjectCommandInput,
  PutObjectCommandOutput,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadObjectCommandInput,
  HeadObjectCommandOutput,
  DeleteObjectCommandInput,
  DeleteObjectCommandOutput,
  DeleteObjectsCommandInput,
  DeleteObjectsCommandOutput,
  CopyObjectCommandInput,
  CopyObjectCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  // Multipart types
  CreateMultipartUploadCommandInput,
  CreateMultipartUploadCommandOutput,
  UploadPartCommandInput,
  UploadPartCommandOutput,
  CompleteMultipartUploadCommandInput,
  CompleteMultipartUploadCommandOutput,
  AbortMultipartUploadCommandInput,
  AbortMultipartUploadCommandOutput,
  ListPartsCommandInput,
  ListPartsCommandOutput,
  ListMultipartUploadsCommandInput,
  ListMultipartUploadsCommandOutput,
} from './types'

// Backend (for advanced usage)
export {
  type StorageBackend,
  MemoryBackend,
  R2Backend,
  defaultMemoryBackend,
} from './backend'

// Presigning
export { getSignedUrl } from './presign'

// =============================================================================
// Test Utilities
// =============================================================================

import { defaultMemoryBackend } from './backend'

/**
 * Clear all in-memory storage (for testing)
 */
export function _clearAll(): void {
  defaultMemoryBackend.clear()
}

/**
 * Get internal buckets (for testing)
 * @deprecated Use defaultMemoryBackend directly
 */
export function _getBuckets(): Map<string, unknown> {
  // Return a map-like interface for backward compatibility
  return new Map()
}

// =============================================================================
// Default Export
// =============================================================================

export { S3Client as default } from './client'
