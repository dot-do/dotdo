/**
 * @dotdo/s3/commands - S3 Command Classes
 *
 * AWS SDK v3 compatible command classes for S3 operations.
 * Each command encapsulates input parameters for a specific S3 operation.
 *
 * @example
 * ```typescript
 * import {
 *   CreateBucketCommand,
 *   PutObjectCommand,
 *   GetObjectCommand,
 * } from '@dotdo/s3'
 *
 * const client = new S3Client()
 *
 * await client.send(new CreateBucketCommand({ Bucket: 'my-bucket' }))
 * await client.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: 'file.txt', Body: 'Hello' }))
 * const result = await client.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: 'file.txt' }))
 * ```
 */

import type {
  // Bucket operations
  CreateBucketCommandInput,
  DeleteBucketCommandInput,
  HeadBucketCommandInput,
  ListBucketsCommandInput,
  // Object operations
  PutObjectCommandInput,
  GetObjectCommandInput,
  HeadObjectCommandInput,
  DeleteObjectCommandInput,
  DeleteObjectsCommandInput,
  CopyObjectCommandInput,
  ListObjectsV2CommandInput,
  // Multipart operations
  CreateMultipartUploadCommandInput,
  UploadPartCommandInput,
  CompleteMultipartUploadCommandInput,
  AbortMultipartUploadCommandInput,
  ListPartsCommandInput,
  ListMultipartUploadsCommandInput,
  // CORS operations
  PutBucketCorsCommandInput,
  GetBucketCorsCommandInput,
  DeleteBucketCorsCommandInput,
  // Lifecycle operations
  PutBucketLifecycleConfigurationCommandInput,
  GetBucketLifecycleConfigurationCommandInput,
  DeleteBucketLifecycleCommandInput,
  // Versioning operations
  PutBucketVersioningCommandInput,
  GetBucketVersioningCommandInput,
  ListObjectVersionsCommandInput,
  // Extended types
  ExtendedCreateBucketCommandInput,
  ExtendedListBucketsCommandInput,
} from '../types'

// =============================================================================
// Bucket Commands
// =============================================================================

/**
 * Creates a new S3 bucket
 *
 * @example
 * ```typescript
 * await client.send(new CreateBucketCommand({
 *   Bucket: 'my-new-bucket',
 *   CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
 * }))
 * ```
 */
export class CreateBucketCommand {
  constructor(readonly input: CreateBucketCommandInput) {}
}

/**
 * Deletes an S3 bucket (must be empty)
 *
 * @example
 * ```typescript
 * await client.send(new DeleteBucketCommand({ Bucket: 'my-bucket' }))
 * ```
 */
export class DeleteBucketCommand {
  constructor(readonly input: DeleteBucketCommandInput) {}
}

/**
 * Checks if a bucket exists and you have permission to access it
 *
 * @example
 * ```typescript
 * const result = await client.send(new HeadBucketCommand({ Bucket: 'my-bucket' }))
 * console.log(result.BucketRegion)
 * ```
 */
export class HeadBucketCommand {
  constructor(readonly input: HeadBucketCommandInput) {}
}

/**
 * Lists all buckets owned by the authenticated sender of the request
 *
 * @example
 * ```typescript
 * const result = await client.send(new ListBucketsCommand({}))
 * for (const bucket of result.Buckets) {
 *   console.log(bucket.Name, bucket.CreationDate)
 * }
 * ```
 */
export class ListBucketsCommand {
  constructor(readonly input: ListBucketsCommandInput = {}) {}
}

// =============================================================================
// Object Commands
// =============================================================================

/**
 * Adds an object to a bucket
 *
 * @example
 * ```typescript
 * await client.send(new PutObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'documents/report.pdf',
 *   Body: pdfData,
 *   ContentType: 'application/pdf',
 *   Metadata: { author: 'John Doe' },
 * }))
 * ```
 */
export class PutObjectCommand {
  constructor(readonly input: PutObjectCommandInput) {}
}

/**
 * Retrieves objects from S3
 *
 * @example
 * ```typescript
 * const result = await client.send(new GetObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'documents/report.pdf',
 * }))
 * const content = await result.Body.transformToString()
 * ```
 */
export class GetObjectCommand {
  constructor(readonly input: GetObjectCommandInput) {}
}

/**
 * Retrieves metadata from an object without returning the object itself
 *
 * @example
 * ```typescript
 * const result = await client.send(new HeadObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'documents/report.pdf',
 * }))
 * console.log(result.ContentLength, result.ContentType)
 * ```
 */
export class HeadObjectCommand {
  constructor(readonly input: HeadObjectCommandInput) {}
}

/**
 * Removes an object from a bucket
 *
 * @example
 * ```typescript
 * await client.send(new DeleteObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'documents/old-report.pdf',
 * }))
 * ```
 */
export class DeleteObjectCommand {
  constructor(readonly input: DeleteObjectCommandInput) {}
}

