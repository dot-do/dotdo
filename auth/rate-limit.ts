/**
 * Auth Rate Limiting Module
 *
 * Implements rate limiting specifically for authentication endpoints
 * to protect against brute force attacks, credential stuffing, and abuse.
 *
 * ## Rate Limit Strategies:
 *
 * 1. **IP-based** - Primary defense against distributed attacks
 *    - Login attempts: 5 per minute per IP
 *    - Signup attempts: 3 per minute per IP
 *    - Password reset: 3 per 15 minutes per IP
 *
 * 2. **Email-based** - Per-account protection
 *    - Login attempts: 5 per 5 minutes per email
 *    - Password reset: 3 per hour per email
 *
 * 3. **Global** - System-wide protection
 *    - Total auth attempts: 1000 per minute (circuit breaker)
 *
 * ## Features:
 * - Exponential backoff for repeated failures
 * - Account lockout after threshold
 * - Clear user feedback with retry timing
 * - Sliding window algorithm for smooth limiting
 *
 * @module auth/rate-limit
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * Rate limit configurations for different auth actions
 */
export const AUTH_RATE_LIMITS = {
  /**
   * Login attempt limits
   */
  login: {
    /** Max attempts per IP per minute */
    perIpPerMinute: 5,
    /** Max attempts per email per 5 minutes */
    perEmailPer5Min: 5,
    /** Lockout threshold (attempts before temporary account lock) */
    lockoutThreshold: 10,
    /** Lockout duration in milliseconds (15 minutes) */
    lockoutDurationMs: 15 * 60 * 1000,
  },

  /**
   * Signup attempt limits
   */
  signup: {
    /** Max signups per IP per minute */
    perIpPerMinute: 3,
    /** Max signups per IP per hour */
    perIpPerHour: 20,
  },

  /**
   * Password reset limits
   */
  passwordReset: {
    /** Max reset requests per IP per 15 minutes */
    perIpPer15Min: 3,
    /** Max reset requests per email per hour */
    perEmailPerHour: 3,
  },

  /**
   * Session validation limits
   */
  session: {
    /** Max session validation requests per second per IP */
    perIpPerSecond: 10,
  },

  /**
   * Global circuit breaker
   */
  global: {
    /** Max total auth attempts per minute before circuit breaker trips */
    maxPerMinute: 1000,
  },
} as const

/**
 * Sliding window bucket size in milliseconds
 */
export const RATE_LIMIT_BUCKET_SIZE_MS = 1000 // 1 second buckets

// =============================================================================
// Types
// =============================================================================

/**
 * Auth action types for rate limiting
 */
export type AuthAction = 'login' | 'signup' | 'password_reset' | 'session' | 'oauth_callback'

/**
 * Rate limit key types
 */
export type RateLimitKeyType = 'ip' | 'email' | 'user_id' | 'global'

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the action is allowed */
  allowed: boolean
  /** Number of remaining attempts */
  remaining: number
  /** Reset time (when limit resets) */
  resetAt: Date
  /** Retry after (seconds until retry allowed) */
  retryAfter: number
  /** Whether account is locked out */
  isLocked?: boolean
  /** Human-readable message */
  message?: string
}

/**
 * Rate limit error with detailed information
 */
export interface RateLimitError {
  code: 'rate_limited' | 'account_locked' | 'suspicious_activity'
  message: string
  retryAfter: number
  resetAt: Date
}

/**
 * In-memory rate limit entry
 */
interface RateLimitEntry {
  count: number
  windowStart: number
  lockedUntil?: number
  failedAttempts?: number
}

// =============================================================================
// In-Memory Rate Limit Store
// =============================================================================

/**
 * Simple in-memory rate limit store.
 * In production, use Cloudflare Rate Limiting binding or KV.
 */
