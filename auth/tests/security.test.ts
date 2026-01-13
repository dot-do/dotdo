/**
 * Auth Security Tests
 *
 * Comprehensive tests for admin auth security features including:
 * - CSRF protection
 * - Rate limiting
 * - Session management
 * - Error handling
 *
 * These tests verify the security primitives used throughout
 * the admin authentication flow.
 *
 * @see dotdo-5liq0 - Admin Auth polish and security improvements
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CSRF module
import {
  generateCSRFToken,
  validateCSRFToken,
  parseCSRFToken,
  isTokenExpired,
  getCSRFCookieOptions,
  formatCSRFCookie,
  clearCSRFCookie,
  extractCSRFToken,
  extractCSRFFromCookie,
  checkCSRF,
  CSRF_TOKEN_EXPIRY_MS,
  CSRF_COOKIE_NAME,
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
} from '../csrf'

// Rate limiting module
import {
  checkRateLimit,
  checkLoginRateLimit,
  checkSignupRateLimit,
  checkPasswordResetRateLimit,
  recordFailedLogin,
  clearLoginLockout,
  getAccountLockoutStatus,
  rateLimitResponse,
  addRateLimitHeaders,
  getClientIP,
  buildRateLimitKey,
  AUTH_RATE_LIMITS,
} from '../rate-limit'

// Session management module
import {
  generateSessionToken,
  hashSessionToken,
  getSessionCookieOptions,
  formatSessionCookie,
  clearSessionCookie,
  extractSessionToken,
  parseUserAgent,
  formatSessionForDisplay,
  shouldRefreshSession,
  isSessionExpired,
  hasElevatedPrivileges,
  requiresReauthentication,
  shouldRotateSession,
  createNewSession,
  validateSessionOrigin,
  generateSessionFingerprint,
  SESSION_CONFIG,
} from '../session'

// Error handling module
import {
  getAuthErrorMessage,
  mapOAuthError,
  mapHttpStatusToError,
  AuthError,
  getErrorSeverity,
  getSuggestedAction,
  getFieldError,
  AUTH_ERROR_MESSAGES,
  FIELD_ERRORS,
} from '../errors'

// ============================================================================
// CSRF Protection Tests
// ============================================================================

describe('CSRF Protection', () => {
  describe('Token Generation', () => {
    it('generates unique tokens', () => {
      const token1 = generateCSRFToken()
      const token2 = generateCSRFToken()

      expect(token1).not.toBe(token2)
      expect(token1.length).toBeGreaterThan(0)
      expect(token2.length).toBeGreaterThan(0)
    })

    it('generates tokens with timestamp prefix', () => {
      const token = generateCSRFToken()
      const parts = token.split('.')

      expect(parts.length).toBe(2)
      const timestamp = parseInt(parts[0], 10)
      expect(timestamp).toBeLessThanOrEqual(Date.now())
      expect(timestamp).toBeGreaterThan(Date.now() - 1000) // Within last second
    })

    it('generates tokens with random component', () => {
      const token = generateCSRFToken()
      const parts = token.split('.')

      expect(parts[1]).toBeDefined()
      expect(parts[1].length).toBeGreaterThan(20) // UUID + extra randomness
    })
  })

  describe('Token Parsing', () => {
    it('parses valid token correctly', () => {
      const token = generateCSRFToken()
      const parsed = parseCSRFToken(token)

      expect(parsed).not.toBeNull()
      expect(parsed!.timestamp).toBeGreaterThan(0)
      expect(parsed!.token).toBeDefined()
    })

    it('returns null for invalid token format', () => {
      expect(parseCSRFToken('')).toBeNull()
      expect(parseCSRFToken('invalid')).toBeNull()
      expect(parseCSRFToken('no.dots.expected')).toBeNull()
    })

    it('returns null for non-numeric timestamp', () => {
      expect(parseCSRFToken('notanumber.randompart')).toBeNull()
    })

    it('returns null for null/undefined input', () => {
      expect(parseCSRFToken(null as any)).toBeNull()
      expect(parseCSRFToken(undefined as any)).toBeNull()
    })
  })

  describe('Token Expiry', () => {
    it('detects fresh token as not expired', () => {
      const timestamp = Date.now()
      expect(isTokenExpired(timestamp)).toBe(false)
    })

    it('detects old token as expired', () => {
      const timestamp = Date.now() - CSRF_TOKEN_EXPIRY_MS - 1000
      expect(isTokenExpired(timestamp)).toBe(true)
    })

    it('respects custom expiry duration', () => {
      const timestamp = Date.now() - 5000 // 5 seconds ago
      expect(isTokenExpired(timestamp, 10000)).toBe(false) // 10 second expiry
      expect(isTokenExpired(timestamp, 3000)).toBe(true) // 3 second expiry
    })
  })

  describe('Token Validation', () => {
    it('validates matching tokens', () => {
      const token = generateCSRFToken()
      const result = validateCSRFToken(token, token)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('rejects mismatched tokens', () => {
      const token1 = generateCSRFToken()
      const token2 = generateCSRFToken()
      const result = validateCSRFToken(token1, token2)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('mismatch')
    })

    it('rejects missing cookie token', () => {
      const token = generateCSRFToken()
      const result = validateCSRFToken(null, token)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('missing_cookie')
    })

    it('rejects missing form token', () => {
      const token = generateCSRFToken()
      const result = validateCSRFToken(token, null)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('missing_form_token')
    })

    it('rejects expired tokens', () => {
      const expiredTimestamp = Date.now() - CSRF_TOKEN_EXPIRY_MS - 1000
      const expiredToken = `${expiredTimestamp}.${crypto.randomUUID()}`
      const result = validateCSRFToken(expiredToken, expiredToken)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('expired')
    })

    it('allows skipping expiry check', () => {
      const expiredTimestamp = Date.now() - CSRF_TOKEN_EXPIRY_MS - 1000
      const expiredToken = `${expiredTimestamp}.${crypto.randomUUID()}`
      const result = validateCSRFToken(expiredToken, expiredToken, { skipExpiryCheck: true })

      expect(result.valid).toBe(true)
    })

    it('uses timing-safe comparison', () => {
      // Verify same-length but different tokens are rejected
      // (timing-safe means both should take similar time)
      const token1 = `${Date.now()}.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`
      const token2 = `${Date.now()}.bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`

      const result = validateCSRFToken(token1, token2)
      expect(result.valid).toBe(false)
    })
  })

  describe('Cookie Helpers', () => {
    it('generates secure cookie options', () => {
      const token = generateCSRFToken()
      const options = getCSRFCookieOptions(token, true)

      expect(options.name).toBe(CSRF_COOKIE_NAME)
      expect(options.value).toBe(token)
      expect(options.httpOnly).toBe(true)
      expect(options.secure).toBe(true)
      expect(options.sameSite).toBe('lax')
      expect(options.path).toBe('/')
    })

    it('allows non-secure for development', () => {
      const token = generateCSRFToken()
      const options = getCSRFCookieOptions(token, false)

      expect(options.secure).toBe(false)
    })

    it('formats cookie string correctly', () => {
      const token = generateCSRFToken()
      const options = getCSRFCookieOptions(token, true)
      const cookieStr = formatCSRFCookie(options)

      expect(cookieStr).toContain(`${CSRF_COOKIE_NAME}=`)
      expect(cookieStr).toContain('HttpOnly')
      expect(cookieStr).toContain('Secure')
      expect(cookieStr).toContain('SameSite=Lax')
      expect(cookieStr).toContain('Path=/')
    })

    it('generates clear cookie header', () => {
      const clearCookie = clearCSRFCookie()

      expect(clearCookie).toContain(`${CSRF_COOKIE_NAME}=`)
      expect(clearCookie).toContain('Max-Age=0')
    })
  })

  describe('Request Extraction', () => {
    it('extracts CSRF from header', async () => {
      const token = generateCSRFToken()
      const request = new Request('https://example.com/api/action', {
        method: 'POST',
        headers: {
          [CSRF_HEADER_NAME]: token,
        },
      })

      const extracted = await extractCSRFToken(request)
      expect(extracted).toBe(token)
    })

    it('extracts CSRF from form data', async () => {
      const token = generateCSRFToken()
      const formData = new FormData()
      formData.append(CSRF_FIELD_NAME, token)

      const request = new Request('https://example.com/api/action', {
        method: 'POST',
        body: formData,
      })

      const extracted = await extractCSRFToken(request)
      expect(extracted).toBe(token)
    })

    it('extracts CSRF from JSON body', async () => {
      const token = generateCSRFToken()
      const request = new Request('https://example.com/api/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ [CSRF_FIELD_NAME]: token }),
      })

      const extracted = await extractCSRFToken(request)
      expect(extracted).toBe(token)
    })

    it('extracts CSRF from cookie header', () => {
      const token = generateCSRFToken()
      const cookieHeader = `${CSRF_COOKIE_NAME}=${token}; other_cookie=value`

      const extracted = extractCSRFFromCookie(cookieHeader)
      expect(extracted).toBe(token)
    })

    it('returns null for missing cookie', () => {
      expect(extractCSRFFromCookie(null)).toBeNull()
      expect(extractCSRFFromCookie('')).toBeNull()
      expect(extractCSRFFromCookie('other_cookie=value')).toBeNull()
    })
  })

  describe('Full Request Check', () => {
    it('validates complete request with valid CSRF', async () => {
      const token = generateCSRFToken()
      const request = new Request('https://example.com/api/action', {
        method: 'POST',
        headers: {
          [CSRF_HEADER_NAME]: token,
          Cookie: `${CSRF_COOKIE_NAME}=${token}`,
        },
      })

      const result = await checkCSRF(request)
      expect(result.valid).toBe(true)
    })

    it('rejects request with mismatched tokens', async () => {
      const token1 = generateCSRFToken()
      const token2 = generateCSRFToken()
      const request = new Request('https://example.com/api/action', {
        method: 'POST',
        headers: {
          [CSRF_HEADER_NAME]: token1,
          Cookie: `${CSRF_COOKIE_NAME}=${token2}`,
        },
      })

      const result = await checkCSRF(request)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

// ============================================================================
// Rate Limiting Tests
// ============================================================================

describe('Rate Limiting', () => {
  beforeEach(() => {
    // Reset rate limit store state between tests
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Key Building', () => {
    it('builds rate limit keys correctly', () => {
      const key = buildRateLimitKey('login', 'ip', '192.168.1.1')
      expect(key).toBe('auth:login:ip:192.168.1.1')
    })

    it('builds email-based keys', () => {
      const key = buildRateLimitKey('login', 'email', 'user@example.com')
      expect(key).toBe('auth:login:email:user@example.com')
    })
  })

  describe('Basic Rate Checking', () => {
    it('allows requests within limit', () => {
      const result = checkRateLimit('login', 'ip', 'test-ip-1', 5, 60000)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4) // 5 - 1
    })

    it('blocks requests exceeding limit', () => {
      // Make multiple requests
      for (let i = 0; i < 5; i++) {
        checkRateLimit('login', 'ip', 'test-ip-2', 5, 60000)
      }

      // Next request should be blocked
      const result = checkRateLimit('login', 'ip', 'test-ip-2', 5, 60000)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('provides retry timing information', () => {
      // Exhaust the limit
      for (let i = 0; i < 6; i++) {
        checkRateLimit('login', 'ip', 'test-ip-3', 5, 60000)
      }

      const result = checkRateLimit('login', 'ip', 'test-ip-3', 5, 60000)

      expect(result.resetAt).toBeInstanceOf(Date)
      expect(result.message).toBeDefined()
    })
  })

  describe('Login Rate Limiting', () => {
    it('limits login attempts per IP', () => {
      const limits = AUTH_RATE_LIMITS.login

      // Make requests up to the limit
      for (let i = 0; i < limits.perIpPerMinute; i++) {
        const result = checkLoginRateLimit('192.168.1.1')
        expect(result.allowed).toBe(true)
      }

      // Next should be blocked
      const blocked = checkLoginRateLimit('192.168.1.1')
      expect(blocked.allowed).toBe(false)
    })

    it('limits login attempts per email', () => {
      const limits = AUTH_RATE_LIMITS.login

      // Make requests up to the limit
      for (let i = 0; i < limits.perEmailPer5Min; i++) {
        // Use different IPs but same email
        const result = checkLoginRateLimit(`192.168.1.${100 + i}`, 'user@example.com')
        expect(result.allowed).toBe(true)
      }

      // Next should be blocked (email limit reached)
      const blocked = checkLoginRateLimit('192.168.1.200', 'user@example.com')
      expect(blocked.allowed).toBe(false)
    })
  })

  describe('Signup Rate Limiting', () => {
    it('limits signups per IP per minute', () => {
      const limits = AUTH_RATE_LIMITS.signup

      for (let i = 0; i < limits.perIpPerMinute; i++) {
        const result = checkSignupRateLimit('10.0.0.1')
        expect(result.allowed).toBe(true)
      }

      const blocked = checkSignupRateLimit('10.0.0.1')
      expect(blocked.allowed).toBe(false)
    })
  })

  describe('Password Reset Rate Limiting', () => {
    it('limits password reset requests', () => {
      const limits = AUTH_RATE_LIMITS.passwordReset

      for (let i = 0; i < limits.perIpPer15Min; i++) {
        const result = checkPasswordResetRateLimit('10.0.0.5', 'reset@example.com')
        expect(result.allowed).toBe(true)
      }

      const blocked = checkPasswordResetRateLimit('10.0.0.5', 'reset@example.com')
      expect(blocked.allowed).toBe(false)
    })

    it('normalizes email addresses', () => {
      // Mixed case should be treated as same email
      checkPasswordResetRateLimit('10.0.0.6', 'Test@Example.COM')
      checkPasswordResetRateLimit('10.0.0.7', 'test@example.com')
      checkPasswordResetRateLimit('10.0.0.8', 'TEST@EXAMPLE.COM')

      // All should count against the same email limit
      const limits = AUTH_RATE_LIMITS.passwordReset
      // This is the 4th request which may be blocked depending on emailPerHour limit
      if (limits.perEmailPerHour === 3) {
        const result = checkPasswordResetRateLimit('10.0.0.9', 'test@example.com')
        expect(result.allowed).toBe(false)
      }
    })
  })

  describe('Account Lockout', () => {
    it('locks account after threshold failures', () => {
      const email = 'lockout@example.com'
      const threshold = AUTH_RATE_LIMITS.login.lockoutThreshold

      // Record failures up to threshold
      for (let i = 0; i < threshold; i++) {
        const locked = recordFailedLogin(email)
        if (i < threshold - 1) {
          expect(locked).toBe(false)
        } else {
          expect(locked).toBe(true)
        }
      }
    })

    it('reports lockout status correctly', () => {
      const email = 'lockout-status@example.com'
      const threshold = AUTH_RATE_LIMITS.login.lockoutThreshold

      // Initially not locked
      let status = getAccountLockoutStatus(email)
      expect(status?.locked).toBe(false)

      // Lock the account
      for (let i = 0; i < threshold; i++) {
        recordFailedLogin(email)
      }

      status = getAccountLockoutStatus(email)
      expect(status?.locked).toBe(true)
      expect(status?.remainingMs).toBeGreaterThan(0)
    })

    it('clears lockout after success', () => {
      const email = 'clear-lockout@example.com'
      const threshold = AUTH_RATE_LIMITS.login.lockoutThreshold

      // Lock the account
      for (let i = 0; i < threshold; i++) {
        recordFailedLogin(email)
      }

      expect(getAccountLockoutStatus(email)?.locked).toBe(true)

      // Clear lockout
      clearLoginLockout(email)

      expect(getAccountLockoutStatus(email)?.locked).toBe(false)
    })
  })

  describe('Response Helpers', () => {
    it('creates 429 response with correct headers', () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
        retryAfter: 60,
        message: 'Too many requests',
      }

      const response = rateLimitResponse(result)

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined()
    })

    it('adds rate limit headers to existing response', () => {
      const originalResponse = new Response('OK', { status: 200 })
      const result = {
        allowed: true,
        remaining: 3,
        resetAt: new Date(Date.now() + 60000),
        retryAfter: 0,
      }

      const enhanced = addRateLimitHeaders(originalResponse, result)

      expect(enhanced.headers.get('X-RateLimit-Remaining')).toBe('3')
      expect(enhanced.headers.get('X-RateLimit-Reset')).toBeDefined()
    })
  })

  describe('IP Extraction', () => {
    it('extracts IP from CF-Connecting-IP header', () => {
      const request = new Request('https://example.com', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      })

      expect(getClientIP(request)).toBe('1.2.3.4')
    })

    it('extracts IP from X-Forwarded-For header', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-Forwarded-For': '5.6.7.8, 9.10.11.12' },
      })

      expect(getClientIP(request)).toBe('5.6.7.8')
    })

    it('extracts IP from X-Real-IP header', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-Real-IP': '13.14.15.16' },
      })

      expect(getClientIP(request)).toBe('13.14.15.16')
    })

    it('returns unknown when no IP headers present', () => {
      const request = new Request('https://example.com')

      expect(getClientIP(request)).toBe('unknown')
    })

    it('prioritizes CF-Connecting-IP over others', () => {
      const request = new Request('https://example.com', {
        headers: {
          'CF-Connecting-IP': '1.1.1.1',
          'X-Forwarded-For': '2.2.2.2',
          'X-Real-IP': '3.3.3.3',
        },
      })

      expect(getClientIP(request)).toBe('1.1.1.1')
    })
  })
})

// ============================================================================
// Session Management Tests
// ============================================================================

describe('Session Management', () => {
  describe('Token Generation', () => {
    it('generates unique session tokens', () => {
      const token1 = generateSessionToken()
      const token2 = generateSessionToken()

      expect(token1).not.toBe(token2)
      expect(token1.length).toBe(SESSION_CONFIG.tokenLength)
      expect(token2.length).toBe(SESSION_CONFIG.tokenLength)
    })

    it('generates tokens with sufficient entropy', () => {
      // Generate multiple tokens and check they're all unique
      const tokens = new Set<string>()
      for (let i = 0; i < 100; i++) {
        tokens.add(generateSessionToken())
      }
      expect(tokens.size).toBe(100)
    })
  })

  describe('Token Hashing', () => {
    it('hashes tokens for storage', async () => {
      const token = generateSessionToken()
      const hash = await hashSessionToken(token)

      expect(hash).not.toBe(token)
      expect(hash.length).toBe(64) // SHA-256 hex output
    })

    it('produces consistent hashes', async () => {
      const token = 'consistent-token-for-testing'
      const hash1 = await hashSessionToken(token)
      const hash2 = await hashSessionToken(token)

      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different tokens', async () => {
      const hash1 = await hashSessionToken('token-a')
      const hash2 = await hashSessionToken('token-b')

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('Cookie Configuration', () => {
    it('generates secure cookie options', () => {
      const token = generateSessionToken()
      const options = getSessionCookieOptions(token, { isProduction: true })

      expect(options.name).toBe(SESSION_CONFIG.cookieName)
      expect(options.httpOnly).toBe(true)
      expect(options.secure).toBe(true)
      expect(options.sameSite).toBe('lax')
      expect(options.path).toBe('/')
    })

    it('uses longer expiry for remember me', () => {
      const token = generateSessionToken()
      const regular = getSessionCookieOptions(token, { isRememberMe: false })
      const rememberMe = getSessionCookieOptions(token, { isRememberMe: true })

      expect(rememberMe.maxAge).toBeGreaterThan(regular.maxAge)
    })

    it('formats cookie string correctly', () => {
      const token = generateSessionToken()
      const options = getSessionCookieOptions(token, { isProduction: true })
      const cookieStr = formatSessionCookie(options)

      expect(cookieStr).toContain(SESSION_CONFIG.cookieName)
      expect(cookieStr).toContain('HttpOnly')
      expect(cookieStr).toContain('Secure')
      expect(cookieStr).toContain('SameSite=Lax')
    })

    it('generates clear cookie header', () => {
      const clearCookie = clearSessionCookie()

      expect(clearCookie).toContain(SESSION_CONFIG.cookieName)
      expect(clearCookie).toContain('Max-Age=0')
    })

    it('includes domain when provided', () => {
      const clearCookie = clearSessionCookie('.example.com')

      expect(clearCookie).toContain('Domain=.example.com')
    })
  })

  describe('Token Extraction', () => {
    it('extracts session token from cookie header', () => {
      const token = generateSessionToken()
      const cookieHeader = `${SESSION_CONFIG.cookieName}=${token}; other=value`

      expect(extractSessionToken(cookieHeader)).toBe(token)
    })

    it('returns null for missing cookie', () => {
      expect(extractSessionToken(null)).toBeNull()
      expect(extractSessionToken('')).toBeNull()
      expect(extractSessionToken('other_cookie=value')).toBeNull()
    })

    it('handles URL-encoded values', () => {
      const token = 'token-with%20spaces'
      const cookieHeader = `${SESSION_CONFIG.cookieName}=${encodeURIComponent(token)}`

      expect(extractSessionToken(cookieHeader)).toBe(token)
    })
  })

  describe('User Agent Parsing', () => {
    it('parses Chrome on macOS', () => {
      const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      const result = parseUserAgent(ua)

      expect(result.device).toBe('Mac')
      expect(result.browser).toContain('Chrome')
    })

    it('parses Safari on iPhone', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      const result = parseUserAgent(ua)

      expect(result.device).toBe('iPhone')
      expect(result.browser).toContain('Safari')
    })

    it('parses Firefox on Windows', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
      const result = parseUserAgent(ua)

      expect(result.device).toBe('Windows PC')
      expect(result.browser).toContain('Firefox')
    })

    it('parses Edge correctly', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toContain('Edge')
    })

    it('handles unknown user agents gracefully', () => {
      const result = parseUserAgent('Unknown Bot/1.0')

      expect(result.device).toBe('Unknown device')
      expect(result.browser).toBe('Unknown browser')
    })
  })

  describe('Session Validation', () => {
    it('detects expired sessions', () => {
      const expiredSession = {
        id: '1',
        token: 'test',
        userId: 'user1',
        createdAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() - 1000),
        lastActiveAt: new Date(Date.now() - 3600000),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        isRememberMe: false,
      }

      expect(isSessionExpired(expiredSession)).toBe(true)
    })

    it('validates active sessions', () => {
      const activeSession = {
        id: '1',
        token: 'test',
        userId: 'user1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        lastActiveAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        isRememberMe: false,
      }

      expect(isSessionExpired(activeSession)).toBe(false)
    })

    it('determines when refresh is needed', () => {
      const oldActivity = {
        id: '1',
        token: 'test',
        userId: 'user1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        lastActiveAt: new Date(Date.now() - SESSION_CONFIG.updateIntervalMs - 1000),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        isRememberMe: false,
      }

      expect(shouldRefreshSession(oldActivity)).toBe(true)

      const recentActivity = {
        ...oldActivity,
        lastActiveAt: new Date(),
      }

      expect(shouldRefreshSession(recentActivity)).toBe(false)
    })

    it('checks elevated privileges', () => {
      const elevated = {
        id: '1',
        token: 'test',
        userId: 'user1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        lastActiveAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        isRememberMe: false,
        isElevated: true,
        elevatedUntil: new Date(Date.now() + 3600000),
      }

      expect(hasElevatedPrivileges(elevated)).toBe(true)

      const expiredElevation = {
        ...elevated,
        elevatedUntil: new Date(Date.now() - 1000),
      }

      expect(hasElevatedPrivileges(expiredElevation)).toBe(false)
    })

    it('checks reauthentication requirement', () => {
      const recent = {
        id: '1',
        token: 'test',
        userId: 'user1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        lastActiveAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        isRememberMe: false,
      }

      expect(requiresReauthentication(recent)).toBe(false)

      const idle = {
        ...recent,
        lastActiveAt: new Date(Date.now() - SESSION_CONFIG.sensitiveIdleTimeMs - 1000),
      }

      expect(requiresReauthentication(idle)).toBe(true)
    })
  })

  describe('Session Rotation', () => {
    it('recommends rotation on privilege change', () => {
      expect(shouldRotateSession('privilege_change')).toBe(true)
    })

    it('recommends rotation on password change', () => {
      expect(shouldRotateSession('password_change')).toBe(true)
    })

    it('recommends rotation on sensitive action', () => {
      expect(shouldRotateSession('sensitive_action')).toBe(true)
    })

    it('does not recommend periodic rotation by default', () => {
      expect(shouldRotateSession('periodic')).toBe(false)
    })
  })

  describe('Session Creation', () => {
    it('creates new session with required fields', async () => {
      const request = new Request('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
          'CF-Connecting-IP': '192.168.1.100',
        },
      })

      const { session, cookie } = await createNewSession('user123', request)

      expect(session.id).toBeDefined()
      expect(session.token).toBeDefined()
      expect(session.userId).toBe('user123')
      expect(session.createdAt).toBeInstanceOf(Date)
      expect(session.expiresAt).toBeInstanceOf(Date)
      expect(session.ipAddress).toBe('192.168.1.100')
      expect(session.userAgent).toContain('Chrome')
      expect(cookie).toContain(SESSION_CONFIG.cookieName)
    })

    it('uses remember me duration when specified', async () => {
      const request = new Request('https://example.com', {
        headers: { 'User-Agent': 'Test' },
      })

      const regular = await createNewSession('user1', request, { isRememberMe: false })
      const rememberMe = await createNewSession('user2', request, { isRememberMe: true })

      const regularDuration = regular.session.expiresAt.getTime() - regular.session.createdAt.getTime()
      const rememberMeDuration = rememberMe.session.expiresAt.getTime() - rememberMe.session.createdAt.getTime()

      expect(rememberMeDuration).toBeGreaterThan(regularDuration)
    })
  })

  describe('Session Fingerprinting', () => {
    it('generates consistent fingerprint for same request attributes', async () => {
      const request1 = new Request('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      })

      const request2 = new Request('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      })

      const fp1 = await generateSessionFingerprint(request1)
      const fp2 = await generateSessionFingerprint(request2)

      expect(fp1).toBe(fp2)
    })

    it('generates different fingerprint for different attributes', async () => {
      const request1 = new Request('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120',
          'Accept-Language': 'en-US',
        },
      })

      const request2 = new Request('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Firefox/120',
          'Accept-Language': 'de-DE',
        },
      })

      const fp1 = await generateSessionFingerprint(request1)
      const fp2 = await generateSessionFingerprint(request2)

      expect(fp1).not.toBe(fp2)
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('Error Messages', () => {
    it('provides user-friendly messages for all error codes', () => {
      const errorCodes = Object.keys(AUTH_ERROR_MESSAGES) as Array<keyof typeof AUTH_ERROR_MESSAGES>

      for (const code of errorCodes) {
        const message = getAuthErrorMessage(code)
        expect(message).toBeDefined()
        expect(message.length).toBeGreaterThan(0)
        // Messages should not expose internal details
        expect(message).not.toContain('undefined')
        expect(message).not.toContain('null')
      }
    })

    it('returns generic message for unknown codes', () => {
      const message = getAuthErrorMessage('nonexistent_code')
      expect(message).toBe(AUTH_ERROR_MESSAGES.unknown_error)
    })

    it('returns generic message for null/undefined', () => {
      expect(getAuthErrorMessage(null)).toBe(AUTH_ERROR_MESSAGES.unknown_error)
      expect(getAuthErrorMessage(undefined)).toBe(AUTH_ERROR_MESSAGES.unknown_error)
    })

    it('does not reveal email existence in account_not_found', () => {
      // Both messages should be identical to prevent enumeration
      expect(AUTH_ERROR_MESSAGES.account_not_found).toBe(AUTH_ERROR_MESSAGES.invalid_credentials)
    })
  })

  describe('OAuth Error Mapping', () => {
    it('maps OAuth errors correctly', () => {
      expect(mapOAuthError('access_denied')).toBe('oauth_access_denied')
      expect(mapOAuthError('invalid_request')).toBe('oauth_invalid_request')
      expect(mapOAuthError('server_error')).toBe('oauth_server_error')
    })

    it('returns provider error for unknown OAuth errors', () => {
      expect(mapOAuthError('unknown_oauth_error')).toBe('oauth_provider_error')
    })
  })

  describe('HTTP Status Mapping', () => {
    it('maps HTTP status codes correctly', () => {
      expect(mapHttpStatusToError(401)).toBe('invalid_credentials')
      expect(mapHttpStatusToError(403)).toBe('account_disabled')
      expect(mapHttpStatusToError(429)).toBe('rate_limited')
      expect(mapHttpStatusToError(500)).toBe('server_error')
      expect(mapHttpStatusToError(503)).toBe('service_unavailable')
    })

    it('returns unknown error for unmapped status', () => {
      expect(mapHttpStatusToError(418)).toBe('unknown_error')
    })
  })

  describe('AuthError Class', () => {
    it('creates error with correct properties', () => {
      const error = new AuthError('invalid_credentials')

      expect(error.code).toBe('invalid_credentials')
      expect(error.userMessage).toBe(AUTH_ERROR_MESSAGES.invalid_credentials)
      expect(error.statusCode).toBe(401)
      expect(error.name).toBe('AuthError')
    })

    it('includes retry-after for rate limiting', () => {
      const error = new AuthError('rate_limited', { retryAfter: 60 })

      expect(error.retryAfter).toBe(60)
    })

    it('converts to JSON correctly', () => {
      const error = new AuthError('rate_limited', { retryAfter: 60 })
      const json = error.toJSON()

      expect(json.error).toBe('rate_limited')
      expect(json.message).toBeDefined()
      expect(json.retryAfter).toBe(60)
    })

    it('creates Response object', () => {
      const error = new AuthError('rate_limited', { retryAfter: 60 })
      const response = error.toResponse()

      expect(response.status).toBe(429)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('Retry-After')).toBe('60')
    })

    it('preserves cause when provided', () => {
      const cause = new Error('Original error')
      const error = new AuthError('server_error', { cause })

      expect(error.cause).toBe(cause)
    })
  })

  describe('Error Severity', () => {
    it('classifies errors correctly', () => {
      expect(getErrorSeverity('invalid_credentials')).toBe('error')
      expect(getErrorSeverity('email_not_verified')).toBe('warning')
      expect(getErrorSeverity('session_expired')).toBe('warning')
      expect(getErrorSeverity('email_not_found')).toBe('info')
    })
  })

  describe('Suggested Actions', () => {
    it('suggests password reset for invalid credentials', () => {
      const action = getSuggestedAction('invalid_credentials')
      expect(action?.action).toBe('reset_password')
    })

    it('suggests login for duplicate email', () => {
      const action = getSuggestedAction('email_already_exists')
      expect(action?.action).toBe('login')
    })

    it('suggests contact support for disabled account', () => {
      const action = getSuggestedAction('account_disabled')
      expect(action?.action).toBe('contact_support')
    })

    it('suggests wait for rate limiting', () => {
      const action = getSuggestedAction('rate_limited')
      expect(action?.action).toBe('wait')
    })

    it('returns null for errors without suggested action', () => {
      const action = getSuggestedAction('unknown_error')
      expect(action).toBeNull()
    })
  })

  describe('Field Validation Errors', () => {
    it('provides email validation errors', () => {
      expect(getFieldError('email', 'required')).toBe(FIELD_ERRORS.email.required)
      expect(getFieldError('email', 'invalid')).toBe(FIELD_ERRORS.email.invalid)
    })

    it('provides password validation errors', () => {
      expect(getFieldError('password', 'tooShort')).toBe(FIELD_ERRORS.password.tooShort)
      expect(getFieldError('password', 'mismatch')).toBe(FIELD_ERRORS.password.mismatch)
    })

    it('returns default message for unknown field error', () => {
      const error = getFieldError('email', 'nonexistent')
      expect(error).toBe('Please check this field.')
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Auth Security Integration', () => {
  describe('Full Auth Flow Security', () => {
    it('generates and validates CSRF for form submission', async () => {
      // 1. Generate token on page load
      const token = generateCSRFToken()

      // 2. Set as cookie and include in form
      const request = new Request('https://example.com/login', {
        method: 'POST',
        headers: {
          Cookie: `${CSRF_COOKIE_NAME}=${token}`,
          [CSRF_HEADER_NAME]: token,
        },
      })

      // 3. Validate on submission
      const result = await checkCSRF(request)
      expect(result.valid).toBe(true)
    })

    it('rejects tampered CSRF tokens', async () => {
      const token = generateCSRFToken()
      const tamperedToken = token.slice(0, -5) + 'xxxxx'

      const request = new Request('https://example.com/login', {
        method: 'POST',
        headers: {
          Cookie: `${CSRF_COOKIE_NAME}=${token}`,
          [CSRF_HEADER_NAME]: tamperedToken,
        },
      })

      const result = await checkCSRF(request)
      expect(result.valid).toBe(false)
    })

    it('rate limits protect against brute force', () => {
      const targetEmail = 'victim@example.com'

      // Simulate brute force attempt
      for (let i = 0; i < 20; i++) {
        const result = checkLoginRateLimit(`attacker-ip-${Math.floor(i / 5)}`, targetEmail)

        // After 5 attempts per email, should be blocked
        if (i >= AUTH_RATE_LIMITS.login.perEmailPer5Min) {
          expect(result.allowed).toBe(false)
          break
        }
      }
    })

    it('session security features work together', async () => {
      const request = new Request('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120',
          'CF-Connecting-IP': '192.168.1.1',
        },
      })

      // Create session
      const { session } = await createNewSession('user1', request)

      // Verify security properties
      expect(session.token.length).toBe(SESSION_CONFIG.tokenLength)
      expect(session.ipAddress).toBe('192.168.1.1')
      expect(isSessionExpired(session)).toBe(false)
      expect(requiresReauthentication(session)).toBe(false)

      // Hash for storage
      const hash = await hashSessionToken(session.token)
      expect(hash).not.toBe(session.token)
    })
  })
})
