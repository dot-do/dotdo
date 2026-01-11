/**
 * Pre-signed URL generation for S3-compatible API
 *
 * Implements AWS Signature Version 4 for pre-signed URLs
 */

import type { PresignedUrlOptions, PresignedPost, PresignedPostOptions } from './types'

// ============================================================================
// Constants
// ============================================================================

const AWS_ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
const AWS_REQUEST = 'aws4_request'
const DEFAULT_EXPIRY = 3600 // 1 hour
const MAX_EXPIRY = 604800 // 7 days

// ============================================================================
// Utility Functions
// ============================================================================

async function hmacSHA256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const keyData = typeof key === 'string'
    ? new TextEncoder().encode(key)
    : key

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
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return arrayBufferToHex(hashBuffer)
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function getDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function getAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function uriEncode(str: string, encodeSlash = true): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(encodeSlash ? /%2F/gi : '' , '/')
}

// ============================================================================
// Signing Key Derivation
// ============================================================================

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

// ============================================================================
// Pre-signed URL Generation
// ============================================================================

export interface SigningConfig {
  accessKeyId: string
  secretAccessKey: string
  region: string
  endpoint: string
}

export async function getSignedUrl(
  config: SigningConfig,
  bucket: string,
  key: string,
  options: PresignedUrlOptions = {}
): Promise<string> {
  const {
    expiresIn = DEFAULT_EXPIRY,
    method = 'GET',
    contentType,
    contentMd5,
    metadata = {},
    queryParams = {},
  } = options

  if (expiresIn > MAX_EXPIRY) {
    throw new Error(`Expiry cannot exceed ${MAX_EXPIRY} seconds (7 days)`)
  }

  const now = new Date()
  const dateStamp = getDateStamp(now)
  const amzDate = getAmzDate(now)
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/${SERVICE}/${AWS_REQUEST}`

  // Build canonical URI
  const canonicalUri = `/${bucket}/${uriEncode(key, false)}`

  // Build query parameters
  const params: Record<string, string> = {
    'X-Amz-Algorithm': AWS_ALGORITHM,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn.toString(),
    'X-Amz-SignedHeaders': 'host',
    ...queryParams,
  }

  // Add content-type if PUT
  if (method === 'PUT' && contentType) {
    params['Content-Type'] = contentType
  }

  // Add metadata headers
  for (const [k, v] of Object.entries(metadata)) {
    params[`x-amz-meta-${k.toLowerCase()}`] = v
  }

  // Sort and encode query string
  const sortedParams = Object.keys(params).sort()
  const canonicalQueryString = sortedParams
    .map(k => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&')

  // Build canonical headers
  const host = new URL(config.endpoint).host
  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'

  // For GET requests, payload is UNSIGNED-PAYLOAD
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
  const scope = `${dateStamp}/${config.region}/${SERVICE}/${AWS_REQUEST}`
  const stringToSign = [
    AWS_ALGORITHM,
    amzDate,
    scope,
    canonicalRequestHash,
  ].join('\n')

  // Calculate signature
  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, config.region)
  const signatureBuffer = await hmacSHA256(signingKey, stringToSign)
  const signature = arrayBufferToHex(signatureBuffer)

  // Build final URL
  const signedUrl = new URL(`${config.endpoint}${canonicalUri}`)
  for (const [k, v] of Object.entries(params)) {
    signedUrl.searchParams.set(k, v)
  }
  signedUrl.searchParams.set('X-Amz-Signature', signature)

  return signedUrl.toString()
}

// ============================================================================
// Pre-signed POST (for browser uploads)
// ============================================================================

export async function createPresignedPost(
  config: SigningConfig,
  bucket: string,
  options: PresignedPostOptions = {}
): Promise<PresignedPost> {
  const {
    expiresIn = DEFAULT_EXPIRY,
    conditions = [],
    fields = {},
  } = options

  const now = new Date()
  const expiration = new Date(now.getTime() + expiresIn * 1000)
  const dateStamp = getDateStamp(now)
  const amzDate = getAmzDate(now)
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/${SERVICE}/${AWS_REQUEST}`

  // Build policy document
  const policy = {
    expiration: expiration.toISOString(),
    conditions: [
      { bucket },
      { 'x-amz-algorithm': AWS_ALGORITHM },
      { 'x-amz-credential': credential },
      { 'x-amz-date': amzDate },
      ...conditions,
    ],
  }

  // Encode and sign policy
  const policyBase64 = btoa(JSON.stringify(policy))
  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, config.region)
  const signatureBuffer = await hmacSHA256(signingKey, policyBase64)
  const signature = arrayBufferToHex(signatureBuffer)

  return {
    url: `${config.endpoint}/${bucket}`,
    fields: {
      ...fields,
      'Policy': policyBase64,
      'X-Amz-Algorithm': AWS_ALGORITHM,
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Signature': signature,
    },
  }
}

