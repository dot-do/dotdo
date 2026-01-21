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
 */

// Middleware - JWT and API key authentication
export * from './middleware'

// Guards - Permission checking middleware (includes GetResourceOwnerIdFn type)
export * from './guards'

// Token - JWT token validation and utilities
export * from './token'

// JWT - Lightweight JWT verification (jose only)
export * from './jwt'

// JWKS - JSON Web Key Set support
export * from './jwks'

// API Key - API key management and middleware
export * from './apikey'

// Session - Session management
export * from './session'

// org.ai - Integration with org.ai authentication
export * from './org-ai'

// Revocation - Token revocation management
export * from './revocation'

// Validation - Secret validation utilities
export * from './validation'

// RBAC - Role-based access control
export * from './rbac'
