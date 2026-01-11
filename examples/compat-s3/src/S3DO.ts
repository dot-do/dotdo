/**
 * S3DO - Main S3 API coordinator Durable Object
 *
 * Implements full S3 API operations:
 * - Objects: GetObject, PutObject, DeleteObject, CopyObject, HeadObject
 * - Multipart: CreateMultipartUpload, UploadPart, CompleteMultipartUpload, AbortMultipartUpload
 * - Buckets: CreateBucket, DeleteBucket, ListBuckets, HeadBucket
 * - Listing: ListObjectsV2 with prefix, delimiter, continuation tokens
 * - Metadata: Custom metadata, content-type, cache-control
 * - Pre-signed URLs: getSignedUrl for temporary access
 * - ACLs: GetBucketAcl, PutBucketAcl, GetObjectAcl, PutObjectAcl
 */

import { DO } from 'dotdo'
import type {
  S3Object,
  Bucket,
  BucketOwner,
  AccessControlPolicy,
  CannedACL,
  CopyObjectRequest,
  CopyObjectResult,
  ListObjectsV2Request,
  ListObjectsV2Response,
  ListMultipartUploadsRequest,
  ListMultipartUploadsResponse,
  ListPartsRequest,
  ListPartsResponse,
  MultipartUpload,
  MultipartUploadResult,
  Part,
  CompletedPart,
  PresignedUrlOptions,
  PresignedPostOptions,
  PresignedPost,
  StorageClass,
  Env,
} from './types'
import { S3Errors, S3Error } from './types'
import { MultipartUploadManager } from './multipart'
import {
  getSignedUrl,
  createPresignedPost,
  verifySignature,
  generateETag,
  type SigningConfig,
} from './signing'
import type { BucketDO } from './BucketDO'

// ============================================================================
// Types
// ============================================================================

interface PutObjectOptions {
  contentType?: string
  contentEncoding?: string
  cacheControl?: string
  contentDisposition?: string
  contentLanguage?: string
  expires?: Date
  metadata?: Record<string, string>
  storageClass?: StorageClass
  acl?: CannedACL
  checksumCRC32?: string
  checksumCRC32C?: string
  checksumSHA1?: string
  checksumSHA256?: string
}

interface GetObjectOptions {
  range?: { start: number; end: number }
  ifMatch?: string
  ifNoneMatch?: string
  ifModifiedSince?: Date
  ifUnmodifiedSince?: Date
  versionId?: string
}

interface DeleteObjectOptions {
  versionId?: string
}

interface HeadObjectOptions {
  versionId?: string
  ifMatch?: string
  ifNoneMatch?: string
  ifModifiedSince?: Date
  ifUnmodifiedSince?: Date
}

// ============================================================================
// S3DO Class
// ============================================================================

export class S3DO extends DO {
  static readonly $type = 'S3DO'

  private r2!: R2Bucket
  private bucketDONamespace!: DurableObjectNamespace
  private multipartManager!: MultipartUploadManager
  private buckets: Map<string, string> = new Map() // bucket name -> DO id
  private owner: BucketOwner
  private signingConfig: SigningConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.r2 = env.R2_STORAGE
    this.bucketDONamespace = env.BUCKET_DO

    // Initialize owner
    this.owner = {
      id: crypto.randomUUID(),
      displayName: 'default-owner',
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async onStart() {
    // Load bucket registry
    const storedBuckets = await this.ctx.storage.get<Array<[string, string]>>('buckets')
    if (storedBuckets) {
      this.buckets = new Map(storedBuckets)
    }

    // Load owner
    const storedOwner = await this.ctx.storage.get<BucketOwner>('owner')
    if (storedOwner) {
      this.owner = storedOwner
    } else {
      await this.ctx.storage.put('owner', this.owner)
    }

    // Load multipart state
    const multipartState = await this.ctx.storage.get<string>('multipart')
    if (multipartState) {
      this.multipartManager = MultipartUploadManager.deserialize(this.r2, multipartState)
    } else {
      this.multipartManager = new MultipartUploadManager(this.r2)
    }

    // Initialize signing config from env
    const env = this.env as Env
    if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
      this.signingConfig = {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        region: 'auto',
        endpoint: 'https://s3.example.com', // Would be set dynamically
      }
    }
  }

