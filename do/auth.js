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
import { HTTPException } from 'hono/http-exception';
import { extractToken, verifyTokenSignature } from '../auth/token';
import { verifyTokenWithJwks } from '../auth/jwks';
import { createLogger } from '../utils/logger';
// Import shared header constants from @dotdo/rpc to avoid circular dependencies
import { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER, DO_SIGNATURE_HEADER, DO_TIMESTAMP_HEADER, CF_WORKER_HEADER, WORKER_NAME_HEADER, INTERNAL_TRUST_HEADER, CORRELATION_ID_HEADER, } from '../rpc/headers';
const logger = createLogger('[DOAuth]');
// ============================================================================
// Headers - Re-exported from @dotdo/rpc to maintain backwards compatibility
// ============================================================================
// Re-export header constants from @dotdo/rpc for backwards compatibility.
// These were previously defined here but are now in @dotdo/rpc to avoid
// circular dependencies (do -> rpc -> do).
export { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER, DO_SIGNATURE_HEADER, DO_TIMESTAMP_HEADER, CF_WORKER_HEADER, WORKER_NAME_HEADER, INTERNAL_TRUST_HEADER, CORRELATION_ID_HEADER, };
/**
 * Maximum age of a signature in milliseconds (5 minutes)
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
// ============================================================================
// HMAC Signing for DO-to-DO Authentication
// ============================================================================
/**
 * Internal secret for DO-to-DO HMAC signing
 * This should be set via setDOInternalSecret() before use
 */
let doInternalSecret = null;
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
export function setDOInternalSecret(secret) {
    if (!secret || secret.length < 32) {
        throw new Error('DO_INTERNAL_SECRET must be at least 32 characters');
    }
    doInternalSecret = secret;
}
/**
 * Get the current internal secret (for testing purposes)
 * @internal
 */
export function getDOInternalSecret() {
    return doInternalSecret;
}
/**
 * Clear the internal secret (for testing purposes)
 * @internal
 */
export function clearDOInternalSecret() {
    doInternalSecret = null;
}
/**
 * Generate HMAC-SHA256 signature for DO-to-DO request
 */
async function generateHmacSignature(secret, sourceDoId, timestamp, targetPath) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    // Message format: sourceDoId|timestamp|targetPath
    const message = `${sourceDoId}|${timestamp}|${targetPath || ''}`;
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    // Convert to base64
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
/**
 * Verify HMAC-SHA256 signature for DO-to-DO request
 */
async function verifyHmacSignature(secret, sourceDoId, timestamp, signature, targetPath) {
    try {
        const expectedSignature = await generateHmacSignature(secret, sourceDoId, timestamp, targetPath);
        // Constant-time comparison to prevent timing attacks
        if (signature.length !== expectedSignature.length) {
            return false;
        }
        let result = 0;
        for (let i = 0; i < signature.length; i++) {
            result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
        }
        return result === 0;
    }
    catch {
        return false;
    }
}
/**
 * Verify DO-to-DO request signature
 * Returns true if the request has a valid signature, false otherwise
 */
export async function verifyDOSignature(request) {
    if (!doInternalSecret) {
        logger.warn(' DO_INTERNAL_SECRET not configured - DO-to-DO verification disabled');
        return false;
    }
    const signature = request.headers.get(DO_SIGNATURE_HEADER);
    const timestamp = request.headers.get(DO_TIMESTAMP_HEADER);
    const sourceDoId = request.headers.get(DO_SOURCE_ID_HEADER);
    if (!signature || !timestamp || !sourceDoId) {
        return false;
    }
    // Check timestamp to prevent replay attacks
    const timestampMs = parseInt(timestamp, 10);
    if (isNaN(timestampMs)) {
        return false;
    }
    const now = Date.now();
    if (Math.abs(now - timestampMs) > SIGNATURE_MAX_AGE_MS) {
        return false;
    }
    // Extract path from URL for signature verification
    const url = new URL(request.url);
    const targetPath = url.pathname;
    return verifyHmacSignature(doInternalSecret, sourceDoId, timestamp, signature, targetPath);
}
// ============================================================================
// Caller Detection
// ============================================================================
/**
 * Detect the type of caller from request headers (synchronous, without signature verification)
 *
 * WARNING: This function does NOT verify DO-to-DO signatures and should only be
 * used for non-security-critical logging/tracing. For security decisions, use
 * extractCallerInfoWithVerification() which verifies HMAC signatures.
 *
 * @deprecated Use extractCallerInfoWithVerification() for security-critical decisions
 */
