/**
 * @dotdo/s3 - S3 SDK compat
 *
 * Drop-in replacement for @aws-sdk/client-s3 backed by DO/R2 storage.
 * This in-memory implementation matches the AWS SDK v3 S3 Client API.
 * Production version routes to Durable Objects or R2 based on config.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */
import type {
  S3ClientConfig,
  ExtendedS3ClientConfig,
  Credentials,
  Body,
  Metadata,
  StreamingBlobPayloadOutputTypes,
  ResponseMetadata,
  Command,
  Bucket,
  S3Object,
  Owner,
  CreateBucketCommandInput,
  CreateBucketCommandOutput,
  DeleteBucketCommandInput,
  DeleteBucketCommandOutput,
  ListBucketsCommandInput,
  ListBucketsCommandOutput,
  HeadBucketCommandInput,
  HeadBucketCommandOutput,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  DeleteObjectCommandInput,
  DeleteObjectCommandOutput,
  HeadObjectCommandInput,
  HeadObjectCommandOutput,
  CopyObjectCommandInput,
  CopyObjectCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  DeleteObjectsCommandInput,
  DeleteObjectsCommandOutput,
  GetSignedUrlOptions,
} from './types'
import {
  S3ServiceException,
  NoSuchBucket,
  NoSuchKey,
  BucketAlreadyExists,
  BucketNotEmpty,
  NotModified,
  PreconditionFailed,
} from './types'
import {
  uriEncode,
  formatDateStamp,
  formatAmzDate,
  getSigningKey,
  createCanonicalRequest,
  createStringToSign,
  calculateSignature,
  type SigningContext,
} from './signing'

// ============================================================================
// STORAGE TYPES
// ============================================================================

interface StoredObject {
  key: string
  body: Uint8Array
  contentType?: string
  contentLength: number
  contentEncoding?: string
  contentDisposition?: string
  contentLanguage?: string
  cacheControl?: string
  expires?: Date
  metadata: Metadata
  etag: string
  lastModified: Date
  storageClass: string
  versionId?: string
}

interface StoredBucket {
  name: string
  creationDate: Date
  region: string
  objects: Map<string, StoredObject>
}

// ============================================================================
// GLOBAL IN-MEMORY STORAGE
// ============================================================================

// Use global storage so multiple client instances share state (like a real S3)
const globalBuckets = new Map<string, StoredBucket>()

// Owner info
const globalOwner: Owner = {
  DisplayName: 'dotdo-user',
  ID: 'dotdo-user-id-12345',
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a simple ETag for content
 */
function generateETag(content: Uint8Array): string {
  // Simple hash - in production would use MD5
  let hash = 0
  for (const byte of content) {
    hash = ((hash << 5) - hash + byte) | 0
  }
  return `"${Math.abs(hash).toString(16).padStart(32, '0')}"`
}

/**
 * Convert body to Uint8Array
 */
async function bodyToBytes(body: Body | undefined): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)

  if (body instanceof Uint8Array) {
    return body
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }

  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }

  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer())
  }

  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let done = false

    while (!done) {
      const result = await reader.read()
      done = result.done
      if (result.value) {
        chunks.push(result.value)
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    return combined
  }

  throw new Error('Unsupported body type')
}

/**
 * Create streaming body from bytes
 */
function createStreamingBody(bytes: Uint8Array): StreamingBlobPayloadOutputTypes {
  return {
    async transformToByteArray(): Promise<Uint8Array> {
      return bytes
    },
    async transformToString(encoding?: string): Promise<string> {
      return new TextDecoder(encoding).decode(bytes)
    },
    transformToWebStream(): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
    },
  }
}

/**
 * Create response metadata
 */
function createMetadata(statusCode = 200): ResponseMetadata {
  return {
    httpStatusCode: statusCode,
    requestId: crypto.randomUUID(),
    attempts: 1,
    totalRetryDelay: 0,
  }
}

/**
 * Match glob pattern to key
 */
function matchPrefix(key: string, prefix?: string): boolean {
  if (!prefix) return true
  return key.startsWith(prefix)
}

/**
 * Parse copy source (format: bucket/key or /bucket/key)
 */
