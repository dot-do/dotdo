/**
 * AWS SDK v3 compatible S3 client wrapper
 *
 * Drop-in replacement for @aws-sdk/client-s3 that routes to Durable Object backend
 */

import type {
  S3Object,
  Bucket,
  BucketOwner,
  AccessControlPolicy,
  CannedACL,
  StorageClass,
  Part,
  CompletedPart,
  MultipartUpload,
  MultipartUploadResult,
  PresignedUrlOptions,
  PresignedPostOptions,
  PresignedPost,
  CopyObjectResult,
  Env,
} from './types'
import type { S3DO } from './S3DO'

// ============================================================================
// Client Configuration
// ============================================================================

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

// ============================================================================
// Command Input/Output Types
// ============================================================================

// Bucket operations
export interface CreateBucketCommandInput {
  Bucket: string
  ACL?: CannedACL
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

// Object operations
export interface PutObjectCommandInput {
  Bucket: string
  Key: string
  Body?: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string
  ContentType?: string
  ContentEncoding?: string
  CacheControl?: string
  ContentDisposition?: string
  ContentLanguage?: string
  Expires?: Date
  Metadata?: Record<string, string>
  StorageClass?: StorageClass
  ACL?: CannedACL
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
}

export interface PutObjectCommandOutput {
  ETag?: string
  VersionId?: string
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
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
  Body?: ReadableStream<Uint8Array>
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
  ACL?: CannedACL
}

export interface CopyObjectCommandOutput {
  CopyObjectResult?: { ETag?: string; LastModified?: Date }
  VersionId?: string
  CopySourceVersionId?: string
  $metadata: ResponseMetadata
}

// List operations
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

// Multipart operations
export interface CreateMultipartUploadCommandInput {
  Bucket: string
  Key: string
  ContentType?: string
  Metadata?: Record<string, string>
  StorageClass?: StorageClass
  ACL?: CannedACL
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
  Body?: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array
  ContentMD5?: string
}

export interface UploadPartCommandOutput {
  ETag?: string
  ChecksumCRC32?: string
  ChecksumCRC32C?: string
  ChecksumSHA1?: string
  ChecksumSHA256?: string
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

// ACL operations
export interface GetBucketAclCommandInput {
  Bucket: string
}

export interface GetBucketAclCommandOutput {
  Owner?: { ID?: string; DisplayName?: string }
  Grants?: Array<{
    Grantee?: {
      Type?: 'CanonicalUser' | 'AmazonCustomerByEmail' | 'Group'
      ID?: string
      DisplayName?: string
      EmailAddress?: string
      URI?: string
    }
    Permission?: string
  }>
  $metadata: ResponseMetadata
}

export interface PutBucketAclCommandInput {
  Bucket: string
  ACL?: CannedACL
  AccessControlPolicy?: AccessControlPolicy
}

export interface PutBucketAclCommandOutput {
  $metadata: ResponseMetadata
}

export interface GetObjectAclCommandInput {
  Bucket: string
  Key: string
}

export interface GetObjectAclCommandOutput {
  Owner?: { ID?: string; DisplayName?: string }
  Grants?: Array<{
    Grantee?: {
      Type?: 'CanonicalUser' | 'AmazonCustomerByEmail' | 'Group'
      ID?: string
      DisplayName?: string
      EmailAddress?: string
      URI?: string
    }
    Permission?: string
  }>
  $metadata: ResponseMetadata
}

export interface PutObjectAclCommandInput {
  Bucket: string
  Key: string
  ACL?: CannedACL
  AccessControlPolicy?: AccessControlPolicy
}

export interface PutObjectAclCommandOutput {
  $metadata: ResponseMetadata
}

// Metadata types
export interface ResponseMetadata {
  httpStatusCode?: number
  requestId?: string
  extendedRequestId?: string
  attempts?: number
  totalRetryDelay?: number
}

// ============================================================================
// Command Classes
// ============================================================================

export class CreateBucketCommand {
  constructor(readonly input: CreateBucketCommandInput) {}
}

export class DeleteBucketCommand {
  constructor(readonly input: DeleteBucketCommandInput) {}
}

export class HeadBucketCommand {
  constructor(readonly input: HeadBucketCommandInput) {}
}

export class ListBucketsCommand {
  constructor(readonly input: ListBucketsCommandInput = {}) {}
}

export class PutObjectCommand {
  constructor(readonly input: PutObjectCommandInput) {}
}

export class GetObjectCommand {
  constructor(readonly input: GetObjectCommandInput) {}
}

export class HeadObjectCommand {
  constructor(readonly input: HeadObjectCommandInput) {}
}

export class DeleteObjectCommand {
  constructor(readonly input: DeleteObjectCommandInput) {}
}

export class DeleteObjectsCommand {
  constructor(readonly input: DeleteObjectsCommandInput) {}
}

export class CopyObjectCommand {
  constructor(readonly input: CopyObjectCommandInput) {}
}

export class ListObjectsV2Command {
  constructor(readonly input: ListObjectsV2CommandInput) {}
}

export class CreateMultipartUploadCommand {
  constructor(readonly input: CreateMultipartUploadCommandInput) {}
}

export class UploadPartCommand {
  constructor(readonly input: UploadPartCommandInput) {}
}

export class CompleteMultipartUploadCommand {
  constructor(readonly input: CompleteMultipartUploadCommandInput) {}
}

export class AbortMultipartUploadCommand {
  constructor(readonly input: AbortMultipartUploadCommandInput) {}
}

export class ListPartsCommand {
  constructor(readonly input: ListPartsCommandInput) {}
}

export class ListMultipartUploadsCommand {
  constructor(readonly input: ListMultipartUploadsCommandInput) {}
}

export class GetBucketAclCommand {
  constructor(readonly input: GetBucketAclCommandInput) {}
}

export class PutBucketAclCommand {
  constructor(readonly input: PutBucketAclCommandInput) {}
}

export class GetObjectAclCommand {
  constructor(readonly input: GetObjectAclCommandInput) {}
}

export class PutObjectAclCommand {
  constructor(readonly input: PutObjectAclCommandInput) {}
}

// Command type union
type Command =
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
  | GetBucketAclCommand
  | PutBucketAclCommand
  | GetObjectAclCommand
  | PutObjectAclCommand

// ============================================================================
// S3Client Class
// ============================================================================

export class S3Client {
  private config: S3ClientConfig
  private s3DO: S3DO | null = null