export function detectCallerType(request) {
    // Check for DO-to-DO call first (most specific)
    // Note: This only checks header presence, NOT signature validity
    if (request.headers.get(DO_SOURCE_HEADER) === 'true') {
        return 'do';
    }
    // Check for Worker-to-DO call (internal)
    // cf-worker header is set by Cloudflare runtime and cannot be spoofed
    if (request.headers.get(CF_WORKER_HEADER)) {
        return 'worker';
    }
    // X-Worker-Name can be spoofed - only trust if cf-worker is also present
    // This is kept for backwards compatibility but the auth guard should verify
    if (request.headers.get(WORKER_NAME_HEADER)) {
        return 'worker';
    }
    // Check for user request (has Authorization header)
    if (request.headers.get('Authorization')) {
        return 'user';
    }
    return 'unknown';
}
/**
 * Extract caller information from request (synchronous, without signature verification)
 *
 * WARNING: The 'trusted' field for DO callers is NOT verified in this function.
 * For security-critical decisions, use extractCallerInfoWithVerification().
 *
 * @deprecated Use extractCallerInfoWithVerification() for security-critical decisions
 */
export function extractCallerInfo(request) {
    const type = detectCallerType(request);
    switch (type) {
        case 'do':
            return {
                type: 'do',
                id: request.headers.get(DO_SOURCE_ID_HEADER),
                sourceDoId: request.headers.get(DO_SOURCE_ID_HEADER) ?? undefined,
                // WARNING: trusted=true here is NOT verified - use extractCallerInfoWithVerification()
                trusted: true,
            };
        case 'worker':
            // cf-worker header is set by Cloudflare and cannot be spoofed
            const hasCfWorker = !!request.headers.get(CF_WORKER_HEADER);
            return {
                type: 'worker',
                id: request.headers.get(WORKER_NAME_HEADER) || request.headers.get(CF_WORKER_HEADER),
                trusted: hasCfWorker, // Only trust if cf-worker header is present
            };
        case 'user':
            return {
                type: 'user',
                id: null, // Will be populated after token validation
                trusted: false, // User requests need explicit validation
            };
        default:
            return {
                type: 'unknown',
                id: null,
                trusted: false,
            };
    }
}
/**
 * Extract caller information with HMAC signature verification for DO-to-DO calls
 *
 * This is the secure version that should be used for all security-critical decisions.
 * It verifies:
 * - DO-to-DO calls: HMAC signature must be valid
 * - Worker-to-DO calls: cf-worker header must be present (set by Cloudflare, cannot be spoofed)
 * - User calls: Must have valid JWT token (verified separately)
 */
