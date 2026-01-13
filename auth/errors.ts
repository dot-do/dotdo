/**
 * Auth Error Messages and Handling
 *
 * Provides consistent, user-friendly error messages for all auth scenarios.
 * Messages are designed to be:
 * - Clear and actionable
 * - Security-conscious (don't leak sensitive info)
 * - Accessible (screen-reader friendly)
 *
 * @module auth/errors
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * All possible auth error codes
 */
export type AuthErrorCode =
  // Login errors
  | 'invalid_credentials'
  | 'account_not_found'
  | 'account_disabled'
  | 'account_locked'
  | 'email_not_verified'
  | 'mfa_required'
  | 'mfa_invalid'
  // Signup errors
  | 'email_already_exists'
  | 'weak_password'
  | 'invalid_email'
  | 'terms_not_accepted'
  // Password reset errors
  | 'reset_token_invalid'
  | 'reset_token_expired'
  | 'reset_link_used'
  | 'email_not_found'
  // Session errors
  | 'session_expired'
  | 'session_invalid'
  | 'session_revoked'
  // OAuth errors
  | 'oauth_access_denied'
  | 'oauth_invalid_request'
  | 'oauth_unauthorized_client'
  | 'oauth_unsupported_response_type'
  | 'oauth_invalid_scope'
  | 'oauth_server_error'
  | 'oauth_temporarily_unavailable'
  | 'oauth_invalid_state'
  | 'oauth_callback_failed'
  | 'oauth_email_taken'
  | 'oauth_provider_error'
  // Security errors
  | 'csrf_invalid'
  | 'csrf_expired'
  | 'rate_limited'
  | 'suspicious_activity'
  // Network/system errors
  | 'network_error'
  | 'server_error'
  | 'service_unavailable'
  // Generic
  | 'unknown_error'

// =============================================================================
// Error Messages
// =============================================================================

/**
 * User-friendly error messages for all auth error codes.
 *
 * Guidelines followed:
 * - Don't reveal whether email exists (for login failures)
 * - Provide actionable next steps
 * - Keep messages concise but helpful
 * - Use positive language where possible
 */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  // Login errors
  invalid_credentials: 'The email or password you entered is incorrect. Please check your credentials and try again.',
  account_not_found: 'The email or password you entered is incorrect. Please check your credentials and try again.',
  account_disabled: 'This account has been disabled. Please contact support for assistance.',
  account_locked:
    'This account has been temporarily locked due to too many failed login attempts. Please try again in 15 minutes or reset your password.',
  email_not_verified: 'Please verify your email address before signing in. Check your inbox for the verification link.',
  mfa_required: 'Please enter your two-factor authentication code to continue.',
  mfa_invalid: 'The authentication code you entered is incorrect. Please try again.',

  // Signup errors
  email_already_exists: 'An account with this email address already exists. Please sign in or reset your password.',
  weak_password: 'Please choose a stronger password. Use at least 8 characters with a mix of letters, numbers, and symbols.',
  invalid_email: 'Please enter a valid email address.',
  terms_not_accepted: 'Please accept the Terms of Service and Privacy Policy to create an account.',

  // Password reset errors
  reset_token_invalid: 'This password reset link is invalid. Please request a new one.',
  reset_token_expired: 'This password reset link has expired. Please request a new one.',
  reset_link_used: 'This password reset link has already been used. Please request a new one if needed.',
  email_not_found: 'If an account exists with this email, you will receive a password reset link shortly.',

  // Session errors
  session_expired: 'Your session has expired. Please sign in again.',
  session_invalid: 'Your session is no longer valid. Please sign in again.',
  session_revoked: 'Your session was ended. Please sign in again.',

  // OAuth errors
  oauth_access_denied: 'Sign in was cancelled. Please try again when you are ready.',
  oauth_invalid_request: 'There was a problem with the sign in request. Please try again.',
  oauth_unauthorized_client: 'This application is not authorized. Please contact support.',
  oauth_unsupported_response_type: 'A configuration error occurred. Please try again or contact support.',
  oauth_invalid_scope: 'The requested permissions are not available. Please try again.',
  oauth_server_error: 'The authentication service encountered an error. Please try again in a few minutes.',
  oauth_temporarily_unavailable: 'Sign in is temporarily unavailable. Please try again in a few minutes.',
  oauth_invalid_state: 'Your sign in session expired. Please try signing in again.',
  oauth_callback_failed: 'Sign in could not be completed. Please try again.',
  oauth_email_taken: 'An account already exists with this email. Please sign in with your password or try a different provider.',
  oauth_provider_error: 'There was a problem connecting to the sign in provider. Please try again.',

  // Security errors
  csrf_invalid: 'Your session could not be verified. Please refresh the page and try again.',
  csrf_expired: 'Your session has timed out. Please refresh the page and try again.',
  rate_limited: 'Too many attempts. Please wait a moment before trying again.',
  suspicious_activity: 'Unusual activity was detected. Please try again later or contact support if this continues.',

  // Network/system errors
  network_error: 'Unable to connect to the server. Please check your internet connection and try again.',
  server_error: 'Something went wrong on our end. Please try again in a few minutes.',
  service_unavailable: 'The service is temporarily unavailable. Please try again in a few minutes.',

  // Generic
  unknown_error: 'An unexpected error occurred. Please try again.',
}

