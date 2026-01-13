/**
 * @dotdo/gcs/signed-url - Signed URL Generation
 *
 * Google Cloud Storage compatible signed URL generation for secure
 * time-limited access to private resources.
 *
 * @example
 * ```typescript
 * import { generateSignedUrl } from '@dotdo/gcs/signed-url'
 *
 * // Generate a read URL
 * const [url] = await file.getSignedUrl({
 *   action: 'read',
 *   expires: Date.now() + 15 * 60 * 1000,
 * })
 *
 * // Generate a write URL
 * const [uploadUrl] = await file.getSignedUrl({
 *   action: 'write',
 *   expires: Date.now() + 60 * 60 * 1000,
 *   contentType: 'application/pdf',
 * })
 * ```
 */

import type { SignedUrlConfig, GenerateSignedPostPolicyV4Options, SignedPostPolicyV4 } from './types'
import type { Storage } from './client'
import { BadRequestError, InvalidArgumentError } from './errors'

// =============================================================================
// Constants
// =============================================================================

const GOOG_ALGORITHM_V4 = 'GOOG4-RSA-SHA256'
const GOOG_ALGORITHM_V2 = 'GOOG-RSA-SHA256'
const MAX_EXPIRY_V4 = 7 * 24 * 60 * 60 // 7 days in seconds
const MAX_EXPIRY_V2 = 7 * 24 * 60 * 60 // 7 days in seconds
const DEFAULT_EXPIRY = 15 * 60 // 15 minutes in seconds

// =============================================================================
// URL Generation
// =============================================================================

/**
 * Generate a signed URL for a GCS object
 */
export async function generateSignedUrl(
  bucketName: string,
  objectName: string,
  config: SignedUrlConfig,
  storage: Storage
): Promise<string> {
  // Validate expiration
  const expires = config.expires instanceof Date ? config.expires.getTime() : config.expires
  const now = Date.now()

  if (expires <= now) {
    throw new InvalidArgumentError('expires', 'Expiration time must be in the future')
  }

  const expiresInSeconds = Math.floor((expires - now) / 1000)
  const maxExpiry = config.version === 'v4' ? MAX_EXPIRY_V4 : MAX_EXPIRY_V2

  if (expiresInSeconds > maxExpiry) {
    throw new InvalidArgumentError(
      'expires',
      `Expiration time cannot be more than ${maxExpiry} seconds (7 days)`
    )
  }

  // Use V4 by default
  if (config.version === 'v2') {
    return generateSignedUrlV2(bucketName, objectName, config, storage, expiresInSeconds)
  } else {
    return generateSignedUrlV4(bucketName, objectName, config, storage, expiresInSeconds)
  }
}

/**
 * Generate a V2 signed URL
 */
async function generateSignedUrlV2(
  bucketName: string,
  objectName: string,
  config: SignedUrlConfig,
  storage: Storage,
  expiresInSeconds: number
): Promise<string> {
  const method = actionToMethod(config.action)
  const expirationTimestamp = Math.floor(Date.now() / 1000) + expiresInSeconds

  // Build the resource path
  const resourcePath = `/${bucketName}/${encodeURIComponent(objectName)}`

  // Build extension headers string
  const extensionHeaders = config.extensionHeaders
    ? Object.entries(config.extensionHeaders)
        .map(([k, v]) => `${k.toLowerCase()}:${v}`)
        .sort()
        .join('\n')
    : ''

  // Build string to sign
  const stringToSign = [
    method,
    config.contentMd5 || '',
    config.contentType || '',
    expirationTimestamp.toString(),
    extensionHeaders ? extensionHeaders + '\n' + resourcePath : resourcePath,
  ].join('\n')

  // Generate signature (using HMAC-SHA256 for compat layer)
  const signature = await sign(stringToSign)

  // Build query parameters
  const params = new URLSearchParams()
  params.set('GoogleAccessId', getServiceAccountEmail(storage))
  params.set('Expires', expirationTimestamp.toString())
  params.set('Signature', signature)

  // Add response overrides
  if (config.responseDisposition) {
    params.set('response-content-disposition', config.responseDisposition)
  }
  if (config.responseType) {
    params.set('response-content-type', config.responseType)
  }

  // Add custom query params
  if (config.queryParams) {
    for (const [key, value] of Object.entries(config.queryParams)) {
      params.set(key, value)
    }
  }

  // Build final URL
  const host = config.cname || `storage.googleapis.com`
  const url = new URL(`https://${host}${resourcePath}`)

  if (config.virtualHostedStyle) {
    url.hostname = `${bucketName}.storage.googleapis.com`
    url.pathname = `/${encodeURIComponent(objectName)}`
  }

  url.search = params.toString()
  return url.toString()
}

/**
 * Generate a V4 signed URL
 */