export async function extractCallerInfoWithVerification(request) {
    // Check for DO-to-DO call first - requires signature verification
    if (request.headers.get(DO_SOURCE_HEADER) === 'true') {
        const signatureValid = await verifyDOSignature(request);
        if (signatureValid) {
            return {
                type: 'do',
                id: request.headers.get(DO_SOURCE_ID_HEADER),
                sourceDoId: request.headers.get(DO_SOURCE_ID_HEADER) ?? undefined,
                trusted: true, // Signature verified - this is a legitimate DO-to-DO call
            };
        }
        else {
            // Signature invalid or missing - treat as untrusted/unknown
            // This prevents header spoofing attacks
            logger.warn('DO-to-DO request with invalid or missing signature from:', request.headers.get(DO_SOURCE_ID_HEADER));
            return {
                type: 'unknown',
                id: null,
                trusted: false,
            };
        }
    }
    // Check for Worker-to-DO call (internal)
    // cf-worker header is set by Cloudflare runtime and cannot be spoofed by external clients
    if (request.headers.get(CF_WORKER_HEADER)) {
        return {
            type: 'worker',
            id: request.headers.get(WORKER_NAME_HEADER) || request.headers.get(CF_WORKER_HEADER),
            trusted: true, // cf-worker header is Cloudflare-controlled
        };
    }
    // X-Worker-Name without cf-worker is NOT trusted (can be spoofed)
    if (request.headers.get(WORKER_NAME_HEADER)) {
        logger.warn(' X-Worker-Name header present without cf-worker - treating as untrusted');
        return {
            type: 'unknown',
            id: null,
            trusted: false,
        };
    }
    // Check for user request (has Authorization header)
    if (request.headers.get('Authorization')) {
        return {
            type: 'user',
            id: null, // Will be populated after token validation
            trusted: false, // User requests need explicit token validation
        };
    }
    return {
        type: 'unknown',
        id: null,
        trusted: false,
    };
}
// ============================================================================
// Auth Guard Implementation
// ============================================================================
/**
 * Create a DO auth guard with the given configuration
 */
