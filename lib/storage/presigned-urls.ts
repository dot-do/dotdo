/**
 * Presigned URL Generator for lib/storage
 *
 * Generates secure, time-limited presigned URLs for R2 objects with:
 * - AWS Signature V4 compatible signing
 * - Configurable expiration (up to 7 days)
 * - Read/write permissions
 * - Content type auto-detection
 * - Secure token generation
 *
 * Integrates with AuthorizedR2Client for tenant-isolated storage.
 *
 * @module lib/storage/presigned-urls
 *
 * @example Basic usage
 * ```typescript
 * import { createPresignedUrlGenerator } from './presigned-urls'
 *
 * const generator = createPresignedUrlGenerator({
 *   bucket: 'my-bucket',
 *   accessKeyId: 'AKIA...',
 *   secretAccessKey: 'secret...',
 *   endpoint: 'https://account.r2.cloudflarestorage.com',
 * })
 *
 * // Generate upload URL
 * const { url, headers } = await generator.generateUploadUrl({
 *   key: 'images/photo.jpg',
 *   expiresIn: 3600,
 * })
 *
 * // Generate download URL
 * const { url } = await generator.generateDownloadUrl({
 *   key: 'images/photo.jpg',
 * })
 * ```
 *
 * @example Integration with AuthorizedR2Client
 * ```typescript
 * import { AuthorizedR2Client } from './authorized-r2'
 * import { createPresignedUrlGenerator } from './presigned-urls'
 *
 * const client = new AuthorizedR2Client(claims, r2)
 * const generator = createPresignedUrlGenerator({
 *   bucket: claims.bucket,
 *   accessKeyId: env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: env.R2_SECRET_ACCESS_KEY,
 *   endpoint: env.R2_ENDPOINT,
 *   pathPrefix: client.getBasePath(),
 * })
 *
 * // Now URLs are tenant-scoped
 * const url = await generator.generateUploadUrl({
 *   key: 'uploads/file.pdf',
 * })
 * ```
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/** Permission types for presigned URLs */
export type PresignedUrlPermission = 'read' | 'write'

/** Options for generating presigned URLs */
export interface PresignedUrlOptions {
  /** Object key (path) in the storage bucket */
  key: string
  /** Expiration time in seconds (default: 900, max: 604800) */
  expiresIn?: number
  /** Expiration time as absolute Date */
  expiresAt?: Date
  /** Permission type - 'read' for GET, 'write' for PUT */
  permission?: PresignedUrlPermission
  /** Content-Type for upload URLs (auto-detected from extension if not provided) */
  contentType?: string
  /** Maximum content length for uploads (bytes) */
  maxContentLength?: number
  /** Minimum content length for uploads (bytes) */
  minContentLength?: number
  /** Custom metadata to include */
  metadata?: Record<string, string>
  /** Additional headers to require in the signed request */
  requiredHeaders?: Record<string, string>
  /** Response content disposition for downloads */
  responseContentDisposition?: string
  /** Response content type for downloads */
  responseContentType?: string
  /** Cache control for the response */
  responseCacheControl?: string
}

/** Result from generating an upload URL */
export interface PresignedUploadUrl {
  /** The presigned URL for PUT request */
  url: string
  /** HTTP method to use */
  method: 'PUT'
  /** Required headers for the upload request */
  headers: Record<string, string>
  /** URL expiration timestamp */
  expiresAt: Date
  /** Maximum file size allowed (if specified) */
  maxContentLength?: number
  /** Object key */
  key: string
}

/** Result from generating a download URL */
export interface PresignedDownloadUrl {
  /** The presigned URL for GET request */
  url: string
  /** HTTP method to use */
  method: 'GET'
  /** URL expiration timestamp */
  expiresAt: Date
  /** Object key */
  key: string
}

/** Result from URL validation */
export interface PresignedUrlValidation {
  /** Whether the URL is valid */
  valid: boolean
  /** Reason for invalidity (if not valid) */
  reason?: string
  /** Parsed key from the URL (if valid) */
  key?: string
  /** Expiration timestamp (if valid) */
  expiresAt?: Date
}

