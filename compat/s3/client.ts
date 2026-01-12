/**
 * @dotdo/s3/client - S3Client Implementation
 *
 * AWS SDK v3 compatible S3 client with pluggable storage backends.
 *
 * Features:
 * - API-compatible with @aws-sdk/client-s3 v3
 * - Pluggable backends: MemoryBackend (testing), R2Backend (production)
 * - Built-in retry with exponential backoff
 * - Circuit breaker support for resilience
 * - Streaming uploads and downloads
 *
 * @example
 * ```typescript
 * // In-memory storage (for testing)
 * const client = new S3Client({ useMemoryStorage: true })
 *
 * // R2 backend (for production)
 * const client = new S3Client({ r2Bucket: env.MY_BUCKET })
 *
 * // Standard configuration with retry
 * const client = new S3Client({
 *   region: 'us-east-1',
 *   credentials: {
 *     accessKeyId: 'AKIAEXAMPLE',
 *     secretAccessKey: 'EXAMPLESECRETKEY',
 *   },
 *   retryConfig: {
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *   },
 * })
 * ```
 */

import type {
  ExtendedS3ClientConfig,
  ResponseMetadata,
  StreamingBody,
  CreateBucketCommandOutput,
  DeleteBucketCommandOutput,
  HeadBucketCommandOutput,
  ListBucketsCommandOutput,
  PutObjectCommandOutput,
  GetObjectCommandOutput,
  HeadObjectCommandOutput,
  DeleteObjectCommandOutput,
  DeleteObjectsCommandOutput,
  CopyObjectCommandOutput,
  ListObjectsV2CommandOutput,
  CreateMultipartUploadCommandOutput,
  UploadPartCommandOutput,
  CompleteMultipartUploadCommandOutput,
  AbortMultipartUploadCommandOutput,
  ListPartsCommandOutput,
  ListMultipartUploadsCommandOutput,
} from './types'

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  type Command,
} from './commands'

import {
  StorageBackend,
  MemoryBackend,
  R2Backend,
  defaultMemoryBackend,
} from './backend'

import {
  NoSuchBucket,
  NoSuchKey,
  BucketAlreadyExists,
  BucketNotEmpty,
  NoSuchUpload,
  InternalError,
  ServiceUnavailable,
  SlowDown,
} from './errors'

import {
  createRetryHandler,
  type RetryHandler,
  type RetryConfig,
} from '../core/retry'

// =============================================================================
// S3Client Class
// =============================================================================

/**
 * AWS SDK v3 compatible S3 client
 *
 * Supports pluggable storage backends:
 * - MemoryBackend: In-memory storage for testing
 * - R2Backend: Cloudflare R2 for production
 *
 * Features:
 * - Built-in retry with exponential backoff for transient failures
 * - Circuit breaker pattern for resilience
 * - Streaming support for large objects
 *
 * @example
 * ```typescript
 * const client = new S3Client({ region: 'us-east-1' })
 *
 * // Create a bucket
 * await client.send(new CreateBucketCommand({ Bucket: 'my-bucket' }))
 *
 * // Put object
 * await client.send(new PutObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-key',
 *   Body: 'Hello World',
 * }))
 * ```
 */
export class S3Client {
  readonly config: ExtendedS3ClientConfig
  private backend: StorageBackend
  private retryHandler: RetryHandler

  constructor(config: ExtendedS3ClientConfig = {}) {
    this.config = {
      region: config.region ?? 'us-east-1',
      ...config,
    }

    // Initialize storage backend
    if (config.r2Bucket) {
      this.backend = new R2Backend(config.r2Bucket)
    } else if (config.useMemoryStorage !== false) {
      // Default to memory storage for testing
      this.backend = defaultMemoryBackend
    } else {
      this.backend = defaultMemoryBackend
    }

    // Initialize retry handler with config
    this.retryHandler = createRetryHandler({
      maxRetries: config.retryConfig?.maxRetries ?? 3,
      initialDelay: config.retryConfig?.initialDelay ?? 1000,
      maxDelay: config.retryConfig?.maxDelay ?? 32000,
      multiplier: config.retryConfig?.multiplier ?? 2,
      jitter: config.retryConfig?.jitter ?? 0.25,
      timeoutBudget: config.retryConfig?.timeoutBudget ?? 60000,
    })
  }

