/**
 * @dotdo/s3/presign - Presigned URL Generation for S3-Compatible API
 *
 * Drop-in replacement for @aws-sdk/s3-request-presigner with enhanced features:
 * - AWS Signature V4 signing
 * - Configurable expiration times
 * - Custom header support in signatures
 * - Convenience methods for GET and PUT operations
 *
 * @example
 * ```typescript
 * import { S3Client, GetObjectCommand, PutObjectCommand } from '@dotdo/s3'
 * import { getSignedUrl, getSignedGetUrl, getSignedPutUrl } from '@dotdo/s3/presign'
 *
 * const client = new S3Client({ region: 'auto' })
 *
 * // Using command pattern (compatible with AWS SDK)
 * const getUrl = await getSignedUrl(client, new GetObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-file.txt',
 * }), { expiresIn: 3600 })
 *
 * // Convenience method for GET operations
 * const downloadUrl = await getSignedGetUrl(client, {
 *   bucket: 'my-bucket',
 *   key: 'my-file.txt',
 *   expiresIn: 3600,
 *   responseContentDisposition: 'attachment; filename="download.txt"',
 * })
 *
 * // Convenience method for PUT operations
 * const uploadUrl = await getSignedPutUrl(client, {
 *   bucket: 'my-bucket',
 *   key: 'upload.txt',
 *   contentType: 'text/plain',
 *   expiresIn: 3600,
 *   customHeaders: {
 *     'x-amz-meta-user': 'user123',
 *   },
 * })
 * ```
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/
 */

import type { S3Client } from './client'
import type { RequestPresigningArguments } from './types'
import {
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from './commands'

// =============================================================================
// Types
// =============================================================================

type PresignableCommand =
  | InstanceType<typeof GetObjectCommand>
  | InstanceType<typeof PutObjectCommand>
  | InstanceType<typeof HeadObjectCommand>
  | InstanceType<typeof DeleteObjectCommand>

/**
 * Options for generating presigned GET URLs
 */
export interface GetSignedUrlOptions {
  /** S3 bucket name */
  bucket: string
  /** Object key */
  key: string
  /** Expiration time in seconds (default: 900, max: 604800) */
  expiresIn?: number
  /** Sets Content-Disposition header for the response */
  responseContentDisposition?: string
  /** Sets Content-Type header for the response */
  responseContentType?: string
  /** Sets Cache-Control header for the response */
  responseCacheControl?: string
  /** Sets Content-Language header for the response */
  responseContentLanguage?: string
  /** Sets Content-Encoding header for the response */
  responseContentEncoding?: string
  /** Sets Expires header for the response */
  responseExpires?: Date
  /** Version ID for versioned objects */
  versionId?: string
  /** Custom headers to include in the signature */
  customHeaders?: Record<string, string>
}

/**
 * Options for generating presigned PUT URLs
 */
export interface PutSignedUrlOptions {
  /** S3 bucket name */
  bucket: string
  /** Object key */
  key: string
  /** Expiration time in seconds (default: 900, max: 604800) */
  expiresIn?: number
  /** Content-Type of the object to be uploaded */
  contentType?: string
  /** Content-Length of the object (optional, for size validation) */
  contentLength?: number
  /** Content-MD5 hash for integrity verification */
  contentMD5?: string
  /** Cache-Control header for the object */
  cacheControl?: string
  /** Content-Disposition header for the object */
  contentDisposition?: string
  /** Content-Encoding header for the object */
  contentEncoding?: string
  /** Content-Language header for the object */
  contentLanguage?: string
  /** Storage class for the object */
  storageClass?: string
  /** User-defined metadata (x-amz-meta-* headers) */
  metadata?: Record<string, string>
  /** Custom headers to include in the signature */
  customHeaders?: Record<string, string>
  /** ACL for the object */
  acl?: string
  /** Server-side encryption algorithm */
  serverSideEncryption?: 'AES256' | 'aws:kms'
  /** KMS key ID for server-side encryption */
  sseKmsKeyId?: string
}

// =============================================================================
// Constants
// =============================================================================

const AWS_ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
const AWS_REQUEST = 'aws4_request'
const DEFAULT_EXPIRY = 900 // 15 minutes (AWS SDK default)
const MAX_EXPIRY = 604800 // 7 days

// =============================================================================
// Utility Functions
// =============================================================================

async function hmacSHA256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const keyData =
    typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
}

