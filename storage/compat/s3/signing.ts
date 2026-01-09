/**
 * AWS Signature V4 Signing Utilities
 *
 * Edge-compatible implementation using Web Crypto API.
 * Can be shared across S3, SQS, SNS, and other AWS-compatible services.
 *
 * @see https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Credentials for AWS signing
 */
export interface SigningCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/**
 * AWS Signature V4 signing context
 */
export interface SigningContext {
  credentials: SigningCredentials
  region: string
  service: string
  method: string
  host: string
  path: string
  queryParams: Record<string, string>
  headers?: Record<string, string>
  signedHeaders: string[]
  date: Date
  expiresIn?: number
  payload?: string | Uint8Array
}

/**
 * Result of signing operation
 */
export interface SigningResult {
  signature: string
  credential: string
  amzDate: string
  signedHeaders: string
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * SHA256 hash using Web Crypto API
 */
export async function sha256(data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder()
  const dataBytes = typeof data === 'string' ? encoder.encode(data) : data
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes)
  return bytesToHex(new Uint8Array(hashBuffer))
}

/**
 * HMAC-SHA256 using Web Crypto API
 */
export async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
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
 *
 * kSecret = "AWS4" + secretAccessKey
 * kDate = HMAC-SHA256(kSecret, date)
 * kRegion = HMAC-SHA256(kDate, region)
 * kService = HMAC-SHA256(kRegion, service)
 * kSigning = HMAC-SHA256(kService, "aws4_request")
 */
export async function getSigningKey(
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

// ============================================================================
// DATE FORMATTING
// ============================================================================

/**
 * Format date as YYYYMMDD (date stamp for credential scope)
 */
export function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Format date as YYYYMMDDTHHMMSSZ (ISO8601 basic format for X-Amz-Date)
 */
export function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

// ============================================================================
// URI ENCODING
// ============================================================================

/**
 * URI encode a string for AWS Signature V4
 *
 * AWS Signature V4 requires RFC 3986 URI encoding with the exception
 * that the forward slash character is optionally encoded.
 *
 * Unreserved characters that should NOT be encoded:
 * A-Z, a-z, 0-9, hyphen (-), underscore (_), period (.), tilde (~)
 *
 * @param str - String to encode
 * @param encodeSlash - Whether to encode forward slashes (default: true)
 */
export function uriEncode(str: string, encodeSlash = true): string {
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
        for (let j = 0; j < bytes.length; j++) {
          encoded += '%' + bytes[j].toString(16).toUpperCase().padStart(2, '0')
        }
      }
    }
  }
  return encoded
}

// ============================================================================
// CANONICAL REQUEST
// ============================================================================

/**
 * Create canonical request for AWS Signature V4
 *
 * CanonicalRequest =
 *   HTTPRequestMethod + '\n' +
 *   CanonicalURI + '\n' +
 *   CanonicalQueryString + '\n' +
 *   CanonicalHeaders + '\n' +
 *   SignedHeaders + '\n' +
 *   HashedPayload
 */
export async function createCanonicalRequest(ctx: SigningContext): Promise<string> {
  // Sort query parameters alphabetically
  const sortedParams = Object.keys(ctx.queryParams).sort()
  const canonicalQueryString = sortedParams
    .map((key) => `${uriEncode(key)}=${uriEncode(ctx.queryParams[key])}`)
    .join('&')

  // Create canonical headers (must include host)
  const headers: Record<string, string> = {
    host: ctx.host,
    ...(ctx.headers || {}),
  }

  // Sort headers alphabetically and create canonical headers string
  const sortedHeaders = ctx.signedHeaders.sort()
  const canonicalHeaders = sortedHeaders
    .map((key) => `${key.toLowerCase()}:${(headers[key] || '').trim()}\n`)
    .join('')
  const signedHeadersStr = sortedHeaders.join(';')

  // For presigned URLs, the payload is UNSIGNED-PAYLOAD
  // For regular requests, compute the SHA256 hash of the payload
  let hashedPayload: string
  if (ctx.expiresIn !== undefined) {
    // Presigned URL - unsigned payload
    hashedPayload = 'UNSIGNED-PAYLOAD'
  } else if (ctx.payload !== undefined) {
    hashedPayload = await sha256(ctx.payload)
  } else {
    // Empty payload
    hashedPayload = await sha256('')
  }

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

// ============================================================================
// STRING TO SIGN
// ============================================================================

/**
 * Create string to sign for AWS Signature V4
 *
 * StringToSign =
 *   Algorithm + '\n' +
 *   RequestDateTime + '\n' +
 *   CredentialScope + '\n' +
 *   HashedCanonicalRequest
 */
export async function createStringToSign(
  canonicalRequest: string,
  amzDate: string,
  credentialScope: string
): Promise<string> {
  const hashedCanonicalRequest = await sha256(canonicalRequest)
  return ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedCanonicalRequest].join('\n')
}

