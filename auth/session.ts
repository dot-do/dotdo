/**
 * Session Management Module
 *
 * Provides secure session handling with:
 * - Secure cookie configuration
 * - Session rotation on privilege changes
 * - Activity tracking
 * - Multi-device session management
 *
 * @module auth/session
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * Session configuration
 */
export const SESSION_CONFIG = {
  /**
   * Session token cookie name
   */
  cookieName: 'dotdo_session',

  /**
   * Default session duration (7 days)
   */
  defaultDurationMs: 7 * 24 * 60 * 60 * 1000,

  /**
   * Remember me duration (30 days)
   */
  rememberMeDurationMs: 30 * 24 * 60 * 60 * 1000,

  /**
   * Session update interval (24 hours)
   * Sessions are refreshed if activity happens after this interval
   */
  updateIntervalMs: 24 * 60 * 60 * 1000,

  /**
   * Maximum idle time before requiring re-auth (15 minutes for sensitive operations)
   */
  sensitiveIdleTimeMs: 15 * 60 * 1000,

  /**
   * Maximum concurrent sessions per user
   */
  maxSessionsPerUser: 10,

  /**
   * Session token length (characters)
   */
  tokenLength: 64,
} as const

// =============================================================================
// Types
// =============================================================================

/**
 * Session data stored in the database/cache
 */
export interface SessionData {
  /** Unique session ID */
  id: string
  /** Session token (hashed in storage) */
  token: string
  /** User ID this session belongs to */
  userId: string
  /** Creation timestamp */
  createdAt: Date
  /** Expiration timestamp */
  expiresAt: Date
  /** Last activity timestamp */
  lastActiveAt: Date
  /** IP address from session creation */
  ipAddress: string
  /** User agent string */
  userAgent: string
  /** Whether this is a "remember me" session */
  isRememberMe: boolean
  /** Whether this session has elevated privileges */
  isElevated?: boolean
  /** When elevated privileges expire */
  elevatedUntil?: Date
}

/**
 * Minimal session info for display
 */
export interface SessionInfo {
  id: string
  device: string
  browser: string
  ipAddress: string
  location?: string
  createdAt: Date
  lastActiveAt: Date
  isCurrent: boolean
}

/**
 * Cookie options for session tokens
 */
export interface SessionCookieOptions {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict' | 'lax' | 'none'
  path: string
  maxAge: number
  domain?: string
}

// =============================================================================
// Token Generation
// =============================================================================

/**
 * Generate a cryptographically secure session token.
 *
 * @returns A random session token
 */
export function generateSessionToken(): string {
  // Use multiple UUIDs for extra entropy
  const parts = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  // Remove dashes and get consistent length
  const token = parts.join('').replace(/-/g, '')
  return token.substring(0, SESSION_CONFIG.tokenLength)
}

/**
 * Hash a session token for storage.
 * We store hashed tokens to prevent session hijacking if the database is compromised.
 *
 * @param token - The raw session token
 * @returns Hashed token for storage
 */
export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// Cookie Helpers
// =============================================================================

/**
 * Get secure cookie options for session token.
 *
 * Security features:
 * - HttpOnly: Prevents JavaScript access (XSS protection)
 * - Secure: Only sent over HTTPS
 * - SameSite=Lax: Prevents CSRF while allowing top-level navigation
 * - Path=/: Available across the entire site
 *
 * @param token - Session token to store
 * @param options - Cookie configuration options
 * @returns Cookie options object
 */
export function getSessionCookieOptions(
  token: string,
  options: {
    isRememberMe?: boolean
    isProduction?: boolean
    domain?: string
  } = {},
): SessionCookieOptions {
  const { isRememberMe = false, isProduction = true, domain } = options

  const maxAgeMs = isRememberMe ? SESSION_CONFIG.rememberMeDurationMs : SESSION_CONFIG.defaultDurationMs

  return {
    name: SESSION_CONFIG.cookieName,
    value: token,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
    ...(domain && { domain }),
  }
}

/**
 * Format cookie options into a Set-Cookie header value.
 *
 * @param options - Cookie options
 * @returns Set-Cookie header string
 */
