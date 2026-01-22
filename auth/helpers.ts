/**
 * Shared authentication helpers
 *
 * Common utilities used by multiple auth middleware implementations.
 * This module reduces code duplication between middleware.ts and jwt.ts.
 *
 * @module @dotdo/auth/helpers
 * @internal
 */

import { getCookie } from '@dotdo/utils/cookies'
import {
  TokenValidationError,
  MissingTokenError,
  InvalidAuthHeaderError,
} from './errors'
import type { AuthUser } from './middleware'

/**
 * Result of token extraction with detailed error information
 */
export interface TokenExtractionResult {
  /** The extracted token, or null if extraction failed */
  token: string | null
  /** Error details if extraction failed */
  error?: TokenValidationError
}

/**
 * Extract Bearer token from Authorization header.
 *
 * Validates the header format and extracts the token.
 * Returns detailed error information for different failure modes.
 *
 * @param authHeader - The Authorization header value
 * @returns Result with token and optional error details
 */
export function extractBearerTokenFromHeader(authHeader: string | null | undefined): TokenExtractionResult {
  if (!authHeader) {
    return {
      token: null,
      error: new MissingTokenError('header'),
    }
  }

  const parts = authHeader.trim().split(/\s+/)
  const scheme = parts[0]
  const token = parts[1]

  if (!scheme) {
    return {
      token: null,
      error: new InvalidAuthHeaderError('missing_scheme'),
    }
  }

  if (scheme !== 'Bearer') {
    return {
      token: null,
      error: new InvalidAuthHeaderError('wrong_scheme'),
    }
  }

  if (!token) {
    return {
      token: null,
      error: new InvalidAuthHeaderError('missing_token'),
    }
  }

  return { token: token.trim() }
}

/**
 * Extract token from a cookie header.
 *
 * @param cookieHeader - The Cookie header value
 * @param cookieName - Name of the cookie to extract
 * @returns The token value or null if not found
 */
export function extractTokenFromCookie(cookieHeader: string | null, cookieName: string): string | null {
  return getCookie(cookieHeader, cookieName)
}

/**
 * Extract Bearer token from request, trying Authorization header first, then cookies.
 *
 * @param request - The incoming request
 * @param cookieName - Optional cookie name to check if header not present
 * @returns Result with token and optional error details
 */
export function extractBearerToken(request: Request, cookieName?: string): TokenExtractionResult {
  // Try Authorization header first
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    return extractBearerTokenFromHeader(authHeader)
  }

  // Try cookie if specified and header not present
  if (cookieName) {
    const cookieHeader = request.headers.get('Cookie')
    const token = extractTokenFromCookie(cookieHeader, cookieName)
    if (token) {
      return { token }
    }
  }

  return {
    token: null,
    error: new MissingTokenError(cookieName ? 'both' : 'header'),
  }
}

/**
 * Extract AuthUser from a JWT payload.
 *
 * Maps standard JWT claims (sub, email, roles, scopes) to AuthUser structure.
 *
 * @param payload - The verified JWT payload
 * @returns AuthUser object with extracted claims
 */
export function extractUserFromPayload(payload: {
  sub?: string
  email?: unknown
  roles?: unknown
  scopes?: unknown
  [key: string]: unknown
}): AuthUser | null {
  if (!payload.sub) {
    return null
  }

  // Extract claims safely using index signature access
  const email = typeof payload['email'] === 'string' ? payload['email'] : undefined
  const roles = payload['roles']
  const scopes = payload['scopes']

  return {
    id: payload.sub,
    email,
    roles: Array.isArray(roles) ? roles : [],
    scopes: Array.isArray(scopes) ? scopes : [],
  }
}
