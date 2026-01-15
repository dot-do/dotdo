/**
 * Auth Module Exports
 *
 * Central export point for all authentication functionality.
 */

// JWT validation
export {
  createJwt,
  validateJwt,
  decodeJwt,
  extractBearerToken,
  extractQueryToken,
  authenticateRequest,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  tokenNeedsRefresh,
  refreshJwt,
} from './jwt'

// AuthKit integration
export {
  getWorkOSUser,
  exchangeCodeForTokens,
  refreshAccessToken,
  mapRolesToPermissions,
  getPrimaryOrgId,
  createSession,
  createSessionJwt,
  storeSession,
  getSession,
  getSessionByUserId,
  deleteSession,
  isSessionValid,
} from './authkit'

// OAuth flow
export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  storeOAuthState,
  consumeOAuthState,
  getAuthorizationUrl,
  handleOAuthCallback,
  handleAuthorizeRequest,
  handleLogoutRequest,
} from './oauth'