  /**
   * Send a command to S3
   *
   * Automatically retries on transient failures (5xx errors, timeouts).
   * Non-retryable errors (4xx) are thrown immediately.
   */
  async send<T>(command: Command): Promise<T> {
    const startTime = Date.now()
    let attempts = 0

    const executeCommand = async (): Promise<T> => {
      attempts++
      const metadata: ResponseMetadata = {
        httpStatusCode: 200,
        requestId: crypto.randomUUID(),
        attempts,
        totalRetryDelay: Date.now() - startTime,
      }

      try {
        if (command instanceof CreateBucketCommand) {
          return (await this.handleCreateBucket(command, metadata)) as T
        }
        if (command instanceof DeleteBucketCommand) {
          return (await this.handleDeleteBucket(command, metadata)) as T
        }
        if (command instanceof HeadBucketCommand) {
          return (await this.handleHeadBucket(command, metadata)) as T
        }
        if (command instanceof ListBucketsCommand) {
          return (await this.handleListBuckets(metadata)) as T
        }
        if (command instanceof PutObjectCommand) {
          return (await this.handlePutObject(command, metadata)) as T
        }
        if (command instanceof GetObjectCommand) {
          return (await this.handleGetObject(command, metadata)) as T
        }
        if (command instanceof HeadObjectCommand) {
          return (await this.handleHeadObject(command, metadata)) as T
        }
        if (command instanceof DeleteObjectCommand) {
          return (await this.handleDeleteObject(command, metadata)) as T
        }
        if (command instanceof DeleteObjectsCommand) {
          return (await this.handleDeleteObjects(command, metadata)) as T
        }
        if (command instanceof CopyObjectCommand) {
          return (await this.handleCopyObject(command, metadata)) as T
        }
        if (command instanceof ListObjectsV2Command) {
          return (await this.handleListObjectsV2(command, metadata)) as T
        }
        if (command instanceof CreateMultipartUploadCommand) {
          return (await this.handleCreateMultipartUpload(command, metadata)) as T
        }
        if (command instanceof UploadPartCommand) {
          return (await this.handleUploadPart(command, metadata)) as T
        }
        if (command instanceof CompleteMultipartUploadCommand) {
          return (await this.handleCompleteMultipartUpload(command, metadata)) as T
        }
        if (command instanceof AbortMultipartUploadCommand) {
          return (await this.handleAbortMultipartUpload(command, metadata)) as T
        }
        if (command instanceof ListPartsCommand) {
          return (await this.handleListParts(command, metadata)) as T
        }
        if (command instanceof ListMultipartUploadsCommand) {
          return (await this.handleListMultipartUploads(command, metadata)) as T
        }

        throw new Error(`Unknown command: ${(command as { constructor: { name: string } }).constructor.name}`)
      } catch (error) {
        // Convert and check if retryable
        const s3Error = this.convertToS3Error(error)

        // Only retry on server errors (5xx) - client errors (4xx) are not retryable
        if (s3Error.$fault === 'server') {
          throw error // Let retry handler handle it
        }

        // Non-retryable error - throw immediately without retry
        throw s3Error
      }
    }

    // Use retry handler for R2 backend operations (which may have transient failures)
    if (this.config.r2Bucket) {
      try {
        return await this.retryHandler.execute(executeCommand)
      } catch (error) {
        throw this.convertToS3Error(error)
      }
    }

    // For memory backend, execute directly without retry
    return executeCommand()
  }