// ============================================================================
// Signature Verification
// ============================================================================

export interface SignatureVerificationResult {
  valid: boolean
  error?: string
  accessKeyId?: string
  expiration?: Date
}

export async function verifySignature(
  config: SigningConfig,
  request: Request
): Promise<SignatureVerificationResult> {
  const url = new URL(request.url)

  // Check for query string signature (pre-signed URL)
  const algorithm = url.searchParams.get('X-Amz-Algorithm')
  const credential = url.searchParams.get('X-Amz-Credential')
  const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')
  const signature = url.searchParams.get('X-Amz-Signature')
  const amzDate = url.searchParams.get('X-Amz-Date')
  const expires = url.searchParams.get('X-Amz-Expires')

  if (algorithm && credential && signature && amzDate) {
    // Verify pre-signed URL
    return verifyPresignedUrl(config, request, {
      algorithm,
      credential,
      signedHeaders: signedHeaders || 'host',
      signature,
      amzDate,
      expires: expires ? parseInt(expires) : DEFAULT_EXPIRY,
    })
  }

  // Check for Authorization header
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('AWS4-HMAC-SHA256')) {
    return verifyAuthorizationHeader(config, request, authHeader)
  }

  return { valid: false, error: 'No signature found' }
}

async function verifyPresignedUrl(
  config: SigningConfig,
  request: Request,
  params: {
    algorithm: string
    credential: string
    signedHeaders: string
    signature: string
    amzDate: string
    expires: number
  }
): Promise<SignatureVerificationResult> {
  const { algorithm, credential, signedHeaders, signature, amzDate, expires } = params

  // Parse credential
  const [accessKeyId, dateStamp, region, service, requestType] = credential.split('/')

  if (accessKeyId !== config.accessKeyId) {
    return { valid: false, error: 'Invalid access key' }
  }

  if (service !== SERVICE || requestType !== AWS_REQUEST) {
    return { valid: false, error: 'Invalid credential scope' }
  }

  // Check expiration
  const requestTime = new Date(
    amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
  )
  const expirationTime = new Date(requestTime.getTime() + expires * 1000)

  if (new Date() > expirationTime) {
    return { valid: false, error: 'Signature expired', expiration: expirationTime }
  }

  // Rebuild and verify signature
  const url = new URL(request.url)
  const canonicalUri = url.pathname

  // Remove signature from query params for verification
  const queryParams = new URLSearchParams(url.search)
  queryParams.delete('X-Amz-Signature')

  const sortedParams = Array.from(queryParams.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const canonicalQueryString = sortedParams
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join('&')

  const host = url.host
  const canonicalHeaders = `host:${host}\n`
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    request.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const canonicalRequestHash = await sha256(canonicalRequest)
  const scope = `${dateStamp}/${region}/${SERVICE}/${AWS_REQUEST}`
  const stringToSign = [
    algorithm,
    amzDate,
    scope,
    canonicalRequestHash,
  ].join('\n')

  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, region)
  const expectedSignatureBuffer = await hmacSHA256(signingKey, stringToSign)
  const expectedSignature = arrayBufferToHex(expectedSignatureBuffer)

  if (signature !== expectedSignature) {
    return { valid: false, error: 'Signature mismatch' }
  }

  return { valid: true, accessKeyId, expiration: expirationTime }
}

