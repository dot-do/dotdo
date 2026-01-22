/**
 * @dotdo/auth - Authentication and Authorization for Hono
 *
 * Provides complete authentication infrastructure:
 * - JWT authentication middleware
 * - API key authentication and management
 * - JWKS validation for asymmetric keys
 * - Session management
 * - Role-based access control (RBAC)
 * - Permission guards
 * - Token revocation
 * - org.ai integration
 *
 * @module @dotdo/auth
 *
 * @example
 * ```typescript
 * import { authMiddleware, apiKeyMiddleware, ApiKeyManager } from '@dotdo/auth'
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 *
 * // JWT authentication
 * app.use('/api/*', authMiddleware({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api'
 * }))
 *
 * // API key authentication
 * const keyManager = new ApiKeyManager()
 * app.use('/api/*', apiKeyMiddleware({
 *   manager: keyManager,
 *   requireScopes: ['read:users']
 * }))
 *
 * // Access authenticated user
 * app.get('/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ id: user.id, email: user.email })
 * })
 * ```
 */

/**
 * Middleware - JWT and API key authentication middleware for Hono.
 * Use authMiddleware for JWT and apiKeyMiddleware for API keys.
 */
export * from './middleware'

/**
 * Guards - Permission checking middleware for route protection.
 * Provides requireRole, requireScope, and requireOwner guards.
 */
export * from './guards'

/**
 * Token - JWT token validation and utilities.
 * Low-level token verification and claim extraction.
 */
export * from './token'

/**
 * JWT - Lightweight JWT verification using jose library.
 * Supports HMAC and asymmetric (RSA/EC) signatures.
 */
export * from './jwt'

/**
 * JWKS - JSON Web Key Set support for asymmetric key rotation.
 * Automatically fetches and caches public keys from JWKS endpoints.
 */
export * from './jwks'

/**
 * API Key - API key generation, validation, and management.
 * Includes scope-based authorization and rate limiting.
 */
export * from './apikey'

/**
 * Session - Session management for stateful authentication.
 * Supports cookie-based and token-based sessions.
 */
export * from './session'

/**
 * org.ai - Integration with org.ai authentication service.
 * Provides SSO and federated identity support.
 */
export * from './org-ai'

/**
 * Revocation - Token revocation management.
 * Implements token blocklist for logout and security events.
 */
export * from './revocation'

/**
 * Validation - Secret validation utilities.
 * Ensures secrets are properly configured and meet security requirements.
 */
export * from './validation'

/**
 * Errors - Token validation error classes.
 * Typed errors for authentication failures.
 */
export * from './errors'

/**
 * RBAC - Role-based access control.
 * Define roles, permissions, and hierarchies for authorization.
 */
export * from './rbac'

/**
 * Helpers - Shared authentication utilities.
 * Token extraction and user extraction helpers for custom middleware.
 */
export * from './helpers'

/**
 * DO Signing - HMAC-based signing for DO-to-DO communication.
 * Used by @dotdo/rpc for secure cross-DO requests.
 */
export * from './do-signing'
