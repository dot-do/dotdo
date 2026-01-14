/**
 * Namespace Validation Module
 *
 * Security module for validating DO namespaces extracted from URL paths.
 * Prevents path traversal, injection attacks, and DoS via long strings.
 *
 * Security Issue: dotdo-qvafw
 *
 * @module npmx/do/namespace
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum allowed namespace length (characters)
 * Prevents DoS attacks via extremely long namespace strings
 */
export const NAMESPACE_MAX_LENGTH = 64

/**
 * Regex pattern for valid namespaces
 * Allows: alphanumeric, hyphens, underscores
 * Length: 1 to NAMESPACE_MAX_LENGTH characters
 *
 * Pattern: ^[a-zA-Z0-9_-]{1,64}$
 */
export const NAMESPACE_REGEX = /^[a-zA-Z0-9_-]{1,64}$/

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

/**
 * Validates a namespace string for security.
 *
 * Rejects:
 * - Path traversal attempts (../, ..\, encoded variants)
 * - Empty or whitespace-only strings
 * - Strings exceeding max length
 * - Invalid characters (/, \, spaces, special chars, unicode)
 * - Control characters and null bytes
 *
 * Accepts:
 * - Alphanumeric strings (a-z, A-Z, 0-9)
 * - Hyphens (-)
 * - Underscores (_)
 * - Length 1-64 characters
 *
 * @param namespace - The namespace string to validate
 * @returns true if valid, false if invalid
 *
 * @example
 * ```typescript
 * validateNamespace('my-tenant')    // true
 * validateNamespace('../admin')     // false
 * validateNamespace('')             // false
 * validateNamespace('a'.repeat(65)) // false
 * ```
 */
export function validateNamespace(namespace: string): boolean {
  // Fast path: check length first (prevents DoS)
  if (!namespace || namespace.length === 0 || namespace.length > NAMESPACE_MAX_LENGTH) {
    return false
  }

  // Use the strict regex for allowlist validation
  // This is a positive match (allowlist) approach which is more secure than blocklist
  // The regex only allows: a-z, A-Z, 0-9, hyphen (-), underscore (_)
  // Everything else (including ., /, \, spaces, unicode, control chars) is rejected
  return NAMESPACE_REGEX.test(namespace)
}
