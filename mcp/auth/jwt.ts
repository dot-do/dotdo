/**
 * JWT Validation
 *
 * JWT token validation using the jose library.
 * Provides secure token verification with proper signature and claims validation.
 */

import * as jose from 'jose'
import type { JwtPayload, AuthContext, McpEnv } from '../types'
import { isJwtPayload } from '../types'

// ============================================================================
// Constants
// ============================================================================

/** JWT algorithm */
const JWT_ALGORITHM = 'HS256'

/** Default token expiration (24 hours) */
const DEFAULT_EXPIRATION = '24h'

/** Clock tolerance for token validation (60 seconds) */
const CLOCK_TOLERANCE = 60

// ============================================================================
// JWT Creation
// ============================================================================

/**
 * Create a signed JWT token
 */
export async function createJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  options: { expiresIn?: string } = {}
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)
  const expiresIn = options.expiresIn || DEFAULT_EXPIRATION

  const jwt = await new jose.SignJWT({
    ...payload,
    permissions: payload.permissions || [],
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setSubject(payload.sub)
    .setExpirationTime(expiresIn)
    .sign(secretKey)

  return jwt
}

// ============================================================================
// JWT Validation
// ============================================================================

/**
 * Validate and decode a JWT token
 */
export async function validateJwt(
  token: string,
  secret: string
): Promise<{ valid: true; payload: JwtPayload } | { valid: false; error: string }> {
  try {
    const secretKey = new TextEncoder().encode(secret)

    const { payload } = await jose.jwtVerify(token, secretKey, {
      algorithms: [JWT_ALGORITHM],
      clockTolerance: CLOCK_TOLERANCE,
    })

    // Validate payload structure
    const jwtPayload: JwtPayload = {
      sub: payload.sub as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      email: payload.email as string | undefined,
      org_id: payload.org_id as string | undefined,
      permissions: (payload.permissions as string[]) || [],
    }

    if (!isJwtPayload(jwtPayload)) {
      return { valid: false, error: 'Invalid JWT payload structure' }
    }

    return { valid: true, payload: jwtPayload }
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      return { valid: false, error: 'Token has expired' }
    }
    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      return { valid: false, error: 'Token claim validation failed' }
    }
    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      return { valid: false, error: 'Invalid token signature' }
    }
    if (err instanceof jose.errors.JWTInvalid) {
      return { valid: false, error: 'Invalid token format' }
    }

    return { valid: false, error: 'Token validation failed: invalid or malformed token' }
  }
}

/**
 * Decode a JWT without verification (for inspection only)
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    // Check for empty or malformed tokens before attempting decode
    if (!token || token.trim() === '') {
      console.error(
        '[jwt] JWT decode failed: empty token provided',
        'errorType:', 'EMPTY_TOKEN'
      )
      return null
    }

    // Check for proper JWT structure (should have 2 or 3 parts separated by dots)
    const parts = token.split('.')
    if (parts.length < 2 || parts.length > 3) {
      console.error(
        '[jwt] JWT decode failed: malformed token structure',
        'errorType:', 'MALFORMED_TOKEN',
        'tokenParts:', parts.length,
        'expectedParts: 2 or 3'
      )
      return null
    }

    const decoded = jose.decodeJwt(token)

    const payload: JwtPayload = {
      sub: decoded.sub as string,
      iat: decoded.iat as number,
      exp: decoded.exp as number,
      email: decoded.email as string | undefined,
      org_id: decoded.org_id as string | undefined,
      permissions: (decoded.permissions as string[]) || [],
    }

    // Check for suspicious payload patterns
    if (decoded.sub && typeof decoded.sub === 'string' && decoded.sub.includes('..')) {
      console.error(
        '[jwt] JWT decode warning: suspicious subject claim',
        'errorType:', 'SUSPICIOUS_PAYLOAD',
        'sub:', decoded.sub
      )
    }

    // Capture diagnostic values before type guard narrows the type
    const hasSub = !!payload.sub
    const hasIat = !!payload.iat
    const hasExp = !!payload.exp

    if (!isJwtPayload(payload)) {
      console.error(
        '[jwt] JWT decode failed: invalid payload structure',
        'errorType:', 'INVALID_PAYLOAD',
        'hasSub:', hasSub,
        'hasIat:', hasIat,
        'hasExp:', hasExp
      )
      return null
    }

    return payload
  } catch (err) {
    // Log the decode error for security monitoring
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(
      '[jwt] JWT decode failed:',
      'errorType:', 'DECODE_ERROR',
      'error:', errMsg,
      'tokenLength:', token?.length ?? 0,
      'tokenPreview:', token?.substring(0, 20) + (token?.length > 20 ? '...' : '')
    )
    return null
  }
}

// ============================================================================
// Request Authentication
// ============================================================================

/**
 * Extract bearer token from request
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7)
}

/**
 * Extract token from query string (for SSE connections)
 */
export function extractQueryToken(url: URL): string | null {
  return url.searchParams.get('token')
}

/**
 * Authenticate a request using JWT
 */
export async function authenticateRequest(
  request: Request,
  env: Pick<McpEnv, 'JWT_SECRET'>
): Promise<AuthContext> {
  const url = new URL(request.url)

  // Try bearer token first, then query param (for SSE)
  const token = extractBearerToken(request) || extractQueryToken(url)

  if (!token) {
    return {
      authenticated: false,
      permissions: [],
    }
  }

  const result = await validateJwt(token, env.JWT_SECRET)

  if (!result.valid) {
    return {
      authenticated: false,
      permissions: [],
    }
  }

  return {
    authenticated: true,
    userId: result.payload.sub,
    permissions: result.payload.permissions,
    jwt: result.payload,
  }
}

// ============================================================================
// Permission Checking
// ============================================================================

/**
 * Check if a user has a specific permission
 */
export function hasPermission(
  permissions: string[],
  required: string
): boolean {
  // Wildcard permission grants all
  if (permissions.includes('*')) {
    return true
  }

  // Direct permission check
  if (permissions.includes(required)) {
    return true
  }

  // Hierarchical permission check (e.g., 'tools:*' grants 'tools:search')
  const parts = required.split(':')
  for (let i = parts.length - 1; i > 0; i--) {
    const wildcard = [...parts.slice(0, i), '*'].join(':')
    if (permissions.includes(wildcard)) {
      return true
    }
  }

  return false
}

/**
 * Check if a user has all required permissions
 */
export function hasAllPermissions(
  permissions: string[],
  required: string[]
): boolean {
  return required.every((perm) => hasPermission(permissions, perm))
}

/**
 * Check if a user has any of the required permissions
 */
export function hasAnyPermission(
  permissions: string[],
  required: string[]
): boolean {
  return required.some((perm) => hasPermission(permissions, perm))
}

// ============================================================================
// Token Refresh
// ============================================================================

/**
 * Check if a token needs refresh (within 5 minutes of expiry)
 */
export function tokenNeedsRefresh(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000)
  const refreshThreshold = 5 * 60 // 5 minutes
  return payload.exp - now < refreshThreshold
}

/**
 * Refresh a JWT token with new expiration
 */
export async function refreshJwt(
  payload: JwtPayload,
  secret: string,
  options: { expiresIn?: string } = {}
): Promise<string> {
  return createJwt(
    {
      sub: payload.sub,
      email: payload.email,
      org_id: payload.org_id,
      permissions: payload.permissions,
    },
    secret,
    options
  )
}