export function formatSessionCookie(options: SessionCookieOptions): string {
  const parts = [
    `${options.name}=${encodeURIComponent(options.value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`,
  ]

  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  if (options.secure) {
    parts.push('Secure')
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`)
  }

  return parts.join('; ')
}

/**
 * Generate Set-Cookie header to clear the session.
 *
 * @param domain - Optional domain for the cookie
 * @returns Set-Cookie header string
 */
export function clearSessionCookie(domain?: string): string {
  const parts = [`${SESSION_CONFIG.cookieName}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax']

  if (domain) {
    parts.push(`Domain=${domain}`)
  }

  return parts.join('; ')
}

/**
 * Extract session token from Cookie header.
 *
 * @param cookieHeader - The Cookie header value
 * @returns Session token or null
 */
export function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null
  }

  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split('=')
    if (name === SESSION_CONFIG.cookieName) {
      const value = valueParts.join('=')
      return decodeURIComponent(value)
    }
  }

  return null
}

// =============================================================================
// User Agent Parsing
// =============================================================================

/**
 * Parse user agent string for session display.
 *
 * @param userAgent - User agent string
 * @returns Parsed device and browser info
 */
export function parseUserAgent(userAgent: string): { device: string; browser: string } {
  // Simple parsing - in production, use a proper UA parser library
  let device = 'Unknown device'
  let browser = 'Unknown browser'

  // Detect device
  if (/iPhone/i.test(userAgent)) {
    device = 'iPhone'
  } else if (/iPad/i.test(userAgent)) {
    device = 'iPad'
  } else if (/Android/i.test(userAgent)) {
    device = 'Android device'
  } else if (/Windows/i.test(userAgent)) {
    device = 'Windows PC'
  } else if (/Macintosh|Mac OS/i.test(userAgent)) {
    device = 'Mac'
  } else if (/Linux/i.test(userAgent)) {
    device = 'Linux PC'
  }

  // Detect browser
  if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) {
    const match = userAgent.match(/Chrome\/([\d.]+)/)
    browser = match ? `Chrome ${match[1]?.split('.')[0]}` : 'Chrome'
  } else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) {
    const match = userAgent.match(/Version\/([\d.]+)/)
    browser = match ? `Safari ${match[1]?.split('.')[0]}` : 'Safari'
  } else if (/Firefox/i.test(userAgent)) {
    const match = userAgent.match(/Firefox\/([\d.]+)/)
    browser = match ? `Firefox ${match[1]?.split('.')[0]}` : 'Firefox'
  } else if (/Edg/i.test(userAgent)) {
    const match = userAgent.match(/Edg\/([\d.]+)/)
    browser = match ? `Edge ${match[1]?.split('.')[0]}` : 'Edge'
  }

  return { device, browser }
}

/**
 * Format session for display.
 *
 * @param session - Session data
 * @param currentToken - Current session token (to mark as current)
 * @returns Formatted session info
 */
export function formatSessionForDisplay(session: SessionData, currentToken?: string): SessionInfo {
  const { device, browser } = parseUserAgent(session.userAgent)

  return {
    id: session.id,
    device,
    browser,
    ipAddress: maskIPAddress(session.ipAddress),
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    isCurrent: currentToken ? session.token === currentToken : false,
  }
}

/**
 * Mask IP address for privacy (show only first two octets).
 *
 * @param ip - Full IP address
 * @returns Masked IP address
 */