  private async saveBuckets() {
    await this.ctx.storage.put('buckets', Array.from(this.buckets.entries()))
  }

  private async saveMultipartState() {
    await this.ctx.storage.put('multipart', this.multipartManager.serialize())
  }

  private getBucketDO(bucketName: string): DurableObjectStub {
    const doId = this.buckets.get(bucketName)
    if (!doId) {
      throw S3Errors.NoSuchBucket(bucketName)
    }
    return this.bucketDONamespace.get(this.bucketDONamespace.idFromString(doId))
  }

  // ==========================================================================
  // Bucket Operations
  // ==========================================================================

  async createBucket(
    name: string,
    options: { region?: string; acl?: CannedACL } = {}
  ): Promise<Bucket> {
    if (this.buckets.has(name)) {
      throw S3Errors.BucketAlreadyExists(name)
    }

    // Create new BucketDO
    const doId = this.bucketDONamespace.newUniqueId()
    const stub = this.bucketDONamespace.get(doId) as unknown as BucketDO

    const bucket = await stub.createBucket(name, {
      region: options.region,
      owner: this.owner,
      acl: options.acl,
    })

    // Register bucket
    this.buckets.set(name, doId.toString())
    await this.saveBuckets()

    return bucket
  }

  async deleteBucket(name: string): Promise<void> {
    const stub = this.getBucketDO(name) as unknown as BucketDO
    await stub.deleteBucket()

    this.buckets.delete(name)
    await this.saveBuckets()
  }

  async headBucket(name: string): Promise<Bucket> {
    const stub = this.getBucketDO(name) as unknown as BucketDO
    return stub.headBucket()
  }