function parseCopySource(copySource: string): { bucket: string; key: string } {
  const source = copySource.startsWith('/') ? copySource.slice(1) : copySource
  const slashIndex = source.indexOf('/')
  if (slashIndex === -1) {
    throw new S3ServiceException({
      name: 'InvalidRequest',
      message: 'Invalid copy source format',
      $fault: 'client',
    })
  }
  return {
    bucket: source.slice(0, slashIndex),
    key: decodeURIComponent(source.slice(slashIndex + 1)),
  }
}

// ============================================================================
// COMMAND CLASSES
// ============================================================================

/**
 * CreateBucketCommand
 */
export class CreateBucketCommand implements Command<CreateBucketCommandInput, CreateBucketCommandOutput> {
  readonly _type = 'CreateBucket'
  constructor(readonly input: CreateBucketCommandInput) {}
}

/**
 * DeleteBucketCommand
 */
export class DeleteBucketCommand implements Command<DeleteBucketCommandInput, DeleteBucketCommandOutput> {
  readonly _type = 'DeleteBucket'
  constructor(readonly input: DeleteBucketCommandInput) {}
}

/**
 * ListBucketsCommand
 */
export class ListBucketsCommand implements Command<ListBucketsCommandInput, ListBucketsCommandOutput> {
  readonly _type = 'ListBuckets'
  constructor(readonly input: ListBucketsCommandInput = {}) {}
}

/**
 * HeadBucketCommand
 */
export class HeadBucketCommand implements Command<HeadBucketCommandInput, HeadBucketCommandOutput> {
  readonly _type = 'HeadBucket'
  constructor(readonly input: HeadBucketCommandInput) {}
}

/**
 * PutObjectCommand
 */
export class PutObjectCommand implements Command<PutObjectCommandInput, PutObjectCommandOutput> {
  readonly _type = 'PutObject'
  constructor(readonly input: PutObjectCommandInput) {}
}

/**
 * GetObjectCommand
 */
export class GetObjectCommand implements Command<GetObjectCommandInput, GetObjectCommandOutput> {
  readonly _type = 'GetObject'
  constructor(readonly input: GetObjectCommandInput) {}
}

/**
 * DeleteObjectCommand
 */
export class DeleteObjectCommand implements Command<DeleteObjectCommandInput, DeleteObjectCommandOutput> {
  readonly _type = 'DeleteObject'
  constructor(readonly input: DeleteObjectCommandInput) {}
}

/**
 * HeadObjectCommand
 */
export class HeadObjectCommand implements Command<HeadObjectCommandInput, HeadObjectCommandOutput> {
  readonly _type = 'HeadObject'
  constructor(readonly input: HeadObjectCommandInput) {}
}

/**
 * CopyObjectCommand
 */
export class CopyObjectCommand implements Command<CopyObjectCommandInput, CopyObjectCommandOutput> {
  readonly _type = 'CopyObject'
  constructor(readonly input: CopyObjectCommandInput) {}
}

/**
 * ListObjectsV2Command
 */
export class ListObjectsV2Command implements Command<ListObjectsV2CommandInput, ListObjectsV2CommandOutput> {
  readonly _type = 'ListObjectsV2'
  constructor(readonly input: ListObjectsV2CommandInput) {}
}

/**
 * DeleteObjectsCommand
 */
export class DeleteObjectsCommand implements Command<DeleteObjectsCommandInput, DeleteObjectsCommandOutput> {
  readonly _type = 'DeleteObjects'
  constructor(readonly input: DeleteObjectsCommandInput) {}
}

// ============================================================================
// S3 CLIENT
// ============================================================================

/**
 * S3 Client implementation
 */
export class S3Client {
  private config: ExtendedS3ClientConfig
  private destroyed = false

  constructor(config: S3ClientConfig | ExtendedS3ClientConfig = {}) {
    this.config = {
      region: 'us-east-1',
      ...config,
    } as ExtendedS3ClientConfig
  }

