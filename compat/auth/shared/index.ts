/**
 * @dotdo/auth - Shared Auth Primitives
 *
 * Common authentication primitives used by Auth0 and Clerk compat layers.
 *
 * @module
 */

// Types
export * from './types'

// JWT
export { createJWT, verifyJWT, decodeJWT, isTokenExpired, getTokenExpiration, getTokenTTL, getTokenSubject } from './jwt'
export type { JWTCreateOptions, JWTVerifyOptions, JWTVerifyResult } from './jwt'

// Sessions
export { SessionManager, createSessionManager } from './sessions'
export type { SessionManagerOptions, CreateSessionOptions, SessionValidationResult } from './sessions'

// Users
export { UserManager, createUserManager } from './users'
export type { UserManagerOptions, CreateUserParams, UpdateUserParams, SearchUsersParams, PasswordVerificationResult } from './users'

// MFA
export { MFAManager, createMFAManager } from './mfa'
export type { MFAManagerOptions } from './mfa'

// OAuth
export { OAuthManager, createOAuthManager, generateCodeVerifier, generateCodeChallenge } from './oauth'
export type { OAuthManagerOptions, OAuthClient } from './oauth'
