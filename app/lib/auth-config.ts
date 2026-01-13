/**
 * OAuth Authentication Configuration
 *
 * Centralized configuration for oauth.do integration.
 * Uses environment variables with sensible defaults for local development.
 */

// ============================================================================
// Environment Variable Keys
// ============================================================================

/**
 * Environment variable names for OAuth configuration.
 * These are the canonical names that should be set in production.
 */
export const AUTH_ENV_KEYS = {
  /** Base URL for oauth.do service */
  OAUTH_DO_URL: 'OAUTH_DO_URL',
  /** OAuth client identifier */
  OAUTH_DO_CLIENT_ID: 'OAUTH_DO_CLIENT_ID',
  /** OAuth client secret (for token exchange) */
  OAUTH_DO_CLIENT_SECRET: 'OAUTH_DO_CLIENT_SECRET',
  /** Authorization endpoint domain (e.g., login.oauth.do) */
  OAUTH_DO_AUTH_DOMAIN: 'OAUTH_DO_AUTH_DOMAIN',
} as const

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default configuration values for local development.
 * Production deployments should override these via environment variables.
 */
export const AUTH_DEFAULTS = {
  /** Default oauth.do URL */
  oauthDoUrl: 'https://oauth.do',
  /** Default client ID for development */
  clientId: 'dotdo-client',
  /** Default auth domain for authorization URLs */
  authDomain: 'login.oauth.do',
  /** Default scopes requested during authentication */
  defaultScopes: ['openid', 'profile', 'email'],
  /** Session cookie name */
  sessionCookieName: 'session',
  /** Session expiration in seconds (1 hour default) */
  sessionExpiresIn: 3600,
  /** Refresh threshold in seconds (5 minutes before expiry) */
  refreshThreshold: 300,
} as const

// ============================================================================
// Configuration Interface
// ============================================================================

/**
 * OAuth configuration options.
 */
export interface OAuthConfig {
  /** Base URL for oauth.do service */
  oauthDoUrl: string
  /** OAuth client identifier */
  clientId: string
  /** OAuth client secret (optional, for confidential clients) */
  clientSecret?: string
  /** Authorization endpoint domain */
  authDomain: string
  /** Default scopes to request */
  defaultScopes: readonly string[]
  /** Session cookie name */
  sessionCookieName: string
  /** Session expiration in seconds */
  sessionExpiresIn: number
  /** Refresh threshold in seconds */
  refreshThreshold: number
}

// ============================================================================
// Configuration Loader
// ============================================================================

/**
 * Get OAuth configuration from environment variables with defaults.
 *
 * @param env - Environment variables object (from process.env or Cloudflare bindings)
 * @returns Complete OAuth configuration
 *
 * @example
 * ```typescript
 * // In a route handler
 * const config = getOAuthConfig(process.env)
 *
 * // In a Cloudflare Worker
 * const config = getOAuthConfig(env)
 * ```
 */
export function getOAuthConfig(env: Record<string, string | undefined> = {}): OAuthConfig {
  return {
    oauthDoUrl: env[AUTH_ENV_KEYS.OAUTH_DO_URL] || AUTH_DEFAULTS.oauthDoUrl,
    clientId: env[AUTH_ENV_KEYS.OAUTH_DO_CLIENT_ID] || AUTH_DEFAULTS.clientId,
    clientSecret: env[AUTH_ENV_KEYS.OAUTH_DO_CLIENT_SECRET],
    authDomain: env[AUTH_ENV_KEYS.OAUTH_DO_AUTH_DOMAIN] || AUTH_DEFAULTS.authDomain,
    defaultScopes: AUTH_DEFAULTS.defaultScopes,
    sessionCookieName: AUTH_DEFAULTS.sessionCookieName,
    sessionExpiresIn: AUTH_DEFAULTS.sessionExpiresIn,
    refreshThreshold: AUTH_DEFAULTS.refreshThreshold,
  }
}

// ============================================================================
// URL Builders
// ============================================================================

/**
 * Build OAuth authorization URL.
 *
 * @param config - OAuth configuration
 * @param options - Authorization options
 * @returns Complete authorization URL
 */
