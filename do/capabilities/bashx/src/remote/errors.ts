/**
 * Git Remote Error Types
 *
 * Specific error classes for Git HTTP operations with:
 * - Semantic error types for programmatic handling
 * - Helpful messages with fix suggestions
 * - Rate limit and retry information
 */

// =============================================================================
// Rate Limit Types
// =============================================================================

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: Date
  provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown'
}

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for Git HTTP operations
 */
export class GitRemoteError extends Error {
  readonly code: string
  readonly status?: number
  readonly hint?: string
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      code: string
      status?: number
      hint?: string
      retryable?: boolean
      cause?: Error
    }
  ) {
    super(message, { cause: options.cause })
    this.name = 'GitRemoteError'
    this.code = options.code
    this.status = options.status
    this.hint = options.hint
    this.retryable = options.retryable ?? false
  }
}

// =============================================================================
// Network Errors
// =============================================================================

/**
 * Network-level connection errors (ECONNRESET, ETIMEDOUT, DNS failures)
 */
export class NetworkError extends GitRemoteError {
  readonly originalCode?: string

  constructor(
    message: string,
    options: {
      originalCode?: string
      cause?: Error
    } = {}
  ) {
    super(message, {
      code: 'NETWORK_ERROR',
      retryable: true,
      hint: 'Check your network connection and try again',
      cause: options.cause,
    })
    this.name = 'NetworkError'
    this.originalCode = options.originalCode
  }

  /**
   * Create from a native fetch/network error
   */
  static fromError(error: Error): NetworkError {
    const code = (error as Error & { code?: string }).code
    let message = error.message

    if (code === 'ECONNRESET') {
      message = 'Connection was reset by the server'
    } else if (code === 'ETIMEDOUT') {
      message = 'Connection timed out'
    } else if (code === 'ECONNREFUSED') {
      message = 'Connection refused by the server'
    } else if (code === 'ENOTFOUND') {
      message = 'Could not resolve hostname'
    } else if (code === 'ENETUNREACH') {
      message = 'Network is unreachable'
    }

    return new NetworkError(message, { originalCode: code, cause: error })
  }

  /**
   * Check if an error is a retryable network error
   */
  static isRetryable(error: unknown): boolean {
    if (error instanceof NetworkError) {
      return true
    }

    const errorWithCode = error as { code?: string }
    const code = errorWithCode?.code
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENETUNREACH',
      'EPIPE',
      'EAI_AGAIN',
    ]

    return code !== undefined && retryableCodes.includes(code)
  }
}

// =============================================================================
// Authentication Errors
// =============================================================================

/**
 * Authentication failures (401, 403 without rate limiting)
 */
export class AuthenticationError extends GitRemoteError {
  readonly scheme?: string
  readonly realm?: string
  readonly tokenExpired: boolean

  constructor(
    message: string,
    options: {
      status: 401 | 403
      scheme?: string
      realm?: string
      tokenExpired?: boolean
      hint?: string
    }
  ) {
    const hint = options.hint || AuthenticationError.getDefaultHint(options.realm)
    super(message, {
      code: 'AUTHENTICATION_ERROR',
      status: options.status,
      retryable: false,
      hint,
    })
    this.name = 'AuthenticationError'
    this.scheme = options.scheme
    this.realm = options.realm
    this.tokenExpired = options.tokenExpired ?? false
  }

  private static getDefaultHint(realm?: string): string {
    if (realm?.toLowerCase().includes('github')) {
      return 'Set GITHUB_TOKEN or GH_TOKEN environment variable, or use --auth flag'
    }
    if (realm?.toLowerCase().includes('gitlab')) {
      return 'Set GITLAB_TOKEN environment variable, or use --auth flag'
    }
    if (realm?.toLowerCase().includes('bitbucket')) {
      return 'Set BITBUCKET_TOKEN environment variable, or use --auth flag'
    }
    return 'Provide authentication credentials'
  }
}

// =============================================================================
// Rate Limit Errors
// =============================================================================

/**
 * Rate limit exceeded errors with wait time information
 */
export class RateLimitError extends GitRemoteError {
  readonly rateLimit: RateLimitInfo

  constructor(
    message: string,
    options: {
      rateLimit: RateLimitInfo
    }
  ) {
    const waitTime = RateLimitError.formatWaitTime(options.rateLimit.resetAt)
    super(message, {
      code: 'RATE_LIMIT_ERROR',
      status: 403,
      retryable: true, // Retryable after waiting
      hint: `Rate limit will reset in ${waitTime}. Consider using a token for higher limits.`,
    })
    this.name = 'RateLimitError'
    this.rateLimit = options.rateLimit
  }