  /**
   * Send a command to S3
   */
  async send<Input, Output>(command: Command<Input, Output>): Promise<Output> {
    if (this.destroyed) {
      throw new S3ServiceException({
        name: 'ClientDestroyed',
        message: 'Client has been destroyed',
        $fault: 'client',
      })
    }

    switch (command._type) {
      case 'CreateBucket':
        return this.createBucket(command.input as CreateBucketCommandInput) as Output
      case 'DeleteBucket':
        return this.deleteBucket(command.input as DeleteBucketCommandInput) as Output
      case 'ListBuckets':
        return this.listBuckets() as Output
      case 'HeadBucket':
        return this.headBucket(command.input as HeadBucketCommandInput) as Output
      case 'PutObject':
        return this.putObject(command.input as PutObjectCommandInput) as Output
      case 'GetObject':
        return this.getObject(command.input as GetObjectCommandInput) as Output
      case 'DeleteObject':
        return this.deleteObject(command.input as DeleteObjectCommandInput) as Output
      case 'HeadObject':
        return this.headObject(command.input as HeadObjectCommandInput) as Output
      case 'CopyObject':
        return this.copyObject(command.input as CopyObjectCommandInput) as Output
      case 'ListObjectsV2':
        return this.listObjectsV2(command.input as ListObjectsV2CommandInput) as Output
      case 'DeleteObjects':
        return this.deleteObjects(command.input as DeleteObjectsCommandInput) as Output
      default:
        throw new S3ServiceException({
          name: 'UnknownCommand',
          message: `Unknown command: ${command._type}`,
          $fault: 'client',
        })
    }
  }

  /**
   * Destroy the client
   */
  destroy(): void {
    this.destroyed = true
  }

  /**
   * Get client configuration (used by getSignedUrl)
   */
  getConfig(): ExtendedS3ClientConfig {
    return this.config
  }

  // ============================================================================
  // BUCKET OPERATIONS
  // ============================================================================

  private async createBucket(input: CreateBucketCommandInput): Promise<CreateBucketCommandOutput> {
    const { Bucket } = input

    if (globalBuckets.has(Bucket)) {
      throw new BucketAlreadyExists()
    }

    globalBuckets.set(Bucket, {
      name: Bucket,
      creationDate: new Date(),
      region: input.CreateBucketConfiguration?.LocationConstraint ?? this.config.region ?? 'us-east-1',
      objects: new Map(),
    })

    return {
      $metadata: createMetadata(200),
      Location: `/${Bucket}`,
    }
  }

  private async deleteBucket(input: DeleteBucketCommandInput): Promise<DeleteBucketCommandOutput> {
    const { Bucket } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    if (bucket.objects.size > 0) {
      throw new BucketNotEmpty()
    }

    globalBuckets.delete(Bucket)

    return {
      $metadata: createMetadata(204),
    }
  }

  private async listBuckets(): Promise<ListBucketsCommandOutput> {
    const buckets: Bucket[] = []

    for (const [, bucket] of globalBuckets) {
      buckets.push({
        Name: bucket.name,
        CreationDate: bucket.creationDate,
      })
    }

    return {
      $metadata: createMetadata(200),
      Buckets: buckets,
      Owner: globalOwner,
    }
  }

  private async headBucket(input: HeadBucketCommandInput): Promise<HeadBucketCommandOutput> {
    const { Bucket } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    return {
      $metadata: createMetadata(200),
      BucketRegion: bucket.region,
    }
  }

  // ============================================================================
  // OBJECT OPERATIONS
  // ============================================================================

  private async putObject(input: PutObjectCommandInput): Promise<PutObjectCommandOutput> {
    const { Bucket, Key, Body, ContentType, Metadata: inputMetadata, StorageClass } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    const bytes = await bodyToBytes(Body)
    const etag = generateETag(bytes)

    const storedObject: StoredObject = {
      key: Key,
      body: bytes,
      contentType: ContentType ?? 'application/octet-stream',
      contentLength: bytes.length,
      contentEncoding: input.ContentEncoding,
      contentDisposition: input.ContentDisposition,
      contentLanguage: input.ContentLanguage,
      cacheControl: input.CacheControl,
      expires: input.Expires,
      metadata: inputMetadata ?? {},
      etag,
      lastModified: new Date(),
      storageClass: StorageClass ?? 'STANDARD',
    }

    bucket.objects.set(Key, storedObject)

    return {
      $metadata: createMetadata(200),
      ETag: etag,
    }
  }