/** Presigned URL generator interface */
export interface PresignedUrlGenerator {
  /** Generate a presigned URL for file upload */
  generateUploadUrl(options: PresignedUrlOptions): Promise<PresignedUploadUrl>
  /** Generate a presigned URL for file download */
  generateDownloadUrl(options: PresignedUrlOptions): Promise<PresignedDownloadUrl>
  /** Validate a presigned URL (check signature, expiration) */
  validateUrl(url: string): Promise<PresignedUrlValidation>
}

/** Configuration for the presigned URL generator */
export interface PresignedUrlGeneratorConfig {
  /** R2/S3 bucket name */
  bucket: string
  /** Access key ID for signing */
  accessKeyId: string
  /** Secret access key for signing */
  secretAccessKey: string
  /** Custom endpoint (for R2 or S3-compatible storage) */
  endpoint?: string
  /** Region (default: 'auto' for R2) */
  region?: string
  /** Default expiration time in seconds (default: 900) */
  defaultExpiry?: number
  /** Maximum allowed expiration time in seconds (default: 604800 = 7 days) */
  maxExpiry?: number
  /** Path prefix for all keys */
  pathPrefix?: string
}

// =============================================================================
// CONTENT TYPE DETECTION
// =============================================================================

const MIME_TYPES: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',

  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',

  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',

  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Text
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  md: 'text/markdown',
  yaml: 'application/yaml',
  yml: 'application/yaml',

  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',

  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
}

