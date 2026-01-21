/**
 * @dotdo/auth JWT Verification
 *
 * Lightweight JWT verification using jose only.
 * Provides a simple, focused API for JWT validation.
 *
 * @module @dotdo/auth/jwt
 */
import { jwtVerify } from 'jose';
import { HTTPException } from 'hono/http-exception';
import { TokenValidationError, MissingTokenError, InvalidAuthHeaderError, MissingSubjectError, mapJoseError, getWWWAuthenticateHeader, } from './errors';
// Note: ContextVariableMap is declared in middleware.ts
// This module uses AuthUser through JWTUser extension
/**
 * Verify a JWT token and return the payload.
 *
 * Uses jose's jwtVerify for signature validation and claim checking.
 * Supports HMAC (HS256) symmetric signatures.
 *
 * @param token - The JWT token string to verify
 * @param options - Verification options including secret and optional issuer/audience
 * @returns The verified JWT payload
 * @throws {TokenValidationError} If verification fails (with specific error type for debugging)
 *
 * @example
 * ```typescript
 * import { verifyJWT } from '@dotdo/auth/jwt'
 *
 * try {
 *   const payload = await verifyJWT(token, {
 *     secret: process.env.JWT_SECRET,
 *     issuer: 'id.org.ai',
 *     audience: 'dotdo.api'
 *   })
 *   console.log(payload.sub) // user ID
 * } catch (error) {
 *   if (error instanceof TokenExpiredError) {
 *     // Handle expired token - prompt for refresh
 *   } else if (error instanceof InvalidSignatureError) {
 *     // Handle tampered token
 *   }
 * }
 * ```
 */
export async function verifyJWT(token, options) {
    const { secret, issuer, audience } = options;
    // Convert string secret to Uint8Array if needed
    const secretKey = typeof secret === 'string'
        ? new TextEncoder().encode(secret)
        : secret;
    // Build verify options, only including defined values
    const verifyOptions = {};
    if (issuer !== undefined)
        verifyOptions.issuer = issuer;
    if (audience !== undefined)
        verifyOptions.audience = audience;
    try {
        const { payload } = await jwtVerify(token, secretKey, verifyOptions);
        return payload;
    }
    catch (error) {
        // Map jose errors to our specific error types for better debugging
        throw mapJoseError(error, {
            expectedIssuer: issuer,
            expectedAudience: audience,
        });
    }
}
/**
 * Extract Bearer token from Authorization header or cookies.
 *
 * @param request - The incoming request
 * @param cookieName - Optional cookie name to check
 * @returns The extracted token or null
 */
function extractBearerToken(request, cookieName) {
    const result = extractBearerTokenWithError(request, cookieName);
    return result.token;
}
/**
 * Extract Bearer token with detailed error information.
 *
 * @param request - The incoming request
 * @param cookieName - Optional cookie name to check
 * @returns Result with token and optional error details
 */
function extractBearerTokenWithError(request, cookieName) {
    // Try Authorization header first
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
        const trimmed = authHeader.trim();
        const parts = trimmed.split(/\s+/);
        if (parts.length === 0 || !parts[0]) {
            return {
                token: null,
                error: new InvalidAuthHeaderError('missing_scheme'),
            };
        }
        if (parts[0] !== 'Bearer') {
            return {
                token: null,
                error: new InvalidAuthHeaderError('wrong_scheme'),
            };
        }
        if (parts.length < 2 || !parts[1]) {
            return {
                token: null,
                error: new InvalidAuthHeaderError('missing_token'),
            };
        }
        return { token: parts[1].trim() };
    }
    // Try cookie if specified
    if (cookieName) {
        const cookieHeader = request.headers.get('Cookie');
        if (cookieHeader) {
            for (const cookie of cookieHeader.split(';')) {
                const [name, ...rest] = cookie.split('=');
                if (name && name.trim() === cookieName && rest.length > 0) {
                    return { token: rest.join('=').trim() };
                }
            }
        }
    }
    return {
        token: null,
        error: new MissingTokenError(cookieName ? 'both' : 'header'),
    };
}
/**
 * Create Hono middleware for JWT authentication.
 *
 * Validates JWT tokens from the Authorization header (Bearer scheme).
 * Sets authenticated user in the request context.
 *
 * **Security:** Fails closed - invalid/missing tokens result in 401 responses.
 *
 * @param options - Middleware configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createJWTMiddleware } from '@dotdo/auth/jwt'
 *
 * const app = new Hono()
 *
 * app.use('/*', createJWTMiddleware({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'id.org.ai',
 *   skipPaths: ['/health', '/public']
 * }))
 *
 * app.get('/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ userId: user.id })
 * })
 * ```
 */
export function createJWTMiddleware(options) {
    const { secret, issuer, audience, skipPaths = [], cookieName } = options;
    return async (c, next) => {
        // Skip auth for specified paths
        if (skipPaths.some(path => c.req.path.startsWith(path))) {
            return next();
        }
        // Extract token with detailed error information
        const extractionResult = extractBearerTokenWithError(c.req.raw, cookieName);
        if (!extractionResult.token) {
            const error = extractionResult.error || new MissingTokenError('header');
            c.header('WWW-Authenticate', getWWWAuthenticateHeader(error));
            throw new HTTPException(error.statusCode, {
                message: error.message,
                cause: error,
            });
        }
        const token = extractionResult.token;
        try {
            // Verify JWT
            const payload = await verifyJWT(token, { secret, issuer, audience });
            // Require subject claim
            if (!payload.sub) {
                const error = new MissingSubjectError();
                c.header('WWW-Authenticate', getWWWAuthenticateHeader(error));
                throw new HTTPException(error.statusCode, {
                    message: error.message,
                    cause: error,
                });
            }
            // Extract user info from payload
            const email = payload['email'];
            const roles = payload['roles'];
            const scopes = payload['scopes'];
            const user = {
                id: payload.sub,
                email,
                roles: Array.isArray(roles) ? roles : [],
                scopes: Array.isArray(scopes) ? scopes : []
            };
            c.set('user', user);
            c.set('token', token);
            return next();
        }
        catch (error) {
            // FAIL CLOSED - reject all invalid tokens
            if (error instanceof HTTPException) {
                throw error;
            }
            // Convert to TokenValidationError if not already
            const tokenError = error instanceof TokenValidationError
                ? error
                : mapJoseError(error, {
                    expectedIssuer: issuer,
                    expectedAudience: audience,
                });
            c.header('WWW-Authenticate', getWWWAuthenticateHeader(tokenError));
            throw new HTTPException(tokenError.statusCode, {
                message: tokenError.message,
                cause: tokenError,
            });
        }
    };
}
//# sourceMappingURL=jwt.js.map