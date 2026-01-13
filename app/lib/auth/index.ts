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

// CSRF Protection
export {
  generateCSRFToken,
  validateCSRFToken,
  validateCSRFRequest,
  buildCSRFCookie,
  parseCSRFCookie,
  extractCSRFTokenFromRequest,
  CSRF_DEFAULTS,
  type CSRFConfig,
} from './csrf'

// OAuth Providers
export {
  OAUTH_PROVIDERS,
  isProviderEnabled,
  getEnabledProviders,
  getProviderConfig,
  buildOAuthUrl,
  generateCodeVerifier,
  generateCodeChallengeAsync,
  exchangeCodeForTokens,
  fetchProviderUserInfo,
  type OAuthProviderId,
  type OAuthProviderConfig,
  type OAuthUrlOptions,
} from './oauth-providers'

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
