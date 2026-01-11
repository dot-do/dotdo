/**
 * S3-Compatible API Layer for Durable Objects
 *
 * Drop-in replacement for AWS S3 SDK backed by Cloudflare R2 and Durable Objects.
 *
 * Features:
 * - Full S3 REST API compatibility via HTTP router
 * - AWS SDK v3 compatible client wrapper
 * - Multipart uploads with R2 storage
 * - Pre-signed URLs with AWS Signature V4
 * - Bucket and object ACLs
 * - Object versioning (coming soon)
 *
 * @example Basic Usage with HTTP Router
 * ```typescript
 * import { s3Router, S3DO, BucketDO } from './compat-s3'
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 * app.route('/s3', s3Router)
 *
 * export default {
 *   fetch: app.fetch,
 * }
 *
 * export { S3DO, BucketDO }
 * ```
 *
 * @example Usage with AWS SDK v3 Compatible Client
 * ```typescript
 * import { S3Client, PutObjectCommand, GetObjectCommand } from './compat-s3/client'
 *
 * const client = new S3Client({
 *   region: 'auto',
 *   endpoint: 'https://s3.example.com',
 * })
 *
 * // Put object
 * await client.send(new PutObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'hello.txt',
 *   Body: 'Hello World',
 * }))
 *
 * // Get object
 * const response = await client.send(new GetObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'hello.txt',
 * }))
 * ```
 *
 * @module
 */

// =============================================================================
// Durable Objects
// =============================================================================

export { S3DO } from './S3DO'
export { BucketDO } from './BucketDO'

// =============================================================================
// HTTP Router
// =============================================================================

export { s3Router, default as router } from './router'

// =============================================================================
// AWS SDK v3 Compatible Client
// =============================================================================

export {
  S3Client,
  // Bucket Commands
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  // Object Commands
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  // Multipart Commands
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  // ACL Commands
  GetBucketAclCommand,
  PutBucketAclCommand,
  GetObjectAclCommand,
  PutObjectAclCommand,
  // Pre-signed URL
  getSignedUrl,
  // Types
  type S3ClientConfig,
  type ResponseMetadata,
  type CreateBucketCommandInput,
  type CreateBucketCommandOutput,
  type DeleteBucketCommandInput,
  type DeleteBucketCommandOutput,
  type HeadBucketCommandInput,
  type HeadBucketCommandOutput,
  type ListBucketsCommandInput,
  type ListBucketsCommandOutput,
  type PutObjectCommandInput,
  type PutObjectCommandOutput,
  type GetObjectCommandInput,
  type GetObjectCommandOutput,
  type HeadObjectCommandInput,
  type HeadObjectCommandOutput,
  type DeleteObjectCommandInput,
  type DeleteObjectCommandOutput,
  type DeleteObjectsCommandInput,
  type DeleteObjectsCommandOutput,
  type CopyObjectCommandInput,
  type CopyObjectCommandOutput,
  type ListObjectsV2CommandInput,
  type ListObjectsV2CommandOutput,
  type CreateMultipartUploadCommandInput,
  type CreateMultipartUploadCommandOutput,
  type UploadPartCommandInput,
  type UploadPartCommandOutput,
  type CompleteMultipartUploadCommandInput,
  type CompleteMultipartUploadCommandOutput,
  type AbortMultipartUploadCommandInput,
  type AbortMultipartUploadCommandOutput,
  type ListPartsCommandInput,
  type ListPartsCommandOutput,
  type ListMultipartUploadsCommandInput,
  type ListMultipartUploadsCommandOutput,
  type GetBucketAclCommandInput,
  type GetBucketAclCommandOutput,
  type PutBucketAclCommandInput,
  type PutBucketAclCommandOutput,
  type GetObjectAclCommandInput,
  type GetObjectAclCommandOutput,
  type PutObjectAclCommandInput,
  type PutObjectAclCommandOutput,
} from './client'

// =============================================================================
// Multipart Upload Manager
// =============================================================================

export { MultipartUploadManager } from './multipart'

// =============================================================================
// Signing Utilities
// =============================================================================

export {
  getSignedUrl as createPresignedGetUrl,
  createPresignedPost,
  verifySignature,
  generateETag,
  generateMultipartETag,
  type SigningConfig,
  type SignatureVerificationResult,
} from './signing'

// =============================================================================
// Types
// =============================================================================

export type {
  // Core S3 Types
  S3Object,
  S3ObjectVersion,
  StorageClass,
  // Bucket Types
  Bucket,
  BucketOwner,
  BucketVersioningConfiguration,
  // ACL Types
  Permission,
  CannedACL,
  Grantee,
  Grant,
  AccessControlPolicy,
  // Multipart Types
  MultipartUpload,
  Part,
  CompletedPart,
  MultipartUploadResult,
  // List Types
  ListObjectsV2Request,
  ListObjectsV2Response,
  ListMultipartUploadsRequest,
  ListMultipartUploadsResponse,
  ListPartsRequest,
  ListPartsResponse,
  // Pre-signed Types
  PresignedUrlOptions,
  PresignedPostOptions,
  PresignedPost,
  // Copy Types
  CopyObjectRequest,
  CopyObjectResult,
  // Environment
  Env,
} from './types'

// Error handling
export { S3Error, S3Errors } from './types'
