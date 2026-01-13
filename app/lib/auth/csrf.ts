/**
 * CSRF Protection Utilities
 *
 * Provides CSRF token generation and validation for protecting auth endpoints.
 *
 * ## Security Implementation
 *
 * - Uses crypto.subtle.digest for SHA-256 hashing
 * - Tokens include timestamp for expiry validation
 * - Double-submit cookie pattern supported
 * - Constant-time comparison to prevent timing attacks
 *
 * ## Usage
 *
 * ```typescript
 * // Generate token on page load
 * const token = await generateCSRFToken(secret)
 *
 * // Set as cookie and hidden form field
 * setCookie('csrf_token', token)
 * <input type="hidden" name="_csrf" value={token} />
 *
 * // Validate on form submission
 * const isValid = await validateCSRFToken(formToken, cookieToken, secret)
 * ```
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * CSRF token configuration options.
 */
export interface CSRFConfig {
  /** Token expiration time in milliseconds (default: 1 hour) */
  expiresIn: number
  /** Cookie name for CSRF token */
  cookieName: string
  /** Form field name for CSRF token */
  fieldName: string
  /** Header name for CSRF token (for AJAX requests) */
  headerName: string
}

/**
 * Default CSRF configuration.
 */
export const CSRF_DEFAULTS: CSRFConfig = {
  expiresIn: 60 * 60 * 1000, // 1 hour
  cookieName: 'csrf_token',
  fieldName: '_csrf',
  headerName: 'X-CSRF-Token',
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a cryptographically secure random string.
 */
function generateRandomBytes(length: number = 32): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Fallback for environments without crypto.getRandomValues
  return Array.from({ length: length * 2 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

/**
 * Generate SHA-256 hash using Web Crypto API.
 */
async function sha256(data: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback: simple hash (not cryptographically secure, for dev only)
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * Generate a CSRF token.
 *
 * Token format: `{timestamp}.{random}.{signature}`
 *
 * @param secret - Server-side secret for signing
 * @param expiresIn - Token expiration in milliseconds (default: 1 hour)
 * @returns CSRF token string
 */
export async function generateCSRFToken(
  secret: string,
  expiresIn: number = CSRF_DEFAULTS.expiresIn
): Promise<string> {
  const timestamp = Date.now()
  const random = generateRandomBytes(16)
  const payload = `${timestamp}.${random}`

  const signature = await sha256(`${payload}.${secret}`)

  return `${payload}.${signature}`
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Parse a CSRF token into its components.
 */
function parseCSRFToken(token: string): { timestamp: number; random: string; signature: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  const timestamp = parseInt(parts[0], 10)
  if (isNaN(timestamp)) {
    return null
  }

  return {
    timestamp,
    random: parts[1],
    signature: parts[2],
  }
}

/**
 * Validate a CSRF token.
 *
 * Checks:
 * 1. Token format is valid
 * 2. Token has not expired
 * 3. Signature matches (using constant-time comparison)
 * 4. Token matches cookie (double-submit pattern)
 *
 * @param formToken - Token from form submission
 * @param cookieToken - Token from cookie (for double-submit validation)
 * @param secret - Server-side secret for verification
 * @param expiresIn - Token expiration in milliseconds
 * @returns Validation result with error message if invalid
 */
export async function validateCSRFToken(
  formToken: string | null,
  cookieToken: string | null,
  secret: string,
  expiresIn: number = CSRF_DEFAULTS.expiresIn
): Promise<{ valid: boolean; error?: string }> {
  // Check that both tokens exist
  if (!formToken) {
    return { valid: false, error: 'Missing CSRF token in form' }
  }
  if (!cookieToken) {
    return { valid: false, error: 'Missing CSRF token in cookie' }
  }

  // Double-submit validation: tokens must match
  if (!safeCompare(formToken, cookieToken)) {
    return { valid: false, error: 'CSRF tokens do not match' }
  }

  // Parse token
  const parsed = parseCSRFToken(formToken)
  if (!parsed) {
    return { valid: false, error: 'Invalid CSRF token format' }
  }

  // Check expiration
  const now = Date.now()
  if (now - parsed.timestamp > expiresIn) {
    return { valid: false, error: 'CSRF token has expired' }
  }

  // Verify signature
  const payload = `${parsed.timestamp}.${parsed.random}`
  const expectedSignature = await sha256(`${payload}.${secret}`)

  if (!safeCompare(parsed.signature, expectedSignature)) {
    return { valid: false, error: 'Invalid CSRF token signature' }
  }

  return { valid: true }
}

// ============================================================================
// Cookie Helpers
// ============================================================================

/**
 * Build CSRF cookie with secure attributes.
 *
 * @param token - CSRF token value
 * @param secure - Whether to use Secure flag (true for HTTPS)
 * @param config - CSRF configuration
 * @returns Cookie header string
 */
export function buildCSRFCookie(
  token: string,
  secure: boolean = true,
  config: Partial<CSRFConfig> = {}
): string {
  const { cookieName, expiresIn } = { ...CSRF_DEFAULTS, ...config }
  const maxAge = Math.floor(expiresIn / 1000)

  const parts = [
    `${cookieName}=${token}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'SameSite=Strict',
    'HttpOnly',
  ]

  if (secure) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

/**
 * Parse CSRF token from cookie header.
 *
 * @param cookieHeader - Cookie header value
 * @param config - CSRF configuration
 * @returns CSRF token or null if not found
 */
export function parseCSRFCookie(
  cookieHeader: string | null,
  config: Partial<CSRFConfig> = {}
): string | null {
  if (!cookieHeader) {
    return null
  }

  const { cookieName } = { ...CSRF_DEFAULTS, ...config }

  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [key, value] = part.trim().split('=')
    if (key && value) {
      cookies[key] = decodeURIComponent(value)
    }
  }

  return cookies[cookieName] || null
}

// ============================================================================
// Middleware Helpers
// ============================================================================

/**
 * Extract CSRF token from request.
 *
 * Checks (in order):
 * 1. Request body (form field)
 * 2. Query parameter
 * 3. Custom header
 *
 * @param request - Incoming request
 * @param config - CSRF configuration
 * @returns CSRF token or null
 */
export async function extractCSRFTokenFromRequest(
  request: Request,
  config: Partial<CSRFConfig> = {}
): Promise<string | null> {
  const { fieldName, headerName } = { ...CSRF_DEFAULTS, ...config }

  // Check header first (for AJAX requests)
  const headerToken = request.headers.get(headerName)
  if (headerToken) {
    return headerToken
  }

  // Check URL params
  const url = new URL(request.url)
  const queryToken = url.searchParams.get(fieldName)
  if (queryToken) {
    return queryToken
  }

  // Check form body (if POST with form content)
  if (
    request.method === 'POST' &&
    request.headers.get('Content-Type')?.includes('application/x-www-form-urlencoded')
  ) {
    try {
      const body = await request.clone().formData()
      const formToken = body.get(fieldName)
      if (typeof formToken === 'string') {
        return formToken
      }
    } catch {
      // Body parsing failed, continue
    }
  }

  // Check JSON body
  if (
    request.method === 'POST' &&
    request.headers.get('Content-Type')?.includes('application/json')
  ) {
    try {
      const body = await request.clone().json()
      if (body && typeof body[fieldName] === 'string') {
        return body[fieldName]
      }
    } catch {
      // Body parsing failed, continue
    }
  }

  return null
}

/**
 * Create CSRF validation middleware result.
 *
 * @param request - Incoming request
 * @param secret - Server-side secret
 * @param config - CSRF configuration
 * @returns Validation result
 */
export async function validateCSRFRequest(
  request: Request,
  secret: string,
  config: Partial<CSRFConfig> = {}
): Promise<{ valid: boolean; error?: string }> {
  // Skip validation for safe methods
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  if (safeMethod) {
    return { valid: true }
  }

  const formToken = await extractCSRFTokenFromRequest(request, config)
  const cookieToken = parseCSRFCookie(request.headers.get('Cookie'), config)

  return validateCSRFToken(formToken, cookieToken, secret, config.expiresIn)
}
