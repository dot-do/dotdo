/**
 * @dotdo/s3 - Type definitions for S3 SDK Compat Layer
 *
 * AWS SDK v3 compatible type definitions for S3 operations.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */

// =============================================================================
// Storage Class Types
// =============================================================================

export type StorageClass =
  | 'STANDARD'
  | 'REDUCED_REDUNDANCY'
  | 'INTELLIGENT_TIERING'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'GLACIER'
  | 'GLACIER_IR'
  | 'DEEP_ARCHIVE'

// =============================================================================
// Client Configuration
// =============================================================================

export interface S3ClientConfig {
  region?: string
  endpoint?: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  forcePathStyle?: boolean
}

export interface ExtendedS3ClientConfig extends S3ClientConfig {
  /** R2 bucket binding for production use */
  r2Bucket?: R2Bucket
  /** Use in-memory storage (for testing) */
  useMemoryStorage?: boolean
}

// =============================================================================
// Response Metadata
// =============================================================================

export interface ResponseMetadata {
  httpStatusCode?: number
  requestId?: string
  extendedRequestId?: string
  attempts?: number
  totalRetryDelay?: number
}

// =============================================================================
// Streaming Body
// =============================================================================

export interface StreamingBody {
  transformToString(): Promise<string>
  transformToByteArray(): Promise<Uint8Array>
  transformToWebStream(): ReadableStream<Uint8Array>
}

// =============================================================================
// Bucket Operations
// =============================================================================

export interface CreateBucketCommandInput {
  Bucket: string
  ACL?: string
  CreateBucketConfiguration?: { LocationConstraint?: string }
}

export interface CreateBucketCommandOutput {
  Location?: string
  $metadata: ResponseMetadata
}

export interface DeleteBucketCommandInput {
  Bucket: string
}

export interface DeleteBucketCommandOutput {
  $metadata: ResponseMetadata
}

export interface HeadBucketCommandInput {
  Bucket: string
}

export interface HeadBucketCommandOutput {
  BucketRegion?: string
  $metadata: ResponseMetadata
}

export interface ListBucketsCommandInput {}

export interface ListBucketsCommandOutput {
  Buckets?: Array<{ Name?: string; CreationDate?: Date }>
  Owner?: { ID?: string; DisplayName?: string }
  $metadata: ResponseMetadata
}

// =============================================================================
// Object Operations
// =============================================================================

export interface PutObjectCommandInput {
  Bucket: string
  Key: string
  Body?: ReadableStream<Uint8Array> | Uint8Array | string
  ContentType?: string
  ContentEncoding?: string
  CacheControl?: string
  ContentDisposition?: string
  ContentLanguage?: string
  Expires?: Date
  Metadata?: Record<string, string>
  StorageClass?: StorageClass
  ACL?: string
}

export interface PutObjectCommandOutput {
  ETag?: string
  VersionId?: string
  $metadata: ResponseMetadata
}

export interface GetObjectCommandInput {
  Bucket: string
  Key: string
  Range?: string
  IfMatch?: string
  IfNoneMatch?: string
  IfModifiedSince?: Date
  IfUnmodifiedSince?: Date
  VersionId?: string
}

export interface GetObjectCommandOutput {
  Body?: StreamingBody
  ContentLength?: number
  ContentType?: string
  ContentEncoding?: string
  CacheControl?: string
  ContentDisposition?: string
  ContentLanguage?: string
  ContentRange?: string
  ETag?: string
  LastModified?: Date
  Metadata?: Record<string, string>
  VersionId?: string
  $metadata: ResponseMetadata
}

export interface HeadObjectCommandInput {
  Bucket: string
  Key: string
  VersionId?: string
  IfMatch?: string
  IfNoneMatch?: string
  IfModifiedSince?: Date
  IfUnmodifiedSince?: Date
}

export interface HeadObjectCommandOutput {
  ContentLength?: number
  ContentType?: string
  ContentEncoding?: string
  CacheControl?: string
  ContentDisposition?: string
  ContentLanguage?: string
  ETag?: string
  LastModified?: Date
  Metadata?: Record<string, string>
  VersionId?: string
  StorageClass?: StorageClass
  $metadata: ResponseMetadata
}

export interface DeleteObjectCommandInput {
  Bucket: string
  Key: string
  VersionId?: string
}

export interface DeleteObjectCommandOutput {
  DeleteMarker?: boolean
  VersionId?: string
  $metadata: ResponseMetadata
}

export interface DeleteObjectsCommandInput {
  Bucket: string
  Delete: {
    Objects: Array<{ Key: string; VersionId?: string }>
    Quiet?: boolean
  }
}

export interface DeleteObjectsCommandOutput {
  Deleted?: Array<{ Key?: string; VersionId?: string; DeleteMarker?: boolean }>
  Errors?: Array<{ Key?: string; Code?: string; Message?: string }>
  $metadata: ResponseMetadata
}

export interface CopyObjectCommandInput {
  Bucket: string
  Key: string
  CopySource: string
  CopySourceIfMatch?: string
  CopySourceIfNoneMatch?: string
  CopySourceIfModifiedSince?: Date
  CopySourceIfUnmodifiedSince?: Date
  MetadataDirective?: 'COPY' | 'REPLACE'
  Metadata?: Record<string, string>
  ContentType?: string
  CacheControl?: string
  ContentDisposition?: string
  ContentEncoding?: string
  ContentLanguage?: string
  Expires?: Date
  StorageClass?: StorageClass
  ACL?: string
}