  private async getObject(input: GetObjectCommandInput): Promise<GetObjectCommandOutput> {
    const { Bucket, Key, IfModifiedSince, IfUnmodifiedSince, IfMatch, IfNoneMatch, Range } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    const obj = bucket.objects.get(Key)
    if (!obj) {
      throw new NoSuchKey()
    }

    // Check conditional headers
    if (IfMatch && obj.etag !== IfMatch) {
      throw new PreconditionFailed()
    }

    if (IfNoneMatch && obj.etag === IfNoneMatch) {
      throw new NotModified()
    }

    if (IfModifiedSince && obj.lastModified <= IfModifiedSince) {
      throw new NotModified()
    }

    if (IfUnmodifiedSince && obj.lastModified > IfUnmodifiedSince) {
      throw new PreconditionFailed()
    }

    // Handle range requests
    let body = obj.body
    let contentRange: string | undefined
    let contentLength = obj.contentLength

    if (Range) {
      const rangeMatch = Range.match(/bytes=(\d+)-(\d*)/)
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10)
        const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : obj.body.length - 1
        body = obj.body.slice(start, end + 1)
        contentLength = body.length
        contentRange = `bytes ${start}-${end}/${obj.body.length}`
      }
    }

    return {
      $metadata: createMetadata(Range ? 206 : 200),
      Body: createStreamingBody(body),
      ContentType: input.ResponseContentType ?? obj.contentType,
      ContentLength: contentLength,
      ContentEncoding: input.ResponseContentEncoding ?? obj.contentEncoding,
      ContentDisposition: input.ResponseContentDisposition ?? obj.contentDisposition,
      ContentLanguage: input.ResponseContentLanguage ?? obj.contentLanguage,
      ContentRange: contentRange,
      CacheControl: input.ResponseCacheControl ?? obj.cacheControl,
      Expires: input.ResponseExpires ?? obj.expires,
      ETag: obj.etag,
      LastModified: obj.lastModified,
      Metadata: obj.metadata,
      StorageClass: obj.storageClass as GetObjectCommandOutput['StorageClass'],
      AcceptRanges: 'bytes',
    }
  }

  private async deleteObject(input: DeleteObjectCommandInput): Promise<DeleteObjectCommandOutput> {
    const { Bucket, Key } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    // S3 delete is idempotent - doesn't error if key doesn't exist
    bucket.objects.delete(Key)

    return {
      $metadata: createMetadata(204),
    }
  }

  private async headObject(input: HeadObjectCommandInput): Promise<HeadObjectCommandOutput> {
    const { Bucket, Key, IfModifiedSince, IfUnmodifiedSince, IfMatch, IfNoneMatch } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    const obj = bucket.objects.get(Key)
    if (!obj) {
      throw new NoSuchKey()
    }

    // Check conditional headers
    if (IfMatch && obj.etag !== IfMatch) {
      throw new PreconditionFailed()
    }

    if (IfNoneMatch && obj.etag === IfNoneMatch) {
      throw new NotModified()
    }

    if (IfModifiedSince && obj.lastModified <= IfModifiedSince) {
      throw new NotModified()
    }

    if (IfUnmodifiedSince && obj.lastModified > IfUnmodifiedSince) {
      throw new PreconditionFailed()
    }

    return {
      $metadata: createMetadata(200),
      ContentType: obj.contentType,
      ContentLength: obj.contentLength,
      ContentEncoding: obj.contentEncoding,
      ContentDisposition: obj.contentDisposition,
      ContentLanguage: obj.contentLanguage,
      CacheControl: obj.cacheControl,
      Expires: obj.expires,
      ETag: obj.etag,
      LastModified: obj.lastModified,
      Metadata: obj.metadata,
      StorageClass: obj.storageClass as HeadObjectCommandOutput['StorageClass'],
      AcceptRanges: 'bytes',
    }
  }

  private async copyObject(input: CopyObjectCommandInput): Promise<CopyObjectCommandOutput> {
    const { Bucket, Key, CopySource, MetadataDirective, ContentType, Metadata: inputMetadata } = input

    const destBucket = globalBuckets.get(Bucket)
    if (!destBucket) {
      throw new NoSuchBucket()
    }

    const { bucket: sourceBucketName, key: sourceKey } = parseCopySource(CopySource)

    const sourceBucket = globalBuckets.get(sourceBucketName)
    if (!sourceBucket) {
      throw new NoSuchBucket()
    }

    const sourceObj = sourceBucket.objects.get(sourceKey)
    if (!sourceObj) {
      throw new NoSuchKey()
    }

    // Check conditional copy headers
    if (input.CopySourceIfMatch && sourceObj.etag !== input.CopySourceIfMatch) {
      throw new PreconditionFailed()
    }

    if (input.CopySourceIfNoneMatch && sourceObj.etag === input.CopySourceIfNoneMatch) {
      throw new PreconditionFailed()
    }

    if (input.CopySourceIfModifiedSince && sourceObj.lastModified <= input.CopySourceIfModifiedSince) {
      throw new PreconditionFailed()
    }

    if (input.CopySourceIfUnmodifiedSince && sourceObj.lastModified > input.CopySourceIfUnmodifiedSince) {
      throw new PreconditionFailed()
    }

    // Copy object
    const newEtag = generateETag(sourceObj.body)
    const lastModified = new Date()

    const copiedObject: StoredObject = {
      key: Key,
      body: new Uint8Array(sourceObj.body),
      contentType: MetadataDirective === 'REPLACE' ? (ContentType ?? sourceObj.contentType) : sourceObj.contentType,
      contentLength: sourceObj.contentLength,
      contentEncoding: sourceObj.contentEncoding,
      contentDisposition: sourceObj.contentDisposition,
      contentLanguage: sourceObj.contentLanguage,
      cacheControl: sourceObj.cacheControl,
      expires: sourceObj.expires,
      metadata: MetadataDirective === 'REPLACE' ? (inputMetadata ?? {}) : { ...sourceObj.metadata },
      etag: newEtag,
      lastModified,
      storageClass: input.StorageClass ?? sourceObj.storageClass,
    }

    destBucket.objects.set(Key, copiedObject)

    return {
      $metadata: createMetadata(200),
      CopyObjectResult: {
        ETag: newEtag,
        LastModified: lastModified,
      },
    }
  }

  private async listObjectsV2(input: ListObjectsV2CommandInput): Promise<ListObjectsV2CommandOutput> {
    const { Bucket, Prefix, Delimiter, MaxKeys = 1000, ContinuationToken, StartAfter, FetchOwner } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    // Collect matching objects
    const allKeys: string[] = []
    for (const key of bucket.objects.keys()) {
      if (matchPrefix(key, Prefix)) {
        allKeys.push(key)
      }
    }

    // Sort keys
    allKeys.sort()

    // Apply StartAfter or ContinuationToken
    const startKey = ContinuationToken ?? StartAfter
    let startIndex = 0
    if (startKey) {
      startIndex = allKeys.findIndex((k) => k > startKey)
      if (startIndex === -1) startIndex = allKeys.length
    }

    // Handle delimiter (common prefixes)
    const commonPrefixes = new Set<string>()
    const contents: S3Object[] = []

    for (let i = startIndex; i < allKeys.length && contents.length < MaxKeys; i++) {
      const key = allKeys[i]

      if (Delimiter) {
        const prefixLen = Prefix?.length ?? 0
        const afterPrefix = key.slice(prefixLen)
        const delimiterIndex = afterPrefix.indexOf(Delimiter)

        if (delimiterIndex !== -1) {
          const commonPrefix = key.slice(0, prefixLen + delimiterIndex + 1)
          commonPrefixes.add(commonPrefix)
          continue
        }
      }

      const obj = bucket.objects.get(key)!
      contents.push({
        Key: key,
        LastModified: obj.lastModified,
        ETag: obj.etag,
        Size: obj.contentLength,
        StorageClass: obj.storageClass as S3Object['StorageClass'],
        Owner: FetchOwner ? globalOwner : undefined,
      })
    }

    // Determine if truncated
    const isTruncated = startIndex + contents.length + commonPrefixes.size < allKeys.length

    // Generate next continuation token
    let nextContinuationToken: string | undefined
    if (isTruncated && contents.length > 0) {
      nextContinuationToken = contents[contents.length - 1].Key
    }

    return {
      $metadata: createMetadata(200),
      IsTruncated: isTruncated,
      Contents: contents,
      Name: Bucket,
      Prefix,
      Delimiter,
      MaxKeys,
      CommonPrefixes: Array.from(commonPrefixes).map((prefix) => ({ Prefix: prefix })),
      KeyCount: contents.length,
      ContinuationToken,
      NextContinuationToken: nextContinuationToken,
      StartAfter,
    }
  }

  private async deleteObjects(input: DeleteObjectsCommandInput): Promise<DeleteObjectsCommandOutput> {
    const { Bucket, Delete } = input

    const bucket = globalBuckets.get(Bucket)
    if (!bucket) {
      throw new NoSuchBucket()
    }

    const deleted: DeleteObjectsCommandOutput['Deleted'] = []
    const errors: DeleteObjectsCommandOutput['Errors'] = []

    for (const obj of Delete.Objects) {
      try {
        bucket.objects.delete(obj.Key)
        if (!Delete.Quiet) {
          deleted.push({
            Key: obj.Key,
            VersionId: obj.VersionId,
          })
        }
      } catch (e) {
        errors.push({
          Key: obj.Key,
          VersionId: obj.VersionId,
          Code: 'InternalError',
          Message: (e as Error).message,
        })
      }
    }

    return {
      $metadata: createMetadata(200),
      Deleted: deleted,
      Errors: errors.length > 0 ? errors : undefined,
    }
  }
}

