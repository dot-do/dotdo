/**
 * DO-level Authentication Guards
 *
 * Enforces trust boundaries for Durable Object requests.
 *
 * Trust model:
 * - Worker-to-DO: Internal trust (same Cloudflare account, verified via CF headers)
 * - User-to-DO: External trust (JWT validation required)
 * - DO-to-DO: Internal trust (verified via DO ID and correlation headers)
 *
 * @module do/auth
 */

import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AuthUser } from '../auth/middleware'
import { extractToken, verifyTokenSignature, type TokenPayload } from '../auth/token'
import { verifyTokenWithJwks, type JwksClient } from '../auth/jwks'

// ============================================================================
// Types
// ============================================================================

/**
 * Caller type for DO requests
 */
export type CallerType = 'worker' | 'user' | 'do' | 'unknown'

/**
 * Authentication payload returned from token validation
 */
export interface AuthPayload {
  /** Subject (user ID or service ID) */
  sub: string
  /** Email address (if available) */
  email?: string
  /** User roles */
  roles?: string[]
  /** Permission scopes */
  scopes?: string[]
  /** Issuer of the token */
  iss?: string
  /** Audience the token was issued for */
  aud?: string | string[]
  /** Expiration timestamp */
  exp?: number
  /** Issued at timestamp */
  iat?: number
  /** Additional claims */
  [key: string]: unknown
}

/**
 * Caller information extracted from request
 */
export interface CallerInfo {
  /** Type of caller */
  type: CallerType
  /** Caller identifier (user ID, DO ID, or worker name) */
  id: string | null
  /** Full auth payload (for user requests) */
  auth?: AuthPayload
  /** Source DO ID (for DO-to-DO calls) */
  sourceDoId?: string
  /** Whether this is a trusted internal call */
  trusted: boolean
}

/**
 * DO Auth Guard interface - defines the contract for DO authentication
 */
export interface DOAuthGuard {
  /**
   * Check if a request can access this DO
   * @param request - The incoming request
   * @param doId - The target DO's ID
   * @returns Whether access is allowed
   */
  canAccess(request: Request, doId: string): Promise<boolean>

  /**
   * Get the caller's identifier from the request
   * @param request - The incoming request
   * @returns Caller ID or null if not identifiable
   */
  getCallerId(request: Request): string | null

  /**
   * Validate a token and return the auth payload
   * @param token - The token to validate
   * @returns Auth payload or null if invalid
   */
  validateToken(token: string): Promise<AuthPayload | null>
}

/**
 * Configuration for DO auth guards
 */
export interface DOAuthGuardConfig {
  /** JWT secret for symmetric token validation */
  secret?: string | Uint8Array
  /** JWKS client for asymmetric token validation */
  jwksClient?: JwksClient
  /** Expected issuer(s) for token validation */
  issuer?: string | string[]
  /** Expected audience(s) for token validation */
  audience?: string | string[]
  /** Allow unauthenticated requests (default: false) */
  allowAnonymous?: boolean
  /** Trusted worker names (for worker-to-DO trust) */
  trustedWorkers?: string[]
  /** Whether to trust DO-to-DO calls (default: true) */
  trustDoToDo?: boolean
  /** Custom trust verification function */
  customTrustCheck?: (request: Request, callerInfo: CallerInfo) => Promise<boolean>
}

// ============================================================================
// Headers
// ============================================================================

/**
 * Header indicating the request is from a Cloudflare Worker
 * This is set by the Cloudflare runtime for internal requests
 */
export const CF_WORKER_HEADER = 'cf-worker'

/**
 * Header containing the worker name (set by us in the API layer)
 */
export const WORKER_NAME_HEADER = 'X-Worker-Name'

/**
 * Header indicating request is from another DO
 */
export const DO_SOURCE_HEADER = 'X-DO-Source'

/**
 * Header containing the source DO's ID
 */
export const DO_SOURCE_ID_HEADER = 'X-DO-Source-ID'

/**
 * Correlation ID header (from rpc/client.ts)
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'

/**
 * Header indicating internal trust chain
 */