async function sha256(message: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(message)
  )
  return arrayBufferToHex(hashBuffer)
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function getDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function getAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function uriEncode(str: string, encodeSlash = true): string {
  let encoded = encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')

  if (!encodeSlash) {
    encoded = encoded.replace(/%2F/gi, '/')
  }

  return encoded
}

// =============================================================================
// Signing Key Derivation
// =============================================================================

async function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSHA256(`AWS4${secretKey}`, dateStamp)
  const kRegion = await hmacSHA256(kDate, region)
  const kService = await hmacSHA256(kRegion, SERVICE)
  return hmacSHA256(kService, AWS_REQUEST)
}

// =============================================================================
// Extract Command Info
// =============================================================================

function getCommandInfo(command: PresignableCommand): {
  method: string
  bucket: string
  key: string
  contentType?: string
} {
  const input = command.input as {
    Bucket: string
    Key: string
    ContentType?: string
  }

  // Determine HTTP method based on command type
  let method = 'GET'
  const commandName = command.constructor.name

  if (commandName === 'PutObjectCommand') {
    method = 'PUT'
  } else if (commandName === 'DeleteObjectCommand') {
    method = 'DELETE'
  } else if (commandName === 'HeadObjectCommand') {
    method = 'HEAD'
  }

  return {
    method,
    bucket: input.Bucket,
    key: input.Key,
    contentType: input.ContentType,
  }
}

// =============================================================================
// Extended Presigning Arguments with Custom Headers
// =============================================================================

export interface ExtendedPresigningArguments extends RequestPresigningArguments {
  /** Custom headers to include in the signature */
  customHeaders?: Record<string, string>
  /** Additional query parameters to include */
  queryParams?: Record<string, string>
}

// =============================================================================
// Core Presigning Function
// =============================================================================

interface PresignOptions {
  method: string
  bucket: string
  key: string
  expiresIn: number
  region: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  headers?: Record<string, string>
  queryParams?: Record<string, string>
}

async function createPresignedUrl(options: PresignOptions): Promise<string> {
  const {
    method,
    bucket,
    key,
    expiresIn,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    headers = {},
    queryParams = {},
  } = options

  const now = new Date()
  const dateStamp = getDateStamp(now)
  const amzDate = getAmzDate(now)
  const credential = `${accessKeyId}/${dateStamp}/${region}/${SERVICE}/${AWS_REQUEST}`

  // Build canonical URI
  const canonicalUri = `/${bucket}/${uriEncode(key, false)}`

  // Get host from endpoint
  const host = new URL(endpoint).host

  // Build headers map with host always included
  const allHeaders: Record<string, string> = {
    host,
    ...Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    ),
  }

  // Sort headers and build signed headers string
  const sortedHeaderNames = Object.keys(allHeaders).sort()
  const signedHeaders = sortedHeaderNames.join(';')

  // Build canonical headers string
  const canonicalHeaders =
    sortedHeaderNames.map((name) => `${name}:${allHeaders[name].trim()}`).join('\n') + '\n'

  // Build query parameters
  const params: Record<string, string> = {
    'X-Amz-Algorithm': AWS_ALGORITHM,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn.toString(),
    'X-Amz-SignedHeaders': signedHeaders,
    ...queryParams,
  }

  // Sort and encode query string
  const sortedParams = Object.keys(params).sort()
  const canonicalQueryString = sortedParams
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&')

  // For presigned URLs, payload is UNSIGNED-PAYLOAD
  const payloadHash = 'UNSIGNED-PAYLOAD'

  // Build canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  // Create string to sign
  const canonicalRequestHash = await sha256(canonicalRequest)
  const scope = `${dateStamp}/${region}/${SERVICE}/${AWS_REQUEST}`
  const stringToSign = [AWS_ALGORITHM, amzDate, scope, canonicalRequestHash].join('\n')

  // Calculate signature
  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region)
  const signatureBuffer = await hmacSHA256(signingKey, stringToSign)
  const signature = arrayBufferToHex(signatureBuffer)

  // Build final URL
  const signedUrl = new URL(`${endpoint}${canonicalUri}`)
  for (const [k, v] of Object.entries(params)) {
    signedUrl.searchParams.set(k, v)
  }
  signedUrl.searchParams.set('X-Amz-Signature', signature)

  return signedUrl.toString()
}