  async listBuckets(): Promise<{ owner: BucketOwner; buckets: Bucket[] }> {
    const buckets: Bucket[] = []

    for (const [name] of this.buckets) {
      try {
        const stub = this.getBucketDO(name) as unknown as BucketDO
        const bucket = await stub.headBucket()
        buckets.push(bucket)
      } catch {
        // Skip inaccessible buckets
      }
    }

    return {
      owner: this.owner,
      buckets: buckets.sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  // ==========================================================================
  // Object Operations
  // ==========================================================================

  async putObject(
    bucket: string,
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string,
    options: PutObjectOptions = {}
  ): Promise<S3Object> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO

    // Normalize body
    let bodyToStore: ReadableStream<Uint8Array> | ArrayBuffer
    if (typeof body === 'string') {
      bodyToStore = new TextEncoder().encode(body).buffer as ArrayBuffer
    } else if (body instanceof Uint8Array) {
      bodyToStore = body.buffer as ArrayBuffer
    } else {
      bodyToStore = body
    }

    // Store in R2
    const objectKey = `${bucket}/${key}`
    const r2Object = await this.r2.put(objectKey, bodyToStore, {
      httpMetadata: {
        contentType: options.contentType,
        contentEncoding: options.contentEncoding,
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentLanguage: options.contentLanguage,
      },
      customMetadata: options.metadata,
    })

    const s3Object: S3Object = {
      key,
      size: r2Object.size,
      etag: r2Object.etag,
      lastModified: r2Object.uploaded,
      contentType: options.contentType,
      contentEncoding: options.contentEncoding,
      cacheControl: options.cacheControl,
      contentDisposition: options.contentDisposition,
      contentLanguage: options.contentLanguage,
      expires: options.expires,
      metadata: options.metadata,
      storageClass: options.storageClass ?? 'STANDARD',
      checksumCRC32: options.checksumCRC32,
      checksumCRC32C: options.checksumCRC32C,
      checksumSHA1: options.checksumSHA1,
      checksumSHA256: options.checksumSHA256,
    }

    // Update bucket index
    await bucketDO.indexObject({ ...s3Object, owner: this.owner })

    // Set ACL if provided
    if (options.acl) {
      await bucketDO.putObjectAcl(key, options.acl)
    }

    return s3Object
  }

  async getObject(
    bucket: string,
    key: string,
    options: GetObjectOptions = {}
  ): Promise<{
    body: ReadableStream<Uint8Array>
    metadata: S3Object
    contentLength: number
    contentRange?: string
  }> {
    // Verify bucket exists
    this.getBucketDO(bucket)

    const objectKey = `${bucket}/${key}`

    // Check conditional headers
    const headResult = await this.r2.head(objectKey)
    if (!headResult) {
      throw S3Errors.NoSuchKey(key)
    }

    // Conditional request checks
    if (options.ifMatch && headResult.etag !== options.ifMatch) {
      throw S3Errors.PreconditionFailed()
    }
    if (options.ifNoneMatch && headResult.etag === options.ifNoneMatch) {
      throw S3Errors.NotModified()
    }
    if (options.ifModifiedSince && headResult.uploaded <= options.ifModifiedSince) {
      throw S3Errors.NotModified()
    }
    if (options.ifUnmodifiedSince && headResult.uploaded > options.ifUnmodifiedSince) {
      throw S3Errors.PreconditionFailed()
    }

    // Get object (with optional range)
    const r2Object = await this.r2.get(objectKey, {
      range: options.range
        ? { offset: options.range.start, length: options.range.end - options.range.start + 1 }
        : undefined,
    })

    if (!r2Object) {
      throw S3Errors.NoSuchKey(key)
    }

    const metadata: S3Object = {
      key,
      size: headResult.size,
      etag: r2Object.etag,
      lastModified: r2Object.uploaded,
      contentType: r2Object.httpMetadata?.contentType,
      contentEncoding: r2Object.httpMetadata?.contentEncoding,
      cacheControl: r2Object.httpMetadata?.cacheControl,
      contentDisposition: r2Object.httpMetadata?.contentDisposition,
      contentLanguage: r2Object.httpMetadata?.contentLanguage,
      metadata: r2Object.customMetadata,
    }

    let contentLength = r2Object.size
    let contentRange: string | undefined

    if (options.range) {
      const start = options.range.start
      const end = Math.min(options.range.end, headResult.size - 1)
      contentLength = end - start + 1
      contentRange = `bytes ${start}-${end}/${headResult.size}`
    }

    return {
      body: r2Object.body,
      metadata,
      contentLength,
      contentRange,
    }
  }

  async headObject(
    bucket: string,
    key: string,
    options: HeadObjectOptions = {}
  ): Promise<S3Object> {
    // Verify bucket exists
    this.getBucketDO(bucket)

    const objectKey = `${bucket}/${key}`
    const r2Object = await this.r2.head(objectKey)

    if (!r2Object) {
      throw S3Errors.NoSuchKey(key)
    }

    // Conditional request checks
    if (options.ifMatch && r2Object.etag !== options.ifMatch) {
      throw S3Errors.PreconditionFailed()
    }
    if (options.ifNoneMatch && r2Object.etag === options.ifNoneMatch) {
      throw S3Errors.NotModified()
    }
    if (options.ifModifiedSince && r2Object.uploaded <= options.ifModifiedSince) {
      throw S3Errors.NotModified()
    }
    if (options.ifUnmodifiedSince && r2Object.uploaded > options.ifUnmodifiedSince) {
      throw S3Errors.PreconditionFailed()
    }

    return {
      key,
      size: r2Object.size,
      etag: r2Object.etag,
      lastModified: r2Object.uploaded,
      contentType: r2Object.httpMetadata?.contentType,
      contentEncoding: r2Object.httpMetadata?.contentEncoding,
      cacheControl: r2Object.httpMetadata?.cacheControl,
      contentDisposition: r2Object.httpMetadata?.contentDisposition,
      contentLanguage: r2Object.httpMetadata?.contentLanguage,
      metadata: r2Object.customMetadata,
    }
  }

  async deleteObject(
    bucket: string,
    key: string,
    _options: DeleteObjectOptions = {}
  ): Promise<{ deleteMarker?: boolean; versionId?: string }> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO

    const objectKey = `${bucket}/${key}`
    await this.r2.delete(objectKey)
    await bucketDO.removeFromIndex(key)

    return {}
  }