// ============================================================================
// SIGNATURE CALCULATION
// ============================================================================

/**
 * Calculate AWS Signature V4 signature
 */
export async function calculateSignature(
  signingKey: Uint8Array,
  stringToSign: string
): Promise<string> {
  const signature = await hmacSha256(signingKey, stringToSign)
  return bytesToHex(signature)
}

// ============================================================================
// MAIN SIGNING FUNCTION
// ============================================================================

/**
 * Sign a request using AWS Signature V4
 *
 * This is the main entry point for signing requests.
 */
export async function signRequest(ctx: SigningContext): Promise<SigningResult> {
  const dateStamp = formatDateStamp(ctx.date)
  const amzDate = formatAmzDate(ctx.date)
  const credentialScope = `${dateStamp}/${ctx.region}/${ctx.service}/aws4_request`
  const credential = `${ctx.credentials.accessKeyId}/${credentialScope}`

  // Create canonical request
  const canonicalRequest = await createCanonicalRequest(ctx)

  // Create string to sign
  const stringToSign = await createStringToSign(canonicalRequest, amzDate, credentialScope)

  // Get signing key
  const signingKey = await getSigningKey(
    ctx.credentials.secretAccessKey,
    dateStamp,
    ctx.region,
    ctx.service
  )

  // Calculate signature
  const signature = await calculateSignature(signingKey, stringToSign)

  return {
    signature,
    credential,
    amzDate,
    signedHeaders: ctx.signedHeaders.sort().join(';'),
  }
}

/**
 * Create a presigned URL for an AWS service
 */
export async function createPresignedUrl(options: {
  credentials: SigningCredentials
  region: string
  service: string
  method: string
  host: string
  path: string
  expiresIn?: number
  queryParams?: Record<string, string>
}): Promise<string> {
  const {
    credentials,
    region,
    service,
    method,
    host,
    path,
    expiresIn = 3600,
    queryParams: additionalParams = {},
  } = options

  const now = new Date()
  const dateStamp = formatDateStamp(now)
  const amzDate = formatAmzDate(now)
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const credential = `${credentials.accessKeyId}/${credentialScope}`

  // Build query parameters
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
    ...additionalParams,
  }

  // Add security token if present
  if (credentials.sessionToken) {
    queryParams['X-Amz-Security-Token'] = credentials.sessionToken
  }

  // Create signing context
  const ctx: SigningContext = {
    credentials,
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

  // Sign the request
  const result = await signRequest(ctx)

  // Build final URL
  const url = new URL(`https://${host}${path}`)

  // Add query parameters
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', credential)
  url.searchParams.set('X-Amz-Date', amzDate)
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  url.searchParams.set('X-Amz-SignedHeaders', 'host')

  // Add security token if present
  if (credentials.sessionToken) {
    url.searchParams.set('X-Amz-Security-Token', credentials.sessionToken)
  }

  // Add any additional query parameters
  for (const [key, value] of Object.entries(additionalParams)) {
    if (!key.startsWith('X-Amz-')) {
      url.searchParams.set(key, value)
    }
  }

  // Add signature last
  url.searchParams.set('X-Amz-Signature', result.signature)

  return url.toString()
}