  /**
   * Get the number of milliseconds until the rate limit resets
   */
  getWaitMs(): number {
    return Math.max(0, this.rateLimit.resetAt.getTime() - Date.now())
  }

  /**
   * Wait until the rate limit resets
   */
  async waitForReset(): Promise<void> {
    const waitMs = this.getWaitMs()
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs + 1000)) // Add 1s buffer
    }
  }

  private static formatWaitTime(resetAt: Date): string {
    const ms = resetAt.getTime() - Date.now()
    if (ms <= 0) return 'now'

    const seconds = Math.ceil(ms / 1000)
    if (seconds < 60) return `${seconds} seconds`

    const minutes = Math.ceil(seconds / 60)
    if (minutes < 60) return `${minutes} minutes`

    const hours = Math.ceil(minutes / 60)
    return `${hours} hours`
  }
}

// =============================================================================
// Repository Errors
// =============================================================================

/**
 * Repository not found (404) errors
 */
export class RepositoryNotFoundError extends GitRemoteError {
  readonly url: string

  constructor(url: string) {
    super(`Repository not found: ${url}`, {
      code: 'REPOSITORY_NOT_FOUND',
      status: 404,
      retryable: false,
      hint: 'Check the repository URL is correct and you have access',
    })
    this.name = 'RepositoryNotFoundError'
    this.url = url
  }
}

// =============================================================================
// Push Errors
// =============================================================================

/**
 * Reasons why a push might be rejected
 */
export type PushRejectedReason =
  | 'non-fast-forward'
  | 'protected-branch'
  | 'pre-receive-hook'
  | 'push-blocked'
  | 'permission-denied'
  | 'unknown'

/**
 * Push operation rejected by the server
 */
export class PushRejectedError extends GitRemoteError {
  readonly ref: string
  readonly reason: PushRejectedReason
  readonly serverMessage?: string

  constructor(
    ref: string,
    options: {
      reason: PushRejectedReason
      serverMessage?: string
    }
  ) {
    const message = PushRejectedError.formatMessage(ref, options.reason, options.serverMessage)
    const hint = PushRejectedError.getHint(options.reason)

    super(message, {
      code: 'PUSH_REJECTED',
      retryable: false,
      hint,
    })
    this.name = 'PushRejectedError'
    this.ref = ref
    this.reason = options.reason
    this.serverMessage = options.serverMessage
  }

  private static formatMessage(ref: string, reason: PushRejectedReason, serverMessage?: string): string {
    switch (reason) {
      case 'non-fast-forward':
        return `Push rejected: ${ref} - would result in non-fast-forward update`
      case 'protected-branch':
        return `Push rejected: ${ref} - branch is protected`
      case 'pre-receive-hook':
        return `Push rejected: ${ref} - pre-receive hook declined`
      case 'push-blocked':
        return `Push rejected: ${ref} - push is blocked`
      case 'permission-denied':
        return `Push rejected: ${ref} - permission denied`
      default:
        return serverMessage
          ? `Push rejected: ${ref} - ${serverMessage}`
          : `Push rejected: ${ref}`
    }
  }

  private static getHint(reason: PushRejectedReason): string {
    switch (reason) {
      case 'non-fast-forward':
        return 'Pull and merge remote changes first, or use --force (with caution)'
      case 'protected-branch':
        return 'Create a pull request instead, or adjust branch protection rules'
      case 'pre-receive-hook':
        return 'Check the server-side hook requirements (commit signing, format, etc.)'
      case 'push-blocked':
        return 'Check repository settings for push restrictions'
      case 'permission-denied':
        return 'Verify you have write access to the repository'
      default:
        return 'Check the server error message for details'
    }
  }

  /**
   * Parse push rejection reason from server error message
   */
  static parseReason(serverMessage: string): PushRejectedReason {
    const lower = serverMessage.toLowerCase()

    if (lower.includes('non-fast-forward')) {
      return 'non-fast-forward'
    }
    if (lower.includes('protected') || lower.includes('protected branch')) {
      return 'protected-branch'
    }
    if (lower.includes('pre-receive') || lower.includes('hook')) {
      return 'pre-receive-hook'
    }
    if (lower.includes('blocked') || lower.includes('denied by')) {
      return 'push-blocked'
    }
    if (lower.includes('permission') || lower.includes('access denied')) {
      return 'permission-denied'
    }

    return 'unknown'
  }
}

