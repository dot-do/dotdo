/**
 * @dotdo/auth - Auth Error
 *
 * Custom error class for authentication errors.
 *
 * @module
 */

/**
 * Authentication error with code and optional status
 */
export class AuthError extends Error {
  code: string
  status?: number
  details?: Record<string, unknown>

  constructor(code: string, message: string, status?: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    this.details = details

    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthError)
    }
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      error: this.code,
      error_description: this.message,
      status: this.status,
      details: this.details,
    }
  }
}

// ============================================================================
// COMMON ERROR FACTORIES
// ============================================================================

export const AuthErrors = {
  invalidCredentials: () => new AuthError('invalid_credentials', 'Invalid email or password', 401),

  userExists: (field: string = 'email') =>
    new AuthError('user_exists', `A user with this ${field} already exists`, 409),

  userNotFound: () => new AuthError('user_not_found', 'User not found', 404),

  weakPassword: (minLength: number) =>
    new AuthError('weak_password', `Password must be at least ${minLength} characters`, 400),

  invalidToken: () => new AuthError('invalid_token', 'Invalid or expired token', 401),

  tokenExpired: () => new AuthError('token_expired', 'Token has expired', 401),

  sessionNotFound: () => new AuthError('session_not_found', 'Session not found', 404),

  sessionRevoked: () => new AuthError('session_revoked', 'Session has been revoked', 401),

  sessionExpired: () => new AuthError('session_expired', 'Session has expired', 401),

  accountLocked: (until?: Date) =>
    new AuthError('account_locked', 'Account is temporarily locked', 403, {
      locked_until: until?.toISOString(),
    }),

  mfaRequired: () => new AuthError('mfa_required', 'Multi-factor authentication required', 403),

  mfaInvalidCode: () => new AuthError('mfa_invalid_code', 'Invalid verification code', 400),

  mfaFactorNotFound: () => new AuthError('mfa_factor_not_found', 'MFA factor not found', 404),

  mfaAlreadyVerified: () => new AuthError('mfa_already_verified', 'Factor is already verified', 400),

  oauthInvalidClient: () => new AuthError('invalid_client', 'Client authentication failed', 401),

  oauthInvalidGrant: (reason: string) => new AuthError('invalid_grant', reason, 400),

  oauthInvalidScope: () => new AuthError('invalid_scope', 'Invalid scope requested', 400),

  oauthUnsupportedGrantType: (type: string) =>
    new AuthError('unsupported_grant_type', `Grant type ${type} not supported`, 400),

  passwordResetRequired: () =>
    new AuthError('password_reset_required', 'Password reset is required', 403),

  emailNotVerified: () =>
    new AuthError('email_not_verified', 'Email address has not been verified', 403),

  rateLimited: (retryAfter?: number) =>
    new AuthError('rate_limited', 'Too many requests', 429, {
      retry_after: retryAfter,
    }),
}