  async deleteObjects(
    bucket: string,
    keys: Array<{ key: string; versionId?: string }>
  ): Promise<{
    deleted: Array<{ key: string; versionId?: string; deleteMarker?: boolean }>
    errors: Array<{ key: string; code: string; message: string }>
  }> {
    const deleted: Array<{ key: string; versionId?: string; deleteMarker?: boolean }> = []
    const errors: Array<{ key: string; code: string; message: string }> = []

    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO

    for (const { key, versionId } of keys) {
      try {
        const objectKey = `${bucket}/${key}`
        await this.r2.delete(objectKey)
        await bucketDO.removeFromIndex(key)
        deleted.push({ key, versionId })
      } catch (error) {
        const s3Error = error instanceof S3Error ? error : S3Errors.NoSuchKey(key)
        errors.push({
          key,
          code: s3Error.code,
          message: s3Error.message,
        })
      }
    }

    return { deleted, errors }
  }

  async copyObject(request: CopyObjectRequest): Promise<CopyObjectResult> {
    const sourceBucketDO = this.getBucketDO(request.sourceBucket)
    const destBucketDO = this.getBucketDO(request.destinationBucket) as unknown as BucketDO

    // Get source object
    const sourceKey = `${request.sourceBucket}/${request.sourceKey}`
    const sourceObject = await this.r2.get(sourceKey)

    if (!sourceObject) {
      throw S3Errors.NoSuchKey(request.sourceKey)
    }

    // Check conditional copy headers
    if (request.copySourceIfMatch && sourceObject.etag !== request.copySourceIfMatch) {
      throw S3Errors.PreconditionFailed()
    }
    if (request.copySourceIfNoneMatch && sourceObject.etag === request.copySourceIfNoneMatch) {
      throw S3Errors.PreconditionFailed()
    }
    if (request.copySourceIfModifiedSince && sourceObject.uploaded <= request.copySourceIfModifiedSince) {
      throw S3Errors.PreconditionFailed()
    }
    if (request.copySourceIfUnmodifiedSince && sourceObject.uploaded > request.copySourceIfUnmodifiedSince) {
      throw S3Errors.PreconditionFailed()
    }

    // Determine metadata
    let metadata = sourceObject.customMetadata
    let contentType = sourceObject.httpMetadata?.contentType

    if (request.metadataDirective === 'REPLACE') {
      metadata = request.metadata
      contentType = request.contentType ?? contentType
    }

    // Copy to destination
    const destKey = `${request.destinationBucket}/${request.destinationKey}`
    const destObject = await this.r2.put(destKey, sourceObject.body, {
      httpMetadata: {
        contentType: request.contentType ?? sourceObject.httpMetadata?.contentType,
        contentEncoding: request.contentEncoding ?? sourceObject.httpMetadata?.contentEncoding,
        cacheControl: request.cacheControl ?? sourceObject.httpMetadata?.cacheControl,
        contentDisposition: request.contentDisposition ?? sourceObject.httpMetadata?.contentDisposition,
        contentLanguage: request.contentLanguage ?? sourceObject.httpMetadata?.contentLanguage,
      },
      customMetadata: metadata,
    })

    // Update destination bucket index
    const s3Object: S3Object = {
      key: request.destinationKey,
      size: destObject.size,
      etag: destObject.etag,
      lastModified: destObject.uploaded,
      contentType,
      metadata,
      storageClass: request.storageClass ?? 'STANDARD',
    }

    await destBucketDO.indexObject({ ...s3Object, owner: this.owner })

    return {
      etag: destObject.etag,
      lastModified: destObject.uploaded,
    }
  }

