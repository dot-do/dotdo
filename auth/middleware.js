import { HTTPException } from 'hono/http-exception';
import { jwtVerify, importSPKI } from 'jose';
import { validateSecretPresent } from './validation';
import { ApiKeyAuth } from './apikey';
import { TokenValidationError, MissingSubjectError, mapJoseError, getWWWAuthenticateHeader, } from './errors';
import { extractBearerTokenFromHeader, extractUserFromPayload } from './helpers';
/**
 * Create JWT authentication middleware for Hono.
 *
 * This middleware validates JWT tokens from the Authorization header,
 * verifies signatures and claims, and sets the authenticated user
 * in the request context.
 *
 * **Security:** Fails closed - invalid/missing tokens result in 401 responses.
 *
 * @param options - Authentication configuration options
 * @returns Hono middleware handler
 *
 * @example
 * \`\`\`typescript
 * import { Hono } from 'hono'
 * import { authMiddleware } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * // Option 1: HMAC secret (symmetric)
 * app.use('/*', authMiddleware({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   skipPaths: ['/health']
 * }))
 *
 * // Option 2: RSA/EC public key (asymmetric)
 * app.use('/*', authMiddleware({
 *   publicKey: process.env.JWT_PUBLIC_KEY,  // PEM-encoded public key
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   skipPaths: ['/health']
 * }))
 *
 * app.get('/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ userId: user.id, email: user.email })
 * })
 * \`\`\`
 */
export function authMiddleware(options = {}) {
    const { skipPaths = [], secret, publicKey, issuer, audience } = options;
    // Require either secret or publicKey for JWT validation
    if (!secret && !publicKey) {
        throw new Error('Either secret or publicKey is required for JWT validation in authMiddleware');
    }
    // Validate that at least one key is properly provided
    if (secret) {
        validateSecretPresent(secret, 'secret', 'JWT validation in authMiddleware');
    }
    if (publicKey) {
        validateSecretPresent(publicKey, 'publicKey', 'JWT validation in authMiddleware');
    }
    // Convert string secret to Uint8Array if needed (for HMAC)
    const secretKey = secret
        ? typeof secret === 'string'
            ? new TextEncoder().encode(secret)
            : secret
        : null;
    // Cache for imported public key (lazy initialization)
    let cachedPublicKey = null;
    /**
     * Get the verification key - either HMAC secret or asymmetric public key
     */
    async function getVerificationKey() {
        // Prefer public key for asymmetric verification if provided
        if (publicKey) {
            if (!cachedPublicKey) {
                // Import PEM-encoded public key. We try RS256 first as it's most common,
                // but jose will auto-detect the algorithm from the key itself.
                try {
                    cachedPublicKey = await importSPKI(publicKey, 'RS256');
                }
                catch {
                    // Try ES256 if RS256 fails
                    cachedPublicKey = await importSPKI(publicKey, 'ES256');
                }
            }
            return cachedPublicKey;
        }
        // Fall back to HMAC secret
        return secretKey;
    }
    return async (c, next) => {
        // Skip auth for specified paths
        if (skipPaths.some(path => c.req.path.startsWith(path))) {
            return next();
        }
        // Extract token using shared helper
        const authHeader = c.req.header('Authorization');
        const extractionResult = extractBearerTokenFromHeader(authHeader);
        if (!extractionResult.token) {
            const error = extractionResult.error;
            c.header('WWW-Authenticate', getWWWAuthenticateHeader(error));
            throw new HTTPException(error.statusCode, {
                message: error.message,
                cause: error,
            });
        }
        const token = extractionResult.token;
        try {
            // Build verify options, only including defined values
            const verifyOptions = {};
            if (issuer)
                verifyOptions.issuer = issuer;
            if (audience)
                verifyOptions.audience = audience;
            // Get the appropriate verification key (HMAC secret or public key)
            const verificationKey = await getVerificationKey();
            // Verify JWT signature and claims - FAIL CLOSED
            const { payload } = await jwtVerify(token, verificationKey, verifyOptions);
            // Extract user from payload using shared helper
            const user = extractUserFromPayload(payload);
            if (!user) {
                const error = new MissingSubjectError();
                c.header('WWW-Authenticate', getWWWAuthenticateHeader(error));
                throw new HTTPException(error.statusCode, {
                    message: error.message,
                    cause: error,
                });
            }
            c.set('user', user);
            c.set('token', token);
            return next();
        }
        catch (error) {
            // FAIL CLOSED - never allow invalid tokens through
            if (error instanceof HTTPException) {
                throw error;
            }
            // Convert to TokenValidationError for detailed error messages
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
/**
 * Create API key authentication middleware for Hono.
 *
 * This middleware validates API keys using an ApiKeyManager and supports
 * scope-based authorization and rate limiting.
 *
 * **Security:** Fails closed - invalid/missing keys result in 401 responses.
 * Unauthorized scopes result in 403 responses.
 *
 * @param options - Configuration options including the ApiKeyManager
 * @returns Hono middleware handler
 *
 * @example
 * \`\`\`typescript
 * import { Hono } from 'hono'
 * import { apiKeyMiddleware, ApiKeyManager } from '@dotdo/auth'
 *
 * const app = new Hono()
 * const manager = new ApiKeyManager()
 *
 * // Basic usage - validates key format and existence
 * app.use('/api/*', apiKeyMiddleware({ manager }))
 *
 * // With required scopes
 * app.use('/api/admin/*', apiKeyMiddleware({
 *   manager,
 *   requireScopes: ['admin:read', 'admin:write']
 * }))
 *
 * app.get('/api/data', (c) => {
 *   const apiKey = c.get('apiKey')  // The validated ApiKey object
 *   return c.json({ data: 'sensitive', scopes: apiKey?.scopes })
 * })
 * \`\`\`
 */
export function apiKeyMiddleware(options) {
    const { manager, header = 'X-API-Key', requireScopes = [], enforceRateLimit = true } = options;
    return async (c, next) => {
        const key = c.req.header(header);
        // FAIL CLOSED: Require API key header
        if (!key) {
            throw new HTTPException(401, { message: `${header} header required` });
        }
        // Step 1: Verify key format before any expensive operations
        if (!ApiKeyAuth.isValidFormat(key)) {
            throw new HTTPException(401, { message: 'Invalid API key format' });
        }
        // Step 2: Validate against stored keys (checks existence, active status, expiration)
        const result = await manager.validate(key);
        if (!result.valid || !result.apiKey) {
            // FAIL CLOSED: Return generic error to avoid information leakage
            throw new HTTPException(401, { message: result.error || 'Invalid API key' });
        }
        const apiKey = result.apiKey;
        // Step 3: Validate permissions/scopes
        if (requireScopes.length > 0) {
            const hasRequiredScope = requireScopes.some(scope => ApiKeyAuth.hasScope(apiKey, scope));
            if (!hasRequiredScope) {
                throw new HTTPException(403, {
                    message: `Insufficient permissions. Required scope: ${requireScopes.join(' or ')}`
                });
            }
        }
        // Step 4: Check rate limit
        if (enforceRateLimit) {
            const rateLimitOk = await manager.checkRateLimit(apiKey.id);
            if (!rateLimitOk) {
                throw new HTTPException(429, { message: 'Rate limit exceeded' });
            }
        }
        // Set context variables for downstream handlers
        c.set('apiKey', apiKey);
        c.set('token', key);
        c.set('user', {
            id: `apikey:${apiKey.id}`,
            roles: ['api'],
            scopes: apiKey.scopes
        });
        return next();
    };
}
//# sourceMappingURL=middleware.js.map