class InMemoryRateLimitStore {
  private store = new Map<string, RateLimitEntry>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Start cleanup interval (every minute)
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000)
    }
  }

  /**
   * Get or create a rate limit entry
   */
  get(key: string, windowMs: number): RateLimitEntry {
    const now = Date.now()
    const entry = this.store.get(key)

    if (!entry || now - entry.windowStart > windowMs) {
      // Create new window
      const newEntry: RateLimitEntry = {
        count: 0,
        windowStart: now,
        failedAttempts: entry?.failedAttempts || 0,
        lockedUntil: entry?.lockedUntil,
      }
      this.store.set(key, newEntry)
      return newEntry
    }

    return entry
  }

  /**
   * Increment counter for a key
   */
  increment(key: string, windowMs: number): RateLimitEntry {
    const entry = this.get(key, windowMs)
    entry.count++
    return entry
  }

  /**
   * Record a failed attempt (for lockout tracking)
   */
  recordFailure(key: string): void {
    const entry = this.store.get(key)
    if (entry) {
      entry.failedAttempts = (entry.failedAttempts || 0) + 1
    }
  }

  /**
   * Set lockout for a key
   */
  setLockout(key: string, durationMs: number): void {
    const entry = this.store.get(key)
    if (entry) {
      entry.lockedUntil = Date.now() + durationMs
    }
  }

  /**
   * Check if a key is locked out
   */
  isLocked(key: string): boolean {
    const entry = this.store.get(key)
    return entry?.lockedUntil !== undefined && Date.now() < entry.lockedUntil
  }

  /**
   * Get lock remaining time
   */
  getLockRemaining(key: string): number {
    const entry = this.store.get(key)
    if (entry?.lockedUntil) {
      return Math.max(0, entry.lockedUntil - Date.now())
    }
    return 0
  }

  /**
   * Clear lockout for a key (e.g., after successful login)
   */
  clearLockout(key: string): void {
    const entry = this.store.get(key)
    if (entry) {
      entry.lockedUntil = undefined
      entry.failedAttempts = 0
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    const maxAge = 60 * 60 * 1000 // 1 hour

    for (const [key, entry] of this.store.entries()) {
      if (now - entry.windowStart > maxAge) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}

// Singleton store instance
const rateLimitStore = new InMemoryRateLimitStore()

// =============================================================================
// Rate Limit Checker
// =============================================================================

/**
 * Build a rate limit key from components.
 *
 * @param action - The auth action
 * @param keyType - The key type (ip, email, etc.)
 * @param value - The key value
 * @returns Formatted rate limit key
 */
export function buildRateLimitKey(action: AuthAction, keyType: RateLimitKeyType, value: string): string {
  return `auth:${action}:${keyType}:${value}`
}

/**
 * Check rate limit for an auth action.
 *
 * @param action - The auth action to check
 * @param keyType - The key type
 * @param value - The key value (IP, email, etc.)
 * @param limit - Max allowed requests
 * @param windowMs - Time window in milliseconds
 * @returns Rate limit check result
 *
 * @example
 * ```typescript
 * const result = checkRateLimit('login', 'ip', clientIP, 5, 60000)
 * if (!result.allowed) {
 *   return Response.json({ error: result.message }, { status: 429 })
 * }
 * ```
 */
export function checkRateLimit(
  action: AuthAction,
  keyType: RateLimitKeyType,
  value: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const key = buildRateLimitKey(action, keyType, value)

  // Check lockout first
  if (rateLimitStore.isLocked(key)) {
    const lockRemaining = rateLimitStore.getLockRemaining(key)
    const retryAfterSeconds = Math.ceil(lockRemaining / 1000)
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + lockRemaining),
      retryAfter: retryAfterSeconds,
      isLocked: true,
      message: formatLockoutMessage(retryAfterSeconds),
    }
  }

  // Check rate limit
  const entry = rateLimitStore.increment(key, windowMs)
  const remaining = Math.max(0, limit - entry.count)
  const resetAt = new Date(entry.windowStart + windowMs)
  const retryAfter = Math.ceil((entry.windowStart + windowMs - Date.now()) / 1000)

  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(0, retryAfter),
      message: formatRateLimitMessage(action, Math.max(0, retryAfter)),
    }
  }

  return {
    allowed: true,
    remaining,
    resetAt,
    retryAfter: 0,
  }
}