export function createDOAuthGuard(config = {}) {
    const { secret, jwksClient, issuer, audience, allowAnonymous = false, trustedWorkers = [], trustDoToDo = true, customTrustCheck, } = config;
    return {
        async canAccess(request, _doId) {
            // Use secure verification that validates HMAC signatures for DO-to-DO calls
            const callerInfo = await extractCallerInfoWithVerification(request);
            // DO-to-DO trust - only if signature was verified
            if (callerInfo.type === 'do' && callerInfo.trusted) {
                if (!trustDoToDo) {
                    return false;
                }
                // Optionally verify the source DO ID
                if (customTrustCheck) {
                    return customTrustCheck(request, callerInfo);
                }
                return true;
            }
            // Worker-to-DO trust - only if cf-worker header is present (Cloudflare-controlled)
            if (callerInfo.type === 'worker' && callerInfo.trusted) {
                // If trustedWorkers list is specified, verify worker name
                if (trustedWorkers.length > 0) {
                    const workerName = callerInfo.id;
                    return workerName ? trustedWorkers.includes(workerName) : false;
                }
                // Default: trust all workers in same CF account (verified via cf-worker header)
                return true;
            }
            // User requests need token validation
            if (callerInfo.type === 'user') {
                const token = extractToken(request);
                if (!token) {
                    return allowAnonymous;
                }
                const payload = await this.validateToken(token);
                return payload !== null;
            }
            // Unknown caller type or untrusted internal caller (spoofed headers)
            return allowAnonymous;
        },
        getCallerId(request) {
            const callerInfo = extractCallerInfo(request);
            if (callerInfo.type === 'do') {
                return callerInfo.sourceDoId ?? null;
            }
            if (callerInfo.type === 'worker') {
                return callerInfo.id;
            }
            if (callerInfo.type === 'user') {
                // Extract from token (would need to be cached from validation)
                const token = extractToken(request);
                if (token) {
                    try {
                        // Decode without verification just to get the subject
                        const parts = token.split('.');
                        const payloadPart = parts[1];
                        if (parts.length === 3 && payloadPart) {
                            const payload = JSON.parse(atob(payloadPart));
                            return payload.sub ?? null;
                        }
                    }
                    catch {
                        // Invalid token format
                    }
                }
            }
            return null;
        },
        async validateToken(token) {
            try {
                // Try JWKS validation first if client is available
                if (jwksClient) {
                    const issuerArray = issuer ? (Array.isArray(issuer) ? issuer : [issuer]) : undefined;
                    const audienceArray = audience ? (Array.isArray(audience) ? audience : [audience]) : undefined;
                    const payload = await verifyTokenWithJwks(token, jwksClient, {
                        ...(issuerArray !== undefined && { issuer: issuerArray }),
                        ...(audienceArray !== undefined && { audience: audienceArray }),
                    });
                    return payload;
                }
                // Fall back to symmetric secret validation
                if (secret) {
                    const firstIssuer = Array.isArray(issuer) ? issuer[0] : issuer;
                    const firstAudience = Array.isArray(audience) ? audience[0] : audience;
                    const payload = await verifyTokenSignature(token, {
                        secret: typeof secret === 'string' ? secret : secret,
                        ...(firstIssuer && { issuer: firstIssuer }),
                        ...(firstAudience && { audience: firstAudience }),
                    });
                    return payload;
                }
                // No validation configured - decode without verification (NOT RECOMMENDED)
                logger.warn('No secret or JWKS client configured - tokens will not be verified');
                const parts = token.split('.');
                const payloadPart = parts[1];
                if (parts.length === 3 && payloadPart) {
                    const payload = JSON.parse(atob(payloadPart));
                    return payload;
                }
                return null;
            }
            catch (error) {
                logger.error(' Token validation failed:', error);
                return null;
            }
        },
    };
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
export function doAuthMiddleware(options = {}) {
    const { skipPaths = ['/'], onError, ...guardConfig } = options;
    const guard = createDOAuthGuard(guardConfig);
    return async (c, next) => {
        // Skip auth for specified paths
        if (skipPaths.some((path) => c.req.path === path || c.req.path.startsWith(path + '/'))) {
            // Still extract caller info for logging (use async verification for security)
            const callerInfo = await extractCallerInfoWithVerification(c.req.raw);
            c.set('callerInfo', callerInfo);
            c.set('doAuth', guard);
            return next();
        }
        try {
            // Extract caller information with secure verification
            const callerInfo = await extractCallerInfoWithVerification(c.req.raw);
            // Get DO ID from the request (could be from path, header, or state)
            const doId = c.req.header('X-DO-ID') || c.req.path.split('/')[1] || 'unknown';
            // Check if caller can access this DO
            const canAccess = await guard.canAccess(c.req.raw, doId);
            if (!canAccess) {
                throw new HTTPException(401, {
                    message: `Access denied for ${callerInfo.type} caller`,
                });
            }
            // For user requests, validate token and populate auth info
            if (callerInfo.type === 'user') {
                const token = extractToken(c.req.raw);
                if (token) {
                    const payload = await guard.validateToken(token);
                    if (payload) {
                        callerInfo.auth = payload;
                        callerInfo.id = payload.sub;
                        // Set user in context for compatibility with existing guards
                        c.set('user', {
                            id: payload.sub,
                            email: payload.email,
                            roles: payload.roles || [],
                            scopes: payload.scopes || [],
                        });
                        c.set('token', token);
                    }
                }
            }
            // Set caller info in context
            c.set('callerInfo', callerInfo);
            c.set('doAuth', guard);
            return next();
        }
        catch (error) {
            if (onError && error instanceof Error) {
                return onError(error, c);
            }
            if (error instanceof HTTPException) {
                throw error;
            }
            throw new HTTPException(500, {
                message: error instanceof Error ? error.message : 'Authentication error',
            });
        }
    };
}
// ============================================================================
// Specialized Guards
// ============================================================================
/**
 * Guard that only allows worker-to-DO calls
 * Use this for internal-only endpoints
 */
export function requireWorkerCaller() {
    return async (c, next) => {
        const callerInfo = c.get('callerInfo');
        if (!callerInfo) {
            throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' });
        }
        if (callerInfo.type !== 'worker') {
            throw new HTTPException(403, {
                message: 'This endpoint is only accessible from workers',
            });
        }
        return next();
    };
}
/**
 * Guard that only allows DO-to-DO calls
 * Use this for internal DO communication endpoints
 */
export function requireDOCaller() {
    return async (c, next) => {
        const callerInfo = c.get('callerInfo');
        if (!callerInfo) {
            throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' });
        }
        if (callerInfo.type !== 'do') {
            throw new HTTPException(403, {
                message: 'This endpoint is only accessible from other DOs',
            });
        }
        return next();
    };
}
/**
 * Guard that only allows authenticated user calls
 * Use this for user-facing endpoints
 */
export function requireUserCaller() {
    return async (c, next) => {
        const callerInfo = c.get('callerInfo');
        if (!callerInfo) {
            throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' });
        }
        if (callerInfo.type !== 'user') {
            throw new HTTPException(403, {
                message: 'This endpoint requires user authentication',
            });
        }
        if (!callerInfo.auth) {
            throw new HTTPException(401, {
                message: 'Valid authentication token required',
            });
        }
        return next();
    };
}
/**
 * Guard that allows internal calls (worker or DO)
 * Use this for internal system endpoints
 */
export function requireInternalCaller() {
    return async (c, next) => {
        const callerInfo = c.get('callerInfo');
        if (!callerInfo) {
            throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' });
        }
        if (callerInfo.type !== 'worker' && callerInfo.type !== 'do') {
            throw new HTTPException(403, {
                message: 'This endpoint is only accessible internally',
            });
        }
        return next();
    };
}
/**
 * Guard that requires specific DO source
 * Use this to restrict which DOs can call this endpoint
 */
export function requireDOSource(...allowedDOs) {
    return async (c, next) => {
        const callerInfo = c.get('callerInfo');
        if (!callerInfo) {
            throw new HTTPException(500, { message: 'Caller info not available - add doAuthMiddleware first' });
        }
        if (callerInfo.type !== 'do') {
            throw new HTTPException(403, {
                message: 'This endpoint is only accessible from other DOs',
            });
        }
        if (!callerInfo.sourceDoId || !allowedDOs.includes(callerInfo.sourceDoId)) {
            throw new HTTPException(403, {
                message: `Access denied from DO: ${callerInfo.sourceDoId}`,
            });
        }
        return next();
    };
}
// ============================================================================
// Helpers for Cross-DO Calls
// ============================================================================
/**
 * Generate HMAC signature for DO-to-DO request headers
 * @internal
 */
async function signDORequest(sourceDoId, timestamp, targetPath) {
    if (!doInternalSecret) {
        throw new Error('DO_INTERNAL_SECRET not configured - call setDOInternalSecret() first');
    }
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(doInternalSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const message = `${sourceDoId}|${timestamp}|${targetPath || ''}`;
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
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
export async function addDOSourceHeaders(headers, sourceDoId, targetPath) {
    const timestamp = Date.now().toString();
    headers.set(DO_SOURCE_HEADER, 'true');
    headers.set(DO_SOURCE_ID_HEADER, sourceDoId);
    headers.set(DO_TIMESTAMP_HEADER, timestamp);
    try {
        const signature = await signDORequest(sourceDoId, timestamp, targetPath);
        headers.set(DO_SIGNATURE_HEADER, signature);
    }
    catch (error) {
        logger.warn(' Failed to sign DO-to-DO request:', error);
        // Still set the headers without signature for backwards compatibility
        // but the receiver will reject it if DO_INTERNAL_SECRET is configured
    }
    return headers;
}
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
export async function addDOSourceHeadersAsync(headers, sourceDoId, targetPath) {
    return addDOSourceHeaders(headers, sourceDoId, targetPath);
}
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
export async function createDOToDoHeaders(sourceDoId, targetPath, correlationId) {
    const timestamp = Date.now().toString();
    const headers = new Headers({
        'Content-Type': 'application/json',
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: sourceDoId,
        [DO_TIMESTAMP_HEADER]: timestamp,
    });
    try {
        const signature = await signDORequest(sourceDoId, timestamp, targetPath);
        headers.set(DO_SIGNATURE_HEADER, signature);
    }
    catch (error) {
        logger.warn(' Failed to sign DO-to-DO request:', error);
    }
    if (correlationId) {
        headers.set(CORRELATION_ID_HEADER, correlationId);
    }
    return headers;
}
/**
 * Add worker identification headers
 * Call this in the Worker layer when forwarding to DOs
 *
 * Note: X-Worker-Name alone is not trusted for security decisions.
 * The cf-worker header (set by Cloudflare runtime) is used for trust verification.
 */
export function addWorkerHeaders(headers, workerName) {
    headers.set(WORKER_NAME_HEADER, workerName);
    return headers;
}
//# sourceMappingURL=auth.js.map