// =============================================================================
// Error Message Helpers
// =============================================================================

/**
 * Get user-friendly message for an error code.
 *
 * @param code - The error code
 * @returns User-friendly error message
 */
export function getAuthErrorMessage(code: AuthErrorCode | string | null | undefined): string {
  if (!code) {
    return AUTH_ERROR_MESSAGES.unknown_error
  }
  return AUTH_ERROR_MESSAGES[code as AuthErrorCode] || AUTH_ERROR_MESSAGES.unknown_error
}

/**
 * Map OAuth error codes to internal codes.
 *
 * @param oauthError - OAuth error code from provider
 * @returns Internal auth error code
 */
export function mapOAuthError(oauthError: string): AuthErrorCode {
  const mapping: Record<string, AuthErrorCode> = {
    access_denied: 'oauth_access_denied',
    invalid_request: 'oauth_invalid_request',
    unauthorized_client: 'oauth_unauthorized_client',
    unsupported_response_type: 'oauth_unsupported_response_type',
    invalid_scope: 'oauth_invalid_scope',
    server_error: 'oauth_server_error',
    temporarily_unavailable: 'oauth_temporarily_unavailable',
    invalid_state: 'oauth_invalid_state',
  }

  return mapping[oauthError] || 'oauth_provider_error'
}

/**
 * Map HTTP status codes to error codes.
 *
 * @param status - HTTP status code
 * @returns Appropriate auth error code
 */
export function mapHttpStatusToError(status: number): AuthErrorCode {
  switch (status) {
    case 401:
      return 'invalid_credentials'
    case 403:
      return 'account_disabled'
    case 404:
      return 'account_not_found'
    case 429:
      return 'rate_limited'
    case 500:
      return 'server_error'
    case 503:
      return 'service_unavailable'
    default:
      return 'unknown_error'
  }
}

// =============================================================================
// Auth Error Class
// =============================================================================

/**
 * Custom error class for auth-related errors.
 * Includes error code and user-friendly message.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly userMessage: string
  readonly statusCode: number
  readonly retryAfter?: number

  constructor(
    code: AuthErrorCode,
    options?: {
      cause?: Error
      statusCode?: number
      retryAfter?: number
    },
  ) {
    const userMessage = getAuthErrorMessage(code)
    super(userMessage, { cause: options?.cause })

    this.name = 'AuthError'
    this.code = code
    this.userMessage = userMessage
    this.statusCode = options?.statusCode || getDefaultStatusCode(code)
    this.retryAfter = options?.retryAfter
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      error: this.code,
      message: this.userMessage,
      ...(this.retryAfter && { retryAfter: this.retryAfter }),
    }
  }

  /**
   * Create a Response object from this error
   */
  toResponse(): Response {
    const headers = new Headers({
      'Content-Type': 'application/json',
    })

    if (this.retryAfter) {
      headers.set('Retry-After', String(this.retryAfter))
    }

    return new Response(JSON.stringify(this.toJSON()), {
      status: this.statusCode,
      headers,
    })
  }
}

/**
 * Get default HTTP status code for an error code.
 */
