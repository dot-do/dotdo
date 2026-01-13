/**
 * Authentication Types
 *
 * Shared TypeScript types for oauth.do authentication.
 * Used by both app and API code.
 */

// ============================================================================
// User Types
// ============================================================================

/**
 * User information from oauth.do session.
 */
export interface AuthUser {
  /** Unique user identifier */
  id: string
  /** User's email address */
  email?: string
  /** User's display name */
  name?: string
  /** User's avatar/profile image URL */
  avatar?: string
  /** User's role in the system */
  role?: 'admin' | 'user'
  /** User's permissions */
  permissions?: string[]
}

/**
 * Lightweight user info for frontend display.
 */
export interface User {
  id: string
  email?: string
  name?: string
  avatar?: string
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session data stored after successful authentication.
 */
export interface SessionData {
  /** User's unique identifier */
  userId: string
  /** User's email */
  email: string
  /** User's display name */
  name: string
  /** Access token for API calls */
  accessToken: string
  /** Refresh token for token refresh */
  refreshToken?: string
  /** Session expiration timestamp */
  expiresAt?: Date
}

/**
 * Session information for middleware.
 */
export interface Session {
  /** Session unique identifier */
  id: string
  /** User ID this session belongs to */
  userId: string
  /** Session token */
  token: string
  /** Session expiration */
  expiresAt: Date
  /** IP address of session creation */
  ipAddress?: string
  /** User agent of session creation */
  userAgent?: string
}

// ============================================================================
// Authentication State Types
// ============================================================================

/**
 * Authentication state for React context.
 */
export interface AuthState {
  /** Current authenticated user, null if not authenticated */
  user: User | null
  /** Whether user is authenticated */
  isAuthenticated: boolean
  /** Whether auth state is being loaded */
  isLoading: boolean
  /** Error message if auth failed */
  error: string | null
}

/**
 * Authentication methods for React context.
 */
export interface AuthMethods {
  /** Initiate login flow */
  login: (returnTo?: string) => void
  /** Logout and clear session */
  logout: () => Promise<void>
  /** Refresh session from server */
  refreshSession: () => Promise<void>
}

/**
 * Combined auth context type.
 */
export type AuthContextType = AuthState & AuthMethods

// ============================================================================
// OAuth Types
// ============================================================================

/**
 * OAuth token response from token exchange.
 */
export interface TokenResponse {
  /** Access token for API requests */
  access_token: string
  /** Token type (usually "Bearer") */
  token_type: string
  /** Token expiration in seconds */
  expires_in: number
  /** Refresh token for obtaining new access tokens */
  refresh_token?: string
  /** ID token (for OpenID Connect) */
  id_token?: string
  /** Granted scopes */
  scope?: string
}

/**
 * OAuth error response.
 */
export interface OAuthError {
  /** Error code */
  error: string
  /** Human-readable error description */
  error_description?: string
  /** Error URI for more information */
  error_uri?: string
}

/**
 * User info response from oauth.do.
 */
export interface UserInfoResponse {
  /** Subject identifier */
  sub: string
  /** User's email address */
  email?: string
  /** Whether email is verified */
  email_verified?: boolean
  /** User's full name */
  name?: string
  /** User's given/first name */
  given_name?: string
  /** User's family/last name */
  family_name?: string
  /** User's profile picture URL */
  picture?: string
  /** User's locale */
  locale?: string
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Session endpoint response.
 */
export interface SessionResponse {
  /** Whether user is authenticated */
  authenticated: boolean
  /** User info if authenticated */
  user?: User
}

/**
 * Auth error response structure.
 */
export interface AuthErrorResponse {
  error: {
    /** HTTP status code */
    status: number
    /** Error message */
    message: string
  }
}

// ============================================================================
// Middleware Types
// ============================================================================

/**
 * Auth context set by middleware.
 */
export interface AuthContext {
  /** User's unique identifier */
  userId: string
  /** User's email */
  email?: string
  /** User's role */
  role: 'admin' | 'user'
  /** User's permissions */
  permissions?: string[]
  /** Authentication method used */
  method: 'jwt' | 'session' | 'apikey' | 'oauth'
}

/**
 * Protected route handler type.
 */
export type ProtectedHandler = (request: Request, user: AuthUser) => Promise<Response>

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Auth middleware configuration.
 */
export interface AuthMiddlewareConfig {
  /** Routes that don't require authentication */
  publicRoutes?: string[]
  /** Session refresh threshold in seconds */
  refreshThreshold?: number
  /** Rate limit for unauthenticated requests per minute */
  rateLimitUnauthenticated?: number
}