async function generateSignedUrlV4(
  bucketName: string,
  objectName: string,
  config: SignedUrlConfig,
  storage: Storage,
  expiresInSeconds: number
): Promise<string> {
  const method = actionToMethod(config.action)
  const now = new Date()
  const dateStamp = formatDateStamp(now)
  const requestTimestamp = formatRequestTimestamp(now)

  const serviceAccountEmail = getServiceAccountEmail(storage)
  const credentialScope = `${dateStamp}/auto/storage/goog4_request`
  const credential = `${serviceAccountEmail}/${credentialScope}`

  // Build the resource path
  const canonicalUri = config.virtualHostedStyle
    ? `/${encodeURIComponent(objectName)}`
    : `/${bucketName}/${encodeURIComponent(objectName)}`

  // Build headers
  const host = config.virtualHostedStyle
    ? `${bucketName}.storage.googleapis.com`
    : config.cname || 'storage.googleapis.com'

  const headers: Record<string, string> = {
    host,
    ...(config.extensionHeaders || {}),
  }

  // Sort headers and build signed headers string
  const sortedHeaderNames = Object.keys(headers).map((k) => k.toLowerCase()).sort()
  const signedHeaders = sortedHeaderNames.join(';')

  // Build canonical headers
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${headers[name.toLowerCase()] || headers[name]}`)
    .join('\n') + '\n'

  // Build query parameters
  const queryParams: Record<string, string> = {
    'X-Goog-Algorithm': GOOG_ALGORITHM_V4,
    'X-Goog-Credential': credential,
    'X-Goog-Date': requestTimestamp,
    'X-Goog-Expires': expiresInSeconds.toString(),
    'X-Goog-SignedHeaders': signedHeaders,
    ...(config.queryParams || {}),
  }

  // Add response overrides
  if (config.responseDisposition) {
    queryParams['response-content-disposition'] = config.responseDisposition
  }
  if (config.responseType) {
    queryParams['response-content-type'] = config.responseType
  }

  // Sort and encode query string
  const sortedParams = Object.keys(queryParams).sort()
  const canonicalQueryString = sortedParams
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&')

  // Build canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  // Hash canonical request
  const canonicalRequestHash = await sha256(canonicalRequest)

  // Build string to sign
  const stringToSign = [
    GOOG_ALGORITHM_V4,
    requestTimestamp,
    credentialScope,
    canonicalRequestHash,
  ].join('\n')

  // Generate signature
  const signature = await sign(stringToSign)

  // Build final URL
  const url = new URL(`https://${host}${canonicalUri}`)
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set('X-Goog-Signature', signature)

  return url.toString()
}

// =============================================================================
// Signed POST Policy V4
// =============================================================================

/**
 * Generate a signed POST policy for browser uploads
 */
export async function generateSignedPostPolicyV4(
  bucketName: string,
  objectName: string,
  options: GenerateSignedPostPolicyV4Options,
  storage: Storage
): Promise<SignedPostPolicyV4> {
  const expires = options.expires instanceof Date ? options.expires.getTime() : options.expires
  const now = Date.now()

  if (expires <= now) {
    throw new InvalidArgumentError('expires', 'Expiration time must be in the future')
  }

  const expiresInSeconds = Math.floor((expires - now) / 1000)
  if (expiresInSeconds > MAX_EXPIRY_V4) {
    throw new InvalidArgumentError(
      'expires',
      `Expiration time cannot be more than ${MAX_EXPIRY_V4} seconds (7 days)`
    )
  }

  const nowDate = new Date()
  const dateStamp = formatDateStamp(nowDate)
  const requestTimestamp = formatRequestTimestamp(nowDate)

  const serviceAccountEmail = getServiceAccountEmail(storage)
  const credentialScope = `${dateStamp}/auto/storage/goog4_request`
  const credential = `${serviceAccountEmail}/${credentialScope}`

  // Build policy conditions
  const conditions: unknown[] = [
    { bucket: bucketName },
    { key: objectName },
    { 'x-goog-date': requestTimestamp },
    { 'x-goog-credential': credential },
    { 'x-goog-algorithm': GOOG_ALGORITHM_V4 },
    ...(options.conditions || []),
  ]

  if (options.contentType) {
    conditions.push({ 'Content-Type': options.contentType })
  }

  // Build policy document
  const policy = {
    expiration: new Date(expires).toISOString(),
    conditions,
  }

  // Encode and sign policy
  const policyBase64 = btoa(JSON.stringify(policy))
  const signature = await sign(policyBase64)

  // Build form fields
  const fields: Record<string, string> = {
    key: objectName,
    'x-goog-algorithm': GOOG_ALGORITHM_V4,
    'x-goog-credential': credential,
    'x-goog-date': requestTimestamp,
    'x-goog-signature': signature,
    policy: policyBase64,
    ...(options.fields || {}),
  }

  if (options.contentType) {
    fields['Content-Type'] = options.contentType
  }

  // Build URL
  const url = options.virtualHostedStyle
    ? `https://${bucketName}.storage.googleapis.com/`
    : `https://storage.googleapis.com/${bucketName}/`

  return { url, fields }
}