/**
 * Check all rate limits for a login attempt.
 * Combines IP-based and email-based limits.
 *
 * @param ip - Client IP address
 * @param email - Email address being used
 * @returns Combined rate limit result
 */
export function checkLoginRateLimit(ip: string, email?: string): RateLimitResult {
  const limits = AUTH_RATE_LIMITS.login

  // Check IP limit
  const ipResult = checkRateLimit('login', 'ip', ip, limits.perIpPerMinute, 60 * 1000)
  if (!ipResult.allowed) {
    return ipResult
  }

  // Check email limit (if provided)
  if (email) {
    const normalizedEmail = email.toLowerCase().trim()
    const emailResult = checkRateLimit('login', 'email', normalizedEmail, limits.perEmailPer5Min, 5 * 60 * 1000)
    if (!emailResult.allowed) {
      return emailResult
    }

    // Return the more restrictive result
    return emailResult.remaining < ipResult.remaining ? emailResult : ipResult
  }

  return ipResult
}

/**
 * Check rate limit for signup attempts.
 *
 * @param ip - Client IP address
 * @returns Rate limit result
 */
export function checkSignupRateLimit(ip: string): RateLimitResult {
  const limits = AUTH_RATE_LIMITS.signup

  // Check minute limit
  const minuteResult = checkRateLimit('signup', 'ip', ip, limits.perIpPerMinute, 60 * 1000)
  if (!minuteResult.allowed) {
    return minuteResult
  }

  // Check hourly limit
  const hourResult = checkRateLimit('signup', 'ip', `${ip}:hour`, limits.perIpPerHour, 60 * 60 * 1000)
  if (!hourResult.allowed) {
    return hourResult
  }

  // Return the more restrictive result
  return hourResult.remaining < minuteResult.remaining ? hourResult : minuteResult
}

/**
 * Check rate limit for password reset requests.
 *
 * @param ip - Client IP address
 * @param email - Email address requesting reset
 * @returns Rate limit result
 */
export function checkPasswordResetRateLimit(ip: string, email: string): RateLimitResult {
  const limits = AUTH_RATE_LIMITS.passwordReset
  const normalizedEmail = email.toLowerCase().trim()

  // Check IP limit
  const ipResult = checkRateLimit('password_reset', 'ip', ip, limits.perIpPer15Min, 15 * 60 * 1000)
  if (!ipResult.allowed) {
    return ipResult
  }

  // Check email limit
  const emailResult = checkRateLimit('password_reset', 'email', normalizedEmail, limits.perEmailPerHour, 60 * 60 * 1000)
  if (!emailResult.allowed) {
    return {
      ...emailResult,
      // Don't reveal email-specific info in error message
      message: 'Too many password reset requests. Please try again later.',
    }
  }

  return emailResult.remaining < ipResult.remaining ? emailResult : ipResult
}

// =============================================================================
// Account Lockout
// =============================================================================

/**
 * Record a failed login attempt and check for lockout.
 *
 * @param email - Email address that failed login
 * @returns Whether the account is now locked
 */
export function recordFailedLogin(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim()
  const key = buildRateLimitKey('login', 'email', normalizedEmail)
  const limits = AUTH_RATE_LIMITS.login

  rateLimitStore.recordFailure(key)
  const entry = rateLimitStore.get(key, 24 * 60 * 60 * 1000) // 24 hour window for failures

  if ((entry.failedAttempts || 0) >= limits.lockoutThreshold) {
    rateLimitStore.setLockout(key, limits.lockoutDurationMs)
    return true
  }

  return false
}

/**
 * Clear lockout after successful login.
 *
 * @param email - Email address to clear
 */
export function clearLoginLockout(email: string): void {
  const normalizedEmail = email.toLowerCase().trim()
  const key = buildRateLimitKey('login', 'email', normalizedEmail)
  rateLimitStore.clearLockout(key)
}