  /**
   * Convert an error to an S3-compatible error
   */
  private convertToS3Error(error: unknown): {
    name: string
    message: string
    $fault: 'client' | 'server'
    $metadata: ResponseMetadata
  } & Error {
    // Already an S3 error
    if (error instanceof NoSuchBucket ||
        error instanceof NoSuchKey ||
        error instanceof BucketAlreadyExists ||
        error instanceof BucketNotEmpty ||
        error instanceof NoSuchUpload ||
        error instanceof InternalError ||
        error instanceof ServiceUnavailable ||
        error instanceof SlowDown) {
      return error as {
        name: string
        message: string
        $fault: 'client' | 'server'
        $metadata: ResponseMetadata
      } & Error
    }

    // Backend error messages
    if (error instanceof Error) {
      switch (error.message) {
        case 'NoSuchBucket':
          return new NoSuchBucket() as {
            name: string
            message: string
            $fault: 'client' | 'server'
            $metadata: ResponseMetadata
          } & Error
        case 'NoSuchKey':
          return new NoSuchKey() as {
            name: string
            message: string
            $fault: 'client' | 'server'
            $metadata: ResponseMetadata
          } & Error
        case 'BucketAlreadyExists':
          return new BucketAlreadyExists() as {
            name: string
            message: string
            $fault: 'client' | 'server'
            $metadata: ResponseMetadata
          } & Error
        case 'BucketNotEmpty':
          return new BucketNotEmpty() as {
            name: string
            message: string
            $fault: 'client' | 'server'
            $metadata: ResponseMetadata
          } & Error
        case 'NoSuchUpload':
          return new NoSuchUpload() as {
            name: string
            message: string
            $fault: 'client' | 'server'
            $metadata: ResponseMetadata
          } & Error
      }

      // Treat unknown errors as server errors (retryable)
      return new InternalError({ message: error.message }) as {
        name: string
        message: string
        $fault: 'client' | 'server'
        $metadata: ResponseMetadata
      } & Error
    }

    // Unknown error type
    return new InternalError({ message: String(error) }) as {
      name: string
      message: string
      $fault: 'client' | 'server'
      $metadata: ResponseMetadata
    } & Error
  }

  // ===========================================================================
  // Bucket Handlers
  // ===========================================================================

  private async handleCreateBucket(
    command: CreateBucketCommand,
    metadata: ResponseMetadata
  ): Promise<CreateBucketCommandOutput> {
    const { Bucket, CreateBucketConfiguration } = command.input

    // Check if bucket already exists
    const exists = await this.backend.bucketExists(Bucket)
    if (exists) {
      throw new BucketAlreadyExists()
    }

    await this.backend.createBucket(
      Bucket,
      CreateBucketConfiguration?.LocationConstraint ?? this.config.region
    )

    return {
      Location: `/${Bucket}`,
      $metadata: metadata,
    }
  }

  private async handleDeleteBucket(
    command: DeleteBucketCommand,
    metadata: ResponseMetadata
  ): Promise<DeleteBucketCommandOutput> {
    const { Bucket } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    // Check if bucket is empty
    const isEmpty = await this.backend.bucketIsEmpty(Bucket)
    if (!isEmpty) {
      throw new BucketNotEmpty()
    }

    await this.backend.deleteBucket(Bucket)

    return {
      $metadata: { ...metadata, httpStatusCode: 204 },
    }
  }

  private async handleHeadBucket(
    command: HeadBucketCommand,
    metadata: ResponseMetadata
  ): Promise<HeadBucketCommandOutput> {
    const { Bucket } = command.input

    try {
      const bucket = await this.backend.headBucket(Bucket)
      return {
        BucketRegion: bucket.region,
        $metadata: metadata,
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'NoSuchBucket') {
        throw new NoSuchBucket()
      }
      throw error
    }
  }

  private async handleListBuckets(
    metadata: ResponseMetadata
  ): Promise<ListBucketsCommandOutput> {
    const buckets = await this.backend.listBuckets()

    return {
      Buckets: buckets.map((b) => ({
        Name: b.name,
        CreationDate: b.creationDate,
      })),
      Owner: {
        ID: 'default-owner-id',
        DisplayName: 'Default Owner',
      },
      $metadata: metadata,
    }
  }

  // ===========================================================================
  // Object Handlers
  // ===========================================================================