// =============================================================================
// Main getSignedUrl Function (AWS SDK Compatible)
// =============================================================================

/**
 * Generate a presigned URL for an S3 operation
 *
 * @param client - The S3Client instance
 * @param command - The command to presign (GetObjectCommand, PutObjectCommand, etc.)
 * @param options - Presigning options including expiration and custom headers
 * @returns A presigned URL string
 *
 * @example
 * ```typescript
 * const url = await getSignedUrl(client, new GetObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-file.txt',
 * }), { expiresIn: 3600 })
 * ```
 */
export async function getSignedUrl(
  client: S3Client,
  command: PresignableCommand,
  options: ExtendedPresigningArguments = {}
): Promise<string> {
  // Determine expiration
  let expiresIn = options.expiresIn ?? DEFAULT_EXPIRY

  if (options.expiresAt) {
    expiresIn = Math.floor((options.expiresAt.getTime() - Date.now()) / 1000)
  }

  if (expiresIn > MAX_EXPIRY) {
    throw new Error(`Expiry cannot exceed ${MAX_EXPIRY} seconds (7 days)`)
  }

  if (expiresIn <= 0) {
    throw new Error('Expiry must be a positive number')
  }

  // Get command details
  const { method, bucket, key, contentType } = getCommandInfo(command)

  // Get client config
  const config = client.config || {}
  const region = config.region || 'us-east-1'
  const endpoint = config.endpoint || `https://s3.${region}.amazonaws.com`
  const accessKeyId = config.credentials?.accessKeyId || 'AKIAEXAMPLE'
  const secretAccessKey = config.credentials?.secretAccessKey || 'EXAMPLEKEY'

  // Build headers including content-type for PUT
  const headers: Record<string, string> = {}
  if (method === 'PUT' && contentType) {
    headers['content-type'] = contentType
  }

  // Add custom headers if provided (merge with existing)
  if (options.customHeaders) {
    Object.assign(headers, options.customHeaders)
  }

  return createPresignedUrl({
    method,
    bucket,
    key,
    expiresIn,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    queryParams: options.queryParams,
  })
}

// =============================================================================
// Convenience Methods
// =============================================================================

/**
 * Generate a presigned URL for GET (download) operations
 *
 * @param client - The S3Client instance
 * @param options - Options including bucket, key, expiration, and response overrides
 * @returns A presigned URL string for downloading the object
 *
 * @example
 * ```typescript
 * const downloadUrl = await getSignedGetUrl(client, {
 *   bucket: 'my-bucket',
 *   key: 'my-file.txt',
 *   expiresIn: 3600,
 *   responseContentDisposition: 'attachment; filename="download.txt"',
 * })
 * ```
 */