/**
 * Deletes multiple objects from a bucket using a single HTTP request
 *
 * @example
 * ```typescript
 * const result = await client.send(new DeleteObjectsCommand({
 *   Bucket: 'my-bucket',
 *   Delete: {
 *     Objects: [
 *       { Key: 'file1.txt' },
 *       { Key: 'file2.txt' },
 *       { Key: 'file3.txt' },
 *     ],
 *   },
 * }))
 * ```
 */
export class DeleteObjectsCommand {
  constructor(readonly input: DeleteObjectsCommandInput) {}
}

/**
 * Creates a copy of an object that is already stored in S3
 *
 * @example
 * ```typescript
 * await client.send(new CopyObjectCommand({
 *   Bucket: 'dest-bucket',
 *   Key: 'copy-of-file.txt',
 *   CopySource: 'source-bucket/original-file.txt',
 *   MetadataDirective: 'COPY',
 * }))
 * ```
 */
export class CopyObjectCommand {
  constructor(readonly input: CopyObjectCommandInput) {}
}

/**
 * Returns some or all (up to 1,000) of the objects in a bucket with each request
 *
 * @example
 * ```typescript
 * const result = await client.send(new ListObjectsV2Command({
 *   Bucket: 'my-bucket',
 *   Prefix: 'documents/',
 *   Delimiter: '/',
 *   MaxKeys: 100,
 * }))
 *
 * // List files
 * for (const obj of result.Contents) {
 *   console.log(obj.Key, obj.Size)
 * }
 *
 * // List "folders"
 * for (const prefix of result.CommonPrefixes) {
 *   console.log('Folder:', prefix.Prefix)
 * }
 * ```
 */
export class ListObjectsV2Command {
  constructor(readonly input: ListObjectsV2CommandInput) {}
}

// =============================================================================
// Multipart Upload Commands
// =============================================================================

/**
 * Initiates a multipart upload and returns an upload ID
 *
 * @example
 * ```typescript
 * const result = await client.send(new CreateMultipartUploadCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'large-file.zip',
 *   ContentType: 'application/zip',
 * }))
 * const uploadId = result.UploadId
 * ```
 */
export class CreateMultipartUploadCommand {
  constructor(readonly input: CreateMultipartUploadCommandInput) {}
}

/**
 * Uploads a part in a multipart upload
 *
 * @example
 * ```typescript
 * const result = await client.send(new UploadPartCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'large-file.zip',
 *   UploadId: uploadId,
 *   PartNumber: 1,
 *   Body: partData,
 * }))
 * const etag = result.ETag
 * ```
 */
export class UploadPartCommand {
  constructor(readonly input: UploadPartCommandInput) {}
}

/**
 * Completes a multipart upload by assembling previously uploaded parts
 *
 * @example
 * ```typescript
 * const result = await client.send(new CompleteMultipartUploadCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'large-file.zip',
 *   UploadId: uploadId,
 *   MultipartUpload: {
 *     Parts: [
 *       { PartNumber: 1, ETag: etag1 },
 *       { PartNumber: 2, ETag: etag2 },
 *     ],
 *   },
 * }))
 * ```
 */
export class CompleteMultipartUploadCommand {
  constructor(readonly input: CompleteMultipartUploadCommandInput) {}
}

/**
 * Aborts a multipart upload
 *
 * @example
 * ```typescript
 * await client.send(new AbortMultipartUploadCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'large-file.zip',
 *   UploadId: uploadId,
 * }))
 * ```
 */
export class AbortMultipartUploadCommand {
  constructor(readonly input: AbortMultipartUploadCommandInput) {}
}

/**
 * Lists the parts that have been uploaded for a specific multipart upload
 *
 * @example
 * ```typescript
 * const result = await client.send(new ListPartsCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'large-file.zip',
 *   UploadId: uploadId,
 * }))
 *
 * for (const part of result.Parts) {
 *   console.log(part.PartNumber, part.Size, part.ETag)
 * }
 * ```
 */
export class ListPartsCommand {
  constructor(readonly input: ListPartsCommandInput) {}
}

/**
 * Lists in-progress multipart uploads in a bucket
 *
 * @example
 * ```typescript
 * const result = await client.send(new ListMultipartUploadsCommand({
 *   Bucket: 'my-bucket',
 *   Prefix: 'uploads/',
 * }))
 *
 * for (const upload of result.Uploads) {
 *   console.log(upload.Key, upload.UploadId, upload.Initiated)
 * }
 * ```
 */
export class ListMultipartUploadsCommand {
  constructor(readonly input: ListMultipartUploadsCommandInput) {}
}

// =============================================================================
// Command Type Union
// =============================================================================

// =============================================================================
// CORS Configuration Commands
// =============================================================================

/**
 * Configures CORS rules for a bucket
 *
 * @example
 * ```typescript
 * await client.send(new PutBucketCorsCommand({
 *   Bucket: 'my-bucket',
 *   CORSConfiguration: {
 *     CORSRules: [
 *       {
 *         AllowedOrigins: ['https://example.com'],
 *         AllowedMethods: ['GET', 'PUT'],
 *         AllowedHeaders: ['*'],
 *         MaxAgeSeconds: 3600,
 *       },
 *     ],
 *   },
 * }))
 * ```
 */