export interface CopyObjectCommandOutput {
  CopyObjectResult?: { ETag?: string; LastModified?: Date }
  VersionId?: string
  CopySourceVersionId?: string
  $metadata: ResponseMetadata
}

// =============================================================================
// List Operations
// =============================================================================

export interface ListObjectsV2CommandInput {
  Bucket: string
  Prefix?: string
  Delimiter?: string
  MaxKeys?: number
  ContinuationToken?: string
  StartAfter?: string
  FetchOwner?: boolean
  EncodingType?: 'url'
}

export interface ListObjectsV2CommandOutput {
  Name?: string
  Prefix?: string
  Delimiter?: string
  MaxKeys?: number
  IsTruncated?: boolean
  Contents?: Array<{
    Key?: string
    Size?: number
    ETag?: string
    LastModified?: Date
    StorageClass?: StorageClass
    Owner?: { ID?: string; DisplayName?: string }
  }>
  CommonPrefixes?: Array<{ Prefix?: string }>
  ContinuationToken?: string
  NextContinuationToken?: string
  StartAfter?: string
  KeyCount?: number
  EncodingType?: 'url'
  $metadata: ResponseMetadata
}

// =============================================================================
// Multipart Upload Operations
// =============================================================================

export interface CreateMultipartUploadCommandInput {
  Bucket: string
  Key: string
  ContentType?: string
  Metadata?: Record<string, string>
  StorageClass?: StorageClass
  ACL?: string
}

export interface CreateMultipartUploadCommandOutput {
  Bucket?: string
  Key?: string
  UploadId?: string
  $metadata: ResponseMetadata
}

export interface UploadPartCommandInput {
  Bucket: string
  Key: string
  UploadId: string
  PartNumber: number
  Body?: ReadableStream<Uint8Array> | Uint8Array
  ContentMD5?: string
}

export interface UploadPartCommandOutput {
  ETag?: string
  $metadata: ResponseMetadata
}

export interface CompleteMultipartUploadCommandInput {
  Bucket: string
  Key: string
  UploadId: string
  MultipartUpload?: {
    Parts?: Array<{ PartNumber?: number; ETag?: string }>
  }
}

export interface CompleteMultipartUploadCommandOutput {
  Location?: string
  Bucket?: string
  Key?: string
  ETag?: string
  VersionId?: string
  $metadata: ResponseMetadata
}

export interface AbortMultipartUploadCommandInput {
  Bucket: string
  Key: string
  UploadId: string
}

export interface AbortMultipartUploadCommandOutput {
  $metadata: ResponseMetadata
}

export interface ListPartsCommandInput {
  Bucket: string
  Key: string
  UploadId: string
  MaxParts?: number
  PartNumberMarker?: number
}

export interface ListPartsCommandOutput {
  Bucket?: string
  Key?: string
  UploadId?: string
  PartNumberMarker?: number
  NextPartNumberMarker?: number
  MaxParts?: number
  IsTruncated?: boolean
  Parts?: Array<{
    PartNumber?: number
    ETag?: string
    Size?: number
    LastModified?: Date
  }>
  $metadata: ResponseMetadata
}

export interface ListMultipartUploadsCommandInput {
  Bucket: string
  Prefix?: string
  Delimiter?: string
  MaxUploads?: number
  KeyMarker?: string
  UploadIdMarker?: string
}

export interface ListMultipartUploadsCommandOutput {
  Bucket?: string
  KeyMarker?: string
  UploadIdMarker?: string
  NextKeyMarker?: string
  NextUploadIdMarker?: string
  MaxUploads?: number
  IsTruncated?: boolean
  Uploads?: Array<{
    Key?: string
    UploadId?: string
    Initiated?: Date
    StorageClass?: StorageClass
  }>
  CommonPrefixes?: Array<{ Prefix?: string }>
  $metadata: ResponseMetadata
}

// =============================================================================
// Presigning Types
// =============================================================================

export interface RequestPresigningArguments {
  /**
   * The number of seconds before the presigned URL expires.
   * Default: 900 (15 minutes)
   * Maximum: 604800 (7 days)
   */
  expiresIn?: number

  /**
   * The date the URL should stop being valid.
   * Takes precedence over expiresIn.
   */
  expiresAt?: Date

  /**
   * A set of strings representing the signed headers.
   */
  signedHeaders?: Set<string>

  /**
   * A set of strings representing the unsigned headers.
   */
  unsignableHeaders?: Set<string>

  /**
   * A set of strings representing the signed query parameters.
   */
  unhoistableHeaders?: Set<string>
}

// =============================================================================
// Internal Storage Types (for backends)
// =============================================================================

export interface InternalBucket {
  name: string
  creationDate: Date
  region?: string
}

export interface InternalObject {
  key: string
  body: Uint8Array
  contentType?: string
  contentEncoding?: string
  cacheControl?: string
  contentDisposition?: string
  contentLanguage?: string
  metadata?: Record<string, string>
  etag: string
  lastModified: Date
  size: number
  storageClass?: StorageClass
}

export interface InternalMultipartUpload {
  uploadId: string
  bucket: string
  key: string
  initiated: Date
  parts: Map<number, InternalPart>
  contentType?: string
  metadata?: Record<string, string>
}

export interface InternalPart {
  partNumber: number
  body: Uint8Array
  etag: string
  size: number
  lastModified: Date
}