// ============================================================================
// AWS SIGNATURE V4 UTILITIES
// ============================================================================

/**
 * Convert a hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * SHA256 hash using Web Crypto API
 */
async function sha256(data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder()
  const dataBytes = typeof data === 'string' ? encoder.encode(data) : data
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes)
  return bytesToHex(new Uint8Array(hashBuffer))
}

/**
 * HMAC-SHA256 using Web Crypto API
 */
async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  return new Uint8Array(signature)
}

/**
 * Generate AWS Signature V4 signing key
 * kSecret = "AWS4" + secretAccessKey
 * kDate = HMAC-SHA256(kSecret, date)
 * kRegion = HMAC-SHA256(kDate, region)
 * kService = HMAC-SHA256(kRegion, service)
 * kSigning = HMAC-SHA256(kService, "aws4_request")
 */
async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const kSecret = encoder.encode('AWS4' + secretAccessKey)
  const kDate = await hmacSha256(kSecret, dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  return kSigning
}

/**
 * Format date as YYYYMMDD
 */
function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Format date as YYYYMMDDTHHMMSSZ (ISO8601 basic format)
 */
function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/**
 * URI encode a string for AWS Signature V4
 * AWS Signature V4 requires a specific encoding scheme
 */
function uriEncode(str: string, encodeSlash = true): string {
  let encoded = ''
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if (
      (char >= 'A' && char <= 'Z') ||
      (char >= 'a' && char <= 'z') ||
      (char >= '0' && char <= '9') ||
      char === '_' ||
      char === '-' ||
      char === '~' ||
      char === '.'
    ) {
      encoded += char
    } else if (char === '/' && !encodeSlash) {
      encoded += char
    } else {
      const charCode = char.charCodeAt(0)
      if (charCode < 128) {
        encoded += '%' + charCode.toString(16).toUpperCase().padStart(2, '0')
      } else {
        // Handle multi-byte UTF-8 characters
        const bytes = new TextEncoder().encode(char)
        for (const byte of bytes) {
          encoded += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
        }
      }
    }
  }
  return encoded
}