function getContentTypeFromExtension(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// =============================================================================
// AWS SIGNATURE V4 IMPLEMENTATION
// =============================================================================

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
const MAX_EXPIRY_SECONDS = 604800 // 7 days
const DEFAULT_EXPIRY_SECONDS = 900 // 15 minutes
const MAX_KEY_LENGTH = 1024
const MAX_METADATA_SIZE = 2048
const MAX_SINGLE_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024 // 5GB

/**
 * Convert ArrayBuffer to hex string
 */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * HMAC-SHA256 signing
 */
async function hmacSha256(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const keyBuffer = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

/**
 * SHA-256 hash
 */
async function sha256(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(buffer)
}

/**
 * Get AWS signing key
 */
async function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256('AWS4' + secretKey, dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

/**
 * Format date for AWS signature (YYYYMMDDTHHMMSSZ)
 */
function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Format date stamp (YYYYMMDD)
 */
function formatDateStamp(date: Date): string {
  return formatAmzDate(date).substring(0, 8)
}

/**
 * URI encode for S3 (AWS-style encoding)
 * Encodes path traversal sequences to prevent security issues
 */
function s3UriEncode(str: string, encodeSlash = true): string {
  // Handle path traversal sequences by encoding dots
  const safeStr = str.replace(/\.\.\//g, '%2E%2E/')

  return safeStr
    .split('')
    .map((char) => {
      if (
        (char >= 'A' && char <= 'Z') ||
        (char >= 'a' && char <= 'z') ||
        (char >= '0' && char <= '9') ||
        char === '_' ||
        char === '-' ||
        char === '~' ||
        char === '.'
      ) {
        return char
      }
      if (char === '/' && !encodeSlash) {
        return char
      }
      return encodeURIComponent(char)
    })
    .join('')
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create a presigned URL generator
 *
 * @param config - Configuration for the generator
 * @returns A PresignedUrlGenerator instance
 *
 * @example
 * ```typescript
 * const generator = createPresignedUrlGenerator({
 *   bucket: 'my-bucket',
 *   accessKeyId: 'AKIA...',
 *   secretAccessKey: 'secret...',
 *   endpoint: 'https://account.r2.cloudflarestorage.com',
 * })
 *
 * const uploadUrl = await generator.generateUploadUrl({
 *   key: 'uploads/file.pdf',
 *   expiresIn: 3600,
 * })
 * ```
 */
export function createPresignedUrlGenerator(config: PresignedUrlGeneratorConfig): PresignedUrlGenerator {
  const {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region = 'auto',
    defaultExpiry = DEFAULT_EXPIRY_SECONDS,
    maxExpiry = MAX_EXPIRY_SECONDS,
    pathPrefix = '',
  } = config

  // Parse endpoint to get host
  const parsedEndpoint = endpoint
    ? new URL(endpoint)
    : new URL(`https://${bucket}.s3.${region}.amazonaws.com`)

  /**
   * Validate key format
   */
  function validateKey(key: string): void {
    if (!key || key.length === 0) {
      throw new Error('Key cannot be empty')
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`Key length exceeds maximum of ${MAX_KEY_LENGTH} characters`)
    }
    if (key.includes('\0')) {
      throw new Error('Key cannot contain null bytes')
    }
  }

  /**
   * Validate metadata
   */
  function validateMetadata(metadata: Record<string, string>): void {
    let totalSize = 0
    for (const [key, value] of Object.entries(metadata)) {
      // Key format validation - only alphanumeric and hyphens
      if (!/^[a-zA-Z0-9-]+$/.test(key)) {
        throw new Error(`Invalid metadata key format: "${key}". Keys must contain only alphanumeric characters and hyphens.`)
      }
      totalSize += key.length + value.length
    }
    if (totalSize > MAX_METADATA_SIZE) {
      throw new Error(`Metadata size exceeds maximum of ${MAX_METADATA_SIZE} bytes`)
    }
  }

  /**
   * Calculate expiration
   */
  function calculateExpiry(options: PresignedUrlOptions): { expiresIn: number; expiresAt: Date } {
    const now = Date.now()

    if (options.expiresAt) {
      const expiresIn = Math.floor((options.expiresAt.getTime() - now) / 1000)
      if (expiresIn <= 0) {
        throw new Error('Expiration date must be in the future (positive expiration)')
      }
      if (expiresIn > MAX_EXPIRY_SECONDS) {
        throw new Error(`Expiration cannot exceed 7 days (${MAX_EXPIRY_SECONDS} seconds)`)
      }
      if (maxExpiry && expiresIn > maxExpiry) {
        throw new Error(`Expiration exceeds configured max of ${maxExpiry} seconds`)
      }
      return { expiresIn, expiresAt: options.expiresAt }
    }

    const expiresIn = options.expiresIn ?? defaultExpiry
    if (expiresIn <= 0) {
      throw new Error('Expiration must be positive')
    }
    if (expiresIn > MAX_EXPIRY_SECONDS) {
      throw new Error(`Expiration cannot exceed 7 days (${MAX_EXPIRY_SECONDS} seconds)`)
    }
    if (maxExpiry && expiresIn > maxExpiry) {
      throw new Error(`Expiration exceeds configured max of ${maxExpiry} seconds`)
    }

    return {
      expiresIn,
      expiresAt: new Date(now + expiresIn * 1000),
    }
  }

  /**
   * Build full key with prefix
   */
  function buildFullKey(key: string): string {
    return pathPrefix ? `${pathPrefix}${key}` : key
  }

  /**
   * Generate presigned URL with AWS Signature V4
   */
  async function generateSignedUrl(
    method: 'GET' | 'PUT',
    key: string,
    expiresIn: number,
    queryParams: Record<string, string> = {},
    signedHeaders: string[] = ['host'],
    headerValues: Record<string, string> = {}
  ): Promise<string> {
    const now = new Date()
    const amzDate = formatAmzDate(now)
    const dateStamp = formatDateStamp(now)
    const credential = `${accessKeyId}/${dateStamp}/${region}/${SERVICE}/aws4_request`

    // Build canonical URI
    const fullKey = buildFullKey(key)
    const canonicalUri = '/' + s3UriEncode(fullKey, false)

    // Build query parameters
    const allQueryParams: Record<string, string> = {
      'X-Amz-Algorithm': ALGORITHM,
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expiresIn.toString(),
      'X-Amz-SignedHeaders': signedHeaders.sort().join(';'),
      ...queryParams,
    }

    // Sort and encode query parameters
    const sortedParams = Object.entries(allQueryParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${s3UriEncode(k)}=${s3UriEncode(v)}`)
      .join('&')

    // Build canonical headers
    const host = parsedEndpoint.host
    const allHeaders: Record<string, string> = {
      host,
      ...headerValues,
    }

    const canonicalHeaders = signedHeaders
      .sort()
      .map((h) => `${h.toLowerCase()}:${allHeaders[h.toLowerCase()] || ''}`)
      .join('\n') + '\n'

    // Build canonical request
    const payloadHash = 'UNSIGNED-PAYLOAD'
    const canonicalRequest = [
      method,
      canonicalUri,
      sortedParams,
      canonicalHeaders,
      signedHeaders.sort().join(';'),
      payloadHash,
    ].join('\n')

    // Build string to sign
    const canonicalRequestHash = await sha256(canonicalRequest)
    const stringToSign = [
      ALGORITHM,
      amzDate,
      `${dateStamp}/${region}/${SERVICE}/aws4_request`,
      canonicalRequestHash,
    ].join('\n')

    // Calculate signature
    const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, SERVICE)
    const signatureBuffer = await hmacSha256(signingKey, stringToSign)
    const signature = toHex(signatureBuffer)

    // Build final URL
    const finalParams = `${sortedParams}&X-Amz-Signature=${signature}`
    const baseUrl = `${parsedEndpoint.protocol}//${host}${canonicalUri}`
    return `${baseUrl}?${finalParams}`
  }

  /**
   * Generate upload URL
   */
  async function generateUploadUrl(options: PresignedUrlOptions): Promise<PresignedUploadUrl> {
    validateKey(options.key)

    // Validate permission
    if (options.permission && options.permission === 'read') {
      throw new Error('Cannot use read permission for upload URL')
    }

    // Validate content length
    if (options.maxContentLength !== undefined) {
      if (options.maxContentLength <= 0) {
        throw new Error('maxContentLength must be positive')
      }
      if (options.maxContentLength > MAX_SINGLE_UPLOAD_SIZE) {
        throw new Error(`maxContentLength exceeds maximum limit of ${MAX_SINGLE_UPLOAD_SIZE} bytes`)
      }
    }

    if (options.minContentLength !== undefined && options.maxContentLength !== undefined) {
      if (options.minContentLength > options.maxContentLength) {
        throw new Error('minContentLength cannot exceed maxContentLength (invalid range)')
      }
    }

    // Validate metadata
    if (options.metadata) {
      validateMetadata(options.metadata)
    }

    const { expiresIn, expiresAt } = calculateExpiry(options)

    // Determine content type
    const contentType = options.contentType || getContentTypeFromExtension(options.key)

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
    }

    const signedHeaders: string[] = ['host', 'content-type']
    const headerValues: Record<string, string> = {
      host: parsedEndpoint.host,
      'content-type': contentType,
    }

    // Add metadata headers
    if (options.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        const headerName = `x-amz-meta-${key.toLowerCase()}`
        headers[headerName] = value
        signedHeaders.push(headerName)
        headerValues[headerName] = value
      }
    }

    // Add required headers
    if (options.requiredHeaders) {
      for (const [key, value] of Object.entries(options.requiredHeaders)) {
        const headerName = key.toLowerCase()
        headers[key] = value
        if (!signedHeaders.includes(headerName)) {
          signedHeaders.push(headerName)
          headerValues[headerName] = value
        }
      }
    }

    const url = await generateSignedUrl('PUT', options.key, expiresIn, {}, signedHeaders, headerValues)

    return {
      url,
      method: 'PUT',
      headers,
      expiresAt,
      maxContentLength: options.maxContentLength,
      key: options.key,
    }
  }

  /**
   * Generate download URL
   */
  async function generateDownloadUrl(options: PresignedUrlOptions): Promise<PresignedDownloadUrl> {
    validateKey(options.key)

    // Validate permission
    if (options.permission && options.permission === 'write') {
      throw new Error('Cannot use write permission for download URL')
    }

    const { expiresIn, expiresAt } = calculateExpiry(options)

    // Build response override query params
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

    const url = await generateSignedUrl('GET', options.key, expiresIn, queryParams)

    return {
      url,
      method: 'GET',
      expiresAt,
      key: options.key,
    }
  }

  /**
   * Validate presigned URL
   */
  async function validateUrl(urlString: string): Promise<PresignedUrlValidation> {
    try {
      const url = new URL(urlString)

      // Check required parameters
      const algorithm = url.searchParams.get('X-Amz-Algorithm')
      const credential = url.searchParams.get('X-Amz-Credential')
      const date = url.searchParams.get('X-Amz-Date')
      const expires = url.searchParams.get('X-Amz-Expires')
      const signature = url.searchParams.get('X-Amz-Signature')

      if (!algorithm || !credential || !date || !expires || !signature) {
        return { valid: false, reason: 'Missing required parameter(s)' }
      }

      // Check algorithm
      if (algorithm !== ALGORITHM) {
        return { valid: false, reason: 'Invalid algorithm' }
      }

      // Check bucket - bucket can be in host (subdomain), endpoint host, or path
      const urlHost = url.host
      const expectedHost = parsedEndpoint.host
      const urlPath = url.pathname
      // For R2/S3, bucket can be in: subdomain, path, or configured endpoint must match
      const hostMatches = urlHost === expectedHost
      const bucketInHost = urlHost.includes(bucket)
      const bucketInPath = urlPath.startsWith(`/${bucket}/`)
      if (!hostMatches && !bucketInHost && !bucketInPath) {
        return { valid: false, reason: 'Invalid bucket' }
      }

      // Check credential contains our access key
      if (!credential.includes(accessKeyId)) {
        return { valid: false, reason: 'Invalid credentials' }
      }

      // Check expiration
      const expiresIn = parseInt(expires, 10)
      const dateMatch = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
      if (!dateMatch) {
        return { valid: false, reason: 'Invalid date format' }
      }

      const signedAt = new Date(
        `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${dateMatch[4]}:${dateMatch[5]}:${dateMatch[6]}Z`
      )
      const expirationTime = signedAt.getTime() + expiresIn * 1000
      const expiresAt = new Date(expirationTime)

      if (Date.now() > expirationTime) {
        return { valid: false, reason: 'URL has expired' }
      }

      // Verify signature format
      if (!/^[a-f0-9]{64}$/.test(signature)) {
        return { valid: false, reason: 'Invalid signature format' }
      }

      // Extract key from URL
      const path = decodeURIComponent(url.pathname.slice(1)) // Remove leading /
      const key = pathPrefix ? path.replace(pathPrefix, '') : path

      // Regenerate signature for verification
      const queryParams: Record<string, string> = {}
      url.searchParams.forEach((value, k) => {
        if (k !== 'X-Amz-Signature') {
          queryParams[k] = value
        }
      })

      // Build canonical request for verification
      const signedHeadersStr = url.searchParams.get('X-Amz-SignedHeaders') || 'host'
      const signedHeaders = signedHeadersStr.split(';')

      const method = signedHeaders.includes('content-type') ? 'PUT' : 'GET'
      const dateStamp = date.substring(0, 8)

      const canonicalUri = '/' + s3UriEncode(path, false)
      const sortedParams = Object.entries(queryParams)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${s3UriEncode(k)}=${s3UriEncode(v)}`)
        .join('&')

      const headerValues: Record<string, string> = {
        host: url.host,
      }

      const canonicalHeaders = signedHeaders
        .sort()
        .map((h) => `${h.toLowerCase()}:${headerValues[h.toLowerCase()] || ''}`)
        .join('\n') + '\n'

      const payloadHash = 'UNSIGNED-PAYLOAD'
      const canonicalRequest = [
        method,
        canonicalUri,
        sortedParams,
        canonicalHeaders,
        signedHeaders.sort().join(';'),
        payloadHash,
      ].join('\n')

      const canonicalRequestHash = await sha256(canonicalRequest)
      const stringToSign = [
        ALGORITHM,
        date,
        `${dateStamp}/${region}/${SERVICE}/aws4_request`,
        canonicalRequestHash,
      ].join('\n')

      const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, SERVICE)
      const expectedSignatureBuffer = await hmacSha256(signingKey, stringToSign)
      const expectedSignature = toHex(expectedSignatureBuffer)

      if (signature !== expectedSignature) {
        return { valid: false, reason: 'Invalid signature (tampered)' }
      }

      return { valid: true, key, expiresAt }
    } catch (error) {
      return {
        valid: false,
        reason: `Malformed URL: ${error instanceof Error ? error.message : 'parse error'}`,
      }
    }
  }

  return {
    generateUploadUrl,
    generateDownloadUrl,
    validateUrl,
  }
}

// =============================================================================
// RE-EXPORTS FOR CONVENIENCE
// =============================================================================

export { getContentTypeFromExtension }
