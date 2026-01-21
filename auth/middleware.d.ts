/**
 * @dotdo/auth - Authentication Middleware
 *
 * Provides Hono middleware for JWT and API key authentication.
 * Supports JWKS validation, claim verification, and role/scope extraction.
 *
 * @module @dotdo/auth/middleware
 */
import type { MiddlewareHandler } from 'hono';
import { ApiKeyManager, type ApiKey } from './apikey';
/**
 * Options for configuring JWT authentication middleware.
 */
export interface AuthOptions {
    /** Expected JWT issuer claim (iss). If set, tokens from other issuers will be rejected. */
    issuer?: string | undefined;
    /** Expected JWT audience claim (aud). If set, tokens for other audiences will be rejected. */
    audience?: string | undefined;
    /** Secret key for HMAC signature verification. Either secret or publicKey is required. */
    secret?: string | Uint8Array | undefined;
    /** Public key for asymmetric (RSA/EC) signature verification. Either secret or publicKey is required. */
    publicKey?: string | undefined;
    /** Paths to skip authentication (e.g., ['/health', '/public']). */
    skipPaths?: string[] | undefined;
}
/**
 * Authenticated user information extracted from JWT claims or API key.
 */
export interface AuthUser {
    /** User ID from the JWT subject (sub) claim or API key ID. */
    id: string;
    /** User email from the email claim. */
    email?: string | undefined;
    /** User roles from the roles claim. */
    roles?: string[] | undefined;
    /** OAuth scopes from the scopes claim. */
    scopes?: string[] | undefined;
    /** Additional metadata from API keys. */
    metadata?: Record<string, unknown> | undefined;
}
declare module 'hono' {
    interface ContextVariableMap {
        user: AuthUser;
        token: string;
        apiKey?: ApiKey;
    }
}
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
export declare function authMiddleware(options?: AuthOptions): MiddlewareHandler;
/**
 * Options for configuring API key authentication middleware.
 */
export interface ApiKeyMiddlewareOptions {
    /** The ApiKeyManager instance for key validation */
    manager: ApiKeyManager;
    /** Header name for API key (default: 'X-API-Key') */
    header?: string;
    /** Scopes required to access the route (any of these grants access) */
    requireScopes?: string[];
    /** Whether to enforce rate limiting (default: true) */
    enforceRateLimit?: boolean;
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
export declare function apiKeyMiddleware(options: ApiKeyMiddlewareOptions): MiddlewareHandler;
//# sourceMappingURL=middleware.d.ts.map