  private async handlePutObject(
    command: PutObjectCommand,
    metadata: ResponseMetadata
  ): Promise<PutObjectCommandOutput> {
    const { Bucket, Key, Body, ...options } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    // Convert body to Uint8Array
    const body = await this.bodyToUint8Array(Body)

    const result = await this.backend.putObject(Bucket, Key, body, {
      contentType: options.ContentType,
      contentEncoding: options.ContentEncoding,
      cacheControl: options.CacheControl,
      contentDisposition: options.ContentDisposition,
      contentLanguage: options.ContentLanguage,
      metadata: options.Metadata,
      storageClass: options.StorageClass,
    })

    return {
      ETag: result.etag,
      $metadata: metadata,
    }
  }

  private async handleGetObject(
    command: GetObjectCommand,
    metadata: ResponseMetadata
  ): Promise<GetObjectCommandOutput> {
    const { Bucket, Key, Range } = command.input

    // Parse range if provided
    let rangeOptions: { start: number; end: number } | undefined
    let contentRange: string | undefined

    if (Range) {
      const match = Range.match(/^bytes=(\d+)-(\d*)$/)
      if (match) {
        // We need to get the object size first for range requests
        const headObj = await this.backend.headObject(Bucket, Key)
        if (!headObj) {
          throw new NoSuchKey()
        }

        const start = parseInt(match[1])
        const end = match[2] ? parseInt(match[2]) : headObj.size - 1
        rangeOptions = { start, end: Math.min(end, headObj.size - 1) }
        contentRange = `bytes ${rangeOptions.start}-${rangeOptions.end}/${headObj.size}`
        metadata.httpStatusCode = 206
      }
    }

    const obj = await this.backend.getObject(Bucket, Key, rangeOptions ? { range: rangeOptions } : undefined)
    if (!obj) {
      throw new NoSuchKey()
    }

    // Create streaming body
    const body = obj.body
    const streamingBody: StreamingBody = {
      transformToString: async () => new TextDecoder().decode(body),
      transformToByteArray: async () => body,
      transformToWebStream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(body)
            controller.close()
          },
        }),
    }

    return {
      Body: streamingBody,
      ContentLength: obj.size,
      ContentType: obj.contentType,
      ContentEncoding: obj.contentEncoding,
      CacheControl: obj.cacheControl,
      ContentDisposition: obj.contentDisposition,
      ContentLanguage: obj.contentLanguage,
      ContentRange: contentRange,
      ETag: obj.etag,
      LastModified: obj.lastModified,
      Metadata: obj.metadata,
      $metadata: metadata,
    }
  }

  private async handleHeadObject(
    command: HeadObjectCommand,
    metadata: ResponseMetadata
  ): Promise<HeadObjectCommandOutput> {
    const { Bucket, Key } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    const obj = await this.backend.headObject(Bucket, Key)
    if (!obj) {
      throw new NoSuchKey()
    }

    return {
      ContentLength: obj.size,
      ContentType: obj.contentType,
      ContentEncoding: obj.contentEncoding,
      CacheControl: obj.cacheControl,
      ContentDisposition: obj.contentDisposition,
      ContentLanguage: obj.contentLanguage,
      ETag: obj.etag,
      LastModified: obj.lastModified,
      Metadata: obj.metadata,
      StorageClass: obj.storageClass,
      $metadata: metadata,
    }
  }

  private async handleDeleteObject(
    command: DeleteObjectCommand,
    metadata: ResponseMetadata
  ): Promise<DeleteObjectCommandOutput> {
    const { Bucket, Key } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    await this.backend.deleteObject(Bucket, Key)

    return {
      $metadata: { ...metadata, httpStatusCode: 204 },
    }
  }

  private async handleDeleteObjects(
    command: DeleteObjectsCommand,
    metadata: ResponseMetadata
  ): Promise<DeleteObjectsCommandOutput> {
    const { Bucket, Delete } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    const deleted: Array<{ Key?: string; VersionId?: string; DeleteMarker?: boolean }> = []

    for (const obj of Delete.Objects) {
      // S3 treats delete of non-existent keys as success
      await this.backend.deleteObject(Bucket, obj.Key)
      deleted.push({ Key: obj.Key, VersionId: obj.VersionId })
    }

    return {
      Deleted: deleted,
      Errors: [],
      $metadata: metadata,
    }
  }

  private async handleCopyObject(
    command: CopyObjectCommand,
    metadata: ResponseMetadata
  ): Promise<CopyObjectCommandOutput> {
    const { Bucket, Key, CopySource, MetadataDirective, ...options } = command.input

    // Parse CopySource (format: /bucket/key or bucket/key)
    const copySource = CopySource.startsWith('/') ? CopySource.slice(1) : CopySource
    const [sourceBucket, ...keyParts] = copySource.split('/')
    const sourceKey = keyParts.join('/')

    // Get source object
    const srcObj = await this.backend.getObject(sourceBucket, sourceKey)
    if (!srcObj) {
      throw new NoSuchKey()
    }

    // Check if destination bucket exists
    const destExists = await this.backend.bucketExists(Bucket)
    if (!destExists) {
      throw new NoSuchBucket()
    }

    // Determine metadata
    let finalMetadata = srcObj.metadata
    let contentType = srcObj.contentType
    let cacheControl = srcObj.cacheControl
    let contentDisposition = srcObj.contentDisposition
    let contentEncoding = srcObj.contentEncoding
    let contentLanguage = srcObj.contentLanguage

    if (MetadataDirective === 'REPLACE') {
      finalMetadata = options.Metadata
      contentType = options.ContentType ?? contentType
      cacheControl = options.CacheControl ?? cacheControl
      contentDisposition = options.ContentDisposition ?? contentDisposition
      contentEncoding = options.ContentEncoding ?? contentEncoding
      contentLanguage = options.ContentLanguage ?? contentLanguage
    }

    // Copy the object
    const result = await this.backend.putObject(Bucket, Key, srcObj.body, {
      contentType,
      contentEncoding,
      cacheControl,
      contentDisposition,
      contentLanguage,
      metadata: finalMetadata,
      storageClass: options.StorageClass ?? srcObj.storageClass,
    })

    return {
      CopyObjectResult: {
        ETag: result.etag,
        LastModified: new Date(),
      },
      $metadata: metadata,
    }
  }

  private async handleListObjectsV2(
    command: ListObjectsV2Command,
    metadata: ResponseMetadata
  ): Promise<ListObjectsV2CommandOutput> {
    const { Bucket, Prefix, Delimiter, MaxKeys, ContinuationToken, StartAfter } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    const result = await this.backend.listObjects(Bucket, {
      prefix: Prefix,
      delimiter: Delimiter,
      maxKeys: MaxKeys,
      startAfter: StartAfter,
      continuationToken: ContinuationToken,
    })

    return {
      Name: Bucket,
      Prefix: Prefix || undefined,
      Delimiter,
      MaxKeys: MaxKeys ?? 1000,
      IsTruncated: result.isTruncated,
      Contents: result.objects.map((o) => ({
        Key: o.key,
        Size: o.size,
        ETag: o.etag,
        LastModified: o.lastModified,
        StorageClass: o.storageClass,
      })),
      CommonPrefixes: result.commonPrefixes.map((p) => ({ Prefix: p })),
      ContinuationToken,
      NextContinuationToken: result.nextContinuationToken,
      StartAfter,
      KeyCount: result.objects.length,
      $metadata: metadata,
    }
  }

  // ===========================================================================
  // Multipart Upload Handlers
  // ===========================================================================

  private async handleCreateMultipartUpload(
    command: CreateMultipartUploadCommand,
    metadata: ResponseMetadata
  ): Promise<CreateMultipartUploadCommandOutput> {
    const { Bucket, Key, ContentType, Metadata } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    const uploadId = await this.backend.createMultipartUpload(Bucket, Key, {
      contentType: ContentType,
      metadata: Metadata,
    })

    return {
      Bucket,
      Key,
      UploadId: uploadId,
      $metadata: metadata,
    }
  }

  private async handleUploadPart(
    command: UploadPartCommand,
    metadata: ResponseMetadata
  ): Promise<UploadPartCommandOutput> {
    const { Bucket, Key, UploadId, PartNumber, Body } = command.input

    try {
      const body = await this.bodyToUint8Array(Body)
      const result = await this.backend.uploadPart(Bucket, Key, UploadId, PartNumber, body)

      return {
        ETag: result.etag,
        $metadata: metadata,
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'NoSuchUpload') {
        throw new NoSuchUpload()
      }
      throw error
    }
  }

  private async handleCompleteMultipartUpload(
    command: CompleteMultipartUploadCommand,
    metadata: ResponseMetadata
  ): Promise<CompleteMultipartUploadCommandOutput> {
    const { Bucket, Key, UploadId, MultipartUpload } = command.input

    try {
      const parts = (MultipartUpload?.Parts ?? []).map((p) => ({
        partNumber: p.PartNumber!,
        etag: p.ETag!,
      }))

      const result = await this.backend.completeMultipartUpload(Bucket, Key, UploadId, parts)

      return {
        Location: `/${Bucket}/${Key}`,
        Bucket,
        Key,
        ETag: result.etag,
        $metadata: metadata,
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'NoSuchUpload') {
        throw new NoSuchUpload()
      }
      throw error
    }
  }

  private async handleAbortMultipartUpload(
    command: AbortMultipartUploadCommand,
    metadata: ResponseMetadata
  ): Promise<AbortMultipartUploadCommandOutput> {
    const { Bucket, Key, UploadId } = command.input

    try {
      await this.backend.abortMultipartUpload(Bucket, Key, UploadId)

      return {
        $metadata: { ...metadata, httpStatusCode: 204 },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'NoSuchUpload') {
        throw new NoSuchUpload()
      }
      throw error
    }
  }

  private async handleListParts(
    command: ListPartsCommand,
    metadata: ResponseMetadata
  ): Promise<ListPartsCommandOutput> {
    const { Bucket, Key, UploadId, MaxParts, PartNumberMarker } = command.input

    try {
      const result = await this.backend.listParts(Bucket, Key, UploadId, {
        maxParts: MaxParts,
        partNumberMarker: PartNumberMarker,
      })

      return {
        Bucket,
        Key,
        UploadId,
        PartNumberMarker: PartNumberMarker || undefined,
        NextPartNumberMarker: result.nextPartNumberMarker,
        MaxParts: MaxParts ?? 1000,
        IsTruncated: result.isTruncated,
        Parts: result.parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
          Size: p.size,
          LastModified: p.lastModified,
        })),
        $metadata: metadata,
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'NoSuchUpload') {
        throw new NoSuchUpload()
      }
      throw error
    }
  }

  private async handleListMultipartUploads(
    command: ListMultipartUploadsCommand,
    metadata: ResponseMetadata
  ): Promise<ListMultipartUploadsCommandOutput> {
    const { Bucket, Prefix, Delimiter, MaxUploads, KeyMarker, UploadIdMarker } = command.input

    // Check if bucket exists
    const exists = await this.backend.bucketExists(Bucket)
    if (!exists) {
      throw new NoSuchBucket()
    }

    const result = await this.backend.listMultipartUploads(Bucket, {
      prefix: Prefix,
      delimiter: Delimiter,
      maxUploads: MaxUploads,
      keyMarker: KeyMarker,
      uploadIdMarker: UploadIdMarker,
    })

    return {
      Bucket,
      KeyMarker: KeyMarker || undefined,
      UploadIdMarker: UploadIdMarker || undefined,
      NextKeyMarker: result.nextKeyMarker,
      NextUploadIdMarker: result.nextUploadIdMarker,
      MaxUploads: MaxUploads ?? 1000,
      IsTruncated: result.isTruncated,
      Uploads: result.uploads.map((u) => ({
        Key: u.key,
        UploadId: u.uploadId,
        Initiated: u.initiated,
      })),
      CommonPrefixes: result.commonPrefixes.map((p) => ({ Prefix: p })),
      $metadata: metadata,
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async bodyToUint8Array(
    body?: ReadableStream<Uint8Array> | Uint8Array | string
  ): Promise<Uint8Array> {
    if (body === undefined) {
      return new Uint8Array(0)
    }
    if (typeof body === 'string') {
      return new TextEncoder().encode(body)
    }
    if (body instanceof Uint8Array) {
      return body
    }

    // ReadableStream
    const chunks: Uint8Array[] = []
    const reader = body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  }

}