  constructor(config: S3ClientConfig = {}) {
    this.config = {
      region: config.region ?? 'us-east-1',
      ...config,
    }
  }

  /**
   * Attach to a Durable Object instance
   * This is called internally when used within the DO context
   */
  attachDO(s3DO: S3DO): void {
    this.s3DO = s3DO

    // Set signing config if credentials provided
    if (this.config.credentials && this.config.endpoint) {
      s3DO.setSigningConfig({
        accessKeyId: this.config.credentials.accessKeyId,
        secretAccessKey: this.config.credentials.secretAccessKey,
        region: this.config.region ?? 'us-east-1',
        endpoint: this.config.endpoint,
      })
    }
  }

  async send<T>(command: Command): Promise<T> {
    if (!this.s3DO) {
      throw new Error('S3Client not attached to a Durable Object. Call attachDO() first.')
    }

    const metadata: ResponseMetadata = {
      httpStatusCode: 200,
      requestId: crypto.randomUUID(),
    }

    try {
      if (command instanceof CreateBucketCommand) {
        return await this.handleCreateBucket(command.input, metadata) as T
      }
      if (command instanceof DeleteBucketCommand) {
        return await this.handleDeleteBucket(command.input, metadata) as T
      }
      if (command instanceof HeadBucketCommand) {
        return await this.handleHeadBucket(command.input, metadata) as T
      }
      if (command instanceof ListBucketsCommand) {
        return await this.handleListBuckets(metadata) as T
      }
      if (command instanceof PutObjectCommand) {
        return await this.handlePutObject(command.input, metadata) as T
      }
      if (command instanceof GetObjectCommand) {
        return await this.handleGetObject(command.input, metadata) as T
      }
      if (command instanceof HeadObjectCommand) {
        return await this.handleHeadObject(command.input, metadata) as T
      }
      if (command instanceof DeleteObjectCommand) {
        return await this.handleDeleteObject(command.input, metadata) as T
      }
      if (command instanceof DeleteObjectsCommand) {
        return await this.handleDeleteObjects(command.input, metadata) as T
      }
      if (command instanceof CopyObjectCommand) {
        return await this.handleCopyObject(command.input, metadata) as T
      }
      if (command instanceof ListObjectsV2Command) {
        return await this.handleListObjectsV2(command.input, metadata) as T
      }
      if (command instanceof CreateMultipartUploadCommand) {
        return await this.handleCreateMultipartUpload(command.input, metadata) as T
      }
      if (command instanceof UploadPartCommand) {
        return await this.handleUploadPart(command.input, metadata) as T
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        return await this.handleCompleteMultipartUpload(command.input, metadata) as T
      }
      if (command instanceof AbortMultipartUploadCommand) {
        return await this.handleAbortMultipartUpload(command.input, metadata) as T
      }
      if (command instanceof ListPartsCommand) {
        return await this.handleListParts(command.input, metadata) as T
      }
      if (command instanceof ListMultipartUploadsCommand) {
        return await this.handleListMultipartUploads(command.input, metadata) as T
      }
      if (command instanceof GetBucketAclCommand) {
        return await this.handleGetBucketAcl(command.input, metadata) as T
      }
      if (command instanceof PutBucketAclCommand) {
        return await this.handlePutBucketAcl(command.input, metadata) as T
      }
      if (command instanceof GetObjectAclCommand) {
        return await this.handleGetObjectAcl(command.input, metadata) as T
      }
      if (command instanceof PutObjectAclCommand) {
        return await this.handlePutObjectAcl(command.input, metadata) as T
      }

      throw new Error(`Unknown command: ${command.constructor.name}`)
    } catch (error) {
      metadata.httpStatusCode = 500
      throw error
    }
  }