export async function getSignedGetUrl(
  client: S3Client,
  options: GetSignedUrlOptions
): Promise<string> {
  const config = client.config || {}
  const region = config.region || 'us-east-1'
  const endpoint = config.endpoint || `https://s3.${region}.amazonaws.com`
  const accessKeyId = config.credentials?.accessKeyId || 'AKIAEXAMPLE'
  const secretAccessKey = config.credentials?.secretAccessKey || 'EXAMPLEKEY'

  const expiresIn = options.expiresIn ?? DEFAULT_EXPIRY
  if (expiresIn > MAX_EXPIRY) {
    throw new Error(`Expiry cannot exceed ${MAX_EXPIRY} seconds (7 days)`)
  }
  if (expiresIn <= 0) {
    throw new Error('Expiry must be a positive number')
  }

  // Build query params for response overrides
  const queryParams: Record<string, string> = {}
  if (options.responseContentDisposition) {
    queryParams['response-content-disposition'] = options.responseContentDisposition
  }
  if (options.responseContentType) {
    queryParams['response-content-type'] = options.responseContentType
  }
  if (options.responseCacheControl) {
    queryParams['response-cache-control'] = options.responseCacheControl
  }
  if (options.responseContentLanguage) {
    queryParams['response-content-language'] = options.responseContentLanguage
  }
  if (options.responseContentEncoding) {
    queryParams['response-content-encoding'] = options.responseContentEncoding
  }
  if (options.responseExpires) {
    queryParams['response-expires'] = options.responseExpires.toUTCString()
  }
  if (options.versionId) {
    queryParams['versionId'] = options.versionId
  }

  return createPresignedUrl({
    method: 'GET',
    bucket: options.bucket,
    key: options.key,
    expiresIn,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    headers: options.customHeaders,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  })
}

/**
 * Generate a presigned URL for PUT (upload) operations
 *
 * @param client - The S3Client instance
 * @param options - Options including bucket, key, expiration, content-type, and metadata
 * @returns A presigned URL string for uploading an object
 *
 * @example
 * ```typescript
 * const uploadUrl = await getSignedPutUrl(client, {
 *   bucket: 'my-bucket',
 *   key: 'upload.txt',
 *   contentType: 'text/plain',
 *   expiresIn: 3600,
 *   metadata: {
 *     'user-id': 'user123',
 *   },
 * })
 *
 * // Use the URL to upload
 * await fetch(uploadUrl, {
 *   method: 'PUT',
 *   body: 'Hello World',
 *   headers: {
 *     'Content-Type': 'text/plain',
 *     'x-amz-meta-user-id': 'user123',
 *   },
 * })
 * ```
 */
export async function getSignedPutUrl(
  client: S3Client,
  options: PutSignedUrlOptions
): Promise<string> {
  const config = client.config || {}
  const region = config.region || 'us-east-1'
  const endpoint = config.endpoint || `https://s3.${region}.amazonaws.com`
  const accessKeyId = config.credentials?.accessKeyId || 'AKIAEXAMPLE'
  const secretAccessKey = config.credentials?.secretAccessKey || 'EXAMPLEKEY'

  const expiresIn = options.expiresIn ?? DEFAULT_EXPIRY
  if (expiresIn > MAX_EXPIRY) {
    throw new Error(`Expiry cannot exceed ${MAX_EXPIRY} seconds (7 days)`)
  }
  if (expiresIn <= 0) {
    throw new Error('Expiry must be a positive number')
  }

  // Build headers for the PUT request
  const headers: Record<string, string> = {}

  if (options.contentType) {
    headers['content-type'] = options.contentType
  }
  if (options.contentLength !== undefined) {
    headers['content-length'] = options.contentLength.toString()
  }
  if (options.contentMD5) {
    headers['content-md5'] = options.contentMD5
  }
  if (options.cacheControl) {
    headers['cache-control'] = options.cacheControl
  }
  if (options.contentDisposition) {
    headers['content-disposition'] = options.contentDisposition
  }
  if (options.contentEncoding) {
    headers['content-encoding'] = options.contentEncoding
  }
  if (options.contentLanguage) {
    headers['content-language'] = options.contentLanguage
  }
  if (options.acl) {
    headers['x-amz-acl'] = options.acl
  }
  if (options.storageClass) {
    headers['x-amz-storage-class'] = options.storageClass
  }
  if (options.serverSideEncryption) {
    headers['x-amz-server-side-encryption'] = options.serverSideEncryption
  }
  if (options.sseKmsKeyId) {
    headers['x-amz-server-side-encryption-aws-kms-key-id'] = options.sseKmsKeyId
  }

  // Add user metadata (x-amz-meta-* headers)
  if (options.metadata) {
    for (const [key, value] of Object.entries(options.metadata)) {
      headers[`x-amz-meta-${key.toLowerCase()}`] = value
    }
  }

  // Add custom headers
  if (options.customHeaders) {
    Object.assign(headers, options.customHeaders)
  }

  return createPresignedUrl({
    method: 'PUT',
    bucket: options.bucket,
    key: options.key,
    expiresIn,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  })
}

