/**
 * CSRF Protection Module
 *
 * Implements CSRF token generation and validation for protecting
 * state-changing auth operations (login, signup, password reset).
 *
 * ## How it works:
 * 1. Server generates a cryptographically random token
 * 2. Token is stored in an HTTP-only cookie and included in forms
 * 3. On form submission, both values are compared
 * 4. Tokens are single-use and time-limited (15 minutes)
 *
 * ## Usage:
 * ```typescript
 * import { generateCSRFToken, validateCSRFToken, getCSRFCookieOptions } from './csrf'
 *
 * // Generate token for a form
 * const token = generateCSRFToken()
 * // Set cookie with: getCSRFCookieOptions()
 *
 * // Validate on submission
 * const isValid = validateCSRFToken(cookieToken, formToken)
 * ```
 *
 * @module auth/csrf
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * CSRF token expiry time in milliseconds (15 minutes)
 */
export const CSRF_TOKEN_EXPIRY_MS = 15 * 60 * 1000

/**
 * CSRF cookie name
 */
export const CSRF_COOKIE_NAME = 'dotdo_csrf'

/**
 * CSRF form field name
 */
export const CSRF_FIELD_NAME = 'csrf_token'

/**
 * CSRF header name for API requests
 */
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

// =============================================================================
// Types
// =============================================================================

/**
 * CSRF token with embedded timestamp for expiry validation
 */
export interface CSRFTokenData {
  token: string
  timestamp: number
}

/**
 * Result of CSRF validation
 */
export interface CSRFValidationResult {
  valid: boolean
  error?: 'missing_cookie' | 'missing_form_token' | 'mismatch' | 'expired' | 'invalid_format'
}

/**
 * Cookie options for CSRF token
 */
export interface CSRFCookieOptions {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict' | 'lax' | 'none'
  path: string
  maxAge: number
}

// =============================================================================
// Token Generation
// =============================================================================

/**
 * Generate a cryptographically secure CSRF token.
 *
 * The token format: `{timestamp}.{randomBytes}`
 * - Timestamp enables expiry validation without server state
 * - Random bytes provide unpredictability
 *
 * @returns A new CSRF token string
 *
 * @example
 * ```typescript
 * const token = generateCSRFToken()
 * // Returns: "1704902400000.a1b2c3d4e5f6..."
 * ```
 */
export function generateCSRFToken(): string {
  const timestamp = Date.now()
  const randomBytes = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  return `${timestamp}.${randomBytes}`
}

/**
 * Parse a CSRF token into its components.
 *
 * @param token - The CSRF token string
 * @returns Parsed token data or null if invalid format
 */
export function parseCSRFToken(token: string): CSRFTokenData | null {
  if (!token || typeof token !== 'string') {
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }

  const timestamp = parseInt(parts[0] ?? '', 10)
  if (isNaN(timestamp)) {
    return null
  }

  return {
    token: parts[1] ?? '',
    timestamp,
  }
}

/**
 * Check if a CSRF token has expired.
 *
 * @param timestamp - Token creation timestamp
 * @param expiryMs - Expiry duration in milliseconds (default: 15 minutes)
 * @returns true if the token has expired
 */
export function isTokenExpired(timestamp: number, expiryMs: number = CSRF_TOKEN_EXPIRY_MS): boolean {
  return Date.now() - timestamp > expiryMs
}

// =============================================================================
// Token Validation
// =============================================================================

/**
 * Validate a CSRF token from cookie against form/header token.
 *
 * Performs timing-safe comparison to prevent timing attacks.
 *
 * @param cookieToken - Token from HTTP-only cookie
 * @param formToken - Token from form field or header
 * @param options - Validation options
 * @returns Validation result with detailed error if invalid
 *
 * @example
 * ```typescript
 * const result = validateCSRFToken(
 *   req.cookies.get('dotdo_csrf'),
 *   req.body.csrf_token
 * )
 *
 * if (!result.valid) {
 *   console.error('CSRF validation failed:', result.error)
 *   return new Response('Invalid CSRF token', { status: 403 })
 * }
 * ```
 */