  // ==========================================================================
  // Command Handlers
  // ==========================================================================

  private async handleCreateBucket(
    input: CreateBucketCommandInput,
    metadata: ResponseMetadata
  ): Promise<CreateBucketCommandOutput> {
    const bucket = await this.s3DO!.createBucket(input.Bucket, {
      region: input.CreateBucketConfiguration?.LocationConstraint,
      acl: input.ACL,
    })

    return {
      Location: `/${bucket.name}`,
      $metadata: metadata,
    }
  }

  private async handleDeleteBucket(
    input: DeleteBucketCommandInput,
    metadata: ResponseMetadata
  ): Promise<DeleteBucketCommandOutput> {
    await this.s3DO!.deleteBucket(input.Bucket)
    return { $metadata: metadata }
  }

  private async handleHeadBucket(
    input: HeadBucketCommandInput,
    metadata: ResponseMetadata
  ): Promise<HeadBucketCommandOutput> {
    const bucket = await this.s3DO!.headBucket(input.Bucket)
    return {
      BucketRegion: bucket.region,
      $metadata: metadata,
    }
  }

  private async handleListBuckets(
    metadata: ResponseMetadata
  ): Promise<ListBucketsCommandOutput> {
    const result = await this.s3DO!.listBuckets()
    return {
      Buckets: result.buckets.map(b => ({
        Name: b.name,
        CreationDate: b.creationDate,
      })),
      Owner: {
        ID: result.owner.id,
        DisplayName: result.owner.displayName,
      },
      $metadata: metadata,
    }
  }

  private async handlePutObject(
    input: PutObjectCommandInput,
    metadata: ResponseMetadata
  ): Promise<PutObjectCommandOutput> {
    const result = await this.s3DO!.putObject(input.Bucket, input.Key, input.Body ?? '', {
      contentType: input.ContentType,
      contentEncoding: input.ContentEncoding,
      cacheControl: input.CacheControl,
      contentDisposition: input.ContentDisposition,
      contentLanguage: input.ContentLanguage,
      expires: input.Expires,
      metadata: input.Metadata,
      storageClass: input.StorageClass,
      acl: input.ACL,
      checksumCRC32: input.ChecksumCRC32,
      checksumCRC32C: input.ChecksumCRC32C,
      checksumSHA1: input.ChecksumSHA1,
      checksumSHA256: input.ChecksumSHA256,
    })

    return {
      ETag: result.etag,
      ChecksumCRC32: result.checksumCRC32,
      ChecksumCRC32C: result.checksumCRC32C,
      ChecksumSHA1: result.checksumSHA1,
      ChecksumSHA256: result.checksumSHA256,
      $metadata: metadata,
    }
  }

