/**
 * @dotdo/s3 types
 *
 * @aws-sdk/client-s3 compatible type definitions
 * for the S3 SDK backed by Durable Objects
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */

// ============================================================================
// VALUE TYPES
// ============================================================================

/**
 * S3 object body types
 */
export type Body = string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>

/**
 * Streamable body for responses
 */
export interface StreamingBlobPayloadOutputTypes {
  transformToByteArray(): Promise<Uint8Array>
  transformToString(encoding?: string): Promise<string>
  transformToWebStream(): ReadableStream<Uint8Array>
}

/**
 * S3 object metadata
 */
export type Metadata = Record<string, string>

/**
 * Storage class
 */
export type StorageClass =
  | 'STANDARD'
  | 'REDUCED_REDUNDANCY'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'INTELLIGENT_TIERING'
  | 'GLACIER'
  | 'DEEP_ARCHIVE'
  | 'OUTPOSTS'
  | 'GLACIER_IR'
  | 'SNOW'
  | 'EXPRESS_ONEZONE'

/**
 * Object ownership
 */
export type ObjectOwnership = 'BucketOwnerPreferred' | 'ObjectWriter' | 'BucketOwnerEnforced'

/**
 * Checksum algorithm
 */
export type ChecksumAlgorithm = 'CRC32' | 'CRC32C' | 'SHA1' | 'SHA256'

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * AWS credentials
 */
export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}

/**
 * Credential provider
 */
export type CredentialProvider = () => Promise<Credentials>

/**
 * S3 client configuration
 */