export class PutBucketCorsCommand {
  constructor(readonly input: PutBucketCorsCommandInput) {}
}

/**
 * Gets the CORS configuration for a bucket
 *
 * @example
 * ```typescript
 * const result = await client.send(new GetBucketCorsCommand({
 *   Bucket: 'my-bucket',
 * }))
 * console.log(result.CORSRules)
 * ```
 */
export class GetBucketCorsCommand {
  constructor(readonly input: GetBucketCorsCommandInput) {}
}

/**
 * Deletes the CORS configuration for a bucket
 *
 * @example
 * ```typescript
 * await client.send(new DeleteBucketCorsCommand({
 *   Bucket: 'my-bucket',
 * }))
 * ```
 */
export class DeleteBucketCorsCommand {
  constructor(readonly input: DeleteBucketCorsCommandInput) {}
}

// =============================================================================
// Lifecycle Configuration Commands
// =============================================================================

/**
 * Configures lifecycle rules for a bucket
 *
 * @example
 * ```typescript
 * await client.send(new PutBucketLifecycleConfigurationCommand({
 *   Bucket: 'my-bucket',
 *   LifecycleConfiguration: {
 *     Rules: [
 *       {
 *         ID: 'expire-old-logs',
 *         Status: 'Enabled',
 *         Filter: { Prefix: 'logs/' },
 *         Expiration: { Days: 30 },
 *       },
 *     ],
 *   },
 * }))
 * ```
 */
export class PutBucketLifecycleConfigurationCommand {
  constructor(readonly input: PutBucketLifecycleConfigurationCommandInput) {}
}

/**
 * Gets the lifecycle configuration for a bucket
 *
 * @example
 * ```typescript
 * const result = await client.send(new GetBucketLifecycleConfigurationCommand({
 *   Bucket: 'my-bucket',
 * }))
 * console.log(result.Rules)
 * ```
 */
export class GetBucketLifecycleConfigurationCommand {
  constructor(readonly input: GetBucketLifecycleConfigurationCommandInput) {}
}

/**
 * Deletes the lifecycle configuration for a bucket
 *
 * @example
 * ```typescript
 * await client.send(new DeleteBucketLifecycleCommand({
 *   Bucket: 'my-bucket',
 * }))
 * ```
 */
export class DeleteBucketLifecycleCommand {
  constructor(readonly input: DeleteBucketLifecycleCommandInput) {}
}

// =============================================================================
// Versioning Commands
// =============================================================================

/**
 * Configures versioning for a bucket
 *
 * @example
 * ```typescript
 * await client.send(new PutBucketVersioningCommand({
 *   Bucket: 'my-bucket',
 *   VersioningConfiguration: {
 *     Status: 'Enabled',
 *   },
 * }))
 * ```
 */
export class PutBucketVersioningCommand {
  constructor(readonly input: PutBucketVersioningCommandInput) {}
}

/**
 * Gets the versioning state of a bucket
 *
 * @example
 * ```typescript
 * const result = await client.send(new GetBucketVersioningCommand({
 *   Bucket: 'my-bucket',
 * }))
 * console.log(result.Status) // 'Enabled' | 'Suspended' | undefined
 * ```
 */
export class GetBucketVersioningCommand {
  constructor(readonly input: GetBucketVersioningCommandInput) {}
}

/**
 * Lists all versions of objects in a bucket
 *
 * @example
 * ```typescript
 * const result = await client.send(new ListObjectVersionsCommand({
 *   Bucket: 'my-bucket',
 *   Prefix: 'folder/',
 * }))
 * for (const version of result.Versions || []) {
 *   console.log(version.Key, version.VersionId, version.IsLatest)
 * }
 * ```
 */
export class ListObjectVersionsCommand {
  constructor(readonly input: ListObjectVersionsCommandInput) {}
}

// =============================================================================
// Command Type Union
// =============================================================================

/**
 * Union type of all S3 commands
 */
export type Command =
  | CreateBucketCommand
  | DeleteBucketCommand
  | HeadBucketCommand
  | ListBucketsCommand
  | PutObjectCommand
  | GetObjectCommand
  | HeadObjectCommand
  | DeleteObjectCommand
  | DeleteObjectsCommand
  | CopyObjectCommand
  | ListObjectsV2Command
  | CreateMultipartUploadCommand
  | UploadPartCommand
  | CompleteMultipartUploadCommand
  | AbortMultipartUploadCommand
  | ListPartsCommand
  | ListMultipartUploadsCommand
  // CORS commands
  | PutBucketCorsCommand
  | GetBucketCorsCommand
  | DeleteBucketCorsCommand
  // Lifecycle commands
  | PutBucketLifecycleConfigurationCommand
  | GetBucketLifecycleConfigurationCommand
  | DeleteBucketLifecycleCommand
  // Versioning commands
  | PutBucketVersioningCommand
  | GetBucketVersioningCommand
  | ListObjectVersionsCommand
