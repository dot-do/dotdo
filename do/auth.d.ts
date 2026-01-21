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
import type { MiddlewareHandler, Context } from 'hono';
import { type JwksClient } from '../auth/jwks';
import { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER, DO_SIGNATURE_HEADER, DO_TIMESTAMP_HEADER, CF_WORKER_HEADER, WORKER_NAME_HEADER, INTERNAL_TRUST_HEADER, CORRELATION_ID_HEADER } from '../rpc/headers';
/**
 * Caller type for DO requests
 */
export type CallerType = 'worker' | 'user' | 'do' | 'unknown';
/**
 * Authentication payload returned from token validation
 */
export interface AuthPayload {
    /** Subject (user ID or service ID) */
    sub: string;
    /** Email address (if available) */
    email?: string;
    /** User roles */
    roles?: string[];
    /** Permission scopes */
    scopes?: string[];
    /** Issuer of the token */
    iss?: string;
    /** Audience the token was issued for */
    aud?: string | string[];
    /** Expiration timestamp */
    exp?: number;
    /** Issued at timestamp */
    iat?: number;
    /** Additional claims */
    [key: string]: unknown;
}
/**
 * Caller information extracted from request
 */
export interface CallerInfo {
    /** Type of caller */
    type: CallerType;
    /** Caller identifier (user ID, DO ID, or worker name) */
    id: string | null;
    /** Full auth payload (for user requests) */
    auth?: AuthPayload | undefined;
    /** Source DO ID (for DO-to-DO calls) */
    sourceDoId?: string | undefined;
    /** Whether this is a trusted internal call */
    trusted: boolean;
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
    canAccess(request: Request, doId: string): Promise<boolean>;
    /**
     * Get the caller's identifier from the request
     * @param request - The incoming request
     * @returns Caller ID or null if not identifiable
     */
    getCallerId(request: Request): string | null;
    /**
     * Validate a token and return the auth payload
     * @param token - The token to validate
     * @returns Auth payload or null if invalid
     */
    validateToken(token: string): Promise<AuthPayload | null>;
}
/**
 * Configuration for DO auth guards
 */
export interface DOAuthGuardConfig {
    /** JWT secret for symmetric token validation */
    secret?: string | Uint8Array;
    /** JWKS client for asymmetric token validation */
    jwksClient?: JwksClient;
    /** Expected issuer(s) for token validation */
    issuer?: string | string[];
    /** Expected audience(s) for token validation */
    audience?: string | string[];
    /** Allow unauthenticated requests (default: false) */
    allowAnonymous?: boolean;
    /** Trusted worker names (for worker-to-DO trust) */
    trustedWorkers?: string[];
    /** Whether to trust DO-to-DO calls (default: true) */
    trustDoToDo?: boolean;
    /** Custom trust verification function */
    customTrustCheck?: (request: Request, callerInfo: CallerInfo) => Promise<boolean>;
}
export { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER, DO_SIGNATURE_HEADER, DO_TIMESTAMP_HEADER, CF_WORKER_HEADER, WORKER_NAME_HEADER, INTERNAL_TRUST_HEADER, CORRELATION_ID_HEADER, };
/**
 * Set the internal secret used for DO-to-DO HMAC signing
 * This must be called during Worker/DO initialization with a secret from env
 *
 * @example
 * ```typescript
 * // In your Worker/DO initialization
 * setDOInternalSecret(env.DO_INTERNAL_SECRET)
 * ```
 */
export declare function setDOInternalSecret(secret: string): void;
/**
 * Get the current internal secret (for testing purposes)
 * @internal
 */
export declare function getDOInternalSecret(): string | null;
/**
 * Clear the internal secret (for testing purposes)
 * @internal
 */
export declare function clearDOInternalSecret(): void;
/**
 * Verify DO-to-DO request signature
 * Returns true if the request has a valid signature, false otherwise
 */
export declare function verifyDOSignature(request: Request): Promise<boolean>;
/**
 * Detect the type of caller from request headers (synchronous, without signature verification)
 *
 * WARNING: This function does NOT verify DO-to-DO signatures and should only be
 * used for non-security-critical logging/tracing. For security decisions, use
 * extractCallerInfoWithVerification() which verifies HMAC signatures.
 *
 * @deprecated Use extractCallerInfoWithVerification() for security-critical decisions
 */