  // ==========================================================================
  // List Operations
  // ==========================================================================

  async listObjectsV2(request: ListObjectsV2Request): Promise<ListObjectsV2Response> {
    const bucketDO = this.getBucketDO(request.bucket) as unknown as BucketDO
    return bucketDO.listObjectsV2(request)
  }

  // ==========================================================================
  // ACL Operations
  // ==========================================================================

  async getBucketAcl(bucket: string): Promise<AccessControlPolicy> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO
    return bucketDO.getBucketAcl()
  }

  async putBucketAcl(bucket: string, acl: AccessControlPolicy | CannedACL): Promise<void> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO
    await bucketDO.putBucketAcl(acl)
  }

  async getObjectAcl(bucket: string, key: string): Promise<AccessControlPolicy> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO
    return bucketDO.getObjectAcl(key)
  }

  async putObjectAcl(bucket: string, key: string, acl: AccessControlPolicy | CannedACL): Promise<void> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO
    await bucketDO.putObjectAcl(key, acl)
  }

  // ==========================================================================
  // Multipart Upload Operations
  // ==========================================================================

  async createMultipartUpload(
    bucket: string,
    key: string,
    options: {
      storageClass?: StorageClass
      metadata?: Record<string, string>
      contentType?: string
    } = {}
  ): Promise<MultipartUpload> {
    // Verify bucket exists
    this.getBucketDO(bucket)

    const upload = await this.multipartManager.createMultipartUpload(bucket, key, {
      ...options,
      owner: this.owner,
    })

    await this.saveMultipartState()
    return upload
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
    options: {
      contentMD5?: string
    } = {}
  ): Promise<Part> {
    // Verify bucket exists
    this.getBucketDO(bucket)

    const part = await this.multipartManager.uploadPart(uploadId, partNumber, body, options)
    await this.saveMultipartState()
    return part
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<MultipartUploadResult> {
    const bucketDO = this.getBucketDO(bucket) as unknown as BucketDO

    const result = await this.multipartManager.completeMultipartUpload(uploadId, parts)

    // Get final object metadata
    const objectKey = `${bucket}/${key}`
    const r2Object = await this.r2.head(objectKey)

    if (r2Object) {
      const s3Object: S3Object = {
        key,
        size: r2Object.size,
        etag: result.etag,
        lastModified: r2Object.uploaded,
        metadata: r2Object.customMetadata,
      }
      await bucketDO.indexObject({ ...s3Object, owner: this.owner })
    }

    await this.saveMultipartState()
    return result
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string
  ): Promise<void> {
    // Verify bucket exists
    this.getBucketDO(bucket)

    await this.multipartManager.abortMultipartUpload(uploadId)
    await this.saveMultipartState()
  }

  async listParts(request: ListPartsRequest): Promise<ListPartsResponse> {
    // Verify bucket exists
    this.getBucketDO(request.bucket)

    return this.multipartManager.listParts(request)
  }

  async listMultipartUploads(request: ListMultipartUploadsRequest): Promise<ListMultipartUploadsResponse> {
    // Verify bucket exists
    this.getBucketDO(request.bucket)

    const result = this.multipartManager.listMultipartUploads(request.bucket, {
      prefix: request.prefix,
      delimiter: request.delimiter,
      maxUploads: request.maxUploads,
      keyMarker: request.keyMarker,
      uploadIdMarker: request.uploadIdMarker,
    })

    return {
      bucket: request.bucket,
      keyMarker: request.keyMarker,
      uploadIdMarker: request.uploadIdMarker,
      nextKeyMarker: result.nextKeyMarker,
      nextUploadIdMarker: result.nextUploadIdMarker,
      maxUploads: request.maxUploads ?? 1000,
      isTruncated: result.isTruncated,
      uploads: result.uploads,
      commonPrefixes: result.commonPrefixes,
      encodingType: request.encodingType,
    }
  }

  async uploadPartCopy(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    sourceBucket: string,
    sourceKey: string,
    options: {
      sourceRange?: { start: number; end: number }
    } = {}
  ): Promise<Part> {
    // Verify buckets exist
    this.getBucketDO(bucket)
    this.getBucketDO(sourceBucket)

    const part = await this.multipartManager.uploadPartCopy(
      uploadId,
      partNumber,
      sourceBucket,
      sourceKey,
      options
    )

    await this.saveMultipartState()
    return part
  }

  // ==========================================================================
  // Pre-signed URL Operations
  // ==========================================================================

  async getSignedUrl(
    bucket: string,
    key: string,
    options: PresignedUrlOptions = {}
  ): Promise<string> {
    if (!this.signingConfig) {
      throw new Error('Signing configuration not available')
    }

    // Verify bucket and key exist for GET requests
    if (options.method !== 'PUT') {
      this.getBucketDO(bucket)
    }

    return getSignedUrl(this.signingConfig, bucket, key, options)
  }

  async createPresignedPost(
    bucket: string,
    options: PresignedPostOptions = {}
  ): Promise<PresignedPost> {
    if (!this.signingConfig) {
      throw new Error('Signing configuration not available')
    }

    // Verify bucket exists
    this.getBucketDO(bucket)

    return createPresignedPost(this.signingConfig, bucket, options)
  }

  setSigningConfig(config: SigningConfig): void {
    this.signingConfig = config
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  async verifyRequest(request: Request): Promise<{ valid: boolean; error?: string }> {
    if (!this.signingConfig) {
      return { valid: false, error: 'Signing configuration not available' }
    }

    return verifySignature(this.signingConfig, request)
  }

  getOwner(): BucketOwner {
    return this.owner
  }

  async setOwner(owner: BucketOwner): Promise<void> {
    this.owner = owner
    await this.ctx.storage.put('owner', owner)
  }

  // ==========================================================================
  // HTTP Handler for Router Communication
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Route to appropriate handler based on path
      switch (path) {
        case '/listBuckets':
          return this.handleListBuckets()

        case '/createBucket':
          return this.handleCreateBucket(await request.json())

        case '/deleteBucket':
          return this.handleDeleteBucket(await request.json())

        case '/headBucket':
          return this.handleHeadBucket(await request.json())

        case '/listObjectsV2':
          return this.handleListObjectsV2(await request.json())

        case '/getObject':
          return this.handleGetObject(await request.json())

        case '/putObject':
          return this.handlePutObject(await request.json())

        case '/deleteObject':
          return this.handleDeleteObject(await request.json())

        case '/deleteObjects':
          return this.handleDeleteObjects(await request.json())

        case '/headObject':
          return this.handleHeadObject(await request.json())

        case '/copyObject':
          return this.handleCopyObject(await request.json())

        case '/createMultipartUpload':
          return this.handleCreateMultipartUpload(await request.json())

        case '/uploadPart':
          return this.handleUploadPart(await request.json())

        case '/completeMultipartUpload':
          return this.handleCompleteMultipartUpload(await request.json())

        case '/abortMultipartUpload':
          return this.handleAbortMultipartUpload(await request.json())

        case '/listParts':
          return this.handleListParts(await request.json())

        case '/listMultipartUploads':
          return this.handleListMultipartUploads(await request.json())

        case '/getBucketAcl':
          return this.handleGetBucketAcl(await request.json())

        case '/putBucketAcl':
          return this.handlePutBucketAcl(await request.json())

        case '/getObjectAcl':
          return this.handleGetObjectAcl(await request.json())

        case '/putObjectAcl':
          return this.handlePutObjectAcl(await request.json())

        case '/health':
          return Response.json({ status: 'ok', type: 'S3DO' })

        default:
          return new Response('Not Found', { status: 404 })
      }
    } catch (error) {
      if (error instanceof S3Error) {
        return Response.json(
          { code: error.code, message: error.message },
          { status: error.statusCode }
        )
      }
      console.error('S3DO error:', error)
      return Response.json(
        { code: 'InternalError', message: 'An internal error occurred' },
        { status: 500 }
      )
    }
  }

  // ==========================================================================
  // HTTP Request Handlers
  // ==========================================================================

  private async handleListBuckets(): Promise<Response> {
    const result = await this.listBuckets()
    return Response.json(result)
  }

  private async handleCreateBucket(params: {
    name: string
    region?: string
    acl?: CannedACL
  }): Promise<Response> {
    const bucket = await this.createBucket(params.name, {
      region: params.region,
      acl: params.acl,
    })
    return Response.json(bucket)
  }

  private async handleDeleteBucket(params: { name: string }): Promise<Response> {
    await this.deleteBucket(params.name)
    return Response.json({ success: true })
  }

  private async handleHeadBucket(params: { name: string }): Promise<Response> {
    const bucket = await this.headBucket(params.name)
    return Response.json(bucket)
  }

  private async handleListObjectsV2(params: ListObjectsV2Request): Promise<Response> {
    const result = await this.listObjectsV2(params)
    return Response.json(result)
  }

  private async handleGetObject(params: {
    bucket: string
    key: string
    range?: { start: number; end: number }
    ifMatch?: string
    ifNoneMatch?: string
    ifModifiedSince?: string
    ifUnmodifiedSince?: string
    versionId?: string
  }): Promise<Response> {
    const result = await this.getObject(params.bucket, params.key, {
      range: params.range,
      ifMatch: params.ifMatch,
      ifNoneMatch: params.ifNoneMatch,
      ifModifiedSince: params.ifModifiedSince ? new Date(params.ifModifiedSince) : undefined,
      ifUnmodifiedSince: params.ifUnmodifiedSince ? new Date(params.ifUnmodifiedSince) : undefined,
      versionId: params.versionId,
    })

    // Read the stream and encode as base64 for JSON transport
    const reader = result.body.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    const bodyBase64 = btoa(String.fromCharCode(...combined))

    return Response.json({
      body: bodyBase64,
      metadata: result.metadata,
      contentLength: result.contentLength,
      contentRange: result.contentRange,
    })
  }

  private async handlePutObject(params: {
    bucket: string
    key: string
    body: string // Base64 encoded
    contentType?: string
    contentEncoding?: string
    cacheControl?: string
    contentDisposition?: string
    contentLanguage?: string
    metadata?: Record<string, string>
    storageClass?: StorageClass
    acl?: CannedACL
  }): Promise<Response> {
    // Decode base64 body
    const bodyBytes = Uint8Array.from(atob(params.body), c => c.charCodeAt(0))

    const result = await this.putObject(params.bucket, params.key, bodyBytes, {
      contentType: params.contentType,
      contentEncoding: params.contentEncoding,
      cacheControl: params.cacheControl,
      contentDisposition: params.contentDisposition,
      contentLanguage: params.contentLanguage,
      metadata: params.metadata,
      storageClass: params.storageClass,
      acl: params.acl,
    })

    return Response.json({ etag: result.etag })
  }

  private async handleDeleteObject(params: {
    bucket: string
    key: string
    versionId?: string
  }): Promise<Response> {
    const result = await this.deleteObject(params.bucket, params.key, {
      versionId: params.versionId,
    })
    return Response.json(result)
  }

  private async handleDeleteObjects(params: {
    bucket: string
    keys: Array<{ key: string; versionId?: string }>
  }): Promise<Response> {
    const result = await this.deleteObjects(params.bucket, params.keys)
    return Response.json(result)
  }

  private async handleHeadObject(params: {
    bucket: string
    key: string
    versionId?: string
    ifMatch?: string
    ifNoneMatch?: string
    ifModifiedSince?: string
    ifUnmodifiedSince?: string
  }): Promise<Response> {
    const result = await this.headObject(params.bucket, params.key, {
      versionId: params.versionId,
      ifMatch: params.ifMatch,
      ifNoneMatch: params.ifNoneMatch,
      ifModifiedSince: params.ifModifiedSince ? new Date(params.ifModifiedSince) : undefined,
      ifUnmodifiedSince: params.ifUnmodifiedSince ? new Date(params.ifUnmodifiedSince) : undefined,
    })
    return Response.json(result)
  }

  private async handleCopyObject(params: CopyObjectRequest): Promise<Response> {
    const result = await this.copyObject(params)
    return Response.json(result)
  }

  private async handleCreateMultipartUpload(params: {
    bucket: string
    key: string
    contentType?: string
    storageClass?: StorageClass
    metadata?: Record<string, string>
  }): Promise<Response> {
    const result = await this.createMultipartUpload(params.bucket, params.key, {
      contentType: params.contentType,
      storageClass: params.storageClass,
      metadata: params.metadata,
    })
    return Response.json(result)
  }

  private async handleUploadPart(params: {
    bucket: string
    key: string
    uploadId: string
    partNumber: number
    body: string // Base64 encoded
    contentMD5?: string
  }): Promise<Response> {
    const bodyBytes = Uint8Array.from(atob(params.body), c => c.charCodeAt(0))
    const result = await this.uploadPart(
      params.bucket,
      params.key,
      params.uploadId,
      params.partNumber,
      bodyBytes,
      { contentMD5: params.contentMD5 }
    )
    return Response.json(result)
  }

  private async handleCompleteMultipartUpload(params: {
    bucket: string
    key: string
    uploadId: string
    parts: CompletedPart[]
  }): Promise<Response> {
    const result = await this.completeMultipartUpload(
      params.bucket,
      params.key,
      params.uploadId,
      params.parts
    )
    return Response.json(result)
  }

  private async handleAbortMultipartUpload(params: {
    bucket: string
    key: string
    uploadId: string
  }): Promise<Response> {
    await this.abortMultipartUpload(params.bucket, params.key, params.uploadId)
    return Response.json({ success: true })
  }

  private async handleListParts(params: ListPartsRequest): Promise<Response> {
    const result = await this.listParts(params)
    return Response.json(result)
  }

  private async handleListMultipartUploads(params: ListMultipartUploadsRequest): Promise<Response> {
    const result = await this.listMultipartUploads(params)
    return Response.json(result)
  }

  private async handleGetBucketAcl(params: { bucket: string }): Promise<Response> {
    const result = await this.getBucketAcl(params.bucket)
    return Response.json(result)
  }

  private async handlePutBucketAcl(params: {
    bucket: string
    acl: AccessControlPolicy | CannedACL | string
  }): Promise<Response> {
    await this.putBucketAcl(params.bucket, params.acl as AccessControlPolicy | CannedACL)
    return Response.json({ success: true })
  }

  private async handleGetObjectAcl(params: {
    bucket: string
    key: string
  }): Promise<Response> {
    const result = await this.getObjectAcl(params.bucket, params.key)
    return Response.json(result)
  }

  private async handlePutObjectAcl(params: {
    bucket: string
    key: string
    acl: AccessControlPolicy | CannedACL | string
  }): Promise<Response> {
    await this.putObjectAcl(params.bucket, params.key, params.acl as AccessControlPolicy | CannedACL)
    return Response.json({ success: true })
  }
}