  private async handleGetObject(
    input: GetObjectCommandInput,
    metadata: ResponseMetadata
  ): Promise<GetObjectCommandOutput> {
    const range = input.Range ? this.parseRange(input.Range) : undefined

    const result = await this.s3DO!.getObject(input.Bucket, input.Key, {
      range,
      ifMatch: input.IfMatch,
      ifNoneMatch: input.IfNoneMatch,
      ifModifiedSince: input.IfModifiedSince,
      ifUnmodifiedSince: input.IfUnmodifiedSince,
      versionId: input.VersionId,
    })

    if (result.contentRange) {
      metadata.httpStatusCode = 206
    }

    return {
      Body: result.body,
      ContentLength: result.contentLength,
      ContentType: result.metadata.contentType,
      ContentEncoding: result.metadata.contentEncoding,
      CacheControl: result.metadata.cacheControl,
      ContentDisposition: result.metadata.contentDisposition,
      ContentLanguage: result.metadata.contentLanguage,
      ContentRange: result.contentRange,
      ETag: result.metadata.etag,
      LastModified: result.metadata.lastModified,
      Metadata: result.metadata.metadata,
      $metadata: metadata,
    }
  }

  private async handleHeadObject(
    input: HeadObjectCommandInput,
    metadata: ResponseMetadata
  ): Promise<HeadObjectCommandOutput> {
    const result = await this.s3DO!.headObject(input.Bucket, input.Key, {
      versionId: input.VersionId,
      ifMatch: input.IfMatch,
      ifNoneMatch: input.IfNoneMatch,
      ifModifiedSince: input.IfModifiedSince,
      ifUnmodifiedSince: input.IfUnmodifiedSince,
    })

    return {
      ContentLength: result.size,
      ContentType: result.contentType,
      ContentEncoding: result.contentEncoding,
      CacheControl: result.cacheControl,
      ContentDisposition: result.contentDisposition,
      ContentLanguage: result.contentLanguage,
      ETag: result.etag,
      LastModified: result.lastModified,
      Metadata: result.metadata,
      StorageClass: result.storageClass,
      $metadata: metadata,
    }
  }

  private async handleDeleteObject(
    input: DeleteObjectCommandInput,
    metadata: ResponseMetadata
  ): Promise<DeleteObjectCommandOutput> {
    const result = await this.s3DO!.deleteObject(input.Bucket, input.Key, {
      versionId: input.VersionId,
    })

    return {
      DeleteMarker: result.deleteMarker,
      VersionId: result.versionId,
      $metadata: metadata,
    }
  }

  private async handleDeleteObjects(
    input: DeleteObjectsCommandInput,
    metadata: ResponseMetadata
  ): Promise<DeleteObjectsCommandOutput> {
    const keys = input.Delete.Objects.map(o => ({
      key: o.Key,
      versionId: o.VersionId,
    }))

    const result = await this.s3DO!.deleteObjects(input.Bucket, keys)

    return {
      Deleted: result.deleted.map(d => ({
        Key: d.key,
        VersionId: d.versionId,
        DeleteMarker: d.deleteMarker,
      })),
      Errors: result.errors.map(e => ({
        Key: e.key,
        Code: e.code,
        Message: e.message,
      })),
      $metadata: metadata,
    }
  }

  private async handleCopyObject(
    input: CopyObjectCommandInput,
    metadata: ResponseMetadata
  ): Promise<CopyObjectCommandOutput> {
    // Parse CopySource (format: /bucket/key or bucket/key)
    const copySource = input.CopySource.startsWith('/')
      ? input.CopySource.slice(1)
      : input.CopySource

    const [sourceBucket, ...keyParts] = copySource.split('/')
    const sourceKey = keyParts.join('/')

    const result = await this.s3DO!.copyObject({
      sourceBucket,
      sourceKey,
      destinationBucket: input.Bucket,
      destinationKey: input.Key,
      copySourceIfMatch: input.CopySourceIfMatch,
      copySourceIfNoneMatch: input.CopySourceIfNoneMatch,
      copySourceIfModifiedSince: input.CopySourceIfModifiedSince,
      copySourceIfUnmodifiedSince: input.CopySourceIfUnmodifiedSince,
      metadataDirective: input.MetadataDirective,
      metadata: input.Metadata,
      contentType: input.ContentType,
      cacheControl: input.CacheControl,
      contentDisposition: input.ContentDisposition,
      contentEncoding: input.ContentEncoding,
      contentLanguage: input.ContentLanguage,
      expires: input.Expires,
      storageClass: input.StorageClass,
      acl: input.ACL,
    })

    return {
      CopyObjectResult: {
        ETag: result.etag,
        LastModified: result.lastModified,
      },
      VersionId: result.versionId,
      CopySourceVersionId: result.sourceVersionId,
      $metadata: metadata,
    }
  }