export const INTERNAL_TRUST_HEADER = 'X-Internal-Trust'

// ============================================================================
// Caller Detection
// ============================================================================

/**
 * Detect the type of caller from request headers
 */
export function detectCallerType(request: Request): CallerType {
  // Check for DO-to-DO call first (most specific)
  if (request.headers.get(DO_SOURCE_HEADER) === 'true') {
    return 'do'
  }

  // Check for Worker-to-DO call (internal)
  if (request.headers.get(CF_WORKER_HEADER) || request.headers.get(WORKER_NAME_HEADER)) {
    return 'worker'
  }

  // Check for user request (has Authorization header)
  if (request.headers.get('Authorization')) {
    return 'user'
  }

  return 'unknown'
}

/**
 * Extract caller information from request
 */
export function extractCallerInfo(request: Request): CallerInfo {
  const type = detectCallerType(request)

  switch (type) {
    case 'do':
      return {
        type: 'do',
        id: request.headers.get(DO_SOURCE_ID_HEADER),
        sourceDoId: request.headers.get(DO_SOURCE_ID_HEADER) ?? undefined,
        trusted: true, // DO-to-DO is trusted by default
      }

    case 'worker':
      return {
        type: 'worker',
        id: request.headers.get(WORKER_NAME_HEADER) || request.headers.get(CF_WORKER_HEADER),
        trusted: true, // Worker-to-DO is trusted (same CF account)
      }

    case 'user':
      return {
        type: 'user',
        id: null, // Will be populated after token validation
        trusted: false, // User requests need explicit validation
      }

    default:
      return {
        type: 'unknown',
        id: null,
        trusted: false,
      }
  }
}

// ============================================================================
// Auth Guard Implementation
// ============================================================================

/**
 * Create a DO auth guard with the given configuration
 */
export function createDOAuthGuard(config: DOAuthGuardConfig = {}): DOAuthGuard {
  const {
    secret,
    jwksClient,
    issuer,
    audience,
    allowAnonymous = false,
    trustedWorkers = [],
    trustDoToDo = true,
    customTrustCheck,
  } = config

  return {
    async canAccess(request: Request, doId: string): Promise<boolean> {
      const callerInfo = extractCallerInfo(request)

      // DO-to-DO trust
      if (callerInfo.type === 'do') {
        if (!trustDoToDo) {
          return false
        }
        // Optionally verify the source DO ID
        if (customTrustCheck) {
          return customTrustCheck(request, callerInfo)
        }
        return true
      }

      // Worker-to-DO trust
      if (callerInfo.type === 'worker') {
        // If trustedWorkers list is specified, verify worker name
        if (trustedWorkers.length > 0) {
          const workerName = callerInfo.id
          return workerName ? trustedWorkers.includes(workerName) : false
        }
        // Default: trust all workers in same CF account
        return true
      }

      // User requests need token validation
      if (callerInfo.type === 'user') {
        const token = extractToken(request)
        if (!token) {
          return allowAnonymous
        }

        const payload = await this.validateToken(token)
        return payload !== null
      }

      // Unknown caller type
      return allowAnonymous
    },

    getCallerId(request: Request): string | null {
      const callerInfo = extractCallerInfo(request)

      if (callerInfo.type === 'do') {
        return callerInfo.sourceDoId ?? null
      }

      if (callerInfo.type === 'worker') {
        return callerInfo.id
      }

      if (callerInfo.type === 'user') {
        // Extract from token (would need to be cached from validation)
        const token = extractToken(request)
        if (token) {
          try {
            // Decode without verification just to get the subject
            const parts = token.split('.')
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]))
              return payload.sub ?? null
            }
          } catch {
            // Invalid token format
          }
        }
      }

      return null
    },

    async validateToken(token: string): Promise<AuthPayload | null> {
      try {
        // Try JWKS validation first if client is available
        if (jwksClient) {
          const payload = await verifyTokenWithJwks(token, jwksClient, {
            issuer: issuer ? (Array.isArray(issuer) ? issuer : [issuer]) : undefined,
            audience: audience ? (Array.isArray(audience) ? audience : [audience]) : undefined,
          })
          return payload as AuthPayload
        }

        // Fall back to symmetric secret validation
        if (secret) {
          const payload = await verifyTokenSignature(token, {
            secret: typeof secret === 'string' ? secret : secret,
            issuer: Array.isArray(issuer) ? issuer[0] : issuer,
            audience: Array.isArray(audience) ? audience[0] : audience,
          })
          return payload as AuthPayload
        }

        // No validation configured - decode without verification (NOT RECOMMENDED)
        console.warn('[DOAuthGuard] No secret or JWKS client configured - tokens will not be verified')
        const parts = token.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]))
          return payload as AuthPayload
        }

        return null
      } catch (error) {
        console.error('[DOAuthGuard] Token validation failed:', error)
        return null
      }
    },
  }
}

