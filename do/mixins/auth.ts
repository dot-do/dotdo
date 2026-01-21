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

// Note: These DO auth guard types are placeholders for planned functionality
// The actual implementation in @dotdo/auth is not yet complete (do-xxxx)

// Placeholder types for DO-to-DO auth
export type CallerType = 'user' | 'worker' | 'do' | 'unknown'

export interface AuthPayload {
  sub: string
  iat?: number
  exp?: number
  [key: string]: unknown
}

export interface CallerInfo {
  type: CallerType
  trusted: boolean
  auth?: AuthPayload | null
  id?: string
  sourceDoId?: string
  sourceDoName?: string
  correlationId?: string
}

export interface DOAuthGuardConfig {
  secret?: string | Uint8Array
  jwksClient?: unknown
  issuer?: string | string[]
  audience?: string | string[]
}

export interface DOAuthGuard {
  validateCaller(request: Request): Promise<CallerInfo>
  canAccess(request: Request, doId?: string): Promise<boolean>
  validateToken(token: string): Promise<AuthPayload | null>
  getCallerId(request: Request): string | null
}

export interface CreateDOToDoHeadersOptions {
  sourceDoId: string
  sourceDoName?: string | undefined
  correlationId?: string | undefined
}

// Header constants
const CF_WORKER_HEADER = 'cf-worker'
const WORKER_NAME_HEADER = 'x-worker-name'
const DO_SOURCE_HEADER = 'x-do-source'
const DO_SOURCE_ID_HEADER = 'x-do-source-id'
const CORRELATION_ID_HEADER = 'x-correlation-id'
const INTERNAL_TRUST_HEADER = 'x-internal-trust'
const DO_SIGNATURE_HEADER = 'x-do-signature'
const DO_TIMESTAMP_HEADER = 'x-do-timestamp'
const DO_NONCE_HEADER = 'x-do-nonce'

// Placeholder implementations - to be replaced with actual @dotdo/auth exports
export function setDOInternalSecret(_secret: string): void {
  // Placeholder - will be implemented in @dotdo/auth
}

export function createDOAuthGuard(_config: DOAuthGuardConfig): DOAuthGuard {
  // Placeholder implementation
  return {
    async validateCaller(_request: Request): Promise<CallerInfo> {
      return { type: 'unknown', trusted: false }
    },
    async canAccess(_request: Request, _doId?: string): Promise<boolean> {
      return false
    },
    async validateToken(_token: string): Promise<AuthPayload | null> {
      return null
    },
    getCallerId(_request: Request): string | null {
      return null
    }
  }
}

export function extractCallerInfoWithVerification(_request: Request, _config?: DOAuthGuardConfig): Promise<CallerInfo> {
  return Promise.resolve({ type: 'unknown', trusted: false })
}

export function extractCallerInfo(_request: Request): CallerInfo {
  return { type: 'unknown', trusted: false }
}

export function detectCallerType(_request: Request): CallerType {
  return 'unknown'
}

export function verifyDOSignature(_request: Request, _secret?: string): boolean {
  return false
}

export function extractDONonce(_request: Request): string | null {
  return null
}

export async function addDOSourceHeadersAsync(
  _headers: Headers,
  _options: CreateDOToDoHeadersOptions,
  _secret?: string
): Promise<void> {
  // Placeholder
}

export function createDOToDoHeaders(_options: CreateDOToDoHeadersOptions): Headers {
  return new Headers()
}

export function addWorkerHeaders(_headers: Headers, _workerName?: string): void {
  // Placeholder
}
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
      const doId = (this as unknown as { state?: { id?: { toString(): string } } }).state?.id?.toString() ?? 'unknown'
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
      _targetPath?: string,
      correlationId?: string
    ): Promise<Headers> {
      return createDOToDoHeaders({ sourceDoId, correlationId })
    }
  }
}

// =============================================================================
// Re-exports (types and functions are already exported at the top of this file)
// =============================================================================

// Export header constants
export {
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  INTERNAL_TRUST_HEADER,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER,
  DO_NONCE_HEADER
}
