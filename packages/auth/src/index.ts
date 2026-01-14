/**
 * @dotdo/auth - Multi-Provider Authentication Package
 *
 * Unified authentication API with support for multiple auth providers.
 * Built for edge environments using Web Crypto API.
 *
 * @example Basic Usage
 * ```typescript
 * import { createAuth } from '@dotdo/auth'
 *
 * const auth = createAuth({
 *   jwtSecret: 'your-secret-key',
 *   issuer: 'https://auth.example.com',
 * })
 *
 * // Sign up
 * const { user, session, tokens } = await auth.signUp({
 *   email: 'user@example.com',
 *   password: 'SecurePassword123!',
 * })
 *
 * // Sign in
 * const result = await auth.signIn({
 *   email: 'user@example.com',
 *   password: 'SecurePassword123!',
 * })
 *
 * // Validate token
 * const validation = await auth.validateToken(tokens.access_token)
 * if (validation.valid) {
 *   console.log('User:', validation.user)
 * }
 * ```
 *
 * @example Direct API Access
 * ```typescript
 * // User management
 * const user = await auth.users.create({
 *   email: 'user@example.com',
 *   password: 'SecurePassword123!',
 * })
 *
 * // Session management
 * const { session, tokens } = await auth.sessions.create(user)
 *
 * // MFA
 * const enrollment = await auth.mfa.enrollTOTP(user.id)
 * await auth.mfa.verifyTOTPEnrollment(enrollment.factor_id, '123456')
 *
 * // OAuth
 * const client = await auth.oauth.registerClient({
 *   name: 'My App',
 *   redirect_uris: ['https://myapp.com/callback'],
 *   allowed_grant_types: ['authorization_code', 'refresh_token'],
 *   allowed_scopes: ['openid', 'profile', 'email'],
 *   is_first_party: true,
 * })
 * ```
 *
 * @module
 */

// Main exports
export { Auth, createAuth } from './auth'

// Managers
export { UserManager, type CreateUserParams, type UpdateUserParams } from './users'
export { SessionManager, type CreateSessionOptions, type SessionValidationResult } from './sessions'
export { MFAManager } from './mfa'
export { OAuthManager, type RegisterClientParams } from './oauth'

// Error
export { AuthError, AuthErrors } from './error'

// JWT utilities
export {
  createJWT,
  verifyJWT,
  decodeJWT,
  isTokenExpired,
  getTokenExpiration,
  getTokenTTL,
  getTokenSubject,
  type JWTCreateOptions,
  type JWTVerifyOptions,
  type JWTVerifyResult,
} from './jwt'

// Storage
export { createInMemoryStorage, IndexedStorage, type StorageBackend, type StoragePutOptions } from './storage'

// Types
export type {
  // User types
  User,
  UserRecord,
  UserMetadata,
  AppMetadata,
  Identity,
  // Session types
  Session,
  SessionRecord,
  DeviceInfo,
  TokenPair,
  // JWT types
  JWTClaims,
  JWTHeader,
  // MFA types
  MFAFactor,
  TOTPEnrollment,
  MFAChallenge,
  // OAuth types
  OAuthClient,
  OAuthAuthorizationRequest,
  OAuthTokenResponse,
  // Config types
  AuthConfig,
  MFAConfig,
  StorageBackend,
  StoragePutOptions,
  // Result types
  AuthResult,
  TokenValidationResult,
  PasswordVerificationResult,
} from './types'