function getDefaultStatusCode(code: AuthErrorCode): number {
  const statusCodes: Partial<Record<AuthErrorCode, number>> = {
    // 400 Bad Request
    invalid_email: 400,
    weak_password: 400,
    terms_not_accepted: 400,
    reset_token_invalid: 400,
    mfa_invalid: 400,
    csrf_invalid: 400,
    csrf_expired: 400,

    // 401 Unauthorized
    invalid_credentials: 401,
    account_not_found: 401,
    session_expired: 401,
    session_invalid: 401,
    session_revoked: 401,
    mfa_required: 401,

    // 403 Forbidden
    account_disabled: 403,
    account_locked: 403,
    email_not_verified: 403,
    oauth_access_denied: 403,
    suspicious_activity: 403,

    // 409 Conflict
    email_already_exists: 409,
    oauth_email_taken: 409,

    // 410 Gone
    reset_token_expired: 410,
    reset_link_used: 410,

    // 429 Too Many Requests
    rate_limited: 429,

    // 500 Server Error
    server_error: 500,
    oauth_server_error: 500,

    // 502 Bad Gateway
    oauth_provider_error: 502,

    // 503 Service Unavailable
    service_unavailable: 503,
    oauth_temporarily_unavailable: 503,
  }

  return statusCodes[code] || 500
}

// =============================================================================
// Error Display Helpers
// =============================================================================

/**
 * Get error severity for UI styling.
 *
 * @param code - Error code
 * @returns Severity level for styling
 */
export function getErrorSeverity(code: AuthErrorCode): 'error' | 'warning' | 'info' {
  const warnings: AuthErrorCode[] = ['email_not_verified', 'mfa_required', 'session_expired', 'oauth_access_denied']

  const info: AuthErrorCode[] = ['email_not_found'] // Security: don't reveal if email exists

  if (warnings.includes(code)) {
    return 'warning'
  }

  if (info.includes(code)) {
    return 'info'
  }

  return 'error'
}

/**
 * Get suggested action for an error.
 *
 * @param code - Error code
 * @returns Suggested action or null
 */
export function getSuggestedAction(
  code: AuthErrorCode,
): {
  label: string
  action: 'retry' | 'reset_password' | 'verify_email' | 'login' | 'signup' | 'contact_support' | 'wait'
} | null {
  const actions: Partial<
    Record<
      AuthErrorCode,
      {
        label: string
        action: 'retry' | 'reset_password' | 'verify_email' | 'login' | 'signup' | 'contact_support' | 'wait'
      }
    >
  > = {
    invalid_credentials: { label: 'Reset password', action: 'reset_password' },
    account_locked: { label: 'Reset password', action: 'reset_password' },
    email_not_verified: { label: 'Resend verification', action: 'verify_email' },
    email_already_exists: { label: 'Sign in instead', action: 'login' },
    oauth_email_taken: { label: 'Sign in instead', action: 'login' },
    reset_token_expired: { label: 'Request new link', action: 'reset_password' },
    reset_link_used: { label: 'Request new link', action: 'reset_password' },
    session_expired: { label: 'Sign in again', action: 'login' },
    rate_limited: { label: 'Wait and retry', action: 'wait' },
    account_disabled: { label: 'Contact support', action: 'contact_support' },
    network_error: { label: 'Try again', action: 'retry' },
    server_error: { label: 'Try again', action: 'retry' },
  }

  return actions[code] || null
}

// =============================================================================
// Field-Level Validation Errors
// =============================================================================

/**
 * Field validation error messages.
 */
export const FIELD_ERRORS = {
  email: {
    required: 'Please enter your email address.',
    invalid: 'Please enter a valid email address.',
    taken: 'This email is already registered.',
  },
  password: {
    required: 'Please enter your password.',
    tooShort: 'Password must be at least 8 characters.',
    tooWeak: 'Password must include uppercase, lowercase, and numbers.',
    noUppercase: 'Password must include at least one uppercase letter.',
    noLowercase: 'Password must include at least one lowercase letter.',
    noNumber: 'Password must include at least one number.',
    noSpecial: 'Consider adding a special character for extra security.',
    common: 'This password is too common. Please choose a more unique password.',
    mismatch: 'Passwords do not match.',
  },
  name: {
    required: 'Please enter your name.',
    tooShort: 'Name must be at least 2 characters.',
    tooLong: 'Name must be less than 100 characters.',
  },
  terms: {
    required: 'You must accept the terms to continue.',
  },
  otp: {
    required: 'Please enter the verification code.',
    invalid: 'Invalid code. Please check and try again.',
    expired: 'This code has expired. Please request a new one.',
  },
} as const

/**
 * Get field error message.
 *
 * @param field - Field name
 * @param errorType - Error type
 * @returns Error message
 */
export function getFieldError(
  field: keyof typeof FIELD_ERRORS,
  errorType: string,
): string {
  const fieldErrors = FIELD_ERRORS[field] as Record<string, string>
  return fieldErrors[errorType] || 'Please check this field.'
}