/**
 * Generate a presigned URL for DELETE operations
 *
 * @param client - The S3Client instance
 * @param options - Options including bucket, key, and expiration
 * @returns A presigned URL string for deleting an object
 *
 * @example
 * ```typescript
 * const deleteUrl = await getSignedDeleteUrl(client, {
 *   bucket: 'my-bucket',
 *   key: 'file-to-delete.txt',
 *   expiresIn: 300,
 * })
 *
 * // Use the URL to delete
 * await fetch(deleteUrl, { method: 'DELETE' })
 * ```
 */
export async function getSignedDeleteUrl(
  client: S3Client,
  options: {
    bucket: string
    key: string
    expiresIn?: number
    versionId?: string
    customHeaders?: Record<string, string>
  }
): Promise<string> {
  const config = client.config || {}
  const region = config.region || 'us-east-1'
  const endpoint = config.endpoint || `https://s3.${region}.amazonaws.com`
  const accessKeyId = config.credentials?.accessKeyId || 'AKIAEXAMPLE'
  const secretAccessKey = config.credentials?.secretAccessKey || 'EXAMPLEKEY'

  const expiresIn = options.expiresIn ?? DEFAULT_EXPIRY
  if (expiresIn > MAX_EXPIRY) {
    throw new Error(`Expiry cannot exceed ${MAX_EXPIRY} seconds (7 days)`)
  }
  if (expiresIn <= 0) {
    throw new Error('Expiry must be a positive number')
  }

  const queryParams: Record<string, string> = {}
  if (options.versionId) {
    queryParams['versionId'] = options.versionId
  }

  return createPresignedUrl({
    method: 'DELETE',
    bucket: options.bucket,
    key: options.key,
    expiresIn,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    headers: options.customHeaders,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  })
}

/**
 * Generate a presigned URL for HEAD operations
 *
 * @param client - The S3Client instance
 * @param options - Options including bucket, key, and expiration
 * @returns A presigned URL string for checking object metadata
 *
 * @example
 * ```typescript
 * const headUrl = await getSignedHeadUrl(client, {
 *   bucket: 'my-bucket',
 *   key: 'file.txt',
 *   expiresIn: 300,
 * })
 *
 * // Use the URL to check metadata
 * const response = await fetch(headUrl, { method: 'HEAD' })
 * console.log(response.headers.get('content-length'))
 * ```
 */
export async function getSignedHeadUrl(
  client: S3Client,
  options: {
    bucket: string
    key: string
    expiresIn?: number
    versionId?: string
    customHeaders?: Record<string, string>
  }
): Promise<string> {
  const config = client.config || {}
  const region = config.region || 'us-east-1'
  const endpoint = config.endpoint || `https://s3.${region}.amazonaws.com`
  const accessKeyId = config.credentials?.accessKeyId || 'AKIAEXAMPLE'
  const secretAccessKey = config.credentials?.secretAccessKey || 'EXAMPLEKEY'

  const expiresIn = options.expiresIn ?? DEFAULT_EXPIRY
  if (expiresIn > MAX_EXPIRY) {
    throw new Error(`Expiry cannot exceed ${MAX_EXPIRY} seconds (7 days)`)
  }
  if (expiresIn <= 0) {
    throw new Error('Expiry must be a positive number')
  }

  const queryParams: Record<string, string> = {}
  if (options.versionId) {
    queryParams['versionId'] = options.versionId
  }

  return createPresignedUrl({
    method: 'HEAD',
    bucket: options.bucket,
    key: options.key,
    expiresIn,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    headers: options.customHeaders,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  })
}

// =============================================================================
// Re-export for backward compatibility
// =============================================================================

export type { RequestPresigningArguments }