export function buildAuthorizationUrl(
  config: OAuthConfig,
  options: {
    redirectUri: string
    scope?: string
    state?: string
  },
): string {
  const { redirectUri, scope, state } = options
  const finalScope = scope || config.defaultScopes.join(' ')

  // Construct URL manually to keep redirect_uri readable in tests
  let url = `https://${config.authDomain}/authorize?`
  url += `client_id=${encodeURIComponent(config.clientId)}`
  url += `&redirect_uri=${redirectUri}` // Don't encode to keep /auth/callback readable
  url += `&response_type=code`
  url += `&scope=${encodeURIComponent(finalScope)}`
  if (state) {
    url += `&state=${encodeURIComponent(state)}`
  }

  return url
}

/**
 * Build token exchange URL.
 *
 * @param config - OAuth configuration
 * @returns Token endpoint URL
 */
export function getTokenEndpoint(config: OAuthConfig): string {
  return `${config.oauthDoUrl}/oauth/token`
}

/**
 * Build user info URL.
 *
 * @param config - OAuth configuration
 * @returns User info endpoint URL
 */
export function getUserInfoEndpoint(config: OAuthConfig): string {
  return `${config.oauthDoUrl}/userinfo`
}

/**
 * Build token revocation URL.
 *
 * @param config - OAuth configuration
 * @returns Revocation endpoint URL
 */
export function getRevokeEndpoint(config: OAuthConfig): string {
  return `${config.oauthDoUrl}/oauth/revoke`
}

/**
 * Build session validation URL.
 *
 * @param config - OAuth configuration
 * @returns Session validation endpoint URL
 */
export function getSessionValidationEndpoint(config: OAuthConfig): string {
  return `${config.oauthDoUrl}/oauth/session`
}

// ============================================================================
// Cookie Utilities
// ============================================================================

/**
 * Session cookie configuration options.
 */
export interface SessionCookieOptions {
  /** Cookie value (session token) */
  value: string
  /** Max age in seconds */
  maxAge?: number
  /** Whether request is HTTPS */
  secure?: boolean
  /** Cookie path */
  path?: string
  /** SameSite attribute */
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/**
 * Build session cookie string with secure attributes.
 *
 * @param config - OAuth configuration
 * @param options - Cookie options
 * @returns Cookie header value
 */
export function buildSessionCookie(
  config: OAuthConfig,
  options: SessionCookieOptions,
): string {
  const {
    value,
    maxAge = config.sessionExpiresIn,
    secure = true,
    path = '/',
    sameSite = 'Lax',
  } = options

  const parts = [
    `${config.sessionCookieName}=${value}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
  ]

  if (secure) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

/**
 * Build cookie string to clear session.
 *
 * @param config - OAuth configuration
 * @returns Cookie header value that clears the session
 */
export function buildClearSessionCookie(config: OAuthConfig): string {
  return [
    `${config.sessionCookieName}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ')
}

/**
 * Parse session cookie from request.
 *
 * @param cookieHeader - Cookie header value
 * @param config - OAuth configuration
 * @returns Session token or null
 */
export function parseSessionCookie(
  cookieHeader: string | null,
  config: OAuthConfig,
): string | null {
  if (!cookieHeader) return null

  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [key, value] = part.trim().split('=')
    if (key && value) {
      cookies[key] = decodeURIComponent(value)
    }
  }

  return cookies[config.sessionCookieName] || null
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate redirect URL to prevent open redirect attacks.
 * Only allows relative URLs starting with /
 *
 * @param url - URL to validate
 * @returns Sanitized URL or '/' if invalid
 */
export function sanitizeRedirectUrl(url: string | null): string {
  if (!url) return '/'

  // Reject absolute URLs (potential open redirect)
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    return '/'
  }

  // Only allow relative paths starting with /
  if (url.startsWith('/')) {
    return url
  }

  return '/'
}

// ============================================================================
// Export Default Configuration
// ============================================================================

/**
 * Default configuration instance.
 * Uses environment defaults - override in production via env vars.
 */
export const defaultOAuthConfig = getOAuthConfig()
