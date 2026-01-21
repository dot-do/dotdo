/**
 * Auth Mixin for Durable Objects
 *
 * Provides composable authentication and authorization including:
 * - JWT token validation
 * - Caller type detection (worker, user, DO)
 * - DO-to-DO trust verification with HMAC
 * - Request authorization guards
 *
 * @example
 * ```typescript
 * class MyDO extends WithAuth(BaseDO, {
 *   secret: env.JWT_SECRET,
 *   trustDoToDo: true
 * }) {
 *   async fetch(request: Request) {
 *     // Validate caller
 *     const callerInfo = await this.validateCaller(request)
 *
 *     if (callerInfo.type === 'user' && !callerInfo.auth) {
 *       return new Response('Unauthorized', { status: 401 })
 *     }
 *
 *     // Process request...
 *   }
 * }
 * ```
 *
 * @module do/mixins/auth
 */

import {
  createDOAuthGuard,
  extractCallerInfoWithVerification,
  extractCallerInfo,
  detectCallerType,
  verifyDOSignature,
  setDOInternalSecret,
  addDOSourceHeadersAsync,
  createDOToDoHeaders,
  addWorkerHeaders,
  type DOAuthGuard,
  type DOAuthGuardConfig,
  type CallerInfo,
  type CallerType,
  type AuthPayload,
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  INTERNAL_TRUST_HEADER,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER
} from '../auth'
import type { Constructor } from './storage'

// =============================================================================
// Types
// =============================================================================

/**
 * Interface for classes that have Auth capabilities
 */
export interface HasAuth {
  /** The auth guard instance */
  readonly authGuard: DOAuthGuard
  /** Validate caller and get caller info with signature verification */
  validateCaller(request: Request): Promise<CallerInfo>
  /** Quick check if request can access this DO */
  canAccess(request: Request): Promise<boolean>
  /** Validate a JWT token */
  validateToken(token: string): Promise<AuthPayload | null>
  /** Get caller ID from request */
  getCallerId(request: Request): string | null
}

/**
 * Options for the WithAuth mixin
 */
export interface WithAuthOptions extends DOAuthGuardConfig {
  /** DO internal secret for HMAC signing (for DO-to-DO calls) */
  doInternalSecret?: string
}

// =============================================================================
// Mixin Implementation
// =============================================================================

/**
 * Auth mixin that adds authentication and authorization to a Durable Object.
 *
 * This mixin provides:
 * - JWT token validation (symmetric or JWKS)
 * - Caller detection (worker, user, DO)
 * - DO-to-DO trust verification with HMAC signatures
 * - Request authorization guards
 *
 * @template TBase - The base class constructor type
 * @param Base - The base class to extend
 * @param options - Configuration for auth behavior
 * @returns A new class with auth capabilities
 *
 * @example
 * ```typescript
 * // Basic usage with JWT secret
 * class SecureDO extends WithAuth(BaseDO, {
 *   secret: env.JWT_SECRET,
 *   issuer: 'my-app',
 *   audience: 'my-api'
 * }) {
 *   async fetch(request: Request) {
 *     // Validate caller
 *     const callerInfo = await this.validateCaller(request)
 *
 *     if (callerInfo.type === 'user') {
 *       // User request - check auth
 *       if (!callerInfo.auth) {
 *         return new Response('Unauthorized', { status: 401 })
 *       }
 *       console.log('User ID:', callerInfo.auth.sub)
 *     } else if (callerInfo.type === 'do') {
 *       // DO-to-DO call - verify trust
 *       if (!callerInfo.trusted) {
 *         return new Response('Forbidden', { status: 403 })
 *       }
 *       console.log('Source DO:', callerInfo.sourceDoId)
 *     }
 *
 *     // Process request...
 *   }
 * }
 *
 * // With JWKS client
 * class JWKSAuthDO extends WithAuth(BaseDO, {
 *   jwksClient: createJwksClient('https://auth.example.com/.well-known/jwks.json'),
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api'
 * }) {
 *   // ...
 * }
 *
 * // Composing with other mixins
 * class FullFeatureDO extends WithAuth(WithStorage(BaseDO), {
 *   secret: env.JWT_SECRET
 * }) {
 *   // Has both auth and storage capabilities
 * }
 * ```
 */
