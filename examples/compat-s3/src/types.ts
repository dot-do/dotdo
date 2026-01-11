/**
 * S3-compatible types for Durable Object storage
 */

// ============================================================================
// Core S3 Types
// ============================================================================

export interface S3Object {
  key: string
  size: number
  etag: string
  lastModified: Date
  contentType?: string
  contentEncoding?: string
  cacheControl?: string
  contentDisposition?: string
  contentLanguage?: string
  expires?: Date
  metadata?: Record<string, string>
  storageClass?: StorageClass
  checksumCRC32?: string
  checksumCRC32C?: string
  checksumSHA1?: string
  checksumSHA256?: string
}

export interface S3ObjectVersion extends S3Object {
  versionId: string
  isLatest: boolean
  isDeleteMarker?: boolean
}

export type StorageClass =
  | 'STANDARD'
  | 'REDUCED_REDUNDANCY'
  | 'INTELLIGENT_TIERING'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'GLACIER'
  | 'GLACIER_IR'
  | 'DEEP_ARCHIVE'

// ============================================================================
// Bucket Types
// ============================================================================

export interface Bucket {
  name: string
  creationDate: Date
  region?: string
  owner?: BucketOwner
}

export interface BucketOwner {
  id: string
  displayName?: string
}

export interface BucketVersioningConfiguration {
  status: 'Enabled' | 'Suspended'
  mfaDelete?: 'Enabled' | 'Disabled'
}

// ============================================================================
// ACL Types
// ============================================================================

export type Permission = 'FULL_CONTROL' | 'READ' | 'WRITE' | 'READ_ACP' | 'WRITE_ACP'
export type CannedACL =
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read'
  | 'aws-exec-read'
  | 'bucket-owner-read'
  | 'bucket-owner-full-control'
  | 'log-delivery-write'

export interface Grantee {
  type: 'CanonicalUser' | 'AmazonCustomerByEmail' | 'Group'
  id?: string
  displayName?: string
  emailAddress?: string
  uri?: string
}

export interface Grant {
  grantee: Grantee
  permission: Permission
}

export interface AccessControlPolicy {
  owner: BucketOwner
  grants: Grant[]
}

// ============================================================================
// Multipart Upload Types
// ============================================================================

export interface MultipartUpload {
  uploadId: string
  key: string
  bucket: string
  initiated: Date
  storageClass?: StorageClass
  owner?: BucketOwner
  initiator?: BucketOwner
}

export interface Part {
  partNumber: number
  etag: string
  size: number
  lastModified: Date
  checksumCRC32?: string
  checksumCRC32C?: string
  checksumSHA1?: string
  checksumSHA256?: string
}

export interface CompletedPart {
  partNumber: number
  etag: string
  checksumCRC32?: string
  checksumCRC32C?: string
  checksumSHA1?: string
  checksumSHA256?: string
}

export interface MultipartUploadResult {
  location: string
  bucket: string
  key: string
  etag: string
  versionId?: string
  checksumCRC32?: string
  checksumCRC32C?: string
  checksumSHA1?: string
  checksumSHA256?: string
}

// ============================================================================
// List Objects Types
// ============================================================================

export interface ListObjectsV2Request {
  bucket: string
  prefix?: string
  delimiter?: string
  maxKeys?: number
  continuationToken?: string
  startAfter?: string
  fetchOwner?: boolean
  encodingType?: 'url'
}

export interface ListObjectsV2Response {
  name: string
  prefix?: string
  delimiter?: string
  maxKeys: number
  isTruncated: boolean
  contents: S3Object[]
  commonPrefixes: { prefix: string }[]
  continuationToken?: string
  nextContinuationToken?: string
  startAfter?: string
  keyCount: number
  encodingType?: 'url'
}

export interface ListMultipartUploadsRequest {
  bucket: string
  prefix?: string
  delimiter?: string
  maxUploads?: number
  keyMarker?: string
  uploadIdMarker?: string
  encodingType?: 'url'
}

export interface ListMultipartUploadsResponse {
  bucket: string
  keyMarker?: string
  uploadIdMarker?: string
  nextKeyMarker?: string
  nextUploadIdMarker?: string
  maxUploads: number
  isTruncated: boolean
  uploads: MultipartUpload[]
  commonPrefixes: { prefix: string }[]
  encodingType?: 'url'
}

export interface ListPartsRequest {
  bucket: string
  key: string
  uploadId: string
  maxParts?: number
  partNumberMarker?: number
}

export interface ListPartsResponse {
  bucket: string
  key: string
  uploadId: string
  partNumberMarker?: number
  nextPartNumberMarker?: number
  maxParts: number
  isTruncated: boolean
  parts: Part[]
  storageClass?: StorageClass
  initiator?: BucketOwner
  owner?: BucketOwner
}

// ============================================================================
// Pre-signed URL Types
// ============================================================================