/**
 * AWS Signature V4 signing context
 */
interface SigningContext {
  accessKeyId: string
  secretAccessKey: string
  region: string
  service: string
  method: string
  host: string
  path: string
  queryParams: Record<string, string>
  signedHeaders: string[]
  date: Date
  expiresIn: number
}

/**
 * Create canonical request for AWS Signature V4
 */
async function createCanonicalRequest(ctx: SigningContext): Promise<string> {
  // Sort query parameters alphabetically
  const sortedParams = Object.keys(ctx.queryParams).sort()
  const canonicalQueryString = sortedParams
    .map((key) => `${uriEncode(key)}=${uriEncode(ctx.queryParams[key])}`)
    .join('&')

  // Create canonical headers
  const headers: Record<string, string> = {
    host: ctx.host,
  }
  const sortedHeaders = Object.keys(headers).sort()
  const canonicalHeaders = sortedHeaders.map((key) => `${key}:${headers[key]}\n`).join('')
  const signedHeadersStr = sortedHeaders.join(';')

  // For presigned URLs, the payload is UNSIGNED-PAYLOAD
  const hashedPayload = 'UNSIGNED-PAYLOAD'

  // Create canonical request
  const canonicalRequest = [
    ctx.method,
    ctx.path,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersStr,
    hashedPayload,
  ].join('\n')

  return canonicalRequest
}