export declare function detectCallerType(request: Request): CallerType;
/**
 * Extract caller information from request (synchronous, without signature verification)
 *
 * WARNING: The 'trusted' field for DO callers is NOT verified in this function.
 * For security-critical decisions, use extractCallerInfoWithVerification().
 *
 * @deprecated Use extractCallerInfoWithVerification() for security-critical decisions
 */
export declare function extractCallerInfo(request: Request): CallerInfo;
/**
 * Extract caller information with HMAC signature verification for DO-to-DO calls
 *
 * This is the secure version that should be used for all security-critical decisions.
 * It verifies:
 * - DO-to-DO calls: HMAC signature must be valid
 * - Worker-to-DO calls: cf-worker header must be present (set by Cloudflare, cannot be spoofed)
 * - User calls: Must have valid JWT token (verified separately)
 */
export declare function extractCallerInfoWithVerification(request: Request): Promise<CallerInfo>;
/**
 * Create a DO auth guard with the given configuration
 */
export declare function createDOAuthGuard(config?: DOAuthGuardConfig): DOAuthGuard;
/**
 * Options for the DO auth middleware
 */
export interface DOAuthMiddlewareOptions extends DOAuthGuardConfig {
    /** Paths to skip authentication for */
    skipPaths?: string[];
    /** Custom error handler */
    onError?: (error: Error, c: Context) => Response | Promise<Response>;
}
/**
 * Hono context variables for DO auth
 */
declare module 'hono' {
    interface ContextVariableMap {
        callerInfo: CallerInfo;
        doAuth: DOAuthGuard;
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
export declare function doAuthMiddleware(options?: DOAuthMiddlewareOptions): MiddlewareHandler;
/**
 * Guard that only allows worker-to-DO calls
 * Use this for internal-only endpoints
 */
export declare function requireWorkerCaller(): MiddlewareHandler;
/**
 * Guard that only allows DO-to-DO calls
 * Use this for internal DO communication endpoints
 */
export declare function requireDOCaller(): MiddlewareHandler;
/**
 * Guard that only allows authenticated user calls
 * Use this for user-facing endpoints
 */
export declare function requireUserCaller(): MiddlewareHandler;
/**
 * Guard that allows internal calls (worker or DO)
 * Use this for internal system endpoints
 */
export declare function requireInternalCaller(): MiddlewareHandler;
/**
 * Guard that requires specific DO source
 * Use this to restrict which DOs can call this endpoint
 */
export declare function requireDOSource(...allowedDOs: string[]): MiddlewareHandler;
/**
 * Add DO source headers to a request for cross-DO calls (with HMAC signature)
 * Call this when making requests from one DO to another
 *
 * @example
 * ```typescript
 * const headers = await addDOSourceHeaders(new Headers(), 'my-do-id', '/rpc')
 * const response = await otherDO.fetch('https://do/rpc', {
 *   headers,
 * })
 * ```
 *
 * @deprecated Use addDOSourceHeadersAsync for clarity - this function is now async
 */
export declare function addDOSourceHeaders(headers: Headers, sourceDoId: string, targetPath?: string): Promise<Headers>;
/**
 * Add DO source headers to a request for cross-DO calls (with HMAC signature)
 * Async version with explicit naming
 *
 * @example
 * ```typescript
 * const headers = await addDOSourceHeadersAsync(new Headers(), 'my-do-id', '/rpc')
 * const response = await otherDO.fetch('https://do/rpc', {
 *   headers,
 * })
 * ```
 */
export declare function addDOSourceHeadersAsync(headers: Headers, sourceDoId: string, targetPath?: string): Promise<Headers>;
/**
 * Create headers for a DO-to-DO request (with HMAC signature)
 *
 * @example
 * ```typescript
 * const headers = await createDOToDoHeaders('source-do-123', '/rpc', 'corr-123')
 * const response = await otherDO.fetch('https://do/rpc', {
 *   method: 'POST',
 *   headers,
 *   body: JSON.stringify({ ... }),
 * })
 * ```
 */
export declare function createDOToDoHeaders(sourceDoId: string, targetPath?: string, correlationId?: string): Promise<Headers>;
/**
 * Add worker identification headers
 * Call this in the Worker layer when forwarding to DOs
 *
 * Note: X-Worker-Name alone is not trusted for security decisions.
 * The cf-worker header (set by Cloudflare runtime) is used for trust verification.
 */
export declare function addWorkerHeaders(headers: Headers, workerName: string): Headers;
//# sourceMappingURL=auth.d.ts.map