export interface S3ClientConfig {
  /** AWS region */
  region?: string
  /** AWS credentials */
  credentials?: Credentials | CredentialProvider
  /** Custom endpoint URL */
  endpoint?: string
  /** Force path style (bucket in path, not subdomain) */
  forcePathStyle?: boolean
  /** Use dual-stack endpoint */
  useDualstackEndpoint?: boolean
  /** Use accelerate endpoint */
  useAccelerateEndpoint?: boolean
  /** Use FIPS endpoint */
  useFipsEndpoint?: boolean
  /** Disable multipart uploads */
  disableMultipartUploads?: boolean
  /** Maximum attempts for retries */
  maxAttempts?: number
  /** Request handler */
  requestHandler?: unknown
  /** Logger */
  logger?: {
    trace?: (...args: unknown[]) => void
    debug?: (...args: unknown[]) => void
    info?: (...args: unknown[]) => void
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
}

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedS3ClientConfig extends S3ClientConfig {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** R2 bucket binding (if using R2 backend) */
  r2Bucket?: R2Bucket
  /** Shard configuration */
  shard?: {
    /** Sharding algorithm */
    algorithm?: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count?: number
    /** Shard key pattern for routing */
    keyPattern?: string
  }
  /** Replica configuration */
  replica?: {
    /** Read preference */
    readPreference?: 'primary' | 'secondary' | 'nearest'
    /** Write-through to all replicas */
    writeThrough?: boolean
    /** Jurisdiction constraint */
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

// ============================================================================
// BUCKET TYPES
// ============================================================================

/**
 * S3 bucket info
 */
export interface Bucket {
  Name?: string
  CreationDate?: Date
}

/**
 * Owner info
 */
export interface Owner {
  DisplayName?: string
  ID?: string
}

// ============================================================================
// OBJECT TYPES
// ============================================================================

/**
 * S3 object info (from listing)
 */
export interface S3Object {
  Key?: string
  LastModified?: Date
  ETag?: string
  Size?: number
  StorageClass?: StorageClass
  Owner?: Owner
  ChecksumAlgorithm?: ChecksumAlgorithm[]
}

/**
 * Common prefix (folder) in listing
 */
export interface CommonPrefix {
  Prefix?: string
}

/**
 * Object identifier for batch delete
 */
export interface ObjectIdentifier {
  Key: string
  VersionId?: string
}

/**
 * Delete result for batch delete
 */
export interface DeletedObject {
  Key?: string
  VersionId?: string
  DeleteMarker?: boolean
  DeleteMarkerVersionId?: string
}

/**
 * Delete error for batch delete
 */
export interface S3Error {
  Key?: string
  VersionId?: string
  Code?: string
  Message?: string
}

// ============================================================================
// COMMAND INPUT TYPES
// ============================================================================

/**
 * CreateBucketCommand input
 */
export interface CreateBucketCommandInput {
  Bucket: string
  ACL?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read'
  CreateBucketConfiguration?: {
    LocationConstraint?: string
  }
  ObjectOwnership?: ObjectOwnership
}

/**
 * DeleteBucketCommand input
 */
export interface DeleteBucketCommandInput {
  Bucket: string
}

/**
 * ListBucketsCommand input
 */
export interface ListBucketsCommandInput {
  // No parameters
}

/**
 * HeadBucketCommand input
 */
export interface HeadBucketCommandInput {
  Bucket: string
}

/**
 * PutObjectCommand input
 */
export interface PutObjectCommandInput {
  Bucket: string
  Key: string
  Body?: Body
  ContentType?: string
  ContentLength?: number
  ContentEncoding?: string
  ContentDisposition?: string
  ContentLanguage?: string
  ContentMD5?: string
  CacheControl?: string
  Expires?: Date
  Metadata?: Metadata
  StorageClass?: StorageClass
  ACL?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read' | 'aws-exec-read' | 'bucket-owner-read' | 'bucket-owner-full-control'
  Tagging?: string
  ChecksumAlgorithm?: ChecksumAlgorithm
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
}

/**
 * GetObjectCommand input
 */
export interface GetObjectCommandInput {
  Bucket: string
  Key: string
  Range?: string
  IfModifiedSince?: Date
  IfUnmodifiedSince?: Date
  IfMatch?: string
  IfNoneMatch?: string
  VersionId?: string
  PartNumber?: number
  ResponseContentType?: string
  ResponseContentLanguage?: string
  ResponseContentDisposition?: string
  ResponseContentEncoding?: string
  ResponseCacheControl?: string
  ResponseExpires?: Date
}

/**
 * DeleteObjectCommand input
 */
export interface DeleteObjectCommandInput {
  Bucket: string
  Key: string
  VersionId?: string
  MFA?: string
  RequestPayer?: 'requester'
  BypassGovernanceRetention?: boolean
}

/**
 * HeadObjectCommand input
 */
export interface HeadObjectCommandInput {
  Bucket: string
  Key: string
  IfModifiedSince?: Date
  IfUnmodifiedSince?: Date
  IfMatch?: string
  IfNoneMatch?: string
  Range?: string
  VersionId?: string
  PartNumber?: number
}

/**
 * CopyObjectCommand input
 */
export interface CopyObjectCommandInput {
  Bucket: string
  Key: string
  CopySource: string
  CopySourceIfMatch?: string
  CopySourceIfNoneMatch?: string
  CopySourceIfModifiedSince?: Date
  CopySourceIfUnmodifiedSince?: Date
  MetadataDirective?: 'COPY' | 'REPLACE'
  ContentType?: string
  Metadata?: Metadata
  StorageClass?: StorageClass
  ACL?: string
  Tagging?: string
  TaggingDirective?: 'COPY' | 'REPLACE'
}

/**
 * ListObjectsV2Command input
 */
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

/**
 * DeleteObjectsCommand input
 */
export interface DeleteObjectsCommandInput {
  Bucket: string
  Delete: {
    Objects: ObjectIdentifier[]
    Quiet?: boolean
  }
  MFA?: string
  RequestPayer?: 'requester'
  BypassGovernanceRetention?: boolean
  ChecksumAlgorithm?: ChecksumAlgorithm
}

// ============================================================================
// COMMAND OUTPUT TYPES
// ============================================================================

/**
 * CreateBucketCommand output
 */
export interface CreateBucketCommandOutput {
  $metadata: ResponseMetadata
  Location?: string
}

/**
 * DeleteBucketCommand output
 */
export interface DeleteBucketCommandOutput {
  $metadata: ResponseMetadata
}

/**
 * ListBucketsCommand output
 */
export interface ListBucketsCommandOutput {
  $metadata: ResponseMetadata
  Buckets?: Bucket[]
  Owner?: Owner
}

/**
 * HeadBucketCommand output
 */
export interface HeadBucketCommandOutput {
  $metadata: ResponseMetadata
  BucketRegion?: string
  BucketLocationType?: 'AvailabilityZone'
  AccessPointAlias?: boolean
}

/**
 * PutObjectCommand output
 */
export interface PutObjectCommandOutput {
  $metadata: ResponseMetadata
  ETag?: string
  VersionId?: string
  Expiration?: string
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
  ServerSideEncryption?: 'AES256' | 'aws:kms' | 'aws:kms:dsse'
  SSEKMSKeyId?: string
  BucketKeyEnabled?: boolean
  RequestCharged?: 'requester'
}

/**
 * GetObjectCommand output
 */
export interface GetObjectCommandOutput {
  $metadata: ResponseMetadata
  Body?: StreamingBlobPayloadOutputTypes
  ContentType?: string
  ContentLength?: number
  ContentEncoding?: string
  ContentDisposition?: string
  ContentLanguage?: string
  ContentRange?: string
  CacheControl?: string
  Expires?: Date
  ETag?: string
  LastModified?: Date
  Metadata?: Metadata
  VersionId?: string
  StorageClass?: StorageClass
  DeleteMarker?: boolean
  AcceptRanges?: string
  Expiration?: string
  TagCount?: number
  PartsCount?: number
  MissingMeta?: number
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
}

/**
 * DeleteObjectCommand output
 */
export interface DeleteObjectCommandOutput {
  $metadata: ResponseMetadata
  DeleteMarker?: boolean
  VersionId?: string
  RequestCharged?: 'requester'
}

/**
 * HeadObjectCommand output
 */
export interface HeadObjectCommandOutput {
  $metadata: ResponseMetadata
  ContentType?: string
  ContentLength?: number
  ContentEncoding?: string
  ContentDisposition?: string
  ContentLanguage?: string
  CacheControl?: string
  Expires?: Date
  ETag?: string
  LastModified?: Date
  Metadata?: Metadata
  VersionId?: string
  StorageClass?: StorageClass
  DeleteMarker?: boolean
  AcceptRanges?: string
  Expiration?: string
  MissingMeta?: number
  PartsCount?: number
  ArchiveStatus?: 'ARCHIVE_ACCESS' | 'DEEP_ARCHIVE_ACCESS'
  Restore?: string
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
}

/**
 * CopyObjectCommand output
 */
export interface CopyObjectCommandOutput {
  $metadata: ResponseMetadata
  CopyObjectResult?: {
    ETag?: string
    LastModified?: Date
    ChecksumCRC32?: string
    ChecksumCRC32C?: string
    ChecksumSHA1?: string
    ChecksumSHA256?: string
  }
  VersionId?: string
  Expiration?: string
  CopySourceVersionId?: string
  ServerSideEncryption?: 'AES256' | 'aws:kms' | 'aws:kms:dsse'
  SSEKMSKeyId?: string
  BucketKeyEnabled?: boolean
  RequestCharged?: 'requester'
}

/**
 * ListObjectsV2Command output
 */
export interface ListObjectsV2CommandOutput {
  $metadata: ResponseMetadata
  IsTruncated?: boolean
  Contents?: S3Object[]
  Name?: string
  Prefix?: string
  Delimiter?: string
  MaxKeys?: number
  CommonPrefixes?: CommonPrefix[]
  EncodingType?: 'url'
  KeyCount?: number
  ContinuationToken?: string
  NextContinuationToken?: string
  StartAfter?: string
}

/**
 * DeleteObjectsCommand output
 */
export interface DeleteObjectsCommandOutput {
  $metadata: ResponseMetadata
  Deleted?: DeletedObject[]
  Errors?: S3Error[]
  RequestCharged?: 'requester'
}

// ============================================================================
// METADATA
// ============================================================================

/**
 * Response metadata from AWS SDK
 */
export interface ResponseMetadata {
  httpStatusCode?: number
  requestId?: string
  extendedRequestId?: string
  cfId?: string
  attempts?: number
  totalRetryDelay?: number
}

// ============================================================================
// PRESIGNED URL TYPES
// ============================================================================

/**
 * Options for getSignedUrl
 */
export interface GetSignedUrlOptions {
  /** Expiration time in seconds (default: 3600) */
  expiresIn?: number
  /** Unhoistable headers */
  unhoistableHeaders?: Set<string>
  /** Signable headers */
  signableHeaders?: Set<string>
}

/**
 * Presigner config
 */
export interface S3RequestPresignerConfig {
  credentials?: Credentials | CredentialProvider
  region?: string
  sha256?: unknown
  signingDate?: Date
}

// ============================================================================
// COMMAND INTERFACE
// ============================================================================

/**
 * Base command interface
 */
export interface Command<Input, Output> {
  input: Input
  _type: string
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * S3 service exception base
 */
export class S3ServiceException extends Error {
  readonly $fault: 'client' | 'server'
  readonly $service: string
  readonly $metadata: ResponseMetadata

  constructor(options: {
    name: string
    message: string
    $fault: 'client' | 'server'
    $metadata?: ResponseMetadata
  }) {
    super(options.message)
    this.name = options.name
    this.$fault = options.$fault
    this.$service = 's3'
    this.$metadata = options.$metadata ?? {}
  }
}

/**
 * Bucket not found error
 */
export class NoSuchBucket extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'NoSuchBucket',
      message: options?.message ?? 'The specified bucket does not exist',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Object not found error
 */
export class NoSuchKey extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'NoSuchKey',
      message: options?.message ?? 'The specified key does not exist',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Bucket already exists error
 */
export class BucketAlreadyExists extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'BucketAlreadyExists',
      message: options?.message ?? 'The requested bucket name is not available',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Bucket already owned by you error
 */
export class BucketAlreadyOwnedByYou extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'BucketAlreadyOwnedByYou',
      message: options?.message ?? 'The bucket you tried to create already exists and you own it',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Bucket not empty error
 */
export class BucketNotEmpty extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'BucketNotEmpty',
      message: options?.message ?? 'The bucket you tried to delete is not empty',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Invalid object state error
 */
export class InvalidObjectState extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'InvalidObjectState',
      message: options?.message ?? 'The operation is not valid for the object\'s storage class',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Not modified (304) error
 */
export class NotModified extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'NotModified',
      message: options?.message ?? 'Not Modified',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}

/**
 * Precondition failed (412) error
 */
export class PreconditionFailed extends S3ServiceException {
  constructor(options?: { message?: string; $metadata?: ResponseMetadata }) {
    super({
      name: 'PreconditionFailed',
      message: options?.message ?? 'At least one of the preconditions you specified did not hold',
      $fault: 'client',
      $metadata: options?.$metadata,
    })
  }
}
