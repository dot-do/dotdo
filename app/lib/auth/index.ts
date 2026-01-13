/**
 * Authentication Module
 *
 * Unified exports for oauth.do authentication integration.
 *
 * @example
 * ```typescript
 * import { getOAuthConfig, buildAuthorizationUrl, sanitizeRedirectUrl } from '../lib/auth'
 * import type { AuthUser, AuthState, OAuthConfig } from '../lib/auth'
 * ```
 */

// Configuration
export {
  AUTH_ENV_KEYS,
  AUTH_DEFAULTS,
  getOAuthConfig,
  buildAuthorizationUrl,
  getTokenEndpoint,
  getUserInfoEndpoint,
  getRevokeEndpoint,
  getSessionValidationEndpoint,
  buildSessionCookie,
  buildClearSessionCookie,
  parseSessionCookie,
  sanitizeRedirectUrl,
  defaultOAuthConfig,
  type OAuthConfig,
  type SessionCookieOptions,
} from '../auth-config'

// Types
export type {
  AuthUser,
  User,
  SessionData,
  Session,
  AuthState,
  AuthMethods,
  AuthContextType,
  TokenResponse,
  OAuthError,
  UserInfoResponse,
  SessionResponse,
  AuthErrorResponse,
  AuthContext,
  ProtectedHandler,
  AuthMiddlewareConfig,
} from '../../types/auth'