// =============================================================================
// Resumable Upload URL
// =============================================================================

/**
 * Generate a signed URL for initiating a resumable upload
 */
export async function generateResumableUploadUrl(
  bucketName: string,
  objectName: string,
  config: {
    expires: number | Date
    contentType?: string
    origin?: string
    metadata?: Record<string, string>
  },
  storage: Storage
): Promise<string> {
  const signedUrl = await generateSignedUrl(
    bucketName,
    objectName,
    {
      action: 'resumable',
      expires: config.expires,
      contentType: config.contentType,
      extensionHeaders: {
        ...(config.origin ? { 'x-goog-resumable': 'start' } : {}),
        ...(config.origin ? { origin: config.origin } : {}),
      },
    },
    storage
  )

  return signedUrl
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert action to HTTP method
 */
function actionToMethod(action: SignedUrlConfig['action']): string {
  switch (action) {
    case 'read':
      return 'GET'
    case 'write':
      return 'PUT'
    case 'delete':
      return 'DELETE'
    case 'resumable':
      return 'POST'
    default:
      return 'GET'
  }
}

/**
 * Format date stamp (YYYYMMDD)
 */
function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Format request timestamp (YYYYMMDDTHHMMSSZ)
 */
function formatRequestTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Get service account email from storage options
 */
function getServiceAccountEmail(storage: Storage): string {
  // In production, this would come from credentials
  // For the compat layer, we use a placeholder
  return storage.projectId
    ? `service@${storage.projectId}.iam.gserviceaccount.com`
    : 'service@example.iam.gserviceaccount.com'
}

/**
 * Compute SHA-256 hash
 */
async function sha256(message: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(message)
  )
  return arrayBufferToHex(hashBuffer)
}

/**
 * Sign a message (using HMAC-SHA256 for compat layer)
 */
async function sign(message: string): Promise<string> {
  // In production, this would use the service account private key
  // For the compat layer, we use HMAC-SHA256 with a fixed key
  const key = 'gcs-compat-layer-signing-key'
  const keyData = new TextEncoder().encode(key)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(message)
  )

  return arrayBufferToHex(signatureBuffer)
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Validate a signed URL
 */
export function validateSignedUrl(url: string): {
  valid: boolean
  expired?: boolean
  bucket?: string
  object?: string
  action?: string
  error?: string
} {
  try {
    const parsed = new URL(url)

    // Check for required parameters
    const hasV4 = parsed.searchParams.has('X-Goog-Algorithm')
    const hasV2 = parsed.searchParams.has('GoogleAccessId')

    if (!hasV4 && !hasV2) {
      return { valid: false, error: 'Missing signature parameters' }
    }

    // Check expiration
    let expired = false
    if (hasV4) {
      const dateStr = parsed.searchParams.get('X-Goog-Date')
      const expiresStr = parsed.searchParams.get('X-Goog-Expires')
      if (dateStr && expiresStr) {
        const date = parseRequestTimestamp(dateStr)
        const expiresInSeconds = parseInt(expiresStr)
        const expirationTime = date.getTime() + expiresInSeconds * 1000
        expired = Date.now() > expirationTime
      }
    } else {
      const expiresStr = parsed.searchParams.get('Expires')
      if (expiresStr) {
        const expirationTime = parseInt(expiresStr) * 1000
        expired = Date.now() > expirationTime
      }
    }

    // Extract bucket and object
    let bucket: string | undefined
    let object: string | undefined

    if (parsed.hostname.endsWith('.storage.googleapis.com')) {
      // Virtual hosted style
      bucket = parsed.hostname.replace('.storage.googleapis.com', '')
      object = decodeURIComponent(parsed.pathname.slice(1))
    } else {
      // Path style
      const pathParts = parsed.pathname.slice(1).split('/')
      bucket = pathParts[0]
      object = decodeURIComponent(pathParts.slice(1).join('/'))
    }

    return {
      valid: true,
      expired,
      bucket,
      object,
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid URL',
    }
  }
}

/**
 * Parse a V4 request timestamp
 */
function parseRequestTimestamp(timestamp: string): Date {
  // Format: YYYYMMDDTHHMMSSZ
  const year = parseInt(timestamp.slice(0, 4))
  const month = parseInt(timestamp.slice(4, 6)) - 1
  const day = parseInt(timestamp.slice(6, 8))
  const hour = parseInt(timestamp.slice(9, 11))
  const minute = parseInt(timestamp.slice(11, 13))
  const second = parseInt(timestamp.slice(13, 15))

  return new Date(Date.UTC(year, month, day, hour, minute, second))
}

// =============================================================================
// Exports
// =============================================================================

export type { SignedUrlConfig, GenerateSignedPostPolicyV4Options, SignedPostPolicyV4 }