function maskIPAddress(ip: string): string {
  if (!ip || ip === 'unknown') {
    return 'Unknown'
  }

  // IPv4
  const parts = ip.split('.')
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`
  }

  // IPv6 - show first 4 groups
  const v6Parts = ip.split(':')
  if (v6Parts.length >= 4) {
    return `${v6Parts.slice(0, 4).join(':')}:****`
  }

  return ip
}

// =============================================================================
// Session Validation
// =============================================================================

/**
 * Session validation result
 */
export interface SessionValidationResult {
  valid: boolean
  session?: SessionData
  error?: 'not_found' | 'expired' | 'invalid' | 'revoked'
  /** Whether the session should be refreshed */
  shouldRefresh?: boolean
}

/**
 * Check if a session needs refresh (based on last activity).
 *
 * @param session - Session data
 * @returns Whether the session should be refreshed
 */
export function shouldRefreshSession(session: SessionData): boolean {
  const timeSinceUpdate = Date.now() - session.lastActiveAt.getTime()
  return timeSinceUpdate > SESSION_CONFIG.updateIntervalMs
}

/**
 * Check if session is expired.
 *
 * @param session - Session data
 * @returns Whether the session has expired
 */
export function isSessionExpired(session: SessionData): boolean {
  return new Date() > session.expiresAt
}

/**
 * Check if elevated privileges have expired.
 *
 * @param session - Session data
 * @returns Whether elevated privileges are still valid
 */
export function hasElevatedPrivileges(session: SessionData): boolean {
  if (!session.isElevated || !session.elevatedUntil) {
    return false
  }
  return new Date() < session.elevatedUntil
}

/**
 * Check if re-authentication is required for sensitive operations.
 *
 * @param session - Session data
 * @returns Whether re-auth is required
 */
export function requiresReauthentication(session: SessionData): boolean {
  const timeSinceActive = Date.now() - session.lastActiveAt.getTime()
  return timeSinceActive > SESSION_CONFIG.sensitiveIdleTimeMs
}

// =============================================================================
// Session Rotation
// =============================================================================

/**
 * Determine if session should be rotated.
 * Rotation is recommended after:
 * - Privilege escalation (e.g., becoming admin)
 * - Password change
 * - Sensitive actions
 *
 * @param reason - Reason for potential rotation
 * @returns Whether to rotate the session
 */
export function shouldRotateSession(
  reason: 'privilege_change' | 'password_change' | 'sensitive_action' | 'periodic',
): boolean {
  // Always rotate on privilege or password changes
  if (reason === 'privilege_change' || reason === 'password_change') {
    return true
  }

  // Rotate on sensitive actions
  if (reason === 'sensitive_action') {
    return true
  }

  // Periodic rotation (handled elsewhere based on session age)
  return false
}

// =============================================================================
// Session Management Actions
// =============================================================================

/**
 * Create a new session for a user.
 *
 * @param userId - User ID
 * @param request - Incoming request (for IP and UA extraction)
 * @param options - Session options
 * @returns New session data and cookie
 */
export async function createNewSession(
  userId: string,
  request: Request,
  options: {
    isRememberMe?: boolean
    isProduction?: boolean
  } = {},
): Promise<{ session: SessionData; cookie: string }> {
  const { isRememberMe = false, isProduction = true } = options

  const token = generateSessionToken()
  const now = new Date()
  const durationMs = isRememberMe ? SESSION_CONFIG.rememberMeDurationMs : SESSION_CONFIG.defaultDurationMs

  const session: SessionData = {
    id: crypto.randomUUID(),
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + durationMs),
    lastActiveAt: now,
    ipAddress: extractClientIP(request),
    userAgent: request.headers.get('User-Agent') || 'Unknown',
    isRememberMe,
  }

  const cookieOptions = getSessionCookieOptions(token, { isRememberMe, isProduction })
  const cookie = formatSessionCookie(cookieOptions)

  return { session, cookie }
}

/**
 * Extract client IP from request.
 */
function extractClientIP(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  )
}

// =============================================================================
// Security Helpers
// =============================================================================

/**
 * Validate session origin to prevent session fixation.
 * Compares IP and user agent from request to stored session.
 *
 * @param session - Stored session data
 * @param request - Current request
 * @returns Whether the session origin is valid
 */
export function validateSessionOrigin(session: SessionData, request: Request): boolean {
  const currentIP = extractClientIP(request)
  const currentUA = request.headers.get('User-Agent') || ''

  // IP validation (allow for some variance due to mobile networks)
  // We only check first two octets for IPv4
  const sessionIPParts = session.ipAddress.split('.')
  const currentIPParts = currentIP.split('.')

  if (sessionIPParts.length === 4 && currentIPParts.length === 4) {
    if (sessionIPParts[0] !== currentIPParts[0] || sessionIPParts[1] !== currentIPParts[1]) {
      // Different network - could be suspicious
      // In production, you might want to flag this for review rather than reject
      return true // Allowing for now, but logging would be appropriate
    }
  }

  // User agent validation (basic check)
  // Allow minor UA differences (version updates)
  const sessionBrowser = parseUserAgent(session.userAgent).browser.split(' ')[0]
  const currentBrowser = parseUserAgent(currentUA).browser.split(' ')[0]

  if (sessionBrowser !== currentBrowser && sessionBrowser !== 'Unknown' && currentBrowser !== 'Unknown') {
    // Different browser family - suspicious
    return false
  }

  return true
}

/**
 * Generate session fingerprint for additional verification.
 *
 * @param request - Current request
 * @returns Fingerprint hash
 */
export async function generateSessionFingerprint(request: Request): Promise<string> {
  const components = [
    request.headers.get('User-Agent') || '',
    request.headers.get('Accept-Language') || '',
    request.headers.get('Accept-Encoding') || '',
  ]

  const encoder = new TextEncoder()
  const data = encoder.encode(components.join('|'))
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