// ============================================================================
// Hono Middleware
// ============================================================================

/**
 * Options for the DO auth middleware
 */
export interface DOAuthMiddlewareOptions extends DOAuthGuardConfig {
  /** Paths to skip authentication for */
  skipPaths?: string[]
  /** Custom error handler */
  onError?: (error: Error, c: Context) => Response | Promise<Response>
}

/**
 * Hono context variables for DO auth
 */
declare module 'hono' {
  interface ContextVariableMap {
    callerInfo: CallerInfo
    doAuth: DOAuthGuard
  }
}

/**
 * Create Hono middleware for DO authentication
 *
 * This middleware:
 * 1. Detects the caller type (worker, user, or DO)
 * 2. Validates credentials based on caller type
 * 3. Sets callerInfo in context for downstream handlers
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { doAuthMiddleware } from '@dotdo/do/auth'
 *
 * const app = new Hono()
 *
 * // Apply auth middleware
 * app.use('/*', doAuthMiddleware({
 *   secret: env.JWT_SECRET,
 *   skipPaths: ['/health', '/'],
 * }))
 *
 * // Access caller info in handlers
 * app.post('/action', (c) => {
 *   const { callerInfo } = c.var
 *   console.log(`Request from ${callerInfo.type}: ${callerInfo.id}`)
 *   // ...
 * })
 * ```
 */
export function doAuthMiddleware(options: DOAuthMiddlewareOptions = {}): MiddlewareHandler {
  const { skipPaths = ['/'], onError, ...guardConfig } = options
  const guard = createDOAuthGuard(guardConfig)

  return async (c, next) => {
    // Skip auth for specified paths
    if (skipPaths.some((path) => c.req.path === path || c.req.path.startsWith(path + '/'))) {
      // Still extract caller info for logging
      const callerInfo = extractCallerInfo(c.req.raw)
      c.set('callerInfo', callerInfo)
      c.set('doAuth', guard)
      return next()
    }

    try {
      // Extract caller information
      const callerInfo = extractCallerInfo(c.req.raw)

      // Get DO ID from the request (could be from path, header, or state)
      const doId = c.req.header('X-DO-ID') || c.req.path.split('/')[1] || 'unknown'

      // Check if caller can access this DO
      const canAccess = await guard.canAccess(c.req.raw, doId)

      if (!canAccess) {
        throw new HTTPException(401, {
          message: `Access denied for ${callerInfo.type} caller`,
        })
      }

      // For user requests, validate token and populate auth info
      if (callerInfo.type === 'user') {
        const token = extractToken(c.req.raw)
        if (token) {
          const payload = await guard.validateToken(token)
          if (payload) {
            callerInfo.auth = payload
            callerInfo.id = payload.sub

            // Set user in context for compatibility with existing guards
            c.set('user', {
              id: payload.sub,
              email: payload.email,
              roles: payload.roles || [],
              scopes: payload.scopes || [],
            } as AuthUser)
            c.set('token', token)
          }
        }
      }

      // Set caller info in context
      c.set('callerInfo', callerInfo)
      c.set('doAuth', guard)

      return next()
    } catch (error) {
      if (onError && error instanceof Error) {
        return onError(error, c)
      }

      if (error instanceof HTTPException) {
        throw error
      }

      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : 'Authentication error',
      })
    }
  }
}