/**
 * Create string to sign for AWS Signature V4
 */
async function createStringToSign(
  canonicalRequest: string,
  amzDate: string,
  credentialScope: string
): Promise<string> {
  const hashedCanonicalRequest = await sha256(canonicalRequest)
  return ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedCanonicalRequest].join('\n')
}

/**
 * Calculate AWS Signature V4 signature
 */
async function calculateSignature(signingKey: Uint8Array, stringToSign: string): Promise<string> {
  const signature = await hmacSha256(signingKey, stringToSign)
  return bytesToHex(signature)
}

// ============================================================================
// PRESIGNED URLS
// ============================================================================

/**
 * Generate a presigned URL for an S3 operation using AWS Signature V4
 */
export async function getSignedUrl(
  client: S3Client,
  command: GetObjectCommand | PutObjectCommand,
  options: GetSignedUrlOptions = {}
): Promise<string> {
  const { expiresIn = 3600 } = options
  const config = client.getConfig()
  const input = command.input as GetObjectCommandInput | PutObjectCommandInput
  const method = command._type === 'GetObject' ? 'GET' : 'PUT'

  // Get credentials
  let credentials: Credentials | undefined
  if (config.credentials) {
    if (typeof config.credentials === 'function') {
      credentials = await config.credentials()
    } else {
      credentials = config.credentials
    }
  }

  // Use default credentials if not provided
  const accessKeyId = credentials?.accessKeyId ?? 'AKIADEFAULT00000FAKE'
  const secretAccessKey = credentials?.secretAccessKey ?? 'DefaultSecretKeyForLocalDevelopment12345'
  const region = config.region ?? 'us-east-1'
  const service = 's3'

  // Current time
  const now = new Date()
  const dateStamp = formatDateStamp(now)
  const amzDate = formatAmzDate(now)

  // Build host and path based on forcePathStyle
  let host: string
  let path: string

  if (config.forcePathStyle) {
    host = `s3.${region}.amazonaws.com`
    // For path-style, don't encode slashes in the key path
    path = `/${input.Bucket}/${uriEncode(input.Key, false)}`
  } else {
    host = `${input.Bucket}.s3.${region}.amazonaws.com`
    // For virtual-hosted style, don't encode slashes in the key path
    path = `/${uriEncode(input.Key, false)}`
  }

  // Credential scope
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const credential = `${accessKeyId}/${credentialScope}`

  // Query parameters (in alphabetical order for canonical request)
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  }

  // Create signing context
  const ctx: SigningContext = {
    accessKeyId,
    secretAccessKey,
    region,
    service,
    method,
    host,
    path,
    queryParams,
    signedHeaders: ['host'],
    date: now,
    expiresIn,
  }

  // Create canonical request
  const canonicalRequest = await createCanonicalRequest(ctx)

  // Create string to sign
  const stringToSign = await createStringToSign(canonicalRequest, amzDate, credentialScope)

  // Get signing key
  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service)

  // Calculate signature
  const signature = await calculateSignature(signingKey, stringToSign)

  // Build final URL
  const url = new URL(`https://${host}${path}`)

  // Add query parameters in the order expected by AWS
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', credential)
  url.searchParams.set('X-Amz-Date', amzDate)
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  url.searchParams.set('X-Amz-SignedHeaders', 'host')
  url.searchParams.set('X-Amz-Signature', signature)

  return url.toString()
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clear all buckets (useful for testing)
 */
export function clearAllBuckets(): void {
  globalBuckets.clear()
}

/**
 * Get bucket count (useful for testing)
 */
export function getBucketCount(): number {
  return globalBuckets.size
}