export function WithAuth<TBase extends Constructor>(
  Base: TBase,
  options: WithAuthOptions = {}
) {
  const { doInternalSecret, ...guardConfig } = options

  // Set DO internal secret if provided
  if (doInternalSecret) {
    setDOInternalSecret(doInternalSecret)
  }

  return class AuthMixin extends Base implements HasAuth {
    private _authGuard: DOAuthGuard

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this._authGuard = createDOAuthGuard(guardConfig)
    }

    /**
     * Access to the auth guard for custom validation
     *
     * @example
     * ```typescript
     * // Use the guard directly for custom checks
     * const payload = await this.authGuard.validateToken(token)
     * ```
     */
    get authGuard(): DOAuthGuard {
      return this._authGuard
    }

    /**
     * Validate caller and extract caller information with full security checks.
     *
     * This method:
     * - Detects caller type (worker, user, DO)
     * - Verifies HMAC signatures for DO-to-DO calls
     * - Validates JWT tokens for user requests
     * - Returns detailed caller info
     *
     * @param request - The incoming request
     * @returns Caller information including type, ID, and auth payload
     *
     * @example
     * ```typescript
     * async fetch(request: Request) {
     *   const callerInfo = await this.validateCaller(request)
     *
     *   switch (callerInfo.type) {
     *     case 'worker':
     *       // Trusted internal call from worker
     *       console.log('Worker:', callerInfo.id)
     *       break
     *
     *     case 'do':
     *       // DO-to-DO call
     *       if (callerInfo.trusted) {
     *         console.log('Trusted DO:', callerInfo.sourceDoId)
     *       } else {
     *         return new Response('Invalid DO signature', { status: 403 })
     *       }
     *       break
     *
     *     case 'user':
     *       // User request
     *       if (callerInfo.auth) {
     *         console.log('User:', callerInfo.auth.sub)
     *       } else {
     *         return new Response('Unauthorized', { status: 401 })
     *       }
     *       break
     *
     *     default:
     *       return new Response('Unknown caller', { status: 403 })
     *   }
     * }
     * ```
     */
    async validateCaller(request: Request): Promise<CallerInfo> {
      // Use secure verification that validates HMAC signatures
      const callerInfo = await extractCallerInfoWithVerification(request)

      // For user requests, validate token and populate auth info
      if (callerInfo.type === 'user') {
        const authHeader = request.headers.get('Authorization')
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7)
          const payload = await this._authGuard.validateToken(token)
          if (payload) {
            callerInfo.auth = payload
            callerInfo.id = payload.sub
          }
        }
      }

      return callerInfo
    }

    /**
     * Quick check if a request can access this DO.
     *
     * Uses the auth guard's canAccess method which:
     * - Trusts verified DO-to-DO calls (if trustDoToDo is enabled)
     * - Trusts worker calls (if worker is in trustedWorkers list or default trust)
     * - Validates JWT tokens for user requests
     * - Returns false for unknown callers (unless allowAnonymous is true)
     *
     * @param request - The incoming request
     * @returns True if access is allowed
     *
     * @example
     * ```typescript
     * async fetch(request: Request) {
     *   // Quick access check
     *   if (!await this.canAccess(request)) {
     *     return new Response('Access denied', { status: 403 })
     *   }
     *
     *   // Process request...
     * }
     * ```
     */
    async canAccess(request: Request): Promise<boolean> {
      // Get DO ID from instance if available
      const doId = (this as any).state?.id?.toString() ?? 'unknown'
      return this._authGuard.canAccess(request, doId)
    }

    /**
     * Validate a JWT token and return the auth payload.
     *
     * @param token - The JWT token to validate
     * @returns Auth payload if valid, null otherwise
     *
     * @example
     * ```typescript
     * const token = request.headers.get('Authorization')?.slice(7)
     * if (token) {
     *   const payload = await this.validateToken(token)
     *   if (payload) {
     *     console.log('User:', payload.sub)
     *     console.log('Roles:', payload.roles)
     *   }
     * }
     * ```
     */
    async validateToken(token: string): Promise<AuthPayload | null> {
      return this._authGuard.validateToken(token)
    }

    /**
     * Get the caller's identifier from the request.
     *
     * @param request - The incoming request
     * @returns Caller ID or null
     *
     * @example
     * ```typescript
     * const callerId = this.getCallerId(request)
     * console.log('Request from:', callerId)
     * ```
     */
    getCallerId(request: Request): string | null {
      return this._authGuard.getCallerId(request)
    }

    /**
     * Create headers for making a DO-to-DO request with HMAC signature.
     *
     * Use this when calling other DOs to ensure proper authentication.
     *
     * @param sourceDoId - This DO's ID
     * @param targetPath - The target path being called
     * @param correlationId - Optional correlation ID for tracing
     * @returns Headers with DO authentication
     *
     * @example
     * ```typescript
     * async callOtherDO(targetStub: DurableObjectStub, method: string, args: unknown[]) {
     *   const headers = await this.createDOToDoHeaders(
     *     this.state.id.toString(),
     *     '/rpc'
     *   )
     *
     *   return targetStub.fetch('https://do/rpc', {
     *     method: 'POST',
     *     headers,
     *     body: JSON.stringify({ method, args })
     *   })
     * }
     * ```
     */
    protected async createDOToDoHeaders(
      sourceDoId: string,
      targetPath?: string,
      correlationId?: string
    ): Promise<Headers> {
      return createDOToDoHeaders(sourceDoId, targetPath, correlationId)
    }
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export {
  createDOAuthGuard,
  extractCallerInfoWithVerification,
  extractCallerInfo,
  detectCallerType,
  verifyDOSignature,
  setDOInternalSecret,
  addDOSourceHeadersAsync,
  createDOToDoHeaders,
  addWorkerHeaders,
  type DOAuthGuard,
  type DOAuthGuardConfig,
  type CallerInfo,
  type CallerType,
  type AuthPayload,
  // Headers
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  INTERNAL_TRUST_HEADER,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER
}