  private async handleListObjectsV2(
    input: ListObjectsV2CommandInput,
    metadata: ResponseMetadata
  ): Promise<ListObjectsV2CommandOutput> {
    const result = await this.s3DO!.listObjectsV2({
      bucket: input.Bucket,
      prefix: input.Prefix,
      delimiter: input.Delimiter,
      maxKeys: input.MaxKeys,
      continuationToken: input.ContinuationToken,
      startAfter: input.StartAfter,
      fetchOwner: input.FetchOwner,
      encodingType: input.EncodingType,
    })

    return {
      Name: result.name,
      Prefix: result.prefix,
      Delimiter: result.delimiter,
      MaxKeys: result.maxKeys,
      IsTruncated: result.isTruncated,
      Contents: result.contents.map(o => ({
        Key: o.key,
        Size: o.size,
        ETag: o.etag,
        LastModified: o.lastModified,
        StorageClass: o.storageClass,
      })),
      CommonPrefixes: result.commonPrefixes.map(p => ({ Prefix: p.prefix })),
      ContinuationToken: result.continuationToken,
      NextContinuationToken: result.nextContinuationToken,
      StartAfter: result.startAfter,
      KeyCount: result.keyCount,
      EncodingType: result.encodingType,
      $metadata: metadata,
    }
  }

  private async handleCreateMultipartUpload(
    input: CreateMultipartUploadCommandInput,
    metadata: ResponseMetadata
  ): Promise<CreateMultipartUploadCommandOutput> {
    const result = await this.s3DO!.createMultipartUpload(input.Bucket, input.Key, {
      contentType: input.ContentType,
      metadata: input.Metadata,
      storageClass: input.StorageClass,
    })

    return {
      Bucket: result.bucket,
      Key: result.key,
      UploadId: result.uploadId,
      $metadata: metadata,
    }
  }

  private async handleUploadPart(
    input: UploadPartCommandInput,
    metadata: ResponseMetadata
  ): Promise<UploadPartCommandOutput> {
    const result = await this.s3DO!.uploadPart(
      input.Bucket,
      input.Key,
      input.UploadId,
      input.PartNumber,
      input.Body ?? new ArrayBuffer(0),
      { contentMD5: input.ContentMD5 }
    )

    return {
      ETag: result.etag,
      ChecksumCRC32: result.checksumCRC32,
      ChecksumCRC32C: result.checksumCRC32C,
      ChecksumSHA1: result.checksumSHA1,
      ChecksumSHA256: result.checksumSHA256,
      $metadata: metadata,
    }
  }

  private async handleCompleteMultipartUpload(
    input: CompleteMultipartUploadCommandInput,
    metadata: ResponseMetadata
  ): Promise<CompleteMultipartUploadCommandOutput> {
    const parts = input.MultipartUpload?.Parts?.map(p => ({
      partNumber: p.PartNumber!,
      etag: p.ETag!,
    })) ?? []

    const result = await this.s3DO!.completeMultipartUpload(
      input.Bucket,
      input.Key,
      input.UploadId,
      parts
    )

    return {
      Location: result.location,
      Bucket: result.bucket,
      Key: result.key,
      ETag: result.etag,
      VersionId: result.versionId,
      $metadata: metadata,
    }
  }

  private async handleAbortMultipartUpload(
    input: AbortMultipartUploadCommandInput,
    metadata: ResponseMetadata
  ): Promise<AbortMultipartUploadCommandOutput> {
    await this.s3DO!.abortMultipartUpload(input.Bucket, input.Key, input.UploadId)
    return { $metadata: metadata }
  }

  private async handleListParts(
    input: ListPartsCommandInput,
    metadata: ResponseMetadata
  ): Promise<ListPartsCommandOutput> {
    const result = await this.s3DO!.listParts({
      bucket: input.Bucket,
      key: input.Key,
      uploadId: input.UploadId,
      maxParts: input.MaxParts,
      partNumberMarker: input.PartNumberMarker,
    })

    return {
      Bucket: result.bucket,
      Key: result.key,
      UploadId: result.uploadId,
      PartNumberMarker: result.partNumberMarker,
      NextPartNumberMarker: result.nextPartNumberMarker,
      MaxParts: result.maxParts,
      IsTruncated: result.isTruncated,
      Parts: result.parts.map(p => ({
        PartNumber: p.partNumber,
        ETag: p.etag,
        Size: p.size,
        LastModified: p.lastModified,
      })),
      $metadata: metadata,
    }
  }