export interface PresignedUrlOptions {
  expiresIn?: number // seconds, default 3600
  method?: 'GET' | 'PUT' | 'DELETE' | 'HEAD'
  contentType?: string
  contentMd5?: string
  metadata?: Record<string, string>
  queryParams?: Record<string, string>
}

export interface PresignedPostOptions {
  expiresIn?: number
  conditions?: Array<
    | { bucket: string }
    | { key: string }
    | ['starts-with', string, string]
    | ['content-length-range', number, number]
    | ['eq', string, string]
    | Record<string, string>
  >
  fields?: Record<string, string>
}

export interface PresignedPost {
  url: string
  fields: Record<string, string>
}

// ============================================================================
// Copy Object Types
// ============================================================================

export interface CopyObjectRequest {
  sourceBucket: string
  sourceKey: string
  destinationBucket: string
  destinationKey: string
  sourceVersionId?: string
  metadata?: Record<string, string>
  metadataDirective?: 'COPY' | 'REPLACE'
  contentType?: string
  cacheControl?: string
  contentDisposition?: string
  contentEncoding?: string
  contentLanguage?: string
  expires?: Date
  storageClass?: StorageClass
  acl?: CannedACL
  copySourceIfMatch?: string
  copySourceIfNoneMatch?: string
  copySourceIfModifiedSince?: Date
  copySourceIfUnmodifiedSince?: Date
}

export interface CopyObjectResult {
  etag: string
  lastModified: Date
  versionId?: string
  sourceVersionId?: string
  checksumCRC32?: string
  checksumCRC32C?: string
  checksumSHA1?: string
  checksumSHA256?: string
}

// ============================================================================
// Error Types
// ============================================================================

export class S3Error extends Error {
  code: string
  statusCode: number
  resource?: string
  requestId?: string

  constructor(
    code: string,
    message: string,
    statusCode: number,
    resource?: string
  ) {
    super(message)
    this.name = 'S3Error'
    this.code = code
    this.statusCode = statusCode
    this.resource = resource
  }

  toXML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${this.code}</Code>
  <Message>${this.message}</Message>
  ${this.resource ? `<Resource>${this.resource}</Resource>` : ''}
  ${this.requestId ? `<RequestId>${this.requestId}</RequestId>` : ''}
</Error>`
  }
}

// Common S3 Errors
export const S3Errors = {
  NoSuchBucket: (bucket: string) =>
    new S3Error('NoSuchBucket', `The specified bucket does not exist`, 404, bucket),
  NoSuchKey: (key: string) =>
    new S3Error('NoSuchKey', `The specified key does not exist`, 404, key),
  NoSuchUpload: (uploadId: string) =>
    new S3Error('NoSuchUpload', `The specified multipart upload does not exist`, 404, uploadId),
  BucketAlreadyExists: (bucket: string) =>
    new S3Error('BucketAlreadyExists', `The requested bucket name is not available`, 409, bucket),
  BucketNotEmpty: (bucket: string) =>
    new S3Error('BucketNotEmpty', `The bucket you tried to delete is not empty`, 409, bucket),
  InvalidBucketName: (bucket: string) =>
    new S3Error('InvalidBucketName', `The specified bucket is not valid`, 400, bucket),
  InvalidPartOrder: () =>
    new S3Error('InvalidPartOrder', `The list of parts was not in ascending order`, 400),
  InvalidPart: (partNumber: number) =>
    new S3Error('InvalidPart', `One or more of the specified parts could not be found`, 400, `Part ${partNumber}`),
  EntityTooSmall: () =>
    new S3Error('EntityTooSmall', `Your proposed upload is smaller than the minimum allowed size`, 400),
  EntityTooLarge: () =>
    new S3Error('EntityTooLarge', `Your proposed upload exceeds the maximum allowed size`, 400),
  AccessDenied: (resource: string) =>
    new S3Error('AccessDenied', `Access Denied`, 403, resource),
  SignatureDoesNotMatch: () =>
    new S3Error('SignatureDoesNotMatch', `The request signature we calculated does not match the signature you provided`, 403),
  ExpiredToken: () =>
    new S3Error('ExpiredToken', `The provided token has expired`, 400),
  MissingSecurityHeader: (header: string) =>
    new S3Error('MissingSecurityHeader', `Your request was missing a required header`, 400, header),
  PreconditionFailed: () =>
    new S3Error('PreconditionFailed', `At least one of the preconditions you specified did not hold`, 412),
  NotModified: () =>
    new S3Error('NotModified', `Not Modified`, 304),
}

// ============================================================================
// Environment Types
// ============================================================================

export interface Env {
  S3_DO: DurableObjectNamespace
  BUCKET_DO: DurableObjectNamespace
  R2_STORAGE: R2Bucket
  ENVIRONMENT?: string
  DEFAULT_PART_SIZE?: string
  MAX_PARTS?: string
  PRESIGNED_URL_EXPIRY?: string
  S3_ACCESS_KEY_ID?: string
  S3_SECRET_ACCESS_KEY?: string
}
