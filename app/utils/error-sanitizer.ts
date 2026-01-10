/**
 * Error Message Sanitizer
 *
 * Filters sensitive information from error messages before displaying to users.
 * In production, detects and masks:
 * - File paths (/Users/, /home/, C:\)
 * - Database connection strings (postgres://, mongodb://, redis://)
 * - API keys and tokens (sk-, Bearer, api_key=)
 * - Internal URLs (.internal, localhost:)
 * - Passwords and secrets
 *
 * @see app/components/ui/error-boundary.tsx
 * @see dotdo-bx3hc - GREEN phase issue
 */

/**
 * Patterns that indicate sensitive information in error messages
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // File paths
  /\/Users\/[^\s]+/gi,
  /\/home\/[^\s]+/gi,
  /C:\\[^\s]+/gi,

  // Database connection strings
  /postgres:\/\/[^\s]+/gi,
  /postgresql:\/\/[^\s]+/gi,
  /mongodb:\/\/[^\s]+/gi,
  /mongodb\+srv:\/\/[^\s]+/gi,
  /redis:\/\/[^\s]+/gi,
  /mysql:\/\/[^\s]+/gi,

  // API keys and tokens
  /sk-[A-Za-z0-9-_]+/gi, // OpenAI, Anthropic style keys
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /api[_-]?key[=:]\s*[^\s]+/gi,
  /password[=:]\s*[^\s]+/gi,
  /secret[=:]\s*[^\s]+/gi,
  /token[=:]\s*[^\s]+/gi,

  // Internal URLs
  /https?:\/\/[^\s]*\.internal[^\s]*/gi,
  /https?:\/\/localhost[:\d]*/gi,
  /https?:\/\/127\.0\.0\.1[:\d]*/gi,
]

/**
 * Generic error message shown when sensitive data is detected
 */
const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.'

/**
 * Check if an error message contains sensitive information
 */
function containsSensitiveData(message: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Sanitize an error message for display to users
 *
 * In production mode, if the message contains sensitive patterns,
 * returns a generic message instead.
 *
 * In development mode, returns the full message for debugging.
 *
 * @param error - The error to sanitize
 * @returns Sanitized message safe to display
 */
export function sanitizeErrorMessage(error: Error): string {
  // In development, show full error for debugging
  if (process.env.NODE_ENV === 'development') {
    return error.message
  }

  // In production, check for sensitive data
  if (containsSensitiveData(error.message)) {
    return GENERIC_ERROR_MESSAGE
  }

  // Safe to show the original message
  return error.message
}

/**
 * Check if we're in production mode
 */
export function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production'
}