  private async handleListMultipartUploads(
    input: ListMultipartUploadsCommandInput,
    metadata: ResponseMetadata
  ): Promise<ListMultipartUploadsCommandOutput> {
    const result = await this.s3DO!.listMultipartUploads({
      bucket: input.Bucket,
      prefix: input.Prefix,
      delimiter: input.Delimiter,
      maxUploads: input.MaxUploads,
      keyMarker: input.KeyMarker,
      uploadIdMarker: input.UploadIdMarker,
    })

    return {
      Bucket: result.bucket,
      KeyMarker: result.keyMarker,
      UploadIdMarker: result.uploadIdMarker,
      NextKeyMarker: result.nextKeyMarker,
      NextUploadIdMarker: result.nextUploadIdMarker,
      MaxUploads: result.maxUploads,
      IsTruncated: result.isTruncated,
      Uploads: result.uploads.map(u => ({
        Key: u.key,
        UploadId: u.uploadId,
        Initiated: u.initiated,
        StorageClass: u.storageClass,
      })),
      CommonPrefixes: result.commonPrefixes.map(p => ({ Prefix: p.prefix })),
      $metadata: metadata,
    }
  }

  private async handleGetBucketAcl(
    input: GetBucketAclCommandInput,
    metadata: ResponseMetadata
  ): Promise<GetBucketAclCommandOutput> {
    const acl = await this.s3DO!.getBucketAcl(input.Bucket)

    return {
      Owner: {
        ID: acl.owner.id,
        DisplayName: acl.owner.displayName,
      },
      Grants: acl.grants.map(g => ({
        Grantee: {
          Type: g.grantee.type,
          ID: g.grantee.id,
          DisplayName: g.grantee.displayName,
          EmailAddress: g.grantee.emailAddress,
          URI: g.grantee.uri,
        },
        Permission: g.permission,
      })),
      $metadata: metadata,
    }
  }

  private async handlePutBucketAcl(
    input: PutBucketAclCommandInput,
    metadata: ResponseMetadata
  ): Promise<PutBucketAclCommandOutput> {
    await this.s3DO!.putBucketAcl(input.Bucket, input.ACL ?? input.AccessControlPolicy!)
    return { $metadata: metadata }
  }

  private async handleGetObjectAcl(
    input: GetObjectAclCommandInput,
    metadata: ResponseMetadata
  ): Promise<GetObjectAclCommandOutput> {
    const acl = await this.s3DO!.getObjectAcl(input.Bucket, input.Key)

    return {
      Owner: {
        ID: acl.owner.id,
        DisplayName: acl.owner.displayName,
      },
      Grants: acl.grants.map(g => ({
        Grantee: {
          Type: g.grantee.type,
          ID: g.grantee.id,
          DisplayName: g.grantee.displayName,
          EmailAddress: g.grantee.emailAddress,
          URI: g.grantee.uri,
        },
        Permission: g.permission,
      })),
      $metadata: metadata,
    }
  }

  private async handlePutObjectAcl(
    input: PutObjectAclCommandInput,
    metadata: ResponseMetadata
  ): Promise<PutObjectAclCommandOutput> {
    await this.s3DO!.putObjectAcl(input.Bucket, input.Key, input.ACL ?? input.AccessControlPolicy!)
    return { $metadata: metadata }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private parseRange(range: string): { start: number; end: number } | undefined {
    const match = range.match(/^bytes=(\d+)-(\d*)$/)
    if (!match) return undefined

    const start = parseInt(match[1])
    const end = match[2] ? parseInt(match[2]) : Infinity

    return { start, end }
  }

  destroy(): void {
    this.s3DO = null
  }
}

// ============================================================================
// Pre-signed URL Utility
// ============================================================================

export async function getSignedUrl(
  client: S3Client,
  command: GetObjectCommand | PutObjectCommand,
  options: { expiresIn?: number } = {}
): Promise<string> {
  // This would need access to the S3DO to generate the URL
  // For now, throw an error indicating this needs special handling
  throw new Error('getSignedUrl requires direct access to S3DO. Use s3DO.getSignedUrl() instead.')
}