// =============================================================================
// Timeout Errors
// =============================================================================

/**
 * Operation timeout errors
 */
export class TimeoutError extends GitRemoteError {
  readonly timeoutMs: number
  readonly operation: string

  constructor(
    operation: string,
    timeoutMs: number
  ) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`, {
      code: 'TIMEOUT_ERROR',
      status: 408,
      retryable: true,
      hint: 'Try again with a longer timeout, or check your network connection',
    })
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
    this.operation = operation
  }
}

// =============================================================================
// Server Errors
// =============================================================================

/**
 * Server-side errors (5xx)
 */
export class ServerError extends GitRemoteError {
  constructor(
    message: string,
    status: number
  ) {
    super(message, {
      code: 'SERVER_ERROR',
      status,
      retryable: status >= 500 && status < 600,
      hint: 'The server encountered an error. Try again later.',
    })
    this.name = 'ServerError'
  }

  /**
   * Check if a status code indicates a retryable server error
   */
  static isRetryableStatus(status: number): boolean {
    // Retry on 5xx server errors, except 501 (Not Implemented)
    return status >= 500 && status < 600 && status !== 501
  }
}

// =============================================================================
// Rate Limit Header Parsing
// =============================================================================

/**
 * Parse rate limit information from response headers
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
  // GitHub format
  const ghLimit = headers.get('X-RateLimit-Limit')
  const ghRemaining = headers.get('X-RateLimit-Remaining')
  const ghReset = headers.get('X-RateLimit-Reset')

  if (ghLimit && ghRemaining && ghReset) {
    return {
      limit: parseInt(ghLimit, 10),
      remaining: parseInt(ghRemaining, 10),
      resetAt: new Date(parseInt(ghReset, 10) * 1000),
      provider: 'github',
    }
  }

  // GitLab format (similar but uses RateLimit- prefix)
  const glLimit = headers.get('RateLimit-Limit')
  const glRemaining = headers.get('RateLimit-Remaining')
  const glReset = headers.get('RateLimit-Reset')

  if (glLimit && glRemaining && glReset) {
    return {
      limit: parseInt(glLimit, 10),
      remaining: parseInt(glRemaining, 10),
      resetAt: new Date(parseInt(glReset, 10) * 1000),
      provider: 'gitlab',
    }
  }

  // GitLab alternative format
  const glRetryAfter = headers.get('Retry-After')
  if (glRetryAfter) {
    const seconds = parseInt(glRetryAfter, 10)
    return {
      limit: 0,
      remaining: 0,
      resetAt: new Date(Date.now() + seconds * 1000),
      provider: 'gitlab',
    }
  }

  return undefined
}

/**
 * Check if a response indicates rate limiting (even on 200 responses)
 */
export function isRateLimited(headers: Headers): boolean {
  const rateLimit = parseRateLimitHeaders(headers)
  return rateLimit !== undefined && rateLimit.remaining === 0
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetry(error: unknown, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) {
    return false
  }

  // Network errors are always retryable
  if (NetworkError.isRetryable(error)) {
    return true
  }

  // Rate limit errors can be retried after waiting
  if (error instanceof RateLimitError) {
    return true
  }

  // Server errors (5xx) are retryable
  if (error instanceof ServerError && error.retryable) {
    return true
  }

  // Timeout errors are retryable
  if (error instanceof TimeoutError) {
    return true
  }

  // Check generic Error status property
  const errorWithStatus = error as { status?: number }
  if (typeof errorWithStatus?.status === 'number') {
    return ServerError.isRetryableStatus(errorWithStatus.status)
  }

  return false
}

/**
 * Calculate delay for exponential backoff
 */
export function calculateBackoff(
  attempt: number,
  options: {
    baseDelayMs?: number
    maxDelayMs?: number
    jitter?: boolean
  } = {}
): number {
  const { baseDelayMs = 1000, maxDelayMs = 30000, jitter = true } = options

  // Exponential backoff: 1s, 2s, 4s, 8s...
  let delay = baseDelayMs * Math.pow(2, attempt)

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs)

  // Add jitter (random +-25%)
  if (jitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5
    delay = Math.floor(delay * jitterFactor)
  }

  return delay
}