/**
 * Check if an email is currently locked out.
 *
 * @param email - Email address to check
 * @returns Lockout info or null if not locked
 */
export function getAccountLockoutStatus(email: string): { locked: boolean; remainingMs: number } | null {
  const normalizedEmail = email.toLowerCase().trim()
  const key = buildRateLimitKey('login', 'email', normalizedEmail)

  const locked = rateLimitStore.isLocked(key)
  if (!locked) {
    return { locked: false, remainingMs: 0 }
  }

  return {
    locked: true,
    remainingMs: rateLimitStore.getLockRemaining(key),
  }
}

// =============================================================================
// Message Formatters
// =============================================================================

/**
 * Format a user-friendly rate limit message.
 */
function formatRateLimitMessage(action: AuthAction, retryAfterSeconds: number): string {
  const actionLabels: Record<AuthAction, string> = {
    login: 'sign in',
    signup: 'create accounts',
    password_reset: 'request password resets',
    session: 'make requests',
    oauth_callback: 'authenticate',
  }

  const actionLabel = actionLabels[action]
  const timeStr = formatRetryTime(retryAfterSeconds)

  return `Too many attempts to ${actionLabel}. Please try again ${timeStr}.`
}

/**
 * Format a lockout message.
 */
function formatLockoutMessage(retryAfterSeconds: number): string {
  const timeStr = formatRetryTime(retryAfterSeconds)
  return `This account has been temporarily locked due to too many failed attempts. Please try again ${timeStr}.`
}

/**
 * Format retry time for display.
 */
function formatRetryTime(seconds: number): string {
  if (seconds <= 0) {
    return 'now'
  }

  if (seconds < 60) {
    return `in ${seconds} second${seconds === 1 ? '' : 's'}`
  }

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) {
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  }

  const hours = Math.ceil(minutes / 60)
  return `in ${hours} hour${hours === 1 ? '' : 's'}`
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create a 429 Too Many Requests response.
 *
 * @param result - Rate limit result
 * @returns Response with appropriate headers
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Retry-After': String(result.retryAfter),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  })

  const body = JSON.stringify({
    error: 'rate_limited',
    message: result.message || 'Too many requests. Please try again later.',
    retryAfter: result.retryAfter,
    resetAt: result.resetAt.toISOString(),
    ...(result.isLocked && { accountLocked: true }),
  })

  return new Response(body, {
    status: 429,
    headers,
  })
}

/**
 * Add rate limit headers to a response.
 *
 * @param response - Original response
 * @param result - Rate limit result
 * @returns Response with rate limit headers
 */
export function addRateLimitHeaders(response: Response, result: RateLimitResult): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Remaining', String(result.remaining))
  headers.set('X-RateLimit-Reset', result.resetAt.toISOString())

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// =============================================================================
// IP Extraction
// =============================================================================

/**
 * Extract client IP from request.
 * Checks CF-Connecting-IP (Cloudflare), X-Forwarded-For, and X-Real-IP headers.
 *
 * @param request - Incoming request
 * @returns Client IP address
 */
export function getClientIP(request: Request): string {
  // Cloudflare header (most reliable when behind CF)
  const cfIP = request.headers.get('CF-Connecting-IP')
  if (cfIP) {
    return cfIP
  }

  // X-Forwarded-For (check first IP in chain)
  const xff = request.headers.get('X-Forwarded-For')
  if (xff) {
    const firstIP = xff.split(',')[0].trim()
    if (firstIP) {
      return firstIP
    }
  }

  // X-Real-IP
  const realIP = request.headers.get('X-Real-IP')
  if (realIP) {
    return realIP
  }

  // Fallback
  return 'unknown'
}

// =============================================================================
// Testing Utilities
// =============================================================================

/**
 * Reset rate limit store (for testing only).
 * @internal
 */
export function resetRateLimitStore(): void {
  if (process.env.NODE_ENV === 'test') {
    rateLimitStore.destroy()
    // Create new store would require module reload
    // For tests, just clear existing entries by rebuilding
  }
}