async function verifyAuthorizationHeader(
  config: SigningConfig,
  request: Request,
  authHeader: string
): Promise<SignatureVerificationResult> {
  // Parse Authorization header
  // Format: AWS4-HMAC-SHA256 Credential=.../..., SignedHeaders=..., Signature=...
  const match = authHeader.match(
    /^AWS4-HMAC-SHA256\s+Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=(\w+)$/
  )

  if (!match) {
    return { valid: false, error: 'Invalid Authorization header format' }
  }

  const [, credential, signedHeaders, signature] = match
  const [accessKeyId, dateStamp, region, service, requestType] = credential.split('/')

  if (accessKeyId !== config.accessKeyId) {
    return { valid: false, error: 'Invalid access key' }
  }

  if (service !== SERVICE || requestType !== AWS_REQUEST) {
    return { valid: false, error: 'Invalid credential scope' }
  }

  const amzDate = request.headers.get('x-amz-date')
  if (!amzDate) {
    return { valid: false, error: 'Missing x-amz-date header' }
  }

  // Build canonical request
  const url = new URL(request.url)
  const canonicalUri = url.pathname

  const queryParams = Array.from(url.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const canonicalQueryString = queryParams
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join('&')

  // Build canonical headers
  const headerList = signedHeaders.split(';')
  const canonicalHeaders = headerList
    .map(h => {
      const value = h === 'host' ? url.host : request.headers.get(h) || ''
      return `${h.toLowerCase()}:${value.trim()}\n`
    })
    .join('')

  const payloadHash = request.headers.get('x-amz-content-sha256') || 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    request.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const canonicalRequestHash = await sha256(canonicalRequest)
  const scope = `${dateStamp}/${region}/${SERVICE}/${AWS_REQUEST}`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    canonicalRequestHash,
  ].join('\n')

  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, region)
  const expectedSignatureBuffer = await hmacSHA256(signingKey, stringToSign)
  const expectedSignature = arrayBufferToHex(expectedSignatureBuffer)

  if (signature !== expectedSignature) {
    return { valid: false, error: 'Signature mismatch' }
  }

  return { valid: true, accessKeyId }
}

// ============================================================================
// ETag Generation
// ============================================================================

export async function generateETag(data: ArrayBuffer | ReadableStream<Uint8Array>): Promise<string> {
  if (data instanceof ArrayBuffer) {
    const hash = await crypto.subtle.digest('MD5', data)
    return `"${arrayBufferToHex(hash)}"`
  }

  // For streams, we need to read the entire stream
  const chunks: Uint8Array[] = []
  const reader = data.getReader()

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

  const hash = await crypto.subtle.digest('MD5', combined)
  return `"${arrayBufferToHex(hash)}"`
}

export async function generateMultipartETag(partETags: string[]): Promise<string> {
  // Multipart ETag is MD5 of concatenated part MD5s + "-" + part count
  const partHashes = partETags.map(etag => {
    // Remove quotes from ETags
    const hash = etag.replace(/"/g, '')
    // Convert hex to bytes
    const bytes = new Uint8Array(hash.length / 2)
    for (let i = 0; i < hash.length; i += 2) {
      bytes[i / 2] = parseInt(hash.substring(i, i + 2), 16)
    }
    return bytes
  })

  const totalLength = partHashes.reduce((sum, arr) => sum + arr.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const hash of partHashes) {
    combined.set(hash, offset)
    offset += hash.length
  }

  const finalHash = await crypto.subtle.digest('MD5', combined)
  return `"${arrayBufferToHex(finalHash)}-${partETags.length}"`
}
