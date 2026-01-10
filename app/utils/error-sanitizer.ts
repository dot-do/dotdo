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

// =============================================================================
// Types
// =============================================================================

/**
 * Categories of sensitive data that can appear in error messages.
 * Used for organizing patterns and potentially customizing responses per category.
 */
export type ErrorCategory =
  | 'file-path'
  | 'database'
  | 'api-key'
  | 'credentials'
  | 'internal-url'

/**
 * A pattern for detecting sensitive data in error messages.
 */
export interface SensitivePattern {
  /** The regex pattern to match sensitive data */
  readonly pattern: RegExp
  /** The category this pattern belongs to */
  readonly category: ErrorCategory
  /** Optional replacement text (not currently used, for future masking) */
  readonly replacement?: string
}

// =============================================================================
// Sensitive Pattern Definitions
// =============================================================================

/**
 * File path patterns - reveal server directory structure
 */
const FILE_PATH_PATTERNS: readonly SensitivePattern[] = [
  { pattern: /\/Users\/[^\s]+/gi, category: 'file-path' },
  { pattern: /\/home\/[^\s]+/gi, category: 'file-path' },
  { pattern: /C:\\[^\s]+/gi, category: 'file-path' },
] as const

/**
 * Database connection string patterns - contain credentials and hosts
 */
const DATABASE_PATTERNS: readonly SensitivePattern[] = [
  { pattern: /postgres:\/\/[^\s]+/gi, category: 'database' },
  { pattern: /postgresql:\/\/[^\s]+/gi, category: 'database' },
  { pattern: /mongodb:\/\/[^\s]+/gi, category: 'database' },
  { pattern: /mongodb\+srv:\/\/[^\s]+/gi, category: 'database' },
  { pattern: /redis:\/\/[^\s]+/gi, category: 'database' },
  { pattern: /mysql:\/\/[^\s]+/gi, category: 'database' },
] as const

/**
 * API key patterns - secret keys from various providers
 */
const API_KEY_PATTERNS: readonly SensitivePattern[] = [
  { pattern: /sk-[A-Za-z0-9-_]+/gi, category: 'api-key' }, // OpenAI, Anthropic style keys
  { pattern: /Bearer\s+[A-Za-z0-9\-_.]+/gi, category: 'api-key' },
  { pattern: /api[_-]?key[=:]\s*[^\s]+/gi, category: 'api-key' },
] as const

/**
 * Credential patterns - passwords, secrets, tokens
 */
const CREDENTIAL_PATTERNS: readonly SensitivePattern[] = [
  { pattern: /password[=:]\s*[^\s]+/gi, category: 'credentials' },
  { pattern: /secret[=:]\s*[^\s]+/gi, category: 'credentials' },
  { pattern: /token[=:]\s*[^\s]+/gi, category: 'credentials' },
] as const

/**
 * Internal URL patterns - expose internal infrastructure
 */
const INTERNAL_URL_PATTERNS: readonly SensitivePattern[] = [
  { pattern: /https?:\/\/[^\s]*\.internal[^\s]*/gi, category: 'internal-url' },
  { pattern: /https?:\/\/localhost[:\d]*/gi, category: 'internal-url' },
  { pattern: /https?:\/\/127\.0\.0\.1[:\d]*/gi, category: 'internal-url' },
] as const

/**
 * All sensitive patterns grouped by category.
 * Exported for testing and extension purposes.
 */
export const SENSITIVE_PATTERN_GROUPS = {
  'file-path': FILE_PATH_PATTERNS,
  database: DATABASE_PATTERNS,
  'api-key': API_KEY_PATTERNS,
  credentials: CREDENTIAL_PATTERNS,
  'internal-url': INTERNAL_URL_PATTERNS,
} as const satisfies Record<ErrorCategory, readonly SensitivePattern[]>

/**
 * Flattened array of all sensitive patterns for matching.
 * Maintains backward compatibility with the original implementation.
 */
const ALL_SENSITIVE_PATTERNS: readonly SensitivePattern[] = [
  ...FILE_PATH_PATTERNS,
  ...DATABASE_PATTERNS,
  ...API_KEY_PATTERNS,
  ...CREDENTIAL_PATTERNS,
  ...INTERNAL_URL_PATTERNS,
] as const

// =============================================================================
// Constants
// =============================================================================

/**
 * Generic error message shown when sensitive data is detected
 */
const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.'

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Check if an error message contains sensitive information.
 *
 * Note: RegExp.test() modifies lastIndex for global patterns, so we reset it
 * after each test to ensure consistent behavior across multiple calls.
 */
function containsSensitiveData(message: string): boolean {
  return ALL_SENSITIVE_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0 // Reset for consistent matching with global flag
    return pattern.test(message)
  })
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Sanitize an error message for display to users.
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
 * Check if we're in production mode.
 */
export function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production'
}
