// JWKS support for @dotdo/auth
// Implements JWT validation with JWKS endpoint fetching and caching
import { HTTPException } from 'hono/http-exception';
import { jwtVerify, importJWK, decodeProtectedHeader } from 'jose';
import { extractToken, checkTokenExpiration } from './token';
/**
 * Fetch JWKS from a URL
 */
export async function fetchJwks(jwksUri) {
    const response = await fetch(jwksUri);
    if (!response.ok) {
        throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`);
    }
    const jwks = await response.json();
    if (!jwks || !Array.isArray(jwks.keys)) {
        throw new Error('Invalid JWKS: missing keys array');
    }
    return jwks;
}
/**
 * Create a JWKS client with caching support
 */
export function createJwksClient(options) {
    const { jwksUri, cacheTtl = 600, refetchOnMissingKey = true, refetchCooldown = 30, } = options;
    let cache = null;
    let lastRefetchAttempt = 0;
    /**
     * Check if cache is still valid
     */
    function isCacheValid() {
        if (!cache)
            return false;
        const now = Date.now() / 1000;
        return now - cache.fetchedAt < cacheTtl;
    }
    /**
     * Fetch and cache JWKS
     */
    async function fetchAndCache() {
        const jwks = await fetchJwks(jwksUri);
        const keys = new Map();
        cache = {
            jwks,
            keys,
            fetchedAt: Date.now() / 1000,
        };
        return cache;
    }
    /**
     * Import a JWK and cache the CryptoKey
     */
    async function importAndCacheKey(jwk) {
        if (!jwk.kid) {
            throw new Error('JWK missing kid');
        }
        const key = await importJWK(jwk, jwk.alg);
        if (cache) {
            cache.keys.set(jwk.kid, key);
        }
        return key;
    }
    return {
        async getKey(kid) {
            // Check if we have a valid cached key
            if (cache && isCacheValid()) {
                const cachedKey = cache.keys.get(kid);
                if (cachedKey) {
                    return cachedKey;
                }
                // Key not in cache - check if we have the JWK
                const jwk = cache.jwks.keys.find((k) => k.kid === kid);
                if (jwk) {
                    return importAndCacheKey(jwk);
                }
            }
            // Cache miss or expired - fetch fresh JWKS
            if (!isCacheValid()) {
                await fetchAndCache();
                // Try to find the key now (cache is guaranteed to exist after fetchAndCache)
                if (cache) {
                    const jwk = cache.jwks.keys.find((k) => k.kid === kid);
                    if (jwk) {
                        return importAndCacheKey(jwk);
                    }
                }
            }
            // Key not found - possibly key rotation
            if (refetchOnMissingKey) {
                const now = Date.now() / 1000;
                // Check cooldown
                if (now - lastRefetchAttempt >= refetchCooldown) {
                    lastRefetchAttempt = now;
                    // Force refetch
                    await fetchAndCache();
                    // cache is guaranteed to exist after fetchAndCache
                    if (cache) {
                        const jwk = cache.jwks.keys.find((k) => k.kid === kid);
                        if (jwk) {
                            return importAndCacheKey(jwk);
                        }
                    }
                }
            }
            throw new Error(`Key with kid "${kid}" not found in JWKS`);
        },
        clearCache() {
            cache = null;
            lastRefetchAttempt = 0;
        },
    };
}
/**
 * Default allowed algorithms for JWKS verification (asymmetric only)
 */
const DEFAULT_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
/**
 * Verify a JWT token using JWKS
 */
export async function verifyTokenWithJwks(token, client, options = {}) {
    const { issuer, audience, algorithms = DEFAULT_ALGORITHMS } = options;
    // Decode header to get kid
    let header;
    try {
        header = decodeProtectedHeader(token);
    }
    catch {
        throw new Error('Invalid token: failed to decode header');
    }
    if (!header.kid) {
        throw new Error('Token missing kid in header');
    }
    // Check algorithm is allowed
    if (!header.alg || !algorithms.includes(header.alg)) {
        throw new Error(`Algorithm "${header.alg}" not allowed`);
    }
    // Get the public key
    const key = await client.getKey(header.kid);
    // Build verify options, only including defined values
    const verifyOptions = { algorithms };
    if (issuer !== undefined)
        verifyOptions.issuer = issuer;
    if (audience !== undefined)
        verifyOptions.audience = audience;
    // Verify the token
    const { payload } = await jwtVerify(token, key, verifyOptions);
    return payload;
}
/**
 * Convert token payload to AuthUser
 */
function payloadToAuthUser(payload) {
    return {
        id: payload.sub ?? '',
        email: payload.email,
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    };
}
/**
 * Hono middleware for JWT validation with JWKS
 */
export function validateTokenWithJwks(options) {
    const { jwksClient, issuer, audience, algorithms, cookieName, skipPaths = [], refreshThreshold = 300, } = options;
    return async (c, next) => {
        // Skip validation for specified paths
        if (skipPaths.some((path) => c.req.path.startsWith(path))) {
            return next();
        }
        // Extract token
        const token = extractToken(c.req.raw, {
            ...(cookieName !== undefined && { cookieName }),
        });
        if (!token) {
            c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"');
            throw new HTTPException(401, { message: 'Authorization required' });
        }
        try {
            // Verify token with JWKS
            const payload = await verifyTokenWithJwks(token, jwksClient, {
                ...(issuer !== undefined && { issuer }),
                ...(audience !== undefined && { audience }),
                ...(algorithms !== undefined && { algorithms }),
            });
            // Check expiration
            const expCheck = checkTokenExpiration(payload, { refreshThreshold });
            if (expCheck.expired) {
                c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"');
                throw new HTTPException(401, { message: 'Token expired' });
            }
            // Set refresh hint header if token is close to expiration
            if (expCheck.shouldRefresh) {
                c.header('X-Token-Refresh-Hint', 'true');
            }
            // Set user and token in context
            const user = payloadToAuthUser(payload);
            c.set('user', user);
            c.set('token', token);
            return next();
        }
        catch (error) {
            // Handle validation errors
            if (error instanceof HTTPException) {
                throw error;
            }
            c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"');
            const message = error instanceof Error ? error.message : 'Invalid token';
            throw new HTTPException(401, { message });
        }
    };
}
/**
 * Create a JWKS client from an issuer URL
 * Automatically constructs the .well-known/jwks.json URL
 */
export function createJwksClientFromIssuer(issuer, options = {}) {
    const normalizedIssuer = issuer.replace(/\/$/, '');
    const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;
    return createJwksClient({
        ...options,
        jwksUri,
    });
}
//# sourceMappingURL=jwks.js.map