export function validateCSRFToken(
  cookieToken: string | undefined | null,
  formToken: string | undefined | null,
  options: { skipExpiryCheck?: boolean } = {},
): CSRFValidationResult {
  // Check for missing tokens
  if (!cookieToken) {
    return { valid: false, error: 'missing_cookie' }
  }

  if (!formToken) {
    return { valid: false, error: 'missing_form_token' }
  }

  // Parse and validate cookie token format
  const cookieParsed = parseCSRFToken(cookieToken)
  if (!cookieParsed) {
    return { valid: false, error: 'invalid_format' }
  }

  // Check expiry
  if (!options.skipExpiryCheck && isTokenExpired(cookieParsed.timestamp)) {
    return { valid: false, error: 'expired' }
  }

  // Timing-safe comparison to prevent timing attacks
  if (!timingSafeEqual(cookieToken, formToken)) {
    return { valid: false, error: 'mismatch' }
  }

  return { valid: true }
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do constant-time comparison to avoid length timing leak
    let result = 0
    const minLen = Math.min(a.length, b.length)
    for (let i = 0; i < minLen; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// =============================================================================
// Cookie Helpers
// =============================================================================

/**
 * Get CSRF cookie options for Set-Cookie header.
 *
 * The cookie is:
 * - HTTP-only: Prevents JS access (XSS protection)
 * - Secure: Only sent over HTTPS
 * - SameSite=Lax: Prevents CSRF via cross-site form posts
 * - Short expiry: Limits window of attack
 *
 * @param token - The CSRF token to set
 * @param isProduction - Whether running in production (affects Secure flag)
 * @returns Cookie options object
 */
export function getCSRFCookieOptions(token: string, isProduction: boolean = true): CSRFCookieOptions {
  return {
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(CSRF_TOKEN_EXPIRY_MS / 1000), // Convert to seconds
  }
}

/**
 * Format cookie options into a Set-Cookie header value.
 *
 * @param options - Cookie options
 * @returns Set-Cookie header string
 */
export function formatCSRFCookie(options: CSRFCookieOptions): string {
  const parts = [
    `${options.name}=${encodeURIComponent(options.value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`,
  ]

  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  if (options.secure) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

/**
 * Generate a clear cookie header to remove CSRF token.
 *
 * @returns Set-Cookie header string that clears the CSRF cookie
 */
export function clearCSRFCookie(): string {
  return `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Extract CSRF token from request (checks header first, then form body).
 *
 * @param request - The incoming request
 * @returns CSRF token or null if not found
 */
export async function extractCSRFToken(request: Request): Promise<string | null> {
  // Check header first (for API requests)
  const headerToken = request.headers.get(CSRF_HEADER_NAME)
  if (headerToken) {
    return headerToken
  }

  // For form submissions, check body
  const contentType = request.headers.get('Content-Type') || ''
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const formData = await request.clone().formData()
      const formToken = formData.get(CSRF_FIELD_NAME)
      if (typeof formToken === 'string') {
        return formToken
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check JSON body
  if (contentType.includes('application/json')) {
    try {
      const body = await request.clone().json() as Record<string, unknown>
      if (body && typeof body[CSRF_FIELD_NAME] === 'string') {
        return body[CSRF_FIELD_NAME] as string
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null
}

/**
 * Extract CSRF token from cookie header.
 *
 * @param cookieHeader - The Cookie header value
 * @returns CSRF token or null if not found
 */
export function extractCSRFFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null
  }

  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split('=')
    if (name === CSRF_COOKIE_NAME) {
      const value = valueParts.join('=')
      return decodeURIComponent(value)
    }
  }

  return null
}

// =============================================================================
// Middleware Helper
// =============================================================================

/**
 * Result of CSRF middleware check
 */
export interface CSRFCheckResult {
  valid: boolean
  error?: string
  errorCode?: 'missing_cookie' | 'missing_form_token' | 'mismatch' | 'expired' | 'invalid_format'
}

/**
 * Check CSRF for a request. Use this in route handlers.
 *
 * @param request - The incoming request
 * @returns Check result with detailed error info
 *
 * @example
 * ```typescript
 * async function handleLogin(request: Request) {
 *   const csrfCheck = await checkCSRF(request)
 *   if (!csrfCheck.valid) {
 *     return Response.json({ error: csrfCheck.error }, { status: 403 })
 *   }
 *   // Process login...
 * }
 * ```
 */
export async function checkCSRF(request: Request): Promise<CSRFCheckResult> {
  const cookieToken = extractCSRFFromCookie(request.headers.get('Cookie'))
  const formToken = await extractCSRFToken(request)

  const result = validateCSRFToken(cookieToken, formToken)

  if (!result.valid) {
    const errorMessages: Record<NonNullable<CSRFValidationResult['error']>, string> = {
      missing_cookie: 'Security token missing. Please refresh the page and try again.',
      missing_form_token: 'Security token not provided. Please try again.',
      mismatch: 'Security token invalid. Please refresh the page and try again.',
      expired: 'Security token expired. Please refresh the page and try again.',
      invalid_format: 'Invalid security token format.',
    }

    return {
      valid: false,
      error: errorMessages[result.error!],
      errorCode: result.error,
    }
  }

  return { valid: true }
}

// =============================================================================
// React Integration Helpers
// =============================================================================

/**
 * Generate CSRF meta tag content for SSR pages.
 * Include this in the HTML head for JavaScript access.
 *
 * @param token - The CSRF token
 * @returns Meta tag HTML string
 *
 * @example
 * ```tsx
 * // In SSR template
 * <head>
 *   {csrfMetaTag(csrfToken)}
 * </head>
 * ```
 */
export function csrfMetaTag(token: string): string {
  return `<meta name="csrf-token" content="${token}" />`
}

/**
 * Get CSRF token from meta tag (client-side).
 *
 * @returns CSRF token or null if not found
 *
 * @example
 * ```typescript
 * const token = getCSRFTokenFromMeta()
 * fetch('/api/action', {
 *   headers: { 'X-CSRF-Token': token }
 * })
 * ```
 */
export function getCSRFTokenFromMeta(): string | null {
  if (typeof globalThis.document === 'undefined') return null

  const meta = (globalThis.document as Document).querySelector('meta[name="csrf-token"]')
  return meta?.getAttribute('content') || null
}