// ============================================================================
// Specialized Guards
// ============================================================================

/**
 * Guard that only allows worker-to-DO calls
 * Use this for internal-only endpoints
 */
export function requireWorkerCaller(): MiddlewareHandler {
  return async (c, next) => {
    const callerInfo = c.get('callerInfo')

    if (!callerInfo) {
      throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' })
    }

    if (callerInfo.type !== 'worker') {
      throw new HTTPException(403, {
        message: 'This endpoint is only accessible from workers',
      })
    }

    return next()
  }
}

/**
 * Guard that only allows DO-to-DO calls
 * Use this for internal DO communication endpoints
 */
export function requireDOCaller(): MiddlewareHandler {
  return async (c, next) => {
    const callerInfo = c.get('callerInfo')

    if (!callerInfo) {
      throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' })
    }

    if (callerInfo.type !== 'do') {
      throw new HTTPException(403, {
        message: 'This endpoint is only accessible from other DOs',
      })
    }

    return next()
  }
}

/**
 * Guard that only allows authenticated user calls
 * Use this for user-facing endpoints
 */
export function requireUserCaller(): MiddlewareHandler {
  return async (c, next) => {
    const callerInfo = c.get('callerInfo')

    if (!callerInfo) {
      throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' })
    }

    if (callerInfo.type !== 'user') {
      throw new HTTPException(403, {
        message: 'This endpoint requires user authentication',
      })
    }

    if (!callerInfo.auth) {
      throw new HTTPException(401, {
        message: 'Valid authentication token required',
      })
    }

    return next()
  }
}

/**
 * Guard that allows internal calls (worker or DO)
 * Use this for internal system endpoints
 */
export function requireInternalCaller(): MiddlewareHandler {
  return async (c, next) => {
    const callerInfo = c.get('callerInfo')

    if (!callerInfo) {
      throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' })
    }

    if (callerInfo.type !== 'worker' && callerInfo.type !== 'do') {
      throw new HTTPException(403, {
        message: 'This endpoint is only accessible internally',
      })
    }

    return next()
  }
}

/**
 * Guard that requires specific DO source
 * Use this to restrict which DOs can call this endpoint
 */
export function requireDOSource(...allowedDOs: string[]): MiddlewareHandler {
  return async (c, next) => {
    const callerInfo = c.get('callerInfo')

    if (!callerInfo) {
      throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' })
    }

    if (callerInfo.type !== 'do') {
      throw new HTTPException(403, {
        message: 'This endpoint is only accessible from other DOs',
      })
    }

    if (!callerInfo.sourceDoId || !allowedDOs.includes(callerInfo.sourceDoId)) {
      throw new HTTPException(403, {
        message: `Access denied from DO: ${callerInfo.sourceDoId}`,
      })
    }

    return next()
  }
}

// ============================================================================
// Helpers for Cross-DO Calls
// ============================================================================

/**
 * Add DO source headers to a request for cross-DO calls
 * Call this when making requests from one DO to another
 *
 * @example
 * ```typescript
 * const headers = addDOSourceHeaders(new Headers(), 'my-do-id')
 * const response = await otherDO.fetch('https://do/endpoint', {
 *   headers,
 * })
 * ```
 */
export function addDOSourceHeaders(headers: Headers, sourceDoId: string): Headers {
  headers.set(DO_SOURCE_HEADER, 'true')
  headers.set(DO_SOURCE_ID_HEADER, sourceDoId)
  return headers
}

/**
 * Create headers for a DO-to-DO request
 */
export function createDOToDoHeaders(sourceDoId: string, correlationId?: string): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    [DO_SOURCE_HEADER]: 'true',
    [DO_SOURCE_ID_HEADER]: sourceDoId,
  })

  if (correlationId) {
    headers.set(CORRELATION_ID_HEADER, correlationId)
  }

  return headers
}

/**
 * Add worker identification headers
 * Call this in the Worker layer when forwarding to DOs
 */
export function addWorkerHeaders(headers: Headers, workerName: string): Headers {
  headers.set(WORKER_NAME_HEADER, workerName)
  return headers
}
