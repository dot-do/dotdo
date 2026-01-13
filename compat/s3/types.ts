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
  /** Retry configuration for resilience */
  retryConfig?: {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number
    /** Initial delay in milliseconds (default: 1000) */
    initialDelay?: number
    /** Maximum delay cap in milliseconds (default: 32000) */
    maxDelay?: number
    /** Backoff multiplier (default: 2) */
    multiplier?: number
    /** Jitter factor 0-1 (default: 0.25 for +/-25%) */
    jitter?: number
    /** Total timeout budget in milliseconds (default: 60000) */
    timeoutBudget?: number
  }
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

export interface ListBucketsCommandInput {
  /** Maximum number of buckets to return */
  MaxBuckets?: number
  /** Continuation token for pagination */
  ContinuationToken?: string
  /** Filter buckets by name prefix */
  Prefix?: string
  /** Filter buckets by region */
  BucketRegion?: string
}

export interface ListBucketsCommandOutput {
  Buckets?: Array<{ Name?: string; CreationDate?: Date; BucketRegion?: string }>
  Owner?: { ID?: string; DisplayName?: string }
  /** Continuation token for next page */
  ContinuationToken?: string
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

// =============================================================================
// CORS Configuration Types
// =============================================================================

export interface CORSRule {
  /** Origins allowed to make cross-origin requests */
  AllowedOrigins: string[]
  /** HTTP methods allowed (GET, PUT, POST, DELETE, HEAD) */
  AllowedMethods: ('GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD')[]
  /** Headers allowed in preflight requests */
  AllowedHeaders?: string[]
  /** Headers exposed to the browser */
  ExposeHeaders?: string[]
  /** Time in seconds that browser caches preflight response */
  MaxAgeSeconds?: number
  /** Unique ID for this rule */
  ID?: string
}

export interface CORSConfiguration {
  CORSRules: CORSRule[]
}

export interface PutBucketCorsCommandInput {
  Bucket: string
  CORSConfiguration: CORSConfiguration
}

export interface PutBucketCorsCommandOutput {
  $metadata: ResponseMetadata
}

export interface GetBucketCorsCommandInput {
  Bucket: string
}

export interface GetBucketCorsCommandOutput {
  CORSRules?: CORSRule[]
  $metadata: ResponseMetadata
}

export interface DeleteBucketCorsCommandInput {
  Bucket: string
}

export interface DeleteBucketCorsCommandOutput {
  $metadata: ResponseMetadata
}

// =============================================================================
// Lifecycle Configuration Types
// =============================================================================

export interface LifecycleTag {
  Key: string
  Value: string
}

export interface LifecycleFilter {
  Prefix?: string
  Tag?: LifecycleTag
  And?: {
    Prefix?: string
    Tags?: LifecycleTag[]
    ObjectSizeGreaterThan?: number
    ObjectSizeLessThan?: number
  }
  ObjectSizeGreaterThan?: number
  ObjectSizeLessThan?: number
}

export interface LifecycleExpiration {
  /** Number of days after creation to expire */
  Days?: number
  /** Specific date to expire */
  Date?: Date
  /** Whether to delete expired delete markers */
  ExpiredObjectDeleteMarker?: boolean
}

export interface LifecycleTransition {
  /** Number of days after creation to transition */
  Days?: number
  /** Specific date to transition */
  Date?: Date
  /** Target storage class */
  StorageClass: StorageClass
}

export interface NoncurrentVersionExpiration {
  /** Days after becoming noncurrent to expire */
  NoncurrentDays: number
  /** Number of newer versions to retain */
  NewerNoncurrentVersions?: number
}

export interface NoncurrentVersionTransition {
  /** Days after becoming noncurrent to transition */
  NoncurrentDays: number
  /** Target storage class */
  StorageClass: StorageClass
  /** Number of newer versions to retain */
  NewerNoncurrentVersions?: number
}

export interface AbortIncompleteMultipartUpload {
  /** Days after initiation to abort */
  DaysAfterInitiation: number
}

export interface LifecycleRule {
  /** Unique identifier for the rule (max 255 chars) */
  ID?: string
  /** Rule status */
  Status: 'Enabled' | 'Disabled'
  /** Filter for objects this rule applies to */
  Filter?: LifecycleFilter
  /** Expiration settings */
  Expiration?: LifecycleExpiration
  /** Transition settings (can have multiple) */
  Transitions?: LifecycleTransition[]
  /** Noncurrent version expiration */
  NoncurrentVersionExpiration?: NoncurrentVersionExpiration
  /** Noncurrent version transitions */
  NoncurrentVersionTransitions?: NoncurrentVersionTransition[]
  /** Abort incomplete multipart uploads */
  AbortIncompleteMultipartUpload?: AbortIncompleteMultipartUpload
}

export interface LifecycleConfiguration {
  Rules: LifecycleRule[]
}

export interface PutBucketLifecycleConfigurationCommandInput {
  Bucket: string
  LifecycleConfiguration: LifecycleConfiguration
}

export interface PutBucketLifecycleConfigurationCommandOutput {
  $metadata: ResponseMetadata
}

export interface GetBucketLifecycleConfigurationCommandInput {
  Bucket: string
}

export interface GetBucketLifecycleConfigurationCommandOutput {
  Rules?: LifecycleRule[]
  $metadata: ResponseMetadata
}

export interface DeleteBucketLifecycleCommandInput {
  Bucket: string
}

export interface DeleteBucketLifecycleCommandOutput {
  $metadata: ResponseMetadata
}

// =============================================================================
// Versioning Types
// =============================================================================

export type VersioningStatus = 'Enabled' | 'Suspended'
export type MFADeleteStatus = 'Enabled' | 'Disabled'

export interface VersioningConfiguration {
  Status: VersioningStatus
  MFADelete?: MFADeleteStatus
}

export interface PutBucketVersioningCommandInput {
  Bucket: string
  VersioningConfiguration: VersioningConfiguration
}

export interface PutBucketVersioningCommandOutput {
  $metadata: ResponseMetadata
}

export interface GetBucketVersioningCommandInput {
  Bucket: string
}

export interface GetBucketVersioningCommandOutput {
  Status?: VersioningStatus
  MFADelete?: MFADeleteStatus
  $metadata: ResponseMetadata
}

// =============================================================================
// List Object Versions Types
// =============================================================================

export interface ObjectVersion {
  Key?: string
  VersionId?: string
  IsLatest?: boolean
  LastModified?: Date
  ETag?: string
  Size?: number
  StorageClass?: StorageClass
  Owner?: { ID?: string; DisplayName?: string }
}

export interface DeleteMarkerEntry {
  Key?: string
  VersionId?: string
  IsLatest?: boolean
  LastModified?: Date
  Owner?: { ID?: string; DisplayName?: string }
}

export interface ListObjectVersionsCommandInput {
  Bucket: string
  Prefix?: string
  Delimiter?: string
  MaxKeys?: number
  KeyMarker?: string
  VersionIdMarker?: string
  EncodingType?: 'url'
}

export interface ListObjectVersionsCommandOutput {
  Name?: string
  Prefix?: string
  Delimiter?: string
  MaxKeys?: number
  IsTruncated?: boolean
  KeyMarker?: string
  VersionIdMarker?: string
  NextKeyMarker?: string
  NextVersionIdMarker?: string
  Versions?: ObjectVersion[]
  DeleteMarkers?: DeleteMarkerEntry[]
  CommonPrefixes?: Array<{ Prefix?: string }>
  EncodingType?: 'url'
  $metadata: ResponseMetadata
}

// =============================================================================
// Extended Bucket Types
// =============================================================================

export type ObjectOwnership = 'BucketOwnerEnforced' | 'BucketOwnerPreferred' | 'ObjectWriter'

export interface ExtendedCreateBucketCommandInput extends CreateBucketCommandInput {
  /** Object ownership setting */
  ObjectOwnership?: ObjectOwnership
  /** Enable object lock for the bucket */
  ObjectLockEnabledForBucket?: boolean
}

export interface ExtendedListBucketsCommandInput extends ListBucketsCommandInput {
  /** Maximum number of buckets to return */
  MaxBuckets?: number
  /** Continuation token for pagination */
  ContinuationToken?: string
  /** Filter buckets by name prefix */
  Prefix?: string
  /** Filter buckets by region */
  BucketRegion?: string
}

export interface ExtendedListBucketsCommandOutput extends ListBucketsCommandOutput {
  /** Continuation token for next page */
  ContinuationToken?: string
}

// =============================================================================
// Internal Extended Types (for backends)
// =============================================================================

export interface InternalBucketExtended extends InternalBucket {
  /** Object ownership setting */
  objectOwnership?: ObjectOwnership
  /** Whether object lock is enabled */
  objectLockEnabled?: boolean
  /** Versioning status */
  versioningStatus?: VersioningStatus
  /** MFA delete status */
  mfaDeleteStatus?: MFADeleteStatus
  /** CORS configuration */
  corsConfiguration?: CORSConfiguration
  /** Lifecycle configuration */
  lifecycleConfiguration?: LifecycleConfiguration
}

// =============================================================================
// Internal Versioned Object Types
// =============================================================================

export interface InternalObjectVersion extends InternalObject {
  /** Unique version ID */
  versionId: string
  /** Whether this is the latest version */
  isLatest: boolean
  /** Whether this is a delete marker */
  isDeleteMarker?: boolean
}

export interface InternalVersionedObjects {
  /** All versions indexed by versionId */
  versions: Map<string, InternalObjectVersion>
  /** The current/latest version ID (null if latest is a delete marker) */
  currentVersionId: string | null
}

export interface DeleteMarker {
  /** Unique version ID for this delete marker */
  versionId: string
  /** When the delete marker was created */
  created: Date
}
